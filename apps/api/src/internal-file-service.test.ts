import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { ConversationId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { FileAccessRepository, FileContentAccessRecord } from "@hulee/db";
import type { ObjectStorage } from "@hulee/storage";
import { describe, expect, it, vi } from "vitest";

import { createInternalFileService } from "./internal-file-service";
import type {
  InternalInboxAuthorizationService,
  InternalInboxCommandContext
} from "./internal-inbox-service";

const tenantId = "tenant-1" as TenantId;
const context: InternalInboxCommandContext = {
  requestId: "request-1",
  tenantId,
  employeeId: "employee-1" as EmployeeId
};

const fileRecord: FileContentAccessRecord = {
  tenantId,
  fileId: "file-1",
  storageKey: "tenants/tenant-1/messages/message-1/photo.jpg",
  fileName: "photo.jpg",
  mediaType: "image/jpeg",
  sizeBytes: 123,
  status: "stored",
  conversation: {
    id: "conversation-1" as ConversationId,
    tenantId,
    clientId: "client-1",
    currentQueueId: "queue-sales",
    assignedEmployeeId: context.employeeId
  }
};

describe("internal file service", () => {
  it("loads stored file content after conversation-scoped files.view authorization", async () => {
    const repository = createFileRepository(fileRecord);
    const authorization = createAuthorization();
    const objectStorage = createObjectStorage({
      body: new Uint8Array([1, 2, 3]),
      mediaType: "image/png",
      sizeBytes: 3
    });
    const service = createInternalFileService({
      repository,
      authorization,
      objectStorage
    });

    await expect(
      service.loadFileContent(context, { fileId: "file-1" })
    ).resolves.toEqual({
      fileId: "file-1",
      fileName: "photo.jpg",
      mediaType: "image/png",
      sizeBytes: 3,
      body: new Uint8Array([1, 2, 3])
    });
    expect(repository.findFileContentAccess).toHaveBeenCalledWith({
      tenantId,
      fileId: "file-1"
    });
    expect(authorization.assertConversationAccess).toHaveBeenCalledWith(
      context,
      {
        conversation: fileRecord.conversation,
        permission: "files.view"
      }
    );
    expect(objectStorage.getObject).toHaveBeenCalledWith({
      storageKey: fileRecord.storageKey
    });
  });

  it("does not read object storage for files that are not stored yet", async () => {
    const objectStorage = createObjectStorage({
      body: new Uint8Array([1, 2, 3])
    });
    const service = createInternalFileService({
      repository: createFileRepository({
        ...fileRecord,
        status: "pending_download"
      }),
      authorization: createAuthorization(),
      objectStorage
    });

    await expect(
      service.loadFileContent(context, { fileId: "file-1" })
    ).rejects.toEqual(new CoreError("validation.failed"));
    expect(objectStorage.getObject).not.toHaveBeenCalled();
  });

  it("keeps file reads behind effective conversation permissions", async () => {
    const service = createInternalFileService({
      repository: createFileRepository(fileRecord),
      authorization: createAuthorization(new CoreError("permission.denied")),
      objectStorage: createObjectStorage({
        body: new Uint8Array([1, 2, 3])
      })
    });

    await expect(
      service.loadFileContent(context, { fileId: "file-1" })
    ).rejects.toEqual(new CoreError("permission.denied"));
  });
});

function createFileRepository(
  record: FileContentAccessRecord | null
): FileAccessRepository & {
  findFileContentAccess: ReturnType<typeof vi.fn>;
} {
  return {
    findFileContentAccess: vi.fn(async () => record)
  };
}

function createAuthorization(
  error?: CoreError
): InternalInboxAuthorizationService & {
  assertConversationAccess: ReturnType<typeof vi.fn>;
} {
  return {
    filterConversations: vi.fn(async (_context, input) => input.conversations),
    assertConversationAccess: vi.fn(async () => {
      if (error !== undefined) {
        throw error;
      }
    })
  };
}

function createObjectStorage(output: {
  body: Uint8Array;
  mediaType?: string;
  sizeBytes?: number;
}): ObjectStorage & {
  getObject: ReturnType<typeof vi.fn>;
  putObject: ReturnType<typeof vi.fn>;
} {
  return {
    putObject: vi.fn(async () => undefined),
    getObject: vi.fn(async () => output)
  };
}
