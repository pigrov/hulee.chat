import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2StaffNoteIdSchema,
  inboxV2StaffNoteReferenceSchema,
  inboxV2StaffNoteRevisionIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemReferenceSchema
} from "./ids";
import {
  inboxV2TimelineContentHeadOf,
  inboxV2TimelineContentHeadSchema,
  inboxV2TimelineContentSchema,
  inboxV2TimelineContentTransitionCommitSchema
} from "./message-content";
import {
  inboxV2ConversationParticipantSchema,
  type InboxV2ConversationParticipant
} from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2AppActorSchema,
  inboxV2AutomationCausationSchema,
  inboxV2EmployeeAppActorSchema,
  inboxV2TimelineItemSchema
} from "./timeline";
import { inboxV2TimelineSequenceAllocationSchema } from "./timeline-sequence-allocation";

export const INBOX_V2_STAFF_NOTE_SCHEMA_ID =
  "core:inbox-v2.staff-note" as const;
export const INBOX_V2_STAFF_NOTE_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.staff-note-creation-commit" as const;
export const INBOX_V2_STAFF_NOTE_REVISION_SCHEMA_ID =
  "core:inbox-v2.staff-note-revision" as const;
export const INBOX_V2_STAFF_NOTE_MUTATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.staff-note-mutation-commit" as const;
export const INBOX_V2_STAFF_NOTE_READ_INTENT_SCHEMA_ID =
  "core:inbox-v2.staff-note-read-intent" as const;
export const INBOX_V2_STAFF_NOTE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

/** Structurally cannot carry SourceOccurrence, route, dispatch or delivery. */
export const inboxV2StaffNoteSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2StaffNoteIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    authorParticipant: inboxV2ConversationParticipantReferenceSchema,
    appActor: inboxV2AppActorSchema,
    automationCausation: inboxV2AutomationCausationSchema.nullable(),
    content: inboxV2TimelineContentHeadSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((note, context) => {
    for (const [field, reference] of [
      ["conversation", note.conversation],
      ["timelineItem", note.timelineItem],
      ["authorParticipant", note.authorParticipant],
      ["content", note.content.content]
    ] as const) {
      addTenantReferenceIssue(context, note.tenantId, reference, [field]);
    }
    if (note.appActor.kind === "employee") {
      addTenantReferenceIssue(context, note.tenantId, note.appActor.employee, [
        "appActor",
        "employee"
      ]);
    }
    if (note.automationCausation !== null) {
      addTenantReferenceIssue(
        context,
        note.tenantId,
        note.automationCausation.causeEvent,
        ["automationCausation", "causeEvent"]
      );
      if (note.automationCausation.kind === "employee_command") {
        addTenantReferenceIssue(
          context,
          note.tenantId,
          note.automationCausation.initiatingActor.employee,
          ["automationCausation", "initiatingActor", "employee"]
        );
      }
    }
    if (
      note.appActor.kind === "employee" &&
      note.automationCausation !== null
    ) {
      addIssue(
        context,
        ["automationCausation"],
        "A directly Employee-authored StaffNote is not an automation response."
      );
    }
    if (
      note.revision === "1" &&
      (note.content.stateKind !== "available" ||
        note.createdAt !== note.updatedAt)
    ) {
      addIssue(
        context,
        ["revision"],
        "StaffNote starts as one available content revision."
      );
    }
    if (note.content.contentRevision !== note.revision) {
      addIssue(
        context,
        ["content", "contentRevision"],
        "StaffNote and its separately purgeable content head advance together."
      );
    }
    if (!isInboxV2TimestampOrderValid(note.createdAt, note.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "StaffNote update cannot precede creation."
      );
    }
  });

