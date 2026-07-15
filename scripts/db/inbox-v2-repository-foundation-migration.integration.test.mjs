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

import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createSqlInboxV2ConversationRepository } from "../../packages/db/src/repositories/sql-inbox-v2-conversation-repository.ts";
import { createPrivilegedInboxV2MembershipRepairRunner } from "../../packages/db/src/repositories/sql-inbox-v2-membership-transaction-policy.ts";
import { createSqlInboxV2ParticipantMembershipRepository } from "../../packages/db/src/repositories/sql-inbox-v2-participant-membership-repository.ts";

import { migrationJournal } from "../checks/db-check-lib.mjs";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const finalizedMarker = "INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1";
const hash = `sha256:${"0".repeat(64)}`;
const expectedTables = [
  "inbox_v2_outbox_outcomes",
  "inbox_v2_outbox_work_items",
  "inbox_v2_projection_checkpoints",
  "inbox_v2_projection_generations",
  "inbox_v2_projection_heads",
  "inbox_v2_tenant_stream_retention_advances"
].sort();
const expectedEnums = [
  "inbox_v2_outbox_outcome_kind",
  "inbox_v2_outbox_work_state",
  "inbox_v2_projection_generation_state"
].sort();
const expectedFunctions = [
  "inbox_v2_advance_tenant_stream_retained_prefix_v1",
  "inbox_v2_apply_participant_membership_mutation_v1",
  "inbox_v2_lock_conversation_membership_head_v1",
  "inbox_v2_lock_participant_membership_mutation_v1",
  "inbox_v2_repository_outbox_finalize_coherence",
  "inbox_v2_repository_outbox_intent_work_init",
  "inbox_v2_repository_outbox_outcome_immutable",
  "inbox_v2_repository_outbox_work_guard",
  "inbox_v2_repository_projection_checkpoint_guard",
  "inbox_v2_repository_projection_head_coherence",
  "inbox_v2_repository_retention_advance_immutable"
].sort();
const expectedTriggers = [
  "inbox_v2_outbox_finalize_coherence_trigger",
  "inbox_v2_outbox_intent_work_init_trigger",
  "inbox_v2_outbox_outcome_immutable_trigger",
  "inbox_v2_outbox_work_guard_trigger",
  "inbox_v2_projection_checkpoint_generation_coherence_trigger",
  "inbox_v2_projection_checkpoint_guard_trigger",
  "inbox_v2_projection_generation_head_coherence_trigger",
  "inbox_v2_projection_head_generation_coherence_trigger",
  "inbox_v2_tenant_stream_retention_advance_immutable_trigger"
].sort();

