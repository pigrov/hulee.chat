import {
  classifyInboxV2WorkItemClaimConflict,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2ConversationIdSchema,
  inboxV2EmployeeAssignmentEligibilityFenceSchema,
  inboxV2EmployeeIdSchema,
  inboxV2EntityRevisionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  inboxV2WorkItemAssignmentHistoryPageSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemPrimaryAssignmentSchema,
  inboxV2WorkItemPrimaryAssignmentIdSchema,
  inboxV2WorkActorSchema,
  inboxV2WorkItemRelationAggregateHeadSchema,
  inboxV2WorkItemRelationTransitionSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkItemServicingTeamCommitSchema,
  inboxV2WorkItemServicingTeamEpisodeSchema,
  inboxV2WorkItemTransitionCommitSchema,
  inboxV2WorkItemTransitionSchema,
  inboxV2WorkQueueIdSchema,
  inboxV2WorkQueueSchema,
  type InboxV2ConversationWorkItemSlot,
  type InboxV2ConversationId,
  type InboxV2EmployeeAssignmentEligibilityFence,
  type InboxV2EmployeeId,
  type InboxV2EntityRevision,
  type InboxV2TenantId,
  type InboxV2WorkItem,
  type InboxV2WorkItemCreationCommit,
  type InboxV2WorkItemId,
  type InboxV2WorkItemPrimaryAssignment,
  type InboxV2WorkItemRelationAggregateHead,
  type InboxV2WorkItemRelationTransition,
  type InboxV2WorkItemServicingTeamCommit,
  type InboxV2WorkItemServicingTeamEpisode,
  type InboxV2WorkItemTransition,
  type InboxV2WorkItemTransitionCommit,
  type InboxV2WorkQueue,
  type InboxV2WorkQueueId
} from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import { InboxV2PersistenceInvariantError } from "./sql-inbox-v2-conversation-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const WORK_ITEM_TRANSACTION_CONFIG = {
  isolationLevel: "read committed"
} as const;
const WORK_ITEM_SNAPSHOT_TRANSACTION_CONFIG = {
  isolationLevel: "repeatable read"
} as const;
const WORK_ITEM_TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;
const ASSIGNMENT_HISTORY_PAGE_MAX = 128;
const RECOVERY_CANDIDATE_PAGE_MAX = 128;
const CREATION_RACE_CONSTRAINTS = new Set([
  "inbox_v2_work_items_pk",
  "inbox_v2_work_items_conversation_ordinal_unique",
  "inbox_v2_work_items_non_terminal_unique",
  "inbox_v2_conversation_work_item_slots_pk",
  "inbox_v2_conversation_work_item_slots_conversation_unique",
  "inbox_v2_work_item_creation_decisions_pk",
  "inbox_v2_work_item_creation_slot_unique"
]);
const TRANSITION_RACE_CONSTRAINTS = new Set([
  "inbox_v2_work_item_transitions_pk",
  "inbox_v2_work_item_transitions_expected_unique",
  "inbox_v2_work_item_transitions_resulting_unique",
  "inbox_v2_work_queue_eligibility_decisions_pk",
  "inbox_v2_work_queue_eligibility_exact_unique",
  "inbox_v2_work_item_primary_assignments_pk",
  "inbox_v2_work_item_primary_assignment_active_unique",
  "inbox_v2_work_item_sla_snapshots_pk"
]);
const SERVICING_TEAM_RACE_CONSTRAINTS = new Set([
  "inbox_v2_work_item_relation_transitions_pk",
  "inbox_v2_work_item_relation_transition_expected_unique",
  "inbox_v2_work_item_relation_transition_result_unique",
  "inbox_v2_work_item_servicing_team_episodes_pk",
  "inbox_v2_work_item_servicing_team_active_unique"
]);

export type InboxV2WorkItemAssignmentHistoryPage = ReturnType<
  typeof inboxV2WorkItemAssignmentHistoryPageSchema.parse
>;

export type InboxV2WorkItemTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config: Readonly<{
      isolationLevel: "read committed" | "repeatable read";
    }>
  ): Promise<TResult>;
};

export type PersistInboxV2WorkQueueSnapshotResult =
  | Readonly<{ kind: "persisted" | "already_exists"; queue: InboxV2WorkQueue }>
  | Readonly<{
      kind: "revision_conflict" | "identity_conflict";
      current: InboxV2WorkQueue | null;
    }>
  | Readonly<{ kind: "queue_not_found" }>;

export type AdvanceInboxV2EmployeeAssignmentFenceInput = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  expectedRevision: InboxV2EntityRevision | null;
  next: InboxV2EmployeeAssignmentEligibilityFence;
  reasonId: string;
  changedByTrustedServiceId: string;
}>;

export type AdvanceInboxV2EmployeeAssignmentFenceResult =
  | Readonly<{
      kind: "advanced" | "already_applied";
      fence: InboxV2EmployeeAssignmentEligibilityFence;
    }>
  | Readonly<{
      kind: "revision_conflict" | "state_conflict";
      current: InboxV2EmployeeAssignmentEligibilityFence | null;
    }>
  | Readonly<{ kind: "employee_not_found" }>;

export type InboxV2WorkItemPersistenceConflictCode =
  | "revision.conflict"
  | "work.responsibility_conflict"
  | "work.state_conflict"
  | "work.assignee_ineligible";

export type PersistInboxV2WorkItemCreationResult<TResult = undefined> =
  | Readonly<{
      kind: "created";
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
    }>
  | Readonly<{
      kind: "conflict";
      code: "revision.conflict" | "work.state_conflict";
      currentWorkItem: InboxV2WorkItem | null;
      currentSlot: InboxV2ConversationWorkItemSlot | null;
    }>
  | Readonly<{ kind: "conversation_not_found" | "queue_not_found" }>;

export type PersistInboxV2WorkItemTransitionResult<TResult = undefined> =
  | Readonly<{
      kind: "applied";
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
      transition: InboxV2WorkItemTransition;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
      transition: InboxV2WorkItemTransition;
    }>
  | Readonly<{
      kind: "conflict";
      code: InboxV2WorkItemPersistenceConflictCode;
      currentWorkItem: InboxV2WorkItem;
    }>
  | Readonly<{ kind: "work_item_not_found" | "queue_not_found" }>;

export type PersistInboxV2WorkItemServicingTeamResult<TResult = undefined> =
  | Readonly<{
      kind: "applied";
      head: InboxV2WorkItemRelationAggregateHead;
      transition: InboxV2WorkItemRelationTransition;
      result: TResult;
    }>
  | Readonly<{
      kind: "already_applied";
      head: InboxV2WorkItemRelationAggregateHead;
      transition: InboxV2WorkItemRelationTransition;
    }>
  | Readonly<{
      kind: "conflict";
      code: "revision.conflict" | "work.state_conflict";
      currentHead: InboxV2WorkItemRelationAggregateHead;
    }>
  | Readonly<{ kind: "work_item_not_found" | "team_not_found" }>;

export type ListInboxV2WorkItemAssignmentHistoryInput = Readonly<{
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  cursor?: string | null;
  limit?: number;
}>;

export type InboxV2WorkItemRecoveryCandidate = Readonly<{
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  workItemRevision: InboxV2EntityRevision;
  assignmentId: string;
  assignmentRevision: InboxV2EntityRevision;
  employeeId: InboxV2EmployeeId;
  assignmentFenceGenerationAtStart: InboxV2EntityRevision;
  employeeFence: InboxV2EmployeeAssignmentEligibilityFence;
}>;

export type ListInboxV2WorkItemRecoveryCandidatesInput = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  afterWorkItemId?: InboxV2WorkItemId | null;
  limit?: number;
}>;

export type InboxV2WorkItemRepository = Readonly<{
  persistQueueSnapshot(
    queue: InboxV2WorkQueue
  ): Promise<PersistInboxV2WorkQueueSnapshotResult>;
  findCurrentQueueSnapshot(input: {
    tenantId: InboxV2TenantId;
    workQueueId: InboxV2WorkQueueId;
  }): Promise<InboxV2WorkQueue | null>;
  advanceEmployeeFence(
    input: AdvanceInboxV2EmployeeAssignmentFenceInput
  ): Promise<AdvanceInboxV2EmployeeAssignmentFenceResult>;
  findEmployeeFence(input: {
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
  }): Promise<InboxV2EmployeeAssignmentEligibilityFence | null>;
  findWorkItemById(input: {
    tenantId: InboxV2TenantId;
    workItemId: InboxV2WorkItemId;
  }): Promise<InboxV2WorkItem | null>;
  findSlotByConversation(input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
  }): Promise<InboxV2ConversationWorkItemSlot | null>;
  createWorkItem(
    commit: InboxV2WorkItemCreationCommit
  ): Promise<PersistInboxV2WorkItemCreationResult>;
  withCreationCommit<TResult>(
    commit: InboxV2WorkItemCreationCommit,
    persist: (context: {
      executor: RawSqlExecutor;
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
    }) => Promise<TResult>
  ): Promise<PersistInboxV2WorkItemCreationResult<TResult>>;
  applyTransition(
    commit: InboxV2WorkItemTransitionCommit
  ): Promise<PersistInboxV2WorkItemTransitionResult>;
  withTransitionCommit<TResult>(
    commit: InboxV2WorkItemTransitionCommit,
    persist: (context: {
      executor: RawSqlExecutor;
      workItem: InboxV2WorkItem;
      slot: InboxV2ConversationWorkItemSlot;
      transition: InboxV2WorkItemTransition;
    }) => Promise<TResult>
  ): Promise<PersistInboxV2WorkItemTransitionResult<TResult>>;
  applyServicingTeamCommit(
    commit: InboxV2WorkItemServicingTeamCommit
  ): Promise<PersistInboxV2WorkItemServicingTeamResult>;
  withServicingTeamCommit<TResult>(
    commit: InboxV2WorkItemServicingTeamCommit,
    persist: (context: {
      executor: RawSqlExecutor;
      head: InboxV2WorkItemRelationAggregateHead;
      transition: InboxV2WorkItemRelationTransition;
    }) => Promise<TResult>
  ): Promise<PersistInboxV2WorkItemServicingTeamResult<TResult>>;
  listAssignmentHistory(
    input: ListInboxV2WorkItemAssignmentHistoryInput
  ): Promise<InboxV2WorkItemAssignmentHistoryPage | null>;
  listRecoveryCandidates(
    input: ListInboxV2WorkItemRecoveryCandidatesInput
  ): Promise<readonly InboxV2WorkItemRecoveryCandidate[]>;
}>;

type IdRow = { id: unknown };
type QueueHeadRow = { current_revision: unknown };
type QueueVersionRow = {
  tenant_id: unknown;
  work_queue_id: unknown;
  revision: unknown;
  owner_org_unit_id: unknown;
  lifecycle: unknown;
  eligibility_policy_id: unknown;
  eligibility_policy_version: unknown;
  eligibility_policy_revision: unknown;
  external_reply_policy_mode: unknown;
  external_reply_policy_version: unknown;
  external_reply_policy_revision: unknown;
  default_priority_id: unknown;
  default_sla_kind: unknown;
  default_sla_policy_id: unknown;
  default_sla_policy_version: unknown;
  default_sla_policy_revision: unknown;
  default_business_calendar_id: unknown;
  default_business_calendar_version: unknown;
  default_business_calendar_revision: unknown;
  default_sla_time_zone: unknown;
  resource_access_revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type EmployeeFenceHeadRow = {
  state: unknown;
  current_generation: unknown;
  current_revision: unknown;
  effective_from: unknown;
  loaded_at: unknown;
};
type EmployeeFenceVersionRow = {
  tenant_id: unknown;
  employee_id: unknown;
  revision: unknown;
  generation: unknown;
  state: unknown;
  effective_from: unknown;
  recorded_at: unknown;
  reason_id: unknown;
  changed_by_trusted_service_id: unknown;
  loaded_at?: unknown;
};
type LockedEmployeeFenceRow = EmployeeFenceHeadRow & {
  employee_id: unknown;
};
type WorkItemRow = {
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  ordinal: unknown;
  state: unknown;
  queue_id: unknown;
  queue_revision: unknown;
  priority_id: unknown;
  sla_cycle: unknown;
  sla_snapshot_revision: unknown;
  current_primary_assignment_id: unknown;
  last_primary_assignment_id: unknown;
  current_servicing_team_episode_id: unknown;
  current_servicing_team_id: unknown;
  last_servicing_team_episode_id: unknown;
  servicing_team_relation_revision: unknown;
  collaborator_set_revision: unknown;
  resource_access_revision: unknown;
  reopen_cycle: unknown;
  last_reopen_snapshot: unknown;
  terminal_snapshot: unknown;
  created_actor_kind: unknown;
  created_actor_employee_id: unknown;
  created_actor_authorization_epoch: unknown;
  created_actor_trusted_service_id: unknown;
  creation_reason_id: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type WorkItemSlotRow = {
  tenant_id: unknown;
  id: unknown;
  conversation_id: unknown;
  latest_ordinal: unknown;
  latest_work_item_id: unknown;
  latest_lifecycle_class: unknown;
  latest_lifecycle_fence_revision: unknown;
  current_non_terminal_work_item_id: unknown;
  current_non_terminal_ordinal: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type WorkItemSlaRow = {
  tenant_id: unknown;
  work_item_id: unknown;
  sla_cycle: unknown;
  revision: unknown;
  kind: unknown;
  absence_reason_id: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_revision: unknown;
  input_revision: unknown;
  business_calendar_id: unknown;
  business_calendar_version: unknown;
  business_calendar_revision: unknown;
  time_zone: unknown;
  clock_state: unknown;
  started_at: unknown;
  paused_at: unknown;
  pause_condition_id: unknown;
  stopped_at: unknown;
  first_human_response_due_at: unknown;
  resolution_due_at: unknown;
  first_human_response_at: unknown;
  calculated_at: unknown;
  created_at: unknown;
};
type WorkItemSlaPointer = Readonly<{
  slaCycle: bigint;
  slaSnapshotRevision: bigint;
}>;
type EligibilityDecisionRow = {
  decision_tenant_id: unknown;
  decision_id: unknown;
  decision_work_item_id: unknown;
  expected_work_item_revision: unknown;
  decision_work_queue_id: unknown;
  decision_work_queue_revision: unknown;
  work_queue_lifecycle: unknown;
  decision_employee_id: unknown;
  employee_fence_revision: unknown;
  employee_fence_generation: unknown;
  employee_fence_state: unknown;
  employee_fence_effective_from: unknown;
  employee_fence_loaded_at: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_revision: unknown;
  eligibility_basis: unknown;
  eligibility_evidence_revision: unknown;
  effect: unknown;
  decision_reason_id: unknown;
  decision_revision: unknown;
  loaded_by_trusted_service_id: unknown;
  decided_at: unknown;
  not_after: unknown;
};
type AssignmentRow = EligibilityDecisionRow & {
  assignment_tenant_id: unknown;
  assignment_id: unknown;
  assignment_work_item_id: unknown;
  queue_at_start_id: unknown;
  queue_at_start_revision: unknown;
  assignment_employee_id: unknown;
  source: unknown;
  eligibility_decision_id: unknown;
  employee_fence_generation_at_start: unknown;
  started_at: unknown;
  started_actor_kind: unknown;
  started_actor_employee_id: unknown;
  started_actor_authorization_epoch: unknown;
  started_actor_trusted_service_id: unknown;
  start_reason_id: unknown;
  assignment_state: unknown;
  ended_at: unknown;
  end_recorded_at: unknown;
  end_basis: unknown;
  ended_actor_kind: unknown;
  ended_actor_employee_id: unknown;
  ended_actor_authorization_epoch: unknown;
  ended_actor_trusted_service_id: unknown;
  end_reason_id: unknown;
  termination_transition_id: unknown;
  end_employee_fence_revision: unknown;
  end_employee_fence_generation: unknown;
  end_employee_fence_state: unknown;
  end_employee_fence_effective_from: unknown;
  end_employee_fence_loaded_at: unknown;
  assignment_revision: unknown;
  assignment_created_at: unknown;
  assignment_updated_at: unknown;
};
type WorkItemTransitionRow = {
  tenant_id: unknown;
  id: unknown;
  work_item_id: unknown;
  kind: unknown;
  from_state: unknown;
  to_state: unknown;
  source_queue_id: unknown;
  source_queue_revision: unknown;
  destination_queue_id: unknown;
  destination_queue_revision: unknown;
  actor_kind: unknown;
  actor_employee_id: unknown;
  actor_authorization_epoch: unknown;
  actor_trusted_service_id: unknown;
  reason_id: unknown;
  expected_revision: unknown;
  resulting_revision: unknown;
  expected_servicing_team_relation_revision?: unknown;
  resulting_servicing_team_relation_revision?: unknown;
  closed_servicing_team_episode_id?: unknown;
  closed_primary_assignment_id?: unknown;
  opened_primary_assignment_id?: unknown;
  occurred_at: unknown;
  canonical_commit?: unknown;
};
type WorkItemCreationDecisionRow = {
  tenant_id: unknown;
  work_item_id: unknown;
  conversation_id: unknown;
  transport: unknown;
  policy_id: unknown;
  policy_version: unknown;
  policy_revision: unknown;
  decision_revision: unknown;
  decided_by_trusted_service_id: unknown;
  decided_at: unknown;
  work_queue_id: unknown;
  work_queue_revision: unknown;
  latest_terminal_handling: unknown;
  reason_id: unknown;
  slot_before_revision: unknown;
  slot_after_revision: unknown;
  canonical_commit: unknown;
};
type WorkItemRelationTransitionRow = {
  tenant_id: unknown;
  id: unknown;
  work_item_id: unknown;
  kind: unknown;
  actor_kind: unknown;
  actor_employee_id: unknown;
  actor_authorization_epoch: unknown;
  actor_trusted_service_id: unknown;
  reason_id: unknown;
  expected_work_item_revision: unknown;
  resulting_work_item_revision: unknown;
  expected_relation_revision: unknown;
  resulting_relation_revision: unknown;
  previous_episode_id: unknown;
  next_episode_id: unknown;
  occurred_at: unknown;
  canonical_commit: unknown;
};
type ServicingTeamEpisodeRow = {
  tenant_id: unknown;
  id: unknown;
  work_item_id: unknown;
  work_item_cycle: unknown;
  team_id: unknown;
  started_at: unknown;
  started_actor_kind: unknown;
  started_actor_employee_id: unknown;
  started_actor_authorization_epoch: unknown;
  started_actor_trusted_service_id: unknown;
  start_reason_id: unknown;
  state: unknown;
  ended_at: unknown;
  end_recorded_at: unknown;
  end_cause: unknown;
  end_relation_transition_id: unknown;
  end_work_item_transition_id: unknown;
  ended_actor_kind: unknown;
  ended_actor_employee_id: unknown;
  ended_actor_authorization_epoch: unknown;
  ended_actor_trusted_service_id: unknown;
  end_reason_id: unknown;
  revision: unknown;
  created_at: unknown;
  updated_at: unknown;
};
type RecoveryCandidateRow = {
  tenant_id: unknown;
  work_item_id: unknown;
  work_item_revision: unknown;
  assignment_id: unknown;
  assignment_revision: unknown;
  employee_id: unknown;
  employee_fence_generation_at_start: unknown;
  fence_state: unknown;
  fence_generation: unknown;
  fence_revision: unknown;
  fence_effective_from: unknown;
  fence_loaded_at: unknown;
};

export function createSqlInboxV2WorkItemRepository(
  executor: InboxV2WorkItemTransactionExecutor | HuleeDatabase
): InboxV2WorkItemRepository {
  const transactionExecutor =
    executor as unknown as InboxV2WorkItemTransactionExecutor;

  return {
    async persistQueueSnapshot(queueInput) {
      const queue = inboxV2WorkQueueSchema.parse(queueInput);
      return runWorkItemTransaction(transactionExecutor, (transaction) =>
        persistQueueSnapshotInTransaction(transaction, queue)
      );
    },

    async findCurrentQueueSnapshot(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const workQueueId = inboxV2WorkQueueIdSchema.parse(input.workQueueId);
      return runWorkItemSnapshotTransaction(
        transactionExecutor,
        (transaction) =>
          loadCurrentQueueSnapshot(transaction, {
            tenantId,
            workQueueId,
            lock: false
          })
      );
    },

    async advanceEmployeeFence(input) {
      const normalized = normalizeEmployeeFenceAdvance(input);
      return runWorkItemTransaction(
        transactionExecutor,
        async (transaction) => {
          const employeeResult = await transaction.execute<IdRow>(
            buildLockInboxV2WorkItemEmployeeSql(normalized)
          );
          assertAtMostOneRow(employeeResult, "Employee assignment-fence lock");
          if (employeeResult.rows.length === 0) {
            return { kind: "employee_not_found" } as const;
          }

          const current = await loadEmployeeFence(transaction, {
            tenantId: normalized.tenantId,
            employeeId: normalized.employeeId,
            lock: true,
            preserveRecordedLoadedAt: true
          });
          const existingVersion = await loadEmployeeFenceVersion(transaction, {
            tenantId: normalized.tenantId,
            employeeId: normalized.employeeId,
            revision: normalized.next.revision
          });
          if (existingVersion !== null) {
            return sameEmployeeFenceVersion(
              existingVersion.fence,
              normalized.next
            ) &&
              existingVersion.reasonId === normalized.reasonId &&
              existingVersion.changedByTrustedServiceId ===
                normalized.changedByTrustedServiceId
              ? ({
                  kind: "already_applied",
                  fence: existingVersion.fence
                } as const)
              : ({ kind: "revision_conflict", current } as const);
          }
          if (
            (current === null) !== (normalized.expectedRevision === null) ||
            (current !== null &&
              current.revision !== normalized.expectedRevision)
          ) {
            return { kind: "revision_conflict", current } as const;
          }
          if (!isValidFenceAdvance(current, normalized.next)) {
            return { kind: "state_conflict", current } as const;
          }
          if (
            current?.state === "draining" &&
            normalized.next.state === "inactive" &&
            (await hasActiveEmployeeAssignments(transaction, normalized))
          ) {
            return { kind: "state_conflict", current } as const;
          }

          await expectOneRow(
            transaction,
            buildInsertInboxV2EmployeeAssignmentFenceVersionSql(normalized),
            "Employee assignment-fence version insert"
          );
          if (current === null) {
            await expectOneRow(
              transaction,
              buildInsertInboxV2EmployeeAssignmentFenceHeadSql(normalized),
              "Employee assignment-fence head insert"
            );
          } else {
            await expectOneRow(
              transaction,
              buildAdvanceInboxV2EmployeeAssignmentFenceHeadSql(normalized),
              "Employee assignment-fence head advance"
            );
          }
          return { kind: "advanced", fence: normalized.next } as const;
        }
      );
    },

    async findEmployeeFence(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
      return loadEmployeeFence(transactionExecutor, {
        tenantId,
        employeeId,
        lock: false,
        preserveRecordedLoadedAt: false
      });
    },

    async findWorkItemById(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const workItemId = inboxV2WorkItemIdSchema.parse(input.workItemId);
      return runWorkItemSnapshotTransaction(
        transactionExecutor,
        (transaction) =>
          loadWorkItem(transaction, {
            tenantId,
            workItemId,
            lock: false
          })
      );
    },

    async findSlotByConversation(input) {
      const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
      const conversationId = inboxV2ConversationIdSchema.parse(
        input.conversationId
      );
      return loadWorkItemSlot(transactionExecutor, {
        tenantId,
        conversationId,
        lock: false
      });
    },

    async createWorkItem(commitInput) {
      return persistCreationCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemCreationCommitSchema.parse(commitInput),
        async () => undefined,
        true
      );
    },

    async withCreationCommit(commitInput, persist) {
      return persistCreationCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemCreationCommitSchema.parse(commitInput),
        persist,
        false
      );
    },

    async applyTransition(commitInput) {
      return persistTransitionCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemTransitionCommitSchema.parse(commitInput),
        async () => undefined,
        true
      );
    },

    async withTransitionCommit(commitInput, persist) {
      return persistTransitionCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemTransitionCommitSchema.parse(commitInput),
        persist,
        false
      );
    },

    async applyServicingTeamCommit(commitInput) {
      return persistServicingTeamCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemServicingTeamCommitSchema.parse(commitInput),
        async () => undefined,
        true
      );
    },

    async withServicingTeamCommit(commitInput, persist) {
      return persistServicingTeamCommitWithRaceMapping(
        transactionExecutor,
        inboxV2WorkItemServicingTeamCommitSchema.parse(commitInput),
        persist,
        false
      );
    },

    async listAssignmentHistory(input) {
      return listAssignmentHistory(transactionExecutor, input);
    },

    async listRecoveryCandidates(input) {
      return listRecoveryCandidates(transactionExecutor, input);
    }
  };
}

