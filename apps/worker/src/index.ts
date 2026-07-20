import {
  loadWorkerConfig,
  type EnvSource,
  type WorkerConfig
} from "@hulee/config";
import {
  inboxV2TimestampSchema,
  type InboxV2RawAdmissionPreflightPort,
  type InboxV2RawAdmissionTerminalOutcomeSealingPort,
  type InboxV2SourceProcessingCryptographicAuthorityPort,
  type InboxV2SourceTerminalDedupeLifecycleResolverPort,
  type InboxV2SourceReplayAuthorizationPort
} from "@hulee/contracts";
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
  createSqlInboxV2FencedOutboundTransportRuntimeRepository,
  createSqlInboxV2RepositoryOutbox,
  createSqlInboxV2SecurityDenialRetentionRepository,
  createSqlInboxV2SourceProcessingRuntimeRepository,
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlSourceIntegrationRepository,
  createSqlTenantSecretRepository,
  type InboxV2SourceDeadLetterLifecycleResolver as SqlInboxV2SourceDeadLetterLifecycleResolver,
  type InboxV2SourceProcessingAttemptIdSource,
  type InboxV2SourceProcessingLeaseTokenSource,
  type InboxV2SourceProcessingRetentionPolicy,
  type InboxV2SourceReplayEpisodeIdSource,
  type HuleeDatabase
} from "@hulee/db";
import { CoreError, createExternalChannelCommandService } from "@hulee/core";
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
  type SecretResolver
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
import {
  createSecurityDenialRetentionSweeper,
  type SecurityDenialRetentionSweepResult,
  type SecurityDenialRetentionSweeper
} from "./security-denial-retention-sweeper";
import {
  createInboxV2ProviderDispatchCoordinator,
  type InboxV2ProviderDispatchCoordinator,
  type InboxV2ProviderDispatchCoordinatorOptions
} from "./inbox-v2-provider-dispatch-coordinator";
import {
  createInboxV2SourceProcessingRuntimeCoordinator,
  type InboxV2SourceProcessingRuntimeClock,
  type InboxV2SourceProcessingRuntimeCoordinator,
  type InboxV2SourceProcessingRuntimeCoordinatorOptions
} from "./source-processing-runtime-coordinator";
import {
  resolveInboxV2SourceProcessingProductionHandlers,
  type InboxV2SourceProcessingProductionActivation
} from "./source-processing-production-activation";

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
  assertCleanSlateWorkerFeatures(config.workerFeatures);
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

export function assertCleanSlateWorkerFeatures(
  features: WorkerConfig["workerFeatures"]
): void {
  if (features.some((feature) => feature !== "core")) {
    throw new CoreError(
      "module.disabled",
      "Provider worker features are disabled during the Inbox V2 clean-slate epoch."
    );
  }
}

export type WorkerInboxV2ProviderDispatchCoordinatorOptions<
  TRequest = unknown
> = Omit<
  InboxV2ProviderDispatchCoordinatorOptions<TRequest>,
  "outbox" | "transport"
> &
  Readonly<{ database: HuleeDatabase }>;

/**
 * Production composition point for the fenced SRC-009 state machine. Tenant
 * scheduling remains outside this factory until the Inbox V2 runner owns an
 * explicit tenant work source.
 */
export function createWorkerInboxV2ProviderDispatchCoordinator<
  TRequest = unknown
>(
  options: WorkerInboxV2ProviderDispatchCoordinatorOptions<TRequest>
): InboxV2ProviderDispatchCoordinator {
  const { database, ...coordinatorOptions } = options;
  return createInboxV2ProviderDispatchCoordinator({
    ...coordinatorOptions,
    outbox: createSqlInboxV2RepositoryOutbox(database),
    transport:
      createSqlInboxV2FencedOutboundTransportRuntimeRepository(database)
  });
}

export type WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions = Omit<
  InboxV2SourceProcessingRuntimeCoordinatorOptions,
  "repository" | "deadLetterLifecycleResolver" | "clock" | "handlers"
