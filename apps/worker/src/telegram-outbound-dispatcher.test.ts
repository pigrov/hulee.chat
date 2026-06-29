import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  ConversationId,
  MessageId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelConnectorInput,
  FindFirstChannelConnectorByTypeInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantChannelConnectorsInput,
  MarkOutboundMessageFailedInput,
  MarkOutboundMessageSentInput,
  OutboundDispatchRepository,
  QueuedOutboundMessageForDispatch,
  UpsertChannelConnectorInput
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
    const connectorRepository = new InMemoryChannelConnectorRepository();
    const sendTextMessage = vi.fn(async () => ({
      messageId: "telegram-provider-message-1",
      chatId: "42",
      raw: {}
    }));
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      connectorRepository,
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
      connectorRepository: new InMemoryChannelConnectorRepository(),
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

  it("dispatches through the connector that owns the queued channel external id", async () => {
    const outboundRepository = new InMemoryOutboundDispatchRepository({
      ...createQueuedMessage(),
      channelExternalId: "telegram-secondary"
    });
    const connectorRepository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        channelExternalId: "telegram-primary",
        id: "telegram_bot:primary",
        secretRef: "env:HULEE_TELEGRAM_PRIMARY_TOKEN"
      }),
      createTelegramConnector({
        channelExternalId: "telegram-secondary",
        id: "telegram_bot:secondary",
        secretRef: "env:HULEE_TELEGRAM_SECONDARY_TOKEN"
      })
    ]);
    const sendTextMessage = vi.fn(async () => ({
      messageId: "telegram-provider-message-2",
      chatId: "42",
      raw: {}
    }));
    const clientFactory = vi.fn(() => ({
      sendTextMessage
    }));
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      connectorRepository,
      secretResolver: createEnvSecretResolver({
        HULEE_TELEGRAM_PRIMARY_TOKEN: "token-primary",
        HULEE_TELEGRAM_SECONDARY_TOKEN: "token-secondary"
      }),
      botApiClientFactory: clientFactory,
      now: () => now,
      attemptIdFactory: ({ outcome }) => `attempt-${outcome}`
    });

    await dispatcher.handle(createOutboxRecord("message.sent"));

    expect(clientFactory).toHaveBeenCalledWith(
      expect.objectContaining({
        apiBaseUrl: undefined,
        botToken: "token-secondary",
        egress: expect.objectContaining({
          connectorId: "telegram_bot:secondary",
          channelType: "telegram_bot",
          provider: "telegram",
          resolution: expect.objectContaining({
            profileKind: "vpn_namespace"
          })
        })
      })
    );
    expect(sendTextMessage).toHaveBeenCalledWith({
      chatId: "42",
      text: "Hello"
    });
    expect(outboundRepository.sent).toEqual([
      expect.objectContaining({
        providerMessageId: "telegram-provider-message-2"
      })
    ]);
  });

  it("skips non-message outbox records and non-Telegram channel handles", async () => {
    const outboundRepository = new InMemoryOutboundDispatchRepository({
      ...createQueuedMessage(),
      channelExternalId: "vk-local"
    });
    const dispatcher = createTelegramOutboundDispatcher({
      outboundRepository,
      connectorRepository: new InMemoryChannelConnectorRepository(),
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
      connectorRepository: new InMemoryChannelConnectorRepository(),
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

class InMemoryChannelConnectorRepository implements ChannelConnectorRepository {
  private readonly records: readonly ChannelConnectorRecord[];

  constructor(
    records: readonly ChannelConnectorRecord[] = [createTelegramConnector()]
  ) {
    this.records = records;
  }

  async findConnector(
    input: FindChannelConnectorInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.tenantId === input.tenantId && record.id === input.connectorId
      ) ?? null
    );
  }

  async findFirstConnectorByType(
    input: FindFirstChannelConnectorByTypeInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      this.records.find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channelType === input.channelType &&
          (input.includeDeleted || record.status !== "deleted")
      ) ?? null
    );
  }

  async listActiveConnectorsByType(
    input: ListActiveChannelConnectorsByTypeInput
  ): Promise<ChannelConnectorRecord[]> {
    return this.records.filter(
      (record) =>
        record.channelType === input.channelType &&
        isActiveStatus(record.status)
    );
  }

  async listTenantConnectors(
    input: ListTenantChannelConnectorsInput
  ): Promise<ChannelConnectorRecord[]> {
    return this.records.filter(
      (record) =>
        record.tenantId === input.tenantId &&
        (input.includeDeleted || record.status !== "deleted")
    );
  }

  async findActiveConnectorByConfigString(
    input: FindActiveChannelConnectorByConfigStringInput
  ): Promise<ChannelConnectorRecord | null> {
    const matches = this.records.filter(
      (record) =>
        record.channelType === input.channelType &&
        isActiveStatus(record.status) &&
        isRecord(record.config) &&
        record.config[input.configKey] === input.configValue
    );

    return matches.length === 1 ? matches[0] : null;
  }

  async findActiveConnectorByExternalId(
    input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null> {
    const matches = this.records.filter(
      (record) =>
        record.tenantId === input.tenantId &&
        record.channelType === input.channelType &&
        isActiveStatus(record.status) &&
        isRecord(record.config) &&
        record.config.channelExternalId === input.channelExternalId
    );

    return matches.length === 1 ? matches[0] : null;
  }

  async upsertConnector(_input: UpsertChannelConnectorInput): Promise<void> {}
}

function createTelegramConnector(
  input: {
    channelExternalId?: string;
    id?: string;
    secretRef?: string;
    status?: ChannelConnectorStatus;
  } = {}
): ChannelConnectorRecord {
  return {
    id: (input.id ??
      "telegram_bot:tenant_worker_telegram") as ChannelConnectorId,
    tenantId,
    channelType: "telegram_bot" as ChannelType,
    channelClass: "bot_bridge" as ChannelClass,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: (input.status ?? "connected") as ChannelConnectorStatus,
    healthStatus: "healthy" as ChannelConnectorHealthStatus,
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId: input.channelExternalId ?? "telegram-local",
      mode: "webhook",
      botTokenSecretRef: input.secretRef ?? "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    },
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function isActiveStatus(status: ChannelConnectorRecord["status"]): boolean {
  return status === "connected" || status === "degraded";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
