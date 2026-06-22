import type {
  EmployeeId,
  InternalInboxReplyResponse,
  InternalInboxViewResponse,
  InternalTelegramIntegrationResponse,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  internalApiV1Version,
  internalInboxReplyRequestSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  isPlatformErrorCode
} from "@hulee/contracts";
import { CoreError, type Permission } from "@hulee/core";
import type { Logger } from "@hulee/observability";

import type {
  InternalInboxCommandService,
  InternalInboxQueryService
} from "../internal-inbox-service";
import type { InternalIntegrationService } from "../internal-integrations-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";

export type InternalApiSession = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
  permissions: readonly Permission[];
};

export type InternalApiSessionResolver = {
  resolve(
    request: ApiHttpRequest,
    requestId: string
  ): Promise<InternalApiSession | null>;
};

export type InternalApiHandlerOptions = {
  sessionResolver: InternalApiSessionResolver;
  inboxQueries: InternalInboxQueryService;
  inboxCommands: InternalInboxCommandService;
  integrations: InternalIntegrationService;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export type InternalApiHandler = {
  handle(request: ApiHttpRequest): Promise<ApiHttpResponse>;
};

type RouteMatch =
  | {
      route: "health";
    }
  | {
      route: "inbox_view";
      selectedConversationId?: string;
    }
  | {
      route: "inbox_reply";
      conversationId: string;
    }
  | {
      route: "telegram_integration_view";
    }
  | {
      route: "telegram_integration_update";
    }
  | {
      route: "telegram_integration_diagnostics";
    }
  | {
      route: "telegram_integration_webhook_set";
    }
  | {
      route: "telegram_integration_webhook_delete";
    };

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

const defaultTenantId = "tenant_local_1" as TenantId;

export function createInternalApiHandler(
  options: InternalApiHandlerOptions
): InternalApiHandler {
  const requestIdFactory = options.requestIdFactory ?? defaultRequestIdFactory;

  return {
    async handle(request) {
      const requestId = resolveRequestId(request, requestIdFactory);
      const route = matchRoute(request);

      if (route === undefined) {
        return errorResponse("validation.failed", requestId, 404);
      }

      if (route.route === "health") {
        return jsonResponse(200, {
          status: "ok",
          version: internalApiV1Version
        });
      }

      const session = await options.sessionResolver.resolve(request, requestId);

      if (session === null) {
        return errorResponse("auth.invalid_credentials", requestId);
      }

      try {
        return await handleAuthenticatedRoute({
          request,
          route,
          session,
          inboxQueries: options.inboxQueries,
          inboxCommands: options.inboxCommands,
          integrations: options.integrations
        });
      } catch (error) {
        const code = platformErrorCodeFromUnknown(error);
        const response = errorResponse(code, requestId);

        options.logger?.warn(
          "internal_api.request_failed",
          {
            requestId,
            route: route.route,
            status: response.status
          },
          error
        );

        return response;
      }
    }
  };
}

export function createLocalDevInternalSessionResolver(input?: {
  tenantId?: TenantId;
  employeeId?: EmployeeId;
  permissions?: readonly Permission[];
}): InternalApiSessionResolver {
  return {
    async resolve(request, requestId) {
      const tenantId =
        (headerValue(request.headers, "x-hulee-tenant-id") as
          | TenantId
          | undefined) ??
        input?.tenantId ??
        ((process.env.HULEE_WEB_TENANT_ID ?? defaultTenantId) as TenantId);
      const employeeId =
        (headerValue(request.headers, "x-hulee-employee-id") as
          | EmployeeId
          | undefined) ??
        input?.employeeId ??
        (`employee:${tenantId}:local-dev` as EmployeeId);

      return {
        requestId,
        tenantId,
        employeeId,
        permissions: input?.permissions ?? [
          "inbox.read",
          "message.reply",
          "modules.manage"
        ]
      };
    }
  };
}

async function handleAuthenticatedRoute(input: {
  request: ApiHttpRequest;
  route: Exclude<RouteMatch, { route: "health" }>;
  session: InternalApiSession;
  inboxQueries: InternalInboxQueryService;
  inboxCommands: InternalInboxCommandService;
  integrations: InternalIntegrationService;
}): Promise<ApiHttpResponse> {
  switch (input.route.route) {
    case "inbox_view": {
      assertSessionCan(input.session, "inbox.read");
      const response: InternalInboxViewResponse =
        await input.inboxQueries.loadInboxView(input.session, {
          selectedConversationId: input.route.selectedConversationId
        });

      return jsonResponse(200, response);
    }

    case "inbox_reply": {
      assertSessionCan(input.session, "message.reply");
      const request = internalInboxReplyRequestSchema.parse(input.request.body);
      const response: InternalInboxReplyResponse =
        await input.inboxCommands.sendReply(input.session, {
          conversationId: input.route.conversationId,
          request
        });

      return jsonResponse(202, response);
    }

    case "telegram_integration_view": {
      assertSessionCan(input.session, "modules.manage");
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.loadTelegramIntegration(input.session);

      return jsonResponse(200, response);
    }

    case "telegram_integration_update": {
      assertSessionCan(input.session, "modules.manage");
      const request = internalTelegramIntegrationUpdateRequestSchema.parse(
        input.request.body
      );
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.updateTelegramIntegration(
          input.session,
          request
        );

      return jsonResponse(200, response);
    }

    case "telegram_integration_diagnostics": {
      assertSessionCan(input.session, "modules.manage");
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.refreshTelegramDiagnostics(input.session);

      return jsonResponse(200, response);
    }

    case "telegram_integration_webhook_set": {
      assertSessionCan(input.session, "modules.manage");
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.setTelegramWebhook(input.session);

      return jsonResponse(200, response);
    }

    case "telegram_integration_webhook_delete": {
      assertSessionCan(input.session, "modules.manage");
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.deleteTelegramWebhook(input.session);

      return jsonResponse(200, response);
    }
  }
}

function matchRoute(request: ApiHttpRequest): RouteMatch | undefined {
  const url = new URL(request.path, "http://hulee.local");
  const path = normalizePath(url.pathname);

  if (request.method === "GET" && path === "/internal/v1/health") {
    return { route: "health" };
  }

  if (request.method === "GET" && path === "/internal/v1/inbox") {
    return {
      route: "inbox_view",
      selectedConversationId:
        url.searchParams.get("conversationId") ?? undefined
    };
  }

  const replyMatch = path.match(
    /^\/internal\/v1\/inbox\/conversations\/([^/]+)\/replies$/
  );

  if (request.method === "POST" && replyMatch?.[1]) {
    return {
      route: "inbox_reply",
      conversationId: decodeURIComponent(replyMatch[1])
    };
  }

  if (
    request.method === "GET" &&
    path === "/internal/v1/integrations/telegram"
  ) {
    return {
      route: "telegram_integration_view"
    };
  }

  if (
    request.method === "PUT" &&
    path === "/internal/v1/integrations/telegram"
  ) {
    return {
      route: "telegram_integration_update"
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/integrations/telegram/diagnostics"
  ) {
    return {
      route: "telegram_integration_diagnostics"
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/integrations/telegram/webhook"
  ) {
    return {
      route: "telegram_integration_webhook_set"
    };
  }

  if (
    request.method === "DELETE" &&
    path === "/internal/v1/integrations/telegram/webhook"
  ) {
    return {
      route: "telegram_integration_webhook_delete"
    };
  }

  return undefined;
}

function assertSessionCan(
  session: InternalApiSession,
  permission: Permission
): void {
  if (!session.permissions.includes(permission)) {
    throw new CoreError("permission.denied");
  }
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
  return `internal-api-request-${Date.now()}`;
}
