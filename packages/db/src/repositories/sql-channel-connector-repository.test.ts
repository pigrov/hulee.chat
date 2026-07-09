import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  TenantId
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

import {
  buildFindActiveChannelConnectorByConfigStringSql,
  buildFindActiveChannelConnectorByExternalIdSql,
  buildUpsertChannelConnectorSql,
  createSqlChannelConnectorRepository
} from "./sql-channel-connector-repository";

const tenantId = "tenant_channel_connector" as TenantId;
const connectorId =
  "telegram_bot:tenant_channel_connector" as ChannelConnectorId;

describe("SQL channel connector repository", () => {
  it("maps channel connector records with tenant and channel metadata", async () => {
    const executor = new RecordingSqlExecutor([createConnectorRow()]);
    const repository = createSqlChannelConnectorRepository(executor);

    await expect(
      repository.findConnector({
        tenantId,
        connectorId
      })
    ).resolves.toEqual({
      id: connectorId,
      tenantId,
      channelType: "telegram_bot",
      channelClass: "bot_bridge",
      provider: "telegram",
      displayName: "Telegram Bot",
      status: "connected",
      healthStatus: "healthy",
      capabilities: {
        inbound: true
      },
      onboardingState: {},
      config: {
        channelExternalId: "telegram-local",
        webhookConnectorId: "tgwh_test",
        botTokenSecretRef: "secret-ref"
      },
      diagnostics: {
        status: "configured"
      },
      sourceConnectionId: null,
      createdByEmployeeId: null,
      createdAt: new Date("2026-06-22T10:00:00.000Z"),
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("finds active connectors by JSON config fields", async () => {
    const executor = new RecordingSqlExecutor([createConnectorRow()]);
    const repository = createSqlChannelConnectorRepository(executor);

    await expect(
      repository.findActiveConnectorByConfigString({
        channelType: "telegram_bot",
        configKey: "webhookConnectorId",
        configValue: "tgwh_test"
      })
    ).resolves.toMatchObject({
      id: connectorId,
      tenantId,
      config: {
        webhookConnectorId: "tgwh_test"
      }
    });
  });

  it("finds active connectors by tenant and channel external id", async () => {
    const executor = new RecordingSqlExecutor([createConnectorRow()]);
    const repository = createSqlChannelConnectorRepository(executor);

    await expect(
      repository.findActiveConnectorByExternalId({
        tenantId,
        channelType: "telegram_bot",
        channelExternalId: "telegram-local"
      })
    ).resolves.toMatchObject({
      id: connectorId,
      tenantId,
      config: {
        channelExternalId: "telegram-local"
      }
    });
  });

  it("builds active connector lookups that require a unique connected or degraded match", () => {
    const webhookQuery = sqlText(
      buildFindActiveChannelConnectorByConfigStringSql({
        channelType: "telegram_bot",
        configKey: "webhookConnectorId",
        configValue: "tgwh_test"
      })
    );
    const externalIdQuery = sqlText(
      buildFindActiveChannelConnectorByExternalIdSql({
        tenantId,
        channelType: "telegram_bot",
        channelExternalId: "telegram-local"
      })
    );

    expect(webhookQuery).toContain("status in ('connected', 'degraded')");
    expect(webhookQuery).toContain("count(*) over () as match_count");
    expect(webhookQuery).toContain("where match_count = 1");
    expect(externalIdQuery).toContain("tenant_id = $1");
    expect(externalIdQuery).toContain("config ->> 'channelExternalId' = $3");
    expect(externalIdQuery).toContain("where match_count = 1");
  });

  it("lists tenant connectors without exposing deleted records by default", async () => {
    const executor = new RecordingSqlExecutor([createConnectorRow()]);
    const repository = createSqlChannelConnectorRepository(executor);

    await expect(
      repository.listTenantConnectors({
        tenantId,
        limit: 20
      })
    ).resolves.toEqual([
      expect.objectContaining({
        id: connectorId,
        tenantId,
        channelType: "telegram_bot"
      })
    ]);
    expect(executor.queries).toHaveLength(1);
  });

  it("upserts connector config and diagnostics without raw provider secrets", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlChannelConnectorRepository(executor);

    await repository.upsertConnector({
      id: connectorId,
      tenantId,
      channelType: "telegram_bot" as ChannelType,
      channelClass: "bot_bridge" as ChannelClass,
      provider: "telegram",
      displayName: "Telegram Bot",
      status: "connected" as ChannelConnectorStatus,
      healthStatus: "healthy" as ChannelConnectorHealthStatus,
      config: {
        channelExternalId: "telegram-local",
        botTokenSecretRef: "secret-ref"
      },
      diagnostics: {
        status: "configured"
      },
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
    expect(String(executor.queries[0])).not.toContain("telegram-token");
  });

  it("keeps existing source connection link when updates omit it", () => {
    const query = sqlText(
      buildUpsertChannelConnectorSql({
        id: connectorId,
        tenantId,
        channelType: "telegram_bot" as ChannelType,
        channelClass: "bot_bridge" as ChannelClass,
        provider: "telegram",
        displayName: "Telegram Bot",
        status: "connected" as ChannelConnectorStatus,
        healthStatus: "healthy" as ChannelConnectorHealthStatus,
        updatedAt: new Date("2026-06-22T10:00:00.000Z")
      })
    );

    expect(query).toContain("source_connection_id = coalesce");
    expect(query).toContain("channel_connectors.source_connection_id");
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

function createConnectorRow(): Record<string, unknown> {
  return {
    id: connectorId,
    tenant_id: tenantId,
    channel_type: "telegram_bot",
    channel_class: "bot_bridge",
    provider: "telegram",
    display_name: "Telegram Bot",
    status: "connected",
    health_status: "healthy",
    capabilities: {
      inbound: true
    },
    onboarding_state: {},
    config: {
      channelExternalId: "telegram-local",
      webhookConnectorId: "tgwh_test",
      botTokenSecretRef: "secret-ref"
    },
    diagnostics: {
      status: "configured"
    },
    source_connection_id: null,
    created_by_employee_id: null,
    created_at: "2026-06-22T10:00:00.000Z",
    updated_at: "2026-06-22T10:00:00.000Z"
  };
}
