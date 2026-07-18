import type {
  InboxV2BigintCounter,
  InboxV2ConversationId,
  InboxV2EntityRevision,
  InboxV2TenantId,
  InboxV2TimelineItemId
} from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildCompareAndSetInboxV2ConversationHeadSql,
  buildCompareAndSetInboxV2ConversationSql,
  buildFindInboxV2ConversationSql,
  buildInsertInboxV2ConversationHeadSql,
  buildInsertInboxV2ConversationMembershipHeadSql,
  buildInsertInboxV2ConversationSql,
  buildLockInboxV2ConversationSql,
  allocateInboxV2TimelineRangeInTransaction,
  createInternalSqlInboxV2ConversationRepository as createSqlInboxV2ConversationRepository,
  createSqlInboxV2ConversationRepository as createPublicSqlInboxV2ConversationRepository,
  type CreateInboxV2ConversationInput,
  type InboxV2ConversationTransactionExecutor,
  type RawSqlExecutor,
  type RawSqlQueryResult
} from "./sql-inbox-v2-conversation-repository";

const tenantId = "tenant:db-001" as InboxV2TenantId;
const otherTenantId = "tenant:db-002" as InboxV2TenantId;
const conversationId = "conversation:db-001" as InboxV2ConversationId;
const createdAt = "2026-07-13T10:00:00.000Z";
const changedAt = "2026-07-13T10:01:00.000Z";

