import { describe, expect, it } from "vitest";

import {
  calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest,
  deriveInboxV2OutboundProviderObservationId,
  INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
  inboxV2OutboundDispatchArtifactResolutionSchema,
  inboxV2OutboundProviderObservationSchema,
  inboxV2OutboundProviderResponseObservationDescriptorSchema,
  inboxV2OutboundProviderSettlementCommitSchema
} from "./outbound-provider-observation";
import {
  calculateInboxV2OutboundDispatchContentPlanDigest,
  INBOX_V2_OUTBOUND_DISPATCH_CONTENT_FINGERPRINT_PURPOSE_ID
} from "./file-object";
import {
  fixtureAcceptedAttempt,
  fixtureAcceptedDispatch,
  fixtureAdapterContract,
  fixtureDispatch,
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
} from "./timeline-message-fixtures.type-fixture";

const correlationKindId = "module:synthetic:client-correlation-token";
const correlationToken = "provider:idempotency-0001";

function pendingAttempt() {
  const accepted = fixtureAcceptedAttempt();
  return {
    ...accepted,
    retrySafety: {
      ...accepted.retrySafety,
      mechanism: "provider_idempotency_key" as const,
      providerCorrelationToken: correlationToken,
      automaticRetryAllowed: true
    },
    outcome: { kind: "pending" as const },
    completionSource: null,
    revision: "1"
  };
}

function attemptingDispatch(attempt = pendingAttempt()) {
  return {
    ...fixtureDispatch(),
    state: "attempting" as const,
    attemptCount: 1,
    activeAttempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    lastAttempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    revision: "2",
    updatedAt: attempt.openedAt
  };
}

function acceptedAttempt() {
  const attempt = pendingAttempt();
  return {
    ...attempt,
    outcome: {
      kind: "accepted" as const,
      completedAt: fixtureT3,
      providerAcknowledgementToken: "provider:accepted-1"
    },
    completionSource: "provider_result" as const,
    revision: "2"
  };
}

function acceptedDispatch(attempt = acceptedAttempt()) {
  return {
    ...fixtureAcceptedDispatch(),
    lastAttempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    updatedAt: fixtureT3
  };
}

function unknownAttempt() {
  const attempt = pendingAttempt();
  return {
    ...attempt,
    outcome: {
      kind: "outcome_unknown" as const,
      completedAt: fixtureT3,
      diagnostic: {
        codeId: "core:provider-outcome-unknown",
        retryable: false,
        correlationToken: "diagnostic:provider-unknown-0001",
        safeOperatorHintId: "core:reconcile-before-retry"
      },
      requiredAction: "automated_reconciliation_required" as const
    },
    completionSource: "provider_result" as const,
    revision: "2"
  };
}

function unknownDispatch(attempt = unknownAttempt()) {
  return {
    ...fixtureDispatch(),
    state: "outcome_unknown" as const,
    attemptCount: 1,
    activeAttempt: null,
    lastAttempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    revision: "3",
    updatedAt: fixtureT3
  };
}

function pendingOccurrence(
  kind: "provider_echo" | "provider_response",
  input: {
    suffix?: string;
    sourceAccountId?: string;
    bindingId?: string;
  } = {}
) {
  const suffix = input.suffix ?? "1";
  const sourceAccount = fixtureReference(
    "source_account",
    input.sourceAccountId ?? "source_account:account-1"
  );
  const sourceThreadBinding = fixtureReference(
    "source_thread_binding",
    input.bindingId ?? "source_thread_binding:binding-1"
  );
  const fixture = fixtureOccurrence({
    origin: kind,
    direction: "outbound",
    recordedAt: fixtureT3,
    occurrenceId: `source_occurrence:${kind}-${suffix}`,
    externalSubject: `Provider-Message-${suffix}`
  });
  const origin =
    kind === "provider_response"
      ? {
          kind: "provider_response" as const,
          sourceAccount,
          outboundDispatchAttempt: fixtureReference(
            "outbound_dispatch_attempt",
            "outbound_dispatch_attempt:attempt-1"
          )
        }
      : {
          kind: "provider_echo" as const,
          sourceAccount,
          rawInboundEvent: fixtureReference(
            "raw_inbound_event",
            `raw_inbound_event:echo-${suffix}`
          ),
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            `normalized_inbound_event:echo-${suffix}`
          )
        };
  return {
    ...fixture,
    bindingContext: {
      ...fixture.bindingContext,
      sourceAccount,
      sourceThreadBinding
    },
    origin,
    descriptor: {
      ...fixture.descriptor,
      capabilityRevision: "4",
      providerReferences: [
        ...fixture.descriptor.providerReferences,
        { kindId: correlationKindId, subject: correlationToken }
      ]
    },
    providerActor: null,
    direction: "outbound" as const,
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:message-reference-pending",
        retryable: true,
        correlationToken: `correlation:${kind}-${suffix}`,
        safeOperatorHintId: null
      }
    },
    observedAt: fixtureT3,
    recordedAt: fixtureT3,
    revision: "1",
    createdAt: fixtureT3,
    updatedAt: fixtureT3
  };
}

