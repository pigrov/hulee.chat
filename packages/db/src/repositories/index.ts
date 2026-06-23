export {
  closeHuleeDatabase,
  createHuleeDatabase,
  createHuleePgPool
} from "../client";
export type { HuleeDatabase, HuleeDatabaseConfig } from "../client";
export { createDrizzlePersistenceExecutor } from "./drizzle-persistence-executor";
export {
  buildClaimPendingOutboxSql,
  buildMarkOutboxFailedSql,
  buildMarkOutboxProcessedSql,
  createSqlOutboxRepository
} from "./sql-outbox-repository";
export {
  buildFindEnabledTenantModuleConfigByConfigStringSql,
  buildFindEnabledTenantModuleConfigSql,
  buildFindTenantModuleConfigSql,
  buildListEnabledTenantModuleConfigsSql,
  buildUpsertTenantModuleConfigSql,
  createSqlTenantModuleConfigRepository
} from "./sql-module-config-repository";
export {
  buildFindTenantSecretSql,
  buildUpsertTenantSecretSql,
  createAesGcmTenantSecretCipher,
  createSqlTenantSecretRepository,
  createTenantSecretRef,
  parseTenantSecretRef
} from "./sql-tenant-secret-repository";
export {
  buildAddTenantRolePermissionSql,
  buildCreateDirectPermissionGrantSql,
  buildCreateTenantRoleBindingSql,
  buildCreateTenantRoleSql,
  buildListActorDirectPermissionGrantsSql,
  buildListActorRoleBindingsSql,
  buildListTenantRoleDefinitionsSql,
  buildRevokeDirectPermissionGrantSql,
  buildRevokeTenantRoleBindingSql,
  createSqlTenantRbacRepository
} from "./sql-rbac-repository";
export {
  buildFindQueuedOutboundMessageSql,
  buildMarkOutboundMessageFailedSql,
  buildMarkOutboundMessageSentSql,
  createSqlOutboundDispatchRepository
} from "./sql-outbound-dispatch-repository";
export {
  buildFindClientByExternalHandleSql,
  buildFindConversationByIdSql,
  buildFindDeliveryStatusSql,
  buildFindMessageByIdempotencyKeySql,
  buildFindOpenConversationByClientSql,
  createExternalMessageRepository
} from "./external-message-repository";
export {
  buildAuthenticateTenantApiKeySql,
  buildInsertPublicApiAuditLogSql,
  buildInsertTenantApiKeySql,
  createSqlPublicApiAuditSink,
  createSqlTenantApiKeyRepository,
  hashTenantApiKey
} from "./sql-public-api-access";
export {
  buildInsertPlatformAuditLogSql,
  createSqlPlatformAuditRepository
} from "./sql-platform-audit-repository";
export {
  buildInsertSecurityAuditLogSql,
  createSqlSecurityAuditRepository
} from "./sql-security-audit-repository";
export {
  buildCompleteEmailVerificationSql,
  buildCompletePasswordResetSql,
  buildCreateAuthEmailTokenSql,
  buildFindAuthEmailTokenTargetByAccountSql,
  buildFindAuthEmailTokenTargetByEmailSql,
  buildFindValidAuthEmailTokenSql,
  buildListAuthEmailTokenTargetsByEmailSql,
  createSqlAuthEmailTokenRepository,
  hashAuthEmailToken
} from "./sql-auth-email-token-repository";
export {
  buildConsumeAuthRateLimitBucketSql,
  buildDeleteExpiredAuthRateLimitBucketsSql,
  createSqlAuthRateLimitRepository
} from "./sql-auth-rate-limit-repository";
export {
  buildFindAuthSessionByTokenSql,
  buildFindPlatformAdminByEmailSql,
  buildFindTenantAccountByEmailSql,
  buildInsertAuthSessionSql,
  buildListTenantAccountsByEmailSql,
  buildRevokeAuthSessionSql,
  buildUpsertTenantAdminAccountSql,
  buildUpsertPlatformAdminAccountSql,
  createSqlLocalAuthRepository,
  hashAuthSessionToken
} from "./sql-auth-repository";
export {
  buildChangeEmployeeRoleSql,
  buildDeactivateEmployeeSql,
  buildAcceptEmployeeInvitationSql,
  buildCreateEmployeeInvitationSql,
  buildFindInvitationByIdSql,
  buildFindInvitationByTokenHashSql,
  buildFindTenantEmployeeSql,
  buildRefreshEmployeeInvitationSql,
  buildRevokeEmployeeInvitationSql,
  buildListTenantEmployeesSql,
  buildListTenantInvitationsSql,
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken
} from "./sql-employee-directory-repository";
export { createTenantWorkspaceRepository } from "./drizzle-tenant-workspace-repository";
export {
  assertTenantScopedRows,
  collectTenantBoundaryViolations
} from "./tenant-scope";
export type {
  InsertConflictPolicy,
  InsertRowsOptions,
  PersistenceExecutor,
  PersistenceOperation,
  PersistenceTable
} from "./persistence-executor";
export { tableRef } from "./persistence-executor";
export type {
  ExternalMessageRepository,
  FindClientByExternalHandleInput,
  FindConversationByIdInput,
  FindDeliveryStatusInput,
  FindMessageByIdempotencyKeyInput,
  FindOpenConversationByClientInput,
  PersistedMessageSummary
} from "./external-message-repository";
export type {
  ExternalMessageIngestionPersistenceRows,
  ExternalOutboundMessagePersistenceRows,
  RegisterExternalClientPersistenceRows
} from "./external-message-mapper";
export {
  collectExternalMessageIngestionTenantScopedRows,
  collectExternalOutboundMessageTenantScopedRows,
  collectRegisterExternalClientTenantScopedRows,
  mapExternalMessageIngestionToPersistenceRows,
  mapExternalOutboundMessageToPersistenceRows,
  mapRegisterExternalClientToPersistenceRows
} from "./external-message-mapper";
export type {
  ClaimPendingOutboxInput,
  MarkOutboxFailedInput,
  MarkOutboxProcessedInput,
  OutboxRecord,
  OutboxRepository,
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
export type {
  FindEnabledTenantModuleConfigByConfigStringInput,
  FindEnabledTenantModuleConfigInput,
  FindTenantModuleConfigInput,
  ListEnabledTenantModuleConfigsInput,
  TenantModuleConfigRecord,
  TenantModuleConfigRepository,
  UpsertTenantModuleConfigInput
} from "./sql-module-config-repository";
export type {
  FindTenantSecretInput,
  TenantSecretCipher,
  TenantSecretPurpose,
  TenantSecretRecord,
  TenantSecretRepository,
  UpsertTenantSecretInput
} from "./sql-tenant-secret-repository";
export type {
  AddTenantRolePermissionInput,
  CreateDirectPermissionGrantInput,
  CreateTenantRoleBindingInput,
  CreateTenantRoleInput,
  EffectiveAccessSources,
  ListActorDirectPermissionGrantsInput,
  ListActorRoleBindingsInput,
  ListEffectiveAccessSourcesInput,
  ListTenantRoleDefinitionsInput,
  RevokeDirectPermissionGrantInput,
  RevokeTenantRoleBindingInput,
  TenantRbacRepository,
  TenantRoleRecord,
  TenantRoleStatus
} from "./sql-rbac-repository";
export type {
  FindQueuedOutboundMessageInput,
  MarkOutboundMessageFailedInput,
  MarkOutboundMessageSentInput,
  OutboundDispatchRepository,
  QueuedOutboundMessageForDispatch
} from "./sql-outbound-dispatch-repository";
export type {
  AuthenticatedTenantApiKey,
  CreateTenantApiKeyInput,
  PublicApiAuditLogRecord,
  PublicApiAuditSink,
  TenantApiKeyAuthenticator,
  TenantApiKeyWriter
} from "./sql-public-api-access";
export type {
  PlatformAuditAction,
  PlatformAuditRecord,
  PlatformAuditRepository
} from "./sql-platform-audit-repository";
export type {
  SecurityAuditAction,
  SecurityAuditRecord,
  SecurityAuditRepository
} from "./sql-security-audit-repository";
export type {
  AuthEmailTokenPreview,
  AuthEmailTokenRepository,
  AuthEmailTokenTarget,
  CompleteEmailVerificationPersistenceInput,
  CompletePasswordResetPersistenceInput,
  CreateAuthEmailTokenPersistenceInput,
  FindAuthEmailTokenTargetByAccountInput,
  FindAuthEmailTokenTargetByEmailInput,
  FindValidAuthEmailTokenInput,
  ListAuthEmailTokenTargetsByEmailInput
} from "./sql-auth-email-token-repository";
export type {
  AuthRateLimitBucketDecision,
  AuthRateLimitBucketInput,
  AuthRateLimitRepository,
  DeleteExpiredAuthRateLimitBucketsInput,
  DeleteExpiredAuthRateLimitBucketsResult
} from "./sql-auth-rate-limit-repository";
export type {
  AuthSessionPrincipal,
  CreateAuthSessionInput,
  LocalAuthRepository,
  PlatformAdminAuthAccount,
  TenantAuthAccount,
  UpsertTenantAdminAccountInput,
  UpsertPlatformAdminAccountInput
} from "./sql-auth-repository";
export type {
  AcceptEmployeeInvitationPersistenceInput,
  ChangeEmployeeRolePersistenceInput,
  CreateEmployeeInvitationPersistenceInput,
  DeactivateEmployeePersistenceInput,
  EmployeeDirectoryRepository,
  EmployeeInvitationPreview,
  FindTenantEmployeeInput,
  FindTenantInvitationInput,
  ListTenantEmployeesInput,
  ListTenantInvitationsInput,
  RefreshEmployeeInvitationPersistenceInput,
  RevokeEmployeeInvitationPersistenceInput,
  TenantEmployeeRecord
} from "./sql-employee-directory-repository";
export type { TenantScopedRow } from "./tenant-scope";
export {
  collectReplyTenantScopedRows,
  collectTenantRegistrationTenantScopedRows,
  collectWorkspaceTenantScopedRows,
  mapReplyToPersistenceRows,
  mapTenantRegistrationToPersistenceRows,
  mapWorkspaceToPersistenceRows
} from "./vertical-slice-mapper";
export type {
  ReplyPersistenceRows,
  TenantRegistrationPersistenceRows,
  WorkspacePersistenceRows
} from "./vertical-slice-mapper";
