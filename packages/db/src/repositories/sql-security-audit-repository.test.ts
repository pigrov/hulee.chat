import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSqlSecurityAuditRepository } from "./sql-security-audit-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL security audit repository", () => {
  it("writes tenant-scoped security audit records", async () => {
    const executor = new RecordingSqlExecutor();
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
