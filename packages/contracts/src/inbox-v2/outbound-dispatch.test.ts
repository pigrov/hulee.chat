import { describe, expect, it } from "vitest";

import {
  INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_ASSOCIATION_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_REFERENCE_LINK_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_DECISION_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_DISPATCH_ROUTE_FAILURE_COMMIT_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
  INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
  INBOX_V2_OUTBOUND_MULTI_SEND_OPERATION_SCHEMA_ID,
  deriveInboxV2OutboundDispatchArtifactId,
  deriveInboxV2RouteFailureOutboxFinalization,
  inboxV2OutboundDispatchArtifactAssociationCommitEnvelopeSchema,
  inboxV2OutboundDispatchArtifactAssociationCommitSchema,
  inboxV2OutboundDispatchArtifactEnvelopeSchema,
  inboxV2OutboundDispatchArtifactReferenceLinkEnvelopeSchema,
  inboxV2OutboundDispatchArtifactSchema,
  inboxV2OutboundDispatchAttemptCommitEnvelopeSchema,
  inboxV2OutboundDispatchAttemptCommitSchema,
  inboxV2OutboundDispatchAttemptEnvelopeSchema,
  inboxV2OutboundDispatchAttemptSchema,
  inboxV2OutboundDispatchEnvelopeSchema,
  inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema,
  inboxV2OutboundDispatchReconciliationCommitEnvelopeSchema,
  inboxV2OutboundDispatchReconciliationCommitSchema,
  inboxV2OutboundDispatchReconciliationDecisionEnvelopeSchema,
  inboxV2OutboundDispatchReconciliationDecisionSchema,
  inboxV2OutboundDispatchRerouteCommitEnvelopeSchema,
  inboxV2OutboundDispatchRerouteCommitSchema,
  inboxV2OutboundDispatchRouteFailureCommitEnvelopeSchema,
  inboxV2OutboundDispatchRouteFailureCommitSchema,
  inboxV2OutboundDispatchSchema,
  inboxV2OutboundMultiSendOperationEnvelopeSchema,
  inboxV2OutboundMultiSendOperationSchema
} from "./outbound-dispatch";
import { inboxV2SourceOccurrenceResolutionCommitSchema } from "./external-message-reference";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import { inboxV2OutboxIntentIdSchema } from "./sync-primitives";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const adapterLoadedAt = "2026-07-11T09:00:00.000Z";
const routeSelectedAt = "2026-07-11T09:30:00.000Z";
const openedAt = "2026-07-11T10:00:00.000Z";
const artifactAt = "2026-07-11T10:03:00.000Z";
const providerCompletedAt = "2026-07-11T10:04:00.000Z";
const leaseExpiresAt = "2026-07-11T10:05:00.000Z";
const sweepAt = "2026-07-11T10:06:00.000Z";
const operatorAuthorizedAt = "2026-07-11T10:06:30.000Z";
const reconciledAt = "2026-07-11T10:07:00.000Z";
const retryAt = "2026-07-11T10:08:00.000Z";
const reopenedAt = "2026-07-11T10:09:00.000Z";
const linkedAt = "2026-07-11T10:10:00.000Z";
const authorityNotAfter = "2026-07-11T12:00:00.000Z";

function reference<const TKind extends string>(
  kind: TKind,
  id: string,
  referenceTenantId = tenantId
) {
  return { tenantId: referenceTenantId, kind, id };
}

const conversationReference = reference(
  "conversation",
  "conversation:conversation-1"
);
const externalThreadReference = reference(
  "external_thread",
  "external_thread:thread-1"
);
const bindingReference = reference(
  "source_thread_binding",
  "source_thread_binding:binding-1"
);
const accountReference = reference(
  "source_account",
  "source_account:account-1"
);
const connectionReference = reference(
  "source_connection",
  "source_connection:connection-1"
);
const routeReference = reference("outbound_route", "outbound_route:route-1");
const dispatchReference = reference(
  "outbound_dispatch",
  "outbound_dispatch:dispatch-1"
);
const messageReference = reference("message", "message:message-1");
const employeeReference = reference("employee", "employee:employee-1");

const adapterContract = {
  contractId: "module:synthetic:direct-account-adapter",
  contractVersion: "v1",
  declarationRevision: "7",
  surfaceId: "module:synthetic:direct-account",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: adapterLoadedAt
} as const;

const bindingFence = {
  accountGeneration: "1",
  bindingGeneration: "1",
  remoteAccessRevision: "2",
  administrativeRevision: "3",
  capabilityRevision: "4",
  routeDescriptorRevision: "5"
} as const;

function createRoute() {
  const principal = {
    kind: "employee" as const,
    employee: employeeReference
  };
  const authorizationTarget = {
    conversation: conversationReference,
    externalThread: externalThreadReference,
    sourceThreadBinding: bindingReference,
    sourceAccount: accountReference,
    sourceConnection: connectionReference,
    operationId: "core:reply",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:route-epoch-0001",
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
    decidedAt: routeSelectedAt,
    notAfter: authorityNotAfter
  };
  return {
    tenantId,
    id: routeReference.id,
    principal,
    conversation: conversationReference,
    externalThread: externalThreadReference,
    sourceThreadBinding: bindingReference,
    sourceAccount: accountReference,
    sourceConnection: connectionReference,
    operationId: "core:reply",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:route-epoch-0001",
    requiredConversationPermissionId: "core:message.reply_external",
    bindingFence,
    adapterContract,
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "5",
      destinationKindId: "module:synthetic:group-peer",
      destinationSubject: "Group-ABC",
      attributes: [],
      descriptorDigestSha256:
        "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
    },
    routePolicy: reference(
      "thread_route_policy",
      "thread_route_policy:policy-1"
    ),
    routePolicyRevision: "7",
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action" as const,
      requiredPermissionId: "core:message.reply_external",
      matchedPermissionIds: ["core:message.reply_external"],
      decisionToken: "decision:conversation-route-0001"
    },
    sourceAccountAuthorization: {
      ...decisionBase,
      decisionKind: "source_account_use" as const,
      requiredPermissionId: "core:source_account.use" as const,
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: "decision:source-account-route-0001"
    },
    referenceContext: { kind: "none" as const },
    runtimeObservationAtResolution: {
      state: "ready" as const,
      revision: "1",
      observedAt: routeSelectedAt,
      diagnostic: null
    },
    selection: {
      intent: { kind: "automatic" as const },
      reason: "sole_eligible_binding" as const,
      candidateSnapshotToken: "snapshot:route-candidate-0001",
      candidateSnapshotNotAfter: authorityNotAfter,
      fallbackPolicyOrdinal: null,
      selectedAt: routeSelectedAt
    },
    mutationToken: "mutation:route-0001",
    idempotencyToken: "idempotency:route-0001",
    correlationToken: "correlation:route-0001",
    revision: "1",
    createdAt: routeSelectedAt
  };
}

