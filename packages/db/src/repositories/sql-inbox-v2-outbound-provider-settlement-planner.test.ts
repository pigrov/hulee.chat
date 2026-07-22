import {
  calculateInboxV2OutboundDispatchContentPlanDigest,
  calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest,
  deriveInboxV2OutboundProviderObservationId,
  INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  type InboxV2OutboundProviderSettlementCommit,
  InboxV2OutboundDispatch,
  InboxV2OutboundDispatchAttempt,
  InboxV2OutboundProviderObservation
} from "@hulee/contracts";
import {
  fixtureAcceptedAttempt,
  fixtureAcceptedDispatch,
  fixtureAdapterContract,
  fixtureContent,
  fixtureExternalReference,
  fixtureExternalThreadMapping,
  fixtureMessage,
  fixtureOccurrence,
  fixtureOutboundBindingSnapshot,
  fixtureReference,
  fixtureRoute,
  fixtureT0,
  fixtureT2,
  fixtureT3,
  fixtureT4,
  fixtureTenantId,
  fixtureTimelineItem
} from "../../../contracts/src/inbox-v2/timeline-message-fixtures.type-fixture";
import { describe, expect, it } from "vitest";

import {
  buildInboxV2OutboundProviderSettlementCommit,
  buildInboxV2OutboundProviderSettlementTransitionForTest,
  type InboxV2OutboundProviderSettlementLoadedState,
  occurrenceTimeBindingMatchesForTest,
  selectProviderResponseOccurrenceProofTransportForTest,
  selectInboxV2OutboundProviderSettlementTimestampForTest
} from "./sql-inbox-v2-outbound-provider-settlement-planner";

