import { z } from "zod";

import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2ConversationReferenceSchema,
  inboxV2ConversationWorkItemSlotIdSchema,
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2WorkItemIdSchema,
  inboxV2WorkItemPrimaryAssignmentIdSchema,
  inboxV2WorkItemPrimaryAssignmentReferenceSchema,
  inboxV2WorkItemReferenceSchema,
  inboxV2WorkItemTransitionIdSchema,
  inboxV2WorkItemTransitionReferenceSchema,
  inboxV2WorkQueueEligibilityDecisionReferenceSchema,
  inboxV2WorkQueueReferenceSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION,
  inboxV2SchemaVersionTokenSchema
} from "./schema-version";
import {
  inboxV2WorkItemCurrentServicingTeamSchema,
  inboxV2WorkItemServicingTeamEpisodeSchema
} from "./work-item-relations";
import {
  inboxV2OwnedWorkItemStateSchema,
  inboxV2TerminalWorkItemStateSchema,
  inboxV2WorkActorSchema,
  inboxV2WorkCounterSchema,
  inboxV2WorkItemStateSchema,
  inboxV2WorkPriorityIdSchema,
  inboxV2WorkReasonIdSchema,
  inboxV2WorkSlaSchema,
  inboxV2WorkSlaSnapshotSchema,
  isInboxV2OwnedWorkItemState,
  isInboxV2TerminalWorkItemState
} from "./work-primitives";
import {
  inboxV2EmployeeAssignmentEligibilityFenceSchema,
  inboxV2WorkQueueEligibilityDecisionSchema,
  inboxV2WorkQueueSchema
} from "./work-queue";

export const INBOX_V2_WORK_ITEM_SCHEMA_ID = "core:inbox-v2.work-item" as const;
export const INBOX_V2_CONVERSATION_WORK_ITEM_SLOT_SCHEMA_ID =
  "core:inbox-v2.conversation-work-item-slot" as const;
export const INBOX_V2_WORK_ITEM_INTAKE_DECISION_SCHEMA_ID =
  "core:inbox-v2.work-item-intake-decision" as const;
export const INBOX_V2_WORK_ITEM_PRIMARY_ASSIGNMENT_SCHEMA_ID =
  "core:inbox-v2.work-item-primary-assignment" as const;
export const INBOX_V2_WORK_ITEM_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.work-item-transition" as const;
export const INBOX_V2_WORK_ITEM_CREATION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.work-item-creation-commit" as const;
export const INBOX_V2_WORK_ITEM_TRANSITION_COMMIT_SCHEMA_ID =
  "core:inbox-v2.work-item-transition-commit" as const;
export const INBOX_V2_WORK_ITEM_RESPONSIBILITY_PROJECTION_SCHEMA_ID =
  "core:inbox-v2.work-item-responsibility-projection" as const;
export const INBOX_V2_WORK_ITEM_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_WORK_ITEM_ASSIGNMENT_HISTORY_PAGE_MAX = 128;

export const INBOX_V2_WORK_ITEM_INTAKE_POLICY_CATALOG =
  "work-item-intake-policy" as const;
const _INBOX_V2_TRUSTED_SERVICE_CATALOG = "trusted-service" as const;

export type InboxV2WorkItemIntakePolicyId = InboxV2CatalogId<
  typeof INBOX_V2_WORK_ITEM_INTAKE_POLICY_CATALOG
>;
type InboxV2TrustedServiceId = InboxV2CatalogId<
  typeof _INBOX_V2_TRUSTED_SERVICE_CATALOG
>;

export const inboxV2WorkItemIntakePolicyIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2WorkItemIntakePolicyId
  );
const inboxV2TrustedServiceIdSchema = inboxV2CatalogIdSchema.transform(
  (value) => value as InboxV2TrustedServiceId
);

