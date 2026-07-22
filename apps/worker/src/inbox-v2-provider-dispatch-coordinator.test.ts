import {
  calculateInboxV2CanonicalSha256,
  calculateInboxV2OutboundDispatchContentPlanDigest,
  calculateInboxV2OutboxLeaseTokenHash,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2RouteFailureOutboxFinalization,
  inboxV2EntityRevisionSchema,
  inboxV2NamespacedIdSchema,
  inboxV2OutboxClaimSchema,
  inboxV2OutboxIntentSchema,
  inboxV2OutboxLeaseTokenSchema,
  inboxV2OutboxWorkerIdSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundProviderResponseObservationDescriptorSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  type InboxV2OutboxClaim,
  type InboxV2OutboxWorkRepositoryPort,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchContentPlan,
  type InboxV2OutboundDispatchContentPlanDigestInput,
  type InboxV2OutboundDispatchAttemptCommit
} from "@hulee/contracts";
import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";

import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "../../../packages/db/src/repositories/sql-inbox-v2-outbound-transport-repository.test-support";
import {
  createInboxV2ProviderDispatchCoordinator,
  InboxV2ProviderDispatchCoordinatorError,
  type InboxV2ProviderDispatchAdapterPort,
  type InboxV2ProviderDispatchFencedMutationResult,
  type InboxV2ProviderDispatchLoadResult,
  type InboxV2ProviderDispatchPlan,
  type InboxV2ProviderDispatchTransportPort
} from "./inbox-v2-provider-dispatch-coordinator";
import { createInboxV2TrustedOutboundProviderObservationMaterializer } from "./outbound-provider-observation-materializer";

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
const providerObservationMaterializer =
  createInboxV2TrustedOutboundProviderObservationMaterializer({
    trustedServiceId,
    namespaceDeriver: {
      namespaceGeneration: "namespace-generation:worker-provider-observation",
      deriveNamespaceHmacSha256: ({ canonicalPreimage }) =>
        createHash("sha256").update(canonicalPreimage).digest("hex")
    }
  });
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

function contentPlanFor(
  dispatch: InboxV2OutboundDispatch,
  overrides: Partial<InboxV2OutboundDispatchContentPlanDigestInput> = {}
): InboxV2OutboundDispatchContentPlan {
  const digestInput: InboxV2OutboundDispatchContentPlanDigestInput = {
    tenantId: dispatch.tenantId,
    id: "outbound_dispatch_content_plan:worker-coordinator",
    dispatch: {
      tenantId: dispatch.tenantId,
      kind: "outbound_dispatch",
      id: dispatch.id
    },
    message: dispatch.message,
    messageRevision: "1",
    conversation: fixture.route.conversation,
    timelineItem: {
      tenantId: dispatch.tenantId,
      kind: "timeline_item",
      id: "timeline_item:worker-coordinator"
    },
    route: dispatch.route,
    timelineContent: {
      tenantId: dispatch.tenantId,
      kind: "timeline_content",
      id: "timeline_content:worker-coordinator"
    },
    contentRevision: "1",
    contentFingerprint: {
      purposeId: "core:outbound_dispatch_content_plan",
      keyGeneration: "outbound-content-key:g1",
      validUntil: "2026-08-18T09:00:00.000Z",
      hmacSha256: `hmac-sha256:${"a".repeat(64)}`
    },
    binding: fixture.route.sourceThreadBinding,
    bindingRevision: fixture.bindingHeadSnapshot.bindingRevision,
    capabilityRevision: fixture.route.bindingFence.capabilityRevision,
    adapterContract: fixture.route.adapterContract,
    blocks: [
      {
        blockKey: "text-1",
        blockKind: "text",
        exactFileObjectPin: null,
        artifactOrdinal: 1
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single",
        capabilityId: "core:send-message",
        operationId: fixture.route.operationId,
        blockKeys: ["text-1"]
      }
    ],
    createdAt: dispatch.createdAt,
    revision: "1",
    ...overrides
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...digestInput,
    planDigestSha256:
      calculateInboxV2OutboundDispatchContentPlanDigest(digestInput)
  });
}

