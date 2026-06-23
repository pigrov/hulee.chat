import { createHuleeDatabase, type HuleeDatabase } from "@hulee/db";

import { resolveWebConfig, resolveWebEnv } from "./web-config";

let database: HuleeDatabase | undefined;

export function getWebDatabase(): HuleeDatabase {
  const config = resolveWebConfig();

  database ??= createHuleeDatabase({
    connectionString: config.databaseUrl,
    logger: resolveWebEnv().DATABASE_LOG === "true"
  });

  return database;
}
