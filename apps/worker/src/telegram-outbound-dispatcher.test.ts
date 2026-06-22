import type {
  ConversationId,
  MessageId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  FindEnabledTenantModuleConfigInput,
  FindTenantModuleConfigInput,
  ListEnabledTenantModuleConfigsInput,
  MarkOutboundMessageFailedInput,
  MarkOutboundMessageSentInput,
  OutboundDispatchRepository,
  QueuedOutboundMessageForDispatch,
  TenantModuleConfigRecord,
  TenantModuleConfigRepository,
  UpsertTenantModuleConfigInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createEnvSecretResolver,
  createTelegramOutboundDispatcher
} from "./telegram-outbound-dispatcher";
import type { OutboxRecord } from "./outbox-processor";

const tenantId = "tenant_worker_telegram" as TenantId;
const messageId = "message_worker_telegram" as MessageId;
const conversationId = "conversation_worker_telegram" as ConversationId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram outbound dispatcher", () => {
  it("dispatches queued Telegram outbound messages and marks delivery sent", async () => {
    const outboundRepository = new InMemoryOutboundDispatchRepository(
      createQueuedMessage()
    );
    const moduleConfigRepository = new InMemoryModuleConfigRepository();
    const sendTextMessage = vi.fn(async () => ({
      messageId: "telegram-provider-message-1",
      chatId: "42",
      raw: {}
    }));
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      moduleConfigRepository,
      secretResolver: createEnvSecretResolver({
        HULEE_TELEGRAM_BOT_TOKEN: "token-1"
      }),
      botApiClientFactory: () => ({
        sendTextMessage
      }),
      now: () => now,
      attemptIdFactory: ({ outcome }) => `attempt-${outcome}`
    });

    await dispatcher.handle(createOutboxRecord("message.sent"));

    expect(sendTextMessage).toHaveBeenCalledWith({
      chatId: "42",
      text: "Hello"
    });
    expect(outboundRepository.sent).toEqual([
      {
        tenantId,
        messageId,
        providerMessageId: "telegram-provider-message-1",
        attemptId: "attempt-sent",
        deliveredAt: now
      }
    ]);
    expect(outboundRepository.failed).toEqual([]);
  });

  it("marks permanent adapter failures without throwing for outbox retry", async () => {
    const outboundRepository = new InMemoryOutboundDispatchRepository({
      ...createQueuedMessage(),
      clientExternalId: "not-telegram:42"
    });
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      moduleConfigRepository: new InMemoryModuleConfigRepository(),
      secretResolver: createEnvSecretResolver({
        HULEE_TELEGRAM_BOT_TOKEN: "token-1"
      }),
      botApiClientFactory: () => ({
        async sendTextMessage() {
          throw new Error("should not be called");
        }
      }),
      now: () => now,
      attemptIdFactory: ({ outcome }) => `attempt-${outcome}`
    });

    await dispatcher.handle(createOutboxRecord("message.sent"));

    expect(outboundRepository.failed).toEqual([
      {
        tenantId,
        messageId,
        errorCode: "provider.permanent_failure",
        attemptId: "attempt-failed",
        failedAt: now
      }
    ]);
  });

  it("skips non-message outbox records and non-Telegram channel handles", async () => {
    const outboundRepository = new InMemoryOutboundDispatchRepository({
      ...createQueuedMessage(),
      channelExternalId: "vk-local"
    });
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      moduleConfigRepository: new InMemoryModuleConfigRepository(),
      secretResolver: createEnvSecretResolver({
        HULEE_TELEGRAM_BOT_TOKEN: "token-1"
      }),
      botApiClientFactory: () => ({
        async sendTextMessage() {
          throw new Error("should not be called");
        }
      })
    });

    await dispatcher.handle(createOutboxRecord("tenant.created"));
    await dispatcher.handle(createOutboxRecord("message.sent"));

    expect(outboundRepository.sent).toEqual([]);
    expect(outboundRepository.failed).toEqual([]);
  });

  it("throws a diagnosable error when outbound secret is missing", async () => {
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository: new InMemoryOutboundDispatchRepository(
        createQueuedMessage()
      ),
      moduleConfigRepository: new InMemoryModuleConfigRepository(),
      secretResolver: createEnvSecretResolver({})
    });

    await expect(
      dispatcher.handle(createOutboxRecord("message.sent"))
    ).rejects.toThrow(new CoreError("validation.failed"));
  });
});

class InMemoryOutboundDispatchRepository implements OutboundDispatchRepository {
  readonly sent: MarkOutboundMessageSentInput[] = [];
  readonly failed: MarkOutboundMessageFailedInput[] = [];

  constructor(
    private readonly message: QueuedOutboundMessageForDispatch | null
  ) {}

  async findQueuedMessage(): Promise<QueuedOutboundMessageForDispatch | null> {
    return this.message;
  }

  async markSent(input: MarkOutboundMessageSentInput): Promise<void> {
    this.sent.push(input);
  }

  async markFailed(input: MarkOutboundMessageFailedInput): Promise<void> {
    this.failed.push(input);
  }
}

class InMemoryModuleConfigRepository implements TenantModuleConfigRepository {
  async findConfig(
    input: FindTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null> {
    return this.moduleConfig(input);
  }

  async findEnabledConfig(
    input: FindEnabledTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null> {
    return this.moduleConfig(input);
  }

  async listEnabledConfigs(
    _input: ListEnabledTenantModuleConfigsInput
  ): Promise<TenantModuleConfigRecord[]> {
    return [this.moduleConfig({ tenantId, moduleId: "channel-telegram" })];
  }

  async upsertConfig(_input: UpsertTenantModuleConfigInput): Promise<void> {}

  private moduleConfig(input: {
    tenantId: TenantId;
    moduleId: string;
  }): TenantModuleConfigRecord {
    return {
      tenantId: input.tenantId,
      moduleId: input.moduleId,
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      },
      diagnostics: {}
    };
  }
}

function createQueuedMessage(): QueuedOutboundMessageForDispatch {
  return {
    tenantId,
    messageId,
    conversationId,
    channelExternalId: "telegram-local",
    clientExternalId: "telegram-user:42",
    text: "Hello",
    idempotencyKey: "reply:conversation:1"
  };
}

function createOutboxRecord(type: PlatformEvent["type"]): OutboxRecord {
  const payload =
    type === "message.sent"
      ? {
          messageId
        }
      : {
          tenantId
        };

  return {
    id: `outbox:${type}`,
    tenantId,
    eventId: `event:${type}`,
    attempts: 0,
    status: "processing",
    payload: {
      id: `event:${type}` as never,
      type,
      version: "v1",
      tenantId,
      occurredAt: now.toISOString(),
      payload
    } as PlatformEvent
  };
}
