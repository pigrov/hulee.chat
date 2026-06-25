import type {
  ClientId,
  ConversationId,
  EmployeeId,
  TenantId
} from "@hulee/contracts";

import { CoreError } from "./errors";
import {
  assertPermissionScopeAllowed,
  isPermissionScope,
  permissionsForRoles,
  type EmployeeRole,
  type Permission,
  type PermissionScope
} from "./permissions";

export type PermissionActor = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly roles?: readonly EmployeeRole[];
  readonly orgUnitIds?: readonly string[];
  readonly queueIds?: readonly string[];
  readonly teamIds?: readonly string[];
};

export type PermissionRoleDefinition = {
  readonly id: string;
  readonly tenantId: TenantId;
  readonly permissions: readonly Permission[];
  readonly status?: "active" | "archived";
  readonly archivedAt?: string;
};

export type PermissionRoleBindingSubject =
  | {
      readonly type: "employee";
      readonly id: EmployeeId;
    }
  | {
      readonly type: "team" | "org_unit" | "queue";
      readonly id: string;
    };

export type PermissionRoleBinding = {
  readonly id?: string;
  readonly tenantId: TenantId;
  readonly roleId: string;
  readonly subject: PermissionRoleBindingSubject;
  readonly scope: PermissionScope;
  readonly startsAt?: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
};

export type DirectPermissionGrant = {
  readonly id?: string;
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly permission: Permission;
  readonly scope: PermissionScope;
  readonly reason: string;
  readonly startsAt?: string;
  readonly expiresAt?: string;
  readonly revokedAt?: string;
};

export type PermissionGrantSource =
  | {
      readonly type: "fixed_role";
      readonly role: EmployeeRole;
    }
  | {
      readonly type: "role_binding";
      readonly roleId: string;
      readonly bindingId?: string;
    }
  | {
      readonly type: "direct_grant";
      readonly grantId?: string;
      readonly reason: string;
    };

export type EffectivePermissionGrant = {
  readonly tenantId: TenantId;
  readonly employeeId: EmployeeId;
  readonly permission: Permission;
  readonly scope: PermissionScope;
  readonly sources: readonly PermissionGrantSource[];
};

export type PermissionResolverMode = "scoped" | "dual" | "legacy";

export type ResolveEffectivePermissionGrantsInput = {
  readonly actor: PermissionActor;
  readonly roles?: readonly PermissionRoleDefinition[];
  readonly roleBindings?: readonly PermissionRoleBinding[];
  readonly directGrants?: readonly DirectPermissionGrant[];
  readonly at?: Date | string;
  readonly mode?: PermissionResolverMode;
};

export type PermissionResourceContext = {
  readonly tenantId: TenantId;
  readonly orgUnitId?: string;
  readonly orgUnitIds?: readonly string[];
  readonly teamId?: string;
  readonly teamIds?: readonly string[];
  readonly queueId?: string;
  readonly assignedEmployeeId?: EmployeeId;
  readonly assignedEmployeeIds?: readonly EmployeeId[];
  readonly assignedTeamIds?: readonly string[];
  readonly ownerEmployeeId?: EmployeeId;
  readonly clientId?: ClientId;
  readonly conversationId?: ConversationId;
};

export type PermissionDecisionReason =
  | "allowed"
  | "missing_permission"
  | "scope_mismatch";

export type PermissionDecision = {
  readonly allowed: boolean;
  readonly reason: PermissionDecisionReason;
  readonly matchedGrant?: EffectivePermissionGrant;
};

export type CanAccessInput = ResolveEffectivePermissionGrantsInput & {
  readonly permission: Permission;
  readonly resource: PermissionResourceContext;
  readonly effectiveGrants?: readonly EffectivePermissionGrant[];
};

type MutableEffectivePermissionGrant = Omit<
  EffectivePermissionGrant,
  "sources"
> & {
  readonly sources: PermissionGrantSource[];
};

