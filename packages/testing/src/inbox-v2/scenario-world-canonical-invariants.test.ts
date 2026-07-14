import {
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
  INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_VERSION,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
  INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
  INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
  INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
  INBOX_V2_STAFF_NOTE_SCHEMA_ID,
  INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
  INBOX_V2_WORK_ITEM_SCHEMA_ID,
  INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
  inboxV2ConversationClientLinkSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationSchema,
  inboxV2ExternalThreadSchema,
  inboxV2MessageSchema,
  inboxV2ParticipantMembershipEpisodeSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2SourceExternalIdentitySchema,
  inboxV2SourceIdentityClaimSchema,
  inboxV2StaffNoteSchema,
  inboxV2TimelineContentHeadOf,
  inboxV2WorkItemSchema
} from "@hulee/contracts";
import {
  createInboxV2ScenarioAuthorization,
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  inboxV2CanonicalScenarioGuard,
  inboxV2ScenarioClientLink,
  inboxV2ScenarioContent,
  inboxV2ScenarioConversation,
  inboxV2ScenarioEntity,
  inboxV2ScenarioExternalThread,
  inboxV2ScenarioIdentityClaim,
  inboxV2ScenarioLater,
  inboxV2ScenarioMessage,
  inboxV2ScenarioNow,
  inboxV2ScenarioParticipant,
  inboxV2ScenarioSourceIdentity,
  inboxV2ScenarioStaffNote,
  inboxV2ScenarioWorkItem,
  type InboxV2ScenarioSeedRecord,
  type InboxV2ScenarioStepResult,
  type InboxV2ScenarioWorld
} from "@hulee/testing";
import { describe, expect, it } from "vitest";
import type { ZodType } from "zod";

const tenantId = "tenant:scenario-canonical-invariants";
const missingConversationId = "conversation:missing";

