import { describe, expect, it } from "vitest";

import {
  calculateInboxV2MessageContentDigest,
  inboxV2TimelineContentHeadOf
} from "./message-content";
import {
  inboxV2StaffNoteCreationCommitSchema,
  inboxV2StaffNoteMutationCommitSchema,
  inboxV2StaffNoteRevisionPageSchema
} from "./staff-note";
import {
  fixtureContent,
  fixtureEmployeeActor,
  fixtureParticipant,
  fixtureReference,
  fixtureT0,
  fixtureT2,
  fixtureT3,
  fixtureTenantId,
  fixtureTimelineAllocation,
  fixtureTimelineItem,
  fixtureTimelineItemReference
} from "./timeline-message-fixtures.type-fixture";

function staffNoteCreation() {
  const content = fixtureContent();
  const timelineItem = fixtureTimelineItem("external", {
    subject: {
      kind: "staff_note" as const,
      staffNote: fixtureReference("staff_note", "staff_note:note-1"),
      staffNoteRevision: "1"
    },
    visibility: "staff_only" as const
  });
  const authorParticipant = fixtureParticipant("employee");
  const staffNote = {
    tenantId: fixtureTenantId,
    id: "staff_note:note-1",
    conversation: fixtureReference(
      "conversation",
      "conversation:conversation-1"
    ),
    timelineItem: fixtureTimelineItemReference,
    authorParticipant: fixtureReference(
      "conversation_participant",
      "conversation_participant:employee-1"
    ),
    appActor: fixtureEmployeeActor,
    automationCausation: null,
    content: inboxV2TimelineContentHeadOf(content as never),
    revision: "1",
    createdAt: fixtureT2,
    updatedAt: fixtureT2
  };
  const initialRevision = {
    tenantId: fixtureTenantId,
    id: "staff_note_revision:revision-1",
    staffNote: fixtureReference("staff_note", "staff_note:note-1"),
    timelineItem: fixtureTimelineItemReference,
    expectedPreviousRevision: null,
    staffNoteRevision: "1",
    change: { kind: "created" as const, content: staffNote.content },
    actionAttribution: {
      actionParticipant: staffNote.authorParticipant,
      appActor: fixtureEmployeeActor,
      automationCausation: null
    },
    occurredAt: timelineItem.occurredAt,
    recordedAt: fixtureT2,
    recordRevision: "1" as const,
    createdAt: fixtureT2
  };
  return {
    tenantId: fixtureTenantId,
    timelineAllocation: fixtureTimelineAllocation("external", timelineItem),
    authorParticipant,
    content,
    initialRevision,
    staffNote
  };
}

function automationCausation(causedAt = fixtureT2) {
  return {
    kind: "system_event" as const,
    causeEvent: fixtureReference("event", "event:staff-note-action-1"),
    correlationId: "correlation:staff-note-action-1",
    causedAt
  };
}

function availableAttachmentContent(state: "pending" | "ready") {
  const attachment = fixtureReference(
    "message_attachment",
    "message_attachment:image-1"
  );
  const blocks = [
    {
      blockKey: "image-1",
      kind: "image" as const,
      attachment:
        state === "pending"
          ? { state, attachment }
          : {
              state,
              attachment,
              file: fixtureReference("file", "file:image-1"),
              fileRevision: "1",
              fileVersion: fixtureReference(
                "file_version",
                "file_version:image-1-v1"
              ),
              objectVersion: fixtureReference(
                "file_object_version",
                "file_object_version:image-1-v1"
              )
            },
      displayName: "photo.jpg"
    }
  ];
  return fixtureContent({
    state: {
      kind: "available" as const,
      blocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(blocks)
    },
    revision: state === "pending" ? "1" : "2",
    updatedAt: state === "pending" ? fixtureT2 : fixtureT3
  });
}

