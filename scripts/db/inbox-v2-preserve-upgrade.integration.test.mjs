import { createHash, randomBytes } from "node:crypto";
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

import {
  createMvpTenantWorkspace,
  createSequentialIdFactory
} from "../../packages/core/src/index.ts";
import {
  closeHuleeDatabase,
  createDrizzlePersistenceExecutor,
  createHuleeDatabase,
  createTenantWorkspaceRepository
} from "../../packages/db/src/index.ts";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationJournal } from "../checks/db-check-lib.mjs";
import {
  expectedMigrationContract,
  installInboxV2Database,
  readAppliedMigrationJournal
} from "./inbox-v2-database-lifecycle.mjs";
import { runInboxV2RbacDryRun } from "./inbox-v2-rbac-dry-run.mjs";

const { Client, Pool } = pg;
const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const checkedInMigrationsDirectory = resolve("packages/db/drizzle");
const v1LastMigrationIndex = 27;
const foundationRowAllowlist = Object.freeze({
  inbox_v2_client_merge_graph_heads: "clientMergeGraphHeads",
  inbox_v2_client_merge_node_states: "clientMergeNodeStates",
  inbox_v2_employee_assignment_fence_heads: "employeeFenceHeads",
  inbox_v2_employee_assignment_fence_versions: "employeeFenceVersions"
});
const operationalSideEffectTableAllowlist = Object.freeze([
  "inbox_v2_action_attributions",
  "inbox_v2_auth_audit_events",
  "inbox_v2_auth_command_records",
  "inbox_v2_auth_mutation_commits",
  "inbox_v2_auth_relation_writes",
  "inbox_v2_conversation_client_link_transitions",
  "inbox_v2_conversation_heads",
  "inbox_v2_conversation_membership_commits",
  "inbox_v2_conversation_membership_heads",
  "inbox_v2_conversation_participants",
  "inbox_v2_conversation_work_heads",
  "inbox_v2_conversation_work_item_slots",
  "inbox_v2_conversations",
  "inbox_v2_domain_events",
  "inbox_v2_employee_conversation_states",
  "inbox_v2_external_message_references",
  "inbox_v2_external_thread_aliases",
  "inbox_v2_external_threads",
  "inbox_v2_message_delivery_observations",
  "inbox_v2_message_provider_lifecycle_operations",
  "inbox_v2_message_provider_lifecycle_transitions",
  "inbox_v2_message_revisions",
  "inbox_v2_message_transport_fact_commits",
  "inbox_v2_messages",
  "inbox_v2_outbound_dispatch_artifacts",
  "inbox_v2_outbound_dispatch_attempts",
  "inbox_v2_outbound_dispatches",
  "inbox_v2_outbound_multi_send_operations",
  "inbox_v2_outbound_route_consumptions",
  "inbox_v2_outbound_routes",
  "inbox_v2_outbox_intents",
  "inbox_v2_outbox_outcomes",
  "inbox_v2_outbox_terminal_payload_refs",
  "inbox_v2_outbox_work_items",
  "inbox_v2_participant_membership_episodes",
  "inbox_v2_participant_membership_transitions",
  "inbox_v2_projection_checkpoints",
  "inbox_v2_projection_generations",
  "inbox_v2_projection_heads",
  "inbox_v2_provider_receipt_observations",
  "inbox_v2_provider_roster_evidence",
  "inbox_v2_provider_roster_member_evidence",
  "inbox_v2_source_occurrence_resolution_transitions",
  "inbox_v2_source_occurrences",
  "inbox_v2_source_thread_binding_transitions",
  "inbox_v2_source_thread_bindings",
  "inbox_v2_staff_note_revisions",
  "inbox_v2_staff_notes",
  "inbox_v2_tenant_stream_changes",
  "inbox_v2_tenant_stream_commits",
  "inbox_v2_tenant_stream_heads",
  "inbox_v2_timeline_content_revisions",
  "inbox_v2_timeline_contents",
  "inbox_v2_timeline_items",
  "inbox_v2_work_item_creation_decisions",
  "inbox_v2_work_item_primary_assignments",
  "inbox_v2_work_item_transitions",
  "inbox_v2_work_items"
]);
const createdDatabases = [];
let adminClient;
let temporaryRoot;
let v1MigrationsDirectory;

