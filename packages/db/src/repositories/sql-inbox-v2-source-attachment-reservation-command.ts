import {
  calculateInboxV2CanonicalSha256,
  inboxV2AuthorizationDecisionReferenceSchema,
  inboxV2NamespacedIdSchema,
  inboxV2TenantIdSchema
} from "@hulee/contracts";
import { sql } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import {
  computeInboxV2LeafHashDigest,
  computeInboxV2TenantStreamManifestDigest,
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizationTransactionExecutor,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID,
  INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID,
  createSqlInboxV2FileObjectRepository,
  type InboxV2PendingMaterializationAuthorizationRefreshCandidate,
  type InboxV2FileObjectRepository,
  type ReauthorizeInboxV2PendingMaterializationResult,
  type ReserveInboxV2AttachmentMaterializationInput,
  type ReserveInboxV2AttachmentMaterializationResult
} from "./sql-inbox-v2-file-object-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";
import { isSqlInboxV2SourceAttachmentMaterializationRepositoryForExecutor } from "./sql-inbox-v2-source-attachment-materialization-repository";

const sqlSourceAttachmentReservationCommandPorts = new WeakSet<object>();
const sqlSourceAttachmentReservationCommandPortExecutors = new WeakMap<
  object,
  object
>();
const sqlSourceAttachmentReservationAuthorizationPreparers =
  new WeakSet<object>();
const sqlSourceAttachmentReservationAuthorizationPreparerExecutors =
  new WeakMap<object, object>();
const preparedSourceAttachmentAuthorityFences = new WeakMap<
  object,
  PreparedSourceAttachmentAuthorityFence
>();
const SOURCE_ATTACHMENT_RESERVATION_TRUSTED_SERVICE_ID = "core:source-runtime";

export type InboxV2SourceAttachmentReservationAuthorizationPreparer = Readonly<{
  /**
   * Loads the complete current trusted-service decision set and revision
   * fences for this exact reservation. Provider fields are never authority.
   * The SQL coordinator revalidates every returned decision/fence before the
   * file repository is allowed to reserve anything.
   */
  prepareAuthorizedReservation(
    input: ReserveInboxV2AttachmentMaterializationInput
  ): Promise<WithInboxV2AuthorizedCommandMutationInput | null>;
  /**
   * Resolves the exact pending job plus the current trusted source grant and
   * authorization heads. The returned command identity changes whenever any
   * of those authorities changes, so an old committed command cannot replay
   * a stale decision into a newly refreshed job.
   */
  preparePendingAuthorizationRefresh(
    input: InboxV2PendingMaterializationAuthorizationRefreshCandidate
  ): Promise<WithInboxV2AuthorizedCommandMutationInput | null>;
}>;

type ReservationAuthorityRow = Readonly<
  Record<string, unknown> & {
    tenant_rbac_revision: unknown;
    shared_access_revision: unknown;
    resource_head_id: unknown;
    resource_access_revision: unknown;
    structural_relation_revision: unknown;
    collaborator_set_revision: unknown;
    stream_epoch: unknown;
    timeline_visibility: unknown;
    materialized_by_trusted_service_id: unknown;
    materialization_authorization_token: unknown;
    source_occurrence_revision: unknown;
    database_now: unknown;
  }
>;

type PendingRefreshAuthorityRow = ReservationAuthorityRow &
  Readonly<
    Record<string, unknown> & {
      job_id: unknown;
      job_revision: unknown;
      attachment_id: unknown;
      file_id: unknown;
      expected_attachment_revision: unknown;
      conversation_id: unknown;
      timeline_item_id: unknown;
      parent_message_id: unknown;
      expected_parent_revision: unknown;
      visibility_boundary: unknown;
      timeline_content_id: unknown;
      expected_content_revision: unknown;
      content_block_key: unknown;
      source_occurrence_id: unknown;
      reservation_namespace_generation: unknown;
      idempotency_token: unknown;
      reserved_file_version_id: unknown;
      reserved_object_version_id: unknown;
      correlation_id: unknown;
    }
  >;

type PreparedSourceAttachmentAuthorityFence = Readonly<{
  tenantId: string;
  sourceOccurrenceId: string;
  trustedServiceId: string;
  materializationAuthorizationToken: string;
  sourceOccurrenceRevision: string;
}>;

/**
 * Concrete current-policy preparer. It admits only the trusted service that
 * durably materialized the SourceOccurrence, and it resolves the exact live
 * source/message/content/attachment plus authorization heads from PostgreSQL.
 * A later policy/resource revision is fenced again by the coordinator.
 */
