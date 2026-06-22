import {
  createHuleeDatabase,
  closeHuleeDatabase,
  createSqlOutboxRepository
} from "@hulee/db";

import {
  createWorkerOutboxHandler,
  createWorkerRuntime,
  processOutboxBatch
} from "./index";

const runtime = createWorkerRuntime();
const database = createHuleeDatabase({
  connectionString: runtime.config.databaseUrl
});
const outboxRepository = createSqlOutboxRepository(database);
const outboxHandler = createWorkerOutboxHandler({
  database
});

let stopping = false;
let processing = false;

runtime.logger.info("worker.started", {
  pollIntervalMs: runtime.config.pollIntervalMs,
  outboxBatchSize: runtime.config.outboxBatchSize
});

void runLoop();

async function runLoop(): Promise<void> {
  while (!stopping) {
    await processNextBatch();
    await sleep(runtime.config.pollIntervalMs);
  }
}

async function processNextBatch(): Promise<void> {
  if (processing) {
    return;
  }

  processing = true;

  try {
    const result = await processOutboxBatch({
      repository: outboxRepository,
      handler: outboxHandler,
      batchSize: runtime.config.outboxBatchSize,
      now: new Date(),
      retryDelayMs: runtime.config.outboxRetryDelayMs
    });

    if (result.claimed > 0) {
      runtime.logger.info("worker.outbox_batch_processed", {
        claimed: result.claimed,
        processed: result.processed,
        failed: result.failed,
        skippedDuplicates: result.skippedDuplicates
      });
    }
  } catch (error) {
    runtime.logger.error("worker.outbox_batch_failed", undefined, error);
  } finally {
    processing = false;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function shutdown(): Promise<void> {
  stopping = true;
  await closeHuleeDatabase(database);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
