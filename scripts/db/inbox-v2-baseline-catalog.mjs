import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import pg from "pg";

import {
  collectInboxV2ManagedSchemaCatalog,
  digestMigrationJournal,
  readAppliedMigrationJournal
} from "./inbox-v2-database-lifecycle.mjs";

const { Client } = pg;
const FIXTURE_SCHEMA_ID = "core:inbox-v2.retained-catalog-fixture@v1";
const DEFAULT_FIXTURE_PATH =
  "scripts/db/fixtures/inbox-v2-baseline-retained-catalog.json";
const REMOVED_V1_RELATIONS = Object.freeze([
  "conversation_participants",
  "conversations",
  "message_attachments",
  "message_delivery_attempts",
  "messages"
]);
const REMOVED_V1_TYPES = Object.freeze([
  "conversation_type",
  "message_direction",
  "message_status"
]);

if (isMainModule()) {
  await runCli(process.argv.slice(2));
}

async function runCli([command, ...arguments_]) {
  if (command === "capture") {
    await captureFixture(parseArguments(arguments_));
  } else if (command === "verify") {
    await verifyFixture(parseArguments(arguments_));
  } else {
    throw new Error(
      "Usage: node scripts/db/inbox-v2-baseline-catalog.mjs <capture|verify> [--fixture <path>] [--source-revision <sha>]"
    );
  }
}

async function captureFixture(options) {
  const sourceRevision = requiredText(
    options.sourceRevision,
    "--source-revision"
  );
  const fixturePath = resolve(options.fixture ?? DEFAULT_FIXTURE_PATH);
  const client = await connect();
  try {
    const payload = await collectFixturePayload(client, sourceRevision);
    await mkdir(dirname(fixturePath), { recursive: true });
    await writeFile(
      fixturePath,
      `${JSON.stringify(payload, null, 2)}\n`,
      "utf8"
    );
    process.stdout.write(
      `Captured ${payload.catalog.rowCount} retained catalog rows (${payload.catalog.sha256}) from ${payload.source.migrationCount} migration(s).\n`
    );
  } finally {
    await client.end();
  }
}

async function verifyFixture(options) {
  const fixturePath = resolve(options.fixture ?? DEFAULT_FIXTURE_PATH);
  const client = await connect();
  try {
    const result = await verifyInboxV2BaselineCatalog(client, { fixturePath });
    process.stdout.write(
      `Verified ${result.rowCount} retained catalog rows (${result.sha256}); missing=0 changed=0 added=0 forbiddenV1=0.\n`
    );
  } finally {
    await client.end();
  }
}

export async function verifyInboxV2BaselineCatalog(
  client,
  { fixturePath = resolve(DEFAULT_FIXTURE_PATH) } = {}
) {
  const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
  if (fixture.schemaId !== FIXTURE_SCHEMA_ID) {
    throw new Error(
      `Unsupported retained catalog fixture: ${fixture.schemaId}`
    );
  }
  await assertRemovedV1ObjectsAbsent(client);
  const rows = normalizeInboxV2BaselineCatalogRows(
    await collectInboxV2ManagedSchemaCatalog(client)
  );
  const expectedRows = fixture.catalog?.rows;
  if (!Array.isArray(expectedRows)) {
    throw new Error("Retained catalog fixture does not contain catalog.rows.");
  }
  const differences = diffCatalogRows(expectedRows, rows);
  if (
    differences.missing.length > 0 ||
    differences.changed.length > 0 ||
    differences.added.length > 0
  ) {
    throw new Error(
      `Inbox V2 baseline catalog differs from the retained clean-baseline catalog checkpoint: ${JSON.stringify(summarizeDifferences(differences))}`
    );
  }
  const digest = sha256(rows);
  if (digest !== fixture.catalog.sha256) {
    throw new Error(
      `Retained catalog digest mismatch: expected ${fixture.catalog.sha256}, received ${digest}.`
    );
  }
  return Object.freeze({ rowCount: rows.length, sha256: digest });
}

async function collectFixturePayload(client, sourceRevision) {
  await assertRemovedV1ObjectsAbsent(client);
  const catalogRows = normalizeInboxV2BaselineCatalogRows(
    await collectInboxV2ManagedSchemaCatalog(client)
  );
  const migrationContract = await readAppliedMigrationJournal(client);
  const serverVersion = String(
    (await client.query("show server_version")).rows[0]?.server_version ?? ""
  );
  return Object.freeze({
    schemaId: FIXTURE_SCHEMA_ID,
    source: Object.freeze({
      revision: sourceRevision,
      migrationCount: migrationContract.length,
      migrationContractSha256: digestMigrationJournal(migrationContract),
      postgresVersion: serverVersion
    }),
    removedV1: Object.freeze({
      relations: REMOVED_V1_RELATIONS,
      types: REMOVED_V1_TYPES
    }),
    catalog: Object.freeze({
      rowCount: catalogRows.length,
      sha256: sha256(catalogRows),
      countsByKind: countByKind(catalogRows),
      rows: catalogRows
    })
  });
}

