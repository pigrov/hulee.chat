import { createHash } from "node:crypto";

import {
  inboxV2DeferredMessageSourceActionCommitSchema,
  inboxV2DeferredMessageSourceActionSchema,
  inboxV2DeferredMessageSourceActionStateSchema,
  inboxV2DeferredSourceActionOrderingHeadSchema,
  inboxV2ExternalMessageKeySchema,
  inboxV2ExternalMessageReferenceSchema,
  inboxV2MessageTransportOccurrenceLinkSchema,
  inboxV2ProviderOrderingPositionSchema,
  inboxV2SourceMessageReconciliationPlanSchema,
  inboxV2TenantIdSchema,
  type InboxV2AdapterContractSnapshot,
  type InboxV2DeferredMessageSourceAction,
  type InboxV2DeferredSourceActionOrderingHead,
  type InboxV2ExternalMessageKey,
  type InboxV2ExternalMessageReference,
  type InboxV2MessageTransportOccurrenceLink,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import {
  computeInboxV2ExternalMessageKeyDigest,
  findInboxV2ExternalMessageReferenceCandidatesInTransaction
} from "./sql-inbox-v2-outbound-transport-repository";
import { readInboxV2SourceOccurrenceInTransaction } from "./sql-inbox-v2-source-occurrence-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const RECONCILIATION_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const RECONCILIATION_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const RECONCILE_INPUT_KEYS = new Set(["plan"]);
const DEFAULT_DEFERRED_ACTION_PAGE_LIMIT = 100;
const MAX_DEFERRED_ACTION_PAGE_LIMIT = 100;
const MAX_WEAK_CORRELATION_EVIDENCE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type InboxV2DeferredMessageSourceActionCommit = ReturnType<
  typeof inboxV2DeferredMessageSourceActionCommitSchema.parse
>;

export type InboxV2SourceMessageReconciliationConflictCode =
  | "source.message_reconciliation.occurrence_missing"
  | "source.message_reconciliation.occurrence_conflict"
  | "source.message_reconciliation.occurrence_terminal_conflict"
  | "source.message_reconciliation.message_key_digest_collision"
  | "source.message_reconciliation.candidate_reference_conflict"
  | "source.message_reconciliation.adapter_surface_conflict"
  | "source.message_reconciliation.external_reference_conflict"
  | "source.message_reconciliation.weak_correlation_evidence_conflict"
  | "source.message_reconciliation.deferred_action_conflict"
  | "source.message_reconciliation.callback_conflict";

export type InboxV2SourceMessageCanonicalResult = Readonly<{
  externalMessageReference: InboxV2ExternalMessageReference;
  sourceOccurrence: InboxV2SourceOccurrence;
}>;

export type InboxV2SourceMessageActionResult =
  InboxV2SourceMessageCanonicalResult &
    Readonly<{ deferredAction: InboxV2DeferredMessageSourceAction }>;

export type InboxV2SourceMessageReconciliationCallbackResult<TResult> =
  | Readonly<{ kind: "committed"; result: TResult }>
  | Readonly<{
      /**
       * Conflict means that the callback performed no write. After any write
       * it must throw so the enclosing transaction rolls back. Callbacks are
       * idempotent because SQL serialization/deadlock retry repeats the whole
       * transaction.
       */
      kind: "conflict";
      code: InboxV2SourceMessageReconciliationConflictCode;
    }>;

export type InboxV2SourceMessageReconciliationResult =
  | (InboxV2SourceMessageCanonicalResult &
      Readonly<{
        kind: "message_created";
        deferredDrain: InboxV2DeferredSourceActionDrainSummary;
      }>)
  | (InboxV2SourceMessageCanonicalResult &
      Readonly<{
        kind: "occurrence_attached" | "echo_handoff";
      }>)
  | (InboxV2SourceMessageActionResult &
      Readonly<{ kind: "source_action_processed" }>)
  | Readonly<{
      kind: "source_action_deferred";
      action: InboxV2DeferredMessageSourceAction;
      replayed: boolean;
      retainedOccurrence: InboxV2SourceOccurrence;
    }>
  | Readonly<{
      kind: "source_action_terminal";
      action: InboxV2DeferredMessageSourceAction;
      retainedOccurrence: InboxV2SourceOccurrence;
    }>
  | Readonly<{
      kind: "echo_handoff_pending";
      messageKey: InboxV2ExternalMessageKey;
      candidateExternalMessageReferenceId: string;
      retainedOccurrence: InboxV2SourceOccurrence;
    }>
  | (InboxV2SourceMessageCanonicalResult &
      Readonly<{ kind: "already_reconciled" }>)
  | Readonly<{
      kind: "conflict";
      code: InboxV2SourceMessageReconciliationConflictCode;
      retainedOccurrence: InboxV2SourceOccurrence | null;
    }>;

export type InboxV2DeferredSourceActionDrainSummary = Readonly<{
  processedActionIds: readonly string[];
  hasMore: boolean;
  nextAfterActionId: string | null;
}>;

export type ReconcileInboxV2SourceMessageInput = Readonly<{
  plan: InboxV2SourceMessageReconciliationPlan;
}>;

export type ListPendingInboxV2DeferredMessageSourceActionsInput = Readonly<{
  tenantId: string;
  externalMessageKey: InboxV2ExternalMessageKey;
  afterActionId?: string | null;
  limit?: number;
}>;

export type ListPendingInboxV2DeferredMessageSourceActionsResult =
  | Readonly<{
      kind: "page";
      actions: readonly InboxV2DeferredMessageSourceAction[];
      hasMore: boolean;
      nextAfterActionId: string | null;
    }>
  | Readonly<{
      kind: "digest_collision";
      actions: readonly [];
      hasMore: false;
      nextAfterActionId: null;
    }>;

export type CommitInboxV2DeferredMessageSourceActionResult =
  | Readonly<{
      kind: "committed" | "already_exists";
      action: InboxV2DeferredMessageSourceAction;
    }>
  | Readonly<{
      kind:
        | "action_not_found"
        | "action_revision_conflict"
        | "ordering_head_conflict"
        | "transition_conflict"
        | "candidate_conflict";
    }>;

export type InboxV2SourceMessageReconciliationTransactionExecutor =
  RawSqlExecutor & {
    transaction<TResult>(
      work: (transaction: RawSqlExecutor) => Promise<TResult>,
      config: Readonly<{ isolationLevel: "read committed" }>
    ): Promise<TResult>;
  };

export type InboxV2SourceMessageReconciliationRepository = Readonly<{
  reconcile(
    input: ReconcileInboxV2SourceMessageInput
  ): Promise<InboxV2SourceMessageReconciliationResult>;
  listPendingByExactKey(
    input: ListPendingInboxV2DeferredMessageSourceActionsInput
  ): Promise<ListPendingInboxV2DeferredMessageSourceActionsResult>;
}>;

export type InboxV2SourceMessageReconciliationPlanAuthorizationVerifier =
  Readonly<{
    verify(plan: InboxV2SourceMessageReconciliationPlan): boolean;
  }>;

export type InboxV2SourceMessageReconciliationCallbacks = Readonly<{
  /** Database-only callback. Provider/network I/O is outside this transaction. */
  createMessage(
    transaction: RawSqlExecutor,
    input: Readonly<{
      plan: ExtractPlan<"message_create">;
      candidateExternalMessageReference: InboxV2ExternalMessageReference;
    }>
  ): Promise<
    InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageCanonicalResult>
  >;
  /** Attaches one distinct occurrence to an immutable canonical Message. */
  attachOccurrence(
    transaction: RawSqlExecutor,
    input: Readonly<{
      plan: ExtractPlan<"message_create" | "echo_handoff">;
      targetExternalMessageReference: InboxV2ExternalMessageReference;
      reason: "exact_message_reuse" | "echo_handoff";
    }>
  ): Promise<
    InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageCanonicalResult>
  >;
  /**
   * Induces and terminally commits one exact-key lifecycle/source action using
   * the transaction-local persistence helpers; returning an in-memory action
   * without its durable transition/head is rejected.
   */
  applySourceAction(
    transaction: RawSqlExecutor,
    input: Readonly<{
      plan: ExtractPlan<"source_action">;
      targetExternalMessageReference: InboxV2ExternalMessageReference;
    }>
  ): Promise<
    InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageActionResult>
  >;
  /**
   * Bounded DB-only drain after a new exact reference is created. The callback
   * persists each supplied action terminally (normally through
   * commitDeferredActionInTransaction) and returns those persisted after rows.
   */
  drainDeferredActions(
    transaction: RawSqlExecutor,
    input: Readonly<{
      targetExternalMessageReference: InboxV2ExternalMessageReference;
      actions: readonly InboxV2DeferredMessageSourceAction[];
    }>
  ): Promise<
    InboxV2SourceMessageReconciliationCallbackResult<
      Readonly<{ results: readonly InboxV2SourceMessageActionResult[] }>
    >
  >;
}>;

type ExtractPlan<
  TKind extends InboxV2SourceMessageReconciliationPlan["intent"]["kind"]
> = InboxV2SourceMessageReconciliationPlan &
  Readonly<{
    intent: Extract<
      InboxV2SourceMessageReconciliationPlan["intent"],
      { kind: TKind }
    >;
  }>;

export type PersistInboxV2DeferredMessageSourceActionResult =
  | Readonly<{
      kind: "created";
      action: InboxV2DeferredMessageSourceAction;
    }>
  | Readonly<{
      kind: "already_exists";
      action: InboxV2DeferredMessageSourceAction;
    }>
  | Readonly<{ kind: "action_id_conflict" }>
  | Readonly<{ kind: "idempotency_conflict" }>;

type ReconciliationDependencies = Readonly<{
  computeMessageKeyDigest(key: InboxV2ExternalMessageKey): string;
  acquireMessageKeyLock(
    transaction: RawSqlExecutor,
    input: Readonly<{ tenantId: string; keyDigest: string }>
  ): Promise<void>;
  registerMessageKey(
    transaction: RawSqlExecutor,
    input: Readonly<{
      tenantId: string;
      keyDigest: string;
      externalMessageKey: InboxV2ExternalMessageKey;
    }>
  ): Promise<"registered" | "already_exists" | "digest_collision">;
  readOccurrence(
    transaction: RawSqlExecutor,
    input: Readonly<{ tenantId: string; occurrenceId: string }>,
    options: Readonly<{ lock: boolean }>
  ): Promise<InboxV2SourceOccurrence | null>;
  findReferenceCandidates(
    transaction: RawSqlExecutor,
    input: Readonly<{
      tenantId: string;
      referenceId: string;
      keyDigest: string;
    }>
  ): Promise<readonly InboxV2ExternalMessageReference[]>;
  findTransportLinkCandidates(
    transaction: RawSqlExecutor,
    input: Readonly<{
      tenantId: string;
      linkId: string;
      sourceOccurrenceId: string;
    }>
  ): Promise<readonly InboxV2MessageTransportOccurrenceLink[]>;
  persistDeferredAction(
    transaction: RawSqlExecutor,
    action: InboxV2DeferredMessageSourceAction
  ): Promise<PersistInboxV2DeferredMessageSourceActionResult>;
  persistWeakCorrelationEvidence(
    transaction: RawSqlExecutor,
    plan: InboxV2SourceMessageReconciliationPlan
  ): Promise<"created" | "already_exists" | "conflict">;
  listPendingActions(
    transaction: RawSqlExecutor,
    input: ListPendingInboxV2DeferredMessageSourceActionsInput &
      Readonly<{ keyDigest: string; limit: number }>
  ): Promise<ListPendingInboxV2DeferredMessageSourceActionsResult>;
  readDeferredAction(
    transaction: RawSqlExecutor,
    input: Readonly<{ tenantId: string; actionId: string; lock: boolean }>
  ): Promise<InboxV2DeferredMessageSourceAction | null>;
}>;

export type CreateSqlInboxV2SourceMessageReconciliationRepositoryOptions =
  Readonly<{
    planAuthorizationVerifier: InboxV2SourceMessageReconciliationPlanAuthorizationVerifier;
    callbacks: InboxV2SourceMessageReconciliationCallbacks;
    /** Test seam; production uses the transaction-local SQL helpers. */
    dependencies?: Partial<ReconciliationDependencies>;
  }>;

export type InboxV2ExternalMessageReferenceDecision =
  | Readonly<{ kind: "missing" }>
  | Readonly<{
      kind: "found";
      reference: InboxV2ExternalMessageReference;
    }>
  | Readonly<{
      kind: "conflict";
      code:
        | "source.message_reconciliation.message_key_digest_collision"
        | "source.message_reconciliation.candidate_reference_conflict"
        | "source.message_reconciliation.adapter_surface_conflict"
        | "source.message_reconciliation.external_reference_conflict";
    }>;

const defaultDependencies: ReconciliationDependencies = {
  computeMessageKeyDigest: computeInboxV2ExternalMessageKeyDigest,
  async acquireMessageKeyLock(transaction, input) {
    await transaction.execute(
      buildAcquireInboxV2SourceMessageKeyLockSql(input)
    );
  },
  registerMessageKey: registerInboxV2SourceMessageKeyInTransaction,
  readOccurrence: readInboxV2SourceOccurrenceInTransaction,
  findReferenceCandidates:
    findInboxV2ExternalMessageReferenceCandidatesInTransaction,
  findTransportLinkCandidates:
    findInboxV2MessageTransportOccurrenceLinkCandidatesInTransaction,
  persistDeferredAction: persistInboxV2DeferredMessageSourceActionInTransaction,
  persistWeakCorrelationEvidence:
    persistInboxV2SourceMessageWeakCorrelationEvidenceInTransaction,
  listPendingActions:
    listPendingInboxV2DeferredMessageSourceActionsInTransaction,
  readDeferredAction: readInboxV2DeferredMessageSourceActionInTransaction
};

export function createSqlInboxV2SourceMessageReconciliationRepository(
  executor:
    | InboxV2SourceMessageReconciliationTransactionExecutor
    | HuleeDatabase,
  options: CreateSqlInboxV2SourceMessageReconciliationRepositoryOptions
): InboxV2SourceMessageReconciliationRepository {
  const transactionExecutor =
    executor as unknown as InboxV2SourceMessageReconciliationTransactionExecutor;
  const dependencies: ReconciliationDependencies = {
    ...defaultDependencies,
    ...options.dependencies
  };

  return {
    async reconcile(input) {
      const normalized = normalizeReconcileInput(input);
      if (
        !isPlanAuthorized(options.planAuthorizationVerifier, normalized.plan)
      ) {
        throw new CoreError(
          "permission.denied",
          "Inbox V2 source message reconciliation plan authorization failed."
        );
      }
      return runReconciliationTransaction(transactionExecutor, (transaction) =>
        reconcileInTransaction(
          transaction,
          normalized.plan,
          options.callbacks,
          dependencies
        )
      );
    },
    async listPendingByExactKey(input) {
      const normalized = normalizePendingActionPageInput(input);
      const keyDigest = dependencies.computeMessageKeyDigest(
        normalized.externalMessageKey
      );
      return runReconciliationTransaction(
        transactionExecutor,
        async (transaction) => {
          await dependencies.acquireMessageKeyLock(transaction, {
            tenantId: normalized.tenantId,
            keyDigest
          });
          return dependencies.listPendingActions(transaction, {
            ...normalized,
            keyDigest,
            limit: normalized.limit ?? DEFAULT_DEFERRED_ACTION_PAGE_LIMIT
          });
        }
      );
    }
  };
}

async function reconcileInTransaction(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  callbacks: InboxV2SourceMessageReconciliationCallbacks,
  dependencies: ReconciliationDependencies
): Promise<InboxV2SourceMessageReconciliationResult> {
  const keyDigest = dependencies.computeMessageKeyDigest(plan.messageKey);
  await dependencies.acquireMessageKeyLock(transaction, {
    tenantId: plan.sourceOccurrence.tenantId,
    keyDigest
  });

  // Reconciliation owns the occurrence resolution row for the remainder of
  // the transaction. Every callback receives only the same SQL transaction.
  const persistedOccurrence = await dependencies.readOccurrence(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      occurrenceId: plan.sourceOccurrence.id
    },
    { lock: true }
  );
  if (persistedOccurrence === null) {
    return conflict("source.message_reconciliation.occurrence_missing", null);
  }
  if (
    !sameInboxV2SourceOccurrenceStableFacts(
      persistedOccurrence,
      plan.sourceOccurrence
    )
  ) {
    return conflict(
      "source.message_reconciliation.occurrence_conflict",
      persistedOccurrence
    );
  }

  const weakEvidence = await dependencies.persistWeakCorrelationEvidence(
    transaction,
    plan
  );
  if (weakEvidence === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(
        "source.message_reconciliation.weak_correlation_evidence_conflict",
        persistedOccurrence
      )
    );
  }

  const referenceCandidates = await dependencies.findReferenceCandidates(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      referenceId: plan.candidateExternalMessageReferenceId,
      keyDigest
    }
  );
  const decision = classifyInboxV2ExternalMessageReferenceCandidates({
    plan,
    candidates: referenceCandidates
  });
  if (decision.kind === "conflict") {
    return conflict(decision.code, persistedOccurrence);
  }
  const keyRegistration = await dependencies.registerMessageKey(transaction, {
    tenantId: plan.sourceOccurrence.tenantId,
    keyDigest,
    externalMessageKey: plan.messageKey
  });
  if (keyRegistration === "digest_collision") {
    return conflict(
      "source.message_reconciliation.message_key_digest_collision",
      persistedOccurrence
    );
  }

  let inducedSourceAction: Extract<
    PersistInboxV2DeferredMessageSourceActionResult,
    { kind: "created" | "already_exists" }
  > | null = null;
  if (plan.intent.kind === "source_action") {
    // Exact action induction/replay is part of the terminal occurrence proof.
    // A resolved occurrence alone cannot acknowledge a different signed action.
    const induced = await dependencies.persistDeferredAction(
      transaction,
      plan.intent.deferredAction
    );
    if (
      induced.kind === "action_id_conflict" ||
      induced.kind === "idempotency_conflict"
    ) {
      return conflict(
        "source.message_reconciliation.deferred_action_conflict",
        persistedOccurrence
      );
    }
    if (
      !sameDeferredActionStableFacts(
        induced.action,
        plan.intent.deferredAction
      ) ||
      (induced.action.state.state === "pending" &&
        !sameValue(induced.action, plan.intent.deferredAction))
    ) {
      throw new ReconciliationCallbackRollback(
        conflict(
          "source.message_reconciliation.deferred_action_conflict",
          persistedOccurrence
        )
      );
    }
    inducedSourceAction = induced;
  }

  if (persistedOccurrence.resolution.state !== "pending") {
    if (
      persistedOccurrence.resolution.state === "resolved" &&
      decision.kind === "found" &&
      persistedOccurrence.resolution.externalMessageReference.id ===
        decision.reference.id
    ) {
      if (plan.intent.kind === "source_action") {
        if (
          inducedSourceAction === null ||
          inducedSourceAction.kind !== "already_exists" ||
          inducedSourceAction.action.state.state === "pending" ||
          (inducedSourceAction.action.state.state === "applied" &&
            inducedSourceAction.action.state.externalMessageReference.id !==
              decision.reference.id)
        ) {
          throw new ReconciliationCallbackRollback(
            conflict(
              "source.message_reconciliation.deferred_action_conflict",
              persistedOccurrence
            )
          );
        }
        return {
          kind: "source_action_processed",
          externalMessageReference: decision.reference,
          sourceOccurrence: persistedOccurrence,
          deferredAction: inducedSourceAction.action
        };
      }
      const transportLinkValid = await validateTransportLinkPersistence(
        transaction,
        plan,
        decision.reference,
        "terminal_replay",
        dependencies
      );
      if (!transportLinkValid) {
        return conflict(
          "source.message_reconciliation.callback_conflict",
          persistedOccurrence
        );
      }
      return {
        kind: "already_reconciled",
        externalMessageReference: decision.reference,
        sourceOccurrence: persistedOccurrence
      };
    }
    return conflict(
      "source.message_reconciliation.occurrence_terminal_conflict",
      persistedOccurrence
    );
  }
  if (!sameValue(persistedOccurrence, plan.sourceOccurrence)) {
    return conflict(
      "source.message_reconciliation.occurrence_conflict",
      persistedOccurrence
    );
  }

  if (plan.intent.kind === "message_create") {
    const messagePlan = plan as ExtractPlan<"message_create">;
    if (decision.kind === "missing") {
      const candidate = buildCandidateExternalMessageReference(messagePlan);
      const callback = await invokeReconciliationCallback(
        () =>
          callbacks.createMessage(transaction, {
            plan: messagePlan,
            candidateExternalMessageReference: candidate
          }),
        persistedOccurrence
      );
      return finalizeMessageCreateCallback(
        transaction,
        plan,
        callback,
        candidate,
        callbacks,
        dependencies
      );
    }
    const callback = await invokeReconciliationCallback(
      () =>
        callbacks.attachOccurrence(transaction, {
          plan: messagePlan,
          targetExternalMessageReference: decision.reference,
          reason: "exact_message_reuse"
        }),
      persistedOccurrence
    );
    return finalizeCanonicalCallback(
      transaction,
      plan,
      callback,
      "occurrence_attached",
      decision.reference,
      "occurrence_attached",
      dependencies
    );
  }

  if (plan.intent.kind === "echo_handoff") {
    const echoPlan = plan as ExtractPlan<"echo_handoff">;
    if (decision.kind === "missing") {
      return {
        kind: "echo_handoff_pending",
        messageKey: plan.messageKey,
        candidateExternalMessageReferenceId:
          plan.candidateExternalMessageReferenceId,
        retainedOccurrence: persistedOccurrence
      };
    }
    const callback = await invokeReconciliationCallback(
      () =>
        callbacks.attachOccurrence(transaction, {
          plan: echoPlan,
          targetExternalMessageReference: decision.reference,
          reason: "echo_handoff"
        }),
      persistedOccurrence
    );
    return finalizeCanonicalCallback(
      transaction,
      plan,
      callback,
      "echo_handoff",
      decision.reference,
      "echo_handoff",
      dependencies
    );
  }

  const actionPlan = plan as ExtractPlan<"source_action">;
  if (inducedSourceAction === null) {
    throw new InboxV2PersistenceInvariantError(
      "Source-action reconciliation reached dispatch without durable induction."
    );
  }
  const induced = inducedSourceAction;
  if (induced.action.state.state !== "pending") {
    if (
      induced.action.state.state === "applied" &&
      (decision.kind !== "found" ||
        induced.action.state.externalMessageReference.id !==
          decision.reference.id)
    ) {
      return conflict(
        "source.message_reconciliation.deferred_action_conflict",
        persistedOccurrence
      );
    }
    if (decision.kind === "missing") {
      return {
        kind: "source_action_terminal",
        action: induced.action,
        retainedOccurrence: persistedOccurrence
      };
    }
    return {
      kind: "source_action_processed",
      externalMessageReference: decision.reference,
      sourceOccurrence: persistedOccurrence,
      deferredAction: induced.action
    };
  }

  if (decision.kind === "missing") {
    return {
      kind: "source_action_deferred",
      action: induced.action,
      replayed: induced.kind === "already_exists",
      retainedOccurrence: persistedOccurrence
    };
  }

  const callback = await invokeReconciliationCallback(
    () =>
      callbacks.applySourceAction(transaction, {
        plan: actionPlan,
        targetExternalMessageReference: decision.reference
      }),
    persistedOccurrence
  );
  if (callback.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(callback.code, persistedOccurrence)
    );
  }
  const actionResult = callback.result;
  if (
    !sameDeferredActionStableFacts(
      actionResult.deferredAction,
      actionPlan.intent.deferredAction
    ) ||
    actionResult.deferredAction.state.state === "pending"
  ) {
    throw new ReconciliationCallbackRollback(
      conflict(
        "source.message_reconciliation.callback_conflict",
        persistedOccurrence
      )
    );
  }
  const finalized = await validateCanonicalCallbackPersistence(
    transaction,
    plan,
    actionResult,
    decision.reference,
    dependencies,
    actionResult.deferredAction.state.state === "applied"
  );
  if (finalized.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(finalized.code, plan.sourceOccurrence)
    );
  }
  const persistedAction = await dependencies.readDeferredAction(transaction, {
    tenantId: actionResult.deferredAction.tenantId,
    actionId: actionResult.deferredAction.id,
    lock: true
  });
  if (
    persistedAction === null ||
    persistedAction.state.state === "pending" ||
    !sameValue(persistedAction, actionResult.deferredAction)
  ) {
    throw new ReconciliationCallbackRollback(
      conflict(
        "source.message_reconciliation.callback_conflict",
        persistedOccurrence
      )
    );
  }
  return {
    kind: "source_action_processed",
    externalMessageReference: decision.reference,
    sourceOccurrence: finalized.sourceOccurrence,
    deferredAction: persistedAction
  };
}

