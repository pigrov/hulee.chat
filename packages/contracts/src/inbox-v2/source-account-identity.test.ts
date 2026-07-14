import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_ID,
  INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
  inboxV2CanonicalSourceAccountIdentityKeySchema,
  inboxV2SourceAccountIdentityAliasSchema,
  inboxV2SourceAccountIdentityEnvelopeSchema,
  inboxV2SourceAccountIdentitySchema,
  inboxV2SourceAccountIdentityTransitionCommitSchema,
  inboxV2SourceAccountIdentityTransitionSchema
} from "./source-account-identity";

const tenantId = "tenant:alpha";
const otherTenantId = "tenant:beta";
const sourceConnection = {
  tenantId,
  kind: "source_connection" as const,
  id: "source_connection:synthetic-primary"
};
const sourceAccount = {
  tenantId,
  kind: "source_account" as const,
  id: "source_account:synthetic-operator"
};
const adapterContract = {
  contractId: "module:synthetic:direct-account-contract",
  contractVersion: "v1",
  declarationRevision: "1",
  surfaceId: "module:synthetic:personal-session",
  loadedByTrustedServiceId: "core:routing-resolver",
  loadedAt: "2026-07-11T08:00:00.000Z"
};
const providerDeclaration = {
  adapterContract,
  identityKind: "source_account" as const,
  realmId: "module:synthetic:account-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic:personal-account",
  scopeKind: "provider" as const,
  decisionStrength: "authoritative" as const
};
const realm = {
  realmId: "module:synthetic:account-realm",
  realmVersion: "v1",
  canonicalizationVersion: "v1",
  objectKindId: "module:synthetic:personal-account"
};
const providerScope = { kind: "provider" as const };
const provisionalIdentity = {
  kind: "connector_session" as const,
  sourceConnection,
  adapterContract,
  connectorSessionSubject: "session:Ephemeral-ABC",
  observedAt: "2026-07-11T08:00:00.000Z"
};
const promotionDecision = decisionAt(
  "2026-07-11T08:05:00.000Z",
  "core:account-verified"
);
const canonicalIdentity = {
  realm,
  scope: providerScope,
  canonicalExternalSubject: "ProviderAccount:Case-Sensitive-42"
};
const provisionalState = {
  tenantId,
  sourceAccount,
  sourceConnection,
  identityDeclaration: providerDeclaration,
  accountGeneration: "1",
  revision: "1",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:00:00.000Z",
  state: "provisional" as const,
  expectedCanonicalScope: providerScope,
  provisionalIdentity,
  canonicalIdentity: null,
  verifiedBy: null,
  conflict: null
};
const verifiedState = {
  tenantId,
  sourceAccount,
  sourceConnection,
  identityDeclaration: providerDeclaration,
  accountGeneration: "2",
  revision: "2",
  createdAt: "2026-07-11T08:00:00.000Z",
  updatedAt: "2026-07-11T08:05:00.000Z",
  state: "verified" as const,
  expectedCanonicalScope: null,
  provisionalIdentity: null,
  canonicalIdentity,
  verifiedBy: promotionDecision,
  conflict: null
};
const promotionTransition = {
  tenantId,
  id: "source_account_identity_transition:promote-1",
  sourceAccount,
  intent: "promote_verified" as const,
  fromState: "provisional" as const,
  toState: "verified" as const,
  expectedRevision: "1",
  currentRevision: "1",
  resultingRevision: "2",
  expectedAccountGeneration: "1",
  currentAccountGeneration: "1",
  resultingAccountGeneration: "2",
  decision: promotionDecision,
  occurredAt: "2026-07-11T08:05:00.000Z"
};
const promotionAlias = makeAlias({
  id: "source_account_identity_alias:session-abc",
  provisionalIdentity,
  decision: promotionDecision,
  createdAt: "2026-07-11T08:05:00.000Z"
});

