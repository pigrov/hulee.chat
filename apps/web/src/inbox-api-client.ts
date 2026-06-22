import { loadLocalEnvFile, mergeEnvSources } from "@hulee/config";
import {
  internalInboxReplyResponseSchema,
  internalInboxViewResponseSchema,
  internalTelegramIntegrationResponseSchema,
  internalTelegramIntegrationUpdateRequestSchema,
  type InternalInboxConversation,
  type InternalInboxMessage,
  type InternalInboxReplyResponse,
  type InternalInboxViewResponse,
  type InternalTelegramIntegrationResponse,
  type InternalTelegramIntegrationUpdateRequest
} from "@hulee/contracts";

import { buildInternalApiHeaders } from "./session";

export type InboxConversation = InternalInboxConversation;
export type InboxMessage = InternalInboxMessage;
export type InboxViewModel = InternalInboxViewResponse;
export type TelegramIntegrationViewModel = InternalTelegramIntegrationResponse;

const defaultInternalApiBaseUrl = "http://127.0.0.1:4000";
const localEnv = loadLocalEnvFile();

export async function loadInboxViewModel(input?: {
  selectedConversationId?: string;
}): Promise<InboxViewModel> {
  const url = new URL("/internal/v1/inbox", resolveInternalApiBaseUrl());

  if (input?.selectedConversationId) {
    url.searchParams.set("conversationId", input.selectedConversationId);
  }

  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders()
  });

  if (!response.ok) {
    throw new Error(`Internal inbox API returned HTTP ${response.status}.`);
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
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: {
      ...(await buildInternalApiHeaders()),
      "content-type": "application/json; charset=utf-8"
    },
    body: JSON.stringify({
      text: input.text,
      idempotencyKey: input.idempotencyKey
    })
  });

  if (!response.ok) {
    throw new Error(`Internal reply API returned HTTP ${response.status}.`);
  }

  return internalInboxReplyResponseSchema.parse(await response.json());
}

export async function loadTelegramIntegration(): Promise<TelegramIntegrationViewModel> {
  const url = new URL(
    "/internal/v1/integrations/telegram",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    cache: "no-store",
    headers: await buildInternalApiHeaders()
  });

  if (!response.ok) {
    throw new Error(
      `Internal Telegram integration API returned HTTP ${response.status}.`
    );
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

export async function updateTelegramIntegration(
  input: InternalTelegramIntegrationUpdateRequest
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
      ...(await buildInternalApiHeaders()),
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

export async function refreshTelegramDiagnostics(): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    "/internal/v1/integrations/telegram/diagnostics",
    "Internal Telegram diagnostics API returned"
  );
}

export async function setTelegramWebhook(): Promise<TelegramIntegrationViewModel> {
  return postTelegramIntegrationCommand(
    "/internal/v1/integrations/telegram/webhook",
    "Internal Telegram webhook sync API returned"
  );
}

export async function deleteTelegramWebhook(): Promise<TelegramIntegrationViewModel> {
  const url = new URL(
    "/internal/v1/integrations/telegram/webhook",
    resolveInternalApiBaseUrl()
  );
  const response = await fetch(url, {
    method: "DELETE",
    cache: "no-store",
    headers: await buildInternalApiHeaders()
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
  errorPrefix: string
): Promise<TelegramIntegrationViewModel> {
  const url = new URL(path, resolveInternalApiBaseUrl());
  const response = await fetch(url, {
    method: "POST",
    cache: "no-store",
    headers: await buildInternalApiHeaders()
  });

  if (!response.ok) {
    throw new Error(`${errorPrefix} HTTP ${response.status}.`);
  }

  return internalTelegramIntegrationResponseSchema.parse(await response.json());
}

function resolveInternalApiBaseUrl(): string {
  return (
    mergeEnvSources(localEnv, process.env).HULEE_INTERNAL_API_BASE_URL ??
    defaultInternalApiBaseUrl
  );
}
