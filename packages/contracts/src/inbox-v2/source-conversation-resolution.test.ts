import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_CONVERSATION_ATOMIC_RESOLUTION_RESULT_SCHEMA_ID,
  INBOX_V2_SOURCE_CONVERSATION_MATERIALIZATION_PLAN_SCHEMA_ID,
  INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
  INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SOURCE_PROJECTION_SCHEMA_ID,
  inboxV2SourceConversationAtomicResolutionResultEnvelopeSchema,
  inboxV2SourceConversationAtomicResolutionResultSchema,
  inboxV2SourceConversationMaterializationPlanEnvelopeSchema,
  inboxV2SourceConversationMaterializationPlanSchema,
  inboxV2SourceConversationResolutionSourceProjectionEnvelopeSchema,
  inboxV2SourceConversationResolutionSourceProjectionSchema
} from "./source-conversation-resolution";

const tenantId = "tenant:alpha";
const loadedAt = "2026-07-11T08:00:00.000Z";
const recordedAt = "2026-07-11T08:05:00.000Z";
const materializedAt = "2026-07-11T08:06:00.000Z";
const resolvedAt = "2026-07-11T08:07:00.000Z";

const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:connection-1"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:account-1"
};
const rawInboundEvent = {
  tenantId,
  kind: "raw_inbound_event" as const,
  id: "raw_inbound_event:raw-1"
};
const normalizedInboundEvent = {
  tenantId,
  kind: "normalized_inbound_event" as const,
  id: "normalized_inbound_event:normalized-1"
};
const adapterContract = {
  contractId: "module:synthetic-source:direct-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic-source:direct-surface",
  loadedByTrustedServiceId: "core:source-runtime",
  loadedAt
};
const threadKey = {
  realm: {
    realmId: "module:synthetic-source:thread-realm",
    realmVersion: "v1",
    canonicalizationVersion: "v1"
  },
  scope: { kind: "source_account" as const, owner: sourceAccount },
  objectKindId: "module:synthetic-source:chat",
  canonicalExternalSubject: "Thread:Case-Sensitive-ABC"
};
const threadDeclaration = {
  adapterContract,
  identityKind: "external_thread" as const,
  realmId: threadKey.realm.realmId,
  realmVersion: threadKey.realm.realmVersion,
  canonicalizationVersion: threadKey.realm.canonicalizationVersion,
  objectKindId: threadKey.objectKindId,
  scopeKind: "source_account" as const,
  decisionStrength: "safe_default" as const
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
  adapterContract,
  thread: {
    sourceConnection,
    sourceAccount,
    identityDeclaration: threadDeclaration,
    key: threadKey,
    observedExternalSubject: threadKey.canonicalExternalSubject
  },
  recordedAt
};
const routeDescriptor = {
  adapterContract,
  descriptorSchemaId: "module:synthetic-source:direct-route",
  descriptorVersion: "v1",
  descriptorRevision: "1",
  destinationKindId: "module:synthetic-source:direct-peer",
  // Deliberately differs from the thread subject: it is not sender-derived.
  destinationSubject: "Route:AccountLocal-Destination",
  attributes: [],
  descriptorDigestSha256: "b".repeat(64)
};
const capabilityEntry = {
  capabilityId: "core:message-text-send",
  operationId: "core:send",
  contentKindId: "core:text",
  state: "supported" as const,
  referencePortability: "external_thread" as const,
  requiredProviderRoleIds: [],
  validUntil: null,
  diagnostic: null,
  evidence: [normalizedInboundEvent]
};
const plan = {
  source,
  topology: "direct" as const,
  purposeId: "core:chat",
  routeDescriptor,
  candidateConversationId: "conversation:conversation-1",
  candidateExternalThreadId: "external_thread:thread-1",
  candidateSourceThreadBindingId: "source_thread_binding:binding-1",
  candidateRemoteAccessEpisodeId:
    "source_thread_binding_remote_access_episode:episode-1",
  capabilityEntries: [capabilityEntry],
  historySyncState: "not_started" as const,
  namespaceGeneration: "namespace-generation-v1",
  materializedByTrustedServiceId: "core:source-runtime",
  materializationToken: "materialization-token-1",
  materializedAt
};

