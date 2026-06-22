import { defineConfig } from "drizzle-kit";

const defaultDatabaseUrl = "postgres://hulee:hulee@localhost:5432/hulee";

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema/tables.ts",
  out: "./packages/db/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? defaultDatabaseUrl
  },
  strict: true,
  verbose: true
});
