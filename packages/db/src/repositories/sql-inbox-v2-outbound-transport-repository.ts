import {
  calculateInboxV2OutboxLeaseTokenHash,
  createInboxV2MixedProviderArtifactOutcomeDiagnostic,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2RouteFailureOutboxFinalization,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  inboxV2ExternalMessageReferenceIdSchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchIdSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2MessageIdSchema,
  inboxV2MessageReactionCommitSchema,
  inboxV2OutboundMultiSendOperationSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboxIntentSchema,
  inboxV2OutboxIntentIdSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2OutboxWorkStateSchema,
  inboxV2PayloadReferenceSchema,
  inboxV2RepositoryTenantContextSchema,
  inboxV2ThreadRoutePolicySchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ExternalMessageReference,
  type InboxV2ExternalMessageReferenceId,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundDispatchArtifact,
  type InboxV2OutboundDispatchArtifactAssociationCommit,
  type InboxV2OutboundDispatchAttempt,
  type InboxV2OutboundDispatchAttemptCommit,
  type InboxV2OutboundDispatchId,
  type InboxV2OutboundDispatchReconciliationCommit,
  type InboxV2OutboundDispatchReconciliationDecision,
  type InboxV2OutboundDispatchRerouteCommit,
  type InboxV2OutboundDispatchRouteFailureCommit,
  type InboxV2OutboundMultiSendOperation,
  type InboxV2OutboundRoute,
  type InboxV2OutboundRouteResolutionCommit,
  type InboxV2FinalizeOutboxInput,
  type InboxV2MessageId,
  type InboxV2MessageReactionCommit,
  type InboxV2OutboxIntent,
  type InboxV2OutboxWorkItem,
  type InboxV2SourceOccurrenceResolutionCommit,
  type InboxV2TenantId,
  type InboxV2ThreadRoutePolicy
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";
import { createHash } from "node:crypto";

import type { HuleeDatabase } from "../client";
import {
  registerInboxV2AtomicOutboundRerouteProof,
  registerInboxV2AtomicOutboundRouteProof
} from "./sql-inbox-v2-atomic-materialization-internal";
import {
  assertInboxV2AuthorizedCommandMutationContext,
  type InboxV2AuthorizedCommandMutationContext
} from "./sql-inbox-v2-authorization-repository";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import { loadInboxV2OutboundDispatchContentPlan } from "./sql-inbox-v2-file-object-repository";
import {
  buildFinalizeInboxV2OutboxSql,
  buildInsertInboxV2OutboxOutcomeSql
} from "./sql-inbox-v2-repository-outbox";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const TRANSPORT_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const TRANSPORT_SNAPSHOT_TRANSACTION_CONFIG = {
  isolationLevel: "repeatable read"
} as const;
const TRANSPORT_TRANSACTION_ATTEMPTS = 3;
const MESSAGE_DISPATCH_PAGE_DEFAULT = 50;
const MESSAGE_DISPATCH_PAGE_MAX = 128;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);

export type InboxV2OutboundTransportTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult>;
};

export type PersistInboxV2RoutePolicyResult =
  | Readonly<{ kind: "committed" | "already_exists" }>
  | Readonly<{
      kind:
        | "policy_id_conflict"
        | "policy_scope_conflict"
        | "stale_policy_revision"
        | "binding_not_found"
        | "binding_scope_conflict";
    }>;

export type PersistInboxV2RouteResolutionResult =
  | Readonly<{ kind: "not_selected" }>
  | Readonly<{
      kind: "committed" | "already_exists";
      route: InboxV2OutboundRoute;
    }>
  | Readonly<{
      kind:
        | "route_id_conflict"
        | "route_token_conflict"
        | "policy_conflict"
        | "binding_not_found"
        | "binding_fence_conflict"
        | "binding_inactive"
        | "original_dispatch_not_found"
        | "original_dispatch_conflict"
        | "original_provider_intent_conflict";
    }>;

export type InboxV2RouteResolutionConflictResult = Readonly<{
  kind:
    | "route_id_conflict"
    | "route_token_conflict"
    | "policy_conflict"
    | "binding_not_found"
    | "binding_fence_conflict"
    | "binding_inactive"
    | "original_dispatch_not_found"
    | "original_dispatch_conflict"
    | "original_provider_intent_conflict";
}>;

export class InboxV2RouteResolutionRollbackError extends Error {
  constructor(readonly result: InboxV2RouteResolutionConflictResult) {
    super(`Rollback route resolution: ${result.kind}`);
    this.name = "InboxV2RouteResolutionRollbackError";
  }
}

class ArtifactAssociationRollbackError extends Error {
  constructor(readonly result: AssociateInboxV2DispatchArtifactResult) {
    super(`Rollback artifact association: ${result.kind}`);
    this.name = "ArtifactAssociationRollbackError";
  }
}

class ProviderResultArtifactRollbackError extends Error {
  constructor(readonly result: ApplyInboxV2ProviderResultFencedResult) {
    super(`Rollback provider result artifacts: ${result.kind}`);
    this.name = "ProviderResultArtifactRollbackError";
  }
}

export type CreateInboxV2OutboundDispatchResult =
  | Readonly<{
      kind: "committed" | "already_exists";
      dispatch: InboxV2OutboundDispatch;
    }>
  | Readonly<{
      kind:
        | "dispatch_id_conflict"
        | "route_already_dispatched"
        | "route_not_found"
        | "message_not_found"
        | "message_route_conflict"
        | "multi_send_required";
    }>;

export type ApplyInboxV2DispatchAttemptResult =
  | Readonly<{ kind: "committed" | "already_applied" }>
  | Readonly<{
      kind:
        | "dispatch_not_found"
        | "route_not_found"
        | "binding_fence_conflict"
        | "dispatch_cancelled"
        | "dispatch_state_conflict"
        | "attempt_id_conflict"
        | "attempt_number_conflict"
        | "claim_token_conflict"
        | "attempt_state_conflict"
        | "artifact_retry_unsafe";
    }>;

export type ApplyInboxV2ReconciliationResult =
  | Readonly<{ kind: "committed" | "already_applied" }>
  | Readonly<{
      kind:
        | "dispatch_not_found"
        | "dispatch_state_conflict"
        | "unknown_attempt_not_found"
        | "decision_conflict"
        | "attempt_already_reconciled"
        | "artifact_retry_unsafe";
    }>;

export type InboxV2ProviderIoOutboxLeaseFence = Readonly<
  Pick<
    InboxV2FinalizeOutboxInput,
    "context" | "intentId" | "workerId" | "leaseToken" | "expectedLeaseRevision"
  > & {
    expectedHandlerId: InboxV2OutboxIntent["handlerId"];
  }
>;

export type InboxV2ProviderIoOutboxFenceFailure =
  | Readonly<{ kind: "outbox_not_found" }>
  | Readonly<{
      kind: "outbox_not_leased";
      currentState: InboxV2OutboxWorkItem["state"];
    }>
  | Readonly<{
      kind:
        | "outbox_stale_token"
        | "outbox_lease_expired"
        | "outbox_lease_revision_conflict";
      currentLeaseRevision: InboxV2FinalizeOutboxInput["expectedLeaseRevision"];
    }>
  | Readonly<{ kind: "outbox_intent_conflict" }>
  | Readonly<{ kind: "outbox_attempt_lease_conflict" }>;

export type ApplyInboxV2FencedDispatchAttemptResult =
  | ApplyInboxV2DispatchAttemptResult
  | InboxV2ProviderIoOutboxFenceFailure
  | Readonly<{
      kind:
        | "outbox_dispatch_content_plan_not_found"
        | "outbox_dispatch_content_plan_conflict";
    }>;

export type ApplyInboxV2ProviderResultFencedResult =
  | ApplyInboxV2FencedDispatchAttemptResult
  | Readonly<{ kind: "dispatch_artifact_set_conflict" }>;

export type ApplyInboxV2FencedReconciliationResult =
  | ApplyInboxV2ReconciliationResult
  | InboxV2ProviderIoOutboxFenceFailure;

export type LoadInboxV2ClaimedProviderIoResult =
  | Readonly<{
      kind: "loaded";
      intent: InboxV2OutboxIntent;
      dispatch: InboxV2OutboundDispatch;
      contentPlan: InboxV2OutboundDispatchContentPlan;
    }>
  | InboxV2ProviderIoOutboxFenceFailure
  | Readonly<{
      kind:
        | "outbox_dispatch_not_found"
        | "outbox_dispatch_content_plan_not_found";
    }>;

export type AppendInboxV2DispatchArtifactResult =
  | Readonly<{ kind: "committed" | "already_exists" }>
  | Readonly<{
      kind:
        | "attempt_not_found"
        | "artifact_id_conflict"
        | "artifact_ordinal_conflict";
    }>;

export type AssociateInboxV2DispatchArtifactResult =
  | Readonly<{ kind: "committed" | "already_exists" }>
  | Readonly<{
      kind:
        | "artifact_not_found"
        | "artifact_chain_conflict"
        | "occurrence_not_found"
        | "occurrence_revision_conflict"
        | "external_reference_conflict"
        | "association_conflict";
    }>;

export type CreateInboxV2MultiSendResult =
  | Readonly<{ kind: "committed" | "already_exists" }>
  | Readonly<{
      kind:
        | "operation_id_conflict"
        | "operation_token_conflict"
        | "dispatch_set_conflict"
        | "route_not_found"
        | "message_not_found";
    }>;

export type InboxV2MessageDispatchCursor = Readonly<{
  createdAt: string;
  dispatchId: InboxV2OutboundDispatchId;
}>;

export type InboxV2MessageDispatchPage = Readonly<{
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  items: readonly InboxV2OutboundDispatch[];
  nextAfter: InboxV2MessageDispatchCursor | null;
  hasMore: boolean;
}>;

export type InboxV2OutboundTransportRepository = Readonly<{
  findExternalMessageReference(input: {
    tenantId: InboxV2TenantId;
    referenceId: InboxV2ExternalMessageReferenceId;
  }): Promise<InboxV2ExternalMessageReference | null>;
  findDispatch(input: {
    tenantId: InboxV2TenantId;
    dispatchId: InboxV2OutboundDispatchId;
  }): Promise<InboxV2OutboundDispatch | null>;
  /** Loads the immutable provider intent and dispatch only under its live lease. */
  loadClaimedProviderIo(
    input: Readonly<{
      outboxLease: InboxV2ProviderIoOutboxLeaseFence;
    }>
  ): Promise<LoadInboxV2ClaimedProviderIoResult>;
  listMessageDispatches(input: {
    tenantId: InboxV2TenantId;
    messageId: InboxV2MessageId;
    after?: InboxV2MessageDispatchCursor | null;
    limit?: number;
  }): Promise<InboxV2MessageDispatchPage>;
  persistRoutePolicy(
    policy: InboxV2ThreadRoutePolicy
  ): Promise<PersistInboxV2RoutePolicyResult>;
  persistRouteResolution(
    commit: InboxV2OutboundRouteResolutionCommit
  ): Promise<PersistInboxV2RouteResolutionResult>;
  createDispatch(
    dispatch: InboxV2OutboundDispatch
  ): Promise<CreateInboxV2OutboundDispatchResult>;
  applyAttempt(
    commit: InboxV2OutboundDispatchAttemptCommit
  ): Promise<ApplyInboxV2DispatchAttemptResult>;
  /** Runtime provider I/O must use this lease-bound entrypoint. */
  applyAttemptFenced(
    input: Readonly<{
      outboxLease: InboxV2ProviderIoOutboxLeaseFence;
      commit: InboxV2OutboundDispatchAttemptCommit;
    }>
  ): Promise<ApplyInboxV2FencedDispatchAttemptResult>;
  /**
   * Atomically appends the complete planned artifact outcome set and closes
   * the exact provider attempt under the same live outbox lease fence.
   */
  applyProviderResultFenced(
    input: Readonly<{
      outboxLease: InboxV2ProviderIoOutboxLeaseFence;
      contentPlanDigestSha256: InboxV2OutboundDispatchContentPlan["planDigestSha256"];
      commit: Extract<
        InboxV2OutboundDispatchAttemptCommit,
        { kind: "complete_attempt" }
      >;
      artifacts: readonly InboxV2OutboundDispatchArtifact[];
    }>
  ): Promise<ApplyInboxV2ProviderResultFencedResult>;
  applyRouteFailure(
    commit: InboxV2OutboundDispatchRouteFailureCommit
  ): Promise<ApplyInboxV2DispatchAttemptResult>;
  /** Zero-I/O route failures must consume the same live provider-work lease. */
  applyRouteFailureFenced(
    input: Readonly<{
      outboxLease: InboxV2ProviderIoOutboxLeaseFence;
      commit: InboxV2OutboundDispatchRouteFailureCommit;
    }>
  ): Promise<ApplyInboxV2FencedDispatchAttemptResult>;
  reconcile(
    commit: InboxV2OutboundDispatchReconciliationCommit
  ): Promise<ApplyInboxV2ReconciliationResult>;
  /** Runtime reconciliation must use this lease-bound entrypoint. */
  reconcileFenced(
    input: Readonly<{
      outboxLease: InboxV2ProviderIoOutboxLeaseFence;
      commit: InboxV2OutboundDispatchReconciliationCommit;
    }>
  ): Promise<ApplyInboxV2FencedReconciliationResult>;
  associateArtifact(
    commit: InboxV2OutboundDispatchArtifactAssociationCommit
  ): Promise<AssociateInboxV2DispatchArtifactResult>;
  createMultiSend(
    input: Readonly<{
      operation: InboxV2OutboundMultiSendOperation;
      dispatches: readonly InboxV2OutboundDispatch[];
    }>
  ): Promise<CreateInboxV2MultiSendResult>;
}>;

export type InboxV2FencedOutboundTransportRuntimeRepository = Readonly<
  Pick<
    InboxV2OutboundTransportRepository,
    | "findDispatch"
    | "loadClaimedProviderIo"
    | "applyAttemptFenced"
    | "applyProviderResultFenced"
    | "applyRouteFailureFenced"
    | "reconcileFenced"
  >
>;

type IdRow = { id: unknown };
type BindingAnchorRow = {
  binding_id: unknown;
  external_thread_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
};
type BindingRouteFenceRow = BindingAnchorRow & {
  binding_revision: unknown;
  account_generation: unknown;
  binding_generation: unknown;
  remote_access_revision: unknown;
  administrative_revision: unknown;
  capability_revision: unknown;
  provider_access_revision: unknown;
  route_descriptor_revision: unknown;
  remote_access_state: unknown;
  administrative_state: unknown;
  runtime_health_state: unknown;
};
type BindingFenceRow = BindingRouteFenceRow & {
  runtime_health_revision: unknown;
  updated_at: unknown;
};
type ReactionSourceAccountIdentityRow = {
  source_account_id: unknown;
  source_connection_id: unknown;
  state: unknown;
  revision: unknown;
  account_generation: unknown;
  updated_at: unknown;
};
type ReactionRoutePolicyRow = {
  revision: unknown;
  conversation_id: unknown;
  external_thread_id: unknown;
  operation_id: unknown;
  content_kind_id: unknown;
  required_conversation_permission_id: unknown;
  preferred_binding_id: unknown;
  fallback_kind: unknown;
  fallback_binding_count: unknown;
};
type ReactionCapabilityRow = {
  capability_id: unknown;
};
type ExistingPolicyRow = {
  policy_id: unknown;
  revision: unknown;
  conversation_id: unknown;
  external_thread_id: unknown;
  operation_id: unknown;
  content_kind_id: unknown;
  route_policy_catalog_id: unknown;
  required_conversation_permission_id: unknown;
  preferred_binding_id: unknown;
  fallback_kind: unknown;
  fallback_binding_count: unknown;
  fallback_bindings_digest_sha256: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type ExistingRouteRow = {
  id: unknown;
  mutation_token: unknown;
  idempotency_token: unknown;
  correlation_token: unknown;
  conversation_id: unknown;
  external_thread_id: unknown;
  source_thread_binding_id: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  binding_revision: unknown;
  created_at: unknown;
};
type ExistingRerouteOriginalRouteRow = BindingAnchorRow & {
  id: unknown;
  conversation_id: unknown;
  external_thread_id: unknown;
  operation_id: unknown;
  content_kind_id: unknown;
  binding_revision: unknown;
  account_generation: unknown;
  binding_generation: unknown;
  remote_access_revision: unknown;
  administrative_revision: unknown;
  capability_revision: unknown;
  route_descriptor_revision: unknown;
  created_at: unknown;
};
type ExistingDispatchRow = {
  id: unknown;
  message_id: unknown;
  route_id: unknown;
  multi_send_operation_id: unknown;
  state: unknown;
  attempt_count: unknown;
  active_attempt_id: unknown;
  last_attempt_id: unknown;
  retry_authorization_decision_id: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type DispatchReadRow = ExistingDispatchRow & {
  tenant_id: unknown;
};
type ExistingRerouteProviderIntentRow = {
  id: unknown;
  type_id: unknown;
  effect_class: unknown;
  payload_reference: unknown;
  work_state: unknown;
};

export function createSqlInboxV2OutboundTransportRepository(
  executor: InboxV2OutboundTransportTransactionExecutor | HuleeDatabase
): InboxV2OutboundTransportRepository {
  const transactionExecutor =
    executor as unknown as InboxV2OutboundTransportTransactionExecutor;

  return {
    async findExternalMessageReference(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const referenceId = inboxV2ExternalMessageReferenceIdSchema.parse(
        input.referenceId
      );
      return runTransportSnapshotTransaction(
        transactionExecutor,
        async (transaction) => {
          const row = await loadExternalMessageReference(transaction, {
            tenantId,
            referenceId,
            keyDigest: null
          });
          return row === null
            ? null
            : mapExternalMessageReferenceRow(row, tenantId);
        }
      );
    },

    async findDispatch(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const dispatchId = inboxV2OutboundDispatchIdSchema.parse(
        input.dispatchId
      );
      return runTransportSnapshotTransaction(
        transactionExecutor,
        async (transaction) => {
          const result = await transaction.execute<DispatchReadRow>(
            buildFindInboxV2OutboundDispatchSql({ tenantId, dispatchId })
          );
          assertAtMostOneRow(result.rows, "Outbound dispatch lookup");
          const row = result.rows[0];
          return row === undefined ? null : mapDispatchReadRow(row, tenantId);
        }
      );
    },

    async loadClaimedProviderIo(input) {
      const outboxLease = parseProviderIoOutboxLeaseFence(input.outboxLease);
      return runTransportTransaction(
        transactionExecutor,
        async (transaction) => {
          const fenced = await lockAndValidateProviderIoOutboxLease(
            transaction,
            outboxLease,
            null
          );
          if (fenced.kind !== "fenced") return fenced;
          const result = await transaction.execute<DispatchReadRow>(
            buildFindInboxV2OutboundDispatchSql({
              tenantId: outboxLease.context.tenantId,
              dispatchId: fenced.dispatchId
            })
          );
          assertAtMostOneRow(
            result.rows,
            "Claimed provider I/O dispatch lookup"
          );
          const row = result.rows[0];
          if (row === undefined) return { kind: "outbox_dispatch_not_found" };
          const contentPlan = await loadInboxV2OutboundDispatchContentPlan(
            transaction,
            {
              tenantId: outboxLease.context.tenantId,
              dispatchId: fenced.dispatchId
            }
          );
          if (contentPlan === null) {
            return { kind: "outbox_dispatch_content_plan_not_found" };
          }
          return {
            kind: "loaded",
            intent: fenced.intent,
            dispatch: mapDispatchReadRow(row, outboxLease.context.tenantId),
            contentPlan
          };
        }
      );
    },

    async listMessageDispatches(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const messageId = inboxV2MessageIdSchema.parse(input.messageId);
      const after = normalizeMessageDispatchCursor(input.after ?? null);
      const limit = normalizeMessageDispatchPageLimit(input.limit);
      return runTransportSnapshotTransaction(
        transactionExecutor,
        async (transaction) => {
          const result = await transaction.execute<DispatchReadRow>(
            buildListInboxV2MessageDispatchesSql({
              tenantId,
              messageId,
              after,
              limit: limit + 1
            })
          );
          const items = result.rows
            .slice(0, limit)
            .map((row) => mapDispatchReadRow(row, tenantId));
          const hasMore = result.rows.length > limit;
          const last = items.at(-1);
          return {
            tenantId,
            messageId,
            items,
            nextAfter:
              hasMore && last !== undefined
                ? { createdAt: last.createdAt, dispatchId: last.id }
                : null,
            hasMore
          };
        }
      );
    },

    async persistRoutePolicy(input) {
      const policy = inboxV2ThreadRoutePolicySchema.parse(input);
      return runTransportTransaction(transactionExecutor, (transaction) =>
        persistRoutePolicyInTransaction(transaction, policy)
      );
    },

    async persistRouteResolution(input) {
      try {
        return await runTransportTransaction(
          transactionExecutor,
          (transaction) =>
            persistInboxV2RouteResolutionRawInTransaction(transaction, input)
        );
      } catch (error) {
        if (error instanceof InboxV2RouteResolutionRollbackError) {
          return error.result;
        }
        throw error;
      }
    },

    async createDispatch(input) {
      const dispatch = inboxV2OutboundDispatchSchema.parse(input);
      if (dispatch.multiSendOperation !== null) {
        return { kind: "multi_send_required" } as const;
      }
      return runTransportTransaction(transactionExecutor, (transaction) =>
        createDispatchInTransaction(transaction, dispatch, null)
      );
    },

    async applyAttempt(input) {
      const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(input);
      return runTransportTransaction(transactionExecutor, (transaction) =>
        commit.kind === "open_attempt"
          ? openAttemptInTransaction(transaction, commit)
          : completeAttemptInTransaction(transaction, commit)
      );
    },

    async applyAttemptFenced(input) {
      const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(
        input.commit
      );
      const outboxLease = parseProviderIoOutboxLeaseFence(input.outboxLease);
      assertProviderIoFenceTenant(outboxLease, commit.tenantId);
      return runTransportTransaction(
        transactionExecutor,
        async (transaction) => {
          const fenced = await lockAndValidateProviderIoOutboxLease(
            transaction,
            outboxLease,
            commit.dispatchBefore.id
          );
          if (fenced.kind !== "fenced") return fenced;
          if (!providerAttemptTimeFenceMatches(commit, fenced)) {
            return { kind: "outbox_attempt_lease_conflict" } as const;
          }
          if (commit.kind === "open_attempt") {
            const contentPlan = await loadInboxV2OutboundDispatchContentPlan(
              transaction,
              {
                tenantId: commit.tenantId,
                dispatchId: commit.dispatchBefore.id
              }
            );
            if (contentPlan === null) {
              return {
                kind: "outbox_dispatch_content_plan_not_found"
              } as const;
            }
            if (!contentPlanMatchesOpenAttempt(contentPlan, commit)) {
              return {
                kind: "outbox_dispatch_content_plan_conflict"
              } as const;
            }
            return openAttemptInTransaction(transaction, commit, {
              contentPlan,
              databaseNow: fenced.databaseNow
            });
          }
          return completeAttemptInTransaction(transaction, commit);
        }
      );
    },

    async applyProviderResultFenced(input) {
      const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(
        input.commit
      );
      if (commit.kind !== "complete_attempt") {
        throw invariantError(
          "Provider artifact persistence requires a complete-attempt commit."
        );
      }
      const artifacts = input.artifacts.map((artifact) =>
        inboxV2OutboundDispatchArtifactSchema.parse(artifact)
      );
      const outboxLease = parseProviderIoOutboxLeaseFence(input.outboxLease);
      assertProviderIoFenceTenant(outboxLease, commit.tenantId);
      try {
        return await runTransportTransaction(
          transactionExecutor,
          async (transaction) => {
            const fenced = await lockAndValidateProviderIoOutboxLease(
              transaction,
              outboxLease,
              commit.dispatchBefore.id
            );
            if (fenced.kind !== "fenced") return fenced;
            if (!providerAttemptTimeFenceMatches(commit, fenced)) {
              return { kind: "outbox_attempt_lease_conflict" } as const;
            }
            const contentPlan = await loadInboxV2OutboundDispatchContentPlan(
              transaction,
              {
                tenantId: commit.tenantId,
                dispatchId: commit.dispatchBefore.id
              }
            );
            if (contentPlan === null) {
              return {
                kind: "outbox_dispatch_content_plan_not_found"
              } as const;
            }
            if (
              contentPlan.planDigestSha256 !== input.contentPlanDigestSha256 ||
              !contentPlanMatchesCompletedAttempt(contentPlan, commit) ||
              !providerArtifactSetMatchesCompletion(
                artifacts,
                contentPlan,
                commit
              )
            ) {
              return {
                kind: "outbox_dispatch_content_plan_conflict"
              } as const;
            }
            return persistProviderResultArtifactsAndCompletion(
              transaction,
              commit,
              artifacts
            );
          }
        );
      } catch (error) {
        if (error instanceof ProviderResultArtifactRollbackError) {
          return error.result;
        }
        throw error;
      }
    },

    async applyRouteFailure(input) {
      const commit =
        inboxV2OutboundDispatchRouteFailureCommitSchema.parse(input);
      return runTransportTransaction(transactionExecutor, (transaction) =>
        applyRouteFailureInTransaction(transaction, commit)
      );
    },

    async applyRouteFailureFenced(input) {
      const commit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse(
        input.commit
      );
      const outboxLease = parseProviderIoOutboxLeaseFence(input.outboxLease);
      assertProviderIoFenceTenant(outboxLease, commit.tenantId);
      return runTransportTransaction(
        transactionExecutor,
        async (transaction) => {
          const fenced = await lockAndValidateProviderIoOutboxLease(
            transaction,
            outboxLease,
            commit.dispatchBefore.id
          );
          if (fenced.kind !== "fenced") return fenced;
          if (!providerRouteFailureTimeFenceMatches(commit, fenced)) {
            return { kind: "outbox_attempt_lease_conflict" } as const;
          }
          return applyRouteFailureInTransaction(transaction, commit, {
            fence: outboxLease,
            lease: fenced
          });
        }
      );
    },

    async reconcile(input) {
      const commit =
        inboxV2OutboundDispatchReconciliationCommitSchema.parse(input);
      return runTransportTransaction(transactionExecutor, (transaction) =>
        reconcileInTransaction(transaction, commit)
      );
    },

    async reconcileFenced(input) {
      const commit = inboxV2OutboundDispatchReconciliationCommitSchema.parse(
        input.commit
      );
      const outboxLease = parseProviderIoOutboxLeaseFence(input.outboxLease);
      assertProviderIoFenceTenant(outboxLease, commit.tenantId);
      return runTransportTransaction(
        transactionExecutor,
        async (transaction) => {
          const fenced = await lockAndValidateProviderIoOutboxLease(
            transaction,
            outboxLease,
            commit.dispatchBefore.id
          );
          if (fenced.kind !== "fenced") return fenced;
          if (
            Date.parse(commit.decision.decidedAt) >
            Date.parse(fenced.databaseNow)
          ) {
            return { kind: "outbox_attempt_lease_conflict" } as const;
          }
          return reconcileInTransaction(transaction, commit);
        }
      );
    },

    async associateArtifact(input) {
      const commit =
        inboxV2OutboundDispatchArtifactAssociationCommitSchema.parse(input);
      try {
        return await runTransportTransaction(
          transactionExecutor,
          (transaction) => associateArtifactInTransaction(transaction, commit)
        );
      } catch (error) {
        if (error instanceof ArtifactAssociationRollbackError) {
          return error.result;
        }
        throw error;
      }
    },

    async createMultiSend(input) {
      const operation = inboxV2OutboundMultiSendOperationSchema.parse(
        input.operation
      );
      const dispatches = input.dispatches.map((dispatch) =>
        inboxV2OutboundDispatchSchema.parse(dispatch)
      );
      try {
        return await runTransportTransaction(
          transactionExecutor,
          (transaction) =>
            createMultiSendInTransaction(transaction, operation, dispatches)
        );
      } catch (error) {
        if (error instanceof MultiSendRollbackError) return error.result;
        throw error;
      }
    }
  };
}

export function createSqlInboxV2FencedOutboundTransportRuntimeRepository(
  executor: InboxV2OutboundTransportTransactionExecutor | HuleeDatabase
): InboxV2FencedOutboundTransportRuntimeRepository {
  const repository = createSqlInboxV2OutboundTransportRepository(executor);
  return Object.freeze({
    findDispatch: repository.findDispatch,
    loadClaimedProviderIo: repository.loadClaimedProviderIo,
    applyAttemptFenced: repository.applyAttemptFenced,
    applyProviderResultFenced: repository.applyProviderResultFenced,
    applyRouteFailureFenced: repository.applyRouteFailureFenced,
    reconcileFenced: repository.reconcileFenced
  });
}

/**
 * Persists the exact route-policy revision and immutable outbound route inside
 * an existing transaction. The caller owns commit/rollback and must allow an
 * InboxV2RouteResolutionRollbackError to escape that transaction before it
 * converts the error to the stable conflict result.
 */
export async function persistInboxV2RouteResolutionInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: InboxV2OutboundRouteResolutionCommit
): Promise<PersistInboxV2RouteResolutionResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (context.profile !== "domain") {
    throw invariantError(
      "Inbox V2 route resolution requires an authorized domain context."
    );
  }
  const commit = inboxV2OutboundRouteResolutionCommitSchema.parse(input);
  if (commit.input.intent.kind === "explicit_reroute") {
    throw invariantError(
      "Inbox V2 explicit reroute requires the atomic dispatch-cancellation persistence seam."
    );
  }
  assertInboxV2RouteResolutionAuthorizedContext(context, commit);
  const result = await persistInboxV2RouteResolutionRawInTransaction(
    context.executor,
    commit,
    "require_existing_policy",
    context
  );
  if (result.kind === "already_exists") {
    throw invariantError(
      "Inbox V2 atomic route resolution must commit a new exact OutboundRoute."
    );
  }
  if (result.kind === "committed") {
    registerInboxV2AtomicOutboundRouteProof(
      context.atomicMaterializationToken!,
      {
        tenantId: result.route.tenantId,
        routeId: result.route.id,
        conversationId: result.route.conversation.id,
        sourceAccountId: result.route.sourceAccount.id,
        routePolicyId: result.route.routePolicy.id,
        routePolicyRevision: result.route.routePolicyRevision,
        routeDigest: computeInboxV2OutboundRouteDigest(result.route)
      }
    );
  }
  return result;
}

