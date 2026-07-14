import {
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
  INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageSchema,
  inboxV2ParticipantMembershipEpisodeSchema,
  inboxV2ParticipantMembershipGraphSchema,
  inboxV2ParticipantMembershipTransitionSchema,
  inboxV2TenantIdSchema,
  isInboxV2ConfirmedInternalEmployeeMembership,
  type InboxV2EntityKey
} from "@hulee/contracts";
import {
  type InboxV2CanonicalScopeFact,
  type InboxV2PolicyGuardEvidence
} from "@hulee/core";
import { describe, expect, it } from "vitest";

import {
  createInboxV2ScenarioAuthorization,
  inboxV2CanonicalScenarioGuard,
  inboxV2InternalMembershipScenarioGuard,
  inboxV2ScenarioContent,
  inboxV2ScenarioContractIds,
  inboxV2ScenarioConversation,
  inboxV2ScenarioEntity,
  inboxV2ScenarioLater,
  inboxV2ScenarioMessage,
  inboxV2ScenarioNow,
  inboxV2ScenarioNotAfter,
  inboxV2ScenarioParticipant,
  inboxV2ScenarioStateSchema,
  type InboxV2ScenarioState
} from "./scenario-fixtures";
import {
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  getInboxV2ScenarioRecord,
  snapshotInboxV2ScenarioWorld,
  type InboxV2ScenarioStep,
  type InboxV2ScenarioWorld
} from "./scenario-world";

const tenantId = "tenant:scenario-internal";
const ownerId = "employee:internal-owner";
const adminId = "employee:internal-admin";
const memberId = "employee:operator-1";
const observerId = "employee:internal-observer";
const outsiderId = "employee:internal-outsider";

const directConversationId = "conversation:internal-direct-1";
const groupConversationId = "conversation:internal-group-1";
const groupMessageId = "message:internal-group-1";
const groupAuthorParticipantId =
  "conversation_participant:internal-group-member";

type InternalConversationKind = "internal_direct" | "internal_group";

type InternalMember = Readonly<{
  employeeId: string;
  participantId: string;
  role: "owner" | "admin" | "member" | "observer";
}>;

const directMembers: readonly InternalMember[] = [
  {
    employeeId: ownerId,
    participantId: "conversation_participant:internal-direct-owner",
    role: "owner"
  },
  {
    employeeId: memberId,
    participantId: "conversation_participant:internal-direct-member",
    role: "member"
  }
];

const groupMembers: readonly InternalMember[] = [
  {
    employeeId: ownerId,
    participantId: "conversation_participant:internal-group-owner",
    role: "owner"
  },
  {
    employeeId: adminId,
    participantId: "conversation_participant:internal-group-admin",
    role: "admin"
  },
  {
    employeeId: memberId,
    participantId: groupAuthorParticipantId,
    role: "member"
  },
  {
    employeeId: observerId,
    participantId: "conversation_participant:internal-group-observer",
    role: "observer"
  }
];

