import { z } from "zod";

import type { Brand } from "../brand";
import {
  inboxV2AuthorizationEpochSchema,
  type InboxV2AuthorizationEpoch
} from "./authorization-epoch";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2BigintCounterSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationParticipantReferenceSchema,
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2EventReferenceSchema,
  inboxV2MessageReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2ParticipantMembershipTransitionReferenceSchema,
  inboxV2SourceObjectReferenceSchema,
  inboxV2SourceOccurrenceReferenceSchema,
  inboxV2StaffNoteReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimelineItemReferenceSchema,
  inboxV2WorkItemRelationTransitionReferenceSchema,
  inboxV2WorkItemTransitionReferenceSchema
} from "./ids";
import {
  inboxV2ParticipantSystemActorIdSchema,
  inboxV2TrustedServiceIdSchema
} from "./participant-identity";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";

export const INBOX_V2_TIMELINE_ITEM_SCHEMA_ID =
  "core:inbox-v2.timeline-item" as const;
export const INBOX_V2_TIMELINE_SCHEMA_VERSION = INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_SOURCE_OBJECT_KIND_CATALOG =
  "source-object-kind" as const;
export const INBOX_V2_TIMELINE_ITEM_KIND_CATALOG =
  "timeline-item-kind" as const;
export const INBOX_V2_TIMELINE_ACTIVITY_REASON_CATALOG =
  "timeline-activity-reason" as const;
export const INBOX_V2_TIMELINE_MIGRATION_PROVENANCE_CATALOG =
  "timeline-migration-provenance" as const;

export type InboxV2TimelineSequence = Brand<string, "InboxV2TimelineSequence">;
export type InboxV2TimelineCounter = Brand<string, "InboxV2TimelineCounter">;
export type InboxV2AppAuthorizationEpoch = InboxV2AuthorizationEpoch;
export type InboxV2TimelineCorrelationId = Brand<
  string,
  "InboxV2TimelineCorrelationId"
>;
export type InboxV2SourceObjectKindId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_OBJECT_KIND_CATALOG
>;
export type InboxV2TimelineItemKindId = InboxV2CatalogId<
  typeof INBOX_V2_TIMELINE_ITEM_KIND_CATALOG
>;
export type InboxV2TimelineActivityReasonId = InboxV2CatalogId<
  typeof INBOX_V2_TIMELINE_ACTIVITY_REASON_CATALOG
>;
export type InboxV2TimelineMigrationProvenanceId = InboxV2CatalogId<
  typeof INBOX_V2_TIMELINE_MIGRATION_PROVENANCE_CATALOG
>;

export const inboxV2TimelineSequenceSchema =
  inboxV2EntityRevisionSchema.transform(
    (value) => value as unknown as InboxV2TimelineSequence
  );

export const inboxV2TimelineCounterSchema =
  inboxV2BigintCounterSchema.transform(
    (value) => value as unknown as InboxV2TimelineCounter
  );

export const inboxV2AppAuthorizationEpochSchema =
  inboxV2AuthorizationEpochSchema;

export const inboxV2TimelineCorrelationIdSchema = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[A-Za-z0-9._~:-]+$/u)
  .transform((value) => value as InboxV2TimelineCorrelationId);

export const inboxV2SourceObjectKindIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2SourceObjectKindId
);
export const inboxV2TimelineItemKindIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TimelineItemKindId
);
export const inboxV2TimelineActivityReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2TimelineActivityReasonId
  );
export const inboxV2TimelineMigrationProvenanceIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2TimelineMigrationProvenanceId
  );

/** Server-stamped application actor; never an author override from a source. */
export const inboxV2EmployeeAppActorSchema = z
  .object({
    kind: z.literal("employee"),
    employee: inboxV2EmployeeReferenceSchema,
    authorizationEpoch: inboxV2AppAuthorizationEpochSchema
  })
  .strict();

export const inboxV2AppActorSchema = z.discriminatedUnion("kind", [
  inboxV2EmployeeAppActorSchema,
  z
    .object({
      kind: z.literal("trusted_service"),
      trustedServiceId: inboxV2TrustedServiceIdSchema
    })
    .strict()
]);

