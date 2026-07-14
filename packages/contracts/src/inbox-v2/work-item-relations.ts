import { z } from "zod";

import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2TeamReferenceSchema,
  inboxV2TenantIdSchema,
  inboxV2WatcherSubscriptionReferenceSchema,
  inboxV2WorkItemCollaboratorEpisodeReferenceSchema,
  inboxV2WorkItemCollaboratorEpisodeIdSchema,
  inboxV2WorkItemReferenceSchema,
  inboxV2WorkItemRelationTransitionIdSchema,
  inboxV2WorkItemRelationTransitionReferenceSchema,
  inboxV2WorkItemServicingTeamEpisodeIdSchema,
  inboxV2WorkItemServicingTeamEpisodeReferenceSchema,
  inboxV2WorkItemTransitionReferenceSchema
} from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2WorkActorSchema,
  inboxV2WorkCounterSchema,
  inboxV2WorkItemStateSchema,
  inboxV2WorkReasonIdSchema,
  isInboxV2TerminalWorkItemState
} from "./work-primitives";
import { inboxV2EmployeeAssignmentEligibilityFenceSchema } from "./work-queue";

export const INBOX_V2_WORK_ITEM_SERVICING_TEAM_EPISODE_SCHEMA_ID =
  "core:inbox-v2.work-item-servicing-team-episode" as const;
export const INBOX_V2_WORK_ITEM_COLLABORATOR_EPISODE_SCHEMA_ID =
  "core:inbox-v2.work-item-collaborator-episode" as const;
export const INBOX_V2_WORK_ITEM_RELATION_TRANSITION_SCHEMA_ID =
  "core:inbox-v2.work-item-relation-transition" as const;
export const INBOX_V2_WORK_ITEM_SERVICING_TEAM_COMMIT_SCHEMA_ID =
  "core:inbox-v2.work-item-servicing-team-commit" as const;
export const INBOX_V2_WORK_ITEM_COLLABORATOR_COMMIT_SCHEMA_ID =
  "core:inbox-v2.work-item-collaborator-commit" as const;
export const INBOX_V2_WORK_ITEM_WATCHER_REFERENCE_SCHEMA_ID =
  "core:inbox-v2.work-item-watcher-reference" as const;
export const INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;
export const INBOX_V2_WORK_ITEM_COLLABORATOR_PAGE_MAX = 128;

export const inboxV2WorkItemRelationTerminationSchema = z
  .object({
    endedAt: inboxV2TimestampSchema,
    recordedAt: inboxV2TimestampSchema,
    cause: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("relation_command"),
          transition: inboxV2WorkItemRelationTransitionReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("work_item_terminal"),
          transition: inboxV2WorkItemTransitionReferenceSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("employee_fence"),
          employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema
        })
        .strict()
    ]),
    actor: inboxV2WorkActorSchema,
    reasonId: inboxV2WorkReasonIdSchema
  })
  .strict();

export const inboxV2WorkItemServicingTeamEpisodeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemServicingTeamEpisodeIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    workItemCycle: inboxV2WorkCounterSchema,
    team: inboxV2TeamReferenceSchema,
    startedAt: inboxV2TimestampSchema,
    startedBy: inboxV2WorkActorSchema,
    startReasonId: inboxV2WorkReasonIdSchema,
    state: z.enum(["active", "ended"]),
    termination: inboxV2WorkItemRelationTerminationSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((episode, context) => {
    for (const [field, reference] of [
      ["workItem", episode.workItem],
      ["team", episode.team]
    ] as const) {
      addTenantReferenceIssue(context, episode.tenantId, reference, [field]);
    }
    addActorTenantIssue(context, episode.tenantId, episode.startedBy, [
      "startedBy"
    ]);
    addTerminationTenantIssues(context, episode.tenantId, episode.termination, [
      "termination"
    ]);
    if (episode.termination?.cause.kind === "employee_fence") {
      addIssue(
        context,
        ["termination", "cause"],
        "Servicing-team episodes cannot be ended by an Employee lifecycle fence."
      );
    }
    addEpisodeStateIssues(context, episode, []);
  });

/**
 * Exact-WorkItem collaboration is temporal and cycle-scoped. It neither makes
 * the Employee primary nor carries across terminal/reopen boundaries.
 */
