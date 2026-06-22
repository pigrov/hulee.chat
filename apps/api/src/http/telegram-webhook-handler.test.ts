import type { NormalizedIncomingMessage, TenantId } from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
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
            "secret:tenant-1/channel-telegram/webhook-secret-token",
          outboundEnabled: true
        }
      };
    }
  };
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
