import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_COMMIT_SCHEMA_ID,
  INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_SCHEMA_VERSION,
  inboxV2SourceOccurrenceMaterializationCommitEnvelopeSchema,
  inboxV2SourceOccurrenceMaterializationCommitSchema
} from "./source-occurrence-materialization";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const routeAt = "2026-07-11T09:00:10.000Z";
const dispatchAt = "2026-07-11T09:00:20.000Z";
const attemptAt = "2026-07-11T09:00:30.000Z";
const attemptCompletedAt = "2026-07-11T09:00:40.000Z";
const observedAt = "2026-07-11T09:01:00.000Z";
const materializedAt = "2026-07-11T09:02:00.000Z";

const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:group-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt: t0
} as const;

function reference(kind: string, id: string, scopedTenantId = tenantId) {
  return { tenantId: scopedTenantId, kind, id };
}

const externalThreadReference = reference(
  "external_thread",
  "external_thread:thread-1"
);
const sourceConnectionReference = reference(
  "source_connection",
  "source_connection:connection-1"
);
const sourceAccountReference = reference(
  "source_account",
  "source_account:account-1"
);
const sourceThreadBindingReference = reference(
  "source_thread_binding",
  "source_thread_binding:binding-1"
);
const rawEventReference = reference(
  "raw_inbound_event",
  "raw_inbound_event:raw-1"
);
const normalizedEventReference = reference(
  "normalized_inbound_event",
  "normalized_inbound_event:normalized-1"
);

const accountDeclaration = {
  adapterContract,
  identityKind: "source_account" as const,
  realmId: "module:synthetic-source:account-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:user-account",
  scopeKind: "source_connection" as const,
  decisionStrength: "authoritative" as const
};

const messageDeclaration = {
  adapterContract,
  identityKind: "message" as const,
  realmId: "module:synthetic-source:message-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:chat-message",
  scopeKind: "provider_thread" as const,
  decisionStrength: "authoritative" as const
};

const threadDeclaration = {
  adapterContract,
  identityKind: "external_thread" as const,
  realmId: "module:synthetic-source:thread-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic-source:group-thread",
  scopeKind: "source_account" as const,
  decisionStrength: "safe_default" as const
};

function accountIdentitySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    status: "verified" as const,
    sourceConnection: sourceConnectionReference,
    sourceAccount: sourceAccountReference,
    declaration: accountDeclaration,
    realmId: accountDeclaration.realmId,
    canonicalExternalSubject: "ProviderAccount:ABC",
    accountGeneration: "1",
    verificationEvidence: [rawEventReference],
    verifiedAt: t0,
    ...overrides
  };
}

function routeDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    adapterContract,
    descriptorSchemaId: "module:synthetic-source:group-route",
    descriptorVersion: "v1",
    descriptorRevision: "1",
    destinationKindId: "module:synthetic-source:group-peer",
    destinationSubject: "GroupABC",
    attributes: [],
    descriptorDigestSha256: "a".repeat(64),
    ...overrides
  };
}

