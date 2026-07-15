import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0036_inbox_v2_repository_foundation.sql";
const preflightPath = "scripts/db/inbox-v2-repository-foundation-preflight.sql";
const repositorySchemaPath =
  "packages/db/src/schema/inbox-v2/repository-foundation.ts";
const membershipBoundaryPath =
  "packages/db/src/schema/inbox-v2/membership-privilege-boundary.ts";
const repositoryInvariantExport =
  "INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL";
const membershipBoundaryExport = "INBOX_V2_MEMBERSHIP_PRIVILEGE_BOUNDARY_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_REPOSITORY_FOUNDATION_PREFLIGHT_V1";
const streamChangeImmutableTrigger = "inbox_v2_auth_immutable_dbcc9ea93cbd94ba";
const generatedEnumNames = [
  "inbox_v2_outbox_outcome_kind",
  "inbox_v2_outbox_work_state",
  "inbox_v2_projection_generation_state"
];
const generatedTableNames = [
  "inbox_v2_outbox_outcomes",
  "inbox_v2_outbox_work_items",
  "inbox_v2_projection_checkpoints",
  "inbox_v2_projection_generations",
  "inbox_v2_projection_heads",
  "inbox_v2_tenant_stream_retention_advances"
];
const replacedFunctionNames = [
  "inbox_v2_auth_reject_immutable",
  "inbox_v2_auth_stream_head_guard"
];
const partialFunctionNames = [
  "inbox_v2_advance_tenant_stream_retained_prefix_v1",
  "inbox_v2_repository_projection_checkpoint_guard",
  "inbox_v2_repository_projection_head_coherence",
  "inbox_v2_repository_outbox_intent_work_init",
  "inbox_v2_repository_outbox_work_guard",
  "inbox_v2_repository_outbox_finalize_coherence",
  "inbox_v2_repository_outbox_outcome_immutable",
  "inbox_v2_repository_retention_advance_immutable",
  "inbox_v2_lock_conversation_membership_head_v1",
  "inbox_v2_lock_participant_membership_mutation_v1",
  "inbox_v2_apply_participant_membership_mutation_v1"
];
const membershipFunctionNames = new Set([
  "inbox_v2_lock_conversation_membership_head_v1",
  "inbox_v2_lock_participant_membership_mutation_v1",
  "inbox_v2_apply_participant_membership_mutation_v1"
]);
const partialConstraintNames = [
  "accounts_tenant_id_unique",
  "inbox_v2_tenant_stream_commits_checkpoint_unique",
  "inbox_v2_tenant_stream_commits_identity_position_unique"
];
const partialIndexNames = [
  "inbox_v2_auth_collaborator_employee_conversation_idx",
  "inbox_v2_auth_collaborator_employee_work_item_idx",
  "inbox_v2_auth_structural_heads_conversation_org_actor_idx",
  "inbox_v2_auth_structural_heads_conversation_team_actor_idx",
  "inbox_v2_dg_hold_active_root_lookup_idx",
  "inbox_v2_participant_membership_internal_actor_idx",
  "inbox_v2_timeline_contents_retention_eligible_idx",
  "inbox_v2_work_item_primary_assignment_employee_active_idx"
];
const parentUniqueFragments = [
  'ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_unique" UNIQUE',
  'ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_checkpoint_unique" UNIQUE',
  'ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_identity_position_unique" UNIQUE'
];
const allowedConstraintDropFragments = [
  'ALTER TABLE "inbox_v2_tenant_stream_changes" DROP CONSTRAINT "inbox_v2_tenant_stream_changes_values_check"',
  'ALTER TABLE "inbox_v2_domain_events" DROP CONSTRAINT "inbox_v2_domain_events_commit_fk"',
  'ALTER TABLE "inbox_v2_outbox_intents" DROP CONSTRAINT "inbox_v2_outbox_intents_commit_fk"',
  'ALTER TABLE "inbox_v2_tenant_stream_changes" DROP CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk"',
  'ALTER TABLE "inbox_v2_data_governance_subject_links" DROP CONSTRAINT "inbox_v2_dg_subject_link_account_fk"'
];
const allowedStandaloneDrops = [
  'DROP INDEX "inbox_v2_dg_hold_data_class_tenant_idx"',
  'DROP INDEX "inbox_v2_dg_purpose_instance_tenant_idx"'
];

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker)) {
  if (process.argv.includes("--refresh-finalized-boundary")) {
    const [preflightSource, membershipSource] = await Promise.all([
      readFile(preflightPath, "utf8"),
      readFile(membershipBoundaryPath, "utf8")
    ]);
    const firstBreakpointIndex = migrationSql.indexOf(statementBreakpoint);
    const membershipStartMarker = `${statementBreakpoint}\ndo $role_bootstrap$`;
    const membershipStartIndex = migrationSql.lastIndexOf(
      membershipStartMarker
    );
    if (firstBreakpointIndex < 0 || membershipStartIndex < 0) {
      throw new Error(
        `${migrationPath} has no finalized preflight/boundary envelope.`
      );
    }
    const membershipBoundarySql = extractRawSql(
      membershipSource,
      membershipBoundaryExport
    );
    const refreshedSql =
      `-- ${finalizedMarker}\n${preflightSource.trim()}\n` +
      migrationSql.slice(firstBreakpointIndex, membershipStartIndex) +
      `${statementBreakpoint}\n${membershipBoundarySql}\n`;
    await writeFile(migrationPath, refreshedSql, "utf8");
    console.log(
      `Refreshed finalized DB-007 preflight and membership boundary in ${migrationPath}.`
    );
    process.exit(0);
  }
  throw new Error(`${migrationPath} is already finalized.`);
}

