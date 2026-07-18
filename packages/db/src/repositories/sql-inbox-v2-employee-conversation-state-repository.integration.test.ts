import {
  inboxV2BigintCounterSchema,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2TenantIdSchema,
  inboxV2TimelineItemIdSchema,
  inboxV2TimelineSequenceSchema
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import {
  createSqlInboxV2EmployeeConversationStateRepository,
  type RawSqlExecutor
} from "./sql-inbox-v2-employee-conversation-state-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantA = tenant(`tenant:db006-a-${runId}`);
const tenantB = tenant(`tenant:db006-b-${runId}`);
const employeeA = employee(`employee:db006-a-${runId}`);
const employeeB = employee(`employee:db006-b-${runId}`);
const mainConversation = conversation(`main-${runId}`);
const otherConversation = conversation(`other-${runId}`);
const sharedConversation = conversation(`shared-${runId}`);
const rollbackConversation = conversation(`rollback-${runId}`);
const t0 = "2026-07-15T08:00:00.000Z";
const t1 = "2026-07-15T08:01:00.000Z";
const t2 = "2026-07-15T08:02:00.000Z";
const t3 = "2026-07-15T08:03:00.000Z";
const t4 = "2026-07-15T08:04:00.000Z";
const t5 = "2026-07-15T08:05:00.000Z";

describePostgres(
  "SQL Inbox V2 EmployeeConversationState repository (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      const databaseUrl = process.env.DATABASE_URL;
      if (!databaseUrl) {
        throw new Error(
          "DATABASE_URL is required for the DB-006 repository integration test."
        );
      }

      db = createHuleeDatabase({
        connectionString: databaseUrl,
        poolConfig: { max: 4 }
      });
      const readiness = await db.execute<{
        stateTable: string | null;
        receiptTable: string | null;
      }>(sql`
        select
          to_regclass('public.inbox_v2_employee_conversation_states')::text
            as "stateTable",
          to_regclass('public.inbox_v2_provider_receipt_observations')::text
            as "receiptTable"
      `);
      expect(readiness.rows[0]).toEqual({
        stateTable: "inbox_v2_employee_conversation_states",
        receiptTable: "inbox_v2_provider_receipt_observations"
      });

      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          insert into tenants (id, slug, display_name, deployment_type)
          values
            (${tenantA}, ${`db006-a-${runId}`}, 'DB006 tenant A', 'saas_shared'),
            (${tenantB}, ${`db006-b-${runId}`}, 'DB006 tenant B', 'saas_shared')
        `);
        await transaction.execute(sql`
          insert into employees (
            id, tenant_id, email, display_name, profile, created_at, updated_at
          ) values
            (
              ${employeeA}, ${tenantA}, ${`db006-a-${runId}@example.test`},
              'DB006 employee A', '{}'::jsonb, ${t0}, ${t0}
            ),
            (
              ${employeeB}, ${tenantB}, ${`db006-b-${runId}@example.test`},
              'DB006 employee B', '{}'::jsonb, ${t0}, ${t0}
            )
        `);
      });

      const conversations = createSqlInboxV2ConversationRepository(db);
      await createConversation(conversations, tenantA, mainConversation);
      await createConversation(conversations, tenantA, otherConversation);
      await createConversation(conversations, tenantA, sharedConversation);
      await createConversation(conversations, tenantB, sharedConversation);
      await createConversation(conversations, tenantA, rollbackConversation);

      await seedReadTargets(db, tenantA, mainConversation, "a-main", [80, 100]);
      await seedReadTargets(db, tenantA, otherConversation, "a-other", [120]);
      await seedReadTargets(db, tenantA, sharedConversation, "a-shared", [100]);
      await seedReadTargets(db, tenantB, sharedConversation, "b-shared", [100]);
      await seedReadTargets(
        db,
        tenantA,
        rollbackConversation,
        "a-rollback",
        [50]
      );
    }, 120_000);

    afterAll(async () => {
      if (db) await closeHuleeDatabase(db);
    });

    it("serializes lower/higher device cursors and preserves manual unread independently of provider receipts", async () => {
      const repository =
        createSqlInboxV2EmployeeConversationStateRepository(db);
      const key = {
        tenantId: tenantA,
        employeeId: employeeA,
        conversationId: mainConversation
      };
      const preferenceEvent = `event:db006-pref-main-${runId}`;
      const preference = await repository.compareAndSetPreferences(
        {
          ...key,
          expectedRevision: null,
          patch: { manualUnread: true, notificationLevel: "mentions_only" },
          changedAt: t2
        },
        async ({ executor }) => {
          await insertStateEvent(executor, tenantA, preferenceEvent, t2);
          return { streamPosition: position("1"), result: preferenceEvent };
        }
      );
      expect(preference).toMatchObject({
        kind: "updated",
        record: {
          state: {
            lastReadSequence: "0",
            manualUnread: true,
            notificationLevel: "mentions_only",
            revision: "1"
          },
          lastChangedStreamPosition: "1"
        }
      });

      const receiptCountBefore = await providerReceiptCount(db, tenantA);
      const read80Event = `event:db006-read-80-${runId}`;
      const read100Event = `event:db006-read-100-${runId}`;
      const commit80 = vi.fn(
        async ({ executor }: { executor: RawSqlExecutor }) => {
          await insertStateEvent(executor, tenantA, read80Event, t3);
          return { streamPosition: position("2"), result: read80Event };
        }
      );
      const commit100 = vi.fn(
        async ({ executor }: { executor: RawSqlExecutor }) => {
          await insertStateEvent(executor, tenantA, read100Event, t4);
          return { streamPosition: position("3"), result: read100Event };
        }
      );

      const [lower, higher] = await Promise.all([
        repository.markReadThrough(
          { ...key, sequence: sequence("80"), changedAt: t3 },
          commit80
        ),
        repository.markReadThrough(
          { ...key, sequence: sequence("100"), changedAt: t4 },
          commit100
        )
      ]);

      expect(higher.kind).toBe("advanced");
      expect(["advanced", "already_applied"]).toContain(lower.kind);
      expect(commit100).toHaveBeenCalledTimes(1);
      expect(commit80.mock.calls.length).toBeLessThanOrEqual(1);

      const final = await repository.find(key);
      expect(final).toMatchObject({
        state: {
          lastReadSequence: "100",
          lastReadAt: t4,
          manualUnread: true,
          manualUnreadChangedAt: t2,
          notificationLevel: "mentions_only"
        },
        lastChangedStreamPosition: "3"
      });
      expect(["2", "3"]).toContain(final?.state.revision);
      expect(await providerReceiptCount(db, tenantA)).toBe(receiptCountBefore);
      expect(await eventCount(db, tenantA, [read80Event, read100Event])).toBe(
        commit80.mock.calls.length + 1
      );

      const lowerNoOpCommit = vi.fn();
      const lowerNoOp = await repository.markReadThrough(
        { ...key, sequence: sequence("80"), changedAt: t5 },
        lowerNoOpCommit
      );
      expect(lowerNoOp.kind).toBe("already_applied");
      expect(lowerNoOpCommit).not.toHaveBeenCalled();
      expect(await repository.find(key)).toEqual(final);

      const wrongConversationCommit = vi.fn();
      await expect(
        repository.markReadThrough(
          { ...key, sequence: sequence("120"), changedAt: t5 },
          wrongConversationCommit
        )
      ).resolves.toEqual({ kind: "not_found" });
      expect(wrongConversationCommit).not.toHaveBeenCalled();
      expect(await repository.find(key)).toEqual(final);
    });

    it("keeps the same conversation ID isolated by tenant and employee", async () => {
      const repository =
        createSqlInboxV2EmployeeConversationStateRepository(db);
      const keyA = {
        tenantId: tenantA,
        employeeId: employeeA,
        conversationId: sharedConversation
      };
      const keyB = {
        tenantId: tenantB,
        employeeId: employeeB,
        conversationId: sharedConversation
      };

      await expect(
        repository.compareAndSetPreferences(
          {
            ...keyA,
            expectedRevision: null,
            patch: { pinned: true },
            changedAt: t2
          },
          async () => ({ streamPosition: position("1"), result: null })
        )
      ).resolves.toMatchObject({ kind: "updated" });
      await expect(
        repository.compareAndSetPreferences(
          {
            ...keyB,
            expectedRevision: null,
            patch: { muted: true },
            changedAt: t2
          },
          async () => ({ streamPosition: position("1"), result: null })
        )
      ).resolves.toMatchObject({ kind: "updated" });

      await expect(
        repository.markReadThrough(
          { ...keyA, sequence: sequence("100"), changedAt: t3 },
          async () => ({ streamPosition: position("2"), result: "a" })
        )
      ).resolves.toMatchObject({ kind: "advanced", result: "a" });
      expect(await repository.find(keyA)).toMatchObject({
        state: { lastReadSequence: "100", pinned: true, muted: false }
      });
      expect(await repository.find(keyB)).toMatchObject({
        state: { lastReadSequence: "0", pinned: false, muted: true }
      });

      await expect(
        repository.markReadThrough(
          { ...keyB, sequence: sequence("100"), changedAt: t3 },
          async () => ({ streamPosition: position("2"), result: "b" })
        )
      ).resolves.toMatchObject({ kind: "advanced", result: "b" });
      expect(await repository.find(keyA)).toMatchObject({
        state: { lastReadSequence: "100", pinned: true, muted: false }
      });
      expect(await repository.find(keyB)).toMatchObject({
        state: { lastReadSequence: "100", pinned: false, muted: true }
      });

      const crossTenantCommit = vi.fn();
      await expect(
        repository.markReadThrough(
          {
            tenantId: tenantA,
            employeeId: employeeB,
            conversationId: sharedConversation,
            sequence: sequence("100"),
            changedAt: t4
          },
          crossTenantCommit
        )
      ).resolves.toEqual({ kind: "not_found" });
      expect(crossTenantCommit).not.toHaveBeenCalled();
      await expect(
        repository.find({
          tenantId: tenantA,
          employeeId: employeeB,
          conversationId: sharedConversation
        })
      ).resolves.toBeNull();
    });

    it("rolls callback writes and read advancement back together, then releases the advisory lock", async () => {
      const repository =
        createSqlInboxV2EmployeeConversationStateRepository(db);
      const key = {
        tenantId: tenantA,
        employeeId: employeeA,
        conversationId: rollbackConversation
      };
      await repository.compareAndSetPreferences(
        {
          ...key,
          expectedRevision: null,
          patch: { manualUnread: true },
          changedAt: t2
        },
        async () => ({ streamPosition: position("1"), result: null })
      );
      const before = await repository.find(key);
      const rolledBackEvent = `event:db006-rollback-${runId}`;

      await expect(
        repository.markReadThrough(
          { ...key, sequence: sequence("50"), changedAt: t3 },
          async ({ executor }) => {
            await insertStateEvent(executor, tenantA, rolledBackEvent, t3);
            throw new Error("forced DB006 callback rollback");
          }
        )
      ).rejects.toThrow("forced DB006 callback rollback");

      expect(await repository.find(key)).toEqual(before);
      expect(await eventCount(db, tenantA, [rolledBackEvent])).toBe(0);

      const retry = await repository.markReadThrough(
        { ...key, sequence: sequence("50"), changedAt: t3 },
        async () => ({ streamPosition: position("2"), result: "retry" })
      );
      expect(retry).toMatchObject({
        kind: "advanced",
        result: "retry",
        record: {
          state: {
            lastReadSequence: "50",
            manualUnread: true,
            revision: "2"
          },
          lastChangedStreamPosition: "2"
        }
      });
    });

    it("has no state-table receipt columns or direct receipt foreign keys", async () => {
      const result = await db.execute<{
        receiptColumns: number;
        receiptForeignKeys: number;
      }>(sql`
        select
          (
            select count(*)::int
              from information_schema.columns
             where table_schema = 'public'
               and table_name = 'inbox_v2_employee_conversation_states'
               and column_name like '%receipt%'
          ) as "receiptColumns",
          (
            select count(*)::int
              from pg_catalog.pg_constraint constraint_definition
             where constraint_definition.contype = 'f'
               and (
                 (
                   constraint_definition.conrelid =
                     'public.inbox_v2_employee_conversation_states'::regclass
                   and constraint_definition.confrelid =
                     'public.inbox_v2_provider_receipt_observations'::regclass
                 ) or (
                   constraint_definition.conrelid =
                     'public.inbox_v2_provider_receipt_observations'::regclass
                   and constraint_definition.confrelid =
                     'public.inbox_v2_employee_conversation_states'::regclass
                 )
               )
          ) as "receiptForeignKeys"
      `);

      expect(result.rows[0]).toEqual({
        receiptColumns: 0,
        receiptForeignKeys: 0
      });
    });
  }
);

async function createConversation(
  repository: ReturnType<typeof createSqlInboxV2ConversationRepository>,
  tenantId: typeof tenantA,
  conversationId: typeof mainConversation
): Promise<void> {
  const result = await repository.create({
    tenantId,
    conversationId,
    topology: "direct",
    transport: "external",
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:chat"),
    streamPosition: position("1"),
    createdAt: t0
  });
  expect(result.kind).toBe("created");
}

async function seedReadTargets(
  db: HuleeDatabase,
  tenantId: typeof tenantA,
  conversationId: typeof mainConversation,
  label: string,
  targets: readonly number[]
): Promise<void> {
  const latest = Math.max(...targets);
  await db.transaction(async (transaction) => {
    await transaction.execute(sql`
      update inbox_v2_conversation_heads
         set latest_timeline_sequence = ${latest},
             revision = 2,
             last_changed_stream_position = 2,
             updated_at = ${t1}
       where tenant_id = ${tenantId}
         and conversation_id = ${conversationId}
    `);

    // A committed Conversation timeline is contiguous even when this fixture
    // only exercises a sparse set of read targets.
    for (let target = 1; target <= latest; target += 1) {
      const eventId = `event:db006-target-${label}-${target}-${runId}`;
      const itemId = timelineItem(`target-${label}-${target}-${runId}`);
      await transaction.execute(sql`
        insert into event_store (
          id, tenant_id, type, version, occurred_at, payload,
          created_at, updated_at
        ) values (
          ${eventId}, ${tenantId}, 'inbox_v2.db006.read_target', 'v1', ${t0},
          ${JSON.stringify({
            schemaId: "core:inbox-v2.conversation-system-event-payload",
            schemaVersion: "v1",
            conversation: {
              tenantId,
              kind: "conversation",
              id: conversationId
            },
            recordedAt: t1,
            sequence: target
          })}::jsonb, ${t1}, ${t1}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_timeline_items (
          tenant_id, id, conversation_id, timeline_sequence,
          subject_kind, subject_id, visibility, activity_kind,
          activity_reason_id, occurred_at, received_at, revision,
          last_changed_stream_position, created_at, updated_at
        ) values (
          ${tenantId}, ${itemId}, ${conversationId}, ${target},
          'system_event', ${eventId}, 'workforce_metadata', 'non_activity',
          'core:db006_read_fixture', ${t0}, ${t1}, 1, 2, ${t1}, ${t1}
        )
      `);
      await transaction.execute(sql`
        insert into inbox_v2_timeline_subject_details (
          tenant_id, timeline_item_id, subject_kind, system_event_id,
          system_actor_id, record_revision, created_at
        ) values (
          ${tenantId}, ${itemId}, 'system_event', ${eventId},
          'trusted_service:db006-fixture', 1, ${t1}
        )
      `);
    }
  });
}

async function insertStateEvent(
  executor: RawSqlExecutor,
  tenantId: typeof tenantA,
  eventId: string,
  occurredAt: string
): Promise<void> {
  await executor.execute(sql`
    insert into event_store (
      id, tenant_id, type, version, occurred_at, payload,
      created_at, updated_at
    ) values (
      ${eventId}, ${tenantId}, 'inbox_v2.employee_conversation_state.changed',
      'v1', ${occurredAt}, '{}'::jsonb, ${occurredAt}, ${occurredAt}
    )
  `);
}

async function providerReceiptCount(
  db: HuleeDatabase,
  tenantId: typeof tenantA
): Promise<number> {
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
      from inbox_v2_provider_receipt_observations
     where tenant_id = ${tenantId}
  `);
  return result.rows[0]?.count ?? -1;
}

async function eventCount(
  db: HuleeDatabase,
  tenantId: typeof tenantA,
  eventIds: readonly string[]
): Promise<number> {
  if (eventIds.length === 0) return 0;
  const eventIdList = sql.join(
    eventIds.map((eventId) => sql`${eventId}`),
    sql`, `
  );
  const result = await db.execute<{ count: number }>(sql`
    select count(*)::int as count
      from event_store
     where tenant_id = ${tenantId}
       and id in (${eventIdList})
  `);
  return result.rows[0]?.count ?? -1;
}

function tenant(value: string) {
  return inboxV2TenantIdSchema.parse(value);
}

function employee(value: string) {
  return inboxV2EmployeeIdSchema.parse(value);
}

function conversation(value: string) {
  return inboxV2ConversationIdSchema.parse(`conversation:db006-${value}`);
}

function timelineItem(value: string) {
  return inboxV2TimelineItemIdSchema.parse(`timeline_item:db006-${value}`);
}

function sequence(value: string) {
  return inboxV2TimelineSequenceSchema.parse(value);
}

function position(value: string) {
  return inboxV2BigintCounterSchema.parse(value);
}
