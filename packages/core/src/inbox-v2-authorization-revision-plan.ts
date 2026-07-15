import type {
  InboxV2EmployeeReference,
  InboxV2TenantId
} from "@hulee/contracts";
import { inboxV2TimestampSchema } from "@hulee/contracts";

import {
  evaluateInboxV2PermissionScopePairLegality,
  getInboxV2PermissionDefinition,
  parseInboxV2PermissionScope,
  type InboxV2PermissionId,
  type InboxV2PermissionScope
} from "./inbox-v2-permission-catalog";

const POSTGRES_BIGINT_MAX = 9_223_372_036_854_775_807n;

export type InboxV2RoleBindingLegalityFact = Readonly<{
  tenantId: InboxV2TenantId;
  bindingId: string;
  roleId: string;
  scope: unknown;
  validFrom: string;
  validUntil: string | null;
  revokedAt: string | null;
}>;

export type InboxV2RoleLegalityConflict = Readonly<{
  bindingId: string;
  permissionId: string;
  scopeType: string;
  reason:
    | "unknown_permission"
    | "invalid_scope"
    | "illegal_scope"
    | "illegal_principal";
}>;

export type InboxV2AuthorizationRevisionPlan = Readonly<{
  tenantId: InboxV2TenantId;
  kind:
    | "role_definition_or_binding"
    | "employee_access"
    | "direct_inbox_relation"
    | "structural_resource_access";
  tenantRbacRevision: InboxV2ClockAdvance | null;
  sharedAccessRevision: InboxV2ClockAdvance | null;
  employeeAccessRevisions: readonly InboxV2EmployeeClockAdvance[];
  employeeInboxRelationRevisions: readonly InboxV2EmployeeClockAdvance[];
  resourceAccessRevisions: readonly InboxV2ResourceClockAdvance[];
}>;

type InboxV2ClockAdvance = Readonly<{
  previous: string;
  resulting: string;
}>;

type InboxV2EmployeeClockAdvance = Readonly<{
  employee: InboxV2EmployeeReference;
  advance: InboxV2ClockAdvance;
}>;

type InboxV2ResourceClockAdvance = Readonly<{
  resource: Readonly<{
    tenantId: InboxV2TenantId;
    kind: "source_account" | "conversation" | "client" | "work_item";
    id: string;
  }>;
  advance: InboxV2ClockAdvance;
}>;

export type InboxV2RoleRevisionPlanDecision =
  | Readonly<{
      kind: "accepted";
      roleId: string;
      canonicalPermissionIds: readonly InboxV2PermissionId[];
      checkedBindingIds: readonly string[];
      revisionPlan: InboxV2AuthorizationRevisionPlan;
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "invalid_revision"
        | "invalid_permission_set"
        | "invalid_binding_set"
        | "incompatible_binding_scope";
      conflicts: readonly InboxV2RoleLegalityConflict[];
    }>;

export type InboxV2GrantRevisionPlanDecision =
  | Readonly<{
      kind: "accepted";
      permissionId: InboxV2PermissionId;
      scope: InboxV2PermissionScope;
      revisionPlan: InboxV2AuthorizationRevisionPlan;
    }>
  | Readonly<{
      kind: "rejected";
      reason:
        | "invalid_revision"
        | "cross_tenant"
        | "unknown_permission"
        | "invalid_scope"
        | "illegal_scope"
        | "illegal_principal";
    }>;

/**
 * Plans a role-head CAS. Current and future scheduled bindings are checked
 * before the head can move; historical expired/revoked bindings are ignored.
 */
export function planInboxV2RoleDefinitionRevision(input: {
  tenantId: InboxV2TenantId;
  roleId: string;
  permissionIds: readonly string[];
  currentAndHistoricalBindings: readonly InboxV2RoleBindingLegalityFact[];
  evaluatedAt: string;
  previousTenantRbacRevision: string;
}): InboxV2RoleRevisionPlanDecision {
  const revision = advanceCounter(input.previousTenantRbacRevision);
  if (revision === null) {
    return rejectedRolePlan("invalid_revision");
  }
  const permissions = canonicalPermissions(input.permissionIds);
  if (permissions === null) {
    return rejectedRolePlan("invalid_permission_set");
  }
  const bindingFacts = relevantRoleBindings(input);
  if (bindingFacts === null) {
    return rejectedRolePlan("invalid_binding_set");
  }

  const conflicts = bindingFacts.flatMap((binding) =>
    roleScopeConflicts(permissions, binding)
  );
  if (conflicts.length > 0) {
    return Object.freeze({
      kind: "rejected" as const,
      reason: "incompatible_binding_scope" as const,
      conflicts: Object.freeze(conflicts)
    });
  }

  return Object.freeze({
    kind: "accepted" as const,
    roleId: input.roleId,
    canonicalPermissionIds: Object.freeze(permissions),
    checkedBindingIds: Object.freeze(
      bindingFacts.map((binding) => binding.bindingId)
    ),
    revisionPlan: roleRevisionPlan(input.tenantId, revision)
  });
}

