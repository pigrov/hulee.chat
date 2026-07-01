"use server";

import {
  internalChannelReadinessSchema,
  internalChannelTypeSchema,
  internalChannelVisibilitySchema
} from "@hulee/contracts";
import {
  createSqlDeploymentChannelCatalogOverrideRepository,
  createSqlPlatformAuditRepository,
  type DeploymentChannelCatalogOverrideRecord,
  type LocalizedTextOverrides
} from "@hulee/db";
import { createS3ObjectStorage } from "@hulee/storage";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createHash, randomUUID } from "node:crypto";

import { assertWebPlatformAdmin } from "./access";
import { assertWebActionRequest } from "./action-security";
import {
  buildChannelCatalogOverridePersistenceInput,
  findPlatformChannelCatalogDefinition
} from "./platform-channel-catalog";
import {
  getWebDatabase,
  requireCurrentWebAccessSession,
  resolveWebConfig
} from "./session";

const maxChannelIconBytes = 512 * 1024;
const channelIconMediaTypes = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp"
} as const;

export async function updatePlatformChannelCatalogOverrideAction(
  formData: FormData
): Promise<void> {
  let selectedChannelType: string | undefined;
  let destination = "/platform/channels?channelCatalog=invalid";

  try {
    await assertWebActionRequest();
    const session = assertWebPlatformAdmin(
      await requireCurrentWebAccessSession()
    );
    const channelType = internalChannelTypeSchema.parse(
      readRequiredFormString(formData, "channelType")
    );
    selectedChannelType = channelType;
    const definition = findPlatformChannelCatalogDefinition(channelType);
    const visibility = internalChannelVisibilitySchema.parse(
      readRequiredFormString(formData, "visibility")
    );
    const readiness = internalChannelReadinessSchema.parse(
      readRequiredFormString(formData, "readiness")
    );
    const database = getWebDatabase();
    const repository =
      createSqlDeploymentChannelCatalogOverrideRepository(database);
    const previous = await repository.findOverride(channelType);
    const updatedAt = new Date();
    const next = buildChannelCatalogOverridePersistenceInput({
      definition,
      previous,
      titleOverrides: localizedOverridesFromForm(formData, "title"),
      shortDescriptionOverrides: localizedOverridesFromForm(
        formData,
        "shortDescription"
      ),
      descriptionOverrides: localizedOverridesFromForm(formData, "description"),
      sortOrder: readOptionalInteger(formData, "sortOrder"),
      visibility,
      readiness,
      updatedAt,
      updatedByPlatformAdminAccountId: session.platformAdminAccountId
    });

    await repository.upsertOverride(next);
    await createSqlPlatformAuditRepository(database).record({
      id: `platform-audit:channel-catalog:${channelType}:${randomUUID()}`,
      actorPlatformAdminAccountId: session.platformAdminAccountId,
      action: "platform.channel_catalog_override.updated",
      entityType: "deployment_channel_catalog_override",
      entityId: channelType,
      metadata: {
        surface: "web",
        previous: serializeOverrideForAudit(previous),
        next: serializeOverrideForAudit(next)
      },
      occurredAt: updatedAt
    });

    destination = platformChannelsDestination({
      channelType,
      statusName: "channelCatalog",
      status: "updated"
    });
  } catch {
    destination = platformChannelsDestination({
      channelType: selectedChannelType,
      statusName: "channelCatalog",
      status: "invalid"
    });
  }

  revalidateChannelCatalogPaths();
  redirect(destination);
}

