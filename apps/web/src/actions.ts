"use server";

import {
  buildBrandThemeTokens,
  isBrandThemePresetId,
  type BrandThemePresetId
} from "@hulee/branding";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import type { Permission } from "@hulee/core";

import {
  deleteTelegramWebhook,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  updateInboxConversationRouting,
  updateTenantBrand,
  updateTelegramIntegration
} from "./inbox-api-client";
import { assertWebActionRequest } from "./action-security";
import {
  assertCurrentWebTenantPermission,
  isEmailNotVerifiedError
} from "./session";

export async function sendReplyAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const conversationId = readRequiredFormString(formData, "conversationId");
  await assertVerifiedTenantPermission(
    "message.reply",
    `/?conversationId=${encodeURIComponent(conversationId)}`
  );

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

export async function updateConversationRoutingAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const conversationId = readRequiredFormString(formData, "conversationId");
  await assertVerifiedTenantPermission(
    "conversation.assign",
    `/?conversationId=${encodeURIComponent(conversationId)}`
  );

  await updateInboxConversationRouting({
    conversationId,
    request: {
      currentQueueId: readNullableOptionalFormString(
        formData,
        "currentQueueId"
      ),
      assignedEmployeeId: readNullableOptionalFormString(
        formData,
        "assignedEmployeeId"
      ),
      assignedTeamId: readNullableOptionalFormString(formData, "assignedTeamId")
    }
  });

  revalidatePath("/");
}

export async function applyBrandPresetAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("tenant.manage", "/admin/branding");

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
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("tenant.manage", "/admin/branding");

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
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("modules.manage", "/admin/integrations");

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
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("modules.manage", "/admin/integrations");

  await refreshTelegramDiagnostics();
  revalidateTelegramIntegrationPaths();
}

export async function setTelegramWebhookAction(): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("modules.manage", "/admin/integrations");

  await setTelegramWebhook();
  revalidateTelegramIntegrationPaths();
}

export async function deleteTelegramWebhookAction(): Promise<void> {
  await assertWebActionRequest();
  await assertVerifiedTenantPermission("modules.manage", "/admin/integrations");

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

async function assertVerifiedTenantPermission(
  permission: Permission,
  redirectPath: string
): ReturnType<typeof assertCurrentWebTenantPermission> {
  try {
    return await assertCurrentWebTenantPermission(permission, {
      requireVerifiedEmail: true
    });
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(addSearchParam(redirectPath, "emailVerification", "required"));
    }

    throw error;
  }
}

function addSearchParam(path: string, name: string, value: string): string {
  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);

  params.set(name, value);

  return `${pathname}?${params.toString()}`;
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

function readNullableOptionalFormString(
  formData: FormData,
  name: string
): string | null | undefined {
  if (!formData.has(name)) {
    return undefined;
  }

  const value = readOptionalFormString(formData, name);
  const normalized = value?.trim();

  return normalized && normalized.length > 0 ? normalized : null;
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
