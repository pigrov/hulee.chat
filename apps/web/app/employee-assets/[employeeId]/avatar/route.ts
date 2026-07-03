import type { EmployeeId } from "@hulee/contracts";
import { CoreError } from "@hulee/core";
import { createSqlEmployeeDirectoryRepository } from "@hulee/db";
import { createS3ObjectStorage } from "@hulee/storage";

import {
  canUseLocalBrandAssetStorage,
  getLocalBrandAsset,
  isLocalBrandAssetStorageKey
} from "../../../../src/local-brand-asset-storage";
import {
  getWebDatabase,
  requireCurrentWebAccessSession,
  resolveWebConfig
} from "../../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type EmployeeAvatarRouteContext = {
  params: Promise<{
    employeeId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: EmployeeAvatarRouteContext
): Promise<Response> {
  const session = await resolveAvatarSession();

  if (session instanceof Response) {
    return session;
  }

  const { employeeId: employeeIdParam } = await context.params;
  const employeeId = decodeURIComponent(employeeIdParam);
  const employee = await createSqlEmployeeDirectoryRepository(
    getWebDatabase()
  ).findEmployee({
    tenantId: session.tenantId,
    employeeId: employeeId as EmployeeId
  });
  const avatar = employee?.avatar;

  if (avatar === undefined || avatar === null) {
    return new Response(null, { status: 404 });
  }

  if (isLocalBrandAssetStorageKey(avatar.storageKey)) {
    if (!canUseLocalBrandAssetStorage()) {
      return new Response(null, { status: 503 });
    }

    try {
      const body = await getLocalBrandAsset({ storageKey: avatar.storageKey });

      return new Response(toArrayBuffer(body), {
        status: 200,
        headers: employeeAvatarHeaders({
          mediaType: avatar.mediaType,
          sizeBytes: avatar.sizeBytes
        })
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  }

  const config = resolveWebConfig();

  if (!config.objectStorage) {
    return new Response(null, { status: 503 });
  }

  const object = await createS3ObjectStorage(config.objectStorage).getObject({
    storageKey: avatar.storageKey
  });

  return new Response(toArrayBuffer(object.body), {
    status: 200,
    headers: employeeAvatarHeaders({
      mediaType: object.mediaType ?? avatar.mediaType,
      sizeBytes: object.sizeBytes ?? avatar.sizeBytes
    })
  });
}

async function resolveAvatarSession() {
  try {
    return await requireCurrentWebAccessSession();
  } catch (error) {
    if (error instanceof CoreError) {
      return new Response(null, {
        status: error.code === "permission.denied" ? 403 : 401
      });
    }

    throw error;
  }
}

function employeeAvatarHeaders(input: {
  mediaType?: string;
  sizeBytes?: number;
}): Headers {
  const headers = new Headers({
    "content-type": safeEmployeeAvatarMediaType(input.mediaType),
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff"
  });

  if (input.sizeBytes !== undefined) {
    headers.set("content-length", String(input.sizeBytes));
  }

  return headers;
}

function safeEmployeeAvatarMediaType(mediaType: string | undefined): string {
  return mediaType === "image/png" ||
    mediaType === "image/jpeg" ||
    mediaType === "image/webp"
    ? mediaType
    : "application/octet-stream";
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const body = new ArrayBuffer(bytes.byteLength);

  new Uint8Array(body).set(bytes);

  return body;
}
