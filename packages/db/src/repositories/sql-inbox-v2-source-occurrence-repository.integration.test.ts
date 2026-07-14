import {
  inboxV2SourceOccurrenceMaterializationCommitSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceOccurrenceMaterializationCommit,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  createSqlInboxV2SourceOccurrenceRepository,
  type InboxV2SourceOccurrenceTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-source-occurrence-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const baseAt = "2026-07-14T08:00:00.000Z";
const evidenceAt = "2026-07-14T08:01:00.000Z";
const materializedAt = "2026-07-14T08:02:00.000Z";
const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: baseAt
} as const;

describePostgres(
  "SQL Inbox V2 SourceOccurrence repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{
        occurrences: string | null;
        references: string | null;
        timestamps: string | null;
        guard: string | null;
      }>(sql`
      select
        to_regclass('public.inbox_v2_source_occurrences')::text as occurrences,
        to_regclass(
          'public.inbox_v2_source_occurrence_provider_references'
        )::text as references,
        to_regclass(
          'public.inbox_v2_source_occurrence_provider_timestamps'
        )::text as timestamps,
        to_regprocedure(
          'public.inbox_v2_source_occurrence_guard_insert()'
        )::text as guard
    `);
      expect(readiness.rows[0]).toEqual({
        occurrences: "inbox_v2_source_occurrences",
        references: "inbox_v2_source_occurrence_provider_references",
        timestamps: "inbox_v2_source_occurrence_provider_timestamps",
        guard: "inbox_v2_source_occurrence_guard_insert()"
      });
    });

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("materializes a webhook with the exact ordered provider children", async () => {
      const fixture = makeFixture("happy");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, { occurrenceSuffix: "happy" });
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);

      const result = await repository.materialize(commit);

      expect(result).toEqual({
        kind: "materialized",
        occurrence: commit.occurrence
      });
      await expect(
        repository.findOccurrence({
          tenantId: fixture.tenantId,
          occurrenceId: commit.occurrence.id
        })
      ).resolves.toEqual(commit.occurrence);
      await expect(
        repository.findOccurrence({
          tenantId: inboxV2TenantIdSchema.parse(
            `tenant:db003-occ-foreign-${runId}`
          ),
          occurrenceId: commit.occurrence.id
        })
      ).resolves.toBeNull();
      const stored = await db.execute<{
        origin_kind: string;
        provider_actor_kind: string;
        direction: string;
        provider_reference_count: number;
        provider_timestamp_count: number;
        message_key_digest_sha256: string;
      }>(sql`
      select
        origin_kind,
        provider_actor_kind,
        direction,
        provider_reference_count,
        provider_timestamp_count,
        message_key_digest_sha256
      from inbox_v2_source_occurrences
      where tenant_id = ${fixture.tenantId}
        and id = ${commit.occurrence.id}
    `);
      expect(stored.rows[0]).toMatchObject({
        origin_kind: "webhook",
        provider_actor_kind: "source_external_identity",
        direction: "inbound",
        provider_reference_count: 2,
        provider_timestamp_count: 2
      });
      expect(stored.rows[0]?.message_key_digest_sha256).toMatch(
        /^[a-f0-9]{64}$/u
      );
      expect(
        await persistedChildren(db, fixture.tenantId, commit.occurrence.id)
      ).toEqual({
        references: commit.occurrence.descriptor.providerReferences.map(
          (reference, ordinal) => ({
            ordinal,
            kind_id: reference.kindId,
            subject: reference.subject
          })
        ),
        timestamps: commit.occurrence.providerTimestamps.map(
          (providerTimestamp, ordinal) => ({
            ordinal,
            kind_id: providerTimestamp.kindId,
            provider_timestamp: providerTimestamp.timestamp
          })
        )
      });
    });

    it("materializes a provider-scoped actor on the exact binding adapter surface", async () => {
      const fixture = makeFixture("provider-compatible");
      await seedFixture(db, fixture, { actorScope: "provider" });
      const commit = makeCommit(fixture, {
        occurrenceSuffix: "provider-compatible"
      });

      await expect(
        createSqlInboxV2SourceOccurrenceRepository(db).materialize(commit)
      ).resolves.toEqual({
        kind: "materialized",
        occurrence: commit.occurrence
      });
    });

    it("rejects a provider-scoped actor loaded by another adapter service", async () => {
      const fixture = makeFixture("provider-service-mismatch");
      await seedFixture(db, fixture, {
        actorScope: "provider",
        actorServiceMismatch: true
      });
      const commit = makeCommit(fixture, {
        occurrenceSuffix: "provider-service-mismatch"
      });

      await expect(
        createSqlInboxV2SourceOccurrenceRepository(db).materialize(commit)
      ).resolves.toEqual({
        kind: "provider_actor_adapter_surface_conflict",
        sourceExternalIdentityId: fixture.actorId
      });
    });

    it.each(["ephemeral_raw", "ephemeral_normalized"] as const)(
      "materializes an exact %s actor observation",
      async (actorStability) => {
        const fixture = makeFixture(actorStability);
        await seedFixture(db, fixture, { actorStability });
        const commit = makeCommit(fixture, {
          occurrenceSuffix: actorStability
        });

        await expect(
          createSqlInboxV2SourceOccurrenceRepository(db).materialize(commit)
        ).resolves.toEqual({
          kind: "materialized",
          occurrence: commit.occurrence
        });
      }
    );

    it("materializes history observations authored by a provider system actor", async () => {
      const fixture = makeFixture("history-system");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, {
        occurrenceSuffix: "history-system",
        originKind: "history",
        providerActorKind: "provider_system"
      });

      const result =
        await createSqlInboxV2SourceOccurrenceRepository(db).materialize(
          commit
        );
      expect(result.kind).toBe("materialized");

      const stored = await db.execute<{
        origin_kind: string;
        provider_actor_kind: string;
        provider_system_actor_kind_id: string;
        provider_system_actor_subject: string;
        provider_actor_source_external_identity_id: string | null;
        direction: string;
      }>(sql`
      select
        origin_kind,
        provider_actor_kind,
        provider_system_actor_kind_id,
        provider_system_actor_subject,
        provider_actor_source_external_identity_id,
        direction
      from inbox_v2_source_occurrences
      where tenant_id = ${fixture.tenantId}
        and id = ${commit.occurrence.id}
    `);
      expect(stored.rows[0]).toEqual({
        origin_kind: "history",
        provider_actor_kind: "provider_system",
        provider_system_actor_kind_id: "module:synthetic-source:service-event",
        provider_system_actor_subject: "ProviderHistoryService",
        provider_actor_source_external_identity_id: null,
        direction: "system"
      });
    });

    it("rejects wrong event pairing, account scope, binding head, capability, and thread fences", async () => {
      const fixture = makeFixture("negative-fences");
      await seedFixture(db, fixture);
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);

      const pairConflict = makeCommit(fixture, {
        occurrenceSuffix: "pair-conflict",
        normalizedId: fixture.normalizedSecondId
      });
      await expect(repository.materialize(pairConflict)).resolves.toMatchObject(
        {
          kind: "evidence_pair_conflict",
          evidenceKind: "normalized_inbound_event"
        }
      );

      const accountConflict = makeCommit(fixture, {
        occurrenceSuffix: "account-conflict",
        rawId: fixture.rawAlternateAccountId,
        normalizedId: fixture.normalizedAlternateAccountId
      });
      await expect(
        repository.materialize(accountConflict)
      ).resolves.toMatchObject({
        kind: "evidence_scope_conflict",
        evidenceKind: "raw_inbound_event"
      });

      const bindingConflict = makeCommit(fixture, {
        occurrenceSuffix: "binding-conflict",
        bindingRevision: "2"
      });
      await expect(repository.materialize(bindingConflict)).resolves.toEqual({
        kind: "binding_snapshot_conflict"
      });

      const capabilityConflict = makeCommit(fixture, {
        occurrenceSuffix: "capability-conflict",
        capabilityRevision: "2"
      });
      await expect(repository.materialize(capabilityConflict)).resolves.toEqual(
        {
          kind: "capability_revision_conflict"
        }
      );

      const threadConflict = makeCommit(fixture, {
        occurrenceSuffix: "thread-conflict",
        threadRealmVersion: "v2"
      });
      await expect(repository.materialize(threadConflict)).resolves.toEqual({
        kind: "thread_mapping_conflict"
      });

      const count = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from inbox_v2_source_occurrences
      where tenant_id = ${fixture.tenantId}
    `);
      expect(count.rows[0]?.count).toBe("0");
    });

    it("rolls back direct forged DML when the bounded children are incomplete", async () => {
      const fixture = makeFixture("direct-dml");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, { occurrenceSuffix: "direct-source" });
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);
      expect((await repository.materialize(commit)).kind).toBe("materialized");
      const forgedId = occurrenceId("direct-forged");

      await expectDatabaseFailure(
        db.transaction(async (transaction) => {
          await transaction.execute(
            sql.raw(
              cloneOccurrenceWithoutChildrenSql({
                tenantId: fixture.tenantId,
                sourceOccurrenceId: commit.occurrence.id,
                forgedOccurrenceId: forgedId
              })
            )
          );
          await transaction.execute(sql`set constraints all immediate`);
        }),
        /inbox_v2\.source_occurrence_provider_references_invalid/u
      );

      const counts = await db.execute<{
        occurrences: string;
        references: string;
        timestamps: string;
      }>(sql`
      select
        (
          select count(*)::text
          from inbox_v2_source_occurrences
          where tenant_id = ${fixture.tenantId} and id = ${forgedId}
        ) as occurrences,
        (
          select count(*)::text
          from inbox_v2_source_occurrence_provider_references
          where tenant_id = ${fixture.tenantId}
            and source_occurrence_id = ${forgedId}
        ) as references,
        (
          select count(*)::text
          from inbox_v2_source_occurrence_provider_timestamps
          where tenant_id = ${fixture.tenantId}
            and source_occurrence_id = ${forgedId}
        ) as timestamps
    `);
      expect(counts.rows[0]).toEqual({
        occurrences: "0",
        references: "0",
        timestamps: "0"
      });
    });

    it("isolates equal occurrence IDs by tenant and cannot borrow foreign evidence", async () => {
      const fixtureA = makeFixture("tenant-a");
      const fixtureB = makeFixture("tenant-b");
      await seedFixture(db, fixtureA);
      await seedFixture(db, fixtureB);
      const sharedOccurrenceId = occurrenceId("tenant-shared");
      const commitA = makeCommit(fixtureA, {
        occurrenceId: sharedOccurrenceId
      });
      const commitB = makeCommit(fixtureB, {
        occurrenceId: sharedOccurrenceId
      });
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);

      const [resultA, resultB] = await Promise.all([
        repository.materialize(commitA),
        repository.materialize(commitB)
      ]);
      expect(resultA.kind).toBe("materialized");
      expect(resultB.kind).toBe("materialized");
      await expect(
        repository.findOccurrence({
          tenantId: fixtureA.tenantId,
          occurrenceId: sharedOccurrenceId as never
        })
      ).resolves.toEqual(commitA.occurrence);
      await expect(
        repository.findOccurrence({
          tenantId: fixtureB.tenantId,
          occurrenceId: sharedOccurrenceId as never
        })
      ).resolves.toEqual(commitB.occurrence);

      const foreignEvidence = makeCommit(fixtureA, {
        occurrenceSuffix: "foreign-evidence",
        rawId: fixtureB.rawId,
        normalizedId: fixtureB.normalizedId
      });
      await expect(repository.materialize(foreignEvidence)).resolves.toEqual({
        kind: "evidence_not_found",
        evidenceKind: "raw_inbound_event"
      });

      const rows = await db.execute<{ tenant_id: string }>(sql`
      select tenant_id
      from inbox_v2_source_occurrences
      where id = ${sharedOccurrenceId}
      order by tenant_id
    `);
      expect(rows.rows.map((row) => row.tenant_id)).toEqual(
        [fixtureA.tenantId, fixtureB.tenantId].sort()
      );
    });

    it("returns exact idempotency for an equal ID and conflict for a changed aggregate", async () => {
      const fixture = makeFixture("duplicate-id");
      await seedFixture(db, fixture);
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);
      const commit = makeCommit(fixture, { occurrenceSuffix: "duplicate-id" });

      await expect(repository.materialize(commit)).resolves.toMatchObject({
        kind: "materialized"
      });
      await expect(repository.materialize(commit)).resolves.toEqual({
        kind: "already_materialized",
        occurrence: commit.occurrence
      });

      const conflicting = makeCommit(fixture, {
        occurrenceId: commit.occurrence.id,
        messageSubject: "ProviderMessage:Changed"
      });
      await expect(repository.materialize(conflicting)).resolves.toEqual({
        kind: "occurrence_id_conflict",
        occurrenceId: commit.occurrence.id
      });
      expect(
        await persistedChildren(db, fixture.tenantId, commit.occurrence.id)
      ).toEqual({
        references: commit.occurrence.descriptor.providerReferences.map(
          (reference, ordinal) => ({
            ordinal,
            kind_id: reference.kindId,
            subject: reference.subject
          })
        ),
        timestamps: commit.occurrence.providerTimestamps.map(
          (providerTimestamp, ordinal) => ({
            ordinal,
            kind_id: providerTimestamp.kindId,
            provider_timestamp: providerTimestamp.timestamp
          })
        )
      });
    });

    it("allows different occurrence IDs for the same canonical message key", async () => {
      const fixture = makeFixture("same-message-key");
      await seedFixture(db, fixture);
      const repository = createSqlInboxV2SourceOccurrenceRepository(db);
      const first = makeCommit(fixture, { occurrenceSuffix: "same-key-first" });
      const second = makeCommit(fixture, {
        occurrenceSuffix: "same-key-second"
      });

      expect((await repository.materialize(first)).kind).toBe("materialized");
      expect((await repository.materialize(second)).kind).toBe("materialized");

      const stored = await db.execute<{
        count: string;
        distinct_digests: string;
      }>(sql`
      select
        count(*)::text as count,
        count(distinct message_key_digest_sha256)::text as distinct_digests
      from inbox_v2_source_occurrences
      where tenant_id = ${fixture.tenantId}
        and id in (${first.occurrence.id}, ${second.occurrence.id})
    `);
      expect(stored.rows[0]).toEqual({ count: "2", distinct_digests: "1" });
    });

    it("holds the binding head fence until occurrence materialization commits", async () => {
      const fixture = makeFixture("binding-race");
      await seedFixture(db, fixture);
      const commit = makeCommit(fixture, { occurrenceSuffix: "binding-race" });
      const gate = new BindingShareLockGateExecutor(db);
      const materialization =
        createSqlInboxV2SourceOccurrenceRepository(gate).materialize(commit);
      const holderPid = await gate.waitUntilBindingLocked();
      let waiterPid = 0;
      const waiterStarted = deferred<void>();
      const writer = db.transaction(async (transaction) => {
        const pid = await transaction.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`
        );
        waiterPid = Number(pid.rows[0]?.pid);
        waiterStarted.resolve();
        await transaction.execute(sql`
        select binding_id
        from inbox_v2_source_thread_binding_heads
        where tenant_id = ${fixture.tenantId}
          and binding_id = ${fixture.bindingId}
        for update
      `);
        throw new Error("rollback-binding-fence-writer");
      });
      const writerSettled = writer.then(
        () => ({ kind: "fulfilled" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error })
      );
      await waiterStarted.promise;

      try {
        await waitForTransactionBlockedBy(db, holderPid, waiterPid);
      } finally {
        gate.release();
      }

      await expect(materialization).resolves.toMatchObject({
        kind: "materialized"
      });
      const writerOutcome = await writerSettled;
      expect(writerOutcome.kind).toBe("rejected");
      if (writerOutcome.kind !== "rejected") {
        throw new Error("Expected the reversible binding writer to roll back.");
      }
      expect(errorChainMessages(writerOutcome.error)).toContain(
        "rollback-binding-fence-writer"
      );
      const count = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from inbox_v2_source_occurrences
      where tenant_id = ${fixture.tenantId}
        and id = ${commit.occurrence.id}
    `);
      expect(count.rows[0]?.count).toBe("1");
    }, 20_000);
  }
);

type Fixture = Readonly<{
  tenantId: InboxV2TenantId;
  label: string;
  connectionId: string;
  accountId: string;
  alternateAccountId: string;
  conversationId: string;
  externalThreadId: string;
  bindingId: string;
  episodeId: string;
  actorId: string;
  rawId: string;
  normalizedId: string;
  rawSecondId: string;
  normalizedSecondId: string;
  rawAlternateAccountId: string;
  normalizedAlternateAccountId: string;
}>;

type CommitOptions = Readonly<{
  occurrenceSuffix?: string;
  occurrenceId?: string;
  rawId?: string;
  normalizedId?: string;
  originKind?: "webhook" | "history";
  providerActorKind?: "source_external_identity" | "provider_system";
  bindingRevision?: string;
  capabilityRevision?: string;
  threadRealmVersion?: "v1" | "v2";
  messageSubject?: string;
}>;

function makeFixture(label: string): Fixture {
  const suffix = `${label}-${runId}`;
  return {
    tenantId: inboxV2TenantIdSchema.parse(`tenant:db003-occ-${suffix}`),
    label,
    connectionId: `source_connection:db003-occ-${suffix}`,
    accountId: `source_account:db003-occ-${suffix}`,
    alternateAccountId: `source_account:db003-occ-alt-${suffix}`,
    conversationId: `conversation:db003-occ-${suffix}`,
    externalThreadId: `external_thread:db003-occ-${suffix}`,
    bindingId: `source_thread_binding:db003-occ-${suffix}`,
    episodeId: `source_thread_binding_remote_access_episode:db003-occ-${suffix}`,
    actorId: `source_external_identity:db003-occ-${suffix}`,
    rawId: `raw_inbound_event:db003-occ-${suffix}`,
    normalizedId: `normalized_inbound_event:db003-occ-${suffix}`,
    rawSecondId: `raw_inbound_event:db003-occ-second-${suffix}`,
    normalizedSecondId: `normalized_inbound_event:db003-occ-second-${suffix}`,
    rawAlternateAccountId: `raw_inbound_event:db003-occ-alt-${suffix}`,
    normalizedAlternateAccountId: `normalized_inbound_event:db003-occ-alt-${suffix}`
  };
}

function occurrenceId(suffix: string): string {
  return `source_occurrence:db003-${suffix}-${runId}`;
}

function reference(tenantId: InboxV2TenantId, kind: string, id: string) {
  return { tenantId, kind, id };
}

function makeCommit(
  fixture: Fixture,
  options: CommitOptions = {}
): InboxV2SourceOccurrenceMaterializationCommit {
  const tenantId = fixture.tenantId;
  const sourceConnection = reference(
    tenantId,
    "source_connection",
    fixture.connectionId
  );
  const sourceAccount = reference(
    tenantId,
    "source_account",
    fixture.accountId
  );
  const externalThread = reference(
    tenantId,
    "external_thread",
    fixture.externalThreadId
  );
  const sourceThreadBinding = reference(
    tenantId,
    "source_thread_binding",
    fixture.bindingId
  );
  const rawEvent = reference(
    tenantId,
    "raw_inbound_event",
    options.rawId ?? fixture.rawId
  );
  const normalizedEvent = reference(
    tenantId,
    "normalized_inbound_event",
    options.normalizedId ?? fixture.normalizedId
  );
  const accountDeclaration = {
    adapterContract,
    identityKind: "source_account",
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection",
    decisionStrength: "authoritative"
  } as const;
  const threadDeclaration = {
    adapterContract,
    identityKind: "external_thread",
    realmId: "module:synthetic-source:thread-realm",
    realmVersion: options.threadRealmVersion ?? "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:group-thread",
    scopeKind: "source_account",
    decisionStrength: "safe_default"
  } as const;
  const messageDeclaration = {
    adapterContract,
    identityKind: "message",
    realmId: "module:synthetic-source:message-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:chat-message",
    scopeKind: "provider_thread",
    decisionStrength: "authoritative"
  } as const;
  const accountIdentitySnapshot = {
    status: "verified" as const,
    sourceConnection,
    sourceAccount,
    declaration: accountDeclaration,
    realmId: accountDeclaration.realmId,
    canonicalExternalSubject: `ProviderAccount:${fixture.label}`,
    accountGeneration: "1",
    verificationEvidence: [rawEvent],
    verifiedAt: baseAt
  };
  const binding = {
    tenantId,
    id: fixture.bindingId,
    externalThread,
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot,
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: baseAt,
      evidence: [rawEvent]
    },
    administrative: {
      state: "enabled" as const,
      revision: "1",
      changedAt: baseAt
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: baseAt,
      diagnostic: null
    },
    historySync: {
      state: "unsupported" as const,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: baseAt,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [],
      evidence: [rawEvent],
      observedAt: baseAt
    },
    capabilities: {
      adapterContract,
      revision: options.capabilityRevision ?? "1",
      capturedAt: baseAt,
      entries: []
    },
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "1",
      destinationKindId: "module:synthetic-source:group-peer",
      destinationSubject: `ProviderGroup:${fixture.label}`,
      attributes: [],
      descriptorDigestSha256: "a".repeat(64)
    },
    revision: options.bindingRevision ?? "1",
    createdAt: baseAt,
    updatedAt: baseAt
  };
  const conversation = {
    tenantId,
    id: fixture.conversationId,
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat",
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: baseAt,
      updatedAt: baseAt
    },
    revision: "1",
    createdAt: baseAt,
    updatedAt: baseAt
  };
  const providerSystem = options.providerActorKind === "provider_system";
  const messageSubject =
    options.messageSubject ?? `ProviderMessage:${fixture.label}`;
  const occurrence = {
    tenantId,
    id:
      options.occurrenceId ??
      occurrenceId(options.occurrenceSuffix ?? fixture.label),
    messageKey: {
      realm: {
        realmId: messageDeclaration.realmId,
        realmVersion: messageDeclaration.realmVersion,
        canonicalizationVersion: messageDeclaration.canonicalizationVersion
      },
      scope: { kind: "provider_thread" as const },
      objectKindId: messageDeclaration.objectKindId,
      externalThread,
      canonicalExternalSubject: messageSubject
    },
    messageIdentityDeclaration: messageDeclaration,
    bindingContext: {
      externalThread,
      sourceAccount,
      sourceThreadBinding,
      bindingGeneration: "1"
    },
    origin: {
      kind: options.originKind ?? "webhook",
      sourceAccount,
      rawInboundEvent: rawEvent,
      normalizedInboundEvent: normalizedEvent
    },
    descriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:message-observation",
      descriptorVersion: "v1",
      capabilityRevision: options.capabilityRevision ?? "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:external-message-id",
          subject: messageSubject
        },
        {
          kindId: "module:synthetic-source:external-thread-message-id",
          subject: `${fixture.label}:thread-message`
        }
      ],
      descriptorDigestSha256: "b".repeat(64)
    },
    providerActor: providerSystem
      ? {
          kind: "provider_system" as const,
          actorKindId: "module:synthetic-source:service-event",
          actorSubject: "ProviderHistoryService"
        }
      : {
          kind: "source_external_identity" as const,
          sourceExternalIdentity: reference(
            tenantId,
            "source_external_identity",
            fixture.actorId
          )
        },
    direction: providerSystem ? ("system" as const) : ("inbound" as const),
    providerTimestamps: [
      {
        kindId: "module:synthetic-source:provider-created-at",
        timestamp: evidenceAt
      },
      {
        kindId: "module:synthetic-source:provider-received-at",
        timestamp: materializedAt
      }
    ],
    referencePortability: {
      kind: "binding_only" as const,
      adapterContract,
      decisionStrength: "safe_default" as const
    },
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:message-reference-pending",
        retryable: true,
        correlationToken: `correlation:${fixture.label}`,
        safeOperatorHintId: null
      }
    },
    observedAt: evidenceAt,
    recordedAt: materializedAt,
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };

  return inboxV2SourceOccurrenceMaterializationCommitSchema.parse({
    tenantId,
    occurrence,
    bindingMaterialization: {
      kind: "existing",
      currentProjection: {
        binding,
        currentRemoteAccessEpisode: {
          tenantId,
          id: fixture.episodeId,
          binding: sourceThreadBinding,
          state: "active",
          startedAt: baseAt,
          endedAt: null,
          startEvidence: [rawEvent],
          endEvidence: [],
          revision: "1",
          createdAt: baseAt,
          updatedAt: baseAt
        }
      },
      creationAuthority: null
    },
    externalThreadMapping: {
      tenantId,
      thread: {
        tenantId,
        id: fixture.externalThreadId,
        key: {
          realm: {
            realmId: threadDeclaration.realmId,
            realmVersion: threadDeclaration.realmVersion,
            canonicalizationVersion: threadDeclaration.canonicalizationVersion
          },
          scope: { kind: "source_account", owner: sourceAccount },
          objectKindId: threadDeclaration.objectKindId,
          canonicalExternalSubject: `ProviderGroup:${fixture.label}`
        },
        identityDeclaration: threadDeclaration,
        conversation: reference(
          tenantId,
          "conversation",
          fixture.conversationId
        ),
        conversationTopology: "group",
        revision: "1",
        createdAt: baseAt,
        updatedAt: baseAt
      },
      conversation
    },
    sourceAccountIdentity: {
      tenantId,
      sourceAccount,
      sourceConnection,
      identityDeclaration: accountDeclaration,
      accountGeneration: "1",
      revision: "1",
      createdAt: baseAt,
      updatedAt: baseAt,
      state: "verified",
      expectedCanonicalScope: null,
      provisionalIdentity: null,
      canonicalIdentity: {
        realm: {
          realmId: accountDeclaration.realmId,
          realmVersion: accountDeclaration.realmVersion,
          canonicalizationVersion: accountDeclaration.canonicalizationVersion,
          objectKindId: accountDeclaration.objectKindId
        },
        scope: { kind: "source_connection", owner: sourceConnection },
        canonicalExternalSubject: `ProviderAccount:${fixture.label}`
      },
      verifiedBy: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        policyId: "core:provider-account-verification",
        policyVersion: "v1",
        reasonCodeId: "core:account-verified",
        verificationEvidenceToken: `evidence:verified-${fixture.label}`,
        decidedAt: baseAt
      },
      conflict: null
    },
    outboundDispatchAttempt: null,
    outboundDispatch: null,
    outboundRoute: null,
    authority: {
      kind: "trusted_service",
      trustedServiceId: "core:source-runtime",
      authorizationToken: `authorization:occurrence-${fixture.label}`,
      authorizedAt: materializedAt
    },
    materializedAt
  });
}

type SeedFixtureOptions = Readonly<{
  actorScope?: "provider" | "source_account";
  actorServiceMismatch?: boolean;
  actorStability?: "stable" | "ephemeral_raw" | "ephemeral_normalized";
}>;

async function seedFixture(
  db: HuleeDatabase,
  fixture: Fixture,
  options: SeedFixtureOptions = {}
): Promise<void> {
  const actorScope = options.actorScope ?? "source_account";
  const actorAdapterContract = options.actorServiceMismatch
    ? { ...adapterContract, loadedByTrustedServiceId: "core:other-runtime" }
    : adapterContract;
  const actorStability = options.actorStability ?? "stable";
  const actorIdentityDeclaration = {
    adapterContract: actorAdapterContract,
    identityKind: "source_external_identity",
    realmId: "module:synthetic-source:actor-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:provider-user",
    scopeKind: actorScope,
    decisionStrength:
      actorScope === "source_account" ? "safe_default" : "authoritative"
  } as const;
  const accountDeclaration = JSON.stringify({
    adapterContract,
    identityKind: "source_account",
    realmId: "module:synthetic-source:account-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:user-account",
    scopeKind: "source_connection",
    decisionStrength: "authoritative"
  });
  const threadDeclaration = JSON.stringify({
    adapterContract,
    identityKind: "external_thread",
    realmId: "module:synthetic-source:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:group-thread",
    scopeKind: "source_account",
    decisionStrength: "safe_default"
  });

  await db.transaction(async (transaction) => {
    // DB001/DB002 anchors are intentionally seeded as a compact, check-valid
    // fixture. SourceOccurrence FKs, guards, deferred children, and repository
    // transactions below all execute again in origin mode.
    await transaction.execute(
      sql`set local session_replication_role = replica`
    );
    await transaction.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values (
        ${fixture.tenantId},
        ${`db003-occ-${fixture.label}-${runId}`},
        ${`DB003 occurrence ${fixture.label}`},
        'saas_shared'
      )
    `);
    await transaction.execute(sql`
      insert into source_connections (
        id, tenant_id, source_type, source_name, display_name
      ) values (
        ${fixture.connectionId}, ${fixture.tenantId},
        'messenger', 'synthetic', ${`Connection ${fixture.label}`}
      )
    `);
    await transaction.execute(sql`
      insert into source_accounts (
        id, tenant_id, source_connection_id, account_type, display_name
      ) values
        (
          ${fixture.accountId}, ${fixture.tenantId}, ${fixture.connectionId},
          'direct_number', ${`Account ${fixture.label}`}
        ),
        (
          ${fixture.alternateAccountId}, ${fixture.tenantId},
          ${fixture.connectionId}, 'direct_number',
          ${`Alternate account ${fixture.label}`}
        )
    `);
    await seedEventPair(transaction, fixture, {
      rawId: fixture.rawId,
      normalizedId: fixture.normalizedId,
      accountId: fixture.accountId,
      suffix: "main"
    });
    await seedEventPair(transaction, fixture, {
      rawId: fixture.rawSecondId,
      normalizedId: fixture.normalizedSecondId,
      accountId: fixture.accountId,
      suffix: "second"
    });
    await seedEventPair(transaction, fixture, {
      rawId: fixture.rawAlternateAccountId,
      normalizedId: fixture.normalizedAlternateAccountId,
      accountId: fixture.alternateAccountId,
      suffix: "alternate"
    });
    await transaction.execute(sql`
      insert into inbox_v2_source_account_identities (
        tenant_id, source_account_id, source_connection_id, state,
        identity_declaration, declaration_contract_id,
        declaration_contract_version, declaration_revision,
        declaration_surface_id, declaration_loaded_by_trusted_service_id,
        declaration_loaded_at, declaration_realm_id,
        declaration_realm_version, declaration_canonicalization_version,
        declaration_object_kind_id, declaration_scope_kind,
        canonical_realm_id, canonical_realm_version,
        canonicalization_version, canonical_object_kind_id,
        canonical_scope_kind, canonical_scope_source_connection_id,
        canonical_scope_owner_key, canonical_external_subject,
        verified_decision_actor_trusted_service_id,
        verified_decision_policy_id, verified_decision_policy_version,
        verified_decision_reason_code_id,
        verified_decision_verification_evidence_token,
        verified_decision_decided_at, account_generation, revision,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.accountId}, ${fixture.connectionId},
        'verified', ${accountDeclaration}::jsonb,
        ${adapterContract.contractId}, ${adapterContract.contractVersion}, 1,
        ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt},
        'module:synthetic-source:account-realm', 'v1', 'v1',
        'module:synthetic-source:user-account', 'source_connection',
        'module:synthetic-source:account-realm', 'v1', 'v1',
        'module:synthetic-source:user-account', 'source_connection',
        ${fixture.connectionId}, ${fixture.connectionId},
        ${`ProviderAccount:${fixture.label}`}, 'core:source-runtime',
        'core:provider-account-verification', 'v1',
        'core:account-verified', ${`evidence:verified-${fixture.label}`},
        ${baseAt}, 1, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_conversations (
        tenant_id, id, topology, transport, purpose_id, lifecycle,
        revision, last_changed_stream_position, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.conversationId}, 'group', 'external',
        'core:chat', 'active', 1, 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_external_threads (
        tenant_id, id, key_registry_id, key_registry_entry_kind,
        realm_id, realm_version, canonicalization_version, scope_kind,
        scope_source_account_id, scope_owner_key, object_kind_id,
        canonical_external_subject, identity_declaration, conversation_id,
        conversation_transport, conversation_topology, revision,
        created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.externalThreadId},
        ${`external_thread_key:db003-occ-${fixture.label}-${runId}`},
        'canonical', 'module:synthetic-source:thread-realm', 'v1', 'v1',
        'source_account', ${fixture.accountId}, ${fixture.accountId},
        'module:synthetic-source:group-thread',
        ${`ProviderGroup:${fixture.label}`}, ${threadDeclaration}::jsonb,
        ${fixture.conversationId}, 'external', 'group', 1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_bindings (
        tenant_id, id, external_thread_id, source_connection_id,
        source_account_id, created_at
      ) values (
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, ${baseAt}
      )
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_heads (
        tenant_id, binding_id, external_thread_id, source_connection_id,
        source_account_id, account_identity_revision, account_generation,
        account_identity_state, account_canonical_key_digest_sha256,
        account_identity_trusted_service_id, account_verified_at,
        account_verification_evidence_set_id, binding_generation,
        current_remote_access_episode_id, current_remote_access_episode_revision,
        remote_access_state, remote_access_evidence_authority,
        remote_access_revision, remote_access_since, remote_access_evidence_set_id,
        administrative_state, administrative_revision,
        administrative_changed_at, runtime_health_state,
        runtime_health_revision, runtime_health_checked_at,
        history_sync_state, history_sync_revision, history_updated_at,
        provider_access_revision, provider_role_count,
        provider_roles_digest_sha256, provider_access_evidence_set_id,
        provider_access_observed_at, capability_contract_id,
        capability_contract_version, capability_declaration_revision,
        capability_surface_id, capability_loaded_by_trusted_service_id,
        capability_loaded_at, capability_revision, capability_entry_count,
        capability_semantic_digest_sha256, capability_captured_at,
        route_contract_id, route_contract_version, route_declaration_revision,
        route_surface_id, route_loaded_by_trusted_service_id, route_loaded_at,
        route_descriptor_schema_id, route_descriptor_version,
        route_descriptor_revision, route_destination_kind_id,
        route_destination_subject, route_descriptor_digest_sha256,
        route_attribute_count, route_attributes_digest_sha256,
        revision, created_at, updated_at
      )
      select
        ${fixture.tenantId}, ${fixture.bindingId}, ${fixture.externalThreadId},
        ${fixture.connectionId}, ${fixture.accountId}, 1, 1, 'verified',
        identity_row.canonical_key_digest_sha256, 'core:source-runtime',
        ${baseAt}, ${`source_thread_binding_evidence_set:account-${fixture.label}-${runId}`},
        1, ${fixture.episodeId}, 1, 'active', 'direct_observation', 1,
        ${baseAt}, ${`source_thread_binding_evidence_set:remote-${fixture.label}-${runId}`},
        'enabled', 1, ${baseAt}, 'ready', 1, ${baseAt},
        'unsupported', 1, ${baseAt}, 1, 0, ${"0".repeat(64)},
        ${`source_thread_binding_evidence_set:provider-${fixture.label}-${runId}`},
        ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt}, 1, 0,
        ${"1".repeat(64)}, ${baseAt}, ${adapterContract.contractId},
        ${adapterContract.contractVersion}, 1, ${adapterContract.surfaceId},
        ${adapterContract.loadedByTrustedServiceId}, ${baseAt},
        'module:synthetic-source:group-route', 'v1', 1,
        'module:synthetic-source:group-peer',
        ${`ProviderGroup:${fixture.label}`}, ${"2".repeat(64)}, 0,
        ${"3".repeat(64)}, 1, ${baseAt}, ${baseAt}
      from inbox_v2_source_account_identities identity_row
      where identity_row.tenant_id = ${fixture.tenantId}
        and identity_row.source_account_id = ${fixture.accountId}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_thread_binding_snapshots
      select (jsonb_populate_record(
        null::inbox_v2_source_thread_binding_snapshots,
        to_jsonb(head_row) || jsonb_build_object(
          'transition_id', null,
          'expected_binding_revision', null
        )
      )).*
      from inbox_v2_source_thread_binding_heads head_row
      where head_row.tenant_id = ${fixture.tenantId}
        and head_row.binding_id = ${fixture.bindingId}
    `);
    await transaction.execute(sql`
      insert into inbox_v2_source_external_identities (
        tenant_id, id, realm_id, realm_version, canonicalization_version,
        object_kind_id, scope_kind, scope_source_account_id,
        identity_declaration, declaration_contract_id,
        declaration_contract_version, declaration_revision,
        declaration_surface_id, declaration_loaded_by_trusted_service_id,
        declaration_loaded_at, materialized_by_trusted_service_id,
        materialization_authorization_token, materialized_at,
        canonical_external_subject,
        stability_kind, ephemeral_raw_inbound_event_id,
        ephemeral_normalized_inbound_event_id, ephemeral_observation_key,
        revision, created_at, updated_at
      ) values (
        ${fixture.tenantId}, ${fixture.actorId},
        'module:synthetic-source:actor-realm', 'v1', 'v1',
        'module:synthetic-source:provider-user',
        ${actorScope},
        ${actorScope === "source_account" ? fixture.accountId : null},
        ${actorIdentityDeclaration},
        ${actorAdapterContract.contractId},
        ${actorAdapterContract.contractVersion},
        ${actorAdapterContract.declarationRevision},
        ${actorAdapterContract.surfaceId},
        ${actorAdapterContract.loadedByTrustedServiceId},
        ${actorAdapterContract.loadedAt},
        ${actorAdapterContract.loadedByTrustedServiceId},
        ${`identity-materialize:${fixture.label}:${runId}`}, ${baseAt},
        ${`ProviderActor:${fixture.label}`},
        ${actorStability === "stable" ? "stable" : "observation_ephemeral"},
        ${actorStability === "ephemeral_raw" ? fixture.rawId : null},
        ${
          actorStability === "ephemeral_normalized"
            ? fixture.normalizedId
            : null
        },
        ${actorStability === "stable" ? null : `actor:${fixture.label}`},
        1, ${baseAt}, ${baseAt}
      )
    `);
    await transaction.execute(sql`set local session_replication_role = origin`);
  });
}

