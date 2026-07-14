import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  canAccess,
  CoreError,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  OrgUnitRecord,
  TeamRecord,
  TenantRbacRepository,
  WorkQueueRecord
} from "@hulee/db";

import {
  resolveEmployeeEffectiveAccess,
  type WebEffectiveAccessSnapshot
} from "./rbac-effective-access";

export type AdminStructureRows = {
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
};

export async function requireAdminStructureAccess(input: {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly employeeRepository: Pick<
    EmployeeDirectoryRepository,
    "findEmployee"
  >;
  readonly rbacRepository: Pick<
    TenantRbacRepository,
    "listEffectiveAccessSources"
  >;
  readonly at?: Date;
}): Promise<WebEffectiveAccessSnapshot> {
  const access = await resolveEmployeeEffectiveAccess(input);

  if (access === undefined) {
    throw new CoreError("permission.denied");
  }

  return access;
}

export function canManageTenantStructure(
  access: WebEffectiveAccessSnapshot | undefined
): boolean {
  if (access === undefined) {
    return false;
  }

  return canManageStructureResource(access, {
    tenantId: access.actor.tenantId
  });
}

export function canManageOrgUnit(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly orgUnit: OrgUnitRecord;
}): boolean {
  return canManageStructureResource(
    input.access,
    orgUnitResource(input.orgUnit)
  );
}

export function canManageTeam(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly team: TeamRecord;
}): boolean {
  return canManageStructureResource(input.access, teamResource(input.team));
}

export function canManageWorkQueue(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly workQueue: WorkQueueRecord;
}): boolean {
  return canManageStructureResource(
    input.access,
    workQueueResource(input.workQueue)
  );
}

export function assertCanManageTenantStructure(
  access: WebEffectiveAccessSnapshot
): void {
  assertCanManageStructureResource(access, {
    tenantId: access.actor.tenantId
  });
}

export function assertCanManageOrgUnit(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly orgUnit: OrgUnitRecord;
}): void {
  assertCanManageStructureResource(
    input.access,
    orgUnitResource(input.orgUnit)
  );
}

export function assertCanManageTeam(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly team: TeamRecord;
}): void {
  assertCanManageStructureResource(input.access, teamResource(input.team));
}

export function assertCanManageWorkQueue(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly workQueue: WorkQueueRecord;
}): void {
  assertCanManageStructureResource(
    input.access,
    workQueueResource(input.workQueue)
  );
}

export function assertCanManageOrgAnchor(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly tenantId: TenantId;
  readonly orgUnit: OrgUnitRecord | null;
}): void {
  assertCanManageStructureResource(
    input.access,
    input.orgUnit === null
      ? { tenantId: input.tenantId }
      : orgUnitResource(input.orgUnit)
  );
}

export function filterAdminStructureRows(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly orgUnits: readonly OrgUnitRecord[];
  readonly teams: readonly TeamRecord[];
  readonly workQueues: readonly WorkQueueRecord[];
}): AdminStructureRows {
  const visibleOrgUnits = input.orgUnits.filter((orgUnit) =>
    canManageOrgUnit({ access: input.access, orgUnit })
  );
  const visibleOrgUnitIds = new Set(
    visibleOrgUnits.map((orgUnit) => orgUnit.id)
  );

  return {
    orgUnits: visibleOrgUnits.map((orgUnit) => ({
      ...orgUnit,
      parentOrgUnitId:
        orgUnit.parentOrgUnitId === null ||
        visibleOrgUnitIds.has(orgUnit.parentOrgUnitId)
          ? orgUnit.parentOrgUnitId
          : null
    })),
    teams: input.teams.filter((team) =>
      canManageTeam({ access: input.access, team })
    ),
    workQueues: input.workQueues
      .filter((workQueue) =>
        canManageWorkQueue({ access: input.access, workQueue })
      )
      .map((workQueue) => ({
        ...workQueue,
        owningOrgUnitId:
          workQueue.owningOrgUnitId === null ||
          visibleOrgUnitIds.has(workQueue.owningOrgUnitId)
            ? workQueue.owningOrgUnitId
            : null
      }))
  };
}

function canManageStructureResource(
  access: WebEffectiveAccessSnapshot | undefined,
  resource: PermissionResourceContext
): boolean {
  if (access === undefined || resource.tenantId !== access.actor.tenantId) {
    return false;
  }

  return canAccess({
    actor: access.actor,
    effectiveGrants: access.effectiveGrants,
    permission: "employees.manage",
    resource
  }).allowed;
}

function assertCanManageStructureResource(
  access: WebEffectiveAccessSnapshot,
  resource: PermissionResourceContext
): void {
  if (!canManageStructureResource(access, resource)) {
    throw new CoreError("permission.denied");
  }
}

function orgUnitResource(orgUnit: OrgUnitRecord): PermissionResourceContext {
  return {
    tenantId: orgUnit.tenantId,
    orgUnitId: orgUnit.id,
    orgUnitIds: [orgUnit.id]
  };
}

function teamResource(team: TeamRecord): PermissionResourceContext {
  return {
    tenantId: team.tenantId,
    teamId: team.id,
    teamIds: [team.id]
  };
}

function workQueueResource(
  workQueue: WorkQueueRecord
): PermissionResourceContext {
  return {
    tenantId: workQueue.tenantId,
    orgUnitId: workQueue.owningOrgUnitId ?? undefined,
    queueId: workQueue.id
  };
}