function artifact(
  attempt: ReturnType<typeof pendingAttempt>,
  ordinal = 1,
  state: "accepted" | "outcome_unknown" = "accepted"
) {
  return {
    tenantId: fixtureTenantId,
    id: `outbound_dispatch_artifact:artifact-${ordinal}`,
    dispatch: fixtureReference(
      "outbound_dispatch",
      "outbound_dispatch:dispatch-1"
    ),
    route: fixtureReference("outbound_route", "outbound_route:route-1"),
    attempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    ordinal,
    state,
    diagnostic:
      state === "accepted"
        ? null
        : {
            codeId: "core:provider-outcome-unknown",
            retryable: false,
            correlationToken: `diagnostic:artifact-${ordinal}`,
            safeOperatorHintId: "core:reconcile-before-retry"
          },
    createdAt: fixtureT3,
    revision: "1"
  };
}

function observation(input: {
  evidenceKind: "provider_echo_correlation" | "provider_response_attempt";
  attempt?:
    | ReturnType<typeof pendingAttempt>
    | ReturnType<typeof acceptedAttempt>
    | ReturnType<typeof unknownAttempt>;
  dispatch?:
    | ReturnType<typeof attemptingDispatch>
    | ReturnType<typeof acceptedDispatch>
    | ReturnType<typeof unknownDispatch>;
  occurrence?: ReturnType<typeof pendingOccurrence>;
  artifactOrdinal?: number;
  artifactState?: "accepted" | "outcome_unknown";
}) {
  const attempt = input.attempt ?? acceptedAttempt();
  const dispatch =
    input.dispatch ??
    acceptedDispatch(attempt as ReturnType<typeof acceptedAttempt>);
  const artifactOrdinal = input.artifactOrdinal ?? 1;
  const sourceOccurrence =
    input.occurrence ??
    pendingOccurrence(
      input.evidenceKind === "provider_response_attempt"
        ? "provider_response"
        : "provider_echo"
    );
  const evidence =
    input.evidenceKind === "provider_response_attempt"
      ? {
          kind: "provider_response_attempt" as const,
          artifactOrdinal,
          outboundDispatchAttempt: fixtureReference(
            "outbound_dispatch_attempt",
            attempt.id
          )
        }
      : {
          kind: "provider_echo_correlation" as const,
          artifactOrdinal,
          providerReferenceKindId: correlationKindId,
          correlationToken
        };
  const observationArtifact = artifact(
    attempt as ReturnType<typeof pendingAttempt>,
    artifactOrdinal,
    input.artifactState
  );
  const id = deriveInboxV2OutboundProviderObservationId({
    tenantId: fixtureTenantId,
    attempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    artifactOrdinal,
    sourceOccurrence: fixtureReference(
      "source_occurrence",
      sourceOccurrence.id
    ),
    evidenceKind: evidence.kind
  });
  return {
    tenantId: fixtureTenantId,
    id,
    artifact: observationArtifact,
    dispatch,
    route: fixtureRoute(),
    attempt,
    sourceOccurrence,
    sourceOccurrenceDetailDigestSha256:
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
        sourceOccurrence
      ),
    evidence,
    effectDisposition:
      INBOX_V2_OUTBOUND_PROVIDER_OBSERVATION_EFFECT_DISPOSITION,
    observedByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
    recordedAt: fixtureT3,
    revision: "1" as const
  };
}

function resolution(
  providerObservation: ReturnType<typeof observation>,
  suffix = "1"
) {
  return {
    tenantId: fixtureTenantId,
    id: `outbound_dispatch_artifact_resolution:resolution-${suffix}`,
    observation: providerObservation,
    artifactOrdinal: providerObservation.artifact.ordinal,
    fromState: providerObservation.artifact.state,
    effectiveState: "accepted" as const,
    effectiveArtifact: {
      ...providerObservation.artifact,
      state: "accepted" as const,
      diagnostic: null
    },
    resolvedByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
    resolvedAt: fixtureT3,
    revision: "1" as const
  };
}

function contentPlan(artifactCount = 1) {
  const route = fixtureRoute();
  const input = {
    tenantId: fixtureTenantId,
    id: `outbound_dispatch_content_plan:plan-${artifactCount}`,
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
    blocks: Array.from({ length: artifactCount }, (_, index) => ({
      blockKey: `text-${index + 1}`,
      blockKind: "text" as const,
      exactFileObjectPin: null,
      artifactOrdinal: index + 1
    })),
    artifacts: Array.from({ length: artifactCount }, (_, index) => ({
      ordinal: index + 1,
      grouping: artifactCount === 1 ? ("single" as const) : ("split" as const),
      capabilityId: "core:message-text-send",
      operationId: route.operationId,
      blockKeys: [`text-${index + 1}`]
    })),
    createdAt: fixtureT2,
    revision: "1" as const
  };
  return {
    ...input,
    planDigestSha256: calculateInboxV2OutboundDispatchContentPlanDigest(input)
  };
}

