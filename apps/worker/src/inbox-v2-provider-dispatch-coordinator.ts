import {
  calculateInboxV2CanonicalSha256,
  deriveInboxV2RouteFailureOutboxFinalization,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  inboxV2OutboxClaimSchema,
  inboxV2OutboxIntentSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2RoutingTokenSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceDiagnosticIdSchema,
  inboxV2TimestampSchema,
  type InboxV2OutboxClaim,
  type InboxV2OutboxFinalizeInstruction,
  type InboxV2OutboxIntent,
  type InboxV2OutboxWorkRepositoryPort,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchAttemptCommit,
  type InboxV2OutboundDispatchRouteFailureCommit,
  type InboxV2OutboundDispatchReconciliationCommit,
  type InboxV2OutboundRoute,
  type InboxV2SafeSourceDiagnostic
} from "@hulee/contracts";

type OpenAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "open_attempt" }
>;
type CompleteAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "complete_attempt" }
>;
type FinalizeInput = Parameters<InboxV2OutboxWorkRepositoryPort["finalize"]>[0];
type FinalizeResult = Awaited<
  ReturnType<InboxV2OutboxWorkRepositoryPort["finalize"]>
>;
type FinalizationSource =
  | "provider_result"
  | "recover"
  | "reconcile"
  | "route_failure"
  | "rerouted"
  | "durable_outcome"
  | "recovery_turn";
type SuccessfulFinalizeResult = Extract<
  FinalizeResult,
  Readonly<{
    outcome: "retry_scheduled" | "processed" | "dead" | "already_finalized";
  }>
>;
type RejectedFinalizeResult = Exclude<FinalizeResult, SuccessfulFinalizeResult>;

export type InboxV2ProviderDispatchLeaseFence = Readonly<
  Omit<FinalizeInput, "instruction"> & {
    expectedHandlerId: InboxV2OutboxIntent["handlerId"];
  }
>;

export type InboxV2ProviderDispatchLoadedState = Readonly<{
  kind: "loaded";
  intent: InboxV2OutboxIntent;
  dispatch: InboxV2OutboundDispatch;
}>;

export type InboxV2ProviderDispatchLoadRejected = Readonly<{
  kind:
    | "outbox_not_found"
    | "outbox_not_leased"
    | "outbox_stale_token"
    | "outbox_lease_expired"
    | "outbox_lease_revision_conflict"
    | "outbox_intent_conflict"
    | "outbox_attempt_lease_conflict"
    | "outbox_dispatch_not_found";
}>;

export type InboxV2ProviderDispatchLoadResult =
  | InboxV2ProviderDispatchLoadedState
  | InboxV2ProviderDispatchLoadRejected;

export type InboxV2ProviderDispatchFencedMutationResult =
  | Readonly<{ kind: "committed" | "already_applied" }>
  | Readonly<{
      kind:
        | "outbox_not_found"
        | "outbox_not_leased"
        | "outbox_stale_token"
        | "outbox_lease_expired"
        | "outbox_lease_revision_conflict"
        | "outbox_intent_conflict"
        | "outbox_attempt_lease_conflict"
        | "dispatch_not_found"
        | "route_not_found"
        | "binding_fence_conflict"
        | "dispatch_cancelled"
        | "dispatch_state_conflict"
        | "attempt_id_conflict"
        | "attempt_number_conflict"
        | "claim_token_conflict"
        | "attempt_state_conflict"
        | "unknown_attempt_not_found"
        | "decision_conflict"
        | "attempt_already_reconciled";
    }>;

type FencedMutationRejectionKind = Exclude<
  InboxV2ProviderDispatchFencedMutationResult["kind"],
  "committed" | "already_applied"
>;

/**
 * DB bridge for SRC-009. Implementations must apply the outbox lease fence and
 * the dispatch CAS in one transaction. A transport mutation that returns
 * `committed` has survived the transaction boundary before this worker may do
 * anything else.
 */
export type InboxV2ProviderDispatchTransportPort = Readonly<{
  loadClaimedProviderIo(input: {
    outboxLease: InboxV2ProviderDispatchLeaseFence;
  }): Promise<InboxV2ProviderDispatchLoadResult>;
  applyAttemptFenced(input: {
    outboxLease: InboxV2ProviderDispatchLeaseFence;
    commit: InboxV2OutboundDispatchAttemptCommit;
  }): Promise<InboxV2ProviderDispatchFencedMutationResult>;
  applyRouteFailureFenced(input: {
    outboxLease: InboxV2ProviderDispatchLeaseFence;
    commit: InboxV2OutboundDispatchRouteFailureCommit;
  }): Promise<InboxV2ProviderDispatchFencedMutationResult>;
  reconcileFenced(input: {
    outboxLease: InboxV2ProviderDispatchLeaseFence;
    commit: InboxV2OutboundDispatchReconciliationCommit;
  }): Promise<InboxV2ProviderDispatchFencedMutationResult>;
}>;

