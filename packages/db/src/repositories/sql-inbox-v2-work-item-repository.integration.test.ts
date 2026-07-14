import { createHash } from "node:crypto";

import {
  deriveInboxV2WorkItemResponsibility,
  inboxV2ConversationIdSchema,
  inboxV2ConversationPurposeIdSchema,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2EmployeeAssignmentEligibilityFenceSchema,
  inboxV2EmployeeIdSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemPrimaryAssignmentSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkItemServicingTeamCommitSchema,
  inboxV2WorkItemServicingTeamEpisodeSchema,
  inboxV2WorkItemTransitionCommitSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2WorkQueueSchema,
  type InboxV2ConversationWorkItemSlot,
  type InboxV2EmployeeId,
  type InboxV2WorkItem,
  type InboxV2WorkItemPrimaryAssignment
} from "@hulee/contracts";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  closeHuleeDatabase,
  createHuleeDatabase,
  type HuleeDatabase
} from "../client";
import { createSqlInboxV2ConversationRepository } from "./sql-inbox-v2-conversation-repository";
import { createSqlInboxV2WorkItemRepository } from "./sql-inbox-v2-work-item-repository";

const describePostgres =
  process.env.HULEE_DB_INTEGRATION === "1" ? describe : describe.skip;
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
const tenantId = inboxV2TenantIdSchema.parse(`tenant:db004-${runId}`);
const queueId = inboxV2WorkQueueIdSchema.parse(`work_queue:db004-${runId}`);
const orgUnitId = `org_unit:db004-${runId}`;
const teamAId = `team:db004-a-${runId}`;
const employeeA = inboxV2EmployeeIdSchema.parse(`employee:db004-a-${runId}`);
const employeeB = inboxV2EmployeeIdSchema.parse(`employee:db004-b-${runId}`);
const employeeRace = inboxV2EmployeeIdSchema.parse(
  `employee:db004-race-${runId}`
);
const employeeFenceAudit = inboxV2EmployeeIdSchema.parse(
  `employee:db004-fence-audit-${runId}`
);
const t0 = "2026-07-14T09:00:00.000Z";
const t1 = "2026-07-14T09:01:00.000Z";
const t2 = "2026-07-14T09:02:00.000Z";
const t3 = "2026-07-14T09:03:00.000Z";
const t4 = "2026-07-14T09:04:00.000Z";
const t5 = "2026-07-14T10:00:00.000Z";

type WorkFixture = Readonly<{
  workItem: InboxV2WorkItem;
  slot: InboxV2ConversationWorkItemSlot;
}>;

describe("SQL Inbox V2 WorkItem PostgreSQL fixtures", () => {
  it("builds a contract-valid unchanged not_applied new-cycle reopen", () => {
    const creation = creationCommit(
      conversation("sla-contract"),
      "sla-contract"
    );
    const close = terminalCloseWithoutRelationsCommit(
      { workItem: creation.createdWorkItem, slot: creation.slotAfter },
      "sla-contract",
      t1
    );
    const reopen = reopenNewCycleCommit(
      close.after,
      close.slotAfter,
      "sla-contract",
      t2
    );

    expect(reopen).toMatchObject({
      transition: { kind: "reopen_unassigned" },
      before: { sla: { kind: "not_applied" } },
      after: {
        sla: { kind: "not_applied" },
        lastReopen: { slaMode: "new_cycle" }
      }
    });
  });
});