describePostgres(
  "Inbox V2 repository-foundation 0036 PostgreSQL migration lifecycle",
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
          "DATABASE_URL is required for the DB-007 migration lifecycle test."
        );
      }

      temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db007-migrations-"));
      baseMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        35
      );
      targetMigrationsDirectory = await prepareMigrationDirectory(
        temporaryRoot,
        36
      );
      const targetFiles = await migrationFilesAtIndex(
        targetMigrationsDirectory,
        36
      );
      expect(targetFiles).toHaveLength(1);
      await expect(
        readFile(join(targetMigrationsDirectory, targetFiles[0]), "utf8")
      ).resolves.toContain(finalizedMarker);

      adminClient = new pg.Client({ connectionString: databaseUrl });
      await adminClient.connect();
    }, 60_000);

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
    }, 60_000);

    it("installs the finalized DB-007 foundation and enforces projection/retention/privilege guards", async () => {
      const databaseUrl = await createDatabase("fresh");

      await applyMigrations(databaseUrl, targetMigrationsDirectory);

      await expectDb007Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        await seedProjectionFixture(client, "tenant:db007-fresh");

        await expectDatabaseError(
          client.query(`
            update public.inbox_v2_projection_checkpoints
               set position = 2,
                   last_commit_id = 'commit:gap',
                   revision = 2,
                   updated_at = timestamptz '2026-07-15 10:00:02+00'
             where tenant_id = 'tenant:db007-fresh'
               and projection_id = 'core:test-projection'
               and scope_id = 'tenant'
               and generation = 1
          `),
          "40001",
          "inbox_v2.projection_checkpoint_gap"
        );

        await client.query(`
          begin;
          insert into public.inbox_v2_projection_generations (
            tenant_id, projection_id, scope_id, generation, stream_epoch,
            projection_schema_version, state, min_retained_position, revision,
            created_at, updated_at
          ) values (
            'tenant:db007-fresh', 'core:test-projection', 'tenant', 2,
            'epoch:db007-fresh', 'v1', 'shadow', 0, 1,
            timestamptz '2026-07-15 10:00:03+00',
            timestamptz '2026-07-15 10:00:03+00'
          );
          insert into public.inbox_v2_projection_checkpoints (
            tenant_id, projection_id, scope_id, generation, stream_epoch,
            position, last_commit_id, revision, created_at, updated_at
          ) values (
            'tenant:db007-fresh', 'core:test-projection', 'tenant', 2,
            'epoch:db007-fresh', 1, null, 1,
            timestamptz '2026-07-15 10:00:03+00',
            timestamptz '2026-07-15 10:00:03+00'
          );
          commit;
        `);

        await client.query(`
          insert into public.inbox_v2_tenant_stream_commits (
            tenant_id, id, mutation_id, stream_epoch, position,
            previous_position, schema_version, correlation_id, command_ids,
            client_mutation_ids, authorization_decision_refs, change_ids,
            event_ids, outbox_intent_ids, audience_impact_kind,
            audience_impact_manifest, change_count, event_count,
            outbox_intent_count, manifest_digest_sha256, commit_hash,
            committed_at, created_at
          ) values (
            'tenant:db007-fresh', 'commit:db007-bootstrap',
            'mutation:db007-bootstrap', 'epoch:db007-fresh', 1, 0, 'v1',
            'correlation:db007-bootstrap', '[]'::jsonb, '[]'::jsonb,
            '[]'::jsonb, '["change:db007-bootstrap"]'::jsonb,
            '["event:db007-bootstrap"]'::jsonb, '[]'::jsonb, 'none',
            '{"kind":"none"}'::jsonb, 1, 1, 0, '${hash}', '${hash}',
            timestamptz '2026-07-15 10:00:04+00',
            timestamptz '2026-07-15 10:00:04+00'
          );
          insert into public.inbox_v2_tenant_stream_changes (
            tenant_id, id, mutation_id, stream_commit_id, stream_position,
            ordinal, entity_type_id, entity_id, resulting_revision, timeline,
            audience, state_kind, state_schema_id, state_schema_version,
            state_reason_id, state_hash, payload_reference,
            domain_commit_reference, created_at
          ) values (
            'tenant:db007-fresh', 'change:db007-bootstrap',
            'mutation:db007-bootstrap', 'commit:db007-bootstrap', 1, 1,
            'core:db007_fixture', 'entity:db007-bootstrap', 1, null,
            'workforce_metadata', 'upsert', 'core:db007.fixture-state', 'v1',
            null, '${hash}',
            '{"tenantId":"tenant:db007-fresh","recordId":"payload:db007-bootstrap","schemaId":"core:db007.fixture-state","schemaVersion":"v1","digest":"${hash}"}'::jsonb,
            '{"tenantId":"tenant:db007-fresh","recordId":"payload:db007-bootstrap","schemaId":"core:db007.fixture-state","schemaVersion":"v1","digest":"${hash}"}'::jsonb,
            timestamptz '2026-07-15 10:00:04+00'
          );
          insert into public.inbox_v2_domain_events (
            tenant_id, id, mutation_id, stream_commit_id, stream_position,
            ordinal, type_id, payload_schema_id, payload_schema_version,
            change_ids, subjects, payload_reference, correlation_id,
            command_ids, client_mutation_ids, authorization_decision_refs,
            access_effect, access_effect_causes, event_hash, occurred_at,
            recorded_at
          ) values (
            'tenant:db007-fresh', 'event:db007-bootstrap',
            'mutation:db007-bootstrap', 'commit:db007-bootstrap', 1, 1,
            'core:db007.fixture-event', 'core:db007.fixture-event', 'v1',
            '["change:db007-bootstrap"]'::jsonb,
            '[{"tenantId":"tenant:db007-fresh","entityTypeId":"core:db007_fixture","entityId":"entity:db007-bootstrap"}]'::jsonb,
            null, 'correlation:db007-bootstrap', '[]'::jsonb, '[]'::jsonb,
            '[]'::jsonb, 'none', '[]'::jsonb, '${hash}',
            timestamptz '2026-07-15 10:00:04+00',
            timestamptz '2026-07-15 10:00:04+00'
          );
          update public.inbox_v2_tenant_stream_heads
             set last_position = 1,
                 revision = 2,
                 updated_at = timestamptz '2026-07-15 10:00:04+00'
           where tenant_id = 'tenant:db007-fresh';
          update public.inbox_v2_projection_checkpoints
             set position = 1,
                 last_commit_id = 'commit:db007-bootstrap',
                 revision = 2,
                 updated_at = timestamptz '2026-07-15 10:00:04+00'
           where tenant_id = 'tenant:db007-fresh'
             and projection_id = 'core:test-projection'
             and scope_id = 'tenant'
             and generation = 1;
        `);

        await client.query("set role hulee_inbox_v2_runtime");
        await expectDatabaseError(
          client.query(
            "delete from public.inbox_v2_conversation_membership_heads where false"
          ),
          "42501",
          null
        );
        await expectDatabaseError(
          client.query(
            "delete from public.inbox_v2_tenant_stream_changes where false"
          ),
          "42501",
          null
        );
        const retainedPrefix = await client.query(`
          select tenant_id,
                 stream_epoch,
                 last_position::text,
                 min_retained_position::text,
                 revision::text,
                 pruned_commit_count::text,
                 to_position::text
            from public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
              'tenant:db007-fresh',
              'epoch:db007-fresh',
              0,
              1,
              2,
              1,
              'core:test-retention',
              '${hash}',
              clock_timestamp()
            )
        `);
        expect(retainedPrefix.rows).toEqual([
          {
            tenant_id: "tenant:db007-fresh",
            stream_epoch: "epoch:db007-fresh",
            last_position: "1",
            min_retained_position: "1",
            revision: "3",
            pruned_commit_count: "0",
            to_position: "1"
          }
        ]);
        await client.query("reset role");

        await exerciseMembershipRoleEntrypoints(databaseUrl);

        await expectDatabaseError(
          client.query(`
            update public.inbox_v2_tenant_stream_retention_advances
               set reason_id = 'core:tampered'
             where tenant_id = 'tenant:db007-fresh'
          `),
          "23514",
          "inbox_v2.tenant_stream_retention_advance_immutable"
        );

        await client.query(`
          delete from public.tenants
           where id = 'tenant:db007-fresh'
        `);
        const cascaded = await client.query(`
          select
            (select count(*)::int
               from public.inbox_v2_tenant_stream_heads
              where tenant_id = 'tenant:db007-fresh') as head_count,
            (select count(*)::int
               from public.inbox_v2_tenant_stream_retention_advances
              where tenant_id = 'tenant:db007-fresh') as retention_count,
            (select count(*)::int
               from public.inbox_v2_projection_generations
              where tenant_id = 'tenant:db007-fresh') as generation_count
        `);
        expect(cascaded.rows).toEqual([
          { head_count: 0, retention_count: 0, generation_count: 0 }
        ]);
      });
    }, 120_000);

    it("upgrades populated 0035 stream/outbox rows and backfills exact DB-007 state", async () => {
      const databaseUrl = await createDatabase("upgrade");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);

      await withClient(databaseUrl, async (client) => {
        await seedStreamFixture(client, {
          tenantId: "tenant:db007-upgrade",
          childPosition: 1
        });
        expect(await appliedMigrationCount(client)).toBe(36);
      });

      await applyMigrations(databaseUrl, targetMigrationsDirectory);

      await expectDb007Installed(databaseUrl);
      await withClient(databaseUrl, async (client) => {
        const result = await client.query(`
          select
            (select state_reason_id
               from public.inbox_v2_tenant_stream_changes
              where tenant_id = 'tenant:db007-upgrade'
                and id = 'change:db007:1') as state_reason_id,
            (select state::text
               from public.inbox_v2_outbox_work_items
              where tenant_id = 'tenant:db007-upgrade'
                and intent_id = 'outbox:db007:1') as work_state,
            (select attempt_count::text
               from public.inbox_v2_outbox_work_items
              where tenant_id = 'tenant:db007-upgrade'
                and intent_id = 'outbox:db007:1') as attempt_count,
            (select revision::text
               from public.inbox_v2_outbox_work_items
              where tenant_id = 'tenant:db007-upgrade'
                and intent_id = 'outbox:db007:1') as work_revision,
            (select count(*)::text
               from public.inbox_v2_tenant_stream_commits
              where tenant_id = 'tenant:db007-upgrade') as commit_count
        `);
        expect(result.rows[0]).toEqual({
          state_reason_id: "core:retention-tombstone",
          work_state: "pending",
          attempt_count: "0",
          work_revision: "1",
          commit_count: "1"
        });

        await client.query(`
          insert into public.tenants (id, slug, display_name)
          values ('tenant:db007-other', 'db007-other', 'DB007 other')
        `);
        await expectDatabaseError(
          client.query(`
            insert into public.inbox_v2_outbox_work_items (
              tenant_id, intent_id, state, attempt_count, available_at,
              revision, created_at, updated_at
            ) values (
              'tenant:db007-other', 'outbox:db007:1', 'pending', 0,
              timestamptz '2026-07-15 10:00:00+00', 1,
              timestamptz '2026-07-15 10:00:00+00',
              timestamptz '2026-07-15 10:00:00+00'
            )
          `),
          "23503",
          null
        );

        const accountForeignKey = await client.query(`
          select pg_catalog.pg_get_constraintdef(constraint_row.oid) as definition
            from pg_catalog.pg_constraint constraint_row
           where constraint_row.conrelid =
                 'public.inbox_v2_data_governance_subject_links'::regclass
             and constraint_row.conname =
                 'inbox_v2_dg_subject_link_account_fk'
        `);
        expect(accountForeignKey.rows[0]?.definition).toContain(
          "FOREIGN KEY (tenant_id, account_id) REFERENCES accounts(tenant_id, id)"
        );
      });
    }, 120_000);

    it("rejects a partial DB-007 schema and leaves the 0035 journal unchanged", async () => {
      const databaseUrl = await createDatabase("partial");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      let baseJournalCount;

      await withClient(databaseUrl, async (client) => {
        baseJournalCount = await appliedMigrationCount(client);
        await client.query(
          "create table public.inbox_v2_projection_heads (id text)"
        );
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.repository_foundation_partial_schema_detected"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        expect(await installedRelations(client, expectedTables)).toEqual([
          "inbox_v2_projection_heads"
        ]);
        expect(await installedTypes(client, expectedEnums)).toEqual([]);
      });
    }, 120_000);

    it("rejects incoherent populated stream children before any DB-007 DDL", async () => {
      const databaseUrl = await createDatabase("preflight");
      await applyMigrations(databaseUrl, baseMigrationsDirectory);
      let baseJournalCount;

      await withClient(databaseUrl, async (client) => {
        await seedStreamFixture(client, {
          tenantId: "tenant:db007-preflight",
          childPosition: 2
        });
        baseJournalCount = await appliedMigrationCount(client);
      });

      await expectMigrationFailure(
        databaseUrl,
        "inbox_v2.repository_stream_child_position_incoherent"
      );
      await withClient(databaseUrl, async (client) => {
        expect(await appliedMigrationCount(client)).toBe(baseJournalCount);
        await expectDb007ObjectsAbsent(client);
        const preserved = await client.query(`
          select stream_position::text as stream_position
            from public.inbox_v2_tenant_stream_changes
           where tenant_id = 'tenant:db007-preflight'
             and id = 'change:db007:1'
        `);
        expect(preserved.rows).toEqual([{ stream_position: "2" }]);
      });
    }, 120_000);

    async function createDatabase(label) {
      const baseUrl = new URL(process.env.DATABASE_URL);
      const databaseName = `hulee_db007_${label}_${process.pid}_${createdDatabases.length}`;
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

    async function expectDb007Installed(databaseUrl) {
      await withClient(databaseUrl, async (client) => {
        expect(await installedRelations(client, expectedTables)).toEqual(
          expectedTables
        );
        expect(await installedTypes(client, expectedEnums)).toEqual(
          expectedEnums
        );
        expect(await installedFunctions(client, expectedFunctions)).toEqual(
          expectedFunctions
        );
        expect(await installedTriggers(client, expectedTriggers)).toEqual(
          expectedTriggers
        );
        expect(await appliedMigrationCount(client)).toBe(37);

        const privileges = await client.query(`
          with retention_entrypoint as (
            select procedure_row.oid,
                   procedure_row.prosecdef,
                   procedure_row.proconfig,
                   owner_role.rolname as owner_name,
                   not exists (
                     select 1
                       from pg_catalog.aclexplode(
                         coalesce(
                           procedure_row.proacl,
                           pg_catalog.acldefault(
                             'f', procedure_row.proowner
                           )
                         )
                       ) privilege_row
                      where privilege_row.grantee = 0
                        and privilege_row.privilege_type = 'EXECUTE'
                   ) as public_execute_denied
              from pg_catalog.pg_proc procedure_row
              join pg_catalog.pg_roles owner_role
                on owner_role.oid = procedure_row.proowner
             where procedure_row.oid = pg_catalog.to_regprocedure(
               'public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamp with time zone)'
             )
          )
          select
            not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_conversation_membership_heads',
              'INSERT,UPDATE,DELETE,TRUNCATE'
            ) as runtime_direct_dml_denied,
            not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_membership_repair',
              'public.inbox_v2_conversation_membership_heads',
              'INSERT,UPDATE,DELETE,TRUNCATE'
            ) as repair_direct_dml_denied,
            pg_catalog.has_function_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)',
              'EXECUTE'
            ) as runtime_entrypoint_allowed,
            pg_catalog.has_function_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_lock_conversation_membership_head_v1(text,text)',
              'EXECUTE'
            ) and pg_catalog.has_function_privilege(
              'hulee_inbox_v2_membership_repair',
              'public.inbox_v2_lock_conversation_membership_head_v1(text,text)',
              'EXECUTE'
            ) as membership_head_lock_allowed,
            not pg_catalog.has_function_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_lock_participant_membership_mutation_v1(text,text,bigint,text,text,public.inbox_v2_participant_membership_origin_kind,public.inbox_v2_participant_membership_state)',
              'EXECUTE'
            ) as internal_membership_lock_denied,
            exists (
              select 1
                from pg_catalog.pg_roles role_row
               where role_row.rolname = 'hulee_inbox_v2_retention_owner'
                 and not role_row.rolcanlogin
                 and not role_row.rolsuper
                 and not role_row.rolcreatedb
                 and not role_row.rolcreaterole
                 and not role_row.rolreplication
                 and not role_row.rolbypassrls
            ) as retention_owner_isolated,
            not pg_catalog.pg_has_role(
              'hulee_inbox_v2_runtime',
              'hulee_inbox_v2_retention_owner',
              'MEMBER'
            ) as runtime_does_not_inherit_retention_owner,
            (select prosecdef
                    and owner_name = 'hulee_inbox_v2_retention_owner'
                    and proconfig @>
                      array['search_path=pg_catalog, public, pg_temp']::text[]
                    and public_execute_denied
               from retention_entrypoint) as retention_entrypoint_safe,
            pg_catalog.has_function_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamptz)',
              'EXECUTE'
            ) as runtime_retention_entrypoint_allowed,
            not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_tenant_stream_heads',
              'UPDATE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_tenant_stream_changes',
              'DELETE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_outbox_work_items',
              'DELETE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_outbox_outcomes',
              'DELETE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_runtime',
              'public.inbox_v2_tenant_stream_retention_advances',
              'INSERT,DELETE'
            ) as runtime_retention_direct_dml_denied,
            pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_tenant_stream_changes',
              'DELETE'
            ) and pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_domain_events',
              'DELETE'
            ) and pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_outbox_work_items',
              'SELECT,DELETE'
            ) and pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_outbox_outcomes',
              'SELECT,DELETE'
            ) and pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_outbox_intents',
              'DELETE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_tenant_stream_commits',
              'DELETE'
            ) and not pg_catalog.has_table_privilege(
              'hulee_inbox_v2_retention_owner',
              'public.inbox_v2_tenant_stream_retention_advances',
              'DELETE'
            ) as retention_owner_least_privilege
        `);
        expect(privileges.rows[0]).toEqual({
          runtime_direct_dml_denied: true,
          repair_direct_dml_denied: true,
          runtime_entrypoint_allowed: true,
          membership_head_lock_allowed: true,
          internal_membership_lock_denied: true,
          retention_owner_isolated: true,
          runtime_does_not_inherit_retention_owner: true,
          retention_entrypoint_safe: true,
          runtime_retention_entrypoint_allowed: true,
          runtime_retention_direct_dml_denied: true,
          retention_owner_least_privilege: true
        });
      });
    }

    async function expectDb007ObjectsAbsent(client) {
      expect(await installedRelations(client, expectedTables)).toEqual([]);
      expect(await installedTypes(client, expectedEnums)).toEqual([]);
      expect(await installedFunctions(client, expectedFunctions)).toEqual([]);
      expect(await installedTriggers(client, expectedTriggers)).toEqual([]);
    }
  }
);

