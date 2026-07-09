import { z } from "zod";

import type {
  SourceAccountType,
  SourceAuthType,
  SourceEventType,
  SourceType
} from "./index";

export const sourceCatalogCategorySchema = z.enum([
  "messengers",
  "social",
  "marketplaces",
  "classifieds",
  "reviews",
  "forms",
  "email",
  "telephony",
  "crm",
  "api",
  "internal"
]);

export const sourceCatalogReadinessSchema = z.enum([
  "available",
  "coming_soon",
  "disabled"
]);

export const sourceCatalogVisibilitySchema = z.enum(["visible", "hidden"]);

export const sourceCatalogSetupModeSchema = z.enum([
  "channel_connector",
  "source_connection",
  "public_api",
  "manual"
]);

export const sourceCatalogCapabilitySchema = z.enum([
  "receive_events",
  "native_reply",
  "external_reply",
  "file_receive",
  "file_send",
  "history_fetch",
  "threading",
  "reactions",
  "read_status",
  "delivery_status",
  "customer_profile",
  "webhook_delivery",
  "polling_runtime",
  "oauth",
  "api_keys",
  "transcription",
  "analytics"
]);

export const sourceCatalogCategoryDefinitionSchema = z
  .object({
    category: sourceCatalogCategorySchema,
    titleKey: z.string().trim().min(1).max(140),
    descriptionKey: z.string().trim().min(1).max(180),
    sourceTypes: z.array(sourceTypeSchema()).min(1).max(4),
    sortOrder: z.number().int().min(0).max(10_000),
    defaultCapabilities: z.array(sourceCatalogCapabilitySchema).max(20)
  })
  .strict();

export const sourceCatalogItemSchema = z
  .object({
    sourceName: z.string().trim().min(1).max(120),
    sourceType: sourceTypeSchema(),
    category: sourceCatalogCategorySchema,
    provider: z.string().trim().min(1).max(80).optional(),
    titleKey: z.string().trim().min(1).max(140),
    shortDescriptionKey: z.string().trim().min(1).max(180).optional(),
    descriptionKey: z.string().trim().min(1).max(180),
    readiness: sourceCatalogReadinessSchema,
    visibility: sourceCatalogVisibilitySchema.default("visible"),
    setupMode: sourceCatalogSetupModeSchema,
    supportsMultipleAccounts: z.boolean().default(true),
    authTypes: z.array(sourceAuthTypeSchema()).min(1).max(8),
    accountTypes: z.array(sourceAccountTypeSchema()).min(1).max(8),
    eventTypes: z.array(sourceEventTypeSchema()).min(1).max(12),
    capabilities: z.array(sourceCatalogCapabilitySchema).max(24),
    sortOrder: z.number().int().min(0).max(100_000),
    channelTypes: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
    metadata: z.record(z.string(), z.unknown()).optional()
  })
  .strict()
  .refine(
    (value) => sourceTypeBelongsToCategory(value.sourceType, value.category),
    {
      message: "Source catalog item sourceType does not match category."
    }
  );

export type SourceCatalogCategory = z.infer<typeof sourceCatalogCategorySchema>;

export type SourceCatalogReadiness = z.infer<
  typeof sourceCatalogReadinessSchema
>;

export type SourceCatalogVisibility = z.infer<
  typeof sourceCatalogVisibilitySchema
>;

export type SourceCatalogSetupMode = z.infer<
  typeof sourceCatalogSetupModeSchema
>;

export type SourceCatalogCapability = z.infer<
  typeof sourceCatalogCapabilitySchema
>;

export type SourceCatalogCategoryDefinition = z.infer<
  typeof sourceCatalogCategoryDefinitionSchema
>;

export type SourceCatalogItem = z.infer<typeof sourceCatalogItemSchema>;