describe("INB2-CON-009 internal Inbox V2 scenarios", () => {
  it("creates an internal direct chat with exactly two Employee anchors", () => {
    const initial = createInboxV2ScenarioWorld({ tenantId });
    const created = executeInboxV2ScenarioStep(
      initial,
      createInternalConversationStep({
        conversationId: directConversationId,
        kind: "internal_direct",
        members: directMembers,
        suffix: "direct-valid"
      })
    );

    expect(created.outcome, outcomeDetails(created)).toBe("committed");
    if (created.outcome !== "committed") return;

    const state = recordValue<InboxV2ScenarioState>(
      created.world,
      stateEntity(directConversationId)
    );
    const participants = recordValue<
      ReturnType<typeof inboxV2ConversationParticipantSetSchema.parse>
    >(created.world, participantSetEntity(directConversationId));

    expect(state).toMatchObject({
      kind: "internal_direct",
      employeeAnchorIds: [ownerId, memberId],
      clientIds: [],
      workItemId: null,
      primaryResponsibleEmployeeId: null,
      groupBindingId: null
    });
    expect(participants).toHaveLength(2);
    expect(
      participants.every(({ subject }) => subject.kind === "employee")
    ).toBe(true);
    const membershipProjection = deriveInternalMembershipProjection(
      created.world,
      directConversationId
    );
    expect(membershipProjection.activeEmployeeIds).toEqual(
      [ownerId, memberId].sort()
    );
    expect(membershipProjection.ownerEmployeeIds).toEqual([ownerId]);
    expect(recordsOfType(created.world, "core:client")).toHaveLength(0);
    expect(recordsOfType(created.world, "core:work-item")).toHaveLength(0);
    expect(
      recordsOfType(created.world, "core:source-thread-binding")
    ).toHaveLength(0);
    expect(recordsOfType(created.world, "core:outbound-route")).toHaveLength(0);
    expect(created.world.outboxIntents).toHaveLength(0);

    const invalidMembers = [
      ...directMembers,
      {
        employeeId: observerId,
        participantId: "conversation_participant:internal-direct-third",
        role: "member" as const
      }
    ];
    const denied = executeInboxV2ScenarioStep(
      initial,
      createInternalConversationStep({
        conversationId: "conversation:internal-direct-invalid",
        kind: "internal_direct",
        members: invalidMembers,
        suffix: "direct-third-member"
      })
    );
    expect(denied).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "permission.denied" }
    });
    expect(denied.world).toBe(initial);
  });

  it("enforces internal group roles without provider delivery", () => {
    const created = createInternalGroupWorld();
    const beforeDenied = snapshotInboxV2ScenarioWorld(created);

    const outsider = executeInboxV2ScenarioStep(
      created,
      sendInternalStep({
        employeeId: outsiderId,
        membershipRole: "member",
        includeMembershipFact: false,
        suffix: "outsider"
      })
    );
    expect(outsider).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "permission.denied" }
    });
    expect(outsider.world).toBe(created);
    expect(snapshotInboxV2ScenarioWorld(outsider.world)).toEqual(beforeDenied);

    const observer = executeInboxV2ScenarioStep(
      created,
      sendInternalStep({
        employeeId: observerId,
        membershipRole: "observer",
        includeMembershipFact: true,
        suffix: "observer"
      })
    );
    expect(observer).toMatchObject({
      outcome: "rejected",
      authorization: { publicErrorCode: "permission.denied" }
    });
    expect(observer.world).toBe(created);

    const sent = executeInboxV2ScenarioStep(
      created,
      sendInternalStep({
        employeeId: memberId,
        membershipRole: "member",
        includeMembershipFact: true,
        suffix: "member"
      })
    );
    expect(sent.outcome, outcomeDetails(sent)).toBe("committed");
    if (sent.outcome !== "committed") return;

    const state = recordValue<InboxV2ScenarioState>(
      sent.world,
      stateEntity(groupConversationId)
    );
    const message = recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
      sent.world,
      messageEntity()
    );
    expect(state).toMatchObject({
      kind: "internal_group",
      ownerEmployeeIds: [ownerId],
      clientIds: [],
      workItemId: null,
      groupBindingId: null,
      physicalMessageIds: [groupMessageId]
    });
    const membershipProjection = deriveInternalMembershipProjection(
      sent.world,
      groupConversationId
    );
    expect(membershipProjection.graphs).toHaveLength(groupMembers.length);
    expect(membershipProjection.roleByEmployee).toMatchObject({
      [ownerId]: "owner",
      [adminId]: "admin",
      [memberId]: "member",
      [observerId]: "observer"
    });
    expect(membershipProjection.ownerEmployeeIds).toEqual([ownerId]);
    expect(membershipProjection.activeEmployeeIds).toEqual(
      [ownerId, adminId, memberId, observerId].sort()
    );
    expect([...state.ownerEmployeeIds].sort()).toEqual(
      membershipProjection.ownerEmployeeIds
    );
    expect([...state.employeeAnchorIds].sort()).toEqual(
      membershipProjection.activeEmployeeIds
    );
    expect(message).toMatchObject({
      origin: { kind: "internal" },
      authorParticipant: { id: groupAuthorParticipantId }
    });
    expect(
      sent.world.outboxIntents.map(({ effectClass }) => effectClass)
    ).toEqual(["projection", "notification"]);
    expect(
      sent.world.outboxIntents.some(
        ({ effectClass, typeId }) =>
          effectClass === "provider_io" || typeId === "core:provider.dispatch"
      )
    ).toBe(false);
  });

  it("authorizes an internal own-message edit and applies contiguous CAS revisions", () => {
    const created = createInternalGroupWorld();
    const sent = executeInboxV2ScenarioStep(
      created,
      sendInternalStep({
        employeeId: memberId,
        membershipRole: "member",
        includeMembershipFact: true,
        suffix: "edit-fixture"
      })
    );
    expect(sent.outcome, outcomeDetails(sent)).toBe("committed");
    if (sent.outcome !== "committed") return;

    const original = recordValue<ReturnType<typeof inboxV2ScenarioMessage>>(
      sent.world,
      messageEntity()
    );
    const edited = executeInboxV2ScenarioStep(
      sent.world,
      editInternalMessageStep({
        expectedRevision: "1",
        policyRevision: "1",
        suffix: "winner"
      })
    );
    expect(edited.outcome, outcomeDetails(edited)).toBe("committed");
    if (edited.outcome !== "committed") return;

    const editedMessage = recordValue<
      ReturnType<typeof inboxV2ScenarioMessage>
    >(edited.world, messageEntity());
    expect(editedMessage.revision).toBe("2");
    expect(editedMessage.authorParticipant).toEqual(original.authorParticipant);
    expect(
      edited.world.outboxIntents.some(
        ({ effectClass }) => effectClass === "provider_io"
      )
    ).toBe(false);

    const stale = executeInboxV2ScenarioStep(
      edited.world,
      editInternalMessageStep({
        expectedRevision: "1",
        policyRevision: "2",
        suffix: "stale"
      })
    );
    expect(stale).toMatchObject({
      outcome: "conflict",
      errorCode: "revision.conflict"
    });
    expect(stale.world).toBe(edited.world);
  });
});

