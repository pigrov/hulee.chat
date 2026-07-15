import { z } from "zod";

import {
  inboxV2ConversationSequenceHeadSchema,
  type InboxV2ConversationSequenceHead
} from "./conversation";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2TenantIdSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";

export const INBOX_V2_EMPLOYEE_CONVERSATION_STATE_SCHEMA_ID =
  "core:inbox-v2.employee-conversation-state" as const;
export const INBOX_V2_EMPLOYEE_CONVERSATION_STATE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

/**
 * Conversation-specific override. `inherit` delegates to the employee's
 * tenant/device policy; mute remains an independent hard suppression marker.
 */
export const inboxV2EmployeeConversationNotificationLevelSchema = z.enum([
  "inherit",
  "all",
  "mentions_only",
  "none"
]);

/**
 * Personal state is deliberately separate from Conversation lifecycle and
 * provider delivery/read receipts. One row is created lazily per employee and
 * Conversation.
 */
export const inboxV2EmployeeConversationStateSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    employee: inboxV2EmployeeReferenceSchema,
    conversation: inboxV2ConversationReferenceSchema,
    lastReadSequence: inboxV2ConversationSequenceHeadSchema,
    lastReadAt: inboxV2TimestampSchema.nullable(),
    manualUnread: z.boolean(),
    manualUnreadChangedAt: inboxV2TimestampSchema,
    muted: z.boolean(),
    muteChangedAt: inboxV2TimestampSchema,
    notificationLevel: inboxV2EmployeeConversationNotificationLevelSchema,
    notificationLevelChangedAt: inboxV2TimestampSchema,
    pinned: z.boolean(),
    pinChangedAt: inboxV2TimestampSchema,
    archived: z.boolean(),
    archiveChangedAt: inboxV2TimestampSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((state, context) => {
    if (
      state.employee.tenantId !== state.tenantId ||
      state.conversation.tenantId !== state.tenantId
    ) {
      context.addIssue({
        code: "custom",
        path: ["tenantId"],
        message:
          "EmployeeConversationState references must belong to its tenant."
      });
    }

    if (!isInboxV2TimestampOrderValid(state.createdAt, state.updatedAt)) {
      context.addIssue({
        code: "custom",
        path: ["updatedAt"],
        message: "EmployeeConversationState updatedAt cannot precede createdAt."
      });
    }

    const hasReadCursor = BigInt(state.lastReadSequence) > 0n;
    if (hasReadCursor !== (state.lastReadAt !== null)) {
      context.addIssue({
        code: "custom",
        path: ["lastReadAt"],
        message:
          "A positive last-read sequence requires lastReadAt; sequence zero forbids it."
      });
    }

    for (const [field, value] of [
      ["lastReadAt", state.lastReadAt],
      ["manualUnreadChangedAt", state.manualUnreadChangedAt],
      ["muteChangedAt", state.muteChangedAt],
      ["notificationLevelChangedAt", state.notificationLevelChangedAt],
      ["pinChangedAt", state.pinChangedAt],
      ["archiveChangedAt", state.archiveChangedAt]
    ] as const) {
      if (
        value !== null &&
        (!isInboxV2TimestampOrderValid(state.createdAt, value) ||
          !isInboxV2TimestampOrderValid(value, state.updatedAt))
      ) {
        context.addIssue({
          code: "custom",
          path: [field],
          message: `${field} must fall within the state lifetime.`
        });
      }
    }
  });

export const inboxV2EmployeeConversationStateEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_EMPLOYEE_CONVERSATION_STATE_SCHEMA_ID,
    INBOX_V2_EMPLOYEE_CONVERSATION_STATE_SCHEMA_VERSION,
    inboxV2EmployeeConversationStateSchema
  );

export type InboxV2EmployeeConversationNotificationLevel = z.infer<
  typeof inboxV2EmployeeConversationNotificationLevelSchema
>;
export type InboxV2EmployeeConversationState = z.infer<
  typeof inboxV2EmployeeConversationStateSchema
>;
export type InboxV2EmployeeConversationStateEnvelope = z.infer<
  typeof inboxV2EmployeeConversationStateEnvelopeSchema
>;

export function compareInboxV2EmployeeReadSequence(
  left: InboxV2ConversationSequenceHead,
  right: InboxV2ConversationSequenceHead
): -1 | 0 | 1 {
  const leftValue = BigInt(left);
  const rightValue = BigInt(right);

  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0;
}
