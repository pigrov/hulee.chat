import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { INBOX_V2_AUTHORIZATION_WORK_ITEM_BRIDGE_INTEGRITY_SQL } from "./inbox-v2/authorization-relations";
import {
  INBOX_V2_WORK_ITEM_INVARIANTS_SQL,
  inboxV2ConversationWorkItemSlots,
  inboxV2EmployeeAssignmentFenceHeads,
  inboxV2EmployeeAssignmentFenceVersions,
  inboxV2WorkAssignmentSource,
  inboxV2WorkItemCreationDecisions,
  inboxV2WorkItemPrimaryAssignments,
  inboxV2WorkItemRelationTransitions,
  inboxV2WorkItemServicingTeamEpisodes,
  inboxV2WorkItemSlaSnapshots,
  inboxV2WorkItemTransitionKind,
  inboxV2WorkItemTransitions,
  inboxV2WorkItems,
  inboxV2WorkQueueEligibilityDecisions,
  inboxV2WorkQueueHeads,
  inboxV2WorkQueueVersions
} from "./inbox-v2/work-item";
import { initialTables } from "./metadata";
import {
  employees,
  inboxV2Conversations,
  orgUnits,
  teams,
  workQueues
} from "./tables";

const workItemTables = [
  inboxV2WorkQueueVersions,
  inboxV2WorkQueueHeads,
  inboxV2EmployeeAssignmentFenceVersions,
  inboxV2EmployeeAssignmentFenceHeads,
  inboxV2WorkItems,
  inboxV2ConversationWorkItemSlots,
  inboxV2WorkItemSlaSnapshots,
  inboxV2WorkQueueEligibilityDecisions,
  inboxV2WorkItemCreationDecisions,
  inboxV2WorkItemPrimaryAssignments,
  inboxV2WorkItemTransitions,
  inboxV2WorkItemServicingTeamEpisodes,
  inboxV2WorkItemRelationTransitions
] as const;

