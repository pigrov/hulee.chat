import {
  calculateInboxV2SourceProcessingLeaseTokenHash,
  calculateInboxV2RawIngressLeaseTokenHash,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceBackpressurePolicySchema,
  inboxV2SourceProcessingAttemptSchema,
  inboxV2SourceProcessingRuntimeClaimSchema,
  inboxV2SourceProcessingStageSchema,
  type InboxV2ApplySourceProcessingOutcomeInput,
  type InboxV2SourceProcessingAttempt,
  type InboxV2SourceDeadLetterRecord,
  type InboxV2SourceProcessingOutcome,
  type InboxV2SourceProcessingStage
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createInboxV2SourceProcessingRuntimeCoordinator,
  type InboxV2SourceProcessingHandlerResult,
  type InboxV2SourceProcessingRuntimeClaim,
  type InboxV2SourceProcessingRuntimeApplyResult,
  type InboxV2SourceProcessingRuntimeRepositoryPort,
  type InboxV2SourceProcessingStageHandler
} from "./source-processing-runtime-coordinator";

const t0 = "2026-07-17T10:00:00.000Z";
const t1 = "2026-07-17T10:00:01.000Z";
const t2 = "2026-07-17T10:01:00.000Z";
const t3 = "2026-07-17T10:02:00.000Z";
const secret = "provider-secret-must-not-survive";

const policy = inboxV2SourceBackpressurePolicySchema.parse({
  maxClaimBatch: 4,
  maxInFlightPerTenant: 4,
  maxInFlightPerConnection: 3,
  maxInFlightPerAccount: 2,
  maxQueuedPerTenant: 100,
  maxQueuedPerConnection: 50,
  maxQueuedPerAccount: 20,
  maxAttempts: 3,
  baseRetryDelaySeconds: 10,
  maxRetryDelaySeconds: 300,
  jitterBasisPoints: 0
});

