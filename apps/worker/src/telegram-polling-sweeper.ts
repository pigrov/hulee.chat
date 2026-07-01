import type {
  InternalTelegramIntegrationDiagnostics,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { internalTelegramIntegrationDiagnosticsSchema } from "@hulee/contracts";
import { CoreError, type ExternalChannelCommandService } from "@hulee/core";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository
} from "@hulee/db";
import {
  buildTelegramProviderFailureOperatorHint,
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  managedMessengerVpnEgressRequirement,
  parseTelegramChannelConfig,
  TelegramAdapterError,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiSettings,
  type TelegramChannelConfig,
  type TelegramUpdate
} from "@hulee/modules";

import type { SecretResolver } from "./telegram-outbound-dispatcher";

export type TelegramPollingBotApiClient = {
  getUpdates(input?: {
    offset?: number;
    limit?: number;
    timeoutSeconds?: number;
    allowedUpdates?: readonly string[];
  }): Promise<TelegramUpdate[]>;
};

export type TelegramPollingBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramPollingBotApiClient;

export type TelegramPollingSweepOptions = {
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  commands: ExternalChannelCommandService;
  botApiClientFactory?: TelegramPollingBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
  now?: () => Date;
  configScanLimit?: number;
  updateLimit?: number;
  requestIdFactory?: (input: {
    tenantId: TenantId;
    channelExternalId: string;
    updateId: number;
  }) => string;
};

export type TelegramPollingSweepResult = {
  configsScanned: number;
  configsPolled: number;
  updatesReceived: number;
  updatesAccepted: number;
  updatesFailed: number;
};

type TelegramPollingFailedUpdateDiagnostic = NonNullable<
  NonNullable<
    InternalTelegramIntegrationDiagnostics["polling"]
  >["recentFailedUpdates"]
>[number];

const telegramChannelType = "telegram_bot";
const defaultConfigScanLimit = 100;
const defaultUpdateLimit = 25;
const maxRecentFailedUpdates = 10;
const pollingAllowedUpdates = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post"
] as const;
const telegramUpdatePayloadKeys = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post",
  "callback_query",
  "message_reaction",
  "message_reaction_count",
  "inline_query",
  "chosen_inline_result",
  "poll",
  "poll_answer",
  "my_chat_member",
  "chat_member"
] as const;
const telegramMessageContentKeys = [
  "text",
  "caption",
  "photo",
  "document",
  "sticker",
  "animation",
  "video",
  "voice",
  "audio",
  "video_note",
  "contact",
  "location",
  "venue",
  "poll",
  "dice",
  "new_chat_members",
  "left_chat_member",
  "pinned_message"
] as const;

export async function runTelegramPollingSweep(
  options: TelegramPollingSweepOptions
): Promise<TelegramPollingSweepResult> {
  const now = options.now ?? (() => new Date());
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const records = await options.connectorRepository.listActiveConnectorsByType({
    channelType: telegramChannelType,
    limit: options.configScanLimit ?? defaultConfigScanLimit
  });
  const result: TelegramPollingSweepResult = {
    configsScanned: records.length,
    configsPolled: 0,
    updatesReceived: 0,
    updatesAccepted: 0,
    updatesFailed: 0
  };

  for (const record of records) {
    const checkedAt = now().toISOString();
    const egressResolution = await resolveTelegramEgressProfile({
      egressRuntime,
      tenantId: record.tenantId,
      connectorId: record.id,
      checkedAt
    });
    const storedDiagnostics = parseStoredTelegramDiagnostics(
      record.diagnostics
    );
    let config: TelegramChannelConfig;

    try {
      config = parseTelegramChannelConfig(record.config);
    } catch {
      await persistPollingDiagnostics({
        ...options,
        connectorRecord: record,
        configInput: record.config,
        diagnostics: buildPollingDiagnostics({
          checkedAt,
          status: "invalid_config",
          lastErrorCode: "validation.failed",
          operatorHint: "Telegram polling config is invalid.",
          checks: {
            moduleEnabled: true,
            configValid: false,
            inboundWebhookReady: false,
            outboundEnabled: false,
            botTokenSecretRefConfigured: false
          },
          egress: egressResolution.diagnostics,
          previous: storedDiagnostics
        }),
        updatedAt: now()
      });
      continue;
    }

    if (config.mode !== "polling") {
      continue;
    }

    result.configsPolled += 1;

    await pollTelegramConfig({
      ...options,
      connectorRecord: record,
      tenantId: record.tenantId,
      config,
      storedDiagnostics,
      egressRuntime,
      egressResolution,
      result,
      checkedAt,
      updatedAt: now()
    });
  }

  return result;
}