export function resolveEffectivePermissionGrants(
  input: ResolveEffectivePermissionGrantsInput
): readonly EffectivePermissionGrant[] {
  const at = timestamp(input.at ?? new Date());
  const mode = input.mode ?? "dual";
  const grants = new Map<string, MutableEffectivePermissionGrant>();
  const roleById = new Map<string, PermissionRoleDefinition>();

  if (mode === "scoped" || mode === "dual") {
    for (const role of input.roles ?? []) {
      assertSameTenant(input.actor.tenantId, role.tenantId);
      roleById.set(role.id, role);
    }
  }

  if (mode === "legacy" || mode === "dual") {
    for (const role of input.actor.roles ?? []) {
      for (const permission of permissionsForRoles([role])) {
        addEffectiveGrant(grants, {
          actor: input.actor,
          permission,
          scope: { type: "tenant" },
          source: { type: "fixed_role", role }
        });
      }
    }
  }

  if (mode === "legacy") {
    return [...grants.values()].map((grant) => ({
      ...grant,
      sources: [...grant.sources]
    }));
  }

  for (const binding of input.roleBindings ?? []) {
    assertSameTenant(input.actor.tenantId, binding.tenantId);

    if (
      !isTemporalAccessActive(binding, at) ||
      !isRoleBindingForActor(binding, input.actor)
    ) {
      continue;
    }

    const role = roleById.get(binding.roleId);
    if (!role) {
      throw new CoreError("validation.failed");
    }

    assertSameTenant(input.actor.tenantId, role.tenantId);
    if (!isRoleActive(role)) {
      continue;
    }

    for (const permission of role.permissions) {
      addEffectiveGrant(grants, {
        actor: input.actor,
        permission,
        scope: binding.scope,
        source: {
          type: "role_binding",
          roleId: role.id,
          bindingId: binding.id
        }
      });
    }
  }

  for (const grant of input.directGrants ?? []) {
    assertSameTenant(input.actor.tenantId, grant.tenantId);

    if (
      !isTemporalAccessActive(grant, at) ||
      !sameId(input.actor.employeeId, grant.employeeId)
    ) {
      continue;
    }

    addEffectiveGrant(grants, {
      actor: input.actor,
      permission: grant.permission,
      scope: grant.scope,
      source: {
        type: "direct_grant",
        grantId: grant.id,
        reason: grant.reason
      }
    });
  }

  return [...grants.values()].map((grant) => ({
    ...grant,
    sources: [...grant.sources]
  }));
}

export function can(input: CanAccessInput): PermissionDecision {
  return canAccess(input);
}

export function canAccess(input: CanAccessInput): PermissionDecision {
  assertTenantContext(input.actor.tenantId);
  assertTenantContext(input.resource.tenantId);
  assertSameTenant(input.actor.tenantId, input.resource.tenantId);

  const effectiveGrants =
    input.effectiveGrants ?? resolveEffectivePermissionGrants(input);
  let hasPermissionGrant = false;

  for (const grant of effectiveGrants) {
    assertSameTenant(input.actor.tenantId, grant.tenantId);
    if (!sameId(input.actor.employeeId, grant.employeeId)) {
      continue;
    }

    validateGrantScope(grant.permission, grant.scope);
    if (grant.permission !== input.permission) {
      continue;
    }

    hasPermissionGrant = true;
    if (isScopeCoveredByResource(grant.scope, input.actor, input.resource)) {
      return {
        allowed: true,
        reason: "allowed",
        matchedGrant: grant
      };
    }
  }

  return {
    allowed: false,
    reason: hasPermissionGrant ? "scope_mismatch" : "missing_permission"
  };
}

export function assertCanAccess(input: CanAccessInput): void {
  if (!canAccess(input).allowed) {
    throw new CoreError("permission.denied");
  }
}