export const inboxV2WorkItemCollaboratorEpisodeSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemCollaboratorEpisodeIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    workItemCycle: inboxV2WorkCounterSchema,
    employee: inboxV2EmployeeReferenceSchema,
    employeeFenceAtStart: inboxV2EmployeeAssignmentEligibilityFenceSchema,
    validFrom: inboxV2TimestampSchema,
    validUntil: inboxV2TimestampSchema.nullable(),
    startedBy: inboxV2WorkActorSchema,
    startReasonId: inboxV2WorkReasonIdSchema,
    state: z.enum(["active", "ended"]),
    termination: inboxV2WorkItemRelationTerminationSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    createdAt: inboxV2TimestampSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((episode, context) => {
    for (const [field, reference] of [
      ["workItem", episode.workItem],
      ["employee", episode.employee]
    ] as const) {
      addTenantReferenceIssue(context, episode.tenantId, reference, [field]);
    }
    if (
      episode.employeeFenceAtStart.tenantId !== episode.tenantId ||
      !sameReference(episode.employeeFenceAtStart.employee, episode.employee) ||
      episode.employeeFenceAtStart.state !== "active" ||
      Date.parse(episode.employeeFenceAtStart.loadedAt) >
        Date.parse(episode.validFrom) ||
      Date.parse(episode.employeeFenceAtStart.effectiveFrom) >
        Date.parse(episode.validFrom)
    ) {
      addIssue(
        context,
        ["employeeFenceAtStart"],
        "Collaborator start requires the exact active target Employee fence."
      );
    }
    addActorTenantIssue(context, episode.tenantId, episode.startedBy, [
      "startedBy"
    ]);
    addTerminationTenantIssues(context, episode.tenantId, episode.termination, [
      "termination"
    ]);
    if (
      episode.termination?.cause.kind === "employee_fence" &&
      (!sameReference(
        episode.termination.cause.employeeFence.employee,
        episode.employee
      ) ||
        BigInt(episode.termination.cause.employeeFence.generation) <=
          BigInt(episode.employeeFenceAtStart.generation) ||
        Date.parse(episode.termination.cause.employeeFence.loadedAt) >
          Date.parse(episode.termination.recordedAt))
    ) {
      addIssue(
        context,
        ["termination", "cause"],
        "Collaborator fence closure requires the exact newer Employee fence loaded before recording."
      );
    }
    if (
      episode.validUntil !== null &&
      !isInboxV2TimestampOrderValid(episode.validFrom, episode.validUntil)
    ) {
      addIssue(
        context,
        ["validUntil"],
        "Collaborator expiry cannot precede validFrom."
      );
    }
    addEpisodeStateIssues(
      context,
      {
        ...episode,
        startedAt: episode.validFrom
      },
      []
    );
  });

export const inboxV2WorkItemRelationTransitionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    id: inboxV2WorkItemRelationTransitionIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    kind: z.enum([
      "servicing_team_add",
      "servicing_team_remove",
      "servicing_team_change",
      "collaborator_add",
      "collaborator_remove"
    ]),
    actor: inboxV2WorkActorSchema,
    reasonId: inboxV2WorkReasonIdSchema,
    expectedWorkItemRevision: inboxV2EntityRevisionSchema,
    resultingWorkItemRevision: inboxV2EntityRevisionSchema,
    expectedRelationRevision: inboxV2EntityRevisionSchema,
    resultingRelationRevision: inboxV2EntityRevisionSchema,
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
    addRevisionAdvanceIssue(
      context,
      transition.expectedWorkItemRevision,
      transition.resultingWorkItemRevision,
      ["resultingWorkItemRevision"]
    );
    addRevisionAdvanceIssue(
      context,
      transition.expectedRelationRevision,
      transition.resultingRelationRevision,
      ["resultingRelationRevision"]
    );
  });

