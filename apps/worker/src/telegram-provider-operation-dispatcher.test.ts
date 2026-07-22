import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelProviderOperation,
  ChannelType,
  EmployeeId,
  EventId,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import type {
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  FindActiveChannelConnectorByConfigStringInput,
  FindActiveChannelConnectorByExternalIdInput,
  FindChannelConnectorInput,
  FindFirstChannelConnectorByTypeInput,
  ListActiveChannelConnectorsByTypeInput,
  ListTenantChannelConnectorsInput,
  UpsertChannelConnectorInput
} from "@hulee/db";
import type { EgressRuntime, TelegramBotApiSettings } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import type { OutboxRecord } from "./provider-control-outbox";
import { createTelegramProviderOperationDispatcher } from "./telegram-provider-operation-dispatcher";

const tenantId = "tenant_worker_provider_ops" as TenantId;
const connectorId = "telegram_bot:provider-ops" as ChannelConnectorId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram provider operation dispatcher", () => {
  it("refreshes Telegram diagnostics from a queued provider operation", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector()
    ]);
    const getMe = vi.fn(async () => ({
      id: "100",
      username: "hulee_test_bot",
      raw: {}
    }));
    const getWebhookInfo = vi.fn(async () => ({
      url: "https://example.test/webhooks/telegram/tgwh_test",
      pendingUpdateCount: 0,
      raw: {}
    }));
    const clientFactory = vi.fn((settings: TelegramBotApiSettings) => {
      expect(settings).toEqual(
        expect.objectContaining({
          botToken: "token-1",
          egress: expect.objectContaining({
            tenantId,
            connectorId,
            channelType: "telegram_bot",
            provider: "telegram",
            resolution: expect.objectContaining({
              profileKind: "vpn_namespace"
            })
          })
        })
      );

      return {
        getMe,
        getWebhookInfo,
        async setWebhook() {},
        async deleteWebhook() {}
      };
    });
    const dispatcher = createTelegramProviderOperationDispatcher({
      connectorRepository: repository,
      secretResolver: envSecretResolver(),
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      publicWebhookBaseUrl: "https://example.test/",
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord("telegram.diagnostics.refresh"));

    expect(getMe).toHaveBeenCalledOnce();
    expect(getWebhookInfo).toHaveBeenCalledOnce();
    expect(repository.records.get(connectorId)?.diagnostics).toMatchObject({
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
    });
    expect(repository.records.get(connectorId)?.status).toBe("connected");
    expect(repository.records.get(connectorId)?.healthStatus).toBe("healthy");
    expect(repository.records.get(connectorId)?.displayName).toBe(
      "Telegram Bot (@hulee_test_bot)"
    );
  });

  it("sets Telegram webhook from a queued provider operation", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector()
    ]);
    const setWebhook = vi.fn(async () => {});
    const dispatcher = createTelegramProviderOperationDispatcher({
      connectorRepository: repository,
      secretResolver: envSecretResolver(),
      botApiClientFactory: () => ({
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
        setWebhook,
        async deleteWebhook() {}
      }),
      egressRuntime: readyVpnEgressRuntime(),
      publicWebhookBaseUrl: "https://example.test/",
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord("telegram.webhook.set"));

    expect(setWebhook).toHaveBeenCalledWith({
      url: "https://example.test/webhooks/telegram/tgwh_test",
      secretToken: "webhook-secret"
    });
    expect(repository.records.get(connectorId)?.diagnostics).toMatchObject({
      status: "configured",
      checks: {
        botApiReachable: true,
        webhookMatchesConfig: true
      }
    });
  });

  it("drops stale webhook activation while clean-slate provider I/O is fenced", async () => {
    const initial = createTelegramConnector();
    const repository = new InMemoryChannelConnectorRepository([initial]);
    const clientFactory = vi.fn();
    const dispatcher = createTelegramProviderOperationDispatcher({
      connectorRepository: repository,
      secretResolver: envSecretResolver(),
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      publicWebhookBaseUrl: "https://example.test/",
      allowWebhookSet: false,
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord("telegram.webhook.set"));

    expect(clientFactory).not.toHaveBeenCalled();
    expect(repository.records.get(connectorId)).toEqual(initial);
  });

  it("reports active Telegram webhooks as a polling mode conflict", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({ mode: "polling" })
    ]);
    const dispatcher = createTelegramProviderOperationDispatcher({
      connectorRepository: repository,
      secretResolver: envSecretResolver(),
      botApiClientFactory: () => ({
        async getMe() {
          return {
            id: "100",
            raw: {}
          };
        },
        async getWebhookInfo() {
          return {
            url: "https://example.test/webhooks/telegram/old-webhook",
            pendingUpdateCount: 2,
            raw: {}
          };
        },
        async setWebhook() {},
        async deleteWebhook() {}
      }),
      egressRuntime: readyVpnEgressRuntime(),
      publicWebhookBaseUrl: "https://example.test/",
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord("telegram.diagnostics.refresh"));

    expect(repository.records.get(connectorId)?.diagnostics).toMatchObject({
      status: "webhook_mismatch",
      operatorHint:
        "Telegram has an active webhook while this channel uses polling. Delete the webhook before polling can receive updates.",
      checks: {
        botApiReachable: true,
        webhookMatchesConfig: false
      },
      webhook: {
        actualUrl: "https://example.test/webhooks/telegram/old-webhook"
      }
    });
    expect(repository.records.get(connectorId)?.status).toBe("degraded");
    expect(repository.records.get(connectorId)?.healthStatus).toBe("degraded");
  });

  it("ignores non-Telegram provider operation events", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector()
    ]);
    const clientFactory = vi.fn();
    const dispatcher = createTelegramProviderOperationDispatcher({
      connectorRepository: repository,
      secretResolver: envSecretResolver(),
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      publicWebhookBaseUrl: "https://example.test/",
      now: () => now
    });

    await dispatcher.handle({
      ...createOutboxRecord("telegram.diagnostics.refresh"),
      payload: createProviderOperationEvent("telegram.diagnostics.refresh", {
        channelType: "vk_community",
        provider: "vk"
      })
    });

    expect(clientFactory).not.toHaveBeenCalled();
  });
});

