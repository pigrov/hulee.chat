import type { z } from "zod";

import { inboxV2TimelineContentHeadOf } from "./message-content";
import { inboxV2OutboundRouteSchema } from "./outbound-route";
import { inboxV2TimelineItemSchema } from "./timeline";

export const fixtureTenantId = "tenant:tenant-1";
export const fixtureOtherTenantId = "tenant:tenant-2";
export const fixtureT0 = "2026-07-11T09:00:00.000Z";
export const fixtureT1 = "2026-07-11T09:01:00.000Z";
export const fixtureT2 = "2026-07-11T09:02:00.000Z";
export const fixtureT3 = "2026-07-11T09:03:00.000Z";
export const fixtureT4 = "2026-07-11T10:00:00.000Z";

export function fixtureReference<const TKind extends string>(
  kind: TKind,
  id: string,
  tenantId = fixtureTenantId
) {
  return { tenantId, kind, id };
}

export const fixtureConversationReference = fixtureReference(
  "conversation",
  "conversation:conversation-1"
);
export const fixtureTimelineItemReference = fixtureReference(
  "timeline_item",
  "timeline_item:item-1"
);
export const fixtureMessageReference = fixtureReference(
  "message",
  "message:message-1"
);
export const fixtureEmployeeReference = fixtureReference(
  "employee",
  "employee:employee-1"
);
export const fixtureSourceIdentityReference = fixtureReference(
  "source_external_identity",
  "source_external_identity:actor-1"
);
export const fixtureSourceOccurrenceReference = fixtureReference(
  "source_occurrence",
  "source_occurrence:occurrence-1"
);
export const fixtureExternalMessageReference = fixtureReference(
  "external_message_reference",
  "external_message_reference:reference-1"
);
export const fixtureBindingReference = fixtureReference(
  "source_thread_binding",
  "source_thread_binding:binding-1"
);
export const fixtureSourceAccountReference = fixtureReference(
  "source_account",
  "source_account:account-1"
);
export const fixtureSourceConnectionReference = fixtureReference(
  "source_connection",
  "source_connection:connection-1"
);
export const fixtureExternalThreadReference = fixtureReference(
  "external_thread",
  "external_thread:thread-1"
);
export const fixtureRouteReference = fixtureReference(
  "outbound_route",
  "outbound_route:route-1"
);

export function fixtureSourceIdentityClaim() {
  return {
    tenantId: fixtureTenantId,
    id: "source_identity_claim:claim-1",
    sourceExternalIdentity: fixtureSourceIdentityReference,
    previousClaimVersion: null,
    claimVersion: "1",
    target: {
      kind: "employee" as const,
      employee: fixtureEmployeeReference
    },
    status: "active" as const,
    confidence: "verified" as const,
    evidenceReferences: [
      {
        kind: "source_occurrence" as const,
        reference: fixtureSourceOccurrenceReference
      }
    ],
    policyId: "core:verified-source-identity",
    policyVersion: "v1",
    reasonCodeId: "core:operator-reviewed",
    decision: {
      kind: "automatic_policy" as const,
      trustedServiceId: "core:identity-service",
      reviewState: "not_required" as const,
      policyAuthority: {
        family: "source_identity_claim" as const,
        definitionContractVersion: "v1",
        definitionDigestSha256: "a".repeat(64),
        activationHeadRevision: "1"
      }
    },
    createdAt: fixtureT0,
    revocation: null,
    revision: "1"
  };
}

export const fixtureEmployeeActor = {
  kind: "employee" as const,
  employee: fixtureEmployeeReference,
  authorizationEpoch: "authorization:employee-epoch-1"
};

export const fixtureAdapterContract = {
  contractId: "module:synthetic:direct-account-adapter",
  contractVersion: "v1",
  declarationRevision: "7",
  surfaceId: "module:synthetic:direct-account",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: fixtureT0
} as const;