/**
 * Persists the one-shot route carried by an external reaction request. Unlike
 * Message send, the canonical conversation permission is `message.react`;
 * the operation-specific `*_external` ID remains only the immutable provider
 * route profile. The exact original occurrence/account/binding is mandatory
 * and no policy/preferred/fallback route is accepted.
 */
export async function persistInboxV2ReactionRouteInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: InboxV2MessageReactionCommit
): Promise<PersistInboxV2RouteResolutionResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (context.profile !== "domain") {
    throw invariantError(
      "Inbox V2 reaction route requires an authorized domain context."
    );
  }
  const commit = inboxV2MessageReactionCommitSchema.parse(input);
  const authority = commit.transition.externalAuthority;
  const evidence = commit.externalAuthorityEvidence;
  const route = evidence?.outboundRoute ?? null;
  if (
    commit.transition.mode !== "external_request" ||
    authority === null ||
    authority.outboundRoute === null ||
    route === null ||
    commit.outboundBindingSnapshot === null ||
    commit.routeConsumption === null
  ) {
    throw invariantError(
      "Inbox V2 reaction route persistence requires one closed external request."
    );
  }

  assertInboxV2ReactionRouteAuthorizedContext(context, commit, route);
  const policyCurrent = await lockAndValidateReactionRoutePolicy(
    context.executor,
    route
  );
  if (!policyCurrent) {
    return { kind: "policy_conflict" };
  }
  const identityCurrent = await lockAndValidateReactionSourceAccountIdentity(
    context.executor,
    route,
    commit.outboundBindingSnapshot
  );
  if (!identityCurrent) {
    return { kind: "binding_fence_conflict" };
  }
  const fence = await lockBindingFence(context.executor, route);
  if (fence === null) return { kind: "binding_not_found" };
  if (
    !bindingAnchorMatchesRoute(fence, route) ||
    !bindingFenceMatchesRoute(fence, route) ||
    String(fence.binding_revision) !==
      String(commit.outboundBindingSnapshot.revision) ||
    String(fence.provider_access_revision) !==
      String(commit.outboundBindingSnapshot.providerAccess.revision) ||
    String(fence.runtime_health_revision) !==
      String(commit.outboundBindingSnapshot.runtimeHealth.revision) ||
    !sameTimestamp(fence.updated_at, commit.outboundBindingSnapshot.updatedAt)
  ) {
    return { kind: "binding_fence_conflict" };
  }
  if (
    fence.remote_access_state !== "active" ||
    fence.administrative_state !== "enabled" ||
    fence.runtime_health_state !== "ready"
  ) {
    return { kind: "binding_inactive" };
  }
  if (
    !(await lockAndValidateReactionCapability(context.executor, commit, route))
  ) {
    return { kind: "binding_fence_conflict" };
  }

  const inserted = await context.executor.execute<IdRow>(
    buildInsertInboxV2OutboundRouteSql(route, fence)
  );
  if (inserted.rows.length !== 1) {
    return { kind: "route_id_conflict" };
  }
  registerInboxV2AtomicOutboundRouteProof(context.atomicMaterializationToken!, {
    tenantId: route.tenantId,
    routeId: route.id,
    conversationId: route.conversation.id,
    sourceAccountId: route.sourceAccount.id,
    routePolicyId: route.routePolicy.id,
    routePolicyRevision: route.routePolicyRevision,
    routeDigest: computeInboxV2OutboundRouteDigest(route)
  });
  return { kind: "committed", route };
}

/**
 * Atomically cancels the untouched original queued Dispatch and persists the
 * immutable replacement route. The Message/replacement Dispatch/outbox half
 * is sealed later by the same coordinator-owned transaction.
 */
export async function persistInboxV2ExplicitRerouteResolutionInTransaction(
  context: InboxV2AuthorizedCommandMutationContext,
  input: Readonly<{
    routeResolution: InboxV2OutboundRouteResolutionCommit;
    rerouteCommit: InboxV2OutboundDispatchRerouteCommit;
  }>
): Promise<PersistInboxV2RouteResolutionResult> {
  assertInboxV2AuthorizedCommandMutationContext(context);
  if (context.profile !== "domain") {
    throw invariantError(
      "Inbox V2 explicit reroute requires an authorized domain context."
    );
  }
  const routeResolution = inboxV2OutboundRouteResolutionCommitSchema.parse(
    input.routeResolution
  );
  const rerouteCommit = inboxV2OutboundDispatchRerouteCommitSchema.parse(
    input.rerouteCommit
  );
  assertInboxV2RouteResolutionAuthorizedContext(context, routeResolution);
  assertExplicitRerouteCommitMatchesResolution(
    context,
    routeResolution,
    rerouteCommit
  );
  const result = await persistInboxV2RouteResolutionRawInTransaction(
    context.executor,
    routeResolution,
    "require_existing_policy",
    context,
    rerouteCommit
  );
  if (result.kind === "already_exists") {
    throw invariantError(
      "Inbox V2 atomic explicit reroute must commit a new exact OutboundRoute."
    );
  }
  if (result.kind === "committed") {
    registerInboxV2AtomicOutboundRouteProof(
      context.atomicMaterializationToken!,
      {
        tenantId: result.route.tenantId,
        routeId: result.route.id,
        conversationId: result.route.conversation.id,
        sourceAccountId: result.route.sourceAccount.id,
        routePolicyId: result.route.routePolicy.id,
        routePolicyRevision: result.route.routePolicyRevision,
        routeDigest: computeInboxV2OutboundRouteDigest(result.route)
      }
    );
    registerInboxV2AtomicOutboundRerouteProof(
      context.atomicMaterializationToken!,
      rerouteCommit
    );
  }
  return result;
}

function assertExplicitRerouteCommitMatchesResolution(
  context: InboxV2AuthorizedCommandMutationContext,
  resolution: InboxV2OutboundRouteResolutionCommit,
  reroute: InboxV2OutboundDispatchRerouteCommit
): void {
  const route = resolution.route;
  const intent = resolution.input.intent;
  if (
    resolution.result.kind !== "selected" ||
    route === null ||
    intent.kind !== "explicit_reroute" ||
    reroute.tenantId !== context.tenantId ||
    reroute.tenantId !== route.tenantId ||
    String(reroute.original.dispatchBefore.id) !==
      String(intent.originalDispatch.id) ||
    String(reroute.original.dispatchBefore.route.id) !==
      String(intent.originalRoute.id) ||
    reroute.original.dispatchBefore.revision !==
      intent.expectedOriginalDispatchRevision ||
    String(reroute.replacement.route.id) !== String(route.id) ||
    reroute.reasonId !== intent.reasonId ||
    reroute.changedAt !== route.selection.selectedAt ||
    reroute.changedAt !== context.occurredAt
  ) {
    throw invariantError(
      "Inbox V2 explicit reroute commit does not close over its selected route and original dispatch fence."
    );
  }
}

function assertInboxV2RouteResolutionAuthorizedContext(
  context: InboxV2AuthorizedCommandMutationContext,
  commit: InboxV2OutboundRouteResolutionCommit
): void {
  const principalMatches =
    context.actor.kind === "employee"
      ? commit.input.principal.kind === "employee" &&
        commit.input.principal.employee.id === context.actor.employeeId
      : commit.input.principal.kind === "trusted_service" &&
        commit.input.principal.trustedServiceId ===
          context.actor.trustedServiceId;
  const selectedRoute = commit.route;
  const matchingConversationDecisions =
    context.authorizationDecisionRefs.filter(
      (decision) =>
        decision.tenantId === context.tenantId &&
        decision.authorizationEpoch === context.authorizationEpoch &&
        decision.outcome === "allowed" &&
        decision.permissionId ===
          commit.input.routePolicy.requiredConversationPermissionId &&
        decision.resourceScopeId === "core:conversation" &&
        decision.resource.tenantId === context.tenantId &&
        decision.resource.entityTypeId === "core:conversation" &&
        String(decision.resource.entityId) ===
          String(commit.input.conversation.id) &&
        authorizationDecisionPrincipalMatchesContext(decision, context)
    );
  const explicitReroute =
    commit.input.intent.kind === "explicit_reroute" && selectedRoute !== null;
  const expectedCommandTypeId = explicitReroute
    ? "core:source.dispatch.reroute"
    : "core:message.send";
  const actionAuthorityPairIsAllowed =
    isInboxV2OutboundMessageActionAuthorityPair({
      operationId: commit.input.operationId,
      permissionId: commit.input.routePolicy.requiredConversationPermissionId
    });
  const primaryAuthorizationDecisionMatches = explicitReroute
    ? context.authorizationDecisionRefs.some(
        (decision) =>
          decision.id === context.authorizationDecisionId &&
          decision.permissionId === "core:source.dispatch.reroute" &&
          rerouteSourceAccountDecisionMatchesContext(decision, context)
      )
    : matchingConversationDecisions.length === 1 &&
      matchingConversationDecisions[0]!.id === context.authorizationDecisionId;
  const matchingSourceAccountDecisions =
    selectedRoute === null
      ? []
      : context.authorizationDecisionRefs.filter(
          (decision) =>
            decision.tenantId === context.tenantId &&
            decision.authorizationEpoch === context.authorizationEpoch &&
            decision.outcome === "allowed" &&
            decision.permissionId === "core:source_account.use" &&
            decision.resourceScopeId === "core:source-account" &&
            decision.resource.tenantId === context.tenantId &&
            decision.resource.entityTypeId === "core:source-account" &&
            String(decision.resource.entityId) ===
              String(selectedRoute.sourceAccount.id) &&
            authorizationDecisionPrincipalMatchesContext(decision, context)
        );
  const selectedConversationAuthorizationMatches =
    selectedRoute === null ||
    (matchingConversationDecisions.length === 1 &&
      routeAuthorizationSnapshotMatchesDecision(
        selectedRoute.conversationAuthorization,
        matchingConversationDecisions[0]!,
        "conversation",
        selectedRoute.conversation.id
      ));
  const selectedSourceAccountAuthorizationMatches =
    selectedRoute === null ||
    (matchingSourceAccountDecisions.length >= 1 &&
      matchingSourceAccountDecisions.filter((decision) =>
        routeAuthorizationSnapshotMatchesDecision(
          selectedRoute.sourceAccountAuthorization,
          decision,
          "source_account",
          selectedRoute.sourceAccount.id
        )
      ).length === 1);
  const selectedSourceAccountDecisionCountMatches =
    selectedRoute === null ||
    (selectedRoute.selection.intent.kind === "explicit_reroute"
      ? matchingSourceAccountDecisions.length >= 1 &&
        matchingSourceAccountDecisions.length <= 2
      : matchingSourceAccountDecisions.length === 1);

  if (
    context.atomicMaterializationToken === undefined ||
    context.commandTypeId !== expectedCommandTypeId ||
    context.tenantId !== commit.input.tenantId ||
    !principalMatches ||
    context.authorizationEpoch !== commit.input.authorizationEpoch ||
    context.occurredAt !== commit.input.requestedAt ||
    !actionAuthorityPairIsAllowed ||
    matchingConversationDecisions.length !== 1 ||
    !primaryAuthorizationDecisionMatches ||
    !selectedSourceAccountDecisionCountMatches ||
    !selectedConversationAuthorizationMatches ||
    !selectedSourceAccountAuthorizationMatches
  ) {
    throw invariantError(
      "Inbox V2 route resolution crossed its authorized message-action context."
    );
  }
}

function isInboxV2OutboundMessageActionAuthorityPair(input: {
  operationId: string;
  permissionId: string;
}): boolean {
  switch (input.operationId) {
    case "core:message.send":
    case "core:message.reply":
      return input.permissionId === "core:message.reply_external";
    case "core:message.forward_content_copy":
    case "core:message.forward_provider_native":
      return input.permissionId === "core:message.forward_external";
    default:
      return false;
  }
}

function assertInboxV2ReactionRouteAuthorizedContext(
  context: InboxV2AuthorizedCommandMutationContext,
  commit: InboxV2MessageReactionCommit,
  route: InboxV2OutboundRoute
): void {
  const transition = commit.transition;
  const authority = transition.externalAuthority;
  const evidence = commit.externalAuthorityEvidence;
  const expectedOperationId = `core:message.reaction.${transition.operation}`;
  const expectedRoutePermissionId = `${expectedOperationId}_external`;
  const reactDecisions = context.authorizationDecisionRefs.filter(
    (decision) =>
      decision.tenantId === context.tenantId &&
      decision.authorizationEpoch === context.authorizationEpoch &&
      decision.outcome === "allowed" &&
      decision.permissionId === "core:message.react" &&
      decision.resourceScopeId === "core:timeline-item" &&
      decision.resource.tenantId === context.tenantId &&
      decision.resource.entityTypeId === "core:timeline-item" &&
      String(decision.resource.entityId) ===
        String(commit.beforeTimelineItem.id) &&
      authorizationDecisionPrincipalMatchesContext(decision, context)
  );
  const sourceAccountDecisions = context.authorizationDecisionRefs.filter(
    (decision) =>
      decision.tenantId === context.tenantId &&
      decision.authorizationEpoch === context.authorizationEpoch &&
      decision.outcome === "allowed" &&
      decision.permissionId === "core:source_account.use" &&
      decision.resourceScopeId === "core:source-account" &&
      decision.resource.tenantId === context.tenantId &&
      decision.resource.entityTypeId === "core:source-account" &&
      String(decision.resource.entityId) === String(route.sourceAccount.id) &&
      authorizationDecisionPrincipalMatchesContext(decision, context)
  );
  const sourceDecision = sourceAccountDecisions[0];
  const reference = route.referenceContext;
  const selectionIntent = route.selection.intent;
  const appActor = transition.actionAttribution.appActor;
  const actorMatches =
    appActor !== null &&
    (context.actor.kind === "employee"
      ? appActor.kind === "employee" &&
        appActor.employee.id === context.actor.employeeId
      : appActor.kind === "trusted_service" &&
        appActor.trustedServiceId === context.actor.trustedServiceId);
  const routePrincipalMatches =
    context.actor.kind === "employee"
      ? route.principal.kind === "employee" &&
        route.principal.employee.id === context.actor.employeeId
      : route.principal.kind === "trusted_service" &&
        route.principal.trustedServiceId === context.actor.trustedServiceId;
  if (
    context.atomicMaterializationToken === undefined ||
    authority === null ||
    evidence === null ||
    context.commandTypeId !== expectedOperationId ||
    context.tenantId !== commit.tenantId ||
    context.occurredAt !== transition.recordedAt ||
    context.authorizationDecisionId !== reactDecisions[0]?.id ||
    reactDecisions.length !== 1 ||
    sourceAccountDecisions.length !== 1 ||
    sourceDecision === undefined ||
    !actorMatches ||
    !routePrincipalMatches ||
    route.authorizationEpoch !== context.authorizationEpoch ||
    route.operationId !== expectedOperationId ||
    route.requiredConversationPermissionId !== expectedRoutePermissionId ||
    route.tenantId !== context.tenantId ||
    route.conversation.id !== commit.beforeMessage.conversation.id ||
    route.sourceAccount.id !== authority.sourceAccount.id ||
    route.sourceThreadBinding.id !== authority.sourceThreadBinding.id ||
    route.bindingFence.bindingGeneration !== authority.bindingGeneration ||
    route.selection.reason !== "explicit_occurrence" ||
    route.selection.fallbackPolicyOrdinal !== null ||
    selectionIntent.kind !== "explicit_occurrence" ||
    (selectionIntent.kind === "explicit_occurrence" &&
      selectionIntent.occurrence.id !== authority.sourceOccurrence.id) ||
    reference.kind !== "external_message" ||
    (reference.kind === "external_message" &&
      (reference.externalMessageReference.id !==
        authority.externalMessageReference.id ||
        reference.sourceOccurrence.id !== authority.sourceOccurrence.id ||
        reference.originBinding.id !== authority.sourceThreadBinding.id ||
        reference.originSourceAccount.id !== authority.sourceAccount.id)) ||
    route.conversationAuthorization.effect !== "allow" ||
    route.conversationAuthorization.target.authorizationEpoch !==
      context.authorizationEpoch ||
    route.conversationAuthorization.requiredPermissionId !==
      expectedRoutePermissionId ||
    !routeAuthorizationSnapshotMatchesDecision(
      route.sourceAccountAuthorization,
      sourceDecision,
      "source_account",
      route.sourceAccount.id
    )
  ) {
    throw invariantError(
      "Inbox V2 reaction route crossed its exact react/source-account authority or attempted fallback routing."
    );
  }
}

async function lockAndValidateReactionRoutePolicy(
  executor: RawSqlExecutor,
  route: InboxV2OutboundRoute
): Promise<boolean> {
  const result = await executor.execute<ReactionRoutePolicyRow>(sql`
    select head.revision, head.conversation_id, head.external_thread_id,
           head.operation_id, head.content_kind_id,
           version.required_conversation_permission_id,
           version.preferred_binding_id, version.fallback_kind,
           version.fallback_binding_count
      from inbox_v2_thread_route_policy_heads head
      join inbox_v2_thread_route_policy_versions version
        on version.tenant_id = head.tenant_id
       and version.policy_id = head.policy_id
       and version.revision = head.revision
     where head.tenant_id = ${route.tenantId}
       and head.policy_id = ${route.routePolicy.id}
     for share of head, version
  `);
  if (result.rows.length !== 1) return false;
  const row = result.rows[0]!;
  return (
    String(row.revision) === String(route.routePolicyRevision) &&
    String(row.conversation_id) === String(route.conversation.id) &&
    String(row.external_thread_id) === String(route.externalThread.id) &&
    String(row.operation_id) === String(route.operationId) &&
    nullableString(row.content_kind_id) ===
      nullableString(route.contentKindId) &&
    String(row.required_conversation_permission_id) ===
      String(route.requiredConversationPermissionId) &&
    row.preferred_binding_id === null &&
    String(row.fallback_kind) === "none" &&
    Number(row.fallback_binding_count) === 0
  );
}

async function lockAndValidateReactionSourceAccountIdentity(
  executor: RawSqlExecutor,
  route: InboxV2OutboundRoute,
  binding: NonNullable<InboxV2MessageReactionCommit["outboundBindingSnapshot"]>
): Promise<boolean> {
  const result = await executor.execute<ReactionSourceAccountIdentityRow>(sql`
    select source_account_id, source_connection_id, state, revision,
           account_generation, updated_at
      from inbox_v2_source_account_identities
     where tenant_id = ${route.tenantId}
       and source_account_id = ${route.sourceAccount.id}
     for share
  `);
  if (result.rows.length !== 1) return false;
  const row = result.rows[0]!;
  return (
    String(row.source_account_id) === String(route.sourceAccount.id) &&
    String(row.source_connection_id) === String(route.sourceConnection.id) &&
    String(row.state) === "verified" &&
    String(row.account_generation) ===
      String(route.bindingFence.accountGeneration) &&
    String(row.account_generation) ===
      String(binding.accountIdentitySnapshot.accountGeneration) &&
    Date.parse(String(row.updated_at)) <= Date.parse(route.createdAt) &&
    Date.parse(binding.accountIdentitySnapshot.verifiedAt) <=
      Date.parse(String(row.updated_at))
  );
}

async function lockAndValidateReactionCapability(
  executor: RawSqlExecutor,
  commit: InboxV2MessageReactionCommit,
  route: InboxV2OutboundRoute
): Promise<boolean> {
  const binding = commit.outboundBindingSnapshot;
  const capability = commit.afterReaction.capability;
  if (binding === null || capability.kind !== "external") return false;
  const result = await executor.execute<ReactionCapabilityRow>(sql`
    select capability.capability_id
      from inbox_v2_source_thread_binding_capability_entries capability
     where capability.tenant_id = ${route.tenantId}
       and capability.binding_id = ${route.sourceThreadBinding.id}
       and capability.capability_revision =
           ${BigInt(route.bindingFence.capabilityRevision)}
       and capability.capability_id = ${capability.capabilityId}
       and capability.operation_id = ${route.operationId}
       and capability.content_kind_id is not distinct from ${route.contentKindId}
       and capability.state = 'supported'
       and (
         capability.valid_until is null
         or capability.valid_until >= ${toDate(commit.transition.recordedAt)}
       )
       and not exists (
         select 1
           from inbox_v2_source_thread_binding_capability_required_roles required_role
          where required_role.tenant_id = capability.tenant_id
            and required_role.binding_id = capability.binding_id
            and required_role.capability_revision = capability.capability_revision
            and required_role.capability_ordinal = capability.ordinal
            and not exists (
              select 1
                from inbox_v2_source_thread_binding_provider_roles provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                     ${BigInt(binding.providerAccess.revision)}
                 and provider_role.provider_role_id =
                     required_role.provider_role_id
            )
       )
     for share of capability
  `);
  return result.rows.length === 1;
}

type InboxV2RouteAuthorizationSnapshot =
  | InboxV2OutboundRoute["conversationAuthorization"]
  | InboxV2OutboundRoute["sourceAccountAuthorization"];

function routeAuthorizationSnapshotMatchesDecision(
  snapshot: InboxV2RouteAuthorizationSnapshot,
  decision: InboxV2AuthorizedCommandMutationContext["authorizationDecisionRefs"][number],
  resourceKind: "conversation" | "source_account",
  resourceId: string
): boolean {
  const snapshotResourceId =
    resourceKind === "conversation"
      ? snapshot.target.conversation.id
      : snapshot.target.sourceAccount.id;
  const expectedEntityTypeId =
    resourceKind === "conversation"
      ? "core:conversation"
      : "core:source-account";

  return (
    snapshot.tenantId === decision.tenantId &&
    routeAuthorizationPrincipalsMatch(snapshot.principal, decision.principal) &&
    snapshot.effect === (decision.outcome === "allowed" ? "allow" : "deny") &&
    snapshot.requiredPermissionId === decision.permissionId &&
    snapshot.matchedPermissionIds.length === 1 &&
    snapshot.matchedPermissionIds[0] === decision.permissionId &&
    snapshot.decisionRevision === decision.decisionRevision &&
    snapshot.decidedAt === decision.decidedAt &&
    snapshot.notAfter === decision.notAfter &&
    snapshot.target.authorizationEpoch === decision.authorizationEpoch &&
    decision.resource.entityTypeId === expectedEntityTypeId &&
    String(decision.resource.entityId) === String(resourceId) &&
    String(snapshotResourceId) === String(resourceId)
  );
}

function routeAuthorizationPrincipalsMatch(
  routePrincipal: InboxV2RouteAuthorizationSnapshot["principal"],
  decisionPrincipal: InboxV2AuthorizedCommandMutationContext["authorizationDecisionRefs"][number]["principal"]
): boolean {
  if (routePrincipal.kind !== decisionPrincipal.kind) return false;
  return routePrincipal.kind === "employee" &&
    decisionPrincipal.kind === "employee"
    ? routePrincipal.employee.tenantId ===
        decisionPrincipal.employee.tenantId &&
        routePrincipal.employee.id === decisionPrincipal.employee.id
    : routePrincipal.kind === "trusted_service" &&
        decisionPrincipal.kind === "trusted_service" &&
        routePrincipal.trustedServiceId === decisionPrincipal.trustedServiceId;
}

