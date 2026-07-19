import { createHash } from "node:crypto";

import {
  calculateInboxV2OutboundDispatchContentPlanDigest,
  inboxV2OutboundDispatchContentPlanSchema,
  type InboxV2OutboundDispatchContentPlanDigestInput
} from "@hulee/contracts";
import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type { RawSqlQueryResult } from "./sql-outbox-repository";
import {
  buildClaimInboxV2AttachmentMaterializationJobsSql,
  buildListInboxV2PendingMaterializationAuthorizationRefreshCandidatesSql,
  buildLoadInboxV2OutboundDispatchContentPlanSql,
  buildLockInboxV2FileParentDetachSql,
  buildLockInboxV2FileParentSetSql,
  buildLockInboxV2AttachmentMaterializationFinalizationSql,
  buildPersistInboxV2OutboundDispatchContentPlanSql,
  calculateInboxV2AttachmentContentMutationFenceSha256,
  createSqlInboxV2FileObjectRepository,
  deriveInboxV2StorageOrphanId,
  attachFileParentInTransaction,
  finalizeFailedInMessageMutation,
  finalizeReadyInMessageMutation,
  loadInboxV2OutboundDispatchContentPlan,
  persistInboxV2OutboundDispatchContentPlanInTransaction,
  type InboxV2AttachmentMaterializationClaim,
  type InboxV2AttachmentMaterializationContentFence,
  type AttachInboxV2FileParentInput,
  type DetachInboxV2FileParentInput,
  type InboxV2FileObjectTransactionExecutor
} from "./sql-inbox-v2-file-object-repository";

const tenantId = "tenant:file-object-repository";
const t0 = "2026-07-18T09:00:00.000Z";
const t1 = "2026-07-18T09:01:00.000Z";
const rawHashA = "a".repeat(64);
const rawHashB = "b".repeat(64);

function ref<const TKind extends string>(kind: TKind, id: string) {
  return { tenantId, kind, id };
}

function deriveRawSha256(domain: string, ...parts: readonly string[]): string {
  const hash = createHash("sha256");
  hash.update(domain, "utf8");
  for (const part of parts) {
    hash.update("\u0000", "utf8");
    hash.update(part, "utf8");
  }
  return hash.digest("hex");
}

function deriveBrandedId(prefix: string, ...parts: readonly string[]): string {
  return `${prefix}:${deriveRawSha256(
    `core:inbox-v2.${prefix}-id@v1`,
    ...parts
  )}`;
}

function dispatchPlanInput(): InboxV2OutboundDispatchContentPlanDigestInput {
  return {
    tenantId,
    id: "outbound_dispatch_content_plan:repository-plan",
    dispatch: ref("outbound_dispatch", "outbound_dispatch:repository-dispatch"),
    message: ref("message", "message:repository-message"),
    messageRevision: "3",
    conversation: ref("conversation", "conversation:repository-conversation"),
    timelineItem: ref("timeline_item", "timeline_item:repository-item"),
    route: ref("outbound_route", "outbound_route:repository-route"),
    timelineContent: ref(
      "timeline_content",
      "timeline_content:repository-content"
    ),
    contentRevision: "2",
    contentFingerprint: {
      purposeId: "core:outbound_dispatch_content_plan",
      keyGeneration: "outbound-content-key:g1",
      validUntil: "2026-08-18T09:00:00.000Z",
      hmacSha256: `hmac-sha256:${rawHashB}`
    },
    binding: ref(
      "source_thread_binding",
      "source_thread_binding:repository-binding"
    ),
    bindingRevision: "5",
    capabilityRevision: "8",
    adapterContract: {
      contractId: "core:direct-messenger-adapter",
      contractVersion: "v1",
      declarationRevision: "4",
      surfaceId: "core:direct-account",
      loadedByTrustedServiceId: "core:outbound-worker",
      loadedAt: t0
    },
    blocks: [
      {
        blockKey: "text-1",
        blockKind: "text",
        exactFileObjectPin: null,
        artifactOrdinal: 1
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single",
        capabilityId: "core:send-text",
        operationId: "core:send-message",
        blockKeys: ["text-1"]
      }
    ],
    createdAt: t0,
    revision: "1"
  };
}

function dispatchPlan() {
  const input = dispatchPlanInput();
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...input,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(input)
  });
}

function dispatchPlanRow() {
  const plan = dispatchPlan();
  return {
    plan_id: plan.id,
    dispatch_id: plan.dispatch.id,
    message_id: plan.message.id,
    message_revision: plan.messageRevision,
    conversation_id: plan.conversation.id,
    timeline_item_id: plan.timelineItem.id,
    route_id: plan.route.id,
    content_id: plan.timelineContent.id,
    content_revision: plan.contentRevision,
    content_fingerprint_purpose_id: plan.contentFingerprint.purposeId,
    content_fingerprint_key_generation: plan.contentFingerprint.keyGeneration,
    content_fingerprint_valid_until: plan.contentFingerprint.validUntil,
    content_fingerprint_hmac_sha256: plan.contentFingerprint.hmacSha256,
    binding_id: plan.binding.id,
    binding_revision: plan.bindingRevision,
    capability_revision: plan.capabilityRevision,
    adapter_contract_id: plan.adapterContract.contractId,
    adapter_contract_version: plan.adapterContract.contractVersion,
    adapter_contract_declaration_revision:
      plan.adapterContract.declarationRevision,
    adapter_surface_id: plan.adapterContract.surfaceId,
    adapter_loaded_by_trusted_service_id:
      plan.adapterContract.loadedByTrustedServiceId,
    adapter_loaded_at: plan.adapterContract.loadedAt,
    plan_digest_sha256: plan.planDigestSha256,
    plan_created_at: plan.createdAt,
    artifact_id: "outbound_dispatch_artifact_plan:repository-artifact",
    artifact_ordinal: 1,
    grouping: "single",
    capability_id: "core:send-text",
    operation_id: "core:send-message",
    artifact_block_ordinal: 1,
    content_block_ordinal: 0,
    block_key: "text-1",
    block_kind: "text",
    file_id: null,
    file_revision: null,
    file_version_id: null,
    object_version_id: null
  };
}

const claim: InboxV2AttachmentMaterializationClaim = {
  tenantId,
  jobId: "attachment_materialization_job:repository-job",
  attachmentId: "message_attachment:repository-attachment",
  attemptId: "attachment_materialization_attempt:repository-attempt",
  leaseToken: `attachment-lease:${"c".repeat(64)}`,
  leaseGeneration: "1",
  workerId: "core:attachment-worker",
  claimedAt: "2026-07-18T08:59:00.000Z",
  leaseExpiresAt: "2026-07-18T09:02:00.000Z",
  expectedJobRevision: "2",
  fileId: "file:repository-file",
  expectedFileRevision: "1",
  dataClassId: "core:message-content",
  processingPurposeId: "core:message-attachment",
  retentionAnchorAt: t0,
  fileVersionId: "file_version:repository-file-v1",
  objectVersionId: "file_object_version:repository-file-v1",
  storageRootId: "core:tenant-object-storage",
  storageKey: "tenant/file/repository-file-v1",
  contentOrigin: {
    conversationId: "conversation:repository-conversation",
    timelineItemId: "timeline_item:repository-item",
    parentKind: "message",
    parentEntityId: "message:repository-message",
    expectedParentRevision: "1",
    timelineContentId: "timeline_content:repository-content",
    expectedContentRevision: "1",
    contentBlockKey: "file-1",
    expectedAttachmentRevision: "1",
    visibilityBoundary: "external_work"
  },
  sourceLocator: {
    kind: "provider",
    reference: `src_ref_${"a".repeat(43)}`
  },
  reservationNamespaceGeneration: "attachment-namespace-v1",
  sourceOccurrenceId: "source_occurrence:repository-message",
  causeEventId: "event:repository-materialization",
  causeMutationId: "authorization-mutation:repository-cause",
  causeStreamCommitId: "commit:repository-cause",
  causeStreamPosition: "1",
  correlationId: "correlation:repository-materialization",
  causedAt: t0,
  reservationAuthority: {
    commandId: "command:repository-reservation",
    commandTypeId: "core:attachment.materialization.reserve",
    clientMutationId: "client-mutation:repository-reservation",
    mutationId: "authorization-mutation:repository-reservation",
    decisionId: "authorization-decision:repository-reservation",
    epoch: "authorization-epoch:repository",
    actor: {
      kind: "trusted_service",
      trustedServiceId: "core:attachment-worker"
    },
    authorizedAt: t0,
    decisionSetDigestSha256: "d".repeat(64),
    resourceFenceSetDigestSha256: "e".repeat(64),
    tenantRbacRevision: "7",
    sharedAccessRevision: "11",
    resourceHeadId: "authorization-resource-head:repository-conversation",
    resourceAccessRevision: "13",
    structuralRelationRevision: "17",
    collaboratorSetRevision: "19",
    auditGrantSourceIds: [`internal-ref:${"a".repeat(32)}`],
    auditPolicyVersion: "policy-v1"
  }
};

