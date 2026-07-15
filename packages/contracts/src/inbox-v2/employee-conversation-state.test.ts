import { describe, expect, it } from "vitest";

import {
  compareInboxV2EmployeeReadSequence,
  inboxV2EmployeeConversationNotificationLevelSchema,
  inboxV2EmployeeConversationStateEnvelopeSchema,
  inboxV2EmployeeConversationStateSchema
} from "./employee-conversation-state";
import { INBOX_V2_INITIAL_SCHEMA_VERSION } from "./schema-version";

const createdAt = "2026-07-15T08:00:00.000Z";
const updatedAt = "2026-07-15T08:05:00.000Z";

function state(
  overrides: Readonly<Record<string, unknown>> = {}
): Record<string, unknown> {
  return {
    tenantId: "tenant:state-test",
    employee: {
      tenantId: "tenant:state-test",
      kind: "employee",
      id: "employee:state-test"
    },
    conversation: {
      tenantId: "tenant:state-test",
      kind: "conversation",
      id: "conversation:state-test"
    },
    lastReadSequence: "12",
    lastReadAt: updatedAt,
    manualUnread: true,
    manualUnreadChangedAt: updatedAt,
    muted: false,
    muteChangedAt: createdAt,
    notificationLevel: "mentions_only",
    notificationLevelChangedAt: updatedAt,
    pinned: true,
    pinChangedAt: updatedAt,
    archived: false,
    archiveChangedAt: createdAt,
    revision: "3",
    createdAt,
    updatedAt,
    ...overrides
  };
}

describe("Inbox V2 EmployeeConversationState contract", () => {
  it("parses per-employee read and notification state and its envelope", () => {
    const parsed = inboxV2EmployeeConversationStateSchema.parse(state());

    expect(parsed.lastReadSequence).toBe("12");
    expect(parsed.manualUnread).toBe(true);
    expect(parsed.notificationLevel).toBe("mentions_only");
    expect(parsed.revision).toBe("3");

    expect(
      inboxV2EmployeeConversationStateEnvelopeSchema.parse({
        schemaId: "core:inbox-v2.employee-conversation-state",
        schemaVersion: INBOX_V2_INITIAL_SCHEMA_VERSION,
        payload: state()
      }).payload
    ).toEqual(parsed);
  });

  it("keeps the notification vocabulary closed", () => {
    expect(inboxV2EmployeeConversationNotificationLevelSchema.options).toEqual([
      "inherit",
      "all",
      "mentions_only",
      "none"
    ]);
    expect(
      inboxV2EmployeeConversationNotificationLevelSchema.safeParse("urgent")
        .success
    ).toBe(false);
  });

  it("requires employee and Conversation references from the same tenant", () => {
    expect(
      inboxV2EmployeeConversationStateSchema.safeParse(
        state({
          employee: {
            tenantId: "tenant:other",
            kind: "employee",
            id: "employee:state-test"
          }
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2EmployeeConversationStateSchema.safeParse(
        state({
          conversation: {
            tenantId: "tenant:other",
            kind: "conversation",
            id: "conversation:state-test"
          }
        })
      ).success
    ).toBe(false);
  });

  it("pairs a positive read cursor with lastReadAt and keeps zero empty", () => {
    expect(
      inboxV2EmployeeConversationStateSchema.safeParse(
        state({ lastReadSequence: "12", lastReadAt: null })
      ).success
    ).toBe(false);
    expect(
      inboxV2EmployeeConversationStateSchema.safeParse(
        state({ lastReadSequence: "0", lastReadAt: updatedAt })
      ).success
    ).toBe(false);
    expect(
      inboxV2EmployeeConversationStateSchema.safeParse(
        state({ lastReadSequence: "0", lastReadAt: null })
      ).success
    ).toBe(true);
  });

  it("bounds all personal state timestamps by createdAt and updatedAt", () => {
    for (const field of [
      "lastReadAt",
      "manualUnreadChangedAt",
      "muteChangedAt",
      "notificationLevelChangedAt",
      "pinChangedAt",
      "archiveChangedAt"
    ]) {
      expect(
        inboxV2EmployeeConversationStateSchema.safeParse(
          state({ [field]: "2026-07-15T08:06:00.000Z" })
        ).success,
        field
      ).toBe(false);
    }
  });

  it("rejects shared Conversation and provider receipt fields", () => {
    for (const [field, value] of [
      ["providerReadAt", updatedAt],
      ["providerReceiptId", "provider_receipt_observation:test"],
      ["conversationLifecycle", "ended"],
      ["draft", { text: "private" }]
    ] as const) {
      expect(
        inboxV2EmployeeConversationStateSchema.safeParse(
          state({ [field]: value })
        ).success,
        field
      ).toBe(false);
    }
  });

  it("compares lossless decimal read sequences", () => {
    const parsed = inboxV2EmployeeConversationStateSchema.parse(state());
    const lower = inboxV2EmployeeConversationStateSchema.parse(
      state({ lastReadSequence: "8" })
    );

    expect(
      compareInboxV2EmployeeReadSequence(
        parsed.lastReadSequence,
        lower.lastReadSequence
      )
    ).toBe(1);
    expect(
      compareInboxV2EmployeeReadSequence(
        parsed.lastReadSequence,
        parsed.lastReadSequence
      )
    ).toBe(0);
  });
});