function authorizationDecisionPrincipalMatchesContext(
  decision: InboxV2AuthorizedCommandMutationContext["authorizationDecisionRefs"][number],
  context: InboxV2AuthorizedCommandMutationContext
): boolean {
  return context.actor.kind === "employee"
    ? decision.principal.kind === "employee" &&
        decision.principal.employee.id === context.actor.employeeId
    : decision.principal.kind === "trusted_service" &&
        decision.principal.trustedServiceId === context.actor.trustedServiceId;
}

async function persistInboxV2RouteResolutionRawInTransaction(
  transaction: RawSqlExecutor,
  input: InboxV2OutboundRouteResolutionCommit,
  policyMode: "persist_policy" | "require_existing_policy" = "persist_policy",
  authorizedContext?: InboxV2AuthorizedCommandMutationContext,
  rerouteCommit?: InboxV2OutboundDispatchRerouteCommit
): Promise<PersistInboxV2RouteResolutionResult> {
  const commit = inboxV2OutboundRouteResolutionCommitSchema.parse(input);
  if (commit.result.kind === "failed") {
    return { kind: "not_selected" } as const;
  }
  if (commit.route === null) {
    throw invariantError("Selected route resolution has no route.");
  }
  const route = commit.route;
  const explicitReroute = route.selection.intent.kind === "explicit_reroute";
  if (
    explicitReroute !== (rerouteCommit !== undefined) ||
    (explicitReroute && authorizedContext === undefined)
  ) {
    throw invariantError(
      "Inbox V2 explicit reroute persistence requires one live authorized context and cancellation commit."
    );
  }
  const policyResult =
    policyMode === "persist_policy"
      ? await persistRoutePolicyInTransaction(
          transaction,
          commit.input.routePolicy
        )
      : await requireExistingRoutePolicyInTransaction(
          transaction,
          commit.input.routePolicy
        );
  if (
    policyResult.kind !== "committed" &&
    policyResult.kind !== "already_exists"
  ) {
    return {
      kind:
        policyResult.kind === "binding_not_found"
          ? "binding_not_found"
          : "policy_conflict"
    } as const;
  }

  const rerouteFence = explicitReroute
    ? await lockAndValidateExplicitRerouteFences(
        transaction,
        route,
        authorizedContext!,
        rerouteCommit!
      )
    : null;
  if (rerouteFence !== null && rerouteFence.kind !== "validated") {
    return abortRouteResolutionAfterPolicyWrite(policyResult, rerouteFence);
  }
  const fence =
    rerouteFence?.kind === "validated"
      ? rerouteFence.selectedFence
      : await lockBindingFence(transaction, route);
  if (fence === null) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind: "binding_not_found"
    });
  }
  if (!bindingAnchorMatchesRoute(fence, route)) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind: "binding_fence_conflict"
    });
  }
  if (!bindingFenceMatchesRoute(fence, route)) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind: "binding_fence_conflict"
    });
  }
  if (
    fence.remote_access_state !== "active" ||
    fence.administrative_state !== "enabled"
  ) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind: "binding_inactive"
    });
  }

  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundRouteSql(route, fence)
  );
  if (inserted.rows.length === 1) {
    if (rerouteFence?.kind === "validated") {
      const cancelled = await transaction.execute<IdRow>(
        buildCompareAndSwapInboxV2OutboundDispatchSql(
          rerouteFence.rerouteCommit.original.dispatchBefore,
          rerouteFence.rerouteCommit.original.dispatchAfter
        )
      );
      if (cancelled.rows.length !== 1) {
        throw new InboxV2RouteResolutionRollbackError({
          kind: "original_dispatch_conflict"
        });
      }
    }
    return { kind: "committed", route } as const;
  }

  const existing = await loadExistingRoute(transaction, route);
  if (existing === null) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind: "route_token_conflict"
    });
  }
  if (!existingRouteMatches(existing, route, fence)) {
    return abortRouteResolutionAfterPolicyWrite(policyResult, {
      kind:
        String(existing.id) === String(route.id)
          ? "route_id_conflict"
          : "route_token_conflict"
    });
  }
  return { kind: "already_exists", route } as const;
}

function abortRouteResolutionAfterPolicyWrite(
  policyResult: Readonly<{ kind: "committed" | "already_exists" }>,
  result: InboxV2RouteResolutionConflictResult
): InboxV2RouteResolutionConflictResult {
  if (policyResult.kind === "committed") {
    throw new InboxV2RouteResolutionRollbackError(result);
  }
  return result;
}