const generatedStatements = migrationSql
  .replaceAll("\r\n", "\n")
  .split(statementBreakpoint)
  .map((statement) => statement.trim())
  .filter(Boolean);

for (const [fragment, expectedCount] of [
  ...generatedEnumNames.map((enumName) => [
    `CREATE TYPE "public"."${enumName}"`,
    1
  ]),
  ...generatedTableNames.map((tableName) => [`CREATE TABLE "${tableName}"`, 1]),
  [
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD COLUMN "state_reason_id" text',
    1
  ],
  ['CONSTRAINT "inbox_v2_dg_subject_link_account_fk" FOREIGN KEY', 1],
  [
    'ALTER TABLE "inbox_v2_domain_events" ADD CONSTRAINT "inbox_v2_domain_events_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    1
  ],
  [
    'ALTER TABLE "inbox_v2_outbox_intents" ADD CONSTRAINT "inbox_v2_outbox_intents_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    1
  ],
  [
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    1
  ],
  [
    'CONSTRAINT "inbox_v2_tenant_stream_commits_identity_position_unique" UNIQUE',
    1
  ],
  ['CONSTRAINT "inbox_v2_tenant_stream_commits_checkpoint_unique" UNIQUE', 1],
  [
    'ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_unique" UNIQUE',
    1
  ],
  [
    'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_values_check" CHECK',
    1
  ]
]) {
  const count = generatedStatements.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (count !== expectedCount) {
    throw new Error(
      `Generated DB-007 migration must contain ${fragment} exactly ${expectedCount} time(s); found ${count}.`
    );
  }
}

assertGeneratedDdlSafety(generatedStatements);

