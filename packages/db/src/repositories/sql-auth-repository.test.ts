import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
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
          tenant_display_name: "Local Company",
          account_id: "account-1",
          employee_id: employeeId,
          email: "admin@example.test",
          email_verified_at: new Date("2026-06-22T10:00:00.000Z"),
          display_name: "Admin",
          password_hash: "scrypt:v1:salt:hash",
          roles: ["tenant_admin", "unknown"],
          permissions: ["modules.manage", "message.reply", "unknown"]
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
      tenantSlug: "local",
      tenantDisplayName: "Local Company",
      employeeId,
      emailVerifiedAt: new Date("2026-06-22T10:00:00.000Z"),
      roles: ["tenant_admin"],
      permissions: expect.arrayContaining(["modules.manage", "message.reply"])
    });
  });

  it("lists active tenant auth accounts by email for email-first login", async () => {
    const repository = createSqlLocalAuthRepository(
      new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          tenant_slug: "acme",
          tenant_display_name: "Acme",
          account_id: "account-1",
          employee_id: employeeId,
          email: "admin@example.test",
          email_verified_at: null,
          display_name: "Admin",
          password_hash: "scrypt:v1:salt:hash",
          roles: ["tenant_admin"],
          permissions: ["tenant.manage"]
        },
        {
          tenant_id: "tenant_other",
          tenant_slug: "other",
          tenant_display_name: "Other",
          account_id: "account-2",
          employee_id: "employee_other",
          email: "admin@example.test",
          email_verified_at: new Date("2026-06-22T10:00:00.000Z"),
          display_name: "Admin Other",
          password_hash: "scrypt:v1:salt:hash",
          roles: ["agent"],
          permissions: ["inbox.read"]
        }
      ])
    );

    await expect(
      repository.listTenantAccountsByEmail("admin@example.test")
    ).resolves.toMatchObject([
      {
        tenantSlug: "acme",
        tenantDisplayName: "Acme",
        emailVerifiedAt: null,
        roles: ["tenant_admin"]
      },
      {
        tenantSlug: "other",
        tenantDisplayName: "Other",
        roles: ["agent"]
      }
    ]);
  });

  it("maps sessions with tenant and platform principals", async () => {
    const repository = createSqlLocalAuthRepository(
      new RecordingSqlExecutor([
        {
          session_id: "session-1",
          expires_at: new Date("2026-06-23T10:00:00.000Z"),
          tenant_id: tenantId,
          tenant_slug: "local",
          tenant_display_name: "Local Company",
          account_id: "account-1",
          employee_id: employeeId,
          employee_email: "admin@example.test",
          employee_email_verified_at: new Date("2026-06-22T10:00:00.000Z"),
          employee_display_name: "Admin",
          employee_password_hash: "scrypt:v1:salt:hash",
          employee_roles: ["tenant_admin"],
          employee_permissions: ["tenant.manage", "message.reply"],
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
        tenantDisplayName: "Local Company",
        employeeId,
        emailVerifiedAt: new Date("2026-06-22T10:00:00.000Z"),
        roles: ["tenant_admin"],
        permissions: ["tenant.manage", "message.reply"]
      },
      platformAdmin: {
        id: "platform-admin-1",
        email: "platform@example.test"
      }
    });
  });

  it("aggregates scoped permissions for coarse session capability checks", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlLocalAuthRepository(executor);

    await repository.findSessionByToken(
      "raw-token",
      new Date("2026-06-22T10:00:00.000Z")
    );

    const query = renderQuery(executor.queries[0]).sql;

    expect(query).toContain("employee_org_unit_memberships");
    expect(query).toContain("employee_work_queue_memberships");
    expect(query).not.toContain("tenant_role_bindings.scope_type = 'tenant'");
    expect(query).not.toContain(
      "direct_permission_grants.scope_type = 'tenant'"
    );
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

    const tenantAdminUpsertQuery = renderQuery(executor.queries[2]);

    expect(tenantAdminUpsertQuery.sql).toContain("tenant_roles");
    expect(tenantAdminUpsertQuery.sql).toContain("tenant_role_permissions");
    expect(tenantAdminUpsertQuery.sql).toContain("tenant_role_bindings");
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
