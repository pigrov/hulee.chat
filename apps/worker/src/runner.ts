import {
  createHuleeDatabase,
  closeHuleeDatabase,
  createSqlOutboxRepository
} from "@hulee/db";

import {
  createWorkerOutboxHandler,
  createWorkerTelegramPollingSweeper,
  createWorkerRuntime,
  processOutboxBatch
} from "./index";

const runtime = createWorkerRuntime();
const database = createHuleeDatabase({
  connectionString: runtime.config.databaseUrl
});
const outboxRepository = createSqlOutboxRepository(database);
const outboxHandler = createWorkerOutboxHandler({
  database,
  secretEncryptionKey: runtime.config.secretEncryptionKey,
  egressProfile: runtime.config.egressProfile
});
const telegramPollingSweeper = createWorkerTelegramPollingSweeper({
  database,
  secretEncryptionKey: runtime.config.secretEncryptionKey,
  egressProfile: runtime.config.egressProfile
});

let stopping = false;
let processing = false;

runtime.logger.info("worker.started", {
  pollIntervalMs: runtime.config.pollIntervalMs,
  outboxBatchSize: runtime.config.outboxBatchSize,
  egressProfileKind: runtime.config.egressProfile.profileKind,
  egressProfileStatus: runtime.config.egressProfile.status
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

    const pollingResult = await telegramPollingSweeper.sweep();

    if (pollingResult.configsPolled > 0 || pollingResult.updatesReceived > 0) {
      runtime.logger.info("worker.telegram_polling_sweep_processed", {
        configsScanned: pollingResult.configsScanned,
        configsPolled: pollingResult.configsPolled,
        updatesReceived: pollingResult.updatesReceived,
        updatesAccepted: pollingResult.updatesAccepted,
        updatesFailed: pollingResult.updatesFailed
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
