import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  employees,
  inboxV2ConversationTransport,
  inboxV2Conversations,
  orgUnits,
  teams,
  workQueues
} from "../tables";

export const inboxV2WorkQueueLifecycle = pgEnum(
  "inbox_v2_work_queue_lifecycle",
  ["active", "disabled"]
);

export const inboxV2WorkQueueReplyPolicyMode = pgEnum(
  "inbox_v2_work_queue_reply_policy_mode",
  ["responsible_only", "responsible_or_work_item_collaborator"]
);

export const inboxV2WorkSlaKind = pgEnum("inbox_v2_work_sla_kind", [
  "not_applied",
  "tracked"
]);

export const inboxV2WorkSlaClockState = pgEnum(
  "inbox_v2_work_sla_clock_state",
  ["running", "paused", "stopped"]
);

export const inboxV2EmployeeAssignmentFenceState = pgEnum(
  "inbox_v2_employee_assignment_fence_state",
  ["active", "draining", "inactive"]
);

export const inboxV2WorkEligibilityBasis = pgEnum(
  "inbox_v2_work_eligibility_basis",
  ["queue_membership", "policy_override", "routing_policy"]
);

export const inboxV2WorkEligibilityEffect = pgEnum(
  "inbox_v2_work_eligibility_effect",
  ["allow", "deny"]
);

export const inboxV2WorkItemState = pgEnum("inbox_v2_work_item_state", [
  "new",
  "assigned",
  "in_progress",
  "waiting",
  "resolved",
  "dismissed"
]);

export const inboxV2WorkActorKind = pgEnum("inbox_v2_work_actor_kind", [
  "employee",
  "trusted_service"
]);

export const inboxV2WorkItemLifecycleClass = pgEnum(
  "inbox_v2_work_item_lifecycle_class",
  ["non_terminal", "terminal"]
);

export const inboxV2WorkItemLatestTerminalHandling = pgEnum(
  "inbox_v2_work_item_latest_terminal_handling",
  ["no_latest_work_item", "create_sequential"]
);

export const inboxV2WorkAssignmentSource = pgEnum(
  "inbox_v2_work_assignment_source",
  [
    "claim",
    "manual_assignment",
    "policy_assignment",
    "transfer",
    "reopen",
    "recovery_transfer"
  ]
);

export const inboxV2WorkAssignmentState = pgEnum(
  "inbox_v2_work_assignment_state",
  ["active", "ended"]
);

export const inboxV2WorkAssignmentEndBasis = pgEnum(
  "inbox_v2_work_assignment_end_basis",
  ["command_time", "employee_fence_time"]
);

export const inboxV2WorkItemTransitionKind = pgEnum(
  "inbox_v2_work_item_transition_kind",
  [
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
  ]
);

export const inboxV2WorkRelationState = pgEnum("inbox_v2_work_relation_state", [
  "active",
  "ended"
]);

export const inboxV2WorkRelationEndCause = pgEnum(
  "inbox_v2_work_relation_end_cause",
  ["relation_command", "work_item_terminal"]
);

export const inboxV2WorkRelationTransitionKind = pgEnum(
  "inbox_v2_work_relation_transition_kind",
  ["servicing_team_add", "servicing_team_remove", "servicing_team_change"]
);