export function createSqlInboxV2SourceAttachmentReservationAuthorizationPreparer(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase,
  input: Readonly<{ trustedServiceId: string }>
): InboxV2SourceAttachmentReservationAuthorizationPreparer {
  const trustedServiceId = inboxV2NamespacedIdSchema.parse(
    input.trustedServiceId
  );
  if (trustedServiceId !== SOURCE_ATTACHMENT_RESERVATION_TRUSTED_SERVICE_ID) {
    throw new TypeError(
      "Source attachment reservation policy is closed to the registered source runtime service."
    );
  }
  const transactionExecutor =
    executor as unknown as InboxV2AuthorizationTransactionExecutor;
  const preparer = Object.freeze({
    async prepareAuthorizedReservation(
      reservation: ReserveInboxV2AttachmentMaterializationInput
    ): Promise<WithInboxV2AuthorizedCommandMutationInput | null> {
      if (
        reservation.sourceLocator.kind !== "provider" ||
        reservation.sourceOccurrenceId === null
      ) {
        return null;
      }
      return transactionExecutor.transaction(
        async (transaction) => {
          const result = await transaction.execute<ReservationAuthorityRow>(sql`
          select tenant_head.tenant_rbac_revision,
                 tenant_head.shared_access_revision,
                 resource_head.id as resource_head_id,
                 resource_head.resource_access_revision,
                 resource_head.structural_relation_revision,
                 resource_head.collaborator_set_revision,
                 stream_head.stream_epoch,
                 timeline.visibility as timeline_visibility,
                 occurrence.materialized_by_trusted_service_id,
                 occurrence.materialization_authorization_token,
                 occurrence.revision as source_occurrence_revision,
                 clock.database_now
            from inbox_v2_source_occurrences occurrence
            join inbox_v2_messages message
              on message.tenant_id = occurrence.tenant_id
             and message.id = ${reservation.content.parentMessageId}
             and message.conversation_id = ${reservation.content.conversationId}
             and message.timeline_item_id = ${reservation.content.timelineItemId}
             and message.origin_source_occurrence_id = occurrence.id
             and message.revision >=
                 ${reservation.content.expectedParentRevision}::bigint
             and message.content_id = ${reservation.content.id}
             and message.content_revision >=
                 ${reservation.content.expectedRevision}::bigint
             and message.content_state = 'available'
            join inbox_v2_message_revisions origin_revision
              on origin_revision.tenant_id = message.tenant_id
             and origin_revision.message_id = message.id
             and origin_revision.timeline_item_id = message.timeline_item_id
             and origin_revision.message_revision =
                 ${reservation.content.expectedParentRevision}::bigint
             and origin_revision.after_content_id = message.content_id
             and origin_revision.after_content_revision =
                 ${reservation.content.expectedRevision}::bigint
             and origin_revision.after_content_state = 'available'
            join inbox_v2_timeline_contents content
              on content.tenant_id = message.tenant_id
             and content.id = message.content_id
             and content.owner_kind = 'message'
             and content.owner_id = message.id
             and content.revision = message.content_revision
             and content.state = 'available'
            join inbox_v2_timeline_content_payloads origin_payload
              on origin_payload.tenant_id = content.tenant_id
             and origin_payload.content_id = content.id
             and origin_payload.content_revision =
                 origin_revision.after_content_revision
             and origin_payload.block_key = ${reservation.content.blockKey}
             and origin_payload.attachment_id = ${reservation.attachmentId}
             and origin_payload.attachment_state = 'pending'
            join inbox_v2_timeline_content_payloads current_payload
              on current_payload.tenant_id = content.tenant_id
             and current_payload.content_id = content.id
             and current_payload.content_revision = content.revision
             and current_payload.block_key = origin_payload.block_key
             and current_payload.attachment_id = origin_payload.attachment_id
             and current_payload.attachment_state = 'pending'
            join inbox_v2_message_attachment_anchors attachment
              on attachment.tenant_id = current_payload.tenant_id
             and attachment.id = current_payload.attachment_id
             and attachment.owner_message_id = message.id
             and attachment.owner_timeline_item_id = message.timeline_item_id
             and attachment.owner_timeline_content_id = content.id
             and attachment.owner_block_key = current_payload.block_key
             and attachment.revision =
                 ${reservation.expectedAttachmentRevision}::bigint
             and attachment.materialization_state = 'pending'
            join inbox_v2_timeline_items timeline
              on timeline.tenant_id = message.tenant_id
             and timeline.id = message.timeline_item_id
             and timeline.conversation_id = message.conversation_id
            join inbox_v2_auth_tenant_heads tenant_head
              on tenant_head.tenant_id = message.tenant_id
            join inbox_v2_auth_resource_heads resource_head
              on resource_head.tenant_id = message.tenant_id
             and resource_head.resource_kind = 'conversation'
             and resource_head.conversation_id = message.conversation_id
            join inbox_v2_tenant_stream_heads stream_head
              on stream_head.tenant_id = message.tenant_id
           cross join (select clock_timestamp() as database_now) clock
           where occurrence.tenant_id = ${reservation.tenantId}
             and occurrence.id = ${reservation.sourceOccurrenceId}
             and occurrence.materialized_by_trusted_service_id =
                 ${trustedServiceId}
             and timeline.visibility = case ${reservation.content.visibilityBoundary}
               when 'external_work' then
                 'conversation_external'::inbox_v2_timeline_visibility
               when 'internal' then
                 'internal_participants'::inbox_v2_timeline_visibility
             end
             and origin_payload.attachment_file_id is null
             and origin_payload.attachment_v2_file_id is null
             and origin_payload.attachment_file_version_id is null
             and origin_payload.attachment_object_version_id is null
             and origin_payload.attachment_failure_reason_id is null
             and current_payload.attachment_file_id is null
             and current_payload.attachment_v2_file_id is null
             and current_payload.attachment_file_version_id is null
             and current_payload.attachment_object_version_id is null
             and current_payload.attachment_failure_reason_id is null
           for share of occurrence, message, origin_revision, content,
             origin_payload, current_payload, attachment, timeline,
             tenant_head, resource_head, stream_head
        `);
          if (result.rows.length > 1) {
            throw new TypeError(
              "Source attachment reservation authority is not unique."
            );
          }
          const row = result.rows[0];
          if (row === undefined) return null;
          const prepared = buildReservationAuthorizedMutation({
            reservation,
            row,
            trustedServiceId
          });
          registerPreparedSourceAttachmentAuthorityFence(prepared, {
            tenantId: reservation.tenantId,
            sourceOccurrenceId: requiredString(
              reservation.sourceOccurrenceId,
              "source occurrence"
            ),
            row,
            trustedServiceId
          });
          return prepared;
        },
        { isolationLevel: "read committed" }
      );
    },

    async preparePendingAuthorizationRefresh(
      target: InboxV2PendingMaterializationAuthorizationRefreshCandidate
    ): Promise<WithInboxV2AuthorizedCommandMutationInput | null> {
      const tenantId = inboxV2TenantIdSchema.parse(target.tenantId);
      const jobId = requiredString(target.jobId, "materialization job");
      const expectedJobRevision = requiredCounter(
        target.expectedJobRevision,
        "expected materialization job revision"
      );
      return transactionExecutor.transaction(
        async (transaction) => {
          const result =
            await transaction.execute<PendingRefreshAuthorityRow>(sql`
          select tenant_head.tenant_rbac_revision,
                 tenant_head.shared_access_revision,
                 resource_head.id as resource_head_id,
                 resource_head.resource_access_revision,
                 resource_head.structural_relation_revision,
                 resource_head.collaborator_set_revision,
                 stream_head.stream_epoch,
                 timeline.visibility as timeline_visibility,
                 occurrence.materialized_by_trusted_service_id,
                 occurrence.materialization_authorization_token,
                 occurrence.revision as source_occurrence_revision,
                 job.id as job_id,
                 job.revision as job_revision,
                 job.attachment_id,
                 job.file_id,
                 job.expected_attachment_revision,
                 job.conversation_id,
                 job.timeline_item_id,
                 job.parent_message_id,
                 job.expected_parent_revision,
                 job.visibility_boundary,
                 job.timeline_content_id,
                 job.expected_content_revision,
                 job.content_block_key,
                 job.source_occurrence_id,
                 job.reservation_namespace_generation,
                 job.idempotency_token,
                 job.reserved_file_version_id,
                 job.reserved_object_version_id,
                 job.correlation_id,
                 clock.database_now
            from inbox_v2_file_attachment_materialization_jobs job
            join inbox_v2_source_occurrences occurrence
              on occurrence.tenant_id = job.tenant_id
             and occurrence.id = job.source_occurrence_id
             and occurrence.materialized_by_trusted_service_id =
                 ${trustedServiceId}
            join inbox_v2_timeline_items timeline
              on timeline.tenant_id = job.tenant_id
             and timeline.id = job.timeline_item_id
             and timeline.conversation_id = job.conversation_id
             and timeline.visibility = case job.visibility_boundary
               when 'external_work' then
                 'conversation_external'::inbox_v2_timeline_visibility
               when 'internal' then
                 'internal_participants'::inbox_v2_timeline_visibility
             end
            join inbox_v2_auth_tenant_heads tenant_head
              on tenant_head.tenant_id = job.tenant_id
            join inbox_v2_auth_resource_heads resource_head
              on resource_head.tenant_id = job.tenant_id
             and resource_head.resource_kind = 'conversation'
             and resource_head.conversation_id = job.conversation_id
            join inbox_v2_tenant_stream_heads stream_head
              on stream_head.tenant_id = job.tenant_id
           cross join (select clock_timestamp() as database_now) clock
           where job.tenant_id = ${tenantId}
             and job.id = ${jobId}
             and job.revision = ${expectedJobRevision}::bigint
             and job.state = 'pending'
             and num_nonnulls(
               job.lease_token_hash,
               job.lease_owner_id,
               job.lease_claimed_at,
               job.lease_expires_at
             ) = 0
           for share of job, occurrence, timeline, tenant_head,
             resource_head, stream_head
        `);
          if (result.rows.length > 1) {
            throw new TypeError(
              "Pending source attachment refresh authority is not unique."
            );
          }
          const row = result.rows[0];
          if (row === undefined) return null;
          const prepared = buildPendingAuthorizationRefreshMutation({
            target: { tenantId, jobId, expectedJobRevision },
            row,
            trustedServiceId
          });
          registerPreparedSourceAttachmentAuthorityFence(prepared, {
            tenantId,
            sourceOccurrenceId: requiredString(
              row.source_occurrence_id,
              "source occurrence"
            ),
            row,
            trustedServiceId
          });
          return prepared;
        },
        { isolationLevel: "read committed" }
      );
    }
  });
  sqlSourceAttachmentReservationAuthorizationPreparers.add(preparer);
  sqlSourceAttachmentReservationAuthorizationPreparerExecutors.set(
    preparer,
    executor as object
  );
  return preparer;
}

