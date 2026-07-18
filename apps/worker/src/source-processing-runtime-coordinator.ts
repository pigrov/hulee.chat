import {
  inboxV2ApplySourceProcessingOutcomeInputSchema,
  inboxV2NamespacedIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceBackpressurePolicySchema,
  inboxV2SourceProcessingOutcomeSchema,
  inboxV2SourceProcessingRuntimeClaimSchema,
  inboxV2SourceDeadLetterRecordSchema,
  inboxV2SourceProcessingStageSchema,
  inboxV2SourceRateLimitHintSchema,
  inboxV2SourceReplayRequestSchema,
  inboxV2SourceReplayResultSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ApplySourceProcessingOutcomeResult,
  type InboxV2ClaimSourceProcessingRuntimeResult,
  type InboxV2SafeSourceDiagnostic,
  type InboxV2SourceBackpressurePolicy,
  type InboxV2SourceDeadLetterRecord,
  type InboxV2SourceEvidenceDeadlines,
  type InboxV2SourceProcessingAttempt,
  type InboxV2SourceProcessingOutcome,
  type InboxV2SourceProcessingRuntimeClaim as ContractRuntimeClaim,
  type InboxV2SourceProcessingRuntimeRepositoryPort as ContractRuntimeRepositoryPort,
  type InboxV2SourceProcessingStage,
  type InboxV2SourceRateLimitHint,
  type InboxV2SourceReplayRequest,
  type InboxV2SourceReplayResult
} from "@hulee/contracts";

const SOURCE_PROCESSING_STAGES =
  inboxV2SourceProcessingStageSchema.options as readonly InboxV2SourceProcessingStage[];

export type InboxV2SourceProcessingRuntimeClaim = ContractRuntimeClaim;
export type InboxV2SourceProcessingRuntimeClaimResult =
  InboxV2ClaimSourceProcessingRuntimeResult;
export type InboxV2SourceProcessingRuntimeApplyResult =
  InboxV2ApplySourceProcessingOutcomeResult;
export type InboxV2SourceProcessingRuntimeRepositoryPort =
  ContractRuntimeRepositoryPort;

export type InboxV2SourceProcessingHandlerResult =
  | Readonly<{ kind: "processed" }>
  | Readonly<{
      kind: "ignored" | "duplicate";
      diagnostic: InboxV2SafeSourceDiagnostic;
    }>
  | Readonly<{
      kind: "failed";
      diagnostic: InboxV2SafeSourceDiagnostic;
      rateLimitHint?: InboxV2SourceRateLimitHint | null;
    }>;

export type InboxV2SourceProcessingStageHandler = Readonly<{
  process(
    claim: InboxV2SourceProcessingRuntimeClaim
  ):
    | InboxV2SourceProcessingHandlerResult
    | Promise<InboxV2SourceProcessingHandlerResult>;
}>;

export type InboxV2SourceProcessingDiagnosticClassifier = Readonly<{
  classify(input: {
    error: unknown;
    attempt: InboxV2SourceProcessingAttempt;
  }): InboxV2SafeSourceDiagnostic | Promise<InboxV2SafeSourceDiagnostic>;
}>;

export type InboxV2SourceProcessingRuntimeClock = Readonly<{
  now(): string | Promise<string>;
}>;

export type InboxV2SourceDeadLetterLifecycle = Readonly<{
  evidenceDeadlines: InboxV2SourceEvidenceDeadlines;
  replayNotAfter: string;
  expiresAt: string;
}>;

export type InboxV2SourceDeadLetterLifecycleResolver = Readonly<{
  resolve(input: {
    outcome: Extract<InboxV2SourceProcessingOutcome, { kind: "dead_lettered" }>;
  }):
    | InboxV2SourceDeadLetterLifecycle
    | Promise<InboxV2SourceDeadLetterLifecycle>;
}>;

export type InboxV2SourceProcessingRuntimeCoordinatorOptions = Readonly<{
  repository: InboxV2SourceProcessingRuntimeRepositoryPort;
  handlers: ReadonlyMap<
    InboxV2SourceProcessingStage,
    InboxV2SourceProcessingStageHandler
  >;
  diagnosticClassifier: InboxV2SourceProcessingDiagnosticClassifier;
  policy: InboxV2SourceBackpressurePolicy;
  workerId: string;
  leaseDurationSeconds: number;
  deadLetterIdSource(attempt: InboxV2SourceProcessingAttempt): string;
  deadLetterLifecycleResolver: InboxV2SourceDeadLetterLifecycleResolver;
  clock?: InboxV2SourceProcessingRuntimeClock;
  random?: () => number;
}>;

