import type {
  EffectivePermissionGrant,
  PermissionActor,
  PermissionResourceContext
} from "@hulee/core";

import { assertCanManageScopedAccess } from "./rbac-least-privilege";

export type EmployeeMembershipAccessResource = {
  readonly id: string;
  readonly resource: PermissionResourceContext;
};

export function assertCanUpdateEmployeeMemberships(input: {
  readonly actor: PermissionActor;
  readonly effectiveGrants: readonly EffectivePermissionGrant[];
  readonly previousIds: readonly string[];
  readonly nextIds: readonly string[];
  readonly resources: readonly EmployeeMembershipAccessResource[];
}): void {
  const resourcesById = new Map(
    input.resources.map((resource) => [resource.id, resource.resource])
  );

  for (const changedId of changedMembershipIds(
    input.previousIds,
    input.nextIds
  )) {
    const resource = resourcesById.get(changedId);

    if (resource === undefined) {
      throw new Error("Membership reference is not available.");
    }

    assertCanManageScopedAccess({
      actor: input.actor,
      effectiveGrants: input.effectiveGrants,
      target: {
        resource
      }
    });
  }
}

function changedMembershipIds(
  previousIds: readonly string[],
  nextIds: readonly string[]
): readonly string[] {
  const previous = new Set(previousIds);
  const next = new Set(nextIds);
  const changed = new Set<string>();

  for (const id of previous) {
    if (!next.has(id)) {
      changed.add(id);
    }
  }

  for (const id of next) {
    if (!previous.has(id)) {
      changed.add(id);
    }
  }

  return [...changed].sort();
}
