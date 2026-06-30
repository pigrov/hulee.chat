import type { TenantId } from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
  buildListPendingTelegramAttachmentTransfersSql,
  createSqlAttachmentTransferRepository
} from "./sql-attachment-transfer-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant_attachments" as TenantId;

describe("sql attachment transfer repository", () => {
  it("maps pending Telegram attachment transfer rows", async () => {
    const executor = new RecordingSqlExecutor([
      {
        tenant_id: tenantId,
        file_id: "file-1",
        message_id: "message-1",
        storage_key: "tenants/tenant_attachments/messages/message-1/file.jpg",
        file_name: "file.jpg",
        media_type: "image/jpeg",
        size_bytes: 123,
        channel_external_id: "telegram-local",
        provider_attachment_id: "telegram-file-1"
      },
      {
        tenant_id: tenantId,
        file_id: "file-2",
        message_id: "message-2",
        storage_key: "tenants/tenant_attachments/messages/message-2/file.jpg",
        file_name: "file.jpg",
        media_type: "image/jpeg",
        size_bytes: 0,
        channel_external_id: null,
        provider_attachment_id: "telegram-file-2"
      }
    ]);
    const repository = createSqlAttachmentTransferRepository(executor);

    await expect(
      repository.listPendingTelegramAttachmentTransfers({ limit: 10 })
    ).resolves.toEqual([
      {
        tenantId,
        fileId: "file-1",
        messageId: "message-1",
        storageKey: "tenants/tenant_attachments/messages/message-1/file.jpg",
        fileName: "file.jpg",
        mediaType: "image/jpeg",
        sizeBytes: 123,
        channelExternalId: "telegram-local",
        providerAttachmentId: "telegram-file-1"
      }
    ]);
  });

  it("builds bounded pending transfer queries", () => {
    expect(
      buildListPendingTelegramAttachmentTransfersSql({ limit: 25 })
    ).toBeDefined();
  });

  it("marks attachment transfers as stored or failed", async () => {
    const executor = new RecordingSqlExecutor([]);
    const repository = createSqlAttachmentTransferRepository(executor);

    await repository.markAttachmentTransferStored({
      tenantId,
      fileId: "file-1",
      sizeBytes: 123,
      mediaType: "image/jpeg",
      storedAt: new Date("2026-06-22T10:00:00.000Z")
    });
    await repository.markAttachmentTransferFailed({
      tenantId,
      fileId: "file-2",
      errorCode: "provider.temporary_failure",
      failedAt: new Date("2026-06-22T10:01:00.000Z"),
      operatorHint: "Download failed."
    });

    expect(executor.queries).toHaveLength(2);
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
