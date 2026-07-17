import {
  inboxV2ResolvedSourceConversationContextSchema,
  type InboxV2ResolvedSourceConversationContext,
  type InboxV2SourceMessageAdapterReconciliationDescriptor
} from "@hulee/contracts";

export const reconciliationT0 = "2026-07-17T08:00:00.000Z";
export const reconciliationT1 = "2026-07-17T08:01:00.000Z";
export const reconciliationT2 = "2026-07-17T08:02:00.000Z";
export const reconciliationT3 = "2026-07-17T08:03:00.000Z";
export const reconciliationT4 = "2026-07-17T08:04:00.000Z";
export const reconciliationT5 = "2026-07-17T08:05:00.000Z";
export const reconciliationT6 = "2026-07-17T09:00:00.000Z";

export const reconciliationAdapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:direct-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: reconciliationT0
} as const;

export function makeResolvedReconciliationContext(
  accountSuffix = "a"
): InboxV2ResolvedSourceConversationContext {
  const tenantId = "tenant:alpha";
  const sourceConnection = {
    tenantId,
    kind: "source_connection" as const,
    id: `source_connection:synthetic-${accountSuffix}`
  };
  const sourceAccount = {
    tenantId,
    kind: "source_account" as const,
    id: `source_account:synthetic-${accountSuffix}`
  };
  const rawInboundEvent = {
    tenantId,
    kind: "raw_inbound_event" as const,
    id: `raw_inbound_event:synthetic-${accountSuffix}`
  };
  const normalizedInboundEvent = {
    tenantId,
    kind: "normalized_inbound_event" as const,
    id: `normalized_inbound_event:synthetic-${accountSuffix}`
  };
  const conversationId = "conversation:provider-group";
  const externalThreadId = "external_thread:provider-group";
  const bindingId = `source_thread_binding:synthetic-${accountSuffix}`;
  const episodeId = `source_thread_binding_remote_access_episode:synthetic-${accountSuffix}`;
  const threadKey = {
    realm: {
      realmId: "module:synthetic-source:thread-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1"
    },
    scope: { kind: "provider" as const },
    objectKindId: "module:synthetic-source:group-room",
    canonicalExternalSubject: "Provider-Group:Case-Sensitive"
  };
  const threadDeclaration = {
    adapterContract: reconciliationAdapterContract,
    identityKind: "external_thread" as const,
    realmId: threadKey.realm.realmId,
    realmVersion: threadKey.realm.realmVersion,
    canonicalizationVersion: threadKey.realm.canonicalizationVersion,
    objectKindId: threadKey.objectKindId,
    scopeKind: "provider" as const,
    decisionStrength: "authoritative" as const
  };
  const source = {
    tenantId,
    rawInboundEvent,
    normalizedInboundEvent,
    sourceConnection,
    sourceAccount,
    domain: "core:inbox-v2.normalized-event-safe-envelope" as const,
    schemaId: "core:inbox-v2.normalized-event-envelope" as const,
    schemaVersion: "v1" as const,
    safeEnvelopeHmacSha256: `hmac-sha256:${"a".repeat(64)}`,
    adapterContract: reconciliationAdapterContract,
    thread: {
      sourceConnection,
      sourceAccount,
      identityDeclaration: threadDeclaration,
      key: threadKey,
      observedExternalSubject: threadKey.canonicalExternalSubject
    },
    recordedAt: reconciliationT2
  };
  const routeDescriptor = {
    adapterContract: reconciliationAdapterContract,
    descriptorSchemaId: "module:synthetic-source:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:provider-group",
    destinationSubject: "Provider-Group:Route",
    attributes: [],
    descriptorDigestSha256: "b".repeat(64)
  };
  const plan = {
    source,
    topology: "group" as const,
    purposeId: "core:chat",
    routeDescriptor,
    candidateConversationId: conversationId,
    candidateExternalThreadId: externalThreadId,
    candidateSourceThreadBindingId: bindingId,
    candidateRemoteAccessEpisodeId: episodeId,
    capabilityEntries: [],
    historySyncState: "not_started" as const,
    namespaceGeneration: "namespace-generation-v1",
    materializedByTrustedServiceId: "core:source-runtime",
    materializationToken: `materialization:synthetic-${accountSuffix}`,
    materializedAt: reconciliationT3
  };
  const conversation = {
    tenantId,
    id: conversationId,
    topology: "group" as const,
    transport: "external" as const,
    purposeId: "core:chat",
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: reconciliationT3,
      updatedAt: reconciliationT3
    },
    revision: "1",
    createdAt: reconciliationT3,
    updatedAt: reconciliationT3
  };
  const externalThread = {
    tenantId,
    id: externalThreadId,
    key: threadKey,
    identityDeclaration: threadDeclaration,
    conversation: {
      tenantId,
      kind: "conversation" as const,
      id: conversationId
    },
    conversationTopology: "group" as const,
    revision: "1",
    createdAt: reconciliationT3,
    updatedAt: reconciliationT3
  };
  const accountIdentitySnapshot = {
    status: "verified" as const,
    sourceConnection,
    sourceAccount,
    declaration: {
      adapterContract: reconciliationAdapterContract,
      identityKind: "source_account" as const,
      realmId: "module:synthetic-source:account-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:user-account",
      scopeKind: "source_connection" as const,
      decisionStrength: "authoritative" as const
    },
    realmId: "module:synthetic-source:account-realm",
    canonicalExternalSubject: `Account:${accountSuffix}`,
    accountGeneration: "1",
    verificationEvidence: [rawInboundEvent],
    verifiedAt: reconciliationT2
  };
  const binding = {
    tenantId,
    id: bindingId,
    externalThread: {
      tenantId,
      kind: "external_thread" as const,
      id: externalThreadId
    },
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot,
    bindingGeneration: "1",
    remoteAccess: {
      state: "observed" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: reconciliationT3,
      evidence: [normalizedInboundEvent]
    },
    administrative: {
      state: "disabled" as const,
      revision: "1",
      changedAt: reconciliationT3
    },
    runtimeHealth: {
      state: "unknown" as const,
      revision: "1",
      checkedAt: reconciliationT3,
      diagnostic: null
    },
    historySync: {
      state: "not_started" as const,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: reconciliationT3,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [],
      evidence: [normalizedInboundEvent],
      observedAt: reconciliationT3
    },
    capabilities: {
      adapterContract: reconciliationAdapterContract,
      revision: "1",
      capturedAt: reconciliationT3,
      entries: []
    },
    routeDescriptor,
    revision: "1",
    createdAt: reconciliationT3,
    updatedAt: reconciliationT3
  };
  const episode = {
    tenantId,
    id: episodeId,
    binding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: bindingId
    },
    state: "observed" as const,
    startedAt: reconciliationT3,
    endedAt: null,
    startEvidence: [normalizedInboundEvent],
    endEvidence: [],
    revision: "1",
    createdAt: reconciliationT3,
    updatedAt: reconciliationT3
  };

  return inboxV2ResolvedSourceConversationContextSchema.parse({
    outcome: "resolved",
    plan,
    threadResolution: accountSuffix === "a" ? "created" : "matched_canonical",
    bindingResolution: "created",
    matchedAlias: null,
    externalThreadMapping: {
      tenantId,
      thread: externalThread,
      conversation
    },
    sourceThreadBinding: {
      binding,
      currentRemoteAccessEpisode: episode
    },
    resolvedAt: reconciliationT4
  });
}