const routeSnapshot = createRoute();

function bindingHead(input?: {
  fence?: {
    accountGeneration: string;
    bindingGeneration: string;
    remoteAccessRevision: string;
    administrativeRevision: string;
    capabilityRevision: string;
    routeDescriptorRevision: string;
  };
  remoteState?: "observed" | "active" | "left" | "removed";
  administrativeState?: "enabled" | "disabled";
  runtimeState?: "unknown" | "ready" | "degraded" | "unavailable";
}) {
  const fence = input?.fence ?? bindingFence;
  return {
    tenantId,
    binding: bindingReference,
    externalThread: externalThreadReference,
    sourceConnection: connectionReference,
    sourceAccount: accountReference,
    fence,
    remoteAccess: {
      state: input?.remoteState ?? "active",
      revision: fence.remoteAccessRevision
    },
    administrative: {
      state: input?.administrativeState ?? "enabled",
      revision: fence.administrativeRevision
    },
    runtimeHealth: {
      state: input?.runtimeState ?? "ready",
      revision: "11"
    },
    historySync: { state: "live", revision: "12" },
    providerAccessRevision: "13",
    bindingRevision: "14",
    updatedAt: routeSelectedAt
  };
}

function safeRetrySafety(token = "provider:idempotency-0001") {
  return {
    adapterContract,
    declaredByTrustedServiceId: "core:source-runtime",
    declarationToken: `declaration:${token}`,
    declaredAt: routeSelectedAt,
    mechanism: "provider_idempotency_key" as const,
    providerCorrelationToken: token,
    automaticRetryAllowed: true
  };
}

function unsafeRetrySafety() {
  return {
    adapterContract,
    declaredByTrustedServiceId: "core:source-runtime",
    declarationToken: "declaration:unsafe-retry-safety-0001",
    declaredAt: routeSelectedAt,
    mechanism: "unsafe_or_unknown" as const,
    providerCorrelationToken: null,
    automaticRetryAllowed: false
  };
}

function attemptReference(suffix = "1") {
  return reference(
    "outbound_dispatch_attempt",
    `outbound_dispatch_attempt:attempt-${suffix}`
  );
}

function queuedDispatch() {
  return {
    tenantId,
    id: dispatchReference.id,
    message: messageReference,
    route: routeReference,
    multiSendOperation: null,
    state: "queued" as const,
    attemptCount: 0,
    activeAttempt: null,
    lastAttempt: null,
    retryAuthorization: null,
    revision: "1",
    createdAt: routeSelectedAt,
    updatedAt: routeSelectedAt
  };
}

function rerouteCommit() {
  const dispatchBefore = queuedDispatch();
  return {
    tenantId,
    original: {
      dispatchBefore,
      dispatchAfter: {
        ...dispatchBefore,
        state: "cancelled" as const,
        revision: "2",
        updatedAt: openedAt
      },
      outboxIntentId: "outbox-intent:original-dispatch"
    },
    replacement: {
      message: reference("message", "message:message-2"),
      route: reference("outbound_route", "outbound_route:route-2"),
      dispatch: reference("outbound_dispatch", "outbound_dispatch:dispatch-2"),
      outboxIntentId: "outbox-intent:replacement-dispatch"
    },
    reasonId: "core:operator-reroute",
    changedAt: openedAt
  };
}

function pendingAttempt(input?: {
  suffix?: string;
  number?: number;
  openedAt?: string;
  leaseExpiresAt?: string;
  retrySafety?:
    | ReturnType<typeof safeRetrySafety>
    | ReturnType<typeof unsafeRetrySafety>;
}) {
  const suffix = input?.suffix ?? "1";
  return {
    tenantId,
    id: attemptReference(suffix).id,
    dispatch: dispatchReference,
    route: routeReference,
    attemptNumber: input?.number ?? 1,
    claimToken: `claim:attempt-${suffix}-0001`,
    retrySafety: input?.retrySafety ?? safeRetrySafety(),
    leaseExpiresAt: input?.leaseExpiresAt ?? leaseExpiresAt,
    openedAt: input?.openedAt ?? openedAt,
    outcome: { kind: "pending" as const },
    completionSource: null,
    revision: "1"
  };
}

function attemptingDispatch(
  before: ReturnType<typeof queuedDispatch>,
  attempt: ReturnType<typeof pendingAttempt>,
  revision = "2"
) {
  return {
    ...before,
    state: "attempting" as const,
    attemptCount: attempt.attemptNumber,
    activeAttempt: attemptReference(attempt.id.split("-").at(-1)),
    lastAttempt: attemptReference(attempt.id.split("-").at(-1)),
    retryAuthorization: null,
    revision,
    updatedAt: attempt.openedAt
  };
}

const retryableDiagnostic = {
  codeId: "core:provider-temporary-failure",
  retryable: true,
  correlationToken: "diagnostic:provider-retry-0001",
  safeOperatorHintId: "core:retry-same-route"
} as const;
const terminalDiagnostic = {
  codeId: "core:provider-terminal-failure",
  retryable: false,
  correlationToken: "diagnostic:provider-terminal-0001",
  safeOperatorHintId: "core:inspect-source-config"
} as const;
const unknownDiagnostic = {
  codeId: "core:provider-outcome-unknown",
  retryable: false,
  correlationToken: "diagnostic:provider-unknown-0001",
  safeOperatorHintId: "core:reconcile-before-retry"
} as const;

function acceptedAttempt(attempt: ReturnType<typeof pendingAttempt>) {
  return {
    ...attempt,
    outcome: {
      kind: "accepted" as const,
      completedAt: providerCompletedAt,
      providerAcknowledgementToken: "provider:acknowledgement-0001"
    },
    completionSource: "provider_result" as const,
    revision: "2"
  };
}

