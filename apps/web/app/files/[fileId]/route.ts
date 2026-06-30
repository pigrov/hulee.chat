import { CoreError } from "@hulee/core";

import {
  buildInternalApiHeaders,
  resolveWebConfig
} from "../../../src/session";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type FileRouteContext = {
  params: Promise<{
    fileId: string;
  }>;
};

export async function GET(
  _request: Request,
  context: FileRouteContext
): Promise<Response> {
  const { fileId } = await context.params;
  const path = `/internal/v1/files/${encodeURIComponent(fileId)}/content`;
  const url = new URL(path, resolveWebConfig().internalApiBaseUrl);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: await buildInternalApiHeaders({
        method: "GET",
        path
      })
    });

    return new Response(response.body, {
      status: response.status,
      headers: proxyFileResponseHeaders(response.headers)
    });
  } catch (error) {
    if (error instanceof CoreError) {
      return new Response(null, {
        status: error.code === "permission.denied" ? 403 : 401
      });
    }

    throw error;
  }
}

function proxyFileResponseHeaders(source: Headers): Headers {
  const headers = new Headers();

  for (const name of [
    "content-type",
    "content-length",
    "content-disposition",
    "cache-control",
    "x-content-type-options"
  ]) {
    const value = source.get(name);

    if (value !== null) {
      headers.set(name, value);
    }
  }

  return headers;
}
