import type { EmployeeId, TenantId } from "@hulee/contracts";
import type { ConversationId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { FileAccessRepository, FileContentAccessRecord } from "@hulee/db";
import {
  calculateHuleeSha256,
  type GetObjectVersionOutput,
  type ObjectStorage,
  type TenantScopedVersionAwareObjectStorage,
  type TenantScopedVersionAwareObjectStorageResolver
} from "@hulee/storage";
import { describe, expect, it, vi } from "vitest";

import {
  createInternalFileService,
  createInternalInboxV2FileDownloadService
} from "./internal-file-service";
import type { InboxV2FileDownloadTicketService } from "./inbox-v2-file-download-ticket";
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

describe("internal Inbox V2 exact-version file download service", () => {
  it("issues from server-owned session identity and lets the repository supply the epoch", async () => {
    const harness = createInboxV2DownloadHarness();

    await expect(
      harness.service.issueFileDownload(context, {
        pin: harness.authorized.pin,
        parentLinkId: harness.authorized.parentFence.parentLinkId
      })
    ).resolves.toMatchObject({ ticket: "opaque-signed-ticket" });
    expect(harness.issue).toHaveBeenCalledWith(
      { tenantId, principalId: context.employeeId },
      {
        pin: harness.authorized.pin,
        parentLinkId: harness.authorized.parentFence.parentLinkId
      }
    );
  });

  it("rejects a cross-tenant pin before ticket issuance", async () => {
    const harness = createInboxV2DownloadHarness();

    await expect(
      harness.service.issueFileDownload(context, {
        pin: { ...harness.authorized.pin, tenantId: "tenant-2" },
        parentLinkId: harness.authorized.parentFence.parentLinkId
      })
    ).rejects.toEqual(new CoreError("tenant.boundary_violation"));
    expect(harness.issue).not.toHaveBeenCalled();
  });

  it("resolves a tenant-scoped root and verifies the authorized object version before returning bytes", async () => {
    const harness = createInboxV2DownloadHarness();
    const file = await harness.service.redeemFileDownload(context, {
      ticket: "opaque-signed-ticket"
    });

    expect([...file.body]).toEqual([1, 2, 3]);
    expect(file).toMatchObject({
      fileName: "photo.jpg",
      mediaType: "image/jpeg",
      sizeBytes: 3
    });
    expect(harness.redeem).toHaveBeenCalledWith(
      { tenantId, principalId: context.employeeId },
      { ticket: "opaque-signed-ticket" }
    );
    expect(harness.resolve).toHaveBeenCalledWith({
      tenantId,
      storageRootId: "root:primary"
    });
    expect(harness.getObjectVersion).toHaveBeenCalledWith({
      identity: {
        storageKey: "tenants/tenant-1/files/object-1",
        versionId: "s3-version-1"
      },
      maximumBytes: 3
    });
    expect(harness.getObject).not.toHaveBeenCalled();
  });

  it("rejects a resolver capability for a different tenant before reading bytes", async () => {
    const harness = createInboxV2DownloadHarness({
      scopeTenantId: "tenant-2"
    });

    await expect(
      harness.service.redeemFileDownload(context, {
        ticket: "opaque-signed-ticket"
      })
    ).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(harness.getObjectVersion).not.toHaveBeenCalled();
  });

  it("rejects an authorized record whose key is outside the resolved root", async () => {
    const harness = createInboxV2DownloadHarness({
      storageKey: "tenants/tenant-2/files/object-1"
    });

    await expect(
      harness.service.redeemFileDownload(context, {
        ticket: "opaque-signed-ticket"
      })
    ).rejects.toMatchObject({
      code: "object_storage.provider_capability_missing"
    });
    expect(harness.getObjectVersion).not.toHaveBeenCalled();
  });

  it("requires provider checksum evidence before exposing a response stream", async () => {
    const harness = createInboxV2DownloadHarness({
      providerChecksum: null
    });

    await expect(
      harness.service.redeemFileDownload(context, {
        ticket: "opaque-signed-ticket"
      })
    ).rejects.toMatchObject({ code: "object_storage.integrity_mismatch" });
  });

  it("hashes the stream and rejects bytes that differ from the canonical checksum", async () => {
    const harness = createInboxV2DownloadHarness({
      body: new Uint8Array([1, 2, 4])
    });
    await expect(
      harness.service.redeemFileDownload(context, {
        ticket: "opaque-signed-ticket"
      })
    ).rejects.toMatchObject({ code: "object_storage.integrity_mismatch" });
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

function createInboxV2DownloadHarness(
  input: {
    body?: Uint8Array;
    providerChecksum?: GetObjectVersionOutput["checksumSha256"];
    scopeTenantId?: string;
    storageKey?: string;
  } = {}
) {
  const canonicalBody = new Uint8Array([1, 2, 3]);
  const checksumSha256 = calculateHuleeSha256(canonicalBody);
  const pin = {
    tenantId,
    fileId: "file-1",
    fileRevision: "1",
    fileVersionId: "file-version-1",
    objectVersionId: "object-version-1"
  };
  const authorized = {
    pin,
    parentFence: {
      pin,
      parentLinkId: "parent-link-1",
      parentLinkRevision: "1",
      parentId: "message-1",
      parentRevision: "1",
      contentRevision: "1",
      blockKey: "attachment-1"
    },
    storageRootId: "root:primary",
    storageKey: input.storageKey ?? "tenants/tenant-1/files/object-1",
    storageVersionId: "s3-version-1",
    checksumSha256,
    fileName: "photo.jpg",
    mediaType: "image/jpeg",
    sizeBytes: 3
  };
  const redeem = vi.fn(async () => authorized);
  const issue = vi.fn(async () => ({
    ticket: "opaque-signed-ticket",
    downloadUrl:
      "/internal/inbox-v2/files/download?ticket=opaque-signed-ticket",
    expiresAt: "2026-07-19T00:01:00.000Z"
  }));
  const tickets: InboxV2FileDownloadTicketService = {
    issue,
    redeem
  };
  const getObject = vi.fn(async () => {
    throw new Error("legacy read must not be used");
  });
  const getObjectVersion = vi.fn(
    async (): Promise<GetObjectVersionOutput> => ({
      identity: {
        storageKey: authorized.storageKey,
        versionId: authorized.storageVersionId
      },
      body: byteStream(input.body ?? canonicalBody),
      mediaType: authorized.mediaType,
      checksumSha256:
        input.providerChecksum === undefined
          ? checksumSha256
          : input.providerChecksum,
      objectSizeBytes: authorized.sizeBytes,
      responseSizeBytes: authorized.sizeBytes,
      range: null
    })
  );
  const unsupported = async (): Promise<never> => {
    throw new Error("not used");
  };
  const storage: TenantScopedVersionAwareObjectStorage = {
    scope: {
      tenantId: input.scopeTenantId ?? tenantId,
      storageRootId: authorized.storageRootId,
      keyPrefix: "tenants/tenant-1/"
    },
    capabilities: {
      contractVersion: "1",
      exactVersionIdentity: true,
      immutableConditionalPut: true,
      streamingReads: true,
      boundedRangeReads: true,
      paginatedVersionEnumeration: true,
      deleteMarkerEnumeration: true,
      exactVersionDelete: true,
      applicationQuarantineDeny: true,
      physicalQuarantineEvidence: "version_tags",
      checksumAlgorithm: "sha256",
      providerEntityTagIsChecksum: false,
      originalFileNameInObjectMetadata: false
    },
    putObject: unsupported,
    getObject,
    putObjectImmutable: unsupported,
    getObjectVersion,
    headObjectVersion: unsupported,
    listObjectVersions: unsupported,
    deleteObjectVersion: unsupported,
    quarantineObjectVersion: unsupported,
    probeCapabilities: unsupported
  };
  const resolve = vi.fn(async () => storage);
  const objectStorageResolver: TenantScopedVersionAwareObjectStorageResolver = {
    resolve
  };

  return {
    service: createInternalInboxV2FileDownloadService({
      tickets,
      objectStorageResolver
    }),
    authorized,
    issue,
    redeem,
    resolve,
    getObject,
    getObjectVersion
  };
}

async function* byteStream(body: Uint8Array): AsyncIterable<Uint8Array> {
  yield body;
}
