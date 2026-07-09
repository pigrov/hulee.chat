import {
  internalChannelAuthChallengeResponseSchema,
  internalChannelAuthChallengeStartRequestSchema,
  internalChannelAuthChallengeSubmitRequestSchema,
  internalChannelConnectorCreateRequestSchema,
  internalChannelConnectorUpdateRequestSchema,
  internalChannelConnectorSummarySchema,
  internalChannelCatalogResponseSchema,
  internalChannelConnectorsResponseSchema,
  internalEgressStatusResponseSchema,
  internalInboxConversationRoutingUpdateRequestSchema,
  internalInboxConversationRoutingUpdateResponseSchema,
  internalInboxReplyResponseSchema,
  internalInboxViewResponseSchema,
  internalRbacDirectGrantCreateRequestSchema,
  internalRbacDirectGrantResponseSchema,
  internalRbacDirectGrantsResponseSchema,
  internalRbacRevokeResponseSchema,
  internalRbacRoleBindingCreateRequestSchema,
  internalRbacRoleBindingResponseSchema,
  internalRbacRoleBindingsResponseSchema,
  internalRbacRoleMutationRequestSchema,
  internalRbacRoleResponseSchema,
  internalRbacRolesResponseSchema,
  internalSourceCatalogResponseSchema,
  internalSourceConnectionCreateRequestSchema,
  internalSourceConnectionCreateResponseSchema,
  internalSourceConnectionsResponseSchema,
  internalTenantBrandResponseSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramBotTokenValidateRequestSchema,
  internalTelegramBotTokenValidateResponseSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  type InternalChannelCatalogResponse,
  type InternalChannelAuthChallengeResponse,
  type InternalChannelAuthChallengeStartRequest,
  type InternalChannelAuthChallengeSubmitRequest,
  type InternalChannelConnectorCreateRequest,
  type InternalChannelConnectorUpdateRequest,
  type InternalChannelConnectorSummary,
  type InternalChannelConnectorsResponse,
  type InternalEgressStatusResponse,
  type InternalInboxConversation,
  type InternalInboxConversationRoutingUpdateRequest,
  type InternalInboxConversationRoutingUpdateResponse,
  type InternalInboxMessage,
  type InternalInboxReplyResponse,
  type InternalInboxViewResponse,
  type InternalRbacDirectGrantCreateRequest,
  type InternalRbacDirectGrantResponse,
  type InternalRbacDirectGrantsResponse,
  type InternalRbacRevokeResponse,
  type InternalRbacRoleBindingCreateRequest,
  type InternalRbacRoleBindingResponse,
  type InternalRbacRoleBindingsResponse,
  type InternalRbacRoleMutationRequest,
  type InternalRbacRoleResponse,
  type InternalRbacRolesResponse,
  type InternalSourceCatalogResponse,
  type InternalSourceConnectionCreateRequest,
  type InternalSourceConnectionCreateResponse,
  type InternalSourceConnectionsResponse,
  type InternalTenantBrandResponse,
  type InternalTenantBrandUpdateRequest,
  type InternalTelegramBotTokenValidateRequest,
  type InternalTelegramBotTokenValidateResponse,
  type InternalTelegramIntegrationResponse,
  type InternalTelegramIntegrationUpdateRequest
} from "@hulee/contracts";
import { CoreError, type Permission } from "@hulee/core";

import { buildInternalApiHeaders } from "./session";
import { throwInternalApiErrorResponse } from "./internal-api-errors";
import { resolveWebConfig } from "./web-config";

export type InboxConversation = InternalInboxConversation;
export type InboxMessage = InternalInboxMessage;
export type InboxViewModel = InternalInboxViewResponse;
export type TenantBrandViewModel = InternalTenantBrandResponse;
export type ChannelCatalogViewModel = InternalChannelCatalogResponse;
export type SourceCatalogViewModel = InternalSourceCatalogResponse;
export type SourceConnectionsViewModel = InternalSourceConnectionsResponse;
export type SourceConnectionCreateViewModel =
  InternalSourceConnectionCreateResponse;
export type ChannelAuthChallengeViewModel =
  InternalChannelAuthChallengeResponse;
