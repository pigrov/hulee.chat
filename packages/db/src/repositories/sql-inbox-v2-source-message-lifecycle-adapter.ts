import {
  INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID,
  inboxV2BigintCounterSchema,
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionEffectProofSchema,
  inboxV2DeferredSourceActionOrderingHeadSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2TimestampSchema,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredMessageSourceActionEffectProof,
  type InboxV2DeferredSourceActionOrderingHead,
  type InboxV2ExternalMessageReference,
  type InboxV2SourceOccurrenceResolutionCommit
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import {
  buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql,
  buildInsertInboxV2SourceOccurrenceResolutionTransitionSql
} from "./sql-inbox-v2-outbound-transport-repository";
import {
  buildReadInboxV2DeferredSourceActionOrderingHeadSql,
  classifyInboxV2DeferredSourceActionOrdering,
  commitInboxV2DeferredMessageSourceActionInTransaction,
  compareCanonicalInboxV2ProviderPosition,
  type CommitInboxV2DeferredMessageSourceActionResult,
  type InboxV2DeferredMessageSourceActionCommit,
  type InboxV2SourceMessageActionResult,
  type InboxV2SourceMessageReconciliationCallbacks,
  type InboxV2SourceMessageReconciliationConflictCode
} from "./sql-inbox-v2-source-message-reconciliation-repository";
import { readInboxV2SourceOccurrenceInTransaction } from "./sql-inbox-v2-source-occurrence-repository";
import {
  buildInboxV2SafeGenericEnvelope,
  createSqlInboxV2TimelineMessageRepository,
  InboxV2TimelineMessagePersistenceInvariantError,
  type InboxV2SafeGenericEnvelope,
  type InboxV2TimelineMessageRepository,
  type InboxV2TimelineMessageTransactionExecutor
} from "./sql-inbox-v2-timeline-message-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

type ReconciliationApplyInput = Parameters<
  InboxV2SourceMessageReconciliationCallbacks["applySourceAction"]
>[1];

export type InboxV2DeferredLifecycleSourceAction =
  InboxV2DeferredMessageSourceAction &
    Readonly<{
      action: Extract<
        InboxV2DeferredMessageSourceAction["action"],
        { kind: "edit" | "delete" }
      >;
    }>;

type MessageLifecycleEffectProof = Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_lifecycle" }
>;
type RetainedProviderDeleteEffectProof = Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "provider_delete_retain_local" }
>;

export type InboxV2SourceMessageLifecycleAdvancePlan =
  | Readonly<{
      kind: "message_lifecycle";
      effectProof: MessageLifecycleEffectProof;
      streamPosition: string;
    }>
  | Readonly<{
      kind: "provider_delete_retain_local";
      effectProof: RetainedProviderDeleteEffectProof;
      operationStreamPosition: string;
      policyStreamPosition: string;
    }>;

export type InboxV2SourceMessageLifecycleAdvancePlanResult =
  | Readonly<{
      kind: "planned";
      plan: InboxV2SourceMessageLifecycleAdvancePlan;
    }>
  | Readonly<{
      kind: "conflict";
      code: InboxV2SourceMessageReconciliationConflictCode;
    }>;

export type InboxV2SourceMessageLifecycleAdvancePlanner = Readonly<{
  planLifecycleAdvance(
    transaction: RawSqlExecutor,
    input: Readonly<{
      reconciliationPlan: ReconciliationApplyInput["plan"] | null;
      action: InboxV2DeferredLifecycleSourceAction;
      targetExternalMessageReference: InboxV2ExternalMessageReference;
      sourceOccurrenceResolution: InboxV2SourceOccurrenceResolutionCommit;
      recordedAt: string;
    }>
  ): Promise<InboxV2SourceMessageLifecycleAdvancePlanResult>;
}>;

export type InboxV2SourceMessageLifecycleEffectClosure = Readonly<{
  persistEffectClosure(
    transaction: RawSqlExecutor,
    input: Readonly<{
      effectProof:
        | MessageLifecycleEffectProof
        | RetainedProviderDeleteEffectProof;
      envelopes: readonly InboxV2SafeGenericEnvelope[];
    }>
  ): Promise<Readonly<{ providerIoIntentCount: number }>>;
}>;

export type CreateInboxV2SourceMessageLifecycleCallbacksOptions = Readonly<{
  planner: InboxV2SourceMessageLifecycleAdvancePlanner;
  effectClosure: InboxV2SourceMessageLifecycleEffectClosure;
  deriveResolutionToken(input: {
    action: InboxV2DeferredLifecycleSourceAction;
    targetExternalMessageReference: InboxV2ExternalMessageReference;
  }): string;
  /** Test seam. Production uses the transaction-local SQL/timeline primitives. */
  dependencies?: Partial<InboxV2SourceMessageLifecycleAdapterDependencies>;
}>;

type LifecycleCallbacks = Pick<
  InboxV2SourceMessageReconciliationCallbacks,
  "applySourceAction" | "drainDeferredActions"
>;

