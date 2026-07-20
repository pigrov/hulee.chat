import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0055_inbox_v2_message_lifecycle_commands.sql";
const refresh = process.argv.includes("--refresh");
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_MESSAGE_LIFECYCLE_MIGRATION_FINALIZED_V1";

const sourceReconciliationPath =
  "packages/db/src/schema/inbox-v2/source-message-reconciliation.ts";
const sourceReconciliationExportName =
  "INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL";
const timelineMessagePath =
  "packages/db/src/schema/inbox-v2/timeline-message.ts";
const timelineMessageExportName = "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL";
const authorizationPath =
  "packages/db/src/schema/inbox-v2/authorization-relations.ts";
const authorizationExportName = "INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL";

const nullableColumns = [
  [
    "inbox_v2_deferred_message_source_action_transitions",
    "applied_provider_lifecycle_operation_id",
    "text"
  ],
  [
    "inbox_v2_deferred_message_source_action_transitions",
    "applied_provider_lifecycle_operation_revision",
    "bigint"
  ],
  [
    "inbox_v2_deferred_message_source_actions",
    "applied_provider_lifecycle_operation_id",
    "text"
  ],
  [
    "inbox_v2_deferred_message_source_actions",
    "applied_provider_lifecycle_operation_revision",
    "bigint"
  ]
];
const onlineForeignKeys = [
  "inbox_v2_deferred_action_transitions_message_revision_fk",
  "inbox_v2_deferred_action_transitions_provider_operation_fk",
  "inbox_v2_deferred_actions_applied_message_revision_fk",
  "inbox_v2_deferred_actions_applied_provider_operation_fk"
];
const replacedChecks = [
  "inbox_v2_deferred_action_transitions_state_check",
  "inbox_v2_deferred_actions_state_check"
];

const migrationSql = await readFile(migrationPath, "utf8");
let generatedStatements = splitMigrationStatements(migrationSql);
if (migrationSql.includes(finalizedMarker)) {
  if (!refresh) {
    throw new Error(`${migrationPath} is already finalized.`);
  }
  if (
    generatedStatements.at(-1)?.startsWith(`-- ${finalizedMarker}\n`) !==
      true ||
    countOccurrences(migrationSql, finalizedMarker) !== 1
  ) {
    throw new Error(`${migrationPath} has an invalid finalization tail.`);
  }
  generatedStatements = generatedStatements.slice(0, -1);
}

assertGeneratedInventory(generatedStatements);
generatedStatements = generatedStatements.map(
  makeExistingRelationDdlOnlineSafe
);
assertOnlineSafeInventory(generatedStatements);

const sourceReconciliationSql = extractRawSql(
  await readFile(sourceReconciliationPath, "utf8"),
  sourceReconciliationExportName
);
const deferredActionGuardFunction = extractSqlFunctionDefinition(
  sourceReconciliationSql,
  "public.inbox_v2_deferred_source_action_guard"
);
const deferredActionFunction = extractSqlFunctionDefinition(
  sourceReconciliationSql,
  "public.inbox_v2_deferred_source_action_assert"
);
const timelineMessageSql = extractRawSql(
  await readFile(timelineMessagePath, "utf8"),
  timelineMessageExportName
);
const outboundRouteActionFunction = extractSqlFunctionDefinition(
  timelineMessageSql,
  "public.inbox_v2_tm_outbound_route_action_valid"
);
const timelineMessageHistoryFunction = extractSqlFunctionDefinition(
  timelineMessageSql,
  "public.inbox_v2_tm_message_history_valid"
);
const timelineMessageAuxCoherenceFunction = extractSqlFunctionDefinition(
  timelineMessageSql,
  "public.inbox_v2_tm_aux_coherence"
);
const authorizationSql = extractRawSql(
  await readFile(authorizationPath, "utf8"),
  authorizationExportName
);
const authorizationFunction = extractSqlFunctionDefinition(
  authorizationSql,
  "public.inbox_v2_auth_domain_mutation_coherence"
);