describePostgres("Inbox V2 representative V1 preserve upgrade", () => {
  beforeAll(async () => {
    if (!process.env.DATABASE_URL) {
      throw new Error(
        "DATABASE_URL is required for the DB-008 preserve integration test."
      );
    }

    temporaryRoot = await mkdtemp(join(tmpdir(), "hulee-db008-preserve-"));
    v1MigrationsDirectory = await prepareMigrationDirectory(
      temporaryRoot,
      v1LastMigrationIndex
    );
    adminClient = new Client({ connectionString: process.env.DATABASE_URL });
    await adminClient.connect();
  }, 60_000);

  afterAll(async () => {
    const cleanupErrors = [];
    if (adminClient) {
      for (const databaseName of createdDatabases.reverse()) {
        assertDisposableTestDatabaseName(databaseName);
        try {
          await adminClient.query(
            `select pg_catalog.pg_terminate_backend(pid)
               from pg_catalog.pg_stat_activity
              where datname = $1
                and pid <> pg_backend_pid()`,
            [databaseName]
          );
          await adminClient.query(
            `drop database if exists ${quoteIdentifier(databaseName)}`
          );
        } catch (error) {
          cleanupErrors.push(error);
        }
      }
      await adminClient.end().catch((error) => cleanupErrors.push(error));
    }
    if (temporaryRoot) {
      await rm(temporaryRoot, { recursive: true, force: true }).catch((error) =>
        cleanupErrors.push(error)
      );
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        cleanupErrors,
        "DB-008 preserve cleanup failed."
      );
    }
  }, 60_000);

  it("upgrades a populated 0027 V1 snapshot additively without backfill or side effects", async () => {
    const database = await createDisposableDatabase("v1_upgrade");
    await applyMigrations(database.url, v1MigrationsDirectory);
    const fixture = await seedRepresentativeV1Snapshot(database.url);

    const sourceJournal = await withClient(database.url, (client) =>
      readAppliedMigrationJournal(client)
    );
    expect(sourceJournal).toHaveLength(v1LastMigrationIndex + 1);
    expect(
      sourceJournal.map(({ hash, createdAt }) => ({ hash, createdAt }))
    ).toEqual(
      expectedMigrationContract(checkedInMigrationsDirectory).slice(
        0,
        v1LastMigrationIndex + 1
      )
    );

    const beforeDryRun = await captureV1Snapshot(database.url);
    const expectedFoundationRows = await captureExpectedFoundationRows(
      database.url
    );
    expect(
      Object.fromEntries(
        Object.entries(foundationRowAllowlist).map(
          ([relationName, expectationKey]) => [
            relationName,
            expectedFoundationRows[expectationKey].length
          ]
        )
      )
    ).toEqual({
      inbox_v2_client_merge_graph_heads: 2,
      inbox_v2_client_merge_node_states: 4,
      inbox_v2_employee_assignment_fence_heads: 4,
      inbox_v2_employee_assignment_fence_versions: 4
    });
    const beforeRbac = await runInboxV2RbacDryRun({
      databaseUrl: database.url,
      tenantId: fixture.primary.tenant.id,
      observedAt: new Date("2026-07-16T06:00:00.000Z")
    });
    const afterDryRun = await captureV1Snapshot(database.url);

    expect(afterDryRun).toEqual(beforeDryRun);
    expect(beforeRbac).toMatchObject({
      tenantId: fixture.primary.tenant.id,
      broadenedAccessCount: 0,
      readyForAutomaticApply: false
    });
    expect(beforeRbac.counts.mapped).toBeGreaterThan(0);
    expect(beforeRbac.counts.reviewRequired).toBeGreaterThan(0);
    expect(beforeRbac.counts.compatibilityOnly).toBeGreaterThan(0);
    expect(beforeRbac.counts.invalid).toBe(0);

    const refusedInstall = await installInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder: checkedInMigrationsDirectory
    }).catch((error) => error);
    expect(refusedInstall).toMatchObject({
      name: "InboxV2DatabaseLifecycleError",
      code: "inbox_v2.expand_online_bridge_required",
      evidence: {
        schemaId: "core:inbox-v2.expand-ddl-risk-evidence@v2",
        requiresOnlineBridge: true,
        overrideRequested: false,
        overrideAuthorized: false
      }
    });
    expect(refusedInstall.reportSha256).toBe(
      refusedInstall.evidence.reportSha256
    );
    expect(refusedInstall.reportSha256).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(refusedInstall.evidence.databaseRef).not.toContain(database.name);
    const afterRefusedInstall = await captureV1Snapshot(database.url, {
      relations: beforeDryRun.relations,
      columns: beforeDryRun.columns
    });
    expect(afterRefusedInstall).toEqual(beforeDryRun);
    const refusedJournal = await withClient(database.url, (client) =>
      readAppliedMigrationJournal(client)
    );
    expect(refusedJournal).toEqual(sourceJournal);

    const installResult = await installInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder: checkedInMigrationsDirectory,
      allowEphemeralBlockingDdlCompatibilityTest: true
    });
    const afterUpgrade = await captureV1Snapshot(database.url, {
      relations: beforeDryRun.relations,
      columns: beforeDryRun.columns
    });

    expect(afterUpgrade).toEqual(beforeDryRun);
    expect(installResult.migrationCount).toBe(
      expectedMigrationContract(checkedInMigrationsDirectory).length
    );
    expect(installResult.migrationDdlBudget).toMatchObject({
      schemaId: "core:inbox-v2.migration-ddl-budget-evidence@v1",
      sessionScope: "lifecycle_advisory_lock_connection",
      lockTimeoutMs: 5_000,
      statementTimeoutMs: 900_000,
      sessionSettingsReset: true
    });
    expect(installResult.expandDdlRisk).toMatchObject({
      schemaId: "core:inbox-v2.expand-ddl-risk-evidence@v2",
      appliedMigrationCount: v1LastMigrationIndex + 1,
      pendingMigrationCount:
        expectedMigrationContract(checkedInMigrationsDirectory).length -
        (v1LastMigrationIndex + 1),
      maximumRelationBytes: 8 * 1024 * 1024,
      violationCount: 1693,
      requiresOnlineBridge: true,
      overrideRequested: true,
      overrideAuthorized: true
    });
    expect(installResult.expandDdlRisk.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          relationName: "normalized_inbound_events",
          riskKind: "table_rewrite",
          violationReason: "existing_relation_rewrite_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "raw_inbound_events",
          riskKind: "table_rewrite",
          violationReason: "existing_relation_rewrite_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "normalized_inbound_events",
          riskKind: "blocking_index",
          violationReason: "blocking_index_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "normalized_inbound_events",
          riskKind: "validated_constraint",
          violationReason: "validated_constraint_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "tenants",
          riskKind: "unbounded_source_backfill",
          violationReason: "unbounded_source_backfill_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "clients",
          riskKind: "unbounded_source_backfill",
          violationReason: "unbounded_source_backfill_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "employees",
          riskKind: "unbounded_source_backfill",
          violationReason: "unbounded_source_backfill_requires_bridge"
        }),
        expect.objectContaining({
          relationName: "tenants",
          riskKind: "trigger_state_change",
          violationReason: "trigger_change_requires_bridge"
        })
      ])
    );
    await expect(
      expectFoundationOnly(database.url, expectedFoundationRows)
    ).resolves.toEqual({
      foundationRowCount: 14,
      operationalSideEffectRowCount: 0,
      unexpectedNonFoundationRowCount: 0
    });

    const afterRbac = await runInboxV2RbacDryRun({
      databaseUrl: database.url,
      tenantId: fixture.primary.tenant.id,
      observedAt: new Date("2026-07-16T06:00:00.000Z")
    });
    expect(afterRbac.mappingSha256).toBe(beforeRbac.mappingSha256);
    expect(afterRbac.reportSha256).not.toBe(beforeRbac.reportSha256);
    expect(afterRbac.entries).toEqual(beforeRbac.entries);

    const repeatInstall = await installInboxV2Database({
      databaseUrl: database.url,
      migrationsFolder: checkedInMigrationsDirectory
    });
    const afterRepeat = await captureV1Snapshot(database.url, {
      relations: beforeDryRun.relations,
      columns: beforeDryRun.columns
    });
    expect(afterRepeat).toEqual(beforeDryRun);
    expect(repeatInstall.migrationJournalSha256).toBe(
      installResult.migrationJournalSha256
    );
    expect(repeatInstall.expandDdlRisk).toMatchObject({
      appliedMigrationCount: expectedMigrationContract(
        checkedInMigrationsDirectory
      ).length,
      pendingMigrationCount: 0,
      operationCount: 0,
      violationCount: 0,
      requiresOnlineBridge: false,
      overrideRequested: false,
      overrideAuthorized: false
    });
    await expect(
      expectFoundationOnly(database.url, expectedFoundationRows)
    ).resolves.toEqual({
      foundationRowCount: 14,
      operationalSideEffectRowCount: 0,
      unexpectedNonFoundationRowCount: 0
    });
  }, 120_000);

  it("bounds relation-lock contention during preserve preflight", async () => {
    const database = await createDisposableDatabase("preflight_contention");
    await applyMigrations(database.url, v1MigrationsDirectory);
    const beforeJournal = await withClient(database.url, (client) =>
      readAppliedMigrationJournal(client)
    );
    const lockHolder = new Client({ connectionString: database.url });
    await lockHolder.connect();
    await lockHolder.query("begin");
    await lockHolder.query(
      "lock table public.accounts in access exclusive mode"
    );

    const startedAt = Date.now();
    try {
      await expect(
        installInboxV2Database({
          databaseUrl: database.url,
          migrationsFolder: checkedInMigrationsDirectory,
          lockTimeoutMs: 150,
          statementTimeoutMs: 2_000
        })
      ).rejects.toMatchObject({ code: "55P03" });
    } finally {
      await lockHolder.query("rollback").catch(() => {});
      await lockHolder.end();
    }
    expect(Date.now() - startedAt).toBeLessThan(3_000);
    await expect(
      withClient(database.url, (client) => readAppliedMigrationJournal(client))
    ).resolves.toEqual(beforeJournal);
    await expect(
      installInboxV2Database({
        databaseUrl: database.url,
        migrationsFolder: checkedInMigrationsDirectory
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.expand_online_bridge_required"
    });
  }, 30_000);
});

