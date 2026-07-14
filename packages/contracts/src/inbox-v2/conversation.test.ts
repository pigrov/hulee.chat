import { describe, expect, it } from "vitest";

import {
  INBOX_V2_CONVERSATION_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SCHEMA_VERSION,
  INBOX_V2_CORE_CONVERSATION_PURPOSE_IDS,
  inboxV2ConversationEnvelopeSchema,
  inboxV2ConversationLifecycleSchema,
  inboxV2ConversationLifecycleTransitionSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ConversationSchema,
  inboxV2ConversationSequenceHeadSchema,
  inboxV2EntityRevisionSchema
} from "../index";

const baseConversation = {
  tenantId: "tenant:tenant-1",
  id: "conversation:conversation-1",
  topology: "direct",
  transport: "internal",
  purposeId: "core:chat",
  lifecycle: "active",
  head: {
    latestTimelineSequence: "0",
    latestActivityItemId: null,
    latestActivityTimelineSequence: null,
    latestActivityAt: null,
    revision: "1",
    createdAt: "2026-07-11T09:00:00.000Z",
    updatedAt: "2026-07-11T09:00:00.000Z"
  },
  revision: "1",
  createdAt: "2026-07-11T09:00:00.000Z",
  updatedAt: "2026-07-11T09:00:00.000Z"
} as const;

const requiredConversationFields = Object.keys(baseConversation);

function conversationWith(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...baseConversation, ...overrides };
}

