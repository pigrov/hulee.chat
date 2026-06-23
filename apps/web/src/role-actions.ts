"use server";

import type { EmployeeId } from "@hulee/contracts";
import {
  createSqlEmployeeDirectoryRepository,
  createSqlTenantRbacRepository
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

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}
