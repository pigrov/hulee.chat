import { z } from "zod";

import { inboxV2ConversationSchema } from "./conversation";
import { inboxV2TimestampSchema } from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import { inboxV2TimelineItemSchema } from "./timeline";

/**
 * Internal bounded contiguous allocation under one exact Conversation-head
 * CAS. Conversation entity metadata remains unchanged.
 *
 * This is deliberately not exported from the package public boundary and has
 * no schema envelope: it cannot materialize a Timeline subject on its own.
 * A typed owning-domain commit (Message, StaffNote, etc.) must embed it and
 * prove the referenced subject in the same atomic write.
 */
export const inboxV2TimelineSequenceAllocationSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    conversationBefore: inboxV2ConversationSchema,
    items: z.array(inboxV2TimelineItemSchema).min(1).max(1_000),
    conversationAfter: inboxV2ConversationSchema,
    committedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((allocation, context) => {
    const { conversationBefore: before, conversationAfter: after } = allocation;
    const beforeHead = before.head;
    const afterHead = after.head;
    if (
      allocation.tenantId !== before.tenantId ||
      allocation.tenantId !== after.tenantId ||
      before.id !== after.id ||
      before.topology !== after.topology ||
      before.transport !== after.transport ||
      before.purposeId !== after.purposeId ||
      before.lifecycle !== after.lifecycle ||
      before.createdAt !== after.createdAt ||
      before.revision !== after.revision ||
      before.updatedAt !== after.updatedAt ||
      beforeHead.createdAt !== afterHead.createdAt ||
      BigInt(afterHead.revision) !== BigInt(beforeHead.revision) + 1n ||
      afterHead.updatedAt !== allocation.committedAt
    ) {
      addIssue(
        context,
        ["conversationAfter", "head"],
        "Timeline allocation advances one exact Conversation head revision without mutating Conversation entity metadata."
      );
    }
    if (Date.parse(allocation.committedAt) < Date.parse(beforeHead.updatedAt)) {
      addIssue(
        context,
        ["committedAt"],
        "Timeline allocation cannot move the Conversation head clock backwards."
      );
    }

    const firstExpected = BigInt(beforeHead.latestTimelineSequence) + 1n;
    const itemIds = new Set<string>();
    for (const [index, item] of allocation.items.entries()) {
      if (
        item.tenantId !== allocation.tenantId ||
        item.conversation.id !== before.id ||
        BigInt(item.timelineSequence) !== firstExpected + BigInt(index) ||
        item.revision !== "1" ||
        item.createdAt !== allocation.committedAt ||
        itemIds.has(item.id)
      ) {
        addIssue(
          context,
          ["items", index],
          "Timeline creation allocates one contiguous initial sequence range."
        );
      }
      itemIds.add(item.id);
    }
    const expectedHead =
      BigInt(beforeHead.latestTimelineSequence) +
      BigInt(allocation.items.length);
    if (BigInt(afterHead.latestTimelineSequence) !== expectedHead) {
      addIssue(
        context,
        ["conversationAfter", "head", "latestTimelineSequence"],
        "Conversation head must equal the last committed timeline sequence."
      );
    }

    const latestEligible = [...allocation.items]
      .reverse()
      .find((item) => item.activity.kind === "eligible");
    const expectedActivityItemId =
      latestEligible?.id ?? beforeHead.latestActivityItemId;
    const expectedActivitySequence =
      latestEligible?.timelineSequence ??
      beforeHead.latestActivityTimelineSequence;
    const expectedActivityAt =
      latestEligible?.occurredAt ?? beforeHead.latestActivityAt;
    if (
      afterHead.latestActivityItemId !== expectedActivityItemId ||
      afterHead.latestActivityTimelineSequence !== expectedActivitySequence ||
      afterHead.latestActivityAt !== expectedActivityAt
    ) {
      addIssue(
        context,
        ["conversationAfter", "head", "latestActivityItemId"],
        "Only eligible live timeline items advance the separate operational activity head."
      );
    }
  });

export type InboxV2TimelineSequenceAllocation = z.infer<
  typeof inboxV2TimelineSequenceAllocationSchema
>;

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