export type InboxV2ProviderDispatchAdapterResult =
  | Readonly<{
      outcome: "accepted";
      providerAcknowledgementToken: string | null;
    }>
  | Readonly<{
      outcome: "retryable_failure";
      retryAt: string;
      diagnostic: InboxV2SafeSourceDiagnostic;
    }>
  | Readonly<{
      outcome: "terminal_failure";
      diagnostic: InboxV2SafeSourceDiagnostic;
    }>
  | Readonly<{
      outcome: "outcome_unknown";
      diagnostic: InboxV2SafeSourceDiagnostic;
    }>;

export type InboxV2ProviderDispatchAdapterPort<TRequest = unknown> = Readonly<{
  dispatch(input: {
    intent: InboxV2OutboxIntent;
    dispatch: InboxV2OutboundDispatch;
    route: InboxV2OutboundRoute;
    attempt: OpenAttemptCommit["attempt"];
    request: TRequest;
    signal: AbortSignal;
  }): Promise<InboxV2ProviderDispatchAdapterResult>;
}>;

export type InboxV2ProviderDispatchPlan<TRequest = unknown> =
  | Readonly<{
      /** Exact structural/runtime preflight failure; never invokes an adapter. */
      kind: "route_failure";
      commit: InboxV2OutboundDispatchRouteFailureCommit;
    }>
  | Readonly<{
      kind: "open_attempt";
      commit: OpenAttemptCommit;
      request: TRequest;
    }>
  | Readonly<{
      /** Recovery closes an already-open attempt and never invokes an adapter. */
      kind: "recover_attempt";
      commit: CompleteAttemptCommit;
    }>
  | Readonly<{
      /** Reconciliation is exact durable evidence and never invokes an adapter. */
      kind: "reconcile";
      commit: InboxV2OutboundDispatchReconciliationCommit;
    }>
  | Readonly<{
      /**
       * Crash recovery after the domain outcome committed but before outbox
       * finalization. The exact durable commit is replayed without provider I/O.
       */
      kind: "finalize_durable";
      durableOutcome:
        | CompleteAttemptCommit
        | InboxV2OutboundDispatchReconciliationCommit;
    }>
  | Readonly<{
      kind: "wait";
      reason:
        | "reconciliation_required"
        | "operator_duplicate_risk_decision_required"
        | "retry_not_due"
        | "terminal";
    }>;

export type InboxV2ProviderDispatchPlanner<TRequest = unknown> = Readonly<{
  plan(input: {
    claimKind: InboxV2OutboxClaim["claimKind"];
    loaded: InboxV2ProviderDispatchLoadedState;
  }):
    | InboxV2ProviderDispatchPlan<TRequest>
    | Promise<InboxV2ProviderDispatchPlan<TRequest>>;
}>;

export type InboxV2ProviderDispatchClock = Readonly<{
  now(): string;
}>;

export type InboxV2ProviderDispatchTimer = Readonly<{
  set(callback: () => void, delayMs: number): unknown;
  clear(handle: unknown): void;
}>;

export type InboxV2ProviderDispatchProcessResult =
  | Readonly<{ outcome: "aborted_before_open" }>
  | Readonly<{
      outcome: "load_rejected";
      reason: InboxV2ProviderDispatchLoadRejected["kind"];
    }>
  | Readonly<{
      outcome: "waiting";
      reason: Extract<InboxV2ProviderDispatchPlan, { kind: "wait" }>["reason"];
    }>
  | Readonly<{
      outcome: "recovery_required";
      reason: "open_already_applied";
    }>
  | Readonly<{
      outcome: "mutation_rejected";
      stage: "open" | "complete" | "recover" | "reconcile" | "route_failure";
      reason: FencedMutationRejectionKind;
    }>
  | Readonly<{
      outcome: "finalized";
      source: FinalizationSource;
      result: SuccessfulFinalizeResult;
    }>
  | Readonly<{
      outcome: "finalize_rejected";
      source: FinalizationSource;
      reason: RejectedFinalizeResult["outcome"];
      result: RejectedFinalizeResult;
    }>;

export type InboxV2ProviderDispatchCoordinator = Readonly<{
  process(
    claim: InboxV2OutboxClaim,
    options?: Readonly<{ signal?: AbortSignal }>
  ): Promise<InboxV2ProviderDispatchProcessResult>;
}>;

