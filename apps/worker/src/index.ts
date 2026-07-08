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
  createSqlChannelAuthChallengeRepository,
  createSqlAttachmentTransferRepository,
  createSqlChannelConnectorRepository,
  createSqlChannelSessionRepository,
  createSqlChannelProviderValidationJobRepository,
  createSqlDeploymentEgressProviderPolicyRepository,
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlOutboundDispatchRepository,
  createSqlTenantSecretRepository,
  type HuleeDatabase
} from "@hulee/db";
import { createExternalChannelCommandService } from "@hulee/core";
import { createS3ObjectStorage, type ObjectStorage } from "@hulee/storage";

import type { OutboxHandler } from "./outbox-processor";
import {
  createTelegramAttachmentTransferSweeper,
  type TelegramAttachmentTransferBotApiClientFactory,
  type TelegramAttachmentTransferSweepResult,
  type TelegramAttachmentTransferSweeper
} from "./telegram-attachment-transfer";
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
  createTelegramProviderValidationDispatcher,
  type TelegramProviderValidationBotApiClientFactory
} from "./telegram-provider-validation-dispatcher";
import {
  runTelegramPollingSweep,
  type TelegramPollingBotApiClientFactory,
  type TelegramPollingSweepOptions,
  type TelegramPollingSweepResult
} from "./telegram-polling-sweeper";
import { createPolicyAwareDeploymentEgressRuntime } from "./policy-egress-runtime";
import {
  createDirectAccountAuthSweeper,
  type DirectAccountAuthHandler,
  type DirectAccountAuthSweeper,
  type DirectAccountAuthSweepResult
} from "./direct-account-auth-sweeper";
import {
  createDirectAccountSessionMonitor,
  type DirectAccountSessionMonitor,
  type DirectAccountSessionMonitorResult,
  type DirectAccountSessionProbeHandler
} from "./direct-account-session-monitor";
import { createTelegramDirectAuthHandler } from "./telegram-direct-auth-handler";
import { createTelegramDirectSessionProbeHandler } from "./telegram-direct-session-probe";
import { createWhatsAppDirectAuthHandler } from "./whatsapp-direct-auth-handler";
import { createWhatsAppDirectSessionProbeHandler } from "./whatsapp-direct-session-probe";
import { createMaxDirectAuthHandler } from "./max-direct-auth-handler";
import { createMaxDirectSessionProbeHandler } from "./max-direct-session-probe";

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
  telegramProviderValidationBotApiClientFactory?: TelegramProviderValidationBotApiClientFactory;
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
    createWorkerDeploymentEgressRuntime({
      database: options.database,
      egressProfile: options.egressProfile
    });
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
  const providerValidationDispatcher =
    createTelegramProviderValidationDispatcher({
      validationJobRepository: createSqlChannelProviderValidationJobRepository(
        options.database
      ),
      secretResolver,
      botApiClientFactory:
        options.telegramProviderValidationBotApiClientFactory,
      egressRuntime,
      telegramApiBaseUrl: options.telegramApiBaseUrl
    });
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
      await providerValidationDispatcher.handle(record);
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

export type WorkerTelegramAttachmentTransferSweeperOptions = {
  database: HuleeDatabase;
  objectStorageConfig: NonNullable<WorkerConfig["objectStorage"]>;
  secretEncryptionKey?: string;
  secretResolver?: SecretResolver;
  objectStorage?: ObjectStorage;
  telegramBotApiClientFactory?: TelegramAttachmentTransferBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  egressProfile?: WorkerConfig["egressProfile"];
  telegramApiBaseUrl?: string;
};

export type WorkerTelegramAttachmentTransferSweeper = {
  sweep(): Promise<TelegramAttachmentTransferSweepResult>;
};

export type WorkerDirectAccountAuthSweeperOptions = {
  database: HuleeDatabase;
  secretEncryptionKey?: string;
  handlers?: readonly DirectAccountAuthHandler[];
  telegramUserAuthEnabled?: boolean;
  telegramUserApiId?: number;
  telegramUserApiHash?: string;
  whatsappUserAuthEnabled?: boolean;
  maxUserAuthEnabled?: boolean;
  logger?: Pick<Logger, "warn">;
  workerId?: string;
  limit?: number;
  leaseMs?: number;
};

export type WorkerDirectAccountAuthSweeper = {
  sweep(): Promise<DirectAccountAuthSweepResult>;
};

