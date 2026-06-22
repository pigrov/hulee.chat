import type {
  ConversationId,
  MessageId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

export type QueuedOutboundMessageForDispatch = {
  tenantId: TenantId;
  messageId: MessageId;
  conversationId: ConversationId;
  channelExternalId: string;
  clientExternalId: string;
  text?: string;
  idempotencyKey: string;
};

export type FindQueuedOutboundMessageInput = {
  tenantId: TenantId;
  messageId: MessageId | string;
};

export type MarkOutboundMessageSentInput = {
  tenantId: TenantId;
  messageId: MessageId | string;
  providerMessageId: string;
  attemptId: string;
  deliveredAt: Date;
};

export type MarkOutboundMessageFailedInput = {
  tenantId: TenantId;
  messageId: MessageId | string;
  errorCode: PlatformErrorCode;
  attemptId: string;
  failedAt: Date;
};

export type OutboundDispatchRepository = {
  findQueuedMessage(
    input: FindQueuedOutboundMessageInput
  ): Promise<QueuedOutboundMessageForDispatch | null>;
  markSent(input: MarkOutboundMessageSentInput): Promise<void>;
  markFailed(input: MarkOutboundMessageFailedInput): Promise<void>;
};

type QueuedOutboundMessageRow = {
  id: string;
  tenant_id: string;
  conversation_id: string;
  text: string | null;
  idempotency_key: string;
  external_handle: string;
};

export function createSqlOutboundDispatchRepository(
  executor: RawSqlExecutor | HuleeDatabase
): OutboundDispatchRepository {
  const rawExecutor = executor as RawSqlExecutor;

  return {
    async findQueuedMessage(input) {
      const result = await rawExecutor.execute<QueuedOutboundMessageRow>(
        buildFindQueuedOutboundMessageSql(input)
      );

      return result.rows[0]
        ? mapQueuedOutboundMessageRow(result.rows[0])
        : null;
    },

    async markSent(input) {
      await rawExecutor.execute(buildMarkOutboundMessageSentSql(input));
    },

    async markFailed(input) {
      await rawExecutor.execute(buildMarkOutboundMessageFailedSql(input));
    }
  };
}

export function buildFindQueuedOutboundMessageSql(
  input: FindQueuedOutboundMessageInput
): SQL {
  return sql`
    select m.id,
           m.tenant_id,
           m.conversation_id,
           m.text,
           m.idempotency_key,
           cc.value as external_handle
    from messages m
    inner join conversations c
      on c.tenant_id = m.tenant_id
     and c.id = m.conversation_id
    inner join client_contacts cc
      on cc.tenant_id = c.tenant_id
     and cc.client_id = c.client_id
     and cc.type = 'external_handle'
    where m.tenant_id = ${input.tenantId}
      and m.id = ${input.messageId}
      and m.direction = 'outbound'
      and m.status = 'queued'
    order by cc.created_at asc
    limit 1
  `;
}

export function buildMarkOutboundMessageSentSql(
  input: MarkOutboundMessageSentInput
): SQL {
  return sql`
    with updated_message as (
      update messages
      set status = 'sent',
          error_code = null,
          updated_at = ${input.deliveredAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.messageId}
        and direction = 'outbound'
        and status = 'queued'
      returning id, tenant_id
    )
    insert into message_delivery_attempts (
      id,
      tenant_id,
      message_id,
      status,
      provider_message_id,
      error_code,
      retryable,
      created_at,
      updated_at
    )
    select ${input.attemptId},
           tenant_id,
           id,
           'sent',
           ${input.providerMessageId},
           null,
           false,
           ${input.deliveredAt},
           ${input.deliveredAt}
    from updated_message
    on conflict do nothing
  `;
}

export function buildMarkOutboundMessageFailedSql(
  input: MarkOutboundMessageFailedInput
): SQL {
  return sql`
    with updated_message as (
      update messages
      set status = 'failed',
          error_code = ${input.errorCode},
          updated_at = ${input.failedAt}
      where tenant_id = ${input.tenantId}
        and id = ${input.messageId}
        and direction = 'outbound'
        and status = 'queued'
      returning id, tenant_id
    )
    insert into message_delivery_attempts (
      id,
      tenant_id,
      message_id,
      status,
      provider_message_id,
      error_code,
      retryable,
      created_at,
      updated_at
    )
    select ${input.attemptId},
           tenant_id,
           id,
           'failed',
           null,
           ${input.errorCode},
           false,
           ${input.failedAt},
           ${input.failedAt}
    from updated_message
    on conflict do nothing
  `;
}

function mapQueuedOutboundMessageRow(
  row: QueuedOutboundMessageRow
): QueuedOutboundMessageForDispatch {
  const parsed = parseExternalHandle(row.external_handle);

  return {
    tenantId: row.tenant_id as TenantId,
    messageId: row.id as MessageId,
    conversationId: row.conversation_id as ConversationId,
    channelExternalId: parsed.channelExternalId,
    clientExternalId: parsed.clientExternalId,
    text: row.text ?? undefined,
    idempotencyKey: row.idempotency_key
  };
}

function parseExternalHandle(value: string): {
  channelExternalId: string;
  clientExternalId: string;
} {
  const match = value.match(/^channel:(.+):client:(.+)$/);

  if (!match?.[1] || !match[2]) {
    throw new CoreError("validation.failed", "Invalid external handle format");
  }

  return {
    channelExternalId: match[1],
    clientExternalId: match[2]
  };
}
