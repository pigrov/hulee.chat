import type { EmployeeId, EventId, TenantId } from "@hulee/contracts";
import { CoreError, createRbacEvent } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlDomainEventRepository } from "./sql-domain-event-repository";

const tenantId = "tenant_domain_events" as TenantId;
const otherTenantId = "tenant_domain_events_other" as TenantId;
const actorEmployeeId = "employee_admin" as EmployeeId;
const now = "2026-06-24T10:00:00.000Z";

describe("SQL domain event repository", () => {
  it("appends tenant-scoped events into event store and outbox", async () => {
    const executor = new RecordingSqlExecutor();
    const repository = createSqlDomainEventRepository(executor);

    await repository.append({
      tenantId,
      events: [
        createRbacEvent({
          id: "event_role_created" as EventId,
          tenantId,
          type: "role.created",
          occurredAt: now,
          payload: {
            roleId: "role-sales",
            actorEmployeeId,
            name: "Sales",
            permissions: ["client.view"],
            permissionCount: 1,
            isSystem: false
          }
        })
      ]
    });

    expect(executor.queries).toHaveLength(1);

    const query = renderQuery(executor.queries[0]);

    expect(query.sql).toContain("insert into event_store");
    expect(query.sql).toContain("insert into outbox");
    expect(query.sql).toContain("on conflict (id) do nothing");
    expect(query.params).toEqual(expect.arrayContaining([tenantId]));
    expect(query.params.join("\n")).toContain("role.created");
    expect(query.params.join("\n")).toContain("role-sales");
  });

  it("does not execute SQL for empty event batches", async () => {
    const executor = new RecordingSqlExecutor();
    const repository = createSqlDomainEventRepository(executor);

    await repository.append({
      tenantId,
      events: []
    });

    expect(executor.queries).toHaveLength(0);
  });

  it("rejects cross-tenant events before executing SQL", async () => {
    const executor = new RecordingSqlExecutor();
    const repository = createSqlDomainEventRepository(executor);

    await expect(
      repository.append({
        tenantId,
        events: [
          createRbacEvent({
            id: "event_cross_tenant" as EventId,
            tenantId: otherTenantId,
            type: "role.archived",
            occurredAt: now,
            payload: {
              roleId: "role-sales",
              actorEmployeeId,
              name: "Sales",
              status: "archived"
            }
          })
        ]
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
    expect(executor.queries).toHaveLength(0);
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: []
    };
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}
