import type {
  ClientId,
  ConversationId,
  EmployeeId,
  MessageId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import type {
  ExternalMessageRepository,
  PersistedMessageSummary,
  TenantEmployeeRecord,
  UpdateConversationRoutingInput
} from "@hulee/db";
import type {
  Client,
  Conversation,
  IngestExternalIncomingMessageResult,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientResult
} from "@hulee/core";
import { CoreError, createSequentialIdFactory } from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  createInternalInboxAuthorizationService,
  createInternalInboxCommandService,
  filterInboxConversations,
  type InternalInboxAuthorizationService,
  type InternalInboxConversationAccessResource,
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
const employee: TenantEmployeeRecord = {
  tenantId,
  employeeId: context.employeeId,
  accountId: "account-1",
  email: "agent@example.com",
  displayName: "Agent",
  roles: [],
  orgUnitIds: ["org-sales"],
  queueIds: ["queue-sales"],
  createdAt: now,
  deactivatedAt: null
};

describe("internal inbox query filters", () => {
  it("filters readable conversations by queue and current assignee", () => {
    const conversations: readonly InternalInboxConversationAccessResource[] = [
      {
        id: "conversation-mine",
        tenantId,
        clientId: "client-1",
        currentQueueId: "queue-sales",
        assignedEmployeeId: context.employeeId
      },
      {
        id: "conversation-other-assignee",
        tenantId,
        clientId: "client-2",
        currentQueueId: "queue-sales",
        assignedEmployeeId: "employee-2" as EmployeeId
      },
      {
        id: "conversation-other-queue",
        tenantId,
        clientId: "client-3",
        currentQueueId: "queue-claims",
        assignedEmployeeId: context.employeeId
      }
    ];

    expect(
      filterInboxConversations(context, conversations, {
        queueId: "queue-sales",
        assignedToMe: true
      })
    ).toEqual([conversations[0]]);
  });
});

describe("internal inbox command service", () => {
  it("queues replies against tenant-owned conversations", async () => {
    const repository = new InMemoryExternalMessageRepository([conversation]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createReplyAuthorization(),
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
      authorization: createReplyAuthorization(),
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
      authorization: createReplyAuthorization(),
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

  it("filters conversations by the current queue scope", async () => {
    const authorization = createInternalInboxAuthorizationService({
      employeeRepository: createEmployeeRepository(employee),
      rbacRepository: {
        async listEffectiveAccessSources() {
          return {
            roles: [
              {
                id: "role-lead-intake",
                tenantId,
                permissions: ["inbox.read"]
              }
            ],
            roleBindings: [
              {
                tenantId,
                roleId: "role-lead-intake",
                subject: {
                  type: "queue",
                  id: "queue-sales"
                },
                scope: {
                  type: "queue",
                  id: "queue-sales"
                }
              }
            ],
            directGrants: []
          };
        }
      },
      now: () => now
    });
    const conversations: readonly InternalInboxConversationAccessResource[] = [
      {
        id: "conversation-sales",
        tenantId,
        clientId: "client-sales",
        currentQueueId: "queue-sales"
      },
      {
        id: "conversation-claims",
        tenantId,
        clientId: "client-claims",
        currentQueueId: "queue-claims"
      }
    ];

    await expect(
      authorization.filterConversations(context, {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[0]]);
  });

  it("allows assigned replies only for the current assignee", async () => {
    const authorization = createInternalInboxAuthorizationService({
      employeeRepository: createEmployeeRepository(employee),
      rbacRepository: {
        async listEffectiveAccessSources() {
          return {
            roles: [
              {
                id: "role-assigned-reply",
                tenantId,
                permissions: ["message.reply"]
              }
            ],
            roleBindings: [
              {
                tenantId,
                roleId: "role-assigned-reply",
                subject: {
                  type: "employee",
                  id: context.employeeId
                },
                scope: {
                  type: "assigned"
                }
              }
            ],
            directGrants: []
          };
        }
      },
      now: () => now
    });

    await expect(
      authorization.assertConversationAccess(context, {
        conversation: {
          ...conversation,
          assignedEmployeeId: context.employeeId
        },
        permission: "message.reply"
      })
    ).resolves.toBeUndefined();

    await expect(
      authorization.assertConversationAccess(context, {
        conversation: {
          ...conversation,
          assignedEmployeeId: "employee-2" as EmployeeId
        },
        permission: "message.reply"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
  });

  it("updates conversation routing when the current queue scope is assignable", async () => {
    const routedConversation: Conversation = {
      ...conversation,
      currentQueueId: "queue-sales"
    };
    const repository = new InMemoryExternalMessageRepository([
      routedConversation
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createAssignAuthorization(),
      now: () => now,
      idFactory: () => createSequentialIdFactory("assign")
    });

    await expect(
      service.updateConversationRouting(context, {
        conversationId: routedConversation.id,
        request: {
          currentQueueId: "queue-claims",
          assignedEmployeeId: "employee-2"
        }
      })
    ).resolves.toEqual({
      conversationId: routedConversation.id,
      currentQueueId: "queue-claims",
      assignedEmployeeId: "employee-2",
      assignedTeamId: undefined
    });
    expect(repository.conversations[0]).toMatchObject({
      currentQueueId: "queue-claims",
      assignedEmployeeId: "employee-2"
    });
    expect(repository.routingEvents).toMatchObject([
      {
        type: "conversation.assigned",
        payload: {
          currentQueueId: "queue-claims",
          assignedEmployeeId: "employee-2"
        }
      }
    ]);
  });

  it("rejects conversation routing outside the actor queue scope", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-claims"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createAssignAuthorization(),
      now: () => now
    });

    await expect(
      service.updateConversationRouting(context, {
        conversationId: conversation.id,
        request: {
          currentQueueId: "queue-sales"
        }
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.routingEvents).toHaveLength(0);
  });

  it("reports invalid routing targets when persistence rejects the update", async () => {
    const repository = new RejectingRoutingExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-sales"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createAssignAuthorization(),
      now: () => now
    });

    await expect(
      service.updateConversationRouting(context, {
        conversationId: conversation.id,
        request: {
          currentQueueId: "queue-missing"
        }
      })
    ).rejects.toEqual(new CoreError("validation.failed"));
  });
});

function createReplyAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [
            {
              id: "role-reply",
              tenantId,
              permissions: ["message.reply"]
            }
          ],
          roleBindings: [
            {
              tenantId,
              roleId: "role-reply",
              subject: {
                type: "employee",
                id: context.employeeId
              },
              scope: {
                type: "tenant"
              }
            }
          ],
          directGrants: []
        };
      }
    },
    now: () => now
  });
}

function createAssignAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [
            {
              id: "role-assign",
              tenantId,
              permissions: ["conversation.assign"]
            }
          ],
          roleBindings: [
            {
              tenantId,
              roleId: "role-assign",
              subject: {
                type: "queue",
                id: "queue-sales"
              },
              scope: {
                type: "queue",
                id: "queue-sales"
              }
            }
          ],
          directGrants: []
        };
      }
    },
    now: () => now
  });
}

function createEmployeeRepository(employeeRecord: TenantEmployeeRecord) {
  return {
    async findEmployee(input: {
      tenantId: TenantId;
      employeeId: EmployeeId;
    }): Promise<TenantEmployeeRecord | null> {
      return employeeRecord.tenantId === input.tenantId &&
        employeeRecord.employeeId === input.employeeId
        ? employeeRecord
        : null;
    }
  };
}

class InMemoryExternalMessageRepository implements ExternalMessageRepository {
  readonly messages: PersistedMessageSummary[] = [];
  readonly routingEvents: PlatformEvent[] = [];

  constructor(readonly conversations: Conversation[]) {}

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

  async updateConversationRouting(
    input: UpdateConversationRoutingInput
  ): Promise<Conversation | null> {
    const index = this.conversations.findIndex(
      (item) =>
        item.tenantId === input.tenantId && item.id === input.conversation.id
    );

    if (index === -1) {
      return null;
    }

    this.conversations[index] = input.conversation;
    this.routingEvents.push(...input.events);

    return input.conversation;
  }
}

class RejectingRoutingExternalMessageRepository extends InMemoryExternalMessageRepository {
  override async updateConversationRouting(): Promise<Conversation | null> {
    return null;
  }
}