function retryableAttempt(
  attempt: ReturnType<typeof pendingAttempt>,
  completionSource: "provider_result" | "preflight_blocked" = "provider_result"
) {
  return {
    ...attempt,
    outcome: {
      kind: "retryable_failure" as const,
      completedAt: providerCompletedAt,
      retryAt,
      diagnostic: retryableDiagnostic
    },
    completionSource,
    revision: "2"
  };
}

function unknownAttempt(
  attempt: ReturnType<typeof pendingAttempt>,
  completedAt = sweepAt
) {
  return {
    ...attempt,
    outcome: {
      kind: "outcome_unknown" as const,
      completedAt,
      diagnostic: unknownDiagnostic,
      requiredAction: attempt.retrySafety.automaticRetryAllowed
        ? ("automated_reconciliation_required" as const)
        : ("operator_duplicate_risk_decision_required" as const)
    },
    completionSource: "lease_expired" as const,
    revision: "2"
  };
}

function dispatchAfterCompletion(
  before: ReturnType<typeof attemptingDispatch>,
  attempt:
    | ReturnType<typeof acceptedAttempt>
    | ReturnType<typeof retryableAttempt>
    | ReturnType<typeof unknownAttempt>,
  state: "accepted" | "retryable_failure" | "outcome_unknown"
) {
  return {
    ...before,
    state,
    activeAttempt: null,
    lastAttempt: attemptReference(attempt.id.split("-").at(-1)),
    retryAuthorization: null,
    revision: String(BigInt(before.revision) + 1n),
    updatedAt: attempt.outcome.completedAt
  };
}

function openCommit(input?: {
  dispatchBefore?: ReturnType<typeof queuedDispatch> | Record<string, unknown>;
  priorAttempt?: Record<string, unknown> | null;
  retryAuthorizationDecision?: Record<string, unknown> | null;
  attempt?: ReturnType<typeof pendingAttempt>;
  dispatchAfter?: Record<string, unknown>;
  head?: ReturnType<typeof bindingHead>;
  route?: ReturnType<typeof createRoute>;
}) {
  const before = input?.dispatchBefore ?? queuedDispatch();
  const attempt = input?.attempt ?? pendingAttempt();
  return {
    kind: "open_attempt" as const,
    tenantId,
    routeSnapshot: input?.route ?? routeSnapshot,
    bindingHeadSnapshot: input?.head ?? bindingHead(),
    dispatchBefore: before,
    priorAttempt: input?.priorAttempt ?? null,
    retryAuthorizationDecision: input?.retryAuthorizationDecision ?? null,
    attempt,
    dispatchAfter:
      input?.dispatchAfter ??
      attemptingDispatch(before as ReturnType<typeof queuedDispatch>, attempt)
  };
}

function completeCommit(
  beforeDispatch: ReturnType<typeof attemptingDispatch>,
  beforeAttempt: ReturnType<typeof pendingAttempt>,
  afterAttempt:
    | ReturnType<typeof acceptedAttempt>
    | ReturnType<typeof retryableAttempt>
    | ReturnType<typeof unknownAttempt>,
  afterDispatch: ReturnType<typeof dispatchAfterCompletion>,
  source: "provider_result" | "lease_expired" | "preflight_blocked"
) {
  return {
    kind: "complete_attempt" as const,
    tenantId,
    dispatchBefore: beforeDispatch,
    attemptBefore: beforeAttempt,
    attemptAfter: afterAttempt,
    completionSource: source,
    completedByTrustedServiceId: "core:source-runtime",
    dispatchAfter: afterDispatch
  };
}

function automaticRetryDecision(
  attempt: ReturnType<typeof unknownAttempt>,
  resultState:
    | "accepted"
    | "terminal_failure"
    | "retryable_failure" = "retryable_failure"
) {
  const result =
    resultState === "accepted"
      ? {
          state: "accepted" as const,
          providerAcknowledgementToken: "provider:reconciled-ack-0001",
          evidenceToken: "evidence:provider-lookup-0001"
        }
      : resultState === "terminal_failure"
        ? {
            state: "terminal_failure" as const,
            diagnostic: terminalDiagnostic,
            evidenceToken: "evidence:provider-terminal-0001"
          }
        : {
            state: "retryable_failure" as const,
            retryAt,
            diagnostic: retryableDiagnostic,
            authorization: {
              kind: "automatic" as const,
              trustedServiceId: "core:source-runtime"
            },
            evidenceToken: "evidence:safe-retry-0001"
          };
  return {
    tenantId,
    id: "outbound_dispatch_reconciliation_decision:decision-1",
    dispatch: dispatchReference,
    route: routeReference,
    routeSnapshot,
    unknownAttempt: attempt,
    decidedBy: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime"
    },
    authorizationEpoch: null,
    result,
    decidedAt: reconciledAt,
    revision: "1"
  };
}

function operatorAuthorization(
  attempt: ReturnType<typeof unknownAttempt>,
  input?: {
    effect?: "allow" | "deny";
    notAfter?: string;
    route?: typeof routeReference;
    matchedPermissionIds?: string[];
  }
) {
  return {
    tenantId,
    employee: employeeReference,
    dispatch: dispatchReference,
    route: input?.route ?? routeReference,
    unknownAttempt: attemptReference(attempt.id.split("-").at(-1)),
    requiredPermissionId:
      "core:outbound_dispatch.duplicate-risk-retry" as const,
    authorizationEpoch: "authorization:unsafe-retry-0001",
    effect: input?.effect ?? ("allow" as const),
    matchedPermissionIds: input?.matchedPermissionIds ?? [
      "core:outbound_dispatch.duplicate-risk-retry"
    ],
    decisionToken: "decision:unsafe-retry-auth-0001",
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: operatorAuthorizedAt,
    notAfter: input?.notAfter ?? authorityNotAfter
  };
}

function operatorRetryDecision(
  attempt: ReturnType<typeof unknownAttempt>,
  authorization = operatorAuthorization(attempt)
) {
  return {
    tenantId,
    id: "outbound_dispatch_reconciliation_decision:decision-operator-1",
    dispatch: dispatchReference,
    route: routeReference,
    routeSnapshot,
    unknownAttempt: attempt,
    decidedBy: { kind: "employee" as const, employee: employeeReference },
    authorizationEpoch: "authorization:unsafe-retry-0001",
    result: {
      state: "retryable_failure" as const,
      retryAt,
      diagnostic: retryableDiagnostic,
      authorization: {
        kind: "employee_duplicate_risk_override" as const,
        employee: employeeReference,
        duplicateRiskAcknowledged: true as const,
        reasonId: "core:customer-approved-duplicate-risk",
        reason: "Operator confirmed the possible duplicate provider send.",
        operatorAuthorization: authorization
      },
      evidenceToken: "evidence:operator-override-0001"
    },
    decidedAt: reconciledAt,
    revision: "1"
  };
}

