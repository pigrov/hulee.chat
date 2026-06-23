import {
  allowedScopeTypesForPermissions,
  type Permission,
  type PermissionScopeType
} from "@hulee/core";

export const roleBindingScopeTypes = [
  "tenant",
  "org_unit",
  "team",
  "queue",
  "assigned",
  "own"
] as const satisfies readonly PermissionScopeType[];

export function allowedRoleBindingScopeTypesForPermissions(
  permissions: readonly Permission[]
): readonly PermissionScopeType[] {
  const allowedScopeTypes = allowedScopeTypesForPermissions(permissions);

  return roleBindingScopeTypes.filter((scopeType) =>
    allowedScopeTypes.includes(scopeType)
  );
}