export function fixtureConversation(
  transport: "internal" | "external" = "external",
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId: fixtureTenantId,
    id: fixtureConversationReference.id,
    topology: "group",
    transport,
    purposeId: "core:chat",
    lifecycle: "active",
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: fixtureT0,
      updatedAt: fixtureT0
    },
    revision: "1",
    createdAt: fixtureT0,
    updatedAt: fixtureT0,
    ...overrides
  };
}

export function fixtureExternalThreadMapping() {
  const conversation = fixtureConversation("external");
  const key = {
    realm: {
      realmId: "module:synthetic:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: {
      kind: "source_account" as const,
      owner: fixtureSourceAccountReference
    },
    objectKindId: "module:synthetic:group-room",
    canonicalExternalSubject: "Group-1"
  };
  return {
    tenantId: fixtureTenantId,
    thread: {
      tenantId: fixtureTenantId,
      id: fixtureExternalThreadReference.id,
      key,
      identityDeclaration: {
        adapterContract: fixtureAdapterContract,
        identityKind: "external_thread" as const,
        realmId: key.realm.realmId,
        realmVersion: key.realm.realmVersion,
        canonicalizationVersion: key.realm.canonicalizationVersion,
        objectKindId: key.objectKindId,
        scopeKind: key.scope.kind,
        decisionStrength: "safe_default" as const
      },
      conversation: fixtureConversationReference,
      conversationTopology: "group" as const,
      revision: "1",
      createdAt: fixtureT0,
      updatedAt: fixtureT0
    },
    conversation
  };
}

export function fixtureParticipant(
  subject: "employee" | "source" | "bot" | "legacy" = "employee",
  overrides: Record<string, unknown> = {}
) {
  const participantSubject =
    subject === "employee"
      ? { kind: "employee" as const, employee: fixtureEmployeeReference }
      : subject === "source"
        ? {
            kind: "source_external_identity" as const,
            sourceExternalIdentity: fixtureSourceIdentityReference
          }
        : subject === "bot"
          ? {
              kind: "bot" as const,
              bot: fixtureReference("bot_identity", "bot_identity:bot-1")
            }
          : {
              kind: "legacy_unknown" as const,
              provenanceCodeId: "core:legacy-unknown"
            };
  return {
    tenantId: fixtureTenantId,
    id: `conversation_participant:${subject}-1`,
    conversation: fixtureConversationReference,
    subject: participantSubject,
    revision: "1",
    createdAt: fixtureT0,
    updatedAt: fixtureT0,
    ...overrides
  };
}

export function fixtureContent(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: fixtureTenantId,
    id: "timeline_content:content-1",
    state: {
      kind: "available" as const,
      blocks: [
        {
          blockKey: "body-1",
          kind: "text" as const,
          role: "body" as const,
          text: "Hello",
          language: "en"
        }
      ],
      contentDigestSha256: "a".repeat(64)
    },
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2,
    ...overrides
  };
}

export function fixtureTimelineItem(
  transport: "internal" | "external" = "external",
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId: fixtureTenantId,
    id: fixtureTimelineItemReference.id,
    conversation: fixtureConversationReference,
    timelineSequence: "1",
    subject: {
      kind: "message" as const,
      message: fixtureMessageReference,
      messageRevision: "1"
    },
    visibility:
      transport === "external"
        ? ("conversation_external" as const)
        : ("internal_participants" as const),
    activity: { kind: "eligible" as const },
    occurredAt: fixtureT1,
    receivedAt: fixtureT2,
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2,
    ...overrides
  };
}

export function fixtureTimelineAllocation(
  transport: "internal" | "external" = "external",
  item: z.input<typeof inboxV2TimelineItemSchema> = fixtureTimelineItem(
    transport
  )
) {
  const conversationBefore = fixtureConversation(transport);
  const latestActivity =
    item.activity.kind === "eligible"
      ? {
          latestActivityItemId: item.id,
          latestActivityTimelineSequence: item.timelineSequence,
          latestActivityAt: item.occurredAt
        }
      : {};
  return {
    tenantId: fixtureTenantId,
    conversationBefore,
    items: [item],
    conversationAfter: fixtureConversation(transport, {
      head: {
        ...conversationBefore.head,
        latestTimelineSequence: "1",
        ...latestActivity,
        revision: "2",
        updatedAt: fixtureT2
      }
    }),
    committedAt: fixtureT2
  };
}