/** Checks a proposed stable-role binding against the current role head. */
export function planInboxV2RoleBindingRevision(input: {
  tenantId: InboxV2TenantId;
  roleId: string;
  subjectTenantId: InboxV2TenantId;
  scope: unknown;
  currentRolePermissionIds: readonly string[];
  previousTenantRbacRevision: string;
}): InboxV2RoleRevisionPlanDecision {
  const revision = advanceCounter(input.previousTenantRbacRevision);
  if (revision === null) {
    return rejectedRolePlan("invalid_revision");
  }
  const permissions = canonicalPermissions(input.currentRolePermissionIds);
  if (permissions === null) {
    return rejectedRolePlan("invalid_permission_set");
  }
  const scope = parseInboxV2PermissionScope(input.scope);
  if (
    input.subjectTenantId !== input.tenantId ||
    scope === undefined ||
    scope.tenantId !== input.tenantId
  ) {
    return rejectedRolePlan("invalid_binding_set");
  }
  const conflicts = roleScopeConflicts(permissions, {
    tenantId: input.tenantId,
    bindingId: "proposed-binding",
    roleId: input.roleId,
    scope,
    validFrom: "1970-01-01T00:00:00.000Z",
    validUntil: null,
    revokedAt: null
  });
  if (conflicts.length > 0) {
    return Object.freeze({
      kind: "rejected" as const,
      reason: "incompatible_binding_scope" as const,
      conflicts: Object.freeze(conflicts)
    });
  }

  return Object.freeze({
    kind: "accepted" as const,
    roleId: input.roleId,
    canonicalPermissionIds: Object.freeze(permissions),
    checkedBindingIds: Object.freeze([]),
    revisionPlan: roleRevisionPlan(input.tenantId, revision)
  });
}

/** Plans one direct Employee grant/revoke after catalog legality validation. */
export function planInboxV2DirectGrantRevision(input: {
  tenantId: InboxV2TenantId;
  employee: InboxV2EmployeeReference;
  permissionId: string;
  scope: unknown;
  previousEmployeeAccessRevision: string;
}): InboxV2GrantRevisionPlanDecision {
  const revision = advanceCounter(input.previousEmployeeAccessRevision);
  if (revision === null) {
    return Object.freeze({
      kind: "rejected" as const,
      reason: "invalid_revision"
    });
  }
  if (input.employee.tenantId !== input.tenantId) {
    return Object.freeze({ kind: "rejected" as const, reason: "cross_tenant" });
  }
  const legality = evaluateInboxV2PermissionScopePairLegality({
    permissionId: input.permissionId,
    scope: input.scope,
    principalKind: "employee"
  });
  if (legality.kind === "rejected") {
    return Object.freeze({
      kind: "rejected" as const,
      reason: legality.reason
    });
  }
  if (legality.scope.tenantId !== input.tenantId) {
    return Object.freeze({ kind: "rejected" as const, reason: "cross_tenant" });
  }

  return Object.freeze({
    kind: "accepted" as const,
    permissionId: legality.permission.id,
    scope: legality.scope,
    revisionPlan: Object.freeze({
      tenantId: input.tenantId,
      kind: "employee_access" as const,
      tenantRbacRevision: null,
      sharedAccessRevision: null,
      employeeAccessRevisions: Object.freeze([
        Object.freeze({ employee: input.employee, advance: revision })
      ]),
      employeeInboxRelationRevisions: Object.freeze([]),
      resourceAccessRevisions: Object.freeze([])
    })
  });
}

