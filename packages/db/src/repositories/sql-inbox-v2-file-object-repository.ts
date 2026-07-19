import {
  canonicalizeInboxV2Json,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2RoutingTokenSchema,
  inboxV2TenantIdSchema,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2TenantId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";
import { createHash, randomBytes } from "node:crypto";

import type { HuleeDatabase } from "../client";
import {
  registerInboxV2AtomicAttachmentMaterializationProof,
  requireInboxV2AtomicSealExecutor
} from "./sql-inbox-v2-atomic-materialization-internal";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import {
  assertInboxV2AuthorizedAtomicMaterializationContext,
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedAtomicMaterializationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const FILE_OBJECT_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const MATERIALIZATION_CLAIM_LIMIT_MAX = 64;
const MATERIALIZATION_AUTHORIZATION_REFRESH_LIMIT_MAX = 100;
const MATERIALIZATION_LEASE_SECONDS_MIN = 5;
const MATERIALIZATION_LEASE_SECONDS_MAX = 900;
const ATTACHMENT_SOURCE_LOCATOR_HANDLE_PATTERN = /^src_ref_[A-Za-z0-9_-]{43}$/u;
export const INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID =
  "core:attachment.materialization.reserve";
export const INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID =
  "core:attachment.materialization.reauthorize";
export const INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID =
  "core:attachment.materialization.complete";
const preparedReadyAttachmentMaterializationBrand: unique symbol = Symbol(
  "inbox-v2-prepared-ready-attachment-materialization"
);
const preparedFailedAttachmentMaterializationBrand: unique symbol = Symbol(
  "inbox-v2-prepared-failed-attachment-materialization"
);

export type InboxV2FileObjectTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

export type InboxV2FileObjectConflictCode =
  | "attachment_not_pending"
  | "attachment_revision_conflict"
  | "content_fence_conflict"
  | "file_conflict"
  | "job_conflict"
  | "reservation_conflict"
  | "dispatch_plan_conflict";

export type PersistInboxV2OutboundDispatchContentPlanResult =
  | Readonly<{ kind: "persisted" | "already_persisted" }>
  | Readonly<{
      kind: "conflict";
      code: "dispatch_plan_conflict";
    }>;

export type ReserveInboxV2AttachmentMaterializationInput = Readonly<{
  tenantId: string;
  jobId: string;
  attachmentId: string;
  file: Readonly<{
    id: string;
    expectedRevision: string;
    dataClassId: string;
    processingPurposeId: string;
    retentionAnchorAt: string;
  }>;
  content: Readonly<{
    conversationId: string;
    timelineItemId: string;
    parentMessageId: string;
    expectedParentRevision: string;
    visibilityBoundary: "external_work" | "internal";
    id: string;
    expectedRevision: string;
    blockKey: string;
    mutationFenceSha256: string;
  }>;
  sourceOccurrenceId: string | null;
  sourceLocator: Readonly<{
    kind: "provider" | "upload_staging" | "derivative";
    reference: string;
  }>;
  reservationNamespaceGeneration: string;
  causeEventId: string;
  causeMutationId: string;
  causeStreamCommitId: string;
  causeStreamPosition: string;
  correlationId: string;
  causedAt: string;
  idempotencyToken: string;
  expectedAttachmentRevision: string;
  reservation: Readonly<{
    fileVersionId: string;
    objectVersionId: string;
    storageRootId: string;
    storageKey: string;
  }>;
}>;

export type ReserveInboxV2AttachmentMaterializationResult =
  | Readonly<{
      kind: "reserved" | "already_reserved";
      jobId: string;
      fileId: string;
      fileVersionId: string;
      objectVersionId: string;
      storageRootId: string;
      storageKey: string;
    }>
  | Readonly<{
      kind: "conflict";
      code: Exclude<InboxV2FileObjectConflictCode, "dispatch_plan_conflict">;
    }>;

export type ClaimInboxV2AttachmentMaterializationJobsInput = Readonly<{
  tenantId: string;
  workerId: string;
  batchSize?: number;
  leaseDurationSeconds?: number;
}>;

export type ListInboxV2PendingMaterializationAuthorizationRefreshCandidatesInput =
  Readonly<{
    tenantId: string;
    limit?: number;
  }>;

export type InboxV2PendingMaterializationAuthorizationRefreshCandidate =
  Readonly<{
    tenantId: string;
    jobId: string;
    expectedJobRevision: string;
  }>;

export type ReauthorizeInboxV2PendingMaterializationInput = Readonly<{
  jobId: string;
  expectedJobRevision: string;
}>;

export type ReauthorizeInboxV2PendingMaterializationResult =
  | Readonly<{ kind: "refreshed"; resultingJobRevision: string }>
  | Readonly<{ kind: "already_current"; jobRevision: string }>
  | Readonly<{
      kind: "not_found" | "state_conflict" | "authorization_conflict";
    }>;

export type InboxV2AttachmentMaterializationClaim = Readonly<{
  tenantId: string;
  jobId: string;
  attachmentId: string;
  attemptId: string;
  leaseToken: string;
  leaseGeneration: string;
  workerId: string;
  claimedAt: string;
  leaseExpiresAt: string;
  expectedJobRevision: string;
  fileId: string;
  expectedFileRevision: string;
  dataClassId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
  fileVersionId: string;
  objectVersionId: string;
  storageRootId: string;
  storageKey: string;
  contentOrigin: Readonly<{
    conversationId: string;
    timelineItemId: string;
    parentKind: "message";
    parentEntityId: string;
    expectedParentRevision: string;
    timelineContentId: string;
    expectedContentRevision: string;
    contentBlockKey: string;
    expectedAttachmentRevision: string;
    visibilityBoundary: "external_work" | "internal";
  }>;
  sourceLocator: Readonly<{
    kind: "provider" | "upload_staging" | "derivative";
    reference: string;
  }>;
  reservationNamespaceGeneration: string;
  sourceOccurrenceId: string | null;
  causeEventId: string;
  causeMutationId: string;
  causeStreamCommitId: string;
  causeStreamPosition: string;
  correlationId: string;
  causedAt: string;
  reservationAuthority: Readonly<{
    commandId: string;
    commandTypeId: string;
    clientMutationId: string;
    mutationId: string;
    decisionId: string;
    epoch: string;
    actor: InboxV2AuthorizedCommandMutationContext["actor"];
    authorizedAt: string;
    decisionSetDigestSha256: string;
    resourceFenceSetDigestSha256: string;
    tenantRbacRevision: string;
    sharedAccessRevision: string;
    resourceHeadId: string;
    resourceAccessRevision: string;
    structuralRelationRevision: string;
    collaboratorSetRevision: string;
    auditGrantSourceIds: readonly string[];
    auditPolicyVersion: string | null;
  }>;
}>;

export type AuthorizeInboxV2AttachmentMaterializationIoResult =
  | "authorized"
  | "cancelled"
  | "already_terminal"
  | "authorization_refresh_required"
  | "lease_lost"
  | "state_conflict";

export type CountInboxV2NonterminalMaterializationsForReservationNamespaceInput =
  Readonly<{
    tenantId: string;
    reservationNamespaceGeneration: string;
  }>;

export type InboxV2AttachmentMaterializationContentFence = Readonly<{
  tenantId: string;
  conversationId: string;
  timelineItemId: string;
  timelineContentId: string;
  resultingContentRevision: string;
  contentBlockKey: string;
  attachmentId: string;
  resultingAttachmentRevision: string;
  parentKind: "message" | "staff_note";
  parentEntityId: string;
  parentEntityRevision: string;
  visibilityBoundary: "external_work" | "internal" | "staff_note";
  parentConversationVisibility: "external_work" | "internal" | null;
  dataClassId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
}>;

export type InboxV2AttachmentReadyPersistenceInput = Readonly<{
  claim: InboxV2AttachmentMaterializationClaim;
  storage: Readonly<{
    storageKey: string;
    storageVersionId: string;
    checksumSha256: string;
    sizeBytes: number;
    mediaType: string;
    putOutcome: "created" | "already_exists";
  }>;
}>;

export type InboxV2AppliedAttachmentMaterializationClosure = Readonly<{
  kind: "applied";
  jobId: string;
  evidenceId: string;
  outcome: "ready" | "failed";
  fileId: string;
  fileVersionId: string | null;
  objectVersionId: string | null;
  attachmentId: string;
  attachmentRevision: string;
  contentId: string;
  contentRevision: string;
}>;

export type InboxV2NonAppliedAttachmentMaterializationResult =
  | "already_applied"
  | "lease_lost"
  | "state_conflict";

export type FinalizeInboxV2AttachmentMaterializationResult =
  | InboxV2AppliedAttachmentMaterializationClosure
  | InboxV2NonAppliedAttachmentMaterializationResult;

export type PreflightInboxV2AttachmentMaterializationResult =
  | "proceed"
  | InboxV2NonAppliedAttachmentMaterializationResult;

export type InboxV2PreparedReadyAttachmentMaterializationCapability = Readonly<{
  [preparedReadyAttachmentMaterializationBrand]: true;
}>;

export type InboxV2PreparedFailedAttachmentMaterializationCapability =
  Readonly<{
    [preparedFailedAttachmentMaterializationBrand]: true;
  }>;

export type PrepareInboxV2ReadyAttachmentMaterializationResult =
  | Readonly<{
      kind: "proceed";
      capability: InboxV2PreparedReadyAttachmentMaterializationCapability;
    }>
  | Readonly<{
      kind: InboxV2NonAppliedAttachmentMaterializationResult;
    }>;

export type PrepareInboxV2FailedAttachmentMaterializationResult =
  | Readonly<{
      kind: "proceed";
      capability: InboxV2PreparedFailedAttachmentMaterializationCapability;
    }>
  | Readonly<{
      kind: InboxV2NonAppliedAttachmentMaterializationResult;
    }>;

export type InboxV2AttachmentMaterializationMutationRunner = Readonly<{
  ready(
    input: InboxV2AttachmentReadyPersistenceInput
  ): Promise<FinalizeInboxV2AttachmentMaterializationResult>;
  failed(
    input: Readonly<{
      claim: InboxV2AttachmentMaterializationClaim;
      code: string;
      retryable: boolean;
    }>
  ): Promise<FinalizeInboxV2AttachmentMaterializationResult>;
}>;

export type RecordInboxV2StorageOrphanInput = Readonly<{
  claim: InboxV2AttachmentMaterializationClaim;
  identity: Readonly<{ storageKey: string; versionId: string }>;
  storageRootId: string;
  checksumSha256: string;
  sizeBytes: number;
  mediaType: string;
  reasonCode: string;
  quarantine: Readonly<{
    reasonCode: string;
    evidenceSha256: string;
    physicalKind: string;
  }> | null;
}>;

export type InboxV2FileParentDescriptor = Readonly<{
  kind: "message" | "staff_note" | "upload_staging";
  purpose: "attachment" | "extension_payload";
  visibilityBoundary:
    | "external_work"
    | "internal"
    | "staff_note"
    | "upload_staging";
  parentConversationVisibility: "external_work" | "internal" | null;
  entityId: string;
  entityRevision: string;
  conversationId: string | null;
  timelineItemId: string | null;
  contentId: string | null;
  contentRevision: string | null;
  blockKey: string | null;
}>;

export type AttachInboxV2FileParentInput = Readonly<{
  tenantId: string;
  fileId: string;
  fileVersionId: string;
  objectVersionId: string;
  expectedParentSetRevision: string;
  parent: InboxV2FileParentDescriptor;
  dataClassId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
}>;

export type AttachInboxV2FileParentResult =
  | Readonly<{
      kind: "attached" | "already_attached";
      linkId: string;
      parentSetRevision: string;
      liveParentCount: number;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "file_parent_set_missing"
        | "file_parent_set_incomplete"
        | "file_parent_set_revision_conflict"
        | "file_parent_count_conflict"
        | "file_parent_link_conflict"
        | "file_version_fence_conflict";
    }>;

export type DetachInboxV2FileParentInput = Readonly<{
  tenantId: string;
  fileId: string;
  linkId: string;
  expectedParentSetRevision: string;
  expectedLinkRevision: string;
  detachedByEventId: string;
}>;

export type DetachInboxV2FileParentResult =
  | Readonly<{
      kind: "detached" | "already_detached";
      linkId: string;
      objectVersionId: string;
      parentSetRevision: string;
      liveParentCount: number;
      deletionCandidate: boolean;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "file_parent_link_missing"
        | "file_parent_set_incomplete"
        | "file_parent_set_revision_conflict"
        | "file_parent_count_conflict"
        | "file_parent_link_revision_conflict"
        | "file_parent_link_conflict"
        | "detach_event_missing";
    }>;

export type InboxV2FilePurposeAndHoldAuthorityLoader = (
  executor: RawSqlExecutor,
  input: Readonly<{ tenantId: string; objectVersionId: string }>
) => Promise<
  Readonly<{
    activePurposeCount: string;
    activeHoldCount: string;
    authorityDigestSha256: string;
  }>
>;

export type AuthorizeInboxV2ObjectDeletionInput = Readonly<{
  tenantId: string;
  objectVersionId: string;
  expectedObjectHeadRevision: string;
}>;

export type AuthorizeInboxV2ObjectDeletionResult =
  | Readonly<{
      kind: "authorized";
      expectedObjectHeadRevision: string;
      liveParentCount: "0";
      activePurposeCount: "0";
      activeHoldCount: "0";
      evaluatedAt: string;
      decisionDigestSha256: string;
    }>
  | Readonly<{
      kind: "denied";
      code:
        | "authority_unavailable"
        | "object_version_not_found"
        | "object_head_revision_conflict"
        | "object_state_conflict"
        | "parent_set_incomplete"
        | "live_parent_exists"
        | "active_purpose_exists"
        | "active_hold_exists";
    }>;

export type InboxV2FileObjectRepository = Readonly<{
  reserveMaterialization(
    context: InboxV2AuthorizedCommandMutationContext,
    input: ReserveInboxV2AttachmentMaterializationInput
  ): Promise<ReserveInboxV2AttachmentMaterializationResult>;
  claimMaterializationJobs(
    input: ClaimInboxV2AttachmentMaterializationJobsInput
  ): Promise<readonly InboxV2AttachmentMaterializationClaim[]>;
  listPendingMaterializationAuthorizationRefreshCandidates(
    input: ListInboxV2PendingMaterializationAuthorizationRefreshCandidatesInput
  ): Promise<
    readonly InboxV2PendingMaterializationAuthorizationRefreshCandidate[]
  >;
  reauthorizePendingMaterialization(
    context: InboxV2AuthorizedCommandMutationContext,
    input: ReauthorizeInboxV2PendingMaterializationInput
  ): Promise<ReauthorizeInboxV2PendingMaterializationResult>;
  countNonterminalMaterializationsForReservationNamespace(
    input: CountInboxV2NonterminalMaterializationsForReservationNamespaceInput
  ): Promise<string>;
  authorizeMaterializationIo(
    claim: InboxV2AttachmentMaterializationClaim
  ): Promise<AuthorizeInboxV2AttachmentMaterializationIoResult>;
  finalizeReady(
    input: InboxV2AttachmentReadyPersistenceInput
  ): Promise<FinalizeInboxV2AttachmentMaterializationResult>;
  finalizeFailed(
    input: Readonly<{
      claim: InboxV2AttachmentMaterializationClaim;
      code: string;
      retryable: boolean;
    }>
  ): Promise<FinalizeInboxV2AttachmentMaterializationResult>;
  recordOrphan(
    input: RecordInboxV2StorageOrphanInput
  ): Promise<"adopted" | "recorded" | "already_recorded">;
  attachParent(
    input: AttachInboxV2FileParentInput
  ): Promise<AttachInboxV2FileParentResult>;
  detachParent(
    input: DetachInboxV2FileParentInput
  ): Promise<DetachInboxV2FileParentResult>;
  authorizeObjectDeletion(
    input: AuthorizeInboxV2ObjectDeletionInput
  ): Promise<AuthorizeInboxV2ObjectDeletionResult>;
}>;

type ExistingMaterializationJobRow = {
  id: unknown;
  attachment_id: unknown;
  file_id: unknown;
  expected_file_revision: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  parent_message_id: unknown;
  expected_parent_revision: unknown;
  visibility_boundary: unknown;
  timeline_content_id: unknown;
  expected_content_revision: unknown;
  content_block_key: unknown;
  content_mutation_fence_sha256: unknown;
  source_occurrence_id: unknown;
  source_locator_kind: unknown;
  source_locator_reference: unknown;
  source_locator_digest_sha256: unknown;
  reservation_namespace_generation: unknown;
  cause_event_id: unknown;
  cause_mutation_id: unknown;
  cause_stream_commit_id: unknown;
  cause_stream_position: unknown;
  correlation_id: unknown;
  caused_at: unknown;
  authorization_command_id: unknown;
  authorization_command_type_id: unknown;
  authorization_client_mutation_id: unknown;
  authorization_mutation_id: unknown;
  authorization_decision_id: unknown;
  authorization_epoch: unknown;
  authorization_actor_kind: unknown;
  authorization_actor_id: unknown;
  authorization_authorized_at: unknown;
  authorization_decision_set_digest_sha256: unknown;
  authorization_resource_fence_set_digest_sha256: unknown;
  authorization_tenant_rbac_revision: unknown;
  authorization_shared_access_revision: unknown;
  authorization_resource_head_id: unknown;
  authorization_resource_access_revision: unknown;
  authorization_structural_relation_revision: unknown;
  authorization_collaborator_set_revision: unknown;
  authorization_audit_grant_source_ids: unknown;
  authorization_audit_policy_version: unknown;
  idempotency_token: unknown;
  expected_attachment_revision: unknown;
  reserved_file_version_id: unknown;
  reserved_object_version_id: unknown;
  reserved_storage_root_id: unknown;
  reserved_storage_object_key: unknown;
};

type PendingMaterializationAuthorizationRefreshCandidateRow = {
  tenant_id: unknown;
  job_id: unknown;
  expected_job_revision: unknown;
};

type PendingMaterializationReauthorizationRow =
  ExistingMaterializationJobRow & {
    state: unknown;
    revision: unknown;
    lease_generation: unknown;
    lease_token_hash: unknown;
    lease_owner_id: unknown;
    lease_claimed_at: unknown;
    lease_expires_at: unknown;
    current_materialization_valid: unknown;
  };

type IdRow = { id: unknown };
type CountRow = { count: unknown };

type AttachmentReservationFenceRow = {
  attachment_revision: unknown;
  content_revision: unknown;
  attachment_state: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  parent_message_id: unknown;
  parent_message_revision: unknown;
  timeline_visibility: unknown;
  origin_source_occurrence_id: unknown;
};

type ClaimedMaterializationRow = {
  tenant_id: unknown;
  job_id: unknown;
  attachment_id: unknown;
  attempt_id: unknown;
  raw_lease_token: unknown;
  lease_generation: unknown;
  lease_owner_id: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  expected_job_revision: unknown;
  file_id: unknown;
  expected_file_revision: unknown;
  file_data_class_id: unknown;
  file_processing_purpose_id: unknown;
  file_retention_anchor_at: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  parent_message_id: unknown;
  expected_parent_revision: unknown;
  visibility_boundary: unknown;
  timeline_content_id: unknown;
  expected_content_revision: unknown;
  content_block_key: unknown;
  expected_attachment_revision: unknown;
  reserved_file_version_id: unknown;
  reserved_object_version_id: unknown;
  reserved_storage_root_id: unknown;
  reserved_storage_object_key: unknown;
  source_locator_kind: unknown;
  source_locator_reference: unknown;
  source_locator_digest_sha256: unknown;
  reservation_namespace_generation: unknown;
  source_occurrence_id: unknown;
  cause_event_id: unknown;
  cause_mutation_id: unknown;
  cause_stream_commit_id: unknown;
  cause_stream_position: unknown;
  correlation_id: unknown;
  caused_at: unknown;
  authorization_command_id: unknown;
  authorization_command_type_id: unknown;
  authorization_client_mutation_id: unknown;
  authorization_mutation_id: unknown;
  authorization_decision_id: unknown;
  authorization_epoch: unknown;
  authorization_actor_kind: unknown;
  authorization_actor_id: unknown;
  authorization_authorized_at: unknown;
  authorization_decision_set_digest_sha256: unknown;
  authorization_resource_fence_set_digest_sha256: unknown;
  authorization_tenant_rbac_revision: unknown;
  authorization_shared_access_revision: unknown;
  authorization_resource_head_id: unknown;
  authorization_resource_access_revision: unknown;
  authorization_structural_relation_revision: unknown;
  authorization_collaborator_set_revision: unknown;
  authorization_audit_grant_source_ids: unknown;
  authorization_audit_policy_version: unknown;
};

type MaterializationIoAuthorizationRow = {
  state: unknown;
  revision: unknown;
  lease_generation: unknown;
  database_now: unknown;
  lease_expires_at: unknown;
  claim_matches: unknown;
  current_materialization_valid: unknown;
  current_access_valid: unknown;
};

type MaterializationFinalizationRow = {
  job_id: unknown;
  job_state: unknown;
  job_revision: unknown;
  attachment_id: unknown;
  file_id: unknown;
  expected_file_revision: unknown;
  expected_attachment_revision: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  parent_message_id: unknown;
  expected_parent_revision: unknown;
  visibility_boundary: unknown;
  timeline_content_id: unknown;
  expected_content_revision: unknown;
  content_block_key: unknown;
  content_mutation_fence_sha256: unknown;
  source_occurrence_id: unknown;
  source_locator_kind: unknown;
  source_locator_reference: unknown;
  source_locator_digest_sha256: unknown;
  reservation_namespace_generation: unknown;
  cause_event_id: unknown;
  cause_mutation_id: unknown;
  cause_stream_commit_id: unknown;
  cause_stream_position: unknown;
  correlation_id: unknown;
  caused_at: unknown;
  authorization_command_id: unknown;
  authorization_command_type_id: unknown;
  authorization_client_mutation_id: unknown;
  authorization_mutation_id: unknown;
  authorization_decision_id: unknown;
  authorization_epoch: unknown;
  authorization_actor_kind: unknown;
  authorization_actor_id: unknown;
  authorization_authorized_at: unknown;
  authorization_decision_set_digest_sha256: unknown;
  authorization_resource_fence_set_digest_sha256: unknown;
  authorization_tenant_rbac_revision: unknown;
  authorization_shared_access_revision: unknown;
  authorization_resource_head_id: unknown;
  authorization_resource_access_revision: unknown;
  authorization_structural_relation_revision: unknown;
  authorization_collaborator_set_revision: unknown;
  authorization_audit_grant_source_ids: unknown;
  authorization_audit_policy_version: unknown;
  lease_generation: unknown;
  lease_token_hash: unknown;
  lease_owner_id: unknown;
  lease_expires_at: unknown;
  reserved_file_version_id: unknown;
  reserved_object_version_id: unknown;
  reserved_storage_root_id: unknown;
  reserved_storage_object_key: unknown;
  result_file_version_id: unknown;
  result_object_version_id: unknown;
  result_file_revision: unknown;
  result_content_revision: unknown;
  terminal_reason_id: unknown;
  attempt_id: unknown;
  attempt_job_id: unknown;
  attempt_attachment_id: unknown;
  attempt_file_id: unknown;
  attempt_lease_generation: unknown;
  attempt_lease_token_hash: unknown;
  attempt_lease_owner_id: unknown;
  attempt_expected_job_revision: unknown;
  attempt_expected_file_revision: unknown;
  attempt_expected_attachment_revision: unknown;
  attempt_claimed_at: unknown;
  attempt_lease_expires_at: unknown;
  file_state: unknown;
  file_revision: unknown;
  file_current_file_version_id: unknown;
  file_current_object_version_id: unknown;
  file_data_class_id: unknown;
  file_processing_purpose_id: unknown;
  file_retention_anchor_at: unknown;
  attachment_revision: unknown;
  terminal_content_id: unknown;
  terminal_content_revision: unknown;
  terminal_content_transition_kind: unknown;
  terminal_payload_attachment_id: unknown;
  terminal_payload_attachment_state: unknown;
  terminal_payload_file_id: unknown;
  terminal_payload_file_revision: unknown;
  terminal_payload_file_version_id: unknown;
  terminal_payload_object_version_id: unknown;
  terminal_payload_failure_reason_id: unknown;
  terminal_payload_block_key: unknown;
  terminal_owner_kind: unknown;
  terminal_owner_id: unknown;
  terminal_conversation_id: unknown;
  terminal_timeline_item_id: unknown;
  terminal_parent_entity_revision: unknown;
  terminal_timeline_visibility: unknown;
  replay_file_version_id: unknown;
  replay_file_version_file_id: unknown;
  replay_file_version_object_version_id: unknown;
  replay_object_version_id: unknown;
  replay_storage_root_id: unknown;
  replay_storage_object_key: unknown;
  replay_storage_version_identity: unknown;
  replay_checksum_sha256: unknown;
  replay_size_bytes: unknown;
  replay_declared_media_type: unknown;
  replay_detected_media_type: unknown;
  replay_object_head_state: unknown;
  replay_object_head_evidence_id: unknown;
  replay_operation_evidence_id: unknown;
  replay_operation_object_version_id: unknown;
  replay_operation_job_id: unknown;
  replay_operation_kind: unknown;
  replay_operation_storage_root_id: unknown;
  replay_operation_attempt_token: unknown;
  replay_operation_outcome: unknown;
  replay_operation_affected_bytes: unknown;
  replay_evidence_id: unknown;
  replay_evidence_job_id: unknown;
  replay_evidence_attempt_id: unknown;
  replay_evidence_attachment_id: unknown;
  replay_evidence_file_id: unknown;
  replay_evidence_expected_file_revision: unknown;
  replay_evidence_lease_generation: unknown;
  replay_evidence_expected_attachment_revision: unknown;
  replay_evidence_resulting_attachment_revision: unknown;
  replay_evidence_content_id: unknown;
  replay_evidence_expected_content_revision: unknown;
  replay_evidence_resulting_content_revision: unknown;
  replay_evidence_content_fence_sha256: unknown;
  replay_evidence_outcome: unknown;
  replay_evidence_file_version_id: unknown;
  replay_evidence_object_version_id: unknown;
  replay_evidence_resulting_file_revision: unknown;
  replay_evidence_operation_id: unknown;
  replay_evidence_safe_reason_id: unknown;
  replay_evidence_retryable: unknown;
  replay_evidence_hash_sha256: unknown;
  database_now: unknown;
};

type MaterializationContentFenceRow = {
  content_id: unknown;
  content_revision: unknown;
  transition_kind: unknown;
  attachment_id: unknown;
  attachment_state: unknown;
  attachment_v2_file_id: unknown;
  attachment_file_revision: unknown;
  attachment_file_version_id: unknown;
  attachment_object_version_id: unknown;
  attachment_failure_reason_id: unknown;
  block_key: unknown;
  owner_kind: unknown;
  owner_id: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  parent_entity_revision: unknown;
  timeline_visibility: unknown;
};

type StorageOrphanRow = {
  id: unknown;
  materialization_job_id: unknown;
  storage_root_id: unknown;
  storage_object_key: unknown;
  storage_version_identity: unknown;
  checksum_sha256: unknown;
  size_bytes: unknown;
  detected_media_type: unknown;
  state: unknown;
  quarantine_reason_code: unknown;
  quarantine_evidence_digest_sha256: unknown;
  quarantine_physical_kind: unknown;
  inserted: unknown;
};

type StorageOrphanAdoptionCandidateRow = {
  id: unknown;
  materialization_job_id: unknown;
  storage_root_id: unknown;
  storage_object_key: unknown;
  storage_version_identity: unknown;
  checksum_sha256: unknown;
  size_bytes: unknown;
  detected_media_type: unknown;
  state: unknown;
  claim_token_hash: unknown;
  claim_expires_at: unknown;
  adopted_object_version_id: unknown;
  terminal_evidence_digest_sha256: unknown;
  safe_reason_id: unknown;
  quarantine_reason_code: unknown;
  quarantine_evidence_digest_sha256: unknown;
  quarantine_physical_kind: unknown;
  revision: unknown;
};

type StorageOrphanAdoptionRow = {
  claim_matches: unknown;
  exact_canonical_adoption: unknown;
};

type FileParentSetLockRow = {
  revision: unknown;
  completeness: unknown;
  completeness_revision: unknown;
  live_parent_count: unknown;
  actual_live_parent_count: unknown;
  exact_version_ready: unknown;
  database_now: unknown;
};

type ExistingFileParentLinkRow = {
  id: unknown;
  file_version_id: unknown;
  object_version_id: unknown;
  parent_identity_digest_sha256: unknown;
  parent_kind: unknown;
  parent_purpose: unknown;
  visibility_boundary: unknown;
  parent_conversation_visibility: unknown;
  parent_entity_id: unknown;
  parent_entity_revision: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  content_id: unknown;
  content_revision: unknown;
  block_key: unknown;
  data_class_id: unknown;
  processing_purpose_id: unknown;
  retention_anchor_at: unknown;
  head_state: unknown;
  head_revision: unknown;
  detached_by_event_id: unknown;
};

type DetachFileParentLockRow = {
  link_id: unknown;
  object_version_id: unknown;
  link_state: unknown;
  link_revision: unknown;
  detached_by_event_id: unknown;
  parent_set_revision: unknown;
  completeness: unknown;
  completeness_revision: unknown;
  live_parent_count: unknown;
  actual_live_parent_count: unknown;
  database_now: unknown;
};

type ObjectDeletionHeadRow = {
  object_version_id: unknown;
  state: unknown;
  revision: unknown;
  file_version_count: unknown;
  database_now: unknown;
};

type ObjectDeletionParentRow = {
  file_id: unknown;
  revision: unknown;
  completeness: unknown;
  completeness_revision: unknown;
  live_parent_count: unknown;
  actual_live_parent_count: unknown;
};

export type FinalizeInboxV2AttachmentReadyInMessageMutationInput =
  InboxV2AttachmentReadyPersistenceInput &
    Readonly<{
      contentFence: InboxV2AttachmentMaterializationContentFence;
    }>;

export type FinalizeInboxV2AttachmentFailedInMessageMutationInput = Readonly<{
  claim: InboxV2AttachmentMaterializationClaim;
  code: string;
  retryable: boolean;
  contentFence: InboxV2AttachmentMaterializationContentFence;
}>;

type PreparedReadyAttachmentMaterializationState = {
  readonly sealExecutor: RawSqlExecutor;
  readonly atomicToken: object;
  readonly rawInput: FinalizeInboxV2AttachmentReadyInMessageMutationInput;
  readonly normalized: ReturnType<typeof normalizeReadyFinalization>;
  readonly locked: MaterializationFinalizationRow;
  readonly orphan: StorageOrphanAdoptionCandidateRow | null;
  consumed: boolean;
};

type PreparedFailedAttachmentMaterializationState = {
  readonly sealExecutor: RawSqlExecutor;
  readonly atomicToken: object;
  readonly rawInput: FinalizeInboxV2AttachmentFailedInMessageMutationInput;
  readonly normalized: ReturnType<typeof normalizeFailedFinalization>;
  readonly locked: MaterializationFinalizationRow;
  consumed: boolean;
};

const preparedReadyAttachmentMaterializations = new WeakMap<
  InboxV2PreparedReadyAttachmentMaterializationCapability,
  PreparedReadyAttachmentMaterializationState
>();

const preparedFailedAttachmentMaterializations = new WeakMap<
  InboxV2PreparedFailedAttachmentMaterializationCapability,
  PreparedFailedAttachmentMaterializationState
>();

export function createSqlInboxV2FileObjectRepository(
  executor: InboxV2FileObjectTransactionExecutor | HuleeDatabase,
  options: Readonly<{
    messageMutationRunner?: InboxV2AttachmentMaterializationMutationRunner;
    purposeAndHoldAuthorityLoader?: InboxV2FilePurposeAndHoldAuthorityLoader;
  }> = {}
): InboxV2FileObjectRepository {
  const transactionExecutor =
    executor as unknown as InboxV2FileObjectTransactionExecutor;
  return {
    async reserveMaterialization(context, input) {
      assertInboxV2AuthorizedCommandMutationContext(context);
      const normalized = normalizeMaterializationReservation(context, input);
      return reserveMaterializationInTransaction(context.executor, normalized);
    },

    async claimMaterializationJobs(input) {
      const normalized = normalizeClaimMaterializationJobsInput(input);
      const tokenRows = Array.from(
        { length: normalized.batchSize },
        (_, ordinal) => {
          const leaseToken = `attachment-lease:${randomBytes(32).toString("hex")}`;
          return {
            ordinal: ordinal + 1,
            attemptId: deriveBrandedId(
              "attachment_materialization_attempt",
              normalized.tenantId,
              randomBytes(32).toString("hex")
            ),
            rawLeaseToken: leaseToken,
            leaseTokenHash: deriveRawSha256(
              "core:inbox-v2.attachment-materialization-lease@v1",
              normalized.tenantId,
              leaseToken
            )
          };
        }
      );
      return transactionExecutor.transaction(async (transaction) => {
        const result = await transaction.execute<ClaimedMaterializationRow>(
          buildClaimInboxV2AttachmentMaterializationJobsSql({
            ...normalized,
            tokenRows
          })
        );
        return result.rows.map(mapClaimedMaterializationRow);
      }, FILE_OBJECT_TRANSACTION_CONFIG);
    },

    async listPendingMaterializationAuthorizationRefreshCandidates(input) {
      const normalized =
        normalizePendingMaterializationAuthorizationRefreshCandidatesInput(
          input
        );
      return transactionExecutor.transaction(async (transaction) => {
        const result =
          await transaction.execute<PendingMaterializationAuthorizationRefreshCandidateRow>(
            buildListInboxV2PendingMaterializationAuthorizationRefreshCandidatesSql(
              normalized
            )
          );
        return result.rows.map((row) => ({
          tenantId: requiredString(row.tenant_id, "refresh candidate tenant"),
          jobId: requiredString(row.job_id, "refresh candidate job"),
          expectedJobRevision: requiredCounter(
            row.expected_job_revision,
            "refresh candidate job revision"
          )
        }));
      }, FILE_OBJECT_TRANSACTION_CONFIG);
    },

    async reauthorizePendingMaterialization(context, input) {
      assertInboxV2AuthorizedCommandMutationContext(context);
      return reauthorizePendingMaterializationInTransaction(
        context,
        normalizePendingMaterializationReauthorizationInput(input)
      );
    },

    async countNonterminalMaterializationsForReservationNamespace(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const reservationNamespaceGeneration = inboxV2RoutingTokenSchema.parse(
        input.reservationNamespaceGeneration
      );
      return transactionExecutor.transaction(async (transaction) => {
        const result = await transaction.execute<CountRow>(sql`
          select count(*)::text as count
            from inbox_v2_file_attachment_materialization_jobs job
           where job.tenant_id = ${tenantId}
             and job.reservation_namespace_generation =
               ${reservationNamespaceGeneration}
             and job.state in (
               'pending', 'claimed', 'transferring', 'verifying'
             )
        `);
        const count = result.rows[0]?.count;
        if (result.rows.length !== 1 || !/^[0-9]+$/u.test(String(count))) {
          throw new InboxV2FileObjectPersistenceError(
            "inbox_v2.file_object_row_invalid",
            "Expected one nonterminal namespace drain count."
          );
        }
        return String(count);
      }, FILE_OBJECT_TRANSACTION_CONFIG);
    },

    async authorizeMaterializationIo(claim) {
      return transactionExecutor.transaction(
        (transaction) =>
          authorizeAttachmentMaterializationIoInTransaction(transaction, claim),
        FILE_OBJECT_TRANSACTION_CONFIG
      );
    },

    async finalizeReady(input) {
      const runner = options.messageMutationRunner;
      if (runner === undefined) {
        throw new InboxV2FileObjectPersistenceError(
          "inbox_v2.materialization_mutation_runner_missing",
          "Ready materialization requires an append-only message mutation runner."
        );
      }
      return runner.ready(input);
    },

    async finalizeFailed(input) {
      const runner = options.messageMutationRunner;
      if (runner === undefined) {
        throw new InboxV2FileObjectPersistenceError(
          "inbox_v2.materialization_mutation_runner_missing",
          "Failed materialization requires an append-only message mutation runner."
        );
      }
      return runner.failed(input);
    },

    async recordOrphan(input) {
      return transactionExecutor.transaction(
        (transaction) => recordStorageOrphanInTransaction(transaction, input),
        FILE_OBJECT_TRANSACTION_CONFIG
      );
    },

    async attachParent(input) {
      return transactionExecutor.transaction(
        (transaction) => attachFileParentInTransaction(transaction, input),
        FILE_OBJECT_TRANSACTION_CONFIG
      );
    },

    async detachParent(input) {
      return transactionExecutor.transaction(
        (transaction) => detachFileParentInTransaction(transaction, input),
        FILE_OBJECT_TRANSACTION_CONFIG
      );
    },

    async authorizeObjectDeletion(input) {
      const purposeAndHoldAuthorityLoader =
        options.purposeAndHoldAuthorityLoader;
      if (purposeAndHoldAuthorityLoader === undefined) {
        return { kind: "denied", code: "authority_unavailable" };
      }
      return transactionExecutor.transaction(
        (transaction) =>
          authorizeObjectDeletionInTransaction(
            transaction,
            input,
            purposeAndHoldAuthorityLoader
          ),
        FILE_OBJECT_TRANSACTION_CONFIG
      );
    }
  };
}

type NormalizedMaterializationReservation =
  ReserveInboxV2AttachmentMaterializationInput &
    Readonly<{
      sourceLocatorDigestSha256: string;
      reservationAuthority: InboxV2AttachmentMaterializationClaim["reservationAuthority"];
    }>;

async function reserveMaterializationInTransaction(
  transaction: RawSqlExecutor,
  input: NormalizedMaterializationReservation
): Promise<ReserveInboxV2AttachmentMaterializationResult> {
  await transaction.execute(
    buildInboxV2AdvisoryXactLockSql([input.tenantId, input.attachmentId])
  );
  const existing = await transaction.execute<ExistingMaterializationJobRow>(
    buildLockInboxV2AttachmentMaterializationReservationSql(input)
  );
  if (existing.rows.length > 1) {
    throw new MaterializationReservationRollbackError("job_conflict");
  }
  const existingRow = existing.rows[0];
  if (existingRow !== undefined) {
    if (!isExactMaterializationReservationReplay(existingRow, input)) {
      return { kind: "conflict", code: "job_conflict" };
    }
    return materializationReservationSuccess("already_reserved", input);
  }

  const reservedCollision = await transaction.execute<IdRow>(
    buildLockInboxV2AttachmentMaterializationReservationCollisionSql(input)
  );
  if (reservedCollision.rows.length > 0) {
    return { kind: "conflict", code: "reservation_conflict" };
  }

  const fence = await transaction.execute<AttachmentReservationFenceRow>(
    buildLockInboxV2AttachmentReservationFenceSql(input)
  );
  assertAtMostOneRow(fence.rows, "Attachment materialization reserve fence");
  const fenceRow = fence.rows[0];
  if (fenceRow === undefined) {
    return { kind: "conflict", code: "attachment_not_pending" };
  }
  if (
    requiredCounter(fenceRow.attachment_revision, "attachment revision") !==
    input.expectedAttachmentRevision
  ) {
    return { kind: "conflict", code: "attachment_revision_conflict" };
  }
  if (
    (input.sourceLocator.kind === "provider"
      ? BigInt(requiredCounter(fenceRow.content_revision, "content revision")) <
        BigInt(input.content.expectedRevision)
      : requiredCounter(fenceRow.content_revision, "content revision") !==
        input.content.expectedRevision) ||
    requiredString(fenceRow.attachment_state, "attachment state") !==
      "pending" ||
    requiredString(fenceRow.conversation_id, "conversation id") !==
      input.content.conversationId ||
    requiredString(fenceRow.timeline_item_id, "timeline item id") !==
      input.content.timelineItemId ||
    requiredString(fenceRow.parent_message_id, "parent Message id") !==
      input.content.parentMessageId ||
    (input.sourceLocator.kind === "provider"
      ? BigInt(
          requiredCounter(
            fenceRow.parent_message_revision,
            "parent Message revision"
          )
        ) < BigInt(input.content.expectedParentRevision)
      : requiredCounter(
          fenceRow.parent_message_revision,
          "parent Message revision"
        ) !== input.content.expectedParentRevision) ||
    requiredString(fenceRow.timeline_visibility, "timeline visibility") !==
      (input.content.visibilityBoundary === "external_work"
        ? "conversation_external"
        : "internal_participants") ||
    (input.sourceLocator.kind === "provider" &&
      requiredString(
        fenceRow.origin_source_occurrence_id,
        "origin SourceOccurrence id"
      ) !== input.sourceOccurrenceId)
  ) {
    return { kind: "conflict", code: "content_fence_conflict" };
  }

  const file = await transaction.execute<IdRow>(
    sql`
      insert into inbox_v2_file_objects (
        tenant_id, id, data_class_id, processing_purpose_id,
        retention_anchor_at, state, current_file_version_id,
        current_object_version_id, revision, created_at, updated_at
      )
      select
        ${input.tenantId}, ${input.file.id}, ${input.file.dataClassId},
        ${input.file.processingPurposeId}, ${input.file.retentionAnchorAt}::timestamptz,
        'pending', null, null, ${input.file.expectedRevision}::bigint,
        database_now, database_now
      from (select clock_timestamp() as database_now) clock
      where not exists (
        select 1 from inbox_v2_file_objects
        where tenant_id = ${input.tenantId} and id = ${input.file.id}
      )
      returning id
    `
  );
  if (file.rows.length !== 1) {
    throw new MaterializationReservationRollbackError("file_conflict");
  }
  const job = await transaction.execute<IdRow>(
    buildInsertInboxV2AttachmentMaterializationJobSql(input)
  );
  if (job.rows.length !== 1) {
    throw new MaterializationReservationRollbackError("reservation_conflict");
  }
  return materializationReservationSuccess("reserved", input);
}

export function buildLockInboxV2AttachmentMaterializationReservationSql(
  input: NormalizedMaterializationReservation
): SQL {
  return sql`
    select
      id, attachment_id, file_id, expected_file_revision,
      conversation_id, timeline_item_id, parent_message_id,
      expected_parent_revision, visibility_boundary,
      timeline_content_id, expected_content_revision, content_block_key,
      content_mutation_fence_sha256, source_occurrence_id,
      source_locator_kind, source_locator_reference,
      source_locator_digest_sha256, reservation_namespace_generation,
      cause_event_id, cause_mutation_id,
      cause_stream_commit_id, cause_stream_position, correlation_id, caused_at,
      authorization_command_id, authorization_command_type_id,
      authorization_client_mutation_id, authorization_mutation_id,
      authorization_decision_id, authorization_epoch,
      authorization_actor_kind, authorization_actor_id,
      authorization_authorized_at, authorization_decision_set_digest_sha256,
      authorization_resource_fence_set_digest_sha256,
      authorization_tenant_rbac_revision,
      authorization_shared_access_revision,
      authorization_resource_head_id,
      authorization_resource_access_revision,
      authorization_structural_relation_revision,
      authorization_collaborator_set_revision,
      authorization_audit_grant_source_ids,
      authorization_audit_policy_version,
      idempotency_token,
      expected_attachment_revision, reserved_file_version_id,
      reserved_object_version_id, reserved_storage_root_id,
      reserved_storage_object_key
    from inbox_v2_file_attachment_materialization_jobs
    where tenant_id = ${input.tenantId}
      and (
        id = ${input.jobId}
        or (
          attachment_id = ${input.attachmentId}
          and idempotency_token = ${input.idempotencyToken}
        )
      )
    order by id
    for update
  `;
}

export function buildLockInboxV2AttachmentMaterializationReservationCollisionSql(
  input: NormalizedMaterializationReservation
): SQL {
  return sql`
    select id
    from inbox_v2_file_attachment_materialization_jobs
    where tenant_id = ${input.tenantId}
      and (
        file_id = ${input.file.id}
        or (
          attachment_id = ${input.attachmentId}
          and expected_attachment_revision =
            ${input.expectedAttachmentRevision}::bigint
        )
        or reserved_file_version_id = ${input.reservation.fileVersionId}
        or reserved_object_version_id = ${input.reservation.objectVersionId}
        or (
          reserved_storage_root_id = ${input.reservation.storageRootId}
          and reserved_storage_object_key = ${input.reservation.storageKey}
        )
      )
    order by id
    for share
  `;
}

export function buildLockInboxV2AttachmentReservationFenceSql(
  input: NormalizedMaterializationReservation
): SQL {
  return sql`
    select
      attachment.revision as attachment_revision,
      content.revision as content_revision,
      current_payload.attachment_state,
      message.conversation_id,
      message.timeline_item_id,
      message.id as parent_message_id,
      message.revision as parent_message_revision,
      timeline.visibility as timeline_visibility,
      message.origin_source_occurrence_id
    from inbox_v2_message_attachment_anchors attachment
    join inbox_v2_timeline_contents content
      on content.tenant_id = attachment.tenant_id
     and content.id = attachment.owner_timeline_content_id
     and content.id = ${input.content.id}
     and content.state = 'available'
    join inbox_v2_timeline_content_revisions content_revision
      on content_revision.tenant_id = content.tenant_id
     and content_revision.content_id = content.id
     and content_revision.revision = ${input.content.expectedRevision}::bigint
     and content_revision.state = 'available'
    join inbox_v2_timeline_content_payloads origin_payload
      on origin_payload.tenant_id = content.tenant_id
     and origin_payload.content_id = content.id
     and origin_payload.content_revision = content_revision.revision
     and origin_payload.block_key = attachment.owner_block_key
     and origin_payload.block_key = ${input.content.blockKey}
     and origin_payload.attachment_id = attachment.id
    join inbox_v2_timeline_content_payloads current_payload
      on current_payload.tenant_id = content.tenant_id
     and current_payload.content_id = content.id
     and current_payload.content_revision = content.revision
     and current_payload.block_key = origin_payload.block_key
     and current_payload.attachment_id = origin_payload.attachment_id
    join inbox_v2_messages message
      on message.tenant_id = content.tenant_id
     and message.id = ${input.content.parentMessageId}
     and message.conversation_id = ${input.content.conversationId}
     and message.timeline_item_id = ${input.content.timelineItemId}
     and message.content_id = content.id
     and message.content_revision = content.revision
     and message.content_state = content.state
     and message.revision >= ${input.content.expectedParentRevision}::bigint
    join inbox_v2_message_revisions origin_message_revision
      on origin_message_revision.tenant_id = message.tenant_id
     and origin_message_revision.message_id = message.id
     and origin_message_revision.timeline_item_id = message.timeline_item_id
     and origin_message_revision.message_revision =
         ${input.content.expectedParentRevision}::bigint
     and origin_message_revision.after_content_id = content.id
     and origin_message_revision.after_content_revision =
         ${input.content.expectedRevision}::bigint
     and origin_message_revision.after_content_state = 'available'
    join inbox_v2_timeline_items timeline
      on timeline.tenant_id = message.tenant_id
     and timeline.id = message.timeline_item_id
     and timeline.conversation_id = message.conversation_id
    where attachment.tenant_id = ${input.tenantId}
      and attachment.id = ${input.attachmentId}
      and attachment.owner_message_id = ${input.content.parentMessageId}
      and attachment.owner_timeline_item_id = ${input.content.timelineItemId}
      and attachment.owner_timeline_content_id = ${input.content.id}
      and attachment.owner_block_key = ${input.content.blockKey}
      and attachment.materialization_state = 'pending'
      and attachment.revision = ${input.expectedAttachmentRevision}::bigint
      and content.revision >= ${input.content.expectedRevision}::bigint
      and (${input.sourceLocator.kind} = 'provider'
        or content.revision = ${input.content.expectedRevision}::bigint)
      and (${input.sourceLocator.kind} = 'provider'
        or message.revision = ${input.content.expectedParentRevision}::bigint)
      and timeline.visibility = case ${input.content.visibilityBoundary}
        when 'external_work' then 'conversation_external'::inbox_v2_timeline_visibility
        when 'internal' then 'internal_participants'::inbox_v2_timeline_visibility
      end
      and (${input.sourceLocator.kind} <> 'provider'
        or message.origin_source_occurrence_id = ${input.sourceOccurrenceId})
      and origin_payload.attachment_state = 'pending'
      and origin_payload.attachment_file_id is null
      and origin_payload.attachment_v2_file_id is null
      and origin_payload.attachment_file_version_id is null
      and origin_payload.attachment_object_version_id is null
      and origin_payload.attachment_failure_reason_id is null
      and current_payload.attachment_state = 'pending'
      and current_payload.attachment_file_id is null
      and current_payload.attachment_v2_file_id is null
      and current_payload.attachment_file_version_id is null
      and current_payload.attachment_object_version_id is null
      and current_payload.attachment_failure_reason_id is null
    for update of attachment, content
  `;
}

export function buildInsertInboxV2AttachmentMaterializationJobSql(
  input: NormalizedMaterializationReservation
): SQL {
  return sql`
    insert into inbox_v2_file_attachment_materialization_jobs (
      tenant_id, id, attachment_id, file_id, expected_file_revision,
      conversation_id, timeline_item_id, parent_message_id,
      expected_parent_revision, visibility_boundary,
      timeline_content_id, expected_content_revision, content_block_key,
      content_mutation_fence_sha256, source_occurrence_id,
      source_locator_kind, source_locator_reference,
      source_locator_digest_sha256, reservation_namespace_generation,
      cause_event_id, cause_mutation_id,
      cause_stream_commit_id, cause_stream_position, correlation_id, caused_at,
      authorization_command_id, authorization_command_type_id,
      authorization_client_mutation_id, authorization_mutation_id,
      authorization_decision_id, authorization_epoch,
      authorization_actor_kind, authorization_actor_id,
      authorization_authorized_at, authorization_decision_set_digest_sha256,
      authorization_resource_fence_set_digest_sha256,
      authorization_tenant_rbac_revision,
      authorization_shared_access_revision,
      authorization_resource_head_id,
      authorization_resource_access_revision,
      authorization_structural_relation_revision,
      authorization_collaborator_set_revision,
      authorization_audit_grant_source_ids,
      authorization_audit_policy_version,
      idempotency_token,
      expected_attachment_revision, state, lease_generation,
      lease_token_hash, lease_owner_id, lease_claimed_at, lease_expires_at,
      reserved_file_version_id, reserved_object_version_id,
      reserved_storage_root_id, reserved_storage_object_key,
      result_file_version_id, result_object_version_id,
      result_file_revision, result_content_revision, terminal_reason_id,
      revision, created_at, updated_at
    )
    select
      ${input.tenantId}, ${input.jobId}, ${input.attachmentId}, ${input.file.id},
      ${input.file.expectedRevision}::bigint, ${input.content.conversationId},
      ${input.content.timelineItemId}, ${input.content.parentMessageId},
      ${input.content.expectedParentRevision}::bigint,
      ${input.content.visibilityBoundary}, ${input.content.id},
      ${input.content.expectedRevision}::bigint, ${input.content.blockKey},
      ${input.content.mutationFenceSha256}, ${input.sourceOccurrenceId},
      ${input.sourceLocator.kind}, ${input.sourceLocator.reference},
      ${input.sourceLocatorDigestSha256},
      ${input.reservationNamespaceGeneration}, ${input.causeEventId},
      ${input.causeMutationId}, ${input.causeStreamCommitId},
      ${input.causeStreamPosition}::bigint,
      ${input.correlationId}, ${input.causedAt}::timestamptz,
      ${input.reservationAuthority.commandId},
      ${input.reservationAuthority.commandTypeId},
      ${input.reservationAuthority.clientMutationId},
      ${input.reservationAuthority.mutationId},
      ${input.reservationAuthority.decisionId},
      ${input.reservationAuthority.epoch},
      ${input.reservationAuthority.actor.kind},
      ${materializationAuthorityActorId(input.reservationAuthority.actor)},
      ${input.reservationAuthority.authorizedAt}::timestamptz,
      ${input.reservationAuthority.decisionSetDigestSha256},
      ${input.reservationAuthority.resourceFenceSetDigestSha256},
      ${input.reservationAuthority.tenantRbacRevision}::bigint,
      ${input.reservationAuthority.sharedAccessRevision}::bigint,
      ${input.reservationAuthority.resourceHeadId},
      ${input.reservationAuthority.resourceAccessRevision}::bigint,
      ${input.reservationAuthority.structuralRelationRevision}::bigint,
      ${input.reservationAuthority.collaboratorSetRevision}::bigint,
      ${inboxV2TextArraySql(input.reservationAuthority.auditGrantSourceIds)},
      ${input.reservationAuthority.auditPolicyVersion},
      ${input.idempotencyToken},
      ${input.expectedAttachmentRevision}::bigint, 'pending', 0,
      null, null, null, null,
      ${input.reservation.fileVersionId}, ${input.reservation.objectVersionId},
      ${input.reservation.storageRootId}, ${input.reservation.storageKey},
      null, null, null, null, null, 1, database_now, database_now
    from (select clock_timestamp() as database_now) clock
    on conflict do nothing
    returning id
  `;
}

function inboxV2TextArraySql(values: readonly string[]): SQL {
  if (values.length === 0) return sql`array[]::text[]`;
  return sql`array[${sql.join(
    values.map((value) => sql`${value}`),
    sql`, `
  )}]::text[]`;
}

export function buildClaimInboxV2AttachmentMaterializationJobsSql(input: {
  tenantId: string;
  workerId: string;
  batchSize: number;
  leaseDurationSeconds: number;
  tokenRows: readonly Readonly<{
    ordinal: number;
    attemptId: string;
    rawLeaseToken: string;
    leaseTokenHash: string;
  }>[];
}): SQL {
  const tokensJson = JSON.stringify(input.tokenRows);
  const candidateScanLimit = Math.min(input.batchSize * 4, 256);
  return sql`
    with database_clock as (
      select clock_timestamp() as database_now
    ),
    lease_tokens as (
      select *
      from jsonb_to_recordset(${tokensJson}::jsonb) as value(
        ordinal integer,
        "attemptId" text,
        "rawLeaseToken" text,
        "leaseTokenHash" text
      )
    ),
    locked_candidates as (
      select job.ctid, job.id, job.updated_at,
        exists (
          select 1
            from inbox_v2_file_objects file_row
            join inbox_v2_message_attachment_anchors attachment_row
              on attachment_row.tenant_id = job.tenant_id
             and attachment_row.id = job.attachment_id
             and attachment_row.owner_message_id = job.parent_message_id
             and attachment_row.owner_timeline_item_id = job.timeline_item_id
             and attachment_row.owner_timeline_content_id =
               job.timeline_content_id
             and attachment_row.owner_block_key = job.content_block_key
             and attachment_row.revision = job.expected_attachment_revision
             and attachment_row.materialization_state = 'pending'
            join inbox_v2_timeline_contents content_row
              on content_row.tenant_id = attachment_row.tenant_id
             and content_row.id = attachment_row.owner_timeline_content_id
             and content_row.state = 'available'
             and content_row.revision >= job.expected_content_revision
            join inbox_v2_messages message_row
              on message_row.tenant_id = content_row.tenant_id
             and message_row.id = attachment_row.owner_message_id
             and message_row.conversation_id = job.conversation_id
             and message_row.timeline_item_id = job.timeline_item_id
             and message_row.content_id = content_row.id
             and message_row.content_revision = content_row.revision
             and message_row.content_state = 'available'
             and message_row.lifecycle = 'active'
             and message_row.revision >= job.expected_parent_revision
            join inbox_v2_timeline_content_payloads payload_row
              on payload_row.tenant_id = content_row.tenant_id
             and payload_row.content_id = content_row.id
             and payload_row.content_revision = content_row.revision
             and payload_row.block_key = job.content_block_key
             and payload_row.attachment_id = job.attachment_id
             and payload_row.attachment_state = 'pending'
           where file_row.tenant_id = job.tenant_id
             and file_row.id = job.file_id
             and file_row.state = 'pending'
             and file_row.revision = job.expected_file_revision
             and file_row.current_file_version_id is null
             and file_row.current_object_version_id is null
             and (
               job.source_locator_kind <> 'provider'
               or exists (
                 select 1
                   from inbox_v2_source_occurrences source_occurrence_row
                  where source_occurrence_row.tenant_id = job.tenant_id
                    and source_occurrence_row.id = job.source_occurrence_id
                    and source_occurrence_row.conversation_id =
                      job.conversation_id
                    and message_row.origin_source_occurrence_id =
                      source_occurrence_row.id
               )
             )
        ) as current_materialization_valid,
        exists (
          select 1
            from inbox_v2_timeline_items timeline_item_row
            join inbox_v2_auth_tenant_heads tenant_auth_row
              on tenant_auth_row.tenant_id = job.tenant_id
             and tenant_auth_row.tenant_rbac_revision =
               job.authorization_tenant_rbac_revision
             and tenant_auth_row.shared_access_revision =
               job.authorization_shared_access_revision
            join inbox_v2_auth_resource_heads resource_auth_row
              on resource_auth_row.tenant_id = job.tenant_id
             and resource_auth_row.id = job.authorization_resource_head_id
             and resource_auth_row.resource_kind = 'conversation'
             and resource_auth_row.conversation_id = job.conversation_id
             and resource_auth_row.resource_access_revision =
               job.authorization_resource_access_revision
             and resource_auth_row.structural_relation_revision =
               job.authorization_structural_relation_revision
             and resource_auth_row.collaborator_set_revision =
               job.authorization_collaborator_set_revision
            join inbox_v2_auth_command_records authorization_command_row
              on authorization_command_row.tenant_id = job.tenant_id
             and authorization_command_row.id = job.authorization_command_id
             and authorization_command_row.client_mutation_id =
               job.authorization_client_mutation_id
             and authorization_command_row.command_type_id =
               job.authorization_command_type_id
             and authorization_command_row.authorization_decision_id =
               job.authorization_decision_id
             and authorization_command_row.authorization_epoch =
               job.authorization_epoch
             and authorization_command_row.authorized_at =
               job.authorization_authorized_at
             and authorization_command_row.state = 'completed'
             and authorization_command_row.mutation_id =
               job.authorization_mutation_id
             and authorization_command_row.actor_kind =
               job.authorization_actor_kind
             and case authorization_command_row.actor_kind
               when 'employee' then
                 authorization_command_row.actor_employee_id
               when 'trusted_service' then
                 authorization_command_row.actor_trusted_service_id
             end = job.authorization_actor_id
             and authorization_command_row.authorization_not_after >
               clock.database_now
             and jsonb_array_length(
               authorization_command_row.authorization_decision_refs
             ) = 2
             and 2 = (
               select count(*)
                 from jsonb_to_recordset(
                   authorization_command_row.authorization_decision_refs
                 ) as decision("notAfter" timestamptz)
                where isfinite(decision."notAfter")
                  and decision."notAfter" > clock.database_now
             )
           where timeline_item_row.tenant_id = job.tenant_id
             and timeline_item_row.id = job.timeline_item_id
             and timeline_item_row.conversation_id = job.conversation_id
             and timeline_item_row.visibility = case job.visibility_boundary
               when 'external_work' then
                 'conversation_external'::inbox_v2_timeline_visibility
               when 'internal' then
                 'internal_participants'::inbox_v2_timeline_visibility
             end
        ) as current_access_valid
      from inbox_v2_file_attachment_materialization_jobs job
      cross join database_clock clock
      where job.tenant_id = ${input.tenantId}
        and (
          job.state = 'pending'
          or (
            job.state in ('claimed', 'transferring', 'verifying')
            and job.lease_expires_at <= clock.database_now
          )
        )
      order by job.updated_at asc, job.id asc
      for update of job skip locked
      limit ${candidateScanLimit}
    ),
    cancelled as (
      update inbox_v2_file_attachment_materialization_jobs job
      set state = 'cancelled',
          lease_token_hash = null,
          lease_owner_id = null,
          lease_claimed_at = null,
          lease_expires_at = null,
          terminal_reason_id =
            'core:attachment-materialization-current-fence-lost',
          revision = job.revision + 1,
          updated_at = clock.database_now
      from locked_candidates candidate
      cross join database_clock clock
      where job.ctid = candidate.ctid
        and candidate.current_materialization_valid = false
      returning job.id
    ),
    released_for_reauthorization as (
      update inbox_v2_file_attachment_materialization_jobs job
      set state = 'pending',
          lease_token_hash = null,
          lease_owner_id = null,
          lease_claimed_at = null,
          lease_expires_at = null,
          revision = job.revision + 1,
          updated_at = clock.database_now
      from locked_candidates candidate
      cross join database_clock clock
      where job.ctid = candidate.ctid
        and job.state in ('claimed', 'transferring', 'verifying')
        and candidate.current_materialization_valid = true
        and candidate.current_access_valid = false
      returning job.id
    ),
    numbered_candidates as (
      select
        ctid, id,
        row_number() over (order by updated_at asc, id asc)::integer as ordinal
      from locked_candidates
      where current_materialization_valid = true
        and current_access_valid = true
      order by updated_at asc, id asc
      limit ${input.batchSize}
    ),
    claimed as (
      update inbox_v2_file_attachment_materialization_jobs job
      set
        state = case when job.state = 'pending' then 'claimed'::inbox_v2_file_attachment_materialization_state else job.state end,
        lease_generation = job.lease_generation + 1,
        lease_token_hash = token."leaseTokenHash",
        lease_owner_id = ${input.workerId},
        lease_claimed_at = clock.database_now,
        lease_expires_at = clock.database_now + make_interval(secs => ${input.leaseDurationSeconds}),
        revision = job.revision + 1,
        updated_at = clock.database_now
      from numbered_candidates candidate
      join lease_tokens token on token.ordinal = candidate.ordinal
      cross join database_clock clock
      where job.ctid = candidate.ctid
      returning
        job.tenant_id, job.id as job_id, job.attachment_id, job.file_id,
        job.expected_file_revision, job.expected_attachment_revision,
        job.conversation_id, job.timeline_item_id, job.parent_message_id,
        job.expected_parent_revision, job.visibility_boundary,
        job.timeline_content_id, job.expected_content_revision,
        job.content_block_key,
        job.lease_generation, job.lease_token_hash, job.lease_owner_id,
        job.lease_claimed_at, job.lease_expires_at, job.revision,
        job.reserved_file_version_id, job.reserved_object_version_id,
        job.reserved_storage_root_id, job.reserved_storage_object_key,
        job.source_occurrence_id,
        job.source_locator_kind, job.source_locator_reference,
        job.source_locator_digest_sha256,
        job.reservation_namespace_generation, job.cause_event_id,
        job.cause_mutation_id, job.cause_stream_commit_id,
        job.cause_stream_position, job.correlation_id, job.caused_at,
        job.authorization_command_id, job.authorization_command_type_id,
        job.authorization_client_mutation_id, job.authorization_mutation_id,
        job.authorization_decision_id, job.authorization_epoch,
        job.authorization_actor_kind, job.authorization_actor_id,
        job.authorization_authorized_at,
        job.authorization_decision_set_digest_sha256,
        job.authorization_resource_fence_set_digest_sha256,
        job.authorization_tenant_rbac_revision,
        job.authorization_shared_access_revision,
        job.authorization_resource_head_id,
        job.authorization_resource_access_revision,
        job.authorization_structural_relation_revision,
        job.authorization_collaborator_set_revision,
        job.authorization_audit_grant_source_ids,
        job.authorization_audit_policy_version,
        candidate.ordinal
    ),
    attempts as (
      insert into inbox_v2_file_attachment_materialization_attempts (
        tenant_id, id, job_id, attachment_id, file_id,
        expected_file_revision, lease_generation, lease_token_hash,
        lease_owner_id, expected_job_revision, expected_attachment_revision,
        claimed_at, lease_expires_at
      )
      select
        claimed.tenant_id, token."attemptId", claimed.job_id,
        claimed.attachment_id, claimed.file_id,
        claimed.expected_file_revision, claimed.lease_generation,
        claimed.lease_token_hash, claimed.lease_owner_id, claimed.revision,
        claimed.expected_attachment_revision, claimed.lease_claimed_at,
        claimed.lease_expires_at
      from claimed
      join lease_tokens token on token.ordinal = claimed.ordinal
      returning id, job_id, expected_job_revision
    )
    select
      claimed.tenant_id,
      claimed.job_id,
      claimed.attachment_id,
      attempts.id as attempt_id,
      token."rawLeaseToken" as raw_lease_token,
      claimed.lease_generation,
      claimed.lease_owner_id,
      claimed.lease_claimed_at,
      claimed.lease_expires_at,
      attempts.expected_job_revision,
      claimed.file_id,
      claimed.expected_file_revision,
      file.data_class_id as file_data_class_id,
      file.processing_purpose_id as file_processing_purpose_id,
      file.retention_anchor_at as file_retention_anchor_at,
      claimed.conversation_id,
      claimed.timeline_item_id,
      claimed.parent_message_id,
      claimed.expected_parent_revision,
      claimed.visibility_boundary,
      claimed.timeline_content_id,
      claimed.expected_content_revision,
      claimed.content_block_key,
      claimed.expected_attachment_revision,
      claimed.reserved_file_version_id,
      claimed.reserved_object_version_id,
      claimed.reserved_storage_root_id,
      claimed.reserved_storage_object_key,
      claimed.source_locator_kind,
      claimed.source_locator_reference,
      claimed.source_locator_digest_sha256,
      claimed.reservation_namespace_generation,
      claimed.source_occurrence_id,
      claimed.cause_event_id,
      claimed.cause_mutation_id,
      claimed.cause_stream_commit_id,
      claimed.cause_stream_position,
      claimed.correlation_id,
      claimed.caused_at,
      claimed.authorization_command_id,
      claimed.authorization_command_type_id,
      claimed.authorization_client_mutation_id,
      claimed.authorization_mutation_id,
      claimed.authorization_decision_id,
      claimed.authorization_epoch,
      claimed.authorization_actor_kind,
      claimed.authorization_actor_id,
      claimed.authorization_authorized_at,
      claimed.authorization_decision_set_digest_sha256,
      claimed.authorization_resource_fence_set_digest_sha256,
      claimed.authorization_tenant_rbac_revision,
      claimed.authorization_shared_access_revision,
      claimed.authorization_resource_head_id,
      claimed.authorization_resource_access_revision,
      claimed.authorization_structural_relation_revision,
      claimed.authorization_collaborator_set_revision,
      claimed.authorization_audit_grant_source_ids,
      claimed.authorization_audit_policy_version
    from claimed
    join attempts on attempts.job_id = claimed.job_id
    join lease_tokens token on token.ordinal = claimed.ordinal
    join inbox_v2_file_objects file
      on file.tenant_id = claimed.tenant_id
     and file.id = claimed.file_id
    order by claimed.ordinal asc
  `;
}

export function buildListInboxV2PendingMaterializationAuthorizationRefreshCandidatesSql(
  input: Readonly<{ tenantId: string; limit: number }>
): SQL {
  return sql`
    with database_clock as (
      select clock_timestamp() as database_now
    )
    select job.tenant_id, job.id as job_id,
           job.revision as expected_job_revision
      from inbox_v2_file_attachment_materialization_jobs job
      cross join database_clock clock
     where job.tenant_id = ${input.tenantId}
       and job.state = 'pending'
       and num_nonnulls(
         job.lease_token_hash, job.lease_owner_id,
         job.lease_claimed_at, job.lease_expires_at
       ) = 0
       and exists (
         select 1
           from inbox_v2_file_objects file_row
           join inbox_v2_message_attachment_anchors attachment_row
             on attachment_row.tenant_id = job.tenant_id
            and attachment_row.id = job.attachment_id
            and attachment_row.owner_message_id = job.parent_message_id
            and attachment_row.owner_timeline_item_id = job.timeline_item_id
            and attachment_row.owner_timeline_content_id =
              job.timeline_content_id
            and attachment_row.owner_block_key = job.content_block_key
            and attachment_row.revision = job.expected_attachment_revision
            and attachment_row.materialization_state = 'pending'
           join inbox_v2_timeline_contents content_row
             on content_row.tenant_id = attachment_row.tenant_id
            and content_row.id = attachment_row.owner_timeline_content_id
            and content_row.state = 'available'
            and content_row.revision >= job.expected_content_revision
           join inbox_v2_messages message_row
             on message_row.tenant_id = content_row.tenant_id
            and message_row.id = attachment_row.owner_message_id
            and message_row.conversation_id = job.conversation_id
            and message_row.timeline_item_id = job.timeline_item_id
            and message_row.content_id = content_row.id
            and message_row.content_revision = content_row.revision
            and message_row.content_state = 'available'
            and message_row.lifecycle = 'active'
            and message_row.revision >= job.expected_parent_revision
           join inbox_v2_timeline_content_payloads payload_row
             on payload_row.tenant_id = content_row.tenant_id
            and payload_row.content_id = content_row.id
            and payload_row.content_revision = content_row.revision
            and payload_row.block_key = job.content_block_key
            and payload_row.attachment_id = job.attachment_id
            and payload_row.attachment_state = 'pending'
          where file_row.tenant_id = job.tenant_id
            and file_row.id = job.file_id
            and file_row.state = 'pending'
            and file_row.revision = job.expected_file_revision
            and file_row.current_file_version_id is null
            and file_row.current_object_version_id is null
            and (
              job.source_locator_kind <> 'provider'
              or exists (
                select 1
                  from inbox_v2_source_occurrences source_occurrence_row
                 where source_occurrence_row.tenant_id = job.tenant_id
                   and source_occurrence_row.id = job.source_occurrence_id
                   and source_occurrence_row.conversation_id =
                     job.conversation_id
                   and message_row.origin_source_occurrence_id =
                     source_occurrence_row.id
              )
            )
       )
       and not exists (
         select 1
           from inbox_v2_timeline_items timeline_item_row
           join inbox_v2_auth_tenant_heads tenant_auth_row
             on tenant_auth_row.tenant_id = job.tenant_id
            and tenant_auth_row.tenant_rbac_revision =
              job.authorization_tenant_rbac_revision
            and tenant_auth_row.shared_access_revision =
              job.authorization_shared_access_revision
           join inbox_v2_auth_resource_heads resource_auth_row
             on resource_auth_row.tenant_id = job.tenant_id
            and resource_auth_row.id = job.authorization_resource_head_id
            and resource_auth_row.resource_kind = 'conversation'
            and resource_auth_row.conversation_id = job.conversation_id
            and resource_auth_row.resource_access_revision =
              job.authorization_resource_access_revision
            and resource_auth_row.structural_relation_revision =
              job.authorization_structural_relation_revision
            and resource_auth_row.collaborator_set_revision =
              job.authorization_collaborator_set_revision
           join inbox_v2_auth_command_records authorization_command_row
             on authorization_command_row.tenant_id = job.tenant_id
            and authorization_command_row.id = job.authorization_command_id
            and authorization_command_row.client_mutation_id =
              job.authorization_client_mutation_id
            and authorization_command_row.command_type_id =
              job.authorization_command_type_id
            and authorization_command_row.authorization_decision_id =
              job.authorization_decision_id
            and authorization_command_row.authorization_epoch =
              job.authorization_epoch
            and authorization_command_row.authorized_at =
              job.authorization_authorized_at
            and authorization_command_row.state = 'completed'
            and authorization_command_row.mutation_id =
              job.authorization_mutation_id
            and authorization_command_row.actor_kind =
              job.authorization_actor_kind
            and case authorization_command_row.actor_kind
              when 'employee' then
                authorization_command_row.actor_employee_id
              when 'trusted_service' then
                authorization_command_row.actor_trusted_service_id
            end = job.authorization_actor_id
            and authorization_command_row.authorization_not_after >
              clock.database_now
            and jsonb_array_length(
              authorization_command_row.authorization_decision_refs
            ) = 2
            and 2 = (
              select count(*)
                from jsonb_to_recordset(
                  authorization_command_row.authorization_decision_refs
                ) as decision("notAfter" timestamptz)
               where isfinite(decision."notAfter")
                 and decision."notAfter" > clock.database_now
            )
          where timeline_item_row.tenant_id = job.tenant_id
            and timeline_item_row.id = job.timeline_item_id
            and timeline_item_row.conversation_id = job.conversation_id
            and timeline_item_row.visibility = case job.visibility_boundary
              when 'external_work' then
                'conversation_external'::inbox_v2_timeline_visibility
              when 'internal' then
                'internal_participants'::inbox_v2_timeline_visibility
            end
       )
     order by job.updated_at asc, job.id asc
     for update of job skip locked
     limit ${input.limit}
  `;
}

async function reauthorizePendingMaterializationInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: ReauthorizeInboxV2PendingMaterializationInput
): Promise<ReauthorizeInboxV2PendingMaterializationResult> {
  if (
    context.commandTypeId !==
    INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID
  ) {
    return { kind: "authorization_conflict" };
  }
  const locked =
    await context.executor.execute<PendingMaterializationReauthorizationRow>(
      buildLockInboxV2PendingMaterializationReauthorizationSql(
        context.tenantId,
        input.jobId
      )
    );
  assertAtMostOneRow(locked.rows, "Pending materialization reauthorization");
  const row = locked.rows[0];
  if (row === undefined) return { kind: "not_found" };
  const revision = requiredCounter(row.revision, "materialization revision");
  const leaseGeneration = normalizeZeroCapableCounter(
    String(row.lease_generation),
    "materialization lease generation"
  );
  if (
    requiredString(row.state, "materialization state") !== "pending" ||
    [
      row.lease_token_hash,
      row.lease_owner_id,
      row.lease_claimed_at,
      row.lease_expires_at
    ].some((value) => value !== null)
  ) {
    return { kind: "state_conflict" };
  }

  let authority: ReturnType<
    typeof normalizeMaterializationReservationAuthority
  >;
  try {
    authority = normalizeMaterializationReservationAuthority(
      context,
      requiredString(row.conversation_id, "materialization conversation"),
      requiredVisibilityBoundary(row.visibility_boundary)
    );
  } catch {
    return { kind: "authorization_conflict" };
  }
  if (isCurrentMaterializationAuthorization(row, context, authority)) {
    return { kind: "already_current", jobRevision: revision };
  }
  if (
    revision !== input.expectedJobRevision ||
    row.current_materialization_valid !== true
  ) {
    return { kind: "state_conflict" };
  }

  const resultingJobRevision = incrementCounter(revision);
  const updated = await context.executor.execute<IdRow>(sql`
    update inbox_v2_file_attachment_materialization_jobs job
       set authorization_command_id = ${context.commandId},
           authorization_command_type_id = ${context.commandTypeId},
           authorization_client_mutation_id = ${context.clientMutationId},
           authorization_mutation_id = ${context.mutationId},
           authorization_decision_id = ${context.authorizationDecisionId},
           authorization_epoch = ${context.authorizationEpoch},
           authorization_actor_kind = ${context.actor.kind},
           authorization_actor_id = ${materializationAuthorityActorId(
             context.actor
           )},
           authorization_authorized_at = ${normalizeTimestamp(
             context.authorizedAt
           )}::timestamptz,
           authorization_decision_set_digest_sha256 =
             ${authority.decisionSetDigestSha256},
           authorization_resource_fence_set_digest_sha256 =
             ${authority.resourceFenceSetDigestSha256},
           authorization_tenant_rbac_revision =
             ${authority.tenantRbacRevision}::bigint,
           authorization_shared_access_revision =
             ${authority.sharedAccessRevision}::bigint,
           authorization_resource_head_id = ${authority.resourceHeadId},
           authorization_resource_access_revision =
             ${authority.resourceAccessRevision}::bigint,
           authorization_structural_relation_revision =
             ${authority.structuralRelationRevision}::bigint,
           authorization_collaborator_set_revision =
             ${authority.collaboratorSetRevision}::bigint,
           authorization_audit_grant_source_ids =
             ${inboxV2TextArraySql(authority.auditGrantSourceIds)},
           authorization_audit_policy_version =
             ${authority.auditPolicyVersion},
           revision = ${resultingJobRevision}::bigint,
           updated_at = clock_timestamp()
     where job.tenant_id = ${context.tenantId}
       and job.id = ${input.jobId}
       and job.state = 'pending'
       and job.revision = ${revision}::bigint
       and job.lease_generation = ${leaseGeneration}::bigint
       and num_nonnulls(
         job.lease_token_hash, job.lease_owner_id,
         job.lease_claimed_at, job.lease_expires_at
       ) = 0
       and exists (
         select 1
           from inbox_v2_auth_tenant_heads tenant_auth_row
           join inbox_v2_auth_resource_heads resource_auth_row
             on resource_auth_row.tenant_id = tenant_auth_row.tenant_id
            and resource_auth_row.id = ${authority.resourceHeadId}
            and resource_auth_row.resource_kind = 'conversation'
            and resource_auth_row.conversation_id = job.conversation_id
            and resource_auth_row.resource_access_revision =
              ${authority.resourceAccessRevision}::bigint
            and resource_auth_row.structural_relation_revision =
              ${authority.structuralRelationRevision}::bigint
            and resource_auth_row.collaborator_set_revision =
              ${authority.collaboratorSetRevision}::bigint
          where tenant_auth_row.tenant_id = job.tenant_id
            and tenant_auth_row.tenant_rbac_revision =
              ${authority.tenantRbacRevision}::bigint
            and tenant_auth_row.shared_access_revision =
              ${authority.sharedAccessRevision}::bigint
       )
     returning job.id
  `);
  return updated.rows.length === 1
    ? { kind: "refreshed", resultingJobRevision }
    : { kind: "authorization_conflict" };
}

function buildLockInboxV2PendingMaterializationReauthorizationSql(
  tenantId: string,
  jobId: string
): SQL {
  return sql`
    select job.*,
      exists (
        select 1
          from inbox_v2_file_objects file_row
          join inbox_v2_message_attachment_anchors attachment_row
            on attachment_row.tenant_id = job.tenant_id
           and attachment_row.id = job.attachment_id
           and attachment_row.owner_message_id = job.parent_message_id
           and attachment_row.owner_timeline_item_id = job.timeline_item_id
           and attachment_row.owner_timeline_content_id =
             job.timeline_content_id
           and attachment_row.owner_block_key = job.content_block_key
           and attachment_row.revision = job.expected_attachment_revision
           and attachment_row.materialization_state = 'pending'
          join inbox_v2_timeline_contents content_row
            on content_row.tenant_id = attachment_row.tenant_id
           and content_row.id = attachment_row.owner_timeline_content_id
           and content_row.state = 'available'
           and content_row.revision >= job.expected_content_revision
          join inbox_v2_messages message_row
            on message_row.tenant_id = content_row.tenant_id
           and message_row.id = attachment_row.owner_message_id
           and message_row.conversation_id = job.conversation_id
           and message_row.timeline_item_id = job.timeline_item_id
           and message_row.content_id = content_row.id
           and message_row.content_revision = content_row.revision
           and message_row.content_state = 'available'
           and message_row.lifecycle = 'active'
           and message_row.revision >= job.expected_parent_revision
          join inbox_v2_timeline_content_payloads payload_row
            on payload_row.tenant_id = content_row.tenant_id
           and payload_row.content_id = content_row.id
           and payload_row.content_revision = content_row.revision
           and payload_row.block_key = job.content_block_key
           and payload_row.attachment_id = job.attachment_id
           and payload_row.attachment_state = 'pending'
         where file_row.tenant_id = job.tenant_id
           and file_row.id = job.file_id
           and file_row.state = 'pending'
           and file_row.revision = job.expected_file_revision
           and file_row.current_file_version_id is null
           and file_row.current_object_version_id is null
           and (
             job.source_locator_kind <> 'provider'
             or exists (
               select 1
                 from inbox_v2_source_occurrences source_occurrence_row
                where source_occurrence_row.tenant_id = job.tenant_id
                  and source_occurrence_row.id = job.source_occurrence_id
                  and source_occurrence_row.conversation_id =
                    job.conversation_id
                  and message_row.origin_source_occurrence_id =
                    source_occurrence_row.id
             )
           )
      ) as current_materialization_valid
      from inbox_v2_file_attachment_materialization_jobs job
     where job.tenant_id = ${tenantId}
       and job.id = ${jobId}
     for update of job
  `;
}

async function authorizeAttachmentMaterializationIoInTransaction(
  transaction: RawSqlExecutor,
  claim: InboxV2AttachmentMaterializationClaim
): Promise<AuthorizeInboxV2AttachmentMaterializationIoResult> {
  const leaseTokenHash = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-lease@v1",
    claim.tenantId,
    claim.leaseToken
  );
  const result = await transaction.execute<MaterializationIoAuthorizationRow>(
    sql`
      select job.state, job.revision, job.lease_generation,
             job.lease_expires_at, clock.database_now,
        (
          job.attachment_id = ${claim.attachmentId}
          and job.file_id = ${claim.fileId}
          and job.expected_file_revision = ${claim.expectedFileRevision}::bigint
          and job.conversation_id = ${claim.contentOrigin.conversationId}
          and job.timeline_item_id = ${claim.contentOrigin.timelineItemId}
          and job.parent_message_id = ${claim.contentOrigin.parentEntityId}
          and job.expected_parent_revision =
            ${claim.contentOrigin.expectedParentRevision}::bigint
          and job.timeline_content_id =
            ${claim.contentOrigin.timelineContentId}
          and job.expected_content_revision =
            ${claim.contentOrigin.expectedContentRevision}::bigint
          and job.content_block_key = ${claim.contentOrigin.contentBlockKey}
          and job.expected_attachment_revision =
            ${claim.contentOrigin.expectedAttachmentRevision}::bigint
          and job.visibility_boundary =
            ${claim.contentOrigin.visibilityBoundary}
          and job.source_locator_kind = ${claim.sourceLocator.kind}
          and job.source_locator_reference = ${claim.sourceLocator.reference}
          and job.source_locator_digest_sha256 = ${deriveRawSha256(
            "core:inbox-v2.attachment-source-locator@v1",
            claim.tenantId,
            claim.sourceLocator.kind,
            claim.sourceLocator.reference
          )}
          and job.source_occurrence_id is not distinct from
            ${claim.sourceOccurrenceId}
          and job.reservation_namespace_generation =
            ${claim.reservationNamespaceGeneration}
          and job.reserved_file_version_id = ${claim.fileVersionId}
          and job.reserved_object_version_id = ${claim.objectVersionId}
          and job.reserved_storage_root_id = ${claim.storageRootId}
          and job.reserved_storage_object_key = ${claim.storageKey}
          and job.authorization_command_id =
            ${claim.reservationAuthority.commandId}
          and job.authorization_epoch = ${claim.reservationAuthority.epoch}
          and job.authorization_tenant_rbac_revision =
            ${claim.reservationAuthority.tenantRbacRevision}::bigint
          and job.authorization_shared_access_revision =
            ${claim.reservationAuthority.sharedAccessRevision}::bigint
          and job.authorization_resource_head_id =
            ${claim.reservationAuthority.resourceHeadId}
          and job.authorization_resource_access_revision =
            ${claim.reservationAuthority.resourceAccessRevision}::bigint
          and job.authorization_structural_relation_revision =
            ${claim.reservationAuthority.structuralRelationRevision}::bigint
          and job.authorization_collaborator_set_revision =
            ${claim.reservationAuthority.collaboratorSetRevision}::bigint
          and job.lease_generation = ${claim.leaseGeneration}::bigint
          and job.lease_token_hash = ${leaseTokenHash}
          and job.lease_owner_id = ${claim.workerId}
          and job.revision = ${claim.expectedJobRevision}::bigint
          and exists (
            select 1
              from inbox_v2_file_attachment_materialization_attempts attempt_row
             where attempt_row.tenant_id = job.tenant_id
               and attempt_row.id = ${claim.attemptId}
               and attempt_row.job_id = job.id
               and attempt_row.attachment_id = job.attachment_id
               and attempt_row.file_id = job.file_id
               and attempt_row.lease_generation = job.lease_generation
               and attempt_row.lease_token_hash = job.lease_token_hash
               and attempt_row.lease_owner_id = job.lease_owner_id
               and attempt_row.expected_job_revision = job.revision
          )
        ) as claim_matches,
        exists (
          select 1
            from inbox_v2_file_objects file_row
            join inbox_v2_message_attachment_anchors attachment_row
              on attachment_row.tenant_id = job.tenant_id
             and attachment_row.id = job.attachment_id
             and attachment_row.owner_message_id = job.parent_message_id
             and attachment_row.owner_timeline_item_id = job.timeline_item_id
             and attachment_row.owner_timeline_content_id =
               job.timeline_content_id
             and attachment_row.owner_block_key = job.content_block_key
             and attachment_row.revision = job.expected_attachment_revision
             and attachment_row.materialization_state = 'pending'
            join inbox_v2_timeline_contents content_row
              on content_row.tenant_id = attachment_row.tenant_id
             and content_row.id = attachment_row.owner_timeline_content_id
             and content_row.state = 'available'
             and content_row.revision >= job.expected_content_revision
            join inbox_v2_messages message_row
              on message_row.tenant_id = content_row.tenant_id
             and message_row.id = attachment_row.owner_message_id
             and message_row.conversation_id = job.conversation_id
             and message_row.timeline_item_id = job.timeline_item_id
             and message_row.content_id = content_row.id
             and message_row.content_revision = content_row.revision
             and message_row.content_state = 'available'
             and message_row.lifecycle = 'active'
             and message_row.revision >= job.expected_parent_revision
            join inbox_v2_timeline_content_payloads payload_row
              on payload_row.tenant_id = content_row.tenant_id
             and payload_row.content_id = content_row.id
             and payload_row.content_revision = content_row.revision
             and payload_row.block_key = job.content_block_key
             and payload_row.attachment_id = job.attachment_id
             and payload_row.attachment_state = 'pending'
           where file_row.tenant_id = job.tenant_id
             and file_row.id = job.file_id
             and file_row.state = 'pending'
             and file_row.revision = job.expected_file_revision
             and file_row.current_file_version_id is null
             and file_row.current_object_version_id is null
             and (
               job.source_locator_kind <> 'provider'
               or exists (
                 select 1
                   from inbox_v2_source_occurrences source_occurrence_row
                  where source_occurrence_row.tenant_id = job.tenant_id
                    and source_occurrence_row.id = job.source_occurrence_id
                    and source_occurrence_row.conversation_id =
                      job.conversation_id
                    and message_row.origin_source_occurrence_id =
                      source_occurrence_row.id
               )
             )
        ) as current_materialization_valid,
        exists (
          select 1
            from inbox_v2_timeline_items timeline_item_row
            join inbox_v2_auth_tenant_heads tenant_auth_row
              on tenant_auth_row.tenant_id = job.tenant_id
             and tenant_auth_row.tenant_rbac_revision =
               job.authorization_tenant_rbac_revision
             and tenant_auth_row.shared_access_revision =
               job.authorization_shared_access_revision
            join inbox_v2_auth_resource_heads resource_auth_row
              on resource_auth_row.tenant_id = job.tenant_id
             and resource_auth_row.id = job.authorization_resource_head_id
             and resource_auth_row.resource_kind = 'conversation'
             and resource_auth_row.conversation_id = job.conversation_id
             and resource_auth_row.resource_access_revision =
               job.authorization_resource_access_revision
             and resource_auth_row.structural_relation_revision =
               job.authorization_structural_relation_revision
             and resource_auth_row.collaborator_set_revision =
               job.authorization_collaborator_set_revision
            join inbox_v2_auth_command_records authorization_command_row
              on authorization_command_row.tenant_id = job.tenant_id
             and authorization_command_row.id = job.authorization_command_id
             and authorization_command_row.client_mutation_id =
               job.authorization_client_mutation_id
             and authorization_command_row.command_type_id =
               job.authorization_command_type_id
             and authorization_command_row.authorization_decision_id =
               job.authorization_decision_id
             and authorization_command_row.authorization_epoch =
               job.authorization_epoch
             and authorization_command_row.authorized_at =
               job.authorization_authorized_at
             and authorization_command_row.state = 'completed'
             and authorization_command_row.mutation_id =
               job.authorization_mutation_id
             and authorization_command_row.actor_kind =
               job.authorization_actor_kind
             and case authorization_command_row.actor_kind
               when 'employee' then
                 authorization_command_row.actor_employee_id
               when 'trusted_service' then
                 authorization_command_row.actor_trusted_service_id
             end = job.authorization_actor_id
             and authorization_command_row.authorization_not_after >
               clock.database_now
             and jsonb_array_length(
               authorization_command_row.authorization_decision_refs
             ) = 2
             and 2 = (
               select count(*)
                 from jsonb_to_recordset(
                   authorization_command_row.authorization_decision_refs
                 ) as decision("notAfter" timestamptz)
                where isfinite(decision."notAfter")
                  and decision."notAfter" > clock.database_now
             )
           where timeline_item_row.tenant_id = job.tenant_id
             and timeline_item_row.id = job.timeline_item_id
             and timeline_item_row.conversation_id = job.conversation_id
             and timeline_item_row.visibility = case job.visibility_boundary
               when 'external_work' then
                 'conversation_external'::inbox_v2_timeline_visibility
               when 'internal' then
                 'internal_participants'::inbox_v2_timeline_visibility
             end
        ) as current_access_valid
        from inbox_v2_file_attachment_materialization_jobs job
        cross join (select clock_timestamp() as database_now) clock
       where job.tenant_id = ${claim.tenantId}
         and job.id = ${claim.jobId}
       for update of job
    `
  );
  assertAtMostOneRow(result.rows, "Materialization I/O authorization");
  const row = result.rows[0];
  if (row === undefined) return "state_conflict";
  const state = requiredString(row.state, "materialization job state");
  if (isTerminalMaterializationState(state)) return "already_terminal";
  if (!new Set(["claimed", "transferring", "verifying"]).has(state)) {
    return "state_conflict";
  }
  const databaseNow = requiredTimestamp(row.database_now, "database clock");
  const leaseExpiresAt = requiredTimestamp(
    row.lease_expires_at,
    "lease expiry"
  );
  if (
    row.claim_matches !== true ||
    Date.parse(leaseExpiresAt) <= Date.parse(databaseNow)
  ) {
    return "lease_lost";
  }
  const revision = requiredCounter(row.revision, "materialization revision");
  const leaseGeneration = requiredCounter(
    row.lease_generation,
    "lease generation"
  );
  if (
    row.current_materialization_valid === true &&
    row.current_access_valid === true
  ) {
    return "authorized";
  }
  if (row.current_materialization_valid === true) {
    const released = await transaction.execute<IdRow>(sql`
      update inbox_v2_file_attachment_materialization_jobs
         set state = 'pending',
             lease_token_hash = null,
             lease_owner_id = null,
             lease_claimed_at = null,
             lease_expires_at = null,
             revision = revision + 1,
             updated_at = clock_timestamp()
       where tenant_id = ${claim.tenantId}
         and id = ${claim.jobId}
         and state in ('claimed', 'transferring', 'verifying')
         and revision = ${revision}::bigint
         and lease_generation = ${leaseGeneration}::bigint
         and lease_token_hash = ${leaseTokenHash}
       returning id
    `);
    return released.rows.length === 1
      ? "authorization_refresh_required"
      : "state_conflict";
  }
  const cancelled = await transaction.execute<IdRow>(sql`
    update inbox_v2_file_attachment_materialization_jobs
       set state = 'cancelled',
           lease_token_hash = null,
           lease_owner_id = null,
           lease_claimed_at = null,
           lease_expires_at = null,
           terminal_reason_id =
             'core:attachment-materialization-current-fence-lost',
           revision = revision + 1,
           updated_at = clock_timestamp()
     where tenant_id = ${claim.tenantId}
       and id = ${claim.jobId}
       and state in ('claimed', 'transferring', 'verifying')
       and revision = ${revision}::bigint
       and lease_generation = ${leaseGeneration}::bigint
       and lease_token_hash = ${leaseTokenHash}
     returning id
  `);
  return cancelled.rows.length === 1 ? "cancelled" : "state_conflict";
}

