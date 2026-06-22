import type { MessageId, TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlOutboundDispatchRepository } from "./sql-outbound-dispatch-repository";

const tenantId = "tenant_outbound_dispatch" as TenantId;
const messageId = "message_outbound_1" as MessageId;

describe("SQL outbound dispatch repository", () => {
  it("maps queued outbound messages with external channel handle", async () => {
    const executor = new RecordingSqlExecutor([
      {
        id: messageId,
        tenant_id: tenantId,
        conversation_id: "conversation-1",
        text: "Hello",
        idempotency_key: "reply:conversation-1:1",
        external_handle: "channel:telegram-local:client:telegram-user:42"
      }
    ]);
    const repository = createSqlOutboundDispatchRepository(executor);

    await expect(
      repository.findQueuedMessage({
        tenantId,
        messageId
      })
    ).resolves.toEqual({
      tenantId,
      messageId,
      conversationId: "conversation-1",
      channelExternalId: "telegram-local",
      clientExternalId: "telegram-user:42",
      text: "Hello",
      idempotencyKey: "reply:conversation-1:1"
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("returns null when there is no queued external outbound message", async () => {
    const repository = createSqlOutboundDispatchRepository(
      new RecordingSqlExecutor([])
    );

    await expect(
      repository.findQueuedMessage({
        tenantId,
        messageId
      })
    ).resolves.toBeNull();
  });

  it("rejects invalid external handles before dispatch", async () => {
    const repository = createSqlOutboundDispatchRepository(
      new RecordingSqlExecutor([
        {
          id: messageId,
          tenant_id: tenantId,
          conversation_id: "conversation-1",
          text: "Hello",
          idempotency_key: "reply:conversation-1:1",
          external_handle: "bad-handle"
        }
      ])
    );

    await expect(
      repository.findQueuedMessage({
        tenantId,
        messageId
      })
    ).rejects.toMatchObject({
      code: "validation.failed"
    });
  });

  it("executes sent and failed delivery state updates", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlOutboundDispatchRepository(executor);
    const now = new Date("2026-06-22T10:00:00.000Z");

    await repository.markSent({
      tenantId,
      messageId,
      providerMessageId: "telegram-message-1",
      attemptId: "attempt-1",
      deliveredAt: now
    });
    await repository.markFailed({
      tenantId,
      messageId,
      errorCode: "provider.permanent_failure",
      attemptId: "attempt-2",
      failedAt: now
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