async function seedEventPair(
  executor: { execute(query: SQL): Promise<unknown> },
  fixture: Fixture,
  input: Readonly<{
    rawId: string;
    normalizedId: string;
    accountId: string;
    suffix: string;
  }>
): Promise<void> {
  await executor.execute(sql`
    insert into raw_inbound_events (
      id, tenant_id, source_connection_id, source_account_id,
      idempotency_key, received_at, payload, headers,
      processing_status, created_at, updated_at
    ) values (
      ${input.rawId}, ${fixture.tenantId}, ${fixture.connectionId},
      ${input.accountId}, ${`raw:${fixture.label}:${input.suffix}:${runId}`},
      ${evidenceAt}, '{}'::jsonb, '{}'::jsonb, 'processed',
      ${evidenceAt}, ${evidenceAt}
    )
  `);
  await executor.execute(sql`
    insert into normalized_inbound_events (
      id, tenant_id, raw_event_id, source_connection_id, source_account_id,
      source_type, source_name, event_type, direction, visibility,
      payload_version, normalized_payload, reply_capability,
      idempotency_key, processing_status, created_at, updated_at
    ) values (
      ${input.normalizedId}, ${fixture.tenantId}, ${input.rawId},
      ${fixture.connectionId}, ${input.accountId}, 'messenger', 'synthetic',
      'message', 'inbound', 'private', 'v1', '{}'::jsonb, '{}'::jsonb,
      ${`normalized:${fixture.label}:${input.suffix}:${runId}`}, 'processed',
      ${evidenceAt}, ${evidenceAt}
    )
  `);
}