/**
 * Raw completion primitive. It must run from TimelineMessageRepository's
 * `withMessageMutation` callback, after the append-only content revision and
 * payload have been inserted but before that transaction commits.
 */
export async function prepareReadyAttachmentMaterializationInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: FinalizeInboxV2AttachmentReadyInMessageMutationInput
): Promise<PrepareInboxV2ReadyAttachmentMaterializationResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  const atomicToken = requireAtomicPreparationToken(context);
  const transaction = context.executor;
  const normalized = normalizeReadyFinalization(input);
  assertMaterializationContextTenant(
    context.tenantId,
    normalized.claim.tenantId
  );
  assertMaterializationCompletionAuthority(
    context,
    normalized.claim,
    normalized.contentFence
  );
  const locked = await lockMaterializationFinalization(
    transaction,
    normalized.claim
  );
  if (locked === null) return { kind: "state_conflict" };
  const replay = classifyReadyReplay(locked, normalized);
  if (replay !== null) return { kind: replay };
  const lease = classifyLiveMaterializationLease(locked, normalized.claim);
  if (lease !== null) return { kind: lease };
  if (
    !isExpectedMaterializationFileFence(locked, normalized.claim) ||
    !isExpectedContentFenceBase(
      locked,
      normalized.claim,
      normalized.contentFence
    ) ||
    normalized.storage.storageKey !== normalized.claim.storageKey ||
    normalized.storage.storageKey !==
      requiredString(locked.reserved_storage_object_key, "reserved storage key")
  ) {
    return { kind: "state_conflict" };
  }
  const orphanAdoption = await lockReadyStorageOrphanAdoptionCandidate(
    transaction,
    normalized
  );
  if (
    orphanAdoption !== null &&
    !isExactOpenReadyStorageOrphanAdoptionCandidate(orphanAdoption, normalized)
  ) {
    return { kind: "state_conflict" };
  }
  const capability = Object.freeze({
    [preparedReadyAttachmentMaterializationBrand]: true as const
  });
  preparedReadyAttachmentMaterializations.set(capability, {
    sealExecutor: requireInboxV2AtomicSealExecutor(context),
    atomicToken,
    rawInput: input,
    normalized,
    locked,
    orphan: orphanAdoption,
    consumed: false
  });
  return { kind: "proceed", capability };
}

export async function prepareFailedAttachmentMaterializationInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: FinalizeInboxV2AttachmentFailedInMessageMutationInput
): Promise<PrepareInboxV2FailedAttachmentMaterializationResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  const atomicToken = requireAtomicPreparationToken(context);
  const transaction = context.executor;
  const normalized = normalizeFailedFinalization(input);
  assertMaterializationContextTenant(
    context.tenantId,
    normalized.claim.tenantId
  );
  assertMaterializationCompletionAuthority(
    context,
    normalized.claim,
    normalized.contentFence
  );
  const locked = await lockMaterializationFinalization(
    transaction,
    normalized.claim
  );
  if (locked === null) return { kind: "state_conflict" };
  const replay = classifyFailedReplay(locked, normalized);
  if (replay !== null) return { kind: replay };
  const lease = classifyLiveMaterializationLease(locked, normalized.claim);
  if (lease !== null) return { kind: lease };
  if (
    !isExpectedMaterializationFileFence(locked, normalized.claim) ||
    !isExpectedContentFenceBase(
      locked,
      normalized.claim,
      normalized.contentFence
    )
  ) {
    return { kind: "state_conflict" };
  }
  const capability = Object.freeze({
    [preparedFailedAttachmentMaterializationBrand]: true as const
  });
  preparedFailedAttachmentMaterializations.set(capability, {
    sealExecutor: requireInboxV2AtomicSealExecutor(context),
    atomicToken,
    rawInput: input,
    normalized,
    locked,
    consumed: false
  });
  return { kind: "proceed", capability };
}

export async function finalizeReadyInMessageMutation(
  transaction: RawSqlExecutor,
  input: FinalizeInboxV2AttachmentReadyInMessageMutationInput
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  return finalizeReadyMaterialization(transaction, input, null);
}

export async function sealPreparedReadyAttachmentMaterializationInMessageMutation(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  capability: InboxV2PreparedReadyAttachmentMaterializationCapability
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedReadyAttachmentMaterializations.get(capability);
  assertPreparedAttachmentMaterializationCapability(
    prepared,
    context.atomicMaterializationToken,
    "ready"
  );
  assertMaterializationContextTenant(
    context.tenantId,
    prepared.normalized.claim.tenantId
  );
  assertMaterializationCompletionAuthority(
    context,
    prepared.normalized.claim,
    prepared.normalized.contentFence
  );
  prepared.consumed = true;
  const result = await finalizeReadyMaterialization(
    prepared.sealExecutor,
    prepared.rawInput,
    prepared
  );
  registerAppliedAttachmentMaterializationProof(
    context,
    prepared.normalized.claim,
    prepared.normalized.contentFence,
    result,
    null
  );
  return result;
}

