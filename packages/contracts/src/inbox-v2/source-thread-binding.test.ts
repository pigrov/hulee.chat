import { describe, expect, it } from "vitest";
import type { z } from "zod";

import {
  deriveInboxV2SourceThreadBindingCurrentHead,
  deriveInboxV2SourceThreadBindingFence,
  INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX,
  INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PAGE_MAX,
  INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
  INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
  inboxV2SourceBindingCapabilityStateSchema,
  inboxV2SourceReferencePortabilitySchema,
  inboxV2SourceThreadBindingAdministrativeStateSchema,
  inboxV2SourceThreadBindingCapabilitySnapshotSchema,
  inboxV2SourceThreadBindingCreationCommitSchema,
  inboxV2SourceThreadBindingCurrentPageSchema,
  inboxV2SourceThreadBindingCurrentProjectionSchema,
  inboxV2SourceThreadBindingEnvelopeSchema,
  inboxV2SourceThreadBindingFenceSchema,
  inboxV2SourceThreadBindingHistorySyncStateSchema,
  inboxV2SourceThreadBindingRemoteAccessEpisodeSchema,
  inboxV2SourceThreadBindingRemoteAccessStateSchema,
  inboxV2SourceThreadBindingRuntimeHealthStateSchema,
  inboxV2SourceThreadBindingSchema,
  inboxV2SourceThreadBindingTransitionCommitSchema,
  inboxV2SourceThreadBindingTransitionSchema,
  isInboxV2SourceThreadBindingStructurallyActive
} from "./source-thread-binding";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T09:01:00.000Z";
const t2 = "2026-07-11T10:00:00.000Z";
const authorizationEpoch = "authorization-epoch-1";

const rawEvidence = {
  tenantId,
  kind: "raw_inbound_event",
  id: "raw_inbound_event:raw-1"
} as const;
const secondRawEvidence = {
  tenantId,
  kind: "raw_inbound_event",
  id: "raw_inbound_event:raw-2"
} as const;

function adapterContract(overrides: Record<string, unknown> = {}) {
  return {
    contractId: "module:synthetic-source:direct-contract",
    contractVersion: "v1",
    declarationRevision: "1",
    surfaceId: "module:synthetic-source:group-surface",
    loadedByTrustedServiceId: "core:source-runtime",
    loadedAt: t0,
    ...overrides
  };
}

function safeDiagnostic(overrides: Record<string, unknown> = {}) {
  return {
    codeId: "core:runtime-unavailable",
    retryable: true,
    correlationToken: "corr-token-1",
    safeOperatorHintId: null,
    ...overrides
  };
}

function accountIdentity(overrides: Record<string, unknown> = {}) {
  return {
    status: "verified",
    sourceConnection: {
      tenantId,
      kind: "source_connection",
      id: "source_connection:connection-1"
    },
    sourceAccount: {
      tenantId,
      kind: "source_account",
      id: "source_account:account-1"
    },
    declaration: {
      adapterContract: adapterContract(),
      identityKind: "source_account",
      realmId: "module:synthetic-source:account-realm",
      realmVersion: "v1",
      canonicalizationVersion: "v1",
      objectKindId: "module:synthetic-source:user-account",
      scopeKind: "source_connection",
      decisionStrength: "authoritative"
    },
    realmId: "module:synthetic-source:account-realm",
    canonicalExternalSubject: "AccountABC",
    accountGeneration: "1",
    verificationEvidence: [rawEvidence],
    verifiedAt: t0,
    ...overrides
  };
}

function routeDescriptor(overrides: Record<string, unknown> = {}) {
  return {
    adapterContract: adapterContract(),
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

function capabilityEntry(overrides: Record<string, unknown> = {}) {
  return {
    capabilityId: "core:message-text-send",
    operationId: "core:send",
    contentKindId: "core:text",
    state: "supported",
    referencePortability: "external_thread",
    requiredProviderRoleIds: ["module:synthetic-source:provider-member"],
    validUntil: null,
    diagnostic: null,
    evidence: [rawEvidence],
    ...overrides
  };
}

function capabilitySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    adapterContract: adapterContract(),
    revision: "1",
    capturedAt: t0,
    entries: [capabilityEntry()],
    ...overrides
  };
}

function binding(
  overrides: Record<string, unknown> = {}
): z.input<typeof inboxV2SourceThreadBindingSchema> {
  return {
    tenantId,
    id: "source_thread_binding:binding-1",
    externalThread: {
      tenantId,
      kind: "external_thread",
      id: "external_thread:thread-1"
    },
    sourceConnection: {
      tenantId,
      kind: "source_connection",
      id: "source_connection:connection-1"
    },
    sourceAccount: {
      tenantId,
      kind: "source_account",
      id: "source_account:account-1"
    },
    accountIdentitySnapshot: accountIdentity(),
    bindingGeneration: "1",
    remoteAccess: {
      state: "active",
      evidenceAuthority: "direct_observation",
      revision: "1",
      since: t0,
      evidence: [rawEvidence]
    },
    administrative: {
      state: "enabled",
      revision: "1",
      changedAt: t0
    },
    runtimeHealth: {
      state: "ready",
      revision: "1",
      checkedAt: t0,
      diagnostic: null
    },
    historySync: {
      state: "live",
      revision: "1",
      receiveCursor: "receive-cursor-1",
      historyCursor: "history-cursor-1",
      providerWatermark: "watermark-1",
      lastDurableRawEvent: rawEvidence,
      updatedAt: t0,
      diagnostic: null
    },
    providerAccess: {
      revision: "1",
      roleIds: ["module:synthetic-source:provider-member"],
      evidence: [rawEvidence],
      observedAt: t0
    },
    capabilities: capabilitySnapshot(),
    routeDescriptor: routeDescriptor(),
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  } as z.input<typeof inboxV2SourceThreadBindingSchema>;
}

