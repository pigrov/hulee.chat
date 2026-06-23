import type {
  PlatformErrorCode,
  PublicApiInboundMessageResponse,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  isPlatformErrorCode
} from "@hulee/contracts";
import type { TenantModuleConfigRepository } from "@hulee/db";
import {
  createTelegramChannelAdapter,
  parseTelegramChannelConfig,
  type TelegramChannelConfig
} from "@hulee/modules";
import type { Logger } from "@hulee/observability";
import { timingSafeEqual } from "node:crypto";

import type { ExternalChannelCommandService } from "../external-channel-command-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";
import { resolveRequestId } from "./request-id";

export type TelegramWebhookConnector = {
  tenantId: TenantId;
  config: TelegramChannelConfig;
};

export type TelegramWebhookConnectorResolver = {
  resolveConnector(input: {
    connectorId: string;
  }): Promise<TelegramWebhookConnector | null>;
};

export type SecretResolver = {
  resolveSecret(input: {
    tenantId: TenantId;
    secretRef: string;
  }): Promise<string | null>;
};

export type TelegramWebhookHandlerOptions = {
  commands: ExternalChannelCommandService;
  connectorResolver: TelegramWebhookConnectorResolver;
  secretResolver: SecretResolver;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export type TelegramWebhookHandler = {
  handle(request: ApiHttpRequest): Promise<ApiHttpResponse>;
};

type RouteMatch = {
  connectorId: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};
const telegramModuleId = "channel-telegram";
const telegramSecretTokenHeader = "x-telegram-bot-api-secret-token";

export function createTenantModuleTelegramWebhookConnectorResolver(input: {
  repository: TenantModuleConfigRepository;
}): TelegramWebhookConnectorResolver {
  return {
    async resolveConnector({ connectorId }) {
      const record = await input.repository.findEnabledConfigByConfigString({
        moduleId: telegramModuleId,
        configKey: "webhookConnectorId",
        configValue: connectorId
      });

      if (!record) {
        return null;
      }

      return {
        tenantId: record.tenantId,
        config: parseTelegramChannelConfig(record.config)
      };
    }
  };
}

export function createTelegramWebhookHandler(
  options: TelegramWebhookHandlerOptions
): TelegramWebhookHandler {
  const requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;
  const adapter = createTelegramChannelAdapter();

  return {
    async handle(request) {
      const requestId = resolveRequestId({
        headers: request.headers,
        requestIdFactory
      });
      const route = matchRoute(request);

      if (route === undefined) {
        return errorResponse("validation.failed", requestId, 404);
      }

      try {
        const connector = await options.connectorResolver.resolveConnector({
          connectorId: route.connectorId
        });

        if (!connector) {
          return errorResponse("tenant.not_found", requestId, 404);
        }

        assertWebhookConnectorReady(connector.config);
        await assertTelegramSecretToken({
          request,
          connector,
          secretResolver: options.secretResolver
        });

        const normalized = await adapter.normalizeIncoming({
          tenantId: connector.tenantId,
          channelExternalId: connector.config.channelExternalId,
          update: request.body
        });
        const response: PublicApiInboundMessageResponse =
          await options.commands.acceptInboundMessage(
            {
              requestId,
              tenantId: connector.tenantId,
              channelId: connector.config.channelExternalId
            },
            normalized
          );

        return jsonResponse(202, {
          ...response,
          channelExternalId: connector.config.channelExternalId
        });
      } catch (error) {
        const code = platformErrorCodeFromUnknown(error);
        const response = errorResponse(code, requestId);

        options.logger?.warn(
          "telegram_webhook.request_failed",
          {
            requestId,
            connectorId: route.connectorId,
            status: response.status
          },
          error
        );

        return response;
      }
    }
  };
}

function matchRoute(request: ApiHttpRequest): RouteMatch | undefined {
  const url = new URL(request.path, "http://hulee.local");
  const path = normalizePath(url.pathname);
  const match = path.match(/^\/webhooks\/telegram\/([^/]+)$/);

  if (request.method === "POST" && match?.[1]) {
    return {
      connectorId: decodeURIComponent(match[1])
    };
  }

  return undefined;
}

function assertWebhookConnectorReady(config: TelegramChannelConfig): void {
  if (config.mode !== "webhook") {
    throw new ErrorWithCode("module.disabled");
  }

  if (!config.webhookSecretTokenSecretRef) {
    throw new ErrorWithCode("validation.failed");
  }
}

async function assertTelegramSecretToken(input: {
  request: ApiHttpRequest;
  connector: TelegramWebhookConnector;
  secretResolver: SecretResolver;
}): Promise<void> {
  const expectedToken = await input.secretResolver.resolveSecret({
    tenantId: input.connector.tenantId,
    secretRef: input.connector.config.webhookSecretTokenSecretRef ?? ""
  });
  const actualToken = headerValue(
    input.request.headers,
    telegramSecretTokenHeader
  )?.trim();

  if (
    !expectedToken ||
    !actualToken ||
    !constantTimeStringEquals(expectedToken, actualToken)
  ) {
    throw new ErrorWithCode("auth.invalid_credentials");
  }
}

function constantTimeStringEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function headerValue(
  headers: Record<string, string | undefined> | undefined,
  name: string
): string | undefined {
  if (headers === undefined) {
    return undefined;
  }

  const lowerName = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lowerName) {
      return value;
    }
  }

  return undefined;
}

function platformErrorCodeFromUnknown(error: unknown): PlatformErrorCode {
  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    isPlatformErrorCode(error.code)
  ) {
    return error.code;
  }

  return "validation.failed";
}

class ErrorWithCode extends Error {
  readonly code: PlatformErrorCode;

  constructor(code: PlatformErrorCode) {
    super(code);
    this.code = code;
  }
}

function errorResponse(
  code: PlatformErrorCode,
  requestId: string,
  statusOverride?: number
): ApiHttpResponse {
  const definition = getPlatformErrorDefinition(code);

  return jsonResponse(statusOverride ?? definition.httpStatus, {
    error: {
      code,
      messageKey: definition.messageKey,
      retryability: definition.retryability,
      requestId
    }
  });
}

function jsonResponse(status: number, body: unknown): ApiHttpResponse {
  return {
    status,
    headers: jsonHeaders,
    body
  };
}

function defaultRequestIdFactory(): string {
  return `telegram-webhook-request-${Date.now()}`;
}
