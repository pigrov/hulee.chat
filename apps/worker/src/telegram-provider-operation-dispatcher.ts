import type {
  ChannelProviderOperation,
  InternalTelegramIntegrationDiagnostics,
  PlatformErrorCode,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { internalTelegramIntegrationDiagnosticsSchema } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository
} from "@hulee/db";
import {
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  managedMessengerVpnEgressRequirement,
  parseTelegramChannelConfig,
  TelegramAdapterError,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiSettings,
  type TelegramBotIdentity,
  type TelegramChannelConfig,
  type TelegramWebhookInfo
} from "@hulee/modules";

import type { OutboxHandler, OutboxRecord } from "./outbox-processor";
import type { SecretResolver } from "./telegram-outbound-dispatcher";

export type TelegramProviderOperationBotApiClient = {
  getMe(): Promise<TelegramBotIdentity>;
  getWebhookInfo(): Promise<TelegramWebhookInfo>;
  setWebhook(input: { url: string; secretToken?: string }): Promise<void>;
  deleteWebhook(): Promise<void>;
};

export type TelegramProviderOperationBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramProviderOperationBotApiClient;

export type TelegramProviderOperationDispatcherOptions = {
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory?: TelegramProviderOperationBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  now?: () => Date;
};

const telegramChannelType = "telegram_bot";
const telegramProvider = "telegram";

export function createTelegramProviderOperationDispatcher(
  options: TelegramProviderOperationDispatcherOptions
): OutboxHandler {
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const now = options.now ?? (() => new Date());

  return {
    async handle(record: OutboxRecord): Promise<void> {
      const request = parseTelegramProviderOperationRequest(record.payload);

      if (request === null) {
        return;
      }

      if (request.tenantId !== record.tenantId) {
        throw new CoreError("tenant.boundary_violation");
      }

      await runTelegramProviderOperation({
        ...options,
        botApiClientFactory,
        egressRuntime,
        now,
        tenantId: record.tenantId,
        connectorId: request.connectorId,
        operation: request.operation
      });
    }
  };
}

async function runTelegramProviderOperation(input: {
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramProviderOperationBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  now: () => Date;
  tenantId: TenantId;
  connectorId: string;
  operation: ChannelProviderOperation;
}): Promise<void> {
  const updatedAt = input.now();
  const checkedAt = updatedAt.toISOString();
  const record = await input.connectorRepository.findConnector({
    tenantId: input.tenantId,
    connectorId: input.connectorId
  });

  if (!record || record.channelType !== telegramChannelType) {
    throw new CoreError("validation.failed");
  }

  let config: TelegramChannelConfig;

  try {
    config = parseTelegramChannelConfig(record.config);
  } catch {
    await persistTelegramDiagnostics({
      connectorRepository: input.connectorRepository,
      record,
      diagnostics: buildInvalidTelegramDiagnostics({
        checkedAt,
        previous: parseStoredTelegramDiagnostics(record.diagnostics)
      }),
      updatedAt
    });
    return;
  }

  if (!isTelegramConnectorEnabled(record)) {
    return;
  }

  if (input.operation === "telegram.diagnostics.refresh") {
    await refreshTelegramDiagnostics({
      ...input,
      record,
      config,
      checkedAt,
      updatedAt
    });
    return;
  }

  await syncTelegramWebhook({
    ...input,
    record,
    config,
    checkedAt,
    updatedAt,
    webhookOperation:
      input.operation === "telegram.webhook.set" ? "set" : "delete"
  });
}

async function refreshTelegramDiagnostics(input: {
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramProviderOperationBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  tenantId: TenantId;
  record: ChannelConnectorRecord;
  config: TelegramChannelConfig;
  checkedAt: string;
  updatedAt: Date;
}): Promise<void> {
  const diagnostics = await buildTelegramProviderDiagnostics(input);

  await persistTelegramDiagnostics({
    connectorRepository: input.connectorRepository,
    record: input.record,
    diagnostics,
    updatedAt: input.updatedAt
  });
}

