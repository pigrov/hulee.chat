import { describe, expect, it } from "vitest";

import {
  findSourceCatalogItem,
  groupSourceCatalogItemsByCategory,
  listVisibleSourceCatalogItems,
  normalizeSourceCatalogItem,
  sourceCatalogCategoryDefinitions,
  sourceCatalogCategoryForSourceType,
  sourceCatalogItemSchema,
  sourceCatalogItems
} from "./source-catalog";

describe("source catalog", () => {
  it("defines the required source catalog categories", () => {
    expect(
      sourceCatalogCategoryDefinitions.map((item) => item.category)
    ).toEqual([
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

    expect(sourceCatalogCategoryForSourceType("messenger")).toBe("messengers");
    expect(sourceCatalogCategoryForSourceType("marketplace")).toBe(
      "marketplaces"
    );
    expect(sourceCatalogCategoryForSourceType("review")).toBe("reviews");
    expect(sourceCatalogCategoryForSourceType("form")).toBe("forms");
    expect(sourceCatalogCategoryForSourceType("email")).toBe("email");
    expect(sourceCatalogCategoryForSourceType("phone")).toBe("telephony");
    expect(sourceCatalogCategoryForSourceType("crm")).toBe("crm");
    expect(sourceCatalogCategoryForSourceType("api")).toBe("api");
  });

  it("normalizes and validates a marketplace source catalog item", () => {
    expect(
      normalizeSourceCatalogItem({
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
        authTypes: ["oauth2", "api_key"],
        accountTypes: ["shop"],
        eventTypes: ["order_question", "status_update"],
        capabilities: [
          "receive_events",
          "native_reply",
          "customer_profile",
          "analytics"
        ],
        sortOrder: 100
      })
    ).toMatchObject({
      sourceName: "ozon",
      sourceType: "marketplace",
      category: "marketplaces",
      setupMode: "source_connection"
    });
  });

  it("publishes the first MVP source catalog inventory", () => {
    expect(sourceCatalogItems.map((item) => item.sourceName)).toEqual([
      "telegram",
      "whatsapp",
      "max",
      "vk_community",
      "megapbx",
      "ozon",
      "yandex_market",
      "public_api",
      "web_form"
    ]);

    expect(findSourceCatalogItem("megapbx")).toMatchObject({
      sourceType: "phone",
      category: "telephony",
      setupMode: "source_connection"
    });
    expect(findSourceCatalogItem("ozon")).toMatchObject({
      sourceType: "marketplace",
      category: "marketplaces",
      authTypes: ["api_key"]
    });
    expect(findSourceCatalogItem("yandex_market")).toMatchObject({
      sourceType: "marketplace",
      category: "marketplaces"
    });
    expect(listVisibleSourceCatalogItems()).toHaveLength(
      sourceCatalogItems.length
    );
  });

  it("rejects catalog items when source type and category disagree", () => {
    expect(() =>
      sourceCatalogItemSchema.parse({
        sourceName: "sip_provider",
        sourceType: "phone",
        category: "messengers",
        titleKey: "sources.catalog.sip.title",
        descriptionKey: "sources.catalog.sip.description",
        readiness: "coming_soon",
        setupMode: "source_connection",
        authTypes: ["api_key"],
        accountTypes: ["phone_number"],
        eventTypes: ["call"],
        capabilities: ["receive_events", "transcription"],
        sortOrder: 10
      })
    ).toThrow();
  });

  it("groups visible catalog items by category and sorts within each category", () => {
    const grouped = groupSourceCatalogItemsByCategory([
      {
        sourceName: "telegram",
        sourceType: "messenger",
        category: "messengers",
        provider: "telegram",
        titleKey: "sources.catalog.telegram.title",
        descriptionKey: "sources.catalog.telegram.description",
        readiness: "available",
        visibility: "visible",
        setupMode: "channel_connector",
        supportsMultipleAccounts: true,
        authTypes: ["token"],
        accountTypes: ["bot", "user_session"],
        eventTypes: ["message"],
        capabilities: ["receive_events", "native_reply"],
        sortOrder: 200,
        channelTypes: ["telegram_bot", "telegram_qr_bridge"]
      },
      {
        sourceName: "email",
        sourceType: "email",
        category: "email",
        titleKey: "sources.catalog.email.title",
        descriptionKey: "sources.catalog.email.description",
        readiness: "coming_soon",
        visibility: "visible",
        setupMode: "source_connection",
        supportsMultipleAccounts: true,
        authTypes: ["imap"],
        accountTypes: ["mailbox"],
        eventTypes: ["message"],
        capabilities: ["receive_events", "native_reply"],
        sortOrder: 100
      },
      {
        sourceName: "whatsapp",
        sourceType: "messenger",
        category: "messengers",
        provider: "whatsapp",
        titleKey: "sources.catalog.whatsapp.title",
        descriptionKey: "sources.catalog.whatsapp.description",
        readiness: "available",
        visibility: "visible",
        setupMode: "channel_connector",
        supportsMultipleAccounts: true,
        authTypes: ["custom"],
        accountTypes: ["user_session"],
        eventTypes: ["message"],
        capabilities: ["receive_events", "native_reply"],
        sortOrder: 100,
        channelTypes: ["whatsapp_qr_bridge"]
      }
    ]);

    expect(grouped.messengers?.map((item) => item.sourceName)).toEqual([
      "whatsapp",
      "telegram"
    ]);
    expect(grouped.email?.map((item) => item.sourceName)).toEqual(["email"]);
  });
});
