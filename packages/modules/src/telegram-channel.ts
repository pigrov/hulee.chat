import type { PlatformErrorCode, TenantId } from "@hulee/contracts";
import { defineModuleManifest } from "@hulee/contracts";
import { z } from "zod";

import { telegramChannelDataGovernance } from "./data-governance";

import type { EgressProfileResolution, EgressRuntime } from "./egress";

export type TelegramBotApiEgressBinding = {
  runtime: EgressRuntime;
  resolution: EgressProfileResolution;
  tenantId: TenantId;
  connectorId: string;
  channelType: string;
  provider: string;
};

export type TelegramBotApiSettings = {
  apiBaseUrl?: string;
  botToken: string;
  egress?: TelegramBotApiEgressBinding;
  httpTimeoutMs?: number;
};

export type TelegramSendMessageInput = {
  chatId: string;
  text: string;
};

export type TelegramSendMessageResult = {
  messageId: string;
  chatId: string;
  raw: Record<string, unknown>;
};

export type TelegramBotIdentity = {
  id: string;
  firstName?: string;
  username?: string;
  raw: Record<string, unknown>;
};

export type TelegramWebhookInfo = {
  url: string;
  pendingUpdateCount: number;
  lastErrorAt?: string;
  lastErrorMessage?: string;
  raw: Record<string, unknown>;
};

export type TelegramUpdate = {
  updateId: number;
  raw: Record<string, unknown>;
};

export type TelegramFileInfo = {
  fileId: string;
  fileUniqueId?: string;
  fileSize?: number;
  filePath: string;
  raw: Record<string, unknown>;
};

export type TelegramGetUpdatesInput = {
  offset?: number;
  limit?: number;
  timeoutSeconds?: number;
  allowedUpdates?: readonly string[];
};

export type TelegramSetWebhookInput = {
  url: string;
  secretToken?: string;
  dropPendingUpdates?: boolean;
};

export type TelegramDeleteWebhookInput = {
  dropPendingUpdates?: boolean;
};

export type TelegramBotApiClient = {
  sendTextMessage(
    input: TelegramSendMessageInput
  ): Promise<TelegramSendMessageResult>;
  getMe(): Promise<TelegramBotIdentity>;
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  getUpdates(input?: TelegramGetUpdatesInput): Promise<TelegramUpdate[]>;
  getFile(fileId: string): Promise<TelegramFileInfo>;
  downloadFile(filePath: string): Promise<Uint8Array>;
  setWebhook(input: TelegramSetWebhookInput): Promise<void>;
  deleteWebhook(input?: TelegramDeleteWebhookInput): Promise<void>;
};

export type TelegramMessageSender = Pick<
  TelegramBotApiClient,
  "sendTextMessage"
>;

export const telegramChannelConfigSchema = z
  .object({
    channelExternalId: z.string().trim().min(1),
    mode: z.enum(["webhook", "polling"]).default("webhook"),
    botTokenSecretRef: z.string().trim().min(1).optional(),
    webhookConnectorId: z.string().trim().min(1).optional(),
    webhookSecretTokenSecretRef: z.string().trim().min(1).optional(),
    outboundEnabled: z.boolean().default(false)
  })
  .strict()
  .refine((config) => !config.outboundEnabled || config.botTokenSecretRef, {
    message: "botTokenSecretRef is required when outbound is enabled.",
    path: ["botTokenSecretRef"]
  });

export type TelegramChannelConfig = z.infer<typeof telegramChannelConfigSchema>;

export class TelegramAdapterError extends Error {
  readonly code: PlatformErrorCode;
  readonly httpStatus?: number;
  readonly method?: string;
  readonly providerDescription?: string;

  constructor(
    code: PlatformErrorCode,
    message: string = code,
    options: {
      httpStatus?: number;
      method?: string;
      providerDescription?: string;
    } = {}
  ) {
    super(message);
    this.name = "TelegramAdapterError";
    this.code = code;
    this.httpStatus = options.httpStatus;
    this.method = options.method;
    this.providerDescription = options.providerDescription;
  }
}