> &
  Readonly<{
    database: HuleeDatabase;
    activation: InboxV2SourceProcessingProductionActivation;
    replayAuthorization: InboxV2SourceReplayAuthorizationPort;
    cryptographicAuthority: InboxV2SourceProcessingCryptographicAuthorityPort;
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
    deadLetterLifecycleResolver: SqlInboxV2SourceDeadLetterLifecycleResolver;
    rawAdmissionPreflight: InboxV2RawAdmissionPreflightPort;
    terminalOutcomeSealer: InboxV2RawAdmissionTerminalOutcomeSealingPort;
    terminalLifecycleResolver: InboxV2SourceTerminalDedupeLifecycleResolverPort;
    leaseTokenSource: InboxV2SourceProcessingLeaseTokenSource;
    attemptIdSource: InboxV2SourceProcessingAttemptIdSource;
    replayEpisodeIdSource: InboxV2SourceReplayEpisodeIdSource;
  }>;

/**
 * Capability-complete production composition point for the SRC-008 inbound
 * lifecycle. No compatibility repository or implicit identity source is used
 * when a production capability is absent.
 */
export function createWorkerInboxV2SourceProcessingRuntimeCoordinator(
  options: WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
): InboxV2SourceProcessingRuntimeCoordinator {
  assertWorkerInboxV2SourceProcessingRuntimeCapabilities(options);
  const {
    database,
    replayAuthorization,
    cryptographicAuthority,
    retentionPolicy,
    deadLetterLifecycleResolver,
    rawAdmissionPreflight,
    terminalOutcomeSealer,
    terminalLifecycleResolver,
    leaseTokenSource,
    attemptIdSource,
    replayEpisodeIdSource,
    activation,
    ...coordinatorOptions
  } = options;
  const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
    database,
    {
      replayAuthorization,
      cryptographicAuthority,
      retentionPolicy,
      deadLetterLifecycleResolver,
      terminalDedupe: {
        mode: "required",
        rawAdmissionPreflight,
        terminalOutcomeSealer,
        terminalLifecycleResolver
      },
      leaseTokenSource,
      attemptIdSource,
      replayEpisodeIdSource
    }
  );

  return createInboxV2SourceProcessingRuntimeCoordinator({
    ...coordinatorOptions,
    handlers: resolveInboxV2SourceProcessingProductionHandlers(activation),
    repository,
    deadLetterLifecycleResolver: Object.freeze({
      resolve: ({ outcome }) =>
        deadLetterLifecycleResolver({
          scope: outcome.attempt.scope,
          deadLetterId: outcome.deadLetter.id,
          deadLetteredAt: outcome.deadLetter.deadLetteredAt,
          diagnostic: outcome.diagnostic
        })
    }),
    clock: createWorkerInboxV2SourceProcessingDatabaseClock(database)
  });
}

/**
 * Production source-processing decisions use PostgreSQL time so lease fences
 * cannot drift with the worker host clock.
 */
export function createWorkerInboxV2SourceProcessingDatabaseClock(
  database: HuleeDatabase
): InboxV2SourceProcessingRuntimeClock {
  return Object.freeze({
    async now() {
      const result = await database.$client.query<{
        db_now: Date | string | null;
      }>("select clock_timestamp() as db_now");
      const rawTimestamp = result.rows[0]?.db_now;
      const epochMilliseconds =
        rawTimestamp instanceof Date
          ? rawTimestamp.getTime()
          : typeof rawTimestamp === "string"
            ? Date.parse(rawTimestamp)
            : Number.NaN;
      if (!Number.isFinite(epochMilliseconds)) {
        throw new TypeError(
          "PostgreSQL source-processing clock returned an invalid timestamp."
        );
      }
      return inboxV2TimestampSchema.parse(
        new Date(epochMilliseconds).toISOString()
      );
    }
  });
}