export const inboxV2WorkItemCurrentServicingTeamSchema = z
  .object({
    workItem: inboxV2WorkItemReferenceSchema,
    episode: inboxV2WorkItemServicingTeamEpisodeReferenceSchema,
    team: inboxV2TeamReferenceSchema,
    workItemCycle: inboxV2WorkCounterSchema,
    startedAt: inboxV2TimestampSchema,
    episodeRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2WorkItemCurrentCollaboratorPageSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    workItemCycle: inboxV2WorkCounterSchema,
    collaboratorSetRevision: inboxV2EntityRevisionSchema,
    evaluatedAt: inboxV2TimestampSchema,
    items: z
      .array(inboxV2WorkItemCollaboratorEpisodeSchema)
      .max(INBOX_V2_WORK_ITEM_COLLABORATOR_PAGE_MAX),
    nextCursor: z.string().min(1).max(512).nullable(),
    hasMore: z.boolean()
  })
  .strict()
  .superRefine((page, context) => {
    addTenantReferenceIssue(context, page.tenantId, page.workItem, [
      "workItem"
    ]);
    const employees = new Set<string>();
    for (const [index, item] of page.items.entries()) {
      if (
        item.tenantId !== page.tenantId ||
        !sameReference(item.workItem, page.workItem) ||
        item.workItemCycle !== page.workItemCycle ||
        item.state !== "active" ||
        Date.parse(item.validFrom) > Date.parse(page.evaluatedAt) ||
        (item.validUntil !== null &&
          Date.parse(page.evaluatedAt) >= Date.parse(item.validUntil))
      ) {
        addIssue(
          context,
          ["items", index],
          "Current collaborator page requires active episodes for one exact WorkItem cycle."
        );
      }
      const employeeKey = `${item.employee.tenantId}\u0000${String(item.employee.id)}`;
      if (employees.has(employeeKey)) {
        addIssue(
          context,
          ["items", index, "employee"],
          "Current collaborator page cannot contain duplicate active Employees."
        );
      }
      employees.add(employeeKey);
    }
    if (page.hasMore !== (page.nextCursor !== null)) {
      addIssue(
        context,
        ["nextCursor"],
        "Collaborator page cursor must be present exactly when more rows exist."
      );
    }
  });

/** Notification owns the subscription; WorkItem exposes only a typed target. */
export const inboxV2WorkItemWatcherTargetSchema = z
  .object({
    kind: z.literal("work_item"),
    workItem: inboxV2WorkItemReferenceSchema,
    workItemCycle: inboxV2WorkCounterSchema
  })
  .strict();

export const inboxV2WorkItemWatcherReferenceSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    watcherSubscription: inboxV2WatcherSubscriptionReferenceSchema,
    employee: inboxV2EmployeeReferenceSchema,
    target: inboxV2WorkItemWatcherTargetSchema,
    validFrom: inboxV2TimestampSchema,
    validUntil: inboxV2TimestampSchema.nullable(),
    revision: inboxV2EntityRevisionSchema
  })
  .strict()
  .superRefine((watcher, context) => {
    for (const [field, reference] of [
      ["watcherSubscription", watcher.watcherSubscription],
      ["employee", watcher.employee],
      ["target", watcher.target.workItem]
    ] as const) {
      addTenantReferenceIssue(context, watcher.tenantId, reference, [field]);
    }
    if (
      watcher.validUntil !== null &&
      !isInboxV2TimestampOrderValid(watcher.validFrom, watcher.validUntil)
    ) {
      addIssue(
        context,
        ["validUntil"],
        "Watcher validity cannot end before it starts."
      );
    }
  });

/** Bounded subset of the WorkItem head required by relation CAS commands. */
export const inboxV2WorkItemRelationAggregateHeadSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    state: inboxV2WorkItemStateSchema,
    workItemCycle: inboxV2WorkCounterSchema,
    currentServicingTeam: inboxV2WorkItemCurrentServicingTeamSchema.nullable(),
    servicingTeamRelationRevision: inboxV2EntityRevisionSchema,
    collaboratorSetRevision: inboxV2EntityRevisionSchema,
    resourceAccessRevision: inboxV2EntityRevisionSchema,
    workItemRevision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((head, context) => {
    addTenantReferenceIssue(context, head.tenantId, head.workItem, [
      "workItem"
    ]);
    if (head.currentServicingTeam !== null) {
      for (const [field, reference] of [
        ["workItem", head.currentServicingTeam.workItem],
        ["episode", head.currentServicingTeam.episode],
        ["team", head.currentServicingTeam.team]
      ] as const) {
        addTenantReferenceIssue(context, head.tenantId, reference, [
          "currentServicingTeam",
          field
        ]);
      }
      if (
        !sameReference(head.currentServicingTeam.workItem, head.workItem) ||
        head.currentServicingTeam.workItemCycle !== head.workItemCycle
      ) {
        addIssue(
          context,
          ["currentServicingTeam"],
          "Current servicing-team head must bind the exact WorkItem cycle."
        );
      }
    }
    if (
      isInboxV2TerminalWorkItemState(head.state) &&
      head.currentServicingTeam !== null
    ) {
      addIssue(
        context,
        ["currentServicingTeam"],
        "Terminal WorkItem relation head cannot retain a servicing team."
      );
    }
  });

