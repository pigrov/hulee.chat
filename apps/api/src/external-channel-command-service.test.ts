import type {
  ClientId,
  ConversationId,
  MessageId,
  TenantId
} from "@hulee/contracts";
import type {
  ExternalMessageRepository,
  PersistedMessageSummary
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

import {
  createExternalChannelCommandService,
  type ExternalChannelCommandContext
} from "./external-channel-command-service";

const tenantId = "tenant-1" as TenantId;
const context: ExternalChannelCommandContext = {
  requestId: "request-1",
  tenantId,
  channelId: "telegram-local"
};
const now = new Date("2026-06-22T10:00:00.000Z");

describe("external channel command service", () => {
  it("accepts inbound messages as external channel clients", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createExternalChannelCommandService({
      repository,
      now: () => now
    });

    const response = await service.acceptInboundMessage(context, {
      tenantId,
      providerMessageId: "9001:77",
      channelExternalId: "telegram-local",
      clientExternalId: "telegram-user:42",
      clientDisplayName: "Alice",
      text: "Hello",
      attachments: [],
      occurredAt: "2026-06-22T08:00:00.000Z",
      idempotencyKey: "telegram:telegram-local:1001:9001:77"
    });

    expect(response.accepted).toBe(true);
    expect(repository.clients[0]).toMatchObject({
      displayName: "Alice",
      source: "external_channel"
    });
    expect(repository.contacts).toContain(
      buildExternalClientHandle({
        channelExternalId: "telegram-local",
        clientExternalId: "telegram-user:42"
      })
    );
    expect(repository.messages).toHaveLength(1);
  });

  it("returns existing messages by idempotency key", async () => {
    const repository = new InMemoryExternalMessageRepository();
    const service = createExternalChannelCommandService({
      repository,
      now: () => now
    });
    const message = {
      tenantId,
      providerMessageId: "9001:77",
      channelExternalId: "telegram-local",
      clientExternalId: "telegram-user:42",
      clientDisplayName: "Alice",
      text: "Hello",
      attachments: [],
      occurredAt: "2026-06-22T08:00:00.000Z",
      idempotencyKey: "telegram:telegram-local:1001:9001:77"
    };

    const first = await service.acceptInboundMessage(context, message);
    const second = await service.acceptInboundMessage(context, message);

    expect(second).toEqual(first);
    expect(repository.messages).toHaveLength(1);
  });

  it("rejects tenant boundary mismatches", async () => {
    const service = createExternalChannelCommandService({
      repository: new InMemoryExternalMessageRepository(),
      now: () => now
    });

    await expect(
      service.acceptInboundMessage(context, {
        tenantId: "tenant-other" as TenantId,
        providerMessageId: "9001:77",
        channelExternalId: "telegram-local",
        clientExternalId: "telegram-user:42",
        text: "Hello",
        attachments: [],
        occurredAt: "2026-06-22T08:00:00.000Z",
        idempotencyKey: "telegram:telegram-local:1001:9001:77"
      })
    ).rejects.toMatchObject({
      code: "tenant.boundary_violation"
    });
  });
});

class InMemoryExternalMessageRepository implements ExternalMessageRepository {
  readonly clients: Client[] = [];
  readonly conversations: Conversation[] = [];
  readonly messages: PersistedMessageSummary[] = [];
  readonly contacts: string[] = [];
  private readonly contactsByHandle = new Map<string, ClientId>();

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
    _result: RegisterExternalClientResult
  ): Promise<void> {}

  async saveExternalMessageIngestion(
    result: IngestExternalIncomingMessageResult
  ): Promise<void> {
    if (result.createdClient) {
      this.clients.push(result.client);
    }

    if (result.externalContact) {
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
    _result: QueueExternalOutboundMessageResult
  ): Promise<void> {}
}