async function requireExistingRoutePolicyInTransaction(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<PersistInboxV2RoutePolicyResult> {
  const bindingIds = [
    ...(policy.preferredBinding === null
      ? []
      : [String(policy.preferredBinding.id)]),
    ...(policy.fallback.kind === "none"
      ? []
      : policy.fallback.allowedBindings.map((binding) => String(binding.id)))
  ];
  const anchors = await lockBindingAnchors(
    transaction,
    policy.tenantId,
    bindingIds
  );
  if (anchors.size !== new Set(bindingIds).size) {
    return { kind: "binding_not_found" };
  }
  if (
    [...anchors.values()].some(
      (anchor) =>
        String(anchor.external_thread_id) !== String(policy.externalThread.id)
    )
  ) {
    return { kind: "binding_scope_conflict" };
  }

  const head = await transaction.execute<{
    revision: unknown;
    conversation_id: unknown;
    external_thread_id: unknown;
    operation_id: unknown;
    content_kind_id: unknown;
  }>(sql`
    select revision, conversation_id, external_thread_id, operation_id,
           content_kind_id
      from inbox_v2_thread_route_policy_heads
     where tenant_id = ${policy.tenantId}
       and policy_id = ${policy.id}
     for share
  `);
  const headRow = head.rows[0];
  if (headRow === undefined) return { kind: "policy_id_conflict" };
  if (
    String(headRow.conversation_id) !== String(policy.conversation.id) ||
    String(headRow.external_thread_id) !== String(policy.externalThread.id) ||
    String(headRow.operation_id) !== String(policy.operationId) ||
    nullableString(headRow.content_kind_id) !==
      nullableString(policy.contentKindId)
  ) {
    return { kind: "policy_scope_conflict" };
  }
  if (BigInt(String(headRow.revision)) !== BigInt(policy.revision)) {
    return { kind: "stale_policy_revision" };
  }

  const fallbackIds =
    policy.fallback.kind === "none"
      ? []
      : policy.fallback.allowedBindings.map((binding) => String(binding.id));
  const preferredAnchor =
    policy.preferredBinding === null
      ? null
      : (anchors.get(String(policy.preferredBinding.id)) ?? null);
  const version = await loadExistingPolicyVersion(transaction, policy);
  if (
    version === null ||
    !existingPolicyMatches(
      version,
      policy,
      preferredAnchor,
      digestOrdinalIds(fallbackIds)
    )
  ) {
    return { kind: "policy_id_conflict" };
  }
  return { kind: "already_exists" };
}

async function persistRoutePolicyInTransaction(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<PersistInboxV2RoutePolicyResult> {
  const bindingIds = [
    ...(policy.preferredBinding === null
      ? []
      : [String(policy.preferredBinding.id)]),
    ...(policy.fallback.kind === "none"
      ? []
      : policy.fallback.allowedBindings.map((binding) => String(binding.id)))
  ];
  const anchors = await lockBindingAnchors(
    transaction,
    policy.tenantId,
    bindingIds
  );
  if (anchors.size !== new Set(bindingIds).size) {
    return { kind: "binding_not_found" };
  }
  if (
    [...anchors.values()].some(
      (anchor) =>
        String(anchor.external_thread_id) !== String(policy.externalThread.id)
    )
  ) {
    return { kind: "binding_scope_conflict" };
  }

  const fallbackIds =
    policy.fallback.kind === "none"
      ? []
      : policy.fallback.allowedBindings.map((binding) => String(binding.id));
  const fallbackDigest = digestOrdinalIds(fallbackIds);
  const preferredAnchor =
    policy.preferredBinding === null
      ? null
      : (anchors.get(String(policy.preferredBinding.id)) ?? null);

  const headPreflight = await lockAndPreflightPolicyHead(transaction, policy);
  if (headPreflight !== null) return headPreflight;

  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2ThreadRoutePolicyVersionSql({
      policy,
      preferredAnchor,
      fallbackDigest
    })
  );
  if (inserted.rows.length === 1) {
    for (const [ordinal, bindingId] of fallbackIds.entries()) {
      const anchor = anchors.get(bindingId);
      if (!anchor) throw invariantError("Locked fallback binding disappeared.");
      await requireSingleInsert(
        transaction,
        buildInsertInboxV2ThreadRoutePolicyFallbackSql({
          policy,
          ordinal,
          anchor
        }),
        "ThreadRoutePolicy fallback insert"
      );
    }

    const headResult = await transaction.execute<IdRow>(
      buildAdvanceInboxV2ThreadRoutePolicyHeadSql(policy)
    );
    if (headResult.rows.length !== 1) {
      throw invariantError(
        "ThreadRoutePolicy head changed while its transaction-scoped policy lock was held."
      );
    }
    return { kind: "committed" };
  }

  const existing = await loadExistingPolicyVersion(transaction, policy);
  if (existing === null) {
    return { kind: "policy_id_conflict" };
  }
  if (
    !existingPolicyMatches(existing, policy, preferredAnchor, fallbackDigest)
  ) {
    return { kind: "policy_id_conflict" };
  }
  const headResult = await ensurePolicyHead(transaction, policy);
  if (headResult !== null) return headResult;
  return { kind: "already_exists" };
}

async function lockAndPreflightPolicyHead(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<PersistInboxV2RoutePolicyResult | null> {
  await transaction.execute(sql`
    select pg_advisory_xact_lock(
      hashtextextended(${`${policy.tenantId}:${policy.id}`}, 0)
    )
  `);
  const result = await transaction.execute<{
    revision: unknown;
    conversation_id: unknown;
    external_thread_id: unknown;
    operation_id: unknown;
    content_kind_id: unknown;
  }>(sql`
    select revision, conversation_id, external_thread_id, operation_id,
           content_kind_id
      from inbox_v2_thread_route_policy_heads
     where tenant_id = ${policy.tenantId}
       and policy_id = ${policy.id}
     for update
  `);
  const row = result.rows[0];
  if (!row) return null;
  if (
    String(row.conversation_id) !== String(policy.conversation.id) ||
    String(row.external_thread_id) !== String(policy.externalThread.id) ||
    String(row.operation_id) !== String(policy.operationId) ||
    nullableString(row.content_kind_id) !== nullableString(policy.contentKindId)
  ) {
    return { kind: "policy_scope_conflict" };
  }

  const currentRevision = BigInt(String(row.revision));
  const requestedRevision = BigInt(policy.revision);
  if (
    currentRevision !== requestedRevision &&
    currentRevision !== requestedRevision - 1n
  ) {
    return { kind: "stale_policy_revision" };
  }
  return null;
}

export function buildInsertInboxV2ThreadRoutePolicyVersionSql(input: {
  policy: InboxV2ThreadRoutePolicy;
  preferredAnchor: BindingAnchorRow | null;
  fallbackDigest: string | null;
}): SQL {
  const { policy, preferredAnchor, fallbackDigest } = input;
  const fallbackCount =
    policy.fallback.kind === "none"
      ? 0
      : policy.fallback.allowedBindings.length;
  return sql`
    insert into inbox_v2_thread_route_policy_versions (
      tenant_id, policy_id, revision, conversation_id, external_thread_id,
      external_thread_revision, operation_id, content_kind_id,
      route_policy_catalog_id, required_conversation_permission_id,
      preferred_binding_id, preferred_source_connection_id,
      preferred_source_account_id, fallback_kind, fallback_binding_count,
      fallback_bindings_digest_sha256, created_at, updated_at
    ) values (
      ${policy.tenantId}, ${policy.id}, ${BigInt(policy.revision)},
      ${policy.conversation.id}, ${policy.externalThread.id}, 1,
      ${policy.operationId}, ${policy.contentKindId}, ${policy.policyId},
      ${policy.requiredConversationPermissionId},
      ${preferredAnchor === null ? null : String(preferredAnchor.binding_id)},
      ${
        preferredAnchor === null
          ? null
          : String(preferredAnchor.source_connection_id)
      },
      ${
        preferredAnchor === null
          ? null
          : String(preferredAnchor.source_account_id)
      },
      ${policy.fallback.kind}, ${fallbackCount}, ${fallbackDigest},
      ${toDate(policy.createdAt)}, ${toDate(policy.updatedAt)}
    )
    on conflict (tenant_id, policy_id, revision) do nothing
    returning policy_id as id
  `;
}

function buildInsertInboxV2ThreadRoutePolicyFallbackSql(input: {
  policy: InboxV2ThreadRoutePolicy;
  ordinal: number;
  anchor: BindingAnchorRow;
}): SQL {
  return sql`
    insert into inbox_v2_thread_route_policy_fallback_bindings (
      tenant_id, policy_id, policy_revision, external_thread_id, ordinal,
      binding_id, source_connection_id, source_account_id
    ) values (
      ${input.policy.tenantId}, ${input.policy.id},
      ${BigInt(input.policy.revision)}, ${input.policy.externalThread.id},
      ${input.ordinal}, ${String(input.anchor.binding_id)},
      ${String(input.anchor.source_connection_id)},
      ${String(input.anchor.source_account_id)}
    )
    returning binding_id as id
  `;
}

function buildAdvanceInboxV2ThreadRoutePolicyHeadSql(
  policy: InboxV2ThreadRoutePolicy
): SQL {
  return sql`
    insert into inbox_v2_thread_route_policy_heads (
      tenant_id, policy_id, conversation_id, external_thread_id,
      operation_id, content_kind_id, revision, updated_at
    ) values (
      ${policy.tenantId}, ${policy.id}, ${policy.conversation.id},
      ${policy.externalThread.id}, ${policy.operationId},
      ${policy.contentKindId}, ${BigInt(policy.revision)},
      ${toDate(policy.updatedAt)}
    )
    on conflict (tenant_id, policy_id) do update
      set conversation_id = excluded.conversation_id,
          external_thread_id = excluded.external_thread_id,
          operation_id = excluded.operation_id,
          content_kind_id = excluded.content_kind_id,
          revision = excluded.revision,
          updated_at = excluded.updated_at
      where inbox_v2_thread_route_policy_heads.revision = excluded.revision - 1
        and inbox_v2_thread_route_policy_heads.conversation_id =
          excluded.conversation_id
        and inbox_v2_thread_route_policy_heads.external_thread_id =
          excluded.external_thread_id
        and inbox_v2_thread_route_policy_heads.operation_id =
          excluded.operation_id
        and inbox_v2_thread_route_policy_heads.content_kind_id is not distinct
          from excluded.content_kind_id
    returning policy_id as id
  `;
}

async function classifyPolicyHeadConflict(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<PersistInboxV2RoutePolicyResult> {
  const result = await transaction.execute<{
    revision: unknown;
    conversation_id: unknown;
    external_thread_id: unknown;
    operation_id: unknown;
    content_kind_id: unknown;
  }>(sql`
    select revision, conversation_id, external_thread_id, operation_id,
           content_kind_id
      from inbox_v2_thread_route_policy_heads
     where tenant_id = ${policy.tenantId}
       and policy_id = ${policy.id}
     for update
  `);
  const row = result.rows[0];
  if (!row) return { kind: "policy_id_conflict" };
  if (
    String(row.conversation_id) !== String(policy.conversation.id) ||
    String(row.external_thread_id) !== String(policy.externalThread.id) ||
    String(row.operation_id) !== String(policy.operationId) ||
    nullableString(row.content_kind_id) !== nullableString(policy.contentKindId)
  ) {
    return { kind: "policy_scope_conflict" };
  }
  return { kind: "stale_policy_revision" };
}

async function ensurePolicyHead(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<PersistInboxV2RoutePolicyResult | null> {
  const result = await transaction.execute<{
    revision: unknown;
    conversation_id: unknown;
    external_thread_id: unknown;
    operation_id: unknown;
    content_kind_id: unknown;
  }>(sql`
    select revision, conversation_id, external_thread_id, operation_id,
           content_kind_id
      from inbox_v2_thread_route_policy_heads
     where tenant_id = ${policy.tenantId}
       and policy_id = ${policy.id}
     for update
  `);
  const row = result.rows[0];
  if (!row) {
    const inserted = await transaction.execute<IdRow>(
      buildAdvanceInboxV2ThreadRoutePolicyHeadSql(policy)
    );
    return inserted.rows.length === 1
      ? null
      : classifyPolicyHeadConflict(transaction, policy);
  }
  if (
    String(row.conversation_id) !== String(policy.conversation.id) ||
    String(row.external_thread_id) !== String(policy.externalThread.id) ||
    String(row.operation_id) !== String(policy.operationId) ||
    nullableString(row.content_kind_id) !== nullableString(policy.contentKindId)
  ) {
    return { kind: "policy_scope_conflict" };
  }
  if (BigInt(String(row.revision)) !== BigInt(policy.revision)) {
    return { kind: "stale_policy_revision" };
  }
  return null;
}

async function loadExistingPolicyVersion(
  transaction: RawSqlExecutor,
  policy: InboxV2ThreadRoutePolicy
): Promise<ExistingPolicyRow | null> {
  const result = await transaction.execute<ExistingPolicyRow>(sql`
    select policy_id, revision, conversation_id, external_thread_id,
           operation_id, content_kind_id, route_policy_catalog_id,
           required_conversation_permission_id, preferred_binding_id,
           fallback_kind, fallback_binding_count,
           fallback_bindings_digest_sha256, created_at, updated_at
      from inbox_v2_thread_route_policy_versions
     where tenant_id = ${policy.tenantId}
       and policy_id = ${policy.id}
       and revision = ${BigInt(policy.revision)}
     for share
  `);
  return result.rows[0] ?? null;
}

function existingPolicyMatches(
  row: ExistingPolicyRow,
  policy: InboxV2ThreadRoutePolicy,
  preferredAnchor: BindingAnchorRow | null,
  fallbackDigest: string | null
): boolean {
  const fallbackCount =
    policy.fallback.kind === "none"
      ? 0
      : policy.fallback.allowedBindings.length;
  return (
    String(row.policy_id) === String(policy.id) &&
    BigInt(String(row.revision)) === BigInt(policy.revision) &&
    String(row.conversation_id) === String(policy.conversation.id) &&
    String(row.external_thread_id) === String(policy.externalThread.id) &&
    String(row.operation_id) === String(policy.operationId) &&
    nullableString(row.content_kind_id) ===
      nullableString(policy.contentKindId) &&
    String(row.route_policy_catalog_id) === String(policy.policyId) &&
    String(row.required_conversation_permission_id) ===
      String(policy.requiredConversationPermissionId) &&
    nullableString(row.preferred_binding_id) ===
      (preferredAnchor === null ? null : String(preferredAnchor.binding_id)) &&
    String(row.fallback_kind) === policy.fallback.kind &&
    Number(row.fallback_binding_count) === fallbackCount &&
    nullableString(row.fallback_bindings_digest_sha256) === fallbackDigest &&
    sameTimestamp(row.created_at, policy.createdAt) &&
    sameTimestamp(row.updated_at, policy.updatedAt)
  );
}

async function lockBindingAnchors(
  transaction: RawSqlExecutor,
  tenantId: string,
  bindingIds: readonly string[]
): Promise<Map<string, BindingAnchorRow>> {
  if (bindingIds.length === 0) return new Map();
  const result = await transaction.execute<BindingAnchorRow>(sql`
    select id as binding_id, external_thread_id, source_connection_id,
           source_account_id
      from inbox_v2_source_thread_bindings
     where tenant_id = ${tenantId}
       and id in ${sql`(${sql.join(
         [...new Set(bindingIds)].sort().map((id) => sql`${id}`),
         sql`, `
       )})`}
     order by id
     for share
  `);
  return new Map(
    result.rows.map((row) => [String(row.binding_id), row] as const)
  );
}

async function lockBindingFence(
  transaction: RawSqlExecutor,
  route: InboxV2OutboundRoute
): Promise<BindingFenceRow | null> {
  const result = await transaction.execute<BindingFenceRow>(sql`
    select head.binding_id, head.external_thread_id,
           head.source_connection_id, head.source_account_id,
           head.revision as binding_revision, head.account_generation,
           head.binding_generation, head.remote_access_revision,
           head.administrative_revision, head.capability_revision,
           head.provider_access_revision, head.route_descriptor_revision,
           head.remote_access_state,
           head.administrative_state, head.runtime_health_state,
           head.runtime_health_revision, head.updated_at
      from inbox_v2_source_thread_binding_heads head
     where head.tenant_id = ${route.tenantId}
       and head.binding_id = ${route.sourceThreadBinding.id}
     for share
  `);
  return result.rows[0] ?? null;
}

type ExplicitRerouteFenceResult =
  | Readonly<{
      kind: "validated";
      selectedFence: BindingFenceRow;
      rerouteCommit: InboxV2OutboundDispatchRerouteCommit;
    }>
  | InboxV2RouteResolutionConflictResult;

async function lockAndValidateExplicitRerouteFences(
  transaction: RawSqlExecutor,
  route: InboxV2OutboundRoute,
  context: InboxV2AuthorizedCommandMutationContext,
  rerouteCommit: InboxV2OutboundDispatchRerouteCommit
): Promise<ExplicitRerouteFenceResult> {
  if (route.selection.intent.kind !== "explicit_reroute") {
    throw invariantError(
      "Explicit reroute validation received another intent."
    );
  }
  const originalDispatch = await lockAndValidateOriginalRerouteDispatch(
    transaction,
    rerouteCommit
  );
  if (originalDispatch.kind !== "validated") return originalDispatch;

  const originalRoute = await lockExactRerouteOriginalRoute(
    transaction,
    route.tenantId,
    route.selection.intent.originalRoute.id
  );
  if (
    originalRoute === null ||
    !rerouteOriginalRouteScopeMatches(originalRoute, route) ||
    String(originalRoute.binding_id) === String(route.sourceThreadBinding.id)
  ) {
    return { kind: "binding_fence_conflict" };
  }

  assertExplicitRerouteAuthorizationContext(context, route, originalRoute);

  // The old binding may be disabled or drifted; that is a reason to reroute,
  // not a reason to strand the untouched dispatch. Only the replacement head
  // is a live execution fence.
  const selectedFence = await lockBindingFence(transaction, route);
  if (selectedFence === null) {
    return { kind: "binding_not_found" };
  }
  if (
    !bindingAnchorMatchesRoute(selectedFence, route) ||
    !bindingFenceMatchesRoute(selectedFence, route)
  ) {
    return { kind: "binding_fence_conflict" };
  }
  if (
    selectedFence.remote_access_state !== "active" ||
    selectedFence.administrative_state !== "enabled"
  ) {
    return { kind: "binding_inactive" };
  }
  return { kind: "validated", selectedFence, rerouteCommit };
}

async function lockAndValidateOriginalRerouteDispatch(
  transaction: RawSqlExecutor,
  reroute: InboxV2OutboundDispatchRerouteCommit
): Promise<
  | Readonly<{ kind: "validated" }>
  | Readonly<{
      kind:
        | "original_dispatch_not_found"
        | "original_dispatch_conflict"
        | "original_provider_intent_conflict";
    }>
> {
  const before = reroute.original.dispatchBefore;
  const dispatch = await lockDispatch(transaction, before);
  if (dispatch === null) return { kind: "original_dispatch_not_found" };
  if (!existingDispatchMatches(dispatch, before)) {
    return { kind: "original_dispatch_conflict" };
  }

  const attempts = await transaction.execute<IdRow>(sql`
    select attempt.id
      from inbox_v2_outbound_dispatch_attempts attempt
     where attempt.tenant_id = ${before.tenantId}
       and attempt.dispatch_id = ${before.id}
     limit 1
     for share of attempt
  `);
  if (attempts.rows.length !== 0) {
    return { kind: "original_dispatch_conflict" };
  }

  const providerIntent =
    await transaction.execute<ExistingRerouteProviderIntentRow>(sql`
    select intent.id, intent.type_id, intent.effect_class::text as effect_class,
           intent.payload_reference, work.state::text as work_state
      from inbox_v2_outbox_intents intent
      join inbox_v2_outbox_work_items work
        on work.tenant_id = intent.tenant_id
       and work.intent_id = intent.id
     where intent.tenant_id = ${before.tenantId}
       and intent.id = ${reroute.original.outboxIntentId}
     for share of intent
  `);
  assertAtMostOneRow(
    providerIntent.rows,
    "Explicit reroute original provider intent lookup"
  );
  const intent = providerIntent.rows[0];
  if (
    intent === undefined ||
    String(intent.id) !== String(reroute.original.outboxIntentId) ||
    String(intent.type_id) !== "core:provider.dispatch" ||
    String(intent.effect_class) !== "provider_io" ||
    (String(intent.work_state) !== "pending" &&
      String(intent.work_state) !== "leased")
  ) {
    return { kind: "original_provider_intent_conflict" };
  }
  const payloadReference = inboxV2PayloadReferenceSchema.safeParse(
    intent.payload_reference
  );
  if (
    !payloadReference.success ||
    payloadReference.data.tenantId !== before.tenantId ||
    String(payloadReference.data.recordId) !== String(before.id) ||
    payloadReference.data.schemaId !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
    payloadReference.data.schemaVersion !==
      INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
  ) {
    return { kind: "original_provider_intent_conflict" };
  }
  return { kind: "validated" };
}

async function lockExactRerouteOriginalRoute(
  transaction: RawSqlExecutor,
  tenantId: string,
  routeId: string
): Promise<ExistingRerouteOriginalRouteRow | null> {
  const result = await transaction.execute<ExistingRerouteOriginalRouteRow>(sql`
    select route_row.id, route_row.conversation_id,
           route_row.external_thread_id, route_row.source_thread_binding_id
             as binding_id,
           route_row.source_connection_id, route_row.source_account_id,
           route_row.operation_id, route_row.content_kind_id,
           route_row.binding_revision, route_row.account_generation,
           route_row.binding_generation, route_row.remote_access_revision,
           route_row.administrative_revision, route_row.capability_revision,
           route_row.route_descriptor_revision, route_row.created_at
      from inbox_v2_outbound_routes route_row
     where route_row.tenant_id = ${tenantId}
       and route_row.id = ${routeId}
     for share of route_row
  `);
  assertAtMostOneRow(result.rows, "Explicit reroute original-route lookup");
  return result.rows[0] ?? null;
}

function rerouteOriginalRouteScopeMatches(
  original: ExistingRerouteOriginalRouteRow,
  route: InboxV2OutboundRoute
): boolean {
  if (route.selection.intent.kind !== "explicit_reroute") return false;
  const originalCreatedAt = timestampMilliseconds(original.created_at);
  return (
    String(original.id) === String(route.selection.intent.originalRoute.id) &&
    String(original.conversation_id) === String(route.conversation.id) &&
    String(original.external_thread_id) === String(route.externalThread.id) &&
    String(original.operation_id) === String(route.operationId) &&
    nullableString(original.content_kind_id) ===
      nullableString(route.contentKindId) &&
    Number.isFinite(originalCreatedAt) &&
    originalCreatedAt <= timestampMilliseconds(route.createdAt)
  );
}

function assertExplicitRerouteAuthorizationContext(
  context: InboxV2AuthorizedCommandMutationContext,
  route: InboxV2OutboundRoute,
  original: ExistingRerouteOriginalRouteRow
): void {
  const sourceUseDecisions = context.authorizationDecisionRefs.filter(
    (decision) =>
      decision.permissionId === "core:source_account.use" &&
      rerouteSourceAccountDecisionMatchesContext(decision, context)
  );
  const rerouteDecisions = context.authorizationDecisionRefs.filter(
    (decision) =>
      decision.permissionId === "core:source.dispatch.reroute" &&
      rerouteSourceAccountDecisionMatchesContext(decision, context)
  );
  const originalSourceAccountId = String(original.source_account_id);
  const selectedSourceAccountId = String(route.sourceAccount.id);
  const originalUseDecisions = sourceUseDecisions.filter(
    (decision) => String(decision.resource.entityId) === originalSourceAccountId
  );
  const selectedUseDecisions = sourceUseDecisions.filter(
    (decision) => String(decision.resource.entityId) === selectedSourceAccountId
  );
  const originalRerouteDecisions = rerouteDecisions.filter(
    (decision) => String(decision.resource.entityId) === originalSourceAccountId
  );
  const sameSourceAccount = originalSourceAccountId === selectedSourceAccountId;
  const distinctDecisionIds = new Set(
    [...sourceUseDecisions, ...rerouteDecisions].map((decision) => decision.id)
  );
  const selectedSnapshotMatchCount = selectedUseDecisions.filter((decision) =>
    routeAuthorizationSnapshotMatchesDecision(
      route.sourceAccountAuthorization,
      decision,
      "source_account",
      route.sourceAccount.id
    )
  ).length;

  if (
    sourceUseDecisions.length !== 2 ||
    rerouteDecisions.length !== 1 ||
    originalRerouteDecisions.length !== 1 ||
    originalRerouteDecisions[0]!.id !== context.authorizationDecisionId ||
    (sameSourceAccount
      ? originalUseDecisions.length !== 2 || selectedUseDecisions.length !== 2
      : originalUseDecisions.length !== 1 ||
        selectedUseDecisions.length !== 1) ||
    selectedSnapshotMatchCount !== 1 ||
    distinctDecisionIds.size !== sourceUseDecisions.length + 1
  ) {
    throw invariantError(
      "Inbox V2 route resolution crossed its authorized explicit-reroute context."
    );
  }
}

function rerouteSourceAccountDecisionMatchesContext(
  decision: InboxV2AuthorizedCommandMutationContext["authorizationDecisionRefs"][number],
  context: InboxV2AuthorizedCommandMutationContext
): boolean {
  return (
    decision.tenantId === context.tenantId &&
    decision.authorizationEpoch === context.authorizationEpoch &&
    decision.outcome === "allowed" &&
    decision.resourceScopeId === "core:source-account" &&
    decision.resource.tenantId === context.tenantId &&
    decision.resource.entityTypeId === "core:source-account" &&
    authorizationDecisionPrincipalMatchesContext(decision, context)
  );
}

export function buildInsertInboxV2OutboundRouteSql(
  route: InboxV2OutboundRoute,
  fence: BindingRouteFenceRow
): SQL {
  const principalEmployeeId =
    route.principal.kind === "employee" ? route.principal.employee.id : null;
  const principalTrustedServiceId =
    route.principal.kind === "trusted_service"
      ? route.principal.trustedServiceId
      : null;
  return sql`
    insert into inbox_v2_outbound_routes (
      tenant_id, id, principal_kind, principal_employee_id,
      principal_trusted_service_id, conversation_id, external_thread_id,
      external_thread_revision, source_thread_binding_id,
      source_connection_id, source_account_id, operation_id, content_kind_id,
      authorization_epoch, required_conversation_permission_id,
      binding_revision, account_generation, binding_generation,
      remote_access_revision, administrative_revision, capability_revision,
      route_descriptor_revision, adapter_contract_id,
      adapter_contract_version, adapter_declaration_revision,
      adapter_surface_id, adapter_loaded_by_trusted_service_id,
      adapter_loaded_at, adapter_contract_snapshot,
      route_descriptor_snapshot, route_descriptor_digest_sha256,
      route_policy_id, route_policy_revision,
      conversation_authorization_snapshot,
      source_account_authorization_snapshot, reference_context_snapshot,
      runtime_observation_snapshot, selection_intent_kind,
      selection_intent_snapshot, selection_reason,
      candidate_snapshot_token, candidate_snapshot_not_after,
      fallback_policy_ordinal, selected_at, mutation_token,
      idempotency_token, correlation_token, revision, created_at
    ) values (
      ${route.tenantId}, ${route.id}, ${route.principal.kind},
      ${principalEmployeeId}, ${principalTrustedServiceId},
      ${route.conversation.id}, ${route.externalThread.id}, 1,
      ${route.sourceThreadBinding.id}, ${route.sourceConnection.id},
      ${route.sourceAccount.id}, ${route.operationId}, ${route.contentKindId},
      ${route.authorizationEpoch}, ${route.requiredConversationPermissionId},
      ${BigInt(String(fence.binding_revision))},
      ${BigInt(route.bindingFence.accountGeneration)},
      ${BigInt(route.bindingFence.bindingGeneration)},
      ${BigInt(route.bindingFence.remoteAccessRevision)},
      ${BigInt(route.bindingFence.administrativeRevision)},
      ${BigInt(route.bindingFence.capabilityRevision)},
      ${BigInt(route.bindingFence.routeDescriptorRevision)},
      ${route.adapterContract.contractId}, ${route.adapterContract.contractVersion},
      ${BigInt(route.adapterContract.declarationRevision)},
      ${route.adapterContract.surfaceId},
      ${route.adapterContract.loadedByTrustedServiceId},
      ${toDate(route.adapterContract.loadedAt)},
      ${toJson(route.adapterContract)}::jsonb,
      ${toJson(route.routeDescriptor)}::jsonb,
      ${route.routeDescriptor.descriptorDigestSha256},
      ${route.routePolicy.id}, ${BigInt(route.routePolicyRevision)},
      ${toJson(route.conversationAuthorization)}::jsonb,
      ${toJson(route.sourceAccountAuthorization)}::jsonb,
      ${toJson(route.referenceContext)}::jsonb,
      ${toJson(route.runtimeObservationAtResolution)}::jsonb,
      ${route.selection.intent.kind},
      ${toJson(route.selection.intent)}::jsonb, ${route.selection.reason},
      ${route.selection.candidateSnapshotToken},
      ${toDate(route.selection.candidateSnapshotNotAfter)},
      ${route.selection.fallbackPolicyOrdinal},
      ${toDate(route.selection.selectedAt)}, ${route.mutationToken},
      ${route.idempotencyToken}, ${route.correlationToken},
      ${BigInt(route.revision)}, ${toDate(route.createdAt)}
    )
    on conflict do nothing
    returning id
  `;
}

async function loadExistingRoute(
  transaction: RawSqlExecutor,
  route: InboxV2OutboundRoute
): Promise<ExistingRouteRow | null> {
  const result = await transaction.execute<ExistingRouteRow>(sql`
    select id, mutation_token, idempotency_token, correlation_token,
           conversation_id, external_thread_id, source_thread_binding_id,
           source_connection_id, source_account_id, binding_revision,
           created_at
      from inbox_v2_outbound_routes
     where tenant_id = ${route.tenantId}
       and (
         id = ${route.id}
         or mutation_token = ${route.mutationToken}
         or idempotency_token = ${route.idempotencyToken}
       )
     order by case when id = ${route.id} then 0 else 1 end
     limit 1
     for share
  `);
  return result.rows[0] ?? null;
}

function existingRouteMatches(
  row: ExistingRouteRow,
  route: InboxV2OutboundRoute,
  fence: BindingRouteFenceRow
): boolean {
  return (
    String(row.id) === String(route.id) &&
    String(row.mutation_token) === String(route.mutationToken) &&
    String(row.idempotency_token) === String(route.idempotencyToken) &&
    String(row.correlation_token) === String(route.correlationToken) &&
    String(row.conversation_id) === String(route.conversation.id) &&
    String(row.external_thread_id) === String(route.externalThread.id) &&
    String(row.source_thread_binding_id) ===
      String(route.sourceThreadBinding.id) &&
    String(row.source_connection_id) === String(route.sourceConnection.id) &&
    String(row.source_account_id) === String(route.sourceAccount.id) &&
    BigInt(String(row.binding_revision)) ===
      BigInt(String(fence.binding_revision)) &&
    sameTimestamp(row.created_at, route.createdAt)
  );
}

function bindingAnchorMatchesRoute(
  row: BindingAnchorRow,
  route: InboxV2OutboundRoute
): boolean {
  return (
    String(row.binding_id) === String(route.sourceThreadBinding.id) &&
    String(row.external_thread_id) === String(route.externalThread.id) &&
    String(row.source_connection_id) === String(route.sourceConnection.id) &&
    String(row.source_account_id) === String(route.sourceAccount.id)
  );
}

function bindingFenceMatchesRoute(
  row: BindingRouteFenceRow,
  route: InboxV2OutboundRoute
): boolean {
  return (
    BigInt(String(row.account_generation)) ===
      BigInt(route.bindingFence.accountGeneration) &&
    BigInt(String(row.binding_generation)) ===
      BigInt(route.bindingFence.bindingGeneration) &&
    BigInt(String(row.remote_access_revision)) ===
      BigInt(route.bindingFence.remoteAccessRevision) &&
    BigInt(String(row.administrative_revision)) ===
      BigInt(route.bindingFence.administrativeRevision) &&
    BigInt(String(row.capability_revision)) ===
      BigInt(route.bindingFence.capabilityRevision) &&
    BigInt(String(row.route_descriptor_revision)) ===
      BigInt(route.bindingFence.routeDescriptorRevision)
  );
}

export function buildFindInboxV2OutboundDispatchSql(input: {
  tenantId: InboxV2TenantId;
  dispatchId: InboxV2OutboundDispatchId;
}): SQL {
  return sql`
    ${outboundDispatchReadSelectSql()}
     where dispatch_row.tenant_id = ${input.tenantId}
       and dispatch_row.id = ${input.dispatchId}
     limit 1
  `;
}

export function buildListInboxV2MessageDispatchesSql(input: {
  tenantId: InboxV2TenantId;
  messageId: InboxV2MessageId;
  after: InboxV2MessageDispatchCursor | null;
  limit: number;
}): SQL {
  const afterPredicate =
    input.after === null
      ? sql``
      : sql`and (
          dispatch_row.created_at > ${toDate(input.after.createdAt)}
          or (
            dispatch_row.created_at = ${toDate(input.after.createdAt)}
            and dispatch_row.id collate "C" > ${input.after.dispatchId}
          )
        )`;
  return sql`
    ${outboundDispatchReadSelectSql()}
     where dispatch_row.tenant_id = ${input.tenantId}
       and dispatch_row.message_id = ${input.messageId}
       ${afterPredicate}
     order by dispatch_row.created_at asc,
       dispatch_row.id collate "C" asc
     limit ${input.limit}
  `;
}

function outboundDispatchReadSelectSql(): SQL {
  return sql`
    select dispatch_row.tenant_id, dispatch_row.id,
           dispatch_row.message_id, dispatch_row.route_id,
           dispatch_row.multi_send_operation_id, dispatch_row.state,
           dispatch_row.attempt_count, dispatch_row.active_attempt_id,
           dispatch_row.last_attempt_id,
           dispatch_row.retry_authorization_decision_id,
           dispatch_row.revision, dispatch_row.created_at,
           dispatch_row.updated_at
      from inbox_v2_outbound_dispatches dispatch_row
  `;
}

function mapDispatchReadRow(
  row: DispatchReadRow,
  expectedTenantId: InboxV2TenantId
): InboxV2OutboundDispatch {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("Outbound dispatch tenant mismatch.");
  }
  const reference = <const TKind extends string>(kind: TKind, id: unknown) => ({
    tenantId,
    kind,
    id: String(id)
  });
  return inboxV2OutboundDispatchSchema.parse({
    tenantId,
    id: String(row.id),
    message: reference("message", row.message_id),
    route: reference("outbound_route", row.route_id),
    multiSendOperation:
      row.multi_send_operation_id === null ||
      row.multi_send_operation_id === undefined
        ? null
        : reference(
            "outbound_multi_send_operation",
            row.multi_send_operation_id
          ),
    state: String(row.state),
    attemptCount: parseNonNegativeDatabaseInteger(
      row.attempt_count,
      "Outbound dispatch attempt count"
    ),
    activeAttempt:
      row.active_attempt_id === null || row.active_attempt_id === undefined
        ? null
        : reference("outbound_dispatch_attempt", row.active_attempt_id),
    lastAttempt:
      row.last_attempt_id === null || row.last_attempt_id === undefined
        ? null
        : reference("outbound_dispatch_attempt", row.last_attempt_id),
    retryAuthorization:
      row.retry_authorization_decision_id === null ||
      row.retry_authorization_decision_id === undefined
        ? null
        : reference(
            "outbound_dispatch_reconciliation_decision",
            row.retry_authorization_decision_id
          ),
    revision: parsePositiveDatabaseBigint(
      row.revision,
      "Outbound dispatch revision"
    ),
    createdAt: parseDatabaseTimestamp(
      row.created_at,
      "Outbound dispatch createdAt"
    ),
    updatedAt: parseDatabaseTimestamp(
      row.updated_at,
      "Outbound dispatch updatedAt"
    )
  });
}

async function createDispatchInTransaction(
  transaction: RawSqlExecutor,
  dispatch: InboxV2OutboundDispatch,
  expectedMultiSendOperationId: string | null
): Promise<CreateInboxV2OutboundDispatchResult> {
  if (
    dispatch.state !== "queued" ||
    dispatch.revision !== "1" ||
    dispatch.attemptCount !== 0
  ) {
    throw unsupported(
      "OutboundDispatch creation requires a queued revision-1 dispatch."
    );
  }
  const dispatchMultiSendId = dispatch.multiSendOperation?.id ?? null;
  if (dispatchMultiSendId !== expectedMultiSendOperationId) {
    return { kind: "multi_send_required" };
  }

  const anchors = await lockMessageAndRoute(
    transaction,
    dispatch.tenantId,
    dispatch.message.id,
    dispatch.route.id
  );
  if (anchors.message === null) return { kind: "message_not_found" };
  if (anchors.route === null) return { kind: "route_not_found" };
  if (
    String(anchors.message.conversation_id) !==
    String(anchors.route.conversation_id)
  ) {
    return { kind: "message_route_conflict" };
  }

  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundDispatchSql({
      dispatch,
      conversationId: String(anchors.message.conversation_id),
      timelineItemId: String(anchors.message.timeline_item_id)
    })
  );
  if (inserted.rows.length === 1) {
    return { kind: "committed", dispatch };
  }

  const existing = await loadDispatchByIdOrRoute(transaction, dispatch);
  if (existing === null) return { kind: "dispatch_id_conflict" };
  if (existingDispatchMatches(existing, dispatch)) {
    return { kind: "already_exists", dispatch };
  }
  return {
    kind:
      String(existing.route_id) === String(dispatch.route.id) &&
      String(existing.id) !== String(dispatch.id)
        ? "route_already_dispatched"
        : "dispatch_id_conflict"
  };
}

type MessageRouteAnchors = {
  message: {
    conversation_id: unknown;
    timeline_item_id: unknown;
  } | null;
  route: { conversation_id: unknown } | null;
};

async function lockMessageAndRoute(
  transaction: RawSqlExecutor,
  tenantId: string,
  messageId: string,
  routeId: string
): Promise<MessageRouteAnchors> {
  // Stable lock order is Message -> immutable Route. Attempt opening adds the
  // mutable binding head only after these two anchors.
  const messageResult = await transaction.execute<{
    conversation_id: unknown;
    timeline_item_id: unknown;
  }>(sql`
    select conversation_id, timeline_item_id
      from inbox_v2_messages
     where tenant_id = ${tenantId}
       and id = ${messageId}
     for share
  `);
  const routeResult = await transaction.execute<{ conversation_id: unknown }>(
    sql`
      select conversation_id
        from inbox_v2_outbound_routes
       where tenant_id = ${tenantId}
         and id = ${routeId}
       for share
    `
  );
  return {
    message: messageResult.rows[0] ?? null,
    route: routeResult.rows[0] ?? null
  };
}

export function buildInsertInboxV2OutboundDispatchSql(input: {
  dispatch: InboxV2OutboundDispatch;
  conversationId: string;
  timelineItemId: string;
}): SQL {
  const { dispatch } = input;
  return sql`
    insert into inbox_v2_outbound_dispatches (
      tenant_id, id, message_id, conversation_id, timeline_item_id,
      route_id, multi_send_operation_id, state, attempt_count,
      active_attempt_id, last_attempt_id, retry_authorization_decision_id,
      revision, created_at, updated_at
    ) values (
      ${dispatch.tenantId}, ${dispatch.id}, ${dispatch.message.id},
      ${input.conversationId}, ${input.timelineItemId}, ${dispatch.route.id},
      ${dispatch.multiSendOperation?.id ?? null}, ${dispatch.state},
      ${dispatch.attemptCount}, ${dispatch.activeAttempt?.id ?? null},
      ${dispatch.lastAttempt?.id ?? null},
      ${dispatch.retryAuthorization?.id ?? null},
      ${BigInt(dispatch.revision)}, ${toDate(dispatch.createdAt)},
      ${toDate(dispatch.updatedAt)}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildInsertInboxV2AtomicOutboundDispatchMaterializationSql(input: {
  tenantId: string;
  dispatchId: string;
  mutationId: string;
  streamCommitId: string;
  streamPosition: string;
  resultingRevision: string;
  createdAt: string;
}): SQL {
  return sql`
    insert into inbox_v2_atomic_outbound_dispatch_materializations (
      tenant_id, dispatch_id, mutation_id, stream_commit_id, stream_position,
      resulting_revision, created_at
    ) values (
      ${input.tenantId}, ${input.dispatchId}, ${input.mutationId},
      ${input.streamCommitId}, ${BigInt(input.streamPosition)},
      ${BigInt(input.resultingRevision)}, ${toDate(input.createdAt)}
    )
    returning dispatch_id as id
  `;
}

async function loadDispatchByIdOrRoute(
  transaction: RawSqlExecutor,
  dispatch: InboxV2OutboundDispatch
): Promise<ExistingDispatchRow | null> {
  const result = await transaction.execute<ExistingDispatchRow>(sql`
    select id, message_id, route_id, multi_send_operation_id, state,
           attempt_count, active_attempt_id, last_attempt_id,
           retry_authorization_decision_id, revision, created_at, updated_at
      from inbox_v2_outbound_dispatches
     where tenant_id = ${dispatch.tenantId}
       and (id = ${dispatch.id} or route_id = ${dispatch.route.id})
     order by case when id = ${dispatch.id} then 0 else 1 end
     limit 1
     for update
  `);
  return result.rows[0] ?? null;
}

async function lockDispatch(
  transaction: RawSqlExecutor,
  dispatch: InboxV2OutboundDispatch
): Promise<ExistingDispatchRow | null> {
  const result = await transaction.execute<ExistingDispatchRow>(sql`
    select id, message_id, route_id, multi_send_operation_id, state,
           attempt_count, active_attempt_id, last_attempt_id,
           retry_authorization_decision_id, revision, created_at, updated_at
      from inbox_v2_outbound_dispatches
     where tenant_id = ${dispatch.tenantId}
       and id = ${dispatch.id}
     for update
  `);
  return result.rows[0] ?? null;
}

function existingDispatchMatches(
  row: ExistingDispatchRow,
  dispatch: InboxV2OutboundDispatch
): boolean {
  return (
    String(row.id) === String(dispatch.id) &&
    String(row.message_id) === String(dispatch.message.id) &&
    String(row.route_id) === String(dispatch.route.id) &&
    nullableString(row.multi_send_operation_id) ===
      nullableString(dispatch.multiSendOperation?.id ?? null) &&
    String(row.state) === dispatch.state &&
    Number(row.attempt_count) === dispatch.attemptCount &&
    nullableString(row.active_attempt_id) ===
      nullableString(dispatch.activeAttempt?.id ?? null) &&
    nullableString(row.last_attempt_id) ===
      nullableString(dispatch.lastAttempt?.id ?? null) &&
    nullableString(row.retry_authorization_decision_id) ===
      nullableString(dispatch.retryAuthorization?.id ?? null) &&
    BigInt(String(row.revision)) === BigInt(dispatch.revision) &&
    sameTimestamp(row.created_at, dispatch.createdAt) &&
    sameTimestamp(row.updated_at, dispatch.updatedAt)
  );
}

type OpenAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "open_attempt" }
>;
type CompleteAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "complete_attempt" }
>;

type ProviderIoOutboxLeaseRow = {
  state: unknown;
  work_revision: unknown;
  lease_owner_id: unknown;
  lease_token_hash: unknown;
  lease_revision: unknown;
  lease_claimed_at: unknown;
  lease_expires_at: unknown;
  database_now: unknown;
  intent_id: unknown;
  intent_type_id: unknown;
  intent_handler_id: unknown;
  intent_effect_class: unknown;
  intent_stream_commit_id: unknown;
  intent_stream_position: unknown;
  intent_stream_epoch: unknown;
  intent_event_id: unknown;
  intent_change_ids: unknown;
  intent_payload_reference: unknown;
  intent_consumer_dedupe_key: unknown;
  intent_correlation_id: unknown;
  intent_available_at: unknown;
  intent_hash: unknown;
};

type ValidatedProviderIoOutboxLease = Readonly<{
  kind: "fenced";
  intent: InboxV2OutboxIntent;
  dispatchId: InboxV2OutboundDispatchId;
  databaseNow: string;
  leaseClaimedAt: string;
  leaseExpiresAt: string;
  workRevision: string;
}>;

function parseProviderIoOutboxLeaseFence(
  input: InboxV2ProviderIoOutboxLeaseFence
): InboxV2ProviderIoOutboxLeaseFence {
  return Object.freeze({
    context: inboxV2RepositoryTenantContextSchema.parse(input.context),
    intentId: inboxV2OutboxIntentIdSchema.parse(input.intentId),
    workerId: inboxV2OutboxWorkerIdSchema.parse(input.workerId),
    leaseToken: inboxV2OutboxLeaseTokenSchema.parse(input.leaseToken),
    expectedLeaseRevision: inboxV2EntityRevisionSchema.parse(
      input.expectedLeaseRevision
    ),
    expectedHandlerId: inboxV2NamespacedIdSchema.parse(input.expectedHandlerId)
  });
}

function assertProviderIoFenceTenant(
  fence: InboxV2ProviderIoOutboxLeaseFence,
  tenantId: InboxV2TenantId
): void {
  if (fence.context.tenantId !== tenantId) {
    throw new CoreError(
      "tenant.boundary_violation",
      "Provider I/O outbox lease and outbound commit must belong to one tenant."
    );
  }
}

export function buildLockInboxV2ProviderIoOutboxLeaseSql(
  input: InboxV2ProviderIoOutboxLeaseFence
): SQL {
  const fence = parseProviderIoOutboxLeaseFence(input);
  return sql`
    with database_clock as materialized (
      select clock_timestamp() as database_now
    )
    select work.state::text as state,
           work.revision::text as work_revision,
           work.lease_owner_id,
           work.lease_token_hash,
           work.lease_revision::text as lease_revision,
           work.lease_claimed_at,
           work.lease_expires_at,
           database_clock.database_now,
           intent.id as intent_id,
           intent.type_id as intent_type_id,
           intent.handler_id as intent_handler_id,
           intent.effect_class::text as intent_effect_class,
           intent.stream_commit_id as intent_stream_commit_id,
           intent.stream_position::text as intent_stream_position,
           stream_commit.stream_epoch as intent_stream_epoch,
           intent.event_id as intent_event_id,
           intent.change_ids as intent_change_ids,
           intent.payload_reference as intent_payload_reference,
           intent.consumer_dedupe_key as intent_consumer_dedupe_key,
           intent.correlation_id as intent_correlation_id,
           intent.available_at as intent_available_at,
           intent.intent_hash as intent_hash
      from public.inbox_v2_outbox_work_items work
      join public.inbox_v2_outbox_intents intent
        on intent.tenant_id = work.tenant_id
       and intent.id = work.intent_id
      join public.inbox_v2_tenant_stream_commits stream_commit
        on stream_commit.tenant_id = intent.tenant_id
       and stream_commit.id = intent.stream_commit_id
      cross join database_clock
     where work.tenant_id = ${fence.context.tenantId}
       and work.intent_id = ${fence.intentId}
     for update of work
  `;
}

async function lockAndValidateProviderIoOutboxLease(
  transaction: RawSqlExecutor,
  fence: InboxV2ProviderIoOutboxLeaseFence,
  expectedDispatchId: InboxV2OutboundDispatchId | null
): Promise<
  ValidatedProviderIoOutboxLease | InboxV2ProviderIoOutboxFenceFailure
> {
  const result = await transaction.execute<ProviderIoOutboxLeaseRow>(
    buildLockInboxV2ProviderIoOutboxLeaseSql(fence)
  );
  assertAtMostOneRow(result.rows, "Provider I/O outbox lease lock");
  const row = result.rows[0];
  if (row === undefined) return { kind: "outbox_not_found" };

  const state = inboxV2OutboxWorkStateSchema.parse(row.state);
  if (state !== "leased") {
    return { kind: "outbox_not_leased", currentState: state };
  }
  const currentLeaseRevision = inboxV2EntityRevisionSchema.parse(
    parsePositiveDatabaseBigint(
      row.lease_revision,
      "provider I/O outbox lease revision"
    )
  );
  const workRevision = inboxV2EntityRevisionSchema.parse(
    parsePositiveDatabaseBigint(
      row.work_revision,
      "provider I/O outbox work revision"
    )
  );
  const tokenHash = calculateInboxV2OutboxLeaseTokenHash(fence.leaseToken);
  if (
    nullableString(row.lease_owner_id) !== fence.workerId ||
    nullableString(row.lease_token_hash) !== tokenHash
  ) {
    return { kind: "outbox_stale_token", currentLeaseRevision };
  }
  const databaseNow = parseDatabaseTimestamp(
    row.database_now,
    "provider I/O database clock"
  );
  const leaseClaimedAt = parseDatabaseTimestamp(
    row.lease_claimed_at,
    "provider I/O outbox lease claim"
  );
  const leaseExpiresAt = parseDatabaseTimestamp(
    row.lease_expires_at,
    "provider I/O outbox lease expiry"
  );
  if (Date.parse(leaseExpiresAt) <= Date.parse(databaseNow)) {
    return { kind: "outbox_lease_expired", currentLeaseRevision };
  }
  if (currentLeaseRevision !== fence.expectedLeaseRevision) {
    return {
      kind: "outbox_lease_revision_conflict",
      currentLeaseRevision
    };
  }

  const payloadReference = parseDatabasePayloadReference(
    row.intent_payload_reference
  );
  const parsedDispatchId = inboxV2OutboundDispatchIdSchema.safeParse(
    payloadReference?.recordId
  );
  if (
    nullableString(row.intent_type_id) !== "core:provider.dispatch" ||
    nullableString(row.intent_effect_class) !== "provider_io" ||
    nullableString(row.intent_handler_id) !== fence.expectedHandlerId ||
    payloadReference === null ||
    !parsedDispatchId.success ||
    payloadReference.tenantId !== fence.context.tenantId ||
    (expectedDispatchId !== null &&
      parsedDispatchId.data !== expectedDispatchId) ||
    payloadReference.schemaId !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
    payloadReference.schemaVersion !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
  ) {
    return { kind: "outbox_intent_conflict" };
  }
  const intent = inboxV2OutboxIntentSchema.parse({
    tenantId: fence.context.tenantId,
    id: row.intent_id,
    typeId: row.intent_type_id,
    handlerId: row.intent_handler_id,
    effectClass: row.intent_effect_class,
    commit: {
      tenantId: fence.context.tenantId,
      streamEpoch: row.intent_stream_epoch,
      commitId: row.intent_stream_commit_id,
      streamPosition: parsePositiveDatabaseBigint(
        row.intent_stream_position,
        "provider I/O intent stream position"
      )
    },
    eventId: row.intent_event_id,
    changeIds: parseDatabaseJson(row.intent_change_ids),
    payloadReference,
    consumerDedupeKey: row.intent_consumer_dedupe_key,
    correlationId: row.intent_correlation_id,
    availableAt: parseDatabaseTimestamp(
      row.intent_available_at,
      "provider I/O intent availability"
    ),
    intentHash: row.intent_hash
  });
  return {
    kind: "fenced",
    intent,
    dispatchId: parsedDispatchId.data,
    databaseNow,
    leaseClaimedAt,
    leaseExpiresAt,
    workRevision
  };
}

function providerAttemptTimeFenceMatches(
  commit: InboxV2OutboundDispatchAttemptCommit,
  fence: ValidatedProviderIoOutboxLease
): boolean {
  const databaseNow = Date.parse(fence.databaseNow);
  if (commit.kind === "open_attempt") {
    const openedAt = Date.parse(commit.attempt.openedAt);
    const attemptExpiresAt = Date.parse(commit.attempt.leaseExpiresAt);
    return (
      openedAt >= Date.parse(fence.leaseClaimedAt) &&
      openedAt <= databaseNow &&
      attemptExpiresAt > databaseNow &&
      attemptExpiresAt <= Date.parse(fence.leaseExpiresAt)
    );
  }

  const attemptExpired =
    databaseNow >= Date.parse(commit.attemptBefore.leaseExpiresAt);
  const completedAt =
    commit.attemptAfter.outcome.kind === "pending"
      ? Number.POSITIVE_INFINITY
      : Date.parse(commit.attemptAfter.outcome.completedAt);
  if (completedAt > databaseNow) return false;
  if (attemptExpired) {
    return (
      commit.completionSource === "lease_expired" &&
      commit.attemptAfter.outcome.kind === "outcome_unknown"
    );
  }
  return commit.completionSource !== "lease_expired";
}

function contentPlanMatchesOpenAttempt(
  plan: InboxV2OutboundDispatchContentPlan,
  commit: OpenAttemptCommit
): boolean {
  return (
    plan.tenantId === commit.tenantId &&
    String(plan.dispatch.id) === String(commit.dispatchBefore.id) &&
    String(plan.message.id) === String(commit.dispatchBefore.message.id) &&
    String(plan.route.id) === String(commit.routeSnapshot.id) &&
    String(plan.binding.id) ===
      String(commit.routeSnapshot.sourceThreadBinding.id) &&
    String(plan.bindingRevision) ===
      String(commit.bindingHeadSnapshot.bindingRevision) &&
    String(plan.capabilityRevision) ===
      String(commit.routeSnapshot.bindingFence.capabilityRevision) &&
    sameJson(plan.adapterContract, commit.routeSnapshot.adapterContract) &&
    Date.parse(plan.createdAt) <= Date.parse(commit.attempt.openedAt)
  );
}

function contentPlanMatchesCompletedAttempt(
  plan: InboxV2OutboundDispatchContentPlan,
  commit: CompleteAttemptCommit
): boolean {
  return (
    plan.tenantId === commit.tenantId &&
    String(plan.dispatch.id) === String(commit.dispatchBefore.id) &&
    String(plan.message.id) === String(commit.dispatchBefore.message.id) &&
    String(plan.route.id) === String(commit.dispatchBefore.route.id) &&
    String(commit.attemptBefore.dispatch.id) ===
      String(commit.dispatchBefore.id) &&
    String(commit.attemptBefore.route.id) ===
      String(commit.dispatchBefore.route.id)
  );
}

function providerArtifactSetMatchesCompletion(
  artifacts: readonly InboxV2OutboundDispatchArtifact[],
  plan: InboxV2OutboundDispatchContentPlan,
  commit: CompleteAttemptCommit
): boolean {
  if (
    artifacts.length !== plan.artifacts.length ||
    artifacts.length === 0 ||
    commit.attemptAfter.outcome.kind === "pending"
  ) {
    return false;
  }
  const completedAt = commit.attemptAfter.outcome.completedAt;
  const ordered = [...artifacts].sort(
    (left, right) => left.ordinal - right.ordinal
  );
  if (
    ordered.some((artifact, index) => {
      const planned = plan.artifacts[index];
      if (planned === undefined || artifact.ordinal !== planned.ordinal) {
        return true;
      }
      const expectedId = deriveInboxV2OutboundDispatchArtifactId({
        tenantId: commit.tenantId,
        dispatch: commit.attemptBefore.dispatch,
        route: commit.attemptBefore.route,
        attempt: {
          tenantId: commit.tenantId,
          kind: "outbound_dispatch_attempt",
          id: commit.attemptBefore.id
        },
        ordinal: artifact.ordinal
      });
      return (
        artifact.id !== expectedId ||
        artifact.tenantId !== commit.tenantId ||
        String(artifact.dispatch.id) !== String(commit.dispatchBefore.id) ||
        String(artifact.route.id) !== String(commit.dispatchBefore.route.id) ||
        String(artifact.attempt.id) !== String(commit.attemptBefore.id) ||
        artifact.createdAt !== completedAt ||
        artifact.revision !== "1"
      );
    })
  ) {
    return false;
  }

  const outcome = commit.attemptAfter.outcome;
  if (commit.completionSource === "lease_expired") {
    return (
      outcome.kind === "outcome_unknown" &&
      ordered.every((artifact) => artifact.state === "outcome_unknown") &&
      sameJson(outcome.diagnostic, ordered[0]?.diagnostic)
    );
  }
  if (commit.completionSource !== "provider_result") return false;

  if (ordered.every((artifact) => artifact.state === "accepted")) {
    return outcome.kind === "accepted";
  }
  if (ordered.every((artifact) => artifact.state === "failed")) {
    const terminal = ordered.find(
      (artifact) => artifact.diagnostic?.retryable === false
    );
    const representative = terminal ?? ordered[0];
    const expectedKind =
      terminal === undefined ? "retryable_failure" : "terminal_failure";
    return (
      outcome.kind === expectedKind &&
      sameJson(outcome.diagnostic, representative?.diagnostic)
    );
  }
  const states = new Set(ordered.map((artifact) => artifact.state));
  const representative = ordered.find(
    (artifact) => artifact.state === "outcome_unknown"
  );
  const expectedDiagnostic =
    states.size > 1
      ? createInboxV2MixedProviderArtifactOutcomeDiagnostic(
          commit.attemptBefore.claimToken
        )
      : representative?.diagnostic;
  return (
    outcome.kind === "outcome_unknown" &&
    expectedDiagnostic !== undefined &&
    sameJson(outcome.diagnostic, expectedDiagnostic) &&
    outcome.requiredAction ===
      (states.size > 1 ||
      !commit.attemptBefore.retrySafety.automaticRetryAllowed
        ? "operator_duplicate_risk_decision_required"
        : "automated_reconciliation_required")
  );
}

function providerRouteFailureTimeFenceMatches(
  commit: InboxV2OutboundDispatchRouteFailureCommit,
  fence: ValidatedProviderIoOutboxLease
): boolean {
  const failedAt = Date.parse(commit.failedAt);
  return (
    failedAt >= Date.parse(fence.leaseClaimedAt) &&
    failedAt <= Date.parse(fence.databaseNow) &&
    failedAt < Date.parse(fence.leaseExpiresAt)
  );
}

function parseDatabasePayloadReference(
  value: unknown
): ReturnType<typeof inboxV2PayloadReferenceSchema.parse> | null {
  if (value === null || value === undefined) return null;
  let candidate: unknown = value;
  if (typeof value === "string") {
    try {
      candidate = JSON.parse(value) as unknown;
    } catch (cause) {
      throw invariantError(
        `Provider I/O outbox payload reference is invalid JSON: ${String(cause)}`
      );
    }
  }
  try {
    return inboxV2PayloadReferenceSchema.parse(candidate);
  } catch (cause) {
    throw invariantError(
      `Provider I/O outbox payload reference is invalid: ${String(cause)}`
    );
  }
}

function parseDatabaseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch (cause) {
    throw invariantError(`Database JSON is invalid: ${String(cause)}`);
  }
}

type ArtifactRetrySafetyRow = {
  retry_safe: unknown;
};

export function buildCheckInboxV2ArtifactRetrySafetySql(input: {
  tenantId: InboxV2TenantId;
  dispatchId: InboxV2OutboundDispatchId;
  attemptId: InboxV2OutboundDispatchAttempt["id"];
}): SQL {
  return sql`
    select not exists (
      select 1
        from inbox_v2_outbound_dispatch_artifacts artifact
       where artifact.tenant_id = ${input.tenantId}
         and artifact.dispatch_id = ${input.dispatchId}
         and artifact.attempt_id = ${input.attemptId}
         and artifact.state = 'accepted'
    ) as retry_safe
  `;
}

async function retryIsSafeForAttempt(
  transaction: RawSqlExecutor,
  input: Parameters<typeof buildCheckInboxV2ArtifactRetrySafetySql>[0]
): Promise<boolean> {
  const result = await transaction.execute<ArtifactRetrySafetyRow>(
    buildCheckInboxV2ArtifactRetrySafetySql(input)
  );
  return result.rows[0]?.retry_safe === true;
}

async function openAttemptInTransaction(
  transaction: RawSqlExecutor,
  commit: OpenAttemptCommit,
  providerOpen?: Readonly<{
    contentPlan: InboxV2OutboundDispatchContentPlan;
    databaseNow: string;
  }>
): Promise<ApplyInboxV2DispatchAttemptResult> {
  const dispatchRow = await lockDispatch(transaction, commit.dispatchBefore);
  if (dispatchRow === null) return { kind: "dispatch_not_found" };
  if (!existingDispatchMatches(dispatchRow, commit.dispatchBefore)) {
    if (existingDispatchMatches(dispatchRow, commit.dispatchAfter)) {
      const existingAttempt = await loadAttempt(transaction, commit.attempt);
      return existingAttempt !== null &&
        existingAttemptMatches(existingAttempt, commit.attempt)
        ? { kind: "already_applied" }
        : { kind: "attempt_id_conflict" };
    }
    if (existingDispatchIsCancellationOf(dispatchRow, commit.dispatchBefore)) {
      return { kind: "dispatch_cancelled" };
    }
    return { kind: "dispatch_state_conflict" };
  }

  if (
    !(await lockExactOutboundRouteSnapshot(
      transaction,
      commit.routeSnapshot,
      commit.dispatchBefore.route.id
    ))
  ) {
    return { kind: "route_not_found" };
  }
  const fence = await lockBindingFence(transaction, commit.routeSnapshot);
  if (
    fence === null ||
    !bindingAnchorMatchesRoute(fence, commit.routeSnapshot) ||
    !bindingFenceMatchesRoute(fence, commit.routeSnapshot) ||
    String(commit.bindingHeadSnapshot.bindingRevision) !==
      String(fence.binding_revision) ||
    String(commit.bindingHeadSnapshot.providerAccessRevision) !==
      String(fence.provider_access_revision)
  ) {
    return { kind: "binding_fence_conflict" };
  }
  if (
    fence.remote_access_state !== "active" ||
    fence.administrative_state !== "enabled" ||
    (fence.runtime_health_state !== "ready" &&
      fence.runtime_health_state !== "degraded")
  ) {
    return { kind: "binding_fence_conflict" };
  }
  if (
    providerOpen !== undefined &&
    !(await providerOpenCapabilitiesRemainAuthorized(transaction, {
      contentPlan: providerOpen.contentPlan,
      route: commit.routeSnapshot,
      attempt: commit.attempt,
      databaseNow: providerOpen.databaseNow,
      bindingRevision: String(fence.binding_revision),
      capabilityRevision: String(fence.capability_revision),
      providerAccessRevision: String(fence.provider_access_revision)
    }))
  ) {
    return { kind: "binding_fence_conflict" };
  }
  if (
    commit.priorAttempt !== null &&
    !(await retryIsSafeForAttempt(transaction, {
      tenantId: commit.tenantId,
      dispatchId: commit.dispatchBefore.id,
      attemptId: commit.priorAttempt.id
    }))
  ) {
    return { kind: "artifact_retry_unsafe" };
  }

  const attemptInsert = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundDispatchAttemptSql(commit.attempt)
  );
  if (attemptInsert.rows.length !== 1) {
    const existingAttempt = await loadAttempt(transaction, commit.attempt);
    if (
      existingAttempt === null ||
      !existingAttemptMatches(existingAttempt, commit.attempt)
    ) {
      return classifyAttemptInsertConflict(existingAttempt, commit.attempt);
    }
  }

  const dispatchUpdate = await transaction.execute<IdRow>(
    buildCompareAndSwapInboxV2OutboundDispatchSql(
      commit.dispatchBefore,
      commit.dispatchAfter
    )
  );
  if (dispatchUpdate.rows.length !== 1) {
    throw invariantError(
      "Dispatch changed after its row lock while opening an attempt."
    );
  }
  return { kind: "committed" };
}

type ProviderOpenCapabilityAuthorityRow = {
  artifact_ordinal: unknown;
};

export function buildValidateInboxV2ProviderOpenContentPlanSql(input: {
  contentPlan: InboxV2OutboundDispatchContentPlan;
  route: InboxV2OutboundRoute;
  attempt: InboxV2OutboundDispatchAttempt;
  databaseNow: string;
  bindingRevision: string;
  capabilityRevision: string;
  providerAccessRevision: string;
}): SQL {
  const plannedRows = input.contentPlan.artifacts.map(
    (artifact) =>
      sql`(${artifact.ordinal}, ${artifact.capabilityId}, ${artifact.operationId})`
  );
  const pinnedRows = input.contentPlan.blocks.flatMap((block) => {
    const pin = block.exactFileObjectPin;
    return pin === null
      ? []
      : [
          sql`(${block.blockKey}, ${pin.file.id}, ${BigInt(pin.fileRevision)}::bigint, ${pin.fileVersion.id}, ${pin.objectVersion.id})`
        ];
  });
  const plannedFilePins =
    pinnedRows.length === 0
      ? sql`select null::text, null::text, null::bigint, null::text,
                   null::text
              where false`
      : sql`values ${sql.join(pinnedRows, sql`, `)}`;
  return sql`
    with planned(artifact_ordinal, capability_id, operation_id) as (
      values ${sql.join(plannedRows, sql`, `)}
    ),
    planned_file_pins(
      block_key, file_id, file_revision, file_version_id, object_version_id
    ) as (
      ${plannedFilePins}
    ),
    current_content_fence(content_plan_id) as materialized (
      select plan_row.id
        from inbox_v2_file_outbound_dispatch_plans plan_row
        join inbox_v2_messages message_row
          on message_row.tenant_id = plan_row.tenant_id
         and message_row.id = plan_row.message_id
         and message_row.revision = plan_row.message_revision
         and message_row.conversation_id = plan_row.conversation_id
         and message_row.timeline_item_id = plan_row.timeline_item_id
         and message_row.content_id = plan_row.content_id
         and message_row.content_revision = plan_row.content_revision
         and message_row.content_state = 'available'
        join inbox_v2_timeline_contents content_row
          on content_row.tenant_id = message_row.tenant_id
         and content_row.id = message_row.content_id
         and content_row.revision = message_row.content_revision
         and content_row.state = 'available'
       where plan_row.tenant_id = ${input.contentPlan.tenantId}
         and plan_row.id = ${input.contentPlan.id}
         and plan_row.dispatch_id = ${input.attempt.dispatch.id}
         and plan_row.message_id = ${input.contentPlan.message.id}
         and plan_row.message_revision =
           ${BigInt(input.contentPlan.messageRevision)}
         and plan_row.route_id = ${input.attempt.route.id}
         and plan_row.content_id = ${input.contentPlan.timelineContent.id}
         and plan_row.content_revision =
           ${BigInt(input.contentPlan.contentRevision)}
         and plan_row.content_fingerprint_purpose_id =
           ${input.contentPlan.contentFingerprint.purposeId}
         and plan_row.content_fingerprint_key_generation =
           ${input.contentPlan.contentFingerprint.keyGeneration}
         and plan_row.content_fingerprint_valid_until =
           ${toDate(input.contentPlan.contentFingerprint.validUntil)}
         and plan_row.content_fingerprint_hmac_sha256 =
           ${input.contentPlan.contentFingerprint.hmacSha256}
         and plan_row.content_fingerprint_valid_until >
           ${toDate(input.attempt.openedAt)}
         and plan_row.content_fingerprint_valid_until >
           ${toDate(input.databaseNow)}
         and plan_row.plan_digest_sha256 = ${input.contentPlan.planDigestSha256}
         and plan_row.revision = ${BigInt(input.contentPlan.revision)}
         and plan_row.created_at = ${toDate(input.contentPlan.createdAt)}
       for share of message_row, content_row
    ),
    valid_file_pins(block_key) as materialized (
      select pin.block_key
        from planned_file_pins pin
        join inbox_v2_file_objects file_row
          on file_row.tenant_id = ${input.contentPlan.tenantId}
         and file_row.id = pin.file_id
         and file_row.revision = pin.file_revision
         and file_row.state = 'ready'
         and file_row.current_file_version_id = pin.file_version_id
         and file_row.current_object_version_id = pin.object_version_id
        join inbox_v2_file_versions file_version_row
          on file_version_row.tenant_id = file_row.tenant_id
         and file_version_row.id = pin.file_version_id
         and file_version_row.file_id = pin.file_id
         and file_version_row.object_version_id = pin.object_version_id
        join inbox_v2_file_object_versions object_version_row
          on object_version_row.tenant_id = file_version_row.tenant_id
         and object_version_row.id = pin.object_version_id
        join inbox_v2_file_object_version_heads object_head_row
          on object_head_row.tenant_id = object_version_row.tenant_id
         and object_head_row.object_version_id = object_version_row.id
         and object_head_row.state = 'ready'
       order by pin.file_id, pin.file_version_id, pin.object_version_id
       for share of file_row, file_version_row, object_version_row,
         object_head_row
    )
    select planned.artifact_ordinal
      from planned
      join inbox_v2_source_thread_binding_capability_entries capability
        on capability.tenant_id = ${input.contentPlan.tenantId}
       and capability.binding_id = ${input.contentPlan.binding.id}
       and capability.capability_revision =
         ${BigInt(input.capabilityRevision)}
       and capability.capability_id = planned.capability_id
       and capability.operation_id = planned.operation_id
       and capability.content_kind_id is not distinct from
         ${input.route.contentKindId}
     where capability.state = 'supported'
       and (
         capability.valid_until is null
         or (
           capability.valid_until > ${toDate(input.attempt.openedAt)}
           and capability.valid_until > ${toDate(input.databaseNow)}
         )
       )
       and not exists (
         select 1
           from inbox_v2_source_thread_binding_capability_required_roles
             required_role
          where required_role.tenant_id = capability.tenant_id
            and required_role.binding_id = capability.binding_id
            and required_role.capability_revision =
              capability.capability_revision
            and required_role.capability_ordinal = capability.ordinal
            and not exists (
              select 1
                from inbox_v2_source_thread_binding_provider_roles provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                   ${BigInt(input.providerAccessRevision)}
                 and provider_role.provider_role_id =
                   required_role.provider_role_id
            )
       )
       and (
         select count(*) from valid_file_pins
       ) = (
         select count(*) from planned_file_pins
       )
       and exists (select 1 from current_content_fence)
     order by planned.artifact_ordinal
     for share of capability
  `;
}

async function providerOpenCapabilitiesRemainAuthorized(
  transaction: RawSqlExecutor,
  input: Parameters<typeof buildValidateInboxV2ProviderOpenContentPlanSql>[0]
): Promise<boolean> {
  const fingerprintValidUntil = Date.parse(
    input.contentPlan.contentFingerprint.validUntil
  );
  if (
    String(input.contentPlan.bindingRevision) !==
      String(input.bindingRevision) ||
    String(input.contentPlan.capabilityRevision) !==
      String(input.capabilityRevision) ||
    !Number.isFinite(fingerprintValidUntil) ||
    fingerprintValidUntil <= Date.parse(input.attempt.openedAt) ||
    fingerprintValidUntil <= Date.parse(input.databaseNow)
  ) {
    return false;
  }
  const result = await transaction.execute<ProviderOpenCapabilityAuthorityRow>(
    buildValidateInboxV2ProviderOpenContentPlanSql(input)
  );
  return (
    result.rows.length === input.contentPlan.artifacts.length &&
    result.rows.every(
      (row, index) =>
        Number(row.artifact_ordinal) ===
        input.contentPlan.artifacts[index]?.ordinal
    )
  );
}

function existingDispatchIsCancellationOf(
  row: ExistingDispatchRow,
  before: InboxV2OutboundDispatch
): boolean {
  return (
    String(row.id) === String(before.id) &&
    String(row.message_id) === String(before.message.id) &&
    String(row.route_id) === String(before.route.id) &&
    nullableString(row.multi_send_operation_id) ===
      nullableString(before.multiSendOperation?.id ?? null) &&
    String(row.state) === "cancelled" &&
    Number(row.attempt_count) === before.attemptCount &&
    row.active_attempt_id === null &&
    row.last_attempt_id === null &&
    row.retry_authorization_decision_id === null &&
    BigInt(String(row.revision)) === BigInt(before.revision) + 1n &&
    sameTimestamp(row.created_at, before.createdAt)
  );
}

type AttemptRow = {
  id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  message_id: unknown;
  attempt_number: unknown;
  claim_token: unknown;
  retry_safety_mechanism: unknown;
  retry_safety_adapter_contract_snapshot: unknown;
  retry_safety_declared_by_trusted_service_id: unknown;
  retry_safety_declaration_token: unknown;
  retry_safety_declared_at: unknown;
  provider_correlation_token: unknown;
  automatic_retry_allowed: unknown;
  lease_expires_at: unknown;
  opened_at: unknown;
  outcome_kind: unknown;
  completion_source: unknown;
  completed_at: unknown;
  retry_at: unknown;
  provider_acknowledgement_token: unknown;
  diagnostic_code_id: unknown;
  diagnostic_retryable: unknown;
  diagnostic_correlation_token: unknown;
  diagnostic_safe_operator_hint_id: unknown;
  unknown_required_action: unknown;
  revision: unknown;
};

export function buildInsertInboxV2OutboundDispatchAttemptSql(
  attempt: InboxV2OutboundDispatchAttempt
): SQL {
  const outcome = attemptOutcomeColumns(attempt);
  return sql`
    insert into inbox_v2_outbound_dispatch_attempts (
      tenant_id, id, dispatch_id, route_id, message_id, attempt_number,
      claim_token, retry_safety_mechanism,
      retry_safety_adapter_contract_snapshot,
      retry_safety_declared_by_trusted_service_id,
      retry_safety_declaration_token, retry_safety_declared_at,
      provider_correlation_token, automatic_retry_allowed,
      lease_expires_at, opened_at, outcome_kind, completion_source,
      completed_at, retry_at, provider_acknowledgement_token,
      diagnostic_code_id, diagnostic_retryable,
      diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
      unknown_required_action, revision
    )
    select
      ${attempt.tenantId}, ${attempt.id}, ${attempt.dispatch.id},
      ${attempt.route.id}, dispatch_row.message_id, ${attempt.attemptNumber},
      ${attempt.claimToken}, ${attempt.retrySafety.mechanism},
      ${toJson(attempt.retrySafety.adapterContract)}::jsonb,
      ${attempt.retrySafety.declaredByTrustedServiceId},
      ${attempt.retrySafety.declarationToken},
      ${toDate(attempt.retrySafety.declaredAt)},
      ${attempt.retrySafety.providerCorrelationToken},
      ${attempt.retrySafety.automaticRetryAllowed},
      ${toDate(attempt.leaseExpiresAt)}, ${toDate(attempt.openedAt)},
      ${attempt.outcome.kind}, ${attempt.completionSource},
      ${outcome.completedAt}, ${outcome.retryAt},
      ${outcome.providerAcknowledgementToken}, ${outcome.diagnosticCodeId},
      ${outcome.diagnosticRetryable}, ${outcome.diagnosticCorrelationToken},
      ${outcome.diagnosticSafeOperatorHintId},
      ${outcome.unknownRequiredAction}, ${BigInt(attempt.revision)}
      from inbox_v2_outbound_dispatches dispatch_row
     where dispatch_row.tenant_id = ${attempt.tenantId}
       and dispatch_row.id = ${attempt.dispatch.id}
       and dispatch_row.route_id = ${attempt.route.id}
    on conflict do nothing
    returning id
  `;
}

async function completeAttemptInTransaction(
  transaction: RawSqlExecutor,
  commit: CompleteAttemptCommit
): Promise<ApplyInboxV2DispatchAttemptResult> {
  const dispatchRow = await lockDispatch(transaction, commit.dispatchBefore);
  if (dispatchRow === null) return { kind: "dispatch_not_found" };
  const attemptRow = await lockAttempt(transaction, commit.attemptBefore);
  if (attemptRow === null) return { kind: "attempt_state_conflict" };

  if (
    !existingDispatchMatches(dispatchRow, commit.dispatchBefore) ||
    !existingAttemptMatches(attemptRow, commit.attemptBefore)
  ) {
    if (
      existingDispatchMatches(dispatchRow, commit.dispatchAfter) &&
      existingAttemptMatches(attemptRow, commit.attemptAfter)
    ) {
      return { kind: "already_applied" };
    }
    return { kind: "dispatch_state_conflict" };
  }

  const attemptUpdate = await transaction.execute<IdRow>(
    buildCompareAndSwapInboxV2OutboundDispatchAttemptSql(
      commit.attemptBefore,
      commit.attemptAfter
    )
  );
  if (attemptUpdate.rows.length !== 1) {
    return { kind: "attempt_state_conflict" };
  }
  const dispatchUpdate = await transaction.execute<IdRow>(
    buildCompareAndSwapInboxV2OutboundDispatchSql(
      commit.dispatchBefore,
      commit.dispatchAfter
    )
  );
  if (dispatchUpdate.rows.length !== 1) {
    throw invariantError(
      "Dispatch changed after its row lock while completing an attempt."
    );
  }
  return { kind: "committed" };
}

async function loadAttempt(
  transaction: RawSqlExecutor,
  attempt: InboxV2OutboundDispatchAttempt
): Promise<AttemptRow | null> {
  const result = await transaction.execute<AttemptRow>(
    buildSelectInboxV2OutboundDispatchAttemptSql(attempt, false)
  );
  return result.rows[0] ?? null;
}

async function lockAttempt(
  transaction: RawSqlExecutor,
  attempt: InboxV2OutboundDispatchAttempt
): Promise<AttemptRow | null> {
  const result = await transaction.execute<AttemptRow>(
    buildSelectInboxV2OutboundDispatchAttemptSql(attempt, true)
  );
  return result.rows[0] ?? null;
}

function buildSelectInboxV2OutboundDispatchAttemptSql(
  attempt: InboxV2OutboundDispatchAttempt,
  forUpdate: boolean
): SQL {
  const lock = forUpdate ? sql`for update` : sql`for share`;
  return sql`
    select id, dispatch_id, route_id, message_id, attempt_number, claim_token,
           retry_safety_mechanism, retry_safety_adapter_contract_snapshot,
           retry_safety_declared_by_trusted_service_id,
           retry_safety_declaration_token, retry_safety_declared_at,
           provider_correlation_token, automatic_retry_allowed,
           lease_expires_at, opened_at, outcome_kind, completion_source,
           completed_at, retry_at, provider_acknowledgement_token,
           diagnostic_code_id, diagnostic_retryable,
           diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
           unknown_required_action, revision
      from inbox_v2_outbound_dispatch_attempts
     where tenant_id = ${attempt.tenantId}
       and id = ${attempt.id}
     ${lock}
  `;
}

export function buildCompareAndSwapInboxV2OutboundDispatchAttemptSql(
  before: InboxV2OutboundDispatchAttempt,
  after: InboxV2OutboundDispatchAttempt
): SQL {
  const outcome = attemptOutcomeColumns(after);
  return sql`
    update inbox_v2_outbound_dispatch_attempts
       set outcome_kind = ${after.outcome.kind},
           completion_source = ${after.completionSource},
           completed_at = ${outcome.completedAt},
           retry_at = ${outcome.retryAt},
           provider_acknowledgement_token =
             ${outcome.providerAcknowledgementToken},
           diagnostic_code_id = ${outcome.diagnosticCodeId},
           diagnostic_retryable = ${outcome.diagnosticRetryable},
           diagnostic_correlation_token =
             ${outcome.diagnosticCorrelationToken},
           diagnostic_safe_operator_hint_id =
             ${outcome.diagnosticSafeOperatorHintId},
           unknown_required_action = ${outcome.unknownRequiredAction},
           revision = ${BigInt(after.revision)}
     where tenant_id = ${before.tenantId}
       and id = ${before.id}
       and dispatch_id = ${before.dispatch.id}
       and route_id = ${before.route.id}
       and outcome_kind = ${before.outcome.kind}
       and revision = ${BigInt(before.revision)}
       and claim_token = ${before.claimToken}
    returning id
  `;
}

export function buildCompareAndSwapInboxV2OutboundDispatchSql(
  before: InboxV2OutboundDispatch,
  after: InboxV2OutboundDispatch
): SQL {
  return sql`
    update inbox_v2_outbound_dispatches
       set state = ${after.state},
           attempt_count = ${after.attemptCount},
           active_attempt_id = ${after.activeAttempt?.id ?? null},
           last_attempt_id = ${after.lastAttempt?.id ?? null},
           retry_authorization_decision_id =
             ${after.retryAuthorization?.id ?? null},
           revision = ${BigInt(after.revision)},
           updated_at = ${toDate(after.updatedAt)}
     where tenant_id = ${before.tenantId}
       and id = ${before.id}
       and message_id = ${before.message.id}
       and route_id = ${before.route.id}
       and state = ${before.state}
       and attempt_count = ${before.attemptCount}
       and active_attempt_id is not distinct from
         ${before.activeAttempt?.id ?? null}
       and last_attempt_id is not distinct from ${before.lastAttempt?.id ?? null}
       and retry_authorization_decision_id is not distinct from
         ${before.retryAuthorization?.id ?? null}
       and revision = ${BigInt(before.revision)}
       and updated_at = ${toDate(before.updatedAt)}
    returning id
  `;
}

function attemptOutcomeColumns(attempt: InboxV2OutboundDispatchAttempt): {
  completedAt: Date | null;
  retryAt: Date | null;
  providerAcknowledgementToken: string | null;
  diagnosticCodeId: string | null;
  diagnosticRetryable: boolean | null;
  diagnosticCorrelationToken: string | null;
  diagnosticSafeOperatorHintId: string | null;
  unknownRequiredAction: string | null;
} {
  const outcome = attempt.outcome;
  if (outcome.kind === "pending") {
    return {
      completedAt: null,
      retryAt: null,
      providerAcknowledgementToken: null,
      diagnosticCodeId: null,
      diagnosticRetryable: null,
      diagnosticCorrelationToken: null,
      diagnosticSafeOperatorHintId: null,
      unknownRequiredAction: null
    };
  }
  const diagnostic = outcome.kind === "accepted" ? null : outcome.diagnostic;
  return {
    completedAt: toDate(outcome.completedAt),
    retryAt:
      outcome.kind === "retryable_failure" ? toDate(outcome.retryAt) : null,
    providerAcknowledgementToken:
      outcome.kind === "accepted" ? outcome.providerAcknowledgementToken : null,
    diagnosticCodeId: diagnostic?.codeId ?? null,
    diagnosticRetryable: diagnostic?.retryable ?? null,
    diagnosticCorrelationToken: diagnostic?.correlationToken ?? null,
    diagnosticSafeOperatorHintId: diagnostic?.safeOperatorHintId ?? null,
    unknownRequiredAction:
      outcome.kind === "outcome_unknown" ? outcome.requiredAction : null
  };
}

function existingAttemptMatches(
  row: AttemptRow,
  attempt: InboxV2OutboundDispatchAttempt
): boolean {
  const outcome = attemptOutcomeColumns(attempt);
  return (
    String(row.id) === String(attempt.id) &&
    String(row.dispatch_id) === String(attempt.dispatch.id) &&
    String(row.route_id) === String(attempt.route.id) &&
    Number(row.attempt_number) === attempt.attemptNumber &&
    String(row.claim_token) === String(attempt.claimToken) &&
    String(row.retry_safety_mechanism) === attempt.retrySafety.mechanism &&
    sameJson(
      row.retry_safety_adapter_contract_snapshot,
      attempt.retrySafety.adapterContract
    ) &&
    String(row.retry_safety_declared_by_trusted_service_id) ===
      String(attempt.retrySafety.declaredByTrustedServiceId) &&
    String(row.retry_safety_declaration_token) ===
      String(attempt.retrySafety.declarationToken) &&
    sameTimestamp(
      row.retry_safety_declared_at,
      attempt.retrySafety.declaredAt
    ) &&
    nullableString(row.provider_correlation_token) ===
      nullableString(attempt.retrySafety.providerCorrelationToken) &&
    Boolean(row.automatic_retry_allowed) ===
      attempt.retrySafety.automaticRetryAllowed &&
    sameTimestamp(row.lease_expires_at, attempt.leaseExpiresAt) &&
    sameTimestamp(row.opened_at, attempt.openedAt) &&
    String(row.outcome_kind) === attempt.outcome.kind &&
    nullableString(row.completion_source) ===
      nullableString(attempt.completionSource) &&
    sameNullableTimestamp(row.completed_at, outcome.completedAt) &&
    sameNullableTimestamp(row.retry_at, outcome.retryAt) &&
    nullableString(row.provider_acknowledgement_token) ===
      nullableString(outcome.providerAcknowledgementToken) &&
    nullableString(row.diagnostic_code_id) ===
      nullableString(outcome.diagnosticCodeId) &&
    nullableBoolean(row.diagnostic_retryable) === outcome.diagnosticRetryable &&
    nullableString(row.diagnostic_correlation_token) ===
      nullableString(outcome.diagnosticCorrelationToken) &&
    nullableString(row.diagnostic_safe_operator_hint_id) ===
      nullableString(outcome.diagnosticSafeOperatorHintId) &&
    nullableString(row.unknown_required_action) ===
      nullableString(outcome.unknownRequiredAction) &&
    BigInt(String(row.revision)) === BigInt(attempt.revision)
  );
}

function classifyAttemptInsertConflict(
  row: AttemptRow | null,
  attempt: InboxV2OutboundDispatchAttempt
): ApplyInboxV2DispatchAttemptResult {
  if (row === null) return { kind: "attempt_number_conflict" };
  if (String(row.id) !== String(attempt.id)) {
    return { kind: "attempt_number_conflict" };
  }
  if (String(row.claim_token) !== String(attempt.claimToken)) {
    return { kind: "claim_token_conflict" };
  }
  return { kind: "attempt_id_conflict" };
}

async function applyRouteFailureInTransaction(
  transaction: RawSqlExecutor,
  commit: InboxV2OutboundDispatchRouteFailureCommit,
  atomicOutbox?: Readonly<{
    fence: InboxV2ProviderIoOutboxLeaseFence;
    lease: ValidatedProviderIoOutboxLease;
  }>
): Promise<ApplyInboxV2DispatchAttemptResult> {
  const dispatchRow = await lockDispatch(transaction, commit.dispatchBefore);
  if (dispatchRow === null) return { kind: "dispatch_not_found" };
  let alreadyApplied = false;
  if (!existingDispatchMatches(dispatchRow, commit.dispatchBefore)) {
    if (!existingDispatchMatches(dispatchRow, commit.dispatchAfter)) {
      return { kind: "dispatch_state_conflict" };
    }
    alreadyApplied = true;
  }
  if (
    !(await lockExactOutboundRouteSnapshot(
      transaction,
      commit.routeSnapshot,
      commit.dispatchBefore.route.id
    ))
  ) {
    return { kind: "route_not_found" };
  }
  const fence = await lockBindingFence(transaction, commit.routeSnapshot);
  if (fence === null) return { kind: "binding_fence_conflict" };

  if (!bindingHeadMatchesRouteFailureEvidence(fence, commit)) {
    return { kind: "binding_fence_conflict" };
  }

  // A structural failure is valid precisely when the immutable route fence is
  // no longer usable. Runtime unavailability is a retry instruction for the
  // outbox, not a dispatch outcome: no attempt exists, so its pinned dispatch
  // head remains unchanged.
  const structurallyUsable =
    bindingAnchorMatchesRoute(fence, commit.routeSnapshot) &&
    bindingFenceMatchesRoute(fence, commit.routeSnapshot) &&
    fence.remote_access_state === "active" &&
    fence.administrative_state === "enabled";
  const runtimeUsable =
    fence.runtime_health_state === "ready" ||
    fence.runtime_health_state === "degraded";
  if (
    (commit.error.code === "route.runtime_unavailable" &&
      (!structurallyUsable || runtimeUsable)) ||
    (commit.error.code !== "route.runtime_unavailable" && structurallyUsable)
  ) {
    return { kind: "binding_fence_conflict" };
  }

  if (commit.error.code === "route.runtime_unavailable") {
    return { kind: "committed" };
  }

  if (!alreadyApplied) {
    const updated = await transaction.execute<IdRow>(
      buildCompareAndSwapInboxV2OutboundDispatchSql(
        commit.dispatchBefore,
        commit.dispatchAfter
      )
    );
    if (updated.rows.length !== 1) {
      return { kind: "dispatch_state_conflict" };
    }
  }
  if (atomicOutbox !== undefined) {
    await finalizeStructuralRouteFailureOutboxInTransaction(
      transaction,
      atomicOutbox,
      commit
    );
  }
  return { kind: alreadyApplied ? "already_applied" : "committed" };
}

async function lockExactOutboundRouteSnapshot(
  transaction: RawSqlExecutor,
  route: InboxV2OutboundRoute,
  dispatchRouteId: InboxV2OutboundDispatch["route"]["id"]
): Promise<boolean> {
  const principalEmployeeId =
    route.principal.kind === "employee" ? route.principal.employee.id : null;
  const principalTrustedServiceId =
    route.principal.kind === "trusted_service"
      ? route.principal.trustedServiceId
      : null;
  const result = await transaction.execute<IdRow>(sql`
    select route_row.id
      from inbox_v2_outbound_routes route_row
     where route_row.tenant_id = ${route.tenantId}
       and route_row.id = ${route.id}
       and route_row.id = ${dispatchRouteId}
       and route_row.principal_kind = ${route.principal.kind}
       and route_row.principal_employee_id is not distinct from
           ${principalEmployeeId}
       and route_row.principal_trusted_service_id is not distinct from
           ${principalTrustedServiceId}
       and route_row.conversation_id = ${route.conversation.id}
       and route_row.external_thread_id = ${route.externalThread.id}
       and route_row.external_thread_revision = 1
       and route_row.source_thread_binding_id = ${route.sourceThreadBinding.id}
       and route_row.source_connection_id = ${route.sourceConnection.id}
       and route_row.source_account_id = ${route.sourceAccount.id}
       and route_row.operation_id = ${route.operationId}
       and route_row.content_kind_id is not distinct from ${route.contentKindId}
       and route_row.authorization_epoch = ${route.authorizationEpoch}
       and route_row.required_conversation_permission_id =
           ${route.requiredConversationPermissionId}
       and route_row.account_generation =
           ${BigInt(route.bindingFence.accountGeneration)}
       and route_row.binding_generation =
           ${BigInt(route.bindingFence.bindingGeneration)}
       and route_row.remote_access_revision =
           ${BigInt(route.bindingFence.remoteAccessRevision)}
       and route_row.administrative_revision =
           ${BigInt(route.bindingFence.administrativeRevision)}
       and route_row.capability_revision =
           ${BigInt(route.bindingFence.capabilityRevision)}
       and route_row.route_descriptor_revision =
           ${BigInt(route.bindingFence.routeDescriptorRevision)}
       and route_row.adapter_contract_id = ${route.adapterContract.contractId}
       and route_row.adapter_contract_version =
           ${route.adapterContract.contractVersion}
       and route_row.adapter_declaration_revision =
           ${BigInt(route.adapterContract.declarationRevision)}
       and route_row.adapter_surface_id = ${route.adapterContract.surfaceId}
       and route_row.adapter_loaded_by_trusted_service_id =
           ${route.adapterContract.loadedByTrustedServiceId}
       and route_row.adapter_loaded_at = ${toDate(route.adapterContract.loadedAt)}
       and route_row.adapter_contract_snapshot =
           ${toJson(route.adapterContract)}::jsonb
       and route_row.route_descriptor_snapshot =
           ${toJson(route.routeDescriptor)}::jsonb
       and route_row.route_descriptor_digest_sha256 =
           ${route.routeDescriptor.descriptorDigestSha256}
       and route_row.route_policy_id = ${route.routePolicy.id}
       and route_row.route_policy_revision = ${BigInt(route.routePolicyRevision)}
       and route_row.conversation_authorization_snapshot =
           ${toJson(route.conversationAuthorization)}::jsonb
       and route_row.source_account_authorization_snapshot =
           ${toJson(route.sourceAccountAuthorization)}::jsonb
       and route_row.reference_context_snapshot =
           ${toJson(route.referenceContext)}::jsonb
       and route_row.runtime_observation_snapshot =
           ${toJson(route.runtimeObservationAtResolution)}::jsonb
       and route_row.selection_intent_kind = ${route.selection.intent.kind}
       and route_row.selection_intent_snapshot =
           ${toJson(route.selection.intent)}::jsonb
       and route_row.selection_reason = ${route.selection.reason}
       and route_row.candidate_snapshot_token =
           ${route.selection.candidateSnapshotToken}
       and route_row.candidate_snapshot_not_after =
           ${toDate(route.selection.candidateSnapshotNotAfter)}
       and route_row.fallback_policy_ordinal is not distinct from
           ${route.selection.fallbackPolicyOrdinal}
       and route_row.selected_at = ${toDate(route.selection.selectedAt)}
       and route_row.mutation_token = ${route.mutationToken}
       and route_row.idempotency_token = ${route.idempotencyToken}
       and route_row.correlation_token = ${route.correlationToken}
       and route_row.revision = ${BigInt(route.revision)}
       and route_row.created_at = ${toDate(route.createdAt)}
     for share of route_row
  `);
  return result.rows.length === 1;
}

async function finalizeStructuralRouteFailureOutboxInTransaction(
  transaction: RawSqlExecutor,
  atomicOutbox: Readonly<{
    fence: InboxV2ProviderIoOutboxLeaseFence;
    lease: ValidatedProviderIoOutboxLease;
  }>,
  commit: InboxV2OutboundDispatchRouteFailureCommit
): Promise<void> {
  const instruction = deriveInboxV2RouteFailureOutboxFinalization({
    intentId: atomicOutbox.fence.intentId,
    commit
  });
  if (instruction.kind !== "dead") {
    throw invariantError(
      "Atomic structural route failure requires a terminal outbox instruction."
    );
  }
  const input = {
    context: atomicOutbox.fence.context,
    intentId: atomicOutbox.fence.intentId,
    workerId: atomicOutbox.fence.workerId,
    leaseToken: atomicOutbox.fence.leaseToken,
    expectedLeaseRevision: atomicOutbox.fence.expectedLeaseRevision,
    instruction
  } satisfies InboxV2FinalizeOutboxInput;
  const tokenHash = calculateInboxV2OutboxLeaseTokenHash(
    atomicOutbox.fence.leaseToken
  );
  const outcomeRevision = inboxV2EntityRevisionSchema.parse(
    (BigInt(atomicOutbox.lease.workRevision) + 1n).toString()
  );
  const inserted = await transaction.execute<Record<string, unknown>>(
    buildInsertInboxV2OutboxOutcomeSql({
      input,
      tokenHash,
      dbNow: atomicOutbox.lease.databaseNow,
      outcomeRevision
    })
  );
  if (inserted.rows.length !== 1) {
    throw invariantError(
      "Atomic route failure did not insert exactly one outbox outcome."
    );
  }
  const finalized = await transaction.execute<Record<string, unknown>>(
    buildFinalizeInboxV2OutboxSql({
      input,
      tokenHash,
      dbNow: atomicOutbox.lease.databaseNow,
      expectedWorkRevision: atomicOutbox.lease.workRevision,
      outcomeRevision
    })
  );
  if (finalized.rows.length !== 1) {
    throw invariantError(
      "Atomic route failure did not finalize exactly one outbox work item."
    );
  }
}

function bindingHeadMatchesRouteFailureEvidence(
  row: BindingFenceRow,
  commit: InboxV2OutboundDispatchRouteFailureCommit
): boolean {
  const head = commit.bindingHeadSnapshot;
  return (
    bindingAnchorMatchesRoute(row, commit.routeSnapshot) &&
    BigInt(String(row.binding_revision)) === BigInt(head.bindingRevision) &&
    BigInt(String(row.account_generation)) ===
      BigInt(head.fence.accountGeneration) &&
    BigInt(String(row.binding_generation)) ===
      BigInt(head.fence.bindingGeneration) &&
    BigInt(String(row.remote_access_revision)) ===
      BigInt(head.remoteAccess.revision) &&
    BigInt(String(row.administrative_revision)) ===
      BigInt(head.administrative.revision) &&
    BigInt(String(row.capability_revision)) ===
      BigInt(head.fence.capabilityRevision) &&
    BigInt(String(row.route_descriptor_revision)) ===
      BigInt(head.fence.routeDescriptorRevision) &&
    BigInt(String(row.runtime_health_revision)) ===
      BigInt(head.runtimeHealth.revision) &&
    String(row.remote_access_state) === head.remoteAccess.state &&
    String(row.administrative_state) === head.administrative.state &&
    String(row.runtime_health_state) === head.runtimeHealth.state &&
    sameTimestamp(row.updated_at, head.updatedAt)
  );
}

async function reconcileInTransaction(
  transaction: RawSqlExecutor,
  commit: InboxV2OutboundDispatchReconciliationCommit
): Promise<ApplyInboxV2ReconciliationResult> {
  const dispatchRow = await lockDispatch(transaction, commit.dispatchBefore);
  if (dispatchRow === null) return { kind: "dispatch_not_found" };

  const attemptRow = await lockAttempt(
    transaction,
    commit.decision.unknownAttempt
  );
  if (attemptRow === null) return { kind: "unknown_attempt_not_found" };

  if (!existingDispatchMatches(dispatchRow, commit.dispatchBefore)) {
    if (existingDispatchMatches(dispatchRow, commit.dispatchAfter)) {
      const existing = await loadReconciliationDecision(
        transaction,
        commit.decision
      );
      return existing !== null &&
        existingReconciliationMatches(existing, commit.decision)
        ? { kind: "already_applied" }
        : { kind: "decision_conflict" };
    }
    return { kind: "dispatch_state_conflict" };
  }
  if (!existingAttemptMatches(attemptRow, commit.decision.unknownAttempt)) {
    return { kind: "unknown_attempt_not_found" };
  }
  if (
    commit.decision.result.state === "retryable_failure" &&
    !(await retryIsSafeForAttempt(transaction, {
      tenantId: commit.tenantId,
      dispatchId: commit.dispatchBefore.id,
      attemptId: commit.decision.unknownAttempt.id
    }))
  ) {
    return { kind: "artifact_retry_unsafe" };
  }

  const permissions = reconciliationPermissions(commit.decision);
  const permissionDigest = digestOrdinalIds(permissions);
  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundDispatchReconciliationDecisionSql(
      commit.decision,
      permissions,
      permissionDigest
    )
  );
  if (inserted.rows.length !== 1) {
    const existing = await loadReconciliationDecision(
      transaction,
      commit.decision
    );
    if (
      existing !== null &&
      existingReconciliationMatches(existing, commit.decision)
    ) {
      return existingDispatchMatches(dispatchRow, commit.dispatchAfter)
        ? { kind: "already_applied" }
        : { kind: "attempt_already_reconciled" };
    }
    return existing === null
      ? { kind: "attempt_already_reconciled" }
      : { kind: "decision_conflict" };
  }
  for (const [ordinal, permissionId] of permissions.entries()) {
    await requireSingleInsert(
      transaction,
      sql`
        insert into inbox_v2_outbound_dispatch_reconciliation_permissions (
          tenant_id, decision_id, ordinal, permission_id
        ) values (
          ${commit.tenantId}, ${commit.decision.id}, ${ordinal},
          ${permissionId}
        )
        returning decision_id as id
      `,
      "Outbound reconciliation permission insert"
    );
  }

  const dispatchUpdate = await transaction.execute<IdRow>(
    buildCompareAndSwapInboxV2OutboundDispatchSql(
      commit.dispatchBefore,
      commit.dispatchAfter
    )
  );
  if (dispatchUpdate.rows.length !== 1) {
    throw invariantError(
      "Dispatch changed after its row lock while reconciling an attempt."
    );
  }
  return { kind: "committed" };
}

type ReconciliationRow = {
  id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  message_id: unknown;
  unknown_attempt_id: unknown;
  result_state: unknown;
  evidence_token: unknown;
  decided_at: unknown;
  revision: unknown;
};

export function buildInsertInboxV2OutboundDispatchReconciliationDecisionSql(
  decision: InboxV2OutboundDispatchReconciliationDecision,
  matchedPermissions = reconciliationPermissions(decision),
  permissionsDigest = digestOrdinalIds(matchedPermissions)
): SQL {
  const result = reconciliationResultColumns(decision);
  const authorization = reconciliationAuthorizationColumns(decision);
  const actorEmployeeId =
    decision.decidedBy.kind === "employee"
      ? decision.decidedBy.employee.id
      : null;
  const actorTrustedServiceId =
    decision.decidedBy.kind === "trusted_service"
      ? decision.decidedBy.trustedServiceId
      : null;
  return sql`
    insert into inbox_v2_outbound_dispatch_reconciliation_decisions (
      tenant_id, id, dispatch_id, route_id, message_id, unknown_attempt_id,
      unknown_attempt_outcome_kind, unknown_attempt_revision,
      decided_by_kind, decided_by_employee_id, decided_by_trusted_service_id,
      authorization_epoch, result_state, provider_acknowledgement_token,
      evidence_token, retry_at, diagnostic_code_id, diagnostic_retryable,
      diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
      retry_authorization_kind, retry_authorization_employee_id,
      duplicate_risk_acknowledged, retry_reason_id, retry_reason,
      operator_authorization_snapshot,
      operator_authorization_decision_token,
      operator_authorization_decision_revision,
      operator_authorization_loaded_by_trusted_service_id,
      operator_authorization_decided_at, operator_authorization_not_after,
      matched_permission_count, matched_permissions_digest_sha256,
      decided_at, revision
    )
    select
      ${decision.tenantId}, ${decision.id}, ${decision.dispatch.id},
      ${decision.route.id}, dispatch_row.message_id,
      ${decision.unknownAttempt.id}, 'outcome_unknown', 2,
      ${decision.decidedBy.kind}, ${actorEmployeeId},
      ${actorTrustedServiceId}, ${decision.authorizationEpoch},
      ${decision.result.state}, ${result.providerAcknowledgementToken},
      ${decision.result.evidenceToken}, ${result.retryAt},
      ${result.diagnosticCodeId}, ${result.diagnosticRetryable},
      ${result.diagnosticCorrelationToken},
      ${result.diagnosticSafeOperatorHintId},
      ${authorization.kind}, ${authorization.employeeId},
      ${authorization.duplicateRiskAcknowledged}, ${authorization.reasonId},
      ${authorization.reason}, ${authorization.operatorSnapshotJson}::jsonb,
      ${authorization.decisionToken}, ${authorization.decisionRevision},
      ${authorization.loadedByTrustedServiceId}, ${authorization.decidedAt},
      ${authorization.notAfter}, ${matchedPermissions.length},
      ${permissionsDigest}, ${toDate(decision.decidedAt)},
      ${BigInt(decision.revision)}
      from inbox_v2_outbound_dispatches dispatch_row
     where dispatch_row.tenant_id = ${decision.tenantId}
       and dispatch_row.id = ${decision.dispatch.id}
       and dispatch_row.route_id = ${decision.route.id}
    on conflict do nothing
    returning id
  `;
}

function reconciliationPermissions(
  decision: InboxV2OutboundDispatchReconciliationDecision
): string[] {
  if (
    decision.result.state !== "retryable_failure" ||
    decision.result.authorization.kind !== "employee_duplicate_risk_override"
  ) {
    return [];
  }
  return [
    ...decision.result.authorization.operatorAuthorization.matchedPermissionIds
  ].map(String);
}

function reconciliationResultColumns(
  decision: InboxV2OutboundDispatchReconciliationDecision
): {
  providerAcknowledgementToken: string | null;
  retryAt: Date | null;
  diagnosticCodeId: string | null;
  diagnosticRetryable: boolean | null;
  diagnosticCorrelationToken: string | null;
  diagnosticSafeOperatorHintId: string | null;
} {
  const result = decision.result;
  if (result.state === "accepted") {
    return {
      providerAcknowledgementToken: result.providerAcknowledgementToken,
      retryAt: null,
      diagnosticCodeId: null,
      diagnosticRetryable: null,
      diagnosticCorrelationToken: null,
      diagnosticSafeOperatorHintId: null
    };
  }
  return {
    providerAcknowledgementToken: null,
    retryAt:
      result.state === "retryable_failure" ? toDate(result.retryAt) : null,
    diagnosticCodeId: result.diagnostic.codeId,
    diagnosticRetryable: result.diagnostic.retryable,
    diagnosticCorrelationToken: result.diagnostic.correlationToken,
    diagnosticSafeOperatorHintId: result.diagnostic.safeOperatorHintId
  };
}

function reconciliationAuthorizationColumns(
  decision: InboxV2OutboundDispatchReconciliationDecision
): {
  kind: "not_applicable" | "automatic" | "employee_duplicate_risk_override";
  employeeId: string | null;
  duplicateRiskAcknowledged: boolean | null;
  reasonId: string | null;
  reason: string | null;
  operatorSnapshotJson: string | null;
  decisionToken: string | null;
  decisionRevision: bigint | null;
  loadedByTrustedServiceId: string | null;
  decidedAt: Date | null;
  notAfter: Date | null;
} {
  if (decision.result.state !== "retryable_failure") {
    return emptyReconciliationAuthorization("not_applicable");
  }
  const authorization = decision.result.authorization;
  if (authorization.kind === "automatic") {
    return emptyReconciliationAuthorization("automatic");
  }
  const operator = authorization.operatorAuthorization;
  return {
    kind: authorization.kind,
    employeeId: String(authorization.employee.id),
    duplicateRiskAcknowledged: authorization.duplicateRiskAcknowledged,
    reasonId: String(authorization.reasonId),
    reason: authorization.reason,
    operatorSnapshotJson: toJson(operator),
    decisionToken: operator.decisionToken,
    decisionRevision: BigInt(operator.decisionRevision),
    loadedByTrustedServiceId: operator.loadedByTrustedServiceId,
    decidedAt: toDate(operator.decidedAt),
    notAfter: toDate(operator.notAfter)
  };
}

function emptyReconciliationAuthorization(
  kind: "not_applicable" | "automatic"
): ReturnType<typeof reconciliationAuthorizationColumns> {
  return {
    kind,
    employeeId: null,
    duplicateRiskAcknowledged: null,
    reasonId: null,
    reason: null,
    operatorSnapshotJson: null,
    decisionToken: null,
    decisionRevision: null,
    loadedByTrustedServiceId: null,
    decidedAt: null,
    notAfter: null
  };
}

async function loadReconciliationDecision(
  transaction: RawSqlExecutor,
  decision: InboxV2OutboundDispatchReconciliationDecision
): Promise<ReconciliationRow | null> {
  const result = await transaction.execute<ReconciliationRow>(sql`
    select id, dispatch_id, route_id, message_id, unknown_attempt_id,
           result_state, evidence_token, decided_at, revision
      from inbox_v2_outbound_dispatch_reconciliation_decisions
     where tenant_id = ${decision.tenantId}
       and (id = ${decision.id} or unknown_attempt_id =
         ${decision.unknownAttempt.id})
     order by case when id = ${decision.id} then 0 else 1 end
     limit 1
     for share
  `);
  return result.rows[0] ?? null;
}

function existingReconciliationMatches(
  row: ReconciliationRow,
  decision: InboxV2OutboundDispatchReconciliationDecision
): boolean {
  return (
    String(row.id) === String(decision.id) &&
    String(row.dispatch_id) === String(decision.dispatch.id) &&
    String(row.route_id) === String(decision.route.id) &&
    String(row.unknown_attempt_id) === String(decision.unknownAttempt.id) &&
    String(row.result_state) === decision.result.state &&
    String(row.evidence_token) === String(decision.result.evidenceToken) &&
    sameTimestamp(row.decided_at, decision.decidedAt) &&
    BigInt(String(row.revision)) === BigInt(decision.revision)
  );
}

async function persistProviderResultArtifactsAndCompletion(
  transaction: RawSqlExecutor,
  commit: CompleteAttemptCommit,
  artifacts: readonly InboxV2OutboundDispatchArtifact[]
): Promise<ApplyInboxV2ProviderResultFencedResult> {
  const existing = await transaction.execute<ArtifactRow>(sql`
    select id, dispatch_id, route_id, attempt_id, message_id, ordinal,
           state, diagnostic_code_id, diagnostic_retryable,
           diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
           created_at, revision
      from inbox_v2_outbound_dispatch_artifacts
     where tenant_id = ${commit.tenantId}
       and dispatch_id = ${commit.dispatchBefore.id}
       and attempt_id = ${commit.attemptBefore.id}
     order by ordinal
     for update
  `);
  const ordered = [...artifacts].sort(
    (left, right) => left.ordinal - right.ordinal
  );
  const hasExactExistingSet =
    existing.rows.length === ordered.length &&
    existing.rows.every((row, index) => {
      const artifact = ordered[index];
      return artifact !== undefined && artifactRowMatches(row, artifact);
    });
  if (existing.rows.length > 0 && !hasExactExistingSet) {
    return { kind: "dispatch_artifact_set_conflict" };
  }

  const completion = await completeAttemptInTransaction(transaction, commit);
  if (
    completion.kind !== "committed" &&
    completion.kind !== "already_applied"
  ) {
    return completion;
  }
  if (completion.kind === "already_applied") {
    return hasExactExistingSet
      ? completion
      : { kind: "dispatch_artifact_set_conflict" };
  }
  if (hasExactExistingSet) return completion;

  for (const artifact of ordered) {
    const result = await appendArtifactInTransaction(transaction, artifact);
    if (result.kind !== "committed" && result.kind !== "already_exists") {
      throw new ProviderResultArtifactRollbackError({
        kind: "dispatch_artifact_set_conflict"
      });
    }
  }
  return completion;
}

async function appendArtifactInTransaction(
  transaction: RawSqlExecutor,
  artifact: InboxV2OutboundDispatchArtifact
): Promise<AppendInboxV2DispatchArtifactResult> {
  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundDispatchArtifactSql(artifact)
  );
  if (inserted.rows.length === 1) return { kind: "committed" };
  const existing = await transaction.execute<ArtifactRow>(sql`
    select id, dispatch_id, route_id, attempt_id, message_id, ordinal,
           state, diagnostic_code_id, diagnostic_retryable,
           diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
           created_at, revision
      from inbox_v2_outbound_dispatch_artifacts
     where tenant_id = ${artifact.tenantId}
       and (
         id = ${artifact.id}
         or (dispatch_id = ${artifact.dispatch.id}
           and attempt_id = ${artifact.attempt.id}
           and ordinal = ${artifact.ordinal})
       )
     order by case when id = ${artifact.id} then 0 else 1 end
     limit 1
     for share
  `);
  const row = existing.rows[0];
  if (!row) return { kind: "attempt_not_found" };
  if (artifactRowMatches(row, artifact)) return { kind: "already_exists" };
  return {
    kind:
      String(row.id) === String(artifact.id)
        ? "artifact_id_conflict"
        : "artifact_ordinal_conflict"
  };
}

type ArtifactRow = {
  id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  message_id: unknown;
  ordinal: unknown;
  state: unknown;
  diagnostic_code_id: unknown;
  diagnostic_retryable: unknown;
  diagnostic_correlation_token: unknown;
  diagnostic_safe_operator_hint_id: unknown;
  created_at: unknown;
  revision: unknown;
};

export function buildInsertInboxV2OutboundDispatchArtifactSql(
  artifact: InboxV2OutboundDispatchArtifact
): SQL {
  const diagnostic = artifact.diagnostic;
  return sql`
    insert into inbox_v2_outbound_dispatch_artifacts (
      tenant_id, id, dispatch_id, route_id, attempt_id, message_id,
      ordinal, state, diagnostic_code_id, diagnostic_retryable,
      diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
      created_at, revision
    )
    select
      ${artifact.tenantId}, ${artifact.id}, ${artifact.dispatch.id},
      ${artifact.route.id}, ${artifact.attempt.id}, attempt_row.message_id,
      ${artifact.ordinal}, ${artifact.state}, ${diagnostic?.codeId ?? null},
      ${diagnostic?.retryable ?? null},
      ${diagnostic?.correlationToken ?? null},
      ${diagnostic?.safeOperatorHintId ?? null},
      ${toDate(artifact.createdAt)}, ${BigInt(artifact.revision)}
      from inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = ${artifact.tenantId}
       and attempt_row.id = ${artifact.attempt.id}
       and attempt_row.dispatch_id = ${artifact.dispatch.id}
       and attempt_row.route_id = ${artifact.route.id}
    on conflict do nothing
    returning id
  `;
}

function artifactRowMatches(
  row: ArtifactRow,
  artifact: InboxV2OutboundDispatchArtifact
): boolean {
  return (
    String(row.id) === String(artifact.id) &&
    String(row.dispatch_id) === String(artifact.dispatch.id) &&
    String(row.route_id) === String(artifact.route.id) &&
    String(row.attempt_id) === String(artifact.attempt.id) &&
    Number(row.ordinal) === artifact.ordinal &&
    String(row.state) === artifact.state &&
    nullableString(row.diagnostic_code_id) ===
      nullableString(artifact.diagnostic?.codeId ?? null) &&
    nullableBoolean(row.diagnostic_retryable) ===
      (artifact.diagnostic?.retryable ?? null) &&
    nullableString(row.diagnostic_correlation_token) ===
      nullableString(artifact.diagnostic?.correlationToken ?? null) &&
    nullableString(row.diagnostic_safe_operator_hint_id) ===
      nullableString(artifact.diagnostic?.safeOperatorHintId ?? null) &&
    sameTimestamp(row.created_at, artifact.createdAt) &&
    BigInt(String(row.revision)) === BigInt(artifact.revision)
  );
}

async function associateArtifactInTransaction(
  transaction: RawSqlExecutor,
  commit: InboxV2OutboundDispatchArtifactAssociationCommit
): Promise<AssociateInboxV2DispatchArtifactResult> {
  const artifactResult = await transaction.execute<ArtifactRow>(sql`
    select id, dispatch_id, route_id, attempt_id, message_id, ordinal,
           state, diagnostic_code_id, diagnostic_retryable,
           diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
           created_at, revision
      from inbox_v2_outbound_dispatch_artifacts
     where tenant_id = ${commit.artifact.tenantId}
       and id = ${commit.artifact.id}
     for share
  `);
  const artifactRow = artifactResult.rows[0];
  if (!artifactRow) return { kind: "artifact_not_found" };
  if (!artifactRowMatches(artifactRow, commit.artifact)) {
    return { kind: "artifact_chain_conflict" };
  }

  const resolution = commit.occurrenceResolution;
  if (
    resolution.after.resolution.state !== "resolved" ||
    resolution.resolvedReference === null
  ) {
    throw unsupported(
      "Artifact association requires a resolved occurrence and exact external reference."
    );
  }
  const externalReference = resolution.resolvedReference;
  const keyDigest = computeInboxV2ExternalMessageKeyDigest(
    externalReference.key
  );

  const occurrenceRow = await lockOccurrenceResolution(transaction, resolution);
  if (occurrenceRow === null) return { kind: "occurrence_not_found" };
  const occurrenceAlreadyResolved = occurrenceResolutionRowMatchesAfter(
    occurrenceRow,
    resolution
  );
  if (
    !occurrenceAlreadyResolved &&
    !occurrenceResolutionRowMatchesBefore(occurrenceRow, resolution)
  ) {
    return { kind: "occurrence_revision_conflict" };
  }

  const referenceInsert = await transaction.execute<IdRow>(
    buildInsertInboxV2ExternalMessageReferenceSql(externalReference, keyDigest)
  );
  if (referenceInsert.rows.length === 0) {
    const existingReference = await loadExternalMessageReference(transaction, {
      tenantId: externalReference.tenantId,
      referenceId: externalReference.id,
      keyDigest
    });
    if (
      existingReference === null ||
      !externalMessageReferenceRowMatches(
        existingReference,
        externalReference,
        keyDigest
      )
    ) {
      return { kind: "external_reference_conflict" };
    }
  }

  if (occurrenceAlreadyResolved) {
    const link = await loadArtifactReferenceLink(transaction, commit);
    const result: AssociateInboxV2DispatchArtifactResult =
      link !== null && artifactReferenceLinkMatches(link, commit)
        ? { kind: "already_exists" }
        : { kind: "association_conflict" };
    if (referenceInsert.rows.length === 1 && result.kind !== "already_exists") {
      throw new ArtifactAssociationRollbackError(result);
    }
    return result;
  }

  const transitionId =
    deriveInboxV2SourceOccurrenceResolutionTransitionId(resolution);
  const candidates = resolutionCandidates(resolution);
  const candidateDigest = digestOrdinalIds(candidates);
  await requireSingleInsert(
    transaction,
    buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
      resolution,
      transitionId,
      candidates,
      candidateDigest
    ),
    "SourceOccurrence resolution transition insert"
  );
  for (const [ordinal, referenceId] of candidates.entries()) {
    await requireSingleInsert(
      transaction,
      sql`
        insert into inbox_v2_source_occurrence_resolution_candidates (
          tenant_id, transition_id, source_occurrence_id,
          resulting_revision, ordinal, external_message_reference_id
        ) values (
          ${resolution.tenantId}, ${transitionId}, ${resolution.after.id},
          ${BigInt(resolution.resultingRevision)}, ${ordinal}, ${referenceId}
        )
        returning transition_id as id
      `,
      "SourceOccurrence resolution candidate insert"
    );
  }
  const occurrenceUpdate = await transaction.execute<IdRow>(
    buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(resolution)
  );
  if (occurrenceUpdate.rows.length !== 1) {
    throw invariantError(
      "SourceOccurrence changed after its row lock during resolution."
    );
  }

  const linkInsert = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql(commit)
  );
  if (linkInsert.rows.length !== 1) {
    const link = await loadArtifactReferenceLink(transaction, commit);
    const result: AssociateInboxV2DispatchArtifactResult =
      link !== null && artifactReferenceLinkMatches(link, commit)
        ? { kind: "already_exists" }
        : { kind: "association_conflict" };
    throw new ArtifactAssociationRollbackError(result);
  }
  return { kind: "committed" };
}

type ExternalMessageReference = InboxV2ExternalMessageReference;
type ExternalMessageReferenceRow = {
  tenant_id: unknown;
  id: unknown;
  realm_id: unknown;
  realm_version: unknown;
  canonicalization_version: unknown;
  scope_kind: unknown;
  scope_source_account_id: unknown;
  scope_source_thread_binding_id: unknown;
  object_kind_id: unknown;
  canonical_external_subject: unknown;
  message_key_digest_sha256: unknown;
  identity_declaration: unknown;
  external_thread_id: unknown;
  conversation_id: unknown;
  timeline_item_id: unknown;
  message_id: unknown;
  revision: unknown;
  created_at: unknown;
};

export function buildInsertInboxV2ExternalMessageReferenceSql(
  reference: ExternalMessageReference,
  keyDigest = computeInboxV2ExternalMessageKeyDigest(reference.key)
): SQL {
  const scope = externalMessageScopeColumns(reference.key.scope);
  return sql`
    insert into inbox_v2_external_message_references (
      tenant_id, id, realm_id, realm_version, canonicalization_version,
      scope_kind, scope_source_account_id, scope_source_thread_binding_id,
      object_kind_id, canonical_external_subject, message_key_digest_sha256,
      identity_declaration, external_thread_id, external_thread_revision,
      conversation_id, timeline_item_id, message_id, revision, created_at
    )
    select
      ${reference.tenantId}, ${reference.id}, ${reference.key.realm.realmId},
      ${reference.key.realm.realmVersion},
      ${reference.key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${reference.key.objectKindId},
      ${reference.key.canonicalExternalSubject}, ${keyDigest},
      ${toJson(reference.identityDeclaration)}::jsonb,
      ${reference.key.externalThread.id}, 1, message_row.conversation_id,
      ${reference.timelineItem.id}, ${reference.message.id},
      ${BigInt(reference.revision)}, ${toDate(reference.createdAt)}
      from inbox_v2_messages message_row
     where message_row.tenant_id = ${reference.tenantId}
       and message_row.id = ${reference.message.id}
       and message_row.timeline_item_id = ${reference.timelineItem.id}
    on conflict do nothing
    returning id
  `;
}

/**
 * Post-stream-head variant for a Message that was inserted earlier in the same
 * transaction. The caller already owns the exact Conversation lock and supplies
 * the commit-bound Conversation ID, so this statement has no read/lock tail.
 */
export function buildInsertInboxV2ExternalMessageReferenceValuesSql(input: {
  reference: ExternalMessageReference;
  conversationId: string;
  keyDigest?: string;
}): SQL {
  const { reference } = input;
  const scope = externalMessageScopeColumns(reference.key.scope);
  const keyDigest =
    input.keyDigest ?? computeInboxV2ExternalMessageKeyDigest(reference.key);
  return sql`
    insert into inbox_v2_external_message_references (
      tenant_id, id, realm_id, realm_version, canonicalization_version,
      scope_kind, scope_source_account_id, scope_source_thread_binding_id,
      object_kind_id, canonical_external_subject, message_key_digest_sha256,
      identity_declaration, external_thread_id, external_thread_revision,
      conversation_id, timeline_item_id, message_id, revision, created_at
    ) values (
      ${reference.tenantId}, ${reference.id}, ${reference.key.realm.realmId},
      ${reference.key.realm.realmVersion},
      ${reference.key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${reference.key.objectKindId},
      ${reference.key.canonicalExternalSubject}, ${keyDigest},
      ${toJson(reference.identityDeclaration)}::jsonb,
      ${reference.key.externalThread.id}, 1, ${input.conversationId},
      ${reference.timelineItem.id}, ${reference.message.id},
      ${BigInt(reference.revision)}, ${toDate(reference.createdAt)}
    )
    on conflict do nothing
    returning id
  `;
}

function externalMessageScopeColumns(
  scope: ExternalMessageReference["key"]["scope"]
): {
  kind: string;
  sourceAccountId: string | null;
  sourceThreadBindingId: string | null;
} {
  if (scope.kind === "provider_thread") {
    return {
      kind: scope.kind,
      sourceAccountId: null,
      sourceThreadBindingId: null
    };
  }
  if (scope.kind === "source_account") {
    return {
      kind: scope.kind,
      sourceAccountId: String(scope.owner.id),
      sourceThreadBindingId: null
    };
  }
  return {
    kind: scope.kind,
    sourceAccountId: null,
    sourceThreadBindingId: String(scope.owner.id)
  };
}

async function loadExternalMessageReference(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    referenceId: InboxV2ExternalMessageReferenceId;
    keyDigest: string | null;
  }>
): Promise<ExternalMessageReferenceRow | null> {
  const statement =
    input.keyDigest === null
      ? buildFindInboxV2ExternalMessageReferenceSql(input)
      : buildLoadInboxV2ExternalMessageReferenceForAssociationSql({
          tenantId: input.tenantId,
          referenceId: input.referenceId,
          keyDigest: input.keyDigest
        });
  const result =
    await transaction.execute<ExternalMessageReferenceRow>(statement);
  assertAtMostOneRow(result.rows, "External message reference lookup");
  return result.rows[0] ?? null;
}

export function buildFindInboxV2ExternalMessageReferenceSql(input: {
  tenantId: InboxV2TenantId;
  referenceId: InboxV2ExternalMessageReferenceId;
}): SQL {
  return sql`
    ${externalMessageReferenceReadSelectSql()}
     where reference_row.tenant_id = ${input.tenantId}
       and reference_row.id = ${input.referenceId}
     limit 1
  `;
}

function buildLoadInboxV2ExternalMessageReferenceForAssociationSql(input: {
  tenantId: InboxV2TenantId;
  referenceId: InboxV2ExternalMessageReferenceId;
  keyDigest: string;
}): SQL {
  return sql`
    ${externalMessageReferenceReadSelectSql()}
     where reference_row.tenant_id = ${input.tenantId}
       and (
         reference_row.id = ${input.referenceId}
         or reference_row.message_key_digest_sha256 = ${input.keyDigest}
       )
     order by case when reference_row.id = ${input.referenceId} then 0 else 1 end
     limit 1
     for share
  `;
}

export function buildFindInboxV2ExternalMessageReferenceCandidatesSql(input: {
  tenantId: InboxV2TenantId;
  referenceId: InboxV2ExternalMessageReferenceId;
  keyDigest: string;
}): SQL {
  return sql`
    ${externalMessageReferenceReadSelectSql()}
     where reference_row.tenant_id = ${input.tenantId}
       and (
         reference_row.id = ${input.referenceId}
         or reference_row.message_key_digest_sha256 = ${input.keyDigest}
       )
     order by reference_row.id asc
     limit 2
     for share
  `;
}

/**
 * Loads the at-most-two rows capable of conflicting with one reconciliation
 * candidate: its caller-selected ID and its server-computed exact-key digest.
 * The caller must still compare every key field; a digest is an index, never
 * equality proof.
 */
export async function findInboxV2ExternalMessageReferenceCandidatesInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: InboxV2TenantId;
    referenceId: InboxV2ExternalMessageReferenceId;
    keyDigest: string;
  }>
): Promise<readonly InboxV2ExternalMessageReference[]> {
  const result = await transaction.execute<ExternalMessageReferenceRow>(
    buildFindInboxV2ExternalMessageReferenceCandidatesSql(input)
  );
  if (result.rows.length > 2) {
    throw invariantError(
      "External message reference reconciliation lookup exceeded its bounded ID/digest candidates."
    );
  }
  return result.rows.map((row) =>
    mapExternalMessageReferenceRow(row, input.tenantId)
  );
}

function externalMessageReferenceReadSelectSql(): SQL {
  return sql`
    select reference_row.tenant_id, reference_row.id,
           reference_row.realm_id, reference_row.realm_version,
           reference_row.canonicalization_version, reference_row.scope_kind,
           reference_row.scope_source_account_id,
           reference_row.scope_source_thread_binding_id,
           reference_row.object_kind_id,
           reference_row.canonical_external_subject,
           reference_row.message_key_digest_sha256,
           reference_row.identity_declaration,
           reference_row.external_thread_id, reference_row.conversation_id,
           reference_row.timeline_item_id, reference_row.message_id,
           reference_row.revision, reference_row.created_at
      from inbox_v2_external_message_references reference_row
  `;
}

function mapExternalMessageReferenceRow(
  row: ExternalMessageReferenceRow,
  expectedTenantId: InboxV2TenantId
): InboxV2ExternalMessageReference {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("External message reference tenant mismatch.");
  }
  const reference = <const TKind extends string>(kind: TKind, id: unknown) => ({
    tenantId,
    kind,
    id: String(id)
  });
  const externalThread = reference("external_thread", row.external_thread_id);
  const scope = mapExternalMessageReferenceScope(row, reference);
  const mapped = inboxV2ExternalMessageReferenceSchema.parse({
    tenantId,
    id: String(row.id),
    key: {
      realm: {
        realmId: String(row.realm_id),
        realmVersion: String(row.realm_version),
        canonicalizationVersion: String(row.canonicalization_version)
      },
      scope,
      objectKindId: String(row.object_kind_id),
      externalThread,
      canonicalExternalSubject: String(row.canonical_external_subject)
    },
    identityDeclaration: row.identity_declaration,
    externalThread,
    timelineItem: reference("timeline_item", row.timeline_item_id),
    message: reference("message", row.message_id),
    revision: parsePositiveDatabaseBigint(
      row.revision,
      "External message reference revision"
    ),
    createdAt: parseDatabaseTimestamp(
      row.created_at,
      "External message reference createdAt"
    )
  });
  if (
    String(row.message_key_digest_sha256) !==
    computeInboxV2ExternalMessageKeyDigest(mapped.key)
  ) {
    throw invariantError("External message reference key digest mismatch.");
  }
  return mapped;
}

function mapExternalMessageReferenceScope(
  row: ExternalMessageReferenceRow,
  reference: <const TKind extends string>(
    kind: TKind,
    id: unknown
  ) => Readonly<{ tenantId: InboxV2TenantId; kind: TKind; id: string }>
): Record<string, unknown> {
  switch (row.scope_kind) {
    case "provider_thread":
      return { kind: "provider_thread" };
    case "source_account":
      return {
        kind: "source_account",
        owner: reference("source_account", row.scope_source_account_id)
      };
    case "source_thread_binding":
      return {
        kind: "source_thread_binding",
        owner: reference(
          "source_thread_binding",
          row.scope_source_thread_binding_id
        )
      };
    default:
      throw invariantError("External message reference scope is unknown.");
  }
}

function externalMessageReferenceRowMatches(
  row: ExternalMessageReferenceRow,
  reference: ExternalMessageReference,
  keyDigest: string
): boolean {
  const scope = externalMessageScopeColumns(reference.key.scope);
  return (
    String(row.tenant_id) === String(reference.tenantId) &&
    String(row.id) === String(reference.id) &&
    String(row.realm_id) === String(reference.key.realm.realmId) &&
    String(row.realm_version) === String(reference.key.realm.realmVersion) &&
    String(row.canonicalization_version) ===
      String(reference.key.realm.canonicalizationVersion) &&
    String(row.scope_kind) === scope.kind &&
    nullableString(row.scope_source_account_id) === scope.sourceAccountId &&
    nullableString(row.scope_source_thread_binding_id) ===
      scope.sourceThreadBindingId &&
    String(row.object_kind_id) === String(reference.key.objectKindId) &&
    String(row.canonical_external_subject) ===
      reference.key.canonicalExternalSubject &&
    String(row.message_key_digest_sha256) === keyDigest &&
    sameJson(row.identity_declaration, reference.identityDeclaration) &&
    String(row.external_thread_id) ===
      String(reference.key.externalThread.id) &&
    String(row.timeline_item_id) === String(reference.timelineItem.id) &&
    String(row.message_id) === String(reference.message.id) &&
    BigInt(String(row.revision)) === BigInt(reference.revision) &&
    sameTimestamp(row.created_at, reference.createdAt)
  );
}

type OccurrenceResolutionRow = {
  id: unknown;
  resolution_state: unknown;
  resolved_external_message_reference_id: unknown;
  resolution_candidate_count: unknown;
  resolution_candidate_digest_sha256: unknown;
  resolution_diagnostic_code_id: unknown;
  resolution_diagnostic_retryable: unknown;
  resolution_diagnostic_correlation_token: unknown;
  resolution_diagnostic_safe_operator_hint_id: unknown;
  revision: unknown;
  updated_at: unknown;
};

async function lockOccurrenceResolution(
  transaction: RawSqlExecutor,
  commit: InboxV2SourceOccurrenceResolutionCommit
): Promise<OccurrenceResolutionRow | null> {
  const result = await transaction.execute<OccurrenceResolutionRow>(sql`
    select id, resolution_state, resolved_external_message_reference_id,
           resolution_candidate_count, resolution_candidate_digest_sha256,
           resolution_diagnostic_code_id, resolution_diagnostic_retryable,
           resolution_diagnostic_correlation_token,
           resolution_diagnostic_safe_operator_hint_id, revision, updated_at
      from inbox_v2_source_occurrences
     where tenant_id = ${commit.tenantId}
       and id = ${commit.before.id}
     for update
  `);
  return result.rows[0] ?? null;
}

function occurrenceResolutionRowMatchesBefore(
  row: OccurrenceResolutionRow,
  commit: InboxV2SourceOccurrenceResolutionCommit
): boolean {
  return occurrenceResolutionRowMatches(row, commit.before);
}

function occurrenceResolutionRowMatchesAfter(
  row: OccurrenceResolutionRow,
  commit: InboxV2SourceOccurrenceResolutionCommit
): boolean {
  return occurrenceResolutionRowMatches(row, commit.after);
}

function occurrenceResolutionRowMatches(
  row: OccurrenceResolutionRow,
  occurrence: InboxV2SourceOccurrenceResolutionCommit["before"]
): boolean {
  const columns = occurrenceResolutionColumns(occurrence.resolution);
  return (
    String(row.id) === String(occurrence.id) &&
    String(row.resolution_state) === occurrence.resolution.state &&
    nullableString(row.resolved_external_message_reference_id) ===
      nullableString(columns.resolvedReferenceId) &&
    Number(row.resolution_candidate_count) === columns.candidateIds.length &&
    nullableString(row.resolution_candidate_digest_sha256) ===
      digestOrdinalIds(columns.candidateIds) &&
    nullableString(row.resolution_diagnostic_code_id) ===
      nullableString(columns.diagnosticCodeId) &&
    nullableBoolean(row.resolution_diagnostic_retryable) ===
      columns.diagnosticRetryable &&
    nullableString(row.resolution_diagnostic_correlation_token) ===
      nullableString(columns.diagnosticCorrelationToken) &&
    nullableString(row.resolution_diagnostic_safe_operator_hint_id) ===
      nullableString(columns.diagnosticSafeOperatorHintId) &&
    BigInt(String(row.revision)) === BigInt(occurrence.revision) &&
    sameTimestamp(row.updated_at, occurrence.updatedAt)
  );
}

function occurrenceResolutionColumns(
  resolution: InboxV2SourceOccurrenceResolutionCommit["after"]["resolution"]
): {
  resolvedReferenceId: string | null;
  candidateIds: string[];
  diagnosticCodeId: string | null;
  diagnosticRetryable: boolean | null;
  diagnosticCorrelationToken: string | null;
  diagnosticSafeOperatorHintId: string | null;
} {
  if (resolution.state === "resolved") {
    return {
      resolvedReferenceId: String(resolution.externalMessageReference.id),
      candidateIds: [],
      diagnosticCodeId: null,
      diagnosticRetryable: null,
      diagnosticCorrelationToken: null,
      diagnosticSafeOperatorHintId: null
    };
  }
  const diagnostic = resolution.diagnostic;
  return {
    resolvedReferenceId: null,
    candidateIds:
      resolution.state === "conflicted"
        ? resolution.candidateExternalMessageReferences.map((item) =>
            String(item.id)
          )
        : [],
    diagnosticCodeId: diagnostic.codeId,
    diagnosticRetryable: diagnostic.retryable,
    diagnosticCorrelationToken: diagnostic.correlationToken,
    diagnosticSafeOperatorHintId: diagnostic.safeOperatorHintId
  };
}

function resolutionCandidates(
  commit: InboxV2SourceOccurrenceResolutionCommit
): string[] {
  return occurrenceResolutionColumns(commit.after.resolution).candidateIds;
}

export function buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(
  commit: InboxV2SourceOccurrenceResolutionCommit,
  transitionId = deriveInboxV2SourceOccurrenceResolutionTransitionId(commit),
  candidates = resolutionCandidates(commit),
  candidateDigest = digestOrdinalIds(candidates)
): SQL {
  const after = occurrenceResolutionColumns(commit.after.resolution);
  return sql`
    insert into inbox_v2_source_occurrence_resolution_transitions (
      tenant_id, id, source_occurrence_id, expected_revision,
      resulting_revision, from_state, to_state,
      resolved_external_message_reference_id, candidate_count,
      candidates_digest_sha256, diagnostic_code_id, diagnostic_retryable,
      diagnostic_correlation_token, diagnostic_safe_operator_hint_id,
      resolver_trusted_service_id, resolution_token, changed_at, revision
    ) values (
      ${commit.tenantId}, ${transitionId}, ${commit.before.id},
      ${BigInt(commit.expectedRevision)}, ${BigInt(commit.resultingRevision)},
      ${commit.before.resolution.state}, ${commit.after.resolution.state},
      ${after.resolvedReferenceId}, ${candidates.length}, ${candidateDigest},
      ${after.diagnosticCodeId}, ${after.diagnosticRetryable},
      ${after.diagnosticCorrelationToken},
      ${after.diagnosticSafeOperatorHintId},
      ${commit.resolver.trustedServiceId}, ${commit.resolver.resolutionToken},
      ${toDate(commit.changedAt)}, 1
    )
    returning id
  `;
}

export function buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(
  commit: InboxV2SourceOccurrenceResolutionCommit
): SQL {
  const after = occurrenceResolutionColumns(commit.after.resolution);
  const candidateDigest = digestOrdinalIds(after.candidateIds);
  return sql`
    update inbox_v2_source_occurrences
       set resolution_state = ${commit.after.resolution.state},
           resolved_external_message_reference_id =
             ${after.resolvedReferenceId},
           resolution_candidate_count = ${after.candidateIds.length},
           resolution_candidate_digest_sha256 = ${candidateDigest},
           resolution_diagnostic_code_id = ${after.diagnosticCodeId},
           resolution_diagnostic_retryable = ${after.diagnosticRetryable},
           resolution_diagnostic_correlation_token =
             ${after.diagnosticCorrelationToken},
           resolution_diagnostic_safe_operator_hint_id =
             ${after.diagnosticSafeOperatorHintId},
           revision = ${BigInt(commit.resultingRevision)},
           updated_at = ${toDate(commit.changedAt)}
     where tenant_id = ${commit.tenantId}
       and id = ${commit.before.id}
       and resolution_state = ${commit.before.resolution.state}
       and revision = ${BigInt(commit.expectedRevision)}
       and updated_at = ${toDate(commit.before.updatedAt)}
    returning id
  `;
}

type ArtifactReferenceLinkRow = {
  id: unknown;
  artifact_id: unknown;
  dispatch_id: unknown;
  route_id: unknown;
  attempt_id: unknown;
  message_id: unknown;
  external_thread_id: unknown;
  external_message_reference_id: unknown;
  source_occurrence_id: unknown;
  source_occurrence_revision: unknown;
  evidence_kind: unknown;
  provider_reference_kind_id: unknown;
  correlation_token: unknown;
  linked_by_trusted_service_id: unknown;
  linked_at: unknown;
  revision: unknown;
};

export function buildInsertInboxV2OutboundDispatchArtifactReferenceLinkSql(
  commit: InboxV2OutboundDispatchArtifactAssociationCommit
): SQL {
  const link = commit.link;
  const evidence = link.associationEvidence;
  return sql`
    insert into inbox_v2_outbound_dispatch_artifact_reference_links (
      tenant_id, id, artifact_id, dispatch_id, route_id, attempt_id,
      message_id, external_thread_id, external_message_reference_id,
      source_occurrence_id, source_occurrence_revision,
      source_occurrence_resolution_state, evidence_kind,
      provider_reference_kind_id, correlation_token,
      linked_by_trusted_service_id, linked_at, revision
    )
    select
      ${link.tenantId}, ${link.id}, ${link.artifact.id}, ${link.dispatch.id},
      ${link.route.id}, ${link.attempt.id}, artifact_row.message_id,
      ${link.externalThread.id}, ${link.externalMessageReference.id},
      ${link.sourceOccurrence.id},
      ${BigInt(commit.occurrenceResolution.after.revision)}, 'resolved',
      ${evidence.kind},
      ${
        evidence.kind === "provider_echo_correlation"
          ? evidence.providerReferenceKindId
          : null
      },
      ${
        evidence.kind === "provider_echo_correlation"
          ? evidence.correlationToken
          : null
      },
      ${link.linkedByTrustedServiceId}, ${toDate(link.linkedAt)},
      ${BigInt(link.revision)}
      from inbox_v2_outbound_dispatch_artifacts artifact_row
     where artifact_row.tenant_id = ${link.tenantId}
       and artifact_row.id = ${link.artifact.id}
       and artifact_row.dispatch_id = ${link.dispatch.id}
       and artifact_row.route_id = ${link.route.id}
       and artifact_row.attempt_id = ${link.attempt.id}
    on conflict do nothing
    returning id
  `;
}

async function loadArtifactReferenceLink(
  transaction: RawSqlExecutor,
  commit: InboxV2OutboundDispatchArtifactAssociationCommit
): Promise<ArtifactReferenceLinkRow | null> {
  const link = commit.link;
  const result = await transaction.execute<ArtifactReferenceLinkRow>(sql`
    select id, artifact_id, dispatch_id, route_id, attempt_id, message_id,
           external_thread_id, external_message_reference_id,
           source_occurrence_id, source_occurrence_revision, evidence_kind,
           provider_reference_kind_id, correlation_token,
           linked_by_trusted_service_id, linked_at, revision
      from inbox_v2_outbound_dispatch_artifact_reference_links
     where tenant_id = ${link.tenantId}
       and (id = ${link.id} or artifact_id = ${link.artifact.id})
     order by case when id = ${link.id} then 0 else 1 end
     limit 1
     for share
  `);
  return result.rows[0] ?? null;
}

function artifactReferenceLinkMatches(
  row: ArtifactReferenceLinkRow,
  commit: InboxV2OutboundDispatchArtifactAssociationCommit
): boolean {
  const link = commit.link;
  const evidence = link.associationEvidence;
  return (
    String(row.id) === String(link.id) &&
    String(row.artifact_id) === String(link.artifact.id) &&
    String(row.dispatch_id) === String(link.dispatch.id) &&
    String(row.route_id) === String(link.route.id) &&
    String(row.attempt_id) === String(link.attempt.id) &&
    String(row.external_thread_id) === String(link.externalThread.id) &&
    String(row.external_message_reference_id) ===
      String(link.externalMessageReference.id) &&
    String(row.source_occurrence_id) === String(link.sourceOccurrence.id) &&
    BigInt(String(row.source_occurrence_revision)) ===
      BigInt(commit.occurrenceResolution.after.revision) &&
    String(row.evidence_kind) === evidence.kind &&
    nullableString(row.provider_reference_kind_id) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.providerReferenceKindId)
        : null) &&
    nullableString(row.correlation_token) ===
      (evidence.kind === "provider_echo_correlation"
        ? String(evidence.correlationToken)
        : null) &&
    String(row.linked_by_trusted_service_id) ===
      String(link.linkedByTrustedServiceId) &&
    sameTimestamp(row.linked_at, link.linkedAt) &&
    BigInt(String(row.revision)) === BigInt(link.revision)
  );
}

class MultiSendRollbackError extends Error {
  constructor(readonly result: CreateInboxV2MultiSendResult) {
    super(`Rollback multi-send: ${result.kind}`);
    this.name = "MultiSendRollbackError";
  }
}

async function createMultiSendInTransaction(
  transaction: RawSqlExecutor,
  operation: InboxV2OutboundMultiSendOperation,
  dispatches: readonly InboxV2OutboundDispatch[]
): Promise<CreateInboxV2MultiSendResult> {
  const dispatchById = new Map(
    dispatches.map((dispatch) => [String(dispatch.id), dispatch] as const)
  );
  if (
    dispatchById.size !== operation.children.length ||
    dispatches.length !== operation.children.length ||
    operation.children.some((child) => {
      const dispatch = dispatchById.get(String(child.dispatch.id));
      return (
        dispatch === undefined ||
        dispatch.multiSendOperation?.id !== operation.id ||
        String(dispatch.route.id) !== String(child.route.id) ||
        dispatch.state !== "queued"
      );
    })
  ) {
    return { kind: "dispatch_set_conflict" };
  }

  const operationDigest = digestMultiSendChildren(operation);
  const inserted = await transaction.execute<IdRow>(
    buildInsertInboxV2OutboundMultiSendOperationSql(operation, operationDigest)
  );
  if (inserted.rows.length === 0) {
    const existing = await loadMultiSendOperation(transaction, operation);
    if (
      !existing ||
      !multiSendOperationMatches(existing, operation, operationDigest)
    ) {
      return existing && String(existing.id) !== String(operation.id)
        ? { kind: "operation_token_conflict" }
        : { kind: "operation_id_conflict" };
    }
    const existingChildren = await transaction.execute<{ count: unknown }>(sql`
      select count(*)::int as count
        from inbox_v2_outbound_multi_send_children
       where tenant_id = ${operation.tenantId}
         and operation_id = ${operation.id}
    `);
    return Number(existingChildren.rows[0]?.count ?? 0) ===
      operation.children.length
      ? { kind: "already_exists" }
      : { kind: "dispatch_set_conflict" };
  }

  for (const child of operation.children) {
    const dispatch = dispatchById.get(String(child.dispatch.id));
    if (!dispatch) {
      throw new MultiSendRollbackError({ kind: "dispatch_set_conflict" });
    }
    const result = await createDispatchInTransaction(
      transaction,
      dispatch,
      String(operation.id)
    );
    if (result.kind !== "committed" && result.kind !== "already_exists") {
      const mapped: CreateInboxV2MultiSendResult =
        result.kind === "route_not_found"
          ? { kind: "route_not_found" }
          : result.kind === "message_not_found"
            ? { kind: "message_not_found" }
            : { kind: "dispatch_set_conflict" };
      throw new MultiSendRollbackError(mapped);
    }
  }

  for (const [ordinal, child] of operation.children.entries()) {
    const dispatch = dispatchById.get(String(child.dispatch.id));
    if (!dispatch) {
      throw new MultiSendRollbackError({ kind: "dispatch_set_conflict" });
    }
    const insertedChild = await transaction.execute<IdRow>(
      buildInsertInboxV2OutboundMultiSendChildSql({
        operation,
        child,
        dispatch,
        ordinal
      })
    );
    if (insertedChild.rows.length !== 1) {
      throw new MultiSendRollbackError({ kind: "dispatch_set_conflict" });
    }
  }
  return { kind: "committed" };
}

type MultiSendOperationRow = {
  id: unknown;
  actor_kind: unknown;
  actor_employee_id: unknown;
  actor_trusted_service_id: unknown;
  mutation_token: unknown;
  idempotency_token: unknown;
  correlation_token: unknown;
  child_count: unknown;
  children_digest_sha256: unknown;
  created_at: unknown;
  revision: unknown;
};

export function buildInsertInboxV2OutboundMultiSendOperationSql(
  operation: InboxV2OutboundMultiSendOperation,
  childrenDigest = digestMultiSendChildren(operation)
): SQL {
  const employeeId =
    operation.actor.kind === "employee" ? operation.actor.employee.id : null;
  const trustedServiceId =
    operation.actor.kind === "trusted_service"
      ? operation.actor.trustedServiceId
      : null;
  return sql`
    insert into inbox_v2_outbound_multi_send_operations (
      tenant_id, id, actor_kind, actor_employee_id,
      actor_trusted_service_id, mutation_token, idempotency_token,
      correlation_token, child_count, children_digest_sha256,
      created_at, revision
    ) values (
      ${operation.tenantId}, ${operation.id}, ${operation.actor.kind},
      ${employeeId}, ${trustedServiceId}, ${operation.mutationToken},
      ${operation.idempotencyToken}, ${operation.correlationToken},
      ${operation.children.length}, ${childrenDigest},
      ${toDate(operation.createdAt)}, ${BigInt(operation.revision)}
    )
    on conflict do nothing
    returning id
  `;
}

async function loadMultiSendOperation(
  transaction: RawSqlExecutor,
  operation: InboxV2OutboundMultiSendOperation
): Promise<MultiSendOperationRow | null> {
  const result = await transaction.execute<MultiSendOperationRow>(sql`
    select id, actor_kind, actor_employee_id, actor_trusted_service_id,
           mutation_token, idempotency_token, correlation_token, child_count,
           children_digest_sha256, created_at, revision
      from inbox_v2_outbound_multi_send_operations
     where tenant_id = ${operation.tenantId}
       and (
         id = ${operation.id}
         or mutation_token = ${operation.mutationToken}
         or idempotency_token = ${operation.idempotencyToken}
       )
     order by case when id = ${operation.id} then 0 else 1 end
     limit 1
     for share
  `);
  return result.rows[0] ?? null;
}

function multiSendOperationMatches(
  row: MultiSendOperationRow,
  operation: InboxV2OutboundMultiSendOperation,
  childrenDigest: string
): boolean {
  return (
    String(row.id) === String(operation.id) &&
    String(row.actor_kind) === operation.actor.kind &&
    nullableString(row.actor_employee_id) ===
      (operation.actor.kind === "employee"
        ? String(operation.actor.employee.id)
        : null) &&
    nullableString(row.actor_trusted_service_id) ===
      (operation.actor.kind === "trusted_service"
        ? String(operation.actor.trustedServiceId)
        : null) &&
    String(row.mutation_token) === String(operation.mutationToken) &&
    String(row.idempotency_token) === String(operation.idempotencyToken) &&
    String(row.correlation_token) === String(operation.correlationToken) &&
    Number(row.child_count) === operation.children.length &&
    String(row.children_digest_sha256) === childrenDigest &&
    sameTimestamp(row.created_at, operation.createdAt) &&
    BigInt(String(row.revision)) === BigInt(operation.revision)
  );
}

function buildInsertInboxV2OutboundMultiSendChildSql(input: {
  operation: InboxV2OutboundMultiSendOperation;
  child: InboxV2OutboundMultiSendOperation["children"][number];
  dispatch: InboxV2OutboundDispatch;
  ordinal: number;
}): SQL {
  const { operation, child, dispatch, ordinal } = input;
  return sql`
    insert into inbox_v2_outbound_multi_send_children (
      tenant_id, operation_id, ordinal, conversation_id,
      external_thread_id, binding_id, source_connection_id,
      source_account_id, route_id, dispatch_id, message_id
    )
    select
      ${operation.tenantId}, ${operation.id}, ${ordinal},
      ${child.conversation.id}, ${child.externalThread.id},
      ${child.binding.id}, route_row.source_connection_id,
      ${child.sourceAccount.id}, ${child.route.id}, ${child.dispatch.id},
      ${dispatch.message.id}
      from inbox_v2_outbound_routes route_row
     where route_row.tenant_id = ${operation.tenantId}
       and route_row.id = ${child.route.id}
       and route_row.conversation_id = ${child.conversation.id}
       and route_row.external_thread_id = ${child.externalThread.id}
       and route_row.source_thread_binding_id = ${child.binding.id}
       and route_row.source_account_id = ${child.sourceAccount.id}
    on conflict do nothing
    returning operation_id as id
  `;
}

function digestMultiSendChildren(
  operation: InboxV2OutboundMultiSendOperation
): string {
  return sha256Hex(
    operation.children
      .map((child, ordinal) =>
        [
          `${ordinal}:${utf8Length(child.conversation.id)}:${child.conversation.id}`,
          `${utf8Length(child.externalThread.id)}:${child.externalThread.id}`,
          `${utf8Length(child.binding.id)}:${child.binding.id}`,
          `${utf8Length(child.sourceAccount.id)}:${child.sourceAccount.id}`,
          `${utf8Length(child.route.id)}:${child.route.id}`,
          `${utf8Length(child.dispatch.id)}:${child.dispatch.id}`
        ].join(":")
      )
      .join("|")
  );
}

export function computeInboxV2ExternalMessageKeyDigest(
  key: ExternalMessageReference["key"]
): string {
  const scope = externalMessageScopeColumns(key.scope);
  const value = [
    "external-message-key:v1|",
    lengthPrefixed(key.realm.realmId),
    lengthPrefixed(key.realm.realmVersion),
    lengthPrefixed(key.realm.canonicalizationVersion),
    lengthPrefixed(scope.kind),
    nullableLengthPrefixed(scope.sourceAccountId),
    nullableLengthPrefixed(scope.sourceThreadBindingId),
    lengthPrefixed(key.objectKindId),
    lengthPrefixed(key.externalThread.id),
    lengthPrefixed(key.canonicalExternalSubject)
  ].join("");
  return sha256Hex(value);
}

export function computeInboxV2OutboundRouteDigest(
  route: InboxV2OutboundRoute
): string {
  return `sha256:${sha256Hex(stableJson(route))}`;
}

export function deriveInboxV2SourceOccurrenceResolutionTransitionId(
  commit: InboxV2SourceOccurrenceResolutionCommit
): string {
  const digest = sha256Hex(
    [
      commit.tenantId,
      commit.before.id,
      commit.resultingRevision,
      commit.resolver.resolutionToken
    ].join("\u0000")
  );
  return `source_occurrence_resolution_transition:${digest.slice(0, 48)}`;
}

function digestOrdinalIds(values: readonly string[]): string | null {
  if (values.length === 0) return null;
  return sha256Hex(
    values
      .map((value, ordinal) => `${ordinal}:${utf8Length(value)}:${value}`)
      .join("|")
  );
}

function lengthPrefixed(value: string): string {
  return `${utf8Length(value)}:${value}`;
}

function nullableLengthPrefixed(value: string | null): string {
  return value === null ? "-1:" : lengthPrefixed(value);
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function runTransportTransaction<TResult>(
  executor: InboxV2OutboundTransportTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (
    let attempt = 1;
    attempt <= TRANSPORT_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(work, TRANSPORT_TRANSACTION_CONFIG);
    } catch (error) {
      if (
        error instanceof MultiSendRollbackError ||
        attempt === TRANSPORT_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_SQLSTATES.has(sqlState(error) ?? "")
      ) {
        throw error;
      }
    }
  }
  throw invariantError("Outbound transport transaction retry loop exhausted.");
}

async function runTransportSnapshotTransaction<TResult>(
  executor: InboxV2OutboundTransportTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  return executor.transaction(work, TRANSPORT_SNAPSHOT_TRANSACTION_CONFIG);
}

async function requireSingleInsert(
  executor: RawSqlExecutor,
  query: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(query);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} did not insert exactly one row.`);
  }
}

function toDate(value: string | Date): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw new CoreError("validation.failed", "Invalid timestamp.");
  }
  return date;
}