async function finalizeCanonicalCallback(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  callback: InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageCanonicalResult>,
  kind: "occurrence_attached" | "echo_handoff",
  expectedReference: InboxV2ExternalMessageReference,
  transportOutcome: "occurrence_attached" | "echo_handoff",
  dependencies: ReconciliationDependencies
): Promise<InboxV2SourceMessageReconciliationResult> {
  if (callback.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(callback.code, plan.sourceOccurrence)
    );
  }
  const finalized = await validateCanonicalCallbackPersistence(
    transaction,
    plan,
    callback.result,
    expectedReference,
    dependencies,
    true,
    transportOutcome
  );
  if (finalized.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(finalized.code, plan.sourceOccurrence)
    );
  }
  return {
    kind,
    externalMessageReference: expectedReference,
    sourceOccurrence: finalized.sourceOccurrence
  };
}

async function finalizeMessageCreateCallback(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  callback: InboxV2SourceMessageReconciliationCallbackResult<InboxV2SourceMessageCanonicalResult>,
  expectedReference: InboxV2ExternalMessageReference,
  callbacks: InboxV2SourceMessageReconciliationCallbacks,
  dependencies: ReconciliationDependencies
): Promise<InboxV2SourceMessageReconciliationResult> {
  if (callback.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(callback.code, plan.sourceOccurrence)
    );
  }
  const canonical = await validateCanonicalCallbackPersistence(
    transaction,
    plan,
    callback.result,
    expectedReference,
    dependencies,
    true,
    "message_created"
  );
  if (canonical.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(canonical.code, plan.sourceOccurrence)
    );
  }

  const keyDigest = dependencies.computeMessageKeyDigest(plan.messageKey);
  const pending = await dependencies.listPendingActions(transaction, {
    tenantId: plan.sourceOccurrence.tenantId,
    externalMessageKey: plan.messageKey,
    afterActionId: null,
    limit: DEFAULT_DEFERRED_ACTION_PAGE_LIMIT,
    keyDigest
  });
  if (pending.kind === "digest_collision") {
    throw new ReconciliationCallbackRollback(
      conflict(
        "source.message_reconciliation.message_key_digest_collision",
        plan.sourceOccurrence
      )
    );
  }
  if (pending.actions.length === 0) {
    return {
      kind: "message_created",
      externalMessageReference: expectedReference,
      sourceOccurrence: canonical.sourceOccurrence,
      deferredDrain: {
        processedActionIds: [],
        hasMore: false,
        nextAfterActionId: null
      }
    };
  }

  const drained = await invokeReconciliationCallback(
    () =>
      callbacks.drainDeferredActions(transaction, {
        targetExternalMessageReference: expectedReference,
        actions: pending.actions
      }),
    plan.sourceOccurrence
  );
  if (drained.kind === "conflict") {
    throw new ReconciliationCallbackRollback(
      conflict(drained.code, plan.sourceOccurrence)
    );
  }
  if (drained.result.results.length !== pending.actions.length) {
    throw new ReconciliationCallbackRollback(
      conflict(
        "source.message_reconciliation.callback_conflict",
        plan.sourceOccurrence
      )
    );
  }
  const processedActionIds: string[] = [];
  for (const [index, before] of pending.actions.entries()) {
    const actionResult = drained.result.results[index];
    const after = actionResult?.deferredAction;
    if (
      after === undefined ||
      after.id !== before.id ||
      !sameDeferredActionStableFacts(after, before) ||
      after.state.state === "pending"
    ) {
      throw new ReconciliationCallbackRollback(
        conflict(
          "source.message_reconciliation.callback_conflict",
          plan.sourceOccurrence
        )
      );
    }
    const drainValid = await validateDeferredDrainCallbackPersistence(
      transaction,
      before,
      actionResult,
      expectedReference,
      dependencies
    );
    if (!drainValid) {
      throw new ReconciliationCallbackRollback(
        conflict(
          "source.message_reconciliation.callback_conflict",
          plan.sourceOccurrence
        )
      );
    }
    const persisted = await dependencies.readDeferredAction(transaction, {
      tenantId: after.tenantId,
      actionId: after.id,
      lock: true
    });
    if (persisted === null || !sameValue(persisted, after)) {
      throw new ReconciliationCallbackRollback(
        conflict(
          "source.message_reconciliation.callback_conflict",
          plan.sourceOccurrence
        )
      );
    }
    processedActionIds.push(after.id);
  }
  return {
    kind: "message_created",
    externalMessageReference: expectedReference,
    sourceOccurrence: canonical.sourceOccurrence,
    deferredDrain: {
      processedActionIds,
      hasMore: pending.hasMore,
      nextAfterActionId: pending.nextAfterActionId
    }
  };
}

