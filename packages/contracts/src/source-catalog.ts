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