export type InboxV2SqlSourceAttachmentReservationCommandPort = Readonly<{
  reserve(
    input: ReserveInboxV2AttachmentMaterializationInput
  ): Promise<ReserveInboxV2AttachmentMaterializationResult>;
  refreshPendingAuthorization(
    input: InboxV2PendingMaterializationAuthorizationRefreshCandidate
  ): Promise<ReauthorizeInboxV2PendingMaterializationResult>;
}>;

class ReservationConflictRollback extends Error {
  readonly result: Extract<
    ReserveInboxV2AttachmentMaterializationResult,
    { kind: "conflict" }
  >;

  constructor(
    result: Extract<
      ReserveInboxV2AttachmentMaterializationResult,
      { kind: "conflict" }
    >
  ) {
    super(`Attachment reservation conflicted: ${result.code}`);
    this.name = "ReservationConflictRollback";
    this.result = result;
  }
}

class ReauthorizationRollback extends Error {
  readonly result: Exclude<
    ReauthorizeInboxV2PendingMaterializationResult,
    { kind: "refreshed" }
  >;

  constructor(
    result: Exclude<
      ReauthorizeInboxV2PendingMaterializationResult,
      { kind: "refreshed" }
    >
  ) {
    super(`Attachment authorization refresh did not apply: ${result.kind}`);
    this.name = "ReauthorizationRollback";
    this.result = result;
  }
}