type OrderingHeadRow = Readonly<{
  tenant_id: unknown;
  external_message_key_detail: unknown;
  lane: unknown;
  scope_token: unknown;
  comparator_id: unknown;
  comparator_revision: unknown;
  latest_action_id: unknown;
  latest_normalized_inbound_event_id: unknown;
  latest_source_occurrence_id: unknown;
  latest_semantic_id: unknown;
  latest_event_fingerprint_sha256: unknown;
  latest_position: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
}>;

type PersistOccurrenceResolutionResult =
  | "committed"
  | "already_exists"
  | "conflict";

type PersistLifecycleEffectResult = "committed" | "already_exists" | "conflict";

type InboxV2SourceMessageLifecycleAdapterDependencies = Readonly<{
  readDatabaseNow(transaction: RawSqlExecutor): Promise<string>;
  loadOrderingHead(
    transaction: RawSqlExecutor,
    action: InboxV2DeferredLifecycleSourceAction
  ): Promise<InboxV2DeferredSourceActionOrderingHead | null>;
  persistOccurrenceResolution(
    transaction: RawSqlExecutor,
    commit: InboxV2SourceOccurrenceResolutionCommit
  ): Promise<PersistOccurrenceResolutionResult>;
  persistLifecycleEffect(
    transaction: RawSqlExecutor,
    plan: InboxV2SourceMessageLifecycleAdvancePlan,
    effectClosure: InboxV2SourceMessageLifecycleEffectClosure
  ): Promise<PersistLifecycleEffectResult>;
  commitDeferredAction(
    transaction: RawSqlExecutor,
    commit: InboxV2DeferredMessageSourceActionCommit
  ): Promise<CommitInboxV2DeferredMessageSourceActionResult>;
  createTimelineRepository(
    executor: InboxV2TimelineMessageTransactionExecutor
  ): InboxV2TimelineMessageRepository;
}>;

const CALLBACK_CONFLICT =
  "source.message_reconciliation.callback_conflict" as const;
const DEFERRED_ACTION_CONFLICT =
  "source.message_reconciliation.deferred_action_conflict" as const;

/**
 * DB-only bridge between SRC-006 ordering and MSG-005 lifecycle persistence.
 * It never performs provider I/O. The provider-neutral planner is invoked only
 * for an authoritative `advance`; non-advancing observations persist provenance
 * and their terminal source-action CAS without Message/provider/outbox work.
 */
export function createInboxV2SourceMessageLifecycleCallbacks(
  options: CreateInboxV2SourceMessageLifecycleCallbacksOptions
): LifecycleCallbacks {
  const dependencies: InboxV2SourceMessageLifecycleAdapterDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };

  return Object.freeze({
    async applySourceAction(transaction, input) {
      const action = lifecycleAction(input.plan.intent.deferredAction);
      if (action === null) return callbackConflict(CALLBACK_CONFLICT);
      const recordedAt = await dependencies.readDatabaseNow(transaction);
      const currentHead = await dependencies.loadOrderingHead(
        transaction,
        action
      );
      const processed = await processLifecycleAction({
        transaction,
        action,
        targetExternalMessageReference: input.targetExternalMessageReference,
        reconciliationPlan: input.plan,
        recordedAt,
        currentHead,
        forceOrderingConflict: false,
        options,
        dependencies
      });
      return processed.result;
    },

    async drainDeferredActions(transaction, input) {
      const actions = input.actions.map(lifecycleAction);
      if (actions.some((action) => action === null)) {
        return callbackConflict(CALLBACK_CONFLICT);
      }
      const lifecycleActions =
        actions as InboxV2DeferredLifecycleSourceAction[];
      if (
        new Set(lifecycleActions.map((action) => action.id)).size !==
        lifecycleActions.length
      ) {
        return callbackConflict(DEFERRED_ACTION_CONFLICT);
      }
      const ordered = [...lifecycleActions].sort(compareDrainActions);
      const partitionCount = new Set(
        ordered
          .map(orderingPartitionKey)
          .filter((key): key is string => key !== null)
      ).size;
      if (partitionCount > 1) {
        return callbackConflict(DEFERRED_ACTION_CONFLICT);
      }
      const recordedAt = await dependencies.readDatabaseNow(transaction);
      let currentHead =
        ordered.length === 0
          ? null
          : await dependencies.loadOrderingHead(transaction, ordered[0]!);
      const resultById = new Map<string, InboxV2SourceMessageActionResult>();

      for (const action of ordered) {
        const processed = await processLifecycleAction({
          transaction,
          action,
          targetExternalMessageReference: input.targetExternalMessageReference,
          reconciliationPlan: null,
          recordedAt,
          currentHead,
          forceOrderingConflict: false,
          options,
          dependencies
        });
        if (processed.result.kind === "conflict") return processed.result;
        resultById.set(action.id, processed.result.result);
        currentHead = processed.afterOrderingHead;
      }

      const results = input.actions.map((action) => resultById.get(action.id));
      if (results.some((result) => result === undefined)) {
        return callbackConflict(CALLBACK_CONFLICT);
      }
      return {
        kind: "committed" as const,
        result: { results: results as NonNullable<(typeof results)[number]>[] }
      };
    }
  });
}