function binding(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: sourceThreadBindingReference.id,
    externalThread: externalThreadReference,
    sourceConnection: sourceConnectionReference,
    sourceAccount: sourceAccountReference,
    accountIdentitySnapshot: accountIdentitySnapshot(),
    bindingGeneration: "1",
    remoteAccess: {
      state: "active" as const,
      evidenceAuthority: "direct_observation" as const,
      revision: "1",
      since: t0,
      evidence: [rawEventReference]
    },
    administrative: {
      state: "enabled" as const,
      revision: "1",
      changedAt: t0
    },
    runtimeHealth: {
      state: "ready" as const,
      revision: "1",
      checkedAt: t0,
      diagnostic: null
    },
    historySync: {
      state: "live" as const,
      revision: "1",
      receiveCursor: "receive-cursor-1",
      historyCursor: "history-cursor-1",
      providerWatermark: "watermark-1",
      lastDurableRawEvent: rawEventReference,
      updatedAt: t0,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:synthetic-source:provider-member"],
      evidence: [rawEventReference],
      observedAt: t0
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: t0,
      entries: []
    },
    routeDescriptor: routeDescriptor(),
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function currentProjection(input?: {
  binding?: ReturnType<typeof binding>;
  bindingId?: string;
  episodeOverrides?: Record<string, unknown>;
}) {
  const bindingSnapshot = input?.binding ?? binding();
  const bindingId = input?.bindingId ?? bindingSnapshot.id;
  return {
    binding: bindingSnapshot,
    currentRemoteAccessEpisode: {
      tenantId,
      id: "source_thread_binding_remote_access_episode:episode-1",
      binding: reference("source_thread_binding", bindingId),
      state: bindingSnapshot.remoteAccess.state,
      startedAt: bindingSnapshot.remoteAccess.since,
      endedAt: null,
      startEvidence: bindingSnapshot.remoteAccess.evidence,
      endEvidence: [],
      revision: "1",
      createdAt: bindingSnapshot.remoteAccess.since,
      updatedAt: bindingSnapshot.remoteAccess.since,
      ...input?.episodeOverrides
    }
  };
}

function externalThreadMapping(input?: {
  scopeKind?: "provider" | "source_account" | "source_connection";
  ownerId?: string;
}) {
  const scopeKind = input?.scopeKind ?? "source_account";
  const scope =
    scopeKind === "provider"
      ? { kind: "provider" as const }
      : scopeKind === "source_connection"
        ? {
            kind: "source_connection" as const,
            owner: reference(
              "source_connection",
              input?.ownerId ?? sourceConnectionReference.id
            )
          }
        : {
            kind: "source_account" as const,
            owner: reference(
              "source_account",
              input?.ownerId ?? sourceAccountReference.id
            )
          };
  const conversation = {
    tenantId,
    id: "conversation:conversation-1",
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
      createdAt: t0,
      updatedAt: t0
    },
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  };
  return {
    tenantId,
    thread: {
      tenantId,
      id: externalThreadReference.id,
      key: {
        realm: {
          realmId: threadDeclaration.realmId,
          realmVersion: threadDeclaration.realmVersion,
          canonicalizationVersion: threadDeclaration.canonicalizationVersion
        },
        scope,
        objectKindId: threadDeclaration.objectKindId,
        canonicalExternalSubject: "ProviderGroup:ABC"
      },
      identityDeclaration: {
        ...threadDeclaration,
        scopeKind,
        decisionStrength:
          scopeKind === "provider"
            ? ("authoritative" as const)
            : threadDeclaration.decisionStrength
      },
      conversation: reference("conversation", conversation.id),
      conversationTopology: "group" as const,
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    },
    conversation
  };
}

function verifiedSourceAccountIdentity(
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId,
    sourceAccount: sourceAccountReference,
    sourceConnection: sourceConnectionReference,
    identityDeclaration: accountDeclaration,
    accountGeneration: "1",
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    state: "verified" as const,
    expectedCanonicalScope: null,
    provisionalIdentity: null,
    canonicalIdentity: {
      realm: {
        realmId: accountDeclaration.realmId,
        realmVersion: accountDeclaration.realmVersion,
        canonicalizationVersion: accountDeclaration.canonicalizationVersion,
        objectKindId: accountDeclaration.objectKindId
      },
      scope: {
        kind: "source_connection" as const,
        owner: sourceConnectionReference
      },
      canonicalExternalSubject: "ProviderAccount:ABC"
    },
    verifiedBy: {
      actor: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:source-runtime"
      },
      policyId: "core:provider-account-verification",
      policyVersion: "v1",
      reasonCodeId: "core:account-verified",
      verificationEvidenceToken: "evidence:account-verified-1",
      decidedAt: t0
    },
    conflict: null,
    ...overrides
  };
}

