import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  resolveEffectivePermissionGrants,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  TenantEmployeeRecord,
  TenantRbacRepository
} from "@hulee/db";

export type WebEffectiveAccessSnapshot = {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
};

export async function resolveEmployeeEffectiveAccess(input: {
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
}): Promise<WebEffectiveAccessSnapshot | undefined> {
  const employee = await input.employeeRepository.findEmployee({
    tenantId: input.tenantId,
    employeeId: input.employeeId
  });

  if (
    employee === null ||
    employee.deactivatedAt !== null ||
    employee.tenantId !== input.tenantId
  ) {
    return undefined;
  }

  const at = input.at ?? new Date();
  const actor = permissionActorFromTenantEmployee(employee);
  const sources = await input.rbacRepository.listEffectiveAccessSources({
    actor,
    at
  });

  return {
    actor,
    effectiveGrants: resolveEffectivePermissionGrants({
      actor,
      roles: sources.roles,
      roleBindings: sources.roleBindings,
      directGrants: sources.directGrants,
      at
    })
  };
}

export function permissionActorFromTenantEmployee(
  employee: TenantEmployeeRecord
): PermissionActor {
  return {
    tenantId: employee.tenantId,
    employeeId: employee.employeeId,
    roles: employee.roles,
    orgUnitIds: employee.orgUnitIds,
    queueIds: employee.queueIds,
    teamIds: employee.teamIds
  };
}

export function hasEffectivePermission(
  accessSnapshot: WebEffectiveAccessSnapshot | undefined,
  permission: Permission
): boolean {
  return (
    accessSnapshot?.effectiveGrants.some(
      (grant) =>
        grant.tenantId === accessSnapshot.actor.tenantId &&
        grant.employeeId === accessSnapshot.actor.employeeId &&
        grant.permission === permission
    ) ?? false
  );
}
