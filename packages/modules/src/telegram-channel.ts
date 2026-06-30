import type {
  AdapterHealth,
  ChannelAdapter,
  DeliveryResult,
  ModuleManifest,
  NormalizedAttachment,
  NormalizedIncomingMessage,
  NormalizedOutgoingMessage,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { z } from "zod";

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

  constructor(code: PlatformErrorCode, message: string = code) {
    super(message);
    this.name = "TelegramAdapterError";
    this.code = code;
  }
}

const telegramUserSchema = z
  .object({
    id: z.number().int(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional()
  })
  .passthrough();

const telegramChatSchema = z
  .object({
    id: z.number().int(),
    type: z.string(),
    title: z.string().optional(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional()
  })
  .passthrough();

const telegramPhotoSizeSchema = z
  .object({
    file_id: z.string().trim().min(1),
    file_unique_id: z.string().optional(),
    width: z.number().int().optional(),
    height: z.number().int().optional(),
    file_size: z.number().int().nonnegative().optional()
  })
  .passthrough();

const telegramDocumentSchema = z
  .object({
    file_id: z.string().trim().min(1),
    file_unique_id: z.string().optional(),
    file_name: z.string().optional(),
    mime_type: z.string().optional(),
    file_size: z.number().int().nonnegative().optional()
  })
  .passthrough();

const telegramMessageSchema = z
  .object({
    message_id: z.number().int(),
    date: z.number().int(),
    chat: telegramChatSchema,
    from: telegramUserSchema.optional(),
    text: z.string().optional(),
    caption: z.string().optional(),
    photo: z.array(telegramPhotoSizeSchema).optional(),
    document: telegramDocumentSchema.optional()
  })
  .passthrough();

export const telegramChannelInboundEnvelopeSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    channelExternalId: z.string().trim().min(1),
    update: z
      .object({
        update_id: z.number().int().optional(),
        message: telegramMessageSchema.optional(),
        edited_message: telegramMessageSchema.optional(),
        channel_post: telegramMessageSchema.optional(),
        edited_channel_post: telegramMessageSchema.optional()
      })
      .passthrough()
  })
  .strict();

export type TelegramChannelInboundEnvelope = z.infer<
  typeof telegramChannelInboundEnvelopeSchema
>;

export const telegramChannelManifest = {
  id: "channel-telegram",
  type: "channel",
  name: "Telegram channel",
  version: "0.0.0",
  capabilities: [
    "channel.inbound",
    "channel.outbound",
    "channel.attachments.metadata"
  ],
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
  events: ["message.received", "message.sent"],
  jobs: [
    "telegram.inbound_sweep",
    "telegram.outbound_dispatch",
    "telegram.polling"
  ],
  uiSlots: [
    {
      id: "telegram-integration-settings",
      slot: "integration.settings.section",
      componentRef: "channel-telegram/settings",
      supportedClients: ["web"],
      order: 100
    },
    {
      id: "telegram-inbox-sidebar",
      slot: "inbox.sidebar.section",
      componentRef: "channel-telegram/inbox-sidebar",
      supportedClients: ["web"],
      order: 100
    }
  ],
  healthChecks: ["telegram.webhook", "telegram.bot_api", "telegram.outbound"]
} satisfies ModuleManifest;

export function parseTelegramChannelConfig(
  input: unknown
): TelegramChannelConfig {
  return telegramChannelConfigSchema.parse(input);
}

export function normalizeTelegramIncomingMessage(
  input: unknown
): NormalizedIncomingMessage {
  const envelope = telegramChannelInboundEnvelopeSchema.parse(input);
  const message = extractTelegramMessage(envelope.update);
  const text = message.text ?? message.caption;
  const attachments = extractTelegramAttachments(message);

  if (
    (text === undefined || text.trim().length === 0) &&
    attachments.length === 0
  ) {
    throw new TelegramAdapterError(
      "validation.failed",
      "Telegram update does not contain text or supported attachments."
    );
  }

  const sender = message.from;
  const clientExternalId = sender
    ? `telegram-user:${sender.id}`
    : `telegram-chat:${message.chat.id}`;
  const providerMessageId = `${message.chat.id}:${message.message_id}`;

  return {
    tenantId: envelope.tenantId as TenantId,
    providerMessageId,
    channelExternalId: envelope.channelExternalId,
    clientExternalId,
    clientDisplayName: buildTelegramDisplayName(sender ?? message.chat),
    text,
    attachments,
    occurredAt: new Date(message.date * 1000).toISOString(),
    idempotencyKey: [
      "telegram",
      envelope.channelExternalId,
      envelope.update.update_id ?? "no-update-id",
      providerMessageId
    ].join(":")
  };
}