function assertWorkerInboxV2SourceProcessingRuntimeCapabilities(
  options: WorkerInboxV2SourceProcessingRuntimeCoordinatorOptions
): void {
  if (typeof options?.diagnosticClassifier?.classify !== "function") {
    throw new TypeError(
      "Source-processing production runtime requires key-safe diagnostics capability."
    );
  }
  const database = options?.database as
    | Readonly<{
        execute?: unknown;
        transaction?: unknown;
        $client?: Readonly<{ query?: unknown }>;
      }>
    | undefined;
  if (
    typeof database?.execute !== "function" ||
    typeof database.transaction !== "function" ||
    typeof database.$client?.query !== "function" ||
    typeof options.replayAuthorization?.authorizeReplay !== "function" ||
    typeof options.cryptographicAuthority?.protectCursor !== "function" ||
    typeof options.cryptographicAuthority?.resolveCursor !== "function" ||
    typeof options.cryptographicAuthority?.verifyDedupeSkeleton !==
      "function" ||
    typeof options.cryptographicAuthority?.deriveDedupeIdentityCandidates !==
      "function" ||
    typeof options.deadLetterLifecycleResolver !== "function" ||
    typeof options.rawAdmissionPreflight?.loadPendingDedupeAdmission !==
      "function" ||
    typeof options.terminalOutcomeSealer?.sealTerminalDedupeOutcome !==
      "function" ||
    typeof options.terminalLifecycleResolver?.resolveTerminalDedupeLifecycle !==
      "function" ||
    typeof options.leaseTokenSource !== "function" ||
    typeof options.attemptIdSource !== "function" ||
    typeof options.replayEpisodeIdSource !== "function"
  ) {
    throw new TypeError(
      "Source-processing production runtime requires database, replay authorization, cryptographic, terminal dedupe, DLQ and lease identity capabilities."
    );
  }
}