describe("Inbox V2 Conversation contract", () => {
  it.each([
    ["internal", "direct"],
    ["internal", "group"],
    ["external", "direct"],
    ["external", "group"]
  ] as const)(
    "accepts a clientless %s/%s conversation without operational or provider state",
    (transport, topology) => {
      const result = inboxV2ConversationSchema.parse(
        conversationWith({ transport, topology })
      );

      expect(result).toMatchObject({ transport, topology });
      expect(Object.keys(result).sort()).toEqual(
        [
          "createdAt",
          "head",
          "id",
          "lifecycle",
          "purposeId",
          "revision",
          "tenantId",
          "topology",
          "transport",
          "updatedAt"
        ].sort()
      );
    }
  );

  it.each([
    ["internal", "case", "core:support"],
    ["external", "case", "core:support"],
    ["internal", "object", "core:service"],
    ["external", "object", "core:service"]
  ] as const)(
    "keeps %s transport orthogonal to %s topology with %s purpose",
    (transport, topology, purposeId) => {
      expect(
        inboxV2ConversationSchema.safeParse(
          conversationWith({ transport, topology, purposeId })
        ).success
      ).toBe(true);
    }
  );

  it("keeps purpose extensible through namespaced catalog IDs", () => {
    expect(INBOX_V2_CORE_CONVERSATION_PURPOSE_IDS).toEqual({
      chat: "core:chat",
      support: "core:support",
      service: "core:service"
    });

    for (const purposeId of [
      "core:chat",
      "core:support",
      "core:service",
      "core:future-purpose",
      "module:helpdesk:customer-care"
    ]) {
      expect(
        inboxV2ConversationPurposeIdSchema.safeParse(purposeId).success
      ).toBe(true);
    }

    for (const purposeId of [
      "chat",
      "intake",
      "telegram:chat",
      "module:core:chat"
    ]) {
      expect(
        inboxV2ConversationPurposeIdSchema.safeParse(purposeId).success
      ).toBe(false);
    }
  });

  it("keeps lifecycle closed to shared communication continuity", () => {
    expect(inboxV2ConversationLifecycleSchema.parse("active")).toBe("active");
    expect(inboxV2ConversationLifecycleSchema.parse("ended")).toBe("ended");

    for (const lifecycle of [
      "open",
      "closed",
      "resolved",
      "archived",
      "hidden",
      "intake"
    ]) {
      expect(
        inboxV2ConversationLifecycleSchema.safeParse(lifecycle).success
      ).toBe(false);
    }
  });

  it("requires explicit, single-revision end and reactivation transitions", () => {
    expect(
      inboxV2ConversationLifecycleTransitionSchema.parse({
        intent: "end",
        fromLifecycle: "active",
        toLifecycle: "ended",
        expectedRevision: "1",
        resultingRevision: "2"
      })
    ).toMatchObject({ intent: "end", resultingRevision: "2" });
    expect(
      inboxV2ConversationLifecycleTransitionSchema.parse({
        intent: "reactivate",
        fromLifecycle: "ended",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "3"
      })
    ).toMatchObject({ intent: "reactivate", resultingRevision: "3" });

    for (const invalidTransition of [
      {
        intent: "end",
        fromLifecycle: "ended",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "3"
      },
      {
        intent: "reactivate",
        fromLifecycle: "ended",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "2"
      },
      {
        intent: "reactivate",
        fromLifecycle: "ended",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "4"
      },
      {
        intent: "reactivate",
        fromLifecycle: "active",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "3"
      },
      {
        fromLifecycle: "ended",
        toLifecycle: "active",
        expectedRevision: "2",
        resultingRevision: "3"
      }
    ]) {
      expect(
        inboxV2ConversationLifecycleTransitionSchema.safeParse(
          invalidTransition
        ).success
      ).toBe(false);
    }
  });

  it.each([
    ["topology", "client_direct"],
    ["topology", "client_group"],
    ["topology", "internal_direct"],
    ["topology", "internal_group"],
    ["topology", "support_case"],
    ["topology", "intake"],
    ["transport", "provider"],
    ["transport", "telegram"],
    ["transport", "local"]
  ])("rejects overloaded or unknown %s value %s", (field, value) => {
    expect(
      inboxV2ConversationSchema.safeParse(conversationWith({ [field]: value }))
        .success
    ).toBe(false);
  });

  it.each([
    ["clientId", "client:client-1"],
    ["clientIds", ["client:client-1"]],
    ["primaryClientId", "client:client-1"],
    ["clientStageId", "client_stage:stage-1"],
    ["clientOwnerId", "employee:employee-1"],
    ["workItemId", "work_item:item-1"],
    ["queueId", "work_queue:queue-1"],
    ["currentQueueId", "work_queue:queue-1"],
    ["assigneeId", "employee:employee-1"],
    ["assignedEmployeeId", "employee:employee-1"],
    ["assignedTeamId", "team:team-1"],
    ["responsibleEmployeeId", "employee:employee-1"],
    ["priority", "urgent"],
    ["sla", { dueAt: "2026-07-11T10:00:00.000Z" }],
    ["participantEmployeeIds", ["employee:employee-1"]],
    ["provider", "telegram"],
    ["channelType", "telegram_qr_bridge"],
    ["sourceConnectionId", "source_connection:connection-1"],
    ["sourceAccountId", "source_account:account-1"],
    ["externalThreadId", "external_thread:thread-1"],
    ["sourceThreadBindingId", "source_thread_binding:binding-1"],
    ["route", { accountId: "account-1" }],
    ["capabilities", ["send_text"]],
    ["status", "open"],
    ["archivedAt", "2026-07-11T10:00:00.000Z"],
    ["archived", true],
    ["hiddenAt", "2026-07-11T10:00:00.000Z"],
    ["hidden", true],
    ["muted", true],
    ["pinned", true],
    ["lastReadSequence", "0"],
    ["manualUnread", true],
    ["draft", "not canonical Conversation state"]
  ])("rejects foreign ownership field %s", (field, value) => {
    expect(
      inboxV2ConversationSchema.safeParse(conversationWith({ [field]: value }))
        .success
    ).toBe(false);
  });

  it.each(requiredConversationFields)(
    "requires canonical field %s",
    (field) => {
      const input = conversationWith();
      delete input[field];

      expect(inboxV2ConversationSchema.safeParse(input).success).toBe(false);
    }
  );

  it("requires correctly typed tenant and entity IDs", () => {
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ tenantId: "employee:employee-1" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ id: "client:client-1" })
      ).success
    ).toBe(false);
  });

  it("encodes sequence heads and revisions as bounded canonical bigint strings", () => {
    expect(inboxV2ConversationSequenceHeadSchema.parse("0")).toBe("0");
    expect(
      inboxV2ConversationSequenceHeadSchema.parse("9223372036854775807")
    ).toBe("9223372036854775807");
    expect(inboxV2EntityRevisionSchema.parse("1")).toBe("1");
    expect(inboxV2EntityRevisionSchema.parse("9223372036854775807")).toBe(
      "9223372036854775807"
    );

    for (const value of [
      0,
      1,
      1n,
      -1,
      "",
      "-1",
      "+1",
      "00",
      "01",
      "1.0",
      "1e3",
      " 1",
      "1 ",
      "9223372036854775808"
    ]) {
      expect(
        inboxV2ConversationSequenceHeadSchema.safeParse(value).success
      ).toBe(false);
    }

    for (const value of [
      0,
      1,
      1n,
      -1,
      "",
      "0",
      "-1",
      "+1",
      "01",
      "1.0",
      "1e3",
      " 1",
      "1 ",
      "9223372036854775808"
    ]) {
      expect(inboxV2EntityRevisionSchema.safeParse(value).success).toBe(false);
    }
  });

  it("requires a populated activity head to reference a positive timeline sequence", () => {
    const activityHead = {
      ...baseConversation.head,
      latestActivityItemId: "timeline_item:activity-1",
      latestActivityTimelineSequence: "0",
      latestActivityAt: "2026-07-11T09:00:00.000Z"
    };

    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ head: activityHead })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({
          head: {
            ...activityHead,
            latestTimelineSequence: "1",
            latestActivityTimelineSequence: "1"
          }
        })
      ).success
    ).toBe(true);
  });

  it("keeps Conversation entity and timeline head revisions and clocks independent", () => {
    const result = inboxV2ConversationSchema.parse(
      conversationWith({
        revision: "7",
        updatedAt: "2026-07-11T09:01:00.000Z",
        head: {
          ...baseConversation.head,
          revision: "12",
          updatedAt: "2026-07-11T09:02:00.000Z"
        }
      })
    );

    expect(result.revision).toBe("7");
    expect(result.updatedAt).toBe("2026-07-11T09:01:00.000Z");
    expect(result.head.revision).toBe("12");
    expect(result.head.updatedAt).toBe("2026-07-11T09:02:00.000Z");
  });

  it("rejects entity or head timestamps that move their own clock backwards", () => {
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ updatedAt: "2026-07-11T08:59:59.999Z" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ createdAt: "not-a-date" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ createdAt: "2026-07-11T09:00:00.000" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({ createdAt: "2026-07-11T09:00:00.0001Z" })
      ).success
    ).toBe(false);
    expect(
      inboxV2ConversationSchema.safeParse(
        conversationWith({
          head: {
            ...baseConversation.head,
            updatedAt: "2026-07-11T08:59:59.999Z"
          }
        })
      ).success
    ).toBe(false);
  });

  it("binds the exact Conversation schema ID and version", () => {
    const envelope = {
      schemaId: INBOX_V2_CONVERSATION_SCHEMA_ID,
      schemaVersion: INBOX_V2_CONVERSATION_SCHEMA_VERSION,
      payload: baseConversation
    } as const;

    expect(inboxV2ConversationEnvelopeSchema.parse(envelope)).toEqual(envelope);

    for (const invalidEnvelope of [
      { ...envelope, schemaId: "core:inbox-v2.other" },
      { ...envelope, schemaVersion: "v2" },
      { ...envelope, extra: true },
      { ...envelope, payload: { ...baseConversation, extra: true } }
    ]) {
      expect(
        inboxV2ConversationEnvelopeSchema.safeParse(invalidEnvelope).success
      ).toBe(false);
    }
  });
});
