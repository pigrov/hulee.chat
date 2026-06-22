import type {
  ClientId,
  ConversationId,
  MessageId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import type {
  Client,
  Conversation,
  IngestExternalIncomingMessageResult,
  Message,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientResult
} from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  clientContacts,
  clients,
  conversations,
  eventStore,
  messages,
  outbox
} from "../schema/tables";
import type { PersistenceExecutor } from "./persistence-executor";
import { tableRef } from "./persistence-executor";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import {
  mapExternalMessageIngestionToPersistenceRows,
  mapExternalOutboundMessageToPersistenceRows,
  mapRegisterExternalClientToPersistenceRows
} from "./external-message-mapper";

export type FindClientByExternalHandleInput = {
  tenantId: TenantId;
  externalHandle: string;
};

export type FindOpenConversationByClientInput = {
  tenantId: TenantId;
  clientId: ClientId;
};

export type FindMessageByIdempotencyKeyInput = {
  tenantId: TenantId;
  idempotencyKey: string;
};

export type FindConversationByIdInput = {
  tenantId: TenantId;
  conversationId: ConversationId;
};

export type FindDeliveryStatusInput = {
  tenantId: TenantId;
  messageId: MessageId | string;
};

export type PersistedMessageSummary = {
  message: Message;
  clientId: ClientId;
  updatedAt: string;
  errorCode?: PlatformErrorCode;
  providerMessageId?: string;
};

export type ExternalMessageRepository = {
  findClientByExternalHandle(
    input: FindClientByExternalHandleInput
  ): Promise<Client | null>;
  findOpenConversationByClientId(
    input: FindOpenConversationByClientInput
  ): Promise<Conversation | null>;
  findMessageByIdempotencyKey(
    input: FindMessageByIdempotencyKeyInput
  ): Promise<PersistedMessageSummary | null>;
  findConversationById(
    input: FindConversationByIdInput
  ): Promise<Conversation | null>;
  findDeliveryStatus(
    input: FindDeliveryStatusInput
  ): Promise<PersistedMessageSummary | null>;
  saveRegisteredClient(result: RegisterExternalClientResult): Promise<void>;
  saveExternalMessageIngestion(
    result: IngestExternalIncomingMessageResult
  ): Promise<void>;
  saveExternalOutboundMessage(
    result: QueueExternalOutboundMessageResult
  ): Promise<void>;
};

type ClientRow = {
  id: string;
  tenant_id: string;
  display_name: string;
  source: string;
  created_at: Date | string;
};

type ConversationRow = {
  id: string;
  tenant_id: string;
  type: Conversation["type"];
  client_id: string;
  created_at: Date | string;
};

type MessageSummaryRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  direction: Message["direction"];
  text: string | null;
  status: Message["status"];
  idempotency_key: string;
  created_at: Date | string;
  updated_at: Date | string;
  error_code: string | null;
  client_id: string;
  provider_message_id: string | null;
};

const tableRefs = {
  clients: tableRef("clients", clients),
  clientContacts: tableRef("client_contacts", clientContacts),
  conversations: tableRef("conversations", conversations),
  messages: tableRef("messages", messages),
  eventStore: tableRef("event_store", eventStore),
  outbox: tableRef("outbox", outbox)
};

export function createExternalMessageRepository(input: {
  rawExecutor: RawSqlExecutor | HuleeDatabase;
  persistenceExecutor: PersistenceExecutor;
}): ExternalMessageRepository {
  const rawExecutor = input.rawExecutor as RawSqlExecutor;
  const persistenceExecutor = input.persistenceExecutor;

  return {
    async findClientByExternalHandle(
      findInput: FindClientByExternalHandleInput
    ): Promise<Client | null> {
      const result = await rawExecutor.execute<ClientRow>(
        buildFindClientByExternalHandleSql(findInput)
      );

      return result.rows[0] ? mapClientRow(result.rows[0]) : null;
    },

    async findOpenConversationByClientId(
      findInput: FindOpenConversationByClientInput
    ): Promise<Conversation | null> {
      const result = await rawExecutor.execute<ConversationRow>(
        buildFindOpenConversationByClientSql(findInput)
      );

      return result.rows[0] ? mapConversationRow(result.rows[0]) : null;
    },

    async findMessageByIdempotencyKey(
      findInput: FindMessageByIdempotencyKeyInput
    ): Promise<PersistedMessageSummary | null> {
      const result = await rawExecutor.execute<MessageSummaryRow>(
        buildFindMessageByIdempotencyKeySql(findInput)
      );

      return result.rows[0] ? mapMessageSummaryRow(result.rows[0]) : null;
    },

    async findConversationById(
      findInput: FindConversationByIdInput
    ): Promise<Conversation | null> {
      const result = await rawExecutor.execute<ConversationRow>(
        buildFindConversationByIdSql(findInput)
      );

      return result.rows[0] ? mapConversationRow(result.rows[0]) : null;
    },

    async findDeliveryStatus(
      findInput: FindDeliveryStatusInput
    ): Promise<PersistedMessageSummary | null> {
      const result = await rawExecutor.execute<MessageSummaryRow>(
        buildFindDeliveryStatusSql(findInput)
      );

      return result.rows[0] ? mapMessageSummaryRow(result.rows[0]) : null;
    },

    async saveRegisteredClient(
      result: RegisterExternalClientResult
    ): Promise<void> {
      const rows = mapRegisterExternalClientToPersistenceRows(result);

      await persistenceExecutor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.clients, rows.clients);
        await transaction.insertRows(
          tableRefs.clientContacts,
          rows.clientContacts
        );
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore);
        await transaction.insertRows(tableRefs.outbox, rows.outbox);
      });
    },

    async saveExternalMessageIngestion(
      result: IngestExternalIncomingMessageResult
    ): Promise<void> {
      const rows = mapExternalMessageIngestionToPersistenceRows(result);

      await persistenceExecutor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.clients, rows.clients);
        await transaction.insertRows(
          tableRefs.clientContacts,
          rows.clientContacts
        );
        await transaction.insertRows(
          tableRefs.conversations,
          rows.conversations
        );
        await transaction.insertRows(tableRefs.messages, rows.messages);
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore);
        await transaction.insertRows(tableRefs.outbox, rows.outbox);
      });
    },

    async saveExternalOutboundMessage(
      result: QueueExternalOutboundMessageResult
    ): Promise<void> {
      const rows = mapExternalOutboundMessageToPersistenceRows(result);

      await persistenceExecutor.transaction(async (transaction) => {
        await transaction.insertRows(tableRefs.messages, rows.messages);
        await transaction.insertRows(tableRefs.eventStore, rows.eventStore);
        await transaction.insertRows(tableRefs.outbox, rows.outbox);
      });
    }
  };
}