export function createTelegramChannelAdapter(input?: {
  botApiClient?: TelegramMessageSender;
  now?: () => Date;
}): ChannelAdapter {
  return {
    manifest: telegramChannelManifest,
    async normalizeIncoming(rawInput) {
      return normalizeTelegramIncomingMessage(rawInput);
    },
    async sendMessage(
      message: NormalizedOutgoingMessage
    ): Promise<DeliveryResult> {
      const chatId = resolveTelegramChatId(message.clientExternalId);

      if (!input?.botApiClient || !message.text || !chatId) {
        return {
          status: "failed",
          errorCode: "provider.permanent_failure",
          retryability: "not_retryable"
        };
      }

      const result = await input.botApiClient.sendTextMessage({
        chatId,
        text: message.text
      });

      return {
        providerMessageId: result.messageId,
        status: "sent"
      };
    },
    async health(): Promise<AdapterHealth> {
      return {
        status: "healthy",
        checkedAt: (input?.now ?? (() => new Date(0)))().toISOString()
      };
    }
  };
}

function resolveTelegramChatId(
  clientExternalId: string | undefined
): string | null {
  if (!clientExternalId) {
    return null;
  }

  const match = clientExternalId.match(/^telegram-(?:chat|user):(.+)$/);

  return match?.[1]?.trim() ? match[1].trim() : null;
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
        `Telegram file download returned HTTP ${response.status}.`
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
      throw new TelegramAdapterError(
        response.status >= 500
          ? "provider.temporary_failure"
          : "provider.permanent_failure",
        `Telegram Bot API returned HTTP ${response.status}.`
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

function extractTelegramMessage(
  update: TelegramChannelInboundEnvelope["update"]
): z.infer<typeof telegramMessageSchema> {
  const message =
    update.message ??
    update.edited_message ??
    update.channel_post ??
    update.edited_channel_post;

  if (!message) {
    throw new TelegramAdapterError(
      "validation.failed",
      "Telegram update does not contain a supported message payload."
    );
  }

  return message;
}

function extractTelegramAttachments(
  message: z.infer<typeof telegramMessageSchema>
): NormalizedAttachment[] {
  const attachments: NormalizedAttachment[] = [];
  const largestPhoto = pickLargestPhoto(message.photo);

  if (largestPhoto) {
    attachments.push({
      id: largestPhoto.file_id,
      fileName: `${largestPhoto.file_unique_id ?? largestPhoto.file_id}.jpg`,
      mediaType: "image/jpeg",
      sizeBytes: largestPhoto.file_size
    });
  }

  if (message.document) {
    attachments.push({
      id: message.document.file_id,
      fileName:
        message.document.file_name ??
        `${message.document.file_unique_id ?? message.document.file_id}.bin`,
      mediaType: message.document.mime_type ?? "application/octet-stream",
      sizeBytes: message.document.file_size
    });
  }

  return attachments;
}

function pickLargestPhoto(
  photos: readonly z.infer<typeof telegramPhotoSizeSchema>[] | undefined
): z.infer<typeof telegramPhotoSizeSchema> | undefined {
  if (!photos || photos.length === 0) {
    return undefined;
  }

  return photos.reduce((best, current) => {
    const bestArea = (best.width ?? 0) * (best.height ?? 0);
    const currentArea = (current.width ?? 0) * (current.height ?? 0);

    return currentArea >= bestArea ? current : best;
  }, photos[0]);
}

function buildTelegramDisplayName(
  input: z.infer<typeof telegramUserSchema> | z.infer<typeof telegramChatSchema>
): string {
  const nameParts = [input.first_name, input.last_name].filter(Boolean);

  if (nameParts.length > 0) {
    return nameParts.join(" ");
  }

  const title =
    "title" in input && typeof input.title === "string"
      ? input.title
      : undefined;

  if (title) {
    return title;
  }

  if (input.username) {
    return `@${input.username}`;
  }

  return String(input.id);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