async function validateCanonicalCallbackPersistence(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  result: InboxV2SourceMessageCanonicalResult,
  expectedReference: InboxV2ExternalMessageReference,
  dependencies: ReconciliationDependencies,
  requireResolvedOccurrence: boolean,
  transportOutcome?: "message_created" | "occurrence_attached" | "echo_handoff"
): Promise<
  | Readonly<{ kind: "valid"; sourceOccurrence: InboxV2SourceOccurrence }>
  | Extract<InboxV2SourceMessageReconciliationResult, { kind: "conflict" }>
> {
  if (
    !sameValue(result.externalMessageReference, expectedReference) ||
    !sameInboxV2SourceOccurrenceStableFacts(
      result.sourceOccurrence,
      plan.sourceOccurrence
    )
  ) {
    return conflict(
      "source.message_reconciliation.callback_conflict",
      result.sourceOccurrence
    );
  }
  if (
    (result.sourceOccurrence.resolution.state === "resolved" &&
      !occurrenceResolvedTo(result.sourceOccurrence, expectedReference)) ||
    (requireResolvedOccurrence &&
      result.sourceOccurrence.resolution.state !== "resolved")
  ) {
    return conflict(
      "source.message_reconciliation.callback_conflict",
      result.sourceOccurrence
    );
  }

  const persistedReferences = await dependencies.findReferenceCandidates(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      referenceId: expectedReference.id,
      keyDigest: dependencies.computeMessageKeyDigest(expectedReference.key)
    }
  );
  if (
    persistedReferences.length !== 1 ||
    !sameValue(persistedReferences[0], expectedReference)
  ) {
    return conflict(
      "source.message_reconciliation.callback_conflict",
      result.sourceOccurrence
    );
  }

  const persisted = await dependencies.readOccurrence(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      occurrenceId: plan.sourceOccurrence.id
    },
    { lock: true }
  );
  if (
    persisted === null ||
    !sameValue(persisted, result.sourceOccurrence) ||
    (persisted.resolution.state === "resolved" &&
      !occurrenceResolvedTo(persisted, expectedReference)) ||
    (requireResolvedOccurrence && persisted.resolution.state !== "resolved")
  ) {
    return conflict(
      "source.message_reconciliation.callback_conflict",
      persisted
    );
  }
  if (
    transportOutcome !== undefined &&
    !(await validateTransportLinkPersistence(
      transaction,
      plan,
      expectedReference,
      transportOutcome,
      dependencies
    ))
  ) {
    return conflict(
      "source.message_reconciliation.callback_conflict",
      result.sourceOccurrence
    );
  }
  return { kind: "valid", sourceOccurrence: persisted };
}

type TransportLinkValidationOutcome =
  | "message_created"
  | "occurrence_attached"
  | "echo_handoff"
  | "terminal_replay";

async function validateTransportLinkPersistence(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan,
  expectedReference: InboxV2ExternalMessageReference,
  outcome: TransportLinkValidationOutcome,
  dependencies: ReconciliationDependencies
): Promise<boolean> {
  if (plan.intent.kind === "source_action") return true;

  const candidates = await dependencies.findTransportLinkCandidates(
    transaction,
    {
      tenantId: plan.sourceOccurrence.tenantId,
      linkId: plan.intent.candidateTransportLinkId,
      sourceOccurrenceId: plan.sourceOccurrence.id
    }
  );
  if (candidates.length !== 1) return false;
  const link = candidates[0];
  if (link === undefined) return false;

  const allowedRoles = expectedTransportLinkRoles(plan, outcome);
  return (
    link.tenantId === plan.sourceOccurrence.tenantId &&
    link.id === plan.intent.candidateTransportLinkId &&
    link.message.id === expectedReference.message.id &&
    link.sourceOccurrence.id === plan.sourceOccurrence.id &&
    link.externalMessageReference.id === expectedReference.id &&
    allowedRoles.has(link.role) &&
    link.revision === "1"
  );
}

function expectedTransportLinkRoles(
  plan: InboxV2SourceMessageReconciliationPlan,
  outcome: TransportLinkValidationOutcome
): ReadonlySet<InboxV2MessageTransportOccurrenceLink["role"]> {
  if (plan.intent.kind === "source_action") return new Set();
  if (plan.intent.kind === "echo_handoff") {
    return new Set(["provider_echo"]);
  }
  if (plan.intent.transportRole === "native_outbound") {
    return new Set(["native_outbound"]);
  }
  if (outcome === "message_created") return new Set(["origin"]);
  if (outcome === "occurrence_attached") {
    return new Set(["additional_artifact"]);
  }
  return new Set(["origin", "additional_artifact"]);
}

async function validateDeferredDrainCallbackPersistence(
  transaction: RawSqlExecutor,
  before: InboxV2DeferredMessageSourceAction,
  result: InboxV2SourceMessageActionResult,
  expectedReference: InboxV2ExternalMessageReference,
  dependencies: ReconciliationDependencies
): Promise<boolean> {
  const after = result.deferredAction;
  if (
    !sameValue(result.externalMessageReference, expectedReference) ||
    !sameInboxV2SourceOccurrenceStableFacts(
      result.sourceOccurrence,
      before.sourceOccurrence
    ) ||
    (result.sourceOccurrence.resolution.state === "resolved" &&
      !occurrenceResolvedTo(result.sourceOccurrence, expectedReference)) ||
    (after.state.state === "applied" &&
      result.sourceOccurrence.resolution.state !== "resolved")
  ) {
    return false;
  }
  const persistedOccurrence = await dependencies.readOccurrence(
    transaction,
    {
      tenantId: before.tenantId,
      occurrenceId: before.sourceOccurrence.id
    },
    { lock: true }
  );
  if (
    persistedOccurrence === null ||
    !sameValue(persistedOccurrence, result.sourceOccurrence) ||
    (persistedOccurrence.resolution.state === "resolved" &&
      !occurrenceResolvedTo(persistedOccurrence, expectedReference)) ||
    (after.state.state === "applied" &&
      persistedOccurrence.resolution.state !== "resolved")
  ) {
    return false;
  }
  const persistedReferences = await dependencies.findReferenceCandidates(
    transaction,
    {
      tenantId: before.tenantId,
      referenceId: expectedReference.id,
      keyDigest: dependencies.computeMessageKeyDigest(expectedReference.key)
    }
  );
  return (
    persistedReferences.length === 1 &&
    sameValue(persistedReferences[0], expectedReference)
  );
}

export function classifyInboxV2ExternalMessageReferenceCandidates(
  input: Readonly<{
    plan: InboxV2SourceMessageReconciliationPlan;
    candidates: readonly InboxV2ExternalMessageReference[];
  }>
): InboxV2ExternalMessageReferenceDecision {
  const { plan, candidates } = input;
  if (candidates.length === 0) return { kind: "missing" };
  if (candidates.length > 2) {
    return {
      kind: "conflict",
      code: "source.message_reconciliation.external_reference_conflict"
    };
  }

  const candidateById = candidates.find(
    (candidate) =>
      String(candidate.id) === String(plan.candidateExternalMessageReferenceId)
  );
  if (
    candidateById !== undefined &&
    !sameInboxV2ExternalMessageKey(candidateById.key, plan.messageKey)
  ) {
    return {
      kind: "conflict",
      code: "source.message_reconciliation.candidate_reference_conflict"
    };
  }

  const exact = candidates.filter((candidate) =>
    sameInboxV2ExternalMessageKey(candidate.key, plan.messageKey)
  );
  if (exact.length === 0) {
    return {
      kind: "conflict",
      code: "source.message_reconciliation.message_key_digest_collision"
    };
  }
  if (exact.length !== 1 || candidates.length !== 1) {
    return {
      kind: "conflict",
      code: "source.message_reconciliation.external_reference_conflict"
    };
  }
  const reference = exact[0]!;
  if (
    reference.tenantId !== plan.sourceOccurrence.tenantId ||
    !sameInboxV2StableAdapterSurface(
      reference.identityDeclaration.adapterContract,
      plan.sourceOccurrence.messageIdentityDeclaration.adapterContract
    )
  ) {
    return {
      kind: "conflict",
      code: "source.message_reconciliation.adapter_surface_conflict"
    };
  }
  return { kind: "found", reference };
}

export function sameInboxV2ExternalMessageKey(
  left: InboxV2ExternalMessageKey,
  right: InboxV2ExternalMessageKey
): boolean {
  return (
    left.realm.realmId === right.realm.realmId &&
    left.realm.realmVersion === right.realm.realmVersion &&
    left.realm.canonicalizationVersion ===
      right.realm.canonicalizationVersion &&
    sameMessageScope(left.scope, right.scope) &&
    left.objectKindId === right.objectKindId &&
    sameReference(left.externalThread, right.externalThread) &&
    left.canonicalExternalSubject === right.canonicalExternalSubject
  );
}

export function sameInboxV2StableAdapterSurface(
  left: InboxV2AdapterContractSnapshot,
  right: InboxV2AdapterContractSnapshot
): boolean {
  return (
    left.contractId === right.contractId &&
    left.contractVersion === right.contractVersion &&
    left.surfaceId === right.surfaceId
  );
}

export type InboxV2DeferredSourceActionOrderingDecision =
  | Readonly<{ kind: "advance" }>
  | Readonly<{
      kind: "stale";
      headAction: InboxV2DeferredSourceActionOrderingHead["latest"]["action"];
    }>
  | Readonly<{ kind: "already_exists" }>
  | Readonly<{
      kind: "duplicate";
      canonicalAction: InboxV2DeferredSourceActionOrderingHead["latest"]["action"];
    }>
  | Readonly<{
      kind: "conflict";
      conflictingAction:
        | InboxV2DeferredSourceActionOrderingHead["latest"]["action"]
        | null;
    }>;

