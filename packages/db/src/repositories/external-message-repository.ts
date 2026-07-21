import type {
  ClientId,
  ConversationId,
  MessageId,
  PlatformErrorCode,
  PlatformEvent,
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

export type UpdateConversationRoutingInput = {
  tenantId: TenantId;
  conversation: Conversation;
  events: readonly PlatformEvent[];
  updatedAt: Date;
};

export type PersistedMessageSummary = {
  message: Message;
  clientId: ClientId;
  updatedAt: string;
  errorCode?: PlatformErrorCode;
  providerMessageId?: string;
};

/**
 * Temporary type-only seam for detached V1 callers. Inbox V2 has no SQL
 * implementation for this contract; CLEAN-003 removes the remaining callers.
 */
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
  updateConversationRouting(
    input: UpdateConversationRoutingInput
  ): Promise<Conversation | null>;
  saveRegisteredClient(result: RegisterExternalClientResult): Promise<void>;
  saveExternalMessageIngestion(
    result: IngestExternalIncomingMessageResult
  ): Promise<void>;
  saveExternalOutboundMessage(
    result: QueueExternalOutboundMessageResult
  ): Promise<void>;
};
