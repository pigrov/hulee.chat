"use server";

import {
  buildBrandThemeTokens,
  isBrandThemePresetId,
  type BrandThemePresetId
} from "@hulee/branding";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";

import {
  deleteTelegramWebhook,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  updateTenantBrand,
  updateTelegramIntegration
} from "./inbox-api-client";
import { assertCurrentWebTenantPermission } from "./session";

export async function sendReplyAction(formData: FormData): Promise<void> {
  await assertCurrentWebTenantPermission("message.reply");

  const conversationId = readRequiredFormString(formData, "conversationId");
  const text = readRequiredFormString(formData, "text").trim();

  if (text.length === 0) {
    return;
  }

  await sendInboxReply({
    conversationId,
    text,
    idempotencyKey: `web-reply:${conversationId}:${randomUUID()}`
  });

  revalidatePath("/");
}

export async function applyBrandPresetAction(
  formData: FormData
): Promise<void> {
  await assertCurrentWebTenantPermission("tenant.manage");

  const productName = readRequiredFormString(formData, "productName").trim();
  const shortProductName = normalizeOptionalFormValue(
    readOptionalFormString(formData, "shortProductName")
  );
  const presetId = resolvePresetId(
    readRequiredFormString(formData, "presetId")
  );
  let destination = "/admin/branding?brandStatus=saved";

  try {
    await updateTenantBrand({
      productName,
      shortProductName,
      themeTokens: buildBrandThemeTokens({ presetId })
    });
  } catch {
    destination = "/admin/branding?brandStatus=invalid";
  }

  revalidateBrandPaths();
  redirect(destination);
}

export async function updateTenantBrandAction(
  formData: FormData
): Promise<void> {
  await assertCurrentWebTenantPermission("tenant.manage");

  const productName = readRequiredFormString(formData, "productName").trim();
  const shortProductName = normalizeOptionalFormValue(
    readOptionalFormString(formData, "shortProductName")
  );
  const presetId = resolvePresetId(
    readOptionalFormString(formData, "presetId") ?? "hulee"
  );
  const primaryColor = readRequiredFormString(formData, "primaryColor").trim();
  const accentColor = readRequiredFormString(formData, "accentColor").trim();
  let destination = "/admin/branding?brandStatus=saved";

  try {
    await updateTenantBrand({
      productName,
      shortProductName,
      themeTokens: buildBrandThemeTokens({
        presetId,
        primaryColor,
        accentColor
      })
    });
  } catch {
    destination = "/admin/branding?brandStatus=invalid";
  }

  revalidateBrandPaths();
  redirect(destination);
}

export async function updateTelegramIntegrationAction(
  formData: FormData
): Promise<void> {
  await assertCurrentWebTenantPermission("modules.manage");

  const channelExternalId = readRequiredFormString(
    formData,
    "channelExternalId"
  ).trim();
  const mode = readRequiredFormString(formData, "mode").trim();
  const botTokenSecretRef = readOptionalFormString(
    formData,
    "botTokenSecretRef"
  );
  const botToken = readOptionalFormString(formData, "botToken");

  await updateTelegramIntegration({
    enabled: readFormCheckbox(formData, "enabled"),
    channelExternalId,
    mode: mode === "polling" ? "polling" : "webhook",
    botTokenSecretRef:
      botTokenSecretRef === undefined || botTokenSecretRef.trim().length === 0
        ? undefined
        : botTokenSecretRef.trim(),
    botToken:
      botToken === undefined || botToken.trim().length === 0
        ? undefined
        : botToken.trim(),
    outboundEnabled: readFormCheckbox(formData, "outboundEnabled")
  });
  await refreshTelegramDiagnostics();

  revalidateTelegramIntegrationPaths();
}

export async function refreshTelegramDiagnosticsAction(): Promise<void> {
  await assertCurrentWebTenantPermission("modules.manage");

  await refreshTelegramDiagnostics();
  revalidateTelegramIntegrationPaths();
}

export async function setTelegramWebhookAction(): Promise<void> {
  await assertCurrentWebTenantPermission("modules.manage");

  await setTelegramWebhook();
  revalidateTelegramIntegrationPaths();
}

export async function deleteTelegramWebhookAction(): Promise<void> {
  await assertCurrentWebTenantPermission("modules.manage");

  await deleteTelegramWebhook();
  revalidateTelegramIntegrationPaths();
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string") {
    throw new Error(`Form field ${name} is required.`);
  }

  return value;
}

function readOptionalFormString(
  formData: FormData,
  name: string
): string | undefined {
  const value = formData.get(name);

  return typeof value === "string" ? value : undefined;
}

function normalizeOptionalFormValue(
  value: string | undefined
): string | undefined {
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : undefined;
}

function resolvePresetId(value: string): BrandThemePresetId {
  return isBrandThemePresetId(value) ? value : "hulee";
}

function readFormCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function revalidateBrandPaths(): void {
  revalidatePath("/");
  revalidatePath("/admin/branding");
  revalidatePath("/admin/integrations");
  revalidatePath("/admin/employees");
}

function revalidateTelegramIntegrationPaths(): void {
  revalidatePath("/");
  revalidatePath("/admin/integrations");
}
