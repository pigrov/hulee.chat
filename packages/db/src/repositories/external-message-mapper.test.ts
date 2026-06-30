import type { TenantId } from "@hulee/contracts";
import {
  createSequentialIdFactory,
  ingestExternalIncomingMessage,
  queueExternalOutboundMessage,
  registerExternalClient
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  collectExternalMessageIngestionTenantScopedRows,
  mapExternalMessageIngestionToPersistenceRows,
  mapExternalOutboundMessageToPersistenceRows,
  mapRegisterExternalClientToPersistenceRows
} from "./external-message-mapper";

const tenantId = "tenant_mapper" as TenantId;
const now = "2026-06-22T10:00:00.000Z";

describe("external message persistence mapper", () => {
  it("maps external client registration into tenant-scoped rows", () => {
    const result = registerExternalClient({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-register"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      displayName: "Client One",
      source: "public_api",
      contacts: [{ type: "phone", value: "+10000000000" }]
    });
    const rows = mapRegisterExternalClientToPersistenceRows(result);

    expect(rows.clients).toHaveLength(1);
    expect(rows.clientContacts).toHaveLength(2);
    expect(rows.eventStore).toHaveLength(1);
    expect(rows.outbox).toHaveLength(1);
  });

  it("maps new inbound external messages into client, conversation, message and outbox rows", () => {
    const result = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-inbound"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      providerMessageId: "provider-message-1",
      occurredAt: now,
      idempotencyKey: "inbound-1",
      text: "Hello"
    });
    const rows = mapExternalMessageIngestionToPersistenceRows(result);

    expect(rows.clients).toHaveLength(1);
    expect(rows.clientContacts).toHaveLength(1);
    expect(rows.conversations).toHaveLength(1);
    expect(rows.messages).toHaveLength(1);
    expect(rows.files).toHaveLength(0);
    expect(rows.messageAttachments).toHaveLength(0);
    expect(rows.eventStore.map((event) => event.type)).toEqual([
      "client.created",
      "conversation.created",
      "message.received"
    ]);
    expect(
      collectExternalMessageIngestionTenantScopedRows(rows).every(
        (row) => row.tenantId === tenantId
      )
    ).toBe(true);
  });

  it("maps reused-client inbound messages without duplicate client rows", () => {
    const first = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-known-first"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      providerMessageId: "provider-message-1",
      occurredAt: now,
      idempotencyKey: "inbound-1",
      text: "Hello"
    });
    const second = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-known-second"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      providerMessageId: "provider-message-2",
      occurredAt: now,
      idempotencyKey: "inbound-2",
      text: "Again",
      existingClient: first.client,
      existingConversation: first.conversation
    });
    const rows = mapExternalMessageIngestionToPersistenceRows(second);

    expect(rows.clients).toEqual([]);
    expect(rows.clientContacts).toEqual([]);
    expect(rows.conversations).toEqual([]);
    expect(rows.messages).toHaveLength(1);
    expect(rows.eventStore.map((event) => event.type)).toEqual([
      "message.received"
    ]);
  });

  it("maps inbound external message attachments into file and attachment rows", () => {
    const result = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-inbound-file"),
      channelExternalId: "telegram-local",
      clientExternalId: "telegram-user-1",
      providerMessageId: "chat-1:message-1",
      occurredAt: now,
      idempotencyKey: "telegram:message-1",
      channelProvider: "telegram",
      attachments: [
        {
          id: "telegram-file-1",
          fileName: "photo.jpg",
          mediaType: "image/jpeg",
          sizeBytes: 1234
        }
      ]
    });
    const rows = mapExternalMessageIngestionToPersistenceRows(result);

    expect(rows.files).toEqual([
      expect.objectContaining({
        tenantId,
        fileName: "photo.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 1234,
        status: "pending_download"
      })
    ]);
    expect(rows.messageAttachments).toEqual([
      expect.objectContaining({
        tenantId,
        messageId: rows.messages[0]?.id,
        fileId: rows.files[0]?.id,
        provider: "telegram",
        providerAttachmentId: "telegram-file-1",
        sortOrder: 0
      })
    ]);
    expect(
      collectExternalMessageIngestionTenantScopedRows(rows).every(
        (row) => row.tenantId === tenantId
      )
    ).toBe(true);
  });

  it("maps outbound messages into message/event/outbox rows", () => {
    const inbound = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-outbound-inbound"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      providerMessageId: "provider-message-1",
      occurredAt: now,
      idempotencyKey: "inbound-1",
      text: "Hello"
    });
    const outbound = queueExternalOutboundMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("mapper-outbound"),
      conversation: inbound.conversation,
      text: "Hi",
      idempotencyKey: "outbound-1"
    });
    const rows = mapExternalOutboundMessageToPersistenceRows(outbound);

    expect(rows.messages).toHaveLength(1);
    expect(rows.eventStore).toHaveLength(1);
    expect(rows.outbox).toHaveLength(1);
  });
});
