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
  internalChannelAuthChallengeTypeSchema,
  internalChannelTypeSchema
} from "@hulee/contracts";
import type { Permission } from "@hulee/core";

import {
  cancelChannelAuthChallenge,
  createChannelConnector,
  deleteChannelConnector,
  deleteTelegramWebhook,
  disableChannelConnector,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  startChannelAuthChallenge,
  submitChannelAuthChallenge,
  updateInboxConversationRouting,
  updateTenantBrand,
  updateTelegramIntegration,
  type InternalApiAccessOptions
} from "./inbox-api-client";
import { assertWebActionRequest } from "./action-security";
import { assertWebTenantEmailVerified } from "./access";
import {
  assertCurrentWebEffectiveTenantPermission,
  isEmailNotVerifiedError,
  requireCurrentWebAccessSession
} from "./session";
import {
  inboxReplyActionFailureStatus,
  type InboxReplyActionStatus,
  inboxRoutingActionFailureStatus,
  type InboxRoutingActionStatus
} from "./inbox-action-status";

export async function sendReplyAction(formData: FormData): Promise<void> {
  await assertWebActionRequest();

  const conversationId = readRequiredFormString(formData, "conversationId");
  const redirectPath = inboxActionReturnTo(formData, conversationId);

  try {
    assertWebTenantEmailVerified(await requireCurrentWebAccessSession());
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(addSearchParam(redirectPath, "emailVerification", "required"));
    }

    redirect(
      inboxReplyActionDestination(
        redirectPath,
        inboxReplyActionFailureStatus(error)
      )
    );
  }

  const text = readRequiredFormString(formData, "text").trim();

  if (text.length === 0) {
    redirect(inboxReplyActionDestination(redirectPath, "invalid"));
  }

  let replyStatus: InboxReplyActionStatus = "sent";

  try {
    await sendInboxReply({
      conversationId,
      text,
      idempotencyKey: `web-reply:${conversationId}:${randomUUID()}`
    });
  } catch (error) {
    replyStatus = inboxReplyActionFailureStatus(error);
  }

  if (replyStatus === "sent") {
    revalidatePath("/");
  }

  redirect(inboxReplyActionDestination(redirectPath, replyStatus));
}

export async function updateConversationRoutingAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();

  const conversationId = readRequiredFormString(formData, "conversationId");
  const redirectPath = inboxActionReturnTo(formData, conversationId);

  try {
    assertWebTenantEmailVerified(await requireCurrentWebAccessSession());
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      redirect(addSearchParam(redirectPath, "emailVerification", "required"));
    }

    redirect(
      inboxRoutingActionDestination(
        redirectPath,
        inboxRoutingActionFailureStatus(error)
      )
    );
  }

  let routingStatus: InboxRoutingActionStatus = "saved";

  try {
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
        assignedTeamId: readNullableOptionalFormString(
          formData,
          "assignedTeamId"
        )
      }
    });
  } catch (error) {
    routingStatus = inboxRoutingActionFailureStatus(error);
  }

  if (routingStatus === "saved") {
    revalidatePath("/");
  }

  redirect(inboxRoutingActionDestination(redirectPath, routingStatus));
}

export async function applyBrandPresetAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "tenant.manage",
    "/admin/branding"
  );

  const productName = readRequiredFormString(formData, "productName").trim();
  const shortProductName = normalizeOptionalFormValue(
    readOptionalFormString(formData, "shortProductName")
  );
  const presetId = resolvePresetId(
    readRequiredFormString(formData, "presetId")
  );
  let destination = "/admin/branding?brandStatus=saved";

  try {
    await updateTenantBrand(
      {
        productName,
        shortProductName,
        themeTokens: buildBrandThemeTokens({ presetId })
      },
      internalApiAccess
    );
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
  const internalApiAccess = await assertVerifiedTenantPermission(
    "tenant.manage",
    "/admin/branding"
  );

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
    await updateTenantBrand(
      {
        productName,
        shortProductName,
        themeTokens: buildBrandThemeTokens({
          presetId,
          primaryColor,
          accentColor
        })
      },
      internalApiAccess
    );
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
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );

  const channelExternalId = readRequiredFormString(
    formData,
    "channelExternalId"
  ).trim();
  const connectorId = requiredConnectorIdFromForm(formData);
  const displayName = readOptionalFormString(formData, "displayName")?.trim();
  const mode = readRequiredFormString(formData, "mode").trim();
  const botTokenSecretRef = readOptionalFormString(
    formData,
    "botTokenSecretRef"
  );
  const botToken = readOptionalFormString(formData, "botToken");
  const enabled = readFormCheckbox(formData, "enabled");
  const setupStepCompleted = readTelegramSetupStepCompleted(formData);

  await updateTelegramIntegration(
    {
      connectorId,
      displayName:
        displayName === undefined || displayName.length === 0
          ? undefined
          : displayName,
      enabled,
      setupStepCompleted,
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
    },
    internalApiAccess
  );

  if (enabled) {
    await refreshTelegramDiagnostics(internalApiAccess, {
      connectorId
    });
  }

  revalidateTelegramIntegrationPaths();
}

