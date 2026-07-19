import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";

import {
  assertDrizzleSnapshotParity,
  assertMigrationJournalArtifactParity,
  assertParentUniqueConstraintsBeforeForeignKeys,
  assertSqlStatementParity,
  collectFinalizedMigrationDdlStatements,
  generateExpectedDrizzleMigration,
  splitMigrationStatements
} from "./db-check-lib.mjs";

const metadata = await readFile("packages/db/src/schema/metadata.ts", "utf8");
const migrationDirectory = "packages/db/drizzle";
const migrationMetadataDirectory = `${migrationDirectory}/meta`;
const inboxV2SchemaDirectory = "packages/db/src/schema/inbox-v2";
const migrationFileNames = (await readdir(migrationDirectory))
  .filter((fileName) => fileName.endsWith(".sql"))
  .sort();
const migrationFiles = await Promise.all(
  migrationFileNames.map(async (fileName) => ({
    fileName,
    sql: await readFile(`${migrationDirectory}/${fileName}`, "utf8")
  }))
);
const migrationMetadataFileNames = (
  await readdir(migrationMetadataDirectory)
).sort();
const drizzleJournal = JSON.parse(
  await readFile(`${migrationMetadataDirectory}/_journal.json`, "utf8")
);
const inboxV2FileObjectPredecessorSnapshot = JSON.parse(
  await readFile(`${migrationMetadataDirectory}/0052_snapshot.json`, "utf8")
);
const inboxV2FileObjectSnapshot = JSON.parse(
  await readFile(`${migrationMetadataDirectory}/0053_snapshot.json`, "utf8")
);
const migrationSql = migrationFiles.map(({ sql }) => sql).join("\n");
const inboxV2FoundationMarker = "-- INBOX_V2_FOUNDATION_MIGRATION_FINALIZED_V1";
const inboxV2FoundationPreflightMarker = "-- INBOX_V2_FOUNDATION_PREFLIGHT_V1";
const inboxV2WorkItemMarker = "-- INBOX_V2_WORK_ITEM_MIGRATION_FINALIZED_V1";
const inboxV2WorkItemPreflightMarker = "-- INBOX_V2_WORK_ITEM_PREFLIGHT_V1";
const inboxV2WorkItemInvariantName = "INBOX_V2_WORK_ITEM_INVARIANTS_SQL";
const inboxV2TimelineMessageMarker =
  "-- INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1";
const inboxV2TimelineMessagePreflightMarker =
  "-- INBOX_V2_TIMELINE_MESSAGE_PREFLIGHT_V1";
const inboxV2TimelineMessageInvariantNames = new Set([
  "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL",
  "INBOX_V2_PROVIDER_SEMANTIC_ORDERING_INVARIANTS_SQL"
]);
const inboxV2EmployeeConversationStateMarker =
  "-- INBOX_V2_EMPLOYEE_CONVERSATION_STATE_MIGRATION_FINALIZED_V1";
const inboxV2EmployeeConversationStatePreflightMarker =
  "-- INBOX_V2_EMPLOYEE_CONVERSATION_STATE_PREFLIGHT_V1";
const inboxV2EmployeeConversationStateInvariantName =
  "INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL";
const inboxV2DataGovernancePrivacyMarker =
  "-- INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1";
const inboxV2DataGovernancePrivacyPreflightMarker =
  "-- INBOX_V2_DATA_GOVERNANCE_PRIVACY_PREFLIGHT_V1";
const inboxV2DataGovernancePrivacyInvariantNames = new Set([
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL",
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_CHECKPOINT_INVARIANTS_SQL",
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_COHERENCE_INVARIANTS_SQL",
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL",
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL",
  "INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL"
]);
const inboxV2AuthorizationRelationsMarker =
  "-- INBOX_V2_AUTHORIZATION_RELATIONS_MIGRATION_FINALIZED_V1";
const inboxV2AuthorizationRelationsPreflightMarker =
  "-- INBOX_V2_AUTHORIZATION_RELATIONS_PREFLIGHT_V1";
const inboxV2AuthorizationRelationsInvariantNames = new Set([
  "INBOX_V2_AUTHORIZATION_RELATIONS_INTEGRITY_SQL",
  "INBOX_V2_AUTHORIZATION_WORK_ITEM_BRIDGE_INTEGRITY_SQL"
]);
const inboxV2SecurityDenialMarker =
  "-- INBOX_V2_SECURITY_DENIAL_MIGRATION_FINALIZED_V1";
const inboxV2SecurityDenialPreflightMarker =
  "-- INBOX_V2_SECURITY_DENIAL_PREFLIGHT_V1";
const inboxV2SecurityDenialInvariantName =
  "INBOX_V2_SECURITY_DENIAL_INTEGRITY_SQL";
const inboxV2RepositoryFoundationMarker =
  "-- INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1";
const inboxV2RepositoryFoundationPreflightMarker =
  "-- INBOX_V2_REPOSITORY_FOUNDATION_PREFLIGHT_V1";
const inboxV2RepositoryFoundationPreflightSql = (
  await readFile(
    "scripts/db/inbox-v2-repository-foundation-preflight.sql",
    "utf8"
  )
).trim();
const inboxV2RepositoryFoundationBackfillStatements = splitMigrationStatements(
  await readFile(
    "scripts/db/inbox-v2-repository-foundation-backfills.sql",
    "utf8"
  )
);
const inboxV2RepositoryFoundationInvariantName =
  "INBOX_V2_REPOSITORY_FOUNDATION_INTEGRITY_SQL";
const inboxV2RepositoryFoundationOrderedTailSha256 =
  "sha256:74bb3479a7ea6d60efaca686dbe732cc9c261bfc7b9668002e49e494375e92d7";
const inboxV2DatabaseResetReceiptInvariantName =
  "INBOX_V2_DATABASE_RESET_RECEIPT_INVARIANT_SQL";
const inboxV2DatabaseResetReceiptFileName =
  "0037_inbox_v2_database_reset_receipt.sql";
const inboxV2ConversationTimelineHeadMarker =
  "-- INBOX_V2_CONVERSATION_TIMELINE_HEAD_MIGRATION_FINALIZED_V1";
const inboxV2ConversationTimelineHeadPreflightMarker =
  "-- INBOX_V2_CONVERSATION_TIMELINE_HEAD_PREFLIGHT_V1";
const inboxV2ConversationTimelineHeadInvariantName =
  "INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL";
const inboxV2ConversationIdentityFenceTableName =
  "public.inbox_v2_conversation_identity_fences";
const inboxV2EligibleActivityTailIndexName =
  "inbox_v2_timeline_items_eligible_activity_tail_idx";
const inboxV2ConversationTimelineHeadPreflightSql = (
  await readFile(
    "scripts/db/inbox-v2-conversation-timeline-head-preflight.sql",
    "utf8"
  )
).trim();
const inboxV2SourceRegistryMarker =
  "-- INBOX_V2_SOURCE_REGISTRY_MIGRATION_FINALIZED_V1";
const inboxV2SourceRegistryPreflightMarker =
  "-- INBOX_V2_SOURCE_REGISTRY_PREFLIGHT_V1";
const inboxV2SourceRegistryInvariantName =
  "INBOX_V2_SOURCE_REGISTRY_INTEGRITY_SQL";
const inboxV2SourceRegistryPreflightSql = (
  await readFile("scripts/db/inbox-v2-source-registry-preflight.sql", "utf8")
).trim();
const inboxV2AuthorizedDomainCommandFileName =
  "0040_inbox_v2_authorized_domain_command.sql";
const inboxV2AuthorizedDomainCommandMarker =
  "-- INB2-SRC-011_AUTHORIZED_DOMAIN_COMMAND_V1";
const inboxV2AuthorizedDomainCommandTailDigest =
  "sha256:b78242af3fe12af296bee0407140fa6fef5fd787240f4d65861819b40acd3e6c";
const inboxV2SourceOnboardingResultFileName =
  "0041_inbox_v2_source_onboarding_result.sql";
const inboxV2SourceOnboardingResultMarker =
  "-- INB2-SRC-011_IMMUTABLE_COMMAND_RESULT_V1";
const inboxV2SourceOnboardingResultTailDigest =
  "sha256:55b75bd00ce694225a1043bf9007535d21fa2460172e7acc1e4463a165c2ddd0";
const inboxV2SourceRawIngressFileName = "0042_inbox_v2_raw_source_ingress.sql";
const inboxV2SourceRawIngressInvariantName =
  "INBOX_V2_SOURCE_RAW_INGRESS_INTEGRITY_SQL";
const inboxV2SourceRawIngressTableNames = [
  "public.inbox_v2_source_raw_envelopes",
  "public.inbox_v2_source_raw_evidence",
  "public.inbox_v2_source_raw_quarantines",
  "public.inbox_v2_source_raw_work_items"
];
const inboxV2SourceRawIngressEnumNames = [
  "public.inbox_v2_source_raw_evidence_kind",
  "public.inbox_v2_source_raw_quarantine_reason",
  "public.inbox_v2_source_raw_work_state"
];
const inboxV2SourceNormalizationFileName =
  "0043_inbox_v2_source_normalization.sql";
const inboxV2SourceNormalizationMarker =
  "-- INBOX_V2_SOURCE_NORMALIZATION_FINALIZED_V1";
const inboxV2SourceNormalizationInvariantName =
  "INBOX_V2_SOURCE_NORMALIZATION_INTEGRITY_SQL";
const inboxV2SourceNormalizationTableNames = [
  "public.inbox_v2_source_normalization_results",
  "public.inbox_v2_source_normalized_envelopes",
  "public.inbox_v2_source_normalized_evidence",
  "public.inbox_v2_source_normalized_evidence_payloads",
  "public.inbox_v2_source_normalized_quarantines"
];
const inboxV2SourceNormalizationEnumNames = [
  "public.inbox_v2_source_normalization_outcome"
];
const inboxV2SourceIdentityResolutionFileName =
  "0044_inbox_v2_source_identity_resolution.sql";
const inboxV2SourceIdentityResolutionMarker =
  "-- INBOX_V2_SOURCE_IDENTITY_RESOLUTION_FINALIZED_V1";
const inboxV2SourceIdentityResolutionInvariantName =
  "INBOX_V2_SOURCE_IDENTITY_RESOLUTION_INTEGRITY_SQL";
const inboxV2SourceIdentityResolutionTableNames = [
  "public.inbox_v2_source_identity_observations",
  "public.inbox_v2_source_identity_assessments",
  "public.inbox_v2_source_identity_assessment_heads"
];
const inboxV2SourceIdentityResolutionEnumNames = [
  "public.inbox_v2_source_identity_assessment_outcome",
  "public.inbox_v2_source_identity_assessment_confidence"
];
const inboxV2SourceMessageReconciliationFileName =
  "0045_inbox_v2_source_message_reconciliation.sql";
const inboxV2SourceMessageReconciliationMarker =
  "-- INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_FINALIZED_V1";
const inboxV2SourceMessageReconciliationInvariantName =
  "INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL";
const inboxV2SourceMessageReconciliationTableNames = [
  "public.inbox_v2_source_message_key_registry",
  "public.inbox_v2_deferred_message_source_actions",
  "public.inbox_v2_deferred_message_source_action_transitions",
  "public.inbox_v2_deferred_source_action_conflict_candidates",
  "public.inbox_v2_deferred_source_action_ordering_heads",
  "public.inbox_v2_source_message_correlation_evidence"
];
const inboxV2SourceMessageReconciliationEnumNames = [
  "public.inbox_v2_deferred_source_action_effect_kind",
  "public.inbox_v2_deferred_source_action_kind",
  "public.inbox_v2_deferred_source_action_lane",
  "public.inbox_v2_deferred_source_action_ordering_kind",
  "public.inbox_v2_deferred_source_action_ordering_outcome",
  "public.inbox_v2_deferred_source_action_state"
];
const inboxV2AtomicProviderIoFileName =
  "0046_inbox_v2_atomic_provider_io_closure.sql";
const inboxV2AtomicProviderIoInvariantName =
  "INBOX_V2_AUTH_DOMAIN_PROVIDER_IO_CLOSURE_SQL";
const inboxV2AtomicProviderIoTableNames = [
  "public.inbox_v2_atomic_outbound_dispatch_materializations",
  "public.inbox_v2_atomic_source_resolution_materializations"
];
const inboxV2OutboxTerminalPayloadFileName =
  "0047_inbox_v2_outbox_terminal_payload_boundary.sql";
const inboxV2OutboxTerminalPayloadMarker =
  "-- INB2-SRC-009_OUTBOX_TERMINAL_PAYLOAD_PURGE_BOUNDARY_V1";
const inboxV2OutboxTerminalPayloadInvariantName =
  "INBOX_V2_OUTBOX_TERMINAL_PAYLOAD_REF_INTEGRITY_SQL";
const inboxV2OutboxTerminalPayloadTableName =
  "public.inbox_v2_outbox_terminal_payload_refs";
const inboxV2SourceProcessingRuntimeFileName =
  "0048_inbox_v2_source_processing_runtime.sql";
const inboxV2MonotonicTimelineFileName = "0049_inbox_v2_monotonic_timeline.sql";
const inboxV2MonotonicTimelineMarker =
  "-- INB2-MSG-001_MONOTONIC_TIMELINE_GUARDS_V1";
const inboxV2MonotonicTimelineIndexName =
  "inbox_v2_timeline_subject_details_system_event_unique";
const inboxV2MonotonicTimelineTailSha256 =
  "sha256:942378c4f479cd901d45c09e88c68ac18c0a569c96f112c8bc27c4bbe3946c5e";
const inboxV2OutboundSendAuthorityFileName =
  "0050_inbox_v2_outbound_send_authority.sql";
const inboxV2OutboundSendAuthorityMarker =
  "-- INB2-MSG-002_NORMAL_SEND_REPLY_AUTHORITY_V1";
const inboxV2ConversationWorkHeadFileName =
  "0052_inbox_v2_conversation_work_head.sql";
const inboxV2ConversationWorkHeadMarker =
  "-- INB2-MSG-002_CONVERSATION_WORK_HEAD_V1";
const inboxV2ConversationWorkHeadInvariantName =
  "INBOX_V2_CONVERSATION_WORK_HEAD_INVARIANTS_SQL";
const inboxV2ConversationWorkHeadTableName =
  "public.inbox_v2_conversation_work_heads";
const inboxV2ConversationWorkHeadEnumName =
  "public.inbox_v2_conversation_work_outcome";
const inboxV2FileObjectFileName =
  "0053_inbox_v2_typed_content_and_attachments.sql";
const inboxV2FileObjectMarker =
  "-- INBOX_V2_FILE_OBJECT_MIGRATION_FINALIZED_V1";
const inboxV2FileObjectInvariantName = "INBOX_V2_FILE_OBJECT_INVARIANTS_SQL";
const inboxV2MessageAttachmentAnchorInvariantName =
  "INBOX_V2_MESSAGE_ATTACHMENT_ANCHOR_INVARIANTS_SQL";
const inboxV2Msg003AttachmentAuthorizationFunctionNames = [
  "public.inbox_v2_auth_attachment_message_change_valid",
  "public.inbox_v2_auth_domain_mutation_coherence"
];
const inboxV2FileObjectTableNames = [
  "inbox_v2_file_attachment_materialization_attempts",
  "inbox_v2_file_attachment_materialization_evidence",
  "inbox_v2_file_attachment_materialization_jobs",
  "inbox_v2_file_derivative_edges",
  "inbox_v2_file_object_operation_evidence",
  "inbox_v2_file_object_version_heads",
  "inbox_v2_file_object_versions",
  "inbox_v2_file_objects",
  "inbox_v2_file_outbound_artifact_blocks",
  "inbox_v2_file_outbound_artifact_plans",
  "inbox_v2_file_outbound_dispatch_plans",
  "inbox_v2_file_parent_link_heads",
  "inbox_v2_file_parent_links",
  "inbox_v2_file_parent_set_heads",
  "inbox_v2_file_storage_orphans",
  "inbox_v2_file_versions"
];
const inboxV2FileObjectEnumNames = [
  "inbox_v2_file_attachment_materialization_outcome",
  "inbox_v2_file_attachment_materialization_state",
  "inbox_v2_file_attachment_source_locator_kind",
  "inbox_v2_file_object_operation_kind",
  "inbox_v2_file_object_operation_outcome",
  "inbox_v2_file_object_state",
  "inbox_v2_file_object_version_state",
  "inbox_v2_file_object_versioning_mode",
  "inbox_v2_file_outbound_artifact_grouping",
  "inbox_v2_file_outbound_block_kind",
  "inbox_v2_file_parent_kind",
  "inbox_v2_file_parent_link_state",
  "inbox_v2_file_parent_purpose",
  "inbox_v2_file_parent_set_completeness",
  "inbox_v2_file_parent_visibility",
  "inbox_v2_file_storage_orphan_state"
];
const inboxV2FileObjectNullableBridgeColumns = [
  "attachment_v2_file_id",
  "attachment_file_version_id",
  "attachment_object_version_id",
  "extension_payload_v2_file_id",
  "extension_payload_file_version_id",
  "extension_payload_object_version_id"
];
const inboxV2FileObjectNullableRevisionBridgeColumns = [
  "attachment_file_revision",
  "extension_payload_file_revision"
];
const inboxV2FileObjectNullableAttachmentAnchorColumns = [
  ["owner_message_id", "text"],
  ["owner_timeline_item_id", "text"],
  ["owner_timeline_content_id", "text"],
  ["owner_block_key", "text"],
  ["materialization_state", '"inbox_v2_attachment_materialization_state"']
];
const inboxV2FileObjectDeferredForeignKeys = [
  "inbox_v2_timeline_content_payloads_file_version_fk",
  "inbox_v2_timeline_content_payloads_object_version_fk",
  "inbox_v2_timeline_payloads_extension_file_version_fk",
  "inbox_v2_timeline_payloads_extension_object_version_fk"
];
const inboxV2FileObjectReplacedCheckConstraint =
  "inbox_v2_timeline_content_payloads_shape_check";
const inboxV2FileObjectReplacedCauseEventForeignKey =
  "inbox_v2_action_attributions_cause_event_fk";
const inboxV2FileObjectCauseEventIndex =
  "inbox_v2_action_attributions_cause_event_idx";
const inboxV2SourceProcessingRuntimeInvariantName =
  "INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL";
const inboxV2SourceRawAdmissionInvariantName =
  "INBOX_V2_SOURCE_RAW_ADMISSION_INTEGRITY_SQL";
const inboxV2SourceProcessingRuntimeTableNames = [
  "public.inbox_v2_source_raw_admissions",
  "public.inbox_v2_source_processing_key_generations",
  "public.inbox_v2_source_delivery_dedupe_skeletons",
  "public.inbox_v2_source_processing_work_heads",
  "public.inbox_v2_source_processing_attempts",
  "public.inbox_v2_source_processing_dead_letters",
  "public.inbox_v2_source_replay_requests",
  "public.inbox_v2_source_account_pressure_heads",
  "public.inbox_v2_source_ingress_cursor_checkpoints"
];
const inboxV2SourceProcessingRuntimeEnumNames = [
  "public.inbox_v2_source_raw_admission_state",
  "public.inbox_v2_source_processing_key_state",
  "public.inbox_v2_source_delivery_outcome",
  "public.inbox_v2_source_processing_stage",
  "public.inbox_v2_source_processing_work_state",
  "public.inbox_v2_source_processing_retryability",
  "public.inbox_v2_source_processing_attempt_outcome",
  "public.inbox_v2_source_processing_attempt_origin",
  "public.inbox_v2_source_dead_letter_reason",
  "public.inbox_v2_source_dedupe_phase",
  "public.inbox_v2_source_replayability_state",
  "public.inbox_v2_source_dedupe_lifecycle_state",
  "public.inbox_v2_source_replay_mode",
  "public.inbox_v2_source_replay_state",
  "public.inbox_v2_source_replay_rejection_reason",
  "public.inbox_v2_source_replay_actor_kind",
  "public.inbox_v2_source_account_pressure_state",
  "public.inbox_v2_source_cursor_owner",
  "public.inbox_v2_source_cursor_kind",
  "public.inbox_v2_source_cursor_durable_target_kind"
];
const inboxV2SourceRegistryPrerequisiteUniqueConstraintNames = [
  "channel_auth_challenges_tenant_id_unique",
  "channel_auth_challenges_tenant_id_connector_unique",
  "channel_connectors_tenant_id_unique",
  "channel_connectors_tenant_id_connection_unique",
  "channel_provider_validation_jobs_tenant_id_unique",
  "channel_session_events_tenant_id_unique",
  "channel_session_events_tenant_exact_unique",
  "channel_sessions_tenant_id_unique",
  "channel_sessions_tenant_id_connector_unique"
];
const inboxV2SourceRegistryTableNames = [
  "public.inbox_v2_source_registry_transitions",
  "public.inbox_v2_source_registry_heads",
  "public.inbox_v2_source_registry_artifact_refs",
  "public.inbox_v2_source_registry_secret_refs",
  "public.inbox_v2_source_registry_ingress_routes",
  "public.inbox_v2_source_registry_related_authority_refs"
];
const inboxV2SourceRegistryEnumNames = [
  "public.inbox_v2_source_registry_actor_kind",
  "public.inbox_v2_source_registry_artifact_kind",
  "public.inbox_v2_source_registry_authority_kind",
  "public.inbox_v2_source_registry_copy_slot",
  "public.inbox_v2_source_registry_related_authority_kind",
  "public.inbox_v2_source_registry_related_authority_status",
  "public.inbox_v2_source_registry_route_authority_state",
  "public.inbox_v2_source_registry_state",
  "public.inbox_v2_source_registry_transition_intent"
];
const inboxV2SourceRegistryBaseConstraintNames = [
  ...inboxV2SourceRegistryPrerequisiteUniqueConstraintNames,
  "channel_auth_challenges_tenant_connector_fk",
  "channel_auth_challenges_tenant_creator_fk",
  "channel_connectors_tenant_connection_fk",
  "channel_connectors_tenant_creator_fk",
  "channel_provider_validation_jobs_tenant_secret_fk",
  "channel_provider_validation_jobs_tenant_creator_fk",
  "channel_session_events_tenant_connector_fk",
  "channel_session_events_tenant_session_connector_fk",
  "channel_sessions_tenant_connector_fk",
  "source_connections_tenant_creator_fk"
];
const inboxV2MembershipPrivilegeBoundaryName =
  "INBOX_V2_MEMBERSHIP_PRIVILEGE_BOUNDARY_SQL";
