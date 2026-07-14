import {
  inboxV2ConversationIdSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkQueueIdSchema,
  type InboxV2WorkItemCreationCommit,
  type InboxV2WorkItemServicingTeamCommit,
  type InboxV2WorkItemTransitionCommit
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  buildAdvanceInboxV2WorkItemServicingTeamSql,
  buildFindInboxV2EmployeeAssignmentFenceVersionSql,
  buildFindInboxV2WorkItemSql,
  buildFindInboxV2WorkItemSlaSnapshotSql,
  buildFindInboxV2WorkItemSlotSql,
  buildHasInboxV2ActiveEmployeeAssignmentsSql,
  buildInsertInboxV2WorkItemCreationDecisionSql,
  buildInsertInboxV2WorkItemRelationTransitionSql,
  buildInsertInboxV2WorkItemTransitionSql,
  buildListInboxV2WorkItemAssignmentHistorySql,
  buildListInboxV2WorkItemRecoveryCandidatesSql,
  buildLockInboxV2EmployeeAssignmentFencesSql,
  buildLockInboxV2WorkItemTeamsSql,
  createSqlInboxV2WorkItemRepository,
  type InboxV2WorkItemTransactionExecutor
} from "./sql-inbox-v2-work-item-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = inboxV2TenantIdSchema.parse("tenant:db004-unit");
const conversationId = inboxV2ConversationIdSchema.parse(
  "conversation:db004-unit"
);
const workItemId = inboxV2WorkItemIdSchema.parse("work_item:db004-unit");
const queueId = inboxV2WorkQueueIdSchema.parse("work_queue:db004-unit");
const employeeA = inboxV2EmployeeIdSchema.parse("employee:a");
const employeeZ = inboxV2EmployeeIdSchema.parse("employee:z");
const occurredAtOffset = "2026-07-14T12:00:00.000+03:00";
const occurredAtUtc = "2026-07-14T09:00:00.000Z";

