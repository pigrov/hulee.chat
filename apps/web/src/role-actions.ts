"use server";

import type { EmployeeId, TenantId } from "@hulee/contracts";
import {
  assertPermissionScopeAllowed,
  assertPermissionsAllowedForScope,
  isPermission,
  normalizePermissionScope,
  prepareCustomTenantRole,
  type Permission,
  type PermissionScope,
  type PermissionRoleBinding,
  type PreparedCustomTenantRole
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlSecurityAuditRepository,
  createSqlTenantRbacRepository,
  type AccessAuditAction,
  type SecurityAuditEntityType,
  type TenantRoleRecord
} from "@hulee/db";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import { assertWebActionRequest } from "./action-security";
import {
  assertCurrentWebTenantPermission,
  getWebDatabase,
  isEmailNotVerifiedError
} from "./session";

export async function createCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = `role:${session.tenantId}:custom:${randomUUID()}`;
    const role = prepareCustomTenantRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });

    await repository.createRoleWithPermissions({
      id: roleId,
      tenantId: session.tenantId,
      name: role.name,
      description: role.description,
      isSystem: false,
      createdByEmployeeId: session.employeeId,
      createdAt: now,
      permissions: role.permissions
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.created",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        permissions: role.permissions,
        permissionCount: role.permissions.length
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "created");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function updateCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const role = prepareCustomTenantRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });
    const [roles, bindings] = await Promise.all([
      repository.listRoleDefinitions({ tenantId: session.tenantId }),
      repository.listRoleBindings({ tenantId: session.tenantId, at: now })
    ]);
    const existingRole = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(existingRole);
    assertRoleUpdateDoesNotRemoveOwnRoleManagement({
      bindings,
      currentEmployeeId: session.employeeId,
      existingRole,
      nextRole: role
    });

    await repository.updateCustomRoleWithPermissions({
      tenantId: session.tenantId,
      roleId,
      name: role.name,
      description: role.description,
      updatedAt: now,
      permissions: role.permissions
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.updated",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        previousName: existingRole.name,
        nextName: role.name,
        previousDescription: existingRole.description,
        nextDescription: role.description,
        previousPermissions: existingRole.permissions,
        nextPermissions: role.permissions,
        ...permissionDiff(existingRole.permissions, role.permissions)
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "updated");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function archiveCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const [roles, bindings] = await Promise.all([
      repository.listRoleDefinitions({ tenantId: session.tenantId }),
      repository.listRoleBindings({ tenantId: session.tenantId, at: now })
    ]);
    const role = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(role);

    if (
      isRoleAssignedToEmployee(bindings, roleId, session.employeeId) &&
      role.status === "active"
    ) {
      throw new Error("Current employee custom role cannot be archived.");
    }

    await repository.setCustomRoleStatus({
      tenantId: session.tenantId,
      roleId,
      status: "archived",
      updatedAt: now
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.archived",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        status: "archived"
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "archived");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function restoreCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const roleId = readRequiredFormString(formData, "roleId");
    const roles = await repository.listRoleDefinitions({
      tenantId: session.tenantId
    });
    const role = roles.find((candidate) => candidate.id === roleId);

    assertCustomRole(role);

    await repository.setCustomRoleStatus({
      tenantId: session.tenantId,
      roleId,
      status: "active",
      updatedAt: now
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role.restored",
      entityType: "role",
      entityId: roleId,
      metadata: {
        roleId,
        name: role.name,
        status: "active"
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "restored");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function assignTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const roleId = readRequiredFormString(formData, "roleId");
  const scope = normalizePermissionScope({
    type: readRequiredFormString(formData, "scopeType"),
    id: readOptionalFormString(formData, "scopeId")
  });
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const [roles, target, bindings] = await Promise.all([
      rbacRepository.listRoleDefinitions({ tenantId: session.tenantId }),
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      rbacRepository.listRoleBindings({
        tenantId: session.tenantId,
        at: now
      })
    ]);
    const role = roles.find((candidate) => candidate.id === roleId);
    const existingBinding = bindings.find((binding) => {
      return (
        binding.roleId === roleId &&
        binding.subject.type === "employee" &&
        binding.subject.id === employeeId &&
        areScopesEqual(binding.scope, scope)
      );
    });

    if (role === undefined || role.status !== "active") {
      throw new Error("Role is not assignable.");
    }

    if (target === null || target.deactivatedAt !== null) {
      throw new Error("Employee is not assignable.");
    }

    assertPermissionsAllowedForScope(role.permissions, scope.type);

    if (existingBinding === undefined) {
      const bindingId = `role_binding:${session.tenantId}:${employeeId}:${randomUUID()}`;

      await rbacRepository.createRoleBinding({
        id: bindingId,
        tenantId: session.tenantId,
        roleId,
        subject: {
          type: "employee",
          id: employeeId
        },
        scope,
        createdByEmployeeId: session.employeeId,
        createdAt: now
      });

      await recordAccessAudit({
        tenantId: session.tenantId,
        actorEmployeeId: session.employeeId,
        action: "role_binding.created",
        entityType: "role_binding",
        entityId: bindingId,
        metadata: {
          roleId,
          targetEmployeeId: employeeId,
          subjectType: "employee",
          subjectId: employeeId,
          ...scopeMetadata(scope)
        },
        occurredAt: now
      });
    }

    destination = roleActionDestination(formData, "assigned");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeTenantRoleBindingAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const bindingId = readRequiredFormString(formData, "bindingId");
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const bindings = await repository.listRoleBindings({
      tenantId: session.tenantId,
      at: now
    });
    const binding = bindings.find((candidate) => candidate.id === bindingId);

    if (binding === undefined) {
      throw new Error("Role binding not found.");
    }

    if (
      binding.subject.type === "employee" &&
      binding.subject.id === session.employeeId
    ) {
      throw new Error("Self role revocation is not allowed.");
    }

    await repository.revokeRoleBinding({
      tenantId: session.tenantId,
      bindingId,
      revokedAt: now
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "role_binding.revoked",
      entityType: "role_binding",
      entityId: bindingId,
      metadata: {
        roleId: binding.roleId,
        subjectType: binding.subject.type,
        subjectId: binding.subject.id,
        ...(binding.subject.type === "employee"
          ? { targetEmployeeId: binding.subject.id }
          : {}),
        ...scopeMetadata(binding.scope)
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "revoked");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function createDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const now = new Date();
  const rbacRepository = createSqlTenantRbacRepository(getWebDatabase());
  const employeeRepository =
    createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const permission = readPermissionFormValue(formData, "permission");
    const scope = normalizePermissionScope({
      type: readRequiredFormString(formData, "scopeType"),
      id: readOptionalFormString(formData, "scopeId")
    });
    const reason = readRequiredLimitedFormString(formData, "reason", 500);
    const expiresAt = readOptionalFormDate(formData, "expiresAt");

    assertPermissionScopeAllowed(permission, scope.type);

    if (expiresAt !== undefined && expiresAt.getTime() <= now.getTime()) {
      throw new Error("Direct grant expiry must be in the future.");
    }

    const [target, grants] = await Promise.all([
      employeeRepository.findEmployee({
        tenantId: session.tenantId,
        employeeId
      }),
      rbacRepository.listDirectGrantsForEmployee({
        tenantId: session.tenantId,
        employeeId,
        at: now
      })
    ]);

    if (target === null || target.deactivatedAt !== null) {
      throw new Error("Employee is not assignable.");
    }

    const existingGrant = grants.find((grant) => {
      return (
        grant.permission === permission && areScopesEqual(grant.scope, scope)
      );
    });

    if (existingGrant === undefined) {
      const grantId = `direct_grant:${session.tenantId}:${employeeId}:${randomUUID()}`;

      await rbacRepository.createDirectGrant({
        id: grantId,
        tenantId: session.tenantId,
        employeeId,
        permission,
        scope,
        reason,
        expiresAt: expiresAt?.toISOString(),
        createdByEmployeeId: session.employeeId,
        createdAt: now
      });

      await recordAccessAudit({
        tenantId: session.tenantId,
        actorEmployeeId: session.employeeId,
        action: "direct_grant.created",
        entityType: "direct_grant",
        entityId: grantId,
        metadata: {
          targetEmployeeId: employeeId,
          permission,
          reason,
          expiresAt: expiresAt?.toISOString(),
          ...scopeMetadata(scope)
        },
        occurredAt: now
      });
    }

    destination = roleActionDestination(formData, "direct_grant_created");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedRolesPermission();
  const grantId = readRequiredFormString(formData, "grantId");
  const now = new Date();
  const repository = createSqlTenantRbacRepository(getWebDatabase());
  let destination = roleActionDestination(formData, "invalid");

  try {
    const grants = await repository.listDirectGrants({
      tenantId: session.tenantId,
      at: now
    });
    const grant = grants.find((candidate) => candidate.id === grantId);

    if (grant === undefined || grant.id === undefined) {
      throw new Error("Direct grant not found.");
    }

    if (grant.employeeId === session.employeeId) {
      throw new Error("Self direct grant revocation is not allowed.");
    }

    await repository.revokeDirectGrant({
      tenantId: session.tenantId,
      grantId,
      revokedAt: now
    });

    await recordAccessAudit({
      tenantId: session.tenantId,
      actorEmployeeId: session.employeeId,
      action: "direct_grant.revoked",
      entityType: "direct_grant",
      entityId: grantId,
      metadata: {
        targetEmployeeId: grant.employeeId,
        permission: grant.permission,
        reason: grant.reason,
        ...scopeMetadata(grant.scope)
      },
      occurredAt: now
    });

    destination = roleActionDestination(formData, "direct_grant_revoked");
  } catch {
    destination = roleActionDestination(formData, "invalid");
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

async function recordAccessAudit(input: {
  readonly tenantId: TenantId;
  readonly actorEmployeeId: EmployeeId;
  readonly action: AccessAuditAction;
  readonly entityType: Exclude<SecurityAuditEntityType, "session">;
  readonly entityId: string;
  readonly metadata: Record<string, unknown>;
  readonly occurredAt: Date;
}): Promise<void> {
  await createSqlSecurityAuditRepository(getWebDatabase()).record({
    id: `audit:${input.tenantId}:${input.action}:${randomUUID()}`,
    tenantId: input.tenantId,
    actorEmployeeId: input.actorEmployeeId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    metadata: input.metadata,
    occurredAt: input.occurredAt
  });
}

async function assertVerifiedRolesPermission(): ReturnType<
  typeof assertCurrentWebTenantPermission
> {
  try {
    return await assertCurrentWebTenantPermission("roles.manage", {
      requireVerifiedEmail: true
    });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect("/admin/roles?roleActionStatus=email_verification_required");
    }

    throw error;
  }
}

function revalidateRoleAdminPaths(): void {
  revalidatePath("/admin/roles");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
}

function roleActionDestination(formData: FormData, status: string): string {
  const returnTo = readOptionalFormString(formData, "returnTo");
  const path = isSafeRoleActionReturnTo(returnTo) ? returnTo : "/admin/roles";

  return `${path}?roleActionStatus=${encodeURIComponent(status)}`;
}

function isSafeRoleActionReturnTo(path: string | undefined): path is string {
  if (path === "/admin/roles") {
    return true;
  }

  return (
    path !== undefined && /^\/admin\/employees\/[^/?#]+\/access$/.test(path)
  );
}

function assertCustomRole(
  role: TenantRoleRecord | undefined
): asserts role is TenantRoleRecord {
  if (role === undefined || role.isSystem) {
    throw new Error("Custom tenant role was not found.");
  }
}

function assertRoleUpdateDoesNotRemoveOwnRoleManagement(input: {
  readonly bindings: readonly PermissionRoleBinding[];
  readonly currentEmployeeId: EmployeeId;
  readonly existingRole: TenantRoleRecord;
  readonly nextRole: PreparedCustomTenantRole;
}): void {
  if (
    !isRoleAssignedToEmployee(
      input.bindings,
      input.existingRole.id,
      input.currentEmployeeId
    )
  ) {
    return;
  }

  if (
    input.existingRole.permissions.includes("roles.manage") &&
    !input.nextRole.permissions.includes("roles.manage")
  ) {
    throw new Error("Current employee role management permission is required.");
  }
}

function permissionDiff(
  previousPermissions: readonly Permission[],
  nextPermissions: readonly Permission[]
): {
  readonly addedPermissions: readonly Permission[];
  readonly removedPermissions: readonly Permission[];
} {
  return {
    addedPermissions: nextPermissions.filter(
      (permission) => !previousPermissions.includes(permission)
    ),
    removedPermissions: previousPermissions.filter(
      (permission) => !nextPermissions.includes(permission)
    )
  };
}

function isRoleAssignedToEmployee(
  bindings: readonly PermissionRoleBinding[],
  roleId: string,
  employeeId: EmployeeId
): boolean {
  return bindings.some((binding) => {
    return (
      binding.roleId === roleId &&
      binding.subject.type === "employee" &&
      binding.subject.id === employeeId
    );
  });
}

function areScopesEqual(
  left: PermissionScope,
  right: PermissionScope
): boolean {
  if (left.type !== right.type) {
    return false;
  }

  return scopeId(left) === scopeId(right);
}

function scopeId(scope: PermissionScope): string | undefined {
  return "id" in scope ? scope.id : undefined;
}

function scopeMetadata(scope: PermissionScope): Record<string, string> {
  const id = scopeId(scope);

  return id === undefined
    ? { scopeType: scope.type }
    : { scopeType: scope.type, scopeId: id };
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

function readRequiredLimitedFormString(
  formData: FormData,
  name: string,
  maxLength: number
): string {
  const value = readRequiredFormString(formData, name);

  if (value.length > maxLength) {
    throw new Error(`Form field ${name} is too long.`);
  }

  return value;
}

function readOptionalFormString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value.trim();
}

function readPermissionFormValue(formData: FormData, name: string): Permission {
  const value = readRequiredFormString(formData, name);

  if (!isPermission(value)) {
    throw new Error(`Form field ${name} must be a known permission.`);
  }

  return value;
}

function readOptionalFormDate(
  formData: FormData,
  name: string
): Date | undefined {
  const value = readOptionalFormString(formData, name);

  if (value === undefined) {
    return undefined;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error(`Form field ${name} must be a date.`);
  }

  return date;
}

function readFormStringList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