function createInternalGroupWorld(): InboxV2ScenarioWorld {
  const initial = createInboxV2ScenarioWorld({ tenantId });
  const created = executeInboxV2ScenarioStep(
    initial,
    createInternalConversationStep({
      conversationId: groupConversationId,
      kind: "internal_group",
      members: groupMembers,
      suffix: "group"
    })
  );
  if (created.outcome !== "committed") {
    throw new Error(
      `Internal group fixture failed: ${outcomeDetails(created)}`
    );
  }
  return created.world;
}

function createInternalConversationStep(input: {
  conversationId: string;
  kind: InternalConversationKind;
  members: readonly InternalMember[];
  suffix: string;
}): InboxV2ScenarioStep {
  const conversationResource = conversationEntity(input.conversationId);
  const topologyResource = inboxV2ScenarioEntity(
    tenantId,
    "core:internal-conversation-topology",
    `internal_conversation_topology:${input.suffix}`
  );
  const policyResource = inboxV2ScenarioEntity(
    tenantId,
    "core:internal-conversation-policy",
    `internal_conversation_policy:${input.suffix}`
  );
  const directoryRequirements = input.members.map((member, index) => ({
    id: `directory-${input.suffix}-${index + 1}`,
    permissionId: "core:employee.directory.view",
    resource: employeeEntity(member.employeeId),
    guard: inboxV2CanonicalScenarioGuard("none"),
    visibility: "secondary_hidden" as const
  }));
  const guard: InboxV2PolicyGuardEvidence = {
    ...inboxV2CanonicalScenarioGuard("none"),
    action: {
      kind: "internal_conversation_create",
      targetResource: conversationResource,
      conversationKind: input.kind,
      creatorEmployeeId: inboxV2EmployeeIdSchema.parse(ownerId),
      members: input.members.map((member, index) => ({
        employeeId: inboxV2EmployeeIdSchema.parse(member.employeeId),
        employeeResource: employeeEntity(member.employeeId),
        lifecycle: "active" as const,
        role: member.role,
        directoryRequirementId: directoryRequirements[index]!.id
      })),
      topologyResource,
      topologyConversationResource: conversationResource,
      topologyKind: input.kind,
      policyResource,
      policyTopologyResource: topologyResource,
      policyRevisionChecks: [{ kind: "policy", expected: "1", actual: "1" }]
    }
  };
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: ownerId,
    requirements: [
      {
        id: `create-${input.suffix}`,
        permissionId: "core:conversation.internal.create",
        resource: conversationResource,
        guard
      },
      ...directoryRequirements
    ],
    grants: [
      {
        id: `create-${input.suffix}`,
        permissionId: "core:conversation.internal.create"
      },
      {
        id: `directory-${input.suffix}`,
        permissionId: "core:employee.directory.view"
      }
    ]
  });
  const conversation = inboxV2ScenarioConversation({
    tenantId,
    id: input.conversationId,
    topology: input.kind === "internal_direct" ? "direct" : "group",
    transport: "internal"
  });
  const participants = input.members.map((member) =>
    inboxV2ScenarioParticipant({
      tenantId,
      conversationId: input.conversationId,
      id: member.participantId,
      subject: { kind: "employee", employeeId: member.employeeId }
    })
  );
  const memberships = input.members.map((member, index) => {
    const participant = participants[index]!;
    const episode = inboxV2ParticipantMembershipEpisodeSchema.parse({
      tenantId,
      id: membershipEpisodeId(member.participantId),
      participant: {
        tenantId,
        kind: "conversation_participant",
        id: participant.id
      },
      origin: { kind: "hulee_internal_command" },
      state: "active",
      role: member.role,
      evidenceClassification: "confirmed",
      validFrom: inboxV2ScenarioNow,
      validTo: null,
      revision: "1"
    });
    const transition = inboxV2ParticipantMembershipTransitionSchema.parse({
      tenantId,
      id: membershipTransitionId(member.participantId),
      episode: {
        tenantId,
        kind: "participant_membership_episode",
        id: episode.id
      },
      intent: "initial_active",
      fromState: null,
      toState: "active",
      fromRole: null,
      toRole: member.role,
      cause: {
        kind: "hulee_internal_command",
        actorEmployee: {
          tenantId,
          kind: "employee",
          id: ownerId
        }
      },
      reasonCodeId: "core:conversation-created",
      expectedRevision: null,
      currentRevision: null,
      resultingRevision: "1",
      occurredAt: inboxV2ScenarioNow
    });

    return { episode, transition };
  });
  const state: InboxV2ScenarioState = {
    tenantId,
    kind: input.kind,
    conversationId: input.conversationId,
    clientIds: [],
    participantIds: input.members.map(({ participantId }) => participantId),
    employeeAnchorIds: input.members.map(({ employeeId }) => employeeId),
    ownerEmployeeIds: input.members
      .filter(({ role }) => role === "owner")
      .map(({ employeeId }) => employeeId),
    workItemId: null,
    primaryResponsibleEmployeeId: null,
    groupBindingId: null,
    senderPrivateIdentityId: null,
    physicalMessageIds: [],
    action: "created",
    status: "active",
    revision: "1"
  };

  return baseStep(`create-${input.suffix}`, authorization, () => ({
    kind: "commit",
    changes: [
      {
        entity: conversationResource,
        expectedRevision: null,
        resultingRevision: "1",
        schemaId: INBOX_V2_CONVERSATION_SCHEMA_ID,
        schemaVersion: INBOX_V2_CONVERSATION_SCHEMA_VERSION,
        schema: inboxV2ConversationSchema,
        value: conversation,
        audience: "internal_participants"
      },
      {
        entity: participantSetEntity(input.conversationId),
        expectedRevision: null,
        resultingRevision: "1",
        schemaId: "core:inbox-v2.conversation-participant-set",
        schemaVersion: INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
        schema: inboxV2ConversationParticipantSetSchema,
        value: participants,
        audience: "internal_participants"
      },
      ...memberships.flatMap(({ episode, transition }) => [
        {
          entity: membershipEpisodeEntity(episode.id),
          expectedRevision: null,
          resultingRevision: "1" as const,
          schemaId: INBOX_V2_PARTICIPANT_MEMBERSHIP_EPISODE_SCHEMA_ID,
          schemaVersion: INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
          schema: inboxV2ParticipantMembershipEpisodeSchema,
          value: episode,
          audience: "internal_participants" as const
        },
        {
          entity: membershipTransitionEntity(transition.id),
          expectedRevision: null,
          resultingRevision: "1" as const,
          schemaId: INBOX_V2_PARTICIPANT_MEMBERSHIP_TRANSITION_SCHEMA_ID,
          schemaVersion: INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
          schema: inboxV2ParticipantMembershipTransitionSchema,
          value: transition,
          audience: "internal_participants" as const
        }
      ]),
      {
        entity: stateEntity(input.conversationId),
        expectedRevision: null,
        resultingRevision: "1",
        schemaId: inboxV2ScenarioContractIds.scenarioState,
        schema: inboxV2ScenarioStateSchema,
        value: state,
        audience: "internal_participants"
      }
    ]
  }));
}

