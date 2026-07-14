import type {
  ClientId,
  ConversationId,
  EmployeeId,
  InternalAccessDecisionGrant,
  InternalAccessDecisionGrantSource,
  InternalAccessDecisionRequest,
  InternalAccessDecisionResourceContext,
  InternalAccessDecisionResponse,
  TenantId
} from "@hulee/contracts";
import {
  canAccess,
  CoreError,
  isPermission,
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor,
  type PermissionGrantSource,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  TenantEmployeeRecord,
  TenantRbacRepository
} from "@hulee/db";

export type InternalAccessDecisionContext = {
  requestId: string;
  tenantId: TenantId;
  employeeId: EmployeeId;
};

export type InternalAccessDecisionService = {
  inspectAccessDecision(
    context: InternalAccessDecisionContext,
    request: InternalAccessDecisionRequest
  ): Promise<InternalAccessDecisionResponse>;
};

export type InternalAccessDecisionServiceOptions = {
  employeeRepository: Pick<EmployeeDirectoryRepository, "findEmployee">;
  rbacRepository: Pick<TenantRbacRepository, "listEffectiveAccessSources">;
  now?: () => Date;
};

type AccessSnapshot = {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
};

export function createInternalAccessDecisionService(
  options: InternalAccessDecisionServiceOptions
): InternalAccessDecisionService {
  const now = options.now ?? (() => new Date());

  return {
    async inspectAccessDecision(context, request) {
      const permission = parsePermission(request.permission);
      const authorizationAt = now();
      const evaluatedAt = parseEvaluationTime(
        request.at,
        () => authorizationAt
      );
      const resource = normalizeResourceContext(request.resource);
      const permissionResource = toPermissionResourceContext(
        context.tenantId,
        resource
      );
      const requester = await loadActiveEmployee({
        employeeRepository: options.employeeRepository,
        tenantId: context.tenantId,
        employeeId: context.employeeId
      });
      const requesterSnapshot = await resolveAccessSnapshot({
        employee: requester,
        rbacRepository: options.rbacRepository,
        at: authorizationAt
      });
      const hasTenantInspection = canAccess({
        actor: requesterSnapshot.actor,
        permission: "roles.manage",
        resource: { tenantId: context.tenantId },
        effectiveGrants: requesterSnapshot.effectiveGrants
      }).allowed;

      if (!hasTenantInspection) {
        assertCanonicalScopedInspectionResource(resource);
      }

      const inspectionDecision = canAccess({
        actor: requesterSnapshot.actor,
        permission: "roles.manage",
        resource: permissionResource,
        effectiveGrants: requesterSnapshot.effectiveGrants
      });

      if (!inspectionDecision.allowed) {
        throw new CoreError("permission.denied");
      }

      const targetEmployee = await loadActiveEmployee({
        employeeRepository: options.employeeRepository,
        tenantId: context.tenantId,
        employeeId: request.employeeId as EmployeeId
      });
      assertCanInspectEmployeeTarget({
        requesterSnapshot,
        targetEmployee
      });
      const targetSnapshot = await resolveAccessSnapshot({
        employee: targetEmployee,
        rbacRepository: options.rbacRepository,
        at: evaluatedAt
      });
      const decision = canAccess({
        actor: targetSnapshot.actor,
        permission,
        resource: permissionResource,
        effectiveGrants: targetSnapshot.effectiveGrants
      });
      const visibleEffectiveGrants = hasTenantInspection
        ? targetSnapshot.effectiveGrants
        : targetSnapshot.effectiveGrants.filter((grant) =>
            isGrantRelevantToResource({
              actor: targetSnapshot.actor,
              grant,
              resource: permissionResource
            })
          );
      const candidateGrants = visibleEffectiveGrants
        .filter((grant) => grant.permission === permission)
        .map(toInternalGrant);

      return {
        employeeId: targetEmployee.employeeId,
        permission,
        resource,
        evaluatedAt: evaluatedAt.toISOString(),
        decision: {
          allowed: decision.allowed,
          reason: decision.reason,
          matchedGrant:
            decision.matchedGrant === undefined
              ? undefined
              : toInternalGrant(decision.matchedGrant)
        },
        candidateGrants,
        effectiveGrantCount: visibleEffectiveGrants.length
      };
    }
  };
}

async function loadActiveEmployee(input: {
  employeeRepository: Pick<EmployeeDirectoryRepository, "findEmployee">;
  tenantId: TenantId;
  employeeId: EmployeeId;
}): Promise<TenantEmployeeRecord> {
  const employee = await input.employeeRepository.findEmployee({
    tenantId: input.tenantId,
    employeeId: input.employeeId
  });

  if (
    employee === null ||
    employee.tenantId !== input.tenantId ||
    employee.deactivatedAt !== null
  ) {
    throw new CoreError("permission.denied");
  }

  return employee;
}

function assertCanInspectEmployeeTarget(input: {
  readonly requesterSnapshot: AccessSnapshot;
  readonly targetEmployee: TenantEmployeeRecord;
}): void {
  const baseResource: PermissionResourceContext = {
    tenantId: input.targetEmployee.tenantId,
    orgUnitIds: input.targetEmployee.orgUnitIds,
    teamIds: input.targetEmployee.teamIds
  };
  const targetResources = [
    baseResource,
    ...input.targetEmployee.queueIds.map((queueId) => ({
      ...baseResource,
      queueId
    }))
  ];

  if (
    !targetResources.some(
      (resource) =>
        canAccess({
          actor: input.requesterSnapshot.actor,
          permission: "roles.manage",
          resource,
          effectiveGrants: input.requesterSnapshot.effectiveGrants
        }).allowed
    )
  ) {
    throw new CoreError("permission.denied");
  }
}

