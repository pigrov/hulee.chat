import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_PERMISSION_REQUIREMENTS,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SET_HEAD_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_LINK_TRANSITION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX,
  INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS,
  INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
  inboxV2ConversationClientAssociationConfidenceSchema,
  inboxV2ConversationClientLinkActorSchema,
  inboxV2ConversationClientLinkEnvelopeSchema,
  inboxV2ConversationClientLinkEvidenceReferenceSchema,
  inboxV2ConversationClientCurrentLinkPageSchema,
  inboxV2ConversationClientLinkHistoryFixtureSchema,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationClientLinkSetHeadEnvelopeSchema,
  inboxV2ConversationClientLinkSetHeadSchema,
  inboxV2ConversationClientLinkTransitionEnvelopeSchema,
  inboxV2ConversationClientLinkTransitionSchema
} from "../index";

const tenantId = "tenant:tenant-1";
const otherTenantId = "tenant:tenant-2";
const firstAt = "2026-07-11T09:00:00.000Z";
const secondAt = "2026-07-11T10:00:00.000Z";
const thirdAt = "2026-07-11T11:00:00.000Z";

const conversationReference = {
  tenantId,
  kind: "conversation",
  id: "conversation:conversation-1"
} as const;
const firstClientReference = {
  tenantId,
  kind: "client",
  id: "client:client-1"
} as const;
const secondClientReference = {
  tenantId,
  kind: "client",
  id: "client:client-2"
} as const;
const employeeReference = {
  tenantId,
  kind: "employee",
  id: "employee:employee-1"
} as const;
const firstLinkReference = {
  tenantId,
  kind: "conversation_client_link",
  id: "conversation_client_link:link-1"
} as const;
const secondLinkReference = {
  tenantId,
  kind: "conversation_client_link",
  id: "conversation_client_link:link-2"
} as const;
const claimReference = {
  tenantId,
  kind: "source_identity_claim",
  id: "source_identity_claim:claim-1"
} as const;
const normalizedEventReference = {
  tenantId,
  kind: "normalized_inbound_event",
  id: "normalized_inbound_event:event-1"
} as const;
const policyAuthority = {
  family: "conversation_client_link",
  definitionContractVersion: "v1",
  definitionDigestSha256:
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  activationHeadRevision: "7"
} as const;

const manualDecision = {
  actor: {
    kind: "employee",
    employee: employeeReference
  },
  policyId: "core:manual-client-link",
  policyVersion: "v1",
  reasonCodeId: "core:operator-linked-client",
  policyAuthority: null
} as const;
const trustedPolicyDecision = {
  actor: {
    kind: "trusted_service",
    trustedServiceId: "core:client-link-resolver"
  },
  policyId: "core:verified-client-resolution",
  policyVersion: "v1",
  reasonCodeId: "core:verified-source-evidence",
  policyAuthority
} as const;
const migrationDecision = {
  actor: {
    kind: "migration_service",
    trustedServiceId: "core:inbox-v1-migration"
  },
  policyId: "core:inbox-v1-client-link-import",
  policyVersion: "v1",
  reasonCodeId: "core:legacy-client-association",
  policyAuthority: null
} as const;

const manualClaimVerification = {
  tenantId,
  conversation: conversationReference,
  client: firstClientReference,
  policyId: manualDecision.policyId,
  policyVersion: manualDecision.policyVersion,
  verifiedByTrustedServiceId: "core:client-link-resolver",
  verifiedAt: firstAt,
  policyAuthority: null,
  evidenceReferences: [
    { kind: "source_identity_claim", reference: claimReference }
  ]
} as const;
const trustedClaimVerification = {
  ...manualClaimVerification,
  policyId: trustedPolicyDecision.policyId,
  policyVersion: trustedPolicyDecision.policyVersion,
  verifiedByTrustedServiceId: trustedPolicyDecision.actor.trustedServiceId,
  policyAuthority
} as const;
const trustedPolicyVerification = {
  tenantId,
  conversation: conversationReference,
  client: secondClientReference,
  policyId: trustedPolicyDecision.policyId,
  policyVersion: trustedPolicyDecision.policyVersion,
  verifiedByTrustedServiceId: trustedPolicyDecision.actor.trustedServiceId,
  verifiedAt: secondAt,
  policyAuthority,
  evidenceReferences: [
    {
      kind: "normalized_inbound_event",
      reference: normalizedEventReference
    }
  ]
} as const;

