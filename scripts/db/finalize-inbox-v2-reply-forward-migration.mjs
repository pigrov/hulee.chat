import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv.slice(2).find((argument) => !argument.startsWith("--")) ??
  "packages/db/drizzle/0054_inbox_v2_reply_and_forward.sql";
const refresh = process.argv.includes("--refresh");
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_REPLY_FORWARD_MIGRATION_FINALIZED_V1";

const migrationSql = await readFile(migrationPath, "utf8");
const statements = splitMigrationStatements(migrationSql);
let generatedStatements;
if (refresh) {
  if (
    countOccurrences(migrationSql, finalizedMarker) !== 1 ||
    !statements.at(-1)?.startsWith(`-- ${finalizedMarker}\n`)
  ) {
    throw new Error(`${migrationPath} has no refreshable finalized tail.`);
  }
  generatedStatements = statements.slice(0, -1);
} else {
  if (migrationSql.includes(finalizedMarker)) {
    throw new Error(`${migrationPath} is already finalized.`);
  }
  generatedStatements = statements;
}

assertGeneratedInventory(generatedStatements);
generatedStatements =
  orderParentUniqueBeforeReferenceForeignKey(generatedStatements);

const outboundSource = await readFile(
  "packages/db/src/schema/inbox-v2/outbound-transport.ts",
  "utf8"
);
const timelineSource = await readFile(
  "packages/db/src/schema/inbox-v2/timeline-message.ts",
  "utf8"
);
const outboundSql = extractRawSql(
  outboundSource,
  "INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL"
);
const timelineSql = extractRawSql(
  timelineSource,
  "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL"
);
const invariantTail = [
  extractSqlFunctionDefinition(
    outboundSql,
    "public.inbox_v2_outbound_route_guard_insert"
  ),
  extractSqlFunctionDefinition(
    timelineSql,
    "public.inbox_v2_tm_outbound_route_action_valid"
  ),
  extractSqlFunctionDefinition(
    timelineSql,
    "public.inbox_v2_tm_assert_reference_context"
  ),
  extractSqlFunctionDefinition(timelineSql, "public.inbox_v2_tm_core_coherence")
].join("\n\n");

const finalizedStatements = [
  ...generatedStatements,
  `-- ${finalizedMarker}\n${invariantTail}`
];
await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: ${generatedStatements.length} generated DDL statements + 4 exact schema-owned function replacements.`
);

function assertGeneratedInventory(candidateStatements) {
  const exactFragments = [
    'DROP CONSTRAINT "inbox_v2_outbound_routes_reference_context_check"',
    'DROP CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk"',
    'ADD CONSTRAINT "inbox_v2_message_revisions_target_unique" UNIQUE',
    'ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk" FOREIGN KEY',
    'ADD CONSTRAINT "inbox_v2_outbound_routes_reference_context_check" CHECK'
  ];
  if (candidateStatements.length !== exactFragments.length) {
    throw new Error(
      `${migrationPath} must contain exactly ${exactFragments.length} generated DDL statements before finalization.`
    );
  }
  for (const fragment of exactFragments) {
    const count = candidateStatements.filter((statement) =>
      statement.includes(fragment)
    ).length;
    if (count !== 1) {
      throw new Error(
        `${migrationPath} must contain ${fragment} exactly once; found ${count}.`
      );
    }
  }
  const foreignKey = candidateStatements.find((statement) =>
    statement.includes(
      'ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk" FOREIGN KEY'
    )
  );
  if (
    !foreignKey?.includes(
      'REFERENCES "public"."inbox_v2_message_revisions"("tenant_id","message_id","timeline_item_id","message_revision")'
    )
  ) {
    throw new Error(
      `${migrationPath} must retarget canonical references to immutable Message revisions.`
    );
  }
}

function orderParentUniqueBeforeReferenceForeignKey(candidateStatements) {
  const uniqueFragment =
    'ADD CONSTRAINT "inbox_v2_message_revisions_target_unique" UNIQUE';
  const foreignKeyFragment =
    'ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk" FOREIGN KEY';
  const uniqueStatement = candidateStatements.find((statement) =>
    statement.includes(uniqueFragment)
  );
  const foreignKeyStatement = candidateStatements.find((statement) =>
    statement.includes(foreignKeyFragment)
  );
  if (!uniqueStatement || !foreignKeyStatement) {
    throw new Error(`${migrationPath} is missing the revision target edge.`);
  }
  const withoutEdge = candidateStatements.filter(
    (statement) =>
      statement !== uniqueStatement && statement !== foreignKeyStatement
  );
  const dropForeignKeyIndex = withoutEdge.findIndex((statement) =>
    statement.includes(
      'DROP CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk"'
    )
  );
  if (dropForeignKeyIndex < 0) {
    throw new Error(
      `${migrationPath} is missing the old mutable-head FK drop.`
    );
  }
  return [
    ...withoutEdge.slice(0, dropForeignKeyIndex + 1),
    uniqueStatement,
    foreignKeyStatement,
    ...withoutEdge.slice(dropForeignKeyIndex + 1)
  ];
}

function extractRawSql(sourceText, exportName) {
  const pattern = new RegExp(
    `export const ${exportName} = String\\.raw\`([\\s\\S]*?)\`;`
  );
  const match = sourceText.match(pattern);
  if (!match?.[1]) throw new Error(`Could not extract ${exportName}.`);
  return match[1].trim();
}

function extractSqlFunctionDefinition(sql, functionName) {
  const normalized = sql.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(
    `create or replace function ${functionName}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(`Could not extract SQL function ${functionName}.`);
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length).trim();
}

function splitMigrationStatements(value) {
  return value
    .replaceAll("\r\n", "\n")
    .split(/\s*-->\s*statement-breakpoint\s*/u)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function countOccurrences(value, fragment) {
  return fragment.length === 0 ? 0 : value.split(fragment).length - 1;
}
