import type { ConversationId, MessageId, TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  createPublicApiChannelAdapter,
  normalizePublicApiIncomingMessage,
  publicApiChannelManifest
} from "./public-api-channel";

describe("public API channel adapter", () => {
  it("normalizes inbound public API messages with tenant context from envelope", () => {
    expect(
      normalizePublicApiIncomingMessage({
        tenantId: "tenant-1",
        body: {
          clientExternalId: "client-1",
          channelExternalId: "public-api",
          providerMessageId: "provider-message-1",
          text: "Hello",
          occurredAt: "2026-06-22T07:00:00.000Z",
          idempotencyKey: "inbound-1"
        }
      })
    ).toEqual({
      tenantId: "tenant-1",
      providerMessageId: "provider-message-1",
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      text: "Hello",
      attachments: [],
      occurredAt: "2026-06-22T07:00:00.000Z",
      idempotencyKey: "inbound-1"
    });
  });

  it("rejects invalid public API payloads before they reach core", () => {
    expect(() =>
      normalizePublicApiIncomingMessage({
        tenantId: "tenant-1",
        body: {
          clientExternalId: "client-1",
          channelExternalId: "public-api",
          providerMessageId: "provider-message-1",
          occurredAt: "2026-06-22T07:00:00.000Z",
          idempotencyKey: "inbound-1",
          providerSpecificFlag: true
        }
      })
    ).toThrow();
  });

  it("implements the channel adapter contract", async () => {
    const adapter = createPublicApiChannelAdapter();

    await expect(adapter.health()).resolves.toEqual({
      status: "healthy",
      checkedAt: "1970-01-01T00:00:00.000Z"
    });
    await expect(
      adapter.sendMessage({
        tenantId: "tenant-1" as TenantId,
        conversationId: "conversation-1" as ConversationId,
        messageId: "message-1" as MessageId,
        channelExternalId: "public-api",
        text: "Hello",
        idempotencyKey: "outbound-1"
      })
    ).resolves.toEqual({
      providerMessageId: "message-1",
      status: "accepted"
    });
    expect(adapter.manifest).toBe(publicApiChannelManifest);
  });
});
