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
const telegramBotServices = runtime.config.workerFeatures.includes(
  "telegram_bot"
)
  ? {
      outboxRepository: createSqlOutboxRepository(database),
      outboxHandler: createWorkerOutboxHandler({
        database,
        secretEncryptionKey: runtime.config.secretEncryptionKey,
        egressProfile: runtime.config.egressProfile
      }),
      pollingSweeper: createWorkerTelegramPollingSweeper({
        database,
        secretEncryptionKey: runtime.config.secretEncryptionKey,
        egressProfile: runtime.config.egressProfile
      })
    }
  : undefined;

let stopping = false;
let processing = false;

runtime.logger.info("worker.started", {
  workerFeatures: runtime.config.workerFeatures,
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

  if (telegramBotServices === undefined) {
    return;
  }

  processing = true;

  try {
    const result = await processOutboxBatch({
      repository: telegramBotServices.outboxRepository,
      handler: telegramBotServices.outboxHandler,
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

    const pollingResult = await telegramBotServices.pollingSweeper.sweep();

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
    runtime.logger.error("worker.provider_batch_failed", undefined, error);
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