function unknownDispatch(
  attempting: ReturnType<typeof attemptingDispatch>,
  attempt: ReturnType<typeof unknownAttempt>
) {
  return dispatchAfterCompletion(attempting, attempt, "outcome_unknown");
}

function reconciledDispatch(
  before: ReturnType<typeof unknownDispatch>,
  decision:
    | ReturnType<typeof automaticRetryDecision>
    | ReturnType<typeof operatorRetryDecision>
) {
  return {
    ...before,
    state: decision.result.state,
    retryAuthorization:
      decision.result.state === "retryable_failure"
        ? reference("outbound_dispatch_reconciliation_decision", decision.id)
        : null,
    revision: String(BigInt(before.revision) + 1n),
    updatedAt: decision.decidedAt
  };
}

function occurrenceResolution(
  originKind: "provider_response" | "provider_echo",
  suffix = "1"
) {
  const messageKey = {
    realm: {
      realmId: "module:synthetic:message-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: {
      kind: "source_thread_binding" as const,
      owner: bindingReference
    },
    objectKindId: "module:synthetic:chat-message",
    externalThread: externalThreadReference,
    canonicalExternalSubject: `Provider-Message-${suffix}`
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
  const externalMessageReference = {
    tenantId,
    id: `external_message_reference:reference-${suffix}`,
    key: messageKey,
    identityDeclaration,
    externalThread: externalThreadReference,
    timelineItem: reference("timeline_item", `timeline_item:item-${suffix}`),
    message: messageReference,
    revision: "1",
    createdAt: artifactAt
  };
  const externalMessageReferenceRef = reference(
    "external_message_reference",
    externalMessageReference.id
  );
  const sourceOccurrenceRef = reference(
    "source_occurrence",
    `source_occurrence:occurrence-${suffix}`
  );
  const origin =
    originKind === "provider_response"
      ? {
          kind: "provider_response" as const,
          sourceAccount: accountReference,
          outboundDispatchAttempt: attemptReference("1")
        }
      : {
          kind: "provider_echo" as const,
          sourceAccount: accountReference,
          rawInboundEvent: reference(
            "raw_inbound_event",
            `raw_inbound_event:raw-${suffix}`
          ),
          normalizedInboundEvent: reference(
            "normalized_inbound_event",
            `normalized_inbound_event:normalized-${suffix}`
          )
        };
  const before = {
    tenantId,
    id: sourceOccurrenceRef.id,
    messageKey,
    messageIdentityDeclaration: identityDeclaration,
    bindingContext: {
      externalThread: externalThreadReference,
      sourceAccount: accountReference,
      sourceThreadBinding: bindingReference,
      bindingGeneration: "1"
    },
    origin,
    descriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic:provider-message-observation",
      descriptorVersion: "v1",
      capabilityRevision: "4",
      providerReferences: [
        {
          kindId: "module:synthetic:external-message-id",
          subject: messageKey.canonicalExternalSubject
        },
        {
          kindId: "module:synthetic:client-correlation-token",
          subject: "provider:idempotency-0001"
        }
      ],
      descriptorDigestSha256:
        "cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
    },
    providerActor: null,
    direction: "outbound" as const,
    providerTimestamps: [
      {
        kindId: "module:synthetic:sent-at",
        timestamp: artifactAt
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
        correlationToken: `correlation:occurrence-${suffix}`,
        safeOperatorHintId: null
      }
    },
    observedAt: artifactAt,
    recordedAt: artifactAt,
    revision: "1",
    createdAt: artifactAt,
    updatedAt: artifactAt
  };
  const after = {
    ...before,
    resolution: {
      state: "resolved" as const,
      externalMessageReference: externalMessageReferenceRef
    },
    revision: "2",
    updatedAt: providerCompletedAt
  };
  return {
    tenantId,
    expectedRevision: "1",
    resultingRevision: "2",
    changedAt: providerCompletedAt,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime",
      resolutionToken: `resolution:occurrence-${suffix}`
    },
    before,
    after,
    resolvedReference: externalMessageReference
  };
}

function acceptedArtifact(createdAt = providerCompletedAt) {
  return {
    tenantId,
    id: "outbound_dispatch_artifact:artifact-1",
    dispatch: dispatchReference,
    route: routeReference,
    attempt: attemptReference("1"),
    ordinal: 1,
    state: "accepted" as const,
    diagnostic: null,
    createdAt,
    revision: "1"
  };
}

function artifactAssociation(
  originKind: "provider_response" | "provider_echo"
) {
  const attempt = pendingAttempt();
  const attempting = attemptingDispatch(queuedDispatch(), attempt);
  const occurrence = occurrenceResolution(originKind);
  const artifact = acceptedArtifact(
    originKind === "provider_echo" ? artifactAt : providerCompletedAt
  );
  const closedAttempt = acceptedAttempt(attempt);
  const closedDispatch = dispatchAfterCompletion(
    attempting,
    closedAttempt,
    "accepted"
  );
  return {
    artifact,
    dispatch: originKind === "provider_echo" ? attempting : closedDispatch,
    attempt: originKind === "provider_echo" ? attempt : closedAttempt,
    route: routeSnapshot,
    occurrenceResolution: occurrence,
    link: {
      tenantId,
      id: "outbound_dispatch_artifact_reference_link:link-1",
      artifact: reference("outbound_dispatch_artifact", artifact.id),
      dispatch: dispatchReference,
      route: routeReference,
      attempt: attemptReference("1"),
      externalThread: externalThreadReference,
      externalMessageReference: reference(
        "external_message_reference",
        occurrence.resolvedReference.id
      ),
      sourceOccurrence: reference("source_occurrence", occurrence.after.id),
      associationEvidence:
        originKind === "provider_response"
          ? { kind: "provider_response_attempt" as const }
          : {
              kind: "provider_echo_correlation" as const,
              providerReferenceKindId:
                "module:synthetic:client-correlation-token",
              correlationToken: "provider:idempotency-0001"
            },
      linkedByTrustedServiceId: "core:source-runtime",
      linkedAt,
      revision: "1"
    }
  };
}

