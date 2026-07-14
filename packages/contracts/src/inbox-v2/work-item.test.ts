import { describe, expect, it } from "vitest";

import {
  classifyInboxV2WorkItemClaimConflict,
  deriveInboxV2WorkItemResponsibility,
  INBOX_V2_WORK_ITEM_SCHEMA_ID,
  inboxV2ConversationWorkItemSlotSchema,
  inboxV2WorkItemCreationCommitSchema,
  inboxV2WorkItemEnvelopeSchema,
  inboxV2WorkItemIntakeDecisionSchema,
  inboxV2WorkItemPrimaryAssignmentSchema,
  inboxV2WorkItemResponsibilityProjectionSchema,
  inboxV2WorkItemSchema,
  inboxV2WorkItemTransitionCommitSchema,
  inboxV2WorkItemTransitionSchema
} from "./work-item";
import { inboxV2EmployeeAssignmentEligibilityFenceSchema } from "./work-queue";

const tenantId = "tenant:tenant-1";
const t0 = "2026-07-11T09:00:00.000Z";
const t1 = "2026-07-11T09:10:00.000Z";
const t2 = "2026-07-11T10:00:00.000Z";
const t3 = "2026-07-11T11:00:00.000Z";
const conversation = {
  tenantId,
  kind: "conversation" as const,
  id: "conversation:conversation-1"
};
const workItemReference = {
  tenantId,
  kind: "work_item" as const,
  id: "work_item:work-1"
};
const queueReference = {
  tenantId,
  kind: "work_queue" as const,
  id: "work_queue:support"
};
const employee = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-1"
};
const employee2 = {
  tenantId,
  kind: "employee" as const,
  id: "employee:employee-2"
};
const employeeActor = {
  kind: "employee" as const,
  employee,
  authorizationEpoch: "authorization-epoch-1"
};
const supervisorActor = {
  kind: "employee" as const,
  employee: {
    tenantId,
    kind: "employee" as const,
    id: "employee:supervisor-1"
  },
  authorizationEpoch: "authorization-epoch-2"
};
const trustedActor = {
  kind: "trusted_service" as const,
  trustedServiceId: "core:work-intake"
};

function queue(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: queueReference.id,
    ownerOrgUnit: {
      tenantId,
      kind: "org_unit",
      id: "org_unit:support"
    },
    lifecycle: "active",
    eligibilityPolicy: {
      policyId: "core:active-queue-member",
      policyVersion: "v1",
      policyRevision: "5"
    },
    externalReplyPolicy: {
      mode: "responsible_only",
      policyVersion: "v1",
      policyRevision: "4"
    },
    defaultPriorityId: "core:normal",
    defaultSlaPolicy: { kind: "not_applied" },
    resourceAccessRevision: "2",
    revision: "3",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function fence(target = employee, overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    employee: target,
    state: "active",
    generation: "2",
    revision: "5",
    effectiveFrom: t0,
    loadedAt: t0,
    ...overrides
  };
}

function eligibilityDecision(
  target = employee,
  expectedWorkItemRevision = "1",
  suffix = "1",
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId,
    id: `work_queue_eligibility_decision:decision-${suffix}`,
    workItem: workItemReference,
    expectedWorkItemRevision,
    queue: queueReference,
    queueRevision: "3",
    queueLifecycle: "active",
    employee: target,
    employeeFence: fence(target),
    policy: {
      policyId: "core:active-queue-member",
      policyVersion: "v1",
      policyRevision: "5"
    },
    eligibilityBasis: "queue_membership",
    eligibilityEvidenceRevision: "4",
    effect: "allow",
    reasonId: "core:active-member",
    decisionRevision: "1",
    loadedByTrustedServiceId: "core:authorization",
    decidedAt: t0,
    notAfter: t3,
    ...overrides
  };
}

function assignment(
  target = employee,
  expectedWorkItemRevision = "1",
  suffix = "1",
  overrides: Record<string, unknown> = {}
) {
  const startedAt =
    typeof overrides.startedAt === "string" ? overrides.startedAt : t1;
  const decision = (overrides.eligibilityDecision ??
    eligibilityDecision(target, expectedWorkItemRevision, suffix, {
      decidedAt: startedAt,
      employeeFence: fence(target, { loadedAt: startedAt })
    })) as ReturnType<typeof eligibilityDecision>;
  return {
    tenantId,
    id: `work_item_primary_assignment:assignment-${suffix}`,
    workItem: workItemReference,
    queueAtStart: { queue: queueReference, queueRevision: "3" },
    employee: target,
    source: "claim",
    eligibilityDecision: decision,
    employeeFenceGenerationAtStart: "2",
    startedAt,
    startedBy: employeeActor,
    startReasonId: "core:claimed",
    state: "active",
    termination: null,
    revision: "1",
    createdAt: t1,
    updatedAt: t1,
    ...overrides
  };
}