export type InboxV2ProviderDispatchCoordinatorOptions<TRequest = unknown> =
  Readonly<{
    outbox: Pick<InboxV2OutboxWorkRepositoryPort, "finalize">;
    transport: InboxV2ProviderDispatchTransportPort;
    planner: InboxV2ProviderDispatchPlanner<TRequest>;
    adapter: InboxV2ProviderDispatchAdapterPort<TRequest>;
    completedByTrustedServiceId: CompleteAttemptCommit["completedByTrustedServiceId"];
    expectedHandlerId: InboxV2OutboxIntent["handlerId"];
    providerDeadlineMs: number;
    clock?: InboxV2ProviderDispatchClock;
    timer?: InboxV2ProviderDispatchTimer;
  }>;

export type InboxV2ProviderDispatchCoordinatorErrorCode =
  | "provider_dispatch.invalid_options"
  | "provider_dispatch.invalid_intent_linkage"
  | "provider_dispatch.invalid_plan"
  | "provider_dispatch.invalid_retry_safety";

export class InboxV2ProviderDispatchCoordinatorError extends Error {
  readonly retryable = false;

  constructor(readonly code: InboxV2ProviderDispatchCoordinatorErrorCode) {
    super(code);
    this.name = "InboxV2ProviderDispatchCoordinatorError";
  }
}

const systemClock: InboxV2ProviderDispatchClock = Object.freeze({
  now: () => new Date().toISOString()
});

const systemTimer: InboxV2ProviderDispatchTimer = Object.freeze({
  set: (callback, delayMs) => setTimeout(callback, delayMs),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
});

/**
 * Executes one provider-I/O outbox claim. The method deliberately processes a
 * single transition: recovery/reconciliation never fall through into a fresh
 * provider call, and an already-applied open always returns to durable state.
 */