describePostgres("SQL Inbox V2 WorkItem repository (PostgreSQL)", () => {
  let db: HuleeDatabase;

  beforeAll(async () => {
    db = createHuleeDatabase();
    currentDb = db;
    const readiness = await db.execute<{
      workItems: string | null;
      transitions: string | null;
      relations: string | null;
    }>(sql`
      select
        to_regclass('public.inbox_v2_work_items')::text as "workItems",
        to_regclass('public.inbox_v2_work_item_transitions')::text as transitions,
        to_regclass('public.inbox_v2_work_item_relation_transitions')::text as relations
    `);
    const ready = readiness.rows[0];
    if (
      ready === undefined ||
      ready.workItems === null ||
      ready.transitions === null ||
      ready.relations === null
    ) {
      throw new Error("Inbox V2 WorkItem PostgreSQL tables are not migrated.");
    }

    await db.transaction(async (transaction) => {
      await transaction.execute(sql`
        insert into tenants (id, slug, display_name, deployment_type)
        values (
          ${tenantId}, ${`db004-${runId}`},
          'DB004 WorkItem repository tenant', 'saas_shared'
        )
      `);
      await transaction.execute(sql`
        insert into org_units (
          id, tenant_id, name, kind, status, created_at, updated_at
        ) values (
          ${orgUnitId}, ${tenantId}, 'DB004 support', 'department', 'active',
          ${t0}, ${t0}
        )
      `);
      await transaction.execute(sql`
        insert into work_queues (
          id, tenant_id, name, kind, owning_org_unit_id, status,
          routing_config, created_at, updated_at
        ) values (
          ${queueId}, ${tenantId}, 'DB004 queue', 'support', ${orgUnitId},
          'active', '{}'::jsonb, ${t0}, ${t0}
        )
      `);
      await transaction.execute(sql`
        insert into teams (id, tenant_id, name, created_at, updated_at)
        values (${teamAId}, ${tenantId}, 'DB004 team A', ${t0}, ${t0})
      `);
      for (const [index, employeeId] of [
        employeeA,
        employeeB,
        employeeRace,
        employeeFenceAudit
      ].entries()) {
        await transaction.execute(sql`
          insert into employees (
            id, tenant_id, email, display_name, profile, created_at, updated_at
          ) values (
            ${employeeId}, ${tenantId},
            ${`db004-${index}-${runId}@example.test`},
            ${`DB004 Employee ${index}`}, '{}'::jsonb, ${t0}, ${t0}
          )
        `);
      }
    });

    const repository = createSqlInboxV2WorkItemRepository(db);
    for (const employeeId of [
      employeeA,
      employeeB,
      employeeRace,
      employeeFenceAudit
    ]) {
      const advanced = await repository.advanceEmployeeFence({
        tenantId,
        employeeId,
        expectedRevision: null,
        next: employeeFence(employeeId, t0),
        reasonId: "core:employee_bootstrap",
        changedByTrustedServiceId: "core:employee_lifecycle_sync"
      });
      expect(advanced).toMatchObject({
        kind: "already_applied",
        fence: {
          employee: { id: employeeId },
          state: "active",
          generation: "1",
          revision: "1"
        }
      });
    }
  });

  afterAll(async () => {
    if (!db) return;
    try {
      await deleteTestTenantGraph(db);
    } finally {
      await closeHuleeDatabase(db);
      currentDb = undefined;
    }
  });

  it("serializes concurrent create and claim to one canonical winner", async () => {
    const conversationId = await seedConversation("create-race");
    const first = creationCommit(conversationId, "create-race-a");
    const second = creationCommit(conversationId, "create-race-b");
    const repository = createSqlInboxV2WorkItemRepository(db);

    const createResults = await Promise.all([
      repository.createWorkItem(first),
      repository.createWorkItem(second)
    ]);
    expect(createResults.map((result) => result.kind).sort()).toEqual([
      "conflict",
      "created"
    ]);
    const created = createResults.find((result) => result.kind === "created");
    if (created?.kind !== "created") {
      throw new Error("Expected one WorkItem create winner.");
    }

    const claimA = claimCommit(
      { workItem: created.workItem, slot: created.slot },
      employeeA,
      "create-race-a",
      t1
    );
    const claimB = claimCommit(
      { workItem: created.workItem, slot: created.slot },
      employeeB,
      "create-race-b",
      t1
    );
    const claimResults = await Promise.all([
      repository.applyTransition(claimA),
      repository.applyTransition(claimB)
    ]);
    expect(claimResults.map((result) => result.kind).sort()).toEqual([
      "applied",
      "conflict"
    ]);
    const loser = claimResults.find((result) => result.kind === "conflict");
    expect(loser).toMatchObject({
      kind: "conflict",
      code: "work.responsibility_conflict"
    });

    const rows = await db.execute<{ count: string }>(sql`
      select count(*)::text as count
      from inbox_v2_work_item_primary_assignments
      where tenant_id = ${tenantId}
        and work_item_id = ${created.workItem.id}
        and state = 'active'
    `);
    expect(rows.rows[0]?.count).toBe("1");
  });

  it("rejects a stale Queue replay after the head has advanced", async () => {
    const staleQueueId = inboxV2WorkQueueIdSchema.parse(
      `work_queue:db004-stale-${runId}`
    );
    await db.execute(sql`
      insert into work_queues (
        id, tenant_id, name, kind, owning_org_unit_id, status,
        routing_config, created_at, updated_at
      ) values (
        ${staleQueueId}, ${tenantId}, 'DB004 stale replay queue', 'support',
        ${orgUnitId}, 'active', '{}'::jsonb, ${t0}, ${t0}
      )
    `);
    const repository = createSqlInboxV2WorkItemRepository(db);
    const revisionOne = workQueue({ id: staleQueueId });
    const revisionTwo = workQueue({
      id: staleQueueId,
      revision: "2",
      updatedAt: t1
    });

    expect(await repository.persistQueueSnapshot(revisionOne)).toMatchObject({
      kind: "persisted",
      queue: { revision: "1" }
    });
    expect(await repository.persistQueueSnapshot(revisionTwo)).toMatchObject({
      kind: "persisted",
      queue: { revision: "2" }
    });
    expect(await repository.persistQueueSnapshot(revisionOne)).toMatchObject({
      kind: "revision_conflict",
      current: { id: staleQueueId, revision: "2" }
    });
  });

  it("binds fence replay to provenance and keeps loadedAt monotonic", async () => {
    const repository = createSqlInboxV2WorkItemRepository(db);
    const initial = employeeFence(employeeFenceAudit, t0);

    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeFenceAudit,
        expectedRevision: null,
        next: initial,
        reasonId: "core:different-reason",
        changedByTrustedServiceId: "core:employee_lifecycle_sync"
      })
    ).toMatchObject({ kind: "revision_conflict", current: initial });
    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeFenceAudit,
        expectedRevision: null,
        next: initial,
        reasonId: "core:employee_bootstrap",
        changedByTrustedServiceId: "core:different-service"
      })
    ).toMatchObject({ kind: "revision_conflict", current: initial });

    const equivalentOffsetReplay = employeeFence(
      employeeFenceAudit,
      "2026-07-14T12:00:00.000+03:00",
      { effectiveFrom: "2026-07-14T12:00:00.000+03:00" }
    );
    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeFenceAudit,
        expectedRevision: null,
        next: equivalentOffsetReplay,
        reasonId: "core:employee_bootstrap",
        changedByTrustedServiceId: "core:employee_lifecycle_sync"
      })
    ).toMatchObject({ kind: "already_applied", fence: initial });

    const draining = employeeFence(employeeFenceAudit, t2, {
      state: "draining",
      generation: "2",
      revision: "2",
      effectiveFrom: t1
    });
    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeFenceAudit,
        expectedRevision: initial.revision,
        next: draining,
        reasonId: "core:employee-draining",
        changedByTrustedServiceId: "core:directory-sync"
      })
    ).toMatchObject({ kind: "advanced", fence: draining });

    const nonMonotonicInactive = employeeFence(
      employeeFenceAudit,
      "2026-07-14T09:01:30.000Z",
      {
        state: "inactive",
        generation: "3",
        revision: "3",
        effectiveFrom: t1
      }
    );
    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeFenceAudit,
        expectedRevision: draining.revision,
        next: nonMonotonicInactive,
        reasonId: "core:employee-inactive",
        changedByTrustedServiceId: "core:directory-sync"
      })
    ).toMatchObject({ kind: "state_conflict", current: draining });
  });

  it("orders same-millisecond transfer history by causal revision", async () => {
    const fixture = await seedWorkItem("history");
    const repository = createSqlInboxV2WorkItemRepository(db);
    const claimed = claimCommit(fixture, employeeA, "history-z", t1);
    const claimedAssignment = openedAssignmentOf(claimed);
    const claimResult = await repository.applyTransition(claimed);
    expect(claimResult.kind).toBe("applied");
    if (claimResult.kind !== "applied") throw new Error("Expected claim.");

    const transfer = transferCommit(
      claimResult.workItem,
      fixture.slot,
      claimedAssignment,
      employeeB,
      "history-a",
      t1
    );
    const transferred = await repository.applyTransition(transfer);
    expect(transferred.kind).toBe("applied");

    const firstPage = await repository.listAssignmentHistory({
      tenantId,
      workItemId: fixture.workItem.id,
      limit: 1
    });
    expect(firstPage).toMatchObject({
      hasMore: true,
      predecessorEndedAt: null,
      items: [{ id: claimedAssignment.id, state: "ended" }]
    });
    expect(firstPage?.nextCursor).not.toBeNull();
    const secondPage = await repository.listAssignmentHistory({
      tenantId,
      workItemId: fixture.workItem.id,
      cursor: firstPage?.nextCursor,
      limit: 1
    });
    expect(secondPage).toMatchObject({
      hasMore: false,
      nextCursor: null,
      predecessorEndedAt: t1,
      items: [{ id: openedAssignmentOf(transfer).id, state: "active" }]
    });
  });

  it("rolls a callback back once and keeps assignment versus draining coherent", async () => {
    const rollbackFixture = await seedWorkItem("rollback");
    const repository = createSqlInboxV2WorkItemRepository(db);
    const rollbackClaim = claimCommit(
      rollbackFixture,
      employeeB,
      "rollback",
      t1
    );
    let callbackCalls = 0;
    await expect(
      repository.withTransitionCommit(rollbackClaim, async () => {
        callbackCalls += 1;
        throw new Error("forced WorkItem callback rollback");
      })
    ).rejects.toThrow("forced WorkItem callback rollback");
    expect(callbackCalls).toBe(1);
    expect(
      await repository.findWorkItemById({
        tenantId,
        workItemId: rollbackFixture.workItem.id
      })
    ).toMatchObject({ revision: "1", operationalState: { state: "new" } });
    expect((await repository.applyTransition(rollbackClaim)).kind).toBe(
      "applied"
    );

    const raceFixture = await seedWorkItem("fence-race");
    const raceClaim = claimCommit(raceFixture, employeeRace, "fence-race", t2);
    let enterCallback = (): void => undefined;
    let releaseCallback = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      enterCallback = resolve;
    });
    const released = new Promise<void>((resolve) => {
      releaseCallback = resolve;
    });
    const claimPromise = repository.withTransitionCommit(
      raceClaim,
      async () => {
        enterCallback();
        await released;
      }
    );
    await entered;
    let fenceSettled = false;
    const drainingFence = employeeFence(employeeRace, t3, {
      state: "draining",
      generation: "2",
      revision: "2",
      effectiveFrom: t3
    });
    const fencePromise = repository
      .advanceEmployeeFence({
        tenantId,
        employeeId: employeeRace,
        expectedRevision: employeeFence(employeeRace, t2).revision,
        next: drainingFence,
        reasonId: "core:employee-draining",
        changedByTrustedServiceId: "core:directory-sync"
      })
      .finally(() => {
        fenceSettled = true;
      });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(fenceSettled).toBe(false);
    releaseCallback();

    expect((await claimPromise).kind).toBe("applied");
    expect((await fencePromise).kind).toBe("advanced");
    const recovery = await repository.listRecoveryCandidates({
      tenantId,
      employeeId: employeeRace,
      limit: 128
    });
    expect(recovery).toEqual([
      expect.objectContaining({
        workItemId: raceFixture.workItem.id,
        employeeId: employeeRace,
        employeeFence: expect.objectContaining({
          state: "draining",
          generation: "2",
          revision: "2"
        })
      })
    ]);

    const inactiveFence = employeeFence(employeeRace, t4, {
      state: "inactive",
      generation: "3",
      revision: "3",
      effectiveFrom: t4
    });
    expect(
      await repository.advanceEmployeeFence({
        tenantId,
        employeeId: employeeRace,
        expectedRevision: drainingFence.revision,
        next: inactiveFence,
        reasonId: "core:employee-inactive",
        changedByTrustedServiceId: "core:directory-sync"
      })
    ).toMatchObject({ kind: "state_conflict", current: drainingFence });
  });

  it("starts a new SLA cycle even when not_applied is unchanged", async () => {
    const fixture = await seedWorkItem("sla-new-cycle");
    const repository = createSqlInboxV2WorkItemRepository(db);
    const close = terminalCloseWithoutRelationsCommit(
      fixture,
      "sla-new-cycle",
      t1
    );
    const closed = await repository.applyTransition(close);
    if (closed.kind !== "applied") throw new Error("Expected close.");

    const reopen = reopenNewCycleCommit(
      closed.workItem,
      closed.slot,
      "sla-new-cycle",
      t2
    );
    const reopened = await repository.applyTransition(reopen);
    expect(reopened).toMatchObject({
      kind: "applied",
      workItem: {
        operationalState: { state: "new" },
        reopenCycle: "1",
        sla: { kind: "not_applied", reasonId: "core:no-sla-policy" }
      }
    });

    const persisted = await db.execute<{
      slaCycle: string;
      slaRevision: string;
      snapshotCount: string;
      snapshotKeys: string;
    }>(sql`
      select work_item.sla_cycle::text as "slaCycle",
        work_item.sla_snapshot_revision::text as "slaRevision",
        count(snapshot.*)::text as "snapshotCount",
        string_agg(
          snapshot.sla_cycle::text || ':' || snapshot.revision::text,
          ',' order by snapshot.sla_cycle, snapshot.revision
        ) as "snapshotKeys"
      from inbox_v2_work_items work_item
      join inbox_v2_work_item_sla_snapshots snapshot
        on snapshot.tenant_id = work_item.tenant_id
       and snapshot.work_item_id = work_item.id
      where work_item.tenant_id = ${tenantId}
        and work_item.id = ${fixture.workItem.id}
      group by work_item.sla_cycle, work_item.sla_snapshot_revision
    `);
    expect(persisted.rows[0]).toEqual({
      slaCycle: "2",
      slaRevision: "1",
      snapshotCount: "2",
      snapshotKeys: "1:1,2:1"
    });
  });

  it("closes primary and servicing-team relations with exact transition proof", async () => {
    const fixture = await seedWorkItem("terminal-team");
    const repository = createSqlInboxV2WorkItemRepository(db);
    const claim = claimCommit(fixture, employeeA, "terminal-team", t1);
    const claimed = await repository.applyTransition(claim);
    if (claimed.kind !== "applied") throw new Error("Expected claim.");

    const addTeam = servicingTeamAddCommit(claimed.workItem, "terminal-team");
    const openedTeam = openedTeamOf(addTeam);
    const claimedAssignment = openedAssignmentOf(claim);
    const teamAdded = await repository.applyServicingTeamCommit(addTeam);
    expect(teamAdded.kind).toBe("applied");
    const beforeClose = await repository.findWorkItemById({
      tenantId,
      workItemId: fixture.workItem.id
    });
    if (beforeClose === null) throw new Error("Expected team-owned WorkItem.");

    const close = terminalCloseCommit(
      beforeClose,
      fixture.slot,
      claimedAssignment,
      openedTeam,
      "terminal-team"
    );
    const closed = await repository.applyTransition(close);
    expect(closed).toMatchObject({
      kind: "applied",
      workItem: {
        operationalState: { state: "resolved" },
        currentServicingTeam: null,
        servicingTeamRelationRevision: "3"
      }
    });

    const proof = await db.execute<{
      expectedTeamRevision: string;
      resultingTeamRevision: string;
      closedTeamId: string | null;
      closedAssignmentId: string | null;
      openedAssignmentId: string | null;
    }>(sql`
      select
        expected_servicing_team_relation_revision::text as "expectedTeamRevision",
        resulting_servicing_team_relation_revision::text as "resultingTeamRevision",
        closed_servicing_team_episode_id as "closedTeamId",
        closed_primary_assignment_id as "closedAssignmentId",
        opened_primary_assignment_id as "openedAssignmentId"
      from inbox_v2_work_item_transitions
      where tenant_id = ${tenantId}
        and id = ${close.transition.id}
    `);
    expect(proof.rows[0]).toEqual({
      expectedTeamRevision: "2",
      resultingTeamRevision: "3",
      closedTeamId: openedTeam.id,
      closedAssignmentId: claimedAssignment.id,
      openedAssignmentId: null
    });

    await expect(
      db.transaction(async (transaction) => {
        await transaction.execute(sql`
          update inbox_v2_work_items
          set state = 'new', revision = revision + 1, updated_at = ${t4}
          where tenant_id = ${tenantId}
            and id = ${fixture.workItem.id}
        `);
      })
    ).rejects.toThrow();
  });
});