export type InboxV2SourceProcessingClaimRunResult = Readonly<{
  attemptId: string;
  workId: string;
  sourceAccountId: string | null;
  stage: InboxV2SourceProcessingStage;
  outcome:
    | InboxV2SourceProcessingOutcome["kind"]
    | InboxV2SourceProcessingRuntimeApplyResult["outcome"]
    | "runtime_failure";
  applyOutcome: InboxV2SourceProcessingRuntimeApplyResult["outcome"] | null;
}>;

export type InboxV2SourceProcessingRuntimeRunResult =
  | Readonly<{ outcome: "empty" }>
  | Readonly<{
      outcome: "backpressured";
      retryAt: string;
      scope: "tenant" | "source_connection" | "source_account";
    }>
  | Readonly<{
      outcome: "processed";
      claims: readonly InboxV2SourceProcessingClaimRunResult[];
    }>;

export type InboxV2SourceProcessingRuntimeCoordinator = Readonly<{
  runOnce(input: {
    tenantId: string;
  }): Promise<InboxV2SourceProcessingRuntimeRunResult>;
  requestReplay(
    request: InboxV2SourceReplayRequest
  ): Promise<InboxV2SourceReplayResult>;
}>;

/**
 * Provider-neutral SRC-008 scheduler. Claim fairness and durable pressure
 * counters live in the repository; this coordinator additionally bounds the
 * in-process fan-out and converts every handler result into a strict,
 * payload-free outcome before persistence.
 */
export function createInboxV2SourceProcessingRuntimeCoordinator(
  options: InboxV2SourceProcessingRuntimeCoordinatorOptions
): InboxV2SourceProcessingRuntimeCoordinator {
  assertRuntimeOptions(options);
  const policy = inboxV2SourceBackpressurePolicySchema.parse(options.policy);
  const workerId = inboxV2NamespacedIdSchema.parse(options.workerId);
  const clock = options.clock ?? systemClock;
  const random = options.random ?? Math.random;

  return Object.freeze({
    async runOnce(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const claimResult = await options.repository.claim({
        tenantId,
        workerId,
        leaseDurationSeconds: options.leaseDurationSeconds,
        policy
      });
      if (claimResult.outcome !== "claimed") return claimResult;

      const claims = claimResult.claims.map(parseClaim);
      if (claims.length === 0 || claims.length > policy.maxClaimBatch) {
        throw new TypeError(
          "Source-processing repository returned an invalid claim batch."
        );
      }
      assertClaimBatchScope(claims, tenantId, policy);

      const results = await processFairBatch({
        claims,
        policy,
        process: (claim) => processClaim(options, policy, clock, random, claim)
      });
      return Object.freeze({ outcome: "processed" as const, claims: results });
    },

    async requestReplay(rawRequest) {
      const request = inboxV2SourceReplayRequestSchema.parse(rawRequest);
      return inboxV2SourceReplayResultSchema.parse(
        await options.repository.requestReplay(request)
      );
    }
  });
}

async function processClaim(
  options: InboxV2SourceProcessingRuntimeCoordinatorOptions,
  policy: InboxV2SourceBackpressurePolicy,
  clock: InboxV2SourceProcessingRuntimeClock,
  random: () => number,
  claim: InboxV2SourceProcessingRuntimeClaim
): Promise<InboxV2SourceProcessingClaimRunResult> {
  const attempt = claim.attempt;
  const handler = options.handlers.get(attempt.scope.stage);
  let result: InboxV2SourceProcessingHandlerResult;
  if (handler === undefined) {
    result = {
      kind: "failed",
      diagnostic: fallbackDiagnostic(attempt, false, "handler-missing")
    };
  } else {
    try {
      result = parseHandlerResult(await handler.process(claim));
    } catch (error) {
      result = {
        kind: "failed",
        diagnostic: await classifyFailure(options, attempt, error)
      };
    }
  }

  const completedAt = inboxV2TimestampSchema.parse(await clock.now());
  if (Date.parse(completedAt) >= Date.parse(attempt.leaseExpiresAt)) {
    return claimRunResult(attempt, "lease_expired", null);
  }
  const outcome = buildOutcome({
    attempt,
    completedAt,
    result,
    policy,
    random,
    deadLetterIdSource: options.deadLetterIdSource
  });
  const deadLetterRecord = await buildDeadLetterRecord(options, outcome);
  const applyInput = inboxV2ApplySourceProcessingOutcomeInputSchema.parse({
    leaseToken: claim.leaseToken,
    outcome,
    deadLetterRecord
  });
  const applied = await options.repository.applyOutcome(applyInput);
  return claimRunResult(
    attempt,
    applied.outcome === "applied" || applied.outcome === "already_applied"
      ? outcome.kind
      : applied.outcome,
    applied.outcome
  );
}