function episode(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "source_thread_binding_remote_access_episode:episode-1",
    binding: {
      tenantId,
      kind: "source_thread_binding",
      id: "source_thread_binding:binding-1"
    },
    state: "active",
    startedAt: t0,
    endedAt: null,
    startEvidence: [rawEvidence],
    endEvidence: [],
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function projection(overrides: Record<string, unknown> = {}) {
  return {
    binding: binding(),
    currentRemoteAccessEpisode: episode(),
    ...overrides
  };
}

function trustedActor() {
  return {
    kind: "trusted_service",
    trustedServiceId: "core:source-runtime"
  } as const;
}

const employeeReference = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};

function employeeActor(overrides: Record<string, unknown> = {}) {
  return {
    kind: "employee" as const,
    employee: employeeReference,
    authorizationEpoch,
    ...overrides
  };
}

function administrativeAuthorizationDecision(
  overrides: Record<string, unknown> = {}
) {
  const currentBinding = binding();
  return {
    decisionKind: "source_thread_binding_administrative",
    tenantId,
    principal: {
      kind: "employee",
      employee: employeeReference
    },
    target: {
      binding: {
        tenantId,
        kind: "source_thread_binding",
        id: currentBinding.id
      },
      externalThread: currentBinding.externalThread,
      sourceAccount: currentBinding.sourceAccount,
      sourceConnection: currentBinding.sourceConnection
    },
    effect: "allow",
    requiredPermissionId: "core:source_thread_binding.administrative.update",
    matchedPermissionIds: ["core:source_thread_binding.administrative.update"],
    authorizationEpoch,
    decisionRevision: "1",
    decisionToken: "authorization-decision-token-1",
    loadedByTrustedServiceId: "core:authorization",
    decidedAt: t0,
    notAfter: t2,
    ...overrides
  };
}

function transitionBase() {
  return {
    tenantId,
    id: "source_thread_binding_transition:transition-1",
    binding: {
      tenantId,
      kind: "source_thread_binding",
      id: "source_thread_binding:binding-1"
    },
    actor: trustedActor(),
    reasonId: "core:provider-observation",
    expectedBindingRevision: "1",
    resultingBindingRevision: "2",
    occurredAt: t1
  };
}

function remoteAccessCommit() {
  const evidence = [secondRawEvidence];
  const resultingRemoteAccess = {
    state: "left",
    evidenceAuthority: "explicit_terminal_event",
    revision: "2",
    since: t1,
    evidence
  };
  const before = projection();
  const transition = {
    ...transitionBase(),
    kind: "remote_access",
    fromState: "active",
    toState: "left",
    expectedRemoteAccessRevision: "1",
    resultingRemoteAccess,
    closedEpisode: {
      tenantId,
      kind: "source_thread_binding_remote_access_episode",
      id: "source_thread_binding_remote_access_episode:episode-1"
    },
    openedEpisode: {
      tenantId,
      kind: "source_thread_binding_remote_access_episode",
      id: "source_thread_binding_remote_access_episode:episode-2"
    },
    evidence
  };
  const after = {
    binding: binding({
      remoteAccess: resultingRemoteAccess,
      revision: "2",
      updatedAt: t1
    }),
    currentRemoteAccessEpisode: episode({
      id: "source_thread_binding_remote_access_episode:episode-2",
      state: "left",
      startedAt: t1,
      startEvidence: evidence,
      createdAt: t1,
      updatedAt: t1
    })
  };
  const closedRemoteAccessEpisode = episode({
    endedAt: t1,
    endEvidence: evidence,
    revision: "2",
    updatedAt: t1
  });

  return { before, transition, after, closedRemoteAccessEpisode };
}

function axisCommit<TTransition extends Record<string, unknown>>(
  transition: TTransition,
  changedBindingFields: Record<string, unknown>
) {
  return {
    before: projection(),
    transition: { ...transitionBase(), ...transition },
    after: projection({
      binding: binding({
        ...changedBindingFields,
        revision: "2",
        updatedAt: t1
      })
    }),
    closedRemoteAccessEpisode: null
  };
}