export function createInboxV2ProviderDispatchCoordinator<TRequest = unknown>(
  options: InboxV2ProviderDispatchCoordinatorOptions<TRequest>
): InboxV2ProviderDispatchCoordinator {
  assertOptions(options);
  const clock = options.clock ?? systemClock;
  const timer = options.timer ?? systemTimer;

  return Object.freeze({
    async process(claimInput, processOptions = {}) {
      if (isAborted(processOptions.signal)) {
        return { outcome: "aborted_before_open" };
      }

      const claim = inboxV2OutboxClaimSchema.parse(claimInput);
      const lease = claim.work.lease;
      if (lease === null) {
        throw coordinatorError("provider_dispatch.invalid_plan");
      }
      const fence = {
        context: { tenantId: claim.work.tenantId },
        intentId: claim.work.intentId,
        workerId: lease.workerId,
        leaseToken: claim.leaseToken,
        expectedLeaseRevision: lease.leaseRevision,
        expectedHandlerId: options.expectedHandlerId
      } satisfies InboxV2ProviderDispatchLeaseFence;

      const loadedResult = await options.transport.loadClaimedProviderIo({
        outboxLease: fence
      });
      if (loadedResult.kind !== "loaded") {
        return { outcome: "load_rejected", reason: loadedResult.kind };
      }
      const loaded = validateLoadedLinkage(
        claim,
        loadedResult,
        options.expectedHandlerId
      );
      if (loaded.dispatch.state === "cancelled") {
        return finalize(
          options.outbox,
          fence,
          deriveReroutedFinalization(loaded.intent, loaded.dispatch),
          "rerouted"
        );
      }
      const plan = await options.planner.plan({
        claimKind: claim.claimKind,
        loaded
      });

      if (plan.kind === "wait") {
        return { outcome: "waiting", reason: plan.reason };
      }
      if (plan.kind === "finalize_durable") {
        const durableOutcome = parseDurableOutcome(
          plan.durableOutcome,
          loaded.dispatch
        );
        return finalize(
          options.outbox,
          fence,
          deriveFinalization(fence.intentId, durableOutcome),
          "durable_outcome"
        );
      }
      if (plan.kind === "route_failure") {
        const commit = parseRouteFailureCommit(plan.commit, loaded.dispatch);
        const applied = await options.transport.applyRouteFailureFenced({
          outboxLease: fence,
          commit
        });
        return finishRouteFailure(options.outbox, fence, applied, commit);
      }
      if (plan.kind === "recover_attempt") {
        const commit = parseRecoveryCommit(plan.commit, loaded.dispatch);
        const applied = await options.transport.applyAttemptFenced({
          outboxLease: fence,
          commit
        });
        return finishMutation(
          options.outbox,
          fence,
          applied,
          "recover",
          "recover",
          commit
        );
      }
      if (plan.kind === "reconcile") {
        const commit = parseReconciliationCommit(plan.commit, loaded.dispatch);
        const applied = await options.transport.reconcileFenced({
          outboxLease: fence,
          commit
        });
        return finishMutation(
          options.outbox,
          fence,
          applied,
          "reconcile",
          "reconcile",
          commit
        );
      }

      if (claim.claimKind === "reclaimed") {
        // A reclaimed execution is a recovery turn. Even a planner bug cannot
        // convert it directly into an external side effect. Release a claim
        // that crashed before opening so the next claim is an initial turn.
        return finalize(
          options.outbox,
          fence,
          deriveRecoveryTurnFinalization(
            loaded.intent,
            loaded.dispatch,
            "reclaimed_before_open"
          ),
          "recovery_turn"
        );
      }
      if (isAborted(processOptions.signal)) {
        return { outcome: "aborted_before_open" };
      }

      const openCommit = parseOpenCommit(plan.commit, loaded.dispatch);
      assertRetrySafety(openCommit);
      const opened = await options.transport.applyAttemptFenced({
        outboxLease: fence,
        commit: openCommit
      });
      if (opened.kind === "dispatch_cancelled") {
        return finalize(
          options.outbox,
          fence,
          deriveReroutedFinalization(loaded.intent, loaded.dispatch),
          "rerouted"
        );
      }
      if (opened.kind !== "committed" && opened.kind !== "already_applied") {
        return {
          outcome: "mutation_rejected",
          stage: "open",
          reason: opened.kind
        };
      }
      if (opened.kind === "already_applied") {
        // A concurrent same-lease invocation may be between its open commit
        // and provider outcome. Keep the lease until that owner completes or
        // expiry moves the work into an explicit recovery turn.
        return {
          outcome: "recovery_required",
          reason: "open_already_applied"
        };
      }
      const providerRun = await runProviderCall({
        adapter: options.adapter,
        request: plan.request,
        intent: loaded.intent,
        openCommit,
        deadlineMs: options.providerDeadlineMs,
        signal: processOptions.signal,
        clock,
        timer
      });
      const completedAt = inboxV2TimestampSchema.parse(clock.now());
      const completion = buildCompletionCommit(
        openCommit,
        providerRun,
        completedAt,
        options.completedByTrustedServiceId
      );
      const completed = await options.transport.applyAttemptFenced({
        outboxLease: fence,
        commit: completion
      });
      return finishMutation(
        options.outbox,
        fence,
        completed,
        "complete",
        "provider_result",
        completion
      );
    }
  });
}

function assertOptions<TRequest>(
  options: InboxV2ProviderDispatchCoordinatorOptions<TRequest>
): void {
  if (
    !Number.isSafeInteger(options.providerDeadlineMs) ||
    options.providerDeadlineMs < 1 ||
    options.providerDeadlineMs > 300_000
  ) {
    throw coordinatorError("provider_dispatch.invalid_options");
  }
}

function validateLoadedLinkage(
  claim: InboxV2OutboxClaim,
  input: InboxV2ProviderDispatchLoadedState,
  expectedHandlerId: InboxV2OutboxIntent["handlerId"]
): InboxV2ProviderDispatchLoadedState {
  const intent = inboxV2OutboxIntentSchema.parse(input.intent);
  const dispatch = inboxV2OutboundDispatchSchema.parse(input.dispatch);
  const reference = intent.payloadReference;
  if (
    intent.tenantId !== claim.work.tenantId ||
    intent.id !== claim.work.intentId ||
    intent.handlerId !== expectedHandlerId ||
    intent.typeId !== "core:provider.dispatch" ||
    intent.effectClass !== "provider_io" ||
    intent.changeIds.length === 0 ||
    reference === null ||
    reference.tenantId !== intent.tenantId ||
    reference.schemaId !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID ||
    reference.schemaVersion !== INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION ||
    String(reference.recordId) !== String(dispatch.id) ||
    dispatch.tenantId !== intent.tenantId
  ) {
    throw coordinatorError("provider_dispatch.invalid_intent_linkage");
  }
  return { ...input, intent, dispatch };
}

