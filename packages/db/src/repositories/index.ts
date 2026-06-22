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
  buildFindEnabledTenantModuleConfigSql,
  buildFindTenantModuleConfigSql,
  buildUpsertTenantModuleConfigSql,
  createSqlTenantModuleConfigRepository
} from "./sql-module-config-repository";
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
  FindEnabledTenantModuleConfigInput,
  FindTenantModuleConfigInput,
  TenantModuleConfigRecord,
  TenantModuleConfigRepository,
  UpsertTenantModuleConfigInput
} from "./sql-module-config-repository";
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
export type { TenantScopedRow } from "./tenant-scope";
export {
  collectReplyTenantScopedRows,
  collectWorkspaceTenantScopedRows,
  mapReplyToPersistenceRows,
  mapWorkspaceToPersistenceRows
} from "./vertical-slice-mapper";
export type {
  ReplyPersistenceRows,
  WorkspacePersistenceRows
} from "./vertical-slice-mapper";