const inboxV2FoundationInvariantNames = new Set([
  "INBOX_V2_CLIENT_MERGE_INTEGRITY_SQL",
  "INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL",
  "INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL",
  "INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL",
  "INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL",
  "INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL",
  "INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL",
  "INBOX_V2_TENANT_POLICY_AUTHORITY_INTEGRITY_SQL"
]);
const inboxV2FoundationMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2FoundationMarker)
);
const inboxV2WorkItemMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2WorkItemMarker)
);
const inboxV2TimelineMessageMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2TimelineMessageMarker)
);
const inboxV2EmployeeConversationStateMigrations = migrationFiles.filter(
  ({ sql }) => sql.includes(inboxV2EmployeeConversationStateMarker)
);
const inboxV2DataGovernancePrivacyMigrations = migrationFiles.filter(
  ({ sql }) => sql.includes(inboxV2DataGovernancePrivacyMarker)
);
const inboxV2AuthorizationRelationsMigrations = migrationFiles.filter(
  ({ sql }) => sql.includes(inboxV2AuthorizationRelationsMarker)
);
const inboxV2SecurityDenialMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2SecurityDenialMarker)
);
const inboxV2RepositoryFoundationMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2RepositoryFoundationMarker)
);
const inboxV2DatabaseResetReceiptMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2DatabaseResetReceiptFileName
);
const inboxV2ConversationTimelineHeadMigrations = migrationFiles.filter(
  ({ sql }) => sql.includes(inboxV2ConversationTimelineHeadMarker)
);
const inboxV2SourceRegistryMigrations = migrationFiles.filter(({ sql }) =>
  sql.includes(inboxV2SourceRegistryMarker)
);
const inboxV2AuthorizedDomainCommandMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2AuthorizedDomainCommandFileName
);
const inboxV2SourceOnboardingResultMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceOnboardingResultFileName
);
const inboxV2SourceRawIngressMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceRawIngressFileName
);
const inboxV2SourceNormalizationMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceNormalizationFileName
);
const inboxV2SourceIdentityResolutionMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceIdentityResolutionFileName
);
const inboxV2SourceMessageReconciliationMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceMessageReconciliationFileName
);
const inboxV2AtomicProviderIoMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2AtomicProviderIoFileName
);
const inboxV2OutboxTerminalPayloadMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2OutboxTerminalPayloadFileName
);
const inboxV2SourceProcessingRuntimeMigrations = migrationFiles.filter(
  ({ fileName }) => fileName === inboxV2SourceProcessingRuntimeFileName
);
const inboxV2MonotonicTimelineMigrations = migrationFiles.filter(
  ({ fileName, sql }) =>
    fileName === inboxV2MonotonicTimelineFileName &&
    sql.includes(inboxV2MonotonicTimelineMarker)
);
const inboxV2OutboundSendAuthorityMigrations = migrationFiles.filter(
  ({ fileName, sql }) =>
    fileName === inboxV2OutboundSendAuthorityFileName &&
    sql.includes(inboxV2OutboundSendAuthorityMarker)
);
const inboxV2ConversationWorkHeadMigrations = migrationFiles.filter(
  ({ fileName, sql }) =>
    fileName === inboxV2ConversationWorkHeadFileName &&
    sql.includes(inboxV2ConversationWorkHeadMarker)
);
const inboxV2FileObjectMigrations = migrationFiles.filter(
  ({ fileName, sql }) =>
    fileName === inboxV2FileObjectFileName &&
    sql.includes(inboxV2FileObjectMarker)
);
const inboxV2SchemaFileNames = (await readdir(inboxV2SchemaDirectory))
  .filter((fileName) => fileName.endsWith(".ts"))
  .sort();
const inboxV2InvariantBlocks = (
  await Promise.all(
    inboxV2SchemaFileNames.map(async (fileName) =>
      extractInboxV2InvariantBlocks(
        fileName,
        await readFile(`${inboxV2SchemaDirectory}/${fileName}`, "utf8")
      )
    )
  )
).flat();
const inboxV2DatabaseResetReceiptInvariantBlock =
  extractInboxV2BareTemplateSqlBlock(
    "database-reset-receipt.ts",
    await readFile(
      `${inboxV2SchemaDirectory}/database-reset-receipt.ts`,
      "utf8"
    ),
    inboxV2DatabaseResetReceiptInvariantName
  );

if (inboxV2InvariantBlocks.length === 0) {
  console.error("DB schema has no Inbox V2 invariant SQL blocks.");
  process.exit(1);
}

const invariantBlockNames = inboxV2InvariantBlocks.map(({ name }) => name);
if (new Set(invariantBlockNames).size !== invariantBlockNames.length) {
  console.error("DB schema has duplicate Inbox V2 invariant SQL block names.");
  process.exit(1);
}
const inboxV2FoundationInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => inboxV2FoundationInvariantNames.has(name)
);
const inboxV2WorkItemInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2WorkItemInvariantName
);
const inboxV2ConversationWorkHeadInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2ConversationWorkHeadInvariantName
  );
const inboxV2FileObjectInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2FileObjectInvariantName
);
const inboxV2MessageAttachmentAnchorInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2MessageAttachmentAnchorInvariantName
  );
const inboxV2TimelineMessageInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => inboxV2TimelineMessageInvariantNames.has(name)
);
const inboxV2EmployeeConversationStateInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2EmployeeConversationStateInvariantName
  );
const inboxV2DataGovernancePrivacyInvariantBlocks =
  inboxV2InvariantBlocks.filter(({ name }) =>
    inboxV2DataGovernancePrivacyInvariantNames.has(name)
  );
const inboxV2AuthorizationRelationsInvariantBlocks =
  inboxV2InvariantBlocks.filter(({ name }) =>
    inboxV2AuthorizationRelationsInvariantNames.has(name)
  );
const inboxV2AtomicProviderIoInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2AtomicProviderIoInvariantName
);
const inboxV2SecurityDenialInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2SecurityDenialInvariantName
);
const inboxV2RepositoryFoundationInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2RepositoryFoundationInvariantName
  );
const inboxV2ConversationTimelineHeadInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2ConversationTimelineHeadInvariantName
  );
const inboxV2SourceRegistryInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2SourceRegistryInvariantName
);
const inboxV2SourceRawIngressInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2SourceRawIngressInvariantName
);
const inboxV2SourceNormalizationInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2SourceNormalizationInvariantName
);
const inboxV2SourceIdentityResolutionInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2SourceIdentityResolutionInvariantName
  );
const inboxV2SourceMessageReconciliationInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2SourceMessageReconciliationInvariantName
  );
const inboxV2OutboxTerminalPayloadInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2OutboxTerminalPayloadInvariantName
  );
const inboxV2SourceProcessingRuntimeInvariantBlocks =
  inboxV2InvariantBlocks.filter(
    ({ name }) => name === inboxV2SourceProcessingRuntimeInvariantName
  );