async function persistedChildren(
  db: HuleeDatabase,
  tenantId: InboxV2TenantId,
  sourceOccurrenceId: string
): Promise<{
  references: Array<{ ordinal: number; kind_id: string; subject: string }>;
  timestamps: Array<{
    ordinal: number;
    kind_id: string;
    provider_timestamp: string;
  }>;
}> {
  const [references, timestamps] = await Promise.all([
    db.execute<{ ordinal: number; kind_id: string; subject: string }>(sql`
      select ordinal, kind_id, subject
      from inbox_v2_source_occurrence_provider_references
      where tenant_id = ${tenantId}
        and source_occurrence_id = ${sourceOccurrenceId}
      order by ordinal
    `),
    db.execute<{
      ordinal: number;
      kind_id: string;
      provider_timestamp: unknown;
    }>(sql`
      select ordinal, kind_id, timestamp as provider_timestamp
      from inbox_v2_source_occurrence_provider_timestamps
      where tenant_id = ${tenantId}
        and source_occurrence_id = ${sourceOccurrenceId}
      order by ordinal
    `)
  ]);
  return {
    references: references.rows.map((row) => ({
      ordinal: Number(row.ordinal),
      kind_id: row.kind_id,
      subject: row.subject
    })),
    timestamps: timestamps.rows.map((row) => ({
      ordinal: Number(row.ordinal),
      kind_id: row.kind_id,
      provider_timestamp: databaseTimestamp(row.provider_timestamp)
    }))
  };
}

