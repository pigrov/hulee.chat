import { createHash } from "node:crypto";

export const HULEE_SHA256_PATTERN = /^sha256:([a-f0-9]{64})$/u;

export type HuleeSha256 = `sha256:${string}`;

export function parseHuleeSha256(value: string): HuleeSha256 {
  if (!HULEE_SHA256_PATTERN.test(value)) {
    throw new Error(
      "Hulee SHA-256 must use the canonical sha256:<64 lowercase hex> form."
    );
  }

  return value as HuleeSha256;
}

export function calculateHuleeSha256(body: Uint8Array): HuleeSha256 {
  return `sha256:${createHash("sha256").update(body).digest("hex")}`;
}

export function huleeSha256ToS3Checksum(value: HuleeSha256): string {
  const canonical = parseHuleeSha256(value);
  return Buffer.from(canonical.slice("sha256:".length), "hex").toString(
    "base64"
  );
}

export function s3ChecksumToHuleeSha256(value: string): HuleeSha256 {
  if (value.length === 0 || !/^[A-Za-z0-9+/]+={0,2}$/u.test(value)) {
    throw new Error("S3 SHA-256 checksum must be canonical base64.");
  }

  const bytes = Buffer.from(value, "base64");
  if (bytes.byteLength !== 32 || bytes.toString("base64") !== value) {
    throw new Error("S3 SHA-256 checksum must decode to exactly 32 bytes.");
  }

  return parseHuleeSha256(`sha256:${bytes.toString("hex")}`);
}
