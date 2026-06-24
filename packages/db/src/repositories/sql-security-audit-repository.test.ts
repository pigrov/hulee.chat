import type { EmployeeId, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { createSqlSecurityAuditRepository } from "./sql-security-audit-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL security audit repository", () => {
  it("writes tenant-scoped security audit records", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:session-1:login",
      tenantId: "tenant-1" as TenantId,
      actorEmployeeId: "employee-1" as EmployeeId,
      action: "auth.login.succeeded",
      entityType: "session",
      entityId: "session-1",
      metadata: {
        accountId: "account-1",
        surface: "web"
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
  });

  it("writes and lists access audit records", async () => {
    const tenantId = "tenant-1" as TenantId;
    const actorEmployeeId = "employee-admin" as EmployeeId;
    const targetEmployeeId = "employee-agent" as EmployeeId;
    const executor = new RecordingSqlExecutor([
      [],
      [
        {
          id: "audit:role-binding-1:created",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          action: "role_binding.created",
          entity_type: "role_binding",
          entity_id: "role-binding-1",
          metadata: {
            roleId: "role-sales",
            targetEmployeeId,
            permission: "client.view"
          },
          created_at: new Date("2026-06-23T12:00:00.000Z")
        }
      ]
    ]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:role-binding-1:created",
      tenantId,
      actorEmployeeId,
      action: "role_binding.created",
      entityType: "role_binding",
      entityId: "role-binding-1",
      metadata: {
        roleId: "role-sales",
        targetEmployeeId
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    await expect(
      repository.listAccessRecords({
        tenantId,
        limit: 25,
        action: "role_binding.created",
        targetEmployeeId,
        roleId: "role-sales",
        permission: "client.view"
      })
    ).resolves.toEqual([
      {
        id: "audit:role-binding-1:created",
        tenantId,
        actorEmployeeId,
        action: "role_binding.created",
        entityType: "role_binding",
        entityId: "role-binding-1",
        metadata: {
          roleId: "role-sales",
          targetEmployeeId,
          permission: "client.view"
        },
        occurredAt: "2026-06-23T12:00:00.000Z"
      }
    ]);

    const writeQuery = renderQuery(executor.queries[0]);
    const listQuery = renderQuery(executor.queries[1]);

    expect(writeQuery.sql).toContain("insert into audit_log");
    expect(listQuery.sql).toContain("from audit_log");
    expect(listQuery.sql).toContain("metadata->>'targetEmployeeId'");
    expect(listQuery.sql).toContain("metadata->>'roleId'");
    expect(listQuery.sql).toContain("metadata->>'permission'");
    expect(listQuery.params).toEqual(
      expect.arrayContaining([
        tenantId,
        "role_binding.created",
        targetEmployeeId,
        "role-sales",
        "client.view"
      ])
    );
  });

  it("writes and lists conversation routing audit records", async () => {
    const tenantId = "tenant-1" as TenantId;
    const actorEmployeeId = "employee-admin" as EmployeeId;
    const executor = new RecordingSqlExecutor([
      [],
      [
        {
          id: "audit:conversation-1:routing",
          tenant_id: tenantId,
          actor_employee_id: actorEmployeeId,
          entity_id: "conversation-1",
          metadata: {
            previousCurrentQueueId: "queue-intake",
            currentQueueId: "queue-sales"
          },
          created_at: new Date("2026-06-23T12:00:00.000Z")
        }
      ]
    ]);
    const repository = createSqlSecurityAuditRepository(executor);

    await repository.record({
      id: "audit:conversation-1:routing",
      tenantId,
      actorEmployeeId,
      action: "conversation.routing.updated",
      entityType: "conversation",
      entityId: "conversation-1",
      metadata: {
        previousCurrentQueueId: "queue-intake",
        currentQueueId: "queue-sales"
      },
      occurredAt: new Date("2026-06-23T12:00:00.000Z")
    });

    await expect(
      repository.listConversationRoutingRecords({
        tenantId,
        conversationId: "conversation-1",
        limit: 5
      })
    ).resolves.toEqual([
      {
        id: "audit:conversation-1:routing",
        tenantId,
        actorEmployeeId,
        conversationId: "conversation-1",
        metadata: {
          previousCurrentQueueId: "queue-intake",
          currentQueueId: "queue-sales"
        },
        occurredAt: "2026-06-23T12:00:00.000Z"
      }
    ]);

    const listQuery = renderQuery(executor.queries[1]);

    expect(listQuery.sql).toContain("action = 'conversation.routing.updated'");
    expect(listQuery.sql).toContain("entity_type = 'conversation'");
    expect(listQuery.params).toEqual(
      expect.arrayContaining([tenantId, "conversation-1"])
    );
  });

  it("rejects cross-tenant conversation routing audit rows", async () => {
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "audit:conversation-cross-tenant:routing",
            tenant_id: "tenant-2",
            actor_employee_id: "employee-admin",
            entity_id: "conversation-1",
            metadata: {
              currentQueueId: "queue-sales"
            },
            created_at: new Date("2026-06-23T12:00:00.000Z")
          }
        ]
      ])
    );

    await expect(
      repository.listConversationRoutingRecords({
        tenantId: "tenant-1" as TenantId,
        conversationId: "conversation-1",
        limit: 10
      })
    ).rejects.toEqual(new CoreError("tenant.boundary_violation"));
  });

  it("rejects cross-tenant access audit rows", async () => {
    const repository = createSqlSecurityAuditRepository(
      new RecordingSqlExecutor([
        [
          {
            id: "audit:cross-tenant",
            tenant_id: "tenant-2",
            actor_employee_id: "employee-admin",
            action: "role.created",
            entity_type: "role",
            entity_id: "role-sales",
            metadata: {
              roleId: "role-sales"
            },
            created_at: new Date("2026-06-23T12:00:00.000Z")
          }
        ]
      ])
    );

    await expect(
      repository.listAccessRecords({
        tenantId: "tenant-1" as TenantId,
        limit: 50
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];
  private nextResultIndex = 0;

  constructor(
    private readonly resultSets: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.resultSets[this.nextResultIndex] ?? [];
    this.nextResultIndex += 1;

    return {
      rows: rows as readonly Row[]
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
