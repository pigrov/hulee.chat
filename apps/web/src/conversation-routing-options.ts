import type {
  EmployeeId,
  InternalInboxConversation,
  TenantId
} from "@hulee/contracts";
import {
  canAccess,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  TeamRecord,
  TenantEmployeeRecord,
  WorkQueueRecord
} from "@hulee/db";

export type ConversationRoutingOptions = {
  readonly canRouteConversation: boolean;
  readonly employees: readonly TenantEmployeeRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
  readonly canClearQueue: boolean;
  readonly canClearAssignee: boolean;
  readonly canClearTeam: boolean;
  readonly canClearAssignment: boolean;
  readonly canAssignToCurrentEmployee: boolean;
};

type ConversationRoutingTargetPatch = {
  readonly currentQueueId?: string;
  readonly currentQueueOwningOrgUnitId?: string;
  readonly assignedEmployeeId?: EmployeeId;
  readonly assignedTeamId?: string;
};

export function buildConversationRoutingOptions(input: {
  readonly tenantId: TenantId;
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly conversation: InternalInboxConversation;
  readonly employees: readonly TenantEmployeeRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): ConversationRoutingOptions {
  const activeEmployees = input.employees.filter(
    (employee) => employee.deactivatedAt === null
  );
  const canRouteConversation = canRouteConversationTarget(input, {});

  if (!canRouteConversation) {
    return {
      canRouteConversation: false,
      employees: [],
      teams: [],
      workQueues: [],
      canClearQueue: false,
      canClearAssignee: false,
      canClearTeam: false,
      canClearAssignment: false,
      canAssignToCurrentEmployee: false
    };
  }

  return {
    canRouteConversation: true,
    employees: activeEmployees.filter((employee) =>
      canRouteConversationTarget(input, {
        assignedEmployeeId: employee.employeeId
      })
    ),
    teams: input.teams.filter((team) =>
      canRouteConversationTarget(input, {
        assignedTeamId: team.id
      })
    ),
    workQueues: input.workQueues.filter((workQueue) =>
      canRouteConversationTarget(input, {
        currentQueueId: workQueue.id,
        currentQueueOwningOrgUnitId: workQueue.owningOrgUnitId ?? undefined
      })
    ),
    canClearQueue: canRouteConversationTarget(input, {
      currentQueueId: undefined,
      currentQueueOwningOrgUnitId: undefined
    }),
    canClearAssignee: canRouteConversationTarget(input, {
      assignedEmployeeId: undefined
    }),
    canClearTeam: canRouteConversationTarget(input, {
      assignedTeamId: undefined
    }),
    canClearAssignment: canRouteConversationTarget(input, {
      assignedEmployeeId: undefined,
      assignedTeamId: undefined
    }),
    canAssignToCurrentEmployee:
      activeEmployees.some(
        (employee) => employee.employeeId === input.actor.employeeId
      ) &&
      canRouteConversationTarget(input, {
        assignedEmployeeId: input.actor.employeeId,
        assignedTeamId: undefined
      })
  };
}

export function permissionActorFromTenantEmployee(
  employee: TenantEmployeeRecord
): PermissionActor {
  return {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };
}

function canRouteConversationTarget(
  input: {
    readonly tenantId: TenantId;
    readonly actor: PermissionActor;
    readonly effectiveGrants: readonly EffectivePermissionGrant[];
    readonly conversation: InternalInboxConversation;
  },
  patch: ConversationRoutingTargetPatch
): boolean {
  return canAccess({
    actor: input.actor,
    effectiveGrants: input.effectiveGrants,
    permission: "conversation.assign",
    resource: conversationResourceContext(
      input.tenantId,
      input.conversation,
      patch
    )
  }).allowed;
}

function conversationResourceContext(
  tenantId: TenantId,
  conversation: InternalInboxConversation,
  patch: ConversationRoutingTargetPatch
): PermissionResourceContext {
  const currentQueueId = patchValue(
    patch,
    "currentQueueId",
    conversation.currentQueueId
  );
  const currentQueueOwningOrgUnitId = patchValue(
    patch,
    "currentQueueOwningOrgUnitId",
    conversation.currentQueueOwningOrgUnitId
  );
  const assignedEmployeeId = patchValue(
    patch,
    "assignedEmployeeId",
    conversation.assignedEmployeeId as EmployeeId | undefined
  );
  const assignedTeamId = patchValue(
    patch,
    "assignedTeamId",
    conversation.assignedTeamId
  );

  return {
    tenantId,
    clientId: conversation.clientId as PermissionResourceContext["clientId"],
    conversationId:
      conversation.id as PermissionResourceContext["conversationId"],
    orgUnitId: currentQueueOwningOrgUnitId,
    teamId: assignedTeamId,
    teamIds: assignedTeamId === undefined ? undefined : [assignedTeamId],
    queueId: currentQueueId,
    assignedEmployeeId,
    assignedTeamIds: assignedTeamId === undefined ? undefined : [assignedTeamId]
  };
}

function patchValue<TPatch extends object, TKey extends keyof TPatch, TValue>(
  patch: TPatch,
  key: TKey,
  fallback: TValue
): TPatch[TKey] | TValue {
  return key in patch ? patch[key] : fallback;
}
