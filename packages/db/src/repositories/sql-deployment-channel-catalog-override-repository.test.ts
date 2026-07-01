import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildFindDeploymentChannelCatalogOverrideSql,
  buildListDeploymentChannelCatalogOverridesSql,
  buildUpsertDeploymentChannelCatalogOverrideSql,
  createSqlDeploymentChannelCatalogOverrideRepository
} from "./sql-deployment-channel-catalog-override-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL deployment channel catalog override repository", () => {
  it("maps catalog override rows", async () => {
    const repository = createSqlDeploymentChannelCatalogOverrideRepository(
      new RecordingSqlExecutor([
        {
          channel_type: "telegram_bot",
          title_overrides: {
            ru: "Telegram",
            en: "Telegram"
          },
          short_description_overrides: {
            ru: "Bot"
          },
          description_overrides: {
            ru: "Bot channel"
          },
          icon_asset_ref: "deployment/channel-icons/telegram_bot/hash.webp",
          sort_order: 10,
          visibility: "visible",
          readiness: "available",
          updated_at: "2026-06-30T13:00:00.000Z",
          updated_by_platform_admin_account_id: "platform-admin-1"
        }
      ])
    );

    await expect(repository.listOverrides()).resolves.toEqual([
      {
        channelType: "telegram_bot",
        titleOverrides: {
          ru: "Telegram",
          en: "Telegram"
        },
        shortDescriptionOverrides: {
          ru: "Bot"
        },
        descriptionOverrides: {
          ru: "Bot channel"
        },
        iconAssetRef: "deployment/channel-icons/telegram_bot/hash.webp",
        sortOrder: 10,
        visibility: "visible",
        readiness: "available",
        updatedAt: new Date("2026-06-30T13:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      }
    ]);
  });

  it("builds list, find and upsert SQL", () => {
    expect(sqlText(buildListDeploymentChannelCatalogOverridesSql())).toContain(
      "from deployment_channel_catalog_overrides"
    );
    expect(
      sqlText(buildFindDeploymentChannelCatalogOverrideSql("telegram_bot"))
    ).toContain("where channel_type =");

    const upsert = sqlText(
      buildUpsertDeploymentChannelCatalogOverrideSql({
        channelType: "telegram_bot",
        titleOverrides: {
          ru: "Telegram"
        },
        shortDescriptionOverrides: {
          ru: "Bot"
        },
        descriptionOverrides: {},
        iconAssetRef: "deployment/channel-icons/telegram_bot/hash.png",
        sortOrder: 1,
        visibility: "visible",
        readiness: "available",
        updatedAt: new Date("2026-06-30T13:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    );

    expect(upsert).toContain(
      "insert into deployment_channel_catalog_overrides"
    );
    expect(upsert).toContain("on conflict (channel_type) do update");
  });

  it("does not inline uploaded binary content or provider secrets into SQL", () => {
    const query = String(
      buildUpsertDeploymentChannelCatalogOverrideSql({
        channelType: "telegram_bot",
        titleOverrides: {
          ru: "Telegram"
        },
        shortDescriptionOverrides: {},
        descriptionOverrides: {},
        sortOrder: 1,
        visibility: "visible",
        updatedAt: new Date("2026-06-30T13:00:00.000Z")
      })
    );

    expect(query).not.toContain("NORDVPN_TOKEN");
    expect(query).not.toContain("OPENVPN_PASSWORD");
    expect(query).not.toContain("image-binary");
  });
});

class RecordingSqlExecutor implements RawSqlExecutor {
  readonly queries: SQL[] = [];

  constructor(private readonly rows: readonly Record<string, unknown>[]) {}

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.queries.push(query);

    return {
      rows: this.rows as readonly Row[]
    };
  }
}

function sqlText(query: SQL): string {
  return new PgDialect().sqlToQuery(query).sql;
}
