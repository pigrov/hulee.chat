import { describe, expect, it } from "vitest";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

import {
  buildFindDeploymentEgressProviderPolicySql,
  buildListDeploymentEgressProviderPoliciesSql,
  buildUpsertDeploymentEgressProviderPolicySql,
  createSqlDeploymentEgressProviderPolicyRepository
} from "./sql-deployment-egress-provider-policy-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

describe("SQL deployment egress provider policy repository", () => {
  it("maps provider policies from rows", async () => {
    const repository = createSqlDeploymentEgressProviderPolicyRepository(
      new RecordingSqlExecutor([
        {
          provider: "telegram",
          routing_mode: "vpn_namespace",
          profile_id: "hulee_chat_vpn_gateway",
          required: true,
          supported_channel_types: ["telegram_bot", "telegram_qr_bridge"],
          allowed_profile_kinds: [
            "vpn_namespace",
            "http_proxy",
            "socks_proxy",
            "customer_network"
          ],
          updated_at: "2026-06-29T16:00:00.000Z",
          updated_by_platform_admin_account_id: "platform-admin-1"
        }
      ])
    );

    await expect(repository.listPolicies()).resolves.toEqual([
      {
        provider: "telegram",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        required: true,
        supportedChannelTypes: ["telegram_bot", "telegram_qr_bridge"],
        allowedProfileKinds: [
          "vpn_namespace",
          "http_proxy",
          "socks_proxy",
          "customer_network"
        ],
        updatedAt: new Date("2026-06-29T16:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      }
    ]);
  });

  it("builds list, find and upsert SQL", () => {
    expect(sqlText(buildListDeploymentEgressProviderPoliciesSql())).toContain(
      "from deployment_egress_provider_policies"
    );
    expect(
      sqlText(buildFindDeploymentEgressProviderPolicySql("telegram"))
    ).toContain("where provider =");

    const upsert = sqlText(
      buildUpsertDeploymentEgressProviderPolicySql({
        provider: "whatsapp",
        routingMode: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        required: true,
        supportedChannelTypes: ["whatsapp_qr_bridge"],
        allowedProfileKinds: ["vpn_namespace", "customer_network"],
        updatedAt: new Date("2026-06-29T16:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
      })
    );

    expect(upsert).toContain("insert into deployment_egress_provider_policies");
    expect(upsert).toContain("on conflict (provider) do update");
  });

  it("does not inline provider secrets into generated SQL", () => {
    const query = String(
      buildUpsertDeploymentEgressProviderPolicySql({
        provider: "telegram",
        routingMode: "http_proxy",
        profileId: "deployment:http_proxy",
        required: true,
        supportedChannelTypes: ["telegram_bot"],
        allowedProfileKinds: ["http_proxy"],
        updatedAt: new Date("2026-06-29T16:00:00.000Z"),
        updatedByPlatformAdminAccountId: "platform-admin-1"
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
