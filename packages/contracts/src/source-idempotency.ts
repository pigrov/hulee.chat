import { z } from "zod";

import type {
  SourceAccountId,
  SourceConnectionId,
  SourceEventType
} from "./index";

export const sourceInboundTransportSchema = z.enum([
  "webhook",
  "polling",
  "email",
  "api"
]);

export const sourceIdempotencyPhaseSchema = z.enum(["raw", "normalized"]);

export const sourceIdempotencyIdentityKindSchema = z.enum([
  "client_key",
  "external_event",
  "event_signature",
  "fingerprint"
]);

export const sourceIdempotencyKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .refine((value) => value.startsWith("source:v1:"), {
    message: "Source idempotency keys must use the source:v1 prefix."
  });

export type SourceInboundTransport = z.infer<
  typeof sourceInboundTransportSchema
>;

export type SourceIdempotencyPhase = z.infer<
  typeof sourceIdempotencyPhaseSchema
>;

export type SourceIdempotencyIdentityKind = z.infer<
  typeof sourceIdempotencyIdentityKindSchema
>;

export type CreateSourceIdempotencyKeyInput = {
  phase: SourceIdempotencyPhase;
  transport: SourceInboundTransport;
  sourceConnectionId: SourceConnectionId | string;
  sourceAccountId?: SourceAccountId | string | null;
  sourceEventType?: SourceEventType | string | null;
  clientKey?: string | null;
  externalEventId?: string | null;
  eventSignature?: string | null;
  fingerprint?: string | null;
};

export type CreateRawSourceIdempotencyKeyInput = Omit<
  CreateSourceIdempotencyKeyInput,
  "phase" | "sourceEventType"
>;

export type CreateNormalizedSourceIdempotencyKeyInput = Omit<
  CreateSourceIdempotencyKeyInput,
  "phase"
> & {
  sourceEventType: SourceEventType | string;
};

export function createSourceIdempotencyKey(
  input: CreateSourceIdempotencyKeyInput
): string {
  const transport = sourceInboundTransportSchema.parse(input.transport);
  const phase = sourceIdempotencyPhaseSchema.parse(input.phase);
  const identity = selectSourceIdempotencyIdentity(input);
  const key = [
    "source",
    "v1",
    phase,
    transport,
    segment(input.sourceConnectionId),
    segment(input.sourceAccountId ?? "_"),
    segment(phase === "normalized" ? (input.sourceEventType ?? "_") : "_"),
    identity.kind,
    segment(identity.value)
  ].join(":");

  return sourceIdempotencyKeySchema.parse(key);
}

export function createRawSourceIdempotencyKey(
  input: CreateRawSourceIdempotencyKeyInput
): string {
  return createSourceIdempotencyKey({
    ...input,
    phase: "raw"
  });
}

export function createNormalizedSourceIdempotencyKey(
  input: CreateNormalizedSourceIdempotencyKeyInput
): string {
  return createSourceIdempotencyKey({
    ...input,
    phase: "normalized"
  });
}

function selectSourceIdempotencyIdentity(
  input: CreateSourceIdempotencyKeyInput
): { kind: SourceIdempotencyIdentityKind; value: string } {
  const candidates =
    input.transport === "api"
      ? [
          ["client_key", input.clientKey],
          ["external_event", input.externalEventId],
          ["event_signature", input.eventSignature],
          ["fingerprint", input.fingerprint]
        ]
      : [
          ["external_event", input.externalEventId],
          ["event_signature", input.eventSignature],
          ["client_key", input.clientKey],
          ["fingerprint", input.fingerprint]
        ];

  for (const [kind, value] of candidates) {
    const normalized = normalizeValue(value);

    if (normalized) {
      return {
        kind: sourceIdempotencyIdentityKindSchema.parse(kind),
        value: normalized
      };
    }
  }

  throw new Error(
    "Source idempotency key requires clientKey, externalEventId, eventSignature or fingerprint."
  );
}

function segment(value: string | number | boolean): string {
  return encodeURIComponent(String(value).trim());
}

function normalizeValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();

  return normalized.length > 0 ? normalized : null;
}