async function persistQueueSnapshotInTransaction(
  executor: RawSqlExecutor,
  queue: InboxV2WorkQueue
): Promise<PersistInboxV2WorkQueueSnapshotResult> {
  const queueIdentity = await executor.execute<IdRow>(
    buildLockInboxV2WorkQueueIdentitySql(queue)
  );
  assertAtMostOneRow(queueIdentity, "WorkQueue identity lock");
  if (queueIdentity.rows.length === 0) return { kind: "queue_not_found" };

  const current = await loadCurrentQueueSnapshot(executor, {
    tenantId: queue.tenantId,
    workQueueId: queue.id,
    lock: true
  });
  const exact = await loadQueueSnapshotVersion(executor, {
    tenantId: queue.tenantId,
    workQueueId: queue.id,
    revision: queue.revision
  });
  if (exact !== null) {
    if (!sameValue(exact, queue)) {
      return { kind: "identity_conflict", current };
    }
    return current?.revision === queue.revision
      ? { kind: "already_exists", queue: exact }
      : { kind: "revision_conflict", current };
  }

  const expectedRevision =
    current === null ? 1n : BigInt(current.revision) + 1n;
  if (BigInt(queue.revision) !== expectedRevision) {
    return { kind: "revision_conflict", current };
  }
  await expectOneRow(
    executor,
    buildInsertInboxV2WorkQueueVersionSql(queue),
    "WorkQueue version insert"
  );
  if (current === null) {
    await expectOneRow(
      executor,
      buildInsertInboxV2WorkQueueHeadSql(queue),
      "WorkQueue head insert"
    );
  } else {
    await expectOneRow(
      executor,
      buildAdvanceInboxV2WorkQueueHeadSql({
        queue,
        expectedRevision: current.revision
      }),
      "WorkQueue head advance"
    );
  }
  return { kind: "persisted", queue };
}

async function persistCreationCommitWithRaceMapping<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemCreationCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemCreationResult<TResult>> {
  try {
    return await persistCreationCommit(
      transactionExecutor,
      commit,
      persist,
      retrySafe
    );
  } catch (error) {
    if (!isNamedRaceViolation(error, CREATION_RACE_CONSTRAINTS)) throw error;
    return runWorkItemSnapshotTransaction(
      transactionExecutor,
      async (transaction) => {
        const slot = await loadWorkItemSlot(transaction, {
          tenantId: commit.tenantId,
          conversationId: commit.createdWorkItem.conversation.id,
          lock: false
        });
        const byId = await loadWorkItem(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.createdWorkItem.id,
          lock: false
        });
        const currentWorkItem =
          byId ??
          (slot?.currentNonTerminalWorkItem === null ||
          slot?.currentNonTerminalWorkItem === undefined
            ? null
            : await loadWorkItem(transaction, {
                tenantId: commit.tenantId,
                workItemId: slot.currentNonTerminalWorkItem.workItem.id,
                lock: false
              }));
        return {
          kind: "conflict",
          code:
            currentWorkItem === null
              ? "revision.conflict"
              : "work.state_conflict",
          currentWorkItem,
          currentSlot: slot
        } as const;
      }
    );
  }
}

async function persistTransitionCommitWithRaceMapping<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemTransitionCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
    transition: InboxV2WorkItemTransition;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemTransitionResult<TResult>> {
  try {
    return await persistTransitionCommit(
      transactionExecutor,
      commit,
      persist,
      retrySafe
    );
  } catch (error) {
    if (!isNamedRaceViolation(error, TRANSITION_RACE_CONSTRAINTS)) throw error;
    return runWorkItemSnapshotTransaction(
      transactionExecutor,
      async (transaction) => {
        const current = await loadWorkItem(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.before.id,
          lock: false
        });
        if (current === null) return { kind: "work_item_not_found" } as const;
        const winner = await loadWinningWorkItemTransition(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.before.id,
          expectedRevision: commit.before.revision
        });
        return {
          kind: "conflict",
          code:
            winner !== null && commit.transition.kind === "claim"
              ? classifyInboxV2WorkItemClaimConflict({
                  requestedWorkItem: commit.transition.workItem,
                  requestedExpectedRevision: commit.before.revision,
                  winningTransition: winner
                })
              : "revision.conflict",
          currentWorkItem: current
        } as const;
      }
    );
  }
}

async function persistServicingTeamCommitWithRaceMapping<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemServicingTeamCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    head: InboxV2WorkItemRelationAggregateHead;
    transition: InboxV2WorkItemRelationTransition;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemServicingTeamResult<TResult>> {
  try {
    return await persistServicingTeamCommit(
      transactionExecutor,
      commit,
      persist,
      retrySafe
    );
  } catch (error) {
    if (!isNamedRaceViolation(error, SERVICING_TEAM_RACE_CONSTRAINTS)) {
      throw error;
    }
    const current = await runWorkItemSnapshotTransaction(
      transactionExecutor,
      (transaction) =>
        loadWorkItem(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.before.workItem.id,
          lock: false
        })
    );
    return current === null
      ? ({ kind: "work_item_not_found" } as const)
      : ({
          kind: "conflict",
          code: "revision.conflict",
          currentHead: relationAggregateHeadOf(current)
        } as const);
  }
}

async function persistCreationCommit<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemCreationCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemCreationResult<TResult>> {
  return runWorkItemTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<IdRow>(
        buildLockInboxV2WorkItemConversationSql({
          tenantId: commit.tenantId,
          conversationId: commit.createdWorkItem.conversation.id
        })
      );
      assertAtMostOneRow(conversationLock, "WorkItem Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "conversation_not_found" } as const;
      }

      let currentSlot = await loadWorkItemSlot(transaction, {
        tenantId: commit.tenantId,
        conversationId: commit.createdWorkItem.conversation.id,
        lock: true
      });

      const existing = await loadWorkItem(transaction, {
        tenantId: commit.tenantId,
        workItemId: commit.createdWorkItem.id,
        lock: false
      });
      if (existing !== null) {
        if (currentSlot === null) {
          return {
            kind: "conflict",
            code: "revision.conflict",
            currentWorkItem: existing,
            currentSlot: null
          } as const;
        }
        const replay = await isCreationCommitReplay(
          transaction,
          commit,
          existing
        );
        return replay
          ? ({
              kind: "already_applied",
              workItem: commit.createdWorkItem,
              slot: commit.slotAfter
            } as const)
          : ({
              kind: "conflict",
              code: "work.state_conflict",
              currentWorkItem: existing,
              currentSlot
            } as const);
      }
      if (
        currentSlot === null &&
        (commit.slotBefore.latestWorkItem !== null ||
          commit.slotBefore.currentNonTerminalWorkItem !== null)
      ) {
        return {
          kind: "conflict",
          code: "revision.conflict",
          currentWorkItem: null,
          currentSlot: null
        } as const;
      }
      if (currentSlot !== null && !sameValue(currentSlot, commit.slotBefore)) {
        const currentWorkItem =
          currentSlot.currentNonTerminalWorkItem === null
            ? null
            : await loadWorkItem(transaction, {
                tenantId: commit.tenantId,
                workItemId: currentSlot.currentNonTerminalWorkItem.workItem.id,
                lock: false
              });
        return {
          kind: "conflict",
          code:
            currentSlot.currentNonTerminalWorkItem === null
              ? "revision.conflict"
              : "work.state_conflict",
          currentWorkItem,
          currentSlot
        } as const;
      }

      if (commit.previousLatestWorkItem !== null) {
        const previous = await loadWorkItem(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.previousLatestWorkItem.id,
          lock: false
        });
        if (
          previous === null ||
          !sameValue(previous, commit.previousLatestWorkItem)
        ) {
          return {
            kind: "conflict",
            code: "revision.conflict",
            currentWorkItem: previous,
            currentSlot
          } as const;
        }
      }

      const queueResult = await persistQueueSnapshotInTransaction(
        transaction,
        commit.queueSnapshot
      );
      if (queueResult.kind === "queue_not_found") {
        return { kind: "queue_not_found" } as const;
      }
      if (
        queueResult.kind === "revision_conflict" ||
        queueResult.kind === "identity_conflict"
      ) {
        return {
          kind: "conflict",
          code: "revision.conflict",
          currentWorkItem: null,
          currentSlot
        } as const;
      }

      if (currentSlot === null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2WorkItemSlotSql(commit.slotBefore),
          "Conversation WorkItem slot insert"
        );
        currentSlot = commit.slotBefore;
      }

      await expectOneRow(
        transaction,
        buildInsertInboxV2WorkItemSql(commit.createdWorkItem, {
          slaCycle: 1n,
          slaSnapshotRevision: 1n
        }),
        "WorkItem insert"
      );
      await expectOneRow(
        transaction,
        buildInsertInboxV2WorkItemSlaSnapshotSql({
          workItem: commit.createdWorkItem,
          slaCycle: 1n,
          revision: 1n,
          createdAt: commit.occurredAt
        }),
        "WorkItem SLA snapshot insert"
      );
      await expectOneRow(
        transaction,
        buildInsertInboxV2WorkItemCreationDecisionSql(commit),
        "WorkItem creation decision insert"
      );
      await expectOneRow(
        transaction,
        buildAdvanceInboxV2WorkItemSlotSql({
          before: commit.slotBefore,
          after: commit.slotAfter
        }),
        "Conversation WorkItem slot advance"
      );

      const result = await persist({
        executor: transaction,
        workItem: commit.createdWorkItem,
        slot: commit.slotAfter
      });
      return {
        kind: "created",
        workItem: commit.createdWorkItem,
        slot: commit.slotAfter,
        result
      } as const;
    },
    retrySafe ? WORK_ITEM_TRANSACTION_ATTEMPTS : 1
  );
}

