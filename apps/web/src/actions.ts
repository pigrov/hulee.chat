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
import { normalizeOptionalPhoneNumber } from "@hulee/contact-identity";
import { CoreError, type Permission } from "@hulee/core";
import { createSqlDeploymentChannelProviderPolicyRepository } from "@hulee/db";
import { createS3ObjectStorage } from "@hulee/storage";
import { sql } from "drizzle-orm";

import {
  cancelChannelAuthChallenge,
  createChannelConnector,
  createSourceConnection,
  deleteChannelConnector,
  deleteTelegramWebhook,
  disableChannelConnector,
  enableChannelConnector,
  loadChannelConnectors,
  loadTelegramIntegration,
  sendInboxReply,
  setTelegramWebhook,
  startChannelAuthChallenge,
  submitChannelAuthChallenge,
  updateChannelConnector,
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
  inboxRoutingActionFailureStatus
} from "./inbox-action-status";
import {
  inboxReplyActionError,
  inboxReplyActionSuccess,
  inboxRoutingActionError,
  inboxRoutingActionSuccess,
  type InboxReplyActionState,
  type InboxRoutingActionState
} from "./inbox-action-state";
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
import type {
  TelegramBotCatalogConnectActionErrorCode,
  TelegramBotCatalogConnectActionState
} from "./telegram-bot-catalog-connect-action-state";
import type {
  ChannelConnectorLifecycleActionCode,
  ChannelConnectorLifecycleActionState
} from "./channel-connector-lifecycle-action-state";
import type { ChannelConnectorSettingsActionState } from "./channel-connector-settings-action-state";
import type {
  ChannelConnectorCreateActionCode,
  ChannelConnectorCreateActionState
} from "./channel-connector-create-action-state";
import type {
  SourceConnectionCreateActionCode,
  SourceConnectionCreateActionState
} from "./source-connection-create-action-state";
import type {
  BrandingActionCode,
  BrandingActionState
} from "./branding-action-state";
import {
  channelAuthChallengeActionError,
  channelAuthChallengeActionSuccess,
  type ChannelAuthChallengeActionCode,
  type ChannelAuthChallengeActionState
} from "./channel-auth-challenge-action-state";

type TelegramConnectionActionState = {
  status: "idle" | "queued" | "saved" | "error";
  connectorId?: string;
  submittedAt?: string;
};

const telegramBotChannelType = "telegram_bot" as const;
const directQrChannelTypes = new Set([
  "telegram_qr_bridge",
  "whatsapp_qr_bridge"
]);
const telegramBotTokenPattern = /^\d{6,14}:[A-Za-z0-9_-]{30,}$/;
const maxBrandLogoBytes = 2 * 1024 * 1024;
const brandLogoMediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

class BrandingActionError extends Error {
  constructor(readonly code: Exclude<BrandingActionCode, "saved">) {
    super(code);
  }
}

export async function sendReplyAction(
  _previousState: InboxReplyActionState,
  formData: FormData
): Promise<InboxReplyActionState> {
  await assertWebActionRequest();

  try {
    const conversationId = readRequiredFormString(formData, "conversationId");
    assertWebTenantEmailVerified(await requireCurrentWebAccessSession());
    const text = readRequiredFormString(formData, "text").trim();

    if (text.length === 0) {
      return inboxReplyActionError("invalid");
    }

    await sendInboxReply({
      conversationId,
      text,
      idempotencyKey: `web-reply:${conversationId}:${randomUUID()}`
    });

    revalidatePath("/");

    return inboxReplyActionSuccess("sent");
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      return inboxReplyActionError("email_verification_required");
    }

    return inboxReplyActionError(inboxReplyActionFailureStatus(error));
  }
}