export type ChannelConnectorsViewModel = InternalChannelConnectorsResponse;
export type ChannelConnectorViewModel = InternalChannelConnectorSummary;
export type EgressStatusViewModel = InternalEgressStatusResponse;
export type TelegramIntegrationViewModel = InternalTelegramIntegrationResponse;
export type TelegramBotTokenValidationViewModel =
  InternalTelegramBotTokenValidateResponse;
export type RbacRolesViewModel = InternalRbacRolesResponse;
export type RbacRoleBindingsViewModel = InternalRbacRoleBindingsResponse;
export type RbacDirectGrantsViewModel = InternalRbacDirectGrantsResponse;
export type InternalApiAccessOptions<
  TPermission extends Permission = Permission
> = {
  readonly effectivePermissionOverride: TPermission;
};

export async function loadInboxViewModel(input?: {
  selectedConversationId?: string;
  queueId?: string;
  assignedToMe?: boolean;
}): Promise<InboxViewModel> {
  const url = new URL("/internal/v1/inbox", resolveInternalApiBaseUrl());

  if (input?.selectedConversationId) {
    url.searchParams.set("conversationId", input.selectedConversationId);
  }

  if (input?.queueId) {
    url.searchParams.set("queueId", input.queueId);
  }

  if (input?.assignedToMe === true) {
    url.searchParams.set("assigned", "me");
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url)
    })
  });

  if (!response.ok) {
    await throwInternalApiErrorResponse({
      response,
      message: "Internal inbox API returned"
    });
  }

  return internalInboxViewResponseSchema.parse(await response.json());
}

export async function sendInboxReply(input: {
  conversationId: string;
  text: string;
  idempotencyKey?: string;
}): Promise<InternalInboxReplyResponse> {
  const url = new URL(
    `/internal/v1/inbox/conversations/${encodeURIComponent(
      input.conversationId
    )}/replies`,
    resolveInternalApiBaseUrl()
  );
  const body = {
    text: input.text,
    idempotencyKey: input.idempotencyKey
  };
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "POST",
        path: internalPath(url),
        body
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    await throwInternalApiErrorResponse({
      response,
      message: "Internal reply API returned"
    });
  }

  return internalInboxReplyResponseSchema.parse(await response.json());
}

export async function updateInboxConversationRouting(input: {
  conversationId: string;
  request: InternalInboxConversationRoutingUpdateRequest;
}): Promise<InternalInboxConversationRoutingUpdateResponse> {
  const request = internalInboxConversationRoutingUpdateRequestSchema.parse(
    input.request
  );
  const url = new URL(
    `/internal/v1/inbox/conversations/${encodeURIComponent(
      input.conversationId
    )}/routing`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "PATCH",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "PATCH",
        path: internalPath(url),
        body: request
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    await throwInternalApiErrorResponse({
      response,
      message: "Internal conversation routing API returned"
    });
  }

  return internalInboxConversationRoutingUpdateResponseSchema.parse(
    await response.json()
  );
}

export async function loadRbacRoles(
  options: InternalApiAccessOptions<"roles.manage">
): Promise<RbacRolesViewModel> {
  return requestInternalApiJson({
    method: "GET",
    path: "/internal/v1/rbac/roles",
    schema: internalRbacRolesResponseSchema,
    errorPrefix: "Internal RBAC roles API returned",
    options,
    permission: "roles.manage"
  });
}

