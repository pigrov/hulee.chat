import type {
  MessageId,
  PublicApiDeliveryStatusResponse,
  PublicApiInboundMessageRequest,
  PublicApiInboundMessageResponse,
  PublicApiOutboundMessageRequest,
  PublicApiOutboundMessageResponse,
  PublicApiRegisterClientRequest,
  PublicApiRegisterClientResponse
} from "@hulee/contracts";
import { randomUUID } from "crypto";
import type {
  ExternalMessageRepository,
  PersistedMessageSummary
} from "@hulee/db";
import {
  buildExternalClientHandle,
  CoreError,
  createSequentialIdFactory,
  ingestExternalIncomingMessage,
  queueExternalOutboundMessage,
  registerExternalClient,
  type ClientContactType,
  type IdFactory
} from "@hulee/core";

import type {
  PublicApiCommandContext,
  PublicApiCommandService
} from "./http/public-api-handler";

export type PublicApiCommandServiceOptions = {
  repository: ExternalMessageRepository;
  now?: () => Date;
  idFactory?: (context: PublicApiCommandContext) => IdFactory;
};

const publicApiChannelExternalId = "public-api";

export function createPublicApiCommandService(
  options: PublicApiCommandServiceOptions
): PublicApiCommandService {
  const now = options.now ?? (() => new Date());
  const idFactory =
    options.idFactory ??
    ((context: PublicApiCommandContext) =>
      createSequentialIdFactory(`${context.requestId}-${randomUUID()}`));

  return {
    async registerClient(
      context: PublicApiCommandContext,
      request: PublicApiRegisterClientRequest
    ): Promise<PublicApiRegisterClientResponse> {
      const externalHandle = buildExternalClientHandle({
        channelExternalId: publicApiChannelExternalId,
        clientExternalId: request.externalId
      });
      const existingClient =
        await options.repository.findClientByExternalHandle({
          tenantId: context.tenantId,
          externalHandle
        });

      if (existingClient !== null) {
        return {
          clientId: existingClient.id,
          externalId: request.externalId,
          created: false
        };
      }

      const result = registerExternalClient({
        now: now().toISOString(),
        tenantId: context.tenantId,
        idFactory: idFactory(context),
        channelExternalId: publicApiChannelExternalId,
        clientExternalId: request.externalId,
        displayName: request.displayName,
        source: "public_api",
        contacts: request.contacts.map((contact) => ({
          type: contact.type as ClientContactType,
          value: contact.value
        }))
      });

      await options.repository.saveRegisteredClient(result);

      return {
        clientId: result.client.id,
        externalId: request.externalId,
        created: true
      };
    },

    async acceptInboundMessage(
      context,
      message,
      _request: PublicApiInboundMessageRequest
    ): Promise<PublicApiInboundMessageResponse> {
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
        clientSource: "public_api"
      });

      await options.repository.saveExternalMessageIngestion(result);

      return {
        clientId: result.client.id,
        conversationId: result.conversation.id,
        messageId: result.message.id,
        accepted: true
      };
    },

    async queueOutboundMessage(
      context,
      request: PublicApiOutboundMessageRequest
    ): Promise<PublicApiOutboundMessageResponse> {
      const existingMessage =
        await options.repository.findMessageByIdempotencyKey({
          tenantId: context.tenantId,
          idempotencyKey: request.idempotencyKey
        });

      if (existingMessage !== null) {
        return {
          messageId: existingMessage.message.id,
          status: "queued",
          idempotencyKey: existingMessage.message.idempotencyKey
        };
      }

      const conversation = await options.repository.findConversationById({
        tenantId: context.tenantId,
        conversationId: request.conversationId as never
      });

      if (conversation === null) {
        throw new CoreError("tenant.not_found");
      }

      const result = queueExternalOutboundMessage({
        now: now().toISOString(),
        idFactory: idFactory(context),
        tenantId: context.tenantId,
        conversation,
        text: request.text,
        idempotencyKey: request.idempotencyKey
      });

      await options.repository.saveExternalOutboundMessage(result);

      return {
        messageId: result.message.id,
        status: "queued",
        idempotencyKey: result.message.idempotencyKey
      };
    },

    async getDeliveryStatus(
      context,
      messageId: string
    ): Promise<PublicApiDeliveryStatusResponse> {
      const summary = await options.repository.findDeliveryStatus({
        tenantId: context.tenantId,
        messageId: messageId as MessageId
      });

      if (summary === null) {
        throw new CoreError("tenant.not_found");
      }

      return {
        messageId: summary.message.id,
        status: mapDeliveryStatus(summary),
        providerMessageId: summary.providerMessageId,
        errorCode: summary.errorCode,
        updatedAt: summary.updatedAt
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

function mapDeliveryStatus(
  summary: PersistedMessageSummary
): PublicApiDeliveryStatusResponse["status"] {
  if (summary.message.status === "received") {
    return "accepted";
  }

  return summary.message.status;
}