const firstActiveLink = {
  tenantId,
  id: firstLinkReference.id,
  conversation: conversationReference,
  client: firstClientReference,
  roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject],
  associationConfidence: "confirmed",
  provenance: { kind: "manual" },
  auditEvidenceReferences: [],
  linkedBy: manualDecision,
  validFrom: firstAt,
  validFromBasis: "known_effective",
  state: "active",
  termination: null,
  revision: "1"
} as const;

const secondActiveLink = {
  tenantId,
  id: secondLinkReference.id,
  conversation: conversationReference,
  client: secondClientReference,
  roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.related],
  associationConfidence: "confirmed",
  provenance: {
    kind: "trusted_policy",
    verification: trustedPolicyVerification
  },
  auditEvidenceReferences: [
    {
      kind: "normalized_inbound_event",
      reference: normalizedEventReference
    }
  ],
  linkedBy: trustedPolicyDecision,
  validFrom: secondAt,
  validFromBasis: "known_effective",
  state: "active",
  termination: null,
  revision: "1"
} as const;

const firstCreateTransition = {
  tenantId,
  id: "conversation_client_link_transition:transition-1",
  conversation: conversationReference,
  operations: [{ kind: "create_link", link: firstLinkReference }],
  previousPrimaryLink: null,
  resultingPrimaryLink: firstLinkReference,
  decision: manualDecision,
  expectedRevision: null,
  currentRevision: null,
  resultingRevision: "1",
  occurredAt: firstAt
} as const;

const secondCreateTransition = {
  tenantId,
  id: "conversation_client_link_transition:transition-2",
  conversation: conversationReference,
  operations: [{ kind: "create_link", link: secondLinkReference }],
  previousPrimaryLink: firstLinkReference,
  resultingPrimaryLink: firstLinkReference,
  decision: trustedPolicyDecision,
  expectedRevision: "1",
  currentRevision: "1",
  resultingRevision: "2",
  occurredAt: secondAt
} as const;

const singleLinkHead = {
  tenantId,
  conversation: conversationReference,
  primaryLink: firstLinkReference,
  revision: "1",
  updatedAt: firstAt
} as const;

const twoLinkHead = {
  tenantId,
  conversation: conversationReference,
  primaryLink: firstLinkReference,
  revision: "2",
  updatedAt: secondAt
} as const;

function linkWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...firstActiveLink, ...overrides };
}

function transitionWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...firstCreateTransition, ...overrides };
}

