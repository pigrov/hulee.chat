"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";

import {
  deleteTelegramWebhook,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  updateTelegramIntegration
} from "./inbox-api-client";

export async function sendReplyAction(formData: FormData): Promise<void> {
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

export async function updateTelegramIntegrationAction(
  formData: FormData
): Promise<void> {
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

  revalidatePath("/");
}

export async function refreshTelegramDiagnosticsAction(): Promise<void> {
  await refreshTelegramDiagnostics();
  revalidatePath("/");
}

export async function setTelegramWebhookAction(): Promise<void> {
  await setTelegramWebhook();
  revalidatePath("/");
}

export async function deleteTelegramWebhookAction(): Promise<void> {
  await deleteTelegramWebhook();
  revalidatePath("/");
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

function readFormCheckbox(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}
