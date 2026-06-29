import type {
  EmployeeId,
  InternalAccessDecisionResponse,
  InternalChannelCatalogResponse,
  InternalChannelConnectorSummary,
  InternalChannelConnectorsResponse,
  InternalInboxConversationRoutingUpdateResponse,
  InternalInboxReplyResponse,
  InternalInboxViewResponse,
  InternalOrgStructureResponse,
  InternalOrgUnit,
  InternalRbacDirectGrantResponse,
  InternalRbacDirectGrantsResponse,
  InternalRbacRevokeResponse,
  InternalRbacRoleBindingResponse,
  InternalRbacRoleBindingsResponse,
  InternalRbacRoleResponse,
  InternalRbacRolesResponse,
  InternalWorkQueue,
  InternalTenantBrandResponse,
  InternalTelegramIntegrationResponse,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  internalChannelConnectorCreateRequestSchema,
  internalAccessDecisionRequestSchema,
  internalInboxConversationRoutingUpdateRequestSchema,
  internalApiV1Version,
  internalInboxReplyRequestSchema,
  internalOrgUnitUpsertRequestSchema,
  internalRbacDirectGrantCreateRequestSchema,
  internalRbacRoleBindingCreateRequestSchema,
  internalRbacRoleMutationRequestSchema,
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
import type { InternalAccessDecisionService } from "../internal-access-decision-service";
import type { InternalIntegrationService } from "../internal-integrations-service";
import type { InternalOrgStructureService } from "../internal-org-structure-service";
import type { InternalRbacService } from "../internal-rbac-service";
import type { InternalTenantSettingsService } from "../internal-tenant-service";
import type { ApiHttpRequest, ApiHttpResponse } from "./public-api-handler";
import { resolveRequestId } from "./request-id";

export type InternalApiSession = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
  permissions: readonly Permission[];
  authMode: "signed" | "local_dev";
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
  accessDecisions: InternalAccessDecisionService;
  rbac: InternalRbacService;
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
      queueId?: string;
      assignedToMe?: boolean;
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
      route: "access_decision";
    }
  | {
      route: "rbac_roles_view";
    }
  | {
      route: "rbac_role_create";
    }
  | {
      route: "rbac_role_update";
      roleId: string;
    }
  | {
      route: "rbac_role_archive";
      roleId: string;
    }
  | {
      route: "rbac_role_restore";
      roleId: string;
    }
  | {
      route: "rbac_role_bindings_view";
    }
  | {
      route: "rbac_role_binding_create";
    }
  | {
      route: "rbac_role_binding_revoke";
      bindingId: string;
    }
  | {
      route: "rbac_direct_grants_view";
    }
  | {
      route: "rbac_direct_grant_create";
    }
  | {
      route: "rbac_direct_grant_revoke";
      grantId: string;
    }
  | {
      route: "channel_catalog_view";
    }
  | {
      route: "channel_connectors_view";
    }
  | {
      route: "channel_connector_create";
    }
  | {
      route: "channel_connector_disable";
      connectorId: string;
    }
  | {
      route: "channel_connector_delete";
      connectorId: string;
    }
  | {
      route: "telegram_integration_view";
      connectorId?: string;
    }
  | {
      route: "telegram_integration_update";
    }
  | {
      route: "telegram_integration_diagnostics";
      connectorId?: string;
    }
  | {
      route: "telegram_integration_webhook_set";
      connectorId?: string;
    }
  | {
      route: "telegram_integration_webhook_delete";
      connectorId?: string;
    };

type InternalRouteAuthorizationPolicy =
  | {
      readonly kind: "service_effective_access";
    }
  | {
      readonly kind: "signed_effective_permission_override";
      readonly permission: Permission;
    };

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8"
};

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
          orgStructure: options.orgStructure,
          accessDecisions: options.accessDecisions,
          rbac: options.rbac
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
      return resolveHeaderSession(request, requestId, "local_dev", input);
    }
  };
}

