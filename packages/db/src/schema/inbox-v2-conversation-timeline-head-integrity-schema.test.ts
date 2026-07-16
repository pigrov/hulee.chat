import { describe, expect, it } from "vitest";

import { INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL } from "./inbox-v2/conversation-timeline-head-integrity";

describe("Inbox V2 Conversation timeline-head integrity SQL", () => {
  it("owns fixed-search-path assertion and trigger functions", () => {
    for (const functionName of [
      "inbox_v2_assert_conversation_timeline_head",
      "inbox_v2_lock_conversation_identity",
      "inbox_v2_conversation_timeline_head_deferred",
      "inbox_v2_conversation_insert_guard",
      "inbox_v2_conversation_update_guard",
      "inbox_v2_conversation_delete_guard",
      "inbox_v2_conversation_identity_fence_guard",
      "inbox_v2_conversation_head_insert_guard",
      "inbox_v2_conversation_head_update_guard",
      "inbox_v2_conversation_head_delete_guard",
      "inbox_v2_conversation_timeline_truncate_guard"
    ]) {
      expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toMatch(
        new RegExp(
          `create or replace function public\\.${functionName}\\([\\s\\S]*?set search_path = pg_catalog, public, pg_temp`,
          "s"
        )
      );
    }
  });

  it("rejects direct and cascaded truncation of every invariant-owned relation", () => {
    for (const [tableName, triggerName] of [
      [
        "inbox_v2_conversations",
        "inbox_v2_conversations_truncate_guard_trigger"
      ],
      [
        "inbox_v2_conversation_heads",
        "inbox_v2_conversation_heads_truncate_guard_trigger"
      ],
      [
        "inbox_v2_timeline_items",
        "inbox_v2_timeline_items_truncate_guard_trigger"
      ],
      [
        "inbox_v2_conversation_identity_fences",
        "inbox_v2_conversation_identity_fences_truncate_guard_trigger"
      ]
    ]) {
      expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
        `create trigger ${triggerName}\nbefore truncate on public.${tableName}\nfor each statement execute function public.inbox_v2_conversation_timeline_truncate_guard();`
      );
    }
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_timeline_truncate_forbidden'"
    );
  });

  it("requires one exact Head and the persisted timeline/activity tail", () => {
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toMatch(
      /conversation_count = 0[\s\S]*conversation_timeline_head_orphaned/
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "head_row.latest_timeline_sequence = coalesce(("
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "inserted_count <> new_sequence - old_sequence"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_timeline_range_noncontiguous'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "and item_row.activity_kind = 'eligible'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_timeline_head_coherence'"
    );
  });

  it("uses deferred checks for atomic aggregate writes and immediate monotonic guards", () => {
    for (const triggerName of [
      "inbox_v2_conversation_identity_fence_coherence_trigger",
      "inbox_v2_conversations_timeline_head_constraint_trigger",
      "inbox_v2_conversation_heads_timeline_constraint_trigger"
    ]) {
      expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toMatch(
        new RegExp(
          `create constraint trigger ${triggerName}[\\s\\S]*?deferrable initially deferred`,
          "s"
        )
      );
    }

    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "new.revision <= old.revision"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "new.last_changed_stream_position <= old.last_changed_stream_position"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "new.latest_timeline_sequence < old.latest_timeline_sequence"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_identity_retired'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_timeline_head_delete_forbidden'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_identity_reused'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_identity_fence_immutable'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "message = 'inbox_v2.conversation_identity_fence_source_invalid'"
    );
    expect(INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL).toContain(
      "pg_catalog.pg_advisory_xact_lock("
    );
  });

  it("keeps every trigger name within PostgreSQL's 63-byte identifier limit", () => {
    const triggerNames = Array.from(
      INBOX_V2_CONVERSATION_TIMELINE_HEAD_INTEGRITY_SQL.matchAll(
        /create (?:constraint )?trigger ([a-z0-9_]+)/gu
      ),
      (match) => match[1] ?? ""
    );
    expect(triggerNames.length).toBeGreaterThan(0);
    for (const triggerName of triggerNames) {
      expect(triggerName.length, triggerName).toBeLessThanOrEqual(63);
    }
  });
});
