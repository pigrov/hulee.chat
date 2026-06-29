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
import type { EgressRuntime } from "@hulee/modules";
import {
  createAesGcmTenantSecretCipher,
  createSqlChannelConnectorRepository,
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlOutboundDispatchRepository,
  createSqlTenantSecretRepository,
  type HuleeDatabase
} from "@hulee/db";
import { createExternalChannelCommandService } from "@hulee/core";

import type { OutboxHandler } from "./outbox-processor";
import {
  createTenantSecretResolver,
  createTelegramOutboundDispatcher,
  type SecretResolver,
  type TelegramBotApiClientFactory
} from "./telegram-outbound-dispatcher";
import {
  runTelegramPollingSweep,
  type TelegramPollingBotApiClientFactory,
  type TelegramPollingSweepOptions,
  type TelegramPollingSweepResult
} from "./telegram-polling-sweeper";

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
  secretEncryptionKey?: string;
  secretResolver?: SecretResolver;
  telegramBotApiClientFactory?: TelegramBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
};

export function createWorkerOutboxHandler(
  options: WorkerOutboxHandlerOptions
): OutboxHandler {
  const tenantSecrets = options.secretEncryptionKey
    ? createSqlTenantSecretRepository(
        options.database,
        createAesGcmTenantSecretCipher({
          key: options.secretEncryptionKey
        })
      )
    : undefined;

  return createTelegramOutboundDispatcher({
    outboundRepository: createSqlOutboundDispatchRepository(options.database),
    connectorRepository: createSqlChannelConnectorRepository(options.database),
    secretResolver:
      options.secretResolver ??
      createTenantSecretResolver({
        tenantSecrets
      }),
    botApiClientFactory: options.telegramBotApiClientFactory,
    egressRuntime: options.egressRuntime,
    telegramApiBaseUrl: options.telegramApiBaseUrl
  });
}

export type WorkerTelegramPollingSweeperOptions = {
  database: HuleeDatabase;
  secretEncryptionKey?: string;
  secretResolver?: SecretResolver;
  telegramBotApiClientFactory?: TelegramPollingBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
};

export type WorkerTelegramPollingSweeper = {
  sweep(): Promise<TelegramPollingSweepResult>;
};

export function createWorkerTelegramPollingSweeper(
  options: WorkerTelegramPollingSweeperOptions
): WorkerTelegramPollingSweeper {
  const tenantSecrets = options.secretEncryptionKey
    ? createSqlTenantSecretRepository(
        options.database,
        createAesGcmTenantSecretCipher({
          key: options.secretEncryptionKey
        })
      )
    : undefined;
  const externalMessageRepository = createExternalMessageRepository({
    rawExecutor: options.database,
    persistenceExecutor: createDrizzlePersistenceExecutor(options.database)
  });
  const sweepOptions: TelegramPollingSweepOptions = {
    connectorRepository: createSqlChannelConnectorRepository(options.database),
    secretResolver:
      options.secretResolver ??
      createTenantSecretResolver({
        tenantSecrets
      }),
    commands: createExternalChannelCommandService({
      repository: externalMessageRepository
    }),
    botApiClientFactory: options.telegramBotApiClientFactory,
    egressRuntime: options.egressRuntime,
    telegramApiBaseUrl: options.telegramApiBaseUrl
  };

  return {
    async sweep() {
      return runTelegramPollingSweep(sweepOptions);
    }
  };
}

export { processOutboxBatch } from "./outbox-processor";
export {
  createEnvSecretResolver,
  createTenantSecretResolver,
  createTelegramOutboundDispatcher
} from "./telegram-outbound-dispatcher";
export { runTelegramPollingSweep } from "./telegram-polling-sweeper";
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
export type {
  TelegramPollingBotApiClientFactory,
  TelegramPollingSweepOptions,
  TelegramPollingSweepResult
} from "./telegram-polling-sweeper";
