import type {
  ConversationId,
  MessageId,
  PlatformErrorCode,
  TenantId
} from "@hulee/contracts";

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