function mutation(
  changeKind:
    | "edited"
    | "attachment_materialized"
    | "privacy_erasure_tombstone"
    | "retention_purge_tombstone" = "edited"
) {
  const creation = staffNoteCreation();
  let beforeContent = creation.content;
  const editedBlocks = [
    {
      blockKey: "body-1",
      kind: "text" as const,
      role: "body" as const,
      text: "Edited note",
      language: "en"
    }
  ];
  let afterContent = fixtureContent({
    state: {
      kind: "available" as const,
      blocks: editedBlocks,
      contentDigestSha256: calculateInboxV2MessageContentDigest(editedBlocks)
    },
    revision: "2",
    updatedAt: fixtureT3
  });
  let transitionKind:
    | "edit"
    | "attachment_materialization"
    | "privacy_erasure"
    | "retention_purge" = "edit";
  let transitionEvent = fixtureReference("event", "event:edit-1");
  if (changeKind === "attachment_materialized") {
    beforeContent = availableAttachmentContent("pending");
    afterContent = availableAttachmentContent("ready");
    transitionKind = "attachment_materialization";
    transitionEvent = fixtureReference(
      "event",
      "event:attachment-materialization-1"
    );
  } else if (changeKind === "privacy_erasure_tombstone") {
    const event = fixtureReference("event", "event:privacy-erasure-1");
    afterContent = fixtureContent({
      state: {
        kind: "privacy_erased" as const,
        tombstoneEvent: event,
        reasonId: "core:approved-erasure",
        erasedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    transitionKind = "privacy_erasure";
    transitionEvent = event;
  } else if (changeKind === "retention_purge_tombstone") {
    const event = fixtureReference("event", "event:retention-purge-1");
    afterContent = fixtureContent({
      state: {
        kind: "retention_purged" as const,
        tombstoneEvent: event,
        policyId: "core:staff-note-content-retention",
        policyVersion: "v1",
        policyRevision: "3",
        purgedAt: fixtureT3
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    transitionKind = "retention_purge";
    transitionEvent = event;
  }
  const beforeStaffNote = {
    ...creation.staffNote,
    content: inboxV2TimelineContentHeadOf(beforeContent as never)
  };
  const afterStaffNote = {
    ...beforeStaffNote,
    content: inboxV2TimelineContentHeadOf(afterContent as never),
    revision: "2",
    updatedAt: fixtureT3
  };
  const beforeTimelineItem = creation.timelineAllocation.items[0];
  const afterTimelineItem = {
    ...beforeTimelineItem,
    subject: {
      kind: "staff_note" as const,
      staffNote: fixtureReference("staff_note", "staff_note:note-1"),
      staffNoteRevision: "2"
    },
    revision: "2",
    updatedAt: fixtureT3
  };
  const trusted = changeKind !== "edited";
  const appActor = trusted
    ? ({
        kind: "trusted_service" as const,
        trustedServiceId: "core:content-lifecycle"
      } as const)
    : fixtureEmployeeActor;
  const actionParticipant = trusted
    ? null
    : fixtureReference(
        "conversation_participant",
        "conversation_participant:employee-1"
      );
  const revision = {
    tenantId: fixtureTenantId,
    id: "staff_note_revision:revision-2",
    staffNote: fixtureReference("staff_note", "staff_note:note-1"),
    timelineItem: fixtureTimelineItemReference,
    expectedPreviousRevision: "1",
    staffNoteRevision: "2",
    change: {
      kind: changeKind,
      beforeContent: beforeStaffNote.content,
      afterContent: afterStaffNote.content
    },
    actionAttribution: {
      actionParticipant,
      appActor,
      automationCausation: trusted ? automationCausation() : null
    },
    occurredAt: fixtureT3,
    recordedAt: fixtureT3,
    recordRevision: "1" as const,
    createdAt: fixtureT3
  };
  return {
    tenantId: fixtureTenantId,
    beforeStaffNote,
    beforeTimelineItem,
    authorParticipantSnapshot: creation.authorParticipant,
    actionParticipantSnapshot: trusted ? null : creation.authorParticipant,
    contentTransition: {
      tenantId: fixtureTenantId,
      before: beforeContent,
      transition: {
        kind: transitionKind,
        expectedRevision: "1",
        resultingRevision: "2",
        event: transitionEvent,
        occurredAt: fixtureT3
      },
      after: afterContent
    },
    revision,
    afterStaffNote,
    afterTimelineItem
  };
}

describe("Inbox V2 StaffNote lifecycle contracts", () => {
  it("fails closed before persisting a StaffNote pending attachment", () => {
    const base = staffNoteCreation();
    const withContent = (content: ReturnType<typeof fixtureContent>) => ({
      ...base,
      content,
      staffNote: {
        ...base.staffNote,
        content: inboxV2TimelineContentHeadOf(content as never)
      },
      initialRevision: {
        ...base.initialRevision,
        change: {
          kind: "created" as const,
          content: inboxV2TimelineContentHeadOf(content as never)
        }
      }
    });
    const pending = availableAttachmentContent("pending");
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse(withContent(pending))
        .success
    ).toBe(false);

    const readyFixture = availableAttachmentContent("ready");
    const ready = fixtureContent({
      state: readyFixture.state,
      revision: "1",
      updatedAt: fixtureT2
    });
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse(withContent(ready)).success
    ).toBe(true);
  });

  it("creates exactly one eligible staff-only Timeline item with bounded author proof", () => {
    const commit = staffNoteCreation();
    expect(inboxV2StaffNoteCreationCommitSchema.safeParse(commit).success).toBe(
      true
    );

    const extraItem = fixtureTimelineItem("external", {
      id: "timeline_item:item-2",
      timelineSequence: "2",
      subject: {
        kind: "staff_note",
        staffNote: fixtureReference("staff_note", "staff_note:note-2"),
        staffNoteRevision: "1"
      },
      visibility: "staff_only"
    });
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        ...commit,
        timelineAllocation: {
          ...commit.timelineAllocation,
          items: [commit.timelineAllocation.items[0], extraItem],
          conversationAfter: {
            ...commit.timelineAllocation.conversationAfter,
            head: {
              ...commit.timelineAllocation.conversationAfter.head,
              latestTimelineSequence: "2"
            }
          }
        }
      }).success
    ).toBe(false);

    for (const activity of [
      {
        kind: "history_import",
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          "source_occurrence:history-1"
        ),
        importedAt: fixtureT2
      },
      {
        kind: "migration",
        provenanceId: "core:legacy-staff-note",
        importedAt: fixtureT2
      },
      { kind: "non_activity", reasonId: "core:source-native-note" }
    ]) {
      const item = { ...commit.timelineAllocation.items[0], activity };
      expect(
        inboxV2StaffNoteCreationCommitSchema.safeParse({
          ...commit,
          timelineAllocation: {
            ...commit.timelineAllocation,
            items: [item]
          }
        }).success
      ).toBe(false);
    }

    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        ...commit,
        authorParticipant: {
          ...commit.authorParticipant,
          conversation: fixtureReference(
            "conversation",
            "conversation:other-conversation"
          )
        }
      }).success
    ).toBe(false);
  });

  it("rejects future occurrence, author and automation causation timestamps", () => {
    const commit = staffNoteCreation();
    const futureItem = {
      ...commit.timelineAllocation.items[0],
      occurredAt: fixtureT3
    };
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        ...commit,
        timelineAllocation: {
          ...commit.timelineAllocation,
          items: [futureItem]
        },
        initialRevision: {
          ...commit.initialRevision,
          occurredAt: fixtureT3
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        ...commit,
        authorParticipant: {
          ...commit.authorParticipant,
          createdAt: fixtureT2
        }
      }).success
    ).toBe(false);

    const botParticipant = fixtureParticipant("bot");
    const causation = automationCausation(fixtureT0);
    const botActor = {
      kind: "trusted_service" as const,
      trustedServiceId: "core:staff-note-bot"
    };
    const botCommit = {
      ...commit,
      authorParticipant: botParticipant,
      staffNote: {
        ...commit.staffNote,
        authorParticipant: fixtureReference(
          "conversation_participant",
          "conversation_participant:bot-1"
        ),
        appActor: botActor,
        automationCausation: causation
      },
      initialRevision: {
        ...commit.initialRevision,
        actionAttribution: {
          actionParticipant: fixtureReference(
            "conversation_participant",
            "conversation_participant:bot-1"
          ),
          appActor: botActor,
          automationCausation: causation
        }
      }
    };
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse(botCommit).success
    ).toBe(true);
    const futureCausation = automationCausation(fixtureT3);
    expect(
      inboxV2StaffNoteCreationCommitSchema.safeParse({
        ...botCommit,
        staffNote: {
          ...botCommit.staffNote,
          automationCausation: futureCausation
        },
        initialRevision: {
          ...botCommit.initialRevision,
          actionAttribution: {
            ...botCommit.initialRevision.actionAttribution,
            automationCausation: futureCausation
          }
        }
      }).success
    ).toBe(false);
  });

  it("edits through exact StaffNote, TimelineItem and content CAS", () => {
    const commit = mutation("edited");
    expect(inboxV2StaffNoteMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        afterStaffNote: {
          ...commit.afterStaffNote,
          authorParticipant: fixtureReference(
            "conversation_participant",
            "conversation_participant:employee-2"
          )
        }
      }).success
    ).toBe(false);
    const sourceBlocks = [
      {
        blockKey: "unsupported-1",
        kind: "unsupported_source_content" as const,
        sourceOccurrence: fixtureReference(
          "source_occurrence",
          "source_occurrence:forbidden-1"
        ),
        providerContentKindId: "module:synthetic:unknown",
        safeFallbackReasonId: "core:unsupported"
      }
    ];
    const sourceContent = fixtureContent({
      state: {
        kind: "available",
        blocks: sourceBlocks,
        contentDigestSha256: calculateInboxV2MessageContentDigest(sourceBlocks)
      },
      revision: "2",
      updatedAt: fixtureT3
    });
    const sourceHead = inboxV2TimelineContentHeadOf(sourceContent as never);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        contentTransition: {
          ...commit.contentTransition,
          after: sourceContent
        },
        revision: {
          ...commit.revision,
          change: { ...commit.revision.change, afterContent: sourceHead }
        },
        afterStaffNote: { ...commit.afterStaffNote, content: sourceHead }
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        afterStaffNote: {
          ...commit.afterStaffNote,
          appActor: {
            kind: "trusted_service",
            trustedServiceId: "core:forged-author-service"
          },
          automationCausation: automationCausation(fixtureT0)
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        actionParticipantSnapshot: fixtureParticipant("employee", {
          conversation: fixtureReference(
            "conversation",
            "conversation:other-conversation"
          )
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        revision: {
          ...commit.revision,
          occurredAt: fixtureT0
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        providerOperation: {
          kind: "forbidden-provider-transport"
        }
      }).success
    ).toBe(false);

    const pendingFixture = availableAttachmentContent("pending");
    const pendingContent = fixtureContent({
      state: pendingFixture.state,
      revision: "2",
      updatedAt: fixtureT3
    });
    const pendingHead = inboxV2TimelineContentHeadOf(pendingContent as never);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        contentTransition: {
          ...commit.contentTransition,
          after: pendingContent
        },
        revision: {
          ...commit.revision,
          change: { ...commit.revision.change, afterContent: pendingHead }
        },
        afterStaffNote: { ...commit.afterStaffNote, content: pendingHead }
      }).success
    ).toBe(false);
  });

  it("materializes attachments only as a trusted-service action", () => {
    const commit = mutation("attachment_materialized");
    expect(inboxV2StaffNoteMutationCommitSchema.safeParse(commit).success).toBe(
      true
    );
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...commit,
        actionParticipantSnapshot: staffNoteCreation().authorParticipant,
        revision: {
          ...commit.revision,
          actionAttribution: {
            actionParticipant: fixtureReference(
              "conversation_participant",
              "conversation_participant:employee-1"
            ),
            appActor: fixtureEmployeeActor,
            automationCausation: null
          }
        }
      }).success
    ).toBe(false);
  });

  it("keeps privacy erasure and retention purge as distinct trusted tombstones", () => {
    const privacy = mutation("privacy_erasure_tombstone");
    const retention = mutation("retention_purge_tombstone");
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse(privacy).success
    ).toBe(true);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse(retention).success
    ).toBe(true);
    expect(
      inboxV2StaffNoteMutationCommitSchema.safeParse({
        ...privacy,
        contentTransition: retention.contentTransition
      }).success
    ).toBe(false);
  });

  it("exposes a bounded, unique and ordered StaffNote revision page", () => {
    const creation = staffNoteCreation();
    const edit = mutation("edited").revision;
    const page = {
      tenantId: fixtureTenantId,
      staffNote: fixtureReference("staff_note", "staff_note:note-1"),
      revisions: [creation.initialRevision, edit],
      nextCursor: null
    };
    expect(inboxV2StaffNoteRevisionPageSchema.safeParse(page).success).toBe(
      true
    );
    expect(
      inboxV2StaffNoteRevisionPageSchema.safeParse({
        ...page,
        revisions: [edit, creation.initialRevision]
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteRevisionPageSchema.safeParse({
        ...page,
        revisions: [
          creation.initialRevision,
          {
            ...edit,
            timelineItem: fixtureReference(
              "timeline_item",
              "timeline_item:other-item"
            )
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2StaffNoteRevisionPageSchema.safeParse({
        ...page,
        revisions: Array.from({ length: 201 }, () => edit)
      }).success
    ).toBe(false);
  });
});
