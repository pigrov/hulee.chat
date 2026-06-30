import type { PlatformErrorCode, TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type {
  AttachmentTransferRepository,
  ChannelConnectorRecord,
  ChannelConnectorRepository,
  PendingTelegramAttachmentTransfer
} from "@hulee/db";
import {
  createPassthroughEgressRuntime,
  createTelegramBotApiClient,
  managedMessengerVpnEgressRequirement,
  parseTelegramChannelConfig,
  TelegramAdapterError,
  type EgressProfileResolution,
  type EgressRuntime,
  type TelegramBotApiEgressBinding,
  type TelegramBotApiSettings
} from "@hulee/modules";

import type { SecretResolver } from "./telegram-outbound-dispatcher";

export type TelegramAttachmentTransferObjectStorage = {
  putObject(input: {
    storageKey: string;
    body: Uint8Array;
    mediaType: string;
    fileName: string;
  }): Promise<void>;
};

export type TelegramAttachmentTransferBotApiClient = {
  getFile(fileId: string): Promise<{ filePath: string; fileSize?: number }>;
  downloadFile(filePath: string): Promise<Uint8Array>;
};

export type TelegramAttachmentTransferBotApiClientFactory = (
  settings: TelegramBotApiSettings
) => TelegramAttachmentTransferBotApiClient;

export type TelegramAttachmentTransferSweepResult = {
  scanned: number;
  attempted: number;
  stored: number;
  failed: number;
};

export type TelegramAttachmentTransferSweeper = {
  sweep(): Promise<TelegramAttachmentTransferSweepResult>;
};

export type TelegramAttachmentTransferSweeperOptions = {
  repository: AttachmentTransferRepository;
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  objectStorage: TelegramAttachmentTransferObjectStorage;
  botApiClientFactory?: TelegramAttachmentTransferBotApiClientFactory;
  egressRuntime?: EgressRuntime;
  telegramApiBaseUrl?: string;
  batchSize?: number;
  now?: () => Date;
};

const telegramChannelType = "telegram_bot";
const telegramProvider = "telegram";
const defaultBatchSize = 25;

export function createTelegramAttachmentTransferSweeper(
  options: TelegramAttachmentTransferSweeperOptions
): TelegramAttachmentTransferSweeper {
  const botApiClientFactory =
    options.botApiClientFactory ?? createTelegramBotApiClient;
  const egressRuntime =
    options.egressRuntime ?? createPassthroughEgressRuntime();
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? defaultBatchSize;

  return {
    async sweep(): Promise<TelegramAttachmentTransferSweepResult> {
      const transfers =
        await options.repository.listPendingTelegramAttachmentTransfers({
          limit: batchSize
        });
      const result: TelegramAttachmentTransferSweepResult = {
        scanned: transfers.length,
        attempted: 0,
        stored: 0,
        failed: 0
      };

      for (const transfer of transfers) {
        result.attempted += 1;

        const outcome = await transferTelegramAttachment({
          ...options,
          botApiClientFactory,
          egressRuntime,
          now,
          transfer
        });

        if (outcome === "stored") {
          result.stored += 1;
        } else {
          result.failed += 1;
        }
      }

      return result;
    }
  };
}

async function transferTelegramAttachment(input: {
  repository: AttachmentTransferRepository;
  connectorRepository: ChannelConnectorRepository;
  secretResolver: SecretResolver;
  objectStorage: TelegramAttachmentTransferObjectStorage;
  botApiClientFactory: TelegramAttachmentTransferBotApiClientFactory;
  egressRuntime: EgressRuntime;
  telegramApiBaseUrl?: string;
  now: () => Date;
  transfer: PendingTelegramAttachmentTransfer;
}): Promise<"stored" | "failed"> {
  try {
    const connector =
      await input.connectorRepository.findActiveConnectorByExternalId({
        tenantId: input.transfer.tenantId,
        channelType: telegramChannelType,
        channelExternalId: input.transfer.channelExternalId
      });

    if (connector === null) {
      throw new CoreError(
        "validation.failed",
        "Telegram connector was not found for attachment transfer."
      );
    }

    const config = parseTelegramChannelConfig(connector.config);
    const botToken = await resolveBotToken({
      tenantId: input.transfer.tenantId,
      secretResolver: input.secretResolver,
      botTokenSecretRef: config.botTokenSecretRef
    });
    const egressResolution = await resolveTelegramEgressProfile({
      egressRuntime: input.egressRuntime,
      tenantId: input.transfer.tenantId,
      connector,
      checkedAt: input.now().toISOString()
    });
    const client = input.botApiClientFactory({
      apiBaseUrl: input.telegramApiBaseUrl,
      botToken,
      egress: buildTelegramBotApiEgressBinding({
        egressRuntime: input.egressRuntime,
        resolution: egressResolution,
        tenantId: input.transfer.tenantId,
        connectorId: connector.id
      })
    });
    const fileInfo = await client.getFile(input.transfer.providerAttachmentId);
    const body = await client.downloadFile(fileInfo.filePath);

    await input.objectStorage.putObject({
      storageKey: input.transfer.storageKey,
      body,
      mediaType: input.transfer.mediaType,
      fileName: input.transfer.fileName
    });
    await input.repository.markAttachmentTransferStored({
      tenantId: input.transfer.tenantId,
      fileId: input.transfer.fileId,
      sizeBytes: body.byteLength,
      mediaType: input.transfer.mediaType,
      storedAt: input.now()
    });

    return "stored";
  } catch (error) {
    await input.repository.markAttachmentTransferFailed({
      tenantId: input.transfer.tenantId,
      fileId: input.transfer.fileId,
      errorCode: platformErrorCodeFromUnknown(error),
      failedAt: input.now(),
      operatorHint: "Telegram attachment transfer failed."
    });

    return "failed";
  }
}

async function resolveBotToken(input: {
  tenantId: TenantId;
  secretResolver: SecretResolver;
  botTokenSecretRef: string | undefined;
}): Promise<string> {
  if (!input.botTokenSecretRef) {
    throw new CoreError("validation.failed", "Bot token secret is not set.");
  }

  const botToken = await input.secretResolver.resolveSecret({
    tenantId: input.tenantId,
    secretRef: input.botTokenSecretRef
  });

  if (!botToken) {
    throw new CoreError("validation.failed", "Bot token secret was not found.");
  }

  return botToken;
}

async function resolveTelegramEgressProfile(input: {
  egressRuntime: EgressRuntime;
  tenantId: TenantId;
  connector: ChannelConnectorRecord;
  checkedAt: string;
}): Promise<EgressProfileResolution> {
  return input.egressRuntime.resolveProfile({
    tenantId: input.tenantId,
    connectorId: input.connector.id,
    channelType: telegramChannelType,
    provider: telegramProvider,
    requirement: managedMessengerVpnEgressRequirement,
    checkedAt: input.checkedAt
  });
}

function buildTelegramBotApiEgressBinding(input: {
  egressRuntime: EgressRuntime;
  resolution: EgressProfileResolution;
  tenantId: TenantId;
  connectorId: string;
}): TelegramBotApiEgressBinding {
  return {
    runtime: input.egressRuntime,
    resolution: input.resolution,
    tenantId: input.tenantId,
    connectorId: input.connectorId,
    channelType: telegramChannelType,
    provider: telegramProvider
  };
}

function platformErrorCodeFromUnknown(error: unknown): PlatformErrorCode {
  if (error instanceof CoreError || error instanceof TelegramAdapterError) {
    return error.code;
  }

  return "provider.temporary_failure";
}
