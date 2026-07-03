"use server";

import {
  buildBrandThemeTokens,
  isBrandThemePresetId,
  type BrandThemeMode,
  type BrandThemePresetId
} from "@hulee/branding";
import type { TenantId } from "@hulee/contracts";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomUUID } from "node:crypto";
import {
  internalChannelAuthChallengeTypeSchema,
  internalChannelTypeSchema,
  type InternalTelegramIntegrationConfig
} from "@hulee/contracts";
import type { Permission } from "@hulee/core";
import { createSqlDeploymentChannelProviderPolicyRepository } from "@hulee/db";
import { createS3ObjectStorage } from "@hulee/storage";
import { sql } from "drizzle-orm";

import {
  cancelChannelAuthChallenge,
  createChannelConnector,
  deleteChannelConnector,
  deleteTelegramWebhook,
  disableChannelConnector,
  enableChannelConnector,
  loadChannelConnectors,
  loadTelegramIntegration,
  refreshTelegramDiagnostics,
  sendInboxReply,
  setTelegramWebhook,
  startChannelAuthChallenge,
  submitChannelAuthChallenge,
  updateInboxConversationRouting,
  updateTenantBrand,
  updateTelegramIntegration,
  validateTelegramBotToken,
  type InternalApiAccessOptions
} from "./inbox-api-client";
import { assertWebActionRequest } from "./action-security";
import { assertWebTenantEmailVerified } from "./access";
import {
  assertCurrentWebEffectiveTenantPermission,
  isEmailNotVerifiedError,
  requireCurrentWebAccessSession,
  getWebDatabase,
  resolveWebConfig
} from "./session";
import {
  inboxReplyActionFailureStatus,
  type InboxReplyActionStatus,
  inboxRoutingActionFailureStatus,
  type InboxRoutingActionStatus
} from "./inbox-action-status";
import {
  loadTelegramBotChannelProviderPolicy,
  type PlatformChannelProviderPolicyView
} from "./platform-channel-policies";
import {
  canUseLocalBrandAssetStorage,
  putLocalBrandAsset,
  toLocalBrandAssetStorageKey
} from "./local-brand-asset-storage";
import {
  selectDuplicateTelegramBotConnector,
  telegramDisplayNameFromValidatedBot,
  telegramTokenValidationFailureStatus
} from "./telegram-bot-connector-rules";

type TelegramConnectionActionState = {
  status: "idle" | "queued" | "saved" | "error";
  connectorId?: string;
  submittedAt?: string;
};

const telegramBotChannelType = "telegram_bot" as const;
const telegramBotTokenPattern = /^\d{6,14}:[A-Za-z0-9_-]{30,}$/;
const maxBrandLogoBytes = 2 * 1024 * 1024;
const brandLogoMediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

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
  const themeMode = readBrandThemeMode(formData);
  let destination = brandDestination("saved", formData);

  try {
    await updateTenantBrand(
      {
        productName,
        shortProductName,
        themeTokens: buildBrandThemeTokens({ mode: themeMode, presetId })
      },
      internalApiAccess
    );
  } catch {
    destination = brandDestination("invalid", formData);
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
  const themeMode = readBrandThemeMode(formData);
  const primaryColor = readRequiredFormString(formData, "primaryColor").trim();
  const accentColor = readRequiredFormString(formData, "accentColor").trim();
  const logoFile = readOptionalFormFile(formData, "brandLogoFile");
  let destination = brandDestination("saved", formData);

  try {
    const uploadedLogo =
      logoFile === undefined
        ? undefined
        : await uploadTenantBrandLogo({
            tenantId: (await requireCurrentWebAccessSession()).tenantId,
            file: logoFile
          });
    const assets =
      uploadedLogo === undefined
        ? undefined
        : {
            logoLight: uploadedLogo.url,
            logoDark: uploadedLogo.url,
            mark: uploadedLogo.url
          };

    await updateTenantBrand(
      {
        productName,
        shortProductName,
        ...(assets === undefined ? {} : { assets }),
        themeTokens: buildBrandThemeTokens({
          mode: themeMode,
          presetId,
          primaryColor,
          accentColor
        })
      },
      internalApiAccess
    );
  } catch {
    destination = brandDestination("invalid", formData);
  }

  revalidateBrandPaths();
  redirect(destination);
}

function brandDestination(status: string, formData: FormData): string {
  const params = new URLSearchParams({ brandStatus: status });
  const section = readBrandingSection(formData);

  if (section !== undefined) {
    params.set("section", section);
  }

  return `/admin/branding?${params.toString()}`;
}

function readBrandingSection(formData: FormData): string | undefined {
  const value = readOptionalFormString(formData, "section");

  if (value === "presets" || value === "settings") {
    return value;
  }

  return undefined;
}

