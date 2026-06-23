"use server";

import type { EmployeeId } from "@hulee/contracts";
import {
  acceptEmployeeInvitation,
  changeEmployeeRole,
  createAccountEmailVerifiedEvent,
  createEmployeeInvitation,
  createSequentialIdFactory,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
  type Employee,
  type Permission
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken,
  type EmployeeInvitationPreview,
  type TenantEmployeeRecord
} from "@hulee/db";
import { hashLocalPassword } from "@hulee/modules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";

import { resolvePublicBaseUrl, sendEmployeeInvitationEmail } from "./email";
import { assertWebAuthRateLimit } from "./auth-rate-limit";
import {
  assertCurrentWebTenantPermission,
  createTenantWebSession,
  getWebDatabase,
  isEmailNotVerifiedError
} from "./session";

const invitationTtlMs = 1000 * 60 * 60 * 24 * 14;

export async function inviteEmployeeAction(formData: FormData): Promise<void> {
  const session = await assertVerifiedTenantPermission("employees.manage");
  const email = readRequiredFormString(formData, "email");
  const displayName = readOptionalFormString(formData, "displayName");
  const role = readRequiredFormString(formData, "role");
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashEmployeeInvitationToken(token);
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/admin/employees?inviteStatus=invalid";

  try {
    const created = createEmployeeInvitation({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      email,
      displayName,
      role,
      tokenHash,
      expiresAt: new Date(now.getTime() + invitationTtlMs).toISOString(),
      idFactory: createSequentialIdFactory(`invite:${randomUUID()}`)
    });

    await repository.createInvitation(created);

    const preview = await repository.findInvitationByTokenHash(tokenHash);
    const inviteUrl = new URL(`/invite/${token}`, resolvePublicBaseUrl()).href;
    const emailResult =
      preview === null
        ? { sent: false, reason: "provider_failed" as const }
        : await sendEmployeeInvitationEmail({
            to: created.invitation.email,
            productName: preview.productName,
            tenantDisplayName: preview.tenantDisplayName,
            inviteUrl
          });
    const status = emailResult.sent ? "sent" : emailResult.reason;

    destination = `/admin/employees?inviteStatus=${status}&inviteToken=${encodeURIComponent(
      token
    )}`;
  } catch {
    destination = "/admin/employees?inviteStatus=invalid";
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function updateEmployeeRoleAction(
  formData: FormData
): Promise<void> {
  const session = await assertVerifiedTenantPermission("employees.manage");
  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const role = readRequiredFormString(formData, "role");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/admin/employees?actionStatus=invalid";

  try {
    const target = await repository.findEmployee({
      tenantId: session.tenantId,
      employeeId
    });

    if (target === null) {
      throw new Error("Employee not found.");
    }

    const now = new Date();
    const changed = changeEmployeeRole({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      employee: employeeFromRecord(target),
      role,
      idFactory: createSequentialIdFactory(`role:${randomUUID()}`)
    });

    await repository.changeEmployeeRole({
      tenantId: session.tenantId,
      employeeId: changed.employee.id,
      role: changed.employee.roles[0] ?? "agent",
      changedAt: now,
      events: changed.events
    });

    destination = "/admin/employees?actionStatus=role_changed";
  } catch {
    destination = "/admin/employees?actionStatus=invalid";
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function deactivateEmployeeAction(
  formData: FormData
): Promise<void> {
  const session = await assertVerifiedTenantPermission("employees.manage");
  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/admin/employees?actionStatus=invalid";

  try {
    const target = await repository.findEmployee({
      tenantId: session.tenantId,
      employeeId
    });

    if (target === null) {
      throw new Error("Employee not found.");
    }

    const now = new Date();
    const deactivated = deactivateEmployee({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      employee: employeeFromRecord(target),
      idFactory: createSequentialIdFactory(`deactivate:${randomUUID()}`)
    });

    await repository.deactivateEmployee({
      tenantId: session.tenantId,
      employeeId: deactivated.employee.id,
      deactivatedAt: now,
      events: deactivated.events
    });

    destination = "/admin/employees?actionStatus=deactivated";
  } catch {
    destination = "/admin/employees?actionStatus=invalid";
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function revokeEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  const session = await assertVerifiedTenantPermission("employees.manage");
  const invitationId = readRequiredFormString(formData, "invitationId");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/admin/employees?actionStatus=invalid";

  try {
    const preview = await repository.findInvitation({
      tenantId: session.tenantId,
      invitationId
    });

    if (preview === null) {
      throw new Error("Invitation not found.");
    }

    const now = new Date();
    const revoked = revokeEmployeeInvitation({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      invitation: preview.invitation,
      idFactory: createSequentialIdFactory(`revoke:${randomUUID()}`)
    });

    await repository.revokeInvitation({
      tenantId: session.tenantId,
      invitationId: revoked.invitation.id,
      revokedAt: now,
      events: revoked.events
    });

    destination = "/admin/employees?actionStatus=invite_revoked";
  } catch {
    destination = "/admin/employees?actionStatus=invalid";
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function resendEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  const session = await assertVerifiedTenantPermission("employees.manage");
  const invitationId = readRequiredFormString(formData, "invitationId");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashEmployeeInvitationToken(token);
  let destination = "/admin/employees?actionStatus=invalid";

  try {
    const preview = await repository.findInvitation({
      tenantId: session.tenantId,
      invitationId
    });

    if (preview === null) {
      throw new Error("Invitation not found.");
    }

    const resent = resendEmployeeInvitation({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      invitation: preview.invitation,
      tokenHash,
      expiresAt: new Date(now.getTime() + invitationTtlMs).toISOString(),
      idFactory: createSequentialIdFactory(`resend:${randomUUID()}`)
    });

    await repository.refreshInvitation({
      invitation: resent.invitation,
      refreshedAt: now,
      events: resent.events
    });

    const emailResult = await sendInvitationEmail(preview, token);
    const status = emailResult.sent ? "sent" : emailResult.reason;

    destination = `/admin/employees?inviteStatus=${status}&inviteToken=${encodeURIComponent(
      token
    )}`;
  } catch {
    destination = "/admin/employees?actionStatus=invalid";
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function acceptEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  const token = readRequiredFormString(formData, "token");
  const displayName = readRequiredFormString(formData, "displayName");
  const password = readRequiredFormString(formData, "password");
  const tokenHash = hashEmployeeInvitationToken(token);
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/invite/invalid";

  try {
    await assertWebAuthRateLimit("accept_employee_invite", token);
    requirePassword(password);

    const preview = await repository.findInvitationByTokenHash(tokenHash);

    if (preview === null) {
      throw new Error("Invitation not found.");
    }

    const now = new Date();
    const accepted = acceptEmployeeInvitation({
      now: now.toISOString(),
      invitation: preview.invitation,
      displayName,
      idFactory: createSequentialIdFactory(`accept:${randomUUID()}`)
    });
    const accountId = `account:${accepted.employee.id}`;
    const events = [
      ...accepted.events,
      createAccountEmailVerifiedEvent({
        now: now.toISOString(),
        tenantId: accepted.employee.tenantId,
        accountId,
        idFactory: createSequentialIdFactory(`accept-email:${randomUUID()}`)
      })
    ];
    const passwordHash = await hashLocalPassword(password);
    const tenantAccount = await repository.acceptInvitation({
      tokenHash,
      accountId,
      passwordHash,
      employee: accepted.employee,
      events,
      acceptedAt: now
    });
    const session = await createTenantWebSession(tenantAccount);

    destination = session.redirectPath;
  } catch {
    destination = `/invite/${encodeURIComponent(token)}?error=invalid`;
  }

  revalidatePath("/");
  redirect(destination);
}

async function sendInvitationEmail(
  preview: EmployeeInvitationPreview,
  token: string
): ReturnType<typeof sendEmployeeInvitationEmail> {
  const inviteUrl = new URL(`/invite/${token}`, resolvePublicBaseUrl()).href;

  return sendEmployeeInvitationEmail({
    to: preview.invitation.email,
    productName: preview.productName,
    tenantDisplayName: preview.tenantDisplayName,
    inviteUrl
  });
}

function employeeFromSession(
  session: Awaited<ReturnType<typeof assertCurrentWebTenantPermission>>,
  now: string
): Employee {
  return {
    id: session.employeeId,
    tenantId: session.tenantId,
    email: "",
    displayName: "",
    roles: session.tenantRoles,
    createdAt: now
  };
}

function employeeFromRecord(record: TenantEmployeeRecord): Employee {
  return {
    id: record.employeeId,
    tenantId: record.tenantId,
    email: record.email,
    displayName: record.displayName,
    roles: record.roles,
    createdAt: record.createdAt.toISOString(),
    deactivatedAt: record.deactivatedAt?.toISOString()
  };
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

async function assertVerifiedTenantPermission(
  permission: Permission
): ReturnType<typeof assertCurrentWebTenantPermission> {
  try {
    return await assertCurrentWebTenantPermission(permission, {
      requireVerifiedEmail: true
    });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect("/admin/employees?emailVerification=required");
    }

    throw error;
  }
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

function requirePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password is too short.");
  }
}
