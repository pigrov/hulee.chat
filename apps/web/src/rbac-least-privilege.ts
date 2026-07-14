import {
  CoreError,
  canAccess,
  type EffectivePermissionGrant,
  type Permission,
  type PermissionActor,
  type PermissionResourceContext
} from "@hulee/core";

export type LeastPrivilegeTarget = {
  readonly permissions: readonly Permission[];
  readonly resource: PermissionResourceContext;
};

export function assertCanGrantScopedPermissions(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: LeastPrivilegeTarget;
}): void {
  assertCanManageScopedAccess(input);

  for (const permission of input.target.permissions) {
    const decision = canAccess({
      actor: input.actor,
      effectiveGrants: input.effectiveGrants,
      permission,
      resource: input.target.resource
    });

    if (!decision.allowed) {
      throw new CoreError("permission.denied");
    }
  }
}

export function assertCanManageScopedAccess(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: Pick<LeastPrivilegeTarget, "resource">;
}): void {
  const decision = canAccess({
    actor: input.actor,
    effectiveGrants: input.effectiveGrants,
    permission: "roles.manage",
    resource: input.target.resource
  });

  if (!decision.allowed) {
    throw new CoreError("permission.denied");
  }
}
