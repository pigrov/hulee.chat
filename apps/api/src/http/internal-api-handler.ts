import type {
  EmployeeId,
  InternalInboxConversationRoutingUpdateResponse,
  InternalInboxReplyResponse,
  InternalInboxViewResponse,
  InternalOrgStructureResponse,
  InternalOrgUnit,
  InternalWorkQueue,
  InternalTenantBrandResponse,
  InternalTelegramIntegrationResponse,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  internalInboxConversationRoutingUpdateRequestSchema,
  internalApiV1Version,
  internalInboxReplyRequestSchema,
  internalOrgUnitUpsertRequestSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  internalWorkQueueUpsertRequestSchema,
  isPlatformErrorCode
} from "@hulee/contracts";
import {
  CoreError,
  internalApiSignatureHeader,
  internalApiTimestampHeader,
  isPermission,
  verifyInternalApiSignature,
  type Permission
} from "@hulee/core";
import type { Logger } from "@hulee/observability";

import type {
  InternalInboxCommandService,
  InternalInboxQueryService
} from "../internal-inbox-service";
import type { InternalIntegrationService } from "../internal-integrations-service";
import type { InternalOrgStructureService } from "../internal-org-structure-service";
import type { InternalTenantSettingsService } from "../internal-tenant-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";
import { resolveRequestId } from "./request-id";

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
  tenantSettings: InternalTenantSettingsService;
  orgStructure: InternalOrgStructureService;
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
      route: "inbox_routing_update";
      conversationId: string;
    }
  | {
      route: "tenant_brand_view";
    }
  | {
      route: "tenant_brand_update";
    }
  | {
      route: "org_structure_view";
    }
  | {
      route: "org_unit_upsert";
    }
  | {
      route: "work_queue_upsert";
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
      const requestId = resolveRequestId({
        headers: request.headers,
        requestIdFactory
      });
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
          integrations: options.integrations,
          tenantSettings: options.tenantSettings,
          orgStructure: options.orgStructure
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
      return (
        resolveHeaderSession(request, requestId, input) ??
        createFallbackDevSession(request, requestId, input)
      );
    }
  };
}

export function createSignedInternalSessionResolver(input: {
  secret?: string;
  allowUnsignedFallback?: boolean;
  now?: () => Date;
  maxAgeMs?: number;
  fallback?: {
    tenantId?: TenantId;
    employeeId?: EmployeeId;
    permissions?: readonly Permission[];
  };
}): InternalApiSessionResolver {
  const now = input.now ?? (() => new Date());

  return {
    async resolve(request, requestId) {
      const headerSession = resolveHeaderSession(
        request,
        requestId,
        input.fallback
      );

      if (headerSession === null) {
        return input.allowUnsignedFallback
          ? createFallbackDevSession(request, requestId, input.fallback)
          : null;
      }

      if (input.secret === undefined) {
        return input.allowUnsignedFallback ? headerSession : null;
      }

      const timestamp = headerValue(
        request.headers,
        internalApiTimestampHeader
      );
      const signature = headerValue(
        request.headers,
        internalApiSignatureHeader
      );

      if (timestamp === undefined) {
        return null;
      }

      const verified = verifyInternalApiSignature({
        method: request.method,
        path: request.path,
        body: request.body,
        tenantId: headerSession.tenantId,
        employeeId: headerSession.employeeId,
        permissions: headerSession.permissions,
        timestamp,
        secret: input.secret,
        signature,
        now: now(),
        maxAgeMs: input.maxAgeMs
      });

      return verified ? headerSession : null;
    }
  };
}

function resolveHeaderSession(
  request: ApiHttpRequest,
  requestId: string,
  input?: {
    tenantId?: TenantId;
    employeeId?: EmployeeId;
    permissions?: readonly Permission[];
  }
): InternalApiSession | null {
  const tenantId =
    (headerValue(request.headers, "x-hulee-tenant-id") as
      | TenantId
      | undefined) ?? input?.tenantId;
  const employeeId =
    (headerValue(request.headers, "x-hulee-employee-id") as
      | EmployeeId
      | undefined) ?? input?.employeeId;
  const headerPermissions = parsePermissionsHeader(
    headerValue(request.headers, "x-hulee-permissions")
  );
  const permissions = input?.permissions ?? headerPermissions;

  if (tenantId === undefined || employeeId === undefined) {
    return null;
  }

  return {
    requestId,
    tenantId,
    employeeId,
    permissions: permissions ?? []
  };
}

