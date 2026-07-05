"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import {
  requestEmailVerificationForAccount,
  requestEmailVerificationForTenantAccount,
  requestPasswordResetEmail,
  resetPasswordWithToken
} from "./auth-email";
import {
  authActionError,
  authActionSuccess,
  type AuthActionState
} from "./auth-action-state";
import { assertWebActionRequest } from "./action-security";
import { assertWebAuthRateLimit } from "./auth-rate-limit";
import {
  completeTenantLoginChoice,
  loginLocalWebSession,
  logoutCurrentWebSession,
  registerLocalTenant,
  requireCurrentWebAccessSession,
  TenantLoginChoiceRequiredError,
  writeTenantLoginChoices
} from "./session";

export async function loginAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  let destination: string | undefined;

  try {
    await assertWebActionRequest();
    const tenantSlug = readOptionalFormString(formData, "tenantSlug");
    const email = readRequiredFormString(formData, "email");
    const password = readRequiredFormString(formData, "password");
    const returnTo = resolveOptionalSafeReturnTo(
      readOptionalFormString(formData, "returnTo")
    );

    await assertWebAuthRateLimit("login", `${tenantSlug ?? "*"}:${email}`);
    const result = await loginLocalWebSession({
      tenantSlug,
      email,
      password
    });
    destination = returnTo ?? result.redirectPath;
  } catch (error) {
    if (error instanceof TenantLoginChoiceRequiredError) {
      await writeTenantLoginChoices({
        email: error.email,
        choices: error.choices,
        returnTo: resolveOptionalSafeReturnTo(
          readOptionalFormString(formData, "returnTo")
        )
      });

      destination = "/login/select-company";
    } else {
      return authActionError("invalid_credentials");
    }
  }

  if (destination === undefined) {
    return authActionError("invalid_credentials");
  }

  redirect(destination);
}

export async function selectTenantLoginAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  let destination: string | undefined;

  try {
    await assertWebActionRequest();
    const tenantSlug = readRequiredFormString(formData, "tenantSlug");

    await assertWebAuthRateLimit("select_company", tenantSlug);
    const result = await completeTenantLoginChoice(tenantSlug);

    destination = result?.redirectPath;
  } catch {
    return authActionError("invalid_credentials");
  }

  if (destination === undefined) {
    return authActionError("invalid_credentials");
  }

  redirect(destination);
}

export async function registerAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  let destination: string | undefined;

  try {
    await assertWebActionRequest();
    const tenantSlug =
      readOptionalFormString(formData, "tenantSlug") ??
      createRandomTenantSlug();
    const tenantDisplayName = readRequiredFormString(
      formData,
      "tenantDisplayName"
    );
    const adminDisplayName = readOptionalFormString(
      formData,
      "adminDisplayName"
    );
    const email = readRequiredFormString(formData, "email");
    const password = readRequiredFormString(formData, "password");

    await assertWebAuthRateLimit("register", email);
    const result = await registerLocalTenant({
      tenantSlug,
      tenantDisplayName,
      adminDisplayName,
      email,
      password
    });
    const emailResult =
      result.tenantAccount === undefined
        ? ({ sent: false, reason: "provider_failed" } as const)
        : await requestEmailVerificationForTenantAccount(result.tenantAccount);
    const status = emailResult.sent ? "sent" : emailResult.reason;

    destination = addSearchParam(
      result.redirectPath,
      "emailVerification",
      status
    );
  } catch {
    return authActionError("registration_invalid");
  }

  if (destination === undefined) {
    return authActionError("registration_invalid");
  }

  redirect(destination);
}

export async function forgotPasswordAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  try {
    await assertWebActionRequest();
    const email = readRequiredFormString(formData, "email");

    await assertWebAuthRateLimit("forgot_password", email);
    await requestPasswordResetEmail({
      email
    });
  } catch {
    // Keep password reset responses non-enumerating for tenant accounts.
  }

  return authActionSuccess("forgot_password_sent");
}

export async function resetPasswordAction(
  _previousState: AuthActionState,
  formData: FormData
): Promise<AuthActionState> {
  let token: string | undefined;
  let destination: string | undefined;

  try {
    await assertWebActionRequest();
    token = readRequiredFormString(formData, "token");
    const password = readRequiredFormString(formData, "password");

    await assertWebAuthRateLimit("reset_password", token);
    const status = await resetPasswordWithToken({
      token,
      password
    });

    if (status === "complete") {
      destination = "/login?reset=complete";
    } else if (status === "weak_password") {
      return authActionError("reset_password_policy");
    }
  } catch {
    return authActionError("reset_invalid");
  }

  if (destination) {
    redirect(destination);
  }

  return authActionError("reset_invalid");
}

export async function resendEmailVerificationAction(
  formData?: FormData
): Promise<void> {
  await assertWebActionRequest();

  const session = await requireCurrentWebAccessSession();
  const returnTo = resolveSafeReturnTo(
    formData ? readOptionalFormString(formData, "returnTo") : undefined
  );
  let destination = addSearchParam(
    returnTo,
    "emailVerification",
    "provider_failed"
  );

  if (session.accountId !== undefined) {
    try {
      await assertWebAuthRateLimit(
        "resend_email_verification",
        `${session.tenantId}:${session.accountId}`
      );
      const emailResult = await requestEmailVerificationForAccount({
        tenantId: session.tenantId,
        accountId: session.accountId
      });
      const status = emailResult.sent ? "sent" : emailResult.reason;

      destination = addSearchParam(returnTo, "emailVerification", status);
    } catch {
      destination = addSearchParam(
        returnTo,
        "emailVerification",
        "provider_failed"
      );
    }
  }

  revalidatePath("/");
  redirect(destination);
}

export async function logoutAction(): Promise<void> {
  await assertWebActionRequest();

  await logoutCurrentWebSession();
  revalidatePath("/");
  revalidatePath("/admin/integrations");
  revalidatePath("/platform");
  redirect("/login");
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value;
}

function addSearchParam(path: string, name: string, value: string): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);

  params.set(name, value);

  return `${pathname}?${params.toString()}`;
}

function resolveSafeReturnTo(value: string | undefined): string {
  return resolveOptionalSafeReturnTo(value) ?? "/";
}

function resolveOptionalSafeReturnTo(
  value: string | undefined
): string | undefined {
  if (value === undefined || !value.startsWith("/")) {
    return undefined;
  }

  if (value.startsWith("//")) {
    return undefined;
  }

  if (value === "/login" || value.startsWith("/login?")) {
    return undefined;
  }

  return value;
}

function createRandomTenantSlug(): string {
  return randomUUID();
}

function readOptionalFormString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  return value;
}