describe("Inbox V2 scenario-world canonical graph invariants", () => {
  it.each([
    {
      label: "ConversationParticipantSet",
      record: () =>
        participantSetRecord(missingConversationId, [
          {
            participantId: "conversation_participant:orphan",
            employeeId: "employee:orphan"
          }
        ])
    },
    {
      label: "WorkItem",
      record: () =>
        workItemRecord(
          inboxV2ScenarioWorkItem({
            tenantId,
            conversationId: missingConversationId,
            id: "work_item:orphan"
          })
        )
    },
    {
      label: "ExternalThread",
      record: () => {
        const value = inboxV2ScenarioExternalThread({
          tenantId,
          conversationId: missingConversationId,
          id: "external_thread:orphan",
          sourceAccountId: "source_account:orphan",
          topology: "direct"
        });
        return seed(
          entity("core:external-thread", value.id),
          INBOX_V2_EXTERNAL_THREAD_SCHEMA_ID,
          INBOX_V2_EXTERNAL_THREAD_SCHEMA_VERSION,
          inboxV2ExternalThreadSchema,
          value
        );
      }
    },
    {
      label: "ConversationClientLink",
      record: () => {
        const value = inboxV2ScenarioClientLink({
          tenantId,
          conversationId: missingConversationId,
          clientId: "client:orphan",
          id: "conversation_client_link:orphan",
          actorEmployeeId: "employee:operator-1"
        });
        return seed(
          entity("core:conversation-client-link", value.id),
          INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_ID,
          INBOX_V2_CONVERSATION_CLIENT_LINK_SCHEMA_VERSION,
          inboxV2ConversationClientLinkSchema,
          value
        );
      }
    },
    {
      label: "StaffNote",
      record: () => {
        const value = inboxV2ScenarioStaffNote({
          tenantId,
          conversationId: missingConversationId,
          id: "staff_note:orphan",
          authorParticipantId: "conversation_participant:missing"
        });
        return seed(
          entity("core:staff-note", value.id),
          INBOX_V2_STAFF_NOTE_SCHEMA_ID,
          INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
          inboxV2StaffNoteSchema,
          value
        );
      }
    },
    {
      label: "Message",
      record: () => {
        const value = inboxV2ScenarioMessage({
          tenantId,
          conversationId: missingConversationId,
          id: "message:orphan",
          authorParticipantId: "conversation_participant:missing",
          origin: "source_originated"
        });
        return seed(
          entity("core:message", value.id),
          INBOX_V2_MESSAGE_SCHEMA_ID,
          INBOX_V2_MESSAGE_SCHEMA_VERSION,
          inboxV2MessageSchema,
          value
        );
      }
    }
  ])("rejects an orphan $label Conversation reference", ({ record }) => {
    expect(() =>
      createInboxV2ScenarioWorld({ tenantId, records: [record()] })
    ).toThrow();
  });

  it("rejects two distinct active claims for one SourceExternalIdentity", () => {
    const identityId = "source_external_identity:duplicate-active-claims";
    const firstClaim = inboxV2ScenarioIdentityClaim({
      tenantId,
      sourceIdentityId: identityId,
      clientContactId: "client_contact:first-target",
      actorEmployeeId: "employee:operator-1",
      id: "source_identity_claim:first-active"
    });
    const secondClaim = inboxV2SourceIdentityClaimSchema.parse({
      ...inboxV2ScenarioIdentityClaim({
        tenantId,
        sourceIdentityId: identityId,
        clientContactId: "client_contact:second-target",
        actorEmployeeId: "employee:operator-1",
        id: "source_identity_claim:second-active"
      }),
      previousClaimVersion: "1",
      claimVersion: "2"
    });
    const identity = inboxV2ScenarioSourceIdentity({
      tenantId,
      id: identityId,
      resolution: {
        status: "claimed",
        activeClaim: {
          tenantId,
          kind: "source_identity_claim",
          id: secondClaim.id
        }
      },
      latestClaimVersion: "2"
    });

    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: [
          sourceIdentityRecord(identity),
          sourceIdentityClaimRecord(firstClaim),
          sourceIdentityClaimRecord(secondClaim)
        ]
      })
    ).toThrow();
  });

  it.each([
    {
      label: "claim id",
      records: () => {
        const identityId = "source_external_identity:wrong-claim-id";
        const claim = inboxV2ScenarioIdentityClaim({
          tenantId,
          sourceIdentityId: identityId,
          clientContactId: "client_contact:claim-id",
          actorEmployeeId: "employee:operator-1",
          id: "source_identity_claim:persisted"
        });
        const identity = claimedSourceIdentity(
          identityId,
          "source_identity_claim:not-persisted",
          "1"
        );
        return [
          sourceIdentityRecord(identity),
          sourceIdentityClaimRecord(claim)
        ];
      }
    },
    {
      label: "claim version",
      records: () => {
        const identityId = "source_external_identity:wrong-claim-version";
        const claim = inboxV2ScenarioIdentityClaim({
          tenantId,
          sourceIdentityId: identityId,
          clientContactId: "client_contact:claim-version",
          actorEmployeeId: "employee:operator-1",
          id: "source_identity_claim:wrong-version"
        });
        const identity = claimedSourceIdentity(identityId, claim.id, "2");
        return [
          sourceIdentityRecord(identity),
          sourceIdentityClaimRecord(claim)
        ];
      }
    },
    {
      label: "claim identity target",
      records: () => {
        const headIdentityId = "source_external_identity:claim-head";
        const claimIdentityId = "source_external_identity:claim-target";
        const claim = inboxV2ScenarioIdentityClaim({
          tenantId,
          sourceIdentityId: claimIdentityId,
          clientContactId: "client_contact:claim-target",
          actorEmployeeId: "employee:operator-1",
          id: "source_identity_claim:wrong-identity-target"
        });
        return [
          sourceIdentityRecord(
            claimedSourceIdentity(headIdentityId, claim.id, "1")
          ),
          sourceIdentityRecord(
            inboxV2ScenarioSourceIdentity({
              tenantId,
              id: claimIdentityId
            })
          ),
          sourceIdentityClaimRecord(claim)
        ];
      }
    }
  ])(
    "rejects an active claim that disagrees with the canonical $label head",
    ({ records }) => {
      expect(() =>
        createInboxV2ScenarioWorld({ tenantId, records: records() })
      ).toThrow();
    }
  );

  it("rejects a SourceIdentityClaim whose SourceExternalIdentity is missing", () => {
    const claim = inboxV2ScenarioIdentityClaim({
      tenantId,
      sourceIdentityId: "source_external_identity:missing-for-claim",
      clientContactId: "client_contact:missing-identity",
      actorEmployeeId: "employee:operator-1",
      id: "source_identity_claim:missing-identity"
    });

    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: [sourceIdentityClaimRecord(claim)]
      })
    ).toThrow();
  });

  it("rejects a Message author rewrite across contiguous revisions", () => {
    const conversationId = "conversation:message-immutability";
    const records = validInternalGroupRecords(conversationId);
    const before = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: "message:immutable",
      authorParticipantId: "conversation_participant:operator",
      origin: "internal"
    });
    const messageEntity = entity("core:message", before.id);
    const world = createInboxV2ScenarioWorld({
      tenantId,
      records: [
        ...records,
        seed(
          messageEntity,
          INBOX_V2_MESSAGE_SCHEMA_ID,
          INBOX_V2_MESSAGE_SCHEMA_VERSION,
          inboxV2MessageSchema,
          before
        )
      ]
    });
    const after = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: before.id,
      authorParticipantId: "conversation_participant:member",
      origin: "internal",
      revision: "2",
      updatedAt: inboxV2ScenarioLater
    });

    expectMutationRejected(() =>
      executeMutation(world, {
        suffix: "message-author-rewrite",
        entity: messageEntity,
        schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
        schema: inboxV2MessageSchema,
        value: after
      })
    );
  });

  it("rejects a StaffNote author rewrite across contiguous revisions", () => {
    const conversationId = "conversation:staff-note-immutability";
    const records = validInternalGroupRecords(conversationId);
    const before = inboxV2ScenarioStaffNote({
      tenantId,
      conversationId,
      id: "staff_note:immutable",
      authorParticipantId: "conversation_participant:operator"
    });
    const noteEntity = entity("core:staff-note", before.id);
    const world = createInboxV2ScenarioWorld({
      tenantId,
      records: [
        ...records,
        seed(
          noteEntity,
          INBOX_V2_STAFF_NOTE_SCHEMA_ID,
          INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
          inboxV2StaffNoteSchema,
          before
        )
      ]
    });
    const after = inboxV2StaffNoteSchema.parse({
      ...before,
      authorParticipant: {
        tenantId,
        kind: "conversation_participant",
        id: "conversation_participant:member"
      },
      content: inboxV2TimelineContentHeadOf(
        inboxV2ScenarioContent({
          tenantId,
          id: before.content.content.id,
          revision: "2",
          updatedAt: inboxV2ScenarioLater
        })
      ),
      revision: "2",
      updatedAt: inboxV2ScenarioLater
    });

    expectMutationRejected(() =>
      executeMutation(world, {
        suffix: "staff-note-author-rewrite",
        entity: noteEntity,
        schemaId: INBOX_V2_STAFF_NOTE_SCHEMA_ID,
        schemaVersion: INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
        schema: inboxV2StaffNoteSchema,
        value: after
      })
    );
  });

  it("rejects WorkItem identity and creation-attribution rewrites", () => {
    const sourceConversationId = "conversation:work-source";
    const destinationConversationId = "conversation:work-destination";
    const before = inboxV2ScenarioWorkItem({
      tenantId,
      conversationId: sourceConversationId,
      id: "work_item:immutable"
    });
    const workEntity = entity("core:work-item", before.id);
    const world = createInboxV2ScenarioWorld({
      tenantId,
      records: [
        conversationRecord(sourceConversationId, "direct", "external"),
        conversationRecord(destinationConversationId, "direct", "external"),
        workItemRecord(before)
      ]
    });
    const after = inboxV2WorkItemSchema.parse({
      ...before,
      conversation: {
        tenantId,
        kind: "conversation",
        id: destinationConversationId
      },
      ordinal: "2",
      createdBy: {
        kind: "trusted_service",
        trustedServiceId: "core:rewritten-intake"
      },
      creationReasonId: "core:rewritten-reason",
      revision: "2",
      updatedAt: inboxV2ScenarioLater
    });

    expectMutationRejected(() =>
      executeMutation(world, {
        suffix: "work-item-identity-rewrite",
        entity: workEntity,
        schemaId: INBOX_V2_WORK_ITEM_SCHEMA_ID,
        schemaVersion: INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
        schema: inboxV2WorkItemSchema,
        value: after
      })
    );
  });

  it("rejects two simultaneous non-terminal WorkItems for one Conversation", () => {
    const conversationId = "conversation:duplicate-active-work";
    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: [
          conversationRecord(conversationId, "direct", "external"),
          workItemRecord(
            inboxV2ScenarioWorkItem({
              tenantId,
              conversationId,
              id: "work_item:first-active"
            })
          ),
          workItemRecord(
            inboxV2ScenarioWorkItem({
              tenantId,
              conversationId,
              id: "work_item:second-active"
            })
          )
        ]
      })
    ).toThrow();
  });

  it("rejects an internal direct with a third active Employee member", () => {
    const conversationId = "conversation:internal-direct-three";
    const members = [
      member("operator", "employee:operator-1", "owner"),
      member("second", "employee:second", "member"),
      member("third", "employee:third", "member")
    ] as const;

    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: internalConversationRecords(conversationId, "direct", members)
      })
    ).toThrow();
  });

  it("rejects an active internal group with fewer than two active Employee members", () => {
    const conversationId = "conversation:internal-group-one";
    const members = [
      member("operator", "employee:operator-1", "owner")
    ] as const;

    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: internalConversationRecords(conversationId, "group", members)
      })
    ).toThrow();
  });

  it("rejects an active internal group without an active owner", () => {
    const conversationId = "conversation:internal-group-ownerless";
    const members = [
      member("operator", "employee:operator-1", "member"),
      member("second", "employee:second", "member")
    ] as const;

    expect(() =>
      createInboxV2ScenarioWorld({
        tenantId,
        records: internalConversationRecords(conversationId, "group", members)
      })
    ).toThrow();
  });
});