async function syncTelegramWebhook(input: {
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramProviderOperationBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  tenantId: TenantId;
  record: ChannelConnectorRecord;
  config: TelegramChannelConfig;
  checkedAt: string;
  updatedAt: Date;
  webhookOperation: "set" | "delete";
}): Promise<void> {
  const previous = parseStoredTelegramDiagnostics(input.record.diagnostics);
  const egressResolution = await resolveTelegramEgressProfile({
    egressRuntime: input.egressRuntime,
    tenantId: input.tenantId,
    connectorId: input.record.id,
    checkedAt: input.checkedAt
  });
  const token = await resolveBotToken({
    tenantId: input.tenantId,
    config: input.config,
    secretResolver: input.secretResolver
  });
  const webhookSecretToken = await resolveWebhookSecretToken({
    tenantId: input.tenantId,
    config: input.config,
    secretResolver: input.secretResolver
  });
  const expectedUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    buildTelegramWebhookPath(input.config)
  );

  if (!token || !expectedUrl || !webhookSecretToken) {
    await persistTelegramDiagnostics({
      connectorRepository: input.connectorRepository,
      record: input.record,
      diagnostics: buildTelegramDiagnostics({
        enabled: true,
        config: input.config,
        checkedAt: input.checkedAt,
        publicWebhookBaseUrl: input.publicWebhookBaseUrl,
        previous,
        status: "invalid_config",
        lastErrorCode: "validation.failed",
        operatorHint: telegramWebhookInvalidConfigHint({
          token,
          expectedUrl,
          webhookSecretToken
        }),
        egress: egressResolution.diagnostics,
        checks: {
          botTokenResolved: Boolean(token),
          webhookSecretTokenResolved: Boolean(webhookSecretToken),
          botApiReachable: false,
          webhookMatchesConfig: false
        }
      }),
      updatedAt: input.updatedAt
    });
    return;
  }

  try {
    const client = input.botApiClientFactory({
      apiBaseUrl: input.telegramApiBaseUrl,
      botToken: token,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: input.egressRuntime,
        resolution: egressResolution,
        tenantId: input.tenantId,
        connectorId: input.record.id
      })
    });

    if (input.webhookOperation === "set") {
      await client.setWebhook({
        url: expectedUrl,
        secretToken: webhookSecretToken
      });
    } else {
      await client.deleteWebhook();
    }
  } catch (error) {
    await persistTelegramDiagnostics({
      connectorRepository: input.connectorRepository,
      record: input.record,
      diagnostics: telegramProviderFailureDiagnostics({
        enabled: true,
        config: input.config,
        checkedAt: input.checkedAt,
        publicWebhookBaseUrl: input.publicWebhookBaseUrl,
        previous,
        egress: egressResolution.diagnostics,
        error
      }),
      updatedAt: input.updatedAt
    });
    return;
  }

  await refreshTelegramDiagnostics(input);
}

async function buildTelegramProviderDiagnostics(input: {
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramProviderOperationBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  tenantId: TenantId;
  record: ChannelConnectorRecord;
  config: TelegramChannelConfig;
  checkedAt: string;
}): Promise<InternalTelegramIntegrationDiagnostics> {
  const previous = parseStoredTelegramDiagnostics(input.record.diagnostics);
  const egressResolution = await resolveTelegramEgressProfile({
    egressRuntime: input.egressRuntime,
    tenantId: input.tenantId,
    connectorId: input.record.id,
    checkedAt: input.checkedAt
  });
  const token = await resolveBotToken({
    tenantId: input.tenantId,
    config: input.config,
    secretResolver: input.secretResolver
  });

  if (!token) {
    return buildTelegramDiagnostics({
      enabled: true,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      previous,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: "Bot token secret could not be resolved.",
      egress: egressResolution.diagnostics,
      checks: {
        botTokenResolved: false,
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });
  }

  try {
    const client = input.botApiClientFactory({
      apiBaseUrl: input.telegramApiBaseUrl,
      botToken: token,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: input.egressRuntime,
        resolution: egressResolution,
        tenantId: input.tenantId,
        connectorId: input.record.id
      })
    });
    const [bot, webhook] = await Promise.all([
      client.getMe(),
      client.getWebhookInfo()
    ]);
    const expectedUrl = buildTelegramPublicWebhookUrl(
      input.publicWebhookBaseUrl,
      buildTelegramWebhookPath(input.config)
    );
    const webhookMatchesConfig =
      expectedUrl === undefined ? false : webhook.url === expectedUrl;

    return buildTelegramDiagnostics({
      enabled: true,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      previous,
      status:
        input.config.mode === "webhook" && !webhookMatchesConfig
          ? "webhook_mismatch"
          : "configured",
      operatorHint:
        expectedUrl === undefined
          ? "Public webhook base URL is not configured."
          : undefined,
      bot: {
        id: bot.id,
        username: bot.username,
        firstName: bot.firstName
      },
      webhook: {
        expectedUrl,
        actualUrl: webhook.url,
        pendingUpdateCount: webhook.pendingUpdateCount,
        lastErrorAt: webhook.lastErrorAt,
        lastErrorMessage: webhook.lastErrorMessage
      },
      egress: egressResolution.diagnostics,
      checks: {
        botTokenResolved: true,
        botApiReachable: true,
        webhookMatchesConfig
      }
    });
  } catch (error) {
    return telegramProviderFailureDiagnostics({
      enabled: true,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      previous,
      egress: egressResolution.diagnostics,
      error
    });
  }
}