/** Composite-key CAS slot prevents duplicate active collaborator episodes. */
export const inboxV2WorkItemCollaboratorSlotSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workItem: inboxV2WorkItemReferenceSchema,
    employee: inboxV2EmployeeReferenceSchema,
    currentEpisode:
      inboxV2WorkItemCollaboratorEpisodeReferenceSchema.nullable(),
    revision: inboxV2EntityRevisionSchema,
    updatedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((slot, context) => {
    for (const [field, reference] of [
      ["workItem", slot.workItem],
      ["employee", slot.employee],
      ["currentEpisode", slot.currentEpisode]
    ] as const) {
      if (reference !== null) {
        addTenantReferenceIssue(context, slot.tenantId, reference, [field]);
      }
    }
  });

const servicingTeamCommitBaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2WorkItemRelationAggregateHeadSchema,
    transition: inboxV2WorkItemRelationTransitionSchema,
    after: inboxV2WorkItemRelationAggregateHeadSchema,
    closed: z
      .object({
        before: inboxV2WorkItemServicingTeamEpisodeSchema,
        after: inboxV2WorkItemServicingTeamEpisodeSchema
      })
      .strict()
      .nullable(),
    opened: inboxV2WorkItemServicingTeamEpisodeSchema.nullable()
  })
  .strict();

export const inboxV2WorkItemServicingTeamCommitSchema =
  servicingTeamCommitBaseSchema.superRefine((commit, context) => {
    addRelationHeadCasIssues(context, commit, "servicing_team");
    const { before, transition, after } = commit;
    if (!transition.kind.startsWith("servicing_team_")) {
      addIssue(
        context,
        ["transition", "kind"],
        "Servicing-team commit requires a servicing-team transition."
      );
      return;
    }
    const expectsClose = transition.kind !== "servicing_team_add";
    const expectsOpen = transition.kind !== "servicing_team_remove";
    if (expectsClose !== (commit.closed !== null)) {
      addIssue(
        context,
        ["closed"],
        "Servicing-team transition has the wrong closure effect."
      );
    }
    if (expectsOpen !== (commit.opened !== null)) {
      addIssue(
        context,
        ["opened"],
        "Servicing-team transition has the wrong open effect."
      );
    }
    if (commit.closed !== null) {
      const current = before.currentServicingTeam;
      if (
        current === null ||
        !sameValue(servicingTeamHeadOf(commit.closed.before), current) ||
        !sameReference(commit.closed.before.workItem, before.workItem) ||
        !isExactEndedRelationEpisode(
          commit.closed.before,
          commit.closed.after,
          transition
        )
      ) {
        addIssue(
          context,
          ["closed"],
          "Servicing-team commit must close the exact current episode."
        );
      }
    } else if (before.currentServicingTeam !== null) {
      addIssue(
        context,
        ["before", "currentServicingTeam"],
        "Servicing-team add requires no current episode."
      );
    }
    if (commit.opened !== null) {
      const openedHead = servicingTeamHeadOf(commit.opened);
      if (
        commit.opened.state !== "active" ||
        !sameReference(commit.opened.workItem, before.workItem) ||
        commit.opened.workItemCycle !== before.workItemCycle ||
        commit.opened.startedAt !== transition.occurredAt ||
        commit.opened.createdAt !== transition.occurredAt ||
        commit.opened.updatedAt !== transition.occurredAt ||
        !sameValue(commit.opened.startedBy, transition.actor) ||
        commit.opened.startReasonId !== transition.reasonId ||
        !sameValue(after.currentServicingTeam, openedHead) ||
        (commit.closed !== null &&
          sameReference(commit.closed.before.team, commit.opened.team))
      ) {
        addIssue(
          context,
          ["opened"],
          "Servicing-team open must create the exact distinct current episode."
        );
      }
    } else if (after.currentServicingTeam !== null) {
      addIssue(
        context,
        ["after", "currentServicingTeam"],
        "Servicing-team remove must leave no current episode."
      );
    }
  });

const collaboratorCommitBaseSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2WorkItemRelationAggregateHeadSchema,
    transition: inboxV2WorkItemRelationTransitionSchema,
    after: inboxV2WorkItemRelationAggregateHeadSchema,
    slotBefore: inboxV2WorkItemCollaboratorSlotSchema,
    slotAfter: inboxV2WorkItemCollaboratorSlotSchema,
    beforeEpisode: inboxV2WorkItemCollaboratorEpisodeSchema.nullable(),
    afterEpisode: inboxV2WorkItemCollaboratorEpisodeSchema
  })
  .strict();

export const inboxV2WorkItemCollaboratorCommitSchema =
  collaboratorCommitBaseSchema.superRefine((commit, context) => {
    addRelationHeadCasIssues(context, commit, "collaborator");
    const { before, transition, afterEpisode, beforeEpisode } = commit;
    if (
      commit.slotBefore.tenantId !== commit.tenantId ||
      commit.slotAfter.tenantId !== commit.tenantId ||
      !sameReference(commit.slotBefore.workItem, before.workItem) ||
      !sameReference(commit.slotAfter.workItem, before.workItem) ||
      !sameReference(commit.slotBefore.employee, commit.slotAfter.employee) ||
      BigInt(commit.slotAfter.revision) !==
        BigInt(commit.slotBefore.revision) + 1n ||
      Date.parse(commit.slotBefore.updatedAt) >
        Date.parse(transition.occurredAt) ||
      commit.slotAfter.updatedAt !== transition.occurredAt
    ) {
      addIssue(
        context,
        ["slotAfter"],
        "Collaborator mutation must CAS one exact Employee/WorkItem slot."
      );
    }
    if (
      transition.kind !== "collaborator_add" &&
      transition.kind !== "collaborator_remove"
    ) {
      addIssue(
        context,
        ["transition", "kind"],
        "Collaborator commit requires add or remove transition."
      );
      return;
    }
    if (transition.kind === "collaborator_add") {
      if (
        beforeEpisode !== null ||
        commit.slotBefore.currentEpisode !== null ||
        afterEpisode.state !== "active" ||
        !sameReference(afterEpisode.employee, commit.slotBefore.employee) ||
        !sameReference(afterEpisode.workItem, before.workItem) ||
        afterEpisode.workItemCycle !== before.workItemCycle ||
        afterEpisode.validFrom !== transition.occurredAt ||
        afterEpisode.createdAt !== transition.occurredAt ||
        afterEpisode.updatedAt !== transition.occurredAt ||
        !sameValue(afterEpisode.startedBy, transition.actor) ||
        afterEpisode.startReasonId !== transition.reasonId ||
        commit.slotAfter.currentEpisode === null ||
        commit.slotAfter.currentEpisode.id !== afterEpisode.id
      ) {
        addIssue(
          context,
          ["afterEpisode"],
          "Collaborator add must open one exact active episode."
        );
      }
    } else if (
      beforeEpisode === null ||
      commit.slotBefore.currentEpisode === null ||
      commit.slotBefore.currentEpisode.id !== beforeEpisode.id ||
      commit.slotAfter.currentEpisode !== null ||
      !sameReference(beforeEpisode.employee, commit.slotBefore.employee) ||
      !sameReference(beforeEpisode.workItem, before.workItem) ||
      !isExactEndedRelationEpisode(beforeEpisode, afterEpisode, transition)
    ) {
      addIssue(
        context,
        ["afterEpisode"],
        "Collaborator remove must close the exact active episode."
      );
    }
  });

export const inboxV2WorkItemServicingTeamEpisodeEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_SERVICING_TEAM_EPISODE_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemServicingTeamEpisodeSchema
  );
export const inboxV2WorkItemCollaboratorEpisodeEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_COLLABORATOR_EPISODE_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemCollaboratorEpisodeSchema
  );
export const inboxV2WorkItemRelationTransitionEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_RELATION_TRANSITION_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemRelationTransitionSchema
  );
export const inboxV2WorkItemServicingTeamCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_SERVICING_TEAM_COMMIT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemServicingTeamCommitSchema
  );
export const inboxV2WorkItemCollaboratorCommitEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_COLLABORATOR_COMMIT_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemCollaboratorCommitSchema
  );
export const inboxV2WorkItemWatcherReferenceEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_WORK_ITEM_WATCHER_REFERENCE_SCHEMA_ID,
    INBOX_V2_WORK_ITEM_RELATION_SCHEMA_VERSION,
    inboxV2WorkItemWatcherReferenceSchema
  );