type ProcessLifecycleActionInput = Readonly<{
  transaction: RawSqlExecutor;
  action: InboxV2DeferredLifecycleSourceAction;
  targetExternalMessageReference: InboxV2ExternalMessageReference;
  reconciliationPlan: ReconciliationApplyInput["plan"] | null;
  recordedAt: string;
  currentHead: InboxV2DeferredSourceActionOrderingHead | null;
  forceOrderingConflict: boolean;
  options: CreateInboxV2SourceMessageLifecycleCallbacksOptions;
  dependencies: InboxV2SourceMessageLifecycleAdapterDependencies;
}>;

async function processLifecycleAction(input: ProcessLifecycleActionInput) {
  const decision = input.forceOrderingConflict
    ? ({
        kind: "conflict" as const,
        conflictingAction: input.currentHead?.latest.action ?? null
      } as const)
    : classifyInboxV2DeferredSourceActionOrdering({
        action: input.action,
        currentHead: input.currentHead
      });
  if (decision.kind === "already_exists") {
    return {
      result: callbackConflict(DEFERRED_ACTION_CONFLICT),
      afterOrderingHead: input.currentHead
    };
  }

  const bindsExactTarget =
    decision.kind === "advance" ||
    decision.kind === "stale" ||
    decision.kind === "duplicate";
  const resolution = bindsExactTarget
    ? buildExactOccurrenceResolution({
        action: input.action,
        targetExternalMessageReference: input.targetExternalMessageReference,
        recordedAt: input.recordedAt,
        resolutionToken: input.options.deriveResolutionToken({
          action: input.action,
          targetExternalMessageReference: input.targetExternalMessageReference
        })
      })
    : null;

  let advancePlan: InboxV2SourceMessageLifecycleAdvancePlan | null = null;
  if (decision.kind === "advance") {
    if (resolution === null) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Lifecycle advance lost its exact SourceOccurrence resolution."
      );
    }
    const planned = await input.options.planner.planLifecycleAdvance(
      input.transaction,
      {
        reconciliationPlan: input.reconciliationPlan,
        action: input.action,
        targetExternalMessageReference: input.targetExternalMessageReference,
        sourceOccurrenceResolution: resolution,
        recordedAt: input.recordedAt
      }
    );
    if (planned.kind === "conflict") {
      return {
        result: callbackConflict(planned.code),
        afterOrderingHead: input.currentHead
      };
    }
    advancePlan = normalizeAdvancePlan(planned.plan);
  }

  const commit = buildLifecycleTerminalCommit({
    action: input.action,
    targetExternalMessageReference: input.targetExternalMessageReference,
    sourceOccurrenceResolution: resolution,
    decision,
    beforeOrderingHead: input.currentHead,
    advancePlan,
    recordedAt: input.recordedAt
  });

  if (
    resolution !== null &&
    (await input.dependencies.persistOccurrenceResolution(
      input.transaction,
      resolution
    )) === "conflict"
  ) {
    return {
      result: callbackConflict(CALLBACK_CONFLICT),
      afterOrderingHead: input.currentHead
    };
  }
  if (
    advancePlan !== null &&
    (await input.dependencies.persistLifecycleEffect(
      input.transaction,
      advancePlan,
      input.options.effectClosure
    )) === "conflict"
  ) {
    return {
      result: callbackConflict(CALLBACK_CONFLICT),
      afterOrderingHead: input.currentHead
    };
  }

  const committed = await input.dependencies.commitDeferredAction(
    input.transaction,
    commit
  );
  if (committed.kind !== "committed" && committed.kind !== "already_exists") {
    return {
      result: callbackConflict(CALLBACK_CONFLICT),
      afterOrderingHead: input.currentHead
    };
  }
  return {
    result: {
      kind: "committed" as const,
      result: {
        externalMessageReference: input.targetExternalMessageReference,
        sourceOccurrence: resolution?.after ?? input.action.sourceOccurrence,
        deferredAction: committed.action
      }
    },
    afterOrderingHead: commit.afterOrderingHead
  };
}

type BuildLifecycleTerminalCommitInput = Readonly<{
  action: InboxV2DeferredLifecycleSourceAction;
  targetExternalMessageReference: InboxV2ExternalMessageReference;
  sourceOccurrenceResolution: InboxV2SourceOccurrenceResolutionCommit | null;
  decision: Exclude<
    ReturnType<typeof classifyInboxV2DeferredSourceActionOrdering>,
    { kind: "already_exists" }
  >;
  beforeOrderingHead: InboxV2DeferredSourceActionOrderingHead | null;
  advancePlan: InboxV2SourceMessageLifecycleAdvancePlan | null;
  recordedAt: string;
}>;

