import type {
  EmployeeId,
  InternalAccessDecisionResponse,
  InternalChannelAuthChallengeResponse,
  InternalChannelCatalogResponse,
  InternalChannelConnectorSummary,
  InternalChannelConnectorsResponse,
  InternalEgressStatusResponse,
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
  InternalSourceCatalogResponse,
  InternalSourceConnectionCreateResponse,
  InternalSourceConnectionsResponse,
  InternalWorkQueue,
  InternalTenantBrandResponse,
  InternalTelegramBotTokenValidateResponse,
  InternalTelegramIntegrationResponse,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import {
  getPlatformErrorDefinition,
  internalChannelAuthChallengeCancelRequestSchema,
  internalChannelAuthChallengeStartRequestSchema,
  internalChannelAuthChallengeSubmitRequestSchema,
  internalChannelConnectorCreateRequestSchema,
  internalChannelConnectorUpdateRequestSchema,
  internalSourceConnectionCreateRequestSchema,
  internalAccessDecisionRequestSchema,
  internalInboxConversationRoutingUpdateRequestSchema,
  internalApiV1Version,
  internalInboxReplyRequestSchema,
  internalOrgUnitUpsertRequestSchema,
  internalRbacDirectGrantCreateRequestSchema,
  internalRbacRoleBindingCreateRequestSchema,
  internalRbacRoleMutationRequestSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramBotTokenValidateRequestSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  internalWorkQueueUpsertRequestSchema,
  listVisibleSourceCatalogItems,
  isPlatformErrorCode,
  sourceCatalogCategoryDefinitions
} from "@hulee/contracts";
import {
  CoreError,
  internalApiSignatureHeader,
  internalApiTimestampHeader,
  isPermission,
  verifyInternalApiSignature,
  type InboxV2FileObjectPin,
  type Permission
} from "@hulee/core";
import type { Logger } from "@hulee/observability";

import type {
  InternalInboxCommandService,
  InternalInboxQueryService
} from "../internal-inbox-service";
import type {
  InternalFileService,
  InternalInboxV2FileDownloadService
} from "../internal-file-service";
import { InboxV2FileDownloadTicketError } from "../inbox-v2-file-download-ticket";
import type { InternalAccessDecisionService } from "../internal-access-decision-service";
import type { InternalEgressStatusService } from "../internal-egress-status-service";
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
  files: InternalFileService;
  fileDownloads?: InternalInboxV2FileDownloadService;
  integrations: InternalIntegrationService;
  tenantSettings: InternalTenantSettingsService;
  orgStructure: InternalOrgStructureService;
  accessDecisions: InternalAccessDecisionService;
  egressStatus: InternalEgressStatusService;
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
      route: "file_content";
      fileId: string;
    }
  | {
      route: "inbox_v2_file_download";
      ticket: string;
    }
  | {
      route: "inbox_v2_file_download_issue";
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
      route: "source_catalog_view";
    }
  | {
      route: "source_connections_view";
    }
  | {
      route: "source_connection_create";
    }
  | {
      route: "channel_connectors_view";
    }
  | {
      route: "channel_connector_create";
    }
  | {
      route: "channel_connector_update";
      connectorId: string;
    }
  | {
      route: "channel_connector_enable";
      connectorId: string;
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
      route: "channel_auth_challenge_start";
      connectorId: string;
    }
  | {
      route: "channel_auth_challenge_view";
      connectorId: string;
      challengeId: string;
    }
  | {
      route: "channel_auth_challenge_submit";
      connectorId: string;
      challengeId: string;
    }
  | {
      route: "channel_auth_challenge_cancel";
      connectorId: string;
      challengeId: string;
    }
  | {
      route: "channel_connector_telegram_view";
      connectorId: string;
    }
  | {
      route: "channel_connector_telegram_token_validate";
    }
  | {
      route: "channel_connector_telegram_update";
      connectorId: string;
    }
  | {
      route: "channel_connector_telegram_diagnostics";
      connectorId: string;
    }
  | {
      route: "channel_connector_telegram_webhook_set";
      connectorId: string;
    }
  | {
      route: "channel_connector_telegram_webhook_delete";
      connectorId: string;
    }
  | {
      route: "egress_status_view";
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
          files: options.files,
          fileDownloads: options.fileDownloads,
          integrations: options.integrations,
          tenantSettings: options.tenantSettings,
          orgStructure: options.orgStructure,
          accessDecisions: options.accessDecisions,
          egressStatus: options.egressStatus,
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
  files: InternalFileService;
  fileDownloads?: InternalInboxV2FileDownloadService;
  integrations: InternalIntegrationService;
  tenantSettings: InternalTenantSettingsService;
  orgStructure: InternalOrgStructureService;
  accessDecisions: InternalAccessDecisionService;
  egressStatus: InternalEgressStatusService;
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

    case "file_content": {
      const file = await input.files.loadFileContent(input.session, {
        fileId: input.route.fileId
      });

      return binaryResponse(200, file.body, {
        "content-type": file.mediaType,
        "content-length": String(file.body.byteLength),
        "content-disposition": contentDispositionHeader(file.fileName),
        "cache-control": "private, max-age=60",
        "x-content-type-options": "nosniff"
      });
    }

    case "inbox_v2_file_download": {
      if (input.fileDownloads === undefined) {
        throw new CoreError(
          "validation.failed",
          "Inbox V2 file downloads are not configured."
        );
      }
      const file = await input.fileDownloads.redeemFileDownload(input.session, {
        ticket: input.route.ticket
      });

      return binaryResponse(200, file.body, {
        "content-type": file.mediaType,
        "content-length": String(file.sizeBytes),
        "content-disposition": contentDispositionHeader(
          file.fileName,
          "attachment"
        ),
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff"
      });
    }

    case "inbox_v2_file_download_issue": {
      if (input.fileDownloads === undefined) {
        throw new CoreError(
          "validation.failed",
          "Inbox V2 file downloads are not configured."
        );
      }
      const request = parseInboxV2FileDownloadIssueRequest(input.request.body);
      const issued = await input.fileDownloads.issueFileDownload(
        input.session,
        request
      );
      return jsonResponse(201, issued);
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

    case "source_catalog_view": {
      const response: InternalSourceCatalogResponse = {
        categories: sourceCatalogCategoryDefinitions,
        sources: listVisibleSourceCatalogItems()
      };

      return jsonResponse(200, response);
    }

    case "source_connections_view": {
      const response: InternalSourceConnectionsResponse =
        await input.integrations.listSourceConnections(input.session);

      return jsonResponse(200, response);
    }

    case "source_connection_create": {
      const request = internalSourceConnectionCreateRequestSchema.parse(
        input.request.body
      );
      const response: InternalSourceConnectionCreateResponse =
        await input.integrations.createSourceConnection(input.session, request);

      return jsonResponse(201, response);
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

    case "channel_connector_update": {
      const request = internalChannelConnectorUpdateRequestSchema.parse(
        input.request.body
      );
      const response: InternalChannelConnectorSummary =
        await input.integrations.updateChannelConnector(input.session, {
          connectorId: input.route.connectorId,
          request
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_enable": {
      const response: InternalChannelConnectorSummary =
        await input.integrations.enableChannelConnector(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
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

    case "channel_auth_challenge_start": {
      const request = internalChannelAuthChallengeStartRequestSchema.parse(
        input.request.body
      );
      const response: InternalChannelAuthChallengeResponse =
        await input.integrations.startChannelAuthChallenge(input.session, {
          connectorId: input.route.connectorId,
          request
        });

      return jsonResponse(201, response);
    }

    case "channel_auth_challenge_view": {
      const response: InternalChannelAuthChallengeResponse =
        await input.integrations.loadChannelAuthChallenge(input.session, {
          connectorId: input.route.connectorId,
          challengeId: input.route.challengeId
        });

      return jsonResponse(200, response);
    }

    case "channel_auth_challenge_submit": {
      const request = internalChannelAuthChallengeSubmitRequestSchema.parse(
        input.request.body
      );
      const response: InternalChannelAuthChallengeResponse =
        await input.integrations.submitChannelAuthChallenge(input.session, {
          connectorId: input.route.connectorId,
          challengeId: input.route.challengeId,
          request
        });

      return jsonResponse(200, response);
    }

    case "channel_auth_challenge_cancel": {
      const request = internalChannelAuthChallengeCancelRequestSchema.parse(
        input.request.body
      );
      const response: InternalChannelAuthChallengeResponse =
        await input.integrations.cancelChannelAuthChallenge(input.session, {
          connectorId: input.route.connectorId,
          challengeId: input.route.challengeId,
          request
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_view": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.loadTelegramIntegration(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_token_validate": {
      const request = internalTelegramBotTokenValidateRequestSchema.parse(
        input.request.body
      );
      const response: InternalTelegramBotTokenValidateResponse =
        await input.integrations.validateTelegramBotToken(
          input.session,
          request
        );

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_update": {
      const request = internalTelegramIntegrationUpdateRequestSchema.parse(
        input.request.body
      );
      assertRouteConnectorMatchesRequest(input.route.connectorId, request);

      const response: InternalTelegramIntegrationResponse =
        await input.integrations.updateTelegramIntegration(
          input.session,
          request
        );

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_diagnostics": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.refreshTelegramDiagnostics(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_webhook_set": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.setTelegramWebhook(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "channel_connector_telegram_webhook_delete": {
      const response: InternalTelegramIntegrationResponse =
        await input.integrations.deleteTelegramWebhook(input.session, {
          connectorId: input.route.connectorId
        });

      return jsonResponse(200, response);
    }

    case "egress_status_view": {
      const response: InternalEgressStatusResponse =
        await input.egressStatus.loadEgressStatus(input.session);

      return jsonResponse(200, response);
    }
  }
}

function assertRouteConnectorMatchesRequest(
  routeConnectorId: string,
  request: { connectorId: string }
): void {
  if (request.connectorId.trim() !== routeConnectorId.trim()) {
    throw new CoreError("validation.failed");
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
    case "file_content":
    case "inbox_v2_file_download":
    case "inbox_v2_file_download_issue":
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
        kind: "service_effective_access"
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
        kind: "service_effective_access"
      };
    case "channel_catalog_view":
    case "source_catalog_view":
    case "source_connections_view":
    case "source_connection_create":
    case "channel_connectors_view":
    case "channel_connector_create":
    case "channel_connector_update":
    case "channel_connector_enable":
    case "channel_connector_disable":
    case "channel_connector_delete":
    case "channel_auth_challenge_start":
    case "channel_auth_challenge_view":
    case "channel_auth_challenge_submit":
    case "channel_auth_challenge_cancel":
    case "channel_connector_telegram_view":
    case "channel_connector_telegram_token_validate":
    case "channel_connector_telegram_update":
    case "channel_connector_telegram_diagnostics":
    case "channel_connector_telegram_webhook_set":
    case "channel_connector_telegram_webhook_delete":
    case "egress_status_view":
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

  if (
    request.method === "GET" &&
    path === "/internal/inbox-v2/files/download"
  ) {
    const ticket = nonEmptyQueryValue(url.searchParams.get("ticket"));
    return ticket === undefined
      ? undefined
      : { route: "inbox_v2_file_download", ticket };
  }

  if (
    request.method === "POST" &&
    path === "/internal/inbox-v2/files/download-tickets"
  ) {
    return { route: "inbox_v2_file_download_issue" };
  }

  if (request.method === "GET" && path === "/internal/v1/tenant/brand") {
    return {
      route: "tenant_brand_view"
    };
  }

  const fileContentMatch = path.match(
    /^\/internal\/v1\/files\/([^/]+)\/content$/
  );

  if (request.method === "GET" && fileContentMatch?.[1]) {
    return {
      route: "file_content",
      fileId: decodeURIComponent(fileContentMatch[1])
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

  if (request.method === "GET" && path === "/internal/v1/sources/catalog") {
    return {
      route: "source_catalog_view"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/sources/connections") {
    return {
      route: "source_connections_view"
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/sources/connections"
  ) {
    return {
      route: "source_connection_create"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/channels/connectors") {
    return {
      route: "channel_connectors_view"
    };
  }

  if (request.method === "GET" && path === "/internal/v1/egress/status") {
    return {
      route: "egress_status_view"
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

  const connectorUpdateMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)$/
  );

  if (request.method === "PATCH" && connectorUpdateMatch?.[1]) {
    return {
      route: "channel_connector_update",
      connectorId: decodeURIComponent(connectorUpdateMatch[1])
    };
  }

  const connectorEnableMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/enable$/
  );

  if (request.method === "POST" && connectorEnableMatch?.[1]) {
    return {
      route: "channel_connector_enable",
      connectorId: decodeURIComponent(connectorEnableMatch[1])
    };
  }

  if (request.method === "POST" && connectorDisableMatch?.[1]) {
    return {
      route: "channel_connector_disable",
      connectorId: decodeURIComponent(connectorDisableMatch[1])
    };
  }

  const authChallengeStartMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/auth-challenges$/
  );

  if (request.method === "POST" && authChallengeStartMatch?.[1]) {
    return {
      route: "channel_auth_challenge_start",
      connectorId: decodeURIComponent(authChallengeStartMatch[1])
    };
  }

  const authChallengeViewMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/auth-challenges\/([^/]+)$/
  );

  if (
    request.method === "GET" &&
    authChallengeViewMatch?.[1] &&
    authChallengeViewMatch[2]
  ) {
    return {
      route: "channel_auth_challenge_view",
      connectorId: decodeURIComponent(authChallengeViewMatch[1]),
      challengeId: decodeURIComponent(authChallengeViewMatch[2])
    };
  }

  const authChallengeSubmitMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/auth-challenges\/([^/]+)\/submit$/
  );

  if (
    request.method === "POST" &&
    authChallengeSubmitMatch?.[1] &&
    authChallengeSubmitMatch[2]
  ) {
    return {
      route: "channel_auth_challenge_submit",
      connectorId: decodeURIComponent(authChallengeSubmitMatch[1]),
      challengeId: decodeURIComponent(authChallengeSubmitMatch[2])
    };
  }

  const authChallengeCancelMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/auth-challenges\/([^/]+)\/cancel$/
  );

  if (
    request.method === "POST" &&
    authChallengeCancelMatch?.[1] &&
    authChallengeCancelMatch[2]
  ) {
    return {
      route: "channel_auth_challenge_cancel",
      connectorId: decodeURIComponent(authChallengeCancelMatch[1]),
      challengeId: decodeURIComponent(authChallengeCancelMatch[2])
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

  const telegramConnectorMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/telegram$/
  );

  if (request.method === "GET" && telegramConnectorMatch?.[1]) {
    return {
      route: "channel_connector_telegram_view",
      connectorId: decodeURIComponent(telegramConnectorMatch[1])
    };
  }

  if (
    request.method === "POST" &&
    path === "/internal/v1/channels/telegram-bot/token/validate"
  ) {
    return {
      route: "channel_connector_telegram_token_validate"
    };
  }

  if (request.method === "PUT" && telegramConnectorMatch?.[1]) {
    return {
      route: "channel_connector_telegram_update",
      connectorId: decodeURIComponent(telegramConnectorMatch[1])
    };
  }

  const telegramDiagnosticsMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/telegram\/diagnostics$/
  );

  if (request.method === "POST" && telegramDiagnosticsMatch?.[1]) {
    return {
      route: "channel_connector_telegram_diagnostics",
      connectorId: decodeURIComponent(telegramDiagnosticsMatch[1])
    };
  }

  const telegramWebhookMatch = path.match(
    /^\/internal\/v1\/channels\/connectors\/([^/]+)\/telegram\/webhook$/
  );

  if (request.method === "POST" && telegramWebhookMatch?.[1]) {
    return {
      route: "channel_connector_telegram_webhook_set",
      connectorId: decodeURIComponent(telegramWebhookMatch[1])
    };
  }

  if (request.method === "DELETE" && telegramWebhookMatch?.[1]) {
    return {
      route: "channel_connector_telegram_webhook_delete",
      connectorId: decodeURIComponent(telegramWebhookMatch[1])
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

function parseInboxV2FileDownloadIssueRequest(body: unknown): Readonly<{
  pin: InboxV2FileObjectPin;
  parentLinkId: string;
}> {
  if (!isStrictRecord(body, ["pin", "parentLinkId"])) {
    throw new CoreError("validation.failed");
  }
  const pin = body.pin;
  if (
    !isStrictRecord(pin, [
      "tenantId",
      "fileId",
      "fileRevision",
      "fileVersionId",
      "objectVersionId"
    ])
  ) {
    throw new CoreError("validation.failed");
  }

  const request = {
    pin: {
      tenantId: boundedOpaqueValue(pin.tenantId),
      fileId: boundedOpaqueValue(pin.fileId),
      fileRevision: boundedOpaqueValue(pin.fileRevision),
      fileVersionId: boundedOpaqueValue(pin.fileVersionId),
      objectVersionId: boundedOpaqueValue(pin.objectVersionId)
    },
    parentLinkId: boundedOpaqueValue(body.parentLinkId)
  };
  return request;
}

function isStrictRecord(
  value: unknown,
  expectedKeys: readonly string[]
): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const keys = Object.keys(value);
  return (
    keys.length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key))
  );
}

function boundedOpaqueValue(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 2_048 ||
    !/\S/u.test(value) ||
    /\p{Cc}/u.test(value)
  ) {
    throw new CoreError("validation.failed");
  }
  return value;
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
  if (error instanceof InboxV2FileDownloadTicketError) {
    // Do not expose whether a ticket was malformed, expired, revoked or bound
    // to another principal.
    return "permission.denied";
  }

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

function binaryResponse(
  status: number,
  body: Uint8Array | AsyncIterable<Uint8Array>,
  headers: Record<string, string>
): ApiHttpResponse {
  return {
    status,
    headers,
    body
  };
}

function contentDispositionHeader(
  fileName: string,
  disposition: "inline" | "attachment" = "inline"
): string {
  const fallback = fileName
    .replace(/[\\"]/g, "_")
    .replace(/[^\x20-\x7E]/g, "_")
    .trim();
  const safeFallback = fallback.length > 0 ? fallback : "download";

  return `${disposition}; filename="${safeFallback}"; filename*=UTF-8''${encodeURIComponent(
    fileName
  )}`;
}

function defaultRequestIdFactory(): string {
  return `internal-api-request-${Date.now()}`;
}