/**
 * Provider-neutral ordering decision. Decimal positions are compared as
 * canonical text (length then C-order), so provider counters are never
 * truncated to JavaScript/PostgreSQL bigint.
 */
export function classifyInboxV2DeferredSourceActionOrdering(
  input: Readonly<{
    action: InboxV2DeferredMessageSourceAction;
    currentHead: InboxV2DeferredSourceActionOrderingHead | null;
  }>
): InboxV2DeferredSourceActionOrderingDecision {
  const { action, currentHead } = input;
  const ordering = action.semanticProof.ordering;
  if (ordering.kind === "unavailable") {
    return {
      kind: "conflict",
      conflictingAction: currentHead?.latest.action ?? null
    };
  }
  if (ordering.kind === "incomparable") {
    return {
      kind: "conflict",
      conflictingAction: currentHead?.latest.action ?? null
    };
  }
  if (currentHead === null) return { kind: "advance" };
  if (
    currentHead.tenantId !== action.tenantId ||
    !sameInboxV2ExternalMessageKey(
      currentHead.externalMessageKey,
      action.externalMessageKey
    ) ||
    currentHead.lane !== deferredActionLane(action.action.kind) ||
    currentHead.scopeToken !== ordering.scopeToken ||
    currentHead.comparatorId !== ordering.comparatorId ||
    currentHead.comparatorRevision !== ordering.comparatorRevision
  ) {
    return {
      kind: "conflict",
      conflictingAction: currentHead.latest.action
    };
  }
  const comparison = compareCanonicalDecimalPosition(
    ordering.position,
    currentHead.latest.position
  );
  if (comparison > 0) return { kind: "advance" };
  if (comparison < 0) {
    return { kind: "stale", headAction: currentHead.latest.action };
  }
  if (sameValue(currentHead.latest.idempotencyKey, action.idempotencyKey)) {
    // The deterministic action id is part of the trusted plan, even though it
    // is not one of the provider ingestion-tuple components. Reusing an exact
    // tuple under another candidate id is therefore tampering/collision, not a
    // provider semantic duplicate.
    return currentHead.latest.action.id === action.id
      ? { kind: "already_exists" }
      : {
          kind: "conflict",
          conflictingAction: currentHead.latest.action
        };
  }
  if (
    currentHead.latest.idempotencyKey.semanticId ===
      action.idempotencyKey.semanticId &&
    currentHead.latest.idempotencyKey.eventFingerprintSha256 ===
      action.idempotencyKey.eventFingerprintSha256
  ) {
    return {
      kind: "duplicate",
      canonicalAction: currentHead.latest.action
    };
  }
  return {
    kind: "conflict",
    conflictingAction: currentHead.latest.action
  };
}

export function compareCanonicalInboxV2ProviderPosition(
  left: string,
  right: string
): -1 | 0 | 1 {
  return compareCanonicalDecimalPosition(left, right);
}

function compareCanonicalDecimalPosition(
  left: string,
  right: string
): -1 | 0 | 1 {
  const parsedLeft = inboxV2ProviderOrderingPositionSchema.safeParse(left);
  const parsedRight = inboxV2ProviderOrderingPositionSchema.safeParse(right);
  if (!parsedLeft.success || !parsedRight.success) {
    throw new CoreError(
      "validation.failed",
      "Provider ordering positions must be bounded canonical non-negative decimals."
    );
  }
  if (parsedLeft.data.length !== parsedRight.data.length) {
    return parsedLeft.data.length < parsedRight.data.length ? -1 : 1;
  }
  if (parsedLeft.data === parsedRight.data) return 0;
  return parsedLeft.data < parsedRight.data ? -1 : 1;
}

export function sameInboxV2SourceOccurrenceStableFacts(
  left: InboxV2SourceOccurrence,
  right: InboxV2SourceOccurrence
): boolean {
  const stable = (occurrence: InboxV2SourceOccurrence) => ({
    ...occurrence,
    resolution: undefined,
    revision: undefined,
    updatedAt: undefined
  });
  return sameValue(stable(left), stable(right));
}

export function buildAcquireInboxV2SourceMessageKeyLockSql(
  input: Readonly<{
    tenantId: string;
    keyDigest: string;
  }>
): SQL {
  return buildInboxV2AdvisoryXactLockSql([
    "inbox-v2-source-message-key:v1",
    input.tenantId,
    input.keyDigest
  ]);
}

function buildCandidateExternalMessageReference(
  plan: ExtractPlan<"message_create">
): InboxV2ExternalMessageReference {
  return inboxV2ExternalMessageReferenceSchema.parse({
    tenantId: plan.sourceOccurrence.tenantId,
    id: plan.candidateExternalMessageReferenceId,
    key: plan.messageKey,
    identityDeclaration: plan.sourceOccurrence.messageIdentityDeclaration,
    externalThread: plan.messageKey.externalThread,
    timelineItem: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "timeline_item",
      id: plan.intent.candidateTimelineItemId
    },
    message: {
      tenantId: plan.sourceOccurrence.tenantId,
      kind: "message",
      id: plan.intent.candidateMessageId
    },
    revision: "1",
    createdAt: plan.materializedAt
  });
}

type DeferredMessageSourceActionRow = {
  tenant_id: unknown;
  id: unknown;
  external_message_key_detail: unknown;
  source_occurrence_detail: unknown;
  normalized_inbound_event_id: unknown;
  action_detail: unknown;
  semantic_proof_detail: unknown;
  semantic_id: unknown;
  event_fingerprint_sha256: unknown;
  state: unknown;
  applied_external_message_reference_id: unknown;
  applied_message_id: unknown;
  applied_message_revision: unknown;
  effect_kind: unknown;
  related_action_id: unknown;
  state_reason_id: unknown;
  conflict_candidate_count: unknown;
  conflict_candidate_digest_sha256: unknown;
  terminal_at: unknown;
  revision: unknown;
  observed_at: unknown;
  recorded_at: unknown;
  created_at: unknown;
  updated_at: unknown;
};

type MessageTransportOccurrenceLinkRow = {
  tenant_id: unknown;
  id: unknown;
  message_id: unknown;
  source_occurrence_id: unknown;
  external_message_reference_id: unknown;
  role: unknown;
  revision: unknown;
  linked_at: unknown;
};

export async function findInboxV2MessageTransportOccurrenceLinkCandidatesInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    linkId: string;
    sourceOccurrenceId: string;
  }>
): Promise<readonly InboxV2MessageTransportOccurrenceLink[]> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const result = await transaction.execute<MessageTransportOccurrenceLinkRow>(
    sql`
      select tenant_id, id, message_id, source_occurrence_id,
             external_message_reference_id, role, revision::text,
             linked_at
        from inbox_v2_message_transport_links
       where tenant_id = ${tenantId}
         and (
           id = ${input.linkId}
           or source_occurrence_id = ${input.sourceOccurrenceId}
         )
       order by id
       for update
    `
  );
  return result.rows.map((row) =>
    inboxV2MessageTransportOccurrenceLinkSchema.parse({
      tenantId: row.tenant_id,
      id: row.id,
      message: {
        tenantId: row.tenant_id,
        kind: "message",
        id: row.message_id
      },
      sourceOccurrence: {
        tenantId: row.tenant_id,
        kind: "source_occurrence",
        id: row.source_occurrence_id
      },
      externalMessageReference: {
        tenantId: row.tenant_id,
        kind: "external_message_reference",
        id: row.external_message_reference_id
      },
      role: row.role,
      revision: databaseBigint(row.revision, "Transport link revision"),
      linkedAt: databaseTimestamp(row.linked_at, "Transport link linkedAt")
    })
  );
}

type DeferredSourceActionConflictCandidateRow = {
  ordinal: unknown;
  candidate_detail: unknown;
};

type DeferredSourceActionTransitionRow = {
  commit_digest_sha256: unknown;
  expected_revision: unknown;
  resulting_revision: unknown;
  after_state: unknown;
};

type DeferredSourceActionOrderingHeadRow = {
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
};

type SourceMessageKeyRegistryRow = {
  external_message_key_detail: unknown;
};

type SourceMessageWeakCorrelationEvidenceRow = {
  ordinal: unknown;
  code_id: unknown;
  evidence_hmac_sha256: unknown;
  expires_at: unknown;
  created_at: unknown;
  unexpired: unknown;
};

export function buildInsertInboxV2SourceMessageWeakCorrelationEvidenceSql(
  plan: InboxV2SourceMessageReconciliationPlan,
  ordinal: number
): SQL {
  const evidence = plan.weakCorrelationEvidence[ordinal];
  if (evidence === undefined || ordinal < 0 || ordinal > 7) {
    throw new CoreError(
      "validation.failed",
      "Weak source-message evidence ordinal is outside its bounded plan."
    );
  }
  const expiresAt = Date.parse(evidence.expiresAt);
  const materializedAt = Date.parse(plan.materializedAt);
  if (
    expiresAt <= materializedAt ||
    expiresAt - materializedAt > MAX_WEAK_CORRELATION_EVIDENCE_RETENTION_MS
  ) {
    throw new CoreError(
      "validation.failed",
      "Weak source-message evidence must expire after materialization and within 30 days."
    );
  }
  return sql`
    insert into public.inbox_v2_source_message_correlation_evidence (
      tenant_id, source_occurrence_id, ordinal, code_id,
      evidence_hmac_sha256, expires_at,
      data_class_id, sensitivity_class, processing_purpose_id,
      canonical_anchor_id, expiry_action, created_at
    ) select
      ${plan.sourceOccurrence.tenantId}, ${plan.sourceOccurrence.id},
      ${ordinal}, ${evidence.codeId}, ${evidence.evidenceHmacSha256},
      ${toDate(evidence.expiresAt)},
      'core:operational_log_trace_diagnostic', 'security_evidence',
      'core:source_replay_and_diagnostics', 'core:creation', 'hard_delete',
      ${toDate(plan.materializedAt)}
     where ${toDate(evidence.expiresAt)} > transaction_timestamp()
    on conflict do nothing
    returning ordinal
  `;
}

export function buildListInboxV2SourceMessageWeakCorrelationEvidenceSql(
  plan: InboxV2SourceMessageReconciliationPlan
): SQL {
  return sql`
    select ordinal, code_id, evidence_hmac_sha256, expires_at, created_at,
           expires_at > transaction_timestamp() as unexpired
      from public.inbox_v2_source_message_correlation_evidence
     where tenant_id = ${plan.sourceOccurrence.tenantId}
       and source_occurrence_id = ${plan.sourceOccurrence.id}
     order by ordinal asc
     limit 9
     for share
  `;
}

export async function persistInboxV2SourceMessageWeakCorrelationEvidenceInTransaction(
  transaction: RawSqlExecutor,
  plan: InboxV2SourceMessageReconciliationPlan
): Promise<"created" | "already_exists" | "conflict"> {
  plan = inboxV2SourceMessageReconciliationPlanSchema.parse(plan);
  let insertedCount = 0;
  for (const ordinal of plan.weakCorrelationEvidence.keys()) {
    const inserted = await transaction.execute<Record<string, unknown>>(
      buildInsertInboxV2SourceMessageWeakCorrelationEvidenceSql(plan, ordinal)
    );
    if (inserted.rows.length > 1) {
      throw new InboxV2PersistenceInvariantError(
        "Weak source-message evidence insert returned more than one row."
      );
    }
    insertedCount += inserted.rows.length;
  }
  const loaded =
    await transaction.execute<SourceMessageWeakCorrelationEvidenceRow>(
      buildListInboxV2SourceMessageWeakCorrelationEvidenceSql(plan)
    );
  if (loaded.rows.length !== plan.weakCorrelationEvidence.length) {
    return "conflict";
  }
  for (const [ordinal, expected] of plan.weakCorrelationEvidence.entries()) {
    const row = loaded.rows[ordinal];
    if (
      row === undefined ||
      Number(row.ordinal) !== ordinal ||
      String(row.code_id) !== expected.codeId ||
      String(row.evidence_hmac_sha256) !== expected.evidenceHmacSha256 ||
      row.unexpired !== true ||
      databaseTimestamp(row.expires_at, "Weak evidence expiresAt") !==
        expected.expiresAt ||
      databaseTimestamp(row.created_at, "Weak evidence createdAt") !==
        plan.materializedAt
    ) {
      return "conflict";
    }
  }
  if (
    insertedCount !== 0 &&
    insertedCount !== plan.weakCorrelationEvidence.length
  ) {
    return "conflict";
  }
  return insertedCount === 0 ? "already_exists" : "created";
}

