import { describe, expect, it } from "vitest";

import {
  fixtureReference,
  fixtureT0,
  fixtureT1,
  fixtureT2,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem
} from "./timeline-message-fixtures.type-fixture";
import {
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
  INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
  inboxV2ConversationSystemEventPayloadSchema,
  inboxV2SystemEventTimelineCreationCommitSchema
} from "./timeline-system-event-commit";

function systemEventCommit() {
  const event = fixtureReference("event", "event:timeline-system-1");
  const item = fixtureTimelineItem("external", {
    subject: {
      kind: "system_event" as const,
      event,
      systemActorId: "core:timeline-system",
      appActor: {
        kind: "trusted_service" as const,
        trustedServiceId: "core:timeline-runtime"
      }
    },
    visibility: "workforce_metadata" as const,
    activity: {
      kind: "non_activity" as const,
      reasonId: "core:system-metadata"
    },
    occurredAt: fixtureT1,
    receivedAt: fixtureT2
  });
  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external", item),
    source: {
      event,
      eventTypeId: "core:conversation.system_fact",
      eventVersion: "v1",
      conversation: item.conversation,
      payloadDigest: `sha256:${"a".repeat(64)}`,
      occurredAt: fixtureT1,
      recordedAt: fixtureT2
    }
  };
}

describe("Inbox V2 system-event Timeline creation contract", () => {
  it("binds one typed workforce item to exact owning-event clocks", () => {
    const parsed =
      inboxV2SystemEventTimelineCreationCommitSchema.parse(systemEventCommit());

    expect(parsed.timelineAllocation.items[0]).toMatchObject({
      timelineSequence: "1",
      visibility: "workforce_metadata",
      occurredAt: fixtureT1,
      receivedAt: fixtureT2,
      subject: { kind: "system_event" }
    });
  });

  it("rejects an unowned actor, mismatched event and rewritten clocks", () => {
    const base = systemEventCommit();
    const item = base.timelineAllocation.items[0]!;

    for (const mutatedItem of [
      {
        ...item,
        subject: { ...item.subject, appActor: null }
      },
      {
        ...item,
        subject: {
          ...item.subject,
          event: fixtureReference("event", "event:other")
        }
      },
      { ...item, occurredAt: fixtureT0 }
    ]) {
      expect(
        inboxV2SystemEventTimelineCreationCommitSchema.safeParse({
          ...base,
          timelineAllocation: {
            ...base.timelineAllocation,
            items: [mutatedItem],
            conversationAfter: {
              ...base.timelineAllocation.conversationAfter,
              head: {
                ...base.timelineAllocation.conversationAfter.head,
                latestActivityAt:
                  mutatedItem.activity.kind === "eligible"
                    ? mutatedItem.occurredAt
                    : base.timelineAllocation.conversationAfter.head
                        .latestActivityAt
              }
            }
          }
        }).success
      ).toBe(false);
    }
  });

  it("requires a target-bound payload contract and keeps generic system facts non-activity", () => {
    const base = systemEventCommit();
    const item = base.timelineAllocation.items[0]!;

    expect(
      inboxV2ConversationSystemEventPayloadSchema.safeParse({
        schemaId: INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID,
        schemaVersion:
          INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION,
        conversation: item.conversation,
        recordedAt: fixtureT2,
        fact: { kind: "fixture" }
      }).success
    ).toBe(true);
    expect(
      inboxV2SystemEventTimelineCreationCommitSchema.safeParse({
        ...base,
        timelineAllocation: {
          ...base.timelineAllocation,
          items: [
            {
              ...item,
              activity: { kind: "eligible" }
            }
          ],
          conversationAfter: {
            ...base.timelineAllocation.conversationAfter,
            head: {
              ...base.timelineAllocation.conversationAfter.head,
              latestActivityItemId: item.id,
              latestActivityTimelineSequence: item.timelineSequence,
              latestActivityAt: item.occurredAt
            }
          }
        }
      }).success
    ).toBe(false);
  });
});
