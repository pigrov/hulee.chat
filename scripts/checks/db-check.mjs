import { readdir, readFile } from "node:fs/promises";

import {
  assertDrizzleSnapshotParity,
  assertParentUniqueConstraintsBeforeForeignKeys,
  assertSqlStatementParity,
  collectFinalizedMigrationDdlStatements,
  generateExpectedDrizzleMigration
} from "./db-check-lib.mjs";

const metadata = await readFile("packages/db/src/schema/metadata.ts", "utf8");
const migrationDirectory = "packages/db/drizzle";
const inboxV2SchemaDirectory = "packages/db/src/schema/inbox-v2";
const migrationFileNames = (await readdir(migrationDirectory))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();
const migrationFiles = await Promise.all(
  migrationFileNames.map(async (fileName) => ({
    fileName,
    sql: await readFile(`${migrationDirectory}/${fileName}`, "utf8")
  }))
);
const migrationSql = migrationFiles.map(({ sql }) => sql).join("\n");
const inboxV2FoundationMarker = "-- INBOX_V2_FOUNDATION_MIGRATION_FINALIZED_V1";
const inboxV2FoundationPreflightMarker = "-- INBOX_V2_FOUNDATION_PREFLIGHT_V1";
const inboxV2WorkItemMarker = "-- INBOX_V2_WORK_ITEM_MIGRATION_FINALIZED_V1";
const inboxV2WorkItemPreflightMarker = "-- INBOX_V2_WORK_ITEM_PREFLIGHT_V1";
const inboxV2WorkItemInvariantName = "INBOX_V2_WORK_ITEM_INVARIANTS_SQL";
const inboxV2TimelineMessageMarker =
  "-- INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1";
const inboxV2TimelineMessagePreflightMarker =
  "-- INBOX_V2_TIMELINE_MESSAGE_PREFLIGHT_V1";
const inboxV2TimelineMessageInvariantNames = new Set([
  "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL",
  "INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL"
]);
const inboxV2FoundationInvariantNames = new Set([
  "INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL",
  "INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL",
  "INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL",
  "INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL",
  "INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL",
  "INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL",
  "INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL"
]);
const inboxV2FoundationMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2FoundationMarker)
);
const inboxV2WorkItemMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2WorkItemMarker)
);
const inboxV2TimelineMessageMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2TimelineMessageMarker)
);
const inboxV2InvariantBlocks = (
  await Promise.all(
    (await readdir(inboxV2SchemaDirectory))
      .filter((fileName) => fileName.endsWith(".ts"))
      .sort()
      .map(async (fileName) =>
        extractInboxV2InvariantBlocks(
          fileName,
          await readFile(`${inboxV2SchemaDirectory}/${fileName}`, "utf8")
        )
      )
  )
).flat();

if (inboxV2InvariantBlocks.length === 0) {
  console.error("DB schema has no Inbox V2 invariant SQL blocks.");
  process.exit(1);
}

