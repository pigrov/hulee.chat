import type { PlatformErrorCode, TenantId } from "@hulee/contracts";

export type PendingTelegramAttachmentTransfer = {
  tenantId: TenantId;
  fileId: string;
  messageId: string;
  storageKey: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  channelExternalId: string;
  providerAttachmentId: string;
};

export type ListPendingTelegramAttachmentTransfersInput = { limit: number };
export type MarkAttachmentTransferStoredInput = {
  tenantId: TenantId;
  fileId: string;
  sizeBytes: number;
  mediaType?: string;
  storedAt: Date;
};
export type MarkAttachmentTransferFailedInput = {
  tenantId: TenantId;
  fileId: string;
  errorCode: PlatformErrorCode;
  failedAt: Date;
  operatorHint?: string;
};
export type AttachmentTransferRepository = {
  listPendingTelegramAttachmentTransfers(
    input: ListPendingTelegramAttachmentTransfersInput
  ): Promise<PendingTelegramAttachmentTransfer[]>;
  markAttachmentTransferStored(
    input: MarkAttachmentTransferStoredInput
  ): Promise<void>;
  markAttachmentTransferFailed(
    input: MarkAttachmentTransferFailedInput
  ): Promise<void>;
};