function assignmentHead(value = assignment()) {
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

function newWorkItem(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: workItemReference.id,
    conversation,
    ordinal: "1",
    operationalState: {
      state: "new",
      activeQueue: { queue: queueReference, queueRevision: "3" },
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
    createdBy: trustedActor,
    creationReasonId: "core:external-actionable-input",
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function trackedSla(overrides: Record<string, unknown> = {}) {
  return {
    kind: "tracked",
    snapshot: {
      tenantId,
      policyId: "core:support-standard",
      policyVersion: "v1",
      policyRevision: "3",
      inputRevision: "1",
      businessCalendarId: "core:moscow-business-hours",
      businessCalendarVersion: "v1",
      businessCalendarRevision: "8",
      timeZone: "Europe/Moscow",
      clockState: "running",
      startedAt: t0,
      pausedAt: null,
      pauseConditionId: null,
      stoppedAt: null,
      firstHumanResponseDueAt: t2,
      resolutionDueAt: t3,
      firstHumanResponseAt: null,
      revision: "1",
      calculatedAt: t0,
      ...overrides
    }
  };
}

function assignedWorkItem(
  assignmentValue = assignment(),
  overrides: Record<string, unknown> = {}
) {
  return {
    ...newWorkItem(),
    operationalState: {
      state: "assigned",
      activeQueue: { queue: queueReference, queueRevision: "3" },
      primaryAssignment: assignmentHead(assignmentValue),
      terminal: null
    },
    resourceAccessRevision: "2",
    revision: "2",
    updatedAt: t1,
    ...overrides
  };
}

function emptySlot(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    id: "conversation_work_item_slot:slot-1",
    conversation,
    latestOrdinal: "0",
    latestWorkItem: null,
    currentNonTerminalWorkItem: null,
    revision: "1",
    createdAt: t0,
    updatedAt: t0,
    ...overrides
  };
}

function activeSlot(overrides: Record<string, unknown> = {}) {
  return {
    ...emptySlot(),
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
    revision: "2",
    ...overrides
  };
}

function intakeDecision(overrides: Record<string, unknown> = {}) {
  return {
    tenantId,
    conversation,
    transport: "external",
    policyId: "core:default-actionability",
    policyVersion: "v1",
    policyRevision: "7",
    decisionRevision: "1",
    decidedByTrustedServiceId: "core:work-intake",
    decidedAt: t0,
    outcome: "create_work_item",
    queue: queueReference,
    latestTerminalHandling: "no_latest_work_item",
    reasonId: "core:external-actionable-input",
    ...overrides
  };
}

function transition(
  kind: string,
  fromState: string,
  toState: string,
  expectedRevision: string,
  resultingRevision: string,
  occurredAt: string,
  overrides: Record<string, unknown> = {}
) {
  return {
    tenantId,
    id: `work_item_transition:${kind}-${resultingRevision}`,
    workItem: workItemReference,
    kind,
    fromState,
    toState,
    sourceQueue: { queue: queueReference, queueRevision: "3" },
    destinationQueue: { queue: queueReference, queueRevision: "3" },
    actor: employeeActor,
    reasonId: `core:${kind.replaceAll("_", "-")}`,
    expectedRevision,
    resultingRevision,
    occurredAt,
    ...overrides
  };
}

function endedAssignment(
  before = assignment(),
  transitionValue = transition(
    "close_resolved",
    "assigned",
    "resolved",
    "2",
    "3",
    t2
  ),
  overrides: Record<string, unknown> = {}
) {
  return {
    ...before,
    state: "ended",
    termination: {
      endedAt: transitionValue.occurredAt,
      recordedAt: transitionValue.occurredAt,
      basis: "command_time",
      endedBy: transitionValue.actor,
      reasonId: transitionValue.reasonId,
      transition: {
        tenantId,
        kind: "work_item_transition",
        id: transitionValue.id
      },
      employeeFenceAtEnd: null
    },
    revision: "2",
    updatedAt: transitionValue.occurredAt,
    ...overrides
  };
}

function effectiveResponsibility(
  workItemValue: unknown,
  assignmentValue: unknown,
  evaluatedAt = t1
) {
  return deriveInboxV2WorkItemResponsibility({
    workItem: inboxV2WorkItemSchema.parse(workItemValue),
    assignment: inboxV2WorkItemPrimaryAssignmentSchema.parse(assignmentValue),
    employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
      fence(employee, { loadedAt: evaluatedAt })
    ),
    evaluatedAt
  });
}

function recoveryResponsibility(
  workItemValue: unknown,
  assignmentValue: unknown
) {
  return deriveInboxV2WorkItemResponsibility({
    workItem: inboxV2WorkItemSchema.parse(workItemValue),
    assignment: inboxV2WorkItemPrimaryAssignmentSchema.parse(assignmentValue),
    employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
      fence(employee, {
        state: "draining",
        generation: "3",
        revision: "6",
        effectiveFrom: t2,
        loadedAt: t3
      })
    ),
    evaluatedAt: t3
  });
}