async function exerciseMembershipRoleEntrypoints(databaseUrl) {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
  const database = drizzle(pool);
  const tenantId = "tenant:db007-membership-role";
  const conversationId = "conversation:db007-membership-role";
  const employeeId = "employee:db007-membership-role";
  const participantId = "conversation_participant:db007-membership-role";
  const episodeId = "participant_membership_episode:db007-membership-role";
  const startTransitionId =
    "participant_membership_transition:db007-membership-role-start";
  const leaveTransitionId =
    "participant_membership_transition:db007-membership-role-leave";
  const now = Date.now();
  const createdAt = new Date(now - 30_000).toISOString();
  const startedAt = new Date(now - 20_000).toISOString();
  const leftAt = new Date(now - 10_000).toISOString();

  try {
    await database.execute(sql`
      insert into public.tenants (id, slug, display_name, deployment_type)
      values (
        ${tenantId},
        'db007-membership-role',
        'DB007 membership role boundary',
        'saas_shared'
      )
    `);
    const conversation = await createSqlInboxV2ConversationRepository(
      database
    ).create({
      tenantId,
      conversationId,
      topology: "group",
      transport: "internal",
      purposeId: "core:chat",
      lifecycle: "active",
      streamPosition: "1",
      createdAt
    });
    expect(conversation.kind).toBe("created");

    await database.execute(sql`
      insert into public.employees (
        id, tenant_id, email, display_name, profile, created_at, updated_at
      ) values (
        ${employeeId}, ${tenantId}, 'db007-membership-role@example.test',
        'DB007 membership role employee', '{}'::jsonb, ${createdAt},
        ${createdAt}
      )
    `);

    const runtimeRepository = createSqlInboxV2ParticipantMembershipRepository(
      createRoleScopedExecutor(database, "hulee_inbox_v2_runtime")
    );
    const participant = await runtimeRepository.createParticipant({
      tenantId,
      id: participantId,
      conversationId,
      subject: {
        kind: "employee",
        employee: { tenantId, kind: "employee", id: employeeId }
      },
      createdAt
    });
    expect(participant.kind).toBe("created");

    const started = await runtimeRepository.startEpisode({
      tenantId,
      conversationId,
      participantId,
      episodeId,
      transitionId: startTransitionId,
      origin: { kind: "hulee_internal_command" },
      initialState: "active",
      role: "member",
      evidenceClassification: "confirmed",
      cause: {
        kind: "hulee_internal_command",
        actorEmployee: { tenantId, kind: "employee", id: employeeId }
      },
      reasonCodeId: "core:conversation-created",
      expectedMembershipRevision: "0",
      occurredAt: startedAt
    });
    expect(started).toMatchObject({
      kind: "created",
      record: {
        conversationMembershipRevision: "1",
        episode: { revision: "1", state: "active" }
      }
    });

    const left = await runtimeRepository.transitionEpisode({
      tenantId,
      conversationId,
      episodeId,
      transitionId: leaveTransitionId,
      intent: "leave",
      nextRole: null,
      cause: {
        kind: "hulee_internal_command",
        actorEmployee: { tenantId, kind: "employee", id: employeeId }
      },
      reasonCodeId: "core:membership-left",
      expectedMembershipRevision: "1",
      expectedEpisodeRevision: "1",
      occurredAt: leftAt
    });
    expect(left).toMatchObject({
      kind: "updated",
      record: {
        conversationMembershipRevision: "2",
        episode: { revision: "2", state: "left" }
      }
    });

    const repairRunner = createPrivilegedInboxV2MembershipRepairRunner(
      createRoleScopedExecutor(database, "hulee_inbox_v2_membership_repair")
    );
    const repair = await repairRunner.repairConversation(
      { tenantId, conversationId },
      async ({ executor, currentMembershipRevision }) => {
        const identity = await executor.execute(sql`
          select current_user::text as current_user
        `);
        return {
          currentMembershipRevision,
          currentUser: identity.rows[0]?.current_user
        };
      }
    );
    expect(repair).toEqual({
      kind: "repaired",
      conversation: { tenantId, conversationId },
      result: {
        currentMembershipRevision: "2",
        currentUser: "hulee_inbox_v2_membership_repair"
      }
    });

    const persisted = await database.execute(sql`
      select
        (select membership_revision::text
           from public.inbox_v2_conversation_membership_heads
          where tenant_id = ${tenantId}
            and conversation_id = ${conversationId}) as membership_revision,
        (select count(*)::text
           from public.inbox_v2_conversation_membership_commits
          where tenant_id = ${tenantId}) as commit_count,
        (select count(*)::text
           from public.inbox_v2_participant_membership_episodes
          where tenant_id = ${tenantId}) as episode_count,
        (select count(*)::text
           from public.inbox_v2_participant_membership_transitions
          where tenant_id = ${tenantId}) as transition_count
    `);
    expect(persisted.rows).toEqual([
      {
        membership_revision: "2",
        commit_count: "2",
        episode_count: "1",
        transition_count: "2"
      }
    ]);

    await expectProtectedMembershipDmlDenied(pool, tenantId);
  } finally {
    await pool.end();
  }
}

