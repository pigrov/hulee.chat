import { INBOX_V2_SECURITY_DENIAL_POLICY } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createSecurityDenialRetentionDatabaseConfig,
  sanitizeSecurityDenialRetentionDatabaseUrl
} from "./security-denial-retention-database-config";

describe("security-denial retention database configuration", () => {
  it("removes hostile URL overrides and reapplies fixed pool controls", () => {
    const config = createSecurityDenialRetentionDatabaseConfig(
      "postgres://worker:secret@db.internal:5432/hulee" +
        "?sslmode=require" +
        "&statement_timeout=0" +
        "&LOCK_TIMEOUT=0" +
        "&query_timeout=0" +
        "&options=-c%20statement_timeout%3D0" +
        "&connect_timeout=999" +
        "&connectionTimeoutMillis=999999" +
        "&application_name=untrusted"
    );

    const sanitized = new URL(config.connectionString!);
    expect([...sanitized.searchParams.entries()]).toEqual([
      ["sslmode", "require"]
    ]);
    expect(config.poolConfig).toEqual({
      max: 2,
      connectionTimeoutMillis: 1_000,
      statement_timeout:
        INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds,
      lock_timeout: INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds,
      query_timeout:
        INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds + 500,
      options: `-c statement_timeout=${INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds}ms -c lock_timeout=${INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds}ms`,
      application_name: "hulee-worker-security-denial-retention"
    });
  });

  it("preserves connection identity and unrelated TLS parameters", () => {
    const sanitized = new URL(
      sanitizeSecurityDenialRetentionDatabaseUrl(
        "postgresql://worker:p%40ss@db.internal:5433/hulee?sslmode=verify-full&sslrootcert=%2Fcerts%2Fca.pem&target_session_attrs=read-write"
      )
    );

    expect(sanitized.protocol).toBe("postgresql:");
    expect(sanitized.username).toBe("worker");
    expect(sanitized.password).toBe("p%40ss");
    expect(sanitized.hostname).toBe("db.internal");
    expect(sanitized.port).toBe("5433");
    expect(sanitized.pathname).toBe("/hulee");
    expect([...sanitized.searchParams.entries()]).toEqual([
      ["sslmode", "verify-full"],
      ["sslrootcert", "/certs/ca.pem"],
      ["target_session_attrs", "read-write"]
    ]);
  });

  it("rejects malformed and non-PostgreSQL URLs without disclosing input", () => {
    expect(() =>
      sanitizeSecurityDenialRetentionDatabaseUrl("not a URL secret-value")
    ).toThrow("Security-denial retention database URL is invalid.");
    expect(() =>
      sanitizeSecurityDenialRetentionDatabaseUrl(
        "https://worker:secret@example.test/database"
      )
    ).toThrow("Security-denial retention database URL must use PostgreSQL.");
  });
});