function multiSendOperation() {
  const child = (suffix: string) => ({
    conversation: reference(
      "conversation",
      `conversation:conversation-${suffix}`
    ),
    externalThread: reference(
      "external_thread",
      `external_thread:thread-${suffix}`
    ),
    binding: reference(
      "source_thread_binding",
      `source_thread_binding:binding-${suffix}`
    ),
    sourceAccount: reference(
      "source_account",
      `source_account:account-${suffix}`
    ),
    route: reference("outbound_route", `outbound_route:route-${suffix}`),
    dispatch: reference(
      "outbound_dispatch",
      `outbound_dispatch:dispatch-${suffix}`
    )
  });
  return {
    tenantId,
    id: "outbound_multi_send_operation:operation-1",
    actor: {
      kind: "employee" as const,
      employee: employeeReference
    },
    mutationToken: "mutation:multi-send-0001",
    idempotencyToken: "idempotency:multi-send-0001",
    correlationToken: "correlation:multi-send-0001",
    children: [child("a"), child("b")],
    createdAt: routeSelectedAt,
    revision: "1"
  };
}

describe("Inbox V2 crash-safe outbound dispatch", () => {
  it("pins adapter-declared retry safety and current structural head before I/O", () => {
    expect(inboxV2OutboundRouteSchema.safeParse(routeSnapshot).success).toBe(
      true
    );
    const commit = openCommit();
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(commit).success
    ).toBe(true);

    const wrongAdapterAttempt = {
      ...pendingAttempt(),
      retrySafety: {
        ...safeRetrySafety(),
        adapterContract: {
          ...adapterContract,
          declarationRevision: "8"
        }
      }
    };
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...openCommit(),
        attempt: wrongAdapterAttempt
      }).success
    ).toBe(false);

    for (const head of [
      bindingHead({
        fence: { ...bindingFence, bindingGeneration: "2" }
      }),
      bindingHead({ administrativeState: "disabled" }),
      bindingHead({ remoteState: "left" })
    ]) {
      expect(
        inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
          openCommit({ head })
        ).success
      ).toBe(false);
    }
  });

  it("keeps runtime health outside the structural fence and records zero-I/O preflight", () => {
    const pending = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), pending);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        openCommit({ head: bindingHead({ runtimeState: "unavailable" }) })
      ).success
    ).toBe(true);

    const blocked = retryableAttempt(pending, "preflight_blocked");
    const after = dispatchAfterCompletion(
      attempting,
      blocked,
      "retryable_failure"
    );
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        completeCommit(attempting, pending, blocked, after, "preflight_blocked")
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse({
        ...blocked,
        outcome: {
          kind: "accepted",
          completedAt: providerCompletedAt,
          providerAcknowledgementToken: null
        }
      }).success
    ).toBe(false);
  });

  it("supports provider result and crash lease expiry with stale-holder rejection", () => {
    const pending = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), pending);
    const accepted = acceptedAttempt(pending);
    const acceptedDispatch = dispatchAfterCompletion(
      attempting,
      accepted,
      "accepted"
    );
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        completeCommit(
          attempting,
          pending,
          accepted,
          acceptedDispatch,
          "provider_result"
        )
      ).success
    ).toBe(true);

    const unknown = unknownAttempt(pending);
    const sweptDispatch = unknownDispatch(attempting, unknown);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        completeCommit(
          attempting,
          pending,
          unknown,
          sweptDispatch,
          "lease_expired"
        )
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        completeCommit(
          sweptDispatch as unknown as ReturnType<typeof attemptingDispatch>,
          pending,
          accepted,
          acceptedDispatch,
          "provider_result"
        )
      ).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse(
        unknownAttempt(pending, providerCompletedAt)
      ).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse({
        ...accepted,
        outcome: { ...accepted.outcome, completedAt: sweepAt }
      }).success
    ).toBe(false);
  });

  it("forces mixed provider artifact outcomes through an operator duplicate-risk decision", () => {
    const pending = pendingAttempt();
    const mixedUnknown = {
      ...pending,
      outcome: {
        kind: "outcome_unknown" as const,
        completedAt: providerCompletedAt,
        diagnostic: {
          codeId: "core:provider-artifact-outcomes-mixed",
          retryable: false,
          correlationToken: pending.claimToken,
          safeOperatorHintId: "core:reconcile-before-retry"
        },
        requiredAction: "operator_duplicate_risk_decision_required" as const
      },
      completionSource: "provider_result" as const,
      revision: "2"
    };
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse(mixedUnknown).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse({
        ...mixedUnknown,
        outcome: {
          ...mixedUnknown.outcome,
          requiredAction: "automated_reconciliation_required"
        }
      }).success
    ).toBe(false);
  });

  it("prevents post-hoc retry-safety substitution and mutable unknown state", () => {
    const unsafePending = pendingAttempt({ retrySafety: unsafeRetrySafety() });
    const unknown = unknownAttempt(unsafePending);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse(unknown).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(
        completeCommit(
          attemptingDispatch(queuedDispatch(), unsafePending),
          unsafePending,
          {
            ...unknown,
            retrySafety: safeRetrySafety("provider:substituted-0001")
          },
          unknownDispatch(
            attemptingDispatch(queuedDispatch(), unsafePending),
            unknown
          ),
          "lease_expired"
        )
      ).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptSchema.safeParse({
        ...unknown,
        outcome: {
          ...unknown.outcome,
          retrySafety: safeRetrySafety(),
          reconciliationState: "reconciled"
        }
      }).success
    ).toBe(false);
  });

  it("enforces exact attempt count, claim, route, completion time and authority CAS", () => {
    const pending = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), pending);
    const accepted = acceptedAttempt(pending);
    const after = dispatchAfterCompletion(attempting, accepted, "accepted");
    const valid = completeCommit(
      attempting,
      pending,
      accepted,
      after,
      "provider_result"
    );
    for (const invalid of [
      {
        ...valid,
        dispatchBefore: { ...attempting, attemptCount: 2 }
      },
      {
        ...valid,
        attemptAfter: { ...accepted, claimToken: "claim:stale-holder-0002" }
      },
      {
        ...valid,
        attemptAfter: {
          ...accepted,
          route: reference("outbound_route", "outbound_route:other")
        }
      },
      {
        ...valid,
        completedByTrustedServiceId: "core:unrelated-worker"
      }
    ]) {
      expect(
        inboxV2OutboundDispatchAttemptCommitSchema.safeParse(invalid).success
      ).toBe(false);
    }
  });

  it("reopens a known retryable failure only with its exact prior attempt", () => {
    const first = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), first);
    const retryable = retryableAttempt(first);
    const retryableDispatch = dispatchAfterCompletion(
      attempting,
      retryable,
      "retryable_failure"
    );
    const second = pendingAttempt({
      suffix: "2",
      number: 2,
      openedAt: reopenedAt,
      leaseExpiresAt: authorityNotAfter,
      retrySafety: safeRetrySafety("provider:idempotency-0002")
    });
    const after = {
      ...retryableDispatch,
      state: "attempting" as const,
      attemptCount: 2,
      activeAttempt: attemptReference("2"),
      lastAttempt: attemptReference("2"),
      retryAuthorization: null,
      revision: "4",
      updatedAt: reopenedAt
    };
    const valid = openCommit({
      dispatchBefore: retryableDispatch,
      priorAttempt: retryable,
      attempt: second,
      dispatchAfter: after
    });
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(valid).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...valid,
        attempt: { ...second, openedAt: providerCompletedAt }
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...valid,
        priorAttempt: { ...retryable, attemptNumber: 2 }
      }).success
    ).toBe(false);
  });

  it("authorizes safe unknown retry only through the exact reconciliation decision", () => {
    const first = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), first);
    const unknown = unknownAttempt(first);
    const before = unknownDispatch(attempting, unknown);
    const decision = automaticRetryDecision(unknown);
    const afterDecision = reconciledDispatch(before, decision);
    const reconciliationCommit = {
      tenantId,
      dispatchBefore: before,
      decision,
      dispatchAfter: afterDecision
    };
    expect(
      inboxV2OutboundDispatchReconciliationCommitSchema.safeParse(
        reconciliationCommit
      ).success
    ).toBe(true);

    const second = pendingAttempt({
      suffix: "2",
      number: 2,
      openedAt: reopenedAt,
      leaseExpiresAt: authorityNotAfter,
      retrySafety: safeRetrySafety()
    });
    const afterOpen = {
      ...afterDecision,
      state: "attempting" as const,
      attemptCount: 2,
      activeAttempt: attemptReference("2"),
      lastAttempt: attemptReference("2"),
      retryAuthorization: null,
      revision: "5",
      updatedAt: reopenedAt
    };
    const validOpen = openCommit({
      dispatchBefore: afterDecision,
      priorAttempt: unknown,
      retryAuthorizationDecision: decision,
      attempt: second,
      dispatchAfter: afterOpen
    });
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse(validOpen).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...validOpen,
        retryAuthorizationDecision: null
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...validOpen,
        attempt: {
          ...second,
          retrySafety: safeRetrySafety("provider:idempotency-0002")
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchAttemptCommitSchema.safeParse({
        ...validOpen,
        attempt: {
          ...second,
          retrySafety: {
            ...safeRetrySafety(),
            mechanism: "recoverable_client_marker"
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires exact current RBAC authority for unsafe Employee override", () => {
    const unsafePending = pendingAttempt({ retrySafety: unsafeRetrySafety() });
    const unknown = unknownAttempt(unsafePending);
    const operatorDecision = operatorRetryDecision(unknown);
    expect(
      inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse(
        operatorDecision
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse(
        automaticRetryDecision(unknown)
      ).success
    ).toBe(false);

    for (const authorization of [
      operatorAuthorization(unknown, {
        route: reference("outbound_route", "outbound_route:other")
      }),
      operatorAuthorization(unknown, {
        notAfter: operatorAuthorizedAt
      }),
      operatorAuthorization(unknown, { effect: "deny" }),
      operatorAuthorization(unknown, {
        matchedPermissionIds: ["core:inbox.read"]
      })
    ]) {
      expect(
        inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse(
          operatorRetryDecision(unknown, authorization)
        ).success
      ).toBe(false);
    }
    expect(
      inboxV2OutboundDispatchOperatorRetryAuthorizationDecisionSchema.safeParse(
        operatorAuthorization(unknown)
      ).success
    ).toBe(true);
  });

  it("prevents an Employee from declaring accepted or terminal provider truth", () => {
    const unknown = unknownAttempt(pendingAttempt());
    const accepted = automaticRetryDecision(unknown, "accepted");
    expect(
      inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse(accepted)
        .success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse({
        ...accepted,
        decidedBy: { kind: "employee", employee: employeeReference },
        authorizationEpoch: "authorization:forged-accepted-0001"
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchReconciliationDecisionSchema.safeParse({
        ...automaticRetryDecision(unknown, "terminal_failure"),
        decidedBy: { kind: "employee", employee: employeeReference },
        authorizationEpoch: "authorization:forged-terminal-0001"
      }).success
    ).toBe(false);
  });

  it("records structural and runtime route failures without creating an attempt", () => {
    const before = queuedDispatch();
    const failedAt = openedAt;
    const after = {
      ...before,
      state: "terminal_failure" as const,
      retryAuthorization: null,
      revision: "2",
      updatedAt: failedAt
    };
    const changedHead = bindingHead({
      fence: { ...bindingFence, bindingGeneration: "2" }
    });
    const valid = {
      tenantId,
      routeSnapshot,
      bindingHeadSnapshot: changedHead,
      error: {
        code: "route.binding_changed",
        retryability: "retryable_resolution",
        diagnostic: null
      },
      dispatchBefore: before,
      dispatchAfter: after,
      failedByTrustedServiceId: "core:source-runtime",
      failedAt
    };
    expect(
      inboxV2OutboundDispatchRouteFailureCommitSchema.safeParse(valid).success
    ).toBe(true);
    expect(after.attemptCount).toBe(0);

    const adminDisabledFailure = {
      ...valid,
      bindingHeadSnapshot: bindingHead({
        fence: { ...bindingFence, administrativeRevision: "2" },
        administrativeState: "disabled"
      }),
      error: {
        code: "route.binding_changed" as const,
        retryability: "retryable_resolution" as const,
        diagnostic: null
      }
    };
    expect(
      inboxV2OutboundDispatchRouteFailureCommitSchema.safeParse(
        adminDisabledFailure
      ).success
    ).toBe(true);

    const runtimeFailedAt = providerCompletedAt;
    const runtimeHead = bindingHead({ runtimeState: "unavailable" });
    const runtimeFailure =
      inboxV2OutboundDispatchRouteFailureCommitSchema.parse({
        ...valid,
        bindingHeadSnapshot: {
          ...runtimeHead,
          runtimeHealth: {
            state: "unavailable" as const,
            revision: "12"
          },
          bindingRevision: "15",
          updatedAt: openedAt
        },
        error: {
          code: "route.runtime_unavailable" as const,
          retryability: "retryable_same_route" as const,
          diagnostic: null
        },
        dispatchAfter: before,
        failedAt: runtimeFailedAt
      });
    expect(
      inboxV2OutboundDispatchRouteFailureCommitSchema.safeParse(runtimeFailure)
        .success
    ).toBe(true);
    expect(runtimeFailure.dispatchAfter).toMatchObject({
      route: before.route,
      state: "queued",
      attemptCount: 0,
      activeAttempt: null,
      lastAttempt: null,
      revision: "1"
    });
    const runtimeRetryDelay = (intentId: string) => {
      const finalization = deriveInboxV2RouteFailureOutboxFinalization({
        intentId: inboxV2OutboxIntentIdSchema.parse(intentId),
        commit: runtimeFailure
      });
      if (finalization.kind !== "retry") {
        throw new Error("Runtime-unavailable route must remain retryable.");
      }
      return finalization.retryAfterSeconds;
    };
    const retryDelays = Array.from({ length: 32 }, (_, index) =>
      runtimeRetryDelay(`outbox-intent:runtime-unavailable-${index}`)
    );
    expect(retryDelays.every((delay) => delay >= 5 && delay <= 60)).toBe(true);
    expect(new Set(retryDelays).size).toBeGreaterThan(1);
    expect(runtimeRetryDelay("outbox-intent:runtime-unavailable-0")).toBe(
      retryDelays[0]
    );

    for (const invalid of [
      {
        ...valid,
        error: {
          code: "route.inactive",
          retryability: "terminal",
          diagnostic: null
        }
      },
      { ...valid, failedByTrustedServiceId: "core:unrelated-worker" },
      {
        ...valid,
        bindingHeadSnapshot: bindingHead(),
        error: {
          code: "route.binding_changed",
          retryability: "retryable_resolution",
          diagnostic: null
        }
      },
      {
        ...runtimeFailure,
        bindingHeadSnapshot: bindingHead({ runtimeState: "ready" })
      },
      {
        ...runtimeFailure,
        dispatchAfter: {
          ...runtimeFailure.dispatchAfter,
          state: "terminal_failure" as const
        }
      }
    ]) {
      expect(
        inboxV2OutboundDispatchRouteFailureCommitSchema.safeParse(invalid)
          .success
      ).toBe(false);
    }
  });

  it("binds explicit reroute to one exact pre-I/O cancellation and distinct replacement", () => {
    const valid = rerouteCommit();
    expect(
      inboxV2OutboundDispatchRerouteCommitSchema.safeParse(valid).success
    ).toBe(true);

    const before = valid.original.dispatchBefore;
    for (const invalid of [
      {
        ...valid,
        replacement: {
          ...valid.replacement,
          message: { ...valid.replacement.message, tenantId: otherTenantId }
        }
      },
      {
        ...valid,
        original: {
          ...valid.original,
          dispatchAfter: {
            ...valid.original.dispatchAfter,
            id: "outbound_dispatch:forged-after"
          }
        }
      },
      {
        ...valid,
        original: {
          ...valid.original,
          dispatchAfter: {
            ...valid.original.dispatchAfter,
            state: "terminal_failure" as const
          }
        }
      },
      {
        ...valid,
        replacement: { ...valid.replacement, message: before.message }
      },
      {
        ...valid,
        replacement: { ...valid.replacement, route: before.route }
      },
      {
        ...valid,
        replacement: {
          ...valid.replacement,
          dispatch: dispatchReference
        }
      },
      {
        ...valid,
        replacement: {
          ...valid.replacement,
          outboxIntentId: valid.original.outboxIntentId
        }
      },
      { ...valid, changedAt: providerCompletedAt },
      { ...valid, extra: true }
    ]) {
      expect(
        inboxV2OutboundDispatchRerouteCommitSchema.safeParse(invalid).success
      ).toBe(false);
    }
  });

  it("keeps one normal dispatch pinned to one route and separate multi-send", () => {
    const dispatch = queuedDispatch();
    expect(inboxV2OutboundDispatchSchema.safeParse(dispatch).success).toBe(
      true
    );
    for (const invalid of [
      { ...dispatch, routes: [routeReference] },
      { ...dispatch, route: { ...routeReference, tenantId: otherTenantId } },
      {
        ...dispatch,
        retryAuthorization: reference(
          "outbound_dispatch_reconciliation_decision",
          "outbound_dispatch_reconciliation_decision:unexpected"
        )
      }
    ]) {
      expect(inboxV2OutboundDispatchSchema.safeParse(invalid).success).toBe(
        false
      );
    }

    const multiSend = multiSendOperation();
    expect(
      inboxV2OutboundMultiSendOperationSchema.safeParse(multiSend).success
    ).toBe(true);
    expect(
      inboxV2OutboundMultiSendOperationSchema.safeParse({
        ...multiSend,
        children: [multiSend.children[0]]
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundMultiSendOperationSchema.safeParse({
        ...multiSend,
        children: [multiSend.children[0], multiSend.children[0]]
      }).success
    ).toBe(false);
  });

  it("keeps an accepted artifact immutable and links its reference later", () => {
    const association = artifactAssociation("provider_response");
    expect(
      inboxV2SourceOccurrenceResolutionCommitSchema.safeParse(
        association.occurrenceResolution
      ).success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchArtifactSchema.safeParse(association.artifact)
        .success
    ).toBe(true);
    expect(
      inboxV2OutboundDispatchArtifactSchema.safeParse({
        ...association.artifact,
        externalMessageReference: association.link.externalMessageReference
      }).success
    ).toBe(false);
    expect(
      inboxV2OutboundDispatchArtifactAssociationCommitSchema.safeParse(
        association
      ).success
    ).toBe(true);
  });

  it("derives stable artifact identities from the exact attempt chain and ordinal", () => {
    const attempt = pendingAttempt();
    const identity = {
      tenantId,
      dispatch: dispatchReference,
      route: routeReference,
      attempt: {
        tenantId,
        kind: "outbound_dispatch_attempt" as const,
        id: attempt.id
      },
      ordinal: 1
    };
    const first = deriveInboxV2OutboundDispatchArtifactId(identity);
    expect(first).toMatch(/^outbound_dispatch_artifact:[a-f0-9]{64}$/u);
    expect(deriveInboxV2OutboundDispatchArtifactId(identity)).toBe(first);
    expect(
      deriveInboxV2OutboundDispatchArtifactId({ ...identity, ordinal: 2 })
    ).not.toBe(first);
    expect(() =>
      deriveInboxV2OutboundDispatchArtifactId({
        ...identity,
        dispatch: { ...dispatchReference, tenantId: otherTenantId }
      })
    ).toThrow();
  });

  it("accepts provider response or echo arrival order on the exact attempt", () => {
    const responseFirst = artifactAssociation("provider_response");
    const echoBeforeCompletion = artifactAssociation("provider_echo");
    expect(
      inboxV2OutboundDispatchArtifactAssociationCommitSchema.safeParse(
        responseFirst
      ).success
    ).toBe(true);
    expect(responseFirst.attempt.outcome.kind).toBe("accepted");
    expect(
      inboxV2OutboundDispatchArtifactAssociationCommitSchema.safeParse(
        echoBeforeCompletion
      ).success
    ).toBe(true);
    expect(echoBeforeCompletion.attempt.outcome.kind).toBe("pending");
  });

  it("rejects wrong same-tenant artifact route/reference and link authority", () => {
    const valid = artifactAssociation("provider_response");
    for (const invalid of [
      {
        ...valid,
        link: {
          ...valid.link,
          route: reference("outbound_route", "outbound_route:other")
        }
      },
      {
        ...valid,
        link: {
          ...valid.link,
          externalMessageReference: reference(
            "external_message_reference",
            "external_message_reference:other"
          )
        }
      },
      {
        ...valid,
        link: {
          ...valid.link,
          linkedByTrustedServiceId: "core:unrelated-linker"
        }
      },
      {
        ...valid,
        artifact: { ...valid.artifact, tenantId: otherTenantId }
      }
    ]) {
      expect(
        inboxV2OutboundDispatchArtifactAssociationCommitSchema.safeParse(
          invalid
        ).success
      ).toBe(false);
    }
  });

  it("binds dispatch recovery and artifact contracts to exact v1 envelopes", () => {
    expect(INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_VERSION).toBe(
      INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION
    );
    const pending = pendingAttempt();
    const attempting = attemptingDispatch(queuedDispatch(), pending);
    const unknown = unknownAttempt(pending);
    const unknownState = unknownDispatch(attempting, unknown);
    const decision = automaticRetryDecision(unknown);
    const reconciled = reconciledDispatch(unknownState, decision);
    const routeFailureBefore = queuedDispatch();
    const routeFailure = {
      tenantId,
      routeSnapshot,
      bindingHeadSnapshot: bindingHead({
        fence: { ...bindingFence, bindingGeneration: "2" }
      }),
      error: {
        code: "route.binding_changed",
        retryability: "retryable_resolution",
        diagnostic: null
      },
      dispatchBefore: routeFailureBefore,
      dispatchAfter: {
        ...routeFailureBefore,
        state: "terminal_failure",
        revision: "2",
        updatedAt: openedAt
      },
      failedByTrustedServiceId: "core:source-runtime",
      failedAt: openedAt
    };
    const association = artifactAssociation("provider_response");
    const cases: Array<{
      schema: { safeParse(input: unknown): { success: boolean } };
      schemaId: string;
      payload: unknown;
    }> = [
      {
        schema: inboxV2OutboundDispatchEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_ID,
        payload: queuedDispatch()
      },
      {
        schema: inboxV2OutboundDispatchAttemptEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_SCHEMA_ID,
        payload: pending
      },
      {
        schema: inboxV2OutboundDispatchAttemptCommitEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_ATTEMPT_COMMIT_SCHEMA_ID,
        payload: openCommit({ attempt: pending, dispatchAfter: attempting })
      },
      {
        schema: inboxV2OutboundDispatchReconciliationDecisionEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_DECISION_SCHEMA_ID,
        payload: decision
      },
      {
        schema: inboxV2OutboundDispatchReconciliationCommitEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_RECONCILIATION_COMMIT_SCHEMA_ID,
        payload: {
          tenantId,
          dispatchBefore: unknownState,
          decision,
          dispatchAfter: reconciled
        }
      },
      {
        schema: inboxV2OutboundDispatchRouteFailureCommitEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_ROUTE_FAILURE_COMMIT_SCHEMA_ID,
        payload: routeFailure
      },
      {
        schema: inboxV2OutboundDispatchRerouteCommitEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_REROUTE_COMMIT_SCHEMA_ID,
        payload: rerouteCommit()
      },
      {
        schema: inboxV2OutboundDispatchArtifactEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_SCHEMA_ID,
        payload: association.artifact
      },
      {
        schema: inboxV2OutboundDispatchArtifactReferenceLinkEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_REFERENCE_LINK_SCHEMA_ID,
        payload: association.link
      },
      {
        schema: inboxV2OutboundDispatchArtifactAssociationCommitEnvelopeSchema,
        schemaId:
          INBOX_V2_OUTBOUND_DISPATCH_ARTIFACT_ASSOCIATION_COMMIT_SCHEMA_ID,
        payload: association
      },
      {
        schema: inboxV2OutboundMultiSendOperationEnvelopeSchema,
        schemaId: INBOX_V2_OUTBOUND_MULTI_SEND_OPERATION_SCHEMA_ID,
        payload: multiSendOperation()
      }
    ];
    for (const { schema, schemaId, payload } of cases) {
      const envelope = {
        schemaId,
        schemaVersion: INBOX_V2_OUTBOUND_DISPATCH_SCHEMA_VERSION,
        payload
      };
      expect(schema.safeParse(envelope).success).toBe(true);
      expect(
        schema.safeParse({ ...envelope, schemaVersion: "v2" }).success
      ).toBe(false);
      expect(schema.safeParse({ ...envelope, future: true }).success).toBe(
        false
      );
    }
  });
});
