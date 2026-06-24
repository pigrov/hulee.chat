export { assertTenantBoundary, createDomainEvent } from "./domain-events";
export type { TenantScope } from "./domain-events";
export {
  assertCanAccess,
  can,
  canAccess,
  resolveEffectivePermissionGrants
} from "./access-control";
export type {
  CanAccessInput,
  DirectPermissionGrant,
  EffectivePermissionGrant,
  PermissionActor,
  PermissionDecision,
  PermissionDecisionReason,
  PermissionGrantSource,
  PermissionResourceContext,
  PermissionRoleBinding,
  PermissionRoleBindingSubject,
  PermissionRoleDefinition,
  ResolveEffectivePermissionGrantsInput
} from "./access-control";
export {
  completeAuthEmailToken,
  createAccountEmailVerifiedEvent,
  createAuthEmailToken
} from "./auth-email-tokens";
export type {
  AuthEmailToken,
  AuthEmailTokenPurpose,
  CompletedAuthEmailToken,
  CompleteAuthEmailTokenInput,
  CreateAccountEmailVerifiedEventInput,
  CreatedAuthEmailToken,
  CreateAuthEmailTokenInput
} from "./auth-email-tokens";
export { assignConversationRouting } from "./conversation-routing";
export type {
  AssignConversationRoutingInput,
  AssignConversationRoutingResult
} from "./conversation-routing";
export { CoreError } from "./errors";
export {
  acceptEmployeeInvitation,
  changeEmployeeRole,
  createEmployeeInvitation,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation
} from "./employee-invitations";
export type {
  AcceptedEmployeeInvitation,
  AcceptEmployeeInvitationInput,
  ChangedEmployeeRole,
  ChangeEmployeeRoleInput,
  CreatedEmployeeInvitation,
  CreateEmployeeInvitationInput,
  DeactivatedEmployee,
  DeactivateEmployeeInput,
  EmployeeInvitation,
  ResentEmployeeInvitation,
  ResendEmployeeInvitationInput,
  RevokedEmployeeInvitation,
  RevokeEmployeeInvitationInput
} from "./employee-invitations";
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
  allowedScopeTypesForPermissions,
  allowedScopesForPermission,
  arePermissionsAllowedForScope,
  assertEmployeeCan,
  assertPermissionsAllowedForScope,
  assertPermissionScopeAllowed,
  getPermissionDefinition,
  hasPermission,
  isEmployeeRole,
  isPermission,
  isPermissionScope,
  isPermissionScopeAllowed,
  isPermissionScopeType,
  normalizePermissionScope,
  permissionCatalog,
  permissionScopeRequiresReference,
  permissionScopeTypes,
  permissionsForRoles
} from "./permissions";
export type {
  Employee,
  EmployeeRole,
  Permission,
  PermissionDefinition,
  PermissionDomain,
  PermissionScope,
  PermissionScopeType
} from "./permissions";
export { createRbacEvent, rbacEventTypes } from "./rbac-events";
export type {
  CreateRbacEventInput,
  RbacEvent,
  RbacEventPayload,
  RbacEventType
} from "./rbac-events";
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
export { prepareCustomTenantRole } from "./tenant-roles";
export type {
  PreparedCustomTenantRole,
  PrepareCustomTenantRoleInput
} from "./tenant-roles";
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
