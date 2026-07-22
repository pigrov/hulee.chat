import { loadApiConfig, type ApiConfig, type EnvSource } from "@hulee/config";
import {
  createAesGcmTenantSecretCipher,
  createSqlDomainEventRepository,
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
import type { TenantScopedVersionAwareObjectStorageResolver } from "@hulee/storage";

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
import { createInternalAccessDecisionService } from "./internal-access-decision-service";
import { createInternalEgressStatusService } from "./internal-egress-status-service";
import { createInboxV2FileDownloadService } from "./inbox-v2-file-download-service";
import type { InboxV2FileDownloadTicketService } from "./inbox-v2-file-download-ticket";
import {
  createTenantSecretResolver,
  createInternalIntegrationService
} from "./internal-integrations-service";
import { createInternalOrgStructureService } from "./internal-org-structure-service";
import { createInternalRbacService } from "./internal-rbac-service";
import { createInternalTenantSettingsService } from "./internal-tenant-service";
import {
  createCleanSlatePublicApiCommandService,
  createCleanSlateTelegramWebhookHandler
} from "./clean-slate-inbox-runtime";

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
  return createPublicApiHandler({
    authenticator: createSqlTenantApiKeyRepository(options.database),
    auditSink: createSqlPublicApiAuditSink(options.database),
    commands: createCleanSlatePublicApiCommandService(),
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
  const tenantSecretCipher = options.secretEncryptionKey
    ? createAesGcmTenantSecretCipher({
        key: options.secretEncryptionKey
      })
    : undefined;
  const tenantSecrets = tenantSecretCipher
    ? createSqlTenantSecretRepository(options.database, tenantSecretCipher)
    : undefined;
  const inboxV2FileDownloads =
    options.inboxV2FileDownloadTicketService === undefined
      ? undefined
      : createInboxV2FileDownloadService({
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
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      providerIoEnabled: false
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
  _options: TelegramWebhookDataPlaneHandlerOptions
): ApiHttpHandler {
  return createCleanSlateTelegramWebhookHandler();
}

export type ApiDataPlaneHandlerOptions = PublicApiDataPlaneHandlerOptions &
  Pick<
    InternalApiDataPlaneHandlerOptions,
    | "env"
    | "internalApiSecret"
    | "secretEncryptionKey"
    | "egressRuntime"
    | "egressProfile"
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
export {
  calculateInboxV2MessageLifecycleIntentDigest,
  createInboxV2MessageLifecycleCommandService
} from "./inbox-v2-message-lifecycle-command";
export {
  calculateInboxV2OutboundReferenceIntentDigest,
  calculateInboxV2OutboundReferenceRouteIdempotencyToken,
  createInboxV2OutboundReferenceCommandService
} from "./inbox-v2-outbound-reference-command";
export { createInternalAccessDecisionService } from "./internal-access-decision-service";
export { createInternalEgressStatusService } from "./internal-egress-status-service";
export { createInboxV2FileDownloadService } from "./inbox-v2-file-download-service";
export {
  createInboxV2FileDownloadTicketService,
  InboxV2FileDownloadTicketError
} from "./inbox-v2-file-download-ticket";
export { createInternalIntegrationService } from "./internal-integrations-service";
export { createInternalOrgStructureService } from "./internal-org-structure-service";
export { createInternalRbacService } from "./internal-rbac-service";
export { createInternalTenantSettingsService } from "./internal-tenant-service";
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
  InboxV2MessageLifecycleAtomicCoordinator,
  InboxV2MessageLifecycleAtomicResult,
  InboxV2MessageLifecycleCommand,
  InboxV2MessageLifecycleCommandPreparer,
  InboxV2MessageLifecycleCommandResult,
  InboxV2MessageLifecycleCommandService,
  InboxV2MessageLifecycleCommandServiceOptions,
  InboxV2MessageLifecycleIdempotencyScope,
  InboxV2MessageLifecycleRequestScope,
  InboxV2PreparedMessageLifecycleCommand
} from "./inbox-v2-message-lifecycle-command";
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
  InboxV2OutboundReferenceCommand,
  InboxV2OutboundReferenceCommandPreparer,
  InboxV2OutboundReferenceCommandResult,
  InboxV2OutboundReferenceCommandService,
  InboxV2OutboundReferenceCommandServiceOptions,
  InboxV2OutboundReferenceIdempotencyScope,
  InboxV2OutboundReferenceRequestScope,
  InboxV2OutboundReferenceRouteIntent,
  InboxV2OutboundReferenceSource,
  InboxV2PreparedOutboundReferenceCommand
} from "./inbox-v2-outbound-reference-command";
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
  InboxV2FileDownloadContent,
  InboxV2FileDownloadContext,
  InboxV2FileDownloadService,
  InboxV2FileDownloadServiceOptions
} from "./inbox-v2-file-download-service";
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
