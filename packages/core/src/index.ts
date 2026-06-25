export { assertTenantBoundary, createDomainEvent } from "./domain-events";
export type { TenantScope } from "./domain-events";
export {
  assertCanAccess,
  can,
  canAccess,
  resolveEffectivePermissionGrants
} from "./access-control";
export {
  buildEffectiveAccessCacheKey,
  createEffectiveAccessCache
} from "./authorization-cache";
export {
  defaultBreakGlassDurationMs,
  maxBreakGlassDurationMs,
  prepareBreakGlassDirectGrant
} from "./break-glass-access";
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
export type {
  EffectiveAccessCache,
  EffectiveAccessCacheInvalidationInput,
  EffectiveAccessCacheKeyInput,
  EffectiveAccessCacheOptions,
  EffectiveAccessCacheVersion
} from "./authorization-cache";
export type {
  PreparedBreakGlassDirectGrant,
  PrepareBreakGlassDirectGrantInput
} from "./break-glass-access";
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
  createEmployeeInvitation,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation
} from "./employee-invitations";
export type {
  AcceptedEmployeeInvitation,
  AcceptEmployeeInvitationInput,
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
  isPermission,
  isPermissionScope,
  isPermissionScopeAllowed,
  isPermissionScopeType,
  isSystemRoleTemplateId,
  normalizePermissionScope,
  permissionCatalog,
  permissionScopeRequiresReference,
  permissionScopeTypes,
  permissionsForSystemRoleTemplates
} from "./permissions";
export type {
  Employee,
  Permission,
  PermissionDefinition,
  PermissionDomain,
  PermissionScope,
  PermissionScopeType,
  SystemRoleTemplateId
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
