import type {
  ClientId,
  ConversationId,
  EmployeeId,
  MessageId,
  TenantId
} from "@hulee/contracts";
import type {
  ExternalMessageRepository,
  PersistedMessageSummary
} from "@hulee/db";
import type {
  Client,
  Conversation,
  IngestExternalIncomingMessageResult,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientResult
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  createInternalInboxCommandService,
  type InternalInboxCommandContext
} from "./internal-inbox-service";

const tenantId = "tenant-1" as TenantId;
const context: InternalInboxCommandContext = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1" as EmployeeId
};
const conversation: Conversation = {
  id: "conversation-1" as ConversationId,
  tenantId,
  type: "client_direct",
  clientId: "client-1" as ClientId,
  participantEmployeeIds: [],
  createdAt: "2026-06-22T10:00:00.000Z"
};
const now = new Date("2026-06-22T10:00:00.000Z");

describe("internal inbox command service", () => {
  it("queues replies against tenant-owned conversations", async () => {
    const repository = new InMemoryExternalMessageRepository([conversation]);
    const service = createInternalInboxCommandService({
      repository,
      now: () => now,
      idempotencyKeyFactory: () => "reply-1"
    });

    const response = await service.sendReply(context, {
      conversationId: conversation.id,
      request: {
        text: "Hello"
      }
    });

    expect(response).toMatchObject({
      status: "queued",
      idempotencyKey: "reply-1"
    });
    expect(repository.messages).toHaveLength(1);
  });

  it("returns existing messages by idempotency key", async () => {
    const repository = new InMemoryExternalMessageRepository([conversation]);
    const service = createInternalInboxCommandService({
      repository,
      now: () => now
    });
    const first = await service.sendReply(context, {
      conversationId: conversation.id,
      request: {
        text: "Hello",
        idempotencyKey: "reply-1"
      }
    });
    const second = await service.sendReply(context, {
      conversationId: conversation.id,
      request: {
        text: "Hello again",
        idempotencyKey: "reply-1"
      }
    });

    expect(second).toEqual(first);
    expect(repository.messages).toHaveLength(1);
  });

  it("rejects conversations outside the tenant context", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        tenantId: "tenant-other" as TenantId
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      now: () => now
    });

    await expect(
      service.sendReply(context, {
        conversationId: conversation.id,
        request: {
          text: "Hello"
        }
      })
    ).rejects.toMatchObject({
      code: "tenant.not_found"
    });
  });
});

class InMemoryExternalMessageRepository implements ExternalMessageRepository {
  readonly messages: PersistedMessageSummary[] = [];

  constructor(private readonly conversations: Conversation[]) {}

  async findClientByExternalHandle(): Promise<Client | null> {
    return null;
  }

  async findOpenConversationByClientId(): Promise<Conversation | null> {
    return null;
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
        (item) =>
          item.tenantId === input.tenantId && item.id === input.conversationId
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
    _result: IngestExternalIncomingMessageResult
  ): Promise<void> {}

  async saveExternalOutboundMessage(
    result: QueueExternalOutboundMessageResult
  ): Promise<void> {
    const matchedConversation = this.conversations.find(
      (item) => item.id === result.message.conversationId
    );

    this.messages.push({
      message: result.message,
      clientId: matchedConversation?.clientId ?? ("client-unknown" as ClientId),
      updatedAt: result.message.createdAt
    });
  }
}