async function persistTransitionCommit<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemTransitionCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    workItem: InboxV2WorkItem;
    slot: InboxV2ConversationWorkItemSlot;
    transition: InboxV2WorkItemTransition;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemTransitionResult<TResult>> {
  return runWorkItemTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationLock = await transaction.execute<IdRow>(
        buildLockInboxV2WorkItemConversationSql({
          tenantId: commit.tenantId,
          conversationId: commit.before.conversation.id
        })
      );
      assertAtMostOneRow(conversationLock, "WorkItem Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "work_item_not_found" } as const;
      }

      const currentSlot = await loadWorkItemSlot(transaction, {
        tenantId: commit.tenantId,
        conversationId: commit.before.conversation.id,
        lock: true
      });
      const current = await loadWorkItem(transaction, {
        tenantId: commit.tenantId,
        workItemId: commit.before.id,
        lock: true
      });
      if (current === null || currentSlot === null) {
        return { kind: "work_item_not_found" } as const;
      }

      const replayTransition = await loadWorkItemTransitionById(transaction, {
        tenantId: commit.tenantId,
        transitionId: commit.transition.id
      });
      if (replayTransition !== null) {
        if (
          !sameValue(replayTransition.transition, commit.transition) ||
          !sameValue(replayTransition.canonicalCommit, commit) ||
          replayTransition.expectedServicingTeamRelationRevision !==
            commit.before.servicingTeamRelationRevision ||
          replayTransition.resultingServicingTeamRelationRevision !==
            commit.after.servicingTeamRelationRevision ||
          replayTransition.closedServicingTeamEpisodeId !==
            (commit.servicingTeamEffect.kind === "close"
              ? commit.servicingTeamEffect.before.id
              : null) ||
          replayTransition.closedPrimaryAssignmentId !==
            (commit.assignmentEffect.kind === "close" ||
            commit.assignmentEffect.kind === "replace"
              ? commit.assignmentEffect.before.id
              : null) ||
          replayTransition.openedPrimaryAssignmentId !==
            (commit.assignmentEffect.kind === "open" ||
            commit.assignmentEffect.kind === "replace"
              ? commit.assignmentEffect.opened.id
              : null)
        ) {
          return {
            kind: "conflict",
            code: "revision.conflict",
            currentWorkItem: current
          } as const;
        }
        return {
          kind: "already_applied",
          workItem: commit.after,
          slot: commit.slotAfter,
          transition: replayTransition.transition
        } as const;
      }

      if (current.revision !== commit.before.revision) {
        const winner = await loadWinningWorkItemTransition(transaction, {
          tenantId: commit.tenantId,
          workItemId: commit.before.id,
          expectedRevision: commit.before.revision
        });
        return {
          kind: "conflict",
          code:
            winner === null || commit.transition.kind !== "claim"
              ? "revision.conflict"
              : classifyInboxV2WorkItemClaimConflict({
                  requestedWorkItem: commit.transition.workItem,
                  requestedExpectedRevision: commit.before.revision,
                  winningTransition: winner
                }),
          currentWorkItem: current
        } as const;
      }
      if (
        !sameValue(current, commit.before) ||
        !sameValue(currentSlot, commit.slotBefore)
      ) {
        return {
          kind: "conflict",
          code: "revision.conflict",
          currentWorkItem: current
        } as const;
      }

      const fenceConflict = await validateTransitionFences(transaction, commit);
      if (fenceConflict !== null) {
        return {
          kind: "conflict",
          code: fenceConflict,
          currentWorkItem: current
        } as const;
      }

      if (commit.destinationQueueSnapshot !== null) {
        const queueResult = await persistQueueSnapshotInTransaction(
          transaction,
          commit.destinationQueueSnapshot
        );
        if (queueResult.kind === "queue_not_found") {
          return { kind: "queue_not_found" } as const;
        }
        if (
          queueResult.kind === "revision_conflict" ||
          queueResult.kind === "identity_conflict"
        ) {
          return {
            kind: "conflict",
            code: "work.state_conflict",
            currentWorkItem: current
          } as const;
        }
      }

      if (
        commit.assignmentEffect.kind === "close" ||
        commit.assignmentEffect.kind === "replace"
      ) {
        const storedAssignment = await loadAssignmentById(transaction, {
          tenantId: commit.tenantId,
          assignmentId: commit.assignmentEffect.before.id,
          lock: true
        });
        if (!sameValue(storedAssignment, commit.assignmentEffect.before)) {
          throw invariantError(
            "WorkItem assignment close does not match the exact stored episode."
          );
        }
      }
      if (commit.servicingTeamEffect.kind === "close") {
        const storedTeamEpisode = await loadServicingTeamEpisode(transaction, {
          tenantId: commit.tenantId,
          episodeId: commit.servicingTeamEffect.before.id,
          lock: true
        });
        if (!sameValue(storedTeamEpisode, commit.servicingTeamEffect.before)) {
          throw invariantError(
            "WorkItem team close does not match the exact stored episode."
          );
        }
      }

      await expectOneRow(
        transaction,
        buildInsertInboxV2WorkItemTransitionSql(commit),
        "WorkItem transition insert"
      );

      const effect = commit.assignmentEffect;
      if (effect.kind === "open" || effect.kind === "replace") {
        await expectOneRow(
          transaction,
          buildInsertInboxV2WorkQueueEligibilityDecisionSql(
            effect.opened.eligibilityDecision
          ),
          "WorkQueue eligibility decision insert"
        );
      }
      if (effect.kind === "close" || effect.kind === "replace") {
        await expectOneRow(
          transaction,
          buildCloseInboxV2WorkItemPrimaryAssignmentSql({
            before: effect.before,
            after: effect.after
          }),
          "WorkItem primary assignment close"
        );
      }
      if (effect.kind === "open" || effect.kind === "replace") {
        await expectOneRow(
          transaction,
          buildInsertInboxV2WorkItemPrimaryAssignmentSql(effect.opened),
          "WorkItem primary assignment insert"
        );
      }

      if (commit.servicingTeamEffect.kind === "close") {
        await expectOneRow(
          transaction,
          buildCloseInboxV2WorkItemServicingTeamEpisodeSql({
            before: commit.servicingTeamEffect.before,
            after: commit.servicingTeamEffect.after
          }),
          "WorkItem servicing-team episode close"
        );
      }

      const currentSlaPointer = await loadWorkItemSlaPointer(
        transaction,
        commit.tenantId,
        commit.before.id
      );
      const slaPlan = deriveWorkItemSlaPersistencePlan(
        commit,
        currentSlaPointer
      );
      if (slaPlan.appendSnapshot) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2WorkItemSlaSnapshotSql({
            workItem: commit.after,
            slaCycle: slaPlan.pointer.slaCycle,
            revision: slaPlan.pointer.slaSnapshotRevision,
            createdAt: commit.transition.occurredAt
          }),
          "WorkItem SLA snapshot insert"
        );
      }

      await expectOneRow(
        transaction,
        buildAdvanceInboxV2WorkItemSql({
          before: commit.before,
          after: commit.after,
          assignmentEffect: commit.assignmentEffect,
          servicingTeamEffect: commit.servicingTeamEffect,
          slaPointer: slaPlan.pointer
        }),
        "WorkItem CAS advance"
      );
      if (!sameValue(commit.slotBefore, commit.slotAfter)) {
        await expectOneRow(
          transaction,
          buildAdvanceInboxV2WorkItemSlotSql({
            before: commit.slotBefore,
            after: commit.slotAfter
          }),
          "Conversation WorkItem slot advance"
        );
      }

      const result = await persist({
        executor: transaction,
        workItem: commit.after,
        slot: commit.slotAfter,
        transition: commit.transition
      });
      return {
        kind: "applied",
        workItem: commit.after,
        slot: commit.slotAfter,
        transition: commit.transition,
        result
      } as const;
    },
    retrySafe ? WORK_ITEM_TRANSACTION_ATTEMPTS : 1
  );
}

function deriveWorkItemSlaPersistencePlan(
  commit: InboxV2WorkItemTransitionCommit,
  current: WorkItemSlaPointer
): Readonly<{ pointer: WorkItemSlaPointer; appendSnapshot: boolean }> {
  if (
    commit.before.sla.kind === "tracked" &&
    BigInt(commit.before.sla.snapshot.revision) !== current.slaSnapshotRevision
  ) {
    throw invariantError(
      "Stored SLA revision pointer does not match the WorkItem before image."
    );
  }

  const isReopen =
    commit.transition.kind === "reopen_unassigned" ||
    commit.transition.kind === "reopen_assigned";
  if (isReopen && commit.after.lastReopen?.slaMode === "new_cycle") {
    if (current.slaCycle >= POSTGRES_BIGINT_MAX) {
      throw invariantError("WorkItem SLA cycle exceeds PostgreSQL bigint.");
    }
    const pointer = {
      slaCycle: current.slaCycle + 1n,
      slaSnapshotRevision: 1n
    } as const;
    assertTrackedSlaRevisionMatchesPointer(commit.after, pointer);
    return { pointer, appendSnapshot: true };
  }

  const appendsWithinCycle =
    commit.transition.kind === "sla_refresh" ||
    ((commit.transition.kind === "close_resolved" ||
      commit.transition.kind === "close_dismissed") &&
      commit.before.sla.kind === "tracked") ||
    (isReopen &&
      commit.after.lastReopen?.slaMode === "resume_remaining" &&
      commit.before.sla.kind === "tracked");
  if (appendsWithinCycle) {
    if (current.slaSnapshotRevision >= POSTGRES_BIGINT_MAX) {
      throw invariantError(
        "WorkItem SLA snapshot revision exceeds PostgreSQL bigint."
      );
    }
    const pointer = {
      slaCycle: current.slaCycle,
      slaSnapshotRevision: current.slaSnapshotRevision + 1n
    } as const;
    assertTrackedSlaRevisionMatchesPointer(commit.after, pointer);
    return { pointer, appendSnapshot: true };
  }

  if (!sameValue(commit.before.sla, commit.after.sla)) {
    throw invariantError(
      "WorkItem transition changed SLA without a persisted SLA snapshot."
    );
  }
  return { pointer: current, appendSnapshot: false };
}

function assertTrackedSlaRevisionMatchesPointer(
  workItem: InboxV2WorkItem,
  pointer: WorkItemSlaPointer
): void {
  if (
    workItem.sla.kind === "tracked" &&
    BigInt(workItem.sla.snapshot.revision) !== pointer.slaSnapshotRevision
  ) {
    throw invariantError(
      "Tracked SLA revision does not match the persisted SLA pointer."
    );
  }
}

async function persistServicingTeamCommit<TResult>(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  commit: InboxV2WorkItemServicingTeamCommit,
  persist: (context: {
    executor: RawSqlExecutor;
    head: InboxV2WorkItemRelationAggregateHead;
    transition: InboxV2WorkItemRelationTransition;
  }) => Promise<TResult>,
  retrySafe: boolean
): Promise<PersistInboxV2WorkItemServicingTeamResult<TResult>> {
  return runWorkItemTransaction(
    transactionExecutor,
    async (transaction) => {
      const conversationId = await loadWorkItemConversationId(transaction, {
        tenantId: commit.tenantId,
        workItemId: commit.before.workItem.id
      });
      if (conversationId === null) {
        return { kind: "work_item_not_found" } as const;
      }
      const conversationLock = await transaction.execute<IdRow>(
        buildLockInboxV2WorkItemConversationSql({
          tenantId: commit.tenantId,
          conversationId
        })
      );
      assertAtMostOneRow(conversationLock, "servicing-team Conversation lock");
      if (conversationLock.rows.length === 0) {
        return { kind: "work_item_not_found" } as const;
      }

      const currentWorkItem = await loadWorkItem(transaction, {
        tenantId: commit.tenantId,
        workItemId: commit.before.workItem.id,
        lock: true
      });
      if (currentWorkItem === null) {
        return { kind: "work_item_not_found" } as const;
      }
      const currentHead = relationAggregateHeadOf(currentWorkItem);
      const replay = await loadWorkItemRelationTransitionById(transaction, {
        tenantId: commit.tenantId,
        transitionId: commit.transition.id
      });
      if (replay !== null) {
        if (
          !sameValue(replay.transition, commit.transition) ||
          !sameValue(replay.canonicalCommit, commit)
        ) {
          return {
            kind: "conflict",
            code: "revision.conflict",
            currentHead
          } as const;
        }
        return {
          kind: "already_applied",
          head: commit.after,
          transition: replay.transition
        } as const;
      }
      if (!sameValue(currentHead, commit.before)) {
        return {
          kind: "conflict",
          code:
            currentHead.state === "resolved" ||
            currentHead.state === "dismissed"
              ? "work.state_conflict"
              : "revision.conflict",
          currentHead
        } as const;
      }

      if (commit.closed !== null) {
        const storedEpisode = await loadServicingTeamEpisode(transaction, {
          tenantId: commit.tenantId,
          episodeId: commit.closed.before.id,
          lock: true
        });
        if (!sameValue(storedEpisode, commit.closed.before)) {
          throw invariantError(
            "Servicing-team command does not close the exact stored episode."
          );
        }
      }

      const requestedTeamIds: string[] = [];
      if (commit.closed !== null) {
        requestedTeamIds.push(commit.closed.before.team.id);
      }
      if (commit.opened !== null) requestedTeamIds.push(commit.opened.team.id);
      const teamIds = Array.from(new Set(requestedTeamIds)).sort(
        comparePostgresCText
      );
      if (teamIds.length > 0) {
        const teamResult = await transaction.execute<IdRow>(
          buildLockInboxV2WorkItemTeamsSql({
            tenantId: commit.tenantId,
            teamIds
          })
        );
        if (teamResult.rows.length !== teamIds.length) {
          return { kind: "team_not_found" } as const;
        }
      }

      if (commit.closed !== null) {
        await expectOneRow(
          transaction,
          buildCloseInboxV2WorkItemServicingTeamRelationEpisodeSql({
            before: commit.closed.before,
            after: commit.closed.after
          }),
          "WorkItem servicing-team relation episode close"
        );
      }
      if (commit.opened !== null) {
        await expectOneRow(
          transaction,
          buildInsertInboxV2WorkItemServicingTeamEpisodeSql(commit.opened),
          "WorkItem servicing-team relation episode insert"
        );
      }
      await expectOneRow(
        transaction,
        buildInsertInboxV2WorkItemRelationTransitionSql(commit),
        "WorkItem servicing-team relation transition insert"
      );
      await expectOneRow(
        transaction,
        buildAdvanceInboxV2WorkItemServicingTeamSql(commit),
        "WorkItem servicing-team head CAS"
      );

      const result = await persist({
        executor: transaction,
        head: commit.after,
        transition: commit.transition
      });
      return {
        kind: "applied",
        head: commit.after,
        transition: commit.transition,
        result
      } as const;
    },
    retrySafe ? WORK_ITEM_TRANSACTION_ATTEMPTS : 1
  );
}

async function loadWorkItemConversationId(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; workItemId: InboxV2WorkItemId }
): Promise<InboxV2ConversationId | null> {
  const result = await executor.execute<{ conversation_id: unknown }>(sql`
    select conversation_id
    from inbox_v2_work_items
    where tenant_id = ${input.tenantId}
      and id = ${input.workItemId}
  `);
  assertAtMostOneRow(result, "WorkItem Conversation discovery");
  const row = result.rows[0];
  return row === undefined
    ? null
    : inboxV2ConversationIdSchema.parse(row.conversation_id);
}

function relationAggregateHeadOf(
  workItem: InboxV2WorkItem
): InboxV2WorkItemRelationAggregateHead {
  return inboxV2WorkItemRelationAggregateHeadSchema.parse({
    tenantId: workItem.tenantId,
    workItem: {
      tenantId: workItem.tenantId,
      kind: "work_item",
      id: workItem.id
    },
    state: workItem.operationalState.state,
    workItemCycle: workItem.reopenCycle,
    currentServicingTeam: workItem.currentServicingTeam,
    servicingTeamRelationRevision: workItem.servicingTeamRelationRevision,
    collaboratorSetRevision: workItem.collaboratorSetRevision,
    resourceAccessRevision: workItem.resourceAccessRevision,
    workItemRevision: workItem.revision,
    updatedAt: workItem.updatedAt
  });
}

type AssignmentHistoryCursor = Readonly<{
  version: 2;
  startedAt: string;
  expectedWorkItemRevision: InboxV2EntityRevision;
  assignmentId: string;
}>;

async function listAssignmentHistory(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  input: ListInboxV2WorkItemAssignmentHistoryInput
): Promise<InboxV2WorkItemAssignmentHistoryPage | null> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const workItemId = inboxV2WorkItemIdSchema.parse(input.workItemId);
  const limit = normalizePageLimit(
    input.limit,
    ASSIGNMENT_HISTORY_PAGE_MAX,
    "assignment history"
  );
  const cursor = decodeAssignmentHistoryCursor(input.cursor ?? null);
  return runWorkItemSnapshotTransaction(
    transactionExecutor,
    async (transaction) => {
      const workItem = await loadWorkItem(transaction, {
        tenantId,
        workItemId,
        lock: false
      });
      if (workItem === null) return null;

      const result = await transaction.execute<AssignmentRow>(
        buildListInboxV2WorkItemAssignmentHistorySql({
          tenantId,
          workItemId,
          cursor,
          limit: limit + 1
        })
      );
      const items = result.rows
        .slice(0, limit)
        .map((row) => mapAssignmentRow(row, tenantId));
      const hasMore = result.rows.length > limit;
      const last = items.at(-1);
      const nextCursor =
        hasMore && last !== undefined
          ? encodeAssignmentHistoryCursor({
              version: 2,
              startedAt: last.startedAt,
              expectedWorkItemRevision:
                last.eligibilityDecision.expectedWorkItemRevision,
              assignmentId: last.id
            })
          : null;
      const predecessorEndedAt =
        cursor === null
          ? null
          : await loadAssignmentHistoryPredecessorEndedAt(transaction, {
              tenantId,
              workItemId,
              cursor
            });

      return inboxV2WorkItemAssignmentHistoryPageSchema.parse({
        tenantId,
        workItem: { tenantId, kind: "work_item", id: workItemId },
        asOfWorkItemRevision: workItem.revision,
        predecessorEndedAt,
        items,
        nextCursor,
        hasMore
      });
    }
  );
}

export function buildListInboxV2WorkItemAssignmentHistorySql(input: {
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  cursor: AssignmentHistoryCursor | null;
  limit: number;
}): SQL {
  const cursorPredicate =
    input.cursor === null
      ? sql``
      : sql`and (
          assignment_row.started_at > ${input.cursor.startedAt}
          or (
            assignment_row.started_at = ${input.cursor.startedAt}
            and decision_row.expected_work_item_revision > ${input.cursor.expectedWorkItemRevision}
          )
          or (
            assignment_row.started_at = ${input.cursor.startedAt}
            and decision_row.expected_work_item_revision = ${input.cursor.expectedWorkItemRevision}
            and assignment_row.id collate "C" > ${input.cursor.assignmentId}
          )
        )`;
  return sql`
    ${assignmentSelectSql()}
    where assignment_row.tenant_id = ${input.tenantId}
      and assignment_row.work_item_id = ${input.workItemId}
      ${cursorPredicate}
    order by assignment_row.started_at asc,
      decision_row.expected_work_item_revision asc,
      assignment_row.id collate "C" asc
    limit ${input.limit}
  `;
}

async function loadAssignmentHistoryPredecessorEndedAt(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    workItemId: InboxV2WorkItemId;
    cursor: AssignmentHistoryCursor;
  }
): Promise<string | null> {
  const result = await executor.execute<{ ended_at: unknown }>(sql`
    select assignment_row.ended_at
    from inbox_v2_work_item_primary_assignments assignment_row
    inner join inbox_v2_work_queue_eligibility_decisions decision_row
      on decision_row.tenant_id = assignment_row.tenant_id
     and decision_row.id = assignment_row.eligibility_decision_id
    where assignment_row.tenant_id = ${input.tenantId}
      and assignment_row.work_item_id = ${input.workItemId}
      and (
        assignment_row.started_at < ${input.cursor.startedAt}
        or (
          assignment_row.started_at = ${input.cursor.startedAt}
          and decision_row.expected_work_item_revision < ${input.cursor.expectedWorkItemRevision}
        )
        or (
          assignment_row.started_at = ${input.cursor.startedAt}
          and decision_row.expected_work_item_revision = ${input.cursor.expectedWorkItemRevision}
          and assignment_row.id collate "C" <= ${input.cursor.assignmentId}
        )
      )
    order by assignment_row.started_at desc,
      decision_row.expected_work_item_revision desc,
      assignment_row.id collate "C" desc
    limit 1
  `);
  assertAtMostOneRow(result, "assignment history predecessor lookup");
  const row = result.rows[0];
  return row === undefined
    ? null
    : nullableTimestamp(row.ended_at, "assignment predecessor endedAt");
}

async function listRecoveryCandidates(
  transactionExecutor: InboxV2WorkItemTransactionExecutor,
  input: ListInboxV2WorkItemRecoveryCandidatesInput
): Promise<readonly InboxV2WorkItemRecoveryCandidate[]> {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const afterWorkItemId =
    input.afterWorkItemId === null || input.afterWorkItemId === undefined
      ? null
      : inboxV2WorkItemIdSchema.parse(input.afterWorkItemId);
  const limit = normalizePageLimit(
    input.limit,
    RECOVERY_CANDIDATE_PAGE_MAX,
    "recovery candidate"
  );
  const result = await transactionExecutor.execute<RecoveryCandidateRow>(
    buildListInboxV2WorkItemRecoveryCandidatesSql({
      tenantId,
      employeeId,
      afterWorkItemId,
      limit
    })
  );
  return result.rows.map((row) => mapRecoveryCandidateRow(row, tenantId));
}

