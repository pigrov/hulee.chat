"use server";

import type { EmployeeId, PlatformEvent } from "@hulee/contracts";
import {
  acceptEmployeeInvitation,
  createAccountEmailVerifiedEvent,
  createEmployeeInvitation,
  createSequentialIdFactory,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
  type Employee
} from "@hulee/core";
import {
  createSqlEmployeeDirectoryRepository,
  hashEmployeeInvitationToken,
  type EmployeeInvitationPreview,
  type TenantEmployeeAvatarAsset,
  type TenantEmployeeProfile,
  type TenantEmployeeRecord
} from "@hulee/db";
import { hashLocalPassword } from "@hulee/modules";
import { createS3ObjectStorage } from "@hulee/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { resolvePublicBaseUrl, sendEmployeeInvitationEmail } from "./email";
import { assertWebActionRequest } from "./action-security";
import { assertWebAuthRateLimit } from "./auth-rate-limit";
import { requireValidPassword } from "./password-policy";
import {
  createTenantWebSession,
  getWebDatabase,
  isEmailNotVerifiedError,
  resolveWebConfig
} from "./session";
import { isEmployeeAccessSectionId } from "./employee-access-sections";
import {
  canUseLocalBrandAssetStorage,
  putLocalBrandAsset,
  toLocalBrandAssetStorageKey
} from "./local-brand-asset-storage";
import type { WebAccessSession } from "./access";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";

const invitationTtlMs = 1000 * 60 * 60 * 24 * 14;
const maxEmployeeAvatarBytes = 2 * 1024 * 1024;
const employeeAvatarMediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;
const phoneNumberPattern = /^[+0-9 ()-]{3,32}$/;

export async function inviteEmployeeAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedEmployeeManagementPermission();
  const email = readRequiredFormString(formData, "email");
  const displayName = readOptionalFormString(formData, "displayName");
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashEmployeeInvitationToken(token);
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = employeeAdminDestination(formData, {
    kind: "inviteStatus",
    status: "invalid"
  });

  try {
    const created = createEmployeeInvitation({
      now: now.toISOString(),
      tenantId: session.tenantId,
      actor: employeeFromSession(session, now.toISOString()),
      email,
      displayName,
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

    destination = employeeAdminDestination(formData, {
      kind: "inviteStatus",
      status,
      inviteToken: token
    });
  } catch {
    destination = employeeAdminDestination(formData, {
      kind: "inviteStatus",
      status: "invalid"
    });
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function deactivateEmployeeAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedEmployeeManagementPermission();
  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = employeeAdminDestination(formData, {
    kind: "actionStatus",
    status: "invalid"
  });

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

    destination = employeeAdminDestination(formData, {
      kind: "actionStatus",
      status: "deactivated"
    });
  } catch {
    destination = employeeAdminDestination(formData, {
      kind: "actionStatus",
      status: "invalid"
    });
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function updateEmployeeProfileAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedEmployeeManagementPermission();
  const employeeId = readRequiredFormString(
    formData,
    "employeeId"
  ) as EmployeeId;
  const displayName = readRequiredFormString(formData, "displayName");
  const phoneNumber = normalizeEmployeePhoneNumber(
    readOptionalFormString(formData, "phoneNumber")
  );
  const avatarFile = readOptionalFormFile(formData, "avatarFile");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = employeeAccessDestination(formData, {
    employeeId,
    status: "invalid"
  });

  try {
    const target = await repository.findEmployee({
      tenantId: session.tenantId,
      employeeId
    });

    if (target === null) {
      throw new Error("Employee not found.");
    }

    const avatar =
      avatarFile === undefined
        ? target.avatar
        : await uploadEmployeeAvatar({
            tenantId: session.tenantId,
            employeeId,
            file: avatarFile
          });
    const profile: TenantEmployeeProfile = {
      phoneNumber,
      avatar
    };
    const now = new Date();
    const fields = changedEmployeeProfileFields({
      previous: target,
      displayName,
      profile
    });
    const events: readonly PlatformEvent[] = [
      {
        id: `event:employee.profile_updated:${randomUUID()}` as PlatformEvent["id"],
        type: "employee.profile_updated",
        version: "v1",
        tenantId: session.tenantId,
        occurredAt: now.toISOString(),
        payload: {
          employeeId,
          fields
        }
      }
    ];

    await repository.updateEmployeeProfile({
      tenantId: session.tenantId,
      employeeId,
      displayName,
      profile,
      updatedAt: now,
      events
    });

    destination = employeeAccessDestination(formData, {
      employeeId,
      status: "profile_updated"
    });
  } catch {
    destination = employeeAccessDestination(formData, {
      employeeId,
      status: "invalid"
    });
  }

  revalidatePath("/admin/employees");
  revalidatePath("/admin/employees/[employeeId]/access", "page");
  redirect(destination);
}

export async function revokeEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedEmployeeManagementPermission();
  const invitationId = readRequiredFormString(formData, "invitationId");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = employeeAdminDestination(formData, {
    kind: "actionStatus",
    status: "invalid"
  });

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

    destination = employeeAdminDestination(formData, {
      kind: "actionStatus",
      status: "invite_revoked"
    });
  } catch {
    destination = employeeAdminDestination(formData, {
      kind: "actionStatus",
      status: "invalid"
    });
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function resendEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await assertVerifiedEmployeeManagementPermission();
  const invitationId = readRequiredFormString(formData, "invitationId");
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashEmployeeInvitationToken(token);
  let destination = employeeAdminDestination(formData, {
    kind: "actionStatus",
    status: "invalid"
  });

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

    destination = employeeAdminDestination(formData, {
      kind: "inviteStatus",
      status,
      inviteToken: token
    });
  } catch {
    destination = employeeAdminDestination(formData, {
      kind: "actionStatus",
      status: "invalid"
    });
  }

  revalidatePath("/admin/employees");
  redirect(destination);
}