describe("Inbox V2 source conversation resolution contracts", () => {
  it("accepts a closed sender-free source projection and trusted direct/group plan", () => {
    expect(
      inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse(
        source
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceConversationMaterializationPlanSchema.safeParse(plan).success
    ).toBe(true);
    expect(routeDescriptor.destinationSubject).not.toBe(
      threadKey.canonicalExternalSubject
    );

    for (const forbidden of [
      { clientId: "client:client-1" },
      { senderId: "source_external_identity:sender-1" },
      { title: "Customer title" },
      { existingConversationId: "conversation:existing" }
    ]) {
      expect(
        inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse({
          ...source,
          ...forbidden
        }).success
      ).toBe(false);
      expect(
        inboxV2SourceConversationMaterializationPlanSchema.safeParse({
          ...plan,
          ...forbidden
        }).success
      ).toBe(false);
    }
  });

  it("requires a non-null exact account/thread scope and preserves opaque casing", () => {
    expect(
      inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse({
        ...source,
        sourceAccount: null
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse({
        ...source,
        thread: {
          ...source.thread,
          key: {
            ...source.thread.key,
            scope: {
              kind: "source_account",
              owner: {
                ...sourceAccount,
                id: "source_account:other-account"
              }
            }
          }
        }
      }).success
    ).toBe(false);

    const differentlyCased = {
      ...source,
      thread: {
        ...source.thread,
        key: {
          ...source.thread.key,
          canonicalExternalSubject: "thread:case-sensitive-abc"
        },
        observedExternalSubject: "thread:case-sensitive-abc"
      }
    };
    expect(
      inboxV2SourceConversationResolutionSourceProjectionSchema.safeParse(
        differentlyCased
      ).success
    ).toBe(true);
    expect(differentlyCased.thread.key).not.toEqual(source.thread.key);
  });

  it("rejects non-chat topology, unpinned route surfaces, revision drift and bad clocks", () => {
    for (const invalidPlan of [
      { ...plan, topology: "case" },
      {
        ...plan,
        routeDescriptor: {
          ...routeDescriptor,
          descriptorRevision: "2"
        }
      },
      {
        ...plan,
        routeDescriptor: {
          ...routeDescriptor,
          adapterContract: {
            ...adapterContract,
            surfaceId: "module:synthetic-source:other-surface"
          }
        }
      },
      {
        ...plan,
        routeDescriptor: {
          ...routeDescriptor,
          adapterContract: {
            ...adapterContract,
            declarationRevision: "2",
            loadedAt: "2026-07-11T08:01:00.000Z"
          }
        }
      },
      { ...plan, materializedAt: "2026-07-11T08:04:00.000Z" }
    ]) {
      expect(
        inboxV2SourceConversationMaterializationPlanSchema.safeParse(
          invalidPlan
        ).success
      ).toBe(false);
    }
  });

  it("keeps a provider-scoped group destination independent from its thread subject and account", () => {
    const providerThreadKey = {
      ...threadKey,
      scope: { kind: "provider" as const },
      canonicalExternalSubject: "ProviderGroup:CanonicalThread"
    };
    const providerDeclaration = {
      ...threadDeclaration,
      scopeKind: "provider" as const,
      decisionStrength: "authoritative" as const
    };
    const groupSource = {
      ...source,
      thread: {
        ...source.thread,
        identityDeclaration: providerDeclaration,
        key: providerThreadKey,
        observedExternalSubject: providerThreadKey.canonicalExternalSubject
      }
    };
    const groupPlan = {
      ...plan,
      source: groupSource,
      topology: "group" as const,
      routeDescriptor: {
        ...routeDescriptor,
        destinationSubject: "ProviderGroup:AccountLocalRoute",
        descriptorDigestSha256: "e".repeat(64)
      }
    };
    const secondAccountGroupPlan = {
      ...groupPlan,
      source: {
        ...groupSource,
        sourceAccount: {
          ...sourceAccount,
          id: "source_account:account-2"
        },
        thread: {
          ...groupSource.thread,
          sourceAccount: {
            ...sourceAccount,
            id: "source_account:account-2"
          }
        }
      },
      candidateSourceThreadBindingId: "source_thread_binding:binding-2",
      candidateRemoteAccessEpisodeId:
        "source_thread_binding_remote_access_episode:episode-2"
    };

    expect(
      inboxV2SourceConversationMaterializationPlanSchema.safeParse(groupPlan)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceConversationMaterializationPlanSchema.safeParse(
        secondAccountGroupPlan
      ).success
    ).toBe(true);
    expect(groupPlan.source.thread.key).toEqual(
      secondAccountGroupPlan.source.thread.key
    );
    expect(groupPlan.routeDescriptor.destinationSubject).not.toBe(
      groupPlan.source.thread.key.canonicalExternalSubject
    );
  });

  it("accepts an atomic created thread, Conversation and binding proof", () => {
    const result = makeCreatedResult();
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
        .success
    ).toBe(true);
  });

  it("rejects unsafe initial binding axes without explicit route authority", () => {
    const mutations = [
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.remoteAccess.state = "active";
        result.sourceThreadBinding.currentRemoteAccessEpisode.state = "active";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.remoteAccess.evidenceAuthority =
          "authoritative_snapshot";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.administrative.state = "enabled";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.runtimeHealth.state = "ready";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.providerAccess.roleIds = [
          "module:synthetic-source:administrator"
        ];
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.remoteAccess.evidence = [
          {
            ...normalizedInboundEvent,
            id: "normalized_inbound_event:unrelated"
          }
        ];
      }
    ];

    for (const mutate of mutations) {
      const result = makeCreatedResult();
      mutate(result);
      expect(
        inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
          .success
      ).toBe(false);
    }
  });

  it("rejects an unchanged revision-1 route after an unrelated binding transition", () => {
    const result = makeCreatedResult();
    result.threadResolution = "matched_canonical";
    result.bindingResolution = "already_exists";
    result.sourceThreadBinding.binding.revision = "2";
    result.sourceThreadBinding.binding.updatedAt = resolvedAt;
    result.sourceThreadBinding.binding.routeDescriptor = {
      ...result.sourceThreadBinding.binding.routeDescriptor,
      destinationSubject: "Route:Conflicting-First-Writer",
      descriptorDigestSha256: "d".repeat(64)
    };

    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
        .success
    ).toBe(false);
  });

  it("accepts historical canonical replay on the same stable adapter surface", () => {
    const result = makeCreatedResult();
    const historicalContract = {
      ...adapterContract,
      declarationRevision: "7",
      loadedByTrustedServiceId: "core:source-runtime-v0",
      loadedAt: "2026-07-11T07:00:00.000Z"
    };
    result.threadResolution = "matched_canonical";
    result.bindingResolution = "already_exists";
    result.externalThreadMapping.thread.identityDeclaration = {
      ...result.externalThreadMapping.thread.identityDeclaration,
      adapterContract: historicalContract
    };
    result.externalThreadMapping.thread.id = "external_thread:historical";
    result.externalThreadMapping.thread.conversation.id =
      "conversation:historical";
    result.externalThreadMapping.conversation.id = "conversation:historical";
    result.externalThreadMapping.thread.createdAt = "2026-07-11T07:30:00.000Z";
    result.externalThreadMapping.thread.updatedAt = "2026-07-11T07:30:00.000Z";
    result.externalThreadMapping.conversation.createdAt =
      "2026-07-11T07:30:00.000Z";
    result.externalThreadMapping.conversation.updatedAt = resolvedAt;
    result.sourceThreadBinding.binding.id = "source_thread_binding:historical";
    result.sourceThreadBinding.binding.externalThread.id =
      "external_thread:historical";
    result.sourceThreadBinding.binding.createdAt = "2026-07-11T07:40:00.000Z";
    result.sourceThreadBinding.binding.updatedAt = resolvedAt;
    const plannedAttributes = [
      { attributeId: "module:synthetic-source:a", value: "a-value" },
      { attributeId: "module:synthetic-source:z", value: "z-value" }
    ];
    result.plan.routeDescriptor.attributes = plannedAttributes as never[];
    result.sourceThreadBinding.binding.routeDescriptor = {
      ...result.sourceThreadBinding.binding.routeDescriptor,
      adapterContract: historicalContract,
      attributes: [...plannedAttributes]
        .reverse()
        .map((attribute) => ({ ...attribute })) as never[],
      descriptorDigestSha256: "c".repeat(64)
    };
    result.sourceThreadBinding.binding.capabilities = {
      ...result.sourceThreadBinding.binding.capabilities,
      adapterContract: historicalContract,
      capturedAt: resolvedAt
    };
    result.sourceThreadBinding.binding.accountIdentitySnapshot.declaration = {
      ...result.sourceThreadBinding.binding.accountIdentitySnapshot.declaration,
      adapterContract: historicalContract
    };
    result.sourceThreadBinding.currentRemoteAccessEpisode.binding.id =
      "source_thread_binding:historical";

    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
        .success
    ).toBe(true);

    (
      result.sourceThreadBinding.binding.routeDescriptor.attributes as Array<{
        attributeId: string;
        value: string;
      }>
    )[0]!.value = "changed-value";
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
        .success
    ).toBe(false);
  });

  it("accepts a direct exact alias proof to a different canonical key", () => {
    const result = makeCreatedResult();
    result.threadResolution = "matched_alias";
    result.bindingResolution = "already_exists";
    result.externalThreadMapping.thread.key = {
      ...result.externalThreadMapping.thread.key,
      canonicalExternalSubject: "Thread:Canonical-Replacement"
    };
    result.matchedAlias = {
      tenantId,
      id: "external_thread_alias:alias-1",
      aliasKey: structuredClone(threadKey),
      aliasIdentityDeclaration: {
        ...threadDeclaration,
        decisionStrength: "authoritative"
      },
      canonicalThread: {
        tenantId,
        kind: "external_thread",
        id: result.externalThreadMapping.thread.id
      },
      canonicalConversation: {
        tenantId,
        kind: "conversation",
        id: result.externalThreadMapping.conversation.id
      },
      canonicalKeySnapshot: structuredClone(
        result.externalThreadMapping.thread.key
      ),
      expectedCanonicalThreadRevision: "1",
      decision: {
        actor: {
          kind: "trusted_service",
          trustedServiceId: "core:source-runtime"
        },
        policyId: "core:authoritative-thread-alias",
        policyVersion: "v1",
        reasonCodeId: "core:provider-thread-replacement",
        authoritativeEvidenceToken: "alias-evidence-token-1",
        decidedAt: materializedAt
      },
      revision: "1",
      createdAt: materializedAt
    };

    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
        .success
    ).toBe(true);
  });

  it("rejects impossible and cross-aggregate created results", () => {
    const mutations = [
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.bindingResolution = "already_exists";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.externalThreadMapping.conversation.topology = "group";
        result.externalThreadMapping.thread.conversationTopology = "group";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.externalThreadMapping.conversation.purposeId = "core:support";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.sourceAccount.id =
          "source_account:other-account";
      },
      (result: ReturnType<typeof makeCreatedResult>) => {
        result.sourceThreadBinding.binding.routeDescriptor = {
          ...result.sourceThreadBinding.binding.routeDescriptor,
          destinationSubject: "Route:Unexpected",
          descriptorDigestSha256: "d".repeat(64)
        };
      }
    ];

    for (const mutate of mutations) {
      const result = makeCreatedResult();
      mutate(result);
      expect(
        inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(result)
          .success
      ).toBe(false);
    }
  });

  it("accepts only bounded pre-plan and post-plan conflict proofs", () => {
    const request = {
      tenantId,
      rawInboundEvent,
      normalizedInboundEvent,
      sourceConnection,
      sourceAccount
    };
    const missingEvent = {
      outcome: "conflict" as const,
      request,
      plan: null,
      conflictCode:
        "source.conversation_resolution.source_event_missing" as const,
      retryable: true,
      diagnostic: null,
      conflictedByTrustedServiceId: "core:source-runtime",
      conflictToken: "conflict-token-1",
      conflictedAt: resolvedAt
    };
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse(
        missingEvent
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse({
        ...missingEvent,
        conflictCode:
          "source.conversation_resolution.source_projection_conflict"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse({
        ...missingEvent,
        plan,
        conflictCode:
          "source.conversation_resolution.source_projection_conflict"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceConversationAtomicResolutionResultSchema.safeParse({
        ...missingEvent,
        conflictCode: "source.conversation_resolution.source_account_missing",
        request: { ...request, sourceAccount: null }
      }).success
    ).toBe(true);
  });

  it("publishes strict v1 envelopes for all three boundaries", () => {
    const result = makeCreatedResult();
    const fixtures = [
      [
        inboxV2SourceConversationResolutionSourceProjectionEnvelopeSchema,
        INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SOURCE_PROJECTION_SCHEMA_ID,
        source
      ],
      [
        inboxV2SourceConversationMaterializationPlanEnvelopeSchema,
        INBOX_V2_SOURCE_CONVERSATION_MATERIALIZATION_PLAN_SCHEMA_ID,
        plan
      ],
      [
        inboxV2SourceConversationAtomicResolutionResultEnvelopeSchema,
        INBOX_V2_SOURCE_CONVERSATION_ATOMIC_RESOLUTION_RESULT_SCHEMA_ID,
        result
      ]
    ] as const;

    for (const [schema, schemaId, payload] of fixtures) {
      expect(
        schema.safeParse({
          schemaId,
          schemaVersion: INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
          payload
        }).success
      ).toBe(true);
      expect(
        schema.safeParse({
          schemaId,
          schemaVersion: INBOX_V2_SOURCE_CONVERSATION_RESOLUTION_SCHEMA_VERSION,
          payload,
          sender: "forbidden"
        }).success
      ).toBe(false);
    }
  });
});

function makeCreatedResult() {
  const conversation = {
    tenantId,
    id: plan.candidateConversationId,
    topology: plan.topology as "direct" | "group",
    transport: "external" as const,
    purposeId: plan.purposeId,
    lifecycle: "active" as const,
    head: {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      createdAt: materializedAt,
      updatedAt: materializedAt
    },
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };
  const thread = {
    tenantId,
    id: plan.candidateExternalThreadId,
    key: threadKey,
    identityDeclaration: threadDeclaration,
    conversation: {
      tenantId,
      kind: "conversation" as const,
      id: conversation.id
    },
    conversationTopology: plan.topology as "direct" | "group",
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };
  const accountIdentitySnapshot = {
    status: "verified" as const,
    sourceConnection,
    sourceAccount,
    declaration: {
      adapterContract,
      identityKind: "source_account" as const,
      realmId: "module:synthetic-source:account-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:user-account",
      scopeKind: "source_connection" as const,
      decisionStrength: "authoritative" as const
    },
    realmId: "module:synthetic-source:account-realm",
    canonicalExternalSubject: "Account:ABC",
    accountGeneration: "1",
    verificationEvidence: [rawInboundEvent],
    // Account verification may legitimately predate planning/commit time.
    verifiedAt: recordedAt
  };
  const binding = {
    tenantId,
    id: plan.candidateSourceThreadBindingId,
    externalThread: {
      tenantId,
      kind: "external_thread" as const,
      id: thread.id
    },
    sourceConnection,
    sourceAccount,
    accountIdentitySnapshot,
    bindingGeneration: "1",
    remoteAccess: {
      state: "observed" as "observed" | "active" | "left" | "removed",
      evidenceAuthority: "direct_observation" as
        | "direct_observation"
        | "explicit_terminal_event"
        | "authoritative_snapshot"
        | "advisory_snapshot"
        | "migration_observed",
      revision: "1",
      since: materializedAt,
      evidence: [normalizedInboundEvent]
    },
    administrative: {
      state: "disabled" as "enabled" | "disabled",
      revision: "1",
      changedAt: materializedAt
    },
    runtimeHealth: {
      state: "unknown" as "unknown" | "ready" | "degraded" | "unavailable",
      revision: "1",
      checkedAt: materializedAt,
      diagnostic: null
    },
    historySync: {
      state: plan.historySyncState,
      revision: "1",
      receiveCursor: null,
      historyCursor: null,
      providerWatermark: null,
      lastDurableRawEvent: null,
      updatedAt: materializedAt,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: [] as string[],
      evidence: [normalizedInboundEvent],
      observedAt: materializedAt
    },
    capabilities: {
      adapterContract,
      revision: "1",
      capturedAt: materializedAt,
      entries: plan.capabilityEntries
    },
    routeDescriptor,
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };
  const episode = {
    tenantId,
    id: plan.candidateRemoteAccessEpisodeId,
    binding: {
      tenantId,
      kind: "source_thread_binding" as const,
      id: binding.id
    },
    state: binding.remoteAccess.state,
    startedAt: materializedAt,
    endedAt: null,
    startEvidence: binding.remoteAccess.evidence,
    endEvidence: [],
    revision: "1",
    createdAt: materializedAt,
    updatedAt: materializedAt
  };

  return {
    outcome: "resolved" as const,
    plan: structuredClone(plan),
    threadResolution: "created" as
      | "created"
      | "matched_canonical"
      | "matched_alias",
    bindingResolution: "created" as "created" | "already_exists",
    matchedAlias: null as unknown,
    externalThreadMapping: { tenantId, thread, conversation },
    sourceThreadBinding: {
      binding,
      currentRemoteAccessEpisode: episode
    },
    resolvedAt
  };
}
