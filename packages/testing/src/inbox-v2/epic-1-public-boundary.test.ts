import {
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_VERSION,
  INBOX_V2_MESSAGE_SCHEMA_ID,
  INBOX_V2_MESSAGE_SCHEMA_VERSION,
  INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
  inboxV2ConversationIdSchema,
  inboxV2ConversationParticipantSetSchema,
  inboxV2ConversationSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2MessageSchema,
  inboxV2TenantIdSchema,
  type InboxV2EntityKey
} from "@hulee/contracts";
import {
  evaluateInboxV2AuthorizationPlan,
  type InboxV2CanonicalScopeFact
} from "@hulee/core";
import {
  createInboxV2ScenarioAuthorization,
  createInboxV2ScenarioWorld,
  executeInboxV2ScenarioStep,
  getInboxV2ScenarioRecord,
  inboxV2InternalMembershipScenarioGuard,
  inboxV2ScenarioConversation,
  inboxV2ScenarioEntity,
  inboxV2ScenarioLater,
  inboxV2ScenarioMessage,
  inboxV2ScenarioNotAfter,
  inboxV2ScenarioNow,
  inboxV2ScenarioParticipant,
  snapshotInboxV2ScenarioWorld,
  type InboxV2ScenarioSeedRecord,
  type InboxV2ScenarioStep
} from "@hulee/testing";
import { describe, expect, it } from "vitest";

const tenantId = "tenant:epic-1-public-boundary";
const conversationId = "conversation:epic-1-public-boundary";
const participantId = "conversation_participant:epic-1-public-boundary";
const employeeId = "employee:operator-1";
const peerParticipantId =
  "conversation_participant:epic-1-public-boundary-peer";
const peerEmployeeId = "employee:operator-2";
const messageId = "message:epic-1-public-boundary";

describe("Inbox V2 Epic 1 public package boundary", () => {
  it("composes a canonical in-memory message flow through package-root exports", () => {
    const conversationEntity = entity("core:conversation", conversationId);
    const participantSetEntity = entity(
      "core:conversation-participant-set",
      "conversation_participant_set:epic-1-public-boundary"
    );
    const messageEntity = entity("core:message", messageId);
    const conversation = inboxV2ScenarioConversation({
      tenantId,
      id: conversationId,
      topology: "direct",
      transport: "internal"
    });
    const participant = inboxV2ScenarioParticipant({
      tenantId,
      conversationId,
      id: participantId,
      subject: { kind: "employee", employeeId }
    });
    const peerParticipant = inboxV2ScenarioParticipant({
      tenantId,
      conversationId,
      id: peerParticipantId,
      subject: { kind: "employee", employeeId: peerEmployeeId }
    });
    const initial = createInboxV2ScenarioWorld({
      tenantId,
      records: [
        seed(
          conversationEntity,
          INBOX_V2_CONVERSATION_SCHEMA_ID,
          INBOX_V2_CONVERSATION_SCHEMA_VERSION,
          inboxV2ConversationSchema,
          conversation
        ),
        seed(
          participantSetEntity,
          "core:inbox-v2.conversation-participant-set",
          INBOX_V2_PARTICIPANT_IDENTITY_SCHEMA_VERSION,
          inboxV2ConversationParticipantSetSchema,
          [participant, peerParticipant]
        )
      ]
    });
    const authorization = createInboxV2ScenarioAuthorization({
      tenantId,
      employeeId,
      requirements: [
        {
          id: "send-internal",
          permissionId: "core:message.send_internal",
          resource: conversationEntity,
          guard: inboxV2InternalMembershipScenarioGuard({
            conversationId,
            employeeId,
            membershipRole: "member"
          }),
          scopeFacts: [internalParticipantFact(conversationEntity)]
        }
      ],
      grants: [
        {
          id: "send-internal",
          permissionId: "core:message.send_internal",
          scope: {
            type: "internal_participant",
            tenantId: inboxV2TenantIdSchema.parse(tenantId)
          }
        }
      ]
    });

    expect(evaluateInboxV2AuthorizationPlan(authorization).outcome).toBe(
      "allowed"
    );

    const message = inboxV2ScenarioMessage({
      tenantId,
      conversationId,
      id: messageId,
      authorParticipantId: participantId,
      origin: "internal"
    });
    const step: InboxV2ScenarioStep = {
      id: "epic-1-public-boundary-send",
      commandId: "scenario-command:epic-1-public-boundary-send",
      requestId: "scenario-request:epic-1-public-boundary-send",
      clientMutationId: "scenario-mutation:epic-1-public-boundary-send",
      requestHash: `sha256:${"a".repeat(64)}`,
      committedAt: inboxV2ScenarioLater,
      authorization,
      transition: () => ({
        kind: "commit",
        changes: [
          {
            entity: messageEntity,
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
                id: conversationId
              },
              timelineSequence: "1"
            }
          }
        ],
        outboxEffects: [
          {
            typeId: "core:projection.update",
            handlerId: "core:epic-1-public-boundary-projection",
            effectClass: "projection",
            changeEntities: [messageEntity]
          }
        ],
        resultEntity: messageEntity
      })
    };
    const result = executeInboxV2ScenarioStep(initial, step);

    expect(result.outcome).toBe("committed");
    if (result.outcome !== "committed") return;

    expect(result.world.records).toHaveLength(3);
    expect(result.world.commits).toHaveLength(1);
    expect(result.world.events).toHaveLength(1);
    expect(result.world.outboxIntents).toHaveLength(1);
    expect(
      inboxV2MessageSchema.parse(
        getInboxV2ScenarioRecord(result.world, messageEntity)?.value
      )
    ).toMatchObject({
      id: messageId,
      conversation: { id: conversationId },
      authorParticipant: { id: participantId },
      origin: { kind: "internal" }
    });

    const snapshot = snapshotInboxV2ScenarioWorld(result.world);
    expect(snapshot).toEqual(result.world);
    expect(snapshot).not.toBe(result.world);
  });
});

function entity(entityTypeId: string, entityId: string): InboxV2EntityKey {
  return inboxV2ScenarioEntity(tenantId, entityTypeId, entityId);
}

function seed<T>(
  entityKey: InboxV2EntityKey,
  schemaId: string,
  schemaVersion: string,
  schema: InboxV2ScenarioSeedRecord<T>["schema"],
  value: T
): InboxV2ScenarioSeedRecord<T> {
  return {
    entity: entityKey,
    revision: "1",
    schemaId,
    schemaVersion,
    schema,
    value
  };
}

function internalParticipantFact(
  resource: InboxV2EntityKey
): InboxV2CanonicalScopeFact {
  return {
    kind: "internal_participant",
    resource,
    scopeTarget: resource,
    pathRevisionChecks: [
      { kind: "relation", expected: "1", actual: "1" },
      { kind: "state", expected: "1", actual: "1" }
    ],
    authorityProvenance: {
      kind: "hulee_canonical_repository",
      factId: "fact:epic-1-public-boundary-membership",
      loaderDecisionId: "epic-1-public-boundary-loader",
      projectionRevision: inboxV2EntityRevisionSchema.parse("1"),
      observedAt: inboxV2ScenarioNow
    },
    employeeId: inboxV2EmployeeIdSchema.parse(employeeId),
    conversationId: inboxV2ConversationIdSchema.parse(conversationId),
    origin: "hulee_internal_command",
    state: "active",
    role: "member",
    membershipRevision: inboxV2EntityRevisionSchema.parse("1"),
    currentMembershipRevision: inboxV2EntityRevisionSchema.parse("1"),
    validUntil: inboxV2ScenarioNotAfter
  };
}