type InternalMember = Readonly<{
  participantId: string;
  employeeId: string;
  role: "owner" | "admin" | "member" | "observer";
}>;

function member(
  suffix: string,
  employeeId: string,
  role: InternalMember["role"]
): InternalMember {
  return {
    participantId: `conversation_participant:${suffix}`,
    employeeId,
    role
  };
}

function validInternalGroupRecords(
  conversationId: string
): readonly InboxV2ScenarioSeedRecord[] {
  return internalConversationRecords(conversationId, "group", [
    member("operator", "employee:operator-1", "owner"),
    member("member", "employee:member", "member")
  ]);
}

function internalConversationRecords(
  conversationId: string,
  topology: "direct" | "group",
  members: readonly InternalMember[]
): readonly InboxV2ScenarioSeedRecord[] {
  return [
    conversationRecord(conversationId, topology, "internal"),
    participantSetRecord(conversationId, members),
    ...members.flatMap((entry) => membershipRecords(entry))
  ];
}

function membershipRecords(
  memberEntry: InternalMember
): readonly InboxV2ScenarioSeedRecord[] {
  const suffix = memberEntry.participantId.split(":").at(-1);
  const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
    tenantId,
    id: `participant_membership_episode:${suffix}`,
    participant: {
      tenantId,
      kind: "conversation_participant",
      id: memberEntry.participantId
    },
    origin: { kind: "hulee_internal_command" },
    state: "active",
    role: memberEntry.role,
    evidenceClassification: "confirmed",
    validFrom: inboxV2ScenarioNow,
    validTo: null,
    revision: "1"
  });
  const transition = inboxV2ParticipantMembershipTransitionSchema.parse({
    tenantId,
    id: `participant_membership_transition:${suffix}`,
    episode: {
      tenantId,
      kind: "participant_membership_episode",
      id: episode.id
    },
    intent: "initial_active",
    fromState: null,
    toState: "active",
    fromRole: null,
    toRole: memberEntry.role,
    cause: {
      kind: "hulee_internal_command",
      actorEmployee: {
        tenantId,
        kind: "employee",
        id: "employee:operator-1"
      }
    },
    reasonCodeId: "core:conversation-created",
    expectedRevision: null,
    currentRevision: null,
    resultingRevision: "1",
    occurredAt: inboxV2ScenarioNow
  });
  return [
    seed(
      entity("core:participant-membership-episode", episode.id),
      INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
      INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
      inboxV2ParticipantMembershipEpisodeSchema,
      episode
    ),
    seed(
      entity("core:participant-membership-transition", transition.id),
      INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
      INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
      inboxV2ParticipantMembershipTransitionSchema,
      transition
    )
  ];
}

