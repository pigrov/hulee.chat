import type {
  ChannelType,
  EmployeeId,
  EventId,
  PlatformErrorCode,
  PlatformEvent,
  TenantId
} from "@hulee/contracts";
import type {
  ChannelProviderValidationJobRecord,
  ChannelProviderValidationJobRepository,
  FindChannelProviderValidationJobInput,
  UpsertChannelProviderValidationJobInput
} from "@hulee/db";
import type { EgressRuntime, TelegramBotApiSettings } from "@hulee/modules";
import { TelegramAdapterError } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import type { OutboxRecord } from "./outbox-processor";
import { createTelegramProviderValidationDispatcher } from "./telegram-provider-validation-dispatcher";

const tenantId = "tenant_worker_provider_validation" as TenantId;
const jobId = "channel-provider-validation:test";
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram provider validation dispatcher", () => {
  it("validates Telegram bot token jobs through provider egress", async () => {
    const repository = new InMemoryChannelProviderValidationJobRepository([
      createValidationJob()
    ]);
    const getMe = vi.fn(async () => ({
      id: "100",
      username: "hulee_test_bot",
      raw: {}
    }));
    const clientFactory = vi.fn((settings: TelegramBotApiSettings) => {
      expect(settings).toEqual(
        expect.objectContaining({
          botToken: "token-1",
          egress: expect.objectContaining({
            tenantId,
            connectorId: jobId,
            channelType: "telegram_bot",
            provider: "telegram",
            resolution: expect.objectContaining({
              profileKind: "vpn_namespace"
            })
          })
        })
      );

      return {
        getMe
      };
    });
    const dispatcher = createTelegramProviderValidationDispatcher({
      validationJobRepository: repository,
      secretResolver: secretResolver("token-1"),
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord());

    expect(getMe).toHaveBeenCalledOnce();
    expect(repository.records.get(jobId)).toMatchObject({
      status: "succeeded",
      resultPayload: {
        bot: {
          id: "100",
          username: "hulee_test_bot"
        }
      },
      completedAt: now
    });
  });

  it("persists permanent Telegram validation failures on the job", async () => {
    const repository = new InMemoryChannelProviderValidationJobRepository([
      createValidationJob()
    ]);
    const dispatcher = createTelegramProviderValidationDispatcher({
      validationJobRepository: repository,
      secretResolver: secretResolver("token-1"),
      botApiClientFactory: () => ({
        async getMe() {
          throw new TelegramAdapterError(
            "provider.permanent_failure",
            "Telegram getMe returned HTTP 401."
          );
        }
      }),
      egressRuntime: readyVpnEgressRuntime(),
      now: () => now
    });

    await dispatcher.handle(createOutboxRecord());

    expect(repository.records.get(jobId)).toMatchObject({
      status: "failed",
      errorCode: "provider.permanent_failure",
      completedAt: now
    });
  });

  it("ignores non-Telegram validation events", async () => {
    const repository = new InMemoryChannelProviderValidationJobRepository([
      createValidationJob()
    ]);
    const clientFactory = vi.fn();
    const dispatcher = createTelegramProviderValidationDispatcher({
      validationJobRepository: repository,
      secretResolver: secretResolver("token-1"),
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      now: () => now
    });

    await dispatcher.handle({
      ...createOutboxRecord(),
      payload: createValidationEvent({ provider: "vk" })
    });

    expect(clientFactory).not.toHaveBeenCalled();
    expect(repository.records.get(jobId)?.status).toBe("pending");
  });
});

function secretResolver(token: string | null) {
  return {
    async resolveSecret() {
      return token;
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

class InMemoryChannelProviderValidationJobRepository implements ChannelProviderValidationJobRepository {
  readonly records = new Map<string, ChannelProviderValidationJobRecord>();

  constructor(records: readonly ChannelProviderValidationJobRecord[] = []) {
    for (const record of records) {
      this.records.set(record.id, record);
    }
  }

  async findJob(
    input: FindChannelProviderValidationJobInput
  ): Promise<ChannelProviderValidationJobRecord | null> {
    const record = this.records.get(input.jobId) ?? null;

    return record?.tenantId === input.tenantId ? record : null;
  }

  async upsertJob(
    input: UpsertChannelProviderValidationJobInput
  ): Promise<void> {
    const existing = this.records.get(input.id);

    this.records.set(input.id, {
      id: input.id,
      tenantId: input.tenantId,
      channelType: input.channelType as ChannelType,
      provider: input.provider,
      validationKind: input.validationKind,
      status: input.status,
      botTokenSecretRef: input.botTokenSecretRef,
      resultPayload: input.resultPayload ?? {},
      errorCode: (input.errorCode as PlatformErrorCode | undefined) ?? null,
      errorMessage: input.errorMessage ?? null,
      expiresAt: input.expiresAt,
      completedAt: input.completedAt ?? null,
      createdByEmployeeId: input.createdByEmployeeId ?? null,
      createdAt: existing?.createdAt ?? input.updatedAt,
      updatedAt: input.updatedAt
    });
  }
}

function createValidationJob(): ChannelProviderValidationJobRecord {
  return {
    id: jobId,
    tenantId,
    channelType: "telegram_bot",
    provider: "telegram",
    validationKind: "telegram_bot_token",
    status: "pending",
    botTokenSecretRef:
      "secret:tenant_worker_provider_validation/channel-telegram/channel-provider-validation-test-bot-token",
    resultPayload: {},
    errorCode: null,
    errorMessage: null,
    expiresAt: new Date("2026-06-22T10:01:00.000Z"),
    completedAt: null,
    createdByEmployeeId: "employee-1" as EmployeeId,
    createdAt: now,
    updatedAt: now
  };
}

function createOutboxRecord(): OutboxRecord {
  return {
    id: "outbox:channel-provider-validation:test",
    tenantId,
    eventId: "event:channel-provider-validation:test",
    payload: createValidationEvent(),
    attempts: 0,
    status: "processing"
  };
}

function createValidationEvent(
  override: {
    channelType?: ChannelType;
    provider?: string;
  } = {}
): PlatformEvent {
  return {
    id: "event:channel-provider-validation:test" as EventId,
    type: "channel.provider_validation.requested",
    version: "v1",
    tenantId,
    occurredAt: now.toISOString(),
    payload: {
      jobId,
      channelType: override.channelType ?? "telegram_bot",
      provider: override.provider ?? "telegram",
      validationKind: "telegram_bot_token",
      actorEmployeeId: "employee-1" as EmployeeId
    }
  };
}
