import { readFile, writeFile } from "node:fs/promises";

import { generateExpectedDrizzleMigration } from "../checks/db-check-lib.mjs";

const refresh = process.argv.includes("--refresh");
const regenerate = process.argv.includes("--regenerate");
const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0053_inbox_v2_typed_content_and_attachments.sql";
const invariantPath = "packages/db/src/schema/inbox-v2/file-object.ts";
const invariantExportName = "INBOX_V2_FILE_OBJECT_INVARIANTS_SQL";
const anchorInvariantPath =
  "packages/db/src/schema/inbox-v2/timeline-message.ts";
const anchorInvariantExportName =
  "INBOX_V2_MESSAGE_ATTACHMENT_ANCHOR_INVARIANTS_SQL";
const authorizationInvariantPath =
  "packages/db/src/schema/inbox-v2/authorization-relations.ts";
const authorizationInvariantExportName =
  "INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL";
const attachmentAuthorizationFunctionNames = [
  "public.inbox_v2_auth_attachment_message_change_valid",
  "public.inbox_v2_auth_domain_mutation_coherence"
];
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_FILE_OBJECT_MIGRATION_FINALIZED_V1";

const requiredTables = [
  "inbox_v2_file_attachment_materialization_attempts",
  "inbox_v2_file_attachment_materialization_evidence",
  "inbox_v2_file_attachment_materialization_jobs",
  "inbox_v2_file_derivative_edges",
  "inbox_v2_file_object_operation_evidence",
  "inbox_v2_file_object_version_heads",
  "inbox_v2_file_object_versions",
  "inbox_v2_file_objects",
  "inbox_v2_file_outbound_artifact_blocks",
  "inbox_v2_file_outbound_artifact_plans",
  "inbox_v2_file_outbound_dispatch_plans",
  "inbox_v2_file_parent_link_heads",
  "inbox_v2_file_parent_links",
  "inbox_v2_file_parent_set_heads",
  "inbox_v2_file_storage_orphans",
  "inbox_v2_file_versions"
];
const requiredEnums = [
  "inbox_v2_file_attachment_materialization_outcome",
  "inbox_v2_file_attachment_materialization_state",
  "inbox_v2_file_attachment_source_locator_kind",
  "inbox_v2_file_object_operation_kind",
  "inbox_v2_file_object_operation_outcome",
  "inbox_v2_file_object_state",
  "inbox_v2_file_object_version_state",
  "inbox_v2_file_object_versioning_mode",
  "inbox_v2_file_outbound_artifact_grouping",
  "inbox_v2_file_outbound_block_kind",
  "inbox_v2_file_parent_kind",
  "inbox_v2_file_parent_link_state",
  "inbox_v2_file_parent_purpose",
  "inbox_v2_file_parent_set_completeness",
  "inbox_v2_file_parent_visibility",
  "inbox_v2_file_storage_orphan_state"
];
const nullableBridgeColumns = [
  "attachment_v2_file_id",
  "attachment_file_version_id",
  "attachment_object_version_id",
  "extension_payload_v2_file_id",
  "extension_payload_file_version_id",
  "extension_payload_object_version_id"
];
const nullableRevisionBridgeColumns = [
  "attachment_file_revision",
  "extension_payload_file_revision"
];
const nullableAttachmentAnchorColumns = [
  ["owner_message_id", String.raw`text`],
  ["owner_timeline_item_id", String.raw`text`],
  ["owner_timeline_content_id", String.raw`text`],
  ["owner_block_key", String.raw`text`],
  [
    "materialization_state",
    String.raw`(?:(?:"public"\.)?"inbox_v2_attachment_materialization_state")`
  ]
];
const replacedCheckConstraint =
  "inbox_v2_timeline_content_payloads_shape_check";
const replacedCauseEventForeignKey =
  "inbox_v2_action_attributions_cause_event_fk";
const causeEventIndex = "inbox_v2_action_attributions_cause_event_idx";
const requiredDispatchPlanColumnDefinitions = [
  '"content_fingerprint_purpose_id" text NOT NULL',
  '"content_fingerprint_key_generation" text NOT NULL',
  '"content_fingerprint_valid_until" timestamp (3) with time zone NOT NULL',
  '"content_fingerprint_hmac_sha256" text NOT NULL',
  '"adapter_contract_declaration_revision" bigint NOT NULL',
  '"adapter_loaded_by_trusted_service_id" text NOT NULL',
  '"adapter_loaded_at" timestamp (3) with time zone NOT NULL'
];
const requiredAdapterSnapshotInvariantFragments = [
  "route_row.adapter_declaration_revision =\n         plan_row.adapter_contract_declaration_revision",
  "route_row.adapter_loaded_by_trusted_service_id =\n         plan_row.adapter_loaded_by_trusted_service_id",
  "route_row.adapter_loaded_at = plan_row.adapter_loaded_at"
];