function occurrenceResolution(
  before: ReturnType<typeof pendingOccurrence>,
  suffix = "1"
) {
  const externalMessageReference = {
    tenantId: fixtureTenantId,
    id: `external_message_reference:provider-${suffix}`,
    key: before.messageKey,
    identityDeclaration: before.messageIdentityDeclaration,
    externalThread: before.bindingContext.externalThread,
    timelineItem: fixtureReference("timeline_item", "timeline_item:item-1"),
    message: fixtureReference("message", "message:message-1"),
    revision: "1",
    createdAt: fixtureT3
  };
  const reference = fixtureReference(
    "external_message_reference",
    externalMessageReference.id
  );
  const after = {
    ...before,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: reference
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  return {
    tenantId: fixtureTenantId,
    expectedRevision: "1",
    resultingRevision: "2",
    changedAt: fixtureT3,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
      resolutionToken: `resolution:provider-${suffix}`
    },
    before,
    after,
    resolvedReference: externalMessageReference
  };
}

function occurrenceBinding(
  occurrence: ReturnType<typeof occurrenceResolution>["after"]
) {
  const snapshot = fixtureOutboundBindingSnapshot();
  return {
    ...snapshot,
    id: occurrence.bindingContext.sourceThreadBinding.id,
    externalThread: occurrence.bindingContext.externalThread,
    sourceAccount: occurrence.bindingContext.sourceAccount,
    accountIdentitySnapshot: {
      ...snapshot.accountIdentitySnapshot,
      sourceAccount: occurrence.bindingContext.sourceAccount
    },
    bindingGeneration: occurrence.bindingContext.bindingGeneration,
    capabilities: {
      ...snapshot.capabilities,
      adapterContract: occurrence.descriptor.adapterContract,
      revision: occurrence.descriptor.capabilityRevision
    }
  };
}

function messageTransportAssociation(
  resolved: ReturnType<typeof occurrenceResolution>,
  suffix = "1",
  mapping = fixtureExternalThreadMapping()
) {
  const role =
    resolved.before.origin.kind === "provider_response"
      ? ("provider_response" as const)
      : ("provider_echo" as const);
  const linkId = `message_transport_occurrence_link:${role}-${suffix}`;
  return {
    tenantId: fixtureTenantId,
    message: fixtureMessage("hulee"),
    timelineItem: fixtureTimelineItem("external"),
    linkHeadBefore: null,
    sourceOccurrence: resolved.after,
    externalMessageReference: resolved.resolvedReference,
    externalThreadMapping: mapping,
    occurrenceBinding: occurrenceBinding(resolved.after),
    messageOriginProof: {
      kind: "hulee_outbound" as const,
      outboundRoute: fixtureRoute()
    },
    link: {
      tenantId: fixtureTenantId,
      id: linkId,
      message: fixtureReference("message", "message:message-1"),
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        resolved.after.id
      ),
      externalMessageReference: fixtureReference(
        "external_message_reference",
        resolved.resolvedReference.id
      ),
      role,
      revision: "1" as const,
      linkedAt: fixtureT3
    },
    linkHeadAfter: {
      tenantId: fixtureTenantId,
      message: fixtureReference("message", "message:message-1"),
      linkCount: "1",
      latestLink: fixtureReference("message_transport_occurrence_link", linkId),
      revision: "1",
      updatedAt: fixtureT3
    },
    committedAt: fixtureT3
  };
}

function acceptedAttemptFromObservation(before = pendingAttempt()) {
  return {
    ...before,
    outcome: {
      kind: "accepted" as const,
      completedAt: fixtureT3,
      providerAcknowledgementToken: null
    },
    completionSource: "provider_observation" as const,
    revision: "2"
  };
}

function acceptedDispatchFromObservation(
  before = attemptingDispatch(),
  attemptAfter = acceptedAttemptFromObservation()
) {
  return {
    ...before,
    state: "accepted" as const,
    activeAttempt: null,
    lastAttempt: fixtureReference("outbound_dispatch_attempt", attemptAfter.id),
    revision: String(BigInt(before.revision) + 1n),
    updatedAt: fixtureT3
  };
}

function completePendingTransition(
  beforeAttempt = pendingAttempt(),
  beforeDispatch = attemptingDispatch(beforeAttempt)
) {
  const afterAttempt = acceptedAttemptFromObservation(beforeAttempt);
  const afterDispatch = acceptedDispatchFromObservation(
    beforeDispatch,
    afterAttempt
  );
  return {
    kind: "complete_pending_attempt" as const,
    attemptCommit: {
      kind: "complete_attempt" as const,
      tenantId: fixtureTenantId,
      dispatchBefore: beforeDispatch,
      attemptBefore: beforeAttempt,
      attemptAfter: afterAttempt,
      completionSource: "provider_observation" as const,
      completedByTrustedServiceId:
        fixtureAdapterContract.loadedByTrustedServiceId,
      dispatchAfter: afterDispatch
    }
  };
}