const [preflightSource, repositorySource, membershipSource] = await Promise.all(
  [
    readFile(preflightPath, "utf8"),
    readFile(repositorySchemaPath, "utf8"),
    readFile(membershipBoundaryPath, "utf8")
  ]
);
assertExactInventory(
  "repository-foundation tables",
  extractMatches(repositorySource, /pgTable\(\s*"([^"]+)"/gu),
  generatedTableNames
);
assertExactInventory(
  "repository-foundation enums",
  extractMatches(repositorySource, /pgEnum\(\s*"([^"]+)"/gu),
  generatedEnumNames
);
const preflightSql = preflightSource.trim();
if (
  !preflightSql.startsWith(`-- ${preflightMarker}`) ||
  countOccurrences(preflightSql, preflightMarker) !== 1
) {
  throw new Error(
    `DB-007 preflight must start with ${preflightMarker} exactly once.`
  );
}
for (const partialObjectName of [
  ...generatedTableNames,
  ...generatedEnumNames,
  ...partialFunctionNames,
  ...partialConstraintNames,
  ...partialIndexNames
]) {
  const count = countOccurrences(preflightSql, `'${partialObjectName}'`);
  if (count !== 1) {
    throw new Error(
      `DB-007 preflight inventory must contain ${partialObjectName} exactly once; found ${count}.`
    );
  }
}
if (
  countOccurrences(
    preflightSql,
    "'column:inbox_v2_tenant_stream_changes.state_reason_id'"
  ) !== 1
) {
  throw new Error(
    "DB-007 preflight inventory must contain the state_reason_id partial-column guard exactly once."
  );
}
if (countOccurrences(preflightSql, `'${streamChangeImmutableTrigger}'`) !== 1) {
  throw new Error(
    `DB-007 preflight inventory must contain ${streamChangeImmutableTrigger} exactly once.`
  );
}

const disableStreamChangeImmutableTriggerSql = `alter table public.inbox_v2_tenant_stream_changes disable trigger ${streamChangeImmutableTrigger};`;
const tombstoneBackfillSql = String.raw`update public.inbox_v2_tenant_stream_changes
set state_reason_id = 'core:retention-tombstone'
where state_kind = 'tombstone'
  and state_reason_id is null;`;
const enableStreamChangeImmutableTriggerSql = `alter table public.inbox_v2_tenant_stream_changes enable trigger ${streamChangeImmutableTrigger};`;
const outboxBackfillSql = String.raw`insert into public.inbox_v2_outbox_work_items (
  tenant_id,
  intent_id,
  state,
  attempt_count,
  available_at,
  revision,
  created_at,
  updated_at
)
select intent_row.tenant_id,
       intent_row.id,
       'pending'::public.inbox_v2_outbox_work_state,
       0,
       intent_row.available_at,
       1,
       intent_row.created_at,
       intent_row.created_at
  from public.inbox_v2_outbox_intents intent_row
on conflict (tenant_id, intent_id) do nothing;`;

const parentUniqueStatements = parentUniqueFragments.map((fragment) =>
  generatedStatements.find((statement) => statement.includes(fragment))
);
if (parentUniqueStatements.some((statement) => statement === undefined)) {
  throw new Error(
    "Generated DB-007 migration is missing a same-tenant parent unique constraint."
  );
}
const parentUniqueStatementSet = new Set(parentUniqueStatements);
const orderedGeneratedStatements = generatedStatements.filter(
  (statement) => !parentUniqueStatementSet.has(statement)
);
const firstForeignKeyIndex = orderedGeneratedStatements.findIndex((statement) =>
  /^ALTER TABLE\b[\s\S]*\bADD CONSTRAINT\b[\s\S]*\bFOREIGN KEY\b/iu.test(
    statement
  )
);
if (firstForeignKeyIndex < 0) {
  throw new Error("Generated DB-007 migration contains no foreign keys.");
}
orderedGeneratedStatements.splice(
  firstForeignKeyIndex,
  0,
  ...parentUniqueStatements
);

const statements = [];
for (const statement of orderedGeneratedStatements) {
  statements.push(statement);
  if (
    statement.includes(
      'ALTER TABLE "inbox_v2_tenant_stream_changes" ADD COLUMN "state_reason_id" text'
    )
  ) {
    statements.push(
      disableStreamChangeImmutableTriggerSql,
      tombstoneBackfillSql,
      enableStreamChangeImmutableTriggerSql
    );
  }
}