function buildLifecycleTerminalCommit(
  input: BuildLifecycleTerminalCommitInput
): InboxV2DeferredMessageSourceActionCommit {
  const resultingRevision = (BigInt(input.action.revision) + 1n).toString();
  const afterOrderingHead =
    input.decision.kind === "advance"
      ? advanceOrderingHead(
          input.action,
          input.beforeOrderingHead,
          input.recordedAt
        )
      : input.beforeOrderingHead;
  const state = terminalState(input);
  const bindsExactTarget =
    input.decision.kind === "advance" ||
    input.decision.kind === "stale" ||
    input.decision.kind === "duplicate";
  return inboxV2DeferredMessageSourceActionCommitSchema.parse({
    tenantId: input.action.tenantId,
    before: input.action,
    transition: {
      action: {
        tenantId: input.action.tenantId,
        kind: "deferred_message_source_action",
        id: input.action.id
      },
      expectedRevision: input.action.revision,
      resultingRevision,
      afterState: state,
      orderingOutcome:
        input.decision.kind === "advance"
          ? "advance"
          : input.decision.kind === "stale"
            ? "stale"
            : input.decision.kind === "duplicate"
              ? "duplicate"
              : "conflict",
      expectedOrderingHeadRevision: input.beforeOrderingHead?.revision ?? null,
      resultingOrderingHeadRevision: afterOrderingHead?.revision ?? null,
      recordedAt: input.recordedAt
    },
    targetExternalMessageReference: bindsExactTarget
      ? input.targetExternalMessageReference
      : null,
    sourceOccurrenceResolution: bindsExactTarget
      ? input.sourceOccurrenceResolution
      : null,
    effectProof:
      input.decision.kind === "advance"
        ? (input.advancePlan?.effectProof ?? null)
        : null,
    beforeOrderingHead: input.beforeOrderingHead,
    afterOrderingHead,
    after: {
      ...input.action,
      state,
      revision: resultingRevision,
      updatedAt: input.recordedAt
    }
  });
}

function terminalState(input: BuildLifecycleTerminalCommitInput) {
  const { decision, recordedAt } = input;
  if (decision.kind === "advance") {
    if (input.advancePlan === null) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Lifecycle advance requires one typed domain effect."
      );
    }
    const facts = lifecycleEffectFacts(input.advancePlan.effectProof);
    if (facts.recordedAt !== recordedAt) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Lifecycle effect and terminal source action must share one database timestamp."
      );
    }
    return {
      state: "applied" as const,
      externalMessageReference: {
        tenantId: input.targetExternalMessageReference.tenantId,
        kind: "external_message_reference" as const,
        id: input.targetExternalMessageReference.id
      },
      message: input.targetExternalMessageReference.message,
      appliedMessageRevision: facts.messageRevision,
      effectKind: input.advancePlan.kind,
      appliedAt: recordedAt
    };
  }
  if (decision.kind === "stale") {
    return {
      state: "stale" as const,
      headAction: decision.headAction,
      staleAt: recordedAt
    };
  }
  if (decision.kind === "duplicate") {
    return {
      state: "duplicate" as const,
      canonicalAction: decision.canonicalAction,
      duplicateAt: recordedAt
    };
  }
  const ordering = input.action.semanticProof.ordering;
  return {
    state: "ordering_conflict" as const,
    conflictingAction: decision.conflictingAction,
    reasonId:
      ordering.kind === "unavailable"
        ? ordering.reasonId
        : ordering.kind === "incomparable"
          ? "core:provider-order-incomparable"
          : "core:provider-order-conflict",
    conflictedAt: recordedAt
  };
}

function lifecycleEffectFacts(
  effect: MessageLifecycleEffectProof | RetainedProviderDeleteEffectProof
) {
  return effect.kind === "message_lifecycle"
    ? {
        messageRevision: effect.commit.afterMessage.revision,
        recordedAt: effect.commit.revision.recordedAt
      }
    : {
        messageRevision: effect.operationCreationCommit.message.revision,
        recordedAt: effect.policyTransitionCommit.transition.recordedAt
      };
}

function advanceOrderingHead(
  action: InboxV2DeferredLifecycleSourceAction,
  before: InboxV2DeferredSourceActionOrderingHead | null,
  recordedAt: string
): InboxV2DeferredSourceActionOrderingHead {
  const ordering = action.semanticProof.ordering;
  if (ordering.kind !== "monotonic_exact") {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Only exact monotonic provider order can advance a lifecycle head."
    );
  }
  return inboxV2DeferredSourceActionOrderingHeadSchema.parse({
    tenantId: action.tenantId,
    externalMessageKey: action.externalMessageKey,
    lane: "message_lifecycle",
    scopeToken: ordering.scopeToken,
    comparatorId: ordering.comparatorId,
    comparatorRevision: ordering.comparatorRevision,
    latest: {
      action: {
        tenantId: action.tenantId,
        kind: "deferred_message_source_action",
        id: action.id
      },
      idempotencyKey: action.idempotencyKey,
      position: ordering.position
    },
    revision: before === null ? "1" : (BigInt(before.revision) + 1n).toString(),
    createdAt: before?.createdAt ?? recordedAt,
    updatedAt: recordedAt
  });
}

