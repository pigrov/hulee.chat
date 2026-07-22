import { type SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";
import {
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  calculateInboxV2OutboundDispatchContentPlanDigest,
  calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2OutboundProviderObservationId,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchContentPlanSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2SourceMessageExactOutboundCorrelationSchema,
  inboxV2SourceOccurrenceSchema,
  type InboxV2OutboundDispatch,
  type InboxV2OutboundDispatchArtifact,
  type InboxV2OutboundDispatchAttempt,
  type InboxV2OutboundProviderObservation,
  type InboxV2OutboundRoute,
  type InboxV2SourceMessageExactOutboundCorrelation,
  type InboxV2SourceMessageReconciliationPlan,
  type InboxV2SourceOccurrence
} from "@hulee/contracts";

import {
  buildFindInboxV2OutboundProviderEchoTargetSql,
  createTestOnlySqlInboxV2OutboundProviderEchoCallbacks,
  type InboxV2OutboundProviderEchoDependencies,
  type InboxV2OutboundProviderEchoObservationMaterializer,
  type InboxV2OutboundProviderEchoTarget
} from "./sql-inbox-v2-outbound-provider-echo-repository";
import {
  createOutboundTransportContractFixture,
  OUTBOUND_TEST_TIMES
} from "./sql-inbox-v2-outbound-transport-repository.test-support";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const fixture = createOutboundTransportContractFixture({ suffix: "echo" });
const exactCorrelation =
  inboxV2SourceMessageExactOutboundCorrelationSchema.parse({
    providerReferenceKindId: "module:synthetic:client-correlation-token",
    correlationToken:
      fixture.pendingAttempt.retrySafety.providerCorrelationToken!,
    artifactOrdinal: 1
  });
const wrongKindCorrelation =
  inboxV2SourceMessageExactOutboundCorrelationSchema.parse({
    ...exactCorrelation,
    providerReferenceKindId: "module:synthetic:wrong"
  });
const wrongOrdinalCorrelation =
  inboxV2SourceMessageExactOutboundCorrelationSchema.parse({
    ...exactCorrelation,
    artifactOrdinal: 2
  });
const transaction = {} as RawSqlExecutor;

describe("Inbox V2 exact outbound provider echo SQL callback", () => {
  it("materializes one accepted artifact and durable no-effect observation for echo-first", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
    const target = echoTarget({
      dispatch: fixture.attemptingDispatch,
      attempt: fixture.pendingAttempt,
      occurrence,
      artifact: null
    });
    const harness = callbackHarness(target);

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).resolves.toEqual({ kind: "pending" });

    expect(harness.ensureArtifact).toHaveBeenCalledOnce();
    const artifact = harness.ensureArtifact.mock.calls[0]![1];
    expect(artifact).toMatchObject({
      id: deterministicArtifactId(fixture.pendingAttempt),
      state: "accepted",
      diagnostic: null,
      createdAt: fixture.pendingAttempt.openedAt,
      ordinal: 1
    });
    expect(harness.persistObservation).toHaveBeenCalledOnce();
    const observation =
      harness.persistObservation.mock.calls[0]![1].observation;
    expect(observation.effectDisposition).toEqual(
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION
    );
    expect(observation.evidence).toEqual({
      kind: "provider_echo_correlation",
      ...exactCorrelation
    });
    expect(harness.enqueueSettlementWork).toHaveBeenCalledWith(transaction, {
      observation,
      candidateExternalMessageReferenceId:
        "external_message_reference:echo-candidate",
      candidateTransportLinkId:
        "message_transport_occurrence_link:echo-candidate"
    });
  });

  it("reuses response-first accepted artifact and remains idempotent on callback replay", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.linkedAt);
    const artifact = acceptedArtifact(fixture.acceptedAttempt);
    const target = echoTarget({
      dispatch: fixture.acceptedDispatch,
      attempt: fixture.acceptedAttempt,
      occurrence,
      artifact
    });
    const harness = callbackHarness(target, {
      artifactResult: "already_exists",
      observationResult: "already_exists"
    });
    const plan = echoPlan(occurrence);

    await expect(resolve(harness.callbacks, plan)).resolves.toEqual({
      kind: "pending"
    });
    await expect(resolve(harness.callbacks, plan)).resolves.toEqual({
      kind: "pending"
    });

    expect(harness.ensureArtifact).toHaveBeenCalledTimes(2);
    expect(harness.persistObservation).toHaveBeenCalledTimes(2);
    expect(harness.enqueueSettlementWork).toHaveBeenCalledTimes(2);
    expect(harness.ensureArtifact.mock.calls[0]![1]).toEqual(artifact);
    expect(harness.persistObservation.mock.calls[0]![1].observation.id).toBe(
      harness.persistObservation.mock.calls[1]![1].observation.id
    );
  });

  it("records exact evidence for outcome_unknown without scheduling a blind retry", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.linkedAt);
    const artifact = unknownArtifact(fixture.unknownAttempt);
    const target = echoTarget({
      dispatch: fixture.unknownDispatch,
      attempt: fixture.unknownAttempt,
      occurrence,
      artifact
    });
    const harness = callbackHarness(target, {
      artifactResult: "already_exists"
    });

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).resolves.toEqual({ kind: "pending" });

    expect(harness.ensureArtifact.mock.calls[0]![1]).toEqual(artifact);
    expect(
      harness.persistObservation.mock.calls[0]![1].observation
    ).toMatchObject({
      artifact: { state: "outcome_unknown" },
      dispatch: { state: "outcome_unknown" },
      attempt: { outcome: { kind: "outcome_unknown" } },
      effectDisposition: {
        requiresProviderIo: false,
        createsOutboundDispatch: false,
        notificationEligible: false
      }
    });
  });

  it("accepts an authoritative provider-thread cross-account occurrence only as another observation", async () => {
    const occurrence = crossAccountOccurrence(true);
    const target = echoTarget({
      dispatch: fixture.attemptingDispatch,
      attempt: fixture.pendingAttempt,
      occurrence,
      artifact: null
    });
    const harness = callbackHarness(target);

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).resolves.toEqual({ kind: "pending" });

    expect(harness.persistObservation).toHaveBeenCalledOnce();
    const observation =
      harness.persistObservation.mock.calls[0]![1].observation;
    expect(
      observation.sourceOccurrence.bindingContext.sourceAccount.id
    ).not.toBe(fixture.route.sourceAccount.id);
    expect(observation.dispatch.message).toEqual(
      fixture.attemptingDispatch.message
    );
    expect(observation.effectDisposition.countsAsCustomerInbound).toBe(false);
  });

  it.each([
    ["non-exact marker", null, "target"],
    ["unknown durable anchor", exactCorrelation, "missing"],
    ["unproven cross-account scope", exactCorrelation, "cross_account"],
    ["mismatched provider reference kind", wrongKindCorrelation, "target"],
    ["mismatched artifact ordinal", wrongOrdinalCorrelation, "target"]
  ] as const)(
    "fails closed for %s without artifact, observation or client effects",
    async (_label, correlation, targetKind) => {
      const occurrence =
        targetKind === "cross_account"
          ? crossAccountOccurrence(false)
          : echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
      const target =
        targetKind === "missing"
          ? null
          : echoTarget({
              dispatch: fixture.attemptingDispatch,
              attempt: fixture.pendingAttempt,
              occurrence,
              artifact: null
            });
      const harness = callbackHarness(target);

      await expect(
        resolve(harness.callbacks, echoPlan(occurrence, correlation))
      ).resolves.toEqual({ kind: "pending" });

      expect(harness.ensureArtifact).not.toHaveBeenCalled();
      expect(harness.persistObservation).not.toHaveBeenCalled();
      expect(harness.enqueueSettlementWork).not.toHaveBeenCalled();
    }
  );

  it("returns a closed callback conflict for a counterfeit materializer result", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
    const target = echoTarget({
      dispatch: fixture.attemptingDispatch,
      attempt: fixture.pendingAttempt,
      occurrence,
      artifact: null
    });
    const harness = callbackHarness(target, {
      materializer: {
        materializeProviderEcho(input) {
          return {
            ...materializeObservation(input),
            id: "outbound_provider_observation:counterfeit"
          } as InboxV2OutboundProviderObservation;
        }
      }
    });

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).resolves.toEqual({
      kind: "conflict",
      code: "source.message_reconciliation.callback_conflict"
    });
    expect(harness.ensureArtifact).not.toHaveBeenCalled();
    expect(harness.persistObservation).not.toHaveBeenCalled();
  });

  it("forces ambient rollback if observation persistence conflicts after echo-first artifact insertion", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
    const target = echoTarget({
      dispatch: fixture.attemptingDispatch,
      attempt: fixture.pendingAttempt,
      occurrence,
      artifact: null
    });
    const harness = callbackHarness(target, {
      observationResult: "conflict"
    });

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).rejects.toThrow("ambient reconciliation transaction must roll back");
  });

  it("forces ambient rollback if durable settlement enqueue conflicts after observation insertion", async () => {
    const occurrence = echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
    const target = echoTarget({
      dispatch: fixture.attemptingDispatch,
      attempt: fixture.pendingAttempt,
      occurrence,
      artifact: null
    });
    const harness = callbackHarness(target, {
      settlementWorkResult: "conflict"
    });

    await expect(
      resolve(harness.callbacks, echoPlan(occurrence))
    ).rejects.toThrow("ambient reconciliation transaction must roll back");
  });

  it("looks up only tenant/adapter/thread/exact-token anchors without taking transport locks out of order", () => {
    const rendered = renderQuery(
      buildFindInboxV2OutboundProviderEchoTargetSql({
        tenantId: fixture.tenantId,
        adapterContract: fixture.route.adapterContract,
        externalThreadId: fixture.route.externalThread.id,
        correlationToken: exactCorrelation.correlationToken,
        artifactOrdinal: exactCorrelation.artifactOrdinal
      })
    );
    const statement = normalizeSql(rendered.sql);

    expect(statement).toContain(
      "from inbox_v2_outbound_provider_correlation_anchors anchor_row"
    );
    expect(statement).toContain("anchor_row.adapter_contract_id = $");
    expect(statement).toContain("anchor_row.correlation_token = $");
    expect(statement).toContain("anchor_row.external_thread_id = $");
    expect(statement).toContain("attempt_row.provider_correlation_token = $");
    expect(statement).not.toContain("for share");
    expect(statement).not.toContain("for update");
    expect(statement).not.toContain("content");
    expect(statement).not.toContain("sender");
    expect(rendered.params).toContain(exactCorrelation.correlationToken);
  });
});

