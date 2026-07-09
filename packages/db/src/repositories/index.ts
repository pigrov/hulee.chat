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
  buildAppendTenantEventsSql,
  createSqlDomainEventRepository
} from "./sql-domain-event-repository";
export type {
  AppendTenantEventsInput,
  DomainEventRepository
} from "./sql-domain-event-repository";
export {
  buildFindActiveChannelConnectorByConfigStringSql,
  buildFindActiveChannelConnectorByExternalIdSql,
  buildFindChannelConnectorSql,
  buildFindFirstChannelConnectorByTypeSql,
  buildListActiveChannelConnectorsByTypeSql,
  buildListTenantChannelConnectorsSql,
  buildUpsertChannelConnectorSql,
  createSqlChannelConnectorRepository
} from "./sql-channel-connector-repository";
export {
  buildFindChannelAuthChallengeSql,
  buildFindLatestActiveChannelAuthChallengeSql,
  buildListActiveChannelAuthChallengesSql,
  buildUpsertChannelAuthChallengeSql,
  createSqlChannelAuthChallengeRepository
} from "./sql-channel-auth-challenge-repository";
export {
  buildAppendChannelSessionEventSql,
  buildClaimChannelSessionLeaseSql,
  buildFindChannelSessionSql,
  buildFindConnectorChannelSessionSql,
  buildListChannelSessionEventsSql,
  buildListRunnableChannelSessionsSql,
  buildReleaseChannelSessionLeaseSql,
  buildUpsertChannelSessionSql,
  createSqlChannelSessionRepository
} from "./sql-channel-session-repository";
export {
  buildFindChannelProviderValidationJobSql,
  buildUpsertChannelProviderValidationJobSql,
  createSqlChannelProviderValidationJobRepository
} from "./sql-channel-provider-validation-job-repository";
export {
  buildFindSourceConnectionSql,
  buildListTenantSourceConnectionsSql,
  buildRecordNormalizedInboundEventSql,
  buildRecordRawInboundEventSql,
  buildUpsertSourceAccountSql,
  buildUpsertSourceConnectionSql,
  createSqlSourceIntegrationRepository
} from "./sql-source-integration-repository";
export {
  buildFindEnabledTenantModuleConfigByConfigStringSql,
  buildFindEnabledTenantModuleConfigSql,
  buildFindTenantModuleConfigSql,
  buildListEnabledTenantModuleConfigsSql,
  buildUpsertTenantModuleConfigSql,
  createSqlTenantModuleConfigRepository
} from "./sql-module-config-repository";
export {
  buildListDeploymentEgressStatusSnapshotsSql,
  buildUpsertDeploymentEgressStatusSnapshotSql,
  createSqlDeploymentEgressStatusRepository
} from "./sql-deployment-egress-status-repository";
export {
  buildFindDeploymentEgressProviderPolicySql,
  buildListDeploymentEgressProviderPoliciesSql,
  buildUpsertDeploymentEgressProviderPolicySql,
  createSqlDeploymentEgressProviderPolicyRepository
} from "./sql-deployment-egress-provider-policy-repository";
export {
  buildFindDeploymentChannelProviderPolicySql,
  buildListDeploymentChannelProviderPoliciesSql,
  buildUpsertDeploymentChannelProviderPolicySql,
  createSqlDeploymentChannelProviderPolicyRepository
} from "./sql-deployment-channel-provider-policy-repository";
export {
  buildFindDeploymentChannelCatalogOverrideSql,
  buildListDeploymentChannelCatalogOverridesSql,
  buildUpsertDeploymentChannelCatalogOverrideSql,
  createSqlDeploymentChannelCatalogOverrideRepository
} from "./sql-deployment-channel-catalog-override-repository";
export {
  buildListOrgUnitsSql,
  buildListWorkQueuesSql,
  buildSetEmployeeOrgUnitMembershipsSql,
  buildSetEmployeeWorkQueueMembershipsSql,
  buildUpsertOrgUnitSql,
  buildUpsertWorkQueueSql,
  createSqlOrgStructureRepository,
  orgStructureStatuses,
  orgUnitKinds,
  workQueueKinds
} from "./sql-org-structure-repository";
export {
  buildFindTenantSecretSql,
  buildUpsertTenantSecretSql,
  createAesGcmTenantSecretCipher,
  createChannelConnectorSecretRef,
  createSqlTenantSecretRepository,
  createTenantSecretRef,
  parseTenantSecretRef
} from "./sql-tenant-secret-repository";
export {
  buildAddTenantRolePermissionSql,
  buildCreateDirectPermissionGrantSql,
  buildCreateTenantRoleBindingSql,
  buildCreateTenantRoleSql,
  buildCreateTenantRoleWithPermissionsSql,
  buildListActorDirectPermissionGrantsSql,
  buildListActorRoleBindingsSql,
  buildListTenantDirectPermissionGrantsSql,
  buildListTenantRoleDefinitionsSql,
  buildListTenantRoleBindingsSql,
  buildRevokeDirectPermissionGrantSql,
  buildRevokeTenantRoleBindingSql,
  buildSetCustomTenantRoleStatusSql,
  buildUpdateCustomTenantRoleWithPermissionsSql,
  createSqlTenantRbacRepository
} from "./sql-rbac-repository";
export {
  buildFindQueuedOutboundMessageSql,
  buildMarkOutboundMessageFailedSql,
  buildMarkOutboundMessageSentSql,
  createSqlOutboundDispatchRepository
} from "./sql-outbound-dispatch-repository";
export {
  buildListPendingTelegramAttachmentTransfersSql,
  buildMarkAttachmentTransferFailedSql,
  buildMarkAttachmentTransferStoredSql,
  createSqlAttachmentTransferRepository
} from "./sql-attachment-transfer-repository";
export {
  buildFindFileContentAccessSql,
  createSqlFileAccessRepository
} from "./sql-file-access-repository";
export {
  buildFindClientByExternalHandleSql,
  buildFindConversationByIdSql,
  buildFindDeliveryStatusSql,
  buildFindMessageByIdempotencyKeySql,
  buildFindOpenConversationByClientSql,
  buildUpdateConversationRoutingSql,
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
  buildListAccessAuditRecordsSql,
  buildInsertSecurityAuditLogSql,
  accessAuditActions,
  createSqlSecurityAuditRepository
} from "./sql-security-audit-repository";
export {
  buildCompleteEmailChangeSql,
  buildCompleteEmailVerificationSql,
  buildCompletePasswordResetSql,
  buildCreateAuthEmailTokenSql,
  buildFindAuthEmailAccountOwnerSql,
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
  buildDeactivateEmployeeSql,
  buildAcceptEmployeeInvitationSql,
  buildCreateEmployeeInvitationSql,
  buildFindInvitationByIdSql,
  buildFindInvitationByTokenHashSql,
  buildFindTenantEmployeeSql,
  buildRefreshEmployeeInvitationSql,
  buildRevokeEmployeeInvitationSql,
  buildUpdateEmployeeProfileSql,
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
  PersistedMessageSummary,
  UpdateConversationRoutingInput
} from "./external-message-repository";
export type {
  AttachmentTransferRepository,
  ListPendingTelegramAttachmentTransfersInput,
  MarkAttachmentTransferFailedInput,
  MarkAttachmentTransferStoredInput,
  PendingTelegramAttachmentTransfer
} from "./sql-attachment-transfer-repository";
export type {
  FileAccessRepository,
  FileContentAccessRecord,
  FindFileContentAccessInput
} from "./sql-file-access-repository";
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
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelConnectorInput,
  FindFirstChannelConnectorByTypeInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantChannelConnectorsInput,
  UpsertChannelConnectorInput
} from "./sql-channel-connector-repository";
export type {
  ChannelAuthChallengeRecord,
  ChannelAuthChallengeRepository,
  FindChannelAuthChallengeInput,
  FindLatestActiveChannelAuthChallengeInput,
  ListActiveChannelAuthChallengesInput,
  UpsertChannelAuthChallengeInput
} from "./sql-channel-auth-challenge-repository";
export type {
  AppendChannelSessionEventInput,
  ChannelSessionEventRecord,
  ChannelSessionEventSeverity,
  ChannelSessionRecord,
  ChannelSessionRepository,
  ChannelSessionStatus,
  ClaimChannelSessionLeaseInput,
  FindChannelSessionInput,
  FindConnectorChannelSessionInput,
  ListChannelSessionEventsInput,
  ListRunnableChannelSessionsInput,
  ReleaseChannelSessionLeaseInput,
  UpsertChannelSessionInput
} from "./sql-channel-session-repository";
export type {
  ChannelProviderValidationJobRecord,
  ChannelProviderValidationJobRepository,
  ChannelProviderValidationJobStatus,
  FindChannelProviderValidationJobInput,
  UpsertChannelProviderValidationJobInput
} from "./sql-channel-provider-validation-job-repository";
export type {
  FindSourceConnectionInput,
  ListTenantSourceConnectionsInput,
  NormalizedInboundEventRecord,
  RawInboundEventRecord,
  RecordNormalizedInboundEventInput,
  RecordRawInboundEventInput,
  SourceAccountRecord,
  SourceConnectionRecord,
  SourceIntegrationRepository,
  UpsertSourceAccountInput,
  UpsertSourceConnectionInput
} from "./sql-source-integration-repository";
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
  DeploymentEgressAlert,
  DeploymentEgressProbeResult,
  DeploymentEgressStatusRepository,
  DeploymentEgressStatusSnapshot,
  ListDeploymentEgressStatusSnapshotsInput,
  UpsertDeploymentEgressStatusSnapshotInput
} from "./sql-deployment-egress-status-repository";
export type {
  DeploymentEgressProviderPolicyRecord,
  DeploymentEgressProviderPolicyRepository,
  UpsertDeploymentEgressProviderPolicyInput
} from "./sql-deployment-egress-provider-policy-repository";
export type {
  DeploymentChannelProviderPolicyRecord,
  DeploymentChannelProviderPolicyRepository,
  UpsertDeploymentChannelProviderPolicyInput
} from "./sql-deployment-channel-provider-policy-repository";
export type {
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  LocalizedTextOverrides,
  UpsertDeploymentChannelCatalogOverrideInput
} from "./sql-deployment-channel-catalog-override-repository";
export type {
  ListOrgUnitsInput,
  ListTeamsInput,
  ListWorkQueuesInput,
  OrgStructureRepository,
  OrgStructureStatus,
  OrgUnitKind,
  OrgUnitRecord,
  SetEmployeeOrgUnitMembershipsInput,
  SetEmployeeTeamMembershipsInput,
  SetEmployeeWorkQueueMembershipsInput,
  TeamRecord,
  UpsertOrgUnitInput,
  UpsertTeamInput,
  UpsertWorkQueueInput,
  WorkQueueKind,
  WorkQueueRecord
} from "./sql-org-structure-repository";
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
  CreateTenantRoleWithPermissionsInput,
  EffectiveAccessSources,
  ListActorDirectPermissionGrantsInput,
  ListActorRoleBindingsInput,
  ListExpiredTenantDirectPermissionGrantsInput,
  ListExpiredTenantRoleBindingsInput,
  ListEffectiveAccessSourcesInput,
  ListTenantDirectPermissionGrantsInput,
  ListTenantRoleDefinitionsInput,
  ListTenantRoleBindingsInput,
  RevokeDirectPermissionGrantInput,
  RevokeTenantRoleBindingInput,
  SetCustomTenantRoleStatusInput,
  TenantRbacRepository,
  TenantRoleRecord,
  TenantRoleStatus,
  UpdateCustomTenantRoleWithPermissionsInput
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
  AccessAuditAction,
  AccessAuditEntityType,
  AccessAuditRecord,
  AuthSecurityAuditAction,
  ConversationAuditAction,
  ConversationRoutingAuditRecord,
  OrgStructureAuditAction,
  ListAccessAuditRecordsInput,
  ListConversationRoutingAuditRecordsInput,
  SecurityAuditAction,
  SecurityAuditEntityType,
  SecurityAuditRecord,
  SecurityAuditRepository
} from "./sql-security-audit-repository";
export type {
  AuthEmailTokenPreview,
  AuthEmailTokenRepository,
  AuthEmailTokenTarget,
  AuthEmailAccountOwner,
  CompleteEmailChangePersistenceInput,
  CompleteEmailVerificationPersistenceInput,
  CompletePasswordResetPersistenceInput,
  CreateAuthEmailTokenPersistenceInput,
  FindAuthEmailAccountOwnerInput,
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
  TenantEmployeeAvatarAsset,
  TenantEmployeeProfile,
  TenantEmployeeRecord,
  UpdateEmployeeProfilePersistenceInput
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