export function buildTelegramProviderFailureOperatorHint(input: {
  error: unknown;
  operation: "diagnostics" | "getUpdates" | "setWebhook" | "deleteWebhook";
}): string {
  const context = telegramOperationContext(input.operation);
  const details = telegramErrorDetails(input.error);
  const normalizedDetails = details.message.toLowerCase();

  if (
    details.httpStatus === 401 ||
    normalizedDetails.includes("unauthorized")
  ) {
    return trimDiagnosticHint(
      `${context} failed because Telegram rejected the bot token. Paste a valid BotFather token, save the channel, then run the check again.`
    );
  }

  if (details.httpStatus === 403 || normalizedDetails.includes("forbidden")) {
    return trimDiagnosticHint(
      `${context} failed because Telegram rejected the bot request. Check that the bot is active and allowed to use the requested operation, then run the check again.`
    );
  }

  if (
    details.httpStatus === 409 ||
    (normalizedDetails.includes("conflict") &&
      (normalizedDetails.includes("webhook") ||
        normalizedDetails.includes("getupdates")))
  ) {
    return trimDiagnosticHint(
      `${context} failed because Telegram polling conflicts with an active webhook or another polling consumer. Delete the webhook, stop the other consumer or switch this channel to webhook mode, then run the check again.`
    );
  }

  if (details.code === "provider.temporary_failure") {
    return trimDiagnosticHint(
      `${context} could not reach Telegram through the provider egress route. Check VPN/Egress health, then run the check again.`
    );
  }

  if (details.message.length > 0) {
    return trimDiagnosticHint(
      `${context} failed: ${details.message}. Check the bot token, Telegram mode and provider settings, then run the check again.`
    );
  }

  return trimDiagnosticHint(
    `${context} failed. Check the bot token, Telegram mode and provider egress health, then run the check again.`
  );
}

function telegramOperationContext(
  operation: "diagnostics" | "getUpdates" | "setWebhook" | "deleteWebhook"
): string {
  switch (operation) {
    case "diagnostics":
      return "Telegram diagnostics";
    case "getUpdates":
      return "Telegram getUpdates";
    case "setWebhook":
      return "Telegram webhook sync";
    case "deleteWebhook":
      return "Telegram webhook deletion";
  }
}

function telegramErrorDetails(error: unknown): {
  code?: PlatformErrorCode;
  httpStatus?: number;
  message: string;
} {
  if (error instanceof TelegramAdapterError) {
    return {
      code: error.code,
      ...(error.httpStatus === undefined
        ? {}
        : { httpStatus: error.httpStatus }),
      message: safeDiagnosticText(
        error.providerDescription ?? error.message,
        220
      )
    };
  }

  if (error instanceof Error) {
    const code =
      "code" in error && isKnownProviderErrorCode(error.code)
        ? error.code
        : undefined;

    return {
      ...(code ? { code } : {}),
      message: safeDiagnosticText(error.message, 220)
    };
  }

  return {
    message: safeDiagnosticText(String(error), 220)
  };
}

function buildTelegramFailureMessage(input: {
  method: string;
  httpStatus: number;
  description: string;
}): string {
  const description = safeDiagnosticText(input.description, 220);

  return description
    ? `Telegram ${input.method} failed with HTTP ${input.httpStatus}: ${description}.`
    : `Telegram ${input.method} failed with HTTP ${input.httpStatus}.`;
}