async function seedConversation(suffix: string) {
  const conversationId = conversation(suffix);
  const created = await createSqlInboxV2ConversationRepository(dbRef()).create({
    tenantId,
    conversationId,
    topology: "direct",
    transport: "external",
    purposeId: inboxV2ConversationPurposeIdSchema.parse("core:support"),
    lifecycle: "active",
    streamPosition: "1" as never,
    createdAt: t0
  });
  if (created.kind !== "created") {
    throw new Error(`Expected Conversation create, got ${created.kind}.`);
  }
  return conversationId;
}

let currentDb: HuleeDatabase | undefined;

function dbRef(): HuleeDatabase {
  if (currentDb === undefined) {
    throw new Error("Integration database is not initialized.");
  }
  return currentDb;
}

async function seedWorkItem(suffix: string): Promise<WorkFixture> {
  const conversationId = await seedConversation(suffix);
  const commit = creationCommit(conversationId, suffix);
  const result =
    await createSqlInboxV2WorkItemRepository(dbRef()).createWorkItem(commit);
  if (result.kind !== "created") {
    throw new Error(`Expected WorkItem create, got ${result.kind}.`);
  }
  return { workItem: result.workItem, slot: result.slot };
}

function creationCommit(
  conversationId: ReturnType<typeof conversation>,
  suffix: string
) {
  const workItemId = workItem(suffix);
  const conversationReference = {
    tenantId,
    kind: "conversation" as const,
    id: conversationId
  };
  const workItemReference = {
    tenantId,
    kind: "work_item" as const,
    id: workItemId
  };
  const slotBefore = inboxV2ConversationWorkItemSlotSchema.parse({
    tenantId,
    id: `conversation_work_item_slot:${createHash("sha256")
      .update(`${tenantId}\u001f${conversationId}`, "utf8")
      .digest("hex")}`,
    conversation: conversationReference,
    latestOrdinal: "0",
    latestWorkItem: null,
    currentNonTerminalWorkItem: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0
  });
  const createdWorkItem = inboxV2WorkItemSchema.parse({
    tenantId,
    id: workItemId,
    conversation: conversationReference,
    ordinal: "1",
    operationalState: {
      state: "new",
      activeQueue: queueHead(),
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
    createdAt: t0,
    updatedAt: t0
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestOrdinal: "1",
    latestWorkItem: {
      workItem: workItemReference,
      ordinal: "1",
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    },
    currentNonTerminalWorkItem: {
      workItem: workItemReference,
      ordinal: "1"
    },
    revision: "2"
  });
  return inboxV2WorkItemCreationCommitSchema.parse({
    tenantId,
    intakeDecision: {
      tenantId,
      conversation: conversationReference,
      transport: "external",
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "1",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt: t0,
      outcome: "create_work_item",
      queue: queueReference(),
      latestTerminalHandling: "no_latest_work_item",
      reasonId: "core:external-actionable-input"
    },
    queueSnapshot: workQueue(),
    slotBefore,
    previousLatestWorkItem: null,
    createdWorkItem,
    slotAfter,
    occurredAt: t0
  });
}

function claimCommit(
  fixture: WorkFixture,
  target: InboxV2EmployeeId,
  suffix: string,
  occurredAt: string
) {
  const actor = employeeActor(target);
  const assignment = assignmentFor({
    workItemValue: fixture.workItem,
    target,
    suffix,
    source: "claim",
    expectedRevision: fixture.workItem.revision,
    actor,
    reasonId: "core:claimed",
    occurredAt
  });
  const transition = {
    tenantId,
    id: `work_item_transition:db004-claim-${suffix}-${runId}`,
    workItem: workItemReference(fixture.workItem),
    kind: "claim",
    fromState: "new",
    toState: "assigned",
    sourceQueue: queueHead(),
    destinationQueue: queueHead(),
    actor,
    reasonId: "core:claimed",
    expectedRevision: fixture.workItem.revision,
    resultingRevision: plusOne(fixture.workItem.revision),
    occurredAt
  };
  const after = inboxV2WorkItemSchema.parse({
    ...fixture.workItem,
    operationalState: {
      state: "assigned",
      activeQueue: queueHead(),
      primaryAssignment: assignmentHead(assignment),
      terminal: null
    },
    resourceAccessRevision: plusOne(fixture.workItem.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  return inboxV2WorkItemTransitionCommitSchema.parse({
    tenantId,
    before: fixture.workItem,
    transition,
    after,
    sourceResponsibility: null,
    assignmentEffect: { kind: "open", opened: assignment },
    servicingTeamEffect: { kind: "none" },
    destinationQueueSnapshot: workQueue(),
    slotBefore: fixture.slot,
    slotAfter: fixture.slot
  });
}

function transferCommit(
  before: InboxV2WorkItem,
  slot: InboxV2ConversationWorkItemSlot,
  currentAssignment: InboxV2WorkItemPrimaryAssignment,
  target: InboxV2EmployeeId,
  suffix: string,
  occurredAt: string
) {
  const actor = employeeActor(currentAssignment.employee.id);
  const transition = {
    tenantId,
    id: `work_item_transition:db004-transfer-${suffix}-${runId}`,
    workItem: workItemReference(before),
    kind: "transfer",
    fromState: before.operationalState.state,
    toState: before.operationalState.state,
    sourceQueue: queueHead(),
    destinationQueue: queueHead(),
    actor,
    reasonId: "core:transferred",
    expectedRevision: before.revision,
    resultingRevision: plusOne(before.revision),
    occurredAt
  };
  const ended = endedAssignment(currentAssignment, transition, occurredAt);
  const opened = assignmentFor({
    workItemValue: before,
    target,
    suffix,
    source: "transfer",
    expectedRevision: before.revision,
    actor,
    reasonId: transition.reasonId,
    occurredAt
  });
  const after = inboxV2WorkItemSchema.parse({
    ...before,
    operationalState: {
      ...before.operationalState,
      primaryAssignment: assignmentHead(opened)
    },
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  return inboxV2WorkItemTransitionCommitSchema.parse({
    tenantId,
    before,
    transition,
    after,
    sourceResponsibility: deriveInboxV2WorkItemResponsibility({
      workItem: before,
      assignment: currentAssignment,
      employeeFence: employeeFence(currentAssignment.employee.id, occurredAt),
      evaluatedAt: occurredAt
    }),
    assignmentEffect: {
      kind: "replace",
      before: currentAssignment,
      after: ended,
      opened
    },
    servicingTeamEffect: { kind: "none" },
    destinationQueueSnapshot: workQueue(),
    slotBefore: slot,
    slotAfter: slot
  });
}

function terminalCloseWithoutRelationsCommit(
  fixture: WorkFixture,
  suffix: string,
  occurredAt: string
) {
  const before = fixture.workItem;
  const actor = employeeActor(employeeA);
  const transition = {
    tenantId,
    id: `work_item_transition:db004-close-bare-${suffix}-${runId}`,
    workItem: workItemReference(before),
    kind: "close_resolved",
    fromState: before.operationalState.state,
    toState: "resolved",
    sourceQueue: queueHead(),
    destinationQueue: queueHead(),
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
        finalQueue: queueHead(),
        finalServicingTeam: null,
        finalPrimary: null
      }
    },
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  const slotBefore = fixture.slot;
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestWorkItem: {
      workItem: workItemReference(before),
      ordinal: before.ordinal,
      lifecycleClass: "terminal",
      lifecycleFenceRevision: transition.resultingRevision
    },
    currentNonTerminalWorkItem: null,
    revision: plusOne(slotBefore.revision),
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
    slotBefore,
    slotAfter
  });
}

function reopenNewCycleCommit(
  before: InboxV2WorkItem,
  slotBefore: InboxV2ConversationWorkItemSlot,
  suffix: string,
  occurredAt: string
) {
  if (
    before.operationalState.state !== "resolved" &&
    before.operationalState.state !== "dismissed"
  ) {
    throw new Error("Expected a terminal WorkItem before reopen.");
  }
  const actor = employeeActor(employeeA);
  const transition = {
    tenantId,
    id: `work_item_transition:db004-reopen-${suffix}-${runId}`,
    workItem: workItemReference(before),
    kind: "reopen_unassigned",
    fromState: before.operationalState.state,
    toState: "new",
    sourceQueue: queueHead(),
    destinationQueue: queueHead(),
    actor,
    reasonId: "core:new-inbound",
    expectedRevision: before.revision,
    resultingRevision: plusOne(before.revision),
    occurredAt
  };
  const nextReopenCycle = plusOne(before.reopenCycle);
  const after = inboxV2WorkItemSchema.parse({
    ...before,
    operationalState: {
      state: "new",
      activeQueue: queueHead(),
      primaryAssignment: null,
      terminal: null
    },
    reopenCycle: nextReopenCycle,
    lastReopen: {
      reopenedByTransition: {
        tenantId,
        kind: "work_item_transition",
        id: transition.id
      },
      conversation: before.conversation,
      previousTerminalState: before.operationalState.state,
      trigger: "manual",
      triggerReference: null,
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decisionRevision: "1",
      evaluatedAt: occurredAt,
      reopenUntil: null,
      outcome: "reopen_existing",
      destinationQueue: queueHead(),
      targetEligibilityDecision: null,
      slaMode: "new_cycle",
      reasonId: transition.reasonId,
      reopenedBy: actor,
      reopenedAt: occurredAt,
      reopenCycle: nextReopenCycle
    },
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: occurredAt
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestWorkItem: {
      workItem: workItemReference(before),
      ordinal: before.ordinal,
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: transition.resultingRevision
    },
    currentNonTerminalWorkItem: {
      workItem: workItemReference(before),
      ordinal: before.ordinal
    },
    revision: plusOne(slotBefore.revision),
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
    destinationQueueSnapshot: workQueue(),
    slotBefore,
    slotAfter
  });
}

function servicingTeamAddCommit(before: InboxV2WorkItem, suffix: string) {
  const occurredAt = "2026-07-14T09:02:30.000Z";
  const actor = employeeActor(employeeA);
  const episode = inboxV2WorkItemServicingTeamEpisodeSchema.parse({
    tenantId,
    id: `work_item_servicing_team_episode:db004-${suffix}-${runId}`,
    workItem: workItemReference(before),
    workItemCycle: before.reopenCycle,
    team: { tenantId, kind: "team", id: teamAId },
    startedAt: occurredAt,
    startedBy: actor,
    startReasonId: "core:routed-to-team",
    state: "active",
    termination: null,
    revision: "1",
    createdAt: occurredAt,
    updatedAt: occurredAt
  });
  const transition = {
    tenantId,
    id: `work_item_relation_transition:db004-${suffix}-${runId}`,
    workItem: workItemReference(before),
    kind: "servicing_team_add",
    actor,
    reasonId: "core:routed-to-team",
    expectedWorkItemRevision: before.revision,
    resultingWorkItemRevision: plusOne(before.revision),
    expectedRelationRevision: before.servicingTeamRelationRevision,
    resultingRelationRevision: plusOne(before.servicingTeamRelationRevision),
    occurredAt
  };
  return inboxV2WorkItemServicingTeamCommitSchema.parse({
    tenantId,
    before: relationHead(before),
    transition,
    after: {
      ...relationHead(before),
      currentServicingTeam: currentTeamHead(episode),
      servicingTeamRelationRevision: transition.resultingRelationRevision,
      resourceAccessRevision: plusOne(before.resourceAccessRevision),
      workItemRevision: transition.resultingWorkItemRevision,
      updatedAt: occurredAt
    },
    closed: null,
    opened: episode
  });
}

function terminalCloseCommit(
  before: InboxV2WorkItem,
  originalSlot: InboxV2ConversationWorkItemSlot,
  assignment: InboxV2WorkItemPrimaryAssignment,
  teamEpisode: ReturnType<
    typeof inboxV2WorkItemServicingTeamEpisodeSchema.parse
  >,
  suffix: string
) {
  if (before.currentServicingTeam === null) {
    throw new Error("Expected current servicing team before close.");
  }
  const actor = employeeActor(assignment.employee.id);
  const transition = {
    tenantId,
    id: `work_item_transition:db004-close-${suffix}-${runId}`,
    workItem: workItemReference(before),
    kind: "close_resolved",
    fromState: before.operationalState.state,
    toState: "resolved",
    sourceQueue: queueHead(),
    destinationQueue: queueHead(),
    actor,
    reasonId: "core:resolved",
    expectedRevision: before.revision,
    resultingRevision: plusOne(before.revision),
    occurredAt: t3
  };
  const endedPrimary = endedAssignment(assignment, transition, t3);
  const endedTeam = inboxV2WorkItemServicingTeamEpisodeSchema.parse({
    ...teamEpisode,
    state: "ended",
    termination: {
      endedAt: t3,
      recordedAt: t3,
      cause: {
        kind: "work_item_terminal",
        transition: {
          tenantId,
          kind: "work_item_transition",
          id: transition.id
        }
      },
      actor,
      reasonId: transition.reasonId
    },
    revision: "2",
    updatedAt: t3
  });
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
        closedAt: t3,
        finalQueue: queueHead(),
        finalServicingTeam: before.currentServicingTeam,
        finalPrimary: assignmentHead(assignment)
      }
    },
    currentServicingTeam: null,
    servicingTeamRelationRevision: plusOne(
      before.servicingTeamRelationRevision
    ),
    resourceAccessRevision: plusOne(before.resourceAccessRevision),
    revision: transition.resultingRevision,
    updatedAt: t3
  });
  const slotBefore = inboxV2ConversationWorkItemSlotSchema.parse({
    ...originalSlot,
    latestWorkItem: {
      workItem: workItemReference(before),
      ordinal: before.ordinal,
      lifecycleClass: "non_terminal",
      lifecycleFenceRevision: "1"
    }
  });
  const slotAfter = inboxV2ConversationWorkItemSlotSchema.parse({
    ...slotBefore,
    latestWorkItem: {
      workItem: workItemReference(before),
      ordinal: before.ordinal,
      lifecycleClass: "terminal",
      lifecycleFenceRevision: transition.resultingRevision
    },
    currentNonTerminalWorkItem: null,
    revision: plusOne(slotBefore.revision),
    updatedAt: t3
  });
  return inboxV2WorkItemTransitionCommitSchema.parse({
    tenantId,
    before,
    transition,
    after,
    sourceResponsibility: deriveInboxV2WorkItemResponsibility({
      workItem: before,
      assignment,
      employeeFence: employeeFence(assignment.employee.id, t3),
      evaluatedAt: t3
    }),
    assignmentEffect: {
      kind: "close",
      before: assignment,
      after: endedPrimary
    },
    servicingTeamEffect: {
      kind: "close",
      before: teamEpisode,
      after: endedTeam
    },
    destinationQueueSnapshot: null,
    slotBefore,
    slotAfter
  });
}