function reservationAuthorityHashParts(): readonly string[] {
  const authority = claim.reservationAuthority;
  return [
    authority.commandId,
    authority.commandTypeId,
    authority.clientMutationId,
    authority.mutationId,
    authority.decisionId,
    authority.epoch,
    authority.actor.kind,
    authority.actor.kind === "trusted_service"
      ? authority.actor.trustedServiceId
      : authority.actor.employeeId,
    authority.authorizedAt,
    authority.decisionSetDigestSha256,
    authority.resourceFenceSetDigestSha256,
    authority.tenantRbacRevision,
    authority.sharedAccessRevision,
    authority.resourceHeadId,
    authority.resourceAccessRevision,
    authority.structuralRelationRevision,
    authority.collaboratorSetRevision,
    JSON.stringify(authority.auditGrantSourceIds),
    authority.auditPolicyVersion ?? "-"
  ];
}

const contentFence: InboxV2AttachmentMaterializationContentFence = {
  tenantId,
  conversationId: "conversation:repository-conversation",
  timelineItemId: "timeline_item:repository-item",
  timelineContentId: "timeline_content:repository-content",
  resultingContentRevision: "2",
  contentBlockKey: "file-1",
  attachmentId: "message_attachment:repository-attachment",
  resultingAttachmentRevision: "2",
  parentKind: "message",
  parentEntityId: "message:repository-message",
  parentEntityRevision: "2",
  visibilityBoundary: "external_work",
  parentConversationVisibility: null,
  dataClassId: "core:message-content",
  processingPurposeId: "core:message-attachment",
  retentionAnchorAt: t0
};

function liveFinalizationRow(
  overrides: Readonly<Record<string, unknown>> = {}
) {
  const leaseHash = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-lease@v1",
    claim.tenantId,
    claim.leaseToken
  );
  return {
    job_id: claim.jobId,
    job_state: "claimed",
    job_revision: claim.expectedJobRevision,
    attachment_id: contentFence.attachmentId,
    file_id: claim.fileId,
    expected_file_revision: claim.expectedFileRevision,
    expected_attachment_revision: "1",
    conversation_id: claim.contentOrigin.conversationId,
    timeline_item_id: claim.contentOrigin.timelineItemId,
    parent_message_id: claim.contentOrigin.parentEntityId,
    expected_parent_revision: claim.contentOrigin.expectedParentRevision,
    visibility_boundary: claim.contentOrigin.visibilityBoundary,
    timeline_content_id: contentFence.timelineContentId,
    expected_content_revision: "1",
    content_block_key: contentFence.contentBlockKey,
    content_mutation_fence_sha256:
      calculateInboxV2AttachmentContentMutationFenceSha256({
        tenantId,
        attachmentId: contentFence.attachmentId,
        expectedAttachmentRevision: "1",
        timelineContentId: contentFence.timelineContentId,
        expectedContentRevision: "1",
        contentBlockKey: contentFence.contentBlockKey
      }),
    source_locator_kind: claim.sourceLocator.kind,
    source_locator_reference: claim.sourceLocator.reference,
    source_locator_digest_sha256: deriveRawSha256(
      "core:inbox-v2.attachment-source-locator@v1",
      claim.tenantId,
      claim.sourceLocator.kind,
      claim.sourceLocator.reference
    ),
    reservation_namespace_generation: claim.reservationNamespaceGeneration,
    source_occurrence_id: claim.sourceOccurrenceId,
    cause_event_id: claim.causeEventId,
    cause_mutation_id: claim.causeMutationId,
    cause_stream_commit_id: claim.causeStreamCommitId,
    cause_stream_position: claim.causeStreamPosition,
    correlation_id: claim.correlationId,
    caused_at: claim.causedAt,
    authorization_command_id: claim.reservationAuthority.commandId,
    authorization_command_type_id: claim.reservationAuthority.commandTypeId,
    authorization_client_mutation_id:
      claim.reservationAuthority.clientMutationId,
    authorization_mutation_id: claim.reservationAuthority.mutationId,
    authorization_decision_id: claim.reservationAuthority.decisionId,
    authorization_epoch: claim.reservationAuthority.epoch,
    authorization_actor_kind: claim.reservationAuthority.actor.kind,
    authorization_actor_id:
      claim.reservationAuthority.actor.kind === "trusted_service"
        ? claim.reservationAuthority.actor.trustedServiceId
        : claim.reservationAuthority.actor.employeeId,
    authorization_authorized_at: claim.reservationAuthority.authorizedAt,
    authorization_decision_set_digest_sha256:
      claim.reservationAuthority.decisionSetDigestSha256,
    authorization_resource_fence_set_digest_sha256:
      claim.reservationAuthority.resourceFenceSetDigestSha256,
    authorization_tenant_rbac_revision:
      claim.reservationAuthority.tenantRbacRevision,
    authorization_shared_access_revision:
      claim.reservationAuthority.sharedAccessRevision,
    authorization_resource_head_id: claim.reservationAuthority.resourceHeadId,
    authorization_resource_access_revision:
      claim.reservationAuthority.resourceAccessRevision,
    authorization_structural_relation_revision:
      claim.reservationAuthority.structuralRelationRevision,
    authorization_collaborator_set_revision:
      claim.reservationAuthority.collaboratorSetRevision,
    authorization_audit_grant_source_ids:
      claim.reservationAuthority.auditGrantSourceIds,
    authorization_audit_policy_version:
      claim.reservationAuthority.auditPolicyVersion,
    lease_generation: "1",
    lease_token_hash: leaseHash,
    lease_owner_id: claim.workerId,
    lease_expires_at: claim.leaseExpiresAt,
    reserved_file_version_id: claim.fileVersionId,
    reserved_object_version_id: claim.objectVersionId,
    reserved_storage_root_id: claim.storageRootId,
    reserved_storage_object_key: claim.storageKey,
    result_file_version_id: null,
    result_object_version_id: null,
    result_file_revision: null,
    result_content_revision: null,
    terminal_reason_id: null,
    attempt_id: claim.attemptId,
    attempt_job_id: claim.jobId,
    attempt_attachment_id: contentFence.attachmentId,
    attempt_file_id: claim.fileId,
    attempt_lease_generation: "1",
    attempt_lease_token_hash: leaseHash,
    attempt_lease_owner_id: claim.workerId,
    attempt_expected_job_revision: claim.expectedJobRevision,
    attempt_expected_file_revision: claim.expectedFileRevision,
    attempt_expected_attachment_revision: "1",
    attempt_claimed_at: claim.claimedAt,
    attempt_lease_expires_at: claim.leaseExpiresAt,
    file_state: "pending",
    file_revision: claim.expectedFileRevision,
    file_current_file_version_id: null,
    file_current_object_version_id: null,
    file_data_class_id: contentFence.dataClassId,
    file_processing_purpose_id: contentFence.processingPurposeId,
    file_retention_anchor_at: contentFence.retentionAnchorAt,
    attachment_revision: "1",
    database_now: t1,
    ...overrides
  };
}