export const inboxV2StaffNoteActionAttributionSchema = z
  .object({
    actionParticipant: inboxV2ConversationParticipantReferenceSchema.nullable(),
    appActor: inboxV2AppActorSchema,
    automationCausation: inboxV2AutomationCausationSchema.nullable()
  })
  .strict()
  .superRefine((attribution, context) => {
    if (
      attribution.appActor.kind === "employee" &&
      (attribution.actionParticipant === null ||
        attribution.automationCausation !== null)
    ) {
      addIssue(
        context,
        ["actionParticipant"],
        "A direct Employee StaffNote action requires its participant and no automation causation."
      );
    }
    if (
      attribution.appActor.kind === "trusted_service" &&
      attribution.automationCausation === null
    ) {
      addIssue(
        context,
        ["automationCausation"],
        "A trusted-service StaffNote action requires explicit automation causation."
      );
    }
  });

export const inboxV2StaffNoteRevisionChangeSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("created"),
        content: inboxV2TimelineContentHeadSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("edited"),
        beforeContent: inboxV2TimelineContentHeadSchema,
        afterContent: inboxV2TimelineContentHeadSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("attachment_materialized"),
        beforeContent: inboxV2TimelineContentHeadSchema,
        afterContent: inboxV2TimelineContentHeadSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("privacy_erasure_tombstone"),
        beforeContent: inboxV2TimelineContentHeadSchema,
        afterContent: inboxV2TimelineContentHeadSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("retention_purge_tombstone"),
        beforeContent: inboxV2TimelineContentHeadSchema,
        afterContent: inboxV2TimelineContentHeadSchema
      })
      .strict()
  ]
);

export const inboxV2StaffNoteRevisionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2StaffNoteRevisionIdSchema,
    staffNote: inboxV2StaffNoteReferenceSchema,
    timelineItem: inboxV2TimelineItemReferenceSchema,
    expectedPreviousRevision: inboxV2EntityRevisionSchema.nullable(),
    staffNoteRevision: inboxV2EntityRevisionSchema,
    change: inboxV2StaffNoteRevisionChangeSchema,
    actionAttribution: inboxV2StaffNoteActionAttributionSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    recordRevision: z.literal("1"),
    createdAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((revision, context) => {
    for (const [field, reference] of [
      ["staffNote", revision.staffNote],
      ["timelineItem", revision.timelineItem]
    ] as const) {
      addTenantReferenceIssue(context, revision.tenantId, reference, [field]);
    }
    addStaffNoteActionAttributionIssues(context, revision);
    addStaffNoteChangeTenantIssues(context, revision);
    addStaffNoteRevisionChangeIssues(context, revision);
    if (
      revision.change.kind === "created" &&
      (revision.expectedPreviousRevision !== null ||
        revision.staffNoteRevision !== "1")
    ) {
      addIssue(
        context,
        ["staffNoteRevision"],
        "Created StaffNote revision is the first revision without a predecessor."
      );
    }
    if (
      revision.change.kind !== "created" &&
      (revision.expectedPreviousRevision === null ||
        BigInt(revision.staffNoteRevision) !==
          BigInt(revision.expectedPreviousRevision) + 1n)
    ) {
      addIssue(
        context,
        ["staffNoteRevision"],
        "StaffNote revision history is append-only and contiguous."
      );
    }
    if (
      Date.parse(revision.recordedAt) < Date.parse(revision.occurredAt) ||
      revision.createdAt !== revision.recordedAt
    ) {
      addIssue(
        context,
        ["recordedAt"],
        "StaffNote action is recorded no earlier than it occurred."
      );
    }
    if (
      revision.actionAttribution.automationCausation !== null &&
      Date.parse(revision.actionAttribution.automationCausation.causedAt) >
        Date.parse(revision.occurredAt)
    ) {
      addIssue(
        context,
        ["actionAttribution", "automationCausation", "causedAt"],
        "StaffNote automation cause cannot follow the action it caused."
      );
    }
  });

