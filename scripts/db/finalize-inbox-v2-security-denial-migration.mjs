import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { assertAdditiveMigrationStatements } from "../checks/db-check-lib.mjs";

const refreshFinalized = process.argv.includes("--refresh-finalized");
const migrationPath =
  process.argv
    .slice(2)
    .find((argument) => argument !== "--refresh-finalized") ??
  "packages/db/drizzle/0035_inbox_v2_security_denial_sink.sql";
const preflightPath = "scripts/db/inbox-v2-security-denial-preflight.sql";
const schemaPath = "packages/db/src/schema/inbox-v2/security-denial.ts";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_SECURITY_DENIAL_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_SECURITY_DENIAL_PREFLIGHT_V1";

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker) && !refreshFinalized) {
  throw new Error(`${migrationPath} is already finalized.`);
}

const generatedMigrationSql = refreshFinalized
  ? extractGeneratedStatementsFromFinalizedMigration(migrationSql)
  : migrationSql;

const statements = generatedMigrationSql
  .replaceAll("\r\n", "\n")
  .split(statementBreakpoint)
  .map((statement) => statement.trim())
  .filter(Boolean);
assertAdditiveMigrationStatements(
  statements,
  "Inbox V2 RBAC-007 security-denial migration finalizer"
);

const [preflightSource, schemaSource] = await Promise.all([
  readFile(preflightPath, "utf8"),
  readFile(schemaPath, "utf8")
]);
const expectedTables = extractSchemaObjectNames(schemaSource, "pgTable");
const expectedEnums = extractSchemaObjectNames(schemaSource, "pgEnum");
if (expectedTables.length !== 3 || expectedEnums.length !== 11) {
  throw new Error(
    `RBAC-007 schema must declare exactly 3 tables and 11 enums; found ${expectedTables.length}/${expectedEnums.length}.`
  );
}
for (const tableName of expectedTables) {
  assertGeneratedStatementCount(statements, `CREATE TABLE "${tableName}"`, 1);
}
for (const enumName of expectedEnums) {
  assertGeneratedStatementCount(
    statements,
    `CREATE TYPE "public"."${enumName}"`,
    1
  );
}
assertNoUnexpectedGeneratedSchemaObjects(
  statements,
  "table",
  expectedTables,
  /CREATE TABLE "([^"]+)"/g
);
assertNoUnexpectedGeneratedSchemaObjects(
  statements,
  "enum",
  expectedEnums,
  /CREATE TYPE "public"\."([^"]+)"/g
);

const preflightSql = preflightSource.trim();
if (
  !preflightSql.startsWith(`-- ${preflightMarker}`) ||
  countOccurrences(preflightSql, preflightMarker) !== 1
) {
  throw new Error(
    `RBAC-007 preflight must start with ${preflightMarker} exactly once.`
  );
}
assertExactPreflightObjectList(preflightSql, "TABLES", expectedTables);
assertExactPreflightObjectList(preflightSql, "TYPES", expectedEnums);

const invariantBlocks = extractRawSqlBlocks(schemaSource);
if (invariantBlocks.length !== 1) {
  throw new Error(
    `RBAC-007 schema must export exactly one invariant SQL block; found ${invariantBlocks.length}.`
  );
}
const invariantSql = invariantBlocks[0].sql;
if (invariantSql.includes("${")) {
  throw new Error(
    "RBAC-007 invariant SQL cannot contain unresolved templates."
  );
}
const invariantFunctions = extractUniqueNames(
  invariantSql,
  /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g,
  "function"
);
if (
  JSON.stringify([...invariantFunctions].sort()) !==
  JSON.stringify(
    [
      "inbox_v2_security_denial_integrity_guard",
      "inbox_v2_security_denial_prune",
      "inbox_v2_security_denial_record"
    ].sort()
  )
) {
  throw new Error(
    "RBAC-007 invariant SQL must declare only the canonical record and prune functions."
  );
}
assertExactPreflightObjectList(preflightSql, "FUNCTIONS", invariantFunctions);
for (const forbidden of [
  "inbox_v2_tenant_stream",
  "inbox_v2_domain_events",
  "inbox_v2_outbox",
  "jsonb",
  "json"
]) {
  if (invariantSql.includes(forbidden)) {
    throw new Error(
      `RBAC-007 invariant SQL contains forbidden sink dependency ${forbidden}.`
    );
  }
}