describe("SQL Inbox V2 conversation repository", () => {
  it("keeps raw timeline allocation outside the public repository", () => {
    const repository = createPublicSqlInboxV2ConversationRepository(
      new StatefulConversationExecutor()
    );

    expect(Object.keys(repository).sort()).toEqual([
      "compareAndSet",
      "create",
      "findById"
    ]);
    expect("withTimelineSequenceAllocation" in repository).toBe(false);
  });

  it("builds tenant-scoped create, lookup and defensive CAS SQL", () => {
    const createInput = createConversationInput();
    const insertConversation = renderQuery(
      buildInsertInboxV2ConversationSql({
        ...createInput,
        lifecycle: "active"
      })
    );
    const insertHead = renderQuery(
      buildInsertInboxV2ConversationHeadSql(createInput)
    );
    const insertMembershipHead = renderQuery(
      buildInsertInboxV2ConversationMembershipHeadSql(createInput)
    );
    const unlockedFind = renderQuery(
      buildFindInboxV2ConversationSql({ tenantId, conversationId })
    );
    const lockedFind = renderQuery(
      buildFindInboxV2ConversationSql({
        tenantId,
        conversationId,
        lockHead: true
      })
    );
    const conversationLock = renderQuery(
      buildLockInboxV2ConversationSql({ tenantId, conversationId })
    );
    const entityCas = renderQuery(
      buildCompareAndSetInboxV2ConversationSql({
        tenantId,
        conversationId,
        expectedRevision: revision("3"),
        next: {
          topology: "group",
          transport: "external",
          purposeId: "core:support" as never,
          lifecycle: "ended"
        },
        streamPosition: counter("8"),
        changedAt
      })
    );
    const headCas = renderQuery(
      buildCompareAndSetInboxV2ConversationHeadSql({
        tenantId,
        conversationId,
        expectedHeadRevision: revision("5"),
        expectedLatestTimelineSequence: "20",
        latestTimelineSequence: "22" as never,
        latestActivityItemId: timelineItemId("timeline_item:last"),
        latestActivityTimelineSequence: "22",
        latestActivityAt: changedAt,
        streamPosition: counter("9"),
        changedAt
      })
    );

    expect(insertConversation.sql).toContain(
      "on conflict (tenant_id, id) do nothing"
    );
    expect(insertConversation.params).toEqual(
      expect.arrayContaining([tenantId, conversationId, "core:chat", "1"])
    );
    expect(insertHead.sql).toContain("insert into inbox_v2_conversation_heads");
    expect(insertHead.params).toEqual(
      expect.arrayContaining([tenantId, conversationId, "1"])
    );
    expect(insertMembershipHead.sql).toContain(
      "insert into inbox_v2_conversation_membership_heads"
    );
    expect(insertMembershipHead.params).toEqual(
      expect.arrayContaining([tenantId, conversationId, createdAt])
    );
    expect(unlockedFind.sql).toContain("h.tenant_id = c.tenant_id");
    expect(unlockedFind.sql).toContain("h.conversation_id = c.id");
    expect(unlockedFind.sql).toContain("where c.tenant_id = $1");
    expect(unlockedFind.sql).toContain("and c.id = $2");
    expect(unlockedFind.sql).not.toContain("for update");
    expect(conversationLock.sql).toContain("from inbox_v2_conversations");
    expect(conversationLock.sql).toContain("for update");
    expect(conversationLock.params).toEqual([tenantId, conversationId]);
    expect(lockedFind.sql).toContain("for update of h");
    expect(lockedFind.params).toEqual([tenantId, conversationId]);
    expect(entityCas.sql).not.toContain("set transport");
    expect(entityCas.sql).toContain("where tenant_id = $6");
    expect(entityCas.sql).toContain("and id = $7");
    expect(entityCas.sql).toContain("and revision = $8");
    expect(entityCas.params.slice(-3)).toEqual([tenantId, conversationId, "3"]);
    expect(headCas.sql).toContain("where tenant_id = $7");
    expect(headCas.sql).toContain("and conversation_id = $8");
    expect(headCas.sql).toContain("and revision = $9");
    expect(headCas.sql).toContain("and latest_timeline_sequence = $10");
    expect(headCas.params.slice(-4)).toEqual([
      tenantId,
      conversationId,
      "5",
      "20"
    ]);
  });

  it("creates, maps and reads the nested Conversation/Head aggregate", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);

    const created = await repository.create(createConversationInput());

    expect(created).toMatchObject({
      kind: "created",
      record: {
        aggregate: {
          tenantId,
          id: conversationId,
          topology: "direct",
          transport: "internal",
          purposeId: "core:chat",
          lifecycle: "active",
          revision: "1",
          createdAt,
          updatedAt: createdAt,
          head: {
            latestTimelineSequence: "0",
            latestActivityItemId: null,
            latestActivityTimelineSequence: null,
            latestActivityAt: null,
            revision: "1",
            createdAt,
            updatedAt: createdAt
          }
        },
        entityLastChangedStreamPosition: "1",
        headLastChangedStreamPosition: "1"
      }
    });
    expect(executor.transactionCount).toBe(1);
    expect(executor.commitCount).toBe(1);

    const found = await repository.findById({ tenantId, conversationId });
    expect(found).toEqual(created.record);
    expect(renderQuery(executor.queries.at(-1)).sql).not.toContain(
      "for update"
    );
  });

  it("returns already_exists without recreating the existing head", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    const queryCount = executor.queries.length;

    const duplicate = await repository.create(createConversationInput());

    expect(duplicate.kind).toBe("already_exists");
    expect(duplicate.record.aggregate.head.revision).toBe("1");
    const duplicateQueries = executor.queries
      .slice(queryCount)
      .map((query) => renderQuery(query).sql);
    expect(duplicateQueries).toHaveLength(3);
    expect(duplicateQueries[0]).toContain("insert into inbox_v2_conversations");
    expect(duplicateQueries[1]).toContain("from inbox_v2_conversations");
    expect(duplicateQueries[1]).toContain("for update");
    expect(duplicateQueries[2]).toContain("for update of h");
  });

  it("does not treat a duplicate ID with different canonical identity as idempotent", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());

    const conflict = await repository.create({
      ...createConversationInput(),
      topology: "group",
      purposeId: "core:support" as never,
      streamPosition: counter("2"),
      createdAt: changedAt
    });

    expect(conflict).toMatchObject({
      kind: "identity_conflict",
      record: {
        aggregate: {
          topology: "direct",
          purposeId: "core:chat",
          revision: "1",
          head: { revision: "1" }
        }
      }
    });
  });

  it("distinguishes entity no-op, conflict and exact CAS update", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());

    const noOp = await repository.compareAndSet({
      ...entityCasInput(),
      streamPosition: counter("1"),
      changedAt: createdAt
    });
    expect(noOp).toMatchObject({
      kind: "no_op",
      record: {
        aggregate: { revision: "1" },
        entityLastChangedStreamPosition: "1"
      }
    });

    const conflict = await repository.compareAndSet({
      ...entityCasInput(),
      expectedRevision: revision("2"),
      next: { ...entityCasInput().next, lifecycle: "ended" },
      streamPosition: counter("2")
    });
    expect(conflict).toMatchObject({
      kind: "revision_conflict",
      record: { aggregate: { revision: "1" } }
    });

    await expect(
      repository.compareAndSet({
        ...entityCasInput(),
        next: { ...entityCasInput().next, transport: "external" },
        streamPosition: counter("2")
      })
    ).rejects.toMatchObject({ code: "validation.failed" });

    const updated = await repository.compareAndSet({
      ...entityCasInput(),
      next: { ...entityCasInput().next, lifecycle: "ended" },
      streamPosition: counter("2")
    });
    expect(updated).toMatchObject({
      kind: "updated",
      record: {
        aggregate: {
          lifecycle: "ended",
          revision: "2",
          updatedAt: changedAt,
          head: { revision: "1", updatedAt: createdAt }
        },
        entityLastChangedStreamPosition: "2",
        headLastChangedStreamPosition: "1"
      }
    });
  });

  it("allocates a contiguous range and advances only the head revision", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    let callbackExecutor: RawSqlExecutor | null = null;

    const outcome = await repository.withTimelineSequenceAllocation(
      allocationInput([
        allocationItem("timeline_item:first", false, createdAt),
        allocationItem("timeline_item:second", true, changedAt),
        allocationItem("timeline_item:third", true, "2026-07-13T10:02:00.000Z")
      ]),
      async ({ allocation, executor: transaction }) => {
        callbackExecutor = transaction;
        return allocation.assignments.map((item) => item.timelineSequence);
      }
    );

    expect(outcome).toMatchObject({
      kind: "allocated",
      allocation: {
        firstSequence: "1",
        lastSequence: "3",
        assignments: [
          { itemId: "timeline_item:first", timelineSequence: "1" },
          { itemId: "timeline_item:second", timelineSequence: "2" },
          { itemId: "timeline_item:third", timelineSequence: "3" }
        ]
      },
      result: ["1", "2", "3"],
      record: {
        aggregate: {
          revision: "1",
          updatedAt: createdAt,
          head: {
            latestTimelineSequence: "3",
            latestActivityItemId: "timeline_item:third",
            latestActivityTimelineSequence: "3",
            latestActivityAt: "2026-07-13T10:02:00.000Z",
            revision: "2",
            updatedAt: changedAt
          }
        },
        entityLastChangedStreamPosition: "1",
        headLastChangedStreamPosition: "2"
      }
    });
    expect(callbackExecutor).not.toBe(executor);
  });

  it("composes the package-internal allocator inside exactly the caller-owned transaction", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    const transactionsBefore = executor.transactionCount;
    let callbackExecutor: RawSqlExecutor | null = null;

    const outcome = await executor.transaction((transaction) =>
      allocateInboxV2TimelineRangeInTransaction(
        transaction,
        allocationInput([
          allocationItem("timeline_item:transaction-local", true, changedAt)
        ]),
        async ({ allocation, executor: allocatorExecutor }) => {
          callbackExecutor = allocatorExecutor;
          return allocation.firstSequence;
        }
      )
    );

    expect(outcome).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "1", lastSequence: "1" },
      result: "1",
      record: {
        aggregate: {
          head: {
            latestTimelineSequence: "1",
            revision: "2"
          }
        }
      }
    });
    expect(executor.transactionCount).toBe(transactionsBefore + 1);
    expect(callbackExecutor).not.toBe(executor);
  });

  it("rolls back a failed callback and reuses the same range on retry", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    const input = allocationInput([
      allocationItem("timeline_item:rollback-1", true, changedAt),
      allocationItem("timeline_item:rollback-2", false, changedAt)
    ]);

    await expect(
      repository.withTimelineSequenceAllocation(input, async () => {
        throw new Error("persist failed");
      })
    ).rejects.toThrow("persist failed");

    const afterRollback = await repository.findById({
      tenantId,
      conversationId
    });
    expect(afterRollback?.aggregate.head).toMatchObject({
      latestTimelineSequence: "0",
      revision: "1"
    });
    expect(executor.rollbackCount).toBe(1);

    const retried = await repository.withTimelineSequenceAllocation(
      input,
      async ({ allocation }) => allocation.firstSequence
    );
    expect(retried).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "1", lastSequence: "2" },
      result: "1",
      record: { aggregate: { head: { revision: "2" } } }
    });
  });

  it("serializes concurrent allocations, reports conflict and retries contiguously", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());

    const [left, right] = await Promise.all([
      repository.withTimelineSequenceAllocation(
        allocationInput([
          allocationItem("timeline_item:concurrent-left", true, changedAt)
        ]),
        async () => "left"
      ),
      repository.withTimelineSequenceAllocation(
        allocationInput([
          allocationItem("timeline_item:concurrent-right", true, changedAt)
        ]),
        async () => "right"
      )
    ]);
    const winner = [left, right].find((result) => result.kind === "allocated");
    const loser = [left, right].find(
      (result) => result.kind === "revision_conflict"
    );

    expect(winner).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "1", lastSequence: "1" }
    });
    expect(loser).toMatchObject({
      kind: "revision_conflict",
      record: {
        aggregate: { head: { latestTimelineSequence: "1", revision: "2" } }
      }
    });

    const loserItemId =
      winner === left
        ? timelineItemId("timeline_item:concurrent-right")
        : timelineItemId("timeline_item:concurrent-left");
    const retry = await repository.withTimelineSequenceAllocation(
      {
        ...allocationInput([
          { itemId: loserItemId, occurredAt: changedAt, activityEligible: true }
        ]),
        expectedHeadRevision: revision("2"),
        streamPosition: counter("3"),
        changedAt: "2026-07-13T10:02:00.000Z"
      },
      async () => "retry"
    );
    expect(retry).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "2", lastSequence: "2" },
      record: {
        aggregate: { head: { latestTimelineSequence: "2", revision: "3" } }
      }
    });
  });

  it("preserves the activity head when an appended history range is ineligible", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    await repository.withTimelineSequenceAllocation(
      allocationInput([allocationItem("timeline_item:live", true, changedAt)]),
      async () => undefined
    );

    const history = await repository.withTimelineSequenceAllocation(
      {
        ...allocationInput([
          allocationItem(
            "timeline_item:history",
            false,
            "2026-07-12T10:00:00.000Z"
          )
        ]),
        expectedHeadRevision: revision("2"),
        streamPosition: counter("3"),
        changedAt: "2026-07-13T10:02:00.000Z"
      },
      async () => undefined
    );

    expect(history).toMatchObject({
      kind: "allocated",
      record: {
        aggregate: {
          head: {
            latestTimelineSequence: "2",
            latestActivityItemId: "timeline_item:live",
            latestActivityTimelineSequence: "1",
            latestActivityAt: changedAt,
            revision: "3"
          }
        }
      }
    });
  });

  it("rejects invalid allocation bounds, duplicate IDs and bigint overflow without state change", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    const transactionsBeforeValidation = executor.transactionCount;

    await expect(
      repository.withTimelineSequenceAllocation(
        allocationInput([]),
        async () => undefined
      )
    ).rejects.toThrow(CoreError);
    await expect(
      repository.withTimelineSequenceAllocation(
        allocationInput(
          Array.from({ length: 1_001 }, (_, index) =>
            allocationItem(`timeline_item:too-many-${index}`, false, createdAt)
          )
        ),
        async () => undefined
      )
    ).rejects.toThrow(CoreError);
    await expect(
      repository.withTimelineSequenceAllocation(
        allocationInput([
          allocationItem("timeline_item:duplicate", false, createdAt),
          allocationItem("timeline_item:duplicate", true, changedAt)
        ]),
        async () => undefined
      )
    ).rejects.toThrow(CoreError);
    expect(executor.transactionCount).toBe(transactionsBeforeValidation);

    executor.unsafeSetHead({
      tenantId,
      conversationId,
      latestTimelineSequence: "9223372036854775807"
    });
    await expect(
      repository.withTimelineSequenceAllocation(
        allocationInput([
          allocationItem("timeline_item:overflow", false, changedAt)
        ]),
        async () => undefined
      )
    ).rejects.toThrow("exceeds the PostgreSQL bigint range");
    const afterOverflow = await repository.findById({
      tenantId,
      conversationId
    });
    expect(afterOverflow?.aggregate.head.latestTimelineSequence).toBe(
      "9223372036854775807"
    );
    expect(afterOverflow?.aggregate.head.revision).toBe("1");
  });

  it("rejects unsafe numeric bigint decoding and cross-tenant rows", async () => {
    const unsafeRevision = aggregateRow({
      entity_revision: Number.MAX_SAFE_INTEGER + 2
    });
    const unsafeExecutor = new ScriptedConversationExecutor([[unsafeRevision]]);
    const unsafeRepository =
      createSqlInboxV2ConversationRepository(unsafeExecutor);

    await expect(
      unsafeRepository.findById({ tenantId, conversationId })
    ).rejects.toThrow("decoded as a JavaScript number");

    const crossTenantExecutor = new ScriptedConversationExecutor([
      [aggregateRow({ conversation_tenant_id: otherTenantId })]
    ]);
    const crossTenantRepository =
      createSqlInboxV2ConversationRepository(crossTenantExecutor);
    await expect(
      crossTenantRepository.findById({ tenantId, conversationId })
    ).rejects.toThrow(new CoreError("tenant.boundary_violation"));
  });

  it("rejects stale mutation metadata before issuing the defensive update", async () => {
    const executor = new StatefulConversationExecutor();
    const repository = createSqlInboxV2ConversationRepository(executor);
    await repository.create(createConversationInput());
    const queriesBefore = executor.queries.length;

    await expect(
      repository.compareAndSet({
        ...entityCasInput(),
        next: { ...entityCasInput().next, lifecycle: "ended" },
        streamPosition: counter("1")
      })
    ).rejects.toThrow("must advance its last changed stream position");
    const staleQueries = executor.queries
      .slice(queriesBefore)
      .map((query) => renderQuery(query).sql.trimStart());
    expect(staleQueries).toHaveLength(2);
    expect(staleQueries.every((query) => query.startsWith("select"))).toBe(
      true
    );

    await expect(
      repository.withTimelineSequenceAllocation(
        {
          ...allocationInput([
            allocationItem("timeline_item:clock", true, createdAt)
          ]),
          changedAt: "2026-07-13T09:59:59.000Z"
        },
        async () => undefined
      )
    ).rejects.toThrow("cannot move its updatedAt backwards");
  });
});