export function buildListInboxV2WorkItemRecoveryCandidatesSql(input: {
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  afterWorkItemId: InboxV2WorkItemId | null;
  limit: number;
}): SQL {
  const cursorPredicate =
    input.afterWorkItemId === null
      ? sql``
      : sql`and work_item.id collate "C" > ${input.afterWorkItemId}`;
  return sql`
    select work_item.tenant_id, work_item.id as work_item_id,
      work_item.revision as work_item_revision,
      assignment.id as assignment_id,
      assignment.revision as assignment_revision,
      assignment.employee_id,
      assignment.employee_fence_generation_at_start,
      fence.state as fence_state,
      fence.current_generation as fence_generation,
      fence.current_revision as fence_revision,
      fence.effective_from as fence_effective_from,
      statement_timestamp() as fence_loaded_at
    from inbox_v2_work_items work_item
    inner join inbox_v2_work_item_primary_assignments assignment
      on assignment.tenant_id = work_item.tenant_id
     and assignment.id = work_item.current_primary_assignment_id
     and assignment.work_item_id = work_item.id
     and assignment.state = 'active'
    inner join inbox_v2_employee_assignment_fence_heads fence
      on fence.tenant_id = assignment.tenant_id
     and fence.employee_id = assignment.employee_id
    where work_item.tenant_id = ${input.tenantId}
      and assignment.employee_id = ${input.employeeId}
      and (
        fence.state <> 'active'
        or fence.current_generation <>
          assignment.employee_fence_generation_at_start
      )
      ${cursorPredicate}
    order by work_item.id collate "C" asc
    limit ${input.limit}
  `;
}

function mapRecoveryCandidateRow(
  row: RecoveryCandidateRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItemRecoveryCandidate {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("Recovery candidate tenant mismatch.");
  }
  const employeeId = inboxV2EmployeeIdSchema.parse(row.employee_id);
  const employee = { tenantId, kind: "employee" as const, id: employeeId };
  return {
    tenantId,
    workItemId: inboxV2WorkItemIdSchema.parse(row.work_item_id),
    workItemRevision: parseRevision(
      row.work_item_revision,
      "recovery WorkItem revision"
    ),
    assignmentId: inboxV2WorkItemPrimaryAssignmentIdSchema.parse(
      row.assignment_id
    ),
    assignmentRevision: parseRevision(
      row.assignment_revision,
      "recovery assignment revision"
    ),
    employeeId,
    assignmentFenceGenerationAtStart: parseRevision(
      row.employee_fence_generation_at_start,
      "recovery assignment fence generation"
    ),
    employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse({
      tenantId,
      employee,
      state: row.fence_state,
      generation: parseDatabaseBigint(
        row.fence_generation,
        "recovery fence generation"
      ),
      revision: parseDatabaseBigint(
        row.fence_revision,
        "recovery fence revision"
      ),
      effectiveFrom: parseTimestamp(
        row.fence_effective_from,
        "recovery fence effectiveFrom"
      ),
      loadedAt: parseTimestamp(row.fence_loaded_at, "recovery fence loadedAt")
    })
  };
}

function normalizePageLimit(
  value: number | undefined,
  maximum: number,
  label: string
): number {
  const limit = value ?? maximum;
  if (!Number.isInteger(limit) || limit < 1 || limit > maximum) {
    throw invariantError(
      `${label} limit must be an integer from 1 to ${maximum}.`
    );
  }
  return limit;
}

function encodeAssignmentHistoryCursor(
  cursor: AssignmentHistoryCursor
): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

function decodeAssignmentHistoryCursor(
  cursor: string | null
): AssignmentHistoryCursor | null {
  if (cursor === null) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8")
    ) as Record<string, unknown>;
    if (
      Object.keys(parsed).sort().join(",") !==
        "assignmentId,expectedWorkItemRevision,startedAt,version" ||
      parsed.version !== 2
    ) {
      throw new Error("cursor shape");
    }
    return {
      version: 2,
      startedAt: inboxV2TimestampSchema.parse(parsed.startedAt),
      expectedWorkItemRevision: inboxV2EntityRevisionSchema.parse(
        parsed.expectedWorkItemRevision
      ),
      assignmentId: inboxV2WorkItemPrimaryAssignmentIdSchema.parse(
        parsed.assignmentId
      )
    };
  } catch {
    throw invariantError("Assignment history cursor is invalid.");
  }
}

async function validateTransitionFences(
  executor: RawSqlExecutor,
  commit: InboxV2WorkItemTransitionCommit
): Promise<InboxV2WorkItemPersistenceConflictCode | null> {
  const source = commit.sourceResponsibility;
  const sourceEmployee =
    source === null || source.kind === "unassigned"
      ? null
      : source.kind === "effective_primary"
        ? source.effectivePrimary
        : source.storedEmployee;
  const sourceFence =
    source === null || source.kind === "unassigned"
      ? null
      : source.employeeFence;
  const opened =
    commit.assignmentEffect.kind === "open" ||
    commit.assignmentEffect.kind === "replace"
      ? commit.assignmentEffect.opened
      : null;
  const employeeIds = Array.from(
    new Set(
      [sourceEmployee?.id, opened?.employee.id].filter(
        (value): value is InboxV2EmployeeId => value !== undefined
      )
    )
  ).sort(comparePostgresCText);
  if (employeeIds.length === 0) return null;

  const result = await executor.execute<LockedEmployeeFenceRow>(
    buildLockInboxV2EmployeeAssignmentFencesSql({
      tenantId: commit.tenantId,
      employeeIds
    })
  );
  const fences = new Map<
    InboxV2EmployeeId,
    InboxV2EmployeeAssignmentEligibilityFence
  >();
  for (const row of result.rows) {
    const employeeId = inboxV2EmployeeIdSchema.parse(row.employee_id);
    if (fences.has(employeeId)) {
      throw invariantError(
        "Employee assignment-fence lock returned duplicates."
      );
    }
    fences.set(
      employeeId,
      inboxV2EmployeeAssignmentEligibilityFenceSchema.parse({
        tenantId: commit.tenantId,
        employee: {
          tenantId: commit.tenantId,
          kind: "employee",
          id: employeeId
        },
        state: row.state,
        generation: parseDatabaseBigint(
          row.current_generation,
          "Employee fence generation"
        ),
        revision: parseDatabaseBigint(
          row.current_revision,
          "Employee fence revision"
        ),
        effectiveFrom: parseTimestamp(
          row.effective_from,
          "Employee fence effectiveFrom"
        ),
        loadedAt: commit.transition.occurredAt
      })
    );
  }

  if (
    sourceEmployee !== null &&
    (sourceFence === null ||
      !sameEmployeeFenceObservation(
        fences.get(sourceEmployee.id) ?? null,
        sourceFence
      ))
  ) {
    return "work.responsibility_conflict";
  }

  if (opened !== null) {
    const decision = opened.eligibilityDecision;
    const currentFence = fences.get(opened.employee.id) ?? null;
    if (
      currentFence === null ||
      currentFence.state !== "active" ||
      !sameEmployeeFenceObservation(currentFence, decision.employeeFence) ||
      decision.effect !== "allow" ||
      decision.employeeFence.loadedAt !== commit.transition.occurredAt ||
      Date.parse(decision.employeeFence.effectiveFrom) >
        Date.parse(commit.transition.occurredAt) ||
      Date.parse(decision.notAfter) < Date.parse(commit.transition.occurredAt)
    ) {
      return "work.assignee_ineligible";
    }
  }
  return null;
}

export function buildLockInboxV2EmployeeAssignmentFencesSql(input: {
  tenantId: InboxV2TenantId;
  employeeIds: readonly InboxV2EmployeeId[];
}): SQL {
  if (input.employeeIds.length === 0) {
    throw invariantError("Employee fence lock requires at least one Employee.");
  }
  const employeeIds = [...input.employeeIds].sort(comparePostgresCText);
  return sql`
    select head_row.employee_id, head_row.state,
      head_row.current_generation, head_row.current_revision,
      head_row.effective_from, version_row.recorded_at as loaded_at
    from inbox_v2_employee_assignment_fence_heads head_row
    join inbox_v2_employee_assignment_fence_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.employee_id = head_row.employee_id
     and version_row.revision = head_row.current_revision
    where head_row.tenant_id = ${input.tenantId}
      and head_row.employee_id in (${sql.join(
        employeeIds.map((employeeId) => sql`${employeeId}`),
        sql`, `
      )})
    order by head_row.employee_id collate "C"
    for no key update of head_row
  `;
}

function sameEmployeeFenceObservation(
  current: InboxV2EmployeeAssignmentEligibilityFence | null,
  observed: InboxV2EmployeeAssignmentEligibilityFence
): boolean {
  return (
    current !== null &&
    current.tenantId === observed.tenantId &&
    current.employee.id === observed.employee.id &&
    current.state === observed.state &&
    current.generation === observed.generation &&
    current.revision === observed.revision &&
    Date.parse(current.effectiveFrom) === Date.parse(observed.effectiveFrom)
  );
}

function sameEmployeeFenceVersion(
  current: InboxV2EmployeeAssignmentEligibilityFence,
  replayed: InboxV2EmployeeAssignmentEligibilityFence
): boolean {
  return (
    sameEmployeeFenceObservation(current, replayed) &&
    Date.parse(current.loadedAt) === Date.parse(replayed.loadedAt)
  );
}

export function buildLockInboxV2WorkItemConversationSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
}): SQL {
  return sql`
    select id
    from inbox_v2_conversations
    where tenant_id = ${input.tenantId}
      and id = ${input.conversationId}
    for no key update
  `;
}

export function buildFindInboxV2WorkItemSql(input: {
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  lock: boolean;
}): SQL {
  const lock = input.lock ? sql`for update` : sql``;
  return sql`
    select tenant_id, id, conversation_id, ordinal, state, queue_id,
      queue_revision, priority_id, sla_cycle, sla_snapshot_revision,
      current_primary_assignment_id, last_primary_assignment_id,
      current_servicing_team_episode_id, current_servicing_team_id,
      last_servicing_team_episode_id, servicing_team_relation_revision,
      collaborator_set_revision, resource_access_revision, reopen_cycle,
      last_reopen_snapshot, terminal_snapshot, created_actor_kind,
      created_actor_employee_id, created_actor_authorization_epoch,
      created_actor_trusted_service_id, creation_reason_id, revision,
      created_at, updated_at
    from inbox_v2_work_items
    where tenant_id = ${input.tenantId}
      and id = ${input.workItemId}
    ${lock}
  `;
}

export function buildFindInboxV2WorkItemSlotSql(input: {
  tenantId: InboxV2TenantId;
  conversationId: InboxV2ConversationId;
  lock: boolean;
}): SQL {
  const lock = input.lock ? sql`for update` : sql``;
  return sql`
    select tenant_id, id, conversation_id, latest_ordinal,
      latest_work_item_id, latest_lifecycle_class,
      latest_lifecycle_fence_revision, current_non_terminal_work_item_id,
      current_non_terminal_ordinal, revision, created_at, updated_at
    from inbox_v2_conversation_work_item_slots
    where tenant_id = ${input.tenantId}
      and conversation_id = ${input.conversationId}
    ${lock}
  `;
}

export function buildInsertInboxV2WorkItemSlotSql(
  slot: InboxV2ConversationWorkItemSlot
): SQL {
  return sql`
    insert into inbox_v2_conversation_work_item_slots (
      tenant_id, id, conversation_id, latest_ordinal, latest_work_item_id,
      latest_lifecycle_class, latest_lifecycle_fence_revision,
      current_non_terminal_work_item_id, current_non_terminal_ordinal,
      revision, created_at, updated_at
    ) values (
      ${slot.tenantId}, ${slot.id}, ${slot.conversation.id},
      ${slot.latestOrdinal}, ${slot.latestWorkItem?.workItem.id ?? null},
      ${slot.latestWorkItem?.lifecycleClass ?? null},
      ${slot.latestWorkItem?.lifecycleFenceRevision ?? null},
      ${slot.currentNonTerminalWorkItem?.workItem.id ?? null},
      ${slot.currentNonTerminalWorkItem?.ordinal ?? null}, ${slot.revision},
      ${slot.createdAt}, ${slot.updatedAt}
    )
    on conflict do nothing
    returning id
  `;
}

export function buildAdvanceInboxV2WorkItemSlotSql(input: {
  before: InboxV2ConversationWorkItemSlot;
  after: InboxV2ConversationWorkItemSlot;
}): SQL {
  return sql`
    update inbox_v2_conversation_work_item_slots
    set latest_ordinal = ${input.after.latestOrdinal},
        latest_work_item_id = ${input.after.latestWorkItem?.workItem.id ?? null},
        latest_lifecycle_class = ${input.after.latestWorkItem?.lifecycleClass ?? null},
        latest_lifecycle_fence_revision = ${input.after.latestWorkItem?.lifecycleFenceRevision ?? null},
        current_non_terminal_work_item_id = ${input.after.currentNonTerminalWorkItem?.workItem.id ?? null},
        current_non_terminal_ordinal = ${input.after.currentNonTerminalWorkItem?.ordinal ?? null},
        revision = ${input.after.revision},
        updated_at = ${input.after.updatedAt}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and conversation_id = ${input.before.conversation.id}
      and revision = ${input.before.revision}
    returning id
  `;
}

export function buildFindInboxV2WorkItemSlaSnapshotSql(input: {
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  slaCycle: string;
  revision: string;
}): SQL {
  return sql`
    select tenant_id, work_item_id, sla_cycle, revision, kind, absence_reason_id,
      policy_id, policy_version, policy_revision, input_revision,
      business_calendar_id, business_calendar_version,
      business_calendar_revision, time_zone, clock_state, started_at,
      paused_at, pause_condition_id, stopped_at,
      first_human_response_due_at, resolution_due_at,
      first_human_response_at, calculated_at, created_at
    from inbox_v2_work_item_sla_snapshots
    where tenant_id = ${input.tenantId}
      and work_item_id = ${input.workItemId}
      and sla_cycle = ${input.slaCycle}
      and revision = ${input.revision}
  `;
}

export function buildFindInboxV2WorkItemPrimaryAssignmentSql(input: {
  tenantId: InboxV2TenantId;
  assignmentId: string;
  lock: boolean;
}): SQL {
  const lock = input.lock ? sql`for update of assignment_row` : sql``;
  return sql`
    ${assignmentSelectSql()}
    where assignment_row.tenant_id = ${input.tenantId}
      and assignment_row.id = ${input.assignmentId}
    ${lock}
  `;
}

function assignmentSelectSql(): SQL {
  return sql`
    select
      assignment_row.tenant_id as assignment_tenant_id,
      assignment_row.id as assignment_id,
      assignment_row.work_item_id as assignment_work_item_id,
      assignment_row.queue_at_start_id,
      assignment_row.queue_at_start_revision,
      assignment_row.employee_id as assignment_employee_id,
      assignment_row.source,
      assignment_row.eligibility_decision_id,
      assignment_row.employee_fence_generation_at_start,
      assignment_row.started_at,
      assignment_row.started_actor_kind,
      assignment_row.started_actor_employee_id,
      assignment_row.started_actor_authorization_epoch,
      assignment_row.started_actor_trusted_service_id,
      assignment_row.start_reason_id,
      assignment_row.state as assignment_state,
      assignment_row.ended_at,
      assignment_row.end_recorded_at,
      assignment_row.end_basis,
      assignment_row.ended_actor_kind,
      assignment_row.ended_actor_employee_id,
      assignment_row.ended_actor_authorization_epoch,
      assignment_row.ended_actor_trusted_service_id,
      assignment_row.end_reason_id,
      assignment_row.termination_transition_id,
      assignment_row.end_employee_fence_revision,
      assignment_row.end_employee_fence_generation,
      assignment_row.end_employee_fence_state,
      assignment_row.end_employee_fence_effective_from,
      assignment_row.end_employee_fence_loaded_at,
      assignment_row.revision as assignment_revision,
      assignment_row.created_at as assignment_created_at,
      assignment_row.updated_at as assignment_updated_at,
      decision_row.tenant_id as decision_tenant_id,
      decision_row.id as decision_id,
      decision_row.work_item_id as decision_work_item_id,
      decision_row.expected_work_item_revision,
      decision_row.work_queue_id as decision_work_queue_id,
      decision_row.work_queue_revision as decision_work_queue_revision,
      decision_row.work_queue_lifecycle,
      decision_row.employee_id as decision_employee_id,
      decision_row.employee_fence_revision,
      decision_row.employee_fence_generation,
      decision_row.employee_fence_state,
      decision_row.employee_fence_effective_from,
      decision_row.employee_fence_loaded_at,
      decision_row.policy_id,
      decision_row.policy_version,
      decision_row.policy_revision,
      decision_row.eligibility_basis,
      decision_row.eligibility_evidence_revision,
      decision_row.effect,
      decision_row.reason_id as decision_reason_id,
      decision_row.decision_revision,
      decision_row.loaded_by_trusted_service_id,
      decision_row.decided_at,
      decision_row.not_after
    from inbox_v2_work_item_primary_assignments assignment_row
    inner join inbox_v2_work_queue_eligibility_decisions decision_row
      on decision_row.tenant_id = assignment_row.tenant_id
     and decision_row.id = assignment_row.eligibility_decision_id
  `;
}

export function buildFindInboxV2WorkItemServicingTeamEpisodeSql(input: {
  tenantId: InboxV2TenantId;
  episodeId: string;
  lock: boolean;
}): SQL {
  const lock = input.lock ? sql`for update` : sql``;
  return sql`
    select tenant_id, id, work_item_id, work_item_cycle, team_id, started_at,
      started_actor_kind, started_actor_employee_id,
      started_actor_authorization_epoch, started_actor_trusted_service_id,
      start_reason_id, state, ended_at, end_recorded_at, end_cause,
      end_relation_transition_id, end_work_item_transition_id,
      ended_actor_kind, ended_actor_employee_id,
      ended_actor_authorization_epoch, ended_actor_trusted_service_id,
      end_reason_id, revision, created_at, updated_at
    from inbox_v2_work_item_servicing_team_episodes
    where tenant_id = ${input.tenantId}
      and id = ${input.episodeId}
    ${lock}
  `;
}

export function buildLockInboxV2WorkItemTeamsSql(input: {
  tenantId: InboxV2TenantId;
  teamIds: readonly string[];
}): SQL {
  if (input.teamIds.length === 0) {
    throw invariantError("Servicing-team lock requires at least one Team.");
  }
  const teamIds = [...input.teamIds].sort(comparePostgresCText);
  return sql`
    select id
    from teams
    where tenant_id = ${input.tenantId}
      and id in (${sql.join(
        teamIds.map((teamId) => sql`${teamId}`),
        sql`, `
      )})
    order by id collate "C"
    for key share
  `;
}

