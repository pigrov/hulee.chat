import type { EmployeeId, TenantId } from "@hulee/contracts";
import type {
  FindEnabledTenantModuleConfigInput,
  FindTenantModuleConfigInput,
  ListEnabledTenantModuleConfigsInput,
  TenantModuleConfigRecord,
  TenantModuleConfigRepository,
  UpsertTenantModuleConfigInput
} from "@hulee/db";
import { describe, expect, it } from "vitest";

import {
  createInternalIntegrationService,
  type InternalIntegrationContext
} from "./internal-integrations-service";

const tenantId = "tenant-integrations" as TenantId;
const context: InternalIntegrationContext = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1" as EmployeeId
};
const now = new Date("2026-06-22T10:00:00.000Z");

describe("internal integrations service", () => {
  it("returns disabled Telegram integration when no tenant module row exists", async () => {
    const service = createInternalIntegrationService({
      repository: new InMemoryTenantModuleConfigRepository(),
      now: () => now
    });

    await expect(service.loadTelegramIntegration(context)).resolves.toEqual({
      moduleId: "channel-telegram",
      enabled: false,
      diagnostics: {
        status: "disabled",
        checkedAt: now.toISOString(),
        checks: {
          moduleEnabled: false,
          configValid: false,
          inboundWebhookReady: false,
          outboundEnabled: false,
          botTokenSecretRefConfigured: false
        }
      }
    });
  });

  it("updates Telegram config as tenant module config and returns safe diagnostics", async () => {
    const repository = new InMemoryTenantModuleConfigRepository();
    const service = createInternalIntegrationService({
      repository,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_test"
    });

    const response = await service.updateTelegramIntegration(context, {
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    });

    expect(response).toEqual({
      moduleId: "channel-telegram",
      enabled: true,
      config: {
        channelExternalId: "telegram-local",
        mode: "webhook",
        botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
        webhookConnectorId: "tgwh_test",
        outboundEnabled: true
      },
      webhookPath: "/webhooks/telegram/tgwh_test",
      diagnostics: {
        status: "configured",
        checkedAt: now.toISOString(),
        checks: {
          moduleEnabled: true,
          configValid: true,
          inboundWebhookReady: false,
          outboundEnabled: true,
          botTokenSecretRefConfigured: true
        }
      }
    });
    expect(
      repository.records.get(recordKey(tenantId, "channel-telegram"))
    ).toEqual(
      expect.objectContaining({
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: response.config,
        diagnostics: response.diagnostics
      })
    );
  });

  it("stores Telegram bot tokens in tenant secret storage and only keeps a secret ref in config", async () => {
    const repository = new InMemoryTenantModuleConfigRepository();
    const secretWriter = new InMemorySecretWriter();
    const service = createInternalIntegrationService({
      repository,
      secretWriter,
      now: () => now,
      webhookConnectorIdFactory: () => "tgwh_test",
      webhookSecretTokenFactory: () => "raw-telegram-webhook-secret-value"
    });

    const response = await service.updateTelegramIntegration(context, {
      enabled: true,
      channelExternalId: "telegram-local",
      mode: "webhook",
      botToken: "telegram-token-1",
      outboundEnabled: true
    });

    expect(secretWriter.upserts).toEqual([
      {
        tenantId,
        secretRef: "secret:tenant-integrations/channel-telegram/bot-token",
        purpose: "telegram.bot_token",
        plainText: "telegram-token-1",
        updatedAt: now
      },
      {
        tenantId,
        secretRef:
          "secret:tenant-integrations/channel-telegram/webhook-secret-token",
        purpose: "telegram.webhook_secret_token",
        plainText: "raw-telegram-webhook-secret-value",
        updatedAt: now
      }
    ]);
    expect(response.config?.botTokenSecretRef).toBe(
      "secret:tenant-integrations/channel-telegram/bot-token"
    );
    expect(response.config?.webhookConnectorId).toBe("tgwh_test");
    expect(response.config?.webhookSecretTokenSecretRef).toBe(
      "secret:tenant-integrations/channel-telegram/webhook-secret-token"
    );
    expect(JSON.stringify(response)).not.toContain("telegram-token-1");
    expect(JSON.stringify(response)).not.toContain(
      "raw-telegram-webhook-secret-value"
    );
    expect(
      JSON.stringify(
        repository.records.get(recordKey(tenantId, "channel-telegram"))
      )
    ).not.toContain("telegram-token-1");
  });

  it("returns invalid diagnostics for malformed stored Telegram config", async () => {
    const repository = new InMemoryTenantModuleConfigRepository([
      {
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          outboundEnabled: true
        },
        diagnostics: {}
      }
    ]);
    const service = createInternalIntegrationService({
      repository,
      now: () => now
    });

    await expect(
      service.loadTelegramIntegration(context)
    ).resolves.toMatchObject({
      moduleId: "channel-telegram",
      enabled: true,
      diagnostics: {
        status: "invalid_config",
        lastErrorCode: "validation.failed",
        checks: {
          configValid: false
        }
      }
    });
  });

  it("refreshes Telegram provider diagnostics without exposing the bot token", async () => {
    const repository = new InMemoryTenantModuleConfigRepository([
      {
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          outboundEnabled: true
        },
        diagnostics: {}
      }
    ]);
    const service = createInternalIntegrationService({
      repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      botApiClientFactory() {
        return {
          async sendTextMessage() {
            return {
              messageId: "1",
              chatId: "1",
              raw: {}
            };
          },
          async getMe() {
            return {
              id: "100",
              username: "hulee_test_bot",
              raw: {}
            };
          },
          async getWebhookInfo() {
            return {
              url: "https://example.test/webhooks/telegram/tgwh_test",
              pendingUpdateCount: 0,
              raw: {}
            };
          },
          async getUpdates() {
            return [];
          },
          async setWebhook() {},
          async deleteWebhook() {}
        };
      }
    });

    const response = await service.refreshTelegramDiagnostics(context);

    expect(response).toMatchObject({
      publicWebhookUrl: "https://example.test/webhooks/telegram/tgwh_test",
      diagnostics: {
        status: "configured",
        bot: {
          id: "100",
          username: "hulee_test_bot"
        },
        webhook: {
          expectedUrl: "https://example.test/webhooks/telegram/tgwh_test",
          actualUrl: "https://example.test/webhooks/telegram/tgwh_test",
          pendingUpdateCount: 0
        },
        checks: {
          botTokenResolved: true,
          botApiReachable: true,
          webhookMatchesConfig: true,
          inboundWebhookReady: true
        }
      }
    });
    expect(JSON.stringify(response)).not.toContain("token-1");
    expect(
      repository.records.get(recordKey(tenantId, "channel-telegram"))
        ?.diagnostics
    ).toEqual(response.diagnostics);
  });

  it("sets Telegram webhook to the public tenant callback URL", async () => {
    const repository = new InMemoryTenantModuleConfigRepository([
      {
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          webhookConnectorId: "tgwh_test",
          webhookSecretTokenSecretRef:
            "secret:tenant-integrations/channel-telegram/webhook-secret-token",
          outboundEnabled: true
        },
        diagnostics: {}
      }
    ]);
    const setWebhookCalls: {
      url: string;
      secretToken: string | undefined;
    }[] = [];
    const service = createInternalIntegrationService({
      repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret({ secretRef }) {
          return secretRef.includes("webhook-secret-token")
            ? "webhook-secret"
            : "token-1";
        }
      },
      botApiClientFactory() {
        return {
          async sendTextMessage() {
            return {
              messageId: "1",
              chatId: "1",
              raw: {}
            };
          },
          async getMe() {
            return {
              id: "100",
              raw: {}
            };
          },
          async getWebhookInfo() {
            return {
              url: "https://example.test/webhooks/telegram/tgwh_test",
              pendingUpdateCount: 0,
              raw: {}
            };
          },
          async getUpdates() {
            return [];
          },
          async setWebhook(input) {
            setWebhookCalls.push({
              url: input.url,
              secretToken: input.secretToken
            });
          },
          async deleteWebhook() {}
        };
      }
    });

    const response = await service.setTelegramWebhook(context);

    expect(setWebhookCalls).toEqual([
      {
        url: "https://example.test/webhooks/telegram/tgwh_test",
        secretToken: "webhook-secret"
      }
    ]);
    expect(response.diagnostics.status).toBe("configured");
  });

  it("reports invalid Telegram diagnostics when the token secret cannot be resolved", async () => {
    const repository = new InMemoryTenantModuleConfigRepository([
      {
        tenantId,
        moduleId: "channel-telegram",
        enabled: true,
        config: {
          channelExternalId: "telegram-local",
          mode: "webhook",
          botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
          outboundEnabled: true
        },
        diagnostics: {}
      }
    ]);
    const service = createInternalIntegrationService({
      repository,
      now: () => now,
      publicWebhookBaseUrl: "https://example.test/",
      secretResolver: {
        async resolveSecret() {
          return null;
        }
      }
    });

    const response = await service.refreshTelegramDiagnostics(context);

    expect(response.diagnostics).toMatchObject({
      status: "invalid_config",
      lastErrorCode: "validation.failed",
      checks: {
        botTokenResolved: false,
        botApiReachable: false,
        webhookMatchesConfig: false
      }
    });
  });
});