function createConversationInput(): CreateInboxV2ConversationInput {
  return {
    tenantId,
    conversationId,
    topology: "direct",
    transport: "internal",
    purposeId: "core:chat" as never,
    streamPosition: counter("1"),
    createdAt
  };
}

function entityCasInput() {
  return {
    tenantId,
    conversationId,
    expectedRevision: revision("1"),
    next: {
      topology: "direct" as const,
      transport: "internal" as const,
      purposeId: "core:chat" as never,
      lifecycle: "active" as const
    },
    streamPosition: counter("2"),
    changedAt
  };
}

function allocationInput(items: readonly ReturnType<typeof allocationItem>[]) {
  return {
    tenantId,
    conversationId,
    expectedHeadRevision: revision("1"),
    items,
    streamPosition: counter("2"),
    changedAt
  };
}

function allocationItem(
  id: string,
  activityEligible: boolean,
  occurredAt: string
) {
  return {
    itemId: timelineItemId(id),
    occurredAt,
    activityEligible
  };
}

function counter(value: string): InboxV2BigintCounter {
  return value as InboxV2BigintCounter;
}

function revision(value: string): InboxV2EntityRevision {
  return value as InboxV2EntityRevision;
}

function timelineItemId(value: string): InboxV2TimelineItemId {
  return value as InboxV2TimelineItemId;
}

