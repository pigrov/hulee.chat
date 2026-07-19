/**
 * Server-only Inbox V2 attachment-materialization composition surface.
 *
 * This subpath exists so the production worker can assemble the durable
 * claim/reservation/orphan pipeline without exposing lease tokens, source
 * handles, storage keys or raw repository mutation methods from `@hulee/db`.
 * Keep every export explicit: SQL builders and test seams do not belong here.
 */
export {
  INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_RESULT_CODE,
  createSqlInboxV2AttachmentMaterializationTerminalCommandService
} from "../repositories/sql-inbox-v2-attachment-materialization-command-service";
export type {
  InboxV2AttachmentMaterializationTerminalCommandResult,
  InboxV2AttachmentMaterializationTerminalCommandService
} from "../repositories/sql-inbox-v2-attachment-materialization-command-service";
export { createSqlInboxV2FileObjectRepository } from "../repositories/sql-inbox-v2-file-object-repository";
export type {
  InboxV2AttachmentMaterializationClaim,
  InboxV2FileObjectRepository,
  ReserveInboxV2AttachmentMaterializationInput,
  ReserveInboxV2AttachmentMaterializationResult
} from "../repositories/sql-inbox-v2-file-object-repository";
export {
  createSqlInboxV2SourceAttachmentMaterializationRepository,
  isSqlInboxV2SourceAttachmentMaterializationRepository
} from "../repositories/sql-inbox-v2-source-attachment-materialization-repository";
export type {
  InboxV2SourceAttachmentMaterializationAnchor,
  InboxV2SourceAttachmentMaterializationOrigin,
  InboxV2SourceAttachmentMaterializationPlan,
  InboxV2SourceAttachmentMaterializationRepository,
  InboxV2SourceAttachmentNamespaceRetirementDrainObservation
} from "../repositories/sql-inbox-v2-source-attachment-materialization-repository";
export {
  createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer,
  createSqlInboxV2SourceAttachmentReservationCommandPort,
  isSqlInboxV2SourceAttachmentReservationCommandPort,
  isSqlInboxV2SourceAttachmentReservationCommandPortForRepository
} from "../repositories/sql-inbox-v2-source-attachment-reservation-command";
export type {
  InboxV2SourceAttachmentReservationAuthorizationPreparer,
  InboxV2SqlSourceAttachmentReservationCommandPort
} from "../repositories/sql-inbox-v2-source-attachment-reservation-command";
