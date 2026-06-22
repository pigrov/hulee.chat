import type {
  ClientId,
  NormalizedIncomingMessage,
  PublicApiInboundMessageResponse,
  TenantId
} from "@hulee/contracts";
import { randomUUID } from "node:crypto";

import { CoreError } from "./errors";
import { createSequentialIdFactory, type IdFactory } from "./ids";
import {
  buildExternalClientHandle,
  ingestExternalIncomingMessage,
  type Client,
  type Conversation,
  type IngestExternalIncomingMessageResult,
  type Message
} from "./vertical-slice";

export type ExternalChannelCommandContext = {
  requestId: string;
  tenantId: TenantId;
  channelId: string;
};

export type PersistedMessageSummary = {
  message: Message;
  clientId: ClientId;
  updatedAt: string;
};

export type ExternalMessageIngestionRepository = {
  findClientByExternalHandle(input: {
    tenantId: TenantId;
    externalHandle: string;
  }): Promise<Client | null>;
  findOpenConversationByClientId(input: {
    tenantId: TenantId;
    clientId: ClientId;
  }): Promise<Conversation | null>;
  findMessageByIdempotencyKey(input: {
    tenantId: TenantId;
    idempotencyKey: string;
  }): Promise<PersistedMessageSummary | null>;
  saveExternalMessageIngestion(
    result: IngestExternalIncomingMessageResult
  ): Promise<void>;
};

export type ExternalChannelCommandService = {
  acceptInboundMessage(
    context: ExternalChannelCommandContext,
    message: NormalizedIncomingMessage
  ): Promise<PublicApiInboundMessageResponse>;
};

export type ExternalChannelCommandServiceOptions = {
  repository: ExternalMessageIngestionRepository;
  now?: () => Date;
  idFactory?: (context: ExternalChannelCommandContext) => IdFactory;
};

export function createExternalChannelCommandService(
  options: ExternalChannelCommandServiceOptions
): ExternalChannelCommandService {
  const now = options.now ?? (() => new Date());
  const idFactory =
    options.idFactory ??
    ((context: ExternalChannelCommandContext) =>
      createSequentialIdFactory(`${context.requestId}-${randomUUID()}`));

  return {
    async acceptInboundMessage(context, message) {
      if (message.tenantId !== context.tenantId) {
        throw new CoreError("tenant.boundary_violation");
      }

      const existingMessage =
        await options.repository.findMessageByIdempotencyKey({
          tenantId: context.tenantId,
          idempotencyKey: message.idempotencyKey
        });

      if (existingMessage !== null) {
        return inboundResponseFromPersisted(existingMessage);
      }

      const externalHandle = buildExternalClientHandle({
        channelExternalId: message.channelExternalId,
        clientExternalId: message.clientExternalId
      });
      const existingClient =
        await options.repository.findClientByExternalHandle({
          tenantId: context.tenantId,
          externalHandle
        });
      const existingConversation =
        existingClient === null
          ? null
          : await options.repository.findOpenConversationByClientId({
              tenantId: context.tenantId,
              clientId: existingClient.id
            });
      const result = ingestExternalIncomingMessage({
        now: now().toISOString(),
        idFactory: idFactory(context),
        tenantId: context.tenantId,
        channelExternalId: message.channelExternalId,
        clientExternalId: message.clientExternalId,
        providerMessageId: message.providerMessageId,
        occurredAt: message.occurredAt,
        idempotencyKey: message.idempotencyKey,
        text: message.text,
        existingClient: existingClient ?? undefined,
        existingConversation: existingConversation ?? undefined,
        clientDisplayName:
          message.clientDisplayName ?? message.clientExternalId,
        clientSource: "external_channel"
      });

      await options.repository.saveExternalMessageIngestion(result);

      return {
        clientId: result.client.id,
        conversationId: result.conversation.id,
        messageId: result.message.id,
        accepted: true
      };
    }
  };
}

function inboundResponseFromPersisted(
  summary: PersistedMessageSummary
): PublicApiInboundMessageResponse {
  return {
    clientId: summary.clientId,
    conversationId: summary.message.conversationId,
    messageId: summary.message.id,
    accepted: true
  };
}