function occurrence(input?: {
  resolution?: "pending" | "resolved";
  originKind?: "webhook" | "provider_response";
  binding?: ReturnType<typeof sourceThreadBindingRef>;
  sourceAccount?: ReturnType<typeof sourceAccountRef>;
  externalThread?: ReturnType<typeof externalThreadRef>;
  capabilityRevision?: string;
}) {
  const externalThread = input?.externalThread ?? externalThreadRef();
  const sourceAccount = input?.sourceAccount ?? sourceAccountRef();
  const sourceThreadBinding = input?.binding ?? sourceThreadBindingRef();
  const providerResponse = input?.originKind === "provider_response";
  const resolution =
    input?.resolution === "resolved"
      ? {
          state: "resolved" as const,
          externalMessageReference: reference(
            "external_message_reference",
            "external_message_reference:reference-1"
          )
        }
      : {
          state: "pending" as const,
          diagnostic: {
            codeId: "core:message-reference-pending",
            retryable: true,
            correlationToken: "correlation:occurrence-1",
            safeOperatorHintId: null
          }
        };
  return {
    tenantId,
    id: "source_occurrence:occurrence-1",
    messageKey: {
      realm: {
        realmId: messageDeclaration.realmId,
        realmVersion: messageDeclaration.realmVersion,
        canonicalizationVersion: messageDeclaration.canonicalizationVersion
      },
      scope: { kind: "provider_thread" as const },
      objectKindId: messageDeclaration.objectKindId,
      externalThread,
      canonicalExternalSubject: "ProviderMessage:ABC-1"
    },
    messageIdentityDeclaration: messageDeclaration,
    bindingContext: {
      externalThread,
      sourceAccount,
      sourceThreadBinding,
      bindingGeneration: "1"
    },
    origin: providerResponse
      ? {
          kind: "provider_response" as const,
          sourceAccount,
          outboundDispatchAttempt: reference(
            "outbound_dispatch_attempt",
            "outbound_dispatch_attempt:attempt-1"
          )
        }
      : {
          kind: "webhook" as const,
          sourceAccount,
          rawInboundEvent: rawEventReference,
          normalizedInboundEvent: normalizedEventReference
        },
    descriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:message-observation",
      descriptorVersion: "v1",
      capabilityRevision: input?.capabilityRevision ?? "1",
      providerReferences: [
        {
          kindId: "module:synthetic-source:external-message-id",
          subject: "ProviderMessage:ABC-1"
        }
      ],
      descriptorDigestSha256: "b".repeat(64)
    },
    providerActor: providerResponse
      ? null
      : {
          kind: "source_external_identity" as const,
          sourceExternalIdentity: reference(
            "source_external_identity",
            "source_external_identity:actor-1"
          )
        },
    direction: providerResponse ? ("outbound" as const) : ("inbound" as const),
    providerTimestamps: [],
    referencePortability: {
      kind: "binding_only" as const,
      adapterContract,
      decisionStrength: "safe_default" as const
    },
    resolution,
    observedAt,
    recordedAt: materializedAt,
    revision: input?.resolution === "resolved" ? "2" : "1",
    createdAt: materializedAt,
    updatedAt:
      input?.resolution === "resolved"
        ? "2026-07-11T09:03:00.000Z"
        : materializedAt
  };
}