export function makeMessageReconciliationDescriptor(
  context = makeResolvedReconciliationContext(),
  input: {
    subject?: string;
    scopeKind?: "provider_thread" | "source_account" | "source_thread_binding";
    origin?: "webhook" | "poll" | "history" | "provider_echo";
    direction?: "inbound" | "outbound";
    intent?: "message_create" | "echo_handoff" | "source_action";
    weakEvidence?: boolean;
  } = {}
): InboxV2SourceMessageAdapterReconciliationDescriptor {
  const source = context.plan.source;
  const binding = context.sourceThreadBinding.binding;
  const scopeKind = input.scopeKind ?? "provider_thread";
  const origin = input.origin ?? "webhook";
  const direction =
    input.direction ?? (origin === "provider_echo" ? "outbound" : "inbound");
  const occurrence = {
    origin: { kind: origin },
    descriptor: {
      adapterContract: source.adapterContract,
      descriptorSchemaId: "module:synthetic-source:message-observation",
      descriptorVersion: "v1",
      capabilityRevision: "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:message-id",
          subject: input.subject ?? "Message:Exact-42"
        }
      ],
      descriptorDigestSha256: "c".repeat(64)
    },
    providerActor:
      direction === "inbound"
        ? {
            kind: "source_external_identity" as const,
            sourceExternalIdentity: {
              tenantId: source.tenantId,
              kind: "source_external_identity" as const,
              id: "source_external_identity:actor-1"
            }
          }
        : null,
    direction,
    providerTimestamps: [
      {
        kindId: "module:synthetic-source:sent-at",
        timestamp: reconciliationT1
      }
    ],
    referencePortability: {
      kind:
        scopeKind === "provider_thread"
          ? ("external_thread" as const)
          : ("binding_only" as const),
      adapterContract: source.adapterContract,
      decisionStrength:
        scopeKind === "provider_thread"
          ? ("authoritative" as const)
          : ("safe_default" as const)
    },
    observedAt: reconciliationT1
  };
  const messageIdentityDeclaration = {
    adapterContract: source.adapterContract,
    identityKind: "message" as const,
    realmId: "module:synthetic-source:message-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:synthetic-source:chat-message",
    scopeKind,
    decisionStrength:
      scopeKind === "provider_thread"
        ? ("authoritative" as const)
        : ("safe_default" as const)
  };
  const normalizedEvent = source.normalizedInboundEvent;
  const sourceAction = {
    kind: "source_action" as const,
    action: {
      kind: "edit" as const,
      normalizedEvent,
      normalizedContentDigestSha256: "d".repeat(64)
    },
    semanticProof: {
      tenantId: source.tenantId,
      normalizedInboundEvent: normalizedEvent,
      externalMessageReference: null,
      sourceOccurrence: null,
      sourceAccount: source.sourceAccount,
      sourceThreadBinding: {
        tenantId: source.tenantId,
        kind: "source_thread_binding" as const,
        id: binding.id
      },
      bindingGeneration: binding.bindingGeneration,
      adapterContract: source.adapterContract,
      capabilityId: "module:synthetic-source:message-edit",
      capabilityRevision: "1",
      semanticId: "core:message.lifecycle.edit.observed",
      semanticRevision: "1",
      actor:
        occurrence.providerActor?.kind === "source_external_identity"
          ? occurrence.providerActor.sourceExternalIdentity
          : null,
      ordering: {
        kind: "monotonic_exact" as const,
        scopeToken: "ordering:message-42",
        position: "2",
        comparatorId: "module:synthetic-source:provider-sequence",
        comparatorRevision: "1"
      },
      declaredByTrustedServiceId: "core:source-runtime",
      proofToken: "proof:message-edit-42",
      occurredAt: reconciliationT1,
      recordedAt: reconciliationT2,
      revision: "1" as const
    },
    eventFingerprintSha256: "e".repeat(64)
  };
  const intent =
    input.intent === "source_action"
      ? sourceAction
      : input.intent === "echo_handoff"
        ? {
            kind: "echo_handoff" as const,
            transportRole: "provider_echo" as const
          }
        : {
            kind: "message_create" as const,
            transportRole:
              direction === "outbound"
                ? ("native_outbound" as const)
                : ("origin" as const)
          };

  return {
    messageIdentityDeclaration,
    canonicalExternalSubject: input.subject ?? "Message:Exact-42",
    occurrence,
    intent,
    weakCorrelationEvidence: input.weakEvidence
      ? [
          {
            codeId: "core:weak-content-time-correlation",
            evidenceHmacSha256: `hmac-sha256:${"f".repeat(64)}`,
            expiresAt: reconciliationT6
          }
        ]
      : []
  } as InboxV2SourceMessageAdapterReconciliationDescriptor;
}
