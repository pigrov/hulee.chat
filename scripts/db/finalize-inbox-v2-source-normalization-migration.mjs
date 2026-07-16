import { readFile, writeFile } from "node:fs/promises";

const refresh = process.argv.includes("--refresh");
const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0043_inbox_v2_source_normalization.sql";
const invariantPath = "packages/db/src/schema/inbox-v2/source-normalization.ts";
const invariantExportName = "INBOX_V2_SOURCE_NORMALIZATION_INTEGRITY_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_SOURCE_NORMALIZATION_FINALIZED_V1";

const migrationSql = await readFile(migrationPath, "utf8");
const migrationStatements = splitMigrationStatements(migrationSql);
let generatedStatements;
if (refresh) {
  if (
    !migrationSql.includes(finalizedMarker) ||
    migrationStatements.length < 2
  ) {
    throw new Error(
      `${migrationPath} can only be refreshed after its first finalization.`
    );
  }
  generatedStatements = migrationStatements.slice(0, -1);
} else {
  if (migrationSql.includes(finalizedMarker)) {
    throw new Error(`${migrationPath} is already finalized.`);
  }
  generatedStatements = migrationStatements;
}

for (const fragment of [
  'CREATE TYPE "public"."inbox_v2_source_normalization_outcome"',
  'CREATE TABLE "inbox_v2_source_normalized_envelopes"',
  'CREATE TABLE "inbox_v2_source_normalized_evidence"',
  'CREATE TABLE "inbox_v2_source_normalized_evidence_payloads"',
  'CREATE TABLE "inbox_v2_source_normalized_quarantines"',
  'CREATE TABLE "inbox_v2_source_normalization_results"'
]) {
  if (!generatedStatements.some((statement) => statement.includes(fragment))) {
    throw new Error(`${migrationPath} is missing generated DDL: ${fragment}`);
  }
}

const invariantSource = await readFile(invariantPath, "utf8");
const invariantSql = extractRawSql(invariantSource, invariantExportName);
const finalizedStatements = [
  ...generatedStatements,
  `-- ${finalizedMarker}\n${invariantSql}`
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: ${generatedStatements.length} generated DDL statements + 1 schema-owned invariant block.`
);

function extractRawSql(sourceText, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = String\\.raw\`([\\s\\S]*?)\`;`
  );
  const match = sourceText.match(pattern);
  if (!match?.[1]) throw new Error(`Could not extract ${exportName}.`);
  return match[1].trim();
}

function splitMigrationStatements(value) {
  return value
    .split(/\s*-->\s*statement-breakpoint\s*/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}
