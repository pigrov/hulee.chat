"use server";

import type { EmployeeId } from "@hulee/contracts";
import {
  isPermission,
  normalizePermissionScope,
  type Permission,
  type PermissionRoleBindingSubject
} from "@hulee/core";
import { createTranslator, resolveLocale } from "@hulee/i18n";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { assertWebActionRequest } from "./action-security";
import {
  archiveRbacRole,
  createRbacDirectGrant,
  createRbacRole,
  createRbacRoleBinding,
  loadRbacRoles,
  restoreRbacRole,
  revokeRbacDirectGrant,
  revokeRbacRoleBinding,
  updateRbacRole
} from "./inbox-api-client";
import { isPrivilegedActionReauthRequiredError } from "./privileged-action-policy";
import { roleActionFailureStatus } from "./role-action-status";
import { findRoleTemplate, uniqueRoleTemplateName } from "./role-templates";
import { isEmailNotVerifiedError } from "./session";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

export async function createCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await createRbacRole(
      {
        name: readRequiredFormString(formData, "name"),
        description: readOptionalFormString(formData, "description"),
        permissions: readFormStringList(formData, "permissions")
      },
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function createRoleFromTemplateAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    const templateId = readRequiredFormString(formData, "templateId");
    const template = findRoleTemplate(templateId);

    if (template === undefined) {
      throw new Error("Role template was not found.");
    }

    const { t } = createTranslator(
      resolveLocale(readOptionalFormString(formData, "locale"))
    );
    const { roles } = await loadRbacRoles(rolesManageAccessOptions());
    const name = uniqueRoleTemplateName(
      roles.map((role) => role.name),
      t(template.nameKey)
    );

    await createRbacRole(
      {
        name,
        description: t(template.descriptionKey),
        permissions: [...template.permissions]
      },
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "template_created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function updateCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await updateRbacRole(
      readRequiredFormString(formData, "roleId"),
      {
        name: readRequiredFormString(formData, "name"),
        description: readOptionalFormString(formData, "description"),
        permissions: readFormStringList(formData, "permissions")
      },
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "updated");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function archiveCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await archiveRbacRole(
      readRequiredFormString(formData, "roleId"),
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "archived");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function restoreCustomTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await restoreRbacRole(
      readRequiredFormString(formData, "roleId"),
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "restored");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function assignTenantRoleAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await createRbacRoleBinding(
      {
        roleId: readRequiredFormString(formData, "roleId"),
        subject: readRoleBindingSubject(formData),
        scope: normalizePermissionScope({
          type: readRequiredFormString(formData, "scopeType"),
          id: readOptionalFormString(formData, "scopeId")
        })
      },
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "assigned");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeTenantRoleBindingAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await revokeRbacRoleBinding(
      readRequiredFormString(formData, "bindingId"),
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "revoked");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function createDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    const expiresAt = readOptionalFormDate(formData, "expiresAt");

    await createRbacDirectGrant(
      {
        employeeId: readRequiredFormString(
          formData,
          "employeeId"
        ) as EmployeeId,
        permission: readPermissionFormValue(formData, "permission"),
        scope: normalizePermissionScope({
          type: readRequiredFormString(formData, "scopeType"),
          id: readOptionalFormString(formData, "scopeId")
        }),
        reason: readRequiredLimitedFormString(formData, "reason", 500),
        expiresAt: expiresAt?.toISOString()
      },
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "direct_grant_created");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

export async function revokeDirectPermissionGrantAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedRolesPermission(formData);

  let destination = roleActionDestination(formData, "invalid");

  try {
    await revokeRbacDirectGrant(
      readRequiredFormString(formData, "grantId"),
      rolesManageAccessOptions()
    );

    destination = roleActionDestination(formData, "direct_grant_revoked");
  } catch (error) {
    destination = roleActionDestination(
      formData,
      roleActionFailureStatus(error)
    );
  }

  revalidateRoleAdminPaths();
  redirect(destination);
}

async function assertVerifiedRolesPermission(
  formData: FormData
): Promise<void> {
  try {
    await assertWebDbBackedAdminCommandBoundary(
      webDbBackedAdminCommandBoundaries.roleAccess
    );
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(roleActionDestination(formData, "email_verification_required"));
    }

    if (isPrivilegedActionReauthRequiredError(error)) {
      redirect(roleActionDestination(formData, "reauth_required"));
    }

    throw error;
  }
}

function rolesManageAccessOptions(): {
  readonly effectivePermissionOverride: "roles.manage";
} {
  return {
    effectivePermissionOverride: "roles.manage"
  };
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

function readRoleBindingSubject(
  formData: FormData
): PermissionRoleBindingSubject {
  const subjectType =
    readOptionalFormString(formData, "subjectType") ?? "employee";
  const subjectId =
    readOptionalFormString(formData, "subjectId") ??
    readRequiredFormString(formData, "employeeId");

  switch (subjectType) {
    case "employee":
      return {
        type: "employee",
        id: subjectId as EmployeeId
      };
    case "org_unit":
      return {
        type: "org_unit",
        id: subjectId
      };
    case "team":
      return {
        type: "team",
        id: subjectId
      };
    case "queue":
      return {
        type: "queue",
        id: subjectId
      };
    default:
      throw new Error("Role binding subject type is not supported.");
  }
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