function normalizeMessageDispatchCursor(
  value: InboxV2MessageDispatchCursor | null
): InboxV2MessageDispatchCursor | null {
  if (value === null) return null;
  return {
    createdAt: inboxV2TimestampSchema.parse(value.createdAt),
    dispatchId: inboxV2OutboundDispatchIdSchema.parse(value.dispatchId)
  };
}

function normalizeMessageDispatchPageLimit(value: number | undefined): number {
  const limit = value ?? MESSAGE_DISPATCH_PAGE_DEFAULT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MESSAGE_DISPATCH_PAGE_MAX
  ) {
    throw new CoreError(
      "validation.failed",
      `Outbound dispatch page limit must be between 1 and ${MESSAGE_DISPATCH_PAGE_MAX}.`
    );
  }
  return limit;
}

function parseNonNegativeDatabaseInteger(
  value: unknown,
  field: string
): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw invariantError(`${field} is not a non-negative safe integer.`);
  }
  return parsed;
}

function parsePositiveDatabaseBigint(value: unknown, field: string): string {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 1n) {
      throw invariantError(`${field} must be positive.`);
    }
    return parsed.toString();
  } catch (error) {
    if (error instanceof InboxV2PersistenceInvariantError) throw error;
    throw invariantError(`${field} is not a valid bigint.`);
  }
}