class InMemoryTenantModuleConfigRepository implements TenantModuleConfigRepository {
  readonly records = new Map<string, TenantModuleConfigRecord>();

  constructor(records: readonly TenantModuleConfigRecord[] = []) {
    for (const record of records) {
      this.records.set(recordKey(record.tenantId, record.moduleId), record);
    }
  }

  async findConfig(
    input: FindTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null> {
    return this.records.get(recordKey(input.tenantId, input.moduleId)) ?? null;
  }

  async findEnabledConfig(
    input: FindEnabledTenantModuleConfigInput
  ): Promise<TenantModuleConfigRecord | null> {
    const record =
      this.records.get(recordKey(input.tenantId, input.moduleId)) ?? null;

    return record?.enabled ? record : null;
  }

  async listEnabledConfigs(
    input: ListEnabledTenantModuleConfigsInput
  ): Promise<TenantModuleConfigRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.moduleId === input.moduleId && record.enabled
    );
  }

  async findEnabledConfigByConfigString(input: {
    moduleId: string;
    configKey: string;
    configValue: string;
  }): Promise<TenantModuleConfigRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.moduleId === input.moduleId &&
          record.enabled &&
          isRecord(record.config) &&
          record.config[input.configKey] === input.configValue
      ) ?? null
    );
  }

  async upsertConfig(input: UpsertTenantModuleConfigInput): Promise<void> {
    this.records.set(recordKey(input.tenantId, input.moduleId), {
      tenantId: input.tenantId,
      moduleId: input.moduleId,
      enabled: input.enabled,
      config: input.config,
      diagnostics: input.diagnostics
    });
  }
}

class InMemorySecretWriter {
  readonly upserts: {
    tenantId: TenantId;
    secretRef: string;
    purpose: "telegram.bot_token" | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }[] = [];

  async upsertSecret(input: {
    tenantId: TenantId;
    secretRef: string;
    purpose: "telegram.bot_token" | "telegram.webhook_secret_token";
    plainText: string;
    updatedAt: Date;
  }): Promise<void> {
    this.upserts.push(input);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function recordKey(tenantIdInput: TenantId, moduleId: string): string {
  return `${tenantIdInput}:${moduleId}`;
}