function assignmentFor(input: {
  workItemValue: InboxV2WorkItem;
  target: InboxV2EmployeeId;
  suffix: string;
  source: "claim" | "transfer";
  expectedRevision: string;
  actor: ReturnType<typeof employeeActor>;
  reasonId: string;
  occurredAt: string;
}) {
  const employee = employeeReference(input.target);
  return inboxV2WorkItemPrimaryAssignmentSchema.parse({
    tenantId,
    id: `work_item_primary_assignment:db004-${input.suffix}-${runId}`,
    workItem: workItemReference(input.workItemValue),
    queueAtStart: queueHead(),
    employee,
    source: input.source,
    eligibilityDecision: {
      tenantId,
      id: `work_queue_eligibility_decision:db004-${input.suffix}-${runId}`,
      workItem: workItemReference(input.workItemValue),
      expectedWorkItemRevision: input.expectedRevision,
      queue: queueReference(),
      queueRevision: "1",
      queueLifecycle: "active",
      employee,
      employeeFence: employeeFence(input.target, input.occurredAt),
      policy: {
        policyId: "core:active-queue-member",
        policyVersion: "v1",
        policyRevision: "1"
      },
      eligibilityBasis: "queue_membership",
      eligibilityEvidenceRevision: "1",
      effect: "allow",
      reasonId: "core:active-member",
      decisionRevision: "1",
      loadedByTrustedServiceId: "core:authorization",
      decidedAt: input.occurredAt,
      notAfter: t5
    },
    employeeFenceGenerationAtStart: "1",
    startedAt: input.occurredAt,
    startedBy: input.actor,
    startReasonId: input.reasonId,
    state: "active",
    termination: null,
    revision: "1",
    createdAt: input.occurredAt,
    updatedAt: input.occurredAt
  });
}