function outboundRouteSnapshot() {
  const mapping = externalThreadMapping();
  const principal = {
    kind: "trusted_service" as const,
    trustedServiceId: "core:source-runtime"
  };
  const conversation = mapping.thread.conversation;
  const bindingFence = {
    accountGeneration: "1",
    bindingGeneration: "1",
    remoteAccessRevision: "1",
    administrativeRevision: "1",
    capabilityRevision: "1",
    routeDescriptorRevision: "1"
  };
  const target = {
    conversation,
    externalThread: externalThreadReference,
    sourceThreadBinding: sourceThreadBindingReference,
    sourceAccount: sourceAccountReference,
    sourceConnection: sourceConnectionReference,
    operationId: "core:send",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:epoch-1",
    bindingFence,
    referenceTarget: { kind: "none" as const }
  };
  const decisionBase = {
    tenantId,
    principal,
    target,
    effect: "allow" as const,
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization-service",
    decidedAt: t0,
    notAfter: "2026-07-11T10:00:00.000Z"
  };
  return {
    tenantId,
    id: "outbound_route:route-1",
    principal,
    conversation,
    externalThread: externalThreadReference,
    sourceThreadBinding: sourceThreadBindingReference,
    sourceAccount: sourceAccountReference,
    sourceConnection: sourceConnectionReference,
    operationId: "core:send",
    contentKindId: "core:text",
    authorizationEpoch: "authorization:epoch-1",
    requiredConversationPermissionId: "core:message.send_external",
    bindingFence,
    adapterContract,
    routeDescriptor: routeDescriptor(),
    routePolicy: reference(
      "thread_route_policy",
      "thread_route_policy:policy-1"
    ),
    routePolicyRevision: "1",
    conversationAuthorization: {
      ...decisionBase,
      decisionKind: "conversation_action" as const,
      requiredPermissionId: "core:message.send_external",
      matchedPermissionIds: ["core:message.send_external"],
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
      observedAt: t0,
      diagnostic: null
    },
    selection: {
      intent: { kind: "automatic" as const },
      reason: "sole_eligible_binding" as const,
      candidateSnapshotToken: "snapshot:route-candidates-1",
      candidateSnapshotNotAfter: "2026-07-11T10:00:00.000Z",
      fallbackPolicyOrdinal: null,
      selectedAt: routeAt
    },
    mutationToken: "mutation:route-1",
    idempotencyToken: "idempotency:route-1",
    correlationToken: "correlation:route-1",
    revision: "1",
    createdAt: routeAt
  };
}

function outboundAttemptSnapshot() {
  return {
    tenantId,
    id: "outbound_dispatch_attempt:attempt-1",
    dispatch: reference("outbound_dispatch", "outbound_dispatch:dispatch-1"),
    route: reference("outbound_route", "outbound_route:route-1"),
    attemptNumber: 1,
    claimToken: "claim:attempt-1",
    retrySafety: {
      adapterContract,
      declaredByTrustedServiceId: "core:source-runtime",
      declarationToken: "declaration:retry-safety-attempt-1",
      declaredAt: attemptAt,
      mechanism: "provider_idempotency_key" as const,
      providerCorrelationToken: "provider-idempotency:attempt-1",
      automaticRetryAllowed: true
    },
    leaseExpiresAt: "2026-07-11T09:05:00.000Z",
    openedAt: attemptAt,
    outcome: {
      kind: "accepted" as const,
      completedAt: attemptCompletedAt,
      providerAcknowledgementToken: "provider-ack:attempt-1"
    },
    completionSource: "provider_result" as const,
    revision: "2"
  };
}

function outboundDispatchSnapshot() {
  const attemptReference = reference(
    "outbound_dispatch_attempt",
    "outbound_dispatch_attempt:attempt-1"
  );
  return {
    tenantId,
    id: "outbound_dispatch:dispatch-1",
    message: reference("message", "message:outbound-1"),
    route: reference("outbound_route", "outbound_route:route-1"),
    multiSendOperation: null,
    state: "accepted" as const,
    attemptCount: 1,
    activeAttempt: null,
    lastAttempt: attemptReference,
    retryAuthorization: null,
    revision: "3",
    createdAt: dispatchAt,
    updatedAt: attemptCompletedAt
  };
}

function sourceThreadBindingRef(id = sourceThreadBindingReference.id) {
  return reference("source_thread_binding", id);
}

function sourceAccountRef(id = sourceAccountReference.id) {
  return reference("source_account", id);
}

function externalThreadRef(id = externalThreadReference.id) {
  return reference("external_thread", id);
}