async function seedRepresentativeV1Snapshot(databaseUrl) {
  const database = createHuleeDatabase({ connectionString: databaseUrl });
  try {
    const repository = createTenantWorkspaceRepository(
      createDrizzlePersistenceExecutor(database)
    );
    const primary = createMvpTenantWorkspace({
      now: "2026-07-15T10:00:00.000Z",
      tenantSlug: "db008-preserve-primary",
      tenantDisplayName: "DB008 Preserve Primary",
      productName: "Hulee",
      adminEmail: "db008-primary@example.test",
      clientDisplayName: "Primary Client",
      inboundText: "Representative inbound V1 message",
      idFactory: createSequentialIdFactory("db008-preserve-primary")
    });
    const secondary = createMvpTenantWorkspace({
      now: "2026-07-15T10:05:00.000Z",
      tenantSlug: "db008-preserve-secondary",
      tenantDisplayName: "DB008 Preserve Secondary",
      productName: "Hulee",
      adminEmail: "db008-secondary@example.test",
      clientDisplayName: "Secondary Client",
      inboundText: "Tenant isolation sentinel",
      idFactory: createSequentialIdFactory("db008-preserve-secondary")
    });
    await repository.saveWorkspace(primary);
    await repository.saveWorkspace(secondary);

    await executeFixtureStatements(
      database.$client,
      `insert into public.employees (
         id, tenant_id, email, display_name, deactivated_at, created_at, updated_at
       ) values
         ($2, $1, 'operator@example.test', 'Operator', null,
          timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'),
         ($3, $1, 'former@example.test', 'Former Operator',
          timestamptz '2026-07-15 10:04:00+00',
          timestamptz '2026-07-15 10:02:00+00', timestamptz '2026-07-15 10:04:00+00');

       insert into public.org_units (
         id, tenant_id, name, kind, status, created_at, updated_at
       ) values (
         'org_unit:db008-support', $1, 'Support', 'department', 'active',
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );
       insert into public.teams (
         id, tenant_id, name, created_at, updated_at
       ) values (
         'team:db008-support', $1, 'Support Team',
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );
       insert into public.work_queues (
         id, tenant_id, name, kind, owning_org_unit_id, status,
         routing_config, created_at, updated_at
       ) values (
         'work_queue:db008-support', $1, 'Support Queue', 'support',
         'org_unit:db008-support', 'active', '{}'::jsonb,
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );
       insert into public.employee_org_unit_memberships (
         tenant_id, employee_id, org_unit_id, created_at, updated_at
       ) values (
         $1, $2, 'org_unit:db008-support',
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );
       insert into public.employee_work_queue_memberships (
         tenant_id, employee_id, work_queue_id, created_at, updated_at
       ) values (
         $1, $2, 'work_queue:db008-support',
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );
       insert into public.employee_team_memberships (
         tenant_id, employee_id, team_id, status, role_label, created_at, updated_at
       ) values (
         $1, $2, 'team:db008-support', 'active', 'operator',
         timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'
       );

       insert into public.source_connections (
         id, tenant_id, source_type, source_name, display_name, status,
         auth_type, capabilities, config, diagnostics, metadata,
         created_by_employee_id, created_at, updated_at
       ) values (
         'source_connection:db008-telegram-direct', $1, 'messenger',
         'telegram', 'Telegram direct fixture', 'active', 'qr_session',
         '{"inbound":true,"outbound":true,"groupChats":true}'::jsonb,
         '{"fixture":true}'::jsonb, '{"health":"ok"}'::jsonb,
         '{"preserveFixture":true}'::jsonb, $2,
         timestamptz '2026-07-15 10:01:10+00',
         timestamptz '2026-07-15 10:01:10+00'
       );
       insert into public.source_accounts (
         id, tenant_id, source_connection_id, external_account_id,
         external_account_name, account_type, display_name, status, metadata,
         created_at, updated_at
       ) values (
         'source_account:db008-telegram-direct', $1,
         'source_connection:db008-telegram-direct', 'account-safe-id',
         'fixture_account', 'direct_number', 'Telegram fixture account',
         'active', '{"preserveFixture":true}'::jsonb,
         timestamptz '2026-07-15 10:01:11+00',
         timestamptz '2026-07-15 10:01:11+00'
       );
       insert into public.raw_inbound_events (
         id, tenant_id, source_connection_id, source_account_id,
         external_event_id, event_signature, idempotency_key, received_at,
         provider_timestamp, payload, headers, processing_status,
         error_code, error_message, created_at, updated_at
       ) values (
         'raw_inbound_event:db008-telegram-group-message', $1,
         'source_connection:db008-telegram-direct',
         'source_account:db008-telegram-direct', 'event-safe-id',
         'signature-safe-digest', 'db008:raw:telegram-group-message',
         timestamptz '2026-07-15 10:02:05+00',
         timestamptz '2026-07-15 10:02:04+00',
         '{"eventType":"message","fixture":true}'::jsonb,
         '{"content-type":"application/json"}'::jsonb, 'processed', null,
         null, timestamptz '2026-07-15 10:02:05+00',
         timestamptz '2026-07-15 10:02:06+00'
       );
       insert into public.normalized_inbound_events (
         id, tenant_id, raw_event_id, source_connection_id, source_account_id,
         source_type, source_name, event_type, direction, visibility,
         external_thread_id, external_message_id, external_user_id,
         payload_version, normalized_payload, reply_capability,
         conversation_id, message_id, idempotency_key, processing_status,
         created_at, updated_at
       ) values (
         'normalized_inbound_event:db008-telegram-group-message', $1,
         'raw_inbound_event:db008-telegram-group-message',
         'source_connection:db008-telegram-direct',
         'source_account:db008-telegram-direct', 'messenger', 'telegram',
         'message.created', 'inbound', 'private', 'thread-safe-id',
         'message-safe-id', 'user-safe-id', 'v1',
         '{"text":"Group inbound","fixture":true}'::jsonb,
         '{"canReply":true}'::jsonb, 'conversation:db008-client-group',
         'message:db008-group-inbound', 'db008:normalized:telegram-group-message',
         'processed', timestamptz '2026-07-15 10:02:06+00',
         timestamptz '2026-07-15 10:02:07+00'
       );
       insert into public.channel_connectors (
         id, tenant_id, channel_type, channel_class, provider, display_name,
         status, health_status, capabilities, onboarding_state, config,
         diagnostics, source_connection_id, created_by_employee_id,
         created_at, updated_at
       ) values (
         'channel_connector:db008-telegram-direct', $1,
         'telegram_qr_bridge', 'direct_messenger', 'telegram',
         'Telegram direct fixture', 'active', 'healthy',
         '{"inbound":true,"outbound":true,"groupChats":true}'::jsonb,
         '{"step":"completed"}'::jsonb, '{"fixture":true}'::jsonb,
         '{"lastProbe":"ok"}'::jsonb,
         'source_connection:db008-telegram-direct', $2,
         timestamptz '2026-07-15 10:01:12+00',
         timestamptz '2026-07-15 10:01:12+00'
       );
       insert into public.channel_sessions (
         id, tenant_id, connector_id, session_key, status,
         session_encrypted, session_fingerprint, external_account_id,
         display_address, public_state, metadata, challenge_type,
         challenge_expires_at, lease_owner, lease_expires_at,
         last_connected_at, last_disconnected_at, last_heartbeat_at,
         last_inbound_at, last_outbound_at, last_error_at, last_error_code,
         last_error_message, created_at, updated_at
       ) values (
         'channel_session:db008-telegram-direct', $1,
         'channel_connector:db008-telegram-direct', 'primary', 'connected',
         null, 'fingerprint-safe-digest', 'account-safe-id', '+10000000000',
         '{"connected":true}'::jsonb, '{"preserveFixture":true}'::jsonb,
         null, null, 'fixture-worker',
         timestamptz '2026-07-15 10:06:00+00',
         timestamptz '2026-07-15 10:01:13+00', null,
         timestamptz '2026-07-15 10:02:08+00',
         timestamptz '2026-07-15 10:02:05+00',
         timestamptz '2026-07-15 10:02:07+00', null, null, null,
         timestamptz '2026-07-15 10:01:13+00',
         timestamptz '2026-07-15 10:02:08+00'
       );
       insert into public.channel_session_events (
         id, tenant_id, connector_id, session_id, event_type, severity,
         code, message, metadata, occurred_at, created_at, updated_at
       ) values (
         'channel_session_event:db008-connected', $1,
         'channel_connector:db008-telegram-direct',
         'channel_session:db008-telegram-direct', 'connected', 'info',
         'SESSION_CONNECTED', 'Fixture session connected',
         '{"preserveFixture":true}'::jsonb,
         timestamptz '2026-07-15 10:01:13+00',
         timestamptz '2026-07-15 10:01:13+00',
         timestamptz '2026-07-15 10:01:13+00'
       );
       insert into public.channel_auth_challenges (
         id, tenant_id, connector_id, challenge_type, status, public_payload,
         secret_payload_encrypted, error_code, error_message, expires_at,
         completed_at, created_by_employee_id, created_at, updated_at
       ) values (
         'channel_auth_challenge:db008-completed', $1,
         'channel_connector:db008-telegram-direct', 'qr', 'completed',
         '{"fixture":true}'::jsonb, null, null, null,
         timestamptz '2026-07-15 10:06:00+00',
         timestamptz '2026-07-15 10:01:13+00', $2,
         timestamptz '2026-07-15 10:01:12+00',
         timestamptz '2026-07-15 10:01:13+00'
       );

       insert into public.clients (
         id, tenant_id, display_name, source, responsible_employee_id,
         created_at, updated_at
       ) values
         ('client:db008-group', $1, 'Group Client', 'telegram', $2,
          timestamptz '2026-07-15 10:02:00+00', timestamptz '2026-07-15 10:02:00+00'),
         ('client:db008-closed', $1, 'Closed Client', 'public_api', $2,
          timestamptz '2026-07-15 10:03:00+00', timestamptz '2026-07-15 10:03:00+00');
       insert into public.conversations (
         id, tenant_id, type, client_id, current_queue_id,
         assigned_employee_id, assigned_team_id, status, created_at, updated_at
       ) values
         ('conversation:db008-client-group', $1, 'client_group',
          'client:db008-group', 'work_queue:db008-support', $2,
          'team:db008-support', 'open',
          timestamptz '2026-07-15 10:02:00+00', timestamptz '2026-07-15 10:02:00+00'),
         ('conversation:db008-internal-direct', $1, 'internal_direct', null,
          null, null, null, 'open',
          timestamptz '2026-07-15 10:03:00+00', timestamptz '2026-07-15 10:03:00+00'),
         ('conversation:db008-internal-group', $1, 'internal_group', null,
          null, null, null, 'open',
          timestamptz '2026-07-15 10:04:00+00', timestamptz '2026-07-15 10:04:00+00'),
         ('conversation:db008-closed', $1, 'client_direct',
          'client:db008-closed', 'work_queue:db008-support', $2,
          'team:db008-support', 'closed',
          timestamptz '2026-07-15 10:05:00+00', timestamptz '2026-07-15 10:05:00+00');
       insert into public.conversation_participants (
         tenant_id, conversation_id, employee_id, created_at, updated_at
       ) values
         ($1, 'conversation:db008-client-group', $2,
          timestamptz '2026-07-15 10:02:00+00', timestamptz '2026-07-15 10:02:00+00'),
         ($1, 'conversation:db008-internal-direct', $2,
          timestamptz '2026-07-15 10:03:00+00', timestamptz '2026-07-15 10:03:00+00'),
         ($1, 'conversation:db008-internal-group', $2,
          timestamptz '2026-07-15 10:04:00+00', timestamptz '2026-07-15 10:04:00+00'),
         ($1, 'conversation:db008-internal-group', $3,
          timestamptz '2026-07-15 10:04:00+00', timestamptz '2026-07-15 10:04:00+00');

       insert into public.messages (
         id, tenant_id, conversation_id, direction, text, status,
         idempotency_key, created_at, updated_at
       ) values
         ('message:db008-group-inbound', $1,
          'conversation:db008-client-group', 'inbound', 'Group inbound',
          'received', 'db008:group:inbound',
          timestamptz '2026-07-15 10:02:10+00', timestamptz '2026-07-15 10:02:10+00'),
         ('message:db008-group-queued', $1,
          'conversation:db008-client-group', 'outbound', 'Queued unresolved',
          'queued', 'db008:group:queued',
          timestamptz '2026-07-15 10:02:20+00', timestamptz '2026-07-15 10:02:20+00'),
         ('message:db008-internal-sent', $1,
          'conversation:db008-internal-direct', 'outbound', 'Internal sent',
          'sent', 'db008:internal:sent',
          timestamptz '2026-07-15 10:03:10+00', timestamptz '2026-07-15 10:03:10+00');
       insert into public.message_delivery_attempts (
         id, tenant_id, message_id, status, provider_message_id,
         error_code, retryable, created_at, updated_at
       ) values (
         'delivery_attempt:db008-sent', $1, 'message:db008-internal-sent',
         'sent', 'provider-message-safe-id', null, false,
         timestamptz '2026-07-15 10:03:11+00', timestamptz '2026-07-15 10:03:11+00'
       );
       insert into public.files (
         id, tenant_id, storage_key, file_name, media_type, size_bytes,
         status, metadata, created_at, updated_at
       ) values (
         'file:db008-attachment', $1, 'db008/fixture.bin', 'fixture.bin',
         'application/octet-stream', 12, 'stored', '{"fixture":true}'::jsonb,
         timestamptz '2026-07-15 10:02:11+00', timestamptz '2026-07-15 10:02:11+00'
       );
       insert into public.message_attachments (
         id, tenant_id, message_id, file_id, provider,
         provider_attachment_id, source_url, sort_order, metadata,
         created_at, updated_at
       ) values (
         'attachment:db008-fixture', $1, 'message:db008-group-inbound',
         'file:db008-attachment', 'telegram', 'attachment-safe-id', null, 0,
         '{}'::jsonb, timestamptz '2026-07-15 10:02:11+00',
         timestamptz '2026-07-15 10:02:11+00'
       );

       insert into public.event_store (
         id, tenant_id, type, version, occurred_at, idempotency_key, payload,
         created_at, updated_at
       ) values
         ('event:db008-queued', $1, 'message.sent', 'v1',
          timestamptz '2026-07-15 10:02:20+00', 'db008:event:queued',
          jsonb_build_object('tenantId', $1, 'messageId', 'message:db008-group-queued'),
          timestamptz '2026-07-15 10:02:20+00', timestamptz '2026-07-15 10:02:20+00'),
         ('event:db008-inert', $1, 'fixture.inert', 'v1',
          timestamptz '2026-07-15 10:04:20+00', 'db008:event:inert',
          jsonb_build_object('tenantId', $1),
          timestamptz '2026-07-15 10:04:20+00', timestamptz '2026-07-15 10:04:20+00');
       insert into public.outbox (
         id, tenant_id, event_id, status, attempts, next_attempt_at,
         last_error_code, payload, created_at, updated_at
       ) values
         ('outbox:db008-queued-processed', $1, 'event:db008-queued',
          'processed', 1, null, null,
          jsonb_build_object('id', 'event:db008-queued', 'tenantId', $1,
                             'type', 'message.sent', 'version', 'v1',
                             'occurredAt', '2026-07-15T10:02:20.000Z',
                             'payload', jsonb_build_object('messageId', 'message:db008-group-queued')),
          timestamptz '2026-07-15 10:02:20+00', timestamptz '2026-07-15 10:02:21+00'),
         ('outbox:db008-inert-pending', $1, 'event:db008-inert',
          'pending', 0, null, null,
          jsonb_build_object('id', 'event:db008-inert', 'tenantId', $1,
                             'type', 'fixture.inert', 'version', 'v1',
                             'occurredAt', '2026-07-15T10:04:20.000Z',
                             'payload', '{}'::jsonb),
          timestamptz '2026-07-15 10:04:20+00', timestamptz '2026-07-15 10:04:20+00');

       insert into public.tenant_roles (
         id, tenant_id, name, description, status, is_system,
         created_by_employee_id, created_at, updated_at
       ) values
         ('role:db008-queue-reader', $1, 'Queue reader', null, 'active', false,
          $4, timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'),
         ('role:db008-legacy-reply', $1, 'Legacy reply', null, 'active', false,
          $4, timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00');
       insert into public.tenant_role_permissions (
         tenant_id, role_id, permission, created_at, updated_at
       ) values
         ($1, 'role:db008-queue-reader', 'inbox.read',
          timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'),
         ($1, 'role:db008-legacy-reply', 'message.reply',
          timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00');
       insert into public.tenant_role_bindings (
         id, tenant_id, role_id, subject_type, subject_id, scope_type, scope_id,
         created_by_employee_id, starts_at, expires_at, revoked_at,
         created_at, updated_at
       ) values
         ('binding:db008-queue-reader', $1, 'role:db008-queue-reader',
          'employee', $2, 'queue', 'work_queue:db008-support', $4,
          null, null, null, timestamptz '2026-07-15 10:01:00+00',
          timestamptz '2026-07-15 10:01:00+00'),
         ('binding:db008-legacy-reply', $1, 'role:db008-legacy-reply',
          'employee', $2, 'assigned', null, $4,
          null, null, null, timestamptz '2026-07-15 10:01:00+00',
          timestamptz '2026-07-15 10:01:00+00');
       insert into public.direct_permission_grants (
         id, tenant_id, employee_id, permission, scope_type, scope_id, reason,
         created_by_employee_id, starts_at, expires_at, revoked_at,
         created_at, updated_at
       ) values
         ('grant:db008-client-read-review', $1, $2, 'conversation.read',
          'client', 'client:db008-group', 'migration fixture', $4,
          null, null, null, timestamptz '2026-07-15 10:01:00+00',
          timestamptz '2026-07-15 10:01:00+00'),
         ('grant:db008-future-report', $1, $2, 'reports.view',
          'tenant', null, 'migration fixture', $4,
          timestamptz '2026-07-17 00:00:00+00', null, null,
          timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 10:01:00+00'),
         ('grant:db008-revoked-module', $1, $2, 'modules.manage',
          'tenant', null, 'migration fixture', $4,
          null, null, timestamptz '2026-07-15 11:00:00+00',
          timestamptz '2026-07-15 10:01:00+00', timestamptz '2026-07-15 11:00:00+00')`,
      [
        primary.tenant.id,
        "employee:db008-operator",
        "employee:db008-deactivated",
        primary.admin.id
      ]
    );

    return { primary, secondary };
  } finally {
    await closeHuleeDatabase(database);
  }
}