export async function updateConversationRoutingAction(
  _previousState: InboxRoutingActionState,
  formData: FormData
): Promise<InboxRoutingActionState> {
  await assertWebActionRequest();

  try {
    const conversationId = readRequiredFormString(formData, "conversationId");
    assertWebTenantEmailVerified(await requireCurrentWebAccessSession());

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

    revalidatePath("/");

    return inboxRoutingActionSuccess("saved");
  } catch (error) {
    if (isEmailNotVerifiedError(error)) {
      return inboxRoutingActionError("email_verification_required");
    }

    return inboxRoutingActionError(inboxRoutingActionFailureStatus(error));
  }
}

export async function applyBrandPresetAction(
  _previousState: BrandingActionState,
  formData: FormData
): Promise<BrandingActionState> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "tenant.manage",
    "/admin/branding"
  );
  const submittedAt = new Date().toISOString();

  const productName = readRequiredFormString(formData, "productName").trim();
  const shortProductName = normalizeOptionalFormValue(
    readOptionalFormString(formData, "shortProductName")
  );
  const presetId = resolvePresetId(
    readRequiredFormString(formData, "presetId")
  );
  const themeMode = readBrandThemeMode(formData);

  try {
    await updateTenantBrand(
      {
        productName,
        shortProductName,
        themeTokens: buildBrandThemeTokens({ mode: themeMode, presetId })
      },
      internalApiAccess
    );
  } catch (error) {
    return brandingActionError(brandingActionFailureCode(error), submittedAt);
  }

  revalidateBrandPaths();

  return brandingActionSuccess(submittedAt);
}

export async function updateTenantBrandAction(
  _previousState: BrandingActionState,
  formData: FormData
): Promise<BrandingActionState> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "tenant.manage",
    "/admin/branding"
  );
  const submittedAt = new Date().toISOString();

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
  } catch (error) {
    return brandingActionError(brandingActionFailureCode(error), submittedAt);
  }

  revalidateBrandPaths();

  return brandingActionSuccess(submittedAt);
}

function brandingActionSuccess(submittedAt: string): BrandingActionState {
  return {
    code: "saved",
    status: "success",
    submittedAt
  };
}

function brandingActionError(
  code: Exclude<BrandingActionCode, "saved">,
  submittedAt: string
): BrandingActionState {
  return {
    code,
    status: "error",
    submittedAt
  };
}

function brandingActionFailureCode(
  error: unknown
): Exclude<BrandingActionCode, "saved"> {
  if (error instanceof BrandingActionError) {
    return error.code;
  }

  if (error instanceof CoreError) {
    if (error.code === "permission.denied") {
      return "permission_denied";
    }

    if (error.code === "validation.failed") {
      return "invalid";
    }

    return "internal_api_failed";
  }

  logUnexpectedBrandingActionError(error);

  return "internal_api_failed";
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
    throw new BrandingActionError("logo_invalid_type");
  }

  if (input.file.size <= 0 || input.file.size > maxBrandLogoBytes) {
    throw new BrandingActionError("logo_too_large");
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
      throw new BrandingActionError("logo_storage_unavailable");
    }
  } catch (error) {
    if (error instanceof BrandingActionError) {
      throw error;
    }

    throw new BrandingActionError("logo_storage_unavailable");
  }

  try {
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
  } catch (error) {
    logUnexpectedBrandingActionError(error);
    throw new BrandingActionError("logo_metadata_unavailable");
  }

  return {
    url: `/brand-assets/${encodeURIComponent(assetId)}/logo.${extension}?v=${encodeURIComponent(hash)}`
  };
}

function logUnexpectedBrandingActionError(error: unknown): void {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.error("[branding] action failed", error);
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
  _previousState: ChannelConnectorCreateActionState,
  formData: FormData
): Promise<ChannelConnectorCreateActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const internalApiAccess = await assertVerifiedTenantPermission(
      "modules.manage",
      "/admin/integrations",
      { redirectOnEmailNotVerified: false }
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
    let authChallenge: Awaited<
      ReturnType<typeof startChannelAuthChallenge>
    > | null = null;

    if (directQrChannelTypes.has(channelType)) {
      try {
        authChallenge = await startChannelAuthChallenge(
          {
            connectorId: connector.connectorId,
            request: {
              challengeType: "qr"
            }
          },
          internalApiAccess
        );
      } catch (error) {
        await deleteChannelConnector(
          { connectorId: connector.connectorId },
          internalApiAccess
        ).catch(() => undefined);
        throw error;
      }
    }

    revalidateTelegramIntegrationPaths();

    return {
      challengeId: authChallenge?.challenge.challengeId,
      code: "created",
      connectorId: connector.connectorId,
      status: "success",
      submittedAt
    };
  } catch (error) {
    return {
      code: channelConnectorCreateFailureCode(error),
      status: "error",
      submittedAt
    };
  }
}

