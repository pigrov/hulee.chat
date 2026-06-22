import { loadApiConfig, type ApiConfig, type EnvSource } from "@hulee/config";
import {
  createDrizzlePersistenceExecutor,
  createExternalMessageRepository,
  createSqlPublicApiAuditSink,
  createSqlTenantModuleConfigRepository,
  createSqlTenantApiKeyRepository,
  type HuleeDatabase
} from "@hulee/db";
import {
  createLevelFilteredLogger,
  createJsonLogger,
  type Logger
} from "@hulee/observability";

import {
  createPublicApiHandler,
  type ApiHttpHandler,
  type PublicApiHandler
} from "./http/public-api-handler";
import {
  createInternalApiHandler,
  createLocalDevInternalSessionResolver,
  type InternalApiHandler
} from "./http/internal-api-handler";
import {
  createInternalInboxCommandService,
  createSqlInternalInboxQueryService
} from "./internal-inbox-service";
import {
  createEnvSecretResolver,
  createInternalIntegrationService
} from "./internal-integrations-service";
import { createExternalChannelCommandService } from "./external-channel-command-service";
import { createPublicApiCommandService } from "./public-api-command-service";
import {
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

  return createInternalApiHandler({
    sessionResolver: createLocalDevInternalSessionResolver(),
    inboxQueries: createSqlInternalInboxQueryService({
      database: options.database
    }),
    inboxCommands: createInternalInboxCommandService({
      repository: externalMessageRepository
    }),
    integrations: createInternalIntegrationService({
      repository: createSqlTenantModuleConfigRepository(options.database),
      secretResolver: createEnvSecretResolver(options.env),
      telegramApiBaseUrl: options.telegramApiBaseUrl,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl
    }),
    logger: options.logger,
    requestIdFactory: options.requestIdFactory
  });
}

export type TelegramWebhookDataPlaneHandlerOptions = {
  database: HuleeDatabase;
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

  return createTelegramWebhookHandler({
    commands: createExternalChannelCommandService({
      repository: externalMessageRepository
    }),
    logger: options.logger,
    requestIdFactory: options.requestIdFactory
  });
}

export type ApiDataPlaneHandlerOptions = PublicApiDataPlaneHandlerOptions &
  Pick<
    InternalApiDataPlaneHandlerOptions,
    "env" | "publicWebhookBaseUrl" | "telegramApiBaseUrl"
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
export {
  createInternalInboxCommandService,
  createSqlInternalInboxQueryService
} from "./internal-inbox-service";
export { createInternalIntegrationService } from "./internal-integrations-service";
export { createPublicApiCommandService } from "./public-api-command-service";
export type {
  ExternalChannelCommandContext,
  ExternalChannelCommandService,
  ExternalChannelCommandServiceOptions
} from "./external-channel-command-service";
export type {
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
