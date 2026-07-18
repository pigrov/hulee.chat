import { createHash } from "node:crypto";

import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildLockInboxV2OutboundReplyAuthorityConversationSql,
  buildLockInboxV2OutboundReplyAuthorityWorkHeadSql,
  buildLockInboxV2OutboundReplyAuthoritySlotSql,
  evaluateInboxV2NoWorkItemReplyAuthorityHeadFence,
  evaluateInboxV2NoWorkItemReplyAuthorityFence,
  fenceInboxV2OutboundReplyAuthorityInTransaction,
  type InboxV2OutboundReplyAuthoritySlotRow,
  type InboxV2OutboundReplyAuthorityWorkHeadRow
} from "./sql-inbox-v2-outbound-reply-authority-repository";

const tenantId = "tenant:msg002-reply-fence";
const conversationId = "conversation:msg002-reply-fence";
const slotId = "conversation_work_item_slot:msg002-reply-fence";

describe("SQL Inbox V2 outbound reply-authority fence", () => {
  it("locks the Conversation before its Work head and WorkItem slot", () => {
    const conversationQuery = new PgDialect().sqlToQuery(
      buildLockInboxV2OutboundReplyAuthorityConversationSql({
        tenantId,
        conversationId
      })
    );
    expect(conversationQuery.sql.replace(/\s+/gu, " ").trim()).toBe(
      "select tenant_id, id from inbox_v2_conversations where tenant_id = $1 and id = $2 for no key update"
    );
    expect(conversationQuery.params).toEqual([tenantId, conversationId]);

    const query = new PgDialect().sqlToQuery(
      buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
        tenantId,
        conversationId
      })
    );

    expect(query.sql.replace(/\s+/gu, " ").trim()).toBe(
      "select tenant_id, id, conversation_id, work_item_count, current_outcome, intake_decision_high_water, pending_materialization_ordinal, revision from inbox_v2_conversation_work_heads where tenant_id = $1 and conversation_id = $2 for update"
    );
    expect(query.params).toEqual([tenantId, conversationId]);
  });

  it("locks the exact tenant-scoped WorkItem slot before evaluating absence", () => {
    const query = new PgDialect().sqlToQuery(
      buildLockInboxV2OutboundReplyAuthoritySlotSql({ tenantId, slotId })
    );

    expect(query.sql.replace(/\s+/gu, " ").trim()).toBe(
      "select tenant_id, id, conversation_id, latest_ordinal, latest_work_item_id, latest_lifecycle_class, latest_lifecycle_fence_revision, current_non_terminal_work_item_id, current_non_terminal_ordinal, revision from inbox_v2_conversation_work_item_slots where tenant_id = $1 and id = $2 for update"
    );
    expect(query.params).toEqual([tenantId, slotId]);
  });

  it("commits only the exact current empty slot snapshot", () => {
    expect(
      evaluateInboxV2NoWorkItemReplyAuthorityFence({
        tenantId,
        conversationId,
        slotId,
        expectedSlotRevision: "3",
        row: slotRow()
      })
    ).toEqual({ kind: "committed", authorityKind: "no_work_item" });
  });

  it("commits only an explicit current no-work intake decision", () => {
    expect(
      evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
        tenantId,
        conversationId,
        expectedIntakeDecisionRevision: "1",
        row: workHeadRow({
          current_outcome: "no_work_item",
          intake_decision_high_water: 1n,
          revision: 2n
        })
      })
    ).toEqual({ kind: "committed", authorityKind: "no_work_item" });
  });

  it.each([
    [workHeadRow(), "1", "work_intake_not_no_work"],
    [
      workHeadRow({
        current_outcome: "create_work_item",
        intake_decision_high_water: 1n,
        revision: 2n
      }),
      "1",
      "work_intake_not_no_work"
    ],
    [
      workHeadRow({
        current_outcome: "no_work_item",
        intake_decision_high_water: 1n,
        pending_materialization_ordinal: 1n,
        revision: 2n
      }),
      "1",
      "work_intake_not_no_work"
    ],
    [
      workHeadRow({
        current_outcome: "no_work_item",
        intake_decision_high_water: 1n,
        revision: 2n
      }),
      "2",
      "intake_decision_stale"
    ],
    [
      workHeadRow({
        current_outcome: "no_work_item",
        intake_decision_high_water: 1n,
        revision: 3n
      }),
      "1",
      "work_head_revision_stale"
    ]
  ] as const)(
    "rejects a pending, flipped, stale, or incoherent Work head",
    (row, expectedIntakeDecisionRevision, reason) => {
      expect(
        evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision,
          row
        })
      ).toEqual({ kind: "rejected", reason });
    }
  );

  it.each([
    [null, "slot_not_found"],
    [
      slotRow({ conversation_id: "conversation:other" }),
      "slot_identity_mismatch"
    ],
    [slotRow({ revision: 4n }), "slot_revision_stale"],
    [
      slotRow({
        current_non_terminal_work_item_id: "work_item:current",
        current_non_terminal_ordinal: 1n
      }),
      "work_item_present"
    ],
    [
      slotRow({
        latest_ordinal: 1n,
        latest_work_item_id: "work_item:terminal",
        latest_lifecycle_class: "terminal",
        latest_lifecycle_fence_revision: 2n
      }),
      "work_item_present"
    ]
  ] as const)("rejects a stale absence proof as %s", (row, reason) => {
    expect(
      evaluateInboxV2NoWorkItemReplyAuthorityFence({
        tenantId,
        conversationId,
        slotId,
        expectedSlotRevision: "3",
        row
      })
    ).toEqual({ kind: "rejected", reason });
  });

  it("rejects a structurally forged transaction context before SQL", async () => {
    const execute = vi.fn();
    await expect(
      fenceInboxV2OutboundReplyAuthorityInTransaction(
        {
          executor: { execute },
          atomicMaterializationToken: {},
          tenantId,
          commandId: "command:forged",
          clientMutationId: "mutation:forged",
          commandTypeId: "core:message.send",
          actor: {
            kind: "trusted_service",
            trustedServiceId: "core:test-service"
          },
          authorizationEpoch: "authorization:forged",
          authorizationDecisionId: "authorization-decision:forged",
          authorizationDecisionRefs: [],
          authorizationResourceRevisionFences: [],
          authorizedAt: "2026-07-18T09:00:00.000Z",
          occurredAt: "2026-07-18T09:00:00.000Z",
          mutationId: "authorization-mutation:forged",
          profile: "domain",
          revisionEffects: []
        } as never,
        {
          tenantId,
          conversationId,
          replyAuthority: {
            kind: "no_work_item",
            appActor: {
              kind: "trusted_service",
              trustedServiceId: "core:test-service"
            },
            conversation: {
              tenantId,
              kind: "conversation",
              id: conversationId
            },
            workItemSlot: {
              tenantId,
              kind: "conversation_work_item_slot",
              id: slotId
            },
            expectedSlotRevision: "3",
            intakeDecisionRevision: "1"
          }
        }
      )
    ).rejects.toThrow("live authorized-command context");
    expect(execute).not.toHaveBeenCalled();
  });
});

function slotRow(
  overrides: Partial<InboxV2OutboundReplyAuthoritySlotRow> = {}
): InboxV2OutboundReplyAuthoritySlotRow {
  return {
    tenant_id: tenantId,
    id: slotId,
    conversation_id: conversationId,
    latest_ordinal: 0n,
    latest_work_item_id: null,
    latest_lifecycle_class: null,
    latest_lifecycle_fence_revision: null,
    current_non_terminal_work_item_id: null,
    current_non_terminal_ordinal: null,
    revision: 3n,
    ...overrides
  };
}

function workHeadRow(
  overrides: Partial<InboxV2OutboundReplyAuthorityWorkHeadRow> = {}
): InboxV2OutboundReplyAuthorityWorkHeadRow {
  return {
    tenant_id: tenantId,
    id: `conversation_work_head:${createHash("sha256")
      .update(`${tenantId}\u001f${conversationId}`, "utf8")
      .digest("hex")}`,
    conversation_id: conversationId,
    work_item_count: 0n,
    current_outcome: "pending_intake",
    intake_decision_high_water: 0n,
    pending_materialization_ordinal: null,
    revision: 1n,
    ...overrides
  };
}