async function assertRemovedV1ObjectsAbsent(client) {
  const result = await client.query(
    `select 'relation' as object_kind, relation.relname as object_name
       from pg_catalog.pg_class relation
       join pg_catalog.pg_namespace namespace
         on namespace.oid = relation.relnamespace
      where namespace.nspname = 'public'
        and relation.relname = any($1::text[])
      union all
     select 'type' as object_kind, type_row.typname as object_name
       from pg_catalog.pg_type type_row
       join pg_catalog.pg_namespace namespace
         on namespace.oid = type_row.typnamespace
      where namespace.nspname = 'public'
        and type_row.typname = any($2::text[])
      order by object_kind, object_name`,
    [REMOVED_V1_RELATIONS, REMOVED_V1_TYPES]
  );
  if (result.rows.length > 0) {
    throw new Error(
      `V1-only catalog objects remain: ${result.rows.map((row) => `${row.object_kind}:${row.object_name}`).join(", ")}.`
    );
  }
}

export function normalizeInboxV2BaselineCatalogRows(rows) {
  const databaseRows = rows.filter((row) => row.objectKind === "database");
  if (databaseRows.length !== 1) {
    throw new Error(
      `Expected exactly one database catalog row, received ${databaseRows.length}.`
    );
  }
  const databaseOwner = requiredText(
    databaseRows[0].ownerName,
    "database catalog owner"
  );
  const normalized = rows.map((row) => ({
    ...row,
    objectName: row.objectKind === "database" ? "<database>" : row.objectName,
    ownerName:
      row.ownerName === databaseOwner ? "<database-owner>" : row.ownerName,
    definition: normalizeCatalogDefinition(row, databaseOwner)
  }));
  normalized.sort((left, right) => {
    const leftValue = JSON.stringify(left);
    const rightValue = JSON.stringify(right);
    return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
  });
  return Object.freeze(normalized.map((row) => Object.freeze(row)));
}

function normalizeCatalogDefinition(row, databaseOwner) {
  if (row.objectKind === "schema" || row.objectKind === "default-acl") {
    return normalizeAcl(row.definition, databaseOwner);
  }
  const jsonDefinitionKinds = new Set([
    "column",
    "constraint",
    "database",
    "function",
    "relation"
  ]);
  if (!jsonDefinitionKinds.has(row.objectKind)) {
    return row.definition;
  }
  const definition = JSON.parse(row.definition);
  if (!Array.isArray(definition)) return row.definition;
  if (row.objectKind === "column") {
    definition[0] = "<ordinal>";
    definition[5] = normalizeAcl(definition[5], databaseOwner);
  }
  const aclIndex = new Map([
    ["database", 1],
    ["function", 6],
    ["relation", 2]
  ]).get(row.objectKind);
  if (aclIndex !== undefined) {
    definition[aclIndex] = normalizeAcl(definition[aclIndex], databaseOwner);
  }
  return JSON.stringify(definition);
}

function normalizeAcl(value, databaseOwner) {
  if (typeof value !== "string" || value.length === 0) return value;
  let normalized = value;
  const aclOwnerIdentifiers = new Set([
    databaseOwner,
    `"${databaseOwner.replaceAll('"', '""')}"`
  ]);
  for (const identifier of aclOwnerIdentifiers) {
    const escapedIdentifier = escapeRegExp(identifier);
    normalized = normalized
      .replace(
        new RegExp(`(^|[,{])${escapedIdentifier}(?==)`, "gu"),
        "$1<database-owner>"
      )
      .replace(
        new RegExp(`/${escapedIdentifier}(?=[,}])`, "gu"),
        "/<database-owner>"
      );
  }
  return normalized;
}

function diffCatalogRows(expectedRows, actualRows) {
  const expected = new Map(expectedRows.map((row) => [catalogKey(row), row]));
  const actual = new Map(actualRows.map((row) => [catalogKey(row), row]));
  const missing = [];
  const changed = [];
  const added = [];
  for (const [key, expectedRow] of expected) {
    const actualRow = actual.get(key);
    if (actualRow === undefined) missing.push(expectedRow);
    else if (JSON.stringify(actualRow) !== JSON.stringify(expectedRow)) {
      changed.push({ expected: expectedRow, actual: actualRow });
    }
  }
  for (const [key, actualRow] of actual) {
    if (!expected.has(key)) added.push(actualRow);
  }
  return { missing, changed, added };
}

function summarizeDifferences(differences) {
  return Object.fromEntries(
    Object.entries(differences).map(([kind, rows]) => [
      kind,
      {
        count: rows.length,
        examples: rows.slice(0, 10)
      }
    ])
  );
}

function catalogKey(row) {
  return `${row.objectKind}\u0000${row.schemaName}\u0000${row.objectName}`;
}

function countByKind(rows) {
  return Object.freeze(
    Object.fromEntries(
      [...new Set(rows.map((row) => row.objectKind))]
        .sort()
        .map((kind) => [
          kind,
          rows.filter((row) => row.objectKind === kind).length
        ])
    )
  );
}

function sha256(value) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex")}`;
}

async function connect() {
  const connectionString = requiredText(
    process.env.DATABASE_URL,
    "DATABASE_URL"
  );
  const client = new Client({ connectionString });
  await client.connect();
  return client;
}

function parseArguments(arguments_) {
  const parsed = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument === "--fixture") {
      parsed.fixture = arguments_[index + 1];
      index += 1;
    } else if (argument === "--source-revision") {
      parsed.sourceRevision = arguments_[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown catalog argument: ${argument}`);
    }
  }
  return parsed;
}

function requiredText(value, label) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function isMainModule() {
  const entry = process.argv[1];
  return (
    typeof entry === "string" &&
    pathToFileURL(resolve(entry)).href === import.meta.url
  );
}
