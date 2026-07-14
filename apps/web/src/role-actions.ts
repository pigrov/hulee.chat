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
import { roleActionFailureStatus } from "./role-action-status";
import type { RoleActionCode, RoleActionState } from "./role-action-state";
import { findRoleTemplate, uniqueRoleTemplateName } from "./role-templates";
import { isEmailNotVerifiedError } from "./session";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

export async function createCustomTenantRoleAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await createRbacRole({
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });

    revalidateRoleAdminPaths();

    return roleActionSuccess("created", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function createRoleFromTemplateAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    const templateId = readRequiredFormString(formData, "templateId");
    const template = findRoleTemplate(templateId);

    if (template === undefined) {
      throw new Error("Role template was not found.");
    }

    const { t } = createTranslator(
      resolveLocale(readOptionalFormString(formData, "locale"))
    );
    const { roles } = await loadRbacRoles();
    const name = uniqueRoleTemplateName(
      roles.map((role) => role.name),
      t(template.nameKey)
    );

    await createRbacRole({
      name,
      description: t(template.descriptionKey),
      permissions: [...template.permissions]
    });

    revalidateRoleAdminPaths();

    return roleActionSuccess("template_created", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function updateCustomTenantRoleAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await updateRbacRole(readRequiredFormString(formData, "roleId"), {
      name: readRequiredFormString(formData, "name"),
      description: readOptionalFormString(formData, "description"),
      permissions: readFormStringList(formData, "permissions")
    });

    revalidateRoleAdminPaths();

    return roleActionSuccess("updated", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function archiveCustomTenantRoleAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await archiveRbacRole(readRequiredFormString(formData, "roleId"));

    revalidateRoleAdminPaths();

    return roleActionSuccess("archived", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function restoreCustomTenantRoleAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await restoreRbacRole(readRequiredFormString(formData, "roleId"));

    revalidateRoleAdminPaths();

    return roleActionSuccess("restored", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function assignTenantRoleAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await createRbacRoleBinding({
      roleId: readRequiredFormString(formData, "roleId"),
      subject: readRoleBindingSubject(formData),
      scope: normalizePermissionScope({
        type: readRequiredFormString(formData, "scopeType"),
        id: readOptionalFormString(formData, "scopeId")
      })
    });

    revalidateRoleAdminPaths();

    return roleActionSuccess("assigned", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function revokeTenantRoleBindingAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await revokeRbacRoleBinding(readRequiredFormString(formData, "bindingId"));

    revalidateRoleAdminPaths();

    return roleActionSuccess("revoked", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function createDirectPermissionGrantAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    const expiresAt = readOptionalFormDate(formData, "expiresAt");

    await createRbacDirectGrant({
      employeeId: readRequiredFormString(formData, "employeeId") as EmployeeId,
      permission: readPermissionFormValue(formData, "permission"),
      scope: normalizePermissionScope({
        type: readRequiredFormString(formData, "scopeType"),
        id: readOptionalFormString(formData, "scopeId")
      }),
      reason: readRequiredLimitedFormString(formData, "reason", 500),
      expiresAt: expiresAt?.toISOString()
    });

    revalidateRoleAdminPaths();

    return roleActionSuccess("direct_grant_created", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

export async function revokeDirectPermissionGrantAction(
  _previousState: RoleActionState,
  formData: FormData
): Promise<RoleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    await assertVerifiedRolesPermission();
    await revokeRbacDirectGrant(readRequiredFormString(formData, "grantId"));

    revalidateRoleAdminPaths();

    return roleActionSuccess("direct_grant_revoked", submittedAt);
  } catch (error) {
    return roleActionError(error, submittedAt);
  }
}

async function assertVerifiedRolesPermission(): Promise<void> {
  await assertWebDbBackedAdminCommandBoundary(
    webDbBackedAdminCommandBoundaries.roleAccess
  );
}

function revalidateRoleAdminPaths(): void {
  revalidatePath("/admin/roles");
  revalidatePath("/admin/employees");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
}

function roleActionSuccess(
  code: Exclude<
    RoleActionCode,
    | "email_verification_required"
    | "invalid"
    | "permission_denied"
    | "reauth_required"
  >,
  submittedAt: string
): RoleActionState {
  return {
    code,
    status: "success",
    submittedAt
  };
}

function roleActionError(error: unknown, submittedAt: string): RoleActionState {
  const code = isEmailNotVerifiedError(error)
    ? "email_verification_required"
    : roleActionFailureStatus(error);

  return {
    code,
    status: "error",
    submittedAt
  };
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
