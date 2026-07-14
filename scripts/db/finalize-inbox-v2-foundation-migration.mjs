import { readFile, writeFile } from "node:fs/promises";

const migrationPath =
  process.argv[2] ??
  "packages/db/drizzle/0029_inbox_v2_identity_transport_foundation.sql";
const preflightPath = "scripts/db/inbox-v2-foundation-preflight.sql";
const statementBreakpoint = "--> statement-breakpoint";
const finalizedMarker = "INBOX_V2_FOUNDATION_MIGRATION_FINALIZED_V1";

const invariantSources = [
  {
    path: "packages/db/src/schema/inbox-v2/client-merge.ts",
    exportName: "INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/conversation-client-link.ts",
    exportName: "INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/identity-foundation.ts",
    exportName: "INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/source-account-identity.ts",
    exportName: "INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/source-thread-binding.ts",
    exportName: "INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/source-thread-binding.ts",
    exportName: "INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/source-occurrence.ts",
    exportName: "INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/outbound-transport.ts",
    exportName: "INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/provider-roster-evidence.ts",
    exportName: "INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/participant-membership.ts",
    exportName: "INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL"
  },
  {
    path: "packages/db/src/schema/inbox-v2/tenant-policy-authority.ts",
    exportName: "INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL"
  }
];

const parentUniqueConstraints = [
  "clients_tenant_id_unique",
  "client_contacts_tenant_id_unique",
  "employees_tenant_id_unique",
  "inbox_v2_conversations_tenant_id_shape_unique",
  "normalized_inbound_events_tenant_id_unique",
  "normalized_inbound_events_tenant_id_connection_unique",
  "normalized_inbound_events_tenant_id_account_unique",
  "raw_inbound_events_tenant_id_unique",
  "raw_inbound_events_tenant_id_connection_unique",
  "raw_inbound_events_tenant_id_account_unique",
  "raw_inbound_events_tenant_id_account_scope_unique",
  "source_accounts_tenant_id_unique",
  "source_accounts_tenant_id_connection_unique",
  "source_connections_tenant_id_unique"
];

const migrationSql = await readFile(migrationPath, "utf8");
if (migrationSql.includes(finalizedMarker)) {
  throw new Error(`${migrationPath} is already finalized.`);
}

const statements = migrationSql
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

const extractedNames = new Set(
  extractedParentConstraints.map(({ constraintName }) => constraintName)
);
const missingConstraints = parentUniqueConstraints.filter(
  (constraintName) => !extractedNames.has(constraintName)
);
if (missingConstraints.length > 0) {
  throw new Error(
    `Generated migration is missing parent unique constraints: ${missingConstraints.join(", ")}`
  );
}

const firstForeignKeyIndex = remainingStatements.findIndex((statement) =>
  /ADD CONSTRAINT "[^"]+" FOREIGN KEY/.test(statement)
);
if (firstForeignKeyIndex < 0) {
  throw new Error("Generated migration contains no foreign-key statements.");
}

const orderedParentConstraints = parentUniqueConstraints.map(
  (constraintName) =>
    extractedParentConstraints.find(
      (constraint) => constraint.constraintName === constraintName
    ).statement
);
remainingStatements.splice(
  firstForeignKeyIndex,
  0,
  ...orderedParentConstraints
);

const preflightSql = (await readFile(preflightPath, "utf8")).trim();
const invariantSql = [];
for (const source of invariantSources) {
  invariantSql.push(
    extractRawSql(await readFile(source.path, "utf8"), source.exportName)
  );
}

const finalizedStatements = [
  `-- ${finalizedMarker}\n${preflightSql}`,
  ...remainingStatements,
  ...invariantSql
];
await writeFile(
  migrationPath,
  `${finalizedStatements.join(`\n${statementBreakpoint}\n`)}\n`,
  "utf8"
);

console.log(
  `Finalized ${migrationPath}: preflight + ${remainingStatements.length} DDL statements + ${invariantSql.length} invariant blocks.`
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
