"use server";

import {
  acceptEmployeeInvitation,
  createEmployeeInvitation,
  createSequentialIdFactory,
  type Employee
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken
} from "@hulee/db";
import { hashLocalPassword } from "@hulee/modules";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomBytes, randomUUID } from "node:crypto";

import { resolvePublicBaseUrl, sendEmployeeInvitationEmail } from "./email";
import {
  assertCurrentWebTenantPermission,
  createTenantWebSession,
  getWebDatabase
} from "./session";

const invitationTtlMs = 1000 * 60 * 60 * 24 * 14;

export async function inviteEmployeeAction(formData: FormData): Promise<void> {
  const session = await assertCurrentWebTenantPermission("employees.manage");
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
    const passwordHash = await hashLocalPassword(password);
    const tenantAccount = await repository.acceptInvitation({
      tokenHash,
      accountId: `account:${accepted.employee.id}`,
      passwordHash,
      employee: accepted.employee,
      events: accepted.events,
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

function requirePassword(password: string): void {
  if (password.length < 8) {
    throw new Error("Password is too short.");
  }
}