describe("Inbox V2 WorkItem persistence schema", () => {
  it("registers the complete tenant-owned WorkItem boundary", () => {
    expect(workItemTables.map((table) => getTableConfig(table).name)).toEqual([
      "inbox_v2_work_queue_versions",
      "inbox_v2_work_queue_heads",
      "inbox_v2_employee_assignment_fence_versions",
      "inbox_v2_employee_assignment_fence_heads",
      "inbox_v2_work_items",
      "inbox_v2_conversation_work_item_slots",
      "inbox_v2_work_item_sla_snapshots",
      "inbox_v2_work_queue_eligibility_decisions",
      "inbox_v2_work_item_creation_decisions",
      "inbox_v2_work_item_primary_assignments",
      "inbox_v2_work_item_transitions",
      "inbox_v2_work_item_servicing_team_episodes",
      "inbox_v2_work_item_relation_transitions"
    ]);

    const metadataNames = new Set<string>(
      initialTables.map((table) => table.name)
    );
    for (const table of workItemTables) {
      const config = getTableConfig(table);
      const tenantColumn = config.columns.find(
        (column) => column.name === "tenant_id"
      );
      expect(tenantColumn?.notNull).toBe(true);
      expect(metadataNames.has(config.name)).toBe(true);
    }
  });

  it("pins every reusable identity and operational snapshot to the same tenant", () => {
    expectForeignKey(
      inboxV2WorkQueueVersions,
      "inbox_v2_work_queue_versions_queue_fk",
      workQueues,
      ["tenant_id", "work_queue_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2WorkQueueVersions,
      "inbox_v2_work_queue_versions_org_fk",
      orgUnits,
      ["tenant_id", "owner_org_unit_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2WorkItems,
      "inbox_v2_work_items_conversation_fk",
      inboxV2Conversations,
      ["tenant_id", "conversation_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2WorkItems,
      "inbox_v2_work_items_queue_version_fk",
      inboxV2WorkQueueVersions,
      ["tenant_id", "queue_id", "queue_revision"],
      ["tenant_id", "work_queue_id", "revision"]
    );
    expectForeignKey(
      inboxV2WorkQueueEligibilityDecisions,
      "inbox_v2_work_queue_eligibility_fence_fk",
      inboxV2EmployeeAssignmentFenceVersions,
      ["tenant_id", "employee_id", "employee_fence_revision"],
      ["tenant_id", "employee_id", "revision"]
    );
    expectForeignKey(
      inboxV2WorkItemPrimaryAssignments,
      "inbox_v2_work_item_primary_assignment_decision_fk",
      inboxV2WorkQueueEligibilityDecisions,
      ["tenant_id", "eligibility_decision_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2WorkItemServicingTeamEpisodes,
      "inbox_v2_work_item_servicing_team_team_fk",
      teams,
      ["tenant_id", "team_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2EmployeeAssignmentFenceVersions,
      "inbox_v2_employee_assignment_fence_employee_fk",
      employees,
      ["tenant_id", "employee_id"],
      ["tenant_id", "id"]
    );
  });

  it("prevents duplicate live WorkItems, primary owners and servicing teams", () => {
    expectPartialUnique(
      inboxV2WorkItems,
      "inbox_v2_work_items_non_terminal_unique",
      ["tenant_id", "conversation_id"],
      "in ('new', 'assigned', 'in_progress', 'waiting')"
    );
    expectPartialUnique(
      inboxV2WorkItemPrimaryAssignments,
      "inbox_v2_work_item_primary_assignment_active_unique",
      ["tenant_id", "work_item_id"],
      "= 'active'"
    );
    expectPartialUnique(
      inboxV2WorkItemServicingTeamEpisodes,
      "inbox_v2_work_item_servicing_team_active_unique",
      ["tenant_id", "work_item_id"],
      "= 'active'"
    );
  });

  it("indexes active primary assignments from the responsible employee", () => {
    const tableIndex = getTableConfig(
      inboxV2WorkItemPrimaryAssignments
    ).indexes.find(
      (candidate) =>
        candidate.config.name ===
        "inbox_v2_work_item_primary_assignment_employee_active_idx"
    );

    expect(tableIndex?.config.unique).toBe(false);
    expect(tableIndex?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "employee_id",
      "work_item_id",
      "id"
    ]);
    if (!tableIndex?.config.where) {
      throw new Error("Missing active employee assignment index predicate");
    }
    expect(new PgDialect().sqlToQuery(tableIndex.config.where).sql).toContain(
      `"state" = 'active'`
    );
  });

  it("stores immutable canonical commits for exact idempotent replay", () => {
    for (const table of [
      inboxV2WorkItemCreationDecisions,
      inboxV2WorkItemTransitions,
      inboxV2WorkItemRelationTransitions
    ]) {
      const column = getTableConfig(table).columns.find(
        (candidate) => candidate.name === "canonical_commit"
      );
      expect(column?.notNull).toBe(true);
    }

    expect(
      checkSql(
        inboxV2WorkItemCreationDecisions,
        "inbox_v2_work_item_creation_values_check"
      )
    ).toContain("jsonb_typeof");
    expect(
      checkSql(
        inboxV2WorkItemTransitions,
        "inbox_v2_work_item_transitions_values_check"
      )
    ).toContain("jsonb_typeof");
  });

  it("persists terminal team closure as a first-class relation revision proof", () => {
    const columns = getTableConfig(inboxV2WorkItemTransitions).columns.map(
      (column) => column.name
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "expected_servicing_team_relation_revision",
        "resulting_servicing_team_relation_revision",
        "closed_servicing_team_episode_id"
      ])
    );
    const shape = checkSql(
      inboxV2WorkItemTransitions,
      "inbox_v2_work_item_transitions_team_relation_check"
    );
    expect(shape).toContain("close_resolved");
    expect(shape).toContain("close_dismissed");
    expect(shape).toContain("+ 1");

    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "t.closed_servicing_team_episode_id is not null"
    );
    expect(invariantSql).toContain(
      "Terminal WorkItem relation proof must close its exact team episode"
    );
    expect(invariantSql).toContain(
      "WorkItem proof breaks the servicing-team relation chain"
    );
  });

  it("persists the exact primary-assignment effect for every transition", () => {
    const columns = getTableConfig(inboxV2WorkItemTransitions).columns.map(
      (column) => column.name
    );
    expect(columns).toEqual(
      expect.arrayContaining([
        "closed_primary_assignment_id",
        "opened_primary_assignment_id"
      ])
    );
    const shape = checkSql(
      inboxV2WorkItemTransitions,
      "inbox_v2_work_item_transitions_assignment_effect_check"
    );
    for (const kind of [
      "claim",
      "assign",
      "transfer",
      "release",
      "close_resolved",
      "reopen_assigned",
      "recovery_requeue",
      "recovery_transfer",
      "priority_change"
    ]) {
      expect(shape).toContain(kind);
    }

    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "Primary assignment must retain its exact opening transition"
    );
    expect(invariantSql).toContain(
      "WorkItem transition assignment effect lacks exact bidirectional history"
    );
    expect(invariantSql).toContain("t.closed_primary_assignment_id = a.id");
    expect(invariantSql).toContain("d.decided_at = t.occurred_at");
    expect(invariantSql).toContain(
      "d.employee_fence_loaded_at = t.occurred_at"
    );
    expect(invariantSql).toContain("t.actor_employee_id = a.employee_id");
    expect(invariantSql).toContain("a.end_basis = 'employee_fence_time'");
    expect(invariantSql).toContain("a.end_basis = 'command_time'");
    expect(invariantSql).toContain(
      "WorkItem primary-assignment pointers must follow the latest assignment effect"
    );
  });

  it("limits Queue mutation and locks every required destination snapshot", () => {
    const queueEffect = checkSql(
      inboxV2WorkItemTransitions,
      "inbox_v2_work_item_transitions_queue_effect_check"
    );
    expect(queueEffect).toContain("queue_transfer");
    expect(queueEffect).toContain("reopen_unassigned");
    expect(queueEffect).toContain("recovery_transfer");
    const queueTransfer = checkSql(
      inboxV2WorkItemTransitions,
      "inbox_v2_work_item_transitions_queue_transfer_change_check"
    );
    expect(queueTransfer).toContain("<>");
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "Queue-changing/opening transition requires the current active destination Queue"
    );
  });

  it("keeps contract transition and assignment catalogs closed", () => {
    expect(inboxV2WorkAssignmentSource.enumValues).toEqual([
      "claim",
      "manual_assignment",
      "policy_assignment",
      "transfer",
      "reopen",
      "recovery_transfer"
    ]);
    expect(inboxV2WorkItemTransitionKind.enumValues).toEqual([
      "claim",
      "assign",
      "start",
      "wait",
      "resume",
      "release",
      "transfer",
      "queue_transfer",
      "close_resolved",
      "close_dismissed",
      "reopen_unassigned",
      "reopen_assigned",
      "priority_change",
      "sla_refresh",
      "recovery_requeue",
      "recovery_transfer"
    ]);
  });

  it("requires object-shaped terminal and reopen snapshots", () => {
    expect(
      checkSql(inboxV2WorkItems, "inbox_v2_work_items_state_head_check")
    ).toContain("jsonb_typeof");
    expect(
      checkSql(inboxV2WorkItems, "inbox_v2_work_items_reopen_check")
    ).toContain("jsonb_typeof");
  });

  it("persists SLA cycles separately from per-cycle snapshot revisions", () => {
    expect(
      getTableConfig(inboxV2WorkItems).columns.map((column) => column.name)
    ).toEqual(expect.arrayContaining(["sla_cycle", "sla_snapshot_revision"]));
    expect(
      getTableConfig(inboxV2WorkItemSlaSnapshots).primaryKeys.map(
        (primaryKey) => primaryKey.columns.map((column) => column.name)
      )
    ).toEqual([["tenant_id", "work_item_id", "sla_cycle", "revision"]]);

    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain("v_work.sla_cycle <> 1");
    expect(invariantSql).toContain(
      "WorkItem SLA cycles and per-cycle revisions must be gap-free"
    );
    expect(invariantSql).toContain(
      "New-cycle reopen must reset SLA to exact destination Queue defaults"
    );
    expect(invariantSql).toContain(
      "Resume reopen must append one non-stopped SLA revision in the same cycle"
    );
  });

  it("pins revision-one defaults and SLA clock state to Queue and lifecycle", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "v_work.priority_id <> v_creation_queue.default_priority_id"
    );
    expect(invariantSql).toContain("v_work.resource_access_revision <> 1");
    expect(invariantSql).toContain("v_work.sla_snapshot_revision <> 1");
    expect(invariantSql).toContain("v_creation_sla.policy_id <>");
    expect(invariantSql).toContain("v_creation_sla.clock_state <> 'running'");
    expect(invariantSql).toContain(
      "WorkItem insert must be the exact revision-one Queue default head"
    );
    expect(invariantSql).toContain(
      "WorkItem cycle-one SLA must retain exact creation Queue defaults"
    );
    expect(invariantSql).toContain(
      "Tracked SLA clock state must follow WorkItem terminality"
    );
  });

  it("keeps both actor alternatives inside ended-episode shape guards", () => {
    for (const [table, checkName] of [
      [
        inboxV2WorkItemPrimaryAssignments,
        "inbox_v2_work_item_primary_assignment_end_shape_check"
      ],
      [
        inboxV2WorkItemServicingTeamEpisodes,
        "inbox_v2_work_item_servicing_team_end_shape_check"
      ]
    ] as const) {
      const shape = checkSql(table, checkName).replace(/\s+/gu, " ");
      expect(shape).toMatch(
        /and \(\([^)]*ended_actor_kind[^)]*'employee'[\s\S]*\) or \([^)]*ended_actor_kind[^)]*'trusted_service'[\s\S]*\)\)/u
      );
    }
  });

  it("serializes queue, employee-fence, eligibility and assignment races", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain("inbox_v2_work_queue_head_coherence");
    expect(invariantSql).toContain("inbox_v2_employee_fence_head_coherence");
    expect(invariantSql).toContain("inbox_v2_work_eligibility_guard");
    expect(invariantSql).toContain("inbox_v2_work_assignment_guard");
    expect(invariantSql).toContain("for update");
    expect(invariantSql).toContain("effect <> 'allow'");
    expect(invariantSql).toContain("lost the Employee fence race");
    expect(invariantSql).toContain(
      "v_fence_head.current_revision <> new.end_employee_fence_revision"
    );
    expect(invariantSql).toContain(
      "new.end_employee_fence_loaded_at <> new.end_recorded_at"
    );
    expect(invariantSql).toContain(
      "Primary assignment must be inserted as active revision one"
    );
    expect(invariantSql).toContain(
      "Servicing-team episode must be inserted as active revision one"
    );
    expect(invariantSql).toContain("active', 'draining'");
    expect(invariantSql).toContain(
      "Employee fence cannot become inactive with active assignments"
    );
  });

  it("enforces temporal history, aggregate heads and exact slot induction", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "inbox_v2_work_assignment_non_overlap_constraint"
    );
    expect(invariantSql).toContain(
      "inbox_v2_work_team_episode_non_overlap_constraint"
    );
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain("inbox_v2_work_item_aggregate_coherence");
    expect(invariantSql).toContain(
      "inbox_v2_conversation_work_item_slot_coherence"
    );
    expect(invariantSql).toContain("max(w.ordinal)");
    expect(invariantSql).toContain("v_work_item_count <> v_max_ordinal");
    expect(invariantSql).toContain("v_creation.slot_after_revision <>");
    expect(invariantSql).toContain("v_slot.latest_work_item_id");
    expect(invariantSql).toContain("v_slot.current_non_terminal_work_item_id");
    expect(invariantSql).toContain("v_expected_fence_revision");
    expect(invariantSql).toContain(
      "Close/reopen transition is allowed only for the latest WorkItem"
    );
    expect(invariantSql).toContain(
      "Older WorkItem cannot become non-terminal behind a terminal latest slot"
    );
    expect(invariantSql).toContain("last primary-assignment pointer");
    expect(invariantSql).toContain("last servicing-team pointer");
    expect(invariantSql).toContain("r.previous_episode_id = e.id");
    expect(invariantSql).toContain(
      "Servicing-team episode must retain its exact opening relation transition"
    );
    expect(invariantSql).toContain(
      "WorkItem servicing-team pointers must follow the latest relation effect"
    );
    expect(invariantSql).toContain(
      "WorkItem SLA snapshot revisions must be contiguous through the cycle head"
    );
    expect(invariantSql).toContain(
      "WorkItem reopen/collaborator revisions lack exact history proof"
    );
    expect(invariantSql).toContain(
      "WorkItem resource-access revision lacks exact authority-change proof"
    );
    expect(invariantSql).toContain(
      "Primary transfer must change Employee or Queue"
    );
    expect(invariantSql).toContain(
      "Servicing-team change must target a different Team"
    );
    expect(invariantSql).not.toContain("btree_gist");
  });

  it("binds every WorkItem update to one exact OLD/NEW proof", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "inbox_v2_work_item_mutation_coherence_constraint"
    );
    expect(invariantSql).toContain(
      "Each WorkItem +1 mutation requires exactly one lifecycle XOR relation proof"
    );
    expect(invariantSql).toContain(
      "WorkItem lifecycle proof does not bind the exact OLD and NEW heads"
    );
    expect(invariantSql).toContain(
      "Only priority_change may mutate WorkItem priority"
    );
    expect(invariantSql).toContain(
      "SLA refresh must advance one tracked SLA snapshot revision"
    );
    expect(invariantSql).toContain(
      "WorkItem mutation has an invalid resource-access revision step"
    );
    expect(invariantSql).toContain(
      "Servicing-team relation command mutated an unrelated WorkItem field"
    );
    expect(invariantSql).toContain(
      "after update on public.inbox_v2_work_items\ndeferrable initially deferred"
    );
  });

  it("accepts only an exact authorization collaborator-set proof override", () => {
    const bridgeSql = INBOX_V2_AUTHORIZATION_WORK_ITEM_BRIDGE_INTEGRITY_SQL;
    expect(
      bridgeSql.match(/create or replace function public\./g)?.length
    ).toBe(2);
    expect(
      bridgeSql.match(/set search_path = pg_catalog, public, pg_temp/g)?.length
    ).toBe(2);
    expect(bridgeSql).not.toContain("create trigger");
    expect(bridgeSql).not.toContain("create constraint trigger");
    expect(bridgeSql).toContain(
      "create or replace function public.inbox_v2_work_item_aggregate_coherence()"
    );
    expect(bridgeSql).toContain(
      "create or replace function public.inbox_v2_work_item_mutation_coherence()"
    );
    expect(bridgeSql).toContain("effect_row.effect_kind = 'collaborator_set'");
    expect(bridgeSql).toContain("effect_row.resulting_work_item_revision");
    expect(bridgeSql).toContain(
      "v_collaborator_effect.work_item_cycle <> new.reopen_cycle"
    );
    expect(bridgeSql).toContain(
      "v_collaborator_effect.expected_work_item_revision <> old.revision"
    );
    expect(bridgeSql).toContain(
      "new.collaborator_set_revision <>\n         old.collaborator_set_revision + 1"
    );
    expect(bridgeSql).toContain(
      "to_jsonb(new) - array[\n         'revision', 'updated_at', 'collaborator_set_revision'"
    );
    expect(bridgeSql).toContain(
      "exactly one lifecycle XOR servicing-team XOR collaborator-set proof"
    );
  });

  it("uses exact command-time boundaries for assignment and team histories", () => {
    const assignmentTimes = checkSql(
      inboxV2WorkItemPrimaryAssignments,
      "inbox_v2_work_item_primary_assignment_timestamps_check"
    );
    expect(assignmentTimes).toContain('created_at" =');
    expect(assignmentTimes).toContain('updated_at" =');

    const teamTimes = checkSql(
      inboxV2WorkItemServicingTeamEpisodes,
      "inbox_v2_work_item_servicing_team_timestamps_check"
    );
    expect(teamTimes).toContain('created_at" =');
    expect(teamTimes).toMatch(/"end_recorded_at" = [^\n]*"ended_at"/u);
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "e.ended_at = r.occurred_at"
    );
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "e.ended_at = t.occurred_at"
    );
  });

  it("bootstraps every existing and future Employee fence and Conversation slot", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    expect(invariantSql).toContain("inbox_v2_employee_fence_sync");
    expect(invariantSql).toContain("v_effective_from := v_recorded_at");
    expect(invariantSql).toContain(
      "after update of deactivated_at on public.employees"
    );
    expect(invariantSql).toContain(
      "from public.employees e\non conflict do nothing"
    );
    expect(invariantSql).toContain("inbox_v2_conversation_slot_bootstrap");
    expect(invariantSql).toContain(
      "after insert on public.inbox_v2_conversations"
    );
    expect(invariantSql).toContain("sha256");
    expect(invariantSql).not.toContain("md5(");
  });

  it("lets WorkItem ownership drive creation-history cascade deterministically", () => {
    const conversationForeignKey = getTableConfig(
      inboxV2WorkItemCreationDecisions
    ).foreignKeys.find(
      (candidate) =>
        candidate.getName() === "inbox_v2_work_item_creation_conversation_fk"
    );
    expect(conversationForeignKey?.onDelete).not.toBe("cascade");
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "tg_table_name = 'inbox_v2_work_item_creation_decisions'"
    );
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "c.id = to_jsonb(old)->>'conversation_id'"
    );
    expect(INBOX_V2_WORK_ITEM_INVARIANTS_SQL).toContain(
      "e.id = to_jsonb(old)->>'employee_id'"
    );
    const immutableGuard = INBOX_V2_WORK_ITEM_INVARIANTS_SQL.split(
      "create or replace function public.inbox_v2_work_queue_head_guard"
    )[0];
    expect(immutableGuard).not.toContain("old.work_queue_id");
  });

  it("schema-qualifies SQL access and fixes search_path on every function", () => {
    const invariantSql = INBOX_V2_WORK_ITEM_INVARIANTS_SQL;
    const functionCount =
      invariantSql.match(/create or replace function public\./g)?.length ?? 0;
    const searchPathCount =
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
        ?.length ?? 0;
    expect(functionCount).toBeGreaterThan(10);
    expect(searchPathCount).toBe(functionCount);
    expect(invariantSql).not.toMatch(/\b(?:from|join|update) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);
  });

  it("keeps every explicit operational index tenant-leading", () => {
    for (const table of workItemTables) {
      for (const tableIndex of getTableConfig(table).indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });
});

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  const reference = foreignKey?.reference();
  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns
  );
}

function expectPartialUnique(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  columns: string[],
  whereFragment: string
): void {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  expect(tableIndex?.config.unique).toBe(true);
  expect(tableIndex?.config.columns.map(indexColumnName)).toEqual(columns);
  if (!tableIndex?.config.where) {
    throw new Error(`Missing partial-index predicate: ${name}`);
  }
  expect(new PgDialect().sqlToQuery(tableIndex.config.where).sql).toContain(
    whereFragment
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing expected check: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
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