export function buildFindInboxV2WorkItemRelationTransitionByIdSql(input: {
  tenantId: InboxV2TenantId;
  transitionId: string;
}): SQL {
  return sql`
    select tenant_id, id, work_item_id, kind, actor_kind,
      actor_employee_id, actor_authorization_epoch, actor_trusted_service_id,
      reason_id, expected_work_item_revision, resulting_work_item_revision,
      expected_relation_revision, resulting_relation_revision,
      previous_episode_id, next_episode_id, occurred_at, canonical_commit
    from inbox_v2_work_item_relation_transitions
    where tenant_id = ${input.tenantId}
      and id = ${input.transitionId}
  `;
}

export function buildInsertInboxV2WorkItemRelationTransitionSql(
  commit: InboxV2WorkItemServicingTeamCommit
): SQL {
  const transition = commit.transition;
  const actor = workActorColumns(transition.actor);
  return sql`
    insert into inbox_v2_work_item_relation_transitions (
      tenant_id, id, work_item_id, kind, actor_kind, actor_employee_id,
      actor_authorization_epoch, actor_trusted_service_id, reason_id,
      expected_work_item_revision, resulting_work_item_revision,
      expected_relation_revision, resulting_relation_revision,
      previous_episode_id, next_episode_id, occurred_at, created_at,
      canonical_commit
    ) values (
      ${transition.tenantId}, ${transition.id}, ${transition.workItem.id},
      ${transition.kind}, ${actor.kind}, ${actor.employeeId},
      ${actor.authorizationEpoch}, ${actor.trustedServiceId},
      ${transition.reasonId}, ${transition.expectedWorkItemRevision},
      ${transition.resultingWorkItemRevision},
      ${transition.expectedRelationRevision},
      ${transition.resultingRelationRevision},
      ${commit.closed?.before.id ?? null}, ${commit.opened?.id ?? null},
      ${transition.occurredAt}, ${transition.occurredAt},
      ${JSON.stringify(canonicalizePersistenceValue(commit))}::jsonb
    )
    returning id
  `;
}

export function buildInsertInboxV2WorkItemServicingTeamEpisodeSql(
  episode: InboxV2WorkItemServicingTeamEpisode
): SQL {
  if (episode.state !== "active" || episode.termination !== null) {
    throw invariantError("Servicing-team insert requires an active episode.");
  }
  const actor = workActorColumns(episode.startedBy);
  return sql`
    insert into inbox_v2_work_item_servicing_team_episodes (
      tenant_id, id, work_item_id, work_item_cycle, team_id, started_at,
      started_actor_kind, started_actor_employee_id,
      started_actor_authorization_epoch, started_actor_trusted_service_id,
      start_reason_id, state, ended_at, end_recorded_at, end_cause,
      end_relation_transition_id, end_work_item_transition_id,
      ended_actor_kind, ended_actor_employee_id,
      ended_actor_authorization_epoch, ended_actor_trusted_service_id,
      end_reason_id, revision, created_at, updated_at
    ) values (
      ${episode.tenantId}, ${episode.id}, ${episode.workItem.id},
      ${episode.workItemCycle}, ${episode.team.id}, ${episode.startedAt},
      ${actor.kind}, ${actor.employeeId}, ${actor.authorizationEpoch},
      ${actor.trustedServiceId}, ${episode.startReasonId}, 'active', null,
      null, null, null, null, null, null, null, null, null,
      ${episode.revision}, ${episode.createdAt}, ${episode.updatedAt}
    )
    returning id
  `;
}

export function buildCloseInboxV2WorkItemServicingTeamRelationEpisodeSql(input: {
  before: InboxV2WorkItemServicingTeamEpisode;
  after: InboxV2WorkItemServicingTeamEpisode;
}): SQL {
  const termination = input.after.termination;
  if (termination === null || termination.cause.kind !== "relation_command") {
    throw invariantError(
      "Servicing-team relation closure requires its transition."
    );
  }
  const actor = workActorColumns(termination.actor);
  return sql`
    update inbox_v2_work_item_servicing_team_episodes
    set state = 'ended', ended_at = ${termination.endedAt},
        end_recorded_at = ${termination.recordedAt},
        end_cause = 'relation_command',
        end_relation_transition_id = ${termination.cause.transition.id},
        end_work_item_transition_id = null,
        ended_actor_kind = ${actor.kind},
        ended_actor_employee_id = ${actor.employeeId},
        ended_actor_authorization_epoch = ${actor.authorizationEpoch},
        ended_actor_trusted_service_id = ${actor.trustedServiceId},
        end_reason_id = ${termination.reasonId},
        revision = ${input.after.revision}, updated_at = ${input.after.updatedAt}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and work_item_id = ${input.before.workItem.id}
      and revision = ${input.before.revision}
      and state = 'active'
    returning id
  `;
}

export function buildAdvanceInboxV2WorkItemServicingTeamSql(
  commit: InboxV2WorkItemServicingTeamCommit
): SQL {
  const lastEpisodeId = commit.opened?.id ?? commit.closed?.after.id ?? null;
  return sql`
    update inbox_v2_work_items
    set current_servicing_team_episode_id = ${commit.opened?.id ?? null},
        current_servicing_team_id = ${commit.opened?.team.id ?? null},
        last_servicing_team_episode_id = coalesce(
          ${lastEpisodeId}, last_servicing_team_episode_id
        ),
        servicing_team_relation_revision = ${commit.after.servicingTeamRelationRevision},
        resource_access_revision = ${commit.after.resourceAccessRevision},
        revision = ${commit.after.workItemRevision},
        updated_at = ${commit.after.updatedAt}
    where tenant_id = ${commit.tenantId}
      and id = ${commit.before.workItem.id}
      and revision = ${commit.before.workItemRevision}
      and servicing_team_relation_revision = ${commit.before.servicingTeamRelationRevision}
    returning id
  `;
}

export function buildFindInboxV2WorkItemTransitionByIdSql(input: {
  tenantId: InboxV2TenantId;
  transitionId: string;
}): SQL {
  return sql`
    select tenant_id, id, work_item_id, kind, from_state, to_state,
      source_queue_id, source_queue_revision, destination_queue_id,
      destination_queue_revision, actor_kind, actor_employee_id,
      actor_authorization_epoch, actor_trusted_service_id, reason_id,
      expected_revision, resulting_revision,
      expected_servicing_team_relation_revision,
      resulting_servicing_team_relation_revision,
      closed_servicing_team_episode_id, closed_primary_assignment_id,
      opened_primary_assignment_id, occurred_at
      , canonical_commit
    from inbox_v2_work_item_transitions
    where tenant_id = ${input.tenantId}
      and id = ${input.transitionId}
  `;
}

