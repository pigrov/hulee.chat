import type { PlatformEvent, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  ClientContact,
  FileRecord,
  IngestExternalIncomingMessageResult,
  Message,
  MessageAttachment,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientResult
} from "@hulee/core";

import {
  clientContacts as clientContactsTable,
  clients as clientsTable,
  conversations as conversationsTable,
  eventStore as eventStoreTable,
  files as filesTable,
  messageAttachments as messageAttachmentsTable,
  messages as messagesTable,
  outbox as outboxTable
} from "../schema/tables";
import { assertTenantScopedRows, type TenantScopedRow } from "./tenant-scope";

type ClientInsert = typeof clientsTable.$inferInsert;
type ClientContactInsert = typeof clientContactsTable.$inferInsert;
type ConversationInsert = typeof conversationsTable.$inferInsert;
type MessageInsert = typeof messagesTable.$inferInsert;
type FileInsert = typeof filesTable.$inferInsert;
type MessageAttachmentInsert = typeof messageAttachmentsTable.$inferInsert;
type EventStoreInsert = typeof eventStoreTable.$inferInsert;
type OutboxInsert = typeof outboxTable.$inferInsert;

export type RegisterExternalClientPersistenceRows = {
  clients: ClientInsert[];
  clientContacts: ClientContactInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export type ExternalMessageIngestionPersistenceRows = {
  clients: ClientInsert[];
  clientContacts: ClientContactInsert[];
  conversations: ConversationInsert[];
  messages: MessageInsert[];
  files: FileInsert[];
  messageAttachments: MessageAttachmentInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export type ExternalOutboundMessagePersistenceRows = {
  messages: MessageInsert[];
  eventStore: EventStoreInsert[];
  outbox: OutboxInsert[];
};

export function mapRegisterExternalClientToPersistenceRows(
  result: RegisterExternalClientResult
): RegisterExternalClientPersistenceRows {
  const rows: RegisterExternalClientPersistenceRows = {
    clients: [
      {
        id: result.client.id,
        tenantId: result.client.tenantId,
        displayName: result.client.displayName,
        source: result.client.source,
        createdAt: parseTimestamp(result.client.createdAt),
        updatedAt: parseTimestamp(result.client.createdAt)
      }
    ],
    clientContacts: result.contacts.map(mapClientContact),
    eventStore: result.events.map(mapEventStoreRow),
    outbox: result.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    result.client.tenantId,
    collectRegisterExternalClientTenantScopedRows(rows)
  );

  return rows;
}

export function mapExternalMessageIngestionToPersistenceRows(
  result: IngestExternalIncomingMessageResult
): ExternalMessageIngestionPersistenceRows {
  const rows: ExternalMessageIngestionPersistenceRows = {
    clients: result.createdClient
      ? [
          {
            id: result.client.id,
            tenantId: result.client.tenantId,
            displayName: result.client.displayName,
            source: result.client.source,
            createdAt: parseTimestamp(result.client.createdAt),
            updatedAt: parseTimestamp(result.client.createdAt)
          }
        ]
      : [],
    clientContacts:
      result.externalContact === undefined
        ? []
        : [mapClientContact(result.externalContact)],
    conversations: result.createdConversation
      ? [
          {
            id: result.conversation.id,
            tenantId: result.conversation.tenantId,
            type: result.conversation.type,
            clientId: result.conversation.clientId,
            currentQueueId: result.conversation.currentQueueId ?? null,
            assignedEmployeeId: result.conversation.assignedEmployeeId ?? null,
            assignedTeamId: result.conversation.assignedTeamId ?? null,
            status: "open",
            createdAt: parseTimestamp(result.conversation.createdAt),
            updatedAt: parseTimestamp(result.conversation.createdAt)
          }
        ]
      : [],
    messages: [mapMessage(result.message)],
    files: result.files.map(mapFile),
    messageAttachments: result.attachments.map(mapMessageAttachment),
    eventStore: result.events.map(mapEventStoreRow),
    outbox: result.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    result.message.tenantId,
    collectExternalMessageIngestionTenantScopedRows(rows)
  );

  return rows;
}

export function mapExternalOutboundMessageToPersistenceRows(
  result: QueueExternalOutboundMessageResult
): ExternalOutboundMessagePersistenceRows {
  const rows: ExternalOutboundMessagePersistenceRows = {
    messages: [mapMessage(result.message)],
    eventStore: result.events.map(mapEventStoreRow),
    outbox: result.events.map(mapOutboxRow)
  };

  assertTenantScopedRows(
    result.message.tenantId,
    collectExternalOutboundMessageTenantScopedRows(rows)
  );

  return rows;
}

export function collectRegisterExternalClientTenantScopedRows(
  rows: RegisterExternalClientPersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.clients.map(requireTenantScope),
    ...rows.clientContacts.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

export function collectExternalMessageIngestionTenantScopedRows(
  rows: ExternalMessageIngestionPersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.clients.map(requireTenantScope),
    ...rows.clientContacts.map(requireTenantScope),
    ...rows.conversations.map(requireTenantScope),
    ...rows.messages.map(requireTenantScope),
    ...rows.files.map(requireTenantScope),
    ...rows.messageAttachments.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

export function collectExternalOutboundMessageTenantScopedRows(
  rows: ExternalOutboundMessagePersistenceRows
): TenantScopedRow[] {
  return [
    ...rows.messages.map(requireTenantScope),
    ...rows.eventStore.map(requireTenantScope),
    ...rows.outbox.map(requireTenantScope)
  ];
}

function mapClientContact(contact: ClientContact): ClientContactInsert {
  const createdAt = parseTimestamp(contact.createdAt);

  return {
    id: contact.id,
    tenantId: contact.tenantId,
    clientId: contact.clientId,
    type: contact.type,
    value: contact.value,
    createdAt,
    updatedAt: createdAt
  };
}

function mapMessage(message: Message): MessageInsert {
  const createdAt = parseTimestamp(message.createdAt);

  return {
    id: message.id,
    tenantId: message.tenantId,
    conversationId: message.conversationId,
    direction: message.direction,
    text: message.text ?? null,
    status: message.status,
    idempotencyKey: message.idempotencyKey,
    createdAt,
    updatedAt: createdAt
  };
}

function mapFile(file: FileRecord): FileInsert {
  const createdAt = parseTimestamp(file.createdAt);

  return {
    id: file.id,
    tenantId: file.tenantId,
    storageKey: file.storageKey,
    fileName: file.fileName,
    mediaType: file.mediaType,
    sizeBytes: file.sizeBytes,
    status: file.status,
    metadata: file.metadata,
    createdAt,
    updatedAt: createdAt
  };
}

function mapMessageAttachment(
  attachment: MessageAttachment
): MessageAttachmentInsert {
  const createdAt = parseTimestamp(attachment.createdAt);

  return {
    id: attachment.id,
    tenantId: attachment.tenantId,
    messageId: attachment.messageId,
    fileId: attachment.fileId,
    provider: attachment.provider,
    providerAttachmentId: attachment.providerAttachmentId ?? null,
    sourceUrl: attachment.sourceUrl ?? null,
    sortOrder: attachment.sortOrder,
    metadata: attachment.metadata,
    createdAt,
    updatedAt: createdAt
  };
}

function mapEventStoreRow(event: PlatformEvent): EventStoreInsert {
  const occurredAt = parseTimestamp(event.occurredAt);

  return {
    id: event.id,
    tenantId: event.tenantId,
    type: event.type,
    version: event.version,
    occurredAt,
    idempotencyKey: event.idempotencyKey,
    payload: event.payload,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function mapOutboxRow(event: PlatformEvent): OutboxInsert {
  const occurredAt = parseTimestamp(event.occurredAt);

  return {
    id: `outbox:${event.id}`,
    tenantId: event.tenantId,
    eventId: event.id,
    status: "pending",
    attempts: 0,
    payload: event,
    createdAt: occurredAt,
    updatedAt: occurredAt
  };
}

function requireTenantScope(row: {
  tenantId?: TenantId | string | null;
}): TenantScopedRow {
  if (!row.tenantId) {
    throw new CoreError("tenant.boundary_violation");
  }

  return { tenantId: row.tenantId };
}

function parseTimestamp(value: string): Date {
  const parsed = new Date(value);

  if (Number.isNaN(parsed.getTime())) {
    throw new CoreError("validation.failed", `Invalid timestamp: ${value}`);
  }

  return parsed;
}