async function buildDeadLetterRecord(
  options: InboxV2SourceProcessingRuntimeCoordinatorOptions,
  outcome: InboxV2SourceProcessingOutcome
): Promise<InboxV2SourceDeadLetterRecord | null> {
  if (outcome.kind !== "dead_lettered") return null;
  const lifecycle = await options.deadLetterLifecycleResolver.resolve({
    outcome
  });
  return inboxV2SourceDeadLetterRecordSchema.parse({
    deadLetterId: outcome.deadLetter.id,
    attempt: outcome.attempt,
    reason: outcome.deadLetter.reason,
    diagnostic: outcome.diagnostic,
    deadLetteredAt: outcome.deadLetter.deadLetteredAt,
    evidenceDeadlines: lifecycle.evidenceDeadlines,
    replayNotAfter: lifecycle.replayNotAfter,
    expiresAt: lifecycle.expiresAt
  });
}

function buildOutcome(input: {
  attempt: InboxV2SourceProcessingAttempt;
  completedAt: string;
  result: InboxV2SourceProcessingHandlerResult;
  policy: InboxV2SourceBackpressurePolicy;
  random: () => number;
  deadLetterIdSource(attempt: InboxV2SourceProcessingAttempt): string;
}): InboxV2SourceProcessingOutcome {
  const { attempt, completedAt, result } = input;
  if (result.kind === "processed") {
    return inboxV2SourceProcessingOutcomeSchema.parse({
      kind: "processed",
      attempt,
      completedAt,
      diagnostic: null
    });
  }
  if (result.kind === "ignored" || result.kind === "duplicate") {
    return inboxV2SourceProcessingOutcomeSchema.parse({
      kind: result.kind,
      attempt,
      completedAt,
      diagnostic: result.diagnostic
    });
  }
  if (result.kind !== "failed") {
    throw new TypeError("Source-processing result is not exhaustive.");
  }

  const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse(result.diagnostic);
  if (diagnostic.retryable && attempt.attemptNumber < attempt.maxAttempts) {
    const nextAttemptAt = retryAt({
      completedAt,
      attemptNumber: attempt.attemptNumber,
      policy: input.policy,
      random: input.random,
      rateLimitHint: result.rateLimitHint ?? null
    });
    return inboxV2SourceProcessingOutcomeSchema.parse({
      kind: "retry_scheduled",
      attempt,
      completedAt,
      diagnostic,
      retry: {
        reason:
          result.rateLimitHint === undefined || result.rateLimitHint === null
            ? "bounded_backoff"
            : "rate_limited",
        nextAttemptAt,
        rateLimitHint: result.rateLimitHint ?? null
      }
    });
  }

  return inboxV2SourceProcessingOutcomeSchema.parse({
    kind: "dead_lettered",
    attempt,
    completedAt,
    diagnostic,
    deadLetter: {
      id: input.deadLetterIdSource(attempt),
      reason: diagnostic.retryable ? "attempts_exhausted" : "terminal_failure",
      deadLetteredAt: completedAt
    }
  });
}

function retryAt(input: {
  completedAt: string;
  attemptNumber: number;
  policy: InboxV2SourceBackpressurePolicy;
  random: () => number;
  rateLimitHint: InboxV2SourceRateLimitHint | null;
}): string {
  const randomValue = input.random();
  if (!Number.isFinite(randomValue) || randomValue < 0 || randomValue > 1) {
    throw new TypeError("Source-processing jitter source must return [0, 1].");
  }
  const exponent = Math.min(input.attemptNumber - 1, 30);
  const baseSeconds = Math.min(
    input.policy.maxRetryDelaySeconds,
    input.policy.baseRetryDelaySeconds * 2 ** exponent
  );
  const centered = randomValue * 2 - 1;
  const jitter = 1 + (centered * input.policy.jitterBasisPoints) / 10_000;
  const delayedAt =
    Date.parse(input.completedAt) +
    Math.max(1, Math.round(baseSeconds * jitter)) * 1_000;
  const hintedAt =
    input.rateLimitHint === null ? 0 : Date.parse(input.rateLimitHint.retryAt);
  return inboxV2TimestampSchema.parse(
    new Date(Math.max(delayedAt, hintedAt)).toISOString()
  );
}

