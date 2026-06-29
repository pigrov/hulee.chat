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
  createDeploymentEgressRuntime,
  type EgressRuntime
} from "@hulee/modules";
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
  createTelegramProviderOperationDispatcher,
  type TelegramProviderOperationBotApiClientFactory
} from "./telegram-provider-operation-dispatcher";
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
  telegramProviderBotApiClientFactory?: TelegramProviderOperationBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  egressProfile?: WorkerConfig["egressProfile"];
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
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

  const connectorRepository = createSqlChannelConnectorRepository(
    options.database
  );
  const secretResolver =
    options.secretResolver ??
    createTenantSecretResolver({
      tenantSecrets
    });
  const egressRuntime =
    options.egressRuntime ??
    (options.egressProfile
      ? createDeploymentEgressRuntime({
          profiles: [options.egressProfile]
        })
      : undefined);
  const providerOperationDispatcher = createTelegramProviderOperationDispatcher(
    {
      connectorRepository,
      secretResolver,
      botApiClientFactory: options.telegramProviderBotApiClientFactory,
      egressRuntime,
      telegramApiBaseUrl: options.telegramApiBaseUrl,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl
    }
  );
  const outboundDispatcher = createTelegramOutboundDispatcher({
    outboundRepository: createSqlOutboundDispatchRepository(options.database),
    connectorRepository,
    secretResolver,
    botApiClientFactory: options.telegramBotApiClientFactory,
    egressRuntime,
    telegramApiBaseUrl: options.telegramApiBaseUrl
  });

  return {
    async handle(record) {
      await providerOperationDispatcher.handle(record);
      await outboundDispatcher.handle(record);
    }
  };
}

export type WorkerTelegramPollingSweeperOptions = {
  database: HuleeDatabase;
  secretEncryptionKey?: string;
  secretResolver?: SecretResolver;
  telegramBotApiClientFactory?: TelegramPollingBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  egressProfile?: WorkerConfig["egressProfile"];
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
    egressRuntime:
      options.egressRuntime ??
      (options.egressProfile
        ? createDeploymentEgressRuntime({
            profiles: [options.egressProfile]
          })
        : undefined),
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
export { createTelegramProviderOperationDispatcher } from "./telegram-provider-operation-dispatcher";
export {
  createWorkerEgressMonitor,
  defaultEgressProbes,
  shouldRunEgressMonitor
} from "./egress-monitor";
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
export type {
  TelegramProviderOperationBotApiClient,
  TelegramProviderOperationBotApiClientFactory,
  TelegramProviderOperationDispatcherOptions
} from "./telegram-provider-operation-dispatcher";
export type {
  EgressMonitorOptions,
  EgressProbeDefinition,
  EgressProbeKind,
  WorkerEgressMonitor
} from "./egress-monitor";