export function fixtureMessage(
  origin: "internal" | "source" | "hulee" = "internal",
  content = fixtureContent(),
  overrides: Record<string, unknown> = {}
) {
  const messageOrigin =
    origin === "internal"
      ? { kind: "internal" as const }
      : origin === "source"
        ? {
            kind: "source_originated" as const,
            originOccurrence: fixtureSourceOccurrenceReference,
            direction: "inbound" as const,
            claimAtOccurrence: null
          }
        : {
            kind: "hulee_external" as const,
            outboundRoute: fixtureRouteReference
          };
  return {
    tenantId: fixtureTenantId,
    id: fixtureMessageReference.id,
    conversation: fixtureConversationReference,
    timelineItem: fixtureTimelineItemReference,
    authorParticipant:
      origin === "source"
        ? fixtureReference(
            "conversation_participant",
            "conversation_participant:source-1"
          )
        : fixtureReference(
            "conversation_participant",
            "conversation_participant:employee-1"
          ),
    origin: messageOrigin,
    appActor: origin === "source" ? null : fixtureEmployeeActor,
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content as never),
    referenceContext: { kind: "none" as const },
    lifecycle: { kind: "active" as const },
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2,
    ...overrides
  };
}

export function fixtureInitialMessageRevision(
  message = fixtureMessage(),
  overrides: Record<string, unknown> = {}
) {
  const sourceOccurrence =
    message.origin.kind === "source_originated"
      ? message.origin.originOccurrence
      : null;
  return {
    tenantId: fixtureTenantId,
    id: "message_revision:revision-1",
    message: fixtureMessageReference,
    timelineItem: fixtureTimelineItemReference,
    expectedPreviousRevision: null,
    messageRevision: "1",
    change: { kind: "created" as const, content: message.content },
    actionAttribution: {
      actionParticipant: message.authorParticipant,
      appActor: message.appActor,
      sourceOccurrence,
      automationCausation: message.automationCausation
    },
    occurredAt: fixtureT1,
    recordedAt: fixtureT2,
    recordRevision: "1" as const,
    createdAt: fixtureT2,
    ...overrides
  };
}

export function fixtureMessageKey(subject = "provider-message-42") {
  return {
    realm: {
      realmId: "module:synthetic:message-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider_thread" as const },
    objectKindId: "module:synthetic:chat-message",
    externalThread: fixtureExternalThreadReference,
    canonicalExternalSubject: subject
  };
}