export type WorkerDirectAccountSessionMonitorOptions = {
  database: HuleeDatabase;
  secretEncryptionKey?: string;
  handlers?: readonly DirectAccountSessionProbeHandler[];
  telegramUserMonitoringEnabled?: boolean;
  telegramUserApiId?: number;
  telegramUserApiHash?: string;
  whatsappUserMonitoringEnabled?: boolean;
  maxUserMonitoringEnabled?: boolean;
  logger?: Pick<Logger, "warn">;
  workerId?: string;
  limit?: number;
  leaseMs?: number;
  monitorIntervalMs?: number;
};

export type WorkerDirectAccountSessionMonitor = {
  sweep(): Promise<DirectAccountSessionMonitorResult>;
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
      createWorkerDeploymentEgressRuntime({
        database: options.database,
        egressProfile: options.egressProfile
      }),
    telegramApiBaseUrl: options.telegramApiBaseUrl
  };

  return {
    async sweep() {
      return runTelegramPollingSweep(sweepOptions);
    }
  };
}

export function createWorkerTelegramAttachmentTransferSweeper(
  options: WorkerTelegramAttachmentTransferSweeperOptions
): TelegramAttachmentTransferSweeper {
  const tenantSecrets = options.secretEncryptionKey
    ? createSqlTenantSecretRepository(
        options.database,
        createAesGcmTenantSecretCipher({
          key: options.secretEncryptionKey
        })
      )
    : undefined;
  const egressRuntime =
    options.egressRuntime ??
    createWorkerDeploymentEgressRuntime({
      database: options.database,
      egressProfile: options.egressProfile
    });

  return createTelegramAttachmentTransferSweeper({
    repository: createSqlAttachmentTransferRepository(options.database),
    connectorRepository: createSqlChannelConnectorRepository(options.database),
    secretResolver:
      options.secretResolver ??
      createTenantSecretResolver({
        tenantSecrets
      }),
    objectStorage:
      options.objectStorage ??
      createS3ObjectStorage(options.objectStorageConfig),
    botApiClientFactory: options.telegramBotApiClientFactory,
    egressRuntime,
    telegramApiBaseUrl: options.telegramApiBaseUrl
  });
}

export function createWorkerDirectAccountAuthSweeper(
  options: WorkerDirectAccountAuthSweeperOptions
): DirectAccountAuthSweeper {
  const authChallengeCipher = options.secretEncryptionKey
    ? createAesGcmTenantSecretCipher({
        key: options.secretEncryptionKey
      })
    : undefined;
  const handlers = options.handlers ?? [
    ...(options.telegramUserAuthEnabled
      ? [
          createTelegramDirectAuthHandler({
            apiId: options.telegramUserApiId,
            apiHash: options.telegramUserApiHash,
            sessionCipher: authChallengeCipher,
            logger: options.logger
          })
        ]
      : []),
    ...(options.whatsappUserAuthEnabled
      ? [
          createWhatsAppDirectAuthHandler({
            sessionCipher: authChallengeCipher,
            logger: options.logger
          })
        ]
      : []),
    ...(options.maxUserAuthEnabled
      ? [
          createMaxDirectAuthHandler({
            sessionCipher: authChallengeCipher,
            logger: options.logger
          })
        ]
      : [])
  ];

  return createDirectAccountAuthSweeper({
    authChallengeRepository: createSqlChannelAuthChallengeRepository(
      options.database
    ),
    sessionRepository: createSqlChannelSessionRepository(options.database),
    connectorRepository: createSqlChannelConnectorRepository(options.database),
    authChallengeCipher,
    handlers,
    workerId: options.workerId,
    limit: options.limit,
    leaseMs: options.leaseMs
  });
}

export function createWorkerDirectAccountSessionMonitor(
  options: WorkerDirectAccountSessionMonitorOptions
): DirectAccountSessionMonitor {
  const sessionCipher = options.secretEncryptionKey
    ? createAesGcmTenantSecretCipher({
        key: options.secretEncryptionKey
      })
    : undefined;
  const handlers = options.handlers ?? [
    ...(options.telegramUserMonitoringEnabled
      ? [
          createTelegramDirectSessionProbeHandler({
            apiId: options.telegramUserApiId,
            apiHash: options.telegramUserApiHash,
            sessionCipher,
            logger: options.logger
          })
        ]
      : []),
    ...(options.whatsappUserMonitoringEnabled
      ? [
          createWhatsAppDirectSessionProbeHandler({
            sessionCipher,
            logger: options.logger
          })
        ]
      : []),
    ...(options.maxUserMonitoringEnabled
      ? [
          createMaxDirectSessionProbeHandler({
            sessionCipher,
            logger: options.logger
          })
        ]
      : [])
  ];

  return createDirectAccountSessionMonitor({
    sessionRepository: createSqlChannelSessionRepository(options.database),
    connectorRepository: createSqlChannelConnectorRepository(options.database),
    handlers,
    workerId: options.workerId,
    limit: options.limit,
    leaseMs: options.leaseMs,
    monitorIntervalMs: options.monitorIntervalMs
  });
}