function addEffectiveGrant(
  grants: Map<string, MutableEffectivePermissionGrant>,
  input: {
    readonly actor: PermissionActor;
    readonly permission: Permission;
    readonly scope: PermissionScope;
    readonly source: PermissionGrantSource;
  }
): void {
  validateGrantScope(input.permission, input.scope);

  const key = [
    input.actor.tenantId,
    input.actor.employeeId,
    input.permission,
    scopeKey(input.scope)
  ].join(":");
  const existingGrant = grants.get(key);

  if (existingGrant) {
    existingGrant.sources.push(input.source);
    return;
  }

  grants.set(key, {
    tenantId: input.actor.tenantId,
    employeeId: input.actor.employeeId,
    permission: input.permission,
    scope: input.scope,
    sources: [input.source]
  });
}

function validateGrantScope(
  permission: Permission,
  scope: PermissionScope
): void {
  if (!isPermissionScope(scope)) {
    throw new CoreError("validation.failed");
  }

  assertPermissionScopeAllowed(permission, scope.type);
}

function isRoleBindingForActor(
  binding: PermissionRoleBinding,
  actor: PermissionActor
): boolean {
  switch (binding.subject.type) {
    case "employee":
      return sameId(binding.subject.id, actor.employeeId);
    case "team":
      return includesId(actor.teamIds, binding.subject.id);
    case "org_unit":
      return includesId(actor.orgUnitIds, binding.subject.id);
    case "queue":
      return includesId(actor.queueIds, binding.subject.id);
  }
}

function isScopeCoveredByResource(
  scope: PermissionScope,
  actor: PermissionActor,
  resource: PermissionResourceContext
): boolean {
  switch (scope.type) {
    case "tenant":
      return true;
    case "org_unit":
      return matchesResourceId(
        scope.id,
        resource.orgUnitId,
        resource.orgUnitIds
      );
    case "team":
      return matchesResourceId(scope.id, resource.teamId, resource.teamIds);
    case "queue":
      return sameOptionalId(scope.id, resource.queueId);
    case "assigned":
      return (
        matchesResourceId(
          actor.employeeId,
          resource.assignedEmployeeId,
          resource.assignedEmployeeIds
        ) || intersectsIds(actor.teamIds, resource.assignedTeamIds)
      );
    case "own":
      return sameOptionalId(actor.employeeId, resource.ownerEmployeeId);
    case "client":
      return sameOptionalId(scope.id, resource.clientId);
    case "conversation":
      return sameOptionalId(scope.id, resource.conversationId);
  }
}

function isTemporalAccessActive(
  input: {
    readonly startsAt?: string;
    readonly expiresAt?: string;
    readonly revokedAt?: string;
  },
  at: number
): boolean {
  if (input.revokedAt) {
    timestamp(input.revokedAt);
    return false;
  }

  if (input.startsAt && timestamp(input.startsAt) > at) {
    return false;
  }

  return !(input.expiresAt && timestamp(input.expiresAt) <= at);
}

function isRoleActive(role: PermissionRoleDefinition): boolean {
  return role.status !== "archived" && !role.archivedAt;
}

function assertSameTenant(left: TenantId, right: TenantId): void {
  assertTenantContext(left);
  assertTenantContext(right);

  if (!sameId(left, right)) {
    throw new CoreError("tenant.boundary_violation");
  }
}

function assertTenantContext(value: TenantId | undefined): void {
  if (!value) {
    throw new CoreError("validation.failed");
  }
}

function timestamp(value: Date | string): number {
  const result = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(result)) {
    throw new CoreError("validation.failed");
  }

  return result;
}

function scopeKey(scope: PermissionScope): string {
  return "id" in scope ? `${scope.type}:${scope.id}` : scope.type;
}

function matchesResourceId(
  expected: string,
  id?: string,
  ids?: readonly string[]
): boolean {
  return sameOptionalId(expected, id) || includesId(ids, expected);
}

function sameOptionalId(left: string, right?: string): boolean {
  return typeof right === "string" && sameId(left, right);
}

function sameId(left: string, right: string): boolean {
  return String(left) === String(right);
}

function includesId(values: readonly string[] | undefined, expected: string) {
  return Boolean(values?.some((value) => sameId(value, expected)));
}

function intersectsIds(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined
): boolean {
  if (!left?.length || !right?.length) {
    return false;
  }

  return left.some((value) => includesId(right, value));
}