function buildExactOccurrenceResolution(
  input: Readonly<{
    action: InboxV2DeferredLifecycleSourceAction;
    targetExternalMessageReference: InboxV2ExternalMessageReference;
    recordedAt: string;
    resolutionToken: string;
  }>
): InboxV2SourceOccurrenceResolutionCommit {
  const resultingRevision = (
    BigInt(input.action.sourceOccurrence.revision) + 1n
  ).toString();
  const targetReference = {
    tenantId: input.targetExternalMessageReference.tenantId,
    kind: "external_message_reference" as const,
    id: input.targetExternalMessageReference.id
  };
  return inboxV2SourceOccurrenceResolutionCommitSchema.parse({
    tenantId: input.action.tenantId,
    expectedRevision: input.action.sourceOccurrence.revision,
    resultingRevision,
    changedAt: input.recordedAt,
    resolver: {
      kind: "trusted_service",
      trustedServiceId:
        input.action.sourceOccurrence.messageIdentityDeclaration.adapterContract
          .loadedByTrustedServiceId,
      resolutionToken: inboxV2RoutingTokenSchema.parse(input.resolutionToken)
    },
    before: input.action.sourceOccurrence,
    after: {
      ...input.action.sourceOccurrence,
      resolution: {
        state: "resolved",
        externalMessageReference: targetReference
      },
      revision: resultingRevision,
      updatedAt: input.recordedAt
    },
    resolvedReference: input.targetExternalMessageReference
  });
}

function normalizeAdvancePlan(
  candidate: InboxV2SourceMessageLifecycleAdvancePlan
): InboxV2SourceMessageLifecycleAdvancePlan {
  const effectProof = inboxV2DeferredMessageSourceActionEffectProofSchema.parse(
    candidate.effectProof
  );
  if (effectProof.kind !== candidate.kind) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Lifecycle advance plan kind does not match its typed effect proof."
    );
  }
  if (candidate.kind === "message_lifecycle") {
    return {
      ...candidate,
      effectProof: effectProof as MessageLifecycleEffectProof,
      streamPosition: inboxV2BigintCounterSchema.parse(candidate.streamPosition)
    };
  }
  const operationStreamPosition = inboxV2BigintCounterSchema.parse(
    candidate.operationStreamPosition
  );
  const policyStreamPosition = inboxV2BigintCounterSchema.parse(
    candidate.policyStreamPosition
  );
  if (BigInt(policyStreamPosition) !== BigInt(operationStreamPosition) + 1n) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Retained provider delete requires two contiguous tenant-stream positions."
    );
  }
  return {
    ...candidate,
    effectProof: effectProof as RetainedProviderDeleteEffectProof,
    operationStreamPosition,
    policyStreamPosition
  };
}

function lifecycleAction(
  action: InboxV2DeferredMessageSourceAction
): InboxV2DeferredLifecycleSourceAction | null {
  return action.action.kind === "edit" || action.action.kind === "delete"
    ? (action as InboxV2DeferredLifecycleSourceAction)
    : null;
}

function compareDrainActions(
  left: InboxV2DeferredLifecycleSourceAction,
  right: InboxV2DeferredLifecycleSourceAction
): number {
  const leftOrdering = left.semanticProof.ordering;
  const rightOrdering = right.semanticProof.ordering;
  if (
    leftOrdering.kind === "monotonic_exact" &&
    rightOrdering.kind === "monotonic_exact"
  ) {
    const position = compareCanonicalInboxV2ProviderPosition(
      leftOrdering.position,
      rightOrdering.position
    );
    return position === 0 ? left.id.localeCompare(right.id) : position;
  }
  if (leftOrdering.kind === "monotonic_exact") return -1;
  if (rightOrdering.kind === "monotonic_exact") return 1;
  return left.id.localeCompare(right.id);
}

function orderingPartitionKey(
  action: InboxV2DeferredLifecycleSourceAction
): string | null {
  const ordering = action.semanticProof.ordering;
  return ordering.kind === "monotonic_exact"
    ? `${ordering.scopeToken}\u0000${ordering.comparatorId}\u0000${ordering.comparatorRevision}`
    : null;
}

function callbackConflict(
  code: InboxV2SourceMessageReconciliationConflictCode
) {
  return { kind: "conflict" as const, code };
}

