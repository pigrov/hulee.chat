import type {
  DeliveryResult,
  InternalTelegramIntegrationDiagnostics,
  MessageId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { internalTelegramIntegrationDiagnosticsSchema } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  OutboundDispatchRepository,
  QueuedOutboundMessageForDispatch,
  TenantSecretRepository
} from "@hulee/db";
import {
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  managedMessengerVpnEgressRequirement,
  parseTelegramChannelConfig,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiSettings,
  type TelegramMessageSender
} from "@hulee/modules";

import type { OutboxHandler, OutboxRecord } from "./outbox-processor";

export type SecretResolver = {
  resolveSecret(input: {
    tenantId: TenantId;
    secretRef: string;
  }): Promise<string | null>;
};

export type TelegramBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramMessageSender;

export type TelegramOutboundDispatcherOptions = {
  outboundRepository: OutboundDispatchRepository;
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  botApiClientFactory?: TelegramBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  now?: () => Date;
  attemptIdFactory?: (input: {
    tenantId: TenantId;
    messageId: MessageId;
    outcome: "sent" | "failed";
  }) => string;
  telegramApiBaseUrl?: string;
};

const telegramChannelType = "telegram_bot";

export function createTelegramOutboundDispatcher(
  options: TelegramOutboundDispatcherOptions
): OutboxHandler {
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const now = options.now ?? (() => new Date());
  const attemptIdFactory =
    options.attemptIdFactory ??
    ((input) =>
      `delivery_attempt:${input.tenantId}:${input.messageId}:${input.outcome}`);

  return {
    async handle(record: OutboxRecord): Promise<void> {
      if (record.payload.type !== "message.sent") {
        return;
      }

      const queuedMessage = await options.outboundRepository.findQueuedMessage({
        tenantId: record.tenantId,
        messageId: record.payload.payload.messageId
      });

      if (queuedMessage === null) {
        return;
      }

      const configRecord =
        await options.connectorRepository.findActiveConnectorByExternalId({
          tenantId: record.tenantId,
          channelType: telegramChannelType,
          channelExternalId: queuedMessage.channelExternalId
        });

      if (configRecord === null) {
        return;
      }

      const config = parseTelegramChannelConfig(configRecord.config);

      if (config.channelExternalId !== queuedMessage.channelExternalId) {
        return;
      }

      if (!config.outboundEnabled) {
        return;
      }

      try {
        const botToken = await resolveBotToken(
          options.secretResolver,
          record.tenantId,
          config.botTokenSecretRef
        );
        const egressResolution = await resolveTelegramEgressProfile({
          egressRuntime,
          tenantId: record.tenantId,
          connectorId: configRecord.id,
          checkedAt: now().toISOString()
        });
        const adapter = createTelegramChannelAdapter({
          botApiClient: botApiClientFactory({
            apiBaseUrl: options.telegramApiBaseUrl,
            botToken,
            egress: buildTelegramBotApiEgressBinding({
              egressRuntime,
              resolution: egressResolution,
              tenantId: record.tenantId,
              connectorId: configRecord.id
            })
          })
        });
        const result = await adapter.sendMessage({
          tenantId: queuedMessage.tenantId,
          conversationId: queuedMessage.conversationId,
          messageId: queuedMessage.messageId,
          channelExternalId: queuedMessage.channelExternalId,
          clientExternalId: queuedMessage.clientExternalId,
          text: queuedMessage.text,
          idempotencyKey: queuedMessage.idempotencyKey
        });
        const outcome = await persistDeliveryResult({
          repository: options.outboundRepository,
          attemptIdFactory,
          now,
          message: queuedMessage,
          result
        });

        await persistOutboundRuntimeDiagnostics({
          connectorRepository: options.connectorRepository,
          connectorRecord: configRecord,
          checkedAt: now().toISOString(),
          event:
            outcome === "sent"
              ? {
                  kind: "sent",
                  messageId: queuedMessage.messageId,
                  providerMessageId:
                    result.providerMessageId ?? queuedMessage.messageId
                }
              : {
                  kind: "failed",
                  messageId: queuedMessage.messageId,
                  errorCode: result.errorCode ?? "provider.permanent_failure",
                  operatorHint: "Telegram outbound message was rejected."
                }
        });
      } catch (error) {
        await persistOutboundRuntimeDiagnostics({
          connectorRepository: options.connectorRepository,
          connectorRecord: configRecord,
          checkedAt: now().toISOString(),
          event: {
            kind: "failed",
            messageId: queuedMessage.messageId,
            errorCode: platformErrorCodeFromUnknown(error),
            operatorHint: "Telegram outbound message dispatch failed."
          }
        });
        throw error;
      }
    }
  };
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

async function resolveBotToken(
  secretResolver: SecretResolver,
  tenantId: TenantId,
  secretRef: string | undefined
): Promise<string> {
  if (!secretRef) {
    throw new CoreError("validation.failed");
  }

  const token = await secretResolver.resolveSecret({
    tenantId,
    secretRef
  });

  if (!token) {
    throw new CoreError("validation.failed");
  }

  return token;
}

async function persistDeliveryResult(input: {
  repository: OutboundDispatchRepository;
  attemptIdFactory: NonNullable<
    TelegramOutboundDispatcherOptions["attemptIdFactory"]
  >;
  now: () => Date;
  message: QueuedOutboundMessageForDispatch;
  result: DeliveryResult;
}): Promise<"sent" | "failed"> {
  if (input.result.status === "sent" || input.result.status === "accepted") {
    await input.repository.markSent({
      tenantId: input.message.tenantId,
      messageId: input.message.messageId,
      providerMessageId:
        input.result.providerMessageId ?? input.message.messageId,
      attemptId: input.attemptIdFactory({
        tenantId: input.message.tenantId,
        messageId: input.message.messageId,
        outcome: "sent"
      }),
      deliveredAt: input.now()
    });
    return "sent";
  }

  const errorCode = input.result.errorCode ?? "provider.permanent_failure";

  if (input.result.retryability === "retryable") {
    throw new CoreError(errorCode);
  }

  await input.repository.markFailed({
    tenantId: input.message.tenantId,
    messageId: input.message.messageId,
    errorCode: ensurePlatformErrorCode(errorCode),
    attemptId: input.attemptIdFactory({
      tenantId: input.message.tenantId,
      messageId: input.message.messageId,
      outcome: "failed"
    }),
    failedAt: input.now()
  });

  return "failed";
}

async function persistOutboundRuntimeDiagnostics(input: {
  connectorRepository: ChannelConnectorRepository;
  connectorRecord: ChannelConnectorRecord;
  checkedAt: string;
  event:
    | {
        kind: "sent";
        messageId: MessageId;
        providerMessageId: string;
      }
    | {
        kind: "failed";
        messageId: MessageId;
        errorCode: PlatformErrorCode;
        operatorHint: string;
      };
}): Promise<void> {
  try {
    const record =
      (await input.connectorRepository.findConnector({
        tenantId: input.connectorRecord.tenantId,
        connectorId: input.connectorRecord.id
      })) ?? input.connectorRecord;
    const diagnostics = buildOutboundRuntimeDiagnostics({
      checkedAt: input.checkedAt,
      event: input.event,
      previous: parseStoredTelegramDiagnostics(record.diagnostics)
    });

    await input.connectorRepository.upsertConnector({
      id: record.id,
      tenantId: record.tenantId,
      channelType: record.channelType,
      channelClass: record.channelClass,
      provider: record.provider,
      displayName: record.displayName,
      status: record.status,
      healthStatus: record.healthStatus,
      capabilities: record.capabilities,
      onboardingState: record.onboardingState,
      config: record.config,
      diagnostics,
      createdByEmployeeId: record.createdByEmployeeId,
      updatedAt: new Date(input.checkedAt)
    });
  } catch {
    return;
  }
}

function buildOutboundRuntimeDiagnostics(input: {
  checkedAt: string;
  event:
    | {
        kind: "sent";
        messageId: MessageId;
        providerMessageId: string;
      }
    | {
        kind: "failed";
        messageId: MessageId;
        errorCode: PlatformErrorCode;
        operatorHint: string;
      };
  previous: InternalTelegramIntegrationDiagnostics | null;
}): InternalTelegramIntegrationDiagnostics {
  const previousOutbound = input.previous?.runtime?.outbound;
  const outbound =
    input.event.kind === "sent"
      ? {
          lastAttemptAt: input.checkedAt,
          lastSentAt: input.checkedAt,
          ...(previousOutbound?.lastFailedAt
            ? { lastFailedAt: previousOutbound.lastFailedAt }
            : {}),
          lastMessageId: input.event.messageId,
          lastProviderMessageId: input.event.providerMessageId,
          ...(previousOutbound?.lastErrorCode
            ? { lastErrorCode: previousOutbound.lastErrorCode }
            : {})
        }
      : {
          lastAttemptAt: input.checkedAt,
          ...(previousOutbound?.lastSentAt
            ? { lastSentAt: previousOutbound.lastSentAt }
            : {}),
          lastFailedAt: input.checkedAt,
          lastMessageId: input.event.messageId,
          ...(previousOutbound?.lastProviderMessageId
            ? {
                lastProviderMessageId: previousOutbound.lastProviderMessageId
              }
            : {}),
          lastErrorCode: input.event.errorCode,
          operatorHint: input.event.operatorHint
        };

  return internalTelegramIntegrationDiagnosticsSchema.parse({
    status: input.previous?.status ?? "configured",
    checkedAt: input.checkedAt,
    ...(input.previous?.lastErrorCode
      ? { lastErrorCode: input.previous.lastErrorCode }
      : {}),
    ...(input.previous?.operatorHint
      ? { operatorHint: input.previous.operatorHint }
      : {}),
    ...(input.previous?.bot ? { bot: input.previous.bot } : {}),
    ...(input.previous?.webhook ? { webhook: input.previous.webhook } : {}),
    ...(input.previous?.polling ? { polling: input.previous.polling } : {}),
    ...(input.previous?.egress ? { egress: input.previous.egress } : {}),
    runtime: {
      ...(input.previous?.runtime?.inbound
        ? { inbound: input.previous.runtime.inbound }
        : {}),
      outbound
    },
    checks: input.previous?.checks ?? buildOutboundRuntimeFallbackChecks()
  });
}

function buildOutboundRuntimeFallbackChecks(): InternalTelegramIntegrationDiagnostics["checks"] {
  return {
    moduleEnabled: true,
    configValid: true,
    inboundWebhookReady: false,
    outboundEnabled: true,
    botTokenSecretRefConfigured: true
  };
}

function parseStoredTelegramDiagnostics(
  input: unknown
): InternalTelegramIntegrationDiagnostics | null {
  const result = internalTelegramIntegrationDiagnosticsSchema.safeParse(input);

  return result.success ? result.data : null;
}

function platformErrorCodeFromUnknown(error: unknown): PlatformErrorCode {
  if (error instanceof CoreError) {
    return error.code;
  }

  if (
    error instanceof Error &&
    "code" in error &&
    typeof error.code === "string" &&
    (error.code === "provider.temporary_failure" ||
      error.code === "provider.permanent_failure" ||
      error.code === "validation.failed")
  ) {
    return error.code;
  }

  return "provider.temporary_failure";
}

function ensurePlatformErrorCode(code: PlatformErrorCode): PlatformErrorCode {
  return code;
}
