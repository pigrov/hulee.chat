"use server";

import type { EmployeeId } from "@hulee/contracts";
import {
  prepareCustomTenantRole,
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
        binding.scope.type === "tenant"
      );
    });

    if (role === undefined || role.status !== "active") {
      throw new Error("Role is not assignable.");
    }

    if (target === null || target.deactivatedAt !== null) {
      throw new Error("Employee is not assignable.");
    }

    if (existingBinding === undefined) {
      await rbacRepository.createRoleBinding({
        id: `role_binding:${session.tenantId}:${employeeId}:${randomUUID()}`,
        tenantId: session.tenantId,
        roleId,
        subject: {
          type: "employee",
          id: employeeId
        },
        scope: {
          type: "tenant"
        },
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

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
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

function readFormStringList(formData: FormData, name: string): string[] {
  return formData
    .getAll(name)
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}
