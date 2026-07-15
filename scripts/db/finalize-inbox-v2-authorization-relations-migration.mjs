import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";

import { assertAdditiveMigrationStatements } from "../checks/db-check-lib.mjs";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0034_inbox_v2_authorization_relations.sql";
const preflightPath =
  "scripts/db/inbox-v2-authorization-relations-preflight.sql";
const schemaPath = "packages/db/src/schema/inbox-v2/authorization-relations.ts";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker =
  "INBOX_V2_AUTHORIZATION_RELATIONS_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_AUTHORIZATION_RELATIONS_PREFLIGHT_V1";
const replaceableFoundationFunctions = [
  "inbox_v2_work_item_aggregate_coherence",
  "inbox_v2_work_item_mutation_coherence"
];
const foundationTriggerDefinitions = [
  {
    name: "inbox_v2_work_item_mutation_coherence_constraint",
    tableName: "inbox_v2_work_items",
    functionName: "inbox_v2_work_item_mutation_coherence",
    triggerType: 17
  },
  {
    name: "inbox_v2_work_items_aggregate_constraint",
    tableName: "inbox_v2_work_items",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 21
  },
  {
    name: "inbox_v2_work_sla_aggregate_constraint",
    tableName: "inbox_v2_work_item_sla_snapshots",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 5
  },
  {
    name: "inbox_v2_work_creation_aggregate_constraint",
    tableName: "inbox_v2_work_item_creation_decisions",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 5
  },
  {
    name: "inbox_v2_work_assignment_aggregate_constraint",
    tableName: "inbox_v2_work_item_primary_assignments",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 21
  },
  {
    name: "inbox_v2_work_transition_aggregate_constraint",
    tableName: "inbox_v2_work_item_transitions",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 5
  },
  {
    name: "inbox_v2_work_team_episode_aggregate_constraint",
    tableName: "inbox_v2_work_item_servicing_team_episodes",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 21
  },
  {
    name: "inbox_v2_work_relation_transition_aggregate_constraint",
    tableName: "inbox_v2_work_item_relation_transitions",
    functionName: "inbox_v2_work_item_aggregate_coherence",
    triggerType: 5
  }
];

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
  "Inbox V2 RBAC-003 migration finalizer"
);

const [preflightSource, schemaSource] = await Promise.all([
  readFile(preflightPath, "utf8"),
  readFile(schemaPath, "utf8")
]);
const expectedTables = extractSchemaObjectNames(schemaSource, "pgTable");
const expectedEnums = extractSchemaObjectNames(schemaSource, "pgEnum");
if (expectedTables.length === 0) {
  throw new Error("RBAC-003 schema must declare at least one pgTable.");
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
  preflightSql.includes("RBAC003_PARTIAL_OBJECTS_PENDING")
) {
  throw new Error(
    `RBAC-003 preflight must start with ${preflightMarker} exactly once and contain no pending object list.`
  );
}
assertExactPreflightObjectList(preflightSql, "TABLES", expectedTables);
assertExactPreflightObjectList(preflightSql, "TYPES", expectedEnums);

const invariantBlocks = extractRawSqlBlocks(schemaSource);
if (invariantBlocks.length === 0) {
  throw new Error(
    "RBAC-003 schema must export at least one Inbox V2 invariant SQL block."
  );
}
const invariantSql = invariantBlocks.map(({ sql }) => sql).join("\n");
const invariantFunctions = extractInvariantObjectNames(
  invariantSql,
  /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
);
const foundationFunctions = invariantFunctions.filter((functionName) =>
  replaceableFoundationFunctions.includes(functionName)
);
if (
  foundationFunctions.length !== 0 &&
  foundationFunctions.length !== replaceableFoundationFunctions.length
) {
  throw new Error(
    "RBAC-003 must replace both WorkItem foundation functions or neither."
  );
}
assertExactPreflightObjectList(
  preflightSql,
  "FUNCTIONS",
  invariantFunctions.filter(
    (functionName) => !foundationFunctions.includes(functionName)
  )
);
assertExactPreflightObjectList(
  preflightSql,
  "FUNCTIONS",
  foundationFunctions,
  "RBAC003_FOUNDATION"
);
const expectedFoundationTriggers =
  foundationFunctions.length === 0 ? [] : foundationTriggerDefinitions;
assertExactPreflightFoundationTriggers(
  preflightSql,
  expectedFoundationTriggers
);
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
  `Finalized ${migrationPath}: preflight + ${statements.length} DDL statements + ${invariantBlocks.length} invariant block(s); verified ${expectedTables.length} tables, ${expectedEnums.length} enums, ${invariantFunctions.length} functions, ${expectedFoundationTriggers.length} foundation trigger fingerprints.`
);

function extractSchemaObjectNames(sourceText, factoryName) {
  const pattern = new RegExp(`${factoryName}\\(\\s*"([^"]+)"`, "g");
  const names = [...sourceText.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error(`RBAC-003 schema declares duplicate ${factoryName} names.`);
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
    throw new Error("RBAC-003 schema exports duplicate invariant SQL names.");
  }
  return matches.map((match) => ({ name: match[1], sql: match[2].trim() }));
}