async function finalizeReadyMaterialization(
  transaction: RawSqlExecutor,
  input: FinalizeInboxV2AttachmentReadyInMessageMutationInput,
  prepared: PreparedReadyAttachmentMaterializationState | null
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  const normalized = prepared?.normalized ?? normalizeReadyFinalization(input);
  let locked: MaterializationFinalizationRow;
  if (prepared === null) {
    const selected = await lockMaterializationFinalization(
      transaction,
      normalized.claim
    );
    if (selected === null) return "state_conflict";
    locked = selected;
    const replay = classifyReadyReplay(locked, normalized);
    if (replay !== null) return replay;
    const lease = classifyLiveMaterializationLease(locked, normalized.claim);
    if (lease !== null) return lease;
    if (
      !isExpectedMaterializationFileFence(locked, normalized.claim) ||
      !isExpectedContentFenceBase(
        locked,
        normalized.claim,
        normalized.contentFence
      )
    ) {
      return "state_conflict";
    }
  } else {
    locked = prepared.locked;
  }
  if (
    normalized.storage.storageKey !== normalized.claim.storageKey ||
    normalized.storage.storageKey !==
      requiredString(locked.reserved_storage_object_key, "reserved storage key")
  ) {
    return "state_conflict";
  }
  let orphanAdoption: StorageOrphanAdoptionCandidateRow | null;
  if (prepared === null) {
    orphanAdoption = await lockReadyStorageOrphanAdoptionCandidate(
      transaction,
      normalized
    );
    if (
      orphanAdoption !== null &&
      !isExactOpenReadyStorageOrphanAdoptionCandidate(
        orphanAdoption,
        normalized
      )
    ) {
      return "state_conflict";
    }
    const content = await loadMaterializationContentFence(
      transaction,
      normalized.contentFence
    );
    if (
      content === null ||
      !isReadyMaterializationContentFence(
        content,
        normalized.claim,
        normalized.contentFence
      )
    ) {
      return "state_conflict";
    }
  } else {
    orphanAdoption = prepared.orphan;
  }
  const databaseNow = requiredTimestamp(locked.database_now, "database clock");
  const retentionAnchorAt = requiredTimestamp(
    locked.file_retention_anchor_at,
    "file retention anchor"
  );
  const leaseGeneration = requiredCounter(
    locked.lease_generation,
    "lease generation"
  );
  const operationEvidenceId = deriveBrandedId(
    "object_operation_evidence",
    normalized.claim.tenantId,
    normalized.claim.jobId,
    leaseGeneration,
    "put"
  );
  const materializationEvidenceId = deriveBrandedId(
    "attachment_materialization_evidence",
    normalized.claim.tenantId,
    normalized.claim.jobId,
    leaseGeneration
  );
  const operationAttemptToken = `object-put:${deriveRawSha256(
    "core:inbox-v2.object-put-attempt-token@v1",
    normalized.claim.tenantId,
    normalized.claim.attemptId
  )}`;
  const parentIdentityDigestSha256 = calculateParentIdentityDigest(
    normalized.claim,
    normalized.contentFence
  );
  const parentLinkId = deriveBrandedId(
    "file_parent_link",
    normalized.claim.tenantId,
    normalized.claim.fileId,
    parentIdentityDigestSha256
  );

  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_object_versions (
        tenant_id, id, storage_root_id, storage_object_key,
        storage_version_identity, versioning_mode, checksum_sha256,
        size_bytes, declared_media_type, detected_media_type,
        encryption_key_ref, data_class_id, retention_anchor_at, created_at
      ) values (
        ${normalized.claim.tenantId}, ${normalized.claim.objectVersionId},
        ${normalized.claim.storageRootId}, ${normalized.storage.storageKey},
        ${normalized.storage.storageVersionId}, 'native_version',
        ${normalized.storage.rawChecksumSha256}, ${normalized.storage.sizeBytes}::bigint,
        ${normalized.storage.mediaType}, ${normalized.storage.mediaType}, null,
        ${requiredString(locked.file_data_class_id, "file data class")},
        ${retentionAnchorAt}::timestamptz, ${databaseNow}::timestamptz
      )
      returning id
    `,
    "Object-version insert"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_object_operation_evidence (
        tenant_id, id, object_version_id, materialization_job_id,
        operation_kind, storage_root_id, attempt_token, outcome,
        safe_reason_id, observed_version_count, affected_bytes,
        deletion_evidence_digest_sha256, expected_object_head_revision,
        live_parent_count, active_purpose_count, active_hold_count,
        deletion_authority_evaluated_at,
        deletion_authority_decision_sha256, requested_at, completed_at,
        revision
      ) values (
        ${normalized.claim.tenantId}, ${operationEvidenceId},
        ${normalized.claim.objectVersionId}, ${normalized.claim.jobId},
        'put', ${normalized.claim.storageRootId}, ${operationAttemptToken},
        'succeeded', null, null, ${normalized.storage.sizeBytes}::bigint,
        null, null, null, null, null, null, null,
        ${databaseNow}::timestamptz, ${databaseNow}::timestamptz, 1
      )
      returning id
    `,
    "Object-operation evidence insert"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_object_version_heads (
        tenant_id, object_version_id, state, latest_operation_evidence_id,
        revision, state_changed_at, created_at
      ) values (
        ${normalized.claim.tenantId}, ${normalized.claim.objectVersionId},
        'ready', ${operationEvidenceId}, 1,
        ${databaseNow}::timestamptz, ${databaseNow}::timestamptz
      )
      returning object_version_id as id
    `,
    "Object-version head insert"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_versions (
        tenant_id, id, file_id, version_number, object_version_id, created_at
      ) values (
        ${normalized.claim.tenantId}, ${normalized.claim.fileVersionId},
        ${normalized.claim.fileId}, 1, ${normalized.claim.objectVersionId},
        ${databaseNow}::timestamptz
      )
      returning id
    `,
    "File-version insert"
  );
  await expectOneRow(
    transaction,
    sql`
      update inbox_v2_file_objects
      set state = 'ready',
          current_file_version_id = ${normalized.claim.fileVersionId},
          current_object_version_id = ${normalized.claim.objectVersionId},
          revision = revision + 1,
          updated_at = ${databaseNow}::timestamptz
      where tenant_id = ${normalized.claim.tenantId}
        and id = ${normalized.claim.fileId}
        and state = 'pending'
        and revision = ${normalized.claim.expectedFileRevision}::bigint
        and current_file_version_id is null
        and current_object_version_id is null
      returning id
    `,
    "File-head ready CAS"
  );
  await expectOneRow(
    transaction,
    buildAdvanceAttachmentAnchorSql(
      normalized.claim,
      normalized.contentFence,
      "ready",
      databaseNow
    ),
    "Attachment-anchor ready CAS"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_parent_set_heads (
        tenant_id, file_id, revision, completeness,
        completeness_revision, live_parent_count, updated_at
      ) values (
        ${normalized.claim.tenantId}, ${normalized.claim.fileId}, 1,
        'complete', 1, 1, ${databaseNow}::timestamptz
      )
      returning file_id as id
    `,
    "File parent-set head insert"
  );
  await expectOneRow(
    transaction,
    buildInsertMaterializedFileParentLinkSql({
      claim: normalized.claim,
      contentFence: normalized.contentFence,
      parentLinkId,
      parentIdentityDigestSha256,
      dataClassId: requiredString(locked.file_data_class_id, "file data class"),
      processingPurposeId: requiredString(
        locked.file_processing_purpose_id,
        "file processing purpose"
      ),
      retentionAnchorAt,
      databaseNow
    }),
    "File parent-link insert"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_parent_link_heads (
        tenant_id, link_id, file_id, state, detached_by_event_id,
        revision, updated_at
      ) values (
        ${normalized.claim.tenantId}, ${parentLinkId},
        ${normalized.claim.fileId}, 'live', null, 1,
        ${databaseNow}::timestamptz
      )
      returning link_id as id
    `,
    "File parent-link head insert"
  );
  const evidenceHashSha256 = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-evidence@v2",
    normalized.claim.tenantId,
    normalized.claim.jobId,
    normalized.claim.attemptId,
    normalized.claim.causeEventId,
    normalized.claim.causeMutationId,
    normalized.claim.causeStreamCommitId,
    normalized.claim.causeStreamPosition,
    normalized.claim.correlationId,
    normalized.claim.causedAt,
    ...materializationReservationAuthorityHashParts(normalized.claim),
    leaseGeneration,
    "ready",
    normalized.claim.fileId,
    normalized.claim.fileVersionId,
    normalized.claim.objectVersionId,
    normalized.contentFence.resultingAttachmentRevision,
    normalized.contentFence.resultingContentRevision,
    normalized.storage.rawChecksumSha256,
    String(normalized.storage.sizeBytes)
  );
  await expectOneRow(
    transaction,
    buildInsertMaterializationEvidenceSql({
      claim: normalized.claim,
      contentFence: normalized.contentFence,
      materializationEvidenceId,
      leaseGeneration,
      outcome: "ready",
      resultingFileRevision: incrementCounter(
        normalized.claim.expectedFileRevision
      ),
      objectOperationEvidenceId: operationEvidenceId,
      safeReasonId: null,
      retryable: null,
      evidenceHashSha256,
      databaseNow
    }),
    "Ready materialization evidence insert"
  );
  await expectMaterializationTerminalJobCas(
    transaction,
    buildFinalizeMaterializationJobSql({
      claim: normalized.claim,
      contentFence: normalized.contentFence,
      outcome: "ready",
      resultingFileRevision: incrementCounter(
        normalized.claim.expectedFileRevision
      ),
      safeReasonId: null,
      databaseNow
    }),
    "Ready materialization job CAS"
  );
  if (orphanAdoption !== null) {
    await expectOneRow(
      transaction,
      buildAdoptReadyStorageOrphanSql({
        claim: normalized.claim,
        storage: normalized.storage,
        orphan: orphanAdoption,
        terminalEvidenceDigestSha256: evidenceHashSha256,
        databaseNow
      }),
      "Ready storage orphan adoption CAS"
    );
  }
  return {
    kind: "applied",
    jobId: normalized.claim.jobId,
    evidenceId: materializationEvidenceId,
    outcome: "ready",
    fileId: normalized.claim.fileId,
    fileVersionId: normalized.claim.fileVersionId,
    objectVersionId: normalized.claim.objectVersionId,
    attachmentId: normalized.contentFence.attachmentId,
    attachmentRevision: normalized.contentFence.resultingAttachmentRevision,
    contentId: normalized.contentFence.timelineContentId,
    contentRevision: normalized.contentFence.resultingContentRevision
  };
}

/** See `finalizeReadyInMessageMutation`; failed fallback is also append-only. */
export async function finalizeFailedInMessageMutation(
  transaction: RawSqlExecutor,
  input: FinalizeInboxV2AttachmentFailedInMessageMutationInput
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  return finalizeFailedMaterialization(transaction, input, null);
}

export async function sealPreparedFailedAttachmentMaterializationInMessageMutation(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  capability: InboxV2PreparedFailedAttachmentMaterializationCapability
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  assertInboxV2AuthorizedAtomicMaterializationContext(context);
  const prepared = preparedFailedAttachmentMaterializations.get(capability);
  assertPreparedAttachmentMaterializationCapability(
    prepared,
    context.atomicMaterializationToken,
    "failed"
  );
  assertMaterializationContextTenant(
    context.tenantId,
    prepared.normalized.claim.tenantId
  );
  assertMaterializationCompletionAuthority(
    context,
    prepared.normalized.claim,
    prepared.normalized.contentFence
  );
  prepared.consumed = true;
  const result = await finalizeFailedMaterialization(
    prepared.sealExecutor,
    prepared.rawInput,
    prepared
  );
  registerAppliedAttachmentMaterializationProof(
    context,
    prepared.normalized.claim,
    prepared.normalized.contentFence,
    result,
    prepared.normalized.safeReasonId
  );
  return result;
}

async function finalizeFailedMaterialization(
  transaction: RawSqlExecutor,
  input: FinalizeInboxV2AttachmentFailedInMessageMutationInput,
  prepared: PreparedFailedAttachmentMaterializationState | null
): Promise<FinalizeInboxV2AttachmentMaterializationResult> {
  const normalized = prepared?.normalized ?? normalizeFailedFinalization(input);
  let locked: MaterializationFinalizationRow;
  if (prepared === null) {
    const selected = await lockMaterializationFinalization(
      transaction,
      normalized.claim
    );
    if (selected === null) return "state_conflict";
    locked = selected;
    const replay = classifyFailedReplay(locked, normalized);
    if (replay !== null) return replay;
    const lease = classifyLiveMaterializationLease(locked, normalized.claim);
    if (lease !== null) return lease;
    if (
      !isExpectedMaterializationFileFence(locked, normalized.claim) ||
      !isExpectedContentFenceBase(
        locked,
        normalized.claim,
        normalized.contentFence
      )
    ) {
      return "state_conflict";
    }
    const content = await loadMaterializationContentFence(
      transaction,
      normalized.contentFence
    );
    if (
      content === null ||
      !isFailedMaterializationContentFence(
        content,
        normalized.contentFence,
        normalized.safeReasonId
      )
    ) {
      return "state_conflict";
    }
  } else {
    locked = prepared.locked;
  }
  const databaseNow = requiredTimestamp(locked.database_now, "database clock");
  await expectOneRow(
    transaction,
    buildAdvanceAttachmentAnchorSql(
      normalized.claim,
      normalized.contentFence,
      "failed",
      databaseNow
    ),
    "Attachment-anchor failed CAS"
  );
  const leaseGeneration = requiredCounter(
    locked.lease_generation,
    "lease generation"
  );
  const materializationEvidenceId = deriveBrandedId(
    "attachment_materialization_evidence",
    normalized.claim.tenantId,
    normalized.claim.jobId,
    leaseGeneration
  );
  const evidenceHashSha256 = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-evidence@v2",
    normalized.claim.tenantId,
    normalized.claim.jobId,
    normalized.claim.attemptId,
    normalized.claim.causeEventId,
    normalized.claim.causeMutationId,
    normalized.claim.causeStreamCommitId,
    normalized.claim.causeStreamPosition,
    normalized.claim.correlationId,
    normalized.claim.causedAt,
    ...materializationReservationAuthorityHashParts(normalized.claim),
    leaseGeneration,
    "failed",
    normalized.safeReasonId,
    String(normalized.retryable),
    normalized.contentFence.resultingAttachmentRevision,
    normalized.contentFence.resultingContentRevision
  );
  await expectOneRow(
    transaction,
    buildInsertMaterializationEvidenceSql({
      claim: normalized.claim,
      contentFence: normalized.contentFence,
      materializationEvidenceId,
      leaseGeneration,
      outcome: "failed",
      resultingFileRevision: null,
      objectOperationEvidenceId: null,
      safeReasonId: normalized.safeReasonId,
      retryable: normalized.retryable,
      evidenceHashSha256,
      databaseNow
    }),
    "Failed materialization evidence insert"
  );
  await expectMaterializationTerminalJobCas(
    transaction,
    buildFinalizeMaterializationJobSql({
      claim: normalized.claim,
      contentFence: normalized.contentFence,
      outcome: "failed",
      resultingFileRevision: null,
      safeReasonId: normalized.safeReasonId,
      databaseNow
    }),
    "Failed materialization job CAS"
  );
  return {
    kind: "applied",
    jobId: normalized.claim.jobId,
    evidenceId: materializationEvidenceId,
    outcome: "failed",
    fileId: normalized.claim.fileId,
    fileVersionId: null,
    objectVersionId: null,
    attachmentId: normalized.contentFence.attachmentId,
    attachmentRevision: normalized.contentFence.resultingAttachmentRevision,
    contentId: normalized.contentFence.timelineContentId,
    contentRevision: normalized.contentFence.resultingContentRevision
  };
}

function registerAppliedAttachmentMaterializationProof(
  context: InboxV2AuthorizedAtomicMaterializationContext,
  claim: InboxV2AttachmentMaterializationClaim,
  contentFence: InboxV2AttachmentMaterializationContentFence,
  result: FinalizeInboxV2AttachmentMaterializationResult,
  safeReasonId: string | null
): void {
  if (typeof result === "string") return;
  if (
    contentFence.parentKind !== "message" ||
    context.actor.kind !== "trusted_service"
  ) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_parent_kind_unsupported",
      "Atomic attachment materialization requires a Message parent and trusted-service context."
    );
  }
  registerInboxV2AtomicAttachmentMaterializationProof(
    context.atomicMaterializationToken,
    {
      tenantId: claim.tenantId,
      jobId: claim.jobId,
      attemptId: claim.attemptId,
      evidenceId: result.evidenceId,
      outcome: result.outcome,
      completedByTrustedServiceId: context.actor.trustedServiceId,
      fileId: claim.fileId,
      resultingFileRevision:
        result.outcome === "ready"
          ? incrementCounter(claim.expectedFileRevision)
          : claim.expectedFileRevision,
      fileVersionId: result.fileVersionId,
      objectVersionId: result.objectVersionId,
      conversationId: contentFence.conversationId,
      timelineItemId: contentFence.timelineItemId,
      contentId: result.contentId,
      resultingContentRevision: result.contentRevision,
      contentBlockKey: contentFence.contentBlockKey,
      attachmentId: result.attachmentId,
      resultingAttachmentRevision: result.attachmentRevision,
      parentKind: "message",
      parentEntityId: contentFence.parentEntityId,
      parentEntityRevision: contentFence.parentEntityRevision,
      causeEventId: claim.causeEventId,
      causeMutationId: claim.causeMutationId,
      causeStreamCommitId: claim.causeStreamCommitId,
      causeStreamPosition: claim.causeStreamPosition,
      correlationId: claim.correlationId,
      causedAt: claim.causedAt,
      safeReasonId
    }
  );
}

async function lockMaterializationFinalization(
  transaction: RawSqlExecutor,
  claim: InboxV2AttachmentMaterializationClaim
): Promise<MaterializationFinalizationRow | null> {
  const result = await transaction.execute<MaterializationFinalizationRow>(
    buildLockInboxV2AttachmentMaterializationFinalizationSql(claim)
  );
  assertAtMostOneRow(
    result.rows,
    "Attachment materialization finalization lock"
  );
  return result.rows[0] ?? null;
}

function assertPreparedAttachmentMaterializationCapability<
  TPrepared extends Readonly<{
    sealExecutor: RawSqlExecutor;
    atomicToken: object;
    consumed: boolean;
  }>
>(
  prepared: TPrepared | undefined,
  atomicToken: object,
  outcome: "ready" | "failed"
): asserts prepared is TPrepared {
  if (prepared === undefined) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_capability_unknown",
      `The prepared ${outcome} materialization capability was not issued by this repository.`
    );
  }
  if (prepared.atomicToken !== atomicToken) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_capability_token_mismatch",
      `The prepared ${outcome} materialization capability belongs to another atomic mutation.`
    );
  }
  if (prepared.consumed) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_capability_consumed",
      `The prepared ${outcome} materialization capability was already consumed.`
    );
  }
}

function requireAtomicPreparationToken(
  context: InboxV2AuthorizedCommandMutationContext
): object {
  const token = context.atomicMaterializationToken;
  if (token === undefined) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_atomic_context_required",
      "Attachment materialization preparation requires the live two-phase authorized coordinator."
    );
  }
  return token;
}

function assertMaterializationContextTenant(
  contextTenantId: string,
  materializationTenantId: string
): void {
  if (contextTenantId !== materializationTenantId) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_context_tenant_mismatch",
      "Attachment materialization cannot cross the authorized tenant boundary."
    );
  }
}

function assertMaterializationCompletionAuthority(
  context:
    | InboxV2AuthorizedCommandMutationContext
    | InboxV2AuthorizedAtomicMaterializationContext,
  claim: InboxV2AttachmentMaterializationClaim,
  contentFence: InboxV2AttachmentMaterializationContentFence
): void {
  const authority = normalizeMaterializationReservationAuthority(
    context,
    contentFence.conversationId,
    contentFence.visibilityBoundary === "external_work"
      ? "external_work"
      : "internal"
  );
  if (
    context.commandTypeId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_COMPLETION_COMMAND_TYPE_ID ||
    context.actor.kind !== "trusted_service" ||
    contentFence.parentKind !== "message" ||
    authority.decisionSetDigestSha256 !==
      claim.reservationAuthority.decisionSetDigestSha256 ||
    authority.resourceFenceSetDigestSha256 !==
      claim.reservationAuthority.resourceFenceSetDigestSha256 ||
    authority.tenantRbacRevision !==
      claim.reservationAuthority.tenantRbacRevision ||
    authority.sharedAccessRevision !==
      claim.reservationAuthority.sharedAccessRevision ||
    authority.resourceHeadId !== claim.reservationAuthority.resourceHeadId ||
    authority.resourceAccessRevision !==
      claim.reservationAuthority.resourceAccessRevision ||
    authority.structuralRelationRevision !==
      claim.reservationAuthority.structuralRelationRevision ||
    authority.collaboratorSetRevision !==
      claim.reservationAuthority.collaboratorSetRevision ||
    canonicalizeInboxV2Json(authority.auditGrantSourceIds) !==
      canonicalizeInboxV2Json(claim.reservationAuthority.auditGrantSourceIds) ||
    authority.auditPolicyVersion !==
      claim.reservationAuthority.auditPolicyVersion
  ) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_completion_authority_invalid",
      "Attachment completion requires the exact trusted-service command and conversation authorization fence."
    );
  }
}

async function lockReadyStorageOrphanAdoptionCandidate(
  transaction: RawSqlExecutor,
  input: ReturnType<typeof normalizeReadyFinalization>
): Promise<StorageOrphanAdoptionCandidateRow | null> {
  const result = await transaction.execute<StorageOrphanAdoptionCandidateRow>(
    sql`
      select
        id, materialization_job_id, storage_root_id, storage_object_key,
        storage_version_identity, checksum_sha256, size_bytes,
        detected_media_type, state, claim_token_hash, claim_expires_at,
        adopted_object_version_id, terminal_evidence_digest_sha256,
        safe_reason_id, quarantine_reason_code,
        quarantine_evidence_digest_sha256, quarantine_physical_kind,
        revision
      from inbox_v2_file_storage_orphans
      where tenant_id = ${input.claim.tenantId}
        and storage_root_id = ${input.claim.storageRootId}
        and storage_object_key = ${input.storage.storageKey}
        and storage_version_identity = ${input.storage.storageVersionId}
      for update
    `
  );
  assertAtMostOneRow(result.rows, "Ready storage orphan adoption lock");
  return result.rows[0] ?? null;
}

function isExactOpenReadyStorageOrphanAdoptionCandidate(
  row: StorageOrphanAdoptionCandidateRow,
  input: ReturnType<typeof normalizeReadyFinalization>
): boolean {
  return (
    row.id ===
      deriveInboxV2StorageOrphanId({
        tenantId: input.claim.tenantId,
        storageRootId: input.claim.storageRootId,
        storageKey: input.storage.storageKey,
        storageVersionIdentity: input.storage.storageVersionId
      }) &&
    row.materialization_job_id === input.claim.jobId &&
    row.storage_root_id === input.claim.storageRootId &&
    row.storage_object_key === input.storage.storageKey &&
    row.storage_version_identity === input.storage.storageVersionId &&
    row.checksum_sha256 === input.storage.rawChecksumSha256 &&
    String(row.size_bytes) === String(input.storage.sizeBytes) &&
    row.detected_media_type === input.storage.mediaType &&
    row.state === "open" &&
    row.claim_token_hash === null &&
    row.claim_expires_at === null &&
    row.adopted_object_version_id === null &&
    row.terminal_evidence_digest_sha256 === null &&
    row.safe_reason_id === null &&
    row.quarantine_reason_code === null &&
    row.quarantine_evidence_digest_sha256 === null &&
    row.quarantine_physical_kind === null &&
    requiredCounter(row.revision, "storage orphan revision") ===
      String(row.revision)
  );
}

export function buildLockInboxV2AttachmentMaterializationFinalizationSql(
  claim: InboxV2AttachmentMaterializationClaim
): SQL {
  return sql`
    select
      job.id as job_id,
      job.state as job_state,
      job.revision as job_revision,
      job.attachment_id,
      job.file_id,
      job.expected_file_revision,
      job.expected_attachment_revision,
      job.conversation_id,
      job.timeline_item_id,
      job.parent_message_id,
      job.expected_parent_revision,
      job.visibility_boundary,
      job.timeline_content_id,
      job.expected_content_revision,
      job.content_block_key,
      job.content_mutation_fence_sha256,
      job.source_occurrence_id,
      job.source_locator_kind,
      job.source_locator_reference,
      job.source_locator_digest_sha256,
      job.reservation_namespace_generation,
      job.cause_event_id,
      job.cause_mutation_id,
      job.cause_stream_commit_id,
      job.cause_stream_position,
      job.correlation_id,
      job.caused_at,
      job.authorization_command_id,
      job.authorization_command_type_id,
      job.authorization_client_mutation_id,
      job.authorization_mutation_id,
      job.authorization_decision_id,
      job.authorization_epoch,
      job.authorization_actor_kind,
      job.authorization_actor_id,
      job.authorization_authorized_at,
      job.authorization_decision_set_digest_sha256,
      job.authorization_resource_fence_set_digest_sha256,
      job.authorization_tenant_rbac_revision,
      job.authorization_shared_access_revision,
      job.authorization_resource_head_id,
      job.authorization_resource_access_revision,
      job.authorization_structural_relation_revision,
      job.authorization_collaborator_set_revision,
      job.authorization_audit_grant_source_ids,
      job.authorization_audit_policy_version,
      job.lease_generation,
      job.lease_token_hash,
      job.lease_owner_id,
      job.lease_expires_at,
      job.reserved_file_version_id,
      job.reserved_object_version_id,
      job.reserved_storage_root_id,
      job.reserved_storage_object_key,
      job.result_file_version_id,
      job.result_object_version_id,
      job.result_file_revision,
      job.result_content_revision,
      job.terminal_reason_id,
      attempt.id as attempt_id,
      attempt.job_id as attempt_job_id,
      attempt.attachment_id as attempt_attachment_id,
      attempt.file_id as attempt_file_id,
      attempt.lease_generation as attempt_lease_generation,
      attempt.lease_token_hash as attempt_lease_token_hash,
      attempt.lease_owner_id as attempt_lease_owner_id,
      attempt.expected_job_revision as attempt_expected_job_revision,
      attempt.expected_file_revision as attempt_expected_file_revision,
      attempt.expected_attachment_revision as attempt_expected_attachment_revision,
      attempt.claimed_at as attempt_claimed_at,
      attempt.lease_expires_at as attempt_lease_expires_at,
      file.state as file_state,
      file.revision as file_revision,
      file.current_file_version_id as file_current_file_version_id,
      file.current_object_version_id as file_current_object_version_id,
      file.data_class_id as file_data_class_id,
      file.processing_purpose_id as file_processing_purpose_id,
      file.retention_anchor_at as file_retention_anchor_at,
      attachment.revision as attachment_revision,
      terminal_content.id as terminal_content_id,
      terminal_revision.revision as terminal_content_revision,
      terminal_revision.transition_kind as terminal_content_transition_kind,
      terminal_payload.attachment_id as terminal_payload_attachment_id,
      terminal_payload.attachment_state as terminal_payload_attachment_state,
      terminal_payload.attachment_v2_file_id as terminal_payload_file_id,
      terminal_payload.attachment_file_revision as terminal_payload_file_revision,
      terminal_payload.attachment_file_version_id as terminal_payload_file_version_id,
      terminal_payload.attachment_object_version_id as terminal_payload_object_version_id,
      terminal_payload.attachment_failure_reason_id as terminal_payload_failure_reason_id,
      terminal_payload.block_key as terminal_payload_block_key,
      terminal_content.owner_kind as terminal_owner_kind,
      terminal_content.owner_id as terminal_owner_id,
      coalesce(terminal_message.conversation_id, terminal_note.conversation_id)
        as terminal_conversation_id,
      coalesce(terminal_message.timeline_item_id, terminal_note.timeline_item_id)
        as terminal_timeline_item_id,
      coalesce(terminal_message.revision, terminal_note.revision)
        as terminal_parent_entity_revision,
      terminal_item.visibility as terminal_timeline_visibility,
      replay_file_version.id as replay_file_version_id,
      replay_file_version.file_id as replay_file_version_file_id,
      replay_file_version.object_version_id as replay_file_version_object_version_id,
      replay_object_version.id as replay_object_version_id,
      replay_object_version.storage_root_id as replay_storage_root_id,
      replay_object_version.storage_object_key as replay_storage_object_key,
      replay_object_version.storage_version_identity as replay_storage_version_identity,
      replay_object_version.checksum_sha256 as replay_checksum_sha256,
      replay_object_version.size_bytes as replay_size_bytes,
      replay_object_version.declared_media_type as replay_declared_media_type,
      replay_object_version.detected_media_type as replay_detected_media_type,
      replay_object_head.state as replay_object_head_state,
      replay_object_head.latest_operation_evidence_id
        as replay_object_head_evidence_id,
      replay_operation.id as replay_operation_evidence_id,
      replay_operation.object_version_id as replay_operation_object_version_id,
      replay_operation.materialization_job_id as replay_operation_job_id,
      replay_operation.operation_kind as replay_operation_kind,
      replay_operation.storage_root_id as replay_operation_storage_root_id,
      replay_operation.attempt_token as replay_operation_attempt_token,
      replay_operation.outcome as replay_operation_outcome,
      replay_operation.affected_bytes as replay_operation_affected_bytes,
      replay_evidence.id as replay_evidence_id,
      replay_evidence.job_id as replay_evidence_job_id,
      replay_evidence.attempt_id as replay_evidence_attempt_id,
      replay_evidence.attachment_id as replay_evidence_attachment_id,
      replay_evidence.file_id as replay_evidence_file_id,
      replay_evidence.expected_file_revision
        as replay_evidence_expected_file_revision,
      replay_evidence.lease_generation as replay_evidence_lease_generation,
      replay_evidence.expected_attachment_revision
        as replay_evidence_expected_attachment_revision,
      replay_evidence.resulting_attachment_revision
        as replay_evidence_resulting_attachment_revision,
      replay_evidence.timeline_content_id as replay_evidence_content_id,
      replay_evidence.expected_content_revision
        as replay_evidence_expected_content_revision,
      replay_evidence.resulting_content_revision
        as replay_evidence_resulting_content_revision,
      replay_evidence.content_mutation_fence_sha256
        as replay_evidence_content_fence_sha256,
      replay_evidence.outcome as replay_evidence_outcome,
      replay_evidence.result_file_version_id
        as replay_evidence_file_version_id,
      replay_evidence.result_object_version_id
        as replay_evidence_object_version_id,
      replay_evidence.resulting_file_revision
        as replay_evidence_resulting_file_revision,
      replay_evidence.object_operation_evidence_id
        as replay_evidence_operation_id,
      replay_evidence.safe_reason_id as replay_evidence_safe_reason_id,
      replay_evidence.retryable as replay_evidence_retryable,
      replay_evidence.evidence_hash_sha256 as replay_evidence_hash_sha256,
      clock.database_now
    from inbox_v2_file_attachment_materialization_jobs job
    join inbox_v2_file_objects file
      on file.tenant_id = job.tenant_id and file.id = job.file_id
    join inbox_v2_message_attachment_anchors attachment
      on attachment.tenant_id = job.tenant_id
     and attachment.id = job.attachment_id
    left join inbox_v2_file_attachment_materialization_attempts attempt
      on attempt.tenant_id = job.tenant_id
     and attempt.job_id = job.id
     and attempt.id = ${claim.attemptId}
    left join inbox_v2_file_attachment_materialization_evidence replay_evidence
      on replay_evidence.tenant_id = job.tenant_id
     and replay_evidence.job_id = job.id
     and replay_evidence.attempt_id = attempt.id
    left join inbox_v2_file_versions replay_file_version
      on replay_file_version.tenant_id = job.tenant_id
     and replay_file_version.id = job.result_file_version_id
     and replay_file_version.file_id = job.file_id
     and replay_file_version.object_version_id = job.result_object_version_id
    left join inbox_v2_file_object_versions replay_object_version
      on replay_object_version.tenant_id = replay_file_version.tenant_id
     and replay_object_version.id = replay_file_version.object_version_id
    left join inbox_v2_file_object_version_heads replay_object_head
      on replay_object_head.tenant_id = replay_object_version.tenant_id
     and replay_object_head.object_version_id = replay_object_version.id
    left join inbox_v2_file_object_operation_evidence replay_operation
      on replay_operation.tenant_id = replay_object_head.tenant_id
     and replay_operation.id = replay_object_head.latest_operation_evidence_id
    left join inbox_v2_timeline_contents terminal_content
      on terminal_content.tenant_id = job.tenant_id
     and terminal_content.id = job.timeline_content_id
    left join inbox_v2_timeline_content_revisions terminal_revision
      on terminal_revision.tenant_id = terminal_content.tenant_id
     and terminal_revision.content_id = terminal_content.id
     and terminal_revision.revision = job.result_content_revision
    left join inbox_v2_timeline_content_payloads terminal_payload
      on terminal_payload.tenant_id = terminal_revision.tenant_id
     and terminal_payload.content_id = terminal_revision.content_id
     and terminal_payload.content_revision = terminal_revision.revision
     and terminal_payload.block_key = job.content_block_key
     and terminal_payload.attachment_id = job.attachment_id
    left join inbox_v2_messages terminal_message
      on terminal_content.owner_kind = 'message'
     and terminal_message.tenant_id = terminal_content.tenant_id
     and terminal_message.id = terminal_content.owner_id
    left join inbox_v2_staff_notes terminal_note
      on terminal_content.owner_kind = 'staff_note'
     and terminal_note.tenant_id = terminal_content.tenant_id
     and terminal_note.id = terminal_content.owner_id
    left join inbox_v2_timeline_items terminal_item
      on terminal_item.tenant_id = terminal_content.tenant_id
     and terminal_item.id = coalesce(
       terminal_message.timeline_item_id,
       terminal_note.timeline_item_id
     )
    cross join (select clock_timestamp() as database_now) clock
    where job.tenant_id = ${claim.tenantId}
      and job.id = ${claim.jobId}
    for update of job, file, attachment
  `;
}

async function loadMaterializationContentFence(
  transaction: RawSqlExecutor,
  fence: InboxV2AttachmentMaterializationContentFence
): Promise<MaterializationContentFenceRow | null> {
  const result = await transaction.execute<MaterializationContentFenceRow>(
    buildLoadInboxV2AttachmentMaterializationContentFenceSql(fence)
  );
  assertAtMostOneRow(result.rows, "Attachment materialization content fence");
  return result.rows[0] ?? null;
}

export function buildLoadInboxV2AttachmentMaterializationContentFenceSql(
  fence: InboxV2AttachmentMaterializationContentFence
): SQL {
  return sql`
    select
      content.id as content_id,
      content.revision as content_revision,
      revision.transition_kind,
      payload.attachment_id,
      payload.attachment_state,
      payload.attachment_v2_file_id,
      payload.attachment_file_revision,
      payload.attachment_file_version_id,
      payload.attachment_object_version_id,
      payload.attachment_failure_reason_id,
      payload.block_key,
      content.owner_kind,
      content.owner_id,
      coalesce(message.conversation_id, note.conversation_id) as conversation_id,
      coalesce(message.timeline_item_id, note.timeline_item_id) as timeline_item_id,
      coalesce(message.revision, note.revision) as parent_entity_revision,
      item.visibility as timeline_visibility
    from inbox_v2_timeline_contents content
    join inbox_v2_timeline_content_revisions revision
      on revision.tenant_id = content.tenant_id
     and revision.content_id = content.id
     and revision.revision = content.revision
    join inbox_v2_timeline_content_payloads payload
      on payload.tenant_id = content.tenant_id
     and payload.content_id = content.id
     and payload.content_revision = content.revision
     and payload.block_key = ${fence.contentBlockKey}
    left join inbox_v2_messages message
      on content.owner_kind = 'message'
     and message.tenant_id = content.tenant_id
     and message.id = content.owner_id
    left join inbox_v2_staff_notes note
      on content.owner_kind = 'staff_note'
     and note.tenant_id = content.tenant_id
     and note.id = content.owner_id
    join inbox_v2_timeline_items item
      on item.tenant_id = content.tenant_id
     and item.id = coalesce(message.timeline_item_id, note.timeline_item_id)
    where content.tenant_id = ${fence.tenantId}
      and content.id = ${fence.timelineContentId}
      and content.revision = ${fence.resultingContentRevision}::bigint
      and content.state = 'available'
      and payload.attachment_id = ${fence.attachmentId}
    for share of revision, payload
  `;
}

function buildAdvanceAttachmentAnchorSql(
  claim: InboxV2AttachmentMaterializationClaim,
  fence: InboxV2AttachmentMaterializationContentFence,
  outcome: "ready" | "failed",
  databaseNow: string
): SQL {
  return sql`
    update inbox_v2_message_attachment_anchors
    set materialization_state = ${outcome},
        revision = ${fence.resultingAttachmentRevision}::bigint
    where tenant_id = ${claim.tenantId}
      and id = ${fence.attachmentId}
      and owner_message_id = ${claim.contentOrigin.parentEntityId}
      and owner_timeline_item_id = ${claim.contentOrigin.timelineItemId}
      and owner_timeline_content_id = ${claim.contentOrigin.timelineContentId}
      and owner_block_key = ${claim.contentOrigin.contentBlockKey}
      and materialization_state = 'pending'
      and revision = ${incrementCounter(
        fence.resultingAttachmentRevision,
        -1
      )}::bigint
      and created_at <= ${databaseNow}::timestamptz
    returning id
  `;
}

