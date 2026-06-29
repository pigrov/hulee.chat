import type {
  EmployeeId,
  InternalChannelCatalogResponse,
  InternalChannelConnectorCreateRequest,
  InternalChannelConnectorHealthStatus,
  InternalChannelConnectorSummary,
  InternalChannelConnectorStatus,
  InternalChannelConnectorsResponse,
  InternalChannelClass,
  InternalChannelType,
  InternalTelegramIntegrationConfig,
  InternalTelegramIntegrationDiagnostics,
  InternalTelegramIntegrationResponse,
  InternalTelegramIntegrationUpdateRequest,
  InternalTelegramSetupStep,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { internalTelegramIntegrationDiagnosticsSchema } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  TenantSecretRepository
} from "@hulee/db";
import { createChannelConnectorSecretRef } from "@hulee/db";
import {
  createTelegramBotApiClient,
  parseTelegramChannelConfig,
  telegramChannelManifest,
  TelegramAdapterError,
  type TelegramBotApiClient,
  type TelegramBotApiSettings
} from "@hulee/modules";
import { randomBytes, randomUUID } from "node:crypto";

export type InternalIntegrationContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalIntegrationService = {
  listChannelCatalog(
    context: InternalIntegrationContext
  ): Promise<InternalChannelCatalogResponse>;
  listChannelConnectors(
    context: InternalIntegrationContext
  ): Promise<InternalChannelConnectorsResponse>;
  createChannelConnector(
    context: InternalIntegrationContext,
    request: InternalChannelConnectorCreateRequest
  ): Promise<InternalChannelConnectorSummary>;
  disableChannelConnector(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalChannelConnectorSummary>;
  deleteChannelConnector(
    context: InternalIntegrationContext,
    input: { connectorId: string }
  ): Promise<InternalChannelConnectorSummary>;
  loadTelegramIntegration(
    context: InternalIntegrationContext,
    input?: { connectorId?: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  updateTelegramIntegration(
    context: InternalIntegrationContext,
    request: InternalTelegramIntegrationUpdateRequest
  ): Promise<InternalTelegramIntegrationResponse>;
  refreshTelegramDiagnostics(
    context: InternalIntegrationContext,
    input?: { connectorId?: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  setTelegramWebhook(
    context: InternalIntegrationContext,
    input?: { connectorId?: string }
  ): Promise<InternalTelegramIntegrationResponse>;
  deleteTelegramWebhook(
    context: InternalIntegrationContext,
    input?: { connectorId?: string }
  ): Promise<InternalTelegramIntegrationResponse>;
};

export type SecretResolver = {
  resolveSecret(input: {
    tenantId: TenantId;
    secretRef: string;
  }): Promise<string | null>;
};

export type SecretWriter = {
  upsertSecret(input: {
    tenantId: TenantId;
    secretRef: string;
    purpose: "telegram.bot_token" | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }): Promise<void>;
};

export type TelegramBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramBotApiClient;

export type InternalIntegrationServiceOptions = {
  connectorRepository: ChannelConnectorRepository;
  secretResolver?: SecretResolver;
  secretWriter?: SecretWriter;
  botApiClientFactory?: TelegramBotApiClientFactory;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  webhookConnectorIdFactory?: (input: {
    tenantId: TenantId;
    channelExternalId: string;
  }) => string;
  webhookSecretTokenFactory?: () => string;
  now?: () => Date;
};

const telegramModuleId = "channel-telegram" as const;
const telegramChannelType = "telegram_bot" as const;
const telegramChannelClass = "bot_bridge" as const;
const telegramProvider = "telegram";
const defaultTelegramDisplayName = "Telegram Bot";
const channelCatalogV1 = [
  {
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    titleKey: "integrations.catalog.telegramBot.title",
    descriptionKey: "integrations.catalog.telegramBot.description",
    readiness: "available",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "webhook", "polling"]
  },
  {
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    titleKey: "integrations.catalog.telegramQr.title",
    descriptionKey: "integrations.catalog.telegramQr.description",
    readiness: "coming_soon",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "qr_auth", "session_runtime"]
  },
  {
    channelType: "whatsapp_qr_bridge",
    channelClass: "user_bridge",
    provider: "whatsapp",
    titleKey: "integrations.catalog.whatsappQr.title",
    descriptionKey: "integrations.catalog.whatsappQr.description",
    readiness: "coming_soon",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "qr_auth", "session_runtime"]
  },
  {
    channelType: "max_bot",
    channelClass: "bot_bridge",
    provider: "max",
    titleKey: "integrations.catalog.maxBot.title",
    descriptionKey: "integrations.catalog.maxBot.description",
    readiness: "coming_soon",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound"]
  },
  {
    channelType: "max_qr_bridge",
    channelClass: "user_bridge",
    provider: "max",
    titleKey: "integrations.catalog.maxQr.title",
    descriptionKey: "integrations.catalog.maxQr.description",
    readiness: "coming_soon",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "code_auth", "session_runtime"]
  },
  {
    channelType: "vk_community",
    channelClass: "official_api",
    provider: "vk",
    titleKey: "integrations.catalog.vkCommunity.title",
    descriptionKey: "integrations.catalog.vkCommunity.description",
    readiness: "coming_soon",
    supportsMultiple: true,
    capabilities: ["inbound", "outbound", "official_api"]
  }
] satisfies InternalChannelCatalogResponse["channels"];

if (telegramChannelManifest.id !== telegramModuleId) {
  throw new CoreError("validation.failed");
}

export function createInternalIntegrationService(
  options: InternalIntegrationServiceOptions
): InternalIntegrationService {
  const now = options.now ?? (() => new Date());
  const secretResolver =
    options.secretResolver ?? createEnvSecretResolver(process.env);
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const webhookConnectorIdFactory =
    options.webhookConnectorIdFactory ?? createTelegramWebhookConnectorId;
  const webhookSecretTokenFactory =
    options.webhookSecretTokenFactory ?? createTelegramWebhookSecretToken;

  return {
    async listChannelCatalog() {
      return {
        channels: channelCatalogV1
      };
    },

    async listChannelConnectors(context) {
      const records = await options.connectorRepository.listTenantConnectors({
        tenantId: context.tenantId
      });

      return {
        connectors: records.flatMap((record) => {
          const summary = channelConnectorSummaryFromRecord(record);

          return summary ? [summary] : [];
        })
      };
    },

    async createChannelConnector(context, request) {
      if (request.channelType !== telegramChannelType) {
        throw new CoreError("validation.failed");
      }

      const updatedAt = now();
      const connectorId = createRandomChannelConnectorId(request.channelType);
      const channelExternalId = createDefaultTelegramChannelExternalId();
      const config: InternalTelegramIntegrationConfig = {
        channelExternalId,
        mode: "webhook",
        webhookConnectorId: webhookConnectorIdFactory({
          tenantId: context.tenantId,
          channelExternalId
        }),
        outboundEnabled: false
      };
      const diagnostics = buildTelegramDiagnostics({
        enabled: false,
        config,
        checkedAt: updatedAt.toISOString()
      });

      await options.connectorRepository.upsertConnector({
        id: connectorId,
        tenantId: context.tenantId,
        channelType: telegramChannelType,
        channelClass: telegramChannelClass,
        provider: telegramProvider,
        displayName: request.displayName?.trim() || defaultTelegramDisplayName,
        status: "draft",
        healthStatus: "unknown",
        capabilities: {
          inbound: true,
          outbound: true,
          attachmentsMetadata: true
        },
        onboardingState: {
          step: "name"
        },
        config,
        diagnostics,
        createdByEmployeeId: context.employeeId,
        updatedAt
      });

      return {
        connectorId,
        channelType: telegramChannelType,
        channelClass: telegramChannelClass,
        provider: telegramProvider,
        displayName: request.displayName?.trim() || defaultTelegramDisplayName,
        status: "draft",
        healthStatus: "unknown",
        channelExternalId,
        diagnosticsStatus: diagnostics.status
      };
    },

    async disableChannelConnector(context, input) {
      return updateChannelConnectorLifecycle({
        context,
        repository: options.connectorRepository,
        connectorId: input.connectorId,
        status: "disabled",
        updatedAt: now()
      });
    },

    async deleteChannelConnector(context, input) {
      return updateChannelConnectorLifecycle({
        context,
        repository: options.connectorRepository,
        connectorId: input.connectorId,
        status: "deleted",
        updatedAt: now()
      });
    },

    async loadTelegramIntegration(context, input) {
      const record = await loadExistingTelegramConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId: input?.connectorId
      });

      return telegramResponseFromRecord({
        record,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        checkedAt: now().toISOString()
      });
    },

    async updateTelegramIntegration(context, request) {
      const updatedAt = now();
      const existingRecord = await loadExistingTelegramConnector({
        repository: options.connectorRepository,
        tenantId: context.tenantId,
        connectorId: request.connectorId
      });
      if (request.connectorId?.trim() && !existingRecord) {
        throw new CoreError("validation.failed");
      }

      const existingConfig = parseTelegramConfigFromRecord(existingRecord);
      const connectorId =
        request.connectorId?.trim() ||
        existingRecord?.id ||
        createDefaultTelegramConnectorId(context.tenantId);
      const botTokenSecretRef = await resolveTelegramBotTokenSecretRef({
        context,
        request,
        connectorId,
        existingConfig,
        secretWriter: options.secretWriter,
        updatedAt
      });
      const webhookConnectorId =
        existingConfig?.webhookConnectorId ??
        webhookConnectorIdFactory({
          tenantId: context.tenantId,
          channelExternalId: request.channelExternalId
        });
      const webhookSecretTokenSecretRef =
        await resolveTelegramWebhookSecretTokenSecretRef({
          context,
          connectorId,
          existingConfig,
          secretWriter: options.secretWriter,
          webhookSecretTokenFactory,
          updatedAt
        });
      const config: InternalTelegramIntegrationConfig = {
        channelExternalId: request.channelExternalId,
        mode: request.mode,
        botTokenSecretRef,
        webhookConnectorId,
        webhookSecretTokenSecretRef,
        outboundEnabled: request.outboundEnabled
      };
      const parsedConfig = parseTelegramChannelConfig(config);
      const diagnostics = buildTelegramDiagnostics({
        enabled: request.enabled,
        config: parsedConfig,
        checkedAt: updatedAt.toISOString()
      });
      const status = telegramConnectorStatusFromUpdate({
        existingRecord,
        enabled: request.enabled,
        diagnostics
      });
      const onboardingState = updateTelegramOnboardingState({
        existingState: existingRecord?.onboardingState,
        completedStep: request.setupStepCompleted
      });
      const setupStep = resolveTelegramSetupStep({
        onboardingState,
        config: parsedConfig,
        diagnostics
      });

      await upsertTelegramConnector({
        repository: options.connectorRepository,
        context,
        existingRecord,
        connectorId,
        displayName:
          request.displayName?.trim() ||
          existingRecord?.displayName ||
          defaultTelegramDisplayName,
        enabled: request.enabled,
        config: parsedConfig,
        diagnostics,
        status,
        onboardingState,
        updatedAt
      });

      return telegramResponseFromConfig({
        connectorId,
        displayName:
          request.displayName?.trim() ||
          existingRecord?.displayName ||
          defaultTelegramDisplayName,
        status,
        enabled: request.enabled,
        config: parsedConfig,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        diagnostics,
        setupStep
      });
    },

    async refreshTelegramDiagnostics(context, input) {
      return runTelegramProviderDiagnostics({
        context,
        connectorId: input?.connectorId,
        repository: options.connectorRepository,
        secretResolver,
        botApiClientFactory,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async setTelegramWebhook(context, input) {
      return runTelegramWebhookSync({
        operation: "set",
        context,
        connectorId: input?.connectorId,
        repository: options.connectorRepository,
        secretResolver,
        botApiClientFactory,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async deleteTelegramWebhook(context, input) {
      return runTelegramWebhookSync({
        operation: "delete",
        context,
        connectorId: input?.connectorId,
        repository: options.connectorRepository,
        secretResolver,
        botApiClientFactory,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    }
  };
}

type TelegramProviderOperationOptions = {
  context: InternalIntegrationContext;
  connectorId?: string;
  repository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramBotApiClientFactory;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  now: () => Date;
};

type TelegramWebhookSyncOptions = TelegramProviderOperationOptions & {
  operation: "set" | "delete";
};

export function createEnvSecretResolver(
  env: Record<string, string | undefined> = process.env
): SecretResolver {
  return {
    async resolveSecret({ secretRef }) {
      const envName = secretRef.startsWith("env:")
        ? secretRef.slice("env:".length)
        : secretRef;
      const value = env[envName]?.trim();

      return value && value.length > 0 ? value : null;
    }
  };
}

export function createTenantSecretResolver(input: {
  env?: Record<string, string | undefined>;
  tenantSecrets?: TenantSecretRepository;
}): SecretResolver {
  const envResolver = createEnvSecretResolver(input.env);

  return {
    async resolveSecret({ tenantId, secretRef }) {
      if (secretRef.startsWith("secret:")) {
        return (
          (await input.tenantSecrets?.resolveSecret({ tenantId, secretRef })) ??
          null
        );
      }

      return envResolver.resolveSecret({ tenantId, secretRef });
    }
  };
}

async function loadExistingTelegramConnector(input: {
  repository: ChannelConnectorRepository;
  tenantId: TenantId;
  connectorId?: string;
}): Promise<ChannelConnectorRecord | null> {
  const connectorId = input.connectorId?.trim();

  if (connectorId) {
    const record = await input.repository.findConnector({
      tenantId: input.tenantId,
      connectorId
    });

    return record?.channelType === telegramChannelType ? record : null;
  }

  return input.repository.findFirstConnectorByType({
    tenantId: input.tenantId,
    channelType: telegramChannelType
  });
}

async function updateChannelConnectorLifecycle(input: {
  context: InternalIntegrationContext;
  repository: ChannelConnectorRepository;
  connectorId: string;
  status: "disabled" | "deleted";
  updatedAt: Date;
}): Promise<InternalChannelConnectorSummary> {
  const connectorId = input.connectorId.trim();
  const record = connectorId
    ? await input.repository.findConnector({
        tenantId: input.context.tenantId,
        connectorId
      })
    : null;

  if (!record || record.status === "deleted") {
    throw new CoreError("validation.failed");
  }

  const updatedRecord: ChannelConnectorRecord = {
    ...record,
    status: input.status,
    healthStatus: "unknown",
    diagnostics: buildDisabledChannelConnectorDiagnostics({
      record,
      checkedAt: input.updatedAt.toISOString()
    }),
    updatedAt: input.updatedAt
  };

  await input.repository.upsertConnector({
    id: updatedRecord.id,
    tenantId: updatedRecord.tenantId,
    channelType: updatedRecord.channelType,
    channelClass: updatedRecord.channelClass,
    provider: updatedRecord.provider,
    displayName: updatedRecord.displayName,
    status: updatedRecord.status,
    healthStatus: updatedRecord.healthStatus,
    capabilities: updatedRecord.capabilities,
    onboardingState: updatedRecord.onboardingState,
    config: updatedRecord.config,
    diagnostics: updatedRecord.diagnostics,
    createdByEmployeeId: updatedRecord.createdByEmployeeId,
    updatedAt: updatedRecord.updatedAt
  });

  const summary = channelConnectorSummaryFromRecord(updatedRecord);

  if (!summary) {
    throw new CoreError("validation.failed");
  }

  return summary;
}

function buildDisabledChannelConnectorDiagnostics(input: {
  record: ChannelConnectorRecord;
  checkedAt: string;
}): unknown {
  if (input.record.channelType === telegramChannelType) {
    const config = parseTelegramConfigFromRecord(input.record);

    if (config) {
      return buildTelegramDiagnostics({
        enabled: false,
        config,
        checkedAt: input.checkedAt
      });
    }
  }

  return {
    status: "disabled",
    checkedAt: input.checkedAt
  };
}

function parseTelegramConfigFromRecord(
  record: ChannelConnectorRecord | null
): InternalTelegramIntegrationConfig | null {
  if (!record?.config) {
    return null;
  }

  try {
    return parseTelegramChannelConfig(record.config);
  } catch {
    return null;
  }
}

async function resolveTelegramBotTokenSecretRef(input: {
  context: InternalIntegrationContext;
  request: InternalTelegramIntegrationUpdateRequest;
  connectorId: string;
  existingConfig: InternalTelegramIntegrationConfig | null;
  secretWriter?: SecretWriter;
  updatedAt: Date;
}): Promise<string | undefined> {
  const botToken = input.request.botToken?.trim();

  if (botToken && botToken.length > 0) {
    if (!input.secretWriter) {
      throw new CoreError("validation.failed");
    }

    const secretRef = buildTelegramBotTokenSecretRef({
      tenantId: input.context.tenantId,
      connectorId: input.connectorId
    });

    await input.secretWriter.upsertSecret({
      tenantId: input.context.tenantId,
      secretRef,
      purpose: "telegram.bot_token",
      plainText: botToken,
      updatedAt: input.updatedAt
    });

    return secretRef;
  }

  return (
    input.request.botTokenSecretRef?.trim() ||
    input.existingConfig?.botTokenSecretRef
  );
}

function buildTelegramBotTokenSecretRef(input: {
  tenantId: TenantId;
  connectorId: string;
}): string {
  return createChannelConnectorSecretRef({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    secretName: "bot-token"
  });
}

async function resolveTelegramWebhookSecretTokenSecretRef(input: {
  context: InternalIntegrationContext;
  connectorId: string;
  existingConfig: InternalTelegramIntegrationConfig | null;
  secretWriter?: SecretWriter;
  webhookSecretTokenFactory: () => string;
  updatedAt: Date;
}): Promise<string | undefined> {
  if (input.existingConfig?.webhookSecretTokenSecretRef) {
    return input.existingConfig.webhookSecretTokenSecretRef;
  }

  if (!input.secretWriter) {
    return undefined;
  }

  const secretRef = buildTelegramWebhookSecretTokenSecretRef({
    tenantId: input.context.tenantId,
    connectorId: input.connectorId
  });

  await input.secretWriter.upsertSecret({
    tenantId: input.context.tenantId,
    secretRef,
    purpose: "telegram.webhook_secret_token",
    plainText: input.webhookSecretTokenFactory(),
    updatedAt: input.updatedAt
  });

  return secretRef;
}

function buildTelegramWebhookSecretTokenSecretRef(input: {
  tenantId: TenantId;
  connectorId: string;
}): string {
  return createChannelConnectorSecretRef({
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    secretName: "webhook-secret-token"
  });
}

function createDefaultTelegramConnectorId(tenantId: TenantId): string {
  return `${telegramChannelType}:${tenantId}`;
}

function createRandomChannelConnectorId(
  channelType: InternalChannelType
): string {
  return `${channelType}:${randomUUID()}`;
}

function createDefaultTelegramChannelExternalId(): string {
  return `telegram-${randomUUID().slice(0, 8)}`;
}

function createTelegramWebhookConnectorId(input: {
  tenantId: TenantId;
  channelExternalId: string;
}): string {
  void input;

  return `tgwh_${randomUUID()}`;
}

function createTelegramWebhookSecretToken(): string {
  return randomBytes(32).toString("base64url");
}

async function runTelegramProviderDiagnostics(
  options: TelegramProviderOperationOptions
): Promise<InternalTelegramIntegrationResponse> {
  const state = await loadTelegramState(options);

  if (!state.config || !state.enabled) {
    return state.response;
  }

  const diagnostics = await buildTelegramProviderDiagnostics({
    tenantId: options.context.tenantId,
    config: state.config,
    enabled: state.enabled,
    secretResolver: options.secretResolver,
    botApiClientFactory: options.botApiClientFactory,
    telegramApiBaseUrl: options.telegramApiBaseUrl,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    polling: state.response.diagnostics.polling,
    checkedAt: state.checkedAt
  });

  await persistTelegramDiagnostics({
    ...options,
    existingRecord: state.record,
    connectorId: state.connectorId,
    displayName: state.displayName,
    enabled: state.enabled,
    config: state.config,
    diagnostics,
    updatedAt: state.updatedAt
  });

  return telegramResponseFromConfig({
    connectorId: state.connectorId,
    displayName: state.displayName,
    status: telegramConnectorStatusFromDiagnostics({
      enabled: state.enabled,
      diagnostics
    }),
    setupStep: resolveTelegramSetupStep({
      onboardingState: state.record?.onboardingState,
      config: state.config,
      diagnostics
    }),
    enabled: state.enabled,
    config: state.config,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    diagnostics
  });
}

async function runTelegramWebhookSync(
  options: TelegramWebhookSyncOptions
): Promise<InternalTelegramIntegrationResponse> {
  const state = await loadTelegramState(options);

  if (!state.config || !state.enabled) {
    return state.response;
  }

  const token = await resolveTelegramBotToken({
    tenantId: options.context.tenantId,
    config: state.config,
    secretResolver: options.secretResolver
  });
  const webhookSecretToken = await resolveTelegramWebhookSecretToken({
    tenantId: options.context.tenantId,
    config: state.config,
    secretResolver: options.secretResolver
  });
  const expectedUrl = buildTelegramPublicWebhookUrl(
    options.publicWebhookBaseUrl,
    buildTelegramWebhookPath(state.config)
  );

  if (!token || !expectedUrl || !webhookSecretToken) {
    const diagnostics = buildTelegramDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: telegramWebhookInvalidConfigHint({
        token,
        expectedUrl,
        webhookSecretToken
      }),
      polling: state.response.diagnostics.polling,
      checks: {
        botTokenResolved: Boolean(token),
        webhookSecretTokenResolved: Boolean(webhookSecretToken),
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });

    await persistTelegramDiagnostics({
      ...options,
      existingRecord: state.record,
      connectorId: state.connectorId,
      displayName: state.displayName,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
      connectorId: state.connectorId,
      displayName: state.displayName,
      status: telegramConnectorStatusFromDiagnostics({
        enabled: state.enabled,
        diagnostics
      }),
      setupStep: resolveTelegramSetupStep({
        onboardingState: state.record?.onboardingState,
        config: state.config,
        diagnostics
      }),
      enabled: state.enabled,
      config: state.config,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      diagnostics
    });
  }

  try {
    const client = options.botApiClientFactory({
      apiBaseUrl: options.telegramApiBaseUrl,
      botToken: token
    });

    if (options.operation === "set") {
      await client.setWebhook({
        url: expectedUrl,
        secretToken: webhookSecretToken
      });
    } else {
      await client.deleteWebhook();
    }
  } catch (error) {
    const diagnostics = telegramProviderFailureDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      polling: state.response.diagnostics.polling,
      error
    });

    await persistTelegramDiagnostics({
      ...options,
      existingRecord: state.record,
      connectorId: state.connectorId,
      displayName: state.displayName,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
      connectorId: state.connectorId,
      displayName: state.displayName,
      status: telegramConnectorStatusFromDiagnostics({
        enabled: state.enabled,
        diagnostics
      }),
      setupStep: resolveTelegramSetupStep({
        onboardingState: state.record?.onboardingState,
        config: state.config,
        diagnostics
      }),
      enabled: state.enabled,
      config: state.config,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      diagnostics
    });
  }

  return runTelegramProviderDiagnostics(options);
}

async function loadTelegramState(options: TelegramProviderOperationOptions) {
  const updatedAt = options.now();
  const checkedAt = updatedAt.toISOString();
  const record = await loadExistingTelegramConnector({
    repository: options.repository,
    tenantId: options.context.tenantId,
    connectorId: options.connectorId
  });
  const response = telegramResponseFromRecord({
    record,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    checkedAt
  });

  return {
    record,
    connectorId:
      record?.id ?? createDefaultTelegramConnectorId(options.context.tenantId),
    displayName: record?.displayName ?? defaultTelegramDisplayName,
    enabled: response.enabled,
    config: response.config,
    response,
    updatedAt,
    checkedAt
  };
}

async function persistTelegramDiagnostics(input: {
  context: InternalIntegrationContext;
  repository: ChannelConnectorRepository;
  existingRecord: ChannelConnectorRecord | null;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  updatedAt: Date;
}): Promise<void> {
  await upsertTelegramConnector({
    repository: input.repository,
    context: input.context,
    existingRecord: input.existingRecord,
    connectorId: input.connectorId,
    displayName: input.displayName,
    enabled: input.enabled,
    config: input.config,
    diagnostics: input.diagnostics,
    status: telegramConnectorStatusFromDiagnostics({
      enabled: input.enabled,
      diagnostics: input.diagnostics
    }),
    updatedAt: input.updatedAt
  });
}

async function upsertTelegramConnector(input: {
  repository: ChannelConnectorRepository;
  context: InternalIntegrationContext;
  existingRecord: ChannelConnectorRecord | null;
  connectorId: string;
  displayName: string;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  status: ChannelConnectorRecord["status"];
  onboardingState?: unknown;
  updatedAt: Date;
}): Promise<void> {
  await input.repository.upsertConnector({
    id: input.connectorId,
    tenantId: input.context.tenantId,
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    provider: telegramProvider,
    displayName: input.displayName,
    status: input.status,
    healthStatus: telegramConnectorHealthFromDiagnostics({
      enabled: input.enabled,
      diagnostics: input.diagnostics
    }),
    capabilities: input.existingRecord?.capabilities ?? {
      inbound: true,
      outbound: true,
      attachmentsMetadata: true
    },
    onboardingState:
      input.onboardingState ?? input.existingRecord?.onboardingState ?? {},
    config: input.config,
    diagnostics: input.diagnostics,
    createdByEmployeeId:
      input.existingRecord?.createdByEmployeeId ?? input.context.employeeId,
    updatedAt: input.updatedAt
  });
}

async function buildTelegramProviderDiagnostics(input: {
  tenantId: TenantId;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  secretResolver: SecretResolver;
  botApiClientFactory: TelegramBotApiClientFactory;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  checkedAt: string;
}): Promise<InternalTelegramIntegrationDiagnostics> {
  const token = await resolveTelegramBotToken(input);

  if (!token) {
    return buildTelegramDiagnostics({
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: "Bot token secret could not be resolved.",
      polling: input.polling,
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
      botToken: token
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
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      status:
        input.config.mode === "webhook" && !webhookMatchesConfig
          ? "webhook_mismatch"
          : "configured",
      operatorHint:
        expectedUrl === undefined
          ? "Public webhook base URL is not configured."
          : undefined,
      polling: input.polling,
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
      checks: {
        botTokenResolved: true,
        botApiReachable: true,
        webhookMatchesConfig
      }
    });
  } catch (error) {
    return telegramProviderFailureDiagnostics({
      enabled: input.enabled,
      config: input.config,
      checkedAt: input.checkedAt,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      polling: input.polling,
      error
    });
  }
}

async function resolveTelegramBotToken(input: {
  tenantId: TenantId;
  config: InternalTelegramIntegrationConfig;
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

async function resolveTelegramWebhookSecretToken(input: {
  tenantId: TenantId;
  config: InternalTelegramIntegrationConfig;
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

function telegramProviderFailureDiagnostics(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
  error: unknown;
}): InternalTelegramIntegrationDiagnostics {
  return buildTelegramDiagnostics({
    enabled: input.enabled,
    config: input.config,
    checkedAt: input.checkedAt,
    publicWebhookBaseUrl: input.publicWebhookBaseUrl,
    status: "provider_unreachable",
    lastErrorCode: platformErrorCodeFromTelegramError(input.error),
    operatorHint: "Telegram Bot API call failed.",
    polling: input.polling,
    checks: {
      botTokenResolved: true,
      botApiReachable: false,
      webhookMatchesConfig: false
    }
  });
}

function telegramResponseFromRecord(input: {
  record: ChannelConnectorRecord | null;
  publicWebhookBaseUrl?: string;
  checkedAt: string;
}): InternalTelegramIntegrationResponse {
  if (!input.record?.config) {
    const diagnostics = buildDisabledTelegramDiagnostics(input.checkedAt);

    return {
      moduleId: telegramModuleId,
      enabled: false,
      diagnostics
    };
  }

  try {
    const enabled = isTelegramConnectorEnabled(input.record);
    const config = parseTelegramChannelConfig(input.record.config);
    const diagnostics = buildTelegramDiagnostics({
      enabled,
      config,
      checkedAt: input.checkedAt
    });

    const storedDiagnostics = parseStoredTelegramDiagnostics(
      input.record.diagnostics
    );

    return telegramResponseFromConfig({
      connectorId: input.record.id,
      displayName: input.record.displayName,
      status: input.record.status,
      setupStep: resolveTelegramSetupStep({
        onboardingState: input.record.onboardingState,
        config,
        diagnostics: enabled ? (storedDiagnostics ?? diagnostics) : diagnostics
      }),
      enabled,
      config,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      diagnostics: enabled ? (storedDiagnostics ?? diagnostics) : diagnostics
    });
  } catch {
    return {
      moduleId: telegramModuleId,
      connectorId: input.record.id,
      channelType: telegramChannelType,
      channelClass: telegramChannelClass,
      displayName: input.record.displayName,
      status: internalTelegramConnectorStatus(input.record.status),
      enabled: isTelegramConnectorEnabled(input.record),
      diagnostics: buildInvalidTelegramDiagnostics(input.checkedAt)
    };
  }
}

function channelConnectorSummaryFromRecord(
  record: ChannelConnectorRecord
): InternalChannelConnectorSummary | null {
  const channelType = internalChannelType(record.channelType);
  const channelClass = internalChannelClass(record.channelClass);
  const status = internalChannelConnectorStatus(record.status);
  const healthStatus = internalChannelConnectorHealthStatus(
    record.healthStatus
  );

  if (!channelType || !channelClass || !status || !healthStatus) {
    return null;
  }

  const channelExternalId = readRecordString(
    record.config,
    "channelExternalId"
  );
  const diagnosticsStatus = readRecordString(record.diagnostics, "status");

  return {
    connectorId: record.id,
    channelType,
    channelClass,
    provider: record.provider,
    displayName: record.displayName,
    status,
    healthStatus,
    ...(channelExternalId ? { channelExternalId } : {}),
    ...(diagnosticsStatus ? { diagnosticsStatus } : {})
  };
}

function internalChannelType(
  value: ChannelConnectorRecord["channelType"]
): InternalChannelType | null {
  switch (value) {
    case "telegram_bot":
    case "telegram_qr_bridge":
    case "whatsapp_qr_bridge":
    case "max_qr_bridge":
    case "max_bot":
    case "vk_community":
      return value as InternalChannelType;
    default:
      return null;
  }
}

function internalChannelClass(
  value: ChannelConnectorRecord["channelClass"]
): InternalChannelClass | null {
  switch (value) {
    case "bot_bridge":
    case "user_bridge":
    case "official_api":
      return value as InternalChannelClass;
    default:
      return null;
  }
}

function internalChannelConnectorStatus(
  value: ChannelConnectorRecord["status"]
): InternalChannelConnectorStatus | null {
  switch (value) {
    case "draft":
    case "onboarding":
    case "authorizing":
    case "connected":
    case "degraded":
    case "reauth_required":
    case "disabled":
    case "failed":
    case "deleted":
      return value as InternalChannelConnectorStatus;
    default:
      return null;
  }
}

function internalChannelConnectorHealthStatus(
  value: ChannelConnectorRecord["healthStatus"]
): InternalChannelConnectorHealthStatus | null {
  switch (value) {
    case "unknown":
    case "healthy":
    case "degraded":
    case "unhealthy":
      return value as InternalChannelConnectorHealthStatus;
    default:
      return null;
  }
}

function readRecordString(input: unknown, key: string): string | undefined {
  if (!isRecord(input)) {
    return undefined;
  }

  const value = input[key];

  return typeof value === "string" && value.trim().length > 0
    ? value
    : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function telegramResponseFromConfig(input: {
  connectorId?: string;
  displayName?: string;
  status?: ChannelConnectorRecord["status"];
  setupStep?: InternalTelegramSetupStep;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  publicWebhookBaseUrl?: string;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): InternalTelegramIntegrationResponse {
  const webhookPath = buildTelegramWebhookPath(input.config);
  const publicWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    webhookPath
  );

  return {
    moduleId: telegramModuleId,
    ...(input.connectorId ? { connectorId: input.connectorId } : {}),
    channelType: telegramChannelType,
    channelClass: telegramChannelClass,
    ...(input.displayName ? { displayName: input.displayName } : {}),
    ...(input.status
      ? { status: internalTelegramConnectorStatus(input.status) }
      : {}),
    ...(input.setupStep ? { setupStep: input.setupStep } : {}),
    enabled: input.enabled,
    config: input.config,
    webhookPath,
    ...(publicWebhookUrl ? { publicWebhookUrl } : {}),
    diagnostics: input.diagnostics
  };
}

function internalTelegramConnectorStatus(
  status: ChannelConnectorRecord["status"]
): InternalTelegramIntegrationResponse["status"] {
  if (
    status === "draft" ||
    status === "onboarding" ||
    status === "authorizing" ||
    status === "connected" ||
    status === "degraded" ||
    status === "reauth_required" ||
    status === "disabled" ||
    status === "failed" ||
    status === "deleted"
  ) {
    return status as InternalTelegramIntegrationResponse["status"];
  }

  return "failed";
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

function telegramConnectorStatusFromDiagnostics(input: {
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["status"] {
  if (!input.enabled) {
    return "disabled";
  }

  if (input.diagnostics.status === "invalid_config") {
    return "reauth_required";
  }

  if (
    input.diagnostics.status === "provider_unreachable" ||
    input.diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "connected";
}

function telegramConnectorStatusFromUpdate(input: {
  existingRecord: ChannelConnectorRecord | null;
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["status"] {
  if (
    !input.enabled &&
    (input.existingRecord?.status === "draft" ||
      input.existingRecord?.status === "onboarding")
  ) {
    return "draft";
  }

  return telegramConnectorStatusFromDiagnostics({
    enabled: input.enabled,
    diagnostics: input.diagnostics
  });
}

function updateTelegramOnboardingState(input: {
  existingState: unknown;
  completedStep?: "name" | "token" | "mode";
}): unknown {
  const existingState = isRecord(input.existingState)
    ? input.existingState
    : {};

  switch (input.completedStep) {
    case "name":
      return {
        ...existingState,
        step: "token"
      };
    case "token":
      return {
        ...existingState,
        step: "mode"
      };
    case "mode":
      return {
        ...existingState,
        step: "diagnostics"
      };
    default:
      return existingState;
  }
}

function resolveTelegramSetupStep(input: {
  onboardingState: unknown;
  config?: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): InternalTelegramSetupStep {
  if (
    input.config?.mode === "webhook" &&
    input.diagnostics.checks.inboundWebhookReady
  ) {
    return "complete";
  }

  if (
    input.config?.mode === "polling" &&
    input.diagnostics.status === "configured"
  ) {
    return "complete";
  }

  if (
    input.config?.mode === "webhook" &&
    input.diagnostics.checks.botApiReachable === true &&
    !input.diagnostics.checks.inboundWebhookReady
  ) {
    return "webhook";
  }

  const storedStep = readRecordString(input.onboardingState, "step");

  if (isTelegramSetupStep(storedStep)) {
    return storedStep;
  }

  if (!input.config?.botTokenSecretRef) {
    return "token";
  }

  if (input.diagnostics.checks.botApiReachable !== true) {
    return "diagnostics";
  }

  return input.config.mode === "webhook" ? "webhook" : "complete";
}

function isTelegramSetupStep(
  value: string | undefined
): value is InternalTelegramSetupStep {
  return (
    value === "name" ||
    value === "token" ||
    value === "mode" ||
    value === "diagnostics" ||
    value === "webhook" ||
    value === "complete"
  );
}

function telegramConnectorHealthFromDiagnostics(input: {
  enabled: boolean;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord["healthStatus"] {
  if (!input.enabled) {
    return "unknown";
  }

  if (input.diagnostics.status === "configured") {
    return "healthy";
  }

  if (
    input.diagnostics.status === "provider_unreachable" ||
    input.diagnostics.status === "webhook_mismatch"
  ) {
    return "degraded";
  }

  return "unhealthy";
}

function buildTelegramDiagnostics(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
  status?: InternalTelegramIntegrationDiagnostics["status"];
  lastErrorCode?: PlatformErrorCode;
  operatorHint?: string;
  bot?: InternalTelegramIntegrationDiagnostics["bot"];
  webhook?: InternalTelegramIntegrationDiagnostics["webhook"];
  checks?: Partial<InternalTelegramIntegrationDiagnostics["checks"]>;
  polling?: InternalTelegramIntegrationDiagnostics["polling"];
}): InternalTelegramIntegrationDiagnostics {
  const webhookPath = buildTelegramWebhookPath(input.config);
  const expectedWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    webhookPath
  );
  const webhook =
    input.webhook ??
    (expectedWebhookUrl === undefined
      ? undefined
      : {
          expectedUrl: expectedWebhookUrl
        });

  if (!input.enabled) {
    return withOptionalTelegramDiagnostics(
      {
        status: "disabled",
        checkedAt: input.checkedAt,
        checks: {
          moduleEnabled: false,
          configValid: true,
          inboundWebhookReady: false,
          outboundEnabled: input.config.outboundEnabled,
          botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
          ...input.checks
        }
      },
      {
        lastErrorCode: input.lastErrorCode,
        operatorHint: input.operatorHint,
        bot: input.bot,
        webhook,
        polling: input.polling
      }
    );
  }

  const webhookMatchesConfig = input.checks?.webhookMatchesConfig;
  const inboundWebhookReady =
    input.config.mode === "webhook" ? webhookMatchesConfig === true : false;

  return withOptionalTelegramDiagnostics(
    {
      status: input.status ?? "configured",
      checkedAt: input.checkedAt,
      checks: {
        moduleEnabled: true,
        configValid: true,
        inboundWebhookReady,
        outboundEnabled: input.config.outboundEnabled,
        botTokenSecretRefConfigured: Boolean(input.config.botTokenSecretRef),
        ...input.checks
      }
    },
    {
      lastErrorCode: input.lastErrorCode,
      operatorHint: input.operatorHint,
      bot: input.bot,
      webhook,
      polling: input.polling
    }
  );
}

function withOptionalTelegramDiagnostics(
  base: InternalTelegramIntegrationDiagnostics,
  optional: {
    lastErrorCode?: PlatformErrorCode;
    operatorHint?: string;
    bot?: InternalTelegramIntegrationDiagnostics["bot"];
    webhook?: InternalTelegramIntegrationDiagnostics["webhook"];
    polling?: InternalTelegramIntegrationDiagnostics["polling"];
  }
): InternalTelegramIntegrationDiagnostics {
  return {
    ...base,
    ...(optional.lastErrorCode
      ? { lastErrorCode: optional.lastErrorCode }
      : {}),
    ...(optional.operatorHint ? { operatorHint: optional.operatorHint } : {}),
    ...(optional.bot ? { bot: optional.bot } : {}),
    ...(optional.webhook ? { webhook: optional.webhook } : {}),
    ...(optional.polling ? { polling: optional.polling } : {})
  };
}

function buildDisabledTelegramDiagnostics(
  checkedAt: string
): InternalTelegramIntegrationDiagnostics {
  return {
    status: "disabled",
    checkedAt,
    checks: {
      moduleEnabled: false,
      configValid: false,
      inboundWebhookReady: false,
      outboundEnabled: false,
      botTokenSecretRefConfigured: false
    }
  };
}

function buildInvalidTelegramDiagnostics(
  checkedAt: string
): InternalTelegramIntegrationDiagnostics {
  return {
    status: "invalid_config",
    lastErrorCode: "validation.failed" satisfies PlatformErrorCode,
    checkedAt,
    checks: {
      moduleEnabled: true,
      configValid: false,
      inboundWebhookReady: false,
      outboundEnabled: false,
      botTokenSecretRefConfigured: false
    }
  };
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function buildTelegramWebhookPath(
  config: Pick<
    InternalTelegramIntegrationConfig,
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
