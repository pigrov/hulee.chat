import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import type { InboxV2TimelineSequence } from "./timeline";

export const INBOX_V2_CONVERSATION_SCHEMA_ID =
  "core:inbox-v2.conversation" as const;
export const INBOX_V2_CONVERSATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_CONVERSATION_PURPOSE_CATALOG =
  "conversation-purpose" as const;

const postgresBigintMax = "9223372036854775807";
const canonicalNonNegativeDecimalPattern = /^(?:0|[1-9][0-9]*)$/;

export type InboxV2ConversationSequenceHead = Brand<
  string,
  "InboxV2ConversationSequenceHead"
>;
export type InboxV2ConversationPurposeId = InboxV2CatalogId<
  typeof INBOX_V2_CONVERSATION_PURPOSE_CATALOG
>;

export const inboxV2ConversationTopologySchema = z.enum([
  "direct",
  "group",
  "case",
  "object"
]);

export const inboxV2ConversationTransportSchema = z.enum([
  "internal",
  "external"
]);

/**
 * Purpose is an extensible policy/catalog hint, not a lifecycle or provider
 * discriminator. Core and modules therefore use the shared namespaced-ID
 * ownership rules instead of extending a closed enum. An ID is syntax-checked
 * here; command handling must also resolve it fail-closed against the tenant's
 * pinned catalog snapshot.
 */
export const inboxV2ConversationPurposeIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2ConversationPurposeId
  );

export const INBOX_V2_CORE_CONVERSATION_PURPOSE_IDS = Object.freeze({
  chat: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
  support: inboxV2ConversationPurposeIdSchema.parse("core:support"),
  service: inboxV2ConversationPurposeIdSchema.parse("core:service")
});

/**
 * Reactivation from ended to active is an explicit revisioned command. Archive,
 * hide and operational resolution are deliberately absent from this lifecycle.
 */
export const inboxV2ConversationLifecycleSchema = z.enum(["active", "ended"]);

/**
 * The Conversation head permits zero before its first TimelineItem. An
 * individual TimelineItem sequence remains positive and is defined by the
 * timeline contract.
 */
export const inboxV2ConversationSequenceHeadSchema = z
  .string()
  .max(postgresBigintMax.length)
  .regex(canonicalNonNegativeDecimalPattern)
  .refine(isPostgresBigint, {
    message: "Conversation sequence head exceeds PostgreSQL bigint range."
  })
  .transform((value) => value as InboxV2ConversationSequenceHead);

const inboxV2ConversationActivityTimelineSequenceSchema =
  inboxV2EntityRevisionSchema.transform(
    (value) => value as unknown as InboxV2TimelineSequence
  );

/**
 * A lifecycle change is explicit and advances Conversation revision exactly
 * once. Same-state idempotent commands are no-ops and do not form a transition.
 */
export const inboxV2ConversationLifecycleTransitionSchema = z
  .discriminatedUnion("intent", [
    z
      .object({
        intent: z.literal("end"),
        fromLifecycle: z.literal("active"),
        toLifecycle: z.literal("ended"),
        expectedRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        intent: z.literal("reactivate"),
        fromLifecycle: z.literal("ended"),
        toLifecycle: z.literal("active"),
        expectedRevision: inboxV2EntityRevisionSchema,
        resultingRevision: inboxV2EntityRevisionSchema
      })
      .strict()
  ])
  .superRefine((transition, context) => {
    if (
      BigInt(transition.resultingRevision) !==
      BigInt(transition.expectedRevision) + 1n
    ) {
      context.addIssue({
        code: "custom",
        path: ["resultingRevision"],
        message: "Conversation lifecycle transition must advance revision once."
      });
    }
  });

/**
 * Mutable timeline/activity state has its own CAS revision and timestamps.
 * Conversation metadata mutations must not advance this head, and timeline
 * allocation must not advance the parent Conversation entity revision.
 */
export const inboxV2ConversationHeadSchema = z
  .object({
    latestTimelineSequence: inboxV2ConversationSequenceHeadSchema,
    latestActivityItemId: inboxV2TimelineItemIdSchema.nullable(),
    latestActivityTimelineSequence:
      inboxV2ConversationActivityTimelineSequenceSchema.nullable(),
    latestActivityAt: inboxV2TimestampSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    if (!isInboxV2TimestampOrderValid(head.createdAt, head.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Conversation head updatedAt cannot precede createdAt."
      });
    }
    const activityHeadParts = [
      head.latestActivityItemId,
      head.latestActivityTimelineSequence,
      head.latestActivityAt
    ];
    const populatedActivityHeadParts = activityHeadParts.filter(
      (part) => part !== null
    ).length;
    if (
      (populatedActivityHeadParts !== 0 && populatedActivityHeadParts !== 3) ||
      (head.latestActivityTimelineSequence !== null &&
        BigInt(head.latestActivityTimelineSequence) >
          BigInt(head.latestTimelineSequence))
    ) {
      context.addIssue({
        code: "custom",
        path: ["latestActivityItemId"],
        message:
          "Conversation activity head is an all-or-none item/sequence/time triple within the timeline tail."
      });
    }
  });

export const inboxV2ConversationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ConversationIdSchema,
    topology: inboxV2ConversationTopologySchema,
    transport: inboxV2ConversationTransportSchema,
    purposeId: inboxV2ConversationPurposeIdSchema,
    lifecycle: inboxV2ConversationLifecycleSchema,
    head: inboxV2ConversationHeadSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((conversation, context) => {
    if (
      !isInboxV2TimestampOrderValid(
        conversation.createdAt,
        conversation.updatedAt
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "Conversation updatedAt cannot precede createdAt."
      });
    }
  });

export const inboxV2ConversationEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_SCHEMA_ID,
    INBOX_V2_CONVERSATION_SCHEMA_VERSION,
    inboxV2ConversationSchema
  );

export type InboxV2ConversationTopology = z.infer<
  typeof inboxV2ConversationTopologySchema
>;
export type InboxV2ConversationTransport = z.infer<
  typeof inboxV2ConversationTransportSchema
>;
export type InboxV2ConversationLifecycle = z.infer<
  typeof inboxV2ConversationLifecycleSchema
>;
export type InboxV2ConversationLifecycleTransition = z.infer<
  typeof inboxV2ConversationLifecycleTransitionSchema
>;
export type InboxV2ConversationHead = z.infer<
  typeof inboxV2ConversationHeadSchema
>;
export type InboxV2Conversation = z.infer<typeof inboxV2ConversationSchema>;
export type InboxV2ConversationEnvelope = z.infer<
  typeof inboxV2ConversationEnvelopeSchema
>;

function isPostgresBigint(value: string): boolean {
  return (
    value.length < postgresBigintMax.length ||
    (value.length === postgresBigintMax.length && value <= postgresBigintMax)
  );
}
