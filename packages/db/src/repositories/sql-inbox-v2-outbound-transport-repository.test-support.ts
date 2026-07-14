import {
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchReconciliationDecisionSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundMultiSendOperationSchema,
  inboxV2OutboundRouteResolutionCommitSchema,
  inboxV2OutboundRouteResolutionInputSchema,
  inboxV2OutboundRouteSchema,
  inboxV2SourceOccurrenceResolutionCommitSchema,
  inboxV2ThreadRoutePolicySchema,
  resolveInboxV2OutboundRoute
} from "@hulee/contracts";

export const OUTBOUND_TEST_TIMES = {
  loadedAt: "2026-07-14T08:00:00.000Z",
  selectedAt: "2026-07-14T08:01:00.000Z",
  openedAt: "2026-07-14T08:02:00.000Z",
  artifactAt: "2026-07-14T08:03:00.000Z",
  acceptedAt: "2026-07-14T08:04:00.000Z",
  leaseExpiresAt: "2026-07-14T08:05:00.000Z",
  completedAt: "2026-07-14T08:06:00.000Z",
  reconciledAt: "2026-07-14T08:07:00.000Z",
  linkedAt: "2026-07-14T08:08:00.000Z",
  retryAt: "2026-07-14T08:09:00.000Z",
  notAfter: "2026-07-14T10:00:00.000Z"
} as const;

type FixtureOptions = Readonly<{
  tenantId?: string;
  suffix?: string;
}>;