function multiArtifactContentPlanFor(
  dispatch: InboxV2OutboundDispatch,
  overrides: Partial<InboxV2OutboundDispatchContentPlanDigestInput> = {}
): InboxV2OutboundDispatchContentPlan {
  return contentPlanFor(dispatch, {
    id: "outbound_dispatch_content_plan:worker-coordinator-multi",
    blocks: [
      {
        blockKey: "text-1",
        blockKind: "text",
        exactFileObjectPin: null,
        artifactOrdinal: 1
      },
      {
        blockKey: "location-1",
        blockKind: "location",
        exactFileObjectPin: null,
        artifactOrdinal: 2
      },
      {
        blockKey: "contact-1",
        blockKind: "contact",
        exactFileObjectPin: null,
        artifactOrdinal: 3
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "split",
        capabilityId: "core:send-message",
        operationId: fixture.route.operationId,
        blockKeys: ["text-1"]
      },
      {
        ordinal: 2,
        grouping: "split",
        capabilityId: "core:send-location",
        operationId: fixture.route.operationId,
        blockKeys: ["location-1"]
      },
      {
        ordinal: 3,
        grouping: "split",
        capabilityId: "core:send-contact",
        operationId: fixture.route.operationId,
        blockKeys: ["contact-1"]
      }
    ],
    ...overrides
  });
}

const exactMediaPin = {
  file: {
    tenantId: fixture.tenantId,
    kind: "file" as const,
    id: "file:worker-coordinator-photo"
  },
  fileRevision: "4",
  fileVersion: {
    tenantId: fixture.tenantId,
    kind: "file_version" as const,
    id: "file_version:worker-coordinator-photo-v4"
  },
  objectVersion: {
    tenantId: fixture.tenantId,
    kind: "file_object_version" as const,
    id: "file_object_version:worker-coordinator-photo-v4"
  }
};

function mediaOnlyContentPlanFor(
  dispatch: InboxV2OutboundDispatch
): InboxV2OutboundDispatchContentPlan {
  return contentPlanFor(dispatch, {
    id: "outbound_dispatch_content_plan:worker-coordinator-media-only",
    blocks: [
      {
        blockKey: "image-1",
        blockKind: "image",
        exactFileObjectPin: exactMediaPin,
        artifactOrdinal: 1
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single",
        capabilityId: "core:send-message",
        operationId: fixture.route.operationId,
        blockKeys: ["image-1"]
      }
    ]
  });
}

function captionMediaSplitContentPlanFor(
  dispatch: InboxV2OutboundDispatch
): InboxV2OutboundDispatchContentPlan {
  return contentPlanFor(dispatch, {
    id: "outbound_dispatch_content_plan:worker-coordinator-caption-media",
    blocks: [
      {
        blockKey: "caption-1",
        blockKind: "text",
        exactFileObjectPin: null,
        artifactOrdinal: 1
      },
      {
        blockKey: "image-1",
        blockKind: "image",
        exactFileObjectPin: exactMediaPin,
        artifactOrdinal: 2
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "split",
        capabilityId: "core:send-message",
        operationId: fixture.route.operationId,
        blockKeys: ["caption-1"]
      },
      {
        ordinal: 2,
        grouping: "split",
        capabilityId: "core:send-message",
        operationId: fixture.route.operationId,
        blockKeys: ["image-1"]
      }
    ]
  });
}

function providerResponseObservationDescriptor(artifactOrdinal = 1) {
  return inboxV2OutboundProviderResponseObservationDescriptorSchema.parse({
    artifactOrdinal,
    canonicalExternalSubject: `ProviderMessage:${artifactOrdinal}`,
    messageIdentityDeclaration: {
      adapterContract: fixture.route.adapterContract,
      identityKind: "message" as const,
      realmId: "module:synthetic-source:message-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:chat-message",
      scopeKind: "provider_thread" as const,
      decisionStrength: "authoritative" as const
    },
    occurrenceDescriptor: {
      adapterContract: fixture.route.adapterContract,
      descriptorSchemaId: "module:synthetic-source:provider-response",
      descriptorVersion: "v1",
      capabilityRevision: "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:message-id",
          subject: `ProviderMessage:${artifactOrdinal}`
        }
      ],
      descriptorDigestSha256: "c".repeat(64)
    },
    providerTimestamps: [
      {
        kindId: "module:synthetic-source:sent-at",
        timestamp: OUTBOUND_TEST_TIMES.artifactAt
      }
    ],
    referencePortability: {
      kind: "external_thread" as const,
      adapterContract: fixture.route.adapterContract,
      decisionStrength: "authoritative" as const
    },
    observedAt: OUTBOUND_TEST_TIMES.artifactAt
  });
}