function sendInternalStep(input: {
  employeeId: string;
  membershipRole: InternalMember["role"];
  includeMembershipFact: boolean;
  suffix: string;
}): InboxV2ScenarioStep {
  const conversationResource = conversationEntity(groupConversationId);
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: input.employeeId,
    requirements: [
      {
        id: `send-${input.suffix}`,
        permissionId: "core:message.send_internal",
        resource: conversationResource,
        guard: inboxV2InternalMembershipScenarioGuard({
          conversationId: groupConversationId,
          employeeId: input.employeeId,
          membershipRole: input.membershipRole
        }),
        scopeFacts: input.includeMembershipFact
          ? [
              internalParticipantScopeFact(
                conversationResource,
                input.employeeId,
                input.membershipRole
              )
            ]
          : []
      }
    ],
    grants: [
      {
        id: `send-${input.suffix}`,
        permissionId: "core:message.send_internal",
        scope: {
          type: "internal_participant",
          tenantId: inboxV2TenantIdSchema.parse(tenantId)
        }
      }
    ]
  });
  const content = inboxV2ScenarioContent({
    tenantId,
    id: "timeline_content:internal-group-1",
    text: "Internal group message"
  });
  const message = inboxV2ScenarioMessage({
    tenantId,
    conversationId: groupConversationId,
    id: groupMessageId,
    authorParticipantId: groupAuthorParticipantId,
    content,
    origin: "internal"
  });

  return baseStep(
    `send-${input.suffix}`,
    authorization,
    ({ requireRecord }) => {
      const currentState = requireRecord(stateEntity(groupConversationId));
      const nextState: InboxV2ScenarioState = {
        ...(currentState.value as InboxV2ScenarioState),
        physicalMessageIds: [groupMessageId],
        action: "send_internal",
        revision: "2"
      };
      return {
        kind: "commit",
        changes: [
          {
            entity: messageEntity(),
            expectedRevision: null,
            resultingRevision: "1",
            schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
            schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
            schema: inboxV2MessageSchema,
            value: message,
            audience: "internal_participants",
            timeline: {
              conversation: {
                tenantId,
                kind: "conversation",
                id: groupConversationId
              },
              timelineSequence: "1"
            }
          },
          {
            entity: stateEntity(groupConversationId),
            expectedRevision: currentState.revision,
            resultingRevision: "2",
            schemaId: inboxV2ScenarioContractIds.scenarioState,
            schema: inboxV2ScenarioStateSchema,
            value: nextState,
            audience: "internal_participants"
          }
        ],
        outboxEffects: [
          {
            typeId: "core:projection.update",
            handlerId: "core:scenario-internal-projection",
            effectClass: "projection",
            changeEntities: [messageEntity()]
          },
          {
            typeId: "core:notification.evaluate",
            handlerId: "core:scenario-internal-notification",
            effectClass: "notification",
            changeEntities: [messageEntity()]
          }
        ],
        resultEntity: messageEntity()
      };
    }
  );
}