export const inboxV2StaffNoteCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    timelineAllocation: inboxV2TimelineSequenceAllocationSchema,
    authorParticipant: inboxV2ConversationParticipantSchema,
    content: inboxV2TimelineContentSchema,
    initialRevision: inboxV2StaffNoteRevisionSchema,
    staffNote: inboxV2StaffNoteSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const {
      authorParticipant,
      content,
      initialRevision,
      staffNote,
      timelineAllocation
    } = commit;
    const conversation = timelineAllocation.conversationAfter;
    const timelineItem = timelineAllocation.items[0];
    if (
      timelineAllocation.items.length !== 1 ||
      commit.tenantId !== timelineAllocation.tenantId ||
      commit.tenantId !== conversation.tenantId ||
      commit.tenantId !== authorParticipant.tenantId ||
      commit.tenantId !== content.tenantId ||
      commit.tenantId !== initialRevision.tenantId ||
      commit.tenantId !== staffNote.tenantId ||
      timelineItem === undefined ||
      conversation.id !== staffNote.conversation.id ||
      conversation.id !== authorParticipant.conversation.id ||
      conversation.id !== timelineItem.conversation.id ||
      authorParticipant.id !== staffNote.authorParticipant.id ||
      timelineItem.id !== staffNote.timelineItem.id ||
      timelineItem.subject.kind !== "staff_note" ||
      timelineItem.subject.staffNote.id !== staffNote.id ||
      timelineItem.subject.staffNoteRevision !== staffNote.revision ||
      timelineItem.visibility !== "staff_only" ||
      timelineItem.activity.kind !== "eligible" ||
      staffNote.revision !== "1" ||
      timelineItem.revision !== "1" ||
      content.revision !== "1" ||
      timelineAllocation.committedAt !== staffNote.createdAt ||
      timelineAllocation.committedAt !== staffNote.updatedAt ||
      timelineAllocation.committedAt !== content.createdAt ||
      timelineAllocation.committedAt !== content.updatedAt ||
      Date.parse(timelineItem.occurredAt) >
        Date.parse(timelineAllocation.committedAt) ||
      Date.parse(authorParticipant.createdAt) >
        Date.parse(timelineItem.occurredAt) ||
      Date.parse(authorParticipant.updatedAt) >
        Date.parse(timelineItem.occurredAt) ||
      !sameValue(staffNote.content, inboxV2TimelineContentHeadOf(content))
    ) {
      addIssue(
        context,
        ["staffNote"],
        "StaffNote creation binds one exact staff-only TimelineItem, author and content revision."
      );
    }

    if (!isAllowedStaffNoteAuthor(authorParticipant, staffNote)) {
      addIssue(
        context,
        ["authorParticipant"],
        "StaffNote author must be the exact Employee or bot represented by its app attribution."
      );
    }

    if (
      initialRevision.staffNote.id !== staffNote.id ||
      initialRevision.timelineItem.id !== timelineItem?.id ||
      initialRevision.expectedPreviousRevision !== null ||
      initialRevision.staffNoteRevision !== "1" ||
      initialRevision.change.kind !== "created" ||
      !sameValue(
        initialRevision.change.kind === "created"
          ? initialRevision.change.content
          : null,
        staffNote.content
      ) ||
      initialRevision.actionAttribution.actionParticipant?.id !==
        authorParticipant.id ||
      !sameValue(
        initialRevision.actionAttribution.appActor,
        staffNote.appActor
      ) ||
      !sameValue(
        initialRevision.actionAttribution.automationCausation,
        staffNote.automationCausation
      ) ||
      initialRevision.occurredAt !== timelineItem?.occurredAt ||
      initialRevision.recordedAt !== timelineAllocation.committedAt
    ) {
      addIssue(
        context,
        ["initialRevision"],
        "StaffNote creation appends one exact initial author/content revision."
      );
    }

    if (
      staffNote.automationCausation !== null &&
      Date.parse(staffNote.automationCausation.causedAt) >
        Date.parse(timelineItem?.occurredAt ?? timelineAllocation.committedAt)
    ) {
      addIssue(
        context,
        ["staffNote", "automationCausation", "causedAt"],
        "StaffNote automation cause cannot follow the note occurrence."
      );
    }

    if (
      content.state.kind === "available" &&
      content.state.blocks.some(
        (block) => block.kind === "unsupported_source_content"
      )
    ) {
      addIssue(
        context,
        ["content", "state", "blocks"],
        "StaffNote content cannot carry provider/source occurrence evidence."
      );
    }
  });