export function createOutboundTransportContractFixture(
  options: FixtureOptions = {}
) {
  const tenantId = options.tenantId ?? "tenant:outbound-unit";
  const suffix = options.suffix ?? "unit";
  const reference = <const TKind extends string>(kind: TKind, id: string) => ({
    tenantId,
    kind,
    id
  });
  const conversation = reference(
    "conversation",
    `conversation:outbound-${suffix}`
  );
  const externalThread = reference(
    "external_thread",
    `external_thread:outbound-${suffix}`
  );
  const binding = reference(
    "source_thread_binding",
    `source_thread_binding:outbound-${suffix}`
  );
  const fallbackBinding = reference(
    "source_thread_binding",
    `source_thread_binding:outbound-fallback-${suffix}`
  );
  const sourceAccount = reference(
    "source_account",
    `source_account:outbound-${suffix}`
  );
  const sourceConnection = reference(
    "source_connection",
    `source_connection:outbound-${suffix}`
  );
  const employee = reference("employee", `employee:outbound-${suffix}`);
  const routeReference = reference(
    "outbound_route",
    `outbound_route:outbound-${suffix}`
  );
  const dispatchReference = reference(
    "outbound_dispatch",
    `outbound_dispatch:outbound-${suffix}`
  );
  const message = reference("message", `message:outbound-${suffix}`);
  const timelineItem = reference(
    "timeline_item",
    `timeline_item:outbound-${suffix}`
  );
  const attemptReference = reference(
    "outbound_dispatch_attempt",
    `outbound_dispatch_attempt:outbound-${suffix}`
  );
  const principal = { kind: "employee" as const, employee };
  const adapterContract = {
    contractId: "module:synthetic:direct-account-adapter",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "module:synthetic:direct-account",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: OUTBOUND_TEST_TIMES.loadedAt
  } as const;
  const bindingFence = {
    accountGeneration: "1",
    bindingGeneration: "1",
    remoteAccessRevision: "1",
    administrativeRevision: "1",
    capabilityRevision: "1",
    routeDescriptorRevision: "1"
  } as const;
  const operationId = "core:reply";
  const contentKindId = "core:text";
  const requiredPermissionId = "core:message.reply_external";
  const authorizationEpoch = `authorization:outbound-${suffix}`;
  const routePolicyReference = reference(
    "thread_route_policy",
    `thread_route_policy:outbound-${suffix}`
  );

  const routePolicy = inboxV2ThreadRoutePolicySchema.parse({
    tenantId,
    id: routePolicyReference.id,
    conversation,
    externalThread,
    operationId,
    contentKindId,
    policyId: "core:ordered-explicit-policy",
    requiredConversationPermissionId: requiredPermissionId,
    preferredBinding: null,
    fallback: { kind: "none" },
    revision: "1",
    createdAt: OUTBOUND_TEST_TIMES.loadedAt,
    updatedAt: OUTBOUND_TEST_TIMES.loadedAt
  });
  const routePolicyWithFallback = inboxV2ThreadRoutePolicySchema.parse({
    ...routePolicy,
    id: `thread_route_policy:outbound-fallback-${suffix}`,
    preferredBinding: binding,
    fallback: {
      kind: "ordered_allowlist",
      allowedBindings: [fallbackBinding]
    }
  });

  const authorizationTarget = {
    conversation,
    externalThread,
    sourceThreadBinding: binding,
    sourceAccount,
    sourceConnection,
    operationId,
    contentKindId,
    authorizationEpoch,
    bindingFence,
    referenceTarget: { kind: "none" as const }
  };
  const decisionBase = {
    tenantId,
    principal,
    target: authorizationTarget,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: OUTBOUND_TEST_TIMES.loadedAt,
    notAfter: OUTBOUND_TEST_TIMES.notAfter
  };
  const routeDescriptor = {
    adapterContract,
    descriptorSchemaId: "module:synthetic:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic:group-peer",
    destinationSubject: `Group-${suffix}`,
    attributes: [],
    descriptorDigestSha256: "a".repeat(64)
  } as const;
  const candidate = {
    tenantId,
    conversation,
    externalThread,
    sourceThreadBinding: binding,
    sourceAccount,
    sourceConnection,
    operationId,
    contentKindId,
    authorizationEpoch,
    bindingFence,
    adapterContract,
    routeDescriptor,
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action" as const,
      requiredPermissionId,
      matchedPermissionIds: [requiredPermissionId],
      decisionToken: `decision:outbound-conversation-${suffix}`
    },
    sourceAccountAuthorization: {
      ...decisionBase,
      decisionKind: "source_account_use" as const,
      requiredPermissionId: "core:source_account.use" as const,
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: `decision:outbound-source-account-${suffix}`
    },
    eligibility: { state: "eligible" as const },
    runtimeObservation: {
      state: "ready" as const,
      revision: "1",
      observedAt: OUTBOUND_TEST_TIMES.loadedAt,
      diagnostic: null
    }
  };
  const routeInput = inboxV2OutboundRouteResolutionInputSchema.parse({
    tenantId,
    principal,
    conversation,
    externalThread,
    operationId,
    contentKindId,
    authorizationEpoch,
    intent: { kind: "automatic" },
    referenceContext: { kind: "none" },
    routePolicy,
    candidates: {
      tenantId,
      conversation,
      externalThread,
      operationId,
      contentKindId,
      authorizationEpoch,
      routePolicy: routePolicyReference,
      routePolicyRevision: routePolicy.revision,
      automaticCompatibleEligibleCount: 1,
      explicitTarget: null,
      preferredCandidate: null,
      soleEligibleCandidate: candidate,
      fallbackCandidate: null,
      zeroCandidateError: null,
      snapshotToken: `snapshot:outbound-${suffix}`,
      loadedByTrustedServiceId: "core:route-resolver",
      loadedAt: OUTBOUND_TEST_TIMES.loadedAt,
      notAfter: OUTBOUND_TEST_TIMES.notAfter
    },
    mutationToken: `mutation:outbound-route-${suffix}`,
    idempotencyToken: `idempotency:outbound-route-${suffix}`,
    correlationToken: `correlation:outbound-route-${suffix}`,
    requestedAt: OUTBOUND_TEST_TIMES.selectedAt
  });
  const routeResult = resolveInboxV2OutboundRoute(routeInput);
  if (routeResult.kind !== "selected") {
    throw new Error("Expected the outbound test route to be selected.");
  }
  const route = inboxV2OutboundRouteSchema.parse({
    tenantId,
    id: routeReference.id,
    principal,
    conversation,
    externalThread,
    sourceThreadBinding: binding,
    sourceAccount,
    sourceConnection,
    operationId,
    contentKindId,
    authorizationEpoch,
    requiredConversationPermissionId: requiredPermissionId,
    bindingFence,
    adapterContract,
    routeDescriptor,
    routePolicy: routePolicyReference,
    routePolicyRevision: routePolicy.revision,
    conversationAuthorization: candidate.conversationAuthorization,
    sourceAccountAuthorization: candidate.sourceAccountAuthorization,
    referenceContext: routeInput.referenceContext,
    runtimeObservationAtResolution: candidate.runtimeObservation,
    selection: {
      intent: routeInput.intent,
      reason: routeResult.selectionReason,
      candidateSnapshotToken: routeInput.candidates.snapshotToken,
      candidateSnapshotNotAfter: routeInput.candidates.notAfter,
      fallbackPolicyOrdinal: routeResult.fallbackPolicyOrdinal,
      selectedAt: OUTBOUND_TEST_TIMES.selectedAt
    },
    mutationToken: routeInput.mutationToken,
    idempotencyToken: routeInput.idempotencyToken,
    correlationToken: routeInput.correlationToken,
    revision: "1",
    createdAt: OUTBOUND_TEST_TIMES.selectedAt
  });
  const routeCommit = inboxV2OutboundRouteResolutionCommitSchema.parse({
    input: routeInput,
    result: routeResult,
    route
  });

  const queuedDispatch = inboxV2OutboundDispatchSchema.parse({
    tenantId,
    id: dispatchReference.id,
    message,
    route: routeReference,
    multiSendOperation: null,
    state: "queued",
    attemptCount: 0,
    activeAttempt: null,
    lastAttempt: null,
    retryAuthorization: null,
    revision: "1",
    createdAt: OUTBOUND_TEST_TIMES.selectedAt,
    updatedAt: OUTBOUND_TEST_TIMES.selectedAt
  });
  const retrySafety = {
    adapterContract,
    declaredByTrustedServiceId: "core:source-runtime",
    declarationToken: `declaration:outbound-${suffix}`,
    declaredAt: OUTBOUND_TEST_TIMES.selectedAt,
    mechanism: "provider_idempotency_key" as const,
    providerCorrelationToken: `provider:idempotency-${suffix}`,
    automaticRetryAllowed: true
  };
  const pendingAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
    tenantId,
    id: attemptReference.id,
    dispatch: dispatchReference,
    route: routeReference,
    attemptNumber: 1,
    claimToken: `claim:outbound-${suffix}`,
    retrySafety,
    leaseExpiresAt: OUTBOUND_TEST_TIMES.leaseExpiresAt,
    openedAt: OUTBOUND_TEST_TIMES.openedAt,
    outcome: { kind: "pending" },
    completionSource: null,
    revision: "1"
  });
  const attemptingDispatch = inboxV2OutboundDispatchSchema.parse({
    ...queuedDispatch,
    state: "attempting",
    attemptCount: 1,
    activeAttempt: attemptReference,
    lastAttempt: attemptReference,
    revision: "2",
    updatedAt: OUTBOUND_TEST_TIMES.openedAt
  });
  const bindingHeadSnapshot = {
    tenantId,
    binding,
    externalThread,
    sourceConnection,
    sourceAccount,
    fence: bindingFence,
    remoteAccess: { state: "active" as const, revision: "1" },
    administrative: { state: "enabled" as const, revision: "1" },
    runtimeHealth: { state: "ready" as const, revision: "1" },
    historySync: { state: "live" as const, revision: "1" },
    providerAccessRevision: "1",
    bindingRevision: "1",
    updatedAt: OUTBOUND_TEST_TIMES.selectedAt
  };
  const openAttemptCommit = inboxV2OutboundDispatchAttemptCommitSchema.parse({
    kind: "open_attempt",
    tenantId,
    routeSnapshot: route,
    bindingHeadSnapshot,
    dispatchBefore: queuedDispatch,
    priorAttempt: null,
    retryAuthorizationDecision: null,
    attempt: pendingAttempt,
    dispatchAfter: attemptingDispatch
  });
  const unknownDiagnostic = {
    codeId: "core:provider-outcome-unknown",
    retryable: false,
    correlationToken: `diagnostic:outbound-unknown-${suffix}`,
    safeOperatorHintId: "core:reconcile-before-retry"
  } as const;
  const unknownAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
    ...pendingAttempt,
    outcome: {
      kind: "outcome_unknown",
      completedAt: OUTBOUND_TEST_TIMES.completedAt,
      diagnostic: unknownDiagnostic,
      requiredAction: "automated_reconciliation_required"
    },
    completionSource: "lease_expired",
    revision: "2"
  });
  const unknownDispatch = inboxV2OutboundDispatchSchema.parse({
    ...attemptingDispatch,
    state: "outcome_unknown",
    activeAttempt: null,
    revision: "3",
    updatedAt: OUTBOUND_TEST_TIMES.completedAt
  });
  const completeUnknownCommit =
    inboxV2OutboundDispatchAttemptCommitSchema.parse({
      kind: "complete_attempt",
      tenantId,
      dispatchBefore: attemptingDispatch,
      attemptBefore: pendingAttempt,
      attemptAfter: unknownAttempt,
      completionSource: "lease_expired",
      completedByTrustedServiceId: "core:source-runtime",
      dispatchAfter: unknownDispatch
    });
  const retryableDiagnostic = {
    codeId: "core:provider-temporary-failure",
    retryable: true,
    correlationToken: `diagnostic:outbound-retry-${suffix}`,
    safeOperatorHintId: "core:retry-same-route"
  } as const;
  const reconciliationDecision =
    inboxV2OutboundDispatchReconciliationDecisionSchema.parse({
      tenantId,
      id: `outbound_dispatch_reconciliation_decision:outbound-${suffix}`,
      dispatch: dispatchReference,
      route: routeReference,
      routeSnapshot: route,
      unknownAttempt,
      decidedBy: {
        kind: "trusted_service",
        trustedServiceId: "core:source-runtime"
      },
      authorizationEpoch: null,
      result: {
        state: "retryable_failure",
        retryAt: OUTBOUND_TEST_TIMES.retryAt,
        diagnostic: retryableDiagnostic,
        authorization: {
          kind: "automatic",
          trustedServiceId: "core:source-runtime"
        },
        evidenceToken: `evidence:outbound-reconciliation-${suffix}`
      },
      decidedAt: OUTBOUND_TEST_TIMES.reconciledAt,
      revision: "1"
    });
  const reconciledDispatch = inboxV2OutboundDispatchSchema.parse({
    ...unknownDispatch,
    state: "retryable_failure",
    retryAuthorization: reference(
      "outbound_dispatch_reconciliation_decision",
      reconciliationDecision.id
    ),
    revision: "4",
    updatedAt: OUTBOUND_TEST_TIMES.reconciledAt
  });
  const reconciliationCommit =
    inboxV2OutboundDispatchReconciliationCommitSchema.parse({
      tenantId,
      decision: reconciliationDecision,
      dispatchBefore: unknownDispatch,
      dispatchAfter: reconciledDispatch
    });

  const acceptedAttempt = inboxV2OutboundDispatchAttemptSchema.parse({
    ...pendingAttempt,
    outcome: {
      kind: "accepted",
      completedAt: OUTBOUND_TEST_TIMES.acceptedAt,
      providerAcknowledgementToken: `provider:ack-${suffix}`
    },
    completionSource: "provider_result",
    revision: "2"
  });
  const acceptedDispatch = inboxV2OutboundDispatchSchema.parse({
    ...attemptingDispatch,
    state: "accepted",
    activeAttempt: null,
    revision: "3",
    updatedAt: OUTBOUND_TEST_TIMES.acceptedAt
  });
  const artifacts = [1, 2].map((ordinal) =>
    inboxV2OutboundDispatchArtifactSchema.parse({
      tenantId,
      id: `outbound_dispatch_artifact:outbound-${suffix}-${ordinal}`,
      dispatch: dispatchReference,
      route: routeReference,
      attempt: attemptReference,
      ordinal,
      state: "accepted",
      diagnostic: null,
      createdAt:
        ordinal === 1
          ? OUTBOUND_TEST_TIMES.artifactAt
          : OUTBOUND_TEST_TIMES.completedAt,
      revision: "1"
    })
  );

  const association = (
    originKind: "provider_echo" | "provider_response",
    ordinal: 0 | 1
  ) => {
    const occurrenceSuffix = `${originKind}-${suffix}`;
    const externalReferenceId = `external_message_reference:${occurrenceSuffix}`;
    const occurrenceId = `source_occurrence:${occurrenceSuffix}`;
    const messageKey = {
      realm: {
        realmId: "module:synthetic:message-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1"
      },
      scope: { kind: "source_thread_binding" as const, owner: binding },
      objectKindId: "module:synthetic:chat-message",
      externalThread,
      canonicalExternalSubject: `ProviderMessage-${occurrenceSuffix}`
    };
    const identityDeclaration = {
      adapterContract,
      identityKind: "message" as const,
      realmId: messageKey.realm.realmId,
      realmVersion: messageKey.realm.realmVersion,
      canonicalizationVersion: messageKey.realm.canonicalizationVersion,
      objectKindId: messageKey.objectKindId,
      scopeKind: messageKey.scope.kind,
      decisionStrength: "safe_default" as const
    };
    const resolvedReference = {
      tenantId,
      id: externalReferenceId,
      key: messageKey,
      identityDeclaration,
      externalThread,
      timelineItem,
      message,
      revision: "1",
      createdAt: OUTBOUND_TEST_TIMES.artifactAt
    };
    const origin =
      originKind === "provider_response"
        ? {
            kind: "provider_response" as const,
            sourceAccount,
            outboundDispatchAttempt: attemptReference
          }
        : {
            kind: "provider_echo" as const,
            sourceAccount,
            rawInboundEvent: reference(
              "raw_inbound_event",
              `raw_inbound_event:${occurrenceSuffix}`
            ),
            normalizedInboundEvent: reference(
              "normalized_inbound_event",
              `normalized_inbound_event:${occurrenceSuffix}`
            )
          };
    const before = {
      tenantId,
      id: occurrenceId,
      messageKey,
      messageIdentityDeclaration: identityDeclaration,
      bindingContext: {
        externalThread,
        sourceAccount,
        sourceThreadBinding: binding,
        bindingGeneration: "1"
      },
      origin,
      descriptor: {
        adapterContract,
        descriptorSchemaId: "module:synthetic:provider-message-observation",
        descriptorVersion: "v1",
        capabilityRevision: "1",
        providerReferences: [
          {
            kindId: "module:synthetic:external-message-id",
            subject: messageKey.canonicalExternalSubject
          },
          {
            kindId: "module:synthetic:client-correlation-token",
            subject: retrySafety.providerCorrelationToken
          }
        ],
        descriptorDigestSha256: "c".repeat(64)
      },
      providerActor: null,
      direction: "outbound" as const,
      providerTimestamps: [
        {
          kindId: "module:synthetic:sent-at",
          timestamp: OUTBOUND_TEST_TIMES.artifactAt
        }
      ],
      referencePortability: {
        kind: "binding_only" as const,
        adapterContract,
        decisionStrength: "safe_default" as const
      },
      resolution: {
        state: "pending" as const,
        diagnostic: {
          codeId: "core:message-reference-pending",
          retryable: true,
          correlationToken: `correlation:${occurrenceSuffix}`,
          safeOperatorHintId: null
        }
      },
      observedAt: OUTBOUND_TEST_TIMES.artifactAt,
      recordedAt: OUTBOUND_TEST_TIMES.artifactAt,
      revision: "1",
      createdAt: OUTBOUND_TEST_TIMES.artifactAt,
      updatedAt: OUTBOUND_TEST_TIMES.artifactAt
    };
    const after = {
      ...before,
      resolution: {
        state: "resolved" as const,
        externalMessageReference: reference(
          "external_message_reference",
          externalReferenceId
        )
      },
      revision: "2",
      updatedAt: OUTBOUND_TEST_TIMES.linkedAt
    };
    const occurrenceResolution =
      inboxV2SourceOccurrenceResolutionCommitSchema.parse({
        tenantId,
        expectedRevision: "1",
        resultingRevision: "2",
        changedAt: OUTBOUND_TEST_TIMES.linkedAt,
        resolver: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime",
          resolutionToken: `resolution:${occurrenceSuffix}`
        },
        before,
        after,
        resolvedReference
      });
    return inboxV2OutboundDispatchArtifactAssociationCommitSchema.parse({
      artifact: artifacts[ordinal],
      dispatch:
        originKind === "provider_echo" ? attemptingDispatch : acceptedDispatch,
      attempt:
        originKind === "provider_echo" ? pendingAttempt : acceptedAttempt,
      route,
      occurrenceResolution,
      link: {
        tenantId,
        id: `outbound_dispatch_artifact_reference_link:${occurrenceSuffix}`,
        artifact: reference(
          "outbound_dispatch_artifact",
          artifacts[ordinal]?.id ?? "unreachable"
        ),
        dispatch: dispatchReference,
        route: routeReference,
        attempt: attemptReference,
        externalThread,
        externalMessageReference: reference(
          "external_message_reference",
          externalReferenceId
        ),
        sourceOccurrence: reference("source_occurrence", occurrenceId),
        associationEvidence:
          originKind === "provider_response"
            ? { kind: "provider_response_attempt" }
            : {
                kind: "provider_echo_correlation",
                providerReferenceKindId:
                  "module:synthetic:client-correlation-token",
                correlationToken: retrySafety.providerCorrelationToken
              },
        linkedByTrustedServiceId: "core:source-runtime",
        linkedAt: OUTBOUND_TEST_TIMES.linkedAt,
        revision: "1"
      }
    });
  };
  const echoAssociation = association("provider_echo", 0);
  const responseAssociation = association("provider_response", 1);

  const multiSendOperation = inboxV2OutboundMultiSendOperationSchema.parse({
    tenantId,
    id: `outbound_multi_send_operation:outbound-${suffix}`,
    actor: principal,
    mutationToken: `mutation:outbound-multi-${suffix}`,
    idempotencyToken: `idempotency:outbound-multi-${suffix}`,
    correlationToken: `correlation:outbound-multi-${suffix}`,
    children: ["a", "b"].map((childSuffix) => ({
      conversation: reference(
        "conversation",
        `conversation:outbound-${suffix}-${childSuffix}`
      ),
      externalThread: reference(
        "external_thread",
        `external_thread:outbound-${suffix}-${childSuffix}`
      ),
      binding: reference(
        "source_thread_binding",
        `source_thread_binding:outbound-${suffix}-${childSuffix}`
      ),
      sourceAccount: reference(
        "source_account",
        `source_account:outbound-${suffix}-${childSuffix}`
      ),
      route: reference(
        "outbound_route",
        `outbound_route:outbound-${suffix}-${childSuffix}`
      ),
      dispatch: reference(
        "outbound_dispatch",
        `outbound_dispatch:outbound-${suffix}-${childSuffix}`
      )
    })),
    createdAt: OUTBOUND_TEST_TIMES.selectedAt,
    revision: "1"
  });

  return {
    tenantId,
    suffix,
    adapterContract,
    bindingFence,
    bindingHeadSnapshot,
    references: {
      conversation,
      externalThread,
      binding,
      fallbackBinding,
      sourceAccount,
      sourceConnection,
      employee,
      route: routeReference,
      dispatch: dispatchReference,
      message,
      timelineItem,
      attempt: attemptReference
    },
    routePolicy,
    routePolicyWithFallback,
    routeInput,
    routeResult,
    route,
    routeCommit,
    queuedDispatch,
    pendingAttempt,
    attemptingDispatch,
    openAttemptCommit,
    unknownAttempt,
    unknownDispatch,
    completeUnknownCommit,
    reconciliationDecision,
    reconciledDispatch,
    reconciliationCommit,
    acceptedAttempt,
    acceptedDispatch,
    artifacts,
    echoAssociation,
    responseAssociation,
    multiSendOperation
  } as const;
}
