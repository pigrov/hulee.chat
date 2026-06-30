import type { PlatformErrorCode, TenantId } from "@hulee/contracts";
import { sql, type SQL } from "drizzle-orm";

import type { HuleeDatabase } from "../client";
import type { RawSqlExecutor } from "./sql-outbox-repository";

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

export type ListPendingTelegramAttachmentTransfersInput = {
  limit: number;
};

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

type PendingTelegramAttachmentTransferRow = {
  tenant_id: string;
  file_id: string;
  message_id: string;
  storage_key: string;
  file_name: string;
  media_type: string;
  size_bytes: number;
  channel_external_id: string | null;
  provider_attachment_id: string | null;
};

export function createSqlAttachmentTransferRepository(
  database: HuleeDatabase | RawSqlExecutor
): AttachmentTransferRepository {
  const rawExecutor = database as RawSqlExecutor;

  return {
    async listPendingTelegramAttachmentTransfers(input) {
      const result =
        await rawExecutor.execute<PendingTelegramAttachmentTransferRow>(
          buildListPendingTelegramAttachmentTransfersSql(input)
        );

      return result.rows
        .map(mapPendingTelegramAttachmentTransferRow)
        .filter((row) => row !== null);
    },

    async markAttachmentTransferStored(input) {
      await rawExecutor.execute(buildMarkAttachmentTransferStoredSql(input));
    },

    async markAttachmentTransferFailed(input) {
      await rawExecutor.execute(buildMarkAttachmentTransferFailedSql(input));
    }
  };
}

export function buildListPendingTelegramAttachmentTransfersSql(
  input: ListPendingTelegramAttachmentTransfersInput
): SQL {
  return sql`
    select f.tenant_id,
           f.id as file_id,
           ma.message_id,
           f.storage_key,
           f.file_name,
           f.media_type,
           f.size_bytes,
           coalesce(
             ma.metadata #>> '{source,channelExternalId}',
             f.metadata #>> '{source,channelExternalId}'
           ) as channel_external_id,
           ma.provider_attachment_id
    from files f
    inner join message_attachments ma
      on ma.tenant_id = f.tenant_id
     and ma.file_id = f.id
    where f.status = 'pending_download'
      and ma.provider = 'telegram'
      and ma.provider_attachment_id is not null
    order by f.created_at asc,
             f.id asc
    limit ${input.limit}
  `;
}

export function buildMarkAttachmentTransferStoredSql(
  input: MarkAttachmentTransferStoredInput
): SQL {
  return sql`
    update files
    set status = 'stored',
        size_bytes = ${input.sizeBytes},
        media_type = coalesce(${input.mediaType ?? null}::text, media_type),
        metadata = metadata || ${JSON.stringify({
          transfer: {
            storedAt: input.storedAt.toISOString()
          }
        })}::jsonb,
        updated_at = ${input.storedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.fileId}
  `;
}

export function buildMarkAttachmentTransferFailedSql(
  input: MarkAttachmentTransferFailedInput
): SQL {
  return sql`
    update files
    set status = 'failed',
        metadata = metadata || ${JSON.stringify({
          transfer: {
            failedAt: input.failedAt.toISOString(),
            lastErrorCode: input.errorCode,
            ...(input.operatorHint ? { operatorHint: input.operatorHint } : {})
          }
        })}::jsonb,
        updated_at = ${input.failedAt}
    where tenant_id = ${input.tenantId}
      and id = ${input.fileId}
  `;
}

function mapPendingTelegramAttachmentTransferRow(
  row: PendingTelegramAttachmentTransferRow
): PendingTelegramAttachmentTransfer | null {
  if (!row.channel_external_id || !row.provider_attachment_id) {
    return null;
  }

  return {
    tenantId: row.tenant_id as TenantId,
    fileId: row.file_id,
    messageId: row.message_id,
    storageKey: row.storage_key,
    fileName: row.file_name,
    mediaType: row.media_type,
    sizeBytes: row.size_bytes,
    channelExternalId: row.channel_external_id,
    providerAttachmentId: row.provider_attachment_id
  };
}
