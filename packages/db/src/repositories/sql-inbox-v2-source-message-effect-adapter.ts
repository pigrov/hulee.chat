import {
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
import { sql } from "drizzle-orm";

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
import { verifyInboxV2SourceMessageEffectClosure } from "./sql-inbox-v2-source-message-lifecycle-adapter";
import {
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

export type InboxV2DeferredMessageEffectSourceAction =
  InboxV2DeferredMessageSourceAction &
    Readonly<{
      action: Extract<
        InboxV2DeferredMessageSourceAction["action"],
        { kind: "reaction" | "delivery" | "receipt" }
      >;
    }>;

type MessageReactionEffectProof = Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_reaction" }
>;
type MessageTransportFactEffectProof = Extract<
  InboxV2DeferredMessageSourceActionEffectProof,
  { kind: "message_transport_fact" }
>;

export type InboxV2SourceMessageEffectAdvancePlan =
  | Readonly<{
      kind: "message_reaction";
      effectProof: MessageReactionEffectProof;
      streamPosition: string;
    }>
  | Readonly<{
      kind: "message_transport_fact";
      effectProof: MessageTransportFactEffectProof;
      streamPosition: string;
    }>;

export type InboxV2SourceMessageEffectAdvancePlanResult =
  | Readonly<{
      kind: "planned";
      plan: InboxV2SourceMessageEffectAdvancePlan;
    }>
  | Readonly<{
      kind: "conflict";
      code: InboxV2SourceMessageReconciliationConflictCode;
    }>;

export type InboxV2SourceMessageEffectAdvancePlanner = Readonly<{
  planMessageEffectAdvance(
    transaction: RawSqlExecutor,
    input: Readonly<{
      reconciliationPlan: ReconciliationApplyInput["plan"] | null;
      action: InboxV2DeferredMessageEffectSourceAction;
      targetExternalMessageReference: InboxV2ExternalMessageReference;
      sourceOccurrenceResolution: InboxV2SourceOccurrenceResolutionCommit;
      recordedAt: string;
    }>
  ): Promise<InboxV2SourceMessageEffectAdvancePlanResult>;
}>;

export type InboxV2SourceMessageEffectClosure = Readonly<{
  persistEffectClosure(
    transaction: RawSqlExecutor,
    input: Readonly<{
      effectProof: MessageReactionEffectProof | MessageTransportFactEffectProof;
      envelopes: readonly InboxV2SafeGenericEnvelope[];
    }>
  ): Promise<Readonly<{ providerIoIntentCount: number }>>;
}>;

export type CreateInboxV2SourceMessageEffectCallbacksOptions = Readonly<{
  planner: InboxV2SourceMessageEffectAdvancePlanner;
  effectClosure: InboxV2SourceMessageEffectClosure;
  deriveResolutionToken(input: {
    action: InboxV2DeferredMessageEffectSourceAction;
    targetExternalMessageReference: InboxV2ExternalMessageReference;
  }): string;
  /** Test seam. Production uses transaction-local SQL/timeline primitives. */
  dependencies?: Partial<InboxV2SourceMessageEffectAdapterDependencies>;
}>;

export type InboxV2SourceMessageActionCallbacks = Pick<
  InboxV2SourceMessageReconciliationCallbacks,
  "applySourceAction" | "drainDeferredActions"
>;

export type InboxV2SourceMessageCanonicalCallbacks = Pick<
  InboxV2SourceMessageReconciliationCallbacks,
  "createMessage" | "attachOccurrence" | "resolveProviderEcho"
>;

type MessageEffectCallbacks = InboxV2SourceMessageActionCallbacks;

export type ComposeInboxV2SourceMessageActionCallbacksInput = Readonly<{
  lifecycle: InboxV2SourceMessageActionCallbacks;
  messageEffect: InboxV2SourceMessageActionCallbacks;
}>;

export type ComposeInboxV2SourceMessageReconciliationCallbacksInput =
  ComposeInboxV2SourceMessageActionCallbacksInput &
    Readonly<{
      canonical: InboxV2SourceMessageCanonicalCallbacks;
    }>;

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
type PersistMessageEffectResult = "committed" | "already_exists" | "conflict";

type InboxV2SourceMessageEffectAdapterDependencies = Readonly<{
  readDatabaseNow(transaction: RawSqlExecutor): Promise<string>;
  loadOrderingHead(
    transaction: RawSqlExecutor,
    action: InboxV2DeferredMessageEffectSourceAction
  ): Promise<InboxV2DeferredSourceActionOrderingHead | null>;
  persistOccurrenceResolution(
    transaction: RawSqlExecutor,
    commit: InboxV2SourceOccurrenceResolutionCommit
  ): Promise<PersistOccurrenceResolutionResult>;
  persistMessageEffect(
    transaction: RawSqlExecutor,
    plan: InboxV2SourceMessageEffectAdvancePlan,
    effectClosure: InboxV2SourceMessageEffectClosure
  ): Promise<PersistMessageEffectResult>;
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
 * Provider-neutral DB bridge for reaction, delivery and exact-message receipt
 * observations. It deliberately owns no provider client: an authoritative
 * advance can only append the typed planner proof and its event/projection
 * closure inside the caller-owned reconciliation transaction.
 */
export function createInboxV2SourceMessageEffectCallbacks(
  options: CreateInboxV2SourceMessageEffectCallbacksOptions
): MessageEffectCallbacks {
  const dependencies: InboxV2SourceMessageEffectAdapterDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };

  return Object.freeze({
    async applySourceAction(transaction, input) {
      const action = messageEffectAction(input.plan.intent.deferredAction);
      if (action === null) return callbackConflict(CALLBACK_CONFLICT);
      const recordedAt = await dependencies.readDatabaseNow(transaction);
      const currentHead = await dependencies.loadOrderingHead(
        transaction,
        action
      );
      const processed = await processMessageEffectAction({
        transaction,
        action,
        targetExternalMessageReference: input.targetExternalMessageReference,
        reconciliationPlan: input.plan,
        recordedAt,
        currentHead,
        options,
        dependencies
      });
      return processed.result;
    },

    async drainDeferredActions(transaction, input) {
      const actions = input.actions.map(messageEffectAction);
      if (actions.some((action) => action === null)) {
        return callbackConflict(CALLBACK_CONFLICT);
      }
      const messageEffectActions =
        actions as InboxV2DeferredMessageEffectSourceAction[];
      if (
        new Set(messageEffectActions.map((action) => action.id)).size !==
        messageEffectActions.length
      ) {
        return callbackConflict(DEFERRED_ACTION_CONFLICT);
      }

      const ordered = [...messageEffectActions].sort(compareDrainActions);
      const recordedAt = await dependencies.readDatabaseNow(transaction);
      const currentHeadByPartition = new Map<
        string,
        InboxV2DeferredSourceActionOrderingHead | null
      >();
      const resultById = new Map<string, InboxV2SourceMessageActionResult>();

      for (const action of ordered) {
        const partition = orderingPartitionKey(action);
        let currentHead = currentHeadByPartition.get(partition);
        if (!currentHeadByPartition.has(partition)) {
          currentHead = await dependencies.loadOrderingHead(
            transaction,
            action
          );
          currentHeadByPartition.set(partition, currentHead);
        }
        const processed = await processMessageEffectAction({
          transaction,
          action,
          targetExternalMessageReference: input.targetExternalMessageReference,
          reconciliationPlan: null,
          recordedAt,
          currentHead: currentHead ?? null,
          options,
          dependencies
        });
        if (processed.result.kind === "conflict") return processed.result;
        resultById.set(action.id, processed.result.result);
        currentHeadByPartition.set(partition, processed.afterOrderingHead);
      }

      const results = input.actions.map((action) => resultById.get(action.id));
      if (results.some((result) => result === undefined)) {
        return callbackConflict(CALLBACK_CONFLICT);
      }
      return {
        kind: "committed" as const,
        result: { results: results as InboxV2SourceMessageActionResult[] }
      };
    }
  });
}

/**
 * One exhaustive production callback for all deferred source Message actions.
 * The reconciliation repository therefore never needs provider- or
 * domain-specific branching: edit/delete are delegated to the lifecycle
 * adapter, while reaction/delivery/receipt are delegated to this effect
 * adapter. Mixed exact-key drains remain one caller-owned DB transaction and
 * their result order is identical to the supplied pending-action order.
 */
export function composeInboxV2SourceMessageActionCallbacks(
  input: ComposeInboxV2SourceMessageActionCallbacksInput
): InboxV2SourceMessageActionCallbacks {
  return Object.freeze({
    async applySourceAction(transaction, callbackInput) {
      const kind = callbackInput.plan.intent.deferredAction.action.kind;
      return isLifecycleActionKind(kind)
        ? input.lifecycle.applySourceAction(transaction, callbackInput)
        : input.messageEffect.applySourceAction(transaction, callbackInput);
    },

    async drainDeferredActions(transaction, callbackInput) {
      if (
        new Set(callbackInput.actions.map((action) => action.id)).size !==
        callbackInput.actions.length
      ) {
        return callbackConflict(DEFERRED_ACTION_CONFLICT);
      }
      const lifecycleActions = callbackInput.actions.filter((action) =>
        isLifecycleActionKind(action.action.kind)
      );
      const messageEffectActions = callbackInput.actions.filter(
        (action) => !isLifecycleActionKind(action.action.kind)
      );
      const resultByActionId = new Map<
        string,
        InboxV2SourceMessageActionResult
      >();

      for (const [callbacks, actions] of [
        [input.lifecycle, lifecycleActions],
        [input.messageEffect, messageEffectActions]
      ] as const) {
        if (actions.length === 0) continue;
        const result = await callbacks.drainDeferredActions(transaction, {
          targetExternalMessageReference:
            callbackInput.targetExternalMessageReference,
          actions
        });
        if (result.kind === "conflict") return result;
        if (result.result.results.length !== actions.length) {
          return callbackConflict(CALLBACK_CONFLICT);
        }
        for (const [index, action] of actions.entries()) {
          const actionResult = result.result.results[index];
          if (actionResult?.deferredAction.id !== action.id) {
            return callbackConflict(CALLBACK_CONFLICT);
          }
          resultByActionId.set(action.id, actionResult);
        }
      }

      const results = callbackInput.actions.map((action) =>
        resultByActionId.get(action.id)
      );
      if (results.some((result) => result === undefined)) {
        return callbackConflict(CALLBACK_CONFLICT);
      }
      return {
        kind: "committed" as const,
        result: {
          results: results as InboxV2SourceMessageActionResult[]
        }
      };
    }
  });
}

/**
 * Completes the production SRC-006 callback surface without weakening its
 * ambient-transaction boundary. Canonical Message creation/attachment remains
 * owned by the caller-supplied provider-neutral adapter; lifecycle and Message
 * effects retain the exhaustive routers above. Every callback receives the
 * exact transaction opened by the reconciliation repository.
 */
export function composeInboxV2SourceMessageReconciliationCallbacks(
  input: ComposeInboxV2SourceMessageReconciliationCallbacksInput
): InboxV2SourceMessageReconciliationCallbacks {
  const actions = composeInboxV2SourceMessageActionCallbacks(input);
  return Object.freeze({
    createMessage(transaction, callbackInput) {
      return input.canonical.createMessage(transaction, callbackInput);
    },
    attachOccurrence(transaction, callbackInput) {
      return input.canonical.attachOccurrence(transaction, callbackInput);
    },
    ...(input.canonical.resolveProviderEcho === undefined
      ? {}
      : {
          resolveProviderEcho(
            transaction: RawSqlExecutor,
            callbackInput: Parameters<
              NonNullable<
                InboxV2SourceMessageReconciliationCallbacks["resolveProviderEcho"]
              >
            >[1]
          ) {
            return input.canonical.resolveProviderEcho!(
              transaction,
              callbackInput
            );
          }
        }),
    applySourceAction(transaction, callbackInput) {
      return actions.applySourceAction(transaction, callbackInput);
    },
    drainDeferredActions(transaction, callbackInput) {
      return actions.drainDeferredActions(transaction, callbackInput);
    }
  });
}

function isLifecycleActionKind(
  kind: InboxV2DeferredMessageSourceAction["action"]["kind"]
): kind is "edit" | "delete" {
  return kind === "edit" || kind === "delete";
}

type ProcessMessageEffectActionInput = Readonly<{
  transaction: RawSqlExecutor;
  action: InboxV2DeferredMessageEffectSourceAction;
  targetExternalMessageReference: InboxV2ExternalMessageReference;
  reconciliationPlan: ReconciliationApplyInput["plan"] | null;
  recordedAt: string;
  currentHead: InboxV2DeferredSourceActionOrderingHead | null;
  options: CreateInboxV2SourceMessageEffectCallbacksOptions;
  dependencies: InboxV2SourceMessageEffectAdapterDependencies;
}>;

async function processMessageEffectAction(
  input: ProcessMessageEffectActionInput
) {
  const decision = classifyInboxV2DeferredSourceActionOrdering({
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

  let advancePlan: InboxV2SourceMessageEffectAdvancePlan | null = null;
  if (decision.kind === "advance") {
    if (resolution === null) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Message-effect advance lost its exact SourceOccurrence resolution."
      );
    }
    const planned = await input.options.planner.planMessageEffectAdvance(
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

  const commit = buildMessageEffectTerminalCommit({
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
    (await input.dependencies.persistMessageEffect(
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

type BuildMessageEffectTerminalCommitInput = Readonly<{
  action: InboxV2DeferredMessageEffectSourceAction;
  targetExternalMessageReference: InboxV2ExternalMessageReference;
  sourceOccurrenceResolution: InboxV2SourceOccurrenceResolutionCommit | null;
  decision: Exclude<
    ReturnType<typeof classifyInboxV2DeferredSourceActionOrdering>,
    { kind: "already_exists" }
  >;
  beforeOrderingHead: InboxV2DeferredSourceActionOrderingHead | null;
  advancePlan: InboxV2SourceMessageEffectAdvancePlan | null;
  recordedAt: string;
}>;

function buildMessageEffectTerminalCommit(
  input: BuildMessageEffectTerminalCommitInput
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

function terminalState(input: BuildMessageEffectTerminalCommitInput) {
  const { decision, recordedAt } = input;
  if (decision.kind === "advance") {
    if (input.advancePlan === null) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Message-effect advance requires one typed domain effect."
      );
    }
    const facts = messageEffectFacts(input.advancePlan.effectProof);
    if (facts.recordedAt !== recordedAt) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Message effect and terminal source action must share one database timestamp."
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

function messageEffectFacts(
  effect: MessageReactionEffectProof | MessageTransportFactEffectProof
) {
  return effect.kind === "message_reaction"
    ? {
        messageRevision: effect.commit.beforeMessage.revision,
        recordedAt: effect.commit.transition.recordedAt
      }
    : {
        messageRevision: effect.commit.beforeMessage.revision,
        recordedAt: effect.commit.committedAt
      };
}

function advanceOrderingHead(
  action: InboxV2DeferredMessageEffectSourceAction,
  before: InboxV2DeferredSourceActionOrderingHead | null,
  recordedAt: string
): InboxV2DeferredSourceActionOrderingHead {
  const ordering = action.semanticProof.ordering;
  if (ordering.kind !== "monotonic_exact") {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Only exact monotonic provider order can advance a message-effect head."
    );
  }
  return inboxV2DeferredSourceActionOrderingHeadSchema.parse({
    tenantId: action.tenantId,
    externalMessageKey: action.externalMessageKey,
    lane: action.action.kind,
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
    action: InboxV2DeferredMessageEffectSourceAction;
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
  candidate: InboxV2SourceMessageEffectAdvancePlan
): InboxV2SourceMessageEffectAdvancePlan {
  const effectProof = inboxV2DeferredMessageSourceActionEffectProofSchema.parse(
    candidate.effectProof
  );
  if (effectProof.kind !== candidate.kind) {
    throw new InboxV2TimelineMessagePersistenceInvariantError(
      "Message-effect advance plan kind does not match its typed effect proof."
    );
  }
  const streamPosition = inboxV2BigintCounterSchema.parse(
    candidate.streamPosition
  );
  return candidate.kind === "message_reaction"
    ? {
        ...candidate,
        effectProof: effectProof as MessageReactionEffectProof,
        streamPosition
      }
    : {
        ...candidate,
        effectProof: effectProof as MessageTransportFactEffectProof,
        streamPosition
      };
}

function messageEffectAction(
  action: InboxV2DeferredMessageSourceAction
): InboxV2DeferredMessageEffectSourceAction | null {
  return action.action.kind === "reaction" ||
    action.action.kind === "delivery" ||
    action.action.kind === "receipt"
    ? (action as InboxV2DeferredMessageEffectSourceAction)
    : null;
}

function compareDrainActions(
  left: InboxV2DeferredMessageEffectSourceAction,
  right: InboxV2DeferredMessageEffectSourceAction
): number {
  const partition = orderingPartitionKey(left).localeCompare(
    orderingPartitionKey(right)
  );
  if (partition !== 0) return partition;
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
  return left.id.localeCompare(right.id);
}

function orderingPartitionKey(
  action: InboxV2DeferredMessageEffectSourceAction
): string {
  const ordering = action.semanticProof.ordering;
  return ordering.kind === "monotonic_exact"
    ? `${action.action.kind}\u0000${ordering.scopeToken}\u0000${ordering.comparatorId}\u0000${ordering.comparatorRevision}`
    : `${action.action.kind}\u0000non-monotonic\u0000${action.id}`;
}

function callbackConflict(
  code: InboxV2SourceMessageReconciliationConflictCode
) {
  return { kind: "conflict" as const, code };
}

const defaultDependencies: InboxV2SourceMessageEffectAdapterDependencies = {
  async readDatabaseNow(transaction) {
    const result = await transaction.execute<{ now: unknown }>(
      sql`select transaction_timestamp() as now`
    );
    if (result.rows.length !== 1) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Message-effect source-action database clock did not return one row."
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
        "Message-effect source-action ordering-head lookup exceeded one row."
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

  async persistMessageEffect(transaction, plan, effectClosure) {
    const repository = defaultDependencies.createTimelineRepository(
      transactionBoundTimelineExecutor(transaction)
    );
    const result =
      plan.kind === "message_reaction"
        ? await repository.applyReaction({
            commit: plan.effectProof.commit,
            streamPosition: inboxV2BigintCounterSchema.parse(
              plan.streamPosition
            )
          })
        : await repository.appendTransportFact({
            commit: plan.effectProof.commit,
            streamPosition: inboxV2BigintCounterSchema.parse(
              plan.streamPosition
            )
          });
    if (result.kind === "already_applied") {
      await verifyInboxV2SourceMessageEffectClosure(transaction, [
        result.envelope
      ]);
      return "already_exists";
    }
    if (result.kind !== "appended") return "conflict";
    const closure = await effectClosure.persistEffectClosure(transaction, {
      effectProof: plan.effectProof,
      envelopes: [result.envelope]
    });
    if (closure.providerIoIntentCount !== 0) {
      throw new InboxV2TimelineMessagePersistenceInvariantError(
        "Provider-observed reaction/transport effects cannot enqueue provider I/O."
      );
    }
    await verifyInboxV2SourceMessageEffectClosure(transaction, [
      result.envelope
    ]);
    return "committed";
  },

  commitDeferredAction: commitInboxV2DeferredMessageSourceActionInTransaction,
  createTimelineRepository: createSqlInboxV2TimelineMessageRepository
};

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
      "Message-effect source-action row contains an invalid bigint."
    );
  }
}

function databaseTimestamp(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  throw new InboxV2TimelineMessagePersistenceInvariantError(
    "Message-effect source-action row contains an invalid timestamp."
  );
}

function sameCanonicalValue(left: unknown, right: unknown): boolean {
  return canonicalJson(left) === canonicalJson(right);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}