export const inboxV2StaffNoteMutationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    beforeStaffNote: inboxV2StaffNoteSchema,
    beforeTimelineItem: inboxV2TimelineItemSchema,
    authorParticipantSnapshot: inboxV2ConversationParticipantSchema,
    actionParticipantSnapshot: inboxV2ConversationParticipantSchema.nullable(),
    contentTransition: inboxV2TimelineContentTransitionCommitSchema,
    revision: inboxV2StaffNoteRevisionSchema,
    afterStaffNote: inboxV2StaffNoteSchema,
    afterTimelineItem: inboxV2TimelineItemSchema
  })
  .strict()
  .superRefine((commit, context) => {
    addStaffNoteMutationHeadIssues(context, commit);
    addStaffNoteMutationAuthorIssues(context, commit);
    addStaffNoteMutationActionIssues(context, commit);
    addStaffNoteMutationChangeIssues(context, commit);
  });

export const inboxV2StaffNoteRevisionPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    staffNote: inboxV2StaffNoteReferenceSchema,
    revisions: z.array(inboxV2StaffNoteRevisionSchema).max(200),
    nextCursor: z.string().min(1).max(2_048).nullable()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.staffNote, [
      "staffNote"
    ]);
    const ids = new Set<string>();
    let previous: z.infer<typeof inboxV2StaffNoteRevisionSchema> | null = null;
    let timelineItemId: string | null = null;
    for (const [index, revision] of page.revisions.entries()) {
      const currentRevision = BigInt(revision.staffNoteRevision);
      if (
        revision.tenantId !== page.tenantId ||
        revision.staffNote.id !== page.staffNote.id ||
        ids.has(revision.id) ||
        (timelineItemId !== null &&
          revision.timelineItem.id !== timelineItemId) ||
        (previous !== null &&
          (currentRevision !== BigInt(previous.staffNoteRevision) + 1n ||
            revision.expectedPreviousRevision !== previous.staffNoteRevision))
      ) {
        addIssue(
          context,
          ["revisions", index],
          "StaffNote revision page is bounded, unique and strictly ordered for one exact note."
        );
      }
      ids.add(revision.id);
      timelineItemId ??= revision.timelineItem.id;
      previous = revision;
    }
  });

/** Read intent is separate from create and from provider/Employee read receipts. */
export const inboxV2StaffNoteReadIntentSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    staffNote: inboxV2StaffNoteReferenceSchema,
    reader: inboxV2EmployeeAppActorSchema,
    readAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((intent, context) => {
    addTenantReferenceIssue(context, intent.tenantId, intent.staffNote, [
      "staffNote"
    ]);
    addTenantReferenceIssue(context, intent.tenantId, intent.reader.employee, [
      "reader",
      "employee"
    ]);
  });

export const inboxV2StaffNoteEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_STAFF_NOTE_SCHEMA_ID,
  INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
  inboxV2StaffNoteSchema
);
export const inboxV2StaffNoteCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_STAFF_NOTE_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
    inboxV2StaffNoteCreationCommitSchema
  );
export const inboxV2StaffNoteRevisionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_STAFF_NOTE_REVISION_SCHEMA_ID,
    INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
    inboxV2StaffNoteRevisionSchema
  );
export const inboxV2StaffNoteMutationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_STAFF_NOTE_MUTATION_COMMIT_SCHEMA_ID,
    INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
    inboxV2StaffNoteMutationCommitSchema
  );
export const inboxV2StaffNoteReadIntentEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_STAFF_NOTE_READ_INTENT_SCHEMA_ID,
    INBOX_V2_STAFF_NOTE_SCHEMA_VERSION,
    inboxV2StaffNoteReadIntentSchema
  );

