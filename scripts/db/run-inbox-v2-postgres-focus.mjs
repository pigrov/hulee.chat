import { resolve } from "node:path";

import { runInboxV2PostgresIntegrationGate } from "./run-inbox-v2-postgres-integration.mjs";

const suites = Object.freeze({
  "conversation-head": Object.freeze([
    "packages/db/src/repositories/sql-inbox-v2-conversation-repository.integration.test.ts"
  ]),
  "source-registry": Object.freeze([
    "packages/db/src/repositories/sql-inbox-v2-source-registry-repository.integration.test.ts"
  ])
});

const suiteName = process.argv[2];
const testFiles = suites[suiteName];
if (testFiles === undefined) {
  throw new Error(
    `Expected one focused Inbox V2 PostgreSQL suite: ${Object.keys(suites).join(", ")}.`
  );
}
const databaseUrl = process.env.DATABASE_URL;
if (typeof databaseUrl !== "string" || databaseUrl.trim().length === 0) {
  throw new Error("DATABASE_URL is required for the focused PostgreSQL gate.");
}

await runInboxV2PostgresIntegrationGate({
  databaseUrl,
  repositoryRoot: resolve("."),
  testFiles: [...testFiles]
});
