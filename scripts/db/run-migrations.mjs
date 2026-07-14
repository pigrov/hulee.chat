import { resolve } from "node:path";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    "DATABASE_URL is required; refusing to use an implicit database."
  );
}

const migrationsFolder = resolve(
  process.env.HULEE_MIGRATIONS_FOLDER ?? "packages/db/drizzle"
);
const pool = new pg.Pool({ connectionString: databaseUrl });

try {
  await migrate(drizzle(pool), { migrationsFolder });
  console.log(`Applied migrations from ${migrationsFolder}.`);
} finally {
  await pool.end();
}