/**
 * DB-owned production composition. A shape-compatible port cannot become
 * reservation authority: only this factory captures both the SQL authorization
 * coordinator and the SQL file repository used in the same transaction.
 */
export function createSqlInboxV2SourceAttachmentReservationCommandPort(
  executor: InboxV2AuthorizationTransactionExecutor | HuleeDatabase,
  authorization: InboxV2SourceAttachmentReservationAuthorizationPreparer
): InboxV2SqlSourceAttachmentReservationCommandPort {
  if (
    typeof authorization?.prepareAuthorizedReservation !== "function" ||
    !sqlSourceAttachmentReservationAuthorizationPreparers.has(
      authorization as object
    ) ||
    sqlSourceAttachmentReservationAuthorizationPreparerExecutors.get(
      authorization as object
    ) !== (executor as object)
  ) {
    throw new TypeError(
      "Source attachment reservation requires an authentic SQL current-authorization preparer bound to the same executor."
    );
  }
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(executor);
  const files = createSqlInboxV2FileObjectRepository(executor);
  const port = Object.freeze({
    async reserve(
      input: ReserveInboxV2AttachmentMaterializationInput
    ): Promise<ReserveInboxV2AttachmentMaterializationResult> {
      const prepared = await authorization.prepareAuthorizedReservation(input);
      if (prepared === null) {
        return { kind: "conflict", code: "content_fence_conflict" };
      }
      if (
        prepared.tenantId !== input.tenantId ||
        prepared.command.commandTypeId !==
          INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID
      ) {
        throw new TypeError(
          "Prepared source attachment authorization is outside the reservation command scope."
        );
      }

      try {
        const coordinated = await coordinator.withAuthorizedCommandMutation(
          prepared,
          async (context) => {
            if (
              !(await revalidatePreparedSourceAttachmentAuthority(
                prepared,
                context.executor
              ))
            ) {
              throw new ReservationConflictRollback({
                kind: "conflict",
                code: "content_fence_conflict"
              });
            }
            const result = await files.reserveMaterialization(context, input);
            if (result.kind === "conflict") {
              throw new ReservationConflictRollback(result);
            }
            return { result };
          },
          async (context) => {
            const replay = await files.reserveMaterialization(context, input);
            if (replay.kind === "conflict") {
              throw new ReservationConflictRollback(replay);
            }
            return replay;
          }
        );
        if (
          coordinated.kind === "applied" ||
          coordinated.kind === "already_applied"
        ) {
          if (coordinated.result === undefined) {
            throw new TypeError(
              "Committed attachment reservation replay omitted its durable result."
            );
          }
          return coordinated.result;
        }
        return {
          kind: "conflict",
          code:
            coordinated.kind === "revision_conflict"
              ? "content_fence_conflict"
              : "reservation_conflict"
        };
      } catch (error) {
        if (error instanceof ReservationConflictRollback) {
          return error.result;
        }
        throw error;
      }
    },

    async refreshPendingAuthorization(
      input: InboxV2PendingMaterializationAuthorizationRefreshCandidate
    ): Promise<ReauthorizeInboxV2PendingMaterializationResult> {
      return executePendingAuthorizationRefresh(
        {
          authorization,
          coordinator,
          files,
          sourceAuthorityRevalidator:
            revalidatePreparedSourceAttachmentAuthority
        },
        input
      );
    }
  });
  sqlSourceAttachmentReservationCommandPorts.add(port);
  sqlSourceAttachmentReservationCommandPortExecutors.set(
    port,
    executor as object
  );
  return port;
}

type PendingAuthorizationRefreshDependencies = Readonly<{
  authorization: InboxV2SourceAttachmentReservationAuthorizationPreparer;
  coordinator: Pick<
    InboxV2AuthorizedCommandCoordinator,
    "withAuthorizedCommandMutation"
  >;
  files: Pick<InboxV2FileObjectRepository, "reauthorizePendingMaterialization">;
  sourceAuthorityRevalidator(
    prepared: WithInboxV2AuthorizedCommandMutationInput,
    executor: RawSqlExecutor
  ): Promise<boolean>;
}>;

/** Relative-module test seam; never exported by the DB package surface. */
export function executeInboxV2PendingAttachmentAuthorizationRefreshForTest(
  dependencies: PendingAuthorizationRefreshDependencies,
  input: InboxV2PendingMaterializationAuthorizationRefreshCandidate
): Promise<ReauthorizeInboxV2PendingMaterializationResult> {
  return executePendingAuthorizationRefresh(dependencies, input);
}

