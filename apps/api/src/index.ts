import { loadApiConfig, type ApiConfig, type EnvSource } from "@hulee/config";
import {
  createAesGcmTenantSecretCipher,
  createSqlDomainEventRepository,
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlFileAccessRepository,
  createSqlPublicApiAuditSink,
  createSqlChannelAuthChallengeRepository,
  createSqlChannelConnectorRepository,
  createSqlChannelProviderValidationJobRepository,
  createSqlChannelSessionRepository,
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlDeploymentEgressStatusRepository,
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
  createSqlSourceIntegrationRepository,
  createSqlTenantSecretRepository,
  createSqlTenantApiKeyRepository,
  createSqlTenantRbacRepository,
  type HuleeDatabase
} from "@hulee/db";
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
  createS3ObjectStorage,
  type ObjectStorage,
  type TenantScopedVersionAwareObjectStorageResolver
} from "@hulee/storage";

import {
  createPublicApiHandler,
  type ApiHttpHandler,
  type PublicApiHandler
} from "./http/public-api-handler";
import {
  createInternalApiHandler,
  createSignedInternalSessionResolver,
  type InternalApiHandler
} from "./http/internal-api-handler";
import {
  createInternalInboxCommandService,
  createSqlInternalInboxAuthorizationService,
  createSqlInternalInboxQueryService
} from "./internal-inbox-service";
import { createInternalAccessDecisionService } from "./internal-access-decision-service";
import { createInternalEgressStatusService } from "./internal-egress-status-service";
import {
  createInternalFileService,
  createInternalInboxV2FileDownloadService
} from "./internal-file-service";
import type { InboxV2FileDownloadTicketService } from "./inbox-v2-file-download-ticket";
import {
  createTenantSecretResolver,
  createInternalIntegrationService
} from "./internal-integrations-service";
import { createInternalOrgStructureService } from "./internal-org-structure-service";
import { createInternalRbacService } from "./internal-rbac-service";
import { createInternalTenantSettingsService } from "./internal-tenant-service";
import { createExternalChannelCommandService } from "./external-channel-command-service";
import { createPublicApiCommandService } from "./public-api-command-service";
import {
  createChannelConnectorTelegramWebhookConnectorResolver,
  createTelegramWebhookHandler,
  type TelegramWebhookHandler
} from "./http/telegram-webhook-handler";

export type ApiAppBoundary = {
  exposesPublicApi: true;
  exposesSseRealtime: true;
  ownsCustomerData: false;
};

export type ApiRuntime = {
  config: ApiConfig;
  logger: Logger;
};

export const apiAppBoundary: ApiAppBoundary = {
  exposesPublicApi: true,
  exposesSseRealtime: true,
  ownsCustomerData: false
};

