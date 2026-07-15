import { sql, type SQL } from "drizzle-orm";

/**
 * Builds a collision-safe structural text value without embedding NUL bytes,
 * which PostgreSQL text parameters cannot represent.
 */
export function buildInboxV2AdvisoryLockKeySql(
  parts: readonly [string, ...string[]]
): SQL {
  return sql`hashtextextended(
    jsonb_build_array(${sql.join(
      parts.map((part) => sql`${part}::text`),
      sql`, `
    )})::text,
    0
  )`;
}

export function buildInboxV2AdvisoryXactLockSql(
  parts: readonly [string, ...string[]]
): SQL {
  return sql`select pg_advisory_xact_lock(${buildInboxV2AdvisoryLockKeySql(parts)})`;
}
