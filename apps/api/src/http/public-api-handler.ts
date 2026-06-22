import type {
  ChannelAdapter,
  NormalizedIncomingMessage,
  PlatformErrorCode,
  PublicApiDeliveryStatusResponse,
  PublicApiInboundMessageRequest,
  PublicApiInboundMessageResponse,
  PublicApiOutboundMessageRequest,
  PublicApiOutboundMessageResponse,
  PublicApiRegisterClientRequest,
  PublicApiRegisterClientResponse,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  isPlatformErrorCode,
  publicApiDeliveryStatusRequestSchema,
  publicApiInboundMessageRequestSchema,
  publicApiOutboundMessageRequestSchema,
  publicApiRegisterClientRequestSchema,
  publicApiV1Version
} from "@hulee/contracts";
import { createPublicApiChannelAdapter } from "@hulee/modules";
import type { Logger } from "@hulee/observability";

export type ApiHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type ApiHttpRequest = {
  method: ApiHttpMethod;
  path: string;
  headers?: Record<string, string | undefined>;
  body?: unknown;
};

export type ApiHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

export type ApiHttpHandler = {
  handle(request: ApiHttpRequest): Promise<ApiHttpResponse>;
};

export type AuthenticatedApiKey = {
  tenantId: TenantId;
  apiKeyId: string;
  name?: string;
};

export type ApiKeyAuthenticator = {
  authenticate(rawApiKey: string): Promise<AuthenticatedApiKey | null>;
};

export type PublicApiAuditOutcome = "success" | "failure";

export type PublicApiAuditRecord = {
  requestId: string;
  tenantId: TenantId;
  apiKeyId: string;
  action: PublicApiAction;
  entityType: string;
  entityId: string;
  outcome: PublicApiAuditOutcome;
  status: number;
  errorCode?: PlatformErrorCode;
};

export type PublicApiAuditSink = {
  record(record: PublicApiAuditRecord): Promise<void>;
};

export type PublicApiAction =
  | "public_api.client.register"
  | "public_api.message.inbound"
  | "public_api.message.outbound"
  | "public_api.delivery_status.read";

export type PublicApiCommandContext = {
  requestId: string;
  tenantId: TenantId;
  apiKeyId: string;
};

export type PublicApiCommandService = {
  registerClient(
    context: PublicApiCommandContext,
    request: PublicApiRegisterClientRequest
  ): Promise<PublicApiRegisterClientResponse>;
  acceptInboundMessage(
    context: PublicApiCommandContext,
    message: NormalizedIncomingMessage,
    request: PublicApiInboundMessageRequest
  ): Promise<PublicApiInboundMessageResponse>;
  queueOutboundMessage(
    context: PublicApiCommandContext,
    request: PublicApiOutboundMessageRequest
  ): Promise<PublicApiOutboundMessageResponse>;
  getDeliveryStatus(
    context: PublicApiCommandContext,
    messageId: string
  ): Promise<PublicApiDeliveryStatusResponse>;
};

export type PublicApiHandlerOptions = {
  authenticator: ApiKeyAuthenticator;
  commands: PublicApiCommandService;
  auditSink?: PublicApiAuditSink;
  channelAdapter?: ChannelAdapter;
  logger?: Logger;
  requestIdFactory?: () => string;
};

export type PublicApiHandler = ApiHttpHandler;

type RouteMatch =
  | {
      route: "health";
    }
  | {
      route: "register_client";
      action: "public_api.client.register";
    }
  | {
      route: "inbound_message";
      action: "public_api.message.inbound";
    }
  | {
      route: "outbound_message";
      action: "public_api.message.outbound";
    }
  | {
      route: "delivery_status";
      action: "public_api.delivery_status.read";
      messageId: string;
    };

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

export function createPublicApiHandler(
  options: PublicApiHandlerOptions
): PublicApiHandler {
  const channelAdapter =
    options.channelAdapter ?? createPublicApiChannelAdapter();
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
          version: publicApiV1Version
        });
      }

      const apiKey = extractApiKey(request.headers);

      if (apiKey === undefined) {
        return errorResponse("auth.invalid_credentials", requestId);
      }

      const auth = await options.authenticator.authenticate(apiKey);

      if (auth === null) {
        return errorResponse("auth.invalid_credentials", requestId);
      }

      const context: PublicApiCommandContext = {
        requestId,
        tenantId: auth.tenantId,
        apiKeyId: auth.apiKeyId
      };

      try {
        return await handleAuthenticatedRoute({
          request,
          route,
          context,
          commands: options.commands,
          auditSink: options.auditSink,
          channelAdapter
        });
      } catch (error) {
        const code = platformErrorCodeFromUnknown(error);
        const response = errorResponse(code, requestId);

        options.logger?.warn(
          "public_api.request_failed",
          {
            requestId,
            route: route.route,
            status: response.status
          },
          error
        );

        await recordAudit(options.auditSink, {
          requestId,
          tenantId: auth.tenantId,
          apiKeyId: auth.apiKeyId,
          action: route.action,
          entityType: route.route,
          entityId: route.route === "delivery_status" ? route.messageId : "*",
          outcome: "failure",
          status: response.status,
          errorCode: code
        });

        return response;
      }
    }
  };
}

