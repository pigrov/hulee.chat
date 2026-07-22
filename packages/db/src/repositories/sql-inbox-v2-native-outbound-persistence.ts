import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2MessageContentDigest,
  inboxV2BigintCounterSchema,
  inboxV2MessageRevisionIdSchema,
  inboxV2MessageCreationCommitSchema,
  inboxV2MessageTransportAssociationCommitSchema,
  inboxV2SourceIdentityClaimIdSchema,
  inboxV2SourceOccurrenceSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentIdSchema,
  inboxV2TimelineContentSchema,
  type InboxV2BigintCounter,
  type InboxV2ConversationParticipant,
  type InboxV2MessageCreationCommit,
  type InboxV2SourceIdentityClaim,
  type InboxV2SourceOccurrence,
  type InboxV2SourceOccurrenceResolutionCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import {
  createInboxV2NativeOutboundCanonicalCallbacks,
  inboxV2NativeOutboundNoEffectDisposition,
  InboxV2NativeOutboundPersistenceInvariantError,
  type InboxV2NativeOutboundCanonicalCallbacks,
  type InboxV2NativeOutboundCanonicalPersistence,
  type InboxV2NativeOutboundEffectDisposition
} from "./sql-inbox-v2-native-outbound-reconciliation-adapter";
import {
  createSqlInboxV2AuthorizedCommandCoordinator,
  type InboxV2AuthorizationTransactionExecutor,
  type WithInboxV2AuthorizedCommandMutationInput
} from "./sql-inbox-v2-authorization-repository";
import {
  createSqlInboxV2ParticipantMembershipRepository,
  readInboxV2ConversationParticipantBySourceIdentityInTransaction
} from "./sql-inbox-v2-participant-membership-repository";
import { deriveInboxV2SourceOccurrenceResolutionTransitionId } from "./sql-inbox-v2-outbound-transport-repository";
import {
  InboxV2SourceMessageCallbackRollback,
  type InboxV2SourceMessageCanonicalResult,
  type InboxV2SourceMessageReconciliationConflictCode
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import { readInboxV2SourceOccurrenceInTransaction } from "./sql-inbox-v2-source-occurrence-repository";
import {
  createSqlInboxV2SourceIdentityClaimRepository,
  type InboxV2SourceIdentityClaimTransactionExecutor
} from "./sql-inbox-v2-source-identity-claim-repository";
import {
  loadInboxV2TimelineMessageAggregateInTransaction,
  prepareInboxV2MessageCreation,
  prepareInboxV2NativeOutboundTransportAssociation,
  readInboxV2MessageTransportLinkHeadInTransaction,
  sealInboxV2PreparedMessageCreation,
  sealInboxV2PreparedNativeOutboundTransportAssociation,
  type InboxV2LoadedTimelineMessageAggregate,
  type InboxV2MessageTransportAssociationCommit,
  type InboxV2SafeGenericEnvelope,
  type InboxV2TimelineMessageTransactionExecutor
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type CreateMessageInput = Parameters<
  InboxV2NativeOutboundCanonicalPersistence["createMessage"]
>[1];
type AttachOccurrenceInput = Parameters<
  InboxV2NativeOutboundCanonicalPersistence["attachOccurrence"]
>[1];

type PlanningConflict = Readonly<{
  kind: "conflict";
  code: InboxV2SourceMessageReconciliationConflictCode;
}>;

export type InboxV2NativeOutboundMessageCreationPersistencePlan = Readonly<{
  commit: InboxV2MessageCreationCommit;
  authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
}>;

export type InboxV2NativeOutboundOccurrenceAssociationPersistencePlan =
  Readonly<{
    commit: InboxV2MessageTransportAssociationCommit;
    sourceResolutionCommit: InboxV2SourceOccurrenceResolutionCommit;
    authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
  }>;

/**
 * Trusted provider-neutral planner for domain content plus the current
 * authorization/tenant-stream manifest. It never chooses or supplies a stream
 * position: the SQL authorization coordinator allocates that position while
 * holding the tenant head in the ambient reconciliation transaction.
 */
export type InboxV2NativeOutboundPersistencePlanner = Readonly<{
  planMessageCreation(
    transaction: RawSqlExecutor,
    input: CreateMessageInput
  ): Promise<
    | Readonly<{
        kind: "planned";
        plan: InboxV2NativeOutboundMessageCreationPersistencePlan;
      }>
    | PlanningConflict
  >;
  planOccurrenceAssociation(
    transaction: RawSqlExecutor,
    input: AttachOccurrenceInput
  ): Promise<
    | Readonly<{
        kind: "planned";
        plan: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan;
      }>
    | PlanningConflict
  >;
}>;

type CoordinatedNativeOutboundPersistenceResult =
  | Readonly<{
      kind: "committed";
      envelope: InboxV2SafeGenericEnvelope;
    }>
  | PlanningConflict;

type NativeOutboundPersistenceDependencies = Readonly<{
  coordinateMessageCreation(
    transaction: RawSqlExecutor,
    plan: InboxV2NativeOutboundMessageCreationPersistencePlan
  ): Promise<CoordinatedNativeOutboundPersistenceResult>;
  coordinateOccurrenceAssociation(
    transaction: RawSqlExecutor,
    plan: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan
  ): Promise<CoordinatedNativeOutboundPersistenceResult>;
  loadAuthorParticipant(
    transaction: RawSqlExecutor,
    input: Readonly<{
      tenantId: InboxV2ConversationParticipant["tenantId"];
      participantId: InboxV2ConversationParticipant["id"];
    }>
  ): Promise<InboxV2ConversationParticipant | null>;
}>;

export type CreateSqlInboxV2NativeOutboundPersistenceOptions = Readonly<{
  planner: InboxV2NativeOutboundPersistencePlanner;
  /** Test seam; production uses the authorized transaction-local SQL path. */
  dependencies?: Partial<NativeOutboundPersistenceDependencies>;
}>;

type NativeOutboundClosureRow = Readonly<{
  native_shape_count: unknown;
  stream_commit_count: unknown;
  authorization_command_count: unknown;
  change_count: unknown;
  exact_primary_change_count: unknown;
  exact_source_change_count: unknown;
  unexpected_change_count: unknown;
  event_count: unknown;
  exact_primary_event_count: unknown;
  exact_source_event_count: unknown;
  outbox_count: unknown;
  exact_primary_projection_count: unknown;
  exact_source_projection_count: unknown;
  provider_io_count: unknown;
  notification_count: unknown;
  outbound_dispatch_count: unknown;
  source_resolution_transition_count: unknown;
  atomic_source_materialization_count: unknown;
}>;

export type InboxV2NativeOutboundClosureIdentity = Readonly<{
  operationKind: "message_creation" | "transport_association";
  tenantId: string;
  messageId: string;
  messageRevision: string;
  authorParticipantId: string;
  sourceExternalIdentityId: string;
  sourceOccurrenceId: string;
  sourceOccurrenceRevision: string;
  resolutionTransitionId: string;
  externalMessageReferenceId: string;
  transportLinkId: string;
  transportLinkHeadRevision: string;
  streamPosition: InboxV2BigintCounter;
}>;

export type InboxV2NativeOutboundAuthorizationRequest =
  | Readonly<{
      kind: "message_creation";
      commit: InboxV2MessageCreationCommit;
    }>
  | Readonly<{
      kind: "occurrence_association";
      commit: InboxV2MessageTransportAssociationCommit;
      sourceResolutionCommit: InboxV2SourceOccurrenceResolutionCommit;
    }>;

export type InboxV2NativeOutboundAuthorizationPort = Readonly<{
  authorize(
    transaction: RawSqlExecutor,
    request: InboxV2NativeOutboundAuthorizationRequest
  ): Promise<
    | Readonly<{
        kind: "authorized";
        authorizedMutation: WithInboxV2AuthorizedCommandMutationInput;
      }>
    | PlanningConflict
  >;
}>;

export type CreateSqlInboxV2NativeOutboundReconciliationRuntimeOptions =
  Readonly<{
    authorization: InboxV2NativeOutboundAuthorizationPort;
  }>;

/**
 * Safe production composition. Callers can authorize the DB-owned exact
 * commit, but cannot inject a commit, persistence callback, dependency seam or
 * tenant-stream position.
 */
export function createSqlInboxV2NativeOutboundReconciliationRuntime(
  options: CreateSqlInboxV2NativeOutboundReconciliationRuntimeOptions
): InboxV2NativeOutboundCanonicalCallbacks {
  if (typeof options.authorization?.authorize !== "function") {
    throw new TypeError(
      "Native outbound runtime requires one trusted authorization port."
    );
  }
  return createSqlInboxV2NativeOutboundCanonicalCallbacks({
    planner: createSqlInboxV2NativeOutboundProductionPlanner(
      options.authorization
    )
  });
}

/** @internal Package tests use this to verify DB-owned deterministic plans. */
export function createSqlInboxV2NativeOutboundProductionPlanner(
  authorization: InboxV2NativeOutboundAuthorizationPort
): InboxV2NativeOutboundPersistencePlanner {
  return Object.freeze({
    async planMessageCreation(transaction, input) {
      const commit = await buildNativeOutboundMessageCreationCommit(
        transaction,
        input
      );
      if (commit === null) return callbackConflict();
      const authorized = await authorization.authorize(transaction, {
        kind: "message_creation",
        commit
      });
      if (authorized.kind === "conflict") return authorized;
      return {
        kind: "planned",
        plan: { commit, authorizedMutation: authorized.authorizedMutation }
      };
    },

    async planOccurrenceAssociation(transaction, input) {
      const planned = await buildNativeOutboundOccurrenceAssociationCommit(
        transaction,
        input
      );
      if (planned === null) return callbackConflict();
      const authorized = await authorization.authorize(transaction, {
        kind: "occurrence_association",
        commit: planned.commit,
        sourceResolutionCommit: planned.sourceResolutionCommit
      });
      if (authorized.kind === "conflict") return authorized;
      return {
        kind: "planned",
        plan: {
          ...planned,
          authorizedMutation: authorized.authorizedMutation
        }
      };
    }
  });
}

/**
 * Production persistence for provider-native outbound observations. Creation
 * and duplicate occurrence attachment both consume the authorization
 * coordinator through an ambient executor, so canonical writes, stream/event/
 * projection records and audit either commit together or roll back together.
 */
export function createSqlInboxV2NativeOutboundCanonicalPersistence(
  options: CreateSqlInboxV2NativeOutboundPersistenceOptions
): InboxV2NativeOutboundCanonicalPersistence {
  const dependencies: NativeOutboundPersistenceDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };

  return Object.freeze({
    async createMessage(transaction, input) {
      const planned = await options.planner.planMessageCreation(
        transaction,
        input
      );
      if (planned.kind === "conflict") return planned;
      const plan = normalizeMessageCreationPlan(planned.plan);
      const coordinated = await dependencies.coordinateMessageCreation(
        transaction,
        plan
      );
      if (coordinated.kind === "conflict") return coordinated;
      const result = creationCanonicalResult(plan.commit);
      const effectDisposition = await deriveDurableNoEffectDisposition(
        transaction,
        creationClosureIdentity(
          plan.commit,
          coordinated.envelope.streamPosition
        )
      );
      return {
        kind: "committed" as const,
        result,
        proof: { commit: plan.commit, effectDisposition }
      };
    },

    async attachOccurrence(transaction, input) {
      const planned = await options.planner.planOccurrenceAssociation(
        transaction,
        input
      );
      if (planned.kind === "conflict") return planned;
      const plan = normalizeAssociationPlan(planned.plan);
      const coordinated = await dependencies.coordinateOccurrenceAssociation(
        transaction,
        plan
      );
      if (coordinated.kind === "conflict") return coordinated;
      const authorParticipant = await dependencies.loadAuthorParticipant(
        transaction,
        {
          tenantId: plan.commit.tenantId,
          participantId: plan.commit.message.authorParticipant.id
        }
      );
      if (authorParticipant === null) {
        throw new InboxV2SourceMessageCallbackRollback();
      }
      const effectDisposition = await deriveDurableNoEffectDisposition(
        transaction,
        associationClosureIdentity(
          plan,
          authorParticipant,
          coordinated.envelope.streamPosition
        )
      );
      return {
        kind: "committed" as const,
        result: {
          externalMessageReference: plan.commit.externalMessageReference,
          sourceOccurrence: plan.commit.sourceOccurrence
        },
        proof: {
          commit: plan.commit,
          sourceResolutionCommit: plan.sourceResolutionCommit,
          authorParticipant,
          effectDisposition
        }
      };
    }
  });
}

/** Convenience composition for production SRC-006 callback wiring. */
export function createSqlInboxV2NativeOutboundCanonicalCallbacks(
  options: CreateSqlInboxV2NativeOutboundPersistenceOptions
): InboxV2NativeOutboundCanonicalCallbacks {
  return createInboxV2NativeOutboundCanonicalCallbacks(
    createSqlInboxV2NativeOutboundCanonicalPersistence(options)
  );
}

async function deriveDurableNoEffectDisposition(
  transaction: RawSqlExecutor,
  identity: InboxV2NativeOutboundClosureIdentity
): Promise<InboxV2NativeOutboundEffectDisposition> {
  const result = await transaction.execute<NativeOutboundClosureRow>(
    buildDeriveInboxV2NativeOutboundEffectDispositionSql(identity)
  );
  const row = result.rows[0];
  const creation = identity.operationKind === "message_creation";
  const expectedCardinality = creation ? 2 : 1;
  if (
    result.rows.length !== 1 ||
    databaseCount(row?.native_shape_count) !== 1 ||
    databaseCount(row?.stream_commit_count) !== 1 ||
    databaseCount(row?.authorization_command_count) !== 1 ||
    databaseCount(row?.change_count) !== expectedCardinality ||
    databaseCount(row?.exact_primary_change_count) !== 1 ||
    databaseCount(row?.exact_source_change_count) !== (creation ? 1 : 0) ||
    databaseCount(row?.unexpected_change_count) !== 0 ||
    databaseCount(row?.event_count) !== expectedCardinality ||
    databaseCount(row?.exact_primary_event_count) !== 1 ||
    databaseCount(row?.exact_source_event_count) !== (creation ? 1 : 0) ||
    databaseCount(row?.outbox_count) !== expectedCardinality ||
    databaseCount(row?.exact_primary_projection_count) !== 1 ||
    databaseCount(row?.exact_source_projection_count) !== (creation ? 1 : 0) ||
    databaseCount(row?.provider_io_count) !== 0 ||
    databaseCount(row?.notification_count) !== 0 ||
    databaseCount(row?.outbound_dispatch_count) !== 0 ||
    databaseCount(row?.source_resolution_transition_count) !== 1 ||
    databaseCount(row?.atomic_source_materialization_count) !==
      (creation ? 1 : 0)
  ) {
    throw invariant(
      "Native outbound durable closure is missing its exact authorization/source/reference/link projection or contains unread/work/provider/notification effects."
    );
  }
  return inboxV2NativeOutboundNoEffectDisposition;
}

/**
 * Derives the no-effect classification from the exact committed mutation.
 * Exact cardinality rejects extra unread/work changes, while the outbox and
 * dispatch checks reject provider I/O, notification and synthesized sends.
 */
export function buildDeriveInboxV2NativeOutboundEffectDispositionSql(
  identity: InboxV2NativeOutboundClosureIdentity
): SQL {
  const creation = identity.operationKind === "message_creation";
  const primaryEntityType = creation
    ? "core:message"
    : "core:message-transport-observation";
  const primaryEntityId = creation
    ? identity.messageId
    : identity.transportLinkId;
  const primaryRevision = creation
    ? identity.messageRevision
    : identity.transportLinkHeadRevision;
  const commandTypeId = creation
    ? "core:message.receive"
    : "core:message.native_outbound_occurrence.attach";
  return sql`
    with exact_stream_commit as materialized (
      select commit_row.*
        from inbox_v2_tenant_stream_commits commit_row
        join inbox_v2_tenant_stream_heads head_row
          on head_row.tenant_id = commit_row.tenant_id
         and head_row.stream_epoch = commit_row.stream_epoch
         and head_row.last_position >= commit_row.position
       where commit_row.tenant_id = ${identity.tenantId}
         and commit_row.position = ${identity.streamPosition}::bigint
    ), actual_change as materialized (
      select change_row.*
        from inbox_v2_tenant_stream_changes change_row
        join exact_stream_commit commit_row
          on commit_row.tenant_id = change_row.tenant_id
         and commit_row.id = change_row.stream_commit_id
         and commit_row.mutation_id = change_row.mutation_id
         and commit_row.position = change_row.stream_position
    ), primary_change as materialized (
      select change_row.* from actual_change change_row
       where change_row.entity_type_id = ${primaryEntityType}
         and change_row.entity_id = ${primaryEntityId}
         and change_row.resulting_revision = ${primaryRevision}::bigint
    ), source_change as materialized (
      select change_row.* from actual_change change_row
       where change_row.entity_type_id = 'core:source-occurrence'
         and change_row.entity_id = ${identity.sourceOccurrenceId}
         and change_row.resulting_revision =
             ${identity.sourceOccurrenceRevision}::bigint
    ), actual_event as materialized (
      select event_row.*
        from inbox_v2_domain_events event_row
        join exact_stream_commit commit_row
          on commit_row.tenant_id = event_row.tenant_id
         and commit_row.id = event_row.stream_commit_id
         and commit_row.mutation_id = event_row.mutation_id
         and commit_row.position = event_row.stream_position
    ), exact_outbox as materialized (
      select intent_row.*
        from inbox_v2_outbox_intents intent_row
        join exact_stream_commit commit_row
          on commit_row.tenant_id = intent_row.tenant_id
         and commit_row.id = intent_row.stream_commit_id
         and commit_row.mutation_id = intent_row.mutation_id
         and commit_row.position = intent_row.stream_position
    )
    select
      (
        select count(*)
          from inbox_v2_messages message_row
          join inbox_v2_action_attributions attribution_row
            on attribution_row.tenant_id = message_row.tenant_id
           and attribution_row.id = message_row.creation_attribution_id
          join inbox_v2_conversation_participants author_row
            on author_row.tenant_id = message_row.tenant_id
           and author_row.id = message_row.author_participant_id
           and author_row.conversation_id = message_row.conversation_id
          join inbox_v2_source_occurrences origin_occurrence
            on origin_occurrence.tenant_id = message_row.tenant_id
           and origin_occurrence.id = message_row.origin_source_occurrence_id
          join inbox_v2_source_occurrences observed_occurrence
            on observed_occurrence.tenant_id = message_row.tenant_id
           and observed_occurrence.id = ${identity.sourceOccurrenceId}
          join inbox_v2_source_occurrence_resolution_transitions transition_row
            on transition_row.tenant_id = message_row.tenant_id
           and transition_row.id = ${identity.resolutionTransitionId}
           and transition_row.source_occurrence_id = observed_occurrence.id
           and transition_row.resulting_revision = observed_occurrence.revision
           and transition_row.to_state = 'resolved'
          join inbox_v2_external_message_references reference_row
            on reference_row.tenant_id = message_row.tenant_id
           and reference_row.id = ${identity.externalMessageReferenceId}
           and reference_row.message_id = message_row.id
           and reference_row.timeline_item_id = message_row.timeline_item_id
           and transition_row.resolved_external_message_reference_id =
               reference_row.id
          join inbox_v2_message_transport_links link_row
            on link_row.tenant_id = message_row.tenant_id
           and link_row.id = ${identity.transportLinkId}
           and link_row.message_id = message_row.id
           and link_row.source_occurrence_id = observed_occurrence.id
           and link_row.external_message_reference_id = reference_row.id
         where message_row.tenant_id = ${identity.tenantId}
           and message_row.id = ${identity.messageId}
           and message_row.revision = ${identity.messageRevision}::bigint
           and message_row.author_participant_id =
               ${identity.authorParticipantId}
           and message_row.origin_kind = 'source_originated'
           and message_row.origin_source_direction = 'outbound'
           and message_row.origin_outbound_route_id is null
           and attribution_row.app_actor_kind is null
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
           and attribution_row.app_trusted_service_id is null
           and attribution_row.automation_kind is null
           and attribution_row.source_occurrence_id =
               message_row.origin_source_occurrence_id
           and author_row.subject_kind = 'source_external_identity'
           and author_row.subject_source_external_identity_id =
               ${identity.sourceExternalIdentityId}
           and origin_occurrence.provider_actor_kind =
               'source_external_identity'
           and origin_occurrence.provider_actor_source_external_identity_id =
               ${identity.sourceExternalIdentityId}
           and origin_occurrence.direction = 'outbound'
           and observed_occurrence.provider_actor_kind =
               'source_external_identity'
           and observed_occurrence.provider_actor_source_external_identity_id =
               ${identity.sourceExternalIdentityId}
           and observed_occurrence.direction = 'outbound'
           and observed_occurrence.resolution_state = 'resolved'
           and observed_occurrence.revision =
               ${identity.sourceOccurrenceRevision}::bigint
           and observed_occurrence.resolved_external_message_reference_id =
               reference_row.id
           and link_row.role = 'native_outbound'
           and link_row.recorded_stream_position =
               ${identity.streamPosition}::bigint
      )::text as native_shape_count,
      (select count(*) from exact_stream_commit)::text
        as stream_commit_count,
      (
        select count(*)
          from inbox_v2_auth_mutation_commits mutation_row
          join exact_stream_commit commit_row
            on commit_row.tenant_id = mutation_row.tenant_id
           and commit_row.mutation_id = mutation_row.mutation_id
           and commit_row.id = mutation_row.stream_commit_id
          join inbox_v2_auth_command_records command_row
            on command_row.tenant_id = mutation_row.tenant_id
           and command_row.id = mutation_row.command_record_id
           and command_row.mutation_id = mutation_row.mutation_id
         where command_row.state = 'completed'
           and command_row.command_type_id = ${commandTypeId}
      )::text as authorization_command_count,
      (select count(*) from actual_change)::text as change_count,
      (select count(*) from primary_change)::text
        as exact_primary_change_count,
      (select count(*) from source_change)::text
        as exact_source_change_count,
      (
        select count(*) from actual_change change_row
         where not exists (
           select 1 from primary_change primary_row
            where primary_row.id = change_row.id
         )
           and not exists (
             select 1 from source_change source_row
              where source_row.id = change_row.id
           )
      )::text as unexpected_change_count,
      (select count(*) from actual_event)::text as event_count,
      (
        select count(*) from actual_event event_row
         where event_row.type_id = 'core:message.changed'
           and exists (
             select 1 from primary_change change_row
              where event_row.change_ids ? change_row.id
           )
      )::text as exact_primary_event_count,
      (
        select count(*) from actual_event event_row
         where event_row.type_id = 'core:source-occurrence.changed'
           and exists (
             select 1 from source_change change_row
              where event_row.change_ids ? change_row.id
           )
      )::text as exact_source_event_count,
      (select count(*) from exact_outbox)::text as outbox_count,
      (
        select count(*) from exact_outbox intent_row
         where intent_row.effect_class = 'projection'
           and intent_row.type_id = 'core:projection.update'
           and intent_row.handler_id = 'core:inbox-projection'
           and exists (
             select 1 from primary_change change_row
              where intent_row.change_ids ? change_row.id
           )
      )::text as exact_primary_projection_count,
      (
        select count(*) from exact_outbox intent_row
         where intent_row.effect_class = 'projection'
           and intent_row.type_id = 'core:projection.update'
           and intent_row.handler_id = 'core:source-occurrence-projection'
           and exists (
             select 1 from source_change change_row
              where intent_row.change_ids ? change_row.id
           )
      )::text as exact_source_projection_count,
      (
        select count(*) from exact_outbox
         where effect_class = 'provider_io'
      )::text as provider_io_count,
      (
        select count(*) from exact_outbox
         where effect_class = 'notification'
      )::text as notification_count,
      (
        select count(*)
          from inbox_v2_outbound_dispatches dispatch_row
         where dispatch_row.tenant_id = ${identity.tenantId}
           and dispatch_row.message_id = ${identity.messageId}
      )::text as outbound_dispatch_count,
      (
        select count(*)
          from inbox_v2_source_occurrence_resolution_transitions transition_row
         where transition_row.tenant_id = ${identity.tenantId}
           and transition_row.id = ${identity.resolutionTransitionId}
           and transition_row.source_occurrence_id =
               ${identity.sourceOccurrenceId}
           and transition_row.resulting_revision =
               ${identity.sourceOccurrenceRevision}::bigint
           and transition_row.resolved_external_message_reference_id =
               ${identity.externalMessageReferenceId}
      )::text as source_resolution_transition_count,
      (
        select count(*)
          from inbox_v2_atomic_source_resolution_materializations row
          join exact_stream_commit commit_row
            on commit_row.tenant_id = row.tenant_id
           and commit_row.id = row.stream_commit_id
           and commit_row.mutation_id = row.mutation_id
           and commit_row.position = row.stream_position
         where row.source_occurrence_id = ${identity.sourceOccurrenceId}
           and row.message_id = ${identity.messageId}
           and row.external_message_reference_id =
               ${identity.externalMessageReferenceId}
      )::text as atomic_source_materialization_count
  `;
}

function normalizeMessageCreationPlan(
  input: InboxV2NativeOutboundMessageCreationPersistencePlan
): InboxV2NativeOutboundMessageCreationPersistencePlan {
  return {
    commit: inboxV2MessageCreationCommitSchema.parse(input.commit),
    authorizedMutation: input.authorizedMutation
  };
}

function normalizeAssociationPlan(
  input: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan
): InboxV2NativeOutboundOccurrenceAssociationPersistencePlan {
  return {
    commit: inboxV2MessageTransportAssociationCommitSchema.parse(input.commit),
    sourceResolutionCommit: inboxV2SourceOccurrenceResolutionCommitSchema.parse(
      input.sourceResolutionCommit
    ),
    authorizedMutation: input.authorizedMutation
  };
}

/** @internal Integration proof for the transaction-local occurrence-time lock. */
export async function loadInboxV2NativeOutboundEmployeeClaimAtOccurrenceInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2SourceIdentityClaim["tenantId"];
    sourceExternalIdentityId: InboxV2SourceIdentityClaim["sourceExternalIdentity"]["id"];
    observedAt: string;
  }>
): Promise<InboxV2SourceIdentityClaim | null> {
  const identityAnchor = await transaction.execute<{ id: unknown }>(sql`
    select identity_row.id
      from inbox_v2_source_external_identities identity_row
     where identity_row.tenant_id = ${input.tenantId}
       and identity_row.id = ${input.sourceExternalIdentityId}
     for share
  `);
  const claimHeadAnchor = await transaction.execute<{ id: unknown }>(sql`
    select head_row.source_external_identity_id as id
      from inbox_v2_source_identity_claim_heads head_row
     where head_row.tenant_id = ${input.tenantId}
       and head_row.source_external_identity_id =
           ${input.sourceExternalIdentityId}
     for share
  `);
  if (
    identityAnchor.rows.length !== 1 ||
    claimHeadAnchor.rows.length !== 1 ||
    identityAnchor.rows[0]?.id !== input.sourceExternalIdentityId ||
    claimHeadAnchor.rows[0]?.id !== input.sourceExternalIdentityId
  ) {
    throw invariant(
      "Native outbound source identity has no exact lockable claim anchor."
    );
  }
  const locked = await transaction.execute<{ id: unknown }>(sql`
    select claim_row.id
      from inbox_v2_source_identity_claims claim_row
     where claim_row.tenant_id = ${input.tenantId}
       and claim_row.source_external_identity_id =
           ${input.sourceExternalIdentityId}
       and claim_row.target_kind = 'employee'
       and claim_row.created_at <= ${input.observedAt}::timestamptz
       and (
         claim_row.status = 'active'
         or (
           claim_row.status = 'revoked'
           and claim_row.revoked_at > ${input.observedAt}::timestamptz
         )
       )
     order by claim_row.claim_version desc, claim_row.id
     limit 2
     for share
  `);
  if (locked.rows.length === 0) return null;
  if (locked.rows.length !== 1) {
    throw invariant(
      "Native outbound occurrence time resolves to multiple Employee identity claims."
    );
  }
  const claimId = inboxV2SourceIdentityClaimIdSchema.parse(locked.rows[0]?.id);
  const claim = await createSqlInboxV2SourceIdentityClaimRepository(
    transactionBoundClaimExecutor(transaction)
  ).findClaimById({
    tenantId: input.tenantId,
    claimId
  });
  const observedAt = Date.parse(input.observedAt);
  if (
    claim === null ||
    claim.sourceExternalIdentity.id !== input.sourceExternalIdentityId ||
    claim.target.kind !== "employee" ||
    Date.parse(claim.createdAt) > observedAt ||
    (claim.status === "revoked" &&
      (claim.revocation === null ||
        Date.parse(claim.revocation.revokedAt) <= observedAt))
  ) {
    throw invariant(
      "Native outbound Employee identity claim changed outside its locked occurrence-time interval."
    );
  }
  return claim;
}

