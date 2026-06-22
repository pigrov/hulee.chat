import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  createSqlOutboxRepository,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant_sql_outbox" as TenantId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("SQL outbox repository", () => {
  it("claims pending rows as processing outbox records", async () => {
    const executor = new RecordingSqlExecutor([
      {
        id: "outbox_1",
        tenant_id: tenantId,
        event_id: "event_1",
        payload: createEvent(tenantId),
        attempts: 2
      }
    ]);
    const repository = createSqlOutboxRepository(executor);

    const records = await repository.claimPending({
      batchSize: 10,
      now
    });

    expect(records).toEqual([
      {
        id: "outbox_1",
        tenantId,
        eventId: "event_1",
        payload: createEvent(tenantId),
        attempts: 2,
        status: "processing"
      }
    ]);
    expect(executor.queries).toHaveLength(1);
  });

  it("rejects claimed rows whose payload tenant differs from row tenant", async () => {
    const executor = new RecordingSqlExecutor([
      {
        id: "outbox_cross",
        tenant_id: tenantId,
        event_id: "event_cross",
        payload: createEvent("tenant_other" as TenantId),
        attempts: 0
      }
    ]);
    const repository = createSqlOutboxRepository(executor);

    await expect(
      repository.claimPending({
        batchSize: 10,
        now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("executes processed and failed state updates", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlOutboxRepository(executor);

    await repository.markProcessed({
      id: "outbox_1",
      tenantId,
      processedAt: now
    });
    await repository.markFailed({
      id: "outbox_2",
      tenantId,
      failedAt: now,
      attempts: 3,
      nextAttemptAt: new Date("2026-06-22T10:01:00.000Z"),
      errorCode: "provider.temporary_failure"
    });

    expect(executor.queries).toHaveLength(2);
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

function createEvent(inputTenantId: TenantId): PlatformEvent {
  return {
    id: "event_sql_outbox" as never,
    type: "message.sent",
    version: "v1",
    tenantId: inputTenantId,
    occurredAt: now.toISOString(),
    payload: {
      messageId: "message_sql_outbox" as never
    }
  };
}
