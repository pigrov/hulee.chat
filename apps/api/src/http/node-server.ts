import { createServer, type IncomingMessage, type ServerResponse } from "http";

import type {
  ApiHttpHandler,
  ApiHttpMethod,
  ApiHttpRequest,
  ApiHttpResponse
} from "./public-api-handler";

const supportedMethods = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

export type ApiNodeServerOptions = {
  handler: ApiHttpHandler;
  maxBodyBytes?: number;
};

export function createApiNodeServer(options: ApiNodeServerOptions) {
  const maxBodyBytes = options.maxBodyBytes ?? 1_048_576;

  return createServer(async (request, response) => {
    try {
      const apiRequest = await toApiHttpRequest(request, maxBodyBytes);
      const apiResponse = await options.handler.handle(apiRequest);

      writeApiResponse(response, apiResponse);
    } catch {
      writeApiResponse(response, {
        status: 400,
        headers: {
          "content-type": "application/json; charset=utf-8"
        },
        body: {
          error: {
            code: "validation.failed",
            messageKey: "errors.validation.failed",
            retryability: "not_retryable",
            requestId: "unparsed-request"
          }
        }
      });
    }
  });
}

async function toApiHttpRequest(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<ApiHttpRequest> {
  const method = normalizeMethod(request.method);
  const body = await readJsonBody(request, maxBodyBytes);

  return {
    method,
    path: request.url ?? "/",
    headers: normalizeHeaders(request.headers),
    body
  };
}

function normalizeMethod(method: string | undefined): ApiHttpMethod {
  if (supportedMethods.includes(method as ApiHttpMethod)) {
    return method as ApiHttpMethod;
  }

  return "GET";
}

function normalizeHeaders(
  headers: IncomingMessage["headers"]
): Record<string, string | undefined> {
  const normalized: Record<string, string | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    normalized[key] = Array.isArray(value) ? value.join(",") : value;
  }

  return normalized;
}

async function readJsonBody(
  request: IncomingMessage,
  maxBodyBytes: number
): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;

    if (size > maxBodyBytes) {
      throw new Error("Request body is too large");
    }

    chunks.push(buffer);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  const raw = Buffer.concat(chunks).toString("utf8").trim();

  if (raw.length === 0) {
    return undefined;
  }

  return JSON.parse(raw);
}

function writeApiResponse(
  response: ServerResponse,
  apiResponse: ApiHttpResponse
): void {
  response.statusCode = apiResponse.status;

  for (const [name, value] of Object.entries(apiResponse.headers)) {
    response.setHeader(name, value);
  }

  if (apiResponse.body instanceof Uint8Array) {
    response.end(apiResponse.body);
    return;
  }

  response.end(JSON.stringify(apiResponse.body));
}
