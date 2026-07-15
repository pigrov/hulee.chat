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
  createInboxV2ModulePermissionCatalogRegistrationSchema,
  evaluateInboxV2PermissionScopePairLegality,
  getInboxV2PermissionDefinition,
  INBOX_V2_PERMISSION_SCOPE_CATALOG_SCHEMA_ID,
  INBOX_V2_PERMISSION_SCOPE_CATALOG_VERSION,
  inboxV1PermissionMappingCatalogRegistration,
  inboxV1PermissionMappingCatalogRegistrationSchema,
  inboxV1ToV2PermissionMappings,
  inboxV2PermissionCatalog,
  inboxV2PermissionCatalogRegistration,
  inboxV2PermissionCatalogRegistrationSchema,
  inboxV2PermissionGuardProfileIds,
  inboxV2PermissionGuardProfileCatalogRegistration,
  inboxV2PermissionGuardProfileCatalogRegistrationSchema,
  inboxV2PermissionGuardProfiles,
  inboxV2PermissionScopeCatalog,
  inboxV2PermissionScopeCatalogSchema,
  inboxV2PermissionScopeTypes,
  inboxV2ScopeCatalog,
  inboxV2ScopeCatalogRegistration,
  inboxV2ScopeCatalogRegistrationSchema,
  isInboxV2PermissionScopePairLegal,
  isInboxV2PermissionId,
  isInboxV2PermissionScope,
  migrateInboxV1PermissionScopeToV2,
  parseInboxV2PermissionScope
} from "./inbox-v2-permission-catalog";
export type {
  InboxV1PermissionMappingDefinition,
  InboxV1PermissionMappingDisposition,
  InboxV1PermissionScopeMigrationResult,
  InboxV2OrgUnitScopeMode,
  InboxV2PermissionCatalogEntry,
  InboxV2PermissionDefinition,
  InboxV2PermissionGuardProfileId,
  InboxV2PermissionId,
  InboxV2PermissionPrincipalKind,
  InboxV2PermissionScope,
  InboxV2PermissionScopeDefinition,
  InboxV2PermissionScopePairLegality,
  InboxV2PermissionScopeType
} from "./inbox-v2-permission-catalog";
export {
  deriveInboxV2Capabilities,
  evaluateInboxV2AuthorizationPlan,
  toInboxV2PublicAuthorizationDecision
} from "./inbox-v2-authorization-policy";
export type {
  InboxV2AuthorizationDecision,
  InboxV2AuthorizationInternalReason,
  InboxV2AuthorizationPlanInput,
  InboxV2AuthorizationPublicErrorCode,
  InboxV2AuthorizationRequirement,
  InboxV2CanonicalScopeFact,
  InboxV2CurrentAuthorizationFacts,
  InboxV2DerivedCapability,
  InboxV2PolicyGrant,
  InboxV2PolicyGuardEvidence,
  InboxV2PolicyPrincipal,
  InboxV2PolicyRevisionCheck,
  InboxV2PolicyTimestamp,
  InboxV2PublicAuthorizationDecision,
  InboxV2RequirementDecision
} from "./inbox-v2-authorization-policy";
export {
  planInboxV2DirectGrantRevision,
  planInboxV2RoleBindingRevision,
  planInboxV2RoleDefinitionRevision
} from "./inbox-v2-authorization-revision-plan";
export type {
  InboxV2AuthorizationRevisionPlan,
  InboxV2GrantRevisionPlanDecision,
  InboxV2RoleBindingLegalityFact,
  InboxV2RoleLegalityConflict,
  InboxV2RoleRevisionPlanDecision
} from "./inbox-v2-authorization-revision-plan";
export {
  createInboxV2DeploymentSecurityTenantScope,
  createInboxV2SecurityDenialFingerprintProof,
  createInboxV2VerifiedSecurityTenantScope,
  executeInboxV2AuthorizationGate
} from "./inbox-v2-security-denial";
export type {
  InboxV2AuthorizationGateResult,
  InboxV2SecurityDenialContext,
  InboxV2SecurityDenialFingerprintProof,
  InboxV2SecurityDenialHealthSignal,
  InboxV2SecurityDenialObservation,
  InboxV2SecurityDenialRecordOptions,
  InboxV2SecurityDenialSink,
  InboxV2SecurityDenialTenantScope
} from "./inbox-v2-security-denial";
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
  FileRecord,
  FileStatus,
  IngestExternalIncomingMessageInput,
  IngestExternalIncomingMessageResult,
  Message,
  MessageAttachment,
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
