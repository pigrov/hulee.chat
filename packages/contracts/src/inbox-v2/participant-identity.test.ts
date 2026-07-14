import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CONVERSATION_PARTICIPANT_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_AUTHOR_OBSERVATION_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
  INBOX_V2_PROVIDER_ROSTER_EVIDENCE_SCHEMA_ID,
  INBOX_V2_PROVIDER_ROSTER_MEMBER_EVIDENCE_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS,
  INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_TRANSITION_SCHEMA_ID,
  canInboxV2RosterEvidenceCloseMissingMembership,
  getInboxV2SourceIdentityClaimTargetPermission,
  inboxV2AuthExternalIdentityLinkIdSchema,
  inboxV2ConversationParticipantEnvelopeSchema,
  inboxV2ConversationParticipantSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationParticipantSubjectSchema,
  inboxV2ParticipantAuthorEvidenceSchema,
  inboxV2ParticipantAuthorObservationEnvelopeSchema,
  inboxV2ParticipantAuthorObservationSchema,
  inboxV2ParticipantMembershipEpisodeEnvelopeSchema,
  inboxV2ParticipantMembershipEpisodeSchema,
  inboxV2ParticipantMembershipGraphSchema,
  inboxV2ParticipantMembershipRoleSchema,
  inboxV2ParticipantMembershipStateSchema,
  inboxV2ParticipantMembershipTransitionEnvelopeSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2ProviderRosterCompletenessSchema,
  inboxV2ProviderRosterEvidenceEnvelopeSchema,
  inboxV2ProviderRosterEvidenceSchema,
  inboxV2ProviderRosterMemberEvidenceEnvelopeSchema,
  inboxV2ProviderRosterMemberEvidenceSchema,
  inboxV2SourceExternalIdentityEnvelopeSchema,
  inboxV2SourceExternalIdentityIdSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimEnvelopeSchema,
  inboxV2SourceIdentityClaimGraphSchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2SourceIdentityClaimSetSchema,
  inboxV2SourceIdentityClaimTransitionEnvelopeSchema,
  inboxV2SourceIdentityClaimTransitionSchema,
  isInboxV2ConfirmedInternalEmployeeMembership,
  isInboxV2SourceIdentityClaimExpectedVersionCurrent
} from "../index";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const createdAt = "2026-07-11T09:00:00.000Z";
const laterAt = "2026-07-11T10:00:00.000Z";

const employeeReference = {
  tenantId,
  kind: "employee",
  id: "employee:employee-1"
} as const;
const otherEmployeeReference = {
  tenantId,
  kind: "employee",
  id: "employee:employee-2"
} as const;
const sourceIdentityReference = {
  tenantId,
  kind: "source_external_identity",
  id: "source_external_identity:identity-1"
} as const;
const secondSourceIdentityReference = {
  tenantId,
  kind: "source_external_identity",
  id: "source_external_identity:identity-2"
} as const;
const conversationReference = {
  tenantId,
  kind: "conversation",
  id: "conversation:conversation-1"
} as const;
const participantReference = {
  tenantId,
  kind: "conversation_participant",
  id: "conversation_participant:participant-1"
} as const;
const sourceThreadBindingReference = {
  tenantId,
  kind: "source_thread_binding",
  id: "source_thread_binding:binding-1"
} as const;
const rosterEvidenceReference = {
  tenantId,
  kind: "provider_roster_evidence",
  id: "provider_roster_evidence:evidence-1"
} as const;
const rosterMemberEvidenceReference = {
  tenantId,
  kind: "provider_roster_member_evidence",
  id: "provider_roster_member_evidence:member-1"
} as const;
const internalMembershipTransitionReference = {
  tenantId,
  kind: "participant_membership_transition",
  id: "participant_membership_transition:transition-internal-1"
} as const;
const providerMembershipTransitionReference = {
  tenantId,
  kind: "participant_membership_transition",
  id: "participant_membership_transition:transition-provider-1"
} as const;
const claimTransitionReference = {
  tenantId,
  kind: "source_identity_claim_transition",
  id: "source_identity_claim_transition:transition-1"
} as const;

const baseSourceIdentity = {
  tenantId,
  id: sourceIdentityReference.id,
  realm: {
    realmId: "module:telegram-user-session:mtproto-user",
    version: "v1",
    canonicalizationVersion: "v1"
  },
  objectKindId: "module:telegram-user-session:provider-user",
  scope: { kind: "provider" },
  identityDeclaration: {
    adapterContract: {
      contractId: "module:telegram-user-session:identity-contract",
      contractVersion: "v1",
      declarationRevision: "1",
      surfaceId: "module:telegram-user-session:mtproto",
      loadedByTrustedServiceId: "core:inbox-worker",
      loadedAt: createdAt
    },
    identityKind: "source_external_identity",
    realmId: "module:telegram-user-session:mtproto-user",
    realmVersion: "v1",
    canonicalizationVersion: "v1",
    objectKindId: "module:telegram-user-session:provider-user",
    scopeKind: "provider",
    decisionStrength: "authoritative"
  },
  materializationAuthority: {
    kind: "trusted_service",
    tenantId,
    trustedServiceId: "core:inbox-worker",
    authorizationToken: "identity-create-1",
    authorizedAt: createdAt
  },
  materializedAt: createdAt,
  canonicalExternalSubject: "ProviderUserABC",
  stability: { kind: "stable" },
  resolution: { status: "unresolved" },
  latestClaimVersion: null,
  revision: "1",
  createdAt,
  updatedAt: createdAt
} as const;

const baseParticipant = {
  tenantId,
  id: participantReference.id,
  conversation: conversationReference,
  subject: {
    kind: "employee",
    employee: employeeReference
  },
  revision: "1",
  createdAt,
  updatedAt: createdAt
} as const;

const baseInternalConversation = {
  tenantId,
  id: conversationReference.id,
  topology: "group",
  transport: "internal",
  purposeId: "core:chat",
  lifecycle: "active",
  head: {
    latestTimelineSequence: "0",
    latestActivityItemId: null,
    latestActivityTimelineSequence: null,
    latestActivityAt: null,
    revision: "1",
    createdAt,
    updatedAt: createdAt
  },
  revision: "1",
  createdAt,
  updatedAt: createdAt
} as const;

const baseExternalConversation = {
  ...baseInternalConversation,
  transport: "external"
} as const;

const baseRosterEvidence = {
  tenantId,
  id: rosterEvidenceReference.id,
  sourceThreadBinding: sourceThreadBindingReference,
  observation: {
    tenantId,
    kind: "raw_inbound_event",
    id: "raw_inbound_event:roster-event-1"
  },
  adapterContractVersion: "v1",
  completeness: "partial",
  authority: "authoritative",
  omissionPolicy: "retain_missing",
  ordering: {
    kind: "adapter_monotonic",
    scopeToken: "roster-scope:binding-1",
    comparatorId: "module:synthetic-source:roster-sequence",
    comparatorRevision: "1",
    position: "1"
  },
  observedAt: createdAt,
  watermark: null,
  revision: "1"
} as const;

const baseRosterMemberEvidence = {
  tenantId,
  id: rosterMemberEvidenceReference.id,
  rosterEvidence: rosterEvidenceReference,
  sourceExternalIdentity: sourceIdentityReference,
  state: "present",
  normalizedRole: "admin",
  providerStateCode: "ParticipantActive",
  providerRoleCode: "GroupAdministrator",
  observedAt: createdAt,
  revision: "1"
} as const;

const baseInternalMembership = {
  tenantId,
  id: "participant_membership_episode:episode-internal-1",
  participant: participantReference,
  origin: { kind: "hulee_internal_command" },
  state: "active",
  role: "member",
  evidenceClassification: "confirmed",
  validFrom: createdAt,
  validTo: null,
  revision: "1"
} as const;

const baseProviderMembership = {
  tenantId,
  id: "participant_membership_episode:episode-provider-1",
  participant: participantReference,
  origin: {
    kind: "provider_roster",
    memberEvidence: rosterMemberEvidenceReference
  },
  state: "active",
  role: "admin",
  evidenceClassification: "confirmed",
  validFrom: createdAt,
  validTo: null,
  revision: "1"
} as const;