export type InboxV2WorkItemServicingTeamEpisode = z.infer<
  typeof inboxV2WorkItemServicingTeamEpisodeSchema
>;
export type InboxV2WorkItemCollaboratorEpisode = z.infer<
  typeof inboxV2WorkItemCollaboratorEpisodeSchema
>;
export type InboxV2WorkItemRelationTransition = z.infer<
  typeof inboxV2WorkItemRelationTransitionSchema
>;
export type InboxV2WorkItemCurrentServicingTeam = z.infer<
  typeof inboxV2WorkItemCurrentServicingTeamSchema
>;
export type InboxV2WorkItemRelationAggregateHead = z.infer<
  typeof inboxV2WorkItemRelationAggregateHeadSchema
>;
export type InboxV2WorkItemCollaboratorSlot = z.infer<
  typeof inboxV2WorkItemCollaboratorSlotSchema
>;
export type InboxV2WorkItemServicingTeamCommit = z.infer<
  typeof inboxV2WorkItemServicingTeamCommitSchema
>;
export type InboxV2WorkItemCollaboratorCommit = z.infer<
  typeof inboxV2WorkItemCollaboratorCommitSchema
>;
export type InboxV2WorkItemWatcherTarget = z.infer<
  typeof inboxV2WorkItemWatcherTargetSchema
>;

export function isInboxV2WorkItemCollaboratorEffective(input: {
  episode: InboxV2WorkItemCollaboratorEpisode;
  workItem: InboxV2WorkItemRelationAggregateHead;
  employeeFence: z.infer<
    typeof inboxV2EmployeeAssignmentEligibilityFenceSchema
  >;
  evaluatedAt: string;
}): boolean {
  const { episode, workItem, employeeFence, evaluatedAt } = input;
  return (
    !isInboxV2TerminalWorkItemState(workItem.state) &&
    sameReference(episode.workItem, workItem.workItem) &&
    episode.state === "active" &&
    episode.workItemCycle === workItem.workItemCycle &&
    Date.parse(episode.validFrom) <= Date.parse(evaluatedAt) &&
    (episode.validUntil === null ||
      Date.parse(evaluatedAt) < Date.parse(episode.validUntil)) &&
    employeeFence.state === "active" &&
    employeeFence.tenantId === episode.tenantId &&
    sameReference(employeeFence.employee, episode.employee) &&
    Date.parse(employeeFence.effectiveFrom) <= Date.parse(evaluatedAt) &&
    employeeFence.loadedAt === evaluatedAt &&
    employeeFence.generation === episode.employeeFenceAtStart.generation &&
    Date.parse(workItem.updatedAt) <= Date.parse(evaluatedAt)
  );
}

function addRelationHeadCasIssues(
  context: z.RefinementCtx,
  commit:
    | z.infer<typeof servicingTeamCommitBaseSchema>
    | z.infer<typeof collaboratorCommitBaseSchema>,
  relationKind: "servicing_team" | "collaborator"
): void {
  const { before, transition, after } = commit;
  if (
    commit.tenantId !== before.tenantId ||
    commit.tenantId !== transition.tenantId ||
    commit.tenantId !== after.tenantId ||
    !sameReference(before.workItem, transition.workItem) ||
    !sameReference(before.workItem, after.workItem) ||
    before.state !== after.state ||
    isInboxV2TerminalWorkItemState(before.state) ||
    before.workItemCycle !== after.workItemCycle ||
    before.workItemRevision !== transition.expectedWorkItemRevision ||
    after.workItemRevision !== transition.resultingWorkItemRevision ||
    Date.parse(before.updatedAt) > Date.parse(transition.occurredAt) ||
    after.updatedAt !== transition.occurredAt ||
    BigInt(after.resourceAccessRevision) !==
      BigInt(before.resourceAccessRevision) + 1n
  ) {
    addIssue(
      context,
      ["after"],
      "Relation commit must CAS one exact non-terminal WorkItem head and access revision."
    );
  }
  if (relationKind === "servicing_team") {
    if (
      before.servicingTeamRelationRevision !==
        transition.expectedRelationRevision ||
      after.servicingTeamRelationRevision !==
        transition.resultingRelationRevision ||
      before.collaboratorSetRevision !== after.collaboratorSetRevision
    ) {
      addIssue(
        context,
        ["after", "servicingTeamRelationRevision"],
        "Servicing-team commit advances only its exact relation revision."
      );
    }
  } else if (
    before.collaboratorSetRevision !== transition.expectedRelationRevision ||
    after.collaboratorSetRevision !== transition.resultingRelationRevision ||
    before.servicingTeamRelationRevision !==
      after.servicingTeamRelationRevision ||
    !sameNullableValue(before.currentServicingTeam, after.currentServicingTeam)
  ) {
    addIssue(
      context,
      ["after", "collaboratorSetRevision"],
      "Collaborator commit advances only its exact set/access revisions."
    );
  }
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

function isExactEndedRelationEpisode(
  before:
    | z.infer<typeof inboxV2WorkItemServicingTeamEpisodeSchema>
    | z.infer<typeof inboxV2WorkItemCollaboratorEpisodeSchema>,
  after:
    | z.infer<typeof inboxV2WorkItemServicingTeamEpisodeSchema>
    | z.infer<typeof inboxV2WorkItemCollaboratorEpisodeSchema>,
  transition: z.infer<typeof inboxV2WorkItemRelationTransitionSchema>
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
    after.termination.cause.kind === "relation_command" &&
    after.termination.endedAt === transition.occurredAt &&
    after.termination.recordedAt === transition.occurredAt &&
    after.termination.cause.transition.id === transition.id &&
    after.termination.reasonId === transition.reasonId &&
    sameValue(after.termination.actor, transition.actor)
  );
}

