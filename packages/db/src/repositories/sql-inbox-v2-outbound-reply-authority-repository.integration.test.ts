import { createHash } from "node:crypto";

import {
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkItemTransitionCommitSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2WorkQueueSchema,
  type InboxV2ConversationWorkItemSlot,
  type InboxV2WorkItem
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import {
  buildLockInboxV2OutboundReplyAuthorityConversationSql,
  buildLockInboxV2OutboundReplyAuthorityWorkHeadSql,
  buildLockInboxV2OutboundReplyAuthoritySlotSql,
  evaluateInboxV2NoWorkItemReplyAuthorityHeadFence,
  evaluateInboxV2NoWorkItemReplyAuthorityFence,
  type InboxV2OutboundReplyAuthoritySlotRow,
  type InboxV2OutboundReplyAuthorityWorkHeadRow
} from "./sql-inbox-v2-outbound-reply-authority-repository";
import {
  buildAdvanceInboxV2ConversationWorkHeadIntakeSql,
  createSqlInboxV2WorkItemRepository,
  type InboxV2WorkItemTransactionExecutor
} from "./sql-inbox-v2-work-item-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:msg002-fence-${runId}`);
const queueId = inboxV2WorkQueueIdSchema.parse(
  `work_queue:msg002-fence-${runId}`
);
const orgUnitId = `org_unit:msg002-fence-${runId}`;
const t0 = "2026-07-18T09:00:00.000Z";
const t1 = "2026-07-18T09:01:00.000Z";
const t2 = "2026-07-18T09:02:00.000Z";

describePostgres(
  "SQL Inbox V2 outbound reply-authority fence (PostgreSQL)",
  () => {
    let db: HuleeDatabase;

    beforeAll(async () => {
      db = createHuleeDatabase();
      const readiness = await db.execute<{ slot: string | null }>(sql`
        select to_regclass(
          'public.inbox_v2_conversation_work_item_slots'
        )::text as slot
      `);
      if (readiness.rows[0]?.slot === null) {
        throw new Error("Inbox V2 WorkItem slots are not migrated.");
      }
      await db.transaction(async (transaction) => {
        await transaction.execute(sql`
          insert into tenants (id, slug, display_name, deployment_type)
          values (
            ${tenantId}, ${`msg002-fence-${runId}`},
            'MSG002 reply fence tenant', 'saas_shared'
          )
        `);
        await transaction.execute(sql`
          insert into org_units (
            id, tenant_id, name, kind, status, created_at, updated_at
          ) values (
            ${orgUnitId}, ${tenantId}, 'MSG002 support', 'department',
            'active', ${t0}, ${t0}
          )
        `);
        await transaction.execute(sql`
          insert into work_queues (
            id, tenant_id, name, kind, owning_org_unit_id, status,
            routing_config, created_at, updated_at
          ) values (
            ${queueId}, ${tenantId}, 'MSG002 queue', 'support', ${orgUnitId},
            'active', '{}'::jsonb, ${t0}, ${t0}
          )
        `);
      });
    });

    afterAll(async () => {
      if (!db) return;
      try {
        await deleteTestTenantGraph(db);
      } finally {
        await closeHuleeDatabase(db);
      }
    });

    it("keeps a freshly bootstrapped Conversation pending until an explicit no-work decision", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-pending-${runId}`
      );
      const created = await createSqlInboxV2ConversationRepository(db).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(created.kind).toBe("created");

      const result = await db.transaction(async (transaction) => {
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        return evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
      });

      expect(result).toEqual({
        kind: "rejected",
        reason: "work_intake_not_no_work"
      });
    });

    it("accepts only the exact explicit no-work high-water and rejects its stale replay", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-no-work-${runId}`
      );
      const created = await createSqlInboxV2ConversationRepository(db).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(created.kind).toBe("created");

      await db.transaction(async (transaction) => {
        const advanced = await transaction.execute<{ id: unknown }>(
          buildAdvanceInboxV2ConversationWorkHeadIntakeSql({
            tenantId,
            conversationId,
            expectedWorkItemCount: "0",
            expectedIntakeDecisionHighWater: "0",
            expectedHeadRevision: "1",
            resultingIntakeDecisionHighWater: "1",
            outcome: "no_work_item",
            decidedAt: t1
          })
        );
        expect(advanced.rows).toHaveLength(1);
      });

      const exact = await db.transaction(async (transaction) => {
        const slotId = conversationWorkItemSlotId(conversationId);
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        const headFence = evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
        if (headFence.kind === "rejected") return headFence;
        const slot =
          await transaction.execute<InboxV2OutboundReplyAuthoritySlotRow>(
            buildLockInboxV2OutboundReplyAuthoritySlotSql({
              tenantId,
              slotId
            })
          );
        return evaluateInboxV2NoWorkItemReplyAuthorityFence({
          tenantId,
          conversationId,
          slotId,
          expectedSlotRevision: "1",
          row: slot.rows[0] ?? null
        });
      });
      expect(exact).toEqual({
        kind: "committed",
        authorityKind: "no_work_item"
      });

      await db.transaction(async (transaction) => {
        const advanced = await transaction.execute<{ id: unknown }>(
          buildAdvanceInboxV2ConversationWorkHeadIntakeSql({
            tenantId,
            conversationId,
            expectedWorkItemCount: "0",
            expectedIntakeDecisionHighWater: "1",
            expectedHeadRevision: "2",
            resultingIntakeDecisionHighWater: "2",
            outcome: "no_work_item",
            decidedAt: t2
          })
        );
        expect(advanced.rows).toHaveLength(1);
      });

      const stale = await db.transaction(async (transaction) => {
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        return evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
      });
      expect(stale).toEqual({
        kind: "rejected",
        reason: "intake_decision_stale"
      });
    });

    it("rolls back a stranded new-writer materialization marker", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-stranded-${runId}`
      );
      const created = await createSqlInboxV2ConversationRepository(db).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(created.kind).toBe("created");

      await expect(
        db.transaction(async (transaction) => {
          const advanced = await transaction.execute<{ id: unknown }>(
            buildAdvanceInboxV2ConversationWorkHeadIntakeSql({
              tenantId,
              conversationId,
              expectedWorkItemCount: "0",
              expectedIntakeDecisionHighWater: "0",
              expectedHeadRevision: "1",
              resultingIntakeDecisionHighWater: "1",
              outcome: "create_work_item",
              decidedAt: t1
            })
          );
          expect(advanced.rows).toHaveLength(1);
        })
      ).rejects.toMatchObject({ cause: { code: "23514" } });

      const head = await db.execute<{
        current_outcome: string;
        intake_decision_high_water: string;
        pending_materialization_ordinal: string | null;
        revision: string;
      }>(sql`
        select current_outcome, intake_decision_high_water,
               pending_materialization_ordinal, revision
        from inbox_v2_conversation_work_heads
        where tenant_id = ${tenantId} and conversation_id = ${conversationId}
      `);
      expect(head.rows[0]).toEqual({
        current_outcome: "pending_intake",
        intake_decision_high_water: "0",
        pending_materialization_ordinal: null,
        revision: "1"
      });
    });

    it("retries one rolled-back serialization failure without double-advancing the Work head", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-retry-${runId}`
      );
      const createdConversation = await createSqlInboxV2ConversationRepository(
        db
      ).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(createdConversation.kind).toBe("created");

      let transactionAttempts = 0;
      const retryingExecutor: InboxV2WorkItemTransactionExecutor = {
        execute: (query) => asRawSqlExecutor(db).execute(query),
        transaction: (work, config) =>
          db.transaction(async (transaction) => {
            const result = await work(asRawSqlExecutor(transaction));
            transactionAttempts += 1;
            if (transactionAttempts === 1) {
              throw Object.assign(new Error("forced serialization rollback"), {
                code: "40001"
              });
            }
            return result;
          }, config)
      };
      const creation = creationCommit(conversationId, "retry", t1);
      await expect(
        createSqlInboxV2WorkItemRepository(retryingExecutor).createWorkItem(
          creation
        )
      ).resolves.toMatchObject({
        kind: "created",
        workItem: { id: creation.createdWorkItem.id, ordinal: "1" },
        slot: { revision: "2" }
      });
      expect(transactionAttempts).toBe(2);

      const durable = await db.execute<{
        work_item_count: string;
        intake_decision_high_water: string;
        pending_materialization_ordinal: string | null;
        revision: string;
        work_item_rows: string;
        creation_decision_rows: string;
      }>(sql`
        select head.work_item_count, head.intake_decision_high_water,
               head.pending_materialization_ordinal, head.revision,
               (
                 select count(*)::bigint
                 from inbox_v2_work_items work_item
                 where work_item.tenant_id = ${tenantId}
                   and work_item.conversation_id = ${conversationId}
               ) as work_item_rows,
               (
                 select count(*)::bigint
                 from inbox_v2_work_item_creation_decisions decision
                 where decision.tenant_id = ${tenantId}
                   and decision.conversation_id = ${conversationId}
               ) as creation_decision_rows
        from inbox_v2_conversation_work_heads head
        where head.tenant_id = ${tenantId}
          and head.conversation_id = ${conversationId}
      `);
      expect(durable.rows).toEqual([
        {
          work_item_count: "1",
          intake_decision_high_water: "1",
          pending_materialization_ordinal: null,
          revision: "3",
          work_item_rows: "1",
          creation_decision_rows: "1"
        }
      ]);
    });

    it("waits for concurrent WorkItem creation and rejects the stale no-work slot", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-${runId}`
      );
      const createdConversation = await createSqlInboxV2ConversationRepository(
        db
      ).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(createdConversation.kind).toBe("created");

      await db.transaction(async (transaction) => {
        const advanced = await transaction.execute<{ id: unknown }>(
          buildAdvanceInboxV2ConversationWorkHeadIntakeSql({
            tenantId,
            conversationId,
            expectedWorkItemCount: "0",
            expectedIntakeDecisionHighWater: "0",
            expectedHeadRevision: "1",
            resultingIntakeDecisionHighWater: "1",
            outcome: "no_work_item",
            decidedAt: t1
          })
        );
        expect(advanced.rows).toHaveLength(1);
      });

      const creation = creationCommit(conversationId, "race", t2);
      let releaseCreation!: () => void;
      let markCreationLocked!: () => void;
      let creationBackendPid!: number;
      const creationLocked = new Promise<void>((resolve) => {
        markCreationLocked = resolve;
      });
      const creationRelease = new Promise<void>((resolve) => {
        releaseCreation = resolve;
      });
      const creationPromise = createSqlInboxV2WorkItemRepository(
        db
      ).withCreationCommit(creation, async ({ executor }) => {
        creationBackendPid = await readBackendPid(executor);
        markCreationLocked();
        await creationRelease;
        return { observed: "creation-locked" } as const;
      });
      await creationLocked;

      let markFenceStarted!: () => void;
      let fenceBackendPid!: number;
      const fenceStarted = new Promise<void>((resolve) => {
        markFenceStarted = resolve;
      });
      const fencePromise = db.transaction(async (transaction) => {
        fenceBackendPid = await readBackendPid(transaction);
        markFenceStarted();
        const conversation = await transaction.execute(
          buildLockInboxV2OutboundReplyAuthorityConversationSql({
            tenantId,
            conversationId
          })
        );
        expect(conversation.rows).toHaveLength(1);
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        const headFence = evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
        if (headFence.kind === "rejected") return headFence;
        const slot =
          await transaction.execute<InboxV2OutboundReplyAuthoritySlotRow>(
            buildLockInboxV2OutboundReplyAuthoritySlotSql({
              tenantId,
              slotId: creation.slotBefore.id
            })
          );
        return evaluateInboxV2NoWorkItemReplyAuthorityFence({
          tenantId,
          conversationId,
          slotId: creation.slotBefore.id,
          expectedSlotRevision: creation.slotBefore.revision,
          row: slot.rows[0] ?? null
        });
      });
      await fenceStarted;
      try {
        await expectBackendBlockedBy(db, fenceBackendPid, creationBackendPid);
      } finally {
        releaseCreation();
      }
      await expect(creationPromise).resolves.toMatchObject({
        kind: "created",
        workItem: { id: creation.createdWorkItem.id },
        slot: { revision: "2" },
        result: { observed: "creation-locked" }
      });
      await expect(fencePromise).resolves.toEqual({
        kind: "rejected",
        reason: "work_intake_not_no_work"
      });
    });

    it("lets a head-and-slot fenced no-work reply commit before concurrent WorkItem creation", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-reply-wins-${runId}`
      );
      const createdConversation = await createSqlInboxV2ConversationRepository(
        db
      ).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(createdConversation.kind).toBe("created");

      await db.transaction(async (transaction) => {
        const advanced = await transaction.execute<{ id: unknown }>(
          buildAdvanceInboxV2ConversationWorkHeadIntakeSql({
            tenantId,
            conversationId,
            expectedWorkItemCount: "0",
            expectedIntakeDecisionHighWater: "0",
            expectedHeadRevision: "1",
            resultingIntakeDecisionHighWater: "1",
            outcome: "no_work_item",
            decidedAt: t1
          })
        );
        expect(advanced.rows).toHaveLength(1);
      });

      const creation = creationCommit(conversationId, "reply-wins", t2);
      let releaseFence!: () => void;
      let markFenceLocked!: () => void;
      let fenceBackendPid!: number;
      const fenceLocked = new Promise<void>((resolve) => {
        markFenceLocked = resolve;
      });
      const fenceRelease = new Promise<void>((resolve) => {
        releaseFence = resolve;
      });
      const fencePromise = db.transaction(async (transaction) => {
        fenceBackendPid = await readBackendPid(transaction);
        const conversation = await transaction.execute(
          buildLockInboxV2OutboundReplyAuthorityConversationSql({
            tenantId,
            conversationId
          })
        );
        expect(conversation.rows).toHaveLength(1);
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        const headFence = evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
        if (headFence.kind === "rejected") return headFence;
        const slot =
          await transaction.execute<InboxV2OutboundReplyAuthoritySlotRow>(
            buildLockInboxV2OutboundReplyAuthoritySlotSql({
              tenantId,
              slotId: creation.slotBefore.id
            })
          );
        const slotFence = evaluateInboxV2NoWorkItemReplyAuthorityFence({
          tenantId,
          conversationId,
          slotId: creation.slotBefore.id,
          expectedSlotRevision: creation.slotBefore.revision,
          row: slot.rows[0] ?? null
        });
        markFenceLocked();
        await fenceRelease;
        return slotFence;
      });
      await fenceLocked;

      let markCreationStarted!: () => void;
      let creationBackendPid!: number;
      const creationStarted = new Promise<void>((resolve) => {
        markCreationStarted = resolve;
      });
      const observedExecutor = observeWorkItemTransactionBackend(db, (pid) => {
        creationBackendPid = pid;
        markCreationStarted();
      });
      const creationPromise =
        createSqlInboxV2WorkItemRepository(observedExecutor).createWorkItem(
          creation
        );
      await creationStarted;
      try {
        await expectBackendBlockedBy(db, creationBackendPid, fenceBackendPid);
      } finally {
        releaseFence();
      }
      await expect(fencePromise).resolves.toEqual({
        kind: "committed",
        authorityKind: "no_work_item"
      });
      await expect(creationPromise).resolves.toMatchObject({
        kind: "created",
        workItem: { id: creation.createdWorkItem.id }
      });
    });

    it("rejects a terminal history and supports a second sequential WorkItem without reusing decision revision as high-water", async () => {
      const conversationId = inboxV2ConversationIdSchema.parse(
        `conversation:msg002-fence-terminal-${runId}`
      );
      const createdConversation = await createSqlInboxV2ConversationRepository(
        db
      ).create({
        tenantId,
        conversationId,
        topology: "direct",
        transport: "external",
        purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
        lifecycle: "active",
        streamPosition: "1" as never,
        createdAt: t0
      });
      expect(createdConversation.kind).toBe("created");

      const repository = createSqlInboxV2WorkItemRepository(db);
      const created = await repository.createWorkItem(
        creationCommit(conversationId, "terminal")
      );
      expect(created.kind).toBe("created");
      if (created.kind !== "created") {
        throw new Error(`Expected WorkItem create, got ${created.kind}.`);
      }
      const close = terminalCloseCommit(
        { workItem: created.workItem, slot: created.slot },
        "terminal",
        t1
      );
      await expect(repository.applyTransition(close)).resolves.toMatchObject({
        kind: "applied",
        workItem: { operationalState: { state: "resolved" } },
        slot: {
          latestWorkItem: { lifecycleClass: "terminal" },
          currentNonTerminalWorkItem: null
        }
      });

      const result = await db.transaction(async (transaction) => {
        const head =
          await transaction.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
            buildLockInboxV2OutboundReplyAuthorityWorkHeadSql({
              tenantId,
              conversationId
            })
          );
        const headFence = evaluateInboxV2NoWorkItemReplyAuthorityHeadFence({
          tenantId,
          conversationId,
          expectedIntakeDecisionRevision: "1",
          row: head.rows[0] ?? null
        });
        if (headFence.kind === "rejected") return headFence;
        const slot =
          await transaction.execute<InboxV2OutboundReplyAuthoritySlotRow>(
            buildLockInboxV2OutboundReplyAuthoritySlotSql({
              tenantId,
              slotId: close.slotAfter.id
            })
          );
        return evaluateInboxV2NoWorkItemReplyAuthorityFence({
          tenantId,
          conversationId,
          slotId: close.slotAfter.id,
          expectedSlotRevision: close.slotAfter.revision,
          row: slot.rows[0] ?? null
        });
      });

      expect(result).toEqual({
        kind: "rejected",
        reason: "work_intake_not_no_work"
      });

      const secondCommit = sequentialCreationCommit(
        conversationId,
        close.after,
        close.slotAfter
      );
      expect(secondCommit.intakeDecision.decisionRevision).toBe("1");
      await expect(
        repository.createWorkItem(secondCommit)
      ).resolves.toMatchObject({
        kind: "created",
        workItem: { ordinal: "2" },
        slot: { latestOrdinal: "2", revision: "4" }
      });

      const head = await db.execute<InboxV2OutboundReplyAuthorityWorkHeadRow>(
        sql`
          select tenant_id, id, conversation_id, work_item_count,
                 current_outcome, intake_decision_high_water,
                 pending_materialization_ordinal, revision
          from inbox_v2_conversation_work_heads
          where tenant_id = ${tenantId} and conversation_id = ${conversationId}
        `
      );
      expect(head.rows).toHaveLength(1);
      expect(head.rows[0]).toMatchObject({
        work_item_count: "2",
        current_outcome: "create_work_item",
        intake_decision_high_water: "2",
        pending_materialization_ordinal: null,
        revision: "5"
      });
    });
  }
);