function endedAssignment(
  before: InboxV2WorkItemPrimaryAssignment,
  transition: {
    id: string;
    actor: ReturnType<typeof employeeActor>;
    reasonId: string;
  },
  occurredAt: string
) {
  return inboxV2WorkItemPrimaryAssignmentSchema.parse({
    ...before,
    state: "ended",
    termination: {
      endedAt: occurredAt,
      recordedAt: occurredAt,
      basis: "command_time",
      endedBy: transition.actor,
      reasonId: transition.reasonId,
      transition: {
        tenantId,
        kind: "work_item_transition",
        id: transition.id
      },
      employeeFenceAtEnd: null
    },
    revision: "2",
    updatedAt: occurredAt
  });
}

function workQueue(overrides: Record<string, unknown> = {}) {
  return inboxV2WorkQueueSchema.parse({
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
    updatedAt: t0,
    ...overrides
  });
}

function employeeFence(
  employeeId: InboxV2EmployeeId,
  loadedAt: string,
  overrides: Record<string, unknown> = {}
) {
  return inboxV2EmployeeAssignmentEligibilityFenceSchema.parse({
    tenantId,
    employee: employeeReference(employeeId),
    state: "active",
    generation: "1",
    revision: "1",
    effectiveFrom: t0,
    loadedAt,
    ...overrides
  });
}

