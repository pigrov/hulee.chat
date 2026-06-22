import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import { defineConfig } from "drizzle-kit";

const defaultDatabaseUrl = "postgres://hulee:hulee@localhost:5432/hulee";
const env = mergeEnvSources(loadLocalEnvFile(), process.env);

export default defineConfig({
  dialect: "postgresql",
  schema: "./packages/db/src/schema/tables.ts",
  out: "./packages/db/drizzle",
  dbCredentials: {
    url: env.DATABASE_URL ?? defaultDatabaseUrl
  },
  strict: true,
  verbose: true
});