describe("Inbox V2 source account identity contracts", () => {
  it("accepts strict provisional and verified identity states", () => {
    expect(
      inboxV2SourceAccountIdentitySchema.parse(provisionalState).state
    ).toBe("provisional");
    expect(inboxV2SourceAccountIdentitySchema.parse(verifiedState).state).toBe(
      "verified"
    );
  });

  it("keeps connector/session observations structurally separate from canonical keys", () => {
    expect(
      inboxV2CanonicalSourceAccountIdentityKeySchema.safeParse(
        provisionalIdentity
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...provisionalState,
        canonicalIdentity,
        canonicalExternalSubject: "session:Ephemeral-ABC"
      }).success
    ).toBe(false);
  });

  it("preserves canonical provider subject casing without trimming or folding", () => {
    const parsed = inboxV2CanonicalSourceAccountIdentityKeySchema.parse({
      ...canonicalIdentity,
      canonicalExternalSubject: " Provider:ABC "
    });
    expect(parsed.canonicalExternalSubject).toBe(" Provider:ABC ");
  });

  it("requires exact authoritative source-account declarations", () => {
    for (const identityDeclaration of [
      { ...providerDeclaration, identityKind: "external_thread" },
      { ...providerDeclaration, realmId: "module:synthetic:wrong-realm" },
      { ...providerDeclaration, objectKindId: "module:synthetic:wrong-kind" },
      { ...providerDeclaration, scopeKind: "source_account" },
      { ...providerDeclaration, decisionStrength: "safe_default" }
    ]) {
      expect(
        inboxV2SourceAccountIdentitySchema.safeParse({
          ...verifiedState,
          identityDeclaration
        }).success
      ).toBe(false);
    }
  });

  it("supports authoritative connection-scoped account keys with exact owner", () => {
    const connectionDeclaration = {
      ...providerDeclaration,
      scopeKind: "source_connection" as const
    };
    const connectionIdentity = {
      ...verifiedState,
      identityDeclaration: connectionDeclaration,
      canonicalIdentity: {
        ...canonicalIdentity,
        scope: { kind: "source_connection" as const, owner: sourceConnection }
      }
    };
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse(connectionIdentity).success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...connectionIdentity,
        canonicalIdentity: {
          ...connectionIdentity.canonicalIdentity,
          scope: {
            kind: "source_connection",
            owner: {
              ...sourceConnection,
              id: "source_connection:different"
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("rejects every cross-tenant account, connection and scope edge", () => {
    const foreignConnection = {
      ...sourceConnection,
      tenantId: otherTenantId
    };
    for (const value of [
      {
        ...provisionalState,
        sourceAccount: { ...sourceAccount, tenantId: otherTenantId }
      },
      { ...provisionalState, sourceConnection: foreignConnection },
      {
        ...provisionalState,
        provisionalIdentity: {
          ...provisionalIdentity,
          sourceConnection: foreignConnection
        }
      }
    ]) {
      expect(inboxV2SourceAccountIdentitySchema.safeParse(value).success).toBe(
        false
      );
    }
  });

  it("binds a verified promotion, CAS advance and direct alias atomically", () => {
    const commit = {
      tenantId,
      previousIdentity: provisionalState,
      resultingIdentity: verifiedState,
      transition: promotionTransition,
      aliases: [promotionAlias],
      committedAt: "2026-07-11T08:05:00.000Z"
    };
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse(commit)
        .success
    ).toBe(true);
  });

  it("forbids realm, canonicalization, object-kind and scope reinterpretation during promotion", () => {
    const baseCommit = {
      tenantId,
      previousIdentity: provisionalState,
      resultingIdentity: verifiedState,
      transition: promotionTransition,
      aliases: [promotionAlias],
      committedAt: "2026-07-11T08:05:00.000Z"
    };

    for (const [identityDeclaration, promotedCanonicalIdentity] of [
      [
        { ...providerDeclaration, realmVersion: "v2" },
        {
          ...canonicalIdentity,
          realm: { ...realm, realmVersion: "v2" }
        }
      ],
      [
        { ...providerDeclaration, canonicalizationVersion: "v2" },
        {
          ...canonicalIdentity,
          realm: { ...realm, canonicalizationVersion: "v2" }
        }
      ],
      [
        {
          ...providerDeclaration,
          objectKindId: "module:synthetic:replacement-account"
        },
        {
          ...canonicalIdentity,
          realm: {
            ...realm,
            objectKindId: "module:synthetic:replacement-account"
          }
        }
      ],
      [
        {
          ...providerDeclaration,
          adapterContract: {
            ...adapterContract,
            declarationRevision: "2",
            loadedAt: "2026-07-11T08:01:00.000Z"
          }
        },
        canonicalIdentity
      ]
    ] as const) {
      const reinterpretedResult = {
        ...verifiedState,
        identityDeclaration,
        canonicalIdentity: promotedCanonicalIdentity
      };
      expect(
        inboxV2SourceAccountIdentitySchema.safeParse(reinterpretedResult)
          .success
      ).toBe(true);
      expect(
        inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
          ...baseCommit,
          resultingIdentity: reinterpretedResult
        }).success
      ).toBe(false);
    }

    const connectionScope = {
      kind: "source_connection" as const,
      owner: sourceConnection
    };
    const connectionDeclaration = {
      ...providerDeclaration,
      scopeKind: "source_connection" as const
    };
    const connectionCanonicalIdentity = {
      ...canonicalIdentity,
      scope: connectionScope
    };
    const connectionVerifiedState = {
      ...verifiedState,
      identityDeclaration: connectionDeclaration,
      canonicalIdentity: connectionCanonicalIdentity
    };
    const connectionAlias = {
      ...promotionAlias,
      identityDeclaration: connectionDeclaration,
      canonicalIdentitySnapshot: connectionCanonicalIdentity
    };
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse(connectionVerifiedState)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        resultingIdentity: connectionVerifiedState,
        aliases: [connectionAlias]
      }).success
    ).toBe(false);

    const connectionProvisionalState = {
      ...provisionalState,
      identityDeclaration: connectionDeclaration,
      expectedCanonicalScope: connectionScope
    };
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse(connectionProvisionalState)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        previousIdentity: connectionProvisionalState
      }).success
    ).toBe(false);
  });

  it("validates the expected connection-scope owner tenant even when its ID matches", () => {
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...provisionalState,
        identityDeclaration: {
          ...providerDeclaration,
          scopeKind: "source_connection"
        },
        expectedCanonicalScope: {
          kind: "source_connection",
          owner: { ...sourceConnection, tenantId: otherTenantId }
        }
      }).success
    ).toBe(false);
  });

  it("rejects stale or non-contiguous revision and account-generation promotion", () => {
    for (const transition of [
      { ...promotionTransition, expectedRevision: "0" },
      { ...promotionTransition, resultingRevision: "3" },
      { ...promotionTransition, expectedAccountGeneration: "2" },
      { ...promotionTransition, resultingAccountGeneration: "3" }
    ]) {
      expect(
        inboxV2SourceAccountIdentityTransitionSchema.safeParse(transition)
          .success
      ).toBe(false);
    }
  });

  it("does not allow verified identity replacement on the same SourceAccount", () => {
    expect(
      inboxV2SourceAccountIdentityTransitionSchema.safeParse({
        ...promotionTransition,
        intent: "replace_verified",
        fromState: "verified",
        toState: "verified"
      }).success
    ).toBe(false);
  });

  it("advances a verified account generation while preserving canonical identity and old evidence", () => {
    const reauthTime = "2026-07-11T09:00:00.000Z";
    const reauthDecision = decisionAt(reauthTime, "core:reauth-same-account");
    const reauthenticationIdentity = {
      ...provisionalIdentity,
      connectorSessionSubject: "session:reauth-generation-3",
      observedAt: reauthTime
    };
    const reauthenticatedState = {
      ...verifiedState,
      accountGeneration: "3",
      revision: "3",
      updatedAt: reauthTime,
      verifiedBy: reauthDecision
    };
    const reauthTransition = {
      tenantId,
      id: "source_account_identity_transition:reauth-generation-3",
      sourceAccount,
      intent: "reauthenticate_verified" as const,
      fromState: "verified" as const,
      toState: "verified" as const,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      expectedAccountGeneration: "2",
      currentAccountGeneration: "2",
      resultingAccountGeneration: "3",
      reauthenticationIdentity,
      decision: reauthDecision,
      occurredAt: reauthTime
    };
    const reauthAlias = makeAlias({
      id: "source_account_identity_alias:reauth-generation-3",
      provisionalIdentity: reauthenticationIdentity,
      decision: reauthDecision,
      expectedRevision: "3",
      expectedGeneration: "3",
      createdAt: reauthTime
    });
    const commit = {
      tenantId,
      previousIdentity: verifiedState,
      resultingIdentity: reauthenticatedState,
      transition: reauthTransition,
      aliases: [reauthAlias],
      committedAt: reauthTime
    };

    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse(commit)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentityAliasSchema.safeParse(promotionAlias).success
    ).toBe(true);

    for (const invalidCommit of [
      { ...commit, aliases: [] },
      { ...commit, aliases: [reauthAlias, reauthAlias] },
      {
        ...commit,
        transition: { ...reauthTransition, expectedAccountGeneration: "1" }
      },
      {
        ...commit,
        resultingIdentity: {
          ...reauthenticatedState,
          canonicalIdentity: {
            ...canonicalIdentity,
            canonicalExternalSubject: "ProviderAccount:replacement"
          }
        },
        aliases: [
          {
            ...reauthAlias,
            canonicalIdentitySnapshot: {
              ...canonicalIdentity,
              canonicalExternalSubject: "ProviderAccount:replacement"
            }
          }
        ]
      },
      {
        ...commit,
        aliases: [
          {
            ...reauthAlias,
            provisionalIdentity: {
              ...reauthenticationIdentity,
              connectorSessionSubject: "session:substituted"
            }
          }
        ]
      }
    ]) {
      expect(
        inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse(
          invalidCommit
        ).success
      ).toBe(false);
    }
  });

  it("rejects future connector/session evidence at every account identity boundary", () => {
    const futureObservation = {
      ...provisionalIdentity,
      observedAt: "2026-07-11T10:00:00.000Z"
    };

    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...provisionalState,
        provisionalIdentity: futureObservation
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityAliasSchema.safeParse({
        ...promotionAlias,
        provisionalIdentity: futureObservation
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionSchema.safeParse({
        tenantId,
        id: "source_account_identity_transition:future-reauth",
        sourceAccount,
        intent: "reauthenticate_verified",
        fromState: "verified",
        toState: "verified",
        expectedRevision: "2",
        currentRevision: "2",
        resultingRevision: "3",
        expectedAccountGeneration: "2",
        currentAccountGeneration: "2",
        resultingAccountGeneration: "3",
        reauthenticationIdentity: futureObservation,
        decision: promotionDecision,
        occurredAt: promotionDecision.decidedAt
      }).success
    ).toBe(false);
  });

  it("requires promotion to preserve the exact prior connector/session alias", () => {
    const otherAlias = makeAlias({
      id: "source_account_identity_alias:other-session",
      provisionalIdentity: {
        ...provisionalIdentity,
        connectorSessionSubject: "session:other"
      },
      decision: promotionDecision,
      createdAt: "2026-07-11T08:05:00.000Z"
    });
    const baseCommit = {
      tenantId,
      previousIdentity: provisionalState,
      resultingIdentity: verifiedState,
      transition: promotionTransition,
      aliases: [promotionAlias],
      committedAt: "2026-07-11T08:05:00.000Z"
    };
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        aliases: []
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        aliases: [otherAlias]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        aliases: [
          {
            ...promotionAlias,
            decision: {
              ...promotionDecision,
              reasonCodeId: "core:different-decision"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        ...baseCommit,
        aliases: [
          {
            ...promotionAlias,
            provisionalIdentity: {
              ...provisionalIdentity,
              observedAt: "2026-07-11T08:00:01.000Z"
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("pins promotion and alias decisions to the declaration loader", () => {
    const wrongDecision = {
      ...promotionDecision,
      actor: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:foreign-identity-resolver"
      }
    };
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...verifiedState,
        verifiedBy: wrongDecision
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityAliasSchema.safeParse({
        ...promotionAlias,
        decision: wrongDecision
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        tenantId,
        previousIdentity: provisionalState,
        resultingIdentity: { ...verifiedState, verifiedBy: wrongDecision },
        transition: { ...promotionTransition, decision: wrongDecision },
        aliases: [{ ...promotionAlias, decision: wrongDecision }],
        committedAt: "2026-07-11T08:05:00.000Z"
      }).success
    ).toBe(false);
  });

  it("rejects alias target, snapshot, adapter evidence and immutability mismatches", () => {
    for (const alias of [
      {
        ...promotionAlias,
        provisionalIdentity: {
          ...provisionalIdentity,
          adapterContract: {
            ...adapterContract,
            declarationRevision: "2"
          }
        }
      },
      {
        ...promotionAlias,
        identityDeclaration: {
          ...providerDeclaration,
          identityKind: "external_thread"
        }
      },
      { ...promotionAlias, revision: "2" }
    ]) {
      expect(
        inboxV2SourceAccountIdentityAliasSchema.safeParse(alias).success
      ).toBe(false);
    }

    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        tenantId,
        previousIdentity: provisionalState,
        resultingIdentity: verifiedState,
        transition: promotionTransition,
        aliases: [
          {
            ...promotionAlias,
            canonicalSourceAccount: {
              ...sourceAccount,
              id: "source_account:other"
            }
          }
        ],
        committedAt: "2026-07-11T08:05:00.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        tenantId,
        previousIdentity: provisionalState,
        resultingIdentity: verifiedState,
        transition: promotionTransition,
        aliases: [
          {
            ...promotionAlias,
            canonicalIdentitySnapshot: {
              ...canonicalIdentity,
              canonicalExternalSubject: "ProviderAccount:other"
            }
          }
        ],
        committedAt: "2026-07-11T08:05:00.000Z"
      }).success
    ).toBe(false);
  });

  it("records conflict without creating a canonical alias", () => {
    const conflictDecision = decisionAt(
      "2026-07-11T08:04:00.000Z",
      "core:canonical-account-conflict"
    );
    const conflictedState = {
      ...provisionalState,
      state: "conflicted" as const,
      accountGeneration: "2",
      revision: "2",
      updatedAt: "2026-07-11T08:04:00.000Z",
      conflict: {
        provisionalIdentity,
        expectedCanonicalScope: providerScope,
        attemptedCanonicalIdentities: [canonicalIdentity],
        diagnostic: {
          codeId: "core:source-account-identity-conflict",
          retryable: false,
          correlationToken: "corr.conflict-1",
          safeOperatorHintId: "core:review-account-identity"
        },
        decision: conflictDecision,
        detectedAt: "2026-07-11T08:04:00.000Z"
      }
    };
    const transition = {
      ...promotionTransition,
      id: "source_account_identity_transition:conflict-1",
      intent: "mark_conflicted" as const,
      fromState: "provisional" as const,
      toState: "conflicted" as const,
      decision: conflictDecision,
      occurredAt: "2026-07-11T08:04:00.000Z"
    };
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        tenantId,
        previousIdentity: provisionalState,
        resultingIdentity: conflictedState,
        transition,
        aliases: [],
        committedAt: "2026-07-11T08:04:00.000Z"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentityTransitionCommitSchema.safeParse({
        tenantId,
        previousIdentity: provisionalState,
        resultingIdentity: {
          ...conflictedState,
          provisionalIdentity: {
            ...provisionalIdentity,
            connectorSessionSubject: "session:substituted"
          },
          conflict: {
            ...conflictedState.conflict,
            provisionalIdentity: {
              ...provisionalIdentity,
              connectorSessionSubject: "session:substituted"
            }
          }
        },
        transition,
        aliases: [],
        committedAt: "2026-07-11T08:04:00.000Z"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...conflictedState,
        conflict: {
          ...conflictedState.conflict,
          attemptedCanonicalIdentities: [canonicalIdentity, canonicalIdentity]
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceAccountIdentitySchema.safeParse({
        ...conflictedState,
        conflict: {
          ...conflictedState.conflict,
          decision: {
            ...conflictDecision,
            actor: {
              kind: "trusted_service",
              trustedServiceId: "core:foreign-identity-resolver"
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("uses exact strict versioned envelopes", () => {
    expect(
      inboxV2SourceAccountIdentityEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_ID,
        schemaVersion: INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_VERSION,
        payload: verifiedState
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceAccountIdentityEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_SOURCE_ACCOUNT_IDENTITY_SCHEMA_ID,
        schemaVersion: "v2",
        payload: verifiedState
      }).success
    ).toBe(false);
  });

  it("rejects caller-injected actor, account, route and generic status fields", () => {
    for (const [field, value] of [
      ["appActor", { kind: "employee", id: "employee:caller" }],
      ["connectorId", "connector:session"],
      ["route", { destination: "provider" }],
      ["status", "active"]
    ] as const) {
      expect(
        inboxV2SourceAccountIdentitySchema.safeParse({
          ...verifiedState,
          [field]: value
        }).success
      ).toBe(false);
    }
  });
});

function decisionAt(decidedAt: string, reasonCodeId: string) {
  return {
    actor: {
      kind: "trusted_service" as const,
      trustedServiceId: "core:routing-resolver"
    },
    policyId: "core:verified-provider-account",
    policyVersion: "v1",
    reasonCodeId,
    verificationEvidenceToken: "evidence.account-verify-1",
    decidedAt
  };
}

function makeAlias(input: {
  id: string;
  provisionalIdentity: typeof provisionalIdentity;
  decision: ReturnType<typeof decisionAt>;
  expectedRevision?: string;
  expectedGeneration?: string;
  createdAt: string;
}) {
  return {
    tenantId,
    id: input.id,
    provisionalIdentity: input.provisionalIdentity,
    canonicalSourceAccount: sourceAccount,
    canonicalIdentitySnapshot: canonicalIdentity,
    identityDeclaration: providerDeclaration,
    expectedAccountIdentityRevision: input.expectedRevision ?? "2",
    expectedAccountGeneration: input.expectedGeneration ?? "2",
    decision: input.decision,
    revision: "1",
    createdAt: input.createdAt
  };
}
