import type { TenantId } from "@hulee/contracts";
import { describe, expect, it } from "vitest";

import {
  buildExternalClientHandle,
  type Client,
  type Conversation,
  CoreError,
  createSequentialIdFactory,
  ingestExternalIncomingMessage,
  queueExternalOutboundMessage,
  registerExternalClient
} from "./index";

const now = "2026-06-22T10:00:00.000Z";
const tenantId = "tenant_external" as TenantId;

describe("external message core use cases", () => {
  it("registers a client with a generic external handle contact", () => {
    const result = registerExternalClient({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("register"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      displayName: "Client One",
      source: "public_api",
      contacts: [{ type: "email", value: "client@example.com" }]
    });

    expect(result.client).toMatchObject({
      tenantId,
      displayName: "Client One",
      source: "public_api"
    });
    expect(result.contacts.map((contact) => contact.type)).toEqual([
      "external_handle",
      "email"
    ]);
    expect(result.contacts[0]).toMatchObject({
      tenantId,
      clientId: result.client.id,
      value: buildExternalClientHandle({
        channelExternalId: "public-api",
        clientExternalId: "client-1"
      })
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "client.created",
      tenantId,
      payload: {
        clientId: result.client.id
      }
    });
  });

  it("creates client, conversation, inbound message and events for unknown external sender", () => {
    const result = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("inbound"),
      channelExternalId: "telegram-chat-1",
      clientExternalId: "telegram-user-1",
      providerMessageId: "provider-message-1",
      occurredAt: "2026-06-22T09:59:00.000Z",
      idempotencyKey: "telegram:provider-message-1",
      text: "Hello",
      clientSource: "external_channel"
    });

    expect(result.createdClient).toBe(true);
    expect(result.createdConversation).toBe(true);
    expect(result.externalContact).toMatchObject({
      tenantId,
      clientId: result.client.id,
      type: "external_handle"
    });
    expect(result.conversation).toMatchObject({
      tenantId,
      clientId: result.client.id,
      type: "client_direct"
    });
    expect(result.message).toMatchObject({
      tenantId,
      conversationId: result.conversation.id,
      direction: "inbound",
      status: "received",
      text: "Hello",
      idempotencyKey: "telegram:provider-message-1"
    });
    expect(result.events.map((event) => event.type)).toEqual([
      "client.created",
      "conversation.created",
      "message.received"
    ]);
  });

  it("reuses existing client and conversation for known external sender", () => {
    const existingClient: Client = {
      id: "client_existing" as never,
      tenantId,
      displayName: "Known Client",
      source: "external_channel",
      createdAt: now
    };
    const existingConversation: Conversation = {
      id: "conversation_existing" as never,
      tenantId,
      type: "client_direct",
      clientId: existingClient.id,
      participantEmployeeIds: [],
      createdAt: now
    };

    const result = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("known"),
      channelExternalId: "telegram-chat-1",
      clientExternalId: "telegram-user-1",
      providerMessageId: "provider-message-2",
      occurredAt: "2026-06-22T09:59:30.000Z",
      idempotencyKey: "telegram:provider-message-2",
      text: "Again",
      existingClient,
      existingConversation
    });

    expect(result.client).toBe(existingClient);
    expect(result.conversation).toBe(existingConversation);
    expect(result.externalContact).toBeUndefined();
    expect(result.createdClient).toBe(false);
    expect(result.createdConversation).toBe(false);
    expect(result.events.map((event) => event.type)).toEqual([
      "message.received"
    ]);
  });

  it("rejects cross-tenant existing entities before emitting events", () => {
    expect(() =>
      ingestExternalIncomingMessage({
        now,
        tenantId,
        idFactory: createSequentialIdFactory("cross"),
        channelExternalId: "public-api",
        clientExternalId: "client-1",
        providerMessageId: "message-1",
        occurredAt: now,
        idempotencyKey: "message-1",
        existingClient: {
          id: "client_other" as never,
          tenantId: "tenant_other" as TenantId,
          displayName: "Other",
          source: "external_channel",
          createdAt: now
        }
      })
    ).toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("queues external outbound messages for a tenant conversation", () => {
    const conversation: Conversation = {
      id: "conversation_outbound" as never,
      tenantId,
      type: "client_direct",
      clientId: "client_outbound" as never,
      participantEmployeeIds: [],
      createdAt: now
    };
    const result = queueExternalOutboundMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("outbound"),
      conversation,
      text: "Queued",
      idempotencyKey: "outbound-1"
    });

    expect(result.message).toMatchObject({
      tenantId,
      conversationId: conversation.id,
      direction: "outbound",
      status: "queued",
      text: "Queued"
    });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      type: "message.sent",
      tenantId
    });
  });
});