function editInternalMessageStep(input: {
  expectedRevision: string;
  policyRevision: string;
  suffix: string;
}): InboxV2ScenarioStep {
  const conversationResource = conversationEntity(groupConversationId);
  const timelineItemResource = timelineItemEntity();
  const contentReadId = `edit-content-read-${input.suffix}`;
  const actionGuard: InboxV2PolicyGuardEvidence = {
    profileId: "core:rbac.guard.canonical_resource",
    resourceState: "active",
    contentBoundary: "none",
    routeInputFields: [],
    companionRequirementIds: [],
    action: {
      kind: "message_author_action",
      operation: "edit",
      targetResource: timelineItemResource,
      actorEmployeeId: inboxV2EmployeeIdSchema.parse(memberId),
      authorEmployeeId: inboxV2EmployeeIdSchema.parse(memberId),
      contentBoundary: "internal",
      targetRevisionChecks: [
        {
          kind: "entity",
          expected: input.policyRevision,
          actual: input.policyRevision
        }
      ],
      authorshipResource: inboxV2ScenarioEntity(
        tenantId,
        "core:message-authorship",
        "message_authorship:internal-group-1"
      ),
      authorshipTimelineItemResource: timelineItemResource,
      authorshipEmployeeResource: employeeEntity(memberId),
      authorshipRevisionChecks: [
        { kind: "relation", expected: "1", actual: "1" }
      ],
      contentTopologyResource: inboxV2ScenarioEntity(
        tenantId,
        "core:timeline-content-topology",
        "timeline_content_topology:internal-group-1"
      ),
      topologyTimelineItemResource: timelineItemResource,
      topologyConversationResource: conversationResource,
      topologyBoundary: "internal",
      topologyRevisionChecks: [{ kind: "state", expected: "1", actual: "1" }],
      contentReadRequirementIds: [contentReadId],
      deletionMode: null,
      holdProof: null,
      originalRouteRequirementId: null,
      originalSourceAccountId: null,
      originalSourceAccountResource: null,
      originalBindingResource: null,
      originalBindingSourceAccountResource: null,
      externalReferenceResource: null,
      externalReferenceBindingResource: null,
      externalReferenceTargetResource: null,
      routeRevisionChecks: [],
      capabilityId: null,
      capabilityManifestResource: null,
      capabilityManifestSourceAccountResource: null,
      capabilityRevisionChecks: [],
      capabilityState: "not_applicable",
      capabilityNotAfter: null
    }
  };
  const authorization = createInboxV2ScenarioAuthorization({
    tenantId,
    employeeId: memberId,
    requirements: [
      {
        id: `edit-${input.suffix}`,
        permissionId: "core:message.edit_own",
        resource: timelineItemResource,
        guard: actionGuard,
        scopeFacts: [
          conversationScopeFact(timelineItemResource, conversationResource)
        ]
      },
      {
        id: contentReadId,
        permissionId: "core:conversation.internal.read",
        resource: conversationResource,
        guard: inboxV2InternalMembershipScenarioGuard({
          conversationId: groupConversationId,
          employeeId: memberId,
          membershipRole: "member"
        }),
        scopeFacts: [
          internalParticipantScopeFact(conversationResource, memberId, "member")
        ],
        visibility: "secondary_hidden"
      }
    ],
    grants: [
      {
        id: `edit-${input.suffix}`,
        permissionId: "core:message.edit_own",
        scope: {
          type: "conversation",
          tenantId: inboxV2TenantIdSchema.parse(tenantId),
          id: inboxV2ConversationIdSchema.parse(groupConversationId)
        }
      },
      {
        id: contentReadId,
        permissionId: "core:conversation.internal.read",
        scope: {
          type: "internal_participant",
          tenantId: inboxV2TenantIdSchema.parse(tenantId)
        }
      }
    ]
  });
  const content = inboxV2ScenarioContent({
    tenantId,
    id: "timeline_content:internal-group-1",
    text: "Edited internal group message",
    revision: "2",
    updatedAt: inboxV2ScenarioLater
  });
  const message = inboxV2ScenarioMessage({
    tenantId,
    conversationId: groupConversationId,
    id: groupMessageId,
    authorParticipantId: groupAuthorParticipantId,
    content,
    origin: "internal",
    revision: "2",
    updatedAt: inboxV2ScenarioLater
  });

  return baseStep(`edit-${input.suffix}`, authorization, () => ({
    kind: "commit",
    changes: [
      {
        entity: messageEntity(),
        expectedRevision: input.expectedRevision,
        resultingRevision: "2",
        schemaId: INBOX_V2_MESSAGE_SCHEMA_ID,
        schemaVersion: INBOX_V2_MESSAGE_SCHEMA_VERSION,
        schema: inboxV2MessageSchema,
        value: message,
        audience: "internal_participants"
      }
    ],
    outboxEffects: [
      {
        typeId: "core:projection.update",
        handlerId: "core:scenario-internal-projection",
        effectClass: "projection",
        changeEntities: [messageEntity()]
      }
    ],
    resultEntity: messageEntity()
  }));
}

