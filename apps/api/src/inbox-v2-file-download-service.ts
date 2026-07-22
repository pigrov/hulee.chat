import { createHash } from "node:crypto";

import { CoreError, type InboxV2FileObjectPin } from "@hulee/core";
import {
  ObjectStorageError,
  parseHuleeSha256,
  type HuleeSha256,
  type TenantScopedVersionAwareObjectStorageResolver
} from "@hulee/storage";

import type { InboxV2FileDownloadTicketService } from "./inbox-v2-file-download-ticket";

export const DEFAULT_INBOX_V2_FILE_DOWNLOAD_MAXIMUM_BYTES = 64 * 1024 * 1024;

export type InboxV2FileDownloadContext = Readonly<{
  requestId: string;
  tenantId: string;
  employeeId: string;
}>;

export type InboxV2FileDownloadContent = {
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  /** Fully verified bounded bytes; HTTP headers are not written before this resolves. */
  body: Uint8Array;
};

export type InboxV2FileDownloadService = {
  issueFileDownload(
    context: InboxV2FileDownloadContext,
    input: Readonly<{
      pin: InboxV2FileObjectPin;
      parentLinkId: string;
    }>
  ): Promise<
    Readonly<{ ticket: string; downloadUrl: string; expiresAt: string }>
  >;
  redeemFileDownload(
    context: InboxV2FileDownloadContext,
    input: Readonly<{ ticket: string }>
  ): Promise<InboxV2FileDownloadContent>;
};

export type InboxV2FileDownloadServiceOptions = {
  tickets: InboxV2FileDownloadTicketService;
  objectStorageResolver: TenantScopedVersionAwareObjectStorageResolver;
  maximumDownloadBytes?: number;
};

/**
 * Redeems an application ticket and streams only the exact immutable object
 * version authorized by that ticket's freshly reloaded access record.
 */
export function createInboxV2FileDownloadService(
  options: InboxV2FileDownloadServiceOptions
): InboxV2FileDownloadService {
  const maximumDownloadBytes =
    options.maximumDownloadBytes ??
    DEFAULT_INBOX_V2_FILE_DOWNLOAD_MAXIMUM_BYTES;

  if (!Number.isSafeInteger(maximumDownloadBytes) || maximumDownloadBytes < 1) {
    throw new Error("maximumDownloadBytes must be a positive safe integer.");
  }

  return {
    async issueFileDownload(context, input) {
      if (input.pin.tenantId !== context.tenantId) {
        throw new CoreError("tenant.boundary_violation");
      }
      return options.tickets.issue(
        {
          tenantId: context.tenantId,
          principalId: context.employeeId
        },
        input
      );
    },

    async redeemFileDownload(context, input) {
      const authorized = await options.tickets.redeem(
        {
          tenantId: context.tenantId,
          principalId: context.employeeId
        },
        input
      );
      assertAuthorizedSize(authorized.sizeBytes, maximumDownloadBytes);
      const checksumSha256 = authorizedChecksum(authorized.checksumSha256);
      const objectStorage = await options.objectStorageResolver.resolve({
        tenantId: context.tenantId,
        storageRootId: authorized.storageRootId
      });
      if (objectStorage === null) {
        throw new ObjectStorageError(
          "object_storage.not_found",
          "The authorized tenant object-storage root is unavailable."
        );
      }
      if (
        objectStorage.scope.tenantId !== context.tenantId ||
        objectStorage.scope.storageRootId !== authorized.storageRootId ||
        !authorized.storageKey.startsWith(objectStorage.scope.keyPrefix) ||
        authorized.storageKey.length === objectStorage.scope.keyPrefix.length
      ) {
        throw new ObjectStorageError(
          "object_storage.provider_capability_missing",
          "Object-storage resolver returned a capability for a different tenant, root or key scope."
        );
      }

      const identity = {
        storageKey: authorized.storageKey,
        versionId: authorized.storageVersionId
      };
      const object = await objectStorage.getObjectVersion({
        identity,
        // Storage requires a positive bound. The exact-size wrapper below also
        // rejects any byte for an authorized empty object.
        maximumBytes: Math.max(1, authorized.sizeBytes)
      });

      if (
        object.identity.storageKey !== identity.storageKey ||
        object.identity.versionId !== identity.versionId ||
        object.range !== null ||
        (object.objectSizeBytes !== null &&
          object.objectSizeBytes !== authorized.sizeBytes) ||
        (object.responseSizeBytes !== null &&
          object.responseSizeBytes !== authorized.sizeBytes) ||
        object.checksumSha256 === null ||
        object.checksumSha256 !== checksumSha256
      ) {
        throw integrityMismatch(
          "Object storage returned metadata for a different or non-exact response."
        );
      }

      return {
        fileName: authorized.fileName,
        mediaType: authorized.mediaType,
        sizeBytes: authorized.sizeBytes,
        body: await readExactDownloadBytes(
          object.body,
          authorized.sizeBytes,
          checksumSha256
        )
      };
    }
  };
}

function assertAuthorizedSize(
  sizeBytes: number,
  maximumDownloadBytes: number
): void {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes < 0) {
    throw integrityMismatch(
      "Authorized file size is not a non-negative integer."
    );
  }
  if (sizeBytes > maximumDownloadBytes) {
    throw new ObjectStorageError(
      "object_storage.read_bound_exceeded",
      `Authorized file exceeds the ${maximumDownloadBytes}-byte download bound.`
    );
  }
}

async function readExactDownloadBytes(
  body: AsyncIterable<Uint8Array>,
  expectedSizeBytes: number,
  expectedChecksumSha256: HuleeSha256
): Promise<Uint8Array> {
  let observedSizeBytes = 0;
  const hash = createHash("sha256");
  const verifiedBytes = new Uint8Array(expectedSizeBytes);

  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array)) {
      throw integrityMismatch("Object storage emitted a non-binary chunk.");
    }
    observedSizeBytes += chunk.byteLength;
    if (observedSizeBytes > expectedSizeBytes) {
      throw integrityMismatch(
        `Object storage emitted more than ${expectedSizeBytes} authorized bytes.`
      );
    }
    hash.update(chunk);
    verifiedBytes.set(chunk, observedSizeBytes - chunk.byteLength);
  }

  if (observedSizeBytes !== expectedSizeBytes) {
    throw integrityMismatch(
      `Object storage emitted ${observedSizeBytes} bytes instead of ${expectedSizeBytes}.`
    );
  }

  const observedChecksumSha256 = `sha256:${hash.digest("hex")}`;
  if (observedChecksumSha256 !== expectedChecksumSha256) {
    throw integrityMismatch(
      "Object storage emitted bytes with a different canonical SHA-256 checksum."
    );
  }
  return verifiedBytes;
}

function authorizedChecksum(value: HuleeSha256): HuleeSha256 {
  try {
    return parseHuleeSha256(value);
  } catch (error) {
    throw integrityMismatch(
      error instanceof Error
        ? error.message
        : "Authorized file checksum is not canonical."
    );
  }
}

function integrityMismatch(message: string): ObjectStorageError {
  return new ObjectStorageError("object_storage.integrity_mismatch", message);
}
