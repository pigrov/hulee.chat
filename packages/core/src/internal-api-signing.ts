import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export type InternalApiSignatureInput = {
  method: string;
  path: string;
  body?: unknown;
  tenantId: string;
  employeeId: string;
  permissions: readonly string[];
  timestamp: string;
};

export type InternalApiSignatureVerificationInput =
  InternalApiSignatureInput & {
    secret: string | undefined;
    signature: string | undefined;
    now: Date;
    maxAgeMs?: number;
  };

export const internalApiTimestampHeader = "x-hulee-internal-timestamp";
export const internalApiSignatureHeader = "x-hulee-internal-signature";

const signatureVersion = "v1";
const defaultMaxAgeMs = 5 * 60 * 1000;

export function createInternalApiSignature(
  secret: string,
  input: InternalApiSignatureInput
): string {
  const digest = createHmac("sha256", secret)
    .update(canonicalInternalApiSignaturePayload(input))
    .digest("hex");

  return `${signatureVersion}=${digest}`;
}

export function verifyInternalApiSignature(
  input: InternalApiSignatureVerificationInput
): boolean {
  if (!input.secret || !input.signature) {
    return false;
  }

  const timestamp = Date.parse(input.timestamp);

  if (Number.isNaN(timestamp)) {
    return false;
  }

  const maxAgeMs = input.maxAgeMs ?? defaultMaxAgeMs;
  const ageMs = Math.abs(input.now.getTime() - timestamp);

  if (ageMs > maxAgeMs) {
    return false;
  }

  const expected = createInternalApiSignature(input.secret, input);

  return safeEqual(input.signature, expected);
}

export function canonicalInternalApiSignaturePayload(
  input: InternalApiSignatureInput
): string {
  return [
    input.method.toUpperCase(),
    input.path,
    input.timestamp,
    hashCanonicalBody(input.body),
    input.tenantId,
    input.employeeId,
    [...input.permissions].sort().join(",")
  ].join("\n");
}

function hashCanonicalBody(body: unknown): string {
  return createHash("sha256").update(stableStringify(body)).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === undefined) {
    return "";
  }

  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(record[key])}`;
    });

  return `{${entries.join(",")}}`;
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
