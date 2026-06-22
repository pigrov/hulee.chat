import type {
  InternalTelegramIntegrationDiagnostics,
  NormalizedIncomingMessage,
  PublicApiInboundMessageResponse,
  TenantId
} from "@hulee/contracts";
import type {
  FindEnabledTenantModuleConfigInput,
  FindTenantModuleConfigInput,
  ListEnabledTenantModuleConfigsInput,
  TenantModuleConfigRecord,
  TenantModuleConfigRepository,
  UpsertTenantModuleConfigInput
} from "@hulee/db";
import { TelegramAdapterError } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import { runTelegramPollingSweep } from "./telegram-polling-sweeper";

const tenantId = "tenant-polling" as TenantId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram polling sweeper", () => {
  it("polls Telegram updates through tenant config and accepts inbound messages", async () => {
    const repository = new InMemoryModuleConfigRepository([
      createModuleConfig({
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
      moduleConfigRepository: repository,
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
    const repository = new InMemoryModuleConfigRepository([
      createModuleConfig({
        mode: "webhook"
      })
    ]);
    const getUpdates = vi.fn(async () => []);

    const result = await runTelegramPollingSweep({
      moduleConfigRepository: repository,
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
    const repository = new InMemoryModuleConfigRepository([
      createModuleConfig({
        mode: "polling"
      })
    ]);

    const result = await runTelegramPollingSweep({
      moduleConfigRepository: repository,
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

class InMemoryModuleConfigRepository implements TenantModuleConfigRepository {
  readonly upserts: UpsertTenantModuleConfigInput[] = [];
  private readonly records = new Map<string, TenantModuleConfigRecord>();

  constructor(records: readonly TenantModuleConfigRecord[]) {
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
    const record = await this.findConfig(input);

    return record?.enabled ? record : null;
  }

  async listEnabledConfigs(
    input: ListEnabledTenantModuleConfigsInput
  ): Promise<TenantModuleConfigRecord[]> {
    return [...this.records.values()].filter(
      (record) => record.moduleId === input.moduleId && record.enabled
    );
  }

  async upsertConfig(input: UpsertTenantModuleConfigInput): Promise<void> {
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

function createModuleConfig(input: {
  mode: "webhook" | "polling";
  diagnostics?: InternalTelegramIntegrationDiagnostics;
}): TenantModuleConfigRecord {
  return {
    tenantId,
    moduleId: "channel-telegram",
    enabled: true,
    config: {
      channelExternalId: "telegram-local",
      mode: input.mode,
      botTokenSecretRef: "env:HULEE_TELEGRAM_BOT_TOKEN",
      outboundEnabled: true
    },
    diagnostics: input.diagnostics ?? {}
  };
}

function recordKey(tenantIdInput: TenantId, moduleId: string): string {
  return `${tenantIdInput}:${moduleId}`;
}
