import type {
  DeliveryResult,
  MessageId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  OutboundDispatchRepository,
  QueuedOutboundMessageForDispatch,
  TenantModuleConfigRepository,
  TenantSecretRepository
} from "@hulee/db";
import {
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  parseTelegramChannelConfig,
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
  moduleConfigRepository: TenantModuleConfigRepository;
  secretResolver: SecretResolver;
  botApiClientFactory?: TelegramBotApiClientFactory;
  now?: () => Date;
  attemptIdFactory?: (input: {
    tenantId: TenantId;
    messageId: MessageId;
    outcome: "sent" | "failed";
  }) => string;
  telegramApiBaseUrl?: string;
};

const telegramModuleId = "channel-telegram";

export function createTelegramOutboundDispatcher(
  options: TelegramOutboundDispatcherOptions
): OutboxHandler {
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
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
        await options.moduleConfigRepository.findEnabledConfig({
          tenantId: record.tenantId,
          moduleId: telegramModuleId
        });

      if (configRecord === null) {
        throw new CoreError("module.disabled");
      }

      const config = parseTelegramChannelConfig(configRecord.config);

      if (config.channelExternalId !== queuedMessage.channelExternalId) {
        return;
      }

      if (!config.outboundEnabled) {
        return;
      }

      const botToken = await resolveBotToken(
        options.secretResolver,
        record.tenantId,
        config.botTokenSecretRef
      );
      const adapter = createTelegramChannelAdapter({
        botApiClient: botApiClientFactory({
          apiBaseUrl: options.telegramApiBaseUrl,
          botToken
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

      await persistDeliveryResult({
        repository: options.outboundRepository,
        attemptIdFactory,
        now,
        message: queuedMessage,
        result
      });
    }
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
}): Promise<void> {
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
    return;
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
}

function ensurePlatformErrorCode(code: PlatformErrorCode): PlatformErrorCode {
  return code;
}
