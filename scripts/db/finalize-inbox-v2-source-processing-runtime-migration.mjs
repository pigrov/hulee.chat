import { readFile, writeFile } from "node:fs/promises";

import { generateExpectedDrizzleMigration } from "../checks/db-check-lib.mjs";

const migrationPath =
  "packages/db/drizzle/0048_inbox_v2_source_processing_runtime.sql";
const snapshotPath = "packages/db/drizzle/meta/0048_snapshot.json";
const invariantPath =
  "packages/db/src/schema/inbox-v2/source-processing-runtime.ts";
const rawAdmissionInvariantPath =
  "packages/db/src/schema/inbox-v2/source-raw-ingress.ts";
const invariantExportName = "INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL";
const rawAdmissionInvariantExportName =
  "INBOX_V2_SOURCE_RAW_ADMISSION_INTEGRITY_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_SOURCE_PROCESSING_RUNTIME_FINALIZED_V1";

if (!process.argv.includes("--regenerate")) {
  throw new Error(
    "Source-processing runtime finalization requires an explicit --regenerate flag."
  );
}

const generated = await generateExpectedDrizzleMigration({
  workspaceRoot: process.cwd(),
  migrationDirectory: "packages/db/drizzle",
  baseIndex: 47,
  targetIndex: 48
});

for (const fragment of [
  'CREATE TYPE "public"."inbox_v2_source_processing_stage"',
  'CREATE TABLE "inbox_v2_source_processing_work_heads"',
  'CREATE TABLE "inbox_v2_source_delivery_dedupe_skeletons"',
  'CREATE TABLE "inbox_v2_source_raw_admissions"'
]) {
  if (!generated.statements.some((statement) => statement.includes(fragment))) {
    throw new Error(`${migrationPath} is missing generated DDL: ${fragment}`);
  }
}

const [invariantSource, rawAdmissionInvariantSource] = await Promise.all([
  readFile(invariantPath, "utf8"),
  readFile(rawAdmissionInvariantPath, "utf8")
]);
const invariantSql = extractRawSql(invariantSource, invariantExportName);
const rawAdmissionInvariantSql = extractRawSql(
  rawAdmissionInvariantSource,
  rawAdmissionInvariantExportName
);
if (!invariantSql.startsWith(`-- ${finalizedMarker}`)) {
  throw new Error(
    `${invariantExportName} must own the ${finalizedMarker} marker.`
  );
}
const finalizedStatements = [
  ...generated.statements,
  rawAdmissionInvariantSql,
  invariantSql
];

await Promise.all([
  writeFile(
    migrationPath,
    `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
    "utf8"
  ),
  writeFile(
    snapshotPath,
    `${JSON.stringify(generated.snapshot, null, 2)}\n`,
    "utf8"
  )
]);

console.log(
  `Finalized ${migrationPath}: ${generated.statements.length} generated DDL statements + 2 schema-owned invariant blocks.`
);

function extractRawSql(sourceText, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = String\\.raw\`([\\s\\S]*?)\`;`
  );
  const match = sourceText.match(pattern);
  if (!match?.[1]) throw new Error(`Could not extract ${exportName}.`);
  return match[1].trim();
}
