import { z } from "zod";

import { parseInboxV2VersionedEnvelope } from "./schema-version";
import { inboxV2InvalidationScopeSchema } from "./sync-primitives";
import {
  INBOX_V2_MAX_RECIPIENT_VALUE_BYTES,
  INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION
} from "./recipient-sync-constants";

const forbiddenRecipientPayloadKeys = new Set([
  "rawpayload",
  "providerpayload",
  "rawproviderpayload",
  "accesstoken",
  "refreshtoken",
  "password",
  "clientsecret",
  "sessioncookie",
  "authorizationheader",
  "authchallenge"
]);

export function containsForbiddenRecipientPayloadKey(value: unknown): boolean {
  const queue: unknown[] = [value];
  let visited = 0;
  while (queue.length > 0 && visited < 10_000) {
    const current = queue.pop();
    visited += 1;
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }
    if (current === null || typeof current !== "object") {
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, "");
      if (forbiddenRecipientPayloadKeys.has(normalizedKey)) {
        return true;
      }
      queue.push(nested);
    }
  }
  return queue.length > 0;
}

export function isBoundedJsonRecipientValue(value: unknown): boolean {
  const queue: Readonly<{ value: unknown; depth: number }>[] = [
    { value, depth: 0 }
  ];
  const ancestors = new WeakSet<object>();
  let visited = 0;
  let estimatedBytes = 0;
  while (queue.length > 0) {
    const current = queue.pop()!;
    visited += 1;
    if (visited > 10_000 || current.depth > 64) {
      return false;
    }
    if (
      current.value === null ||
      typeof current.value === "boolean" ||
      (typeof current.value === "number" && Number.isFinite(current.value))
    ) {
      estimatedBytes += 24;
      continue;
    }
    if (typeof current.value === "string") {
      estimatedBytes += utf8ByteLength(current.value);
      if (estimatedBytes > INBOX_V2_MAX_RECIPIENT_VALUE_BYTES) {
        return false;
      }
      continue;
    }
    if (typeof current.value !== "object") {
      return false;
    }
    if (ancestors.has(current.value)) {
      return false;
    }
    ancestors.add(current.value);
    if (Array.isArray(current.value)) {
      for (const nested of current.value) {
        queue.push({ value: nested, depth: current.depth + 1 });
      }
      continue;
    }
    const prototype = Object.getPrototypeOf(current.value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      return false;
    }
    for (const [key, nested] of Object.entries(current.value)) {
      estimatedBytes += utf8ByteLength(key);
      if (estimatedBytes > INBOX_V2_MAX_RECIPIENT_VALUE_BYTES) {
        return false;
      }
      queue.push({ value: nested, depth: current.depth + 1 });
    }
  }
  return true;
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

export function jsonUtf8ByteLength(value: unknown): number {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined
      ? Number.POSITIVE_INFINITY
      : utf8ByteLength(serialized);
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function invalidationScopeBelongsToTenant(
  scope: z.infer<typeof inboxV2InvalidationScopeSchema>,
  tenantId: string
): boolean {
  return scope.kind === "conversation"
    ? scope.conversation.tenantId === tenantId
    : scope.kind === "entity"
      ? scope.entity.tenantId === tenantId
      : true;
}

export function sameJsonValue(left: unknown, right: unknown): boolean {
  return canonicalJsonValue(left) === canonicalJsonValue(right);
}

function canonicalJsonValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJsonValue).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, nested]) =>
          `${JSON.stringify(key)}:${canonicalJsonValue(nested)}`
      )
      .join(",")}}`;
  }

  return JSON.stringify(value) ?? "undefined";
}

export function parseVersionedSyncEnvelope<TSchema extends z.ZodType>(
  input: unknown,
  schemaId: string,
  supportedV1Schema: TSchema
) {
  return parseInboxV2VersionedEnvelope({
    value: input,
    schemaId,
    supportedSchemas: {
      [INBOX_V2_RECIPIENT_SYNC_SCHEMA_VERSION]: supportedV1Schema
    },
    invalidErrorCode: "sync.envelope_invalid",
    unsupportedErrorCode: "sync.schema_unsupported"
  });
}