type AggregateRow = Record<string, unknown> & {
  conversation_tenant_id: unknown;
  conversation_id: unknown;
  topology: unknown;
  transport: unknown;
  purpose_id: unknown;
  lifecycle: unknown;
  entity_revision: unknown;
  entity_last_changed_stream_position: unknown;
  conversation_created_at: unknown;
  conversation_updated_at: unknown;
  latest_timeline_sequence: unknown;
  latest_activity_item_id: unknown;
  latest_activity_timeline_sequence: unknown;
  latest_activity_at: unknown;
  head_revision: unknown;
  head_last_changed_stream_position: unknown;
  head_created_at: unknown;
  head_updated_at: unknown;
};

function aggregateRow(overrides: Partial<AggregateRow> = {}): AggregateRow {
  return {
    conversation_tenant_id: tenantId,
    conversation_id: conversationId,
    topology: "direct",
    transport: "internal",
    purpose_id: "core:chat",
    lifecycle: "active",
    entity_revision: "1",
    entity_last_changed_stream_position: "1",
    conversation_created_at: createdAt,
    conversation_updated_at: createdAt,
    latest_timeline_sequence: "0",
    latest_activity_item_id: null,
    latest_activity_timeline_sequence: null,
    latest_activity_at: null,
    head_revision: "1",
    head_last_changed_stream_position: "1",
    head_created_at: createdAt,
    head_updated_at: createdAt,
    ...overrides
  };
}