export function createApiRuntime(env: EnvSource = process.env): ApiRuntime {
  const config = loadApiConfig(env);
  const baseLogger = createJsonLogger({
    service: "api",
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

export type PublicApiDataPlaneHandlerOptions = {
  database: HuleeDatabase;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export function createPublicApiDataPlaneHandler(
  options: PublicApiDataPlaneHandlerOptions
): PublicApiHandler {
  const externalMessageRepository = createExternalMessageRepository({
    rawExecutor: options.database,
    persistenceExecutor: createDrizzlePersistenceExecutor(options.database)
  });

  return createPublicApiHandler({
    authenticator: createSqlTenantApiKeyRepository(options.database),
    auditSink: createSqlPublicApiAuditSink(options.database),
    commands: createPublicApiCommandService({
      repository: externalMessageRepository
    }),
    logger: options.logger,
    requestIdFactory: options.requestIdFactory
  });
}

export type InternalApiDataPlaneHandlerOptions = {
  database: HuleeDatabase;
  env?: EnvSource;
  internalApiSecret?: string;
  secretEncryptionKey?: string;
  egressRuntime?: EgressRuntime;
  egressProfile?: ApiConfig["egressProfile"];
  objectStorageConfig?: ApiConfig["objectStorage"];
  objectStorage?: ObjectStorage;
  inboxV2FileDownloadTicketService?: InboxV2FileDownloadTicketService;
  inboxV2FileDownloadStorageResolver?: TenantScopedVersionAwareObjectStorageResolver;
  inboxV2FileDownloadMaximumBytes?: number;
  publicWebhookBaseUrl?: string;
  telegramApiBaseUrl?: string;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export function createInternalApiDataPlaneHandler(
  options: InternalApiDataPlaneHandlerOptions
): InternalApiHandler {
  const externalMessageRepository = createExternalMessageRepository({
    rawExecutor: options.database,
    persistenceExecutor: createDrizzlePersistenceExecutor(options.database)
  });
  const tenantSecretCipher = options.secretEncryptionKey
    ? createAesGcmTenantSecretCipher({
        key: options.secretEncryptionKey
      })
    : undefined;
  const tenantSecrets = tenantSecretCipher
    ? createSqlTenantSecretRepository(options.database, tenantSecretCipher)
    : undefined;
  const inboxAuthorization = createSqlInternalInboxAuthorizationService({
    database: options.database
  });
  const objectStorage =
    options.objectStorage ??
    (options.objectStorageConfig
      ? createS3ObjectStorage(options.objectStorageConfig)
      : undefined);
  const inboxV2FileDownloads =
    options.inboxV2FileDownloadTicketService === undefined
      ? undefined
      : createInternalInboxV2FileDownloadService({
          tickets: options.inboxV2FileDownloadTicketService,
          objectStorageResolver: requireInboxV2DownloadStorageResolver(
            options.inboxV2FileDownloadStorageResolver
          ),
          maximumDownloadBytes: options.inboxV2FileDownloadMaximumBytes
        });

  return createInternalApiHandler({
    sessionResolver: createSignedInternalSessionResolver({
      secret: options.internalApiSecret
    }),
    inboxQueries: createSqlInternalInboxQueryService({
      database: options.database,
      authorization: inboxAuthorization
    }),
    inboxCommands: createInternalInboxCommandService({
      repository: externalMessageRepository,
      authorization: inboxAuthorization,
      audit: createSqlSecurityAuditRepository(options.database)
    }),
    files: createInternalFileService({
      repository: createSqlFileAccessRepository(options.database),
      authorization: inboxAuthorization,
      objectStorage
    }),
    fileDownloads: inboxV2FileDownloads,
    integrations: createInternalIntegrationService({
      connectorRepository: createSqlChannelConnectorRepository(
        options.database
      ),
      sourceRepository: createSqlSourceIntegrationRepository(options.database),
      channelSessionRepository: createSqlChannelSessionRepository(
        options.database
      ),
      channelCatalogOverrideRepository:
        createSqlDeploymentChannelCatalogOverrideRepository(options.database),
      authChallengeRepository: createSqlChannelAuthChallengeRepository(
        options.database
      ),
      authChallengeCipher: tenantSecretCipher,
      providerValidationJobRepository:
        createSqlChannelProviderValidationJobRepository(options.database),
      providerOperationEvents: createSqlDomainEventRepository(options.database),
      secretResolver: createTenantSecretResolver({
        env: options.env,
        tenantSecrets
      }),
      secretWriter: tenantSecrets,
      egressRuntime:
        options.egressRuntime ??
        (options.egressProfile
          ? createDeploymentEgressRuntime({
              profiles: [options.egressProfile]
            })
          : undefined),
      telegramApiBaseUrl: options.telegramApiBaseUrl,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl
    }),
    tenantSettings: createInternalTenantSettingsService({
      database: options.database
    }),
    orgStructure: createInternalOrgStructureService({
      repository: createSqlOrgStructureRepository(options.database),
      employeeRepository: createSqlEmployeeDirectoryRepository(
        options.database
      ),
      rbacRepository: createSqlTenantRbacRepository(options.database)
    }),
    accessDecisions: createInternalAccessDecisionService({
      employeeRepository: createSqlEmployeeDirectoryRepository(
        options.database
      ),
      rbacRepository: createSqlTenantRbacRepository(options.database)
    }),
    egressStatus: createInternalEgressStatusService({
      profiles: options.egressProfile ? [options.egressProfile] : [],
      snapshotRepository: createSqlDeploymentEgressStatusRepository(
        options.database
      )
    }),
    rbac: createInternalRbacService({
      rbacRepository: createSqlTenantRbacRepository(options.database),
      employeeRepository: createSqlEmployeeDirectoryRepository(
        options.database
      ),
      orgStructureRepository: createSqlOrgStructureRepository(options.database),
      audit: createSqlSecurityAuditRepository(options.database),
      events: createSqlDomainEventRepository(options.database)
    }),
    logger: options.logger,
    requestIdFactory: options.requestIdFactory
  });
}

export type TelegramWebhookDataPlaneHandlerOptions = {
  database: HuleeDatabase;
  env?: EnvSource;
  secretEncryptionKey?: string;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export function createTelegramWebhookDataPlaneHandler(
  options: TelegramWebhookDataPlaneHandlerOptions
): TelegramWebhookHandler {
  const externalMessageRepository = createExternalMessageRepository({
    rawExecutor: options.database,
    persistenceExecutor: createDrizzlePersistenceExecutor(options.database)
  });
  const connectorRepository = createSqlChannelConnectorRepository(
    options.database
  );
  const tenantSecrets = options.secretEncryptionKey
    ? createSqlTenantSecretRepository(
        options.database,
        createAesGcmTenantSecretCipher({
          key: options.secretEncryptionKey
        })
      )
    : undefined;

  return createTelegramWebhookHandler({
    commands: createExternalChannelCommandService({
      repository: externalMessageRepository
    }),
    connectorRepository,
    connectorResolver: createChannelConnectorTelegramWebhookConnectorResolver({
      repository: connectorRepository
    }),
    secretResolver: createTenantSecretResolver({
      env: options.env,
      tenantSecrets
    }),
    logger: options.logger,
    requestIdFactory: options.requestIdFactory
  });
}

export type ApiDataPlaneHandlerOptions = PublicApiDataPlaneHandlerOptions &
  Pick<
    InternalApiDataPlaneHandlerOptions,
    | "env"
    | "internalApiSecret"
    | "secretEncryptionKey"
    | "egressRuntime"
    | "egressProfile"
    | "objectStorageConfig"
    | "objectStorage"
    | "inboxV2FileDownloadTicketService"
    | "inboxV2FileDownloadStorageResolver"
    | "inboxV2FileDownloadMaximumBytes"
    | "publicWebhookBaseUrl"
    | "telegramApiBaseUrl"
  >;

export function createApiDataPlaneHandler(
  options: ApiDataPlaneHandlerOptions
): ApiHttpHandler {
  const publicApiHandler = createPublicApiDataPlaneHandler(options);
  const internalApiHandler = createInternalApiDataPlaneHandler(options);
  const telegramWebhookHandler = createTelegramWebhookDataPlaneHandler(options);

  return {
    async handle(request) {
      const path = request.path.split("?")[0] ?? "/";

      if (path.startsWith("/internal/")) {
        return internalApiHandler.handle(request);
      }

      if (path.startsWith("/webhooks/telegram/")) {
        return telegramWebhookHandler.handle(request);
      }

      return publicApiHandler.handle(request);
    }
  };
}

function requireInboxV2DownloadStorageResolver(
  resolver: TenantScopedVersionAwareObjectStorageResolver | undefined
): TenantScopedVersionAwareObjectStorageResolver {
  if (resolver === undefined) {
    throw new Error(
      "Inbox V2 file download tickets require a tenant-scoped storage resolver."
    );
  }
  return resolver;
}

export { createApiNodeServer } from "./http/node-server";
export { createInternalApiHandler } from "./http/internal-api-handler";
export { createPublicApiHandler } from "./http/public-api-handler";
export { createTelegramWebhookHandler } from "./http/telegram-webhook-handler";
export { createExternalChannelCommandService } from "./external-channel-command-service";
export {
  calculateInboxV2IdentityClaimIntentDigest,
  createInboxV2IdentityClaimCommandService,
  createInboxV2IdentityClaimEvidenceManifest
} from "./inbox-v2-identity-claim-command";
export {
  calculateInboxV2OutboundRouteIdempotencyToken,
  calculateInboxV2OutboundSendIntentDigest,
  createInboxV2OutboundSendCommandService
} from "./inbox-v2-outbound-send-command";
export { createInternalAccessDecisionService } from "./internal-access-decision-service";
export { createInternalEgressStatusService } from "./internal-egress-status-service";
export {
  createInternalFileService,
  createInternalInboxV2FileDownloadService
} from "./internal-file-service";
export {
  createInboxV2FileDownloadTicketService,
  InboxV2FileDownloadTicketError
} from "./inbox-v2-file-download-ticket";
export {
  createInternalInboxAuthorizationService,
  createInternalInboxCommandService,
  createSqlInternalInboxAuthorizationService,
  createSqlInternalInboxQueryService
} from "./internal-inbox-service";
export { createInternalIntegrationService } from "./internal-integrations-service";
export { createInternalOrgStructureService } from "./internal-org-structure-service";
export { createInternalRbacService } from "./internal-rbac-service";
export { createInternalTenantSettingsService } from "./internal-tenant-service";
export { createPublicApiCommandService } from "./public-api-command-service";
export type {
  ExternalChannelCommandContext,
  ExternalChannelCommandService,
  ExternalChannelCommandServiceOptions
} from "./external-channel-command-service";
export type {
  InboxV2AutomaticIdentityClaimCommand,
  InboxV2IdentityClaimCommand,
  InboxV2IdentityClaimCommandPreparer,
  InboxV2IdentityClaimCommandResult,
  InboxV2IdentityClaimCommandService,
  InboxV2IdentityClaimCommandServiceOptions,
  InboxV2IdentityClaimEvidenceManifest,
  InboxV2IdentityClaimIntentKind,
  InboxV2IdentityClaimRevokeCommand,
  InboxV2ManualClientContactClaimCommand,
  InboxV2ManualEmployeeClaimCommand,
  InboxV2PreparedIdentityClaimAuthorizationBinding,
  InboxV2PreparedIdentityClaimCommand
} from "./inbox-v2-identity-claim-command";
export type {
  InboxV2OutboundSendCommand,
  InboxV2OutboundSendCommandPreparer,
  InboxV2OutboundSendCommandResult,
  InboxV2OutboundSendCommandService,
  InboxV2OutboundSendCommandServiceOptions,
  InboxV2OutboundSendIdempotencyScope,
  InboxV2OutboundSendRequestScope,
  InboxV2OutboundSendRouteIntent,
  InboxV2PreparedOutboundSendCommand
} from "./inbox-v2-outbound-send-command";
export type {
  InternalAccessDecisionContext,
  InternalAccessDecisionService,
  InternalAccessDecisionServiceOptions
} from "./internal-access-decision-service";
export type {
  InternalEgressStatusContext,
  InternalEgressStatusService,
  InternalEgressStatusServiceOptions
} from "./internal-egress-status-service";
export type {
  InternalFileContent,
  InternalFileService,
  InternalFileServiceOptions,
  InternalInboxV2FileDownloadContent,
  InternalInboxV2FileDownloadService,
  InternalInboxV2FileDownloadServiceOptions
} from "./internal-file-service";
export type {
  InboxV2FileDownloadAccessRecord,
  InboxV2FileDownloadAccessRepository,
  InboxV2FileDownloadPrincipal,
  InboxV2FileDownloadPrincipalIdentity,
  InboxV2FileDownloadTicketErrorCode,
  InboxV2FileDownloadTicketService,
  InboxV2FileDownloadTicketServiceOptions
} from "./inbox-v2-file-download-ticket";
export type {
  InternalInboxAuthorizationService,
  InternalInboxAuthorizationServiceOptions,
  InternalInboxConversationAccessResource,
  InternalInboxCommandContext,
  InternalInboxCommandService,
  InternalInboxCommandServiceOptions,
  InternalInboxQueryContext,
  InternalInboxQueryService
} from "./internal-inbox-service";
export type {
  InternalIntegrationContext,
  InternalIntegrationService,
  InternalIntegrationServiceOptions
} from "./internal-integrations-service";
export type {
  InternalRbacContext,
  InternalRbacService,
  InternalRbacServiceOptions
} from "./internal-rbac-service";
export type {
  InternalTenantSettingsContext,
  InternalTenantSettingsService
} from "./internal-tenant-service";
export type { PublicApiCommandServiceOptions } from "./public-api-command-service";
export type {
  TelegramWebhookHandler,
  TelegramWebhookHandlerOptions
} from "./http/telegram-webhook-handler";
export type {
  ApiHttpHandler,
  ApiHttpMethod,
  ApiHttpRequest,
  ApiHttpResponse,
  ApiKeyAuthenticator,
  AuthenticatedApiKey,
  PublicApiAction,
  PublicApiAuditOutcome,
  PublicApiAuditRecord,
  PublicApiAuditSink,
  PublicApiCommandContext,
  PublicApiCommandService,
  PublicApiHandler,
  PublicApiHandlerOptions
} from "./http/public-api-handler";
export type {
  InternalApiHandler,
  InternalApiHandlerOptions,
  InternalApiSession,
  InternalApiSessionResolver
} from "./http/internal-api-handler";