export async function createRbacRole(
  input: InternalRbacRoleMutationRequest,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRoleResponse> {
  return requestInternalApiJson({
    method: "POST",
    path: "/internal/v1/rbac/roles",
    body: internalRbacRoleMutationRequestSchema.parse(input),
    schema: internalRbacRoleResponseSchema,
    errorPrefix: "Internal RBAC role create API returned",
    options,
    permission: "roles.manage"
  });
}

export async function updateRbacRole(
  roleId: string,
  input: InternalRbacRoleMutationRequest,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRoleResponse> {
  return requestInternalApiJson({
    method: "PATCH",
    path: `/internal/v1/rbac/roles/${encodeURIComponent(roleId)}`,
    body: internalRbacRoleMutationRequestSchema.parse(input),
    schema: internalRbacRoleResponseSchema,
    errorPrefix: "Internal RBAC role update API returned",
    options,
    permission: "roles.manage"
  });
}

export async function archiveRbacRole(
  roleId: string,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRoleResponse> {
  return requestInternalApiJson({
    method: "POST",
    path: `/internal/v1/rbac/roles/${encodeURIComponent(roleId)}/archive`,
    schema: internalRbacRoleResponseSchema,
    errorPrefix: "Internal RBAC role archive API returned",
    options,
    permission: "roles.manage"
  });
}

export async function restoreRbacRole(
  roleId: string,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRoleResponse> {
  return requestInternalApiJson({
    method: "POST",
    path: `/internal/v1/rbac/roles/${encodeURIComponent(roleId)}/restore`,
    schema: internalRbacRoleResponseSchema,
    errorPrefix: "Internal RBAC role restore API returned",
    options,
    permission: "roles.manage"
  });
}

export async function loadRbacRoleBindings(
  options: InternalApiAccessOptions<"roles.manage">
): Promise<RbacRoleBindingsViewModel> {
  return requestInternalApiJson({
    method: "GET",
    path: "/internal/v1/rbac/role-bindings",
    schema: internalRbacRoleBindingsResponseSchema,
    errorPrefix: "Internal RBAC role bindings API returned",
    options,
    permission: "roles.manage"
  });
}

export async function createRbacRoleBinding(
  input: InternalRbacRoleBindingCreateRequest,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRoleBindingResponse> {
  return requestInternalApiJson({
    method: "POST",
    path: "/internal/v1/rbac/role-bindings",
    body: internalRbacRoleBindingCreateRequestSchema.parse(input),
    schema: internalRbacRoleBindingResponseSchema,
    errorPrefix: "Internal RBAC role binding create API returned",
    options,
    permission: "roles.manage"
  });
}

export async function revokeRbacRoleBinding(
  bindingId: string,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRevokeResponse> {
  return requestInternalApiJson({
    method: "DELETE",
    path: `/internal/v1/rbac/role-bindings/${encodeURIComponent(bindingId)}`,
    schema: internalRbacRevokeResponseSchema,
    errorPrefix: "Internal RBAC role binding revoke API returned",
    options,
    permission: "roles.manage"
  });
}

export async function loadRbacDirectGrants(
  options: InternalApiAccessOptions<"roles.manage">
): Promise<RbacDirectGrantsViewModel> {
  return requestInternalApiJson({
    method: "GET",
    path: "/internal/v1/rbac/direct-grants",
    schema: internalRbacDirectGrantsResponseSchema,
    errorPrefix: "Internal RBAC direct grants API returned",
    options,
    permission: "roles.manage"
  });
}

export async function createRbacDirectGrant(
  input: InternalRbacDirectGrantCreateRequest,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacDirectGrantResponse> {
  return requestInternalApiJson({
    method: "POST",
    path: "/internal/v1/rbac/direct-grants",
    body: internalRbacDirectGrantCreateRequestSchema.parse(input),
    schema: internalRbacDirectGrantResponseSchema,
    errorPrefix: "Internal RBAC direct grant create API returned",
    options,
    permission: "roles.manage"
  });
}

export async function revokeRbacDirectGrant(
  grantId: string,
  options: InternalApiAccessOptions<"roles.manage">
): Promise<InternalRbacRevokeResponse> {
  return requestInternalApiJson({
    method: "DELETE",
    path: `/internal/v1/rbac/direct-grants/${encodeURIComponent(grantId)}`,
    schema: internalRbacRevokeResponseSchema,
    errorPrefix: "Internal RBAC direct grant revoke API returned",
    options,
    permission: "roles.manage"
  });
}

export async function loadTenantBrand(
  options: InternalApiAccessOptions<"tenant.manage">
): Promise<TenantBrandViewModel> {
  const url = new URL("/internal/v1/tenant/brand", resolveInternalApiBaseUrl());
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "tenant.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal tenant brand API returned HTTP ${response.status}.`
    );
  }

  return internalTenantBrandResponseSchema.parse(await response.json());
}

export async function updateTenantBrand(
  input: InternalTenantBrandUpdateRequest,
  options: InternalApiAccessOptions<"tenant.manage">
): Promise<TenantBrandViewModel> {
  const request = internalTenantBrandUpdateRequestSchema.parse(input);
  const url = new URL("/internal/v1/tenant/brand", resolveInternalApiBaseUrl());
  const response = await fetch(url, {
    method: "PUT",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "PUT",
        path: internalPath(url),
        body: request,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          options,
          "tenant.manage"
        )
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    await throwInternalApiErrorResponse({
      response,
      message: "Internal tenant brand update API returned"
    });
  }

  return internalTenantBrandResponseSchema.parse(await response.json());
}

export async function loadChannelCatalog(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelCatalogViewModel> {
  const url = new URL(
    "/internal/v1/channels/catalog",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel catalog API returned HTTP ${response.status}.`
    );
  }

  return internalChannelCatalogResponseSchema.parse(await response.json());
}

export async function loadSourceCatalog(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<SourceCatalogViewModel> {
  const url = new URL(
    "/internal/v1/sources/catalog",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal source catalog API returned HTTP ${response.status}.`
    );
  }

  return internalSourceCatalogResponseSchema.parse(await response.json());
}

export async function loadSourceConnections(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<SourceConnectionsViewModel> {
  return requestInternalApiJson({
    method: "GET",
    path: "/internal/v1/sources/connections",
    schema: internalSourceConnectionsResponseSchema,
    errorPrefix: "Internal source connections API returned",
    options,
    permission: "modules.manage"
  });
}

export async function createSourceConnection(
  input: InternalSourceConnectionCreateRequest,
  options: InternalApiAccessOptions<"modules.manage">
): Promise<SourceConnectionCreateViewModel> {
  const request = internalSourceConnectionCreateRequestSchema.parse(input);

  return requestInternalApiJson({
    method: "POST",
    path: "/internal/v1/sources/connections",
    body: request,
    schema: internalSourceConnectionCreateResponseSchema,
    errorPrefix: "Internal source connection create API returned",
    options,
    permission: "modules.manage"
  });
}

export async function loadChannelConnectors(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorsViewModel> {
  const url = new URL(
    "/internal/v1/channels/connectors",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel connectors API returned HTTP ${response.status}.`
    );
  }

  return internalChannelConnectorsResponseSchema.parse(await response.json());
}

export async function loadEgressStatus(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<EgressStatusViewModel> {
  return requestInternalApiJson({
    method: "GET",
    path: "/internal/v1/egress/status",
    schema: internalEgressStatusResponseSchema,
    errorPrefix: "Internal egress status API returned",
    options,
    permission: "modules.manage"
  });
}

export async function createChannelConnector(
  input: InternalChannelConnectorCreateRequest,
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorViewModel> {
  const request = internalChannelConnectorCreateRequestSchema.parse(input);
  const url = new URL(
    "/internal/v1/channels/connectors",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "POST",
        path: internalPath(url),
        body: request,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          options,
          "modules.manage"
        )
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel connector create API returned HTTP ${response.status}.`
    );
  }

  return internalChannelConnectorSummarySchema.parse(await response.json());
}

export async function updateChannelConnector(
  input: {
    connectorId: string;
    request: InternalChannelConnectorUpdateRequest;
  },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorViewModel> {
  const connectorId = input.connectorId.trim();
  const request = internalChannelConnectorUpdateRequestSchema.parse(
    input.request
  );

  return requestInternalApiJson({
    method: "PATCH",
    path: `/internal/v1/channels/connectors/${encodeURIComponent(connectorId)}`,
    body: request,
    schema: internalChannelConnectorSummarySchema,
    errorPrefix: "Internal channel connector update API returned",
    options,
    permission: "modules.manage"
  });
}

export async function disableChannelConnector(
  input: { connectorId: string },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorViewModel> {
  const connectorId = input.connectorId.trim();
  const url = new URL(
    `/internal/v1/channels/connectors/${encodeURIComponent(
      connectorId
    )}/disable`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "POST",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel connector disable API returned HTTP ${response.status}.`
    );
  }

  return internalChannelConnectorSummarySchema.parse(await response.json());
}

export async function enableChannelConnector(
  input: { connectorId: string },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorViewModel> {
  const connectorId = input.connectorId.trim();
  const url = new URL(
    `/internal/v1/channels/connectors/${encodeURIComponent(
      connectorId
    )}/enable`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "POST",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel connector enable API returned HTTP ${response.status}.`
    );
  }

  return internalChannelConnectorSummarySchema.parse(await response.json());
}

export async function deleteChannelConnector(
  input: { connectorId: string },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelConnectorViewModel> {
  const connectorId = input.connectorId.trim();
  const url = new URL(
    `/internal/v1/channels/connectors/${encodeURIComponent(connectorId)}`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "DELETE",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "DELETE",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel connector delete API returned HTTP ${response.status}.`
    );
  }

  return internalChannelConnectorSummarySchema.parse(await response.json());
}

export async function startChannelAuthChallenge(
  input: {
    connectorId: string;
    request: InternalChannelAuthChallengeStartRequest;
  },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelAuthChallengeViewModel> {
  const connectorId = input.connectorId.trim();
  const request = internalChannelAuthChallengeStartRequestSchema.parse(
    input.request
  );
  const url = channelAuthChallengeCollectionUrl(connectorId);
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "POST",
        path: internalPath(url),
        body: request,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          options,
          "modules.manage"
        )
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel auth challenge start API returned HTTP ${response.status}.`
    );
  }

  return internalChannelAuthChallengeResponseSchema.parse(
    await response.json()
  );
}

export async function loadChannelAuthChallenge(
  input: { connectorId: string; challengeId: string },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelAuthChallengeViewModel> {
  const url = channelAuthChallengeItemUrl(input.connectorId, input.challengeId);
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel auth challenge load API returned HTTP ${response.status}.`
    );
  }

  return internalChannelAuthChallengeResponseSchema.parse(
    await response.json()
  );
}

export async function submitChannelAuthChallenge(
  input: {
    connectorId: string;
    challengeId: string;
    request: InternalChannelAuthChallengeSubmitRequest;
  },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelAuthChallengeViewModel> {
  const request = internalChannelAuthChallengeSubmitRequestSchema.parse(
    input.request
  );
  const url = new URL(
    `${channelAuthChallengeItemPath(input.connectorId, input.challengeId)}/submit`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "POST",
        path: internalPath(url),
        body: request,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          options,
          "modules.manage"
        )
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel auth challenge submit API returned HTTP ${response.status}.`
    );
  }

  return internalChannelAuthChallengeResponseSchema.parse(
    await response.json()
  );
}

export async function cancelChannelAuthChallenge(
  input: { connectorId: string; challengeId: string },
  options: InternalApiAccessOptions<"modules.manage">
): Promise<ChannelAuthChallengeViewModel> {
  const url = new URL(
    `${channelAuthChallengeItemPath(input.connectorId, input.challengeId)}/cancel`,
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "POST",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal channel auth challenge cancel API returned HTTP ${response.status}.`
    );
  }

  return internalChannelAuthChallengeResponseSchema.parse(
    await response.json()
  );
}

export async function loadTelegramIntegration(
  options: InternalApiAccessOptions<"modules.manage">,
  input: { connectorId: string }
): Promise<TelegramIntegrationViewModel> {
  const url = telegramConnectorUrl(input.connectorId);

  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "GET",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal Telegram integration API returned HTTP ${response.status}.`
    );
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

export async function updateTelegramIntegration(
  input: InternalTelegramIntegrationUpdateRequest,
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  const request = internalTelegramIntegrationUpdateRequestSchema.parse(input);
  const url = telegramConnectorUrl(request.connectorId);
  const response = await fetch(url, {
    method: "PUT",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: "PUT",
        path: internalPath(url),
        body: request,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          options,
          "modules.manage"
        )
      })),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(request)
  });

  if (!response.ok) {
    throw new Error(
      `Internal Telegram integration update API returned HTTP ${response.status}.`
    );
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

export async function validateTelegramBotToken(
  input: InternalTelegramBotTokenValidateRequest,
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramBotTokenValidationViewModel> {
  const request = internalTelegramBotTokenValidateRequestSchema.parse(input);

  return requestInternalApiJson({
    method: "POST",
    path: "/internal/v1/channels/telegram-bot/token/validate",
    body: request,
    schema: internalTelegramBotTokenValidateResponseSchema,
    errorPrefix: "Internal Telegram bot token validation API returned",
    options,
    permission: "modules.manage"
  });
}

export async function refreshTelegramDiagnostics(
  options: InternalApiAccessOptions<"modules.manage">,
  input: { connectorId: string }
): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    `${telegramConnectorPath(input.connectorId)}/diagnostics`,
    "Internal Telegram diagnostics API returned",
    options
  );
}

export async function setTelegramWebhook(
  options: InternalApiAccessOptions<"modules.manage">,
  input: { connectorId: string }
): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    `${telegramConnectorPath(input.connectorId)}/webhook`,
    "Internal Telegram webhook sync API returned",
    options
  );
}

export async function deleteTelegramWebhook(
  options: InternalApiAccessOptions<"modules.manage">,
  input: { connectorId: string }
): Promise<TelegramIntegrationViewModel> {
  const url = new URL(
    `${telegramConnectorPath(input.connectorId)}/webhook`,
    resolveInternalApiBaseUrl()
  );

  const response = await fetch(url, {
    method: "DELETE",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "DELETE",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(
      `Internal Telegram webhook delete API returned HTTP ${response.status}.`
    );
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

async function postTelegramIntegrationCommand(
  path: string,
  errorPrefix: string,
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  const url = new URL(path, resolveInternalApiBaseUrl());

  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: await buildInternalApiHeaders({
      method: "POST",
      path: internalPath(url),
      effectivePermissionOverride: requireEffectivePermissionOverride(
        options,
        "modules.manage"
      )
    })
  });

  if (!response.ok) {
    throw new Error(`${errorPrefix} HTTP ${response.status}.`);
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

function channelAuthChallengeCollectionUrl(connectorId: string): URL {
  return new URL(
    `/internal/v1/channels/connectors/${encodeURIComponent(
      connectorId.trim()
    )}/auth-challenges`,
    resolveInternalApiBaseUrl()
  );
}

function channelAuthChallengeItemUrl(
  connectorId: string,
  challengeId: string
): URL {
  return new URL(
    channelAuthChallengeItemPath(connectorId, challengeId),
    resolveInternalApiBaseUrl()
  );
}

function channelAuthChallengeItemPath(
  connectorId: string,
  challengeId: string
): string {
  return `/internal/v1/channels/connectors/${encodeURIComponent(
    connectorId.trim()
  )}/auth-challenges/${encodeURIComponent(challengeId.trim())}`;
}

function telegramConnectorUrl(connectorId: string): URL {
  return new URL(
    telegramConnectorPath(connectorId),
    resolveInternalApiBaseUrl()
  );
}

function telegramConnectorPath(connectorId: string): string {
  return `/internal/v1/channels/connectors/${encodeURIComponent(
    connectorId.trim()
  )}/telegram`;
}

type InternalApiResponseSchema<TResponse> = {
  parse(value: unknown): TResponse;
};

async function requestInternalApiJson<
  TResponse,
  TPermission extends Permission
>(input: {
  readonly method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly schema: InternalApiResponseSchema<TResponse>;
  readonly errorPrefix: string;
  readonly options: InternalApiAccessOptions<TPermission>;
  readonly permission: TPermission;
}): Promise<TResponse> {
  const url = new URL(input.path, resolveInternalApiBaseUrl());
  const body =
    input.body === undefined ? undefined : JSON.stringify(input.body);
  const response = await fetch(url, {
    method: input.method,
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders({
        method: input.method,
        path: internalPath(url),
        body: input.body,
        effectivePermissionOverride: requireEffectivePermissionOverride(
          input.options,
          input.permission
        )
      })),
      ...(body === undefined
        ? {}
        : { "content-type": "application/json; charset=utf-8" })
    },
    body
  });

  if (!response.ok) {
    await throwInternalApiErrorResponse({
      response,
      message: input.errorPrefix
    });
  }

  return input.schema.parse(await response.json());
}

function resolveInternalApiBaseUrl(): string {
  return resolveWebConfig().internalApiBaseUrl;
}

function internalPath(url: URL): string {
  return `${url.pathname}${url.search}`;
}

function requireEffectivePermissionOverride<TPermission extends Permission>(
  options: InternalApiAccessOptions<TPermission> | undefined,
  permission: TPermission
): TPermission {
  if (options?.effectivePermissionOverride !== permission) {
    throw new CoreError("permission.denied");
  }

  return permission;
}