export function buildFindClientByExternalHandleSql(
  input: FindClientByExternalHandleInput
): SQL {
  return sql`
    select c.id,
           c.tenant_id,
           c.display_name,
           c.source,
           c.created_at
    from clients c
    inner join client_contacts cc
      on cc.tenant_id = c.tenant_id
     and cc.client_id = c.id
    where c.tenant_id = ${input.tenantId}
      and cc.type = 'external_handle'
      and cc.value = ${input.externalHandle}
    order by c.created_at asc
    limit 1
  `;
}

export function buildFindOpenConversationByClientSql(
  input: FindOpenConversationByClientInput
): SQL {
  return sql`
    select id,
           tenant_id,
           type,
           client_id,
           created_at
    from conversations
    where tenant_id = ${input.tenantId}
      and client_id = ${input.clientId}
      and type = 'client_direct'
      and status = 'open'
    order by created_at desc
    limit 1
  `;
}

export function buildFindMessageByIdempotencyKeySql(
  input: FindMessageByIdempotencyKeyInput
): SQL {
  return buildMessageSummaryWhereSql(sql`
    m.tenant_id = ${input.tenantId}
      and m.idempotency_key = ${input.idempotencyKey}
  `);
}

export function buildFindConversationByIdSql(
  input: FindConversationByIdInput
): SQL {
  return sql`
    select id,
           tenant_id,
           type,
           client_id,
           created_at
    from conversations
    where tenant_id = ${input.tenantId}
      and id = ${input.conversationId}
    limit 1
  `;
}

export function buildFindDeliveryStatusSql(
  input: FindDeliveryStatusInput
): SQL {
  return buildMessageSummaryWhereSql(sql`
    m.tenant_id = ${input.tenantId}
      and m.id = ${input.messageId}
  `);
}

function buildMessageSummaryWhereSql(where: SQL): SQL {
  return sql`
    select m.id,
           m.tenant_id,
           m.conversation_id,
           m.direction,
           m.text,
           m.status,
           m.idempotency_key,
           m.created_at,
           m.updated_at,
           m.error_code,
           c.client_id,
           (
             select mda.provider_message_id
             from message_delivery_attempts mda
             where mda.tenant_id = m.tenant_id
               and mda.message_id = m.id
               and mda.provider_message_id is not null
             order by mda.created_at desc
             limit 1
           ) as provider_message_id
    from messages m
    inner join conversations c
      on c.tenant_id = m.tenant_id
     and c.id = m.conversation_id
    where ${where}
    limit 1
  `;
}

function mapClientRow(row: ClientRow): Client {
  return {
    id: row.id as ClientId,
    tenantId: row.tenant_id as TenantId,
    displayName: row.display_name,
    source: row.source as Client["source"],
    createdAt: toIsoTimestamp(row.created_at)
  };
}

function mapConversationRow(row: ConversationRow): Conversation {
  return {
    id: row.id as ConversationId,
    tenantId: row.tenant_id as TenantId,
    type: row.type,
    clientId: row.client_id as ClientId,
    participantEmployeeIds: [],
    createdAt: toIsoTimestamp(row.created_at)
  };
}

function mapMessageSummaryRow(row: MessageSummaryRow): PersistedMessageSummary {
  return {
    message: {
      id: row.id as MessageId,
      tenantId: row.tenant_id as TenantId,
      conversationId: row.conversation_id as ConversationId,
      direction: row.direction,
      text: row.text ?? undefined,
      status: row.status,
      idempotencyKey: row.idempotency_key,
      createdAt: toIsoTimestamp(row.created_at)
    },
    clientId: row.client_id as ClientId,
    updatedAt: toIsoTimestamp(row.updated_at),
    errorCode:
      row.error_code === null
        ? undefined
        : (row.error_code as PlatformErrorCode),
    providerMessageId: row.provider_message_id ?? undefined
  };
}

function toIsoTimestamp(value: Date | string): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}
