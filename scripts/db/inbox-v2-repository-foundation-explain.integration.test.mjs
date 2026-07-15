import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationJournal } from "../checks/db-check-lib.mjs";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const finalizedMarker = "INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1";
const tenantId = "tenant:db007-explain";
const streamEpoch = "stream-epoch:db007-explain";
const projectionId = "core:conversation-inbox";
const actorOrgUnitId = "org-unit:db007-explain";
const actorEmployeeId = "employee:db007-explain";
const dataClassId = "core:message_content_blocks";
const storageRootId = "core:timeline_content";

describePostgres(
  "Inbox V2 repository-foundation 0036 representative PostgreSQL access plans",
  () => {
    let adminClient;
    let databaseName;
    let databaseUrl;
    let migrationsDirectory;
    let temporaryRoot;

    beforeAll(async () => {
      const adminDatabaseUrl = process.env.DATABASE_URL;
      if (!adminDatabaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-007 EXPLAIN verification."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db007-explain-"));
      migrationsDirectory = await prepareMigrationDirectory(temporaryRoot, 36);
      const migrationFiles = await migrationFilesAtIndex(
        migrationsDirectory,
        36
      );
      expect(migrationFiles).toHaveLength(1);
      await expect(
        readFile(join(migrationsDirectory, migrationFiles[0]), "utf8")
      ).resolves.toContain(finalizedMarker);

      adminClient = new pg.Client({ connectionString: adminDatabaseUrl });
      await adminClient.connect();
      databaseName = `hulee_db007_explain_${process.pid}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      const targetUrl = new URL(adminDatabaseUrl);
      targetUrl.pathname = `/${databaseName}`;
      databaseUrl = targetUrl.toString();

      await applyMigrations(databaseUrl, migrationsDirectory);
      await withClient(databaseUrl, seedRepresentativeRows);
    }, 180_000);

    afterAll(async () => {
      if (adminClient) {
        if (databaseName) {
          await adminClient
            .query(
              `select pg_terminate_backend(pid)
                 from pg_catalog.pg_stat_activity
                where datname = $1 and pid <> pg_backend_pid()`,
              [databaseName]
            )
            .catch(() => {});
          await adminClient
            .query(`drop database if exists ${quoteDatabaseName(databaseName)}`)
            .catch(() => {});
        }
        await adminClient.end().catch(() => {});
      }
      if (temporaryRoot) {
        await rm(temporaryRoot, { recursive: true, force: true });
      }
    }, 60_000);

    it("uses tenant-leading indexes and evaluates actor visibility below LIMIT", async () => {
      await withClient(databaseUrl, async (client) => {
        await client.query(`
          set enable_seqscan = off;
          set jit = off;
          set max_parallel_workers_per_gather = 0;
        `);

        const cases = representativePlans();
        const observed = {};
        for (const planCase of cases) {
          const envelope = await explainAnalyze(client, planCase);
          const plan = envelope.Plan;
          expect(plan).toBeTruthy();
          const nodes = flattenPlan(plan);
          const indexNames = nodes
            .map((node) => node["Index Name"])
            .filter((value) => typeof value === "string");
          expect(
            planCase.expectedIndexes.some((indexName) =>
              indexNames.includes(indexName)
            ),
            `${planCase.name} indexes: ${indexNames.join(", ")}`
          ).toBe(true);
          expect(
            planConditionText(nodes),
            `${planCase.name} tenant predicate`
          ).toContain("tenant_id");
          expect(
            planConditionText(nodes),
            `${planCase.name} tenant value`
          ).toContain(tenantId);
          expect(
            nodes.some((node) =>
              Object.prototype.hasOwnProperty.call(node, "Shared Hit Blocks")
            ),
            `${planCase.name} BUFFERS evidence`
          ).toBe(true);

          if (planCase.name === "actor_visible_conversations") {
            expect(plan["Node Type"]).toBe("Limit");
            const accessNode = nodes.find(
              (node) => node["Index Name"] === planCase.expectedIndexes.at(0)
            );
            expect(accessNode?.["Actual Loops"]).toBe(1);
          }

          observed[planCase.name] = {
            root: plan["Node Type"],
            indexes: [...new Set(indexNames)].sort()
          };
        }

        expect(Object.keys(observed)).toEqual([
          "tenant_stream_replay",
          "projection_checkpoint_catchup",
          "outbox_due",
          "outbox_reclaim",
          "actor_visible_conversations",
          "active_assignment",
          "retention_eligible",
          "active_legal_hold",
          "external_thread_lookup"
        ]);
        if (process.env.HULEE_DB_EXPLAIN_REPORT === "1") {
          console.info(
            `DB-007 EXPLAIN summary:\n${JSON.stringify(observed, null, 2)}`
          );
        }
      });
    }, 120_000);
  }
);

function representativePlans() {
  return [
    {
      name: "tenant_stream_replay",
      expectedIndexes: ["inbox_v2_tenant_stream_commits_position_unique"],
      params: [tenantId, streamEpoch, "120", "180"],
      sql: `
        select tenant_id, id, position
          from public.inbox_v2_tenant_stream_commits
         where tenant_id = $1
           and stream_epoch = $2
           and position > $3::bigint
           and position <= $4::bigint
         order by tenant_id, stream_epoch, position
         limit 51
      `
    },
    {
      name: "projection_checkpoint_catchup",
      expectedIndexes: ["inbox_v2_projection_checkpoints_catchup_idx"],
      params: [tenantId, projectionId, "200"],
      sql: `
        select tenant_id, projection_id, scope_id, generation, position
          from public.inbox_v2_projection_checkpoints
         where tenant_id = $1
           and projection_id = $2
           and position < $3::bigint
         order by position, scope_id, generation
         limit 32
      `
    },
    {
      name: "outbox_due",
      expectedIndexes: ["inbox_v2_outbox_work_items_due_idx"],
      params: [tenantId],
      sql: `
        select tenant_id, intent_id, available_at
          from public.inbox_v2_outbox_work_items
         where tenant_id = $1
           and state = 'pending'
           and available_at <= clock_timestamp()
         order by available_at, intent_id
         limit 32
      `
    },
    {
      name: "outbox_reclaim",
      expectedIndexes: ["inbox_v2_outbox_work_items_reclaim_idx"],
      params: [tenantId],
      sql: `
        select tenant_id, intent_id, lease_expires_at
          from public.inbox_v2_outbox_work_items
         where tenant_id = $1
           and state = 'leased'
           and lease_expires_at <= clock_timestamp()
         order by lease_expires_at, intent_id
         limit 32
      `
    },
    {
      name: "actor_visible_conversations",
      expectedIndexes: [
        "inbox_v2_auth_structural_heads_conversation_org_actor_idx"
      ],
      params: [tenantId, actorOrgUnitId],
      sql: `
        with authorized_conversations as materialized (
          select structural.conversation_id
            from public.inbox_v2_auth_structural_access_heads structural
           where structural.tenant_id = $1
             and structural.resource_kind = 'conversation'
             and structural.target_kind = 'org_unit'
             and structural.current_state = 'active'
             and structural.target_org_unit_id = $2
        )
        select head.tenant_id,
               head.conversation_id,
               head.latest_activity_at
          from authorized_conversations access
          join public.inbox_v2_conversation_heads head
            on head.tenant_id = $1
           and head.conversation_id = access.conversation_id
          join public.inbox_v2_conversations conversation
            on conversation.tenant_id = head.tenant_id
           and conversation.id = head.conversation_id
         where conversation.transport = 'external'
         order by head.latest_activity_at desc nulls last,
                  head.conversation_id
         limit 50
      `
    },
    {
      name: "active_assignment",
      expectedIndexes: [
        "inbox_v2_work_item_primary_assignment_employee_active_idx"
      ],
      params: [tenantId, actorEmployeeId],
      sql: `
        select tenant_id, employee_id, work_item_id, id
          from public.inbox_v2_work_item_primary_assignments
         where tenant_id = $1
           and employee_id = $2
           and state = 'active'
         order by work_item_id, id
         limit 32
      `
    },
    {
      name: "retention_eligible",
      expectedIndexes: [
        "inbox_v2_timeline_contents_retention_eligible_idx",
        "inbox_v2_timeline_contents_retention_idx"
      ],
      params: [tenantId, dataClassId],
      sql: `
        select tenant_id, data_class_id, retention_anchor_at, id
          from public.inbox_v2_timeline_contents
         where tenant_id = $1
           and data_class_id = $2
           and state = 'available'
           and retention_anchor_at <= clock_timestamp()
         order by retention_anchor_at, id
         limit 32
      `
    },
    {
      name: "active_legal_hold",
      expectedIndexes: ["inbox_v2_dg_hold_active_root_lookup_idx"],
      params: [tenantId, storageRootId, "timeline-content:0128"],
      sql: `
        select tenant_id, hold_id, hold_revision, root_record_id
          from public.inbox_v2_data_governance_legal_hold_targets
         where tenant_id = $1
           and storage_root_id = $2
           and root_record_id = $3
           and state = 'active'
         order by hold_id, hold_revision
         limit 16
      `
    },
    {
      name: "external_thread_lookup",
      expectedIndexes: [
        "inbox_v2_external_threads_pk",
        "inbox_v2_external_threads_target_revision_unique"
      ],
      params: [tenantId, "external_thread:db007-explain-0128"],
      sql: `
        select thread_row.tenant_id,
               thread_row.id,
               registry_row.id as registry_id,
               conversation.id as conversation_id,
               head.latest_timeline_sequence
          from public.inbox_v2_external_threads thread_row
          left join public.inbox_v2_external_thread_key_registry registry_row
            on registry_row.tenant_id = thread_row.tenant_id
           and registry_row.id = thread_row.key_registry_id
          left join public.inbox_v2_conversations conversation
            on conversation.tenant_id = thread_row.tenant_id
           and conversation.id = thread_row.conversation_id
          left join public.inbox_v2_conversation_heads head
            on head.tenant_id = conversation.tenant_id
           and head.conversation_id = conversation.id
         where thread_row.tenant_id = $1
           and thread_row.id = $2
      `
    }
  ];
}

async function explainAnalyze(client, planCase) {
  const result = await client.query(
    `explain (analyze, buffers, format json) ${planCase.sql}`,
    planCase.params
  );
  const document = result.rows[0]?.["QUERY PLAN"];
  expect(Array.isArray(document), `${planCase.name} JSON document`).toBe(true);
  expect(document).toHaveLength(1);
  return document[0];
}

function flattenPlan(plan) {
  const nodes = [plan];
  for (const child of plan.Plans ?? []) {
    nodes.push(...flattenPlan(child));
  }
  return nodes;
}

function planConditionText(nodes) {
  return nodes
    .flatMap((node) => [
      node["Index Cond"],
      node["Recheck Cond"],
      node.Filter,
      node["Hash Cond"],
      node["Join Filter"]
    ])
    .filter((value) => typeof value === "string")
    .join("\n");
}

async function seedRepresentativeRows(client) {
  await client.query("begin");
  try {
    await client.query("set local session_replication_role = replica");
    await client.query(`
      insert into public.tenants (id, slug, display_name)
      values ('${tenantId}', 'db007-explain', 'DB-007 EXPLAIN');

      insert into public.inbox_v2_tenant_stream_commits (
        tenant_id, id, mutation_id, stream_epoch, position,
        previous_position, schema_version, correlation_id, command_ids,
        client_mutation_ids, authorization_decision_refs, change_ids,
        event_ids, outbox_intent_ids, audience_impact_kind,
        audience_impact_manifest, change_count, event_count,
        outbox_intent_count, manifest_digest_sha256, commit_hash,
        committed_at, created_at
      )
      select '${tenantId}',
             'stream-commit:db007-' || lpad(series::text, 4, '0'),
             'mutation:db007-' || lpad(series::text, 4, '0'),
             '${streamEpoch}',
             series,
             series - 1,
             'v1',
             'correlation:db007-' || series,
             '[]'::jsonb,
             '[]'::jsonb,
             '[]'::jsonb,
             jsonb_build_array('change:db007-' || series),
             jsonb_build_array('event:db007-' || series),
             '[]'::jsonb,
             'none',
             '{"kind":"none"}'::jsonb,
             1,
             1,
             0,
             'sha256:' || lpad(to_hex(series), 64, '0'),
             'sha256:' || lpad(to_hex(series + 4096), 64, '0'),
             '2026-01-01T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             '2026-01-01T00:00:00Z'::timestamptz
               + make_interval(secs => series)
        from generate_series(1, 512) series;

      insert into public.inbox_v2_projection_generations (
        tenant_id, projection_id, scope_id, generation, stream_epoch,
        projection_schema_version, state, min_retained_position, revision,
        created_at, activated_at, retired_at, updated_at
      )
      select '${tenantId}',
             '${projectionId}',
             'scope:db007-' || lpad(series::text, 4, '0'),
             1,
             '${streamEpoch}',
             'v1',
             'shadow',
             0,
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             null,
             null,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_projection_checkpoints (
        tenant_id, projection_id, scope_id, generation, stream_epoch,
        position, last_commit_id, revision, created_at, updated_at
      )
      select '${tenantId}',
             '${projectionId}',
             'scope:db007-' || lpad(series::text, 4, '0'),
             1,
             '${streamEpoch}',
             series,
             'stream-commit:db007-' || lpad(series::text, 4, '0'),
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_outbox_work_items (
        tenant_id, intent_id, state, attempt_count, available_at,
        revision, created_at, updated_at
      )
      select '${tenantId}',
             'outbox-intent:pending-' || lpad(series::text, 4, '0'),
             'pending',
             0,
             '2025-12-01T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             1,
             '2025-11-01T00:00:00Z'::timestamptz,
             '2025-11-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_outbox_work_items (
        tenant_id, intent_id, state, attempt_count, available_at,
        lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
        lease_expires_at, revision, created_at, updated_at
      )
      select '${tenantId}',
             'outbox-intent:leased-' || lpad(series::text, 4, '0'),
             'leased',
             1,
             '2025-12-01T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             'worker:db007',
             'sha256:' || lpad(to_hex(series + 8192), 64, '0'),
             1,
             '2025-12-02T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             '2025-12-03T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             2,
             '2025-11-01T00:00:00Z'::timestamptz,
             '2025-12-02T00:00:00Z'::timestamptz
               + make_interval(secs => series)
        from generate_series(1, 512) series;

      insert into public.inbox_v2_conversations (
        tenant_id, id, topology, transport, purpose_id, lifecycle,
        revision, last_changed_stream_position, created_at, updated_at
      )
      select '${tenantId}',
             'conversation:db007-explain-' || lpad(series::text, 4, '0'),
             'direct',
             'external',
             'core:chat',
             'active',
             1,
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_conversation_heads (
        tenant_id, conversation_id, latest_timeline_sequence,
        latest_activity_item_id, latest_activity_timeline_sequence,
        latest_activity_at, revision, last_changed_stream_position,
        created_at, updated_at
      )
      select '${tenantId}',
             'conversation:db007-explain-' || lpad(series::text, 4, '0'),
             1,
             'timeline_item:db007-explain-' || lpad(series::text, 4, '0'),
             1,
             '2026-01-02T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             1,
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-02T00:00:00Z'::timestamptz
               + make_interval(secs => series)
        from generate_series(1, 512) series;

      insert into public.inbox_v2_auth_structural_access_heads (
        tenant_id, binding_id, resource_head_id, resource_kind,
        conversation_id, client_id, source_account_id, target_kind,
        target_org_unit_id, target_team_id, current_state, current_revision,
        created_at, updated_at
      )
      select '${tenantId}',
             'structural-binding:db007-' || lpad(series::text, 4, '0'),
             'resource-head:db007-' || lpad(series::text, 4, '0'),
             'conversation',
             'conversation:db007-explain-' || lpad(series::text, 4, '0'),
             null,
             null,
             'org_unit',
             case
               when series = 128 then '${actorOrgUnitId}'
               else 'org-unit:decoy-' || lpad(series::text, 4, '0')
             end,
             null,
             'active',
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_work_item_primary_assignments (
        tenant_id, id, work_item_id, queue_at_start_id,
        queue_at_start_revision, employee_id, source,
        eligibility_decision_id, employee_fence_generation_at_start,
        started_at, started_actor_kind, started_actor_employee_id,
        started_actor_authorization_epoch, started_actor_trusted_service_id,
        start_reason_id, state, revision, created_at, updated_at
      )
      select '${tenantId}',
             'assignment:db007-' || lpad(series::text, 4, '0'),
             'work-item:db007-' || lpad(series::text, 4, '0'),
             'queue:db007',
             1,
             '${actorEmployeeId}',
             'manual_assignment',
             'eligibility:db007-' || lpad(series::text, 4, '0'),
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             'trusted_service',
             null,
             null,
             'core:explain-verifier',
             'core:explain-seed',
             'active',
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_timeline_contents (
        tenant_id, id, owner_kind, owner_id, data_class_id,
        processing_purpose_id, retention_anchor_at, state,
        content_digest_sha256, state_changed_at, revision,
        last_changed_stream_position, created_at, updated_at
      )
      select '${tenantId}',
             'timeline_content:eligible-' || lpad(series::text, 4, '0'),
             'message',
             'message:eligible-' || lpad(series::text, 4, '0'),
             '${dataClassId}',
             'core:customer_communication',
             '2025-01-01T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             'available',
             lpad(to_hex(series), 64, '0'),
             '2025-01-01T00:00:00Z'::timestamptz,
             1,
             1,
             '2025-01-01T00:00:00Z'::timestamptz,
             '2025-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;

      insert into public.inbox_v2_timeline_contents (
        tenant_id, id, owner_kind, owner_id, data_class_id,
        processing_purpose_id, retention_anchor_at, state,
        content_digest_sha256, tombstone_event_id, tombstone_reason_id,
        state_changed_at, revision, last_changed_stream_position,
        created_at, updated_at
      )
      select '${tenantId}',
             'timeline_content:erased-' || lpad(series::text, 5, '0'),
             'message',
             'message:erased-' || lpad(series::text, 5, '0'),
             '${dataClassId}',
             'core:customer_communication',
             '2025-01-01T00:00:00Z'::timestamptz
               + make_interval(secs => series),
             'privacy_erased',
             null,
             'event:erased-' || lpad(series::text, 5, '0'),
             'core:privacy-erasure',
             '2025-02-01T00:00:00Z'::timestamptz,
             2,
             2,
             '2025-01-01T00:00:00Z'::timestamptz,
             '2025-02-01T00:00:00Z'::timestamptz
        from generate_series(1, 4096) series;

      insert into public.inbox_v2_data_governance_legal_hold_targets (
        tenant_id, hold_id, hold_revision, state, scope_manifest_id,
        scope_manifest_revision, storage_root_id, root_record_id,
        entity_type_id, entity_id, expected_entity_revision,
        expected_lineage_revision
      )
      select '${tenantId}',
             'hold:db007-' || lpad(series::text, 4, '0'),
             1,
             'active',
             'manifest:db007-' || lpad(series::text, 4, '0'),
             1,
             '${storageRootId}',
             'timeline-content:' || lpad(series::text, 4, '0'),
             'core:timeline_content',
             'timeline-content:' || lpad(series::text, 4, '0'),
             1,
             1
        from generate_series(1, 512) series;

      insert into public.inbox_v2_external_threads (
        tenant_id, id, key_registry_id, key_registry_entry_kind,
        realm_id, realm_version, canonicalization_version, scope_kind,
        scope_source_connection_id, scope_source_account_id, scope_owner_key,
        object_kind_id, canonical_external_subject, identity_declaration,
        conversation_id, conversation_transport, conversation_topology,
        revision, created_at, updated_at
      )
      select '${tenantId}',
             'external_thread:db007-explain-' || lpad(series::text, 4, '0'),
             'external_thread_key:db007-' || lpad(series::text, 4, '0'),
             'canonical',
             'module:synthetic:thread-realm',
             'v1',
             'v1',
             'provider',
             null,
             null,
             'provider',
             'module:synthetic:group-room',
             'ProviderRoom:' || series,
             jsonb_build_object(
               'adapterContract', jsonb_build_object(
                 'contractId', 'module:synthetic:thread-contract',
                 'contractVersion', 'v1',
                 'declarationRevision', '1',
                 'surfaceId', 'module:synthetic:group-surface',
                 'loadedByTrustedServiceId', 'core:routing-resolver',
                 'loadedAt', '2025-12-31T23:59:00.000Z'
               ),
               'identityKind', 'external_thread',
               'realmId', 'module:synthetic:thread-realm',
               'realmVersion', 'v1',
               'canonicalizationVersion', 'v1',
               'objectKindId', 'module:synthetic:group-room',
               'scopeKind', 'provider',
               'decisionStrength', 'authoritative'
             ),
             'conversation:db007-explain-' || lpad(series::text, 4, '0'),
             'external',
             'direct',
             1,
             '2026-01-01T00:00:00Z'::timestamptz,
             '2026-01-01T00:00:00Z'::timestamptz
        from generate_series(1, 512) series;
    `);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }

  await client.query(`
    analyze public.inbox_v2_tenant_stream_commits;
    analyze public.inbox_v2_projection_checkpoints;
    analyze public.inbox_v2_outbox_work_items;
    analyze public.inbox_v2_conversations;
    analyze public.inbox_v2_conversation_heads;
    analyze public.inbox_v2_auth_structural_access_heads;
    analyze public.inbox_v2_work_item_primary_assignments;
    analyze public.inbox_v2_timeline_contents;
    analyze public.inbox_v2_data_governance_legal_hold_targets;
    analyze public.inbox_v2_external_threads;
  `);
}

async function prepareMigrationDirectory(temporaryRoot, boundaryIndex) {
  const directory = join(temporaryRoot, `through-${boundaryIndex}`);
  const metadataDirectory = join(directory, "meta");
  await mkdir(metadataDirectory, { recursive: true });
  const journal = JSON.parse(
    await readFile(
      join(checkedInMigrationsDirectory, "meta/_journal.json"),
      "utf8"
    )
  );
  const boundedJournal = migrationJournal(journal, boundaryIndex);
  await Promise.all([
    writeFile(
      join(metadataDirectory, "_journal.json"),
      `${JSON.stringify(boundedJournal, null, 2)}\n`,
      "utf8"
    ),
    ...boundedJournal.entries.map(({ tag }) =>
      copyFile(
        join(checkedInMigrationsDirectory, `${tag}.sql`),
        join(directory, `${tag}.sql`)
      )
    )
  ]);
  return directory;
}

async function migrationFilesAtIndex(directory, index) {
  const journal = JSON.parse(
    await readFile(join(directory, "meta/_journal.json"), "utf8")
  );
  return journal.entries
    .filter((entry) => entry.idx === index)
    .map((entry) => `${entry.tag}.sql`);
}

async function applyMigrations(databaseUrl, migrationsDirectory) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function withClient(databaseUrl, work) {
  const client = new pg.Client({ connectionString: databaseUrl });
  try {
    await client.connect();
    return await work(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function quoteDatabaseName(name) {
  if (!/^hulee_db007_explain_[0-9]+$/u.test(name)) {
    throw new Error(`Unsafe DB-007 EXPLAIN database name: ${name}`);
  }
  return `"${name}"`;
}