function readBrandThemeMode(formData: FormData): BrandThemeMode {
  const value = readOptionalFormString(formData, "themeMode");

  return value === "dark" ? "dark" : "light";
}

async function uploadTenantBrandLogo(input: {
  tenantId: TenantId;
  file: File;
}): Promise<{ url: string }> {
  const mediaType = input.file.type;
  const extension =
    brandLogoMediaTypes[mediaType as keyof typeof brandLogoMediaTypes];

  if (extension === undefined) {
    throw new Error(`Unsupported brand logo media type: ${mediaType}`);
  }

  if (input.file.size <= 0 || input.file.size > maxBrandLogoBytes) {
    throw new Error("Invalid brand logo size.");
  }

  const body = new Uint8Array(await input.file.arrayBuffer());
  const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
  const assetId = `brand-asset:${randomUUID()}`;
  const objectStorageKey = `tenants/${input.tenantId}/brand-assets/logo/${hash}.${extension}`;
  const config = resolveWebConfig();
  const storageKey = config.objectStorage
    ? objectStorageKey
    : toLocalBrandAssetStorageKey(objectStorageKey);
  const now = new Date();

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

  await getWebDatabase().execute(sql`
    insert into tenant_brand_assets (
      id,
      tenant_id,
      kind,
      storage_key,
      media_type,
      size_bytes,
      created_at,
      updated_at
    )
    values (
      ${assetId},
      ${input.tenantId},
      'logo',
      ${storageKey},
      ${mediaType},
      ${input.file.size},
      ${now},
      ${now}
    )
  `);

  return {
    url: `/brand-assets/${encodeURIComponent(assetId)}/logo.${extension}?v=${encodeURIComponent(hash)}`
  };
}

export async function updateTelegramIntegrationAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const result = await applyTelegramIntegrationUpdate(
    formData,
    internalApiAccess
  );

  revalidateTelegramIntegrationPaths();
  redirect(
    `/admin/integrations?connectorId=${encodeURIComponent(
      result.connectorId
    )}&channelStatus=setupQueued`
  );
}

export async function connectTelegramIntegrationAction(
  _previousState: TelegramConnectionActionState,
  formData: FormData
): Promise<TelegramConnectionActionState> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );

  try {
    const submittedAt = new Date().toISOString();
    const result = await applyTelegramIntegrationUpdate(
      formData,
      internalApiAccess
    );

    revalidateTelegramIntegrationPaths();

    return {
      status: result.providerCheckQueued ? "queued" : "saved",
      connectorId: result.connectorId,
      ...(result.providerCheckQueued ? { submittedAt } : {})
    };
  } catch {
    return {
      status: "error"
    };
  }
}

async function applyTelegramIntegrationUpdate(
  formData: FormData,
  internalApiAccess: InternalApiAccessOptions<"modules.manage">
): Promise<{ connectorId: string; providerCheckQueued: boolean }> {
  const channelExternalId = readRequiredFormString(
    formData,
    "channelExternalId"
  ).trim();
  const connectorId = requiredConnectorIdFromForm(formData);
  const displayName = readOptionalFormString(formData, "displayName")?.trim();
  const modeValue = readOptionalFormString(formData, "mode")?.trim();
  const botTokenSecretRef = readOptionalFormString(
    formData,
    "botTokenSecretRef"
  );
  const botToken = readOptionalFormString(formData, "botToken");
  const normalizedBotToken = normalizeOptionalFormValue(botToken);
  const enabled = readFormCheckbox(formData, "enabled");
  const setupStepCompleted = readTelegramSetupStepCompleted(formData);
  const shouldApplyPlatformDefaults =
    enabled &&
    modeValue === undefined &&
    !formData.has("outboundEnabled") &&
    setupStepCompleted === "mode";
  const platformDefaults = shouldApplyPlatformDefaults
    ? await loadTelegramBotChannelProviderPolicy({
        config: resolveWebConfig(),
        repository:
          createSqlDeploymentChannelProviderPolicyRepository(getWebDatabase())
      })
    : undefined;
  const mode = resolveTelegramIntegrationMode(modeValue, platformDefaults);
  const outboundEnabled = platformDefaults
    ? platformDefaults.outboundEnabled
    : readFormCheckbox(formData, "outboundEnabled");

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
      mode,
      botTokenSecretRef:
        botTokenSecretRef === undefined || botTokenSecretRef.trim().length === 0
          ? undefined
          : botTokenSecretRef.trim(),
      botToken: normalizedBotToken,
      outboundEnabled
    },
    internalApiAccess
  );

  const providerCheckQueued = enabled && normalizedBotToken !== undefined;

  if (providerCheckQueued) {
    if (mode === "webhook") {
      await setTelegramWebhook(internalApiAccess, {
        connectorId
      });
    } else {
      await deleteTelegramWebhook(internalApiAccess, {
        connectorId
      });
    }
  }

  return { connectorId, providerCheckQueued };
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