export function fixtureOccurrence(
  input: {
    origin?: "webhook" | "history" | "provider_echo" | "provider_response";
    direction?: "inbound" | "outbound";
    recordedAt?: string;
    occurrenceId?: string;
    externalSubject?: string;
  } = {}
) {
  const originKind = input.origin ?? "webhook";
  const direction =
    input.direction ??
    (originKind === "webhook" || originKind === "history"
      ? "inbound"
      : "outbound");
  const recordedAt = input.recordedAt ?? fixtureT2;
  const occurrenceId =
    input.occurrenceId ?? fixtureSourceOccurrenceReference.id;
  const messageKey = fixtureMessageKey(input.externalSubject);
  const sourceAccount = fixtureSourceAccountReference;
  const origin =
    originKind === "provider_response"
      ? {
          kind: "provider_response" as const,
          sourceAccount,
          outboundDispatchAttempt: fixtureReference(
            "outbound_dispatch_attempt",
            "outbound_dispatch_attempt:attempt-1"
          )
        }
      : {
          kind: originKind,
          sourceAccount,
          rawInboundEvent: fixtureReference(
            "raw_inbound_event",
            `raw_inbound_event:${originKind}-1`
          ),
          normalizedInboundEvent: fixtureReference(
            "normalized_inbound_event",
            `normalized_inbound_event:${originKind}-1`
          )
        };
  const declaration = {
    adapterContract: fixtureAdapterContract,
    identityKind: "message" as const,
    realmId: messageKey.realm.realmId,
    realmVersion: messageKey.realm.realmVersion,
    canonicalizationVersion: messageKey.realm.canonicalizationVersion,
    objectKindId: messageKey.objectKindId,
    scopeKind: messageKey.scope.kind,
    decisionStrength: "authoritative" as const
  };
  return {
    tenantId: fixtureTenantId,
    id: occurrenceId,
    messageKey,
    messageIdentityDeclaration: declaration,
    bindingContext: {
      externalThread: fixtureExternalThreadReference,
      sourceAccount,
      sourceThreadBinding: fixtureBindingReference,
      bindingGeneration: "1"
    },
    origin,
    descriptor: {
      adapterContract: fixtureAdapterContract,
      descriptorSchemaId: "module:synthetic:message-observation",
      descriptorVersion: "v1",
      capabilityRevision: "1",
      providerReferences: [
        {
          kindId: "module:synthetic:message-id",
          subject: messageKey.canonicalExternalSubject
        }
      ],
      descriptorDigestSha256: "b".repeat(64)
    },
    providerActor:
      originKind === "webhook" || originKind === "history"
        ? {
            kind: "source_external_identity" as const,
            sourceExternalIdentity: fixtureSourceIdentityReference
          }
        : null,
    direction,
    providerTimestamps: [
      { kindId: "module:synthetic:sent-at", timestamp: fixtureT1 }
    ],
    referencePortability: {
      kind: "binding_only" as const,
      adapterContract: fixtureAdapterContract,
      decisionStrength: "safe_default" as const
    },
    resolution: {
      state: "resolved" as const,
      externalMessageReference: fixtureExternalMessageReference
    },
    observedAt: fixtureT1,
    recordedAt,
    revision: "2",
    createdAt: recordedAt,
    updatedAt: recordedAt
  };
}

export function fixtureProviderSemanticProof(input: {
  semanticId: string;
  capabilityId: string;
  capabilityRevision?: string;
  semanticRevision?: string;
  orderingPosition?: string;
  normalizedInboundEvent?: ReturnType<typeof fixtureReference>;
  externalMessageReference?: ReturnType<typeof fixtureReference> | null;
  sourceOccurrence?: ReturnType<typeof fixtureReference> | null;
  actor?: ReturnType<typeof fixtureReference> | null;
  occurredAt?: string;
  recordedAt?: string;
}) {
  return {
    tenantId: fixtureTenantId,
    normalizedInboundEvent:
      input.normalizedInboundEvent ??
      fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:webhook-1"
      ),
    externalMessageReference:
      input.externalMessageReference === undefined
        ? fixtureExternalMessageReference
        : input.externalMessageReference,
    sourceOccurrence:
      input.sourceOccurrence === undefined
        ? fixtureSourceOccurrenceReference
        : input.sourceOccurrence,
    sourceAccount: fixtureSourceAccountReference,
    sourceThreadBinding: fixtureBindingReference,
    bindingGeneration: "1",
    adapterContract: fixtureAdapterContract,
    capabilityId: input.capabilityId,
    capabilityRevision: input.capabilityRevision ?? "1",
    semanticId: input.semanticId,
    semanticRevision: input.semanticRevision ?? "1",
    actor: input.actor ?? null,
    ordering: {
      kind: "monotonic_exact" as const,
      scopeToken: "ordering:thread-1",
      position: input.orderingPosition ?? "1",
      comparatorId: "core:provider-sequence",
      comparatorRevision: "1"
    },
    declaredByTrustedServiceId: "core:source-runtime",
    proofToken: `proof:${input.semanticId}`,
    occurredAt: input.occurredAt ?? fixtureT2,
    recordedAt: input.recordedAt ?? fixtureT3,
    revision: "1" as const
  };
}

