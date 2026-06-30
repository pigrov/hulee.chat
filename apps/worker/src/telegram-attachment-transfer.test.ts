import type { ChannelConnectorId, TenantId } from "@hulee/contracts";
import type {
  AttachmentTransferRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  FindActiveChannelConnectorByExternalIdInput,
  PendingTelegramAttachmentTransfer
} from "@hulee/db";
import type { EgressRuntime, TelegramBotApiSettings } from "@hulee/modules";
import { describe, expect, it, vi } from "vitest";

import { createTelegramAttachmentTransferSweeper } from "./telegram-attachment-transfer";

const tenantId = "tenant_attachment_transfer" as TenantId;
const connectorId = "telegram_bot:attachment-transfer" as ChannelConnectorId;
const now = new Date("2026-06-22T10:00:00.000Z");

describe("telegram attachment transfer sweeper", () => {
  it("downloads pending Telegram attachments through egress and stores objects", async () => {
    const repository = new InMemoryAttachmentTransferRepository([
      createPendingTransfer()
    ]);
    const objectStorage = {
      putObject: vi.fn(async () => {})
    };
    const getFile = vi.fn(async () => ({ filePath: "photos/file-1.jpg" }));
    const downloadFile = vi.fn(async () => new Uint8Array([1, 2, 3]));
    const clientFactory = vi.fn((settings: TelegramBotApiSettings) => {
      expect(settings).toEqual(
        expect.objectContaining({
          botToken: "telegram-token",
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

      return { getFile, downloadFile };
    });
    const sweeper = createTelegramAttachmentTransferSweeper({
      repository,
      connectorRepository: connectorRepository(createTelegramConnector()),
      secretResolver: secretResolver(),
      objectStorage,
      botApiClientFactory: clientFactory,
      egressRuntime: readyVpnEgressRuntime(),
      now: () => now
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      scanned: 1,
      attempted: 1,
      stored: 1,
      failed: 0
    });
    expect(getFile).toHaveBeenCalledWith("telegram-file-1");
    expect(downloadFile).toHaveBeenCalledWith("photos/file-1.jpg");
    expect(objectStorage.putObject).toHaveBeenCalledWith({
      storageKey:
        "tenants/tenant_attachment_transfer/messages/message-1/file.jpg",
      body: new Uint8Array([1, 2, 3]),
      mediaType: "image/jpeg",
      fileName: "file.jpg"
    });
    expect(repository.stored).toEqual([
      expect.objectContaining({
        tenantId,
        fileId: "file-1",
        sizeBytes: 3,
        mediaType: "image/jpeg"
      })
    ]);
  });

  it("marks files failed when transfer dependencies fail", async () => {
    const repository = new InMemoryAttachmentTransferRepository([
      createPendingTransfer()
    ]);
    const sweeper = createTelegramAttachmentTransferSweeper({
      repository,
      connectorRepository: connectorRepository(null),
      secretResolver: secretResolver(),
      objectStorage: {
        async putObject() {
          throw new Error("should not store");
        }
      },
      egressRuntime: readyVpnEgressRuntime(),
      now: () => now
    });

    await expect(sweeper.sweep()).resolves.toEqual({
      scanned: 1,
      attempted: 1,
      stored: 0,
      failed: 1
    });
    expect(repository.failed).toEqual([
      expect.objectContaining({
        tenantId,
        fileId: "file-1",
        errorCode: "validation.failed"
      })
    ]);
  });
});

function createPendingTransfer(): PendingTelegramAttachmentTransfer {
  return {
    tenantId,
    fileId: "file-1",
    messageId: "message-1",
    storageKey:
      "tenants/tenant_attachment_transfer/messages/message-1/file.jpg",
    fileName: "file.jpg",
    mediaType: "image/jpeg",
    sizeBytes: 0,
    channelExternalId: "telegram-local",
    providerAttachmentId: "telegram-file-1"
  };
}

function createTelegramConnector(): ChannelConnectorRecord {
  return {
    id: connectorId,
    tenantId,
    channelType: "telegram_bot",
    channelClass: "bot_bridge",
    provider: "telegram",
    displayName: "Telegram Bot",
    status: "connected",
    healthStatus: "healthy",
    capabilities: {},
    onboardingState: {},
    config: {
      channelExternalId: "telegram-local",
      mode: "webhook",
      botTokenSecretRef:
        "secret:tenant_attachment_transfer/channels/telegram_bot:attachment-transfer/bot-token",
      outboundEnabled: true
    },
    diagnostics: {},
    createdByEmployeeId: null,
    createdAt: now,
    updatedAt: now
  };
}

function connectorRepository(
  connector: ChannelConnectorRecord | null
): ChannelConnectorRepository {
  return {
    async findActiveConnectorByExternalId(
      input: FindActiveChannelConnectorByExternalIdInput
    ) {
      const config = connector?.config as
        | { channelExternalId?: string }
        | undefined;

      return connector?.tenantId === input.tenantId &&
        connector.channelType === input.channelType &&
        config?.channelExternalId === input.channelExternalId
        ? connector
        : null;
    }
  } as ChannelConnectorRepository;
}

function secretResolver() {
  return {
    async resolveSecret() {
      return "telegram-token";
    }
  };
}

function readyVpnEgressRuntime(): EgressRuntime {
  return {
    async resolveProfile() {
      return {
        profileKind: "vpn_namespace",
        diagnostics: {
          required: true,
          status: "ready",
          profileKind: "vpn_namespace",
          profileId: "hulee_chat_vpn_gateway",
          checkedAt: now.toISOString()
        }
      };
    },
    async execute(_input, operation) {
      return operation();
    }
  };
}

class InMemoryAttachmentTransferRepository implements AttachmentTransferRepository {
  readonly stored: Parameters<
    AttachmentTransferRepository["markAttachmentTransferStored"]
  >[0][] = [];
  readonly failed: Parameters<
    AttachmentTransferRepository["markAttachmentTransferFailed"]
  >[0][] = [];

  constructor(
    private readonly transfers: readonly PendingTelegramAttachmentTransfer[]
  ) {}

  async listPendingTelegramAttachmentTransfers() {
    return [...this.transfers];
  }

  async markAttachmentTransferStored(
    input: Parameters<
      AttachmentTransferRepository["markAttachmentTransferStored"]
    >[0]
  ) {
    this.stored.push(input);
  }

  async markAttachmentTransferFailed(
    input: Parameters<
      AttachmentTransferRepository["markAttachmentTransferFailed"]
    >[0]
  ) {
    this.failed.push(input);
  }
}
