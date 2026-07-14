import { describe, expect, it } from "vitest";

import {
  INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_COMMIT_SCHEMA_ID,
  INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_MEMBER_MAX,
  INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_SCHEMA_VERSION,
  inboxV2ProviderRosterMaterializationCommitEnvelopeSchema,
  inboxV2ProviderRosterMaterializationCommitSchema
} from "./provider-roster-materialization";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
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
  "raw_inbound_event:roster-1"
);

function binding(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: sourceThreadBindingReference.id,
    externalThread: externalThreadReference,
    sourceConnection: sourceConnectionReference,
    sourceAccount: sourceAccountReference,
    accountIdentitySnapshot: {
      status: "verified" as const,
      sourceConnection: sourceConnectionReference,
      sourceAccount: sourceAccountReference,
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
      canonicalExternalSubject: "ProviderAccount:ABC",
      accountGeneration: "1",
      verificationEvidence: [rawEventReference],
      verifiedAt: t0
    },
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
    routeDescriptor: {
      adapterContract,
      descriptorSchemaId: "module:synthetic-source:group-route",
      descriptorVersion: "v1",
      descriptorRevision: "1",
      destinationKindId: "module:synthetic-source:group-peer",
      destinationSubject: "GroupABC",
      attributes: [],
      descriptorDigestSha256: "a".repeat(64)
    },
    revision: "3",
    createdAt: t0,
    updatedAt: observedAt,
    ...overrides
  };
}

function currentBindingProjection(input?: {
  binding?: ReturnType<typeof binding>;
  bindingId?: string;
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
      updatedAt: bindingSnapshot.remoteAccess.since
    }
  };
}

function evidence(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "provider_roster_evidence:roster-1",
    sourceThreadBinding: sourceThreadBindingReference,
    observation: rawEventReference,
    adapterContractVersion: adapterContract.contractVersion,
    completeness: "complete" as const,
    authority: "authoritative" as const,
    omissionPolicy: "close_missing" as const,
    ordering: {
      kind: "adapter_monotonic" as const,
      scopeToken: "roster-scope:binding-1",
      comparatorId: "module:synthetic-source:roster-sequence",
      comparatorRevision: "1",
      position: "1"
    },
    observedAt,
    watermark: "provider-watermark-1",
    revision: "1",
    ...overrides
  };
}

function member(index = 1, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: `provider_roster_member_evidence:member-${index}`,
    rosterEvidence: reference(
      "provider_roster_evidence",
      "provider_roster_evidence:roster-1"
    ),
    sourceExternalIdentity: reference(
      "source_external_identity",
      `source_external_identity:identity-${index}`
    ),
    state: "present" as const,
    normalizedRole: "member" as const,
    providerStateCode: "present",
    providerRoleCode: "participant",
    observedAt,
    revision: "1",
    ...overrides
  };
}

function membersAtCount(count: number) {
  const template = member();

  return Array.from({ length: count }, (_, index) => ({
    ...template,
    id: `provider_roster_member_evidence:member-${index + 1}`,
    sourceExternalIdentity: {
      ...template.sourceExternalIdentity,
      id: `source_external_identity:identity-${index + 1}`
    }
  }));
}

function commit(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    evidence: evidence(),
    members: [member()],
    currentBindingProjection: currentBindingProjection(),
    authority: {
      kind: "trusted_service" as const,
      trustedServiceId: adapterContract.loadedByTrustedServiceId,
      authorizationToken: "authorization:provider-roster-1",
      authorizedAt: materializedAt
    },
    materializedAt,
    ...overrides
  };
}