const inboxV2SourceRawAdmissionInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) => name === inboxV2SourceRawAdmissionInvariantName
);
const inboxV2MembershipPrivilegeBoundaryBlock = extractInboxV2NamedSqlBlock(
  "membership-privilege-boundary.ts",
  await readFile(
    `${inboxV2SchemaDirectory}/membership-privilege-boundary.ts`,
    "utf8"
  ),
  inboxV2MembershipPrivilegeBoundaryName
);
const inboxV2RepositoryFoundationOwnedBlocks = [
  ...inboxV2RepositoryFoundationInvariantBlocks,
  inboxV2MembershipPrivilegeBoundaryBlock
];
if (
  inboxV2FoundationInvariantBlocks.length !==
  inboxV2FoundationInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2FoundationInvariantNames.size} Inbox V2 foundation invariant SQL blocks, found ${inboxV2FoundationInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2WorkItemInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2WorkItemInvariantName} schema block, found ${inboxV2WorkItemInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2ConversationWorkHeadInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2ConversationWorkHeadInvariantName} schema block, found ${inboxV2ConversationWorkHeadInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2FileObjectInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2FileObjectInvariantName} schema block, found ${inboxV2FileObjectInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2MessageAttachmentAnchorInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2MessageAttachmentAnchorInvariantName} schema block, found ${inboxV2MessageAttachmentAnchorInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (
  inboxV2TimelineMessageInvariantBlocks.length !==
  inboxV2TimelineMessageInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2TimelineMessageInvariantNames.size} Inbox V2 Timeline/Message invariant SQL blocks, found ${inboxV2TimelineMessageInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2EmployeeConversationStateInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2EmployeeConversationStateInvariantName} schema block, found ${inboxV2EmployeeConversationStateInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (
  inboxV2DataGovernancePrivacyInvariantBlocks.length !==
  inboxV2DataGovernancePrivacyInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2DataGovernancePrivacyInvariantNames.size} Inbox V2 data-governance/privacy invariant SQL blocks, found ${inboxV2DataGovernancePrivacyInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (
  inboxV2AuthorizationRelationsInvariantBlocks.length !==
  inboxV2AuthorizationRelationsInvariantNames.size
) {
  console.error(
    `Expected ${inboxV2AuthorizationRelationsInvariantNames.size} Inbox V2 authorization-relations invariant SQL blocks, found ${inboxV2AuthorizationRelationsInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2AtomicProviderIoInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2AtomicProviderIoInvariantName} schema block, found ${inboxV2AtomicProviderIoInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SecurityDenialInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SecurityDenialInvariantName} schema block, found ${inboxV2SecurityDenialInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2RepositoryFoundationInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2RepositoryFoundationInvariantName} schema block, found ${inboxV2RepositoryFoundationInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2ConversationTimelineHeadInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2ConversationTimelineHeadInvariantName} schema block, found ${inboxV2ConversationTimelineHeadInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceRegistryInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceRegistryInvariantName} schema block, found ${inboxV2SourceRegistryInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceRawIngressInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceRawIngressInvariantName} schema block, found ${inboxV2SourceRawIngressInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceNormalizationInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceNormalizationInvariantName} schema block, found ${inboxV2SourceNormalizationInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceIdentityResolutionInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceIdentityResolutionInvariantName} schema block, found ${inboxV2SourceIdentityResolutionInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceMessageReconciliationInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceMessageReconciliationInvariantName} schema block, found ${inboxV2SourceMessageReconciliationInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2OutboxTerminalPayloadInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2OutboxTerminalPayloadInvariantName} schema block, found ${inboxV2OutboxTerminalPayloadInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceProcessingRuntimeInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceProcessingRuntimeInvariantName} schema block, found ${inboxV2SourceProcessingRuntimeInvariantBlocks.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceRawAdmissionInvariantBlocks.length !== 1) {
  console.error(
    `Expected exactly one ${inboxV2SourceRawAdmissionInvariantName} schema block, found ${inboxV2SourceRawAdmissionInvariantBlocks.length}.`
  );
  process.exit(1);
}
const unownedInvariantBlocks = inboxV2InvariantBlocks.filter(
  ({ name }) =>
    !inboxV2FoundationInvariantNames.has(name) &&
    name !== inboxV2WorkItemInvariantName &&
    name !== inboxV2ConversationWorkHeadInvariantName &&
    name !== inboxV2FileObjectInvariantName &&
    name !== inboxV2MessageAttachmentAnchorInvariantName &&
    !inboxV2TimelineMessageInvariantNames.has(name) &&
    name !== inboxV2EmployeeConversationStateInvariantName &&
    !inboxV2DataGovernancePrivacyInvariantNames.has(name) &&
    !inboxV2AuthorizationRelationsInvariantNames.has(name) &&
    name !== inboxV2AtomicProviderIoInvariantName &&
    name !== inboxV2SecurityDenialInvariantName &&
    name !== inboxV2RepositoryFoundationInvariantName &&
    name !== inboxV2ConversationTimelineHeadInvariantName &&
    name !== inboxV2SourceRegistryInvariantName &&
    name !== inboxV2SourceRawIngressInvariantName &&
    name !== inboxV2SourceNormalizationInvariantName &&
    name !== inboxV2SourceIdentityResolutionInvariantName &&
    name !== inboxV2SourceMessageReconciliationInvariantName &&
    name !== inboxV2OutboxTerminalPayloadInvariantName &&
    name !== inboxV2SourceProcessingRuntimeInvariantName &&
    name !== inboxV2SourceRawAdmissionInvariantName
);
if (unownedInvariantBlocks.length > 0) {
  console.error(
    `Inbox V2 invariant blocks have no finalized migration owner: ${unownedInvariantBlocks.map(({ name }) => name).join(", ")}.`
  );
  process.exit(1);
}

const tenantTables = [
  ...metadata.matchAll(
    /\{ name: "([^"]+)", scope: "tenant", requiresTenantId: true \}/g
  )
].map((match) => match[1]);

if (tenantTables.length === 0) {
  console.error("DB schema scaffold does not declare tenant-scoped tables.");
  process.exit(1);
}

for (const tableName of ["event_store", "outbox", "audit_log"]) {
  if (
    !metadata.includes(`name: "${tableName}"`) ||
    !migrationSql.includes(`"${tableName}"`)
  ) {
    console.error(
      `DB schema and migration must include required table: ${tableName}.`
    );
    process.exit(1);
  }
}

for (const tableName of tenantTables) {
  const tableBlock = findCreateTableBlock(migrationSql, tableName);

  if (!tableBlock) {
    console.error(`Missing migration CREATE TABLE block for ${tableName}.`);
    process.exit(1);
  }

  if (!/"tenant_id"\s+text\b[^\n]*NOT NULL/.test(tableBlock)) {
    console.error(`${tableName} must include a non-null tenant_id column.`);
    process.exit(1);
  }

  if (!hasTenantAwareIndex(migrationSql, tableName)) {
    console.error(`${tableName} must include a tenant-aware index.`);
    process.exit(1);
  }
}

if (inboxV2FoundationMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 foundation migration, found ${inboxV2FoundationMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2WorkItemMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 WorkItem migration, found ${inboxV2WorkItemMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2TimelineMessageMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 Timeline/Message migration, found ${inboxV2TimelineMessageMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2EmployeeConversationStateMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 EmployeeConversationState migration, found ${inboxV2EmployeeConversationStateMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2DataGovernancePrivacyMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 data-governance/privacy migration, found ${inboxV2DataGovernancePrivacyMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2AuthorizationRelationsMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 authorization-relations migration, found ${inboxV2AuthorizationRelationsMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SecurityDenialMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 security-denial migration, found ${inboxV2SecurityDenialMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2RepositoryFoundationMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 repository-foundation migration, found ${inboxV2RepositoryFoundationMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2DatabaseResetReceiptMigrations.length !== 1) {
  console.error(
    `Expected exactly one Inbox V2 database-reset receipt migration, found ${inboxV2DatabaseResetReceiptMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2ConversationTimelineHeadMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 Conversation timeline-head migration, found ${inboxV2ConversationTimelineHeadMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceRegistryMigrations.length !== 1) {
  console.error(
    `Expected exactly one finalized Inbox V2 source-registry migration, found ${inboxV2SourceRegistryMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2AuthorizedDomainCommandMigrations.length !== 1) {
  console.error(
    `Expected exactly one authorized-domain-command migration, found ${inboxV2AuthorizedDomainCommandMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceOnboardingResultMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-onboarding-result migration, found ${inboxV2SourceOnboardingResultMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceRawIngressMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-raw-ingress migration, found ${inboxV2SourceRawIngressMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceNormalizationMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-normalization migration, found ${inboxV2SourceNormalizationMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceIdentityResolutionMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-identity-resolution migration, found ${inboxV2SourceIdentityResolutionMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceMessageReconciliationMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-message-reconciliation migration, found ${inboxV2SourceMessageReconciliationMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2AtomicProviderIoMigrations.length !== 1) {
  console.error(
    `Expected exactly one atomic provider-I/O migration, found ${inboxV2AtomicProviderIoMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2OutboxTerminalPayloadMigrations.length !== 1) {
  console.error(
    `Expected exactly one outbox terminal-payload migration, found ${inboxV2OutboxTerminalPayloadMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2SourceProcessingRuntimeMigrations.length !== 1) {
  console.error(
    `Expected exactly one source-processing-runtime migration, found ${inboxV2SourceProcessingRuntimeMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2MonotonicTimelineMigrations.length !== 1) {
  console.error(
    `Expected exactly one monotonic-timeline migration, found ${inboxV2MonotonicTimelineMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2OutboundSendAuthorityMigrations.length !== 1) {
  console.error(
    `Expected exactly one outbound-send-authority migration, found ${inboxV2OutboundSendAuthorityMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2ConversationWorkHeadMigrations.length !== 1) {
  console.error(
    `Expected exactly one Conversation Work head migration, found ${inboxV2ConversationWorkHeadMigrations.length}.`
  );
  process.exit(1);
}
if (inboxV2FileObjectMigrations.length !== 1) {
  console.error(
    `Expected exactly one typed-content/file-object migration, found ${inboxV2FileObjectMigrations.length}.`
  );
  process.exit(1);
}

try {
  assertGlobalMigrationArtifactBijection({
    journal: drizzleJournal,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 34,
    finalizedMigrationFileName:
      inboxV2AuthorizationRelationsMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 50,
    finalizedMigrationFileName:
      inboxV2OutboundSendAuthorityMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 52,
    finalizedMigrationFileName:
      inboxV2ConversationWorkHeadMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 53,
    finalizedMigrationFileName: inboxV2FileObjectMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 48,
    finalizedMigrationFileName:
      inboxV2SourceProcessingRuntimeMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 49,
    finalizedMigrationFileName: inboxV2MonotonicTimelineMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 40,
    finalizedMigrationFileName:
      inboxV2AuthorizedDomainCommandMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 41,
    finalizedMigrationFileName:
      inboxV2SourceOnboardingResultMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 42,
    finalizedMigrationFileName: inboxV2SourceRawIngressMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 43,
    finalizedMigrationFileName:
      inboxV2SourceNormalizationMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 44,
    finalizedMigrationFileName:
      inboxV2SourceIdentityResolutionMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 45,
    finalizedMigrationFileName:
      inboxV2SourceMessageReconciliationMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 46,
    finalizedMigrationFileName: inboxV2AtomicProviderIoMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 47,
    finalizedMigrationFileName:
      inboxV2OutboxTerminalPayloadMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 37,
    finalizedMigrationFileName:
      inboxV2DatabaseResetReceiptMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 36,
    finalizedMigrationFileName:
      inboxV2RepositoryFoundationMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 35,
    finalizedMigrationFileName: inboxV2SecurityDenialMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 38,
    finalizedMigrationFileName:
      inboxV2ConversationTimelineHeadMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
  assertMigrationJournalArtifactParity({
    journal: drizzleJournal,
    targetIndex: 39,
    finalizedMigrationFileName: inboxV2SourceRegistryMigrations[0].fileName,
    migrationFileNames,
    snapshotFileNames: migrationMetadataFileNames.filter((fileName) =>
      fileName.endsWith("_snapshot.json")
    )
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

assertInboxV2FoundationMigration(inboxV2FoundationMigrations[0]);
assertInboxV2WorkItemMigration(inboxV2WorkItemMigrations[0]);
assertInboxV2TimelineMessageMigration(
  inboxV2TimelineMessageMigrations[0],
  restoreInboxV2TimelineMessagePreMsg002InvariantBlocks(
    inboxV2TimelineMessageInvariantBlocks
  )
);
assertInboxV2AtomicProviderIoMigration(
  inboxV2AtomicProviderIoMigrations[0],
  restoreInboxV2AtomicProviderIoPreMsg002InvariantBlock(
    inboxV2AtomicProviderIoInvariantBlocks[0]
  )
);
assertInboxV2OutboundSendAuthorityMigration(
  inboxV2OutboundSendAuthorityMigrations[0],
  inboxV2TimelineMessageMigrations[0],
  inboxV2AtomicProviderIoMigrations[0]
);
assertInboxV2ConversationWorkHeadMigration(
  inboxV2ConversationWorkHeadMigrations[0],
  inboxV2ConversationWorkHeadInvariantBlocks[0]
);
assertInboxV2FileObjectMigration(
  inboxV2FileObjectMigrations[0],
  inboxV2FileObjectInvariantBlocks[0],
  getInboxV2Msg003AttachmentAuthorizationInvariantSql(
    inboxV2AtomicProviderIoInvariantBlocks[0].sql
  ),
  inboxV2MessageAttachmentAnchorInvariantBlocks[0]
);
assertInboxV2EmployeeConversationStateMigration(
  inboxV2EmployeeConversationStateMigrations[0]
);
assertInboxV2DataGovernancePrivacyMigration(
  inboxV2DataGovernancePrivacyMigrations[0]
);
assertInboxV2AuthorizationRelationsMigration(
  inboxV2AuthorizationRelationsMigrations[0]
);
assertInboxV2ConversationTimelineHeadMigration(
  inboxV2ConversationTimelineHeadMigrations[0],
  inboxV2ConversationTimelineHeadInvariantBlocks[0]
);
assertInboxV2SourceRegistryMigration(
  inboxV2SourceRegistryMigrations[0],
  inboxV2SourceRegistryInvariantBlocks[0]
);
assertInboxV2SourceRawIngressMigration(
  inboxV2SourceRawIngressMigrations[0],
  inboxV2SourceRawIngressInvariantBlocks[0]
);
assertInboxV2SourceNormalizationMigration(
  inboxV2SourceNormalizationMigrations[0],
  inboxV2SourceNormalizationInvariantBlocks[0]
);
assertInboxV2SourceIdentityResolutionMigration(
  inboxV2SourceIdentityResolutionMigrations[0],
  inboxV2SourceIdentityResolutionInvariantBlocks[0]
);
assertInboxV2SourceMessageReconciliationMigration(
  inboxV2SourceMessageReconciliationMigrations[0],
  inboxV2SourceMessageReconciliationInvariantBlocks[0]
);
assertInboxV2OutboxTerminalPayloadMigration(
  inboxV2OutboxTerminalPayloadMigrations[0],
  inboxV2OutboxTerminalPayloadInvariantBlocks[0]
);
assertInboxV2SourceProcessingRuntimeMigration(
  inboxV2SourceProcessingRuntimeMigrations[0],
  inboxV2SourceRawAdmissionInvariantBlocks[0],
  inboxV2SourceProcessingRuntimeInvariantBlocks[0]
);
assertInboxV2MonotonicTimelineMigration(inboxV2MonotonicTimelineMigrations[0]);
assertInboxV2SecurityDenialMigration(inboxV2SecurityDenialMigrations[0]);
assertInboxV2RepositoryFoundationMigration(
  inboxV2RepositoryFoundationMigrations[0]
);
try {
  await assertInboxV2RepositoryFoundationGeneratedSchemaParity(
    inboxV2RepositoryFoundationMigrations[0]
  );
  await assertInboxV2LatestGeneratedSchemaParity(
    inboxV2DatabaseResetReceiptMigrations[0],
    inboxV2DatabaseResetReceiptInvariantBlock
  );
  await assertInboxV2ConversationTimelineHeadGeneratedSchemaParity(
    inboxV2ConversationTimelineHeadMigrations[0]
  );
  await assertInboxV2SourceRegistryGeneratedSchemaParity(
    inboxV2SourceRegistryMigrations[0]
  );
  await assertInboxV2AuthorizedDomainCommandGeneratedSchemaParity(
    inboxV2AuthorizedDomainCommandMigrations[0]
  );
  await assertInboxV2SourceOnboardingResultGeneratedSchemaParity(
    inboxV2SourceOnboardingResultMigrations[0]
  );
  await assertInboxV2SourceRawIngressGeneratedSchemaParity(
    inboxV2SourceRawIngressMigrations[0]
  );
  await assertInboxV2SourceNormalizationGeneratedSchemaParity(
    inboxV2SourceNormalizationMigrations[0]
  );
  await assertInboxV2SourceIdentityResolutionGeneratedSchemaParity(
    inboxV2SourceIdentityResolutionMigrations[0]
  );
  await assertInboxV2SourceMessageReconciliationGeneratedSchemaParity(
    inboxV2SourceMessageReconciliationMigrations[0]
  );
  await assertInboxV2AtomicProviderIoGeneratedSchemaParity();
  await assertInboxV2OutboxTerminalPayloadGeneratedSchemaParity();
  await assertInboxV2SourceProcessingRuntimeGeneratedSchemaParity(
    inboxV2SourceProcessingRuntimeMigrations[0]
  );
  await assertInboxV2MonotonicTimelineGeneratedSchemaParity(
    inboxV2MonotonicTimelineMigrations[0]
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

console.log("db:check passed");

function assertInboxV2ConversationTimelineHeadMigration(
  migration,
  invariantBlock
) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 3) {
    throw new Error(
      "Inbox V2 Conversation timeline-head migration is missing generated DDL or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [
      `${inboxV2ConversationTimelineHeadMarker}\n${inboxV2ConversationTimelineHeadPreflightSql}`
    ],
    statements.slice(0, 1),
    "Inbox V2 Conversation timeline-head preflight"
  );
  assertExactSqlSequence(
    [invariantBlock.sql],
    statements.slice(-1),
    "Inbox V2 Conversation timeline-head invariant tail"
  );

  if (
    !statements[0]?.includes(inboxV2ConversationTimelineHeadPreflightMarker) ||
    statements[0].indexOf(inboxV2ConversationTimelineHeadPreflightMarker) >
      statements[0].indexOf("do $preflight$")
  ) {
    throw new Error(
      "Inbox V2 Conversation timeline-head migration must run its reviewed preflight first."
    );
  }

  for (const requiredFragment of [
    'CREATE TABLE "inbox_v2_conversation_identity_fences"',
    'CREATE INDEX "inbox_v2_timeline_items_eligible_activity_tail_idx"',
    "inbox_v2_assert_conversation_timeline_head",
    "inbox_v2_lock_conversation_identity",
    "inbox_v2_conversations_timeline_head_constraint_trigger",
    "inbox_v2_conversation_heads_timeline_constraint_trigger",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 Conversation timeline-head migration is missing ${requiredFragment}.`
      );
    }
  }
}

async function assertInboxV2ConversationTimelineHeadGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0038_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 37,
    targetIndex: 38
  });
  const historicalGenerated = withoutInboxV2Src010SchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(1, -1),
    "Inbox V2 DB-010 ordered generated migration DDL"
  );
}

function assertInboxV2SourceRegistryMigration(migration, invariantBlock) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 12) {
    throw new Error(
      "Inbox V2 source-registry migration is missing preflight, generated DDL, or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [`${inboxV2SourceRegistryMarker}\n${inboxV2SourceRegistryPreflightSql}`],
    statements.slice(0, 1),
    "Inbox V2 source-registry preflight"
  );
  assertExactSqlSequence(
    [invariantBlock.sql],
    statements.slice(-1),
    "Inbox V2 source-registry invariant tail"
  );
  if (
    !statements[0]?.includes(inboxV2SourceRegistryPreflightMarker) ||
    statements[0].indexOf(inboxV2SourceRegistryPreflightMarker) >
      statements[0].indexOf("do $preflight$")
  ) {
    throw new Error(
      "Inbox V2 source-registry migration must run its reviewed preflight first."
    );
  }
  for (const requiredFragment of [
    'CREATE TABLE "inbox_v2_source_registry_transitions"',
    'CREATE TABLE "inbox_v2_source_registry_heads"',
    'CREATE TABLE "inbox_v2_source_registry_related_authority_refs"',
    "inbox_v2_source_registry_assert_transition",
    "inbox_v2_source_registry_head_after_update",
    "inbox_v2_source_registry_child_head_deferred",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 source-registry migration is missing ${requiredFragment}.`
      );
    }
  }
}

function assertInboxV2SourceRawIngressMigration(migration, invariantBlock) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 2) {
    throw new Error(
      "Inbox V2 source-raw-ingress migration is missing generated DDL or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [invariantBlock.sql],
    statements.slice(-1),
    "Inbox V2 SRC-002 source-raw-ingress invariant tail"
  );
  for (const requiredFragment of [
    'CREATE TABLE "inbox_v2_source_raw_envelopes"',
    'CREATE TABLE "inbox_v2_source_raw_evidence"',
    'CREATE TABLE "inbox_v2_source_raw_quarantines"',
    'CREATE TABLE "inbox_v2_source_raw_work_items"',
    "inbox_v2_source_raw_work_guard",
    "inbox_v2_source_raw_assert_aggregate",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 source-raw-ingress migration is missing ${requiredFragment}.`
      );
    }
  }
}

function assertInboxV2SourceNormalizationMigration(migration, invariantBlock) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 2) {
    throw new Error(
      "Inbox V2 source-normalization migration is missing generated DDL or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [`${inboxV2SourceNormalizationMarker}\n${invariantBlock.sql}`],
    statements.slice(-1),
    "Inbox V2 SRC-003 source-normalization invariant tail"
  );
  for (const requiredFragment of [
    'CREATE TYPE "public"."inbox_v2_source_normalization_outcome"',
    'CREATE TABLE "inbox_v2_source_normalized_envelopes"',
    'CREATE TABLE "inbox_v2_source_normalized_evidence"',
    'CREATE TABLE "inbox_v2_source_normalized_evidence_payloads"',
    'CREATE TABLE "inbox_v2_source_normalized_quarantines"',
    'CREATE TABLE "inbox_v2_source_normalization_results"',
    "inbox_v2_source_normalized_assert_aggregate",
    "inbox_v2_source_normalization_assert_result",
    "inbox_v2_source_normalization_complete_work_guard",
    "exact unexpired lease result",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 source-normalization migration is missing ${requiredFragment}.`
      );
    }
  }
}

function assertInboxV2SourceIdentityResolutionMigration(
  migration,
  invariantBlock
) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 2) {
    throw new Error(
      "Inbox V2 source-identity-resolution migration is missing generated DDL or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [`${inboxV2SourceIdentityResolutionMarker}\n${invariantBlock.sql}`],
    statements.slice(-1),
    "Inbox V2 SRC-004 source-identity-resolution invariant tail"
  );
  for (const requiredFragment of [
    'CREATE TYPE "public"."inbox_v2_source_identity_assessment_outcome"',
    'CREATE TYPE "public"."inbox_v2_source_identity_assessment_confidence"',
    'CREATE TABLE "inbox_v2_source_identity_observations"',
    'CREATE TABLE "inbox_v2_source_identity_assessments"',
    'CREATE TABLE "inbox_v2_source_identity_assessment_heads"',
    "inbox_v2_source_identity_resolution_reject_immutable",
    "inbox_v2_source_identity_assessment_head_guard",
    "inbox_v2_source_identity_assessment_assert_local",
    "inbox_v2_source_identity_assessment_assert_head_local",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 source-identity-resolution migration is missing ${requiredFragment}.`
      );
    }
  }
  for (const forbiddenFragment of [
    "inbox_v2_source_identity_assessment_assert_aggregate",
    "assessment_history_incoherent"
  ]) {
    if (migration.sql.includes(forbiddenFragment)) {
      throw new Error(
        `Inbox V2 source-identity-resolution migration contains unbounded legacy invariant ${forbiddenFragment}.`
      );
    }
  }
}

function assertInboxV2SourceMessageReconciliationMigration(
  migration,
  invariantBlock
) {
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 2) {
    throw new Error(
      "Inbox V2 source-message-reconciliation migration is missing generated DDL or its invariant tail."
    );
  }
  assertExactSqlSequence(
    [`${inboxV2SourceMessageReconciliationMarker}\n${invariantBlock.sql}`],
    statements.slice(-1),
    "Inbox V2 SRC-006 source-message-reconciliation invariant tail"
  );
  for (const requiredFragment of [
    ...inboxV2SourceMessageReconciliationEnumNames.map(
      (name) => `CREATE TYPE "public"."${name.slice("public.".length)}"`
    ),
    ...inboxV2SourceMessageReconciliationTableNames.map(
      (name) => `CREATE TABLE "${name.slice("public.".length)}"`
    ),
    "inbox_v2_source_reconciliation_reject_immutable",
    "inbox_v2_deferred_source_action_guard",
    "inbox_v2_deferred_source_ordering_head_guard",
    "inbox_v2_source_correlation_evidence_guard",
    "inbox_v2_deferred_source_action_assert",
    "inbox_v2_deferred_source_transition_assert",
    "inbox_v2_deferred_source_candidate_assert",
    "inbox_v2_deferred_source_head_assert",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 source-message-reconciliation migration is missing ${requiredFragment}.`
      );
    }
  }
}

async function assertInboxV2SourceRegistryGeneratedSchemaParity(migration) {
  const snapshotPath = "packages/db/drizzle/meta/0039_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 38,
    targetIndex: 39
  });
  const historicalGenerated = withoutInboxV2Src011SchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const expectedStatements = orderSourceRegistryGeneratedStatements(
    historicalGenerated.statements
  );
  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    expectedStatements,
    checkedInStatements.slice(1, -1),
    "Inbox V2 SRC-010 ordered generated migration DDL"
  );
}

async function assertInboxV2AuthorizedDomainCommandGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0040_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 39,
    targetIndex: 40
  });
  const historicalGenerated =
    withoutInboxV2SourceOnboardingResultSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  const invariantStart = checkedInStatements.findIndex((statement) =>
    statement.includes(inboxV2AuthorizedDomainCommandMarker)
  );
  if (invariantStart < 0) {
    throw new Error(
      "Inbox V2 SRC-011 authorized-domain migration is missing its coherence tail."
    );
  }
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, invariantStart),
    "Inbox V2 SRC-011 authorized-domain ordered generated migration prefix"
  );
  const invariantTail = checkedInStatements.slice(invariantStart);
  if (
    invariantTail.length !== 4 ||
    digestOrderedSqlStatements(invariantTail) !==
      inboxV2AuthorizedDomainCommandTailDigest
  ) {
    throw new Error(
      "Inbox V2 SRC-011 authorized-domain coherence tail differs from its reviewed exact digest."
    );
  }
}

async function assertInboxV2SourceOnboardingResultGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0041_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 40,
    targetIndex: 41
  });
  const historicalGenerated =
    withoutInboxV2SourceRawIngressSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  const invariantStart = checkedInStatements.findIndex((statement) =>
    statement.includes(inboxV2SourceOnboardingResultMarker)
  );
  if (invariantStart < 0) {
    throw new Error(
      "Inbox V2 SRC-011 migration is missing its immutable result/coherence tail."
    );
  }
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, invariantStart),
    "Inbox V2 SRC-011 ordered generated migration prefix"
  );

  const invariantTail = checkedInStatements.slice(invariantStart);
  if (
    invariantTail.length !== 10 ||
    digestOrderedSqlStatements(invariantTail) !==
      inboxV2SourceOnboardingResultTailDigest
  ) {
    throw new Error(
      "Inbox V2 SRC-011 immutable result/coherence tail differs from its reviewed exact digest."
    );
  }
  const invariantSql = invariantTail.join("\n");
  for (const requiredFragment of [
    "inbox_v2_source_onboarding_results_command_mutation_fk",
    "inbox_v2_source_onboarding_results_stream_mutation_fk",
    "inbox_v2_source_onboarding_results_mutation_commit_fk",
    "inbox_v2_source_onboarding_canonical_json_text",
    "inbox_v2_source_onboarding_result_immutable",
    "inbox_v2_source_onboarding_result_truncate_guard_trigger",
    "inbox_v2_source_onboarding_result_coherence",
    "inbox_v2_source_onboarding_result_commit_constraint",
    "inbox_v2_source_onboarding_result_row_constraint",
    "on delete cascade",
    "inbox_v2_assert_source_registry_lineage",
    "source_onboarding_result_snapshot",
    "core:source_account_connector_metadata",
    "core:source-registry-sql",
    "core:source_replay_and_diagnostics",
    "inbox_v2_tenant_stream_commits",
    "inbox_v2_tenant_stream_heads",
    "inbox_v2_tenant_stream_retention_advances",
    "inbox_v2_tenant_stream_changes",
    "inbox_v2_domain_events",
    "inbox_v2_outbox_intents",
    "inbox_v2_outbox_work_items",
    "inbox_v2_outbox_outcomes",
    "inbox_v2_auth_audit_events",
    "inbox_v2_auth_audit_facets",
    "stream_row.command_ids @>",
    "stream_row.position < head_row.min_retained_position",
    "advance_row.resulting_head_revision <= head_row.revision",
    "command_row.result_reference->>'recordId' = old.id",
    "event_row.payload_reference->>'recordId' = old.id",
    "intent_row.payload_reference->>'recordId' = old.id",
    "work_row.terminal_result_reference->>'recordId' = old.id",
    "outcome_row.result_reference->>'recordId' = old.id",
    "audit_row.evidence_reference->>'recordId' = old.id",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!invariantSql.includes(requiredFragment)) {
      throw new Error(
        `Inbox V2 SRC-011 migration invariant tail is missing ${requiredFragment}.`
      );
    }
  }
}

async function assertInboxV2SourceRawIngressGeneratedSchemaParity(migration) {
  const snapshotPath = "packages/db/drizzle/meta/0042_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 41,
    targetIndex: 42
  });
  const historicalGenerated =
    withoutInboxV2SourceNormalizationSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, -1),
    "Inbox V2 SRC-002 ordered generated migration DDL"
  );
}

async function assertInboxV2SourceNormalizationGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0043_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 42,
    targetIndex: 43
  });
  const historicalGenerated =
    withoutInboxV2SourceIdentityResolutionSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, -1),
    "Inbox V2 SRC-003 ordered generated migration DDL"
  );
}

async function assertInboxV2SourceIdentityResolutionGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0044_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 43,
    targetIndex: 44
  });
  const historicalGenerated =
    withoutInboxV2SourceMessageReconciliationSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, -1),
    "Inbox V2 SRC-004 ordered generated migration DDL"
  );
}

async function assertInboxV2SourceMessageReconciliationGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0045_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 44,
    targetIndex: 45
  });
  const historicalGenerated =
    withoutInboxV2AtomicProviderIoSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, -1),
    "Inbox V2 SRC-006 ordered generated migration DDL"
  );
}

async function assertInboxV2AtomicProviderIoGeneratedSchemaParity() {
  const snapshotPath = "packages/db/drizzle/meta/0046_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 45,
    targetIndex: 46
  });
  const historicalGenerated =
    withoutInboxV2OutboxTerminalPayloadSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );
}

async function assertInboxV2OutboxTerminalPayloadGeneratedSchemaParity() {
  const snapshotPath = "packages/db/drizzle/meta/0047_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 46,
    targetIndex: 47
  });
  const historicalGenerated =
    withoutInboxV2SourceProcessingRuntimeSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );
}

async function assertInboxV2SourceProcessingRuntimeGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0048_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 47,
    targetIndex: 48
  });
  const historicalGenerated =
    withoutInboxV2MonotonicTimelineSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, -2),
    "Inbox V2 SRC-008 ordered generated migration DDL"
  );
}

async function assertInboxV2MonotonicTimelineGeneratedSchemaParity(migration) {
  const snapshotPath = "packages/db/drizzle/meta/0049_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 48,
    targetIndex: 49
  });
  const historicalGenerated =
    withoutInboxV2Msg002RerouteIntentSchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, 1),
    "Inbox V2 MSG-001 ordered generated migration DDL"
  );
}

function assertInboxV2MonotonicTimelineMigration(migration) {
  if (migration.fileName !== inboxV2MonotonicTimelineFileName) {
    throw new Error(
      `${migration.fileName} must be the Inbox V2 monotonic-timeline migration at index 0049.`
    );
  }
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length !== 7) {
    throw new Error(
      `${migration.fileName} must contain one generated index statement and six reviewed system-event integrity statements.`
    );
  }
  const tailDigest = digestOrderedSqlStatements(statements.slice(1));
  if (tailDigest !== inboxV2MonotonicTimelineTailSha256) {
    throw new Error(
      `${migration.fileName} system-event integrity tail differs from the reviewed MSG-001 sequence contract.`
    );
  }
  for (const fragment of [
    inboxV2MonotonicTimelineIndexName,
    inboxV2MonotonicTimelineMarker,
    "create or replace function public.inbox_v2_system_event_timeline_binding_guard()",
    "create trigger inbox_v2_system_event_timeline_binding_guard",
    "create or replace function public.inbox_v2_referenced_system_event_immutable_guard()",
    "create trigger inbox_v2_referenced_system_event_immutable_guard",
    "core:inbox-v2.conversation-system-event-payload",
    "inbox_v2.system_event_timeline_binding_invalid",
    "inbox_v2.referenced_system_event_immutable"
  ]) {
    if (!migration.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} is missing monotonic-timeline integrity SQL: ${fragment}.`
      );
    }
  }
}

function assertInboxV2OutboxTerminalPayloadMigration(
  migration,
  invariantBlock
) {
  if (migration.fileName !== inboxV2OutboxTerminalPayloadFileName) {
    throw new Error(
      `${migration.fileName} must be the Inbox V2 terminal-payload migration at index 0047.`
    );
  }
  const normalizedMigration = migration.sql
    .replace(/--> statement-breakpoint/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
  const normalizedInvariant = invariantBlock.sql.replace(/\s+/gu, " ").trim();
  if (!normalizedMigration.includes(normalizedInvariant)) {
    throw new Error(
      `${migration.fileName} is stale against ${invariantBlock.name}.`
    );
  }
  for (const fragment of [
    inboxV2OutboxTerminalPayloadMarker,
    'CREATE TABLE "inbox_v2_outbox_terminal_payload_refs"',
    'ADD COLUMN "payload_reference_recorded" boolean DEFAULT false NOT NULL',
    "inbox_v2.outbox_terminal_payload_legacy_incoherent",
    "insert into public.inbox_v2_outbox_terminal_payload_refs",
    "disable trigger inbox_v2_outbox_outcome_immutable_trigger",
    "enable trigger inbox_v2_outbox_outcome_immutable_trigger",
    "result_reference = null",
    "terminal_result_reference = null",
    "DEFERRABLE INITIALLY DEFERRED",
    "inbox_v2_outbox_terminal_payload_refs_coherence",
    "inbox_v2_outbox_terminal_payload_refs_insert_guard",
    "inbox_v2.outbox_terminal_payload_insert_not_finalizing",
    "inbox_v2_outbox_terminal_payload_refs_delete_trigger",
    "current_user = 'hulee_inbox_v2_retention_owner'",
    "inbox_v2_outbox_legacy_outcome_payload_bridge_trigger",
    "inbox_v2_outbox_legacy_work_payload_bridge_trigger",
    "inbox_v2_source_onboarding_terminal_payload_ref_guard_trigger",
    "grant select, insert on table",
    "grant update (terminal_result_reference) on table",
    "inbox_v2.outbox_terminal_payload_retention_boundary_invalid"
  ]) {
    if (!migration.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} is missing terminal-payload bridge SQL: ${fragment}.`
      );
    }
  }
  if (
    /drop\s+column\s+(?:"?result_reference"?|"?terminal_result_reference"?)/iu.test(
      migration.sql
    )
  ) {
    throw new Error(
      `${migration.fileName} must preserve N-1 legacy columns during expand.`
    );
  }
  const positions = [
    migration.sql.indexOf('ADD COLUMN "payload_reference_recorded"'),
    migration.sql.indexOf("$outbox_terminal_payload_legacy_coherence$"),
    migration.sql.indexOf(
      "insert into public.inbox_v2_outbox_terminal_payload_refs"
    ),
    migration.sql.indexOf("update public.inbox_v2_outbox_outcomes"),
    migration.sql.lastIndexOf(
      'ADD CONSTRAINT "inbox_v2_outbox_outcomes_values_check"'
    )
  ];
  if (
    positions.some((position) => position < 0) ||
    positions.some(
      (position, index) => index > 0 && position <= positions[index - 1]
    )
  ) {
    throw new Error(
      `${migration.fileName} must backfill and clear legacy payload references before enforcing clean skeleton checks.`
    );
  }
}

function assertInboxV2SourceProcessingRuntimeMigration(
  migration,
  rawAdmissionInvariantBlock,
  invariantBlock
) {
  if (migration.fileName !== inboxV2SourceProcessingRuntimeFileName) {
    throw new Error(
      `${migration.fileName} must be the Inbox V2 source-processing-runtime migration at index 0048.`
    );
  }
  const statements = splitMigrationStatements(migration.sql);
  assertExactSqlSequence(
    [rawAdmissionInvariantBlock.sql],
    statements.slice(-2, -1),
    "Inbox V2 SRC-008 raw-admission invariant tail"
  );
  assertExactSqlSequence(
    [invariantBlock.sql],
    statements.slice(-1),
    "Inbox V2 SRC-008 source-processing-runtime invariant tail"
  );
  for (const fragment of [
    'CREATE TABLE "inbox_v2_source_raw_admissions"',
    'CREATE TABLE "inbox_v2_source_processing_key_generations"',
    'CREATE TABLE "inbox_v2_source_delivery_dedupe_skeletons"',
    'CREATE TABLE "inbox_v2_source_processing_work_heads"',
    'CREATE TABLE "inbox_v2_source_processing_attempts"',
    'CREATE TABLE "inbox_v2_source_processing_dead_letters"',
    'CREATE TABLE "inbox_v2_source_replay_requests"',
    'CREATE TABLE "inbox_v2_source_account_pressure_heads"',
    'CREATE TABLE "inbox_v2_source_ingress_cursor_checkpoints"',
    'CREATE TYPE "public"."inbox_v2_source_cursor_durable_target_kind"',
    "inbox_v2_src_raw_runtime_bridge_trigger",
    "inbox_v2_src_assert_work_closure",
    "inbox_v2_src_assert_pressure",
    '"durable_target_kind" "inbox_v2_source_cursor_durable_target_kind" NOT NULL',
    '"quarantine_id" text',
    '"cursor_value_secret_ref" text NOT NULL',
    "inbox_v2_src_secret_purpose_guard_trigger",
    "inbox_v2.source_processing_hmac",
    "inbox_v2.source_cursor_value",
    "new.updated_at >= old.activated_at",
    "v_replay_deadline := case",
    "old.state = 'dead_lettered' and new.state = 'pending'",
    "v_target_work.state <> 'dead_lettered'",
    "new.durable_target_kind = 'quarantine'",
    "v_quarantine.quarantine_fingerprint_sha256",
    "new.result_work_id <> new.target_work_id",
    "Invalid same-attempt expired lease reclaim",
    "inbox_v2_source_normalized_evidence_payloads payload_row",
    "if v_route_generation is null then\n    return new;",
    "deferrable initially deferred",
    "revoke all privileges on table"
  ]) {
    if (!migration.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} is missing source-processing-runtime SQL: ${fragment}.`
      );
    }
  }
  for (const forbiddenFragment of [
    '"cursor_secret_ref"',
    "Raw runtime bridge requires current source route authority",
    "new.updated_at >= old.use_until",
    "old.state in ('processed', 'ignored', 'duplicate', 'dead_lettered')"
  ]) {
    if (migration.sql.includes(forbiddenFragment)) {
      throw new Error(
        `${migration.fileName} contains obsolete source-processing SQL: ${forbiddenFragment}.`
      );
    }
  }
  if (/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu.test(migration.sql)) {
    throw new Error(`${migration.fileName} must remain additive.`);
  }
}

function orderSourceRegistryGeneratedStatements(statements) {
  const prerequisites = [];
  const remainder = [];
  for (const statement of statements) {
    if (
      inboxV2SourceRegistryPrerequisiteUniqueConstraintNames.some((name) =>
        statement.includes(`ADD CONSTRAINT "${name}" UNIQUE`)
      )
    ) {
      prerequisites.push(statement);
    } else {
      remainder.push(statement);
    }
  }
  if (
    prerequisites.length !==
    inboxV2SourceRegistryPrerequisiteUniqueConstraintNames.length
  ) {
    throw new Error(
      "Inbox V2 SRC-010 generated DDL is missing prerequisite composite unique constraints."
    );
  }
  prerequisites.sort(
    (left, right) =>
      inboxV2SourceRegistryPrerequisiteUniqueConstraintNames.findIndex((name) =>
        left.includes(name)
      ) -
      inboxV2SourceRegistryPrerequisiteUniqueConstraintNames.findIndex((name) =>
        right.includes(name)
      )
  );
  return [...prerequisites, ...remainder];
}

function assertGlobalMigrationArtifactBijection({
  journal,
  migrationFileNames: sqlFiles,
  snapshotFileNames
}) {
  if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
    throw new Error("Drizzle journal must contain a non-empty entries array.");
  }
  if (
    sqlFiles.length !== journal.entries.length ||
    snapshotFileNames.length !== journal.entries.length
  ) {
    throw new Error(
      `Drizzle journal/SQL/snapshot artifact counts differ: ${journal.entries.length}/${sqlFiles.length}/${snapshotFileNames.length}.`
    );
  }
  let previousWhen = -1;
  const expectedSqlFiles = [];
  const expectedSnapshotFiles = [];
  for (let index = 0; index < journal.entries.length; index += 1) {
    const entry = journal.entries[index];
    const prefix = String(index).padStart(4, "0");
    if (
      entry.idx !== index ||
      entry.version !== journal.version ||
      entry.breakpoints !== true ||
      !Number.isSafeInteger(entry.when) ||
      entry.when <= previousWhen ||
      typeof entry.tag !== "string" ||
      !entry.tag.startsWith(`${prefix}_`)
    ) {
      throw new Error(
        `Drizzle journal entry ${index} is not a contiguous, ordered migration contract.`
      );
    }
    previousWhen = entry.when;
    expectedSqlFiles.push(`${entry.tag}.sql`);
    expectedSnapshotFiles.push(`${prefix}_snapshot.json`);
  }
  assertExactStringSequence(
    expectedSqlFiles,
    [...sqlFiles].sort(),
    "Drizzle journal to SQL artifact mapping"
  );
  assertExactStringSequence(
    expectedSnapshotFiles,
    [...snapshotFileNames].sort(),
    "Drizzle journal to snapshot artifact mapping"
  );
}

async function assertInboxV2RepositoryFoundationGeneratedSchemaParity(
  migration
) {
  const snapshotPath = "packages/db/drizzle/meta/0036_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 35,
    targetIndex: 36,
    schemaPaths: [
      "packages/db/src/schema/tables.ts",
      ...inboxV2SchemaFileNames
        .filter((fileName) => fileName !== "database-reset-receipt.ts")
        .map((fileName) => `${inboxV2SchemaDirectory}/${fileName}`)
    ]
  });
  const historicalGenerated = withoutInboxV2Db010SchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  if (inboxV2RepositoryFoundationBackfillStatements.length !== 4) {
    throw new Error(
      `Inbox V2 DB-007 reviewed backfill artifact must contain exactly two backfills plus the immutable-trigger envelope; found ${inboxV2RepositoryFoundationBackfillStatements.length} statements.`
    );
  }
  const migrationTail = splitMigrationStatements(migration.sql).slice(1);
  const orderedTailSha256 = digestOrderedSqlStatements(migrationTail);
  if (orderedTailSha256 !== inboxV2RepositoryFoundationOrderedTailSha256) {
    throw new Error(
      "Inbox V2 DB-007 ordered migration tail differs from the reviewed sequence contract."
    );
  }
  const checkedInDdl = collectFinalizedMigrationDdlStatements({
    migrationSql: migration.sql,
    finalizedMarker: inboxV2RepositoryFoundationMarker,
    preflightMarker: inboxV2RepositoryFoundationPreflightMarker,
    invariantBlocks: inboxV2RepositoryFoundationOwnedBlocks
  });
  const generatedDdl = removeExactSqlStatements(
    checkedInDdl,
    inboxV2RepositoryFoundationBackfillStatements,
    "Inbox V2 DB-007 reviewed backfills"
  );
  assertSqlStatementParity(historicalGenerated.statements, generatedDdl);
}

async function assertInboxV2LatestGeneratedSchemaParity(
  migration,
  invariantBlock
) {
  const snapshotPath = "packages/db/drizzle/meta/0037_snapshot.json";
  const generated = await generateExpectedDrizzleMigration({
    workspaceRoot: process.cwd(),
    migrationDirectory,
    baseIndex: 36,
    targetIndex: 37
  });
  const historicalGenerated = withoutInboxV2Db010SchemaDelta(generated);
  const checkedInSnapshot = JSON.parse(await readFile(snapshotPath, "utf8"));
  assertDrizzleSnapshotParity(
    historicalGenerated.snapshot,
    checkedInSnapshot,
    snapshotPath
  );

  const checkedInStatements = splitMigrationStatements(migration.sql);
  const expectedInvariantStatements = splitMigrationStatements(
    invariantBlock.sql
  );
  if (expectedInvariantStatements.length !== 3) {
    throw new Error(
      `Inbox V2 DB-008 schema invariant must contain exactly one immutable function plus row and truncate triggers; found ${expectedInvariantStatements.length} statements.`
    );
  }
  if (checkedInStatements.length < expectedInvariantStatements.length) {
    throw new Error("Inbox V2 DB-008 migration is missing its invariant tail.");
  }
  const invariantStart =
    checkedInStatements.length - expectedInvariantStatements.length;
  assertExactSqlSequence(
    expectedInvariantStatements,
    checkedInStatements.slice(invariantStart),
    "Inbox V2 DB-008 invariant tail"
  );
  assertExactSqlSequence(
    historicalGenerated.statements,
    checkedInStatements.slice(0, invariantStart),
    "Inbox V2 DB-008 ordered generated migration prefix"
  );
}

function withoutInboxV2Db010SchemaDelta(generated) {
  const withoutSourceRegistry = withoutInboxV2Src010SchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceRegistry.snapshot);
  delete snapshot.tables[inboxV2ConversationIdentityFenceTableName];
  const timelineItem = snapshot.tables["public.inbox_v2_timeline_items"];
  if (!timelineItem?.indexes) {
    throw new Error(
      "Generated historical schema is missing Inbox V2 TimelineItem indexes."
    );
  }
  delete timelineItem.indexes[inboxV2EligibleActivityTailIndexName];

  const statements = withoutSourceRegistry.statements.filter(
    (statement) =>
      !statement.includes("inbox_v2_conversation_identity_fences") &&
      !statement.includes(inboxV2EligibleActivityTailIndexName)
  );
  return { snapshot, statements };
}