async function pollTelegramConfig(
  input: TelegramPollingSweepOptions & {
    connectorRecord: ChannelConnectorRecord;
    tenantId: TenantId;
    config: TelegramChannelConfig;
    storedDiagnostics: InternalTelegramIntegrationDiagnostics | null;
    egressRuntime: EgressRuntime;
    egressResolution: EgressProfileResolution;
    result: TelegramPollingSweepResult;
    checkedAt: string;
    updatedAt: Date;
  }
): Promise<void> {
  const token = await resolveBotToken({
    tenantId: input.tenantId,
    config: input.config,
    secretResolver: input.secretResolver
  });

  if (!token) {
    await persistPollingDiagnostics({
      ...input,
      configInput: input.config,
      diagnostics: buildPollingDiagnostics({
        checkedAt: input.checkedAt,
        status: "invalid_config",
        lastErrorCode: "validation.failed",
        operatorHint: "Bot token secret could not be resolved.",
        checks: pollingChecks({
          config: input.config,
          botTokenResolved: false,
          botApiReachable: false
        }),
        egress: input.egressResolution.diagnostics,
        previous: input.storedDiagnostics
      }),
      updatedAt: input.updatedAt
    });
    return;
  }

  const clientFactory = input.botApiClientFactory ?? createTelegramBotApiClient;
  const client = clientFactory({
    apiBaseUrl: input.telegramApiBaseUrl,
    botToken: token,
    egress: buildTelegramBotApiEgressBinding({
      egressRuntime: input.egressRuntime,
      resolution: input.egressResolution,
      tenantId: input.tenantId,
      connectorId: input.connectorRecord.id
    })
  });
  const previousLastUpdateId = input.storedDiagnostics?.polling?.lastUpdateId;

  try {
    const updates = await client.getUpdates({
      offset:
        previousLastUpdateId === undefined
          ? undefined
          : previousLastUpdateId + 1,
      limit: input.updateLimit ?? defaultUpdateLimit,
      timeoutSeconds: 0,
      allowedUpdates: pollingAllowedUpdates
    });
    const pollingResult = await acceptPollingUpdates({
      ...input,
      updates,
      lastUpdateId: previousLastUpdateId
    });

    input.result.updatesReceived += pollingResult.received;
    input.result.updatesAccepted += pollingResult.accepted;
    input.result.updatesFailed += pollingResult.failed;

    const recentFailedUpdates = mergeRecentFailedUpdates({
      current: pollingResult.failedUpdates,
      previous: input.storedDiagnostics?.polling?.recentFailedUpdates
    });

    await persistPollingDiagnostics({
      ...input,
      configInput: input.config,
      diagnostics: buildPollingDiagnostics({
        checkedAt: input.checkedAt,
        status: "configured",
        lastErrorCode:
          pollingResult.failed > 0 ? "validation.failed" : undefined,
        operatorHint:
          pollingResult.failed > 0
            ? "Some Telegram updates failed to normalize or ingest."
            : undefined,
        checks: pollingChecks({
          config: input.config,
          botTokenResolved: true,
          botApiReachable: true
        }),
        polling: {
          lastUpdateId: pollingResult.lastUpdateId,
          lastRunAt: input.checkedAt,
          receivedUpdateCount: pollingResult.received,
          acceptedUpdateCount: pollingResult.accepted,
          failedUpdateCount: pollingResult.failed,
          ...(recentFailedUpdates.length > 0 ? { recentFailedUpdates } : {})
        },
        runtime: buildPollingRuntimeDiagnostics({
          checkedAt: input.checkedAt,
          pollingResult,
          previous: input.storedDiagnostics
        }),
        egress: input.egressResolution.diagnostics,
        previous: input.storedDiagnostics
      }),
      updatedAt: input.updatedAt
    });
  } catch (error) {
    const errorCode = platformErrorCodeFromUnknown(error);
    const operatorHint = buildTelegramProviderFailureOperatorHint({
      error,
      operation: "getUpdates"
    });

    await persistPollingDiagnostics({
      ...input,
      configInput: input.config,
      diagnostics: buildPollingDiagnostics({
        checkedAt: input.checkedAt,
        status: "provider_unreachable",
        lastErrorCode: errorCode,
        operatorHint,
        checks: pollingChecks({
          config: input.config,
          botTokenResolved: true,
          botApiReachable: false
        }),
        polling: {
          lastUpdateId: previousLastUpdateId,
          lastRunAt: input.checkedAt,
          receivedUpdateCount: 0,
          acceptedUpdateCount: 0,
          failedUpdateCount: 0
        },
        runtime: buildPollingFailureRuntimeDiagnostics({
          checkedAt: input.checkedAt,
          errorCode,
          operatorHint,
          previous: input.storedDiagnostics
        }),
        egress: input.egressResolution.diagnostics,
        previous: input.storedDiagnostics
      }),
      updatedAt: input.updatedAt
    });
  }
}