function createFallbackDevSession(
  request: ApiHttpRequest,
  requestId: string,
  input?: {
    tenantId?: TenantId;
    employeeId?: EmployeeId;
    permissions?: readonly Permission[];
  }
): InternalApiSession {
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
  const headerPermissions = parsePermissionsHeader(
    headerValue(request.headers, "x-hulee-permissions")
  );

  return {
    requestId,
    tenantId,
    employeeId,
    permissions: input?.permissions ??
      headerPermissions ?? [
        "tenant.manage",
        "employees.manage",
        "inbox.read",
        "message.reply",
        "conversation.assign",
        "modules.manage"
      ]
  };
}

async function handleAuthenticatedRoute(input: {
  request: ApiHttpRequest;
  route: Exclude<RouteMatch, { route: "health" }>;
  session: InternalApiSession;
  inboxQueries: InternalInboxQueryService;
  inboxCommands: InternalInboxCommandService;
  integrations: InternalIntegrationService;
  tenantSettings: InternalTenantSettingsService;
  orgStructure: InternalOrgStructureService;
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

    case "inbox_routing_update": {
      assertSessionCan(input.session, "conversation.assign");
      const request = internalInboxConversationRoutingUpdateRequestSchema.parse(
        input.request.body
      );
      const response: InternalInboxConversationRoutingUpdateResponse =
        await input.inboxCommands.updateConversationRouting(input.session, {
          conversationId: input.route.conversationId,
          request
        });

      return jsonResponse(200, response);
    }

    case "tenant_brand_view": {
      assertSessionCan(input.session, "tenant.manage");
      const response: InternalTenantBrandResponse =
        await input.tenantSettings.loadTenantBrand(input.session);

      return jsonResponse(200, response);
    }

    case "tenant_brand_update": {
      assertSessionCan(input.session, "tenant.manage");
      const request = internalTenantBrandUpdateRequestSchema.parse(
        input.request.body
      );
      const response: InternalTenantBrandResponse =
        await input.tenantSettings.updateTenantBrand(input.session, request);

      return jsonResponse(200, response);
    }

    case "org_structure_view": {
      assertSessionCan(input.session, "employees.manage");
      const response: InternalOrgStructureResponse =
        await input.orgStructure.loadOrgStructure(input.session);

      return jsonResponse(200, response);
    }

    case "org_unit_upsert": {
      assertSessionCan(input.session, "employees.manage");
      const request = internalOrgUnitUpsertRequestSchema.parse(
        input.request.body
      );
      const response: InternalOrgUnit = await input.orgStructure.upsertOrgUnit(
        input.session,
        request
      );

      return jsonResponse(200, response);
    }

    case "work_queue_upsert": {
      assertSessionCan(input.session, "employees.manage");
      const request = internalWorkQueueUpsertRequestSchema.parse(
        input.request.body
      );
      const response: InternalWorkQueue =
        await input.orgStructure.upsertWorkQueue(input.session, request);

      return jsonResponse(200, response);
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

  if (request.method === "GET" && path === "/internal/v1/tenant/brand") {
    return {
      route: "tenant_brand_view"
    };
  }

  if (request.method === "PUT" && path === "/internal/v1/tenant/brand") {
    return {
      route: "tenant_brand_update"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/org-structure") {
    return {
      route: "org_structure_view"
    };
  }

  if (
    request.method === "PUT" &&
    path === "/internal/v1/org-structure/org-units"
  ) {
    return {
      route: "org_unit_upsert"
    };
  }

  if (
    request.method === "PUT" &&
    path === "/internal/v1/org-structure/work-queues"
  ) {
    return {
      route: "work_queue_upsert"
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

  const routingUpdateMatch = path.match(
    /^\/internal\/v1\/inbox\/conversations\/([^/]+)\/routing$/
  );

  if (request.method === "PATCH" && routingUpdateMatch?.[1]) {
    return {
      route: "inbox_routing_update",
      conversationId: decodeURIComponent(routingUpdateMatch[1])
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

function parsePermissionsHeader(
  value: string | undefined
): readonly Permission[] | undefined {
  if (value === undefined || value.trim().length === 0) {
    return undefined;
  }

  const parsed = value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const permissions = parsed.filter(isPermission);

  return permissions.length > 0 ? permissions : [];
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
