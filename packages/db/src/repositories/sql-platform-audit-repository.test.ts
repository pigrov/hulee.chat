import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { createSqlPlatformAuditRepository } from "./sql-platform-audit-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL platform audit repository", () => {
  it("writes global platform audit records", async () => {
    const executor = new RecordingSqlExecutor();
    const repository = createSqlPlatformAuditRepository(executor);

    await repository.record({
      id: "platform-audit:session-1:login",
      actorPlatformAdminAccountId: "platform-admin-1",
      action: "platform.auth.login.succeeded",
      entityType: "session",
      entityId: "session-1",
      metadata: {
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