export async function createSourceConnectionAction(
  _previousState: SourceConnectionCreateActionState,
  formData: FormData
): Promise<SourceConnectionCreateActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();

  try {
    const internalApiAccess = await assertVerifiedTenantPermission(
      "modules.manage",
      "/admin/integrations",
      { redirectOnEmailNotVerified: false }
    );
    const sourceName = readRequiredFormString(formData, "sourceName").trim();
    const displayName = readOptionalFormString(formData, "displayName")?.trim();
    const response = await createSourceConnection(
      {
        sourceName,
        displayName:
          displayName === undefined || displayName.length === 0
            ? undefined
            : displayName
      },
      internalApiAccess
    );

    revalidatePath("/admin/integrations");

    return {
      code: "created",
      sourceConnectionId: response.connection.sourceConnectionId,
      webhookToken: response.webhookToken,
      status: "success",
      submittedAt
    };
  } catch (error) {
    return {
      code: sourceConnectionCreateFailureCode(error),
      status: "error",
      submittedAt
    };
  }
}

export async function connectTelegramBotChannelAction(
  _previousState: TelegramBotCatalogConnectActionState,
  formData: FormData
): Promise<TelegramBotCatalogConnectActionState> {
  await assertWebActionRequest();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );
  const submittedAt = new Date().toISOString();
  const channelType = internalChannelTypeSchema.parse(
    readRequiredFormString(formData, "channelType")
  );
  const botToken = readRequiredFormString(formData, "botToken").trim();

  if (channelType !== telegramBotChannelType || !isTelegramBotToken(botToken)) {
    return telegramBotCatalogConnectError("telegramTokenInvalid", submittedAt);
  }

  let validation: Awaited<ReturnType<typeof validateTelegramBotToken>>;

  try {
    validation = await validateTelegramBotToken(
      { botToken },
      internalApiAccess
    );
  } catch (error) {
    return telegramBotCatalogConnectError(
      telegramTokenValidationFailureStatus(error),
      submittedAt
    );
  }

  const duplicate = await findDuplicateTelegramBotConnector({
    bot: validation.bot,
    internalApiAccess
  });

  if (duplicate) {
    return {
      code: "telegramTokenDuplicate",
      duplicateConnectorId: duplicate.connectorId,
      status: "error",
      submittedAt
    };
  }

  let connectorId: string | undefined;

  try {
    const displayName = telegramDisplayNameFromValidatedBot(validation.bot);
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

    return {
      code: "setupQueued",
      connectorId: connector.connectorId,
      status: "success",
      submittedAt
    };
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

  return telegramBotCatalogConnectError("invalid", submittedAt);
}