async function persistTelegramDiagnostics(input: {
  connectorRepository: ChannelConnectorRepository;
  record: ChannelConnectorRecord;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  updatedAt: Date;
}): Promise<void> {
  await input.connectorRepository.upsertConnector({
    id: input.record.id,
    tenantId: input.record.tenantId,
    channelType: input.record.channelType,
    channelClass: input.record.channelClass,
    provider: input.record.provider,
    displayName: input.record.displayName,
    status: telegramConnectorStatusFromDiagnostics(input.diagnostics),
    healthStatus: telegramConnectorHealthFromDiagnostics(input.diagnostics),
    capabilities: input.record.capabilities,
    onboardingState: input.record.onboardingState,
    config: input.record.config,
    diagnostics: input.diagnostics,
    createdByEmployeeId: input.record.createdByEmployeeId,
    updatedAt: input.updatedAt
  });
}

function parseTelegramProviderOperationRequest(event: PlatformEvent): {
  tenantId: TenantId;
  connectorId: string;
  operation: ChannelProviderOperation;
} | null {
  if (event.type !== "channel.provider_operation.requested") {
    return null;
  }

  if (
    event.payload.channelType !== telegramChannelType ||
    event.payload.provider !== telegramProvider
  ) {
    return null;
  }

  return {
    tenantId: event.tenantId,
    connectorId: event.payload.connectorId,
    operation: event.payload.operation
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

async function resolveWebhookSecretToken(input: {
  tenantId: TenantId;
  config: TelegramChannelConfig;
  secretResolver: SecretResolver;
}): Promise<string | null> {
  if (!input.config.webhookSecretTokenSecretRef) {
    return null;
  }

  return input.secretResolver.resolveSecret({
    tenantId: input.tenantId,
    secretRef: input.config.webhookSecretTokenSecretRef
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
    provider: telegramProvider,
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
    provider: telegramProvider
  };
}

function buildTelegramDiagnostics(input: {
  enabled: boolean;
  config: TelegramChannelConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  previous: InternalTelegramIntegrationDiagnostics | null;
  status?: InternalTelegramIntegrationDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  bot?: InternalTelegramIntegrationDiagnostics["bot"];
  webhook?: InternalTelegramIntegrationDiagnostics["webhook"];
  checks?: Partial<InternalTelegramIntegrationDiagnostics["checks"]>;
  egress?: InternalTelegramIntegrationDiagnostics["egress"];
}): InternalTelegramIntegrationDiagnostics {
  const expectedWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    buildTelegramWebhookPath(input.config)
  );
  const webhook =
    input.webhook ??
    input.previous?.webhook ??
    (expectedWebhookUrl === undefined
      ? undefined
      : {
          expectedUrl: expectedWebhookUrl
        });
  const webhookMatchesConfig = input.checks?.webhookMatchesConfig;
  const inboundWebhookReady =
    input.config.mode === "webhook" ? webhookMatchesConfig === true : false;

  return internalTelegramIntegrationDiagnosticsSchema.parse({
    status: input.status ?? "configured",
    checkedAt: input.checkedAt,
    ...(input.lastErrorCode ? { lastErrorCode: input.lastErrorCode } : {}),
    ...(input.operatorHint ? { operatorHint: input.operatorHint } : {}),
    ...((input.bot ?? input.previous?.bot)
      ? { bot: input.bot ?? input.previous?.bot }
      : {}),
    ...(webhook ? { webhook } : {}),
    ...(input.previous?.polling ? { polling: input.previous.polling } : {}),
    egress:
      input.egress ??
      input.previous?.egress ??
      buildTelegramEgressDiagnostics(input.checkedAt),
    checks: {
      moduleEnabled: input.enabled,
      configValid: true,
      inboundWebhookReady,
      outboundEnabled: input.config.outboundEnabled,
      botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
      ...input.checks
    }
  });
}

function buildInvalidTelegramDiagnostics(input: {
  checkedAt: string;
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics {
  return internalTelegramIntegrationDiagnosticsSchema.parse({
    status: "invalid_config",
    lastErrorCode: "validation.failed" satisfies PlatformErrorCode,
    checkedAt: input.checkedAt,
    ...(input.previous?.egress ? { egress: input.previous.egress } : {}),
    checks: {
      moduleEnabled: true,
      configValid: false,
      inboundWebhookReady: false,
      outboundEnabled: false,
      botTokenSecretRefConfigured: false
    }
  });
}

function buildTelegramEgressDiagnostics(
  checkedAt: string
): InternalTelegramIntegrationDiagnostics["egress"] {
  return {
    required: true,
    status: "unknown",
    profileKind: managedMessengerVpnEgressRequirement.defaultProfileKind,
    checkedAt
  };
}

function telegramProviderFailureDiagnostics(input: {
  enabled: boolean;
  config: TelegramChannelConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  previous: InternalTelegramIntegrationDiagnostics | null;
  egress?: InternalTelegramIntegrationDiagnostics["egress"];
  error: unknown;
}): InternalTelegramIntegrationDiagnostics {
  return buildTelegramDiagnostics({
    enabled: input.enabled,
    config: input.config,
    checkedAt: input.checkedAt,
    publicWebhookBaseUrl: input.publicWebhookBaseUrl,
    previous: input.previous,
    status: "provider_unreachable",
    lastErrorCode: platformErrorCodeFromTelegramError(input.error),
    operatorHint: "Telegram Bot API call failed.",
    egress: input.egress,
    checks: {
      botTokenResolved: true,
      botApiReachable: false,
      webhookMatchesConfig: false
    }
  });
}

function telegramWebhookInvalidConfigHint(input: {
  token: string | null;
  expectedUrl: string | undefined;
  webhookSecretToken: string | null;
}): string {
  if (!input.token) {
    return "Bot token secret could not be resolved.";
  }

  if (!input.webhookSecretToken) {
    return "Webhook secret token could not be resolved.";
  }

  return "Public webhook base URL is not configured.";
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

function isTelegramConnectorEnabled(record: ChannelConnectorRecord): boolean {
  return (
    record.status !== "draft" &&
    record.status !== "onboarding" &&
    record.status !== "authorizing" &&
    record.status !== "disabled" &&
    record.status !== "deleted"
  );
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function buildTelegramWebhookPath(
  config: Pick<
    TelegramChannelConfig,
    "channelExternalId" | "webhookConnectorId"
  >
): string {
  const connectorId = config.webhookConnectorId ?? config.channelExternalId;

  if (!connectorId) {
    throw new CoreError("validation.failed");
  }

  return `/webhooks/telegram/${encodeURIComponent(connectorId)}`;
}

function buildTelegramPublicWebhookUrl(
  publicWebhookBaseUrl: string | undefined,
  webhookPath: string
): string | undefined {
  if (!publicWebhookBaseUrl) {
    return undefined;
  }

  return new URL(webhookPath, publicWebhookBaseUrl).toString();
}

function platformErrorCodeFromTelegramError(error: unknown): PlatformErrorCode {
  if (error instanceof TelegramAdapterError) {
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