function baseStep(
  id: string,
  authorization: ReturnType<typeof createInboxV2ScenarioAuthorization>,
  transition: InboxV2ScenarioStep["transition"]
): InboxV2ScenarioStep {
  const token = id.replaceAll(/[^A-Za-z0-9]/gu, "-");
  return {
    id,
    commandId: `scenario-command:${token}`,
    requestId: `scenario-request:${token}`,
    clientMutationId: `scenario-mutation:${token}`,
    requestHash: `sha256:${"a".repeat(64)}`,
    committedAt: inboxV2ScenarioLater,
    authorization,
    transition
  };
}

function internalParticipantScopeFact(
  resource: InboxV2EntityKey,
  employeeId: string,
  role: InternalMember["role"]
): InboxV2CanonicalScopeFact {
  return {
    kind: "internal_participant",
    ...scopePath(resource, resource),
    employeeId: inboxV2EmployeeIdSchema.parse(employeeId),
    conversationId: inboxV2ConversationIdSchema.parse(groupConversationId),
    origin: "hulee_internal_command",
    state: "active",
    role,
    membershipRevision: inboxV2EntityRevisionSchema.parse("1"),
    currentMembershipRevision: inboxV2EntityRevisionSchema.parse("1"),
    validUntil: inboxV2ScenarioNotAfter
  };
}