function cloneOccurrenceWithoutChildrenSql(input: {
  tenantId: string;
  sourceOccurrenceId: string;
  forgedOccurrenceId: string;
}): string {
  for (const value of Object.values(input)) {
    if (!/^[A-Za-z0-9._~:-]+$/u.test(value)) {
      throw new Error("Unsafe direct-DML fixture identifier.");
    }
  }
  return String.raw`
    do $fixture$
    declare
      insert_columns text;
      select_columns text;
    begin
      select
        string_agg(format('%I', column_name), ', ' order by ordinal_position),
        string_agg(
          case
            when column_name = 'id' then format('%L::text', '${input.forgedOccurrenceId}')
            else format('source_row.%I', column_name)
          end,
          ', ' order by ordinal_position
        )
      into insert_columns, select_columns
      from information_schema.columns
      where table_schema = 'public'
        and table_name = 'inbox_v2_source_occurrences'
        and is_generated = 'NEVER';

      execute format(
        'insert into public.inbox_v2_source_occurrences (%s) ' ||
        'select %s from public.inbox_v2_source_occurrences source_row ' ||
        'where source_row.tenant_id = %L and source_row.id = %L',
        insert_columns,
        select_columns,
        '${input.tenantId}',
        '${input.sourceOccurrenceId}'
      );
    end
    $fixture$;
  `;
}

