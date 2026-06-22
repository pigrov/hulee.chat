export { assertTenantBoundary, createDomainEvent } from "./domain-events";
export type { TenantScope } from "./domain-events";
export { CoreError } from "./errors";
export { createSequentialIdFactory } from "./ids";
export type { IdFactory } from "./ids";
export { assertEmployeeCan, hasPermission } from "./permissions";
export type { Employee, EmployeeRole, Permission } from "./permissions";
export type {
  PersistConversationReplyInput,
  TenantWorkspaceRepository
} from "./repositories";
export {
  buildExternalClientHandle,
  createMvpTenantWorkspace,
  ingestExternalIncomingMessage,
  queueExternalOutboundMessage,
  registerExternalClient,
  sendConversationReply
} from "./vertical-slice";
export type {
  Client,
  ClientContact,
  ClientContactType,
  ClientSource,
  Conversation,
  ConversationType,
  CreateMvpTenantWorkspaceInput,
  ExternalClientContactInput,
  IngestExternalIncomingMessageInput,
  IngestExternalIncomingMessageResult,
  Message,
  MessageDirection,
  MessageStatus,
  ModuleConfigMap,
  MvpTenantWorkspace,
  QueueExternalOutboundMessageInput,
  QueueExternalOutboundMessageResult,
  RegisterExternalClientInput,
  RegisterExternalClientResult,
  SendConversationReplyInput,
  SendConversationReplyResult,
  Tenant
} from "./vertical-slice";