function safeDiagnosticText(value: unknown, maxLength: number): string {
  if (typeof value !== "string" && typeof value !== "number") {
    return "";
  }

  const text = String(value)
    .replace(/bot\d{5,}:[A-Za-z0-9_-]+/g, "bot<redacted>")
    .replace(/\d{5,}:[A-Za-z0-9_-]{20,}/g, "<redacted-token>")
    .trim();

  if (text.length === 0) {
    return "";
  }

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function trimDiagnosticHint(value: string): string {
  return value.length > 500 ? value.slice(0, 500) : value;
}

function isKnownProviderErrorCode(value: unknown): value is PlatformErrorCode {
  return (
    value === "provider.temporary_failure" ||
    value === "provider.permanent_failure" ||
    value === "validation.failed"
  );
}

export const telegramChannelManifest = defineModuleManifest({
  id: "channel-telegram",
  type: "channel",
  name: "Telegram channel",
  version: "0.0.0",
  capabilities: [],
  configSchema: {
    channelExternalId: "string",
    mode: ["webhook", "polling"],
    botTokenSecretRef: "secret-ref",
    webhookConnectorId: "string",
    webhookSecretTokenSecretRef: "secret-ref",
    outboundEnabled: "boolean"
  },
  secretsSchema: {
    botToken: "string",
    webhookSecretToken: "string"
  },
  uiSlots: [
    {
      id: "telegram-integration-settings",
      slot: "integration.settings.section",
      componentRef: "channel-telegram/settings",
      supportedClients: ["web"],
      order: 100
    }
  ],
  healthChecks: ["telegram.webhook", "telegram.bot_api", "telegram.outbound"],
  dataHandling: "tenant_or_customer_data",
  dataGovernance: telegramChannelDataGovernance
});

export function parseTelegramChannelConfig(
  input: unknown
): TelegramChannelConfig {
  return telegramChannelConfigSchema.parse(input);
}

export function createTelegramBotApiClient(
  settings: TelegramBotApiSettings
): TelegramBotApiClient {
  return {
    async sendTextMessage(input) {
      return sendTelegramTextMessage(settings, input);
    },
    async getMe() {
      return getTelegramBotIdentity(settings);
    },
    async getWebhookInfo() {
      return getTelegramWebhookInfo(settings);
    },
    async getUpdates(input) {
      return getTelegramUpdates(settings, input);
    },
    async getFile(fileId) {
      return getTelegramFile(settings, fileId);
    },
    async downloadFile(filePath) {
      return downloadTelegramFile(settings, filePath);
    },
    async setWebhook(input) {
      await setTelegramWebhook(settings, input);
    },
    async deleteWebhook(input) {
      await deleteTelegramWebhook(settings, input);
    }
  };
}

export async function sendTelegramTextMessage(
  settings: TelegramBotApiSettings,
  input: TelegramSendMessageInput
): Promise<TelegramSendMessageResult> {
  const payload = await requestTelegramJson(settings, "sendMessage", {
    chat_id: input.chatId,
    text: input.text
  });
  const result = asRecord(payload.result);
  const messageId =
    typeof result?.message_id === "number"
      ? String(result.message_id)
      : undefined;
  const chat = asRecord(result?.chat);
  const chatId = typeof chat?.id === "number" ? String(chat.id) : input.chatId;

  if (!messageId) {
    throw new TelegramAdapterError(
      "provider.permanent_failure",
      "Telegram sendMessage response did not include message_id."
    );
  }

  return {
    messageId,
    chatId,
    raw: result ?? {}
  };
}

export async function getTelegramBotIdentity(
  settings: TelegramBotApiSettings
): Promise<TelegramBotIdentity> {
  const payload = await requestTelegramJson(settings, "getMe");
  const result = asRecord(payload.result);
  const id = typeof result?.id === "number" ? String(result.id) : undefined;

  if (!id) {
    throw new TelegramAdapterError(
      "provider.permanent_failure",
      "Telegram getMe response did not include bot id."
    );
  }

  return {
    id,
    firstName:
      typeof result?.first_name === "string" ? result.first_name : undefined,
    username:
      typeof result?.username === "string" ? result.username : undefined,
    raw: result ?? {}
  };
}

export async function getTelegramWebhookInfo(
  settings: TelegramBotApiSettings
): Promise<TelegramWebhookInfo> {
  const payload = await requestTelegramJson(settings, "getWebhookInfo");
  const result = asRecord(payload.result);
  const url = typeof result?.url === "string" ? result.url : "";
  const pendingUpdateCount =
    typeof result?.pending_update_count === "number"
      ? result.pending_update_count
      : 0;
  const lastErrorDate =
    typeof result?.last_error_date === "number"
      ? result.last_error_date
      : undefined;

  return {
    url,
    pendingUpdateCount,
    lastErrorAt:
      lastErrorDate === undefined
        ? undefined
        : new Date(lastErrorDate * 1000).toISOString(),
    lastErrorMessage:
      typeof result?.last_error_message === "string"
        ? result.last_error_message
        : undefined,
    raw: result ?? {}
  };
}

export async function getTelegramUpdates(
  settings: TelegramBotApiSettings,
  input: TelegramGetUpdatesInput = {}
): Promise<TelegramUpdate[]> {
  const payload = await requestTelegramJson(settings, "getUpdates", {
    offset: input.offset,
    limit: input.limit,
    timeout: input.timeoutSeconds,
    allowed_updates: input.allowedUpdates
  });
  const result = Array.isArray(payload.result) ? payload.result : undefined;

  if (!result) {
    throw new TelegramAdapterError(
      "provider.permanent_failure",
      "Telegram getUpdates response did not include an updates array."
    );
  }

  return result.map((update) => {
    const record = asRecord(update);

    if (!record) {
      throw new TelegramAdapterError(
        "provider.permanent_failure",
        "Telegram update was not an object."
      );
    }

    const updateId =
      typeof record.update_id === "number" ? record.update_id : undefined;

    if (updateId === undefined) {
      throw new TelegramAdapterError(
        "provider.permanent_failure",
        "Telegram update did not include update_id."
      );
    }

    return {
      updateId,
      raw: record
    };
  });
}

export async function getTelegramFile(
  settings: TelegramBotApiSettings,
  fileId: string
): Promise<TelegramFileInfo> {
  const payload = await requestTelegramJson(settings, "getFile", {
    file_id: fileId
  });
  const result = asRecord(payload.result);
  const resolvedFileId =
    typeof result?.file_id === "string" ? result.file_id : undefined;
  const filePath =
    typeof result?.file_path === "string" ? result.file_path : undefined;

  if (!result || !resolvedFileId || !filePath) {
    throw new TelegramAdapterError(
      "provider.permanent_failure",
      "Telegram getFile response did not include file_id and file_path."
    );
  }

  return {
    fileId: resolvedFileId,
    fileUniqueId:
      typeof result?.file_unique_id === "string"
        ? result.file_unique_id
        : undefined,
    fileSize:
      typeof result?.file_size === "number" ? result.file_size : undefined,
    filePath,
    raw: result
  };
}

export async function downloadTelegramFile(
  settings: TelegramBotApiSettings,
  filePath: string
): Promise<Uint8Array> {
  assertSafeTelegramFilePath(filePath);

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    settings.httpTimeoutMs ?? 30_000
  );

  try {
    const response = await executeTelegramBotApiOperation(
      settings,
      "downloadFile",
      async () =>
        fetch(buildTelegramFileDownloadUrl(settings, filePath), {
          method: "GET",
          signal: controller.signal
        })
    );

    if (!response.ok) {
      throw new TelegramAdapterError(
        response.status >= 500
          ? "provider.temporary_failure"
          : "provider.permanent_failure",
        `Telegram file download returned HTTP ${response.status}.`,
        {
          httpStatus: response.status,
          method: "downloadFile"
        }
      );
    }

    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    if (error instanceof TelegramAdapterError) {
      throw error;
    }

    throw new TelegramAdapterError(
      "provider.temporary_failure",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeout);
  }
}

