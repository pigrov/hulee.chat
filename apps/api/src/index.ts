import { loadApiConfig, type ApiConfig, type EnvSource } from "@hulee/config";
import {
  createAesGcmTenantSecretCipher,
  createSqlDomainEventRepository,
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlPublicApiAuditSink,
  createSqlChannelAuthChallengeRepository,
  createSqlChannelConnectorRepository,
  createSqlEmployeeDirectoryRepository,
  createSqlOrgStructureRepository,
  createSqlSecurityAuditRepository,
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
  const tenantSecrets = options.secretEncryptionKey
    ? createSqlTenantSecretRepository(
        options.database,
        createAesGcmTenantSecretCipher({
          key: options.secretEncryptionKey
        })
      )
    : undefined;
  const inboxAuthorization = createSqlInternalInboxAuthorizationService({
    database: options.database
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
    integrations: createInternalIntegrationService({
      connectorRepository: createSqlChannelConnectorRepository(
        options.database
      ),
      authChallengeRepository: createSqlChannelAuthChallengeRepository(
        options.database
      ),
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
      repository: createSqlOrgStructureRepository(options.database)
    }),
    accessDecisions: createInternalAccessDecisionService({
      employeeRepository: createSqlEmployeeDirectoryRepository(
        options.database
      ),
      rbacRepository: createSqlTenantRbacRepository(options.database)
    }),
    egressStatus: createInternalEgressStatusService({
      profiles: options.egressProfile ? [options.egressProfile] : []
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

export { createApiNodeServer } from "./http/node-server";
export { createInternalApiHandler } from "./http/internal-api-handler";
export { createPublicApiHandler } from "./http/public-api-handler";
export { createTelegramWebhookHandler } from "./http/telegram-webhook-handler";
export { createExternalChannelCommandService } from "./external-channel-command-service";
export { createInternalAccessDecisionService } from "./internal-access-decision-service";
export { createInternalEgressStatusService } from "./internal-egress-status-service";
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
