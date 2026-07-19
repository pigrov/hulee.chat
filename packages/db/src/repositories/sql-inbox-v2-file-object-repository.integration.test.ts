import { sql, type SQL } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2FileObjectRepository,
  type InboxV2AttachmentMaterializationClaim,
  type InboxV2FileObjectTransactionExecutor
} from "./sql-inbox-v2-file-object-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type SqlExecutor = Pick<HuleeDatabase, "execute">;

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
const tenantIds: string[] = [];

describePostgres("SQL Inbox V2 file derivative graph (PostgreSQL)", () => {
  let db: HuleeDatabase;
  let databaseUrl: string;

  beforeAll(async () => {
    databaseUrl = process.env.DATABASE_URL ?? "";
    if (databaseUrl.length === 0) {
      throw new Error(
        "DATABASE_URL is required for the file derivative integration test."
      );
    }
    db = createHuleeDatabase({
      connectionString: databaseUrl,
      poolConfig: { max: 6 }
    });
    const readiness = await db.execute<{
      edges: string | null;
      guard: string | null;
      guard_definition: string | null;
    }>(sql`
        select
          to_regclass(
            'public.inbox_v2_file_derivative_edges'
          )::text as edges,
          to_regprocedure(
            'public.inbox_v2_file_derivative_cycle_guard()'
          )::text as guard,
          case
            when to_regprocedure(
              'public.inbox_v2_file_derivative_cycle_guard()'
            ) is null then null
            else pg_get_functiondef(
              to_regprocedure(
                'public.inbox_v2_file_derivative_cycle_guard()'
              )
            )
          end as guard_definition
      `);
    expect(readiness.rows[0]).toMatchObject({
      edges: "inbox_v2_file_derivative_edges",
      guard: "inbox_v2_file_derivative_cycle_guard()"
    });
    expect(readiness.rows[0]?.guard_definition).toContain(
      "pg_advisory_xact_lock"
    );
    expect(readiness.rows[0]?.guard_definition).toContain(
      "core:inbox-v2.file-derivative-graph:"
    );
    expect(readiness.rows[0]?.guard_definition).toContain(
      "inbox_v2.file_derivative_isolation_unsafe"
    );
  });

  afterAll(async () => {
    if (!db) return;
    for (const tenantId of tenantIds.reverse()) {
      await db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        await transaction.execute(sql`
            delete from public.inbox_v2_file_derivative_edges
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_storage_orphans
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_attachment_materialization_jobs
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_parent_link_heads
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_parent_links
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_parent_set_heads
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_versions
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_object_version_heads
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_object_versions
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(sql`
            delete from public.inbox_v2_file_objects
             where tenant_id = ${tenantId}
          `);
        await transaction.execute(
          sql`delete from public.tenants where id = ${tenantId}`
        );
        await transaction.execute(
          sql`delete from public.event_store where tenant_id = ${tenantId}`
        );
        await transaction.execute(
          sql`set local session_replication_role = origin`
        );
      });
    }
    await closeHuleeDatabase(db);
  });

  it("serializes a concurrent three-edge path closure and rejects exactly the cycle-closing edge", async () => {
    const graph = graphFixture("three-edge-cycle");
    tenantIds.push(graph.tenantId);
    await seedGraph(db, graph);
    await insertDerivativeEdge(db, graph, "a-to-b", "a", "b");

    const firstDb = workerDatabase(databaseUrl);
    const secondDb = workerDatabase(databaseUrl);
    const firstInserted = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondPid = deferred<number>();
    let firstRun: Promise<TransactionResult> | undefined;
    let secondRun: Promise<TransactionResult> | undefined;
    try {
      firstRun = captureTransaction(async () => {
        await firstDb.transaction(async (transaction) => {
          await configureRaceTransaction(transaction);
          await insertDerivativeEdge(transaction, graph, "b-to-c", "b", "c");
          firstInserted.resolve();
          await releaseFirst.promise;
        });
      });
      await firstInserted.promise;

      secondRun = captureTransaction(async () => {
        await secondDb.transaction(async (transaction) => {
          await configureRaceTransaction(transaction);
          secondPid.resolve(await backendPid(transaction));
          await insertDerivativeEdge(transaction, graph, "c-to-a", "c", "a");
        });
      });
      const pid = await secondPid.promise;
      const observationAbort = new AbortController();
      const observation = await Promise.race([
        waitForAdvisoryWait(db, pid, observationAbort.signal).then((waiting) =>
          waiting ? "advisory_wait" : "not_observed"
        ),
        secondRun.then(() => "settled_before_wait" as const)
      ]);
      observationAbort.abort();
      expect(observation).toBe("advisory_wait");

      releaseFirst.resolve();
      const [firstResult, secondResult] = await Promise.all([
        firstRun,
        secondRun
      ]);
      expect(firstResult).toEqual({ kind: "committed" });
      expect(secondResult.kind).toBe("rejected");
      if (secondResult.kind !== "rejected") {
        throw new Error("Cycle-closing edge unexpectedly committed.");
      }
      expect(errorEvidence(secondResult.error)).toContain(
        "inbox_v2.file_derivative_cycle"
      );
      expect(databaseErrorCode(secondResult.error)).toBe("23514");

      const edges = await loadEdges(db, graph.tenantId);
      expect(edges).toEqual([
        { original: graph.nodes.a, derived: graph.nodes.b },
        { original: graph.nodes.b, derived: graph.nodes.c }
      ]);
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled(
        [firstRun, secondRun].filter(
          (run): run is Promise<TransactionResult> => run !== undefined
        )
      );
      await Promise.all([
        closeHuleeDatabase(firstDb),
        closeHuleeDatabase(secondDb)
      ]);
    }
  }, 20_000);

  it("does not serialize derivative graph writes belonging to different tenants", async () => {
    const left = graphFixture("tenant-left");
    const right = graphFixture("tenant-right");
    tenantIds.push(left.tenantId, right.tenantId);
    await seedGraph(db, left);
    await seedGraph(db, right);

    const firstDb = workerDatabase(databaseUrl);
    const secondDb = workerDatabase(databaseUrl);
    const firstInserted = deferred<void>();
    const releaseFirst = deferred<void>();
    const secondPid = deferred<number>();
    let firstRun: Promise<TransactionResult> | undefined;
    let secondRun: Promise<TransactionResult> | undefined;
    try {
      firstRun = captureTransaction(async () => {
        await firstDb.transaction(async (transaction) => {
          await configureRaceTransaction(transaction);
          await insertDerivativeEdge(
            transaction,
            left,
            "left-a-to-b",
            "a",
            "b"
          );
          firstInserted.resolve();
          await releaseFirst.promise;
        });
      });
      await firstInserted.promise;

      secondRun = captureTransaction(async () => {
        await secondDb.transaction(async (transaction) => {
          await configureRaceTransaction(transaction);
          secondPid.resolve(await backendPid(transaction));
          await insertDerivativeEdge(
            transaction,
            right,
            "right-a-to-b",
            "a",
            "b"
          );
        });
      });
      const pid = await secondPid.promise;
      const observationAbort = new AbortController();
      const observation = await Promise.race([
        secondRun.then((result) => ({ kind: "settled" as const, result })),
        waitForAdvisoryWait(db, pid, observationAbort.signal).then(
          (waiting) => ({
            kind: waiting ? ("advisory_wait" as const) : ("timeout" as const)
          })
        )
      ]);
      observationAbort.abort();
      expect(observation).toEqual({
        kind: "settled",
        result: { kind: "committed" }
      });

      releaseFirst.resolve();
      await expect(firstRun).resolves.toEqual({ kind: "committed" });
      expect(await loadEdges(db, right.tenantId)).toEqual([
        { original: right.nodes.a, derived: right.nodes.b }
      ]);
    } finally {
      releaseFirst.resolve();
      await Promise.allSettled(
        [firstRun, secondRun].filter(
          (run): run is Promise<TransactionResult> => run !== undefined
        )
      );
      await Promise.all([
        closeHuleeDatabase(firstDb),
        closeHuleeDatabase(secondDb)
      ]);
    }
  }, 20_000);

  it("fails closed for concurrent derivative writes under repeatable read", async () => {
    const graph = graphFixture("repeatable-read");
    tenantIds.push(graph.tenantId);
    await seedGraph(db, graph);

    const firstDb = workerDatabase(databaseUrl);
    const secondDb = workerDatabase(databaseUrl);
    const firstReady = deferred<void>();
    const secondReady = deferred<void>();
    const releaseBoth = deferred<void>();
    let firstRun: Promise<TransactionResult> | undefined;
    let secondRun: Promise<TransactionResult> | undefined;
    try {
      firstRun = captureTransaction(async () => {
        await firstDb.transaction(async (transaction) => {
          await configureRepeatableReadTransaction(transaction);
          firstReady.resolve();
          await releaseBoth.promise;
          await insertDerivativeEdge(transaction, graph, "rr-a-to-b", "a", "b");
        });
      });
      secondRun = captureTransaction(async () => {
        await secondDb.transaction(async (transaction) => {
          await configureRepeatableReadTransaction(transaction);
          secondReady.resolve();
          await releaseBoth.promise;
          await insertDerivativeEdge(transaction, graph, "rr-b-to-a", "b", "a");
        });
      });

      await Promise.all([firstReady.promise, secondReady.promise]);
      releaseBoth.resolve();
      const results = await Promise.all([firstRun, secondRun]);
      expect(results).toHaveLength(2);
      for (const result of results) {
        expect(result.kind).toBe("rejected");
        if (result.kind !== "rejected") {
          throw new Error(
            "Repeatable-read derivative insert unexpectedly committed."
          );
        }
        expect(errorEvidence(result.error)).toContain(
          "inbox_v2.file_derivative_isolation_unsafe"
        );
        expect(databaseErrorCode(result.error)).toBe("25001");
      }
      expect(await loadEdges(db, graph.tenantId)).toEqual([]);
    } finally {
      releaseBoth.resolve();
      await Promise.allSettled(
        [firstRun, secondRun].filter(
          (run): run is Promise<TransactionResult> => run !== undefined
        )
      );
      await Promise.all([
        closeHuleeDatabase(firstDb),
        closeHuleeDatabase(secondDb)
      ]);
    }
  }, 20_000);

  it("rejects direct durable deletes and state resurrection while tenant deletion cascades", async () => {
    const tenantId = `tenant:file-delete-guard-${runId}`;
    const fileId = `file:file-delete-guard-${runId}`;
    const fileVersionId = `file_version:file-delete-guard-${runId}`;
    const objectVersionId = `file_object_version:file-delete-guard-${runId}`;
    const deletedFileId = `file:file-delete-terminal-${runId}`;
    const deletedObjectVersionId = `file_object_version:file-delete-terminal-${runId}`;
    const now = new Date().toISOString();
    tenantIds.push(tenantId);

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into public.tenants (
          id, slug, display_name, deployment_type
        ) values (
          ${tenantId}, ${`file-delete-guard-${runId}`},
          'File delete guard', 'saas_shared'
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${fileId}, 'core:message-content',
          'core:communication', ${now}, 'pending', null, null, 1,
          ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_versions (
          tenant_id, id, storage_root_id, storage_object_key,
          storage_version_identity, versioning_mode, checksum_sha256,
          size_bytes, declared_media_type, detected_media_type,
          encryption_key_ref, data_class_id, retention_anchor_at, created_at
        ) values (
          ${tenantId}, ${objectVersionId}, 'core:file-delete-test-root',
          ${`file-delete/${runId}`}, ${`version-${runId}`},
          'immutable_key', ${"a".repeat(64)}, 1, null,
          'application/octet-stream', null, 'core:message-content',
          ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_version_heads (
          tenant_id, object_version_id, state, latest_operation_evidence_id,
          revision, state_changed_at, created_at
        ) values (
          ${tenantId}, ${objectVersionId}, 'staging', null, 1, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_versions (
          tenant_id, id, file_id, version_number, object_version_id, created_at
        ) values (
          ${tenantId}, ${fileVersionId}, ${fileId}, 1,
          ${objectVersionId}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_parent_set_heads (
          tenant_id, file_id, revision, completeness,
          completeness_revision, live_parent_count, updated_at
        ) values (
          ${tenantId}, ${fileId}, 1, 'unknown', 0, 0, ${now}
        )
      `);

      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        insert into public.inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${deletedFileId}, 'core:message-content',
          'core:communication', ${now}, 'deleted', null, null, 1,
          ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_versions (
          tenant_id, id, storage_root_id, storage_object_key,
          storage_version_identity, versioning_mode, checksum_sha256,
          size_bytes, declared_media_type, detected_media_type,
          encryption_key_ref, data_class_id, retention_anchor_at, created_at
        ) values (
          ${tenantId}, ${deletedObjectVersionId},
          'core:file-delete-test-root', ${`file-delete/terminal/${runId}`},
          ${`terminal-version-${runId}`}, 'immutable_key',
          ${"b".repeat(64)}, 1, null, 'application/octet-stream', null,
          'core:message-content', ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_version_heads (
          tenant_id, object_version_id, state, latest_operation_evidence_id,
          revision, state_changed_at, created_at
        ) values (
          ${tenantId}, ${deletedObjectVersionId}, 'deleted', null, 1,
          ${now}, ${now}
        )
      `);
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    });

    for (const [query, expectedEvidence] of [
      [
        sql`delete from public.inbox_v2_file_objects
             where tenant_id = ${tenantId} and id = ${fileId}`,
        "inbox_v2.file_object_head_delete_forbidden"
      ],
      [
        sql`delete from public.inbox_v2_file_object_versions
             where tenant_id = ${tenantId} and id = ${objectVersionId}`,
        "inbox_v2.file_immutable"
      ],
      [
        sql`delete from public.inbox_v2_file_object_version_heads
             where tenant_id = ${tenantId}
               and object_version_id = ${objectVersionId}`,
        "inbox_v2.file_object_version_head_delete_forbidden"
      ],
      [
        sql`delete from public.inbox_v2_file_versions
             where tenant_id = ${tenantId} and id = ${fileVersionId}`,
        "inbox_v2.file_immutable"
      ],
      [
        sql`delete from public.inbox_v2_file_parent_set_heads
             where tenant_id = ${tenantId} and file_id = ${fileId}`,
        "inbox_v2.file_parent_set_head_delete_forbidden"
      ]
    ] as const) {
      await expect(db.execute(query)).rejects.toSatisfy(
        (error) =>
          databaseErrorCode(error) === "23514" &&
          errorEvidence(error).includes(expectedEvidence)
      );
    }

    await expect(
      db.execute(sql`
        update public.inbox_v2_file_objects
           set state = 'quarantined', revision = revision + 1,
               updated_at = clock_timestamp()
         where tenant_id = ${tenantId} and id = ${fileId}
      `)
    ).rejects.toSatisfy(
      (error) =>
        databaseErrorCode(error) === "23514" &&
        errorEvidence(error).includes(
          "inbox_v2.file_object_head_transition_invalid"
        )
    );
    await expect(
      db.execute(sql`
        update public.inbox_v2_file_object_version_heads
           set state = 'quarantined', revision = revision + 1,
               state_changed_at = clock_timestamp()
         where tenant_id = ${tenantId}
           and object_version_id = ${objectVersionId}
      `)
    ).rejects.toSatisfy(
      (error) =>
        databaseErrorCode(error) === "23514" &&
        errorEvidence(error).includes(
          "inbox_v2.file_object_version_head_transition_invalid"
        )
    );
    await expect(
      db.execute(sql`
        update public.inbox_v2_file_objects
           set state = 'ready', revision = revision + 1,
               updated_at = clock_timestamp()
         where tenant_id = ${tenantId} and id = ${deletedFileId}
      `)
    ).rejects.toSatisfy(
      (error) =>
        databaseErrorCode(error) === "23514" &&
        errorEvidence(error).includes(
          "inbox_v2.file_object_head_transition_invalid"
        )
    );
    await expect(
      db.execute(sql`
        update public.inbox_v2_file_object_version_heads
           set state = 'ready', revision = revision + 1,
               state_changed_at = clock_timestamp()
         where tenant_id = ${tenantId}
           and object_version_id = ${deletedObjectVersionId}
      `)
    ).rejects.toSatisfy(
      (error) =>
        databaseErrorCode(error) === "23514" &&
        errorEvidence(error).includes(
          "inbox_v2.file_object_version_head_transition_invalid"
        )
    );

    await expect(
      db.execute(sql`delete from public.tenants where id = ${tenantId}`)
    ).resolves.toBeDefined();
    const remaining = await db.execute<{ remaining: string }>(sql`
      select (
        (select count(*) from public.inbox_v2_file_objects
          where tenant_id = ${tenantId})
        + (select count(*) from public.inbox_v2_file_object_versions
          where tenant_id = ${tenantId})
        + (select count(*) from public.inbox_v2_file_object_version_heads
          where tenant_id = ${tenantId})
        + (select count(*) from public.inbox_v2_file_versions
          where tenant_id = ${tenantId})
        + (select count(*) from public.inbox_v2_file_parent_set_heads
          where tenant_id = ${tenantId})
      )::text as remaining
    `);
    expect(remaining.rows).toEqual([{ remaining: "0" }]);
  });

  it("attaches and detaches a shared second parent with its own past anchor without changing ready bytes", async () => {
    const tenantId = `tenant:file-shared-parent-${runId}`;
    const fileId = `file:file-shared-parent-${runId}`;
    const fileVersionId = `file_version:file-shared-parent-${runId}`;
    const objectVersionId = `file_object_version:file-shared-parent-${runId}`;
    const firstLinkId = `file_parent_link:file-shared-parent-first-${runId}`;
    const secondMessageId = `message:file-shared-parent-second-${runId}`;
    const detachEventId = `event:file-shared-parent-detach-${runId}`;
    const now = new Date().toISOString();
    const fileAnchor = new Date(Date.now() - 172_800_000).toISOString();
    const firstParentAnchor = new Date(Date.now() - 86_400_000).toISOString();
    const secondParentAnchor = new Date(Date.now() - 43_200_000).toISOString();
    tenantIds.push(tenantId);
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        insert into public.tenants (
          id, slug, display_name, deployment_type
        ) values (
          ${tenantId}, ${`file-shared-parent-${runId}`},
          'File shared parent', 'saas_shared'
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${fileId}, 'core:message-content',
          'core:communication', ${fileAnchor}, 'ready', ${fileVersionId},
          ${objectVersionId}, 2, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_versions (
          tenant_id, id, storage_root_id, storage_object_key,
          storage_version_identity, versioning_mode, checksum_sha256,
          size_bytes, declared_media_type, detected_media_type,
          encryption_key_ref, data_class_id, retention_anchor_at, created_at
        ) values (
          ${tenantId}, ${objectVersionId}, 'core:file-shared-parent-root',
          ${`file-shared-parent/${runId}`}, ${`provider-version-${runId}`},
          'native_version', ${"a".repeat(64)}, 123, 'application/pdf',
          'application/pdf', null, 'core:message-content', ${fileAnchor}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_version_heads (
          tenant_id, object_version_id, state, latest_operation_evidence_id,
          revision, state_changed_at, created_at
        ) values (
          ${tenantId}, ${objectVersionId}, 'ready', null, 1, ${now}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_versions (
          tenant_id, id, file_id, version_number, object_version_id, created_at
        ) values (
          ${tenantId}, ${fileVersionId}, ${fileId}, 1,
          ${objectVersionId}, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_parent_set_heads (
          tenant_id, file_id, revision, completeness,
          completeness_revision, live_parent_count, updated_at
        ) values (
          ${tenantId}, ${fileId}, 1, 'complete', 1, 1, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_parent_links (
          tenant_id, id, file_id, file_version_id, object_version_id,
          parent_identity_digest_sha256, parent_kind, parent_purpose,
          visibility_boundary, parent_conversation_visibility,
          parent_entity_id, parent_entity_revision, conversation_id,
          timeline_item_id, content_id, content_revision, block_key,
          data_class_id, processing_purpose_id, retention_anchor_at,
          created_at, revision
        ) values (
          ${tenantId}, ${firstLinkId}, ${fileId}, ${fileVersionId},
          ${objectVersionId}, ${"b".repeat(64)}, 'message', 'attachment',
          'external_work', null,
          ${`message:file-shared-parent-first-${runId}`}, 1,
          ${`conversation:file-shared-parent-${runId}`},
          ${`timeline_item:file-shared-parent-first-${runId}`},
          ${`timeline_content:file-shared-parent-first-${runId}`}, 1,
          'file-1', 'core:message-content', 'core:message-attachment',
          ${firstParentAnchor}, ${now}, 1
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_parent_link_heads (
          tenant_id, link_id, file_id, state, detached_by_event_id,
          revision, updated_at
        ) values (
          ${tenantId}, ${firstLinkId}, ${fileId}, 'live', null, 1, ${now}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_domain_events (
          tenant_id, id, mutation_id, stream_commit_id, stream_position,
          ordinal, type_id, payload_schema_id, payload_schema_version,
          change_ids, subjects, payload_reference, correlation_id,
          command_ids, client_mutation_ids, authorization_decision_refs,
          access_effect, access_effect_causes, event_hash, occurred_at,
          recorded_at
        ) values (
          ${tenantId}, ${detachEventId},
          ${`authorization-mutation:file-parent-detach-${runId}`},
          ${`commit:file-parent-detach-${runId}`}, 1, 1,
          'core:file-parent.detached', 'core:inbox-v2.file-parent-detached',
          'v1',
          ${JSON.stringify([`change:file-parent-detach-${runId}`])}::jsonb,
          ${JSON.stringify([
            {
              tenantId,
              entityTypeId: "core:file",
              entityId: fileId
            }
          ])}::jsonb,
          null, ${`correlation:file-parent-detach-${runId}`},
          '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, 'none', '[]'::jsonb,
          ${`sha256:${"c".repeat(64)}`}, ${now}, ${now}
        )
      `);
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    });

    const repository = createSqlInboxV2FileObjectRepository(
      replicaTransactionExecutor(db)
    );
    const attached = await repository.attachParent({
      tenantId,
      fileId,
      fileVersionId,
      objectVersionId,
      expectedParentSetRevision: "1",
      parent: {
        kind: "message",
        purpose: "attachment",
        visibilityBoundary: "external_work",
        parentConversationVisibility: null,
        entityId: secondMessageId,
        entityRevision: "1",
        conversationId: `conversation:file-shared-parent-${runId}`,
        timelineItemId: `timeline_item:file-shared-parent-second-${runId}`,
        contentId: `timeline_content:file-shared-parent-second-${runId}`,
        contentRevision: "1",
        blockKey: "file-2"
      },
      dataClassId: "core:message-content",
      processingPurposeId: "core:message-attachment",
      retentionAnchorAt: secondParentAnchor
    });
    expect(attached).toMatchObject({
      kind: "attached",
      parentSetRevision: "2",
      liveParentCount: 2
    });
    if (attached.kind !== "attached") {
      throw new Error("Shared second parent did not attach.");
    }
    expect(secondParentAnchor).not.toBe(fileAnchor);
    expect(Date.parse(secondParentAnchor)).toBeLessThan(Date.parse(now));

    await expect(
      repository.detachParent({
        tenantId,
        fileId,
        linkId: attached.linkId,
        expectedParentSetRevision: "2",
        expectedLinkRevision: "1",
        detachedByEventId: detachEventId
      })
    ).resolves.toMatchObject({
      kind: "detached",
      parentSetRevision: "3",
      liveParentCount: 1
    });
    const state = await db.execute<{
      file_state: string;
      object_state: string;
      object_revision: string;
      parent_revision: string;
      live_parent_count: number;
      second_link_state: string;
    }>(sql`
      select file.state as file_state, object_head.state as object_state,
             object_head.revision::text as object_revision,
             parent_head.revision::text as parent_revision,
             parent_head.live_parent_count,
             second_head.state as second_link_state
        from public.inbox_v2_file_objects file
        join public.inbox_v2_file_object_version_heads object_head
          on object_head.tenant_id = file.tenant_id
         and object_head.object_version_id = file.current_object_version_id
        join public.inbox_v2_file_parent_set_heads parent_head
          on parent_head.tenant_id = file.tenant_id
         and parent_head.file_id = file.id
        join public.inbox_v2_file_parent_link_heads second_head
          on second_head.tenant_id = file.tenant_id
         and second_head.link_id = ${attached.linkId}
       where file.tenant_id = ${tenantId} and file.id = ${fileId}
    `);
    expect(state.rows).toEqual([
      {
        file_state: "ready",
        object_state: "ready",
        object_revision: "1",
        parent_revision: "3",
        live_parent_count: 1,
        second_link_state: "detached"
      }
    ]);
  });

  it("keeps a quarantined exact storage orphan non-adoptable with immutable physical evidence", async () => {
    const tenantId = `tenant:file-orphan-quarantine-${runId}`;
    const fileId = `file:file-orphan-quarantine-${runId}`;
    const jobId = `attachment_materialization_job:file-orphan-quarantine-${runId}`;
    const storageRootId = "core:file-orphan-test-root";
    const storageKey = `file-orphan/quarantine/${runId}`;
    const versionId = `provider-version-${runId}`;
    const sourceLocatorReference = `src_ref_${"f".repeat(43)}`;
    const evidenceSha256 = `sha256:${"e".repeat(64)}`;
    const createdAt = new Date(Date.now() - 60_000).toISOString();
    tenantIds.push(tenantId);
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        insert into public.tenants (
          id, slug, display_name, deployment_type
        ) values (
          ${tenantId}, ${`file-orphan-quarantine-${runId}`},
          'File orphan quarantine', 'saas_shared'
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${tenantId}, ${fileId}, 'core:message-content',
          'core:communication', ${createdAt}, 'pending', null, null, 1,
          ${createdAt}, ${createdAt}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_attachment_materialization_jobs (
          tenant_id, id, attachment_id, file_id, expected_file_revision,
          conversation_id, timeline_item_id, parent_message_id,
          expected_parent_revision, visibility_boundary,
          timeline_content_id, expected_content_revision, content_block_key,
          content_mutation_fence_sha256, source_occurrence_id,
          source_locator_kind, source_locator_reference,
          source_locator_digest_sha256, reservation_namespace_generation,
          idempotency_token,
          cause_event_id, cause_mutation_id,
          cause_stream_commit_id, cause_stream_position, correlation_id,
          caused_at, authorization_command_id,
          authorization_command_type_id, authorization_client_mutation_id,
          authorization_mutation_id, authorization_decision_id,
          authorization_epoch, authorization_actor_kind,
          authorization_actor_id, authorization_authorized_at,
          authorization_decision_set_digest_sha256,
          authorization_resource_fence_set_digest_sha256,
          authorization_tenant_rbac_revision,
          authorization_shared_access_revision,
          authorization_resource_head_id,
          authorization_resource_access_revision,
          authorization_structural_relation_revision,
          authorization_collaborator_set_revision,
          authorization_audit_grant_source_ids,
          authorization_audit_policy_version,
          expected_attachment_revision, state, lease_generation,
          reserved_file_version_id, reserved_object_version_id,
          reserved_storage_root_id, reserved_storage_object_key,
          revision, created_at, updated_at
        ) values (
          ${tenantId}, ${jobId},
          ${`message_attachment:file-orphan-quarantine-${runId}`},
          ${fileId}, 1,
          ${`conversation:file-orphan-quarantine-${runId}`},
          ${`timeline_item:file-orphan-quarantine-${runId}`},
          ${`message:file-orphan-quarantine-${runId}`}, 1,
          'external_work',
          ${`timeline_content:file-orphan-quarantine-${runId}`}, 1,
          'file-1', ${"a".repeat(64)}, null, 'upload_staging',
          ${sourceLocatorReference}, ${"b".repeat(64)},
          'attachment-namespace-v1',
          ${`orphan-token-${runId}`},
          ${`event:file-orphan-quarantine-${runId}`},
          ${`mutation:file-orphan-quarantine-${runId}`},
          ${`stream_commit:file-orphan-quarantine-${runId}`}, 1,
          ${`correlation:file-orphan-quarantine-${runId}`}, ${createdAt},
          ${`command:file-orphan-quarantine-${runId}`},
          'core:attachment.materialization.reserve',
          ${`client-mutation:file-orphan-quarantine-${runId}`},
          ${`mutation:file-orphan-quarantine-${runId}`},
          ${`decision:file-orphan-quarantine-${runId}`},
          ${`epoch:file-orphan-quarantine-${runId}`}, 'trusted_service',
          'worker:file-orphan-quarantine', ${createdAt},
          ${"1".repeat(64)}, ${"2".repeat(64)}, 1, 1,
          ${`authorization-resource-head:file-orphan-quarantine-${runId}`},
          1, 1, 1, array[${`internal-ref:${"3".repeat(32)}`}], null,
          1, 'pending', 0,
          ${`file_version:file-orphan-quarantine-${runId}`},
          ${`file_object_version:file-orphan-quarantine-${runId}`},
          ${storageRootId}, ${storageKey}, 1, ${createdAt}, ${createdAt}
        )
      `);
      await transaction.execute(
        sql`set local session_replication_role = origin`
      );
    });
    const claim: InboxV2AttachmentMaterializationClaim = {
      tenantId,
      jobId,
      attachmentId: `message_attachment:file-orphan-quarantine-${runId}`,
      attemptId: `attachment_materialization_attempt:file-orphan-quarantine-${runId}`,
      leaseToken: `attachment-lease:${"c".repeat(64)}`,
      leaseGeneration: "1",
      workerId: "core:attachment-worker",
      claimedAt: createdAt,
      leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      expectedJobRevision: "1",
      fileId,
      expectedFileRevision: "1",
      dataClassId: "core:message-content",
      processingPurposeId: "core:communication",
      retentionAnchorAt: createdAt,
      fileVersionId: `file_version:file-orphan-quarantine-${runId}`,
      objectVersionId: `file_object_version:file-orphan-quarantine-${runId}`,
      storageRootId,
      storageKey,
      contentOrigin: {
        conversationId: `conversation:file-orphan-quarantine-${runId}`,
        timelineItemId: `timeline_item:file-orphan-quarantine-${runId}`,
        parentKind: "message",
        parentEntityId: `message:file-orphan-quarantine-${runId}`,
        expectedParentRevision: "1",
        timelineContentId: `timeline_content:file-orphan-quarantine-${runId}`,
        expectedContentRevision: "1",
        contentBlockKey: "file-1",
        expectedAttachmentRevision: "1",
        visibilityBoundary: "external_work"
      },
      sourceLocator: {
        kind: "upload_staging",
        reference: sourceLocatorReference
      },
      reservationNamespaceGeneration: "attachment-namespace-v1",
      sourceOccurrenceId: null,
      causeEventId: `event:file-orphan-quarantine-${runId}`,
      causeMutationId: `mutation:file-orphan-quarantine-${runId}`,
      causeStreamCommitId: `stream_commit:file-orphan-quarantine-${runId}`,
      causeStreamPosition: "1",
      correlationId: `correlation:file-orphan-quarantine-${runId}`,
      causedAt: createdAt,
      reservationAuthority: {
        commandId: `command:file-orphan-quarantine-${runId}`,
        commandTypeId: "core:attachment.materialization.reserve",
        clientMutationId: `client-mutation:file-orphan-quarantine-${runId}`,
        mutationId: `mutation:file-orphan-quarantine-${runId}`,
        decisionId: `decision:file-orphan-quarantine-${runId}`,
        epoch: `epoch:file-orphan-quarantine-${runId}`,
        actor: {
          kind: "trusted_service",
          trustedServiceId: "worker:file-orphan-quarantine"
        },
        authorizedAt: createdAt,
        decisionSetDigestSha256: "1".repeat(64),
        resourceFenceSetDigestSha256: "2".repeat(64),
        tenantRbacRevision: "1",
        sharedAccessRevision: "1",
        resourceHeadId: `authorization-resource-head:file-orphan-quarantine-${runId}`,
        resourceAccessRevision: "1",
        structuralRelationRevision: "1",
        collaboratorSetRevision: "1",
        auditGrantSourceIds: [`internal-ref:${"3".repeat(32)}`],
        auditPolicyVersion: null
      }
    };
    const input = {
      claim,
      identity: { storageKey, versionId },
      storageRootId,
      checksumSha256: `sha256:${"d".repeat(64)}`,
      sizeBytes: 123,
      mediaType: "application/pdf",
      reasonCode: "object_storage.immutable_conflict",
      quarantine: {
        reasonCode: "integrity.conditional_replay_mismatch",
        evidenceSha256,
        physicalKind: "s3_object_version_tags"
      }
    } as const;
    const repository = createSqlInboxV2FileObjectRepository(db);

    await expect(repository.recordOrphan(input)).resolves.toBe("recorded");
    await expect(repository.recordOrphan(input)).resolves.toBe(
      "already_recorded"
    );
    const persisted = await db.execute<{
      state: string;
      reason: string | null;
      evidence: string | null;
      physical_kind: string | null;
    }>(sql`
      select state, quarantine_reason_code as reason,
             quarantine_evidence_digest_sha256 as evidence,
             quarantine_physical_kind as physical_kind
        from public.inbox_v2_file_storage_orphans
       where tenant_id = ${tenantId}
         and storage_root_id = ${storageRootId}
         and storage_object_key = ${storageKey}
         and storage_version_identity = ${versionId}
    `);
    expect(persisted.rows).toEqual([
      {
        state: "quarantined",
        reason: input.quarantine.reasonCode,
        evidence: evidenceSha256.slice("sha256:".length),
        physical_kind: input.quarantine.physicalKind
      }
    ]);
    await expect(
      repository.recordOrphan({
        ...input,
        quarantine: {
          ...input.quarantine,
          evidenceSha256: `sha256:${"f".repeat(64)}`
        }
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.storage_orphan_identity_conflict"
    });
    await expect(
      db.execute(sql`
        update public.inbox_v2_file_storage_orphans
           set state = 'claimed',
               claim_token_hash = ${"1".repeat(64)},
               claim_expires_at = clock_timestamp() + interval '1 minute',
               revision = revision + 1,
               updated_at = clock_timestamp()
         where tenant_id = ${tenantId}
      `)
    ).rejects.toSatisfy(
      (error) =>
        databaseErrorCode(error) === "23514" &&
        errorEvidence(error).includes(
          "inbox_v2.file_storage_orphan_cas_invalid"
        )
    );
  });
});

type GraphNode = "a" | "b" | "c";
type GraphFixture = Readonly<{
  tenantId: string;
  label: string;
  nodes: Readonly<Record<GraphNode, string>>;
}>;
type TransactionResult =
  | Readonly<{ kind: "committed" }>
  | Readonly<{ kind: "rejected"; error: unknown }>;

function graphFixture(label: string): GraphFixture {
  return {
    tenantId: `tenant:file-derivative-${label}-${runId}`,
    label,
    nodes: {
      a: `file_version:file-derivative-${label}-a-${runId}`,
      b: `file_version:file-derivative-${label}-b-${runId}`,
      c: `file_version:file-derivative-${label}-c-${runId}`
    }
  };
}

function workerDatabase(databaseUrl: string): HuleeDatabase {
  return createHuleeDatabase({
    connectionString: databaseUrl,
    poolConfig: { max: 1 }
  });
}

function replicaTransactionExecutor(
  db: HuleeDatabase
): InboxV2FileObjectTransactionExecutor {
  const executor = rawSqlExecutor(db);
  return {
    execute: executor.execute,
    transaction: (work, config) =>
      db.transaction(async (transaction) => {
        await transaction.execute(
          sql`set local session_replication_role = replica`
        );
        return work(rawSqlExecutor(transaction));
      }, config)
  };
}

function rawSqlExecutor(executor: SqlExecutor): RawSqlExecutor {
  return {
    async execute<Row extends Record<string, unknown>>(query: SQL) {
      const result = await executor.execute(query);
      return { rows: result.rows as Row[] };
    }
  };
}

async function seedGraph(
  db: HuleeDatabase,
  fixture: GraphFixture
): Promise<void> {
  const createdAt = new Date().toISOString();
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      insert into public.tenants (
        id, slug, display_name, deployment_type
      ) values (
        ${fixture.tenantId},
        ${`file-derivative-${fixture.label}-${runId}`},
        ${`File derivative ${fixture.label}`},
        'saas_shared'
      )
    `);
    for (const node of ["a", "b", "c"] as const) {
      const fileId = `file:file-derivative-${fixture.label}-${node}-${runId}`;
      const objectVersionId = `file_object_version:file-derivative-${fixture.label}-${node}-${runId}`;
      await transaction.execute(sql`
        insert into public.inbox_v2_file_objects (
          tenant_id, id, data_class_id, processing_purpose_id,
          retention_anchor_at, state, current_file_version_id,
          current_object_version_id, revision, created_at, updated_at
        ) values (
          ${fixture.tenantId}, ${fileId}, 'core:message-content',
          'core:communication', ${createdAt}, 'pending', null, null, 1,
          ${createdAt}, ${createdAt}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_object_versions (
          tenant_id, id, storage_root_id, storage_object_key,
          storage_version_identity, versioning_mode, checksum_sha256,
          size_bytes, declared_media_type, detected_media_type,
          encryption_key_ref, data_class_id, retention_anchor_at, created_at
        ) values (
          ${fixture.tenantId}, ${objectVersionId},
          'core:file-derivative-test-root',
          ${`file-derivative/${fixture.label}/${node}/${runId}`},
          ${`object-version-${node}`}, 'immutable_key',
          ${node.repeat(64)}, 1, 'application/octet-stream',
          'application/octet-stream', null, 'core:message-content',
          ${createdAt}, ${createdAt}
        )
      `);
      await transaction.execute(sql`
        insert into public.inbox_v2_file_versions (
          tenant_id, id, file_id, version_number, object_version_id, created_at
        ) values (
          ${fixture.tenantId}, ${fixture.nodes[node]}, ${fileId}, 1,
          ${objectVersionId}, ${createdAt}
        )
      `);
    }
  });
}