async function classifyFailure(
  options: InboxV2SourceProcessingRuntimeCoordinatorOptions,
  attempt: InboxV2SourceProcessingAttempt,
  error: unknown
): Promise<InboxV2SafeSourceDiagnostic> {
  try {
    return inboxV2SafeSourceDiagnosticSchema.parse(
      await options.diagnosticClassifier.classify({ error, attempt })
    );
  } catch {
    // The original exception and invalid classifier output are deliberately
    // discarded. Only a fixed catalog diagnostic crosses the durable boundary.
    return fallbackDiagnostic(attempt, true, "classifier-rejected");
  }
}

function fallbackDiagnostic(
  attempt: InboxV2SourceProcessingAttempt,
  retryable: boolean,
  reason: "handler-missing" | "classifier-rejected"
): InboxV2SafeSourceDiagnostic {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId:
      reason === "handler-missing"
        ? "core:source-stage-handler-missing"
        : "core:source-processing-failure",
    retryable,
    correlationToken: attempt.attemptId,
    safeOperatorHintId:
      reason === "handler-missing"
        ? "core:install-source-stage-handler"
        : "core:inspect-source-runtime"
  });
}

function parseHandlerResult(
  raw: InboxV2SourceProcessingHandlerResult
): InboxV2SourceProcessingHandlerResult {
  if (raw === null || typeof raw !== "object") {
    throw new TypeError("Source-processing handler returned no result.");
  }
  if (raw.kind === "processed") return Object.freeze({ kind: "processed" });
  if (raw.kind === "ignored" || raw.kind === "duplicate") {
    const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse(raw.diagnostic);
    if (diagnostic.retryable) {
      throw new TypeError("Terminal source outcome cannot be retryable.");
    }
    return Object.freeze({ kind: raw.kind, diagnostic });
  }
  if (raw.kind === "failed") {
    return Object.freeze({
      kind: "failed" as const,
      diagnostic: inboxV2SafeSourceDiagnosticSchema.parse(raw.diagnostic),
      rateLimitHint:
        raw.rateLimitHint === undefined || raw.rateLimitHint === null
          ? null
          : inboxV2SourceRateLimitHintSchema.parse(raw.rateLimitHint)
    });
  }
  throw new TypeError("Source-processing handler returned an unknown result.");
}

async function processFairBatch(input: {
  claims: readonly InboxV2SourceProcessingRuntimeClaim[];
  policy: InboxV2SourceBackpressurePolicy;
  process(
    claim: InboxV2SourceProcessingRuntimeClaim
  ): Promise<InboxV2SourceProcessingClaimRunResult>;
}): Promise<readonly InboxV2SourceProcessingClaimRunResult[]> {
  const pending = [...input.claims];
  const running = new Set<Promise<void>>();
  const connectionCounts = new Map<string, number>();
  const accountCounts = new Map<string, number>();
  const results = new Array<InboxV2SourceProcessingClaimRunResult>(
    pending.length
  );

  const startEligible = (): boolean => {
    if (running.size >= input.policy.maxInFlightPerTenant) return false;
    const index = pending.findIndex((claim) => {
      const connection = String(claim.attempt.scope.sourceConnectionId);
      const account = partitionKey(claim.attempt);
      return (
        (connectionCounts.get(connection) ?? 0) <
          input.policy.maxInFlightPerConnection &&
        (accountCounts.get(account) ?? 0) < input.policy.maxInFlightPerAccount
      );
    });
    if (index < 0) return false;
    const claim = pending.splice(index, 1)[0]!;
    const originalIndex = input.claims.indexOf(claim);
    const connection = String(claim.attempt.scope.sourceConnectionId);
    const account = partitionKey(claim.attempt);
    connectionCounts.set(
      connection,
      (connectionCounts.get(connection) ?? 0) + 1
    );
    accountCounts.set(account, (accountCounts.get(account) ?? 0) + 1);
    const task = input
      .process(claim)
      .catch(() => claimRunResult(claim.attempt, "runtime_failure", null))
      .then((result) => {
        results[originalIndex] = result;
      })
      .finally(() => {
        decrement(connectionCounts, connection);
        decrement(accountCounts, account);
        running.delete(task);
      });
    running.add(task);
    return true;
  };

  while (pending.length > 0 || running.size > 0) {
    let started = false;
    while (startEligible()) started = true;
    if (running.size === 0) {
      if (!started && pending.length > 0) {
        throw new TypeError(
          "Source-processing policy cannot schedule its claims."
        );
      }
      break;
    }
    await Promise.race(running);
  }
  return Object.freeze(results);
}

