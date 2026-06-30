import type { TenantId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import type { FileAccessRepository } from "@hulee/db";
import type { ObjectStorage } from "@hulee/storage";

import type {
  InternalInboxAuthorizationService,
  InternalInboxCommandContext
} from "./internal-inbox-service";

export type InternalFileContent = {
  fileId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  body: Uint8Array;
};

export type InternalFileService = {
  loadFileContent(
    context: InternalInboxCommandContext,
    input: { fileId: string }
  ): Promise<InternalFileContent>;
};

export type InternalFileServiceOptions = {
  repository: FileAccessRepository;
  authorization: InternalInboxAuthorizationService;
  objectStorage?: ObjectStorage;
};

export function createInternalFileService(
  options: InternalFileServiceOptions
): InternalFileService {
  return {
    async loadFileContent(context, input) {
      const file = await options.repository.findFileContentAccess({
        tenantId: context.tenantId,
        fileId: input.fileId
      });

      if (file === null) {
        throw new CoreError("tenant.not_found");
      }

      assertSameTenant(context.tenantId, file.tenantId);
      await options.authorization.assertConversationAccess(context, {
        conversation: file.conversation,
        permission: "files.view"
      });

      if (file.status !== "stored") {
        throw new CoreError("validation.failed");
      }

      if (options.objectStorage === undefined) {
        throw new CoreError(
          "validation.failed",
          "Object storage is not configured."
        );
      }

      const object = await options.objectStorage.getObject({
        storageKey: file.storageKey
      });

      return {
        fileId: file.fileId,
        fileName: file.fileName,
        mediaType: object.mediaType ?? file.mediaType,
        sizeBytes: object.sizeBytes ?? file.sizeBytes,
        body: object.body
      };
    }
  };
}

function assertSameTenant(
  expectedTenantId: TenantId,
  actualTenantId: TenantId
) {
  if (actualTenantId !== expectedTenantId) {
    throw new CoreError("tenant.boundary_violation");
  }
}
