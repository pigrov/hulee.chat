import type {
  ClientId,
  ConversationId,
  MessageId,
  TenantId
} from "@hulee/contracts";
import type {
  ExternalMessageRepository,
  PersistedMessageSummary,
  UpdateConversationRoutingInput
} from "@hulee/db";
import {
  buildExternalClientHandle,
  type Client,
  type Conversation,
  type IngestExternalIncomingMessageResult,
  type QueueExternalOutboundMessageResult,
  type RegisterExternalClientResult
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import { createPublicApiCommandService } from "./public-api-command-service";
import type { PublicApiCommandContext } from "./http/public-api-handler";

const tenantId = "tenant_api_commands" as TenantId;
const context: PublicApiCommandContext = {
  requestId: "request-1",
  tenantId,
  apiKeyId: "api-key-1"
};
const now = new Date("2026-06-22T10:00:00.000Z");

describe("public API command service", () => {
  it("registers new clients and stores external handle contacts", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createPublicApiCommandService({
      repository,
      now: () => now
    });

    const response = await service.registerClient(context, {
      externalId: "client-1",
      displayName: "Client One",
      contacts: [{ type: "email", value: "client@example.com" }]
    });

    expect(response).toMatchObject({
      externalId: "client-1",
      created: true
    });
    expect(repository.clients).toHaveLength(1);
    expect(repository.contacts).toContain(
      buildExternalClientHandle({
        channelExternalId: "public-api",
        clientExternalId: "client-1"
      })
    );
  });

  it("returns existing clients idempotently during registration", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createPublicApiCommandService({
      repository,
      now: () => now
    });

    await service.registerClient(context, {
      externalId: "client-1",
      displayName: "Client One",
      contacts: []
    });
    const second = await service.registerClient(context, {
      externalId: "client-1",
      displayName: "Client One",
      contacts: []
    });

    expect(second.created).toBe(false);
    expect(repository.clients).toHaveLength(1);
  });

  it("accepts inbound messages and reuses idempotency keys", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createPublicApiCommandService({
      repository,
      now: () => now
    });
    const request = {
      clientExternalId: "client-1",
      channelExternalId: "public-api",
      providerMessageId: "provider-message-1",
      text: "Hello",
      occurredAt: "2026-06-22T09:59:00.000Z",
      idempotencyKey: "inbound-1",
      attachments: []
    };

    const first = await service.acceptInboundMessage(
      context,
      {
        tenantId,
        providerMessageId: request.providerMessageId,
        channelExternalId: request.channelExternalId,
        clientExternalId: request.clientExternalId,
        text: request.text,
        attachments: [],
        occurredAt: request.occurredAt,
        idempotencyKey: request.idempotencyKey
      },
      request
    );
    const second = await service.acceptInboundMessage(
      context,
      {
        tenantId,
        providerMessageId: request.providerMessageId,
        channelExternalId: request.channelExternalId,
        clientExternalId: request.clientExternalId,
        text: request.text,
        attachments: [],
        occurredAt: request.occurredAt,
        idempotencyKey: request.idempotencyKey
      },
      request
    );

    expect(first).toEqual(second);
    expect(repository.messages).toHaveLength(1);
  });

  it("queues outbound messages against tenant-owned conversations", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createPublicApiCommandService({
      repository,
      now: () => now
    });
    await service.acceptInboundMessage(
      context,
      {
        tenantId,
        providerMessageId: "provider-message-1",
        channelExternalId: "public-api",
        clientExternalId: "client-1",
        text: "Hello",
        attachments: [],
        occurredAt: now.toISOString(),
        idempotencyKey: "inbound-1"
      },
      {
        clientExternalId: "client-1",
        channelExternalId: "public-api",
        providerMessageId: "provider-message-1",
        text: "Hello",
        occurredAt: now.toISOString(),
        idempotencyKey: "inbound-1",
        attachments: []
      }
    );

    const conversationId = repository.conversations[0]?.id;
    const response = await service.queueOutboundMessage(context, {
      conversationId: conversationId as string,
      text: "Hi",
      idempotencyKey: "outbound-1",
      attachments: []
    });

    expect(response).toMatchObject({
      status: "queued",
      idempotencyKey: "outbound-1"
    });
    expect(repository.messages).toHaveLength(2);
  });

  it("reads delivery status through tenant-scoped lookup", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createPublicApiCommandService({
      repository,
      now: () => now
    });
    const inbound = await service.acceptInboundMessage(
      context,
      {
        tenantId,
        providerMessageId: "provider-message-1",
        channelExternalId: "public-api",
        clientExternalId: "client-1",
        text: "Hello",
        attachments: [],
        occurredAt: now.toISOString(),
        idempotencyKey: "inbound-1"
      },
      {
        clientExternalId: "client-1",
        channelExternalId: "public-api",
        providerMessageId: "provider-message-1",
        text: "Hello",
        occurredAt: now.toISOString(),
        idempotencyKey: "inbound-1",
        attachments: []
      }
    );

    await expect(
      service.getDeliveryStatus(context, inbound.messageId)
    ).resolves.toMatchObject({
      messageId: inbound.messageId,
      status: "accepted"
    });
  });
});