function createWorkerDeploymentEgressRuntime(input: {
  database: HuleeDatabase;
  egressProfile?: WorkerConfig["egressProfile"];
}): EgressRuntime | undefined {
  if (!input.egressProfile) {
    return undefined;
  }

  return createPolicyAwareDeploymentEgressRuntime({
    deploymentProfile: input.egressProfile,
    policyRepository: createSqlDeploymentEgressProviderPolicyRepository(
      input.database
    )
  });
}

export { processOutboxBatch } from "./outbox-processor";
export { createPolicyAwareDeploymentEgressRuntime } from "./policy-egress-runtime";
export {
  createEnvSecretResolver,
  createTenantSecretResolver,
  createTelegramOutboundDispatcher
} from "./telegram-outbound-dispatcher";
export { runTelegramPollingSweep } from "./telegram-polling-sweeper";
export { createTelegramAttachmentTransferSweeper } from "./telegram-attachment-transfer";
export { createTelegramProviderOperationDispatcher } from "./telegram-provider-operation-dispatcher";
export { createTelegramProviderValidationDispatcher } from "./telegram-provider-validation-dispatcher";
export {
  createDirectAccountAuthSweeper,
  runDirectAccountAuthSweep
} from "./direct-account-auth-sweeper";
export {
  createDirectAccountSessionMonitor,
  runDirectAccountSessionMonitor
} from "./direct-account-session-monitor";
export { createTelegramDirectAuthHandler } from "./telegram-direct-auth-handler";
export { createWhatsAppDirectAuthHandler } from "./whatsapp-direct-auth-handler";
export { createMaxDirectAuthHandler } from "./max-direct-auth-handler";
export { createMaxDirectSessionProbeHandler } from "./max-direct-session-probe";
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
  TelegramAttachmentTransferBotApiClient,
  TelegramAttachmentTransferBotApiClientFactory,
  TelegramAttachmentTransferObjectStorage,
  TelegramAttachmentTransferSweepResult,
  TelegramAttachmentTransferSweeper,
  TelegramAttachmentTransferSweeperOptions
} from "./telegram-attachment-transfer";
export type {
  TelegramProviderOperationBotApiClient,
  TelegramProviderOperationBotApiClientFactory,
  TelegramProviderOperationDispatcherOptions
} from "./telegram-provider-operation-dispatcher";
export type {
  TelegramProviderValidationBotApiClient,
  TelegramProviderValidationBotApiClientFactory,
  TelegramProviderValidationDispatcherOptions
} from "./telegram-provider-validation-dispatcher";
export type {
  DirectAccountAuthChallengePatch,
  DirectAccountAuthHandler,
  DirectAccountAuthHandlerInput,
  DirectAccountAuthHandlerResult,
  DirectAccountAuthPublicPayload,
  DirectAccountAuthSweeper,
  DirectAccountAuthSweepOptions,
  DirectAccountAuthSweepResult
} from "./direct-account-auth-sweeper";
export type {
  CreateTelegramAuthClientInput,
  TelegramAuthClient,
  TelegramDirectAuthHandlerOptions,
  TelegramDirectSessionPayload,
  TelegramSelfUser
} from "./telegram-direct-auth-handler";
export type {
  ConnectWhatsAppSocketLoopInput,
  WhatsAppDirectAuthHandlerOptions,
  WhatsAppDirectSessionPayload,
  WhatsAppDirectSessionState,
  WhatsAppSelfUser,
  WhatsAppSocketHandle
} from "./whatsapp-direct-auth-handler";
export type { MaxDirectAuthHandlerOptions } from "./max-direct-auth-handler";
export type { MaxDirectSessionProbeHandlerOptions } from "./max-direct-session-probe";
export type {
  EgressMonitorOptions,
  EgressProbeDefinition,
  EgressProbeKind,
  WorkerEgressMonitor
} from "./egress-monitor";
