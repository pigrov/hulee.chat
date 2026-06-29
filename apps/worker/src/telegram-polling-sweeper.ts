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
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  parseTelegramChannelConfig,
  TelegramAdapterError,
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

const telegramChannelType = "telegram_bot";
const defaultConfigScanLimit = 100;
const defaultUpdateLimit = 25;
const pollingAllowedUpdates = [
  "message",
  "edited_message",
  "channel_post",
  "edited_channel_post"
] as const;

export async function runTelegramPollingSweep(
  options: TelegramPollingSweepOptions
): Promise<TelegramPollingSweepResult> {
  const now = options.now ?? (() => new Date());
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
        previous: input.storedDiagnostics
      }),
      updatedAt: input.updatedAt
    });
    return;
  }

  const clientFactory = input.botApiClientFactory ?? createTelegramBotApiClient;
  const client = clientFactory({
    apiBaseUrl: input.telegramApiBaseUrl,
    botToken: token
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
          failedUpdateCount: pollingResult.failed
        },
        previous: input.storedDiagnostics
      }),
      updatedAt: input.updatedAt
    });
  } catch (error) {
    await persistPollingDiagnostics({
      ...input,
      configInput: input.config,
      diagnostics: buildPollingDiagnostics({
        checkedAt: input.checkedAt,
        status: "provider_unreachable",
        lastErrorCode: platformErrorCodeFromUnknown(error),
        operatorHint: "Telegram getUpdates call failed.",
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

  for (const update of input.updates) {
    lastUpdateId =
      lastUpdateId === undefined
        ? update.updateId
        : Math.max(lastUpdateId, update.updateId);

    try {
      const normalized = await adapter.normalizeIncoming({
        tenantId: input.tenantId,
        channelExternalId: input.config.channelExternalId,
        update: update.raw
      });

      await input.commands.acceptInboundMessage(
        {
          requestId: requestIdFactory({
            tenantId: input.tenantId,
            channelExternalId: input.config.channelExternalId,
            updateId: update.updateId
          }),
          tenantId: input.tenantId,
          channelId: input.config.channelExternalId
        },
        normalized
      );
      accepted += 1;
    } catch {
      failed += 1;
    }
  }

  return {
    received: input.updates.length,
    accepted,
    failed,
    lastUpdateId
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

function buildPollingDiagnostics(input: {
  checkedAt: string;
  status: InternalTelegramIntegrationDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  checks: InternalTelegramIntegrationDiagnostics["checks"];
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
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
    checks: input.checks
  });
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