export function buildFindWinningInboxV2WorkItemTransitionSql(input: {
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
  expectedRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select tenant_id, id, work_item_id, kind, from_state, to_state,
      source_queue_id, source_queue_revision, destination_queue_id,
      destination_queue_revision, actor_kind, actor_employee_id,
      actor_authorization_epoch, actor_trusted_service_id, reason_id,
      expected_revision, resulting_revision,
      expected_servicing_team_relation_revision,
      resulting_servicing_team_relation_revision,
      closed_servicing_team_episode_id, closed_primary_assignment_id,
      opened_primary_assignment_id, occurred_at
      , canonical_commit
    from inbox_v2_work_item_transitions
    where tenant_id = ${input.tenantId}
      and work_item_id = ${input.workItemId}
      and expected_revision = ${input.expectedRevision}
  `;
}

export function buildFindInboxV2WorkItemCreationDecisionSql(input: {
  tenantId: InboxV2TenantId;
  workItemId: InboxV2WorkItemId;
}): SQL {
  return sql`
    select tenant_id, work_item_id, conversation_id, transport, policy_id,
      policy_version, policy_revision, decision_revision,
      decided_by_trusted_service_id, decided_at, work_queue_id,
      work_queue_revision, latest_terminal_handling, reason_id,
      slot_before_revision, slot_after_revision
      , canonical_commit
    from inbox_v2_work_item_creation_decisions
    where tenant_id = ${input.tenantId}
      and work_item_id = ${input.workItemId}
  `;
}

export function buildInsertInboxV2WorkItemSql(
  workItem: InboxV2WorkItem,
  slaPointer: WorkItemSlaPointer
): SQL {
  const queue = currentOrFinalQueueHead(workItem);
  const actor = workActorColumns(workItem.createdBy);
  return sql`
    insert into inbox_v2_work_items (
      tenant_id, id, conversation_id, ordinal, state, queue_id,
      queue_revision, priority_id, sla_cycle, sla_snapshot_revision,
      current_primary_assignment_id, last_primary_assignment_id,
      current_servicing_team_episode_id, current_servicing_team_id,
      last_servicing_team_episode_id, servicing_team_relation_revision,
      collaborator_set_revision, resource_access_revision, reopen_cycle,
      last_reopen_snapshot, terminal_snapshot, created_actor_kind,
      created_actor_employee_id, created_actor_authorization_epoch,
      created_actor_trusted_service_id, creation_reason_id, revision,
      created_at, updated_at
    ) values (
      ${workItem.tenantId}, ${workItem.id}, ${workItem.conversation.id},
      ${workItem.ordinal}, ${workItem.operationalState.state},
      ${queue.queue.id}, ${queue.queueRevision}, ${workItem.priorityId},
      ${slaPointer.slaCycle}, ${slaPointer.slaSnapshotRevision},
      ${workItem.operationalState.primaryAssignment?.assignment.id ?? null},
      ${workItem.operationalState.primaryAssignment?.assignment.id ?? null},
      ${workItem.currentServicingTeam?.episode.id ?? null},
      ${workItem.currentServicingTeam?.team.id ?? null},
      ${workItem.currentServicingTeam?.episode.id ?? null},
      ${workItem.servicingTeamRelationRevision},
      ${workItem.collaboratorSetRevision}, ${workItem.resourceAccessRevision},
      ${workItem.reopenCycle},
      ${workItem.lastReopen === null ? null : JSON.stringify(workItem.lastReopen)}::jsonb,
      ${workItem.operationalState.terminal === null ? null : JSON.stringify(workItem.operationalState.terminal)}::jsonb,
      ${actor.kind}, ${actor.employeeId}, ${actor.authorizationEpoch},
      ${actor.trustedServiceId}, ${workItem.creationReasonId},
      ${workItem.revision}, ${workItem.createdAt}, ${workItem.updatedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2WorkItemSlaSnapshotSql(input: {
  workItem: InboxV2WorkItem;
  slaCycle: bigint;
  revision: bigint;
  createdAt: string;
}): SQL {
  const sla = input.workItem.sla;
  const snapshot = sla.kind === "tracked" ? sla.snapshot : null;
  return sql`
    insert into inbox_v2_work_item_sla_snapshots (
      tenant_id, work_item_id, sla_cycle, revision, kind, absence_reason_id, policy_id,
      policy_version, policy_revision, input_revision, business_calendar_id,
      business_calendar_version, business_calendar_revision, time_zone,
      clock_state, started_at, paused_at, pause_condition_id, stopped_at,
      first_human_response_due_at, resolution_due_at,
      first_human_response_at, calculated_at, created_at
    ) values (
      ${input.workItem.tenantId}, ${input.workItem.id}, ${input.slaCycle},
      ${input.revision},
      ${sla.kind}, ${sla.kind === "not_applied" ? sla.reasonId : null},
      ${snapshot?.policyId ?? null}, ${snapshot?.policyVersion ?? null},
      ${snapshot?.policyRevision ?? null}, ${snapshot?.inputRevision ?? null},
      ${snapshot?.businessCalendarId ?? null},
      ${snapshot?.businessCalendarVersion ?? null},
      ${snapshot?.businessCalendarRevision ?? null}, ${snapshot?.timeZone ?? null},
      ${snapshot?.clockState ?? null}, ${snapshot?.startedAt ?? null},
      ${snapshot?.pausedAt ?? null}, ${snapshot?.pauseConditionId ?? null},
      ${snapshot?.stoppedAt ?? null},
      ${snapshot?.firstHumanResponseDueAt ?? null},
      ${snapshot?.resolutionDueAt ?? null},
      ${snapshot?.firstHumanResponseAt ?? null},
      ${snapshot?.calculatedAt ?? input.createdAt}, ${input.createdAt}
    )
    returning work_item_id as id
  `;
}

export function buildInsertInboxV2WorkItemCreationDecisionSql(
  commit: InboxV2WorkItemCreationCommit
): SQL {
  const decision = commit.intakeDecision;
  if (decision.outcome !== "create_work_item") {
    throw invariantError(
      "Creation commit requires a create WorkItem decision."
    );
  }
  return sql`
    insert into inbox_v2_work_item_creation_decisions (
      tenant_id, work_item_id, conversation_id, transport, policy_id,
      policy_version, policy_revision, decision_revision,
      decided_by_trusted_service_id, decided_at, work_queue_id,
      work_queue_revision, latest_terminal_handling, reason_id,
      slot_before_revision, slot_after_revision, created_at
      , canonical_commit
    ) values (
      ${commit.tenantId}, ${commit.createdWorkItem.id},
      ${decision.conversation.id}, ${decision.transport}, ${decision.policyId},
      ${decision.policyVersion}, ${decision.policyRevision},
      ${decision.decisionRevision}, ${decision.decidedByTrustedServiceId},
      ${decision.decidedAt}, ${decision.queue.id},
      ${commit.queueSnapshot.revision}, ${decision.latestTerminalHandling},
      ${decision.reasonId}, ${commit.slotBefore.revision},
      ${commit.slotAfter.revision}, ${commit.occurredAt},
      ${JSON.stringify(canonicalizePersistenceValue(commit))}::jsonb
    )
    returning work_item_id as id
  `;
}

export function buildInsertInboxV2WorkItemTransitionSql(
  commit: InboxV2WorkItemTransitionCommit
): SQL {
  const transition = commit.transition;
  const actor = workActorColumns(transition.actor);
  return sql`
    insert into inbox_v2_work_item_transitions (
      tenant_id, id, work_item_id, kind, from_state, to_state,
      source_queue_id, source_queue_revision, destination_queue_id,
      destination_queue_revision, actor_kind, actor_employee_id,
      actor_authorization_epoch, actor_trusted_service_id, reason_id,
      expected_revision, resulting_revision,
      expected_servicing_team_relation_revision,
      resulting_servicing_team_relation_revision,
      closed_servicing_team_episode_id, closed_primary_assignment_id,
      opened_primary_assignment_id, occurred_at, created_at
      , canonical_commit
    ) values (
      ${transition.tenantId}, ${transition.id}, ${transition.workItem.id},
      ${transition.kind}, ${transition.fromState}, ${transition.toState},
      ${transition.sourceQueue.queue.id}, ${transition.sourceQueue.queueRevision},
      ${transition.destinationQueue.queue.id},
      ${transition.destinationQueue.queueRevision}, ${actor.kind},
      ${actor.employeeId}, ${actor.authorizationEpoch}, ${actor.trustedServiceId},
      ${transition.reasonId}, ${transition.expectedRevision},
      ${transition.resultingRevision},
      ${commit.before.servicingTeamRelationRevision},
      ${commit.after.servicingTeamRelationRevision},
      ${commit.servicingTeamEffect.kind === "close" ? commit.servicingTeamEffect.before.id : null},
      ${commit.assignmentEffect.kind === "close" || commit.assignmentEffect.kind === "replace" ? commit.assignmentEffect.before.id : null},
      ${commit.assignmentEffect.kind === "open" || commit.assignmentEffect.kind === "replace" ? commit.assignmentEffect.opened.id : null},
      ${transition.occurredAt},
      ${transition.occurredAt},
      ${JSON.stringify(canonicalizePersistenceValue(commit))}::jsonb
    )
    returning id
  `;
}

export function buildInsertInboxV2WorkQueueEligibilityDecisionSql(
  decision: InboxV2WorkItemPrimaryAssignment["eligibilityDecision"]
): SQL {
  return sql`
    insert into inbox_v2_work_queue_eligibility_decisions (
      tenant_id, id, work_item_id, expected_work_item_revision,
      work_queue_id, work_queue_revision, work_queue_lifecycle, employee_id,
      employee_fence_revision, employee_fence_generation,
      employee_fence_state, employee_fence_effective_from,
      employee_fence_loaded_at, policy_id, policy_version, policy_revision,
      eligibility_basis, eligibility_evidence_revision, effect, reason_id,
      decision_revision, loaded_by_trusted_service_id, decided_at, not_after,
      created_at
    ) values (
      ${decision.tenantId}, ${decision.id}, ${decision.workItem.id},
      ${decision.expectedWorkItemRevision}, ${decision.queue.id},
      ${decision.queueRevision}, ${decision.queueLifecycle},
      ${decision.employee.id}, ${decision.employeeFence.revision},
      ${decision.employeeFence.generation}, ${decision.employeeFence.state},
      ${decision.employeeFence.effectiveFrom},
      ${decision.employeeFence.loadedAt}, ${decision.policy.policyId},
      ${decision.policy.policyVersion}, ${decision.policy.policyRevision},
      ${decision.eligibilityBasis}, ${decision.eligibilityEvidenceRevision},
      ${decision.effect}, ${decision.reasonId}, ${decision.decisionRevision},
      ${decision.loadedByTrustedServiceId}, ${decision.decidedAt},
      ${decision.notAfter}, ${decision.decidedAt}
    )
    returning id
  `;
}

export function buildInsertInboxV2WorkItemPrimaryAssignmentSql(
  assignment: InboxV2WorkItemPrimaryAssignment
): SQL {
  const actor = workActorColumns(assignment.startedBy);
  return sql`
    insert into inbox_v2_work_item_primary_assignments (
      tenant_id, id, work_item_id, queue_at_start_id,
      queue_at_start_revision, employee_id, source, eligibility_decision_id,
      employee_fence_generation_at_start, started_at, started_actor_kind,
      started_actor_employee_id, started_actor_authorization_epoch,
      started_actor_trusted_service_id, start_reason_id, state, ended_at,
      end_recorded_at, end_basis, ended_actor_kind, ended_actor_employee_id,
      ended_actor_authorization_epoch, ended_actor_trusted_service_id,
      end_reason_id, termination_transition_id, end_employee_fence_revision,
      end_employee_fence_generation, end_employee_fence_state,
      end_employee_fence_effective_from, end_employee_fence_loaded_at,
      revision, created_at, updated_at
    ) values (
      ${assignment.tenantId}, ${assignment.id}, ${assignment.workItem.id},
      ${assignment.queueAtStart.queue.id}, ${assignment.queueAtStart.queueRevision},
      ${assignment.employee.id}, ${assignment.source},
      ${assignment.eligibilityDecision.id},
      ${assignment.employeeFenceGenerationAtStart}, ${assignment.startedAt},
      ${actor.kind}, ${actor.employeeId}, ${actor.authorizationEpoch},
      ${actor.trustedServiceId}, ${assignment.startReasonId}, 'active', null,
      null, null, null, null, null, null, null, null, null, null, null, null,
      null, 1, ${assignment.createdAt}, ${assignment.updatedAt}
    )
    returning id
  `;
}

export function buildCloseInboxV2WorkItemPrimaryAssignmentSql(input: {
  before: InboxV2WorkItemPrimaryAssignment;
  after: InboxV2WorkItemPrimaryAssignment;
}): SQL {
  const termination = input.after.termination;
  if (termination === null) {
    throw invariantError("Ended assignment requires termination metadata.");
  }
  const actor = workActorColumns(termination.endedBy);
  const fence = termination.employeeFenceAtEnd;
  return sql`
    update inbox_v2_work_item_primary_assignments
    set state = 'ended', ended_at = ${termination.endedAt},
        end_recorded_at = ${termination.recordedAt},
        end_basis = ${termination.basis}, ended_actor_kind = ${actor.kind},
        ended_actor_employee_id = ${actor.employeeId},
        ended_actor_authorization_epoch = ${actor.authorizationEpoch},
        ended_actor_trusted_service_id = ${actor.trustedServiceId},
        end_reason_id = ${termination.reasonId},
        termination_transition_id = ${termination.transition.id},
        end_employee_fence_revision = ${fence?.revision ?? null},
        end_employee_fence_generation = ${fence?.generation ?? null},
        end_employee_fence_state = ${fence?.state ?? null},
        end_employee_fence_effective_from = ${fence?.effectiveFrom ?? null},
        end_employee_fence_loaded_at = ${fence?.loadedAt ?? null},
        revision = ${input.after.revision}, updated_at = ${input.after.updatedAt}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and work_item_id = ${input.before.workItem.id}
      and revision = ${input.before.revision}
      and state = 'active'
    returning id
  `;
}

export function buildCloseInboxV2WorkItemServicingTeamEpisodeSql(input: {
  before: InboxV2WorkItemServicingTeamEpisode;
  after: InboxV2WorkItemServicingTeamEpisode;
}): SQL {
  const termination = input.after.termination;
  if (termination === null || termination.cause.kind !== "work_item_terminal") {
    throw invariantError(
      "Terminal team closure requires WorkItem transition metadata."
    );
  }
  const actor = workActorColumns(termination.actor);
  return sql`
    update inbox_v2_work_item_servicing_team_episodes
    set state = 'ended', ended_at = ${termination.endedAt},
        end_recorded_at = ${termination.recordedAt},
        end_cause = 'work_item_terminal', end_relation_transition_id = null,
        end_work_item_transition_id = ${termination.cause.transition.id},
        ended_actor_kind = ${actor.kind},
        ended_actor_employee_id = ${actor.employeeId},
        ended_actor_authorization_epoch = ${actor.authorizationEpoch},
        ended_actor_trusted_service_id = ${actor.trustedServiceId},
        end_reason_id = ${termination.reasonId},
        revision = ${input.after.revision}, updated_at = ${input.after.updatedAt}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and work_item_id = ${input.before.workItem.id}
      and revision = ${input.before.revision}
      and state = 'active'
    returning id
  `;
}

export function buildAdvanceInboxV2WorkItemSql(input: {
  before: InboxV2WorkItem;
  after: InboxV2WorkItem;
  assignmentEffect: InboxV2WorkItemTransitionCommit["assignmentEffect"];
  servicingTeamEffect: InboxV2WorkItemTransitionCommit["servicingTeamEffect"];
  slaPointer: WorkItemSlaPointer;
}): SQL {
  const queue = currentOrFinalQueueHead(input.after);
  const currentAssignment = input.after.operationalState.primaryAssignment;
  const lastAssignmentId =
    currentAssignment?.assignment.id ??
    (input.assignmentEffect.kind === "close" ||
    input.assignmentEffect.kind === "replace"
      ? input.assignmentEffect.after.id
      : null);
  const lastTeamEpisodeId =
    input.after.currentServicingTeam?.episode.id ??
    (input.servicingTeamEffect.kind === "close"
      ? input.servicingTeamEffect.after.id
      : null);
  return sql`
    update inbox_v2_work_items
    set state = ${input.after.operationalState.state},
        queue_id = ${queue.queue.id}, queue_revision = ${queue.queueRevision},
        priority_id = ${input.after.priorityId},
        sla_cycle = ${input.slaPointer.slaCycle},
        sla_snapshot_revision = ${input.slaPointer.slaSnapshotRevision},
        current_primary_assignment_id = ${currentAssignment?.assignment.id ?? null},
        last_primary_assignment_id = coalesce(${lastAssignmentId}, last_primary_assignment_id),
        current_servicing_team_episode_id = ${input.after.currentServicingTeam?.episode.id ?? null},
        current_servicing_team_id = ${input.after.currentServicingTeam?.team.id ?? null},
        last_servicing_team_episode_id = coalesce(${lastTeamEpisodeId}, last_servicing_team_episode_id),
        servicing_team_relation_revision = ${input.after.servicingTeamRelationRevision},
        collaborator_set_revision = ${input.after.collaboratorSetRevision},
        resource_access_revision = ${input.after.resourceAccessRevision},
        reopen_cycle = ${input.after.reopenCycle},
        last_reopen_snapshot = ${input.after.lastReopen === null ? null : JSON.stringify(input.after.lastReopen)}::jsonb,
        terminal_snapshot = ${input.after.operationalState.terminal === null ? null : JSON.stringify(input.after.operationalState.terminal)}::jsonb,
        revision = ${input.after.revision}, updated_at = ${input.after.updatedAt}
    where tenant_id = ${input.before.tenantId}
      and id = ${input.before.id}
      and revision = ${input.before.revision}
    returning id
  `;
}

export function buildLockInboxV2WorkQueueIdentitySql(input: {
  tenantId: InboxV2TenantId;
  id: InboxV2WorkQueueId;
}): SQL {
  return sql`
    select id
    from work_queues
    where tenant_id = ${input.tenantId}
      and id = ${input.id}
    for no key update
  `;
}

export function buildLockInboxV2WorkQueueHeadSql(input: {
  tenantId: InboxV2TenantId;
  workQueueId: InboxV2WorkQueueId;
}): SQL {
  return sql`
    select current_revision
    from inbox_v2_work_queue_heads
    where tenant_id = ${input.tenantId}
      and work_queue_id = ${input.workQueueId}
    for update
  `;
}

export function buildFindInboxV2WorkQueueVersionSql(input: {
  tenantId: InboxV2TenantId;
  workQueueId: InboxV2WorkQueueId;
  revision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select tenant_id, work_queue_id, revision, owner_org_unit_id, lifecycle,
      eligibility_policy_id, eligibility_policy_version,
      eligibility_policy_revision, external_reply_policy_mode,
      external_reply_policy_version, external_reply_policy_revision,
      default_priority_id, default_sla_kind, default_sla_policy_id,
      default_sla_policy_version, default_sla_policy_revision,
      default_business_calendar_id, default_business_calendar_version,
      default_business_calendar_revision, default_sla_time_zone,
      resource_access_revision, created_at, updated_at
    from inbox_v2_work_queue_versions
    where tenant_id = ${input.tenantId}
      and work_queue_id = ${input.workQueueId}
      and revision = ${input.revision}
  `;
}

export function buildInsertInboxV2WorkQueueVersionSql(
  queue: InboxV2WorkQueue
): SQL {
  const sla = queue.defaultSlaPolicy;
  return sql`
    insert into inbox_v2_work_queue_versions (
      tenant_id, work_queue_id, revision, owner_org_unit_id, lifecycle,
      eligibility_policy_id, eligibility_policy_version,
      eligibility_policy_revision, external_reply_policy_mode,
      external_reply_policy_version, external_reply_policy_revision,
      default_priority_id, default_sla_kind, default_sla_policy_id,
      default_sla_policy_version, default_sla_policy_revision,
      default_business_calendar_id, default_business_calendar_version,
      default_business_calendar_revision, default_sla_time_zone,
      resource_access_revision, created_at, updated_at
    ) values (
      ${queue.tenantId}, ${queue.id}, ${queue.revision},
      ${queue.ownerOrgUnit.id}, ${queue.lifecycle},
      ${queue.eligibilityPolicy.policyId},
      ${queue.eligibilityPolicy.policyVersion},
      ${queue.eligibilityPolicy.policyRevision},
      ${queue.externalReplyPolicy.mode},
      ${queue.externalReplyPolicy.policyVersion},
      ${queue.externalReplyPolicy.policyRevision}, ${queue.defaultPriorityId},
      ${sla.kind}, ${sla.kind === "tracked" ? sla.policyId : null},
      ${sla.kind === "tracked" ? sla.policyVersion : null},
      ${sla.kind === "tracked" ? sla.policyRevision : null},
      ${sla.kind === "tracked" ? sla.businessCalendarId : null},
      ${sla.kind === "tracked" ? sla.businessCalendarVersion : null},
      ${sla.kind === "tracked" ? sla.businessCalendarRevision : null},
      ${sla.kind === "tracked" ? sla.timeZone : null},
      ${queue.resourceAccessRevision}, ${queue.createdAt}, ${queue.updatedAt}
    )
    returning work_queue_id as id
  `;
}

export function buildInsertInboxV2WorkQueueHeadSql(
  queue: InboxV2WorkQueue
): SQL {
  return sql`
    insert into inbox_v2_work_queue_heads (
      tenant_id, work_queue_id, current_revision, created_at, updated_at
    ) values (
      ${queue.tenantId}, ${queue.id}, ${queue.revision},
      ${queue.createdAt}, ${queue.updatedAt}
    )
    returning work_queue_id as id
  `;
}

export function buildAdvanceInboxV2WorkQueueHeadSql(input: {
  queue: InboxV2WorkQueue;
  expectedRevision: InboxV2EntityRevision;
}): SQL {
  return sql`
    update inbox_v2_work_queue_heads
    set current_revision = ${input.queue.revision},
        updated_at = ${input.queue.updatedAt}
    where tenant_id = ${input.queue.tenantId}
      and work_queue_id = ${input.queue.id}
      and current_revision = ${input.expectedRevision}
    returning work_queue_id as id
  `;
}

export function buildLockInboxV2WorkItemEmployeeSql(input: {
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
}): SQL {
  return sql`
    select id
    from employees
    where tenant_id = ${input.tenantId}
      and id = ${input.employeeId}
    for no key update
  `;
}

export function buildFindCurrentInboxV2EmployeeAssignmentFenceSql(input: {
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  lock: boolean;
  preserveRecordedLoadedAt: boolean;
}): SQL {
  const lock = input.lock ? sql`for no key update of head_row` : sql``;
  const loadedAt = input.preserveRecordedLoadedAt
    ? sql`version_row.recorded_at`
    : sql`clock_timestamp()`;
  return sql`
    select head_row.state, head_row.current_generation,
      head_row.current_revision, head_row.effective_from,
      ${loadedAt} as loaded_at
    from inbox_v2_employee_assignment_fence_heads head_row
    join inbox_v2_employee_assignment_fence_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.employee_id = head_row.employee_id
     and version_row.revision = head_row.current_revision
    where head_row.tenant_id = ${input.tenantId}
      and head_row.employee_id = ${input.employeeId}
    ${lock}
  `;
}

export function buildFindInboxV2EmployeeAssignmentFenceVersionSql(input: {
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  revision: InboxV2EntityRevision;
}): SQL {
  return sql`
    select tenant_id, employee_id, revision, generation, state,
      effective_from, recorded_at, reason_id, changed_by_trusted_service_id
    from inbox_v2_employee_assignment_fence_versions
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and revision = ${input.revision}
  `;
}

export function buildHasInboxV2ActiveEmployeeAssignmentsSql(input: {
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
}): SQL {
  return sql`
    select id
    from inbox_v2_work_item_primary_assignments
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and state = 'active'
    order by id collate "C"
    limit 1
  `;
}

export function buildInsertInboxV2EmployeeAssignmentFenceVersionSql(
  input: NormalizedEmployeeFenceAdvance
): SQL {
  return sql`
    insert into inbox_v2_employee_assignment_fence_versions (
      tenant_id, employee_id, revision, generation, state, effective_from,
      recorded_at, reason_id, changed_by_trusted_service_id
    ) values (
      ${input.tenantId}, ${input.employeeId}, ${input.next.revision},
      ${input.next.generation}, ${input.next.state},
      ${input.next.effectiveFrom}, ${input.next.loadedAt}, ${input.reasonId},
      ${input.changedByTrustedServiceId}
    )
    returning employee_id as id
  `;
}

export function buildInsertInboxV2EmployeeAssignmentFenceHeadSql(
  input: NormalizedEmployeeFenceAdvance
): SQL {
  return sql`
    insert into inbox_v2_employee_assignment_fence_heads (
      tenant_id, employee_id, state, current_generation, current_revision,
      effective_from, created_at, updated_at
    ) values (
      ${input.tenantId}, ${input.employeeId}, ${input.next.state},
      ${input.next.generation}, ${input.next.revision},
      ${input.next.effectiveFrom}, ${input.next.loadedAt}, ${input.next.loadedAt}
    )
    returning employee_id as id
  `;
}

export function buildAdvanceInboxV2EmployeeAssignmentFenceHeadSql(
  input: NormalizedEmployeeFenceAdvance
): SQL {
  return sql`
    update inbox_v2_employee_assignment_fence_heads
    set state = ${input.next.state},
        current_generation = ${input.next.generation},
        current_revision = ${input.next.revision},
        effective_from = ${input.next.effectiveFrom},
        updated_at = ${input.next.loadedAt}
    where tenant_id = ${input.tenantId}
      and employee_id = ${input.employeeId}
      and current_revision = ${input.expectedRevision}
    returning employee_id as id
  `;
}

async function loadWorkItem(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    workItemId: InboxV2WorkItemId;
    lock: boolean;
  }
): Promise<InboxV2WorkItem | null> {
  const result = await executor.execute<WorkItemRow>(
    buildFindInboxV2WorkItemSql(input)
  );
  assertAtMostOneRow(result, "WorkItem lookup");
  const row = result.rows[0];
  if (row === undefined) return null;

  const slaCycle = parseDatabaseBigint(row.sla_cycle, "WorkItem SLA cycle");
  const slaRevision = parseDatabaseBigint(
    row.sla_snapshot_revision,
    "WorkItem SLA snapshot revision"
  );
  const slaResult = await executor.execute<WorkItemSlaRow>(
    buildFindInboxV2WorkItemSlaSnapshotSql({
      tenantId: input.tenantId,
      workItemId: input.workItemId,
      slaCycle,
      revision: slaRevision
    })
  );
  assertAtMostOneRow(slaResult, "WorkItem SLA snapshot lookup");
  const slaRow = slaResult.rows[0];
  if (slaRow === undefined) {
    throw invariantError("WorkItem head references a missing SLA snapshot.");
  }

  const assignmentId = nullableString(row.current_primary_assignment_id);
  const assignment =
    assignmentId === null
      ? null
      : await loadAssignmentById(executor, {
          tenantId: input.tenantId,
          assignmentId,
          lock: false
        });
  if (assignmentId !== null && assignment === null) {
    throw invariantError("WorkItem head references a missing assignment.");
  }

  const teamEpisodeId = nullableString(row.current_servicing_team_episode_id);
  const teamEpisode =
    teamEpisodeId === null
      ? null
      : await loadServicingTeamEpisode(executor, {
          tenantId: input.tenantId,
          episodeId: teamEpisodeId,
          lock: false
        });
  if (teamEpisodeId !== null && teamEpisode === null) {
    throw invariantError("WorkItem head references a missing servicing team.");
  }

  return mapWorkItemRow(row, slaRow, assignment, teamEpisode, input.tenantId);
}

async function loadWorkItemSlaPointer(
  executor: RawSqlExecutor,
  tenantId: InboxV2TenantId,
  workItemId: InboxV2WorkItemId
): Promise<WorkItemSlaPointer> {
  const result = await executor.execute<{
    sla_cycle: unknown;
    sla_snapshot_revision: unknown;
  }>(sql`
    select sla_cycle, sla_snapshot_revision
    from inbox_v2_work_items
    where tenant_id = ${tenantId}
      and id = ${workItemId}
  `);
  assertAtMostOneRow(result, "WorkItem SLA pointer lookup");
  const row = result.rows[0];
  if (row === undefined) {
    throw invariantError("WorkItem disappeared while loading its SLA pointer.");
  }
  return {
    slaCycle: BigInt(
      parseDatabaseBigint(row.sla_cycle, "WorkItem SLA cycle pointer")
    ),
    slaSnapshotRevision: BigInt(
      parseDatabaseBigint(
        row.sla_snapshot_revision,
        "WorkItem SLA revision pointer"
      )
    )
  };
}

async function loadWorkItemSlot(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    conversationId: InboxV2ConversationId;
    lock: boolean;
  }
): Promise<InboxV2ConversationWorkItemSlot | null> {
  const result = await executor.execute<WorkItemSlotRow>(
    buildFindInboxV2WorkItemSlotSql(input)
  );
  assertAtMostOneRow(result, "Conversation WorkItem slot lookup");
  const row = result.rows[0];
  if (row === undefined) return null;
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== input.tenantId) {
    throw invariantError("Conversation WorkItem slot tenant mismatch.");
  }
  const latestWorkItemId = nullableString(row.latest_work_item_id);
  const currentWorkItemId = nullableString(
    row.current_non_terminal_work_item_id
  );
  return inboxV2ConversationWorkItemSlotSchema.parse({
    tenantId,
    id: row.id,
    conversation: {
      tenantId,
      kind: "conversation",
      id: row.conversation_id
    },
    latestOrdinal: parseDatabaseBigint(
      row.latest_ordinal,
      "slot latest ordinal"
    ),
    latestWorkItem:
      latestWorkItemId === null
        ? null
        : {
            workItem: {
              tenantId,
              kind: "work_item",
              id: latestWorkItemId
            },
            ordinal: parseDatabaseBigint(
              row.latest_ordinal,
              "slot latest ordinal"
            ),
            lifecycleClass: row.latest_lifecycle_class,
            lifecycleFenceRevision: parseDatabaseBigint(
              row.latest_lifecycle_fence_revision,
              "slot lifecycle fence revision"
            )
          },
    currentNonTerminalWorkItem:
      currentWorkItemId === null
        ? null
        : {
            workItem: {
              tenantId,
              kind: "work_item",
              id: currentWorkItemId
            },
            ordinal: parseDatabaseBigint(
              row.current_non_terminal_ordinal,
              "slot current ordinal"
            )
          },
    revision: parseDatabaseBigint(row.revision, "slot revision"),
    createdAt: parseTimestamp(row.created_at, "slot createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "slot updatedAt")
  });
}

async function loadAssignmentById(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    assignmentId: string;
    lock: boolean;
  }
): Promise<InboxV2WorkItemPrimaryAssignment | null> {
  const result = await executor.execute<AssignmentRow>(
    buildFindInboxV2WorkItemPrimaryAssignmentSql(input)
  );
  assertAtMostOneRow(result, "WorkItem assignment lookup");
  return result.rows[0] === undefined
    ? null
    : mapAssignmentRow(result.rows[0], input.tenantId);
}

async function loadServicingTeamEpisode(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; episodeId: string; lock: boolean }
): Promise<InboxV2WorkItemServicingTeamEpisode | null> {
  const result = await executor.execute<ServicingTeamEpisodeRow>(
    buildFindInboxV2WorkItemServicingTeamEpisodeSql(input)
  );
  assertAtMostOneRow(result, "WorkItem servicing-team episode lookup");
  return result.rows[0] === undefined
    ? null
    : mapServicingTeamEpisodeRow(result.rows[0], input.tenantId);
}

async function loadWorkItemRelationTransitionById(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; transitionId: string }
): Promise<Readonly<{
  transition: InboxV2WorkItemRelationTransition;
  canonicalCommit: unknown;
}> | null> {
  const result = await executor.execute<WorkItemRelationTransitionRow>(
    buildFindInboxV2WorkItemRelationTransitionByIdSql(input)
  );
  assertAtMostOneRow(result, "WorkItem relation transition lookup");
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        transition: mapWorkItemRelationTransitionRow(row, input.tenantId),
        canonicalCommit: nullableJson(row.canonical_commit)
      };
}

async function loadWorkItemTransitionById(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; transitionId: string }
): Promise<Readonly<{
  transition: InboxV2WorkItemTransition;
  canonicalCommit: unknown;
  expectedServicingTeamRelationRevision: InboxV2EntityRevision;
  resultingServicingTeamRelationRevision: InboxV2EntityRevision;
  closedServicingTeamEpisodeId: string | null;
  closedPrimaryAssignmentId: string | null;
  openedPrimaryAssignmentId: string | null;
}> | null> {
  const result = await executor.execute<WorkItemTransitionRow>(
    buildFindInboxV2WorkItemTransitionByIdSql(input)
  );
  assertAtMostOneRow(result, "WorkItem transition lookup");
  const row = result.rows[0];
  return row === undefined
    ? null
    : {
        transition: mapWorkItemTransitionRow(row, input.tenantId),
        canonicalCommit: nullableJson(row.canonical_commit),
        expectedServicingTeamRelationRevision: parseRevision(
          row.expected_servicing_team_relation_revision,
          "transition expected servicing-team relation revision"
        ),
        resultingServicingTeamRelationRevision: parseRevision(
          row.resulting_servicing_team_relation_revision,
          "transition resulting servicing-team relation revision"
        ),
        closedServicingTeamEpisodeId: nullableString(
          row.closed_servicing_team_episode_id
        ),
        closedPrimaryAssignmentId: nullableString(
          row.closed_primary_assignment_id
        ),
        openedPrimaryAssignmentId: nullableString(
          row.opened_primary_assignment_id
        )
      };
}

async function loadWinningWorkItemTransition(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    workItemId: InboxV2WorkItemId;
    expectedRevision: InboxV2EntityRevision;
  }
): Promise<InboxV2WorkItemTransition | null> {
  const result = await executor.execute<WorkItemTransitionRow>(
    buildFindWinningInboxV2WorkItemTransitionSql(input)
  );
  assertAtMostOneRow(result, "winning WorkItem transition lookup");
  return result.rows[0] === undefined
    ? null
    : mapWorkItemTransitionRow(result.rows[0], input.tenantId);
}

async function isCreationCommitReplay(
  executor: RawSqlExecutor,
  commit: InboxV2WorkItemCreationCommit,
  current: InboxV2WorkItem
): Promise<boolean> {
  const result = await executor.execute<WorkItemCreationDecisionRow>(
    buildFindInboxV2WorkItemCreationDecisionSql({
      tenantId: commit.tenantId,
      workItemId: commit.createdWorkItem.id
    })
  );
  assertAtMostOneRow(result, "WorkItem creation decision lookup");
  const row = result.rows[0];
  if (
    row === undefined ||
    commit.intakeDecision.outcome !== "create_work_item"
  ) {
    return false;
  }
  return (
    sameValue(nullableJson(row.canonical_commit), commit) &&
    current.tenantId === commit.createdWorkItem.tenantId &&
    current.id === commit.createdWorkItem.id &&
    current.conversation.id === commit.createdWorkItem.conversation.id &&
    current.ordinal === commit.createdWorkItem.ordinal &&
    sameValue(current.createdAt, commit.createdWorkItem.createdAt) &&
    current.creationReasonId === commit.createdWorkItem.creationReasonId &&
    sameValue(current.createdBy, commit.createdWorkItem.createdBy) &&
    String(row.conversation_id) ===
      String(commit.intakeDecision.conversation.id) &&
    row.transport === commit.intakeDecision.transport &&
    row.policy_id === commit.intakeDecision.policyId &&
    row.policy_version === commit.intakeDecision.policyVersion &&
    parseDatabaseBigint(row.policy_revision, "creation policy revision") ===
      commit.intakeDecision.policyRevision &&
    parseDatabaseBigint(row.decision_revision, "creation decision revision") ===
      commit.intakeDecision.decisionRevision &&
    row.decided_by_trusted_service_id ===
      commit.intakeDecision.decidedByTrustedServiceId &&
    Date.parse(parseTimestamp(row.decided_at, "creation decidedAt")) ===
      Date.parse(commit.intakeDecision.decidedAt) &&
    row.work_queue_id === commit.queueSnapshot.id &&
    parseDatabaseBigint(row.work_queue_revision, "creation Queue revision") ===
      commit.queueSnapshot.revision &&
    row.latest_terminal_handling ===
      commit.intakeDecision.latestTerminalHandling &&
    row.reason_id === commit.intakeDecision.reasonId &&
    parseDatabaseBigint(row.slot_before_revision, "creation slot before") ===
      commit.slotBefore.revision &&
    parseDatabaseBigint(row.slot_after_revision, "creation slot after") ===
      commit.slotAfter.revision
  );
}

async function loadCurrentQueueSnapshot(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    workQueueId: InboxV2WorkQueueId;
    lock: boolean;
  }
): Promise<InboxV2WorkQueue | null> {
  let revision: InboxV2EntityRevision | null = null;
  if (input.lock) {
    const result = await executor.execute<QueueHeadRow>(
      buildLockInboxV2WorkQueueHeadSql(input)
    );
    assertAtMostOneRow(result, "WorkQueue head lock");
    if (result.rows.length === 0) return null;
    revision = parseRevision(
      result.rows[0]?.current_revision,
      "Queue head revision"
    );
  } else {
    const result = await executor.execute<QueueHeadRow>(sql`
      select current_revision
      from inbox_v2_work_queue_heads
      where tenant_id = ${input.tenantId}
        and work_queue_id = ${input.workQueueId}
    `);
    assertAtMostOneRow(result, "WorkQueue head lookup");
    if (result.rows.length === 0) return null;
    revision = parseRevision(
      result.rows[0]?.current_revision,
      "Queue head revision"
    );
  }
  return loadQueueSnapshotVersion(executor, { ...input, revision });
}

async function loadQueueSnapshotVersion(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    workQueueId: InboxV2WorkQueueId;
    revision: InboxV2EntityRevision;
  }
): Promise<InboxV2WorkQueue | null> {
  const result = await executor.execute<QueueVersionRow>(
    buildFindInboxV2WorkQueueVersionSql(input)
  );
  assertAtMostOneRow(result, "WorkQueue version lookup");
  return result.rows[0] === undefined
    ? null
    : mapQueueVersion(result.rows[0], input.tenantId);
}

async function loadEmployeeFence(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
    lock: boolean;
    preserveRecordedLoadedAt: boolean;
  }
): Promise<InboxV2EmployeeAssignmentEligibilityFence | null> {
  const result = await executor.execute<EmployeeFenceHeadRow>(
    buildFindCurrentInboxV2EmployeeAssignmentFenceSql(input)
  );
  assertAtMostOneRow(result, "Employee assignment-fence lookup");
  if (result.rows[0] === undefined) return null;
  return inboxV2EmployeeAssignmentEligibilityFenceSchema.parse({
    tenantId: input.tenantId,
    employee: {
      tenantId: input.tenantId,
      kind: "employee",
      id: input.employeeId
    },
    state: result.rows[0].state,
    generation: parseDatabaseBigint(
      result.rows[0].current_generation,
      "Employee fence generation"
    ),
    revision: parseDatabaseBigint(
      result.rows[0].current_revision,
      "Employee fence revision"
    ),
    effectiveFrom: parseTimestamp(
      result.rows[0].effective_from,
      "Employee fence effectiveFrom"
    ),
    loadedAt: parseTimestamp(
      result.rows[0].loaded_at,
      "Employee fence loadedAt"
    )
  });
}

async function loadEmployeeFenceVersion(
  executor: RawSqlExecutor,
  input: {
    tenantId: InboxV2TenantId;
    employeeId: InboxV2EmployeeId;
    revision: InboxV2EntityRevision;
  }
): Promise<Readonly<{
  fence: InboxV2EmployeeAssignmentEligibilityFence;
  reasonId: string;
  changedByTrustedServiceId: string;
}> | null> {
  const result = await executor.execute<EmployeeFenceVersionRow>(
    buildFindInboxV2EmployeeAssignmentFenceVersionSql(input)
  );
  assertAtMostOneRow(result, "Employee assignment-fence version lookup");
  const row = result.rows[0];
  if (row === undefined) return null;
  return {
    fence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse({
      tenantId: row.tenant_id,
      employee: {
        tenantId: row.tenant_id,
        kind: "employee",
        id: row.employee_id
      },
      state: row.state,
      generation: parseDatabaseBigint(
        row.generation,
        "Employee fence generation"
      ),
      revision: parseDatabaseBigint(row.revision, "Employee fence revision"),
      effectiveFrom: parseTimestamp(
        row.effective_from,
        "Employee fence effectiveFrom"
      ),
      loadedAt: parseTimestamp(row.recorded_at, "Employee fence recordedAt")
    }),
    reasonId: parseCatalogId(row.reason_id, "Employee fence reasonId"),
    changedByTrustedServiceId: parseCatalogId(
      row.changed_by_trusted_service_id,
      "Employee fence trusted service"
    )
  };
}

async function hasActiveEmployeeAssignments(
  executor: RawSqlExecutor,
  input: { tenantId: InboxV2TenantId; employeeId: InboxV2EmployeeId }
): Promise<boolean> {
  const result = await executor.execute<IdRow>(
    buildHasInboxV2ActiveEmployeeAssignmentsSql(input)
  );
  if (result.rows.length > 1) {
    throw invariantError(
      "Active Employee assignment probe returned more than one row."
    );
  }
  return result.rows.length === 1;
}

function mapWorkItemRow(
  row: WorkItemRow,
  slaRow: WorkItemSlaRow,
  assignment: InboxV2WorkItemPrimaryAssignment | null,
  teamEpisode: InboxV2WorkItemServicingTeamEpisode | null,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItem {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("WorkItem tenant mismatch.");
  }
  if (
    assignment !== null &&
    (assignment.tenantId !== tenantId ||
      assignment.workItem.id !== row.id ||
      assignment.state !== "active" ||
      assignment.revision !== "1")
  ) {
    throw invariantError(
      "WorkItem current assignment pointer is not an exact active revision-1 episode."
    );
  }
  if (
    teamEpisode !== null &&
    (teamEpisode.tenantId !== tenantId ||
      teamEpisode.workItem.id !== row.id ||
      teamEpisode.team.id !== row.current_servicing_team_id ||
      teamEpisode.state !== "active" ||
      teamEpisode.revision !== "1")
  ) {
    throw invariantError(
      "WorkItem current servicing-team pointer is not an exact active revision-1 episode."
    );
  }
  const state = String(row.state);
  const queueHead = {
    queue: {
      tenantId,
      kind: "work_queue" as const,
      id: row.queue_id
    },
    queueRevision: parseDatabaseBigint(
      row.queue_revision,
      "WorkItem Queue revision"
    )
  };
  const primaryHead =
    assignment === null
      ? null
      : {
          assignment: {
            tenantId,
            kind: "work_item_primary_assignment" as const,
            id: assignment.id
          },
          employee: assignment.employee,
          eligibilityDecision: {
            tenantId,
            kind: "work_queue_eligibility_decision" as const,
            id: assignment.eligibilityDecision.id
          },
          employeeFenceGenerationAtStart:
            assignment.employeeFenceGenerationAtStart,
          assignedAt: assignment.startedAt,
          assignmentRevision: assignment.revision
        };
  const terminal = nullableJson(row.terminal_snapshot);
  const operationalState =
    state === "resolved" || state === "dismissed"
      ? { state, activeQueue: null, primaryAssignment: null, terminal }
      : {
          state,
          activeQueue: queueHead,
          primaryAssignment: primaryHead,
          terminal: null
        };
  const currentServicingTeam =
    teamEpisode === null
      ? null
      : {
          workItem: teamEpisode.workItem,
          episode: {
            tenantId,
            kind: "work_item_servicing_team_episode" as const,
            id: teamEpisode.id
          },
          team: teamEpisode.team,
          workItemCycle: teamEpisode.workItemCycle,
          startedAt: teamEpisode.startedAt,
          episodeRevision: teamEpisode.revision
        };
  return inboxV2WorkItemSchema.parse({
    tenantId,
    id: row.id,
    conversation: {
      tenantId,
      kind: "conversation",
      id: row.conversation_id
    },
    ordinal: parseDatabaseBigint(row.ordinal, "WorkItem ordinal"),
    operationalState,
    priorityId: row.priority_id,
    sla: mapSlaRow(slaRow, tenantId),
    currentServicingTeam,
    servicingTeamRelationRevision: parseDatabaseBigint(
      row.servicing_team_relation_revision,
      "WorkItem servicing-team revision"
    ),
    collaboratorSetRevision: parseDatabaseBigint(
      row.collaborator_set_revision,
      "WorkItem collaborator revision"
    ),
    resourceAccessRevision: parseDatabaseBigint(
      row.resource_access_revision,
      "WorkItem resource access revision"
    ),
    reopenCycle: parseDatabaseBigint(row.reopen_cycle, "WorkItem reopen cycle"),
    lastReopen: nullableJson(row.last_reopen_snapshot),
    createdBy: mapWorkActor({
      tenantId,
      kind: row.created_actor_kind,
      employeeId: row.created_actor_employee_id,
      authorizationEpoch: row.created_actor_authorization_epoch,
      trustedServiceId: row.created_actor_trusted_service_id
    }),
    creationReasonId: row.creation_reason_id,
    revision: parseDatabaseBigint(row.revision, "WorkItem revision"),
    createdAt: parseTimestamp(row.created_at, "WorkItem createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "WorkItem updatedAt")
  });
}

function mapSlaRow(row: WorkItemSlaRow, tenantId: InboxV2TenantId): unknown {
  if (row.kind === "not_applied") {
    return { kind: "not_applied", reasonId: row.absence_reason_id };
  }
  return {
    kind: "tracked",
    snapshot: {
      tenantId,
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      policyRevision: parseDatabaseBigint(
        row.policy_revision,
        "SLA policy revision"
      ),
      inputRevision: parseDatabaseBigint(
        row.input_revision,
        "SLA input revision"
      ),
      businessCalendarId: row.business_calendar_id,
      businessCalendarVersion: row.business_calendar_version,
      businessCalendarRevision: parseDatabaseBigint(
        row.business_calendar_revision,
        "SLA business calendar revision"
      ),
      timeZone: row.time_zone,
      clockState: row.clock_state,
      startedAt: parseTimestamp(row.started_at, "SLA startedAt"),
      pausedAt: nullableTimestamp(row.paused_at, "SLA pausedAt"),
      pauseConditionId: row.pause_condition_id,
      stoppedAt: nullableTimestamp(row.stopped_at, "SLA stoppedAt"),
      firstHumanResponseDueAt: nullableTimestamp(
        row.first_human_response_due_at,
        "SLA first response due"
      ),
      resolutionDueAt: nullableTimestamp(
        row.resolution_due_at,
        "SLA resolution due"
      ),
      firstHumanResponseAt: nullableTimestamp(
        row.first_human_response_at,
        "SLA first response"
      ),
      revision: parseDatabaseBigint(row.revision, "SLA revision"),
      calculatedAt: parseTimestamp(row.calculated_at, "SLA calculatedAt")
    }
  };
}

function mapAssignmentRow(
  row: AssignmentRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItemPrimaryAssignment {
  const tenantId = inboxV2TenantIdSchema.parse(row.assignment_tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("WorkItem assignment tenant mismatch.");
  }
  const employee = {
    tenantId,
    kind: "employee" as const,
    id: row.assignment_employee_id
  };
  const termination =
    row.assignment_state === "active"
      ? null
      : {
          endedAt: parseTimestamp(row.ended_at, "assignment endedAt"),
          recordedAt: parseTimestamp(
            row.end_recorded_at,
            "assignment recordedAt"
          ),
          basis: row.end_basis,
          endedBy: mapWorkActor({
            tenantId,
            kind: row.ended_actor_kind,
            employeeId: row.ended_actor_employee_id,
            authorizationEpoch: row.ended_actor_authorization_epoch,
            trustedServiceId: row.ended_actor_trusted_service_id
          }),
          reasonId: row.end_reason_id,
          transition: {
            tenantId,
            kind: "work_item_transition" as const,
            id: row.termination_transition_id
          },
          employeeFenceAtEnd:
            row.end_employee_fence_revision === null
              ? null
              : {
                  tenantId,
                  employee,
                  state: row.end_employee_fence_state,
                  generation: parseDatabaseBigint(
                    row.end_employee_fence_generation,
                    "assignment end fence generation"
                  ),
                  revision: parseDatabaseBigint(
                    row.end_employee_fence_revision,
                    "assignment end fence revision"
                  ),
                  effectiveFrom: parseTimestamp(
                    row.end_employee_fence_effective_from,
                    "assignment end fence effectiveFrom"
                  ),
                  loadedAt: parseTimestamp(
                    row.end_employee_fence_loaded_at,
                    "assignment end fence loadedAt"
                  )
                }
        };
  return inboxV2WorkItemPrimaryAssignmentSchema.parse({
    tenantId,
    id: row.assignment_id,
    workItem: {
      tenantId,
      kind: "work_item",
      id: row.assignment_work_item_id
    },
    queueAtStart: {
      queue: {
        tenantId,
        kind: "work_queue",
        id: row.queue_at_start_id
      },
      queueRevision: parseDatabaseBigint(
        row.queue_at_start_revision,
        "assignment Queue revision"
      )
    },
    employee,
    source: row.source,
    eligibilityDecision: mapEligibilityDecisionRow(row, tenantId),
    employeeFenceGenerationAtStart: parseDatabaseBigint(
      row.employee_fence_generation_at_start,
      "assignment fence generation at start"
    ),
    startedAt: parseTimestamp(row.started_at, "assignment startedAt"),
    startedBy: mapWorkActor({
      tenantId,
      kind: row.started_actor_kind,
      employeeId: row.started_actor_employee_id,
      authorizationEpoch: row.started_actor_authorization_epoch,
      trustedServiceId: row.started_actor_trusted_service_id
    }),
    startReasonId: row.start_reason_id,
    state: row.assignment_state,
    termination,
    revision: parseDatabaseBigint(
      row.assignment_revision,
      "assignment revision"
    ),
    createdAt: parseTimestamp(
      row.assignment_created_at,
      "assignment createdAt"
    ),
    updatedAt: parseTimestamp(row.assignment_updated_at, "assignment updatedAt")
  });
}

function mapEligibilityDecisionRow(
  row: EligibilityDecisionRow,
  tenantId: InboxV2TenantId
): unknown {
  const employee = {
    tenantId,
    kind: "employee" as const,
    id: row.decision_employee_id
  };
  return {
    tenantId,
    id: row.decision_id,
    workItem: {
      tenantId,
      kind: "work_item",
      id: row.decision_work_item_id
    },
    expectedWorkItemRevision: parseDatabaseBigint(
      row.expected_work_item_revision,
      "eligibility WorkItem revision"
    ),
    queue: {
      tenantId,
      kind: "work_queue",
      id: row.decision_work_queue_id
    },
    queueRevision: parseDatabaseBigint(
      row.decision_work_queue_revision,
      "eligibility Queue revision"
    ),
    queueLifecycle: row.work_queue_lifecycle,
    employee,
    employeeFence: {
      tenantId,
      employee,
      state: row.employee_fence_state,
      generation: parseDatabaseBigint(
        row.employee_fence_generation,
        "eligibility fence generation"
      ),
      revision: parseDatabaseBigint(
        row.employee_fence_revision,
        "eligibility fence revision"
      ),
      effectiveFrom: parseTimestamp(
        row.employee_fence_effective_from,
        "eligibility fence effectiveFrom"
      ),
      loadedAt: parseTimestamp(
        row.employee_fence_loaded_at,
        "eligibility fence loadedAt"
      )
    },
    policy: {
      policyId: row.policy_id,
      policyVersion: row.policy_version,
      policyRevision: parseDatabaseBigint(
        row.policy_revision,
        "eligibility policy revision"
      )
    },
    eligibilityBasis: row.eligibility_basis,
    eligibilityEvidenceRevision: parseDatabaseBigint(
      row.eligibility_evidence_revision,
      "eligibility evidence revision"
    ),
    effect: row.effect,
    reasonId: row.decision_reason_id,
    decisionRevision: parseDatabaseBigint(
      row.decision_revision,
      "eligibility decision revision"
    ),
    loadedByTrustedServiceId: row.loaded_by_trusted_service_id,
    decidedAt: parseTimestamp(row.decided_at, "eligibility decidedAt"),
    notAfter: parseTimestamp(row.not_after, "eligibility notAfter")
  };
}

function mapWorkItemTransitionRow(
  row: WorkItemTransitionRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItemTransition {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("WorkItem transition tenant mismatch.");
  }
  return inboxV2WorkItemTransitionSchema.parse({
    tenantId,
    id: row.id,
    workItem: { tenantId, kind: "work_item", id: row.work_item_id },
    kind: row.kind,
    fromState: row.from_state,
    toState: row.to_state,
    sourceQueue: {
      queue: { tenantId, kind: "work_queue", id: row.source_queue_id },
      queueRevision: parseDatabaseBigint(
        row.source_queue_revision,
        "transition source Queue revision"
      )
    },
    destinationQueue: {
      queue: { tenantId, kind: "work_queue", id: row.destination_queue_id },
      queueRevision: parseDatabaseBigint(
        row.destination_queue_revision,
        "transition destination Queue revision"
      )
    },
    actor: mapWorkActor({
      tenantId,
      kind: row.actor_kind,
      employeeId: row.actor_employee_id,
      authorizationEpoch: row.actor_authorization_epoch,
      trustedServiceId: row.actor_trusted_service_id
    }),
    reasonId: row.reason_id,
    expectedRevision: parseDatabaseBigint(
      row.expected_revision,
      "transition expected revision"
    ),
    resultingRevision: parseDatabaseBigint(
      row.resulting_revision,
      "transition resulting revision"
    ),
    occurredAt: parseTimestamp(row.occurred_at, "transition occurredAt")
  });
}

function mapWorkItemRelationTransitionRow(
  row: WorkItemRelationTransitionRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItemRelationTransition {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("WorkItem relation transition tenant mismatch.");
  }
  return inboxV2WorkItemRelationTransitionSchema.parse({
    tenantId,
    id: row.id,
    workItem: {
      tenantId,
      kind: "work_item",
      id: row.work_item_id
    },
    kind: row.kind,
    actor: mapWorkActor({
      tenantId,
      kind: row.actor_kind,
      employeeId: row.actor_employee_id,
      authorizationEpoch: row.actor_authorization_epoch,
      trustedServiceId: row.actor_trusted_service_id
    }),
    reasonId: row.reason_id,
    expectedWorkItemRevision: parseDatabaseBigint(
      row.expected_work_item_revision,
      "relation transition expected WorkItem revision"
    ),
    resultingWorkItemRevision: parseDatabaseBigint(
      row.resulting_work_item_revision,
      "relation transition resulting WorkItem revision"
    ),
    expectedRelationRevision: parseDatabaseBigint(
      row.expected_relation_revision,
      "relation transition expected relation revision"
    ),
    resultingRelationRevision: parseDatabaseBigint(
      row.resulting_relation_revision,
      "relation transition resulting relation revision"
    ),
    occurredAt: parseTimestamp(
      row.occurred_at,
      "relation transition occurredAt"
    )
  });
}

function mapServicingTeamEpisodeRow(
  row: ServicingTeamEpisodeRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkItemServicingTeamEpisode {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId) {
    throw invariantError("WorkItem servicing-team tenant mismatch.");
  }
  const termination =
    row.state === "active"
      ? null
      : {
          endedAt: parseTimestamp(row.ended_at, "team episode endedAt"),
          recordedAt: parseTimestamp(
            row.end_recorded_at,
            "team episode recordedAt"
          ),
          cause:
            row.end_cause === "relation_command"
              ? {
                  kind: "relation_command" as const,
                  transition: {
                    tenantId,
                    kind: "work_item_relation_transition" as const,
                    id: row.end_relation_transition_id
                  }
                }
              : {
                  kind: "work_item_terminal" as const,
                  transition: {
                    tenantId,
                    kind: "work_item_transition" as const,
                    id: row.end_work_item_transition_id
                  }
                },
          actor: mapWorkActor({
            tenantId,
            kind: row.ended_actor_kind,
            employeeId: row.ended_actor_employee_id,
            authorizationEpoch: row.ended_actor_authorization_epoch,
            trustedServiceId: row.ended_actor_trusted_service_id
          }),
          reasonId: row.end_reason_id
        };
  const candidate = {
    tenantId,
    id: row.id,
    workItem: { tenantId, kind: "work_item" as const, id: row.work_item_id },
    workItemCycle: parseDatabaseBigint(
      row.work_item_cycle,
      "team WorkItem cycle"
    ),
    team: { tenantId, kind: "team" as const, id: row.team_id },
    startedAt: parseTimestamp(row.started_at, "team startedAt"),
    startedBy: mapWorkActor({
      tenantId,
      kind: row.started_actor_kind,
      employeeId: row.started_actor_employee_id,
      authorizationEpoch: row.started_actor_authorization_epoch,
      trustedServiceId: row.started_actor_trusted_service_id
    }),
    startReasonId: row.start_reason_id,
    state: row.state,
    termination,
    revision: parseDatabaseBigint(row.revision, "team episode revision"),
    createdAt: parseTimestamp(row.created_at, "team episode createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "team episode updatedAt")
  };
  return inboxV2WorkItemServicingTeamEpisodeSchema.parse(candidate);
}

function mapQueueVersion(
  row: QueueVersionRow,
  expectedTenantId: InboxV2TenantId
): InboxV2WorkQueue {
  const tenantId = inboxV2TenantIdSchema.parse(row.tenant_id);
  if (tenantId !== expectedTenantId)
    throw invariantError("Queue tenant mismatch.");
  const defaultSlaPolicy =
    row.default_sla_kind === "not_applied"
      ? { kind: "not_applied" as const }
      : {
          kind: "tracked" as const,
          policyId: row.default_sla_policy_id,
          policyVersion: row.default_sla_policy_version,
          policyRevision: parseDatabaseBigint(
            row.default_sla_policy_revision,
            "Queue default SLA policy revision"
          ),
          businessCalendarId: row.default_business_calendar_id,
          businessCalendarVersion: row.default_business_calendar_version,
          businessCalendarRevision: parseDatabaseBigint(
            row.default_business_calendar_revision,
            "Queue business calendar revision"
          ),
          timeZone: row.default_sla_time_zone
        };
  return inboxV2WorkQueueSchema.parse({
    tenantId,
    id: row.work_queue_id,
    ownerOrgUnit: {
      tenantId,
      kind: "org_unit",
      id: row.owner_org_unit_id
    },
    lifecycle: row.lifecycle,
    eligibilityPolicy: {
      policyId: row.eligibility_policy_id,
      policyVersion: row.eligibility_policy_version,
      policyRevision: parseDatabaseBigint(
        row.eligibility_policy_revision,
        "Queue eligibility policy revision"
      )
    },
    externalReplyPolicy: {
      mode: row.external_reply_policy_mode,
      policyVersion: row.external_reply_policy_version,
      policyRevision: parseDatabaseBigint(
        row.external_reply_policy_revision,
        "Queue reply policy revision"
      )
    },
    defaultPriorityId: row.default_priority_id,
    defaultSlaPolicy,
    resourceAccessRevision: parseDatabaseBigint(
      row.resource_access_revision,
      "Queue resource access revision"
    ),
    revision: parseDatabaseBigint(row.revision, "Queue revision"),
    createdAt: parseTimestamp(row.created_at, "Queue createdAt"),
    updatedAt: parseTimestamp(row.updated_at, "Queue updatedAt")
  });
}

type NormalizedEmployeeFenceAdvance = Readonly<{
  tenantId: InboxV2TenantId;
  employeeId: InboxV2EmployeeId;
  expectedRevision: InboxV2EntityRevision | null;
  next: InboxV2EmployeeAssignmentEligibilityFence;
  reasonId: string;
  changedByTrustedServiceId: string;
}>;

function normalizeEmployeeFenceAdvance(
  input: AdvanceInboxV2EmployeeAssignmentFenceInput
): NormalizedEmployeeFenceAdvance {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const employeeId = inboxV2EmployeeIdSchema.parse(input.employeeId);
  const next = inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
    input.next
  );
  if (
    next.tenantId !== tenantId ||
    next.employee.tenantId !== tenantId ||
    next.employee.id !== employeeId
  ) {
    throw invariantError(
      "Employee fence input crosses its exact tenant/Employee."
    );
  }
  return {
    tenantId,
    employeeId,
    expectedRevision:
      input.expectedRevision === null
        ? null
        : inboxV2EntityRevisionSchema.parse(input.expectedRevision),
    next,
    reasonId: parseCatalogId(input.reasonId, "Employee fence reasonId"),
    changedByTrustedServiceId: parseCatalogId(
      input.changedByTrustedServiceId,
      "Employee fence trusted service"
    )
  };
}

function isValidFenceAdvance(
  current: InboxV2EmployeeAssignmentEligibilityFence | null,
  next: InboxV2EmployeeAssignmentEligibilityFence
): boolean {
  if (current === null) {
    return (
      next.state === "active" &&
      next.revision === "1" &&
      next.generation === "1" &&
      Date.parse(next.loadedAt) >= Date.parse(next.effectiveFrom)
    );
  }
  const stateAdvance =
    (current.state === "active" && next.state === "draining") ||
    (current.state === "draining" && next.state === "inactive");
  return (
    stateAdvance &&
    BigInt(next.revision) === BigInt(current.revision) + 1n &&
    BigInt(next.generation) === BigInt(current.generation) + 1n &&
    Date.parse(next.effectiveFrom) >= Date.parse(current.effectiveFrom) &&
    Date.parse(next.loadedAt) >= Date.parse(next.effectiveFrom) &&
    Date.parse(next.loadedAt) >= Date.parse(current.loadedAt)
  );
}

async function runWorkItemTransaction<TResult>(
  executor: InboxV2WorkItemTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>,
  attempts = WORK_ITEM_TRANSACTION_ATTEMPTS
): Promise<TResult> {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await executor.transaction(work, WORK_ITEM_TRANSACTION_CONFIG);
    } catch (error) {
      if (attempt === attempts || !hasRetryableSqlState(error)) {
        throw error;
      }
    }
  }
  throw invariantError("WorkItem transaction retry exhausted.");
}

async function runWorkItemSnapshotTransaction<TResult>(
  executor: InboxV2WorkItemTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  return executor.transaction(work, WORK_ITEM_SNAPSHOT_TRANSACTION_CONFIG);
}

function hasRetryableSqlState(error: unknown): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const code = Reflect.get(current, "code");
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) return true;
    current = Reflect.get(current, "cause");
  }
  return false;
}

function isNamedRaceViolation(
  error: unknown,
  allowedConstraints: ReadonlySet<string>
): boolean {
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 8; depth += 1) {
    if (
      (typeof current !== "object" || current === null) &&
      typeof current !== "function"
    ) {
      return false;
    }
    if (seen.has(current)) return false;
    seen.add(current);
    const code = Reflect.get(current, "code");
    const constraint = Reflect.get(current, "constraint");
    if (
      (code === "23505" || code === "23P01") &&
      typeof constraint === "string" &&
      allowedConstraints.has(constraint)
    ) {
      return true;
    }
    current = Reflect.get(current, "cause");
  }
  return false;
}

async function expectOneRow(
  executor: RawSqlExecutor,
  statement: SQL,
  operation: string
): Promise<void> {
  const result = await executor.execute<IdRow>(statement);
  if (result.rows.length !== 1) {
    throw invariantError(`${operation} returned ${result.rows.length} rows.`);
  }
}

function assertAtMostOneRow(
  result: RawSqlQueryResult<Record<string, unknown>>,
  operation: string
): void {
  if (result.rows.length > 1) {
    throw invariantError(`${operation} returned more than one row.`);
  }
}

function parseRevision(value: unknown, label: string): InboxV2EntityRevision {
  return inboxV2EntityRevisionSchema.parse(parseDatabaseBigint(value, label));
}

function parseDatabaseBigint(value: unknown, label: string): string {
  let parsed: bigint;
  try {
    parsed = BigInt(value as bigint | boolean | number | string);
  } catch {
    throw invariantError(`${label} is not a PostgreSQL bigint.`);
  }
  if (parsed < 0n || parsed > POSTGRES_BIGINT_MAX) {
    throw invariantError(`${label} is outside the supported bigint range.`);
  }
  return parsed.toString();
}

function parseTimestamp(value: unknown, label: string): string {
  const parsedTimestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (parsedTimestamp === null || Number.isNaN(parsedTimestamp.getTime())) {
    throw invariantError(`${label} is not a finite timestamp.`);
  }
  const normalized = parsedTimestamp.toISOString();
  const parsed = inboxV2TimestampSchema.safeParse(normalized);
  if (!parsed.success)
    throw invariantError(`${label} is not a finite timestamp.`);
  return parsed.data;
}

function parseCatalogId(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    !/^[a-z][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*$/u.test(value)
  ) {
    throw invariantError(`${label} is not a catalog ID.`);
  }
  return value;
}

function nullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw invariantError("Expected a nullable PostgreSQL text value.");
  }
  return value;
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null || value === undefined
    ? null
    : parseTimestamp(value, label);
}

function nullableJson(value: unknown): unknown | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw invariantError("Expected valid PostgreSQL JSON.");
  }
}

function mapWorkActor(input: {
  tenantId: InboxV2TenantId;
  kind: unknown;
  employeeId: unknown;
  authorizationEpoch: unknown;
  trustedServiceId: unknown;
}): InboxV2WorkItem["createdBy"] {
  return inboxV2WorkActorSchema.parse(
    input.kind === "employee"
      ? {
          kind: "employee",
          employee: {
            tenantId: input.tenantId,
            kind: "employee",
            id: input.employeeId
          },
          authorizationEpoch: input.authorizationEpoch
        }
      : {
          kind: "trusted_service",
          trustedServiceId: input.trustedServiceId
        }
  );
}

function workActorColumns(actor: InboxV2WorkItem["createdBy"]): Readonly<{
  kind: "employee" | "trusted_service";
  employeeId: unknown;
  authorizationEpoch: unknown;
  trustedServiceId: unknown;
}> {
  return actor.kind === "employee"
    ? {
        kind: actor.kind,
        employeeId: actor.employee.id,
        authorizationEpoch: actor.authorizationEpoch,
        trustedServiceId: null
      }
    : {
        kind: actor.kind,
        employeeId: null,
        authorizationEpoch: null,
        trustedServiceId: actor.trustedServiceId
      };
}

function currentOrFinalQueueHead(
  workItem: InboxV2WorkItem
): NonNullable<InboxV2WorkItem["operationalState"]["activeQueue"]> {
  const queue =
    workItem.operationalState.activeQueue ??
    workItem.operationalState.terminal?.finalQueue ??
    null;
  if (queue === null) {
    throw invariantError(
      "WorkItem has neither an active nor a final Queue head."
    );
  }
  return queue;
}

function comparePostgresCText(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function sameValue(left: unknown, right: unknown): boolean {
  return (
    stableSerialize(canonicalizePersistenceValue(left)) ===
    stableSerialize(canonicalizePersistenceValue(right))
  );
}

function canonicalizePersistenceValue(value: unknown): unknown {
  if (typeof value === "string") {
    return inboxV2TimestampSchema.safeParse(value).success
      ? new Date(value).toISOString()
      : value;
  }
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalizePersistenceValue);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
      key,
      canonicalizePersistenceValue(entry)
    ])
  );
}

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? String(value);
  }
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableSerialize(object[key])}`)
    .join(",")}}`;
}

function invariantError(message: string): InboxV2PersistenceInvariantError {
  return new InboxV2PersistenceInvariantError(message);
}
