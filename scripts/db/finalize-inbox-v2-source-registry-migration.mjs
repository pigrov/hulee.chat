import { readFile, writeFile } from "node:fs/promises";

import { generateExpectedDrizzleMigration } from "../checks/db-check-lib.mjs";

const refresh = process.argv.includes("--refresh");
const regenerate = process.argv.includes("--regenerate");
const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0039_inbox_v2_source_registry.sql";
const preflightPath = "scripts/db/inbox-v2-source-registry-preflight.sql";
const invariantPath = "packages/db/src/schema/inbox-v2/source-registry.ts";
const invariantExportName = "INBOX_V2_SOURCE_REGISTRY_INTEGRITY_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_SOURCE_REGISTRY_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_SOURCE_REGISTRY_PREFLIGHT_V1";
const migrationSql = await readFile(migrationPath, "utf8");
const migrationStatements = splitMigrationStatements(migrationSql);
let generatedStatements;
let regeneratedSnapshot;
if (regenerate) {
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory: "packages/db/drizzle",
    baseIndex: 38,
    targetIndex: 39
  });
  generatedStatements = generated.statements;
  regeneratedSnapshot = generated.snapshot;
} else if (refresh) {
  if (
    !migrationSql.includes(finalizedMarker) ||
    !migrationStatements[0]?.includes(preflightMarker) ||
    migrationStatements.length < 4
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
  'CREATE TYPE "public"."inbox_v2_source_registry_actor_kind"',
  'CREATE TABLE "inbox_v2_source_registry_transitions"',
  'CREATE TABLE "inbox_v2_source_registry_heads"',
  'ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_transition_fk"',
  'CONSTRAINT "inbox_v2_source_registry_ingress_routes_digest_unique" UNIQUE'
];
for (const fragment of requiredGeneratedFragments) {
  if (!generatedStatements.some((statement) => statement.includes(fragment))) {
    throw new Error(`${migrationPath} is missing generated DDL: ${fragment}`);
  }
}

const prerequisiteUniqueConstraintNames = [
  "channel_auth_challenges_tenant_id_unique",
  "channel_auth_challenges_tenant_id_connector_unique",
  "channel_connectors_tenant_id_unique",
  "channel_connectors_tenant_id_connection_unique",
  "channel_provider_validation_jobs_tenant_id_unique",
  "channel_session_events_tenant_id_unique",
  "channel_session_events_tenant_exact_unique",
  "channel_sessions_tenant_id_unique",
  "channel_sessions_tenant_id_connector_unique"
];
const prerequisiteUniqueStatements = [];
const remainingGeneratedStatements = [];
for (const statement of generatedStatements) {
  const constraintName = prerequisiteUniqueConstraintNames.find((name) =>
    statement.includes(`ADD CONSTRAINT "${name}" UNIQUE`)
  );
  if (constraintName === undefined) {
    remainingGeneratedStatements.push(statement);
  } else {
    prerequisiteUniqueStatements.push(statement);
  }
}
if (
  prerequisiteUniqueStatements.length !==
  prerequisiteUniqueConstraintNames.length
) {
  throw new Error(
    `${migrationPath} must contain all ${prerequisiteUniqueConstraintNames.length} prerequisite composite unique constraints.`
  );
}
prerequisiteUniqueStatements.sort(
  (left, right) =>
    prerequisiteUniqueConstraintNames.findIndex((name) => left.includes(name)) -
    prerequisiteUniqueConstraintNames.findIndex((name) => right.includes(name))
);

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
    `Source-registry preflight must start with ${preflightMarker} exactly once.`
  );
}

const invariantSql = extractRawSql(invariantSource, invariantExportName);
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...prerequisiteUniqueStatements,
  ...remainingGeneratedStatements,
  invariantSql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);
if (regeneratedSnapshot !== undefined) {
  await writeFile(
    "packages/db/drizzle/meta/0039_snapshot.json",
    `${JSON.stringify(regeneratedSnapshot, null, 2)}\n`,
    "utf8"
  );
}

console.log(
  `Finalized ${migrationPath}: preflight + ${prerequisiteUniqueStatements.length} prerequisite unique constraints + ${remainingGeneratedStatements.length} generated DDL statements + 1 schema-owned invariant block.`
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
