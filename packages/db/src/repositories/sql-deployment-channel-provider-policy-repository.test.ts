import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildFindDeploymentChannelProviderPolicySql,
  buildListDeploymentChannelProviderPoliciesSql,
  buildUpsertDeploymentChannelProviderPolicySql,
  createSqlDeploymentChannelProviderPolicyRepository
} from "./sql-deployment-channel-provider-policy-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL deployment channel provider policy repository", () => {
  it("maps channel provider policies from rows", async () => {
    const repository = createSqlDeploymentChannelProviderPolicyRepository(
      new RecordingSqlExecutor([
        {
          provider: "telegram",
          channel_type: "telegram_bot",
          inbound_mode: "polling",
          outbound_enabled: true,
          updated_at: "2026-06-30T12:00:00.000Z",
          updated_by_platform_admin_account_id: "platform-admin-1"
        }
      ])
    );

    await expect(repository.listPolicies()).resolves.toEqual([
      {
        provider: "telegram",
        channelType: "telegram_bot",
        inboundMode: "polling",
        outboundEnabled: true,
        updatedAt: new Date("2026-06-30T12:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      }
    ]);
  });

  it("builds list, find and upsert SQL", () => {
    expect(sqlText(buildListDeploymentChannelProviderPoliciesSql())).toContain(
      "from deployment_channel_provider_policies"
    );
    expect(
      sqlText(
        buildFindDeploymentChannelProviderPolicySql({
          provider: "telegram",
          channelType: "telegram_bot"
        })
      )
    ).toContain("where provider =");

    const upsert = sqlText(
      buildUpsertDeploymentChannelProviderPolicySql({
        provider: "telegram",
        channelType: "telegram_bot",
        inboundMode: "polling",
        outboundEnabled: true,
        updatedAt: new Date("2026-06-30T12:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    );

    expect(upsert).toContain(
      "insert into deployment_channel_provider_policies"
    );
    expect(upsert).toContain("on conflict (provider, channel_type) do update");
  });

  it("does not inline provider secrets into generated SQL", () => {
    const query = String(
      buildUpsertDeploymentChannelProviderPolicySql({
        provider: "telegram",
        channelType: "telegram_bot",
        inboundMode: "webhook",
        outboundEnabled: true,
        updatedAt: new Date("2026-06-30T12:00:00.000Z")
      })
    );

    expect(query).not.toContain("NORDVPN_TOKEN");
    expect(query).not.toContain("OPENVPN_PASSWORD");
    expect(query).not.toContain("bot-token");
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