function artifactAssociation(
  artifactResolution: ReturnType<typeof resolution>,
  resolved: ReturnType<typeof occurrenceResolution>,
  finalDispatch:
    | ReturnType<typeof attemptingDispatch>
    | ReturnType<typeof acceptedDispatchFromObservation>
    | ReturnType<typeof acceptedDispatch>,
  finalAttempt:
    | ReturnType<typeof pendingAttempt>
    | ReturnType<typeof acceptedAttemptFromObservation>
    | ReturnType<typeof acceptedAttempt>,
  suffix = "1"
) {
  const effectiveArtifact = artifactResolution.effectiveArtifact;
  return {
    artifact: effectiveArtifact,
    dispatch: finalDispatch,
    attempt: finalAttempt,
    route: fixtureRoute(),
    occurrenceResolution: resolved,
    link: {
      tenantId: fixtureTenantId,
      id: `outbound_dispatch_artifact_reference_link:link-${suffix}`,
      artifact: fixtureReference(
        "outbound_dispatch_artifact",
        effectiveArtifact.id
      ),
      dispatch: fixtureReference("outbound_dispatch", finalDispatch.id),
      route: fixtureReference("outbound_route", fixtureRoute().id),
      attempt: fixtureReference("outbound_dispatch_attempt", finalAttempt.id),
      externalThread: fixtureRoute().externalThread,
      externalMessageReference: fixtureReference(
        "external_message_reference",
        resolved.resolvedReference.id
      ),
      sourceOccurrence: fixtureReference(
        "source_occurrence",
        resolved.after.id
      ),
      associationEvidence:
        resolved.before.origin.kind === "provider_response"
          ? { kind: "provider_response_attempt" as const }
          : {
              kind: "provider_echo_correlation" as const,
              providerReferenceKindId: correlationKindId,
              correlationToken
            },
      linkedByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
      linkedAt: fixtureT3,
      revision: "1"
    }
  };
}

function echoSettlement(input: {
  providerObservation: ReturnType<typeof observation>;
  artifactResolution: ReturnType<typeof resolution>;
  coverage: ReturnType<typeof resolution>[];
  transition:
    | {
        kind: "retain_dispatch_state";
        dispatch: ReturnType<typeof attemptingDispatch>;
        attempt: ReturnType<typeof pendingAttempt>;
      }
    | ReturnType<typeof completePendingTransition>
    | {
        kind: "already_accepted";
        dispatch: ReturnType<typeof acceptedDispatch>;
        attempt: ReturnType<typeof acceptedAttempt>;
      };
  finalDispatch:
    | ReturnType<typeof attemptingDispatch>
    | ReturnType<typeof acceptedDispatchFromObservation>
    | ReturnType<typeof acceptedDispatch>;
  finalAttempt:
    | ReturnType<typeof pendingAttempt>
    | ReturnType<typeof acceptedAttemptFromObservation>
    | ReturnType<typeof acceptedAttempt>;
  artifactCount: number;
  suffix?: string;
}) {
  const suffix =
    input.suffix ?? String(input.providerObservation.artifact.ordinal);
  const resolved = occurrenceResolution(
    input.providerObservation.sourceOccurrence,
    suffix
  );
  return {
    tenantId: fixtureTenantId,
    observation: input.providerObservation,
    artifactResolution: {
      kind: "create" as const,
      resolution: input.artifactResolution
    },
    artifactCoverage: {
      contentPlan: contentPlan(input.artifactCount),
      resolutions: input.coverage
    },
    occurrenceMaterialization: {
      kind: "provider_echo" as const,
      persistedSourceOccurrence: input.providerObservation.sourceOccurrence,
      verifiedByTrustedServiceId:
        fixtureAdapterContract.loadedByTrustedServiceId,
      verifiedAt: fixtureT3
    },
    occurrenceResolution: resolved,
    externalMessageReference: resolved.resolvedReference,
    artifactAssociation: {
      kind: "create" as const,
      commit: artifactAssociation(
        input.artifactResolution,
        resolved,
        input.finalDispatch,
        input.finalAttempt,
        suffix
      )
    },
    messageTransportAssociation: messageTransportAssociation(resolved, suffix),
    transition: input.transition,
    settledByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
    settledAt: fixtureT3
  };
}