const baseInternalMembershipTransition = {
  tenantId,
  id: internalMembershipTransitionReference.id,
  episode: {
    tenantId,
    kind: "participant_membership_episode",
    id: baseInternalMembership.id
  },
  intent: "initial_active",
  fromState: null,
  toState: "active",
  fromRole: null,
  toRole: "member",
  cause: {
    kind: "hulee_internal_command",
    actorEmployee: otherEmployeeReference
  },
  reasonCodeId: "core:conversation-created",
  expectedRevision: null,
  currentRevision: null,
  resultingRevision: "1",
  occurredAt: createdAt
} as const;

const baseProviderMembershipTransition = {
  tenantId,
  id: providerMembershipTransitionReference.id,
  episode: {
    tenantId,
    kind: "participant_membership_episode",
    id: baseProviderMembership.id
  },
  intent: "initial_active",
  fromState: null,
  toState: "active",
  fromRole: null,
  toRole: "admin",
  cause: {
    kind: "provider_roster",
    evidence: {
      kind: "provider_roster_member",
      reference: rosterMemberEvidenceReference
    }
  },
  reasonCodeId: "core:provider-roster-observed",
  expectedRevision: null,
  currentRevision: null,
  resultingRevision: "1",
  occurredAt: createdAt
} as const;

const baseClaim = {
  tenantId,
  id: "source_identity_claim:claim-1",
  sourceExternalIdentity: sourceIdentityReference,
  previousClaimVersion: null,
  claimVersion: "1",
  target: {
    kind: "employee",
    employee: employeeReference
  },
  status: "active",
  confidence: "verified",
  evidenceReferences: [
    {
      kind: "raw_inbound_event",
      reference: {
        tenantId,
        kind: "raw_inbound_event",
        id: "raw_inbound_event:event-1"
      }
    }
  ],
  policyId: "core:verified-source-identity",
  policyVersion: "v1",
  reasonCodeId: "core:operator-reviewed",
  decision: {
    kind: "manual",
    actorEmployee: otherEmployeeReference,
    reviewState: "approved"
  },
  createdAt,
  revocation: null,
  revision: "1"
} as const;

const baseClaimTransition = {
  tenantId,
  id: claimTransitionReference.id,
  sourceExternalIdentity: sourceIdentityReference,
  operation: {
    kind: "claim_employee",
    target: {
      kind: "employee",
      employee: employeeReference
    },
    previousClaim: null,
    resultingClaim: {
      tenantId,
      kind: "source_identity_claim",
      id: baseClaim.id
    }
  },
  decision: baseClaim.decision,
  policyId: baseClaim.policyId,
  policyVersion: baseClaim.policyVersion,
  reasonCodeId: baseClaim.reasonCodeId,
  expectedVersion: null,
  currentVersion: null,
  resultingVersion: "1",
  occurredAt: createdAt
} as const;

function sourceIdentityWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const scope = overrides.scope as { kind?: string } | undefined;
  const identityDeclaration =
    overrides.identityDeclaration ??
    (scope === undefined
      ? baseSourceIdentity.identityDeclaration
      : {
          ...baseSourceIdentity.identityDeclaration,
          scopeKind: scope.kind
        });

  return { ...baseSourceIdentity, ...overrides, identityDeclaration };
}

function participantWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...baseParticipant, ...overrides };
}

function rosterEvidenceWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...baseRosterEvidence, ...overrides };
}

function membershipWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...baseInternalMembership, ...overrides };
}

function claimWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...baseClaim, ...overrides };
}

