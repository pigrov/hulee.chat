import type { ConversationId, MessageId, TenantId } from "@hulee/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { EgressOperationInput, EgressRuntime } from "./egress";
import {
  createTelegramBotApiClient,
  createTelegramChannelAdapter,
  normalizeTelegramIncomingMessage,
  parseTelegramChannelConfig,
  telegramChannelManifest
} from "./telegram-channel";

describe("telegram channel adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes direct Telegram text messages with tenant context", () => {
    expect(
      normalizeTelegramIncomingMessage({
        tenantId: "tenant-1",
        channelExternalId: "telegram-local",
        update: {
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
              first_name: "Alice",
              username: "alice"
            },
            text: "Hello"
          }
        }
      })
    ).toEqual({
      tenantId: "tenant-1",
      providerMessageId: "9001:77",
      channelExternalId: "telegram-local",
      clientExternalId: "telegram-user:42",
      clientDisplayName: "Alice",
      text: "Hello",
      attachments: [],
      occurredAt: "2026-06-22T08:00:00.000Z",
      idempotencyKey: "telegram:telegram-local:1001:9001:77"
    });
  });

  it("normalizes supported attachment metadata without materializing files", () => {
    expect(
      normalizeTelegramIncomingMessage({
        tenantId: "tenant-1",
        channelExternalId: "telegram-local",
        update: {
          update_id: 1002,
          message: {
            message_id: 78,
            date: 1782115200,
            chat: {
              id: 9001,
              type: "private"
            },
            from: {
              id: 42
            },
            caption: "Document",
            document: {
              file_id: "file-1",
              file_name: "invoice.pdf",
              mime_type: "application/pdf",
              file_size: 1200
            }
          }
        }
      })
    ).toMatchObject({
      text: "Document",
      attachments: [
        {
          id: "file-1",
          fileName: "invoice.pdf",
          mediaType: "application/pdf",
          sizeBytes: 1200
        }
      ]
    });
  });

  it("rejects updates without supported message content", () => {
    expect(() =>
      normalizeTelegramIncomingMessage({
        tenantId: "tenant-1",
        channelExternalId: "telegram-local",
        update: {
          update_id: 1003
        }
      })
    ).toThrow();
  });

  it("implements the channel adapter contract", async () => {
    const sendTextMessage = vi.fn(async () => ({
      messageId: "provider-message-1",
      chatId: "9001",
      raw: {}
    }));
    const adapter = createTelegramChannelAdapter({
      botApiClient: {
        sendTextMessage
      },
      now: () => new Date("2026-06-22T08:00:00.000Z")
    });

    await expect(adapter.health()).resolves.toEqual({
      status: "healthy",
      checkedAt: "2026-06-22T08:00:00.000Z"
    });
    await expect(
      adapter.sendMessage({
        tenantId: "tenant-1" as TenantId,
        conversationId: "conversation-1" as ConversationId,
        messageId: "message-1" as MessageId,
        channelExternalId: "telegram-local",
        clientExternalId: "telegram-chat:9001",
        text: "Hello",
        idempotencyKey: "outbound-1"
      })
    ).resolves.toEqual({
      providerMessageId: "provider-message-1",
      status: "sent"
    });
    expect(sendTextMessage).toHaveBeenCalledWith({
      chatId: "9001",
      text: "Hello"
    });
    expect(adapter.manifest).toBe(telegramChannelManifest);
  });

  it("parses connector config and requires a secret ref for outbound", () => {
    expect(
      parseTelegramChannelConfig({
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        outboundEnabled: true
      })
    ).toEqual({
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    });

    expect(() =>
      parseTelegramChannelConfig({
        channelExternalId: "telegram-local",
        outboundEnabled: true
      })
    ).toThrow();
  });

  it("wraps Telegram Bot API diagnostics and webhook methods", async () => {
    const fetchMock = vi.fn(async (url: string, init: RequestInit) => {
      const pathname = new URL(url).pathname;
      const method = pathname.split("/").at(-1);
      const body = JSON.parse(String(init.body ?? "{}")) as Record<
        string,
        unknown
      >;

      if (pathname === "/file/botbot-token/photos/file-1.jpg") {
        expect(init.method).toBe("GET");

        return new Response(new Uint8Array([1, 2, 3]));
      }

      if (method === "getMe") {
        return jsonTelegramResponse({
          ok: true,
          result: {
            id: 100,
            is_bot: true,
            first_name: "Hulee",
            username: "hulee_test_bot"
          }
        });
      }

      if (method === "getWebhookInfo") {
        return jsonTelegramResponse({
          ok: true,
          result: {
            url: "https://example.test/webhooks/telegram/telegram-local",
            pending_update_count: 2,
            last_error_date: 1782115200,
            last_error_message: "last failure"
          }
        });
      }

      if (method === "getUpdates") {
        expect(body).toEqual({
          offset: 1002,
          limit: 1,
          timeout: 0,
          allowed_updates: ["message"]
        });

        return jsonTelegramResponse({
          ok: true,
          result: [
            {
              update_id: 1002,
              message: {
                message_id: 78,
                date: 1782115200,
                chat: {
                  id: 9001,
                  type: "private"
                },
                text: "Hello"
              }
            }
          ]
        });
      }

      if (method === "getFile") {
        expect(body).toEqual({ file_id: "telegram-file-1" });

        return jsonTelegramResponse({
          ok: true,
          result: {
            file_id: "telegram-file-1",
            file_unique_id: "unique-file-1",
            file_size: 3,
            file_path: "photos/file-1.jpg"
          }
        });
      }

      if (method === "setWebhook") {
        expect(body).toMatchObject({
          url: "https://example.test/webhooks/telegram/telegram-local",
          secret_token: "secret-token"
        });

        return jsonTelegramResponse({ ok: true, result: true });
      }

      if (method === "deleteWebhook") {
        expect(body).toEqual({ drop_pending_updates: true });

        return jsonTelegramResponse({ ok: true, result: true });
      }

      throw new Error(`Unexpected Telegram method ${method}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const client = createTelegramBotApiClient({
      apiBaseUrl: "https://telegram.example",
      botToken: "bot-token"
    });

    await expect(client.getMe()).resolves.toEqual({
      id: "100",
      firstName: "Hulee",
      username: "hulee_test_bot",
      raw: {
        id: 100,
        is_bot: true,
        first_name: "Hulee",
        username: "hulee_test_bot"
      }
    });
    await expect(client.getWebhookInfo()).resolves.toMatchObject({
      url: "https://example.test/webhooks/telegram/telegram-local",
      pendingUpdateCount: 2,
      lastErrorAt: "2026-06-22T08:00:00.000Z",
      lastErrorMessage: "last failure"
    });
    await expect(
      client.getUpdates({
        offset: 1002,
        limit: 1,
        timeoutSeconds: 0,
        allowedUpdates: ["message"]
      })
    ).resolves.toEqual([
      {
        updateId: 1002,
        raw: {
          update_id: 1002,
          message: {
            message_id: 78,
            date: 1782115200,
            chat: {
              id: 9001,
              type: "private"
            },
            text: "Hello"
          }
        }
      }
    ]);
    await expect(
      client.setWebhook({
        url: "https://example.test/webhooks/telegram/telegram-local",
        secretToken: "secret-token"
      })
    ).resolves.toBeUndefined();
    await expect(
      client.deleteWebhook({ dropPendingUpdates: true })
    ).resolves.toBeUndefined();
    await expect(client.getFile("telegram-file-1")).resolves.toEqual({
      fileId: "telegram-file-1",
      fileUniqueId: "unique-file-1",
      fileSize: 3,
      filePath: "photos/file-1.jpg",
      raw: {
        file_id: "telegram-file-1",
        file_unique_id: "unique-file-1",
        file_size: 3,
        file_path: "photos/file-1.jpg"
      }
    });
    await expect(client.downloadFile("photos/file-1.jpg")).resolves.toEqual(
      new Uint8Array([1, 2, 3])
    );
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it("routes Bot API HTTP calls through the configured egress runtime", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (new URL(url).pathname.startsWith("/file/")) {
        return new Response(new Uint8Array([1]));
      }

      return jsonTelegramResponse({
        ok: true,
        result: {
          id: 100,
          is_bot: true
        }
      });
    });
    const executeSpy = vi.fn((input: EgressOperationInput) => input);
    const egressRuntime: EgressRuntime = {
      async resolveProfile() {
        throw new Error("should not be called by Telegram client");
      },
      async execute(input, operation) {
        executeSpy(input);

        return operation();
      }
    };
    vi.stubGlobal("fetch", fetchMock);
    const client = createTelegramBotApiClient({
      apiBaseUrl: "https://telegram.example",
      botToken: "bot-token",
      egress: {
        runtime: egressRuntime,
        resolution: {
          profileKind: "vpn_namespace",
          diagnostics: {
            required: true,
            status: "unknown",
            profileKind: "vpn_namespace",
            checkedAt: "2026-06-22T10:00:00.000Z"
          }
        },
        tenantId: "tenant-1" as TenantId,
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram"
      }
    });

    await client.getMe();
    await client.downloadFile("photos/file-1.jpg");

    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram",
        operation: "telegram.bot_api.getMe"
      })
    );
    expect(executeSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        connectorId: "telegram_bot:tenant-1",
        channelType: "telegram_bot",
        provider: "telegram",
        operation: "telegram.bot_api.downloadFile"
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function jsonTelegramResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json"
    }
  });
}