function callbackHarness(
  target: InboxV2OutboundProviderEchoTarget | null,
  input: Readonly<{
    artifactResult?: "committed" | "already_exists" | "conflict";
    observationResult?: "committed" | "already_exists" | "conflict";
    settlementWorkResult?: "committed" | "already_exists" | "conflict";
    materializer?: InboxV2OutboundProviderEchoObservationMaterializer;
  }> = {}
) {
  const loadExactCorrelationTarget = vi.fn<
    InboxV2OutboundProviderEchoDependencies["loadExactCorrelationTarget"]
  >(async () => target);
  const ensureArtifact = vi.fn<
    InboxV2OutboundProviderEchoDependencies["ensureArtifact"]
  >(async () => ({ kind: input.artifactResult ?? "committed" }));
  const persistObservation = vi.fn<
    InboxV2OutboundProviderEchoDependencies["persistObservation"]
  >(async () => ({ kind: input.observationResult ?? "committed" }));
  const enqueueSettlementWork = vi.fn<
    InboxV2OutboundProviderEchoDependencies["enqueueSettlementWork"]
  >(async () => ({ kind: input.settlementWorkResult ?? "committed" }));
  const dependencies: InboxV2OutboundProviderEchoDependencies = {
    loadExactCorrelationTarget,
    ensureArtifact,
    persistObservation,
    enqueueSettlementWork
  };
  const callbacks = createTestOnlySqlInboxV2OutboundProviderEchoCallbacks({
    observationMaterializer: input.materializer ?? observationMaterializer,
    dependencies
  });
  return {
    callbacks,
    loadExactCorrelationTarget,
    ensureArtifact,
    persistObservation,
    enqueueSettlementWork
  };
}