function createRoleScopedExecutor(database, role) {
  if (
    role !== "hulee_inbox_v2_runtime" &&
    role !== "hulee_inbox_v2_membership_repair"
  ) {
    throw new Error(`Unsupported DB-007 test role: ${role}`);
  }

  return {
    execute(query) {
      return database.execute(query);
    },
    transaction(work, config) {
      return database.transaction(async (transaction) => {
        await transaction.execute(sql.raw(`set local role ${role}`));
        return work(transaction);
      }, config);
    }
  };
}

async function expectProtectedMembershipDmlDenied(pool, tenantId) {
  const protectedTables = [
    "inbox_v2_conversation_membership_heads",
    "inbox_v2_conversation_membership_commits",
    "inbox_v2_participant_membership_episodes",
    "inbox_v2_participant_membership_transitions"
  ];
  const roles = ["hulee_inbox_v2_runtime", "hulee_inbox_v2_membership_repair"];
  const client = await pool.connect();

  try {
    for (const role of roles) {
      for (const table of protectedTables) {
        await client.query("begin");
        await client.query(`set local role ${role}`);
        await expectDatabaseError(
          client.query(
            `delete from public.${table} where tenant_id = $1 and false`,
            [tenantId]
          ),
          "42501",
          null
        );
        await client.query("rollback");
      }
    }
  } finally {
    client.release();
  }
}