export const sourceCatalogCategoryDefinitions: SourceCatalogCategoryDefinition[] =
  [
    {
      category: "messengers",
      titleKey: "sources.categories.messengers.title",
      descriptionKey: "sources.categories.messengers.description",
      sourceTypes: ["messenger"],
      sortOrder: 100,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "file_receive",
        "file_send",
        "threading"
      ]
    },
    {
      category: "social",
      titleKey: "sources.categories.social.title",
      descriptionKey: "sources.categories.social.description",
      sourceTypes: ["social"],
      sortOrder: 200,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "external_reply",
        "threading",
        "reactions"
      ]
    },
    {
      category: "marketplaces",
      titleKey: "sources.categories.marketplaces.title",
      descriptionKey: "sources.categories.marketplaces.description",
      sourceTypes: ["marketplace"],
      sortOrder: 300,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "external_reply",
        "customer_profile",
        "analytics"
      ]
    },
    {
      category: "classifieds",
      titleKey: "sources.categories.classifieds.title",
      descriptionKey: "sources.categories.classifieds.description",
      sourceTypes: ["classified"],
      sortOrder: 400,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "external_reply",
        "customer_profile"
      ]
    },
    {
      category: "reviews",
      titleKey: "sources.categories.reviews.title",
      descriptionKey: "sources.categories.reviews.description",
      sourceTypes: ["review"],
      sortOrder: 500,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "external_reply",
        "analytics"
      ]
    },
    {
      category: "forms",
      titleKey: "sources.categories.forms.title",
      descriptionKey: "sources.categories.forms.description",
      sourceTypes: ["form"],
      sortOrder: 600,
      defaultCapabilities: ["receive_events", "webhook_delivery"]
    },
    {
      category: "email",
      titleKey: "sources.categories.email.title",
      descriptionKey: "sources.categories.email.description",
      sourceTypes: ["email"],
      sortOrder: 700,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "file_receive",
        "file_send",
        "threading"
      ]
    },
    {
      category: "telephony",
      titleKey: "sources.categories.telephony.title",
      descriptionKey: "sources.categories.telephony.description",
      sourceTypes: ["phone"],
      sortOrder: 800,
      defaultCapabilities: [
        "receive_events",
        "history_fetch",
        "transcription",
        "analytics"
      ]
    },
    {
      category: "crm",
      titleKey: "sources.categories.crm.title",
      descriptionKey: "sources.categories.crm.description",
      sourceTypes: ["crm"],
      sortOrder: 900,
      defaultCapabilities: [
        "receive_events",
        "webhook_delivery",
        "customer_profile",
        "analytics"
      ]
    },
    {
      category: "api",
      titleKey: "sources.categories.api.title",
      descriptionKey: "sources.categories.api.description",
      sourceTypes: ["api"],
      sortOrder: 1000,
      defaultCapabilities: [
        "receive_events",
        "native_reply",
        "webhook_delivery",
        "api_keys"
      ]
    },
    {
      category: "internal",
      titleKey: "sources.categories.internal.title",
      descriptionKey: "sources.categories.internal.description",
      sourceTypes: ["internal"],
      sortOrder: 1100,
      defaultCapabilities: ["receive_events", "native_reply"]
    }
  ];