const defaultDependencies: InboxV2SourceMessageLifecycleAdapterDependencies = {
  async readDatabaseNow(transaction) {
    const result = await transaction.execute<{ now: unknown }>(
      sql`select transaction_timestamp() as now`
    );
    if (result.rows.length !== 1) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Lifecycle source-action database clock did not return one row."
      );
    }
    return inboxV2TimestampSchema.parse(databaseTimestamp(result.rows[0]!.now));
  },

  async loadOrderingHead(transaction, action) {
    const ordering = action.semanticProof.ordering;
    if (ordering.kind !== "monotonic_exact") return null;
    const selector = advanceOrderingHead(action, null, action.updatedAt);
    const result = await transaction.execute<OrderingHeadRow>(
      buildReadInboxV2DeferredSourceActionOrderingHeadSql(selector)
    );
    if (result.rows.length > 1) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Lifecycle source-action ordering-head lookup exceeded one row."
      );
    }
    const row = result.rows[0];
    if (row === undefined) return null;
    return inboxV2DeferredSourceActionOrderingHeadSchema.parse({
      tenantId: row.tenant_id,
      externalMessageKey: row.external_message_key_detail,
      lane: row.lane,
      scopeToken: row.scope_token,
      comparatorId: row.comparator_id,
      comparatorRevision: databaseBigint(row.comparator_revision),
      latest: {
        action: {
          tenantId: row.tenant_id,
          kind: "deferred_message_source_action",
          id: row.latest_action_id
        },
        idempotencyKey: {
          normalizedInboundEvent: {
            tenantId: row.tenant_id,
            kind: "normalized_inbound_event",
            id: row.latest_normalized_inbound_event_id
          },
          sourceOccurrence: {
            tenantId: row.tenant_id,
            kind: "source_occurrence",
            id: row.latest_source_occurrence_id
          },
          semanticId: row.latest_semantic_id,
          eventFingerprintSha256: row.latest_event_fingerprint_sha256
        },
        position: row.latest_position
      },
      revision: databaseBigint(row.revision),
      createdAt: databaseTimestamp(row.created_at),
      updatedAt: databaseTimestamp(row.updated_at)
    });
  },

  async persistOccurrenceResolution(transaction, commit) {
    const current = await readInboxV2SourceOccurrenceInTransaction(
      transaction,
      {
        tenantId: commit.tenantId,
        occurrenceId: commit.before.id
      },
      { lock: true }
    );
    if (current === null) return "conflict";
    if (sameCanonicalValue(current, commit.after)) return "already_exists";
    if (!sameCanonicalValue(current, commit.before)) return "conflict";
    const transition = await transaction.execute<{ id: unknown }>(
      buildInsertInboxV2SourceOccurrenceResolutionTransitionSql(commit)
    );
    if (transition.rows.length !== 1) return "conflict";
    const updated = await transaction.execute<{ id: unknown }>(
      buildCompareAndSwapInboxV2SourceOccurrenceResolutionSql(commit)
    );
    return updated.rows.length === 1 ? "committed" : "conflict";
  },

  async persistLifecycleEffect(transaction, plan, effectClosure) {
    const repository = defaultDependencies.createTimelineRepository(
      transactionBoundTimelineExecutor(transaction)
    );
    if (plan.kind === "message_lifecycle") {
      let closurePersisted = false;
      const result = await repository.withMessageMutation(
        {
          commit: plan.effectProof.commit,
          streamPosition: inboxV2BigintCounterSchema.parse(plan.streamPosition)
        },
        async ({ envelope }) => {
          const envelopes = messageLifecycleEffectEnvelopes(
            plan.effectProof,
            envelope
          );
          await assertNoProviderIoClosure(
            effectClosure,
            transaction,
            plan.effectProof,
            envelopes
          );
          closurePersisted = true;
        }
      );
      if (result.kind === "applied") {
        if (!closurePersisted) {
          throw new InboxV2TimelineMessagePersistenceInvariantError(
            "Applied lifecycle effect omitted its atomic event/outbox closure."
          );
        }
        return "committed";
      }
      return result.kind === "already_applied" ? "already_exists" : "conflict";
    }

    const creation = await repository.createProviderLifecycleOperation({
      commit: plan.effectProof.operationCreationCommit,
      streamPosition: inboxV2BigintCounterSchema.parse(
        plan.operationStreamPosition
      )
    });
    if (creation.kind !== "appended" && creation.kind !== "already_applied") {
      return "conflict";
    }
    const policy = await repository.transitionProviderLifecycleOperation({
      commit: plan.effectProof.policyTransitionCommit,
      streamPosition: inboxV2BigintCounterSchema.parse(
        plan.policyStreamPosition
      )
    });
    if (policy.kind !== "appended" && policy.kind !== "already_applied") {
      return "conflict";
    }
    const envelopes = [creation, policy]
      .filter(
        (result): result is Extract<typeof result, { kind: "appended" }> =>
          result.kind === "appended"
      )
      .map((result) => result.envelope);
    if (envelopes.length > 0) {
      await assertNoProviderIoClosure(
        effectClosure,
        transaction,
        plan.effectProof,
        envelopes
      );
      return "committed";
    }
    return "already_exists";
  },

  commitDeferredAction: commitInboxV2DeferredMessageSourceActionInTransaction,
  createTimelineRepository: createSqlInboxV2TimelineMessageRepository
};

async function assertNoProviderIoClosure(
  closure: InboxV2SourceMessageLifecycleEffectClosure,
  transaction: RawSqlExecutor,
  effectProof: MessageLifecycleEffectProof | RetainedProviderDeleteEffectProof,
  envelopes: readonly InboxV2SafeGenericEnvelope[]
): Promise<void> {
  const result = await closure.persistEffectClosure(transaction, {
    effectProof,
    envelopes
  });
  if (result.providerIoIntentCount !== 0) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Provider-observed lifecycle effects cannot enqueue provider I/O."
    );
  }
  await verifyInboxV2SourceMessageLifecycleEffectClosure(
    transaction,
    envelopes
  );
}

type SourceLifecycleEffectClosureRow = Readonly<{
  stream_commit_count: unknown;
  change_count: unknown;
  missing_change_count: unknown;
  unexpected_change_count: unknown;
  commit_manifest_count: unknown;
  event_count: unknown;
  exact_event_count: unknown;
  outbox_count: unknown;
  projection_count: unknown;
  provider_io_count: unknown;
}>;

/**
 * Verifies the durable inverse closure instead of trusting a callback receipt.
 * The check runs in the same ambient transaction as the Message/provider
 * lifecycle write and deferred-action CAS, so any missing/extra effect aborts
 * the whole reconciliation unit.
 */