/** Immutable V2 operational Queue snapshot over the reusable WorkQueue identity. */
export const inboxV2WorkQueueVersions = pgTable(
  "inbox_v2_work_queue_versions",
  {
    tenantId: text("tenant_id").notNull(),
    workQueueId: text("work_queue_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    ownerOrgUnitId: text("owner_org_unit_id").notNull(),
    lifecycle: inboxV2WorkQueueLifecycle("lifecycle").notNull(),
    eligibilityPolicyId: text("eligibility_policy_id").notNull(),
    eligibilityPolicyVersion: text("eligibility_policy_version").notNull(),
    eligibilityPolicyRevision: bigint("eligibility_policy_revision", {
      mode: "bigint"
    }).notNull(),
    externalReplyPolicyMode: inboxV2WorkQueueReplyPolicyMode(
      "external_reply_policy_mode"
    ).notNull(),
    externalReplyPolicyVersion: text("external_reply_policy_version").notNull(),
    externalReplyPolicyRevision: bigint("external_reply_policy_revision", {
      mode: "bigint"
    }).notNull(),
    defaultPriorityId: text("default_priority_id").notNull(),
    defaultSlaKind: inboxV2WorkSlaKind("default_sla_kind").notNull(),
    defaultSlaPolicyId: text("default_sla_policy_id"),
    defaultSlaPolicyVersion: text("default_sla_policy_version"),
    defaultSlaPolicyRevision: bigint("default_sla_policy_revision", {
      mode: "bigint"
    }),
    defaultBusinessCalendarId: text("default_business_calendar_id"),
    defaultBusinessCalendarVersion: text("default_business_calendar_version"),
    defaultBusinessCalendarRevision: bigint(
      "default_business_calendar_revision",
      { mode: "bigint" }
    ),
    defaultSlaTimeZone: text("default_sla_time_zone"),
    resourceAccessRevision: bigint("resource_access_revision", {
      mode: "bigint"
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_queue_versions_pk",
      columns: [table.tenantId, table.workQueueId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_work_queue_versions_queue_fk",
      columns: [table.tenantId, table.workQueueId],
      foreignColumns: [workQueues.tenantId, workQueues.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_queue_versions_org_fk",
      columns: [table.tenantId, table.ownerOrgUnitId],
      foreignColumns: [orgUnits.tenantId, orgUnits.id]
    }),
    check(
      "inbox_v2_work_queue_versions_values_check",
      sql`${table.revision} >= 1
        and ${table.eligibilityPolicyRevision} >= 1
        and ${table.externalReplyPolicyRevision} >= 1
        and ${table.resourceAccessRevision} >= 1
        and ${catalogIdSql(table.eligibilityPolicyId)}
        and ${versionTokenSql(table.eligibilityPolicyVersion)}
        and ${versionTokenSql(table.externalReplyPolicyVersion)}
        and ${catalogIdSql(table.defaultPriorityId)}`
    ),
    check(
      "inbox_v2_work_queue_versions_sla_check",
      sql`(
          ${table.defaultSlaKind} = 'not_applied'
          and ${table.defaultSlaPolicyId} is null
          and ${table.defaultSlaPolicyVersion} is null
          and ${table.defaultSlaPolicyRevision} is null
          and ${table.defaultBusinessCalendarId} is null
          and ${table.defaultBusinessCalendarVersion} is null
          and ${table.defaultBusinessCalendarRevision} is null
          and ${table.defaultSlaTimeZone} is null
        ) or (
          ${table.defaultSlaKind} = 'tracked'
          and ${table.defaultSlaPolicyId} is not null
          and ${table.defaultSlaPolicyVersion} is not null
          and ${table.defaultSlaPolicyRevision} >= 1
          and ${table.defaultBusinessCalendarId} is not null
          and ${table.defaultBusinessCalendarVersion} is not null
          and ${table.defaultBusinessCalendarRevision} >= 1
          and ${table.defaultSlaTimeZone} is not null
          and ${catalogIdSql(table.defaultSlaPolicyId)}
          and ${versionTokenSql(table.defaultSlaPolicyVersion)}
          and ${catalogIdSql(table.defaultBusinessCalendarId)}
          and ${versionTokenSql(table.defaultBusinessCalendarVersion)}
        )`
    ),
    check(
      "inbox_v2_work_queue_versions_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_work_queue_versions_tenant_queue_idx").on(
      table.tenantId,
      table.workQueueId,
      table.revision.desc()
    )
  ]
);

/** One CAS pointer to the current immutable WorkQueue version. */
export const inboxV2WorkQueueHeads = pgTable(
  "inbox_v2_work_queue_heads",
  {
    tenantId: text("tenant_id").notNull(),
    workQueueId: text("work_queue_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_queue_heads_pk",
      columns: [table.tenantId, table.workQueueId]
    }),
    foreignKey({
      name: "inbox_v2_work_queue_heads_version_fk",
      columns: [table.tenantId, table.workQueueId, table.currentRevision],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_work_queue_heads_values_check",
      sql`${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_work_queue_heads_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_work_queue_heads_tenant_revision_idx").on(
      table.tenantId,
      table.currentRevision,
      table.workQueueId
    )
  ]
);

/** Immutable Employee assignment-eligibility history. */
export const inboxV2EmployeeAssignmentFenceVersions = pgTable(
  "inbox_v2_employee_assignment_fence_versions",
  {
    tenantId: text("tenant_id").notNull(),
    employeeId: text("employee_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    generation: bigint("generation", { mode: "bigint" }).notNull(),
    state: inboxV2EmployeeAssignmentFenceState("state").notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    reasonId: text("reason_id").notNull(),
    changedByTrustedServiceId: text("changed_by_trusted_service_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_employee_assignment_fence_versions_pk",
      columns: [table.tenantId, table.employeeId, table.revision]
    }),
    unique("inbox_v2_employee_assignment_fence_generation_unique").on(
      table.tenantId,
      table.employeeId,
      table.generation
    ),
    foreignKey({
      name: "inbox_v2_employee_assignment_fence_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_employee_assignment_fence_values_check",
      sql`${table.revision} >= 1
        and ${table.generation} >= 1
        and ${catalogIdSql(table.reasonId)}
        and ${catalogIdSql(table.changedByTrustedServiceId)}`
    ),
    check(
      "inbox_v2_employee_assignment_fence_times_check",
      sql`isfinite(${table.effectiveFrom})
        and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.effectiveFrom}`
    ),
    index("inbox_v2_employee_assignment_fence_history_idx").on(
      table.tenantId,
      table.employeeId,
      table.effectiveFrom.desc(),
      table.revision.desc()
    )
  ]
);

/** Authoritative Employee fence locked by claim/assign/transfer. */
export const inboxV2EmployeeAssignmentFenceHeads = pgTable(
  "inbox_v2_employee_assignment_fence_heads",
  {
    tenantId: text("tenant_id").notNull(),
    employeeId: text("employee_id").notNull(),
    state: inboxV2EmployeeAssignmentFenceState("state").notNull(),
    currentGeneration: bigint("current_generation", {
      mode: "bigint"
    }).notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    effectiveFrom: timestamp("effective_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_employee_assignment_fence_heads_pk",
      columns: [table.tenantId, table.employeeId]
    }),
    foreignKey({
      name: "inbox_v2_employee_assignment_fence_head_version_fk",
      columns: [table.tenantId, table.employeeId, table.currentRevision],
      foreignColumns: [
        inboxV2EmployeeAssignmentFenceVersions.tenantId,
        inboxV2EmployeeAssignmentFenceVersions.employeeId,
        inboxV2EmployeeAssignmentFenceVersions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_employee_assignment_fence_head_values_check",
      sql`${table.currentGeneration} >= 1 and ${table.currentRevision} >= 1`
    ),
    check(
      "inbox_v2_employee_assignment_fence_head_times_check",
      sql`isfinite(${table.effectiveFrom})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_employee_assignment_fence_state_idx").on(
      table.tenantId,
      table.state,
      table.employeeId
    )
  ]
);

/** Compact WorkItem aggregate head. Histories stay independently pageable. */
export const inboxV2WorkItems = pgTable(
  "inbox_v2_work_items",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    ordinal: bigint("ordinal", { mode: "bigint" }).notNull(),
    state: inboxV2WorkItemState("state").notNull(),
    queueId: text("queue_id").notNull(),
    queueRevision: bigint("queue_revision", { mode: "bigint" }).notNull(),
    priorityId: text("priority_id").notNull(),
    slaCycle: bigint("sla_cycle", { mode: "bigint" }).notNull(),
    slaSnapshotRevision: bigint("sla_snapshot_revision", {
      mode: "bigint"
    }).notNull(),
    currentPrimaryAssignmentId: text("current_primary_assignment_id"),
    lastPrimaryAssignmentId: text("last_primary_assignment_id"),
    currentServicingTeamEpisodeId: text("current_servicing_team_episode_id"),
    currentServicingTeamId: text("current_servicing_team_id"),
    lastServicingTeamEpisodeId: text("last_servicing_team_episode_id"),
    servicingTeamRelationRevision: bigint("servicing_team_relation_revision", {
      mode: "bigint"
    }).notNull(),
    collaboratorSetRevision: bigint("collaborator_set_revision", {
      mode: "bigint"
    }).notNull(),
    resourceAccessRevision: bigint("resource_access_revision", {
      mode: "bigint"
    }).notNull(),
    reopenCycle: bigint("reopen_cycle", { mode: "bigint" }).notNull(),
    lastReopenSnapshot: jsonb("last_reopen_snapshot").$type<
      Readonly<Record<string, unknown>>
    >(),
    terminalSnapshot:
      jsonb("terminal_snapshot").$type<Readonly<Record<string, unknown>>>(),
    createdActorKind: inboxV2WorkActorKind("created_actor_kind").notNull(),
    createdActorEmployeeId: text("created_actor_employee_id"),
    createdActorAuthorizationEpoch: text("created_actor_authorization_epoch"),
    createdActorTrustedServiceId: text("created_actor_trusted_service_id"),
    creationReasonId: text("creation_reason_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_items_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_work_items_conversation_ordinal_unique").on(
      table.tenantId,
      table.conversationId,
      table.ordinal
    ),
    foreignKey({
      name: "inbox_v2_work_items_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_items_queue_version_fk",
      columns: [table.tenantId, table.queueId, table.queueRevision],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_items_creator_employee_fk",
      columns: [table.tenantId, table.createdActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_items_current_team_fk",
      columns: [table.tenantId, table.currentServicingTeamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    check(
      "inbox_v2_work_items_values_check",
      sql`${table.ordinal} >= 1
        and ${table.queueRevision} >= 1
        and ${table.slaCycle} >= 1
        and ${table.slaSnapshotRevision} >= 1
        and ${table.servicingTeamRelationRevision} >= 1
        and ${table.collaboratorSetRevision} >= 1
        and ${table.resourceAccessRevision} >= 1
        and ${table.reopenCycle} >= 0
        and ${table.revision} >= 1
        and ${catalogIdSql(table.priorityId)}
        and ${catalogIdSql(table.creationReasonId)}`
    ),
    check(
      "inbox_v2_work_items_actor_check",
      workActorSql(
        table.createdActorKind,
        table.createdActorEmployeeId,
        table.createdActorAuthorizationEpoch,
        table.createdActorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_work_items_state_head_check",
      sql`(
          ${table.state} = 'new'
          and ${table.currentPrimaryAssignmentId} is null
          and ${table.terminalSnapshot} is null
        ) or (
          ${table.state} in ('assigned', 'in_progress', 'waiting')
          and ${table.currentPrimaryAssignmentId} is not null
          and ${table.terminalSnapshot} is null
        ) or (
          ${table.state} in ('resolved', 'dismissed')
          and ${table.currentPrimaryAssignmentId} is null
          and ${table.currentServicingTeamEpisodeId} is null
          and ${table.currentServicingTeamId} is null
          and ${table.terminalSnapshot} is not null
          and jsonb_typeof(${table.terminalSnapshot}) = 'object'
        )`
    ),
    check(
      "inbox_v2_work_items_team_head_check",
      sql`(${table.currentServicingTeamEpisodeId} is null) =
          (${table.currentServicingTeamId} is null)`
    ),
    check(
      "inbox_v2_work_items_reopen_check",
      sql`(${table.reopenCycle} = 0 and ${table.lastReopenSnapshot} is null)
        or (${table.reopenCycle} > 0
          and ${table.lastReopenSnapshot} is not null
          and jsonb_typeof(${table.lastReopenSnapshot}) = 'object')`
    ),
    check(
      "inbox_v2_work_items_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    uniqueIndex("inbox_v2_work_items_non_terminal_unique")
      .on(table.tenantId, table.conversationId)
      .where(
        sql`${table.state} in ('new', 'assigned', 'in_progress', 'waiting')`
      ),
    index("inbox_v2_work_items_queue_access_idx").on(
      table.tenantId,
      table.queueId,
      table.state,
      table.priorityId,
      table.updatedAt.desc(),
      table.id
    ),
    index("inbox_v2_work_items_conversation_history_idx").on(
      table.tenantId,
      table.conversationId,
      table.ordinal.desc(),
      table.id
    ),
    index("inbox_v2_work_items_current_primary_idx").on(
      table.tenantId,
      table.currentPrimaryAssignmentId,
      table.state,
      table.updatedAt.desc()
    ),
    index("inbox_v2_work_items_servicing_team_idx").on(
      table.tenantId,
      table.currentServicingTeamId,
      table.state,
      table.updatedAt.desc(),
      table.id
    )
  ]
);

/** One compact CAS row serializes sequential WorkItems for a Conversation. */
export const inboxV2ConversationWorkItemSlots = pgTable(
  "inbox_v2_conversation_work_item_slots",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    latestOrdinal: bigint("latest_ordinal", { mode: "bigint" }).notNull(),
    latestWorkItemId: text("latest_work_item_id"),
    latestLifecycleClass: inboxV2WorkItemLifecycleClass(
      "latest_lifecycle_class"
    ),
    latestLifecycleFenceRevision: bigint("latest_lifecycle_fence_revision", {
      mode: "bigint"
    }),
    currentNonTerminalWorkItemId: text("current_non_terminal_work_item_id"),
    currentNonTerminalOrdinal: bigint("current_non_terminal_ordinal", {
      mode: "bigint"
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_work_item_slots_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_conversation_work_item_slots_conversation_unique").on(
      table.tenantId,
      table.conversationId
    ),
    foreignKey({
      name: "inbox_v2_work_item_slots_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_slots_latest_fk",
      columns: [table.tenantId, table.latestWorkItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_slots_current_fk",
      columns: [table.tenantId, table.currentNonTerminalWorkItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }),
    check(
      "inbox_v2_conversation_work_item_slots_values_check",
      sql`${table.latestOrdinal} >= 0 and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_conversation_work_item_slots_latest_check",
      sql`(
          ${table.latestOrdinal} = 0
          and ${table.latestWorkItemId} is null
          and ${table.latestLifecycleClass} is null
          and ${table.latestLifecycleFenceRevision} is null
        ) or (
          ${table.latestOrdinal} > 0
          and ${table.latestWorkItemId} is not null
          and ${table.latestLifecycleClass} is not null
          and ${table.latestLifecycleFenceRevision} >= 1
        )`
    ),
    check(
      "inbox_v2_conversation_work_item_slots_current_check",
      sql`(
          ${table.currentNonTerminalWorkItemId} is null
          and ${table.currentNonTerminalOrdinal} is null
        ) or (
          ${table.currentNonTerminalWorkItemId} is not null
          and ${table.currentNonTerminalOrdinal} >= 1
        )`
    ),
    check(
      "inbox_v2_conversation_work_item_slots_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_conversation_work_item_slots_current_idx").on(
      table.tenantId,
      table.currentNonTerminalWorkItemId,
      table.conversationId
    )
  ]
);

/** Immutable calculated SLA snapshot; WorkItem points to one exact revision. */
export const inboxV2WorkItemSlaSnapshots = pgTable(
  "inbox_v2_work_item_sla_snapshots",
  {
    tenantId: text("tenant_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    slaCycle: bigint("sla_cycle", { mode: "bigint" }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    kind: inboxV2WorkSlaKind("kind").notNull(),
    absenceReasonId: text("absence_reason_id"),
    policyId: text("policy_id"),
    policyVersion: text("policy_version"),
    policyRevision: bigint("policy_revision", { mode: "bigint" }),
    inputRevision: bigint("input_revision", { mode: "bigint" }),
    businessCalendarId: text("business_calendar_id"),
    businessCalendarVersion: text("business_calendar_version"),
    businessCalendarRevision: bigint("business_calendar_revision", {
      mode: "bigint"
    }),
    timeZone: text("time_zone"),
    clockState: inboxV2WorkSlaClockState("clock_state"),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }),
    pausedAt: timestamp("paused_at", {
      withTimezone: true,
      precision: 3
    }),
    pauseConditionId: text("pause_condition_id"),
    stoppedAt: timestamp("stopped_at", {
      withTimezone: true,
      precision: 3
    }),
    firstHumanResponseDueAt: timestamp("first_human_response_due_at", {
      withTimezone: true,
      precision: 3
    }),
    resolutionDueAt: timestamp("resolution_due_at", {
      withTimezone: true,
      precision: 3
    }),
    firstHumanResponseAt: timestamp("first_human_response_at", {
      withTimezone: true,
      precision: 3
    }),
    calculatedAt: timestamp("calculated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_sla_snapshots_pk",
      columns: [
        table.tenantId,
        table.workItemId,
        table.slaCycle,
        table.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_sla_snapshots_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_work_item_sla_snapshots_values_check",
      sql`${table.slaCycle} >= 1 and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_work_item_sla_snapshots_shape_check",
      sql`(
          ${table.kind} = 'not_applied'
          and ${table.absenceReasonId} is not null
          and ${table.policyId} is null
          and ${table.policyVersion} is null
          and ${table.policyRevision} is null
          and ${table.inputRevision} is null
          and ${table.businessCalendarId} is null
          and ${table.businessCalendarVersion} is null
          and ${table.businessCalendarRevision} is null
          and ${table.timeZone} is null
          and ${table.clockState} is null
          and ${table.startedAt} is null
          and ${table.pausedAt} is null
          and ${table.pauseConditionId} is null
          and ${table.stoppedAt} is null
          and ${table.firstHumanResponseDueAt} is null
          and ${table.resolutionDueAt} is null
          and ${table.firstHumanResponseAt} is null
          and ${catalogIdSql(table.absenceReasonId)}
        ) or (
          ${table.kind} = 'tracked'
          and ${table.absenceReasonId} is null
          and ${table.policyId} is not null
          and ${table.policyVersion} is not null
          and ${table.policyRevision} >= 1
          and ${table.inputRevision} >= 1
          and ${table.businessCalendarId} is not null
          and ${table.businessCalendarVersion} is not null
          and ${table.businessCalendarRevision} >= 1
          and ${table.timeZone} is not null
          and ${table.clockState} is not null
          and ${table.startedAt} is not null
          and ${catalogIdSql(table.policyId)}
          and ${versionTokenSql(table.policyVersion)}
          and ${catalogIdSql(table.businessCalendarId)}
          and ${versionTokenSql(table.businessCalendarVersion)}
        )`
    ),
    check(
      "inbox_v2_work_item_sla_snapshots_clock_check",
      sql`${table.kind} = 'not_applied' or (
        (
          ${table.clockState} = 'paused'
          and ${table.pausedAt} is not null
          and ${table.pauseConditionId} is not null
          and ${catalogIdSql(table.pauseConditionId)}
        ) or (
          ${table.clockState} <> 'paused'
          and ${table.pausedAt} is null
          and ${table.pauseConditionId} is null
        )
      ) and (
        (${table.clockState} = 'stopped') = (${table.stoppedAt} is not null)
      )`
    ),
    check(
      "inbox_v2_work_item_sla_snapshots_timestamps_check",
      sql`isfinite(${table.calculatedAt})
        and isfinite(${table.createdAt})
        and (${table.startedAt} is null or isfinite(${table.startedAt}))
        and (${table.pausedAt} is null or isfinite(${table.pausedAt}))
        and (${table.stoppedAt} is null or isfinite(${table.stoppedAt}))
        and (${table.firstHumanResponseDueAt} is null
          or isfinite(${table.firstHumanResponseDueAt}))
        and (${table.resolutionDueAt} is null
          or isfinite(${table.resolutionDueAt}))
        and (${table.firstHumanResponseAt} is null
          or isfinite(${table.firstHumanResponseAt}))
        and (${table.startedAt} is null
          or ${table.calculatedAt} >= ${table.startedAt})
        and (${table.pausedAt} is null
          or ${table.pausedAt} >= ${table.startedAt})
        and (${table.stoppedAt} is null
          or ${table.stoppedAt} >= ${table.startedAt})
        and (${table.firstHumanResponseAt} is null
          or ${table.firstHumanResponseAt} >= ${table.startedAt})`
    ),
    index("inbox_v2_work_item_sla_snapshots_history_idx").on(
      table.tenantId,
      table.workItemId,
      table.slaCycle.desc(),
      table.revision.desc()
    ),
    index("inbox_v2_work_item_sla_snapshots_response_due_idx").on(
      table.tenantId,
      table.firstHumanResponseDueAt,
      table.workItemId
    ),
    index("inbox_v2_work_item_sla_snapshots_resolution_due_idx").on(
      table.tenantId,
      table.resolutionDueAt,
      table.workItemId
    )
  ]
);

/** Immutable, server-loaded assignment decision for one exact target. */
export const inboxV2WorkQueueEligibilityDecisions = pgTable(
  "inbox_v2_work_queue_eligibility_decisions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workItemId: text("work_item_id").notNull(),
    expectedWorkItemRevision: bigint("expected_work_item_revision", {
      mode: "bigint"
    }).notNull(),
    workQueueId: text("work_queue_id").notNull(),
    workQueueRevision: bigint("work_queue_revision", {
      mode: "bigint"
    }).notNull(),
    workQueueLifecycle: inboxV2WorkQueueLifecycle(
      "work_queue_lifecycle"
    ).notNull(),
    employeeId: text("employee_id").notNull(),
    employeeFenceRevision: bigint("employee_fence_revision", {
      mode: "bigint"
    }).notNull(),
    employeeFenceGeneration: bigint("employee_fence_generation", {
      mode: "bigint"
    }).notNull(),
    employeeFenceState: inboxV2EmployeeAssignmentFenceState(
      "employee_fence_state"
    ).notNull(),
    employeeFenceEffectiveFrom: timestamp("employee_fence_effective_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    employeeFenceLoadedAt: timestamp("employee_fence_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    policyRevision: bigint("policy_revision", { mode: "bigint" }).notNull(),
    eligibilityBasis:
      inboxV2WorkEligibilityBasis("eligibility_basis").notNull(),
    eligibilityEvidenceRevision: bigint("eligibility_evidence_revision", {
      mode: "bigint"
    }).notNull(),
    effect: inboxV2WorkEligibilityEffect("effect").notNull(),
    reasonId: text("reason_id").notNull(),
    decisionRevision: bigint("decision_revision", { mode: "bigint" }).notNull(),
    loadedByTrustedServiceId: text("loaded_by_trusted_service_id").notNull(),
    decidedAt: timestamp("decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    notAfter: timestamp("not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_queue_eligibility_decisions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_work_queue_eligibility_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_queue_eligibility_queue_fk",
      columns: [table.tenantId, table.workQueueId, table.workQueueRevision],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_queue_eligibility_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_queue_eligibility_fence_fk",
      columns: [table.tenantId, table.employeeId, table.employeeFenceRevision],
      foreignColumns: [
        inboxV2EmployeeAssignmentFenceVersions.tenantId,
        inboxV2EmployeeAssignmentFenceVersions.employeeId,
        inboxV2EmployeeAssignmentFenceVersions.revision
      ]
    }),
    unique("inbox_v2_work_queue_eligibility_exact_unique").on(
      table.tenantId,
      table.workItemId,
      table.expectedWorkItemRevision,
      table.workQueueId,
      table.employeeId,
      table.id
    ),
    check(
      "inbox_v2_work_queue_eligibility_values_check",
      sql`${table.expectedWorkItemRevision} >= 1
        and ${table.workQueueRevision} >= 1
        and ${table.employeeFenceRevision} >= 1
        and ${table.employeeFenceGeneration} >= 1
        and ${table.policyRevision} >= 1
        and ${table.eligibilityEvidenceRevision} >= 1
        and ${table.decisionRevision} = 1
        and ${catalogIdSql(table.policyId)}
        and ${versionTokenSql(table.policyVersion)}
        and ${catalogIdSql(table.reasonId)}
        and ${catalogIdSql(table.loadedByTrustedServiceId)}`
    ),
    check(
      "inbox_v2_work_queue_eligibility_allow_check",
      sql`${table.effect} <> 'allow' or (
        ${table.workQueueLifecycle} = 'active'
        and ${table.employeeFenceState} = 'active'
      )`
    ),
    check(
      "inbox_v2_work_queue_eligibility_times_check",
      sql`isfinite(${table.employeeFenceEffectiveFrom})
        and isfinite(${table.employeeFenceLoadedAt})
        and isfinite(${table.decidedAt})
        and isfinite(${table.notAfter})
        and isfinite(${table.createdAt})
        and ${table.employeeFenceLoadedAt} >=
          ${table.employeeFenceEffectiveFrom}
        and ${table.decidedAt} >= ${table.employeeFenceLoadedAt}
        and ${table.notAfter} >= ${table.decidedAt}
        and ${table.createdAt} = ${table.decidedAt}`
    ),
    index("inbox_v2_work_queue_eligibility_work_item_idx").on(
      table.tenantId,
      table.workItemId,
      table.decidedAt.desc(),
      table.id
    ),
    index("inbox_v2_work_queue_eligibility_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.notAfter,
      table.id
    )
  ]
);

/** Durable create-work-item branch of the intake decision used by the commit. */
export const inboxV2WorkItemCreationDecisions = pgTable(
  "inbox_v2_work_item_creation_decisions",
  {
    tenantId: text("tenant_id").notNull(),
    workItemId: text("work_item_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    transport: inboxV2ConversationTransport("transport").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    policyRevision: bigint("policy_revision", { mode: "bigint" }).notNull(),
    decisionRevision: bigint("decision_revision", {
      mode: "bigint"
    }).notNull(),
    decidedByTrustedServiceId: text("decided_by_trusted_service_id").notNull(),
    decidedAt: timestamp("decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    workQueueId: text("work_queue_id").notNull(),
    workQueueRevision: bigint("work_queue_revision", {
      mode: "bigint"
    }).notNull(),
    latestTerminalHandling: inboxV2WorkItemLatestTerminalHandling(
      "latest_terminal_handling"
    ).notNull(),
    reasonId: text("reason_id").notNull(),
    slotBeforeRevision: bigint("slot_before_revision", {
      mode: "bigint"
    }).notNull(),
    slotAfterRevision: bigint("slot_after_revision", {
      mode: "bigint"
    }).notNull(),
    canonicalCommit: jsonb("canonical_commit")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_creation_decisions_pk",
      columns: [table.tenantId, table.workItemId]
    }),
    unique("inbox_v2_work_item_creation_slot_unique").on(
      table.tenantId,
      table.conversationId,
      table.slotAfterRevision
    ),
    foreignKey({
      name: "inbox_v2_work_item_creation_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_creation_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_creation_queue_fk",
      columns: [table.tenantId, table.workQueueId, table.workQueueRevision],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    check(
      "inbox_v2_work_item_creation_values_check",
      sql`${table.policyRevision} >= 1
        and ${table.decisionRevision} >= 1
        and ${table.workQueueRevision} >= 1
        and ${table.slotBeforeRevision} >= 1
        and ${table.slotAfterRevision} = ${table.slotBeforeRevision} + 1
        and ${catalogIdSql(table.policyId)}
        and ${versionTokenSql(table.policyVersion)}
        and ${catalogIdSql(table.decidedByTrustedServiceId)}
        and ${catalogIdSql(table.reasonId)}
        and jsonb_typeof(${table.canonicalCommit}) = 'object'`
    ),
    check(
      "inbox_v2_work_item_creation_timestamps_check",
      sql`isfinite(${table.decidedAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.decidedAt}`
    ),
    index("inbox_v2_work_item_creation_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.decidedAt.desc(),
      table.workItemId
    )
  ]
);

/** One temporal, half-open primary-responsibility episode. */
export const inboxV2WorkItemPrimaryAssignments = pgTable(
  "inbox_v2_work_item_primary_assignments",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workItemId: text("work_item_id").notNull(),
    queueAtStartId: text("queue_at_start_id").notNull(),
    queueAtStartRevision: bigint("queue_at_start_revision", {
      mode: "bigint"
    }).notNull(),
    employeeId: text("employee_id").notNull(),
    source: inboxV2WorkAssignmentSource("source").notNull(),
    eligibilityDecisionId: text("eligibility_decision_id").notNull(),
    employeeFenceGenerationAtStart: bigint(
      "employee_fence_generation_at_start",
      { mode: "bigint" }
    ).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedActorKind: inboxV2WorkActorKind("started_actor_kind").notNull(),
    startedActorEmployeeId: text("started_actor_employee_id"),
    startedActorAuthorizationEpoch: text("started_actor_authorization_epoch"),
    startedActorTrustedServiceId: text("started_actor_trusted_service_id"),
    startReasonId: text("start_reason_id").notNull(),
    state: inboxV2WorkAssignmentState("state").notNull(),
    endedAt: timestamp("ended_at", {
      withTimezone: true,
      precision: 3
    }),
    endRecordedAt: timestamp("end_recorded_at", {
      withTimezone: true,
      precision: 3
    }),
    endBasis: inboxV2WorkAssignmentEndBasis("end_basis"),
    endedActorKind: inboxV2WorkActorKind("ended_actor_kind"),
    endedActorEmployeeId: text("ended_actor_employee_id"),
    endedActorAuthorizationEpoch: text("ended_actor_authorization_epoch"),
    endedActorTrustedServiceId: text("ended_actor_trusted_service_id"),
    endReasonId: text("end_reason_id"),
    terminationTransitionId: text("termination_transition_id"),
    endEmployeeFenceRevision: bigint("end_employee_fence_revision", {
      mode: "bigint"
    }),
    endEmployeeFenceGeneration: bigint("end_employee_fence_generation", {
      mode: "bigint"
    }),
    endEmployeeFenceState: inboxV2EmployeeAssignmentFenceState(
      "end_employee_fence_state"
    ),
    endEmployeeFenceEffectiveFrom: timestamp(
      "end_employee_fence_effective_from",
      { withTimezone: true, precision: 3 }
    ),
    endEmployeeFenceLoadedAt: timestamp("end_employee_fence_loaded_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_primary_assignments_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_queue_fk",
      columns: [
        table.tenantId,
        table.queueAtStartId,
        table.queueAtStartRevision
      ],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_decision_fk",
      columns: [table.tenantId, table.eligibilityDecisionId],
      foreignColumns: [
        inboxV2WorkQueueEligibilityDecisions.tenantId,
        inboxV2WorkQueueEligibilityDecisions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_start_actor_fk",
      columns: [table.tenantId, table.startedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_end_actor_fk",
      columns: [table.tenantId, table.endedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_primary_assignment_end_fence_fk",
      columns: [
        table.tenantId,
        table.employeeId,
        table.endEmployeeFenceRevision
      ],
      foreignColumns: [
        inboxV2EmployeeAssignmentFenceVersions.tenantId,
        inboxV2EmployeeAssignmentFenceVersions.employeeId,
        inboxV2EmployeeAssignmentFenceVersions.revision
      ]
    }),
    check(
      "inbox_v2_work_item_primary_assignment_values_check",
      sql`${table.queueAtStartRevision} >= 1
        and ${table.employeeFenceGenerationAtStart} >= 1
        and ${table.revision} in (1, 2)
        and ${catalogIdSql(table.startReasonId)}`
    ),
    check(
      "inbox_v2_work_item_primary_assignment_start_actor_check",
      workActorSql(
        table.startedActorKind,
        table.startedActorEmployeeId,
        table.startedActorAuthorizationEpoch,
        table.startedActorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_work_item_primary_assignment_end_shape_check",
      sql`(
          ${table.state} = 'active'
          and ${table.revision} = 1
          and ${table.endedAt} is null
          and ${table.endRecordedAt} is null
          and ${table.endBasis} is null
          and ${table.endedActorKind} is null
          and ${table.endedActorEmployeeId} is null
          and ${table.endedActorAuthorizationEpoch} is null
          and ${table.endedActorTrustedServiceId} is null
          and ${table.endReasonId} is null
          and ${table.terminationTransitionId} is null
          and ${table.endEmployeeFenceRevision} is null
          and ${table.endEmployeeFenceGeneration} is null
          and ${table.endEmployeeFenceState} is null
          and ${table.endEmployeeFenceEffectiveFrom} is null
          and ${table.endEmployeeFenceLoadedAt} is null
        ) or (
          ${table.state} = 'ended'
          and ${table.revision} = 2
          and ${table.endedAt} is not null
          and ${table.endRecordedAt} is not null
          and ${table.endBasis} is not null
          and ${table.endedActorKind} is not null
          and ${table.endReasonId} is not null
          and ${table.terminationTransitionId} is not null
          and ${workActorSql(
            table.endedActorKind,
            table.endedActorEmployeeId,
            table.endedActorAuthorizationEpoch,
            table.endedActorTrustedServiceId
          )}
          and ${catalogIdSql(table.endReasonId)}
        )`
    ),
    check(
      "inbox_v2_work_item_primary_assignment_end_fence_check",
      sql`(${table.state} = 'active') or (
        (
          ${table.endBasis} = 'command_time'
          and ${table.endEmployeeFenceRevision} is null
          and ${table.endEmployeeFenceGeneration} is null
          and ${table.endEmployeeFenceState} is null
          and ${table.endEmployeeFenceEffectiveFrom} is null
          and ${table.endEmployeeFenceLoadedAt} is null
          and ${table.endedAt} = ${table.endRecordedAt}
        ) or (
          ${table.endBasis} = 'employee_fence_time'
          and ${table.endEmployeeFenceRevision} >= 1
          and ${table.endEmployeeFenceGeneration} >= 1
          and ${table.endEmployeeFenceState} in ('draining', 'inactive')
          and ${table.endEmployeeFenceEffectiveFrom} is not null
          and ${table.endEmployeeFenceLoadedAt} is not null
          and ${table.endedAt} = ${table.endEmployeeFenceEffectiveFrom}
          and ${table.endEmployeeFenceLoadedAt} <= ${table.endRecordedAt}
        )
      )`
    ),
    check(
      "inbox_v2_work_item_primary_assignment_timestamps_check",
      sql`isfinite(${table.startedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} = ${table.startedAt}
        and ((${table.endedAt} is null
          and ${table.updatedAt} = ${table.startedAt}) or (
          ${table.endedAt} is not null
          and isfinite(${table.endedAt})
          and isfinite(${table.endRecordedAt})
          and ${table.endedAt} >= ${table.startedAt}
          and ${table.endRecordedAt} >= ${table.endedAt}
          and ${table.updatedAt} = ${table.endRecordedAt}
        ))`
    ),
    uniqueIndex("inbox_v2_work_item_primary_assignment_active_unique")
      .on(table.tenantId, table.workItemId)
      .where(sql`${table.state} = 'active'`),
    index("inbox_v2_work_item_primary_assignment_history_idx").on(
      table.tenantId,
      table.workItemId,
      table.startedAt,
      table.id
    ),
    index("inbox_v2_work_item_primary_assignment_employee_idx").on(
      table.tenantId,
      table.employeeId,
      table.state,
      table.startedAt.desc(),
      table.id
    )
  ]
);

/** Immutable WorkItem lifecycle/CAS transition. */
export const inboxV2WorkItemTransitions = pgTable(
  "inbox_v2_work_item_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workItemId: text("work_item_id").notNull(),
    kind: inboxV2WorkItemTransitionKind("kind").notNull(),
    fromState: inboxV2WorkItemState("from_state").notNull(),
    toState: inboxV2WorkItemState("to_state").notNull(),
    sourceQueueId: text("source_queue_id").notNull(),
    sourceQueueRevision: bigint("source_queue_revision", {
      mode: "bigint"
    }).notNull(),
    destinationQueueId: text("destination_queue_id").notNull(),
    destinationQueueRevision: bigint("destination_queue_revision", {
      mode: "bigint"
    }).notNull(),
    actorKind: inboxV2WorkActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorAuthorizationEpoch: text("actor_authorization_epoch"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    expectedRevision: bigint("expected_revision", {
      mode: "bigint"
    }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    closedPrimaryAssignmentId: text("closed_primary_assignment_id"),
    openedPrimaryAssignmentId: text("opened_primary_assignment_id"),
    expectedServicingTeamRelationRevision: bigint(
      "expected_servicing_team_relation_revision",
      { mode: "bigint" }
    ).notNull(),
    resultingServicingTeamRelationRevision: bigint(
      "resulting_servicing_team_relation_revision",
      { mode: "bigint" }
    ).notNull(),
    closedServicingTeamEpisodeId: text("closed_servicing_team_episode_id"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalCommit: jsonb("canonical_commit")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_work_item_transitions_expected_unique").on(
      table.tenantId,
      table.workItemId,
      table.expectedRevision
    ),
    unique("inbox_v2_work_item_transitions_resulting_unique").on(
      table.tenantId,
      table.workItemId,
      table.resultingRevision
    ),
    unique("inbox_v2_work_item_transitions_closed_assignment_unique").on(
      table.tenantId,
      table.closedPrimaryAssignmentId
    ),
    unique("inbox_v2_work_item_transitions_opened_assignment_unique").on(
      table.tenantId,
      table.openedPrimaryAssignmentId
    ),
    foreignKey({
      name: "inbox_v2_work_item_transitions_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_transitions_source_queue_fk",
      columns: [table.tenantId, table.sourceQueueId, table.sourceQueueRevision],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_transitions_destination_queue_fk",
      columns: [
        table.tenantId,
        table.destinationQueueId,
        table.destinationQueueRevision
      ],
      foreignColumns: [
        inboxV2WorkQueueVersions.tenantId,
        inboxV2WorkQueueVersions.workQueueId,
        inboxV2WorkQueueVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_transitions_actor_employee_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_work_item_transitions_values_check",
      sql`${table.expectedRevision} >= 1
        and ${table.resultingRevision} = ${table.expectedRevision} + 1
        and ${table.expectedServicingTeamRelationRevision} >= 1
        and ${table.sourceQueueRevision} >= 1
        and ${table.destinationQueueRevision} >= 1
        and ${catalogIdSql(table.reasonId)}
        and jsonb_typeof(${table.canonicalCommit}) = 'object'`
    ),
    check(
      "inbox_v2_work_item_transitions_team_relation_check",
      sql`(
          ${table.closedServicingTeamEpisodeId} is null
          and ${table.resultingServicingTeamRelationRevision} =
            ${table.expectedServicingTeamRelationRevision}
        ) or (
          ${table.closedServicingTeamEpisodeId} is not null
          and ${table.kind} in ('close_resolved', 'close_dismissed')
          and ${table.resultingServicingTeamRelationRevision} =
            ${table.expectedServicingTeamRelationRevision} + 1
        )`
    ),
    check(
      "inbox_v2_work_item_transitions_assignment_effect_check",
      sql`(
          ${table.kind} in ('claim', 'assign', 'reopen_assigned')
          and ${table.closedPrimaryAssignmentId} is null
          and ${table.openedPrimaryAssignmentId} is not null
        ) or (
          ${table.kind} in ('transfer', 'recovery_transfer')
          and ${table.closedPrimaryAssignmentId} is not null
          and ${table.openedPrimaryAssignmentId} is not null
          and ${table.closedPrimaryAssignmentId} <>
            ${table.openedPrimaryAssignmentId}
        ) or (
          ${table.kind} in ('release', 'recovery_requeue')
          and ${table.closedPrimaryAssignmentId} is not null
          and ${table.openedPrimaryAssignmentId} is null
        ) or (
          ${table.kind} in ('close_resolved', 'close_dismissed')
          and ${table.openedPrimaryAssignmentId} is null
          and (
            (${table.fromState} = 'new'
              and ${table.closedPrimaryAssignmentId} is null)
            or (${table.fromState} in ('assigned', 'in_progress', 'waiting')
              and ${table.closedPrimaryAssignmentId} is not null)
          )
        ) or (
          ${table.kind} in (
            'start',
            'wait',
            'resume',
            'queue_transfer',
            'reopen_unassigned',
            'priority_change',
            'sla_refresh'
          )
          and ${table.closedPrimaryAssignmentId} is null
          and ${table.openedPrimaryAssignmentId} is null
        )`
    ),
    check(
      "inbox_v2_work_item_transitions_queue_effect_check",
      sql`(
          ${table.kind} in (
            'release',
            'transfer',
            'queue_transfer',
            'reopen_unassigned',
            'reopen_assigned',
            'recovery_requeue',
            'recovery_transfer'
          )
        ) or (
          ${table.sourceQueueId} = ${table.destinationQueueId}
          and ${table.sourceQueueRevision} =
            ${table.destinationQueueRevision}
        )`
    ),
    check(
      "inbox_v2_work_item_transitions_queue_transfer_change_check",
      sql`${table.kind} <> 'queue_transfer' or (
        ${table.sourceQueueId} <> ${table.destinationQueueId}
        or ${table.sourceQueueRevision} <>
          ${table.destinationQueueRevision}
      )`
    ),
    check(
      "inbox_v2_work_item_transitions_actor_check",
      workActorSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorAuthorizationEpoch,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_work_item_transitions_edge_check",
      workItemTransitionEdgeSql(table.kind, table.fromState, table.toState)
    ),
    check(
      "inbox_v2_work_item_transitions_timestamps_check",
      sql`isfinite(${table.occurredAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_work_item_transitions_history_idx").on(
      table.tenantId,
      table.workItemId,
      table.resultingRevision.desc(),
      table.id
    )
  ]
);

/** Temporal WorkItem-to-Team servicing relation. */
export const inboxV2WorkItemServicingTeamEpisodes = pgTable(
  "inbox_v2_work_item_servicing_team_episodes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workItemId: text("work_item_id").notNull(),
    workItemCycle: bigint("work_item_cycle", { mode: "bigint" }).notNull(),
    teamId: text("team_id").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedActorKind: inboxV2WorkActorKind("started_actor_kind").notNull(),
    startedActorEmployeeId: text("started_actor_employee_id"),
    startedActorAuthorizationEpoch: text("started_actor_authorization_epoch"),
    startedActorTrustedServiceId: text("started_actor_trusted_service_id"),
    startReasonId: text("start_reason_id").notNull(),
    state: inboxV2WorkRelationState("state").notNull(),
    endedAt: timestamp("ended_at", {
      withTimezone: true,
      precision: 3
    }),
    endRecordedAt: timestamp("end_recorded_at", {
      withTimezone: true,
      precision: 3
    }),
    endCause: inboxV2WorkRelationEndCause("end_cause"),
    endRelationTransitionId: text("end_relation_transition_id"),
    endWorkItemTransitionId: text("end_work_item_transition_id"),
    endedActorKind: inboxV2WorkActorKind("ended_actor_kind"),
    endedActorEmployeeId: text("ended_actor_employee_id"),
    endedActorAuthorizationEpoch: text("ended_actor_authorization_epoch"),
    endedActorTrustedServiceId: text("ended_actor_trusted_service_id"),
    endReasonId: text("end_reason_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_servicing_team_episodes_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_servicing_team_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_servicing_team_team_fk",
      columns: [table.tenantId, table.teamId],
      foreignColumns: [teams.tenantId, teams.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_servicing_team_start_actor_fk",
      columns: [table.tenantId, table.startedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_servicing_team_end_actor_fk",
      columns: [table.tenantId, table.endedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_servicing_team_end_transition_fk",
      columns: [table.tenantId, table.endWorkItemTransitionId],
      foreignColumns: [
        inboxV2WorkItemTransitions.tenantId,
        inboxV2WorkItemTransitions.id
      ]
    }),
    check(
      "inbox_v2_work_item_servicing_team_values_check",
      sql`${table.workItemCycle} >= 0
        and ${table.revision} in (1, 2)
        and ${catalogIdSql(table.startReasonId)}`
    ),
    check(
      "inbox_v2_work_item_servicing_team_start_actor_check",
      workActorSql(
        table.startedActorKind,
        table.startedActorEmployeeId,
        table.startedActorAuthorizationEpoch,
        table.startedActorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_work_item_servicing_team_end_shape_check",
      sql`(
          ${table.state} = 'active'
          and ${table.revision} = 1
          and ${table.endedAt} is null
          and ${table.endRecordedAt} is null
          and ${table.endCause} is null
          and ${table.endRelationTransitionId} is null
          and ${table.endWorkItemTransitionId} is null
          and ${table.endedActorKind} is null
          and ${table.endedActorEmployeeId} is null
          and ${table.endedActorAuthorizationEpoch} is null
          and ${table.endedActorTrustedServiceId} is null
          and ${table.endReasonId} is null
        ) or (
          ${table.state} = 'ended'
          and ${table.revision} = 2
          and ${table.endedAt} is not null
          and ${table.endRecordedAt} is not null
          and ${table.endCause} is not null
          and ${table.endedActorKind} is not null
          and ${table.endReasonId} is not null
          and ${workActorSql(
            table.endedActorKind,
            table.endedActorEmployeeId,
            table.endedActorAuthorizationEpoch,
            table.endedActorTrustedServiceId
          )}
          and ${catalogIdSql(table.endReasonId)}
          and (
            (${table.endCause} = 'relation_command'
              and ${table.endRelationTransitionId} is not null
              and ${table.endWorkItemTransitionId} is null)
            or (${table.endCause} = 'work_item_terminal'
              and ${table.endRelationTransitionId} is null
              and ${table.endWorkItemTransitionId} is not null)
          )
        )`
    ),
    check(
      "inbox_v2_work_item_servicing_team_timestamps_check",
      sql`isfinite(${table.startedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} = ${table.startedAt}
        and ((${table.endedAt} is null
          and ${table.updatedAt} = ${table.startedAt}) or (
          ${table.endedAt} is not null
          and isfinite(${table.endedAt})
          and isfinite(${table.endRecordedAt})
          and ${table.endedAt} >= ${table.startedAt}
          and ${table.endRecordedAt} = ${table.endedAt}
          and ${table.updatedAt} = ${table.endRecordedAt}
        ))`
    ),
    uniqueIndex("inbox_v2_work_item_servicing_team_active_unique")
      .on(table.tenantId, table.workItemId)
      .where(sql`${table.state} = 'active'`),
    index("inbox_v2_work_item_servicing_team_history_idx").on(
      table.tenantId,
      table.workItemId,
      table.workItemCycle,
      table.startedAt,
      table.id
    ),
    index("inbox_v2_work_item_servicing_team_team_idx").on(
      table.tenantId,
      table.teamId,
      table.state,
      table.startedAt.desc(),
      table.id
    )
  ]
);

/** Immutable CAS transition for the servicing-team relation head. */
export const inboxV2WorkItemRelationTransitions = pgTable(
  "inbox_v2_work_item_relation_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workItemId: text("work_item_id").notNull(),
    kind: inboxV2WorkRelationTransitionKind("kind").notNull(),
    actorKind: inboxV2WorkActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorAuthorizationEpoch: text("actor_authorization_epoch"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    expectedWorkItemRevision: bigint("expected_work_item_revision", {
      mode: "bigint"
    }).notNull(),
    resultingWorkItemRevision: bigint("resulting_work_item_revision", {
      mode: "bigint"
    }).notNull(),
    expectedRelationRevision: bigint("expected_relation_revision", {
      mode: "bigint"
    }).notNull(),
    resultingRelationRevision: bigint("resulting_relation_revision", {
      mode: "bigint"
    }).notNull(),
    previousEpisodeId: text("previous_episode_id"),
    nextEpisodeId: text("next_episode_id"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalCommit: jsonb("canonical_commit")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_work_item_relation_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_work_item_relation_transition_expected_unique").on(
      table.tenantId,
      table.workItemId,
      table.expectedRelationRevision
    ),
    unique("inbox_v2_work_item_relation_transition_result_unique").on(
      table.tenantId,
      table.workItemId,
      table.resultingRelationRevision
    ),
    unique("inbox_v2_work_item_relation_transition_previous_unique").on(
      table.tenantId,
      table.previousEpisodeId
    ),
    unique("inbox_v2_work_item_relation_transition_next_unique").on(
      table.tenantId,
      table.nextEpisodeId
    ),
    foreignKey({
      name: "inbox_v2_work_item_relation_transition_work_item_fk",
      columns: [table.tenantId, table.workItemId],
      foreignColumns: [inboxV2WorkItems.tenantId, inboxV2WorkItems.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_work_item_relation_transition_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_work_item_relation_transition_previous_fk",
      columns: [table.tenantId, table.previousEpisodeId],
      foreignColumns: [
        inboxV2WorkItemServicingTeamEpisodes.tenantId,
        inboxV2WorkItemServicingTeamEpisodes.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_work_item_relation_transition_next_fk",
      columns: [table.tenantId, table.nextEpisodeId],
      foreignColumns: [
        inboxV2WorkItemServicingTeamEpisodes.tenantId,
        inboxV2WorkItemServicingTeamEpisodes.id
      ]
    }),
    check(
      "inbox_v2_work_item_relation_transition_values_check",
      sql`${table.expectedWorkItemRevision} >= 1
        and ${table.resultingWorkItemRevision} =
          ${table.expectedWorkItemRevision} + 1
        and ${table.expectedRelationRevision} >= 1
        and ${table.resultingRelationRevision} =
          ${table.expectedRelationRevision} + 1
        and ${catalogIdSql(table.reasonId)}
        and jsonb_typeof(${table.canonicalCommit}) = 'object'`
    ),
    check(
      "inbox_v2_work_item_relation_transition_actor_check",
      workActorSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorAuthorizationEpoch,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_work_item_relation_transition_episode_check",
      sql`(
          ${table.kind} = 'servicing_team_add'
          and ${table.previousEpisodeId} is null
          and ${table.nextEpisodeId} is not null
        ) or (
          ${table.kind} = 'servicing_team_remove'
          and ${table.previousEpisodeId} is not null
          and ${table.nextEpisodeId} is null
        ) or (
          ${table.kind} = 'servicing_team_change'
          and ${table.previousEpisodeId} is not null
          and ${table.nextEpisodeId} is not null
          and ${table.previousEpisodeId} <> ${table.nextEpisodeId}
        )`
    ),
    check(
      "inbox_v2_work_item_relation_transition_timestamps_check",
      sql`isfinite(${table.occurredAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.occurredAt}`
    ),
    index("inbox_v2_work_item_relation_transition_history_idx").on(
      table.tenantId,
      table.workItemId,
      table.resultingRelationRevision.desc(),
      table.id
    )
  ]
);

function catalogIdSql(column: SQLWrapper) {
  return sql`char_length(${column}) <= 256 and (
    (
      ${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 160
    ) or (
      ${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 80
      and char_length(split_part(${column}, ':', 3)) <= 160
      and split_part(${column}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

function versionTokenSql(column: SQLWrapper) {
  return sql`${column} ~ '^v[1-9][0-9]*$'`;
}

function workActorSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  authorizationEpoch: SQLWrapper,
  trustedServiceId: SQLWrapper
) {
  return sql`((
      ${kind} = 'employee'
      and ${employeeId} is not null
      and ${authorizationEpoch} is not null
      and char_length(${authorizationEpoch}) between 8 and 1024
      and ${authorizationEpoch} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
      and ${trustedServiceId} is null
    ) or (
      ${kind} = 'trusted_service'
      and ${employeeId} is null
      and ${authorizationEpoch} is null
      and ${trustedServiceId} is not null
      and ${catalogIdSql(trustedServiceId)}
    ))`;
}

function workItemTransitionEdgeSql(
  kind: SQLWrapper,
  fromState: SQLWrapper,
  toState: SQLWrapper
) {
  return sql`(
      ${kind} in ('claim', 'assign')
      and ${fromState} = 'new'
      and ${toState} = 'assigned'
    ) or (
      ${kind} = 'start'
      and ${fromState} = 'assigned'
      and ${toState} = 'in_progress'
    ) or (
      ${kind} = 'wait'
      and ${fromState} in ('assigned', 'in_progress')
      and ${toState} = 'waiting'
    ) or (
      ${kind} = 'resume'
      and ${fromState} = 'waiting'
      and ${toState} = 'in_progress'
    ) or (
      ${kind} in ('release', 'recovery_requeue')
      and ${fromState} in ('assigned', 'in_progress', 'waiting')
      and ${toState} = 'new'
    ) or (
      ${kind} in ('transfer', 'recovery_transfer')
      and ${fromState} in ('assigned', 'in_progress', 'waiting')
      and ${toState} = ${fromState}
    ) or (
      ${kind} = 'queue_transfer'
      and ${fromState} = 'new'
      and ${toState} = 'new'
    ) or (
      ${kind} = 'close_resolved'
      and ${fromState} in ('new', 'assigned', 'in_progress', 'waiting')
      and ${toState} = 'resolved'
    ) or (
      ${kind} = 'close_dismissed'
      and ${fromState} in ('new', 'assigned', 'in_progress', 'waiting')
      and ${toState} = 'dismissed'
    ) or (
      ${kind} = 'reopen_unassigned'
      and ${fromState} in ('resolved', 'dismissed')
      and ${toState} = 'new'
    ) or (
      ${kind} = 'reopen_assigned'
      and ${fromState} in ('resolved', 'dismissed')
      and ${toState} = 'assigned'
    ) or (
      ${kind} in ('priority_change', 'sla_refresh')
      and ${fromState} = ${toState}
      and ${fromState} in ('new', 'assigned', 'in_progress', 'waiting')
    )`;
}

/**
 * Cross-row invariants that cannot be expressed by Drizzle constraints alone.
 * Every function fixes search_path because these guards execute with the
 * migration owner's privileges. Deferred checks make aggregate + history +
 * slot updates order-independent inside one transaction.
 */
export const INBOX_V2_WORK_ITEM_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_work_item_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if tg_table_name = 'inbox_v2_work_queue_versions'
       and not exists (
         select 1 from public.work_queues q
          where q.tenant_id = to_jsonb(old)->>'tenant_id'
            and q.id = to_jsonb(old)->>'work_queue_id'
       ) then
      return old;
    elsif tg_table_name = 'inbox_v2_employee_assignment_fence_versions'
       and not exists (
         select 1 from public.employees e
          where e.tenant_id = to_jsonb(old)->>'tenant_id'
            and e.id = to_jsonb(old)->>'employee_id'
       ) then
      return old;
    elsif tg_table_name in (
      'inbox_v2_work_item_sla_snapshots',
      'inbox_v2_work_queue_eligibility_decisions',
      'inbox_v2_work_item_transitions',
      'inbox_v2_work_item_relation_transitions'
    ) and not exists (
      select 1 from public.inbox_v2_work_items w
       where w.tenant_id = to_jsonb(old)->>'tenant_id'
         and w.id = to_jsonb(old)->>'work_item_id'
    ) then
      return old;
    elsif tg_table_name = 'inbox_v2_work_item_creation_decisions'
       and (
         not exists (
           select 1 from public.inbox_v2_work_items w
            where w.tenant_id = to_jsonb(old)->>'tenant_id'
              and w.id = to_jsonb(old)->>'work_item_id'
         )
         or not exists (
           select 1 from public.inbox_v2_conversations c
            where c.tenant_id = to_jsonb(old)->>'tenant_id'
              and c.id = to_jsonb(old)->>'conversation_id'
         )
       ) then
      return old;
    end if;
  end if;
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end
$function$;

create trigger inbox_v2_work_queue_versions_immutable_trigger
before update or delete on public.inbox_v2_work_queue_versions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_employee_assignment_fence_versions_immutable_trigger
before update or delete on public.inbox_v2_employee_assignment_fence_versions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_work_item_sla_snapshots_immutable_trigger
before update or delete on public.inbox_v2_work_item_sla_snapshots
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_work_queue_eligibility_decisions_immutable_trigger
before update or delete on public.inbox_v2_work_queue_eligibility_decisions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_work_item_creation_decisions_immutable_trigger
before update or delete on public.inbox_v2_work_item_creation_decisions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_work_item_transitions_immutable_trigger
before update or delete on public.inbox_v2_work_item_transitions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create trigger inbox_v2_work_item_relation_transitions_immutable_trigger
before update or delete on public.inbox_v2_work_item_relation_transitions
for each row execute function public.inbox_v2_work_item_reject_immutable();

create or replace function public.inbox_v2_work_queue_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.work_queues q
       where q.tenant_id = old.tenant_id and q.id = old.work_queue_id
    ) then
      return old;
    end if;
    raise exception 'WorkQueue head cannot be deleted' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.current_revision <> 1 then
      raise exception 'WorkQueue head must start at revision 1'
        using errcode = '23514';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.work_queue_id is distinct from old.work_queue_id
     or new.created_at is distinct from old.created_at
     or new.current_revision <> old.current_revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'WorkQueue head requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_queue_heads_guard_trigger
before insert or update or delete on public.inbox_v2_work_queue_heads
for each row execute function public.inbox_v2_work_queue_head_guard();

create or replace function public.inbox_v2_work_queue_head_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_queue_id text;
  v_head_revision bigint;
  v_max_revision bigint;
begin
  v_tenant_id := new.tenant_id;
  v_work_queue_id := new.work_queue_id;

  select h.current_revision
    into v_head_revision
    from public.inbox_v2_work_queue_heads h
   where h.tenant_id = v_tenant_id
     and h.work_queue_id = v_work_queue_id;

  select max(v.revision)
    into v_max_revision
    from public.inbox_v2_work_queue_versions v
   where v.tenant_id = v_tenant_id
     and v.work_queue_id = v_work_queue_id;

  if v_head_revision is null
     or v_max_revision is null
     or v_head_revision <> v_max_revision then
    raise exception 'WorkQueue head must point to the latest immutable version'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_work_queue_versions_head_constraint
after insert on public.inbox_v2_work_queue_versions
deferrable initially deferred
for each row execute function public.inbox_v2_work_queue_head_coherence();

create constraint trigger inbox_v2_work_queue_heads_coherence_constraint
after insert or update on public.inbox_v2_work_queue_heads
deferrable initially deferred
for each row execute function public.inbox_v2_work_queue_head_coherence();

create or replace function public.inbox_v2_employee_fence_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.employees e
       where e.tenant_id = old.tenant_id and e.id = old.employee_id
    ) then
      return old;
    end if;
    raise exception 'Employee assignment fence head cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.current_revision <> 1 or new.current_generation <> 1 then
      raise exception 'Employee assignment fence must start at revision/generation 1'
        using errcode = '23514';
    end if;
  elsif not (
       (old.state = 'active' and new.state in ('active', 'draining'))
       or (old.state = 'draining' and new.state in ('draining', 'inactive', 'active'))
       or (old.state = 'inactive' and new.state in ('inactive', 'active'))
     ) then
    raise exception 'Illegal Employee assignment fence state edge: % -> %',
      old.state, new.state using errcode = '23514';
  elsif new.tenant_id is distinct from old.tenant_id
     or new.employee_id is distinct from old.employee_id
     or new.created_at is distinct from old.created_at
     or new.current_revision <> old.current_revision + 1
     or new.current_generation <> old.current_generation + 1
     or new.updated_at < old.updated_at then
    raise exception 'Employee assignment fence requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_employee_assignment_fence_heads_guard_trigger
before insert or update or delete on public.inbox_v2_employee_assignment_fence_heads
for each row execute function public.inbox_v2_employee_fence_head_guard();

create or replace function public.inbox_v2_employee_fence_head_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_employee_id text;
  v_head public.inbox_v2_employee_assignment_fence_heads%rowtype;
  v_version public.inbox_v2_employee_assignment_fence_versions%rowtype;
  v_max_revision bigint;
begin
  v_tenant_id := new.tenant_id;
  v_employee_id := new.employee_id;

  select * into v_head
    from public.inbox_v2_employee_assignment_fence_heads h
   where h.tenant_id = v_tenant_id and h.employee_id = v_employee_id;
  select max(v.revision) into v_max_revision
    from public.inbox_v2_employee_assignment_fence_versions v
   where v.tenant_id = v_tenant_id and v.employee_id = v_employee_id;
  select * into v_version
    from public.inbox_v2_employee_assignment_fence_versions v
   where v.tenant_id = v_tenant_id
     and v.employee_id = v_employee_id
     and v.revision = v_head.current_revision;

  if v_head.current_revision is null
     or v_version.revision is null
     or v_max_revision <> v_head.current_revision
     or v_head.current_generation <> v_version.generation
     or v_head.state <> v_version.state
     or v_head.effective_from <> v_version.effective_from then
    raise exception 'Employee assignment fence head/version mismatch'
      using errcode = '23514';
  end if;

  if v_head.state = 'inactive' and exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_head.tenant_id
       and a.employee_id = v_head.employee_id
       and a.state = 'active'
  ) then
    raise exception 'Employee fence cannot become inactive with active assignments'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_employee_fence_versions_head_constraint
after insert on public.inbox_v2_employee_assignment_fence_versions
deferrable initially deferred
for each row execute function public.inbox_v2_employee_fence_head_coherence();

create constraint trigger inbox_v2_employee_fence_heads_coherence_constraint
after insert or update on public.inbox_v2_employee_assignment_fence_heads
deferrable initially deferred
for each row execute function public.inbox_v2_employee_fence_head_coherence();

create or replace function public.inbox_v2_work_item_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_queue_revision bigint;
  v_queue_lifecycle public.inbox_v2_work_queue_lifecycle;
  v_queue_default_priority_id text;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.inbox_v2_conversations c
       where c.tenant_id = old.tenant_id and c.id = old.conversation_id
    ) then
      return old;
    end if;
    raise exception 'WorkItem cannot be deleted' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception 'WorkItem must start at revision 1 with one timestamp'
        using errcode = '23514';
    end if;

    select h.current_revision, v.lifecycle, v.default_priority_id
      into v_queue_revision, v_queue_lifecycle, v_queue_default_priority_id
      from public.inbox_v2_work_queue_heads h
      join public.inbox_v2_work_queue_versions v
        on v.tenant_id = h.tenant_id
       and v.work_queue_id = h.work_queue_id
       and v.revision = h.current_revision
     where h.tenant_id = new.tenant_id
       and h.work_queue_id = new.queue_id
     for update of h;

    if v_queue_revision is null
       or v_queue_revision <> new.queue_revision
       or v_queue_lifecycle <> 'active' then
      raise exception 'WorkItem creation requires the current active WorkQueue version'
        using errcode = '23514';
    end if;
    if new.state <> 'new'
       or new.priority_id <> v_queue_default_priority_id
       or new.sla_cycle <> 1
       or new.sla_snapshot_revision <> 1
       or new.current_primary_assignment_id is not null
       or new.last_primary_assignment_id is not null
       or new.current_servicing_team_episode_id is not null
       or new.current_servicing_team_id is not null
       or new.last_servicing_team_episode_id is not null
       or new.servicing_team_relation_revision <> 1
       or new.collaborator_set_revision <> 1
       or new.resource_access_revision <> 1
       or new.reopen_cycle <> 0
       or new.last_reopen_snapshot is not null
       or new.terminal_snapshot is not null then
      raise exception 'WorkItem insert must be the exact revision-one Queue default head'
        using errcode = '23514';
    end if;
  else
    if new.tenant_id is distinct from old.tenant_id
       or new.id is distinct from old.id
       or new.conversation_id is distinct from old.conversation_id
       or new.ordinal is distinct from old.ordinal
       or new.created_at is distinct from old.created_at
       or new.created_actor_kind is distinct from old.created_actor_kind
       or new.created_actor_employee_id is distinct from old.created_actor_employee_id
       or new.created_actor_authorization_epoch is distinct from old.created_actor_authorization_epoch
       or new.created_actor_trusted_service_id is distinct from old.created_actor_trusted_service_id
       or new.creation_reason_id is distinct from old.creation_reason_id
       or new.revision <> old.revision + 1
       or new.updated_at < old.updated_at then
      raise exception 'WorkItem update requires immutable identity and +1 CAS'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_items_guard_trigger
before insert or update or delete on public.inbox_v2_work_items
for each row execute function public.inbox_v2_work_item_guard();

create or replace function public.inbox_v2_work_eligibility_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work public.inbox_v2_work_items%rowtype;
  v_queue_head_revision bigint;
  v_queue public.inbox_v2_work_queue_versions%rowtype;
  v_fence_head public.inbox_v2_employee_assignment_fence_heads%rowtype;
  v_fence public.inbox_v2_employee_assignment_fence_versions%rowtype;
begin
  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = new.tenant_id and w.id = new.work_item_id
   for update;
  if not found
     or v_work.revision <> new.expected_work_item_revision
     or v_work.queue_id <> new.work_queue_id
     or v_work.queue_revision <> new.work_queue_revision then
    raise exception 'Eligibility decision requires the exact locked WorkItem head'
      using errcode = '23514';
  end if;

  select h.current_revision into v_queue_head_revision
    from public.inbox_v2_work_queue_heads h
   where h.tenant_id = new.tenant_id
     and h.work_queue_id = new.work_queue_id
   for update;
  select * into v_queue
    from public.inbox_v2_work_queue_versions v
   where v.tenant_id = new.tenant_id
     and v.work_queue_id = new.work_queue_id
     and v.revision = new.work_queue_revision;
  if v_queue_head_revision is null
     or v_queue_head_revision <> new.work_queue_revision
     or v_queue.lifecycle <> new.work_queue_lifecycle
     or v_queue.eligibility_policy_id <> new.policy_id
     or v_queue.eligibility_policy_version <> new.policy_version
     or v_queue.eligibility_policy_revision <> new.policy_revision then
    raise exception 'Eligibility decision must snapshot the current WorkQueue policy'
      using errcode = '23514';
  end if;

  select * into v_fence_head
    from public.inbox_v2_employee_assignment_fence_heads h
   where h.tenant_id = new.tenant_id and h.employee_id = new.employee_id
   for update;
  select * into v_fence
    from public.inbox_v2_employee_assignment_fence_versions v
   where v.tenant_id = new.tenant_id
     and v.employee_id = new.employee_id
     and v.revision = new.employee_fence_revision;
  if v_fence_head.current_revision is null
     or v_fence_head.current_revision <> new.employee_fence_revision
     or v_fence_head.current_generation <> new.employee_fence_generation
     or v_fence_head.state <> new.employee_fence_state
     or v_fence_head.effective_from <> new.employee_fence_effective_from
     or v_fence.generation <> new.employee_fence_generation
     or v_fence.state <> new.employee_fence_state
     or v_fence.effective_from <> new.employee_fence_effective_from
     or (new.effect = 'allow' and (
       new.work_queue_lifecycle <> 'active'
       or new.employee_fence_state <> 'active'
     )) then
    raise exception 'Eligibility decision must snapshot the current Employee fence'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_queue_eligibility_guard_trigger
before insert on public.inbox_v2_work_queue_eligibility_decisions
for each row execute function public.inbox_v2_work_eligibility_guard();

create or replace function public.inbox_v2_work_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work public.inbox_v2_work_items%rowtype;
  v_slot public.inbox_v2_conversation_work_item_slots%rowtype;
  v_destination_revision bigint;
  v_destination_lifecycle public.inbox_v2_work_queue_lifecycle;
  v_needs_destination_snapshot boolean;
begin
  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = new.tenant_id and w.id = new.work_item_id
   for update;
  if not found or v_work.revision not in (
    new.expected_revision,
    new.resulting_revision
  ) then
    raise exception 'WorkItem transition lost its expected revision race'
      using errcode = '40001';
  end if;

  if v_work.revision = new.expected_revision and (
    v_work.state <> new.from_state
    or v_work.queue_id <> new.source_queue_id
    or v_work.queue_revision <> new.source_queue_revision
    or v_work.servicing_team_relation_revision <>
       new.expected_servicing_team_relation_revision
  ) then
    raise exception 'WorkItem transition source does not match the locked head'
      using errcode = '23514';
  elsif v_work.revision = new.resulting_revision and (
    v_work.state <> new.to_state
    or v_work.queue_id <> new.destination_queue_id
    or v_work.queue_revision <> new.destination_queue_revision
    or v_work.servicing_team_relation_revision <>
       new.resulting_servicing_team_relation_revision
  ) then
    raise exception 'WorkItem transition destination does not match the updated head'
      using errcode = '23514';
  end if;

  v_needs_destination_snapshot :=
    new.source_queue_id is distinct from new.destination_queue_id
    or new.source_queue_revision is distinct from new.destination_queue_revision
    or new.opened_primary_assignment_id is not null
    or new.kind in (
      'reopen_unassigned',
      'queue_transfer',
      'recovery_requeue'
    );
  if v_needs_destination_snapshot then
    select h.current_revision, v.lifecycle
      into v_destination_revision, v_destination_lifecycle
      from public.inbox_v2_work_queue_heads h
      join public.inbox_v2_work_queue_versions v
        on v.tenant_id = h.tenant_id
       and v.work_queue_id = h.work_queue_id
       and v.revision = h.current_revision
     where h.tenant_id = new.tenant_id
       and h.work_queue_id = new.destination_queue_id
     for update of h;
    if v_destination_revision is null
       or v_destination_revision <> new.destination_queue_revision
       or v_destination_lifecycle <> 'active' then
      raise exception 'Queue-changing/opening transition requires the current active destination Queue'
        using errcode = '23514';
    end if;
  end if;

  if new.kind in (
    'close_resolved',
    'close_dismissed',
    'reopen_unassigned',
    'reopen_assigned'
  ) then
    select * into v_slot
      from public.inbox_v2_conversation_work_item_slots s
     where s.tenant_id = v_work.tenant_id
       and s.conversation_id = v_work.conversation_id
     for update;
    if not found or v_slot.latest_work_item_id <> new.work_item_id then
      raise exception 'Close/reopen transition is allowed only for the latest WorkItem'
        using errcode = '23514';
    end if;
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_item_transitions_guard_trigger
before insert on public.inbox_v2_work_item_transitions
for each row execute function public.inbox_v2_work_transition_guard();

create or replace function public.inbox_v2_work_assignment_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work_revision bigint;
  v_decision public.inbox_v2_work_queue_eligibility_decisions%rowtype;
  v_fence_head public.inbox_v2_employee_assignment_fence_heads%rowtype;
  v_end_fence public.inbox_v2_employee_assignment_fence_versions%rowtype;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.inbox_v2_work_items w
       where w.tenant_id = old.tenant_id and w.id = old.work_item_id
    ) then
      return old;
    end if;
    raise exception 'Primary assignment history cannot be deleted'
      using errcode = '23514';
  end if;

  select w.revision into v_work_revision
    from public.inbox_v2_work_items w
   where w.tenant_id = new.tenant_id and w.id = new.work_item_id
   for update;
  if v_work_revision is null then
    raise exception 'Primary assignment requires a locked WorkItem'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.revision <> 1 then
      raise exception 'Primary assignment must be inserted as active revision one'
        using errcode = '23514';
    end if;
    select * into v_decision
      from public.inbox_v2_work_queue_eligibility_decisions d
     where d.tenant_id = new.tenant_id
       and d.id = new.eligibility_decision_id;
    if v_decision.id is null
       or v_decision.work_item_id <> new.work_item_id
       or v_decision.work_queue_id <> new.queue_at_start_id
       or v_decision.work_queue_revision <> new.queue_at_start_revision
       or v_decision.employee_id <> new.employee_id
       or v_decision.effect <> 'allow'
       or v_decision.employee_fence_generation <>
          new.employee_fence_generation_at_start
       or v_work_revision not in (
         v_decision.expected_work_item_revision,
         v_decision.expected_work_item_revision + 1
       )
       or new.started_at < v_decision.decided_at
       or new.started_at > v_decision.not_after
       or new.started_at < v_decision.employee_fence_effective_from then
      raise exception 'Primary assignment requires the exact live allow decision'
        using errcode = '23514';
    end if;

    select * into v_fence_head
      from public.inbox_v2_employee_assignment_fence_heads h
     where h.tenant_id = new.tenant_id and h.employee_id = new.employee_id
     for update;
    if v_fence_head.current_revision <> v_decision.employee_fence_revision
       or v_fence_head.current_generation <>
          new.employee_fence_generation_at_start
       or v_fence_head.state <> 'active'
       or v_fence_head.effective_from <>
          v_decision.employee_fence_effective_from then
      raise exception 'Primary assignment lost the Employee fence race'
        using errcode = '40001';
    end if;
  else
    if old.state <> 'active'
       or new.state <> 'ended'
       or old.revision <> 1
       or new.revision <> 2
       or row(
         new.tenant_id,
         new.id,
         new.work_item_id,
         new.queue_at_start_id,
         new.queue_at_start_revision,
         new.employee_id,
         new.source,
         new.eligibility_decision_id,
         new.employee_fence_generation_at_start,
         new.started_at,
         new.started_actor_kind,
         new.started_actor_employee_id,
         new.started_actor_authorization_epoch,
         new.started_actor_trusted_service_id,
         new.start_reason_id,
         new.created_at
       ) is distinct from row(
         old.tenant_id,
         old.id,
         old.work_item_id,
         old.queue_at_start_id,
         old.queue_at_start_revision,
         old.employee_id,
         old.source,
         old.eligibility_decision_id,
         old.employee_fence_generation_at_start,
         old.started_at,
         old.started_actor_kind,
         old.started_actor_employee_id,
         old.started_actor_authorization_epoch,
         old.started_actor_trusted_service_id,
         old.start_reason_id,
         old.created_at
       ) then
      raise exception 'Primary assignment permits one immutable active-to-ended closure'
        using errcode = '23514';
    end if;

    if new.end_basis = 'employee_fence_time' then
      select * into v_fence_head
        from public.inbox_v2_employee_assignment_fence_heads h
       where h.tenant_id = new.tenant_id and h.employee_id = new.employee_id
       for update;
      select * into v_end_fence
        from public.inbox_v2_employee_assignment_fence_versions v
       where v.tenant_id = new.tenant_id
         and v.employee_id = new.employee_id
         and v.revision = new.end_employee_fence_revision;
      if v_end_fence.revision is null
         or v_fence_head.current_revision <> new.end_employee_fence_revision
         or v_fence_head.current_generation <>
            new.end_employee_fence_generation
         or v_fence_head.state <> new.end_employee_fence_state
         or v_fence_head.effective_from <>
            new.end_employee_fence_effective_from
         or v_end_fence.generation <> new.end_employee_fence_generation
         or v_end_fence.state <> new.end_employee_fence_state
         or v_end_fence.effective_from <> new.end_employee_fence_effective_from
         or new.end_employee_fence_loaded_at <> new.end_recorded_at then
        raise exception 'Assignment fence-time closure requires the exact fence version'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_item_primary_assignments_guard_trigger
before insert or update or delete on public.inbox_v2_work_item_primary_assignments
for each row execute function public.inbox_v2_work_assignment_guard();

create or replace function public.inbox_v2_work_team_episode_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work public.inbox_v2_work_items%rowtype;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.inbox_v2_work_items w
       where w.tenant_id = old.tenant_id and w.id = old.work_item_id
    ) then
      return old;
    end if;
    raise exception 'Servicing-team history cannot be deleted'
      using errcode = '23514';
  end if;

  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = new.tenant_id and w.id = new.work_item_id
   for update;
  if not found then
    raise exception 'Servicing-team episode requires a locked WorkItem'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'active' or new.revision <> 1 then
      raise exception 'Servicing-team episode must be inserted as active revision one'
        using errcode = '23514';
    elsif v_work.state in ('resolved', 'dismissed')
       or v_work.reopen_cycle <> new.work_item_cycle then
      raise exception 'Servicing-team episode must start in the current non-terminal cycle'
        using errcode = '23514';
    end if;
  elsif old.state <> 'active'
     or new.state <> 'ended'
     or old.revision <> 1
     or new.revision <> 2
     or row(
       new.tenant_id,
       new.id,
       new.work_item_id,
       new.work_item_cycle,
       new.team_id,
       new.started_at,
       new.started_actor_kind,
       new.started_actor_employee_id,
       new.started_actor_authorization_epoch,
       new.started_actor_trusted_service_id,
       new.start_reason_id,
       new.created_at
     ) is distinct from row(
       old.tenant_id,
       old.id,
       old.work_item_id,
       old.work_item_cycle,
       old.team_id,
       old.started_at,
       old.started_actor_kind,
       old.started_actor_employee_id,
       old.started_actor_authorization_epoch,
       old.started_actor_trusted_service_id,
       old.start_reason_id,
       old.created_at
     ) then
    raise exception 'Servicing-team episode permits one immutable active-to-ended closure'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_item_servicing_team_episodes_guard_trigger
before insert or update or delete on public.inbox_v2_work_item_servicing_team_episodes
for each row execute function public.inbox_v2_work_team_episode_guard();

create or replace function public.inbox_v2_work_relation_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work_revision bigint;
  v_relation_revision bigint;
begin
  select w.revision, w.servicing_team_relation_revision
    into v_work_revision, v_relation_revision
    from public.inbox_v2_work_items w
   where w.tenant_id = new.tenant_id and w.id = new.work_item_id
   for update;
  if v_work_revision not in (
       new.expected_work_item_revision,
       new.resulting_work_item_revision
     )
     or v_relation_revision not in (
       new.expected_relation_revision,
       new.resulting_relation_revision
     ) then
    raise exception 'Servicing-team transition lost its WorkItem/relation CAS race'
      using errcode = '40001';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_work_item_relation_transitions_guard_trigger
before insert on public.inbox_v2_work_item_relation_transitions
for each row execute function public.inbox_v2_work_relation_transition_guard();

create or replace function public.inbox_v2_work_item_slot_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.inbox_v2_conversations c
       where c.tenant_id = old.tenant_id and c.id = old.conversation_id
    ) then
      return old;
    end if;
    raise exception 'Conversation WorkItem slot cannot be deleted'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'Conversation WorkItem slot must start at revision 1'
        using errcode = '23514';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'Conversation WorkItem slot requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_conversation_work_item_slots_guard_trigger
before insert or update or delete on public.inbox_v2_conversation_work_item_slots
for each row execute function public.inbox_v2_work_item_slot_guard();

create or replace function public.inbox_v2_work_assignment_non_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments other
     where other.tenant_id = new.tenant_id
       and other.work_item_id = new.work_item_id
       and other.id <> new.id
       and other.started_at < coalesce(new.ended_at, 'infinity'::timestamptz)
       and new.started_at < coalesce(other.ended_at, 'infinity'::timestamptz)
  ) then
    raise exception 'Primary assignment intervals cannot overlap'
      using errcode = '23P01';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_work_assignment_non_overlap_constraint
after insert or update on public.inbox_v2_work_item_primary_assignments
deferrable initially deferred
for each row execute function public.inbox_v2_work_assignment_non_overlap();

create or replace function public.inbox_v2_work_team_episode_non_overlap()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes other
     where other.tenant_id = new.tenant_id
       and other.work_item_id = new.work_item_id
       and other.id <> new.id
       and other.started_at < coalesce(new.ended_at, 'infinity'::timestamptz)
       and new.started_at < coalesce(other.ended_at, 'infinity'::timestamptz)
  ) then
    raise exception 'Servicing-team intervals cannot overlap'
      using errcode = '23P01';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_work_team_episode_non_overlap_constraint
after insert or update on public.inbox_v2_work_item_servicing_team_episodes
deferrable initially deferred
for each row execute function public.inbox_v2_work_team_episode_non_overlap();

create or replace function public.inbox_v2_employee_fence_sync()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_head public.inbox_v2_employee_assignment_fence_heads%rowtype;
  v_state public.inbox_v2_employee_assignment_fence_state;
  v_effective_from timestamptz;
  v_recorded_at timestamptz;
  v_reason_id text;
begin
  if tg_op = 'UPDATE' and new.deactivated_at is not distinct from old.deactivated_at then
    return new;
  end if;

  if tg_op = 'INSERT' then
    v_state := case
      when new.deactivated_at is null then 'active'
      else 'inactive'
    end;
    v_effective_from := coalesce(new.deactivated_at, new.created_at);
    v_recorded_at := greatest(new.created_at, v_effective_from);
    v_reason_id := 'core:employee_bootstrap';

    insert into public.inbox_v2_employee_assignment_fence_versions (
      tenant_id,
      employee_id,
      revision,
      generation,
      state,
      effective_from,
      recorded_at,
      reason_id,
      changed_by_trusted_service_id
    ) values (
      new.tenant_id,
      new.id,
      1,
      1,
      v_state,
      v_effective_from,
      v_recorded_at,
      v_reason_id,
      'core:employee_lifecycle_sync'
    ) on conflict do nothing;

    insert into public.inbox_v2_employee_assignment_fence_heads (
      tenant_id,
      employee_id,
      state,
      current_generation,
      current_revision,
      effective_from,
      created_at,
      updated_at
    ) values (
      new.tenant_id,
      new.id,
      v_state,
      1,
      1,
      v_effective_from,
      new.created_at,
      v_recorded_at
    ) on conflict do nothing;

    return new;
  end if;

  select * into v_head
    from public.inbox_v2_employee_assignment_fence_heads h
   where h.tenant_id = new.tenant_id and h.employee_id = new.id
   for update;
  if not found then
    raise exception 'Employee lifecycle update is missing its assignment fence head'
      using errcode = '23514';
  end if;

  v_state := case
    when new.deactivated_at is null then 'active'
    when v_head.state = 'active' then 'draining'
    else v_head.state
  end;

  v_recorded_at := date_trunc('milliseconds', clock_timestamp());
  v_effective_from := v_recorded_at;
  v_reason_id := case
    when new.deactivated_at is null then 'core:employee_reactivated'
    else 'core:employee_deactivated'
  end;

  insert into public.inbox_v2_employee_assignment_fence_versions (
    tenant_id,
    employee_id,
    revision,
    generation,
    state,
    effective_from,
    recorded_at,
    reason_id,
    changed_by_trusted_service_id
  ) values (
    new.tenant_id,
    new.id,
    v_head.current_revision + 1,
    v_head.current_generation + 1,
    v_state,
    v_effective_from,
    v_recorded_at,
    v_reason_id,
    'core:employee_lifecycle_sync'
  );

  update public.inbox_v2_employee_assignment_fence_heads
     set state = v_state,
         current_generation = v_head.current_generation + 1,
         current_revision = v_head.current_revision + 1,
         effective_from = v_effective_from,
         updated_at = v_recorded_at
   where tenant_id = new.tenant_id and employee_id = new.id;

  return new;
end
$function$;

create trigger inbox_v2_employees_fence_insert_trigger
after insert on public.employees
for each row execute function public.inbox_v2_employee_fence_sync();

create trigger inbox_v2_employees_fence_lifecycle_trigger
after update of deactivated_at on public.employees
for each row execute function public.inbox_v2_employee_fence_sync();

insert into public.inbox_v2_employee_assignment_fence_versions (
  tenant_id,
  employee_id,
  revision,
  generation,
  state,
  effective_from,
  recorded_at,
  reason_id,
  changed_by_trusted_service_id
)
select
  e.tenant_id,
  e.id,
  1,
  1,
  case when e.deactivated_at is null
    then 'active'::public.inbox_v2_employee_assignment_fence_state
    else 'inactive'::public.inbox_v2_employee_assignment_fence_state
  end,
  coalesce(e.deactivated_at, e.created_at),
  greatest(e.created_at, coalesce(e.deactivated_at, e.created_at)),
  'core:employee_bootstrap',
  'core:employee_lifecycle_sync'
from public.employees e
on conflict do nothing;

insert into public.inbox_v2_employee_assignment_fence_heads (
  tenant_id,
  employee_id,
  state,
  current_generation,
  current_revision,
  effective_from,
  created_at,
  updated_at
)
select
  e.tenant_id,
  e.id,
  v.state,
  1,
  1,
  v.effective_from,
  e.created_at,
  v.recorded_at
from public.employees e
join public.inbox_v2_employee_assignment_fence_versions v
  on v.tenant_id = e.tenant_id
 and v.employee_id = e.id
 and v.revision = 1
on conflict do nothing;

create or replace function public.inbox_v2_conversation_slot_bootstrap()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_conversation_work_item_slots (
    tenant_id,
    id,
    conversation_id,
    latest_ordinal,
    latest_work_item_id,
    latest_lifecycle_class,
    latest_lifecycle_fence_revision,
    current_non_terminal_work_item_id,
    current_non_terminal_ordinal,
    revision,
    created_at,
    updated_at
  ) values (
    new.tenant_id,
    'conversation_work_item_slot:' || encode(
      sha256((new.tenant_id || chr(31) || new.id)::bytea),
      'hex'
    ),
    new.id,
    0,
    null,
    null,
    null,
    null,
    null,
    1,
    new.created_at,
    new.created_at
  ) on conflict do nothing;
  return new;
end
$function$;

create trigger inbox_v2_conversations_slot_insert_trigger
after insert on public.inbox_v2_conversations
for each row execute function public.inbox_v2_conversation_slot_bootstrap();

insert into public.inbox_v2_conversation_work_item_slots (
  tenant_id,
  id,
  conversation_id,
  latest_ordinal,
  latest_work_item_id,
  latest_lifecycle_class,
  latest_lifecycle_fence_revision,
  current_non_terminal_work_item_id,
  current_non_terminal_ordinal,
  revision,
  created_at,
  updated_at
)
select
  c.tenant_id,
  'conversation_work_item_slot:' || encode(
    sha256((c.tenant_id || chr(31) || c.id)::bytea),
    'hex'
  ),
  c.id,
  0,
  null,
  null,
  null,
  null,
  null,
  1,
  c.created_at,
  c.created_at
from public.inbox_v2_conversations c
on conflict do nothing;

create or replace function public.inbox_v2_work_item_aggregate_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_item_id text;
  v_work public.inbox_v2_work_items%rowtype;
  v_creation public.inbox_v2_work_item_creation_decisions%rowtype;
  v_creation_queue public.inbox_v2_work_queue_versions%rowtype;
  v_creation_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla_count bigint;
  v_sla_min_revision bigint;
  v_sla_max_revision bigint;
  v_sla_cycle_count bigint;
  v_sla_min_cycle bigint;
  v_sla_max_cycle bigint;
  v_slot_revision bigint;
  v_conversation_transport public.inbox_v2_conversation_transport;
  v_expected_creation_slot_revision bigint;
  v_active_assignment_count bigint;
  v_active_assignment_id text;
  v_last_effect_opened_assignment_id text;
  v_last_effect_closed_assignment_id text;
  v_active_team_count bigint;
  v_active_team_episode_id text;
  v_active_team_id text;
  v_active_team_cycle bigint;
  v_last_effect_opened_team_episode_id text;
  v_last_effect_closed_team_episode_id text;
  v_proof_count bigint;
  v_distinct_proof_count bigint;
  v_min_proof_revision bigint;
  v_max_proof_revision bigint;
  v_reopen_count bigint;
  v_access_change_count bigint;
  v_relation_count bigint;
  v_distinct_relation_count bigint;
  v_min_relation_revision bigint;
  v_max_relation_revision bigint;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_chain_state public.inbox_v2_work_item_state;
  v_chain_queue_id text;
  v_chain_queue_revision bigint;
  v_chain_relation_revision bigint;
  v_revision_proof record;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'inbox_v2_work_items' then
    v_work_item_id := new.id;
  else
    v_work_item_id := new.work_item_id;
  end if;

  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id and w.id = v_work_item_id;
  if not found then
    return null;
  end if;

  select * into v_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle
     and s.revision = v_work.sla_snapshot_revision;
  if not found then
    raise exception 'WorkItem SLA head must reference an exact immutable snapshot'
      using errcode = '23514';
  end if;
  select count(*), min(s.revision), max(s.revision)
    into v_sla_count, v_sla_min_revision, v_sla_max_revision
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle;
  if v_sla_min_revision <> 1
     or v_sla_max_revision <> v_work.sla_snapshot_revision
     or v_sla_count <> v_work.sla_snapshot_revision then
    raise exception 'WorkItem SLA snapshot revisions must be contiguous through the cycle head'
      using errcode = '23514';
  end if;
  select count(distinct s.sla_cycle), min(s.sla_cycle), max(s.sla_cycle)
    into v_sla_cycle_count, v_sla_min_cycle, v_sla_max_cycle
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id and s.work_item_id = v_work.id;
  if v_sla_min_cycle <> 1
     or v_sla_max_cycle <> v_work.sla_cycle
     or v_sla_cycle_count <> v_work.sla_cycle
     or exists (
       select 1
         from public.inbox_v2_work_item_sla_snapshots s
        where s.tenant_id = v_work.tenant_id
          and s.work_item_id = v_work.id
        group by s.sla_cycle
       having min(s.revision) <> 1 or count(*) <> max(s.revision)
     ) then
    raise exception 'WorkItem SLA cycles and per-cycle revisions must be gap-free'
      using errcode = '23514';
  end if;

  select * into v_creation
    from public.inbox_v2_work_item_creation_decisions d
   where d.tenant_id = v_work.tenant_id and d.work_item_id = v_work.id;
  select * into v_creation_queue
    from public.inbox_v2_work_queue_versions q
   where q.tenant_id = v_creation.tenant_id
     and q.work_queue_id = v_creation.work_queue_id
     and q.revision = v_creation.work_queue_revision;
  select * into v_creation_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = 1
     and s.revision = 1;
  select c.transport into v_conversation_transport
    from public.inbox_v2_conversations c
   where c.tenant_id = v_work.tenant_id and c.id = v_work.conversation_id;
  select s.revision into v_slot_revision
    from public.inbox_v2_conversation_work_item_slots s
   where s.tenant_id = v_work.tenant_id
     and s.conversation_id = v_work.conversation_id;
  select 1 + v_work.ordinal + count(t.id)
    into v_expected_creation_slot_revision
    from public.inbox_v2_work_items prior
    join public.inbox_v2_work_item_transitions t
      on t.tenant_id = prior.tenant_id and t.work_item_id = prior.id
   where prior.tenant_id = v_work.tenant_id
     and prior.conversation_id = v_work.conversation_id
     and prior.ordinal < v_work.ordinal
     and t.kind in (
       'close_resolved',
       'close_dismissed',
       'reopen_unassigned',
       'reopen_assigned'
     );
  if v_creation.work_item_id is null
     or v_creation.conversation_id <> v_work.conversation_id
     or v_creation.transport <> v_conversation_transport
     or v_creation.reason_id <> v_work.creation_reason_id
     or v_work.created_actor_kind <> 'trusted_service'
     or v_creation.decided_by_trusted_service_id <>
        v_work.created_actor_trusted_service_id
     or v_creation.decided_at > v_work.created_at
     or v_creation.slot_after_revision > v_slot_revision
     or v_creation.slot_after_revision <>
        v_expected_creation_slot_revision
     or (v_work.ordinal = 1 and
       v_creation.latest_terminal_handling <> 'no_latest_work_item')
     or (v_work.ordinal > 1 and
       v_creation.latest_terminal_handling <> 'create_sequential') then
    raise exception 'WorkItem must retain its exact creation decision authority'
      using errcode = '23514';
  end if;

  if v_creation_sla.revision is null
     or v_creation_sla.kind <> v_creation_queue.default_sla_kind
     or v_creation_sla.calculated_at <> v_work.created_at
     or v_creation_sla.created_at <> v_work.created_at
     or (
       v_creation_queue.default_sla_kind = 'tracked'
       and (
         v_creation_sla.policy_id <>
            v_creation_queue.default_sla_policy_id
         or v_creation_sla.policy_version <>
            v_creation_queue.default_sla_policy_version
         or v_creation_sla.policy_revision <>
            v_creation_queue.default_sla_policy_revision
         or v_creation_sla.input_revision <> 1
         or v_creation_sla.business_calendar_id <>
            v_creation_queue.default_business_calendar_id
         or v_creation_sla.business_calendar_version <>
            v_creation_queue.default_business_calendar_version
         or v_creation_sla.business_calendar_revision <>
            v_creation_queue.default_business_calendar_revision
         or v_creation_sla.time_zone <>
            v_creation_queue.default_sla_time_zone
         or v_creation_sla.clock_state <> 'running'
         or v_creation_sla.started_at <> v_work.created_at
         or v_creation_sla.paused_at is not null
         or v_creation_sla.pause_condition_id is not null
         or v_creation_sla.stopped_at is not null
         or v_creation_sla.first_human_response_at is not null
       )
     ) then
    raise exception 'WorkItem cycle-one SLA must retain exact creation Queue defaults'
      using errcode = '23514';
  end if;

  if v_work.revision = 1 and (
    v_work.state <> 'new'
    or v_work.queue_id <> v_creation.work_queue_id
    or v_work.queue_revision <> v_creation.work_queue_revision
    or v_work.reopen_cycle <> 0
    or v_work.servicing_team_relation_revision <> 1
    or v_work.collaborator_set_revision <> 1
    or v_work.resource_access_revision <> 1
    or v_work.priority_id <> v_creation_queue.default_priority_id
    or v_work.sla_cycle <> 1
    or v_work.sla_snapshot_revision <> 1
    or v_work.current_primary_assignment_id is not null
    or v_work.current_servicing_team_episode_id is not null
  ) then
    raise exception 'Revision-one WorkItem must be the unassigned creation snapshot'
      using errcode = '23514';
  end if;

  if v_sla.kind = 'tracked' and (
       (v_work.state in ('resolved', 'dismissed') and
         (
           v_sla.clock_state <> 'stopped'
           or v_sla.stopped_at <> v_work.updated_at
           or v_sla.calculated_at <> v_work.updated_at
         ))
       or (v_work.state in ('new', 'assigned', 'in_progress', 'waiting') and
         v_sla.clock_state = 'stopped')
     ) then
    raise exception 'Tracked SLA clock state must follow WorkItem terminality'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where a.state = 'active'),
    max(a.id) filter (where a.state = 'active')
    into v_active_assignment_count, v_active_assignment_id
    from public.inbox_v2_work_item_primary_assignments a
   where a.tenant_id = v_work.tenant_id and a.work_item_id = v_work.id;
  if (
      v_work.state in ('assigned', 'in_progress', 'waiting')
      and (
        v_active_assignment_count <> 1
        or v_work.current_primary_assignment_id is distinct from
           v_active_assignment_id
      )
    ) or (
      v_work.state in ('new', 'resolved', 'dismissed')
      and (
        v_active_assignment_count <> 0
        or v_work.current_primary_assignment_id is not null
      )
    ) then
    raise exception 'WorkItem state and active primary-assignment head diverged'
      using errcode = '23514';
  end if;
  if v_work.last_primary_assignment_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.id = v_work.last_primary_assignment_id
  ) then
    raise exception 'WorkItem last primary-assignment pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select t.opened_primary_assignment_id, t.closed_primary_assignment_id
    into v_last_effect_opened_assignment_id,
         v_last_effect_closed_assignment_id
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and (
       t.opened_primary_assignment_id is not null
       or t.closed_primary_assignment_id is not null
     )
   order by t.resulting_revision desc
   limit 1;
  if v_work.last_primary_assignment_id is distinct from coalesce(
       v_last_effect_opened_assignment_id,
       v_last_effect_closed_assignment_id
     )
     or (v_work.state in ('assigned', 'in_progress', 'waiting') and
       v_work.current_primary_assignment_id is distinct from
         v_last_effect_opened_assignment_id) then
    raise exception 'WorkItem primary-assignment pointers must follow the latest assignment effect'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where e.state = 'active'),
    max(e.id) filter (where e.state = 'active'),
    max(e.team_id) filter (where e.state = 'active'),
    max(e.work_item_cycle) filter (where e.state = 'active')
    into v_active_team_count,
         v_active_team_episode_id,
         v_active_team_id,
         v_active_team_cycle
    from public.inbox_v2_work_item_servicing_team_episodes e
   where e.tenant_id = v_work.tenant_id and e.work_item_id = v_work.id;
  if v_work.state in ('resolved', 'dismissed') and v_active_team_count <> 0 then
    raise exception 'Terminal WorkItem cannot retain an active servicing team'
      using errcode = '23514';
  end if;
  if (
      v_work.current_servicing_team_episode_id is null
      and (v_active_team_count <> 0 or v_work.current_servicing_team_id is not null)
    ) or (
      v_work.current_servicing_team_episode_id is not null
      and (
        v_active_team_count <> 1
        or v_work.current_servicing_team_episode_id is distinct from
           v_active_team_episode_id
        or v_work.current_servicing_team_id is distinct from v_active_team_id
        or v_work.reopen_cycle <> v_active_team_cycle
      )
    ) then
    raise exception 'WorkItem servicing-team head is not the exact active episode'
      using errcode = '23514';
  end if;
  if v_work.last_servicing_team_episode_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.id = v_work.last_servicing_team_episode_id
  ) then
    raise exception 'WorkItem last servicing-team pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select effect.opened_episode_id, effect.closed_episode_id
    into v_last_effect_opened_team_episode_id,
         v_last_effect_closed_team_episode_id
    from (
      select
        r.resulting_work_item_revision as work_item_revision,
        r.next_episode_id as opened_episode_id,
        r.previous_episode_id as closed_episode_id
      from public.inbox_v2_work_item_relation_transitions r
      where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select
        t.resulting_revision as work_item_revision,
        null::text as opened_episode_id,
        t.closed_servicing_team_episode_id as closed_episode_id
      from public.inbox_v2_work_item_transitions t
      where t.tenant_id = v_work.tenant_id
        and t.work_item_id = v_work.id
        and t.closed_servicing_team_episode_id is not null
    ) effect
   order by effect.work_item_revision desc
   limit 1;
  if v_work.last_servicing_team_episode_id is distinct from coalesce(
       v_last_effect_opened_team_episode_id,
       v_last_effect_closed_team_episode_id
     )
     or (v_work.current_servicing_team_episode_id is not null and
       v_work.current_servicing_team_episode_id is distinct from
         v_last_effect_opened_team_episode_id) then
    raise exception 'WorkItem servicing-team pointers must follow the latest relation effect'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.state = 'ended'
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.id = a.termination_transition_id
            and t.closed_primary_assignment_id = a.id
            and t.occurred_at = a.end_recorded_at
            and t.actor_kind = a.ended_actor_kind
            and t.actor_employee_id is not distinct from a.ended_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.ended_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.ended_actor_trusted_service_id
            and t.reason_id = a.end_reason_id
            and (
              (t.kind in ('recovery_requeue', 'recovery_transfer')
                and a.end_basis = 'employee_fence_time')
              or (t.kind in (
                'release',
                'transfer',
                'close_resolved',
                'close_dismissed'
              ) and a.end_basis = 'command_time')
            )
       )
  ) then
    raise exception 'Ended assignment must name its exact WorkItem transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
      join public.inbox_v2_work_queue_eligibility_decisions d
        on d.tenant_id = a.tenant_id and d.id = a.eligibility_decision_id
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.opened_primary_assignment_id = a.id
            and t.expected_revision = d.expected_work_item_revision
            and t.destination_queue_id = a.queue_at_start_id
            and t.destination_queue_revision = a.queue_at_start_revision
            and t.occurred_at = a.started_at
            and a.created_at = t.occurred_at
            and d.decided_at = t.occurred_at
            and d.employee_fence_loaded_at = t.occurred_at
            and t.actor_kind = a.started_actor_kind
            and t.actor_employee_id is not distinct from a.started_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.started_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.started_actor_trusted_service_id
            and t.reason_id = a.start_reason_id
            and (
              (t.kind = 'claim'
                and a.source = 'claim'
                and t.actor_kind = 'employee'
                and t.actor_employee_id = a.employee_id)
              or (t.kind = 'assign' and
                a.source in ('manual_assignment', 'policy_assignment'))
              or (t.kind = 'transfer' and a.source = 'transfer')
              or (t.kind = 'reopen_assigned' and a.source = 'reopen')
              or (t.kind = 'recovery_transfer' and
                a.source = 'recovery_transfer')
            )
       )
  ) then
    raise exception 'Primary assignment must retain its exact opening transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and (
         (t.opened_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
             join public.inbox_v2_work_queue_eligibility_decisions d
               on d.tenant_id = a.tenant_id
              and d.id = a.eligibility_decision_id
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.opened_primary_assignment_id
              and d.expected_work_item_revision = t.expected_revision
              and a.queue_at_start_id = t.destination_queue_id
              and a.queue_at_start_revision = t.destination_queue_revision
              and a.started_at = t.occurred_at
              and a.created_at = t.occurred_at
              and d.decided_at = t.occurred_at
              and d.employee_fence_loaded_at = t.occurred_at
              and a.started_actor_kind = t.actor_kind
              and a.started_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.started_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.started_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.start_reason_id = t.reason_id
              and (
                (t.kind = 'claim'
                  and a.source = 'claim'
                  and t.actor_kind = 'employee'
                  and t.actor_employee_id = a.employee_id)
                or (t.kind = 'assign' and
                  a.source in ('manual_assignment', 'policy_assignment'))
                or (t.kind = 'transfer' and a.source = 'transfer')
                or (t.kind = 'reopen_assigned' and a.source = 'reopen')
                or (t.kind = 'recovery_transfer' and
                  a.source = 'recovery_transfer')
              )
         ))
         or (t.closed_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.closed_primary_assignment_id
              and a.state = 'ended'
              and a.termination_transition_id = t.id
              and a.end_recorded_at = t.occurred_at
              and a.ended_actor_kind = t.actor_kind
              and a.ended_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.ended_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.ended_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.end_reason_id = t.reason_id
              and (
                (t.kind in ('recovery_requeue', 'recovery_transfer')
                  and a.end_basis = 'employee_fence_time')
                or (t.kind in (
                  'release',
                  'transfer',
                  'close_resolved',
                  'close_dismissed'
                ) and a.end_basis = 'command_time')
              )
         ))
       )
  ) then
    raise exception 'WorkItem transition assignment effect lacks exact bidirectional history'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
      join public.inbox_v2_work_item_primary_assignments closed
        on closed.tenant_id = t.tenant_id
       and closed.id = t.closed_primary_assignment_id
      join public.inbox_v2_work_item_primary_assignments opened
        on opened.tenant_id = t.tenant_id
       and opened.id = t.opened_primary_assignment_id
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.kind in ('transfer', 'recovery_transfer')
       and closed.employee_id = opened.employee_id
       and closed.queue_at_start_id = opened.queue_at_start_id
       and closed.queue_at_start_revision = opened.queue_at_start_revision
  ) then
    raise exception 'Primary transfer must change Employee or Queue'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.state = 'ended'
       and (
         (e.end_cause = 'relation_command' and not exists (
           select 1
             from public.inbox_v2_work_item_relation_transitions r
            where r.tenant_id = e.tenant_id
              and r.work_item_id = e.work_item_id
              and r.id = e.end_relation_transition_id
              and r.previous_episode_id = e.id
              and r.occurred_at = e.end_recorded_at
              and r.occurred_at = e.ended_at
         ))
         or (e.end_cause = 'work_item_terminal' and not exists (
           select 1
             from public.inbox_v2_work_item_transitions t
            where t.tenant_id = e.tenant_id
              and t.work_item_id = e.work_item_id
              and t.id = e.end_work_item_transition_id
              and t.kind in ('close_resolved', 'close_dismissed')
              and t.closed_servicing_team_episode_id = e.id
              and t.occurred_at = e.end_recorded_at
              and t.occurred_at = e.ended_at
         ))
       )
  ) then
    raise exception 'Ended servicing-team episode must name its exact transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
      join public.inbox_v2_work_item_servicing_team_episodes previous
        on previous.tenant_id = r.tenant_id
       and previous.id = r.previous_episode_id
      join public.inbox_v2_work_item_servicing_team_episodes following
        on following.tenant_id = r.tenant_id
       and following.id = r.next_episode_id
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and r.kind = 'servicing_team_change'
       and previous.team_id = following.team_id
  ) then
    raise exception 'Servicing-team change must target a different Team'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_revision),
         min(p.resulting_revision), max(p.resulting_revision)
    into v_proof_count, v_distinct_proof_count,
         v_min_proof_revision, v_max_proof_revision
    from (
      select t.resulting_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
      union all
      select r.resulting_work_item_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    ) p;
  if (v_work.revision = 1 and v_proof_count <> 0)
     or (v_work.revision > 1 and (
       v_proof_count <> v_work.revision - 1
       or v_distinct_proof_count <> v_proof_count
       or v_min_proof_revision <> 2
       or v_max_proof_revision <> v_work.revision
     )) then
    raise exception 'WorkItem revision chain requires exactly one immutable proof per +1'
      using errcode = '23514';
  end if;

  select count(*) into v_reopen_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.kind in ('reopen_unassigned', 'reopen_assigned');
  if v_work.reopen_cycle <> v_reopen_count
     or v_work.collaborator_set_revision <> 1 then
    raise exception 'WorkItem reopen/collaborator revisions lack exact history proof'
      using errcode = '23514';
  end if;

  select count(*) into v_access_change_count
    from (
      select t.id
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and (
           t.opened_primary_assignment_id is not null
           or t.closed_primary_assignment_id is not null
           or t.source_queue_id <> t.destination_queue_id
           or t.source_queue_revision <> t.destination_queue_revision
           or t.from_state in ('resolved', 'dismissed')
           or t.to_state in ('resolved', 'dismissed')
         )
      union all
      select r.id
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    ) access_change;
  if v_work.resource_access_revision <> 1 + v_access_change_count then
    raise exception 'WorkItem resource-access revision lacks exact authority-change proof'
      using errcode = '23514';
  end if;

  v_chain_state := 'new';
  v_chain_queue_id := v_creation.work_queue_id;
  v_chain_queue_revision := v_creation.work_queue_revision;
  for v_transition in
    select *
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
     order by t.resulting_revision
  loop
    if v_transition.from_state <> v_chain_state
       or v_transition.source_queue_id <> v_chain_queue_id
       or v_transition.source_queue_revision <> v_chain_queue_revision then
      raise exception 'WorkItem transition source breaks the persisted lifecycle chain'
        using errcode = '23514';
    end if;
    v_chain_state := v_transition.to_state;
    v_chain_queue_id := v_transition.destination_queue_id;
    v_chain_queue_revision := v_transition.destination_queue_revision;
  end loop;
  if v_chain_state <> v_work.state
     or v_chain_queue_id <> v_work.queue_id
     or v_chain_queue_revision <> v_work.queue_revision then
    raise exception 'WorkItem lifecycle transition chain does not induce the head'
      using errcode = '23514';
  end if;

  v_chain_relation_revision := 1;
  for v_revision_proof in
    select
      t.resulting_revision as work_item_revision,
      t.expected_servicing_team_relation_revision as expected_relation_revision,
      t.resulting_servicing_team_relation_revision as resulting_relation_revision
    from public.inbox_v2_work_item_transitions t
    where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
    union all
    select
      r.resulting_work_item_revision as work_item_revision,
      r.expected_relation_revision,
      r.resulting_relation_revision
    from public.inbox_v2_work_item_relation_transitions r
    where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    order by work_item_revision
  loop
    if v_revision_proof.expected_relation_revision <>
         v_chain_relation_revision then
      raise exception 'WorkItem proof breaks the servicing-team relation chain'
        using errcode = '23514';
    end if;
    v_chain_relation_revision := v_revision_proof.resulting_relation_revision;
  end loop;
  if v_chain_relation_revision <> v_work.servicing_team_relation_revision then
    raise exception 'Servicing-team relation proof chain does not induce the head'
      using errcode = '23514';
  end if;

  select * into v_transition
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.resulting_revision = v_work.revision;
  if found and (
    v_transition.occurred_at <> v_work.updated_at
    or v_transition.resulting_servicing_team_relation_revision <>
       v_work.servicing_team_relation_revision
  ) then
    raise exception 'Latest WorkItem transition timestamp/relation does not induce the head'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_relation_revision),
         min(p.resulting_relation_revision), max(p.resulting_relation_revision)
    into v_relation_count, v_distinct_relation_count,
         v_min_relation_revision, v_max_relation_revision
    from (
      select r.resulting_relation_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select t.resulting_servicing_team_relation_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and t.closed_servicing_team_episode_id is not null
    ) p;
  if (v_work.servicing_team_relation_revision = 1 and v_relation_count <> 0)
     or (v_work.servicing_team_relation_revision > 1 and (
       v_relation_count <> v_work.servicing_team_relation_revision - 1
       or v_distinct_relation_count <> v_relation_count
       or v_min_relation_revision <> 2
       or v_max_relation_revision <> v_work.servicing_team_relation_revision
     )) then
    raise exception 'Servicing-team relation revision chain is not contiguous'
      using errcode = '23514';
  end if;

  select * into v_relation
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = v_work.tenant_id
     and r.work_item_id = v_work.id
     and r.resulting_work_item_revision = v_work.revision;
  if found then
    if v_relation.resulting_relation_revision <>
         v_work.servicing_team_relation_revision
       or v_relation.occurred_at <> v_work.updated_at
       or (v_relation.kind = 'servicing_team_add' and (
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or v_relation.previous_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_remove' and (
         v_work.current_servicing_team_episode_id is not null
         or v_relation.next_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_change' and
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id) then
      raise exception 'Latest servicing-team transition does not induce the relation head'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and (
         (r.previous_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.previous_episode_id
              and e.state = 'ended'
              and e.end_cause = 'relation_command'
              and e.end_relation_transition_id = r.id
              and e.end_recorded_at = r.occurred_at
              and e.ended_at = r.occurred_at
              and e.ended_actor_kind = r.actor_kind
              and e.ended_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.ended_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.ended_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.end_reason_id = r.reason_id
         ))
         or (r.next_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.next_episode_id
              and e.started_at = r.occurred_at
              and e.started_actor_kind = r.actor_kind
              and e.started_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.started_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.started_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.start_reason_id = r.reason_id
              and e.work_item_cycle = (
                select count(*)
                  from public.inbox_v2_work_item_transitions reopen
                 where reopen.tenant_id = r.tenant_id
                   and reopen.work_item_id = r.work_item_id
                   and reopen.resulting_revision <=
                       r.expected_work_item_revision
                   and reopen.kind in (
                     'reopen_unassigned',
                     'reopen_assigned'
                   )
              )
         ))
       )
  ) then
    raise exception 'Servicing-team transition episode pointers cross aggregate scope'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_relation_transitions r
          where r.tenant_id = e.tenant_id
            and r.work_item_id = e.work_item_id
            and r.next_episode_id = e.id
            and r.occurred_at = e.started_at
            and r.actor_kind = e.started_actor_kind
            and r.actor_employee_id is not distinct from
                e.started_actor_employee_id
            and r.actor_authorization_epoch is not distinct from
                e.started_actor_authorization_epoch
            and r.actor_trusted_service_id is not distinct from
                e.started_actor_trusted_service_id
            and r.reason_id = e.start_reason_id
            and e.work_item_cycle = (
              select count(*)
                from public.inbox_v2_work_item_transitions reopen
               where reopen.tenant_id = r.tenant_id
                 and reopen.work_item_id = r.work_item_id
                 and reopen.resulting_revision <=
                     r.expected_work_item_revision
                 and reopen.kind in ('reopen_unassigned', 'reopen_assigned')
            )
       )
  ) then
    raise exception 'Servicing-team episode must retain its exact opening relation transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.closed_servicing_team_episode_id is not null
       and not exists (
         select 1
           from public.inbox_v2_work_item_servicing_team_episodes e
          where e.tenant_id = t.tenant_id
            and e.work_item_id = t.work_item_id
            and e.id = t.closed_servicing_team_episode_id
            and e.state = 'ended'
            and e.end_cause = 'work_item_terminal'
            and e.end_work_item_transition_id = t.id
            and e.end_recorded_at = t.occurred_at
            and e.ended_at = t.occurred_at
            and e.ended_actor_kind = t.actor_kind
            and e.ended_actor_employee_id is not distinct from
                t.actor_employee_id
            and e.ended_actor_authorization_epoch is not distinct from
                t.actor_authorization_epoch
            and e.ended_actor_trusted_service_id is not distinct from
                t.actor_trusted_service_id
            and e.end_reason_id = t.reason_id
       )
  ) then
    raise exception 'Terminal WorkItem relation proof must close its exact team episode'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create or replace function public.inbox_v2_work_item_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_transition_count bigint;
  v_relation_transition_count bigint;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_old_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_new_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_destination_queue public.inbox_v2_work_queue_versions%rowtype;
  v_previous_team_id text;
  v_next_team_id text;
  v_expected_access_revision bigint;
