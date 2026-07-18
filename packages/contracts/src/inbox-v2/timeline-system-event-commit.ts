import { z } from "zod";

import {
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2EventReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import { inboxV2TimelineSequenceAllocationSchema } from "./timeline-sequence-allocation";
import { inboxV2Sha256DigestSchema } from "./sync-primitives";

export const INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.system-event-timeline-creation-commit" as const;
export const INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID =
  "core:inbox-v2.conversation-system-event-payload" as const;
export const INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

/**
 * Minimum immutable binding every legacy event_store payload must expose before
 * it can become a Conversation TimelineItem. Additional owning-domain fields
 * remain opaque to Timeline core.
 */
export const inboxV2ConversationSystemEventPayloadSchema = z
  .object({
    schemaId: z.literal(INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_ID),
    schemaVersion: z.literal(
      INBOX_V2_CONVERSATION_SYSTEM_EVENT_PAYLOAD_SCHEMA_VERSION
    ),
    conversation: inboxV2ConversationReferenceSchema,
    recordedAt: inboxV2TimestampSchema
  })
  .passthrough();

/**
 * Immutable owning-event evidence used when a live system fact is projected
 * into one Conversation timeline. The event payload remains in its owning
 * event store; this snapshot pins the exact event identity and clocks used by
 * the TimelineItem.
 */
export const inboxV2SystemEventTimelineSourceSchema = z
  .object({
    event: inboxV2EventReferenceSchema,
    eventTypeId: inboxV2NamespacedIdSchema,
    eventVersion: inboxV2SchemaVersionTokenSchema,
    conversation: inboxV2ConversationReferenceSchema,
    payloadDigest: inboxV2Sha256DigestSchema,
    occurredAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((source, context) => {
    if (!isInboxV2TimestampOrderValid(source.occurredAt, source.recordedAt)) {
      context.addIssue({
        code: "custom",
        path: ["recordedAt"],
        message: "A system event cannot be recorded before it occurred."
      });
    }
    if (source.event.tenantId !== source.conversation.tenantId) {
      context.addIssue({
        code: "custom",
        path: ["conversation"],
        message:
          "A system event and its target Conversation must share a tenant."
      });
    }
  });

/**
 * Typed creation boundary for one immutable system-event TimelineItem. The
 * generic sequence allocation remains embedded and cannot materialize a row
 * without this exact owning-event proof.
 */
export const inboxV2SystemEventTimelineCreationCommitSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    timelineAllocation: inboxV2TimelineSequenceAllocationSchema,
    source: inboxV2SystemEventTimelineSourceSchema
  })
  .strict()
  .superRefine((commit, context) => {
    const item = commit.timelineAllocation.items[0];
    if (
      commit.tenantId !== commit.timelineAllocation.tenantId ||
      commit.tenantId !== commit.source.event.tenantId ||
      commit.tenantId !== commit.source.conversation.tenantId ||
      commit.timelineAllocation.items.length !== 1 ||
      item === undefined ||
      item.tenantId !== commit.tenantId ||
      item.conversation.id !== commit.timelineAllocation.conversationAfter.id ||
      item.subject.kind !== "system_event" ||
      item.subject.event.id !== commit.source.event.id ||
      item.conversation.id !== commit.source.conversation.id ||
      item.subject.appActor === null ||
      item.visibility !== "workforce_metadata" ||
      item.activity.kind !== "non_activity" ||
      item.revision !== "1" ||
      item.occurredAt !== commit.source.occurredAt ||
      item.receivedAt !== commit.source.recordedAt ||
      item.createdAt !== commit.timelineAllocation.committedAt ||
      item.updatedAt !== commit.timelineAllocation.committedAt ||
      !isInboxV2TimestampOrderValid(
        commit.source.recordedAt,
        commit.timelineAllocation.committedAt
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["timelineAllocation"],
        message:
          "System-event creation binds one exact workforce TimelineItem, owning event, actor and immutable clocks."
      });
    }
  });

export const inboxV2SystemEventTimelineCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_SYSTEM_EVENT_TIMELINE_CREATION_COMMIT_SCHEMA_VERSION,
    inboxV2SystemEventTimelineCreationCommitSchema
  );

export type InboxV2SystemEventTimelineSource = z.infer<
  typeof inboxV2SystemEventTimelineSourceSchema
>;
export type InboxV2ConversationSystemEventPayload = z.infer<
  typeof inboxV2ConversationSystemEventPayloadSchema
>;
export type InboxV2SystemEventTimelineCreationCommit = z.infer<
  typeof inboxV2SystemEventTimelineCreationCommitSchema
>;