function employeeReference(employeeId: InboxV2EmployeeId) {
  return { tenantId, kind: "employee" as const, id: employeeId };
}

function employeeActor(employeeId: InboxV2EmployeeId) {
  return {
    kind: "employee" as const,
    employee: employeeReference(employeeId),
    authorizationEpoch: `authorization-epoch-${employeeId}`
  };
}

function queueReference() {
  return { tenantId, kind: "work_queue" as const, id: queueId };
}

function queueHead() {
  return { queue: queueReference(), queueRevision: "1" };
}

function workItemReference(value: InboxV2WorkItem) {
  return { tenantId, kind: "work_item" as const, id: value.id };
}

function assignmentHead(value: InboxV2WorkItemPrimaryAssignment) {
  return {
    assignment: {
      tenantId,
      kind: "work_item_primary_assignment" as const,
      id: value.id
    },
    employee: value.employee,
    eligibilityDecision: {
      tenantId,
      kind: "work_queue_eligibility_decision" as const,
      id: value.eligibilityDecision.id
    },
    employeeFenceGenerationAtStart: value.employeeFenceGenerationAtStart,
    assignedAt: value.startedAt,
    assignmentRevision: value.revision
  };
}

function relationHead(value: InboxV2WorkItem) {
  return {
    tenantId,
    workItem: workItemReference(value),
    state: value.operationalState.state,
    workItemCycle: value.reopenCycle,
    currentServicingTeam: value.currentServicingTeam,
    servicingTeamRelationRevision: value.servicingTeamRelationRevision,
    collaboratorSetRevision: value.collaboratorSetRevision,
    resourceAccessRevision: value.resourceAccessRevision,
    workItemRevision: value.revision,
    updatedAt: value.updatedAt
  };
}