describe("SQL Inbox V2 WorkItem repository", () => {
  it("keeps aggregate reads and bounded keyset pages tenant-scoped", () => {
    const statements = [
      buildFindInboxV2WorkItemSql({
        tenantId,
        workItemId,
        lock: true
      }),
      buildFindInboxV2WorkItemSlotSql({
        tenantId,
        conversationId,
        lock: true
      }),
      buildListInboxV2WorkItemAssignmentHistorySql({
        tenantId,
        workItemId,
        cursor: {
          version: 2,
          startedAt: occurredAtUtc,
          expectedWorkItemRevision: inboxV2EntityRevisionSchema.parse("4"),
          assignmentId: "work_item_primary_assignment:cursor"
        },
        limit: 129
      }),
      buildListInboxV2WorkItemRecoveryCandidatesSql({
        tenantId,
        employeeId: employeeA,
        afterWorkItemId: workItemId,
        limit: 128
      })
    ];

    for (const statement of statements) {
      const rendered = renderQuery(statement);
      expect(rendered.sql).toContain("tenant_id");
      expect(rendered.params).toContain(tenantId);
    }

    const history = normalizeSql(renderQuery(statements[2]).sql);
    expect(history).toContain("assignment_row.started_at >");
    expect(history).toContain("decision_row.expected_work_item_revision >");
    expect(history).toContain('assignment_row.id collate "c" >');
    expect(history).toContain(
      'order by assignment_row.started_at asc, decision_row.expected_work_item_revision asc, assignment_row.id collate "c" asc'
    );

    const recovery = normalizeSql(renderQuery(statements[3]).sql);
    expect(recovery).toContain(
      "assignment.id = work_item.current_primary_assignment_id"
    );
    expect(recovery).toContain("assignment.state = 'active'");
    expect(recovery).toContain("fence.state <> 'active'");
    expect(recovery).toContain('order by work_item.id collate "c" asc');
  });

  it("locks Employee fences and Teams in canonical PostgreSQL C order", () => {
    const fences = renderQuery(
      buildLockInboxV2EmployeeAssignmentFencesSql({
        tenantId,
        employeeIds: [employeeZ, employeeA]
      })
    );
    expect(normalizeSql(fences.sql)).toContain(
      "version_row.recorded_at as loaded_at"
    );
    expect(normalizeSql(fences.sql)).toContain(
      'order by head_row.employee_id collate "c" for no key update of head_row'
    );
    expect(fences.params).toEqual([tenantId, employeeA, employeeZ]);

    const teams = renderQuery(
      buildLockInboxV2WorkItemTeamsSql({
        tenantId,
        teamIds: ["team:z", "team:a"]
      })
    );
    expect(normalizeSql(teams.sql)).toContain(
      'order by id collate "c" for key share'
    );
    expect(teams.params).toEqual([tenantId, "team:a", "team:z"]);
  });

  it("uses the full SLA key and immutable fence provenance", () => {
    const sla = renderQuery(
      buildFindInboxV2WorkItemSlaSnapshotSql({
        tenantId,
        workItemId,
        slaCycle: "2",
        revision: "1"
      })
    );
    expect(normalizeSql(sla.sql)).toContain("and sla_cycle =");
    expect(sla.params).toEqual([tenantId, workItemId, "2", "1"]);

    const fenceVersion = renderQuery(
      buildFindInboxV2EmployeeAssignmentFenceVersionSql({
        tenantId,
        employeeId: employeeA,
        revision: inboxV2EntityRevisionSchema.parse("2")
      })
    );
    expect(normalizeSql(fenceVersion.sql)).toContain(
      "recorded_at, reason_id, changed_by_trusted_service_id"
    );

    const activeAssignments = renderQuery(
      buildHasInboxV2ActiveEmployeeAssignmentsSql({
        tenantId,
        employeeId: employeeA
      })
    );
    expect(normalizeSql(activeAssignments.sql)).toContain(
      "and state = 'active'"
    );
    expect(normalizeSql(activeAssignments.sql)).toContain(
      'order by id collate "c" limit 1'
    );
  });

  it("persists immutable canonical commits and terminal team relation proof", () => {
    const transitionCommit = lifecycleCommit();
    const transition = renderQuery(
      buildInsertInboxV2WorkItemTransitionSql(transitionCommit)
    );
    expect(normalizeSql(transition.sql)).toContain("canonical_commit");
    expect(normalizeSql(transition.sql)).toContain(
      "expected_servicing_team_relation_revision"
    );
    expect(normalizeSql(transition.sql)).toContain(
      "closed_primary_assignment_id"
    );
    expect(transition.params).toEqual(
      expect.arrayContaining([
        "7",
        "8",
        "work_item_servicing_team_episode:old",
        "work_item_primary_assignment:old",
        expect.stringContaining(occurredAtUtc)
      ])
    );

    const creation = renderQuery(
      buildInsertInboxV2WorkItemCreationDecisionSql(creationCommit())
    );
    expect(normalizeSql(creation.sql)).toContain("canonical_commit");
    expect(creation.params).toContainEqual(
      expect.stringContaining(occurredAtUtc)
    );

    const relationCommit = servicingTeamCommit();
    const relation = renderQuery(
      buildInsertInboxV2WorkItemRelationTransitionSql(relationCommit)
    );
    expect(normalizeSql(relation.sql)).toContain("canonical_commit");
    expect(relation.params).toEqual(
      expect.arrayContaining([
        "work_item_servicing_team_episode:old",
        "work_item_servicing_team_episode:new",
        expect.stringContaining(occurredAtUtc)
      ])
    );

    const cas = renderQuery(
      buildAdvanceInboxV2WorkItemServicingTeamSql(relationCommit)
    );
    expect(normalizeSql(cas.sql)).toContain(
      "and servicing_team_relation_revision ="
    );
    expect(cas.params).toEqual(expect.arrayContaining([tenantId, workItemId]));
  });

  it("rejects unbounded history and recovery reads before touching SQL", async () => {
    const executor = new NeverExecuteTransactionExecutor();
    const repository = createSqlInboxV2WorkItemRepository(executor);

    await expect(
      repository.listAssignmentHistory({
        tenantId,
        workItemId,
        limit: 129
      })
    ).rejects.toThrow("limit must be an integer from 1 to 128");
    await expect(
      repository.listRecoveryCandidates({
        tenantId,
        employeeId: employeeA,
        limit: 129
      })
    ).rejects.toThrow("limit must be an integer from 1 to 128");
    expect(executor.executeCount).toBe(0);
    expect(executor.transactionCount).toBe(0);
  });
});