function observeWorkItemTransactionBackend(
  db: HuleeDatabase,
  observe: (pid: number) => void
): InboxV2WorkItemTransactionExecutor {
  return {
    execute: (query) => asRawSqlExecutor(db).execute(query),
    transaction: (work, config) =>
      db.transaction(async (transaction) => {
        observe(await readBackendPid(transaction));
        return work(asRawSqlExecutor(transaction));
      }, config)
  };
}

function asRawSqlExecutor(executor: unknown): RawSqlExecutor {
  return executor as RawSqlExecutor;
}

async function readBackendPid(executor: unknown): Promise<number> {
  const result = await asRawSqlExecutor(executor).execute<{
    pid: number | string;
  }>(sql`
    select pg_backend_pid()::int as pid
  `);
  const pid = Number(result.rows[0]?.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error("Expected one positive PostgreSQL backend PID.");
  }
  return pid;
}

async function expectBackendBlockedBy(
  db: HuleeDatabase,
  blockedPid: number,
  blockerPid: number
): Promise<void> {
  expect(blockedPid).not.toBe(blockerPid);
  const deadline = Date.now() + 2_000;
  do {
    const result = await db.execute<{
      wait_event_type: string | null;
      wait_event: string | null;
      blocked_by_expected: boolean;
    }>(sql`
      select activity.wait_event_type, activity.wait_event,
             ${blockerPid} = any(pg_blocking_pids(activity.pid))
               as blocked_by_expected
      from pg_stat_activity activity
      where activity.pid = ${blockedPid}
    `);
    const observation = result.rows[0];
    if (
      observation?.wait_event_type === "Lock" &&
      observation.blocked_by_expected
    ) {
      expect(observation.wait_event).not.toBeNull();
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  throw new Error(
    `PostgreSQL backend ${blockedPid} was not observed blocked by ${blockerPid}.`
  );
}

function creationCommit(
  conversationId: ReturnType<typeof inboxV2ConversationIdSchema.parse>,
  suffix = "race",
  decidedAt = t0
) {
  const workItemId = inboxV2WorkItemIdSchema.parse(
    `work_item:msg002-fence-${suffix}-${runId}`
  );
  const conversation = {
    tenantId,
    kind: "conversation" as const,
    id: conversationId
  };
  const workItem = {
    tenantId,
    kind: "work_item" as const,
    id: workItemId
  };
  const slotBefore = inboxV2ConversationWorkItemSlotSchema.parse({
    tenantId,
    id: `conversation_work_item_slot:${createHash("sha256")
      .update(`${tenantId}\u001f${conversationId}`, "utf8")
      .digest("hex")}`,
    conversation,
    latestOrdinal: "0",
    latestWorkItem: null,
    currentNonTerminalWorkItem: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  });
  const queueReference = {
    tenantId,
    kind: "work_queue" as const,
    id: queueId
  };
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    tenantId,
    id: workItemId,
    conversation,
    ordinal: "1",
    operationalState: {
      state: "new",
      activeQueue: { queue: queueReference, queueRevision: "1" },
      primaryAssignment: null,
      terminal: null
    },
    priorityId: "core:normal",
    sla: { kind: "not_applied", reasonId: "core:no-sla-policy" },
    currentServicingTeam: null,
    servicingTeamRelationRevision: "1",
    collaboratorSetRevision: "1",
    resourceAccessRevision: "1",
    reopenCycle: "0",
    lastReopen: null,
    createdBy: {
      kind: "trusted_service",
      trustedServiceId: "core:work-intake"
    },
    creationReasonId: "core:external-actionable-input",
    revision: "1",
    createdAt: decidedAt,
    updatedAt: decidedAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: "1",
    latestWorkItem: {
      workItem,
      ordinal: "1",
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: { workItem, ordinal: "1" },
    revision: "2",
    updatedAt: decidedAt
  });
  return inboxV2WorkItemCreationCommitSchema.parse({
    tenantId,
    intakeDecision: {
      tenantId,
      conversation,
      transport: "external",
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "1",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt,
      outcome: "create_work_item",
      queue: queueReference,
      latestTerminalHandling: "no_latest_work_item",
      reasonId: "core:external-actionable-input"
    },
    queueSnapshot: inboxV2WorkQueueSchema.parse({
      tenantId,
      id: queueId,
      ownerOrgUnit: { tenantId, kind: "org_unit", id: orgUnitId },
      lifecycle: "active",
      eligibilityPolicy: {
        policyId: "core:active-queue-member",
        policyVersion: "v1",
        policyRevision: "1"
      },
      externalReplyPolicy: {
        mode: "responsible_only",
        policyVersion: "v1",
        policyRevision: "1"
      },
      defaultPriorityId: "core:normal",
      defaultSlaPolicy: { kind: "not_applied" },
      resourceAccessRevision: "1",
      revision: "1",
      createdAt: t0,
      updatedAt: t0
    }),
    slotBefore,
    previousLatestWorkItem: null,
    createdWorkItem,
    slotAfter,
    occurredAt: decidedAt
  });
}

function terminalCloseCommit(
  fixture: Readonly<{
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
  }>,
  suffix: string,
  occurredAt: string
) {
  const before = fixture.workItem;
  const sourceQueue = before.operationalState.activeQueue;
  if (sourceQueue === null) {
    throw new Error("Expected an active Queue before terminal transition.");
  }
  const actor = {
    kind: "trusted_service" as const,
    trustedServiceId: "core:msg002-reply-fence"
  };
  const transition = {
    tenantId,
    id: `work_item_transition:msg002-close-${suffix}-${runId}`,
    workItem: { tenantId, kind: "work_item" as const, id: before.id },
    kind: "close_resolved" as const,
    fromState: before.operationalState.state,
    toState: "resolved" as const,
    sourceQueue,
    destinationQueue: sourceQueue,
    actor,
    reasonId: "core:resolved",
    expectedRevision: before.revision,
    resultingRevision: plusOne(before.revision),
    occurredAt
  };
  const after = inboxV2WorkItemSchema.parse({
    ...before,
    operationalState: {
      state: "resolved",
      activeQueue: null,
      primaryAssignment: null,
      terminal: {
        closedByTransition: {
          tenantId,
          kind: "work_item_transition",
          id: transition.id
        },
        reasonId: transition.reasonId,
        closedBy: actor,
        closedAt: occurredAt,
        finalQueue: sourceQueue,
        finalServicingTeam: null,
        finalPrimary: null
      }
    },
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...fixture.slot,
    latestWorkItem: {
      workItem: transition.workItem,
      ordinal: before.ordinal,
      lifecycleClass: "terminal",
      lifecycleFenceRevision: transition.resultingRevision
    },
    currentNonTerminalWorkItem: null,
    revision: plusOne(fixture.slot.revision),
    updatedAt: occurredAt
  });
  return inboxV2WorkItemTransitionCommitSchema.parse({
    tenantId,
    before,
    transition,
    after,
    sourceResponsibility: null,
    assignmentEffect: { kind: "none" },
    servicingTeamEffect: { kind: "none" },
    destinationQueueSnapshot: null,
    slotBefore: fixture.slot,
    slotAfter
  });
}

function sequentialCreationCommit(
  conversationId: ReturnType<typeof inboxV2ConversationIdSchema.parse>,
  previousLatestWorkItem: InboxV2WorkItem,
  slotBefore: InboxV2ConversationWorkItemSlot
) {
  const template = creationCommit(conversationId, "sequential");
  const workItemId = inboxV2WorkItemIdSchema.parse(
    `work_item:msg002-fence-sequential-${runId}`
  );
  const workItem = {
    tenantId,
    kind: "work_item" as const,
    id: workItemId
  };
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    ...template.createdWorkItem,
    id: workItemId,
    ordinal: plusOne(previousLatestWorkItem.ordinal),
    createdAt: t2,
    updatedAt: t2
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: createdWorkItem.ordinal,
    latestWorkItem: {
      workItem,
      ordinal: createdWorkItem.ordinal,
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: {
      workItem,
      ordinal: createdWorkItem.ordinal
    },
    revision: plusOne(slotBefore.revision),
    updatedAt: t2
  });
  return inboxV2WorkItemCreationCommitSchema.parse({
    ...template,
    intakeDecision: {
      ...template.intakeDecision,
      decisionRevision: "1",
      decidedAt: t2,
      latestTerminalHandling: "create_sequential"
    },
    slotBefore,
    previousLatestWorkItem,
    createdWorkItem,
    slotAfter,
    occurredAt: t2
  });
}

async function deleteTestTenantGraph(db: HuleeDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_item_creation_decisions where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_item_transitions where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_item_sla_snapshots where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_items where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_conversation_work_item_slots where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_queue_heads where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_work_queue_versions where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_conversation_membership_heads where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_conversation_heads where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from inbox_v2_conversations where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from work_queues where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from org_units where tenant_id = ${tenantId}`
    );
    await transaction.execute(sql`delete from tenants where id = ${tenantId}`);
  });
}

function plusOne(value: string): string {
  return (BigInt(value) + 1n).toString();
}

function conversationWorkItemSlotId(
  conversationId: ReturnType<typeof inboxV2ConversationIdSchema.parse>
): string {
  return `conversation_work_item_slot:${createHash("sha256")
    .update(`${tenantId}\u001f${conversationId}`, "utf8")
    .digest("hex")}`;
}