function externalThreadMapping(overrides: Record<string, unknown> = {}) {
  const conversation = {
    tenantId,
    id: "conversation:conversation-1",
    topology: "group",
    transport: "external",
    purposeId: "core:chat",
    lifecycle: "active",
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
      id: "external_thread:thread-1",
      key: {
        realm: {
          realmId: "module:synthetic-source:thread-realm",
          realmVersion: "v1",
          canonicalizationVersion: "v1"
        },
        scope: { kind: "provider" },
        objectKindId: "module:synthetic-source:group-room",
        canonicalExternalSubject: "GroupABC"
      },
      identityDeclaration: {
        adapterContract: adapterContract(),
        identityKind: "external_thread",
        realmId: "module:synthetic-source:thread-realm",
        realmVersion: "v1",
        canonicalizationVersion: "v1",
        objectKindId: "module:synthetic-source:group-room",
        scopeKind: "provider",
        decisionStrength: "authoritative"
      },
      conversation: {
        tenantId,
        kind: "conversation",
        id: conversation.id
      },
      conversationTopology: "group",
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    },
    conversation,
    ...overrides
  };
}

function canonicalSourceAccountIdentity(
  overrides: Record<string, unknown> = {}
) {
  const snapshot = accountIdentity();
  return {
    tenantId,
    sourceAccount: snapshot.sourceAccount,
    sourceConnection: snapshot.sourceConnection,
    identityDeclaration: snapshot.declaration,
    accountGeneration: "1",
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    state: "verified",
    expectedCanonicalScope: null,
    provisionalIdentity: null,
    canonicalIdentity: {
      realm: {
        realmId: snapshot.realmId,
        realmVersion: snapshot.declaration.realmVersion,
        canonicalizationVersion: snapshot.declaration.canonicalizationVersion,
        objectKindId: snapshot.declaration.objectKindId
      },
      scope: {
        kind: "source_connection",
        owner: snapshot.sourceConnection
      },
      canonicalExternalSubject: snapshot.canonicalExternalSubject
    },
    verifiedBy: {
      actor: {
        kind: "trusted_service",
        trustedServiceId: "core:source-runtime"
      },
      policyId: "core:verified-provider-account",
      policyVersion: "v1",
      reasonCodeId: "core:account-verified",
      verificationEvidenceToken: "evidence.account-verify-1",
      decidedAt: t0
    },
    conflict: null,
    ...overrides
  };
}

function bindingCreationCommit(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    externalThreadMapping: externalThreadMapping(),
    sourceAccountIdentity: canonicalSourceAccountIdentity(),
    initialProjection: projection(),
    ...overrides
  };
}

