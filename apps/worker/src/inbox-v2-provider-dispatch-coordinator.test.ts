import {
  calculateInboxV2OutboxLeaseTokenHash,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboxClaimSchema,
  inboxV2OutboxIntentSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  type InboxV2OutboxClaim,
  type InboxV2OutboxWorkRepositoryPort,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchAttemptCommit
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "../../../packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.test-support";
import {
  createInboxV2ProviderDispatchCoordinator,
  InboxV2ProviderDispatchCoordinatorError,
  type InboxV2ProviderDispatchAdapterPort,
  type InboxV2ProviderDispatchFencedMutationResult,
  type InboxV2ProviderDispatchPlan,
  type InboxV2ProviderDispatchTransportPort
} from "./inbox-v2-provider-dispatch-coordinator";

const fixture = createOutboundTransportContractFixture({
  suffix: "worker-coordinator"
});
const handlerId = inboxV2NamespacedIdSchema.parse(
  "core:provider-dispatch-worker"
);
const workerId = inboxV2OutboxWorkerIdSchema.parse(
  "core:provider-dispatch-worker"
);
const trustedServiceId = inboxV2RoutingTrustedServiceIdSchema.parse(
  "core:source-runtime"
);
const leaseToken = inboxV2OutboxLeaseTokenSchema.parse(
  `lease-token:worker-coordinator-${"t".repeat(40)}`
);
const intent = inboxV2OutboxIntentSchema.parse({
  tenantId: fixture.tenantId,
  id: "outbox-intent:worker-coordinator",
  typeId: "core:provider.dispatch",
  handlerId,
  effectClass: "provider_io",
  commit: {
    tenantId: fixture.tenantId,
    streamEpoch: "stream-epoch:worker-coordinator",
    commitId: "commit:worker-coordinator",
    streamPosition: "1"
  },
  eventId: "event:worker-coordinator",
  changeIds: ["change:worker-coordinator"],
  payloadReference: {
    tenantId: fixture.tenantId,
    recordId: fixture.queuedDispatch.id,
    schemaId: "core:inbox-v2.outbound-dispatch",
    schemaVersion: "v1",
    digest: `sha256:${"d".repeat(64)}`
  },
  consumerDedupeKey: `sha256:${"e".repeat(64)}`,
  correlationId: "correlation:worker-coordinator",
  availableAt: OUTBOUND_TEST_TIMES.selectedAt,
  intentHash: `sha256:${"f".repeat(64)}`
});

type OpenAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "open_attempt" }
>;
type CompleteAttemptCommit = Extract<
  InboxV2OutboundDispatchAttemptCommit,
  { kind: "complete_attempt" }
>;
const openAttemptCommit = requireOpenCommit(fixture.openAttemptCommit);
const completeUnknownCommit = requireCompleteCommit(
  fixture.completeUnknownCommit
);

function claim(
  claimKind: InboxV2OutboxClaim["claimKind"] = "initial",
  attemptCount = "1"
): InboxV2OutboxClaim {
  return inboxV2OutboxClaimSchema.parse({
    claimKind,
    work: {
      tenantId: fixture.tenantId,
      intentId: intent.id,
      state: "leased",
      attemptCount,
      availableAt: OUTBOUND_TEST_TIMES.selectedAt,
      lease: {
        workerId,
        leaseTokenHash: calculateInboxV2OutboxLeaseTokenHash(leaseToken),
        leaseRevision: inboxV2EntityRevisionSchema.parse(attemptCount),
        claimedAt: OUTBOUND_TEST_TIMES.selectedAt,
        expiresAt: OUTBOUND_TEST_TIMES.notAfter
      },
      lastRetryResult: null,
      terminalResult: null,
      revision: inboxV2EntityRevisionSchema.parse(
        (BigInt(attemptCount) + 1n).toString()
      ),
      updatedAt: OUTBOUND_TEST_TIMES.selectedAt
    },
    leaseToken
  });
}

function clock(...timestamps: readonly string[]) {
  let index = 0;
  return {
    now: () => timestamps[Math.min(index++, timestamps.length - 1)] ?? ""
  };
}