const sourceCatalogItemDefinitions = [
  {
    sourceName: "telegram",
    sourceType: "messenger",
    category: "messengers",
    provider: "telegram",
    titleKey: "sources.catalog.telegram.title",
    shortDescriptionKey: "sources.catalog.telegram.shortDescription",
    descriptionKey: "sources.catalog.telegram.description",
    readiness: "available",
    visibility: "visible",
    setupMode: "channel_connector",
    supportsMultipleAccounts: true,
    authTypes: ["token", "custom"],
    accountTypes: ["bot", "user_session"],
    eventTypes: ["message", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "file_receive",
      "file_send",
      "threading",
      "delivery_status",
      "polling_runtime"
    ],
    sortOrder: 100,
    channelTypes: ["telegram_bot", "telegram_qr_bridge"]
  },
  {
    sourceName: "whatsapp",
    sourceType: "messenger",
    category: "messengers",
    provider: "whatsapp",
    titleKey: "sources.catalog.whatsapp.title",
    shortDescriptionKey: "sources.catalog.whatsapp.shortDescription",
    descriptionKey: "sources.catalog.whatsapp.description",
    readiness: "available",
    visibility: "visible",
    setupMode: "channel_connector",
    supportsMultipleAccounts: true,
    authTypes: ["custom"],
    accountTypes: ["user_session"],
    eventTypes: ["message", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "file_receive",
      "file_send",
      "threading",
      "delivery_status",
      "polling_runtime"
    ],
    sortOrder: 110,
    channelTypes: ["whatsapp_qr_bridge"]
  },
  {
    sourceName: "max",
    sourceType: "messenger",
    category: "messengers",
    provider: "max",
    titleKey: "sources.catalog.max.title",
    shortDescriptionKey: "sources.catalog.max.shortDescription",
    descriptionKey: "sources.catalog.max.description",
    readiness: "available",
    visibility: "visible",
    setupMode: "channel_connector",
    supportsMultipleAccounts: true,
    authTypes: ["custom"],
    accountTypes: ["bot", "user_session"],
    eventTypes: ["message", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "file_receive",
      "file_send",
      "threading",
      "delivery_status",
      "polling_runtime"
    ],
    sortOrder: 120,
    channelTypes: ["max_bot", "max_qr_bridge"]
  },
  {
    sourceName: "vk_community",
    sourceType: "social",
    category: "social",
    provider: "vk",
    titleKey: "sources.catalog.vkCommunity.title",
    shortDescriptionKey: "sources.catalog.vkCommunity.shortDescription",
    descriptionKey: "sources.catalog.vkCommunity.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "channel_connector",
    supportsMultipleAccounts: true,
    authTypes: ["token", "oauth2"],
    accountTypes: ["group"],
    eventTypes: ["message", "comment", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "external_reply",
      "file_receive",
      "threading"
    ],
    sortOrder: 200,
    channelTypes: ["vk_community"]
  },
  {
    sourceName: "megapbx",
    sourceType: "phone",
    category: "telephony",
    provider: "megapbx",
    titleKey: "sources.catalog.megapbx.title",
    shortDescriptionKey: "sources.catalog.megapbx.shortDescription",
    descriptionKey: "sources.catalog.megapbx.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "source_connection",
    supportsMultipleAccounts: true,
    authTypes: ["api_key", "webhook_secret"],
    accountTypes: ["phone_number"],
    eventTypes: ["call", "status_update"],
    capabilities: [
      "receive_events",
      "history_fetch",
      "webhook_delivery",
      "transcription",
      "analytics"
    ],
    sortOrder: 800
  },
  {
    sourceName: "ozon",
    sourceType: "marketplace",
    category: "marketplaces",
    provider: "ozon",
    titleKey: "sources.catalog.ozon.title",
    shortDescriptionKey: "sources.catalog.ozon.shortDescription",
    descriptionKey: "sources.catalog.ozon.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "source_connection",
    supportsMultipleAccounts: true,
    authTypes: ["api_key"],
    accountTypes: ["shop"],
    eventTypes: ["order_question", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "external_reply",
      "customer_profile",
      "analytics"
    ],
    sortOrder: 300
  },
  {
    sourceName: "yandex_market",
    sourceType: "marketplace",
    category: "marketplaces",
    provider: "yandex_market",
    titleKey: "sources.catalog.yandexMarket.title",
    shortDescriptionKey: "sources.catalog.yandexMarket.shortDescription",
    descriptionKey: "sources.catalog.yandexMarket.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "source_connection",
    supportsMultipleAccounts: true,
    authTypes: ["api_key", "oauth2"],
    accountTypes: ["shop"],
    eventTypes: ["order_question", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "external_reply",
      "customer_profile",
      "analytics"
    ],
    sortOrder: 310
  },
  {
    sourceName: "public_api",
    sourceType: "api",
    category: "api",
    provider: "hulee",
    titleKey: "sources.catalog.publicApi.title",
    shortDescriptionKey: "sources.catalog.publicApi.shortDescription",
    descriptionKey: "sources.catalog.publicApi.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "public_api",
    supportsMultipleAccounts: true,
    authTypes: ["api_key", "webhook_secret"],
    accountTypes: ["custom"],
    eventTypes: ["message", "lead", "system", "status_update"],
    capabilities: [
      "receive_events",
      "native_reply",
      "webhook_delivery",
      "api_keys",
      "analytics"
    ],
    sortOrder: 1000
  },
  {
    sourceName: "web_form",
    sourceType: "form",
    category: "forms",
    provider: "hulee",
    titleKey: "sources.catalog.webForm.title",
    shortDescriptionKey: "sources.catalog.webForm.shortDescription",
    descriptionKey: "sources.catalog.webForm.description",
    readiness: "coming_soon",
    visibility: "visible",
    setupMode: "source_connection",
    supportsMultipleAccounts: true,
    authTypes: ["webhook_secret"],
    accountTypes: ["site"],
    eventTypes: ["lead", "status_update"],
    capabilities: ["receive_events", "webhook_delivery", "analytics"],
    sortOrder: 600
  }
] satisfies SourceCatalogItem[];

