import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  createSqlLocalAuthRepository,
  hashAuthSessionToken
} from "./sql-auth-repository";

const tenantId = "tenant_auth" as TenantId;
const employeeId = "employee_auth" as EmployeeId;

describe("SQL local auth repository", () => {
  it("hashes session tokens without exposing the raw token", () => {
    const hash = hashAuthSessionToken("raw-session-token");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain("raw-session-token");
  });

  it("maps tenant auth accounts with valid roles and permissions", async () => {
    const repository = createSqlLocalAuthRepository(
      new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          tenant_slug: "local",
          account_id: "account-1",
          employee_id: employeeId,
          email: "admin@example.test",
          display_name: "Admin",
          password_hash: "scrypt:v1:salt:hash",
          roles: ["tenant_admin", "unknown"]
        }
      ])
    );

    await expect(
      repository.findTenantAccount({
        tenantSlug: "local",
        email: "admin@example.test"
      })
    ).resolves.toMatchObject({
      tenantId,
      employeeId,
      roles: ["tenant_admin"],
      permissions: expect.arrayContaining(["modules.manage", "message.reply"])
    });
  });

  it("maps sessions with tenant and platform principals", async () => {
    const repository = createSqlLocalAuthRepository(
      new RecordingSqlExecutor([
        {
          session_id: "session-1",
          expires_at: new Date("2026-06-23T10:00:00.000Z"),
          tenant_id: tenantId,
          tenant_slug: "local",
          account_id: "account-1",
          employee_id: employeeId,
          employee_email: "admin@example.test",
          employee_display_name: "Admin",
          employee_password_hash: "scrypt:v1:salt:hash",
          employee_roles: ["tenant_admin"],
          platform_admin_account_id: "platform-admin-1",
          platform_admin_email: "platform@example.test",
          platform_admin_display_name: "Platform Admin"
        }
      ])
    );

    await expect(
      repository.findSessionByToken(
        "raw-token",
        new Date("2026-06-22T10:00:00.000Z")
      )
    ).resolves.toMatchObject({
      sessionId: "session-1",
      tenantAccount: {
        tenantId,
        employeeId,
        roles: ["tenant_admin"]
      },
      platformAdmin: {
        id: "platform-admin-1",
        email: "platform@example.test"
      }
    });
  });

  it("returns null for unknown sessions", async () => {
    const repository = createSqlLocalAuthRepository(
      new RecordingSqlExecutor([])
    );

    await expect(
      repository.findSessionByToken(
        "missing-token",
        new Date("2026-06-22T10:00:00.000Z")
      )
    ).resolves.toBeNull();
  });

  it("writes session and seed account commands", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlLocalAuthRepository(executor);

    await repository.createSession({
      id: "session-1",
      token: "raw-token",
      tenantId,
      employeeId,
      platformAdminAccountId: "platform-admin-1",
      expiresAt: new Date("2026-06-23T10:00:00.000Z"),
      createdAt: new Date("2026-06-22T10:00:00.000Z")
    });
    await repository.upsertPlatformAdminAccount({
      id: "platform-admin-1",
      email: "platform@example.test",
      displayName: "Platform Admin",
      passwordHash: "scrypt:v1:salt:hash",
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });
    await repository.upsertTenantAdminAccount({
      accountId: "account-1",
      employeeId,
      tenantId,
      email: "admin@example.test",
      displayName: "Admin",
      passwordHash: "scrypt:v1:salt:hash",
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });
    await repository.revokeSession(
      "raw-token",
      new Date("2026-06-22T11:00:00.000Z")
    );

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
