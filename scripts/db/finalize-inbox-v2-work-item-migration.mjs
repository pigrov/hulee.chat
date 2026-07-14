import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0030_inbox_v2_work_item_responsibility_foundation.sql";
const preflightPath = "scripts/db/inbox-v2-work-item-preflight.sql";
const invariantPath = "packages/db/src/schema/inbox-v2/work-item.ts";
const invariantExportName = "INBOX_V2_WORK_ITEM_INVARIANTS_SQL";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_WORK_ITEM_MIGRATION_FINALIZED_V1";

const parentUniqueConstraints = [
  "org_units_tenant_id_unique",
  "teams_tenant_id_unique",
  "work_queues_tenant_id_unique"
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
const extractedParentConstraints = [];
const remainingStatements = [];

for (const statement of statements) {
  const constraintName = parentUniqueConstraints.find((name) =>
    statement.includes(`ADD CONSTRAINT "${name}" UNIQUE`)
  );
  if (constraintName) {
    extractedParentConstraints.push({ constraintName, statement });
  } else {
    remainingStatements.push(statement);
  }
}

const invalidConstraintCounts = parentUniqueConstraints
  .map((constraintName) => ({
    constraintName,
    count: extractedParentConstraints.filter(
      (constraint) => constraint.constraintName === constraintName
    ).length
  }))
  .filter(({ count }) => count !== 1);
if (invalidConstraintCounts.length > 0) {
  throw new Error(
    `Generated migration must contain every DB-004 parent unique constraint exactly once: ${invalidConstraintCounts
      .map(({ constraintName, count }) => `${constraintName}=${count}`)
      .join(", ")}`
  );
}

const firstForeignKeyIndex = remainingStatements.findIndex((statement) =>
  /ADD CONSTRAINT "[^"]+" FOREIGN KEY/.test(statement)
);
if (firstForeignKeyIndex < 0) {
  throw new Error("Generated DB-004 migration contains no foreign keys.");
}

remainingStatements.splice(
  firstForeignKeyIndex,
  0,
  ...parentUniqueConstraints.map(
    (constraintName) =>
      extractedParentConstraints.find(
        (constraint) => constraint.constraintName === constraintName
      ).statement
  )
);

const [preflightSql, invariantSource] = await Promise.all([
  readFile(preflightPath, "utf8"),
  readFile(invariantPath, "utf8")
]);
const invariantSql = extractRawSql(invariantSource, invariantExportName);
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql.trim()}`,
  ...remainingStatements,
  invariantSql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: preflight + ${remainingStatements.length} DDL statements + 1 invariant block.`
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