export function buildInsertInboxV2DeferredMessageSourceActionSql(
  action: InboxV2DeferredMessageSourceAction
): SQL {
  const key = action.externalMessageKey;
  const scope = messageScopeColumns(key.scope);
  const proof = action.semanticProof;
  const ordering = deferredOrderingColumns(proof.ordering);
  const adapter = proof.adapterContract;
  return sql`
    insert into public.inbox_v2_deferred_message_source_actions (
      tenant_id, id,
      message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_scope_source_account_id,
      message_scope_source_thread_binding_id, message_object_kind_id,
      external_thread_id, canonical_external_subject,
      external_message_key_detail,
      external_message_key_detail_digest_sha256,
      source_occurrence_id, source_occurrence_revision,
      source_occurrence_detail, source_occurrence_detail_digest_sha256,
      normalized_inbound_event_id,
      action_kind, lane, action_detail, action_detail_digest_sha256,
      source_account_id, source_thread_binding_id, binding_generation,
      adapter_contract_id, adapter_contract_version,
      adapter_declaration_revision, adapter_surface_id,
      adapter_loaded_by_trusted_service_id, adapter_loaded_at,
      capability_id, capability_revision, semantic_id, semantic_revision,
      actor_source_external_identity_id,
      ordering_kind, ordering_scope_token, ordering_position,
      ordering_comparator_id, ordering_comparator_revision,
      ordering_conflict_token, ordering_unavailable_reason_id,
      declared_by_trusted_service_id, semantic_proof_token,
      semantic_proof_detail, semantic_proof_detail_digest_sha256,
      event_fingerprint_sha256,
      state, applied_external_message_reference_id, applied_message_id,
      applied_message_revision, effect_kind, related_action_id,
      state_reason_id, conflict_candidate_count,
      conflict_candidate_digest_sha256, terminal_at,
      revision, observed_at, recorded_at, created_at, updated_at
    ) values (
      ${action.tenantId}, ${action.id},
      ${key.realm.realmId}, ${key.realm.realmVersion},
      ${key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${key.objectKindId}, ${key.externalThread.id},
      ${key.canonicalExternalSubject}, ${toJson(key)}::jsonb,
      ${jsonbDetailDigestSql(key)},
      ${action.sourceOccurrence.id}, ${BigInt(action.sourceOccurrence.revision)},
      ${toJson(action.sourceOccurrence)}::jsonb,
      ${jsonbDetailDigestSql(action.sourceOccurrence)},
      ${action.idempotencyKey.normalizedInboundEvent.id},
      ${action.action.kind}, ${deferredActionLane(action.action.kind)},
      ${toJson(action.action)}::jsonb, ${jsonbDetailDigestSql(action.action)},
      ${proof.sourceAccount.id}, ${proof.sourceThreadBinding.id},
      ${BigInt(proof.bindingGeneration)}, ${adapter.contractId},
      ${adapter.contractVersion}, ${BigInt(adapter.declarationRevision)},
      ${adapter.surfaceId}, ${adapter.loadedByTrustedServiceId},
      ${toDate(adapter.loadedAt)}, ${proof.capabilityId},
      ${BigInt(proof.capabilityRevision)}, ${proof.semanticId},
      ${BigInt(proof.semanticRevision)}, ${proof.actor?.id ?? null},
      ${ordering.kind}, ${ordering.scopeToken}, ${ordering.position},
      ${ordering.comparatorId}, ${ordering.comparatorRevision},
      ${ordering.conflictToken}, ${ordering.unavailableReasonId},
      ${proof.declaredByTrustedServiceId}, ${proof.proofToken},
      ${toJson(proof)}::jsonb, ${jsonbDetailDigestSql(proof)},
      ${action.idempotencyKey.eventFingerprintSha256},
      'pending', null, null, null, null, null, null, 0, null, null,
      ${BigInt(action.revision)}, ${toDate(action.observedAt)},
      ${toDate(action.recordedAt)}, ${toDate(action.createdAt)},
      ${toDate(action.updatedAt)}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildFindInboxV2DeferredMessageSourceActionCandidatesSql(
  action: InboxV2DeferredMessageSourceAction
): SQL {
  return sql`
    select tenant_id, id, external_message_key_detail,
           source_occurrence_detail, normalized_inbound_event_id,
           action_detail, semantic_proof_detail, semantic_id,
           event_fingerprint_sha256, state,
           applied_external_message_reference_id, applied_message_id,
           applied_message_revision, effect_kind, related_action_id,
           state_reason_id, conflict_candidate_count,
           conflict_candidate_digest_sha256, terminal_at, revision,
           observed_at, recorded_at, created_at, updated_at
      from public.inbox_v2_deferred_message_source_actions
     where tenant_id = ${action.tenantId}
       and (
         id = ${action.id}
         or (
           normalized_inbound_event_id =
             ${action.idempotencyKey.normalizedInboundEvent.id}
           and source_occurrence_id =
             ${action.idempotencyKey.sourceOccurrence.id}
           and semantic_id = ${action.idempotencyKey.semanticId}
           and event_fingerprint_sha256 =
             ${action.idempotencyKey.eventFingerprintSha256}
         )
       )
     order by id asc
     limit 2
     for share
  `;
}

export async function persistInboxV2DeferredMessageSourceActionInTransaction(
  transaction: RawSqlExecutor,
  candidate: InboxV2DeferredMessageSourceAction
): Promise<PersistInboxV2DeferredMessageSourceActionResult> {
  const action = inboxV2DeferredMessageSourceActionSchema.parse(candidate);
  if (action.state.state !== "pending" || action.revision !== "1") {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action induction must start pending at revision 1."
    );
  }
  // Preserve the coordinator's global order even when this transaction-local
  // helper is called directly: exact-key lock (caller), occurrence, action.
  const canonicalOccurrence = await readInboxV2SourceOccurrenceInTransaction(
    transaction,
    {
      tenantId: action.tenantId,
      occurrenceId: action.sourceOccurrence.id
    },
    { lock: true }
  );
  const existing = await loadDeferredMessageSourceActionCandidateRows(
    transaction,
    action
  );
  if (existing.length !== 0) {
    return classifyDeferredMessageSourceActionPersistence(
      transaction,
      action,
      existing,
      false,
      canonicalOccurrence
    );
  }

  // The JSON occurrence snapshot is provenance, not caller-owned payload. A
  // new action may only copy the exact locked aggregate (including bounded
  // reference/timestamp children) while it is still pending. Terminal replay
  // takes the existing immutable action+transition path above instead.
  if (
    canonicalOccurrence === null ||
    canonicalOccurrence.resolution.state !== "pending" ||
    !sameValue(canonicalOccurrence, action.sourceOccurrence)
  ) {
    return { kind: "action_id_conflict" };
  }
  const inserted = await transaction.execute<Record<string, unknown>>(
    buildInsertInboxV2DeferredMessageSourceActionSql(action)
  );
  if (inserted.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action insert returned more than one row."
    );
  }
  const loaded = await loadDeferredMessageSourceActionCandidateRows(
    transaction,
    action
  );
  return classifyDeferredMessageSourceActionPersistence(
    transaction,
    action,
    loaded,
    inserted.rows.length === 1,
    canonicalOccurrence
  );
}

async function loadDeferredMessageSourceActionCandidateRows(
  transaction: RawSqlExecutor,
  action: InboxV2DeferredMessageSourceAction
): Promise<readonly DeferredMessageSourceActionRow[]> {
  const loaded = await transaction.execute<DeferredMessageSourceActionRow>(
    buildFindInboxV2DeferredMessageSourceActionCandidatesSql(action)
  );
  if (loaded.rows.length > 2) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action lookup exceeded its bounded conflict set."
    );
  }
  return loaded.rows;
}

async function classifyDeferredMessageSourceActionPersistence(
  transaction: RawSqlExecutor,
  action: InboxV2DeferredMessageSourceAction,
  loaded: readonly DeferredMessageSourceActionRow[],
  inserted: boolean,
  canonicalOccurrence: InboxV2SourceOccurrence | null
): Promise<PersistInboxV2DeferredMessageSourceActionResult> {
  const byId = loaded.find((row) => String(row.id) === String(action.id));
  if (byId !== undefined) {
    const candidates =
      byId.state === "target_conflicted"
        ? await loadDeferredSourceActionConflictCandidates(transaction, byId)
        : [];
    const mapped = mapDeferredMessageSourceActionRow(byId, candidates);
    const exactReplay =
      mapped.state.state === "pending"
        ? sameValue(mapped, action)
        : sameDeferredActionStableFacts(mapped, action);
    if (!exactReplay) {
      if (inserted) {
        throw new InboxV2PersistenceInvariantError(
          "New deferred source-action row does not match its candidate."
        );
      }
      return { kind: "action_id_conflict" };
    }
    if (loaded.length !== 1) {
      return { kind: "idempotency_conflict" };
    }
    if (inserted && mapped.state.state !== "pending") {
      throw new InboxV2PersistenceInvariantError(
        "New deferred source-action induction reloaded terminally."
      );
    }
    if (mapped.state.state === "pending") {
      if (
        canonicalOccurrence === null ||
        canonicalOccurrence.resolution.state !== "pending" ||
        !sameValue(canonicalOccurrence, action.sourceOccurrence)
      )
        return { kind: "action_id_conflict" };
    } else if (
      canonicalOccurrence === null ||
      !sameInboxV2SourceOccurrenceStableFacts(
        canonicalOccurrence,
        action.sourceOccurrence
      )
    ) {
      return { kind: "action_id_conflict" };
    }
    if (
      mapped.state.state !== "pending" &&
      !(await deferredActionTerminalProofMatches(transaction, mapped))
    ) {
      return { kind: "action_id_conflict" };
    }
    return {
      kind: inserted ? "created" : "already_exists",
      action: mapped
    };
  }
  if (inserted) {
    throw new InboxV2PersistenceInvariantError(
      "Inserted deferred source action cannot be reloaded."
    );
  }
  return loaded.length === 0
    ? { kind: "action_id_conflict" }
    : { kind: "idempotency_conflict" };
}

async function deferredActionTerminalProofMatches(
  transaction: RawSqlExecutor,
  action: InboxV2DeferredMessageSourceAction
): Promise<boolean> {
  const loaded = await transaction.execute<DeferredSourceActionTransitionRow>(
    buildReadInboxV2DeferredSourceActionTerminalProofSql({
      tenantId: action.tenantId,
      actionId: action.id
    })
  );
  const row = loaded.rows[0];
  return (
    loaded.rows.length === 1 &&
    row !== undefined &&
    databaseBigint(
      row.expected_revision,
      "Deferred transition expected revision"
    ) === "1" &&
    databaseBigint(
      row.resulting_revision,
      "Deferred transition resulting revision"
    ) === action.revision &&
    String(row.after_state) === action.state.state &&
    /^sha256:[a-f0-9]{64}$/u.test(String(row.commit_digest_sha256))
  );
}

export function buildReadInboxV2DeferredMessageSourceActionSql(
  input: Readonly<{
    tenantId: string;
    actionId: string;
    lock?: boolean;
  }>
): SQL {
  const lock = input.lock === true ? sql`for update` : sql`for share`;
  return sql`
    select tenant_id, id, external_message_key_detail,
           source_occurrence_detail, normalized_inbound_event_id,
           action_detail, semantic_proof_detail, semantic_id,
           event_fingerprint_sha256, state,
           applied_external_message_reference_id, applied_message_id,
           applied_message_revision, effect_kind, related_action_id,
           state_reason_id, conflict_candidate_count,
           conflict_candidate_digest_sha256, terminal_at,
           revision, observed_at, recorded_at, created_at, updated_at
      from public.inbox_v2_deferred_message_source_actions
     where tenant_id = ${input.tenantId}
       and id = ${input.actionId}
     ${lock}
  `;
}

export function buildListInboxV2DeferredMessageSourceActionConflictCandidatesSql(
  input: Readonly<{
    tenantId: string;
    actionId: string;
    resultingRevision: string;
  }>
): SQL {
  return sql`
    select ordinal, candidate_detail
      from public.inbox_v2_deferred_source_action_conflict_candidates
     where tenant_id = ${input.tenantId}
       and action_id = ${input.actionId}
       and resulting_revision = ${BigInt(input.resultingRevision)}
     order by ordinal asc
     limit 101
     for share
  `;
}

export async function readInboxV2DeferredMessageSourceActionInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{ tenantId: string; actionId: string; lock: boolean }>
): Promise<InboxV2DeferredMessageSourceAction | null> {
  const loaded = await transaction.execute<DeferredMessageSourceActionRow>(
    buildReadInboxV2DeferredMessageSourceActionSql(input)
  );
  if (loaded.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action lookup returned more than one row."
    );
  }
  const row = loaded.rows[0];
  if (row === undefined) return null;
  const candidates =
    row.state === "target_conflicted"
      ? await loadDeferredSourceActionConflictCandidates(transaction, row)
      : [];
  return mapDeferredMessageSourceActionRow(row, candidates);
}

export function buildInsertInboxV2SourceMessageKeyRegistrySql(
  input: Readonly<{
    tenantId: string;
    externalMessageKey: InboxV2ExternalMessageKey;
  }>
): SQL {
  const key = input.externalMessageKey;
  const scope = messageScopeColumns(key.scope);
  return sql`
    insert into public.inbox_v2_source_message_key_registry (
      tenant_id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_scope_source_account_id,
      message_scope_source_thread_binding_id, message_object_kind_id,
      external_thread_id, canonical_external_subject,
      external_message_key_detail,
      external_message_key_detail_digest_sha256, created_at
    ) values (
      ${input.tenantId}, ${key.realm.realmId}, ${key.realm.realmVersion},
      ${key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${key.objectKindId}, ${key.externalThread.id},
      ${key.canonicalExternalSubject}, ${toJson(key)}::jsonb,
      ${jsonbDetailDigestSql(key)}, transaction_timestamp()
    )
    on conflict do nothing
    returning message_key_digest_sha256
  `;
}

export function buildReadInboxV2SourceMessageKeyRegistrySql(
  input: Readonly<{
    tenantId: string;
    keyDigest: string;
  }>
): SQL {
  return sql`
    select external_message_key_detail
      from public.inbox_v2_source_message_key_registry
     where tenant_id = ${input.tenantId}
       and message_key_digest_sha256 = ${input.keyDigest}
     limit 1
     for share
  `;
}

export async function registerInboxV2SourceMessageKeyInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    keyDigest: string;
    externalMessageKey: InboxV2ExternalMessageKey;
  }>
): Promise<"registered" | "already_exists" | "digest_collision"> {
  if (
    computeInboxV2ExternalMessageKeyDigest(input.externalMessageKey) !==
    input.keyDigest
  ) {
    throw new InboxV2PersistenceInvariantError(
      "Source message-key registry digest does not match the canonical key."
    );
  }
  const inserted = await transaction.execute<Record<string, unknown>>(
    buildInsertInboxV2SourceMessageKeyRegistrySql(input)
  );
  if (inserted.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Source message-key registry insert exceeded its bound."
    );
  }
  const loaded = await transaction.execute<SourceMessageKeyRegistryRow>(
    buildReadInboxV2SourceMessageKeyRegistrySql(input)
  );
  if (loaded.rows.length !== 1) {
    throw new InboxV2PersistenceInvariantError(
      "Source message-key registry row was not visible after registration."
    );
  }
  const registeredKey = inboxV2ExternalMessageKeySchema.parse(
    loaded.rows[0]!.external_message_key_detail
  );
  if (!sameInboxV2ExternalMessageKey(registeredKey, input.externalMessageKey)) {
    return "digest_collision";
  }
  return inserted.rows.length === 1 ? "registered" : "already_exists";
}

export function buildListPendingInboxV2DeferredMessageSourceActionsSql(
  input: ListPendingInboxV2DeferredMessageSourceActionsInput &
    Readonly<{ keyDigest: string; limit: number }>
): SQL {
  return sql`
    select tenant_id, id, external_message_key_detail,
           source_occurrence_detail, normalized_inbound_event_id,
           action_detail, semantic_proof_detail, semantic_id,
           event_fingerprint_sha256, state,
           applied_external_message_reference_id, applied_message_id,
           applied_message_revision, effect_kind, related_action_id,
           state_reason_id, conflict_candidate_count,
           conflict_candidate_digest_sha256, terminal_at,
           revision, observed_at, recorded_at, created_at, updated_at
      from public.inbox_v2_deferred_message_source_actions
     where tenant_id = ${input.tenantId}
       and message_key_digest_sha256 = ${input.keyDigest}
       and external_message_key_detail = ${toJson(input.externalMessageKey)}::jsonb
       and state = 'pending'
       and (${input.afterActionId ?? null}::text is null
         or id > ${input.afterActionId ?? null})
     order by id asc
     limit ${input.limit + 1}
     for share
  `;
}

export async function listPendingInboxV2DeferredMessageSourceActionsInTransaction(
  transaction: RawSqlExecutor,
  input: ListPendingInboxV2DeferredMessageSourceActionsInput &
    Readonly<{ keyDigest: string; limit: number }>
): Promise<ListPendingInboxV2DeferredMessageSourceActionsResult> {
  const registry = await transaction.execute<SourceMessageKeyRegistryRow>(
    buildReadInboxV2SourceMessageKeyRegistrySql(input)
  );
  if (registry.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Source message-key registry lookup exceeded its bound."
    );
  }
  if (registry.rows.length === 0) {
    return {
      kind: "page",
      actions: [],
      hasMore: false,
      nextAfterActionId: null
    };
  }
  const registeredKey = inboxV2ExternalMessageKeySchema.parse(
    registry.rows[0]!.external_message_key_detail
  );
  if (!sameInboxV2ExternalMessageKey(registeredKey, input.externalMessageKey)) {
    return {
      kind: "digest_collision",
      actions: [],
      hasMore: false,
      nextAfterActionId: null
    };
  }

  const loaded = await transaction.execute<DeferredMessageSourceActionRow>(
    buildListPendingInboxV2DeferredMessageSourceActionsSql(input)
  );
  if (loaded.rows.length > input.limit + 1) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action page exceeded its SQL bound."
    );
  }
  const hasMore = loaded.rows.length > input.limit;
  const rows = loaded.rows.slice(0, input.limit);
  const actions = rows.map((row) => {
    const action = mapPendingDeferredMessageSourceActionRow(row);
    if (
      action === null ||
      !sameInboxV2ExternalMessageKey(
        action.externalMessageKey,
        input.externalMessageKey
      )
    ) {
      throw new InboxV2PersistenceInvariantError(
        "Exact-key pending action query returned an ineligible row."
      );
    }
    return action;
  });
  return {
    kind: "page",
    actions,
    hasMore,
    nextAfterActionId:
      hasMore && actions.length > 0 ? actions[actions.length - 1]!.id : null
  };
}

async function loadDeferredSourceActionConflictCandidates(
  transaction: RawSqlExecutor,
  actionRow: DeferredMessageSourceActionRow
): Promise<readonly InboxV2ExternalMessageReference[]> {
  const loaded =
    await transaction.execute<DeferredSourceActionConflictCandidateRow>(
      buildListInboxV2DeferredMessageSourceActionConflictCandidatesSql({
        tenantId: String(actionRow.tenant_id),
        actionId: String(actionRow.id),
        resultingRevision: databaseBigint(
          actionRow.revision,
          "Deferred action revision"
        )
      })
    );
  if (loaded.rows.length > 100) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action candidate set exceeded its contract bound."
    );
  }
  return loaded.rows.map((row, ordinal) => {
    if (Number(row.ordinal) !== ordinal) {
      throw new InboxV2PersistenceInvariantError(
        "Deferred source-action candidates are not contiguous."
      );
    }
    return inboxV2ExternalMessageReferenceSchema.parse(row.candidate_detail);
  });
}

export function buildReadInboxV2DeferredSourceActionTransitionSql(
  commit: InboxV2DeferredMessageSourceActionCommit
): SQL {
  return sql`
    select expected_revision, resulting_revision, after_state,
           commit_digest_sha256
      from public.inbox_v2_deferred_message_source_action_transitions
     where tenant_id = ${commit.tenantId}
       and action_id = ${commit.before.id}
     for share
  `;
}

export function buildReadInboxV2DeferredSourceActionTerminalProofSql(
  input: Readonly<{
    tenantId: string;
    actionId: string;
  }>
): SQL {
  return sql`
    select expected_revision, resulting_revision, after_state,
           commit_digest_sha256
      from public.inbox_v2_deferred_message_source_action_transitions
     where tenant_id = ${input.tenantId}
       and action_id = ${input.actionId}
     for share
  `;
}

export function buildReadInboxV2DeferredSourceActionOrderingHeadSql(
  head: InboxV2DeferredSourceActionOrderingHead,
  options: Readonly<{ lock?: boolean }> = {}
): SQL {
  const lock = options.lock === false ? sql`for share` : sql`for update`;
  return sql`
    select tenant_id, external_message_key_detail, lane, scope_token,
           comparator_id, comparator_revision, latest_action_id,
           latest_normalized_inbound_event_id,
           latest_source_occurrence_id, latest_semantic_id,
           latest_event_fingerprint_sha256, latest_position,
           revision, created_at, updated_at
      from public.inbox_v2_deferred_source_action_ordering_heads
     where tenant_id = ${head.tenantId}
       and message_key_digest_sha256 =
         ${computeInboxV2ExternalMessageKeyDigest(head.externalMessageKey)}
       and lane = ${head.lane}
       and scope_token = ${head.scopeToken}
       and comparator_id = ${head.comparatorId}
       and comparator_revision = ${BigInt(head.comparatorRevision)}
     limit 2
     ${lock}
  `;
}

export function buildInsertInboxV2DeferredSourceActionTransitionSql(
  commit: InboxV2DeferredMessageSourceActionCommit
): SQL {
  const terminal = deferredTerminalColumns(commit.after.state);
  const orderingHead = commit.afterOrderingHead ?? commit.beforeOrderingHead;
  return sql`
    insert into public.inbox_v2_deferred_message_source_action_transitions (
      tenant_id, action_id, expected_revision, resulting_revision,
      after_state, ordering_outcome,
      expected_ordering_head_revision, resulting_ordering_head_revision,
      ordering_head_scope_token, ordering_head_comparator_id,
      ordering_head_comparator_revision,
      target_external_message_reference_id, target_message_id,
      applied_message_revision, effect_kind, related_action_id, reason_id,
      conflict_candidate_count, conflict_candidate_digest_sha256,
      source_occurrence_expected_revision,
      source_occurrence_resulting_revision,
      source_occurrence_resolution_digest_sha256,
      effect_proof_digest_sha256,
      transition_detail, transition_detail_digest_sha256,
      commit_digest_sha256, recorded_at
    ) values (
      ${commit.tenantId}, ${commit.before.id},
      ${BigInt(commit.transition.expectedRevision)},
      ${BigInt(commit.transition.resultingRevision)},
      ${commit.after.state.state}, ${commit.transition.orderingOutcome},
      ${nullableBigint(commit.transition.expectedOrderingHeadRevision)},
      ${nullableBigint(commit.transition.resultingOrderingHeadRevision)},
      ${orderingHead?.scopeToken ?? null},
      ${orderingHead?.comparatorId ?? null},
      ${nullableBigint(orderingHead?.comparatorRevision ?? null)},
      ${commit.targetExternalMessageReference?.id ?? null},
      ${commit.targetExternalMessageReference?.message.id ?? null},
      ${nullableBigint(terminal.appliedMessageRevision)},
      ${terminal.effectKind}, ${terminal.relatedActionId},
      ${terminal.reasonId}, ${terminal.conflictCandidateCount},
      ${terminal.conflictCandidateDigestSha256},
      ${nullableBigint(commit.sourceOccurrenceResolution?.expectedRevision ?? null)},
      ${nullableBigint(commit.sourceOccurrenceResolution?.resultingRevision ?? null)},
      ${nullableCanonicalDigest(commit.sourceOccurrenceResolution)},
      ${nullableCanonicalDigest(commit.effectProof)},
      ${toJson(commit.transition)}::jsonb,
      ${jsonbDetailDigestSql(commit.transition)},
      ${computeCanonicalDigest(commit)},
      ${toDate(commit.transition.recordedAt)}
    )
    on conflict do nothing
    returning action_id
  `;
}

export function buildInsertInboxV2DeferredSourceActionConflictCandidateSql(
  commit: InboxV2DeferredMessageSourceActionCommit,
  ordinal: number
): SQL {
  if (commit.after.state.state !== "target_conflicted") {
    throw new InboxV2PersistenceInvariantError(
      "Only target-conflicted commits carry candidate rows."
    );
  }
  const candidate = commit.after.state.candidates[ordinal];
  if (candidate === undefined || ordinal < 0 || ordinal > 99) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action candidate ordinal is outside its bound."
    );
  }
  return sql`
    insert into public.inbox_v2_deferred_source_action_conflict_candidates (
      tenant_id, action_id, resulting_revision, ordinal,
      external_message_reference_id, external_thread_id,
      timeline_item_id, message_id, message_key_digest_sha256,
      candidate_detail, candidate_detail_digest_sha256, created_at
    ) values (
      ${commit.tenantId}, ${commit.before.id},
      ${BigInt(commit.transition.resultingRevision)}, ${ordinal},
      ${candidate.id}, ${candidate.externalThread.id},
      ${candidate.timelineItem.id}, ${candidate.message.id},
      ${computeInboxV2ExternalMessageKeyDigest(candidate.key)},
      ${toJson(candidate)}::jsonb, ${jsonbDetailDigestSql(candidate)},
      ${toDate(commit.transition.recordedAt)}
    )
    on conflict do nothing
    returning ordinal
  `;
}

export function buildInsertInboxV2DeferredSourceActionOrderingHeadSql(
  head: InboxV2DeferredSourceActionOrderingHead
): SQL {
  const key = head.externalMessageKey;
  const scope = messageScopeColumns(key.scope);
  return sql`
    insert into public.inbox_v2_deferred_source_action_ordering_heads (
      tenant_id, message_realm_id, message_realm_version,
      message_canonicalization_version, message_scope_kind,
      message_scope_source_account_id,
      message_scope_source_thread_binding_id, message_object_kind_id,
      external_thread_id, canonical_external_subject,
      external_message_key_detail, external_message_key_detail_digest_sha256,
      lane, scope_token, comparator_id, comparator_revision,
      latest_action_id, latest_normalized_inbound_event_id,
      latest_source_occurrence_id, latest_semantic_id,
      latest_event_fingerprint_sha256, latest_position,
      revision, created_at, updated_at
    ) values (
      ${head.tenantId}, ${key.realm.realmId}, ${key.realm.realmVersion},
      ${key.realm.canonicalizationVersion}, ${scope.kind},
      ${scope.sourceAccountId}, ${scope.sourceThreadBindingId},
      ${key.objectKindId}, ${key.externalThread.id},
      ${key.canonicalExternalSubject}, ${toJson(key)}::jsonb,
      ${jsonbDetailDigestSql(key)}, ${head.lane}, ${head.scopeToken},
      ${head.comparatorId}, ${BigInt(head.comparatorRevision)},
      ${head.latest.action.id},
      ${head.latest.idempotencyKey.normalizedInboundEvent.id},
      ${head.latest.idempotencyKey.sourceOccurrence.id},
      ${head.latest.idempotencyKey.semanticId},
      ${head.latest.idempotencyKey.eventFingerprintSha256},
      ${head.latest.position}, ${BigInt(head.revision)},
      ${toDate(head.createdAt)}, ${toDate(head.updatedAt)}
    )
    on conflict do nothing
    returning latest_action_id
  `;
}

export function buildAdvanceInboxV2DeferredSourceActionOrderingHeadSql(
  input: Readonly<{
    before: InboxV2DeferredSourceActionOrderingHead;
    after: InboxV2DeferredSourceActionOrderingHead;
  }>
): SQL {
  return sql`
    update public.inbox_v2_deferred_source_action_ordering_heads
       set latest_action_id = ${input.after.latest.action.id},
           latest_normalized_inbound_event_id =
             ${input.after.latest.idempotencyKey.normalizedInboundEvent.id},
           latest_source_occurrence_id =
             ${input.after.latest.idempotencyKey.sourceOccurrence.id},
           latest_semantic_id = ${input.after.latest.idempotencyKey.semanticId},
           latest_event_fingerprint_sha256 =
             ${input.after.latest.idempotencyKey.eventFingerprintSha256},
           latest_position = ${input.after.latest.position},
           revision = ${BigInt(input.after.revision)},
           updated_at = ${toDate(input.after.updatedAt)}
     where tenant_id = ${input.before.tenantId}
       and message_key_digest_sha256 =
         ${computeInboxV2ExternalMessageKeyDigest(input.before.externalMessageKey)}
       and external_message_key_detail =
         ${toJson(input.before.externalMessageKey)}::jsonb
       and lane = ${input.before.lane}
       and scope_token = ${input.before.scopeToken}
       and comparator_id = ${input.before.comparatorId}
       and comparator_revision = ${BigInt(input.before.comparatorRevision)}
       and latest_action_id = ${input.before.latest.action.id}
       and latest_normalized_inbound_event_id =
         ${input.before.latest.idempotencyKey.normalizedInboundEvent.id}
       and latest_source_occurrence_id =
         ${input.before.latest.idempotencyKey.sourceOccurrence.id}
       and latest_semantic_id = ${input.before.latest.idempotencyKey.semanticId}
       and latest_event_fingerprint_sha256 =
         ${input.before.latest.idempotencyKey.eventFingerprintSha256}
       and latest_position = ${input.before.latest.position}
       and revision = ${BigInt(input.before.revision)}
       and created_at = ${toDate(input.before.createdAt)}
       and updated_at = ${toDate(input.before.updatedAt)}
    returning latest_action_id
  `;
}

export function buildCommitInboxV2DeferredMessageSourceActionSql(
  commit: InboxV2DeferredMessageSourceActionCommit
): SQL {
  const terminal = deferredTerminalColumns(commit.after.state);
  return sql`
    update public.inbox_v2_deferred_message_source_actions
       set state = ${commit.after.state.state},
           applied_external_message_reference_id =
             ${terminal.externalMessageReferenceId},
           applied_message_id = ${terminal.messageId},
           applied_message_revision =
             ${nullableBigint(terminal.appliedMessageRevision)},
           effect_kind = ${terminal.effectKind},
           related_action_id = ${terminal.relatedActionId},
           state_reason_id = ${terminal.reasonId},
           conflict_candidate_count = ${terminal.conflictCandidateCount},
           conflict_candidate_digest_sha256 =
             ${terminal.conflictCandidateDigestSha256},
           terminal_at = ${toDate(terminal.terminalAt)},
           revision = ${BigInt(commit.after.revision)},
           updated_at = ${toDate(commit.after.updatedAt)}
     where tenant_id = ${commit.tenantId}
       and id = ${commit.before.id}
       and state = 'pending'
       and revision = ${BigInt(commit.before.revision)}
       and updated_at = ${toDate(commit.before.updatedAt)}
    returning id
  `;
}

export async function commitInboxV2DeferredMessageSourceActionInTransaction(
  transaction: RawSqlExecutor,
  candidate: InboxV2DeferredMessageSourceActionCommit
): Promise<CommitInboxV2DeferredMessageSourceActionResult> {
  const commit =
    inboxV2DeferredMessageSourceActionCommitSchema.parse(candidate);
  const current = await readInboxV2DeferredMessageSourceActionInTransaction(
    transaction,
    {
      tenantId: commit.tenantId,
      actionId: commit.before.id,
      lock: true
    }
  );
  if (current === null) return { kind: "action_not_found" };

  if (sameValue(current, commit.after)) {
    return (await deferredActionCommitReplayMatches(transaction, commit))
      ? { kind: "already_exists", action: current }
      : { kind: "transition_conflict" };
  }
  if (!sameValue(current, commit.before)) {
    return { kind: "action_revision_conflict" };
  }

  const orderingSelector =
    commit.beforeOrderingHead ?? commit.afterOrderingHead;
  if (orderingSelector !== null) {
    const currentHead = await readDeferredSourceActionOrderingHead(
      transaction,
      orderingSelector,
      true
    );
    if (!sameNullableValue(currentHead, commit.beforeOrderingHead)) {
      return { kind: "ordering_head_conflict" };
    }
  } else if (
    commit.beforeOrderingHead !== null ||
    commit.afterOrderingHead !== null
  ) {
    return { kind: "ordering_head_conflict" };
  }

  const transition = await transaction.execute<Record<string, unknown>>(
    buildInsertInboxV2DeferredSourceActionTransitionSql(commit)
  );
  if (transition.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action transition insert returned more than one row."
    );
  }
  if (transition.rows.length === 0) {
    return { kind: "transition_conflict" };
  }

  if (commit.after.state.state === "target_conflicted") {
    for (const ordinal of commit.after.state.candidates.keys()) {
      const inserted = await transaction.execute<Record<string, unknown>>(
        buildInsertInboxV2DeferredSourceActionConflictCandidateSql(
          commit,
          ordinal
        )
      );
      if (inserted.rows.length !== 1) {
        throw new DeferredActionCommitRollback({ kind: "candidate_conflict" });
      }
    }
  }

  if (
    commit.transition.orderingOutcome === "advance" &&
    commit.afterOrderingHead !== null
  ) {
    const headMutation =
      commit.beforeOrderingHead === null
        ? buildInsertInboxV2DeferredSourceActionOrderingHeadSql(
            commit.afterOrderingHead
          )
        : buildAdvanceInboxV2DeferredSourceActionOrderingHeadSql({
            before: commit.beforeOrderingHead,
            after: commit.afterOrderingHead
          });
    const mutated =
      await transaction.execute<Record<string, unknown>>(headMutation);
    if (mutated.rows.length !== 1) {
      throw new DeferredActionCommitRollback({
        kind: "ordering_head_conflict"
      });
    }
  }

  const actionMutation = await transaction.execute<Record<string, unknown>>(
    buildCommitInboxV2DeferredMessageSourceActionSql(commit)
  );
  if (actionMutation.rows.length !== 1) {
    throw new DeferredActionCommitRollback({
      kind: "action_revision_conflict"
    });
  }
  const persisted = await readInboxV2DeferredMessageSourceActionInTransaction(
    transaction,
    {
      tenantId: commit.tenantId,
      actionId: commit.after.id,
      lock: true
    }
  );
  if (persisted === null || !sameValue(persisted, commit.after)) {
    throw new DeferredActionCommitRollback({ kind: "transition_conflict" });
  }
  const persistedHead =
    commit.afterOrderingHead === null
      ? null
      : await readDeferredSourceActionOrderingHead(
          transaction,
          commit.afterOrderingHead,
          true
        );
  if (!sameNullableValue(persistedHead, commit.afterOrderingHead)) {
    throw new DeferredActionCommitRollback({
      kind: "ordering_head_conflict"
    });
  }
  return { kind: "committed", action: persisted };
}

async function deferredActionCommitReplayMatches(
  transaction: RawSqlExecutor,
  commit: InboxV2DeferredMessageSourceActionCommit
): Promise<boolean> {
  const transition =
    await transaction.execute<DeferredSourceActionTransitionRow>(
      buildReadInboxV2DeferredSourceActionTransitionSql(commit)
    );
  if (
    transition.rows.length !== 1 ||
    String(transition.rows[0]!.commit_digest_sha256) !==
      computeCanonicalDigest(commit)
  ) {
    return false;
  }
  // The immutable transition pins the historical head revisions. A later
  // exact-key action may legitimately advance the mutable current head, so an
  // old action replay must not compare against today's head.
  return true;
}

async function readDeferredSourceActionOrderingHead(
  transaction: RawSqlExecutor,
  selector: InboxV2DeferredSourceActionOrderingHead,
  lock: boolean
): Promise<InboxV2DeferredSourceActionOrderingHead | null> {
  const loaded = await transaction.execute<DeferredSourceActionOrderingHeadRow>(
    buildReadInboxV2DeferredSourceActionOrderingHeadSql(selector, { lock })
  );
  if (loaded.rows.length > 1) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action ordering head lookup exceeded its bound."
    );
  }
  const row = loaded.rows[0];
  if (row === undefined) return null;
  return inboxV2DeferredSourceActionOrderingHeadSchema.parse({
    tenantId: row.tenant_id,
    externalMessageKey: row.external_message_key_detail,
    lane: row.lane,
    scopeToken: row.scope_token,
    comparatorId: row.comparator_id,
    comparatorRevision: databaseBigint(
      row.comparator_revision,
      "Deferred ordering comparator revision"
    ),
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
    revision: databaseBigint(row.revision, "Deferred ordering head revision"),
    createdAt: databaseTimestamp(
      row.created_at,
      "Deferred ordering head createdAt"
    ),
    updatedAt: databaseTimestamp(
      row.updated_at,
      "Deferred ordering head updatedAt"
    )
  });
}

type DeferredTerminalColumns = Readonly<{
  externalMessageReferenceId: string | null;
  messageId: string | null;
  appliedMessageRevision: string | null;
  effectKind: string | null;
  relatedActionId: string | null;
  reasonId: string | null;
  conflictCandidateCount: number;
  conflictCandidateDigestSha256: string | null;
  terminalAt: string;
}>;

function deferredTerminalColumns(
  state: InboxV2DeferredMessageSourceAction["state"]
): DeferredTerminalColumns {
  if (state.state === "pending") {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action commit cannot persist a pending terminal state."
    );
  }
  const base = {
    externalMessageReferenceId: null,
    messageId: null,
    appliedMessageRevision: null,
    effectKind: null,
    relatedActionId: null,
    reasonId: null,
    conflictCandidateCount: 0,
    conflictCandidateDigestSha256: null
  };
  if (state.state === "applied") {
    return {
      ...base,
      externalMessageReferenceId: state.externalMessageReference.id,
      messageId: state.message.id,
      appliedMessageRevision: state.appliedMessageRevision,
      effectKind: state.effectKind,
      terminalAt: state.appliedAt
    };
  }
  if (state.state === "target_conflicted") {
    return {
      ...base,
      reasonId: state.reasonId,
      conflictCandidateCount: state.candidates.length,
      conflictCandidateDigestSha256: computeCanonicalDigest(state.candidates),
      terminalAt: state.conflictedAt
    };
  }
  if (state.state === "stale") {
    return {
      ...base,
      relatedActionId: state.headAction.id,
      terminalAt: state.staleAt
    };
  }
  if (state.state === "duplicate") {
    return {
      ...base,
      relatedActionId: state.canonicalAction.id,
      terminalAt: state.duplicateAt
    };
  }
  if (state.state === "ordering_conflict") {
    return {
      ...base,
      relatedActionId: state.conflictingAction?.id ?? null,
      reasonId: state.reasonId,
      terminalAt: state.conflictedAt
    };
  }
  return {
    ...base,
    reasonId: state.reasonId,
    terminalAt: state.expiredAt
  };
}

function nullableBigint(value: string | null): bigint | null {
  return value === null ? null : BigInt(value);
}

function nullableCanonicalDigest(value: unknown | null): string | null {
  return value === null ? null : computeCanonicalDigest(value);
}

function computeCanonicalDigest(value: unknown): string {
  return `sha256:${createHash("sha256")
    .update(stableJson(value), "utf8")
    .digest("hex")}`;
}

function sameNullableValue(
  left: unknown | null,
  right: unknown | null
): boolean {
  return left === null || right === null
    ? left === null && right === null
    : sameValue(left, right);
}

function mapPendingDeferredMessageSourceActionRow(
  row: DeferredMessageSourceActionRow
): InboxV2DeferredMessageSourceAction | null {
  if (row.state !== "pending") return null;
  return mapDeferredMessageSourceActionRow(row, []);
}

function mapDeferredMessageSourceActionRow(
  row: DeferredMessageSourceActionRow,
  candidates: readonly InboxV2ExternalMessageReference[]
): InboxV2DeferredMessageSourceAction {
  const sourceOccurrence = row.source_occurrence_detail;
  const action = row.action_detail;
  if (
    typeof sourceOccurrence !== "object" ||
    sourceOccurrence === null ||
    typeof action !== "object" ||
    action === null
  ) {
    throw new InboxV2PersistenceInvariantError(
      "Deferred source-action row has invalid canonical detail."
    );
  }
  return inboxV2DeferredMessageSourceActionSchema.parse({
    tenantId: row.tenant_id,
    id: row.id,
    externalMessageKey: row.external_message_key_detail,
    sourceOccurrence,
    action,
    semanticProof: row.semantic_proof_detail,
    idempotencyKey: {
      normalizedInboundEvent: (action as { normalizedEvent?: unknown })
        .normalizedEvent,
      sourceOccurrence: {
        tenantId: (sourceOccurrence as { tenantId?: unknown }).tenantId,
        kind: "source_occurrence",
        id: (sourceOccurrence as { id?: unknown }).id
      },
      semanticId: row.semantic_id,
      eventFingerprintSha256: row.event_fingerprint_sha256
    },
    state: deferredMessageSourceActionState(row, candidates),
    revision: databaseBigint(row.revision, "Deferred action revision"),
    observedAt: databaseTimestamp(
      row.observed_at,
      "Deferred action observedAt"
    ),
    recordedAt: databaseTimestamp(
      row.recorded_at,
      "Deferred action recordedAt"
    ),
    createdAt: databaseTimestamp(row.created_at, "Deferred action createdAt"),
    updatedAt: databaseTimestamp(row.updated_at, "Deferred action updatedAt")
  });
}

function deferredMessageSourceActionState(
  row: DeferredMessageSourceActionRow,
  candidates: readonly InboxV2ExternalMessageReference[]
): InboxV2DeferredMessageSourceAction["state"] {
  const state = String(row.state);
  if (state === "pending") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({ state });
  }
  const terminalAt = databaseTimestamp(
    row.terminal_at,
    "Deferred action terminalAt"
  );
  if (state === "applied") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      externalMessageReference: {
        tenantId: String(row.tenant_id),
        kind: "external_message_reference",
        id: String(row.applied_external_message_reference_id)
      },
      message: {
        tenantId: String(row.tenant_id),
        kind: "message",
        id: String(row.applied_message_id)
      },
      appliedMessageRevision: databaseBigint(
        row.applied_message_revision,
        "Deferred applied message revision"
      ),
      effectKind: String(row.effect_kind) as Extract<
        InboxV2DeferredMessageSourceAction["state"],
        { state: "applied" }
      >["effectKind"],
      appliedAt: terminalAt
    });
  }
  if (state === "target_conflicted") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      candidates: [...candidates],
      reasonId: String(row.state_reason_id),
      conflictedAt: terminalAt
    });
  }
  if (state === "stale") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      headAction: deferredActionReference(row, row.related_action_id),
      staleAt: terminalAt
    });
  }
  if (state === "duplicate") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      canonicalAction: deferredActionReference(row, row.related_action_id),
      duplicateAt: terminalAt
    });
  }
  if (state === "ordering_conflict") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      conflictingAction:
        row.related_action_id === null
          ? null
          : deferredActionReference(row, row.related_action_id),
      reasonId: String(row.state_reason_id),
      conflictedAt: terminalAt
    });
  }
  if (state === "expired") {
    return inboxV2DeferredMessageSourceActionStateSchema.parse({
      state,
      reasonId: String(row.state_reason_id),
      expiredAt: terminalAt
    });
  }
  throw new InboxV2PersistenceInvariantError(
    "Deferred source-action row has an unknown state."
  );
}

function deferredActionReference(
  row: DeferredMessageSourceActionRow,
  id: unknown
): Readonly<Record<string, unknown>> {
  return {
    tenantId: String(row.tenant_id),
    kind: "deferred_message_source_action",
    id: String(id)
  };
}

function messageScopeColumns(scope: InboxV2ExternalMessageKey["scope"]): {
  kind: InboxV2ExternalMessageKey["scope"]["kind"];
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

function deferredActionLane(
  kind: InboxV2DeferredMessageSourceAction["action"]["kind"]
): "message_lifecycle" | "reaction" | "delivery" | "receipt" {
  switch (kind) {
    case "edit":
    case "delete":
      return "message_lifecycle";
    case "reaction":
    case "delivery":
    case "receipt":
      return kind;
  }
}

function deferredOrderingColumns(
  ordering: InboxV2DeferredMessageSourceAction["semanticProof"]["ordering"]
): {
  kind: "monotonic_exact" | "incomparable" | "unavailable";
  scopeToken: string | null;
  position: string | null;
  comparatorId: string | null;
  comparatorRevision: bigint | null;
  conflictToken: string | null;
  unavailableReasonId: string | null;
} {
  if (ordering.kind === "monotonic_exact") {
    return {
      kind: ordering.kind,
      scopeToken: ordering.scopeToken,
      position: ordering.position,
      comparatorId: ordering.comparatorId,
      comparatorRevision: BigInt(ordering.comparatorRevision),
      conflictToken: null,
      unavailableReasonId: null
    };
  }
  if (ordering.kind === "incomparable") {
    return {
      kind: ordering.kind,
      scopeToken: null,
      position: null,
      comparatorId: null,
      comparatorRevision: null,
      conflictToken: ordering.conflictToken,
      unavailableReasonId: null
    };
  }
  return {
    kind: ordering.kind,
    scopeToken: null,
    position: null,
    comparatorId: null,
    comparatorRevision: null,
    conflictToken: null,
    unavailableReasonId: ordering.reasonId
  };
}

function jsonbDetailDigestSql(value: unknown): SQL {
  return sql`'sha256:' || encode(
    sha256(convert_to((${toJson(value)}::jsonb)::text, 'utf8')),
    'hex'
  )`;
}

function toJson(value: unknown): string {
  return stableJson(value);
}

function toDate(value: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new InboxV2PersistenceInvariantError(
      "Source-message reconciliation timestamp is invalid."
    );
  }
  return date;
}

function databaseBigint(value: unknown, field: string): string {
  try {
    const parsed = BigInt(String(value));
    if (parsed < 0n) throw new Error("negative");
    return parsed.toString();
  } catch {
    throw new InboxV2PersistenceInvariantError(
      `${field} is not a canonical PostgreSQL bigint.`
    );
  }
}

function databaseTimestamp(value: unknown, field: string): string {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw new InboxV2PersistenceInvariantError(
      `${field} is not a PostgreSQL timestamp.`
    );
  }
  return date.toISOString();
}

function sameMessageScope(
  left: InboxV2ExternalMessageKey["scope"],
  right: InboxV2ExternalMessageKey["scope"]
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "provider_thread" && right.kind === "provider_thread") {
    return true;
  }
  if (left.kind === "source_account" && right.kind === "source_account") {
    return sameReference(left.owner, right.owner);
  }
  if (
    left.kind === "source_thread_binding" &&
    right.kind === "source_thread_binding"
  ) {
    return sameReference(left.owner, right.owner);
  }
  return false;
}

function sameReference(
  left: Readonly<{ tenantId: string; kind: string; id: unknown }>,
  right: Readonly<{ tenantId: string; kind: string; id: unknown }>
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function occurrenceResolvedTo(
  occurrence: InboxV2SourceOccurrence,
  reference: InboxV2ExternalMessageReference
): boolean {
  return (
    occurrence.resolution.state === "resolved" &&
    occurrence.resolution.externalMessageReference.id === reference.id
  );
}

function sameDeferredActionStableFacts(
  left: InboxV2DeferredMessageSourceAction,
  right: InboxV2DeferredMessageSourceAction
): boolean {
  const stable = (action: InboxV2DeferredMessageSourceAction) => ({
    ...action,
    state: undefined,
    revision: undefined,
    updatedAt: undefined
  });
  return sameValue(stable(left), stable(right));
}

function conflict(
  code: InboxV2SourceMessageReconciliationConflictCode,
  retainedOccurrence: InboxV2SourceOccurrence | null
): Extract<InboxV2SourceMessageReconciliationResult, { kind: "conflict" }> {
  return { kind: "conflict", code, retainedOccurrence };
}

function normalizeReconcileInput(
  input: ReconcileInboxV2SourceMessageInput
): ReconcileInboxV2SourceMessageInput {
  if (
    typeof input !== "object" ||
    input === null ||
    Object.keys(input).some((key) => !RECONCILE_INPUT_KEYS.has(key)) ||
    Object.keys(input).length !== RECONCILE_INPUT_KEYS.size
  ) {
    throw new CoreError(
      "validation.failed",
      "Source message reconciliation accepts only one trusted plan."
    );
  }
  return {
    plan: inboxV2SourceMessageReconciliationPlanSchema.parse(input.plan)
  };
}

function normalizePendingActionPageInput(
  input: ListPendingInboxV2DeferredMessageSourceActionsInput
): ListPendingInboxV2DeferredMessageSourceActionsInput &
  Readonly<{ limit: number }> {
  if (typeof input !== "object" || input === null) {
    throw new CoreError(
      "validation.failed",
      "Deferred source-action page input must be an object."
    );
  }
  const keys = new Set([
    "tenantId",
    "externalMessageKey",
    "afterActionId",
    "limit"
  ]);
  if (Object.keys(input).some((key) => !keys.has(key))) {
    throw new CoreError(
      "validation.failed",
      "Deferred source-action page input contains unknown fields."
    );
  }
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const externalMessageKey = inboxV2ExternalMessageKeySchema.parse(
    input.externalMessageKey
  );
  if (externalMessageKey.externalThread.tenantId !== tenantId) {
    throw new CoreError(
      "validation.failed",
      "Deferred source-action exact key must belong to the requested tenant."
    );
  }
  const afterActionId = input.afterActionId ?? null;
  if (
    afterActionId !== null &&
    !/^deferred_message_source_action:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$/u.test(
      afterActionId
    )
  ) {
    throw new CoreError(
      "validation.failed",
      "Deferred source-action cursor is invalid."
    );
  }
  const limit = input.limit ?? DEFAULT_DEFERRED_ACTION_PAGE_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > MAX_DEFERRED_ACTION_PAGE_LIMIT
  ) {
    throw new CoreError(
      "validation.failed",
      `Deferred source-action page limit must be between 1 and ${MAX_DEFERRED_ACTION_PAGE_LIMIT}.`
    );
  }
  return { tenantId, externalMessageKey, afterActionId, limit };
}

function isPlanAuthorized(
  verifier: InboxV2SourceMessageReconciliationPlanAuthorizationVerifier,
  plan: InboxV2SourceMessageReconciliationPlan
): boolean {
  try {
    return verifier.verify(plan) === true;
  } catch {
    return false;
  }
}

async function invokeReconciliationCallback<TResult>(
  callback: () => Promise<TResult>,
  retainedOccurrence: InboxV2SourceOccurrence
): Promise<TResult> {
  try {
    return await callback();
  } catch (error) {
    if (error instanceof DeferredActionCommitRollback) {
      throw new ReconciliationCallbackRollback(
        conflict(
          "source.message_reconciliation.callback_conflict",
          retainedOccurrence
        )
      );
    }
    throw error;
  }
}

async function runReconciliationTransaction<TResult>(
  executor: InboxV2SourceMessageReconciliationTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  let lastError: unknown;
  for (
    let attempt = 1;
    attempt <= RECONCILIATION_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await executor.transaction(
        work,
        RECONCILIATION_TRANSACTION_CONFIG
      );
    } catch (error) {
      if (error instanceof ReconciliationCallbackRollback) {
        return error.result as TResult;
      }
      lastError = error;
      if (
        attempt === RECONCILIATION_TRANSACTION_ATTEMPTS ||
        !RETRYABLE_SQLSTATES.has(databaseErrorCode(error) ?? "")
      ) {
        throw error;
      }
    }
  }
  throw lastError;
}

class ReconciliationCallbackRollback extends Error {
  constructor(
    readonly result: Extract<
      InboxV2SourceMessageReconciliationResult,
      { kind: "conflict" }
    >
  ) {
    super(
      "Inbox V2 source message reconciliation rolled back callback writes."
    );
    this.name = "ReconciliationCallbackRollback";
  }
}

class DeferredActionCommitRollback extends Error {
  constructor(readonly result: CommitInboxV2DeferredMessageSourceActionResult) {
    super("Inbox V2 deferred source-action commit rolled back partial writes.");
    this.name = "DeferredActionCommitRollback";
  }
}

function databaseErrorCode(error: unknown): string | null {
  let current = error;
  for (let depth = 0; depth < 8 && current; depth += 1) {
    if (
      typeof current === "object" &&
      "code" in current &&
      typeof (current as { code?: unknown }).code === "string"
    ) {
      return (current as { code: string }).code;
    }
    if (typeof current !== "object" || !("cause" in current)) break;
    const cause = (current as { cause?: unknown }).cause;
    if (!cause || cause === current) break;
    current = cause;
  }
  return null;
}

function sameValue(left: unknown, right: unknown): boolean {
  return stableJson(left) === stableJson(right);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }
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