function parseOpenCommit(
  input: OpenAttemptCommit,
  loadedDispatch: InboxV2OutboundDispatch
): OpenAttemptCommit {
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(input);
  if (
    commit.kind !== "open_attempt" ||
    !sameDispatchHead(commit.dispatchBefore, loadedDispatch)
  ) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function parseCompleteCommit(
  input: CompleteAttemptCommit,
  loadedDispatch: InboxV2OutboundDispatch
): CompleteAttemptCommit {
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(input);
  if (
    commit.kind !== "complete_attempt" ||
    !sameDispatchHead(commit.dispatchBefore, loadedDispatch)
  ) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function parseRecoveryCommit(
  input: CompleteAttemptCommit,
  loadedDispatch: InboxV2OutboundDispatch
): CompleteAttemptCommit {
  const commit = parseCompleteCommit(input, loadedDispatch);
  if (
    commit.completionSource !== "lease_expired" ||
    commit.attemptAfter.outcome.kind !== "outcome_unknown"
  ) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function parseReconciliationCommit(
  input: InboxV2OutboundDispatchReconciliationCommit,
  loadedDispatch: InboxV2OutboundDispatch
): InboxV2OutboundDispatchReconciliationCommit {
  const commit = inboxV2OutboundDispatchReconciliationCommitSchema.parse(input);
  if (!sameDispatchHead(commit.dispatchBefore, loadedDispatch)) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function parseRouteFailureCommit(
  input: InboxV2OutboundDispatchRouteFailureCommit,
  loadedDispatch: InboxV2OutboundDispatch
): InboxV2OutboundDispatchRouteFailureCommit {
  const commit = inboxV2OutboundDispatchRouteFailureCommitSchema.parse(input);
  if (!sameDispatchHead(commit.dispatchBefore, loadedDispatch)) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function parseDurableOutcome(
  input: CompleteAttemptCommit | InboxV2OutboundDispatchReconciliationCommit,
  loadedDispatch: InboxV2OutboundDispatch
): CompleteAttemptCommit | InboxV2OutboundDispatchReconciliationCommit {
  if ("kind" in input) {
    const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse(input);
    if (
      commit.kind !== "complete_attempt" ||
      !sameDispatchHead(commit.dispatchAfter, loadedDispatch)
    ) {
      throw coordinatorError("provider_dispatch.invalid_plan");
    }
    return commit;
  }
  const commit = inboxV2OutboundDispatchReconciliationCommitSchema.parse(input);
  if (!sameDispatchHead(commit.dispatchAfter, loadedDispatch)) {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return commit;
}

function sameDispatchHead(
  left: InboxV2OutboundDispatch,
  right: InboxV2OutboundDispatch
): boolean {
  return (
    calculateInboxV2CanonicalSha256(left) ===
    calculateInboxV2CanonicalSha256(right)
  );
}

/** Additional invariant not yet encoded by the contract: automatic retry must
 * reuse the exact correlation mechanism pinned on the unknown attempt. */
function assertRetrySafety(commit: OpenAttemptCommit): void {
  const prior = commit.priorAttempt;
  if (prior?.outcome.kind !== "outcome_unknown") return;
  const decision = commit.retryAuthorizationDecision;
  if (decision === null || decision.result.state !== "retryable_failure") {
    throw coordinatorError("provider_dispatch.invalid_retry_safety");
  }
  if (decision.result.authorization.kind !== "automatic") return;
  if (
    !prior.retrySafety.automaticRetryAllowed ||
    prior.retrySafety.mechanism === "unsafe_or_unknown" ||
    prior.retrySafety.providerCorrelationToken === null ||
    commit.attempt.retrySafety.mechanism !== prior.retrySafety.mechanism ||
    commit.attempt.retrySafety.providerCorrelationToken !==
      prior.retrySafety.providerCorrelationToken ||
    !commit.attempt.retrySafety.automaticRetryAllowed
  ) {
    throw coordinatorError("provider_dispatch.invalid_retry_safety");
  }
}

type ProviderRun =
  | Readonly<{
      kind: "provider_result";
      result: InboxV2ProviderDispatchAdapterResult;
    }>
  | Readonly<{
      kind: "uncertain";
      reason:
        | "deadline"
        | "aborted"
        | "adapter_error"
        | "invalid_result"
        | "lease_expired";
    }>;

async function runProviderCall<TRequest>(input: {
  adapter: InboxV2ProviderDispatchAdapterPort<TRequest>;
  request: TRequest;
  intent: InboxV2OutboxIntent;
  openCommit: OpenAttemptCommit;
  deadlineMs: number;
  signal: AbortSignal | undefined;
  clock: InboxV2ProviderDispatchClock;
  timer: InboxV2ProviderDispatchTimer;
}): Promise<ProviderRun> {
  const now = Date.parse(inboxV2TimestampSchema.parse(input.clock.now()));
  const leaseExpiry = Date.parse(input.openCommit.attempt.leaseExpiresAt);
  const remainingLeaseMs = leaseExpiry - now;
  if (remainingLeaseMs <= 0) {
    return { kind: "uncertain", reason: "lease_expired" };
  }

  const controller = new AbortController();
  let abortReason: "deadline" | "aborted" = "deadline";
  const externalAbort = () => {
    abortReason = "aborted";
    controller.abort();
  };
  input.signal?.addEventListener("abort", externalAbort, { once: true });
  if (input.signal?.aborted === true) externalAbort();
  const deadlineHandle = input.timer.set(
    () => controller.abort(),
    Math.min(input.deadlineMs, remainingLeaseMs)
  );

  // A pre-aborted caller or a deadline implementation that fires while the
  // provider invocation is being prepared must not reach the adapter at all.
  // Promise.race evaluates every operand eagerly, so relying on the rejected
  // `aborted` promise below would still call adapter.dispatch first.
  if (controller.signal.aborted) {
    input.timer.clear(deadlineHandle);
    input.signal?.removeEventListener("abort", externalAbort);
    return { kind: "uncertain", reason: abortReason };
  }

  const aborted = new Promise<never>((_resolve, reject) => {
    const rejectAbort = () => reject(new ProviderCallAbortedError(abortReason));
    if (controller.signal.aborted) rejectAbort();
    else
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
  });

  try {
    const result = await Promise.race([
      input.adapter.dispatch({
        intent: input.intent,
        dispatch: input.openCommit.dispatchBefore,
        route: input.openCommit.routeSnapshot,
        attempt: input.openCommit.attempt,
        request: input.request,
        signal: controller.signal
      }),
      aborted
    ]);
    try {
      return { kind: "provider_result", result: parseAdapterResult(result) };
    } catch {
      return { kind: "uncertain", reason: "invalid_result" };
    }
  } catch (error) {
    if (error instanceof ProviderCallAbortedError) {
      return { kind: "uncertain", reason: error.reason };
    }
    return { kind: "uncertain", reason: "adapter_error" };
  } finally {
    input.timer.clear(deadlineHandle);
    input.signal?.removeEventListener("abort", externalAbort);
  }
}

function parseAdapterResult(
  result: InboxV2ProviderDispatchAdapterResult
): InboxV2ProviderDispatchAdapterResult {
  if (result.outcome === "accepted") {
    return {
      outcome: "accepted",
      providerAcknowledgementToken:
        result.providerAcknowledgementToken === null
          ? null
          : inboxV2RoutingTokenSchema.parse(result.providerAcknowledgementToken)
    };
  }
  const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse(result.diagnostic);
  if (result.outcome === "retryable_failure") {
    if (!diagnostic.retryable)
      throw new TypeError("retryable diagnostic required");
    return {
      outcome: "retryable_failure",
      retryAt: inboxV2TimestampSchema.parse(result.retryAt),
      diagnostic
    };
  }
  if (result.outcome === "terminal_failure") {
    if (diagnostic.retryable)
      throw new TypeError("terminal diagnostic required");
    return { outcome: "terminal_failure", diagnostic };
  }
  return { outcome: "outcome_unknown", diagnostic };
}

function buildCompletionCommit(
  open: OpenAttemptCommit,
  run: ProviderRun,
  completedAt: string,
  completedByTrustedServiceId: CompleteAttemptCommit["completedByTrustedServiceId"]
): CompleteAttemptCommit {
  const leaseExpired =
    Date.parse(completedAt) >= Date.parse(open.attempt.leaseExpiresAt);
  const outcome = leaseExpired
    ? unknownOutcome(open, completedAt, "lease_expired")
    : run.kind === "uncertain"
      ? unknownOutcome(open, completedAt, run.reason)
      : providerOutcome(run.result, completedAt, open);
  const completionSource = leaseExpired ? "lease_expired" : "provider_result";
  const attemptAfter = {
    ...open.attempt,
    outcome,
    completionSource,
    revision: "2"
  } as const;
  const dispatchAfter = {
    ...open.dispatchAfter,
    state: outcome.kind,
    activeAttempt: null,
    revision: incrementRevision(open.dispatchAfter.revision),
    updatedAt: completedAt
  } as const;
  const parsed = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    kind: "complete_attempt",
    tenantId: open.tenantId,
    dispatchBefore: open.dispatchAfter,
    attemptBefore: open.attempt,
    attemptAfter,
    completionSource,
    completedByTrustedServiceId,
    dispatchAfter
  });
  if (parsed.kind !== "complete_attempt") {
    throw coordinatorError("provider_dispatch.invalid_plan");
  }
  return parsed;
}

function providerOutcome(
  result: InboxV2ProviderDispatchAdapterResult,
  completedAt: string,
  open: OpenAttemptCommit
) {
  if (result.outcome === "accepted") {
    return {
      kind: "accepted" as const,
      completedAt,
      providerAcknowledgementToken: result.providerAcknowledgementToken
    };
  }
  if (result.outcome === "retryable_failure") {
    return {
      kind: "retryable_failure" as const,
      completedAt,
      retryAt: result.retryAt,
      diagnostic: result.diagnostic
    };
  }
  if (result.outcome === "terminal_failure") {
    return {
      kind: "terminal_failure" as const,
      completedAt,
      diagnostic: result.diagnostic
    };
  }
  return {
    kind: "outcome_unknown" as const,
    completedAt,
    diagnostic: result.diagnostic,
    requiredAction: requiredUnknownAction(open)
  };
}

function unknownOutcome(
  open: OpenAttemptCommit,
  completedAt: string,
  reason: Extract<ProviderRun, { kind: "uncertain" }>["reason"]
) {
  const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse({
    codeId: uncertaintyCode(reason),
    retryable: false,
    correlationToken: open.attempt.claimToken,
    safeOperatorHintId: "core:reconcile-before-retry"
  });
  return {
    kind: "outcome_unknown" as const,
    completedAt,
    diagnostic,
    requiredAction: requiredUnknownAction(open)
  };
}

function requiredUnknownAction(open: OpenAttemptCommit) {
  return open.attempt.retrySafety.automaticRetryAllowed
    ? ("automated_reconciliation_required" as const)
    : ("operator_duplicate_risk_decision_required" as const);
}

function uncertaintyCode(
  reason: Extract<ProviderRun, { kind: "uncertain" }>["reason"]
): InboxV2SafeSourceDiagnostic["codeId"] {
  const codes = {
    deadline: "core:provider-deadline-exceeded",
    aborted: "core:provider-dispatch-aborted",
    adapter_error: "core:provider-outcome-unknown",
    invalid_result: "core:provider-result-invalid",
    lease_expired: "core:provider-attempt-lease-expired"
  } as const;
  return inboxV2SourceDiagnosticIdSchema.parse(codes[reason]);
}

async function finishMutation(
  outbox: Pick<InboxV2OutboxWorkRepositoryPort, "finalize">,
  fence: InboxV2ProviderDispatchLeaseFence,
  mutation: InboxV2ProviderDispatchFencedMutationResult,
  stage: "complete" | "recover" | "reconcile",
  source: "provider_result" | "recover" | "reconcile",
  durableOutcome:
    | CompleteAttemptCommit
    | InboxV2OutboundDispatchReconciliationCommit
): Promise<InboxV2ProviderDispatchProcessResult> {
  if (mutation.kind !== "committed" && mutation.kind !== "already_applied") {
    return {
      outcome: "mutation_rejected",
      stage,
      reason: mutation.kind
    };
  }
  const instruction = deriveFinalization(fence.intentId, durableOutcome);
  return finalize(outbox, fence, instruction, source);
}

async function finishRouteFailure(
  outbox: Pick<InboxV2OutboxWorkRepositoryPort, "finalize">,
  fence: InboxV2ProviderDispatchLeaseFence,
  mutation: InboxV2ProviderDispatchFencedMutationResult,
  commit: InboxV2OutboundDispatchRouteFailureCommit
): Promise<InboxV2ProviderDispatchProcessResult> {
  if (mutation.kind !== "committed" && mutation.kind !== "already_applied") {
    return {
      outcome: "mutation_rejected",
      stage: "route_failure",
      reason: mutation.kind
    };
  }
  return finalize(
    outbox,
    fence,
    deriveRouteFailureFinalization(fence.intentId, commit),
    "route_failure"
  );
}

function deriveRouteFailureFinalization(
  intentId: InboxV2ProviderDispatchLeaseFence["intentId"],
  commit: InboxV2OutboundDispatchRouteFailureCommit
): InboxV2OutboxFinalizeInstruction {
  return deriveInboxV2RouteFailureOutboxFinalization({ intentId, commit });
}

function deriveFinalization(
  intentId: InboxV2ProviderDispatchLeaseFence["intentId"],
  durableOutcome:
    | CompleteAttemptCommit
    | InboxV2OutboundDispatchReconciliationCommit
): InboxV2OutboxFinalizeInstruction {
  const resultHash = calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.provider-dispatch-outbox-outcome",
    hashVersion: "v1",
    intentId,
    durableOutcome
  });
  if ("kind" in durableOutcome) {
    const outcome = durableOutcome.attemptAfter.outcome;
    if (outcome.kind === "accepted") {
      return { kind: "processed", resultHash, resultReference: null };
    }
    if (outcome.kind === "terminal_failure") {
      return {
        kind: "dead",
        resultHash,
        errorCode: diagnosticErrorCode(outcome.diagnostic),
        resultReference: null
      };
    }
    if (outcome.kind === "outcome_unknown") {
      return {
        kind: "retry",
        resultHash,
        errorCode: diagnosticErrorCode(outcome.diagnostic),
        retryAfterSeconds: 1
      };
    }
    if (outcome.kind === "retryable_failure") {
      return {
        kind: "retry",
        resultHash,
        errorCode: diagnosticErrorCode(outcome.diagnostic),
        retryAfterSeconds: boundedRetryAfterSeconds(
          outcome.completedAt,
          outcome.retryAt
        )
      };
    }
    throw coordinatorError("provider_dispatch.invalid_plan");
  }

  const result = durableOutcome.decision.result;
  if (result.state === "accepted") {
    return { kind: "processed", resultHash, resultReference: null };
  }
  if (result.state === "terminal_failure") {
    return {
      kind: "dead",
      resultHash,
      errorCode: diagnosticErrorCode(result.diagnostic),
      resultReference: null
    };
  }
  return {
    kind: "retry",
    resultHash,
    errorCode: diagnosticErrorCode(result.diagnostic),
    retryAfterSeconds: boundedRetryAfterSeconds(
      durableOutcome.decision.decidedAt,
      result.retryAt
    )
  };
}

function deriveRecoveryTurnFinalization(
  intent: InboxV2OutboxIntent,
  dispatch: InboxV2OutboundDispatch,
  reason: "reclaimed_before_open"
): InboxV2OutboxFinalizeInstruction {
  return {
    kind: "retry",
    resultHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.provider-dispatch-recovery-turn",
      hashVersion: "v1",
      intentId: intent.id,
      intentHash: intent.intentHash,
      dispatch,
      reason
    }),
    errorCode: inboxV2NamespacedIdSchema.parse(
      "core:provider-recovery-turn-required"
    ),
    retryAfterSeconds: 1
  };
}