export type InboxV2StaffNote = z.infer<typeof inboxV2StaffNoteSchema>;
export type InboxV2StaffNoteCreationCommit = z.infer<
  typeof inboxV2StaffNoteCreationCommitSchema
>;
export type InboxV2StaffNoteRevision = z.infer<
  typeof inboxV2StaffNoteRevisionSchema
>;
export type InboxV2StaffNoteMutationCommit = z.infer<
  typeof inboxV2StaffNoteMutationCommitSchema
>;
export type InboxV2StaffNoteRevisionPage = z.infer<
  typeof inboxV2StaffNoteRevisionPageSchema
>;

function addStaffNoteActionAttributionIssues(
  context: z.RefinementCtx,
  revision: z.infer<typeof inboxV2StaffNoteRevisionSchema>
): void {
  const attribution = revision.actionAttribution;
  if (attribution.actionParticipant !== null) {
    addTenantReferenceIssue(
      context,
      revision.tenantId,
      attribution.actionParticipant,
      ["actionAttribution", "actionParticipant"]
    );
  }
  if (attribution.appActor.kind === "employee") {
    addTenantReferenceIssue(
      context,
      revision.tenantId,
      attribution.appActor.employee,
      ["actionAttribution", "appActor", "employee"]
    );
  }
  if (attribution.automationCausation !== null) {
    addTenantReferenceIssue(
      context,
      revision.tenantId,
      attribution.automationCausation.causeEvent,
      ["actionAttribution", "automationCausation", "causeEvent"]
    );
    if (attribution.automationCausation.kind === "employee_command") {
      addTenantReferenceIssue(
        context,
        revision.tenantId,
        attribution.automationCausation.initiatingActor.employee,
        [
          "actionAttribution",
          "automationCausation",
          "initiatingActor",
          "employee"
        ]
      );
    }
  }
}

function addStaffNoteChangeTenantIssues(
  context: z.RefinementCtx,
  revision: z.infer<typeof inboxV2StaffNoteRevisionSchema>
): void {
  const change = revision.change;
  if (change.kind === "created") {
    addTenantReferenceIssue(
      context,
      revision.tenantId,
      change.content.content,
      ["change", "content"]
    );
    return;
  }
  addTenantReferenceIssue(
    context,
    revision.tenantId,
    change.beforeContent.content,
    ["change", "beforeContent"]
  );
  addTenantReferenceIssue(
    context,
    revision.tenantId,
    change.afterContent.content,
    ["change", "afterContent"]
  );
}

function addStaffNoteRevisionChangeIssues(
  context: z.RefinementCtx,
  revision: z.infer<typeof inboxV2StaffNoteRevisionSchema>
): void {
  const change = revision.change;
  if (change.kind === "created") {
    if (
      change.content.contentRevision !== "1" ||
      change.content.stateKind !== "available"
    ) {
      addIssue(
        context,
        ["change", "content"],
        "Initial StaffNote history starts at one available content revision."
      );
    }
    return;
  }

  const expectedAfterState =
    change.kind === "privacy_erasure_tombstone"
      ? "privacy_erased"
      : change.kind === "retention_purge_tombstone"
        ? "retention_purged"
        : "available";
  if (
    change.beforeContent.content.id !== change.afterContent.content.id ||
    change.beforeContent.contentRevision !==
      revision.expectedPreviousRevision ||
    change.afterContent.contentRevision !== revision.staffNoteRevision ||
    BigInt(change.afterContent.contentRevision) !==
      BigInt(change.beforeContent.contentRevision) + 1n ||
    change.beforeContent.stateKind !== "available" ||
    change.afterContent.stateKind !== expectedAfterState
  ) {
    addIssue(
      context,
      ["change"],
      "StaffNote history advances the exact content head with the matching lifecycle outcome."
    );
  }
}

function addStaffNoteMutationHeadIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2StaffNoteMutationCommitSchema>
): void {
  const {
    afterStaffNote: after,
    afterTimelineItem: afterItem,
    beforeStaffNote: before,
    beforeTimelineItem: beforeItem,
    contentTransition,
    revision
  } = commit;
  if (
    commit.tenantId !== before.tenantId ||
    commit.tenantId !== after.tenantId ||
    commit.tenantId !== beforeItem.tenantId ||
    commit.tenantId !== afterItem.tenantId ||
    commit.tenantId !== contentTransition.tenantId ||
    commit.tenantId !== revision.tenantId ||
    before.id !== after.id ||
    before.id !== revision.staffNote.id ||
    before.timelineItem.id !== beforeItem.id ||
    after.timelineItem.id !== afterItem.id ||
    beforeItem.id !== afterItem.id ||
    beforeItem.id !== revision.timelineItem.id ||
    before.conversation.id !== after.conversation.id ||
    before.conversation.id !== beforeItem.conversation.id ||
    before.conversation.id !== afterItem.conversation.id ||
    revision.expectedPreviousRevision !== before.revision ||
    revision.staffNoteRevision !== after.revision ||
    BigInt(after.revision) !== BigInt(before.revision) + 1n ||
    after.updatedAt !== revision.recordedAt ||
    Date.parse(before.updatedAt) > Date.parse(revision.occurredAt) ||
    Date.parse(contentTransition.before.updatedAt) >
      Date.parse(revision.occurredAt) ||
    !sameValue(
      staffNoteImmutableFacts(before),
      staffNoteImmutableFacts(after)
    ) ||
    !sameValue(
      before.content,
      inboxV2TimelineContentHeadOf(contentTransition.before)
    ) ||
    !sameValue(
      after.content,
      inboxV2TimelineContentHeadOf(contentTransition.after)
    ) ||
    contentTransition.transition.occurredAt !== revision.recordedAt
  ) {
    addIssue(
      context,
      ["afterStaffNote"],
      "StaffNote mutation advances one exact note/content CAS while preserving original authorship."
    );
  }

  if (
    beforeItem.subject.kind !== "staff_note" ||
    afterItem.subject.kind !== "staff_note" ||
    beforeItem.subject.staffNote.id !== before.id ||
    afterItem.subject.staffNote.id !== after.id ||
    beforeItem.subject.staffNoteRevision !== before.revision ||
    afterItem.subject.staffNoteRevision !== after.revision ||
    BigInt(afterItem.revision) !== BigInt(beforeItem.revision) + 1n ||
    afterItem.updatedAt !== revision.recordedAt ||
    Date.parse(beforeItem.updatedAt) > Date.parse(revision.occurredAt) ||
    !sameValue(
      timelineItemImmutableFacts(beforeItem),
      timelineItemImmutableFacts(afterItem)
    )
  ) {
    addIssue(
      context,
      ["afterTimelineItem"],
      "StaffNote mutation preserves sequence and advances the same staff-only TimelineItem head."
    );
  }
  if (
    contentTransition.after.state.kind === "available" &&
    contentTransition.after.state.blocks.some(
      (block) => block.kind === "unsupported_source_content"
    )
  ) {
    addIssue(
      context,
      ["contentTransition", "after", "state", "blocks"],
      "StaffNote mutation cannot introduce provider/source occurrence content."
    );
  }
}

function addStaffNoteMutationAuthorIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2StaffNoteMutationCommitSchema>
): void {
  const author = commit.authorParticipantSnapshot;
  const before = commit.beforeStaffNote;
  if (
    author.tenantId !== commit.tenantId ||
    author.id !== before.authorParticipant.id ||
    author.conversation.id !== before.conversation.id ||
    Date.parse(author.createdAt) > Date.parse(before.createdAt) ||
    Date.parse(author.updatedAt) >
      Date.parse(commit.beforeTimelineItem.occurredAt) ||
    !isAllowedStaffNoteAuthor(author, before)
  ) {
    addIssue(
      context,
      ["authorParticipantSnapshot"],
      "StaffNote mutation retains the exact same-Conversation original author proof."
    );
  }
}

function addStaffNoteMutationActionIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2StaffNoteMutationCommitSchema>
): void {
  const attribution = commit.revision.actionAttribution;
  const reference = attribution.actionParticipant;
  const participant = commit.actionParticipantSnapshot;
  if ((reference === null) !== (participant === null)) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "StaffNote action participant requires one exact bounded snapshot."
    );
    return;
  }
  if (reference === null || participant === null) {
    return;
  }
  if (
    participant.tenantId !== commit.tenantId ||
    participant.id !== reference.id ||
    participant.conversation.id !== commit.beforeStaffNote.conversation.id ||
    Date.parse(participant.createdAt) >
      Date.parse(commit.revision.occurredAt) ||
    Date.parse(participant.updatedAt) > Date.parse(commit.revision.occurredAt)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot"],
      "StaffNote action participant must belong to the exact target Conversation at action time."
    );
    return;
  }
  if (
    attribution.appActor.kind === "employee" &&
    (participant.subject.kind !== "employee" ||
      participant.subject.employee.id !== attribution.appActor.employee.id)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot", "subject"],
      "Employee StaffNote actor and action participant must identify the same Employee."
    );
  }
  if (
    attribution.appActor.kind === "trusted_service" &&
    (participant.subject.kind !== "bot" ||
      participant.id !== commit.beforeStaffNote.authorParticipant.id ||
      commit.beforeStaffNote.appActor.kind !== "trusted_service" ||
      commit.beforeStaffNote.appActor.trustedServiceId !==
        attribution.appActor.trustedServiceId)
  ) {
    addIssue(
      context,
      ["actionParticipantSnapshot", "subject"],
      "A trusted service can act as a participant only through the original note bot identity."
    );
  }
}

function addStaffNoteMutationChangeIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2StaffNoteMutationCommitSchema>
): void {
  const change = commit.revision.change;
  if (change.kind === "created") {
    addIssue(
      context,
      ["revision", "change"],
      "Created revision belongs to StaffNote creation, not mutation."
    );
    return;
  }
  const expectedTransition =
    change.kind === "edited"
      ? "edit"
      : change.kind === "attachment_materialized"
        ? "attachment_materialization"
        : change.kind === "privacy_erasure_tombstone"
          ? "privacy_erasure"
          : "retention_purge";
  if (
    commit.contentTransition.transition.kind !== expectedTransition ||
    !sameValue(change.beforeContent, commit.beforeStaffNote.content) ||
    !sameValue(change.afterContent, commit.afterStaffNote.content)
  ) {
    addIssue(
      context,
      ["revision", "change"],
      "StaffNote revision change must match the exact content transition and heads."
    );
  }
  if (
    change.kind !== "edited" &&
    commit.revision.actionAttribution.appActor.kind !== "trusted_service"
  ) {
    addIssue(
      context,
      ["revision", "actionAttribution", "appActor"],
      "Attachment materialization and privacy/retention tombstones are trusted-service actions."
    );
  }
}

function staffNoteImmutableFacts(
  note: z.infer<typeof inboxV2StaffNoteSchema>
): unknown {
  const {
    content: _content,
    revision: _revision,
    updatedAt: _updatedAt,
    ...facts
  } = note;
  return facts;
}

function timelineItemImmutableFacts(
  item: z.infer<typeof inboxV2TimelineItemSchema>
): unknown {
  const {
    subject: _subject,
    revision: _revision,
    updatedAt: _updatedAt,
    ...facts
  } = item;
  return facts;
}

function isAllowedStaffNoteAuthor(
  participant: InboxV2ConversationParticipant,
  note: z.infer<typeof inboxV2StaffNoteSchema>
): boolean {
  if (participant.subject.kind === "employee") {
    return (
      note.appActor.kind === "employee" &&
      participant.subject.employee.id === note.appActor.employee.id
    );
  }
  return (
    participant.subject.kind === "bot" &&
    note.appActor.kind === "trusted_service" &&
    note.automationCausation !== null
  );
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "StaffNote references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