function conversationRecord(
  conversationId: string,
  topology: "direct" | "group",
  transport: "internal" | "external"
): InboxV2ScenarioSeedRecord {
  const value = inboxV2ScenarioConversation({
    tenantId,
    id: conversationId,
    topology,
    transport
  });
  return seed(
    entity("core:conversation", conversationId),
    INBOX_V2_CONVERSATION_SCHEMA_ID,
    INBOX_V2_CONVERSATION_SCHEMA_VERSION,
    inboxV2ConversationSchema,
    value
  );
}

function participantSetRecord(
  conversationId: string,
  members: readonly Pick<InternalMember, "participantId" | "employeeId">[]
): InboxV2ScenarioSeedRecord {
  const participants = members.map((entry) =>
    inboxV2ScenarioParticipant({
      tenantId,
      conversationId,
      id: entry.participantId,
      subject: { kind: "employee", employeeId: entry.employeeId }
    })
  );
  return seed(
    entity(
      "core:conversation-participant-set",
      `conversation_participant_set:${conversationId.split(":").at(-1)}`
    ),
    "core:inbox-v2.conversation-participant-set",
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2ConversationParticipantSetSchema,
    participants
  );
}

function workItemRecord(
  value: ReturnType<typeof inboxV2ScenarioWorkItem>
): InboxV2ScenarioSeedRecord {
  return seed(
    entity("core:work-item", value.id),
    INBOX_V2_WORK_ITEM_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemSchema,
    value
  );
}

