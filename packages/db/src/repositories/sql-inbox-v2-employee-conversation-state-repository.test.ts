import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineSequenceSchema
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildAdvanceInboxV2EmployeeConversationReadSql,
  buildCompareAndSetInboxV2EmployeeConversationPreferencesSql,
  buildLockInboxV2EmployeeConversationStateKeySql,
  buildValidateInboxV2EmployeeConversationReadTargetSql,
  createSqlInboxV2EmployeeConversationStateRepository,
  InboxV2EmployeeConversationStatePersistenceInvariantError,
  type InboxV2EmployeeConversationStateTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-employee-conversation-state-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:employee-state");
const employeeId = inboxV2EmployeeIdSchema.parse("employee:employee-state");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:employee-state"
);
const createdAt = "2026-07-15T08:00:00.000Z";
const changedAt = "2026-07-15T08:05:00.000Z";

describe("SQL Inbox V2 EmployeeConversationState repository", () => {
  it("uses a state-key mutex, exact TimelineItem validation and GREATEST", () => {
    const lock = render(buildLockInboxV2EmployeeConversationStateKeySql(key()));
    const validation = render(
      buildValidateInboxV2EmployeeConversationReadTargetSql({
        ...key(),
        sequence: sequence("100")
      })
    );
    const read = render(
      buildAdvanceInboxV2EmployeeConversationReadSql({
        ...key(),
        sequence: sequence("100"),
        expectedRevision: revision("3"),
        resultingRevision: revision("4"),
        streamPosition: streamPosition("11"),
        changedAt
      })
    );

    expect(lock.sql).toContain("pg_advisory_xact_lock");
    expect(lock.params.join("|")).toContain(String(employeeId));
    expect(lock.params.join("|")).not.toContain("\u0000");
    expect(validation.sql).toContain("inbox_v2_timeline_items");
    expect(validation.sql).toContain("timeline_item.conversation_id");
    expect(validation.sql).toContain("timeline_item.timeline_sequence");
    expect(validation.sql).toContain(
      "for key share of employee, conversation, timeline_item"
    );
    expect(read.sql).toContain(
      "last_read_sequence = greatest(last_read_sequence,"
    );
    expect(read.sql).toContain("and last_read_sequence <");
    expect(read.sql).not.toContain("manual_unread =");
    expect(read.sql).not.toContain("notification_level =");
  });

  it("maps a tenant-scoped state without bigint precision loss", async () => {
    const executor = new ScriptedExecutor([[stateRow()]]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);

    const record = await repository.find(key());

    expect(record?.state).toMatchObject({
      tenantId,
      lastReadSequence: "100",
      manualUnread: true,
      muted: false,
      notificationLevel: "mentions_only",
      pinned: false,
      archived: false,
      revision: "3"
    });
    expect(record?.lastChangedStreamPosition).toBe("10");
  });

  it("treats a lower multi-device cursor as a true no-op", async () => {
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [stateRow()]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn();

    const result = await repository.markReadThrough(
      { ...key(), sequence: sequence("80"), changedAt },
      commit
    );

    expect(result.kind).toBe("already_applied");
    if (result.kind === "already_applied") {
      expect(result.record.state.lastReadSequence).toBe("100");
      expect(result.record.state.revision).toBe("3");
      expect(result.record.lastChangedStreamPosition).toBe("10");
    }
    expect(commit).not.toHaveBeenCalled();
    expect(executor.queries).toHaveLength(3);
  });

  it("advances read state once without clearing manual unread", async () => {
    const current = stateRow({
      last_read_sequence: "80",
      manual_unread: true
    });
    const advanced = stateRow({
      last_read_sequence: "100",
      last_read_at: changedAt,
      manual_unread: true,
      revision: "4",
      last_changed_stream_position: "11",
      updated_at: changedAt
    });
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [current],
      [advanced]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn(async ({ executor: transaction }) => {
      expect(transaction).toBe(executor);
      return { streamPosition: streamPosition("11"), result: "event:read" };
    });

    const result = await repository.markReadThrough(
      { ...key(), sequence: sequence("100"), changedAt },
      commit
    );

    expect(result.kind).toBe("advanced");
    if (result.kind === "advanced") {
      expect(result.record.state.lastReadSequence).toBe("100");
      expect(result.record.state.manualUnread).toBe(true);
      expect(result.record.state.revision).toBe("4");
      expect(result.result).toBe("event:read");
    }
    expect(commit).toHaveBeenCalledWith(
      expect.objectContaining({
        requestedSequence: "100",
        resultingRevision: "4",
        changedAt
      })
    );
  });

  it("does not allocate a commit for a missing or wrong-conversation sequence", async () => {
    const executor = new ScriptedExecutor([[{ found: true }], []]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn();

    await expect(
      repository.markReadThrough(
        { ...key(), sequence: sequence("101"), changedAt },
        commit
      )
    ).resolves.toEqual({ kind: "not_found" });
    expect(commit).not.toHaveBeenCalled();
  });

  it("keeps a default preference no-op sparse", async () => {
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      []
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn();

    const result = await repository.compareAndSetPreferences(
      {
        ...key(),
        expectedRevision: null,
        patch: { muted: false },
        changedAt
      },
      commit
    );

    expect(result).toEqual({ kind: "already_applied", record: null });
    expect(commit).not.toHaveBeenCalled();
  });

  it("returns an idempotent no-op before reporting a stale preference revision", async () => {
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [stateRow({ pinned: true })]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn();

    const result = await repository.compareAndSetPreferences(
      {
        ...key(),
        expectedRevision: revision("1"),
        patch: { pinned: true },
        changedAt
      },
      commit
    );

    expect(result.kind).toBe("already_applied");
    expect(commit).not.toHaveBeenCalled();
  });

  it("rejects a genuinely stale preference CAS", async () => {
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [stateRow({ pinned: false })]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);
    const commit = vi.fn();

    const result = await repository.compareAndSetPreferences(
      {
        ...key(),
        expectedRevision: revision("2"),
        patch: { pinned: true },
        changedAt
      },
      commit
    );

    expect(result.kind).toBe("revision_conflict");
    if (result.kind === "revision_conflict") {
      expect(result.record.state.revision).toBe("3");
    }
    expect(commit).not.toHaveBeenCalled();
  });

  it("updates only explicit preferences and preserves read state", async () => {
    const current = stateRow({ pinned: false });
    const updated = stateRow({
      pinned: true,
      pin_changed_at: changedAt,
      revision: "4",
      last_changed_stream_position: "11",
      updated_at: changedAt
    });
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [current],
      [updated]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);

    const result = await repository.compareAndSetPreferences(
      {
        ...key(),
        expectedRevision: revision("3"),
        patch: { pinned: true },
        changedAt
      },
      async () => ({
        streamPosition: streamPosition("11"),
        result: "event:pin"
      })
    );

    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.record.state.pinned).toBe(true);
      expect(result.record.state.lastReadSequence).toBe("100");
      expect(result.record.state.manualUnread).toBe(true);
      expect(result.record.state.manualUnreadChangedAt).toBe(createdAt);
      expect(result.result).toBe("event:pin");
    }

    const update = render(executor.queries.at(-1)!);
    expect(update.sql).not.toContain("last_read_sequence =");
    expect(update.sql).toContain("pin_changed_at = case");
  });

  it("creates a sparse preference row at revision one", async () => {
    const inserted = stateRow({
      last_read_sequence: "0",
      last_read_at: null,
      manual_unread: false,
      notification_level: "inherit",
      pinned: true,
      revision: "1",
      last_changed_stream_position: "1",
      created_at: changedAt,
      updated_at: changedAt,
      manual_unread_changed_at: changedAt,
      mute_changed_at: changedAt,
      notification_level_changed_at: changedAt,
      pin_changed_at: changedAt,
      archive_changed_at: changedAt
    });
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [],
      [inserted]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);

    const result = await repository.compareAndSetPreferences(
      {
        ...key(),
        expectedRevision: null,
        patch: { pinned: true },
        changedAt
      },
      async (context) => {
        expect(context.resultingRevision).toBe("1");
        expect(context.current).toBeNull();
        return {
          streamPosition: streamPosition("1"),
          result: "event:first-pin"
        };
      }
    );

    expect(result.kind).toBe("updated");
    if (result.kind === "updated") {
      expect(result.record.state.lastReadSequence).toBe("0");
      expect(result.record.state.pinned).toBe(true);
      expect(result.record.state.revision).toBe("1");
    }
  });

  it("rolls back a callback that returns a non-increasing stream position", async () => {
    const executor = new ScriptedExecutor([
      [{ found: true }],
      [{ found: true }],
      [stateRow()]
    ]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);

    await expect(
      repository.compareAndSetPreferences(
        {
          ...key(),
          expectedRevision: revision("3"),
          patch: { archived: true },
          changedAt
        },
        async () => ({ streamPosition: streamPosition("10"), result: null })
      )
    ).rejects.toMatchObject({ code: "validation.failed" });
    expect(executor.rollbackCount).toBe(1);
    expect(executor.commitCount).toBe(0);
  });

  it("fails closed on unsupported patches and lossy database bigint values", async () => {
    const executor = new ScriptedExecutor([[stateRow({ revision: 3 })]]);
    const repository =
      createSqlInboxV2EmployeeConversationStateRepository(executor);

    await expect(repository.find(key())).rejects.toBeInstanceOf(
      InboxV2EmployeeConversationStatePersistenceInvariantError
    );
    await expect(
      repository.compareAndSetPreferences(
        {
          ...key(),
          expectedRevision: null,
          patch: { hidden: true } as never,
          changedAt
        },
        async () => ({ streamPosition: streamPosition("1"), result: null })
      )
    ).rejects.toMatchObject({ code: "validation.failed" });
  });

  it("builds a full preference CAS without a generic state upsert", () => {
    const rendered = render(
      buildCompareAndSetInboxV2EmployeeConversationPreferencesSql({
        ...key(),
        manualUnread: true,
        muted: true,
        notificationLevel: "mentions_only",
        pinned: true,
        archived: false,
        expectedRevision: revision("3"),
        resultingRevision: revision("4"),
        streamPosition: streamPosition("11"),
        changedAt
      })
    );

    expect(rendered.sql.trimStart()).toMatch(/^update /u);
    expect(rendered.sql).toContain("and revision =");
    expect(rendered.sql).not.toContain("on conflict");
    expect(rendered.sql).not.toContain("provider_receipt");
  });
});

