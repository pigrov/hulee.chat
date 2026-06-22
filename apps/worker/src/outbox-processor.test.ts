import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  processOutboxBatch,
  type MarkOutboxFailedInput,
  type MarkOutboxProcessedInput,
  type OutboxHandler,
  type OutboxRecord,
  type OutboxRepository
} from "./outbox-processor";

const tenantId = "tenant_worker" as TenantId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("outbox processor", () => {
  it("claims and processes tenant-scoped outbox records once per batch", async () => {
    const record = createRecord("outbox_1");
    const repository = new InMemoryOutboxRepository([record, record]);
    const handler = new RecordingOutboxHandler();

    const result = await processOutboxBatch({
      repository,
      handler,
      batchSize: 10,
      now
    });

    expect(result).toEqual({
      claimed: 2,
      processed: 1,
      failed: 0,
      skippedDuplicates: 1
    });
    expect(handler.handledIds).toEqual(["outbox_1"]);
    expect(repository.processed).toEqual([
      {
        id: "outbox_1",
        tenantId,
        processedAt: now
      }
    ]);
  });

  it("marks failed records with a retry timestamp and normalized error code", async () => {
    const repository = new InMemoryOutboxRepository([createRecord("outbox_2")]);
    const handler: OutboxHandler = {
      async handle(): Promise<void> {
        throw new CoreError("provider.temporary_failure");
      }
    };

    const result = await processOutboxBatch({
      repository,
      handler,
      batchSize: 10,
      now,
      retryDelayMs: 5_000
    });

    expect(result).toEqual({
      claimed: 1,
      processed: 0,
      failed: 1,
      skippedDuplicates: 0
    });
    expect(repository.failed).toEqual([
      {
        id: "outbox_2",
        tenantId,
        failedAt: now,
        attempts: 1,
        nextAttemptAt: new Date("2026-06-22T10:00:05.000Z"),
        errorCode: "provider.temporary_failure"
      }
    ]);
  });

  it("rejects outbox records whose payload tenant does not match the job tenant", async () => {
    const repository = new InMemoryOutboxRepository([
      {
        ...createRecord("outbox_cross"),
        payload: createEvent("tenant_other" as TenantId)
      }
    ]);
    const handler = new RecordingOutboxHandler();

    await expect(
      processOutboxBatch({
        repository,
        handler,
        batchSize: 10,
        now
      })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
    expect(handler.handledIds).toEqual([]);
  });
});

class InMemoryOutboxRepository implements OutboxRepository {
  readonly processed: MarkOutboxProcessedInput[] = [];
  readonly failed: MarkOutboxFailedInput[] = [];

  constructor(private readonly records: readonly OutboxRecord[]) {}

  async claimPending(): Promise<readonly OutboxRecord[]> {
    return this.records;
  }

  async markProcessed(input: MarkOutboxProcessedInput): Promise<void> {
    this.processed.push(input);
  }

  async markFailed(input: MarkOutboxFailedInput): Promise<void> {
    this.failed.push(input);
  }
}

class RecordingOutboxHandler implements OutboxHandler {
  readonly handledIds: string[] = [];

  async handle(record: OutboxRecord): Promise<void> {
    this.handledIds.push(record.id);
  }
}

function createRecord(id: string): OutboxRecord {
  return {
    id,
    tenantId,
    eventId: `event:${id}`,
    payload: createEvent(tenantId),
    attempts: 0,
    status: "processing"
  };
}

function createEvent(inputTenantId: TenantId): PlatformEvent {
  return {
    id: "event_worker" as never,
    type: "message.sent",
    version: "v1",
    tenantId: inputTenantId,
    occurredAt: now.toISOString(),
    payload: {
      messageId: "message_worker" as never
    }
  };
}