function createHarness(input: {
  dispatch: InboxV2OutboundDispatch;
  plan: InboxV2ProviderDispatchPlan<{ text: string }>;
  adapterResult?: Awaited<
    ReturnType<InboxV2ProviderDispatchAdapterPort<{ text: string }>["dispatch"]>
  >;
  attemptResults?: readonly InboxV2ProviderDispatchFencedMutationResult[];
  reconciliationResult?: InboxV2ProviderDispatchFencedMutationResult;
  finalizeResult?: Awaited<
    ReturnType<InboxV2OutboxWorkRepositoryPort["finalize"]>
  >;
  events?: string[];
  coordinatorClock?: { now(): string };
  timer?: {
    set(callback: () => void, delayMs: number): unknown;
    clear(handle: unknown): void;
  };
}) {
  const events = input.events ?? [];
  const attemptResults = [...(input.attemptResults ?? [])];
  const loadClaimedProviderIo = vi.fn(async () => ({
    kind: "loaded" as const,
    intent,
    dispatch: input.dispatch
  }));
  const applyAttemptFenced = vi.fn(async ({ commit }) => {
    events.push(commit.kind === "open_attempt" ? "open" : "complete");
    return attemptResults.shift() ?? ({ kind: "committed" } as const);
  });
  const reconcileFenced = vi.fn(async () => {
    events.push("reconcile");
    return input.reconciliationResult ?? ({ kind: "committed" } as const);
  });
  const transport = {
    loadClaimedProviderIo,
    applyAttemptFenced,
    reconcileFenced
  } satisfies InboxV2ProviderDispatchTransportPort;
  const planner = { plan: vi.fn(async () => input.plan) };
  const dispatch = vi.fn(async ({ signal }) => {
    events.push("adapter");
    if (input.adapterResult === undefined) {
      return {
        outcome: "accepted" as const,
        providerAcknowledgementToken: "provider:worker-coordinator-ack"
      };
    }
    expect(signal).toBeInstanceOf(AbortSignal);
    return input.adapterResult;
  });
  const adapter = { dispatch } satisfies InboxV2ProviderDispatchAdapterPort<{
    text: string;
  }>;
  const finalize = vi.fn(
    async ({
      instruction
    }: Parameters<InboxV2OutboxWorkRepositoryPort["finalize"]>[0]) => {
      events.push("finalize");
      return (
        input.finalizeResult ??
        ({
          outcome:
            instruction.kind === "retry" ? "retry_scheduled" : instruction.kind,
          work: claim().work
        } as unknown as Awaited<
          ReturnType<InboxV2OutboxWorkRepositoryPort["finalize"]>
        >)
      );
    }
  );
  const outbox = {
    finalize
  } as unknown as Pick<InboxV2OutboxWorkRepositoryPort, "finalize">;
  const coordinator = createInboxV2ProviderDispatchCoordinator({
    outbox,
    transport,
    planner,
    adapter,
    completedByTrustedServiceId: trustedServiceId,
    expectedHandlerId: handlerId,
    providerDeadlineMs: 30_000,
    clock:
      input.coordinatorClock ??
      clock("2026-07-14T08:02:30.000Z", OUTBOUND_TEST_TIMES.acceptedAt),
    timer: input.timer
  });
  return {
    coordinator,
    loadClaimedProviderIo,
    applyAttemptFenced,
    reconcileFenced,
    planner,
    dispatch,
    finalize,
    events
  };
}