function telegramBotCatalogConnectError(
  code: TelegramBotCatalogConnectActionErrorCode,
  submittedAt: string
): TelegramBotCatalogConnectActionState {
  return {
    code,
    status: "error",
    submittedAt
  };
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

export async function updateChannelConnectorLifecycleAction(
  _previousState: ChannelConnectorLifecycleActionState,
  formData: FormData
): Promise<ChannelConnectorLifecycleActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );

  try {
    const connectorId = readRequiredFormString(formData, "connectorId").trim();
    const intent = readChannelConnectorLifecycleIntent(formData);

    switch (intent) {
      case "enable":
        await enableChannelConnector({ connectorId }, internalApiAccess);
        revalidateTelegramIntegrationPaths();

        return channelConnectorLifecycleSuccess({
          code: "enabled",
          connectorId,
          submittedAt
        });
      case "disable":
        await disableChannelConnector({ connectorId }, internalApiAccess);
        revalidateTelegramIntegrationPaths();

        return channelConnectorLifecycleSuccess({
          code: "disabled",
          connectorId,
          submittedAt
        });
      case "delete":
        await deleteChannelConnector({ connectorId }, internalApiAccess);
        revalidateTelegramIntegrationPaths();

        return channelConnectorLifecycleSuccess({
          code: "deleted",
          connectorId,
          submittedAt
        });
    }
  } catch {
    return {
      code: "invalid",
      status: "error",
      submittedAt
    };
  }
}

export async function updateChannelConnectorSettingsAction(
  _previousState: ChannelConnectorSettingsActionState,
  formData: FormData
): Promise<ChannelConnectorSettingsActionState> {
  await assertWebActionRequest();
  const submittedAt = new Date().toISOString();
  const internalApiAccess = await assertVerifiedTenantPermission(
    "modules.manage",
    "/admin/integrations"
  );

  try {
    const connectorId = readRequiredFormString(formData, "connectorId").trim();
    const displayName = readRequiredFormString(formData, "displayName").trim();

    await updateChannelConnector(
      {
        connectorId,
        request: {
          displayName
        }
      },
      internalApiAccess
    );

    revalidateTelegramIntegrationPaths();

    return {
      code: "saved",
      connectorId,
      status: "success",
      submittedAt
    };
  } catch {
    return {
      code: "invalid",
      status: "error",
      submittedAt
    };
  }
}

function channelConnectorLifecycleSuccess(input: {
  code: Exclude<ChannelConnectorLifecycleActionCode, "invalid">;
  connectorId: string;
  submittedAt: string;
}): ChannelConnectorLifecycleActionState {
  return {
    code: input.code,
    connectorId: input.connectorId,
    status: "success",
    submittedAt: input.submittedAt
  };
}