async function resolve(
  callbacks: ReturnType<
    typeof createTestOnlySqlInboxV2OutboundProviderEchoCallbacks
  >,
  plan: EchoPlan
) {
  if (callbacks.resolveProviderEcho === undefined) {
    throw new Error("Provider echo callback is absent.");
  }
  return callbacks.resolveProviderEcho(transaction, { plan });
}

type EchoPlan = InboxV2SourceMessageReconciliationPlan &
  Readonly<{
    intent: Extract<
      InboxV2SourceMessageReconciliationPlan["intent"],
      { kind: "echo_handoff" }
    >;
  }>;

function echoPlan(
  occurrence: InboxV2SourceOccurrence,
  correlation: InboxV2SourceMessageExactOutboundCorrelation | null = exactCorrelation
): EchoPlan {
  return {
    sourceOccurrence: occurrence,
    candidateExternalMessageReferenceId:
      "external_message_reference:echo-candidate",
    intent: {
      kind: "echo_handoff",
      transportRole: "provider_echo",
      exactOutboundCorrelation: correlation,
      candidateTransportLinkId:
        "message_transport_occurrence_link:echo-candidate"
    }
  } as unknown as EchoPlan;
}

function echoOccurrenceAt(recordedAt: string): InboxV2SourceOccurrence {
  const source = fixture.echoAssociation.occurrenceResolution.before;
  return inboxV2SourceOccurrenceSchema.parse({
    ...source,
    providerTimestamps: [
      {
        kindId: "module:synthetic:sent-at",
        timestamp: OUTBOUND_TEST_TIMES.artifactAt
      }
    ],
    observedAt: OUTBOUND_TEST_TIMES.artifactAt,
    recordedAt,
    createdAt: recordedAt,
    updatedAt: recordedAt
  });
}