describe("Inbox V2 provider roster materialization contract", () => {
  it("parses one exact side-effect-free commit and freezes its member set", () => {
    const parsed =
      inboxV2ProviderRosterMaterializationCommitSchema.parse(commit());

    expect(parsed.members).toHaveLength(1);
    expect(Object.isFrozen(parsed.members)).toBe(true);
    expect(
      inboxV2ProviderRosterMaterializationCommitEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_COMMIT_SCHEMA_ID,
        schemaVersion: INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_SCHEMA_VERSION,
        payload: commit()
      }).success
    ).toBe(true);
  });

  // This deliberately parses the complete 50k boundary. It remains below
  // three seconds in isolation, but can exceed Vitest's default under the
  // full gate's parallel CPU load, so only this stress assertion gets room.
  it("bounds the atomic member set", { timeout: 15_000 }, () => {
    const members = membersAtCount(
      INBOX_V2_PROVIDER_ROSTER_MATERIALIZATION_MEMBER_MAX + 1
    );

    expect(
      inboxV2ProviderRosterMaterializationCommitSchema.safeParse(
        commit({ members })
      ).success
    ).toBe(false);
  });

  it("rejects side-effect commands", () => {
    expect(
      inboxV2ProviderRosterMaterializationCommitSchema.safeParse({
        ...commit(),
        membershipCommands: []
      }).success
    ).toBe(false);
  });

  it("requires one tenant and the exact current binding projection", () => {
    expect(
      inboxV2ProviderRosterMaterializationCommitSchema.safeParse(
        commit({ tenantId: "tenant:tenant-2" })
      ).success
    ).toBe(false);

    const differentBinding = binding({
      id: "source_thread_binding:binding-2"
    });
    expect(
      inboxV2ProviderRosterMaterializationCommitSchema.safeParse(
        commit({
          currentBindingProjection: currentBindingProjection({
            binding: differentBinding,
            bindingId: differentBinding.id
          })
        })
      ).success
    ).toBe(false);
  });

  it("pins the adapter version and its trusted materialization authority", () => {
    for (const changed of [
      commit({ evidence: evidence({ adapterContractVersion: "v2" }) }),
      commit({
        authority: {
          ...commit().authority,
          trustedServiceId: "core:another-runtime"
        }
      }),
      commit({
        authority: {
          ...commit().authority,
          authorizedAt: observedAt
        }
      })
    ]) {
      expect(
        inboxV2ProviderRosterMaterializationCommitSchema.safeParse(changed)
          .success
      ).toBe(false);
    }
  });

  it("requires immutable unique members tied to the exact roster boundary", () => {
    for (const members of [
      [member(1, { revision: "2" })],
      [member(1, { observedAt: materializedAt })],
      [
        member(1, {
          rosterEvidence: reference(
            "provider_roster_evidence",
            "provider_roster_evidence:another"
          )
        })
      ],
      [member(), member()],
      [
        member(1),
        member(2, { sourceExternalIdentity: member(1).sourceExternalIdentity })
      ]
    ]) {
      expect(
        inboxV2ProviderRosterMaterializationCommitSchema.safeParse(
          commit({ members })
        ).success
      ).toBe(false);
    }

    expect(
      inboxV2ProviderRosterMaterializationCommitSchema.safeParse(
        commit({ evidence: evidence({ revision: "2" }) })
      ).success
    ).toBe(false);
  });

  it("rejects future observations, binding snapshots and adapter loads", () => {
    const future = "2026-07-11T09:03:00.000Z";
    const futureBinding = binding({ updatedAt: future });
    const futureAdapterBinding = binding({
      capabilities: {
        ...binding().capabilities,
        adapterContract: { ...adapterContract, loadedAt: materializedAt }
      }
    });

    for (const changed of [
      commit({ evidence: evidence({ observedAt: future }) }),
      commit({
        currentBindingProjection: currentBindingProjection({
          binding: futureBinding
        })
      }),
      commit({
        currentBindingProjection: currentBindingProjection({
          binding: futureAdapterBinding
        })
      })
    ]) {
      expect(
        inboxV2ProviderRosterMaterializationCommitSchema.safeParse(changed)
          .success
      ).toBe(false);
    }
  });
});
