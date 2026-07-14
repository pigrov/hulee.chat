import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0031_inbox_v2_timeline_message_foundation.sql";
const preflightPath = "scripts/db/inbox-v2-timeline-message-preflight.sql";
const invariantPath = "packages/db/src/schema/inbox-v2/timeline-message.ts";
const invariantExportName = "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL";
const providerSemanticInvariantPath =
  "packages/db/src/schema/inbox-v2/provider-semantic-ordering.ts";
const providerSemanticInvariantExportName =
  "INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL";
const parentUniqueConstraints = [
  "files_tenant_id_unique",
  "event_store_tenant_id_unique",
  "inbox_v2_messages_content_unique",
  "inbox_v2_messages_revision_unique",
  "inbox_v2_timeline_items_revision_unique",
  "inbox_v2_timeline_items_subject_unique",
  "inbox_v2_timeline_items_sequence_unique",
  "inbox_v2_source_thread_bindings_owner_account_unique"
];
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1";
const preflightMarker = "INBOX_V2_TIMELINE_MESSAGE_PREFLIGHT_V1";

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker)) {
  throw new Error(`${migrationPath} is already finalized.`);
}

const statements = migrationSql
  .replaceAll("\r\n", "\n")
  .split(statementBreakpoint)
  .map((statement) => statement.trim())
  .filter(Boolean);
const extractedParentConstraints = statements.flatMap((statement) => {
  const constraintName = parentUniqueConstraints.find((name) =>
    statement.includes(`ADD CONSTRAINT "${name}" UNIQUE`)
  );
  return constraintName ? [{ constraintName, statement }] : [];
});
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
    `Generated DB-005 migration must contain every parent unique constraint exactly once: ${invalidConstraintCounts
      .map(({ constraintName, count }) => `${constraintName}=${count}`)
      .join(", ")}`
  );
}

const remainingStatements = statements.filter(
  (statement) =>
    !extractedParentConstraints.some(
      (constraint) => constraint.statement === statement
    )
);
const firstForeignKeyIndex = remainingStatements.findIndex((statement) =>
  /ADD CONSTRAINT "[^"]+" FOREIGN KEY/.test(statement)
);
if (firstForeignKeyIndex < 0) {
  throw new Error("Generated DB-005 migration contains no foreign keys.");
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

const [preflightSource, invariantSource, providerSemanticInvariantSource] =
  await Promise.all([
    readFile(preflightPath, "utf8"),
    readFile(invariantPath, "utf8"),
    readFile(providerSemanticInvariantPath, "utf8")
  ]);
const preflightSql = preflightSource.trim();
if (
  !preflightSql.startsWith(`-- ${preflightMarker}`) ||
  countOccurrences(preflightSql, preflightMarker) !== 1
) {
  throw new Error(
    `DB-005 preflight must start with ${preflightMarker} exactly once.`
  );
}
const invariantSql = extractRawSql(invariantSource, invariantExportName);
const providerSemanticInvariantSql = extractRawSql(
  providerSemanticInvariantSource,
  providerSemanticInvariantExportName
);
const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...remainingStatements,
  invariantSql,
  providerSemanticInvariantSql
];

await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: preflight + ${remainingStatements.length} DDL statements + 2 invariant blocks.`
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