export async function verifyInboxV2SourceMessageLifecycleEffectClosure(
  transaction: RawSqlExecutor,
  envelopes: readonly InboxV2SafeGenericEnvelope[]
): Promise<void> {
  const envelopeIdentities = envelopes.map(
    (envelope) =>
      `${envelope.tenantId}\u0000${envelope.streamPosition}\u0000${sourceLifecycleEntityTypeId(envelope)}\u0000${envelope.entityId}`
  );
  if (
    envelopes.length === 0 ||
    new Set(envelopeIdentities).size !== envelopes.length
  ) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Source lifecycle effect requires one unique entity envelope per tenant-stream position."
    );
  }
  const groups = new Map<string, InboxV2SafeGenericEnvelope[]>();
  for (const envelope of envelopes) {
    const key = `${envelope.tenantId}\u0000${envelope.streamPosition}`;
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [envelope]);
    else group.push(envelope);
  }
  for (const group of groups.values()) {
    const result = await transaction.execute<SourceLifecycleEffectClosureRow>(
      buildVerifyInboxV2SourceMessageLifecycleEffectClosureSql(group)
    );
    const row = result.rows[0];
    if (
      result.rows.length !== 1 ||
      databaseCount(row?.stream_commit_count) !== 1 ||
      databaseCount(row?.change_count) !== group.length ||
      databaseCount(row?.missing_change_count) !== 0 ||
      databaseCount(row?.unexpected_change_count) !== 0 ||
      databaseCount(row?.commit_manifest_count) !== 1 ||
      databaseCount(row?.event_count) !== 1 ||
      databaseCount(row?.exact_event_count) !== 1 ||
      databaseCount(row?.outbox_count) !== 1 ||
      databaseCount(row?.projection_count) !== 1 ||
      databaseCount(row?.provider_io_count) !== 0
    ) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Source lifecycle effect omitted or duplicated its exact stream change, event or projection closure."
      );
    }
  }
}

export function buildVerifyInboxV2SourceMessageLifecycleEffectClosureSql(
  envelopes: readonly InboxV2SafeGenericEnvelope[]
): SQL {
  const envelope = envelopes[0];
  if (
    envelope === undefined ||
    envelopes.some(
      (candidate) =>
        candidate.tenantId !== envelope.tenantId ||
        candidate.streamPosition !== envelope.streamPosition
    )
  ) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Source lifecycle closure SQL requires one non-empty tenant-stream group."
    );
  }
  const expectedChanges = JSON.stringify(
    envelopes.map((candidate) => ({
      entityTypeId: sourceLifecycleEntityTypeId(candidate),
      entityId: candidate.entityId,
      entityRevision: candidate.entityRevision
    }))
  );
  const expectedChangeCount = envelopes.length;
  return sql`
    with expected_change as materialized (
      select expected_row->>'entityTypeId' as entity_type_id,
             expected_row->>'entityId' as entity_id,
             (expected_row->>'entityRevision')::bigint as resulting_revision
        from jsonb_array_elements(${expectedChanges}::jsonb) expected_row
    ),
    exact_stream_commit as materialized (
      select commit_row.*
        from inbox_v2_tenant_stream_commits commit_row
        join inbox_v2_tenant_stream_heads head_row
          on head_row.tenant_id = commit_row.tenant_id
         and head_row.stream_epoch = commit_row.stream_epoch
         and head_row.last_position >= commit_row.position
       where commit_row.tenant_id = ${envelope.tenantId}
         and commit_row.position = ${envelope.streamPosition}::bigint
    ),
    actual_change as materialized (
      select change_row.id, change_row.stream_commit_id,
             change_row.mutation_id, change_row.stream_position,
             change_row.ordinal,
             change_row.entity_type_id, change_row.entity_id,
             change_row.resulting_revision
        from inbox_v2_tenant_stream_changes change_row
        join exact_stream_commit commit_row
          on commit_row.tenant_id = change_row.tenant_id
         and commit_row.id = change_row.stream_commit_id
         and commit_row.mutation_id = change_row.mutation_id
         and commit_row.position = change_row.stream_position
    ),
    exact_event as materialized (
      select event_row.*
        from inbox_v2_domain_events event_row
        join exact_stream_commit commit_row
          on commit_row.tenant_id = event_row.tenant_id
         and commit_row.id = event_row.stream_commit_id
         and commit_row.mutation_id = event_row.mutation_id
         and commit_row.position = event_row.stream_position
       where event_row.type_id = 'core:message.changed'
         and jsonb_array_length(event_row.change_ids) = ${expectedChangeCount}
         and event_row.change_ids = (
           select jsonb_agg(change_row.id order by change_row.ordinal)
             from actual_change change_row
         )
         and commit_row.event_ids = jsonb_build_array(event_row.id)
    )
    select
      (select count(*) from exact_stream_commit)::text
        as stream_commit_count,
      (select count(*) from actual_change)::text as change_count,
      (
        select count(*)
          from expected_change expected_row
         where not exists (
           select 1
             from actual_change change_row
            where change_row.entity_type_id = expected_row.entity_type_id
              and change_row.entity_id = expected_row.entity_id
              and change_row.resulting_revision =
                  expected_row.resulting_revision
         )
      )::text as missing_change_count,
      (
        select count(*)
          from actual_change change_row
         where not exists (
           select 1
             from expected_change expected_row
            where expected_row.entity_type_id = change_row.entity_type_id
              and expected_row.entity_id = change_row.entity_id
              and expected_row.resulting_revision =
                  change_row.resulting_revision
         )
      )::text as unexpected_change_count,
      (
        select count(*)
          from exact_stream_commit commit_row
         where commit_row.change_count = ${expectedChangeCount}
           and jsonb_array_length(commit_row.change_ids) =
               ${expectedChangeCount}
           and commit_row.change_ids = (
             select jsonb_agg(change_row.id order by change_row.ordinal)
               from actual_change change_row
           )
           and commit_row.event_count = 1
           and jsonb_array_length(commit_row.event_ids) = 1
           and commit_row.outbox_intent_count = 1
           and jsonb_array_length(commit_row.outbox_intent_ids) = 1
      )::text as commit_manifest_count,
      (
        select count(*)
          from inbox_v2_domain_events event_row
          join exact_stream_commit commit_row
            on commit_row.tenant_id = event_row.tenant_id
           and commit_row.id = event_row.stream_commit_id
           and commit_row.mutation_id = event_row.mutation_id
           and commit_row.position = event_row.stream_position
      )::text as event_count,
      (select count(*) from exact_event)::text as exact_event_count,
      (
        select count(*)
          from inbox_v2_outbox_intents intent_row
          join exact_stream_commit commit_row
            on commit_row.tenant_id = intent_row.tenant_id
           and commit_row.id = intent_row.stream_commit_id
           and commit_row.mutation_id = intent_row.mutation_id
           and commit_row.position = intent_row.stream_position
      )::text as outbox_count,
      (
        select count(*)
          from inbox_v2_outbox_intents intent_row
          join exact_stream_commit commit_row
            on commit_row.tenant_id = intent_row.tenant_id
           and commit_row.id = intent_row.stream_commit_id
           and commit_row.mutation_id = intent_row.mutation_id
           and commit_row.position = intent_row.stream_position
          join exact_event event_row
            on event_row.tenant_id = intent_row.tenant_id
           and event_row.id = intent_row.event_id
         where intent_row.effect_class = 'projection'
           and intent_row.type_id = 'core:projection.update'
           and intent_row.handler_id = 'core:inbox-projection'
           and jsonb_array_length(intent_row.change_ids) =
               ${expectedChangeCount}
           and intent_row.change_ids = (
             select jsonb_agg(change_row.id order by change_row.ordinal)
               from actual_change change_row
           )
           and commit_row.outbox_intent_ids =
               jsonb_build_array(intent_row.id)
      )::text as projection_count,
      (
        select count(*)
          from inbox_v2_outbox_intents provider_intent
          join exact_stream_commit commit_row
            on commit_row.tenant_id = provider_intent.tenant_id
           and commit_row.id = provider_intent.stream_commit_id
           and commit_row.mutation_id = provider_intent.mutation_id
           and commit_row.position = provider_intent.stream_position
         where provider_intent.tenant_id = ${envelope.tenantId}
           and provider_intent.effect_class = 'provider_io'
      )::text as provider_io_count
  `;
}

