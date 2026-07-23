import { preflightInboxV2Database } from "./inbox-v2-database-lifecycle.mjs";

const result = await preflightInboxV2Database({
  databaseUrl: process.env.DATABASE_URL,
  migrationsFolder: process.env.HULEE_MIGRATIONS_FOLDER
});

console.log(JSON.stringify(result, null, 2));