export const inboxV2AutomationCausationSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("employee_command"),
      initiatingActor: inboxV2EmployeeAppActorSchema,
      causeEvent: inboxV2EventReferenceSchema,
      correlationId: inboxV2TimelineCorrelationIdSchema,
      causedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("system_event"),
      causeEvent: inboxV2EventReferenceSchema,
      correlationId: inboxV2TimelineCorrelationIdSchema,
      causedAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2TimelineVisibilitySchema = z.enum([
  "conversation_external",
  "internal_participants",
  "staff_only",
  "workforce_metadata",
  "source_item_policy"
]);

export const inboxV2TimelineActivitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("eligible") }).strict(),
  z
    .object({
      kind: z.literal("history_import"),
      sourceOccurrence: inboxV2SourceOccurrenceReferenceSchema,
      importedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("migration"),
      provenanceId: inboxV2TimelineMigrationProvenanceIdSchema,
      importedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("non_activity"),
      reasonId: inboxV2TimelineActivityReasonIdSchema
    })
    .strict()
]);

export const inboxV2SourceObjectDescriptorSchema = z
  .object({
    sourceObject: inboxV2SourceObjectReferenceSchema,
    objectKindId: inboxV2SourceObjectKindIdSchema,
    objectRevision: inboxV2EntityRevisionSchema,
    normalizedSourceEvent:
      inboxV2NormalizedInboundEventReferenceSchema.nullable()
  })
  .strict();

const inboxV2WorkChangeReferenceSchema = z.union([
  inboxV2WorkItemTransitionReferenceSchema,
  inboxV2WorkItemRelationTransitionReferenceSchema
]);

export const inboxV2TimelineItemSubjectSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("message"),
      message: inboxV2MessageReferenceSchema,
      messageRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("staff_note"),
      staffNote: inboxV2StaffNoteReferenceSchema,
      staffNoteRevision: inboxV2EntityRevisionSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("call"),
      source: inboxV2SourceObjectDescriptorSchema,
      actorParticipant: inboxV2ConversationParticipantReferenceSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("review"),
      source: inboxV2SourceObjectDescriptorSchema,
      authorParticipant: inboxV2ConversationParticipantReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("module_event"),
      itemKindId: inboxV2TimelineItemKindIdSchema,
      source: inboxV2SourceObjectDescriptorSchema,
      actorParticipant: inboxV2ConversationParticipantReferenceSchema.nullable()
    })
    .strict(),
  z
    .object({
      kind: z.literal("participant_change"),
      transition: inboxV2ParticipantMembershipTransitionReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("work_change"),
      transition: inboxV2WorkChangeReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("system_event"),
      event: inboxV2EventReferenceSchema,
      systemActorId: inboxV2ParticipantSystemActorIdSchema,
      appActor: inboxV2AppActorSchema.nullable()
    })
    .strict()
]);