async function executePendingAuthorizationRefresh(
  dependencies: PendingAuthorizationRefreshDependencies,
  input: InboxV2PendingMaterializationAuthorizationRefreshCandidate
): Promise<ReauthorizeInboxV2PendingMaterializationResult> {
  const prepared =
    await dependencies.authorization.preparePendingAuthorizationRefresh(input);
  if (prepared === null) {
    return { kind: "authorization_conflict" };
  }
  if (
    prepared.tenantId !== input.tenantId ||
    prepared.command.commandTypeId !==
      INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID
  ) {
    throw new TypeError(
      "Prepared source attachment authorization is outside the refresh command scope."
    );
  }

  try {
    const coordinated =
      await dependencies.coordinator.withAuthorizedCommandMutation(
        prepared,
        async (context) => {
          if (
            !(await dependencies.sourceAuthorityRevalidator(
              prepared,
              context.executor
            ))
          ) {
            throw new ReauthorizationRollback({
              kind: "authorization_conflict"
            });
          }
          const result =
            await dependencies.files.reauthorizePendingMaterialization(
              context,
              input
            );
          if (result.kind !== "refreshed") {
            throw new ReauthorizationRollback(result);
          }
          return { result };
        },
        async (context) => {
          const replay =
            await dependencies.files.reauthorizePendingMaterialization(
              context,
              input
            );
          const resultingJobRevision = incrementCounter(
            input.expectedJobRevision
          );
          const replayResult: ReauthorizeInboxV2PendingMaterializationResult =
            replay.kind === "already_current" &&
            replay.jobRevision === resultingJobRevision
              ? { kind: "refreshed", resultingJobRevision }
              : replay;
          return replayResult;
        }
      );
    if (
      coordinated.kind === "applied" ||
      coordinated.kind === "already_applied"
    ) {
      if (coordinated.result === undefined) {
        throw new TypeError(
          "Committed attachment authorization refresh omitted its durable result."
        );
      }
      return coordinated.result;
    }
    return { kind: "authorization_conflict" };
  } catch (error) {
    if (error instanceof ReauthorizationRollback) {
      return error.result;
    }
    throw error;
  }
}

/** Server-only composition guard; omitted from the package root. */
export function isSqlInboxV2SourceAttachmentReservationCommandPort(
  value: unknown
): value is InboxV2SqlSourceAttachmentReservationCommandPort {
  return (
    typeof value === "object" &&
    value !== null &&
    sqlSourceAttachmentReservationCommandPorts.has(value)
  );
}

/** Internal same-database composition guard; executor identity stays private. */
export function isSqlInboxV2SourceAttachmentReservationCommandPortForRepository(
  port: unknown,
  repository: unknown
): boolean {
  if (!isSqlInboxV2SourceAttachmentReservationCommandPort(port)) return false;
  const executor = sqlSourceAttachmentReservationCommandPortExecutors.get(port);
  return (
    executor !== undefined &&
    isSqlInboxV2SourceAttachmentMaterializationRepositoryForExecutor(
      repository,
      executor
    )
  );
}

function registerPreparedSourceAttachmentAuthorityFence(
  prepared: WithInboxV2AuthorizedCommandMutationInput,
  input: Readonly<{
    tenantId: string;
    sourceOccurrenceId: string;
    row: ReservationAuthorityRow;
    trustedServiceId: string;
  }>
): void {
  preparedSourceAttachmentAuthorityFences.set(prepared as object, {
    tenantId: inboxV2TenantIdSchema.parse(input.tenantId),
    sourceOccurrenceId: requiredString(
      input.sourceOccurrenceId,
      "source occurrence"
    ),
    trustedServiceId: input.trustedServiceId,
    materializationAuthorizationToken: requiredString(
      input.row.materialization_authorization_token,
      "SourceOccurrence materialization authorization token"
    ),
    sourceOccurrenceRevision: requiredCounter(
      input.row.source_occurrence_revision,
      "SourceOccurrence revision"
    )
  });
}

async function revalidatePreparedSourceAttachmentAuthority(
  prepared: WithInboxV2AuthorizedCommandMutationInput,
  executor: RawSqlExecutor
): Promise<boolean> {
  const fence = preparedSourceAttachmentAuthorityFences.get(prepared as object);
  if (fence === undefined) {
    throw new TypeError(
      "Prepared source attachment command omitted its authentic upstream authority fence."
    );
  }
  const result = await executor.execute<Record<string, unknown>>(sql`
    select occurrence.id
      from inbox_v2_source_occurrences occurrence
     where occurrence.tenant_id = ${fence.tenantId}
       and occurrence.id = ${fence.sourceOccurrenceId}
       and occurrence.revision = ${fence.sourceOccurrenceRevision}::bigint
       and occurrence.materialized_by_trusted_service_id =
         ${fence.trustedServiceId}
       and occurrence.materialization_authorization_token =
         ${fence.materializationAuthorizationToken}
     for share of occurrence
  `);
  return result.rows.length === 1;
}

type ReservationAuthorizationFacts = Readonly<{
  tenantId: string;
  jobId: string;
  attachmentId: string;
  expectedAttachmentRevision: string;
  sourceOccurrenceId: string | null;
  reservationNamespaceGeneration: string;
  idempotencyToken: string;
  correlationId: string;
  file: Readonly<{ id: string }>;
  content: Readonly<{
    conversationId: string;
    timelineItemId: string;
    parentMessageId: string;
    expectedParentRevision: string;
    visibilityBoundary: "external_work" | "internal";
    id: string;
    expectedRevision: string;
    blockKey: string;
  }>;
  reservation: Readonly<{
    fileVersionId: string;
    objectVersionId: string;
  }>;
}>;