export const inboxV2WorkItemQueueHeadSchema = z
  .object({
    queue: inboxV2WorkQueueReferenceSchema,
    queueRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2WorkItemPrimaryAssignmentHeadSchema = z
  .object({
    assignment: inboxV2WorkItemPrimaryAssignmentReferenceSchema,
    employee: inboxV2EmployeeReferenceSchema,
    eligibilityDecision: inboxV2WorkQueueEligibilityDecisionReferenceSchema,
    employeeFenceGenerationAtStart: inboxV2EntityRevisionSchema,
    assignedAt: inboxV2TimestampSchema,
    assignmentRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2WorkItemTerminalMetadataSchema = z
  .object({
    closedByTransition: inboxV2WorkItemTransitionReferenceSchema,
    reasonId: inboxV2WorkReasonIdSchema,
    closedBy: inboxV2WorkActorSchema,
    closedAt: inboxV2TimestampSchema,
    finalQueue: inboxV2WorkItemQueueHeadSchema,
    finalServicingTeam: inboxV2WorkItemCurrentServicingTeamSchema.nullable(),
    finalPrimary: inboxV2WorkItemPrimaryAssignmentHeadSchema.nullable()
  })
  .strict();

export const inboxV2WorkItemReopenMetadataSchema = z
  .object({
    reopenedByTransition: inboxV2WorkItemTransitionReferenceSchema,
    conversation: inboxV2ConversationReferenceSchema,
    previousTerminalState: inboxV2TerminalWorkItemStateSchema,
    trigger: z.enum(["manual", "new_inbound"]),
    triggerReference: inboxV2NormalizedInboundEventReferenceSchema.nullable(),
    policyId: inboxV2WorkItemIntakePolicyIdSchema,
    policyVersion: inboxV2SchemaVersionTokenSchema,
    policyRevision: inboxV2EntityRevisionSchema,
    decidedByTrustedServiceId: inboxV2TrustedServiceIdSchema,
    decisionRevision: inboxV2EntityRevisionSchema,
    evaluatedAt: inboxV2TimestampSchema,
    reopenUntil: inboxV2TimestampSchema.nullable(),
    outcome: z.literal("reopen_existing"),
    destinationQueue: inboxV2WorkItemQueueHeadSchema,
    targetEligibilityDecision:
      inboxV2WorkQueueEligibilityDecisionReferenceSchema.nullable(),
    slaMode: z.enum(["new_cycle", "resume_remaining"]),
    reasonId: inboxV2WorkReasonIdSchema,
    reopenedBy: inboxV2WorkActorSchema,
    reopenedAt: inboxV2TimestampSchema,
    reopenCycle: inboxV2WorkCounterSchema
  })
  .strict();

const newOperationalStateSchema = z
  .object({
    state: z.literal("new"),
    activeQueue: inboxV2WorkItemQueueHeadSchema,
    primaryAssignment: z.null(),
    terminal: z.null()
  })
  .strict();

function ownedOperationalStateSchema<
  const TState extends "assigned" | "in_progress" | "waiting"
>(state: TState) {
  return z
    .object({
      state: z.literal(state),
      activeQueue: inboxV2WorkItemQueueHeadSchema,
      primaryAssignment: inboxV2WorkItemPrimaryAssignmentHeadSchema,
      terminal: z.null()
    })
    .strict();
}

function terminalOperationalStateSchema<
  const TState extends "resolved" | "dismissed"
>(state: TState) {
  return z
    .object({
      state: z.literal(state),
      activeQueue: z.null(),
      primaryAssignment: z.null(),
      terminal: inboxV2WorkItemTerminalMetadataSchema
    })
    .strict();
}

export const inboxV2WorkItemOperationalStateSchema = z.discriminatedUnion(
  "state",
  [
    newOperationalStateSchema,
    ownedOperationalStateSchema("assigned"),
    ownedOperationalStateSchema("in_progress"),
    ownedOperationalStateSchema("waiting"),
    terminalOperationalStateSchema("resolved"),
    terminalOperationalStateSchema("dismissed")
  ]
);

/** Compact aggregate head: histories and many-valued relations stay paged. */
export const inboxV2WorkItemSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    ordinal: inboxV2WorkCounterSchema,
    operationalState: inboxV2WorkItemOperationalStateSchema,
    priorityId: inboxV2WorkPriorityIdSchema,
    sla: inboxV2WorkSlaSchema,
    currentServicingTeam: inboxV2WorkItemCurrentServicingTeamSchema.nullable(),
    servicingTeamRelationRevision: inboxV2EntityRevisionSchema,
    collaboratorSetRevision: inboxV2EntityRevisionSchema,
    resourceAccessRevision: inboxV2EntityRevisionSchema,
    reopenCycle: inboxV2WorkCounterSchema,
    lastReopen: inboxV2WorkItemReopenMetadataSchema.nullable(),
    createdBy: inboxV2WorkActorSchema,
    creationReasonId: inboxV2WorkReasonIdSchema,
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((workItem, context) => {
    addTenantReferenceIssue(context, workItem.tenantId, workItem.conversation, [
      "conversation"
    ]);
    addActorTenantIssue(context, workItem.tenantId, workItem.createdBy, [
      "createdBy"
    ]);
    if (BigInt(workItem.ordinal) < 1n) {
      addIssue(context, ["ordinal"], "WorkItem ordinal must be positive.");
    }
    addOperationalStateTenantIssues(
      context,
      workItem.tenantId,
      workItem.operationalState,
      ["operationalState"]
    );
    if (workItem.currentServicingTeam !== null) {
      for (const [field, reference] of [
        ["workItem", workItem.currentServicingTeam.workItem],
        ["episode", workItem.currentServicingTeam.episode],
        ["team", workItem.currentServicingTeam.team]
      ] as const) {
        addTenantReferenceIssue(context, workItem.tenantId, reference, [
          "currentServicingTeam",
          field
        ]);
      }
      if (
        !sameReference(
          workItem.currentServicingTeam.workItem,
          workItemReferenceOf(workItem)
        ) ||
        workItem.currentServicingTeam.workItemCycle !== workItem.reopenCycle
      ) {
        addIssue(
          context,
          ["currentServicingTeam", "workItemCycle"],
          "Current servicing team must belong to the current WorkItem cycle."
        );
      }
    }
    if (
      isInboxV2TerminalWorkItemState(workItem.operationalState.state) &&
      workItem.currentServicingTeam !== null
    ) {
      addIssue(
        context,
        ["currentServicingTeam"],
        "Terminal WorkItems cannot retain a current servicing-team episode."
      );
    }
    const finalServicingTeam =
      workItem.operationalState.terminal?.finalServicingTeam;
    if (
      finalServicingTeam !== null &&
      finalServicingTeam !== undefined &&
      (!sameReference(
        finalServicingTeam.workItem,
        workItemReferenceOf(workItem)
      ) ||
        finalServicingTeam.workItemCycle !== workItem.reopenCycle)
    ) {
      addIssue(
        context,
        ["operationalState", "terminal", "finalServicingTeam"],
        "Final servicing team must bind the exact terminal WorkItem cycle."
      );
    }
    if (
      workItem.sla.kind === "tracked" &&
      workItem.sla.snapshot.tenantId !== workItem.tenantId
    ) {
      addIssue(context, ["sla"], "WorkItem and SLA must share one tenant.");
    }
    if (
      isInboxV2TerminalWorkItemState(workItem.operationalState.state) &&
      workItem.sla.kind === "tracked" &&
      workItem.sla.snapshot.clockState !== "stopped"
    ) {
      addIssue(
        context,
        ["sla", "snapshot", "clockState"],
        "Terminal WorkItem must stop its current SLA clock snapshot."
      );
    }
    if (
      !isInboxV2TerminalWorkItemState(workItem.operationalState.state) &&
      workItem.sla.kind === "tracked" &&
      workItem.sla.snapshot.clockState === "stopped"
    ) {
      addIssue(
        context,
        ["sla", "snapshot", "clockState"],
        "Non-terminal WorkItem cannot retain a stopped current SLA clock."
      );
    }
    if ((workItem.reopenCycle === "0") !== (workItem.lastReopen === null)) {
      addIssue(
        context,
        ["lastReopen"],
        "Reopen metadata is required exactly after the first reopen cycle."
      );
    }
    if (
      workItem.lastReopen !== null &&
      workItem.lastReopen.reopenCycle !== workItem.reopenCycle
    ) {
      addIssue(
        context,
        ["lastReopen", "reopenCycle"],
        "Last reopen metadata must match the current reopen cycle."
      );
    }
    if (workItem.lastReopen !== null) {
      addTenantReferenceIssue(
        context,
        workItem.tenantId,
        workItem.lastReopen.reopenedByTransition,
        ["lastReopen", "reopenedByTransition"]
      );
      addTenantReferenceIssue(
        context,
        workItem.tenantId,
        workItem.lastReopen.conversation,
        ["lastReopen", "conversation"]
      );
      addActorTenantIssue(
        context,
        workItem.tenantId,
        workItem.lastReopen.reopenedBy,
        ["lastReopen", "reopenedBy"]
      );
      addTenantReferenceIssue(
        context,
        workItem.tenantId,
        workItem.lastReopen.destinationQueue.queue,
        ["lastReopen", "destinationQueue", "queue"]
      );
      if (workItem.lastReopen.triggerReference !== null) {
        addTenantReferenceIssue(
          context,
          workItem.tenantId,
          workItem.lastReopen.triggerReference,
          ["lastReopen", "triggerReference"]
        );
      }
      if (workItem.lastReopen.targetEligibilityDecision !== null) {
        addTenantReferenceIssue(
          context,
          workItem.tenantId,
          workItem.lastReopen.targetEligibilityDecision,
          ["lastReopen", "targetEligibilityDecision"]
        );
      }
      if (
        !sameReference(
          workItem.lastReopen.conversation,
          workItem.conversation
        ) ||
        workItem.lastReopen.decisionRevision !== "1" ||
        (workItem.lastReopen.trigger === "manual") !==
          (workItem.lastReopen.triggerReference === null) ||
        Date.parse(workItem.lastReopen.evaluatedAt) >
          Date.parse(workItem.lastReopen.reopenedAt) ||
        (workItem.lastReopen.reopenUntil !== null &&
          Date.parse(workItem.lastReopen.reopenedAt) >
            Date.parse(workItem.lastReopen.reopenUntil))
      ) {
        addIssue(
          context,
          ["lastReopen", "reopenedAt"],
          "Reopen must occur inside its pinned policy decision window."
        );
      }
    }
    if (!isInboxV2TimestampOrderValid(workItem.createdAt, workItem.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "WorkItem updatedAt cannot precede createdAt."
      );
    }
  });

export const inboxV2ConversationWorkItemSlotLatestSchema = z
  .object({
    workItem: inboxV2WorkItemReferenceSchema,
    ordinal: inboxV2WorkCounterSchema,
    lifecycleClass: z.enum(["non_terminal", "terminal"]),
    lifecycleFenceRevision: inboxV2EntityRevisionSchema
  })
  .strict();
export const inboxV2ConversationWorkItemSlotCurrentSchema = z
  .object({
    workItem: inboxV2WorkItemReferenceSchema,
    ordinal: inboxV2WorkCounterSchema
  })
  .strict();

/**
 * One compact CAS row prevents concurrent non-terminal WorkItems while retaining
 * the latest terminal pointer for responsibility-safe reply decisions.
 */
export const inboxV2ConversationWorkItemSlotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2ConversationWorkItemSlotIdSchema,
    conversation: inboxV2ConversationReferenceSchema,
    latestOrdinal: inboxV2WorkCounterSchema,
    latestWorkItem: inboxV2ConversationWorkItemSlotLatestSchema.nullable(),
    currentNonTerminalWorkItem:
      inboxV2ConversationWorkItemSlotCurrentSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((slot, context) => {
    addTenantReferenceIssue(context, slot.tenantId, slot.conversation, [
      "conversation"
    ]);
    for (const [field, head] of [
      ["latestWorkItem", slot.latestWorkItem],
      ["currentNonTerminalWorkItem", slot.currentNonTerminalWorkItem]
    ] as const) {
      if (head !== null) {
        addTenantReferenceIssue(context, slot.tenantId, head.workItem, [
          field,
          "workItem"
        ]);
      }
    }
    if (slot.latestWorkItem === null) {
      if (
        slot.latestOrdinal !== "0" ||
        slot.currentNonTerminalWorkItem !== null
      ) {
        addIssue(
          context,
          ["latestWorkItem"],
          "Never-work slot must have ordinal zero and no current WorkItem."
        );
      }
    } else {
      if (
        slot.latestOrdinal === "0" ||
        slot.latestWorkItem.ordinal !== slot.latestOrdinal
      ) {
        addIssue(
          context,
          ["latestOrdinal"],
          "Slot latest ordinal must match its latest WorkItem."
        );
      }
      const expectsCurrent =
        slot.latestWorkItem.lifecycleClass === "non_terminal";
      if (expectsCurrent !== (slot.currentNonTerminalWorkItem !== null)) {
        addIssue(
          context,
          ["currentNonTerminalWorkItem"],
          "Only a non-terminal latest WorkItem occupies the current slot."
        );
      }
      if (
        slot.currentNonTerminalWorkItem !== null &&
        (!sameReference(
          slot.currentNonTerminalWorkItem.workItem,
          slot.latestWorkItem.workItem
        ) ||
          slot.currentNonTerminalWorkItem.ordinal !==
            slot.latestWorkItem.ordinal)
      ) {
        addIssue(
          context,
          ["currentNonTerminalWorkItem"],
          "Current and latest slot heads must name the same WorkItem ordinal."
        );
      }
    }
    if (!isInboxV2TimestampOrderValid(slot.createdAt, slot.updatedAt)) {
      addIssue(
        context,
        ["updatedAt"],
        "Conversation WorkItem slot updatedAt cannot precede createdAt."
      );
    }
  });

const intakeDecisionBase = {
  tenantId: inboxV2TenantIdSchema,
  conversation: inboxV2ConversationReferenceSchema,
  transport: z.enum(["internal", "external"]),
  policyId: inboxV2WorkItemIntakePolicyIdSchema,
  policyVersion: inboxV2SchemaVersionTokenSchema,
  policyRevision: inboxV2EntityRevisionSchema,
  decisionRevision: inboxV2EntityRevisionSchema,
  decidedByTrustedServiceId: inboxV2TrustedServiceIdSchema,
  decidedAt: inboxV2TimestampSchema
} as const;

export const inboxV2WorkItemIntakeDecisionSchema = z
  .discriminatedUnion("outcome", [
    z
      .object({
        ...intakeDecisionBase,
        outcome: z.literal("create_work_item"),
        queue: inboxV2WorkQueueReferenceSchema,
        latestTerminalHandling: z.enum([
          "no_latest_work_item",
          "create_sequential"
        ]),
        reasonId: inboxV2WorkReasonIdSchema
      })
      .strict(),
    z
      .object({
        ...intakeDecisionBase,
        outcome: z.literal("no_work_item"),
        reason: z.enum([
          "internal_non_actionable",
          "external_employee_only_non_actionable",
          "external_policy_non_actionable"
        ])
      })
      .strict()
  ])
  .superRefine((decision, context) => {
    addTenantReferenceIssue(context, decision.tenantId, decision.conversation, [
      "conversation"
    ]);
    if (decision.outcome === "create_work_item") {
      addTenantReferenceIssue(context, decision.tenantId, decision.queue, [
        "queue"
      ]);
    } else if (
      (decision.reason === "internal_non_actionable") !==
      (decision.transport === "internal")
    ) {
      addIssue(
        context,
        ["reason"],
        "Internal no-work reason is valid only for internal transport."
      );
    }
    if (decision.decisionRevision !== "1") {
      addIssue(
        context,
        ["decisionRevision"],
        "Intake decision is one immutable server-stamped snapshot."
      );
    }
  });

export const inboxV2WorkItemAssignmentSourceSchema = z.enum([
  "claim",
  "manual_assignment",
  "policy_assignment",
  "transfer",
  "reopen",
  "recovery_transfer"
]);
export const inboxV2WorkItemAssignmentEndSchema = z
  .object({
    endedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    basis: z.enum(["command_time", "employee_fence_time"]),
    endedBy: inboxV2WorkActorSchema,
    reasonId: inboxV2WorkReasonIdSchema,
    transition: inboxV2WorkItemTransitionReferenceSchema,
    employeeFenceAtEnd:
      inboxV2EmployeeAssignmentEligibilityFenceSchema.nullable()
  })
  .strict();

/** One immutable half-open primary-responsibility interval. */
export const inboxV2WorkItemPrimaryAssignmentSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemPrimaryAssignmentIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    queueAtStart: inboxV2WorkItemQueueHeadSchema,
    employee: inboxV2EmployeeReferenceSchema,
    source: inboxV2WorkItemAssignmentSourceSchema,
    eligibilityDecision: inboxV2WorkQueueEligibilityDecisionSchema,
    employeeFenceGenerationAtStart: inboxV2EntityRevisionSchema,
    startedAt: inboxV2TimestampSchema,
    startedBy: inboxV2WorkActorSchema,
    startReasonId: inboxV2WorkReasonIdSchema,
    state: z.enum(["active", "ended"]),
    termination: inboxV2WorkItemAssignmentEndSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((assignment, context) => {
    for (const [field, reference] of [
      ["workItem", assignment.workItem],
      ["queueAtStart", assignment.queueAtStart.queue],
      ["employee", assignment.employee]
    ] as const) {
      addTenantReferenceIssue(context, assignment.tenantId, reference, [field]);
    }
    addActorTenantIssue(context, assignment.tenantId, assignment.startedBy, [
      "startedBy"
    ]);
    if (
      assignment.eligibilityDecision.tenantId !== assignment.tenantId ||
      !sameReference(
        assignment.eligibilityDecision.workItem,
        assignment.workItem
      ) ||
      !sameReference(
        assignment.eligibilityDecision.queue,
        assignment.queueAtStart.queue
      ) ||
      assignment.eligibilityDecision.queueRevision !==
        assignment.queueAtStart.queueRevision ||
      !sameReference(
        assignment.eligibilityDecision.employee,
        assignment.employee
      ) ||
      assignment.eligibilityDecision.effect !== "allow" ||
      assignment.eligibilityDecision.employeeFence.generation !==
        assignment.employeeFenceGenerationAtStart
    ) {
      addIssue(
        context,
        ["eligibilityDecision"],
        "Assignment requires the exact current allow decision and Employee generation."
      );
    }
    if (
      Date.parse(assignment.eligibilityDecision.decidedAt) >
        Date.parse(assignment.startedAt) ||
      Date.parse(assignment.eligibilityDecision.notAfter) <
        Date.parse(assignment.startedAt) ||
      Date.parse(assignment.eligibilityDecision.employeeFence.effectiveFrom) >
        Date.parse(assignment.startedAt)
    ) {
      addIssue(
        context,
        ["startedAt"],
        "Assignment must start inside its eligibility and Employee-fence window."
      );
    }
    if ((assignment.state === "ended") !== (assignment.termination !== null)) {
      addIssue(
        context,
        ["termination"],
        "Ended assignment requires termination; active assignment forbids it."
      );
    }
    if (assignment.revision !== (assignment.state === "active" ? "1" : "2")) {
      addIssue(
        context,
        ["revision"],
        "Assignment episode advances exactly once when it closes."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        assignment.createdAt,
        assignment.startedAt
      ) ||
      !isInboxV2TimestampOrderValid(assignment.createdAt, assignment.updatedAt)
    ) {
      addIssue(
        context,
        ["updatedAt"],
        "Assignment timestamps cannot precede creation."
      );
    }
    if (assignment.termination !== null) {
      addActorTenantIssue(
        context,
        assignment.tenantId,
        assignment.termination.endedBy,
        ["termination", "endedBy"]
      );
      if (
        !isInboxV2TimestampOrderValid(
          assignment.startedAt,
          assignment.termination.endedAt
        ) ||
        !isInboxV2TimestampOrderValid(
          assignment.termination.endedAt,
          assignment.termination.recordedAt
        ) ||
        assignment.updatedAt !== assignment.termination.recordedAt
      ) {
        addIssue(
          context,
          ["termination", "endedAt"],
          "Assignment termination closes its half-open interval and updatedAt."
        );
      }
      if (
        assignment.termination.basis === "employee_fence_time" &&
        (assignment.termination.employeeFenceAtEnd === null ||
          assignment.termination.employeeFenceAtEnd.state === "active" ||
          !sameReference(
            assignment.termination.employeeFenceAtEnd.employee,
            assignment.employee
          ) ||
          assignment.termination.endedAt !==
            assignment.termination.employeeFenceAtEnd.effectiveFrom ||
          Date.parse(assignment.termination.employeeFenceAtEnd.loadedAt) >
            Date.parse(assignment.termination.recordedAt))
      ) {
        addIssue(
          context,
          ["termination", "endedAt"],
          "Fence-based recovery must close history at the immutable fence time."
        );
      }
      if (
        assignment.termination.basis === "command_time" &&
        (assignment.termination.employeeFenceAtEnd !== null ||
          assignment.termination.endedAt !== assignment.termination.recordedAt)
      ) {
        addIssue(
          context,
          ["termination", "employeeFenceAtEnd"],
          "Command-time assignment closure cannot carry a deactivation fence."
        );
      }
    }
  });

export const inboxV2WorkItemAssignmentHistoryPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    asOfWorkItemRevision: inboxV2EntityRevisionSchema,
    predecessorEndedAt: inboxV2TimestampSchema.nullable(),
    items: z
      .array(inboxV2WorkItemPrimaryAssignmentSchema)
      .max(INBOX_V2_WORK_ITEM_ASSIGNMENT_HISTORY_PAGE_MAX),
    nextCursor: z.string().min(1).max(512).nullable(),
    hasMore: z.boolean()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.workItem, [
      "workItem"
    ]);
    for (const [index, item] of page.items.entries()) {
      if (
        item.tenantId !== page.tenantId ||
        !sameReference(item.workItem, page.workItem)
      ) {
        addIssue(
          context,
          ["items", index],
          "Assignment page contains another tenant or WorkItem."
        );
      }
      if (index > 0) {
        const previous = page.items[index - 1];
        const previousEnd = previous?.termination?.endedAt;
        if (
          previousEnd === undefined ||
          Date.parse(previousEnd) > Date.parse(item.startedAt)
        ) {
          addIssue(
            context,
            ["items", index],
            "Assignment history page intervals must be ordered and non-overlapping."
          );
        }
      }
    }
    if (
      page.predecessorEndedAt !== null &&
      page.items[0] !== undefined &&
      Date.parse(page.predecessorEndedAt) > Date.parse(page.items[0].startedAt)
    ) {
      addIssue(
        context,
        ["predecessorEndedAt"],
        "Assignment page predecessor boundary cannot overlap its first row."
      );
    }
    if (page.hasMore !== (page.nextCursor !== null)) {
      addIssue(
        context,
        ["nextCursor"],
        "Assignment page cursor must be present exactly when more rows exist."
      );
    }
  });

export const inboxV2WorkItemTransitionKindSchema = z.enum([
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

export const inboxV2WorkItemTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemTransitionIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    kind: inboxV2WorkItemTransitionKindSchema,
    fromState: inboxV2WorkItemStateSchema,
    toState: inboxV2WorkItemStateSchema,
    sourceQueue: inboxV2WorkItemQueueHeadSchema,
    destinationQueue: inboxV2WorkItemQueueHeadSchema,
    actor: inboxV2WorkActorSchema,
    reasonId: inboxV2WorkReasonIdSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    resultingRevision: inboxV2EntityRevisionSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((transition, context) => {
    addTenantReferenceIssue(context, transition.tenantId, transition.workItem, [
      "workItem"
    ]);
    addActorTenantIssue(context, transition.tenantId, transition.actor, [
      "actor"
    ]);
    for (const [field, queue] of [
      ["sourceQueue", transition.sourceQueue],
      ["destinationQueue", transition.destinationQueue]
    ] as const) {
      addTenantReferenceIssue(context, transition.tenantId, queue.queue, [
        field,
        "queue"
      ]);
    }
    if (
      BigInt(transition.resultingRevision) !==
      BigInt(transition.expectedRevision) + 1n
    ) {
      addIssue(
        context,
        ["resultingRevision"],
        "WorkItem transition must advance revision exactly once."
      );
    }
    if (!isAllowedTransitionKind(transition)) {
      addIssue(
        context,
        ["toState"],
        "WorkItem transition kind does not permit this lifecycle edge."
      );
    }
  });

const inboxV2WorkItemResponsibilityProjectionBaseSchema = z.discriminatedUnion(
  "kind",
  [
    z
      .object({
        kind: z.literal("unassigned"),
        tenantId: inboxV2TenantIdSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        workItemRevision: inboxV2EntityRevisionSchema,
        state: z.union([z.literal("new"), inboxV2TerminalWorkItemStateSchema]),
        effectivePrimary: z.null(),
        evaluatedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("effective_primary"),
        tenantId: inboxV2TenantIdSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        workItemRevision: inboxV2EntityRevisionSchema,
        state: inboxV2OwnedWorkItemStateSchema,
        assignment: inboxV2WorkItemPrimaryAssignmentReferenceSchema,
        assignmentFenceGenerationAtStart: inboxV2EntityRevisionSchema,
        effectivePrimary: inboxV2EmployeeReferenceSchema,
        employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema,
        evaluatedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("responsibility_recovery_pending"),
        tenantId: inboxV2TenantIdSchema,
        workItem: inboxV2WorkItemReferenceSchema,
        workItemRevision: inboxV2EntityRevisionSchema,
        state: inboxV2OwnedWorkItemStateSchema,
        storedAssignment: inboxV2WorkItemPrimaryAssignmentReferenceSchema,
        storedEmployee: inboxV2EmployeeReferenceSchema,
        assignmentFenceGenerationAtStart: inboxV2EntityRevisionSchema,
        effectivePrimary: z.null(),
        employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema,
        cause: z.enum([
          "employee_draining",
          "employee_inactive",
          "employee_generation_changed"
        ]),
        evaluatedAt: inboxV2TimestampSchema
      })
      .strict()
  ]
);

export const inboxV2WorkItemResponsibilityProjectionSchema =
  inboxV2WorkItemResponsibilityProjectionBaseSchema.superRefine(
    (projection, context) => {
      addTenantReferenceIssue(
        context,
        projection.tenantId,
        projection.workItem,
        ["workItem"]
      );
      if (projection.kind === "unassigned") {
        return;
      }
      const employee =
        projection.kind === "effective_primary"
          ? projection.effectivePrimary
          : projection.storedEmployee;
      const assignment =
        projection.kind === "effective_primary"
          ? projection.assignment
          : projection.storedAssignment;
      for (const [field, reference] of [
        ["employee", employee],
        ["assignment", assignment]
      ] as const) {
        addTenantReferenceIssue(context, projection.tenantId, reference, [
          field
        ]);
      }
      const fence = projection.employeeFence;
      if (
        fence.tenantId !== projection.tenantId ||
        !sameReference(fence.employee, employee) ||
        Date.parse(fence.effectiveFrom) > Date.parse(projection.evaluatedAt) ||
        Date.parse(fence.loadedAt) > Date.parse(projection.evaluatedAt)
      ) {
        addIssue(
          context,
          ["employeeFence"],
          "Responsibility projection requires the exact Employee fence current at evaluation."
        );
      }
      if (projection.kind === "effective_primary") {
        if (
          fence.state !== "active" ||
          fence.generation !== projection.assignmentFenceGenerationAtStart
        ) {
          addIssue(
            context,
            ["employeeFence"],
            "Effective primary requires an active unchanged Employee generation."
          );
        }
        return;
      }
      const causeMatches =
        (projection.cause === "employee_draining" &&
          fence.state === "draining") ||
        (projection.cause === "employee_inactive" &&
          fence.state === "inactive") ||
        (projection.cause === "employee_generation_changed" &&
          fence.state === "active" &&
          fence.generation !== projection.assignmentFenceGenerationAtStart);
      if (!causeMatches) {
        addIssue(
          context,
          ["cause"],
          "Recovery cause must match the authoritative Employee fence."
        );
      }
    }
  );

const assignmentEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("open"),
      opened: inboxV2WorkItemPrimaryAssignmentSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("close"),
      before: inboxV2WorkItemPrimaryAssignmentSchema,
      after: inboxV2WorkItemPrimaryAssignmentSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("replace"),
      before: inboxV2WorkItemPrimaryAssignmentSchema,
      after: inboxV2WorkItemPrimaryAssignmentSchema,
      opened: inboxV2WorkItemPrimaryAssignmentSchema
    })
    .strict()
]);

const servicingTeamEffectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z
    .object({
      kind: z.literal("close"),
      before: inboxV2WorkItemServicingTeamEpisodeSchema,
      after: inboxV2WorkItemServicingTeamEpisodeSchema
    })
    .strict()
]);

const inboxV2WorkItemCreationCommitBaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    intakeDecision: inboxV2WorkItemIntakeDecisionSchema,
    queueSnapshot: inboxV2WorkQueueSchema,
    slotBefore: inboxV2ConversationWorkItemSlotSchema,
    previousLatestWorkItem: inboxV2WorkItemSchema.nullable(),
    createdWorkItem: inboxV2WorkItemSchema,
    slotAfter: inboxV2ConversationWorkItemSlotSchema,
    occurredAt: inboxV2TimestampSchema
  })
  .strict();
export const inboxV2WorkItemCreationCommitSchema =
  inboxV2WorkItemCreationCommitBaseSchema.superRefine((commit, context) => {
    addCreationCommitIssues(context, commit);
  });

const inboxV2WorkItemTransitionCommitBaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2WorkItemSchema,
    transition: inboxV2WorkItemTransitionSchema,
    after: inboxV2WorkItemSchema,
    sourceResponsibility:
      inboxV2WorkItemResponsibilityProjectionSchema.nullable(),
    assignmentEffect: assignmentEffectSchema,
    servicingTeamEffect: servicingTeamEffectSchema,
    destinationQueueSnapshot: inboxV2WorkQueueSchema.nullable(),
    slotBefore: inboxV2ConversationWorkItemSlotSchema,
    slotAfter: inboxV2ConversationWorkItemSlotSchema
  })
  .strict();