function createHarness(input: {
  dispatch: InboxV2OutboundDispatch;
  contentPlan?: InboxV2OutboundDispatchContentPlan | null;
  loadResult?: InboxV2ProviderDispatchLoadResult;
  plan: InboxV2ProviderDispatchPlan<{ text: string }>;
  adapterResult?: Awaited<
    ReturnType<InboxV2ProviderDispatchAdapterPort<{ text: string }>["dispatch"]>
  >;
  attemptResults?: readonly InboxV2ProviderDispatchFencedMutationResult[];
  routeFailureResult?: InboxV2ProviderDispatchFencedMutationResult;
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
  const loadedState =
    input.loadResult ??
    (input.contentPlan === null
      ? { kind: "loaded" as const, intent, dispatch: input.dispatch }
      : {
          kind: "loaded" as const,
          intent,
          dispatch: input.dispatch,
          contentPlan: input.contentPlan ?? contentPlanFor(input.dispatch)
        });
  const loadClaimedProviderIo = vi.fn(
    async () => loadedState as unknown as InboxV2ProviderDispatchLoadResult
  );
  const applyAttemptFenced = vi.fn(async ({ commit }) => {
    events.push(commit.kind === "open_attempt" ? "open" : "complete");
    return attemptResults.shift() ?? ({ kind: "committed" } as const);
  });
  const applyProviderResultFenced = vi.fn(
    async (
      _input: Parameters<
        InboxV2ProviderDispatchTransportPort["applyProviderResultFenced"]
      >[0]
    ) => {
      events.push("complete");
      return attemptResults.shift() ?? ({ kind: "committed" } as const);
    }
  );
  const applyRouteFailureFenced = vi.fn(async () => {
    events.push("route_failure");
    return input.routeFailureResult ?? ({ kind: "committed" } as const);
  });
  const reconcileFenced = vi.fn(async () => {
    events.push("reconcile");
    return input.reconciliationResult ?? ({ kind: "committed" } as const);
  });
  const transport = {
    loadClaimedProviderIo,
    applyAttemptFenced,
    applyProviderResultFenced,
    applyRouteFailureFenced,
    reconcileFenced
  } satisfies InboxV2ProviderDispatchTransportPort;
  const planner = { plan: vi.fn(async () => input.plan) };
  const dispatch = vi.fn(async ({ signal }) => {
    events.push("adapter");
    if (input.adapterResult === undefined) {
      return {
        artifacts: (
          input.contentPlan ?? contentPlanFor(input.dispatch)
        ).artifacts.map((artifact) => ({
          artifactOrdinal: artifact.ordinal,
          outcome: "accepted" as const,
          providerAcknowledgementToken: "provider:worker-coordinator-ack"
        }))
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
    providerObservationMaterializer,
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
    applyProviderResultFenced,
    applyRouteFailureFenced,
    reconcileFenced,
    planner,
    dispatch,
    finalize,
    events
  };
}

describe("Inbox V2 provider dispatch coordinator", () => {
  it("finalizes an already rerouted dispatch without planning or provider I/O", async () => {
    const cancelledDispatch = inboxV2OutboundDispatchSchema.parse({
      ...fixture.queuedDispatch,
      state: "cancelled",
      revision: "2",
      updatedAt: OUTBOUND_TEST_TIMES.openedAt
    });
    const harness = createHarness({
      dispatch: cancelledDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "must-not-run" }
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "rerouted",
      result: { outcome: "processed" }
    });

    expect(harness.events).toEqual(["finalize"]);
    expect(harness.planner.plan).not.toHaveBeenCalled();
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
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

  it("finalizes the old work without provider I/O when reroute wins the open race", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "must-not-run" }
      },
      attemptResults: [{ kind: "dispatch_cancelled" }]
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "rerouted",
      result: { outcome: "processed" }
    });

    expect(harness.events).toEqual(["open", "finalize"]);
    expect(harness.planner.plan).toHaveBeenCalledTimes(1);
    expect(harness.applyAttemptFenced).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).not.toHaveBeenCalled();
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

  it("commits open before provider I/O, commits outcome before outbox finalization and processes accepted delivery", async () => {
    const contentPlan = contentPlanFor(fixture.queuedDispatch);
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
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
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ contentPlan })
    );
    const completion =
      harness.applyProviderResultFenced.mock.calls[0]?.[0].commit;
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

  it("finalizes a late provider response from the canonical echo-won database outcome", async () => {
    const canonicalEchoOutcome = requireCompleteCommit(
      inboxV2OutboundDispatchAttemptCommitSchema.parse({
        kind: "complete_attempt",
        tenantId: fixture.tenantId,
        dispatchBefore: openAttemptCommit.dispatchAfter,
        attemptBefore: openAttemptCommit.attempt,
        attemptAfter: {
          ...fixture.acceptedAttempt,
          outcome: {
            kind: "accepted",
            completedAt: OUTBOUND_TEST_TIMES.artifactAt,
            providerAcknowledgementToken: null
          },
          completionSource: "provider_observation"
        },
        completionSource: "provider_observation",
        completedByTrustedServiceId: trustedServiceId,
        dispatchAfter: {
          ...fixture.acceptedDispatch,
          updatedAt: OUTBOUND_TEST_TIMES.artifactAt
        }
      })
    );
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "echo-won-late-response" }
      },
      attemptResults: [
        { kind: "committed" },
        { kind: "already_applied", canonicalOutcome: canonicalEchoOutcome }
      ]
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });
    const lateResponseCommit =
      harness.applyProviderResultFenced.mock.calls[0]?.[0].commit;
    if (lateResponseCommit === undefined) {
      throw new Error("Late provider response commit was not persisted.");
    }
    const instruction = harness.finalize.mock.calls[0]?.[0].instruction;
    expect(instruction).toMatchObject({
      kind: "processed",
      resultHash: calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.provider-dispatch-outbox-outcome",
        hashVersion: "v1",
        intentId: intent.id,
        durableOutcome: canonicalEchoOutcome
      })
    });
    expect(instruction?.resultHash).not.toBe(
      calculateInboxV2CanonicalSha256({
        domain: "core:inbox-v2.provider-dispatch-outbox-outcome",
        hashVersion: "v1",
        intentId: intent.id,
        durableOutcome: lateResponseCommit
      })
    );
  });

  it("materializes exact provider response identity before the accepted result transaction", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "provider-response" }
      },
      adapterResult: {
        artifacts: [
          {
            artifactOrdinal: 1,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:worker-response-ack",
            providerResponseObservation: providerResponseObservationDescriptor()
          }
        ]
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });
    const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
    expect(persisted?.observations).toHaveLength(1);
    expect(persisted?.observations[0]).toMatchObject({
      tenantId: fixture.tenantId,
      dispatch: { id: fixture.queuedDispatch.id, state: "attempting" },
      attempt: {
        id: openAttemptCommit.attempt.id,
        outcome: { kind: "pending" }
      },
      artifact: { ordinal: 1, state: "accepted" },
      sourceOccurrence: {
        direction: "outbound",
        providerActor: null,
        origin: { kind: "provider_response" },
        resolution: { state: "pending" }
      },
      evidence: {
        kind: "provider_response_attempt",
        artifactOrdinal: 1
      },
      effectDisposition: {
        countsAsCustomerInbound: false,
        createsUnread: false,
        createsWorkItem: false,
        requiresProviderIo: false,
        createsOutboundDispatch: false,
        notificationEligible: false
      }
    });
    expect(persisted?.settlementWork).toHaveLength(1);
    expect(persisted?.settlementWork[0]).toMatchObject({
      observation: { id: persisted?.observations[0]?.id },
      candidateExternalMessageReferenceId: expect.stringMatching(
        /^external_message_reference:/u
      ),
      candidateTransportLinkId: expect.stringMatching(
        /^message_transport_occurrence_link:/u
      )
    });
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("dispatches a media-only plan with one immutable File/Object pin and reconstructs the same canonical artifact reference", async () => {
    const contentPlan = mediaOnlyContentPlanFor(fixture.queuedDispatch);
    const run = async () => {
      const harness = createHarness({
        dispatch: fixture.queuedDispatch,
        contentPlan,
        plan: {
          kind: "open_attempt",
          commit: openAttemptCommit,
          request: { text: "media-only" }
        }
      });
      await expect(harness.coordinator.process(claim())).resolves.toMatchObject(
        {
          outcome: "finalized",
          source: "provider_result"
        }
      );
      return harness;
    };

    const first = await run();
    const replay = await run();
    const firstPersisted = first.applyProviderResultFenced.mock.calls[0]?.[0];
    const replayPersisted = replay.applyProviderResultFenced.mock.calls[0]?.[0];
    const expectedArtifactId = deriveInboxV2OutboundDispatchArtifactId({
      tenantId: fixture.tenantId,
      dispatch: openAttemptCommit.attempt.dispatch,
      route: openAttemptCommit.attempt.route,
      attempt: {
        tenantId: fixture.tenantId,
        kind: "outbound_dispatch_attempt",
        id: openAttemptCommit.attempt.id
      },
      ordinal: 1
    });

    expect(contentPlan).toMatchObject({
      dispatch: {
        id: fixture.queuedDispatch.id
      },
      message: fixture.queuedDispatch.message,
      route: fixture.queuedDispatch.route,
      blocks: [
        {
          blockKey: "image-1",
          exactFileObjectPin: exactMediaPin,
          artifactOrdinal: 1
        }
      ]
    });
    expect(first.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ contentPlan })
    );
    expect(firstPersisted?.artifacts).toEqual([
      expect.objectContaining({
        id: expectedArtifactId,
        ordinal: 1,
        state: "accepted"
      })
    ]);
    expect(replayPersisted?.artifacts).toEqual(firstPersisted?.artifacts);
    expect(replayPersisted?.contentPlanDigestSha256).toBe(
      firstPersisted?.contentPlanDigestSha256
    );
  });

  it("keeps one canonical Message and route while a caption and pinned media become two provider artifacts", async () => {
    const contentPlan = captionMediaSplitContentPlanFor(fixture.queuedDispatch);
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "caption plus media" }
      },
      adapterResult: {
        artifacts: [
          {
            artifactOrdinal: 2,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:media-receipt"
          },
          {
            artifactOrdinal: 1,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:caption-receipt"
          }
        ]
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });
    const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
    expect(contentPlan).toMatchObject({
      dispatch: { id: fixture.queuedDispatch.id },
      message: fixture.queuedDispatch.message,
      route: fixture.queuedDispatch.route,
      blocks: [
        {
          blockKey: "caption-1",
          exactFileObjectPin: null,
          artifactOrdinal: 1
        },
        {
          blockKey: "image-1",
          exactFileObjectPin: exactMediaPin,
          artifactOrdinal: 2
        }
      ],
      artifacts: [
        { ordinal: 1, grouping: "split", blockKeys: ["caption-1"] },
        { ordinal: 2, grouping: "split", blockKeys: ["image-1"] }
      ]
    });
    expect(persisted?.artifacts).toEqual(
      [1, 2].map((ordinal) =>
        expect.objectContaining({
          id: deriveInboxV2OutboundDispatchArtifactId({
            tenantId: fixture.tenantId,
            dispatch: openAttemptCommit.attempt.dispatch,
            route: openAttemptCommit.attempt.route,
            attempt: {
              tenantId: fixture.tenantId,
              kind: "outbound_dispatch_attempt",
              id: openAttemptCommit.attempt.id
            },
            ordinal
          }),
          ordinal,
          state: "accepted"
        })
      )
    );
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ contentPlan })
    );
  });

  it("persists every accepted split artifact with deterministic identity while distinct receipts remain non-canonical", async () => {
    const contentPlan = multiArtifactContentPlanFor(fixture.queuedDispatch);
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "three provider artifacts" }
      },
      adapterResult: {
        artifacts: [
          {
            artifactOrdinal: 3,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:artifact-three-receipt"
          },
          {
            artifactOrdinal: 1,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:artifact-one-receipt"
          },
          {
            artifactOrdinal: 2,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:artifact-two-receipt"
          }
        ]
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });

    const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
    expect(persisted?.commit.attemptAfter.outcome).toEqual({
      kind: "accepted",
      completedAt: OUTBOUND_TEST_TIMES.acceptedAt,
      providerAcknowledgementToken: null
    });
    expect(persisted?.contentPlanDigestSha256).toBe(
      contentPlan.planDigestSha256
    );
    expect(persisted?.artifacts).toEqual(
      contentPlan.artifacts.map((planned) =>
        expect.objectContaining({
          id: deriveInboxV2OutboundDispatchArtifactId({
            tenantId: fixture.tenantId,
            dispatch: openAttemptCommit.attempt.dispatch,
            route: openAttemptCommit.attempt.route,
            attempt: {
              tenantId: fixture.tenantId,
              kind: "outbound_dispatch_attempt",
              id: openAttemptCommit.attempt.id
            },
            ordinal: planned.ordinal
          }),
          ordinal: planned.ordinal,
          state: "accepted",
          diagnostic: null
        })
      )
    );
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("turns mixed provider artifact outcomes into reconciliation-only unknown without losing per-artifact evidence", async () => {
    const contentPlan = multiArtifactContentPlanFor(fixture.queuedDispatch);
    const retryableDiagnostic = inboxV2SafeSourceDiagnosticSchema.parse({
      codeId: "core:provider-artifact-temporary-failure",
      retryable: true,
      correlationToken: "provider:artifact-two-failure",
      safeOperatorHintId: null
    });
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "mixed provider result" }
      },
      adapterResult: {
        artifacts: [
          {
            artifactOrdinal: 1,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:artifact-one-receipt"
          },
          {
            artifactOrdinal: 2,
            outcome: "failed",
            retryAt: OUTBOUND_TEST_TIMES.retryAt,
            diagnostic: retryableDiagnostic
          },
          {
            artifactOrdinal: 3,
            outcome: "accepted",
            providerAcknowledgementToken: "provider:artifact-three-receipt"
          }
        ]
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });

    const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
    expect(persisted?.commit.attemptAfter.outcome).toMatchObject({
      kind: "outcome_unknown",
      diagnostic: {
        codeId: "core:provider-artifact-outcomes-mixed",
        retryable: false,
        correlationToken: openAttemptCommit.attempt.claimToken,
        safeOperatorHintId: "core:reconcile-before-retry"
      },
      requiredAction: "operator_duplicate_risk_decision_required"
    });
    expect(persisted?.artifacts.map((artifact) => artifact.state)).toEqual([
      "accepted",
      "failed",
      "accepted"
    ]);
    expect(persisted?.artifacts[1]?.diagnostic).toEqual(retryableDiagnostic);
    expect(harness.applyAttemptFenced).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("aggregates an all-retryable failed artifact set with its latest retry boundary", async () => {
    const contentPlan = multiArtifactContentPlanFor(fixture.queuedDispatch);
    const retryTimes = [
      "2026-07-14T08:07:00.000Z",
      OUTBOUND_TEST_TIMES.retryAt,
      "2026-07-14T08:08:00.000Z"
    ] as const;
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "retryable provider result" }
      },
      adapterResult: {
        artifacts: retryTimes.map((retryAt, index) => ({
          artifactOrdinal: index + 1,
          outcome: "failed" as const,
          retryAt,
          diagnostic: inboxV2SafeSourceDiagnosticSchema.parse({
            codeId: `core:provider-artifact-${index + 1}-temporary`,
            retryable: true,
            correlationToken: `provider:artifact-${index + 1}-failure`,
            safeOperatorHintId: null
          })
        }))
      }
    });

    await harness.coordinator.process(claim());

    const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
    expect(persisted?.commit.attemptAfter.outcome).toMatchObject({
      kind: "retryable_failure",
      retryAt: OUTBOUND_TEST_TIMES.retryAt
    });
    expect(persisted?.artifacts.map((artifact) => artifact.state)).toEqual([
      "failed",
      "failed",
      "failed"
    ]);
  });

  it.each([
    [
      "missing",
      [
        {
          artifactOrdinal: 1,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        }
      ]
    ],
    [
      "duplicate",
      [
        {
          artifactOrdinal: 1,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        },
        {
          artifactOrdinal: 1,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        },
        {
          artifactOrdinal: 3,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        }
      ]
    ],
    [
      "out-of-plan",
      [
        {
          artifactOrdinal: 1,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        },
        {
          artifactOrdinal: 2,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        },
        {
          artifactOrdinal: 4,
          outcome: "accepted" as const,
          providerAcknowledgementToken: null
        }
      ]
    ]
  ] as const)(
    "persists complete uncertain evidence for an adapter result with %s artifact coverage",
    async (_case, artifacts) => {
      const contentPlan = multiArtifactContentPlanFor(fixture.queuedDispatch);
      const harness = createHarness({
        dispatch: fixture.queuedDispatch,
        contentPlan,
        plan: {
          kind: "open_attempt",
          commit: openAttemptCommit,
          request: { text: "invalid provider artifact set" }
        },
        adapterResult: { artifacts }
      });

      await harness.coordinator.process(claim());

      const persisted = harness.applyProviderResultFenced.mock.calls[0]?.[0];
      expect(persisted?.commit.attemptAfter.outcome).toMatchObject({
        kind: "outcome_unknown",
        diagnostic: {
          codeId: "core:provider-result-invalid",
          retryable: false
        }
      });
      expect(persisted?.artifacts).toHaveLength(3);
      expect(persisted?.artifacts).toEqual(
        expect.arrayContaining(
          [1, 2, 3].map((ordinal) =>
            expect.objectContaining({
              ordinal,
              state: "outcome_unknown",
              diagnostic: expect.objectContaining({
                codeId: "core:provider-result-invalid"
              })
            })
          )
        )
      );
      expect(harness.dispatch).toHaveBeenCalledTimes(1);
    }
  );

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
    expect(harness.applyAttemptFenced).toHaveBeenCalledTimes(1);
    expect(harness.applyProviderResultFenced).toHaveBeenCalledTimes(1);
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

    const completion =
      harness.applyProviderResultFenced.mock.calls[0]?.[0].commit;
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
    const completion =
      harness.applyProviderResultFenced.mock.calls[0]?.[0].commit;
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

  it("replays the atomic structural terminal finalization without invoking the adapter", async () => {
    const commit = routeFailureCommit("structural");
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: { kind: "route_failure", commit },
      finalizeResult: {
        outcome: "already_finalized",
        work: claim().work
      } as unknown as Awaited<
        ReturnType<InboxV2OutboxWorkRepositoryPort["finalize"]>
      >
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "route_failure",
      result: { outcome: "already_finalized" }
    });
    expect(harness.events).toEqual(["route_failure", "finalize"]);
    expect(harness.applyRouteFailureFenced).toHaveBeenCalledWith({
      outboxLease: expect.objectContaining({
        intentId: intent.id,
        expectedHandlerId: handlerId
      }),
      commit
    });
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "dead",
          errorCode: "core:route.binding_changed"
        })
      })
    );
  });

  it("durably terminates an administratively disabled binding before I/O", async () => {
    const commit = routeFailureCommit("admin_disabled");
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: { kind: "route_failure", commit }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "route_failure",
      result: { outcome: "dead" }
    });
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "dead",
          errorCode: "core:route.binding_changed"
        })
      })
    );
  });

  it("retries temporary runtime unavailability on the same pinned route with zero provider calls", async () => {
    const commit = routeFailureCommit("runtime");
    const expectedFinalization = deriveInboxV2RouteFailureOutboxFinalization({
      intentId: intent.id,
      commit
    });
    if (expectedFinalization.kind !== "retry") {
      throw new Error("Runtime-unavailable route must remain retryable.");
    }
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: { kind: "route_failure", commit }
    });

    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "route_failure",
      result: { outcome: "retry_scheduled" }
    });
    expect(commit.dispatchAfter).toMatchObject({
      route: fixture.queuedDispatch.route,
      state: "queued",
      attemptCount: 0,
      activeAttempt: null,
      revision: "1"
    });
    expect(commit.dispatchAfter).toEqual(commit.dispatchBefore);
    expect(harness.events).toEqual(["route_failure", "finalize"]);
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
    expect(harness.finalize).toHaveBeenCalledWith(
      expect.objectContaining({
        instruction: expect.objectContaining({
          kind: "retry",
          errorCode: "core:route.runtime_unavailable",
          retryAfterSeconds: expectedFinalization.retryAfterSeconds
        })
      })
    );
    expect(expectedFinalization.retryAfterSeconds).toBeGreaterThanOrEqual(5);
    expect(expectedFinalization.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("does not finalize or call the provider when the route-failure lease fence is stale", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      plan: { kind: "route_failure", commit: routeFailureCommit("structural") },
      routeFailureResult: { kind: "outbox_stale_token" }
    });

    await expect(harness.coordinator.process(claim())).resolves.toEqual({
      outcome: "mutation_rejected",
      stage: "route_failure",
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

  it("rejects a missing loaded content plan before planner or adapter I/O", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan: null,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "missing-content-plan" }
      }
    });

    await expect(harness.coordinator.process(claim())).rejects.toMatchObject({
      code: "provider_dispatch.invalid_intent_linkage",
      retryable: false
    });
    expect(harness.planner.plan).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("fails closed when the immutable dispatch content plan is absent", async () => {
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      loadResult: { kind: "outbox_dispatch_content_plan_not_found" },
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "must-not-run" }
      }
    });

    await expect(harness.coordinator.process(claim())).resolves.toEqual({
      outcome: "load_rejected",
      reason: "outbox_dispatch_content_plan_not_found"
    });
    expect(harness.planner.plan).not.toHaveBeenCalled();
    expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("rejects a malformed canonical plan digest before planner or adapter I/O", async () => {
    const validPlan = contentPlanFor(fixture.queuedDispatch);
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan: {
        ...validPlan,
        planDigestSha256: "0".repeat(64)
      } as unknown as InboxV2OutboundDispatchContentPlan,
      plan: {
        kind: "open_attempt",
        commit: openAttemptCommit,
        request: { text: "malformed-plan-digest" }
      }
    });

    await expect(harness.coordinator.process(claim())).rejects.toMatchObject({
      code: "provider_dispatch.invalid_intent_linkage",
      retryable: false
    });
    expect(harness.planner.plan).not.toHaveBeenCalled();
    expect(harness.dispatch).not.toHaveBeenCalled();
  });

  it("rejects canonically re-digested dispatch linkage drift before planner or adapter I/O", async () => {
    const driftedPlans = [
      contentPlanFor(fixture.queuedDispatch, {
        dispatch: {
          ...contentPlanFor(fixture.queuedDispatch).dispatch,
          id: "outbound_dispatch:drifted-dispatch"
        }
      }),
      contentPlanFor(fixture.queuedDispatch, {
        message: {
          ...fixture.queuedDispatch.message,
          id: "message:drifted-message"
        }
      }),
      contentPlanFor(fixture.queuedDispatch, {
        route: {
          ...fixture.queuedDispatch.route,
          id: "outbound_route:drifted-route"
        }
      })
    ];

    for (const contentPlan of driftedPlans) {
      const harness = createHarness({
        dispatch: fixture.queuedDispatch,
        contentPlan,
        plan: {
          kind: "open_attempt",
          commit: openAttemptCommit,
          request: { text: "redigested-linkage-drift" }
        }
      });

      await expect(harness.coordinator.process(claim())).rejects.toMatchObject({
        code: "provider_dispatch.invalid_intent_linkage",
        retryable: false
      });
      expect(harness.planner.plan).not.toHaveBeenCalled();
      expect(harness.dispatch).not.toHaveBeenCalled();
    }
  });

  it("opens against the current binding revision when binding generation is an independent axis", async () => {
    const bindingRevision = "17";
    const independentAxisOpen = requireOpenCommit(
      inboxV2OutboundDispatchAttemptCommitSchema.parse({
        ...openAttemptCommit,
        bindingHeadSnapshot: {
          ...openAttemptCommit.bindingHeadSnapshot,
          bindingRevision
        }
      })
    );
    const contentPlan = contentPlanFor(fixture.queuedDispatch, {
      bindingRevision
    });
    const harness = createHarness({
      dispatch: fixture.queuedDispatch,
      contentPlan,
      plan: {
        kind: "open_attempt",
        commit: independentAxisOpen,
        request: { text: "independent binding revision" }
      }
    });

    expect(bindingRevision).not.toBe(
      independentAxisOpen.routeSnapshot.bindingFence.bindingGeneration
    );
    await expect(harness.coordinator.process(claim())).resolves.toMatchObject({
      outcome: "finalized",
      source: "provider_result"
    });
    expect(harness.applyAttemptFenced).toHaveBeenCalledTimes(1);
    expect(harness.dispatch).toHaveBeenCalledTimes(1);
  });

  it("rejects route-snapshot fence drift after planning but before durable open or adapter I/O", async () => {
    const routeDriftPlans = [
      contentPlanFor(fixture.queuedDispatch, {
        conversation: {
          ...fixture.route.conversation,
          id: "conversation:drifted-conversation"
        }
      }),
      contentPlanFor(fixture.queuedDispatch, { bindingRevision: "99" }),
      contentPlanFor(fixture.queuedDispatch, { capabilityRevision: "99" }),
      contentPlanFor(fixture.queuedDispatch, {
        adapterContract: {
          ...fixture.route.adapterContract,
          declarationRevision: "99"
        }
      })
    ];

    for (const contentPlan of routeDriftPlans) {
      const harness = createHarness({
        dispatch: fixture.queuedDispatch,
        contentPlan,
        plan: {
          kind: "open_attempt",
          commit: openAttemptCommit,
          request: { text: "route-snapshot-drift" }
        }
      });

      await expect(harness.coordinator.process(claim())).rejects.toMatchObject({
        code: "provider_dispatch.invalid_plan",
        retryable: false
      });
      expect(harness.planner.plan).toHaveBeenCalledTimes(1);
      expect(harness.applyAttemptFenced).not.toHaveBeenCalled();
      expect(harness.dispatch).not.toHaveBeenCalled();
    }
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
        applyProviderResultFenced: harness.applyProviderResultFenced,
        applyRouteFailureFenced: harness.applyRouteFailureFenced,
        reconcileFenced: harness.reconcileFenced
      },
      planner: harness.planner,
      adapter: { dispatch: harness.dispatch },
      completedByTrustedServiceId: trustedServiceId,
      providerObservationMaterializer,
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

function routeFailureCommit(kind: "structural" | "admin_disabled" | "runtime") {
  const failedAt = OUTBOUND_TEST_TIMES.openedAt;
  const structural = kind === "structural";
  const adminDisabled = kind === "admin_disabled";
  const bindingHeadSnapshot = {
    ...fixture.bindingHeadSnapshot,
    fence: {
      ...fixture.bindingHeadSnapshot.fence,
      ...(structural ? { bindingGeneration: "2" } : {}),
      ...(adminDisabled ? { administrativeRevision: "2" } : {})
    },
    administrative: adminDisabled
      ? {
          state: "disabled" as const,
          revision: "2"
        }
      : fixture.bindingHeadSnapshot.administrative,
    runtimeHealth:
      kind === "runtime"
        ? { state: "unavailable" as const, revision: "2" }
        : fixture.bindingHeadSnapshot.runtimeHealth,
    bindingRevision: "2",
    updatedAt: failedAt
  };
  return inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
    tenantId: fixture.tenantId,
    routeSnapshot: fixture.route,
    bindingHeadSnapshot,
    error:
      structural || adminDisabled
        ? {
            code: "route.binding_changed",
            retryability: "retryable_resolution",
            diagnostic: null
          }
        : {
            code: "route.runtime_unavailable",
            retryability: "retryable_same_route",
            diagnostic: null
          },
    dispatchBefore: fixture.queuedDispatch,
    dispatchAfter:
      kind === "runtime"
        ? fixture.queuedDispatch
        : {
            ...fixture.queuedDispatch,
            state: "terminal_failure",
            revision: "2",
            updatedAt: failedAt
          },
    failedByTrustedServiceId: trustedServiceId,
    failedAt
  });
}

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
