import type { OutboxRecord, OutboxRepository } from "@hulee/db";
import type { PlatformErrorCode } from "@hulee/contracts";
import { CoreError } from "@hulee/core";

export type {
  ClaimPendingOutboxInput,
  MarkOutboxFailedInput,
  MarkOutboxProcessedInput,
  OutboxRecord,
  OutboxRepository
} from "@hulee/db";

export type OutboxHandler = {
  handle(record: OutboxRecord): Promise<void>;
};

export type ProcessOutboxBatchInput = {
  repository: OutboxRepository;
  handler: OutboxHandler;
  batchSize: number;
  now: Date;
  retryDelayMs?: number;
};

export type ProcessOutboxBatchResult = {
  claimed: number;
  processed: number;
  failed: number;
  skippedDuplicates: number;
};

const defaultRetryDelayMs = 30_000;

export async function processOutboxBatch(
  input: ProcessOutboxBatchInput
): Promise<ProcessOutboxBatchResult> {
  const records = await input.repository.claimPending({
    batchSize: input.batchSize,
    now: input.now
  });
  const seenIds = new Set<string>();
  const result: ProcessOutboxBatchResult = {
    claimed: records.length,
    processed: 0,
    failed: 0,
    skippedDuplicates: 0
  };

  for (const record of records) {
    if (seenIds.has(record.id)) {
      result.skippedDuplicates += 1;
      continue;
    }

    seenIds.add(record.id);
    assertOutboxTenantBoundary(record);

    try {
      await input.handler.handle(record);
      await input.repository.markProcessed({
        id: record.id,
        tenantId: record.tenantId,
        processedAt: input.now
      });
      result.processed += 1;
    } catch (error) {
      await input.repository.markFailed({
        id: record.id,
        tenantId: record.tenantId,
        failedAt: input.now,
        attempts: record.attempts + 1,
        nextAttemptAt: new Date(
          input.now.getTime() + (input.retryDelayMs ?? defaultRetryDelayMs)
        ),
        errorCode: normalizeOutboxError(error)
      });
      result.failed += 1;
    }
  }

  return result;
}

function assertOutboxTenantBoundary(record: OutboxRecord): void {
  if (record.payload.tenantId !== record.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function normalizeOutboxError(error: unknown): PlatformErrorCode {
  if (error instanceof CoreError) {
    return error.code;
  }

  return "provider.temporary_failure";
}