async function configureRaceTransaction(
  transaction: SqlExecutor
): Promise<void> {
  await transaction.execute(sql`set local statement_timeout = '10s'`);
  await transaction.execute(sql`set local lock_timeout = '8s'`);
}

async function configureRepeatableReadTransaction(
  transaction: SqlExecutor
): Promise<void> {
  await transaction.execute(
    sql`set transaction isolation level repeatable read`
  );
  await configureRaceTransaction(transaction);
}

async function insertDerivativeEdge(
  executor: SqlExecutor,
  fixture: GraphFixture,
  label: string,
  original: GraphNode,
  derived: GraphNode
): Promise<void> {
  await executor.execute(sql`
    insert into public.inbox_v2_file_derivative_edges (
      tenant_id, id, original_file_version_id, derived_file_version_id,
      transform_kind_id, transform_profile_id, transform_profile_version,
      created_at
    ) values (
      ${fixture.tenantId},
      ${`file_derivative_edge:${fixture.label}-${label}-${runId}`},
      ${fixture.nodes[original]}, ${fixture.nodes[derived]},
      'core:file-transform', 'core:file-transform-profile', 'v1',
      ${new Date().toISOString()}
    )
  `);
}

async function backendPid(executor: SqlExecutor): Promise<number> {
  const result = await executor.execute<{ pid: number }>(
    sql`select pg_backend_pid() as pid`
  );
  const pid = result.rows[0]?.pid;
  if (!Number.isInteger(pid)) throw new Error("Worker backend PID is missing.");
  return pid!;
}

