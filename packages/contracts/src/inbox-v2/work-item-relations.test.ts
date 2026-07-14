import { describe, expect, it } from "vitest";

import {
  INBOX_V2_WORK_ITEM_COLLABORATOR_PAGE_MAX,
  inboxV2WorkItemCollaboratorEpisodeSchema,
  inboxV2WorkItemCollaboratorCommitSchema,
  inboxV2WorkItemCurrentCollaboratorPageSchema,
  inboxV2WorkItemRelationAggregateHeadSchema,
  inboxV2WorkItemRelationTransitionSchema,
  inboxV2WorkItemServicingTeamEpisodeSchema,
  inboxV2WorkItemServicingTeamCommitSchema,
  inboxV2WorkItemWatcherReferenceSchema,
  isInboxV2WorkItemCollaboratorEffective
} from "./work-item-relations";
import { inboxV2EmployeeAssignmentEligibilityFenceSchema } from "./work-queue";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T10:00:00.000Z";
const t2 = "2026-07-11T11:00:00.000Z";
const workItem = {
  tenantId,
  kind: "work_item" as const,
  id: "work_item:work-1"
};
const employee = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};
const actor = {
  kind: "employee" as const,
  employee: {
    tenantId,
    kind: "employee" as const,
    id: "employee:supervisor-1"
  },
  authorizationEpoch: "authorization-epoch-1"
};

function fence(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    employee,
    state: "active",
    generation: "2",
    revision: "5",
    effectiveFrom: t0,
    loadedAt: t0,
    ...overrides
  };
}

function parsedFence(overrides: Record<string, unknown> = {}) {
  return inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
    fence(overrides)
  );
}