assertDeferredActionGuardFunction(deferredActionGuardFunction);
assertDeferredActionFunction(deferredActionFunction);
assertOutboundRouteActionFunction(outboundRouteActionFunction);
assertTimelineMessageHistoryFunction(timelineMessageHistoryFunction);
assertTimelineMessageCoherenceFunction(timelineMessageAuxCoherenceFunction);
assertAuthorizationFunction(authorizationFunction);

const finalizedStatements = [
  ...generatedStatements,
  `-- ${finalizedMarker}\n${deferredActionGuardFunction}\n\n${deferredActionFunction}\n\n${outboundRouteActionFunction}\n\n${timelineMessageHistoryFunction}\n\n${timelineMessageAuxCoherenceFunction}\n\n${authorizationFunction}`
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: ${generatedStatements.length} online-safe generated DDL statements + 6 exact schema-owned function replacements.`
);

function assertGeneratedInventory(statements) {
  for (const [tableName, columnName, dataType] of nullableColumns) {
    const expected = `ALTER TABLE "${tableName}" ADD COLUMN "${columnName}" ${dataType};`;
    assertExactStatementCount(statements, expected, 1);
  }
  for (const constraintName of onlineForeignKeys) {
    assertExactStatementCount(
      statements,
      `ADD CONSTRAINT "${constraintName}" FOREIGN KEY`,
      1
    );
  }
  for (const constraintName of replacedChecks) {
    assertExactStatementCount(
      statements,
      `DROP CONSTRAINT "${constraintName}"`,
      1
    );
    assertExactStatementCount(
      statements,
      `ADD CONSTRAINT "${constraintName}" CHECK`,
      1
    );
  }

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
  if (
    dropStatements.length !== replacedChecks.length ||
    dropStatements.some(
      (statement) =>
        !replacedChecks.some((constraintName) =>
          statement.includes(`DROP CONSTRAINT "${constraintName}"`)
        )
    )
  ) {
    throw new Error(
      `${migrationPath} may only replace the two reviewed deferred-action state checks.`
    );
  }
}

function makeExistingRelationDdlOnlineSafe(statement) {
  const isReviewedForeignKey = onlineForeignKeys.some((constraintName) =>
    statement.includes(`ADD CONSTRAINT "${constraintName}" FOREIGN KEY`)
  );
  const isReviewedCheck = replacedChecks.some((constraintName) =>
    statement.includes(`ADD CONSTRAINT "${constraintName}" CHECK`)
  );
  if (!isReviewedForeignKey && !isReviewedCheck) return statement;
  if (/\sNOT VALID;$/u.test(statement)) return statement;
  if (!statement.endsWith(";")) {
    throw new Error(`Cannot mark malformed constraint statement NOT VALID.`);
  }
  return `${statement.slice(0, -1)} NOT VALID;`;
}

function assertOnlineSafeInventory(statements) {
  for (const constraintName of [...onlineForeignKeys, ...replacedChecks]) {
    const matches = statements.filter((statement) =>
      statement.includes(`ADD CONSTRAINT "${constraintName}"`)
    );
    if (matches.length !== 1 || !matches[0].endsWith(" NOT VALID;")) {
      throw new Error(
        `${constraintName} must be installed NOT VALID for the populated N-1 upgrade.`
      );
    }
  }
}

function assertDeferredActionGuardFunction(sql) {
  for (const mutableColumn of [
    "applied_provider_lifecycle_operation_id",
    "applied_provider_lifecycle_operation_revision"
  ]) {
    const quotedColumn = `'${mutableColumn}'`;
    if (countOccurrences(sql, quotedColumn) !== 3) {
      throw new Error(
        `${sourceReconciliationPath} must include ${quotedColumn} in all three exact deferred-action mutable-column allowlists.`
      );
    }
  }
  for (const fragment of [
    "create or replace function public.inbox_v2_deferred_source_action_guard()",
    "immutable_columns_changed := (",
    "message = 'inbox_v2.deferred_source_action_cas'",
    "message = 'inbox_v2.deferred_source_action_applied_target_mismatch'"
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${sourceReconciliationPath} is missing exact deferred lifecycle guard ${fragment}.`
      );
    }
  }
}