const migrationSql = await readFile(migrationPath, "utf8");
const migrationStatements = splitMigrationStatements(migrationSql);
let generatedStatements;
let regeneratedSnapshot;
if (regenerate) {
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory: "packages/db/drizzle",
    baseIndex: 52,
    targetIndex: 53
  });
  generatedStatements = generated.statements;
  regeneratedSnapshot = generated.snapshot;
} else if (refresh) {
  if (
    countOccurrences(migrationSql, finalizedMarker) !== 1 ||
    migrationStatements.length < 2 ||
    !migrationStatements.at(-1)?.startsWith(`-- ${finalizedMarker}\n`)
  ) {
    throw new Error(
      `${migrationPath} can only be refreshed after one valid finalization.`
    );
  }
  generatedStatements = migrationStatements.slice(0, -1);
} else {
  if (migrationSql.includes(finalizedMarker)) {
    throw new Error(`${migrationPath} is already finalized.`);
  }
  generatedStatements = migrationStatements;
}

assertGeneratedInventory(generatedStatements);
assertAdditiveGeneratedDdl(generatedStatements);

const invariantSource = await readFile(invariantPath, "utf8");
const invariantSql = extractRawSql(invariantSource, invariantExportName);
assertAdapterSnapshotInvariant(invariantSql);
const anchorInvariantSource = await readFile(anchorInvariantPath, "utf8");
const anchorInvariantSql = extractRawSql(
  anchorInvariantSource,
  anchorInvariantExportName
);
assertAttachmentAnchorInvariant(anchorInvariantSql);
const authorizationInvariantSource = await readFile(
  authorizationInvariantPath,
  "utf8"
);
const authorizationInvariantSql = extractRawSql(
  authorizationInvariantSource,
  authorizationInvariantExportName
);
const attachmentAuthorizationInvariantSql = attachmentAuthorizationFunctionNames
  .map((functionName) =>
    extractSqlFunctionDefinition(authorizationInvariantSql, functionName)
  )
  .join("\n\n");
assertAttachmentAuthorizationInvariant(attachmentAuthorizationInvariantSql);
const finalizedStatements = [
  ...generatedStatements,
  `-- ${finalizedMarker}\n${invariantSql}\n\n${attachmentAuthorizationInvariantSql}\n\n${anchorInvariantSql}`
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);
if (regeneratedSnapshot !== undefined) {
  await writeFile(
    "packages/db/drizzle/meta/0053_snapshot.json",
    `${JSON.stringify(regeneratedSnapshot, null, 2)}\n`,
    "utf8"
  );
}

console.log(
  `Finalized ${migrationPath}: ${generatedStatements.length} additive generated DDL statements + 3 exact schema-owned invariant blocks.`
);

