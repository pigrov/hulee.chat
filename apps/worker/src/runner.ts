import {
  createHuleeDatabase,
  closeHuleeDatabase,
  createSqlDeploymentEgressStatusRepository,
  createSqlOutboxRepository
} from "@hulee/db";

import {
  createWorkerEgressMonitor,
  createWorkerDirectAccountAuthSweeper,
  createWorkerTelegramAttachmentTransferSweeper,
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
        egressProfile: runtime.config.egressProfile,
        publicWebhookBaseUrl: runtime.config.publicWebhookBaseUrl
      }),
      pollingSweeper: createWorkerTelegramPollingSweeper({
        database,
        secretEncryptionKey: runtime.config.secretEncryptionKey,
        egressProfile: runtime.config.egressProfile
      }),
      attachmentTransferSweeper: runtime.config.objectStorage
        ? createWorkerTelegramAttachmentTransferSweeper({
            database,
            objectStorageConfig: runtime.config.objectStorage,
            secretEncryptionKey: runtime.config.secretEncryptionKey,
            egressProfile: runtime.config.egressProfile
          })
        : undefined
    }
  : undefined;
const directAccountAuthSweeper =
  runtime.config.workerFeatures.includes("telegram_user") ||
  runtime.config.workerFeatures.includes("whatsapp_user")
    ? createWorkerDirectAccountAuthSweeper({
        database,
        secretEncryptionKey: runtime.config.secretEncryptionKey,
        telegramUserAuthEnabled:
          runtime.config.workerFeatures.includes("telegram_user"),
        telegramUserApiId: runtime.config.telegramUserApiId,
        telegramUserApiHash: runtime.config.telegramUserApiHash,
        whatsappUserAuthEnabled:
          runtime.config.workerFeatures.includes("whatsapp_user"),
        logger: runtime.logger,
        workerId: "worker:direct-account-auth"
      })
    : undefined;
const egressMonitor = createWorkerEgressMonitor({
  config: runtime.config,
  repository: createSqlDeploymentEgressStatusRepository(database),
  logger: runtime.logger
});

let stopping = false;
let processing = false;

runtime.logger.info("worker.started", {
  workerFeatures: runtime.config.workerFeatures,
  pollIntervalMs: runtime.config.pollIntervalMs,
  outboxBatchSize: runtime.config.outboxBatchSize,
  egressProfileKind: runtime.config.egressProfile.profileKind,
  egressProfileStatus: runtime.config.egressProfile.status,
  egressProbesEnabled: runtime.config.egressProbesEnabled,
  egressProbeIntervalMs: runtime.config.egressProbeIntervalMs
});

egressMonitor.start();
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

  if (
    telegramBotServices === undefined &&
    directAccountAuthSweeper === undefined
  ) {
    return;
  }

  processing = true;

  try {
    if (telegramBotServices !== undefined) {
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

      if (
        pollingResult.configsPolled > 0 ||
        pollingResult.updatesReceived > 0
      ) {
        runtime.logger.info("worker.telegram_polling_sweep_processed", {
          configsScanned: pollingResult.configsScanned,
          configsPolled: pollingResult.configsPolled,
          updatesReceived: pollingResult.updatesReceived,
          updatesAccepted: pollingResult.updatesAccepted,
          updatesFailed: pollingResult.updatesFailed
        });
      }

      const attachmentTransferResult =
        await telegramBotServices.attachmentTransferSweeper?.sweep();

      if (
        attachmentTransferResult &&
        (attachmentTransferResult.attempted > 0 ||
          attachmentTransferResult.failed > 0)
      ) {
        runtime.logger.info("worker.telegram_attachment_transfer_processed", {
          scanned: attachmentTransferResult.scanned,
          attempted: attachmentTransferResult.attempted,
          stored: attachmentTransferResult.stored,
          failed: attachmentTransferResult.failed
        });
      }
    }

    const directAuthResult = await directAccountAuthSweeper?.sweep();

    if (
      directAuthResult &&
      (directAuthResult.claimed > 0 ||
        directAuthResult.failed > 0 ||
        directAuthResult.completed > 0)
    ) {
      runtime.logger.info("worker.direct_account_auth_sweep_processed", {
        scanned: directAuthResult.scanned,
        claimed: directAuthResult.claimed,
        processed: directAuthResult.processed,
        pending: directAuthResult.pending,
        completed: directAuthResult.completed,
        failed: directAuthResult.failed,
        expired: directAuthResult.expired,
        skippedLeased: directAuthResult.skippedLeased,
        skippedUnsupported: directAuthResult.skippedUnsupported,
        skippedInactive: directAuthResult.skippedInactive
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
  egressMonitor.stop();
  await closeHuleeDatabase(database);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