export const sourceCatalogItems: SourceCatalogItem[] =
  sourceCatalogItemDefinitions.map(normalizeSourceCatalogItem);

export function listVisibleSourceCatalogItems(): SourceCatalogItem[] {
  return sourceCatalogItems.filter((item) => item.visibility === "visible");
}

export function findSourceCatalogItem(
  sourceName: string
): SourceCatalogItem | undefined {
  return sourceCatalogItems.find((item) => item.sourceName === sourceName);
}

export function sourceCatalogCategoryForSourceType(
  sourceType: SourceType | string
): SourceCatalogCategory {
  const definition = sourceCatalogCategoryDefinitions.find((category) =>
    category.sourceTypes.includes(sourceType as SourceType)
  );

  if (!definition) {
    throw new Error(`Unsupported source type: ${sourceType}`);
  }

  return definition.category;
}

export function normalizeSourceCatalogItem(
  input: SourceCatalogItem
): SourceCatalogItem {
  return sourceCatalogItemSchema.parse({
    ...input,
    category:
      input.category ?? sourceCatalogCategoryForSourceType(input.sourceType)
  });
}

export function groupSourceCatalogItemsByCategory(
  items: readonly SourceCatalogItem[]
): Partial<Record<SourceCatalogCategory, SourceCatalogItem[]>> {
  const grouped: Partial<Record<SourceCatalogCategory, SourceCatalogItem[]>> =
    {};

  for (const item of items.map(normalizeSourceCatalogItem)) {
    const categoryItems = grouped[item.category] ?? [];
    categoryItems.push(item);
    grouped[item.category] = categoryItems;
  }

  for (const categoryItems of Object.values(grouped)) {
    categoryItems.sort((left, right) => {
      if (left.sortOrder !== right.sortOrder) {
        return left.sortOrder - right.sortOrder;
      }

      return left.sourceName.localeCompare(right.sourceName);
    });
  }

  return grouped;
}

export function sourceTypeBelongsToCategory(
  sourceType: SourceType | string,
  category: SourceCatalogCategory
): boolean {
  const definition = sourceCatalogCategoryDefinitions.find(
    (item) => item.category === category
  );

  return definition
    ? definition.sourceTypes.includes(sourceType as SourceType)
    : false;
}

function sourceTypeSchema() {
  return z.enum([
    "messenger",
    "social",
    "marketplace",
    "classified",
    "review",
    "email",
    "phone",
    "form",
    "internal",
    "crm",
    "api"
  ] satisfies [SourceType, ...SourceType[]]);
}

function sourceAuthTypeSchema() {
  return z.enum([
    "oauth2",
    "api_key",
    "token",
    "basic",
    "imap",
    "webhook_secret",
    "custom"
  ] satisfies [SourceAuthType, ...SourceAuthType[]]);
}

function sourceAccountTypeSchema() {
  return z.enum([
    "bot",
    "user_session",
    "group",
    "shop",
    "branch",
    "mailbox",
    "phone_number",
    "ad_account",
    "site",
    "custom"
  ] satisfies [SourceAccountType, ...SourceAccountType[]]);
}

function sourceEventTypeSchema() {
  return z.enum([
    "message",
    "comment",
    "review",
    "lead",
    "call",
    "order_question",
    "system",
    "status_update"
  ] satisfies [SourceEventType, ...SourceEventType[]]);
}