function authority(at = materializedAt) {
  return {
    kind: "trusted_service" as const,
    trustedServiceId: "core:source-runtime",
    authorizationToken: "authorization:occurrence-materialization-1",
    authorizedAt: at
  };
}

function materializationCommit(input?: {
  occurrence?: ReturnType<typeof occurrence>;
  projection?: ReturnType<typeof currentProjection>;
  mapping?: ReturnType<typeof externalThreadMapping>;
  identity?: ReturnType<typeof verifiedSourceAccountIdentity>;
  bindingKind?: "existing" | "created";
  outboundDispatchAttempt?: ReturnType<typeof outboundAttemptSnapshot> | null;
  outboundDispatch?: ReturnType<typeof outboundDispatchSnapshot> | null;
  outboundRoute?: ReturnType<typeof outboundRouteSnapshot> | null;
}) {
  const bindingKind = input?.bindingKind ?? "existing";
  return {
    tenantId,
    occurrence: input?.occurrence ?? occurrence(),
    bindingMaterialization:
      bindingKind === "created"
        ? {
            kind: "created" as const,
            currentProjection: input?.projection ?? currentProjection(),
            creationAuthority: authority(t0)
          }
        : {
            kind: "existing" as const,
            currentProjection: input?.projection ?? currentProjection(),
            creationAuthority: null
          },
    externalThreadMapping: input?.mapping ?? externalThreadMapping(),
    sourceAccountIdentity: input?.identity ?? verifiedSourceAccountIdentity(),
    outboundDispatchAttempt: input?.outboundDispatchAttempt ?? null,
    outboundDispatch: input?.outboundDispatch ?? null,
    outboundRoute: input?.outboundRoute ?? null,
    authority: authority(),
    materializedAt
  };
}