function providerResponseMaterialization(
  providerObservation: ReturnType<typeof observation>
) {
  const route = fixtureRoute();
  const binding = fixtureOutboundBindingSnapshot(route);
  const snapshot = binding.accountIdentitySnapshot;
  return {
    tenantId: fixtureTenantId,
    occurrence: providerObservation.sourceOccurrence,
    bindingMaterialization: {
      kind: "existing" as const,
      currentProjection: {
        binding,
        currentRemoteAccessEpisode: {
          tenantId: fixtureTenantId,
          id: "source_thread_binding_remote_access_episode:episode-1",
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
      },
      creationAuthority: null
    },
    externalThreadMapping: fixtureExternalThreadMapping(),
    sourceAccountIdentity: {
      tenantId: fixtureTenantId,
      sourceAccount: binding.sourceAccount,
      sourceConnection: binding.sourceConnection,
      identityDeclaration: snapshot.declaration,
      accountGeneration: snapshot.accountGeneration,
      revision: "1",
      createdAt: fixtureT0,
      updatedAt: fixtureT0,
      state: "verified" as const,
      expectedCanonicalScope: null,
      provisionalIdentity: null,
      canonicalIdentity: {
        realm: {
          realmId: snapshot.declaration.realmId,
          realmVersion: snapshot.declaration.realmVersion,
          canonicalizationVersion: snapshot.declaration.canonicalizationVersion,
          objectKindId: snapshot.declaration.objectKindId
        },
        scope: {
          kind: "source_connection" as const,
          owner: binding.sourceConnection
        },
        canonicalExternalSubject: snapshot.canonicalExternalSubject
      },
      verifiedBy: {
        actor: {
          kind: "trusted_service" as const,
          trustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId
        },
        policyId: "core:provider-account-verification",
        policyVersion: "v1",
        reasonCodeId: "core:account-verified",
        verificationEvidenceToken: "evidence:account-verified-1",
        decidedAt: fixtureT0
      },
      conflict: null
    },
    outboundDispatchAttempt: providerObservation.attempt,
    outboundDispatch: providerObservation.dispatch,
    outboundRoute: route,
    authority: {
      kind: "trusted_service" as const,
      trustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
      authorizationToken: "authorization:provider-response-1",
      authorizedAt: fixtureT3
    },
    materializedAt: fixtureT3
  };
}

function responseSettlement(
  providerObservation: ReturnType<typeof observation>,
  artifactResolution: ReturnType<typeof resolution>
) {
  const resolved = occurrenceResolution(
    providerObservation.sourceOccurrence,
    "response-1"
  );
  return {
    tenantId: fixtureTenantId,
    observation: providerObservation,
    artifactResolution: {
      kind: "create" as const,
      resolution: artifactResolution
    },
    artifactCoverage: {
      contentPlan: contentPlan(1),
      resolutions: [artifactResolution]
    },
    occurrenceMaterialization: {
      kind: "provider_response" as const,
      commit: providerResponseMaterialization(providerObservation)
    },
    occurrenceResolution: resolved,
    externalMessageReference: resolved.resolvedReference,
    artifactAssociation: {
      kind: "create" as const,
      commit: artifactAssociation(
        artifactResolution,
        resolved,
        providerObservation.dispatch as ReturnType<typeof acceptedDispatch>,
        providerObservation.attempt as ReturnType<typeof acceptedAttempt>,
        "response-1"
      )
    },
    messageTransportAssociation: messageTransportAssociation(
      resolved,
      "response-1"
    ),
    transition: {
      kind: "already_accepted" as const,
      dispatch: providerObservation.dispatch,
      attempt: providerObservation.attempt
    },
    settledByTrustedServiceId: fixtureAdapterContract.loadedByTrustedServiceId,
    settledAt: fixtureT3
  };
}

describe("Inbox V2 outbound provider observation contracts", () => {
  it("accepts provider response and provider echo as provider-neutral immutable facts", () => {
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(
        observation({ evidenceKind: "provider_response_attempt" })
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(
        observation({ evidenceKind: "provider_echo_correlation" })
      ).success
    ).toBe(true);
  });

  it("exposes a strict adapter DTO without canonical IDs or raw payload", () => {
    const occurrence = pendingOccurrence("provider_response");
    const descriptor = {
      artifactOrdinal: 1,
      canonicalExternalSubject: occurrence.messageKey.canonicalExternalSubject,
      messageIdentityDeclaration: occurrence.messageIdentityDeclaration,
      occurrenceDescriptor: occurrence.descriptor,
      providerTimestamps: occurrence.providerTimestamps,
      referencePortability: occurrence.referencePortability,
      observedAt: occurrence.observedAt
    };
    expect(
      inboxV2OutboundProviderResponseObservationDescriptorSchema.safeParse(
        descriptor
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundProviderResponseObservationDescriptorSchema.safeParse({
        ...descriptor,
        sourceOccurrenceId: "source_occurrence:adapter-selected",
        externalMessageReferenceId:
          "external_message_reference:adapter-selected",
        rawProviderPayload: { message_id: 42 }
      }).success
    ).toBe(false);
  });

  it("derives replay-stable observation IDs and canonical bounded-detail digests", () => {
    const first = observation({ evidenceKind: "provider_echo_correlation" });
    const replay = observation({ evidenceKind: "provider_echo_correlation" });
    expect(replay.id).toBe(first.id);
    expect(replay.sourceOccurrenceDetailDigestSha256).toBe(
      first.sourceOccurrenceDetailDigestSha256
    );
    const secondOrdinal = observation({
      evidenceKind: "provider_echo_correlation",
      artifactOrdinal: 2
    });
    expect(secondOrdinal.id).not.toBe(first.id);
  });

  it("rejects missing or tampered exact echo markers", () => {
    const valid = observation({ evidenceKind: "provider_echo_correlation" });
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse({
        ...valid,
        evidence: { ...valid.evidence, correlationToken: "provider:other" }
      }).success
    ).toBe(false);

    const withoutReference = {
      ...valid,
      sourceOccurrence: {
        ...valid.sourceOccurrence,
        descriptor: {
          ...valid.sourceOccurrence.descriptor,
          providerReferences:
            valid.sourceOccurrence.descriptor.providerReferences.filter(
              (reference) => reference.kindId !== correlationKindId
            )
        }
      }
    };
    withoutReference.sourceOccurrenceDetailDigestSha256 =
      calculateInboxV2OutboundProviderSourceOccurrenceDetailDigest(
        withoutReference.sourceOccurrence
      );
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(withoutReference)
        .success
    ).toBe(false);
  });

  it("allows only authoritative provider-thread echo correlation across accounts", () => {
    const crossAccountEcho = observation({
      evidenceKind: "provider_echo_correlation",
      occurrence: pendingOccurrence("provider_echo", {
        sourceAccountId: "source_account:account-2",
        bindingId: "source_thread_binding:binding-2"
      })
    });
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(crossAccountEcho)
        .success
    ).toBe(true);

    const crossAccountResponse = observation({
      evidenceKind: "provider_response_attempt",
      occurrence: pendingOccurrence("provider_response", {
        sourceAccountId: "source_account:account-2",
        bindingId: "source_thread_binding:binding-2"
      })
    });
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(crossAccountResponse)
        .success
    ).toBe(false);

    const weakEcho = {
      ...crossAccountEcho,
      sourceOccurrence: {
        ...crossAccountEcho.sourceOccurrence,
        messageIdentityDeclaration: {
          ...crossAccountEcho.sourceOccurrence.messageIdentityDeclaration,
          decisionStrength: "safe_default" as const
        }
      }
    };
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse(weakEcho).success
    ).toBe(false);
  });

  it("keeps provider truth outbound, actor-free and free of inbound side effects", () => {
    const valid = observation({ evidenceKind: "provider_response_attempt" });
    expect(valid.effectDisposition).toEqual({
      countsAsCustomerInbound: false,
      createsUnread: false,
      createsWorkItem: false,
      requiresProviderIo: false,
      createsOutboundDispatch: false,
      notificationEligible: false
    });
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse({
        ...valid,
        sourceOccurrence: {
          ...valid.sourceOccurrence,
          direction: "inbound"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse({
        ...valid,
        effectDisposition: {
          ...valid.effectDisposition,
          createsUnread: true
        }
      }).success
    ).toBe(false);
  });

  it("resolves outcome_unknown append-only without mutating the original artifact", () => {
    const attempt = unknownAttempt();
    const providerObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch: unknownDispatch(attempt),
      artifactState: "outcome_unknown"
    });
    const artifactResolution = resolution(providerObservation);
    const parsedResolution =
      inboxV2OutboundDispatchArtifactResolutionSchema.safeParse(
        artifactResolution
      );
    expect(
      parsedResolution.success ? [] : parsedResolution.error.issues
    ).toEqual([]);
    expect(providerObservation.artifact.state).toBe("outcome_unknown");
    expect(artifactResolution.effectiveArtifact.state).toBe("accepted");
    expect(
      inboxV2OutboundDispatchArtifactResolutionSchema.safeParse({
        ...artifactResolution,
        effectiveArtifact: {
          ...artifactResolution.effectiveArtifact,
          ordinal: 2
        }
      }).success
    ).toBe(false);
  });

  it("rejects post-observation detail tampering even when identity fields stay stable", () => {
    const valid = observation({ evidenceKind: "provider_response_attempt" });
    expect(
      inboxV2OutboundProviderObservationSchema.safeParse({
        ...valid,
        sourceOccurrence: {
          ...valid.sourceOccurrence,
          providerTimestamps: [
            {
              kindId: "module:synthetic:sent-at",
              timestamp: fixtureT4
            }
          ]
        }
      }).success
    ).toBe(false);
  });

  it("retains a pending split dispatch until every planned artifact is resolved", () => {
    const attempt = pendingAttempt();
    const dispatch = attemptingDispatch(attempt);
    const firstObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch,
      occurrence: pendingOccurrence("provider_echo", { suffix: "split-1" }),
      artifactOrdinal: 1
    });
    const firstResolution = resolution(firstObservation, "split-1");
    const settlement = echoSettlement({
      providerObservation: firstObservation,
      artifactResolution: firstResolution,
      coverage: [firstResolution],
      transition: { kind: "retain_dispatch_state", dispatch, attempt },
      finalDispatch: dispatch,
      finalAttempt: attempt,
      artifactCount: 2,
      suffix: "split-1"
    });
    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(settlement);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);

    const premature = {
      ...settlement,
      transition: completePendingTransition(attempt, dispatch)
    };
    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(premature).success
    ).toBe(false);
  });

  it("settles one described artifact after an all-accepted multipart response without reopening the dispatch", () => {
    const providerObservation = observation({
      evidenceKind: "provider_response_attempt",
      artifactOrdinal: 1
    });
    const artifactResolution = resolution(
      providerObservation,
      "response-partial-1"
    );
    const settlement = responseSettlement(
      providerObservation,
      artifactResolution
    );
    const partial = {
      ...settlement,
      artifactCoverage: {
        contentPlan: contentPlan(2),
        resolutions: [artifactResolution]
      },
      transition: {
        kind: "retain_dispatch_state" as const,
        dispatch: providerObservation.dispatch,
        attempt: providerObservation.attempt
      }
    };

    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(partial);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    if (parsed.success) {
      expect(parsed.data.transition).toEqual({
        kind: "retain_dispatch_state",
        dispatch: providerObservation.dispatch,
        attempt: providerObservation.attempt
      });
      expect(parsed.data.messageTransportAssociation.link.role).toBe(
        "provider_response"
      );
    }

    const secondObservation = observation({
      evidenceKind: "provider_response_attempt",
      artifactOrdinal: 2
    });
    const secondResolution = resolution(
      secondObservation,
      "response-partial-2"
    );
    const converged = responseSettlement(secondObservation, secondResolution);
    const fullCoverage = {
      ...converged,
      artifactCoverage: {
        contentPlan: contentPlan(2),
        resolutions: [artifactResolution, secondResolution]
      }
    };
    const fullParsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(fullCoverage);
    expect(fullParsed.success ? [] : fullParsed.error.issues).toEqual([]);
  });

  it("settles a pending echo observation after provider response already accepted the multipart head", () => {
    const observedAttempt = pendingAttempt();
    const observedDispatch = attemptingDispatch(observedAttempt);
    const firstObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt: observedAttempt,
      dispatch: observedDispatch,
      occurrence: pendingOccurrence("provider_echo", {
        suffix: "echo-before-response"
      }),
      artifactOrdinal: 1
    });
    const firstResolution = resolution(
      firstObservation,
      "echo-before-response"
    );
    const accepted = acceptedAttempt();
    const acceptedHead = acceptedDispatch(accepted);
    const settlement = echoSettlement({
      providerObservation: firstObservation,
      artifactResolution: firstResolution,
      coverage: [firstResolution],
      transition: {
        kind: "already_accepted",
        dispatch: acceptedHead,
        attempt: accepted
      },
      finalDispatch: acceptedHead,
      finalAttempt: accepted,
      artifactCount: 2,
      suffix: "echo-before-response"
    });

    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(settlement);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    if (parsed.success && parsed.data.transition.kind === "already_accepted") {
      expect(parsed.data.transition.dispatch).toEqual(acceptedHead);
      expect(parsed.data.transition.attempt).toEqual(accepted);
      expect(parsed.data.messageTransportAssociation.link.role).toBe(
        "provider_echo"
      );
    }
  });

  it("makes provider-response occurrence materialization part of the same settlement proof", () => {
    const providerObservation = observation({
      evidenceKind: "provider_response_attempt"
    });
    const artifactResolution = resolution(providerObservation, "response-1");
    const settlement = responseSettlement(
      providerObservation,
      artifactResolution
    );
    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(settlement);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);

    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse({
        ...settlement,
        occurrenceMaterialization: {
          ...settlement.occurrenceMaterialization,
          commit: {
            ...settlement.occurrenceMaterialization.commit,
            outboundDispatchAttempt: null
          }
        }
      }).success
    ).toBe(false);
  });

  it("uses only the validated already-accepted descendant as a late provider-response occurrence proof", () => {
    const observedAttempt = pendingAttempt();
    const observedDispatch = attemptingDispatch(observedAttempt);
    const providerObservation = observation({
      evidenceKind: "provider_response_attempt",
      attempt: observedAttempt,
      dispatch: observedDispatch,
      occurrence: pendingOccurrence("provider_response", {
        suffix: "response-before-accepted-descendant"
      })
    });
    const artifactResolution = resolution(
      providerObservation,
      "response-before-accepted-descendant"
    );
    const accepted = acceptedAttempt();
    const acceptedHead = acceptedDispatch(accepted);
    const base = responseSettlement(providerObservation, artifactResolution);
    const settlement = {
      ...base,
      occurrenceMaterialization: {
        ...base.occurrenceMaterialization,
        commit: {
          ...base.occurrenceMaterialization.commit,
          outboundDispatchAttempt: accepted,
          outboundDispatch: acceptedHead
        }
      },
      artifactAssociation: {
        kind: "create" as const,
        commit: artifactAssociation(
          artifactResolution,
          base.occurrenceResolution,
          acceptedHead,
          accepted,
          "response-before-accepted-descendant"
        )
      },
      transition: {
        kind: "already_accepted" as const,
        dispatch: acceptedHead,
        attempt: accepted
      }
    };

    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(settlement);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse({
        ...settlement,
        occurrenceMaterialization: {
          ...settlement.occurrenceMaterialization,
          commit: {
            ...settlement.occurrenceMaterialization.commit,
            outboundDispatchAttempt: observedAttempt,
            outboundDispatch: observedDispatch
          }
        }
      }).success
    ).toBe(false);
  });

  it("accepts response/echo arrival in either order while reusing one canonical resolution and reference link", () => {
    const attempt = acceptedAttempt();
    const dispatch = acceptedDispatch(attempt);
    const responseObservation = observation({
      evidenceKind: "provider_response_attempt",
      attempt,
      dispatch
    });
    const responseResolution = resolution(responseObservation, "response-1");
    const response = responseSettlement(
      responseObservation,
      responseResolution
    );

    const echoObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch,
      occurrence: pendingOccurrence("provider_echo")
    });
    const echoResolution = resolution(echoObservation, "echo-1");
    const echo = echoSettlement({
      providerObservation: echoObservation,
      artifactResolution: echoResolution,
      coverage: [echoResolution],
      transition: { kind: "already_accepted", dispatch, attempt },
      finalDispatch: dispatch,
      finalAttempt: attempt,
      artifactCount: 1,
      suffix: "response-1"
    });

    const responseThenEcho = {
      ...echo,
      artifactResolution: {
        kind: "reuse_existing" as const,
        existingResolution: responseResolution
      },
      artifactCoverage: {
        ...echo.artifactCoverage,
        resolutions: [responseResolution]
      },
      artifactAssociation: {
        kind: "reuse_existing" as const,
        existingLink: response.artifactAssociation.commit.link
      }
    };
    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(responseThenEcho)
        .success
    ).toBe(true);

    const echoThenResponse = {
      ...response,
      artifactResolution: {
        kind: "reuse_existing" as const,
        existingResolution: echoResolution
      },
      artifactCoverage: {
        ...response.artifactCoverage,
        resolutions: [echoResolution]
      },
      artifactAssociation: {
        kind: "reuse_existing" as const,
        existingLink: echo.artifactAssociation.commit.link
      }
    };
    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(echoThenResponse)
        .success
    ).toBe(true);

    const otherObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch,
      occurrence: pendingOccurrence("provider_echo", { suffix: "other" }),
      artifactOrdinal: 2
    });
    const otherResolution = resolution(otherObservation, "other");
    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse({
        ...responseThenEcho,
        artifactResolution: {
          kind: "reuse_existing",
          existingResolution: otherResolution
        },
        artifactCoverage: {
          ...responseThenEcho.artifactCoverage,
          resolutions: [otherResolution]
        }
      }).success
    ).toBe(false);
  });

  it("completes a pending split attempt only with exact full ordinal coverage", () => {
    const attempt = pendingAttempt();
    const dispatch = attemptingDispatch(attempt);
    const firstObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch,
      occurrence: pendingOccurrence("provider_echo", { suffix: "split-1" }),
      artifactOrdinal: 1
    });
    const secondObservation = observation({
      evidenceKind: "provider_echo_correlation",
      attempt,
      dispatch,
      occurrence: pendingOccurrence("provider_echo", { suffix: "split-2" }),
      artifactOrdinal: 2
    });
    const firstResolution = resolution(firstObservation, "split-1");
    const secondResolution = resolution(secondObservation, "split-2");
    const transition = completePendingTransition(attempt, dispatch);
    const settlement = echoSettlement({
      providerObservation: secondObservation,
      artifactResolution: secondResolution,
      coverage: [firstResolution, secondResolution],
      transition,
      finalDispatch: transition.attemptCommit.dispatchAfter,
      finalAttempt: transition.attemptCommit.attemptAfter,
      artifactCount: 2,
      suffix: "split-2"
    });
    const parsed =
      inboxV2OutboundProviderSettlementCommitSchema.safeParse(settlement);
    expect(parsed.success ? [] : parsed.error.issues).toEqual([]);

    expect(
      inboxV2OutboundProviderSettlementCommitSchema.safeParse({
        ...settlement,
        artifactCoverage: {
          ...settlement.artifactCoverage,
          resolutions: [secondResolution, secondResolution]
        }
      }).success
    ).toBe(false);
  });
});