export const inboxV2WorkItemTransitionCommitSchema =
  inboxV2WorkItemTransitionCommitBaseSchema.superRefine((commit, context) => {
    addTransitionCommitIssues(context, commit);
  });

export const inboxV2WorkItemClaimConflictCodeSchema = z.enum([
  "work.responsibility_conflict",
  "revision.conflict"
]);

export const inboxV2WorkItemEnvelopeSchema = createInboxV2SchemaEnvelopeSchema(
  INBOX_V2_WORK_ITEM_SCHEMA_ID,
  INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
  inboxV2WorkItemSchema
);
export const inboxV2ConversationWorkItemSlotEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_CONVERSATION_WORK_ITEM_SLOT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2ConversationWorkItemSlotSchema
  );
export const inboxV2WorkItemIntakeDecisionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_INTAKE_DECISION_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemIntakeDecisionSchema
  );
export const inboxV2WorkItemPrimaryAssignmentEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_PRIMARY_ASSIGNMENT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemPrimaryAssignmentSchema
  );
export const inboxV2WorkItemTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_TRANSITION_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemTransitionSchema
  );
export const inboxV2WorkItemCreationCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_CREATION_COMMIT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemCreationCommitSchema
  );
export const inboxV2WorkItemTransitionCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_TRANSITION_COMMIT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemTransitionCommitSchema
  );
export const inboxV2WorkItemResponsibilityProjectionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_RESPONSIBILITY_PROJECTION_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_SCHEMA_VERSION,
    inboxV2WorkItemResponsibilityProjectionSchema
  );

export type InboxV2WorkItem = z.infer<typeof inboxV2WorkItemSchema>;
export type InboxV2ConversationWorkItemSlot = z.infer<
  typeof inboxV2ConversationWorkItemSlotSchema
>;
export type InboxV2WorkItemIntakeDecision = z.infer<
  typeof inboxV2WorkItemIntakeDecisionSchema
>;
export type InboxV2WorkItemPrimaryAssignment = z.infer<
  typeof inboxV2WorkItemPrimaryAssignmentSchema
>;
export type InboxV2WorkItemTransition = z.infer<
  typeof inboxV2WorkItemTransitionSchema
>;
export type InboxV2WorkItemCreationCommit = z.infer<
  typeof inboxV2WorkItemCreationCommitSchema
>;
export type InboxV2WorkItemTransitionCommit = z.infer<
  typeof inboxV2WorkItemTransitionCommitSchema
>;
export type InboxV2WorkItemResponsibilityProjection = z.infer<
  typeof inboxV2WorkItemResponsibilityProjectionSchema
>;

/** Recovery is derived from the authoritative Employee fence, never accepted. */
export function deriveInboxV2WorkItemResponsibility(input: {
  workItem: InboxV2WorkItem;
  assignment: InboxV2WorkItemPrimaryAssignment | null;
  employeeFence: z.infer<
    typeof inboxV2EmployeeAssignmentEligibilityFenceSchema
  > | null;
  evaluatedAt: string;
}): InboxV2WorkItemResponsibilityProjection {
  const workItem = inboxV2WorkItemSchema.parse(input.workItem);
  const evaluatedAt = inboxV2TimestampSchema.parse(input.evaluatedAt);
  const state = workItem.operationalState.state;
  const workItemReference = workItemReferenceOf(workItem);

  if (!isInboxV2OwnedWorkItemState(state)) {
    if (input.assignment !== null || input.employeeFence !== null) {
      throw new Error(
        "Unassigned WorkItem cannot receive assignment fence facts."
      );
    }
    return inboxV2WorkItemResponsibilityProjectionSchema.parse({
      kind: "unassigned",
      tenantId: workItem.tenantId,
      workItem: workItemReference,
      workItemRevision: workItem.revision,
      state,
      effectivePrimary: null,
      evaluatedAt
    });
  }

  const assignment = inboxV2WorkItemPrimaryAssignmentSchema.parse(
    input.assignment
  );
  const fence = inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
    input.employeeFence
  );
  const head = workItem.operationalState.primaryAssignment;
  if (head === null) {
    throw new Error(
      "Owned WorkItem must expose its stored primary assignment."
    );
  }
  if (
    assignment.state !== "active" ||
    !sameReference(assignment.workItem, workItemReference) ||
    !assignmentMatchesHead(assignment, head) ||
    !sameReference(fence.employee, head.employee) ||
    fence.tenantId !== workItem.tenantId ||
    Date.parse(fence.effectiveFrom) > Date.parse(evaluatedAt) ||
    Date.parse(fence.loadedAt) > Date.parse(evaluatedAt)
  ) {
    throw new Error(
      "Responsibility facts do not match the exact WorkItem head."
    );
  }

  if (
    fence.state === "active" &&
    fence.generation === head.employeeFenceGenerationAtStart
  ) {
    return inboxV2WorkItemResponsibilityProjectionSchema.parse({
      kind: "effective_primary",
      tenantId: workItem.tenantId,
      workItem: workItemReference,
      workItemRevision: workItem.revision,
      state,
      assignment: head.assignment,
      assignmentFenceGenerationAtStart: head.employeeFenceGenerationAtStart,
      effectivePrimary: head.employee,
      employeeFence: fence,
      evaluatedAt
    });
  }

  const cause =
    fence.state === "draining"
      ? "employee_draining"
      : fence.state === "inactive"
        ? "employee_inactive"
        : "employee_generation_changed";
  return inboxV2WorkItemResponsibilityProjectionSchema.parse({
    kind: "responsibility_recovery_pending",
    tenantId: workItem.tenantId,
    workItem: workItemReference,
    workItemRevision: workItem.revision,
    state,
    storedAssignment: head.assignment,
    storedEmployee: head.employee,
    assignmentFenceGenerationAtStart: head.employeeFenceGenerationAtStart,
    effectivePrimary: null,
    employeeFence: fence,
    cause,
    evaluatedAt
  });
}

/** Distinguishes a same-revision claim race from an already stale request. */
export function classifyInboxV2WorkItemClaimConflict(input: {
  requestedWorkItem: z.input<typeof inboxV2WorkItemReferenceSchema>;
  requestedExpectedRevision: string;
  winningTransition: InboxV2WorkItemTransition;
}): z.infer<typeof inboxV2WorkItemClaimConflictCodeSchema> {
  const winner = inboxV2WorkItemTransitionSchema.parse(input.winningTransition);
  const expected = inboxV2EntityRevisionSchema.parse(
    input.requestedExpectedRevision
  );
  const requestedWorkItem = inboxV2WorkItemReferenceSchema.parse(
    input.requestedWorkItem
  );
  return sameReference(requestedWorkItem, winner.workItem) &&
    winner.expectedRevision === expected &&
    (winner.kind === "claim" ||
      winner.kind === "assign" ||
      winner.kind === "reopen_assigned")
    ? "work.responsibility_conflict"
    : "revision.conflict";
}

function addCreationCommitIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemCreationCommitBaseSchema>
): void {
  if (
    commit.intakeDecision.outcome !== "create_work_item" ||
    commit.tenantId !== commit.intakeDecision.tenantId ||
    commit.tenantId !== commit.queueSnapshot.tenantId ||
    commit.tenantId !== commit.slotBefore.tenantId ||
    commit.tenantId !== commit.createdWorkItem.tenantId ||
    commit.tenantId !== commit.slotAfter.tenantId
  ) {
    addIssue(
      context,
      ["tenantId"],
      "Creation commit requires one create decision and tenant."
    );
    return;
  }
  const workItem = commit.createdWorkItem;
  const workItemReference = workItemReferenceOf(workItem);
  const queueReference = workQueueReferenceOf(commit.queueSnapshot);
  if (
    commit.queueSnapshot.lifecycle !== "active" ||
    !sameReference(commit.intakeDecision.queue, queueReference) ||
    !sameReference(workItem.conversation, commit.intakeDecision.conversation) ||
    !sameReference(workItem.conversation, commit.slotBefore.conversation) ||
    !sameReference(workItem.conversation, commit.slotAfter.conversation) ||
    workItem.operationalState.state !== "new" ||
    !sameReference(
      workItem.operationalState.activeQueue.queue,
      queueReference
    ) ||
    workItem.operationalState.activeQueue.queueRevision !==
      commit.queueSnapshot.revision ||
    workItem.revision !== "1" ||
    workItem.reopenCycle !== "0" ||
    workItem.currentServicingTeam !== null ||
    workItem.servicingTeamRelationRevision !== "1" ||
    workItem.collaboratorSetRevision !== "1" ||
    workItem.resourceAccessRevision !== "1" ||
    workItem.priorityId !== commit.queueSnapshot.defaultPriorityId ||
    !slaMatchesQueueCreation(
      workItem,
      commit.queueSnapshot,
      commit.occurredAt
    ) ||
    workItem.creationReasonId !== commit.intakeDecision.reasonId ||
    workItem.createdBy.kind !== "trusted_service" ||
    workItem.createdBy.trustedServiceId !==
      commit.intakeDecision.decidedByTrustedServiceId ||
    Date.parse(commit.intakeDecision.decidedAt) >
      Date.parse(commit.occurredAt) ||
    Date.parse(commit.queueSnapshot.updatedAt) >
      Date.parse(commit.occurredAt) ||
    Date.parse(commit.slotBefore.updatedAt) > Date.parse(commit.occurredAt) ||
    workItem.createdAt !== commit.occurredAt ||
    workItem.updatedAt !== commit.occurredAt
  ) {
    addIssue(
      context,
      ["createdWorkItem"],
      "Creation must produce revision-one unassigned work in the exact active Queue."
    );
  }
  if (commit.slotBefore.currentNonTerminalWorkItem !== null) {
    addIssue(
      context,
      ["slotBefore", "currentNonTerminalWorkItem"],
      "Cannot create a second non-terminal WorkItem."
    );
  }
  if (commit.slotBefore.latestWorkItem === null) {
    if (
      commit.previousLatestWorkItem !== null ||
      commit.intakeDecision.latestTerminalHandling !== "no_latest_work_item"
    ) {
      addIssue(
        context,
        ["previousLatestWorkItem"],
        "First WorkItem has no previous latest WorkItem."
      );
    }
  } else if (
    commit.previousLatestWorkItem === null ||
    !isInboxV2TerminalWorkItemState(
      commit.previousLatestWorkItem.operationalState.state
    ) ||
    !sameReference(
      workItemReferenceOf(commit.previousLatestWorkItem),
      commit.slotBefore.latestWorkItem.workItem
    ) ||
    commit.previousLatestWorkItem.ordinal !==
      commit.slotBefore.latestWorkItem.ordinal ||
    commit.previousLatestWorkItem.revision !==
      commit.slotBefore.latestWorkItem.lifecycleFenceRevision ||
    commit.previousLatestWorkItem.id === workItem.id ||
    commit.slotBefore.latestWorkItem.lifecycleClass !== "terminal" ||
    commit.intakeDecision.latestTerminalHandling !== "create_sequential"
  ) {
    addIssue(
      context,
      ["previousLatestWorkItem"],
      "Sequential creation must prove the exact previous terminal latest WorkItem."
    );
  }
  const expectedOrdinal = String(BigInt(commit.slotBefore.latestOrdinal) + 1n);
  if (
    workItem.ordinal !== expectedOrdinal ||
    commit.slotAfter.latestOrdinal !== expectedOrdinal ||
    commit.slotAfter.latestWorkItem === null ||
    commit.slotAfter.currentNonTerminalWorkItem === null ||
    !sameReference(
      commit.slotAfter.latestWorkItem.workItem,
      workItemReference
    ) ||
    !sameReference(
      commit.slotAfter.currentNonTerminalWorkItem.workItem,
      workItemReference
    ) ||
    commit.slotAfter.latestWorkItem.lifecycleClass !== "non_terminal" ||
    commit.slotAfter.latestWorkItem.lifecycleFenceRevision !==
      workItem.revision ||
    BigInt(commit.slotAfter.revision) !==
      BigInt(commit.slotBefore.revision) + 1n ||
    commit.slotAfter.updatedAt !== commit.occurredAt ||
    commit.slotAfter.createdAt !== commit.slotBefore.createdAt ||
    commit.slotAfter.id !== commit.slotBefore.id
  ) {
    addIssue(
      context,
      ["slotAfter"],
      "Creation must claim the exact next Conversation WorkItem slot revision."
    );
  }
}

function addTransitionCommitIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const { before, transition, after } = commit;
  if (
    commit.tenantId !== before.tenantId ||
    commit.tenantId !== transition.tenantId ||
    commit.tenantId !== after.tenantId ||
    commit.tenantId !== commit.slotBefore.tenantId ||
    commit.tenantId !== commit.slotAfter.tenantId ||
    before.id !== after.id ||
    !sameReference(workItemReferenceOf(before), transition.workItem) ||
    !sameReference(before.conversation, after.conversation) ||
    !sameReference(before.conversation, commit.slotBefore.conversation) ||
    !sameReference(before.conversation, commit.slotAfter.conversation) ||
    before.ordinal !== after.ordinal ||
    before.revision !== transition.expectedRevision ||
    after.revision !== transition.resultingRevision ||
    before.operationalState.state !== transition.fromState ||
    after.operationalState.state !== transition.toState ||
    after.createdAt !== before.createdAt ||
    after.updatedAt !== transition.occurredAt ||
    Date.parse(before.updatedAt) > Date.parse(transition.occurredAt)
  ) {
    addIssue(
      context,
      ["after"],
      "Transition commit must bind one exact WorkItem before/after CAS revision."
    );
  }

  addSourceResponsibilityIssues(context, commit);
  addAssignmentEffectIssues(context, commit);
  addQueueMutationIssues(context, commit);
  addFieldMutationIssues(context, commit);
  addTerminalAndReopenIssues(context, commit);
  addServicingTeamEffectIssues(context, commit);
  addSlotTransitionIssues(context, commit);
}

function addSourceResponsibilityIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const state = commit.before.operationalState.state;
  const head = commit.before.operationalState.primaryAssignment;
  const decision = commit.sourceResponsibility;
  if (!isInboxV2OwnedWorkItemState(state)) {
    if (decision !== null) {
      addIssue(
        context,
        ["sourceResponsibility"],
        "Unassigned or terminal source state has no responsibility decision."
      );
    }
    return;
  }
  const isRecovery =
    commit.transition.kind === "recovery_requeue" ||
    commit.transition.kind === "recovery_transfer";
  if (
    decision === null ||
    head === null ||
    decision.tenantId !== commit.tenantId ||
    !sameReference(decision.workItem, commit.transition.workItem) ||
    decision.workItemRevision !== commit.before.revision ||
    decision.state !== state ||
    decision.evaluatedAt !== commit.transition.occurredAt ||
    decision.employeeFence.loadedAt !== commit.transition.occurredAt
  ) {
    addIssue(
      context,
      ["sourceResponsibility"],
      "Owned mutation requires an exact current responsibility decision."
    );
    return;
  }
  const decisionAssignment =
    decision.kind === "effective_primary"
      ? decision.assignment
      : decision.kind === "responsibility_recovery_pending"
        ? decision.storedAssignment
        : null;
  if (
    decisionAssignment === null ||
    !sameReference(decisionAssignment, head.assignment) ||
    (decision.kind === "effective_primary" &&
      (!sameReference(decision.effectivePrimary, head.employee) ||
        decision.assignmentFenceGenerationAtStart !==
          head.employeeFenceGenerationAtStart)) ||
    (decision.kind === "responsibility_recovery_pending" &&
      (!sameReference(decision.storedEmployee, head.employee) ||
        decision.assignmentFenceGenerationAtStart !==
          head.employeeFenceGenerationAtStart))
  ) {
    addIssue(
      context,
      ["sourceResponsibility"],
      "Responsibility decision must bind the exact stored assignment head."
    );
  }
  if (isRecovery) {
    const endedAssignment =
      commit.assignmentEffect.kind === "close" ||
      commit.assignmentEffect.kind === "replace"
        ? commit.assignmentEffect.after
        : null;
    if (
      decision.kind !== "responsibility_recovery_pending" ||
      endedAssignment?.termination?.employeeFenceAtEnd === null ||
      endedAssignment?.termination?.employeeFenceAtEnd === undefined ||
      !sameValue(
        endedAssignment.termination.employeeFenceAtEnd,
        decision.employeeFence
      ) ||
      BigInt(decision.employeeFence.generation) <=
        BigInt(head.employeeFenceGenerationAtStart) ||
      Date.parse(decision.employeeFence.loadedAt) >
        Date.parse(commit.transition.occurredAt)
    ) {
      addIssue(
        context,
        ["sourceResponsibility"],
        "Recovery requires a newer non-effective Employee fence loaded before commit."
      );
    }
  } else if (decision.kind !== "effective_primary") {
    addIssue(
      context,
      ["sourceResponsibility"],
      "Normal owned mutation is forbidden while responsibility recovery is pending."
    );
  }
}

function addAssignmentEffectIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const beforeHead = commit.before.operationalState.primaryAssignment;
  const afterHead = commit.after.operationalState.primaryAssignment;
  const requiredEffect = assignmentEffectForTransition(
    commit.transition.kind,
    beforeHead !== null
  );
  if (commit.assignmentEffect.kind !== requiredEffect) {
    addIssue(
      context,
      ["assignmentEffect", "kind"],
      `Transition requires ${requiredEffect} assignment effect.`
    );
    return;
  }
  const effect = commit.assignmentEffect;
  if (effect.kind === "none") {
    if (!sameNullableValue(beforeHead, afterHead)) {
      addIssue(
        context,
        ["assignmentEffect"],
        "No-effect transition cannot mutate primary assignment."
      );
    }
    return;
  }
  if (effect.kind === "open") {
    if (
      beforeHead !== null ||
      afterHead === null ||
      !assignmentMatchesHead(effect.opened, afterHead) ||
      !sameReference(effect.opened.workItem, commit.transition.workItem) ||
      effect.opened.startedAt !== commit.transition.occurredAt ||
      effect.opened.createdAt !== commit.transition.occurredAt ||
      effect.opened.updatedAt !== commit.transition.occurredAt ||
      effect.opened.eligibilityDecision.expectedWorkItemRevision !==
        commit.transition.expectedRevision ||
      effect.opened.eligibilityDecision.decidedAt !==
        commit.transition.occurredAt ||
      effect.opened.eligibilityDecision.employeeFence.loadedAt !==
        commit.transition.occurredAt ||
      !openedAssignmentMatchesTransition(effect.opened, commit.transition) ||
      !sameReference(
        effect.opened.queueAtStart.queue,
        currentQueueHead(commit.after)?.queue ??
          effect.opened.queueAtStart.queue
      )
    ) {
      addIssue(
        context,
        ["assignmentEffect", "opened"],
        "Assignment open must create the exact current active primary."
      );
    }
    return;
  }
  if (
    beforeHead === null ||
    !assignmentMatchesHead(effect.before, beforeHead) ||
    !sameReference(effect.before.workItem, commit.transition.workItem) ||
    !sameReference(effect.after.workItem, commit.transition.workItem) ||
    !isExactEndedAssignment(effect.before, effect.after, commit.transition)
  ) {
    addIssue(
      context,
      ["assignmentEffect"],
      "Assignment close must end the exact prior active episode once."
    );
  }
  if (effect.kind === "close") {
    if (afterHead !== null) {
      addIssue(
        context,
        ["after", "operationalState", "primaryAssignment"],
        "Assignment close must leave no current primary."
      );
    }
  } else if (
    afterHead === null ||
    !assignmentMatchesHead(effect.opened, afterHead) ||
    !sameReference(effect.opened.workItem, commit.transition.workItem) ||
    effect.opened.startedAt !== commit.transition.occurredAt ||
    effect.opened.createdAt !== commit.transition.occurredAt ||
    effect.opened.updatedAt !== commit.transition.occurredAt ||
    effect.opened.eligibilityDecision.expectedWorkItemRevision !==
      commit.transition.expectedRevision ||
    effect.opened.eligibilityDecision.decidedAt !==
      commit.transition.occurredAt ||
    effect.opened.eligibilityDecision.employeeFence.loadedAt !==
      commit.transition.occurredAt ||
    !openedAssignmentMatchesTransition(effect.opened, commit.transition) ||
    effect.opened.id === effect.before.id ||
    (sameReference(effect.opened.employee, effect.before.employee) &&
      sameReference(
        effect.opened.queueAtStart.queue,
        effect.before.queueAtStart.queue
      ))
  ) {
    addIssue(
      context,
      ["assignmentEffect", "opened"],
      "Transfer must atomically open a distinct exact eligible assignment."
    );
  }
}

function addQueueMutationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const beforeQueue = currentOrFinalQueueHead(commit.before);
  const afterQueue = currentOrFinalQueueHead(commit.after);
  const changed = !sameValue(beforeQueue, afterQueue);
  if (
    !sameValue(commit.transition.sourceQueue, beforeQueue) ||
    !sameValue(commit.transition.destinationQueue, afterQueue)
  ) {
    addIssue(
      context,
      ["transition", "destinationQueue"],
      "Immutable transition history must retain exact source/destination Queue heads."
    );
  }
  const allowsQueueChange = new Set([
    "release",
    "transfer",
    "queue_transfer",
    "reopen_unassigned",
    "reopen_assigned",
    "recovery_requeue",
    "recovery_transfer"
  ]).has(commit.transition.kind);
  if (changed && !allowsQueueChange) {
    addIssue(
      context,
      ["after", "operationalState", "activeQueue"],
      "This transition cannot change Queue."
    );
  }
  if (commit.transition.kind === "queue_transfer" && !changed) {
    addIssue(
      context,
      ["transition", "destinationQueue"],
      "Queue transfer cannot be a no-op."
    );
  }
  const destination = currentQueueHead(commit.after);
  const needsSnapshot =
    destination !== null &&
    (changed ||
      commit.assignmentEffect.kind === "open" ||
      commit.assignmentEffect.kind === "replace" ||
      commit.transition.kind === "reopen_unassigned" ||
      commit.transition.kind === "queue_transfer" ||
      commit.transition.kind === "recovery_requeue");
  if (needsSnapshot) {
    const queue = commit.destinationQueueSnapshot;
    if (
      queue === null ||
      queue.lifecycle !== "active" ||
      queue.tenantId !== commit.tenantId ||
      Date.parse(queue.updatedAt) > Date.parse(commit.transition.occurredAt) ||
      !sameReference(workQueueReferenceOf(queue), destination.queue) ||
      queue.revision !== destination.queueRevision
    ) {
      addIssue(
        context,
        ["destinationQueueSnapshot"],
        "Queue-changing unassigned transition requires the exact active destination Queue."
      );
    }
    const opened =
      commit.assignmentEffect.kind === "open" ||
      commit.assignmentEffect.kind === "replace"
        ? commit.assignmentEffect.opened
        : null;
    if (
      opened !== null &&
      (opened.eligibilityDecision.queueLifecycle !== queue?.lifecycle ||
        !sameValue(
          opened.eligibilityDecision.policy,
          queue?.eligibilityPolicy
        ) ||
        !sameReference(opened.queueAtStart.queue, destination.queue) ||
        opened.queueAtStart.queueRevision !== destination.queueRevision)
    ) {
      addIssue(
        context,
        ["assignmentEffect", "opened", "eligibilityDecision"],
        "Opened assignment must use the exact destination Queue policy snapshot."
      );
    }
  } else if (commit.destinationQueueSnapshot !== null) {
    addIssue(
      context,
      ["destinationQueueSnapshot"],
      "Unneeded destination Queue snapshot is forbidden."
    );
  }
}

function addFieldMutationIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const { before, after, transition } = commit;
  if (
    !sameValue(before.createdBy, after.createdBy) ||
    before.creationReasonId !== after.creationReasonId
  ) {
    addIssue(
      context,
      ["after", "createdBy"],
      "WorkItem creation attribution is immutable."
    );
  }
  if (
    transition.kind !== "priority_change" &&
    before.priorityId !== after.priorityId
  ) {
    addIssue(
      context,
      ["after", "priorityId"],
      "Only priority_change may mutate priority."
    );
  }
  if (
    transition.kind === "priority_change" &&
    before.priorityId === after.priorityId
  ) {
    addIssue(
      context,
      ["after", "priorityId"],
      "Priority change cannot be a no-op."
    );
  }
  const slaMayChange = new Set([
    "sla_refresh",
    "close_resolved",
    "close_dismissed",
    "reopen_unassigned",
    "reopen_assigned"
  ]).has(transition.kind);
  if (!slaMayChange && !sameValue(before.sla, after.sla)) {
    addIssue(context, ["after", "sla"], "This transition cannot mutate SLA.");
  }
  if (transition.kind === "sla_refresh" && sameValue(before.sla, after.sla)) {
    addIssue(context, ["after", "sla"], "SLA refresh cannot be a no-op.");
  }
  if (
    (transition.kind === "priority_change" ||
      transition.kind === "sla_refresh") &&
    !sameValue(before.operationalState, after.operationalState)
  ) {
    addIssue(
      context,
      ["after", "operationalState"],
      "Priority/SLA mutations cannot rewrite lifecycle or terminal history."
    );
  }
  if (
    (transition.kind === "start" ||
      transition.kind === "wait" ||
      transition.kind === "resume") &&
    (!sameNullableValue(
      before.operationalState.activeQueue,
      after.operationalState.activeQueue
    ) ||
      !sameNullableValue(
        before.operationalState.primaryAssignment,
        after.operationalState.primaryAssignment
      ))
  ) {
    addIssue(
      context,
      ["after", "operationalState"],
      "Lifecycle progress cannot rewrite Queue or primary responsibility."
    );
  }
  const closesServicingTeam =
    (transition.kind === "close_resolved" ||
      transition.kind === "close_dismissed") &&
    before.currentServicingTeam !== null;
  const expectedServicingTeamRevision = closesServicingTeam
    ? BigInt(before.servicingTeamRelationRevision) + 1n
    : BigInt(before.servicingTeamRelationRevision);
  if (
    before.collaboratorSetRevision !== after.collaboratorSetRevision ||
    BigInt(after.servicingTeamRelationRevision) !==
      expectedServicingTeamRevision
  ) {
    addIssue(
      context,
      ["after", "collaboratorSetRevision"],
      "Lifecycle transition may advance only the exact terminal servicing-team closure."
    );
  }
  const accessRelationChanged =
    !sameValue(
      commit.before.operationalState.primaryAssignment,
      commit.after.operationalState.primaryAssignment
    ) ||
    !sameValue(
      currentOrFinalQueueHead(commit.before),
      currentOrFinalQueueHead(commit.after)
    ) ||
    isInboxV2TerminalWorkItemState(commit.after.operationalState.state) ||
    isInboxV2TerminalWorkItemState(commit.before.operationalState.state);
  const expectedAccessRevision = accessRelationChanged
    ? BigInt(before.resourceAccessRevision) + 1n
    : BigInt(before.resourceAccessRevision);
  if (BigInt(after.resourceAccessRevision) !== expectedAccessRevision) {
    addIssue(
      context,
      ["after", "resourceAccessRevision"],
      "WorkItem resource-access revision must follow direct authority changes."
    );
  }
  addSlaTransitionIssues(context, commit);
}

function addSlaTransitionIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const { before, after, transition } = commit;
  const isClose =
    transition.kind === "close_resolved" ||
    transition.kind === "close_dismissed";
  const isReopen =
    transition.kind === "reopen_unassigned" ||
    transition.kind === "reopen_assigned";
  if (isClose) {
    if (before.sla.kind === "not_applied") {
      if (!sameValue(before.sla, after.sla)) {
        addIssue(
          context,
          ["after", "sla"],
          "Close cannot synthesize or rewrite an absent SLA."
        );
      }
      return;
    }
    if (
      after.sla.kind !== "tracked" ||
      !sameValue(
        slaImmutableFacts(before.sla.snapshot),
        slaImmutableFacts(after.sla.snapshot)
      ) ||
      after.sla.snapshot.clockState !== "stopped" ||
      after.sla.snapshot.stoppedAt !== transition.occurredAt ||
      BigInt(after.sla.snapshot.revision) !==
        BigInt(before.sla.snapshot.revision) + 1n ||
      after.sla.snapshot.calculatedAt !== transition.occurredAt
    ) {
      addIssue(
        context,
        ["after", "sla"],
        "Close preserves the pinned SLA plan/history and records one stop revision."
      );
    }
    return;
  }
  if (isReopen) {
    const reopen = after.lastReopen;
    if (reopen?.slaMode === "new_cycle") {
      if (
        commit.destinationQueueSnapshot === null ||
        !slaMatchesQueueCreation(
          after,
          commit.destinationQueueSnapshot,
          transition.occurredAt
        )
      ) {
        addIssue(
          context,
          ["after", "sla"],
          "New reopen cycle must use the exact destination Queue SLA policy snapshot."
        );
      }
      return;
    }
    if (before.sla.kind === "not_applied") {
      if (after.sla.kind !== "not_applied") {
        addIssue(
          context,
          ["after", "sla"],
          "Resume cannot invent an SLA absent from the prior cycle."
        );
      }
      return;
    }
    if (
      reopen === null ||
      after.sla.kind !== "tracked" ||
      after.sla.snapshot.clockState === "stopped" ||
      reopen.slaMode !== "resume_remaining" ||
      !sameValue(
        slaPlanIdentity(before.sla.snapshot),
        slaPlanIdentity(after.sla.snapshot)
      ) ||
      BigInt(after.sla.snapshot.revision) !==
        BigInt(before.sla.snapshot.revision) + 1n ||
      after.sla.snapshot.calculatedAt !== transition.occurredAt ||
      !slaObservedTimestampsDoNotFollow(
        after.sla.snapshot,
        transition.occurredAt
      )
    ) {
      addIssue(
        context,
        ["after", "sla"],
        "Reopen must start or resume one explicit non-stopped SLA cycle."
      );
    }
    return;
  }
  if (transition.kind === "sla_refresh") {
    if (
      before.sla.kind !== "tracked" ||
      after.sla.kind !== "tracked" ||
      BigInt(after.sla.snapshot.revision) !==
        BigInt(before.sla.snapshot.revision) + 1n ||
      BigInt(after.sla.snapshot.inputRevision) <
        BigInt(before.sla.snapshot.inputRevision) ||
      after.sla.snapshot.startedAt !== before.sla.snapshot.startedAt ||
      !isMonotonicFirstHumanResponseUpdate(
        before.sla.snapshot.firstHumanResponseAt,
        after.sla.snapshot.firstHumanResponseAt,
        transition.occurredAt
      ) ||
      after.sla.snapshot.calculatedAt !== transition.occurredAt ||
      !slaObservedTimestampsDoNotFollow(
        after.sla.snapshot,
        transition.occurredAt
      )
    ) {
      addIssue(
        context,
        ["after", "sla"],
        "SLA refresh advances one auditable revision and records the first human response once."
      );
    }
  }
}

function addTerminalAndReopenIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const { before, after, transition } = commit;
  const isClose =
    transition.kind === "close_resolved" ||
    transition.kind === "close_dismissed";
  const isReopen =
    transition.kind === "reopen_unassigned" ||
    transition.kind === "reopen_assigned";
  if (isClose) {
    const terminal = after.operationalState.terminal;
    const beforeQueue = currentQueueHead(before);
    const beforePrimary = before.operationalState.primaryAssignment;
    if (
      terminal === null ||
      beforeQueue === null ||
      !sameReference(
        terminal.closedByTransition,
        transitionReferenceOf(transition)
      ) ||
      terminal.reasonId !== transition.reasonId ||
      !sameValue(terminal.closedBy, transition.actor) ||
      terminal.closedAt !== transition.occurredAt ||
      !sameValue(terminal.finalQueue, beforeQueue) ||
      !sameNullableValue(
        terminal.finalServicingTeam,
        before.currentServicingTeam
      ) ||
      !sameNullableValue(terminal.finalPrimary, beforePrimary) ||
      after.reopenCycle !== before.reopenCycle ||
      !sameNullableValue(after.lastReopen, before.lastReopen)
    ) {
      addIssue(
        context,
        ["after", "operationalState", "terminal"],
        "Close must preserve exact event-time Queue/team/primary and terminal metadata."
      );
    }
  } else if (isReopen) {
    const terminal = before.operationalState.terminal;
    const reopen = after.lastReopen;
    if (
      terminal === null ||
      reopen === null ||
      BigInt(after.reopenCycle) !== BigInt(before.reopenCycle) + 1n ||
      reopen.reopenCycle !== after.reopenCycle ||
      reopen.previousTerminalState !== before.operationalState.state ||
      !sameReference(
        reopen.reopenedByTransition,
        transitionReferenceOf(transition)
      ) ||
      reopen.reasonId !== transition.reasonId ||
      !sameValue(reopen.reopenedBy, transition.actor) ||
      reopen.reopenedAt !== transition.occurredAt ||
      !sameNullableValue(
        reopen.destinationQueue,
        after.operationalState.activeQueue
      ) ||
      (transition.kind === "reopen_assigned"
        ? after.operationalState.primaryAssignment === null ||
          reopen.targetEligibilityDecision === null ||
          !sameReference(
            reopen.targetEligibilityDecision,
            after.operationalState.primaryAssignment.eligibilityDecision
          )
        : reopen.targetEligibilityDecision !== null) ||
      after.currentServicingTeam !== null
    ) {
      addIssue(
        context,
        ["after", "lastReopen"],
        "Reopen advances one cycle and never revives prior team/relation state."
      );
    }
  } else if (
    after.reopenCycle !== before.reopenCycle ||
    !sameNullableValue(after.lastReopen, before.lastReopen)
  ) {
    addIssue(
      context,
      ["after", "reopenCycle"],
      "Only reopen may mutate reopen metadata."
    );
  }
}

function addServicingTeamEffectIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const isClose =
    commit.transition.kind === "close_resolved" ||
    commit.transition.kind === "close_dismissed";
  const current = commit.before.currentServicingTeam;
  const effect = commit.servicingTeamEffect;
  if (isClose && current !== null) {
    if (
      effect.kind !== "close" ||
      effect.before.state !== "active" ||
      effect.after.state !== "ended" ||
      !sameValue(servicingTeamHeadOf(effect.before), current) ||
      !sameEndedServicingTeamEpisode(
        effect.before,
        effect.after,
        commit.transition
      )
    ) {
      addIssue(
        context,
        ["servicingTeamEffect"],
        "Terminal transition must close the exact active servicing-team episode."
      );
    }
  } else if (effect.kind !== "none") {
    addIssue(
      context,
      ["servicingTeamEffect"],
      "Only close with an active servicing team has a team effect here."
    );
  }
  if (
    !isClose &&
    !sameNullableValue(
      commit.before.currentServicingTeam,
      commit.after.currentServicingTeam
    )
  ) {
    addIssue(
      context,
      ["after", "currentServicingTeam"],
      "Lifecycle command cannot mutate servicing team except terminal closure."
    );
  }
}

function addSlotTransitionIssues(
  context: z.RefinementCtx,
  commit: z.infer<typeof inboxV2WorkItemTransitionCommitBaseSchema>
): void {
  const { before, after, transition, slotBefore, slotAfter } = commit;
  const reference = workItemReferenceOf(before);
  const isClose =
    transition.kind === "close_resolved" ||
    transition.kind === "close_dismissed";
  const isReopen =
    transition.kind === "reopen_unassigned" ||
    transition.kind === "reopen_assigned";
  if (isClose || isReopen) {
    if (
      slotBefore.id !== slotAfter.id ||
      slotBefore.createdAt !== slotAfter.createdAt ||
      BigInt(slotAfter.revision) !== BigInt(slotBefore.revision) + 1n ||
      slotAfter.updatedAt !== transition.occurredAt ||
      slotBefore.latestWorkItem === null ||
      slotAfter.latestWorkItem === null ||
      !sameReference(slotBefore.latestWorkItem.workItem, reference) ||
      !sameReference(slotAfter.latestWorkItem.workItem, reference) ||
      slotBefore.latestWorkItem.ordinal !== before.ordinal ||
      slotAfter.latestWorkItem.ordinal !== after.ordinal ||
      slotBefore.latestOrdinal !== slotAfter.latestOrdinal
    ) {
      addIssue(
        context,
        ["slotAfter"],
        "Terminal/reopen transition must CAS the exact latest WorkItem slot."
      );
      return;
    }
    if (isClose) {
      if (
        slotBefore.currentNonTerminalWorkItem === null ||
        slotBefore.latestWorkItem.lifecycleClass !== "non_terminal" ||
        slotAfter.currentNonTerminalWorkItem !== null ||
        slotAfter.latestWorkItem.lifecycleClass !== "terminal" ||
        slotAfter.latestWorkItem.lifecycleFenceRevision !== after.revision
      ) {
        addIssue(
          context,
          ["slotAfter"],
          "Close clears current slot but retains the exact terminal latest pointer."
        );
      }
    } else if (
      slotBefore.currentNonTerminalWorkItem !== null ||
      slotBefore.latestWorkItem.lifecycleClass !== "terminal" ||
      slotAfter.currentNonTerminalWorkItem === null ||
      slotAfter.latestWorkItem.lifecycleClass !== "non_terminal" ||
      slotAfter.latestWorkItem.lifecycleFenceRevision !== after.revision
    ) {
      addIssue(
        context,
        ["slotAfter"],
        "Reopen occupies the latest terminal WorkItem slot without changing ordinal."
      );
    }
  } else if (!sameValue(slotBefore, slotAfter)) {
    addIssue(
      context,
      ["slotAfter"],
      "Conversation slot changes only on create, terminal close or reopen."
    );
  }
}

function isAllowedTransitionKind(
  transition: z.infer<typeof inboxV2WorkItemTransitionSchema>
): boolean {
  const { kind, fromState, toState } = transition;
  switch (kind) {
    case "claim":
    case "assign":
      return fromState === "new" && toState === "assigned";
    case "start":
      return fromState === "assigned" && toState === "in_progress";
    case "wait":
      return (
        (fromState === "assigned" || fromState === "in_progress") &&
        toState === "waiting"
      );
    case "resume":
      return fromState === "waiting" && toState === "in_progress";
    case "release":
    case "recovery_requeue":
      return isInboxV2OwnedWorkItemState(fromState) && toState === "new";
    case "transfer":
    case "recovery_transfer":
      return isInboxV2OwnedWorkItemState(fromState) && toState === fromState;
    case "queue_transfer":
      return fromState === "new" && toState === "new";
    case "close_resolved":
      return (
        !isInboxV2TerminalWorkItemState(fromState) && toState === "resolved"
      );
    case "close_dismissed":
      return (
        !isInboxV2TerminalWorkItemState(fromState) && toState === "dismissed"
      );
    case "reopen_unassigned":
      return isInboxV2TerminalWorkItemState(fromState) && toState === "new";
    case "reopen_assigned":
      return (
        isInboxV2TerminalWorkItemState(fromState) && toState === "assigned"
      );
    case "priority_change":
    case "sla_refresh":
      return (
        fromState === toState && !isInboxV2TerminalWorkItemState(fromState)
      );
  }
}

function slaMatchesQueueCreation(
  workItem: z.infer<typeof inboxV2WorkItemSchema>,
  queue: z.infer<typeof inboxV2WorkQueueSchema>,
  occurredAt: string
): boolean {
  if (queue.defaultSlaPolicy.kind === "not_applied") {
    return workItem.sla.kind === "not_applied";
  }
  return (
    workItem.sla.kind === "tracked" &&
    workItem.sla.snapshot.policyId === queue.defaultSlaPolicy.policyId &&
    workItem.sla.snapshot.policyVersion ===
      queue.defaultSlaPolicy.policyVersion &&
    workItem.sla.snapshot.policyRevision ===
      queue.defaultSlaPolicy.policyRevision &&
    workItem.sla.snapshot.businessCalendarId ===
      queue.defaultSlaPolicy.businessCalendarId &&
    workItem.sla.snapshot.businessCalendarVersion ===
      queue.defaultSlaPolicy.businessCalendarVersion &&
    workItem.sla.snapshot.businessCalendarRevision ===
      queue.defaultSlaPolicy.businessCalendarRevision &&
    workItem.sla.snapshot.timeZone === queue.defaultSlaPolicy.timeZone &&
    workItem.sla.snapshot.clockState === "running" &&
    workItem.sla.snapshot.startedAt === occurredAt &&
    workItem.sla.snapshot.pausedAt === null &&
    workItem.sla.snapshot.pauseConditionId === null &&
    workItem.sla.snapshot.stoppedAt === null &&
    workItem.sla.snapshot.firstHumanResponseAt === null &&
    workItem.sla.snapshot.calculatedAt === occurredAt &&
    workItem.sla.snapshot.inputRevision === "1" &&
    workItem.sla.snapshot.revision === "1"
  );
}

function slaImmutableFacts(
  snapshot: z.infer<typeof inboxV2WorkSlaSnapshotSchema>
): unknown {
  const {
    clockState: _clockState,
    pausedAt: _pausedAt,
    pauseConditionId: _pauseConditionId,
    stoppedAt: _stoppedAt,
    revision: _revision,
    calculatedAt: _calculatedAt,
    ...facts
  } = snapshot;
  return facts;
}