function terminalReplayBase() {
  const leaseGeneration = "1";
  const leaseHash = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-lease@v1",
    claim.tenantId,
    claim.leaseToken
  );
  const contentMutationFence =
    calculateInboxV2AttachmentContentMutationFenceSha256({
      tenantId,
      attachmentId: contentFence.attachmentId,
      expectedAttachmentRevision: "1",
      timelineContentId: contentFence.timelineContentId,
      expectedContentRevision: "1",
      contentBlockKey: contentFence.contentBlockKey
    });
  return {
    job_id: claim.jobId,
    job_revision: "3",
    attachment_id: contentFence.attachmentId,
    file_id: claim.fileId,
    expected_file_revision: claim.expectedFileRevision,
    expected_attachment_revision: "1",
    conversation_id: claim.contentOrigin.conversationId,
    timeline_item_id: claim.contentOrigin.timelineItemId,
    parent_message_id: claim.contentOrigin.parentEntityId,
    expected_parent_revision: claim.contentOrigin.expectedParentRevision,
    visibility_boundary: claim.contentOrigin.visibilityBoundary,
    timeline_content_id: contentFence.timelineContentId,
    expected_content_revision: "1",
    content_block_key: contentFence.contentBlockKey,
    content_mutation_fence_sha256: contentMutationFence,
    source_locator_kind: claim.sourceLocator.kind,
    source_locator_reference: claim.sourceLocator.reference,
    source_locator_digest_sha256: deriveRawSha256(
      "core:inbox-v2.attachment-source-locator@v1",
      claim.tenantId,
      claim.sourceLocator.kind,
      claim.sourceLocator.reference
    ),
    reservation_namespace_generation: claim.reservationNamespaceGeneration,
    source_occurrence_id: claim.sourceOccurrenceId,
    cause_event_id: claim.causeEventId,
    cause_mutation_id: claim.causeMutationId,
    cause_stream_commit_id: claim.causeStreamCommitId,
    cause_stream_position: claim.causeStreamPosition,
    correlation_id: claim.correlationId,
    caused_at: claim.causedAt,
    authorization_command_id: claim.reservationAuthority.commandId,
    authorization_command_type_id: claim.reservationAuthority.commandTypeId,
    authorization_client_mutation_id:
      claim.reservationAuthority.clientMutationId,
    authorization_mutation_id: claim.reservationAuthority.mutationId,
    authorization_decision_id: claim.reservationAuthority.decisionId,
    authorization_epoch: claim.reservationAuthority.epoch,
    authorization_actor_kind: claim.reservationAuthority.actor.kind,
    authorization_actor_id:
      claim.reservationAuthority.actor.kind === "trusted_service"
        ? claim.reservationAuthority.actor.trustedServiceId
        : claim.reservationAuthority.actor.employeeId,
    authorization_authorized_at: claim.reservationAuthority.authorizedAt,
    authorization_decision_set_digest_sha256:
      claim.reservationAuthority.decisionSetDigestSha256,
    authorization_resource_fence_set_digest_sha256:
      claim.reservationAuthority.resourceFenceSetDigestSha256,
    authorization_tenant_rbac_revision:
      claim.reservationAuthority.tenantRbacRevision,
    authorization_shared_access_revision:
      claim.reservationAuthority.sharedAccessRevision,
    authorization_resource_head_id: claim.reservationAuthority.resourceHeadId,
    authorization_resource_access_revision:
      claim.reservationAuthority.resourceAccessRevision,
    authorization_structural_relation_revision:
      claim.reservationAuthority.structuralRelationRevision,
    authorization_collaborator_set_revision:
      claim.reservationAuthority.collaboratorSetRevision,
    authorization_audit_grant_source_ids:
      claim.reservationAuthority.auditGrantSourceIds,
    authorization_audit_policy_version:
      claim.reservationAuthority.auditPolicyVersion,
    lease_generation: leaseGeneration,
    lease_token_hash: null,
    lease_expires_at: null,
    reserved_file_version_id: claim.fileVersionId,
    reserved_object_version_id: claim.objectVersionId,
    reserved_storage_root_id: claim.storageRootId,
    reserved_storage_object_key: claim.storageKey,
    attempt_id: claim.attemptId,
    attempt_job_id: claim.jobId,
    attempt_attachment_id: contentFence.attachmentId,
    attempt_file_id: claim.fileId,
    attempt_lease_generation: leaseGeneration,
    attempt_lease_token_hash: leaseHash,
    attempt_lease_owner_id: claim.workerId,
    attempt_expected_job_revision: claim.expectedJobRevision,
    attempt_expected_file_revision: claim.expectedFileRevision,
    attempt_expected_attachment_revision: "1",
    attempt_claimed_at: claim.claimedAt,
    attempt_lease_expires_at: claim.leaseExpiresAt,
    file_data_class_id: contentFence.dataClassId,
    file_processing_purpose_id: contentFence.processingPurposeId,
    file_retention_anchor_at: contentFence.retentionAnchorAt,
    terminal_content_id: contentFence.timelineContentId,
    terminal_content_revision: contentFence.resultingContentRevision,
    terminal_content_transition_kind: "attachment_materialization",
    terminal_payload_attachment_id: contentFence.attachmentId,
    terminal_payload_block_key: contentFence.contentBlockKey,
    terminal_owner_kind: contentFence.parentKind,
    terminal_owner_id: contentFence.parentEntityId,
    terminal_conversation_id: contentFence.conversationId,
    terminal_timeline_item_id: contentFence.timelineItemId,
    terminal_parent_entity_revision: contentFence.parentEntityRevision,
    terminal_timeline_visibility: "conversation_external",
    replay_evidence_job_id: claim.jobId,
    replay_evidence_attempt_id: claim.attemptId,
    replay_evidence_attachment_id: contentFence.attachmentId,
    replay_evidence_file_id: claim.fileId,
    replay_evidence_expected_file_revision: claim.expectedFileRevision,
    replay_evidence_lease_generation: leaseGeneration,
    replay_evidence_expected_attachment_revision: "1",
    replay_evidence_resulting_attachment_revision:
      contentFence.resultingAttachmentRevision,
    replay_evidence_content_id: contentFence.timelineContentId,
    replay_evidence_expected_content_revision: "1",
    replay_evidence_resulting_content_revision:
      contentFence.resultingContentRevision,
    replay_evidence_content_fence_sha256: contentMutationFence,
    database_now: t1
  };
}