export function fixtureProviderSemanticOrderingCommit(
  proof: ReturnType<typeof fixtureProviderSemanticProof>,
  semanticFamilyId = "core:message.lifecycle",
  committedAt = proof.recordedAt
) {
  if (
    proof.externalMessageReference === null ||
    proof.ordering.kind !== "monotonic_exact"
  ) {
    throw new Error("Ordering fixture requires an exact monotonic proof.");
  }
  return {
    tenantId: fixtureTenantId,
    semanticFamilyId,
    before: null,
    proof,
    after: {
      tenantId: fixtureTenantId,
      semanticFamilyId,
      externalMessageReference: proof.externalMessageReference,
      sourceAccount: proof.sourceAccount,
      sourceThreadBinding: proof.sourceThreadBinding,
      bindingGeneration: proof.bindingGeneration,
      scopeToken: proof.ordering.scopeToken,
      comparatorId: proof.ordering.comparatorId,
      comparatorRevision: proof.ordering.comparatorRevision,
      position: proof.ordering.position,
      normalizedInboundEvent: proof.normalizedInboundEvent,
      proofToken: proof.proofToken,
      revision: "1",
      updatedAt: committedAt
    },
    committedAt
  };
}

export function fixtureExternalReference(
  occurrence = fixtureOccurrence(),
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId: fixtureTenantId,
    id: fixtureExternalMessageReference.id,
    key: occurrence.messageKey,
    identityDeclaration: occurrence.messageIdentityDeclaration,
    externalThread: fixtureExternalThreadReference,
    timelineItem: fixtureTimelineItemReference,
    message: fixtureMessageReference,
    revision: "1",
    createdAt: occurrence.recordedAt,
    ...overrides
  };
}

export function fixtureOccurrenceResolutionCommit(
  occurrence = fixtureOccurrence()
) {
  const resolvedReference = fixtureExternalReference(occurrence);
  const before = {
    ...occurrence,
    resolution: {
      state: "pending" as const,
      diagnostic: {
        codeId: "core:source-reference-pending",
        retryable: true,
        correlationToken: "correlation:source-reference-pending",
        safeOperatorHintId: null
      }
    },
    revision: "1"
  };
  return {
    tenantId: fixtureTenantId,
    expectedRevision: "1",
    resultingRevision: "2",
    changedAt: occurrence.updatedAt,
    resolver: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:source-runtime",
      resolutionToken: "resolution:source-occurrence-1"
    },
    before,
    after: occurrence,
    resolvedReference
  };
}

export function fixtureTransportLink(
  occurrence = fixtureOccurrence(),
  role:
    | "origin"
    | "native_outbound"
    | "provider_echo"
    | "provider_response" = "origin",
  linkedAt = occurrence.recordedAt
) {
  return {
    tenantId: fixtureTenantId,
    id: `message_transport_occurrence_link:${role}-1`,
    message: fixtureMessageReference,
    sourceOccurrence: fixtureReference("source_occurrence", occurrence.id),
    externalMessageReference: fixtureExternalMessageReference,
    role,
    revision: "1" as const,
    linkedAt
  };
}