function key() {
  return { tenantId, employeeId, conversationId };
}

function sequence(value: string) {
  return inboxV2TimelineSequenceSchema.parse(value);
}

function revision(value: string) {
  return inboxV2EntityRevisionSchema.parse(value);
}

function streamPosition(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}

function stateRow(overrides: Record<string, unknown> = {}) {
  return {
    tenant_id: tenantId,
    employee_id: employeeId,
    conversation_id: conversationId,
    last_read_sequence: "100",
    last_read_at: createdAt,
    manual_unread: true,
    manual_unread_changed_at: createdAt,
    muted: false,
    mute_changed_at: createdAt,
    notification_level: "mentions_only",
    notification_level_changed_at: createdAt,
    pinned: false,
    pin_changed_at: createdAt,
    archived: false,
    archive_changed_at: createdAt,
    revision: "3",
    last_changed_stream_position: "10",
    created_at: createdAt,
    updated_at: createdAt,
    ...overrides
  };
}

class ScriptedExecutor implements InboxV2EmployeeConversationStateTransactionExecutor {
  readonly queries: SQL[] = [];
  commitCount = 0;
  rollbackCount = 0;
  private index = 0;

  constructor(
    private readonly results: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.results[this.index] ?? [];
    this.index += 1;
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    try {
      const result = await work(this);
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    }
  }
}

function render(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}