/** Compact ordered head. Subject payload/history remains in its owning domain. */
export const inboxV2TimelineItemSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2TimelineItemIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    timelineSequence: inboxV2TimelineSequenceSchema,
    subject: inboxV2TimelineItemSubjectSchema,
    visibility: inboxV2TimelineVisibilitySchema,
    activity: inboxV2TimelineActivitySchema,
    occurredAt: inboxV2TimestampSchema,
    receivedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((item, context) => {
    addTenantReferenceIssue(context, item.tenantId, item.conversation, [
      "conversation"
    ]);
    addSubjectTenantIssues(context, item);

    if (
      item.subject.kind === "message" &&
      item.subject.messageRevision !== item.revision
    ) {
      addIssue(
        context,
        ["subject", "messageRevision"],
        "Timeline Message head and TimelineItem revision must advance together."
      );
    }
    if (
      item.subject.kind === "staff_note" &&
      item.subject.staffNoteRevision !== item.revision
    ) {
      addIssue(
        context,
        ["subject", "staffNoteRevision"],
        "Timeline StaffNote head and TimelineItem revision must advance together."
      );
    }
    if (
      item.subject.kind !== "message" &&
      item.subject.kind !== "staff_note" &&
      item.revision !== "1"
    ) {
      addIssue(
        context,
        ["revision"],
        "Immutable non-communication TimelineItems remain at revision 1."
      );
    }

    if (
      item.subject.kind === "staff_note" &&
      item.visibility !== "staff_only"
    ) {
      addIssue(
        context,
        ["visibility"],
        "Staff notes are structurally limited to staff-only visibility."
      );
    }
    if (
      item.subject.kind === "work_change" &&
      item.visibility !== "workforce_metadata"
    ) {
      addIssue(
        context,
        ["visibility"],
        "Work changes use workforce-metadata visibility."
      );
    }
    if (
      (item.subject.kind === "participant_change" ||
        item.subject.kind === "system_event") &&
      item.visibility !== "workforce_metadata"
    ) {
      addIssue(
        context,
        ["visibility"],
        "Participant and system lifecycle facts use workforce-metadata visibility."
      );
    }
    if (
      item.subject.kind === "message" &&
      item.visibility !== "conversation_external" &&
      item.visibility !== "internal_participants"
    ) {
      addIssue(
        context,
        ["visibility"],
        "Messages are visible either to external Conversation or internal participants."
      );
    }
    if (
      (item.subject.kind === "call" ||
        item.subject.kind === "review" ||
        item.subject.kind === "module_event") &&
      item.visibility !== "source_item_policy"
    ) {
      addIssue(
        context,
        ["visibility"],
        "Source objects use their registered source-item visibility policy."
      );
    }

    if (!isInboxV2TimestampOrderValid(item.occurredAt, item.receivedAt)) {
      addIssue(
        context,
        ["receivedAt"],
        "TimelineItem cannot be received before it occurred."
      );
    }
    if (!isInboxV2TimestampOrderValid(item.receivedAt, item.createdAt)) {
      addIssue(
        context,
        ["createdAt"],
        "TimelineItem cannot commit before Hulee receives it."
      );
    }
    if (!isInboxV2TimestampOrderValid(item.createdAt, item.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "TimelineItem update cannot precede creation."
      );
    }
    if (item.revision === "1" && item.updatedAt !== item.createdAt) {
      addIssue(
        context,
        ["updatedAt"],
        "Initial TimelineItem revision has one commit timestamp."
      );
    }
    if (item.activity.kind === "history_import") {
      addTenantReferenceIssue(
        context,
        item.tenantId,
        item.activity.sourceOccurrence,
        ["activity", "sourceOccurrence"]
      );
      if (
        !isInboxV2TimestampOrderValid(item.activity.importedAt, item.createdAt)
      ) {
        addIssue(
          context,
          ["activity", "importedAt"],
          "History import must be recorded no later than the item commit."
        );
      }
    } else if (
      item.activity.kind === "migration" &&
      !isInboxV2TimestampOrderValid(item.activity.importedAt, item.createdAt)
    ) {
      addIssue(
        context,
        ["activity", "importedAt"],
        "Migration import must be recorded no later than the item commit."
      );
    }
  });

export const inboxV2TimelineItemEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_TIMELINE_ITEM_SCHEMA_ID,
    INBOX_V2_TIMELINE_SCHEMA_VERSION,
    inboxV2TimelineItemSchema
  );

export const inboxV2TimelineItemPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    anchor: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("latest") }).strict(),
      z
        .object({
          kind: z.literal("before"),
          sequence: inboxV2TimelineSequenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("after"),
          sequence: inboxV2TimelineSequenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("around"),
          timelineItem: inboxV2TimelineItemReferenceSchema
        })
        .strict()
    ]),
    items: z.array(inboxV2TimelineItemSchema).max(200),
    hasMoreBefore: z.boolean(),
    hasMoreAfter: z.boolean()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.conversation, [
      "conversation"
    ]);
    if (page.anchor.kind === "around") {
      addTenantReferenceIssue(
        context,
        page.tenantId,
        page.anchor.timelineItem,
        ["anchor", "timelineItem"]
      );
    }
    let previous = 0n;
    const ids = new Set<string>();
    for (const [index, item] of page.items.entries()) {
      if (
        item.tenantId !== page.tenantId ||
        item.conversation.id !== page.conversation.id
      ) {
        addIssue(
          context,
          ["items", index, "conversation"],
          "A timeline page belongs to one exact Conversation."
        );
      }
      const sequence = BigInt(item.timelineSequence);
      if (index > 0 && sequence <= previous) {
        addIssue(
          context,
          ["items", index, "timelineSequence"],
          "Timeline page items are strictly ordered by server sequence."
        );
      }
      previous = sequence;
      if (ids.has(item.id)) {
        addIssue(
          context,
          ["items", index, "id"],
          "Timeline page cannot repeat an item."
        );
      }
      ids.add(item.id);
    }
    if (page.anchor.kind === "before") {
      const anchorSequence = BigInt(page.anchor.sequence);
      if (
        page.items.some(
          (item) => BigInt(item.timelineSequence) >= anchorSequence
        )
      ) {
        addIssue(
          context,
          ["items"],
          "A before page contains only sequences strictly below its anchor."
        );
      }
    }
    if (page.anchor.kind === "after") {
      const anchorSequence = BigInt(page.anchor.sequence);
      if (
        page.items.some(
          (item) => BigInt(item.timelineSequence) <= anchorSequence
        )
      ) {
        addIssue(
          context,
          ["items"],
          "An after page contains only sequences strictly above its anchor."
        );
      }
    }
    if (page.anchor.kind === "around") {
      const anchorItemId = page.anchor.timelineItem.id;
      if (!page.items.some((item) => item.id === anchorItemId)) {
        addIssue(
          context,
          ["items"],
          "An around page must contain its exact TimelineItem anchor."
        );
      }
    }
    if (page.anchor.kind === "latest" && page.hasMoreAfter) {
      addIssue(
        context,
        ["hasMoreAfter"],
        "A latest page cannot report a later committed page."
      );
    }
  });