function crossAccountOccurrence(
  authoritative: boolean
): InboxV2SourceOccurrence {
  const source = echoOccurrenceAt(OUTBOUND_TEST_TIMES.artifactAt);
  const sourceAccount = {
    ...source.bindingContext.sourceAccount,
    id: "source_account:echo-other-account"
  };
  const sourceThreadBinding = {
    ...source.bindingContext.sourceThreadBinding,
    id: "source_thread_binding:echo-other-account"
  };
  const scope = authoritative
    ? ({ kind: "provider_thread" } as const)
    : ({ kind: "source_thread_binding", owner: sourceThreadBinding } as const);
  return inboxV2SourceOccurrenceSchema.parse({
    ...source,
    messageKey: { ...source.messageKey, scope },
    messageIdentityDeclaration: {
      ...source.messageIdentityDeclaration,
      scopeKind: scope.kind,
      decisionStrength: authoritative ? "authoritative" : "safe_default"
    },
    bindingContext: {
      ...source.bindingContext,
      sourceAccount,
      sourceThreadBinding
    },
    origin: { ...source.origin, sourceAccount },
    referencePortability: {
      ...source.referencePortability,
      kind: authoritative ? "external_thread" : "binding_only",
      decisionStrength: authoritative ? "authoritative" : "safe_default"
    }
  });
}

function echoTarget(
  input: Readonly<{
    dispatch: InboxV2OutboundDispatch;
    attempt: InboxV2OutboundDispatchAttempt;
    occurrence: InboxV2SourceOccurrence;
    artifact: InboxV2OutboundDispatchArtifact | null;
  }>
): InboxV2OutboundProviderEchoTarget {
  return {
    dispatch: input.dispatch,
    route: fixture.route,
    attempt: input.attempt,
    artifact: input.artifact,
    contentPlan: contentPlan()
  };
}

function contentPlan() {
  const base = {
    tenantId: fixture.tenantId,
    id: "outbound_dispatch_content_plan:echo",
    dispatch: fixture.references.dispatch,
    message: fixture.queuedDispatch.message,
    messageRevision: "1",
    conversation: fixture.references.conversation,
    timelineItem: fixture.references.timelineItem,
    route: fixture.references.route,
    timelineContent: {
      tenantId: fixture.tenantId,
      kind: "timeline_content" as const,
      id: "timeline_content:echo"
    },
    contentRevision: "1",
    contentFingerprint: {
      purposeId: "core:outbound_dispatch_content_plan" as const,
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
        blockKey: "body-1",
        blockKind: "text" as const,
        exactFileObjectPin: null,
        artifactOrdinal: 1
      }
    ],
    artifacts: [
      {
        ordinal: 1,
        grouping: "single" as const,
        capabilityId: "core:message-text-send" as const,
        operationId: fixture.route.operationId,
        blockKeys: ["body-1"]
      }
    ],
    createdAt: fixture.queuedDispatch.createdAt,
    revision: "1" as const
  };
  return inboxV2OutboundDispatchContentPlanSchema.parse({
    ...base,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(base)
  });
}