function buildInsertMaterializedFileParentLinkSql(
  input: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    contentFence: InboxV2AttachmentMaterializationContentFence;
    parentLinkId: string;
    parentIdentityDigestSha256: string;
    dataClassId: string;
    processingPurposeId: string;
    retentionAnchorAt: string;
    databaseNow: string;
  }>
): SQL {
  const fence = input.contentFence;
  return sql`
    insert into inbox_v2_file_parent_links (
      tenant_id, id, file_id, file_version_id, object_version_id,
      parent_identity_digest_sha256, parent_kind, parent_purpose,
      visibility_boundary, parent_conversation_visibility,
      parent_entity_id, parent_entity_revision, conversation_id,
      timeline_item_id, content_id, content_revision, block_key,
      data_class_id, processing_purpose_id, retention_anchor_at,
      created_at, revision
    ) values (
      ${input.claim.tenantId}, ${input.parentLinkId}, ${input.claim.fileId},
      ${input.claim.fileVersionId}, ${input.claim.objectVersionId},
      ${input.parentIdentityDigestSha256}, ${fence.parentKind}, 'attachment',
      ${fence.visibilityBoundary}, ${fence.parentConversationVisibility},
      ${fence.parentEntityId}, ${fence.parentEntityRevision}::bigint,
      ${fence.conversationId}, ${fence.timelineItemId},
      ${fence.timelineContentId}, ${fence.resultingContentRevision}::bigint,
      ${fence.contentBlockKey}, ${input.dataClassId},
      ${input.processingPurposeId}, ${input.retentionAnchorAt}::timestamptz,
      ${input.databaseNow}::timestamptz, 1
    )
    returning id
  `;
}

function buildInsertMaterializationEvidenceSql(
  input: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    contentFence: InboxV2AttachmentMaterializationContentFence;
    materializationEvidenceId: string;
    leaseGeneration: string;
    outcome: "ready" | "failed";
    resultingFileRevision: string | null;
    objectOperationEvidenceId: string | null;
    safeReasonId: string | null;
    retryable: boolean | null;
    evidenceHashSha256: string;
    databaseNow: string;
  }>
): SQL {
  const ready = input.outcome === "ready";
  return sql`
    insert into inbox_v2_file_attachment_materialization_evidence (
      tenant_id, id, job_id, attempt_id, attachment_id, file_id,
      expected_file_revision, lease_generation,
      expected_attachment_revision, resulting_attachment_revision,
      timeline_content_id, expected_content_revision,
      resulting_content_revision, content_mutation_fence_sha256,
      outcome, result_file_version_id, result_object_version_id,
      resulting_file_revision, object_operation_evidence_id,
      safe_reason_id, retryable, completed_at, evidence_hash_sha256,
      revision
    ) values (
      ${input.claim.tenantId}, ${input.materializationEvidenceId},
      ${input.claim.jobId}, ${input.claim.attemptId},
      ${input.contentFence.attachmentId}, ${input.claim.fileId},
      ${input.claim.expectedFileRevision}::bigint,
      ${input.leaseGeneration}::bigint,
      ${input.claim.contentOrigin.expectedAttachmentRevision}::bigint,
      ${input.contentFence.resultingAttachmentRevision}::bigint,
      ${input.claim.contentOrigin.timelineContentId},
      ${incrementCounter(
        input.contentFence.resultingContentRevision,
        -1
      )}::bigint,
      ${input.contentFence.resultingContentRevision}::bigint,
      ${calculateInboxV2AttachmentContentMutationFenceSha256({
        tenantId: input.claim.tenantId,
        attachmentId: input.claim.attachmentId,
        expectedAttachmentRevision:
          input.claim.contentOrigin.expectedAttachmentRevision,
        timelineContentId: input.claim.contentOrigin.timelineContentId,
        expectedContentRevision:
          input.claim.contentOrigin.expectedContentRevision,
        contentBlockKey: input.claim.contentOrigin.contentBlockKey
      })},
      ${input.outcome},
      ${ready ? input.claim.fileVersionId : null},
      ${ready ? input.claim.objectVersionId : null},
      ${input.resultingFileRevision}::bigint,
      ${input.objectOperationEvidenceId}, ${input.safeReasonId},
      ${input.retryable}, ${input.databaseNow}::timestamptz,
      ${input.evidenceHashSha256}, 1
    )
    returning id
  `;
}

function buildFinalizeMaterializationJobSql(
  input: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    contentFence: InboxV2AttachmentMaterializationContentFence;
    outcome: "ready" | "failed";
    resultingFileRevision: string | null;
    safeReasonId: string | null;
    databaseNow: string;
  }>
): SQL {
  const ready = input.outcome === "ready";
  return sql`
    update inbox_v2_file_attachment_materialization_jobs
    set state = ${input.outcome},
        lease_token_hash = null,
        lease_owner_id = null,
        lease_claimed_at = null,
        lease_expires_at = null,
        result_file_version_id = ${ready ? input.claim.fileVersionId : null},
        result_object_version_id = ${ready ? input.claim.objectVersionId : null},
        result_file_revision = ${input.resultingFileRevision}::bigint,
        result_content_revision = ${input.contentFence.resultingContentRevision}::bigint,
        terminal_reason_id = ${input.safeReasonId},
        revision = revision + 1,
        updated_at = ${input.databaseNow}::timestamptz
    where tenant_id = ${input.claim.tenantId}
      and id = ${input.claim.jobId}
      and state in ('claimed', 'transferring', 'verifying')
      and revision = ${input.claim.expectedJobRevision}::bigint
      and lease_token_hash = ${calculateMaterializationLeaseHash(input.claim)}
      and lease_expires_at > clock_timestamp()
    returning id
  `;
}

function buildAdoptReadyStorageOrphanSql(
  input: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    storage: ReturnType<typeof normalizeReadyFinalization>["storage"];
    orphan: StorageOrphanAdoptionCandidateRow;
    terminalEvidenceDigestSha256: string;
    databaseNow: string;
  }>
): SQL {
  return sql`
    update inbox_v2_file_storage_orphans
    set state = 'adopted',
        claim_token_hash = null,
        claim_expires_at = null,
        adopted_object_version_id = ${input.claim.objectVersionId},
        terminal_evidence_digest_sha256 = ${input.terminalEvidenceDigestSha256},
        safe_reason_id = null,
        revision = revision + 1,
        updated_at = ${input.databaseNow}::timestamptz
    where tenant_id = ${input.claim.tenantId}
      and id = ${requiredString(input.orphan.id, "storage orphan id")}
      and revision = ${requiredCounter(
        input.orphan.revision,
        "storage orphan revision"
      )}::bigint
      and state = 'open'
      and materialization_job_id = ${input.claim.jobId}
      and storage_root_id = ${input.claim.storageRootId}
      and storage_object_key = ${input.storage.storageKey}
      and storage_version_identity = ${input.storage.storageVersionId}
      and checksum_sha256 = ${input.storage.rawChecksumSha256}
      and size_bytes = ${input.storage.sizeBytes}::bigint
      and detected_media_type = ${input.storage.mediaType}
      and claim_token_hash is null
      and claim_expires_at is null
      and adopted_object_version_id is null
      and terminal_evidence_digest_sha256 is null
      and safe_reason_id is null
      and quarantine_reason_code is null
      and quarantine_evidence_digest_sha256 is null
      and quarantine_physical_kind is null
    returning id
  `;
}

async function recordStorageOrphanInTransaction(
  transaction: RawSqlExecutor,
  input: RecordInboxV2StorageOrphanInput
): Promise<"adopted" | "recorded" | "already_recorded"> {
  const normalized = normalizeStorageOrphan(input);
  const adoption = await transaction.execute<StorageOrphanAdoptionRow>(sql`
    select
      (
        job.file_id = ${normalized.claim.fileId}
        and job.expected_file_revision = ${normalized.claim.expectedFileRevision}::bigint
        and job.reserved_file_version_id = ${normalized.claim.fileVersionId}
        and job.reserved_object_version_id = ${normalized.claim.objectVersionId}
        and job.reserved_storage_root_id = ${normalized.claim.storageRootId}
        and job.reserved_storage_object_key = ${normalized.claim.storageKey}
      ) as claim_matches,
      (
        ${normalized.normalizedQuarantine === null}
        and job.state = 'ready'
        and job.file_id = ${normalized.claim.fileId}
        and job.reserved_file_version_id = ${normalized.claim.fileVersionId}
        and job.reserved_object_version_id = ${normalized.claim.objectVersionId}
        and job.reserved_storage_root_id = ${normalized.claim.storageRootId}
        and job.reserved_storage_object_key = ${normalized.claim.storageKey}
        and job.result_file_version_id = ${normalized.claim.fileVersionId}
        and job.result_object_version_id = ${normalized.claim.objectVersionId}
        and exists (
          select 1
          from inbox_v2_file_object_versions object_version
          join inbox_v2_file_versions file_version
            on file_version.tenant_id = object_version.tenant_id
           and file_version.id = ${normalized.claim.fileVersionId}
           and file_version.file_id = ${normalized.claim.fileId}
           and file_version.object_version_id = object_version.id
          where object_version.tenant_id = job.tenant_id
            and object_version.id = ${normalized.claim.objectVersionId}
            and object_version.storage_root_id = ${normalized.storageRootId}
            and object_version.storage_object_key = ${normalized.identity.storageKey}
            and object_version.storage_version_identity = ${normalized.identity.versionId}
            and object_version.checksum_sha256 = ${normalized.rawChecksumSha256}
            and object_version.size_bytes = ${normalized.sizeBytes}::bigint
            and object_version.detected_media_type = ${normalized.mediaType}
        )
      ) as exact_canonical_adoption
    from inbox_v2_file_attachment_materialization_jobs job
    where job.tenant_id = ${normalized.claim.tenantId}
      and job.id = ${normalized.claim.jobId}
    for share of job
  `);
  assertAtMostOneRow(adoption.rows, "Storage orphan adoption lookup");
  const adoptionRow = adoption.rows[0];
  if (adoptionRow === undefined || adoptionRow.claim_matches !== true) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.storage_orphan_job_claim_conflict",
      "The storage orphan is not owned by the exact materialization reservation."
    );
  }
  if (
    normalized.normalizedQuarantine === null &&
    adoptionRow.exact_canonical_adoption === true
  ) {
    return "adopted";
  }

  const result = await transaction.execute<StorageOrphanRow>(sql`
    with inserted as (
      insert into inbox_v2_file_storage_orphans (
        tenant_id, id, materialization_job_id, storage_root_id,
        storage_object_key, storage_version_identity, checksum_sha256,
        size_bytes, detected_media_type, state, claim_token_hash,
        claim_expires_at, adopted_object_version_id,
        terminal_evidence_digest_sha256, safe_reason_id,
        quarantine_reason_code, quarantine_evidence_digest_sha256,
        quarantine_physical_kind, revision,
        first_observed_at, updated_at
      ) values (
        ${normalized.claim.tenantId}, ${normalized.orphanId},
        ${normalized.claim.jobId}, ${normalized.storageRootId},
        ${normalized.identity.storageKey}, ${normalized.identity.versionId},
        ${normalized.rawChecksumSha256}, ${normalized.sizeBytes}::bigint,
        ${normalized.mediaType},
        ${normalized.normalizedQuarantine === null ? "open" : "quarantined"},
        null, null, null, null, null,
        ${normalized.normalizedQuarantine?.reasonCode ?? null},
        ${normalized.normalizedQuarantine?.evidenceDigestSha256 ?? null},
        ${normalized.normalizedQuarantine?.physicalKind ?? null}, 1,
        clock_timestamp(), clock_timestamp()
      )
      on conflict do nothing
      returning
        id, materialization_job_id, storage_root_id, storage_object_key,
        storage_version_identity, checksum_sha256, size_bytes,
        detected_media_type, state, quarantine_reason_code,
        quarantine_evidence_digest_sha256, quarantine_physical_kind,
        true as inserted
    ),
    existing as (
      select
        orphan.id, orphan.materialization_job_id, orphan.storage_root_id,
        orphan.storage_object_key, orphan.storage_version_identity,
        orphan.checksum_sha256, orphan.size_bytes, orphan.detected_media_type,
        orphan.state, orphan.quarantine_reason_code,
        orphan.quarantine_evidence_digest_sha256,
        orphan.quarantine_physical_kind,
        false as inserted
      from inbox_v2_file_storage_orphans orphan
      where orphan.tenant_id = ${normalized.claim.tenantId}
        and orphan.storage_root_id = ${normalized.storageRootId}
        and orphan.storage_object_key = ${normalized.identity.storageKey}
        and orphan.storage_version_identity = ${normalized.identity.versionId}
        and not exists (select 1 from inserted)
      for share of orphan
    )
    select * from inserted
    union all
    select * from existing
  `);
  assertAtMostOneRow(result.rows, "Storage orphan persistence");
  const row = result.rows[0];
  if (row === undefined || !isExactStorageOrphanReplay(row, normalized)) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.storage_orphan_identity_conflict",
      "The exact storage version is already registered with different immutable evidence."
    );
  }
  return row.inserted === true ? "recorded" : "already_recorded";
}

export function calculateInboxV2FileParentIdentityDigest(
  input: AttachInboxV2FileParentInput
): string {
  const parent = input.parent;
  return deriveRawSha256(
    "core:inbox-v2.file-parent-identity@v1",
    input.tenantId,
    input.fileId,
    input.fileVersionId,
    input.objectVersionId,
    parent.kind,
    parent.purpose,
    parent.entityId,
    parent.entityRevision,
    parent.conversationId ?? "",
    parent.timelineItemId ?? "",
    parent.contentId ?? "",
    parent.contentRevision ?? "",
    parent.blockKey ?? ""
  );
}

export async function attachFileParentInTransaction(
  transaction: RawSqlExecutor,
  rawInput: AttachInboxV2FileParentInput
): Promise<AttachInboxV2FileParentResult> {
  const input = normalizeAttachFileParentInput(rawInput);
  const parentIdentityDigestSha256 =
    calculateInboxV2FileParentIdentityDigest(input);
  const linkId = deriveBrandedId(
    "file_parent_link",
    input.tenantId,
    input.fileId,
    parentIdentityDigestSha256
  );
  const headResult = await transaction.execute<FileParentSetLockRow>(
    buildLockInboxV2FileParentSetSql(input)
  );
  assertAtMostOneRow(headResult.rows, "File parent-set attach lock");
  const head = headResult.rows[0];
  if (head === undefined) {
    return { kind: "conflict", code: "file_parent_set_missing" };
  }
  const existingResult =
    await transaction.execute<ExistingFileParentLinkRow>(sql`
      select
        link.id, link.file_version_id, link.object_version_id,
        link.parent_identity_digest_sha256, link.parent_kind,
        link.parent_purpose, link.visibility_boundary,
        link.parent_conversation_visibility, link.parent_entity_id,
        link.parent_entity_revision, link.conversation_id,
        link.timeline_item_id, link.content_id, link.content_revision,
        link.block_key, link.data_class_id, link.processing_purpose_id,
        link.retention_anchor_at, link_head.state as head_state,
        link_head.revision as head_revision,
        link_head.detached_by_event_id
      from inbox_v2_file_parent_links link
      join inbox_v2_file_parent_link_heads link_head
        on link_head.tenant_id = link.tenant_id
       and link_head.link_id = link.id
       and link_head.file_id = link.file_id
      where link.tenant_id = ${input.tenantId}
        and link.file_id = ${input.fileId}
        and link.parent_identity_digest_sha256 = ${parentIdentityDigestSha256}
      for share of link, link_head
    `);
  assertAtMostOneRow(existingResult.rows, "File parent-link replay lookup");
  const existing = existingResult.rows[0];
  if (existing !== undefined) {
    if (
      isExactFileParentLinkReplay(
        existing,
        input,
        linkId,
        parentIdentityDigestSha256
      ) &&
      existing.head_state === "live"
    ) {
      if (
        head.completeness !== "complete" ||
        String(head.completeness_revision) !== String(head.revision)
      ) {
        return { kind: "conflict", code: "file_parent_set_incomplete" };
      }
      if (
        requiredNumber(head.live_parent_count, "live parent count") !==
        requiredNumber(
          head.actual_live_parent_count,
          "actual live parent count"
        )
      ) {
        return { kind: "conflict", code: "file_parent_count_conflict" };
      }
      return {
        kind: "already_attached",
        linkId,
        parentSetRevision: requiredCounter(
          head.revision,
          "parent-set revision"
        ),
        liveParentCount: requiredNumber(
          head.live_parent_count,
          "live parent count"
        )
      };
    }
    return { kind: "conflict", code: "file_parent_link_conflict" };
  }
  const headConflict = classifyFileParentSetHead(head, input);
  if (headConflict !== null) return { kind: "conflict", code: headConflict };
  if (head.exact_version_ready !== true) {
    return { kind: "conflict", code: "file_version_fence_conflict" };
  }
  const databaseNow = requiredTimestamp(head.database_now, "database clock");
  await expectOneRow(
    transaction,
    buildInsertFileParentLinkSql({
      input,
      linkId,
      parentIdentityDigestSha256,
      databaseNow
    }),
    "File parent-link attach insert"
  );
  await expectOneRow(
    transaction,
    sql`
      insert into inbox_v2_file_parent_link_heads (
        tenant_id, link_id, file_id, state, detached_by_event_id,
        revision, updated_at
      ) values (
        ${input.tenantId}, ${linkId}, ${input.fileId}, 'live', null, 1,
        ${databaseNow}::timestamptz
      )
      returning link_id as id
    `,
    "File parent-link attach head insert"
  );
  const nextRevision = incrementCounter(input.expectedParentSetRevision);
  const nextCount =
    requiredNumber(head.live_parent_count, "live parent count") + 1;
  await expectOneRow(
    transaction,
    sql`
      update inbox_v2_file_parent_set_heads
      set revision = ${nextRevision}::bigint,
          completeness_revision = ${nextRevision}::bigint,
          live_parent_count = ${nextCount},
          updated_at = ${databaseNow}::timestamptz
      where tenant_id = ${input.tenantId}
        and file_id = ${input.fileId}
        and revision = ${input.expectedParentSetRevision}::bigint
        and completeness = 'complete'
        and completeness_revision = revision
        and live_parent_count = ${head.live_parent_count}::integer
      returning file_id as id
    `,
    "File parent-set attach CAS"
  );
  return {
    kind: "attached",
    linkId,
    parentSetRevision: nextRevision,
    liveParentCount: nextCount
  };
}

export function buildLockInboxV2FileParentSetSql(
  input: AttachInboxV2FileParentInput
): SQL {
  return sql`
    select
      parent_head.revision,
      parent_head.completeness,
      parent_head.completeness_revision,
      parent_head.live_parent_count,
      (
        select count(*)::integer
        from inbox_v2_file_parent_link_heads live_head
        where live_head.tenant_id = parent_head.tenant_id
          and live_head.file_id = parent_head.file_id
          and live_head.state = 'live'
      ) as actual_live_parent_count,
      exists (
        select 1
        from inbox_v2_file_versions file_version
        join inbox_v2_file_objects file
          on file.tenant_id = file_version.tenant_id
         and file.id = file_version.file_id
        join inbox_v2_file_object_version_heads object_head
          on object_head.tenant_id = file_version.tenant_id
         and object_head.object_version_id = file_version.object_version_id
        where file_version.tenant_id = parent_head.tenant_id
          and file_version.id = ${input.fileVersionId}
          and file_version.file_id = parent_head.file_id
          and file_version.object_version_id = ${input.objectVersionId}
          and file.state = 'ready'
          and file.current_file_version_id = file_version.id
          and file.current_object_version_id = file_version.object_version_id
          and object_head.state = 'ready'
      ) as exact_version_ready,
      clock.database_now
    from inbox_v2_file_parent_set_heads parent_head
    cross join (select clock_timestamp() as database_now) clock
    where parent_head.tenant_id = ${input.tenantId}
      and parent_head.file_id = ${input.fileId}
    for update of parent_head
  `;
}

function buildInsertFileParentLinkSql(
  input: Readonly<{
    input: AttachInboxV2FileParentInput;
    linkId: string;
    parentIdentityDigestSha256: string;
    databaseNow: string;
  }>
): SQL {
  const parent = input.input.parent;
  return sql`
    insert into inbox_v2_file_parent_links (
      tenant_id, id, file_id, file_version_id, object_version_id,
      parent_identity_digest_sha256, parent_kind, parent_purpose,
      visibility_boundary, parent_conversation_visibility,
      parent_entity_id, parent_entity_revision, conversation_id,
      timeline_item_id, content_id, content_revision, block_key,
      data_class_id, processing_purpose_id, retention_anchor_at,
      created_at, revision
    ) values (
      ${input.input.tenantId}, ${input.linkId}, ${input.input.fileId},
      ${input.input.fileVersionId}, ${input.input.objectVersionId},
      ${input.parentIdentityDigestSha256}, ${parent.kind}, ${parent.purpose},
      ${parent.visibilityBoundary}, ${parent.parentConversationVisibility},
      ${parent.entityId}, ${parent.entityRevision}::bigint,
      ${parent.conversationId}, ${parent.timelineItemId}, ${parent.contentId},
      ${parent.contentRevision}::bigint, ${parent.blockKey},
      ${input.input.dataClassId}, ${input.input.processingPurposeId},
      ${input.input.retentionAnchorAt}::timestamptz,
      ${input.databaseNow}::timestamptz, 1
    )
    returning id
  `;
}

export async function detachFileParentInTransaction(
  transaction: RawSqlExecutor,
  rawInput: DetachInboxV2FileParentInput
): Promise<DetachInboxV2FileParentResult> {
  const input = normalizeDetachFileParentInput(rawInput);
  const result = await transaction.execute<DetachFileParentLockRow>(
    buildLockInboxV2FileParentDetachSql(input)
  );
  assertAtMostOneRow(result.rows, "File parent detach lock");
  const row = result.rows[0];
  if (row === undefined) {
    return { kind: "conflict", code: "file_parent_link_missing" };
  }
  const objectVersionId = requiredString(
    row.object_version_id,
    "parent object version id"
  );
  if (row.link_state === "detached") {
    if (row.detached_by_event_id !== input.detachedByEventId) {
      return { kind: "conflict", code: "file_parent_link_conflict" };
    }
    if (
      row.completeness !== "complete" ||
      String(row.completeness_revision) !== String(row.parent_set_revision)
    ) {
      return { kind: "conflict", code: "file_parent_set_incomplete" };
    }
    const count = requiredNumber(row.live_parent_count, "live parent count");
    if (
      requiredNumber(
        row.actual_live_parent_count,
        "actual live parent count"
      ) !== count
    ) {
      return { kind: "conflict", code: "file_parent_count_conflict" };
    }
    return {
      kind: "already_detached",
      linkId: input.linkId,
      objectVersionId,
      parentSetRevision: requiredCounter(
        row.parent_set_revision,
        "parent-set revision"
      ),
      liveParentCount: count,
      deletionCandidate: count === 0
    };
  }
  if (
    row.completeness !== "complete" ||
    String(row.completeness_revision) !== String(row.parent_set_revision)
  ) {
    return { kind: "conflict", code: "file_parent_set_incomplete" };
  }
  if (String(row.parent_set_revision) !== input.expectedParentSetRevision) {
    return {
      kind: "conflict",
      code: "file_parent_set_revision_conflict"
    };
  }
  if (String(row.link_revision) !== input.expectedLinkRevision) {
    return {
      kind: "conflict",
      code: "file_parent_link_revision_conflict"
    };
  }
  const liveCount = requiredNumber(row.live_parent_count, "live parent count");
  if (
    liveCount < 1 ||
    requiredNumber(row.actual_live_parent_count, "actual live parent count") !==
      liveCount
  ) {
    return { kind: "conflict", code: "file_parent_count_conflict" };
  }
  const event = await transaction.execute<IdRow>(sql`
    select id
    from inbox_v2_domain_events
    where tenant_id = ${input.tenantId}
      and id = ${input.detachedByEventId}
    for share
  `);
  if (event.rows.length !== 1) {
    return { kind: "conflict", code: "detach_event_missing" };
  }
  const databaseNow = requiredTimestamp(row.database_now, "database clock");
  const nextLinkRevision = incrementCounter(input.expectedLinkRevision);
  await expectOneRow(
    transaction,
    sql`
      update inbox_v2_file_parent_link_heads
      set state = 'detached',
          detached_by_event_id = ${input.detachedByEventId},
          revision = ${nextLinkRevision}::bigint,
          updated_at = ${databaseNow}::timestamptz
      where tenant_id = ${input.tenantId}
        and link_id = ${input.linkId}
        and file_id = ${input.fileId}
        and state = 'live'
        and revision = ${input.expectedLinkRevision}::bigint
      returning link_id as id
    `,
    "File parent-link detach CAS"
  );
  const nextSetRevision = incrementCounter(input.expectedParentSetRevision);
  const nextCount = liveCount - 1;
  await expectOneRow(
    transaction,
    sql`
      update inbox_v2_file_parent_set_heads
      set revision = ${nextSetRevision}::bigint,
          completeness_revision = ${nextSetRevision}::bigint,
          live_parent_count = ${nextCount},
          updated_at = ${databaseNow}::timestamptz
      where tenant_id = ${input.tenantId}
        and file_id = ${input.fileId}
        and revision = ${input.expectedParentSetRevision}::bigint
        and completeness = 'complete'
        and completeness_revision = revision
        and live_parent_count = ${liveCount}
      returning file_id as id
    `,
    "File parent-set detach CAS"
  );
  return {
    kind: "detached",
    linkId: input.linkId,
    objectVersionId,
    parentSetRevision: nextSetRevision,
    liveParentCount: nextCount,
    deletionCandidate: nextCount === 0
  };
}

export function buildLockInboxV2FileParentDetachSql(
  input: DetachInboxV2FileParentInput
): SQL {
  return sql`
    select
      link.id as link_id,
      link.object_version_id,
      link_head.state as link_state,
      link_head.revision as link_revision,
      link_head.detached_by_event_id,
      parent_head.revision as parent_set_revision,
      parent_head.completeness,
      parent_head.completeness_revision,
      parent_head.live_parent_count,
      (
        select count(*)::integer
        from inbox_v2_file_parent_link_heads live_head
        where live_head.tenant_id = parent_head.tenant_id
          and live_head.file_id = parent_head.file_id
          and live_head.state = 'live'
      ) as actual_live_parent_count,
      clock.database_now
    from inbox_v2_file_parent_set_heads parent_head
    join inbox_v2_file_parent_links link
      on link.tenant_id = parent_head.tenant_id
     and link.file_id = parent_head.file_id
     and link.id = ${input.linkId}
    join inbox_v2_file_parent_link_heads link_head
      on link_head.tenant_id = link.tenant_id
     and link_head.link_id = link.id
     and link_head.file_id = link.file_id
    cross join (select clock_timestamp() as database_now) clock
    where parent_head.tenant_id = ${input.tenantId}
      and parent_head.file_id = ${input.fileId}
    for update of parent_head, link_head
  `;
}

export async function authorizeObjectDeletionInTransaction(
  transaction: RawSqlExecutor,
  rawInput: AuthorizeInboxV2ObjectDeletionInput,
  loadPurposeAndHoldAuthority: InboxV2FilePurposeAndHoldAuthorityLoader
): Promise<AuthorizeInboxV2ObjectDeletionResult> {
  const input = normalizeObjectDeletionInput(rawInput);
  const headResult = await transaction.execute<ObjectDeletionHeadRow>(sql`
    select
      object_head.object_version_id,
      object_head.state,
      object_head.revision,
      (
        select count(*)::integer
        from inbox_v2_file_versions file_version
        where file_version.tenant_id = object_head.tenant_id
          and file_version.object_version_id = object_head.object_version_id
      ) as file_version_count,
      clock.database_now
    from inbox_v2_file_object_version_heads object_head
    cross join (select clock_timestamp() as database_now) clock
    where object_head.tenant_id = ${input.tenantId}
      and object_head.object_version_id = ${input.objectVersionId}
    for update of object_head
  `);
  assertAtMostOneRow(headResult.rows, "Object deletion head lock");
  const head = headResult.rows[0];
  if (head === undefined) {
    return { kind: "denied", code: "object_version_not_found" };
  }
  if (String(head.revision) !== input.expectedObjectHeadRevision) {
    return { kind: "denied", code: "object_head_revision_conflict" };
  }
  if (
    !new Set(["ready", "quarantined", "unavailable", "delete_failed"]).has(
      requiredString(head.state, "object head state")
    )
  ) {
    return { kind: "denied", code: "object_state_conflict" };
  }
  const parentResult = await transaction.execute<ObjectDeletionParentRow>(sql`
    select
      file_version.file_id,
      parent_head.revision,
      parent_head.completeness,
      parent_head.completeness_revision,
      parent_head.live_parent_count,
      (
        select count(*)::integer
        from inbox_v2_file_parent_link_heads live_head
        where live_head.tenant_id = parent_head.tenant_id
          and live_head.file_id = parent_head.file_id
          and live_head.state = 'live'
      ) as actual_live_parent_count
    from inbox_v2_file_versions file_version
    join inbox_v2_file_parent_set_heads parent_head
      on parent_head.tenant_id = file_version.tenant_id
     and parent_head.file_id = file_version.file_id
    where file_version.tenant_id = ${input.tenantId}
      and file_version.object_version_id = ${input.objectVersionId}
    order by file_version.file_id
    for share of parent_head
  `);
  const expectedParentRows = requiredNumber(
    head.file_version_count,
    "object file-version count"
  );
  if (
    expectedParentRows === 0 ||
    parentResult.rows.length !== expectedParentRows ||
    parentResult.rows.some(
      (parent) =>
        parent.completeness !== "complete" ||
        String(parent.completeness_revision) !== String(parent.revision) ||
        requiredNumber(parent.live_parent_count, "live parent count") !==
          requiredNumber(
            parent.actual_live_parent_count,
            "actual live parent count"
          )
    )
  ) {
    return { kind: "denied", code: "parent_set_incomplete" };
  }
  if (
    parentResult.rows.some(
      (parent) =>
        requiredNumber(parent.live_parent_count, "live parent count") !== 0
    )
  ) {
    return { kind: "denied", code: "live_parent_exists" };
  }
  const authority = await loadPurposeAndHoldAuthority(transaction, {
    tenantId: input.tenantId,
    objectVersionId: input.objectVersionId
  });
  const activePurposeCount = normalizeZeroCapableCounter(
    authority.activePurposeCount,
    "active purpose count"
  );
  const activeHoldCount = normalizeZeroCapableCounter(
    authority.activeHoldCount,
    "active hold count"
  );
  const authorityDigestSha256 = normalizeSha256(
    authority.authorityDigestSha256
  );
  if (activePurposeCount !== "0") {
    return { kind: "denied", code: "active_purpose_exists" };
  }
  if (activeHoldCount !== "0") {
    return { kind: "denied", code: "active_hold_exists" };
  }
  const evaluatedAt = requiredTimestamp(head.database_now, "database clock");
  const decisionDigestSha256 = deriveRawSha256(
    "core:inbox-v2.object-deletion-authority@v1",
    input.tenantId,
    input.objectVersionId,
    input.expectedObjectHeadRevision,
    "0",
    activePurposeCount,
    activeHoldCount,
    authorityDigestSha256,
    evaluatedAt
  );
  return {
    kind: "authorized",
    expectedObjectHeadRevision: input.expectedObjectHeadRevision,
    liveParentCount: "0",
    activePurposeCount: "0",
    activeHoldCount: "0",
    evaluatedAt,
    decisionDigestSha256
  };
}

