import { installInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required; refusing to use an implicit database."
  );
}

const result = await installInboxV2Database({
  databaseUrl,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER
});
console.log(
  `Verified ${result.migrationCount} migration(s) from ${result.migrationsFolder}; contract ${result.migrationContractSha256}.`
);