function assertGeneratedInventory(statements) {
  for (const tableName of requiredTables) {
    assertExactStatementCount(
      statements,
      `CREATE TABLE "${tableName}"`,
      1,
      migrationPath
    );
  }
  for (const enumName of requiredEnums) {
    assertExactStatementCount(
      statements,
      `CREATE TYPE "public"."${enumName}"`,
      1,
      migrationPath
    );
  }
  const dispatchPlanStatements = statements.filter((statement) =>
    statement.startsWith('CREATE TABLE "inbox_v2_file_outbound_dispatch_plans"')
  );
  if (
    dispatchPlanStatements.length !== 1 ||
    dispatchPlanStatements[0].includes('"content_digest_sha256"') ||
    requiredDispatchPlanColumnDefinitions.some(
      (definition) => !dispatchPlanStatements[0].includes(definition)
    )
  ) {
    throw new Error(
      `${migrationPath} must persist only the finite HMAC content fingerprint and complete immutable adapter load snapshot in the outbound dispatch plan.`
    );
  }
  for (const columnName of nullableBridgeColumns) {
    const matches = statements.filter((statement) =>
      statement.includes(
        `ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "${columnName}"`
      )
    );
    if (
      matches.length !== 1 ||
      !new RegExp(`ADD COLUMN "${columnName}" text;$`, "u").test(matches[0])
    ) {
      throw new Error(
        `${migrationPath} must add nullable N-1 bridge column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }
  for (const columnName of nullableRevisionBridgeColumns) {
    const matches = statements.filter((statement) =>
      statement.includes(
        `ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "${columnName}"`
      )
    );
    if (
      matches.length !== 1 ||
      !new RegExp(`ADD COLUMN "${columnName}" bigint;$`, "u").test(matches[0])
    ) {
      throw new Error(
        `${migrationPath} must add nullable N-1 bridge column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }
  for (const [columnName, sqlTypePattern] of nullableAttachmentAnchorColumns) {
    const matches = statements.filter((statement) =>
      statement.includes(
        `ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "${columnName}"`
      )
    );
    if (
      matches.length !== 1 ||
      !new RegExp(`ADD COLUMN "${columnName}" ${sqlTypePattern};$`, "u").test(
        matches[0]
      )
    ) {
      throw new Error(
        `${migrationPath} must add nullable N-1 attachment-anchor column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }
  assertExactStatementCount(
    statements,
    `DROP CONSTRAINT "${replacedCheckConstraint}"`,
    1,
    migrationPath
  );
  assertExactStatementCount(
    statements,
    `ADD CONSTRAINT "${replacedCheckConstraint}" CHECK`,
    1,
    migrationPath
  );
  assertExactStatementCount(
    statements,
    `ALTER TABLE "inbox_v2_action_attributions" DROP CONSTRAINT "${replacedCauseEventForeignKey}"`,
    1,
    migrationPath
  );
  const causeEventIndexStatements = statements.filter((statement) =>
    statement.includes(`CREATE INDEX "${causeEventIndex}"`)
  );
  if (
    causeEventIndexStatements.length !== 1 ||
    !causeEventIndexStatements[0].includes(
      'ON "inbox_v2_action_attributions" USING btree ("tenant_id","automation_cause_event_id")'
    ) ||
    !causeEventIndexStatements[0].includes(
      'WHERE "inbox_v2_action_attributions"."automation_cause_event_id" is not null'
    )
  ) {
    throw new Error(
      `${migrationPath} must create the exact partial cause-event lookup index.`
    );
  }
}

function assertAdapterSnapshotInvariant(invariantSql) {
  for (const fragment of requiredAdapterSnapshotInvariantFragments) {
    if (!invariantSql.includes(fragment)) {
      throw new Error(
        `${invariantPath} must pin outbound dispatch plans to the exact adapter load snapshot: ${fragment}.`
      );
    }
  }
}

function assertAttachmentAnchorInvariant(invariantSql) {
  for (const fragment of [
    "inbox_v2_message_attachment_anchors_owner_message_fk",
    "deferrable initially deferred not valid",
    "inbox_v2_msg003_attachment_anchor_guard",
    "inbox_v2.message_attachment_anchor_owner_required",
    "inbox_v2.message_attachment_anchor_transition_invalid",
    "pg_catalog.pg_trigger_depth() > 1\n       and not exists (",
    "inbox_v2_msg003_attachment_anchor_coherence",
    "anchor_row.owner_timeline_content_id = payload_row.content_id",
    "anchor_row.materialization_state = payload_row.attachment_state",
    "create or replace function public.inbox_v2_msg003_action_attribution_cause_event_coherence()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public, pg_temp",
    "from public.event_store event_row",
    "from public.inbox_v2_domain_events event_row",
    "for key share",
    "inbox_v2.action_attribution_cause_event_missing",
    "create constraint trigger inbox_v2_msg003_action_attribution_cause_event_coherence\nafter insert or update on public.inbox_v2_action_attributions\ndeferrable initially deferred for each row",
    "create or replace function public.inbox_v2_msg003_legacy_cause_event_guard()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public, pg_temp",
    "inbox_v2.action_attribution_legacy_cause_event_referenced",
    "create trigger inbox_v2_msg003_legacy_cause_event_guard\nbefore update or delete on public.event_store"
  ]) {
    if (!invariantSql.includes(fragment)) {
      throw new Error(
        `${anchorInvariantPath} must contain the exact MSG-003 attachment-anchor closure: ${fragment}.`
      );
    }
  }
}

function assertAttachmentAuthorizationInvariant(invariantSql) {
  for (const fragment of [
    "create or replace function public.inbox_v2_auth_attachment_message_change_valid(",
    "message_change.resulting_revision >= 2",
    "message_change.payload_reference =\n         expected_command_result_reference",
    "content_revision_row.transition_kind = 'attachment_materialization'",
    "content_revision_row.event_id = message_event.id",
    "revision_row.change_kind = 'attachment_materialized'",
    "attribution_row.app_actor_kind = 'trusted_service'",
    "attribution_row.automation_cause_event_id is not null",
    "job_row.cause_event_id =\n              attribution_row.automation_cause_event_id",
    "job_row.authorization_actor_kind = 'trusted_service'",
    "expected_audit_revision_delta_hash <>\n         'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'",
    "create or replace function public.inbox_v2_auth_domain_mutation_coherence()",
    "'core:attachment.materialization.complete'",
    "inbox_v2.domain_mutation_attachment_cardinality_invalid"
  ]) {
    if (!invariantSql.includes(fragment)) {
      throw new Error(
        `${authorizationInvariantPath} must contain the exact MSG-003 attachment authorization closure: ${fragment}.`
      );
    }
  }
  for (const functionName of attachmentAuthorizationFunctionNames) {
    if (
      countOccurrences(
        invariantSql,
        `create or replace function ${functionName}`
      ) !== 1
    ) {
      throw new Error(
        `${authorizationInvariantPath} must define ${functionName} exactly once in the MSG-003 authorization replacement.`
      );
    }
  }
}

function assertAdditiveGeneratedDdl(statements) {
  const joined = statements.join("\n");
  for (const forbidden of [
    /\bDROP\s+(?:TABLE|COLUMN|TYPE|INDEX|SCHEMA)\b/iu,
    /\bTRUNCATE\b/iu,
    /\bDELETE\s+FROM\b/iu,
    /\bINSERT\s+INTO\b/iu,
    /\bUPDATE\s+[^\s]+\s+SET\b/iu,
    /\bALTER\s+COLUMN\b/iu,
    /\bSET\s+NOT\s+NULL\b/iu,
    /\bRENAME\s+(?:TO|COLUMN|CONSTRAINT)\b/iu,
    /\bCREATE\s+(?:MATERIALIZED\s+)?VIEW\b/iu,
    /\bDO\s+\$/iu
  ]) {
    if (forbidden.test(joined)) {
      throw new Error(
        `${migrationPath} contains destructive or backfill DDL: ${forbidden}.`
      );
    }
  }

  const dropStatements = statements.filter((statement) =>
    /\bDROP\b/iu.test(statement)
  );
  const expectedReplacements = new Set([
    `ALTER TABLE "inbox_v2_timeline_content_payloads" DROP CONSTRAINT "${replacedCheckConstraint}";`,
    `ALTER TABLE "inbox_v2_action_attributions" DROP CONSTRAINT "${replacedCauseEventForeignKey}";`
  ]);
  if (
    dropStatements.length !== expectedReplacements.size ||
    dropStatements.some((statement) => !expectedReplacements.has(statement))
  ) {
    throw new Error(
      `${migrationPath} may only replace the reviewed TimelineContent payload CHECK and legacy action-attribution cause-event FK; found ${dropStatements.length} DROP statement(s).`
    );
  }
}

function assertExactStatementCount(statements, fragment, expected, path) {
  const count = statements.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (count !== expected) {
    throw new Error(
      `${path} must contain ${fragment} exactly ${expected} time(s); found ${count}.`
    );
  }
}

function extractRawSql(sourceText, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = String\\.raw\`([\\s\\S]*?)\`;`
  );
  const match = sourceText.match(pattern);
  if (!match?.[1]) throw new Error(`Could not extract ${exportName}.`);
  return match[1].trim();
}

function extractSqlFunctionDefinition(sql, functionName) {
  const normalized = sql.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(
    `create or replace function ${functionName}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(
      `Could not extract the complete SQL definition for ${functionName}.`
    );
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length).trim();
}

function splitMigrationStatements(value) {
  return value
    .replaceAll("\r\n", "\n")
    .split(/\s*-->\s*statement-breakpoint\s*/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function countOccurrences(value, fragment) {
  if (fragment.length === 0) return 0;
  return value.split(fragment).length - 1;
}