class NeverExecuteTransactionExecutor implements InboxV2WorkItemTransactionExecutor {
  executeCount = 0;
  transactionCount = 0;

  async execute<Row extends Record<string, unknown>>(
    _query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.executeCount += 1;
    throw new Error("SQL must not execute");
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>
  ): Promise<TResult> {
    this.transactionCount += 1;
    return work(this);
  }
}

function creationCommit(): InboxV2WorkItemCreationCommit {
  return {
    tenantId,
    intakeDecision: {
      outcome: "create_work_item",
      conversation: { tenantId, kind: "conversation", id: conversationId },
      transport: "external",
      policyId: "core:intake",
      policyVersion: "v1",
      policyRevision: "1",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt: occurredAtOffset,
      queue: { tenantId, kind: "work_queue", id: queueId },
      latestTerminalHandling: "no_latest_work_item",
      reasonId: "core:new-inbound"
    },
    queueSnapshot: { revision: "3" },
    slotBefore: { revision: "1" },
    previousLatestWorkItem: null,
    createdWorkItem: { id: workItemId },
    slotAfter: { revision: "2" },
    occurredAt: occurredAtOffset
  } as unknown as InboxV2WorkItemCreationCommit;
}

function lifecycleCommit(): InboxV2WorkItemTransitionCommit {
  return {
    tenantId,
    before: { servicingTeamRelationRevision: "7" },
    after: { servicingTeamRelationRevision: "8" },
    transition: {
      tenantId,
      id: "work_item_transition:close",
      workItem: { tenantId, kind: "work_item", id: workItemId },
      kind: "close_resolved",
      fromState: "assigned",
      toState: "resolved",
      sourceQueue: {
        queue: { tenantId, kind: "work_queue", id: queueId },
        queueRevision: "3"
      },
      destinationQueue: {
        queue: { tenantId, kind: "work_queue", id: queueId },
        queueRevision: "3"
      },
      actor: {
        kind: "trusted_service",
        trustedServiceId: "core:work-service"
      },
      reasonId: "core:resolved",
      expectedRevision: "4",
      resultingRevision: "5",
      occurredAt: occurredAtOffset
    },
    servicingTeamEffect: {
      kind: "close",
      before: { id: "work_item_servicing_team_episode:old" }
    },
    assignmentEffect: {
      kind: "close",
      before: { id: "work_item_primary_assignment:old" }
    }
  } as unknown as InboxV2WorkItemTransitionCommit;
}

function servicingTeamCommit(): InboxV2WorkItemServicingTeamCommit {
  return {
    tenantId,
    before: {
      workItem: { tenantId, kind: "work_item", id: workItemId },
      workItemRevision: "4",
      servicingTeamRelationRevision: "7"
    },
    after: {
      workItemRevision: "5",
      servicingTeamRelationRevision: "8",
      resourceAccessRevision: "9",
      updatedAt: occurredAtOffset
    },
    transition: {
      tenantId,
      id: "work_item_relation_transition:change",
      workItem: { tenantId, kind: "work_item", id: workItemId },
      kind: "servicing_team_change",
      actor: {
        kind: "trusted_service",
        trustedServiceId: "core:work-service"
      },
      reasonId: "core:team-transfer",
      expectedWorkItemRevision: "4",
      resultingWorkItemRevision: "5",
      expectedRelationRevision: "7",
      resultingRelationRevision: "8",
      occurredAt: occurredAtOffset
    },
    closed: {
      before: { id: "work_item_servicing_team_episode:old" },
      after: { id: "work_item_servicing_team_episode:old" }
    },
    opened: {
      id: "work_item_servicing_team_episode:new",
      team: { id: "team:new" }
    }
  } as unknown as InboxV2WorkItemServicingTeamCommit;
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
