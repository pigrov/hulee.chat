import type { InternalAccessDecisionScope } from "@hulee/contracts";
import {
  canAccess,
  CoreError,
  isPermissionScopeAllowed,
  type EffectivePermissionGrant,
  type PermissionActor,
  type PermissionRoleBinding,
  type PermissionRoleDefinition,
  type PermissionScope,
  type PermissionResourceContext
} from "@hulee/core";

import {
  assertCanGrantScopedPermissions,
  assertCanManageScopedAccess
} from "./rbac-least-privilege";

export type EmployeeMembershipType = "org_unit" | "team" | "queue";

export type EmployeeMembershipAccessResource = {
  readonly type: EmployeeMembershipType;
  readonly id: string;
  readonly resource: PermissionResourceContext;
};

export type EmployeeMembershipAccessTarget = {
  readonly tenantId: PermissionActor["tenantId"];
  readonly employeeId: PermissionActor["employeeId"];
  readonly orgUnitIds: readonly string[];
  readonly queueIds: readonly string[];
  readonly teamIds: readonly string[];
};

export function assertCanManageEmployeeMembershipTarget(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: EmployeeMembershipAccessTarget;
}): void {
  if (input.target.employeeId === input.actor.employeeId) {
    throw new CoreError("permission.denied");
  }

  const baseResource: PermissionResourceContext = {
    tenantId: input.target.tenantId,
    orgUnitIds: input.target.orgUnitIds,
    teamIds: input.target.teamIds
  };
  const resources = [
    baseResource,
    ...input.target.queueIds.map((queueId) => ({
      ...baseResource,
      queueId
    }))
  ];

  if (
    !resources.some(
      (resource) =>
        canAccess({
          actor: input.actor,
          effectiveGrants: input.effectiveGrants,
          permission: "roles.manage",
          resource
        }).allowed
    )
  ) {
    throw new CoreError("permission.denied");
  }
}

export function assertCanUpdateEmployeeMemberships(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly target: EmployeeMembershipAccessTarget;
  readonly membershipType: EmployeeMembershipType;
  readonly previousIds: readonly string[];
  readonly nextIds: readonly string[];
  readonly resources: readonly EmployeeMembershipAccessResource[];
  readonly roleBindings: readonly PermissionRoleBinding[];
  readonly roles: readonly PermissionRoleDefinition[];
}): readonly InternalAccessDecisionScope[] {
  assertCanManageEmployeeMembershipTarget(input);

  const resourcesById = new Map(
    input.resources.map((resource) => [
      membershipResourceKey(resource.type, resource.id),
      resource.resource
    ])
  );

  for (const membershipId of membershipIds(input.previousIds, input.nextIds)) {
    const resource = resourcesById.get(
      membershipResourceKey(input.membershipType, membershipId)
    );

    if (resource === undefined) {
      throw new CoreError("permission.denied");
    }

    assertCanManageScopedAccess({
      actor: input.actor,
      effectiveGrants: input.effectiveGrants,
      target: {
        resource
      }
    });
  }

  const authorizationScopes = authorizationScopesFromResources(
    targetStructuralResources({
      target: input.target,
      membershipType: input.membershipType,
      previousIds: input.previousIds,
      nextIds: input.nextIds,
      resourcesById
    })
  );
  const rolesById = new Map(input.roles.map((role) => [role.id, role]));

  for (const change of membershipChanges(input.previousIds, input.nextIds)) {
    const subjectResource = resourcesById.get(
      membershipResourceKey(input.membershipType, change.id)
    );

    if (subjectResource === undefined) {
      throw new CoreError("permission.denied");
    }

    for (const binding of input.roleBindings) {
      if (
        binding.subject.type !== input.membershipType ||
        binding.subject.id !== change.id
      ) {
        continue;
      }

      if (binding.tenantId !== input.actor.tenantId) {
        throw new CoreError("permission.denied");
      }

      const role = rolesById.get(binding.roleId);

      if (role === undefined || role.tenantId !== input.actor.tenantId) {
        throw new CoreError("permission.denied");
      }

      if (role.status === "archived" || role.archivedAt !== undefined) {
        continue;
      }

      if (
        role.permissions.some(
          (permission) =>
            !isPermissionScopeAllowed(permission, binding.scope.type)
        )
      ) {
        throw new CoreError("permission.denied");
      }

      const bindingScopeResource = resolveBindingScopeResource({
        tenantId: input.actor.tenantId,
        scope: binding.scope,
        resourcesById
      });

      assertCanManageScopedAccess({
        actor: input.actor,
        effectiveGrants: input.effectiveGrants,
        target: { resource: subjectResource }
      });

      if (change.type === "added") {
        assertCanGrantScopedPermissions({
          actor: input.actor,
          effectiveGrants: input.effectiveGrants,
          target: {
            permissions: role.permissions,
            resource: bindingScopeResource
          }
        });
      } else {
        assertCanManageScopedAccess({
          actor: input.actor,
          effectiveGrants: input.effectiveGrants,
          target: { resource: bindingScopeResource }
        });
      }

      authorizationScopes.push(
        permissionScopeAuthorizationScope(binding.scope),
        ...authorizationScopesFromResources([
          subjectResource,
          bindingScopeResource
        ])
      );
    }
  }

  return normalizeAuthorizationScopes(authorizationScopes);
}