function normalizeMaterializationReservation(
  context: InboxV2AuthorizedCommandMutationContext,
  input: ReserveInboxV2AttachmentMaterializationInput
): NormalizedMaterializationReservation {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertMaterializationContextTenant(context.tenantId, tenantId);
  if (
    context.commandTypeId !==
    INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID
  ) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_reservation_command_type_invalid",
      "Attachment reservation requires the exact authorized reservation command type."
    );
  }
  assertBrandedId(input.jobId, "attachment_materialization_job");
  assertBrandedId(input.attachmentId, "message_attachment");
  assertBrandedId(input.file.id, "file");
  assertBrandedId(input.content.conversationId, "conversation");
  assertBrandedId(input.content.timelineItemId, "timeline_item");
  assertBrandedId(input.content.parentMessageId, "message");
  assertPositiveCounter(
    input.content.expectedParentRevision,
    "parent Message revision"
  );
  assertBrandedId(input.content.id, "timeline_content");
  assertBrandedId(input.reservation.fileVersionId, "file_version");
  assertBrandedId(input.reservation.objectVersionId, "file_object_version");
  if (input.file.expectedRevision !== "1") {
    throw new TypeError(
      "A materialization reservation starts at file revision one."
    );
  }
  assertPositiveCounter(input.content.expectedRevision, "content revision");
  assertPositiveCounter(
    input.expectedAttachmentRevision,
    "attachment revision"
  );
  assertCatalogId(input.file.dataClassId, "file data class");
  assertCatalogId(input.file.processingPurposeId, "file processing purpose");
  assertCatalogId(input.reservation.storageRootId, "storage root");
  assertTimestamp(input.file.retentionAnchorAt, "retention anchor");
  assertBlockKey(input.content.blockKey);
  assertRawSha256(input.content.mutationFenceSha256, "content mutation fence");
  const expectedMutationFence =
    calculateInboxV2AttachmentContentMutationFenceSha256({
      tenantId,
      attachmentId: input.attachmentId,
      expectedAttachmentRevision: input.expectedAttachmentRevision,
      timelineContentId: input.content.id,
      expectedContentRevision: input.content.expectedRevision,
      contentBlockKey: input.content.blockKey
    });
  if (input.content.mutationFenceSha256 !== expectedMutationFence) {
    throw new TypeError(
      "Content mutation fence does not match the reserved attachment/content CAS."
    );
  }
  if (
    !ATTACHMENT_SOURCE_LOCATOR_HANDLE_PATTERN.test(
      input.sourceLocator.reference
    )
  ) {
    throw new TypeError(
      "Attachment source locator must be a server-owned opaque src_ref handle."
    );
  }
  if (input.sourceLocator.kind === "provider") {
    if (input.sourceOccurrenceId === null) {
      throw new TypeError(
        "Provider attachment reservation requires its exact SourceOccurrence."
      );
    }
    assertBrandedId(input.sourceOccurrenceId, "source_occurrence");
  } else if (input.sourceOccurrenceId !== null) {
    throw new TypeError(
      "Only provider attachment reservations may reference a SourceOccurrence."
    );
  }
  assertBoundedOpaque(input.reservation.storageKey, 2_048, "storage key");
  assertBrandedId(input.causeEventId, "event");
  assertBoundedOpaque(input.causeMutationId, 256, "cause mutation id");
  assertBoundedOpaque(input.causeStreamCommitId, 256, "cause stream commit id");
  assertPositiveCounter(input.causeStreamPosition, "cause stream position");
  assertCorrelationId(input.correlationId);
  assertTimestamp(input.causedAt, "materialization cause timestamp");
  assertToken(input.idempotencyToken, "idempotency token");
  const reservationNamespaceGeneration = inboxV2RoutingTokenSchema.parse(
    input.reservationNamespaceGeneration
  );
  const reservationAuthority = normalizeMaterializationReservationAuthority(
    context,
    input.content.conversationId,
    input.content.visibilityBoundary
  );
  return {
    ...input,
    tenantId,
    reservationNamespaceGeneration,
    causedAt: normalizeTimestamp(input.causedAt),
    reservationAuthority: {
      commandId: context.commandId,
      commandTypeId: context.commandTypeId,
      clientMutationId: context.clientMutationId,
      mutationId: context.mutationId,
      decisionId: context.authorizationDecisionId,
      epoch: context.authorizationEpoch,
      actor: context.actor,
      authorizedAt: normalizeTimestamp(context.authorizedAt),
      ...reservationAuthority
    },
    sourceLocatorDigestSha256: deriveRawSha256(
      "core:inbox-v2.attachment-source-locator@v1",
      tenantId,
      input.sourceLocator.kind,
      input.sourceLocator.reference
    )
  };
}

function normalizeMaterializationReservationAuthority(
  context:
    | InboxV2AuthorizedCommandMutationContext
    | InboxV2AuthorizedAtomicMaterializationContext,
  conversationId: string,
  visibilityBoundary: "external_work" | "internal"
): Readonly<{
  decisionSetDigestSha256: string;
  resourceFenceSetDigestSha256: string;
  tenantRbacRevision: string;
  sharedAccessRevision: string;
  resourceHeadId: string;
  resourceAccessRevision: string;
  structuralRelationRevision: string;
  collaboratorSetRevision: string;
  auditGrantSourceIds: readonly string[];
  auditPolicyVersion: string | null;
}> {
  const requiredReadPermissionId =
    visibilityBoundary === "external_work"
      ? "core:conversation.read"
      : "core:conversation.internal.read";
  const requiredPermissionIds = [
    "core:file.upload",
    requiredReadPermissionId
  ].sort(comparePostgresText);
  const actor = context.actor;
  const decisions = [...context.authorizationDecisionRefs].sort((left, right) =>
    comparePostgresText(left.id, right.id)
  );
  const matchingDecisions = decisions.filter(
    (decision) =>
      actor.kind === "trusted_service" &&
      decision.tenantId === context.tenantId &&
      decision.authorizationEpoch === context.authorizationEpoch &&
      decision.outcome === "allowed" &&
      requiredPermissionIds.includes(decision.permissionId) &&
      decision.resourceScopeId === "core:conversation" &&
      decision.resource.tenantId === context.tenantId &&
      decision.resource.entityTypeId === "core:conversation" &&
      String(decision.resource.entityId) === conversationId &&
      decision.principal.kind === "trusted_service" &&
      decision.principal.trustedServiceId === actor.trustedServiceId
  );
  const primaryDecision = decisions.find(
    ({ id }) => id === context.authorizationDecisionId
  );
  const fences = [...context.authorizationResourceRevisionFences].sort(
    (left, right) =>
      comparePostgresText(
        `${left.resourceKind}\u0000${left.resourceId}`,
        `${right.resourceKind}\u0000${right.resourceId}`
      )
  );
  const conversationFence = fences[0];
  const decisionAccessRevisions = new Set(
    matchingDecisions.map(({ resourceAccessRevision }) =>
      String(resourceAccessRevision)
    )
  );
  const auditGrantSourceIds = [
    ...context.authorizationAuditGrantSourceIds
  ].sort(comparePostgresText);
  const auditPolicyVersion = context.authorizationAuditPolicyVersion;
  if (
    actor.kind !== "trusted_service" ||
    context.profile !== "domain" ||
    decisions.length !== requiredPermissionIds.length ||
    matchingDecisions.length !== requiredPermissionIds.length ||
    new Set(matchingDecisions.map(({ permissionId }) => permissionId)).size !==
      requiredPermissionIds.length ||
    primaryDecision === undefined ||
    primaryDecision.permissionId !== "core:file.upload" ||
    fences.length !== 1 ||
    conversationFence?.resourceKind !== "conversation" ||
    conversationFence.resourceId !== conversationId ||
    typeof conversationFence.resourceHeadId !== "string" ||
    conversationFence.resourceHeadId.length === 0 ||
    conversationFence.advance !== "none" ||
    conversationFence.advanceStructuralRelation !== "none" ||
    conversationFence.advanceCollaboratorSet !== "none" ||
    conversationFence.expectedStructuralRelationRevision === undefined ||
    conversationFence.expectedCollaboratorSetRevision === undefined ||
    decisionAccessRevisions.size !== 1 ||
    String(conversationFence.expectedResourceAccessRevision) !==
      [...decisionAccessRevisions][0] ||
    !/^[1-9][0-9]*$/u.test(context.authorizationTenantRbacRevision) ||
    !/^[1-9][0-9]*$/u.test(context.authorizationSharedAccessRevision) ||
    auditGrantSourceIds.length < 1 ||
    auditGrantSourceIds.length > 64 ||
    new Set(auditGrantSourceIds).size !== auditGrantSourceIds.length ||
    auditGrantSourceIds.some(
      (value, index) =>
        !/^internal-ref:[a-f0-9]{32,64}$/u.test(value) ||
        value !== context.authorizationAuditGrantSourceIds[index]
    ) ||
    (auditPolicyVersion !== null &&
      (auditPolicyVersion.length < 1 || auditPolicyVersion.length > 256))
  ) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_reservation_authority_invalid",
      "Attachment reservation requires the exact file-upload and Conversation-visibility decision set and revision fence."
    );
  }
  return {
    decisionSetDigestSha256: deriveRawSha256(
      "core:inbox-v2.attachment-materialization-decision-set@v1",
      canonicalizeInboxV2Json(decisions)
    ),
    resourceFenceSetDigestSha256: deriveRawSha256(
      "core:inbox-v2.attachment-materialization-resource-fence-set@v1",
      canonicalizeInboxV2Json(fences)
    ),
    tenantRbacRevision: context.authorizationTenantRbacRevision,
    sharedAccessRevision: context.authorizationSharedAccessRevision,
    resourceHeadId: conversationFence.resourceHeadId,
    resourceAccessRevision: conversationFence.expectedResourceAccessRevision,
    structuralRelationRevision:
      conversationFence.expectedStructuralRelationRevision,
    collaboratorSetRevision: conversationFence.expectedCollaboratorSetRevision,
    auditGrantSourceIds,
    auditPolicyVersion
  };
}

function comparePostgresText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function normalizeClaimMaterializationJobsInput(
  input: ClaimInboxV2AttachmentMaterializationJobsInput
) {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertCatalogId(input.workerId, "materialization worker");
  const batchSize = input.batchSize ?? 16;
  const leaseDurationSeconds = input.leaseDurationSeconds ?? 120;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MATERIALIZATION_CLAIM_LIMIT_MAX
  ) {
    throw new TypeError(
      `Materialization claim batch size must be between 1 and ${MATERIALIZATION_CLAIM_LIMIT_MAX}.`
    );
  }
  if (
    !Number.isInteger(leaseDurationSeconds) ||
    leaseDurationSeconds < MATERIALIZATION_LEASE_SECONDS_MIN ||
    leaseDurationSeconds > MATERIALIZATION_LEASE_SECONDS_MAX
  ) {
    throw new TypeError(
      `Materialization lease must be between ${MATERIALIZATION_LEASE_SECONDS_MIN} and ${MATERIALIZATION_LEASE_SECONDS_MAX} seconds.`
    );
  }
  return {
    tenantId,
    workerId: input.workerId,
    batchSize,
    leaseDurationSeconds
  };
}

function normalizePendingMaterializationAuthorizationRefreshCandidatesInput(
  input: ListInboxV2PendingMaterializationAuthorizationRefreshCandidatesInput
) {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const limit = input.limit ?? 16;
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MATERIALIZATION_AUTHORIZATION_REFRESH_LIMIT_MAX
  ) {
    throw new TypeError(
      `Materialization authorization refresh limit must be between 1 and ${MATERIALIZATION_AUTHORIZATION_REFRESH_LIMIT_MAX}.`
    );
  }
  return { tenantId, limit };
}

function normalizePendingMaterializationReauthorizationInput(
  input: ReauthorizeInboxV2PendingMaterializationInput
): ReauthorizeInboxV2PendingMaterializationInput {
  assertPositiveCounter(
    input.expectedJobRevision,
    "expected materialization job revision"
  );
  return {
    jobId: assertBrandedId(input.jobId, "attachment_materialization_job"),
    expectedJobRevision: input.expectedJobRevision
  };
}

function requiredVisibilityBoundary(
  value: unknown
): "external_work" | "internal" {
  if (value === "external_work" || value === "internal") return value;
  throw new InboxV2FileObjectPersistenceError(
    "inbox_v2.file_object_row_invalid",
    "Expected a materialization visibility boundary."
  );
}

function isCurrentMaterializationAuthorization(
  row: PendingMaterializationReauthorizationRow,
  context: InboxV2AuthorizedCommandMutationContext,
  authority: ReturnType<typeof normalizeMaterializationReservationAuthority>
): boolean {
  return (
    row.authorization_actor_kind === context.actor.kind &&
    row.authorization_actor_id ===
      materializationAuthorityActorId(context.actor) &&
    row.authorization_decision_set_digest_sha256 ===
      authority.decisionSetDigestSha256 &&
    row.authorization_resource_fence_set_digest_sha256 ===
      authority.resourceFenceSetDigestSha256 &&
    String(row.authorization_tenant_rbac_revision) ===
      authority.tenantRbacRevision &&
    String(row.authorization_shared_access_revision) ===
      authority.sharedAccessRevision &&
    row.authorization_resource_head_id === authority.resourceHeadId &&
    String(row.authorization_resource_access_revision) ===
      authority.resourceAccessRevision &&
    String(row.authorization_structural_relation_revision) ===
      authority.structuralRelationRevision &&
    String(row.authorization_collaborator_set_revision) ===
      authority.collaboratorSetRevision &&
    sameStringArray(
      row.authorization_audit_grant_source_ids,
      authority.auditGrantSourceIds
    ) &&
    row.authorization_audit_policy_version === authority.auditPolicyVersion
  );
}

function isExactMaterializationReservationReplay(
  row: ExistingMaterializationJobRow,
  input: NormalizedMaterializationReservation
): boolean {
  return (
    row.id === input.jobId &&
    row.attachment_id === input.attachmentId &&
    row.file_id === input.file.id &&
    String(row.expected_file_revision) === input.file.expectedRevision &&
    row.conversation_id === input.content.conversationId &&
    row.timeline_item_id === input.content.timelineItemId &&
    row.parent_message_id === input.content.parentMessageId &&
    String(row.expected_parent_revision) ===
      input.content.expectedParentRevision &&
    row.visibility_boundary === input.content.visibilityBoundary &&
    row.timeline_content_id === input.content.id &&
    String(row.expected_content_revision) === input.content.expectedRevision &&
    row.content_block_key === input.content.blockKey &&
    row.content_mutation_fence_sha256 === input.content.mutationFenceSha256 &&
    row.source_occurrence_id === input.sourceOccurrenceId &&
    row.source_locator_kind === input.sourceLocator.kind &&
    row.source_locator_reference === input.sourceLocator.reference &&
    row.source_locator_digest_sha256 === input.sourceLocatorDigestSha256 &&
    row.reservation_namespace_generation ===
      input.reservationNamespaceGeneration &&
    row.cause_event_id === input.causeEventId &&
    row.cause_mutation_id === input.causeMutationId &&
    row.cause_stream_commit_id === input.causeStreamCommitId &&
    String(row.cause_stream_position) === input.causeStreamPosition &&
    row.correlation_id === input.correlationId &&
    timestampEquals(row.caused_at, input.causedAt) &&
    row.authorization_command_id === input.reservationAuthority.commandId &&
    row.authorization_command_type_id ===
      input.reservationAuthority.commandTypeId &&
    row.authorization_client_mutation_id ===
      input.reservationAuthority.clientMutationId &&
    row.authorization_mutation_id === input.reservationAuthority.mutationId &&
    row.authorization_decision_id === input.reservationAuthority.decisionId &&
    row.authorization_epoch === input.reservationAuthority.epoch &&
    row.authorization_actor_kind === input.reservationAuthority.actor.kind &&
    row.authorization_actor_id ===
      materializationAuthorityActorId(input.reservationAuthority.actor) &&
    timestampEquals(
      row.authorization_authorized_at,
      input.reservationAuthority.authorizedAt
    ) &&
    row.authorization_decision_set_digest_sha256 ===
      input.reservationAuthority.decisionSetDigestSha256 &&
    row.authorization_resource_fence_set_digest_sha256 ===
      input.reservationAuthority.resourceFenceSetDigestSha256 &&
    String(row.authorization_tenant_rbac_revision) ===
      input.reservationAuthority.tenantRbacRevision &&
    String(row.authorization_shared_access_revision) ===
      input.reservationAuthority.sharedAccessRevision &&
    row.authorization_resource_head_id ===
      input.reservationAuthority.resourceHeadId &&
    String(row.authorization_resource_access_revision) ===
      input.reservationAuthority.resourceAccessRevision &&
    String(row.authorization_structural_relation_revision) ===
      input.reservationAuthority.structuralRelationRevision &&
    String(row.authorization_collaborator_set_revision) ===
      input.reservationAuthority.collaboratorSetRevision &&
    sameStringArray(
      row.authorization_audit_grant_source_ids,
      input.reservationAuthority.auditGrantSourceIds
    ) &&
    row.authorization_audit_policy_version ===
      input.reservationAuthority.auditPolicyVersion &&
    row.idempotency_token === input.idempotencyToken &&
    String(row.expected_attachment_revision) ===
      input.expectedAttachmentRevision &&
    row.reserved_file_version_id === input.reservation.fileVersionId &&
    row.reserved_object_version_id === input.reservation.objectVersionId &&
    row.reserved_storage_root_id === input.reservation.storageRootId &&
    row.reserved_storage_object_key === input.reservation.storageKey
  );
}

function materializationReservationSuccess(
  kind: "reserved" | "already_reserved",
  input: NormalizedMaterializationReservation
): ReserveInboxV2AttachmentMaterializationResult {
  return {
    kind,
    jobId: input.jobId,
    fileId: input.file.id,
    fileVersionId: input.reservation.fileVersionId,
    objectVersionId: input.reservation.objectVersionId,
    storageRootId: input.reservation.storageRootId,
    storageKey: input.reservation.storageKey
  };
}

function mapClaimedMaterializationRow(
  row: ClaimedMaterializationRow
): InboxV2AttachmentMaterializationClaim {
  return {
    tenantId: requiredString(row.tenant_id, "claim tenant id"),
    jobId: requiredString(row.job_id, "claim job id"),
    attachmentId: requiredString(row.attachment_id, "claim attachment id"),
    attemptId: requiredString(row.attempt_id, "claim attempt id"),
    leaseToken: requiredString(row.raw_lease_token, "claim lease token"),
    leaseGeneration: requiredCounter(
      row.lease_generation,
      "claim lease generation"
    ),
    workerId: requiredString(row.lease_owner_id, "claim worker id"),
    claimedAt: requiredTimestamp(row.lease_claimed_at, "claim start"),
    leaseExpiresAt: requiredTimestamp(
      row.lease_expires_at,
      "claim lease expiry"
    ),
    expectedJobRevision: requiredCounter(
      row.expected_job_revision,
      "claim job revision"
    ),
    fileId: requiredString(row.file_id, "claim file id"),
    expectedFileRevision: requiredCounter(
      row.expected_file_revision,
      "claim file revision"
    ),
    dataClassId: requiredString(row.file_data_class_id, "claim data class"),
    processingPurposeId: requiredString(
      row.file_processing_purpose_id,
      "claim processing purpose"
    ),
    retentionAnchorAt: requiredTimestamp(
      row.file_retention_anchor_at,
      "claim retention anchor"
    ),
    fileVersionId: requiredString(
      row.reserved_file_version_id,
      "claim file version id"
    ),
    objectVersionId: requiredString(
      row.reserved_object_version_id,
      "claim object version id"
    ),
    storageRootId: requiredString(
      row.reserved_storage_root_id,
      "claim storage root"
    ),
    storageKey: requiredString(
      row.reserved_storage_object_key,
      "claim storage key"
    ),
    contentOrigin: {
      conversationId: requiredString(
        row.conversation_id,
        "claim conversation id"
      ),
      timelineItemId: requiredString(
        row.timeline_item_id,
        "claim timeline item id"
      ),
      parentKind: "message",
      parentEntityId: requiredString(
        row.parent_message_id,
        "claim parent Message id"
      ),
      expectedParentRevision: requiredCounter(
        row.expected_parent_revision,
        "claim origin parent Message revision"
      ),
      timelineContentId: requiredString(
        row.timeline_content_id,
        "claim origin content id"
      ),
      expectedContentRevision: requiredCounter(
        row.expected_content_revision,
        "claim origin content revision"
      ),
      contentBlockKey: requiredString(
        row.content_block_key,
        "claim content block key"
      ),
      expectedAttachmentRevision: requiredCounter(
        row.expected_attachment_revision,
        "claim origin attachment revision"
      ),
      visibilityBoundary: requiredEnum(
        row.visibility_boundary,
        "claim visibility boundary",
        ["external_work", "internal"] as const
      )
    },
    sourceLocator: {
      kind: requiredEnum(row.source_locator_kind, "source locator kind", [
        "provider",
        "upload_staging",
        "derivative"
      ] as const),
      reference: requiredString(
        row.source_locator_reference,
        "source locator reference"
      )
    },
    reservationNamespaceGeneration: inboxV2RoutingTokenSchema.parse(
      requiredString(
        row.reservation_namespace_generation,
        "claim reservation namespace generation"
      )
    ),
    sourceOccurrenceId: nullableString(
      row.source_occurrence_id,
      "claim SourceOccurrence id"
    ),
    causeEventId: requiredString(row.cause_event_id, "claim cause event id"),
    causeMutationId: requiredString(
      row.cause_mutation_id,
      "claim cause mutation id"
    ),
    causeStreamCommitId: requiredString(
      row.cause_stream_commit_id,
      "claim cause stream commit id"
    ),
    causeStreamPosition: requiredCounter(
      row.cause_stream_position,
      "claim cause stream position"
    ),
    correlationId: requiredString(row.correlation_id, "claim correlation id"),
    causedAt: requiredTimestamp(row.caused_at, "claim cause timestamp"),
    reservationAuthority: {
      commandId: requiredString(
        row.authorization_command_id,
        "claim authorization command id"
      ),
      commandTypeId: requiredString(
        row.authorization_command_type_id,
        "claim authorization command type"
      ),
      clientMutationId: requiredString(
        row.authorization_client_mutation_id,
        "claim authorization client mutation id"
      ),
      mutationId: requiredString(
        row.authorization_mutation_id,
        "claim authorization mutation id"
      ),
      decisionId: requiredString(
        row.authorization_decision_id,
        "claim authorization decision id"
      ),
      epoch: requiredString(
        row.authorization_epoch,
        "claim authorization epoch"
      ),
      actor: mapMaterializationAuthorityActor(
        row.authorization_actor_kind,
        row.authorization_actor_id
      ),
      authorizedAt: requiredTimestamp(
        row.authorization_authorized_at,
        "claim authorization timestamp"
      ),
      decisionSetDigestSha256: requiredString(
        row.authorization_decision_set_digest_sha256,
        "claim authorization decision-set digest"
      ),
      resourceFenceSetDigestSha256: requiredString(
        row.authorization_resource_fence_set_digest_sha256,
        "claim authorization resource-fence digest"
      ),
      tenantRbacRevision: requiredCounter(
        row.authorization_tenant_rbac_revision,
        "claim authorization tenant RBAC revision"
      ),
      sharedAccessRevision: requiredCounter(
        row.authorization_shared_access_revision,
        "claim authorization shared-access revision"
      ),
      resourceHeadId: requiredString(
        row.authorization_resource_head_id,
        "claim authorization resource-head id"
      ),
      resourceAccessRevision: requiredCounter(
        row.authorization_resource_access_revision,
        "claim authorization resource-access revision"
      ),
      structuralRelationRevision: requiredCounter(
        row.authorization_structural_relation_revision,
        "claim authorization structural-relation revision"
      ),
      collaboratorSetRevision: requiredCounter(
        row.authorization_collaborator_set_revision,
        "claim authorization collaborator-set revision"
      ),
      auditGrantSourceIds: requiredStringArray(
        row.authorization_audit_grant_source_ids,
        "claim authorization audit grant-source ids"
      ),
      auditPolicyVersion: nullableString(
        row.authorization_audit_policy_version,
        "claim authorization audit policy version"
      )
    }
  };
}

function materializationAuthorityActorId(
  actor: InboxV2AuthorizedCommandMutationContext["actor"]
): string {
  return actor.kind === "employee" ? actor.employeeId : actor.trustedServiceId;
}

function mapMaterializationAuthorityActor(
  rawKind: unknown,
  rawId: unknown
): InboxV2AuthorizedCommandMutationContext["actor"] {
  const kind = requiredEnum(rawKind, "authorization actor kind", [
    "employee",
    "trusted_service"
  ] as const);
  const id = requiredString(rawId, "authorization actor id");
  return kind === "employee"
    ? { kind, employeeId: id }
    : { kind, trustedServiceId: id };
}

class MaterializationReservationRollbackError extends Error {
  constructor(
    readonly code: Exclude<
      InboxV2FileObjectConflictCode,
      | "dispatch_plan_conflict"
      | "attachment_not_pending"
      | "attachment_revision_conflict"
      | "content_fence_conflict"
    >
  ) {
    super(`Rollback materialization reservation: ${code}`);
    this.name = "MaterializationReservationRollbackError";
  }
}

type DispatchPlanFlatRow = {
  plan_id: unknown;
  dispatch_id: unknown;
  message_id: unknown;
  message_revision: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  route_id: unknown;
  content_id: unknown;
  content_revision: unknown;
  content_fingerprint_purpose_id: unknown;
  content_fingerprint_key_generation: unknown;
  content_fingerprint_valid_until: unknown;
  content_fingerprint_hmac_sha256: unknown;
  binding_id: unknown;
  binding_revision: unknown;
  capability_revision: unknown;
  adapter_contract_id: unknown;
  adapter_contract_version: unknown;
  adapter_contract_declaration_revision: unknown;
  adapter_surface_id: unknown;
  adapter_loaded_by_trusted_service_id: unknown;
  adapter_loaded_at: unknown;
  plan_digest_sha256: unknown;
  plan_created_at: unknown;
  artifact_id: unknown;
  artifact_ordinal: unknown;
  grouping: unknown;
  capability_id: unknown;
  operation_id: unknown;
  artifact_block_ordinal: unknown;
  content_block_ordinal: unknown;
  block_key: unknown;
  block_kind: unknown;
  file_id: unknown;
  file_revision: unknown;
  file_version_id: unknown;
  object_version_id: unknown;
};

type PersistPlanRow = {
  status: unknown;
  plan_inserted_count: unknown;
  artifact_inserted_count: unknown;
  block_inserted_count: unknown;
};

/**
 * Persists the immutable provider content plan inside the caller's already
 * authorized dispatch transaction. It intentionally never starts its own
 * transaction: authorization, dispatch creation and plan pinning are one unit.
 */
export async function persistInboxV2OutboundDispatchContentPlanInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: InboxV2OutboundDispatchContentPlan
): Promise<PersistInboxV2OutboundDispatchContentPlanResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  const plan = inboxV2OutboundDispatchContentPlanSchema.parse(input);
  if (
    context.profile !== "domain" ||
    context.atomicMaterializationToken === undefined ||
    context.tenantId !== plan.tenantId
  ) {
    throw new TypeError(
      "Outbound dispatch content-plan persistence requires the matching live atomic domain prepare context."
    );
  }
  return persistOutboundDispatchContentPlanRawInTransaction(
    context.executor,
    plan
  );
}

/** @internal Raw primitive used only after the public authority gate. */
async function persistOutboundDispatchContentPlanRawInTransaction(
  executor: RawSqlExecutor,
  plan: InboxV2OutboundDispatchContentPlan
): Promise<PersistInboxV2OutboundDispatchContentPlanResult> {
  const payload = buildDispatchPlanPersistencePayload(plan);
  const result = await executor.execute<PersistPlanRow>(
    buildPersistInboxV2OutboundDispatchContentPlanSql(payload)
  );
  assertAtMostOneRow(result.rows, "Outbound dispatch content-plan persistence");
  const row = result.rows[0];
  if (row === undefined) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.dispatch_plan_result_missing",
      "Outbound dispatch content-plan persistence returned no classification."
    );
  }
  const status = requiredString(row.status, "dispatch-plan status");
  if (status === "conflict") {
    return { kind: "conflict", code: "dispatch_plan_conflict" };
  }
  if (status === "already_persisted") return { kind: status };
  if (status !== "persisted") {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.dispatch_plan_result_invalid",
      `Unknown outbound dispatch content-plan result: ${status}.`
    );
  }
  const expectedArtifactCount = plan.artifacts.length;
  const expectedBlockCount = plan.blocks.length;
  if (
    requiredNumber(row.plan_inserted_count, "inserted plan count") !== 1 ||
    requiredNumber(row.artifact_inserted_count, "inserted artifact count") !==
      expectedArtifactCount ||
    requiredNumber(row.block_inserted_count, "inserted block count") !==
      expectedBlockCount
  ) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.dispatch_plan_partial_insert",
      "The immutable dispatch content plan was not inserted completely."
    );
  }
  return { kind: "persisted" };
}

/** Loads one exact immutable content plan in the caller's existing transaction. */
export async function loadInboxV2OutboundDispatchContentPlan(
  executor: RawSqlExecutor,
  input: Readonly<{ tenantId: string; dispatchId: string }>
): Promise<InboxV2OutboundDispatchContentPlan | null> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const dispatchId = assertBrandedId(input.dispatchId, "outbound_dispatch");
  const result = await executor.execute<DispatchPlanFlatRow>(
    buildLoadInboxV2OutboundDispatchContentPlanSql({ tenantId, dispatchId })
  );
  if (result.rows.length === 0) return null;
  return mapDispatchPlanRows(tenantId, result.rows);
}

export function buildLoadInboxV2OutboundDispatchContentPlanSql(input: {
  tenantId: string;
  dispatchId: string;
}): SQL {
  return sql`
    select
      plan.id as plan_id,
      plan.dispatch_id,
      plan.message_id,
      plan.message_revision,
      plan.conversation_id,
      plan.timeline_item_id,
      plan.route_id,
      plan.content_id,
      plan.content_revision,
      plan.content_fingerprint_purpose_id,
      plan.content_fingerprint_key_generation,
      plan.content_fingerprint_valid_until,
      plan.content_fingerprint_hmac_sha256,
      plan.binding_id,
      plan.binding_revision,
      plan.capability_revision,
      plan.adapter_contract_id,
      plan.adapter_contract_version,
      plan.adapter_contract_declaration_revision,
      plan.adapter_surface_id,
      plan.adapter_loaded_by_trusted_service_id,
      plan.adapter_loaded_at,
      plan.plan_digest_sha256,
      plan.created_at as plan_created_at,
      artifact.id as artifact_id,
      artifact.ordinal as artifact_ordinal,
      artifact.grouping,
      artifact.capability_id,
      artifact.operation_id,
      block.artifact_block_ordinal,
      block.content_block_ordinal,
      block.block_key,
      block.block_kind,
      block.file_id,
      block.file_revision,
      block.file_version_id,
      block.object_version_id
    from inbox_v2_file_outbound_dispatch_plans plan
    join inbox_v2_file_outbound_artifact_plans artifact
      on artifact.tenant_id = plan.tenant_id
     and artifact.content_plan_id = plan.id
     and artifact.dispatch_id = plan.dispatch_id
    join inbox_v2_file_outbound_artifact_blocks block
      on block.tenant_id = artifact.tenant_id
     and block.content_plan_id = artifact.content_plan_id
     and block.artifact_plan_id = artifact.id
     and block.artifact_ordinal = artifact.ordinal
    where plan.tenant_id = ${input.tenantId}
      and plan.dispatch_id = ${input.dispatchId}
    order by artifact.ordinal asc, block.artifact_block_ordinal asc
    limit 64
  `;
}

type DispatchPlanPersistencePayload = Readonly<{
  tenantId: InboxV2TenantId;
  planId: string;
  dispatchId: string;
  planDigestSha256: string;
  planJson: string;
  artifactsJson: string;
  blocksJson: string;
  artifactCount: number;
  blockCount: number;
}>;

function buildDispatchPlanPersistencePayload(
  plan: InboxV2OutboundDispatchContentPlan
): DispatchPlanPersistencePayload {
  const artifactRows = plan.artifacts.map((artifact) => ({
    id: deriveBrandedId(
      "outbound_dispatch_artifact_plan",
      plan.tenantId,
      plan.id,
      String(artifact.ordinal)
    ),
    ordinal: artifact.ordinal,
    grouping: artifact.grouping,
    capabilityId: artifact.capabilityId,
    operationId: artifact.operationId,
    artifactPlanHashSha256: deriveRawSha256(
      "core:inbox-v2.outbound-dispatch-artifact-plan@v1",
      plan.tenantId,
      plan.id,
      String(artifact.ordinal),
      artifact.grouping,
      artifact.capabilityId,
      artifact.operationId,
      ...artifact.blockKeys
    ),
    blockMappingCount: artifact.blockKeys.length
  }));
  const artifactByOrdinal = new Map(
    artifactRows.map((artifact) => [artifact.ordinal, artifact])
  );
  const blockRows = plan.blocks.map((block, contentBlockOrdinal) => {
    const artifact = plan.artifacts.find(
      (candidate) => candidate.ordinal === block.artifactOrdinal
    );
    const persistedArtifact = artifactByOrdinal.get(block.artifactOrdinal);
    if (artifact === undefined || persistedArtifact === undefined) {
      throw new InboxV2FileObjectPersistenceError(
        "inbox_v2.dispatch_plan_artifact_missing",
        `Block ${block.blockKey} has no artifact plan.`
      );
    }
    const artifactBlockOrdinal = artifact.blockKeys.indexOf(block.blockKey) + 1;
    if (artifactBlockOrdinal < 1) {
      throw new InboxV2FileObjectPersistenceError(
        "inbox_v2.dispatch_plan_block_missing",
        `Block ${block.blockKey} is absent from its artifact plan.`
      );
    }
    const pin = block.exactFileObjectPin;
    return {
      artifactPlanId: persistedArtifact.id,
      artifactOrdinal: block.artifactOrdinal,
      artifactBlockOrdinal,
      contentBlockOrdinal,
      blockKey: block.blockKey,
      blockKind: block.blockKind,
      fileId: pin?.file.id ?? null,
      fileRevision: pin?.fileRevision ?? null,
      fileVersionId: pin?.fileVersion.id ?? null,
      objectVersionId: pin?.objectVersion.id ?? null
    };
  });
  return {
    tenantId: plan.tenantId,
    planId: plan.id,
    dispatchId: plan.dispatch.id,
    planDigestSha256: plan.planDigestSha256,
    planJson: JSON.stringify({
      id: plan.id,
      dispatchId: plan.dispatch.id,
      messageId: plan.message.id,
      messageRevision: plan.messageRevision,
      conversationId: plan.conversation.id,
      timelineItemId: plan.timelineItem.id,
      routeId: plan.route.id,
      contentId: plan.timelineContent.id,
      contentRevision: plan.contentRevision,
      contentFingerprintPurposeId: plan.contentFingerprint.purposeId,
      contentFingerprintKeyGeneration: plan.contentFingerprint.keyGeneration,
      contentFingerprintValidUntil: plan.contentFingerprint.validUntil,
      contentFingerprintHmacSha256: plan.contentFingerprint.hmacSha256,
      bindingId: plan.binding.id,
      bindingRevision: plan.bindingRevision,
      capabilityRevision: plan.capabilityRevision,
      adapterContractId: plan.adapterContract.contractId,
      adapterContractVersion: plan.adapterContract.contractVersion,
      adapterContractDeclarationRevision:
        plan.adapterContract.declarationRevision,
      adapterSurfaceId: plan.adapterContract.surfaceId,
      adapterLoadedByTrustedServiceId:
        plan.adapterContract.loadedByTrustedServiceId,
      adapterLoadedAt: plan.adapterContract.loadedAt,
      planDigestSha256: plan.planDigestSha256,
      blockCount: plan.blocks.length,
      artifactCount: plan.artifacts.length,
      createdAt: plan.createdAt
    }),
    artifactsJson: JSON.stringify(artifactRows),
    blocksJson: JSON.stringify(blockRows),
    artifactCount: artifactRows.length,
    blockCount: blockRows.length
  };
}