export type InboxV2AppActor = z.infer<typeof inboxV2AppActorSchema>;
export type InboxV2AutomationCausation = z.infer<
  typeof inboxV2AutomationCausationSchema
>;
export type InboxV2TimelineItem = z.infer<typeof inboxV2TimelineItemSchema>;
export type InboxV2TimelineItemPage = z.infer<
  typeof inboxV2TimelineItemPageSchema
>;

export function isInboxV2TimelineActivityEligible(
  item: Pick<InboxV2TimelineItem, "activity">
): boolean {
  return item.activity.kind === "eligible";
}

function addSubjectTenantIssues(
  context: z.RefinementCtx,
  item: {
    tenantId: string;
    subject: z.infer<typeof inboxV2TimelineItemSubjectSchema>;
  }
): void {
  const { subject } = item;
  switch (subject.kind) {
    case "message":
      addTenantReferenceIssue(context, item.tenantId, subject.message, [
        "subject",
        "message"
      ]);
      return;
    case "staff_note":
      addTenantReferenceIssue(context, item.tenantId, subject.staffNote, [
        "subject",
        "staffNote"
      ]);
      return;
    case "call":
      addSourceDescriptorTenantIssues(context, item.tenantId, subject.source, [
        "subject",
        "source"
      ]);
      if (subject.actorParticipant !== null) {
        addTenantReferenceIssue(
          context,
          item.tenantId,
          subject.actorParticipant,
          ["subject", "actorParticipant"]
        );
      }
      return;
    case "review":
      addSourceDescriptorTenantIssues(context, item.tenantId, subject.source, [
        "subject",
        "source"
      ]);
      addTenantReferenceIssue(
        context,
        item.tenantId,
        subject.authorParticipant,
        ["subject", "authorParticipant"]
      );
      return;
    case "module_event":
      addSourceDescriptorTenantIssues(context, item.tenantId, subject.source, [
        "subject",
        "source"
      ]);
      if (subject.actorParticipant !== null) {
        addTenantReferenceIssue(
          context,
          item.tenantId,
          subject.actorParticipant,
          ["subject", "actorParticipant"]
        );
      }
      return;
    case "participant_change":
    case "work_change":
      addTenantReferenceIssue(context, item.tenantId, subject.transition, [
        "subject",
        "transition"
      ]);
      return;
    case "system_event":
      addTenantReferenceIssue(context, item.tenantId, subject.event, [
        "subject",
        "event"
      ]);
      if (subject.appActor?.kind === "employee") {
        addTenantReferenceIssue(
          context,
          item.tenantId,
          subject.appActor.employee,
          ["subject", "appActor", "employee"]
        );
      }
  }
}

function addSourceDescriptorTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  descriptor: z.infer<typeof inboxV2SourceObjectDescriptorSchema>,
  path: PropertyKey[]
): void {
  addTenantReferenceIssue(context, tenantId, descriptor.sourceObject, [
    ...path,
    "sourceObject"
  ]);
  if (descriptor.normalizedSourceEvent !== null) {
    addTenantReferenceIssue(
      context,
      tenantId,
      descriptor.normalizedSourceEvent,
      [...path, "normalizedSourceEvent"]
    );
  }
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "Timeline references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
