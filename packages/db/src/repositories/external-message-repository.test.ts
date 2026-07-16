import type {
  ConversationId,
  EmployeeId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import {
  createSequentialIdFactory,
  ingestExternalIncomingMessage,
  queueExternalOutboundMessage,
  registerExternalClient
} from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  createExternalMessageRepository,
  type ExternalMessageRepository
} from "./external-message-repository";
import { RecordingPersistenceExecutor } from "./recording-persistence-executor.test-helper";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant_external_repo" as TenantId;
const now = "2026-06-22T10:00:00.000Z";

describe("external message repository", () => {
  it("persists registered clients in foreign-key-safe order", async () => {
    const executor = new RecordingPersistenceExecutor();
    const repository = createRepository(executor);
    const registration = registerExternalClient({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("repo-register"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      displayName: "Client One",
      source: "public_api"
    });

    await repository.saveRegisteredClient(registration);

    expect(executor.transactionCount).toBe(1);
    expect(executor.operations.map((operation) => operation.tableName)).toEqual(
      ["clients", "client_contacts", "event_store", "outbox"]
    );
  });

  it("persists inbound messages in foreign-key-safe order", async () => {
    const executor = new RecordingPersistenceExecutor();
    const repository = createRepository(executor);
    const inbound = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("repo-inbound"),
      channelExternalId: "public-api",
      clientExternalId: "client-1",
      providerMessageId: "provider-message-1",
      occurredAt: now,
      idempotencyKey: "inbound-1",
      text: "Hello"
    });

    await repository.saveExternalMessageIngestion(inbound);

    expect(executor.transactionCount).toBe(1);
    expect(executor.operations.map((operation) => operation.tableName)).toEqual(
      [
        "clients",
        "client_contacts",
        "conversations",
        "messages",
        "files",
        "message_attachments",
        "event_store",
        "outbox"
      ]
    );
  });

  it("persists inbound message attachments after messages and files", async () => {
    const executor = new RecordingPersistenceExecutor();
    const repository = createRepository(executor);
    const inbound = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("repo-inbound-attachment"),
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

    await repository.saveExternalMessageIngestion(inbound);

    expect(
      executor.operations.map((operation) => [
        operation.tableName,
        operation.rowCount
      ])
    ).toEqual([
      ["clients", 1],
      ["client_contacts", 1],
      ["conversations", 1],
      ["messages", 1],
      ["files", 1],
      ["message_attachments", 1],
      ["event_store", 3],
      ["outbox", 3]
    ]);
  });

  it("persists outbound messages in message/event/outbox order", async () => {
    const executor = new RecordingPersistenceExecutor();
    const repository = createRepository(executor);
    const inbound = ingestExternalIncomingMessage({
      now,
      tenantId,
      idFactory: createSequentialIdFactory("repo-outbound-inbound"),
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
      idFactory: createSequentialIdFactory("repo-outbound"),
      conversation: inbound.conversation,
      text: "Hi",
      idempotencyKey: "outbound-1"
    });

    await repository.saveExternalOutboundMessage(outbound);

    expect(executor.operations.map((operation) => operation.tableName)).toEqual(
      ["messages", "event_store", "outbox"]
    );
  });

  it("maps raw SQL message summaries when timestamps are returned as strings", async () => {
    const repository = createExternalMessageRepository({
      rawExecutor: new RecordingSqlExecutor([
        {
          id: "message-1",
          tenant_id: tenantId,
          conversation_id: "conversation-1",
          direction: "inbound",
          text: "Hello",
          status: "received",
          idempotency_key: "inbound-1",
          created_at: "2026-06-22T10:00:00.000Z",
          updated_at: "2026-06-22T10:01:00.000Z",
          error_code: null,
          client_id: "client-1",
          provider_message_id: null
        }
      ]),
      persistenceExecutor: new RecordingPersistenceExecutor()
    });

    await expect(
      repository.findMessageByIdempotencyKey({
        tenantId,
        idempotencyKey: "inbound-1"
      })
    ).resolves.toMatchObject({
      message: {
        id: "message-1",
        createdAt: "2026-06-22T10:00:00.000Z"
      },
      updatedAt: "2026-06-22T10:01:00.000Z"
    });
  });

  it("updates conversation routing and maps nullable assignment fields", async () => {
    const executor = new RecordingSqlExecutor([
      {
        id: "conversation-1",
        tenant_id: tenantId,
        type: "client_direct",
        client_id: "client-1",
        current_queue_id: "queue-sales",
        assigned_employee_id: "employee-sales",
        assigned_team_id: null,
        created_at: "2026-06-22T10:00:00.000Z"
      }
    ]);
    const repository = createExternalMessageRepository({
      rawExecutor: executor,
      persistenceExecutor: new RecordingPersistenceExecutor()
    });

    await expect(
      repository.updateConversationRouting({
        tenantId,
        conversation: {
          id: "conversation-1" as ConversationId,
          tenantId,
          type: "client_direct",
          clientId: "client-1" as never,
          participantEmployeeIds: [],
          currentQueueId: "queue-sales",
          assignedEmployeeId: "employee-sales" as EmployeeId,
          createdAt: "2026-06-22T10:00:00.000Z"
        },
        events: [createConversationAssignedEvent()],
        updatedAt: new Date("2026-06-22T11:00:00.000Z")
      })
    ).resolves.toMatchObject({
      id: "conversation-1",
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-sales",
      assignedTeamId: undefined
    });
    expect(new PgDialect().sqlToQuery(executor.queries[0]!).sql).toMatch(
      /returning\s+conversations\.id[\s\S]*conversations\.current_queue_id/u
    );
  });
});

function createRepository(
  persistenceExecutor: RecordingPersistenceExecutor
): ExternalMessageRepository {
  return createExternalMessageRepository({
    rawExecutor: new RecordingSqlExecutor([]),
    persistenceExecutor
  });
}

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}

function createConversationAssignedEvent(): PlatformEvent {
  return {
    id: "event-conversation-assigned" as never,
    type: "conversation.assigned",
    version: "v1",
    tenantId,
    occurredAt: "2026-06-22T11:00:00.000Z",
    payload: {
      conversationId: "conversation-1" as ConversationId,
      actorEmployeeId: "employee-manager" as EmployeeId,
      currentQueueId: "queue-sales",
      assignedEmployeeId: "employee-sales" as EmployeeId,
      assignedTeamId: null
    }
  };
}