async function handleAuthenticatedRoute(input: {
  request: ApiHttpRequest;
  route: Exclude<RouteMatch, { route: "health" }>;
  context: PublicApiCommandContext;
  commands: PublicApiCommandService;
  auditSink?: PublicApiAuditSink;
  channelAdapter: ChannelAdapter;
}): Promise<ApiHttpResponse> {
  switch (input.route.route) {
    case "register_client": {
      const parsed = publicApiRegisterClientRequestSchema.parse(
        input.request.body
      );
      const response = await input.commands.registerClient(
        input.context,
        parsed
      );

      await recordAudit(input.auditSink, {
        requestId: input.context.requestId,
        tenantId: input.context.tenantId,
        apiKeyId: input.context.apiKeyId,
        action: input.route.action,
        entityType: "client",
        entityId: response.clientId,
        outcome: "success",
        status: 201
      });

      return jsonResponse(201, response);
    }

    case "inbound_message": {
      const parsed = publicApiInboundMessageRequestSchema.parse(
        input.request.body
      );
      const normalized = await input.channelAdapter.normalizeIncoming({
        tenantId: input.context.tenantId,
        body: parsed
      });
      const response = await input.commands.acceptInboundMessage(
        input.context,
        normalized,
        parsed
      );

      await recordAudit(input.auditSink, {
        requestId: input.context.requestId,
        tenantId: input.context.tenantId,
        apiKeyId: input.context.apiKeyId,
        action: input.route.action,
        entityType: "message",
        entityId: response.messageId,
        outcome: "success",
        status: 202
      });

      return jsonResponse(202, response);
    }

    case "outbound_message": {
      const parsed = publicApiOutboundMessageRequestSchema.parse(
        input.request.body
      );
      const response = await input.commands.queueOutboundMessage(
        input.context,
        parsed
      );

      await recordAudit(input.auditSink, {
        requestId: input.context.requestId,
        tenantId: input.context.tenantId,
        apiKeyId: input.context.apiKeyId,
        action: input.route.action,
        entityType: "message",
        entityId: response.messageId,
        outcome: "success",
        status: 202
      });

      return jsonResponse(202, response);
    }

    case "delivery_status": {
      const parsed = publicApiDeliveryStatusRequestSchema.parse({
        messageId: input.route.messageId
      });
      const response = await input.commands.getDeliveryStatus(
        input.context,
        parsed.messageId
      );

      await recordAudit(input.auditSink, {
        requestId: input.context.requestId,
        tenantId: input.context.tenantId,
        apiKeyId: input.context.apiKeyId,
        action: input.route.action,
        entityType: "message",
        entityId: response.messageId,
        outcome: "success",
        status: 200
      });

      return jsonResponse(200, response);
    }
  }
}

function matchRoute(request: ApiHttpRequest): RouteMatch | undefined {
  const path = normalizePath(request.path);

  if (request.method === "GET" && path === "/v1/health") {
    return { route: "health" };
  }

  if (request.method === "POST" && path === "/v1/clients") {
    return {
      route: "register_client",
      action: "public_api.client.register"
    };
  }

  if (request.method === "POST" && path === "/v1/messages/inbound") {
    return {
      route: "inbound_message",
      action: "public_api.message.inbound"
    };
  }

  if (request.method === "POST" && path === "/v1/messages/outbound") {
    return {
      route: "outbound_message",
      action: "public_api.message.outbound"
    };
  }

  const deliveryStatusMatch = path.match(
    /^\/v1\/messages\/([^/]+)\/delivery-status$/
  );

  if (request.method === "GET" && deliveryStatusMatch?.[1]) {
    return {
      route: "delivery_status",
      action: "public_api.delivery_status.read",
      messageId: decodeURIComponent(deliveryStatusMatch[1])
    };
  }

  return undefined;
}

function normalizePath(path: string): string {
  const parsed = path.split("?")[0] ?? "/";

  if (parsed.length > 1 && parsed.endsWith("/")) {
    return parsed.slice(0, -1);
  }

  return parsed;
}

function extractApiKey(
  headers: Record<string, string | undefined> | undefined
): string | undefined {
  const authorization = headerValue(headers, "authorization");

  if (authorization?.startsWith("Bearer ")) {
    const value = authorization.slice("Bearer ".length).trim();

    return value.length > 0 ? value : undefined;
  }

  const explicitHeader = headerValue(headers, "x-hulee-api-key")?.trim();

  return explicitHeader && explicitHeader.length > 0
    ? explicitHeader
    : undefined;
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

async function recordAudit(
  auditSink: PublicApiAuditSink | undefined,
  record: PublicApiAuditRecord
): Promise<void> {
  await auditSink?.record(record);
}

function defaultRequestIdFactory(): string {
  return `api-request-${Date.now()}`;
}