export type WorkerOutboxHandlerOptions = {
  database: HuleeDatabase;
  secretEncryptionKey?: string;
  secretResolver?: SecretResolver;
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
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      allowWebhookSet: false
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
  return {
    async handle(record) {
      await providerValidationDispatcher.handle(record);
      await providerOperationDispatcher.handle(record);
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

export type WorkerSecurityDenialRetentionSweeperOptions = {
  database: HuleeDatabase;
  logger?: Pick<Logger, "warn">;
};

export type WorkerSecurityDenialRetentionSweeper = {
  sweep(): Promise<SecurityDenialRetentionSweepResult>;
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
    sourceRepository: createSqlSourceIntegrationRepository(options.database),
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
    sourceRepository: createSqlSourceIntegrationRepository(options.database),
    handlers,
    workerId: options.workerId,
    limit: options.limit,
    leaseMs: options.leaseMs,
    monitorIntervalMs: options.monitorIntervalMs
  });
}

export function createWorkerSecurityDenialRetentionSweeper(
  options: WorkerSecurityDenialRetentionSweeperOptions
): SecurityDenialRetentionSweeper {
  return createSecurityDenialRetentionSweeper({
    repository: createSqlInboxV2SecurityDenialRetentionRepository(
      options.database
    ),
    onTenantFailure: ({ tenantId, error }) => {
      options.logger?.warn(
        "worker.security_denial_retention_tenant_failed",
        { tenantId },
        error
      );
    }
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
export {
  createSecurityDenialRetentionBackgroundRunner,
  createSecurityDenialRetentionSweeper
} from "./security-denial-retention-sweeper";
export { createInboxV2SourceNormalizationProcessor } from "./source-normalization-processor";
export { createInboxV2ProviderDispatchCoordinator } from "./inbox-v2-provider-dispatch-coordinator";
export { createWorkerInboxV2AttachmentMaterializationSweeper } from "./inbox-v2-attachment-materialization-sweeper";
export {
  createInboxV2SourceIdentityResolutionProcessor,
  createInboxV2TrustedSourceIdentityMaterializer,
  InboxV2SourceIdentityResolutionProcessorError
} from "./source-identity-resolution-processor";
export {
  buildInboxV2SourceConversationMaterializationAuthorizationPreimage,
  createInboxV2TrustedSourceConversationResolutionMaterializer,
  deriveInboxV2SourceConversationMaterializationAuthorizationDigest,
  InboxV2SourceConversationResolutionMaterializerError,
  isInboxV2TrustedSourceConversationResolutionMaterializer
} from "./source-conversation-resolution-materializer";
export {
  createInboxV2SourceConversationMaterializationPlanVerifier,
  isInboxV2TrustedSourceConversationMaterializationPlanVerifier
} from "./source-conversation-resolution-plan-verifier";
export {
  buildInboxV2SourceMessageReconciliationAuthorizationPreimage,
  createInboxV2TrustedSourceMessageReconciliationMaterializer,
  deriveInboxV2SourceMessageReconciliationAuthorizationDigest,
  InboxV2SourceMessageReconciliationMaterializerError,
  isInboxV2TrustedSourceMessageReconciliationMaterializer
} from "./source-message-reconciliation-materializer";
export {
  createInboxV2SourceMessageReconciliationPlanVerifier,
  isInboxV2TrustedSourceMessageReconciliationPlanVerifier
} from "./source-message-reconciliation-plan-verifier";
export { createInboxV2SourceParticipantMaterializer } from "./source-participant-materialization";
export {
  createSecurityDenialRetentionDatabaseConfig,
  sanitizeSecurityDenialRetentionDatabaseUrl
} from "./security-denial-retention-database-config";
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
export type {
  SecurityDenialRetentionBackgroundRunner,
  SecurityDenialRetentionBackgroundRunnerOptions,
  SecurityDenialRetentionRepository,
  SecurityDenialRetentionSweepResult,
  SecurityDenialRetentionSweeper,
  SecurityDenialRetentionSweeperOptions
} from "./security-denial-retention-sweeper";
export type {
  InboxV2ProviderDispatchAdapterPort,
  InboxV2ProviderDispatchAdapterResult,
  InboxV2ProviderDispatchClock,
  InboxV2ProviderDispatchCoordinator,
  InboxV2ProviderDispatchCoordinatorErrorCode,
  InboxV2ProviderDispatchCoordinatorOptions,
  InboxV2ProviderDispatchFencedMutationResult,
  InboxV2ProviderDispatchLeaseFence,
  InboxV2ProviderDispatchLoadedState,
  InboxV2ProviderDispatchLoadRejected,
  InboxV2ProviderDispatchLoadResult,
  InboxV2ProviderDispatchPlan,
  InboxV2ProviderDispatchPlanner,
  InboxV2ProviderDispatchProcessResult,
  InboxV2ProviderDispatchTimer,
  InboxV2ProviderDispatchTransportPort
} from "./inbox-v2-provider-dispatch-coordinator";
export type {
  InboxV2AttachmentMaterializationProductionServices,
  InboxV2TrustedAttachmentMaterializationProviderSourceLoader,
  InboxV2TrustedAttachmentMaterializationStorageResolver,
  WorkerInboxV2AttachmentMaterializationSweeper,
  WorkerInboxV2AttachmentMaterializationSweeperOptions,
  WorkerInboxV2AttachmentMaterializationSweepResult
} from "./inbox-v2-attachment-materialization-sweeper";
export type {
  InboxV2SourceNormalizationClaim,
  InboxV2SourceNormalizationProcessResult,
  InboxV2SourceNormalizationProcessor,
  InboxV2SourceNormalizationProcessorOptions
} from "./source-normalization-processor";
export { createInboxV2SourceNormalizationRuntimeHandler } from "./source-normalization-runtime-handler";
export { createInboxV2SourceIngressRecordAndAcknowledgeSeam } from "./source-ingress-record-and-acknowledge";
export {
  createInboxV2SourceNormalizationDurabilityCapability,
  createInboxV2SourceProcessingCompositeDurabilityCapabilitySet,
  createInboxV2SourceProcessingProductionActivation,
  createInboxV2TrustedSourceProcessingCompositeTransaction,
  inboxV2SourceProcessingCompositeStages,
  resolveInboxV2SourceProcessingProductionHandlers
} from "./source-processing-production-activation";
export { createInboxV2SourceProcessingRuntimeCoordinator } from "./source-processing-runtime-coordinator";
export type {
  InboxV2SourceIngressCursorRequest,
  InboxV2SourceIngressDurableAdmissionReceipt,
  InboxV2SourceIngressDurableCursorAcknowledgeInput,
  InboxV2SourceIngressDurableCursorAcknowledgerPort,
  InboxV2SourceIngressRecordAndAcknowledgeResult,
  InboxV2SourceIngressRecordAndAcknowledgeSeam
} from "./source-ingress-record-and-acknowledge";
export type {
  InboxV2SourceProcessingCompositeDurableStage,
  InboxV2SourceProcessingCompositeTransactionLocalPort,
  InboxV2SourceProcessingDurableStage,
  InboxV2SourceProcessingProductionActivation,
  InboxV2TrustedSourceProcessingCompositeDurabilityCapabilitySet,
  InboxV2TrustedSourceProcessingCompositeTransaction,
  InboxV2TrustedSourceProcessingStageDurabilityCapability
} from "./source-processing-production-activation";
export type {
  InboxV2SourceProcessingClaimRunResult,
  InboxV2SourceProcessingDiagnosticClassifier,
  InboxV2SourceProcessingHandlerResult,
  InboxV2SourceProcessingRuntimeApplyResult,
  InboxV2SourceProcessingRuntimeClaim,
  InboxV2SourceProcessingRuntimeClaimResult,
  InboxV2SourceProcessingRuntimeClock,
  InboxV2SourceProcessingRuntimeCoordinator,
  InboxV2SourceProcessingRuntimeCoordinatorOptions,
  InboxV2SourceProcessingRuntimeRepositoryPort,
  InboxV2SourceProcessingRuntimeRunResult,
  InboxV2SourceProcessingStageHandler,
  InboxV2SourceDeadLetterLifecycle,
  InboxV2SourceDeadLetterLifecycleResolver
} from "./source-processing-runtime-coordinator";
export type {
  InboxV2SourceIdentityAssessmentPlan,
  InboxV2SourceIdentityAssessmentPlanner,
  InboxV2SourceIdentityResolutionProcessResult,
  InboxV2SourceIdentityResolutionProcessor,
  InboxV2SourceIdentityResolutionProcessorErrorCode,
  InboxV2SourceIdentityResolutionProcessorOptions,
  InboxV2SourceIdentityNamespaceDeriver,
  InboxV2TrustedSourceIdentityMaterializer
} from "./source-identity-resolution-processor";
export type {
  InboxV2SourceConversationMaterializationAuthorizationInput,
  InboxV2SourceConversationMaterializationClock,
  InboxV2SourceConversationNamespaceDeriver,
  InboxV2SourceConversationNamespacePurpose,
  InboxV2SourceConversationResolutionMaterializerErrorCode,
  InboxV2SourceConversationThreadPlan,
  InboxV2SourceConversationThreadPlanResolver,
  InboxV2TrustedSourceConversationResolutionMaterializer
} from "./source-conversation-resolution-materializer";
export type { InboxV2SourceConversationMaterializationPlanVerifier } from "./source-conversation-resolution-plan-verifier";
export type {
  InboxV2SourceMessageNamespaceDeriver,
  InboxV2SourceMessageNamespacePurpose,
  InboxV2SourceMessageReconciliationAuthorizationInput,
  InboxV2SourceMessageReconciliationClock,
  InboxV2SourceMessageReconciliationMaterializerErrorCode,
  InboxV2TrustedSourceMessageReconciliationMaterializer
} from "./source-message-reconciliation-materializer";
export type { InboxV2SourceMessageReconciliationPlanVerifier } from "./source-message-reconciliation-plan-verifier";
export type {
  InboxV2ParticipantIdFactory,
  InboxV2SourceParticipantMaterializer,
  InboxV2SourceParticipantMaterializerOptions,
  MaterializeInboxV2DeferredParticipantInput,
  MaterializeInboxV2DeferredParticipantResult
} from "./source-participant-materialization";