function assertRuntimeOptions(
  options: InboxV2SourceProcessingRuntimeCoordinatorOptions
): void {
  if (
    options.repository === null ||
    typeof options.repository?.claim !== "function" ||
    typeof options.repository?.applyOutcome !== "function" ||
    typeof options.repository?.requestReplay !== "function" ||
    typeof options.repository?.acknowledgeCursor !== "function" ||
    typeof options.repository?.loadCursor !== "function" ||
    typeof options.repository?.writeDedupeSkeleton !== "function" ||
    typeof options.repository?.lookupDedupeSkeleton !== "function" ||
    typeof options.repository?.expireDedupeSkeleton !== "function" ||
    typeof options.repository?.expireDedupeReplayability !== "function" ||
    typeof options.repository?.rotateProcessingKeyGeneration !== "function" ||
    typeof options.repository?.retireProcessingKeyGeneration !== "function" ||
    options.diagnosticClassifier === null ||
    typeof options.diagnosticClassifier?.classify !== "function" ||
    typeof options.deadLetterIdSource !== "function" ||
    options.deadLetterLifecycleResolver === null ||
    typeof options.deadLetterLifecycleResolver?.resolve !== "function"
  ) {
    throw new TypeError(
      "Source-processing runtime requires durable lifecycle, replay, key-safe diagnostics and DLQ capabilities."
    );
  }
  if (
    !Number.isInteger(options.leaseDurationSeconds) ||
    options.leaseDurationSeconds < 1 ||
    options.leaseDurationSeconds > 300
  ) {
    throw new TypeError(
      "Source-processing lease must be between 1 and 300 seconds."
    );
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._~:-]{1,255}$/u.test(options.workerId)) {
    throw new TypeError("Source-processing worker ID is invalid.");
  }
  for (const stage of SOURCE_PROCESSING_STAGES) {
    const handler = options.handlers.get(stage);
    if (handler === undefined || typeof handler.process !== "function") {
      throw new TypeError(
        `Source-processing production runtime is missing stage capability: ${stage}.`
      );
    }
  }
}

function parseClaim(
  raw: InboxV2SourceProcessingRuntimeClaim
): InboxV2SourceProcessingRuntimeClaim {
  return Object.freeze(inboxV2SourceProcessingRuntimeClaimSchema.parse(raw));
}

function assertClaimBatchScope(
  claims: readonly InboxV2SourceProcessingRuntimeClaim[],
  tenantId: string,
  policy: InboxV2SourceBackpressurePolicy
): void {
  const attempts = new Set<string>();
  const accounts = new Map<string, number>();
  const connections = new Map<string, number>();
  for (const claim of claims) {
    if (claim.attempt.scope.tenantId !== tenantId) {
      throw new TypeError("Source-processing claim escaped its tenant scope.");
    }
    if (attempts.has(claim.attempt.attemptId)) {
      throw new TypeError("Source-processing claim batch repeated an attempt.");
    }
    attempts.add(claim.attempt.attemptId);
    const connection = String(claim.attempt.scope.sourceConnectionId);
    connections.set(connection, (connections.get(connection) ?? 0) + 1);
    if ((connections.get(connection) ?? 0) > policy.maxInFlightPerConnection) {
      throw new TypeError(
        "Source-processing claim exceeded its connection in-flight bound."
      );
    }
    const key = partitionKey(claim.attempt);
    accounts.set(key, (accounts.get(key) ?? 0) + 1);
    if ((accounts.get(key) ?? 0) > policy.maxInFlightPerAccount) {
      throw new TypeError(
        "Source-processing claim exceeded its account in-flight bound."
      );
    }
  }
  if (claims.length > policy.maxInFlightPerTenant) {
    throw new TypeError(
      "Source-processing claim exceeded its tenant in-flight bound."
    );
  }
}

function partitionKey(attempt: InboxV2SourceProcessingAttempt): string {
  return `${attempt.scope.sourceConnectionId}\u0000${attempt.scope.sourceAccountId ?? ""}`;
}

function decrement(counts: Map<string, number>, key: string): void {
  const next = (counts.get(key) ?? 1) - 1;
  if (next <= 0) counts.delete(key);
  else counts.set(key, next);
}

function claimRunResult(
  attempt: InboxV2SourceProcessingAttempt,
  outcome: InboxV2SourceProcessingClaimRunResult["outcome"],
  applyOutcome: InboxV2SourceProcessingRuntimeApplyResult["outcome"] | null
): InboxV2SourceProcessingClaimRunResult {
  return Object.freeze({
    attemptId: attempt.attemptId,
    workId: attempt.workId,
    sourceAccountId: attempt.scope.sourceAccountId,
    stage: attempt.scope.stage,
    outcome,
    applyOutcome
  });
}

const systemClock: InboxV2SourceProcessingRuntimeClock = Object.freeze({
  now: () => new Date().toISOString()
});