function withoutInboxV2Src010SchemaDelta(generated) {
  const withoutAuthorizedDomainCommand =
    withoutInboxV2Src011SchemaDelta(generated);
  const snapshot = structuredClone(withoutAuthorizedDomainCommand.snapshot);
  for (const tableName of inboxV2SourceRegistryTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceRegistryEnumNames) {
    delete snapshot.enums[enumName];
  }
  for (const table of Object.values(snapshot.tables)) {
    for (const constraintName of inboxV2SourceRegistryBaseConstraintNames) {
      delete table.foreignKeys?.[constraintName];
      delete table.uniqueConstraints?.[constraintName];
    }
  }
  const statements = withoutAuthorizedDomainCommand.statements.filter(
    (statement) =>
      !statement.includes("inbox_v2_source_registry_") &&
      !inboxV2SourceRegistryBaseConstraintNames.some((name) =>
        statement.includes(name)
      )
  );
  return { snapshot, statements };
}

function withoutInboxV2Src011SchemaDelta(generated) {
  const withoutSourceOnboardingResult =
    withoutInboxV2SourceOnboardingResultSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceOnboardingResult.snapshot);
  const mutationCommit =
    snapshot.tables["public.inbox_v2_auth_mutation_commits"];
  const constraintName = "inbox_v2_auth_mutation_commits_manifest_check";
  const constraint = mutationCommit?.checkConstraints?.[constraintName];
  if (!constraint) {
    throw new Error(
      "Generated historical schema is missing the authorization mutation manifest constraint."
    );
  }
  constraint.value =
    '"inbox_v2_auth_mutation_commits"."revision_effect_count" >= 1\n' +
    '        and "inbox_v2_auth_mutation_commits"."relation_write_count" >= 1\n' +
    '        and "inbox_v2_auth_mutation_commits"."projection_intent_count" >= 1\n' +
    '        and "inbox_v2_auth_mutation_commits"."revision_effect_digest_sha256" ~ \'^sha256:[0-9a-f]{64}$\'\n' +
    '        and "inbox_v2_auth_mutation_commits"."relation_write_digest_sha256" ~ \'^sha256:[0-9a-f]{64}$\'\n' +
    '        and "inbox_v2_auth_mutation_commits"."manifest_digest_sha256" ~ \'^sha256:[0-9a-f]{64}$\'';
  const statements = withoutSourceOnboardingResult.statements.filter(
    (statement) => !statement.includes(constraintName)
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceOnboardingResultSchemaDelta(generated) {
  const withoutSourceRawIngress =
    withoutInboxV2SourceRawIngressSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceRawIngress.snapshot);
  const resultTableName = "public.inbox_v2_source_onboarding_result_snapshots";
  delete snapshot.tables[resultTableName];

  const command = snapshot.tables["public.inbox_v2_auth_command_records"];
  const audit = snapshot.tables["public.inbox_v2_auth_audit_events"];
  if (
    !command?.columns ||
    !command.checkConstraints ||
    !audit?.checkConstraints
  ) {
    throw new Error(
      "Generated schema is missing source-onboarding result predecessor tables."
    );
  }
  delete command.columns.result_reference;

  const commandState =
    command.checkConstraints.inbox_v2_auth_command_records_state_check;
  const commandValues =
    command.checkConstraints.inbox_v2_auth_command_records_values_check;
  const auditValues =
    audit.checkConstraints.inbox_v2_auth_audit_events_reference_check;
  if (!commandState || !commandValues || !auditValues) {
    throw new Error(
      "Generated schema is missing source-onboarding result predecessor constraints."
    );
  }
  commandState.value = replaceExactSchemaFragment(
    commandState.value,
    '\n          and "inbox_v2_auth_command_records"."result_reference" is null',
    "",
    "authorized command pending result reference"
  );
  commandValues.value = replaceExactSchemaFragment(
    commandValues.value,
    'char_length("inbox_v2_auth_command_records"."client_mutation_id") between 1 and 512\n' +
      '        and "inbox_v2_auth_command_records"."client_mutation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._~:-]*$\'',
    'char_length("inbox_v2_auth_command_records"."client_mutation_id") between 1 and 256',
    "authorized command client mutation identifier"
  );
  commandValues.value = replaceExactSchemaFragment(
    commandValues.value,
    '\n        and ("inbox_v2_auth_command_records"."result_reference" is null or (\n' +
      '          jsonb_typeof("inbox_v2_auth_command_records"."result_reference") = \'object\'\n' +
      '          and "inbox_v2_auth_command_records"."result_reference" ?&\n' +
      "            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]\n" +
      '          and ("inbox_v2_auth_command_records"."result_reference" -\n' +
      "            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =\n" +
      "              '{}'::jsonb\n" +
      '          and "inbox_v2_auth_command_records"."result_reference"->>\'tenantId\' = "inbox_v2_auth_command_records"."tenant_id"\n' +
      "          and \"inbox_v2_auth_command_records\".\"result_reference\"->>'digest' ~ '^sha256:[0-9a-f]{64}$'\n" +
      "        ))",
    "",
    "authorized command canonical result reference"
  );
  auditValues.value = replaceExactSchemaFragment(
    auditValues.value,
    'char_length("inbox_v2_auth_audit_events"."client_mutation_id") between 1 and 512\n' +
      '        and "inbox_v2_auth_audit_events"."client_mutation_id" ~ \'^[A-Za-z0-9][A-Za-z0-9._~:-]*$\'',
    'char_length("inbox_v2_auth_audit_events"."client_mutation_id") between 1 and 256',
    "authorization audit client mutation identifier"
  );

  const generatedConstraintNames = [
    "inbox_v2_auth_audit_events_reference_check",
    "inbox_v2_auth_command_records_state_check",
    "inbox_v2_auth_command_records_values_check"
  ];
  const statements = withoutSourceRawIngress.statements.filter(
    (statement) =>
      !statement.includes("inbox_v2_source_onboarding_result_snapshots") &&
      !statement.includes('ADD COLUMN "result_reference"') &&
      !generatedConstraintNames.some((name) => statement.includes(name))
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceRawIngressSchemaDelta(generated) {
  const withoutSourceNormalization =
    withoutInboxV2SourceNormalizationSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceNormalization.snapshot);
  for (const tableName of inboxV2SourceRawIngressTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceRawIngressEnumNames) {
    delete snapshot.enums[enumName];
  }
  const statements = withoutSourceNormalization.statements.filter(
    (statement) => !statement.includes("inbox_v2_source_raw_")
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceNormalizationSchemaDelta(generated) {
  const withoutSourceIdentityResolution =
    withoutInboxV2SourceIdentityResolutionSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceIdentityResolution.snapshot);
  for (const tableName of inboxV2SourceNormalizationTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceNormalizationEnumNames) {
    delete snapshot.enums[enumName];
  }
  const statements = withoutSourceIdentityResolution.statements.filter(
    (statement) => !statement.includes("inbox_v2_source_normal")
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceIdentityResolutionSchemaDelta(generated) {
  const withoutSourceMessageReconciliation =
    withoutInboxV2SourceMessageReconciliationSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceMessageReconciliation.snapshot);
  for (const tableName of inboxV2SourceIdentityResolutionTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceIdentityResolutionEnumNames) {
    delete snapshot.enums[enumName];
  }
  const statements = withoutSourceMessageReconciliation.statements.filter(
    (statement) =>
      !statement.includes("inbox_v2_source_identity_observations") &&
      !statement.includes("inbox_v2_source_identity_assessments") &&
      !statement.includes("inbox_v2_source_identity_assessment_heads") &&
      !statement.includes("inbox_v2_source_identity_assessment_outcome") &&
      !statement.includes("inbox_v2_source_identity_assessment_confidence")
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceMessageReconciliationSchemaDelta(generated) {
  const withoutAtomicProviderIo =
    withoutInboxV2AtomicProviderIoSchemaDelta(generated);
  const snapshot = structuredClone(withoutAtomicProviderIo.snapshot);
  for (const tableName of inboxV2SourceMessageReconciliationTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceMessageReconciliationEnumNames) {
    delete snapshot.enums[enumName];
  }
  const reconciliationNames = [
    ...inboxV2SourceMessageReconciliationTableNames,
    ...inboxV2SourceMessageReconciliationEnumNames
  ].map((name) => name.slice("public.".length));
  const statements = withoutAtomicProviderIo.statements.filter(
    (statement) => !reconciliationNames.some((name) => statement.includes(name))
  );
  return { snapshot, statements };
}

function withoutInboxV2AtomicProviderIoSchemaDelta(generated) {
  const withoutTerminalPayload =
    withoutInboxV2OutboxTerminalPayloadSchemaDelta(generated);
  const snapshot = structuredClone(withoutTerminalPayload.snapshot);
  for (const tableName of inboxV2AtomicProviderIoTableNames) {
    delete snapshot.tables[tableName];
  }
  const tableNames = inboxV2AtomicProviderIoTableNames.map((tableName) =>
    tableName.slice("public.".length)
  );
  const statements = withoutTerminalPayload.statements.filter(
    (statement) =>
      !tableNames.some((tableName) => statement.includes(tableName))
  );
  return { snapshot, statements };
}

function withoutInboxV2OutboxTerminalPayloadSchemaDelta(generated) {
  const withoutSourceProcessingRuntime =
    withoutInboxV2SourceProcessingRuntimeSchemaDelta(generated);
  const snapshot = structuredClone(withoutSourceProcessingRuntime.snapshot);
  delete snapshot.tables[inboxV2OutboxTerminalPayloadTableName];

  const outcome = snapshot.tables["public.inbox_v2_outbox_outcomes"];
  const workItem = snapshot.tables["public.inbox_v2_outbox_work_items"];
  if (
    !outcome?.columns ||
    !outcome.checkConstraints ||
    !workItem?.checkConstraints
  ) {
    throw new Error(
      "Generated schema is missing the terminal-payload predecessor tables."
    );
  }
  delete outcome.columns.payload_reference_recorded;

  const outcomeValues =
    outcome.checkConstraints.inbox_v2_outbox_outcomes_values_check;
  const workItemValues =
    workItem.checkConstraints.inbox_v2_outbox_work_items_values_check;
  if (!outcomeValues || !workItemValues) {
    throw new Error(
      "Generated schema is missing the terminal-payload predecessor constraints."
    );
  }
  outcomeValues.value = replaceExactSchemaFragment(
    outcomeValues.value,
    '"inbox_v2_outbox_outcomes"."result_reference" is null',
    '("inbox_v2_outbox_outcomes"."result_reference" is null\n' +
      '          or jsonb_typeof("inbox_v2_outbox_outcomes"."result_reference") = \'object\')',
    "outbox outcome legacy result reference"
  );
  outcomeValues.value = replaceExactSchemaFragment(
    outcomeValues.value,
    '\n            and not "inbox_v2_outbox_outcomes"."payload_reference_recorded"',
    "",
    "outbox outcome retry payload marker"
  );
  workItemValues.value = replaceExactSchemaFragment(
    workItemValues.value,
    '("inbox_v2_outbox_work_items"."terminal_result_reference" is null\n' +
      "          or public.inbox_v2_auth_payload_reference_safe(\n" +
      '            "inbox_v2_outbox_work_items"."terminal_result_reference", "inbox_v2_outbox_work_items"."tenant_id"\n' +
      "          ))",
    '("inbox_v2_outbox_work_items"."terminal_result_reference" is null\n' +
      '          or jsonb_typeof("inbox_v2_outbox_work_items"."terminal_result_reference") = \'object\')',
    "outbox work-item legacy terminal result reference"
  );

  const generatedConstraintNames = [
    "inbox_v2_outbox_outcomes_values_check",
    "inbox_v2_outbox_work_items_values_check"
  ];
  const tableName = inboxV2OutboxTerminalPayloadTableName.slice(
    "public.".length
  );
  const statements = withoutSourceProcessingRuntime.statements
    .filter((statement) => {
      if (
        statement.includes(tableName) ||
        statement.includes('ADD COLUMN "payload_reference_recorded"')
      ) {
        return false;
      }
      return !(
        statement.trimStart().startsWith("ALTER TABLE") &&
        generatedConstraintNames.some((name) => statement.includes(name))
      );
    })
    .map((statement) => {
      if (statement.includes('CREATE TABLE "inbox_v2_outbox_outcomes"')) {
        let historical = replaceExactSchemaFragment(
          statement,
          '\n\t"payload_reference_recorded" boolean DEFAULT false NOT NULL,',
          "",
          "outbox outcome payload marker column DDL"
        );
        historical = replaceExactSchemaFragment(
          historical,
          '"inbox_v2_outbox_outcomes"."result_reference" is null',
          '("inbox_v2_outbox_outcomes"."result_reference" is null\n' +
            '          or jsonb_typeof("inbox_v2_outbox_outcomes"."result_reference") = \'object\')',
          "outbox outcome legacy result reference DDL"
        );
        return replaceExactSchemaFragment(
          historical,
          '\n            and not "inbox_v2_outbox_outcomes"."payload_reference_recorded"',
          "",
          "outbox outcome retry payload marker DDL"
        );
      }
      if (statement.includes('CREATE TABLE "inbox_v2_outbox_work_items"')) {
        return replaceExactSchemaFragment(
          statement,
          'and ("inbox_v2_outbox_work_items"."terminal_error_code" is null\n' +
            '          or char_length("inbox_v2_outbox_work_items"."terminal_error_code") between 3 and 256)\n' +
            '        and ("inbox_v2_outbox_work_items"."terminal_result_reference" is null\n' +
            "          or public.inbox_v2_auth_payload_reference_safe(\n" +
            '            "inbox_v2_outbox_work_items"."terminal_result_reference", "inbox_v2_outbox_work_items"."tenant_id"\n' +
            "          ))",
          'and ("inbox_v2_outbox_work_items"."terminal_error_code" is null\n' +
            '          or char_length("inbox_v2_outbox_work_items"."terminal_error_code") between 3 and 256)\n' +
            '        and ("inbox_v2_outbox_work_items"."terminal_result_reference" is null\n' +
            '          or jsonb_typeof("inbox_v2_outbox_work_items"."terminal_result_reference") = \'object\')',
          "outbox work-item legacy terminal result reference DDL"
        );
      }
      return statement;
    });
  return { snapshot, statements };
}

function withoutInboxV2MonotonicTimelineSchemaDelta(generated) {
  const withoutMsg002RerouteIntent =
    withoutInboxV2Msg002RerouteIntentSchemaDelta(generated);
  const snapshot = structuredClone(withoutMsg002RerouteIntent.snapshot);
  const subjectDetails =
    snapshot.tables["public.inbox_v2_timeline_subject_details"];
  if (!subjectDetails?.indexes?.[inboxV2MonotonicTimelineIndexName]) {
    throw new Error(
      "Generated schema is missing the MSG-001 system-event uniqueness index."
    );
  }
  delete subjectDetails.indexes[inboxV2MonotonicTimelineIndexName];

  const matchingStatements = withoutMsg002RerouteIntent.statements.filter(
    (statement) => statement.includes(inboxV2MonotonicTimelineIndexName)
  );
  if (matchingStatements.length !== 1) {
    throw new Error(
      `Generated MSG-001 schema must contain the system-event uniqueness index exactly once; found ${matchingStatements.length}.`
    );
  }
  const statements = withoutMsg002RerouteIntent.statements.filter(
    (statement) => !statement.includes(inboxV2MonotonicTimelineIndexName)
  );
  return { snapshot, statements };
}

function withoutInboxV2Msg002RerouteIntentSchemaDelta(generated) {
  const withoutConversationWorkHead =
    withoutInboxV2ConversationWorkHeadSchemaDelta(generated);
  const snapshot = structuredClone(withoutConversationWorkHead.snapshot);
  const route = snapshot.tables["public.inbox_v2_outbound_routes"];
  const constraintName = "inbox_v2_outbound_routes_selection_check";
  const constraint = route?.checkConstraints?.[constraintName];
  if (!constraint) {
    throw new Error(
      "Generated schema is missing the outbound-route selection constraint."
    );
  }
  constraint.value = replaceExactSchemaFragment(
    constraint.value,
    '\n            and coalesce((char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" #>> \'{originalDispatch,id}\') <= 256\n' +
      "    and \"inbox_v2_outbound_routes\".\"selection_intent_snapshot\" #>> '{originalDispatch,id}' ~ '^outbound_dispatch:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)\n" +
      "            and coalesce((\"inbox_v2_outbound_routes\".\"selection_intent_snapshot\" ->> 'expectedOriginalDispatchRevision' ~ '^[1-9][0-9]{0,18}$'\n" +
      "    and (\n" +
      '      char_length("inbox_v2_outbound_routes"."selection_intent_snapshot" ->> \'expectedOriginalDispatchRevision\') < 19\n' +
      "      or \"inbox_v2_outbound_routes\".\"selection_intent_snapshot\" ->> 'expectedOriginalDispatchRevision' <= '9223372036854775807'\n" +
      "    )), false)",
    "",
    "MSG-002 original Dispatch selection fences"
  );
  constraint.value = replaceExactSchemaFragment(
    constraint.value,
    "\n              'originalDispatch', jsonb_build_object(\n" +
      '                \'tenantId\', "inbox_v2_outbound_routes"."tenant_id",\n' +
      "                'kind', 'outbound_dispatch',\n" +
      "                'id', \"inbox_v2_outbound_routes\".\"selection_intent_snapshot\" #>> '{originalDispatch,id}'\n" +
      "              ),\n" +
      "              'expectedOriginalDispatchRevision',\n" +
      '                "inbox_v2_outbound_routes"."selection_intent_snapshot" ->> \'expectedOriginalDispatchRevision\',',
    "",
    "MSG-002 canonical reroute intent fields"
  );
  const statements = withoutConversationWorkHead.statements.filter(
    (statement) => !statement.includes(constraintName)
  );
  return { snapshot, statements };
}

function withoutInboxV2ConversationWorkHeadSchemaDelta(generated) {
  const withoutFileObject = withoutInboxV2FileObjectSchemaDelta(generated);
  const snapshot = structuredClone(withoutFileObject.snapshot);
  delete snapshot.tables[inboxV2ConversationWorkHeadTableName];
  delete snapshot.enums[inboxV2ConversationWorkHeadEnumName];
  const statements = withoutFileObject.statements.filter(
    (statement) =>
      !statement.includes("inbox_v2_conversation_work_heads") &&
      !statement.includes("inbox_v2_conversation_work_outcome")
  );
  return { snapshot, statements };
}

function withoutInboxV2FileObjectSchemaDelta(generated) {
  const migration = inboxV2FileObjectMigrations[0];
  if (!migration) {
    throw new Error("Missing Inbox V2 MSG-003 file/object migration.");
  }
  const finalizedStatements = splitMigrationStatements(migration.sql);
  if (
    finalizedStatements.length < 2 ||
    !finalizedStatements.at(-1)?.startsWith(`${inboxV2FileObjectMarker}\n`)
  ) {
    throw new Error(
      "Inbox V2 MSG-003 migration is missing its finalized invariant tail."
    );
  }
  const snapshot = structuredClone(generated.snapshot);
  for (const tableName of inboxV2FileObjectTableNames) {
    const qualifiedName = `public.${tableName}`;
    if (!snapshot.tables[qualifiedName]) {
      throw new Error(
        `Generated schema is missing MSG-003 table ${qualifiedName}.`
      );
    }
    delete snapshot.tables[qualifiedName];
  }
  for (const enumName of inboxV2FileObjectEnumNames) {
    const qualifiedName = `public.${enumName}`;
    if (!snapshot.enums[qualifiedName]) {
      throw new Error(
        `Generated schema is missing MSG-003 enum ${qualifiedName}.`
      );
    }
    delete snapshot.enums[qualifiedName];
  }
  const timelinePayloadName = "public.inbox_v2_timeline_content_payloads";
  const predecessorTimelinePayload =
    inboxV2FileObjectPredecessorSnapshot.tables[timelinePayloadName];
  if (!predecessorTimelinePayload || !snapshot.tables[timelinePayloadName]) {
    throw new Error(
      "Cannot restore the MSG-003 TimelineContent predecessor snapshot."
    );
  }
  snapshot.tables[timelinePayloadName] = structuredClone(
    predecessorTimelinePayload
  );
  const attachmentAnchorName = "public.inbox_v2_message_attachment_anchors";
  const predecessorAttachmentAnchor =
    inboxV2FileObjectPredecessorSnapshot.tables[attachmentAnchorName];
  if (!predecessorAttachmentAnchor || !snapshot.tables[attachmentAnchorName]) {
    throw new Error(
      "Cannot restore the MSG-003 MessageAttachmentAnchor predecessor snapshot."
    );
  }
  snapshot.tables[attachmentAnchorName] = structuredClone(
    predecessorAttachmentAnchor
  );
  const actionAttributionName = "public.inbox_v2_action_attributions";
  const predecessorActionAttribution =
    inboxV2FileObjectPredecessorSnapshot.tables[actionAttributionName];
  if (
    !predecessorActionAttribution ||
    !snapshot.tables[actionAttributionName]
  ) {
    throw new Error(
      "Cannot restore the MSG-003 action-attribution predecessor snapshot."
    );
  }
  snapshot.tables[actionAttributionName] = structuredClone(
    predecessorActionAttribution
  );
  const statements = removeExactSqlStatements(
    generated.statements,
    finalizedStatements.slice(0, -1),
    "Inbox V2 MSG-003 generated schema delta"
  );
  return { snapshot, statements };
}

function withoutInboxV2SourceProcessingRuntimeSchemaDelta(generated) {
  const withoutMonotonicTimeline =
    withoutInboxV2MonotonicTimelineSchemaDelta(generated);
  const snapshot = structuredClone(withoutMonotonicTimeline.snapshot);
  for (const tableName of inboxV2SourceProcessingRuntimeTableNames) {
    delete snapshot.tables[tableName];
  }
  for (const enumName of inboxV2SourceProcessingRuntimeEnumNames) {
    delete snapshot.enums[enumName];
  }
  const schemaNames = [
    ...inboxV2SourceProcessingRuntimeTableNames,
    ...inboxV2SourceProcessingRuntimeEnumNames
  ].map((name) => name.slice("public.".length));
  const rawEnvelope = snapshot.tables["public.inbox_v2_source_raw_envelopes"];
  const rawQuarantine =
    snapshot.tables["public.inbox_v2_source_raw_quarantines"];
  if (
    !rawEnvelope?.checkConstraints ||
    !rawQuarantine?.columns ||
    !rawQuarantine.checkConstraints ||
    !rawQuarantine.foreignKeys
  ) {
    throw new Error(
      "Generated schema is missing the SRC-008 raw-ingress predecessor tables."
    );
  }

  const envelopeIdentity =
    rawEnvelope.checkConstraints.inbox_v2_source_raw_envelopes_identity_check;
  const quarantineSafeValues =
    rawQuarantine.checkConstraints
      .inbox_v2_source_raw_quarantines_safe_values_check;
  if (!envelopeIdentity || !quarantineSafeValues) {
    throw new Error(
      "Generated schema is missing the SRC-008 raw-ingress predecessor constraints."
    );
  }
  envelopeIdentity.value = restoreInboxV2RawEnvelopeIdentityPredecessor(
    envelopeIdentity.value
  );
  quarantineSafeValues.value = restoreInboxV2RawQuarantineSafePredecessor(
    quarantineSafeValues.value
  );
  for (const columnName of [
    "event_identity_key_generation",
    "event_identity_hmac_key_secret_ref",
    "event_identity_guarantee_until"
  ]) {
    if (!(columnName in rawQuarantine.columns)) {
      throw new Error(
        `Generated schema is missing SRC-008 raw quarantine column ${columnName}.`
      );
    }
    delete rawQuarantine.columns[columnName];
  }
  if (
    !rawQuarantine.foreignKeys
      .inbox_v2_source_raw_quarantines_identity_secret_fk
  ) {
    throw new Error(
      "Generated schema is missing the SRC-008 raw quarantine secret FK."
    );
  }
  delete rawQuarantine.foreignKeys
    .inbox_v2_source_raw_quarantines_identity_secret_fk;

  const rawMutationNames = [
    "inbox_v2_source_raw_envelopes_identity_check",
    "inbox_v2_source_raw_quarantines_safe_values_check",
    "event_identity_key_generation",
    "event_identity_hmac_key_secret_ref",
    "event_identity_guarantee_until",
    "inbox_v2_source_raw_quarantines_identity_secret_fk"
  ];
  const statements = withoutMonotonicTimeline.statements
    .filter(
      (statement) => !schemaNames.some((name) => statement.includes(name))
    )
    .filter(
      (statement) =>
        !(
          statement.trimStart().startsWith("ALTER TABLE") &&
          rawMutationNames.some((name) => statement.includes(name))
        )
    )
    .map((statement) => {
      if (statement.includes('CREATE TABLE "inbox_v2_source_raw_envelopes"')) {
        return restoreInboxV2RawEnvelopeIdentityPredecessor(statement);
      }
      if (
        statement.includes('CREATE TABLE "inbox_v2_source_raw_quarantines"')
      ) {
        let historical = statement;
        for (const columnDdl of [
          '\n\t"event_identity_key_generation" text,',
          '\n\t"event_identity_hmac_key_secret_ref" text,',
          '\n\t"event_identity_guarantee_until" timestamp (3) with time zone,'
        ]) {
          historical = replaceExactSchemaFragment(
            historical,
            columnDdl,
            "",
            "SRC-008 raw quarantine additive column DDL"
          );
        }
        return restoreInboxV2RawQuarantineSafePredecessor(historical);
      }
      return statement;
    });
  return { snapshot, statements };
}

function restoreInboxV2RawEnvelopeIdentityPredecessor(source) {
  const table = '"inbox_v2_source_raw_envelopes"';
  let historical = replaceExactSchemaFragment(
    source,
    `        and char_length(${table}."safe_envelope_schema_id")`,
    `        and ${table}."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'\n        and char_length(${table}."safe_envelope_schema_id")`,
    "SRC-008 raw envelope identity predecessor position"
  );
  historical = replaceExactSchemaFragment(
    historical,
    `        and (\n          (${table}."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'\n            and ${table}."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')\n          or (${table}."event_identity_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'\n            and ${table}."safe_envelope_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$')\n        )`,
    `        and ${table}."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'`,
    "SRC-008 raw envelope HMAC identity pair"
  );
  return historical;
}

function restoreInboxV2RawQuarantineSafePredecessor(source) {
  const table = '"inbox_v2_source_raw_quarantines"';
  const identityStart = `        and (\n          (${table}."event_identity_digest_sha256" is null`;
  const identityEnd = `        and (${table}."idempotency_key_digest_sha256" is null`;
  let historical = replaceExactSchemaSpan(
    source,
    identityStart,
    identityEnd,
    `        and (${table}."event_identity_digest_sha256" is null\n          or ${table}."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')\n`,
    "SRC-008 raw quarantine keyed identity block"
  );
  for (const columnName of [
    "safe_envelope_digest_sha256",
    "existing_safe_envelope_digest_sha256",
    "existing_event_identity_digest_sha256"
  ]) {
    const column = `${table}."${columnName}"`;
    historical = replaceExactSchemaFragment(
      historical,
      `(${column} ~ '^sha256:[0-9a-f]{64}$' or ${column} ~ '^hmac-sha256:[0-9a-f]{64}$')`,
      `${column} ~ '^sha256:[0-9a-f]{64}$'`,
      `SRC-008 raw quarantine ${columnName} HMAC extension`
    );
  }
  return historical;
}

function assertInboxV2FoundationMigration(migration) {
  if (!migration) {
    console.error("DB schema has no SQL migrations.");
    process.exit(1);
  }

  const requiredFragments = [
    inboxV2FoundationMarker,
    inboxV2FoundationPreflightMarker,
    "migration.tenant_edge_invalid",
    "create or replace function public.inbox_v2_assert_account_identity_transition(",
    "create constraint trigger inbox_v2_account_provisional_key_induction_trigger",
    "create constraint trigger inbox_v2_account_identity_verified_snapshot_trigger",
    "create constraint trigger inbox_v2_account_identity_alias_exact_trigger",
    "create or replace function public.inbox_v2_assert_binding_evidence_set_integrity(",
    "create constraint trigger inbox_v2_binding_evidence_references_integrity",
    "add constraint inbox_v2_binding_snapshots_transition_fk",
    "create or replace function public.inbox_v2_assert_source_thread_binding_integrity(",
    "create constraint trigger inbox_v2_binding_snapshots_integrity",
    "create or replace function public.inbox_v2_source_occurrence_guard_insert(",
    "create or replace function public.inbox_v2_source_occurrence_reject_immutable(",
    "create or replace function public.inbox_v2_assert_source_occurrence_children(",
    "create or replace function public.inbox_v2_source_occurrence_deferred_children(",
    "create trigger inbox_v2_source_occurrences_insert_guard_trigger",
    "create trigger inbox_v2_source_occurrences_immutable_trigger",
    "create trigger inbox_v2_occurrence_provider_references_immutable_trigger",
    "create trigger inbox_v2_occurrence_provider_timestamps_immutable_trigger",
    "create constraint trigger inbox_v2_source_occurrences_children_constraint",
    "create constraint trigger inbox_v2_occurrence_provider_references_constraint",
    "create constraint trigger inbox_v2_occurrence_provider_timestamps_constraint",
    "create or replace function public.inbox_v2_provider_roster_guard_insert(",
    "create or replace function public.inbox_v2_provider_roster_member_guard_insert(",
    "create or replace function public.inbox_v2_provider_roster_reject_immutable(",
    "create or replace function public.inbox_v2_assert_provider_roster_member_set(",
    "create or replace function public.inbox_v2_provider_roster_deferred_member_set(",
    "create trigger inbox_v2_provider_roster_insert_guard_trigger",
    "create trigger inbox_v2_provider_roster_member_insert_guard_trigger",
    "create trigger inbox_v2_provider_roster_immutable_trigger",
    "create trigger inbox_v2_provider_roster_member_immutable_trigger",
    "create constraint trigger inbox_v2_provider_roster_member_set_constraint",
    "create or replace function public.inbox_v2_assert_conversation_membership_head(",
    "create or replace function public.inbox_v2_assert_conversation_membership_projection(",
    "create or replace function public.inbox_v2_assert_conversation_membership_commit(",
    "create or replace function public.inbox_v2_assert_participant_membership_episode(",
    "create or replace function public.inbox_v2_provider_membership_ordering_head_guard(",
    "inbox_v2_provider_membership_ordering_heads_pk",
    "inbox_v2_provider_membership_ordering_heads_values_check",
    "inbox_v2_provider_membership_ordering_heads_participant_fk",
    "inbox_v2_provider_membership_ordering_heads_binding_fk",
    "inbox_v2_provider_membership_ordering_heads_identity_fk",
    "inbox_v2_provider_membership_ordering_heads_episode_fk",
    "inbox_v2_provider_membership_ordering_heads_transition_fk",
    "create trigger inbox_v2_conversations_transport_immutable_trigger",
    "create trigger inbox_v2_participant_membership_episodes_insert_guard_trigger",
    "create trigger inbox_v2_provider_membership_ordering_heads_guard_trigger",
    "create constraint trigger inbox_v2_conversations_membership_head_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_membership_heads_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_membership_commits_constraint_trigger",
    "create constraint trigger inbox_v2_participant_membership_episodes_constraint_trigger",
    "create constraint trigger inbox_v2_participant_membership_transitions_constraint_trigger",
    "create constraint trigger inbox_v2_employees_internal_membership_constraint_trigger",
    "create or replace function public.inbox_v2_assert_client_merge_commit(",
    "create or replace function public.inbox_v2_assert_client_merge_node_exists(",
    "create trigger inbox_v2_tenants_client_merge_head_bootstrap_trigger",
    "create trigger inbox_v2_clients_merge_node_bootstrap_trigger",
    "create constraint trigger inbox_v2_client_merge_node_states_constraint_trigger\nafter insert or update or delete on public.inbox_v2_client_merge_node_states",
    "create constraint trigger inbox_v2_client_merge_redirects_constraint_trigger",
    "create or replace function public.inbox_v2_assert_conversation_client_link_episode(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_evidence(",
    "create or replace function public.inbox_v2_conversation_client_link_assert_current_policy(",
    "create or replace function public.inbox_v2_conversation_client_link_assert_employee_at(",
    "create or replace function public.inbox_v2_conversation_client_link_deferred_claim_revocation(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_transition(",
    "create or replace function public.inbox_v2_assert_conversation_client_link_head(",
    "create trigger inbox_v2_conversation_client_link_evidence_insert_guard_trigger",
    "create trigger inbox_v2_conversation_client_link_evidence_immutable_trigger",
    "create trigger inbox_v2_conversation_client_links_insert_guard_trigger",
    "create trigger inbox_v2_conversation_client_links_update_guard_trigger",
    "create trigger inbox_v2_conversation_client_link_transitions_insert_guard_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_heads_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_transitions_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_links_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_roles_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_evidence_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_contact_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_operations_constraint_trigger",
    "create constraint trigger inbox_v2_conversation_client_link_claim_revocation_constraint_trigger",
    "inbox_v2_client_links_linked_policy_authority_fk",
    "inbox_v2_client_links_verify_policy_authority_fk",
    "inbox_v2_client_links_ended_policy_authority_fk",
    "inbox_v2_client_link_transitions_policy_authority_fk",
    "inbox_v2_conversation_client_links_linked_employee_fk",
    "inbox_v2_conversation_client_links_ended_employee_fk",
    "inbox_v2_conversation_client_link_transitions_employee_fk",
    "inbox_v2_client_link_evidence_pk",
    "inbox_v2_client_link_evidence_ordinal_check",
    "inbox_v2_client_link_evidence_kind_check",
    "inbox_v2_client_link_evidence_link_fk",
    "inbox_v2_client_link_evidence_claim_fk",
    "inbox_v2_client_link_evidence_contact_fk",
    "inbox_v2_client_link_evidence_participant_fk",
    "inbox_v2_client_link_evidence_raw_fk",
    "inbox_v2_client_link_evidence_normalized_fk",
    "inbox_v2_client_link_evidence_occurrence_fk",
    "create or replace function public.inbox_v2_source_identity_claim_assert_identity(",
    "create or replace function public.inbox_v2_source_identity_claim_assert_claim(",
    "create or replace function public.inbox_v2_source_identity_claim_assert_transition(",
    "create or replace function public.inbox_v2_source_identity_claim_guard_transition_insert(",
    "inbox_v2_identity_claim_evidence_occurrence_actor_fk",
    "inbox_v2_identity_claim_evidence_roster_member_fk",
    "inbox_v2_source_occurrences_actor_evidence_unique",
    "inbox_v2_provider_roster_member_identity_unique",
    "inbox_v2_identity_claims_policy_authority_fk",
    "inbox_v2_identity_claim_transition_policy_authority_fk",
    "inbox_v2.source_identity_claim_policy_authority_invalid",
    "create trigger inbox_v2_source_identity_claim_bootstrap_head_trigger",
    "create trigger inbox_v2_source_identity_claim_transition_insert_trigger",
    "create constraint trigger inbox_v2_source_identity_claim_identity_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_head_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_claim_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_evidence_constraint",
    "create constraint trigger inbox_v2_source_identity_claim_transition_constraint",
    "create or replace function public.inbox_v2_tenant_policy_version_guard(",
    "create or replace function public.inbox_v2_tenant_policy_activation_transition_guard(",
    "create or replace function public.inbox_v2_tenant_policy_activation_head_guard(",
    "create or replace function public.inbox_v2_assert_tenant_policy_transition_materialized(",
    "inbox_v2_tenant_policy_transition_exact_authority_unique",
    "inbox_v2_tenant_policy_versions_approver_fk",
    "inbox_v2_tenant_policy_activation_heads_activator_fk",
    "inbox_v2_tenant_policy_activation_heads_revoker_fk",
    "inbox_v2_tenant_policy_activation_heads_transition_fk",
    "inbox_v2_tenant_policy_activation_transitions_actor_fk",
    "inbox_v2_source_occurrences_binding_snapshot_fk",
    "inbox_v2_source_occurrences_provider_identity_fk",
    "inbox_v2_provider_roster_binding_snapshot_fk",
    "inbox_v2_provider_roster_member_identity_fk",
    "create trigger inbox_v2_tenant_policy_versions_guard_trigger",
    "create trigger inbox_v2_tenant_policy_activation_transitions_guard_trigger",
    "create trigger inbox_v2_tenant_policy_activation_heads_guard_trigger",
    "create constraint trigger inbox_v2_tenant_policy_transition_materialized_constraint"
  ];
  for (const fragment of requiredFragments) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required Inbox V2 SQL: ${fragment}`
      );
      process.exit(1);
    }
  }

  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2FoundationMarker,
    preflightMarker: inboxV2FoundationPreflightMarker,
    invariantBlocks: inboxV2FoundationInvariantBlocks,
    preflightDescription: "tenant-edge"
  });

  const firstForeignKeyIndex = migration.sql.search(
    /ADD CONSTRAINT "[^"]+" FOREIGN KEY/
  );
  for (const constraintName of [
    "clients_tenant_id_unique",
    "client_contacts_tenant_id_unique",
    "employees_tenant_id_unique",
    "inbox_v2_conversations_tenant_id_shape_unique",
    "normalized_inbound_events_tenant_id_unique",
    "normalized_inbound_events_tenant_id_connection_unique",
    "normalized_inbound_events_tenant_id_account_unique",
    "raw_inbound_events_tenant_id_unique",
    "raw_inbound_events_tenant_id_connection_unique",
    "raw_inbound_events_tenant_id_account_unique",
    "raw_inbound_events_tenant_id_account_scope_unique",
    "source_accounts_tenant_id_unique",
    "source_accounts_tenant_id_connection_unique",
    "source_connections_tenant_id_unique"
  ]) {
    const constraintIndex = migration.sql.indexOf(
      `ADD CONSTRAINT "${constraintName}" UNIQUE`
    );
    if (
      firstForeignKeyIndex < 0 ||
      constraintIndex < 0 ||
      constraintIndex > firstForeignKeyIndex
    ) {
      console.error(
        `${migration.fileName} must create parent key ${constraintName} before dependent foreign keys.`
      );
      process.exit(1);
    }
  }

  for (const triggerName of [
    "inbox_v2_account_provisional_key_induction_trigger",
    "inbox_v2_account_identity_alias_exact_trigger",
    "inbox_v2_account_identity_verified_snapshot_trigger",
    "inbox_v2_binding_evidence_references_integrity",
    "inbox_v2_binding_snapshots_integrity",
    "inbox_v2_source_occurrences_children_constraint",
    "inbox_v2_occurrence_provider_references_constraint",
    "inbox_v2_occurrence_provider_timestamps_constraint",
    "inbox_v2_provider_roster_member_set_constraint",
    "inbox_v2_conversations_membership_head_constraint_trigger",
    "inbox_v2_conversation_membership_heads_constraint_trigger",
    "inbox_v2_conversation_membership_commits_constraint_trigger",
    "inbox_v2_participant_membership_episodes_constraint_trigger",
    "inbox_v2_participant_membership_transitions_constraint_trigger",
    "inbox_v2_employees_internal_membership_constraint_trigger",
    "inbox_v2_tenants_client_merge_head_constraint_trigger",
    "inbox_v2_client_merge_graph_heads_constraint_trigger",
    "inbox_v2_clients_merge_node_constraint_trigger",
    "inbox_v2_client_merge_node_states_constraint_trigger",
    "inbox_v2_client_merge_redirects_constraint_trigger",
    "inbox_v2_conversation_client_link_heads_constraint_trigger",
    "inbox_v2_conversation_client_link_transitions_constraint_trigger",
    "inbox_v2_conversation_client_links_constraint_trigger",
    "inbox_v2_conversation_client_link_roles_constraint_trigger",
    "inbox_v2_conversation_client_link_operations_constraint_trigger",
    "inbox_v2_conversation_client_link_claim_revocation_constraint_trigger",
    "inbox_v2_conversation_client_link_evidence_constraint_trigger",
    "inbox_v2_conversation_client_link_contact_constraint_trigger",
    "inbox_v2_source_identity_claim_identity_constraint",
    "inbox_v2_source_identity_claim_head_constraint",
    "inbox_v2_source_identity_claim_claim_constraint",
    "inbox_v2_source_identity_claim_evidence_constraint",
    "inbox_v2_source_identity_claim_transition_constraint",
    "inbox_v2_tenant_policy_transition_materialized_constraint"
  ]) {
    const triggerPattern = new RegExp(
      `create constraint trigger ${triggerName}[\\s\\S]*?deferrable initially deferred[\\s\\S]*?execute function`,
      "i"
    );
    if (!triggerPattern.test(migration.sql)) {
      console.error(
        `${migration.fileName} must keep ${triggerName} deferrable and initially deferred.`
      );
      process.exit(1);
    }
  }
}

function assertInboxV2WorkItemMigration(migration) {
  if (!migration.fileName.startsWith("0030_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 WorkItem migration at index 0030.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2WorkItemMarker,
    preflightMarker: inboxV2WorkItemPreflightMarker,
    invariantBlocks: inboxV2WorkItemInvariantBlocks,
    preflightDescription: "WorkItem"
  });
  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "org_units_tenant_id_unique",
        "teams_tenant_id_unique",
        "work_queues_tenant_id_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

function assertInboxV2TimelineMessageMigration(migration, invariantBlocks) {
  if (!migration.fileName.startsWith("0031_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 Timeline/Message migration at index 0031.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2TimelineMessageMarker,
    preflightMarker: inboxV2TimelineMessagePreflightMarker,
    invariantBlocks,
    preflightDescription: "Timeline/Message"
  });
  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "event_store_tenant_id_unique",
        "files_tenant_id_unique",
        "inbox_v2_messages_content_unique",
        "inbox_v2_messages_revision_unique",
        "inbox_v2_timeline_items_revision_unique",
        "inbox_v2_timeline_items_subject_unique",
        "inbox_v2_timeline_items_sequence_unique",
        "inbox_v2_source_thread_bindings_owner_account_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

function getInboxV2Msg002FunctionTransforms() {
  return Object.freeze([
    Object.freeze({
      slug: "core_coherence",
      owner: "timeline",
      definitionSignature: "public.inbox_v2_tm_core_coherence()",
      regprocedureSignature: "public.inbox_v2_tm_core_coherence()",
      predecessorConstant: "core_predecessor_md5",
      successorConstant: "core_successor_md5",
      replacements: Object.freeze([
        Object.freeze({
          predecessor: "core:message.send_external",
          successor: "core:message.reply_external"
        })
      ]),
      restoreReplacements: Object.freeze([
        Object.freeze({
          predecessor: "when 'none' then 'core:message.reply_external'",
          successor: "when 'none' then 'core:message.send_external'"
        })
      ])
    }),
    Object.freeze({
      slug: "route_action",
      owner: "timeline",
      definitionSignature: "public.inbox_v2_tm_outbound_route_action_valid(",
      regprocedureSignature:
        "public.inbox_v2_tm_outbound_route_action_valid(text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,bigint,text,text,bigint,text,text,timestamptz,text,bigint,text,boolean)",
      predecessorConstant: "route_action_predecessor_md5",
      successorConstant: "route_action_successor_md5",
      replacements: Object.freeze([
        Object.freeze({
          predecessor:
            "       and binding_snapshot.runtime_health_state = 'ready'",
          successor: String.raw`       and binding_snapshot.runtime_health_state::text =
         route_row.runtime_observation_snapshot #>> '{state}'
       and binding_snapshot.runtime_health_revision::text =
         route_row.runtime_observation_snapshot #>> '{revision}'
       and binding_snapshot.runtime_health_checked_at =
         (route_row.runtime_observation_snapshot #>>
           '{observedAt}')::timestamptz`
        }),
        Object.freeze({
          predecessor: String.raw`       and route_row.runtime_observation_snapshot #>> '{state}' = 'ready'
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at`,
          successor: String.raw`       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at`
        })
      ])
    }),
    Object.freeze({
      slug: "domain_mutation",
      owner: "atomic",
      definitionSignature: "public.inbox_v2_auth_domain_mutation_coherence()",
      regprocedureSignature: "public.inbox_v2_auth_domain_mutation_coherence()",
      predecessorConstant: "domain_mutation_predecessor_md5",
      successorConstant: "domain_mutation_successor_md5",
      replacements: Object.freeze([
        Object.freeze({
          predecessor: String.raw`  if v_command.command_type_id in ('core:message.send', 'core:message.receive')
  then`,
          successor: String.raw`  if v_command.command_type_id in (
    'core:message.send',
    'core:message.receive',
    'core:source.dispatch.reroute'
  )
  then`
        }),
        Object.freeze({
          predecessor: String.raw`         v_command.command_type_id = 'core:message.send'
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`,
          successor: String.raw`         v_command.command_type_id in (
           'core:message.send',
           'core:source.dispatch.reroute'
         )
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )`
        }),
        Object.freeze({
          predecessor: extractInboxV2Msg002MigrationFragment(
            "domain_mutation_dispatch_predecessor_fragment"
          ),
          successor: extractInboxV2Msg002MigrationFragment(
            "domain_mutation_dispatch_successor_fragment"
          )
        }),
        Object.freeze({
          predecessor: extractInboxV2Msg002MigrationFragment(
            "domain_mutation_audit_predecessor_fragment"
          ),
          successor: extractInboxV2Msg002MigrationFragment(
            "domain_mutation_audit_successor_fragment"
          )
        })
      ])
    }),
    Object.freeze({
      slug: "atomic_message",
      owner: "atomic",
      definitionSignature:
        "public.inbox_v2_atomic_message_creation_coherence()",
      regprocedureSignature:
        "public.inbox_v2_atomic_message_creation_coherence()",
      predecessorConstant: "atomic_message_predecessor_md5",
      successorConstant: "atomic_message_successor_md5",
      replacements: Object.freeze([
        Object.freeze({
          predecessor: String.raw`         message_row.origin_kind = 'hulee_external'
         and command_row.command_type_id = 'core:message.send'
         and (`,
          successor: String.raw`         message_row.origin_kind = 'hulee_external'
         and (
           (
             command_row.command_type_id = 'core:message.send'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind <> 'explicit_reroute'
             )
           )
           or (
             command_row.command_type_id = 'core:source.dispatch.reroute'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind = 'explicit_reroute'
             )
           )
         )
         and (`
        })
      ])
    }),
    Object.freeze({
      slug: "atomic_outbound",
      owner: "atomic",
      definitionSignature:
        "public.inbox_v2_atomic_outbound_creation_coherence()",
      regprocedureSignature:
        "public.inbox_v2_atomic_outbound_creation_coherence()",
      predecessorConstant: "atomic_outbound_predecessor_md5",
      successorConstant: "atomic_outbound_successor_md5",
      replacements: Object.freeze([
        Object.freeze({
          predecessor: extractInboxV2Msg002MigrationFragment(
            "atomic_outbound_predecessor_fragment"
          ),
          successor: extractInboxV2Msg002MigrationFragment(
            "atomic_outbound_successor_fragment"
          )
        })
      ])
    })
  ]);
}

function extractInboxV2Msg002MigrationFragment(constantName) {
  const migration = inboxV2OutboundSendAuthorityMigrations[0];
  if (!migration) {
    throw new Error("Missing Inbox V2 MSG-002 migration.");
  }
  const pattern = new RegExp(
    `${escapeRegExp(constantName)}\\s+constant\\s+text\\s*:=\\s*\\$fragment\\$([\\s\\S]*?)\\$fragment\\$`,
    "u"
  );
  const match = pattern.exec(migration.sql.replaceAll("\r\n", "\n"));
  if (!match?.[1]) {
    throw new Error(`Missing MSG-002 fragment constant ${constantName}.`);
  }
  return match[1];
}

function assertInboxV2OutboundSendAuthorityMigration(
  migration,
  timelineMessageMigration,
  atomicProviderIoMigration
) {
  if (migration.fileName !== inboxV2OutboundSendAuthorityFileName) {
    throw new Error(
      `${migration.fileName} must be the Inbox V2 outbound-send-authority migration at index 0050.`
    );
  }
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length !== 1) {
    throw new Error(
      `${migration.fileName} must contain exactly one guarded function-rewrite statement.`
    );
  }
  const requiredFragments = [
    inboxV2OutboundSendAuthorityMarker,
    "do $migration$",
    "old_occurrence_count",
    "new_occurrence_count"
  ];
  for (const transform of getInboxV2Msg002FunctionTransforms()) {
    const ownerMigration =
      transform.owner === "timeline"
        ? timelineMessageMigration
        : atomicProviderIoMigration;
    const predecessorBody = extractMigrationFunctionBody(
      ownerMigration.sql,
      transform.definitionSignature
    );
    const successorBody = applyInboxV2Msg002Replacements(
      predecessorBody,
      transform.replacements,
      `MSG-002 ${transform.slug} predecessor body`
    );
    const predecessorMd5 = createHash("md5")
      .update(predecessorBody)
      .digest("hex");
    const successorMd5 = createHash("md5").update(successorBody).digest("hex");
    requiredFragments.push(
      transform.regprocedureSignature,
      `${transform.predecessorConstant} constant text :=`,
      `'${predecessorMd5}'`,
      `${transform.successorConstant} constant text :=`,
      `'${successorMd5}'`,
      `inbox_v2.msg002_${transform.slug}_missing`,
      `inbox_v2.msg002_${transform.slug}_successor_mismatch`,
      `inbox_v2.msg002_${transform.slug}_unreviewed_shape`,
      ...transform.replacements.flatMap(({ predecessor, successor }) => [
        predecessor,
        successor
      ])
    );
  }
  for (const fragment of requiredFragments) {
    if (!migration.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} is missing outbound-send authority SQL: ${fragment}.`
      );
    }
  }
}

function assertInboxV2ConversationWorkHeadMigration(migration, invariantBlock) {
  if (migration.fileName !== inboxV2ConversationWorkHeadFileName) {
    throw new Error(
      `${migration.fileName} must be the Conversation Work head migration at index 0052.`
    );
  }
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length !== 17) {
    throw new Error(
      `${migration.fileName} must contain four generated DDL statements and thirteen reviewed Conversation Work head statements.`
    );
  }
  const markerIndex = migration.sql.indexOf(inboxV2ConversationWorkHeadMarker);
  if (
    markerIndex < 0 ||
    migration.sql.indexOf(
      inboxV2ConversationWorkHeadMarker,
      markerIndex + inboxV2ConversationWorkHeadMarker.length
    ) >= 0
  ) {
    throw new Error(
      `${migration.fileName} must contain its Conversation Work head marker exactly once.`
    );
  }
  const normalizedTail = migration.sql
    .slice(markerIndex)
    .replaceAll("--> statement-breakpoint", " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  const normalizedInvariant = invariantBlock.sql
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  if (normalizedTail !== normalizedInvariant) {
    throw new Error(
      `${migration.fileName} is stale against ${invariantBlock.name}.`
    );
  }
  for (const fragment of [
    'CREATE TYPE "public"."inbox_v2_conversation_work_outcome"',
    'CREATE TABLE "inbox_v2_conversation_work_heads"',
    'ADD CONSTRAINT "inbox_v2_conversation_work_heads_conversation_fk"',
    'CREATE INDEX "inbox_v2_conversation_work_heads_state_idx"',
    '"pending_materialization_ordinal" bigint',
    "\"current_outcome\" = 'pending_intake'",
    "lock table public.inbox_v2_conversations,",
    "on conflict (tenant_id, conversation_id) do update",
    "create or replace function public.inbox_v2_conversation_work_head_guard()",
    "create or replace function public.inbox_v2_conversation_work_head_bootstrap()",
    "create or replace function public.inbox_v2_conversation_work_head_advance()",
    "create or replace function public.inbox_v2_conversation_work_head_coherence()",
    "create trigger inbox_v2_conversations_work_head_insert_trigger",
    "create constraint trigger inbox_v2_conversation_work_heads_coherence_constraint",
    "deferrable initially deferred",
    "set search_path = pg_catalog, public, pg_temp"
  ]) {
    if (!migration.sql.toLowerCase().includes(fragment.toLowerCase())) {
      throw new Error(
        `${migration.fileName} is missing Conversation Work head SQL: ${fragment}.`
      );
    }
  }
  if (/\bDROP\s+(?:TABLE|COLUMN|TYPE)\b/iu.test(migration.sql)) {
    throw new Error(`${migration.fileName} must remain additive.`);
  }
}

function assertInboxV2FileObjectMigration(
  migration,
  invariantBlock,
  attachmentAuthorizationInvariantSql,
  anchorInvariantBlock
) {
  if (migration.fileName !== inboxV2FileObjectFileName) {
    throw new Error(
      `${migration.fileName} must be the typed-content/file-object migration at index 0053.`
    );
  }
  const statements = splitMigrationStatements(migration.sql);
  if (statements.length < 2) {
    throw new Error(
      `${migration.fileName} is missing generated DDL or its schema-owned invariant tail.`
    );
  }
  assertExactSqlSequence(
    [
      `${inboxV2FileObjectMarker}\n${invariantBlock.sql}\n\n${attachmentAuthorizationInvariantSql}\n\n${anchorInvariantBlock.sql}`
    ],
    statements.slice(-1),
    "Inbox V2 MSG-003 file/object invariant tail"
  );
  if (
    migration.sql.split(inboxV2FileObjectMarker).length - 1 !== 1 ||
    !statements.at(-1)?.startsWith(`${inboxV2FileObjectMarker}\n`)
  ) {
    throw new Error(
      `${migration.fileName} must contain exactly one finalization marker at the start of its exact last statement.`
    );
  }

  const generatedStatements = statements.slice(0, -1);
  const createdTables = generatedStatements
    .map((statement) => /^CREATE TABLE "([^"]+)"/u.exec(statement)?.[1])
    .filter(Boolean)
    .sort();
  const createdEnums = generatedStatements
    .map(
      (statement) => /^CREATE TYPE "public"\."([^"]+)"/u.exec(statement)?.[1]
    )
    .filter(Boolean)
    .sort();
  assertExactStringSequence(
    [...inboxV2FileObjectTableNames].sort(),
    createdTables,
    "Inbox V2 MSG-003 file/object table inventory"
  );
  assertExactStringSequence(
    [...inboxV2FileObjectEnumNames].sort(),
    createdEnums,
    "Inbox V2 MSG-003 file/object enum inventory"
  );
  const dispatchPlanStatements = generatedStatements.filter((statement) =>
    statement.startsWith('CREATE TABLE "inbox_v2_file_outbound_dispatch_plans"')
  );
  const requiredDispatchPlanFragments = [
    '"adapter_contract_declaration_revision" bigint NOT NULL',
    '"adapter_loaded_by_trusted_service_id" text NOT NULL',
    '"adapter_loaded_at" timestamp (3) with time zone NOT NULL',
    '"inbox_v2_file_outbound_dispatch_plans"."adapter_contract_declaration_revision" >= 1',
    '"inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_by_trusted_service_id"',
    'isfinite("inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_at")',
    '"inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_at" <= "inbox_v2_file_outbound_dispatch_plans"."created_at"'
  ];
  if (
    dispatchPlanStatements.length !== 1 ||
    requiredDispatchPlanFragments.some(
      (fragment) => !dispatchPlanStatements[0].includes(fragment)
    )
  ) {
    throw new Error(
      `${migration.fileName} must persist and validate the complete immutable adapter load snapshot.`
    );
  }

  for (const columnName of inboxV2FileObjectNullableBridgeColumns) {
    const expected =
      `ALTER TABLE "inbox_v2_timeline_content_payloads" ` +
      `ADD COLUMN "${columnName}" text;`;
    if (
      generatedStatements.filter(
        (statement) => normalizeSqlStatement(statement) === expected
      ).length !== 1
    ) {
      throw new Error(
        `${migration.fileName} must add nullable N-1 bridge column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }
  for (const columnName of inboxV2FileObjectNullableRevisionBridgeColumns) {
    const expected =
      `ALTER TABLE "inbox_v2_timeline_content_payloads" ` +
      `ADD COLUMN "${columnName}" bigint;`;
    if (
      generatedStatements.filter(
        (statement) => normalizeSqlStatement(statement) === expected
      ).length !== 1
    ) {
      throw new Error(
        `${migration.fileName} must add nullable N-1 bridge column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }
  for (const [
    columnName,
    sqlType
  ] of inboxV2FileObjectNullableAttachmentAnchorColumns) {
    const expected =
      `ALTER TABLE "inbox_v2_message_attachment_anchors" ` +
      `ADD COLUMN "${columnName}" ${sqlType};`;
    if (
      generatedStatements.filter(
        (statement) => normalizeSqlStatement(statement) === expected
      ).length !== 1
    ) {
      throw new Error(
        `${migration.fileName} must add nullable N-1 attachment-anchor column ${columnName} exactly once without DEFAULT or NOT NULL.`
      );
    }
  }

  const expectedDrop =
    `ALTER TABLE "inbox_v2_timeline_content_payloads" DROP CONSTRAINT ` +
    `"${inboxV2FileObjectReplacedCheckConstraint}";`;
  const expectedCauseEventDrop =
    `ALTER TABLE "inbox_v2_action_attributions" DROP CONSTRAINT ` +
    `"${inboxV2FileObjectReplacedCauseEventForeignKey}";`;
  const dropStatements = generatedStatements.filter((statement) =>
    /\bDROP\b/iu.test(statement)
  );
  if (
    dropStatements.length !== 2 ||
    !dropStatements.some(
      (statement) => normalizeSqlStatement(statement) === expectedDrop
    ) ||
    !dropStatements.some(
      (statement) => normalizeSqlStatement(statement) === expectedCauseEventDrop
    )
  ) {
    throw new Error(
      `${migration.fileName} may only replace the reviewed legacy TimelineContent payload CHECK and action-attribution cause-event FK.`
    );
  }
  const widenedShapeChecks = generatedStatements.filter((statement) =>
    statement.includes(
      `ADD CONSTRAINT "${inboxV2FileObjectReplacedCheckConstraint}" CHECK`
    )
  );
  if (
    widenedShapeChecks.length !== 1 ||
    !widenedShapeChecks[0].includes(
      '"attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id"'
    ) ||
    !widenedShapeChecks[0].includes(
      'coalesce("inbox_v2_timeline_content_payloads"."extension_payload_file_id", "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id")'
    )
  ) {
    throw new Error(
      `${migration.fileName} must replace the legacy payload CHECK with the reviewed V1-or-V2 widened predicate.`
    );
  }
  const causeEventIndexes = generatedStatements.filter((statement) =>
    statement.includes(`CREATE INDEX "${inboxV2FileObjectCauseEventIndex}"`)
  );
  if (
    causeEventIndexes.length !== 1 ||
    !causeEventIndexes[0].includes(
      'ON "inbox_v2_action_attributions" USING btree ("tenant_id","automation_cause_event_id")'
    ) ||
    !causeEventIndexes[0].includes(
      'WHERE "inbox_v2_action_attributions"."automation_cause_event_id" is not null'
    )
  ) {
    throw new Error(
      `${migration.fileName} must create the exact partial action-attribution cause-event index.`
    );
  }

  const generatedSql = generatedStatements.join("\n");
  for (const forbidden of [
    /\bDROP\s+(?:TABLE|COLUMN|TYPE|INDEX|SCHEMA)\b/iu,
    /\bTRUNCATE\b/iu,
    /\bDELETE\s+FROM\b/iu,
    /\bINSERT\s+INTO\b/iu,
    /\bUPDATE\s+[^\s]+\s+SET\b/iu,
    /\bALTER\s+COLUMN\b/iu,
    /\bSET\s+NOT\s+NULL\b/iu,
    /\bRENAME\s+(?:TO|COLUMN|CONSTRAINT)\b/iu,
    /\bCREATE\s+(?:MATERIALIZED\s+)?VIEW\b/iu,
    /\bDO\s+\$/iu
  ]) {
    if (forbidden.test(generatedSql)) {
      throw new Error(
        `${migration.fileName} contains destructive or backfill DDL: ${forbidden}.`
      );
    }
  }

  for (const constraintName of inboxV2FileObjectDeferredForeignKeys) {
    const generatedCount = generatedStatements.filter((statement) =>
      statement.includes(`ADD CONSTRAINT "${constraintName}" FOREIGN KEY`)
    ).length;
    const deferredCount = [
      ...invariantBlock.sql.matchAll(
        new RegExp(
          `alter constraint ${escapeRegExp(constraintName)}\\s+` +
            "deferrable initially deferred;",
          "giu"
        )
      )
    ].length;
    if (generatedCount !== 1 || deferredCount !== 1) {
      throw new Error(
        `${migration.fileName} must create and defer ${constraintName} exactly once.`
      );
    }
  }
  for (const fragment of [
    "route_row.adapter_declaration_revision =\n         plan_row.adapter_contract_declaration_revision",
    "route_row.adapter_loaded_by_trusted_service_id =\n         plan_row.adapter_loaded_by_trusted_service_id",
    "route_row.adapter_loaded_at = plan_row.adapter_loaded_at"
  ]) {
    if (!invariantBlock.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} must bind the immutable plan to the exact adapter load snapshot: ${fragment}.`
      );
    }
  }
  for (const fragment of [
    "inbox_v2_message_attachment_anchors_owner_message_fk",
    "deferrable initially deferred not valid",
    "inbox_v2_msg003_attachment_anchor_guard",
    "inbox_v2.message_attachment_anchor_owner_required",
    "inbox_v2.message_attachment_anchor_transition_invalid",
    "inbox_v2_msg003_attachment_anchor_coherence",
    "payload_row.content_revision = content_row.revision",
    "anchor_row.owner_timeline_content_id = payload_row.content_id",
    "anchor_row.materialization_state = payload_row.attachment_state",
    "create or replace function public.inbox_v2_msg003_action_attribution_cause_event_coherence()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public, pg_temp",
    "from public.event_store event_row",
    "from public.inbox_v2_domain_events event_row",
    "for key share",
    "inbox_v2.action_attribution_cause_event_missing",
    "create constraint trigger inbox_v2_msg003_action_attribution_cause_event_coherence\nafter insert or update on public.inbox_v2_action_attributions\ndeferrable initially deferred for each row",
    "create or replace function public.inbox_v2_msg003_legacy_cause_event_guard()\nreturns trigger\nlanguage plpgsql\nsecurity definer\nset search_path = pg_catalog, public, pg_temp",
    "inbox_v2.action_attribution_legacy_cause_event_referenced",
    "create trigger inbox_v2_msg003_legacy_cause_event_guard\nbefore update or delete on public.event_store"
  ]) {
    if (!anchorInvariantBlock.sql.includes(fragment)) {
      throw new Error(
        `${migration.fileName} must include the exact MSG-003 attachment-anchor closure: ${fragment}.`
      );
    }
  }

  const attributionTableName = "public.inbox_v2_action_attributions";
  const predecessorAttribution =
    inboxV2FileObjectPredecessorSnapshot.tables[attributionTableName];
  const currentAttribution =
    inboxV2FileObjectSnapshot.tables[attributionTableName];
  if (
    !predecessorAttribution?.foreignKeys?.[
      inboxV2FileObjectReplacedCauseEventForeignKey
    ] ||
    currentAttribution?.foreignKeys?.[
      inboxV2FileObjectReplacedCauseEventForeignKey
    ]
  ) {
    throw new Error(
      `${migration.fileName} snapshot must replace the legacy cause-event FK exactly at MSG-003.`
    );
  }
  const currentCauseEventIndex =
    currentAttribution?.indexes?.[inboxV2FileObjectCauseEventIndex];
  if (
    currentCauseEventIndex?.isUnique !== false ||
    currentCauseEventIndex?.where !==
      '"inbox_v2_action_attributions"."automation_cause_event_id" is not null'
  ) {
    throw new Error(
      `${migration.fileName} snapshot must contain the exact partial cause-event lookup index.`
    );
  }
}

function applyInboxV2Msg002Replacements(value, replacements, label) {
  return replacements.reduce(
    (current, { predecessor, successor }, index) =>
      replaceExactSchemaFragment(
        current,
        predecessor,
        successor,
        `${label} replacement ${index + 1}`
      ),
    value
  );
}

function extractMigrationFunctionBody(sql, signature) {
  const normalized = sql.replaceAll("\r\n", "\n");
  const signatureIndex = normalized.indexOf(
    `create or replace function ${signature}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, signatureIndex);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + delimiter.length
  );
  if (signatureIndex < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(
      `Cannot extract historical function body for ${signature}.`
    );
  }
  return normalized.slice(bodyStart + `as ${delimiter}`.length, bodyEnd);
}