function deriveReroutedFinalization(
  intent: InboxV2OutboxIntent,
  dispatch: InboxV2OutboundDispatch
): InboxV2OutboxFinalizeInstruction {
  return {
    kind: "processed",
    resultHash: calculateInboxV2CanonicalSha256({
      domain: "core:inbox-v2.provider-dispatch-rerouted",
      hashVersion: "v1",
      intentId: intent.id,
      intentHash: intent.intentHash,
      dispatchId: dispatch.id,
      routeId: dispatch.route.id
    }),
    resultReference: null
  };
}

function boundedRetryAfterSeconds(from: string, to: string): number {
  return Math.max(
    1,
    Math.min(86_400, Math.ceil((Date.parse(to) - Date.parse(from)) / 1_000))
  );
}

function diagnosticErrorCode(
  diagnostic: InboxV2SafeSourceDiagnostic
): ReturnType<typeof inboxV2NamespacedIdSchema.parse> {
  return inboxV2NamespacedIdSchema.parse(diagnostic.codeId);
}

async function finalize(
  outbox: Pick<InboxV2OutboxWorkRepositoryPort, "finalize">,
  fence: InboxV2ProviderDispatchLeaseFence,
  instruction: InboxV2OutboxFinalizeInstruction,
  source: FinalizationSource
): Promise<InboxV2ProviderDispatchProcessResult> {
  const { expectedHandlerId: _expectedHandlerId, ...outboxFence } = fence;
  const result = await outbox.finalize({ ...outboxFence, instruction });
  switch (result.outcome) {
    case "retry_scheduled":
    case "processed":
    case "dead":
    case "already_finalized":
      return { outcome: "finalized", source, result };
    default:
      return {
        outcome: "finalize_rejected",
        source,
        reason: result.outcome,
        result
      };
  }
}

function incrementRevision(revision: string): string {
  return (BigInt(revision) + 1n).toString();
}

function isAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

class ProviderCallAbortedError extends Error {
  constructor(readonly reason: "deadline" | "aborted") {
    super(reason);
    this.name = "ProviderCallAbortedError";
  }
}

function coordinatorError(
  code: InboxV2ProviderDispatchCoordinatorErrorCode
): InboxV2ProviderDispatchCoordinatorError {
  return new InboxV2ProviderDispatchCoordinatorError(code);
}
