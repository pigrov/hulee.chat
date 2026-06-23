import { CoreError } from "@hulee/core";
import { headers } from "next/headers";

import { resolveWebConfig } from "./web-config";

export type HeaderReader = {
  get(name: string): string | null;
};

export type ValidateSameOriginRequestInput = {
  headers: HeaderReader;
  allowedOrigins?: readonly string[];
  publicBaseUrl?: string;
  nodeEnv?: string;
};

export type SameOriginRequestDecision =
  | {
      allowed: true;
      origin: string;
    }
  | {
      allowed: false;
      reason: "missing_origin" | "origin_mismatch";
      origin?: string;
    };

export async function assertWebActionRequest(): Promise<void> {
  const config = resolveWebConfig();
  const decision = validateSameOriginRequest({
    headers: await headers(),
    allowedOrigins: config.webAllowedOrigins,
    publicBaseUrl: config.publicBaseUrl,
    nodeEnv: config.nodeEnv
  });

  if (!decision.allowed) {
    throw new CoreError("auth.invalid_credentials");
  }
}

export function validateSameOriginRequest(
  input: ValidateSameOriginRequestInput
): SameOriginRequestDecision {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const requestOrigin = requestOriginFromHeaders(input.headers);

  if (requestOrigin === undefined) {
    return nodeEnv === "production"
      ? {
          allowed: false,
          reason: "missing_origin"
        }
      : {
          allowed: true,
          origin: "missing"
        };
  }

  const trustedOrigins = resolveTrustedOrigins(input);

  return trustedOrigins.has(requestOrigin)
    ? {
        allowed: true,
        origin: requestOrigin
      }
    : {
        allowed: false,
        reason: "origin_mismatch",
        origin: requestOrigin
      };
}

function requestOriginFromHeaders(headers: HeaderReader): string | undefined {
  const originHeader = headers.get("origin");

  if (originHeader !== null && originHeader.trim().length > 0) {
    return normalizeOrigin(originHeader);
  }

  return normalizeOrigin(headers.get("referer"));
}

function resolveTrustedOrigins(
  input: ValidateSameOriginRequestInput
): Set<string> {
  const nodeEnv = input.nodeEnv ?? process.env.NODE_ENV ?? "development";
  const origins = new Set<string>();

  addOrigin(origins, input.publicBaseUrl);

  for (const origin of input.allowedOrigins ?? []) {
    addOrigin(origins, origin);
  }

  if (nodeEnv !== "production") {
    addOrigin(origins, currentRequestOrigin(input.headers));
  }

  return origins;
}

function currentRequestOrigin(headers: HeaderReader): string | undefined {
  const host =
    firstHeaderValue(headers.get("x-forwarded-host")) ??
    firstHeaderValue(headers.get("host"));

  if (host === undefined) {
    return undefined;
  }

  const protocol =
    firstHeaderValue(headers.get("x-forwarded-proto")) ??
    forwardedProto(headers.get("forwarded")) ??
    "https";

  return normalizeOrigin(`${protocol}://${host}`);
}

function addOrigin(origins: Set<string>, value: string | undefined): void {
  const origin = normalizeOrigin(value);

  if (origin !== undefined) {
    origins.add(origin);
  }
}

function normalizeOrigin(value: string | null | undefined): string | undefined {
  const rawValue = value?.trim();

  if (rawValue === undefined || rawValue.length === 0) {
    return undefined;
  }

  try {
    const url = new URL(rawValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin === "null"
    ) {
      return undefined;
    }

    return url.origin;
  } catch {
    return undefined;
  }
}

function firstHeaderValue(value: string | null): string | undefined {
  const first = value?.split(",")[0]?.trim();

  return first && first.length > 0 ? first : undefined;
}

function forwardedProto(value: string | null): string | undefined {
  if (value === null) {
    return undefined;
  }

  const match = /(?:^|;)\s*proto="?([^";,]+)"?/i.exec(value);
  const proto = match?.[1]?.trim();

  return proto && proto.length > 0 ? proto : undefined;
}