function extractMigrationFunctionDefinition(sql, functionName) {
  const normalized = sql.replaceAll("\r\n", "\n");
  const start = normalized.indexOf(
    `create or replace function ${functionName}`
  );
  const delimiter = "$function$";
  const bodyStart = normalized.indexOf(`as ${delimiter}`, start);
  const bodyEnd = normalized.indexOf(
    `${delimiter};`,
    bodyStart + `as ${delimiter}`.length
  );
  if (start < 0 || bodyStart < 0 || bodyEnd < 0) {
    throw new Error(
      `Cannot extract complete SQL definition for ${functionName}.`
    );
  }
  return normalized.slice(start, bodyEnd + `${delimiter};`.length).trim();
}

function getInboxV2Msg003AttachmentAuthorizationInvariantSql(sql) {
  const extracted = inboxV2Msg003AttachmentAuthorizationFunctionNames
    .map((functionName) =>
      extractMigrationFunctionDefinition(sql, functionName)
    )
    .join("\n\n");
  for (const fragment of [
    "message_change.resulting_revision >= 2",
    "message_change.payload_reference =\n         expected_command_result_reference",
    "content_revision_row.transition_kind = 'attachment_materialization'",
    "content_revision_row.event_id = message_event.id",
    "revision_row.change_kind = 'attachment_materialized'",
    "attribution_row.automation_cause_event_id is not null",
    "job_row.cause_event_id =\n              attribution_row.automation_cause_event_id",
    "job_row.authorization_actor_kind = 'trusted_service'",
    "expected_audit_revision_delta_hash <>\n         'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'",
    "'core:attachment.materialization.complete'",
    "inbox_v2.domain_mutation_attachment_cardinality_invalid"
  ]) {
    if (!extracted.includes(fragment)) {
      throw new Error(
        `MSG-003 attachment authorization replacement is missing ${fragment}.`
      );
    }
  }
  return extracted;
}