describe("Inbox V2 source-processing runtime coordinator", () => {
  it("refuses production composition with a missing stage capability", () => {
    const repository = new CapturingRepository([]);
    const handlers = allHandlers(async () => ({ kind: "processed" }));
    handlers.delete("materialization");

    expect(() =>
      createInboxV2SourceProcessingRuntimeCoordinator(
        options(repository, handlers)
      )
    ).toThrow(/missing stage capability: materialization/u);
  });

  it("processes isolated account partitions inside every in-flight window", async () => {
    const claims = [
      claim("a-1", "source_account:alpha"),
      claim("a-2", "source_account:alpha"),
      claim("b-1", "source_account:beta")
    ];
    const repository = new CapturingRepository(claims);
    const active = new Map<string, number>();
    const maxima = new Map<string, number>();
    const handler = async (
      attempt: InboxV2SourceProcessingAttempt
    ): Promise<InboxV2SourceProcessingHandlerResult> => {
      const account = String(attempt.scope.sourceAccountId);
      const count = (active.get(account) ?? 0) + 1;
      active.set(account, count);
      maxima.set(account, Math.max(maxima.get(account) ?? 0, count));
      await new Promise((resolve) => setTimeout(resolve, 5));
      active.set(account, count - 1);
      return { kind: "processed" };
    };
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(repository, allHandlers(handler))
    );

    const result = await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(result).toMatchObject({ outcome: "processed" });
    expect(repository.outcomes).toHaveLength(3);
    expect(repository.outcomes.every((row) => row.kind === "processed")).toBe(
      true
    );
    expect(maxima).toEqual(
      new Map([
        ["source_account:alpha", 2],
        ["source_account:beta", 1]
      ])
    );
  });

  it("rejects a repository batch that already exceeds an account lease window", async () => {
    const repository = new CapturingRepository([
      claim("hot-1", "source_account:alpha"),
      claim("hot-2", "source_account:alpha"),
      claim("hot-3", "source_account:alpha")
    ]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(
        repository,
        allHandlers(async () => ({ kind: "processed" }))
      )
    );

    await expect(
      coordinator.runOnce({ tenantId: "tenant:alpha" })
    ).rejects.toThrow(/account in-flight bound/u);
    expect(repository.outcomes).toEqual([]);
  });

  it("turns a retryable failure and provider rate limit into one bounded durable retry", async () => {
    const repository = new CapturingRepository([
      claim("rate", "source_account:alpha")
    ]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(
        repository,
        allHandlers(async () => ({
          kind: "failed",
          diagnostic: diagnostic("core:provider-rate-limited", true, "rate"),
          rateLimitHint: {
            kind: "provider_retry_after",
            scope: "source_account",
            observedAt: t1,
            retryAt: t3
          }
        }))
      )
    );

    await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(repository.outcomes).toEqual([
      expect.objectContaining({
        kind: "retry_scheduled",
        retry: expect.objectContaining({
          reason: "rate_limited",
          nextAttemptAt: t3
        })
      })
    ]);
  });

  it("dead-letters a poison event at its finite attempt budget without blocking a peer", async () => {
    const poison = claim("poison", "source_account:alpha", 3, 3);
    const healthy = claim("healthy", "source_account:beta");
    const repository = new CapturingRepository([poison, healthy]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(
        repository,
        allHandlers(async (attempt) =>
          attempt.attemptId.includes("poison")
            ? {
                kind: "failed",
                diagnostic: diagnostic(
                  "core:source-poison-event",
                  true,
                  "poison"
                )
              }
            : { kind: "processed" }
        )
      )
    );

    const result = await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(result).toMatchObject({ outcome: "processed" });
    expect(repository.outcomes.map((row) => row.kind).sort()).toEqual([
      "dead_lettered",
      "processed"
    ]);
    expect(
      repository.outcomes.find((row) => row.kind === "dead_lettered")
    ).toMatchObject({
      deadLetter: {
        reason: "attempts_exhausted",
        deadLetteredAt: t1
      }
    });
    expect(repository.deadLetters).toEqual([
      expect.objectContaining({
        deadLetterId: "dead-letter-attempt-poison",
        replayNotAfter: "2026-07-18T08:00:00.000Z"
      })
    ]);
  });

  it("fails a missing DLQ lifecycle closed without blocking another account", async () => {
    const poison = claim("resolver-failure", "source_account:alpha", 3, 3);
    const healthy = claim("resolver-peer", "source_account:beta");
    const repository = new CapturingRepository([poison, healthy]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator({
      ...options(
        repository,
        allHandlers(async (attempt) =>
          attempt.attemptId.includes("resolver-failure")
            ? {
                kind: "failed",
                diagnostic: diagnostic(
                  "core:source-poison-event",
                  true,
                  "resolver"
                )
              }
            : { kind: "processed" }
        )
      ),
      deadLetterLifecycleResolver: {
        resolve: async () => {
          throw new Error(secret);
        }
      }
    });

    const result = await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(result).toMatchObject({
      outcome: "processed",
      claims: expect.arrayContaining([
        expect.objectContaining({
          attemptId: "attempt-resolver-failure",
          outcome: "runtime_failure",
          applyOutcome: null
        }),
        expect.objectContaining({
          attemptId: "attempt-resolver-peer",
          outcome: "processed"
        })
      ])
    });
    expect(repository.outcomes).toEqual([
      expect.objectContaining({ kind: "processed" })
    ]);
  });

  it("classifies arbitrary exceptions before persistence and drops invalid classifier output", async () => {
    const repository = new CapturingRepository([
      claim("unsafe", "source_account:alpha")
    ]);
    const classifier = vi.fn(async () => ({
      codeId: "core:bad",
      retryable: true,
      correlationToken: "too-short",
      safeDetails: { nested: secret }
    }));
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator({
      ...options(
        repository,
        allHandlers(async () => {
          throw new Error(secret);
        })
      ),
      diagnosticClassifier: { classify: classifier as never }
    });

    await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(classifier).toHaveBeenCalledOnce();
    expect(repository.outcomes).toEqual([
      expect.objectContaining({
        kind: "retry_scheduled",
        diagnostic: {
          codeId: "core:source-processing-failure",
          retryable: true,
          correlationToken: "attempt-unsafe",
          safeOperatorHintId: "core:inspect-source-runtime"
        }
      })
    ]);
    expect(JSON.stringify(repository.outcomes)).not.toContain(secret);
    expect(JSON.stringify(repository.outcomes)).not.toContain("safeDetails");
  });

  it("does not write an outcome after the exact lease has expired", async () => {
    const repository = new CapturingRepository([
      claim("late", "source_account:alpha")
    ]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator({
      ...options(
        repository,
        allHandlers(async () => ({ kind: "processed" }))
      ),
      clock: { now: () => t3 }
    });

    const result = await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(repository.outcomes).toEqual([]);
    expect(result).toMatchObject({
      outcome: "processed",
      claims: [{ outcome: "lease_expired", applyOutcome: null }]
    });
  });

  it("awaits an asynchronous authoritative clock before persisting an outcome", async () => {
    const repository = new CapturingRepository([
      claim("async-clock", "source_account:alpha")
    ]);
    const now = vi.fn(async () => t1);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator({
      ...options(
        repository,
        allHandlers(async () => ({ kind: "processed" }))
      ),
      clock: { now }
    });

    await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(now).toHaveBeenCalledOnce();
    expect(repository.outcomes).toEqual([
      expect.objectContaining({ kind: "processed", completedAt: t1 })
    ]);
  });

  it("surfaces a fenced apply rejection instead of reporting handler success", async () => {
    const repository = new CapturingRepository([
      claim("stale", "source_account:alpha")
    ]);
    repository.applyResult = { outcome: "stale_token" };
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(
        repository,
        allHandlers(async () => ({ kind: "processed" }))
      )
    );

    const result = await coordinator.runOnce({ tenantId: "tenant:alpha" });

    expect(result).toMatchObject({
      outcome: "processed",
      claims: [{ outcome: "stale_token", applyOutcome: "stale_token" }]
    });
  });

  it("rejects an ambiguous replay request before the persistence boundary", async () => {
    const repository = new CapturingRepository([]);
    const coordinator = createInboxV2SourceProcessingRuntimeCoordinator(
      options(
        repository,
        allHandlers(async () => ({ kind: "processed" }))
      )
    );

    await expect(
      coordinator.requestReplay({
        requestId: "replay-request-1",
        target: {
          kind: "raw_event",
          scope: {
            tenantId: "tenant:alpha",
            sourceConnectionId: "source_connection:alpha",
            sourceAccountId: "source_account:alpha",
            rawEventId: "raw_inbound_event:alpha",
            normalizedEventId: "normalized_inbound_event:ambiguous",
            stage: "normalization"
          }
        },
        expectedTargetRevision: "1",
        reason: "operator_requested",
        requestedBy: {
          kind: "trusted_service",
          serviceId: "core:source-runtime"
        },
        requestedAt: t1,
        idempotencyKeyGeneration: "generation-1",
        requestHmacSha256: `hmac-sha256:${"a".repeat(64)}`
      } as never)
    ).rejects.toBeDefined();
    expect(repository.replayRequests).toEqual([]);
  });
});

