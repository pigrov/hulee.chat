import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  inboxV2ConversationHeads,
  inboxV2ConversationIdentityFences,
  inboxV2Conversations
} from "./tables";

describe("Inbox V2 Conversation persistence schema", () => {
  it("keeps Conversation and ConversationHead as separate tenant-owned boundaries", () => {
    const conversation = getTableConfig(inboxV2Conversations);
    const head = getTableConfig(inboxV2ConversationHeads);

    expect(conversation.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id",
      "topology",
      "transport",
      "purpose_id",
      "lifecycle",
      "revision",
      "last_changed_stream_position",
      "created_at",
      "updated_at"
    ]);
    expect(head.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "conversation_id",
      "latest_timeline_sequence",
      "latest_activity_item_id",
      "latest_activity_timeline_sequence",
      "latest_activity_at",
      "revision",
      "last_changed_stream_position",
      "created_at",
      "updated_at"
    ]);

    expect(primaryKeyColumns(conversation)).toEqual([["tenant_id", "id"]]);
    expect(primaryKeyColumns(head)).toEqual([["tenant_id", "conversation_id"]]);
  });

  it("enforces the same-tenant ConversationHead relation", () => {
    const head = getTableConfig(inboxV2ConversationHeads);
    const conversationForeignKey = head.foreignKeys
      .map((foreignKey) => foreignKey.reference())
      .find((reference) => reference.foreignTable === inboxV2Conversations);

    expect(
      conversationForeignKey?.columns.map((column) => column.name)
    ).toEqual(["tenant_id", "conversation_id"]);
    expect(
      conversationForeignKey?.foreignColumns.map((column) => column.name)
    ).toEqual(["tenant_id", "id"]);
  });

  it("retains a tenant-scoped canonical-ID fence after Conversation deletion", () => {
    const fence = getTableConfig(inboxV2ConversationIdentityFences);

    expect(fence.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "conversation_id",
      "retired_revision",
      "retired_stream_position",
      "retired_updated_at",
      "retired_at"
    ]);
    expect(primaryKeyColumns(fence)).toEqual([
      ["tenant_id", "conversation_id"]
    ]);
    expect(fence.foreignKeys).toHaveLength(1);
    expect(fence.indexes.map((tableIndex) => tableIndex.config.name)).toContain(
      "inbox_v2_conversation_identity_fences_tenant_retired_idx"
    );
    expect(
      checkSql(fence, "inbox_v2_conversation_identity_fences_values_check")
    ).toContain("isfinite");
  });

  it("keeps every tenant-owned access index tenant-leading", () => {
    for (const table of [
      inboxV2Conversations,
      inboxV2ConversationHeads,
      inboxV2ConversationIdentityFences
    ]) {
      const config = getTableConfig(table);

      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
        const firstColumn = tableIndex.config.columns[0];
        expect(indexColumnName(firstColumn)).toBe("tenant_id");
      }
    }
  });

  it("declares revision, stream, timestamp, purpose and activity constraints", () => {
    const conversationConfig = getTableConfig(inboxV2Conversations);
    const headConfig = getTableConfig(inboxV2ConversationHeads);
    const conversationChecks = conversationConfig.checks.map(
      (constraint) => constraint.name
    );
    const headChecks = headConfig.checks.map((constraint) => constraint.name);

    expect(conversationChecks).toEqual(
      expect.arrayContaining([
        "inbox_v2_conversations_purpose_format_check",
        "inbox_v2_conversations_revision_check",
        "inbox_v2_conversations_stream_position_check",
        "inbox_v2_conversations_timestamps_check"
      ])
    );
    expect(headChecks).toEqual(
      expect.arrayContaining([
        "inbox_v2_conversation_heads_timeline_sequence_check",
        "inbox_v2_conversation_heads_activity_tuple_check",
        "inbox_v2_conversation_heads_activity_sequence_check",
        "inbox_v2_conversation_heads_revision_check",
        "inbox_v2_conversation_heads_stream_position_check",
        "inbox_v2_conversation_heads_timestamps_check"
      ])
    );

    const purposeCheck = checkSql(
      conversationConfig,
      "inbox_v2_conversations_purpose_format_check"
    );
    expect(purposeCheck).toContain("split_part");
    expect(purposeCheck).toContain("<= 80");
    expect(purposeCheck).toContain("<= 160");

    expect(
      checkSql(conversationConfig, "inbox_v2_conversations_timestamps_check")
    ).toContain("isfinite");
    expect(
      checkSql(headConfig, "inbox_v2_conversation_heads_timestamps_check")
    ).toContain("isfinite");
  });
});

function primaryKeyColumns(
  config: ReturnType<typeof getTableConfig>
): string[][] {
  return config.primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  if ("name" in column && typeof column.name === "string") {
    return column.name;
  }

  return undefined;
}

function checkSql(
  config: ReturnType<typeof getTableConfig>,
  name: string
): string {
  const constraint = config.checks.find((candidate) => candidate.name === name);

  if (!constraint) {
    throw new Error(`Missing expected check constraint: ${name}`);
  }

  return new PgDialect().sqlToQuery(constraint.value).sql;
}
