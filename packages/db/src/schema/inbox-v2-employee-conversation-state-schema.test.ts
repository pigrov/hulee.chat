import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL,
  inboxV2EmployeeConversationNotificationLevel,
  inboxV2EmployeeConversationStates
} from "./inbox-v2/employee-conversation-state";
import { initialTables } from "./metadata";
import { employees, inboxV2Conversations } from "./tables";

describe("Inbox V2 EmployeeConversationState persistence schema", () => {
  it("registers one sparse tenant-owned state table with a closed level enum", () => {
    const config = getTableConfig(inboxV2EmployeeConversationStates);

    expect(config.name).toBe("inbox_v2_employee_conversation_states");
    expect(config.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "employee_id",
      "conversation_id",
      "last_read_sequence",
      "last_read_at",
      "manual_unread",
      "manual_unread_changed_at",
      "muted",
      "mute_changed_at",
      "notification_level",
      "notification_level_changed_at",
      "pinned",
      "pin_changed_at",
      "archived",
      "archive_changed_at",
      "revision",
      "last_changed_stream_position",
      "created_at",
      "updated_at"
    ]);
    expect(inboxV2EmployeeConversationNotificationLevel.enumValues).toEqual([
      "inherit",
      "all",
      "mentions_only",
      "none"
    ]);
    expect(
      initialTables.find(
        (table) => table.name === "inbox_v2_employee_conversation_states"
      )
    ).toEqual({
      name: "inbox_v2_employee_conversation_states",
      scope: "tenant",
      requiresTenantId: true
    });
  });

  it("keys personal state by tenant, employee and Conversation", () => {
    const config = getTableConfig(inboxV2EmployeeConversationStates);

    expect(
      config.primaryKeys.map((primaryKey) =>
        primaryKey.columns.map((column) => column.name)
      )
    ).toEqual([["tenant_id", "employee_id", "conversation_id"]]);
    expectForeignKey(
      "inbox_v2_employee_conversation_states_employee_fk",
      employees,
      ["tenant_id", "employee_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      "inbox_v2_employee_conversation_states_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
  });

  it("keeps every operational index tenant-leading and covers reverse/sync access", () => {
    const config = getTableConfig(inboxV2EmployeeConversationStates);
    const indexes = new Map(
      config.indexes.map((index) => [index.config.name, index.config])
    );

    for (const index of config.indexes) {
      expect(indexColumnName(index.config.columns[0])).toBe("tenant_id");
    }
    expect(
      indexColumnNames(
        indexes.get("inbox_v2_employee_conversation_states_conversation_idx")
      )
    ).toEqual(["tenant_id", "conversation_id", "employee_id"]);
    expect(
      indexColumnNames(
        indexes.get("inbox_v2_employee_conversation_states_sync_idx")
      )
    ).toEqual([
      "tenant_id",
      "employee_id",
      "last_changed_stream_position",
      "conversation_id"
    ]);
    expect(
      new PgDialect().sqlToQuery(
        indexes.get("inbox_v2_employee_conversation_states_pinned_idx")!.where!
      ).sql
    ).toContain("pinned");
    expect(
      new PgDialect().sqlToQuery(
        indexes.get("inbox_v2_employee_conversation_states_archived_idx")!
          .where!
      ).sql
    ).toContain("archived");
  });

  it("declares cursor, revision and bounded timestamp checks", () => {
    const config = getTableConfig(inboxV2EmployeeConversationStates);

    expect(config.checks.map((constraint) => constraint.name)).toEqual(
      expect.arrayContaining([
        "inbox_v2_employee_conversation_states_read_check",
        "inbox_v2_employee_conversation_states_revision_check",
        "inbox_v2_employee_conversation_states_timestamps_check"
      ])
    );
    expect(
      checkSql(config, "inbox_v2_employee_conversation_states_read_check")
    ).toContain("last_read_sequence");
    expect(
      checkSql(config, "inbox_v2_employee_conversation_states_revision_check")
    ).toContain("last_changed_stream_position");
    expect(
      checkSql(config, "inbox_v2_employee_conversation_states_timestamps_check")
    ).toContain("isfinite");
  });

  it("publishes DB guards for monotonic reads and exact TimelineItem ownership", () => {
    const normalized =
      INBOX_V2_EMPLOYEE_CONVERSATION_STATE_INVARIANTS_SQL.replace(
        /\s+/gu,
        " "
      ).trim();

    expect(normalized).toContain(
      "new.last_read_sequence < old.last_read_sequence"
    );
    expect(normalized).toContain("new.revision <> old.revision + 1");
    expect(normalized).toContain(
      "new.last_changed_stream_position <= old.last_changed_stream_position"
    );
    expect(normalized).toContain(
      "timeline_item.timeline_sequence = new.last_read_sequence"
    );
    expect(normalized).toContain(
      "timeline_item.conversation_id = new.conversation_id"
    );
    expect(normalized).toContain("deferrable initially deferred");
    expect(normalized).not.toContain("provider_receipt");
  });
});

function expectForeignKey(
  name: string,
  foreignTable: object,
  columns: readonly string[],
  foreignColumns: readonly string[]
): void {
  const config = getTableConfig(inboxV2EmployeeConversationStates);
  const reference = config.foreignKeys
    .find((foreignKey) => foreignKey.getName() === name)
    ?.reference();

  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns
  );
}

function indexColumnNames(
  config:
    | ReturnType<typeof getTableConfig>["indexes"][number]["config"]
    | undefined
): (string | undefined)[] {
  if (!config) throw new Error("Missing expected index.");
  return config.columns.map(indexColumnName);
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in column && typeof column.name === "string"
    ? column.name
    : undefined;
}

function checkSql(
  config: ReturnType<typeof getTableConfig>,
  name: string
): string {
  const constraint = config.checks.find((candidate) => candidate.name === name);
  if (!constraint)
    throw new Error(`Missing expected check constraint: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}
