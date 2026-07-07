import type {
  InternalChannelClass,
  InternalChannelReadiness,
  InternalChannelType,
  InternalChannelVisibility
} from "@hulee/contracts";
import type { I18nMessageKey } from "@hulee/i18n";
import type {
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  LocalizedTextOverrides
} from "@hulee/db";

export type PlatformChannelCatalogDefinition = {
  channelType: InternalChannelType;
  channelClass: InternalChannelClass;
  provider: string;
  titleKey: I18nMessageKey;
  shortDescriptionKey: I18nMessageKey;
  descriptionKey: I18nMessageKey;
  defaultReadiness: InternalChannelReadiness;
  defaultSortOrder: number;
};

export type PlatformChannelCatalogView = PlatformChannelCatalogDefinition & {
  titleOverrides: LocalizedTextOverrides;
  shortDescriptionOverrides: LocalizedTextOverrides;
  descriptionOverrides: LocalizedTextOverrides;
  iconAssetRef?: string;
  iconUrl?: string;
  sortOrder: number;
  visibility: InternalChannelVisibility;
  readiness: InternalChannelReadiness;
  source: "deployment_default" | "platform_override";
  updatedAt?: string;
  updatedByPlatformAdminAccountId?: string;
};

export const platformChannelCatalogDefinitions = [
  {
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    titleKey: "integrations.catalog.telegramBot.title",
    shortDescriptionKey: "integrations.catalog.telegramBot.description",
    descriptionKey: "integrations.catalog.telegramBot.description",
    defaultReadiness: "available",
    defaultSortOrder: 100
  },
  {
    channelType: "telegram_qr_bridge",
    channelClass: "user_bridge",
    provider: "telegram",
    titleKey: "integrations.catalog.telegramQr.title",
    shortDescriptionKey: "integrations.catalog.telegramQr.description",
    descriptionKey: "integrations.catalog.telegramQr.description",
    defaultReadiness: "available",
    defaultSortOrder: 200
  },
  {
    channelType: "whatsapp_qr_bridge",
    channelClass: "user_bridge",
    provider: "whatsapp",
    titleKey: "integrations.catalog.whatsappQr.title",
    shortDescriptionKey: "integrations.catalog.whatsappQr.description",
    descriptionKey: "integrations.catalog.whatsappQr.description",
    defaultReadiness: "available",
    defaultSortOrder: 300
  },
  {
    channelType: "max_bot",
    channelClass: "bot_bridge",
    provider: "max",
    titleKey: "integrations.catalog.maxBot.title",
    shortDescriptionKey: "integrations.catalog.maxBot.description",
    descriptionKey: "integrations.catalog.maxBot.description",
    defaultReadiness: "coming_soon",
    defaultSortOrder: 400
  },
  {
    channelType: "max_qr_bridge",
    channelClass: "user_bridge",
    provider: "max",
    titleKey: "integrations.catalog.maxQr.title",
    shortDescriptionKey: "integrations.catalog.maxQr.description",
    descriptionKey: "integrations.catalog.maxQr.description",
    defaultReadiness: "available",
    defaultSortOrder: 500
  },
  {
    channelType: "vk_community",
    channelClass: "official_api",
    provider: "vk",
    titleKey: "integrations.catalog.vkCommunity.title",
    shortDescriptionKey: "integrations.catalog.vkCommunity.description",
    descriptionKey: "integrations.catalog.vkCommunity.description",
    defaultReadiness: "coming_soon",
    defaultSortOrder: 600
  }
] as const satisfies readonly PlatformChannelCatalogDefinition[];

export async function loadPlatformChannelCatalog(input: {
  repository: DeploymentChannelCatalogOverrideRepository;
}): Promise<PlatformChannelCatalogView[]> {
  const overrides = await input.repository.listOverrides();
  const overridesByChannelType = new Map(
    overrides.map((override) => [override.channelType, override])
  );

  return platformChannelCatalogDefinitions
    .map((definition) =>
      viewFromDefinition({
        definition,
        override: overridesByChannelType.get(definition.channelType)
      })
    )
    .sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.channelType.localeCompare(right.channelType);
    });
}

export function buildChannelCatalogOverridePersistenceInput(input: {
  definition: PlatformChannelCatalogDefinition;
  previous?: DeploymentChannelCatalogOverrideRecord | null;
  titleOverrides: LocalizedTextOverrides;
  shortDescriptionOverrides: LocalizedTextOverrides;
  descriptionOverrides: LocalizedTextOverrides;
  iconAssetRef?: string;
  sortOrder?: number;
  visibility: InternalChannelVisibility;
  readiness?: InternalChannelReadiness;
  updatedAt: Date;
  updatedByPlatformAdminAccountId?: string;
}): DeploymentChannelCatalogOverrideRecord {
  return {
    channelType: input.definition.channelType,
    titleOverrides: input.titleOverrides,
    shortDescriptionOverrides: input.shortDescriptionOverrides,
    descriptionOverrides: input.descriptionOverrides,
    sortOrder: input.sortOrder ?? input.definition.defaultSortOrder,
    visibility: input.visibility,
    readiness: input.readiness ?? input.definition.defaultReadiness,
    updatedAt: input.updatedAt,
    ...((input.iconAssetRef ?? input.previous?.iconAssetRef)
      ? {
          iconAssetRef: input.iconAssetRef ?? input.previous?.iconAssetRef
        }
      : {}),
    ...(input.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId: input.updatedByPlatformAdminAccountId
        }
      : {})
  };
}

export function findPlatformChannelCatalogDefinition(
  channelType: InternalChannelType
): PlatformChannelCatalogDefinition {
  const definition = platformChannelCatalogDefinitions.find(
    (item) => item.channelType === channelType
  );

  if (!definition) {
    throw new Error(`Unsupported channel catalog item: ${channelType}`);
  }

  return definition;
}

export function channelIconUrl(input: {
  channelType: InternalChannelType;
  iconAssetRef: string;
}): string {
  const segments = input.iconAssetRef.split("/");
  const assetVersion = segments[segments.length - 1] ?? input.iconAssetRef;

  return `/channel-assets/${encodeURIComponent(input.channelType)}/icon?v=${encodeURIComponent(
    assetVersion
  )}`;
}

function viewFromDefinition(input: {
  definition: PlatformChannelCatalogDefinition;
  override?: DeploymentChannelCatalogOverrideRecord;
}): PlatformChannelCatalogView {
  const iconAssetRef = input.override?.iconAssetRef;

  return {
    ...input.definition,
    titleOverrides: input.override?.titleOverrides ?? {},
    shortDescriptionOverrides: input.override?.shortDescriptionOverrides ?? {},
    descriptionOverrides: input.override?.descriptionOverrides ?? {},
    ...(iconAssetRef
      ? {
          iconAssetRef,
          iconUrl: channelIconUrl({
            channelType: input.definition.channelType,
            iconAssetRef
          })
        }
      : {}),
    sortOrder: input.override?.sortOrder ?? input.definition.defaultSortOrder,
    visibility: input.override?.visibility ?? "visible",
    readiness: input.override?.readiness ?? input.definition.defaultReadiness,
    source: input.override ? "platform_override" : "deployment_default",
    ...(input.override?.updatedAt
      ? { updatedAt: input.override.updatedAt.toISOString() }
      : {}),
    ...(input.override?.updatedByPlatformAdminAccountId
      ? {
          updatedByPlatformAdminAccountId:
            input.override.updatedByPlatformAdminAccountId
        }
      : {})
  };
}