class BindingShareLockGateExecutor implements InboxV2SourceOccurrenceTransactionExecutor {
  private holderPid: number | null = null;
  private readonly bindingLocked: Promise<void>;
  private markBindingLocked = (): void => undefined;
  private readonly released: Promise<void>;
  private markReleased = (): void => undefined;

  constructor(private readonly db: HuleeDatabase) {
    this.bindingLocked = new Promise<void>((resolve) => {
      this.markBindingLocked = resolve;
    });
    this.released = new Promise<void>((resolve) => {
      this.markReleased = resolve;
    });
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const result = await this.db.execute<Row>(query);
    return { rows: result.rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult> {
    return this.db.transaction(async (transaction) => {
      return work({
        execute: async <Row extends Record<string, unknown>>(
          query: SQL
        ): Promise<RawSqlQueryResult<Row>> => {
          const result = await transaction.execute<Row>(query);
          if (isBindingShareLock(query)) {
            const pidResult = await transaction.execute<{ pid: number }>(
              sql`select pg_backend_pid() as pid`
            );
            const pid = Number(pidResult.rows[0]?.pid);
            if (!Number.isSafeInteger(pid) || pid <= 0) {
              throw new Error(
                "Expected binding-locking PostgreSQL backend PID."
              );
            }
            this.holderPid = pid;
            this.markBindingLocked();
            await this.released;
          }
          return { rows: result.rows as readonly Row[] };
        }
      });
    }, config);
  }

  async waitUntilBindingLocked(): Promise<number> {
    await Promise.race([
      this.bindingLocked,
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("Timed out waiting for binding SHARE lock.")),
          5_000
        );
      })
    ]);
    if (this.holderPid === null) {
      throw new Error(
        "Binding lock opened without its PostgreSQL backend PID."
      );
    }
    return this.holderPid;
  }

  release(): void {
    this.markReleased();
  }
}