function restoreInboxV2TimelineMessagePreMsg002InvariantBlocks(blocks) {
  return blocks.map((block) =>
    block.name === "INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL"
      ? restoreInboxV2Msg002FunctionBodies(block, "timeline")
      : block
  );
}

function restoreInboxV2AtomicProviderIoPreMsg002InvariantBlock(block) {
  return restoreInboxV2Msg002FunctionBodies(
    restoreInboxV2AtomicProviderIoPreMsg003InvariantBlock(block),
    "atomic"
  );
}

function restoreInboxV2AtomicProviderIoPreMsg003InvariantBlock(block) {
  let restoredSql = block.sql;
  const helperDefinition = extractMigrationFunctionDefinition(
    restoredSql,
    "public.inbox_v2_auth_attachment_message_change_valid"
  );
  restoredSql = replaceExactSchemaFragment(
    restoredSql,
    `${helperDefinition}\n\n`,
    "",
    "MSG-003 attachment validation helper"
  );

  const definitionSignature =
    "public.inbox_v2_auth_domain_mutation_coherence()";
  const successorBody = extractMigrationFunctionBody(
    restoredSql,
    definitionSignature
  );
  let predecessorBody = successorBody;
  for (const [successor, predecessor, label] of [
    [
      String.raw`     and message_change.entity_type_id = 'core:message'
     and v_command.command_type_id <>
       'core:attachment.materialization.complete'
     and (`,
      String.raw`     and message_change.entity_type_id = 'core:message'
     and (`,
      "message creation command exclusion"
    ],
    [
      String.raw`
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes message_change
   where message_change.tenant_id = new.tenant_id
     and message_change.stream_commit_id = new.stream_commit_id
     and message_change.mutation_id = new.mutation_id
     and message_change.entity_type_id = 'core:message'
     and v_command.command_type_id =
       'core:attachment.materialization.complete'
     and not public.inbox_v2_auth_attachment_message_change_valid(
       message_change.tenant_id,
       message_change.stream_commit_id,
       message_change.mutation_id,
       message_change.id,
       message_change.stream_position,
       new.committed_at,
       v_command.actor_trusted_service_id,
       v_stream.correlation_id,
       v_command.result_reference,
       v_audit.evidence_reference,
       v_audit.revision_delta_hash
     );
`,
      "",
      "terminal message validation"
    ],
    [
      String.raw`
  if v_command.command_type_id =
     'core:attachment.materialization.complete' then
    select count(*)::integer into v_message_change_count
      from public.inbox_v2_tenant_stream_changes message_change
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message';
    select count(*)::integer into v_message_row_count
      from public.inbox_v2_tenant_stream_changes message_change
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = message_change.tenant_id
       and message_row.id = message_change.entity_id
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message'
       and message_row.revision = message_change.resulting_revision
       and message_row.revision >= 2
       and message_row.last_changed_stream_position = v_stream.position
       and message_row.updated_at = new.committed_at;
    select count(*)::integer into v_source_change_count
      from public.inbox_v2_tenant_stream_changes occurrence_change
     where occurrence_change.tenant_id = new.tenant_id
       and occurrence_change.stream_commit_id = new.stream_commit_id
       and occurrence_change.mutation_id = new.mutation_id
       and occurrence_change.stream_position = v_stream.position
       and occurrence_change.entity_type_id = 'core:source-occurrence';
    select count(*)::integer into v_source_materialization_count
      from public.inbox_v2_atomic_source_resolution_materializations
        source_materialization
     where source_materialization.tenant_id = new.tenant_id
       and source_materialization.stream_commit_id = new.stream_commit_id
       and source_materialization.mutation_id = new.mutation_id
       and source_materialization.stream_position = v_stream.position;

    if v_message_change_count <> 1
       or v_message_row_count <> 1
       or v_source_change_count <> 0
       or v_source_materialization_count <> 0
       or v_change_count <> 1
       or v_event_count <> 1
       or v_outbox_count <> 1
       or v_projection_count <> 1 then
      raise exception using errcode = '23514',
        message =
          'inbox_v2.domain_mutation_attachment_cardinality_invalid';
    end if;
  end if;
`,
      "",
      "terminal message cardinality"
    ],
    [
      String.raw`     or (
       v_command.command_type_id <>
         'core:attachment.materialization.complete'
       and v_audit.revision_delta_hash <> v_empty_digest
     ) then`,
      String.raw`     or v_audit.revision_delta_hash <> v_empty_digest then`,
      "terminal audit revision delta"
    ]
  ]) {
    predecessorBody = replaceExactSchemaFragment(
      predecessorBody,
      successor,
      predecessor,
      `MSG-003 ${label}`
    );
  }
  restoredSql = replaceExactSchemaFragment(
    restoredSql,
    successorBody,
    predecessorBody,
    "MSG-003 domain mutation coherence body"
  );
  return { ...block, sql: restoredSql };
}