function envSecretResolver() {
  return {
    async resolveSecret({ secretRef }: { secretRef: string }) {
      if (secretRef.includes("webhook-secret-token")) {
        return "webhook-secret";
      }

      if (secretRef.includes("bot-token")) {
        return "token-1";
      }

      return null;
    }
  };
}

function readyVpnEgressRuntime(): EgressRuntime {
  return {
    async resolveProfile(input) {
      return {
        profileKind: "vpn_namespace",
        profileId: "hulee_chat_vpn_gateway",
        diagnostics: {
          required: input.requirement.required,
          status: "ready",
          profileKind: "vpn_namespace",
          profileId: "hulee_chat_vpn_gateway",
          checkedAt: input.checkedAt
        }
      };
    },
    async execute(_input, operation) {
      return operation();
    }
  };
}

class InMemoryChannelConnectorRepository implements ChannelConnectorRepository {
  readonly records = new Map<string, ChannelConnectorRecord>();

  constructor(records: readonly ChannelConnectorRecord[] = []) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findConnector(
    input: FindChannelConnectorInput
  ): Promise<ChannelConnectorRecord | null> {
    const record = this.records.get(String(input.connectorId)) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async findFirstConnectorByType(
    input: FindFirstChannelConnectorByTypeInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channelType === input.channelType &&
          (input.includeDeleted || record.status !== "deleted")
      ) ?? null
    );
  }

  async listActiveConnectorsByType(
    input: ListActiveChannelConnectorsByTypeInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.channelType === input.channelType &&
        (record.status === "connected" || record.status === "degraded")
    );
  }

  async listTenantConnectors(
    input: ListTenantChannelConnectorsInput
  ): Promise<ChannelConnectorRecord[]> {
    return [...this.records.values()].filter(
      (record) =>
        record.tenantId === input.tenantId &&
        (input.includeDeleted || record.status !== "deleted")
    );
  }

  async findActiveConnectorByConfigString(
    input: FindActiveChannelConnectorByConfigStringInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.channelType === input.channelType &&
          record.status !== "disabled" &&
          record.status !== "deleted" &&
          isRecord(record.config) &&
          record.config[input.configKey] === input.configValue
      ) ?? null
    );
  }

  async findActiveConnectorByExternalId(
    input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null> {
    return (
      [...this.records.values()].find(
        (record) =>
          record.tenantId === input.tenantId &&
          record.channelType === input.channelType &&
          record.status !== "disabled" &&
          record.status !== "deleted" &&
          isRecord(record.config) &&
          record.config.channelExternalId === input.channelExternalId
      ) ?? null
    );
  }

  async upsertConnector(input: UpsertChannelConnectorInput): Promise<void> {
    const existing = this.records.get(String(input.id));

    this.records.set(String(input.id), {
      id: String(input.id) as ChannelConnectorId,
      tenantId: input.tenantId,
      channelType: input.channelType as ChannelType,
      channelClass: input.channelClass as ChannelClass,
      provider: input.provider,
      displayName: input.displayName,
      status: input.status as ChannelConnectorStatus,
      healthStatus: input.healthStatus as ChannelConnectorHealthStatus,
      capabilities: input.capabilities ?? {},
      onboardingState: input.onboardingState ?? {},
      config: input.config ?? {},
      diagnostics: input.diagnostics ?? {},
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    });
  }
}

function createOutboxRecord(operation: ChannelProviderOperation): OutboxRecord {
  return {
    id: `outbox:${operation}`,
    tenantId,
    eventId: `event:${operation}`,
    payload: createProviderOperationEvent(operation),
    attempts: 0,
    status: "processing"
  };
}

function createProviderOperationEvent(
  operation: ChannelProviderOperation,
  override: {
    channelType?: ChannelType;
    provider?: string;
  } = {}
): PlatformEvent {
  return {
    id: `event:${operation}` as EventId,
    type: "channel.provider_operation.requested",
    version: "v1",
    tenantId,
    occurredAt: now.toISOString(),
    payload: {
      connectorId,
      channelType: override.channelType ?? "telegram_bot",
      provider: override.provider ?? "telegram",
      operation,
      actorEmployeeId: "employee-1" as EmployeeId
    }
  };
}

function createTelegramConnector(
  input: { mode?: "webhook" | "polling" } = {}
): ChannelConnectorRecord {
  return {
    id: connectorId,
    tenantId,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "connected",
    healthStatus: "unknown",
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId: "telegram-local",
      mode: input.mode ?? "webhook",
      botTokenSecretRef:
        "secret:tenant_worker_provider_ops/channels/telegram_bot:provider-ops/bot-token",
      webhookConnectorId: "tgwh_test",
      webhookSecretTokenSecretRef:
        "secret:tenant_worker_provider_ops/channels/telegram_bot:provider-ops/webhook-secret-token",
      outboundEnabled: true
    },
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