function messageLifecycleEffectEnvelopes(
  effectProof: MessageLifecycleEffectProof,
  messageEnvelope: InboxV2SafeGenericEnvelope
): readonly InboxV2SafeGenericEnvelope[] {
  const providerCreation = effectProof.commit.providerOperationCreationCommit;
  if (providerCreation === null) return [messageEnvelope];
  const operation = providerCreation.operation;
  return [
    messageEnvelope,
    buildInboxV2SafeGenericEnvelope({
      tenantId: effectProof.commit.tenantId,
      entityKind: "provider_lifecycle",
      entityId: operation.id,
      entityRevision: operation.revision,
      timelineItemId: effectProof.commit.afterTimelineItem.id,
      timelineSequence: effectProof.commit.afterTimelineItem.timelineSequence,
      streamPosition: messageEnvelope.streamPosition,
      changeKind: `provider_lifecycle.${operation.action}.${operation.origin}`,
      occurredAt: operation.occurredAt
    })
  ];
}

function sourceLifecycleEntityTypeId(
  envelope: InboxV2SafeGenericEnvelope
):
  | "core:message"
  | typeof INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID {
  if (envelope.entityKind === "message") return "core:message";
  if (envelope.entityKind === "provider_lifecycle") {
    return INBOX_V2_MESSAGE_PROVIDER_LIFECYCLE_OPERATION_ENTITY_TYPE_ID;
  }
  throw new InboxV2TimelineMessagePersistenceInvariantError(
    "Source lifecycle effect envelope has an unsupported entity kind."
  );
}

function databaseCount(value: unknown): number {
  const parsed = Number(String(value));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : -1;
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

function databaseBigint(value: unknown): string {
  try {
    return BigInt(String(value)).toString();
  } catch {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Lifecycle source-action row contains an invalid bigint."
    );
  }
}

function databaseTimestamp(value: unknown): string {
  const parsed = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Lifecycle source-action row contains an invalid timestamp."
    );
  }
  return parsed.toISOString();
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