export async function connectTelegramBotChannelAction(
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
  const botToken = readRequiredFormString(formData, "botToken").trim();

  if (channelType !== telegramBotChannelType || !isTelegramBotToken(botToken)) {
    redirect(
      `/admin/integrations?channelType=${encodeURIComponent(
        telegramBotChannelType
      )}&channelStatus=telegramTokenInvalid`
    );
  }

  let validation: Awaited<ReturnType<typeof validateTelegramBotToken>>;

  try {
    validation = await validateTelegramBotToken(
      { botToken },
      internalApiAccess
    );
  } catch (error) {
    redirect(
      `/admin/integrations?channelType=${encodeURIComponent(
        telegramBotChannelType
      )}&channelStatus=${telegramTokenValidationFailureStatus(error)}`
    );
  }

  const duplicate = await findDuplicateTelegramBotConnector({
    bot: validation.bot,
    internalApiAccess
  });

  if (duplicate) {
    redirect(
      `/admin/integrations?channelType=${encodeURIComponent(
        telegramBotChannelType
      )}&channelStatus=telegramTokenDuplicate&duplicateConnectorId=${encodeURIComponent(
        duplicate.connectorId
      )}`
    );
  }

  let connectorId: string | undefined;
  let destination = `/admin/integrations?channelType=${encodeURIComponent(
    telegramBotChannelType
  )}&channelStatus=invalid`;

  try {
    const displayName = telegramDisplayNameFromValidatedBot(validation.bot);
    const submittedAt = new Date().toISOString();
    const connector = await createChannelConnector(
      {
        channelType,
        displayName
      },
      internalApiAccess
    );
    connectorId = connector.connectorId;

    const setupFormData = new FormData();
    setupFormData.set("connectorId", connector.connectorId);
    setupFormData.set(
      "channelExternalId",
      connector.channelExternalId ?? connector.connectorId
    );
    setupFormData.set("displayName", displayName);
    setupFormData.set("enabled", "on");
    setupFormData.set("setupStepCompleted", "mode");
    setupFormData.set("botToken", botToken);

    await applyTelegramIntegrationUpdate(setupFormData, internalApiAccess);
    revalidateTelegramIntegrationPaths();
    destination = `/admin/integrations?connectorId=${encodeURIComponent(
      connector.connectorId
    )}&channelStatus=setupQueued&connectionPendingAt=${encodeURIComponent(
      submittedAt
    )}`;
  } catch {
    if (connectorId) {
      await deleteChannelConnector(
        {
          connectorId
        },
        internalApiAccess
      ).catch(() => undefined);
    }

    revalidateTelegramIntegrationPaths();
  }

  redirect(destination);
}

async function findDuplicateTelegramBotConnector(input: {
  bot: Awaited<ReturnType<typeof validateTelegramBotToken>>["bot"];
  internalApiAccess: InternalApiAccessOptions<"modules.manage">;
}): Promise<{ connectorId: string } | undefined> {
  const connectors = await loadChannelConnectors(input.internalApiAccess);
  const telegramConnectors = connectors.connectors.filter(
    (connector) =>
      connector.channelType === telegramBotChannelType &&
      connector.status !== "deleted"
  );
  const integrations = await Promise.all(
    telegramConnectors.map(async (connector) => ({
      connector,
      integration: await loadTelegramIntegration(input.internalApiAccess, {
        connectorId: connector.connectorId
      }).catch(() => undefined)
    }))
  );

  return selectDuplicateTelegramBotConnector({
    bot: input.bot,
    candidates: integrations
  });
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
  redirect(
    `/admin/integrations?connectorId=${encodeURIComponent(
      connectorId
    )}&channelStatus=diagnosticsQueued`
  );
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

export async function enableChannelConnectorAction(
  formData: FormData
): Promise<void> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const connectorId = readRequiredFormString(formData, "connectorId").trim();

  await enableChannelConnector({ connectorId }, internalApiAccess);
  revalidateTelegramIntegrationPaths();
  redirect(
    `/admin/integrations?connectorId=${encodeURIComponent(
      connectorId
    )}&channelStatus=enabled`
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

function readOptionalFormFile(
  formData: FormData,
  name: string
): File | undefined {
  const value = formData.get(name);

  return value instanceof File && value.size > 0 ? value : undefined;
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

function isTelegramBotToken(value: string): boolean {
  return telegramBotTokenPattern.test(value.trim());
}

function resolveTelegramIntegrationMode(
  value: string | undefined,
  platformDefaults: PlatformChannelProviderPolicyView | undefined
): InternalTelegramIntegrationConfig["mode"] {
  if (platformDefaults) {
    return platformDefaults.inboundMode;
  }

  return value === "polling" ? "polling" : "webhook";
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