describe("Inbox V2 provider dispatch coordinator", () => {
  it("commits open before provider I/O, commits outcome before outbox finalization and processes accepted delivery", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "hello" }
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });

    expect(harness.events).toEqual(["open", "adapter", "complete", "finalize"]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    const completion = harness.applyAttemptFenced.mock.calls[1]?.[0].commit;
    expect(completion).toMatchObject({
      kind: "complete_attempt",
      attemptAfter: { outcome: { kind: "accepted" } },
      dispatchAfter: { state: "accepted" }
    });
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "processed",
          resultReference: null,
          resultHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
        })
      })
    );
  });

  it("reports a lost outbox lease after durable completion instead of claiming finalization", async () => {
    const finalizeResult = {
      outcome: "stale_token" as const,
      tenantId: intent.tenantId,
      intentId: intent.id,
      currentLeaseRevision: inboxV2EntityRevisionSchema.parse("2")
    };
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "lease-lost-after-completion" }
      },
      finalizeResult
    });

    await expect(harness.coordinator.process(claim())).resolves.toEqual({
      outcome: "finalize_rejected",
      source: "provider_result",
      reason: "stale_token",
      result: finalizeResult
    });

    expect(harness.events).toEqual(["open", "adapter", "complete", "finalize"]);
    expect(harness.applyAttemptFenced).toHaveBeenCalledTimes(2);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("turns a provider deadline into a durable outcome_unknown and releases it for reconciliation", async () => {
    const deadlineTimer = {
      set: vi.fn((callback: () => void) => {
        queueMicrotask(callback);
        return "deadline";
      }),
      clear: vi.fn()
    };
    const events: string[] = [];
    let adapterStartedBeforeAbort = false;
    let adapterObservedAbort = false;
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "timeout" }
      },
      events,
      coordinatorClock: clock(
        "2026-07-14T08:02:30.000Z",
        "2026-07-14T08:03:00.000Z"
      ),
      timer: deadlineTimer
    });
    harness.dispatch.mockImplementationOnce(async ({ signal }) => {
      events.push("adapter");
      adapterStartedBeforeAbort = !signal.aborted;
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener("abort", () => resolve(), { once: true });
      });
      adapterObservedAbort = signal.aborted;
      return await new Promise(() => undefined);
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized"
    });

    const completion = harness.applyAttemptFenced.mock.calls[1]?.[0].commit;
    expect(completion).toMatchObject({
      kind: "complete_attempt",
      completionSource: "provider_result",
      attemptAfter: {
        outcome: {
          kind: "outcome_unknown",
          requiredAction: "automated_reconciliation_required"
        }
      }
    });
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "retry",
          retryAfterSeconds: 1
        })
      })
    );
    await Promise.resolve();
    expect(adapterStartedBeforeAbort).toBe(true);
    expect(adapterObservedAbort).toBe(true);
    expect(events).toEqual(["open", "adapter", "complete", "finalize"]);
  });

  it("does not invoke the adapter when cancellation wins after durable open but before provider dispatch", async () => {
    const abortController = new AbortController();
    let clockRead = 0;
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "cancelled-before-dispatch" }
      },
      coordinatorClock: {
        now: () => {
          clockRead += 1;
          if (clockRead === 1) abortController.abort();
          return clockRead === 1
            ? "2026-07-14T08:02:30.000Z"
            : OUTBOUND_TEST_TIMES.acceptedAt;
        }
      }
    });

    await expect(
      harness.coordinator.process(claim(), {
        signal: abortController.signal
      })
    ).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });

    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["open", "complete", "finalize"]);
    const completion = harness.applyAttemptFenced.mock.calls[1]?.[0].commit;
    expect(completion).toMatchObject({
      kind: "complete_attempt",
      completionSource: "provider_result",
      attemptAfter: {
        outcome: {
          kind: "outcome_unknown",
          diagnostic: { codeId: "core:provider-dispatch-aborted" }
        }
      }
    });
  });

  it("never calls the adapter when the durable open is an exact replay", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "replay" }
      },
      attemptResults: [{ kind: "already_applied" }]
    });

    await expect(harness.coordinator.process(claim())).resolves.toEqual({
      outcome: "recovery_required",
      reason: "open_already_applied"
    });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
  });

  it("rejects a stale outbox fence before provider I/O", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "stale" }
      },
      attemptResults: [{ kind: "outbox_stale_token" }]
    });

    await expect(harness.coordinator.process(claim())).resolves.toEqual({
      outcome: "mutation_rejected",
      stage: "open",
      reason: "outbox_stale_token"
    });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
  });

  it("closes an abandoned open attempt without calling the provider", async () => {
    const harness = createHarness({
      dispatch: fixture.attemptingDispatch,
      plan: {
        kind: "recover_attempt",
        commit: completeUnknownCommit
      }
    });

    await expect(
      harness.coordinator.process(claim("reclaimed"))
    ).resolves.toMatchObject({ outcome: "finalized", source: "recover" });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["complete", "finalize"]);
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({ kind: "retry" })
      })
    );
  });

  it("rejects a recovery plan that fabricates an accepted provider result", async () => {
    const acceptedRecovery = requireCompleteCommit(
      inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...completeUnknownCommit,
        attemptAfter: fixture.acceptedAttempt,
        completionSource: "provider_result",
        dispatchAfter: fixture.acceptedDispatch
      })
    );
    const harness = createHarness({
      dispatch: fixture.attemptingDispatch,
      plan: {
        kind: "recover_attempt",
        commit: acceptedRecovery
      }
    });

    await expect(
      harness.coordinator.process(claim("reclaimed"))
    ).rejects.toMatchObject({
      code: "provider_dispatch.invalid_plan",
      retryable: false
    } satisfies Partial<InboxV2ProviderDispatchCoordinatorError>);

    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
  });

  it("finishes the outbox after a crash between durable outcome and finalize", async () => {
    const harness = createHarness({
      dispatch: fixture.unknownDispatch,
      plan: {
        kind: "finalize_durable",
        durableOutcome: completeUnknownCommit
      }
    });

    await expect(
      harness.coordinator.process(claim("reclaimed"))
    ).resolves.toMatchObject({
      outcome: "finalized",
      source: "durable_outcome"
    });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "retry",
          resultHash: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u)
        })
      })
    );
  });

  it("fails closed when durable-finalize evidence differs in a non-head dispatch field", async () => {
    const mismatchedDispatch = inboxV2OutboundDispatchSchema.parse({
      ...fixture.unknownDispatch,
      message: {
        ...fixture.unknownDispatch.message,
        id: "message:worker-coordinator-mismatch"
      }
    });
    const harness = createHarness({
      dispatch: mismatchedDispatch,
      plan: {
        kind: "finalize_durable",
        durableOutcome: completeUnknownCommit
      }
    });

    await expect(
      harness.coordinator.process(claim("reclaimed"))
    ).rejects.toMatchObject({
      code: "provider_dispatch.invalid_plan",
      retryable: false
    });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.reconcileFenced).not.toHaveBeenCalled();
    expect(harness.finalize).not.toHaveBeenCalled();
  });

  it("reconciles exact unknown evidence without calling the provider", async () => {
    const harness = createHarness({
      dispatch: fixture.unknownDispatch,
      plan: {
        kind: "reconcile",
        commit: fixture.reconciliationCommit
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "reconcile"
    });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.events).toEqual(["reconcile", "finalize"]);
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "retry",
          retryAfterSeconds: 120
        })
      })
    );
  });

  it("releases a reclaimed pre-open claim, then allows exactly one call on the next initial claim", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "after-reclaim" }
      }
    });

    await expect(
      harness.coordinator.process(claim("reclaimed"))
    ).resolves.toMatchObject({ outcome: "finalized", source: "recovery_turn" });
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();

    await expect(
      harness.coordinator.process(claim("initial", "2"))
    ).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("opens a safe retry only after the exact reconciliation decision and durable open", async () => {
    const retryOpen = safeRetryOpenAttempt();
    const events: string[] = [];
    const harness = createHarness({
      dispatch: fixture.reconciledDispatch,
      plan: {
        kind: "open_attempt",
        commit: retryOpen,
        request: { text: "safe-retry" }
      },
      events,
      coordinatorClock: clock(
        "2026-07-14T08:09:10.000Z",
        "2026-07-14T08:09:20.000Z"
      )
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized"
    });
    expect(events).toEqual(["open", "adapter", "complete", "finalize"]);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("rejects an automatic retry that loses the exact pinned correlation safety", async () => {
    const safeRetry = safeRetryOpenAttempt();
    const unsafeRetry = {
      ...safeRetry,
      attempt: {
        ...safeRetry.attempt,
        retrySafety: {
          ...safeRetry.attempt.retrySafety,
          mechanism: "unsafe_or_unknown",
          providerCorrelationToken: null,
          automaticRetryAllowed: false
        }
      }
    } as unknown as OpenAttemptCommit;
    const harness = createHarness({
      dispatch: fixture.reconciledDispatch,
      plan: {
        kind: "open_attempt",
        commit: unsafeRetry,
        request: { text: "unsafe-retry" }
      }
    });

    await expect(harness.coordinator.process(claim())).rejects.toThrow(
      /Automatic retry after outcome_unknown must reuse the exact proven mechanism/u
    );
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("fails closed on wrong handler linkage before planning or provider I/O", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "wrong-handler" }
      }
    });
    const coordinator = createInboxV2ProviderDispatchCoordinator({
      outbox: { finalize: harness.finalize } as unknown as Pick<
        InboxV2OutboxWorkRepositoryPort,
        "finalize"
      >,
      transport: {
        loadClaimedProviderIo: harness.loadClaimedProviderIo,
        applyAttemptFenced: harness.applyAttemptFenced,
        reconcileFenced: harness.reconcileFenced
      },
      planner: harness.planner,
      adapter: { dispatch: harness.dispatch },
      completedByTrustedServiceId: trustedServiceId,
      expectedHandlerId: inboxV2NamespacedIdSchema.parse(
        "core:different-provider-worker"
      ),
      providerDeadlineMs: 1_000,
      clock: clock("2026-07-14T08:02:30.000Z")
    });

    await expect(coordinator.process(claim())).rejects.toMatchObject({
      code: "provider_dispatch.invalid_intent_linkage",
      retryable: false
    } satisfies Partial<InboxV2ProviderDispatchCoordinatorError>);
    expect(harness.planner.plan).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });
});