function slaPlanIdentity(
  snapshot: z.infer<typeof inboxV2WorkSlaSnapshotSchema>
): unknown {
  return slaImmutableFacts(snapshot);
}

function isMonotonicFirstHumanResponseUpdate(
  before: string | null,
  after: string | null,
  occurredAt: string
): boolean {
  if (after !== null && Date.parse(after) > Date.parse(occurredAt)) {
    return false;
  }
  return before === null || after === before;
}

function slaObservedTimestampsDoNotFollow(
  snapshot: z.infer<typeof inboxV2WorkSlaSnapshotSchema>,
  occurredAt: string
): boolean {
  const boundary = Date.parse(occurredAt);
  return [
    snapshot.startedAt,
    snapshot.pausedAt,
    snapshot.stoppedAt,
    snapshot.firstHumanResponseAt,
    snapshot.calculatedAt
  ].every(
    (timestamp) => timestamp === null || Date.parse(timestamp) <= boundary
  );
}

function assignmentEffectForTransition(
  kind: z.infer<typeof inboxV2WorkItemTransitionKindSchema>,
  hadPrimary: boolean
): "none" | "open" | "close" | "replace" {
  if (kind === "claim" || kind === "assign" || kind === "reopen_assigned") {
    return "open";
  }
  if (
    kind === "release" ||
    kind === "recovery_requeue" ||
    ((kind === "close_resolved" || kind === "close_dismissed") && hadPrimary)
  ) {
    return "close";
  }
  if (kind === "transfer" || kind === "recovery_transfer") {
    return "replace";
  }
  return "none";
}

function assignmentMatchesHead(
  assignment: z.infer<typeof inboxV2WorkItemPrimaryAssignmentSchema>,
  head: z.infer<typeof inboxV2WorkItemPrimaryAssignmentHeadSchema>
): boolean {
  return (
    assignment.state === "active" &&
    assignment.id === head.assignment.id &&
    sameReference(assignment.employee, head.employee) &&
    assignment.eligibilityDecision.id === head.eligibilityDecision.id &&
    assignment.employeeFenceGenerationAtStart ===
      head.employeeFenceGenerationAtStart &&
    assignment.startedAt === head.assignedAt &&
    assignment.revision === head.assignmentRevision
  );
}

function isExactEndedAssignment(
  before: z.infer<typeof inboxV2WorkItemPrimaryAssignmentSchema>,
  after: z.infer<typeof inboxV2WorkItemPrimaryAssignmentSchema>,
  transition: z.infer<typeof inboxV2WorkItemTransitionSchema>
): boolean {
  if (
    before.state !== "active" ||
    after.state !== "ended" ||
    before.id !== after.id ||
    !sameValue(
      {
        ...before,
        state: undefined,
        termination: undefined,
        revision: undefined,
        updatedAt: undefined
      },
      {
        ...after,
        state: undefined,
        termination: undefined,
        revision: undefined,
        updatedAt: undefined
      }
    ) ||
    after.termination === null ||
    !sameReference(
      after.termination.transition,
      transitionReferenceOf(transition)
    ) ||
    !sameValue(after.termination.endedBy, transition.actor) ||
    after.termination.reasonId !== transition.reasonId
  ) {
    return false;
  }
  const isRecovery =
    transition.kind === "recovery_requeue" ||
    transition.kind === "recovery_transfer";
  return isRecovery
    ? after.termination.basis === "employee_fence_time" &&
        after.termination.recordedAt === transition.occurredAt &&
        Date.parse(after.termination.endedAt) <=
          Date.parse(transition.occurredAt)
    : after.termination.basis === "command_time" &&
        after.termination.endedAt === transition.occurredAt &&
        after.termination.recordedAt === transition.occurredAt;
}

function openedAssignmentMatchesTransition(
  assignment: z.infer<typeof inboxV2WorkItemPrimaryAssignmentSchema>,
  transition: z.infer<typeof inboxV2WorkItemTransitionSchema>
): boolean {
  if (
    !sameValue(assignment.startedBy, transition.actor) ||
    assignment.startReasonId !== transition.reasonId
  ) {
    return false;
  }
  if (transition.kind === "claim") {
    return (
      assignment.source === "claim" &&
      transition.actor.kind === "employee" &&
      sameReference(assignment.employee, transition.actor.employee)
    );
  }
  if (transition.kind === "assign") {
    return (
      assignment.source === "manual_assignment" ||
      assignment.source === "policy_assignment"
    );
  }
  if (transition.kind === "reopen_assigned") {
    return assignment.source === "reopen";
  }
  if (transition.kind === "transfer") {
    return assignment.source === "transfer";
  }
  if (transition.kind === "recovery_transfer") {
    return assignment.source === "recovery_transfer";
  }
  return false;
}

function sameEndedServicingTeamEpisode(
  before: z.infer<typeof inboxV2WorkItemServicingTeamEpisodeSchema>,
  after: z.infer<typeof inboxV2WorkItemServicingTeamEpisodeSchema>,
  transition: z.infer<typeof inboxV2WorkItemTransitionSchema>
): boolean {
  return (
    before.state === "active" &&
    after.state === "ended" &&
    before.id === after.id &&
    sameValue(
      {
        ...before,
        state: undefined,
        termination: undefined,
        revision: undefined,
        updatedAt: undefined
      },
      {
        ...after,
        state: undefined,
        termination: undefined,
        revision: undefined,
        updatedAt: undefined
      }
    ) &&
    after.termination !== null &&
    after.termination.cause.kind === "work_item_terminal" &&
    sameReference(
      after.termination.cause.transition,
      transitionReferenceOf(transition)
    ) &&
    after.termination.endedAt === transition.occurredAt &&
    after.termination.recordedAt === transition.occurredAt &&
    after.termination.reasonId === transition.reasonId &&
    sameValue(after.termination.actor, transition.actor)
  );
}

function servicingTeamHeadOf(
  episode: z.infer<typeof inboxV2WorkItemServicingTeamEpisodeSchema>
): z.infer<typeof inboxV2WorkItemCurrentServicingTeamSchema> {
  return inboxV2WorkItemCurrentServicingTeamSchema.parse({
    workItem: episode.workItem,
    episode: {
      tenantId: episode.tenantId,
      kind: "work_item_servicing_team_episode",
      id: episode.id
    },
    team: episode.team,
    workItemCycle: episode.workItemCycle,
    startedAt: episode.startedAt,
    episodeRevision: episode.revision
  });
}

function currentQueueHead(
  workItem: z.infer<typeof inboxV2WorkItemSchema>
): z.infer<typeof inboxV2WorkItemQueueHeadSchema> | null {
  return workItem.operationalState.activeQueue;
}

function currentOrFinalQueueHead(
  workItem: z.infer<typeof inboxV2WorkItemSchema>
): z.infer<typeof inboxV2WorkItemQueueHeadSchema> {
  return (workItem.operationalState.activeQueue ??
    workItem.operationalState.terminal?.finalQueue) as z.infer<
    typeof inboxV2WorkItemQueueHeadSchema
  >;
}

function workItemReferenceOf(
  workItem: z.infer<typeof inboxV2WorkItemSchema>
): z.infer<typeof inboxV2WorkItemReferenceSchema> {
  return inboxV2WorkItemReferenceSchema.parse({
    tenantId: workItem.tenantId,
    kind: "work_item",
    id: workItem.id
  });
}

function workQueueReferenceOf(
  queue: z.infer<typeof inboxV2WorkQueueSchema>
): z.infer<typeof inboxV2WorkQueueReferenceSchema> {
  return inboxV2WorkQueueReferenceSchema.parse({
    tenantId: queue.tenantId,
    kind: "work_queue",
    id: queue.id
  });
}

function transitionReferenceOf(
  transition: z.infer<typeof inboxV2WorkItemTransitionSchema>
): z.infer<typeof inboxV2WorkItemTransitionReferenceSchema> {
  return inboxV2WorkItemTransitionReferenceSchema.parse({
    tenantId: transition.tenantId,
    kind: "work_item_transition",
    id: transition.id
  });
}

function addOperationalStateTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  operationalState: z.infer<typeof inboxV2WorkItemOperationalStateSchema>,
  path: PropertyKey[]
): void {
  const queue =
    operationalState.activeQueue ?? operationalState.terminal?.finalQueue;
  if (queue !== null && queue !== undefined) {
    addTenantReferenceIssue(context, tenantId, queue.queue, [
      ...path,
      operationalState.activeQueue === null ? "terminal" : "activeQueue",
      "queue"
    ]);
  }
  const primary =
    operationalState.primaryAssignment ??
    operationalState.terminal?.finalPrimary;
  if (primary !== null && primary !== undefined) {
    for (const [field, reference] of [
      ["assignment", primary.assignment],
      ["employee", primary.employee],
      ["eligibilityDecision", primary.eligibilityDecision]
    ] as const) {
      addTenantReferenceIssue(context, tenantId, reference, [
        ...path,
        "primaryAssignment",
        field
      ]);
    }
  }
  if (operationalState.terminal !== null) {
    addTenantReferenceIssue(
      context,
      tenantId,
      operationalState.terminal.closedByTransition,
      [...path, "terminal", "closedByTransition"]
    );
    addActorTenantIssue(context, tenantId, operationalState.terminal.closedBy, [
      ...path,
      "terminal",
      "closedBy"
    ]);
    if (operationalState.terminal.finalServicingTeam !== null) {
      for (const [field, reference] of [
        ["workItem", operationalState.terminal.finalServicingTeam.workItem],
        ["episode", operationalState.terminal.finalServicingTeam.episode],
        ["team", operationalState.terminal.finalServicingTeam.team]
      ] as const) {
        addTenantReferenceIssue(context, tenantId, reference, [
          ...path,
          "terminal",
          "finalServicingTeam",
          field
        ]);
      }
    }
  }
}

function addActorTenantIssue(
  context: z.RefinementCtx,
  tenantId: string,
  actor: z.infer<typeof inboxV2WorkActorSchema>,
  path: PropertyKey[]
): void {
  if (actor.kind === "employee") {
    addTenantReferenceIssue(context, tenantId, actor.employee, path);
  }
}

function sameReference(
  left: { tenantId: string; kind: string; id: string },
  right: { tenantId: string; kind: string; id: string }
): boolean {
  return (
    left.tenantId === right.tenantId &&
    left.kind === right.kind &&
    String(left.id) === String(right.id)
  );
}

function sameNullableValue(left: unknown, right: unknown): boolean {
  return sameValue(left, right);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function addTenantReferenceIssue(
  context: z.RefinementCtx,
  tenantId: string,
  reference: { tenantId: string },
  path: PropertyKey[]
): void {
  if (reference.tenantId !== tenantId) {
    addIssue(context, path, "WorkItem references must share one tenant.");
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