export async function createChannelConnectorAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const channelType = internalChannelTypeSchema.parse(
    readRequiredFormString(formData, "channelType")
  );
  const displayName = readOptionalFormString(formData, "displayName")?.trim();
  const connector = await createChannelConnector(
    {
      channelType,
      displayName:
        displayName === undefined || displayName.length === 0
          ? undefined
          : displayName
    },
    internalApiAccess
  );

  revalidateTelegramIntegrationPaths();
  redirect(
    `/admin/integrations?connectorId=${encodeURIComponent(
      connector.connectorId
    )}&channelStatus=created`
  );
}

export async function refreshTelegramDiagnosticsAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = requiredConnectorIdFromForm(formData);

  await refreshTelegramDiagnostics(internalApiAccess, {
    connectorId
  });
  revalidateTelegramIntegrationPaths();
}

export async function setTelegramWebhookAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = requiredConnectorIdFromForm(formData);

  await setTelegramWebhook(internalApiAccess, {
    connectorId
  });
  revalidateTelegramIntegrationPaths();
}

export async function deleteTelegramWebhookAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = requiredConnectorIdFromForm(formData);

  await deleteTelegramWebhook(internalApiAccess, {
    connectorId
  });
  revalidateTelegramIntegrationPaths();
}

export async function disableChannelConnectorAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();

  await disableChannelConnector({ connectorId }, internalApiAccess);
  revalidateTelegramIntegrationPaths();
  redirect(
    `/admin/integrations?connectorId=${encodeURIComponent(
      connectorId
    )}&channelStatus=disabled`
  );
}

export async function deleteChannelConnectorAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();

  await deleteChannelConnector({ connectorId }, internalApiAccess);
  revalidateTelegramIntegrationPaths();
  redirect("/admin/integrations?channelStatus=deleted");
}

export async function startChannelAuthChallengeAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();
  const challengeType = internalChannelAuthChallengeTypeSchema.parse(
    readRequiredFormString(formData, "challengeType")
  );
  const phoneNumber = normalizeOptionalFormValue(
    readOptionalFormString(formData, "phoneNumber")
  );
  const response = await startChannelAuthChallenge(
    {
      connectorId,
      request: {
        challengeType,
        phoneNumber
      }
    },
    internalApiAccess
  );

  revalidateTelegramIntegrationPaths();
  redirect(
    channelAuthChallengeDestination({
      connectorId,
      challengeId: response.challenge.challengeId,
      status: "started"
    })
  );
}

export async function submitChannelAuthChallengeAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();
  const challengeId = readRequiredFormString(formData, "challengeId").trim();
  const code = normalizeOptionalFormValue(
    readOptionalFormString(formData, "code")
  );
  const password = normalizeOptionalFormValue(
    readOptionalFormString(formData, "password")
  );

  await submitChannelAuthChallenge(
    {
      connectorId,
      challengeId,
      request: {
        code,
        password
      }
    },
    internalApiAccess
  );

  revalidateTelegramIntegrationPaths();
  redirect(
    channelAuthChallengeDestination({
      connectorId,
      challengeId,
      status: "submitted"
    })
  );
}

export async function cancelChannelAuthChallengeAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();
  const challengeId = readRequiredFormString(formData, "challengeId").trim();

  await cancelChannelAuthChallenge(
    { connectorId, challengeId },
    internalApiAccess
  );
  revalidateTelegramIntegrationPaths();
  redirect(
    channelAuthChallengeDestination({
      connectorId,
      challengeId,
      status: "cancelled"
    })
  );
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string") {
    throw new Error(`Form field ${name} is required.`);
  }

  return value;
}

function requiredConnectorIdFromForm(formData: FormData): string {
  return readRequiredFormString(formData, "connectorId").trim();
}

async function assertVerifiedTenantPermission<TPermission extends Permission>(
  permission: TPermission,
  redirectPath: string
): Promise<InternalApiAccessOptions<TPermission>> {
  try {
    await assertCurrentWebEffectiveTenantPermission(permission, {
      requireVerifiedEmail: true
    });

    return {
      effectivePermissionOverride: permission
    };
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

function inboxRoutingActionDestination(
  path: string,
  status: InboxRoutingActionStatus
): string {
  return addSearchParam(path, "routingStatus", status);
}

function inboxReplyActionDestination(
  path: string,
  status: InboxReplyActionStatus
): string {
  return addSearchParam(path, "replyStatus", status);
}

function channelAuthChallengeDestination(input: {
  connectorId: string;
  challengeId: string;
  status: "started" | "submitted" | "cancelled";
}): string {
  const params = new URLSearchParams({
    connectorId: input.connectorId,
    challengeId: input.challengeId,
    challengeStatus: input.status
  });

  return `/admin/integrations?${params.toString()}`;
}

function inboxActionReturnTo(
  formData: FormData,
  conversationId: string
): string {
  const returnTo = readOptionalFormString(formData, "returnTo");

  if (isSafeInboxActionReturnTo(returnTo)) {
    return returnTo;
  }

  return `/?conversationId=${encodeURIComponent(conversationId)}`;
}

function isSafeInboxActionReturnTo(path: string | undefined): path is string {
  return path === "/" || path?.startsWith("/?") === true;
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

function readTelegramSetupStepCompleted(
  formData: FormData
): "name" | "token" | "mode" | undefined {
  const value = readOptionalFormString(formData, "setupStepCompleted");

  return value === "name" || value === "token" || value === "mode"
    ? value
    : undefined;
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
