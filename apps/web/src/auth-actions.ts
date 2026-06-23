"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import {
  requestEmailVerificationForTenantAccount,
  requestPasswordResetEmail,
  resetPasswordWithToken
} from "./auth-email";
import {
  loginLocalWebSession,
  logoutCurrentWebSession,
  registerLocalTenant,
  resolvePreferredTenantSlug
} from "./session";

export async function loginAction(formData: FormData): Promise<void> {
  const tenantSlug = readOptionalFormString(formData, "tenantSlug");
  const email = readRequiredFormString(formData, "email");
  const password = readRequiredFormString(formData, "password");
  let destination = "/login?error=invalid";

  try {
    const result = await loginLocalWebSession({
      tenantSlug,
      email,
      password
    });
    destination = result.redirectPath;
  } catch {
    destination = "/login?error=invalid";
  }

  redirect(destination);
}

export async function registerAction(formData: FormData): Promise<void> {
  const tenantSlug =
    readOptionalFormString(formData, "tenantSlug") ?? createRandomTenantSlug();
  const tenantDisplayName = readRequiredFormString(
    formData,
    "tenantDisplayName"
  );
  const adminDisplayName = readOptionalFormString(formData, "adminDisplayName");
  const email = readRequiredFormString(formData, "email");
  const password = readRequiredFormString(formData, "password");
  let destination = "/register?error=invalid";

  try {
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
    destination = "/register?error=invalid";
  }

  redirect(destination);
}

export async function forgotPasswordAction(formData: FormData): Promise<void> {
  const tenantSlug = await resolvePreferredTenantSlug(
    readOptionalFormString(formData, "tenantSlug")
  );
  const email = readRequiredFormString(formData, "email");

  try {
    await requestPasswordResetEmail({
      tenantSlug,
      email
    });
  } catch {
    // Keep password reset responses non-enumerating for tenant accounts.
  }

  redirect("/forgot-password?status=sent");
}

export async function resetPasswordAction(formData: FormData): Promise<void> {
  const token = readRequiredFormString(formData, "token");
  const password = readRequiredFormString(formData, "password");
  const status = await resetPasswordWithToken({
    token,
    password
  });

  if (status === "complete") {
    redirect("/login?reset=complete");
  }

  redirect(`/reset-password/${encodeURIComponent(token)}?error=invalid`);
}

export async function logoutAction(): Promise<void> {
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