begin
  if not exists (
    select 1
      from public.inbox_v2_work_items w
     where w.tenant_id = new.tenant_id and w.id = new.id
  ) then
    return null;
  end if;

  select count(*) into v_transition_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = new.tenant_id
     and t.work_item_id = new.id
     and t.resulting_revision = new.revision;
  select count(*) into v_relation_transition_count
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = new.tenant_id
     and r.work_item_id = new.id
     and r.resulting_work_item_revision = new.revision;

  if v_transition_count + v_relation_transition_count <> 1 then
    raise exception 'Each WorkItem +1 mutation requires exactly one lifecycle XOR relation proof'
      using errcode = '23514';
  end if;

  if v_transition_count = 1 then
    select * into strict v_transition
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = new.tenant_id
       and t.work_item_id = new.id
       and t.resulting_revision = new.revision;

    if v_transition.expected_revision <> old.revision
       or v_transition.resulting_revision <> new.revision
       or v_transition.from_state <> old.state
       or v_transition.to_state <> new.state
       or v_transition.source_queue_id <> old.queue_id
       or v_transition.source_queue_revision <> old.queue_revision
       or v_transition.destination_queue_id <> new.queue_id
       or v_transition.destination_queue_revision <> new.queue_revision
       or v_transition.occurred_at <> new.updated_at
       or v_transition.expected_servicing_team_relation_revision <>
          old.servicing_team_relation_revision
       or v_transition.resulting_servicing_team_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'WorkItem lifecycle proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;

    if v_transition.opened_primary_assignment_id is not null then
      if (
          v_transition.closed_primary_assignment_id is null
          and old.current_primary_assignment_id is not null
        )
        or (
          v_transition.closed_primary_assignment_id is not null
          and old.current_primary_assignment_id is distinct from
              v_transition.closed_primary_assignment_id
        )
        or new.current_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id
        or new.last_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id then
        raise exception 'WorkItem assignment opening does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_primary_assignment_id is not null then
      if old.current_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id
         or new.current_primary_assignment_id is not null
         or new.last_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id then
        raise exception 'WorkItem assignment closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_primary_assignment_id is distinct from
            old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
            old.last_primary_assignment_id then
      raise exception 'WorkItem transition without assignment effect changed assignment pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_transition.closed_servicing_team_episode_id is distinct from
           old.current_servicing_team_episode_id then
        raise exception 'Terminal WorkItem transition must close the exact OLD servicing-team head'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_servicing_team_episode_id is not null then
      raise exception 'Non-terminal WorkItem transition cannot close a servicing-team episode'
        using errcode = '23514';
    end if;

    if v_transition.closed_servicing_team_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_transition.closed_servicing_team_episode_id;
      if old.current_servicing_team_id is distinct from v_previous_team_id
         or new.current_servicing_team_episode_id is not null
         or new.current_servicing_team_id is not null
         or new.last_servicing_team_episode_id is distinct from
            v_transition.closed_servicing_team_episode_id then
        raise exception 'Terminal WorkItem relation closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is distinct from
            old.current_servicing_team_episode_id
       or new.current_servicing_team_id is distinct from
            old.current_servicing_team_id
       or new.last_servicing_team_episode_id is distinct from
            old.last_servicing_team_episode_id then
      raise exception 'Lifecycle transition without team closure changed servicing-team pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind = 'priority_change' then
      if new.priority_id is not distinct from old.priority_id then
        raise exception 'Priority change cannot be a no-op'
          using errcode = '23514';
      end if;
    elsif new.priority_id is distinct from old.priority_id then
      raise exception 'Only priority_change may mutate WorkItem priority'
        using errcode = '23514';
    end if;

    select * into v_old_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = old.tenant_id
       and s.work_item_id = old.id
       and s.sla_cycle = old.sla_cycle
       and s.revision = old.sla_snapshot_revision;
    select * into v_new_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = new.tenant_id
       and s.work_item_id = new.id
       and s.sla_cycle = new.sla_cycle
       and s.revision = new.sla_snapshot_revision;
    if v_old_sla.revision is null or v_new_sla.revision is null then
      raise exception 'WorkItem mutation must retain exact OLD and NEW SLA snapshots'
        using errcode = '23514';
    end if;
    if v_transition.kind = 'sla_refresh' then
      if new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_old_sla.kind <> 'tracked'
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.input_revision < v_old_sla.input_revision
         or (v_old_sla.first_human_response_at is not null and
           v_new_sla.first_human_response_at is distinct from
             v_old_sla.first_human_response_at) then
        raise exception 'SLA refresh must advance one tracked SLA snapshot revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind not in (
      'close_resolved',
      'close_dismissed',
      'reopen_unassigned',
      'reopen_assigned'
    ) and (
      new.sla_cycle <> old.sla_cycle
      or new.sla_snapshot_revision <> old.sla_snapshot_revision
    ) then
      raise exception 'This WorkItem transition cannot mutate SLA'
        using errcode = '23514';
    end if;
    if (
         new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision
       )
       and (
         v_new_sla.calculated_at <> new.updated_at
         or v_new_sla.created_at <> new.updated_at
       ) then
      raise exception 'New WorkItem SLA snapshot must be recorded at transition time'
        using errcode = '23514';
    end if;
    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_old_sla.kind = 'not_applied' then
        if new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision then
          raise exception 'Terminal close cannot synthesize an absent SLA'
            using errcode = '23514';
        end if;
      elsif new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.clock_state <> 'stopped'
         or v_new_sla.stopped_at <> new.updated_at then
        raise exception 'Terminal close must append the exact stopped SLA revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.last_reopen_snapshot ->> 'slaMode' = 'new_cycle' then
        select * into v_destination_queue
          from public.inbox_v2_work_queue_versions q
         where q.tenant_id = v_transition.tenant_id
           and q.work_queue_id = v_transition.destination_queue_id
           and q.revision = v_transition.destination_queue_revision;
        if v_destination_queue.revision is null
           or new.sla_cycle <> old.sla_cycle + 1
           or new.sla_snapshot_revision <> 1
           or v_new_sla.kind <> v_destination_queue.default_sla_kind
           or (
             v_destination_queue.default_sla_kind = 'tracked'
             and (
               v_new_sla.policy_id <>
                  v_destination_queue.default_sla_policy_id
               or v_new_sla.policy_version <>
                  v_destination_queue.default_sla_policy_version
               or v_new_sla.policy_revision <>
                  v_destination_queue.default_sla_policy_revision
               or v_new_sla.input_revision <> 1
               or v_new_sla.business_calendar_id <>
                  v_destination_queue.default_business_calendar_id
               or v_new_sla.business_calendar_version <>
                  v_destination_queue.default_business_calendar_version
               or v_new_sla.business_calendar_revision <>
                  v_destination_queue.default_business_calendar_revision
               or v_new_sla.time_zone <>
                  v_destination_queue.default_sla_time_zone
               or v_new_sla.clock_state <> 'running'
               or v_new_sla.started_at <> new.updated_at
               or v_new_sla.paused_at is not null
               or v_new_sla.pause_condition_id is not null
               or v_new_sla.stopped_at is not null
               or v_new_sla.first_human_response_at is not null
             )
           ) then
          raise exception 'New-cycle reopen must reset SLA to exact destination Queue defaults'
            using errcode = '23514';
        end if;
      elsif new.last_reopen_snapshot ->> 'slaMode' = 'resume_remaining' then
        if v_old_sla.kind = 'not_applied' then
          if new.sla_cycle <> old.sla_cycle
             or new.sla_snapshot_revision <>
                old.sla_snapshot_revision then
            raise exception 'Resume cannot invent an SLA absent from the prior cycle'
              using errcode = '23514';
          end if;
        elsif new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
           or v_new_sla.kind <> 'tracked'
           or v_new_sla.policy_id <> v_old_sla.policy_id
           or v_new_sla.policy_version <> v_old_sla.policy_version
           or v_new_sla.policy_revision <> v_old_sla.policy_revision
           or v_new_sla.business_calendar_id <>
              v_old_sla.business_calendar_id
           or v_new_sla.business_calendar_version <>
              v_old_sla.business_calendar_version
           or v_new_sla.business_calendar_revision <>
              v_old_sla.business_calendar_revision
           or v_new_sla.time_zone <> v_old_sla.time_zone
           or v_new_sla.started_at <> v_old_sla.started_at
           or v_new_sla.clock_state = 'stopped' then
          raise exception 'Resume reopen must append one non-stopped SLA revision in the same cycle'
            using errcode = '23514';
        end if;
      else
        raise exception 'Reopen snapshot must select new_cycle or resume_remaining SLA mode'
          using errcode = '23514';
      end if;
    end if;
    if v_new_sla.kind = 'tracked' and (
      (new.state in ('resolved', 'dismissed') and
        v_new_sla.clock_state <> 'stopped')
      or (new.state in ('new', 'assigned', 'in_progress', 'waiting') and
        v_new_sla.clock_state = 'stopped')
    ) then
      raise exception 'Every WorkItem mutation must retain lifecycle-correct SLA clock state'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.reopen_cycle <> old.reopen_cycle + 1
         or new.last_reopen_snapshot is not distinct from
            old.last_reopen_snapshot
         or old.terminal_snapshot is null
         or new.terminal_snapshot is not null then
        raise exception 'Reopen must advance exact cycle and snapshot fields'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('close_resolved', 'close_dismissed') then
      if new.reopen_cycle <> old.reopen_cycle
         or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
         or old.terminal_snapshot is not null
         or new.terminal_snapshot is null then
        raise exception 'Terminal close must preserve reopen history and append terminal snapshot'
          using errcode = '23514';
      end if;
    elsif new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Only terminal close or reopen may mutate lifecycle snapshots'
        using errcode = '23514';
    end if;

    if new.collaborator_set_revision <> old.collaborator_set_revision then
      raise exception 'Lifecycle transition cannot mutate collaborator-set revision'
        using errcode = '23514';
    end if;

    v_expected_access_revision := old.resource_access_revision;
    if new.current_primary_assignment_id is distinct from
         old.current_primary_assignment_id
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or old.state in ('resolved', 'dismissed')
       or new.state in ('resolved', 'dismissed') then
      v_expected_access_revision := v_expected_access_revision + 1;
    end if;
    if new.resource_access_revision <> v_expected_access_revision then
      raise exception 'WorkItem mutation has an invalid resource-access revision step'
        using errcode = '23514';
    end if;
  else
    select * into strict v_relation
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = new.tenant_id
       and r.work_item_id = new.id
       and r.resulting_work_item_revision = new.revision;

    if v_relation.expected_work_item_revision <> old.revision
       or v_relation.resulting_work_item_revision <> new.revision
       or v_relation.occurred_at <> new.updated_at
       or v_relation.expected_relation_revision <>
          old.servicing_team_relation_revision
       or v_relation.resulting_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'Servicing-team relation proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;
    if old.state in ('resolved', 'dismissed')
       or new.state <> old.state
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or new.priority_id <> old.priority_id
       or new.sla_cycle <> old.sla_cycle
       or new.sla_snapshot_revision <> old.sla_snapshot_revision
       or new.current_primary_assignment_id is distinct from
          old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
          old.last_primary_assignment_id
       or new.collaborator_set_revision <> old.collaborator_set_revision
       or new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Servicing-team relation command mutated an unrelated WorkItem field'
        using errcode = '23514';
    end if;
    if new.resource_access_revision <> old.resource_access_revision + 1 then
      raise exception 'Servicing-team relation command must advance resource access once'
        using errcode = '23514';
    end if;

    if v_relation.previous_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.previous_episode_id;
      if old.current_servicing_team_episode_id is distinct from
           v_relation.previous_episode_id
         or old.current_servicing_team_id is distinct from
           v_previous_team_id then
        raise exception 'Servicing-team relation command did not close the exact OLD head'
          using errcode = '23514';
      end if;
    elsif old.current_servicing_team_episode_id is not null
       or old.current_servicing_team_id is not null then
      raise exception 'Servicing-team add requires an empty OLD relation head'
        using errcode = '23514';
    end if;

    if v_relation.next_episode_id is not null then
      select e.team_id into strict v_next_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.next_episode_id;
      if new.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or new.current_servicing_team_id is distinct from v_next_team_id
         or new.last_servicing_team_episode_id is distinct from
           v_relation.next_episode_id then
        raise exception 'Servicing-team relation command did not open the exact NEW head'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is not null
       or new.current_servicing_team_id is not null
       or new.last_servicing_team_episode_id is distinct from
          v_relation.previous_episode_id then
      raise exception 'Servicing-team removal did not induce the exact NEW head'
        using errcode = '23514';
    end if;
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_work_item_mutation_coherence_constraint
after update on public.inbox_v2_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_mutation_coherence();