type StoredConversation = {
  tenantId: string;
  conversationId: string;
  topology: string;
  transport: string;
  purposeId: string;
  lifecycle: string;
  entityRevision: string;
  entityLastChangedStreamPosition: string;
  conversationCreatedAt: string;
  conversationUpdatedAt: string;
  head: null | {
    latestTimelineSequence: string;
    latestActivityItemId: string | null;
    latestActivityTimelineSequence: string | null;
    latestActivityAt: string | null;
    revision: string;
    lastChangedStreamPosition: string;
    createdAt: string;
    updatedAt: string;
  };
};

class StatefulConversationExecutor implements InboxV2ConversationTransactionExecutor {
  readonly queries: SQL[] = [];
  transactionCount = 0;
  commitCount = 0;
  rollbackCount = 0;
  private state = new Map<string, StoredConversation>();
  private transactionTail: Promise<void> = Promise.resolve();

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    const session = new StatefulConversationSession(this.state, this.queries);
    const result = await session.execute<Row>(query);
    this.state = session.takeState();
    return result;
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCount += 1;
    const previous = this.transactionTail;
    let release = (): void => undefined;
    this.transactionTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;

    const draft = structuredClone(this.state);
    const session = new StatefulConversationSession(draft, this.queries);
    try {
      const result = await work(session);
      this.state = session.takeState();
      this.commitCount += 1;
      return result;
    } catch (error) {
      this.rollbackCount += 1;
      throw error;
    } finally {
      release();
    }
  }

  unsafeSetHead(input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    latestTimelineSequence: string;
  }): void {
    const stored = this.state.get(
      storageKey(input.tenantId, input.conversationId)
    );
    if (stored?.head === null || stored === undefined) {
      throw new Error("Expected a seeded ConversationHead.");
    }
    stored.head.latestTimelineSequence = input.latestTimelineSequence;
  }
}

