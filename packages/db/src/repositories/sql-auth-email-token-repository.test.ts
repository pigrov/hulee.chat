import type { EventId, TenantId } from "@hulee/contracts";
import type { AuthEmailToken } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  createSqlAuthEmailTokenRepository,
  hashAuthEmailToken
} from "./sql-auth-email-token-repository";

const tenantId = "tenant_auth_email_sql" as TenantId;
const now = new Date("2026-06-23T10:00:00.000Z");

describe("SQL auth email token repository", () => {
  it("hashes email auth tokens without exposing the raw token", () => {
    const hash = hashAuthEmailToken("raw-email-token");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain("raw-email-token");
  });

  it("maps active account targets by email and account", async () => {
    const repository = createSqlAuthEmailTokenRepository(
      new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          tenant_slug: "acme",
          tenant_display_name: "Acme",
          product_name: "Acme Desk",
          account_id: "account-1",
          email: "admin@example.test",
          display_name: "Admin"
        }
      ])
    );

    await expect(
      repository.findTargetByEmail({
        tenantSlug: "acme",
        email: "admin@example.test"
      })
    ).resolves.toMatchObject({
      tenantId,
      tenantSlug: "acme",
      tenantDisplayName: "Acme",
      productName: "Acme Desk",
      accountId: "account-1"
    });

    await expect(
      repository.findTargetByAccount({
        tenantId,
        accountId: "account-1"
      })
    ).resolves.toMatchObject({
      tenantId,
      accountId: "account-1"
    });

    await expect(
      repository.findAccountEmailOwner({
        tenantId,
        email: "admin@example.test"
      })
    ).resolves.toMatchObject({
      tenantId,
      accountId: "account-1",
      email: "admin@example.test"
    });

    await expect(
      repository.listTargetsByEmail({
        email: "admin@example.test"
      })
    ).resolves.toEqual([
      {
        tenantId,
        tenantSlug: "acme",
        tenantDisplayName: "Acme",
        productName: "Acme Desk",
        accountId: "account-1",
        email: "admin@example.test",
        displayName: "Admin"
      }
    ]);
  });

  it("maps a valid token preview", async () => {
    const tokenHash = hashAuthEmailToken("preview-token");
    const repository = createSqlAuthEmailTokenRepository(
      new RecordingSqlExecutor([
        {
          token_id: "token-1",
          tenant_id: tenantId,
          tenant_slug: "acme",
          tenant_display_name: "Acme",
          product_name: null,
          account_id: "account-1",
          email: "admin@example.test",
          display_name: "Admin",
          token_hash: tokenHash,
          purpose: "password_reset",
          expires_at: "2026-06-24T10:00:00.000Z",
          consumed_at: null,
          created_at: now.toISOString()
        }
      ])
    );

    await expect(
      repository.findValidToken({
        tokenHash,
        purpose: "password_reset",
        now
      })
    ).resolves.toMatchObject({
      tenantSlug: "acme",
      productName: "Acme",
      token: {
        tenantId,
        accountId: "account-1",
        purpose: "password_reset",
        tokenHash,
        expiresAt: "2026-06-24T10:00:00.000Z",
        createdAt: now.toISOString()
      }
    });
  });

  it("writes create, verify, email change and reset commands", async () => {
    const executor = new RecordingSqlExecutor([{ token_id: "token-1" }]);
    const repository = createSqlAuthEmailTokenRepository(executor);
    const token: AuthEmailToken = {
      id: "token-1",
      tenantId,
      accountId: "account-1",
      email: "admin@example.test",
      purpose: "email_verification",
      tokenHash: hashAuthEmailToken("email-token"),
      expiresAt: "2026-06-24T10:00:00.000Z",
      createdAt: now.toISOString()
    };

    await repository.createToken({
      token,
      events: [
        {
          id: "event-1" as EventId,
          type: "account.email_verification_requested",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            accountId: "account-1",
            email: "admin@example.test"
          }
        }
      ]
    });
    await repository.completeEmailVerification({
      token,
      verifiedAt: now,
      events: [
        {
          id: "event-2" as EventId,
          type: "account.email_verified",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            accountId: "account-1"
          }
        }
      ]
    });
    await repository.completeEmailChange({
      token: {
        ...token,
        email: "new-admin@example.test",
        purpose: "email_change_verification",
        tokenHash: hashAuthEmailToken("change-token")
      },
      changedAt: now,
      events: [
        {
          id: "event-3" as EventId,
          type: "account.email_changed",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            accountId: "account-1",
            email: "new-admin@example.test"
          }
        }
      ]
    });
    await repository.completePasswordReset({
      token: {
        ...token,
        purpose: "password_reset",
        tokenHash: hashAuthEmailToken("reset-token")
      },
      passwordHash: "scrypt:v1:salt:hash",
      resetAt: now,
      events: [
        {
          id: "event-4" as EventId,
          type: "account.password_reset_completed",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            accountId: "account-1"
          }
        }
      ]
    });

    const verificationQuery = renderQuery(executor.queries[1]);
    const emailChangeQuery = renderQuery(executor.queries[2]);
    const resetQuery = renderQuery(executor.queries[3]);

    expect(renderQuery(executor.queries[0]).sql).toContain("email,");
    expect(verificationQuery.sql).toMatch(/email_verified_at\s*=\s*coalesce/);
    expect(emailChangeQuery.sql).toContain("email_change_verification");
    expect(emailChangeQuery.sql).toContain("duplicate_account");
    expect(emailChangeQuery.sql).toContain("update employees");
    expect(resetQuery.sql).toContain("update sessions");
    expect(resetQuery.sql).toContain("revoked_at");
    expect(resetQuery.sql).toContain("password_hash");
    expect(executor.queries).toHaveLength(4);
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}

function renderQuery(query: SQL | undefined): {
  sql: string;
  params: unknown[];
} {
  if (query === undefined) {
    throw new Error("Expected a recorded SQL query.");
  }

  return new PgDialect().sqlToQuery(query);
}