const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...statements,
  ...invariantBlocks.map(({ sql }) => sql)
];
const finalizedSql = `${finalizedStatements.join(
  `\n${statementBreakpoint}\n`
)}\n`;
const temporaryPath = `${migrationPath}.${process.pid}.tmp`;
try {
  await writeFile(temporaryPath, finalizedSql, {
    encoding: "utf8",
    flag: "wx"
  });
  await rename(temporaryPath, migrationPath);
} catch (error) {
  await rm(temporaryPath, { force: true }).catch(() => {});
  throw error;
}

console.log(
  `Finalized ${migrationPath}: preflight + ${statements.length} DDL statements + one invariant block; verified ${expectedTables.length} tables, ${expectedEnums.length} enums and ${invariantFunctions.length} functions.`
);

function extractSchemaObjectNames(sourceText, factoryName) {
  const pattern = new RegExp(`${factoryName}\\(\\s*"([^"]+)"`, "g");
  const names = [...sourceText.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error(`RBAC-007 schema declares duplicate ${factoryName} names.`);
  }
  return names;
}

function extractGeneratedStatementsFromFinalizedMigration(sourceText) {
  const generatedStart = sourceText.indexOf(
    'CREATE TYPE "public"."inbox_v2_security_denial_action"'
  );
  const invariantStart = sourceText.indexOf(
    "create or replace function public.inbox_v2_security_denial_record("
  );
  if (
    !sourceText.includes(finalizedMarker) ||
    generatedStart < 0 ||
    invariantStart <= generatedStart
  ) {
    throw new Error(
      "RBAC-007 finalized migration cannot be safely refreshed: generated/invariant boundaries are missing."
    );
  }
  return sourceText.slice(generatedStart, invariantStart).trim();
}

function extractRawSqlBlocks(sourceText) {
  const matches = [
    ...sourceText.matchAll(
      /export const (INBOX_V2_[A-Z0-9_]+(?:INTEGRITY|INVARIANTS)_SQL) = String\.raw`([\s\S]*?)`;/g
    )
  ];
  const names = matches.map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error("RBAC-007 schema exports duplicate invariant SQL names.");
  }
  return matches.map((match) => ({ name: match[1], sql: match[2].trim() }));
}

function extractUniqueNames(value, pattern, label) {
  const names = [...value.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error(
      `RBAC-007 invariant SQL declares duplicate ${label} names.`
    );
  }
  return names;
}

function assertNoUnexpectedGeneratedSchemaObjects(
  statementsToCheck,
  objectKind,
  expectedNames,
  pattern
) {
  const actualNames = [...statementsToCheck.join("\n").matchAll(pattern)].map(
    (match) => match[1]
  );
  const unexpectedNames = actualNames.filter(
    (name) => !expectedNames.includes(name)
  );
  if (unexpectedNames.length > 0) {
    throw new Error(
      `Generated RBAC-007 migration declares unexpected ${objectKind}(s): ${[
        ...new Set(unexpectedNames)
      ].join(", ")}.`
    );
  }
}

function assertExactPreflightObjectList(preflightSql, kind, expectedNames) {
  const beginMarker = `-- RBAC007_PARTIAL_${kind}_BEGIN`;
  const endMarker = `-- RBAC007_PARTIAL_${kind}_END`;
  if (
    countOccurrences(preflightSql, beginMarker) !== 1 ||
    countOccurrences(preflightSql, endMarker) !== 1
  ) {
    throw new Error(
      `RBAC-007 preflight must contain one exact ${kind.toLowerCase()} object-list boundary.`
    );
  }
  const start = preflightSql.indexOf(beginMarker) + beginMarker.length;
  const end = preflightSql.indexOf(endMarker, start);
  const actualNames = [
    ...preflightSql.slice(start, end).matchAll(/'([^']+)'/g)
  ].map((match) => match[1]);
  if (
    new Set(actualNames).size !== actualNames.length ||
    JSON.stringify([...actualNames].sort()) !==
      JSON.stringify([...expectedNames].sort())
  ) {
    throw new Error(
      `RBAC-007 preflight ${kind.toLowerCase()} list is stale against the schema/invariant SQL.`
    );
  }
}

function assertGeneratedStatementCount(statementsToCheck, fragment, expected) {
  const actual = statementsToCheck.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (actual !== expected) {
    throw new Error(
      `Generated RBAC-007 migration must contain ${fragment} exactly ${expected} time(s); found ${actual}.`
    );
  }
}

function countOccurrences(value, fragment) {
  return value.length === 0 || fragment.length === 0
    ? 0
    : value.split(fragment).length - 1;
}