describe("Inbox V2 SourceOccurrence materialization", () => {
  it("materializes one initial pending inbound occurrence against exact current snapshots", () => {
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit()
      ).success
    ).toBe(true);
  });

  it("supports loader-authorized creation of the exact first binding episode", () => {
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({ bindingKind: "created" })
      ).success
    ).toBe(true);

    const invalid = materializationCommit({ bindingKind: "created" });
    if (invalid.bindingMaterialization.kind !== "created") {
      throw new Error("Expected created fixture");
    }
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse({
        ...invalid,
        bindingMaterialization: {
          ...invalid.bindingMaterialization,
          creationAuthority: {
            ...invalid.bindingMaterialization.creationAuthority,
            trustedServiceId: "core:foreign-runtime"
          }
        }
      }).success
    ).toBe(false);
  });

  it.each([
    [
      "binding",
      occurrence({
        binding: sourceThreadBindingRef(
          "source_thread_binding:same-tenant-wrong"
        )
      })
    ],
    [
      "account",
      occurrence({
        sourceAccount: sourceAccountRef("source_account:same-tenant-wrong")
      })
    ],
    [
      "thread",
      occurrence({
        externalThread: externalThreadRef("external_thread:same-tenant-wrong")
      })
    ]
  ] as const)("rejects same-tenant wrong %s", (_label, invalidOccurrence) => {
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({ occurrence: invalidOccurrence })
      ).success
    ).toBe(false);
  });

  it("rejects a provider-thread key materialized through a foreign binding", () => {
    const foreignThread = externalThreadRef("external_thread:foreign-thread");
    const foreignBinding = binding({ externalThread: foreignThread });
    const projection = currentProjection({ binding: foreignBinding });

    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({ projection })
      ).success
    ).toBe(false);
  });

  it.each(["existing", "created"] as const)(
    "rejects wrong account/connection ExternalThread scope owners on the %s path",
    (bindingKind) => {
      for (const mapping of [
        externalThreadMapping({
          scopeKind: "source_account",
          ownerId: "source_account:same-tenant-wrong"
        }),
        externalThreadMapping({
          scopeKind: "source_connection",
          ownerId: "source_connection:same-tenant-wrong"
        })
      ]) {
        expect(
          inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
            materializationCommit({ bindingKind, mapping })
          ).success
        ).toBe(false);
      }
    }
  );

  it("keeps provider-scoped ExternalThread materialization multi-account", () => {
    const secondAccount = sourceAccountRef("source_account:account-2");
    const secondAccountSnapshot = accountIdentitySnapshot({
      sourceAccount: secondAccount,
      canonicalExternalSubject: "ProviderAccount:DEF"
    });
    const secondBinding = binding({
      sourceAccount: secondAccount,
      accountIdentitySnapshot: secondAccountSnapshot
    });
    const baseIdentity = verifiedSourceAccountIdentity();

    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          occurrence: occurrence({ sourceAccount: secondAccount }),
          projection: currentProjection({ binding: secondBinding }),
          mapping: externalThreadMapping({ scopeKind: "provider" }),
          identity: {
            ...baseIdentity,
            sourceAccount: secondAccount,
            canonicalIdentity: {
              ...baseIdentity.canonicalIdentity,
              canonicalExternalSubject: "ProviderAccount:DEF"
            }
          }
        })
      ).success
    ).toBe(true);
  });

  it("requires verified current account identity, exact generations and adapter surface", () => {
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          identity: verifiedSourceAccountIdentity({
            accountGeneration: "2"
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          occurrence: occurrence({ capabilityRevision: "2" })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          identity: verifiedSourceAccountIdentity({
            identityDeclaration: {
              ...accountDeclaration,
              adapterContract: {
                ...adapterContract,
                surfaceId: "module:synthetic-source:foreign-surface"
              }
            }
          })
        })
      ).success
    ).toBe(false);
  });

  it("rejects resolved occurrences and outbound snapshots on inbound materialization", () => {
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          occurrence: occurrence({ resolution: "resolved" })
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse({
        ...materializationCommit(),
        outboundDispatch: {}
      }).success
    ).toBe(false);
  });

  it("proves provider response through exact attempt, dispatch and immutable route snapshots", () => {
    const result = inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
      materializationCommit({
        occurrence: occurrence({ originKind: "provider_response" }),
        outboundDispatchAttempt: outboundAttemptSnapshot(),
        outboundDispatch: outboundDispatchSnapshot(),
        outboundRoute: outboundRouteSnapshot()
      })
    );
    if (!result.success) {
      throw new Error(JSON.stringify(result.error.issues, null, 2));
    }
    expect(result.success).toBe(true);
  });

  it("rejects provider response with a wrong attempt or route chain", () => {
    const providerResponse = occurrence({ originKind: "provider_response" });
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({ occurrence: providerResponse })
      ).success
    ).toBe(false);

    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          occurrence: providerResponse,
          outboundDispatchAttempt: {
            ...outboundAttemptSnapshot(),
            id: "outbound_dispatch_attempt:wrong-attempt"
          },
          outboundDispatch: outboundDispatchSnapshot(),
          outboundRoute: outboundRouteSnapshot()
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse(
        materializationCommit({
          occurrence: providerResponse,
          outboundDispatchAttempt: outboundAttemptSnapshot(),
          outboundDispatch: {
            ...outboundDispatchSnapshot(),
            route: reference("outbound_route", "outbound_route:wrong-route")
          },
          outboundRoute: outboundRouteSnapshot()
        })
      ).success
    ).toBe(false);
  });

  it("is bounded, strict and versioned", () => {
    const commit = materializationCommit();
    expect(
      inboxV2SourceOccurrenceMaterializationCommitSchema.safeParse({
        ...commit,
        allOccurrences: [commit.occurrence]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceOccurrenceMaterializationCommitEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_COMMIT_SCHEMA_ID,
        schemaVersion:
          INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_SCHEMA_VERSION,
        payload: commit
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceOccurrenceMaterializationCommitEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_OCCURRENCE_MATERIALIZATION_COMMIT_SCHEMA_ID,
        schemaVersion: "v2",
        payload: commit
      }).success
    ).toBe(false);
  });
});
