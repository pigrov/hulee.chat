import type {
  ChannelConnectorId,
  ChannelConnectorStatus,
  NormalizedIncomingMessage,
  TenantId
} from "@hulee/contracts";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelConnectorInput,
  FindFirstChannelConnectorByTypeInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantChannelConnectorsInput,
  UpsertChannelConnectorInput
} from "@hulee/db";
import { describe, expect, it, vi } from "vitest";

import {
  createChannelConnectorTelegramWebhookConnectorResolver,
  createTelegramWebhookHandler,
  type TelegramWebhookConnector
} from "./telegram-webhook-handler";

const tenantId = "tenant-1" as TenantId;

describe("telegram webhook handler", () => {
  it("normalizes Telegram webhook updates and accepts inbound messages", async () => {
    const acceptInboundMessage = vi.fn(
      async (_context, message: NormalizedIncomingMessage) => ({
        clientId: `client:${message.clientExternalId}`,
        conversationId: "conversation-1",
        messageId: `message:${message.providerMessageId}`,
        accepted: true as const
      })
    );
    const handler = createTelegramWebhookHandler({
      requestIdFactory: () => "request-1",
      connectorResolver: createConnectorResolver(),
      secretResolver: createSecretResolver("secret-token"),
      commands: {
        acceptInboundMessage
      }
    });
    const response = await handler.handle({
      method: "POST",
      path: "/webhooks/telegram/tgwh_test",
      headers: {
        "x-telegram-bot-api-secret-token": "secret-token"
      },
      body: {
        update_id: 1001,
        message: {
          message_id: 77,
          date: 1782115200,
          chat: {
            id: 9001,
            type: "private"
          },
          from: {
            id: 42,
            first_name: "Alice"
          },
          text: "Hello"
        }
      }
    });

    expect(response.status).toBe(202);
    expect(response.body).toEqual({
      clientId: "client:telegram-user:42",
      conversationId: "conversation-1",
      messageId: "message:9001:77",
      accepted: true,
      channelExternalId: "telegram-local"
    });
    expect(acceptInboundMessage).toHaveBeenCalledWith(
      {
        requestId: "request-1",
        tenantId,
        channelId: "telegram-local"
      },
      expect.objectContaining({
        tenantId,
        channelExternalId: "telegram-local",
        clientExternalId: "telegram-user:42",
        clientDisplayName: "Alice",
        text: "Hello"
      })
    );
  });

  it("returns a validation error for unsupported Telegram updates", async () => {
    const acceptInboundMessage = vi.fn();
    const handler = createTelegramWebhookHandler({
      requestIdFactory: () => "request-1",
      connectorResolver: createConnectorResolver(),
      secretResolver: createSecretResolver("secret-token"),
      commands: {
        acceptInboundMessage
      }
    });
    const response = await handler.handle({
      method: "POST",
      path: "/webhooks/telegram/tgwh_test",
      headers: {
        "x-telegram-bot-api-secret-token": "secret-token"
      },
      body: {
        update_id: 1002
      }
    });

    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({
      error: {
        code: "validation.failed",
        requestId: "request-1"
      }
    });
    expect(acceptInboundMessage).not.toHaveBeenCalled();
  });

  it("rejects Telegram webhooks with a missing connector secret token", async () => {
    const acceptInboundMessage = vi.fn();
    const handler = createTelegramWebhookHandler({
      requestIdFactory: () => "request-1",
      connectorResolver: createConnectorResolver(),
      secretResolver: createSecretResolver("secret-token"),
      commands: {
        acceptInboundMessage
      }
    });
    const response = await handler.handle({
      method: "POST",
      path: "/webhooks/telegram/tgwh_test",
      body: {
        update_id: 1002
      }
    });

    expect(response.status).toBe(401);
    expect(response.body).toMatchObject({
      error: {
        code: "auth.invalid_credentials",
        requestId: "request-1"
      }
    });
    expect(acceptInboundMessage).not.toHaveBeenCalled();
  });

  it("does not fall back to tenant headers for unknown connectors", async () => {
    const acceptInboundMessage = vi.fn();
    const handler = createTelegramWebhookHandler({
      requestIdFactory: () => "request-1",
      connectorResolver: {
        async resolveConnector() {
          return null;
        }
      },
      secretResolver: createSecretResolver("secret-token"),
      commands: {
        acceptInboundMessage
      }
    });
    const response = await handler.handle({
      method: "POST",
      path: "/webhooks/telegram/unknown",
      headers: {
        "x-hulee-tenant-id": "tenant-other",
        "x-telegram-bot-api-secret-token": "secret-token"
      },
      body: {
        update_id: 1002
      }
    });

    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({
      error: {
        code: "tenant.not_found",
        requestId: "request-1"
      }
    });
    expect(acceptInboundMessage).not.toHaveBeenCalled();
  });

  it("resolves webhook connectors from channel connector config", async () => {
    const resolver = createChannelConnectorTelegramWebhookConnectorResolver({
      repository: new InMemoryChannelConnectorRepository([
        createTelegramConnector({
          id: "telegram_bot:first",
          channelExternalId: "telegram-first",
          webhookConnectorId: "tgwh_first"
        }),
        createTelegramConnector({
          id: "telegram_bot:second",
          channelExternalId: "telegram-second",
          webhookConnectorId: "tgwh_second"
        })
      ])
    });

    await expect(
      resolver.resolveConnector({
        connectorId: "tgwh_second"
      })
    ).resolves.toEqual({
      tenantId,
      config: {
        channelExternalId: "telegram-second",
        mode: "webhook",
        botTokenSecretRef:
          "secret:tenant-1/channels/telegram_bot:second/bot-token",
        webhookConnectorId: "tgwh_second",
        webhookSecretTokenSecretRef:
          "secret:tenant-1/channels/telegram_bot:second/webhook-secret-token",
        outboundEnabled: true
      }
    });
  });

  it("does not resolve inactive webhook connectors", async () => {
    const resolver = createChannelConnectorTelegramWebhookConnectorResolver({
      repository: new InMemoryChannelConnectorRepository([
        createTelegramConnector({
          status: "draft",
          webhookConnectorId: "tgwh_draft"
        })
      ])
    });

    await expect(
      resolver.resolveConnector({
        connectorId: "tgwh_draft"
      })
    ).resolves.toBeNull();
  });
});