async function seedStreamFixture(client, { tenantId, childPosition }) {
  const slug = tenantId.replaceAll(":", "-");
  await client.query(`
    begin;
    insert into public.tenants (id, slug, display_name)
    values ('${tenantId}', '${slug}', 'DB007 stream fixture');
    insert into public.inbox_v2_tenant_stream_heads (
      tenant_id, stream_epoch, last_position, min_retained_position,
      revision, created_at, updated_at
    ) values (
      '${tenantId}', 'epoch:db007-upgrade', 0, 0, 1,
      timestamptz '2026-07-15 09:59:59+00',
      timestamptz '2026-07-15 09:59:59+00'
    );
    insert into public.inbox_v2_tenant_stream_commits (
      tenant_id, id, mutation_id, stream_epoch, position, previous_position,
      schema_version, correlation_id, command_ids, client_mutation_ids,
      authorization_decision_refs, change_ids, event_ids, outbox_intent_ids,
      audience_impact_kind, audience_impact_manifest, change_count, event_count,
      outbox_intent_count, manifest_digest_sha256, commit_hash,
      committed_at, created_at
    ) values (
      '${tenantId}', 'commit:db007:1', 'mutation:db007:1',
      'epoch:db007-upgrade', 1, 0, 'v1', 'correlation:db007:1',
      '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      '["change:db007:1"]'::jsonb,
      '["event:db007:1"]'::jsonb,
      '["outbox:db007:1"]'::jsonb,
      'none', '{"kind":"none"}'::jsonb, 1, 1, 1,
      '${hash}', '${hash}',
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    insert into public.inbox_v2_tenant_stream_changes (
      tenant_id, id, mutation_id, stream_commit_id, stream_position, ordinal,
      entity_type_id, entity_id, resulting_revision, timeline, audience,
      state_kind, state_schema_id, state_schema_version, state_hash,
      payload_reference, domain_commit_reference, created_at
    ) values (
      '${tenantId}', 'change:db007:1', 'mutation:db007:1',
      'commit:db007:1', ${childPosition}, 1, 'core:test-entity',
      'entity:db007:1', 1, null, 'policy_filtered', 'tombstone', null, null,
      '${hash}', null, '{"commitId":"commit:db007:1"}'::jsonb,
      timestamptz '2026-07-15 10:00:00+00'
    );
    insert into public.inbox_v2_domain_events (
      tenant_id, id, mutation_id, stream_commit_id, stream_position, ordinal,
      type_id, payload_schema_id, payload_schema_version, change_ids, subjects,
      payload_reference, correlation_id, command_ids, client_mutation_ids,
      authorization_decision_refs, access_effect, access_effect_causes,
      event_hash, occurred_at, recorded_at
    ) values (
      '${tenantId}', 'event:db007:1', 'mutation:db007:1',
      'commit:db007:1', ${childPosition}, 1, 'core:test-event',
      'core:test-event', 'v1', '["change:db007:1"]'::jsonb,
      '[{"kind":"tenant","id":"${tenantId}"}]'::jsonb, null,
      'correlation:db007:1', '[]'::jsonb, '[]'::jsonb, '[]'::jsonb,
      'none', '[]'::jsonb, '${hash}',
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    insert into public.inbox_v2_outbox_intents (
      tenant_id, id, mutation_id, stream_commit_id, stream_position, ordinal,
      type_id, handler_id, effect_class, event_id, consumer_dedupe_key,
      change_ids, payload_reference, correlation_id, intent_hash,
      available_at, created_at
    ) values (
      '${tenantId}', 'outbox:db007:1', 'mutation:db007:1',
      'commit:db007:1', ${childPosition}, 1, 'core:test-effect',
      'core:test-handler', 'notification', 'event:db007:1', '${hash}',
      '["change:db007:1"]'::jsonb, null, 'correlation:db007:1', '${hash}',
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    update public.inbox_v2_tenant_stream_heads
       set last_position = 1, revision = 2,
           updated_at = timestamptz '2026-07-15 10:00:00+00'
     where tenant_id = '${tenantId}';
    commit;
  `);
}