function conversationScopeFact(
  resource: InboxV2EntityKey,
  conversationResource: InboxV2EntityKey
): InboxV2CanonicalScopeFact {
  return {
    kind: "conversation",
    ...scopePath(resource, conversationResource),
    conversationId: inboxV2ConversationIdSchema.parse(groupConversationId),
    validUntil: inboxV2ScenarioNotAfter
  };
}

function deriveInternalMembershipProjection(
  world: InboxV2ScenarioWorld,
  conversationId: string
) {
  const conversation = recordValue<
    ReturnType<typeof inboxV2ConversationSchema.parse>
  >(world, conversationEntity(conversationId));
  const participants = recordValue<
    ReturnType<typeof inboxV2ConversationParticipantSetSchema.parse>
  >(world, participantSetEntity(conversationId));
  const participantIds = new Set(
    participants.map((participant) => participant.id)
  );
  const episodes = recordsOfType(world, "core:participant-membership-episode")
    .map((record) =>
      inboxV2ParticipantMembershipEpisodeSchema.parse(record.value)
    )
    .filter((episode) => participantIds.has(episode.participant.id));
  const transitions = recordsOfType(
    world,
    "core:participant-membership-transition"
  ).map((record) =>
    inboxV2ParticipantMembershipTransitionSchema.parse(record.value)
  );
  const graphs = participants.map((participant) => {
    const participantEpisodes = episodes.filter(
      (episode) => episode.participant.id === participant.id
    );
    const episodeIds = new Set(
      participantEpisodes.map((episode) => episode.id)
    );

    return inboxV2ParticipantMembershipGraphSchema.parse({
      participant,
      episodes: participantEpisodes,
      transitions: transitions.filter((transition) =>
        episodeIds.has(transition.episode.id)
      ),
      rosterEvidence: [],
      rosterMemberEvidence: []
    });
  });
  const activeEmployeeIds = new Set<string>();
  const ownerEmployeeIds = new Set<string>();
  const roleByEmployee: Record<string, string> = {};

  for (const graph of graphs) {
    if (graph.participant.subject.kind !== "employee") {
      throw new Error("Internal membership graph must resolve to an Employee.");
    }
    const activeEpisodes = graph.episodes.filter((episode) =>
      isInboxV2ConfirmedInternalEmployeeMembership({
        episode,
        participant: graph.participant,
        conversation
      })
    );
    if (activeEpisodes.length !== 1) {
      throw new Error(
        `Expected one current membership for ${graph.participant.id}.`
      );
    }
    const employeeId = graph.participant.subject.employee.id;
    const activeEpisode = activeEpisodes[0]!;
    activeEmployeeIds.add(employeeId);
    roleByEmployee[employeeId] = activeEpisode.role;
    if (activeEpisode.role === "owner") {
      ownerEmployeeIds.add(employeeId);
    }
  }

  return {
    graphs,
    activeEmployeeIds: [...activeEmployeeIds].sort(),
    ownerEmployeeIds: [...ownerEmployeeIds].sort(),
    roleByEmployee
  };
}

