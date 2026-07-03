import { CoreError } from "@hulee/core";
import { createS3ObjectStorage } from "@hulee/storage";
import { sql } from "drizzle-orm";

import {
  getWebDatabase,
  requireCurrentWebAccessSession,
  resolveWebConfig
} from "../../../../src/session";
import {
  canUseLocalBrandAssetStorage,
  getLocalBrandAsset,
  isLocalBrandAssetStorageKey
} from "../../../../src/local-brand-asset-storage";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type BrandAssetRouteContext = {
  params: Promise<{
    assetId: string;
    fileName: string;
  }>;
};

type TenantBrandAssetRow = {
  storage_key: string;
  media_type: string;
  size_bytes: number;
};

export async function GET(
  _request: Request,
  context: BrandAssetRouteContext
): Promise<Response> {
  const session = await resolveAssetSession();

  if (session instanceof Response) {
    return session;
  }

  const { assetId } = await context.params;
  const result = await getWebDatabase().execute<TenantBrandAssetRow>(sql`
    select storage_key,
           media_type,
           size_bytes
    from tenant_brand_assets
    where id = ${assetId}
      and tenant_id = ${session.tenantId}
    limit 1
  `);
  const asset = result.rows[0];

  if (!asset) {
    return new Response(null, { status: 404 });
  }

  if (isLocalBrandAssetStorageKey(asset.storage_key)) {
    if (!canUseLocalBrandAssetStorage()) {
      return new Response(null, { status: 503 });
    }

    try {
      const body = await getLocalBrandAsset({ storageKey: asset.storage_key });

      return new Response(toArrayBuffer(body), {
        status: 200,
        headers: brandAssetHeaders({
          mediaType: asset.media_type,
          sizeBytes: asset.size_bytes
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
    storageKey: asset.storage_key
  });

  return new Response(toArrayBuffer(object.body), {
    status: 200,
    headers: brandAssetHeaders({
      mediaType: object.mediaType ?? asset.media_type,
      sizeBytes: object.sizeBytes ?? asset.size_bytes
    })
  });
}

async function resolveAssetSession() {
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

function brandAssetHeaders(input: {
  mediaType?: string;
  sizeBytes?: number;
}): Headers {
  const headers = new Headers({
    "content-type": safeBrandImageMediaType(input.mediaType),
    "cache-control": "private, max-age=86400",
    "x-content-type-options": "nosniff"
  });

  if (input.sizeBytes !== undefined) {
    headers.set("content-length", String(input.sizeBytes));
  }

  return headers;
}

function safeBrandImageMediaType(mediaType: string | undefined): string {
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
