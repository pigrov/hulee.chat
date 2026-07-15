import { INBOX_V2_SECURITY_DENIAL_POLICY } from "@hulee/contracts";
import type { HuleeDatabaseConfig } from "@hulee/db";

const unsafeConnectionParameterNames = new Set([
  "application_name",
  "connectiontimeoutmillis",
  "connect_timeout",
  "lock_timeout",
  "options",
  "query_timeout",
  "statement_timeout"
]);

/**
 * Builds the isolated maintenance-pool configuration from a URL that cannot
 * override the worker-owned timeout and identity controls.
 */
export function createSecurityDenialRetentionDatabaseConfig(
  databaseUrl: string
): HuleeDatabaseConfig {
  const connectionString =
    sanitizeSecurityDenialRetentionDatabaseUrl(databaseUrl);
  const statementTimeout =
    INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds;
  const lockTimeout = INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds;

  return Object.freeze({
    connectionString,
    poolConfig: Object.freeze({
      max: 2,
      connectionTimeoutMillis: 1_000,
      statement_timeout: statementTimeout,
      lock_timeout: lockTimeout,
      query_timeout: statementTimeout + 500,
      options: `-c statement_timeout=${statementTimeout}ms -c lock_timeout=${lockTimeout}ms`,
      application_name: "hulee-worker-security-denial-retention"
    })
  });
}

export function sanitizeSecurityDenialRetentionDatabaseUrl(
  databaseUrl: string
): string {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new TypeError("Security-denial retention database URL is invalid.");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new TypeError(
      "Security-denial retention database URL must use PostgreSQL."
    );
  }

  for (const name of [...url.searchParams.keys()]) {
    if (unsafeConnectionParameterNames.has(name.toLowerCase())) {
      url.searchParams.delete(name);
    }
  }

  return url.toString();
}