async function seedProjectionFixture(client, tenantId) {
  await client.query(`
    begin;
    insert into public.tenants (id, slug, display_name)
    values ('${tenantId}', 'db007-fresh', 'DB007 fresh');
    insert into public.inbox_v2_tenant_stream_heads (
      tenant_id, stream_epoch, last_position, min_retained_position,
      revision, created_at, updated_at
    ) values (
      '${tenantId}', 'epoch:db007-fresh', 0, 0, 1,
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    insert into public.inbox_v2_projection_generations (
      tenant_id, projection_id, scope_id, generation, stream_epoch,
      projection_schema_version, state, min_retained_position, revision,
      created_at, updated_at
    ) values (
      '${tenantId}', 'core:test-projection', 'tenant', 1,
      'epoch:db007-fresh', 'v1', 'shadow', 0, 1,
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    insert into public.inbox_v2_projection_checkpoints (
      tenant_id, projection_id, scope_id, generation, stream_epoch,
      position, last_commit_id, revision, created_at, updated_at
    ) values (
      '${tenantId}', 'core:test-projection', 'tenant', 1,
      'epoch:db007-fresh', 0, null, 1,
      timestamptz '2026-07-15 10:00:00+00',
      timestamptz '2026-07-15 10:00:00+00'
    );
    commit;
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

async function installedRelations(client, names) {
  const result = await client.query(
    `select relation_name
       from unnest($1::text[]) as expected(relation_name)
      where to_regclass('public.' || relation_name) is not null
      order by relation_name`,
    [names]
  );
  return result.rows.map(({ relation_name: name }) => name);
}

async function installedTypes(client, names) {
  const result = await client.query(
    `select type_definition.typname as type_name
       from pg_catalog.pg_type type_definition
       join pg_catalog.pg_namespace type_namespace
         on type_namespace.oid = type_definition.typnamespace
      where type_namespace.nspname = 'public'
        and type_definition.typname = any($1::text[])
      order by type_definition.typname`,
    [names]
  );
  return result.rows.map(({ type_name: name }) => name);
}

async function installedFunctions(client, names) {
  const result = await client.query(
    `select function_definition.proname as function_name
       from pg_catalog.pg_proc function_definition
       join pg_catalog.pg_namespace function_namespace
         on function_namespace.oid = function_definition.pronamespace
      where function_namespace.nspname = 'public'
        and function_definition.proname = any($1::text[])
      order by function_definition.proname`,
    [names]
  );
  return result.rows.map(({ function_name: name }) => name);
}

async function installedTriggers(client, names) {
  const result = await client.query(
    `select trigger_definition.tgname as trigger_name
       from pg_catalog.pg_trigger trigger_definition
      where trigger_definition.tgname = any($1::text[])
        and not trigger_definition.tgisinternal
      order by trigger_definition.tgname`,
    [names]
  );
  return result.rows.map(({ trigger_name: name }) => name);
}

async function appliedMigrationCount(client) {
  const result = await client.query(
    "select count(*)::int as count from drizzle.__drizzle_migrations"
  );
  return result.rows[0]?.count;
}

async function expectDatabaseError(operation, code, message) {
  let received;
  try {
    await operation;
  } catch (error) {
    received = error;
  }
  expect(received?.code).toBe(code);
  if (message !== null) expect(received?.message).toBe(message);
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
  if (!/^hulee_db007_[a-z]+_[0-9]+_[0-9]+$/u.test(databaseName)) {
    throw new Error(`Unsafe DB-007 test database name: ${databaseName}`);
  }
  return `"${databaseName}"`;
}
