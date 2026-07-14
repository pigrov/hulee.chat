import type { Brand } from "./brand";

export type TenantId = Brand<string, "TenantId">;
export type EmployeeId = Brand<string, "EmployeeId">;
export type ClientId = Brand<string, "ClientId">;
export type ConversationId = Brand<string, "ConversationId">;
export type MessageId = Brand<string, "MessageId">;
export type EventId = Brand<string, "EventId">;
export type ChannelConnectorId = Brand<string, "ChannelConnectorId">;
export type SourceConnectionId = Brand<string, "SourceConnectionId">;
export type SourceAccountId = Brand<string, "SourceAccountId">;
export type RawInboundEventId = Brand<string, "RawInboundEventId">;
export type NormalizedInboundEventId = Brand<
  string,
  "NormalizedInboundEventId"
>;