const repositoryInvariantSql = extractRawSql(
  repositorySource,
  repositoryInvariantExport
);
const membershipBoundarySql = extractRawSql(
  membershipSource,
  membershipBoundaryExport
);
assertExactInventory(
  "repository-foundation invariant functions",
  extractMatches(
    `${repositoryInvariantSql}\n${membershipBoundarySql}`,
    /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/gu
  ),
  [...replacedFunctionNames, ...partialFunctionNames]
);
for (const functionName of partialFunctionNames) {
  const sourceBlock = membershipFunctionNames.has(functionName)
    ? membershipBoundarySql
    : repositoryInvariantSql;
  const count = countOccurrences(
    sourceBlock,
    `create or replace function public.${functionName}(`
  );
  if (count !== 1) {
    throw new Error(
      `DB-007 invariant SQL must define ${functionName} exactly once; found ${count}.`
    );
  }
}
for (const fragment of [
  "create role hulee_inbox_v2_retention_owner",
  "security definer",
  "owner to hulee_inbox_v2_retention_owner",
  "revoke all privileges on function",
  "to hulee_inbox_v2_runtime;",
  "do $retention_boundary_audit$"
]) {
  if (!repositoryInvariantSql.includes(fragment)) {
    throw new Error(
      `DB-007 retention boundary is missing required SQL: ${fragment}`
    );
  }
}
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...statements,
  outboxBackfillSql,
  repositoryInvariantSql,
  membershipBoundarySql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: verified ${generatedTableNames.length} tables and ${generatedEnumNames.length} enums; preflight + ${generatedStatements.length} generated DDL statements + 2 backfills (one immutable-trigger envelope) + repository invariants + membership privilege boundary.`
);

function assertGeneratedDdlSafety(statementsToCheck) {
  for (const statement of statementsToCheck) {
    const normalized = statement.trim();
    const withoutTerminalSemicolon = normalized.endsWith(";")
      ? normalized.slice(0, -1).trimEnd()
      : normalized;
    if (/^TRUNCATE\b/iu.test(normalized)) {
      throw new Error(
        `Generated DB-007 migration contains forbidden destructive DDL: ${normalized.slice(0, 180)}`
      );
    }
    if (/^DROP\b/iu.test(normalized)) {
      const allowed = allowedStandaloneDrops.includes(withoutTerminalSemicolon);
      if (!allowed) {
        throw new Error(
          `Generated DB-007 migration contains forbidden destructive DDL: ${normalized.slice(0, 180)}`
        );
      }
    }
    if (/^ALTER TABLE\b[\s\S]*\bDROP\b/iu.test(normalized)) {
      const allowed = allowedConstraintDropFragments.includes(
        withoutTerminalSemicolon
      );
      if (!allowed || /\bDROP\s+(?:COLUMN|TABLE)\b/iu.test(normalized)) {
        throw new Error(
          `Generated DB-007 migration contains an unreviewed destructive ALTER: ${normalized.slice(0, 180)}`
        );
      }
    }
  }
}

function extractRawSql(sourceText, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = String\\.raw\`([\\s\\S]*?)\`;`
  );
  const match = sourceText.match(pattern);
  if (!match?.[1]) {
    throw new Error(`Could not extract ${exportName}.`);
  }
  return match[1].trim();
}

function countOccurrences(value, fragment) {
  if (fragment.length === 0) return 0;
  return value.split(fragment).length - 1;
}

function extractMatches(value, pattern) {
  return [...new Set([...value.matchAll(pattern)].map((match) => match[1]))];
}

function assertExactInventory(label, actual, expected) {
  const sortedActual = [...actual].sort();
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(sortedActual) !== JSON.stringify(sortedExpected)) {
    throw new Error(
      `DB-007 ${label} inventory is stale: expected ${sortedExpected.join(
        ", "
      )}; found ${sortedActual.join(", ")}.`
    );
  }
}
