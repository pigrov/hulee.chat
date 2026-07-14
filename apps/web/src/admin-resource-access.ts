import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  canAccess,
  CoreError,
  isPermissionScopeAllowed,
  type Permission,
  type PermissionResourceContext
} from "@hulee/core";
import type {
  EmployeeDirectoryRepository,
  TenantEmployeeRecord,
  TenantRbacRepository
} from "@hulee/db";

import {
  resolveEmployeeEffectiveAccess,
  type WebEffectiveAccessSnapshot
} from "./rbac-effective-access";

export async function requireAdminResourceAccess(input: {
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

export type EmployeeDirectoryReadScope =
  | { readonly mode: "denied" }
  | { readonly mode: "tenant" }
  | {
      readonly mode: "scoped";
      readonly orgUnitIds: readonly string[];
      readonly teamIds: readonly string[];
    };

export function resolveEmployeeDirectoryReadScope(
  access: WebEffectiveAccessSnapshot | undefined
): EmployeeDirectoryReadScope {
  if (access === undefined) {
    return { mode: "denied" };
  }

  const effectiveGrants = actorBoundValidEffectiveGrants(access);

  if (
    canAccess({
      actor: access.actor,
      effectiveGrants,
      permission: "employees.manage",
      resource: { tenantId: access.actor.tenantId }
    }).allowed
  ) {
    return { mode: "tenant" };
  }

  const orgUnitIds = new Set<string>();
  const teamIds = new Set<string>();

  for (const grant of effectiveGrants) {
    if (
      grant.scope.type === "org_unit" &&
      canAccess({
        actor: access.actor,
        effectiveGrants,
        permission: "employees.manage",
        resource: {
          tenantId: access.actor.tenantId,
          orgUnitId: grant.scope.id,
          orgUnitIds: [grant.scope.id]
        }
      }).allowed
    ) {
      orgUnitIds.add(grant.scope.id);
    }

    if (
      grant.scope.type === "team" &&
      canAccess({
        actor: access.actor,
        effectiveGrants,
        permission: "employees.manage",
        resource: {
          tenantId: access.actor.tenantId,
          teamId: grant.scope.id,
          teamIds: [grant.scope.id]
        }
      }).allowed
    ) {
      teamIds.add(grant.scope.id);
    }
  }

  if (orgUnitIds.size === 0 && teamIds.size === 0) {
    return { mode: "denied" };
  }

  return {
    mode: "scoped",
    orgUnitIds: [...orgUnitIds].sort(),
    teamIds: [...teamIds].sort()
  };
}

export async function loadEmployeeDirectoryForAccess(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly repository: Pick<
    EmployeeDirectoryRepository,
    "listEmployees" | "listEmployeesByMembershipScopes"
  >;
}): Promise<readonly TenantEmployeeRecord[]> {
  const access = input.access;

  if (access === undefined) {
    return [];
  }

  const scope = resolveEmployeeDirectoryReadScope(access);

  if (scope.mode === "denied") {
    return [];
  }

  const employees =
    scope.mode === "tenant"
      ? await input.repository.listEmployees({
          tenantId: access.actor.tenantId
        })
      : await input.repository.listEmployeesByMembershipScopes({
          tenantId: access.actor.tenantId,
          orgUnitIds: scope.orgUnitIds,
          teamIds: scope.teamIds
        });

  return filterEmployeesByResourceAccess({
    access,
    employees,
    permission: "employees.manage"
  });
}

export function canAccessEmployeeResource(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly employee: TenantEmployeeRecord;
  readonly permission: Permission;
}): boolean {
  const access = input.access;

  if (
    access === undefined ||
    input.employee.tenantId !== access.actor.tenantId
  ) {
    return false;
  }

  return employeePermissionResources(input.employee).some(
    (resource) =>
      canAccess({
        actor: access.actor,
        effectiveGrants: actorBoundValidEffectiveGrants(access),
        permission: input.permission,
        resource
      }).allowed
  );
}

export function assertCanAccessEmployeeResource(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly employee: TenantEmployeeRecord;
  readonly permission: Permission;
}): void {
  if (!canAccessEmployeeResource(input)) {
    throw new CoreError("permission.denied");
  }
}

export function filterEmployeesByResourceAccess(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly employees: readonly TenantEmployeeRecord[];
  readonly permission: Permission;
}): readonly TenantEmployeeRecord[] {
  return input.employees.filter((employee) =>
    canAccessEmployeeResource({
      access: input.access,
      employee,
      permission: input.permission
    })
  );
}

export function canAccessTenantResource(input: {
  readonly access: WebEffectiveAccessSnapshot | undefined;
  readonly permission: Permission;
}): boolean {
  if (input.access === undefined) {
    return false;
  }

  return canAccess({
    actor: input.access.actor,
    effectiveGrants: actorBoundValidEffectiveGrants(input.access),
    permission: input.permission,
    resource: {
      tenantId: input.access.actor.tenantId
    }
  }).allowed;
}

export function assertCanAccessTenantResource(input: {
  readonly access: WebEffectiveAccessSnapshot;
  readonly permission: Permission;
}): void {
  if (!canAccessTenantResource(input)) {
    throw new CoreError("permission.denied");
  }
}

function actorBoundValidEffectiveGrants(
  access: WebEffectiveAccessSnapshot
): WebEffectiveAccessSnapshot["effectiveGrants"] {
  return access.effectiveGrants.filter(
    (grant) =>
      grant.tenantId === access.actor.tenantId &&
      grant.employeeId === access.actor.employeeId &&
      isPermissionScopeAllowed(grant.permission, grant.scope.type)
  );
}

function employeePermissionResources(
  employee: TenantEmployeeRecord
): readonly PermissionResourceContext[] {
  const baseResource: PermissionResourceContext = {
    tenantId: employee.tenantId,
    orgUnitIds: employee.orgUnitIds,
    teamIds: employee.teamIds
  };

  return [
    baseResource,
    ...employee.queueIds.map((queueId) => ({
      ...baseResource,
      queueId
    }))
  ];
}
