"use server";

import type { EmployeeId, PlatformEvent } from "@hulee/contracts";
import {
  normalizeEmailAddress,
  type EmailValidationPolicy
} from "@hulee/contact-identity";
import {
  acceptEmployeeInvitation,
  CoreError,
  createAccountEmailVerifiedEvent,
  createEmployeeInvitation,
  createSequentialIdFactory,
  deactivateEmployee,
  resendEmployeeInvitation,
  revokeEmployeeInvitation,
  type Employee
} from "@hulee/core";
import {
  createSqlAuthEmailTokenRepository,
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
import { requestEmailChangeVerificationForAccount } from "./auth-email";
import { assertWebActionRequest } from "./action-security";
import { authActionError, type AuthActionState } from "./auth-action-state";
import { assertWebAuthRateLimit } from "./auth-rate-limit";
import { requireValidPassword } from "./password-policy";
import {
  createTenantWebSession,
  getWebDatabase,
  isEmailNotVerifiedError,
  resolveWebConfig
} from "./session";
import {
  canUseLocalBrandAssetStorage,
  putLocalBrandAsset,
  toLocalBrandAssetStorageKey
} from "./local-brand-asset-storage";
import { normalizePhoneNumberForStorage } from "./phone-number";
import type { WebAccessSession } from "./access";
import {
  assertWebDbBackedAdminCommandBoundary,
  webDbBackedAdminCommandBoundaries
} from "./web-admin-command-boundary";
import type {
  EmployeeAdminActionCode,
  EmployeeAdminActionState
} from "./employee-admin-action-state";
import type {
  EmployeeProfileActionCode,
  EmployeeProfileActionState,
  EmployeeProfileActionStatus
} from "./employee-profile-action-state";
import type {
  EmployeeEmailChangeActionCode,
  EmployeeEmailChangeActionState
} from "./employee-email-change-action-state";

const invitationTtlMs = 1000 * 60 * 60 * 24 * 14;
const maxEmployeeAvatarBytes = 2 * 1024 * 1024;
const employeeAvatarMediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

class EmployeeProfileActionError extends Error {
  constructor(readonly status: EmployeeProfileActionStatus) {
    super(status);
  }
}

class EmployeeEmailChangeActionError extends Error {
  constructor(readonly status: EmployeeEmailChangeActionCode) {
    super(status);
  }
}

export async function inviteEmployeeAction(
  _previousState: EmployeeAdminActionState,
  formData: FormData
): Promise<EmployeeAdminActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const rawEmail = readRequiredFormString(formData, "email");
    const displayName = readOptionalFormString(formData, "displayName");
    const now = new Date();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashEmployeeInvitationToken(token);
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
    const email = normalizeEmployeeEmail(rawEmail);
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
    const manualInviteUrl = inviteUrlFromToken(token);
    const emailResult =
      preview === null
        ? { sent: false, reason: "provider_failed" as const }
        : await sendEmployeeInvitationEmail({
            to: created.invitation.email,
            productName: preview.productName,
            tenantDisplayName: preview.tenantDisplayName,
            inviteUrl: manualInviteUrl
          });

    revalidatePath("/admin/employees");

    return employeeAdminInviteResult({
      code: emailResult.sent ? "sent" : emailResult.reason,
      manualInviteUrl,
      submittedAt
    });
  } catch (error) {
    return employeeAdminActionError(error, submittedAt);
  }
}

export async function deactivateEmployeeAction(
  _previousState: EmployeeAdminActionState,
  formData: FormData
): Promise<EmployeeAdminActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
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

    revalidatePath("/admin/employees");

    return employeeAdminActionSuccess("deactivated", submittedAt);
  } catch (error) {
    return employeeAdminActionError(error, submittedAt);
  }
}