function relevantRoleBindings(input: {
  tenantId: InboxV2TenantId;
  roleId: string;
  currentAndHistoricalBindings: readonly InboxV2RoleBindingLegalityFact[];
  evaluatedAt: string;
}): InboxV2RoleBindingLegalityFact[] | null {
  if (!isTimestamp(input.evaluatedAt)) {
    return null;
  }
  const seen = new Set<string>();
  const relevant: InboxV2RoleBindingLegalityFact[] = [];
  for (const binding of input.currentAndHistoricalBindings) {
    if (
      binding.tenantId !== input.tenantId ||
      binding.roleId !== input.roleId ||
      seen.has(binding.bindingId) ||
      !isTimestamp(binding.validFrom) ||
      (binding.validUntil !== null &&
        (!isTimestamp(binding.validUntil) ||
          Date.parse(binding.validUntil) <= Date.parse(binding.validFrom))) ||
      (binding.revokedAt !== null &&
        (!isTimestamp(binding.revokedAt) ||
          Date.parse(binding.revokedAt) <= Date.parse(binding.validFrom) ||
          (binding.validUntil !== null &&
            Date.parse(binding.revokedAt) > Date.parse(binding.validUntil))))
    ) {
      return null;
    }
    seen.add(binding.bindingId);
    const expired =
      binding.validUntil !== null &&
      Date.parse(binding.validUntil) <= Date.parse(input.evaluatedAt);
    const revoked =
      binding.revokedAt !== null &&
      Date.parse(binding.revokedAt) <= Date.parse(input.evaluatedAt);
    if (!revoked && !expired) {
      relevant.push(binding);
    }
  }
  return relevant.sort((left, right) =>
    compareCanonicalStrings(left.bindingId, right.bindingId)
  );
}

function roleScopeConflicts(
  permissionIds: readonly InboxV2PermissionId[],
  binding: InboxV2RoleBindingLegalityFact
): InboxV2RoleLegalityConflict[] {
  const scope = parseInboxV2PermissionScope(binding.scope);
  if (scope === undefined || scope.tenantId !== binding.tenantId) {
    return [
      Object.freeze({
        bindingId: binding.bindingId,
        permissionId: permissionIds[0] ?? "core:unknown",
        scopeType: "invalid",
        reason: "invalid_scope" as const
      })
    ];
  }
  return permissionIds.flatMap((permissionId) => {
    const legality = evaluateInboxV2PermissionScopePairLegality({
      permissionId,
      scope,
      principalKind: "employee"
    });
    return legality.kind === "legal"
      ? []
      : [
          Object.freeze({
            bindingId: binding.bindingId,
            permissionId,
            scopeType: scope.type,
            reason: legality.reason
          })
        ];
  });
}

function canonicalPermissions(
  values: readonly string[]
): InboxV2PermissionId[] | null {
  if (values.length === 0 || values.length > 256) {
    return null;
  }
  const result: InboxV2PermissionId[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const definition = getInboxV2PermissionDefinition(value);
    if (definition === undefined || seen.has(value)) {
      return null;
    }
    seen.add(value);
    result.push(definition.id);
  }
  return result.sort(compareCanonicalStrings);
}

function roleRevisionPlan(
  tenantId: InboxV2TenantId,
  revision: InboxV2ClockAdvance
): InboxV2AuthorizationRevisionPlan {
  return Object.freeze({
    tenantId,
    kind: "role_definition_or_binding" as const,
    tenantRbacRevision: revision,
    sharedAccessRevision: null,
    employeeAccessRevisions: Object.freeze([]),
    employeeInboxRelationRevisions: Object.freeze([]),
    resourceAccessRevisions: Object.freeze([])
  });
}

function advanceCounter(value: string): InboxV2ClockAdvance | null {
  if (!/^[1-9][0-9]*$/u.test(value)) {
    return null;
  }
  try {
    const previous = BigInt(value);
    if (previous < 0n || previous >= POSTGRES_BIGINT_MAX) {
      return null;
    }
    return Object.freeze({
      previous: value,
      resulting: (previous + 1n).toString()
    });
  } catch {
    return null;
  }
}

function rejectedRolePlan(
  reason: Extract<
    InboxV2RoleRevisionPlanDecision,
    { kind: "rejected" }
  >["reason"]
): InboxV2RoleRevisionPlanDecision {
  return Object.freeze({
    kind: "rejected" as const,
    reason,
    conflicts: Object.freeze([])
  });
}

function isTimestamp(value: string): boolean {
  return inboxV2TimestampSchema.safeParse(value).success;
}

function compareCanonicalStrings(left: string, right: string): -1 | 0 | 1 {
  return left < right ? -1 : left > right ? 1 : 0;
}