function buildPendingAuthorizationRefreshMutation(input: {
  target: InboxV2PendingMaterializationAuthorizationRefreshCandidate;
  row: PendingRefreshAuthorityRow;
  trustedServiceId: string;
}): WithInboxV2AuthorizedCommandMutationInput {
  const { row, target, trustedServiceId } = input;
  const rowJobId = requiredString(row.job_id, "materialization job");
  const rowJobRevision = requiredCounter(
    row.job_revision,
    "materialization job revision"
  );
  if (
    rowJobId !== target.jobId ||
    rowJobRevision !== target.expectedJobRevision
  ) {
    throw new TypeError(
      "Pending materialization refresh row crossed its job revision fence."
    );
  }
  const visibility = requiredString(
    row.visibility_boundary,
    "materialization visibility boundary"
  );
  if (visibility !== "external_work" && visibility !== "internal") {
    throw new TypeError(
      "Pending materialization refresh has an unsupported visibility boundary."
    );
  }
  const reservation: ReservationAuthorizationFacts = {
    tenantId: target.tenantId,
    jobId: rowJobId,
    attachmentId: requiredString(row.attachment_id, "attachment"),
    expectedAttachmentRevision: requiredCounter(
      row.expected_attachment_revision,
      "attachment revision"
    ),
    sourceOccurrenceId: requiredString(
      row.source_occurrence_id,
      "source occurrence"
    ),
    reservationNamespaceGeneration: requiredString(
      row.reservation_namespace_generation,
      "reservation namespace generation"
    ),
    idempotencyToken: requiredString(
      row.idempotency_token,
      "materialization idempotency token"
    ),
    correlationId: requiredString(
      row.correlation_id,
      "materialization correlation"
    ),
    file: { id: requiredString(row.file_id, "file") },
    content: {
      conversationId: requiredString(row.conversation_id, "conversation"),
      timelineItemId: requiredString(row.timeline_item_id, "timeline item"),
      parentMessageId: requiredString(row.parent_message_id, "message"),
      expectedParentRevision: requiredCounter(
        row.expected_parent_revision,
        "origin message revision"
      ),
      visibilityBoundary: visibility,
      id: requiredString(row.timeline_content_id, "timeline content"),
      expectedRevision: requiredCounter(
        row.expected_content_revision,
        "origin content revision"
      ),
      blockKey: requiredString(row.content_block_key, "content block key")
    },
    reservation: {
      fileVersionId: requiredString(
        row.reserved_file_version_id,
        "reserved file version"
      ),
      objectVersionId: requiredString(
        row.reserved_object_version_id,
        "reserved object version"
      )
    }
  };
  return buildReservationAuthorizedMutation({
    reservation,
    row,
    trustedServiceId,
    mode: { kind: "reauthorization", expectedJobRevision: rowJobRevision }
  });
}