export async function acceptEmployeeInviteAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const token = readRequiredFormString(formData, "token");
  const displayName = readRequiredFormString(formData, "displayName");
  const password = readRequiredFormString(formData, "password");
  const tokenHash = hashEmployeeInvitationToken(token);
  const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
  let destination = "/invite/invalid";

  try {
    await assertWebAuthRateLimit("accept_employee_invite", token);

    const preview = await repository.findInvitationByTokenHash(tokenHash);

    if (preview === null) {
      throw new Error("Invitation not found.");
    }

    const acceptedPassword = requireValidPassword(password, {
      email: preview.invitation.email
    });

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
    const passwordHash = await hashLocalPassword(acceptedPassword);
    const tenantAccount = await repository.acceptInvitation({
      tokenHash,
      accountId,
      passwordHash,
      employee: accepted.employee,
      events,
      acceptedAt: now
    });
    const session = await createTenantWebSession(tenantAccount, {
      auditAction: "auth.invite.accepted"
    });

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

function employeeFromSession(session: WebAccessSession, now: string): Employee {
  return {
    id: session.employeeId,
    tenantId: session.tenantId,
    email: "",
    displayName: "",
    systemRoleTemplateIds: session.systemRoleTemplateIds,
    createdAt: now
  };
}

function employeeFromRecord(record: TenantEmployeeRecord): Employee {
  return {
    id: record.employeeId,
    tenantId: record.tenantId,
    email: record.email,
    displayName: record.displayName,
    systemRoleTemplateIds: record.systemRoleTemplateIds,
    createdAt: record.createdAt.toISOString(),
    deactivatedAt: record.deactivatedAt?.toISOString()
  };
}

async function uploadEmployeeAvatar(input: {
  tenantId: WebAccessSession["tenantId"];
  employeeId: EmployeeId;
  file: File;
}): Promise<TenantEmployeeAvatarAsset> {
  const mediaType = input.file.type;
  const extension =
    employeeAvatarMediaTypes[
      mediaType as keyof typeof employeeAvatarMediaTypes
    ];

  if (extension === undefined) {
    throw new Error(`Unsupported employee avatar media type: ${mediaType}`);
  }

  if (input.file.size <= 0 || input.file.size > maxEmployeeAvatarBytes) {
    throw new Error("Invalid employee avatar size.");
  }

  const body = new Uint8Array(await input.file.arrayBuffer());
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const objectStorageKey = `tenants/${input.tenantId}/employee-assets/${input.employeeId}/avatar/${hash}.${extension}`;
  const config = resolveWebConfig();
  const storageKey = config.objectStorage
    ? objectStorageKey
    : toLocalBrandAssetStorageKey(objectStorageKey);

  if (config.objectStorage) {
    await createS3ObjectStorage(config.objectStorage).putObject({
      storageKey,
      body,
      mediaType,
      fileName: input.file.name
    });
  } else if (canUseLocalBrandAssetStorage()) {
    await putLocalBrandAsset({ storageKey, body });
  } else {
    throw new Error("Object storage is not configured.");
  }

  return {
    storageKey,
    mediaType,
    sizeBytes: input.file.size,
    version: hash
  };
}

function normalizeEmployeePhoneNumber(
  value: string | undefined
): string | null {
  if (value === undefined) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (!phoneNumberPattern.test(normalized)) {
    throw new Error("Invalid employee phone number.");
  }

  return normalized;
}

function changedEmployeeProfileFields(input: {
  previous: TenantEmployeeRecord;
  displayName: string;
  profile: TenantEmployeeProfile;
}): readonly string[] {
  const fields: string[] = [];

  if (input.previous.displayName !== input.displayName) {
    fields.push("displayName");
  }

  if (input.previous.phoneNumber !== input.profile.phoneNumber) {
    fields.push("phoneNumber");
  }

  if (input.previous.avatar?.version !== input.profile.avatar?.version) {
    fields.push("avatar");
  }

  return fields.length === 0 ? ["profile"] : fields;
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
}

async function assertVerifiedEmployeeManagementPermission(): Promise<WebAccessSession> {
  try {
    return await assertWebDbBackedAdminCommandBoundary(
      webDbBackedAdminCommandBoundaries.employeeLifecycle
    );
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

function readOptionalFormFile(
  formData: FormData,
  name: string
): File | undefined {
  const value = formData.get(name);

  return value instanceof File && value.size > 0 ? value : undefined;
}

function employeeAccessDestination(
  formData: FormData,
  input: {
    employeeId: EmployeeId;
    status: string;
  }
): string {
  const returnTo = readOptionalFormString(formData, "returnTo");
  const path =
    returnTo !== undefined && isEmployeeAccessReturnTo(returnTo)
      ? returnTo
      : `/admin/employees/${encodeURIComponent(input.employeeId)}/access`;
  const params = new URLSearchParams({
    roleActionStatus: input.status
  });
  const section = readEmployeeAccessSection(formData);

  if (section !== undefined) {
    params.set("section", section);
  }

  return `${path}?${params.toString()}`;
}

function isEmployeeAccessReturnTo(path: string): boolean {
  return /^\/admin\/employees\/[^/?#]+\/access$/.test(path);
}

function readEmployeeAccessSection(formData: FormData): string | undefined {
  const value = readOptionalFormString(formData, "employeeAccessSection");

  return value !== undefined && isEmployeeAccessSectionId(value)
    ? value
    : undefined;
}

function employeeAdminDestination(
  formData: FormData,
  input: {
    kind: "actionStatus" | "inviteStatus";
    status: string;
    inviteToken?: string;
  }
): string {
  const params = new URLSearchParams({
    [input.kind]: input.status
  });
  const section = readEmployeeAdminSection(formData);

  if (input.inviteToken) {
    params.set("inviteToken", input.inviteToken);
  }

  if (section !== undefined) {
    params.set("section", section);
  }

  return `/admin/employees?${params.toString()}`;
}

function readEmployeeAdminSection(formData: FormData): string | undefined {
  const value = readOptionalFormString(formData, "section");

  if (value === "directory" || value === "invite" || value === "invitations") {
    return value;
  }

  return undefined;
}
