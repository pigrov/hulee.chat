import type {
  EmployeeId,
  InternalTelegramIntegrationConfig,
  InternalTelegramIntegrationDiagnostics,
  InternalTelegramIntegrationResponse,
  InternalTelegramIntegrationUpdateRequest,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { internalTelegramIntegrationDiagnosticsSchema } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  TenantModuleConfigRepository,
  TenantSecretRepository
} from "@hulee/db";
import { createTenantSecretRef } from "@hulee/db";
import {
  createTelegramBotApiClient,
  parseTelegramChannelConfig,
  telegramChannelManifest,
  TelegramAdapterError,
  type TelegramBotApiClient,
  type TelegramBotApiSettings
} from "@hulee/modules";

export type InternalIntegrationContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalIntegrationService = {
  loadTelegramIntegration(
    context: InternalIntegrationContext
  ): Promise<InternalTelegramIntegrationResponse>;
  updateTelegramIntegration(
    context: InternalIntegrationContext,
    request: InternalTelegramIntegrationUpdateRequest
  ): Promise<InternalTelegramIntegrationResponse>;
  refreshTelegramDiagnostics(
    context: InternalIntegrationContext
  ): Promise<InternalTelegramIntegrationResponse>;
  setTelegramWebhook(
    context: InternalIntegrationContext
  ): Promise<InternalTelegramIntegrationResponse>;
  deleteTelegramWebhook(
    context: InternalIntegrationContext
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
    purpose: "telegram.bot_token";
    plainText: string;
    updatedAt: Date;
  }): Promise<void>;
};

export type TelegramBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramBotApiClient;

export type InternalIntegrationServiceOptions = {
  repository: TenantModuleConfigRepository;
  secretResolver?: SecretResolver;
  secretWriter?: SecretWriter;
  botApiClientFactory?: TelegramBotApiClientFactory;
  telegramApiBaseUrl?: string;
  publicWebhookBaseUrl?: string;
  now?: () => Date;
};