function createConnectorResolver(input?: { mode?: "webhook" | "polling" }): {
  resolveConnector(): Promise<TelegramWebhookConnector | null>;
} {
  return {
    async resolveConnector() {
      return {
        tenantId,
        config: {
          channelExternalId: "telegram-local",
          mode: input?.mode ?? "webhook",
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef:
            "secret:tenant-1/channels/telegram_bot:tenant-1/webhook-secret-token",
          outboundEnabled: true
        }
      };
    }
  };
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
    _input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async upsertConnector(_input: UpsertChannelConnectorInput): Promise<void> {}
}

function createTelegramConnector(
  input: {
    channelExternalId?: string;
    id?: string;
    status?: ChannelConnectorStatus;
    webhookConnectorId?: string;
  } = {}
): ChannelConnectorRecord {
  const connectorId = input.id ?? "telegram_bot:tenant-1";
  const channelExternalId = input.channelExternalId ?? "telegram-local";
  const webhookConnectorId = input.webhookConnectorId ?? "tgwh_test";

  return {
    id: connectorId as ChannelConnectorId,
    tenantId,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram Bot",
    status: input.status ?? "connected",
    healthStatus: "healthy",
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId,
      mode: "webhook",
      botTokenSecretRef: `secret:tenant-1/channels/${connectorId}/bot-token`,
      webhookConnectorId,
      webhookSecretTokenSecretRef: `secret:tenant-1/channels/${connectorId}/webhook-secret-token`,
      outboundEnabled: true
    },
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: new Date("2026-06-22T10:00:00.000Z"),
    updatedAt: new Date("2026-06-22T10:00:00.000Z")
  };
}

function isActiveStatus(status: ChannelConnectorRecord["status"]): boolean {
  return status === "connected" || status === "degraded";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createSecretResolver(expected: string): {
  resolveSecret(): Promise<string | null>;
} {
  return {
    async resolveSecret() {
      return expected;
    }
  };
}
