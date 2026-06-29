import type {
  ChannelClass,
  ChannelConnectorHealthStatus,
  ChannelConnectorId,
  ChannelConnectorStatus,
  ChannelType,
  InternalTelegramIntegrationDiagnostics,
  NormalizedIncomingMessage,
  PublicApiInboundMessageResponse,
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
import { TelegramAdapterError } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import { runTelegramPollingSweep } from "./telegram-polling-sweeper";

const tenantId = "tenant-polling" as TenantId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram polling sweeper", () => {
  it("polls Telegram updates through tenant config and accepts inbound messages", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        mode: "polling",
        diagnostics: {
          status: "configured",
          checkedAt: "2026-06-22T09:00:00.000Z",
          checks: {
            moduleEnabled: true,
            configValid: true,
            inboundWebhookReady: false,
            outboundEnabled: true,
            botTokenSecretRefConfigured: true
          },
          polling: {
            lastUpdateId: 1001
          }
        }
      })
    ]);
    const commands = new RecordingInboundCommands();
    const getUpdates = vi.fn(async () => [
      {
        updateId: 1002,
        raw: {
          update_id: 1002,
          message: {
            message_id: 77,
            date: 1782115200,
            chat: {
              id: 9001,
              type: "private"
            },
            from: {
              id: 42,
              first_name: "Alice"
            },
            text: "Hello"
          }
        }
      }
    ]);

    const result = await runTelegramPollingSweep({
      connectorRepository: repository,
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      commands,
      botApiClientFactory: () => ({
        getUpdates
      }),
      now: () => now,
      requestIdFactory: ({ updateId }) => `poll-${updateId}`
    });

    expect(result).toEqual({
      configsScanned: 1,
      configsPolled: 1,
      updatesReceived: 1,
      updatesAccepted: 1,
      updatesFailed: 0
    });
    expect(getUpdates).toHaveBeenCalledWith({
      offset: 1002,
      limit: 25,
      timeoutSeconds: 0,
      allowedUpdates: [
        "message",
        "edited_message",
        "channel_post",
        "edited_channel_post"
      ]
    });
    expect(commands.messages).toEqual([
      expect.objectContaining({
        context: {
          requestId: "poll-1002",
          tenantId,
          channelId: "telegram-local"
        },
        message: expect.objectContaining({
          tenantId,
          channelExternalId: "telegram-local",
          clientExternalId: "telegram-user:42",
          text: "Hello"
        })
      })
    ]);
    expect(repository.upserts[0]?.diagnostics).toMatchObject({
      status: "configured",
      polling: {
        lastUpdateId: 1002,
        lastRunAt: now.toISOString(),
        receivedUpdateCount: 1,
        acceptedUpdateCount: 1,
        failedUpdateCount: 0
      },
      checks: {
        botTokenResolved: true,
        botApiReachable: true
      }
    });
  });

  it("skips enabled Telegram configs that are not in polling mode", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        mode: "webhook"
      })
    ]);
    const getUpdates = vi.fn(async () => []);

    const result = await runTelegramPollingSweep({
      connectorRepository: repository,
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      commands: new RecordingInboundCommands(),
      botApiClientFactory: () => ({
        getUpdates
      }),
      now: () => now
    });

    expect(result.configsScanned).toBe(1);
    expect(result.configsPolled).toBe(0);
    expect(getUpdates).not.toHaveBeenCalled();
    expect(repository.upserts).toEqual([]);
  });

  it("persists diagnosable provider errors when getUpdates fails", async () => {
    const repository = new InMemoryChannelConnectorRepository([
      createTelegramConnector({
        mode: "polling"
      })
    ]);

    const result = await runTelegramPollingSweep({
      connectorRepository: repository,
      secretResolver: {
        async resolveSecret() {
          return "token-1";
        }
      },
      commands: new RecordingInboundCommands(),
      botApiClientFactory: () => ({
        async getUpdates() {
          throw new TelegramAdapterError(
            "provider.temporary_failure",
            "webhook is active"
          );
        }
      }),
      now: () => now
    });

    expect(result).toMatchObject({
      configsPolled: 1,
      updatesReceived: 0
    });
    expect(repository.upserts[0]?.diagnostics).toMatchObject({
      status: "provider_unreachable",
      lastErrorCode: "provider.temporary_failure",
      operatorHint: "Telegram getUpdates call failed.",
      polling: {
        lastRunAt: now.toISOString(),
        receivedUpdateCount: 0,
        acceptedUpdateCount: 0,
        failedUpdateCount: 0
      },
      checks: {
        botTokenResolved: true,
        botApiReachable: false
      }
    });
  });
});

class InMemoryChannelConnectorRepository implements ChannelConnectorRepository {
  readonly upserts: UpsertChannelConnectorInput[] = [];
  private readonly records = new Map<string, ChannelConnectorRecord>();

  constructor(records: readonly ChannelConnectorRecord[]) {
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
    _input: FindActiveChannelConnectorByConfigStringInput
  ): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async findActiveConnectorByExternalId(
    _input: FindActiveChannelConnectorByExternalIdInput
  ): Promise<ChannelConnectorRecord | null> {
    return null;
  }

  async upsertConnector(input: UpsertChannelConnectorInput): Promise<void> {
    this.upserts.push(input);
  }
}

class RecordingInboundCommands {
  readonly messages: {
    context: {
      requestId: string;
      tenantId: TenantId;
      channelId: string;
    };
    message: NormalizedIncomingMessage;
  }[] = [];

  async acceptInboundMessage(
    context: {
      requestId: string;
      tenantId: TenantId;
      channelId: string;
    },
    message: NormalizedIncomingMessage
  ): Promise<PublicApiInboundMessageResponse> {
    this.messages.push({ context, message });

    return {
      clientId: "client:telegram-user:42" as never,
      conversationId: "conversation:telegram-user:42" as never,
      messageId: "message:telegram:1002" as never,
      accepted: true
    };
  }
}

function createTelegramConnector(input: {
  mode: "webhook" | "polling";
  diagnostics?: InternalTelegramIntegrationDiagnostics;
}): ChannelConnectorRecord {
  return {
    id: "telegram_bot:tenant-polling" as ChannelConnectorId,
    tenantId,
    channelType: "telegram_bot" as ChannelType,
    channelClass: "bot_bridge" as ChannelClass,
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "connected" as ChannelConnectorStatus,
    healthStatus: "healthy" as ChannelConnectorHealthStatus,
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId: "telegram-local",
      mode: input.mode,
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    },
    diagnostics: input.diagnostics ?? {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}