class StatefulConversationSession implements RawSqlExecutor {
  constructor(
    private state: Map<string, StoredConversation>,
    private readonly queries: SQL[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rendered = renderQuery(query);
    const statement = rendered.sql.trimStart().toLowerCase();
    const params = rendered.params;

    if (statement.startsWith("insert into inbox_v2_conversation_heads")) {
      return this.insertHead<Row>(params);
    }
    if (
      statement.startsWith("insert into inbox_v2_conversation_membership_heads")
    ) {
      return rowsResult<Row>([{ id: String(params[1]) }]);
    }
    if (statement.startsWith("insert into inbox_v2_conversations")) {
      return this.insertConversation<Row>(params);
    }
    if (statement.startsWith("update inbox_v2_conversation_heads")) {
      return this.updateHead<Row>(params);
    }
    if (statement.startsWith("update inbox_v2_conversations")) {
      return this.updateConversation<Row>(params);
    }
    if (statement.startsWith("select")) {
      return this.find<Row>(params);
    }

    throw new Error(`Stateful fake does not understand SQL: ${rendered.sql}`);
  }

  takeState(): Map<string, StoredConversation> {
    return this.state;
  }

  private insertConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id, topology, transport, purpose, lifecycle, position, at] =
      params.map(String);
    const key = storageKey(tenant, id);
    if (this.state.has(key)) {
      return rowsResult([]);
    }
    this.state.set(key, {
      tenantId: tenant,
      conversationId: id,
      topology,
      transport,
      purposeId: purpose,
      lifecycle,
      entityRevision: "1",
      entityLastChangedStreamPosition: position,
      conversationCreatedAt: at,
      conversationUpdatedAt: at,
      head: null
    });
    return rowsResult([{ id }]);
  }

  private insertHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const [tenant, id, position, at] = params.map(String);
    const stored = this.state.get(storageKey(tenant, id));
    if (stored === undefined || stored.head !== null) {
      return rowsResult([]);
    }
    stored.head = {
      latestTimelineSequence: "0",
      latestActivityItemId: null,
      latestActivityTimelineSequence: null,
      latestActivityAt: null,
      revision: "1",
      lastChangedStreamPosition: position,
      createdAt: at,
      updatedAt: at
    };
    return rowsResult([{ id }]);
  }

  private find<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[0]);
    const id = String(params[1]);
    const stored = this.state.get(storageKey(tenant, id));
    if (stored?.head === null || stored === undefined) {
      return rowsResult([]);
    }
    return rowsResult([toAggregateRow(stored)]);
  }

  private updateConversation<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[5]);
    const id = String(params[6]);
    const expectedRevision = String(params[7]);
    const stored = this.state.get(storageKey(tenant, id));
    if (stored === undefined || stored.entityRevision !== expectedRevision) {
      return rowsResult([]);
    }
    stored.topology = String(params[0]);
    stored.purposeId = String(params[1]);
    stored.lifecycle = String(params[2]);
    stored.entityLastChangedStreamPosition = String(params[3]);
    stored.conversationUpdatedAt = String(params[4]);
    stored.entityRevision = String(BigInt(stored.entityRevision) + 1n);
    return rowsResult([{ id }]);
  }

  private updateHead<Row extends Record<string, unknown>>(
    params: unknown[]
  ): RawSqlQueryResult<Row> {
    const tenant = String(params[6]);
    const id = String(params[7]);
    const expectedRevision = String(params[8]);
    const expectedSequence = String(params[9]);
    const stored = this.state.get(storageKey(tenant, id));
    if (
      stored?.head === null ||
      stored === undefined ||
      stored.head.revision !== expectedRevision ||
      stored.head.latestTimelineSequence !== expectedSequence
    ) {
      return rowsResult([]);
    }
    stored.head.latestTimelineSequence = String(params[0]);
    stored.head.latestActivityItemId = nullableString(params[1]);
    stored.head.latestActivityTimelineSequence = nullableString(params[2]);
    stored.head.latestActivityAt = nullableString(params[3]);
    stored.head.lastChangedStreamPosition = String(params[4]);
    stored.head.updatedAt = String(params[5]);
    stored.head.revision = String(BigInt(stored.head.revision) + 1n);
    return rowsResult([{ id }]);
  }
}

