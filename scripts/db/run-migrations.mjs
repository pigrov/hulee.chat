import { installInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required; refusing to use an implicit database."
  );
}

const result = await installInboxV2Database({
  databaseUrl,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER,
  lockTimeoutMs: optionalEnvironmentNumber(
    "HULEE_INBOX_V2_MIGRATION_LOCK_TIMEOUT_MS"
  ),
  statementTimeoutMs: optionalEnvironmentNumber(
    "HULEE_INBOX_V2_MIGRATION_STATEMENT_TIMEOUT_MS"
  )
});
console.log(
  `Verified ${result.migrationCount} migration(s) from ${result.migrationsFolder}; contract ${result.migrationContractSha256}; DDL budget lock=${result.migrationDdlBudget.lockTimeoutMs}ms statement=${result.migrationDdlBudget.statementTimeoutMs}ms.`
);

function optionalEnvironmentNumber(name) {
  const value = process.env[name];
  return value === undefined ? undefined : Number(value);
}