function deterministicArtifactId(attempt: InboxV2OutboundDispatchAttempt) {
  return deriveInboxV2OutboundDispatchArtifactId({
    tenantId: attempt.tenantId,
    dispatch: attempt.dispatch,
    route: attempt.route,
    attempt: {
      tenantId: attempt.tenantId,
      kind: "outbound_dispatch_attempt",
      id: attempt.id
    },
    ordinal: exactCorrelation.artifactOrdinal
  });
}

function acceptedArtifact(
  attempt: InboxV2OutboundDispatchAttempt
): InboxV2OutboundDispatchArtifact {
  return inboxV2OutboundDispatchArtifactSchema.parse({
    tenantId: attempt.tenantId,
    id: deterministicArtifactId(attempt),
    dispatch: attempt.dispatch,
    route: attempt.route,
    attempt: {
      tenantId: attempt.tenantId,
      kind: "outbound_dispatch_attempt",
      id: attempt.id
    },
    ordinal: 1,
    state: "accepted",
    diagnostic: null,
    createdAt: attempt.openedAt,
    revision: "1"
  });
}

function unknownArtifact(
  attempt: InboxV2OutboundDispatchAttempt
): InboxV2OutboundDispatchArtifact {
  if (attempt.outcome.kind !== "outcome_unknown") {
    throw new Error("Unknown artifact fixture requires unknown attempt.");
  }
  return inboxV2OutboundDispatchArtifactSchema.parse({
    ...acceptedArtifact(attempt),
    state: "outcome_unknown",
    diagnostic: attempt.outcome.diagnostic
  });
}

const observationMaterializer: InboxV2OutboundProviderEchoObservationMaterializer =
  Object.freeze({ materializeProviderEcho: materializeObservation });

function materializeObservation(
  input: Readonly<{
    dispatch: InboxV2OutboundDispatch;
    route: InboxV2OutboundRoute;
    attempt: InboxV2OutboundDispatchAttempt;
    artifact: InboxV2OutboundDispatchArtifact;
    sourceOccurrence: InboxV2SourceOccurrence;
    exactCorrelation: InboxV2SourceMessageExactOutboundCorrelation;
    recordedAt: string;
  }>
): InboxV2OutboundProviderObservation {
  const observationId = deriveInboxV2OutboundProviderObservationId({
    tenantId: input.dispatch.tenantId,
    attempt: {
      tenantId: input.attempt.tenantId,
      kind: "outbound_dispatch_attempt",
      id: input.attempt.id
    },
    artifactOrdinal: input.artifact.ordinal,
    sourceOccurrence: {
      tenantId: input.sourceOccurrence.tenantId,
      kind: "source_occurrence",
      id: input.sourceOccurrence.id
    },
    evidenceKind: "provider_echo_correlation"
  });
  return inboxV2OutboundProviderObservationSchema.parse({
    tenantId: input.dispatch.tenantId,
    id: observationId,
    artifact: input.artifact,
    dispatch: input.dispatch,
    route: input.route,
    attempt: input.attempt,
    sourceOccurrence: input.sourceOccurrence,
    sourceOccurrenceDetailDigestSha256:
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
        input.sourceOccurrence
      ),
    evidence: {
      kind: "provider_echo_correlation",
      artifactOrdinal: input.exactCorrelation.artifactOrdinal,
      providerReferenceKindId: input.exactCorrelation.providerReferenceKindId,
      correlationToken: input.exactCorrelation.correlationToken
    },
    effectDisposition:
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
    observedByTrustedServiceId:
      input.route.adapterContract.loadedByTrustedServiceId,
    recordedAt: input.recordedAt,
    revision: "1"
  });
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}
