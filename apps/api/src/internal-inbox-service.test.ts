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
  HuleeDatabase,
  PersistedMessageSummary,
  TenantEmployeeRecord,
  UpdateConversationRoutingInput
} from "@hulee/db";
import type {
  Client,
  Conversation,
  DirectPermissionGrant,
  IngestExternalIncomingMessageResult,
  PermissionRoleBinding,
  PermissionRoleDefinition,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientResult
} from "@hulee/core";
import { CoreError, createSequentialIdFactory } from "@hulee/core";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalInboxAuthorizationService,
  createInternalInboxCommandService,
  createSqlInternalInboxQueryService,
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
  phoneNumber: null,
  avatarUrl: null,
  avatar: null,
  systemRoleTemplateIds: [],
  teamIds: ["team-sales"],
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

describe("internal inbox query service", () => {
  it("groups message attachments into the selected conversation messages", async () => {
    const database = new SequentialInboxDatabase([
      [
        {
          tenant_id: tenantId,
          display_name: "Acme",
          deployment_type: "saas_shared",
          locale: "en",
          timezone: "UTC",
          brand_id: null,
          product_name: null,
          short_product_name: null,
          assets: null,
          theme_tokens: null,
          links: null
        }
      ],
      [
        {
          tenant_id: tenantId,
          conversation_id: "conversation-1",
          client_id: "client-1",
          client_display_name: "Alice",
          status: "open",
          source: "telegram",
          current_queue_id: "queue-sales",
          current_queue_name: "Sales",
          current_queue_owning_org_unit_id: null,
          assigned_employee_id: null,
          assigned_employee_display_name: null,
          assigned_team_id: null,
          assigned_team_name: null,
          message_count: 1,
          queued_count: 0,
          last_message_text: "Photo",
          last_message_at: "2026-06-22T10:00:00.000Z"
        }
      ],
      [
        {
          id: "message-1",
          conversation_id: "conversation-1",
          direction: "inbound",
          text: "Photo",
          status: "received",
          created_at: "2026-06-22T10:00:00.000Z",
          attachment_id: "attachment-1",
          file_id: "file-1",
          file_name: "photo.jpg",
          media_type: "image/jpeg",
          size_bytes: "123",
          file_status: "stored"
        },
        {
          id: "message-1",
          conversation_id: "conversation-1",
          direction: "inbound",
          text: "Photo",
          status: "received",
          created_at: "2026-06-22T10:00:00.000Z",
          attachment_id: "attachment-2",
          file_id: "file-2",
          file_name: "document.pdf",
          media_type: "application/pdf",
          size_bytes: 456,
          file_status: "pending_download"
        }
      ]
    ]);
    const authorization: InternalInboxAuthorizationService = {
      filterConversations: async (_context, input) => input.conversations,
      assertConversationAccess: async () => undefined
    };
    const service = createSqlInternalInboxQueryService({
      database: database as unknown as HuleeDatabase,
      authorization
    });

    await expect(
      service.loadInboxView(context, {
        selectedConversationId: "conversation-1"
      })
    ).resolves.toMatchObject({
      selectedConversation: {
        id: "conversation-1"
      },
      messages: [
        {
          id: "message-1",
          attachments: [
            {
              id: "attachment-1",
              fileId: "file-1",
              fileName: "photo.jpg",
              mediaType: "image/jpeg",
              sizeBytes: 123,
              status: "stored"
            },
            {
              id: "attachment-2",
              fileId: "file-2",
              fileName: "document.pdf",
              mediaType: "application/pdf",
              sizeBytes: 456,
              status: "pending_download"
            }
          ]
        }
      ]
    });
    expect(database.execute).toHaveBeenCalledTimes(3);
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

  it("queues replies when the actor message scope covers the conversation queue", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-sales"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createQueueReplyAuthorization(),
      now: () => now,
      idempotencyKeyFactory: () => "reply-queue"
    });

    await expect(
      service.sendReply(context, {
        conversationId: conversation.id,
        request: {
          text: "Hello"
        }
      })
    ).resolves.toMatchObject({
      status: "queued",
      idempotencyKey: "reply-queue"
    });
    expect(repository.messages).toHaveLength(1);
  });

  it("rejects replies outside the actor message queue scope", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-claims"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createQueueReplyAuthorization(),
      now: () => now
    });

    await expect(
      service.sendReply(context, {
        conversationId: conversation.id,
        request: {
          text: "Hello"
        }
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.messages).toHaveLength(0);
  });

  it("ignores coarse context permissions when authorizing replies", async () => {
    const repository = new InMemoryExternalMessageRepository([conversation]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createNoGrantAuthorization(),
      now: () => now
    });

    await expect(
      service.sendReply(contextWithCoarsePermissions(["message.reply"]), {
        conversationId: conversation.id,
        request: {
          text: "Hello"
        }
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.messages).toHaveLength(0);
  });

  it("queues assigned-team replies for active team members", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        assignedTeamId: "team-sales"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createAssignedReplyAuthorization(),
      now: () => now,
      idempotencyKeyFactory: () => "reply-team"
    });

    await expect(
      service.sendReply(context, {
        conversationId: conversation.id,
        request: {
          text: "Hello"
        }
      })
    ).resolves.toMatchObject({
      status: "queued",
      idempotencyKey: "reply-team"
    });
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

  it("filters conversations by assigned team scope", async () => {
    const authorization = createInternalInboxAuthorizationService({
      employeeRepository: createEmployeeRepository(employee),
      rbacRepository: {
        async listEffectiveAccessSources() {
          return {
            roles: [
              {
                id: "role-team-inbox",
                tenantId,
                permissions: ["inbox.read"]
              }
            ],
            roleBindings: [
              {
                tenantId,
                roleId: "role-team-inbox",
                subject: {
                  type: "employee",
                  id: context.employeeId
                },
                scope: {
                  type: "team",
                  id: "team-sales"
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
        assignedTeamId: "team-sales"
      },
      {
        id: "conversation-claims",
        tenantId,
        clientId: "client-claims",
        assignedTeamId: "team-claims"
      }
    ];

    await expect(
      authorization.filterConversations(context, {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[0]]);
  });

  it("resolves queue owners before filtering org-unit scoped inbox visibility", async () => {
    const authorization = createInternalInboxAuthorizationService({
      employeeRepository: createEmployeeRepository(employee),
      rbacRepository: {
        async listEffectiveAccessSources() {
          return {
            roles: [
              {
                id: "role-sales-supervisor",
                tenantId,
                permissions: ["inbox.read"]
              }
            ],
            roleBindings: [
              {
                tenantId,
                roleId: "role-sales-supervisor",
                subject: {
                  type: "employee",
                  id: context.employeeId
                },
                scope: {
                  type: "org_unit",
                  id: "org-sales"
                }
              }
            ],
            directGrants: []
          };
        }
      },
      queueOwnerResolver: async ({ queueId }) => {
        return queueId === "queue-sales" ? "org-sales" : "org-claims";
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
    ).resolves.toEqual([
      {
        ...conversations[0],
        currentQueueOwningOrgUnitId: "org-sales"
      }
    ]);
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

  it("allows assigned replies for active team members", async () => {
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
          assignedTeamId: "team-sales"
        },
        permission: "message.reply"
      })
    ).resolves.toBeUndefined();
  });

  it("filters operational inbox visibility by employee role scopes", async () => {
    const { authorization, personas, conversations } =
      createOperationalAccessFixture();

    await expect(
      authorization.filterConversations(personaContext(personas.intake), {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[0]]);

    await expect(
      authorization.filterConversations(personaContext(personas.sales), {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[1]]);

    await expect(
      authorization.filterConversations(personaContext(personas.salesLead), {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[1], conversations[2]]);

    await expect(
      authorization.filterConversations(personaContext(personas.claims), {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[3]]);

    await expect(
      authorization.filterConversations(personaContext(personas.measurement), {
        conversations,
        permission: "inbox.read"
      })
    ).resolves.toEqual([conversations[4]]);
  });

  it("denies operational commands outside the effective scope", async () => {
    const { authorization, personas, conversations } =
      createOperationalAccessFixture();
    const [
      intakeLead,
      salesAssigned,
      salesOther,
      claimsConversation,
      measurementAssigned,
      measurementOther
    ] = conversations;

    await expect(
      authorization.assertConversationAccess(personaContext(personas.intake), {
        conversation: intakeLead,
        permission: "lead.classify"
      })
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertConversationAccess(personaContext(personas.intake), {
        conversation: salesAssigned,
        permission: "lead.classify"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));

    await expect(
      authorization.assertConversationAccess(personaContext(personas.sales), {
        conversation: salesAssigned,
        permission: "message.reply"
      })
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertConversationAccess(personaContext(personas.sales), {
        conversation: salesOther,
        permission: "message.reply"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));

    await expect(
      authorization.assertConversationAccess(
        personaContext(personas.salesLead),
        {
          conversation: salesOther,
          permission: "conversation.assign"
        }
      )
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertConversationAccess(
        personaContext(personas.salesLead),
        {
          conversation: claimsConversation,
          permission: "conversation.assign"
        }
      )
    ).rejects.toEqual(new CoreError("permission.denied"));

    await expect(
      authorization.assertConversationAccess(personaContext(personas.claims), {
        conversation: claimsConversation,
        permission: "message.reply"
      })
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertConversationAccess(personaContext(personas.claims), {
        conversation: salesAssigned,
        permission: "message.reply"
      })
    ).rejects.toEqual(new CoreError("permission.denied"));

    await expect(
      authorization.assertConversationAccess(
        personaContext(personas.measurement),
        {
          conversation: measurementAssigned,
          permission: "files.upload"
        }
      )
    ).resolves.toBeUndefined();
    await expect(
      authorization.assertConversationAccess(
        personaContext(personas.measurement),
        {
          conversation: measurementOther,
          permission: "files.upload"
        }
      )
    ).rejects.toEqual(new CoreError("permission.denied"));
  });

  it("updates conversation routing when source and target stay in the actor queue scope", async () => {
    const routedConversation: Conversation = {
      ...conversation,
      currentQueueId: "queue-sales"
    };
    const auditRecords: unknown[] = [];
    const repository = new InMemoryExternalMessageRepository([
      routedConversation
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createAssignAuthorization(),
      now: () => now,
      idFactory: () => createSequentialIdFactory("assign"),
      audit: {
        async record(record) {
          auditRecords.push(record);
        }
      }
    });

    await expect(
      service.updateConversationRouting(context, {
        conversationId: routedConversation.id,
        request: {
          currentQueueId: "queue-sales",
          assignedEmployeeId: "employee-2",
          assignedTeamId: "team-sales"
        }
      })
    ).resolves.toEqual({
      conversationId: routedConversation.id,
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-2",
      assignedTeamId: "team-sales"
    });
    expect(repository.conversations[0]).toMatchObject({
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-2",
      assignedTeamId: "team-sales"
    });
    expect(repository.routingEvents).toMatchObject([
      {
        type: "conversation.assigned",
        payload: {
          currentQueueId: "queue-sales",
          assignedEmployeeId: "employee-2",
          assignedTeamId: "team-sales"
        }
      }
    ]);
    expect(auditRecords).toMatchObject([
      {
        tenantId,
        actorEmployeeId: context.employeeId,
        action: "conversation.routing.updated",
        entityType: "conversation",
        entityId: routedConversation.id,
        metadata: {
          conversationId: routedConversation.id,
          previousCurrentQueueId: "queue-sales",
          currentQueueId: "queue-sales",
          previousAssignedEmployeeId: null,
          assignedEmployeeId: "employee-2",
          previousAssignedTeamId: null,
          assignedTeamId: "team-sales",
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "team", id: "team-sales" }
          ]
        },
        occurredAt: now
      }
    ]);
  });

  it("records immutable source and destination facets for cross-scope routing", async () => {
    const routedConversation: Conversation = {
      ...conversation,
      currentQueueId: "queue-sales",
      assignedTeamId: "team-sales"
    };
    const auditRecords: unknown[] = [];
    const repository = new InMemoryExternalMessageRepository([
      routedConversation
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createTenantAssignAuthorization(),
      now: () => now,
      audit: {
        async record(record) {
          auditRecords.push(record);
        }
      }
    });

    await service.updateConversationRouting(context, {
      conversationId: routedConversation.id,
      request: {
        currentQueueId: "queue-claims",
        assignedTeamId: "team-claims"
      }
    });

    expect(auditRecords).toMatchObject([
      {
        metadata: {
          previousCurrentQueueId: "queue-sales",
          currentQueueId: "queue-claims",
          previousAssignedTeamId: "team-sales",
          assignedTeamId: "team-claims",
          authorizationScopes: [
            { type: "queue", id: "queue-sales" },
            { type: "queue", id: "queue-claims" },
            { type: "team", id: "team-sales" },
            { type: "team", id: "team-claims" }
          ]
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

  it("rejects conversation routing into a target queue outside the actor scope", async () => {
    const repository = new InMemoryExternalMessageRepository([
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
          currentQueueId: "queue-claims"
        }
      })
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.routingEvents).toHaveLength(0);
  });

  it("ignores coarse context permissions when authorizing routing updates", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-sales"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createNoGrantAuthorization(),
      now: () => now
    });

    await expect(
      service.updateConversationRouting(
        contextWithCoarsePermissions(["conversation.assign"]),
        {
          conversationId: conversation.id,
          request: {
            currentQueueId: "queue-sales"
          }
        }
      )
    ).rejects.toEqual(new CoreError("permission.denied"));
    expect(repository.routingEvents).toHaveLength(0);
  });

  it("rejects conversation routing into a target queue outside the actor org-unit scope", async () => {
    const repository = new InMemoryExternalMessageRepository([
      {
        ...conversation,
        currentQueueId: "queue-sales"
      }
    ]);
    const service = createInternalInboxCommandService({
      repository,
      authorization: createOrgUnitAssignAuthorization(),
      now: () => now
    });

    await expect(
      service.updateConversationRouting(context, {
        conversationId: conversation.id,
        request: {
          currentQueueId: "queue-claims"
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
          currentQueueId: "queue-sales",
          assignedEmployeeId: "employee-missing"
        }
      })
    ).rejects.toEqual(new CoreError("validation.failed"));
  });
});

function createNoGrantAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [],
          roleBindings: [],
          directGrants: []
        };
      }
    },
    now: () => now
  });
}

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

function createQueueReplyAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [
            {
              id: "role-queue-reply",
              tenantId,
              permissions: ["message.reply"]
            }
          ],
          roleBindings: [
            {
              tenantId,
              roleId: "role-queue-reply",
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

function createAssignedReplyAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
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

function createTenantAssignAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [
            {
              id: "role-tenant-assign",
              tenantId,
              permissions: ["conversation.assign"]
            }
          ],
          roleBindings: [
            {
              tenantId,
              roleId: "role-tenant-assign",
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

function createOrgUnitAssignAuthorization(): InternalInboxAuthorizationService {
  return createInternalInboxAuthorizationService({
    employeeRepository: createEmployeeRepository(employee),
    rbacRepository: {
      async listEffectiveAccessSources() {
        return {
          roles: [
            {
              id: "role-org-assign",
              tenantId,
              permissions: ["conversation.assign"]
            }
          ],
          roleBindings: [
            {
              tenantId,
              roleId: "role-org-assign",
              subject: {
                type: "employee",
                id: context.employeeId
              },
              scope: {
                type: "org_unit",
                id: "org-sales"
              }
            }
          ],
          directGrants: []
        };
      }
    },
    queueOwnerResolver: async ({ queueId }) => {
      return queueId === "queue-sales" ? "org-sales" : "org-claims";
    },
    now: () => now
  });
}

function contextWithCoarsePermissions(
  permissions: readonly string[]
): typeof context & {
  readonly permissions: readonly string[];
} {
  return {
    ...context,
    permissions
  };
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

function createOperationalAccessFixture(): {
  readonly authorization: InternalInboxAuthorizationService;
  readonly personas: Record<
    "intake" | "sales" | "salesLead" | "claims" | "measurement",
    EmployeeId
  >;
  readonly conversations: readonly InternalInboxConversationAccessResource[];
} {
  const personas = {
    intake: "employee-lead-intake" as EmployeeId,
    sales: "employee-sales-rep" as EmployeeId,
    salesLead: "employee-sales-lead" as EmployeeId,
    claims: "employee-claims" as EmployeeId,
    measurement: "employee-measurement" as EmployeeId
  };
  const employees = new Map<EmployeeId, TenantEmployeeRecord>([
    [
      personas.intake,
      operationalEmployee(personas.intake, {
        queueIds: ["queue-new-leads"],
        orgUnitIds: ["org-intake"]
      })
    ],
    [
      personas.sales,
      operationalEmployee(personas.sales, {
        teamIds: ["team-sales"],
        orgUnitIds: ["org-sales"]
      })
    ],
    [
      personas.salesLead,
      operationalEmployee(personas.salesLead, {
        teamIds: ["team-sales"],
        orgUnitIds: ["org-sales"]
      })
    ],
    [
      personas.claims,
      operationalEmployee(personas.claims, {
        queueIds: ["queue-claims"],
        orgUnitIds: ["org-claims"]
      })
    ],
    [
      personas.measurement,
      operationalEmployee(personas.measurement, {
        teamIds: ["team-measurements"],
        orgUnitIds: ["org-field"]
      })
    ]
  ]);
  const roleDefinitions: readonly PermissionRoleDefinition[] = [
    operationalRole("role-lead-intake", [
      "inbox.read",
      "lead.classify",
      "lead.qualify",
      "conversation.assign",
      "client.view"
    ]),
    operationalRole("role-sales-rep", [
      "inbox.read",
      "message.reply",
      "client.view"
    ]),
    operationalRole("role-sales-supervisor", [
      "inbox.read",
      "message.reply",
      "conversation.assign",
      "client.view",
      "reports.view"
    ]),
    operationalRole("role-claims", [
      "inbox.read",
      "message.reply",
      "client.view",
      "files.upload"
    ]),
    operationalRole("role-measurement", [
      "inbox.read",
      "message.reply",
      "client.view",
      "files.upload"
    ])
  ];
  const accessSources = new Map<
    EmployeeId,
    {
      readonly roles: readonly PermissionRoleDefinition[];
      readonly roleBindings: readonly PermissionRoleBinding[];
      readonly directGrants: readonly DirectPermissionGrant[];
    }
  >([
    [
      personas.intake,
      {
        roles: [roleDefinitions[0]],
        roleBindings: [
          roleBinding("role-lead-intake", personas.intake, {
            type: "queue",
            id: "queue-new-leads"
          })
        ],
        directGrants: []
      }
    ],
    [
      personas.sales,
      {
        roles: [roleDefinitions[1]],
        roleBindings: [
          roleBinding("role-sales-rep", personas.sales, {
            type: "assigned"
          })
        ],
        directGrants: []
      }
    ],
    [
      personas.salesLead,
      {
        roles: [roleDefinitions[2]],
        roleBindings: [
          roleBinding("role-sales-supervisor", personas.salesLead, {
            type: "org_unit",
            id: "org-sales"
          })
        ],
        directGrants: []
      }
    ],
    [
      personas.claims,
      {
        roles: [roleDefinitions[3]],
        roleBindings: [
          roleBinding("role-claims", personas.claims, {
            type: "queue",
            id: "queue-claims"
          })
        ],
        directGrants: []
      }
    ],
    [
      personas.measurement,
      {
        roles: [roleDefinitions[4]],
        roleBindings: [
          roleBinding("role-measurement", personas.measurement, {
            type: "assigned"
          })
        ],
        directGrants: []
      }
    ]
  ]);

  return {
    authorization: createInternalInboxAuthorizationService({
      employeeRepository: createEmployeeMapRepository(employees),
      rbacRepository: {
        async listEffectiveAccessSources(input) {
          return (
            accessSources.get(input.actor.employeeId) ?? emptyAccessSources()
          );
        }
      },
      now: () => now
    }),
    personas,
    conversations: [
      operationalConversation("conversation-new-lead", "client-new-lead", {
        currentQueueId: "queue-new-leads",
        currentQueueOwningOrgUnitId: "org-intake"
      }),
      operationalConversation("conversation-sales-assigned", "client-sales-1", {
        currentQueueId: "queue-sales",
        currentQueueOwningOrgUnitId: "org-sales",
        assignedEmployeeId: personas.sales,
        assignedTeamId: "team-sales"
      }),
      operationalConversation("conversation-sales-other", "client-sales-2", {
        currentQueueId: "queue-sales",
        currentQueueOwningOrgUnitId: "org-sales",
        assignedEmployeeId: "employee-other-sales" as EmployeeId,
        assignedTeamId: "team-other-sales"
      }),
      operationalConversation("conversation-claims", "client-claims", {
        currentQueueId: "queue-claims",
        currentQueueOwningOrgUnitId: "org-claims"
      }),
      operationalConversation(
        "conversation-measurement-assigned",
        "client-measurement-1",
        {
          currentQueueId: "queue-measurements",
          currentQueueOwningOrgUnitId: "org-field",
          assignedEmployeeId: personas.measurement,
          assignedTeamId: "team-measurements"
        }
      ),
      operationalConversation(
        "conversation-measurement-other",
        "client-measurement-2",
        {
          currentQueueId: "queue-measurements",
          currentQueueOwningOrgUnitId: "org-field",
          assignedEmployeeId: "employee-other-measurement" as EmployeeId,
          assignedTeamId: "team-other-measurements"
        }
      )
    ]
  };
}

function createEmployeeMapRepository(
  employees: ReadonlyMap<EmployeeId, TenantEmployeeRecord>
) {
  return {
    async findEmployee(input: {
      tenantId: TenantId;
      employeeId: EmployeeId;
    }): Promise<TenantEmployeeRecord | null> {
      const employeeRecord = employees.get(input.employeeId);
      return employeeRecord?.tenantId === input.tenantId
        ? employeeRecord
        : null;
    }
  };
}

function operationalEmployee(
  employeeId: EmployeeId,
  input: {
    readonly teamIds?: readonly string[];
    readonly orgUnitIds?: readonly string[];
    readonly queueIds?: readonly string[];
  } = {}
): TenantEmployeeRecord {
  return {
    tenantId,
    employeeId,
    accountId: `${employeeId}-account`,
    email: `${employeeId}@example.com`,
    displayName: employeeId,
    phoneNumber: null,
    avatarUrl: null,
    avatar: null,
    systemRoleTemplateIds: [],
    teamIds: input.teamIds ?? [],
    orgUnitIds: input.orgUnitIds ?? [],
    queueIds: input.queueIds ?? [],
    createdAt: now,
    deactivatedAt: null
  };
}

function operationalRole(
  id: string,
  permissions: PermissionRoleDefinition["permissions"]
): PermissionRoleDefinition {
  return {
    id,
    tenantId,
    permissions
  };
}

function roleBinding(
  roleId: string,
  employeeId: EmployeeId,
  scope: PermissionRoleBinding["scope"]
): PermissionRoleBinding {
  return {
    tenantId,
    roleId,
    subject: {
      type: "employee",
      id: employeeId
    },
    scope
  };
}

function operationalConversation(
  id: string,
  clientId: string,
  input: Omit<
    InternalInboxConversationAccessResource,
    "id" | "tenantId" | "clientId"
  >
): InternalInboxConversationAccessResource {
  return {
    id,
    tenantId,
    clientId,
    ...input
  };
}

function personaContext(employeeId: EmployeeId): InternalInboxCommandContext {
  return {
    requestId: `request-${employeeId}`,
    tenantId,
    employeeId
  };
}

function emptyAccessSources(): {
  readonly roles: readonly PermissionRoleDefinition[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly directGrants: readonly DirectPermissionGrant[];
} {
  return {
    roles: [],
    roleBindings: [],
    directGrants: []
  };
}

class SequentialInboxDatabase {
  readonly execute = vi.fn(
    async <Row extends Record<string, unknown>>(): Promise<{
      rows: readonly Row[];
    }> => {
      return {
        rows: (this.responses.shift() ?? []) as readonly Row[]
      };
    }
  );

  private readonly responses: Array<readonly Record<string, unknown>[]>;

  constructor(responses: Array<readonly Record<string, unknown>[]>) {
    this.responses = [...responses];
  }
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