function claimedSourceIdentity(
  identityId: string,
  activeClaimId: string,
  latestClaimVersion: string
): ReturnType<typeof inboxV2ScenarioSourceIdentity> {
  return inboxV2ScenarioSourceIdentity({
    tenantId,
    id: identityId,
    resolution: {
      status: "claimed",
      activeClaim: {
        tenantId,
        kind: "source_identity_claim",
        id: activeClaimId
      }
    },
    latestClaimVersion
  });
}

function sourceIdentityRecord(
  value: ReturnType<typeof inboxV2ScenarioSourceIdentity>
): InboxV2ScenarioSeedRecord {
  return seed(
    entity("core:source-external-identity", value.id),
    INBOX_V2_SOURCE_EXTERNAL_IDENTITY_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceExternalIdentitySchema,
    value
  );
}

function sourceIdentityClaimRecord(
  value: ReturnType<typeof inboxV2ScenarioIdentityClaim>
): InboxV2ScenarioSeedRecord {
  return seed(
    entity("core:source-identity-claim", value.id),
    INBOX_V2_SOURCE_IDENTITY_CLAIM_SCHEMA_ID,
    INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
    inboxV2SourceIdentityClaimSchema,
    value
  );
}

function executeMutation<T>(
  world: InboxV2ScenarioWorld,
  input: Readonly<{
    suffix: string;
    entity: ReturnType<typeof entity>;
    schemaId: string;
    schemaVersion: string;
    schema: ZodType<T>;
    value: T;
  }>
): InboxV2ScenarioStepResult {
  return executeInboxV2ScenarioStep(world, {
    id: input.suffix,
    commandId: `scenario-command:${input.suffix}`,
    requestId: `scenario-request:${input.suffix}`,
    clientMutationId: `scenario-mutation:${input.suffix}`,
    requestHash: `sha256:${"a".repeat(64)}`,
    committedAt: inboxV2ScenarioLater,
    authorization: mutationAuthorization(),
    transition: () => ({
      kind: "commit",
      changes: [
        {
          entity: input.entity,
          expectedRevision: "1",
          resultingRevision: "2",
          schemaId: input.schemaId,
          schemaVersion: input.schemaVersion,
          schema: input.schema,
          value: input.value,
          audience: "staff_only"
        }
      ]
    })
  });
}

function mutationAuthorization() {
  const resource = entity("core:employee", "employee:operator-1");
  return createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: "employee:operator-1",
    requirements: [
      {
        id: "canonical-invariant-fixture-authorization",
        permissionId: "core:employee.directory.view",
        resource,
        guard: inboxV2CanonicalScenarioGuard("none")
      }
    ],
    grants: [
      {
        id: "canonical-invariant-fixture-grant",
        permissionId: "core:employee.directory.view"
      }
    ]
  });
}

function expectMutationRejected(action: () => InboxV2ScenarioStepResult): void {
  try {
    expect(action().outcome).not.toBe("committed");
  } catch (error) {
    expect(error).toBeInstanceOf(Error);
  }
}

function entity(entityTypeId: string, entityId: string) {
  return inboxV2ScenarioEntity(tenantId, entityTypeId, entityId);
}

function seed<T>(
  recordEntity: ReturnType<typeof entity>,
  schemaId: string,
  schemaVersion: string,
  schema: ZodType<T>,
  value: T,
  revision = "1"
): InboxV2ScenarioSeedRecord<T> {
  return {
    entity: recordEntity,
    revision,
    schemaId,
    schemaVersion,
    schema,
    value
  };
}