export async function setTelegramWebhook(
  settings: TelegramBotApiSettings,
  input: TelegramSetWebhookInput
): Promise<void> {
  await requestTelegramJson(settings, "setWebhook", {
    url: input.url,
    secret_token: input.secretToken,
    drop_pending_updates: input.dropPendingUpdates
  });
}

export async function deleteTelegramWebhook(
  settings: TelegramBotApiSettings,
  input: TelegramDeleteWebhookInput = {}
): Promise<void> {
  await requestTelegramJson(settings, "deleteWebhook", {
    drop_pending_updates: input.dropPendingUpdates
  });
}

async function requestTelegramJson(
  settings: TelegramBotApiSettings,
  method: string,
  body: Record<string, unknown> = {}
): Promise<Record<string, unknown>> {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    settings.httpTimeoutMs ?? 15_000
  );

  try {
    const response = await executeTelegramBotApiOperation(
      settings,
      method,
      async () =>
        fetch(buildTelegramMethodUrl(settings, method), {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify(removeUndefinedValues(body)),
          signal: controller.signal
        })
    );
    const payload = (await response.json().catch(() => ({}))) as unknown;
    const record = asRecord(payload);
    const ok = record?.ok === true;

    if (!response.ok || !ok) {
      const description = safeDiagnosticText(
        typeof record?.description === "string" ? record.description : "",
        220
      );
      const message = buildTelegramFailureMessage({
        method,
        httpStatus: response.status,
        description
      });

      throw new TelegramAdapterError(
        response.status >= 500
          ? "provider.temporary_failure"
          : "provider.permanent_failure",
        message,
        {
          httpStatus: response.status,
          method,
          ...(description ? { providerDescription: description } : {})
        }
      );
    }

    return record;
  } catch (error) {
    if (error instanceof TelegramAdapterError) {
      throw error;
    }

    throw new TelegramAdapterError(
      "provider.temporary_failure",
      error instanceof Error ? error.message : String(error)
    );
  } finally {
    clearTimeout(timeout);
  }
}

async function executeTelegramBotApiOperation<T>(
  settings: TelegramBotApiSettings,
  method: string,
  operation: () => Promise<T>
): Promise<T> {
  if (!settings.egress) {
    return operation();
  }

  return settings.egress.runtime.execute(
    {
      tenantId: settings.egress.tenantId,
      connectorId: settings.egress.connectorId,
      channelType: settings.egress.channelType,
      provider: settings.egress.provider,
      operation: `telegram.bot_api.${method}`,
      resolution: settings.egress.resolution
    },
    operation
  );
}

function removeUndefinedValues(
  input: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  );
}

function buildTelegramMethodUrl(
  settings: TelegramBotApiSettings,
  method: string
): string {
  const apiBaseUrl = (
    settings.apiBaseUrl ?? "https://api.telegram.org"
  ).replace(/\/+$/, "");

  return `${apiBaseUrl}/bot${settings.botToken}/${method}`;
}

function buildTelegramFileDownloadUrl(
  settings: TelegramBotApiSettings,
  filePath: string
): string {
  const apiBaseUrl = (
    settings.apiBaseUrl ?? "https://api.telegram.org"
  ).replace(/\/+$/, "");
  const encodedPath = filePath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return `${apiBaseUrl}/file/bot${settings.botToken}/${encodedPath}`;
}

function assertSafeTelegramFilePath(filePath: string): void {
  if (
    filePath.trim().length === 0 ||
    filePath.startsWith("/") ||
    filePath.includes("..") ||
    filePath.includes("\\")
  ) {
    throw new TelegramAdapterError(
      "provider.permanent_failure",
      "Telegram file_path is not a safe relative path."
    );
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