function terminalReadyReplayRow() {
  const leaseGeneration = "1";
  const operationEvidenceId = deriveBrandedId(
    "object_operation_evidence",
    claim.tenantId,
    claim.jobId,
    leaseGeneration,
    "put"
  );
  const evidenceId = deriveBrandedId(
    "attachment_materialization_evidence",
    claim.tenantId,
    claim.jobId,
    leaseGeneration
  );
  return {
    ...terminalReplayBase(),
    job_state: "ready",
    result_file_version_id: claim.fileVersionId,
    result_object_version_id: claim.objectVersionId,
    result_file_revision: "2",
    result_content_revision: contentFence.resultingContentRevision,
    terminal_reason_id: null,
    file_state: "ready",
    file_revision: "2",
    file_current_file_version_id: claim.fileVersionId,
    file_current_object_version_id: claim.objectVersionId,
    attachment_revision: contentFence.resultingAttachmentRevision,
    terminal_payload_attachment_state: "ready",
    terminal_payload_file_id: claim.fileId,
    terminal_payload_file_revision: "2",
    terminal_payload_file_version_id: claim.fileVersionId,
    terminal_payload_object_version_id: claim.objectVersionId,
    terminal_payload_failure_reason_id: null,
    replay_file_version_id: claim.fileVersionId,
    replay_file_version_file_id: claim.fileId,
    replay_file_version_object_version_id: claim.objectVersionId,
    replay_object_version_id: claim.objectVersionId,
    replay_storage_root_id: claim.storageRootId,
    replay_storage_object_key: claim.storageKey,
    replay_storage_version_identity: "provider-version-repository",
    replay_checksum_sha256: rawHashA,
    replay_size_bytes: "123",
    replay_declared_media_type: "application/pdf",
    replay_detected_media_type: "application/pdf",
    replay_object_head_state: "ready",
    replay_object_head_evidence_id: operationEvidenceId,
    replay_operation_evidence_id: operationEvidenceId,
    replay_operation_object_version_id: claim.objectVersionId,
    replay_operation_job_id: claim.jobId,
    replay_operation_kind: "put",
    replay_operation_storage_root_id: claim.storageRootId,
    replay_operation_attempt_token: `object-put:${deriveRawSha256(
      "core:inbox-v2.object-put-attempt-token@v1",
      claim.tenantId,
      claim.attemptId
    )}`,
    replay_operation_outcome: "succeeded",
    replay_operation_affected_bytes: "123",
    replay_evidence_id: evidenceId,
    replay_evidence_outcome: "ready",
    replay_evidence_file_version_id: claim.fileVersionId,
    replay_evidence_object_version_id: claim.objectVersionId,
    replay_evidence_resulting_file_revision: "2",
    replay_evidence_operation_id: operationEvidenceId,
    replay_evidence_safe_reason_id: null,
    replay_evidence_retryable: null,
    replay_evidence_hash_sha256: deriveRawSha256(
      "core:inbox-v2.attachment-materialization-evidence@v2",
      claim.tenantId,
      claim.jobId,
      claim.attemptId,
      claim.causeEventId,
      claim.causeMutationId,
      claim.causeStreamCommitId,
      claim.causeStreamPosition,
      claim.correlationId,
      claim.causedAt,
      ...reservationAuthorityHashParts(),
      leaseGeneration,
      "ready",
      claim.fileId,
      claim.fileVersionId,
      claim.objectVersionId,
      contentFence.resultingAttachmentRevision,
      contentFence.resultingContentRevision,
      rawHashA,
      "123"
    )
  };
}

function terminalFailedReplayRow(retryable: boolean) {
  const leaseGeneration = "1";
  const safeReasonId = "core:attachment_materialization_failure.timeout";
  return {
    ...terminalReplayBase(),
    job_state: "failed",
    result_file_version_id: null,
    result_object_version_id: null,
    result_file_revision: null,
    result_content_revision: contentFence.resultingContentRevision,
    terminal_reason_id: safeReasonId,
    file_state: "pending",
    file_revision: claim.expectedFileRevision,
    file_current_file_version_id: null,
    file_current_object_version_id: null,
    attachment_revision: contentFence.resultingAttachmentRevision,
    terminal_payload_attachment_state: "failed",
    terminal_payload_file_id: null,
    terminal_payload_file_revision: null,
    terminal_payload_file_version_id: null,
    terminal_payload_object_version_id: null,
    terminal_payload_failure_reason_id: safeReasonId,
    replay_evidence_id: deriveBrandedId(
      "attachment_materialization_evidence",
      claim.tenantId,
      claim.jobId,
      leaseGeneration
    ),
    replay_evidence_outcome: "failed",
    replay_evidence_file_version_id: null,
    replay_evidence_object_version_id: null,
    replay_evidence_resulting_file_revision: null,
    replay_evidence_operation_id: null,
    replay_evidence_safe_reason_id: safeReasonId,
    replay_evidence_retryable: retryable,
    replay_evidence_hash_sha256: deriveRawSha256(
      "core:inbox-v2.attachment-materialization-evidence@v2",
      claim.tenantId,
      claim.jobId,
      claim.attemptId,
      claim.causeEventId,
      claim.causeMutationId,
      claim.causeStreamCommitId,
      claim.causeStreamPosition,
      claim.correlationId,
      claim.causedAt,
      ...reservationAuthorityHashParts(),
      leaseGeneration,
      "failed",
      safeReasonId,
      String(retryable),
      contentFence.resultingAttachmentRevision,
      contentFence.resultingContentRevision
    )
  };
}

const attachParentInput: AttachInboxV2FileParentInput = {
  tenantId,
  fileId: claim.fileId,
  fileVersionId: claim.fileVersionId,
  objectVersionId: claim.objectVersionId,
  expectedParentSetRevision: "1",
  parent: {
    kind: "message",
    purpose: "attachment",
    visibilityBoundary: "external_work",
    parentConversationVisibility: null,
    entityId: "message:repository-second-message",
    entityRevision: "1",
    conversationId: contentFence.conversationId,
    timelineItemId: "timeline_item:repository-second-item",
    contentId: "timeline_content:repository-second-content",
    contentRevision: "1",
    blockKey: "file-2"
  },
  dataClassId: contentFence.dataClassId,
  processingPurposeId: contentFence.processingPurposeId,
  retentionAnchorAt: "2026-07-18T08:30:00.000Z"
};

const detachParentInput: DetachInboxV2FileParentInput = {
  tenantId,
  fileId: claim.fileId,
  linkId: "file_parent_link:repository-second-link",
  expectedParentSetRevision: "2",
  expectedLinkRevision: "1",
  detachedByEventId: "event:repository-parent-detached"
};