function collaborator(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "work_item_collaborator_episode:collaborator-1",
    workItem,
    workItemCycle: "0",
    employee,
    employeeFenceAtStart: fence(),
    validFrom: t0,
    validUntil: null,
    startedBy: actor,
    startReasonId: "core:expert-assistance",
    state: "active",
    termination: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function teamEpisode(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "work_item_servicing_team_episode:team-episode-1",
    workItem,
    workItemCycle: "0",
    team: {
      tenantId,
      kind: "team",
      id: "team:support"
    },
    startedAt: t0,
    startedBy: actor,
    startReasonId: "core:routed-to-team",
    state: "active",
    termination: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function relationHead(overrides: Record<string, unknown> = {}) {
  return inboxV2WorkItemRelationAggregateHeadSchema.parse({
    tenantId,
    workItem,
    state: "in_progress",
    workItemCycle: "0",
    currentServicingTeam: null,
    servicingTeamRelationRevision: "1",
    collaboratorSetRevision: "1",
    resourceAccessRevision: "1",
    workItemRevision: "2",
    updatedAt: t0,
    ...overrides
  });
}

function currentTeamHead(value = teamEpisode()) {
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

function collaboratorSlot(
  currentEpisode: ReturnType<typeof collaborator> | null,
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId,
    workItem,
    employee,
    currentEpisode:
      currentEpisode === null
        ? null
        : {
            tenantId,
            kind: "work_item_collaborator_episode",
            id: currentEpisode.id
          },
    revision: currentEpisode === null ? "1" : "2",
    updatedAt: currentEpisode === null ? t0 : t1,
    ...overrides
  };
}

describe("Inbox V2 WorkItem temporal relations", () => {
  it("models servicing Team as one temporal WorkItem relation", () => {
    expect(
      inboxV2WorkItemServicingTeamEpisodeSchema.parse(teamEpisode()).state
    ).toBe("active");
    expect(
      inboxV2WorkItemServicingTeamEpisodeSchema.safeParse(
        teamEpisode({ team: { tenantId, kind: "employee", id: employee.id } })
      ).success
    ).toBe(false);
  });

  it("requires exact CAS advances for relation mutations", () => {
    const transition = {
      tenantId,
      id: "work_item_relation_transition:relation-1",
      workItem,
      kind: "servicing_team_change",
      actor,
      reasonId: "core:handoff",
      expectedWorkItemRevision: "5",
      resultingWorkItemRevision: "6",
      expectedRelationRevision: "3",
      resultingRelationRevision: "4",
      occurredAt: t1
    };
    expect(
      inboxV2WorkItemRelationTransitionSchema.safeParse(transition).success
    ).toBe(true);
    expect(
      inboxV2WorkItemRelationTransitionSchema.safeParse({
        ...transition,
        resultingRelationRevision: "5"
      }).success
    ).toBe(false);
  });

  it("atomically opens and replaces the exact servicing-team episode", () => {
    const addTransition = {
      tenantId,
      id: "work_item_relation_transition:team-add",
      workItem,
      kind: "servicing_team_add",
      actor,
      reasonId: "core:routed-to-team",
      expectedWorkItemRevision: "2",
      resultingWorkItemRevision: "3",
      expectedRelationRevision: "1",
      resultingRelationRevision: "2",
      occurredAt: t1
    };
    const opened = teamEpisode({
      id: "work_item_servicing_team_episode:team-episode-add",
      startedAt: t1,
      createdAt: t1,
      updatedAt: t1
    });
    const before = relationHead();
    const after = relationHead({
      currentServicingTeam: currentTeamHead(opened),
      servicingTeamRelationRevision: "2",
      resourceAccessRevision: "2",
      workItemRevision: "3",
      updatedAt: t1
    });
    expect(
      inboxV2WorkItemServicingTeamCommitSchema.safeParse({
        tenantId,
        before,
        transition: addTransition,
        after,
        closed: null,
        opened
      }).success
    ).toBe(true);

    const changeTransition = {
      ...addTransition,
      id: "work_item_relation_transition:team-change",
      kind: "servicing_team_change",
      reasonId: "core:team-handoff",
      expectedWorkItemRevision: "3",
      resultingWorkItemRevision: "4",
      expectedRelationRevision: "2",
      resultingRelationRevision: "3",
      occurredAt: t2
    };
    const oldEnded = {
      ...opened,
      state: "ended",
      termination: {
        endedAt: t2,
        recordedAt: t2,
        cause: {
          kind: "relation_command",
          transition: {
            tenantId,
            kind: "work_item_relation_transition",
            id: changeTransition.id
          }
        },
        actor,
        reasonId: changeTransition.reasonId
      },
      revision: "2",
      updatedAt: t2
    };
    const replacement = teamEpisode({
      id: "work_item_servicing_team_episode:team-episode-new",
      team: { tenantId, kind: "team", id: "team:escalation" },
      startedAt: t2,
      createdAt: t2,
      updatedAt: t2,
      startReasonId: changeTransition.reasonId
    });
    const changedHead = relationHead({
      currentServicingTeam: currentTeamHead(replacement),
      servicingTeamRelationRevision: "3",
      resourceAccessRevision: "3",
      workItemRevision: "4",
      updatedAt: t2
    });
    expect(
      inboxV2WorkItemServicingTeamCommitSchema.safeParse({
        tenantId,
        before: after,
        transition: changeTransition,
        after: changedHead,
        closed: { before: opened, after: oldEnded },
        opened: replacement
      }).success
    ).toBe(true);
    expect(
      inboxV2WorkItemServicingTeamCommitSchema.safeParse({
        tenantId,
        before: after,
        transition: changeTransition,
        after: changedHead,
        closed: { before: opened, after: oldEnded },
        opened: { ...replacement, team: opened.team }
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemServicingTeamCommitSchema.safeParse({
        tenantId,
        before: {
          ...after,
          currentServicingTeam: {
            ...after.currentServicingTeam,
            startedAt: t0
          }
        },
        transition: changeTransition,
        after: changedHead,
        closed: { before: opened, after: oldEnded },
        opened: replacement
      }).success
    ).toBe(false);
  });

  it("commits collaborator add through separate set/access revisions", () => {
    const transition = {
      tenantId,
      id: "work_item_relation_transition:collaborator-add",
      workItem,
      kind: "collaborator_add",
      actor,
      reasonId: "core:expert-assistance",
      expectedWorkItemRevision: "2",
      resultingWorkItemRevision: "3",
      expectedRelationRevision: "1",
      resultingRelationRevision: "2",
      occurredAt: t1
    };
    const episode = collaborator({
      validFrom: t1,
      createdAt: t1,
      updatedAt: t1
    });
    const before = relationHead();
    const after = relationHead({
      collaboratorSetRevision: "2",
      resourceAccessRevision: "2",
      workItemRevision: "3",
      updatedAt: t1
    });
    const addCommit = {
      tenantId,
      before,
      transition,
      after,
      slotBefore: collaboratorSlot(null),
      slotAfter: collaboratorSlot(episode),
      beforeEpisode: null,
      afterEpisode: episode
    };
    expect(
      inboxV2WorkItemCollaboratorCommitSchema.safeParse(addCommit).success
    ).toBe(true);
    expect(
      inboxV2WorkItemCollaboratorCommitSchema.safeParse({
        tenantId,
        before,
        transition,
        after,
        slotBefore: collaboratorSlot(null),
        slotAfter: collaboratorSlot(episode),
        beforeEpisode: null,
        afterEpisode: episode
      }).success
    ).toBe(true);
    expect(
      inboxV2WorkItemCollaboratorCommitSchema.safeParse({
        tenantId,
        before: relationHead(),
        transition,
        after: relationHead({
          collaboratorSetRevision: "2",
          resourceAccessRevision: "1",
          workItemRevision: "3",
          updatedAt: t1
        }),
        slotBefore: collaboratorSlot(null),
        slotAfter: collaboratorSlot(episode),
        beforeEpisode: null,
        afterEpisode: episode
      }).success
    ).toBe(false);

    const removeTransition = {
      ...transition,
      id: "work_item_relation_transition:collaborator-remove",
      kind: "collaborator_remove",
      reasonId: "core:assistance-ended",
      expectedWorkItemRevision: "3",
      resultingWorkItemRevision: "4",
      expectedRelationRevision: "2",
      resultingRelationRevision: "3",
      occurredAt: t2
    };
    const ended = {
      ...episode,
      state: "ended",
      termination: {
        endedAt: t2,
        recordedAt: t2,
        cause: {
          kind: "relation_command",
          transition: {
            tenantId,
            kind: "work_item_relation_transition",
            id: removeTransition.id
          }
        },
        actor,
        reasonId: removeTransition.reasonId
      },
      revision: "2",
      updatedAt: t2
    };
    expect(
      inboxV2WorkItemCollaboratorCommitSchema.safeParse({
        tenantId,
        before: after,
        transition: removeTransition,
        after: relationHead({
          collaboratorSetRevision: "3",
          resourceAccessRevision: "3",
          workItemRevision: "4",
          updatedAt: t2
        }),
        slotBefore: collaboratorSlot(episode),
        slotAfter: collaboratorSlot(null, {
          revision: "3",
          updatedAt: t2
        }),
        beforeEpisode: episode,
        afterEpisode: ended
      }).success
    ).toBe(true);
  });

  it("derives collaborator effectiveness from exact cycle, lifecycle and Employee generation", () => {
    const episode =
      inboxV2WorkItemCollaboratorEpisodeSchema.parse(collaborator());
    expect(
      isInboxV2WorkItemCollaboratorEffective({
        episode,
        workItem: relationHead(),
        employeeFence: parsedFence({ loadedAt: t1 }),
        evaluatedAt: t1
      })
    ).toBe(true);
    expect(
      isInboxV2WorkItemCollaboratorEffective({
        episode,
        workItem: relationHead({ state: "resolved" }),
        employeeFence: parsedFence({ loadedAt: t1 }),
        evaluatedAt: t1
      })
    ).toBe(false);
    expect(
      isInboxV2WorkItemCollaboratorEffective({
        episode,
        workItem: relationHead({
          workItem: {
            tenantId,
            kind: "work_item",
            id: "work_item:another"
          }
        }),
        employeeFence: parsedFence({ loadedAt: t1 }),
        evaluatedAt: t1
      })
    ).toBe(false);
    expect(
      isInboxV2WorkItemCollaboratorEffective({
        episode,
        workItem: relationHead({ state: "assigned", workItemCycle: "1" }),
        employeeFence: parsedFence({ loadedAt: t1 }),
        evaluatedAt: t1
      })
    ).toBe(false);
    expect(
      isInboxV2WorkItemCollaboratorEffective({
        episode,
        workItem: relationHead({ state: "assigned" }),
        employeeFence: parsedFence({ generation: "3", loadedAt: t1 }),
        evaluatedAt: t1
      })
    ).toBe(false);
  });

  it("keeps collaborator history paged and exact-WorkItem scoped", () => {
    expect(
      inboxV2WorkItemCurrentCollaboratorPageSchema.safeParse({
        tenantId,
        workItem,
        workItemCycle: "0",
        collaboratorSetRevision: "1",
        evaluatedAt: t1,
        items: [collaborator()],
        nextCursor: null,
        hasMore: false
      }).success
    ).toBe(true);
    expect(
      inboxV2WorkItemCurrentCollaboratorPageSchema.safeParse({
        tenantId,
        workItem,
        workItemCycle: "0",
        collaboratorSetRevision: "1",
        evaluatedAt: t1,
        items: Array.from(
          { length: INBOX_V2_WORK_ITEM_COLLABORATOR_PAGE_MAX + 1 },
          (_, index) =>
            collaborator({
              id: `work_item_collaborator_episode:collaborator-${index}`,
              employee: {
                ...employee,
                id: `employee:employee-${index}`
              },
              employeeFenceAtStart: fence({
                employee: {
                  ...employee,
                  id: `employee:employee-${index}`
                }
              })
            })
        ),
        nextCursor: null,
        hasMore: false
      }).success
    ).toBe(false);
  });

  it("represents watcher only as notification-owned typed target", () => {
    const watcher = {
      tenantId,
      watcherSubscription: {
        tenantId,
        kind: "watcher_subscription",
        id: "watcher_subscription:watch-1"
      },
      employee,
      target: {
        kind: "work_item",
        workItem,
        workItemCycle: "0"
      },
      validFrom: t0,
      validUntil: t2,
      revision: "1"
    };
    const parsed = inboxV2WorkItemWatcherReferenceSchema.parse(watcher);
    expect(parsed.target.kind).toBe("work_item");
    expect("permissions" in parsed).toBe(false);
    expect("preferences" in parsed).toBe(false);
  });

  it("uses Employee fences only for the exact newer collaborator target", () => {
    const employeeFence = fence({
      state: "draining",
      generation: "3",
      revision: "6",
      effectiveFrom: t1,
      loadedAt: t2
    });
    const termination = {
      endedAt: t1,
      recordedAt: t2,
      cause: { kind: "employee_fence", employeeFence },
      actor,
      reasonId: "core:employee-draining"
    };
    expect(
      inboxV2WorkItemCollaboratorEpisodeSchema.safeParse(
        collaborator({
          state: "ended",
          termination,
          revision: "2",
          updatedAt: t2
        })
      ).success
    ).toBe(true);
    expect(
      inboxV2WorkItemCollaboratorEpisodeSchema.safeParse(
        collaborator({
          state: "ended",
          termination: {
            ...termination,
            cause: {
              kind: "employee_fence",
              employeeFence: { ...employeeFence, generation: "2" }
            }
          },
          revision: "2",
          updatedAt: t2
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemServicingTeamEpisodeSchema.safeParse(
        teamEpisode({
          state: "ended",
          termination,
          revision: "2",
          updatedAt: t2
        })
      ).success
    ).toBe(false);
  });
});