export function fixtureRoute() {
  const principal = {
    kind: "employee" as const,
    employee: fixtureEmployeeReference
  };
  const bindingFence = {
    accountGeneration: "1",
    bindingGeneration: "1",
    remoteAccessRevision: "2",
    administrativeRevision: "3",
    capabilityRevision: "4",
    routeDescriptorRevision: "5"
  };
  const target = {
    conversation: fixtureConversationReference,
    externalThread: fixtureExternalThreadReference,
    sourceThreadBinding: fixtureBindingReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceConnection: fixtureSourceConnectionReference,
    operationId: "core:message.send",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:route-epoch-1",
    bindingFence,
    referenceTarget: { kind: "none" as const }
  };
  const decisionBase = {
    tenantId: fixtureTenantId,
    principal,
    target,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: fixtureT1,
    notAfter: fixtureT4
  };
  return {
    tenantId: fixtureTenantId,
    id: fixtureRouteReference.id,
    principal,
    conversation: fixtureConversationReference,
    externalThread: fixtureExternalThreadReference,
    sourceThreadBinding: fixtureBindingReference,
    sourceAccount: fixtureSourceAccountReference,
    sourceConnection: fixtureSourceConnectionReference,
    operationId: "core:message.send",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:route-epoch-1",
    requiredConversationPermissionId: "core:message.reply_external",
    bindingFence,
    adapterContract: fixtureAdapterContract,
    routeDescriptor: {
      adapterContract: fixtureAdapterContract,
      descriptorSchemaId: "module:synthetic:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "5",
      destinationKindId: "module:synthetic:group-peer",
      destinationSubject: "Group-1",
      attributes: [],
      descriptorDigestSha256: "c".repeat(64)
    },
    routePolicy: fixtureReference(
      "thread_route_policy",
      "thread_route_policy:policy-1"
    ),
    routePolicyRevision: "1",
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action" as const,
      requiredPermissionId: "core:message.reply_external",
      matchedPermissionIds: ["core:message.reply_external"],
      decisionToken: "decision:conversation-1"
    },
    sourceAccountAuthorization: {
      ...decisionBase,
      decisionKind: "source_account_use" as const,
      requiredPermissionId: "core:source_account.use",
      matchedPermissionIds: ["core:source_account.use"],
      decisionToken: "decision:source-account-1"
    },
    referenceContext: { kind: "none" as const },
    runtimeObservationAtResolution: {
      state: "ready" as const,
      revision: "1",
      observedAt: fixtureT1,
      diagnostic: null
    },
    selection: {
      intent: { kind: "automatic" as const },
      reason: "sole_eligible_binding" as const,
      candidateSnapshotToken: "snapshot:route-1",
      candidateSnapshotNotAfter: fixtureT4,
      fallbackPolicyOrdinal: null,
      selectedAt: fixtureT2
    },
    mutationToken: "mutation:route-1",
    idempotencyToken: "idempotency:route-1",
    correlationToken: "correlation:route-1",
    revision: "1",
    createdAt: fixtureT2
  };
}

export function fixtureOutboundBindingSnapshot(
  route:
    | ReturnType<typeof fixtureRoute>
    | z.input<typeof inboxV2OutboundRouteSchema> = fixtureRoute(),
  capabilityId = "core:message-text-send"
) {
  const rawEvidence = fixtureReference(
    "raw_inbound_event",
    "raw_inbound_event:binding-1"
  );
  return {
    tenantId: fixtureTenantId,
    id: route.sourceThreadBinding.id,
    externalThread: route.externalThread,
    sourceConnection: route.sourceConnection,
    sourceAccount: route.sourceAccount,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: route.sourceConnection,
      sourceAccount: route.sourceAccount,
      declaration: {
        adapterContract: route.adapterContract,
        identityKind: "source_account" as const,
        realmId: "module:synthetic:account-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:synthetic:user-account",
        scopeKind: "source_connection" as const,
        decisionStrength: "authoritative" as const
      },
      realmId: "module:synthetic:account-realm",
      canonicalExternalSubject: "Account-1",
      accountGeneration: route.bindingFence.accountGeneration,
      verificationEvidence: [rawEvidence],
      verifiedAt: fixtureT0
    },
    bindingGeneration: route.bindingFence.bindingGeneration,
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: route.bindingFence.remoteAccessRevision,
      since: fixtureT0,
      evidence: [rawEvidence]
    },
    administrative: {
      state: "enabled" as const,
      revision: route.bindingFence.administrativeRevision,
      changedAt: fixtureT0
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: fixtureT1,
      diagnostic: null
    },
    historySync: {
      state: "live" as const,
      revision: "1",
      receiveCursor: "receive-cursor-1",
      historyCursor: "history-cursor-1",
      providerWatermark: "watermark-1",
      lastDurableRawEvent: rawEvidence,
      updatedAt: fixtureT1,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:synthetic:provider-member"],
      evidence: [rawEvidence],
      observedAt: fixtureT1
    },
    capabilities: {
      adapterContract: route.adapterContract,
      revision: route.bindingFence.capabilityRevision,
      capturedAt: fixtureT1,
      entries: [
        {
          capabilityId,
          operationId: route.operationId,
          contentKindId: route.contentKindId,
          state: "supported" as const,
          referencePortability: "external_thread" as const,
          requiredProviderRoleIds: ["module:synthetic:provider-member"],
          validUntil: null,
          diagnostic: null,
          evidence: [rawEvidence]
        }
      ]
    },
    routeDescriptor: route.routeDescriptor,
    revision: "1",
    createdAt: fixtureT0,
    updatedAt: fixtureT1
  };
}