const invariantBlockNames = inboxV2InvariantBlocks.map(({ name }) => name);
if (new Set(invariantBlockNames).size !== invariantBlockNames.length) {
  console.error("DB schema has duplicate Inbox V2 invariant SQL block names.");
  process.exit(1);
}
const inboxV2FoundationInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => inboxV2FoundationInvariantNames.has(name)
);
const inboxV2WorkItemInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2WorkItemInvariantName
);
const inboxV2TimelineMessageInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => inboxV2TimelineMessageInvariantNames.has(name)
);
if (
  inboxV2FoundationInvariantBlocks.length !==
  inboxV2FoundationInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2FoundationInvariantNames.size} Inbox V2 foundation invariant SQL blocks, found ${inboxV2FoundationInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2WorkItemInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2WorkItemInvariantName} schema block, found ${inboxV2WorkItemInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (
  inboxV2TimelineMessageInvariantBlocks.length !==
  inboxV2TimelineMessageInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2TimelineMessageInvariantNames.size} Inbox V2 Timeline/Message invariant SQL blocks, found ${inboxV2TimelineMessageInvariantBlocks.length}.`
  );
  process.exit(1);
}
const unownedInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) =>
    !inboxV2FoundationInvariantNames.has(name) &&
    name !== inboxV2WorkItemInvariantName &&
    !inboxV2TimelineMessageInvariantNames.has(name)
);
if (unownedInvariantBlocks.length > 0) {
  console.error(
    `Inbox V2 invariant blocks have no finalized migration owner: ${unownedInvariantBlocks.map(({ name }) => name).join(", ")}.`
  );
  process.exit(1);
}

const tenantTables = [
  ...metadata.matchAll(
    /\{ name: "([^"]+)", scope: "tenant", requiresTenantId: true \}/g
  )
].map((match) => match[1]);

if (tenantTables.length === 0) {
  console.error("DB schema scaffold does not declare tenant-scoped tables.");
  process.exit(1);
}

for (const tableName of ["event_store", "outbox", "audit_log"]) {
  if (
    !metadata.includes(`name: "${tableName}"`) ||
    !migrationSql.includes(`"${tableName}"`)
  ) {
    console.error(
      `DB schema and migration must include required table: ${tableName}.`
    );
    process.exit(1);
  }
}

for (const tableName of tenantTables) {
  const tableBlock = findCreateTableBlock(migrationSql, tableName);

  if (!tableBlock) {
    console.error(`Missing migration CREATE TABLE block for ${tableName}.`);
    process.exit(1);
  }

  if (!/"tenant_id"\s+text\b[^\n]*NOT NULL/.test(tableBlock)) {
    console.error(`${tableName} must include a non-null tenant_id column.`);
    process.exit(1);
  }

  if (!hasTenantAwareIndex(migrationSql, tableName)) {
    console.error(`${tableName} must include a tenant-aware index.`);
    process.exit(1);
  }
}

if (inboxV2FoundationMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 foundation migration, found ${inboxV2FoundationMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2WorkItemMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 WorkItem migration, found ${inboxV2WorkItemMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2TimelineMessageMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 Timeline/Message migration, found ${inboxV2TimelineMessageMigrations.length}.`
  );
  process.exit(1);
}

assertInboxV2FoundationMigration(inboxV2FoundationMigrations[0]);
assertInboxV2WorkItemMigration(inboxV2WorkItemMigrations[0]);
assertInboxV2TimelineMessageMigration(inboxV2TimelineMessageMigrations[0]);
try {
  // A historical migration cannot be regenerated from the current Drizzle
  // schema after a later slice changes that schema. Keep validating 0030's
  // finalized structure above and through the PostgreSQL upgrade lifecycle,
  // while generated-schema parity follows the latest migration only.
  await assertInboxV2TimelineMessageGeneratedSchemaParity(
    inboxV2TimelineMessageMigrations[0]
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log("db:check passed");

async function assertInboxV2TimelineMessageGeneratedSchemaParity(migration) {
  const snapshotPath = "packages/db/drizzle/meta/0031_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 30,
    targetIndex: 31
  });
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    generated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInDdl = collectFinalizedMigrationDdlStatements({
    migrationSql: migration.sql,
    finalizedMarker: inboxV2TimelineMessageMarker,
    preflightMarker: inboxV2TimelineMessagePreflightMarker,
    invariantBlocks: inboxV2TimelineMessageInvariantBlocks
  });
  assertSqlStatementParity(generated.statements, checkedInDdl);
}

