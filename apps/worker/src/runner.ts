import {
  assertInboxV2RuntimeSchemaEpoch,
  assertInboxV2RuntimeSchemaEpochDeclaration,
  closeHuleeDatabase,
  createHuleeDatabase,
  createSqlDeploymentEgressStatusRepository
} from "@hulee/db";

import {
  createSecurityDenialRetentionBackgroundRunner,
  createSecurityDenialRetentionDatabaseConfig,
  createWorkerEgressMonitor,
  createWorkerRuntime,
  createWorkerSecurityDenialRetentionSweeper
} from "./index";

const runtime = createWorkerRuntime();
assertInboxV2RuntimeSchemaEpochDeclaration({
  runtimeEnvironment: process.env.NODE_ENV,
  declaredEpoch: process.env.HULEE_SCHEMA_EPOCH
});
const database = createHuleeDatabase({
  connectionString: runtime.config.databaseUrl
});
try {
  const schemaEvidence = await assertInboxV2RuntimeSchemaEpoch(database);
  runtime.logger.info("worker.schema_epoch_verified", schemaEvidence);
} catch (error) {
  runtime.logger.error("worker.schema_epoch_rejected", undefined, error);
  await closeHuleeDatabase(database);
  throw error;
}
const coreWorkerEnabled = runtime.config.workerFeatures.includes("core");
const securityDenialRetentionDatabase = coreWorkerEnabled
  ? createHuleeDatabase(
      createSecurityDenialRetentionDatabaseConfig(runtime.config.databaseUrl)
    )
  : undefined;
const egressMonitor = createWorkerEgressMonitor({
  config: runtime.config,
  repository: createSqlDeploymentEgressStatusRepository(database),
  logger: runtime.logger
});
const securityDenialRetentionSweeper = securityDenialRetentionDatabase
  ? createWorkerSecurityDenialRetentionSweeper({
      database: securityDenialRetentionDatabase,
      logger: runtime.logger
    })
  : undefined;
const securityDenialRetentionRunner = securityDenialRetentionSweeper
  ? createSecurityDenialRetentionBackgroundRunner({
      sweeper: securityDenialRetentionSweeper,
      onResult(result) {
        if (
          result.throttled ||
          (result.failedTenants === 0 && result.deletedWindowCount === "0")
        ) {
          return;
        }
        runtime.logger.info("worker.security_denial_retention_processed", {
          scannedTenants: result.scannedTenants,
          prunedTenants: result.prunedTenants,
          failedTenants: result.failedTenants,
          saturatedPruneTenants: result.saturatedPruneTenants,
          deletedWindowCount: result.deletedWindowCount,
          checkpointTenantId: result.checkpointTenantId,
          cycleCompleted: result.cycleCompleted
        });
      },
      onFailure(error) {
        runtime.logger.error(
          "worker.security_denial_retention_failed",
          undefined,
          error
        );
      }
    })
  : undefined;

runtime.logger.info("worker.started", {
  workerFeatures: runtime.config.workerFeatures,
  egressProfileKind: runtime.config.egressProfile.profileKind,
  egressProfileStatus: runtime.config.egressProfile.status,
  egressProbesEnabled: runtime.config.egressProbesEnabled,
  egressProbeIntervalMs: runtime.config.egressProbeIntervalMs
});

egressMonitor.start();
securityDenialRetentionRunner?.schedule();

let stopping = false;

async function shutdown(): Promise<void> {
  if (stopping) {
    return;
  }
  stopping = true;
  egressMonitor.stop();
  await securityDenialRetentionRunner?.stop();
  if (securityDenialRetentionDatabase !== undefined) {
    await closeHuleeDatabase(securityDenialRetentionDatabase);
  }
  await closeHuleeDatabase(database);
}

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});
process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});