async function acceptPollingUpdates(
  input: TelegramPollingSweepOptions & {
    tenantId: TenantId;
    config: TelegramChannelConfig;
    checkedAt: string;
    updates: readonly TelegramUpdate[];
    lastUpdateId: number | undefined;
  }
): Promise<{
  received: number;
  accepted: number;
  failed: number;
  lastUpdateId: number | undefined;
  lastRequestId?: string;
  lastProviderMessageId?: string;
  lastErrorCode?: PlatformErrorCode;
  failedUpdates: readonly TelegramPollingFailedUpdateDiagnostic[];
}> {
  const adapter = createTelegramChannelAdapter();
  const requestIdFactory =
    input.requestIdFactory ??
    ((requestInput: {
      tenantId: TenantId;
      channelExternalId: string;
      updateId: number;
    }) =>
      [
        "telegram-polling",
        requestInput.tenantId,
        requestInput.channelExternalId,
        requestInput.updateId
      ].join(":"));
  let accepted = 0;
  let failed = 0;
  let lastUpdateId = input.lastUpdateId;
  let lastRequestId: string | undefined;
  let lastProviderMessageId: string | undefined;
  let lastErrorCode: PlatformErrorCode | undefined;
  const failedUpdates: TelegramPollingFailedUpdateDiagnostic[] = [];

  for (const update of input.updates) {
    lastUpdateId =
      lastUpdateId === undefined
        ? update.updateId
        : Math.max(lastUpdateId, update.updateId);
    const requestId = requestIdFactory({
      tenantId: input.tenantId,
      channelExternalId: input.config.channelExternalId,
      updateId: update.updateId
    });

    try {
      const normalized = await adapter.normalizeIncoming({
        tenantId: input.tenantId,
        channelExternalId: input.config.channelExternalId,
        update: update.raw
      });

      await input.commands.acceptInboundMessage(
        {
          requestId,
          tenantId: input.tenantId,
          channelId: input.config.channelExternalId,
          channelProvider: "telegram"
        },
        normalized
      );
      accepted += 1;
      lastRequestId = requestId;
      lastProviderMessageId = normalized.providerMessageId;
    } catch (error) {
      const errorCode = platformErrorCodeFromUnknown(error);

      failed += 1;
      lastRequestId = requestId;
      lastErrorCode = errorCode;
      failedUpdates.push(
        buildFailedUpdateDiagnostic({
          update,
          requestId,
          failedAt: input.checkedAt,
          error,
          errorCode
        })
      );
    }
  }

  return {
    received: input.updates.length,
    accepted,
    failed,
    lastUpdateId,
    ...(lastRequestId ? { lastRequestId } : {}),
    ...(lastProviderMessageId ? { lastProviderMessageId } : {}),
    ...(lastErrorCode ? { lastErrorCode } : {}),
    failedUpdates
  };
}

