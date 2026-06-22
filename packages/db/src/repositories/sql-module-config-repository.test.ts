import type { TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";
import { createSqlTenantModuleConfigRepository } from "./sql-module-config-repository";

const tenantId = "tenant_module_config" as TenantId;

describe("SQL tenant module config repository", () => {
  it("maps tenant module config regardless of enabled state", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        module_id: "channel-telegram",
        enabled: false,
        config: {
          channelExternalId: "telegram-local"
        },
        diagnostics: {
          status: "disabled"
        }
      }
    ]);
    const repository = createSqlTenantModuleConfigRepository(executor);

    await expect(
      repository.findConfig({
        tenantId,
        moduleId: "channel-telegram"
      })
    ).resolves.toEqual({
      tenantId,
      moduleId: "channel-telegram",
      enabled: false,
      config: {
        channelExternalId: "telegram-local"
      },
      diagnostics: {
        status: "disabled"
      }
    });
  });

  it("maps enabled tenant module config without exposing secrets", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        module_id: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN"
        },
        diagnostics: {}
      }
    ]);
    const repository = createSqlTenantModuleConfigRepository(executor);

    await expect(
      repository.findEnabledConfig({
        tenantId,
        moduleId: "channel-telegram"
      })
    ).resolves.toEqual({
      tenantId,
      moduleId: "channel-telegram",
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN"
      },
      diagnostics: {}
    });
    expect(executor.queries).toHaveLength(1);
  });

  it("returns null when no enabled module config exists", async () => {
    const repository = createSqlTenantModuleConfigRepository(
      new RecordingSqlExecutor([])
    );

    await expect(
      repository.findEnabledConfig({
        tenantId,
        moduleId: "channel-telegram"
      })
    ).resolves.toBeNull();
  });

  it("lists enabled tenant module configs by module id", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        module_id: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local"
        },
        diagnostics: {}
      }
    ]);
    const repository = createSqlTenantModuleConfigRepository(executor);

    await expect(
      repository.listEnabledConfigs({
        moduleId: "channel-telegram",
        limit: 10
      })
    ).resolves.toEqual([
      {
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local"
        },
        diagnostics: {}
      }
    ]);
    expect(executor.queries).toHaveLength(1);
  });

  it("upserts tenant-scoped module config and diagnostics", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlTenantModuleConfigRepository(executor);

    await repository.upsertConfig({
      tenantId,
      moduleId: "channel-telegram",
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        outboundEnabled: true
      },
      diagnostics: {
        status: "configured"
      },
      updatedAt: new Date("2026-06-22T10:00:00.000Z")
    });

    expect(executor.queries).toHaveLength(1);
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