function safeRetryOpenAttempt(): OpenAttemptCommit {
  const attemptReference = {
    tenantId: fixture.tenantId,
    kind: "outbound_dispatch_attempt" as const,
    id: "outbound_dispatch_attempt:worker-coordinator-retry"
  };
  const attempt = inboxV2OutboundDispatchAttemptSchema.parse({
    ...fixture.pendingAttempt,
    id: attemptReference.id,
    attemptNumber: 2,
    claimToken: "claim:worker-coordinator-retry",
    leaseExpiresAt: "2026-07-14T08:20:00.000Z",
    openedAt: OUTBOUND_TEST_TIMES.retryAt,
    retrySafety: fixture.pendingAttempt.retrySafety
  });
  const dispatchAfter = inboxV2OutboundDispatchSchema.parse({
    ...fixture.reconciledDispatch,
    state: "attempting",
    attemptCount: 2,
    activeAttempt: attemptReference,
    lastAttempt: attemptReference,
    retryAuthorization: null,
    revision: "5",
    updatedAt: OUTBOUND_TEST_TIMES.retryAt
  });
  const commit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    kind: "open_attempt",
    tenantId: fixture.tenantId,
    routeSnapshot: fixture.route,
    bindingHeadSnapshot: fixture.bindingHeadSnapshot,
    dispatchBefore: fixture.reconciledDispatch,
    priorAttempt: fixture.unknownAttempt,
    retryAuthorizationDecision: fixture.reconciliationDecision,
    attempt,
    dispatchAfter
  });
  if (commit.kind !== "open_attempt") throw new Error("Expected open attempt");
  return commit;
}

function requireOpenCommit(
  commit: InboxV2OutboundDispatchAttemptCommit
): OpenAttemptCommit {
  if (commit.kind !== "open_attempt") throw new Error("Expected open attempt");
  return commit;
}

function requireCompleteCommit(
  commit: InboxV2OutboundDispatchAttemptCommit
): CompleteAttemptCommit {
  if (commit.kind !== "complete_attempt") {
    throw new Error("Expected complete attempt");
  }
  return commit;
}