function isBindingShareLock(query: SQL): boolean {
  const rendered = new PgDialect()
    .sqlToQuery(query)
    .sql.replaceAll('"', "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  return (
    rendered.includes("with head as materialized") &&
    rendered.includes("from inbox_v2_source_thread_binding_heads candidate") &&
    rendered.includes(
      "join inbox_v2_source_thread_binding_snapshots snapshot"
    ) &&
    rendered.includes("for share of snapshot")
  );
}

async function waitForTransactionBlockedBy(
  db: HuleeDatabase,
  holderPid: number,
  waiterPid: number
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await db.execute<{ waiting: boolean }>(sql`
      select exists (
        select 1
        from pg_catalog.pg_locks holder_lock
        join pg_catalog.pg_locks waiter_lock
          on waiter_lock.locktype = 'transactionid'
         and waiter_lock.transactionid = holder_lock.transactionid
         and not waiter_lock.granted
        where holder_lock.pid = ${holderPid}
          and waiter_lock.pid = ${waiterPid}
          and holder_lock.locktype = 'transactionid'
          and holder_lock.granted
      ) as waiting
    `);
    if (result.rows[0]?.waiting === true) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    "Timed out waiting for binding writer to block on the fence."
  );
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
} {
  let resolve = (_value: T | PromiseLike<T>): void => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function expectDatabaseFailure(
  operation: Promise<unknown>,
  expected: RegExp
): Promise<void> {
  try {
    await operation;
  } catch (error) {
    expect(errorChainMessages(error)).toMatch(expected);
    return;
  }
  throw new Error(`Expected PostgreSQL operation to fail with ${expected}.`);
}

function errorChainMessages(error: unknown): string {
  const messages: string[] = [];
  const visited = new Set<object>();
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (visited.has(current)) break;
    visited.add(current);
    if ("message" in current && typeof current.message === "string") {
      messages.push(current.message);
    }
    current = "cause" in current ? current.cause : null;
  }
  return messages.join("\n");
}

function databaseTimestamp(value: unknown): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new Error("Expected a PostgreSQL timestamp.");
  }
  return date.toISOString();
}