async function executeFixtureStatements(pool, fixtureSql, parameters) {
  const statements = fixtureSql
    .split(/;\s*(?=insert into public\.)/giu)
    .map((statement) => statement.trim())
    .filter(Boolean);
  const client = await pool.connect();
  try {
    await client.query("begin");
    for (const statement of statements) {
      const parameterIndexes = [
        ...new Set(
          [...statement.matchAll(/\$(\d+)/gu)].map((match) => Number(match[1]))
        )
      ].sort((left, right) => left - right);
      const remappedStatement = statement.replace(
        /\$(\d+)/gu,
        (_match, raw) => {
          const index = parameterIndexes.indexOf(Number(raw));
          return `$${index + 1}::text`;
        }
      );
      await client.query(
        remappedStatement,
        parameterIndexes.map((index) => parameters[index - 1])
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function captureV1Snapshot(databaseUrl, baseline) {
  return withClient(databaseUrl, async (client) => {
    const relations = baseline?.relations ?? (await listPublicTables(client));
    const currentColumns = await readColumnContract(client, relations);
    let columns = currentColumns;
    if (baseline?.columns !== undefined) {
      const baselineKeys = new Set(baseline.columns.map(columnContractKey));
      const preservedColumns = currentColumns.filter((column) =>
        baselineKeys.has(columnContractKey(column))
      );
      expect(preservedColumns).toEqual(baseline.columns);
      columns = baseline.columns;
    }
    const preservedColumnNames = groupColumnNames(columns);
    const currentColumnNames = groupColumnNames(currentColumns);
    const relationDigests = [];
    for (const relation of relations) {
      const retainedNames = new Set(preservedColumnNames.get(relation) ?? []);
      const additiveNames = (currentColumnNames.get(relation) ?? []).filter(
        (columnName) => !retainedNames.has(columnName)
      );
      const result = await client.query(
        `select (to_jsonb(source_row) - $1::text[])::text as row_json
           from public.${quoteIdentifier(relation)} source_row
          order by (to_jsonb(source_row) - $1::text[])::text`,
        [additiveNames]
      );
      relationDigests.push({
        relation,
        rowCount: result.rows.length,
        sha256: sha256(JSON.stringify(result.rows.map((row) => row.row_json)))
      });
    }
    return Object.freeze({
      relations: Object.freeze([...relations]),
      columns: Object.freeze(columns),
      relationDigests: Object.freeze(relationDigests),
      sha256: sha256(JSON.stringify({ columns, relationDigests }))
    });
  });
}

function columnContractKey(column) {
  return `${column.table_name}\u0000${column.column_name}`;
}

function groupColumnNames(columns) {
  const grouped = new Map();
  for (const column of columns) {
    const names = grouped.get(column.table_name) ?? [];
    names.push(column.column_name);
    grouped.set(column.table_name, names);
  }
  return grouped;
}

async function listPublicTables(client) {
  const result = await client.query(`
    select relation.relname as relation_name
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p')
     order by relation.relname
  `);
  return result.rows.map(({ relation_name: relationName }) => relationName);
}

async function readColumnContract(client, relations) {
  const result = await client.query(
    `select table_name, ordinal_position, column_name, data_type,
            udt_schema, udt_name, is_nullable, column_default,
            is_identity, identity_generation, is_generated, generation_expression
       from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
      order by table_name, ordinal_position`,
    [relations]
  );
  return result.rows;
}

async function querySequentially(client, statements) {
  const results = [];
  for (const statement of statements) {
    results.push(await client.query(statement));
  }
  return results;
}

async function captureExpectedFoundationRows(databaseUrl) {
  return withClient(databaseUrl, async (client) => {
    const [
      clientMergeGraphHeads,
      clientMergeNodeStates,
      employeeFenceHeads,
      employeeFenceVersions
    ] = await querySequentially(client, [
      `
        select id as tenant_id,
               null::text as revision,
               null::text as updated_at,
               null::text as latest_redirect_id
          from public.tenants
         order by id
      `,
      `
        select tenant_id,
               id as client_id,
               'canonical_root'::text as state,
               null::text as next_client_id,
               null::text as redirect_id,
               0::int as maximum_inbound_depth,
               1::text as revision,
               null::text as last_graph_revision,
               created_at::text as updated_at
          from public.clients
         order by tenant_id, id
      `,
      `
        select tenant_id,
               id as employee_id,
               case when deactivated_at is null then 'active' else 'inactive' end
                 as state,
               1::text as current_generation,
               1::text as current_revision,
               coalesce(deactivated_at, created_at)::text as effective_from,
               created_at::text as created_at,
               greatest(created_at, coalesce(deactivated_at, created_at))::text
                 as updated_at
          from public.employees
         order by tenant_id, id
      `,
      `
        select tenant_id,
               id as employee_id,
               1::text as revision,
               1::text as generation,
               case when deactivated_at is null then 'active' else 'inactive' end
                 as state,
               coalesce(deactivated_at, created_at)::text as effective_from,
               greatest(created_at, coalesce(deactivated_at, created_at))::text
                 as recorded_at,
               'core:employee_bootstrap'::text as reason_id,
               'core:employee_lifecycle_sync'::text
                 as changed_by_trusted_service_id
          from public.employees
         order by tenant_id, id
      `
    ]);
    return {
      clientMergeGraphHeads: clientMergeGraphHeads.rows,
      clientMergeNodeStates: clientMergeNodeStates.rows,
      employeeFenceHeads: employeeFenceHeads.rows,
      employeeFenceVersions: employeeFenceVersions.rows
    };
  });
}

async function expectFoundationOnly(databaseUrl, expectedRows) {
  return withClient(databaseUrl, async (client) => {
    const [
      clientMergeGraphHeads,
      clientMergeNodeStates,
      employeeFenceHeads,
      employeeFenceVersions
    ] = await querySequentially(client, [
      `
        select tenant_id,
               revision::text as revision,
               updated_at::text as updated_at,
               latest_redirect_id
          from public.inbox_v2_client_merge_graph_heads
         order by tenant_id
      `,
      `
        select tenant_id,
               client_id,
               state::text as state,
               next_client_id,
               redirect_id,
               maximum_inbound_depth,
               revision::text as revision,
               last_graph_revision::text as last_graph_revision,
               updated_at::text as updated_at
          from public.inbox_v2_client_merge_node_states
         order by tenant_id, client_id
      `,
      `
        select tenant_id,
               employee_id,
               state::text as state,
               current_generation::text as current_generation,
               current_revision::text as current_revision,
               effective_from::text as effective_from,
               created_at::text as created_at,
               updated_at::text as updated_at
          from public.inbox_v2_employee_assignment_fence_heads
         order by tenant_id, employee_id
      `,
      `
        select tenant_id,
               employee_id,
               revision::text as revision,
               generation::text as generation,
               state::text as state,
               effective_from::text as effective_from,
               recorded_at::text as recorded_at,
               reason_id,
               changed_by_trusted_service_id
          from public.inbox_v2_employee_assignment_fence_versions
         order by tenant_id, employee_id, revision
      `
    ]);
    const actualRows = {
      clientMergeGraphHeads: clientMergeGraphHeads.rows,
      clientMergeNodeStates: clientMergeNodeStates.rows,
      employeeFenceHeads: employeeFenceHeads.rows,
      employeeFenceVersions: employeeFenceVersions.rows
    };
    expect(actualRows).toEqual(expectedRows);

    const tableCounts = await readInboxV2TableCounts(client);
    const tableCountByName = new Map(
      tableCounts.map(({ relationName, rowCount }) => [relationName, rowCount])
    );
    expect(
      [
        ...Object.keys(foundationRowAllowlist),
        ...operationalSideEffectTableAllowlist
      ].filter((relationName) => !tableCountByName.has(relationName))
    ).toEqual([]);

    const expectedFoundationCounts = Object.entries(foundationRowAllowlist)
      .map(([relationName, expectationKey]) => ({
        relationName,
        rowCount: expectedRows[expectationKey].length
      }))
      .sort(compareRelationCounts);
    const actualNonEmptyCounts = tableCounts
      .filter(({ rowCount }) => rowCount > 0)
      .sort(compareRelationCounts);
    expect(actualNonEmptyCounts).toEqual(expectedFoundationCounts);

    const operationalSideEffectCounts = operationalSideEffectTableAllowlist.map(
      (relationName) => ({
        relationName,
        rowCount: tableCountByName.get(relationName)
      })
    );
    expect(operationalSideEffectCounts).toEqual(
      operationalSideEffectTableAllowlist.map((relationName) => ({
        relationName,
        rowCount: 0
      }))
    );

    const unexpectedNonFoundationRows = tableCounts.filter(
      ({ relationName, rowCount }) =>
        rowCount > 0 && !Object.hasOwn(foundationRowAllowlist, relationName)
    );
    expect(unexpectedNonFoundationRows).toEqual([]);

    return {
      foundationRowCount: expectedFoundationCounts.reduce(
        (total, { rowCount }) => total + rowCount,
        0
      ),
      operationalSideEffectRowCount: operationalSideEffectCounts.reduce(
        (total, { rowCount }) => total + rowCount,
        0
      ),
      unexpectedNonFoundationRowCount: unexpectedNonFoundationRows.reduce(
        (total, { rowCount }) => total + rowCount,
        0
      )
    };
  });
}

async function readInboxV2TableCounts(client) {
  const relations = await client.query(`
    select relation.relname as relation_name
      from pg_catalog.pg_class relation
      join pg_catalog.pg_namespace namespace
        on namespace.oid = relation.relnamespace
     where namespace.nspname = 'public'
       and relation.relkind in ('r', 'p')
       and relation.relname like 'inbox_v2\\_%' escape '\\'
     order by relation.relname
  `);
  const unionQuery = relations.rows
    .map(
      ({ relation_name: relationName }) =>
        `select ${quoteLiteral(relationName)}::text as relation_name,
                count(*)::int as row_count
           from public.${quoteIdentifier(relationName)}`
    )
    .join(" union all ");
  const result = await client.query(unionQuery);
  return result.rows.map(
    ({ relation_name: relationName, row_count: rowCount }) => ({
      relationName,
      rowCount
    })
  );
}

function compareRelationCounts(left, right) {
  return left.relationName < right.relationName
    ? -1
    : left.relationName > right.relationName
      ? 1
      : 0;
}

async function prepareMigrationDirectory(temporaryDirectory, boundaryIndex) {
  const directory = join(temporaryDirectory, `through-${boundaryIndex}`);
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

async function applyMigrations(databaseUrl, migrationsDirectory) {
  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: migrationsDirectory });
  } finally {
    await pool.end();
  }
}

async function createDisposableDatabase(label) {
  const databaseName = `hulee_db008_preserve_${label}_${randomBytes(5).toString("hex")}`;
  assertDisposableTestDatabaseName(databaseName);
  await adminClient.query(`create database ${quoteIdentifier(databaseName)}`);
  createdDatabases.push(databaseName);
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  return { name: databaseName, url: url.toString() };
}

async function withClient(databaseUrl, work) {
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
}

function assertDisposableTestDatabaseName(databaseName) {
  if (!/^hulee_db008_preserve_[a-z0-9_]+$/u.test(databaseName)) {
    throw new Error(
      `Refusing unsafe DB-008 preserve database name: ${databaseName}`
    );
  }
}

function quoteIdentifier(identifier) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

function quoteLiteral(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