export function fixtureExternalTargetRoute(
  operationId = "core:message.react",
  requiredPermissionId = "core:message.react_external",
  exactTarget: {
    occurrence: ReturnType<typeof fixtureOccurrence>;
    externalMessageReference: typeof fixtureExternalMessageReference;
  } | null = null
): z.input<typeof inboxV2OutboundRouteSchema> {
  const route = fixtureRoute();
  const occurrence = exactTarget?.occurrence ?? fixtureOccurrence();
  const externalMessageReference =
    exactTarget?.externalMessageReference ?? fixtureExternalMessageReference;
  const sourceOccurrence = fixtureReference("source_occurrence", occurrence.id);
  const referenceTarget = {
    kind: "external_message" as const,
    externalMessageReference,
    sourceOccurrence
  };
  const portability = occurrence.referencePortability;
  const resolutionDecision = {
    decisionKind: "external_message_reference_resolution" as const,
    tenantId: fixtureTenantId,
    externalThread: fixtureExternalThreadReference,
    externalMessageReference,
    sourceOccurrence,
    originBinding: fixtureBindingReference,
    originSourceAccount: fixtureSourceAccountReference,
    occurrenceRevision: occurrence.revision,
    occurrenceBindingGeneration: occurrence.bindingContext.bindingGeneration,
    portability,
    referenceWindow: { state: "not_applicable" as const },
    decisionToken: "decision:reference-target-1",
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:route-service",
    decidedAt: fixtureT1,
    notAfter: fixtureT4
  };
  const referenceContext = {
    kind: "external_message" as const,
    externalThread: fixtureExternalThreadReference,
    externalMessageReference,
    sourceOccurrence,
    originBinding: fixtureBindingReference,
    originSourceAccount: fixtureSourceAccountReference,
    portability,
    resolutionDecision
  };
  const target = {
    ...route.conversationAuthorization.target,
    operationId,
    contentKindId: null,
    referenceTarget
  };
  return {
    ...route,
    operationId,
    contentKindId: null,
    requiredConversationPermissionId: requiredPermissionId,
    conversationAuthorization: {
      ...route.conversationAuthorization,
      target,
      requiredPermissionId,
      matchedPermissionIds: [requiredPermissionId]
    },
    sourceAccountAuthorization: {
      ...route.sourceAccountAuthorization,
      target,
      requiredPermissionId: "core:source_account.use" as const
    },
    referenceContext,
    selection: {
      ...route.selection,
      intent: {
        kind: "explicit_occurrence" as const,
        occurrence: sourceOccurrence
      },
      reason: "explicit_occurrence" as const
    }
  };
}

export function fixtureDispatch() {
  return {
    tenantId: fixtureTenantId,
    id: "outbound_dispatch:dispatch-1",
    message: fixtureMessageReference,
    route: fixtureRouteReference,
    multiSendOperation: null,
    state: "queued" as const,
    attemptCount: 0,
    activeAttempt: null,
    lastAttempt: null,
    retryAuthorization: null,
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  };
}

export function fixtureAcceptedAttempt() {
  return {
    tenantId: fixtureTenantId,
    id: "outbound_dispatch_attempt:attempt-1",
    dispatch: fixtureReference(
      "outbound_dispatch",
      "outbound_dispatch:dispatch-1"
    ),
    route: fixtureRouteReference,
    attemptNumber: 1,
    claimToken: "claim:dispatch-attempt-1",
    retrySafety: {
      adapterContract: fixtureAdapterContract,
      declaredByTrustedServiceId: "core:source-runtime",
      declarationToken: "declaration:dispatch-attempt-1",
      declaredAt: fixtureT1,
      mechanism: "unsafe_or_unknown" as const,
      providerCorrelationToken: null,
      automaticRetryAllowed: false
    },
    leaseExpiresAt: fixtureT4,
    openedAt: fixtureT2,
    outcome: {
      kind: "accepted" as const,
      completedAt: fixtureT3,
      providerAcknowledgementToken: "provider:accepted-1"
    },
    completionSource: "provider_result" as const,
    revision: "2"
  };
}