export async function uploadPlatformChannelIconAction(
  formData: FormData
): Promise<void> {
  let selectedChannelType: string | undefined;
  let destination = "/platform/channels?channelCatalog=invalid";

  try {
    await assertWebActionRequest();
    const session = assertWebPlatformAdmin(
      await requireCurrentWebAccessSession()
    );
    const channelType = internalChannelTypeSchema.parse(
      readRequiredFormString(formData, "channelType")
    );
    selectedChannelType = channelType;
    const definition = findPlatformChannelCatalogDefinition(channelType);
    const iconFile = readRequiredFormFile(formData, "iconFile");
    const mediaType = iconFile.type;
    const extension =
      channelIconMediaTypes[mediaType as keyof typeof channelIconMediaTypes];

    if (!extension) {
      throw new Error(`Unsupported channel icon media type: ${mediaType}`);
    }

    if (iconFile.size <= 0 || iconFile.size > maxChannelIconBytes) {
      throw new Error("Invalid channel icon size.");
    }

    const config = resolveWebConfig();

    if (!config.objectStorage) {
      throw new Error("Object storage is not configured.");
    }

    const database = getWebDatabase();
    const repository =
      createSqlDeploymentChannelCatalogOverrideRepository(database);
    const previous = await repository.findOverride(channelType);
    const body = new Uint8Array(await iconFile.arrayBuffer());
    const hash = createHash("sha256").update(body).digest("hex").slice(0, 32);
    const storageKey = `deployment/channel-icons/${channelType}/${hash}.${extension}`;
    const updatedAt = new Date();

    await createS3ObjectStorage(config.objectStorage).putObject({
      storageKey,
      body,
      mediaType,
      fileName: iconFile.name
    });

    const next = buildChannelCatalogOverridePersistenceInput({
      definition,
      previous,
      titleOverrides: previous?.titleOverrides ?? {},
      shortDescriptionOverrides: previous?.shortDescriptionOverrides ?? {},
      descriptionOverrides: previous?.descriptionOverrides ?? {},
      iconAssetRef: storageKey,
      sortOrder: previous?.sortOrder,
      visibility: previous?.visibility ?? "visible",
      readiness: previous?.readiness,
      updatedAt,
      updatedByPlatformAdminAccountId: session.platformAdminAccountId
    });

    await repository.upsertOverride(next);
    await createSqlPlatformAuditRepository(database).record({
      id: `platform-audit:channel-icon:${channelType}:${randomUUID()}`,
      actorPlatformAdminAccountId: session.platformAdminAccountId,
      action: "platform.channel_catalog_icon.uploaded",
      entityType: "deployment_channel_catalog_override",
      entityId: channelType,
      metadata: {
        surface: "web",
        previous: serializeOverrideForAudit(previous),
        next: serializeOverrideForAudit(next),
        icon: {
          mediaType,
          sizeBytes: iconFile.size,
          storageKey
        }
      },
      occurredAt: updatedAt
    });

    destination = platformChannelsDestination({
      channelType,
      statusName: "channelCatalog",
      status: "updated"
    });
  } catch {
    destination = platformChannelsDestination({
      channelType: selectedChannelType,
      statusName: "channelCatalog",
      status: "invalid"
    });
  }

  revalidateChannelCatalogPaths();
  redirect(destination);
}

function localizedOverridesFromForm(
  formData: FormData,
  prefix: "title" | "shortDescription" | "description"
): LocalizedTextOverrides {
  return {
    ...localizedOverride(formData, `${prefix}Ru`, "ru"),
    ...localizedOverride(formData, `${prefix}En`, "en")
  };
}

function localizedOverride(
  formData: FormData,
  fieldName: string,
  locale: string
): LocalizedTextOverrides {
  const value = normalizeOptionalFormValue(
    readOptionalFormString(formData, fieldName)
  );

  return value ? { [locale]: value } : {};
}

function serializeOverrideForAudit(
  override: DeploymentChannelCatalogOverrideRecord | null
): Record<string, unknown> | null {
  if (override === null) {
    return null;
  }

  return {
    channelType: override.channelType,
    titleOverrides: override.titleOverrides,
    shortDescriptionOverrides: override.shortDescriptionOverrides,
    descriptionOverrides: override.descriptionOverrides,
    iconAssetRef: override.iconAssetRef,
    sortOrder: override.sortOrder,
    visibility: override.visibility,
    readiness: override.readiness,
    updatedAt: override.updatedAt.toISOString(),
    updatedByPlatformAdminAccountId: override.updatedByPlatformAdminAccountId
  };
}

function platformChannelsDestination(input: {
  channelType?: string;
  statusName: "channelCatalog";
  status: "updated" | "invalid";
}): string {
  const params = new URLSearchParams({
    [input.statusName]: input.status
  });

  if (input.channelType) {
    params.set("channelType", input.channelType);
  }

  return `/platform/channels?${params.toString()}`;
}

function readRequiredFormString(formData: FormData, name: string): string {
  const value = formData.get(name);

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Form field ${name} is required.`);
  }

  return value.trim();
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

function readOptionalInteger(
  formData: FormData,
  name: string
): number | undefined {
  const value = normalizeOptionalFormValue(
    readOptionalFormString(formData, name)
  );

  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed < -10_000 || parsed > 10_000) {
    throw new Error(`Form field ${name} must be an integer.`);
  }

  return parsed;
}

function readRequiredFormFile(formData: FormData, name: string): File {
  const value = formData.get(name);

  if (!(value instanceof File) || value.size <= 0) {
    throw new Error(`Form file ${name} is required.`);
  }

  return value;
}

function revalidateChannelCatalogPaths(): void {
  revalidatePath("/platform");
  revalidatePath("/platform/channels");
  revalidatePath("/admin/integrations");
}
