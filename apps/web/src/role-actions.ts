"use server";

import type { EmployeeId } from "@hulee/contracts";
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
  createSqlTenantRbacRepository,
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
  let destination = "/admin/roles?roleActionStatus=invalid";

  try {
    const role = prepareCustomTenantRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });

    await repository.createRoleWithPermissions({
      id: `role:${session.tenantId}:custom:${randomUUID()}`,
      tenantId: session.tenantId,
      name: role.name,
      description: role.description,
      isSystem: false,
      createdByEmployeeId: session.employeeId,
      createdAt: now,
      permissions: role.permissions
    });

    destination = "/admin/roles?roleActionStatus=created";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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

    destination = "/admin/roles?roleActionStatus=updated";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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

    destination = "/admin/roles?roleActionStatus=archived";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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

    destination = "/admin/roles?roleActionStatus=restored";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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
      await rbacRepository.createRoleBinding({
        id: `role_binding:${session.tenantId}:${employeeId}:${randomUUID()}`,
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
    }

    destination = "/admin/roles?roleActionStatus=assigned";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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

    destination = "/admin/roles?roleActionStatus=revoked";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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
      await rbacRepository.createDirectGrant({
        id: `direct_grant:${session.tenantId}:${employeeId}:${randomUUID()}`,
        tenantId: session.tenantId,
        employeeId,
        permission,
        scope,
        reason,
        expiresAt: expiresAt?.toISOString(),
        createdByEmployeeId: session.employeeId,
        createdAt: now
      });
    }

    destination = "/admin/roles?roleActionStatus=direct_grant_created";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
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
  let destination = "/admin/roles?roleActionStatus=invalid";

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

    destination = "/admin/roles?roleActionStatus=direct_grant_revoked";
  } catch {
    destination = "/admin/roles?roleActionStatus=invalid";
  }

  revalidateRoleAdminPaths();
  redirect(destination);
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