class ScriptedConversationExecutor implements InboxV2ConversationTransactionExecutor {
  readonly queries: SQL[] = [];
  private resultIndex = 0;

  constructor(
    private readonly results: readonly (readonly Record<string, unknown>[])[]
  ) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);
    const rows = this.results[this.resultIndex] ?? [];
    this.resultIndex += 1;
    return rowsResult(rows);
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    return work(this);
  }
}

function toAggregateRow(stored: StoredConversation): AggregateRow {
  const head = stored.head;
  if (head === null) {
    throw new Error("Expected complete aggregate state.");
  }
  return aggregateRow({
    conversation_tenant_id: stored.tenantId,
    conversation_id: stored.conversationId,
    topology: stored.topology,
    transport: stored.transport,
    purpose_id: stored.purposeId,
    lifecycle: stored.lifecycle,
    entity_revision: stored.entityRevision,
    entity_last_changed_stream_position: stored.entityLastChangedStreamPosition,
    conversation_created_at: stored.conversationCreatedAt,
    conversation_updated_at: stored.conversationUpdatedAt,
    latest_timeline_sequence: head.latestTimelineSequence,
    latest_activity_item_id: head.latestActivityItemId,
    latest_activity_timeline_sequence: head.latestActivityTimelineSequence,
    latest_activity_at: head.latestActivityAt,
    head_revision: head.revision,
    head_last_changed_stream_position: head.lastChangedStreamPosition,
    head_created_at: head.createdAt,
    head_updated_at: head.updatedAt
  });
}

function rowsResult<Row extends Record<string, unknown>>(
  rows: readonly Record<string, unknown>[]
): RawSqlQueryResult<Row> {
  return { rows: rows as readonly Row[] };
}

function nullableString(value: unknown): string | null {
  return value === null ? null : String(value);
}

function storageKey(tenant: string, conversation: string): string {
  return `${tenant}\u0000${conversation}`;
}

function renderQuery(query: SQL | undefined): {
  sql: string;
  params: unknown[];
} {
  if (query === undefined) {
    throw new Error("Expected a SQL query.");
  }
  return new PgDialect().sqlToQuery(query);
}
