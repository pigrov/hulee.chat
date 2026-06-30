import type {
  DeploymentChannelCatalogOverrideRecord,
  DeploymentChannelCatalogOverrideRepository,
  UpsertDeploymentChannelCatalogOverrideInput
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  buildChannelCatalogOverridePersistenceInput,
  channelIconUrl,
  findPlatformChannelCatalogDefinition,
  loadPlatformChannelCatalog
} from "./platform-channel-catalog";

describe("platform channel catalog", () => {
  it("loads deployment defaults for every channel", async () => {
    const catalog = await loadPlatformChannelCatalog({
      repository: fakeOverrideRepository([])
    });

    expect(catalog).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          channelType: "telegram_bot",
          sortOrder: 100,
          visibility: "visible",
          readiness: "available",
          source: "deployment_default"
        }),
        expect.objectContaining({
          channelType: "whatsapp_qr_bridge",
          readiness: "coming_soon"
        })
      ])
    );
  });

  it("applies stored presentation overrides", async () => {
    const catalog = await loadPlatformChannelCatalog({
      repository: fakeOverrideRepository([
        {
          channelType: "telegram_bot",
          titleOverrides: {
            ru: "Telegram"
          },
          descriptionOverrides: {
            ru: "Bot"
          },
          iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
          sortOrder: 5,
          visibility: "hidden",
          readiness: "disabled",
          updatedAt: new Date("2026-06-30T13:00:00.000Z"),
          updatedByPlatformAdminAccountId: "platform-admin-1"
        }
      ])
    });

    expect(catalog[0]).toMatchObject({
      channelType: "telegram_bot",
      titleOverrides: {
        ru: "Telegram"
      },
      iconUrl: "/channel-assets/telegram_bot/icon?v=hash.webp",
      sortOrder: 5,
      visibility: "hidden",
      readiness: "disabled",
      source: "platform_override",
      updatedAt: "2026-06-30T13:00:00.000Z"
    });
  });

  it("builds persistence input preserving the previous icon when metadata changes", () => {
    const definition = findPlatformChannelCatalogDefinition("telegram_bot");
    const input = buildChannelCatalogOverridePersistenceInput({
      definition,
      previous: {
        channelType: "telegram_bot",
        titleOverrides: {},
        descriptionOverrides: {},
        iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
        visibility: "visible",
        updatedAt: new Date("2026-06-30T12:00:00.000Z")
      },
      titleOverrides: {
        ru: "Telegram"
      },
      descriptionOverrides: {},
      sortOrder: 10,
      visibility: "visible",
      readiness: "available",
      updatedAt: new Date("2026-06-30T13:00:00.000Z")
    });

    expect(input).toMatchObject({
      channelType: "telegram_bot",
      iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
      sortOrder: 10
    });
  });

  it("builds stable channel icon URLs without exposing storage credentials", () => {
    const url = channelIconUrl({
      channelType: "telegram_bot",
      iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp"
    });

    expect(url).toBe("/channel-assets/telegram_bot/icon?v=hash.webp");
    expect(url).not.toContain("storage-access");
    expect(url).not.toContain("secret");
  });
});

function fakeOverrideRepository(
  overrides: readonly DeploymentChannelCatalogOverrideRecord[]
): DeploymentChannelCatalogOverrideRepository {
  return {
    async listOverrides() {
      return [...overrides];
    },
    async findOverride(channelType) {
      return (
        overrides.find((override) => override.channelType === channelType) ??
        null
      );
    },
    async upsertOverride(_input: UpsertDeploymentChannelCatalogOverrideInput) {
      return undefined;
    }
  };
}