export function buildPersistInboxV2OutboundDispatchContentPlanSql(
  payload: DispatchPlanPersistencePayload
): SQL {
  return sql`
    with requested_plan as (
      select *
      from jsonb_to_record(${payload.planJson}::jsonb) as value(
        id text,
        "dispatchId" text,
        "messageId" text,
        "messageRevision" bigint,
        "conversationId" text,
        "timelineItemId" text,
        "routeId" text,
        "contentId" text,
        "contentRevision" bigint,
        "contentFingerprintPurposeId" text,
        "contentFingerprintKeyGeneration" text,
        "contentFingerprintValidUntil" timestamptz,
        "contentFingerprintHmacSha256" text,
        "bindingId" text,
        "bindingRevision" bigint,
        "capabilityRevision" bigint,
        "adapterContractId" text,
        "adapterContractVersion" text,
        "adapterContractDeclarationRevision" bigint,
        "adapterSurfaceId" text,
        "adapterLoadedByTrustedServiceId" text,
        "adapterLoadedAt" timestamptz,
        "planDigestSha256" text,
        "blockCount" smallint,
        "artifactCount" smallint,
        "createdAt" timestamptz
      )
    ),
    existing as (
      select id, plan_digest_sha256
      from inbox_v2_file_outbound_dispatch_plans
      where tenant_id = ${payload.tenantId}
        and dispatch_id = ${payload.dispatchId}
      for share
    ),
    inserted_plan as (
      insert into inbox_v2_file_outbound_dispatch_plans (
        tenant_id, id, dispatch_id, message_id, message_revision,
        conversation_id, timeline_item_id, route_id, content_id,
        content_revision, content_fingerprint_purpose_id,
        content_fingerprint_key_generation, content_fingerprint_valid_until,
        content_fingerprint_hmac_sha256, binding_id,
        binding_revision, capability_revision, adapter_contract_id,
        adapter_contract_version, adapter_contract_declaration_revision,
        adapter_surface_id, adapter_loaded_by_trusted_service_id,
        adapter_loaded_at, plan_digest_sha256, block_count, artifact_count,
        revision, created_at
      )
      select
        ${payload.tenantId}, value.id, value."dispatchId", value."messageId",
        value."messageRevision", value."conversationId", value."timelineItemId",
        value."routeId", value."contentId", value."contentRevision",
        value."contentFingerprintPurposeId",
        value."contentFingerprintKeyGeneration",
        value."contentFingerprintValidUntil",
        value."contentFingerprintHmacSha256", value."bindingId",
        value."bindingRevision",
        value."capabilityRevision", value."adapterContractId",
        value."adapterContractVersion", value."adapterContractDeclarationRevision",
        value."adapterSurfaceId", value."adapterLoadedByTrustedServiceId",
        value."adapterLoadedAt",
        value."planDigestSha256", value."blockCount", value."artifactCount",
        1, value."createdAt"
      from requested_plan value
      where not exists (select 1 from existing)
      on conflict do nothing
      returning id
    ),
    requested_artifacts as (
      select *
      from jsonb_to_recordset(${payload.artifactsJson}::jsonb) as value(
        id text,
        ordinal smallint,
        grouping inbox_v2_file_outbound_artifact_grouping,
        "capabilityId" text,
        "operationId" text,
        "artifactPlanHashSha256" text,
        "blockMappingCount" smallint
      )
    ),
    inserted_artifacts as (
      insert into inbox_v2_file_outbound_artifact_plans (
        tenant_id, id, content_plan_id, dispatch_id, ordinal, grouping,
        capability_id, operation_id, artifact_plan_hash_sha256,
        block_mapping_count, created_at
      )
      select
        ${payload.tenantId}, value.id, ${payload.planId}, ${payload.dispatchId},
        value.ordinal, value.grouping, value."capabilityId", value."operationId",
        value."artifactPlanHashSha256", value."blockMappingCount", plan."createdAt"
      from requested_artifacts value
      cross join requested_plan plan
      where exists (select 1 from inserted_plan)
      returning id
    ),
    requested_blocks as (
      select *
      from jsonb_to_recordset(${payload.blocksJson}::jsonb) as value(
        "artifactPlanId" text,
        "artifactOrdinal" smallint,
        "artifactBlockOrdinal" smallint,
        "contentBlockOrdinal" smallint,
        "blockKey" text,
        "blockKind" inbox_v2_file_outbound_block_kind,
        "fileId" text,
        "fileRevision" bigint,
        "fileVersionId" text,
        "objectVersionId" text
      )
    ),
    inserted_blocks as (
      insert into inbox_v2_file_outbound_artifact_blocks (
        tenant_id, content_plan_id, artifact_plan_id, artifact_ordinal,
        artifact_block_ordinal, content_block_ordinal, block_key, block_kind,
        file_id, file_revision, file_version_id, object_version_id, created_at
      )
      select
        ${payload.tenantId}, ${payload.planId}, value."artifactPlanId",
        value."artifactOrdinal", value."artifactBlockOrdinal",
        value."contentBlockOrdinal", value."blockKey", value."blockKind",
        value."fileId", value."fileRevision", value."fileVersionId",
        value."objectVersionId", plan."createdAt"
      from requested_blocks value
      cross join requested_plan plan
      where exists (select 1 from inserted_plan)
      returning artifact_plan_id
    )
    select
      case
        when exists (
          select 1 from existing
          where id = ${payload.planId}
            and plan_digest_sha256 = ${payload.planDigestSha256}
        ) then 'already_persisted'
        when exists (select 1 from existing) then 'conflict'
        when (select count(*) from inserted_plan) = 1
         and (select count(*) from inserted_artifacts) = ${payload.artifactCount}
         and (select count(*) from inserted_blocks) = ${payload.blockCount}
          then 'persisted'
        else 'conflict'
      end as status,
      (select count(*) from inserted_plan)::integer as plan_inserted_count,
      (select count(*) from inserted_artifacts)::integer as artifact_inserted_count,
      (select count(*) from inserted_blocks)::integer as block_inserted_count
  `;
}

function mapDispatchPlanRows(
  tenantId: InboxV2TenantId,
  rows: readonly DispatchPlanFlatRow[]
): InboxV2OutboundDispatchContentPlan {
  const first = rows[0];
  if (first === undefined) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.dispatch_plan_rows_missing",
      "Cannot map an empty dispatch content plan."
    );
  }
  const planId = requiredString(first.plan_id, "plan id");
  const dispatchId = requiredString(first.dispatch_id, "dispatch id");
  const artifacts = new Map<
    number,
    {
      ordinal: number;
      grouping: "single" | "album" | "split";
      capabilityId: string;
      operationId: string;
      blockKeys: string[];
    }
  >();
  const blocks: Array<{
    ordinal: number;
    blockKey: string;
    blockKind:
      | "text"
      | "image"
      | "audio"
      | "video"
      | "file"
      | "sticker"
      | "location"
      | "contact"
      | "extension";
    exactFileObjectPin: {
      file: { tenantId: InboxV2TenantId; kind: "file"; id: string };
      fileRevision: string;
      fileVersion: {
        tenantId: InboxV2TenantId;
        kind: "file_version";
        id: string;
      };
      objectVersion: {
        tenantId: InboxV2TenantId;
        kind: "file_object_version";
        id: string;
      };
    } | null;
    artifactOrdinal: number;
  }> = [];
  for (const row of rows) {
    if (
      requiredString(row.plan_id, "plan id") !== planId ||
      requiredString(row.dispatch_id, "dispatch id") !== dispatchId
    ) {
      throw new InboxV2FileObjectPersistenceError(
        "inbox_v2.dispatch_plan_row_scope_conflict",
        "Dispatch content-plan rows cross immutable plan scope."
      );
    }
    const artifactOrdinal = requiredNumber(
      row.artifact_ordinal,
      "artifact ordinal"
    );
    const grouping = requiredEnum(row.grouping, "artifact grouping", [
      "single",
      "album",
      "split"
    ] as const);
    let artifact = artifacts.get(artifactOrdinal);
    if (artifact === undefined) {
      artifact = {
        ordinal: artifactOrdinal,
        grouping,
        capabilityId: requiredString(row.capability_id, "capability id"),
        operationId: requiredString(row.operation_id, "operation id"),
        blockKeys: []
      };
      artifacts.set(artifactOrdinal, artifact);
    }
    const blockKey = requiredString(row.block_key, "block key");
    artifact.blockKeys.push(blockKey);
    const fileId = nullableString(row.file_id, "file id");
    const fileRevision = nullableCounter(row.file_revision, "file revision");
    const fileVersionId = nullableString(
      row.file_version_id,
      "file version id"
    );
    const objectVersionId = nullableString(
      row.object_version_id,
      "object version id"
    );
    const pinCount = [
      fileId,
      fileRevision,
      fileVersionId,
      objectVersionId
    ].filter((value) => value !== null).length;
    if (pinCount !== 0 && pinCount !== 4) {
      throw new InboxV2FileObjectPersistenceError(
        "inbox_v2.dispatch_plan_pin_incomplete",
        `Block ${blockKey} has an incomplete file/object pin.`
      );
    }
    blocks.push({
      ordinal: requiredNumber(
        row.content_block_ordinal,
        "content block ordinal"
      ),
      blockKey,
      blockKind: requiredEnum(row.block_kind, "block kind", [
        "text",
        "image",
        "audio",
        "video",
        "file",
        "sticker",
        "location",
        "contact",
        "extension"
      ] as const),
      exactFileObjectPin:
        pinCount === 0
          ? null
          : {
              file: { tenantId, kind: "file" as const, id: fileId! },
              fileRevision: fileRevision!,
              fileVersion: {
                tenantId,
                kind: "file_version" as const,
                id: fileVersionId!
              },
              objectVersion: {
                tenantId,
                kind: "file_object_version" as const,
                id: objectVersionId!
              }
            },
      artifactOrdinal
    });
  }
  blocks.sort((left, right) => left.ordinal - right.ordinal);
  const plan = {
    tenantId,
    id: planId,
    dispatch: { tenantId, kind: "outbound_dispatch" as const, id: dispatchId },
    message: {
      tenantId,
      kind: "message" as const,
      id: requiredString(first.message_id, "message id")
    },
    messageRevision: requiredCounter(
      first.message_revision,
      "message revision"
    ),
    conversation: {
      tenantId,
      kind: "conversation" as const,
      id: requiredString(first.conversation_id, "conversation id")
    },
    timelineItem: {
      tenantId,
      kind: "timeline_item" as const,
      id: requiredString(first.timeline_item_id, "timeline item id")
    },
    route: {
      tenantId,
      kind: "outbound_route" as const,
      id: requiredString(first.route_id, "route id")
    },
    timelineContent: {
      tenantId,
      kind: "timeline_content" as const,
      id: requiredString(first.content_id, "content id")
    },
    contentRevision: requiredCounter(
      first.content_revision,
      "content revision"
    ),
    contentFingerprint: {
      purposeId: requiredString(
        first.content_fingerprint_purpose_id,
        "content fingerprint purpose"
      ),
      keyGeneration: requiredString(
        first.content_fingerprint_key_generation,
        "content fingerprint key generation"
      ),
      validUntil: requiredTimestamp(
        first.content_fingerprint_valid_until,
        "content fingerprint validity"
      ),
      hmacSha256: requiredHmacSha256(
        first.content_fingerprint_hmac_sha256,
        "content fingerprint HMAC"
      )
    },
    binding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: requiredString(first.binding_id, "binding id")
    },
    bindingRevision: requiredCounter(
      first.binding_revision,
      "binding revision"
    ),
    capabilityRevision: requiredCounter(
      first.capability_revision,
      "capability revision"
    ),
    adapterContract: {
      contractId: requiredString(
        first.adapter_contract_id,
        "adapter contract id"
      ),
      contractVersion: requiredString(
        first.adapter_contract_version,
        "adapter contract version"
      ),
      declarationRevision: requiredCounter(
        first.adapter_contract_declaration_revision,
        "adapter contract declaration revision"
      ),
      surfaceId: requiredString(first.adapter_surface_id, "adapter surface id"),
      loadedByTrustedServiceId: requiredString(
        first.adapter_loaded_by_trusted_service_id,
        "adapter trusted service id"
      ),
      loadedAt: requiredTimestamp(first.adapter_loaded_at, "adapter loaded at")
    },
    blocks: blocks.map(({ ordinal: _ordinal, ...block }) => block),
    artifacts: [...artifacts.values()].sort(
      (left, right) => left.ordinal - right.ordinal
    ),
    createdAt: requiredTimestamp(first.plan_created_at, "plan created at"),
    revision: "1" as const,
    planDigestSha256: requiredRawSha256(first.plan_digest_sha256, "plan digest")
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse(plan);
}

export function calculateInboxV2AttachmentContentMutationFenceSha256(input: {
  tenantId: string;
  attachmentId: string;
  expectedAttachmentRevision: string;
  timelineContentId: string;
  expectedContentRevision: string;
  contentBlockKey: string;
}): string {
  return deriveRawSha256(
    "core:inbox-v2.attachment-content-mutation-fence@v1",
    input.tenantId,
    input.attachmentId,
    input.expectedAttachmentRevision,
    input.timelineContentId,
    input.expectedContentRevision,
    input.contentBlockKey
  );
}

export function deriveInboxV2StorageOrphanId(input: {
  tenantId: string;
  storageRootId: string;
  storageKey: string;
  storageVersionIdentity: string;
}): string {
  return deriveBrandedId(
    "file_storage_orphan",
    input.tenantId,
    input.storageRootId,
    input.storageKey,
    input.storageVersionIdentity
  );
}

function normalizeMaterializationClaim(
  claim: InboxV2AttachmentMaterializationClaim
): InboxV2AttachmentMaterializationClaim {
  const tenantId = inboxV2TenantIdSchema.parse(claim.tenantId);
  assertBrandedId(claim.jobId, "attachment_materialization_job");
  assertBrandedId(claim.attachmentId, "message_attachment");
  assertBrandedId(claim.attemptId, "attachment_materialization_attempt");
  assertBrandedId(claim.fileId, "file");
  assertBrandedId(claim.fileVersionId, "file_version");
  assertBrandedId(claim.objectVersionId, "file_object_version");
  assertPositiveCounter(claim.expectedJobRevision, "expected job revision");
  assertPositiveCounter(claim.leaseGeneration, "lease generation");
  assertCatalogId(claim.workerId, "materialization worker");
  assertPositiveCounter(claim.expectedFileRevision, "expected file revision");
  assertCatalogId(claim.dataClassId, "file data class");
  assertCatalogId(claim.processingPurposeId, "file processing purpose");
  assertTimestamp(claim.retentionAnchorAt, "file retention anchor");
  assertBoundedOpaque(claim.leaseToken, 256, "materialization lease token");
  assertTimestamp(claim.claimedAt, "materialization claim start");
  assertTimestamp(claim.leaseExpiresAt, "materialization claim expiry");
  if (Date.parse(claim.leaseExpiresAt) <= Date.parse(claim.claimedAt)) {
    throw new TypeError(
      "Materialization claim requires a positive lease window."
    );
  }
  assertCatalogId(claim.storageRootId, "storage root");
  assertBoundedOpaque(claim.storageKey, 2_048, "storage key");
  assertBrandedId(claim.contentOrigin.conversationId, "conversation");
  assertBrandedId(claim.contentOrigin.timelineItemId, "timeline_item");
  assertBrandedId(claim.contentOrigin.parentEntityId, "message");
  assertPositiveCounter(
    claim.contentOrigin.expectedParentRevision,
    "origin parent Message revision"
  );
  assertBrandedId(claim.contentOrigin.timelineContentId, "timeline_content");
  assertPositiveCounter(
    claim.contentOrigin.expectedContentRevision,
    "origin content revision"
  );
  assertBlockKey(claim.contentOrigin.contentBlockKey);
  assertPositiveCounter(
    claim.contentOrigin.expectedAttachmentRevision,
    "origin attachment revision"
  );
  if (
    claim.contentOrigin.parentKind !== "message" ||
    claim.contentOrigin.expectedAttachmentRevision.length === 0
  ) {
    throw new TypeError("Materialization claim requires a Message origin.");
  }
  assertBrandedId(claim.causeEventId, "event");
  assertBoundedOpaque(claim.causeMutationId, 256, "cause mutation id");
  assertBoundedOpaque(claim.causeStreamCommitId, 256, "cause stream commit id");
  assertPositiveCounter(claim.causeStreamPosition, "cause stream position");
  assertCorrelationId(claim.correlationId);
  assertTimestamp(claim.causedAt, "materialization cause timestamp");
  assertBoundedOpaque(
    claim.reservationAuthority.commandId,
    256,
    "reservation command id"
  );
  if (
    claim.reservationAuthority.commandTypeId !==
    INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID
  ) {
    throw new TypeError("Materialization claim has an invalid command type.");
  }
  assertCorrelationId(claim.reservationAuthority.clientMutationId);
  assertBoundedOpaque(
    claim.reservationAuthority.mutationId,
    256,
    "reservation mutation id"
  );
  assertBoundedOpaque(
    claim.reservationAuthority.decisionId,
    256,
    "reservation decision id"
  );
  assertBoundedOpaque(
    claim.reservationAuthority.epoch,
    1_024,
    "reservation authorization epoch"
  );
  assertBoundedOpaque(
    materializationAuthorityActorId(claim.reservationAuthority.actor),
    256,
    "reservation actor id"
  );
  assertTimestamp(
    claim.reservationAuthority.authorizedAt,
    "reservation authorization timestamp"
  );
  assertRawSha256(
    claim.reservationAuthority.decisionSetDigestSha256,
    "reservation decision-set digest"
  );
  assertRawSha256(
    claim.reservationAuthority.resourceFenceSetDigestSha256,
    "reservation resource-fence digest"
  );
  if (
    !ATTACHMENT_SOURCE_LOCATOR_HANDLE_PATTERN.test(
      claim.sourceLocator.reference
    )
  ) {
    throw new TypeError(
      "Materialization claim source locator is not an opaque handle."
    );
  }
  if (claim.sourceLocator.kind === "provider") {
    if (claim.sourceOccurrenceId === null) {
      throw new TypeError(
        "Provider materialization claim requires SourceOccurrence."
      );
    }
    assertBrandedId(claim.sourceOccurrenceId, "source_occurrence");
  } else if (claim.sourceOccurrenceId !== null) {
    throw new TypeError(
      "Non-provider materialization claim cannot carry SourceOccurrence."
    );
  }
  return {
    ...claim,
    tenantId,
    causedAt: normalizeTimestamp(claim.causedAt),
    reservationAuthority: {
      ...claim.reservationAuthority,
      authorizedAt: normalizeTimestamp(claim.reservationAuthority.authorizedAt)
    }
  };
}

function normalizeAttachFileParentInput(
  input: AttachInboxV2FileParentInput
): AttachInboxV2FileParentInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertBrandedId(input.fileId, "file");
  assertBrandedId(input.fileVersionId, "file_version");
  assertBrandedId(input.objectVersionId, "file_object_version");
  assertPositiveCounter(
    input.expectedParentSetRevision,
    "expected parent-set revision"
  );
  assertCatalogId(input.dataClassId, "parent data class");
  assertCatalogId(input.processingPurposeId, "parent processing purpose");
  assertTimestamp(input.retentionAnchorAt, "parent retention anchor");
  const parent = input.parent;
  assertPositiveCounter(parent.entityRevision, "parent entity revision");
  assertBrandedId(
    parent.entityId,
    parent.kind === "message"
      ? "message"
      : parent.kind === "staff_note"
        ? "staff_note"
        : "message_attachment"
  );
  const hasTimelineScope =
    parent.conversationId !== null &&
    parent.timelineItemId !== null &&
    parent.contentId !== null &&
    parent.contentRevision !== null &&
    parent.blockKey !== null;
  if (parent.kind === "upload_staging") {
    if (
      hasTimelineScope ||
      [
        parent.conversationId,
        parent.timelineItemId,
        parent.contentId,
        parent.contentRevision,
        parent.blockKey
      ].some((value) => value !== null) ||
      parent.purpose !== "attachment" ||
      parent.visibilityBoundary !== "upload_staging" ||
      parent.parentConversationVisibility !== null
    ) {
      throw new TypeError("Upload-staging parent shape is invalid.");
    }
  } else {
    if (!hasTimelineScope) {
      throw new TypeError(
        "Message and staff-note parents require exact content scope."
      );
    }
    assertBrandedId(parent.conversationId!, "conversation");
    assertBrandedId(parent.timelineItemId!, "timeline_item");
    assertBrandedId(parent.contentId!, "timeline_content");
    assertPositiveCounter(parent.contentRevision!, "parent content revision");
    assertBlockKey(parent.blockKey!);
    if (
      (parent.kind === "message" &&
        (parent.visibilityBoundary === "staff_note" ||
          parent.visibilityBoundary === "upload_staging" ||
          parent.parentConversationVisibility !== null)) ||
      (parent.kind === "staff_note" &&
        (parent.visibilityBoundary !== "staff_note" ||
          parent.parentConversationVisibility === null))
    ) {
      throw new TypeError("Timeline parent visibility shape is invalid.");
    }
  }
  return { ...input, tenantId };
}

function normalizeDetachFileParentInput(
  input: DetachInboxV2FileParentInput
): DetachInboxV2FileParentInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertBrandedId(input.fileId, "file");
  assertBrandedId(input.linkId, "file_parent_link");
  assertBrandedId(input.detachedByEventId, "event");
  assertPositiveCounter(
    input.expectedParentSetRevision,
    "expected parent-set revision"
  );
  assertPositiveCounter(input.expectedLinkRevision, "expected link revision");
  return { ...input, tenantId };
}

function normalizeObjectDeletionInput(
  input: AuthorizeInboxV2ObjectDeletionInput
): AuthorizeInboxV2ObjectDeletionInput {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertBrandedId(input.objectVersionId, "file_object_version");
  assertPositiveCounter(
    input.expectedObjectHeadRevision,
    "expected object-head revision"
  );
  return { ...input, tenantId };
}

function classifyFileParentSetHead(
  row: FileParentSetLockRow,
  input: AttachInboxV2FileParentInput
):
  | "file_parent_set_incomplete"
  | "file_parent_set_revision_conflict"
  | "file_parent_count_conflict"
  | null {
  if (
    row.completeness !== "complete" ||
    String(row.completeness_revision) !== String(row.revision)
  ) {
    return "file_parent_set_incomplete";
  }
  if (String(row.revision) !== input.expectedParentSetRevision) {
    return "file_parent_set_revision_conflict";
  }
  if (
    requiredNumber(row.live_parent_count, "live parent count") !==
    requiredNumber(row.actual_live_parent_count, "actual live parent count")
  ) {
    return "file_parent_count_conflict";
  }
  return null;
}

function isExactFileParentLinkReplay(
  row: ExistingFileParentLinkRow,
  input: AttachInboxV2FileParentInput,
  linkId: string,
  parentIdentityDigestSha256: string
): boolean {
  const parent = input.parent;
  return (
    row.id === linkId &&
    row.file_version_id === input.fileVersionId &&
    row.object_version_id === input.objectVersionId &&
    row.parent_identity_digest_sha256 === parentIdentityDigestSha256 &&
    row.parent_kind === parent.kind &&
    row.parent_purpose === parent.purpose &&
    row.visibility_boundary === parent.visibilityBoundary &&
    row.parent_conversation_visibility ===
      parent.parentConversationVisibility &&
    row.parent_entity_id === parent.entityId &&
    String(row.parent_entity_revision) === parent.entityRevision &&
    row.conversation_id === parent.conversationId &&
    row.timeline_item_id === parent.timelineItemId &&
    row.content_id === parent.contentId &&
    (row.content_revision === null
      ? parent.contentRevision === null
      : String(row.content_revision) === parent.contentRevision) &&
    row.block_key === parent.blockKey &&
    row.data_class_id === input.dataClassId &&
    row.processing_purpose_id === input.processingPurposeId &&
    requiredTimestamp(row.retention_anchor_at, "parent retention anchor") ===
      normalizeTimestamp(input.retentionAnchorAt) &&
    String(row.head_revision) === "1" &&
    row.detached_by_event_id === null
  );
}

function normalizeZeroCapableCounter(value: string, field: string): string {
  if (!/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    throw new TypeError(`${field} must be a non-negative decimal counter.`);
  }
  return value;
}

function normalizeContentFence(
  input: InboxV2AttachmentMaterializationContentFence
): InboxV2AttachmentMaterializationContentFence {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  assertBrandedId(input.conversationId, "conversation");
  assertBrandedId(input.timelineItemId, "timeline_item");
  assertBrandedId(input.timelineContentId, "timeline_content");
  assertBrandedId(input.attachmentId, "message_attachment");
  assertPositiveCounter(
    input.resultingContentRevision,
    "resulting content revision"
  );
  assertPositiveCounter(
    input.resultingAttachmentRevision,
    "resulting attachment revision"
  );
  assertPositiveCounter(input.parentEntityRevision, "parent entity revision");
  assertBlockKey(input.contentBlockKey);
  assertCatalogId(input.dataClassId, "parent data class");
  assertCatalogId(input.processingPurposeId, "parent processing purpose");
  assertTimestamp(input.retentionAnchorAt, "parent retention anchor");
  assertBrandedId(
    input.parentEntityId,
    input.parentKind === "message" ? "message" : "staff_note"
  );
  if (
    (input.parentKind === "message" &&
      (input.visibilityBoundary === "staff_note" ||
        input.parentConversationVisibility !== null)) ||
    (input.parentKind === "staff_note" &&
      (input.visibilityBoundary !== "staff_note" ||
        input.parentConversationVisibility === null))
  ) {
    throw new TypeError("Materialization parent visibility is inconsistent.");
  }
  return { ...input, tenantId };
}

function normalizeReadyFinalization(
  input: FinalizeInboxV2AttachmentReadyInMessageMutationInput
) {
  const claim = normalizeMaterializationClaim(input.claim);
  const contentFence = normalizeContentFence(input.contentFence);
  if (claim.tenantId !== contentFence.tenantId) {
    throw new TypeError(
      "Materialization claim and content fence cross tenants."
    );
  }
  if (
    input.storage.storageKey.length === 0 ||
    input.storage.storageKey.length > 2_048 ||
    input.storage.storageVersionId.length === 0 ||
    input.storage.storageVersionId.length > 1_024
  ) {
    throw new TypeError("Ready storage identity is not bounded.");
  }
  const rawChecksumSha256 = normalizeSha256(input.storage.checksumSha256);
  assertByteSize(input.storage.sizeBytes, "ready object size");
  assertMediaType(input.storage.mediaType);
  return {
    claim,
    contentFence,
    storage: { ...input.storage, rawChecksumSha256 }
  };
}

function normalizeFailedFinalization(
  input: FinalizeInboxV2AttachmentFailedInMessageMutationInput
) {
  const claim = normalizeMaterializationClaim(input.claim);
  const contentFence = normalizeContentFence(input.contentFence);
  if (claim.tenantId !== contentFence.tenantId) {
    throw new TypeError(
      "Materialization claim and content fence cross tenants."
    );
  }
  return {
    claim,
    contentFence,
    retryable: input.retryable,
    safeReasonId: deriveInboxV2AttachmentMaterializationFailureReasonId(
      input.code
    )
  };
}

function classifyReadyReplay(
  row: MaterializationFinalizationRow,
  input: ReturnType<typeof normalizeReadyFinalization>
): InboxV2NonAppliedAttachmentMaterializationResult | null {
  const state = requiredString(row.job_state, "materialization job state");
  if (!isTerminalMaterializationState(state)) return null;
  const leaseGeneration = String(row.lease_generation);
  const expectedFileRevision = incrementCounter(
    input.claim.expectedFileRevision
  );
  const expectedAttachmentRevision =
    input.contentFence.resultingAttachmentRevision;
  const expectedContentRevision = input.contentFence.resultingContentRevision;
  const operationEvidenceId = deriveBrandedId(
    "object_operation_evidence",
    input.claim.tenantId,
    input.claim.jobId,
    leaseGeneration,
    "put"
  );
  const materializationEvidenceId = deriveBrandedId(
    "attachment_materialization_evidence",
    input.claim.tenantId,
    input.claim.jobId,
    leaseGeneration
  );
  const operationAttemptToken = `object-put:${deriveRawSha256(
    "core:inbox-v2.object-put-attempt-token@v1",
    input.claim.tenantId,
    input.claim.attemptId
  )}`;
  const evidenceHashSha256 = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-evidence@v2",
    input.claim.tenantId,
    input.claim.jobId,
    input.claim.attemptId,
    input.claim.causeEventId,
    input.claim.causeMutationId,
    input.claim.causeStreamCommitId,
    input.claim.causeStreamPosition,
    input.claim.correlationId,
    input.claim.causedAt,
    ...materializationReservationAuthorityHashParts(input.claim),
    leaseGeneration,
    "ready",
    input.claim.fileId,
    input.claim.fileVersionId,
    input.claim.objectVersionId,
    expectedAttachmentRevision,
    expectedContentRevision,
    input.storage.rawChecksumSha256,
    String(input.storage.sizeBytes)
  );
  if (
    state === "ready" &&
    isExactTerminalMaterializationClaim(row, input.claim, input.contentFence) &&
    row.result_file_version_id === input.claim.fileVersionId &&
    row.result_object_version_id === input.claim.objectVersionId &&
    nullableCounter(row.result_file_revision, "result file revision") ===
      expectedFileRevision &&
    nullableCounter(row.result_content_revision, "result content revision") ===
      expectedContentRevision &&
    row.terminal_reason_id === null &&
    row.file_state === "ready" &&
    String(row.file_revision) === expectedFileRevision &&
    row.file_current_file_version_id === input.claim.fileVersionId &&
    row.file_current_object_version_id === input.claim.objectVersionId &&
    String(row.attachment_revision) === expectedAttachmentRevision &&
    isExactTerminalContentPayload(
      row,
      input.contentFence,
      "ready",
      input.claim,
      null
    ) &&
    row.replay_file_version_id === input.claim.fileVersionId &&
    row.replay_file_version_file_id === input.claim.fileId &&
    row.replay_file_version_object_version_id === input.claim.objectVersionId &&
    row.replay_object_version_id === input.claim.objectVersionId &&
    row.replay_storage_root_id === input.claim.storageRootId &&
    row.replay_storage_object_key === input.storage.storageKey &&
    row.replay_storage_version_identity === input.storage.storageVersionId &&
    row.replay_checksum_sha256 === input.storage.rawChecksumSha256 &&
    String(row.replay_size_bytes) === String(input.storage.sizeBytes) &&
    row.replay_declared_media_type === input.storage.mediaType &&
    row.replay_detected_media_type === input.storage.mediaType &&
    row.replay_object_head_state === "ready" &&
    row.replay_object_head_evidence_id === operationEvidenceId &&
    row.replay_operation_evidence_id === operationEvidenceId &&
    row.replay_operation_object_version_id === input.claim.objectVersionId &&
    row.replay_operation_job_id === input.claim.jobId &&
    row.replay_operation_kind === "put" &&
    row.replay_operation_storage_root_id === input.claim.storageRootId &&
    row.replay_operation_attempt_token === operationAttemptToken &&
    row.replay_operation_outcome === "succeeded" &&
    String(row.replay_operation_affected_bytes) ===
      String(input.storage.sizeBytes) &&
    isExactTerminalMaterializationEvidence(row, {
      claim: input.claim,
      contentFence: input.contentFence,
      leaseGeneration,
      outcome: "ready",
      evidenceId: materializationEvidenceId,
      resultingFileRevision: expectedFileRevision,
      operationEvidenceId,
      safeReasonId: null,
      retryable: null,
      evidenceHashSha256
    })
  ) {
    return "already_applied";
  }
  return "state_conflict";
}