function restoreInboxV2Msg002FunctionBodies(block, owner) {
  let restoredSql = block.sql;
  for (const transform of getInboxV2Msg002FunctionTransforms().filter(
    (candidate) => candidate.owner === owner
  )) {
    const successorBody = extractMigrationFunctionBody(
      restoredSql,
      transform.definitionSignature
    );
    const reverseReplacements =
      transform.restoreReplacements ??
      [...transform.replacements]
        .reverse()
        .map(({ predecessor, successor }) => ({
          predecessor: successor,
          successor: predecessor
        }));
    const predecessorBody = applyInboxV2Msg002Replacements(
      successorBody,
      reverseReplacements,
      `MSG-002 ${transform.slug} schema restore`
    );
    restoredSql = replaceExactSchemaFragment(
      restoredSql,
      successorBody,
      predecessorBody,
      `MSG-002 ${transform.slug} schema-owned function body`
    );
  }
  return { ...block, sql: restoredSql };
}

function assertInboxV2AtomicProviderIoMigration(migration, invariantBlock) {
  const migrationSql = normalizeSqlStatement(migration.sql);
  const invariantSql = normalizeSqlStatement(invariantBlock.sql);
  if (migrationSql !== invariantSql) {
    const mismatchIndex = [...migrationSql].findIndex(
      (character, index) => character !== invariantSql[index]
    );
    const contextStart = Math.max(0, mismatchIndex - 120);
    throw new Error(
      `${migration.fileName} is stale against schema block ${invariantBlock.name} from ${invariantBlock.fileName}; first mismatch at ${mismatchIndex}: migration=${JSON.stringify(migrationSql.slice(contextStart, mismatchIndex + 240))}, schema=${JSON.stringify(invariantSql.slice(contextStart, mismatchIndex + 240))}.`
    );
  }
}