export function createSignedInternalSessionResolver(input: {
  secret?: string;
  now?: () => Date;
  maxAgeMs?: number;
}): InternalApiSessionResolver {
  const now = input.now ?? (() => new Date());
  const secret = input.secret?.trim();

  return {
    async resolve(request, requestId) {
      const headerSession = resolveHeaderSession(
        request,
        requestId,
        secret === undefined || secret.length === 0 ? "local_dev" : "signed"
      );

      if (headerSession === null) {
        return null;
      }

      if (secret === undefined || secret.length === 0) {
        return headerSession;
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
        secret,
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
  authMode: InternalApiSession["authMode"],
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
    permissions: permissions ?? [],
    authMode
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
  accessDecisions: InternalAccessDecisionService;
  rbac: InternalRbacService;
}): Promise<ApiHttpResponse> {
  assertInternalRouteAuthorization(input.session, input.route);

  switch (input.route.route) {
    case "inbox_view": {
      const response: InternalInboxViewResponse =
        await input.inboxQueries.loadInboxView(input.session, {
          selectedConversationId: input.route.selectedConversationId,
          filters: {
            queueId: input.route.queueId,
            assignedToMe: input.route.assignedToMe
          }
        });

      return jsonResponse(200, response);
    }

    case "inbox_reply": {
      const request = internalInboxReplyRequestSchema.parse(input.request.body);
      const response: InternalInboxReplyResponse =
        await input.inboxCommands.sendReply(input.session, {
          conversationId: input.route.conversationId,
          request
        });

      return jsonResponse(202, response);
    }

    case "inbox_routing_update": {
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
      const response: InternalTenantBrandResponse =
        await input.tenantSettings.loadTenantBrand(input.session);

      return jsonResponse(200, response);
    }

    case "tenant_brand_update": {
      const request = internalTenantBrandUpdateRequestSchema.parse(
        input.request.body
      );
      const response: InternalTenantBrandResponse =
        await input.tenantSettings.updateTenantBrand(input.session, request);

      return jsonResponse(200, response);
    }

    case "org_structure_view": {
      const response: InternalOrgStructureResponse =
        await input.orgStructure.loadOrgStructure(input.session);

      return jsonResponse(200, response);
    }

    case "org_unit_upsert": {
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
      const request = internalWorkQueueUpsertRequestSchema.parse(
        input.request.body
      );
      const response: InternalWorkQueue =
        await input.orgStructure.upsertWorkQueue(input.session, request);

      return jsonResponse(200, response);
    }

    case "access_decision": {
      const request = internalAccessDecisionRequestSchema.parse(
        input.request.body
      );
      const response: InternalAccessDecisionResponse =
        await input.accessDecisions.inspectAccessDecision(
          input.session,
          request
        );

      return jsonResponse(200, response);
    }

    case "rbac_roles_view": {
      const response: InternalRbacRolesResponse = await input.rbac.listRoles(
        input.session
      );

      return jsonResponse(200, response);
    }

    case "rbac_role_create": {
      const request = internalRbacRoleMutationRequestSchema.parse(
        input.request.body
      );
      const response: InternalRbacRoleResponse = await input.rbac.createRole(
        input.session,
        request
      );

      return jsonResponse(201, response);
    }

    case "rbac_role_update": {
      const request = internalRbacRoleMutationRequestSchema.parse(
        input.request.body
      );
      const response: InternalRbacRoleResponse = await input.rbac.updateRole(
        input.session,
        {
          roleId: input.route.roleId,
          request
        }
      );

      return jsonResponse(200, response);
    }

    case "rbac_role_archive": {
      const response: InternalRbacRoleResponse = await input.rbac.archiveRole(
        input.session,
        {
          roleId: input.route.roleId
        }
      );

      return jsonResponse(200, response);
    }

    case "rbac_role_restore": {
      const response: InternalRbacRoleResponse = await input.rbac.restoreRole(
        input.session,
        {
          roleId: input.route.roleId
        }
      );

      return jsonResponse(200, response);
    }

    case "rbac_role_bindings_view": {
      const response: InternalRbacRoleBindingsResponse =
        await input.rbac.listRoleBindings(input.session);

      return jsonResponse(200, response);
    }

    case "rbac_role_binding_create": {
      const request = internalRbacRoleBindingCreateRequestSchema.parse(
        input.request.body
      );
      const response: InternalRbacRoleBindingResponse =
        await input.rbac.createRoleBinding(input.session, request);

      return jsonResponse(201, response);
    }

    case "rbac_role_binding_revoke": {
      const response: InternalRbacRevokeResponse =
        await input.rbac.revokeRoleBinding(input.session, {
          bindingId: input.route.bindingId
        });

      return jsonResponse(200, response);
    }

    case "rbac_direct_grants_view": {
      const response: InternalRbacDirectGrantsResponse =
        await input.rbac.listDirectGrants(input.session);

      return jsonResponse(200, response);
    }

    case "rbac_direct_grant_create": {
      const request = internalRbacDirectGrantCreateRequestSchema.parse(
        input.request.body
      );
      const response: InternalRbacDirectGrantResponse =
        await input.rbac.createDirectGrant(input.session, request);

      return jsonResponse(201, response);
    }

    case "rbac_direct_grant_revoke": {
      const response: InternalRbacRevokeResponse =
        await input.rbac.revokeDirectGrant(input.session, {
          grantId: input.route.grantId
        });

      return jsonResponse(200, response);
    }

    case "channel_catalog_view": {
      const response: InternalChannelCatalogResponse =
        await input.integrations.listChannelCatalog(input.session);

      return jsonResponse(200, response);
    }

    case "channel_connectors_view": {
      const response: InternalChannelConnectorsResponse =
        await input.integrations.listChannelConnectors(input.session);

      return jsonResponse(200, response);
    }

    case "channel_connector_create": {
      const request = internalChannelConnectorCreateRequestSchema.parse(
        input.request.body
      );
      const response: InternalChannelConnectorSummary =
        await input.integrations.createChannelConnector(input.session, request);

      return jsonResponse(201, response);
    }

    case "channel_connector_disable": {
      const response: InternalChannelConnectorSummary =
        await input.integrations.disableChannelConnector(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_delete": {
      const response: InternalChannelConnectorSummary =
        await input.integrations.deleteChannelConnector(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "telegram_integration_view": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.loadTelegramIntegration(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "telegram_integration_update": {
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
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.refreshTelegramDiagnostics(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "telegram_integration_webhook_set": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.setTelegramWebhook(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "telegram_integration_webhook_delete": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.deleteTelegramWebhook(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }
  }
}

function assertInternalRouteAuthorization(
  session: InternalApiSession,
  route: Exclude<RouteMatch, { route: "health" }>
): void {
  const policy = internalRouteAuthorizationPolicy(route);

  if (policy.kind === "signed_effective_permission_override") {
    assertSignedEffectivePermissionOverride(session, policy.permission);
  }
}

function internalRouteAuthorizationPolicy(
  route: Exclude<RouteMatch, { route: "health" }>
): InternalRouteAuthorizationPolicy {
  switch (route.route) {
    case "inbox_view":
    case "inbox_reply":
    case "inbox_routing_update":
      return {
        kind: "service_effective_access"
      };
    case "tenant_brand_view":
    case "tenant_brand_update":
      return {
        kind: "signed_effective_permission_override",
        permission: "tenant.manage"
      };
    case "org_structure_view":
    case "org_unit_upsert":
    case "work_queue_upsert":
      return {
        kind: "signed_effective_permission_override",
        permission: "employees.manage"
      };
    case "access_decision":
    case "rbac_roles_view":
    case "rbac_role_create":
    case "rbac_role_update":
    case "rbac_role_archive":
    case "rbac_role_restore":
    case "rbac_role_bindings_view":
    case "rbac_role_binding_create":
    case "rbac_role_binding_revoke":
    case "rbac_direct_grants_view":
    case "rbac_direct_grant_create":
    case "rbac_direct_grant_revoke":
      return {
        kind: "signed_effective_permission_override",
        permission: "roles.manage"
      };
    case "channel_catalog_view":
    case "channel_connectors_view":
    case "channel_connector_create":
    case "channel_connector_disable":
    case "channel_connector_delete":
    case "telegram_integration_view":
    case "telegram_integration_update":
    case "telegram_integration_diagnostics":
    case "telegram_integration_webhook_set":
    case "telegram_integration_webhook_delete":
      return {
        kind: "signed_effective_permission_override",
        permission: "modules.manage"
      };
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
        url.searchParams.get("conversationId") ?? undefined,
      queueId: nonEmptyQueryValue(url.searchParams.get("queueId")),
      assignedToMe: url.searchParams.get("assigned") === "me"
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

  if (request.method === "POST" && path === "/internal/v1/access/decision") {
    return {
      route: "access_decision"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/rbac/roles") {
    return {
      route: "rbac_roles_view"
    };
  }

  if (request.method === "POST" && path === "/internal/v1/rbac/roles") {
    return {
      route: "rbac_role_create"
    };
  }

  const roleUpdateMatch = path.match(/^\/internal\/v1\/rbac\/roles\/([^/]+)$/);

  if (request.method === "PATCH" && roleUpdateMatch?.[1]) {
    return {
      route: "rbac_role_update",
      roleId: decodeURIComponent(roleUpdateMatch[1])
    };
  }

  const roleArchiveMatch = path.match(
    /^\/internal\/v1\/rbac\/roles\/([^/]+)\/archive$/
  );

  if (request.method === "POST" && roleArchiveMatch?.[1]) {
    return {
      route: "rbac_role_archive",
      roleId: decodeURIComponent(roleArchiveMatch[1])
    };
  }

  const roleRestoreMatch = path.match(
    /^\/internal\/v1\/rbac\/roles\/([^/]+)\/restore$/
  );

  if (request.method === "POST" && roleRestoreMatch?.[1]) {
    return {
      route: "rbac_role_restore",
      roleId: decodeURIComponent(roleRestoreMatch[1])
    };
  }

  if (request.method === "GET" && path === "/internal/v1/rbac/role-bindings") {
    return {
      route: "rbac_role_bindings_view"
    };
  }

  if (request.method === "POST" && path === "/internal/v1/rbac/role-bindings") {
    return {
      route: "rbac_role_binding_create"
    };
  }

  const roleBindingRevokeMatch = path.match(
    /^\/internal\/v1\/rbac\/role-bindings\/([^/]+)$/
  );

  if (request.method === "DELETE" && roleBindingRevokeMatch?.[1]) {
    return {
      route: "rbac_role_binding_revoke",
      bindingId: decodeURIComponent(roleBindingRevokeMatch[1])
    };
  }

  if (request.method === "GET" && path === "/internal/v1/rbac/direct-grants") {
    return {
      route: "rbac_direct_grants_view"
    };
  }

  if (request.method === "POST" && path === "/internal/v1/rbac/direct-grants") {
    return {
      route: "rbac_direct_grant_create"
    };
  }

  const directGrantRevokeMatch = path.match(
    /^\/internal\/v1\/rbac\/direct-grants\/([^/]+)$/
  );

  if (request.method === "DELETE" && directGrantRevokeMatch?.[1]) {
    return {
      route: "rbac_direct_grant_revoke",
      grantId: decodeURIComponent(directGrantRevokeMatch[1])
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

  if (request.method === "GET" && path === "/internal/v1/channels/catalog") {
    return {
      route: "channel_catalog_view"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/channels/connectors") {
    return {
      route: "channel_connectors_view"
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/channels/connectors"
  ) {
    return {
      route: "channel_connector_create"
    };
  }

  const connectorDisableMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/disable$/
  );

  if (request.method === "POST" && connectorDisableMatch?.[1]) {
    return {
      route: "channel_connector_disable",
      connectorId: decodeURIComponent(connectorDisableMatch[1])
    };
  }

  const connectorDeleteMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)$/
  );

  if (request.method === "DELETE" && connectorDeleteMatch?.[1]) {
    return {
      route: "channel_connector_delete",
      connectorId: decodeURIComponent(connectorDeleteMatch[1])
    };
  }

  if (
    request.method === "GET" &&
    path === "/internal/v1/integrations/telegram"
  ) {
    return {
      route: "telegram_integration_view",
      connectorId: nonEmptyQueryValue(url.searchParams.get("connectorId"))
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
      route: "telegram_integration_diagnostics",
      connectorId: nonEmptyQueryValue(url.searchParams.get("connectorId"))
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/integrations/telegram/webhook"
  ) {
    return {
      route: "telegram_integration_webhook_set",
      connectorId: nonEmptyQueryValue(url.searchParams.get("connectorId"))
    };
  }

  if (
    request.method === "DELETE" &&
    path === "/internal/v1/integrations/telegram/webhook"
  ) {
    return {
      route: "telegram_integration_webhook_delete",
      connectorId: nonEmptyQueryValue(url.searchParams.get("connectorId"))
    };
  }

  return undefined;
}

function assertSessionPermissionHeaderContains(
  session: InternalApiSession,
  permission: Permission
): void {
  if (!session.permissions.includes(permission)) {
    throw new CoreError("permission.denied");
  }
}

function assertSignedEffectivePermissionOverride(
  session: InternalApiSession,
  permission: Permission
): void {
  assertSessionPermissionHeaderContains(session, permission);

  if (
    session.permissions.length !== 1 ||
    session.permissions[0] !== permission
  ) {
    throw new CoreError("permission.denied");
  }
}

function normalizePath(path: string): string {
  if (path.length > 1 && path.endsWith("/")) {
    return path.slice(0, -1);
  }

  return path;
}

function nonEmptyQueryValue(value: string | null): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue === undefined || trimmedValue === ""
    ? undefined
    : trimmedValue;
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
