import {
  calculateInboxV2SourceProcessingLeaseTokenHash,
  inboxV2RoutingTokenSchema,
  inboxV2SourceProcessingRuntimeClaimSchema,
  inboxV2TenantIdSchema,
  type InboxV2SourceProcessingRuntimeClaim
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { RawSqlExecutor } from "./sql-outbox-repository";
import type { ReserveInboxV2AttachmentMaterializationInput } from "./sql-inbox-v2-file-object-repository";

const MATERIALIZATION_ANCHOR_LIMIT = 64;
const sqlSourceAttachmentMaterializationRepositories = new WeakSet<object>();
const sqlSourceAttachmentMaterializationRepositoryExecutors = new WeakMap<
  object,
  object
>();

export type InboxV2SourceAttachmentMaterializationOrigin = Readonly<{
  tenantId: string;
  workId: string;
  normalizedEventId: string;
  sourceOccurrenceId: string;
  conversationId: string;
  timelineItemId: string;
  messageId: string;
  messageRevision: string;
  timelineContentId: string;
  contentRevision: string;
  visibilityBoundary: "external_work" | "internal";
  dataClassId: string;
  processingPurposeId: string;
  retentionAnchorAt: string;
  causeEventId: string;
  causeMutationId: string;
  causeStreamCommitId: string;
  causeStreamPosition: string;
  correlationId: string;
  causedAt: string;
}>;

export type InboxV2SourceAttachmentMaterializationAnchor = Readonly<{
  ordinal: number;
  blockKey: string;
  attachmentId: string;
  attachmentRevision: string;
}>;

export type InboxV2SourceAttachmentMaterializationPlan = Readonly<{
  origin: InboxV2SourceAttachmentMaterializationOrigin;
  anchors: readonly InboxV2SourceAttachmentMaterializationAnchor[];
}>;

export type InboxV2LoadSourceAttachmentMaterializationPlanResult =
  | Readonly<{
      kind: "selected";
      plan: InboxV2SourceAttachmentMaterializationPlan;
    }>
  | Readonly<{ kind: "no_materializable_message" }>
  | Readonly<{ kind: "lease_lost" }>
  | Readonly<{ kind: "reconciliation_missing" }>;

export type InboxV2VerifySourceAttachmentMaterializationResult =
  | Readonly<{ kind: "complete"; attachmentCount: number }>
  | Readonly<{ kind: "incomplete"; attachmentCount: number }>
  | Readonly<{ kind: "lease_lost" }>;

export type InboxV2SourceAttachmentNamespaceRetirementDrainObservation =
  Readonly<{
    kind: "drained_observed" | "blocked_observed";
    tenantId: string;
    reservationNamespaceGeneration: string;
    nonterminalJobCount: string;
    unfinishedMaterializationWorkCount: string;
  }>;

export type InboxV2SourceAttachmentMaterializationRepository = Readonly<{
  loadPlan(
    claim: InboxV2SourceProcessingRuntimeClaim
  ): Promise<InboxV2LoadSourceAttachmentMaterializationPlanResult>;
  verifyExactReservationSet(input: {
    claim: InboxV2SourceProcessingRuntimeClaim;
    plan: InboxV2SourceAttachmentMaterializationPlan;
    reservations: readonly ReserveInboxV2AttachmentMaterializationInput[];
  }): Promise<InboxV2VerifySourceAttachmentMaterializationResult>;
  /**
   * Read-only drain observation, never a retirement capability or receipt.
   * Unfinished source work is counted even when it has not yet created its
   * first reservation, closing the crash-before-first-job visibility gap.
   * Key removal remains forbidden until MIG-002 owns a durable all-replica
   * admission pause plus a serialized drain receipt.
   */
  observeReservationNamespaceRetirementDrain(input: {
    tenantId: string;
    reservationNamespaceGeneration: string;
  }): Promise<InboxV2SourceAttachmentNamespaceRetirementDrainObservation>;
}>;

type PlanRow = Readonly<
  Record<string, unknown> & {
    work_id: unknown;
    normalized_event_id: unknown;
    source_occurrence_id: unknown;
    conversation_id: unknown;
    timeline_item_id: unknown;
    message_id: unknown;
    message_revision: unknown;
    timeline_content_id: unknown;
    content_revision: unknown;
    timeline_visibility: unknown;
    data_class_id: unknown;
    processing_purpose_id: unknown;
    retention_anchor_at: unknown;
    cause_event_id: unknown;
    cause_mutation_id: unknown;
    cause_stream_commit_id: unknown;
    cause_stream_position: unknown;
    correlation_id: unknown;
    caused_at: unknown;
    reconciled_count: unknown;
    raw_pending_count: unknown;
    anchor_ordinal: unknown;
    block_key: unknown;
    attachment_id: unknown;
    attachment_revision: unknown;
  }
>;

type ClassificationRow = Readonly<{
  live_lease: unknown;
  has_message_reconciliation: unknown;
  has_terminal_content_tombstone: unknown;
  terminal_deferred_action: unknown;
}> &
  Record<string, unknown>;

type VerificationRow = Readonly<{
  pending_count: unknown;
  expected_count: unknown;
  pending_expected_count: unknown;
  exact_job_count: unknown;
}> &
  Record<string, unknown>;

type NamespaceRetirementDrainRow = Readonly<{
  nonterminal_job_count: unknown;
  unfinished_materialization_work_count: unknown;
}> &
  Record<string, unknown>;

export function createSqlInboxV2SourceAttachmentMaterializationRepository(
  executor: RawSqlExecutor
): InboxV2SourceAttachmentMaterializationRepository {
  const repository: InboxV2SourceAttachmentMaterializationRepository =
    Object.freeze({
      async loadPlan(rawClaim: InboxV2SourceProcessingRuntimeClaim) {
        const claim = parseMaterializationClaim(rawClaim);
        const result = await executor.execute<PlanRow>(
          buildLoadInboxV2SourceAttachmentMaterializationPlanSql(claim)
        );
        if (result.rows.length === 0) {
          const classification = await executor.execute<ClassificationRow>(
            buildClassifyInboxV2SourceAttachmentMaterializationAbsenceSql(claim)
          );
          const row = exactlyOne(
            classification.rows,
            "materialization absence"
          );
          if (row.live_lease !== true) return { kind: "lease_lost" };
          return row.has_terminal_content_tombstone === true ||
            (row.terminal_deferred_action === true &&
              row.has_message_reconciliation !== true)
            ? { kind: "no_materializable_message" }
            : { kind: "reconciliation_missing" };
        }
        return {
          kind: "selected",
          plan: mapPlan(result.rows, claim)
        };
      },

      async verifyExactReservationSet({
        claim: rawClaim,
        plan,
        reservations
      }: {
        claim: InboxV2SourceProcessingRuntimeClaim;
        plan: InboxV2SourceAttachmentMaterializationPlan;
        reservations: readonly ReserveInboxV2AttachmentMaterializationInput[];
      }) {
        const claim = parseMaterializationClaim(rawClaim);
        assertPlanClaim(plan, claim);
        assertReservationInputSet(plan, reservations);
        const result = await executor.execute<VerificationRow>(
          buildVerifyInboxV2SourceAttachmentMaterializationReservationsSql({
            claim,
            plan,
            reservations
          })
        );
        if (result.rows.length === 0) return { kind: "lease_lost" };
        const row = exactlyOne(result.rows, "materialization exact-set proof");
        const pendingCount = boundedCount(row.pending_count, "pending count");
        const expectedCount = boundedCount(
          row.expected_count,
          "expected count"
        );
        const pendingExpectedCount = boundedCount(
          row.pending_expected_count,
          "pending/expected count"
        );
        const exactJobCount = boundedCount(
          row.exact_job_count,
          "exact job count"
        );
        const complete =
          pendingCount === plan.anchors.length &&
          expectedCount === plan.anchors.length &&
          pendingExpectedCount === plan.anchors.length &&
          exactJobCount === plan.anchors.length;
        return {
          kind: complete ? "complete" : "incomplete",
          attachmentCount: plan.anchors.length
        };
      },

      async observeReservationNamespaceRetirementDrain(input) {
        const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
        const reservationNamespaceGeneration = requiredRoutingToken(
          input.reservationNamespaceGeneration,
          "reservation namespace generation"
        );
        const result = await executor.execute<NamespaceRetirementDrainRow>(
          buildObserveInboxV2SourceAttachmentNamespaceRetirementDrainSql({
            tenantId,
            reservationNamespaceGeneration
          })
        );
        const row = exactlyOne(
          result.rows,
          "namespace retirement drain observation"
        );
        const nonterminalJobCount = nonnegativeCounter(
          row.nonterminal_job_count,
          "nonterminal materialization job count"
        );
        const unfinishedMaterializationWorkCount = nonnegativeCounter(
          row.unfinished_materialization_work_count,
          "unfinished materialization work count"
        );
        return {
          kind:
            nonterminalJobCount === "0" &&
            unfinishedMaterializationWorkCount === "0"
              ? "drained_observed"
              : "blocked_observed",
          tenantId,
          reservationNamespaceGeneration,
          nonterminalJobCount,
          unfinishedMaterializationWorkCount
        };
      }
    });
  sqlSourceAttachmentMaterializationRepositories.add(repository);
  sqlSourceAttachmentMaterializationRepositoryExecutors.set(
    repository,
    executor as object
  );
  return repository;
}

export function buildObserveInboxV2SourceAttachmentNamespaceRetirementDrainSql(
  input: Readonly<{
    tenantId: string;
    reservationNamespaceGeneration: string;
  }>
): SQL {
  return sql`
    select (
      select count(*)::text
        from inbox_v2_file_attachment_materialization_jobs job
       where job.tenant_id = ${input.tenantId}
         and job.reservation_namespace_generation =
           ${input.reservationNamespaceGeneration}
         and job.state in ('pending', 'claimed', 'transferring', 'verifying')
    ) as nonterminal_job_count,
    (
      select count(*)::text
        from inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${input.tenantId}
         and work.stage = 'materialization'
         and work.state in ('pending', 'leased', 'retry_scheduled')
    ) as unfinished_materialization_work_count
  `;
}

/** Server-only composition guard; omitted from the package root. */
export function isSqlInboxV2SourceAttachmentMaterializationRepository(
  value: unknown
): value is InboxV2SourceAttachmentMaterializationRepository {
  return (
    typeof value === "object" &&
    value !== null &&
    sqlSourceAttachmentMaterializationRepositories.has(value)
  );
}

/** Internal co-location check; the executor identity is never returned. */
export function isSqlInboxV2SourceAttachmentMaterializationRepositoryForExecutor(
  value: unknown,
  executor: unknown
): value is InboxV2SourceAttachmentMaterializationRepository {
  return (
    isSqlInboxV2SourceAttachmentMaterializationRepository(value) &&
    typeof executor === "object" &&
    executor !== null &&
    sqlSourceAttachmentMaterializationRepositoryExecutors.get(value) ===
      executor
  );
}

export function buildLoadInboxV2SourceAttachmentMaterializationPlanSql(
  rawClaim: InboxV2SourceProcessingRuntimeClaim
): SQL {
  const claim = parseMaterializationClaim(rawClaim);
  const attempt = claim.attempt;
  return sql`
    with live_work as materialized (
      select work.tenant_id, work.work_id, work.normalized_event_id
        from inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${attempt.scope.tenantId}
         and work.work_id = ${attempt.workId}
         and work.raw_event_id = ${attempt.scope.rawEventId}
         and work.normalized_event_id = ${attempt.scope.normalizedEventId}
         and work.stage = 'materialization'
         and work.state = 'leased'
         and work.revision = ${attempt.workRevision}::bigint
         and work.lease_owner_id = ${attempt.workerId}
         and work.lease_token_hash = ${attempt.leaseTokenHash}
         and work.lease_revision = ${attempt.leaseRevision}::bigint
         and work.lease_claimed_at = ${attempt.leaseClaimedAt}::timestamptz
         and work.lease_expires_at = ${attempt.leaseExpiresAt}::timestamptz
         and work.lease_expires_at > clock_timestamp()
    ),
    reconciled as materialized (
      select work.work_id, work.normalized_event_id,
             occurrence.id as source_occurrence_id,
             message.conversation_id, message.timeline_item_id,
             message.id as message_id,
             revision.message_revision,
             revision.after_content_id as timeline_content_id,
             revision.after_content_revision as content_revision,
             timeline.visibility as timeline_visibility,
             content.data_class_id, content.processing_purpose_id,
             content.retention_anchor_at,
             event.id as cause_event_id,
             event.mutation_id as cause_mutation_id,
             event.stream_commit_id as cause_stream_commit_id,
             event.stream_position as cause_stream_position,
             event.correlation_id, event.occurred_at as caused_at
        from live_work work
        join inbox_v2_source_occurrences occurrence
          on occurrence.tenant_id = ${attempt.scope.tenantId}
         and occurrence.normalized_inbound_event_id = work.normalized_event_id
        join inbox_v2_action_attributions attribution
          on attribution.tenant_id = occurrence.tenant_id
         and attribution.source_occurrence_id = occurrence.id
         and attribution.app_actor_kind is null
        join inbox_v2_message_revisions revision
          on revision.tenant_id = attribution.tenant_id
         and revision.action_attribution_id = attribution.id
         and revision.change_kind in ('created', 'edited')
         and revision.after_content_id is not null
         and revision.after_content_revision is not null
         and revision.after_content_state = 'available'
        join inbox_v2_messages message
          on message.tenant_id = revision.tenant_id
         and message.id = revision.message_id
         and message.timeline_item_id = revision.timeline_item_id
         and message.revision >= revision.message_revision
         and message.content_id = revision.after_content_id
         and message.content_revision >= revision.after_content_revision
         and message.content_state = 'available'
        join inbox_v2_timeline_items timeline
          on timeline.tenant_id = message.tenant_id
         and timeline.id = message.timeline_item_id
         and timeline.conversation_id = message.conversation_id
         and timeline.visibility in (
           'conversation_external', 'internal_participants'
         )
        join inbox_v2_timeline_contents content
          on content.tenant_id = message.tenant_id
         and content.id = message.content_id
         and content.owner_kind = 'message'
         and content.owner_id = message.id
         and content.state = 'available'
         and content.revision = message.content_revision
        join inbox_v2_tenant_stream_changes change
          on change.tenant_id = revision.tenant_id
         and change.stream_position = revision.recorded_stream_position
         and change.entity_type_id = 'core:message'
         and change.entity_id = message.id
         and change.resulting_revision = revision.message_revision
        join inbox_v2_domain_events event
          on event.tenant_id = change.tenant_id
         and event.mutation_id = change.mutation_id
         and event.stream_commit_id = change.stream_commit_id
         and event.stream_position = change.stream_position
         and event.type_id = 'core:message.changed'
         and event.change_ids @> jsonb_build_array(change.id)
         and event.subjects @> jsonb_build_array(jsonb_build_object(
           'tenantId', change.tenant_id,
           'entityTypeId', 'core:message',
           'entityId', message.id
         ))
    ),
    retained_pending as materialized (
      select reconciled.message_id,
             current_payload.ordinal,
             current_payload.block_key,
             current_payload.attachment_id,
             attachment.revision as attachment_revision
        from reconciled
        join inbox_v2_timeline_content_payloads origin_payload
          on origin_payload.tenant_id = ${attempt.scope.tenantId}
         and origin_payload.content_id = reconciled.timeline_content_id
         and origin_payload.content_revision = reconciled.content_revision
         and origin_payload.attachment_state = 'pending'
         and origin_payload.attachment_file_id is null
         and origin_payload.attachment_v2_file_id is null
         and origin_payload.attachment_file_version_id is null
         and origin_payload.attachment_object_version_id is null
         and origin_payload.attachment_failure_reason_id is null
        join inbox_v2_messages current_message
          on current_message.tenant_id = ${attempt.scope.tenantId}
         and current_message.id = reconciled.message_id
         and current_message.timeline_item_id = reconciled.timeline_item_id
         and current_message.conversation_id = reconciled.conversation_id
         and current_message.revision >= reconciled.message_revision
         and current_message.content_id = reconciled.timeline_content_id
         and current_message.content_revision >= reconciled.content_revision
         and current_message.content_state = 'available'
        join inbox_v2_timeline_content_payloads current_payload
          on current_payload.tenant_id = current_message.tenant_id
         and current_payload.content_id = current_message.content_id
         and current_payload.content_revision = current_message.content_revision
         and current_payload.block_key = origin_payload.block_key
         and current_payload.attachment_id = origin_payload.attachment_id
         and current_payload.attachment_state = 'pending'
         and current_payload.attachment_file_id is null
         and current_payload.attachment_v2_file_id is null
         and current_payload.attachment_file_version_id is null
         and current_payload.attachment_object_version_id is null
         and current_payload.attachment_failure_reason_id is null
        join inbox_v2_message_attachment_anchors attachment
          on attachment.tenant_id = current_payload.tenant_id
         and attachment.id = current_payload.attachment_id
         and attachment.owner_message_id = reconciled.message_id
         and attachment.owner_timeline_item_id = reconciled.timeline_item_id
         and attachment.owner_timeline_content_id =
             reconciled.timeline_content_id
         and attachment.owner_block_key = current_payload.block_key
         and attachment.materialization_state = 'pending'
    )
    select reconciled.*,
           (select count(*) from reconciled)::integer as reconciled_count,
           (
             select count(*)::integer
               from retained_pending
              where retained_pending.message_id = reconciled.message_id
           ) as raw_pending_count,
           pending.ordinal as anchor_ordinal,
           pending.block_key,
           pending.attachment_id,
           pending.attachment_revision
      from reconciled
      left join lateral (
        select ordinal, block_key, attachment_id, attachment_revision
          from retained_pending
         where retained_pending.message_id = reconciled.message_id
         order by ordinal, block_key collate "C"
         limit ${MATERIALIZATION_ANCHOR_LIMIT + 1}
      ) pending on true
     order by pending.ordinal nulls last, pending.block_key collate "C"
  `;
}

export function buildClassifyInboxV2SourceAttachmentMaterializationAbsenceSql(
  rawClaim: InboxV2SourceProcessingRuntimeClaim
): SQL {
  const claim = parseMaterializationClaim(rawClaim);
  const attempt = claim.attempt;
  return sql`
    select
      exists (
        select 1
          from inbox_v2_source_processing_work_heads work
         where work.tenant_id = ${attempt.scope.tenantId}
           and work.work_id = ${attempt.workId}
           and work.stage = 'materialization'
           and work.state = 'leased'
           and work.revision = ${attempt.workRevision}::bigint
           and work.lease_owner_id = ${attempt.workerId}
           and work.lease_token_hash = ${attempt.leaseTokenHash}
           and work.lease_revision = ${attempt.leaseRevision}::bigint
           and work.lease_expires_at = ${attempt.leaseExpiresAt}::timestamptz
           and work.lease_expires_at > clock_timestamp()
      ) as live_lease,
      exists (
        select 1
          from inbox_v2_source_occurrences occurrence
          join inbox_v2_action_attributions attribution
            on attribution.tenant_id = occurrence.tenant_id
           and attribution.source_occurrence_id = occurrence.id
           and attribution.app_actor_kind is null
          join inbox_v2_message_revisions revision
            on revision.tenant_id = attribution.tenant_id
           and revision.action_attribution_id = attribution.id
           and revision.change_kind in ('created', 'edited')
           and revision.after_content_id is not null
           and revision.after_content_revision is not null
         where occurrence.tenant_id = ${attempt.scope.tenantId}
           and occurrence.normalized_inbound_event_id =
             ${attempt.scope.normalizedEventId}
      ) as has_message_reconciliation,
      exists (
        select 1
          from inbox_v2_source_occurrences occurrence
          join inbox_v2_action_attributions attribution
            on attribution.tenant_id = occurrence.tenant_id
           and attribution.source_occurrence_id = occurrence.id
           and attribution.app_actor_kind is null
          join inbox_v2_message_revisions origin_revision
            on origin_revision.tenant_id = attribution.tenant_id
           and origin_revision.action_attribution_id = attribution.id
           and origin_revision.change_kind in ('created', 'edited')
           and origin_revision.after_content_id is not null
           and origin_revision.after_content_revision is not null
          join inbox_v2_messages message
            on message.tenant_id = origin_revision.tenant_id
           and message.id = origin_revision.message_id
           and message.timeline_item_id = origin_revision.timeline_item_id
           and message.revision >= origin_revision.message_revision
           and message.content_id = origin_revision.after_content_id
           and message.content_revision >= origin_revision.after_content_revision
           and message.content_state in ('privacy_erased', 'retention_purged')
         where occurrence.tenant_id = ${attempt.scope.tenantId}
           and occurrence.normalized_inbound_event_id =
             ${attempt.scope.normalizedEventId}
      ) as has_terminal_content_tombstone,
      exists (
        select 1
          from inbox_v2_deferred_message_source_actions action
         where action.tenant_id = ${attempt.scope.tenantId}
           and action.normalized_inbound_event_id =
             ${attempt.scope.normalizedEventId}
           and action.state in (
             'applied', 'target_conflicted', 'stale', 'duplicate',
             'ordering_conflict', 'expired'
           )
      ) as terminal_deferred_action
  `;
}

export function buildVerifyInboxV2SourceAttachmentMaterializationReservationsSql(
  input: Readonly<{
    claim: InboxV2SourceProcessingRuntimeClaim;
    plan: InboxV2SourceAttachmentMaterializationPlan;
    reservations: readonly ReserveInboxV2AttachmentMaterializationInput[];
  }>
): SQL {
  const claim = parseMaterializationClaim(input.claim);
  assertPlanClaim(input.plan, claim);
  assertReservationInputSet(input.plan, input.reservations);
  const attempt = claim.attempt;
  const origin = input.plan.origin;
  const expectedJson = JSON.stringify(
    input.reservations.map((reservation) => ({
      attachment_id: reservation.attachmentId,
      attachment_revision: reservation.expectedAttachmentRevision,
      block_key: reservation.content.blockKey,
      job_id: reservation.jobId,
      file_id: reservation.file.id,
      file_version_id: reservation.reservation.fileVersionId,
      object_version_id: reservation.reservation.objectVersionId,
      storage_root_id: reservation.reservation.storageRootId,
      storage_key: reservation.reservation.storageKey,
      reservation_namespace_generation:
        reservation.reservationNamespaceGeneration,
      idempotency_token: reservation.idempotencyToken,
      source_locator_reference: reservation.sourceLocator.reference
    }))
  );
  return sql`
    with live_work as materialized (
      select 1
        from inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${attempt.scope.tenantId}
         and work.work_id = ${attempt.workId}
         and work.stage = 'materialization'
         and work.state = 'leased'
         and work.revision = ${attempt.workRevision}::bigint
         and work.lease_owner_id = ${attempt.workerId}
         and work.lease_token_hash = ${attempt.leaseTokenHash}
         and work.lease_revision = ${attempt.leaseRevision}::bigint
         and work.lease_expires_at = ${attempt.leaseExpiresAt}::timestamptz
         and work.lease_expires_at > clock_timestamp()
    ),
    expected as materialized (
      select *
        from jsonb_to_recordset(${expectedJson}::jsonb) as expected_row(
          attachment_id text, attachment_revision text, block_key text,
          job_id text, file_id text, file_version_id text,
          object_version_id text, storage_root_id text, storage_key text,
          reservation_namespace_generation text,
          idempotency_token text, source_locator_reference text
        )
    ),
    current_head as materialized (
      select message.content_revision
        from inbox_v2_message_revisions origin_revision
        join inbox_v2_messages message
          on message.tenant_id = origin_revision.tenant_id
         and message.id = origin_revision.message_id
         and message.timeline_item_id = origin_revision.timeline_item_id
         and message.revision >= origin_revision.message_revision
         and message.content_id = origin_revision.after_content_id
         and message.content_revision >= origin_revision.after_content_revision
         and message.content_state = 'available'
        join inbox_v2_timeline_contents content
          on content.tenant_id = message.tenant_id
         and content.id = message.content_id
         and content.owner_kind = 'message'
         and content.owner_id = message.id
         and content.revision = message.content_revision
         and content.state = message.content_state
       where origin_revision.tenant_id = ${origin.tenantId}
         and origin_revision.message_id = ${origin.messageId}
         and origin_revision.timeline_item_id = ${origin.timelineItemId}
         and origin_revision.message_revision =
             ${origin.messageRevision}::bigint
         and origin_revision.after_content_id = ${origin.timelineContentId}
         and origin_revision.after_content_revision =
             ${origin.contentRevision}::bigint
         and origin_revision.after_content_state = 'available'
         and message.conversation_id = ${origin.conversationId}
    ),
    pending as materialized (
      select current_payload.attachment_id,
             attachment.revision::text as attachment_revision,
             current_payload.block_key
        from current_head
        join inbox_v2_timeline_content_payloads origin_payload on true
        join inbox_v2_timeline_content_payloads current_payload
          on current_payload.tenant_id = origin_payload.tenant_id
         and current_payload.content_id = origin_payload.content_id
         and current_payload.content_revision = current_head.content_revision
         and current_payload.block_key = origin_payload.block_key
         and current_payload.attachment_id = origin_payload.attachment_id
         and current_payload.attachment_state = 'pending'
         and current_payload.attachment_file_id is null
         and current_payload.attachment_v2_file_id is null
         and current_payload.attachment_file_version_id is null
         and current_payload.attachment_object_version_id is null
         and current_payload.attachment_failure_reason_id is null
        join inbox_v2_message_attachment_anchors attachment
          on attachment.tenant_id = current_payload.tenant_id
         and attachment.id = current_payload.attachment_id
         and attachment.owner_message_id = ${origin.messageId}
         and attachment.owner_timeline_item_id = ${origin.timelineItemId}
         and attachment.owner_timeline_content_id = ${origin.timelineContentId}
         and attachment.owner_block_key = current_payload.block_key
         and attachment.materialization_state = 'pending'
       where origin_payload.tenant_id = ${origin.tenantId}
         and origin_payload.content_id = ${origin.timelineContentId}
         and origin_payload.content_revision = ${origin.contentRevision}::bigint
         and origin_payload.attachment_state = 'pending'
         and origin_payload.attachment_file_id is null
         and origin_payload.attachment_v2_file_id is null
         and origin_payload.attachment_file_version_id is null
         and origin_payload.attachment_object_version_id is null
         and origin_payload.attachment_failure_reason_id is null
       order by current_payload.ordinal, current_payload.block_key collate "C"
       limit ${MATERIALIZATION_ANCHOR_LIMIT + 1}
    ),
    exact_jobs as materialized (
      select job.id
        from expected
        join pending
          on pending.attachment_id = expected.attachment_id
         and pending.attachment_revision = expected.attachment_revision
         and pending.block_key = expected.block_key
        join inbox_v2_file_attachment_materialization_jobs job
          on job.tenant_id = ${origin.tenantId}
         and job.id = expected.job_id
         and job.attachment_id = expected.attachment_id
         and job.expected_attachment_revision =
           expected.attachment_revision::bigint
         and job.content_block_key = expected.block_key
         and job.file_id = expected.file_id
         and job.reserved_file_version_id = expected.file_version_id
         and job.reserved_object_version_id = expected.object_version_id
         and job.reserved_storage_root_id = expected.storage_root_id
         and job.reserved_storage_object_key = expected.storage_key
         and job.reservation_namespace_generation =
           expected.reservation_namespace_generation
         and job.idempotency_token = expected.idempotency_token
         and job.source_locator_reference = expected.source_locator_reference
         and job.source_locator_kind = 'provider'
         and job.source_occurrence_id = ${origin.sourceOccurrenceId}
         and job.conversation_id = ${origin.conversationId}
         and job.timeline_item_id = ${origin.timelineItemId}
         and job.parent_message_id = ${origin.messageId}
         and job.expected_parent_revision = ${origin.messageRevision}::bigint
         and job.timeline_content_id = ${origin.timelineContentId}
         and job.expected_content_revision = ${origin.contentRevision}::bigint
         and job.cause_event_id = ${origin.causeEventId}
         and job.cause_mutation_id = ${origin.causeMutationId}
         and job.cause_stream_commit_id = ${origin.causeStreamCommitId}
         and job.cause_stream_position = ${origin.causeStreamPosition}::bigint
         and job.state in ('pending', 'claimed', 'transferring', 'verifying')
    )
    select
      (select count(*) from pending)::integer as pending_count,
      (select count(*) from expected)::integer as expected_count,
      (select count(*) from pending join expected using (
        attachment_id, attachment_revision, block_key
      ))::integer as pending_expected_count,
      (select count(*) from exact_jobs)::integer as exact_job_count
      from live_work
  `;
}

function parseMaterializationClaim(
  rawClaim: InboxV2SourceProcessingRuntimeClaim
): InboxV2SourceProcessingRuntimeClaim {
  const claim = inboxV2SourceProcessingRuntimeClaimSchema.parse(rawClaim);
  if (
    claim.attempt.scope.stage !== "materialization" ||
    claim.attempt.scope.normalizedEventId === null ||
    claim.rawIngressClaim !== null ||
    calculateInboxV2SourceProcessingLeaseTokenHash(claim.leaseToken) !==
      claim.attempt.leaseTokenHash
  ) {
    throw new TypeError(
      "Source attachment materialization requires an exact materialization-stage lease capability."
    );
  }
  return claim;
}

function mapPlan(
  rows: readonly PlanRow[],
  claim: InboxV2SourceProcessingRuntimeClaim
): InboxV2SourceAttachmentMaterializationPlan {
  const first = rows[0]!;
  const reconciledCount = boundedCount(
    first.reconciled_count,
    "reconciled message count"
  );
  if (reconciledCount !== 1) {
    throw new TypeError(
      "Materialization stage did not resolve exactly one reconciled Message revision."
    );
  }
  const origin: InboxV2SourceAttachmentMaterializationOrigin = Object.freeze({
    tenantId: claim.attempt.scope.tenantId,
    workId: requiredString(first.work_id, "work id"),
    normalizedEventId: requiredString(
      first.normalized_event_id,
      "normalized event id"
    ),
    sourceOccurrenceId: requiredString(
      first.source_occurrence_id,
      "source occurrence id"
    ),
    conversationId: requiredString(first.conversation_id, "conversation id"),
    timelineItemId: requiredString(first.timeline_item_id, "timeline item id"),
    messageId: requiredString(first.message_id, "message id"),
    messageRevision: positiveCounter(
      first.message_revision,
      "message revision"
    ),
    timelineContentId: requiredString(
      first.timeline_content_id,
      "timeline content id"
    ),
    contentRevision: positiveCounter(
      first.content_revision,
      "content revision"
    ),
    visibilityBoundary:
      requiredString(first.timeline_visibility, "timeline visibility") ===
      "conversation_external"
        ? "external_work"
        : "internal",
    dataClassId: requiredString(first.data_class_id, "data class id"),
    processingPurposeId: requiredString(
      first.processing_purpose_id,
      "processing purpose id"
    ),
    retentionAnchorAt: timestamp(first.retention_anchor_at, "retention anchor"),
    causeEventId: requiredString(first.cause_event_id, "cause event id"),
    causeMutationId: requiredString(
      first.cause_mutation_id,
      "cause mutation id"
    ),
    causeStreamCommitId: requiredString(
      first.cause_stream_commit_id,
      "cause stream commit id"
    ),
    causeStreamPosition: positiveCounter(
      first.cause_stream_position,
      "cause stream position"
    ),
    correlationId: requiredString(first.correlation_id, "correlation id"),
    causedAt: timestamp(first.caused_at, "caused at")
  });
  for (const row of rows) assertSameOrigin(row, first);
  const anchors = rows
    .filter((row) => row.attachment_id !== null)
    .map((row) =>
      Object.freeze({
        ordinal: boundedOrdinal(row.anchor_ordinal),
        blockKey: requiredString(row.block_key, "attachment block key"),
        attachmentId: requiredString(row.attachment_id, "attachment id"),
        attachmentRevision: positiveCounter(
          row.attachment_revision,
          "attachment revision"
        )
      })
    );
  const rawPendingCount = boundedCount(
    first.raw_pending_count,
    "raw pending attachment count"
  );
  if (
    anchors.length > MATERIALIZATION_ANCHOR_LIMIT ||
    rawPendingCount !== anchors.length ||
    new Set(anchors.map(({ attachmentId }) => attachmentId)).size !==
      anchors.length ||
    new Set(anchors.map(({ blockKey }) => blockKey)).size !== anchors.length
  ) {
    throw new TypeError(
      "A reconciled Message materialization plan exceeds or duplicates its bounded attachment set."
    );
  }
  return Object.freeze({ origin, anchors: Object.freeze(anchors) });
}

function assertPlanClaim(
  plan: InboxV2SourceAttachmentMaterializationPlan,
  claim: InboxV2SourceProcessingRuntimeClaim
): void {
  if (
    plan.origin.tenantId !== claim.attempt.scope.tenantId ||
    plan.origin.workId !== claim.attempt.workId ||
    plan.origin.normalizedEventId !== claim.attempt.scope.normalizedEventId ||
    plan.anchors.length > MATERIALIZATION_ANCHOR_LIMIT
  ) {
    throw new TypeError(
      "Materialization plan is not bound to its source lease."
    );
  }
}

function assertReservationInputSet(
  plan: InboxV2SourceAttachmentMaterializationPlan,
  reservations: readonly ReserveInboxV2AttachmentMaterializationInput[]
): void {
  if (
    reservations.length !== plan.anchors.length ||
    reservations.some((reservation, index) => {
      const anchor = plan.anchors[index];
      return (
        anchor === undefined ||
        reservation.tenantId !== plan.origin.tenantId ||
        reservation.attachmentId !== anchor.attachmentId ||
        reservation.expectedAttachmentRevision !== anchor.attachmentRevision ||
        reservation.content.blockKey !== anchor.blockKey ||
        reservation.content.parentMessageId !== plan.origin.messageId ||
        reservation.content.expectedParentRevision !==
          plan.origin.messageRevision ||
        reservation.content.id !== plan.origin.timelineContentId ||
        reservation.content.expectedRevision !== plan.origin.contentRevision ||
        reservation.causeEventId !== plan.origin.causeEventId ||
        reservation.causeMutationId !== plan.origin.causeMutationId ||
        reservation.causeStreamCommitId !== plan.origin.causeStreamCommitId ||
        reservation.causeStreamPosition !== plan.origin.causeStreamPosition
      );
    })
  ) {
    throw new TypeError(
      "Materialization reservation inputs do not equal the exact pending-anchor plan."
    );
  }
}

function assertSameOrigin(row: PlanRow, first: PlanRow): void {
  const keys = [
    "work_id",
    "normalized_event_id",
    "source_occurrence_id",
    "conversation_id",
    "timeline_item_id",
    "message_id",
    "message_revision",
    "timeline_content_id",
    "content_revision",
    "timeline_visibility",
    "cause_event_id",
    "cause_mutation_id",
    "cause_stream_commit_id",
    "cause_stream_position",
    "correlation_id"
  ] as const;
  if (keys.some((key) => String(row[key]) !== String(first[key]))) {
    throw new TypeError(
      "Materialization plan rows do not share one exact reconciled Message origin."
    );
  }
}

function exactlyOne<T>(rows: readonly T[], label: string): T {
  if (rows.length !== 1) {
    throw new TypeError(`Expected exactly one ${label} row.`);
  }
  return rows[0]!;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function positiveCounter(value: unknown, label: string): string {
  const text = String(value);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new TypeError(`Expected ${label} to be a positive counter.`);
  }
  return text;
}

function nonnegativeCounter(value: unknown, label: string): string {
  const text = String(value);
  if (!/^(?:0|[1-9][0-9]*)$/u.test(text)) {
    throw new TypeError(`Expected ${label} to be a non-negative counter.`);
  }
  return text;
}

function requiredRoutingToken(value: unknown, label: string): string {
  try {
    return inboxV2RoutingTokenSchema.parse(value);
  } catch {
    throw new TypeError(`Expected ${label} to be a routing token.`);
  }
}

function boundedCount(value: unknown, label: string): number {
  const count = Number(value);
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    count > MATERIALIZATION_ANCHOR_LIMIT + 1
  ) {
    throw new TypeError(`Expected ${label} to be bounded.`);
  }
  return count;
}

function boundedOrdinal(value: unknown): number {
  const ordinal = Number(value);
  if (!Number.isSafeInteger(ordinal) || ordinal < 0 || ordinal >= 64) {
    throw new TypeError("Attachment ordinal is outside the content bound.");
  }
  return ordinal;
}

function timestamp(value: unknown, label: string): string {
  const epoch =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(epoch)) {
    throw new TypeError(`Expected ${label} to be a finite timestamp.`);
  }
  return new Date(epoch).toISOString();
}