function extractInvariantObjectNames(sql, pattern) {
  const names = [...sql.matchAll(pattern)].map((match) => match[1]);
  if (new Set(names).size !== names.length) {
    throw new Error("RBAC-003 invariant SQL declares duplicate object names.");
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
      "RBAC-003 invariant SQL has a literal trigger without an exact table/function binding."
    );
  }
  for (const declaration of literalDeclarations) {
    if (!expectedTableSet.has(declaration[2])) {
      throw new Error(
        `RBAC-003 invariant trigger ${declaration[1]} targets undeclared table ${declaration[2]}.`
      );
    }
    if (!expectedFunctionSet.has(declaration[3])) {
      throw new Error(
        `RBAC-003 invariant trigger ${declaration[1]} calls undeclared function ${declaration[3]}.`
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
    const functionMatch = match[3].match(
      /execute format\(\s*'create (?:constraint )?trigger %I [^']*on public\.%I [^']*execute function public\.(inbox_v2_[a-z0-9_]+)\(\)'/u
    );
    if (
      tableNames.length === 0 ||
      !/^inbox_v2_[a-z0-9_]+$/u.test(match[2]) ||
      !functionMatch ||
      !expectedFunctionSet.has(functionMatch[1])
    ) {
      throw new Error("RBAC-003 has an invalid dynamic trigger declaration.");
    }
    for (const tableName of tableNames) {
      if (!expectedTableSet.has(tableName)) {
        throw new Error(
          `RBAC-003 dynamic invariant trigger targets undeclared table ${tableName}.`
        );
      }
      names.push(
        `${match[2]}${createHash("md5")
          .update(tableName, "utf8")
          .digest("hex")
          .slice(0, 16)}`
      );
    }
  }
  if (new Set(names).size !== names.length) {
    throw new Error("RBAC-003 invariant SQL declares duplicate trigger names.");
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
      `Generated RBAC-003 migration declares unexpected ${objectKind}(s): ${[
        ...new Set(unexpectedNames)
      ].join(", ")}.`
    );
  }
}

function assertExactPreflightObjectList(
  preflightSql,
  kind,
  expectedNames,
  markerPrefix = "RBAC003_PARTIAL"
) {
  const beginMarker = `-- ${markerPrefix}_${kind}_BEGIN`;
  const endMarker = `-- ${markerPrefix}_${kind}_END`;
  if (
    countOccurrences(preflightSql, beginMarker) !== 1 ||
    countOccurrences(preflightSql, endMarker) !== 1
  ) {
    throw new Error(
      `RBAC-003 preflight must contain one exact ${kind.toLowerCase()} object-list boundary.`
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
      `RBAC-003 preflight ${kind.toLowerCase()} list is stale against the schema/invariant SQL.`
    );
  }
}

function assertExactPreflightFoundationTriggers(
  preflightSql,
  expectedDefinitions
) {
  const beginMarker = "-- RBAC003_FOUNDATION_TRIGGERS_BEGIN";
  const endMarker = "-- RBAC003_FOUNDATION_TRIGGERS_END";
  if (
    countOccurrences(preflightSql, beginMarker) !== 1 ||
    countOccurrences(preflightSql, endMarker) !== 1
  ) {
    throw new Error(
      "RBAC-003 preflight must contain one exact foundation trigger inventory boundary."
    );
  }
  const start = preflightSql.indexOf(beginMarker) + beginMarker.length;
  const end = preflightSql.indexOf(endMarker, start);
  const actualDefinitions = [
    ...preflightSql
      .slice(start, end)
      .matchAll(
        /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*\)/g
      )
  ].map((match) => ({
    name: match[1],
    tableName: match[2],
    functionName: match[3],
    triggerType: Number(match[4])
  }));
  const normalize = (definitions) =>
    [...definitions].sort((left, right) => left.name.localeCompare(right.name));
  if (
    new Set(actualDefinitions.map(({ name }) => name)).size !==
      actualDefinitions.length ||
    JSON.stringify(normalize(actualDefinitions)) !==
      JSON.stringify(normalize(expectedDefinitions))
  ) {
    throw new Error(
      "RBAC-003 preflight foundation trigger inventory is stale against the pinned WorkItem bridge contract."
    );
  }
}

function assertGeneratedStatementCount(statementsToCheck, fragment, expected) {
  const actual = statementsToCheck.filter((statement) =>
    statement.includes(fragment)
  ).length;
  if (actual !== expected) {
    throw new Error(
      `Generated RBAC-003 migration must contain ${fragment} exactly ${expected} time(s); found ${actual}.`
    );
  }
}

function countOccurrences(value, fragment) {
  return value.length === 0 || fragment.length === 0
    ? 0
    : value.split(fragment).length - 1;
}