function scopePath(resource: InboxV2EntityKey, scopeTarget: InboxV2EntityKey) {
  return {
    resource,
    scopeTarget,
    pathRevisionChecks: [
      { kind: "relation" as const, expected: "1", actual: "1" },
      { kind: "state" as const, expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository" as const,
      factId: `fact:${resource.entityTypeId}:${resource.entityId}`,
      loaderDecisionId: "scenario-internal-loader",
      projectionRevision: inboxV2EntityRevisionSchema.parse("1"),
      observedAt: inboxV2ScenarioNow
    }
  };
}

function recordValue<T>(
  world: InboxV2ScenarioWorld,
  entity: InboxV2EntityKey
): T {
  const record = getInboxV2ScenarioRecord(world, entity);
  if (record === null) throw new Error(`Missing ${entity.entityId}.`);
  return record.value as T;
}

function recordsOfType(world: InboxV2ScenarioWorld, entityTypeId: string) {
  return world.records.filter(
    (record) => record.entity.entityTypeId === entityTypeId
  );
}

function outcomeDetails(
  result: ReturnType<typeof executeInboxV2ScenarioStep>
): string {
  if (result.outcome === "rejected") {
    return JSON.stringify(result.authorization);
  }
  if (result.outcome === "conflict") return result.errorCode;
  return result.outcome;
}

function employeeEntity(employeeId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:employee",
    inboxV2EmployeeIdSchema.parse(employeeId)
  );
}

function conversationEntity(conversationId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:conversation",
    inboxV2ConversationIdSchema.parse(conversationId)
  );
}

function membershipEpisodeId(participantId: string) {
  return `participant_membership_episode:${participantId.split(":").at(-1)}`;
}

function membershipTransitionId(participantId: string) {
  return `participant_membership_transition:${participantId.split(":").at(-1)}-created`;
}

function membershipEpisodeEntity(episodeId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:participant-membership-episode",
    episodeId
  );
}

function membershipTransitionEntity(transitionId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:participant-membership-transition",
    transitionId
  );
}

function participantSetEntity(conversationId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:conversation-participant-set",
    `conversation_participant_set:${conversationId.split(":").at(-1)}`
  );
}

function stateEntity(conversationId: string) {
  return inboxV2ScenarioEntity(
    tenantId,
    "module:hulee-testing:scenario-state",
    `scenario_state:${conversationId.split(":").at(-1)}`
  );
}

function messageEntity() {
  return inboxV2ScenarioEntity(tenantId, "core:message", groupMessageId);
}

function timelineItemEntity() {
  return inboxV2ScenarioEntity(
    tenantId,
    "core:timeline-item",
    "timeline_item:internal-group-1"
  );
}