function targetStructuralResources(input: {
  readonly target: EmployeeMembershipAccessTarget;
  readonly membershipType: EmployeeMembershipType;
  readonly previousIds: readonly string[];
  readonly nextIds: readonly string[];
  readonly resourcesById: ReadonlyMap<string, PermissionResourceContext>;
}): readonly PermissionResourceContext[] {
  const idsByType: Record<EmployeeMembershipType, readonly string[]> = {
    org_unit:
      input.membershipType === "org_unit"
        ? membershipIds(input.previousIds, input.nextIds)
        : input.target.orgUnitIds,
    team:
      input.membershipType === "team"
        ? membershipIds(input.previousIds, input.nextIds)
        : input.target.teamIds,
    queue:
      input.membershipType === "queue"
        ? membershipIds(input.previousIds, input.nextIds)
        : input.target.queueIds
  };
  const resources: PermissionResourceContext[] = [];

  for (const type of ["org_unit", "team", "queue"] as const) {
    for (const id of [...new Set(idsByType[type])].sort()) {
      const resource = input.resourcesById.get(membershipResourceKey(type, id));

      if (resource === undefined) {
        throw new CoreError("permission.denied");
      }

      resources.push(resource);
    }
  }

  return resources;
}

function resolveBindingScopeResource(input: {
  readonly tenantId: PermissionActor["tenantId"];
  readonly scope: PermissionScope;
  readonly resourcesById: ReadonlyMap<string, PermissionResourceContext>;
}): PermissionResourceContext {
  switch (input.scope.type) {
    case "tenant":
    case "assigned":
    case "own":
      return { tenantId: input.tenantId };
    case "client":
    case "conversation":
      throw new CoreError("permission.denied");
    case "org_unit":
    case "team":
    case "queue": {
      const resource = input.resourcesById.get(
        membershipResourceKey(input.scope.type, input.scope.id)
      );

      if (resource === undefined) {
        throw new CoreError("permission.denied");
      }

      return resource;
    }
  }
}

function authorizationScopesFromResources(
  resources: readonly PermissionResourceContext[]
): InternalAccessDecisionScope[] {
  const scopes: InternalAccessDecisionScope[] = [];

  for (const resource of resources) {
    for (const orgUnitId of resourceIds(
      resource.orgUnitId,
      resource.orgUnitIds
    )) {
      scopes.push({ type: "org_unit", id: orgUnitId });
    }

    for (const teamId of resourceIds(resource.teamId, resource.teamIds)) {
      scopes.push({ type: "team", id: teamId });
    }

    if (resource.queueId !== undefined) {
      scopes.push({ type: "queue", id: resource.queueId });
    }
  }

  return scopes;
}

function permissionScopeAuthorizationScope(
  scope: PermissionScope
): InternalAccessDecisionScope {
  return "id" in scope
    ? { type: scope.type, id: scope.id }
    : { type: scope.type };
}

function normalizeAuthorizationScopes(
  input: readonly InternalAccessDecisionScope[]
): readonly InternalAccessDecisionScope[] {
  const scopes = new Map<string, InternalAccessDecisionScope>();

  for (const scope of input) {
    scopes.set("id" in scope ? `${scope.type}:${scope.id}` : scope.type, scope);
  }

  const order: Record<InternalAccessDecisionScope["type"], number> = {
    tenant: 0,
    org_unit: 1,
    team: 2,
    queue: 3,
    assigned: 4,
    own: 5,
    client: 6,
    conversation: 7
  };

  return [...scopes.values()].sort(
    (left, right) =>
      order[left.type] - order[right.type] ||
      ("id" in left && "id" in right ? left.id.localeCompare(right.id) : 0)
  );
}

function resourceIds(
  scalarId: string | undefined,
  ids: readonly string[] | undefined
): readonly string[] {
  return [
    ...new Set([...(scalarId === undefined ? [] : [scalarId]), ...(ids ?? [])])
  ];
}

function membershipResourceKey(
  type: EmployeeMembershipType,
  id: string
): string {
  return `${type}:${id}`;
}

function membershipChanges(
  previousIds: readonly string[],
  nextIds: readonly string[]
): readonly { readonly id: string; readonly type: "added" | "removed" }[] {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);

  return [
    ...[...next]
      .filter((id) => !previous.has(id))
      .map((id) => ({ id, type: "added" as const })),
    ...[...previous]
      .filter((id) => !next.has(id))
      .map((id) => ({ id, type: "removed" as const }))
  ].sort((left, right) => left.id.localeCompare(right.id));
}

function membershipIds(
  previousIds: readonly string[],
  nextIds: readonly string[]
): readonly string[] {
  return [...new Set([...previousIds, ...nextIds])].sort();
}
