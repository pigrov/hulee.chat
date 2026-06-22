import type {
  PlatformErrorCode,
  PublicApiInboundMessageResponse,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  isPlatformErrorCode
} from "@hulee/contracts";
import { createTelegramChannelAdapter } from "@hulee/modules";
import type { Logger } from "@hulee/observability";

import type { ExternalChannelCommandService } from "../external-channel-command-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";

export type TelegramWebhookHandlerOptions = {
  commands: ExternalChannelCommandService;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export type TelegramWebhookHandler = {
  handle(request: ApiHttpRequest): Promise<ApiHttpResponse>;
};

type RouteMatch = {
  channelExternalId: string;
};

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};
const defaultTenantId = "tenant_local_1" as TenantId;

export function createTelegramWebhookHandler(
  options: TelegramWebhookHandlerOptions
): TelegramWebhookHandler {
  const requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;
  const adapter = createTelegramChannelAdapter();

  return {
    async handle(request) {
      const requestId = resolveRequestId(request, requestIdFactory);
      const route = matchRoute(request);

      if (route === undefined) {
        return errorResponse("validation.failed", requestId, 404);
      }

      const tenantId = resolveTenantId(request);

      try {
        const normalized = await adapter.normalizeIncoming({
          tenantId,
          channelExternalId: route.channelExternalId,
          update: request.body
        });
        const response: PublicApiInboundMessageResponse =
          await options.commands.acceptInboundMessage(
            {
              requestId,
              tenantId,
              channelId: route.channelExternalId
            },
            normalized
          );

        return jsonResponse(202, {
          ...response,
          channelExternalId: route.channelExternalId
        });
      } catch (error) {
        const code = platformErrorCodeFromUnknown(error);
        const response = errorResponse(code, requestId);

        options.logger?.warn(
          "telegram_webhook.request_failed",
          {
            requestId,
            channelExternalId: route.channelExternalId,
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
      channelExternalId: decodeURIComponent(match[1])
    };
  }

  return undefined;
}

function resolveTenantId(request: ApiHttpRequest): TenantId {
  const url = new URL(request.path, "http://hulee.local");
  const headerTenantId = headerValue(
    request.headers,
    "x-hulee-tenant-id"
  )?.trim();
  const queryTenantId = url.searchParams.get("tenantId")?.trim();

  return (headerTenantId ??
    queryTenantId ??
    process.env.HULEE_WEB_TENANT_ID ??
    defaultTenantId) as TenantId;
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function resolveRequestId(
  request: ApiHttpRequest,
  requestIdFactory: () => string
): string {
  const headerRequestId = headerValue(request.headers, "x-request-id")?.trim();

  return headerRequestId && headerRequestId.length > 0
    ? headerRequestId
    : requestIdFactory();
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
