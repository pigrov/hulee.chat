import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { assertAdditiveMigrationStatements } from "../checks/db-check-lib.mjs";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0033_inbox_v2_data_governance_privacy.sql";
const preflightPath =
  "scripts/db/inbox-v2-data-governance-privacy-preflight.sql";
const schemaPath = "packages/db/src/schema/inbox-v2/data-governance-privacy.ts";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_DATA_GOVERNANCE_PRIVACY_PREFLIGHT_V1";

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker)) {
  throw new Error(`${migrationPath} is already finalized.`);
}

const statements = migrationSql
  .replaceAll("\r\n", "\n")
  .split(statementBreakpoint)
  .map((statement) => statement.trim())
  .filter(Boolean);
assertAdditiveMigrationStatements(
  statements,
  "Inbox V2 DB-009 migration finalizer"
);
const [preflightSource, schemaSource] = await Promise.all([
  readFile(preflightPath, "utf8"),
  readFile(schemaPath, "utf8")
]);

const expectedTables = extractSchemaObjectNames(schemaSource, "pgTable");
const expectedEnums = extractSchemaObjectNames(schemaSource, "pgEnum");
if (expectedTables.length === 0) {
  throw new Error("DB-009 schema must declare at least one pgTable.");
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
  countOccurrences(preflightSql, preflightMarker) !== 1 ||
  preflightSql.includes("DB009_PARTIAL_OBJECTS_PENDING")
) {
  throw new Error(
    `DB-009 preflight must start with ${preflightMarker} exactly once and contain no pending object list.`
  );
}
assertExactPreflightObjectList(preflightSql, "TABLES", expectedTables);
assertExactPreflightObjectList(preflightSql, "TYPES", expectedEnums);

const invariantBlocks = extractRawSqlBlocks(schemaSource);
if (invariantBlocks.length === 0) {
  throw new Error(
    "DB-009 schema must export at least one Inbox V2 invariant SQL block."
  );
}
const invariantSql = invariantBlocks.map(({ sql }) => sql).join("\n");
const invariantFunctions = extractInvariantObjectNames(
  invariantSql,
  /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
);
assertExactPreflightObjectList(preflightSql, "FUNCTIONS", invariantFunctions);
assertExactPreflightObjectList(
  preflightSql,
  "TRIGGERS",
  extractInvariantTriggerNames(invariantSql, {
    expectedTables,
    expectedFunctions: invariantFunctions
  })
);
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
  `Finalized ${migrationPath}: preflight + ${statements.length} DDL statements + ${invariantBlocks.length} invariant block(s); verified ${expectedTables.length} tables, ${expectedEnums.length} enums, ${invariantFunctions.length} functions.`
);

function extractSchemaObjectNames(sourceText, factoryName) {
  const pattern = new RegExp(`${factoryName}\\(\\s*"([^"]+)"`, "g");
  const names = [...sourceText.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error(`DB-009 schema declares duplicate ${factoryName} names.`);
  }
  return names;
}

function extractRawSqlBlocks(sourceText) {
  const matches = [
    ...sourceText.matchAll(
      /export const (INBOX_V2_[A-Z0-9_]+(?:INTEGRITY|INVARIANTS)_SQL) = String\.raw`([\s\S]*?)`;/g
    )
  ];
  const names = matches.map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error("DB-009 schema exports duplicate invariant SQL names.");
  }
  return matches.map((match) => ({ name: match[1], sql: match[2].trim() }));
}

function extractInvariantObjectNames(sql, pattern) {
  const names = [...sql.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error("DB-009 invariant SQL declares duplicate object names.");
  }
  return names;
}

function extractInvariantTriggerNames(
  sql,
  { expectedTables, expectedFunctions }
) {
  const expectedTableSet = new Set(expectedTables);
  const expectedFunctionSet = new Set(expectedFunctions);
  const literalNames = extractInvariantObjectNames(
    sql,
    /create (?:constraint )?trigger (inbox_v2_[a-z0-9_]+)/g
  );
  const literalDeclarations = [
    ...sql.matchAll(
      /create (?:constraint )?trigger (inbox_v2_[a-z0-9_]+)[\s\S]*?\bon public\.(inbox_v2_[a-z0-9_]+)[\s\S]*?execute function public\.(inbox_v2_[a-z0-9_]+)\(\);/g
    )
  ];
  if (literalDeclarations.length !== literalNames.length) {
    throw new Error(
      "DB-009 invariant SQL has a literal trigger without an exact table/function binding."
    );
  }
  for (const declaration of literalDeclarations) {
    if (!expectedTableSet.has(declaration[2])) {
      throw new Error(
        `DB-009 invariant trigger ${declaration[1]} targets undeclared table ${declaration[2]}.`
      );
    }
    if (!expectedFunctionSet.has(declaration[3])) {
      throw new Error(
        `DB-009 invariant trigger ${declaration[1]} calls undeclared function ${declaration[3]}.`
      );
    }
  }

  const names = [...literalNames];
  for (const match of sql.matchAll(
    /foreach v_table in array array\[([\s\S]*?)\]\s*loop\s*v_trigger := '([^']+)' \|\| substr\(md5\(v_table\), 1, 16\);([\s\S]*?)end loop;/g
  )) {
    const tableNames = [...match[1].matchAll(/'([^']+)'/g)].map(
      (tableMatch) => tableMatch[1]
    );
    if (tableNames.length === 0 || !/^inbox_v2_[a-z0-9_]+$/u.test(match[2])) {
      throw new Error(
        "DB-009 invariant SQL has an invalid dynamic trigger declaration."
      );
    }
    const functionMatch = match[3].match(
      /execute format\(\s*'create (?:constraint )?trigger %I [^']*on public\.%I [^']*execute function public\.(inbox_v2_[a-z0-9_]+)\(\)'/u
    );
    if (!functionMatch || !expectedFunctionSet.has(functionMatch[1])) {
      throw new Error(
        "DB-009 invariant SQL has a dynamic trigger without an exact declared function binding."
      );
    }
    for (const tableName of tableNames) {
      if (!expectedTableSet.has(tableName)) {
        throw new Error(
          `DB-009 dynamic invariant trigger targets undeclared table ${tableName}.`
        );
      }
      const suffix = createHash("md5")
        .update(tableName, "utf8")
        .digest("hex")
        .slice(0, 16);
      names.push(`${match[2]}${suffix}`);
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error("DB-009 invariant SQL declares duplicate trigger names.");
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
      `Generated DB-009 migration declares unexpected ${objectKind}(s): ${[
        ...new Set(unexpectedNames)
      ].join(", ")}.`
    );
  }
}

function assertExactPreflightObjectList(preflightSql, kind, expectedNames) {
  const beginMarker = `-- DB009_PARTIAL_${kind}_BEGIN`;
  const endMarker = `-- DB009_PARTIAL_${kind}_END`;
  if (
    countOccurrences(preflightSql, beginMarker) !== 1 ||
    countOccurrences(preflightSql, endMarker) !== 1
  ) {
    throw new Error(
      `DB-009 preflight must contain one exact ${kind.toLowerCase()} object-list boundary.`
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
      `DB-009 preflight ${kind.toLowerCase()} list is stale against the schema/invariant SQL.`
    );
  }
}

function assertGeneratedStatementCount(statementsToCheck, fragment, expected) {
  const actual = statementsToCheck.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (actual !== expected) {
    throw new Error(
      `Generated DB-009 migration must contain ${fragment} exactly ${expected} time(s); found ${actual}.`
    );
  }
}

function countOccurrences(value, fragment) {
  if (fragment.length === 0) return 0;
  return value.split(fragment).length - 1;
}
