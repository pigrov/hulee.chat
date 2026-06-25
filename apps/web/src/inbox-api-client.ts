import {
  internalInboxConversationRoutingUpdateRequestSchema,
  internalInboxConversationRoutingUpdateResponseSchema,
  internalInboxReplyResponseSchema,
  internalInboxViewResponseSchema,
  internalTenantBrandResponseSchema,
  internalTenantBrandUpdateRequestSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  type InternalInboxConversation,
  type InternalInboxConversationRoutingUpdateRequest,
  type InternalInboxConversationRoutingUpdateResponse,
  type InternalInboxMessage,
  type InternalInboxReplyResponse,
  type InternalInboxViewResponse,
  type InternalTenantBrandResponse,
  type InternalTenantBrandUpdateRequest,
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
export type TelegramIntegrationViewModel = InternalTelegramIntegrationResponse;
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
    throw new Error(
      `Internal tenant brand update API returned HTTP ${response.status}.`
    );
  }

  return internalTenantBrandResponseSchema.parse(await response.json());
}

export async function loadTelegramIntegration(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  const url = new URL(
    "/internal/v1/integrations/telegram",
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
  const url = new URL(
    "/internal/v1/integrations/telegram",
    resolveInternalApiBaseUrl()
  );
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

export async function refreshTelegramDiagnostics(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    "/internal/v1/integrations/telegram/diagnostics",
    "Internal Telegram diagnostics API returned",
    options
  );
}

export async function setTelegramWebhook(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    "/internal/v1/integrations/telegram/webhook",
    "Internal Telegram webhook sync API returned",
    options
  );
}

export async function deleteTelegramWebhook(
  options: InternalApiAccessOptions<"modules.manage">
): Promise<TelegramIntegrationViewModel> {
  const url = new URL(
    "/internal/v1/integrations/telegram/webhook",
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
