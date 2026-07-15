import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0032_inbox_v2_employee_conversation_state.sql";
const preflightPath =
  "scripts/db/inbox-v2-employee-conversation-state-preflight.sql";
const invariantPath =
  "packages/db/src/schema/inbox-v2/employee-conversation-state.ts";
const invariantExportName =
  "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_PREFLIGHT_V1";

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker)) {
  throw new Error(`${migrationPath} is already finalized.`);
}

const statements = migrationSql
  .replaceAll("\r\n", "\n")
  .split(statementBreakpoint)
  .map((statement) => statement.trim())
  .filter(Boolean);
for (const [fragment, expectedCount] of [
  [
    'CREATE TYPE "public"."inbox_v2_employee_conversation_notification_level"',
    1
  ],
  ['CREATE TABLE "inbox_v2_employee_conversation_states"', 1],
  [
    'CONSTRAINT "inbox_v2_employee_conversation_states_employee_fk" FOREIGN KEY',
    1
  ],
  [
    'CONSTRAINT "inbox_v2_employee_conversation_states_conversation_fk" FOREIGN KEY',
    1
  ]
]) {
  const count = statements.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (count !== expectedCount) {
    throw new Error(
      `Generated DB-006 migration must contain ${fragment} exactly ${expectedCount} time(s); found ${count}.`
    );
  }
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
    `DB-006 preflight must start with ${preflightMarker} exactly once.`
  );
}
const invariantSql = extractRawSql(invariantSource, invariantExportName);
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...statements,
  invariantSql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: preflight + ${statements.length} DDL statements + 1 invariant block.`
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