async function waitForAdvisoryWait(
  db: HuleeDatabase,
  pid: number,
  signal: AbortSignal,
  timeoutMs = 4_000
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!signal.aborted && Date.now() < deadline) {
    const result = await db.execute<{
      wait_event_type: string | null;
      wait_event: string | null;
    }>(sql`
      select wait_event_type, wait_event
        from pg_catalog.pg_stat_activity
       where pid = ${pid}
    `);
    const activity = result.rows[0];
    if (
      activity?.wait_event_type === "Lock" &&
      activity.wait_event?.toLowerCase() === "advisory"
    ) {
      return true;
    }
    await delay(20);
  }
  return false;
}

async function loadEdges(
  db: HuleeDatabase,
  tenantId: string
): Promise<readonly { original: string; derived: string }[]> {
  const result = await db.execute<{
    original: string;
    derived: string;
  }>(sql`
    select original_file_version_id as original,
           derived_file_version_id as derived
      from public.inbox_v2_file_derivative_edges
     where tenant_id = ${tenantId}
     order by original_file_version_id, derived_file_version_id
  `);
  return result.rows;
}

async function captureTransaction(
  work: () => Promise<void>
): Promise<TransactionResult> {
  try {
    await work();
    return { kind: "committed" };
  } catch (error) {
    return { kind: "rejected", error };
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve } as const;
}

function errorEvidence(error: unknown): string {
  const fragments: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (current instanceof Error) fragments.push(current.message);
    else fragments.push(String(current));
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return fragments.join(" | ");
}

function databaseErrorCode(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 6 && current !== undefined; depth += 1) {
    if (
      typeof current === "object" &&
      current !== null &&
      "code" in current &&
      typeof current.code === "string"
    ) {
      return current.code;
    }
    current =
      typeof current === "object" && current !== null && "cause" in current
        ? current.cause
        : undefined;
  }
  return null;
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