describe("Inbox V2 outbound provider settlement planner", () => {
  it("retains a coherent already-accepted multipart head for partial per-artifact settlement", () => {
    const attempt = acceptedAttempt();
    const dispatch = acceptedDispatch(attempt);
    const observation = {
      tenantId: dispatch.tenantId,
      dispatch,
      attempt
    } as unknown as InboxV2OutboundProviderObservation;

    expect(
      buildInboxV2OutboundProviderSettlementTransitionForTest(
        observation,
        { dispatch, attempt },
        false,
        "2026-07-14T08:03:00.000Z"
      )
    ).toEqual({
      kind: "already_accepted",
      dispatch,
      attempt
    });
  });

  it("fails closed when the accepted current head is not the observed immutable head", () => {
    const attempt = acceptedAttempt();
    const dispatch = acceptedDispatch(attempt);
    const observation = {
      tenantId: dispatch.tenantId,
      dispatch,
      attempt
    } as unknown as InboxV2OutboundProviderObservation;

    expect(() =>
      buildInboxV2OutboundProviderSettlementTransitionForTest(
        observation,
        {
          dispatch: { ...dispatch, revision: "4" } as InboxV2OutboundDispatch,
          attempt
        },
        false,
        "2026-07-14T08:03:00.000Z"
      )
    ).toThrow("core:provider-settlement-partial-state-conflict");
  });

  it("uses the accepted descendant head when an echo was observed before provider response completion", () => {
    const accepted = acceptedAttempt();
    const acceptedHead = acceptedDispatch(accepted);
    const pending = {
      ...accepted,
      outcome: { kind: "pending" as const },
      completionSource: null,
      revision: "1"
    } as InboxV2OutboundDispatchAttempt;
    const attempting = {
      ...acceptedHead,
      state: "attempting" as const,
      activeAttempt: acceptedHead.lastAttempt,
      revision: "2",
      updatedAt: pending.openedAt
    } as InboxV2OutboundDispatch;
    const observation = {
      tenantId: attempting.tenantId,
      dispatch: attempting,
      attempt: pending
    } as unknown as InboxV2OutboundProviderObservation;

    const transition = buildInboxV2OutboundProviderSettlementTransitionForTest(
      observation,
      { dispatch: acceptedHead, attempt: accepted },
      false,
      "2026-07-14T08:03:00.000Z"
    );
    expect(transition).toEqual({
      kind: "already_accepted",
      dispatch: acceptedHead,
      attempt: accepted
    });
    expect(
      selectProviderResponseOccurrenceProofTransportForTest(
        observation,
        transition
      )
    ).toEqual({ dispatch: acceptedHead, attempt: accepted });
  });

  it("uses the planner transaction clock when durable provider truth waited in the queue", () => {
    expect(
      selectInboxV2OutboundProviderSettlementTimestampForTest(
        ["2026-07-14T08:00:00.000Z", "2026-07-14T08:03:00.000Z"],
        "2026-07-14T09:30:00.000Z"
      )
    ).toBe("2026-07-14T09:30:00.000Z");
  });

  it("uses the occurrence-time echo snapshot after the current binding was disabled and advanced", () => {
    const occurrence = fixtureOccurrence({ origin: "provider_echo" });
    const parsedOccurrence = occurrence as unknown as Parameters<
      typeof occurrenceTimeBindingMatchesForTest
    >[2];
    const route = fixtureRoute();
    const bindingFixture = fixtureOutboundBindingSnapshot(route);
    const historicalBinding = {
      ...bindingFixture,
      capabilities: {
        ...bindingFixture.capabilities,
        revision: occurrence.descriptor.capabilityRevision
      }
    };
    const projection = {
      binding: historicalBinding,
      currentRemoteAccessEpisode: null
    } as unknown as Parameters<typeof occurrenceTimeBindingMatchesForTest>[0];
    const identity = {
      tenantId: occurrence.tenantId,
      sourceAccount: historicalBinding.sourceAccount,
      sourceConnection: historicalBinding.sourceConnection,
      state: "verified",
      revision: "1",
      accountGeneration:
        historicalBinding.accountIdentitySnapshot.accountGeneration,
      canonicalIdentity: {
        scope: {
          kind: "source_connection",
          owner: historicalBinding.sourceConnection
        }
      }
    } as unknown as Parameters<typeof occurrenceTimeBindingMatchesForTest>[1];
    const disabledCurrent = {
      ...historicalBinding,
      administrative: {
        ...historicalBinding.administrative,
        state: "disabled" as const,
        revision: "2"
      },
      bindingGeneration: "2",
      revision: "2"
    };

    expect(disabledCurrent).not.toEqual(historicalBinding);
    expect(
      occurrenceTimeBindingMatchesForTest(
        projection,
        identity,
        parsedOccurrence,
        historicalBinding.revision
      )
    ).toBe(true);
    expect(
      occurrenceTimeBindingMatchesForTest(
        {
          ...projection,
          binding: {
            ...historicalBinding,
            bindingGeneration: "9"
          }
        } as unknown as Parameters<
          typeof occurrenceTimeBindingMatchesForTest
        >[0],
        identity,
        parsedOccurrence,
        historicalBinding.revision
      )
    ).toBe(false);
  });

  it("keeps the raw binding on the message link and the full projection on provider response materialization", () => {
    const state = providerResponseLoadedState();

    const commit: InboxV2OutboundProviderSettlementCommit =
      buildInboxV2OutboundProviderSettlementCommit(state);

    expect(commit.messageTransportAssociation.occurrenceBinding).toEqual(
      state.occurrenceBinding.binding
    );
    expect(commit.messageTransportAssociation.occurrenceBinding).not.toEqual(
      state.occurrenceBinding
    );
    expect(commit.occurrenceMaterialization.kind).toBe("provider_response");
    if (commit.occurrenceMaterialization.kind !== "provider_response") {
      throw new Error("Expected provider-response occurrence materialization.");
    }
    expect(
      commit.occurrenceMaterialization.commit.bindingMaterialization
        .currentProjection
    ).toEqual(state.occurrenceBinding);
    expect(
      commit.occurrenceMaterialization.commit.bindingMaterialization
        .currentProjection.binding
    ).toEqual(state.occurrenceBinding.binding);
    expect(commit.occurrenceMaterialization.commit.authority.authorizedAt).toBe(
      state.observation.sourceOccurrence.recordedAt
    );
    expect(commit.occurrenceMaterialization.commit.materializedAt).toBe(
      state.observation.sourceOccurrence.recordedAt
    );
    expect(commit.settledAt).toBe(fixtureT4);
    expect(commit.settledAt).not.toBe(
      state.observation.sourceOccurrence.recordedAt
    );
  });
});