function nativeClaimAtOccurrence(claim: InboxV2SourceIdentityClaim) {
  if (claim.target.kind !== "employee") {
    throw invariant(
      "Native outbound claim-at-occurrence must resolve an Employee."
    );
  }
  return {
    claim: {
      tenantId: claim.tenantId,
      kind: "source_identity_claim" as const,
      id: claim.id
    },
    claimVersion: claim.claimVersion,
    resolvedEmployee: claim.target.employee
  };
}

async function buildNativeOutboundMessageCreationCommit(
  transaction: RawSqlExecutor,
  input: CreateMessageInput
): Promise<InboxV2MessageCreationCommit | null> {
  const plan = input.plan;
  const intent = plan.intent;
  const actor = plan.sourceOccurrence.providerActor;
  if (
    intent.kind !== "message_create" ||
    intent.transportRole !== "native_outbound" ||
    actor?.kind !== "source_external_identity"
  ) {
    return null;
  }
  const tenantId = plan.sourceOccurrence.tenantId;
  const conversationBefore = plan.context.externalThreadMapping.conversation;
  const authorParticipant =
    await readInboxV2ConversationParticipantBySourceIdentityInTransaction(
      transaction,
      {
        tenantId,
        conversationId: conversationBefore.id,
        sourceExternalIdentityId: actor.sourceExternalIdentity.id
      }
    );
  if (authorParticipant === null) return null;
  const claimAtOccurrenceSnapshot =
    await loadInboxV2NativeOutboundEmployeeClaimAtOccurrenceInTransaction(
      transaction,
      {
        tenantId,
        sourceExternalIdentityId: actor.sourceExternalIdentity.id,
        observedAt: plan.sourceOccurrence.observedAt
      }
    );
  const claimAtOccurrence =
    claimAtOccurrenceSnapshot === null
      ? null
      : nativeClaimAtOccurrence(claimAtOccurrenceSnapshot);

  const committedAt = plan.materializedAt;
  const messageReference = nativeReference(
    tenantId,
    "message",
    intent.candidateMessageId
  );
  const timelineItemReference = nativeReference(
    tenantId,
    "timeline_item",
    intent.candidateTimelineItemId
  );
  const authorReference = nativeReference(
    tenantId,
    "conversation_participant",
    authorParticipant.id
  );
  const occurrenceReference = nativeReference(
    tenantId,
    "source_occurrence",
    plan.sourceOccurrence.id
  );
  const externalReference = input.candidateExternalMessageReference;
  if (
    externalReference.id !== plan.candidateExternalMessageReferenceId ||
    externalReference.message.id !== intent.candidateMessageId ||
    externalReference.timelineItem.id !== intent.candidateTimelineItemId
  ) {
    return null;
  }
  const resolution = resolveNativeOutboundOccurrence(
    plan.sourceOccurrence,
    externalReference,
    plan.materializedByTrustedServiceId,
    committedAt
  );
  const contentId = inboxV2TimelineContentIdSchema.parse(
    nativeDerivedId("timeline_content", plan.materializationToken, "content")
  );
  const blocks = [
    {
      blockKey: "source-content-pending",
      kind: "unsupported_source_content" as const,
      sourceOccurrence: occurrenceReference,
      providerContentKindId:
        plan.sourceOccurrence.descriptor.descriptorSchemaId,
      safeFallbackReasonId: "core:native-outbound-content-projection-pending"
    }
  ];
  const content = inboxV2TimelineContentSchema.parse({
    tenantId,
    id: contentId,
    state: {
      kind: "available",
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  });
  const timelineSequence = String(
    BigInt(conversationBefore.head.latestTimelineSequence) + 1n
  );
  const timelineItem = {
    tenantId,
    id: intent.candidateTimelineItemId,
    conversation: nativeReference(
      tenantId,
      "conversation",
      conversationBefore.id
    ),
    timelineSequence,
    subject: {
      kind: "message" as const,
      message: messageReference,
      messageRevision: "1"
    },
    visibility: "conversation_external" as const,
    activity: { kind: "eligible" as const },
    occurredAt: plan.sourceOccurrence.observedAt,
    receivedAt: plan.sourceOccurrence.recordedAt,
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const message = {
    tenantId,
    id: intent.candidateMessageId,
    conversation: timelineItem.conversation,
    timelineItem: timelineItemReference,
    authorParticipant: authorReference,
    origin: {
      kind: "source_originated" as const,
      originOccurrence: occurrenceReference,
      direction: "outbound" as const,
      claimAtOccurrence
    },
    appActor: null,
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content),
    referenceContext: { kind: "none" as const },
    lifecycle: { kind: "active" as const },
    revision: "1",
    createdAt: committedAt,
    updatedAt: committedAt
  };
  const transportLinkReference = nativeReference(
    tenantId,
    "message_transport_occurrence_link",
    intent.candidateTransportLinkId
  );
  return inboxV2MessageCreationCommitSchema.parse({
    tenantId,
    timelineAllocation: {
      tenantId,
      conversationBefore,
      items: [timelineItem],
      conversationAfter: {
        ...conversationBefore,
        head: {
          ...conversationBefore.head,
          latestTimelineSequence: timelineSequence,
          latestActivityItemId: timelineItem.id,
          latestActivityTimelineSequence: timelineSequence,
          latestActivityAt: timelineItem.occurredAt,
          revision: String(BigInt(conversationBefore.head.revision) + 1n),
          updatedAt: committedAt
        }
      },
      committedAt
    },
    authorParticipant,
    content,
    message,
    initialRevision: {
      tenantId,
      id: inboxV2MessageRevisionIdSchema.parse(
        nativeDerivedId(
          "message_revision",
          plan.materializationToken,
          "initial-revision"
        )
      ),
      message: messageReference,
      timelineItem: timelineItemReference,
      expectedPreviousRevision: null,
      messageRevision: "1",
      change: { kind: "created", content: message.content },
      actionAttribution: {
        actionParticipant: authorReference,
        appActor: null,
        sourceOccurrence: occurrenceReference,
        automationCausation: null
      },
      occurredAt: timelineItem.occurredAt,
      recordedAt: committedAt,
      recordRevision: "1",
      createdAt: committedAt
    },
    sourceOccurrence: resolution.after,
    claimAtOccurrenceSnapshot,
    sourceResolutionCommit: resolution,
    externalMessageReference: externalReference,
    originTransportLink: {
      tenantId,
      id: intent.candidateTransportLinkId,
      message: messageReference,
      sourceOccurrence: occurrenceReference,
      externalMessageReference: nativeReference(
        tenantId,
        "external_message_reference",
        externalReference.id
      ),
      role: "native_outbound",
      revision: "1",
      linkedAt: committedAt
    },
    originTransportLinkHead: {
      tenantId,
      message: messageReference,
      linkCount: "1",
      latestLink: transportLinkReference,
      revision: "1",
      updatedAt: committedAt
    },
    externalThreadMapping: plan.context.externalThreadMapping,
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: null,
    outboundBindingSnapshot: null,
    outboundDispatch: null,
    routeConsumption: null
  });
}

async function buildNativeOutboundOccurrenceAssociationCommit(
  transaction: RawSqlExecutor,
  input: AttachOccurrenceInput
): Promise<Readonly<{
  commit: InboxV2MessageTransportAssociationCommit;
  sourceResolutionCommit: InboxV2SourceOccurrenceResolutionCommit;
}> | null> {
  const plan = input.plan;
  const intent = plan.intent;
  const actor = plan.sourceOccurrence.providerActor;
  if (
    intent.kind !== "message_create" ||
    intent.transportRole !== "native_outbound" ||
    actor?.kind !== "source_external_identity"
  ) {
    return null;
  }
  const target = input.targetExternalMessageReference;
  const current = await loadInboxV2TimelineMessageAggregateInTransaction(
    transaction,
    {
      tenantId: target.tenantId,
      messageId: target.message.id
    }
  );
  if (
    current === null ||
    !nativeAssociationTargetMatches(current, target) ||
    current.message.origin.kind !== "source_originated" ||
    current.message.origin.direction !== "outbound" ||
    current.message.appActor !== null ||
    current.message.automationCausation !== null
  ) {
    return null;
  }
  const originOccurrence = await readInboxV2SourceOccurrenceInTransaction(
    transaction,
    {
      tenantId: target.tenantId,
      occurrenceId: current.message.origin.originOccurrence.id
    }
  );
  const linkHead = await readInboxV2MessageTransportLinkHeadInTransaction(
    transaction,
    {
      tenantId: target.tenantId,
      messageId: target.message.id
    }
  );
  if (originOccurrence === null || linkHead === null) return null;
  const resolution = resolveNativeOutboundOccurrence(
    plan.sourceOccurrence,
    target,
    plan.materializedByTrustedServiceId,
    plan.materializedAt
  );
  const commit = inboxV2MessageTransportAssociationCommitSchema.parse({
    tenantId: target.tenantId,
    message: current.message,
    timelineItem: current.timelineItem,
    linkHeadBefore: linkHead.head,
    sourceOccurrence: resolution.after,
    externalMessageReference: target,
    externalThreadMapping: plan.context.externalThreadMapping,
    occurrenceBinding: plan.context.sourceThreadBinding.binding,
    messageOriginProof: {
      kind: "source_originated",
      originOccurrence
    },
    link: {
      tenantId: target.tenantId,
      id: intent.candidateTransportLinkId,
      message: target.message,
      sourceOccurrence: nativeReference(
        target.tenantId,
        "source_occurrence",
        resolution.after.id
      ),
      externalMessageReference: nativeReference(
        target.tenantId,
        "external_message_reference",
        target.id
      ),
      role: "native_outbound",
      revision: "1",
      linkedAt: plan.materializedAt
    },
    linkHeadAfter: {
      ...linkHead.head,
      linkCount: String(BigInt(linkHead.head.linkCount) + 1n),
      latestLink: nativeReference(
        target.tenantId,
        "message_transport_occurrence_link",
        intent.candidateTransportLinkId
      ),
      revision: String(BigInt(linkHead.head.revision) + 1n),
      updatedAt: plan.materializedAt
    },
    committedAt: plan.materializedAt
  });
  return { commit, sourceResolutionCommit: resolution };
}

function resolveNativeOutboundOccurrence(
  before: InboxV2SourceOccurrence,
  reference: CreateMessageInput["candidateExternalMessageReference"],
  trustedServiceId: string,
  changedAt: string
): InboxV2SourceOccurrenceResolutionCommit {
  const after = inboxV2SourceOccurrenceSchema.parse({
    ...before,
    resolution: {
      state: "resolved",
      externalMessageReference: nativeReference(
        before.tenantId,
        "external_message_reference",
        reference.id
      )
    },
    revision: String(BigInt(before.revision) + 1n),
    updatedAt: changedAt
  });
  return inboxV2SourceOccurrenceResolutionCommitSchema.parse({
    tenantId: before.tenantId,
    expectedRevision: before.revision,
    resultingRevision: after.revision,
    changedAt,
    resolver: {
      kind: "trusted_service",
      trustedServiceId,
      resolutionToken: `native-resolution:${nativeDigest({
        occurrenceId: before.id,
        referenceId: reference.id,
        resultingRevision: after.revision
      })}`
    },
    before,
    after,
    resolvedReference: reference
  });
}

function nativeAssociationTargetMatches(
  current: InboxV2LoadedTimelineMessageAggregate,
  target: AttachOccurrenceInput["targetExternalMessageReference"]
): boolean {
  return (
    current.message.tenantId === target.tenantId &&
    current.message.id === target.message.id &&
    current.timelineItem.id === target.timelineItem.id &&
    current.message.timelineItem.id === target.timelineItem.id
  );
}

function nativeDerivedId(
  prefix: "message_revision" | "timeline_content",
  materializationToken: string,
  purpose: string
): string {
  return `${prefix}:${nativeDigest({
    domain: "core:inbox-v2.native-outbound-record-id",
    materializationToken,
    purpose
  })}`;
}

function nativeDigest(value: unknown): string {
  return calculateInboxV2CanonicalSha256(value).slice("sha256:".length);
}

function nativeReference<TKind extends string>(
  tenantId: string,
  kind: TKind,
  id: string
): Readonly<{ tenantId: string; kind: TKind; id: string }> {
  return { tenantId, kind, id };
}

function creationCanonicalResult(
  commit: InboxV2MessageCreationCommit
): InboxV2SourceMessageCanonicalResult {
  if (
    commit.externalMessageReference === null ||
    commit.sourceOccurrence === null
  ) {
    throw invariant(
      "Native outbound creation omitted its canonical source result."
    );
  }
  return {
    externalMessageReference: commit.externalMessageReference,
    sourceOccurrence: commit.sourceOccurrence
  };
}

function creationClosureIdentity(
  commit: InboxV2MessageCreationCommit,
  streamPosition: InboxV2BigintCounter
): InboxV2NativeOutboundClosureIdentity {
  const occurrence = commit.sourceOccurrence;
  const resolution = commit.sourceResolutionCommit;
  const reference = commit.externalMessageReference;
  const link = commit.originTransportLink;
  const linkHead = commit.originTransportLinkHead;
  const actor = occurrence?.providerActor;
  if (
    occurrence === null ||
    resolution === null ||
    reference === null ||
    link === null ||
    linkHead === null ||
    actor?.kind !== "source_external_identity" ||
    commit.authorParticipant.subject.kind !== "source_external_identity" ||
    commit.authorParticipant.subject.sourceExternalIdentity.id !==
      actor.sourceExternalIdentity.id
  ) {
    throw invariant(
      "Native outbound creation has no exact source identity closure."
    );
  }
  return {
    operationKind: "message_creation",
    tenantId: commit.tenantId,
    messageId: commit.message.id,
    messageRevision: commit.message.revision,
    authorParticipantId: commit.authorParticipant.id,
    sourceExternalIdentityId: actor.sourceExternalIdentity.id,
    sourceOccurrenceId: occurrence.id,
    sourceOccurrenceRevision: occurrence.revision,
    resolutionTransitionId:
      deriveInboxV2SourceOccurrenceResolutionTransitionId(resolution),
    externalMessageReferenceId: reference.id,
    transportLinkId: link.id,
    transportLinkHeadRevision: linkHead.revision,
    streamPosition
  };
}

function associationClosureIdentity(
  plan: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan,
  authorParticipant: InboxV2ConversationParticipant,
  streamPosition: InboxV2BigintCounter
): InboxV2NativeOutboundClosureIdentity {
  const commit = plan.commit;
  const actor = commit.sourceOccurrence.providerActor;
  if (
    actor?.kind !== "source_external_identity" ||
    authorParticipant.subject.kind !== "source_external_identity" ||
    authorParticipant.subject.sourceExternalIdentity.id !==
      actor.sourceExternalIdentity.id
  ) {
    throw invariant(
      "Native outbound association has no exact source identity closure."
    );
  }
  return {
    operationKind: "transport_association",
    tenantId: commit.tenantId,
    messageId: commit.message.id,
    messageRevision: commit.message.revision,
    authorParticipantId: authorParticipant.id,
    sourceExternalIdentityId: actor.sourceExternalIdentity.id,
    sourceOccurrenceId: commit.sourceOccurrence.id,
    sourceOccurrenceRevision: commit.sourceOccurrence.revision,
    resolutionTransitionId: deriveInboxV2SourceOccurrenceResolutionTransitionId(
      plan.sourceResolutionCommit
    ),
    externalMessageReferenceId: commit.externalMessageReference.id,
    transportLinkId: commit.link.id,
    transportLinkHeadRevision: commit.linkHeadAfter.revision,
    streamPosition
  };
}

function callbackConflict(): PlanningConflict {
  return {
    kind: "conflict",
    code: "source.message_reconciliation.callback_conflict"
  };
}

const defaultDependencies: NativeOutboundPersistenceDependencies = {
  coordinateMessageCreation,
  coordinateOccurrenceAssociation,

  async loadAuthorParticipant(transaction, input) {
    return createSqlInboxV2ParticipantMembershipRepository(
      transactionBoundTimelineExecutor(transaction)
    ).findParticipantById({
      tenantId: input.tenantId,
      participantId: input.participantId
    });
  }
};

async function coordinateMessageCreation(
  transaction: RawSqlExecutor,
  plan: InboxV2NativeOutboundMessageCreationPersistencePlan
): Promise<CoordinatedNativeOutboundPersistenceResult> {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(
    transactionBoundAuthorizationExecutor(transaction)
  );
  const coordinated = await coordinator.withAuthorizedAtomicMaterialization(
    plan.authorizedMutation,
    async (context) => {
      const prepared = await prepareInboxV2MessageCreation(context, {
        commit: plan.commit
      });
      if (prepared.kind !== "ready") {
        throw new InboxV2SourceMessageCallbackRollback();
      }
      return prepared.capability;
    },
    async (context, capability) => {
      const sealed = await sealInboxV2PreparedMessageCreation(context, {
        capability
      });
      return {
        result: { envelope: sealed.envelope },
        receipt: sealed.receipt
      };
    }
  );
  if (coordinated.kind === "applied") {
    return { kind: "committed", envelope: coordinated.result.envelope };
  }
  if (coordinated.kind === "already_applied") {
    return {
      kind: "committed",
      envelope: messageCreationEnvelope(
        plan.commit,
        inboxV2BigintCounterSchema.parse(coordinated.status.streamPosition)
      )
    };
  }
  return callbackConflict();
}

async function coordinateOccurrenceAssociation(
  transaction: RawSqlExecutor,
  plan: InboxV2NativeOutboundOccurrenceAssociationPersistencePlan
): Promise<CoordinatedNativeOutboundPersistenceResult> {
  const coordinator = createSqlInboxV2AuthorizedCommandCoordinator(
    transactionBoundAuthorizationExecutor(transaction)
  );
  const coordinated = await coordinator.withAuthorizedAtomicMaterialization(
    plan.authorizedMutation,
    async (context) => {
      const prepared = await prepareInboxV2NativeOutboundTransportAssociation(
        context,
        {
          commit: plan.commit,
          sourceResolutionCommit: plan.sourceResolutionCommit
        }
      );
      if (prepared.kind !== "ready") {
        throw new InboxV2SourceMessageCallbackRollback();
      }
      return prepared.capability;
    },
    async (context, capability) => {
      const sealed =
        await sealInboxV2PreparedNativeOutboundTransportAssociation(context, {
          capability
        });
      return {
        result: { envelope: sealed.envelope },
        receipt: sealed.receipt
      };
    }
  );
  if (coordinated.kind === "applied") {
    return { kind: "committed", envelope: coordinated.result.envelope };
  }
  if (coordinated.kind === "already_applied") {
    return {
      kind: "committed",
      envelope: transportAssociationEnvelope(
        plan.commit,
        inboxV2BigintCounterSchema.parse(coordinated.status.streamPosition)
      )
    };
  }
  return callbackConflict();
}

function messageCreationEnvelope(
  commit: InboxV2MessageCreationCommit,
  streamPosition: InboxV2BigintCounter
): InboxV2SafeGenericEnvelope {
  const timelineItem = commit.timelineAllocation.items[0];
  if (timelineItem === undefined) {
    throw invariant("Native outbound Message commit has no TimelineItem.");
  }
  return {
    tenantId: commit.tenantId,
    entityKind: "message",
    entityId: commit.message.id,
    entityRevision: commit.message.revision,
    timelineItemId: timelineItem.id,
    timelineSequence: timelineItem.timelineSequence,
    streamPosition,
    changeKind: "created",
    occurredAt: commit.initialRevision.occurredAt
  };
}

function transportAssociationEnvelope(
  commit: InboxV2MessageTransportAssociationCommit,
  streamPosition: InboxV2BigintCounter
): InboxV2SafeGenericEnvelope {
  return {
    tenantId: commit.tenantId,
    entityKind: "message_transport",
    entityId: commit.link.id,
    entityRevision: commit.linkHeadAfter.revision,
    timelineItemId: commit.timelineItem.id,
    timelineSequence: commit.timelineItem.timelineSequence,
    streamPosition,
    changeKind: "transport_link.native_outbound",
    occurredAt: commit.committedAt
  };
}

function transactionBoundAuthorizationExecutor(
  transaction: RawSqlExecutor
): InboxV2AuthorizationTransactionExecutor {
  return {
    transactionScope: "ambient",
    execute: transaction.execute.bind(transaction),
    async transaction(work) {
      return work(transaction);
    }
  };
}

function transactionBoundTimelineExecutor(
  transaction: RawSqlExecutor
): InboxV2TimelineMessageTransactionExecutor {
  return {
    transactionScope: "ambient",
    execute: transaction.execute.bind(transaction),
    async transaction(work) {
      return work(transaction);
    }
  };
}

function transactionBoundClaimExecutor(
  transaction: RawSqlExecutor
): InboxV2SourceIdentityClaimTransactionExecutor {
  return {
    execute: transaction.execute.bind(transaction),
    async transaction(work) {
      return work(transaction as never);
    }
  };
}

function databaseCount(value: unknown): number {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("invalid count");
    }
    return Number(parsed);
  } catch {
    throw invariant(
      "Native outbound durable closure returned an invalid count."
    );
  }
}

function invariant(
  message: string
): InboxV2NativeOutboundPersistenceInvariantError {
  return new InboxV2NativeOutboundPersistenceInvariantError(message);
}