describe("Inbox V2 participant and identity contracts", () => {
  it("keeps authentication and source identity namespaces disjoint", () => {
    expect(
      inboxV2AuthExternalIdentityLinkIdSchema.parse(
        "auth_external_identity_link:login-link-1"
      )
    ).toBe("auth_external_identity_link:login-link-1");
    expect(
      inboxV2SourceExternalIdentityIdSchema.parse(
        "source_external_identity:identity-1"
      )
    ).toBe("source_external_identity:identity-1");

    expect(
      inboxV2AuthExternalIdentityLinkIdSchema.safeParse(
        "source_external_identity:identity-1"
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentityIdSchema.safeParse(
        "auth_external_identity_link:login-link-1"
      ).success
    ).toBe(false);
  });

  it.each([
    [{ kind: "provider" }],
    [
      {
        kind: "source_connection",
        owner: {
          tenantId,
          kind: "source_connection",
          id: "source_connection:connection-1"
        }
      }
    ],
    [
      {
        kind: "source_account",
        owner: {
          tenantId,
          kind: "source_account",
          id: "source_account:account-1"
        }
      }
    ]
  ])("accepts an adapter-declared identity scope", (scope) => {
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({ scope })
      ).success
    ).toBe(true);
  });

  it("requires the exact same-tenant scope owner and forbids one on provider scope", () => {
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          scope: {
            kind: "source_account",
            owner: {
              tenantId: otherTenantId,
              kind: "source_account",
              id: "source_account:account-1"
            }
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          scope: {
            kind: "source_account",
            owner: {
              tenantId,
              kind: "source_connection",
              id: "source_connection:connection-1"
            }
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          scope: { kind: "provider", owner: { id: "unexpected" } }
        })
      ).success
    ).toBe(false);
  });

  it("requires an exact authoritative adapter declaration for provider scope", () => {
    const declaration = baseSourceIdentity.identityDeclaration;

    for (const identityDeclaration of [
      { ...declaration, decisionStrength: "safe_default" },
      { ...declaration, identityKind: "external_thread" },
      { ...declaration, realmId: "module:telegram-user-session:other-realm" },
      { ...declaration, realmVersion: "v2" },
      {
        ...declaration,
        objectKindId: "module:telegram-user-session:provider-bot"
      },
      { ...declaration, scopeKind: "source_account" }
    ]) {
      expect(
        inboxV2SourceExternalIdentitySchema.safeParse(
          sourceIdentityWith({ identityDeclaration })
        ).success
      ).toBe(false);
    }
  });

  it("pins source identity materialization to one tenant, trusted service and clock", () => {
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          materializationAuthority: {
            ...baseSourceIdentity.materializationAuthority,
            tenantId: otherTenantId
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          materializationAuthority: {
            ...baseSourceIdentity.materializationAuthority,
            trustedServiceId: "core:other-worker"
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({ materializedAt: laterAt })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          identityDeclaration: {
            ...baseSourceIdentity.identityDeclaration,
            adapterContract: {
              ...baseSourceIdentity.identityDeclaration.adapterContract,
              loadedAt: laterAt
            }
          }
        })
      ).success
    ).toBe(false);
  });

  it("keeps opaque canonical subjects case-sensitive and unmodified", () => {
    const upper = inboxV2SourceExternalIdentitySchema.parse(
      sourceIdentityWith({ canonicalExternalSubject: "UserABC" })
    );
    const lower = inboxV2SourceExternalIdentitySchema.parse(
      sourceIdentityWith({ canonicalExternalSubject: "userabc" })
    );

    expect(upper.canonicalExternalSubject).toBe("UserABC");
    expect(lower.canonicalExternalSubject).toBe("userabc");
    expect(upper.canonicalExternalSubject).not.toBe(
      lower.canonicalExternalSubject
    );
  });

  it("rejects unpaired UTF-16 surrogates without rejecting valid scalar pairs", () => {
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({ canonicalExternalSubject: "actor😀" })
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          canonicalExternalSubject: String.fromCharCode(0xd800)
        })
      ).success
    ).toBe(false);

    const ephemeral = sourceIdentityWith({
      stability: {
        kind: "observation_ephemeral",
        observation: {
          tenantId,
          kind: "normalized_inbound_event",
          id: "normalized_inbound_event:surrogate"
        },
        observationKey: String.fromCharCode(0xdc00)
      }
    });
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(ephemeral).success
    ).toBe(false);
  });

  it("requires typed evidence for observation-ephemeral identities", () => {
    const ephemeral = sourceIdentityWith({
      stability: {
        kind: "observation_ephemeral",
        observation: {
          tenantId,
          kind: "normalized_inbound_event",
          id: "normalized_inbound_event:event-1"
        },
        observationKey: "roster-item:17"
      }
    });

    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(ephemeral).success
    ).toBe(true);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse({
        ...ephemeral,
        stability: {
          ...(ephemeral.stability as Record<string, unknown>),
          observationKey: undefined
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse({
        ...ephemeral,
        stability: {
          ...(ephemeral.stability as Record<string, unknown>),
          observation: {
            tenantId: otherTenantId,
            kind: "normalized_inbound_event",
            id: "normalized_inbound_event:event-1"
          }
        }
      }).success
    ).toBe(false);
  });

  it("models unresolved, claimed and conflicted resolution without embedding a target", () => {
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(baseSourceIdentity).success
    ).toBe(true);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({ resolution: { status: "conflicted" } })
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          resolution: {
            status: "claimed",
            activeClaim: {
              tenantId,
              kind: "source_identity_claim",
              id: "source_identity_claim:claim-1"
            }
          },
          latestClaimVersion: "1"
        })
      ).success
    ).toBe(true);

    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({
          resolution: {
            status: "claimed",
            activeClaim: {
              tenantId,
              kind: "source_identity_claim",
              id: "source_identity_claim:claim-1"
            }
          },
          latestClaimVersion: null
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceExternalIdentitySchema.safeParse(
        sourceIdentityWith({ employeeId: employeeReference.id })
      ).success
    ).toBe(false);
  });

  it.each([
    ["employee", { kind: "employee", employee: employeeReference }],
    [
      "source external identity",
      {
        kind: "source_external_identity",
        sourceExternalIdentity: sourceIdentityReference
      }
    ],
    [
      "client contact",
      {
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: "client_contact:contact-1"
        }
      }
    ],
    [
      "bot",
      {
        kind: "bot",
        bot: {
          tenantId,
          kind: "bot_identity",
          id: "bot_identity:bot-1"
        }
      }
    ],
    ["system", { kind: "system", systemActorId: "core:source-system" }],
    [
      "legacy unknown",
      {
        kind: "legacy_unknown",
        provenanceCodeId: "core:legacy-v1-author-unknown"
      }
    ]
  ])("accepts exactly one typed %s participant subject", (_name, subject) => {
    expect(
      inboxV2ConversationParticipantSchema.safeParse(
        participantWith({ subject })
      ).success
    ).toBe(true);
  });

  it("rejects Client, Account and authentication-link participant subjects", () => {
    for (const subject of [
      {
        kind: "client",
        client: { tenantId, kind: "client", id: "client:client-1" }
      },
      {
        kind: "account",
        account: { tenantId, kind: "account", id: "account:account-1" }
      },
      {
        kind: "auth_external_identity_link",
        authExternalIdentityLink: {
          tenantId,
          kind: "auth_external_identity_link",
          id: "auth_external_identity_link:login-link-1"
        }
      }
    ]) {
      expect(
        inboxV2ConversationParticipantSubjectSchema.safeParse(subject).success
      ).toBe(false);
    }
  });

  it("enforces tenant scope and one anchor per exact typed subject", () => {
    expect(
      inboxV2ConversationParticipantSchema.safeParse(
        participantWith({
          subject: {
            kind: "employee",
            employee: { ...employeeReference, tenantId: otherTenantId }
          }
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2ConversationParticipantSetSchema.safeParse([
        baseParticipant,
        {
          ...baseParticipant,
          id: "conversation_participant:participant-2"
        }
      ]).success
    ).toBe(false);

    expect(
      inboxV2ConversationParticipantSetSchema.safeParse([
        baseParticipant,
        {
          ...baseParticipant,
          id: "conversation_participant:participant-2",
          subject: {
            kind: "source_external_identity",
            sourceExternalIdentity: sourceIdentityReference
          }
        }
      ]).success
    ).toBe(true);
  });

  it("keeps membership lifecycle and normalized role vocabularies closed", () => {
    for (const state of ["pending", "active", "left", "removed"]) {
      expect(inboxV2ParticipantMembershipStateSchema.parse(state)).toBe(state);
    }
    for (const role of [
      "owner",
      "admin",
      "member",
      "guest",
      "observer",
      "unknown"
    ]) {
      expect(inboxV2ParticipantMembershipRoleSchema.parse(role)).toBe(role);
    }

    for (const invalidState of ["observed", "unknown", "joined", "inactive"]) {
      expect(
        inboxV2ParticipantMembershipStateSchema.safeParse(invalidState).success
      ).toBe(false);
    }
    for (const providerRole of ["creator", "superadmin", "provider_owner"]) {
      expect(
        inboxV2ParticipantMembershipRoleSchema.safeParse(providerRole).success
      ).toBe(false);
    }
  });

  it("keeps current and terminal membership intervals consistent", () => {
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        baseInternalMembership
      ).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({ state: "left", validTo: laterAt })
      ).success
    ).toBe(true);

    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({ validTo: laterAt })
      ).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({ state: "removed", validTo: null })
      ).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({ state: "left", validTo: "2026-07-11T08:59:59.999Z" })
      ).success
    ).toBe(false);
  });

  it("keeps membership evidence tied to its origin authority", () => {
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse({
        ...baseProviderMembership,
        state: "pending",
        role: "unknown",
        evidenceClassification: "advisory"
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse({
        ...baseProviderMembership,
        evidenceClassification: "imported"
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({ evidenceClassification: "advisory" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipEpisodeSchema.safeParse(
        membershipWith({
          origin: {
            kind: "migration",
            provenanceId: "core:legacy-v1-participant"
          },
          evidenceClassification: "imported"
        })
      ).success
    ).toBe(true);
  });

  it("records append-only membership transitions with exact CAS and audit cause", () => {
    expect(
      inboxV2ParticipantMembershipTransitionSchema.safeParse(
        baseInternalMembershipTransition
      ).success
    ).toBe(true);

    const providerLeave = {
      ...baseProviderMembershipTransition,
      id: "participant_membership_transition:transition-provider-2",
      intent: "leave",
      fromState: "active",
      toState: "left",
      fromRole: "admin",
      toRole: "admin",
      expectedRevision: "1",
      currentRevision: "1",
      resultingRevision: "2",
      occurredAt: laterAt
    } as const;
    const internalRemove = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:transition-internal-2",
      intent: "remove",
      fromState: "active",
      toState: "removed",
      fromRole: "member",
      toRole: "member",
      expectedRevision: "1",
      currentRevision: "1",
      resultingRevision: "2",
      occurredAt: laterAt,
      cause: {
        kind: "hulee_internal_command",
        actorEmployee: otherEmployeeReference
      },
      reasonCodeId: "core:removed-by-owner"
    } as const;

    expect(
      inboxV2ParticipantMembershipTransitionSchema.safeParse(providerLeave)
        .success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipTransitionSchema.safeParse(internalRemove)
        .success
    ).toBe(true);

    for (const invalidTransition of [
      { ...baseInternalMembershipTransition, resultingRevision: "2" },
      {
        ...providerLeave,
        currentRevision: "2",
        resultingRevision: "3"
      },
      { ...providerLeave, resultingRevision: "3" },
      {
        ...providerLeave,
        intent: "change_role",
        toState: "active",
        toRole: "admin"
      },
      {
        ...internalRemove,
        cause: {
          ...internalRemove.cause,
          actorEmployee: {
            ...otherEmployeeReference,
            tenantId: otherTenantId
          }
        }
      }
    ]) {
      expect(
        inboxV2ParticipantMembershipTransitionSchema.safeParse(
          invalidTransition
        ).success
      ).toBe(false);
    }
  });

  it("keeps simultaneous origins independent when one leaves", () => {
    const internal = inboxV2ParticipantMembershipEpisodeSchema.parse(
      baseInternalMembership
    );
    const provider = inboxV2ParticipantMembershipEpisodeSchema.parse({
      ...baseProviderMembership,
      state: "left",
      validTo: laterAt,
      revision: "2"
    });

    expect(internal.state).toBe("active");
    expect(provider.state).toBe("left");
    expect(
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode: internal,
        participant: baseParticipant,
        conversation: baseInternalConversation
      })
    ).toBe(true);
    expect(
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode: provider,
        participant: baseParticipant,
        conversation: baseInternalConversation
      })
    ).toBe(false);
  });

  it("never treats provider membership or provider admin role as internal authority", () => {
    expect(
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode: baseProviderMembership,
        participant: baseParticipant,
        conversation: baseInternalConversation
      })
    ).toBe(false);
    expect(
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode: {
          ...baseInternalMembership,
          state: "left",
          validTo: laterAt
        },
        participant: baseParticipant,
        conversation: baseInternalConversation
      })
    ).toBe(false);
  });

  it("keeps an author observation outside the membership lifecycle", () => {
    const observation = {
      tenantId,
      id: "participant_author_observation:observation-1",
      participant: participantReference,
      sourceOccurrence: {
        tenantId,
        kind: "source_occurrence",
        id: "source_occurrence:occurrence-1"
      },
      evidenceClassification: "observed",
      observedAt: createdAt,
      revision: "1"
    } as const;

    expect(
      inboxV2ParticipantAuthorObservationSchema.safeParse(observation).success
    ).toBe(true);
    expect(inboxV2ParticipantAuthorEvidenceSchema.parse("unknown")).toBe(
      "unknown"
    );
    expect(
      inboxV2ParticipantAuthorObservationSchema.safeParse({
        ...observation,
        state: "active"
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantAuthorObservationSchema.safeParse({
        ...observation,
        sourceOccurrence: {
          ...observation.sourceOccurrence,
          tenantId: otherTenantId
        }
      }).success
    ).toBe(false);
  });

  it("separates concrete roster completeness from adapter capability fidelity", () => {
    for (const completeness of ["unknown", "partial", "complete"]) {
      expect(inboxV2ProviderRosterCompletenessSchema.parse(completeness)).toBe(
        completeness
      );
    }
    for (const capabilityValue of ["full", "none"]) {
      expect(
        inboxV2ProviderRosterCompletenessSchema.safeParse(capabilityValue)
          .success
      ).toBe(false);
    }
  });

  it("allows omission closure only for complete authoritative roster evidence", () => {
    const completeAuthoritative = rosterEvidenceWith({
      completeness: "complete",
      authority: "authoritative",
      omissionPolicy: "close_missing"
    });

    expect(
      inboxV2ProviderRosterEvidenceSchema.safeParse(baseRosterEvidence).success
    ).toBe(true);
    expect(
      inboxV2ProviderRosterEvidenceSchema.safeParse(completeAuthoritative)
        .success
    ).toBe(true);
    expect(
      canInboxV2RosterEvidenceCloseMissingMembership(baseRosterEvidence)
    ).toBe(false);
    expect(
      canInboxV2RosterEvidenceCloseMissingMembership(
        inboxV2ProviderRosterEvidenceSchema.parse(completeAuthoritative)
      )
    ).toBe(true);

    for (const evidence of [
      rosterEvidenceWith({
        completeness: "partial",
        authority: "authoritative",
        omissionPolicy: "close_missing"
      }),
      rosterEvidenceWith({
        completeness: "complete",
        authority: "advisory",
        omissionPolicy: "close_missing"
      })
    ]) {
      expect(
        inboxV2ProviderRosterEvidenceSchema.safeParse(evidence).success
      ).toBe(false);
    }
  });

  it("preserves bounded provider member state and role evidence without promoting it", () => {
    const member = inboxV2ProviderRosterMemberEvidenceSchema.parse(
      baseRosterMemberEvidence
    );

    expect(member.providerStateCode).toBe("ParticipantActive");
    expect(member.providerRoleCode).toBe("GroupAdministrator");
    expect(member.normalizedRole).toBe("admin");

    expect(
      inboxV2ProviderRosterMemberEvidenceSchema.safeParse({
        ...baseRosterMemberEvidence,
        normalizedRole: "provider_owner"
      }).success
    ).toBe(false);
    expect(
      inboxV2ProviderRosterMemberEvidenceSchema.safeParse({
        ...baseRosterMemberEvidence,
        state: "observed"
      }).success
    ).toBe(false);
    expect(
      inboxV2ProviderRosterMemberEvidenceSchema.safeParse({
        ...baseRosterMemberEvidence,
        sourceExternalIdentity: {
          ...sourceIdentityReference,
          tenantId: otherTenantId
        }
      }).success
    ).toBe(false);
  });

  it("rejects cross-tenant roster evidence", () => {
    expect(
      inboxV2ProviderRosterEvidenceSchema.safeParse(
        rosterEvidenceWith({
          sourceThreadBinding: {
            ...sourceThreadBindingReference,
            tenantId: otherTenantId
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2ProviderRosterEvidenceSchema.safeParse(
        rosterEvidenceWith({
          observation: {
            tenantId: otherTenantId,
            kind: "raw_inbound_event",
            id: "raw_inbound_event:roster-event-1"
          }
        })
      ).success
    ).toBe(false);
  });

  it("validates membership episode and transition ownership as one graph", () => {
    const graph = {
      participant: baseParticipant,
      episodes: [baseInternalMembership],
      transitions: [baseInternalMembershipTransition],
      rosterEvidence: [],
      rosterMemberEvidence: []
    };

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse(graph).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        episodes: [
          {
            ...baseInternalMembership,
            participant: {
              ...participantReference,
              id: "conversation_participant:participant-2"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        transitions: [
          {
            ...baseInternalMembershipTransition,
            episode: {
              ...baseInternalMembershipTransition.episode,
              id: "participant_membership_episode:episode-unrelated"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        participant: {
          ...baseParticipant,
          subject: {
            kind: "source_external_identity",
            sourceExternalIdentity: sourceIdentityReference
          }
        }
      }).success
    ).toBe(false);
  });

  it("requires a contiguous membership history and a matching episode projection", () => {
    const terminalEpisode = {
      ...baseInternalMembership,
      state: "left",
      validTo: laterAt,
      revision: "2"
    } as const;
    const leaveTransition = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:transition-internal-2",
      intent: "leave",
      fromState: "active",
      toState: "left",
      fromRole: "member",
      toRole: "member",
      expectedRevision: "1",
      currentRevision: "1",
      resultingRevision: "2",
      occurredAt: laterAt
    } as const;

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [terminalEpisode],
        transitions: [baseInternalMembershipTransition, leaveTransition],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [{ ...terminalEpisode, revision: "3" }],
        transitions: [
          baseInternalMembershipTransition,
          {
            ...leaveTransition,
            expectedRevision: "2",
            currentRevision: "2",
            resultingRevision: "3"
          }
        ],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [
          {
            ...baseInternalMembership,
            role: "admin",
            revision: "2"
          }
        ],
        transitions: [
          baseInternalMembershipTransition,
          {
            ...baseInternalMembershipTransition,
            id: "participant_membership_transition:transition-internal-2",
            intent: "change_role",
            fromState: "active",
            toState: "active",
            fromRole: "owner",
            toRole: "admin",
            expectedRevision: "1",
            currentRevision: "1",
            resultingRevision: "2",
            occurredAt: laterAt
          }
        ],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(false);
  });

  it("requires exact origin lineage and non-overlapping rejoin episodes", () => {
    const migrationEpisode = {
      ...baseInternalMembership,
      id: "participant_membership_episode:migration-lineage",
      origin: { kind: "migration", provenanceId: "core:legacy-import-a" },
      evidenceClassification: "imported"
    } as const;
    const migrationTransition = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:migration-lineage",
      episode: {
        ...baseInternalMembershipTransition.episode,
        id: migrationEpisode.id
      },
      cause: {
        kind: "migration",
        trustedServiceId: "core:migration-worker",
        provenanceId: "core:legacy-import-a"
      }
    } as const;
    const migrationGraph = {
      participant: baseParticipant,
      episodes: [migrationEpisode],
      transitions: [migrationTransition],
      rosterEvidence: [],
      rosterMemberEvidence: []
    };

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse(migrationGraph).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...migrationGraph,
        transitions: [
          {
            ...migrationTransition,
            cause: {
              ...migrationTransition.cause,
              provenanceId: "core:legacy-import-b"
            }
          }
        ]
      }).success
    ).toBe(false);

    const policyEpisode = {
      ...baseInternalMembership,
      id: "participant_membership_episode:policy-lineage",
      origin: { kind: "system_policy", policyId: "core:policy-a" }
    } as const;
    const policyTransition = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:policy-lineage",
      episode: {
        ...baseInternalMembershipTransition.episode,
        id: policyEpisode.id
      },
      cause: {
        kind: "system_policy",
        trustedServiceId: "core:policy-worker",
        policyId: "core:policy-a"
      }
    } as const;
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [policyEpisode],
        transitions: [policyTransition],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [policyEpisode],
        transitions: [
          {
            ...policyTransition,
            cause: { ...policyTransition.cause, policyId: "core:policy-b" }
          }
        ],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(false);

    const terminalEpisode = {
      ...baseInternalMembership,
      state: "left",
      validTo: laterAt,
      revision: "2"
    } as const;
    const leaveTransition = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:overlap-leave",
      intent: "leave",
      fromState: "active",
      toState: "left",
      fromRole: "member",
      toRole: "member",
      expectedRevision: "1",
      currentRevision: "1",
      resultingRevision: "2",
      occurredAt: laterAt
    } as const;
    const backdatedEpisode = {
      ...baseInternalMembership,
      id: "participant_membership_episode:backdated-rejoin",
      validFrom: "2026-07-11T09:30:00.000Z"
    } as const;
    const backdatedTransition = {
      ...baseInternalMembershipTransition,
      id: "participant_membership_transition:backdated-rejoin",
      episode: {
        ...baseInternalMembershipTransition.episode,
        id: backdatedEpisode.id
      },
      occurredAt: backdatedEpisode.validFrom
    } as const;
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        participant: baseParticipant,
        episodes: [terminalEpisode, backdatedEpisode],
        transitions: [
          baseInternalMembershipTransition,
          leaveTransition,
          backdatedTransition
        ],
        rosterEvidence: [],
        rosterMemberEvidence: []
      }).success
    ).toBe(false);
  });

  it("binds provider membership to one member, roster, binding and source subject chain", () => {
    const providerParticipant = {
      ...baseParticipant,
      subject: {
        kind: "source_external_identity",
        sourceExternalIdentity: sourceIdentityReference
      }
    } as const;
    const graph = {
      participant: providerParticipant,
      episodes: [baseProviderMembership],
      transitions: [baseProviderMembershipTransition],
      rosterEvidence: [baseRosterEvidence],
      rosterMemberEvidence: [baseRosterMemberEvidence]
    };

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse(graph).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        participant: {
          ...providerParticipant,
          subject: {
            kind: "source_external_identity",
            sourceExternalIdentity: secondSourceIdentityReference
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipTransitionSchema.safeParse({
        ...baseProviderMembershipTransition,
        cause: {
          kind: "provider_roster",
          evidence: {
            kind: "source_occurrence",
            reference: {
              tenantId,
              kind: "source_occurrence",
              id: "source_occurrence:unscoped-leave"
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        rosterMemberEvidence: [
          { ...baseRosterMemberEvidence, normalizedRole: "guest" }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        transitions: [
          {
            ...baseProviderMembershipTransition,
            cause: {
              kind: "provider_roster",
              evidence: {
                kind: "provider_roster",
                reference: rosterEvidenceReference
              }
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        rosterMemberEvidence: [
          {
            ...baseRosterMemberEvidence,
            rosterEvidence: {
              ...rosterEvidenceReference,
              id: "provider_roster_evidence:evidence-missing"
            }
          }
        ]
      }).success
    ).toBe(false);

    const otherRosterEvidence = {
      ...baseRosterEvidence,
      id: "provider_roster_evidence:evidence-2",
      sourceThreadBinding: {
        ...sourceThreadBindingReference,
        id: "source_thread_binding:binding-2"
      },
      observation: {
        ...baseRosterEvidence.observation,
        id: "raw_inbound_event:roster-event-2"
      }
    } as const;

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        transitions: [
          {
            ...baseProviderMembershipTransition,
            cause: {
              kind: "provider_roster",
              evidence: {
                kind: "provider_roster",
                reference: {
                  ...rosterEvidenceReference,
                  id: otherRosterEvidence.id
                }
              }
            }
          }
        ],
        rosterEvidence: [baseRosterEvidence, otherRosterEvidence]
      }).success
    ).toBe(false);
  });

  it("groups provider membership episodes by their roster binding, not initial member evidence", () => {
    const providerParticipant = {
      ...baseParticipant,
      subject: {
        kind: "source_external_identity",
        sourceExternalIdentity: sourceIdentityReference
      }
    } as const;
    const secondRosterEvidence = {
      ...baseRosterEvidence,
      id: "provider_roster_evidence:evidence-rejoin",
      observation: {
        ...baseRosterEvidence.observation,
        id: "raw_inbound_event:roster-event-rejoin"
      }
    } as const;
    const secondRosterEvidenceReference = {
      ...rosterEvidenceReference,
      id: secondRosterEvidence.id
    } as const;
    const secondMemberEvidence = {
      ...baseRosterMemberEvidence,
      id: "provider_roster_member_evidence:member-rejoin",
      rosterEvidence: secondRosterEvidenceReference
    } as const;
    const secondMemberEvidenceReference = {
      ...rosterMemberEvidenceReference,
      id: secondMemberEvidence.id
    } as const;
    const secondEpisode = {
      ...baseProviderMembership,
      id: "participant_membership_episode:episode-provider-rejoin",
      origin: {
        kind: "provider_roster",
        memberEvidence: secondMemberEvidenceReference
      }
    } as const;
    const secondTransition = {
      ...baseProviderMembershipTransition,
      id: "participant_membership_transition:transition-provider-rejoin",
      episode: {
        ...baseProviderMembershipTransition.episode,
        id: secondEpisode.id
      },
      cause: {
        kind: "provider_roster",
        evidence: {
          kind: "provider_roster_member",
          reference: secondMemberEvidenceReference
        }
      }
    } as const;
    const graph = {
      participant: providerParticipant,
      episodes: [baseProviderMembership, secondEpisode],
      transitions: [baseProviderMembershipTransition, secondTransition],
      rosterEvidence: [baseRosterEvidence, secondRosterEvidence],
      rosterMemberEvidence: [baseRosterMemberEvidence, secondMemberEvidence]
    };

    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse(graph).success
    ).toBe(false);

    const independentRoster = {
      ...secondRosterEvidence,
      sourceThreadBinding: {
        ...sourceThreadBindingReference,
        id: "source_thread_binding:binding-independent"
      }
    } as const;
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        rosterEvidence: [baseRosterEvidence, independentRoster]
      }).success
    ).toBe(true);
  });

  it("requires a provider rejoin to advance beyond the closed episode ordering head", () => {
    const providerParticipant = {
      ...baseParticipant,
      subject: {
        kind: "source_external_identity",
        sourceExternalIdentity: sourceIdentityReference
      }
    } as const;
    const terminalRoster = {
      ...baseRosterEvidence,
      id: "provider_roster_evidence:episode-terminal-10",
      observation: {
        ...baseRosterEvidence.observation,
        id: "raw_inbound_event:episode-terminal-10"
      },
      ordering: { ...baseRosterEvidence.ordering, position: "10" },
      observedAt: laterAt
    } as const;
    const terminalMember = {
      ...baseRosterMemberEvidence,
      id: "provider_roster_member_evidence:episode-terminal-10",
      rosterEvidence: {
        ...rosterEvidenceReference,
        id: terminalRoster.id
      },
      state: "left",
      providerStateCode: "ParticipantLeft",
      observedAt: laterAt
    } as const;
    const closedEpisode = {
      ...baseProviderMembership,
      state: "left",
      validTo: laterAt,
      revision: "2"
    } as const;
    const terminalTransition = {
      ...baseProviderMembershipTransition,
      id: "participant_membership_transition:episode-terminal-10",
      intent: "leave",
      fromState: "active",
      toState: "left",
      fromRole: "admin",
      toRole: "admin",
      cause: {
        kind: "provider_roster",
        evidence: {
          kind: "provider_roster_member",
          reference: {
            ...rosterMemberEvidenceReference,
            id: terminalMember.id
          }
        }
      },
      expectedRevision: "1",
      currentRevision: "1",
      resultingRevision: "2",
      occurredAt: laterAt
    } as const;
    const rejoinRoster = {
      ...baseRosterEvidence,
      id: "provider_roster_evidence:episode-rejoin-11",
      observation: {
        ...baseRosterEvidence.observation,
        id: "raw_inbound_event:episode-rejoin-11"
      },
      ordering: { ...baseRosterEvidence.ordering, position: "11" },
      observedAt: laterAt
    } as const;
    const rejoinMember = {
      ...baseRosterMemberEvidence,
      id: "provider_roster_member_evidence:episode-rejoin-11",
      rosterEvidence: {
        ...rosterEvidenceReference,
        id: rejoinRoster.id
      },
      observedAt: laterAt
    } as const;
    const rejoinEpisode = {
      ...baseProviderMembership,
      id: "participant_membership_episode:episode-rejoin-11",
      origin: {
        kind: "provider_roster",
        memberEvidence: {
          ...rosterMemberEvidenceReference,
          id: rejoinMember.id
        }
      },
      validFrom: laterAt
    } as const;
    const rejoinTransition = {
      ...baseProviderMembershipTransition,
      id: "participant_membership_transition:episode-rejoin-11",
      episode: {
        ...baseProviderMembershipTransition.episode,
        id: rejoinEpisode.id
      },
      cause: {
        kind: "provider_roster",
        evidence: {
          kind: "provider_roster_member",
          reference: {
            ...rosterMemberEvidenceReference,
            id: rejoinMember.id
          }
        }
      },
      occurredAt: laterAt
    } as const;
    const graph = {
      participant: providerParticipant,
      episodes: [closedEpisode, rejoinEpisode],
      transitions: [
        baseProviderMembershipTransition,
        terminalTransition,
        rejoinTransition
      ],
      rosterEvidence: [baseRosterEvidence, terminalRoster, rejoinRoster],
      rosterMemberEvidence: [
        baseRosterMemberEvidence,
        terminalMember,
        rejoinMember
      ]
    };

    const validRejoin =
      inboxV2ParticipantMembershipGraphSchema.safeParse(graph);
    expect(
      validRejoin.success,
      validRejoin.success
        ? undefined
        : JSON.stringify(validRejoin.error.issues, null, 2)
    ).toBe(true);
    const offsetRejoinAt = "2026-07-11T08:00:00.000-02:00";
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        episodes: [
          closedEpisode,
          { ...rejoinEpisode, validFrom: offsetRejoinAt }
        ],
        transitions: [
          baseProviderMembershipTransition,
          terminalTransition,
          { ...rejoinTransition, occurredAt: offsetRejoinAt }
        ],
        rosterEvidence: [
          baseRosterEvidence,
          terminalRoster,
          { ...rejoinRoster, observedAt: offsetRejoinAt }
        ],
        rosterMemberEvidence: [
          baseRosterMemberEvidence,
          terminalMember,
          { ...rejoinMember, observedAt: offsetRejoinAt }
        ]
      }).success
    ).toBe(true);
    expect(
      inboxV2ParticipantMembershipGraphSchema.safeParse({
        ...graph,
        rosterEvidence: [
          baseRosterEvidence,
          terminalRoster,
          {
            ...rejoinRoster,
            ordering: { ...rejoinRoster.ordering, position: "5" }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("supports separate Employee and ClientContact claims", () => {
    expect(inboxV2SourceIdentityClaimSchema.safeParse(baseClaim).success).toBe(
      true
    );
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          target: {
            kind: "client_contact",
            clientContact: {
              tenantId,
              kind: "client_contact",
              id: "client_contact:contact-1"
            }
          }
        })
      ).success
    ).toBe(true);

    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          target: {
            kind: "client",
            client: { tenantId, kind: "client", id: "client:client-1" }
          }
        })
      ).success
    ).toBe(false);
  });

  it("keeps Employee and ClientContact claim permission families distinct", () => {
    expect(INBOX_V2_SOURCE_IDENTITY_CLAIM_PERMISSION_REQUIREMENTS).toEqual({
      sourceIdentity: "identity.source_identity.use",
      employeeTarget: "identity.employee_claim.manage",
      clientContactTarget: "identity.client_contact_claim.manage",
      evidence: "identity.evidence.view",
      automaticResolution: "identity.auto_resolve",
      revoke: "identity.claim.revoke"
    });
    expect(
      getInboxV2SourceIdentityClaimTargetPermission(baseClaim.target)
    ).toBe("identity.employee_claim.manage");
    expect(
      getInboxV2SourceIdentityClaimTargetPermission({
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: "client_contact:contact-1"
        }
      })
    ).toBe("identity.client_contact_claim.manage");
  });

  it("rejects a manual Employee self-claim but permits independent review", () => {
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          decision: {
            kind: "manual",
            actorEmployee: employeeReference,
            reviewState: "approved"
          }
        })
      ).success
    ).toBe(false);
    expect(inboxV2SourceIdentityClaimSchema.safeParse(baseClaim).success).toBe(
      true
    );
  });

  it("enforces tenant scope across the claim source, target, evidence and actor", () => {
    const invalidClaims = [
      claimWith({
        sourceExternalIdentity: {
          ...sourceIdentityReference,
          tenantId: otherTenantId
        }
      }),
      claimWith({
        target: {
          kind: "employee",
          employee: { ...employeeReference, tenantId: otherTenantId }
        }
      }),
      claimWith({
        evidenceReferences: [
          {
            kind: "raw_inbound_event",
            reference: {
              tenantId: otherTenantId,
              kind: "raw_inbound_event",
              id: "raw_inbound_event:event-1"
            }
          }
        ]
      }),
      claimWith({
        decision: {
          kind: "manual",
          actorEmployee: {
            ...otherEmployeeReference,
            tenantId: otherTenantId
          },
          reviewState: "approved"
        }
      })
    ];

    for (const claim of invalidClaims) {
      expect(inboxV2SourceIdentityClaimSchema.safeParse(claim).success).toBe(
        false
      );
    }
  });

  it("keeps active and revoked claims temporal and versioned", () => {
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          status: "revoked",
          revocation: {
            revokedAt: laterAt
          },
          revision: "2"
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          revocation: {
            revokedAt: laterAt
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({ status: "revoked", revocation: null })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          status: "revoked",
          revocation: {
            revokedAt: "2026-07-11T08:59:59.999Z"
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({ claimVersion: "0" })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(claimWith({ revision: "2" }))
        .success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          status: "revoked",
          revocation: { revokedAt: laterAt },
          revision: "1"
        })
      ).success
    ).toBe(false);
  });

  it("enforces one active claim and one version per source identity", () => {
    const secondActiveClaim = claimWith({
      id: "source_identity_claim:claim-2",
      previousClaimVersion: "1",
      claimVersion: "2",
      target: {
        kind: "client_contact",
        clientContact: {
          tenantId,
          kind: "client_contact",
          id: "client_contact:contact-1"
        }
      }
    });

    expect(
      inboxV2SourceIdentityClaimSetSchema.safeParse([
        baseClaim,
        secondActiveClaim
      ]).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSetSchema.safeParse([
        {
          ...baseClaim,
          status: "revoked",
          revocation: {
            revokedAt: laterAt
          },
          revision: "2"
        },
        secondActiveClaim
      ]).success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityClaimSetSchema.safeParse([
        baseClaim,
        claimWith({
          id: "source_identity_claim:claim-2",
          status: "revoked",
          revocation: {
            revokedAt: laterAt
          }
        })
      ]).success
    ).toBe(false);
  });

  it("allows several source identities to resolve to the same target", () => {
    expect(
      inboxV2SourceIdentityClaimSetSchema.safeParse([
        baseClaim,
        claimWith({
          id: "source_identity_claim:claim-2",
          sourceExternalIdentity: secondSourceIdentityReference
        })
      ]).success
    ).toBe(true);
  });

  it("pins automatic claims to one immutable source-identity policy authority", () => {
    const automaticDecision = {
      kind: "automatic_policy",
      trustedServiceId: "core:identity-claim-service",
      reviewState: "not_required",
      policyAuthority: {
        family: "source_identity_claim",
        definitionContractVersion: "v1",
        definitionDigestSha256: "a".repeat(64),
        activationHeadRevision: "1"
      }
    } as const;
    const automaticClaim = claimWith({ decision: automaticDecision });
    const automaticTransition = {
      ...baseClaimTransition,
      decision: automaticDecision
    };
    const graph = {
      identity: {
        ...baseSourceIdentity,
        resolution: {
          status: "claimed",
          activeClaim: {
            tenantId,
            kind: "source_identity_claim",
            id: baseClaim.id
          }
        },
        latestClaimVersion: "1"
      },
      claims: [automaticClaim],
      transitions: [automaticTransition]
    };

    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(automaticClaim).success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityClaimTransitionSchema.safeParse(automaticTransition)
        .success
    ).toBe(true);
    expect(inboxV2SourceIdentityClaimGraphSchema.safeParse(graph).success).toBe(
      true
    );

    for (const invalidAuthority of [
      { ...automaticDecision.policyAuthority, family: "conversation_link" },
      {
        ...automaticDecision.policyAuthority,
        definitionContractVersion: "1"
      },
      {
        ...automaticDecision.policyAuthority,
        definitionDigestSha256: "A".repeat(64)
      },
      { ...automaticDecision.policyAuthority, activationHeadRevision: "0" }
    ]) {
      expect(
        inboxV2SourceIdentityClaimSchema.safeParse(
          claimWith({
            decision: {
              ...automaticDecision,
              policyAuthority: invalidAuthority
            }
          })
        ).success
      ).toBe(false);
    }
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          decision: {
            kind: "automatic_policy",
            trustedServiceId: automaticDecision.trustedServiceId,
            reviewState: "not_required"
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          decision: {
            ...baseClaim.decision,
            policyAuthority: automaticDecision.policyAuthority
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(
        claimWith({
          decision: {
            kind: "migration",
            trustedServiceId: "core:identity-migration",
            reviewState: "not_required",
            policyAuthority: automaticDecision.policyAuthority
          }
        })
      ).success
    ).toBe(false);

    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        transitions: [
          {
            ...automaticTransition,
            decision: {
              ...automaticDecision,
              policyAuthority: {
                ...automaticDecision.policyAuthority,
                activationHeadRevision: "2"
              }
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("supports expected-version conflict detection for concurrent claim intents", () => {
    expect(
      isInboxV2SourceIdentityClaimExpectedVersionCurrent({
        currentVersion: null,
        expectedVersion: null
      })
    ).toBe(true);
    expect(
      isInboxV2SourceIdentityClaimExpectedVersionCurrent({
        currentVersion: "1",
        expectedVersion: "1"
      })
    ).toBe(true);
    expect(
      isInboxV2SourceIdentityClaimExpectedVersionCurrent({
        currentVersion: "1",
        expectedVersion: null
      })
    ).toBe(false);
    expect(() =>
      isInboxV2SourceIdentityClaimExpectedVersionCurrent({
        currentVersion: "0",
        expectedVersion: "0"
      })
    ).toThrow();
  });

  it("records split claim operations with strict null-to-1 and n-to-n+1 CAS", () => {
    expect(
      inboxV2SourceIdentityClaimTransitionSchema.safeParse(baseClaimTransition)
        .success
    ).toBe(true);

    const clientContactClaimTransition = {
      ...baseClaimTransition,
      id: "source_identity_claim_transition:transition-2",
      operation: {
        kind: "claim_client_contact",
        target: {
          kind: "client_contact",
          clientContact: {
            tenantId,
            kind: "client_contact",
            id: "client_contact:contact-1"
          }
        },
        previousClaim: {
          claim: {
            tenantId,
            kind: "source_identity_claim",
            id: "source_identity_claim:claim-1"
          },
          target: baseClaim.target
        },
        resultingClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: "source_identity_claim:claim-2"
        }
      },
      expectedVersion: "1",
      currentVersion: "1",
      resultingVersion: "2",
      occurredAt: laterAt
    } as const;
    const revokeTransition = {
      ...baseClaimTransition,
      id: "source_identity_claim_transition:transition-2",
      operation: {
        kind: "revoke",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: "source_identity_claim:claim-1"
        },
        target: baseClaim.target
      },
      expectedVersion: "1",
      currentVersion: "1",
      resultingVersion: "2",
      occurredAt: laterAt
    } as const;

    expect(
      inboxV2SourceIdentityClaimTransitionSchema.safeParse(
        clientContactClaimTransition
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityClaimTransitionSchema.safeParse(revokeTransition)
        .success
    ).toBe(true);

    for (const invalidTransition of [
      { ...baseClaimTransition, resultingVersion: "2" },
      {
        ...clientContactClaimTransition,
        currentVersion: "2",
        resultingVersion: "3"
      },
      { ...clientContactClaimTransition, resultingVersion: "1" },
      { ...clientContactClaimTransition, resultingVersion: "99" },
      {
        ...baseClaimTransition,
        decision: {
          ...baseClaimTransition.decision,
          actorEmployee: employeeReference
        }
      }
    ]) {
      expect(
        inboxV2SourceIdentityClaimTransitionSchema.safeParse(invalidTransition)
          .success
      ).toBe(false);
    }
  });

  it("requires audited revoke metadata to point at a valid revoke transition", () => {
    const revokeTransition = {
      ...baseClaimTransition,
      id: "source_identity_claim_transition:transition-2",
      operation: {
        kind: "revoke",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: baseClaim.id
        },
        target: baseClaim.target
      },
      expectedVersion: "1",
      currentVersion: "1",
      resultingVersion: "2",
      occurredAt: laterAt
    } as const;
    const revokedClaim = claimWith({
      status: "revoked",
      revocation: {
        revokedAt: laterAt
      },
      revision: "2"
    });

    expect(
      inboxV2SourceIdentityClaimTransitionSchema.safeParse(revokeTransition)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceIdentityClaimSchema.safeParse(revokedClaim).success
    ).toBe(true);
  });

  it("validates the active claim, source identity and creation transition as one graph", () => {
    const claimedIdentity = {
      ...baseSourceIdentity,
      resolution: {
        status: "claimed",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: baseClaim.id
        }
      },
      latestClaimVersion: "1"
    } as const;
    const graph = {
      identity: claimedIdentity,
      claims: [baseClaim],
      transitions: [baseClaimTransition]
    };

    expect(inboxV2SourceIdentityClaimGraphSchema.safeParse(graph).success).toBe(
      true
    );
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        identity: {
          ...claimedIdentity,
          resolution: {
            status: "claimed",
            activeClaim: {
              ...claimedIdentity.resolution.activeClaim,
              id: "source_identity_claim:claim-unrelated"
            }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        identity: {
          ...claimedIdentity,
          id: secondSourceIdentityReference.id
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        transitions: [
          {
            ...baseClaimTransition,
            operation: {
              ...baseClaimTransition.operation,
              resultingClaim: {
                ...baseClaimTransition.operation.resultingClaim,
                id: "source_identity_claim:claim-unrelated"
              }
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("accepts a fully audited revoke and rejects a detached revoke audit", () => {
    const revokedClaim = {
      ...baseClaim,
      status: "revoked",
      revocation: { revokedAt: laterAt },
      revision: "2"
    } as const;
    const revokeTransition = {
      ...baseClaimTransition,
      id: "source_identity_claim_transition:transition-2",
      operation: {
        kind: "revoke",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: baseClaim.id
        },
        target: baseClaim.target
      },
      expectedVersion: "1",
      currentVersion: "1",
      resultingVersion: "2",
      occurredAt: laterAt
    } as const;
    const graph = {
      identity: {
        ...baseSourceIdentity,
        latestClaimVersion: "2"
      },
      claims: [revokedClaim],
      transitions: [baseClaimTransition, revokeTransition]
    };

    expect(inboxV2SourceIdentityClaimGraphSchema.safeParse(graph).success).toBe(
      true
    );
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        claims: [
          {
            ...revokedClaim,
            revocation: { revokedAt: "2026-07-11T11:00:00.000Z" }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        transitions: [
          baseClaimTransition,
          {
            ...revokeTransition,
            operation: {
              ...revokeTransition.operation,
              activeClaim: {
                ...revokeTransition.operation.activeClaim,
                id: "source_identity_claim:claim-unrelated"
              }
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("accepts an audited reassignment and rejects an unlinked previous claim", () => {
    const clientContactTarget = {
      kind: "client_contact",
      clientContact: {
        tenantId,
        kind: "client_contact",
        id: "client_contact:contact-1"
      }
    } as const;
    const previousClaim = {
      ...baseClaim,
      status: "revoked",
      revocation: { revokedAt: laterAt },
      revision: "2"
    } as const;
    const resultingClaim = {
      ...baseClaim,
      id: "source_identity_claim:claim-2",
      previousClaimVersion: "1",
      claimVersion: "2",
      target: clientContactTarget,
      createdAt: laterAt
    } as const;
    const reassignTransition = {
      ...baseClaimTransition,
      id: "source_identity_claim_transition:transition-2",
      operation: {
        kind: "claim_client_contact",
        target: clientContactTarget,
        previousClaim: {
          claim: {
            tenantId,
            kind: "source_identity_claim",
            id: baseClaim.id
          },
          target: baseClaim.target
        },
        resultingClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: resultingClaim.id
        }
      },
      expectedVersion: "1",
      currentVersion: "1",
      resultingVersion: "2",
      occurredAt: laterAt
    } as const;
    const graph = {
      identity: {
        ...baseSourceIdentity,
        resolution: {
          status: "claimed",
          activeClaim: {
            tenantId,
            kind: "source_identity_claim",
            id: resultingClaim.id
          }
        },
        latestClaimVersion: "2"
      },
      claims: [previousClaim, resultingClaim],
      transitions: [baseClaimTransition, reassignTransition]
    } as const;

    expect(inboxV2SourceIdentityClaimGraphSchema.safeParse(graph).success).toBe(
      true
    );
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        ...graph,
        transitions: [
          baseClaimTransition,
          {
            ...reassignTransition,
            operation: {
              ...reassignTransition.operation,
              previousClaim: null
            }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("requires contiguous claim versions and an identity head at the latest transition", () => {
    const claimedIdentity = {
      ...baseSourceIdentity,
      resolution: {
        status: "claimed",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: baseClaim.id
        }
      },
      latestClaimVersion: "2"
    } as const;

    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        identity: claimedIdentity,
        claims: [baseClaim],
        transitions: [baseClaimTransition]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceIdentityClaimGraphSchema.safeParse({
        identity: claimedIdentity,
        claims: [
          {
            ...baseClaim,
            previousClaimVersion: "1",
            claimVersion: "2"
          }
        ],
        transitions: [
          {
            ...baseClaimTransition,
            expectedVersion: "1",
            currentVersion: "1",
            resultingVersion: "2"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps a claimed external Employee persona source-authored and non-principal", () => {
    const identity = inboxV2SourceExternalIdentitySchema.parse(
      sourceIdentityWith({
        resolution: {
          status: "claimed",
          activeClaim: {
            tenantId,
            kind: "source_identity_claim",
            id: baseClaim.id
          }
        },
        latestClaimVersion: "1"
      })
    );
    const claim = inboxV2SourceIdentityClaimSchema.parse(baseClaim);
    const participant = inboxV2ConversationParticipantSchema.parse(
      participantWith({
        subject: {
          kind: "source_external_identity",
          sourceExternalIdentity: sourceIdentityReference
        }
      })
    );
    const providerMembership = inboxV2ParticipantMembershipEpisodeSchema.parse(
      baseProviderMembership
    );

    expect(identity.resolution.status).toBe("claimed");
    expect(claim.target.kind).toBe("employee");
    expect(participant.subject.kind).toBe("source_external_identity");
    expect(
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode: providerMembership,
        participant,
        conversation: baseExternalConversation
      })
    ).toBe(false);
    expect("principalId" in identity).toBe(false);
    expect("accountId" in claim).toBe(false);
    expect("permissions" in participant).toBe(false);
  });

  it("rejects authority and Hulee-membership side-effect fields", () => {
    for (const invalid of [
      sourceIdentityWith({ principalId: "account:account-1" }),
      participantWith({ permissions: ["conversation.internal.read"] }),
      claimWith({ createsAccount: true }),
      claimWith({ grantsMembership: true }),
      claimWith({ grantsAccess: true }),
      {
        ...baseProviderMembership,
        huleePermissionScope: "internal_participant"
      }
    ]) {
      const schema =
        "claimVersion" in invalid
          ? inboxV2SourceIdentityClaimSchema
          : "canonicalExternalSubject" in invalid
            ? inboxV2SourceExternalIdentitySchema
            : "origin" in invalid
              ? inboxV2ParticipantMembershipEpisodeSchema
              : inboxV2ConversationParticipantSchema;

      expect(schema.safeParse(invalid).success).toBe(false);
    }
  });

  it("binds every participant/identity payload to its exact schema envelope", () => {
    const authorObservation = {
      tenantId,
      id: "participant_author_observation:observation-1",
      participant: participantReference,
      sourceOccurrence: {
        tenantId,
        kind: "source_occurrence",
        id: "source_occurrence:occurrence-1"
      },
      evidenceClassification: "observed",
      observedAt: createdAt,
      revision: "1"
    } as const;
    const envelopeFixtures = [
      [
        inboxV2SourceExternalIdentityEnvelopeSchema,
        INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
        baseSourceIdentity
      ],
      [
        inboxV2ConversationParticipantEnvelopeSchema,
        INBOX_V2_CONVERSATION_PARTICIPANT_SCHEMA_ID,
        baseParticipant
      ],
      [
        inboxV2ParticipantMembershipEpisodeEnvelopeSchema,
        INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
        baseInternalMembership
      ],
      [
        inboxV2ParticipantMembershipTransitionEnvelopeSchema,
        INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
        baseInternalMembershipTransition
      ],
      [
        inboxV2ParticipantAuthorObservationEnvelopeSchema,
        INBOX_V2_PARTICIPANT_AUTHOR_OBSERVATION_SCHEMA_ID,
        authorObservation
      ],
      [
        inboxV2ProviderRosterEvidenceEnvelopeSchema,
        INBOX_V2_PROVIDER_ROSTER_EVIDENCE_SCHEMA_ID,
        baseRosterEvidence
      ],
      [
        inboxV2ProviderRosterMemberEvidenceEnvelopeSchema,
        INBOX_V2_PROVIDER_ROSTER_MEMBER_EVIDENCE_SCHEMA_ID,
        baseRosterMemberEvidence
      ],
      [
        inboxV2SourceIdentityClaimEnvelopeSchema,
        INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
        baseClaim
      ],
      [
        inboxV2SourceIdentityClaimTransitionEnvelopeSchema,
        INBOX_V2_SOURCE_IDENTITY_CLAIM_TRANSITION_SCHEMA_ID,
        baseClaimTransition
      ]
    ] as const;

    for (const [schema, schemaId, payload] of envelopeFixtures) {
      const envelope = {
        schemaId,
        schemaVersion: INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        payload
      };

      expect(schema.safeParse(envelope).success).toBe(true);
      expect(
        schema.safeParse({ ...envelope, schemaId: "core:inbox-v2.other" })
          .success
      ).toBe(false);
      expect(
        schema.safeParse({ ...envelope, schemaVersion: "v2" }).success
      ).toBe(false);
      expect(schema.safeParse({ ...envelope, extra: true }).success).toBe(
        false
      );
    }
  });
});