function currentTeamHead(
  value: ReturnType<typeof inboxV2WorkItemServicingTeamEpisodeSchema.parse>
) {
  return {
    workItem: value.workItem,
    episode: {
      tenantId,
      kind: "work_item_servicing_team_episode" as const,
      id: value.id
    },
    team: value.team,
    workItemCycle: value.workItemCycle,
    startedAt: value.startedAt,
    episodeRevision: value.revision
  };
}

function openedAssignmentOf(
  commit: ReturnType<typeof inboxV2WorkItemTransitionCommitSchema.parse>
): InboxV2WorkItemPrimaryAssignment {
  if (
    commit.assignmentEffect.kind !== "open" &&
    commit.assignmentEffect.kind !== "replace"
  ) {
    throw new Error("Expected an opening assignment effect.");
  }
  return commit.assignmentEffect.opened;
}

function openedTeamOf(
  commit: ReturnType<typeof inboxV2WorkItemServicingTeamCommitSchema.parse>
) {
  if (commit.opened === null) {
    throw new Error("Expected an opening servicing-team effect.");
  }
  return commit.opened;
}

async function deleteTestTenantGraph(db: HuleeDatabase): Promise<void> {
  await db.transaction(async (transaction) => {
    await transaction.execute(
      sql`set local session_replication_role = 'replica'`
    );
    for (const tableName of [
      "inbox_v2_work_item_relation_transitions",
      "inbox_v2_work_item_servicing_team_episodes",
      "inbox_v2_work_item_transitions",
      "inbox_v2_work_item_primary_assignments",
      "inbox_v2_work_queue_eligibility_decisions",
      "inbox_v2_work_item_creation_decisions",
      "inbox_v2_work_item_sla_snapshots",
      "inbox_v2_work_items",
      "inbox_v2_conversation_work_item_slots",
      "inbox_v2_employee_assignment_fence_heads",
      "inbox_v2_employee_assignment_fence_versions",
      "inbox_v2_work_queue_heads",
      "inbox_v2_work_queue_versions",
      "inbox_v2_conversation_membership_heads",
      "inbox_v2_conversation_heads",
      "inbox_v2_conversations"
    ] as const) {
      await transaction.execute(
        sql.raw(`delete from ${tableName} where tenant_id = '${tenantId}'`)
      );
    }
    await transaction.execute(
      sql`delete from employees where tenant_id = ${tenantId}`
    );
    await transaction.execute(
      sql`delete from teams where tenant_id = ${tenantId}`
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

function conversation(suffix: string) {
  return inboxV2ConversationIdSchema.parse(
    `conversation:db004-${suffix}-${runId}`
  );
}

function workItem(suffix: string) {
  return inboxV2WorkItemIdSchema.parse(`work_item:db004-${suffix}-${runId}`);
}

function plusOne(value: string): string {
  return (BigInt(value) + 1n).toString();
}
