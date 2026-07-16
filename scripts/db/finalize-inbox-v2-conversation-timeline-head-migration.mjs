import { readFile, writeFile } from "node:fs/promises";

const refresh = process.argv.includes("--refresh");
const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0038_inbox_v2_conversation_timeline_head_integrity.sql";
const preflightPath =
  "scripts/db/inbox-v2-conversation-timeline-head-preflight.sql";
const invariantPath =
  "packages/db/src/schema/inbox-v2/conversation-timeline-head-integrity.ts";
const invariantExportName = "INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_CONVERSATION_TIMELINE_HEAD_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_CONVERSATION_TIMELINE_HEAD_PREFLIGHT_V1";
const migrationSql = await readFile(migrationPath, "utf8");
const migrationStatements = splitMigrationStatements(migrationSql);
let generatedStatements;
if (refresh) {
  if (
    !migrationSql.includes(finalizedMarker) ||
    !migrationStatements[0]?.includes(preflightMarker) ||
    migrationStatements.length < 3
  ) {
    throw new Error(
      `${migrationPath} can only be refreshed after its first reviewed finalization.`
    );
  }
  generatedStatements = migrationStatements.slice(1, -1);
} else {
  if (migrationSql.includes(finalizedMarker)) {
    throw new Error(`${migrationPath} is already finalized.`);
  }
  generatedStatements = migrationStatements;
}

const requiredGeneratedFragments = [
  'CREATE TABLE "inbox_v2_conversation_identity_fences"',
  'ALTER TABLE "inbox_v2_conversation_identity_fences" ADD CONSTRAINT',
  'CREATE INDEX "inbox_v2_conversation_identity_fences_tenant_retired_idx"',
  'CREATE INDEX "inbox_v2_timeline_items_eligible_activity_tail_idx"'
];
if (
  generatedStatements.length !== requiredGeneratedFragments.length ||
  requiredGeneratedFragments.some(
    (fragment, index) => !generatedStatements[index]?.includes(fragment)
  )
) {
  throw new Error(
    `${migrationPath} must contain the ordered Drizzle-generated identity-fence and eligible-tail index DDL statements.`
  );
}

const [preflightSource, invariantSource] = await Promise.all([
  readFile(preflightPath, "utf8"),
  readFile(invariantPath, "utf8")
]);
const preflightSql = preflightSource.trim();
if (
  !preflightSql.startsWith(`-- ${preflightMarker}`) ||
  countOccurrences(preflightSql, preflightMarker) !== 1
) {
  throw new Error(
    `Conversation timeline-head preflight must start with ${preflightMarker} exactly once.`
  );
}

const invariantSql = extractRawSql(invariantSource, invariantExportName);
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...generatedStatements,
  invariantSql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: preflight + ${generatedStatements.length} generated DDL statements + 1 schema-owned invariant block.`
);

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

function splitMigrationStatements(value) {
  return value
    .split(/\s*-->\s*statement-breakpoint\s*/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}
