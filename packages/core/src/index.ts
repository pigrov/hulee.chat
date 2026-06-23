export { assertTenantBoundary, createDomainEvent } from "./domain-events";
export type { TenantScope } from "./domain-events";
export { CoreError } from "./errors";
export { createSequentialIdFactory } from "./ids";
export type { IdFactory } from "./ids";
export {
  canonicalInternalApiSignaturePayload,
  createInternalApiSignature,
  internalApiSignatureHeader,
  internalApiTimestampHeader,
  verifyInternalApiSignature
} from "./internal-api-signing";
export type {
  InternalApiSignatureInput,
  InternalApiSignatureVerificationInput
} from "./internal-api-signing";
export {
  assertEmployeeCan,
  hasPermission,
  isEmployeeRole,
  isPermission,
  permissionsForRoles
} from "./permissions";
export type { Employee, EmployeeRole, Permission } from "./permissions";
export { createExternalChannelCommandService } from "./external-channel-command-service";
export type {
  ExternalChannelCommandContext,
  ExternalChannelCommandService,
  ExternalChannelCommandServiceOptions,
  ExternalMessageIngestionRepository,
  PersistedMessageSummary
} from "./external-channel-command-service";
export type {
  PersistTenantRegistrationInput,
  PersistConversationReplyInput,
  TenantWorkspaceRepository
} from "./repositories";
export { registerTenant } from "./tenant-registration";
export type {
  RegisterTenantInput,
  RegisteredTenant
} from "./tenant-registration";
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
