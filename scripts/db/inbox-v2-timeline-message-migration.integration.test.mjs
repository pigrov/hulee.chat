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
const finalizedMarker = "INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1";

describePostgres(
  "Inbox V2 Timeline/Message 0031 PostgreSQL migration lifecycle",
  () => {
    let adminClient;
    let baseMigrationsDirectory;
    let targetMigrationsDirectory;
    let temporaryRoot;
    const createdDatabases = [];

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-005 migration lifecycle test."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db005-migrations-"));
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        30
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        31
      );
      const targetMigrationFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        31
      );
      expect(targetMigrationFiles).toHaveLength(1);
      await expect(
        readFile(
          join(targetMigrationsDirectory, targetMigrationFiles[0]),
          "utf8"
        )
      ).resolves.toContain(finalizedMarker);

      adminClient = new pg.Client({ connectionString: databaseUrl });
      await adminClient.connect();
    });

    afterAll(async () => {
      if (adminClient) {
        for (const databaseName of createdDatabases.reverse()) {
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
    });

    it("installs the finalized DB-005 schema on a fresh database", async () => {
      const databaseUrl = await createDatabase("fresh");
      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb005Installed(databaseUrl);
    }, 120_000);

    it("upgrades an empty finalized 0030 foundation to DB-005", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await withClient(databaseUrl, async (client) => {
        const before = await migrationState(client);
        expect(before).toMatchObject({
          timelineRows: "0",
          messageRows: "0",
          db005TableCount: "2",
          timelineSequenceColumn: false,
          timelineContentTable: null,
          outboundRouteConsumptionTable: null,
          providerSemanticOrderingHeadTable: null,
          transportFactCommitTable: null,
          receiptOpaquePayloadTable: null,
          filesTenantKey: false,
          eventStoreTenantKey: false
        });
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);
      await expectDb005Installed(databaseUrl);
    }, 120_000);

    it("rejects partial or populated anchors and leaves 0030 unchanged", async () => {
      const databaseUrl = await createDatabase("negative");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      let baseJournalCount;
      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(
          "create table public.inbox_v2_provider_semantic_ordering_heads (id text)"
        );
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.timeline_message_partial_schema_detected"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        const state = await migrationState(client);
        expect(state).toMatchObject({
          timelineSequenceColumn: false,
          timelineContentTable: null,
          db005TableCount: "3",
          outboundRouteConsumptionTable: null,
          providerSemanticOrderingHeadTable:
            "inbox_v2_provider_semantic_ordering_heads",
          transportFactCommitTable: null,
          receiptOpaquePayloadTable: null,
          filesTenantKey: false,
          eventStoreTenantKey: false
        });
        await client.query(
          "drop table public.inbox_v2_provider_semantic_ordering_heads"
        );
        await client.query(POPULATED_ANCHOR_FIXTURE_SQL);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.timeline_message_backfill_required"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        const state = await migrationState(client);
        expect(state).toMatchObject({
          timelineRows: "1",
          db005TableCount: "2",
          timelineSequenceColumn: false,
          timelineContentTable: null,
          outboundRouteConsumptionTable: null,
          providerSemanticOrderingHeadTable: null,
          transportFactCommitTable: null,
          receiptOpaquePayloadTable: null,
          filesTenantKey: false,
          eventStoreTenantKey: false
        });
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_db005_${label}_${process.pid}_${createdDatabases.length}`;
      await adminClient.query(
        `create database ${quoteDatabaseName(databaseName)}`
      );
      createdDatabases.push(databaseName);
      baseUrl.pathname = `/${databaseName}`;
      return baseUrl.toString();
    }

    async function expectMigrationFailure(databaseUrl, expectedMessage) {
      let migrationError;
      try {
        await applyMigrations(databaseUrl, targetMigrationsDirectory);
      } catch (error) {
        migrationError = error;
      }
      const databaseError = findDatabaseError(migrationError);
      expect(databaseError?.code).toBe("23514");
      expect(databaseError?.message).toBe(expectedMessage);
    }
  }
);

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

async function expectDb005Installed(databaseUrl) {
  await withClient(databaseUrl, async (client) => {
    const state = await migrationState(client);
    expect(state).toMatchObject({
      timelineRows: "0",
      messageRows: "0",
      db005TableCount: "31",
      timelineSequenceColumn: true,
      timelineContentTable: "inbox_v2_timeline_contents",
      outboundRouteConsumptionTable: "inbox_v2_outbound_route_consumptions",
      providerSemanticOrderingHeadTable:
        "inbox_v2_provider_semantic_ordering_heads",
      transportFactCommitTable: "inbox_v2_message_transport_fact_commits",
      receiptOpaquePayloadTable: "inbox_v2_provider_receipt_opaque_payloads",
      filesTenantKey: true,
      eventStoreTenantKey: true,
      requiredInvariantFunctionCount: String(
        REQUIRED_INVARIANT_FUNCTION_NAMES.length
      ),
      unsafeInvariantFunctionCount: "0",
      duplicateInvariantTriggerCount: "0",
      requiredRouteReceiptTriggerCount: "4",
      requiredJsonGuardTriggerCount: "8",
      requiredProviderSemanticTriggerCount: "5",
      providerSemanticHeadPrimaryKey: true,
      providerSemanticHeadFkCount: "5",
      providerSemanticBindingAccountFk: true,
      sourceThreadBindingOwnerAccountKey: true,
      providerSemanticConsumerIndexCount: "2",
      transportFactCommitPrimaryKey: true,
      transportFactChildFkCount: "2",
      transportFactCoherenceTriggerCount: "3",
      deferredContentConstraintCount: "2",
      receiptTenantCascade: true,
      receiptPayloadCascade: true,
      receiptPayloadDeleteTriggerCount: "0"
    });

    const jsonShapeProbe = await client.query(
      `
      select
        public.inbox_v2_tm_json_exact_keys(
          $1::jsonb,
          array['tenantId', 'kind', 'id'],
          array['tenantId', 'kind', 'id']
        ) as "acceptsExactShape",
        not public.inbox_v2_tm_json_exact_keys(
          $2::jsonb,
          array['tenantId', 'kind', 'id'],
          array['tenantId', 'kind', 'id']
        ) as "rejectsAdditionalKey",
        not public.inbox_v2_tm_json_string_fields(
          $3::jsonb,
          array['tenantId', 'kind', 'id']
        ) as "rejectsObjectScalarBypass",
        public.inbox_v2_tm_json_family_valid(
          'reference', $1::jsonb
        ) as "acceptsReferenceFamily",
        not public.inbox_v2_tm_json_family_valid(
          'reference', $3::jsonb
        ) as "rejectsInvalidReferenceFamily"
      `,
      [
        JSON.stringify({
          tenantId: "tenant:db005-probe",
          kind: "message",
          id: "message:db005-probe"
        }),
        JSON.stringify({
          tenantId: "tenant:db005-probe",
          kind: "message",
          id: "message:db005-probe",
          secret: "must-not-pass"
        }),
        JSON.stringify({
          tenantId: "tenant:db005-probe",
          kind: "message",
          id: { messageText: "must-not-pass" }
        })
      ]
    );
    expect(jsonShapeProbe.rows[0]).toEqual({
      acceptsExactShape: true,
      rejectsAdditionalKey: true,
      rejectsObjectScalarBypass: true,
      acceptsReferenceFamily: true,
      rejectsInvalidReferenceFamily: true
    });
  });
}

async function migrationState(client) {
  const result = await client.query(
    `
    select
      (select count(*)::text from public.inbox_v2_timeline_items)
        as "timelineRows",
      (select count(*)::text from public.inbox_v2_messages)
        as "messageRows",
      (
        select count(*)::text
          from pg_catalog.pg_class table_definition
          join pg_catalog.pg_namespace table_namespace
            on table_namespace.oid = table_definition.relnamespace
         where table_namespace.nspname = 'public'
           and table_definition.relkind = 'r'
           and table_definition.relname = any($1::text[])
      ) as "db005TableCount",
      exists (
        select 1
          from pg_catalog.pg_attribute column_definition
         where column_definition.attrelid =
           'public.inbox_v2_timeline_items'::regclass
           and column_definition.attname = 'timeline_sequence'
           and column_definition.attnum > 0
           and not column_definition.attisdropped
      ) as "timelineSequenceColumn",
      to_regclass('public.inbox_v2_timeline_contents')::text
        as "timelineContentTable",
      to_regclass('public.inbox_v2_outbound_route_consumptions')::text
        as "outboundRouteConsumptionTable",
      to_regclass('public.inbox_v2_provider_semantic_ordering_heads')::text
        as "providerSemanticOrderingHeadTable",
      to_regclass('public.inbox_v2_message_transport_fact_commits')::text
        as "transportFactCommitTable",
      to_regclass('public.inbox_v2_provider_receipt_opaque_payloads')::text
        as "receiptOpaquePayloadTable",
      exists (
        select 1 from pg_catalog.pg_constraint
         where conname = 'files_tenant_id_unique'
           and conrelid = 'public.files'::regclass
      ) as "filesTenantKey",
      exists (
        select 1 from pg_catalog.pg_constraint
         where conname = 'event_store_tenant_id_unique'
           and conrelid = 'public.event_store'::regclass
      ) as "eventStoreTenantKey",
      (
        select count(*)::text
          from pg_catalog.pg_proc function_definition
          join pg_catalog.pg_namespace function_namespace
            on function_namespace.oid = function_definition.pronamespace
         where function_namespace.nspname = 'public'
           and function_definition.proname = any($2::text[])
      ) as "requiredInvariantFunctionCount",
      (
        select count(*)::text
          from pg_catalog.pg_proc function_definition
          join pg_catalog.pg_namespace function_namespace
            on function_namespace.oid = function_definition.pronamespace
         where function_namespace.nspname = 'public'
           and function_definition.proname like 'inbox_v2_tm\\_%' escape '\\'
           and not coalesce(function_definition.proconfig, '{}'::text[])
             @> array['search_path=pg_catalog, public, pg_temp']::text[]
      ) as "unsafeInvariantFunctionCount",
      (
        select (count(*) - count(distinct trigger_definition.tgname))::text
          from pg_catalog.pg_trigger trigger_definition
          join pg_catalog.pg_class trigger_table
            on trigger_table.oid = trigger_definition.tgrelid
          join pg_catalog.pg_namespace trigger_namespace
            on trigger_namespace.oid = trigger_table.relnamespace
         where trigger_namespace.nspname = 'public'
           and trigger_definition.tgname like 'inbox_v2_tm\\_%' escape '\\'
           and not trigger_definition.tgisinternal
      ) as "duplicateInvariantTriggerCount",
      (
        select count(*)::text
          from pg_catalog.pg_trigger trigger_definition
          join pg_catalog.pg_class trigger_table
            on trigger_table.oid = trigger_definition.tgrelid
         where trigger_definition.tgname = any($3::text[])
           and trigger_table.relnamespace = 'public'::regnamespace
           and not trigger_definition.tgisinternal
      ) as "requiredRouteReceiptTriggerCount",
      (
        select count(*)::text
          from pg_catalog.pg_trigger trigger_definition
          join pg_catalog.pg_class trigger_table
            on trigger_table.oid = trigger_definition.tgrelid
         where trigger_definition.tgname = any($5::text[])
           and trigger_table.relnamespace = 'public'::regnamespace
           and not trigger_definition.tgisinternal
      ) as "requiredJsonGuardTriggerCount",
      (
        select count(*)::text
          from pg_catalog.pg_trigger trigger_definition
          join pg_catalog.pg_class trigger_table
            on trigger_table.oid = trigger_definition.tgrelid
         where trigger_definition.tgname = any($8::text[])
           and trigger_table.relnamespace = 'public'::regnamespace
           and not trigger_definition.tgisinternal
      ) as "requiredProviderSemanticTriggerCount",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_provider_semantic_ordering_heads_pk'
           and constraint_definition.conrelid =
             to_regclass('public.inbox_v2_provider_semantic_ordering_heads')
           and constraint_definition.contype = 'p'
      ) as "providerSemanticHeadPrimaryKey",
      (
        select count(*)::text
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname = any($9::text[])
           and constraint_definition.conrelid =
             to_regclass('public.inbox_v2_provider_semantic_ordering_heads')
           and constraint_definition.contype = 'f'
      ) as "providerSemanticHeadFkCount",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_provider_semantic_ordering_heads_binding_fk'
           and pg_catalog.pg_get_constraintdef(
             constraint_definition.oid, true
           ) = 'FOREIGN KEY (tenant_id, source_thread_binding_id, source_account_id) REFERENCES inbox_v2_source_thread_bindings(tenant_id, id, source_account_id)'
      ) as "providerSemanticBindingAccountFk",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_source_thread_bindings_owner_account_unique'
           and constraint_definition.conrelid =
             'public.inbox_v2_source_thread_bindings'::regclass
           and constraint_definition.contype = 'u'
      ) as "sourceThreadBindingOwnerAccountKey",
      (
        select count(*)::text
          from pg_catalog.pg_indexes index_definition
         where index_definition.schemaname = 'public'
           and index_definition.indexname = any(array[
             'inbox_v2_provider_lifecycle_semantic_consumer_idx',
             'inbox_v2_provider_reaction_semantic_consumer_idx'
           ]::text[])
      ) as "providerSemanticConsumerIndexCount",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_message_transport_fact_commits_pk'
           and constraint_definition.conrelid =
             to_regclass('public.inbox_v2_message_transport_fact_commits')
           and constraint_definition.contype = 'p'
      ) as "transportFactCommitPrimaryKey",
      (
        select count(*)::text
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname = any($6::text[])
           and constraint_definition.confrelid =
             to_regclass('public.inbox_v2_message_transport_fact_commits')
           and constraint_definition.contype = 'f'
           and constraint_definition.confdeltype = 'c'
      ) as "transportFactChildFkCount",
      (
        select count(*)::text
          from pg_catalog.pg_trigger trigger_definition
          join pg_catalog.pg_class trigger_table
            on trigger_table.oid = trigger_definition.tgrelid
         where trigger_definition.tgname = any($7::text[])
           and trigger_table.relnamespace = 'public'::regnamespace
           and trigger_definition.tgconstraint <> 0
           and not trigger_definition.tgisinternal
      ) as "transportFactCoherenceTriggerCount",
      (
        select count(*)::text
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname = any($4::text[])
           and constraint_definition.condeferrable
           and constraint_definition.condeferred
      ) as "deferredContentConstraintCount",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_provider_receipt_observations_tenant_fk'
           and constraint_definition.conrelid =
             to_regclass('public.inbox_v2_provider_receipt_observations')
           and constraint_definition.confdeltype = 'c'
      ) as "receiptTenantCascade",
      exists (
        select 1
          from pg_catalog.pg_constraint constraint_definition
         where constraint_definition.conname =
           'inbox_v2_provider_receipt_opaque_payloads_receipt_fk'
           and constraint_definition.conrelid =
             to_regclass('public.inbox_v2_provider_receipt_opaque_payloads')
           and constraint_definition.confdeltype = 'c'
      ) as "receiptPayloadCascade",
      (
        select count(*)::text
          from pg_catalog.pg_trigger trigger_definition
         where trigger_definition.tgrelid =
             to_regclass('public.inbox_v2_provider_receipt_opaque_payloads')
           and not trigger_definition.tgisinternal
           and pg_catalog.pg_get_triggerdef(trigger_definition.oid)
             ~* ' (BEFORE|AFTER) .*DELETE'
      ) as "receiptPayloadDeleteTriggerCount"
  `,
    [
      DB005_TABLE_NAMES,
      REQUIRED_INVARIANT_FUNCTION_NAMES,
      REQUIRED_ROUTE_RECEIPT_TRIGGER_NAMES,
      DEFERRED_CONTENT_CONSTRAINT_NAMES,
      REQUIRED_JSON_GUARD_TRIGGER_NAMES,
      TRANSPORT_FACT_CHILD_FK_NAMES,
      TRANSPORT_FACT_COHERENCE_TRIGGER_NAMES,
      REQUIRED_PROVIDER_SEMANTIC_TRIGGER_NAMES,
      PROVIDER_SEMANTIC_HEAD_FK_NAMES
    ]
  );
  return result.rows[0];
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return result.rows[0]?.count;
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

function findDatabaseError(error) {
  let current = error;
  for (let depth = 0; depth < 10 && current; depth += 1) {
    if (
      typeof current === "object" &&
      typeof current.code === "string" &&
      typeof current.message === "string"
    ) {
      return current;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = current.cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

function quoteDatabaseName(databaseName) {
  if (!/^hulee_db005_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-005 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}

const POPULATED_ANCHOR_FIXTURE_SQL = `
  insert into public.tenants (id, slug, display_name)
  values ('tenant:db005-negative', 'db005-negative', 'DB005 negative');

  insert into public.inbox_v2_conversations (
    tenant_id, id, topology, transport, purpose_id, lifecycle,
    revision, last_changed_stream_position, created_at, updated_at
  ) values (
    'tenant:db005-negative', 'conversation:db005-negative',
    'direct', 'external', 'core:support', 'active',
    1, 1, '2026-07-14 00:00:00+00', '2026-07-14 00:00:00+00'
  );

  insert into public.inbox_v2_conversation_membership_heads (
    tenant_id, conversation_id, membership_revision, created_at, updated_at
  ) values (
    'tenant:db005-negative', 'conversation:db005-negative', 0,
    '2026-07-14 00:00:00+00', '2026-07-14 00:00:00+00'
  );

  insert into public.inbox_v2_timeline_items (
    tenant_id, id, conversation_id, revision, created_at
  ) values (
    'tenant:db005-negative', 'timeline_item:db005-negative',
    'conversation:db005-negative', 1, '2026-07-14 00:00:00+00'
  );
