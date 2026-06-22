import {
  loadWorkerConfig,
  type EnvSource,
  type WorkerConfig
} from "@hulee/config";
import {
  createLevelFilteredLogger,
  createJsonLogger,
  type Logger
} from "@hulee/observability";
import {
  createSqlOutboundDispatchRepository,
  createSqlTenantModuleConfigRepository,
  type HuleeDatabase
} from "@hulee/db";

import type { OutboxHandler } from "./outbox-processor";
import {
  createEnvSecretResolver,
  createTelegramOutboundDispatcher,
  type SecretResolver,
  type TelegramBotApiClientFactory
} from "./telegram-outbound-dispatcher";

export type WorkerBoundary = {
  processesOutbox: true;
  requiresTenantContext: true;
};

export type WorkerRuntime = {
  config: WorkerConfig;
  logger: Logger;
};

export const workerBoundary: WorkerBoundary = {
  processesOutbox: true,
  requiresTenantContext: true
};

export function createWorkerRuntime(
  env: EnvSource = process.env
): WorkerRuntime {
  const config = loadWorkerConfig(env);
  const baseLogger = createJsonLogger({
    service: "worker",
    defaultContext: {
      appName: config.appName,
      deploymentType: config.deploymentType
    }
  });

  return {
    config,
    logger: createLevelFilteredLogger(baseLogger, config.logLevel)
  };
}

export type WorkerOutboxHandlerOptions = {
  database: HuleeDatabase;
  secretResolver?: SecretResolver;
  telegramBotApiClientFactory?: TelegramBotApiClientFactory;
  telegramApiBaseUrl?: string;
};

export function createWorkerOutboxHandler(
  options: WorkerOutboxHandlerOptions
): OutboxHandler {
  return createTelegramOutboundDispatcher({
    outboundRepository: createSqlOutboundDispatchRepository(options.database),
    moduleConfigRepository: createSqlTenantModuleConfigRepository(
      options.database
    ),
    secretResolver: options.secretResolver ?? createEnvSecretResolver(),
    botApiClientFactory: options.telegramBotApiClientFactory,
    telegramApiBaseUrl: options.telegramApiBaseUrl
  });
}

export { processOutboxBatch } from "./outbox-processor";
export {
  createEnvSecretResolver,
  createTelegramOutboundDispatcher
} from "./telegram-outbound-dispatcher";
export type {
  ClaimPendingOutboxInput,
  MarkOutboxFailedInput,
  MarkOutboxProcessedInput,
  OutboxHandler,
  OutboxRecord,
  OutboxRepository,
  ProcessOutboxBatchInput,
  ProcessOutboxBatchResult
} from "./outbox-processor";
export type {
  SecretResolver,
  TelegramBotApiClientFactory,
  TelegramOutboundDispatcherOptions
} from "./telegram-outbound-dispatcher";