export function fixtureAcceptedDispatch() {
  const attempt = fixtureAcceptedAttempt();
  return {
    ...fixtureDispatch(),
    state: "accepted" as const,
    attemptCount: 1,
    activeAttempt: null,
    lastAttempt: fixtureReference("outbound_dispatch_attempt", attempt.id),
    revision: "3",
    updatedAt: fixtureT3
  };
}

export function fixtureInternalCreationCommit() {
  const content = fixtureContent();
  const message = fixtureMessage("internal", content);
  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation(
      "internal",
      fixtureTimelineItem("internal")
    ),
    authorParticipant: fixtureParticipant("employee"),
    content,
    message,
    initialRevision: fixtureInitialMessageRevision(message),
    sourceOccurrence: null,
    claimAtOccurrenceSnapshot: null,
    sourceResolutionCommit: null,
    externalMessageReference: null,
    originTransportLink: null,
    originTransportLinkHead: null,
    externalThreadMapping: null,
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: null,
    outboundBindingSnapshot: null,
    outboundDispatch: null,
    routeConsumption: null
  };
}

export function fixtureSourceCreationCommit() {
  const content = fixtureContent();
  const occurrence = fixtureOccurrence();
  const message = fixtureMessage("source", content);
  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external"),
    authorParticipant: fixtureParticipant("source"),
    content,
    message,
    initialRevision: fixtureInitialMessageRevision(message),
    sourceOccurrence: occurrence,
    claimAtOccurrenceSnapshot: null,
    sourceResolutionCommit: fixtureOccurrenceResolutionCommit(occurrence),
    externalMessageReference: fixtureExternalReference(occurrence),
    originTransportLink: fixtureTransportLink(occurrence, "origin"),
    originTransportLinkHead: {
      tenantId: fixtureTenantId,
      message: fixtureMessageReference,
      linkCount: "1",
      latestLink: fixtureReference(
        "message_transport_occurrence_link",
        "message_transport_occurrence_link:origin-1"
      ),
      revision: "1",
      updatedAt: fixtureT2
    },
    externalThreadMapping: fixtureExternalThreadMapping(),
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: null,
    outboundBindingSnapshot: null,
    outboundDispatch: null,
    routeConsumption: null
  };
}

export function fixtureHuleeCreationCommit() {
  const content = fixtureContent();
  const message = fixtureMessage("hulee", content);
  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external"),
    authorParticipant: fixtureParticipant("employee"),
    content,
    message,
    initialRevision: fixtureInitialMessageRevision(message),
    sourceOccurrence: null,
    claimAtOccurrenceSnapshot: null,
    sourceResolutionCommit: null,
    externalMessageReference: null,
    originTransportLink: null,
    originTransportLinkHead: null,
    externalThreadMapping: fixtureExternalThreadMapping(),
    canonicalReferenceTargets: [],
    externalReferenceTargets: [],
    unresolvedReferenceTarget: null,
    providerReferenceSemantics: [],
    outboundRoute: fixtureRoute(),
    outboundBindingSnapshot: fixtureOutboundBindingSnapshot(),
    outboundDispatch: fixtureDispatch(),
    routeConsumption: {
      outboundRoute: fixtureRouteReference,
      message: fixtureMessageReference,
      mutationToken: "mutation:route-1",
      idempotencyToken: "idempotency:route-1",
      correlationToken: "correlation:route-1",
      consumedByTrustedServiceId: "core:source-runtime",
      consumedAt: fixtureT2,
      revision: "1" as const
    }
  };
}