function classifyFailedReplay(
  row: MaterializationFinalizationRow,
  input: ReturnType<typeof normalizeFailedFinalization>
): InboxV2NonAppliedAttachmentMaterializationResult | null {
  const state = requiredString(row.job_state, "materialization job state");
  if (!isTerminalMaterializationState(state)) return null;
  const leaseGeneration = String(row.lease_generation);
  const materializationEvidenceId = deriveBrandedId(
    "attachment_materialization_evidence",
    input.claim.tenantId,
    input.claim.jobId,
    leaseGeneration
  );
  const evidenceHashSha256 = deriveRawSha256(
    "core:inbox-v2.attachment-materialization-evidence@v2",
    input.claim.tenantId,
    input.claim.jobId,
    input.claim.attemptId,
    input.claim.causeEventId,
    input.claim.causeMutationId,
    input.claim.causeStreamCommitId,
    input.claim.causeStreamPosition,
    input.claim.correlationId,
    input.claim.causedAt,
    ...materializationReservationAuthorityHashParts(input.claim),
    leaseGeneration,
    "failed",
    input.safeReasonId,
    String(input.retryable),
    input.contentFence.resultingAttachmentRevision,
    input.contentFence.resultingContentRevision
  );
  if (
    state === "failed" &&
    isExactTerminalMaterializationClaim(row, input.claim, input.contentFence) &&
    row.result_file_version_id === null &&
    row.result_object_version_id === null &&
    row.result_file_revision === null &&
    nullableCounter(row.result_content_revision, "result content revision") ===
      input.contentFence.resultingContentRevision &&
    row.terminal_reason_id === input.safeReasonId &&
    row.file_state === "pending" &&
    String(row.file_revision) === input.claim.expectedFileRevision &&
    row.file_current_file_version_id === null &&
    row.file_current_object_version_id === null &&
    String(row.attachment_revision) ===
      input.contentFence.resultingAttachmentRevision &&
    isExactTerminalContentPayload(
      row,
      input.contentFence,
      "failed",
      input.claim,
      input.safeReasonId
    ) &&
    isExactTerminalMaterializationEvidence(row, {
      claim: input.claim,
      contentFence: input.contentFence,
      leaseGeneration,
      outcome: "failed",
      evidenceId: materializationEvidenceId,
      resultingFileRevision: null,
      operationEvidenceId: null,
      safeReasonId: input.safeReasonId,
      retryable: input.retryable,
      evidenceHashSha256
    })
  ) {
    return "already_applied";
  }
  return "state_conflict";
}

function isExactTerminalMaterializationClaim(
  row: MaterializationFinalizationRow,
  claim: InboxV2AttachmentMaterializationClaim,
  fence: InboxV2AttachmentMaterializationContentFence
): boolean {
  const expectedAttachmentRevision = incrementCounter(
    fence.resultingAttachmentRevision,
    -1
  );
  const expectedContentRevision = incrementCounter(
    fence.resultingContentRevision,
    -1
  );
  const expectedLeaseHash = calculateMaterializationLeaseHash(claim);
  return (
    row.job_id === claim.jobId &&
    String(row.job_revision) === incrementCounter(claim.expectedJobRevision) &&
    row.attachment_id === claim.attachmentId &&
    claim.attachmentId === fence.attachmentId &&
    row.file_id === claim.fileId &&
    String(row.expected_file_revision) === claim.expectedFileRevision &&
    row.conversation_id === claim.contentOrigin.conversationId &&
    row.timeline_item_id === claim.contentOrigin.timelineItemId &&
    row.parent_message_id === claim.contentOrigin.parentEntityId &&
    String(row.expected_parent_revision) ===
      claim.contentOrigin.expectedParentRevision &&
    row.visibility_boundary === claim.contentOrigin.visibilityBoundary &&
    String(row.expected_attachment_revision) ===
      claim.contentOrigin.expectedAttachmentRevision &&
    expectedAttachmentRevision ===
      claim.contentOrigin.expectedAttachmentRevision &&
    row.timeline_content_id === claim.contentOrigin.timelineContentId &&
    claim.contentOrigin.timelineContentId === fence.timelineContentId &&
    String(row.expected_content_revision) ===
      claim.contentOrigin.expectedContentRevision &&
    BigInt(expectedContentRevision) >=
      BigInt(claim.contentOrigin.expectedContentRevision) &&
    row.content_block_key === claim.contentOrigin.contentBlockKey &&
    claim.contentOrigin.contentBlockKey === fence.contentBlockKey &&
    row.content_mutation_fence_sha256 ===
      calculateInboxV2AttachmentContentMutationFenceSha256({
        tenantId: claim.tenantId,
        attachmentId: fence.attachmentId,
        expectedAttachmentRevision,
        timelineContentId: fence.timelineContentId,
        expectedContentRevision: claim.contentOrigin.expectedContentRevision,
        contentBlockKey: fence.contentBlockKey
      }) &&
    row.source_occurrence_id === claim.sourceOccurrenceId &&
    row.source_locator_kind === claim.sourceLocator.kind &&
    row.source_locator_reference === claim.sourceLocator.reference &&
    row.source_locator_digest_sha256 ===
      deriveRawSha256(
        "core:inbox-v2.attachment-source-locator@v1",
        claim.tenantId,
        claim.sourceLocator.kind,
        claim.sourceLocator.reference
      ) &&
    row.reservation_namespace_generation ===
      claim.reservationNamespaceGeneration &&
    row.cause_event_id === claim.causeEventId &&
    row.cause_mutation_id === claim.causeMutationId &&
    row.cause_stream_commit_id === claim.causeStreamCommitId &&
    String(row.cause_stream_position) === claim.causeStreamPosition &&
    row.correlation_id === claim.correlationId &&
    timestampEquals(row.caused_at, claim.causedAt) &&
    isExactMaterializationReservationAuthority(row, claim) &&
    row.reserved_file_version_id === claim.fileVersionId &&
    row.reserved_object_version_id === claim.objectVersionId &&
    row.reserved_storage_root_id === claim.storageRootId &&
    row.reserved_storage_object_key === claim.storageKey &&
    row.lease_token_hash === null &&
    row.lease_expires_at === null &&
    row.attempt_id === claim.attemptId &&
    row.attempt_job_id === claim.jobId &&
    row.attempt_attachment_id === fence.attachmentId &&
    row.attempt_file_id === claim.fileId &&
    String(row.attempt_lease_generation) === claim.leaseGeneration &&
    String(row.lease_generation) === claim.leaseGeneration &&
    row.attempt_lease_token_hash === expectedLeaseHash &&
    row.attempt_lease_owner_id === claim.workerId &&
    String(row.attempt_expected_job_revision) === claim.expectedJobRevision &&
    String(row.attempt_expected_file_revision) === claim.expectedFileRevision &&
    String(row.attempt_expected_attachment_revision) ===
      expectedAttachmentRevision &&
    timestampEquals(row.attempt_claimed_at, claim.claimedAt) &&
    timestampEquals(row.attempt_lease_expires_at, claim.leaseExpiresAt) &&
    row.file_data_class_id === claim.dataClassId &&
    claim.dataClassId === fence.dataClassId &&
    row.file_processing_purpose_id === claim.processingPurposeId &&
    claim.processingPurposeId === fence.processingPurposeId &&
    timestampEquals(row.file_retention_anchor_at, claim.retentionAnchorAt) &&
    normalizeTimestamp(claim.retentionAnchorAt) ===
      normalizeTimestamp(fence.retentionAnchorAt)
  );
}

function isExactMaterializationReservationAuthority(
  row: MaterializationFinalizationRow,
  claim: InboxV2AttachmentMaterializationClaim
): boolean {
  const authority = claim.reservationAuthority;
  return (
    row.authorization_command_id === authority.commandId &&
    row.authorization_command_type_id === authority.commandTypeId &&
    row.authorization_client_mutation_id === authority.clientMutationId &&
    row.authorization_mutation_id === authority.mutationId &&
    row.authorization_decision_id === authority.decisionId &&
    row.authorization_epoch === authority.epoch &&
    row.authorization_actor_kind === authority.actor.kind &&
    row.authorization_actor_id ===
      materializationAuthorityActorId(authority.actor) &&
    timestampEquals(row.authorization_authorized_at, authority.authorizedAt) &&
    row.authorization_decision_set_digest_sha256 ===
      authority.decisionSetDigestSha256 &&
    row.authorization_resource_fence_set_digest_sha256 ===
      authority.resourceFenceSetDigestSha256 &&
    String(row.authorization_tenant_rbac_revision) ===
      authority.tenantRbacRevision &&
    String(row.authorization_shared_access_revision) ===
      authority.sharedAccessRevision &&
    row.authorization_resource_head_id === authority.resourceHeadId &&
    String(row.authorization_resource_access_revision) ===
      authority.resourceAccessRevision &&
    String(row.authorization_structural_relation_revision) ===
      authority.structuralRelationRevision &&
    String(row.authorization_collaborator_set_revision) ===
      authority.collaboratorSetRevision &&
    sameStringArray(
      row.authorization_audit_grant_source_ids,
      authority.auditGrantSourceIds
    ) &&
    row.authorization_audit_policy_version === authority.auditPolicyVersion
  );
}

function materializationReservationAuthorityHashParts(
  claim: InboxV2AttachmentMaterializationClaim
): readonly string[] {
  const authority = claim.reservationAuthority;
  return [
    authority.commandId,
    authority.commandTypeId,
    authority.clientMutationId,
    authority.mutationId,
    authority.decisionId,
    authority.epoch,
    authority.actor.kind,
    materializationAuthorityActorId(authority.actor),
    authority.authorizedAt,
    authority.decisionSetDigestSha256,
    authority.resourceFenceSetDigestSha256,
    authority.tenantRbacRevision,
    authority.sharedAccessRevision,
    authority.resourceHeadId,
    authority.resourceAccessRevision,
    authority.structuralRelationRevision,
    authority.collaboratorSetRevision,
    canonicalizeInboxV2Json(authority.auditGrantSourceIds),
    authority.auditPolicyVersion ?? "-"
  ];
}

function isExactTerminalContentPayload(
  row: MaterializationFinalizationRow,
  fence: InboxV2AttachmentMaterializationContentFence,
  outcome: "ready" | "failed",
  claim: InboxV2AttachmentMaterializationClaim,
  safeReasonId: string | null
): boolean {
  const expectedVisibility =
    fence.visibilityBoundary === "external_work"
      ? "conversation_external"
      : fence.visibilityBoundary === "internal"
        ? "internal_participants"
        : "staff_only";
  return (
    row.terminal_content_id === fence.timelineContentId &&
    String(row.terminal_content_revision) === fence.resultingContentRevision &&
    row.terminal_content_transition_kind === "attachment_materialization" &&
    row.terminal_payload_attachment_id === fence.attachmentId &&
    row.terminal_payload_attachment_state === outcome &&
    row.terminal_payload_block_key === fence.contentBlockKey &&
    row.terminal_owner_kind === fence.parentKind &&
    row.terminal_owner_id === fence.parentEntityId &&
    row.terminal_conversation_id === fence.conversationId &&
    row.terminal_timeline_item_id === fence.timelineItemId &&
    String(row.terminal_parent_entity_revision) ===
      fence.parentEntityRevision &&
    row.terminal_timeline_visibility === expectedVisibility &&
    (outcome === "ready"
      ? row.terminal_payload_file_id === claim.fileId &&
        String(row.terminal_payload_file_revision) ===
          incrementCounter(claim.expectedFileRevision) &&
        row.terminal_payload_file_version_id === claim.fileVersionId &&
        row.terminal_payload_object_version_id === claim.objectVersionId &&
        row.terminal_payload_failure_reason_id === null
      : row.terminal_payload_file_id === null &&
        row.terminal_payload_file_revision === null &&
        row.terminal_payload_file_version_id === null &&
        row.terminal_payload_object_version_id === null &&
        row.terminal_payload_failure_reason_id === safeReasonId)
  );
}

function isExactTerminalMaterializationEvidence(
  row: MaterializationFinalizationRow,
  expected: Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    contentFence: InboxV2AttachmentMaterializationContentFence;
    leaseGeneration: string;
    outcome: "ready" | "failed";
    evidenceId: string;
    resultingFileRevision: string | null;
    operationEvidenceId: string | null;
    safeReasonId: string | null;
    retryable: boolean | null;
    evidenceHashSha256: string;
  }>
): boolean {
  const expectedAttachmentRevision =
    expected.claim.contentOrigin.expectedAttachmentRevision;
  const expectedContentRevision = incrementCounter(
    expected.contentFence.resultingContentRevision,
    -1
  );
  return (
    row.replay_evidence_id === expected.evidenceId &&
    row.replay_evidence_job_id === expected.claim.jobId &&
    row.replay_evidence_attempt_id === expected.claim.attemptId &&
    row.replay_evidence_attachment_id === expected.claim.attachmentId &&
    row.replay_evidence_file_id === expected.claim.fileId &&
    String(row.replay_evidence_expected_file_revision) ===
      expected.claim.expectedFileRevision &&
    String(row.replay_evidence_lease_generation) === expected.leaseGeneration &&
    String(row.replay_evidence_expected_attachment_revision) ===
      expectedAttachmentRevision &&
    String(row.replay_evidence_resulting_attachment_revision) ===
      expected.contentFence.resultingAttachmentRevision &&
    row.replay_evidence_content_id ===
      expected.claim.contentOrigin.timelineContentId &&
    String(row.replay_evidence_expected_content_revision) ===
      expectedContentRevision &&
    String(row.replay_evidence_resulting_content_revision) ===
      expected.contentFence.resultingContentRevision &&
    row.replay_evidence_content_fence_sha256 ===
      calculateInboxV2AttachmentContentMutationFenceSha256({
        tenantId: expected.claim.tenantId,
        attachmentId: expected.claim.attachmentId,
        expectedAttachmentRevision,
        timelineContentId: expected.claim.contentOrigin.timelineContentId,
        expectedContentRevision:
          expected.claim.contentOrigin.expectedContentRevision,
        contentBlockKey: expected.claim.contentOrigin.contentBlockKey
      }) &&
    row.replay_evidence_outcome === expected.outcome &&
    row.replay_evidence_file_version_id ===
      (expected.outcome === "ready" ? expected.claim.fileVersionId : null) &&
    row.replay_evidence_object_version_id ===
      (expected.outcome === "ready" ? expected.claim.objectVersionId : null) &&
    nullableCounter(
      row.replay_evidence_resulting_file_revision,
      "evidence resulting file revision"
    ) === expected.resultingFileRevision &&
    row.replay_evidence_operation_id === expected.operationEvidenceId &&
    row.replay_evidence_safe_reason_id === expected.safeReasonId &&
    row.replay_evidence_retryable === expected.retryable &&
    row.replay_evidence_hash_sha256 === expected.evidenceHashSha256
  );
}

function timestampEquals(actual: unknown, expected: string): boolean {
  try {
    return (
      requiredTimestamp(actual, "replay timestamp") ===
      normalizeTimestamp(expected)
    );
  } catch {
    return false;
  }
}

function classifyLiveMaterializationLease(
  row: MaterializationFinalizationRow,
  claim: InboxV2AttachmentMaterializationClaim
): InboxV2NonAppliedAttachmentMaterializationResult | null {
  const state = requiredString(row.job_state, "materialization job state");
  if (!new Set(["claimed", "transferring", "verifying"]).has(state)) {
    return "state_conflict";
  }
  const leaseHash = calculateMaterializationLeaseHash(claim);
  const expiresAt = nullableTimestamp(row.lease_expires_at, "lease expiry");
  const databaseNow = requiredTimestamp(row.database_now, "database clock");
  if (
    row.attempt_id !== claim.attemptId ||
    row.lease_token_hash !== leaseHash ||
    row.attempt_lease_token_hash !== leaseHash ||
    String(row.lease_generation) !== claim.leaseGeneration ||
    String(row.attempt_lease_generation) !== claim.leaseGeneration ||
    row.attempt_lease_owner_id !== claim.workerId ||
    row.lease_owner_id !== claim.workerId ||
    row.attempt_attachment_id !== claim.attachmentId ||
    String(row.job_revision) !== claim.expectedJobRevision ||
    String(row.attempt_expected_job_revision) !== claim.expectedJobRevision ||
    String(row.attempt_expected_file_revision) !== claim.expectedFileRevision ||
    String(row.attempt_expected_attachment_revision) !==
      String(row.expected_attachment_revision) ||
    expiresAt === null ||
    Date.parse(expiresAt) <= Date.parse(databaseNow)
  ) {
    return "lease_lost";
  }
  return null;
}

function isExpectedMaterializationFileFence(
  row: MaterializationFinalizationRow,
  claim: InboxV2AttachmentMaterializationClaim
): boolean {
  return (
    row.job_id === claim.jobId &&
    row.attachment_id === claim.attachmentId &&
    row.file_id === claim.fileId &&
    String(row.expected_file_revision) === claim.expectedFileRevision &&
    row.reserved_file_version_id === claim.fileVersionId &&
    row.reserved_object_version_id === claim.objectVersionId &&
    row.reserved_storage_root_id === claim.storageRootId &&
    row.reserved_storage_object_key === claim.storageKey &&
    row.source_occurrence_id === claim.sourceOccurrenceId &&
    row.source_locator_kind === claim.sourceLocator.kind &&
    row.source_locator_reference === claim.sourceLocator.reference &&
    row.reservation_namespace_generation ===
      claim.reservationNamespaceGeneration &&
    row.conversation_id === claim.contentOrigin.conversationId &&
    row.timeline_item_id === claim.contentOrigin.timelineItemId &&
    row.parent_message_id === claim.contentOrigin.parentEntityId &&
    String(row.expected_parent_revision) ===
      claim.contentOrigin.expectedParentRevision &&
    row.visibility_boundary === claim.contentOrigin.visibilityBoundary &&
    row.cause_event_id === claim.causeEventId &&
    row.cause_mutation_id === claim.causeMutationId &&
    row.cause_stream_commit_id === claim.causeStreamCommitId &&
    String(row.cause_stream_position) === claim.causeStreamPosition &&
    row.correlation_id === claim.correlationId &&
    timestampEquals(row.caused_at, claim.causedAt) &&
    isExactMaterializationReservationAuthority(row, claim) &&
    row.file_state === "pending" &&
    String(row.file_revision) === claim.expectedFileRevision
  );
}

function isExpectedContentFenceBase(
  row: MaterializationFinalizationRow,
  claim: InboxV2AttachmentMaterializationClaim,
  fence: InboxV2AttachmentMaterializationContentFence
): boolean {
  const expectedAttachmentRevision = incrementCounter(
    fence.resultingAttachmentRevision,
    -1
  );
  const expectedContentRevision = incrementCounter(
    fence.resultingContentRevision,
    -1
  );
  return (
    fence.tenantId === claim.tenantId &&
    row.attachment_id === claim.attachmentId &&
    claim.attachmentId === fence.attachmentId &&
    String(row.expected_attachment_revision) ===
      claim.contentOrigin.expectedAttachmentRevision &&
    expectedAttachmentRevision ===
      claim.contentOrigin.expectedAttachmentRevision &&
    String(row.attachment_revision) === expectedAttachmentRevision &&
    row.conversation_id === claim.contentOrigin.conversationId &&
    claim.contentOrigin.conversationId === fence.conversationId &&
    row.timeline_item_id === claim.contentOrigin.timelineItemId &&
    claim.contentOrigin.timelineItemId === fence.timelineItemId &&
    row.parent_message_id === claim.contentOrigin.parentEntityId &&
    claim.contentOrigin.parentEntityId === fence.parentEntityId &&
    String(row.expected_parent_revision) ===
      claim.contentOrigin.expectedParentRevision &&
    BigInt(fence.parentEntityRevision) - 1n >=
      BigInt(claim.contentOrigin.expectedParentRevision) &&
    row.visibility_boundary === claim.contentOrigin.visibilityBoundary &&
    claim.contentOrigin.visibilityBoundary === fence.visibilityBoundary &&
    row.timeline_content_id === claim.contentOrigin.timelineContentId &&
    claim.contentOrigin.timelineContentId === fence.timelineContentId &&
    String(row.expected_content_revision) ===
      claim.contentOrigin.expectedContentRevision &&
    BigInt(expectedContentRevision) >=
      BigInt(claim.contentOrigin.expectedContentRevision) &&
    row.content_block_key === claim.contentOrigin.contentBlockKey &&
    claim.contentOrigin.contentBlockKey === fence.contentBlockKey &&
    row.content_mutation_fence_sha256 ===
      calculateInboxV2AttachmentContentMutationFenceSha256({
        tenantId: claim.tenantId,
        attachmentId: fence.attachmentId,
        expectedAttachmentRevision,
        timelineContentId: fence.timelineContentId,
        expectedContentRevision: claim.contentOrigin.expectedContentRevision,
        contentBlockKey: fence.contentBlockKey
      }) &&
    row.file_data_class_id === claim.dataClassId &&
    claim.dataClassId === fence.dataClassId &&
    row.file_processing_purpose_id === claim.processingPurposeId &&
    claim.processingPurposeId === fence.processingPurposeId &&
    requiredTimestamp(row.file_retention_anchor_at, "file retention anchor") ===
      normalizeTimestamp(claim.retentionAnchorAt) &&
    normalizeTimestamp(claim.retentionAnchorAt) ===
      normalizeTimestamp(fence.retentionAnchorAt)
  );
}

function isReadyMaterializationContentFence(
  row: MaterializationContentFenceRow,
  claim: InboxV2AttachmentMaterializationClaim,
  fence: InboxV2AttachmentMaterializationContentFence
): boolean {
  return (
    isExactMaterializationParentFence(row, fence) &&
    row.attachment_state === "ready" &&
    row.attachment_v2_file_id === claim.fileId &&
    String(row.attachment_file_revision) ===
      incrementCounter(claim.expectedFileRevision) &&
    row.attachment_file_version_id === claim.fileVersionId &&
    row.attachment_object_version_id === claim.objectVersionId &&
    row.attachment_failure_reason_id === null
  );
}

function isFailedMaterializationContentFence(
  row: MaterializationContentFenceRow,
  fence: InboxV2AttachmentMaterializationContentFence,
  safeReasonId: string
): boolean {
  return (
    isExactMaterializationParentFence(row, fence) &&
    row.attachment_state === "failed" &&
    row.attachment_v2_file_id === null &&
    row.attachment_file_version_id === null &&
    row.attachment_object_version_id === null &&
    row.attachment_failure_reason_id === safeReasonId
  );
}

function isExactMaterializationParentFence(
  row: MaterializationContentFenceRow,
  fence: InboxV2AttachmentMaterializationContentFence
): boolean {
  const expectedVisibility =
    fence.visibilityBoundary === "external_work"
      ? "conversation_external"
      : fence.visibilityBoundary === "internal"
        ? "internal_participants"
        : "staff_only";
  return (
    row.content_id === fence.timelineContentId &&
    String(row.content_revision) === fence.resultingContentRevision &&
    row.transition_kind === "attachment_materialization" &&
    row.attachment_id === fence.attachmentId &&
    row.block_key === fence.contentBlockKey &&
    row.owner_kind === fence.parentKind &&
    row.owner_id === fence.parentEntityId &&
    row.conversation_id === fence.conversationId &&
    row.timeline_item_id === fence.timelineItemId &&
    String(row.parent_entity_revision) === fence.parentEntityRevision &&
    row.timeline_visibility === expectedVisibility
  );
}

function calculateMaterializationLeaseHash(
  claim: InboxV2AttachmentMaterializationClaim
): string {
  return deriveRawSha256(
    "core:inbox-v2.attachment-materialization-lease@v1",
    claim.tenantId,
    claim.leaseToken
  );
}

function calculateParentIdentityDigest(
  claim: InboxV2AttachmentMaterializationClaim,
  fence: InboxV2AttachmentMaterializationContentFence
): string {
  return calculateInboxV2FileParentIdentityDigest({
    tenantId: claim.tenantId,
    fileId: claim.fileId,
    fileVersionId: claim.fileVersionId,
    objectVersionId: claim.objectVersionId,
    expectedParentSetRevision: "1",
    parent: {
      kind: fence.parentKind,
      purpose: "attachment",
      visibilityBoundary: fence.visibilityBoundary,
      parentConversationVisibility: fence.parentConversationVisibility,
      entityId: fence.parentEntityId,
      entityRevision: fence.parentEntityRevision,
      conversationId: fence.conversationId,
      timelineItemId: fence.timelineItemId,
      contentId: fence.timelineContentId,
      contentRevision: fence.resultingContentRevision,
      blockKey: fence.contentBlockKey
    },
    dataClassId: fence.dataClassId,
    processingPurposeId: fence.processingPurposeId,
    retentionAnchorAt: fence.retentionAnchorAt
  });
}

type NormalizedStorageOrphan = RecordInboxV2StorageOrphanInput &
  Readonly<{
    claim: InboxV2AttachmentMaterializationClaim;
    orphanId: string;
    rawChecksumSha256: string;
    normalizedQuarantine: Readonly<{
      reasonCode: string;
      evidenceDigestSha256: string;
      physicalKind: string;
    }> | null;
  }>;

function normalizeStorageOrphan(
  input: RecordInboxV2StorageOrphanInput
): NormalizedStorageOrphan {
  const claim = normalizeMaterializationClaim(input.claim);
  assertCatalogId(input.storageRootId, "orphan storage root");
  if (input.storageRootId !== claim.storageRootId) {
    throw new TypeError("Orphan storage root differs from the claimed root.");
  }
  if (input.identity.storageKey !== claim.storageKey) {
    throw new TypeError("Orphan storage key differs from the claimed key.");
  }
  assertBoundedOpaque(input.identity.storageKey, 2_048, "orphan storage key");
  assertBoundedOpaque(
    input.identity.versionId,
    1_024,
    "orphan version identity"
  );
  assertByteSize(input.sizeBytes, "orphan size");
  assertMediaType(input.mediaType);
  assertBoundedOpaque(input.reasonCode, 120, "orphan reason code");
  const rawChecksumSha256 = normalizeSha256(input.checksumSha256);
  const normalizedQuarantine =
    input.quarantine === null
      ? null
      : {
          reasonCode: input.quarantine.reasonCode,
          evidenceDigestSha256: normalizeSha256(
            input.quarantine.evidenceSha256
          ),
          physicalKind: input.quarantine.physicalKind
        };
  if (normalizedQuarantine !== null) {
    assertBoundedOpaque(
      normalizedQuarantine.reasonCode,
      120,
      "quarantine reason code"
    );
    assertToken(normalizedQuarantine.reasonCode, "quarantine reason code");
    assertBoundedOpaque(
      normalizedQuarantine.physicalKind,
      120,
      "quarantine physical kind"
    );
    assertToken(normalizedQuarantine.physicalKind, "quarantine physical kind");
  }
  return {
    ...input,
    claim,
    rawChecksumSha256,
    normalizedQuarantine,
    orphanId: deriveInboxV2StorageOrphanId({
      tenantId: claim.tenantId,
      storageRootId: input.storageRootId,
      storageKey: input.identity.storageKey,
      storageVersionIdentity: input.identity.versionId
    })
  };
}

function isExactStorageOrphanReplay(
  row: StorageOrphanRow,
  input: NormalizedStorageOrphan
): boolean {
  return (
    row.id === input.orphanId &&
    row.materialization_job_id === input.claim.jobId &&
    row.storage_root_id === input.storageRootId &&
    row.storage_object_key === input.identity.storageKey &&
    row.storage_version_identity === input.identity.versionId &&
    row.checksum_sha256 === input.rawChecksumSha256 &&
    String(row.size_bytes) === String(input.sizeBytes) &&
    row.detected_media_type === input.mediaType &&
    row.state ===
      (input.normalizedQuarantine === null ? "open" : "quarantined") &&
    row.quarantine_reason_code ===
      (input.normalizedQuarantine?.reasonCode ?? null) &&
    row.quarantine_evidence_digest_sha256 ===
      (input.normalizedQuarantine?.evidenceDigestSha256 ?? null) &&
    row.quarantine_physical_kind ===
      (input.normalizedQuarantine?.physicalKind ?? null)
  );
}

export function deriveInboxV2AttachmentMaterializationFailureReasonId(
  code: string
): string {
  const safe = code
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "_")
    .replace(/^[^a-z]+/u, "")
    .slice(0, 120);
  const suffix = safe.length === 0 ? "unknown" : safe;
  return `core:attachment_materialization_failure.${suffix}`;
}

function isTerminalMaterializationState(state: string): boolean {
  return new Set(["ready", "failed", "quarantined", "cancelled"]).has(state);
}

async function expectOneRow(
  executor: RawSqlExecutor,
  query: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length !== 1) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_cas_failed",
      `${operation} affected ${result.rows.length} rows.`
    );
  }
}

async function expectMaterializationTerminalJobCas(
  executor: RawSqlExecutor,
  query: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length === 0) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.materialization_lease_lost_at_seal",
      `${operation} lost its live lease before the terminal write.`
    );
  }
  if (result.rows.length !== 1) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_cas_failed",
      `${operation} affected ${result.rows.length} rows.`
    );
  }
}

function incrementCounter(value: string, increment = 1): string {
  const result = BigInt(value) + BigInt(increment);
  if (result < 1n) throw new TypeError("Counter result must remain positive.");
  return result.toString();
}

function normalizeSha256(value: string): string {
  const raw = value.startsWith("sha256:") ? value.slice(7) : value;
  if (!/^[a-f0-9]{64}$/u.test(raw)) {
    throw new TypeError("SHA-256 evidence must be canonical lowercase hex.");
  }
  return raw;
}

function normalizeTimestamp(value: string): string {
  return new Date(value).toISOString();
}

function nullableTimestamp(value: unknown, field: string): string | null {
  return value === null ? null : requiredTimestamp(value, field);
}

function assertPositiveCounter(value: string, field: string): void {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    throw new TypeError(`${field} must be a positive decimal counter.`);
  }
}

function assertCatalogId(value: string, field: string): void {
  if (
    value.length > 256 ||
    !/^(?:core:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*|module:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*:[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*)$/u.test(
      value
    )
  ) {
    throw new TypeError(`${field} must be a namespaced catalog id.`);
  }
}

function assertTimestamp(value: string, field: string): void {
  if (!Number.isFinite(Date.parse(value))) {
    throw new TypeError(`${field} must be a finite timestamp.`);
  }
}

function assertBlockKey(value: string): void {
  if (
    value.length < 1 ||
    value.length > 80 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]*$/u.test(value)
  ) {
    throw new TypeError("Content block key is invalid.");
  }
}

function assertRawSha256(value: string, field: string): void {
  if (!/^[a-f0-9]{64}$/u.test(value)) {
    throw new TypeError(`${field} must be a raw lowercase SHA-256 digest.`);
  }
}

function assertBoundedOpaque(
  value: string,
  maximumLength: number,
  field: string
): void {
  if (
    value.length < 1 ||
    value.length > maximumLength ||
    !/\S/u.test(value) ||
    [...value].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint <= 31 || codePoint === 127;
    })
  ) {
    throw new TypeError(`${field} is blank, unbounded or contains controls.`);
  }
}

function assertToken(value: string, field: string): void {
  if (
    value.length < 8 ||
    value.length > 256 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u.test(value)
  ) {
    throw new TypeError(`${field} must be a bounded opaque token.`);
  }
}

function assertCorrelationId(value: string): void {
  if (
    value.length < 1 ||
    value.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u.test(value)
  ) {
    throw new TypeError(
      "Materialization correlation id must be a canonical safe token."
    );
  }
}

function assertByteSize(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  }
}

function assertMediaType(value: string): void {
  if (
    value.length < 3 ||
    value.length > 255 ||
    !/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/u.test(value)
  ) {
    throw new TypeError("Media type is invalid.");
  }
}

export class InboxV2FileObjectPersistenceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "InboxV2FileObjectPersistenceError";
  }
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

function assertBrandedId(value: string, prefix: string): string {
  if (
    value.length > 256 ||
    !new RegExp(`^${prefix}:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$`, "u").test(
      value
    )
  ) {
    throw new TypeError(`Invalid ${prefix} identifier.`);
  }
  return value;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a non-empty string.`
    );
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : requiredString(value, field);
}

function requiredStringArray(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a non-empty string array.`
    );
  }
  return value.map((item, index) => requiredString(item, `${field}[${index}]`));
}

function sameStringArray(value: unknown, expected: readonly string[]): boolean {
  return (
    Array.isArray(value) &&
    value.length === expected.length &&
    value.every((item, index) => item === expected[index])
  );
}

function requiredNumber(value: unknown, field: string): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(numeric) || numeric < 0) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a non-negative safe integer.`
    );
  }
  return numeric;
}

function requiredCounter(value: unknown, field: string): string {
  const text = typeof value === "bigint" ? value.toString() : String(value);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a positive counter.`
    );
  }
  return text;
}

function nullableCounter(value: unknown, field: string): string | null {
  return value === null ? null : requiredCounter(value, field);
}

function requiredRawSha256(value: unknown, field: string): string {
  const digest = requiredString(value, field);
  if (!/^[a-f0-9]{64}$/u.test(digest)) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a raw SHA-256 digest.`
    );
  }
  return digest;
}

function requiredHmacSha256(value: unknown, field: string): string {
  const digest = requiredString(value, field);
  if (!/^hmac-sha256:[a-f0-9]{64}$/u.test(digest)) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a tenant-keyed HMAC-SHA-256 fingerprint.`
    );
  }
  return digest;
}

function requiredTimestamp(value: unknown, field: string): string {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString();
  }
  const text = requiredString(value, field);
  if (!Number.isFinite(Date.parse(text))) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be a finite timestamp.`
    );
  }
  return new Date(text).toISOString();
}

function requiredEnum<const T extends readonly string[]>(
  value: unknown,
  field: string,
  values: T
): T[number] {
  const text = requiredString(value, field);
  if (!values.includes(text)) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_row_invalid",
      `Expected ${field} to be one of ${values.join(", ")}.`
    );
  }
  return text;
}

function assertAtMostOneRow(rows: readonly unknown[], operation: string): void {
  if (rows.length > 1) {
    throw new InboxV2FileObjectPersistenceError(
      "inbox_v2.file_object_cardinality_invalid",
      `${operation} returned ${rows.length} rows.`
    );
  }
}