function assertCanonicalScopedInspectionResource(
  resource: InternalAccessDecisionResourceContext
): void {
  const hasNonStructuralRelation =
    resource.assignedEmployeeId !== undefined ||
    resource.assignedEmployeeIds !== undefined ||
    resource.assignedTeamIds !== undefined ||
    resource.ownerEmployeeId !== undefined ||
    resource.clientId !== undefined ||
    resource.conversationId !== undefined;
  const structuralAnchorCount =
    (resource.orgUnitId === undefined ? 0 : 1) +
    (resource.orgUnitIds?.length ?? 0) +
    (resource.teamId === undefined ? 0 : 1) +
    (resource.teamIds?.length ?? 0) +
    (resource.queueId === undefined ? 0 : 1);

  if (hasNonStructuralRelation || structuralAnchorCount !== 1) {
    throw new CoreError("permission.denied");
  }
}

function isGrantRelevantToResource(input: {
  readonly actor: PermissionActor;
  readonly grant: EffectivePermissionGrant;
  readonly resource: PermissionResourceContext;
}): boolean {
  return canAccess({
    actor: input.actor,
    permission: input.grant.permission,
    resource: input.resource,
    effectiveGrants: [input.grant]
  }).allowed;
}

async function resolveAccessSnapshot(input: {
  employee: TenantEmployeeRecord;
  rbacRepository: Pick<TenantRbacRepository, "listEffectiveAccessSources">;
  at: Date;
}): Promise<AccessSnapshot> {
  const actor = permissionActorFromEmployee(input.employee);
  const sources = await input.rbacRepository.listEffectiveAccessSources({
    actor,
    at: input.at
  });

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at: input.at
    })
  };
}

function permissionActorFromEmployee(
  employee: TenantEmployeeRecord
): PermissionActor {
  return {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    teamIds: employee.teamIds,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds
  };
}

function parsePermission(value: string): Permission {
  if (!isPermission(value)) {
    throw new CoreError("validation.failed");
  }

  return value;
}

function parseEvaluationTime(value: string | undefined, now: () => Date): Date {
  if (value === undefined) {
    return now();
  }

  const date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new CoreError("validation.failed");
  }

  return date;
}

function normalizeResourceContext(
  resource: InternalAccessDecisionResourceContext
): InternalAccessDecisionResourceContext {
  return {
    orgUnitId: optionalId(resource.orgUnitId),
    orgUnitIds: optionalIds(resource.orgUnitIds),
    teamId: optionalId(resource.teamId),
    teamIds: optionalIds(resource.teamIds),
    queueId: optionalId(resource.queueId),
    assignedEmployeeId: optionalId(resource.assignedEmployeeId),
    assignedEmployeeIds: optionalIds(resource.assignedEmployeeIds),
    assignedTeamIds: optionalIds(resource.assignedTeamIds),
    ownerEmployeeId: optionalId(resource.ownerEmployeeId),
    clientId: optionalId(resource.clientId),
    conversationId: optionalId(resource.conversationId)
  };
}

function toPermissionResourceContext(
  tenantId: TenantId,
  resource: InternalAccessDecisionResourceContext
): PermissionResourceContext {
  return {
    tenantId,
    orgUnitId: resource.orgUnitId,
    orgUnitIds: resource.orgUnitIds,
    teamId: resource.teamId,
    teamIds: resource.teamIds,
    queueId: resource.queueId,
    assignedEmployeeId: resource.assignedEmployeeId as EmployeeId | undefined,
    assignedEmployeeIds: resource.assignedEmployeeIds as
      | readonly EmployeeId[]
      | undefined,
    assignedTeamIds: resource.assignedTeamIds,
    ownerEmployeeId: resource.ownerEmployeeId as EmployeeId | undefined,
    clientId: resource.clientId as ClientId | undefined,
    conversationId: resource.conversationId as ConversationId | undefined
  };
}

function toInternalGrant(
  grant: EffectivePermissionGrant
): InternalAccessDecisionGrant {
  return {
    permission: grant.permission,
    scope:
      "id" in grant.scope
        ? {
            type: grant.scope.type,
            id: grant.scope.id
          }
        : {
            type: grant.scope.type
          },
    sources: grant.sources.map(toInternalGrantSource)
  };
}

function toInternalGrantSource(
  source: PermissionGrantSource
): InternalAccessDecisionGrantSource {
  switch (source.type) {
    case "role_binding":
      return {
        type: "role_binding",
        roleId: source.roleId,
        bindingId: source.bindingId
      };
    case "direct_grant":
      return {
        type: "direct_grant",
        grantId: source.grantId,
        reason: source.reason
      };
  }
}

function optionalId(value: string | undefined): string | undefined {
  const trimmedValue = value?.trim();

  return trimmedValue === undefined || trimmedValue.length === 0
    ? undefined
    : trimmedValue;
}

function optionalIds(
  values: readonly string[] | undefined
): string[] | undefined {
  const normalizedValues =
    values
      ?.map((value) => optionalId(value))
      .filter((value): value is string => value !== undefined) ?? [];

  return normalizedValues.length === 0 ? undefined : normalizedValues;
}