const telegramModuleId = "channel-telegram" as const;

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

  return {
    async loadTelegramIntegration(context) {
      const record = await options.repository.findConfig({
        tenantId: context.tenantId,
        moduleId: telegramModuleId
      });

      return telegramResponseFromRecord({
        enabled: record?.enabled ?? false,
        configInput: record?.config,
        diagnosticsInput: record?.diagnostics,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        checkedAt: now().toISOString()
      });
    },

    async updateTelegramIntegration(context, request) {
      const updatedAt = now();
      const existingConfig = await loadExistingTelegramConfig({
        repository: options.repository,
        tenantId: context.tenantId
      });
      const botTokenSecretRef = await resolveTelegramBotTokenSecretRef({
        context,
        request,
        existingConfig,
        secretWriter: options.secretWriter,
        updatedAt
      });
      const config: InternalTelegramIntegrationConfig = {
        channelExternalId: request.channelExternalId,
        mode: request.mode,
        botTokenSecretRef,
        outboundEnabled: request.outboundEnabled
      };
      const parsedConfig = parseTelegramChannelConfig(config);
      const diagnostics = buildTelegramDiagnostics({
        enabled: request.enabled,
        config: parsedConfig,
        checkedAt: updatedAt.toISOString()
      });

      await options.repository.upsertConfig({
        tenantId: context.tenantId,
        moduleId: telegramModuleId,
        enabled: request.enabled,
        config: parsedConfig,
        diagnostics,
        updatedAt
      });

      return telegramResponseFromConfig({
        enabled: request.enabled,
        config: parsedConfig,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        diagnostics
      });
    },

    async refreshTelegramDiagnostics(context) {
      return runTelegramProviderDiagnostics({
        context,
        repository: options.repository,
        secretResolver,
        botApiClientFactory,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async setTelegramWebhook(context) {
      return runTelegramWebhookSync({
        operation: "set",
        context,
        repository: options.repository,
        secretResolver,
        botApiClientFactory,
        telegramApiBaseUrl: options.telegramApiBaseUrl,
        publicWebhookBaseUrl: options.publicWebhookBaseUrl,
        now
      });
    },

    async deleteTelegramWebhook(context) {
      return runTelegramWebhookSync({
        operation: "delete",
        context,
        repository: options.repository,
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
  repository: TenantModuleConfigRepository;
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

async function loadExistingTelegramConfig(input: {
  repository: TenantModuleConfigRepository;
  tenantId: TenantId;
}): Promise<InternalTelegramIntegrationConfig | null> {
  const record = await input.repository.findConfig({
    tenantId: input.tenantId,
    moduleId: telegramModuleId
  });

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
  existingConfig: InternalTelegramIntegrationConfig | null;
  secretWriter?: SecretWriter;
  updatedAt: Date;
}): Promise<string | undefined> {
  const botToken = input.request.botToken?.trim();

  if (botToken && botToken.length > 0) {
    if (!input.secretWriter) {
      throw new CoreError("validation.failed");
    }

    const secretRef = buildTelegramBotTokenSecretRef(input.context.tenantId);

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

function buildTelegramBotTokenSecretRef(tenantId: TenantId): string {
  return createTenantSecretRef({
    tenantId,
    moduleId: telegramModuleId,
    secretName: "bot-token"
  });
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
    checkedAt: state.checkedAt
  });

  await persistTelegramDiagnostics({
    ...options,
    enabled: state.enabled,
    config: state.config,
    diagnostics,
    updatedAt: state.updatedAt
  });

  return telegramResponseFromConfig({
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
  const expectedUrl = buildTelegramPublicWebhookUrl(
    options.publicWebhookBaseUrl,
    buildTelegramWebhookPath(state.config.channelExternalId)
  );

  if (!token || !expectedUrl) {
    const diagnostics = buildTelegramDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      operatorHint: !token
        ? "Bot token secret could not be resolved."
        : "Public webhook base URL is not configured.",
      checks: {
        botTokenResolved: Boolean(token),
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });

    await persistTelegramDiagnostics({
      ...options,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
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
      await client.setWebhook({ url: expectedUrl });
    } else {
      await client.deleteWebhook();
    }
  } catch (error) {
    const diagnostics = telegramProviderFailureDiagnostics({
      enabled: state.enabled,
      config: state.config,
      checkedAt: state.checkedAt,
      publicWebhookBaseUrl: options.publicWebhookBaseUrl,
      error
    });

    await persistTelegramDiagnostics({
      ...options,
      enabled: state.enabled,
      config: state.config,
      diagnostics,
      updatedAt: state.updatedAt
    });

    return telegramResponseFromConfig({
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
  const record = await options.repository.findConfig({
    tenantId: options.context.tenantId,
    moduleId: telegramModuleId
  });
  const response = telegramResponseFromRecord({
    enabled: record?.enabled ?? false,
    configInput: record?.config,
    diagnosticsInput: record?.diagnostics,
    publicWebhookBaseUrl: options.publicWebhookBaseUrl,
    checkedAt
  });

  return {
    enabled: response.enabled,
    config: response.config,
    response,
    updatedAt,
    checkedAt
  };
}

async function persistTelegramDiagnostics(input: {
  context: InternalIntegrationContext;
  repository: TenantModuleConfigRepository;
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  diagnostics: InternalTelegramIntegrationDiagnostics;
  updatedAt: Date;
}): Promise<void> {
  await input.repository.upsertConfig({
    tenantId: input.context.tenantId,
    moduleId: telegramModuleId,
    enabled: input.enabled,
    config: input.config,
    diagnostics: input.diagnostics,
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
      buildTelegramWebhookPath(input.config.channelExternalId)
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

function telegramProviderFailureDiagnostics(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  checkedAt: string;
  publicWebhookBaseUrl?: string;
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
    checks: {
      botTokenResolved: true,
      botApiReachable: false,
      webhookMatchesConfig: false
    }
  });
}

function telegramResponseFromRecord(input: {
  enabled: boolean;
  configInput: unknown;
  diagnosticsInput: unknown;
  publicWebhookBaseUrl?: string;
  checkedAt: string;
}): InternalTelegramIntegrationResponse {
  if (!input.configInput) {
    const diagnostics = buildDisabledTelegramDiagnostics(input.checkedAt);

    return {
      moduleId: telegramModuleId,
      enabled: false,
      diagnostics
    };
  }

  try {
    const config = parseTelegramChannelConfig(input.configInput);
    const diagnostics = buildTelegramDiagnostics({
      enabled: input.enabled,
      config,
      checkedAt: input.checkedAt
    });

    const storedDiagnostics = parseStoredTelegramDiagnostics(
      input.diagnosticsInput
    );

    return telegramResponseFromConfig({
      enabled: input.enabled,
      config,
      publicWebhookBaseUrl: input.publicWebhookBaseUrl,
      diagnostics: input.enabled
        ? (storedDiagnostics ?? diagnostics)
        : diagnostics
    });
  } catch {
    return {
      moduleId: telegramModuleId,
      enabled: input.enabled,
      diagnostics: buildInvalidTelegramDiagnostics(input.checkedAt)
    };
  }
}

function telegramResponseFromConfig(input: {
  enabled: boolean;
  config: InternalTelegramIntegrationConfig;
  publicWebhookBaseUrl?: string;
  diagnostics: InternalTelegramIntegrationDiagnostics;
}): InternalTelegramIntegrationResponse {
  const webhookPath = buildTelegramWebhookPath(input.config.channelExternalId);
  const publicWebhookUrl = buildTelegramPublicWebhookUrl(
    input.publicWebhookBaseUrl,
    webhookPath
  );

  return {
    moduleId: telegramModuleId,
    enabled: input.enabled,
    config: input.config,
    webhookPath,
    ...(publicWebhookUrl ? { publicWebhookUrl } : {}),
    diagnostics: input.diagnostics
  };
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
}): InternalTelegramIntegrationDiagnostics {
  const webhookPath = buildTelegramWebhookPath(input.config.channelExternalId);
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
        webhook
      }
    );
  }

  const webhookMatchesConfig = input.checks?.webhookMatchesConfig;
  const inboundWebhookReady =
    input.config.mode === "webhook" ? (webhookMatchesConfig ?? true) : false;

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
      webhook
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
  }
): InternalTelegramIntegrationDiagnostics {
  return {
    ...base,
    ...(optional.lastErrorCode
      ? { lastErrorCode: optional.lastErrorCode }
      : {}),
    ...(optional.operatorHint ? { operatorHint: optional.operatorHint } : {}),
    ...(optional.bot ? { bot: optional.bot } : {}),
    ...(optional.webhook ? { webhook: optional.webhook } : {})
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

function buildTelegramWebhookPath(channelExternalId: string): string {
  if (!channelExternalId) {
    throw new CoreError("validation.failed");
  }

  return `/webhooks/telegram/${encodeURIComponent(channelExternalId)}`;
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
