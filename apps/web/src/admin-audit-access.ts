import type { SecurityAuditAuthorization } from "@hulee/db";
import {
  canAccess,
  isPermissionScopeAllowed,
  type PermissionResourceContext
} from "@hulee/core";

import type { WebEffectiveAccessSnapshot } from "./rbac-effective-access";

export function resolveAdminAuditAuthorization(
  accessSnapshot: WebEffectiveAccessSnapshot | undefined
): SecurityAuditAuthorization | undefined {
  if (accessSnapshot === undefined) {
    return undefined;
  }

  const effectiveGrants = accessSnapshot.effectiveGrants.filter(
    (grant) =>
      grant.tenantId === accessSnapshot.actor.tenantId &&
      grant.employeeId === accessSnapshot.actor.employeeId &&
      isPermissionScopeAllowed(grant.permission, grant.scope.type)
  );

  if (
    canViewAuditResource({
      accessSnapshot,
      effectiveGrants,
      resource: { tenantId: accessSnapshot.actor.tenantId }
    })
  ) {
    return { kind: "tenant" };
  }

  const orgUnitIds = new Set<string>();
  const teamIds = new Set<string>();
  const queueIds = new Set<string>();

  for (const grant of effectiveGrants) {
    switch (grant.scope.type) {
      case "org_unit":
        if (
          canViewAuditResource({
            accessSnapshot,
            effectiveGrants,
            resource: {
              tenantId: accessSnapshot.actor.tenantId,
              orgUnitId: grant.scope.id
            }
          })
        ) {
          addScopeId(orgUnitIds, grant.scope.id);
        }
        break;
      case "team":
        if (
          canViewAuditResource({
            accessSnapshot,
            effectiveGrants,
            resource: {
              tenantId: accessSnapshot.actor.tenantId,
              teamId: grant.scope.id
            }
          })
        ) {
          addScopeId(teamIds, grant.scope.id);
        }
        break;
      case "queue":
        if (
          canViewAuditResource({
            accessSnapshot,
            effectiveGrants,
            resource: {
              tenantId: accessSnapshot.actor.tenantId,
              queueId: grant.scope.id
            }
          })
        ) {
          addScopeId(queueIds, grant.scope.id);
        }
        break;
      case "tenant":
      case "assigned":
      case "own":
      case "client":
      case "conversation":
        break;
    }
  }

  if (orgUnitIds.size + teamIds.size + queueIds.size === 0) {
    return undefined;
  }

  return {
    kind: "scoped",
    orgUnitIds: [...orgUnitIds].sort(),
    teamIds: [...teamIds].sort(),
    queueIds: [...queueIds].sort()
  };
}

function canViewAuditResource(input: {
  readonly accessSnapshot: WebEffectiveAccessSnapshot;
  readonly effectiveGrants: WebEffectiveAccessSnapshot["effectiveGrants"];
  readonly resource: PermissionResourceContext;
}): boolean {
  return canAccess({
    actor: input.accessSnapshot.actor,
    effectiveGrants: input.effectiveGrants,
    permission: "audit.view",
    resource: input.resource
  }).allowed;
}

function addScopeId(target: Set<string>, id: string): void {
  const normalizedId = id.trim();

  if (normalizedId.length > 0) {
    target.add(normalizedId);
  }
}