export async function startChannelAuthChallengeAction(
  _previousState: ChannelAuthChallengeActionState,
  formData: FormData
): Promise<ChannelAuthChallengeActionState> {
  try {
    await assertWebActionRequest();
    const internalApiAccess = await assertVerifiedTenantPermission(
      "modules.manage",
      "/admin/integrations",
      { redirectOnEmailNotVerified: false }
    );
    const connectorId = readRequiredFormString(formData, "connectorId").trim();
    const challengeType = internalChannelAuthChallengeTypeSchema.parse(
      readRequiredFormString(formData, "challengeType")
    );
    const phoneNumber = normalizeActionPhoneNumber(
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

    return channelAuthChallengeActionSuccess({
      code: "started",
      connectorId,
      challengeId: response.challenge.challengeId
    });
  } catch (error) {
    return channelAuthChallengeActionError(
      channelAuthChallengeFailureCode(error)
    );
  }
}

export async function submitChannelAuthChallengeAction(
  _previousState: ChannelAuthChallengeActionState,
  formData: FormData
): Promise<ChannelAuthChallengeActionState> {
  try {
    await assertWebActionRequest();
    const internalApiAccess = await assertVerifiedTenantPermission(
      "modules.manage",
      "/admin/integrations",
      { redirectOnEmailNotVerified: false }
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

    return channelAuthChallengeActionSuccess({
      code: "submitted",
      connectorId,
      challengeId
    });
  } catch (error) {
    return channelAuthChallengeActionError(
      channelAuthChallengeFailureCode(error)
    );
  }
}

export async function cancelChannelAuthChallengeAction(
  _previousState: ChannelAuthChallengeActionState,
  formData: FormData
): Promise<ChannelAuthChallengeActionState> {
  try {
    await assertWebActionRequest();
    const internalApiAccess = await assertVerifiedTenantPermission(
      "modules.manage",
      "/admin/integrations",
      { redirectOnEmailNotVerified: false }
    );
    const connectorId = readRequiredFormString(formData, "connectorId").trim();
    const challengeId = readOptionalFormString(formData, "challengeId")?.trim();
    const deleteConnectorOnCancel =
      readOptionalFormString(formData, "deleteConnectorOnCancel") === "on";
    const redirectChannelType = normalizeOptionalFormValue(
      readOptionalFormString(formData, "redirectChannelType")
    );
    const redirectSourceName = normalizeOptionalFormValue(
      readOptionalFormString(formData, "redirectSourceName")
    );
    const redirectTab = readOptionalFormString(formData, "redirectTab");

    if (challengeId) {
      await cancelChannelAuthChallenge(
        { connectorId, challengeId },
        internalApiAccess
      ).catch((error) => {
        if (!deleteConnectorOnCancel) {
          throw error;
        }
      });
    }

    if (deleteConnectorOnCancel) {
      await deleteChannelConnector({ connectorId }, internalApiAccess);
    }

    revalidateTelegramIntegrationPaths();

    return channelAuthChallengeActionSuccess({
      code: "cancelled",
      connectorId,
      challengeId,
      redirectChannelType:
        deleteConnectorOnCancel && redirectChannelType
          ? redirectChannelType
          : undefined,
      redirectSourceName:
        deleteConnectorOnCancel && redirectSourceName
          ? redirectSourceName
          : undefined,
      redirectTab:
        deleteConnectorOnCancel &&
        (redirectTab === "accounts" || redirectTab === "channels")
          ? redirectTab
          : undefined
    });
  } catch (error) {
    return channelAuthChallengeActionError(
      channelAuthChallengeFailureCode(error)
    );
  }
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
  redirectPath: string,
  options: { readonly redirectOnEmailNotVerified?: boolean } = {}
): Promise<InternalApiAccessOptions<TPermission>> {
  try {
    await assertCurrentWebEffectiveTenantPermission(permission, {
      requireVerifiedEmail: true
    });

    return {
      effectivePermissionOverride: permission
    };
  } catch (error) {
    if (
      isEmailNotVerifiedError(error) &&
      (options.redirectOnEmailNotVerified ?? true)
    ) {
      redirect(addSearchParam(redirectPath, "emailVerification", "required"));
    }

    throw error;
  }
}

function channelConnectorCreateFailureCode(
  error: unknown
): Exclude<ChannelConnectorCreateActionCode, "created"> {
  if (isEmailNotVerifiedError(error)) {
    return "email_verification_required";
  }

  if (error instanceof CoreError && error.code === "permission.denied") {
    return "permission_denied";
  }

  return "invalid";
}

function sourceConnectionCreateFailureCode(
  error: unknown
): Exclude<SourceConnectionCreateActionCode, "created"> {
  if (isEmailNotVerifiedError(error)) {
    return "email_verification_required";
  }

  if (error instanceof CoreError) {
    if (error.code === "permission.denied") {
      return "permission_denied";
    }

    if (error.code === "module.unhealthy") {
      return "module_unhealthy";
    }
  }

  return "invalid";
}

function channelAuthChallengeFailureCode(
  error: unknown
): Exclude<
  ChannelAuthChallengeActionCode,
  "cancelled" | "started" | "submitted"
> {
  if (isEmailNotVerifiedError(error)) {
    return "email_verification_required";
  }

  if (error instanceof CoreError && error.code === "permission.denied") {
    return "permission_denied";
  }

  return "invalid";
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

function normalizeActionPhoneNumber(
  value: string | undefined
): string | undefined {
  return normalizeOptionalPhoneNumber(value) ?? undefined;
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

function readChannelConnectorLifecycleIntent(
  formData: FormData
): "delete" | "disable" | "enable" {
  const value = readRequiredFormString(formData, "intent");

  if (value === "delete" || value === "disable" || value === "enable") {
    return value;
  }

  throw new Error(`Unsupported channel connector lifecycle intent: ${value}`);
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