function buildReservationAuthorizedMutation(input: {
  reservation: ReservationAuthorizationFacts;
  row: ReservationAuthorityRow;
  trustedServiceId: string;
  mode?:
    | Readonly<{ kind: "reservation" }>
    | Readonly<{ kind: "reauthorization"; expectedJobRevision: string }>;
}): WithInboxV2AuthorizedCommandMutationInput {
  const { reservation, row, trustedServiceId } = input;
  const mode = input.mode ?? { kind: "reservation" as const };
  const tenantId = inboxV2TenantIdSchema.parse(reservation.tenantId);
  const occurredAt = requiredTimestamp(row.database_now, "database time");
  const timelineVisibility = requiredString(
    row.timeline_visibility,
    "timeline visibility"
  );
  if (
    requiredString(
      row.materialized_by_trusted_service_id,
      "SourceOccurrence materialization service"
    ) !== trustedServiceId ||
    timelineVisibility !==
      (reservation.content.visibilityBoundary === "external_work"
        ? "conversation_external"
        : "internal_participants")
  ) {
    throw new TypeError(
      "Source attachment reservation authority row is outside its trusted service or visibility scope."
    );
  }
  const sourceAuthorizationToken = requiredString(
    row.materialization_authorization_token,
    "SourceOccurrence materialization authorization token"
  );
  const sourceOccurrenceRevision = requiredCounter(
    row.source_occurrence_revision,
    "SourceOccurrence revision"
  );
  const sourceAuthorityDigest = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.source-attachment-materialization-authority@v1",
    tenantId,
    sourceOccurrenceId: reservation.sourceOccurrenceId,
    trustedServiceId,
    sourceAuthorizationToken,
    sourceOccurrenceRevision
  });
  const tenantRbacRevision = requiredCounter(
    row.tenant_rbac_revision,
    "tenant RBAC revision"
  );
  const sharedAccessRevision = requiredCounter(
    row.shared_access_revision,
    "shared access revision"
  );
  const resourceHeadId = requiredString(
    row.resource_head_id,
    "resource head id"
  );
  const resourceAccessRevision = requiredCounter(
    row.resource_access_revision,
    "resource access revision"
  );
  const structuralRelationRevision = requiredCounter(
    row.structural_relation_revision,
    "structural relation revision"
  );
  const collaboratorSetRevision = requiredCounter(
    row.collaborator_set_revision,
    "collaborator set revision"
  );
  const streamEpoch = requiredString(row.stream_epoch, "stream epoch");
  const refreshIdentity =
    mode.kind === "reauthorization"
      ? {
          expectedJobRevision: mode.expectedJobRevision,
          tenantRbacRevision,
          sharedAccessRevision,
          resourceHeadId,
          resourceAccessRevision,
          structuralRelationRevision,
          collaboratorSetRevision,
          streamEpoch,
          authorizedAt: occurredAt
        }
      : null;
  const identityDigest = calculateInboxV2CanonicalSha256({
    domain:
      mode.kind === "reservation"
        ? "core:inbox-v2.source-attachment-reservation-command@v2"
        : "core:inbox-v2.source-attachment-reauthorization-command@v1",
    tenantId,
    jobId: reservation.jobId,
    attachmentId: reservation.attachmentId,
    expectedAttachmentRevision: reservation.expectedAttachmentRevision,
    sourceOccurrenceId: reservation.sourceOccurrenceId,
    messageId: reservation.content.parentMessageId,
    originMessageRevision: reservation.content.expectedParentRevision,
    contentId: reservation.content.id,
    originContentRevision: reservation.content.expectedRevision,
    blockKey: reservation.content.blockKey,
    reservationNamespaceGeneration: reservation.reservationNamespaceGeneration,
    idempotencyToken: reservation.idempotencyToken,
    sourceAuthorityDigest,
    refreshIdentity
  });
  const suffix = identityDigest.replace(/^sha256:/u, "");
  const operationName =
    mode.kind === "reservation"
      ? "attachment-reservation"
      : "attachment-reauthorization";
  const authorizationEpoch = `authorization-epoch:${operationName}-${suffix}`;
  const notAfter = new Date(Date.parse(occurredAt) + 60_000).toISOString();
  const requiredPermissions = [
    timelineVisibility === "conversation_external"
      ? "core:conversation.read"
      : "core:conversation.internal.read",
    "core:file.upload"
  ].sort(compareText);
  const decisions = requiredPermissions
    .map((permissionId) => {
      const id = `authorization-decision:${operationName}-${suffix}-${permissionId === "core:file.upload" ? "file-upload" : "conversation-read"}`;
      const base = {
        tenantId,
        id,
        authorizationEpoch,
        principal: { kind: "trusted_service" as const, trustedServiceId },
        permissionId,
        resourceScopeId: "core:conversation",
        resource: {
          tenantId,
          entityTypeId: "core:conversation",
          entityId: reservation.content.conversationId
        },
        resourceAccessRevision,
        decisionRevision: "1",
        outcome: "allowed" as const,
        decidedAt: occurredAt,
        notAfter
      };
      return inboxV2AuthorizationDecisionReferenceSchema.parse({
        ...base,
        decisionHash: calculateInboxV2CanonicalSha256({
          domain: "core:inbox-v2.source-attachment-authorization-decision@v2",
          ...base,
          sourceAuthorityDigest
        })
      });
    })
    .sort((left, right) => compareText(left.id, right.id));
  const primaryDecision = decisions.find(
    ({ permissionId }) => permissionId === "core:file.upload"
  );
  if (primaryDecision === undefined) {
    throw new TypeError("Source attachment reservation lacks file.upload.");
  }

  const commandId = `command:${operationName}-${suffix}`;
  const requestId = `request:${operationName}-${suffix}`;
  const clientMutationId = `${operationName}:${suffix}`;
  const mutationId = `mutation:${operationName}-${suffix}`;
  const streamCommitId = `stream-commit:${operationName}-${suffix}`;
  const changeId = `change:${operationName}-${suffix}`;
  const eventId = `event:${operationName}-${suffix}`;
  const outboxIntentId = `outbox-intent:${operationName}-${suffix}`;
  const auditId = `audit:${operationName}-${suffix}`;
  const resultingRevision =
    mode.kind === "reservation"
      ? "1"
      : incrementCounter(mode.expectedJobRevision);
  const stateReference = {
    tenantId,
    recordId: reservation.jobId,
    schemaId:
      mode.kind === "reservation"
        ? "core:inbox-v2.attachment-materialization-reservation"
        : "core:inbox-v2.attachment-materialization-reauthorization",
    schemaVersion: "v1",
    digest: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.attachment-materialization-authorization-state@v2",
      tenantId,
      jobId: reservation.jobId,
      attachmentId: reservation.attachmentId,
      expectedAttachmentRevision: reservation.expectedAttachmentRevision,
      fileId: reservation.file.id,
      fileVersionId: reservation.reservation.fileVersionId,
      objectVersionId: reservation.reservation.objectVersionId,
      reservationNamespaceGeneration:
        reservation.reservationNamespaceGeneration,
      sourceAuthorityDigest,
      resultingRevision
    })
  };
  const entity = {
    tenantId,
    entityTypeId: "core:attachment-materialization-job",
    entityId: reservation.jobId
  };
  const change = {
    id: changeId,
    ordinal: 1,
    entity,
    resultingRevision,
    timeline: null,
    audience: "staff_only" as const,
    state: {
      kind: "upsert" as const,
      stateSchemaId: stateReference.schemaId,
      stateSchemaVersion: stateReference.schemaVersion,
      stateHash: stateReference.digest,
      payloadReference: stateReference,
      domainCommitReference: stateReference
    }
  };
  const event = {
    id: eventId,
    typeId: "core:attachment-materialization.changed",
    payloadSchemaId: stateReference.schemaId,
    payloadSchemaVersion: stateReference.schemaVersion,
    ordinal: "1",
    changeIds: [changeId],
    subjects: [entity],
    payloadReference: stateReference,
    correlationId: reservation.correlationId,
    commandIds: [commandId],
    clientMutationIds: [clientMutationId],
    authorizationDecisionRefs: decisions,
    accessEffect: { kind: "none" as const },
    occurredAt,
    recordedAt: occurredAt,
    eventHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.attachment-materialization-authorization-event@v2",
      tenantId,
      eventId,
      changeId,
      decisions,
      sourceAuthorityDigest,
      resultingRevision
    })
  };
  const outbox = {
    id: outboxIntentId,
    ordinal: 1,
    typeId: "core:projection.update" as const,
    handlerId: "core:attachment-materialization-projection",
    effectClass: "projection" as const,
    eventId,
    changeIds: [changeId],
    payloadReference: null,
    consumerDedupeKey: calculateInboxV2CanonicalSha256({
      domain:
        "core:inbox-v2.attachment-materialization-authorization-dedupe@v2",
      tenantId,
      jobId: reservation.jobId,
      resultingRevision
    }),
    correlationId: reservation.correlationId,
    availableAt: occurredAt,
    intentHash: calculateInboxV2CanonicalSha256({
      domain:
        "core:inbox-v2.attachment-materialization-authorization-intent@v2",
      tenantId,
      outboxIntentId,
      eventId,
      changeId
    })
  };
  const grantSourceIds = [
    internalRef("source-attachment-worker-policy", trustedServiceId),
    internalRef(
      "source-attachment-materialization-authority",
      sourceAuthorityDigest
    )
  ].sort(compareText);
  const facet = {
    ordinal: 1,
    dimension: "resource" as const,
    reference: {
      tenantId,
      entityTypeId: "core:conversation",
      entityId: internalRef(
        "source-attachment-conversation",
        reservation.content.conversationId
      )
    },
    relation: "affected" as const,
    facetHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.attachment-materialization-authorization-facet@v2",
      tenantId,
      conversationId: reservation.content.conversationId
    })
  };
  const auditBase = {
    id: auditId,
    actionId:
      mode.kind === "reservation"
        ? INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID
        : INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID,
    target: {
      tenantId,
      entityTypeId: "core:attachment-materialization-job",
      entityId: internalRef("source-attachment-job", reservation.jobId)
    },
    reasonCodeId:
      mode.kind === "reservation"
        ? "core:attachment-materialization-reserved"
        : "core:attachment-materialization-reauthorized",
    matchedPermissionIds: requiredPermissions,
    grantSourceIds,
    authorizationScopeIds: ["core:conversation"],
    overrideReasonCodeId: null,
    policyVersion: "v1",
    evidenceReference: stateReference,
    authorizationDecisionRefs: decisions,
    correlationId: reservation.correlationId,
    outcome: "succeeded" as const,
    revisionDeltaHash: computeInboxV2LeafHashDigest([]),
    previousAuditHash: null,
    occurredAt,
    recordedAt: occurredAt,
    expiresAt: notAfter,
    facets: [facet]
  };
  const audit = {
    ...auditBase,
    auditHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.attachment-materialization-authorization-audit@v2",
      ...auditBase
    })
  };
  const recordsWithoutCommitHash = {
    mutationId,
    relationKind: null,
    streamCommitId,
    expectedStreamEpoch: streamEpoch,
    audienceImpact: { kind: "none" as const },
    correlationId: reservation.correlationId,
    changes: [change],
    events: [event],
    outboxIntents: [outbox],
    audit
  };
  const mutation = {
    tenantId,
    command: {
      id: commandId,
      requestId,
      clientMutationId,
      commandTypeId:
        mode.kind === "reservation"
          ? INBOX_V2_ATTACHMENT_MATERIALIZATION_RESERVATION_COMMAND_TYPE_ID
          : INBOX_V2_ATTACHMENT_MATERIALIZATION_REAUTHORIZATION_COMMAND_TYPE_ID,
      requestHash: identityDigest,
      actor: { kind: "trusted_service" as const, trustedServiceId },
      authorizationDecisionId: primaryDecision.id,
      authorizationEpoch,
      authorizedAt: occurredAt,
      publicResultCode:
        mode.kind === "reservation"
          ? "core:attachment-materialization.changed"
          : "core:attachment-materialization.reauthorized",
      resultReference: stateReference,
      sensitiveResultReference: null
    },
    revisions: {
      expectedTenantRbacRevision: tenantRbacRevision,
      expectedSharedAccessRevision: sharedAccessRevision,
      advanceTenantRbac: false,
      advanceSharedAccess: false,
      employees: [],
      resources: [
        {
          resourceKind: "conversation" as const,
          resourceId: reservation.content.conversationId,
          resourceHeadId,
          expectedResourceAccessRevision: resourceAccessRevision,
          expectedStructuralRelationRevision: structuralRelationRevision,
          expectedCollaboratorSetRevision: collaboratorSetRevision,
          advance: "none" as const,
          advanceStructuralRelation: "none" as const,
          advanceCollaboratorSet: "none" as const
        }
      ]
    },
    records: {
      ...recordsWithoutCommitHash,
      commitHash: computeInboxV2TenantStreamManifestDigest(
        recordsWithoutCommitHash as never
      )
    },
    occurredAt
  };
  return mutation as unknown as WithInboxV2AuthorizedCommandMutationInput;
}

function internalRef(domain: string, value: string): string {
  return `internal-ref:${calculateInboxV2CanonicalSha256({
    domain: `core:inbox-v2.${domain}@v1`,
    value
  }).replace(/^sha256:/u, "")}`;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`Expected ${label} to be a non-empty string.`);
  }
  return value;
}

function requiredCounter(value: unknown, label: string): string {
  const text = String(value);
  if (!/^[1-9][0-9]*$/u.test(text)) {
    throw new TypeError(`Expected ${label} to be a positive counter.`);
  }
  return text;
}

function incrementCounter(value: string): string {
  return (BigInt(requiredCounter(value, "counter")) + 1n).toString();
}

function requiredTimestamp(value: unknown, label: string): string {
  const epoch =
    value instanceof Date ? value.getTime() : Date.parse(String(value));
  if (!Number.isFinite(epoch)) {
    throw new TypeError(`Expected ${label} to be a finite timestamp.`);
  }
  return new Date(epoch).toISOString();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