function addEpisodeStateIssues(
  context: z.RefinementCtx,
  episode: {
    state: "active" | "ended";
    termination: z.infer<
      typeof inboxV2WorkItemRelationTerminationSchema
    > | null;
    revision: string;
    startedAt: string;
    createdAt: string;
    updatedAt: string;
  },
  path: PropertyKey[]
): void {
  if ((episode.state === "ended") !== (episode.termination !== null)) {
    addIssue(
      context,
      [...path, "termination"],
      "Ended relation episodes require termination; active episodes forbid it."
    );
  }
  const expectedRevision = episode.state === "active" ? "1" : "2";
  if (episode.revision !== expectedRevision) {
    addIssue(
      context,
      [...path, "revision"],
      "Temporal relation episodes advance only once when they end."
    );
  }
  if (
    !isInboxV2TimestampOrderValid(episode.createdAt, episode.startedAt) ||
    !isInboxV2TimestampOrderValid(episode.createdAt, episode.updatedAt)
  ) {
    addIssue(
      context,
      [...path, "updatedAt"],
      "Relation timestamps cannot precede creation."
    );
  }
  if (
    episode.termination !== null &&
    (!isInboxV2TimestampOrderValid(
      episode.startedAt,
      episode.termination.endedAt
    ) ||
      !isInboxV2TimestampOrderValid(
        episode.termination.endedAt,
        episode.termination.recordedAt
      ) ||
      episode.updatedAt !== episode.termination.recordedAt)
  ) {
    addIssue(
      context,
      [...path, "termination", "endedAt"],
      "Relation termination closes the half-open interval and updatedAt."
    );
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

function addTerminationTenantIssues(
  context: z.RefinementCtx,
  tenantId: string,
  termination: z.infer<typeof inboxV2WorkItemRelationTerminationSchema> | null,
  path: PropertyKey[]
): void {
  if (termination === null) {
    return;
  }
  addActorTenantIssue(context, tenantId, termination.actor, [...path, "actor"]);
  if (termination.cause.kind === "employee_fence") {
    if (
      termination.cause.employeeFence.tenantId !== tenantId ||
      termination.cause.employeeFence.state === "active" ||
      termination.endedAt !== termination.cause.employeeFence.effectiveFrom
    ) {
      addIssue(
        context,
        [...path, "cause"],
        "Employee-fence relation closure requires the exact non-active fence time."
      );
    }
    return;
  }
  addTenantReferenceIssue(context, tenantId, termination.cause.transition, [
    ...path,
    "cause",
    "transition"
  ]);
}

function addRevisionAdvanceIssue(
  context: z.RefinementCtx,
  before: string,
  after: string,
  path: PropertyKey[]
): void {
  if (BigInt(after) !== BigInt(before) + 1n) {
    addIssue(context, path, "Relation transition must advance revision once.");
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
    addIssue(
      context,
      path,
      "WorkItem relation references must share one tenant."
    );
  }
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