function assertInboxV2EmployeeConversationStateMigration(migration) {
  if (!migration.fileName.startsWith("0032_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 EmployeeConversationState migration at index 0032.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2EmployeeConversationStateMarker,
    preflightMarker: inboxV2EmployeeConversationStatePreflightMarker,
    invariantBlocks: inboxV2EmployeeConversationStateInvariantBlocks,
    preflightDescription: "EmployeeConversationState"
  });

  for (const fragment of [
    'CREATE TYPE "public"."inbox_v2_employee_conversation_notification_level"',
    'CREATE TABLE "inbox_v2_employee_conversation_states"',
    'CONSTRAINT "inbox_v2_employee_conversation_states_employee_fk" FOREIGN KEY ("tenant_id","employee_id")',
    'CONSTRAINT "inbox_v2_employee_conversation_states_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id")',
    "create or replace function public.inbox_v2_ecs_state_guard()",
    "create or replace function public.inbox_v2_ecs_read_cursor_guard()",
    "create trigger inbox_v2_ecs_state_guard_trigger"
  ]) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required EmployeeConversationState SQL: ${fragment}`
      );
      process.exit(1);
    }
  }
  if (
    !/create constraint trigger inbox_v2_ecs_read_cursor_constraint[\s\S]*?deferrable initially deferred[\s\S]*?execute function public\.inbox_v2_ecs_read_cursor_guard\(\)/i.test(
      migration.sql
    )
  ) {
    console.error(
      `${migration.fileName} must keep the exact read-cursor guard deferrable and initially deferred.`
    );
    process.exit(1);
  }
}

function assertInboxV2DataGovernancePrivacyMigration(migration) {
  if (!migration.fileName.startsWith("0033_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 data-governance/privacy migration at index 0033.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2DataGovernancePrivacyMarker,
    preflightMarker: inboxV2DataGovernancePrivacyPreflightMarker,
    invariantBlocks: inboxV2DataGovernancePrivacyInvariantBlocks,
    preflightDescription: "data-governance/privacy"
  });
  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "inbox_v2_dg_deletion_run_plan_anchor_unique",
        "inbox_v2_dg_erasure_ledger_entry_anchor_unique",
        "inbox_v2_dg_erasure_ledger_hash_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  for (const fragment of [
    'CREATE TYPE "public"."inbox_v2_data_governance_deployment_profile"',
    'CREATE TABLE "inbox_v2_data_governance_contexts"',
    'CREATE TABLE "inbox_v2_data_governance_legal_hold_revisions"',
    'CREATE TABLE "inbox_v2_data_governance_export_jobs"',
    'CREATE TABLE "inbox_v2_data_governance_deletion_runs"',
    'CREATE TABLE "inbox_v2_data_governance_deletion_stage_one_targets"',
    'CREATE TABLE "inbox_v2_data_governance_erasure_restore_ledger"',
    "create or replace function public.inbox_v2_dg_deletion_run_transition_guard()",
    "create or replace function public.inbox_v2_dg_erasure_ledger_coherence()"
  ]) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required data-governance/privacy SQL: ${fragment}`
      );
      process.exit(1);
    }
  }
}

function assertInboxV2AuthorizationRelationsMigration(migration) {
  if (!migration.fileName.startsWith("0034_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 authorization-relations migration at index 0034.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2AuthorizationRelationsMarker,
    preflightMarker: inboxV2AuthorizationRelationsPreflightMarker,
    invariantBlocks: inboxV2AuthorizationRelationsInvariantBlocks,
    preflightDescription: "authorization-relations"
  });

  for (const fragment of [
    "inbox_v2.authorization_relations_foundation_missing",
    "inbox_v2.authorization_relations_partial_schema_detected",
    "function_definition.oid = trigger_definition.tgfoid",
    "trigger_definition.tgtype is distinct from",
    "trigger_definition.tgenabled is distinct from 'O'",
    "trigger_definition.tgisinternal is distinct from false",
    "trigger_definition.tgdeferrable is distinct from true",
    "trigger_definition.tginitdeferred is distinct from true",
    "function_definition.proname is distinct from",
    "trigger_constraint.condeferrable is distinct from true",
    "trigger_constraint.condeferred is distinct from true",
    'CREATE TYPE "public"."inbox_v2_auth_actor_kind"',
    'CREATE TYPE "public"."inbox_v2_audience_impact_kind"',
    'CREATE TABLE "inbox_v2_auth_tenant_heads"',
    'CREATE TABLE "inbox_v2_auth_employee_heads"',
    'CREATE TABLE "inbox_v2_auth_role_versions"',
    'CREATE TABLE "inbox_v2_auth_structural_access_versions"',
    'CREATE TABLE "inbox_v2_tenant_stream_commits"',
    'CREATE TABLE "inbox_v2_domain_events"',
    'CREATE TABLE "inbox_v2_outbox_intents"',
    'CREATE TABLE "inbox_v2_auth_audit_events"',
    'CREATE TABLE "inbox_v2_auth_mutation_commits"',
    'CREATE TABLE "inbox_v2_auth_relation_writes"',
    "create or replace function public.inbox_v2_work_item_aggregate_coherence()",
    "create or replace function public.inbox_v2_work_item_mutation_coherence()",
    "create or replace function public.inbox_v2_auth_relation_version_guard()",
    "create or replace function public.inbox_v2_auth_mutation_coherence()",
    "create or replace function public.inbox_v2_auth_mutation_child_coherence()"
  ]) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required authorization-relations SQL: ${fragment}`
      );
      process.exit(1);
    }
  }
  assertInboxV2AuthorizationFoundationTriggerInventory(migration);
}

function assertInboxV2SecurityDenialMigration(migration) {
  if (!migration.fileName.startsWith("0035_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 security-denial migration at index 0035.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2SecurityDenialMarker,
    preflightMarker: inboxV2SecurityDenialPreflightMarker,
    invariantBlocks: inboxV2SecurityDenialInvariantBlocks,
    preflightDescription: "security-denial"
  });

  for (const fragment of [
    "inbox_v2.security_denial_foundation_missing",
    "inbox_v2.security_denial_partial_schema_detected",
    'CREATE TYPE "public"."inbox_v2_security_denial_action"',
    'CREATE TYPE "public"."inbox_v2_security_denial_review_type"',
    'CREATE TABLE "inbox_v2_security_denial_window_shards"',
    'CREATE TABLE "inbox_v2_security_denial_buckets"',
    'CREATE TABLE "inbox_v2_security_denial_review_signals"',
    "create or replace function public.inbox_v2_security_denial_record(",
    "create or replace function public.inbox_v2_security_denial_prune("
  ]) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required security-denial SQL: ${fragment}`
      );
      process.exit(1);
    }
  }
  for (const forbidden of [
    "insert into public.inbox_v2_tenant_stream_commits",
    "insert into public.inbox_v2_domain_events",
    "insert into public.inbox_v2_outbox_intents",
    " json ",
    " jsonb "
  ]) {
    if (migration.sql.toLowerCase().includes(forbidden)) {
      console.error(
        `${migration.fileName} security-denial sink contains forbidden stream/outbox/JSON SQL: ${forbidden.trim()}`
      );
      process.exit(1);
    }
  }
}

function assertInboxV2RepositoryFoundationMigration(migration) {
  if (!migration.fileName.startsWith("0036_")) {
    console.error(
      `${migration.fileName} must be the finalized Inbox V2 repository-foundation migration at index 0036.`
    );
    process.exit(1);
  }
  assertInboxV2InvariantMigration({
    migration,
    finalizedMarker: inboxV2RepositoryFoundationMarker,
    preflightMarker: inboxV2RepositoryFoundationPreflightMarker,
    invariantBlocks: inboxV2RepositoryFoundationOwnedBlocks,
    preflightDescription: "repository-foundation"
  });
  if (
    migration.sql.split(inboxV2RepositoryFoundationPreflightSql).length - 1 !==
    1
  ) {
    console.error(
      `${migration.fileName} must contain the exact current DB-007 preflight once.`
    );
    process.exit(1);
  }

  for (const fragment of [
    "inbox_v2.repository_foundation_missing",
    "inbox_v2.repository_foundation_partial_schema_detected",
    "inbox_v2.repository_cross_tenant_account_link",
    "inbox_v2.repository_stream_child_position_incoherent",
    'CREATE TYPE "public"."inbox_v2_projection_generation_state"',
    'CREATE TYPE "public"."inbox_v2_outbox_work_state"',
    'CREATE TYPE "public"."inbox_v2_outbox_outcome_kind"',
    'CREATE TABLE "inbox_v2_projection_generations"',
    'CREATE TABLE "inbox_v2_projection_heads"',
    'CREATE TABLE "inbox_v2_projection_checkpoints"',
    'CREATE TABLE "inbox_v2_outbox_work_items"',
    'CREATE TABLE "inbox_v2_outbox_outcomes"',
    'CREATE TABLE "inbox_v2_tenant_stream_retention_advances"',
    'CONSTRAINT "inbox_v2_dg_subject_link_account_fk" FOREIGN KEY ("tenant_id","account_id")',
    'CONSTRAINT "inbox_v2_domain_events_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    'CONSTRAINT "inbox_v2_outbox_intents_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    'CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position")',
    "disable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba",
    "set state_reason_id = 'core:retention-tombstone'",
    "enable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba",
    "insert into public.inbox_v2_outbox_work_items (",
    "create or replace function public.inbox_v2_auth_reject_immutable()",
    "create or replace function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(",
    "security definer",
    "owner to hulee_inbox_v2_retention_owner",
    "revoke all privileges on function",
    "do $retention_boundary_audit$",
    "create or replace function public.inbox_v2_repository_projection_checkpoint_guard()",
    "create or replace function public.inbox_v2_repository_projection_head_coherence()",
    "create constraint trigger inbox_v2_projection_generation_head_coherence_trigger",
    "create constraint trigger inbox_v2_projection_head_generation_coherence_trigger",
    "create constraint trigger inbox_v2_projection_checkpoint_generation_coherence_trigger",
    "create or replace function public.inbox_v2_repository_outbox_work_guard()",
    "create or replace function public.inbox_v2_repository_outbox_finalize_coherence()",
    "create or replace function public.inbox_v2_repository_retention_advance_immutable()",
    "create trigger inbox_v2_tenant_stream_retention_advance_immutable_trigger",
    "create or replace function public.inbox_v2_lock_conversation_membership_head_v1(",
    "create or replace function public.inbox_v2_lock_participant_membership_mutation_v1(",
    "create or replace function public.inbox_v2_apply_participant_membership_mutation_v1(",
    "revoke all privileges on table",
    "hulee_inbox_v2_runtime",
    "hulee_inbox_v2_membership_repair"
  ]) {
    if (!migration.sql.includes(fragment)) {
      console.error(
        `${migration.fileName} is missing required repository-foundation SQL: ${fragment}`
      );
      process.exit(1);
    }
  }

  try {
    assertParentUniqueConstraintsBeforeForeignKeys({
      migrationSql: migration.sql,
      constraintNames: [
        "accounts_tenant_id_unique",
        "inbox_v2_tenant_stream_commits_checkpoint_unique",
        "inbox_v2_tenant_stream_commits_identity_position_unique"
      ]
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }
}

function assertInboxV2AuthorizationFoundationTriggerInventory(migration) {
  const expected = [
    [
      "inbox_v2_work_item_mutation_coherence_constraint",
      "inbox_v2_work_items",
      "inbox_v2_work_item_mutation_coherence",
      17
    ],
    [
      "inbox_v2_work_items_aggregate_constraint",
      "inbox_v2_work_items",
      "inbox_v2_work_item_aggregate_coherence",
      21
    ],
    [
      "inbox_v2_work_sla_aggregate_constraint",
      "inbox_v2_work_item_sla_snapshots",
      "inbox_v2_work_item_aggregate_coherence",
      5
    ],
    [
      "inbox_v2_work_creation_aggregate_constraint",
      "inbox_v2_work_item_creation_decisions",
      "inbox_v2_work_item_aggregate_coherence",
      5
    ],
    [
      "inbox_v2_work_assignment_aggregate_constraint",
      "inbox_v2_work_item_primary_assignments",
      "inbox_v2_work_item_aggregate_coherence",
      21
    ],
    [
      "inbox_v2_work_transition_aggregate_constraint",
      "inbox_v2_work_item_transitions",
      "inbox_v2_work_item_aggregate_coherence",
      5
    ],
    [
      "inbox_v2_work_team_episode_aggregate_constraint",
      "inbox_v2_work_item_servicing_team_episodes",
      "inbox_v2_work_item_aggregate_coherence",
      21
    ],
    [
      "inbox_v2_work_relation_transition_aggregate_constraint",
      "inbox_v2_work_item_relation_transitions",
      "inbox_v2_work_item_aggregate_coherence",
      5
    ]
  ];
  const beginMarker = "-- RBAC003_FOUNDATION_TRIGGERS_BEGIN";
  const endMarker = "-- RBAC003_FOUNDATION_TRIGGERS_END";
  const beginCount = migration.sql.split(beginMarker).length - 1;
  const endCount = migration.sql.split(endMarker).length - 1;
  if (beginCount !== 1 || endCount !== 1) {
    console.error(
      `${migration.fileName} must contain one exact WorkItem foundation trigger inventory boundary.`
    );
    process.exit(1);
  }
  const start = migration.sql.indexOf(beginMarker) + beginMarker.length;
  const end = migration.sql.indexOf(endMarker, start);
  const actual = [
    ...migration.sql
      .slice(start, end)
      .matchAll(
        /\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*(\d+)\s*\)/g
      )
  ]
    .map((match) => [match[1], match[2], match[3], Number(match[4])])
    .sort(([left], [right]) => left.localeCompare(right));
  expected.sort(([left], [right]) => left.localeCompare(right));
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    console.error(
      `${migration.fileName} has a stale WorkItem foundation trigger fingerprint inventory.`
    );
    process.exit(1);
  }
}

function assertInboxV2InvariantMigration({
  migration,
  finalizedMarker,
  preflightMarker,
  invariantBlocks,
  preflightDescription
}) {
  try {
    collectFinalizedMigrationDdlStatements({
      migrationSql: migration.sql,
      finalizedMarker,
      preflightMarker,
      invariantBlocks
    });
  } catch (error) {
    console.error(
      `${migration.fileName}: ${error instanceof Error ? error.message : String(error)}`
    );
    process.exit(1);
  }

  for (const invariantBlock of invariantBlocks) {
    if (!migration.sql.includes(invariantBlock.sql)) {
      console.error(
        `${migration.fileName} is stale against schema invariant block ${invariantBlock.name} from ${invariantBlock.fileName}.`
      );
      process.exit(1);
    }
  }

  const expectedInvariantFunctionNames = extractInboxV2InvariantFunctionNames(
    invariantBlocks.map(({ sql }) => sql).join("\n")
  );
  const migratedInvariantFunctionMatches = [
    ...migration.sql.matchAll(
      /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
    )
  ];
  const migratedInvariantFunctionNames = [
    ...new Set(migratedInvariantFunctionMatches.map((match) => match[1]))
  ].sort();
  const safeSearchPathCount = [
    ...migration.sql.matchAll(/set search_path = pg_catalog, public, pg_temp/g)
  ].length;
  if (
    JSON.stringify(migratedInvariantFunctionNames) !==
      JSON.stringify(expectedInvariantFunctionNames) ||
    migratedInvariantFunctionMatches.length !==
      migratedInvariantFunctionNames.length ||
    safeSearchPathCount !== migratedInvariantFunctionMatches.length ||
    /create or replace function inbox_v2_/.test(migration.sql) ||
    /execute function inbox_v2_/.test(migration.sql) ||
    /\b(?:from|join) inbox_v2_/.test(migration.sql)
  ) {
    console.error(
      `${migration.fileName} must schema-qualify every Inbox V2 invariant function and pin its safe search_path.`
    );
    process.exit(1);
  }

  const firstBreakpointIndex = migration.sql.indexOf(
    "--> statement-breakpoint"
  );
  const preflightIndex = migration.sql.indexOf(preflightMarker);
  if (
    firstBreakpointIndex < 0 ||
    preflightIndex < 0 ||
    preflightIndex > firstBreakpointIndex
  ) {
    console.error(
      `${migration.fileName} must run the Inbox V2 ${preflightDescription} preflight as its first statement.`
    );
    process.exit(1);
  }
}

function extractInboxV2InvariantBlocks(fileName, source) {
  return [
    ...source.matchAll(
      /export const (INBOX_V2_[A-Z0-9_]+(?:INTEGRITY|INVARIANTS|CLOSURE)_SQL) = String\.raw`([\s\S]*?)`;/g
    )
  ].map((match) => ({
    fileName,
    name: match[1],
    sql: match[2].trim()
  }));
}

function extractInboxV2BareTemplateSqlBlock(fileName, source, exportName) {
  const pattern = new RegExp(
    `export const ${escapeRegExp(exportName)} = ` +
      "`([\\s\\S]*?)`\\.trim\\(\\);"
  );
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`${fileName} is missing SQL block ${exportName}.`);
  }
  return {
    fileName,
    name: exportName,
    sql: match[1].trim()
  };
}

function assertExactSqlSequence(expected, actual, label) {
  const normalizedExpected = expected.map(normalizeSqlStatement);
  const normalizedActual = actual.map(normalizeSqlStatement);
  if (
    normalizedExpected.length !== normalizedActual.length ||
    normalizedExpected.some(
      (statement, index) => statement !== normalizedActual[index]
    )
  ) {
    throw new Error(`${label} does not match the schema-owned SQL exactly.`);
  }
}

function replaceExactSchemaFragment(source, expected, replacement, label) {
  const firstIndex = source.indexOf(expected);
  if (firstIndex < 0 || source.indexOf(expected, firstIndex + 1) >= 0) {
    throw new Error(
      `Generated schema has an unexpected ${label} predecessor shape.`
    );
  }
  return `${source.slice(0, firstIndex)}${replacement}${source.slice(
    firstIndex + expected.length
  )}`;
}

function replaceExactSchemaSpan(source, start, end, replacement, label) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  if (
    startIndex < 0 ||
    source.indexOf(start, startIndex + 1) >= 0 ||
    endIndex < 0
  ) {
    throw new Error(
      `Generated schema has an unexpected ${label} predecessor span.`
    );
  }
  return `${source.slice(0, startIndex)}${replacement}${source.slice(endIndex)}`;
}

function digestOrderedSqlStatements(statements) {
  return `sha256:${createHash("sha256")
    .update(JSON.stringify(statements.map(normalizeSqlStatement)))
    .digest("hex")}`;
}

function removeExactSqlStatements(statements, exclusions, label) {
  const remaining = [...statements];
  for (const exclusion of exclusions) {
    const normalizedExclusion = normalizeSqlStatement(exclusion);
    const matches = remaining
      .map((statement, index) =>
        normalizeSqlStatement(statement) === normalizedExclusion ? index : -1
      )
      .filter((index) => index >= 0);
    if (matches.length !== 1) {
      throw new Error(
        `${label} must contain every exact statement once; found ${matches.length}.`
      );
    }
    remaining.splice(matches[0], 1);
  }
  return remaining;
}

function assertExactStringSequence(expected, actual, label) {
  if (
    expected.length !== actual.length ||
    expected.some((value, index) => value !== actual[index])
  ) {
    throw new Error(`${label} is not an exact ordered bijection.`);
  }
}

function normalizeSqlStatement(value) {
  return value.replaceAll("\r\n", "\n").trim();
}

function extractInboxV2NamedSqlBlock(fileName, source, exportName) {
  const pattern = new RegExp(
    `export const ${escapeRegExp(exportName)} = String\\.raw` +
      "`([\\s\\S]*?)`;"
  );
  const match = source.match(pattern);
  if (!match?.[1]) {
    throw new Error(`${fileName} is missing SQL block ${exportName}.`);
  }
  return {
    fileName,
    name: exportName,
    sql: match[1].trim()
  };
}

function extractInboxV2InvariantFunctionNames(sql) {
  const matches = [
    ...sql.matchAll(
      /create or replace function public\.(inbox_v2_[a-z0-9_]+)\(/g
    )
  ];
  const names = [...new Set(matches.map((match) => match[1]))].sort();
  if (matches.length !== names.length) {
    console.error("DB schema has duplicate Inbox V2 invariant function names.");
    process.exit(1);
  }
  return names;
}

function findCreateTableBlock(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);
  const match = sql.match(
    new RegExp(`CREATE TABLE "${escapedTableName}" \\([\\s\\S]*?\\);`)
  );

  return match?.[0];
}

function hasTenantAwareIndex(sql, tableName) {
  const escapedTableName = escapeRegExp(tableName);

  return new RegExp(
    `CREATE (UNIQUE )?INDEX "[^"]+" ON "${escapedTableName}"[\\s\\S]*?\\("tenant_id"`
  ).test(sql);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