class InMemoryExternalMessageRepository implements ExternalMessageRepository {
  readonly clients: Client[] = [];
  readonly conversations: Conversation[] = [];
  readonly messages: PersistedMessageSummary[] = [];
  readonly contacts: string[] = [];

  async findClientByExternalHandle(input: {
    tenantId: TenantId;
    externalHandle: string;
  }): Promise<Client | null> {
    const clientId = this.contactsByHandle.get(input.externalHandle);

    return (
      this.clients.find(
        (client) => client.tenantId === input.tenantId && client.id === clientId
      ) ?? null
    );
  }

  async findOpenConversationByClientId(input: {
    tenantId: TenantId;
    clientId: ClientId;
  }): Promise<Conversation | null> {
    return (
      this.conversations.find(
        (conversation) =>
          conversation.tenantId === input.tenantId &&
          conversation.clientId === input.clientId
      ) ?? null
    );
  }

  async findMessageByIdempotencyKey(input: {
    tenantId: TenantId;
    idempotencyKey: string;
  }): Promise<PersistedMessageSummary | null> {
    return (
      this.messages.find(
        (summary) =>
          summary.message.tenantId === input.tenantId &&
          summary.message.idempotencyKey === input.idempotencyKey
      ) ?? null
    );
  }

  async findConversationById(input: {
    tenantId: TenantId;
    conversationId: ConversationId;
  }): Promise<Conversation | null> {
    return (
      this.conversations.find(
        (conversation) =>
          conversation.tenantId === input.tenantId &&
          conversation.id === input.conversationId
      ) ?? null
    );
  }

  async findDeliveryStatus(input: {
    tenantId: TenantId;
    messageId: MessageId | string;
  }): Promise<PersistedMessageSummary | null> {
    return (
      this.messages.find(
        (summary) =>
          summary.message.tenantId === input.tenantId &&
          summary.message.id === input.messageId
      ) ?? null
    );
  }

  async saveRegisteredClient(
    result: RegisterExternalClientResult
  ): Promise<void> {
    this.clients.push(result.client);
    for (const contact of result.contacts) {
      if (contact.type === "external_handle") {
        this.contacts.push(contact.value);
        this.contactsByHandle.set(contact.value, contact.clientId);
      }
    }
  }

  async saveExternalMessageIngestion(
    result: IngestExternalIncomingMessageResult
  ): Promise<void> {
    if (result.createdClient) {
      this.clients.push(result.client);
    }

    if (result.externalContact !== undefined) {
      this.contacts.push(result.externalContact.value);
      this.contactsByHandle.set(
        result.externalContact.value,
        result.externalContact.clientId
      );
    }

    if (result.createdConversation) {
      this.conversations.push(result.conversation);
    }

    this.messages.push({
      message: result.message,
      clientId: result.client.id,
      updatedAt: result.message.createdAt
    });
  }

  async saveExternalOutboundMessage(
    result: QueueExternalOutboundMessageResult
  ): Promise<void> {
    const conversation = this.conversations.find(
      (item) => item.id === result.message.conversationId
    );

    this.messages.push({
      message: result.message,
      clientId: conversation?.clientId ?? ("client_unknown" as ClientId),
      updatedAt: result.message.createdAt
    });
  }

  async updateConversationRouting(
    input: UpdateConversationRoutingInput
  ): Promise<Conversation | null> {
    const index = this.conversations.findIndex(
      (conversation) =>
        conversation.tenantId === input.tenantId &&
        conversation.id === input.conversation.id
    );

    if (index === -1) {
      return null;
    }

    this.conversations[index] = input.conversation;

    return input.conversation;
  }

  private readonly contactsByHandle = new Map<string, ClientId>();
}
