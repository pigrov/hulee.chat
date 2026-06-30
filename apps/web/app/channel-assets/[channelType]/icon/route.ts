import { internalChannelTypeSchema } from "@hulee/contracts";
import { createSqlDeploymentChannelCatalogOverrideRepository } from "@hulee/db";
import { createS3ObjectStorage } from "@hulee/storage";

import { getWebDatabase, resolveWebConfig } from "../../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type ChannelIconRouteContext = {
  params: Promise<{
    channelType: string;
  }>;
};

export async function GET(
  _request: Request,
  context: ChannelIconRouteContext
): Promise<Response> {
  const { channelType: rawChannelType } = await context.params;
  const parsedChannelType = internalChannelTypeSchema.safeParse(rawChannelType);

  if (!parsedChannelType.success) {
    return new Response(null, { status: 404 });
  }

  const config = resolveWebConfig();

  if (!config.objectStorage) {
    return new Response(null, { status: 503 });
  }

  const override = await createSqlDeploymentChannelCatalogOverrideRepository(
    getWebDatabase()
  ).findOverride(parsedChannelType.data);

  if (!override?.iconAssetRef) {
    return new Response(null, { status: 404 });
  }

  const object = await createS3ObjectStorage(config.objectStorage).getObject({
    storageKey: override.iconAssetRef
  });

  return new Response(toArrayBuffer(object.body), {
    status: 200,
    headers: iconHeaders({
      mediaType: object.mediaType,
      sizeBytes: object.sizeBytes
    })
  });
}

function iconHeaders(input: {
  mediaType?: string;
  sizeBytes?: number;
}): Headers {
  const headers = new Headers({
    "content-type": safeIconMediaType(input.mediaType),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff"
  });

  if (input.sizeBytes !== undefined) {
    headers.set("content-length", String(input.sizeBytes));
  }

  return headers;
}

function safeIconMediaType(mediaType: string | undefined): string {
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