function options(
  repository: InboxV2SourceProcessingRuntimeRepositoryPort,
  handlers: Map<
    InboxV2SourceProcessingStage,
    InboxV2SourceProcessingStageHandler
  >
) {
  return {
    repository,
    handlers,
    diagnosticClassifier: {
      classify: async () =>
        diagnostic("core:classified-failure", true, "classified")
    },
    policy,
    workerId: "core:source-processing-worker",
    leaseDurationSeconds: 60,
    deadLetterIdSource: (attempt: InboxV2SourceProcessingAttempt) =>
      `dead-letter-${attempt.attemptId}`,
    deadLetterLifecycleResolver: {
      resolve: async () => ({
        evidenceDeadlines: {
          capturedAt: t0,
          rawPayloadExpiresAt: "2026-07-18T10:00:00.000Z",
          allowedRawHeadersExpiresAt: "2026-07-18T09:00:00.000Z",
          normalizedPayloadExpiresAt: null
        },
        replayNotAfter: "2026-07-18T08:00:00.000Z",
        expiresAt: "2026-07-19T10:00:00.000Z"
      })
    },
    clock: { now: () => t1 },
    random: () => 0.5
  } as const;
}

function allHandlers(
  process: (
    attempt: InboxV2SourceProcessingAttempt
  ) =>
    | InboxV2SourceProcessingHandlerResult
    | Promise<InboxV2SourceProcessingHandlerResult>
): Map<InboxV2SourceProcessingStage, InboxV2SourceProcessingStageHandler> {
  return new Map(
    inboxV2SourceProcessingStageSchema.options.map((stage) => [
      stage,
      {
        process: (runtimeClaim: InboxV2SourceProcessingRuntimeClaim) =>
          process(runtimeClaim.attempt)
      }
    ])
  );
}