describe("Inbox V2 SourceThreadBinding contract", () => {
  it("parses a provider-neutral stable binding and derives the route-critical fence", () => {
    const parsed = inboxV2SourceThreadBindingSchema.parse(binding());

    expect(parsed.accountIdentitySnapshot.canonicalExternalSubject).toBe(
      "AccountABC"
    );
    expect(parsed.routeDescriptor.destinationSubject).toBe("GroupABC");
    expect(deriveInboxV2SourceThreadBindingFence(parsed)).toEqual({
      accountGeneration: "1",
      bindingGeneration: "1",
      remoteAccessRevision: "1",
      administrativeRevision: "1",
      capabilityRevision: "1",
      routeDescriptorRevision: "1"
    });
    expect(
      Object.hasOwn(
        deriveInboxV2SourceThreadBindingFence(parsed),
        "runtimeHealthRevision"
      )
    ).toBe(false);
  });

  it("keeps all lifecycle axes closed and independent", () => {
    expect(inboxV2SourceThreadBindingRemoteAccessStateSchema.options).toEqual([
      "observed",
      "active",
      "left",
      "removed"
    ]);
    expect(inboxV2SourceThreadBindingAdministrativeStateSchema.options).toEqual(
      ["enabled", "disabled"]
    );
    expect(inboxV2SourceThreadBindingRuntimeHealthStateSchema.options).toEqual([
      "unknown",
      "ready",
      "degraded",
      "unavailable"
    ]);
    expect(inboxV2SourceThreadBindingHistorySyncStateSchema.options).toEqual([
      "unsupported",
      "not_started",
      "backfilling",
      "catching_up",
      "live",
      "paused",
      "failed"
    ]);
  });

  it("uses only remote active plus administrative enabled as structural activity", () => {
    expect(isInboxV2SourceThreadBindingStructurallyActive(binding())).toBe(
      true
    );
    expect(
      isInboxV2SourceThreadBindingStructurallyActive(
        binding({
          administrative: {
            state: "disabled",
            revision: "2",
            changedAt: t0
          }
        })
      )
    ).toBe(false);
    expect(
      isInboxV2SourceThreadBindingStructurallyActive(
        binding({
          remoteAccess: {
            state: "observed",
            evidenceAuthority: "advisory_snapshot",
            revision: "2",
            since: t0,
            evidence: [rawEvidence]
          }
        })
      )
    ).toBe(false);
  });

  it("requires verified canonical account identity on the exact account and connection", () => {
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          accountIdentitySnapshot: accountIdentity({ status: "provisional" })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          accountIdentitySnapshot: accountIdentity({
            sourceAccount: {
              tenantId,
              kind: "source_account",
              id: "source_account:other-account"
            }
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          accountIdentitySnapshot: accountIdentity({
            realmId: "module:synthetic-source:other-realm"
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          accountIdentitySnapshot: accountIdentity({
            declaration: {
              ...accountIdentity().declaration,
              decisionStrength: "safe_default"
            }
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          accountIdentitySnapshot: accountIdentity({
            verificationEvidence: [
              {
                tenantId,
                kind: "provider_roster_evidence",
                id: "provider_roster_evidence:roster-1"
              }
            ]
          })
        })
      ).success
    ).toBe(false);
  });

  it("rejects every cross-tenant thread/account/evidence relation", () => {
    for (const invalid of [
      binding({
        externalThread: {
          tenantId: "tenant:other",
          kind: "external_thread",
          id: "external_thread:thread-1"
        }
      }),
      binding({
        sourceAccount: {
          tenantId: "tenant:other",
          kind: "source_account",
          id: "source_account:account-1"
        }
      }),
      binding({
        remoteAccess: {
          state: "active",
          evidenceAuthority: "direct_observation",
          revision: "1",
          since: t0,
          evidence: [
            {
              tenantId: "tenant:other",
              kind: "raw_inbound_event",
              id: "raw_inbound_event:raw-1"
            }
          ]
        }
      })
    ]) {
      expect(inboxV2SourceThreadBindingSchema.safeParse(invalid).success).toBe(
        false
      );
    }
  });

  it("requires one adapter surface across account identity, capabilities and destination", () => {
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          routeDescriptor: routeDescriptor({
            adapterContract: adapterContract({
              surfaceId: "module:synthetic-source:private-surface"
            })
          })
        })
      ).success
    ).toBe(false);
  });

  it("preserves opaque subjects without case folding", () => {
    const upper = inboxV2SourceThreadBindingSchema.parse(binding());
    const lower = inboxV2SourceThreadBindingSchema.parse(
      binding({
        accountIdentitySnapshot: accountIdentity({
          canonicalExternalSubject: "accountabc"
        }),
        routeDescriptor: routeDescriptor({ destinationSubject: "groupabc" })
      })
    );

    expect(upper.accountIdentitySnapshot.canonicalExternalSubject).toBe(
      "AccountABC"
    );
    expect(lower.accountIdentitySnapshot.canonicalExternalSubject).toBe(
      "accountabc"
    );
    expect(upper.routeDescriptor.destinationSubject).not.toBe(
      lower.routeDescriptor.destinationSubject
    );
  });

  it("keeps provider roles as evidence and never as Hulee structural authority", () => {
    const withoutRoles = binding({
      providerAccess: {
        revision: "1",
        roleIds: [],
        evidence: [rawEvidence],
        observedAt: t0
      }
    });
    const withAdminRole = binding({
      providerAccess: {
        revision: "1",
        roleIds: ["module:synthetic-source:provider-owner"],
        evidence: [rawEvidence],
        observedAt: t0
      },
      administrative: {
        state: "disabled",
        revision: "2",
        changedAt: t0
      }
    });

    expect(isInboxV2SourceThreadBindingStructurallyActive(withoutRoles)).toBe(
      true
    );
    expect(isInboxV2SourceThreadBindingStructurallyActive(withAdminRole)).toBe(
      false
    );
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          providerAccess: {
            revision: "1",
            roleIds: [
              "module:synthetic-source:provider-owner",
              "module:synthetic-source:provider-owner"
            ],
            evidence: [rawEvidence],
            observedAt: t0
          }
        })
      ).success
    ).toBe(false);
  });

  it("models operation/content capability state and portability independently", () => {
    expect(inboxV2SourceBindingCapabilityStateSchema.options).toEqual([
      "supported",
      "unsupported",
      "unknown",
      "temporarily_unavailable",
      "expired"
    ]);
    expect(inboxV2SourceReferencePortabilitySchema.options).toEqual([
      "not_applicable",
      "binding_only",
      "external_thread",
      "provider_global"
    ]);
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({
          entries: [
            capabilityEntry(),
            capabilityEntry({
              contentKindId: "core:image",
              referencePortability: "binding_only"
            })
          ]
        })
      ).success
    ).toBe(true);
  });

  it("rejects duplicate, unbounded and internally inconsistent capability entries", () => {
    const duplicate = capabilityEntry();
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({ entries: [duplicate, duplicate] })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({
          entries: Array.from(
            { length: INBOX_V2_SOURCE_THREAD_BINDING_CAPABILITY_ENTRY_MAX + 1 },
            (_, index) =>
              capabilityEntry({ capabilityId: `core:capability-${index}` })
          )
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({
          entries: [capabilityEntry({ state: "expired", validUntil: null })]
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({
          entries: [
            capabilityEntry({
              state: "temporarily_unavailable",
              diagnostic: null
            })
          ]
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCapabilitySnapshotSchema.safeParse(
        capabilitySnapshot({
          entries: [
            capabilityEntry({
              state: "supported",
              validUntil: "2026-07-11T08:59:59.999Z"
            })
          ]
        })
      ).success
    ).toBe(false);
  });

  it("keeps runtime health and history diagnostics explicit and safe", () => {
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          runtimeHealth: {
            state: "degraded",
            revision: "2",
            checkedAt: t0,
            diagnostic: null
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          historySync: {
            state: "failed",
            revision: "2",
            receiveCursor: "cursor-1",
            historyCursor: null,
            providerWatermark: null,
            lastDurableRawEvent: rawEvidence,
            updatedAt: t0,
            diagnostic: null
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingSchema.safeParse(
        binding({
          historySync: {
            state: "unsupported",
            revision: "2",
            receiveCursor: "cursor-1",
            historyCursor: null,
            providerWatermark: null,
            lastDurableRawEvent: null,
            updatedAt: t0,
            diagnostic: null
          }
        })
      ).success
    ).toBe(false);
  });

  it("binds the current open remote episode to the current projection", () => {
    expect(
      inboxV2SourceThreadBindingCurrentProjectionSchema.parse(projection())
    ).toBeDefined();
    expect(
      inboxV2SourceThreadBindingCurrentProjectionSchema.safeParse(
        projection({
          currentRemoteAccessEpisode: episode({ state: "observed" })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCurrentProjectionSchema.safeParse(
        projection({
          currentRemoteAccessEpisode: episode({
            endedAt: t1,
            endEvidence: [secondRawEvidence],
            revision: "2",
            updatedAt: t1
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCurrentProjectionSchema.safeParse(
        projection({
          currentRemoteAccessEpisode: episode({
            startEvidence: [secondRawEvidence]
          })
        })
      ).success
    ).toBe(false);
  });

  it("creates one binding only from exact canonical thread/account authorities and revision-1 local state", () => {
    const valid = bindingCreationCommit();
    expect(
      inboxV2SourceThreadBindingCreationCommitSchema.safeParse(valid).success
    ).toBe(true);

    const wrongThread = structuredClone(valid);
    wrongThread.externalThreadMapping.thread.id = "external_thread:thread-2";

    const wrongAccount = structuredClone(valid);
    wrongAccount.sourceAccountIdentity.sourceAccount.id =
      "source_account:account-2";

    const wrongGeneration = structuredClone(valid);
    wrongGeneration.initialProjection.binding.accountIdentitySnapshot.accountGeneration =
      "2";

    const wrongDeclaration = structuredClone(valid);
    wrongDeclaration.sourceAccountIdentity.identityDeclaration.adapterContract.declarationRevision =
      "2";

    const skippedInitialRevision = structuredClone(valid);
    skippedInitialRevision.initialProjection.binding.bindingGeneration = "2";

    const mapping = externalThreadMapping();
    const wrongAccountScopedOwner = bindingCreationCommit({
      externalThreadMapping: {
        ...mapping,
        thread: {
          ...mapping.thread,
          key: {
            ...mapping.thread.key,
            scope: {
              kind: "source_account",
              owner: {
                tenantId,
                kind: "source_account",
                id: "source_account:other-account"
              }
            }
          },
          identityDeclaration: {
            ...mapping.thread.identityDeclaration,
            scopeKind: "source_account"
          }
        }
      }
    });

    const wrongConnectionScopedOwner = bindingCreationCommit({
      externalThreadMapping: {
        ...mapping,
        thread: {
          ...mapping.thread,
          key: {
            ...mapping.thread.key,
            scope: {
              kind: "source_connection",
              owner: {
                tenantId,
                kind: "source_connection",
                id: "source_connection:other-connection"
              }
            }
          },
          identityDeclaration: {
            ...mapping.thread.identityDeclaration,
            scopeKind: "source_connection"
          }
        }
      }
    });

    for (const invalid of [
      wrongThread,
      wrongAccount,
      wrongGeneration,
      wrongDeclaration,
      skippedInitialRevision,
      wrongAccountScopedOwner,
      wrongConnectionScopedOwner
    ]) {
      expect(
        inboxV2SourceThreadBindingCreationCommitSchema.safeParse(invalid)
          .success
      ).toBe(false);
    }
  });

  it("validates bounded current pages without loading lifetime history", () => {
    const secondConnection = {
      tenantId,
      kind: "source_connection" as const,
      id: "source_connection:connection-2"
    };
    const secondAccount = {
      tenantId,
      kind: "source_account" as const,
      id: "source_account:account-2"
    };
    const firstHead = deriveInboxV2SourceThreadBindingCurrentHead(binding());
    const secondHead = deriveInboxV2SourceThreadBindingCurrentHead(
      binding({
        id: "source_thread_binding:binding-2",
        sourceConnection: secondConnection,
        sourceAccount: secondAccount,
        accountIdentitySnapshot: accountIdentity({
          sourceConnection: secondConnection,
          sourceAccount: secondAccount,
          canonicalExternalSubject: "AccountDEF"
        })
      })
    );
    const valid = {
      tenantId,
      externalThread: binding().externalThread,
      items: [firstHead, secondHead],
      nextCursor: null
    };
    expect(
      inboxV2SourceThreadBindingCurrentPageSchema.safeParse(valid).success
    ).toBe(true);
    expect(
      inboxV2SourceThreadBindingCurrentPageSchema.safeParse({
        ...valid,
        items: [firstHead, firstHead]
      }).success
    ).toBe(false);
    expect(Object.keys(firstHead)).not.toContain("routeDescriptor");
    expect(Object.keys(firstHead)).not.toContain("capabilities");
    expect(Object.keys(firstHead.historySync)).toEqual(["state", "revision"]);
    expect(
      inboxV2SourceThreadBindingCurrentPageSchema.safeParse({
        ...valid,
        items: [
          {
            ...firstHead,
            routeDescriptor: binding().routeDescriptor
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCurrentPageSchema.safeParse({
        ...valid,
        items: [
          {
            ...firstHead,
            historySync: {
              ...firstHead.historySync,
              historyCursor: "leaked-history-cursor"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingCurrentPageSchema.safeParse({
        ...valid,
        items: Array.from(
          { length: INBOX_V2_SOURCE_THREAD_BINDING_CURRENT_PAGE_MAX + 1 },
          () => firstHead
        )
      }).success
    ).toBe(false);
  });

  it("atomically closes and opens remote-access episodes", () => {
    const commit = remoteAccessCommit();
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2SourceThreadBindingRemoteAccessEpisodeSchema.parse(
        commit.closedRemoteAccessEpisode
      ).endedAt
    ).toBe(t1);
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...commit.transition,
        resultingRemoteAccess: {
          ...commit.transition.resultingRemoteAccess,
          evidenceAuthority: "advisory_snapshot",
          evidence: [
            {
              tenantId,
              kind: "provider_roster_evidence",
              id: "provider_roster_evidence:partial-roster-1"
            }
          ]
        },
        evidence: [
          {
            tenantId,
            kind: "provider_roster_evidence",
            id: "provider_roster_evidence:partial-roster-1"
          }
        ]
      }).success
    ).toBe(false);

    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...commit.transition,
        resultingRemoteAccess: {
          ...commit.transition.resultingRemoteAccess,
          evidenceAuthority: "direct_observation"
        }
      }).success
    ).toBe(false);
  });

  it("prevents provider observations from changing administrative state", () => {
    const commit = remoteAccessCommit();
    const invalidAfter = structuredClone(commit.after);
    invalidAfter.binding.administrative = {
      state: "disabled",
      revision: "2",
      changedAt: t1
    };

    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse({
        ...commit,
        after: invalidAfter
      }).success
    ).toBe(false);
  });

  it("allows an audited administrative transition without changing provider axes", () => {
    const resultingAdministrative = {
      state: "disabled",
      revision: "2",
      changedAt: t1
    };
    const commit = axisCommit(
      {
        kind: "administrative",
        actor: employeeActor(),
        fromState: "enabled",
        toState: "disabled",
        expectedAdministrativeRevision: "1",
        resultingAdministrative,
        authorizationDecision: administrativeAuthorizationDecision()
      },
      { administrative: resultingAdministrative }
    );

    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);

    for (const invalidDecision of [
      administrativeAuthorizationDecision({
        effect: "deny",
        matchedPermissionIds: []
      }),
      administrativeAuthorizationDecision({
        target: {
          ...administrativeAuthorizationDecision().target,
          sourceAccount: {
            tenantId,
            kind: "source_account",
            id: "source_account:wrong-scope"
          }
        }
      }),
      administrativeAuthorizationDecision({
        authorizationEpoch: "authorization-epoch-stale"
      }),
      administrativeAuthorizationDecision({
        matchedPermissionIds: ["module:synthetic-source:provider-member"]
      }),
      administrativeAuthorizationDecision({ notAfter: t0 })
    ]) {
      expect(
        inboxV2SourceThreadBindingTransitionCommitSchema.safeParse({
          ...commit,
          transition: {
            ...commit.transition,
            authorizationDecision: invalidDecision
          }
        }).success
      ).toBe(false);
    }
  });

  it("allows health changes without changing membership or route generations", () => {
    const resultingRuntimeHealth = {
      state: "degraded",
      revision: "2",
      checkedAt: t1,
      diagnostic: safeDiagnostic()
    };
    const commit = axisCommit(
      {
        kind: "runtime_health",
        fromState: "ready",
        toState: "degraded",
        expectedRuntimeHealthRevision: "1",
        resultingRuntimeHealth
      },
      { runtimeHealth: resultingRuntimeHealth }
    );

    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);

    const changedGeneration = structuredClone(commit);
    changedGeneration.after.binding.bindingGeneration = "2";
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        changedGeneration
      ).success
    ).toBe(false);
  });

  it("allows only fenced ready heartbeats and live cursor progress as same-state transitions", () => {
    const heartbeat = {
      state: "ready",
      revision: "2",
      checkedAt: t1,
      diagnostic: null
    };
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        axisCommit(
          {
            kind: "runtime_health",
            fromState: "ready",
            toState: "ready",
            expectedRuntimeHealthRevision: "1",
            resultingRuntimeHealth: heartbeat
          },
          { runtimeHealth: heartbeat }
        )
      ).success
    ).toBe(true);

    const liveProgress = {
      ...binding().historySync,
      revision: "2",
      receiveCursor: "receive-cursor-2",
      providerWatermark: "watermark-2",
      updatedAt: t1
    };
    const progressCommit = axisCommit(
      {
        kind: "history_sync",
        fromState: "live",
        toState: "live",
        expectedHistorySyncRevision: "1",
        resultingHistorySync: liveProgress
      },
      { historySync: liveProgress }
    );
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(progressCommit)
        .success
    ).toBe(true);

    const freshnessOnly = structuredClone(progressCommit);
    freshnessOnly.transition.resultingHistorySync.receiveCursor =
      "receive-cursor-1";
    freshnessOnly.transition.resultingHistorySync.providerWatermark =
      "watermark-1";
    freshnessOnly.after.binding.historySync.receiveCursor = "receive-cursor-1";
    freshnessOnly.after.binding.historySync.providerWatermark = "watermark-1";
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(freshnessOnly)
        .success
    ).toBe(false);

    for (const state of ["backfilling", "catching_up"] as const) {
      const beforeHistory = {
        ...binding().historySync,
        state,
        receiveCursor: `${state}-cursor-1`
      };
      const afterHistory = {
        ...beforeHistory,
        revision: "2",
        receiveCursor: `${state}-cursor-2`,
        updatedAt: t1
      };
      const commit = {
        before: projection({
          binding: binding({ historySync: beforeHistory })
        }),
        transition: {
          ...transitionBase(),
          kind: "history_sync",
          fromState: state,
          toState: state,
          expectedHistorySyncRevision: "1",
          resultingHistorySync: afterHistory
        },
        after: projection({
          binding: binding({
            historySync: afterHistory,
            revision: "2",
            updatedAt: t1
          })
        }),
        closedRemoteAccessEpisode: null
      };
      expect(
        inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit)
          .success
      ).toBe(true);

      const noOp = structuredClone(commit);
      noOp.transition.resultingHistorySync.receiveCursor = `${state}-cursor-1`;
      noOp.after.binding.historySync.receiveCursor = `${state}-cursor-1`;
      expect(
        inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(noOp).success
      ).toBe(false);
    }
  });

  it("requires trusted service actors for provider-owned axes", () => {
    const transition = remoteAccessCommit().transition;
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...transition,
        actor: {
          kind: "employee",
          employee: {
            tenantId,
            kind: "employee",
            id: "employee:employee-1"
          }
        }
      }).success
    ).toBe(false);

    const validCommit = remoteAccessCommit();
    const foreignServiceCommit = {
      ...validCommit,
      transition: {
        ...validCommit.transition,
        actor: {
          kind: "trusted_service" as const,
          trustedServiceId: "core:foreign-source-runtime"
        }
      }
    };
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        foreignServiceCommit
      ).success
    ).toBe(false);

    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...transitionBase(),
        kind: "administrative",
        actor: trustedActor(),
        fromState: "disabled",
        toState: "enabled",
        expectedAdministrativeRevision: "1",
        resultingAdministrative: {
          state: "enabled",
          revision: "2",
          changedAt: t1
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...transition,
        evidence: [
          {
            tenantId: "tenant:other",
            kind: "raw_inbound_event",
            id: "raw_inbound_event:raw-2"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("increments route descriptor and binding generation together", () => {
    const resultingRouteDescriptor = routeDescriptor({
      descriptorRevision: "2",
      destinationSubject: "GroupABC-v2",
      descriptorDigestSha256: "b".repeat(64)
    });
    const commit = axisCommit(
      {
        kind: "route_descriptor",
        expectedBindingGeneration: "1",
        resultingBindingGeneration: "2",
        expectedRouteDescriptorRevision: "1",
        resultingRouteDescriptor,
        evidence: [secondRawEvidence]
      },
      {
        bindingGeneration: "2",
        routeDescriptor: resultingRouteDescriptor
      }
    );

    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...commit.transition,
        resultingBindingGeneration: "1"
      }).success
    ).toBe(false);
  });

  it("reauthenticates the same canonical account while rejecting account replacement", () => {
    const resultingAccountIdentitySnapshot = accountIdentity({
      accountGeneration: "2",
      verificationEvidence: [secondRawEvidence],
      verifiedAt: t1
    });
    const commit = axisCommit(
      {
        kind: "account_generation",
        expectedAccountGeneration: "1",
        resultingAccountIdentitySnapshot,
        evidence: [secondRawEvidence]
      },
      { accountIdentitySnapshot: resultingAccountIdentitySnapshot }
    );

    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);

    const replacement = structuredClone(commit);
    replacement.transition.resultingAccountIdentitySnapshot.canonicalExternalSubject =
      "DifferentAccount";
    replacement.after.binding.accountIdentitySnapshot.canonicalExternalSubject =
      "DifferentAccount";
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(replacement)
        .success
    ).toBe(false);

    const reinterpreted = structuredClone(commit);
    reinterpreted.transition.resultingAccountIdentitySnapshot.declaration.canonicalizationVersion =
      "v2";
    reinterpreted.after.binding.accountIdentitySnapshot.declaration.canonicalizationVersion =
      "v2";
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(reinterpreted)
        .success
    ).toBe(false);
  });

  it("updates capability, history and provider-access projections through their own CAS", () => {
    const resultingCapabilities = capabilitySnapshot({
      revision: "2",
      capturedAt: t1,
      entries: [
        capabilityEntry({
          state: "temporarily_unavailable",
          diagnostic: safeDiagnostic()
        })
      ]
    });
    const capabilityCommit = axisCommit(
      {
        kind: "capabilities",
        expectedCapabilityRevision: "1",
        resultingCapabilities,
        evidence: [secondRawEvidence]
      },
      { capabilities: resultingCapabilities }
    );
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        capabilityCommit
      ).success
    ).toBe(true);

    const resultingHistorySync = {
      ...binding().historySync,
      state: "paused",
      revision: "2",
      updatedAt: t1,
      diagnostic: safeDiagnostic()
    };
    const historyCommit = axisCommit(
      {
        kind: "history_sync",
        fromState: "live",
        toState: "paused",
        expectedHistorySyncRevision: "1",
        resultingHistorySync
      },
      { historySync: resultingHistorySync }
    );
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(historyCommit)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...historyCommit.transition,
        toState: "backfilling",
        resultingHistorySync: {
          ...resultingHistorySync,
          state: "backfilling"
        }
      }).success
    ).toBe(false);

    const resultingProviderAccess = {
      revision: "2",
      roleIds: ["module:synthetic-source:provider-owner"],
      evidence: [secondRawEvidence],
      observedAt: t1
    };
    const accessCommit = axisCommit(
      {
        kind: "provider_access",
        expectedProviderAccessRevision: "1",
        expectedBindingGeneration: "1",
        resultingBindingGeneration: "2",
        resultingProviderAccess,
        evidence: [secondRawEvidence]
      },
      {
        providerAccess: resultingProviderAccess,
        bindingGeneration: "2"
      }
    );
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(accessCommit)
        .success
    ).toBe(true);
    expect(
      deriveInboxV2SourceThreadBindingFence(accessCommit.after.binding)
        .bindingGeneration
    ).toBe("2");
    expect(
      inboxV2SourceThreadBindingTransitionSchema.safeParse({
        ...accessCommit.transition,
        resultingBindingGeneration: "1"
      }).success
    ).toBe(false);
  });

  it("keeps freshness-only capability and provider-role observations outside effective fence transitions", () => {
    const freshnessOnlyCapabilities = capabilitySnapshot({
      adapterContract: adapterContract({ loadedAt: t1 }),
      revision: "2",
      capturedAt: t1,
      entries: [capabilityEntry({ evidence: [secondRawEvidence] })]
    });
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        axisCommit(
          {
            kind: "capabilities",
            expectedCapabilityRevision: "1",
            resultingCapabilities: freshnessOnlyCapabilities,
            evidence: [secondRawEvidence]
          },
          { capabilities: freshnessOnlyCapabilities }
        )
      ).success
    ).toBe(false);

    const freshnessOnlyProviderAccess = {
      revision: "2",
      roleIds: [...binding().providerAccess.roleIds],
      evidence: [secondRawEvidence],
      observedAt: t1
    };
    expect(
      inboxV2SourceThreadBindingTransitionCommitSchema.safeParse(
        axisCommit(
          {
            kind: "provider_access",
            expectedProviderAccessRevision: "1",
            expectedBindingGeneration: "1",
            resultingBindingGeneration: "2",
            resultingProviderAccess: freshnessOnlyProviderAccess,
            evidence: [secondRawEvidence]
          },
          {
            providerAccess: freshnessOnlyProviderAccess,
            bindingGeneration: "2"
          }
        )
      ).success
    ).toBe(false);
  });

  it("rejects stale, skipped and same-state transitions", () => {
    const transition = remoteAccessCommit().transition;

    for (const invalid of [
      { ...transition, expectedBindingRevision: "2" },
      { ...transition, resultingBindingRevision: "3" },
      { ...transition, toState: "active" },
      {
        ...transition,
        resultingRemoteAccess: {
          ...transition.resultingRemoteAccess,
          revision: "3"
        }
      }
    ]) {
      expect(
        inboxV2SourceThreadBindingTransitionSchema.safeParse(invalid).success
      ).toBe(false);
    }
  });

  it("rejects V1 recipient and connector fields from the binding contract", () => {
    for (const legacyField of [
      "channelExternalId",
      "clientExternalId",
      "connectorId",
      "chatId"
    ]) {
      expect(
        inboxV2SourceThreadBindingSchema.safeParse({
          ...binding(),
          [legacyField]: "legacy-value"
        }).success
      ).toBe(false);
    }
  });

  it("binds the exact schema ID/version and keeps revision values as strings", () => {
    const envelope = {
      schemaId: INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_ID,
      schemaVersion: INBOX_V2_SOURCE_THREAD_BINDING_SCHEMA_VERSION,
      payload: binding()
    };

    expect(inboxV2SourceThreadBindingEnvelopeSchema.parse(envelope)).toEqual(
      envelope
    );
    expect(
      inboxV2SourceThreadBindingEnvelopeSchema.safeParse({
        ...envelope,
        schemaVersion: "v2"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceThreadBindingFenceSchema.safeParse({
        ...deriveInboxV2SourceThreadBindingFence(binding()),
        accountGeneration: 1
      }).success
    ).toBe(false);
  });
});