function providerResponseLoadedState(): InboxV2OutboundProviderSettlementLoadedState {
  const route = fixtureRoute();
  const attempt = fixtureAcceptedAttempt();
  const dispatch = fixtureAcceptedDispatch();
  const providerResponseOccurrence = fixtureOccurrence({
    origin: "provider_response",
    direction: "outbound",
    recordedAt: fixtureT3,
    occurrenceId: "source_occurrence:planner-provider-response",
    externalSubject: "Provider-Message-Planner-Response"
  });
  const sourceOccurrence = {
    ...providerResponseOccurrence,
    descriptor: {
      ...providerResponseOccurrence.descriptor,
      capabilityRevision: route.bindingFence.capabilityRevision
    },
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:message-reference-pending",
        retryable: true,
        correlationToken: "correlation:planner-provider-response",
        safeOperatorHintId: null
      }
    },
    observedAt: fixtureT3,
    recordedAt: fixtureT3,
    revision: "1",
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  };
  const artifact = {
    tenantId: fixtureTenantId,
    id: "outbound_dispatch_artifact:planner-provider-response",
    dispatch: fixtureReference("outbound_dispatch", dispatch.id),
    route: fixtureReference("outbound_route", route.id),
    attempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    ordinal: 1,
    state: "accepted" as const,
    diagnostic: null,
    createdAt: attempt.openedAt,
    revision: "1"
  };
  const evidence = {
    kind: "provider_response_attempt" as const,
    artifactOrdinal: 1,
    outboundDispatchAttempt: fixtureReference(
      "outbound_dispatch_attempt",
      attempt.id
    )
  };
  const observationWithoutDigest = {
    tenantId: fixtureTenantId,
    id: deriveInboxV2OutboundProviderObservationId({
      tenantId: fixtureTenantId,
      attempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
      artifactOrdinal: artifact.ordinal,
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        sourceOccurrence.id
      ),
      evidenceKind: evidence.kind
    }),
    artifact,
    dispatch,
    route,
    attempt,
    sourceOccurrence,
    evidence,
    effectDisposition:
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
    observedByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
    recordedAt: fixtureT3,
    revision: "1" as const
  };
  const observation = {
    ...observationWithoutDigest,
    sourceOccurrenceDetailDigestSha256:
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
        sourceOccurrence
      )
  } as unknown as InboxV2OutboundProviderObservation;
  const binding = fixtureOutboundBindingSnapshot(route);
  const occurrenceBinding = {
    binding,
    currentRemoteAccessEpisode: {
      tenantId: fixtureTenantId,
      id: "source_thread_binding_remote_access_episode:planner-response",
      binding: fixtureReference("source_thread_binding", binding.id),
      state: binding.remoteAccess.state,
      startedAt: binding.remoteAccess.since,
      endedAt: null,
      startEvidence: binding.remoteAccess.evidence,
      endEvidence: [],
      revision: "1",
      createdAt: binding.remoteAccess.since,
      updatedAt: binding.remoteAccess.since
    }
  };
  const identitySnapshot = binding.accountIdentitySnapshot;
  const externalMessageReference = fixtureExternalReference(
    sourceOccurrence as unknown as Parameters<
      typeof fixtureExternalReference
    >[0],
    {
      id: "external_message_reference:planner-provider-response",
      createdAt: fixtureT3
    }
  );
  const content = fixtureContent();

  return {
    claim: {
      tenantId: fixtureTenantId,
      observationId: observation.id,
      candidateExternalMessageReferenceId: externalMessageReference.id,
      candidateTransportLinkId:
        "message_transport_occurrence_link:planner-provider-response",
      trustedServiceId: observation.observedByTrustedServiceId,
      workerId: "core:planner-test-worker",
      leaseToken: `settlement-lease:${"a".repeat(48)}`,
      leaseRevision: "1",
      attemptCount: "1",
      claimedAt: fixtureT3,
      expiresAt: fixtureT4,
      revision: "1"
    },
    observation,
    currentTransport: { dispatch, attempt },
    contentPlan: providerResponseContentPlan(route),
    existingResolutions: [],
    existingArtifactLink: null,
    persistedOccurrence: null,
    externalMessageReference,
    externalThreadMapping: fixtureExternalThreadMapping(),
    occurrenceBinding,
    sourceAccountIdentity: {
      tenantId: fixtureTenantId,
      sourceAccount: binding.sourceAccount,
      sourceConnection: binding.sourceConnection,
      identityDeclaration: identitySnapshot.declaration,
      accountGeneration: identitySnapshot.accountGeneration,
      revision: "1",
      createdAt: fixtureT0,
      updatedAt: fixtureT0,
      state: "verified",
      expectedCanonicalScope: null,
      provisionalIdentity: null,
      canonicalIdentity: {
        realm: {
          realmId: identitySnapshot.declaration.realmId,
          realmVersion: identitySnapshot.declaration.realmVersion,
          canonicalizationVersion:
            identitySnapshot.declaration.canonicalizationVersion,
          objectKindId: identitySnapshot.declaration.objectKindId
        },
        scope: {
          kind: "source_connection",
          owner: binding.sourceConnection
        },
        canonicalExternalSubject: identitySnapshot.canonicalExternalSubject
      },
      verifiedBy: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId
        },
        policyId: "core:provider-account-verification",
        policyVersion: "v1",
        reasonCodeId: "core:account-verified",
        verificationEvidenceToken: "evidence:planner-account-verified",
        decidedAt: fixtureT0
      },
      conflict: null
    },
    messageAggregate: {
      message: fixtureMessage("hulee", content),
      timelineItem: fixtureTimelineItem("external"),
      content,
      contentRetentionAnchorAt: fixtureT2,
      databaseNow: fixtureT3,
      streamPosition: "1"
    },
    linkHeadBefore: null,
    plannedAt: fixtureT4
  } as unknown as InboxV2OutboundProviderSettlementLoadedState;
}