function claim(
  label: string,
  accountId: string,
  attemptNumber = 1,
  maxAttempts = 3
): InboxV2SourceProcessingRuntimeClaim {
  const leaseToken = `lease-token-${label}-${"x".repeat(32)}`;
  const attempt = inboxV2SourceProcessingAttemptSchema.parse({
    attemptId: `attempt-${label}`,
    workId: `work-${label}`,
    scope: {
      tenantId: "tenant:alpha",
      sourceConnectionId: "source_connection:alpha",
      sourceAccountId: accountId,
      rawEventId: `raw_inbound_event:${label}`,
      normalizedEventId: null,
      stage: "normalization"
    },
    origin: attemptNumber === 1 ? "initial" : "retry",
    replayRequestId: null,
    attemptNumber,
    maxAttempts,
    workRevision: String(attemptNumber),
    workerId: "core:source-processing-worker",
    leaseTokenHash: calculateInboxV2SourceProcessingLeaseTokenHash(leaseToken),
    leaseRevision: String(attemptNumber),
    leaseClaimedAt: t0,
    startedAt: t0,
    leaseExpiresAt: t2
  });
  return inboxV2SourceProcessingRuntimeClaimSchema.parse({
    attempt,
    leaseToken,
    rawIngressClaim: {
      claimKind: "pending",
      work: {
        tenantId: "tenant:alpha",
        rawEventId: `raw_inbound_event:${label}`,
        state: "leased",
        attemptCount: String(attemptNumber),
        lease: {
          workerId: "core:source-processing-worker",
          leaseTokenHash: calculateInboxV2RawIngressLeaseTokenHash(leaseToken),
          leaseRevision: String(attemptNumber),
          claimedAt: t0,
          expiresAt: t2
        },
        revision: String(attemptNumber),
        updatedAt: t0
      },
      leaseToken,
      expiredLease: null
    }
  });
}

function diagnostic(codeId: string, retryable: boolean, label: string) {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId,
    retryable,
    correlationToken: `correlation-${label}`,
    safeOperatorHintId: "core:inspect-source-runtime"
  });
}

class CapturingRepository implements InboxV2SourceProcessingRuntimeRepositoryPort {
  readonly outcomes: InboxV2SourceProcessingOutcome[] = [];
  readonly deadLetters: InboxV2SourceDeadLetterRecord[] = [];
  readonly replayRequests: unknown[] = [];
  applyResult: InboxV2SourceProcessingRuntimeApplyResult = {
    outcome: "applied"
  };

  constructor(
    private readonly claims: readonly InboxV2SourceProcessingRuntimeClaim[]
  ) {}

  async claim() {
    return this.claims.length === 0
      ? ({ outcome: "empty" } as const)
      : ({ outcome: "claimed", claims: this.claims } as const);
  }

  async applyOutcome(input: InboxV2ApplySourceProcessingOutcomeInput) {
    expect(input.leaseToken).not.toHaveLength(0);
    this.outcomes.push(input.outcome);
    if (input.deadLetterRecord !== null) {
      this.deadLetters.push(input.deadLetterRecord);
    }
    return this.applyResult;
  }

  async requestReplay(request: never): Promise<never> {
    this.replayRequests.push(request);
    throw new Error("Unexpected valid replay request in this fixture.");
  }

  async acknowledgeCursor(): Promise<never> {
    throw new Error("Unexpected cursor acknowledgement in this fixture.");
  }

  async loadCursor(): Promise<never> {
    throw new Error("Unexpected cursor load in this fixture.");
  }

  async writeDedupeSkeleton(): Promise<never> {
    throw new Error("Unexpected dedupe write in this fixture.");
  }

  async lookupDedupeSkeleton(): Promise<never> {
    throw new Error("Unexpected dedupe lookup in this fixture.");
  }

  async expireDedupeSkeleton(): Promise<never> {
    throw new Error("Unexpected dedupe expiry in this fixture.");
  }

  async expireDedupeReplayability(): Promise<never> {
    throw new Error("Unexpected replayability expiry in this fixture.");
  }

  async rotateProcessingKeyGeneration(): Promise<never> {
    throw new Error("Unexpected key rotation in this fixture.");
  }

  async retireProcessingKeyGeneration(): Promise<never> {
    throw new Error("Unexpected key retirement in this fixture.");
  }
}