create constraint trigger inbox_v2_work_items_aggregate_constraint
after insert or update on public.inbox_v2_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_sla_aggregate_constraint
after insert on public.inbox_v2_work_item_sla_snapshots
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_creation_aggregate_constraint
after insert on public.inbox_v2_work_item_creation_decisions
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_assignment_aggregate_constraint
after insert or update on public.inbox_v2_work_item_primary_assignments
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_transition_aggregate_constraint
after insert on public.inbox_v2_work_item_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_team_episode_aggregate_constraint
after insert or update on public.inbox_v2_work_item_servicing_team_episodes
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create constraint trigger inbox_v2_work_relation_transition_aggregate_constraint
after insert on public.inbox_v2_work_item_relation_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_work_item_aggregate_coherence();

create or replace function public.inbox_v2_conversation_work_item_slot_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_conversation_id text;
  v_slot public.inbox_v2_conversation_work_item_slots%rowtype;
  v_latest public.inbox_v2_work_items%rowtype;
  v_max_ordinal bigint;
  v_min_ordinal bigint;
  v_work_item_count bigint;
  v_expected_fence_revision bigint;
  v_expected_slot_revision bigint;
  v_creation_count bigint;
  v_lifecycle_change_count bigint;
  v_expected_class public.inbox_v2_work_item_lifecycle_class;
  v_non_terminal_count bigint;
  v_non_terminal_id text;
  v_non_terminal_ordinal bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'inbox_v2_conversation_work_item_slots'
     or tg_table_name = 'inbox_v2_work_items' then
    v_conversation_id := new.conversation_id;
  else
    select w.conversation_id into v_conversation_id
      from public.inbox_v2_work_items w
     where w.tenant_id = new.tenant_id and w.id = new.work_item_id;
  end if;

  select * into v_slot
    from public.inbox_v2_conversation_work_item_slots s
   where s.tenant_id = v_tenant_id
     and s.conversation_id = v_conversation_id;
  if not found then
    raise exception 'Conversation with WorkItems requires one bootstrap slot'
      using errcode = '23514';
  end if;

  select count(*), min(w.ordinal), max(w.ordinal)
    into v_work_item_count, v_min_ordinal, v_max_ordinal
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id
     and w.conversation_id = v_conversation_id;

  select count(*) into v_creation_count
    from public.inbox_v2_work_item_creation_decisions d
    join public.inbox_v2_work_items w
      on w.tenant_id = d.tenant_id and w.id = d.work_item_id
   where w.tenant_id = v_tenant_id
     and w.conversation_id = v_conversation_id;
  select count(*) into v_lifecycle_change_count
    from public.inbox_v2_work_item_transitions t
    join public.inbox_v2_work_items w
      on w.tenant_id = t.tenant_id and w.id = t.work_item_id
   where w.tenant_id = v_tenant_id
     and w.conversation_id = v_conversation_id
     and t.kind in (
       'close_resolved',
       'close_dismissed',
       'reopen_unassigned',
       'reopen_assigned'
     );
  v_expected_slot_revision :=
    1 + v_creation_count + v_lifecycle_change_count;
  if v_slot.revision <> v_expected_slot_revision then
    raise exception 'Conversation WorkItem slot revision is missing a create/close/reopen CAS'
      using errcode = '23514';
  end if;

  if v_max_ordinal is null then
    if v_slot.latest_ordinal <> 0
       or v_slot.latest_work_item_id is not null
       or v_slot.latest_lifecycle_class is not null
       or v_slot.latest_lifecycle_fence_revision is not null
       or v_slot.current_non_terminal_work_item_id is not null
       or v_slot.current_non_terminal_ordinal is not null then
      raise exception 'Never-work Conversation slot must remain empty'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_min_ordinal <> 1 or v_work_item_count <> v_max_ordinal then
    raise exception 'Conversation WorkItem ordinals must be contiguous from one'
      using errcode = '23514';
  end if;

  select * into v_latest
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id
     and w.conversation_id = v_conversation_id
     and w.ordinal = v_max_ordinal;
  select
    count(*),
    max(w.id),
    max(w.ordinal)
    into v_non_terminal_count, v_non_terminal_id, v_non_terminal_ordinal
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id
     and w.conversation_id = v_conversation_id
     and w.state in ('new', 'assigned', 'in_progress', 'waiting');
  v_expected_class := case
    when v_latest.state in ('resolved', 'dismissed') then 'terminal'
    else 'non_terminal'
  end;
  select coalesce(max(t.resulting_revision), 1)
    into v_expected_fence_revision
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_latest.tenant_id
     and t.work_item_id = v_latest.id
     and t.kind in (
       'close_resolved',
       'close_dismissed',
       'reopen_unassigned',
       'reopen_assigned'
     );

  if v_slot.latest_ordinal <> v_latest.ordinal
     or v_slot.latest_work_item_id <> v_latest.id
     or v_slot.latest_lifecycle_class <> v_expected_class
     or v_slot.latest_lifecycle_fence_revision <> v_expected_fence_revision then
    raise exception 'Conversation WorkItem slot latest pointer is not the max ordinal lifecycle fence'
      using errcode = '23514';
  end if;

  if v_expected_class = 'non_terminal' then
    if v_non_terminal_count <> 1
       or v_non_terminal_id <> v_latest.id
       or v_non_terminal_ordinal <> v_latest.ordinal
       or v_slot.current_non_terminal_work_item_id <> v_latest.id
       or v_slot.current_non_terminal_ordinal <> v_latest.ordinal then
      raise exception 'Latest non-terminal WorkItem must occupy the current slot'
        using errcode = '23514';
    end if;
  elsif v_non_terminal_count <> 0
     or v_slot.current_non_terminal_work_item_id is not null
     or v_slot.current_non_terminal_ordinal is not null then
    raise exception 'Older WorkItem cannot become non-terminal behind a terminal latest slot'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_work_item_slots_coherence_constraint
after insert or update on public.inbox_v2_conversation_work_item_slots
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_work_item_slot_coherence();

create constraint trigger inbox_v2_work_items_slot_coherence_constraint
after insert or update on public.inbox_v2_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_work_item_slot_coherence();

create constraint trigger inbox_v2_work_creation_slot_coherence_constraint
after insert on public.inbox_v2_work_item_creation_decisions
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_work_item_slot_coherence();

create constraint trigger inbox_v2_work_transition_slot_coherence_constraint
after insert on public.inbox_v2_work_item_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_work_item_slot_coherence();
`;
