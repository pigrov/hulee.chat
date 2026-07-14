import { describe, expect, it } from "vitest";

import {
  INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
  inboxV2TimelineItemEnvelopeSchema,
  inboxV2TimelineItemPageSchema,
  inboxV2TimelineItemSchema,
  inboxV2TimelineSequenceSchema,
  isInboxV2TimelineActivityEligible
} from "./timeline";
import { inboxV2TimelineSequenceAllocationSchema } from "./timeline-sequence-allocation";
import {
  fixtureConversation,
  fixtureConversationReference,
  fixtureMessageReference,
  fixtureOtherTenantId,
  fixtureReference,
  fixtureT0,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";

describe("Inbox V2 timeline contracts", () => {
  it("keeps sequence as an immutable positive bigint string", () => {
    expect(inboxV2TimelineSequenceSchema.parse("9223372036854775807")).toBe(
      "9223372036854775807"
    );
    expect(inboxV2TimelineSequenceSchema.safeParse("0").success).toBe(false);
    expect(inboxV2TimelineSequenceSchema.safeParse("01").success).toBe(false);
    expect(inboxV2TimelineSequenceSchema.safeParse(1).success).toBe(false);
  });

  it("versions a compact Message pointer without nested content history", () => {
    const item = inboxV2TimelineItemSchema.parse(fixtureTimelineItem());
    expect(item.subject).toEqual({
      kind: "message",
      message: fixtureMessageReference,
      messageRevision: "1"
    });
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...fixtureTimelineItem(),
        contentBlocks: [{ kind: "text", text: "duplicated" }]
      }).success
    ).toBe(false);
  });

  it("keeps StaffNote and work metadata outside external visibility", () => {
    const staffNote = fixtureTimelineItem("external", {
      subject: {
        kind: "staff_note",
        staffNote: fixtureReference("staff_note", "staff_note:note-1"),
        staffNoteRevision: "1"
      },
      visibility: "staff_only"
    });
    expect(inboxV2TimelineItemSchema.safeParse(staffNote).success).toBe(true);
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...staffNote,
        visibility: "conversation_external"
      }).success
    ).toBe(false);

    const workChange = fixtureTimelineItem("external", {
      subject: {
        kind: "work_change",
        transition: fixtureReference(
          "work_item_transition",
          "work_item_transition:transition-1"
        )
      },
      visibility: "workforce_metadata"
    });
    expect(inboxV2TimelineItemSchema.safeParse(workChange).success).toBe(true);
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...workChange,
        visibility: "staff_only"
      }).success
    ).toBe(false);

    const participantChange = fixtureTimelineItem("external", {
      subject: {
        kind: "participant_change",
        transition: fixtureReference(
          "participant_membership_transition",
          "participant_membership_transition:transition-1"
        )
      },
      visibility: "workforce_metadata"
    });
    expect(inboxV2TimelineItemSchema.safeParse(participantChange).success).toBe(
      true
    );
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...participantChange,
        visibility: "conversation_external"
      }).success
    ).toBe(false);
  });

  it("preserves call, review and system families instead of fake text Messages", () => {
    const source = {
      sourceObject: fixtureReference("source_object", "source_object:call-1"),
      objectKindId: "core:call",
      objectRevision: "1",
      normalizedSourceEvent: fixtureReference(
        "normalized_inbound_event",
        "normalized_inbound_event:call-1"
      )
    };
    const call = fixtureTimelineItem("external", {
      subject: {
        kind: "call",
        source,
        actorParticipant: null
      },
      visibility: "source_item_policy"
    });
    const review = fixtureTimelineItem("external", {
      id: "timeline_item:review-1",
      timelineSequence: "2",
      subject: {
        kind: "review",
        source: {
          ...source,
          sourceObject: fixtureReference(
            "source_object",
            "source_object:review-1"
          ),
          objectKindId: "core:review"
        },
        authorParticipant: fixtureReference(
          "conversation_participant",
          "conversation_participant:source-1"
        )
      },
      visibility: "source_item_policy"
    });
    const system = fixtureTimelineItem("external", {
      id: "timeline_item:system-1",
      timelineSequence: "3",
      subject: {
        kind: "system_event",
        event: fixtureReference("event", "event:system-1"),
        systemActorId: "core:timeline-system",
        appActor: null
      },
      visibility: "workforce_metadata"
    });

    expect(inboxV2TimelineItemSchema.safeParse(call).success).toBe(true);
    expect(inboxV2TimelineItemSchema.safeParse(review).success).toBe(true);
    expect(inboxV2TimelineItemSchema.safeParse(system).success).toBe(true);
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...system,
        visibility: "conversation_external"
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineItemSchema.safeParse({ ...call, text: "missed call" })
        .success
    ).toBe(false);
    expect(
      inboxV2TimelineItemSchema.safeParse({
        ...review,
        subject: { ...review.subject, kind: "message" }
      }).success
    ).toBe(false);
  });

  it("marks late history as non-activity while keeping provider time independent", () => {
    const history = inboxV2TimelineItemSchema.parse(
      fixtureTimelineItem("external", {
        activity: {
          kind: "history_import",
          sourceOccurrence: fixtureReference(
            "source_occurrence",
            "source_occurrence:history-1"
          ),
          importedAt: fixtureT2
        },
        occurredAt: "2020-01-01T00:00:00.000Z"
      })
    );
    expect(isInboxV2TimelineActivityEligible(history)).toBe(false);
    expect(history.timelineSequence).toBe("1");
    const allocation = fixtureTimelineAllocation("external", history);
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse(allocation).success
    ).toBe(true);
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse({
        ...allocation,
        conversationAfter: {
          ...allocation.conversationAfter,
          head: {
            ...allocation.conversationAfter.head,
            latestActivityItemId: history.id,
            latestActivityTimelineSequence: history.timelineSequence,
            latestActivityAt: history.occurredAt
          }
        }
      }).success
    ).toBe(false);
  });

  it("allocates a bounded contiguous range against one Conversation CAS", () => {
    const first = fixtureTimelineItem();
    const second = fixtureTimelineItem("external", {
      id: "timeline_item:item-2",
      subject: {
        kind: "message",
        message: fixtureReference("message", "message:message-2"),
        messageRevision: "1"
      },
      timelineSequence: "2"
    });
    const conversationBefore = fixtureConversation();
    const commit = {
      tenantId: fixtureTenantId,
      conversationBefore,
      items: [first, second],
      conversationAfter: fixtureConversation("external", {
        head: {
          ...conversationBefore.head,
          latestTimelineSequence: "2",
          latestActivityItemId: second.id,
          latestActivityTimelineSequence: second.timelineSequence,
          latestActivityAt: second.occurredAt,
          revision: "2",
          updatedAt: fixtureT2
        }
      }),
      committedAt: fixtureT2
    };
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse({
        ...commit,
        items: [first, { ...second, timelineSequence: "3" }]
      }).success
    ).toBe(false);
    const invalidHeadRevision = fixtureTimelineAllocation();
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse({
        ...invalidHeadRevision,
        conversationAfter: {
          ...invalidHeadRevision.conversationAfter,
          head: {
            ...invalidHeadRevision.conversationAfter.head,
            revision: "1"
          }
        }
      }).success
    ).toBe(false);
  });

  it("advances only the Conversation head revision and clock", () => {
    const allocation = inboxV2TimelineSequenceAllocationSchema.parse(
      fixtureTimelineAllocation()
    );

    expect(allocation.conversationAfter.revision).toBe(
      allocation.conversationBefore.revision
    );
    expect(allocation.conversationAfter.createdAt).toBe(
      allocation.conversationBefore.createdAt
    );
    expect(allocation.conversationAfter.updatedAt).toBe(
      allocation.conversationBefore.updatedAt
    );
    expect(BigInt(allocation.conversationAfter.head.revision)).toBe(
      BigInt(allocation.conversationBefore.head.revision) + 1n
    );
    expect(allocation.conversationAfter.head.createdAt).toBe(
      allocation.conversationBefore.head.createdAt
    );
    expect(allocation.conversationAfter.head.updatedAt).toBe(
      allocation.committedAt
    );

    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse({
        ...allocation,
        conversationAfter: {
          ...allocation.conversationAfter,
          revision: "2"
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineSequenceAllocationSchema.safeParse({
        ...allocation,
        conversationAfter: {
          ...allocation.conversationAfter,
          updatedAt: allocation.committedAt
        }
      }).success
    ).toBe(false);
  });

  it("uses stable bounded sequence pages rather than timestamp sorting", () => {
    const laterProviderTime = fixtureTimelineItem("external", {
      id: "timeline_item:item-2",
      timelineSequence: "2",
      occurredAt: fixtureT0,
      subject: {
        kind: "message",
        message: fixtureReference("message", "message:message-2"),
        messageRevision: "1"
      }
    });
    const page = {
      tenantId: fixtureTenantId,
      conversation: fixtureConversationReference,
      anchor: { kind: "latest" },
      items: [fixtureTimelineItem(), laterProviderTime],
      hasMoreBefore: false,
      hasMoreAfter: false
    };
    expect(inboxV2TimelineItemPageSchema.safeParse(page).success).toBe(true);
    expect(
      inboxV2TimelineItemPageSchema.safeParse({
        ...page,
        items: [...page.items].reverse()
      }).success
    ).toBe(false);
    expect(
      inboxV2TimelineItemPageSchema.safeParse({
        ...page,
        conversation: {
          ...fixtureConversationReference,
          tenantId: fixtureOtherTenantId
        }
      }).success
    ).toBe(false);
  });

  it("exports TimelineItem through the exact V2 envelope", () => {
    expect(
      inboxV2TimelineItemEnvelopeSchema.parse({
        schemaId: INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
        schemaVersion: "v1",
        payload: fixtureTimelineItem()
      }).payload.id
    ).toBe(fixtureTimelineItem().id);
  });
});