function assertInboxV2FoundationMigration(migration) {
  if (!migration) {
    console.error("DB schema has no SQL migrations.");
    process.exit(1);
  }

  const requiredFragments = [
    inboxV2FoundationMarker,
    inboxV2FoundationPreflightMarker,
    "migration.tenant_edge_invalid",
    "create or replace function public.inbox_v2_assert_account_identity_transition(",
    "create constraint trigger inbox_v2_account_provisional_key_induction_trigger",
    "create constraint trigger inbox_v2_account_identity_verified_snapshot_trigger",
    "create constraint trigger inbox_v2_account_identity_alias_exact_trigger",
    "create or replace function public.inbox_v2_assert_binding_evidence_set_integrity(",
    "create constraint trigger inbox_v2_binding_evidence_references_integrity",
    "add constraint inbox_v2_binding_snapshots_transition_fk",
    "create or replace function public.inbox_v2_assert_source_thread_binding_integrity(",
    "create constraint trigger inbox_v2_binding_snapshots_integrity",
    "create or replace function public.inbox_v2_source_occurrence_guard_insert(",
    "create or replace function public.inbox_v2_source_occurrence_reject_immutable(",
    "create or replace function public.inbox_v2_assert_source_occurrence_children(",
    "create or replace function public.inbox_v2_source_occurrence_deferred_children(",
    "create trigger inbox_v2_source_occurrences_insert_guard_trigger",
    "create trigger inbox_v2_source_occurrences_immutable_trigger",
    "create trigger inbox_v2_occurrence_provider_references_immutable_trigger",
    "create trigger inbox_v2_occurrence_provider_timestamps_immutable_trigger",
    "create constraint trigger inbox_v2_source_occurrences_children_constraint",
    "create constraint trigger inbox_v2_occurrence_provider_references_constraint",
    "create constraint trigger inbox_v2_occurrence_provider_timestamps_constraint",
    "create or replace function public.inbox_v2_provider_roster_guard_insert(",
    "create or replace function public.inbox_v2_provider_roster_member_guard_insert(",
    "create or replace function public.inbox_v2_provider_roster_reject_immutable(",
    "create or replace function public.inbox_v2_assert_provider_roster_member_set(",
    "create or replace function public.inbox_v2_provider_roster_deferred_member_set(",
    "create trigger inbox_v2_provider_roster_insert_guard_trigger",
    "create trigger inbox_v2_provider_roster_member_insert_guard_trigger",
    "create trigger inbox_v2_provider_roster_immutable_trigger",
    "create trigger inbox_v2_provider_roster_member_immutable_trigger",
    "create constraint trigger inbox_v2_provider_roster_member_set_constraint",
    "create or replace function public.inbox_v2_assert_conversation_membership_head(",
    "create or replace function public.inbox_v2_assert_conversation_membership_projection(",
    "create or replace function public.inbox_v2_assert_conversation_membership_commit(",
    "create or replace function public.inbox_v2_assert_participant_membership_episode(",
    "create or replace function public.inbox_v2_provider_membership_ordering_head_guard(",
    "inbox_v2_provider_membership_ordering_heads_pk",
    "inbox_v2_provider_membership_ordering_heads_values_check",
    "inbox_v2_provider_membership_ordering_heads_participant_fk",
    "inbox_v2_provider_membership_ordering_heads_binding_fk",
    "inbox_v2_provider_membership_ordering_heads_identity_fk",
    "inbox_v2_provider_membership_ordering_heads_episode_fk",
    "inbox_v2_provider_membership_ordering_heads_transition_fk",
    "create trigger inbox_v2_conversations_transport_immutable_trigger",
    "create trigger inbox_v2_participant_membership_episodes_insert_guard_trigger",
    "create trigger inbox_v2_provider_membership_ordering_heads_guard_trigger",
    "create constraint trigger inbox_v2_conversations_membership_head_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_membership_heads_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_membership_commits_constraint_trigger",
    "create constraint trigger inbox_v2_participant_membership_episodes_constraint_trigger",
    "create constraint trigger inbox_v2_participant_membership_transitions_constraint_trigger",
    "create constraint trigger inbox_v2_employees_internal_membership_constraint_trigger",
    "create or replace function public.inbox_v2_assert_client_merge_commit(",
    "create or replace function public.inbox_v2_assert_client_merge_node_exists(",
    "create trigger inbox_v2_tenants_client_merge_head_bootstrap_trigger",
    "create trigger inbox_v2_clients_merge_node_bootstrap_trigger",
    "create constraint trigger inbox_v2_client_merge_node_states_constraint_trigger\nafter insert or update or delete on public.inbox_v2_client_merge_node_states",
    "create constraint trigger inbox_v2_client_merge_redirects_constraint_trigger",
    "create or replace function public.inbox_v2_assert_conversation_client_link_episode(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_evidence(",
    "create or replace function public.inbox_v2_conversation_client_link_assert_current_policy(",
    "create or replace function public.inbox_v2_conversation_client_link_assert_employee_at(",
    "create or replace function public.inbox_v2_conversation_client_link_deferred_claim_revocation(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_transition(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_head(",
    "create trigger inbox_v2_conversation_client_link_evidence_insert_guard_trigger",
    "create trigger inbox_v2_conversation_client_link_evidence_immutable_trigger",
    "create trigger inbox_v2_conversation_client_links_insert_guard_trigger",
    "create trigger inbox_v2_conversation_client_links_update_guard_trigger",
    "create trigger inbox_v2_conversation_client_link_transitions_insert_guard_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_heads_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_transitions_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_links_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_roles_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_evidence_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_contact_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_operations_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_claim_revocation_constraint_trigger",
    "inbox_v2_client_links_linked_policy_authority_fk",
    "inbox_v2_client_links_verify_policy_authority_fk",
    "inbox_v2_client_links_ended_policy_authority_fk",
    "inbox_v2_client_link_transitions_policy_authority_fk",
    "inbox_v2_conversation_client_links_linked_employee_fk",
    "inbox_v2_conversation_client_links_ended_employee_fk",
    "inbox_v2_conversation_client_link_transitions_employee_fk",
    "inbox_v2_client_link_evidence_pk",
    "inbox_v2_client_link_evidence_ordinal_check",
    "inbox_v2_client_link_evidence_kind_check",
    "inbox_v2_client_link_evidence_link_fk",
    "inbox_v2_client_link_evidence_claim_fk",
    "inbox_v2_client_link_evidence_contact_fk",
    "inbox_v2_client_link_evidence_participant_fk",
    "inbox_v2_client_link_evidence_raw_fk",
    "inbox_v2_client_link_evidence_normalized_fk",
    "inbox_v2_client_link_evidence_occurrence_fk",
    "create or replace function public.inbox_v2_source_identity_claim_assert_identity(",
    "create or replace function public.inbox_v2_source_identity_claim_assert_claim(",
    "create or replace function public.inbox_v2_source_identity_claim_assert_transition(",
    "create or replace function public.inbox_v2_source_identity_claim_guard_transition_insert(",
    "inbox_v2_identity_claim_evidence_occurrence_actor_fk",
    "inbox_v2_identity_claim_evidence_roster_member_fk",
    "inbox_v2_source_occurrences_actor_evidence_unique",
    "inbox_v2_provider_roster_member_identity_unique",
    "inbox_v2_identity_claims_policy_authority_fk",
    "inbox_v2_identity_claim_transition_policy_authority_fk",
    "inbox_v2.source_identity_claim_policy_authority_invalid",
    "create trigger inbox_v2_source_identity_claim_bootstrap_head_trigger",
    "create trigger inbox_v2_source_identity_claim_transition_insert_trigger",
    "create constraint trigger inbox_v2_source_identity_claim_identity_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_head_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_claim_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_evidence_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_transition_constraint",
    "create or replace function public.inbox_v2_tenant_policy_version_guard(",
    "create or replace function public.inbox_v2_tenant_policy_activation_transition_guard(",
    "create or replace function public.inbox_v2_tenant_policy_activation_head_guard(",
    "create or replace function public.inbox_v2_assert_tenant_policy_transition_materialized(",
    "inbox_v2_tenant_policy_transition_exact_authority_unique",
    "inbox_v2_tenant_policy_versions_approver_fk",
    "inbox_v2_tenant_policy_activation_heads_activator_fk",
    "inbox_v2_tenant_policy_activation_heads_revoker_fk",
    "inbox_v2_tenant_policy_activation_heads_transition_fk",
    "inbox_v2_tenant_policy_activation_transitions_actor_fk",
    "inbox_v2_source_occurrences_binding_snapshot_fk",
    "inbox_v2_source_occurrences_provider_identity_fk",
    "inbox_v2_provider_roster_binding_snapshot_fk",
    "inbox_v2_provider_roster_member_identity_fk",
    "create trigger inbox_v2_tenant_policy_versions_guard_trigger",
    "create trigger inbox_v2_tenant_policy_activation_transitions_guard_trigger",
    "create trigger inbox_v2_tenant_policy_activation_heads_guard_trigger",
    "create constraint trigger inbox_v2_tenant_policy_transition_materialized_constraint"
  ];
  for (const fragment of requiredFragments) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required Inbox V2 SQL: ${fragment}`
      );
      process.exit(1);
    }
  }

  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2FoundationMarker,
    preflightMarker: inboxV2FoundationPreflightMarker,
    invariantBlocks: inboxV2FoundationInvariantBlocks,
    preflightDescription: "tenant-edge"
  });

  const firstForeignKeyIndex = migration.sql.search(
    /ADD CONSTRAINT "[^"]+" FOREIGN KEY/
  );
  for (const constraintName of [
    "clients_tenant_id_unique",
    "client_contacts_tenant_id_unique",
    "employees_tenant_id_unique",
    "inbox_v2_conversations_tenant_id_shape_unique",
    "normalized_inbound_events_tenant_id_unique",
    "normalized_inbound_events_tenant_id_connection_unique",
    "normalized_inbound_events_tenant_id_account_unique",
    "raw_inbound_events_tenant_id_unique",
    "raw_inbound_events_tenant_id_connection_unique",
    "raw_inbound_events_tenant_id_account_unique",
    "raw_inbound_events_tenant_id_account_scope_unique",
    "source_accounts_tenant_id_unique",
    "source_accounts_tenant_id_connection_unique",
    "source_connections_tenant_id_unique"
  ]) {
    const constraintIndex = migration.sql.indexOf(
      `ADD CONSTRAINT "${constraintName}" UNIQUE`
    );
    if (
      firstForeignKeyIndex < 0 ||
      constraintIndex < 0 ||
      constraintIndex > firstForeignKeyIndex
    ) {
      console.error(
        `${migration.fileName} must create parent key ${constraintName} before dependent foreign keys.`
      );
      process.exit(1);
    }
  }

  for (const triggerName of [
    "inbox_v2_account_provisional_key_induction_trigger",
    "inbox_v2_account_identity_alias_exact_trigger",
    "inbox_v2_account_identity_verified_snapshot_trigger",
    "inbox_v2_binding_evidence_references_integrity",
    "inbox_v2_binding_snapshots_integrity",
    "inbox_v2_source_occurrences_children_constraint",
    "inbox_v2_occurrence_provider_references_constraint",
    "inbox_v2_occurrence_provider_timestamps_constraint",
    "inbox_v2_provider_roster_member_set_constraint",
    "inbox_v2_conversations_membership_head_constraint_trigger",
    "inbox_v2_conversation_membership_heads_constraint_trigger",
    "inbox_v2_conversation_membership_commits_constraint_trigger",
    "inbox_v2_participant_membership_episodes_constraint_trigger",
    "inbox_v2_participant_membership_transitions_constraint_trigger",
    "inbox_v2_employees_internal_membership_constraint_trigger",
    "inbox_v2_tenants_client_merge_head_constraint_trigger",
    "inbox_v2_client_merge_graph_heads_constraint_trigger",
    "inbox_v2_clients_merge_node_constraint_trigger",
    "inbox_v2_client_merge_node_states_constraint_trigger",
    "inbox_v2_client_merge_redirects_constraint_trigger",
    "inbox_v2_conversation_client_link_heads_constraint_trigger",
    "inbox_v2_conversation_client_link_transitions_constraint_trigger",
    "inbox_v2_conversation_client_links_constraint_trigger",
    "inbox_v2_conversation_client_link_roles_constraint_trigger",
    "inbox_v2_conversation_client_link_operations_constraint_trigger",
    "inbox_v2_conversation_client_link_claim_revocation_constraint_trigger",
    "inbox_v2_conversation_client_link_evidence_constraint_trigger",
    "inbox_v2_conversation_client_link_contact_constraint_trigger",
    "inbox_v2_source_identity_claim_identity_constraint",
    "inbox_v2_source_identity_claim_head_constraint",
    "inbox_v2_source_identity_claim_claim_constraint",
    "inbox_v2_source_identity_claim_evidence_constraint",
    "inbox_v2_source_identity_claim_transition_constraint",
    "inbox_v2_tenant_policy_transition_materialized_constraint"
  ]) {
    const triggerPattern = new RegExp(
      `create constraint trigger ${triggerName}[\\s\\S]*?deferrable initially deferred[\\s\\S]*?execute function`,
      "i"
    );
    if (!triggerPattern.test(migration.sql)) {
      console.error(
        `${migration.fileName} must keep ${triggerName} deferrable and initially deferred.`
      );
      process.exit(1);
    }
  }
}

function assertInboxV2WorkItemMigration(migration) {
  if (!migration.fileName.startsWith("0030_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 WorkItem migration at index 0030.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2WorkItemMarker,
    preflightMarker: inboxV2WorkItemPreflightMarker,
    invariantBlocks: inboxV2WorkItemInvariantBlocks,
    preflightDescription: "WorkItem"
  });
  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "org_units_tenant_id_unique",
        "teams_tenant_id_unique",
        "work_queues_tenant_id_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

function assertInboxV2TimelineMessageMigration(migration) {
  if (!migration.fileName.startsWith("0031_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 Timeline/Message migration at index 0031.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2TimelineMessageMarker,
    preflightMarker: inboxV2TimelineMessagePreflightMarker,
    invariantBlocks: inboxV2TimelineMessageInvariantBlocks,
    preflightDescription: "Timeline/Message"
  });
  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "event_store_tenant_id_unique",
        "files_tenant_id_unique",
        "inbox_v2_messages_content_unique",
        "inbox_v2_messages_revision_unique",
        "inbox_v2_timeline_items_revision_unique",
        "inbox_v2_timeline_items_subject_unique",
        "inbox_v2_timeline_items_sequence_unique",
        "inbox_v2_source_thread_bindings_owner_account_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

function assertInboxV2InvariantMigration({
  migration,
  finalizedMarker,
  preflightMarker,
  invariantBlocks,
  preflightDescription
}) {
  try {
    collectFinalizedMigrationDdlStatements({
      migrationSql: migration.sql,
      finalizedMarker,
      preflightMarker,
      invariantBlocks
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  for (const invariantBlock of invariantBlocks) {
    if (!migration.sql.includes(invariantBlock.sql)) {
      console.error(
        `${migration.fileName} is stale against schema invariant block ${invariantBlock.name} from ${invariantBlock.fileName}.`
      );
      process.exit(1);
    }
  }

  const expectedInvariantFunctionNames = extractInboxV2InvariantFunctionNames(
    invariantBlocks.map(({ sql }) => sql).join("\n")
  );
  const migratedInvariantFunctionMatches = [
    ...migration.sql.matchAll(
      /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
    )
  ];
  const migratedInvariantFunctionNames = [
    ...new Set(migratedInvariantFunctionMatches.map((match) => match[1]))
  ].sort();
  const safeSearchPathCount = [
    ...migration.sql.matchAll(/set search_path = pg_catalog, public, pg_temp/g)
  ].length;
  if (
    JSON.stringify(migratedInvariantFunctionNames) !==
      JSON.stringify(expectedInvariantFunctionNames) ||
    migratedInvariantFunctionMatches.length !==
      migratedInvariantFunctionNames.length ||
    safeSearchPathCount !== migratedInvariantFunctionMatches.length ||
    /create or replace function inbox_v2_/.test(migration.sql) ||
    /execute function inbox_v2_/.test(migration.sql) ||
    /\b(?:from|join) inbox_v2_/.test(migration.sql)
  ) {
    console.error(
      `${migration.fileName} must schema-qualify every Inbox V2 invariant function and pin its safe search_path.`
    );
    process.exit(1);
  }

  const firstBreakpointIndex = migration.sql.indexOf(
    "--> statement-breakpoint"
  );
  const preflightIndex = migration.sql.indexOf(preflightMarker);
  if (
    firstBreakpointIndex < 0 ||
    preflightIndex < 0 ||
    preflightIndex > firstBreakpointIndex
  ) {
    console.error(
      `${migration.fileName} must run the Inbox V2 ${preflightDescription} preflight as its first statement.`
    );
    process.exit(1);
  }
}

function extractInboxV2InvariantBlocks(fileName, source) {
  return [
    ...source.matchAll(
      /export const (INBOX_V2_[A-Z0-9_]+(?:INTEGRITY|INVARIANTS)_SQL) = String\.raw`([\s\S]*?)`;/g
    )
  ].map((match) => ({
    fileName,
    name: match[1],
    sql: match[2].trim()
  }));
}

function extractInboxV2InvariantFunctionNames(sql) {
  const matches = [
    ...sql.matchAll(
      /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
    )
  ];
  const names = [...new Set(matches.map((match) => match[1]))].sort();
  if (matches.length !== names.length) {
    console.error("DB schema has duplicate Inbox V2 invariant function names.");
    process.exit(1);
  }
  return names;
}

function findCreateTableBlock(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);
  const match = sql.match(
    new RegExp(`CREATE TABLE "${escapedTableName}" \\([\\s\\S]*?\\);`)
  );

  return match?.[0];
}

function hasTenantAwareIndex(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);

  return new RegExp(
    `CREATE (UNIQUE )?INDEX "[^"]+" ON "${escapedTableName}"[\\s\\S]*?\\("tenant_id"`
  ).test(sql);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
