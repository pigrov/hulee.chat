import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import pg, { type Pool, type PoolConfig } from "pg";

import * as schema from "./schema/tables";

export const defaultDatabaseUrl = "postgres://hulee:hulee@localhost:5432/hulee";

export type HuleeDatabase = NodePgDatabase<typeof schema> & {
  $client: Pool;
};

export type HuleeDatabaseConfig = {
  connectionString?: string;
  pool?: Pool;
  poolConfig?: PoolConfig;
  logger?: boolean;
};

export function createHuleePgPool(config: HuleeDatabaseConfig = {}): Pool {
  if (config.pool) {
    return config.pool;
  }

  return new pg.Pool({
    ...config.poolConfig,
    connectionString:
      config.connectionString ??
      config.poolConfig?.connectionString ??
      process.env.DATABASE_URL ??
      defaultDatabaseUrl
  });
}

export function createHuleeDatabase(
  config: HuleeDatabaseConfig = {}
): HuleeDatabase {
  const pool = createHuleePgPool(config);

  return drizzle(pool, {
    schema,
    logger: config.logger ?? false
  }) as HuleeDatabase;
}

export async function closeHuleeDatabase(db: HuleeDatabase): Promise<void> {
  await db.$client.end();
}
