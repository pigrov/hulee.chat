import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import {
  allocateInboxV2TimelineRangeInTransaction,
  createInternalSqlInboxV2ConversationRepository as createSqlInboxV2ConversationRepository,
  type AllocateInboxV2TimelineRangeInput,
  type InboxV2TimelineRangeAllocation
} from "./sql-inbox-v2-conversation-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = inboxV2TenantIdSchema.parse(`tenant:db001-a-${runId}`);
const tenantB = inboxV2TenantIdSchema.parse(`tenant:db001-b-${runId}`);
const t0 = "2026-07-13T10:00:00.000Z";
const t1 = "2026-07-13T10:00:01.000Z";
const t2 = "2026-07-13T10:00:02.000Z";
const t3 = "2026-07-13T10:00:03.000Z";

describePostgres("SQL Inbox V2 Conversation repository (PostgreSQL)", () => {
  let db: HuleeDatabase;

  beforeAll(async () => {
    db = createHuleeDatabase();
    await db.execute(sql`
      insert into tenants (id, slug, display_name, deployment_type)
      values
        (${tenantA}, ${`db001-a-${runId}`}, 'DB001 tenant A', 'saas_shared'),
        (${tenantB}, ${`db001-b-${runId}`}, 'DB001 tenant B', 'saas_shared')
    `);
  });

  afterAll(async () => {
    if (!db) {
      return;
    }

    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        delete from inbox_v2_timeline_subject_details
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from inbox_v2_timeline_items
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from inbox_v2_conversation_work_item_slots
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from inbox_v2_conversation_membership_heads
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from inbox_v2_conversation_heads
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from inbox_v2_conversations
        where tenant_id in (${tenantA}, ${tenantB})
      `);
      await transaction.execute(sql`
        delete from event_store
        where tenant_id in (${tenantA}, ${tenantB})
      `);
    });
    await db.execute(sql`
      delete from tenants
      where id in (${tenantA}, ${tenantB})
    `);
    await closeHuleeDatabase(db);
  });

  it("keeps same opaque IDs tenant-scoped and rejects cross-tenant head links", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("same-id");

    const [createdA, createdB] = await Promise.all([
      repository.create(createInput(tenantA, conversationId, "1", t0)),
      repository.create(createInput(tenantB, conversationId, "1", t0))
    ]);

    expect(createdA.kind).toBe("created");
    expect(createdB.kind).toBe("created");
    expect(
      (await repository.findById({ tenantId: tenantA, conversationId }))
        ?.aggregate.tenantId
    ).toBe(tenantA);
    expect(
      (await repository.findById({ tenantId: tenantB, conversationId }))
        ?.aggregate.tenantId
    ).toBe(tenantB);

    const identityConflict = await repository.create({
      ...createInput(tenantA, conversationId, "2", t1),
      topology: "group",
      purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support")
    });
    expect(identityConflict).toMatchObject({
      kind: "identity_conflict",
      record: {
        aggregate: { topology: "direct", purposeId: "core:chat" }
      }
    });

    const onlyInA = conversation("only-in-a");
    await repository.create(createInput(tenantA, onlyInA, "1", t0));

    await expect(
      db.execute(sql`
        insert into inbox_v2_conversation_heads (
          tenant_id,
          conversation_id,
          last_changed_stream_position
        )
        values (${tenantB}, ${onlyInA}, 1)
      `)
    ).rejects.toThrow();
  });

  it("keeps purpose segment limits and finite timestamps in contract/DDL parity", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const boundaryConversationId = conversation("purpose-boundary");
    const boundary = await repository.create({
      ...createInput(tenantA, boundaryConversationId, "1", t0),
      purposeId: inboxV2ConversationPurposeIdSchema.parse(
        `module:${"m".repeat(80)}:${"l".repeat(160)}`
      )
    });
    expect(boundary.kind).toBe("created");

    const invalidPurposes = [
      `core:${"l".repeat(161)}`,
      `module:${"m".repeat(81)}:local`,
      `module:valid:${"l".repeat(161)}`
    ];
    for (const [index, purposeId] of invalidPurposes.entries()) {
      await expect(
        db.execute(sql`
          insert into inbox_v2_conversations (
            tenant_id,
            id,
            topology,
            transport,
            purpose_id,
            lifecycle,
            last_changed_stream_position,
            created_at,
            updated_at
          )
          values (
            ${tenantA},
            ${conversation(`invalid-purpose-${index}`)},
            'direct',
            'internal',
            ${purposeId},
            'active',
            1,
            ${t0},
            ${t0}
          )
        `)
      ).rejects.toThrow();
    }

    await expect(
      db.execute(sql`
        insert into inbox_v2_conversations (
          tenant_id,
          id,
          topology,
          transport,
          purpose_id,
          lifecycle,
          last_changed_stream_position,
          created_at,
          updated_at
        )
        values (
          ${tenantA},
          ${conversation("infinite-clock")},
          'direct',
          'internal',
          'core:chat',
          'active',
          1,
          'infinity'::timestamptz,
          'infinity'::timestamptz
        )
      `)
    ).rejects.toThrow();

    await expect(
      db.execute(sql`
        update inbox_v2_conversation_heads
        set latest_timeline_sequence = 1,
            latest_activity_item_id = 'timeline_item:infinite-activity',
            latest_activity_timeline_sequence = 1,
            latest_activity_at = 'infinity'::timestamptz
        where tenant_id = ${tenantA}
          and conversation_id = ${boundaryConversationId}
      `)
    ).rejects.toThrow();
  });

  it("serializes concurrent same-head CAS and allocates contiguous retry ranges", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("concurrent");
    await repository.create(createInput(tenantA, conversationId, "1", t0));

    const firstAttempt = allocationInput(
      tenantA,
      conversationId,
      "1",
      "2",
      t1,
      [item("concurrent-a-1", t1, true), item("concurrent-a-2", t1, false)]
    );
    const secondAttempt = allocationInput(
      tenantA,
      conversationId,
      "1",
      "2",
      t1,
      [item("concurrent-b-1", t1, true)]
    );

    const concurrent = await Promise.all([
      repository.withTimelineSequenceAllocation(
        firstAttempt,
        async (context) => {
          await persistAllocatedCallItems(context, firstAttempt);
          return "a";
        }
      ),
      repository.withTimelineSequenceAllocation(
        secondAttempt,
        async (context) => {
          await persistAllocatedCallItems(context, secondAttempt);
          return "b";
        }
      )
    ]);
    const winner = concurrent.find((result) => result.kind === "allocated");
    const loser = concurrent.find(
      (result) => result.kind === "revision_conflict"
    );

    expect(winner?.kind).toBe("allocated");
    expect(loser?.kind).toBe("revision_conflict");
    if (winner?.kind !== "allocated" || loser?.kind !== "revision_conflict") {
      throw new Error("Expected one allocation winner and one CAS loser.");
    }
    expect(winner.record.aggregate.revision).toBe("1");
    expect(winner.record.aggregate.head.revision).toBe("2");

    const retryItems =
      winner.result === "a" ? secondAttempt.items : firstAttempt.items;
    const retry = await repository.withTimelineSequenceAllocation(
      {
        ...secondAttempt,
        expectedHeadRevision: revision("2"),
        items: retryItems,
        streamPosition: position("3"),
        changedAt: t2
      },
      async (context) => {
        await persistAllocatedCallItems(context, {
          ...secondAttempt,
          items: retryItems,
          streamPosition: position("3"),
          changedAt: t2
        });
        return "retry";
      }
    );

    expect(retry.kind).toBe("allocated");
    if (retry.kind !== "allocated") {
      throw new Error("Expected stale writer retry to allocate.");
    }
    expect(BigInt(retry.allocation.firstSequence)).toBe(
      BigInt(winner.allocation.lastSequence) + 1n
    );
    expect(retry.record.aggregate.head.latestTimelineSequence).toBe(
      retry.allocation.lastSequence
    );
    expect(retry.record.aggregate.head.revision).toBe("3");
  });

  it("serializes concurrent inbound, outbound and system plans without reordering their source clocks", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("mixed-writers");
    await repository.create(createInput(tenantA, conversationId, "1", t0));
    const writers = [
      {
        kind: "inbound",
        item: item("mixed-inbound", t3, true),
        receivedAt: t3
      },
      {
        kind: "outbound",
        item: item("mixed-outbound", t1, true),
        receivedAt: t2
      },
      {
        kind: "system",
        item: item("mixed-system", t2, false),
        receivedAt: t3
      }
    ] as const;
    const initialInput = (writer: (typeof writers)[number]) =>
      allocationInput(tenantA, conversationId, "1", "2", t3, [writer.item]);
    let releaseInbound = (): void => undefined;
    let markInboundLocked = (): void => undefined;
    const inboundLocked = new Promise<void>((resolve) => {
      markInboundLocked = resolve;
    });
    const inboundRelease = new Promise<void>((resolve) => {
      releaseInbound = resolve;
    });
    const inbound = writers[0];
    const inboundAttempt = repository.withTimelineSequenceAllocation(
      initialInput(inbound),
      async (context) => {
        await persistAllocatedCallItems(context, initialInput(inbound), {
          [inbound.item.itemId]: inbound.receivedAt
        });
        markInboundLocked();
        await inboundRelease;
        return inbound.kind;
      }
    );
    await inboundLocked;

    let contendersSettled = false;
    const contenderAttempts = Promise.all(
      writers.slice(1).map((writer) =>
        repository.withTimelineSequenceAllocation(
          initialInput(writer),
          async (context) => {
            await persistAllocatedCallItems(context, initialInput(writer), {
              [writer.item.itemId]: writer.receivedAt
            });
            return writer.kind;
          }
        )
      )
    ).finally(() => {
      contendersSettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(contendersSettled).toBe(false);
    releaseInbound();

    const first = await inboundAttempt;
    const contenders = await contenderAttempts;
    expect(first).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "1", lastSequence: "1" },
      result: "inbound"
    });
    expect(contenders.map(({ kind }) => kind)).toEqual([
      "revision_conflict",
      "revision_conflict"
    ]);

    for (const [index, writer] of writers.slice(1).entries()) {
      const current = await repository.findById({
        tenantId: tenantA,
        conversationId
      });
      if (current === null) {
        throw new Error("Mixed-writer Conversation disappeared.");
      }
      const retryInput = allocationInput(
        tenantA,
        conversationId,
        current.aggregate.head.revision,
        String(index + 3),
        t3,
        [writer.item]
      );
      await expect(
        repository.withTimelineSequenceAllocation(
          retryInput,
          async (context) => {
            await persistAllocatedCallItems(context, retryInput, {
              [writer.item.itemId]: writer.receivedAt
            });
            return writer.kind;
          }
        )
      ).resolves.toMatchObject({
        kind: "allocated",
        allocation: {
          firstSequence: String(index + 2),
          lastSequence: String(index + 2)
        },
        result: writer.kind
      });
    }

    const rows = await db.execute<{
      id: string;
      timeline_sequence: string;
      occurred_at: string;
      received_at: string;
    }>(sql`
      select id, timeline_sequence::text as timeline_sequence,
             to_char(occurred_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as occurred_at,
             to_char(received_at at time zone 'UTC',
               'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as received_at
        from inbox_v2_timeline_items
       where tenant_id = ${tenantA}
         and conversation_id = ${conversationId}
       order by timeline_sequence
    `);
    expect(rows.rows).toEqual([
      {
        id: inbound.item.itemId,
        timeline_sequence: "1",
        occurred_at: t3,
        received_at: t3
      },
      {
        id: writers[1].item.itemId,
        timeline_sequence: "2",
        occurred_at: t1,
        received_at: t2
      },
      {
        id: writers[2].item.itemId,
        timeline_sequence: "3",
        occurred_at: t2,
        received_at: t3
      }
    ]);
    expect(
      (await repository.findById({ tenantId: tenantA, conversationId }))
        ?.aggregate.head
    ).toMatchObject({ latestTimelineSequence: "3", revision: "4" });
  });

  it("locks a referenced system event until its Timeline binding commits", async () => {
    const conversationId = conversation("system-event-binding-race");
    const eventId = `event:db001-system-binding-${runId}`;
    const itemId = inboxV2TimelineItemIdSchema.parse(
      `timeline_item:system-binding-${runId}`
    );
    const payload = {
      schemaId: "core:inbox-v2.conversation-system-event-payload",
      schemaVersion: "v1",
      conversation: {
        tenantId: tenantA,
        kind: "conversation",
        id: conversationId
      },
      recordedAt: t2
    };
    const repository = createSqlInboxV2ConversationRepository(db);
    await repository.create(createInput(tenantA, conversationId, "1", t0));
    await db.transaction(async (transaction) => {
      await transaction.execute(
        sql`set local session_replication_role = replica`
      );
      await transaction.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, payload,
          created_at, updated_at
        ) values (
          ${eventId}, ${tenantA}, 'inbox_v2.db001.system_binding', 'v1',
          ${t1}, ${JSON.stringify(payload)}::jsonb, ${t2}, ${t2}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_timeline_items (
          tenant_id, id, conversation_id, timeline_sequence,
          subject_kind, subject_id, visibility, activity_kind,
          activity_reason_id, occurred_at, received_at, revision,
          last_changed_stream_position, created_at, updated_at
        ) values (
          ${tenantA}, ${itemId}, ${conversationId}, 1,
          'system_event', ${eventId}, 'workforce_metadata', 'non_activity',
          'core:system_binding_test', ${t1}, ${t2}, 1, 2, ${t2}, ${t2}
        )
      `);
    });

    let markReferenceLocked = (): void => undefined;
    let releaseReference = (): void => undefined;
    const referenceLocked = new Promise<void>((resolve) => {
      markReferenceLocked = resolve;
    });
    const referenceRelease = new Promise<void>((resolve) => {
      releaseReference = resolve;
    });
    const referenceCommit = db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into inbox_v2_timeline_subject_details (
          tenant_id, timeline_item_id, subject_kind, system_event_id,
          system_actor_id, record_revision, created_at
        ) values (
          ${tenantA}, ${itemId}, 'system_event', ${eventId},
          'trusted_service:db001-binding-test', 1, ${t2}
        )
      `);
      markReferenceLocked();
      await referenceRelease;
    });
    await referenceLocked;

    let updateSettled = false;
    const updateOutcome = db
      .execute(
        sql`
        update event_store
           set payload = payload || '{"tampered":true}'::jsonb,
               updated_at = ${t3}
         where tenant_id = ${tenantA}
           and id = ${eventId}
        returning id
      `
      )
      .then(
        () => ({ kind: "updated" as const, error: null }),
        (error: unknown) => ({ kind: "rejected" as const, error })
      )
      .finally(() => {
        updateSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 100));
    try {
      expect(updateSettled).toBe(false);
    } finally {
      releaseReference();
    }
    await referenceCommit;
    const update = await updateOutcome;
    expect(update.kind).toBe("rejected");
    if (update.kind !== "rejected") {
      throw new Error("Referenced system event update unexpectedly committed.");
    }
    const updateCause =
      update.error instanceof Error && "cause" in update.error
        ? update.error.cause
        : null;
    expect(updateCause).toBeInstanceOf(Error);
    expect((updateCause as Error).message).toContain(
      "inbox_v2.referenced_system_event_immutable"
    );
    const stored = await db.execute<{ payload: unknown }>(sql`
      select payload
        from event_store
       where tenant_id = ${tenantA}
         and id = ${eventId}
    `);
    expect(stored.rows[0]?.payload).toEqual(payload);
  });

  it("rolls a reserved range back with its callback and reuses it on retry", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("rollback");
    await repository.create(createInput(tenantA, conversationId, "1", t0));
    const input = allocationInput(tenantA, conversationId, "1", "2", t1, [
      item("rollback-1", t1, true),
      item("rollback-2", t1, true)
    ]);

    await expect(
      repository.withTimelineSequenceAllocation(input, async (context) => {
        await persistAllocatedCallItems(context, input);
        throw new Error("forced callback rollback");
      })
    ).rejects.toThrow("forced callback rollback");

    const afterRollback = await repository.findById({
      tenantId: tenantA,
      conversationId
    });
    expect(afterRollback?.aggregate.head).toMatchObject({
      latestTimelineSequence: "0",
      revision: "1",
      updatedAt: t0
    });
    expect(afterRollback?.headLastChangedStreamPosition).toBe("1");

    const retry = await repository.withTimelineSequenceAllocation(
      input,
      async (context) => {
        await persistAllocatedCallItems(context, input);
        return context.allocation.firstSequence;
      }
    );

    expect(retry.kind).toBe("allocated");
    if (retry.kind !== "allocated") {
      throw new Error("Expected rollback retry to allocate.");
    }
    expect(retry.allocation).toMatchObject({
      firstSequence: "1",
      lastSequence: "2"
    });
    expect(retry.result).toBe("1");
  });

  it("composes a range into a caller-owned PostgreSQL transaction", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("transaction-local");
    await repository.create(createInput(tenantA, conversationId, "1", t0));
    const input = allocationInput(tenantA, conversationId, "1", "2", t1, [
      item("transaction-local-1", t1, true)
    ]);

    const outcome = await db.transaction((transaction) =>
      allocateInboxV2TimelineRangeInTransaction(
        transaction as unknown as RawSqlExecutor,
        input,
        async (context) => {
          await persistAllocatedCallItems(context, input);
          return context.allocation.firstSequence;
        }
      )
    );

    expect(outcome).toMatchObject({
      kind: "allocated",
      allocation: { firstSequence: "1", lastSequence: "1" },
      result: "1",
      record: {
        aggregate: {
          head: { latestTimelineSequence: "1", revision: "2" }
        }
      }
    });
  });

  it("keeps a waiting allocator blocked and exposes no gap after the holder rolls back", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("rollback-waiter");
    await repository.create(createInput(tenantA, conversationId, "1", t0));

    let releaseHolder = (): void => undefined;
    let markHolderEntered = (): void => undefined;
    const holderEntered = new Promise<void>((resolve) => {
      markHolderEntered = resolve;
    });
    const holderRelease = new Promise<void>((resolve) => {
      releaseHolder = resolve;
    });
    const holderOutcome = repository
      .withTimelineSequenceAllocation(
        allocationInput(tenantA, conversationId, "1", "2", t1, [
          item("rollback-holder", t1, true)
        ]),
        async (context) => {
          await persistAllocatedCallItems(
            context,
            allocationInput(tenantA, conversationId, "1", "2", t1, [
              item("rollback-holder", t1, true)
            ])
          );
          markHolderEntered();
          await holderRelease;
          throw new Error("forced holder rollback");
        }
      )
      .then(
        () => ({ kind: "unexpected_success" as const }),
        (error: unknown) => ({ kind: "rolled_back" as const, error })
      );

    await holderEntered;
    let waiterSettled = false;
    const waiter = repository
      .withTimelineSequenceAllocation(
        allocationInput(tenantA, conversationId, "1", "2", t1, [
          item("rollback-waiter", t1, true)
        ]),
        async (context) => {
          await persistAllocatedCallItems(
            context,
            allocationInput(tenantA, conversationId, "1", "2", t1, [
              item("rollback-waiter", t1, true)
            ])
          );
          return "waiter";
        }
      )
      .finally(() => {
        waiterSettled = true;
      });

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(waiterSettled).toBe(false);

    releaseHolder();
    const [holder, waiterResult] = await Promise.all([holderOutcome, waiter]);

    expect(holder.kind).toBe("rolled_back");
    if (holder.kind === "rolled_back") {
      expect(holder.error).toBeInstanceOf(Error);
      expect((holder.error as Error).message).toBe("forced holder rollback");
    }
    expect(waiterResult.kind).toBe("allocated");
    if (waiterResult.kind !== "allocated") {
      throw new Error("Expected waiting allocator to win after rollback.");
    }
    expect(waiterResult.allocation).toMatchObject({
      firstSequence: "1",
      lastSequence: "1"
    });
    expect(waiterResult.record.aggregate.head).toMatchObject({
      latestTimelineSequence: "1",
      revision: "2"
    });
  });

  it("keeps entity/head revisions and timestamps independent and preserves no-ops", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("independent-revisions");
    await repository.create(createInput(tenantA, conversationId, "1", t0));

    const entityUpdate = await repository.compareAndSet({
      tenantId: tenantA,
      conversationId,
      expectedRevision: revision("1"),
      next: {
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
        lifecycle: "ended"
      },
      streamPosition: position("2"),
      changedAt: t1
    });

    expect(entityUpdate.kind).toBe("updated");
    if (entityUpdate.kind !== "updated") {
      throw new Error("Expected entity CAS update.");
    }
    expect(entityUpdate.record.aggregate).toMatchObject({
      revision: "2",
      updatedAt: t1,
      head: { revision: "1", updatedAt: t0 }
    });

    const headUpdate = await repository.withTimelineSequenceAllocation(
      allocationInput(tenantA, conversationId, "1", "3", t2, [
        item("independent-1", t0, true)
      ]),
      async (context) => {
        await persistAllocatedCallItems(
          context,
          allocationInput(tenantA, conversationId, "1", "3", t2, [
            item("independent-1", t0, true)
          ])
        );
      }
    );

    expect(headUpdate.kind).toBe("allocated");
    if (headUpdate.kind !== "allocated") {
      throw new Error("Expected head allocation.");
    }
    expect(headUpdate.record.aggregate).toMatchObject({
      revision: "2",
      updatedAt: t1,
      head: {
        revision: "2",
        updatedAt: t2,
        latestActivityAt: t0
      }
    });

    const noOp = await repository.compareAndSet({
      tenantId: tenantA,
      conversationId,
      expectedRevision: revision("2"),
      next: {
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
        lifecycle: "ended"
      },
      streamPosition: position("4"),
      changedAt: t3
    });

    expect(noOp.kind).toBe("no_op");
    if (noOp.kind !== "no_op") {
      throw new Error("Expected idempotent entity no-op.");
    }
    expect(noOp.record.entityLastChangedStreamPosition).toBe("2");
    expect(noOp.record.aggregate.updatedAt).toBe(t1);
    expect(noOp.record.aggregate.head.revision).toBe("2");
  });

  it("rejects an impossible bigint head gap and preserves bounded allocation", async () => {
    const repository = createSqlInboxV2ConversationRepository(db);
    const conversationId = conversation("bigint");
    await repository.create(createInput(tenantA, conversationId, "1", t0));
    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql`
          update inbox_v2_conversation_heads
          set latest_timeline_sequence = 9223372036854775805,
              revision = 2,
              last_changed_stream_position = 9007199254740993,
              updated_at = ${t1}
          where tenant_id = ${tenantA}
            and conversation_id = ${conversationId}
        `);
        await transaction.execute(sql`set constraints all immediate`);
      })
    ).rejects.toThrow();

    const input = allocationInput(
      tenantA,
      conversationId,
      "1",
      "9007199254740994",
      t1,
      [item("bigint-1", t1, false), item("bigint-2", t1, false)]
    );
    const allocation = await repository.withTimelineSequenceAllocation(
      input,
      async (context) => {
        await persistAllocatedCallItems(context, input);
      }
    );

    expect(allocation.kind).toBe("allocated");
    if (allocation.kind !== "allocated") {
      throw new Error("Expected max bigint allocation.");
    }
    expect(allocation.allocation).toMatchObject({
      firstSequence: "1",
      lastSequence: "2"
    });
    expect(allocation.record.headLastChangedStreamPosition).toBe(
      "9007199254740994"
    );

    const afterAllocation = await repository.findById({
      tenantId: tenantA,
      conversationId
    });
    expect(afterAllocation?.aggregate.head).toMatchObject({
      latestTimelineSequence: "2",
      revision: "2",
      updatedAt: t1
    });
  });
});

function createInput(
  tenantId: typeof tenantA,
  conversationId: ReturnType<typeof conversation>,
  streamPosition: string,
  createdAt: string
) {
  return {
    tenantId,
    conversationId,
    topology: "direct" as const,
    transport: "external" as const,
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    lifecycle: "active" as const,
    streamPosition: position(streamPosition),
    createdAt
  };
}

function allocationInput(
  tenantId: typeof tenantA,
  conversationId: ReturnType<typeof conversation>,
  expectedHeadRevision: string,
  streamPosition: string,
  changedAt: string,
  items: readonly ReturnType<typeof item>[]
) {
  return {
    tenantId,
    conversationId,
    expectedHeadRevision: revision(expectedHeadRevision),
    items,
    streamPosition: position(streamPosition),
    changedAt
  };
}

function item(id: string, occurredAt: string, activityEligible: boolean) {
  return {
    itemId: inboxV2TimelineItemIdSchema.parse(`timeline_item:${id}`),
    occurredAt,
    activityEligible
  };
}

async function persistAllocatedCallItems(
  context: {
    allocation: InboxV2TimelineRangeAllocation;
    executor: RawSqlExecutor;
  },
  input: AllocateInboxV2TimelineRangeInput,
  receivedAtByItemId: Readonly<Record<string, string>> = {}
): Promise<void> {
  for (const [index, assignment] of context.allocation.assignments.entries()) {
    const allocationItem = input.items[index];
    if (!allocationItem) {
      throw new Error("Timeline allocation fixture lost its matching item.");
    }
    const sourceObjectId = `call:${assignment.itemId}`;
    await context.executor.execute(sql`
      insert into inbox_v2_timeline_items (
        tenant_id, id, conversation_id, timeline_sequence,
        subject_kind, subject_id, visibility, activity_kind,
        activity_reason_id, occurred_at, received_at, revision,
        last_changed_stream_position, created_at, updated_at
      ) values (
        ${input.tenantId}, ${assignment.itemId}, ${input.conversationId},
        ${assignment.timelineSequence}, 'call', ${sourceObjectId},
        'source_item_policy',
        ${allocationItem.activityEligible ? "eligible" : "non_activity"},
        ${allocationItem.activityEligible ? null : "core:db001_fixture"},
        ${allocationItem.occurredAt},
        ${receivedAtByItemId[assignment.itemId] ?? input.changedAt}, 1,
        ${input.streamPosition}, ${input.changedAt}, ${input.changedAt}
      )
    `);
    await context.executor.execute(sql`
      insert into inbox_v2_timeline_subject_details (
        tenant_id, timeline_item_id, subject_kind, source_object_id,
        source_object_kind_id, source_object_revision, record_revision,
        created_at
      ) values (
        ${input.tenantId}, ${assignment.itemId}, 'call', ${sourceObjectId},
        'core:call', 1, 1, ${input.changedAt}
      )
    `);
  }
}

function conversation(id: string) {
  return inboxV2ConversationIdSchema.parse(`conversation:db001-${id}-${runId}`);
}

function position(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}

function revision(value: string) {
  return inboxV2EntityRevisionSchema.parse(value);
}