function assertDeferredActionFunction(sql) {
  for (const fragment of [
    "applied_provider_lifecycle_operation_id",
    "inbox_v2.deferred_source_action_applied_revision_missing",
    "inbox_v2.deferred_source_action_lifecycle_effect_mismatch",
    "inbox_v2.deferred_source_action_retain_local_effect_mismatch",
    "operation_row.source_occurrence_id = new.source_occurrence_id",
    "operation_row.source_thread_binding_id = new.source_thread_binding_id",
    "operation_row.binding_generation = new.binding_generation"
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${sourceReconciliationPath} is missing exact deferred lifecycle anchor ${fragment}.`
      );
    }
  }
}

function assertOutboundRouteActionFunction(sql) {
  for (const fragment of [
    "create or replace function public.inbox_v2_tm_outbound_route_action_valid(",
    "capability_row.valid_until > expected_authority_at",
    "route_row.required_conversation_permission_id =\n         expected_required_permission_id"
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${timelineMessagePath} is missing exact lifecycle route fence ${fragment}.`
      );
    }
  }
  if (sql.includes("capability_row.valid_until >= expected_authority_at")) {
    throw new Error(
      `${timelineMessagePath} must expire lifecycle capability exactly at valid_until.`
    );
  }
}

function assertTimelineMessageHistoryFunction(sql) {
  for (const fragment of [
    "create or replace function public.inbox_v2_tm_message_history_valid(",
    "history_row.message_revision = 1",
    "history_row.change_kind = 'created'",
    "message_row.origin_kind = 'migration'",
    "attribution_row.action_participant_id =\n                    message_row.author_participant_id",
    "attribution_row.app_actor_kind = 'trusted_service'",
    "attribution_row.source_occurrence_id is null",
    "attribution_row.automation_kind is not null",
    "migration_author_row.subject_kind in (\n                         'legacy_unknown', 'system'"
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${timelineMessagePath} is missing exact migration-history fence ${fragment}.`
      );
    }
  }
}

function assertTimelineMessageCoherenceFunction(sql) {
  for (const fragment of [
    "left join public.inbox_v2_outbound_routes lifecycle_route_row",
    "lifecycle_route_row.required_conversation_permission_id =\n              'core:conversation.read'",
    "lifecycle_route_row.required_conversation_permission_id,"
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${timelineMessagePath} is missing exact lifecycle route authority ${fragment}.`
      );
    }
  }
  for (const actionPermissionId of [
    "core:message.edit_own",
    "core:message.delete_own",
    "core:message.moderate_external"
  ]) {
    if (sql.includes(`'${actionPermissionId}'`)) {
      throw new Error(
        `${timelineMessagePath} must not use action permission ${actionPermissionId} as lifecycle route authority.`
      );
    }
  }
  if (sql.includes("'core:message.' || op_row.action::text || '_external'")) {
    throw new Error(
      `${timelineMessagePath} must not synthesize a lifecycle route permission.`
    );
  }
}

function assertAuthorizationFunction(sql) {
  for (const fragment of [
    "'core:provider.message_lifecycle'",
    "'core:inbox-v2.message-provider-lifecycle-operation'",
    "lifecycle_change.entity_type_id =",
    "revision_row.provider_operation_id =",
    "operation_row.action = 'delete'",
    "and not exists ("
  ]) {
    if (!sql.includes(fragment)) {
      throw new Error(
        `${authorizationPath} is missing provider lifecycle outbox closure ${fragment}.`
      );
    }
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

function assertExactStatementCount(statements, fragment, expected) {
  const count = statements.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (count !== expected) {
    throw new Error(
      `${migrationPath} must contain ${fragment} exactly ${expected} time(s); found ${count}.`
    );
  }
}

function countOccurrences(value, fragment) {
  if (fragment.length === 0) return 0;
  return value.split(fragment).length - 1;
}
