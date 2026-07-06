import type { TenantId } from "@hulee/contracts";
import {
  getPermissionDefinition,
  resolveEffectivePermissionGrants,
  type DirectPermissionGrant,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionDomain,
  type PermissionRoleBinding
} from "@hulee/core";
import type { TenantEmployeeRecord, TenantRoleRecord } from "@hulee/db";

import { permissionScopeKey } from "./rbac-role-display";

const effectiveAccessDomainOrder = [
  "tenant",
  "employees",
  "roles",
  "integrations",
  "branding",
  "inbox",
  "messages",
  "conversations",
  "clients",
  "leads",
  "files",
  "reports",
  "audit",
  "api"
] as const satisfies readonly PermissionDomain[];

export function buildEmployeeEffectiveAccessPreview(input: {
  readonly at: Date;
  readonly directGrants: readonly DirectPermissionGrant[];
  readonly employee: TenantEmployeeRecord;
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly roles: readonly TenantRoleRecord[];
  readonly tenantId: TenantId;
}): readonly EffectivePermissionGrant[] {
  const actor: PermissionActor = {
    tenantId: input.tenantId,
    employeeId: input.employee.employeeId,
    teamIds: input.employee.teamIds,
    orgUnitIds: input.employee.orgUnitIds,
    queueIds: input.employee.queueIds
  };

  return [
    ...resolveEffectivePermissionGrants({
      actor,
      roles: input.roles,
      roleBindings: input.roleBindings,
      directGrants: input.directGrants,
      at: input.at
    })
  ].sort(compareEffectiveGrants);
}

function compareEffectiveGrants(
  left: EffectivePermissionGrant,
  right: EffectivePermissionGrant
): number {
  const leftDefinition = getPermissionDefinition(left.permission);
  const rightDefinition = getPermissionDefinition(right.permission);
  const domainComparison =
    effectiveAccessDomainOrder.indexOf(leftDefinition.domain) -
    effectiveAccessDomainOrder.indexOf(rightDefinition.domain);

  if (domainComparison !== 0) {
    return domainComparison;
  }

  const permissionComparison = left.permission.localeCompare(right.permission);

  if (permissionComparison !== 0) {
    return permissionComparison;
  }

  return permissionScopeKey(left.scope).localeCompare(
    permissionScopeKey(right.scope)
  );
}