async function resolveBotToken(input: {
  tenantId: TenantId;
  config: TelegramChannelConfig;
  secretResolver: SecretResolver;
}): Promise<string | null> {
  if (!input.config.botTokenSecretRef) {
    return null;
  }

  return input.secretResolver.resolveSecret({
    tenantId: input.tenantId,
    secretRef: input.config.botTokenSecretRef
  });
}

async function resolveTelegramEgressProfile(input: {
  egressRuntime: EgressRuntime;
  tenantId: TenantId;
  connectorId: string;
  checkedAt: string;
}): Promise<EgressProfileResolution> {
  return input.egressRuntime.resolveProfile({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: "telegram",
    requirement: managedMessengerVpnEgressRequirement,
    checkedAt: input.checkedAt
  });
}

function buildTelegramBotApiEgressBinding(input: {
  egressRuntime: EgressRuntime;
  resolution: EgressProfileResolution;
  tenantId: TenantId;
  connectorId: string;
}): TelegramBotApiEgressBinding {
  return {
    runtime: input.egressRuntime,
    resolution: input.resolution,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: "telegram"
  };
}

function buildPollingDiagnostics(input: {
  checkedAt: string;
  status: InternalTelegramIntegrationDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  checks: InternalTelegramIntegrationDiagnostics["checks"];
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  runtime?: InternalTelegramIntegrationDiagnostics["runtime"];
  egress?: InternalTelegramIntegrationDiagnostics["egress"];
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics {
  return internalTelegramIntegrationDiagnosticsSchema.parse({
    status: input.status,
    checkedAt: input.checkedAt,
    ...(input.lastErrorCode ? { lastErrorCode: input.lastErrorCode } : {}),
    ...(input.operatorHint ? { operatorHint: input.operatorHint } : {}),
    ...(input.previous?.bot ? { bot: input.previous.bot } : {}),
    ...(input.previous?.webhook ? { webhook: input.previous.webhook } : {}),
    ...(input.polling ? { polling: input.polling } : {}),
    ...((input.runtime ?? input.previous?.runtime)
      ? { runtime: input.runtime ?? input.previous?.runtime }
      : {}),
    ...((input.egress ?? input.previous?.egress)
      ? { egress: input.egress ?? input.previous?.egress }
      : {}),
    checks: input.checks
  });
}

function buildPollingRuntimeDiagnostics(input: {
  checkedAt: string;
  pollingResult: {
    received: number;
    accepted: number;
    failed: number;
    lastUpdateId: number | undefined;
    lastRequestId?: string;
    lastProviderMessageId?: string;
    lastErrorCode?: PlatformErrorCode;
  };
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics["runtime"] {
  const previousInbound = input.previous?.runtime?.inbound;

  return {
    ...(input.previous?.runtime?.outbound
      ? { outbound: input.previous.runtime.outbound }
      : {}),
    inbound: {
      lastSource: "polling",
      lastReceivedAt: input.checkedAt,
      ...(input.pollingResult.accepted > 0
        ? { lastAcceptedAt: input.checkedAt }
        : previousInbound?.lastAcceptedAt
          ? { lastAcceptedAt: previousInbound.lastAcceptedAt }
          : {}),
      ...(input.pollingResult.failed > 0
        ? { lastFailedAt: input.checkedAt }
        : previousInbound?.lastFailedAt
          ? { lastFailedAt: previousInbound.lastFailedAt }
          : {}),
      ...(input.pollingResult.lastRequestId
        ? { lastRequestId: input.pollingResult.lastRequestId }
        : previousInbound?.lastRequestId
          ? { lastRequestId: previousInbound.lastRequestId }
          : {}),
      ...(input.pollingResult.lastUpdateId === undefined
        ? {}
        : { lastUpdateId: input.pollingResult.lastUpdateId }),
      ...(input.pollingResult.lastProviderMessageId
        ? { lastProviderMessageId: input.pollingResult.lastProviderMessageId }
        : previousInbound?.lastProviderMessageId
          ? { lastProviderMessageId: previousInbound.lastProviderMessageId }
          : {}),
      lastBatchReceivedCount: input.pollingResult.received,
      lastBatchAcceptedCount: input.pollingResult.accepted,
      lastBatchFailedCount: input.pollingResult.failed,
      ...(input.pollingResult.lastErrorCode
        ? { lastErrorCode: input.pollingResult.lastErrorCode }
        : previousInbound?.lastErrorCode
          ? { lastErrorCode: previousInbound.lastErrorCode }
          : {}),
      ...(input.pollingResult.failed > 0
        ? {
            operatorHint: "Some Telegram updates failed to normalize or ingest."
          }
        : {})
    }
  };
}

function buildPollingFailureRuntimeDiagnostics(input: {
  checkedAt: string;
  errorCode: PlatformErrorCode;
  operatorHint: string;
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics["runtime"] {
  const previousInbound = input.previous?.runtime?.inbound;

  return {
    ...(input.previous?.runtime?.outbound
      ? { outbound: input.previous.runtime.outbound }
      : {}),
    inbound: {
      lastSource: "polling",
      ...(previousInbound?.lastReceivedAt
        ? { lastReceivedAt: previousInbound.lastReceivedAt }
        : {}),
      ...(previousInbound?.lastAcceptedAt
        ? { lastAcceptedAt: previousInbound.lastAcceptedAt }
        : {}),
      lastFailedAt: input.checkedAt,
      ...(previousInbound?.lastRequestId
        ? { lastRequestId: previousInbound.lastRequestId }
        : {}),
      ...(previousInbound?.lastUpdateId === undefined
        ? {}
        : { lastUpdateId: previousInbound.lastUpdateId }),
      ...(previousInbound?.lastProviderMessageId
        ? { lastProviderMessageId: previousInbound.lastProviderMessageId }
        : {}),
      lastBatchReceivedCount: 0,
      lastBatchAcceptedCount: 0,
      lastBatchFailedCount: 0,
      lastErrorCode: input.errorCode,
      operatorHint: input.operatorHint
    }
  };
}

function pollingChecks(input: {
  config: TelegramChannelConfig;
  botTokenResolved: boolean;
  botApiReachable: boolean;
}): InternalTelegramIntegrationDiagnostics["checks"] {
  return {
    moduleEnabled: true,
    configValid: true,
    inboundWebhookReady: false,
    outboundEnabled: input.config.outboundEnabled,
    botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
    botTokenResolved: input.botTokenResolved,
    botApiReachable: input.botApiReachable,
    webhookMatchesConfig: false
  };
}

async function persistPollingDiagnostics(input: {
  connectorRepository: ChannelConnectorRepository;
  connectorRecord: ChannelConnectorRecord;
  configInput: unknown;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  updatedAt: Date;
}): Promise<void> {
  await input.connectorRepository.upsertConnector({
    id: input.connectorRecord.id,
    tenantId: input.connectorRecord.tenantId,
    channelType: input.connectorRecord.channelType,
    channelClass: input.connectorRecord.channelClass,
    provider: input.connectorRecord.provider,
    displayName: input.connectorRecord.displayName,
    status: telegramConnectorStatusFromDiagnostics(input.diagnostics),
    healthStatus: telegramConnectorHealthFromDiagnostics(input.diagnostics),
    capabilities: input.connectorRecord.capabilities,
    onboardingState: input.connectorRecord.onboardingState,
    config: input.configInput,
    diagnostics: input.diagnostics,
    createdByEmployeeId: input.connectorRecord.createdByEmployeeId,
    updatedAt: input.updatedAt
  });
}

function telegramConnectorStatusFromDiagnostics(
  diagnostics: InternalTelegramIntegrationDiagnostics
): ChannelConnectorRecord["status"] {
  if (diagnostics.status === "invalid_config") {
    return "reauth_required";
  }

  if (
    diagnostics.status === "provider_unreachable" ||
    diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "connected";
}

function telegramConnectorHealthFromDiagnostics(
  diagnostics: InternalTelegramIntegrationDiagnostics
): ChannelConnectorRecord["healthStatus"] {
  if (diagnostics.status === "configured") {
    return "healthy";
  }

  if (
    diagnostics.status === "provider_unreachable" ||
    diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "unhealthy";
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function platformErrorCodeFromUnknown(error: unknown): PlatformErrorCode {
  if (error instanceof TelegramAdapterError || error instanceof CoreError) {
    return error.code;
  }

  if (
    error instanceof Error &&
    "code" in error &&
    (error.code === "provider.temporary_failure" ||
      error.code === "provider.permanent_failure" ||
      error.code === "validation.failed")
  ) {
    return error.code;
  }

  return "provider.temporary_failure";
}

function buildFailedUpdateDiagnostic(input: {
  update: TelegramUpdate;
  requestId: string;
  failedAt: string;
  error: unknown;
  errorCode: PlatformErrorCode;
}): TelegramPollingFailedUpdateDiagnostic {
  const summary = summarizeTelegramUpdate(input.update.raw);
  const errorMessage = safeErrorMessage(input.error);

  return {
    updateId: input.update.updateId,
    requestId: input.requestId,
    failedAt: input.failedAt,
    errorCode: input.errorCode,
    ...(errorMessage ? { errorMessage } : {}),
    ...summary
  };
}

function summarizeTelegramUpdate(
  raw: unknown
): Pick<
  TelegramPollingFailedUpdateDiagnostic,
  "updateType" | "providerMessageId" | "chatType" | "contentTypes"
> {
  const update = asRecord(raw);

  if (!update) {
    return {};
  }

  const updateType = telegramUpdatePayloadKeys.find(
    (key) => update[key] !== undefined
  );
  const payload = updateType ? asRecord(update[updateType]) : null;
  const chat = payload ? asRecord(payload.chat) : null;
  const providerMessageId = telegramProviderMessageId(payload, chat);
  const chatType = safeDiagnosticString(chat?.type, 80);
  const contentTypes = collectTelegramContentTypes(update, payload);

  return {
    ...(updateType ? { updateType } : {}),
    ...(providerMessageId ? { providerMessageId } : {}),
    ...(chatType ? { chatType } : {}),
    ...(contentTypes.length > 0 ? { contentTypes } : {})
  };
}

function collectTelegramContentTypes(
  update: Record<string, unknown>,
  payload: Record<string, unknown> | null
): string[] {
  if (payload) {
    const contentTypes = telegramMessageContentKeys.filter(
      (key) => payload[key] !== undefined
    );

    if (contentTypes.length > 0) {
      return [...contentTypes];
    }
  }

  return Object.keys(update)
    .filter((key) => key !== "update_id")
    .sort()
    .slice(0, 20);
}

function telegramProviderMessageId(
  payload: Record<string, unknown> | null,
  chat: Record<string, unknown> | null
): string | undefined {
  const messageId = safeDiagnosticString(payload?.message_id, 80);
  const chatId = safeDiagnosticString(chat?.id, 80);

  if (chatId && messageId) {
    return `${chatId}:${messageId}`;
  }

  return messageId;
}

function mergeRecentFailedUpdates(input: {
  current: readonly TelegramPollingFailedUpdateDiagnostic[];
  previous?: readonly TelegramPollingFailedUpdateDiagnostic[];
}): TelegramPollingFailedUpdateDiagnostic[] {
  const seen = new Set<string>();
  const merged: TelegramPollingFailedUpdateDiagnostic[] = [];

  for (const diagnostic of [...input.current, ...(input.previous ?? [])]) {
    const key = `${diagnostic.updateId}:${diagnostic.requestId}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    merged.push(diagnostic);

    if (merged.length >= maxRecentFailedUpdates) {
      break;
    }
  }

  return merged;
}

function safeErrorMessage(error: unknown): string | undefined {
  if (error instanceof TelegramAdapterError || error instanceof CoreError) {
    return safeDiagnosticString(error.message, 500);
  }

  if (
    error instanceof Error &&
    "code" in error &&
    (error.code === "provider.temporary_failure" ||
      error.code === "provider.permanent_failure" ||
      error.code === "validation.failed")
  ) {
    return safeDiagnosticString(error.message, 500);
  }

  return undefined;
}

function safeDiagnosticString(
  value: unknown,
  maxLength: number
): string | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const text = String(value).trim();

  if (text.length === 0) {
    return undefined;
  }

  return text.length > maxLength ? text.slice(0, maxLength) : text;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