describe("SQL Inbox V2 file/object repository", () => {
  it("loads the immutable adapter snapshot only from the content-plan table", async () => {
    const executor = new QueueExecutor([[dispatchPlanRow()]]);

    await expect(
      loadInboxV2OutboundDispatchContentPlan(executor, {
        tenantId,
        dispatchId: dispatchPlan().dispatch.id
      })
    ).resolves.toEqual(dispatchPlan());

    const statement = normalizeSql(executor.queries[0]!.sql);
    expect(statement).toContain("plan.adapter_contract_declaration_revision");
    expect(statement).toContain("plan.adapter_loaded_by_trusted_service_id");
    expect(statement).toContain("plan.adapter_loaded_at");
    expect(statement).toContain("plan.content_fingerprint_hmac_sha256");
    expect(statement).not.toContain("plan.content_digest_sha256");
    expect(statement).not.toContain("join inbox_v2_outbound_routes");
    expect(statement).toContain("limit 64");
  });

  it("persists all plan rows atomically and carries the exact adapter snapshot", () => {
    const plan = dispatchPlan();
    const query = buildPersistInboxV2OutboundDispatchContentPlanSql({
      tenantId: plan.tenantId,
      planId: plan.id,
      dispatchId: plan.dispatch.id,
      planDigestSha256: plan.planDigestSha256,
      planJson: JSON.stringify({}),
      artifactsJson: JSON.stringify([]),
      blocksJson: JSON.stringify([]),
      artifactCount: 1,
      blockCount: 1
    });
    const statement = normalizeSql(renderQuery(query).sql);

    expect(statement).toContain("adapter_contract_declaration_revision");
    expect(statement).toContain("adapter_loaded_by_trusted_service_id");
    expect(statement).toContain("adapter_loaded_at");
    expect(statement).toContain("content_fingerprint_key_generation");
    expect(statement).toContain("content_fingerprint_valid_until");
    expect(statement).toContain("content_fingerprint_hmac_sha256");
    expect(statement).not.toContain("content_digest_sha256");
    expect(statement).toContain("inserted_artifacts as");
    expect(statement).toContain("inserted_blocks as");
    expect(statement).toContain("already_persisted");
    expect(statement).not.toContain("dispatch_plan_conflict");
  });

  it("rejects forged contexts before dispatch-plan SQL can execute", async () => {
    const executor = new QueueExecutor([]);
    await expect(
      persistInboxV2OutboundDispatchContentPlanInTransaction(
        {
          executor,
          tenantId,
          profile: "domain",
          atomicMaterializationToken: {}
        } as never,
        dispatchPlan()
      )
    ).rejects.toThrow("live authorized-command context");
    expect(executor.queries).toHaveLength(0);
  });

  it("claims pending and expired work with SKIP LOCKED and stores only token hashes", () => {
    const rendered = renderQuery(
      buildClaimInboxV2AttachmentMaterializationJobsSql({
        tenantId,
        workerId: "core:attachment-worker",
        batchSize: 8,
        leaseDurationSeconds: 120,
        tokenRows: [
          {
            ordinal: 1,
            attemptId:
              "attachment_materialization_attempt:repository-attempt-2",
            rawLeaseToken: `attachment-lease:${"d".repeat(64)}`,
            leaseTokenHash: rawHashA
          }
        ]
      })
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain("for update of job skip locked");
    expect(statement).toContain("job.lease_expires_at <= clock.database_now");
    expect(statement).toContain('lease_token_hash = token."leasetokenhash"');
    expect(statement).toContain(
      "insert into inbox_v2_file_attachment_materialization_attempts"
    );
    expect(statement).toContain('token."rawleasetoken" as raw_lease_token');
    expect(statement).toContain("claimed.lease_claimed_at");
    expect(statement).toContain("claimed.lease_expires_at");
    expect(statement).toContain(
      "case when job.state = 'pending' then 'claimed'"
    );
    expect(statement).toContain("current_materialization_valid");
    expect(statement).toContain("current_access_valid");
    expect(statement).toContain("inbox_v2_auth_command_records");
    expect(statement).toContain(
      "authorization_command_row.authorization_not_after > clock.database_now"
    );
    expect(statement).toContain("jsonb_array_length(");
    expect(statement).toContain('decision("notafter" timestamptz)');
    expect(statement).toContain('isfinite(decision."notafter")');
    expect(statement).toContain("cancelled as");
    expect(statement).toContain("released_for_reauthorization as");
    expect(statement).toContain(
      "attachment_row.materialization_state = 'pending'"
    );
    expect(statement).toContain("payload_row.attachment_state = 'pending'");
    expect(statement).toContain(
      "core:attachment-materialization-current-fence-lost"
    );
    expect(statement).toContain("where current_materialization_valid = true");
    expect(statement).toContain("and current_access_valid = true");
  });

  it("selects a bounded CAS-safe pending authorization refresh set without exposing locators", () => {
    const statement = normalizeSql(
      renderQuery(
        buildListInboxV2PendingMaterializationAuthorizationRefreshCandidatesSql(
          { tenantId, limit: 12 }
        )
      ).sql
    );
    expect(statement).toContain("job.state = 'pending'");
    expect(statement).toContain("num_nonnulls(");
    expect(statement).toContain("and not exists");
    expect(statement).toContain("inbox_v2_auth_command_records");
    expect(statement).toContain(
      "authorization_command_row.authorization_not_after > clock.database_now"
    );
    expect(statement).toContain('decision("notafter" timestamptz)');
    expect(statement).toContain("for update of job skip locked");
    expect(statement).toContain("limit $2");
    expect(statement).not.toContain("source_locator_reference as");
    expect(statement).not.toContain("reserved_storage_object_key as");
  });

  it("maps the exact database lease window onto every materialization claim", async () => {
    const executor = new QueueExecutor([
      [
        {
          tenant_id: claim.tenantId,
          job_id: claim.jobId,
          attachment_id: claim.attachmentId,
          attempt_id: claim.attemptId,
          raw_lease_token: claim.leaseToken,
          lease_generation: claim.leaseGeneration,
          lease_owner_id: claim.workerId,
          lease_claimed_at: claim.claimedAt,
          lease_expires_at: claim.leaseExpiresAt,
          expected_job_revision: claim.expectedJobRevision,
          file_id: claim.fileId,
          expected_file_revision: claim.expectedFileRevision,
          file_data_class_id: claim.dataClassId,
          file_processing_purpose_id: claim.processingPurposeId,
          file_retention_anchor_at: claim.retentionAnchorAt,
          reserved_file_version_id: claim.fileVersionId,
          reserved_object_version_id: claim.objectVersionId,
          reserved_storage_root_id: claim.storageRootId,
          reserved_storage_object_key: claim.storageKey,
          source_locator_kind: claim.sourceLocator.kind,
          source_locator_reference: claim.sourceLocator.reference,
          source_locator_digest_sha256: deriveRawSha256(
            "core:inbox-v2.attachment-source-locator@v1",
            claim.tenantId,
            claim.sourceLocator.kind,
            claim.sourceLocator.reference
          ),
          reservation_namespace_generation:
            claim.reservationNamespaceGeneration,
          source_occurrence_id: claim.sourceOccurrenceId,
          conversation_id: claim.contentOrigin.conversationId,
          timeline_item_id: claim.contentOrigin.timelineItemId,
          parent_message_id: claim.contentOrigin.parentEntityId,
          expected_parent_revision: claim.contentOrigin.expectedParentRevision,
          visibility_boundary: claim.contentOrigin.visibilityBoundary,
          timeline_content_id: claim.contentOrigin.timelineContentId,
          expected_content_revision:
            claim.contentOrigin.expectedContentRevision,
          content_block_key: claim.contentOrigin.contentBlockKey,
          expected_attachment_revision:
            claim.contentOrigin.expectedAttachmentRevision,
          cause_event_id: claim.causeEventId,
          cause_mutation_id: claim.causeMutationId,
          cause_stream_commit_id: claim.causeStreamCommitId,
          cause_stream_position: claim.causeStreamPosition,
          correlation_id: claim.correlationId,
          caused_at: claim.causedAt,
          authorization_command_id: claim.reservationAuthority.commandId,
          authorization_command_type_id:
            claim.reservationAuthority.commandTypeId,
          authorization_client_mutation_id:
            claim.reservationAuthority.clientMutationId,
          authorization_mutation_id: claim.reservationAuthority.mutationId,
          authorization_decision_id: claim.reservationAuthority.decisionId,
          authorization_epoch: claim.reservationAuthority.epoch,
          authorization_actor_kind: claim.reservationAuthority.actor.kind,
          authorization_actor_id:
            claim.reservationAuthority.actor.kind === "trusted_service"
              ? claim.reservationAuthority.actor.trustedServiceId
              : claim.reservationAuthority.actor.employeeId,
          authorization_authorized_at: claim.reservationAuthority.authorizedAt,
          authorization_decision_set_digest_sha256:
            claim.reservationAuthority.decisionSetDigestSha256,
          authorization_resource_fence_set_digest_sha256:
            claim.reservationAuthority.resourceFenceSetDigestSha256,
          authorization_tenant_rbac_revision:
            claim.reservationAuthority.tenantRbacRevision,
          authorization_shared_access_revision:
            claim.reservationAuthority.sharedAccessRevision,
          authorization_resource_head_id:
            claim.reservationAuthority.resourceHeadId,
          authorization_resource_access_revision:
            claim.reservationAuthority.resourceAccessRevision,
          authorization_structural_relation_revision:
            claim.reservationAuthority.structuralRelationRevision,
          authorization_collaborator_set_revision:
            claim.reservationAuthority.collaboratorSetRevision,
          authorization_audit_grant_source_ids:
            claim.reservationAuthority.auditGrantSourceIds,
          authorization_audit_policy_version:
            claim.reservationAuthority.auditPolicyVersion
        }
      ]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(
      repository.claimMaterializationJobs({
        tenantId,
        workerId: "core:attachment-worker",
        batchSize: 1,
        leaseDurationSeconds: 120
      })
    ).resolves.toEqual([claim]);
  });

  it("counts only nonterminal jobs pinned to one reservation namespace generation", async () => {
    const executor = new QueueExecutor([[{ count: "3" }]]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(
      repository.countNonterminalMaterializationsForReservationNamespace({
        tenantId,
        reservationNamespaceGeneration: "attachment-namespace-v1"
      })
    ).resolves.toBe("3");
    const query = normalizeSql(executor.queries[0]!.sql);
    expect(query).toContain("reservation_namespace_generation");
    expect(query).toContain(
      "'pending', 'claimed', 'transferring', 'verifying'"
    );
    expect(query).not.toContain("'ready'");
    expect(query).not.toContain("'cancelled'");
  });

  it("reauthorizes an exact live claim immediately before source or storage I/O", async () => {
    const executor = new QueueExecutor([
      [
        {
          state: "claimed",
          revision: claim.expectedJobRevision,
          lease_generation: claim.leaseGeneration,
          lease_expires_at: claim.leaseExpiresAt,
          database_now: t1,
          claim_matches: true,
          current_materialization_valid: true,
          current_access_valid: true
        }
      ]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(repository.authorizeMaterializationIo(claim)).resolves.toBe(
      "authorized"
    );
    const query = normalizeSql(executor.queries[0]!.sql);
    expect(query).toContain("attachment_row.materialization_state = 'pending'");
    expect(query).toContain("content_row.state = 'available'");
    expect(query).toContain("message_row.content_state = 'available'");
    expect(query).toContain("payload_row.attachment_state = 'pending'");
    expect(query).toContain("tenant_auth_row.tenant_rbac_revision");
    expect(query).toContain("resource_auth_row.resource_access_revision");
    expect(query).toContain("inbox_v2_auth_command_records");
    expect(query).toContain(
      "authorization_command_row.authorization_not_after > clock.database_now"
    );
    expect(query).toContain('decision("notafter" timestamptz)');
    expect(query).toContain("for update of job");
  });

  it("cancels a stale active claim with a durable reason before any I/O", async () => {
    const executor = new QueueExecutor([
      [
        {
          state: "claimed",
          revision: claim.expectedJobRevision,
          lease_generation: claim.leaseGeneration,
          lease_expires_at: claim.leaseExpiresAt,
          database_now: t1,
          claim_matches: true,
          current_materialization_valid: false,
          current_access_valid: true
        }
      ],
      [{ id: claim.jobId }]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(repository.authorizeMaterializationIo(claim)).resolves.toBe(
      "cancelled"
    );
    const cancellation = normalizeSql(executor.queries[1]!.sql);
    expect(cancellation).toContain("set state = 'cancelled'");
    expect(cancellation).toContain("lease_token_hash = null");
    expect(cancellation).toContain(
      "core:attachment-materialization-current-fence-lost"
    );
    expect(cancellation).toContain("revision = revision + 1");
  });

  it("releases an access-stale exact claim to pending for reauthorization without I/O", async () => {
    const executor = new QueueExecutor([
      [
        {
          state: "claimed",
          revision: claim.expectedJobRevision,
          lease_generation: claim.leaseGeneration,
          lease_expires_at: claim.leaseExpiresAt,
          database_now: t1,
          claim_matches: true,
          current_materialization_valid: true,
          current_access_valid: false
        }
      ],
      [{ id: claim.jobId }]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(repository.authorizeMaterializationIo(claim)).resolves.toBe(
      "authorization_refresh_required"
    );
    const release = normalizeSql(executor.queries[1]!.sql);
    expect(release).toContain("set state = 'pending'");
    expect(release).toContain("lease_token_hash = null");
    expect(release).toContain("revision = revision + 1");
    expect(release).not.toContain("terminal_reason_id");
  });

  it("returns lease_lost before any registry write for an expired claim", async () => {
    const executor = new QueueExecutor([
      [
        {
          job_id: claim.jobId,
          job_state: "claimed",
          job_revision: claim.expectedJobRevision,
          attachment_id: contentFence.attachmentId,
          file_id: claim.fileId,
          expected_file_revision: claim.expectedFileRevision,
          expected_attachment_revision: "1",
          timeline_content_id: contentFence.timelineContentId,
          expected_content_revision: "1",
          content_block_key: contentFence.contentBlockKey,
          content_mutation_fence_sha256:
            calculateInboxV2AttachmentContentMutationFenceSha256({
              tenantId,
              attachmentId: contentFence.attachmentId,
              expectedAttachmentRevision: "1",
              timelineContentId: contentFence.timelineContentId,
              expectedContentRevision: "1",
              contentBlockKey: contentFence.contentBlockKey
            }),
          lease_generation: "1",
          lease_token_hash: rawHashA,
          lease_expires_at: t0,
          reserved_file_version_id: claim.fileVersionId,
          reserved_object_version_id: claim.objectVersionId,
          reserved_storage_root_id: claim.storageRootId,
          reserved_storage_object_key: claim.storageKey,
          result_file_version_id: null,
          result_object_version_id: null,
          result_file_revision: null,
          result_content_revision: null,
          terminal_reason_id: null,
          attempt_id: claim.attemptId,
          attempt_lease_token_hash: rawHashA,
          attempt_expected_job_revision: claim.expectedJobRevision,
          attempt_expected_file_revision: claim.expectedFileRevision,
          attempt_expected_attachment_revision: "1",
          file_state: "pending",
          file_revision: "1",
          file_data_class_id: contentFence.dataClassId,
          file_processing_purpose_id: contentFence.processingPurposeId,
          file_retention_anchor_at: contentFence.retentionAnchorAt,
          attachment_revision: "1",
          database_now: t1
        }
      ]
    ]);

    await expect(
      finalizeReadyInMessageMutation(executor, {
        claim,
        contentFence,
        storage: {
          storageKey: claim.storageKey,
          storageVersionId: "provider-version-repository",
          checksumSha256: `sha256:${rawHashA}`,
          sizeBytes: 123,
          mediaType: "application/pdf",
          putOutcome: "created"
        }
      })
    ).resolves.toBe("lease_lost");
    expect(executor.queries).toHaveLength(1);
    expect(normalizeSql(executor.queries[0]!.sql)).toContain(
      "for update of job, file, attachment"
    );
  });

  it("accepts an exact ready lost-ACK replay regardless of put outcome", async () => {
    for (const putOutcome of ["created", "already_exists"] as const) {
      const executor = new QueueExecutor([[terminalReadyReplayRow()]]);
      await expect(
        finalizeReadyInMessageMutation(executor, {
          claim,
          contentFence,
          storage: {
            storageKey: claim.storageKey,
            storageVersionId: "provider-version-repository",
            checksumSha256: `sha256:${rawHashA}`,
            sizeBytes: 123,
            mediaType: "application/pdf",
            putOutcome
          }
        })
      ).resolves.toBe("already_applied");
      expect(executor.queries).toHaveLength(1);
    }
  });

  it("rejects a contradictory terminal ready replay before any registry write", async () => {
    const executor = new QueueExecutor([[terminalReadyReplayRow()]]);
    await expect(
      finalizeReadyInMessageMutation(executor, {
        claim,
        contentFence,
        storage: {
          storageKey: claim.storageKey,
          storageVersionId: "provider-version-repository",
          checksumSha256: `sha256:${rawHashB}`,
          sizeBytes: 123,
          mediaType: "application/pdf",
          putOutcome: "already_exists"
        }
      })
    ).resolves.toBe("state_conflict");
    expect(executor.queries).toHaveLength(1);
  });

  it("binds failed replay to exact reason, retryability and result fences", async () => {
    const exact = new QueueExecutor([[terminalFailedReplayRow(true)]]);
    await expect(
      finalizeFailedInMessageMutation(exact, {
        claim,
        contentFence,
        code: "timeout",
        retryable: true
      })
    ).resolves.toBe("already_applied");
    expect(exact.queries).toHaveLength(1);

    const contradictory = new QueueExecutor([[terminalFailedReplayRow(true)]]);
    await expect(
      finalizeFailedInMessageMutation(contradictory, {
        claim,
        contentFence,
        code: "timeout",
        retryable: false
      })
    ).resolves.toBe("state_conflict");
    expect(contradictory.queries).toHaveLength(1);
  });

  it("finalizes ready bytes with a canonical retention anchor before database now", async () => {
    const oneRow = [{ id: "persisted" }];
    const executor = new QueueExecutor([
      [liveFinalizationRow()],
      [],
      [
        {
          content_id: contentFence.timelineContentId,
          content_revision: contentFence.resultingContentRevision,
          transition_kind: "attachment_materialization",
          attachment_id: contentFence.attachmentId,
          attachment_state: "ready",
          attachment_v2_file_id: claim.fileId,
          attachment_file_revision: "2",
          attachment_file_version_id: claim.fileVersionId,
          attachment_object_version_id: claim.objectVersionId,
          attachment_failure_reason_id: null,
          block_key: contentFence.contentBlockKey,
          owner_kind: contentFence.parentKind,
          owner_id: contentFence.parentEntityId,
          conversation_id: contentFence.conversationId,
          timeline_item_id: contentFence.timelineItemId,
          parent_entity_revision: contentFence.parentEntityRevision,
          timeline_visibility: "conversation_external"
        }
      ],
      ...Array.from({ length: 11 }, () => oneRow)
    ]);

    await expect(
      finalizeReadyInMessageMutation(executor, {
        claim,
        contentFence,
        storage: {
          storageKey: claim.storageKey,
          storageVersionId: "provider-version-repository",
          checksumSha256: `sha256:${rawHashA}`,
          sizeBytes: 123,
          mediaType: "application/pdf",
          putOutcome: "created"
        }
      })
    ).resolves.toMatchObject({ kind: "applied", outcome: "ready" });
    expect(Date.parse(contentFence.retentionAnchorAt)).toBeLessThan(
      Date.parse(t1)
    );
    expect(executor.queries).toHaveLength(14);
    expect(normalizeSql(executor.queries[3]!.sql)).toContain(
      "retention_anchor_at"
    );
    expect(executor.queries[3]!.params).toContain(
      contentFence.retentionAnchorAt
    );
  });

  it("attaches a second parent with its own canonical past retention anchor", async () => {
    const oneRow = [{ id: "persisted" }];
    const executor = new QueueExecutor([
      [
        {
          revision: "1",
          completeness: "complete",
          completeness_revision: "1",
          live_parent_count: 1,
          actual_live_parent_count: 1,
          exact_version_ready: true,
          database_now: t1
        }
      ],
      [],
      oneRow,
      oneRow,
      oneRow
    ]);

    await expect(
      attachFileParentInTransaction(executor, attachParentInput)
    ).resolves.toMatchObject({
      kind: "attached",
      parentSetRevision: "2",
      liveParentCount: 2
    });
    expect(Date.parse(attachParentInput.retentionAnchorAt)).toBeLessThan(
      Date.parse(t1)
    );
    const lockStatement = normalizeSql(executor.queries[0]!.sql);
    expect(lockStatement).not.toContain("file.retention_anchor_at =");
    expect(lockStatement).not.toContain("file.data_class_id =");
    expect(lockStatement).not.toContain("file.processing_purpose_id =");
  });

  it("records exact storage orphans idempotently and rejects evidence drift", async () => {
    const exactRow = {
      id: deriveInboxV2StorageOrphanId({
        tenantId,
        storageRootId: claim.storageRootId,
        storageKey: claim.storageKey,
        storageVersionIdentity: "provider-version-orphan"
      }),
      materialization_job_id: claim.jobId,
      storage_root_id: claim.storageRootId,
      storage_object_key: claim.storageKey,
      storage_version_identity: "provider-version-orphan",
      checksum_sha256: rawHashA,
      size_bytes: "123",
      detected_media_type: "application/pdf",
      state: "open",
      quarantine_reason_code: null,
      quarantine_evidence_digest_sha256: null,
      quarantine_physical_kind: null,
      inserted: true
    };
    const executor = new QueueExecutor([
      [{ claim_matches: true, exact_canonical_adoption: false }],
      [exactRow]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(
      repository.recordOrphan({
        claim,
        identity: {
          storageKey: claim.storageKey,
          versionId: "provider-version-orphan"
        },
        storageRootId: claim.storageRootId,
        checksumSha256: `sha256:${rawHashA}`,
        sizeBytes: 123,
        mediaType: "application/pdf",
        reasonCode: "ready_finalize_state_conflict",
        quarantine: null
      })
    ).resolves.toBe("recorded");

    const adoptionStatement = normalizeSql(executor.queries[0]!.sql);
    expect(adoptionStatement).toContain("for share of job");
    expect(adoptionStatement).toContain("job.state = 'ready'");
    expect(adoptionStatement).toContain(
      "object_version.storage_version_identity"
    );
    const statement = normalizeSql(executor.queries[1]!.sql);
    expect(statement).toContain("on conflict do nothing");
    expect(statement).toContain("union all");
    expect(executor.queries[1]!.params).not.toContain(
      "ready_finalize_state_conflict"
    );
  });

  it("persists quarantined exact-version evidence immutably and never adopts it", async () => {
    const evidenceDigestSha256 = "c".repeat(64);
    const orphanId = deriveInboxV2StorageOrphanId({
      tenantId,
      storageRootId: claim.storageRootId,
      storageKey: claim.storageKey,
      storageVersionIdentity: "provider-version-quarantined"
    });
    const executor = new QueueExecutor([
      [{ claim_matches: true, exact_canonical_adoption: true }],
      [
        {
          id: orphanId,
          materialization_job_id: claim.jobId,
          storage_root_id: claim.storageRootId,
          storage_object_key: claim.storageKey,
          storage_version_identity: "provider-version-quarantined",
          checksum_sha256: rawHashA,
          size_bytes: "123",
          detected_media_type: "application/pdf",
          state: "quarantined",
          quarantine_reason_code: "integrity.conditional_replay_mismatch",
          quarantine_evidence_digest_sha256: evidenceDigestSha256,
          quarantine_physical_kind: "s3_object_version_tags",
          inserted: true
        }
      ]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);
    const quarantine = {
      reasonCode: "integrity.conditional_replay_mismatch",
      evidenceSha256: `sha256:${evidenceDigestSha256}`,
      physicalKind: "s3_object_version_tags"
    };

    await expect(
      repository.recordOrphan({
        claim,
        identity: {
          storageKey: claim.storageKey,
          versionId: "provider-version-quarantined"
        },
        storageRootId: claim.storageRootId,
        checksumSha256: `sha256:${rawHashA}`,
        sizeBytes: 123,
        mediaType: "application/pdf",
        reasonCode: "object_storage.immutable_conflict",
        quarantine
      })
    ).resolves.toBe("recorded");

    expect(executor.queries).toHaveLength(2);
    const adoptionStatement = normalizeSql(executor.queries[0]!.sql);
    expect(adoptionStatement).toContain("and job.state = 'ready'");
    expect(executor.queries[0]!.params).toContain(false);
    const insertStatement = normalizeSql(executor.queries[1]!.sql);
    expect(insertStatement).toContain("quarantine_reason_code");
    expect(insertStatement).toContain("quarantine_evidence_digest_sha256");
    expect(insertStatement).toContain("quarantine_physical_kind");
    expect(executor.queries[1]!.params).toEqual(
      expect.arrayContaining([
        "quarantined",
        quarantine.reasonCode,
        evidenceDigestSha256,
        quarantine.physicalKind
      ])
    );

    const driftExecutor = new QueueExecutor([
      [{ claim_matches: true, exact_canonical_adoption: false }],
      [
        {
          id: orphanId,
          materialization_job_id: claim.jobId,
          storage_root_id: claim.storageRootId,
          storage_object_key: claim.storageKey,
          storage_version_identity: "provider-version-quarantined",
          checksum_sha256: rawHashA,
          size_bytes: "123",
          detected_media_type: "application/pdf",
          state: "quarantined",
          quarantine_reason_code: quarantine.reasonCode,
          quarantine_evidence_digest_sha256: "d".repeat(64),
          quarantine_physical_kind: quarantine.physicalKind,
          inserted: false
        }
      ]
    ]);
    await expect(
      createSqlInboxV2FileObjectRepository(driftExecutor).recordOrphan({
        claim,
        identity: {
          storageKey: claim.storageKey,
          versionId: "provider-version-quarantined"
        },
        storageRootId: claim.storageRootId,
        checksumSha256: `sha256:${rawHashA}`,
        sizeBytes: 123,
        mediaType: "application/pdf",
        reasonCode: "object_storage.immutable_conflict",
        quarantine
      })
    ).rejects.toMatchObject({
      code: "inbox_v2.storage_orphan_identity_conflict"
    });
  });

  it("recognizes a committed exact object as adopted before opening an orphan", async () => {
    const executor = new QueueExecutor([
      [{ claim_matches: true, exact_canonical_adoption: true }]
    ]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(
      repository.recordOrphan({
        claim,
        identity: {
          storageKey: claim.storageKey,
          versionId: "provider-version-adopted"
        },
        storageRootId: claim.storageRootId,
        checksumSha256: `sha256:${rawHashA}`,
        sizeBytes: 123,
        mediaType: "application/pdf",
        reasonCode: "ready_finalize_ack_uncertain",
        quarantine: null
      })
    ).resolves.toBe("adopted");

    expect(executor.queries).toHaveLength(1);
    const statement = normalizeSql(executor.queries[0]!.sql);
    expect(statement).toContain("job.result_file_version_id");
    expect(statement).toContain("job.result_object_version_id");
    expect(statement).toContain("inbox_v2_file_object_versions");
    expect(statement).toContain("inbox_v2_file_versions");
  });

  it("keeps finalization locks tenant-scoped and exact-attempt scoped", () => {
    const statement = normalizeSql(
      renderQuery(
        buildLockInboxV2AttachmentMaterializationFinalizationSql(claim)
      ).sql
    );
    expect(statement).toContain("job.tenant_id = $2");
    expect(statement).toContain("job.id = $3");
    expect(statement).toContain("attempt.id = $1");
    expect(statement).toContain("for update of job, file, attachment");
  });

  it("builds bounded, tenant-exact plan reads", () => {
    const statement = normalizeSql(
      renderQuery(
        buildLoadInboxV2OutboundDispatchContentPlanSql({
          tenantId,
          dispatchId: dispatchPlan().dispatch.id
        })
      ).sql
    );
    expect(statement).toContain("where plan.tenant_id = $1");
    expect(statement).toContain("and plan.dispatch_id = $2");
    expect(statement).toContain("order by artifact.ordinal asc");
    expect(statement).toContain("limit 64");
  });

  it("serializes parent attach and detach against the complete parent-set authority", () => {
    const attachStatement = normalizeSql(
      renderQuery(buildLockInboxV2FileParentSetSql(attachParentInput)).sql
    );
    expect(attachStatement).toContain("for update of parent_head");
    expect(attachStatement).toContain("actual_live_parent_count");
    expect(attachStatement).toContain("object_head.state = 'ready'");
    expect(attachStatement).toContain(
      "file.current_object_version_id = file_version.object_version_id"
    );

    const detachStatement = normalizeSql(
      renderQuery(buildLockInboxV2FileParentDetachSql(detachParentInput)).sql
    );
    expect(detachStatement).toContain("for update of parent_head, link_head");
    expect(detachStatement).toContain("actual_live_parent_count");
    expect(detachStatement).toContain("link.id = $1");
  });

  it("fails closed when deletion purpose/hold authority is unavailable", async () => {
    const executor = new QueueExecutor([]);
    const repository = createSqlInboxV2FileObjectRepository(executor);

    await expect(
      repository.authorizeObjectDeletion({
        tenantId,
        objectVersionId: claim.objectVersionId,
        expectedObjectHeadRevision: "1"
      })
    ).resolves.toEqual({ kind: "denied", code: "authority_unavailable" });
    expect(executor.queries).toHaveLength(0);
  });

  it("authorizes deletion only after same-transaction zero-parent and zero-hold evidence", async () => {
    const executor = new QueueExecutor([
      [
        {
          object_version_id: claim.objectVersionId,
          state: "ready",
          revision: "1",
          file_version_count: 1,
          database_now: t1
        }
      ],
      [
        {
          file_id: claim.fileId,
          revision: "2",
          completeness: "complete",
          completeness_revision: "2",
          live_parent_count: 0,
          actual_live_parent_count: 0
        }
      ]
    ]);
    let authorityExecutor: unknown;
    const repository = createSqlInboxV2FileObjectRepository(executor, {
      purposeAndHoldAuthorityLoader: async (transaction) => {
        authorityExecutor = transaction;
        return {
          activePurposeCount: "0",
          activeHoldCount: "0",
          authorityDigestSha256: `sha256:${rawHashB}`
        };
      }
    });

    const result = await repository.authorizeObjectDeletion({
      tenantId,
      objectVersionId: claim.objectVersionId,
      expectedObjectHeadRevision: "1"
    });

    expect(result).toMatchObject({
      kind: "authorized",
      expectedObjectHeadRevision: "1",
      liveParentCount: "0",
      activePurposeCount: "0",
      activeHoldCount: "0",
      evaluatedAt: t1
    });
    expect(authorityExecutor).toBe(executor);
    expect(executor.queries).toHaveLength(2);
    expect(normalizeSql(executor.queries[0]!.sql)).toContain(
      "for update of object_head"
    );
    expect(normalizeSql(executor.queries[1]!.sql)).toContain(
      "for share of parent_head"
    );
  });
});

class QueueExecutor implements InboxV2FileObjectTransactionExecutor {
  readonly queries: Array<{ sql: string; params: unknown[] }> = [];
  private responseIndex = 0;

  constructor(
    private readonly responses: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async transaction<TResult>(
    work: (transaction: QueueExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    expect(config).toEqual({ isolationLevel: "read committed" });
    return work(this);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(renderQuery(query));
    const rows = this.responses[this.responseIndex];
    this.responseIndex += 1;
    if (rows === undefined) {
      throw new Error(
        `Unexpected SQL: ${normalizeSql(renderQuery(query).sql)}`
      );
    }
    return { rows: rows as readonly Row[] };
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