function providerResponseContentPlan(route: ReturnType<typeof fixtureRoute>) {
  const input = {
    tenantId: fixtureTenantId,
    id: "outbound_dispatch_content_plan:planner-provider-response",
    dispatch: fixtureReference(
      "outbound_dispatch",
      "outbound_dispatch:dispatch-1"
    ),
    message: fixtureReference("message", "message:message-1"),
    messageRevision: "1",
    conversation: route.conversation,
    timelineItem: fixtureReference("timeline_item", "timeline_item:item-1"),
    route: fixtureReference("outbound_route", route.id),
    timelineContent: fixtureReference(
      "timeline_content",
      "timeline_content:content-1"
    ),
    contentRevision: "1",
    contentFingerprint: {
      purposeId: INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID,
      keyGeneration: "outbound-content-key:g1",
      validUntil: fixtureT4,
      hmacSha256: `hmac-sha256:${"a".repeat(64)}`
    },
    binding: route.sourceThreadBinding,
    bindingRevision: "1",
    capabilityRevision: route.bindingFence.capabilityRevision,
    adapterContract: route.adapterContract,
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
        capabilityId: "core:message-text-send",
        operationId: route.operationId,
        blockKeys: ["body-1"]
      }
    ],
    createdAt: fixtureT2,
    revision: "1" as const
  };
  return {
    ...input,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(input)
  };
}

function acceptedAttempt(): InboxV2OutboundDispatchAttempt {
  return {
    tenantId: "tenant:planner-test",
    id: "outbound_dispatch_attempt:planner-test",
    dispatch: {
      tenantId: "tenant:planner-test",
      kind: "outbound_dispatch",
      id: "outbound_dispatch:planner-test"
    },
    route: {
      tenantId: "tenant:planner-test",
      kind: "outbound_route",
      id: "outbound_route:planner-test"
    },
    attemptNumber: 1,
    claimToken: `claim:${"a".repeat(40)}`,
    retrySafety: {
      mechanism: "provider_idempotency_key",
      providerCorrelationToken: `provider:${"b".repeat(40)}`,
      automaticRetryAllowed: true
    },
    leaseExpiresAt: "2026-07-14T08:02:00.000Z",
    openedAt: "2026-07-14T08:01:00.000Z",
    outcome: {
      kind: "accepted",
      completedAt: "2026-07-14T08:02:30.000Z",
      providerAcknowledgementToken: null
    },
    completionSource: "provider_result",
    revision: "2"
  } as InboxV2OutboundDispatchAttempt;
}

function acceptedDispatch(
  attempt: InboxV2OutboundDispatchAttempt
): InboxV2OutboundDispatch {
  return {
    tenantId: attempt.tenantId,
    id: attempt.dispatch.id,
    message: {
      tenantId: attempt.tenantId,
      kind: "message",
      id: "message:planner-test"
    },
    route: attempt.route,
    state: "accepted",
    attemptCount: 1,
    activeAttempt: null,
    lastAttempt: {
      tenantId: attempt.tenantId,
      kind: "outbound_dispatch_attempt",
      id: attempt.id
    },
    retryAuthorization: null,
    createdAt: "2026-07-14T08:00:00.000Z",
    updatedAt: "2026-07-14T08:02:30.000Z",
    revision: "3"
  } as InboxV2OutboundDispatch;
}