export async function updateEmployeeProfileAction(
  _previousState: EmployeeProfileActionState,
  formData: FormData
): Promise<EmployeeProfileActionState> {
  await assertWebActionRequest();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const displayName = readRequiredFormString(formData, "displayName");
    const avatarFile = readOptionalFormFile(formData, "avatarFile");
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
    const phoneNumber = normalizeEmployeePhoneNumber(
      readOptionalFormString(formData, "phoneNumber")
    );
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

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${encodeURIComponent(employeeId)}/access`);

    return {
      code: "profile_updated",
      status: "success",
      submittedAt: now.toISOString()
    };
  } catch (error) {
    return {
      code: employeeProfileActionFailureCode(error),
      status: "error",
      submittedAt: new Date().toISOString()
    };
  }
}

export async function requestEmployeeEmailChangeAction(
  _previousState: EmployeeEmailChangeActionState,
  formData: FormData
): Promise<EmployeeEmailChangeActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const employeeId = readRequiredFormString(
      formData,
      "employeeId"
    ) as EmployeeId;
    const newEmail = normalizeEmployeeEmail(
      readRequiredFormString(formData, "email")
    );
    const database = getWebDatabase();
    const employeeRepository = createSqlEmployeeDirectoryRepository(database);
    const target = await employeeRepository.findEmployee({
      tenantId: session.tenantId,
      employeeId
    });

    if (target === null || target.deactivatedAt !== null) {
      throw new EmployeeEmailChangeActionError("email_change_unavailable");
    }

    if (target.accountId === null) {
      throw new EmployeeEmailChangeActionError("email_change_unavailable");
    }

    if (target.email.toLowerCase() === newEmail.toLowerCase()) {
      return employeeEmailChangeActionSuccess("email_unchanged", submittedAt);
    }

    const existingAccount = await createSqlAuthEmailTokenRepository(
      database
    ).findAccountEmailOwner({
      tenantId: session.tenantId,
      email: newEmail
    });

    if (
      existingAccount !== null &&
      existingAccount.accountId !== target.accountId
    ) {
      throw new EmployeeEmailChangeActionError("email_change_duplicate");
    }

    const emailResult = await requestEmailChangeVerificationForAccount({
      tenantId: session.tenantId,
      accountId: target.accountId,
      newEmail
    });

    if (!emailResult.sent) {
      throw new EmployeeEmailChangeActionError(emailResult.reason);
    }

    revalidatePath("/admin/employees");
    revalidatePath(`/admin/employees/${encodeURIComponent(employeeId)}/access`);

    return employeeEmailChangeActionSuccess("email_change_sent", submittedAt);
  } catch (error) {
    return {
      code: employeeEmailChangeActionFailureCode(error),
      status: "error",
      submittedAt
    };
  }
}

export async function revokeEmployeeInviteAction(
  _previousState: EmployeeAdminActionState,
  formData: FormData
): Promise<EmployeeAdminActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const invitationId = readRequiredFormString(formData, "invitationId");
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
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

    revalidatePath("/admin/employees");

    return employeeAdminActionSuccess("invite_revoked", submittedAt);
  } catch (error) {
    return employeeAdminActionError(error, submittedAt);
  }
}

export async function resendEmployeeInviteAction(
  _previousState: EmployeeAdminActionState,
  formData: FormData
): Promise<EmployeeAdminActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const session = await assertVerifiedEmployeeManagementPermission({
      redirectOnEmailNotVerified: false
    });
    const invitationId = readRequiredFormString(formData, "invitationId");
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());
    const now = new Date();
    const token = randomBytes(32).toString("base64url");
    const tokenHash = hashEmployeeInvitationToken(token);
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

    revalidatePath("/admin/employees");

    return employeeAdminInviteResult({
      code: emailResult.sent ? "sent" : emailResult.reason,
      manualInviteUrl: inviteUrlFromToken(token),
      submittedAt
    });
  } catch (error) {
    return employeeAdminActionError(error, submittedAt);
  }
}

export async function acceptEmployeeInviteAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  let destination: string | undefined;

  try {
    await assertWebActionRequest();

    const token = readRequiredFormString(formData, "token");
    const displayName = readRequiredFormString(formData, "displayName");
    const password = readRequiredFormString(formData, "password");
    const tokenHash = hashEmployeeInvitationToken(token);
    const repository = createSqlEmployeeDirectoryRepository(getWebDatabase());

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
    return authActionError("invite_invalid");
  }

  if (destination === undefined) {
    return authActionError("invite_invalid");
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
    throw new EmployeeProfileActionError("avatar_invalid_type");
  }

  if (input.file.size <= 0 || input.file.size > maxEmployeeAvatarBytes) {
    throw new EmployeeProfileActionError("avatar_too_large");
  }

  const body = new Uint8Array(await input.file.arrayBuffer());
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const objectStorageKey = `tenants/${input.tenantId}/employee-assets/${input.employeeId}/avatar/${hash}.${extension}`;
  const config = resolveWebConfig();
  const storageKey = config.objectStorage
    ? objectStorageKey
    : toLocalBrandAssetStorageKey(objectStorageKey);

  try {
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
      throw new EmployeeProfileActionError("avatar_storage_unavailable");
    }
  } catch (error) {
    if (error instanceof EmployeeProfileActionError) {
      throw error;
    }

    throw new EmployeeProfileActionError("avatar_storage_unavailable");
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
  try {
    return normalizePhoneNumberForStorage(value);
  } catch {
    throw new EmployeeProfileActionError("phone_invalid");
  }
}

function normalizeEmployeeEmail(value: string): string {
  try {
    return normalizeEmailAddress(value, userSuppliedEmailPolicy());
  } catch {
    throw new Error("Invalid employee email.");
  }
}

function userSuppliedEmailPolicy(): EmailValidationPolicy {
  const config = resolveWebConfig();

  return {
    blockDisposableDomains: true,
    blockReservedDomains: config.nodeEnv === "production"
  };
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

async function assertVerifiedEmployeeManagementPermission(
  options: { readonly redirectOnEmailNotVerified?: boolean } = {}
): Promise<WebAccessSession> {
  try {
    return await assertWebDbBackedAdminCommandBoundary(
      webDbBackedAdminCommandBoundaries.employeeLifecycle
    );
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      if (options.redirectOnEmailNotVerified ?? true) {
        redirect("/admin/employees?emailVerification=required");
      }
    }

    throw error;
  }
}

function employeeProfileActionFailureCode(
  error: unknown
): EmployeeProfileActionCode {
  if (error instanceof EmployeeProfileActionError) {
    return error.status;
  }

  if (isEmailNotVerifiedError(error)) {
    return "email_verification_required";
  }

  if (error instanceof CoreError && error.code === "permission.denied") {
    return "permission_denied";
  }

  return "profile_invalid";
}

function employeeEmailChangeActionSuccess(
  code: Extract<
    EmployeeEmailChangeActionCode,
    "email_change_sent" | "email_unchanged"
  >,
  submittedAt: string
): EmployeeEmailChangeActionState {
  return {
    code,
    status: "success",
    submittedAt
  };
}

function employeeEmailChangeActionFailureCode(
  error: unknown
): EmployeeEmailChangeActionCode {
  if (error instanceof EmployeeEmailChangeActionError) {
    return error.status;
  }

  if (isEmailNotVerifiedError(error)) {
    return "email_verification_required";
  }

  if (error instanceof CoreError && error.code === "permission.denied") {
    return "permission_denied";
  }

  return "email_change_invalid";
}

function employeeAdminActionSuccess(
  code: "deactivated" | "invite_revoked",
  submittedAt: string
): EmployeeAdminActionState {
  return {
    code,
    status: "success",
    submittedAt
  };
}

function employeeAdminInviteResult(input: {
  code: "not_configured" | "provider_failed" | "sent";
  manualInviteUrl: string;
  submittedAt: string;
}): EmployeeAdminActionState {
  if (input.code === "sent") {
    return {
      code: input.code,
      manualInviteUrl: input.manualInviteUrl,
      status: "success",
      submittedAt: input.submittedAt
    };
  }

  return {
    code: input.code,
    manualInviteUrl: input.manualInviteUrl,
    status: "info",
    submittedAt: input.submittedAt
  };
}

function employeeAdminActionError(
  error: unknown,
  submittedAt: string
): EmployeeAdminActionState {
  let code: Extract<
    EmployeeAdminActionCode,
    "email_verification_required" | "invalid" | "permission_denied"
  > = "invalid";

  if (isEmailNotVerifiedError(error)) {
    code = "email_verification_required";
  } else if (error instanceof CoreError && error.code === "permission.denied") {
    code = "permission_denied";
  }

  return {
    code,
    status: "error",
    submittedAt
  };
}

function inviteUrlFromToken(token: string): string {
  return new URL(`/invite/${token}`, resolvePublicBaseUrl()).href;
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