`;

const DB005_TABLE_NAMES = [
  "inbox_v2_action_attributions",
  "inbox_v2_message_attachment_anchors",
  "inbox_v2_timeline_contents",
  "inbox_v2_timeline_content_revisions",
  "inbox_v2_timeline_content_payloads",
  "inbox_v2_timeline_content_contact_values",
  "inbox_v2_timeline_items",
  "inbox_v2_timeline_subject_details",
  "inbox_v2_messages",
  "inbox_v2_message_revisions",
  "inbox_v2_message_reference_contexts",
  "inbox_v2_message_reference_canonical_targets",
  "inbox_v2_message_reference_external_targets",
  "inbox_v2_message_reference_unresolved_targets",
  "inbox_v2_message_reference_unresolved_candidates",
  "inbox_v2_staff_notes",
  "inbox_v2_staff_note_revisions",
  "inbox_v2_message_transport_links",
  "inbox_v2_message_transport_link_heads",
  "inbox_v2_outbound_route_consumptions",
  "inbox_v2_message_provider_lifecycle_operations",
  "inbox_v2_message_provider_lifecycle_transitions",
  "inbox_v2_message_reactions",
  "inbox_v2_message_reaction_transitions",
  "inbox_v2_message_reaction_slot_heads",
  "inbox_v2_message_provider_reaction_observations",
  "inbox_v2_provider_semantic_ordering_heads",
  "inbox_v2_message_transport_fact_commits",
  "inbox_v2_message_delivery_observations",
  "inbox_v2_provider_receipt_observations",
  "inbox_v2_provider_receipt_opaque_payloads"
];

const REQUIRED_INVARIANT_FUNCTION_NAMES = [
  "inbox_v2_tm_append_only_guard",
  "inbox_v2_tm_json_string_fields",
  "inbox_v2_tm_json_exact_keys",
  "inbox_v2_tm_json_family_valid",
  "inbox_v2_tm_reaction_value_flat_valid",
  "inbox_v2_tm_reaction_transition_state_valid",
  "inbox_v2_tm_reaction_attribution_row_valid",
  "inbox_v2_tm_reaction_authority_flat_valid",
  "inbox_v2_tm_outbound_route_action_valid",
  "inbox_v2_tm_json_guard",
  "inbox_v2_tm_provider_lifecycle_history_valid",
  "inbox_v2_tm_transport_occurrence_link_valid",
  "inbox_v2_tm_provider_fact_semantic_proof_valid",
  "inbox_v2_tm_action_attribution_valid",
  "inbox_v2_tm_content_history_valid",
  "inbox_v2_tm_message_history_valid",
  "inbox_v2_tm_staff_note_history_valid",
  "inbox_v2_tm_aux_coherence",
  "inbox_v2_tm_payload_guard",
  "inbox_v2_tm_head_guard",
  "inbox_v2_tm_assert_reference_context",
  "inbox_v2_tm_core_coherence",
  "inbox_v2_tm_provider_semantic_head_guard",
  "inbox_v2_tm_provider_semantic_proof_scope_valid",
  "inbox_v2_tm_provider_semantic_consumer_count",
  "inbox_v2_tm_provider_semantic_head_consumer_guard",
  "inbox_v2_tm_provider_semantic_consumer_head_guard"
];

const REQUIRED_JSON_GUARD_TRIGGER_NAMES = [
  "inbox_v2_tm_provider_op_json_guard",
  "inbox_v2_tm_provider_transition_json_guard",
  "inbox_v2_tm_reaction_json_guard",
  "inbox_v2_tm_reaction_transition_json_guard",
  "inbox_v2_tm_reaction_observation_json_guard",
  "inbox_v2_tm_provider_semantic_json_guard",
  "inbox_v2_tm_delivery_json_guard",
  "inbox_v2_tm_receipt_json_guard"
];

const TRANSPORT_FACT_CHILD_FK_NAMES = [
  "inbox_v2_message_delivery_observations_commit_fk",
  "inbox_v2_provider_receipt_observations_commit_fk"
];

const TRANSPORT_FACT_COHERENCE_TRIGGER_NAMES = [
  "inbox_v2_tm_transport_fact_commit_coherence",
  "inbox_v2_tm_delivery_coherence",
  "inbox_v2_tm_receipt_coherence"
];

const REQUIRED_PROVIDER_SEMANTIC_TRIGGER_NAMES = [
  "inbox_v2_tm_provider_semantic_head_guard",
  "inbox_v2_tm_provider_semantic_json_guard",
  "inbox_v2_tm_provider_semantic_head_consumer_constraint",
  "inbox_v2_tm_provider_semantic_lifecycle_consumer_constraint",
  "inbox_v2_tm_provider_semantic_reaction_consumer_constraint"
];

const PROVIDER_SEMANTIC_HEAD_FK_NAMES = [
  "inbox_v2_provider_semantic_ordering_heads_tenant_fk",
  "inbox_v2_provider_semantic_ordering_heads_reference_fk",
  "inbox_v2_provider_semantic_ordering_heads_account_fk",
  "inbox_v2_provider_semantic_ordering_heads_binding_fk",
  "inbox_v2_provider_semantic_ordering_heads_event_fk"
];

const REQUIRED_ROUTE_RECEIPT_TRIGGER_NAMES = [
  "inbox_v2_tm_route_consumption_append_guard",
  "inbox_v2_tm_route_consumption_coherence",
  "inbox_v2_tm_receipt_payload_guard",
  "inbox_v2_tm_receipt_payload_coherence"
];

const DEFERRED_CONTENT_CONSTRAINT_NAMES = [
  "inbox_v2_messages_content_fk",
  "inbox_v2_staff_notes_content_fk"
];