function parseDatabaseTimestamp(value: unknown, field: string): string {
  const milliseconds = timestampMilliseconds(value);
  if (!Number.isFinite(milliseconds)) {
    throw invariantError(`${field} is not a valid timestamp.`);
  }
  return inboxV2TimestampSchema.parse(new Date(milliseconds).toISOString());
}

function assertAtMostOneRow(rows: readonly unknown[], operation: string): void {
  if (rows.length > 1) {
    throw invariantError(`${operation} returned more than one row.`);
  }
}

function toJson(value: unknown): string {
  return JSON.stringify(value);
}

function sameTimestamp(value: unknown, expected: string | Date): boolean {
  return timestampMilliseconds(value) === toDate(expected).getTime();
}

function sameNullableTimestamp(
  value: unknown,
  expected: string | Date | null
): boolean {
  if (value === null || value === undefined) return expected === null;
  return expected !== null && sameTimestamp(value, expected);
}

function timestampMilliseconds(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    return new Date(value).getTime();
  }
  return Number.NaN;
}

function sameJson(actual: unknown, expected: unknown): boolean {
  return stableJson(actual) === stableJson(expected);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function nullableString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function nullableBoolean(value: unknown): boolean | null {
  return value === null || value === undefined ? null : Boolean(value);
}

function sqlState(error: unknown): string | null {
  if (!isRecord(error)) return null;
  if (typeof error.code === "string") return error.code;
  return "cause" in error ? sqlState(error.cause) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unsupported(message: string): CoreError {
  return new CoreError("validation.failed", message);
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