describe("Inbox V2 Conversation-Client link contracts", () => {
  it("accepts zero, one and many linked Clients without a scalar Client field", () => {
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: null,
        links: [],
        transitions: []
      }).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: singleLinkHead,
        links: [firstActiveLink],
        transitions: [firstCreateTransition]
      }).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: twoLinkHead,
        links: [firstActiveLink, secondActiveLink],
        transitions: [firstCreateTransition, secondCreateTransition]
      }).success
    ).toBe(true);
  });

  it("serializes only active current links against an exact nullable link-set head", () => {
    const untouchedPage = {
      conversation: conversationReference,
      linkSetHead: null,
      linkSetRevision: null,
      links: []
    } as const;
    const currentPage = {
      conversation: conversationReference,
      linkSetHead: singleLinkHead,
      linkSetRevision: "1",
      links: [firstActiveLink]
    } as const;

    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse(untouchedPage)
        .success
    ).toBe(true);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse(currentPage)
        .success
    ).toBe(true);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        linkSetHead: { ...singleLinkHead, primaryLink: null }
      }).success
    ).toBe(true);

    for (const page of [
      { ...untouchedPage, linkSetRevision: "1" },
      { ...untouchedPage, links: [firstActiveLink] },
      { ...currentPage, linkSetRevision: null },
      { ...currentPage, linkSetRevision: "2" },
      {
        ...currentPage,
        links: [
          {
            ...firstActiveLink,
            state: "ended",
            termination: {
              endedAt: secondAt,
              decision: manualDecision
            },
            revision: "2"
          }
        ]
      }
    ]) {
      expect(
        inboxV2ConversationClientCurrentLinkPageSchema.safeParse(page).success
      ).toBe(false);
    }
  });

  it("keeps a current link page within one tenant and Conversation", () => {
    const currentPage = {
      conversation: conversationReference,
      linkSetHead: singleLinkHead,
      linkSetRevision: "1",
      links: [firstActiveLink]
    };

    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        linkSetHead: {
          ...singleLinkHead,
          conversation: {
            ...conversationReference,
            id: "conversation:conversation-unrelated"
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        links: [
          {
            ...firstActiveLink,
            conversation: {
              ...conversationReference,
              id: "conversation:conversation-unrelated"
            }
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        links: [
          {
            ...firstActiveLink,
            tenantId: otherTenantId
          }
        ]
      }).success
    ).toBe(false);
  });

  it("requires unique current link and Client identities", () => {
    const currentPage = {
      conversation: conversationReference,
      linkSetHead: singleLinkHead,
      linkSetRevision: "1",
      links: [firstActiveLink]
    };

    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        links: [
          firstActiveLink,
          { ...secondActiveLink, id: firstLinkReference.id }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...currentPage,
        links: [
          firstActiveLink,
          {
            ...firstActiveLink,
            id: secondLinkReference.id,
            validFrom: secondAt
          }
        ]
      }).success
    ).toBe(false);
  });

  it("bounds a current link page at exactly 256 active Clients", () => {
    expect(INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX).toBe(256);

    const links = Array.from(
      { length: INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX + 1 },
      (_, index) => ({
        ...firstActiveLink,
        id: `conversation_client_link:page-link-${index + 1}`,
        client: {
          ...firstClientReference,
          id: `client:page-client-${index + 1}`
        }
      })
    );
    const page = {
      conversation: conversationReference,
      linkSetHead: { ...singleLinkHead, primaryLink: null },
      linkSetRevision: "1"
    };

    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...page,
        links: links.slice(
          0,
          INBOX_V2_CONVERSATION_CLIENT_CURRENT_LINK_PAGE_MAX
        )
      }).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientCurrentLinkPageSchema.safeParse({
        ...page,
        links
      }).success
    ).toBe(false);
  });

  it("supports an audited atomic primary handoff", () => {
    const endedFirstLink = {
      ...firstActiveLink,
      state: "ended",
      termination: {
        endedAt: thirdAt,
        decision: manualDecision
      },
      revision: "2"
    } as const;
    const handoffTransition = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [{ kind: "end_link", link: firstLinkReference }],
      previousPrimaryLink: firstLinkReference,
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: thirdAt
    } as const;

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: {
          ...twoLinkHead,
          primaryLink: secondLinkReference,
          revision: "3",
          updatedAt: thirdAt
        },
        links: [endedFirstLink, secondActiveLink],
        transitions: [
          secondCreateTransition,
          handoffTransition,
          firstCreateTransition
        ]
      }).success
    ).toBe(true);
  });

  it("changes explicit primary without rewriting either active link episode", () => {
    const primaryOnlyTransition = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [],
      previousPrimaryLink: firstLinkReference,
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: thirdAt
    } as const;

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: {
          ...twoLinkHead,
          primaryLink: secondLinkReference,
          revision: "3",
          updatedAt: thirdAt
        },
        links: [firstActiveLink, secondActiveLink],
        transitions: [
          firstCreateTransition,
          secondCreateTransition,
          primaryOnlyTransition
        ]
      }).success
    ).toBe(true);
  });

  it("enforces exact null-to-1 and n-to-n-plus-1 CAS", () => {
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse(
        firstCreateTransition
      ).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse(
        secondCreateTransition
      ).success
    ).toBe(true);

    for (const transition of [
      transitionWith({ resultingRevision: "2" }),
      transitionWith({
        expectedRevision: "1",
        currentRevision: "2",
        resultingRevision: "3"
      }),
      transitionWith({
        expectedRevision: "1",
        currentRevision: "1",
        resultingRevision: "3"
      }),
      transitionWith({
        expectedRevision: "2",
        currentRevision: "2",
        resultingRevision: "2"
      })
    ]) {
      expect(
        inboxV2ConversationClientLinkTransitionSchema.safeParse(transition)
          .success
      ).toBe(false);
    }
  });

  it("rejects no-op, repeated and contradictory link-set operations", () => {
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse(
        transitionWith({
          operations: [],
          previousPrimaryLink: firstLinkReference,
          resultingPrimaryLink: firstLinkReference,
          expectedRevision: "1",
          currentRevision: "1",
          resultingRevision: "2"
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse(
        transitionWith({
          operations: [
            { kind: "create_link", link: firstLinkReference },
            { kind: "create_link", link: firstLinkReference }
          ]
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse(
        transitionWith({
          operations: [
            { kind: "create_link", link: firstLinkReference },
            { kind: "end_link", link: firstLinkReference }
          ]
        })
      ).success
    ).toBe(false);
  });

  it("keeps transition history, primary history and set head continuous", () => {
    const graph = {
      conversation: conversationReference,
      head: twoLinkHead,
      links: [firstActiveLink, secondActiveLink],
      transitions: [firstCreateTransition, secondCreateTransition]
    };

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        transitions: [
          firstCreateTransition,
          {
            ...secondCreateTransition,
            expectedRevision: "2",
            currentRevision: "2",
            resultingRevision: "3"
          }
        ],
        head: { ...twoLinkHead, revision: "3" }
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        transitions: [
          firstCreateTransition,
          {
            ...secondCreateTransition,
            previousPrimaryLink: null
          }
        ]
      }).success
    ).toBe(false);

    for (const head of [
      { ...twoLinkHead, revision: "3" },
      { ...twoLinkHead, updatedAt: thirdAt },
      { ...twoLinkHead, primaryLink: secondLinkReference },
      null
    ]) {
      expect(
        inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
          ...graph,
          head
        }).success
      ).toBe(false);
    }
  });

  it("rejects duplicate entities and overlapping episodes for one Client", () => {
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: singleLinkHead,
        links: [firstActiveLink, firstActiveLink],
        transitions: [firstCreateTransition]
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: singleLinkHead,
        links: [firstActiveLink],
        transitions: [firstCreateTransition, firstCreateTransition]
      }).success
    ).toBe(false);

    const endedFirstLink = {
      ...firstActiveLink,
      state: "ended",
      termination: { endedAt: thirdAt, decision: manualDecision },
      revision: "2"
    } as const;
    const overlappingSecondLink = {
      ...secondActiveLink,
      client: firstClientReference
    } as const;
    const endTransition = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [{ kind: "end_link", link: firstLinkReference }],
      previousPrimaryLink: firstLinkReference,
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: thirdAt
    } as const;

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: {
          ...twoLinkHead,
          primaryLink: secondLinkReference,
          revision: "3",
          updatedAt: thirdAt
        },
        links: [endedFirstLink, overlappingSecondLink],
        transitions: [
          firstCreateTransition,
          secondCreateTransition,
          endTransition
        ]
      }).success
    ).toBe(false);
  });

  it("keeps equal-start overlap verdict deterministic and rejects zero-length episodes", () => {
    const endedFirstLink = {
      ...firstActiveLink,
      state: "ended",
      termination: { endedAt: thirdAt, decision: manualDecision },
      revision: "2"
    } as const;
    const sameStartSecondLink = {
      ...firstActiveLink,
      id: secondLinkReference.id
    } as const;
    const createSecond = {
      ...secondCreateTransition,
      operations: [{ kind: "create_link", link: secondLinkReference }],
      resultingPrimaryLink: firstLinkReference,
      decision: manualDecision,
      occurredAt: firstAt
    } as const;
    const endFirst = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [{ kind: "end_link", link: firstLinkReference }],
      previousPrimaryLink: firstLinkReference,
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: thirdAt
    } as const;
    const graph = {
      conversation: conversationReference,
      head: {
        ...twoLinkHead,
        primaryLink: secondLinkReference,
        revision: "3",
        updatedAt: thirdAt
      },
      transitions: [firstCreateTransition, createSecond, endFirst]
    };
    const verdicts = [
      [endedFirstLink, sameStartSecondLink],
      [sameStartSecondLink, endedFirstLink]
    ].map(
      (links) =>
        inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
          ...graph,
          links
        }).success
    );

    expect(verdicts).toEqual([false, false]);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...firstActiveLink,
        state: "ended",
        termination: { endedAt: firstAt, decision: manualDecision },
        revision: "2"
      }).success
    ).toBe(false);
  });

  it("requires replacement of one Client active episode to be atomic", () => {
    const replacementLink = {
      ...firstActiveLink,
      id: secondLinkReference.id,
      validFrom: secondAt
    } as const;
    const atomicallyEndedLink = {
      ...firstActiveLink,
      state: "ended",
      termination: { endedAt: secondAt, decision: manualDecision },
      revision: "2"
    } as const;
    const atomicReplacement = {
      ...secondCreateTransition,
      operations: [
        { kind: "end_link", link: firstLinkReference },
        { kind: "create_link", link: secondLinkReference }
      ],
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision
    } as const;

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: {
          ...twoLinkHead,
          primaryLink: secondLinkReference
        },
        links: [atomicallyEndedLink, replacementLink],
        transitions: [firstCreateTransition, atomicReplacement]
      }).success
    ).toBe(true);

    const lateEndedLink = {
      ...atomicallyEndedLink,
      termination: { endedAt: thirdAt, decision: manualDecision }
    } as const;
    const stagedCreate = {
      ...atomicReplacement,
      operations: [{ kind: "create_link", link: secondLinkReference }],
      resultingPrimaryLink: firstLinkReference
    } as const;
    const stagedEnd = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [{ kind: "end_link", link: firstLinkReference }],
      previousPrimaryLink: firstLinkReference,
      resultingPrimaryLink: secondLinkReference,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: thirdAt
    } as const;

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: {
          ...twoLinkHead,
          primaryLink: secondLinkReference,
          revision: "3",
          updatedAt: thirdAt
        },
        links: [lateEndedLink, replacementLink],
        transitions: [firstCreateTransition, stagedCreate, stagedEnd]
      }).success
    ).toBe(false);
  });

  it.each([
    ["manual Employee", firstActiveLink],
    [
      "Employee-reviewed identity claim",
      linkWith({
        provenance: {
          kind: "source_identity_claim",
          claim: claimReference,
          verification: manualClaimVerification
        },
        auditEvidenceReferences: [
          { kind: "source_identity_claim", reference: claimReference }
        ]
      })
    ],
    [
      "trusted identity claim",
      linkWith({
        provenance: {
          kind: "source_identity_claim",
          claim: claimReference,
          verification: trustedClaimVerification
        },
        auditEvidenceReferences: [
          { kind: "source_identity_claim", reference: claimReference }
        ],
        linkedBy: trustedPolicyDecision
      })
    ],
    ["trusted policy", secondActiveLink],
    [
      "migration",
      linkWith({
        roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified],
        associationConfidence: "confirmed",
        provenance: {
          kind: "migration",
          provenanceId: INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
          contractVersion: "v1"
        },
        linkedBy: migrationDecision,
        validFromBasis: "migration_observed"
      })
    ]
  ])("accepts typed %s provenance with a compatible actor", (_name, link) => {
    expect(inboxV2ConversationClientLinkSchema.safeParse(link).success).toBe(
      true
    );
  });

  it("rejects incompatible provenance actors and ungrounded trusted policy", () => {
    for (const link of [
      linkWith({ linkedBy: trustedPolicyDecision }),
      {
        ...secondActiveLink,
        linkedBy: manualDecision
      },
      linkWith({
        provenance: {
          kind: "migration",
          provenanceId: INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
          contractVersion: "v1"
        },
        linkedBy: trustedPolicyDecision
      }),
      linkWith({
        provenance: {
          kind: "source_identity_claim",
          claim: claimReference,
          verification: manualClaimVerification
        },
        linkedBy: migrationDecision
      }),
      {
        ...secondActiveLink,
        provenance: {
          ...secondActiveLink.provenance,
          verification: {
            ...secondActiveLink.provenance.verification,
            evidenceReferences: []
          }
        }
      }
    ]) {
      expect(inboxV2ConversationClientLinkSchema.safeParse(link).success).toBe(
        false
      );
    }
  });

  it("keeps evidence typed, tenant-scoped and separate from provenance", () => {
    expect(
      inboxV2ConversationClientLinkEvidenceReferenceSchema.safeParse({
        kind: "source_identity_claim",
        reference: claimReference
      }).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkEvidenceReferenceSchema.safeParse({
        kind: "source_identity_claim",
        reference: normalizedEventReference
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          auditEvidenceReferences: [
            {
              kind: "normalized_inbound_event",
              reference: {
                ...normalizedEventReference,
                tenantId: otherTenantId
              }
            }
          ]
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          provenance: {
            kind: "source_identity_claim",
            claim: { ...claimReference, tenantId: otherTenantId },
            verification: manualClaimVerification
          }
        })
      ).success
    ).toBe(false);
  });

  it("binds trusted verification to the exact same-tenant Conversation, Client, service and claim", () => {
    for (const verification of [
      {
        ...trustedPolicyVerification,
        conversation: {
          ...conversationReference,
          id: "conversation:conversation-unrelated"
        }
      },
      { ...trustedPolicyVerification, client: firstClientReference },
      {
        ...trustedPolicyVerification,
        verifiedByTrustedServiceId: "core:another-resolver"
      },
      { ...trustedPolicyVerification, verifiedAt: thirdAt }
    ]) {
      expect(
        inboxV2ConversationClientLinkSchema.safeParse({
          ...secondActiveLink,
          provenance: { kind: "trusted_policy", verification }
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          provenance: {
            kind: "source_identity_claim",
            claim: claimReference,
            verification: {
              ...manualClaimVerification,
              evidenceReferences: [
                {
                  kind: "source_identity_claim",
                  reference: {
                    ...claimReference,
                    id: "source_identity_claim:claim-unrelated"
                  }
                }
              ]
            }
          }
        })
      ).success
    ).toBe(false);
  });

  it("rejects automatic tentative canonical links for their whole history", () => {
    const automaticTentative = {
      ...secondActiveLink,
      associationConfidence: "tentative"
    } as const;

    expect(
      inboxV2ConversationClientLinkSchema.safeParse(automaticTentative).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...secondActiveLink,
        associationConfidence: "supported"
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...automaticTentative,
        state: "ended",
        termination: {
          endedAt: thirdAt,
          decision: trustedPolicyDecision
        },
        revision: "2"
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...secondActiveLink,
        associationConfidence: "supported",
        state: "ended",
        termination: {
          endedAt: thirdAt,
          decision: trustedPolicyDecision
        },
        revision: "2"
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({ associationConfidence: "tentative" })
      ).success
    ).toBe(true);
  });

  it("keeps legacy migration links explicit and permanently non-primary", () => {
    const legacyLink = {
      ...firstActiveLink,
      roleIds: [INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified],
      associationConfidence: "confirmed",
      provenance: {
        kind: "migration",
        provenanceId: INBOX_V2_LEGACY_V1_CLIENT_LINK_PROVENANCE_ID,
        contractVersion: "v1"
      },
      linkedBy: migrationDecision,
      validFromBasis: "migration_observed"
    } as const;
    const migrationTransition = {
      ...firstCreateTransition,
      operations: [{ kind: "create_link", link: firstLinkReference }],
      resultingPrimaryLink: null,
      decision: migrationDecision
    } as const;
    const graph = {
      conversation: conversationReference,
      head: {
        ...singleLinkHead,
        primaryLink: null
      },
      links: [legacyLink],
      transitions: [migrationTransition]
    };

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse(graph).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        head: singleLinkHead,
        transitions: [
          { ...migrationTransition, resultingPrimaryLink: firstLinkReference }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps role sets unique and legacy-unspecified exclusive", () => {
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          roleIds: [
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject,
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.related
          ]
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          roleIds: [
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject,
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.subject
          ]
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse(
        linkWith({
          roleIds: [
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.legacyUnspecified,
            INBOX_V2_CORE_CONVERSATION_CLIENT_ROLE_IDS.related
          ]
        })
      ).success
    ).toBe(false);
  });

  it("requires coherent state, time, start basis and episode revision", () => {
    const ended = {
      ...firstActiveLink,
      state: "ended",
      termination: { endedAt: secondAt, decision: manualDecision },
      revision: "2"
    } as const;

    expect(inboxV2ConversationClientLinkSchema.safeParse(ended).success).toBe(
      true
    );
    for (const link of [
      { ...firstActiveLink, revision: "2" },
      { ...firstActiveLink, termination: ended.termination },
      { ...ended, revision: "1" },
      { ...ended, termination: null },
      {
        ...ended,
        termination: {
          ...ended.termination,
          endedAt: "2026-07-11T08:59:59.999Z"
        }
      },
      { ...firstActiveLink, validFromBasis: "migration_observed" }
    ]) {
      expect(inboxV2ConversationClientLinkSchema.safeParse(link).success).toBe(
        false
      );
    }
  });

  it("compares offset timestamps by instant when validating episode overlap", () => {
    const offsetStart = "2026-07-11T09:00:00.000+03:00";
    const boundary = "2026-07-11T07:00:00.000Z";
    const adjacentStart = "2026-07-11T10:00:00.000+03:00";
    const endedLink = {
      ...firstActiveLink,
      validFrom: offsetStart,
      state: "ended",
      termination: { endedAt: boundary, decision: manualDecision },
      revision: "2"
    } as const;
    const adjacentLink = {
      ...firstActiveLink,
      id: secondLinkReference.id,
      validFrom: adjacentStart
    } as const;
    const createFirst = {
      ...firstCreateTransition,
      resultingPrimaryLink: null,
      occurredAt: offsetStart
    } as const;
    const endFirst = {
      ...secondCreateTransition,
      operations: [{ kind: "end_link", link: firstLinkReference }],
      previousPrimaryLink: null,
      resultingPrimaryLink: null,
      decision: manualDecision,
      occurredAt: boundary
    } as const;
    const createAdjacent = {
      tenantId,
      id: "conversation_client_link_transition:transition-3",
      conversation: conversationReference,
      operations: [{ kind: "create_link", link: secondLinkReference }],
      previousPrimaryLink: null,
      resultingPrimaryLink: null,
      decision: manualDecision,
      expectedRevision: "2",
      currentRevision: "2",
      resultingRevision: "3",
      occurredAt: adjacentStart
    } as const;
    const graph = {
      conversation: conversationReference,
      head: {
        ...twoLinkHead,
        primaryLink: null,
        revision: "3",
        updatedAt: adjacentStart
      },
      links: [endedLink, adjacentLink],
      transitions: [createFirst, endFirst, createAdjacent]
    };

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse(graph).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        head: {
          ...graph.head,
          updatedAt: "2026-07-11T09:30:00.000+03:00"
        },
        links: [
          endedLink,
          {
            ...adjacentLink,
            validFrom: "2026-07-11T09:30:00.000+03:00"
          }
        ],
        transitions: [
          createFirst,
          endFirst,
          {
            ...createAdjacent,
            occurredAt: "2026-07-11T09:30:00.000+03:00"
          }
        ]
      }).success
    ).toBe(false);
  });

  it("requires transition decisions and timestamps to match link episodes", () => {
    const graph = {
      conversation: conversationReference,
      head: singleLinkHead,
      links: [firstActiveLink],
      transitions: [firstCreateTransition]
    };

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        transitions: [{ ...firstCreateTransition, occurredAt: secondAt }],
        head: { ...singleLinkHead, updatedAt: secondAt }
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        ...graph,
        transitions: [
          { ...firstCreateTransition, decision: trustedPolicyDecision }
        ]
      }).success
    ).toBe(false);
  });

  it("binds trusted-policy provenance to the exact recorded decision policy", () => {
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...secondActiveLink,
        provenance: {
          ...secondActiveLink.provenance,
          verification: {
            ...secondActiveLink.provenance.verification,
            policyId: "core:another-resolution-policy"
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSchema.safeParse({
        ...secondActiveLink,
        provenance: {
          ...secondActiveLink.provenance,
          verification: {
            ...secondActiveLink.provenance.verification,
            policyVersion: "v2"
          }
        }
      }).success
    ).toBe(false);
  });

  it("enforces the tenant boundary on every relationship and Employee actor", () => {
    for (const link of [
      linkWith({
        conversation: { ...conversationReference, tenantId: otherTenantId }
      }),
      linkWith({
        client: { ...firstClientReference, tenantId: otherTenantId }
      }),
      linkWith({
        linkedBy: {
          ...manualDecision,
          actor: {
            kind: "employee",
            employee: { ...employeeReference, tenantId: otherTenantId }
          }
        }
      })
    ]) {
      expect(inboxV2ConversationClientLinkSchema.safeParse(link).success).toBe(
        false
      );
    }
    expect(
      inboxV2ConversationClientLinkSetHeadSchema.safeParse({
        ...singleLinkHead,
        primaryLink: { ...firstLinkReference, tenantId: otherTenantId }
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse({
        ...firstCreateTransition,
        operations: [
          {
            kind: "create_link",
            link: { ...firstLinkReference, tenantId: otherTenantId }
          }
        ]
      }).success
    ).toBe(false);
  });

  it("keeps association confidence and actor vocabularies closed", () => {
    expect(
      inboxV2ConversationClientAssociationConfidenceSchema.safeParse(
        "confirmed"
      ).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientAssociationConfidenceSchema.safeParse(
        "provider_verified"
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkActorSchema.safeParse({
        kind: "employee",
        employee: employeeReference
      }).success
    ).toBe(true);
    expect(
      inboxV2ConversationClientLinkActorSchema.safeParse({
        kind: "account",
        account: {
          tenantId,
          kind: "account",
          id: "account:account-1"
        }
      }).success
    ).toBe(false);
  });

  it("keeps authorization, route, CRM and scalar Client fields outside link payloads", () => {
    for (const [field, value] of [
      ["clientId", firstClientReference.id],
      ["clientIds", [firstClientReference.id]],
      ["primaryClientId", firstClientReference.id],
      ["isPrimary", true],
      ["permissions", ["client.link.manage"]],
      ["principalId", "account:account-1"],
      ["sourceAccountId", "source_account:account-1"],
      ["outboundRouteId", "outbound_route:route-1"],
      ["workItemId", "work_item:work-1"],
      ["clientOwnerId", employeeReference.id],
      ["clientStageId", "client_stage:stage-1"]
    ] as const) {
      expect(
        inboxV2ConversationClientLinkSchema.safeParse(
          linkWith({ [field]: value })
        ).success
      ).toBe(false);
    }

    expect(
      inboxV2ConversationClientLinkHistoryFixtureSchema.safeParse({
        conversation: conversationReference,
        head: null,
        links: [],
        transitions: [],
        clientId: firstClientReference.id
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkSetHeadSchema.safeParse({
        ...singleLinkHead,
        permissions: ["conversation.clients.manage"]
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkTransitionSchema.safeParse({
        ...firstCreateTransition,
        outboundRouteId: "outbound_route:route-1"
      }).success
    ).toBe(false);
  });

  it("publishes exact permission conjunction metadata without embedding authority", () => {
    expect(INBOX_V2_CONVERSATION_CLIENT_LINK_PERMISSION_REQUIREMENTS).toEqual({
      conversation: "conversation.clients.manage",
      client: "client.link.manage"
    });
    expect("permissions" in firstActiveLink).toBe(false);
    expect("principalId" in firstActiveLink).toBe(false);
  });

  it("binds link, set-head and transition payloads to exact envelopes", () => {
    const fixtures = [
      [
        inboxV2ConversationClientLinkEnvelopeSchema,
        INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
        firstActiveLink
      ],
      [
        inboxV2ConversationClientLinkSetHeadEnvelopeSchema,
        INBOX_V2_CONVERSATION_CLIENT_LINK_SET_HEAD_SCHEMA_ID,
        singleLinkHead
      ],
      [
        inboxV2ConversationClientLinkTransitionEnvelopeSchema,
        INBOX_V2_CONVERSATION_CLIENT_LINK_TRANSITION_SCHEMA_ID,
        firstCreateTransition
      ]
    ] as const;

    for (const [schema, schemaId, payload] of fixtures) {
      expect(
        schema.safeParse({
          schemaId,
          schemaVersion: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
          payload
        }).success
      ).toBe(true);
      expect(
        schema.safeParse({
          schemaId: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
          schemaVersion: "v2",
          payload
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2ConversationClientLinkEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_CONVERSATION_CLIENT_LINK_SET_HEAD_SCHEMA_ID,
        schemaVersion: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
        payload: firstActiveLink
      }).success
    ).toBe(false);
    expect(
      inboxV2ConversationClientLinkEnvelopeSchema.safeParse({
        schemaId: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
        schemaVersion: INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
        payload: firstActiveLink,
        clientId: firstClientReference.id
      }).success
    ).toBe(false);
  });
});
