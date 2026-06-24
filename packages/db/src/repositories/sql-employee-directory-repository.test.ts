import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";
import type { Employee } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import {
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken
} from "./sql-employee-directory-repository";

const tenantId = "tenant_directory" as TenantId;
const employeeId = "employee_directory" as EmployeeId;

describe("SQL employee directory repository", () => {
  it("hashes invitation tokens without exposing the raw token", () => {
    const hash = hashEmployeeInvitationToken("raw-invitation-token");

    expect(hash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(hash).not.toContain("raw-invitation-token");
  });

  it("maps employees with valid roles and permissions", async () => {
    const repository = createSqlEmployeeDirectoryRepository(
      new RecordingSqlExecutor([
        {
          tenant_id: tenantId,
          employee_id: employeeId,
          account_id: "account-1",
          email: "agent@example.test",
          display_name: "Agent",
          roles: ["agent", "unknown"],
          org_unit_ids: ["org-sales"],
          queue_ids: ["queue-sales"],
          created_at: "2026-06-23T10:00:00.000Z",
          deactivated_at: null
        }
      ])
    );

    await expect(
      repository.listEmployees({
        tenantId
      })
    ).resolves.toEqual([
      {
        tenantId,
        employeeId,
        accountId: "account-1",
        email: "agent@example.test",
        displayName: "Agent",
        roles: ["agent"],
        orgUnitIds: ["org-sales"],
        queueIds: ["queue-sales"],
        createdAt: new Date("2026-06-23T10:00:00.000Z"),
        deactivatedAt: null
      }
    ]);
  });

  it("maps invitation preview without requiring tenant input", async () => {
    const tokenHash = hashEmployeeInvitationToken("preview-token");
    const repository = createSqlEmployeeDirectoryRepository(
      new RecordingSqlExecutor([
        {
          id: "invitation-1",
          tenant_id: tenantId,
          email: "agent@example.test",
          display_name: "Agent",
          role: "agent",
          token_hash: tokenHash,
          invited_by_employee_id: "employee-admin",
          accepted_employee_id: null,
          expires_at: "2026-06-30T10:00:00.000Z",
          accepted_at: null,
          revoked_at: null,
          created_at: "2026-06-23T10:00:00.000Z",
          tenant_slug: "acme",
          tenant_display_name: "Acme",
          product_name: "Acme Desk"
        }
      ])
    );

    await expect(
      repository.findInvitationByTokenHash(tokenHash)
    ).resolves.toMatchObject({
      tenantSlug: "acme",
      tenantDisplayName: "Acme",
      productName: "Acme Desk",
      invitation: {
        id: "invitation-1",
        tenantId,
        email: "agent@example.test",
        role: "agent",
        expiresAt: "2026-06-30T10:00:00.000Z",
        createdAt: "2026-06-23T10:00:00.000Z"
      }
    });
  });

  it("writes invitation and accept commands", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        tenant_slug: "acme",
        tenant_display_name: "Acme",
        account_id: "account-1",
        employee_id: employeeId,
        email: "agent@example.test",
        email_verified_at: "2026-06-23T10:00:00.000Z",
        display_name: "Agent",
        password_hash: "scrypt:v1:salt:hash",
        roles: ["agent"],
        permissions: ["inbox.read", "message.reply"]
      }
    ]);
    const repository = createSqlEmployeeDirectoryRepository(executor);
    const now = "2026-06-23T10:00:00.000Z";

    await repository.createInvitation({
      invitation: {
        id: "invitation-1",
        tenantId,
        email: "agent@example.test",
        role: "agent",
        tokenHash: hashEmployeeInvitationToken("invite-token"),
        invitedByEmployeeId: "employee-admin" as EmployeeId,
        expiresAt: "2026-06-30T10:00:00.000Z",
        createdAt: now
      },
      events: [
        {
          id: "event-1" as EventId,
          type: "employee.invited",
          version: "v1",
          tenantId,
          occurredAt: now,
          payload: {
            invitationId: "invitation-1",
            email: "agent@example.test",
            role: "agent"
          }
        }
      ]
    });
    await expect(
      repository.acceptInvitation({
        tokenHash: hashEmployeeInvitationToken("invite-token"),
        accountId: "account-1",
        passwordHash: "scrypt:v1:salt:hash",
        acceptedAt: new Date(now),
        employee: {
          id: employeeId,
          tenantId,
          email: "agent@example.test",
          displayName: "Agent",
          roles: ["agent"],
          createdAt: now
        } satisfies Employee,
        events: [
          {
            id: "event-2" as EventId,
            type: "employee.created",
            version: "v1",
            tenantId,
            occurredAt: now,
            payload: {
              employeeId
            }
          },
          {
            id: "event-3" as EventId,
            type: "account.email_verified",
            version: "v1",
            tenantId,
            occurredAt: now,
            payload: {
              accountId: "account-1"
            }
          }
        ]
      })
    ).resolves.toMatchObject({
      tenantId,
      tenantSlug: "acme",
      tenantDisplayName: "Acme",
      employeeId,
      emailVerifiedAt: new Date("2026-06-23T10:00:00.000Z"),
      roles: ["agent"],
      permissions: expect.arrayContaining(["inbox.read", "message.reply"])
    });

    const acceptQuery = renderQuery(executor.queries[1]);

    expect(acceptQuery.sql).toMatch(/email_verified_at\s*,/);
    expect(acceptQuery.sql).toContain("insert into tenant_roles");
    expect(acceptQuery.sql).toContain("insert into tenant_role_permissions");
    expect(acceptQuery.sql).toContain("insert into tenant_role_bindings");
    expect(acceptQuery.params).toContainEqual(new Date(now));
    expect(
      acceptQuery.params.some((param) => {
        return (
          typeof param === "string" && param.includes("account.email_verified")
        );
      })
    ).toBe(true);
    expect(executor.queries).toHaveLength(2);
  });

  it("writes role, deactivation and invitation lifecycle commands", async () => {
    const executor = new RecordingSqlExecutor([
      {
        employee_id: employeeId,
        invitation_id: "invitation-1"
      }
    ]);
    const repository = createSqlEmployeeDirectoryRepository(executor);
    const now = new Date("2026-06-23T10:00:00.000Z");
    const events = [
      {
        id: "event-1" as EventId,
        type: "employee.role_changed" as const,
        version: "v1" as const,
        tenantId,
        occurredAt: now.toISOString(),
        payload: {
          employeeId,
          role: "supervisor"
        }
      }
    ];

    await repository.changeEmployeeRole({
      tenantId,
      employeeId,
      role: "supervisor",
      changedAt: now,
      events
    });

    const changeRoleQuery = renderQuery(executor.queries[0]);

    expect(changeRoleQuery.sql).toContain("update tenant_role_bindings");
    expect(changeRoleQuery.sql).toContain("insert into tenant_role_bindings");

    await repository.deactivateEmployee({
      tenantId,
      employeeId,
      deactivatedAt: now,
      events: [
        {
          id: "event-2" as EventId,
          type: "employee.deactivated",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            employeeId
          }
        }
      ]
    });
    await repository.revokeInvitation({
      tenantId,
      invitationId: "invitation-1",
      revokedAt: now,
      events: [
        {
          id: "event-3" as EventId,
          type: "employee.invitation_revoked",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            invitationId: "invitation-1"
          }
        }
      ]
    });
    await repository.refreshInvitation({
      refreshedAt: now,
      invitation: {
        id: "invitation-1",
        tenantId,
        email: "agent@example.test",
        role: "agent",
        tokenHash: hashEmployeeInvitationToken("new-token"),
        invitedByEmployeeId: "employee-admin" as EmployeeId,
        expiresAt: "2026-06-30T10:00:00.000Z",
        createdAt: now.toISOString()
      },
      events: [
        {
          id: "event-4" as EventId,
          type: "employee.invitation_resent",
          version: "v1",
          tenantId,
          occurredAt: now.toISOString(),
          payload: {
            invitationId: "invitation-1"
          }
        }
      ]
    });

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