describe("Inbox V2 WorkItem contracts", () => {
  it("creates the first unassigned WorkItem and claims one Conversation slot", () => {
    const before = emptySlot();
    const workItem = newWorkItem();
    const after = activeSlot();
    const parsed = inboxV2WorkItemCreationCommitSchema.parse({
      tenantId,
      intakeDecision: intakeDecision(),
      queueSnapshot: queue(),
      slotBefore: before,
      previousLatestWorkItem: null,
      createdWorkItem: workItem,
      slotAfter: after,
      occurredAt: t0
    });

    expect(parsed.createdWorkItem.operationalState.state).toBe("new");
    expect(parsed.slotAfter.currentNonTerminalWorkItem?.workItem.id).toBe(
      workItemReference.id
    );
  });

  it("grounds initial priority, SLA, attribution and revisions in intake/Queue policy", () => {
    const base = {
      tenantId,
      intakeDecision: intakeDecision(),
      queueSnapshot: queue(),
      slotBefore: emptySlot(),
      previousLatestWorkItem: null,
      createdWorkItem: newWorkItem(),
      slotAfter: activeSlot(),
      occurredAt: t0
    };
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        ...base,
        createdWorkItem: newWorkItem({ priorityId: "core:urgent" })
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        ...base,
        createdWorkItem: newWorkItem({ resourceAccessRevision: "2" })
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        ...base,
        createdWorkItem: newWorkItem({
          createdBy: {
            kind: "trusted_service",
            trustedServiceId: "core:another-service"
          }
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        ...base,
        intakeDecision: intakeDecision({
          latestTerminalHandling: "create_sequential"
        })
      }).success
    ).toBe(false);
  });

  it("records the first human response once and never rewrites its timestamp", () => {
    const before = newWorkItem({ sla: trackedSla() });
    const refresh = transition("sla_refresh", "new", "new", "1", "2", t2);
    const after = {
      ...before,
      sla: trackedSla({
        firstHumanResponseAt: t1,
        revision: "2",
        calculatedAt: t2
      }),
      revision: "2",
      updatedAt: t2
    };
    const commit = {
      tenantId,
      before,
      transition: refresh,
      after,
      sourceResponsibility: null,
      assignmentEffect: { kind: "none" },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: null,
      slotBefore: activeSlot(),
      slotAfter: activeSlot()
    };

    const parsed = inboxV2WorkItemTransitionCommitSchema.parse(commit);
    expect(parsed.after.sla.kind).toBe("tracked");
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        ...commit,
        after: {
          ...after,
          sla: trackedSla({
            firstHumanResponseAt: t3,
            revision: "2",
            calculatedAt: t2
          })
        }
      }).success
    ).toBe(false);

    if (parsed.after.sla.kind !== "tracked") {
      throw new Error("Expected a tracked SLA snapshot.");
    }
    const followup = transition("sla_refresh", "new", "new", "2", "3", t3);
    const stableAfter = {
      ...parsed.after,
      sla: {
        kind: "tracked" as const,
        snapshot: {
          ...parsed.after.sla.snapshot,
          revision: "3",
          calculatedAt: t3
        }
      },
      revision: "3",
      updatedAt: t3
    };
    const followupCommit = {
      ...commit,
      before: parsed.after,
      transition: followup,
      after: stableAfter
    };
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse(followupCommit).success
    ).toBe(true);

    for (const forbiddenTimestamp of [null, t0]) {
      expect(
        inboxV2WorkItemTransitionCommitSchema.safeParse({
          ...followupCommit,
          after: {
            ...stableAfter,
            sla: {
              kind: "tracked",
              snapshot: {
                ...stableAfter.sla.snapshot,
                firstHumanResponseAt: forbiddenTimestamp
              }
            }
          }
        }).success
      ).toBe(false);
    }
  });

  it("anchors resumed SLA observations to the reopen transition time", () => {
    const close = transition(
      "close_resolved",
      "new",
      "resolved",
      "1",
      "2",
      t1,
      { reasonId: "core:resolved" }
    );
    const terminal = inboxV2WorkItemSchema.parse({
      ...newWorkItem(),
      operationalState: {
        state: "resolved",
        activeQueue: null,
        primaryAssignment: null,
        terminal: {
          closedByTransition: {
            tenantId,
            kind: "work_item_transition",
            id: close.id
          },
          reasonId: close.reasonId,
          closedBy: close.actor,
          closedAt: t1,
          finalQueue: { queue: queueReference, queueRevision: "3" },
          finalServicingTeam: null,
          finalPrimary: null
        }
      },
      sla: trackedSla({
        clockState: "stopped",
        stoppedAt: t1,
        revision: "2",
        calculatedAt: t1
      }),
      resourceAccessRevision: "2",
      revision: "2",
      updatedAt: t1
    });
    if (terminal.sla.kind !== "tracked") {
      throw new Error("Expected a tracked SLA snapshot.");
    }
    const reopen = transition(
      "reopen_unassigned",
      "resolved",
      "new",
      "2",
      "3",
      t2,
      { actor: supervisorActor, reasonId: "core:new-inbound" }
    );
    const after = {
      ...terminal,
      operationalState: {
        state: "new" as const,
        activeQueue: { queue: queueReference, queueRevision: "3" },
        primaryAssignment: null,
        terminal: null
      },
      sla: {
        kind: "tracked" as const,
        snapshot: {
          ...terminal.sla.snapshot,
          clockState: "running" as const,
          stoppedAt: null,
          revision: "3",
          calculatedAt: t2
        }
      },
      resourceAccessRevision: "3",
      reopenCycle: "1",
      lastReopen: {
        reopenedByTransition: {
          tenantId,
          kind: "work_item_transition" as const,
          id: reopen.id
        },
        conversation,
        previousTerminalState: "resolved" as const,
        trigger: "new_inbound" as const,
        triggerReference: {
          tenantId,
          kind: "normalized_inbound_event" as const,
          id: "normalized_inbound_event:resume-1"
        },
        policyId: "core:default-actionability",
        policyVersion: "v1",
        policyRevision: "7",
        decidedByTrustedServiceId: "core:work-intake",
        decisionRevision: "1",
        evaluatedAt: t1,
        reopenUntil: t3,
        outcome: "reopen_existing" as const,
        destinationQueue: { queue: queueReference, queueRevision: "3" },
        targetEligibilityDecision: null,
        slaMode: "resume_remaining" as const,
        reasonId: reopen.reasonId,
        reopenedBy: reopen.actor,
        reopenedAt: t2,
        reopenCycle: "1"
      },
      revision: "3",
      updatedAt: t2
    };
    const slotBefore = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "terminal",
        lifecycleFenceRevision: "2"
      },
      currentNonTerminalWorkItem: null,
      revision: "3",
      updatedAt: t1
    });
    const slotAfter = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "non_terminal",
        lifecycleFenceRevision: "3"
      },
      revision: "4",
      updatedAt: t2
    });
    const commit = {
      tenantId,
      before: terminal,
      transition: reopen,
      after,
      sourceResponsibility: null,
      assignmentEffect: { kind: "none" },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: queue(),
      slotBefore,
      slotAfter
    };

    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        ...commit,
        after: {
          ...after,
          sla: {
            kind: "tracked",
            snapshot: { ...after.sla.snapshot, calculatedAt: t1 }
          }
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        ...commit,
        after: {
          ...after,
          sla: {
            kind: "tracked",
            snapshot: {
              ...after.sla.snapshot,
              clockState: "paused",
              pausedAt: t3,
              pauseConditionId: "core:waiting-on-client"
            }
          }
        }
      }).success
    ).toBe(false);
  });

  it("creates sequential work only from the exact latest terminal slot", () => {
    const terminal = inboxV2WorkItemSchema.parse({
      ...newWorkItem(),
      operationalState: {
        state: "dismissed",
        activeQueue: null,
        primaryAssignment: null,
        terminal: {
          closedByTransition: {
            tenantId,
            kind: "work_item_transition",
            id: "work_item_transition:dismiss-2"
          },
          reasonId: "core:not-actionable",
          closedBy: employeeActor,
          closedAt: t1,
          finalQueue: { queue: queueReference, queueRevision: "3" },
          finalServicingTeam: null,
          finalPrimary: null
        }
      },
      resourceAccessRevision: "2",
      revision: "2",
      updatedAt: t1
    });
    const slotBefore = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "terminal",
        lifecycleFenceRevision: "2"
      },
      currentNonTerminalWorkItem: null,
      revision: "2",
      updatedAt: t1
    });
    const nextReference = {
      tenantId,
      kind: "work_item" as const,
      id: "work_item:work-2"
    };
    const next = newWorkItem({
      id: nextReference.id,
      ordinal: "2",
      createdAt: t2,
      updatedAt: t2
    });
    const slotAfter = activeSlot({
      latestOrdinal: "2",
      latestWorkItem: {
        workItem: nextReference,
        ordinal: "2",
        lifecycleClass: "non_terminal",
        lifecycleFenceRevision: "1"
      },
      currentNonTerminalWorkItem: {
        workItem: nextReference,
        ordinal: "2"
      },
      revision: "3",
      updatedAt: t2
    });
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        tenantId,
        intakeDecision: intakeDecision({
          decidedAt: t2,
          latestTerminalHandling: "create_sequential"
        }),
        queueSnapshot: queue(),
        slotBefore,
        previousLatestWorkItem: terminal,
        createdWorkItem: next,
        slotAfter,
        occurredAt: t2
      }).success
    ).toBe(true);
    expect(
      inboxV2WorkItemCreationCommitSchema.safeParse({
        tenantId,
        intakeDecision: intakeDecision({
          decidedAt: t2,
          latestTerminalHandling: "create_sequential"
        }),
        queueSnapshot: queue(),
        slotBefore,
        previousLatestWorkItem: {
          ...terminal,
          revision: "3"
        },
        createdWorkItem: next,
        slotAfter,
        occurredAt: t2
      }).success
    ).toBe(false);
  });

  it("keeps clientless internal and employee-only external chats without fake WorkItems", () => {
    const internal = inboxV2WorkItemIntakeDecisionSchema.parse({
      tenantId,
      conversation,
      transport: "internal",
      policyId: "core:default-actionability",
      policyVersion: "v1",
      policyRevision: "7",
      decisionRevision: "1",
      decidedByTrustedServiceId: "core:work-intake",
      decidedAt: t0,
      outcome: "no_work_item",
      reason: "internal_non_actionable"
    });
    const externalEmployees = inboxV2WorkItemIntakeDecisionSchema.parse({
      ...internal,
      transport: "external",
      reason: "external_employee_only_non_actionable"
    });
    const slot = inboxV2ConversationWorkItemSlotSchema.parse(emptySlot());

    expect(internal.outcome).toBe("no_work_item");
    expect(externalEmployees.outcome).toBe("no_work_item");
    expect(slot.latestWorkItem).toBeNull();
  });

  it("models claim as one CAS revision and one exact eligible primary", () => {
    const opened = assignment();
    const claim = transition("claim", "new", "assigned", "1", "2", t1, {
      reasonId: "core:claimed"
    });
    const parsed = inboxV2WorkItemTransitionCommitSchema.parse({
      tenantId,
      before: newWorkItem(),
      transition: claim,
      after: assignedWorkItem(opened),
      sourceResponsibility: null,
      assignmentEffect: { kind: "open", opened },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: queue(),
      slotBefore: activeSlot(),
      slotAfter: activeSlot()
    });

    expect(parsed.after.operationalState.primaryAssignment?.employee.id).toBe(
      employee.id
    );
  });

  it("rejects claim-to-other and stale eligibility decisions", () => {
    const openedForOther = assignment(employee2, "1", "2", {
      startedBy: employeeActor,
      source: "claim",
      startReasonId: "core:claimed"
    });
    const claim = transition("claim", "new", "assigned", "1", "2", t1, {
      reasonId: "core:claimed"
    });
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: newWorkItem(),
        transition: claim,
        after: assignedWorkItem(openedForOther),
        sourceResponsibility: null,
        assignmentEffect: { kind: "open", opened: openedForOther },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(false);

    const otherWorkItemAssignment = assignment(employee, "1", "other", {
      workItem: {
        tenantId,
        kind: "work_item",
        id: "work_item:other"
      },
      eligibilityDecision: eligibilityDecision(employee, "1", "other", {
        workItem: {
          tenantId,
          kind: "work_item",
          id: "work_item:other"
        }
      })
    });
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: newWorkItem(),
        transition: claim,
        after: assignedWorkItem(otherWorkItemAssignment),
        sourceResponsibility: null,
        assignmentEffect: {
          kind: "open",
          opened: otherWorkItemAssignment
        },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(false);

    const stale = assignment(employee, "9", "9", {
      startReasonId: "core:claimed"
    });
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: newWorkItem(),
        transition: claim,
        after: assignedWorkItem(stale),
        sourceResponsibility: null,
        assignmentEffect: { kind: "open", opened: stale },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(false);
  });

  it("classifies same-valid-revision claim races separately from pre-stale claims", () => {
    const winner = inboxV2WorkItemTransitionSchema.parse(
      transition("claim", "new", "assigned", "1", "2", t1, {
        reasonId: "core:claimed"
      })
    );
    expect(
      classifyInboxV2WorkItemClaimConflict({
        requestedWorkItem: workItemReference,
        requestedExpectedRevision: "1",
        winningTransition: winner
      })
    ).toBe("work.responsibility_conflict");
    expect(
      classifyInboxV2WorkItemClaimConflict({
        requestedWorkItem: workItemReference,
        requestedExpectedRevision: "9",
        winningTransition: winner
      })
    ).toBe("revision.conflict");
    expect(
      classifyInboxV2WorkItemClaimConflict({
        requestedWorkItem: {
          tenantId,
          kind: "work_item",
          id: "work_item:other"
        },
        requestedExpectedRevision: "1",
        winningTransition: winner
      })
    ).toBe("revision.conflict");
  });

  it("atomically replaces non-overlapping primary assignment on transfer", () => {
    const beforeAssignment = assignment();
    const transfer = transition(
      "transfer",
      "assigned",
      "assigned",
      "2",
      "3",
      t2,
      { actor: supervisorActor, reasonId: "core:handoff" }
    );
    const closed = endedAssignment(beforeAssignment, transfer);
    const opened = assignment(employee2, "2", "2", {
      source: "transfer",
      startedAt: t2,
      startedBy: supervisorActor,
      startReasonId: "core:handoff",
      createdAt: t2,
      updatedAt: t2
    });
    const after = assignedWorkItem(opened, {
      revision: "3",
      resourceAccessRevision: "3",
      updatedAt: t2
    });

    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: assignedWorkItem(beforeAssignment),
        transition: transfer,
        after,
        sourceResponsibility: effectiveResponsibility(
          assignedWorkItem(beforeAssignment),
          beforeAssignment,
          t2
        ),
        assignmentEffect: {
          kind: "replace",
          before: beforeAssignment,
          after: closed,
          opened
        },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(true);

    const anotherQueue = {
      tenantId,
      kind: "work_queue" as const,
      id: "work_queue:another"
    };
    const wrongQueueOpened = assignment(employee2, "2", "wrong-queue", {
      source: "transfer",
      queueAtStart: { queue: anotherQueue, queueRevision: "9" },
      eligibilityDecision: eligibilityDecision(employee2, "2", "wrong-queue", {
        queue: anotherQueue,
        queueRevision: "9"
      }),
      startedAt: t2,
      startedBy: supervisorActor,
      startReasonId: "core:handoff",
      createdAt: t2,
      updatedAt: t2
    });
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: assignedWorkItem(beforeAssignment),
        transition: transfer,
        after: assignedWorkItem(wrongQueueOpened, {
          revision: "3",
          resourceAccessRevision: "3",
          updatedAt: t2
        }),
        sourceResponsibility: effectiveResponsibility(
          assignedWorkItem(beforeAssignment),
          beforeAssignment,
          t2
        ),
        assignmentEffect: {
          kind: "replace",
          before: beforeAssignment,
          after: closed,
          opened: wrongQueueOpened
        },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(false);

    expect(
      inboxV2WorkItemPrimaryAssignmentSchema.safeParse({
        ...closed,
        termination: {
          ...closed.termination,
          endedAt: t3,
          recordedAt: t3
        },
        updatedAt: t3
      }).success
    ).toBe(true);
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: assignedWorkItem(beforeAssignment),
        transition: transfer,
        after,
        sourceResponsibility: effectiveResponsibility(
          assignedWorkItem(beforeAssignment),
          beforeAssignment,
          t2
        ),
        assignmentEffect: {
          kind: "replace",
          before: beforeAssignment,
          after: {
            ...closed,
            termination: { ...closed.termination, endedAt: t3 },
            updatedAt: t3
          },
          opened
        },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: activeSlot(),
        slotAfter: activeSlot()
      }).success
    ).toBe(false);
  });

  it("closes assignment and slot while retaining terminal event-time snapshots", () => {
    const beforeAssignment = assignment();
    const close = transition(
      "close_resolved",
      "assigned",
      "resolved",
      "2",
      "3",
      t2,
      { reasonId: "core:resolved" }
    );
    const closedAssignment = endedAssignment(beforeAssignment, close);
    const before = assignedWorkItem(beforeAssignment);
    const after = {
      ...before,
      operationalState: {
        state: "resolved",
        activeQueue: null,
        primaryAssignment: null,
        terminal: {
          closedByTransition: {
            tenantId,
            kind: "work_item_transition",
            id: close.id
          },
          reasonId: close.reasonId,
          closedBy: close.actor,
          closedAt: t2,
          finalQueue: before.operationalState.activeQueue,
          finalServicingTeam: null,
          finalPrimary: before.operationalState.primaryAssignment
        }
      },
      resourceAccessRevision: "3",
      revision: "3",
      updatedAt: t2
    };
    const slotAfter = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "terminal",
        lifecycleFenceRevision: "3"
      },
      currentNonTerminalWorkItem: null,
      revision: "3",
      updatedAt: t2
    });
    const commit = {
      tenantId,
      before,
      transition: close,
      after,
      sourceResponsibility: effectiveResponsibility(
        before,
        beforeAssignment,
        t2
      ),
      assignmentEffect: {
        kind: "close",
        before: beforeAssignment,
        after: closedAssignment
      },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: null,
      slotBefore: activeSlot(),
      slotAfter
    };

    const parsed = inboxV2WorkItemTransitionCommitSchema.parse(commit);
    expect(parsed.slotAfter.currentNonTerminalWorkItem).toBeNull();
    expect(parsed.slotAfter.latestWorkItem?.lifecycleClass).toBe("terminal");
    expect(
      parsed.after.operationalState.terminal?.finalPrimary?.employee.id
    ).toBe(employee.id);
  });

  it("reopens only the latest terminal WorkItem and advances its cycle", () => {
    const close = transition(
      "close_resolved",
      "assigned",
      "resolved",
      "2",
      "3",
      t2,
      { reasonId: "core:resolved" }
    );
    const beforeAssignment = assignment();
    const terminal = inboxV2WorkItemSchema.parse({
      ...assignedWorkItem(beforeAssignment),
      operationalState: {
        state: "resolved",
        activeQueue: null,
        primaryAssignment: null,
        terminal: {
          closedByTransition: {
            tenantId,
            kind: "work_item_transition",
            id: close.id
          },
          reasonId: close.reasonId,
          closedBy: close.actor,
          closedAt: t2,
          finalQueue: { queue: queueReference, queueRevision: "3" },
          finalServicingTeam: null,
          finalPrimary: assignmentHead(beforeAssignment)
        }
      },
      resourceAccessRevision: "3",
      revision: "3",
      updatedAt: t2
    });
    const reopen = transition(
      "reopen_unassigned",
      "resolved",
      "new",
      "3",
      "4",
      t3,
      { actor: supervisorActor, reasonId: "core:new-inbound" }
    );
    const after = {
      ...terminal,
      operationalState: {
        state: "new",
        activeQueue: { queue: queueReference, queueRevision: "3" },
        primaryAssignment: null,
        terminal: null
      },
      currentServicingTeam: null,
      resourceAccessRevision: "4",
      reopenCycle: "1",
      lastReopen: {
        reopenedByTransition: {
          tenantId,
          kind: "work_item_transition",
          id: reopen.id
        },
        conversation,
        previousTerminalState: "resolved",
        trigger: "new_inbound",
        triggerReference: {
          tenantId,
          kind: "normalized_inbound_event",
          id: "normalized_inbound_event:reopen-1"
        },
        policyId: "core:default-actionability",
        policyVersion: "v1",
        policyRevision: "7",
        decidedByTrustedServiceId: "core:work-intake",
        decisionRevision: "1",
        evaluatedAt: t2,
        reopenUntil: t3,
        outcome: "reopen_existing",
        destinationQueue: { queue: queueReference, queueRevision: "3" },
        targetEligibilityDecision: null,
        slaMode: "new_cycle",
        reasonId: reopen.reasonId,
        reopenedBy: reopen.actor,
        reopenedAt: t3,
        reopenCycle: "1"
      },
      revision: "4",
      updatedAt: t3
    };
    const slotBefore = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "terminal",
        lifecycleFenceRevision: "3"
      },
      currentNonTerminalWorkItem: null,
      revision: "3",
      updatedAt: t2
    });
    const slotAfter = activeSlot({
      latestWorkItem: {
        workItem: workItemReference,
        ordinal: "1",
        lifecycleClass: "non_terminal",
        lifecycleFenceRevision: "4"
      },
      revision: "4",
      updatedAt: t3
    });
    const parsed = inboxV2WorkItemTransitionCommitSchema.parse({
      tenantId,
      before: terminal,
      transition: reopen,
      after,
      sourceResponsibility: null,
      assignmentEffect: { kind: "none" },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: queue(),
      slotBefore,
      slotAfter
    });

    expect(parsed.after.reopenCycle).toBe("1");
    expect(parsed.slotAfter.latestOrdinal).toBe("1");

    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        tenantId,
        before: terminal,
        transition: reopen,
        after,
        sourceResponsibility: null,
        assignmentEffect: { kind: "none" },
        servicingTeamEffect: { kind: "none" },
        destinationQueueSnapshot: queue(),
        slotBefore: {
          ...slotBefore,
          latestOrdinal: "2",
          latestWorkItem: {
            workItem: {
              tenantId,
              kind: "work_item",
              id: "work_item:newer"
            },
            ordinal: "2",
            lifecycleClass: "terminal",
            lifecycleFenceRevision: "7"
          }
        },
        slotAfter
      }).success
    ).toBe(false);
  });

  it("derives effective responsibility and deactivation recovery overlay", () => {
    const rawAssignment = assignment();
    const currentAssignment =
      inboxV2WorkItemPrimaryAssignmentSchema.parse(rawAssignment);
    const currentWorkItem = inboxV2WorkItemSchema.parse(
      assignedWorkItem(rawAssignment)
    );
    expect(
      deriveInboxV2WorkItemResponsibility({
        workItem: currentWorkItem,
        assignment: currentAssignment,
        employeeFence:
          inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(fence()),
        evaluatedAt: t2
      }).kind
    ).toBe("effective_primary");
    expect(
      deriveInboxV2WorkItemResponsibility({
        workItem: currentWorkItem,
        assignment: currentAssignment,
        employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
          fence(employee, {
            state: "draining",
            effectiveFrom: t2,
            loadedAt: t2,
            revision: "6"
          })
        ),
        evaluatedAt: t2
      }).kind
    ).toBe("responsibility_recovery_pending");
    expect(
      deriveInboxV2WorkItemResponsibility({
        workItem: currentWorkItem,
        assignment: currentAssignment,
        employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
          fence(employee, { generation: "3", revision: "6" })
        ),
        evaluatedAt: t2
      }).kind
    ).toBe("responsibility_recovery_pending");
  });

  it("rejects fabricated responsibility projections and mismatched head facts", () => {
    const rawAssignment = assignment();
    const before = assignedWorkItem(rawAssignment);
    const effective = effectiveResponsibility(before, rawAssignment, t2);
    expect(
      inboxV2WorkItemResponsibilityProjectionSchema.safeParse({
        ...effective,
        employeeFence: fence(employee, {
          state: "draining",
          generation: "3",
          effectiveFrom: t2,
          loadedAt: t2
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemResponsibilityProjectionSchema.safeParse({
        ...effective,
        workItem: { ...workItemReference, tenantId: "tenant:tenant-2" }
      }).success
    ).toBe(false);
    expect(() =>
      deriveInboxV2WorkItemResponsibility({
        workItem: inboxV2WorkItemSchema.parse({
          ...before,
          operationalState: {
            ...before.operationalState,
            primaryAssignment: {
              ...before.operationalState.primaryAssignment,
              assignmentRevision: "9"
            }
          }
        }),
        assignment: inboxV2WorkItemPrimaryAssignmentSchema.parse(rawAssignment),
        employeeFence:
          inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(fence()),
        evaluatedAt: t2
      })
    ).toThrow(/exact WorkItem head/);
    expect(() =>
      deriveInboxV2WorkItemResponsibility({
        workItem: inboxV2WorkItemSchema.parse(before),
        assignment: inboxV2WorkItemPrimaryAssignmentSchema.parse(rawAssignment),
        employeeFence: inboxV2EmployeeAssignmentEligibilityFenceSchema.parse(
          fence(employee, { loadedAt: t3 })
        ),
        evaluatedAt: t2
      })
    ).toThrow(/exact WorkItem head/);
  });

  it("closes recovery history at the immutable deactivation fence", () => {
    const current = assignment();
    const before = assignedWorkItem(current);
    const recovery = transition(
      "recovery_requeue",
      "assigned",
      "new",
      "2",
      "3",
      t3,
      { actor: trustedActor, reasonId: "core:employee-draining" }
    );
    const closed = endedAssignment(current, recovery, {
      termination: {
        endedAt: t2,
        recordedAt: t3,
        basis: "employee_fence_time",
        endedBy: trustedActor,
        reasonId: recovery.reasonId,
        transition: {
          tenantId,
          kind: "work_item_transition",
          id: recovery.id
        },
        employeeFenceAtEnd: fence(employee, {
          state: "draining",
          generation: "3",
          effectiveFrom: t2,
          loadedAt: t3,
          revision: "6"
        })
      },
      updatedAt: t3
    });
    const result = inboxV2WorkItemPrimaryAssignmentSchema.safeParse(closed);
    expect(result.success ? [] : result.error.issues).toEqual([]);
    const after = {
      ...before,
      operationalState: {
        state: "new",
        activeQueue: { queue: queueReference, queueRevision: "3" },
        primaryAssignment: null,
        terminal: null
      },
      resourceAccessRevision: "3",
      revision: "3",
      updatedAt: t3
    };
    const sourceResponsibility = recoveryResponsibility(before, current);
    const commit = {
      tenantId,
      before,
      transition: recovery,
      after,
      sourceResponsibility,
      assignmentEffect: {
        kind: "close",
        before: current,
        after: closed
      },
      servicingTeamEffect: { kind: "none" },
      destinationQueueSnapshot: queue(),
      slotBefore: activeSlot(),
      slotAfter: activeSlot()
    };
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse(commit).success
    ).toBe(true);
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        ...commit,
        assignmentEffect: {
          kind: "close",
          before: current,
          after: endedAssignment(current, recovery)
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemTransitionCommitSchema.safeParse({
        ...commit,
        sourceResponsibility: effectiveResponsibility(before, current, t2)
      }).success
    ).toBe(false);
  });

  it("rejects illegal lifecycle edges, malformed cardinalities and embedded foreign domains", () => {
    expect(
      inboxV2WorkItemTransitionSchema.safeParse(
        transition("assign", "resolved", "assigned", "3", "4", t3)
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemTransitionSchema.safeParse(
        transition("priority_change", "resolved", "resolved", "3", "4", t3)
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse({
        ...newWorkItem({
          operationalState: {
            state: "resolved",
            activeQueue: null,
            primaryAssignment: null,
            terminal: {
              closedByTransition: {
                tenantId,
                kind: "work_item_transition",
                id: "work_item_transition:close-2"
              },
              reasonId: "core:resolved",
              closedBy: employeeActor,
              closedAt: t2,
              finalQueue: { queue: queueReference, queueRevision: "3" },
              finalServicingTeam: null,
              finalPrimary: null
            }
          },
          sla: trackedSla(),
          revision: "2",
          resourceAccessRevision: "2",
          updatedAt: t2
        })
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse(
        newWorkItem({
          sla: trackedSla({
            clockState: "stopped",
            stoppedAt: t1,
            revision: "2",
            calculatedAt: t1
          })
        })
      ).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse({
        ...newWorkItem(),
        operationalState: {
          ...newWorkItem().operationalState,
          primaryAssignment: assignmentHead()
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse({
        ...newWorkItem(),
        clientId: "client:client-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse({
        ...newWorkItem(),
        watcherIds: ["employee:employee-1"]
      }).success
    ).toBe(false);
    expect(
      inboxV2WorkItemSchema.safeParse({
        ...newWorkItem(),
        sourceAccountId: "source_account:account-1"
      }).success
    ).toBe(false);
  });

  it("exports the WorkItem through the exact V2 envelope", () => {
    expect(
      inboxV2WorkItemEnvelopeSchema.parse({
        schemaId: INBOX_V2_WORK_ITEM_SCHEMA_ID,
        schemaVersion: "v1",
        payload: newWorkItem()
      }).payload.id
    ).toBe(workItemReference.id);
  });
});
