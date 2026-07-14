import { z } from "zod";

import { inboxV2AuthorizationEpochSchema } from "./authorization-epoch";
import { inboxV2EntityRevisionSchema } from "./entity-metadata";
import {
  inboxV2RecipientStateFingerprintSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

export const inboxV2EntityRevisionStateSchema = z.discriminatedUnion(
  "operation",
  [
    z
      .object({
        revision: inboxV2EntityRevisionSchema,
        operation: z.literal("upsert"),
        stateHash: inboxV2RecipientStateFingerprintSchema
      })
      .strict(),
    z
      .object({
        revision: inboxV2EntityRevisionSchema,
        operation: z.literal("tombstone"),
        stateHash: inboxV2Sha256DigestSchema
      })
      .strict(),
    z
      .object({
        revision: inboxV2EntityRevisionSchema,
        operation: z.literal("invalidate"),
        stateHash: z.union([
          inboxV2RecipientStateFingerprintSchema,
          inboxV2Sha256DigestSchema
        ]),
        invalidationHash: inboxV2Sha256DigestSchema
      })
      .strict()
  ]
);

export const inboxV2SecurityPurgeApplicationDecisionSchema =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("purge") }).strict(),
    z.object({ kind: z.literal("duplicate") }).strict(),
    z
      .object({
        kind: z.literal("resync_required"),
        errorCode: z.literal("sync.scope_changed")
      })
      .strict()
  ]);

export function decideInboxV2SecurityPurgeApplication(input: {
  activeAuthorizationEpoch: string;
  previousAuthorizationEpoch: string;
  resultingAuthorizationEpoch: string;
}): z.infer<typeof inboxV2SecurityPurgeApplicationDecisionSchema> {
  const active = inboxV2AuthorizationEpochSchema.parse(
    input.activeAuthorizationEpoch
  );
  const previous = inboxV2AuthorizationEpochSchema.parse(
    input.previousAuthorizationEpoch
  );
  const resulting = inboxV2AuthorizationEpochSchema.parse(
    input.resultingAuthorizationEpoch
  );
  if (previous === resulting) {
    return { kind: "resync_required", errorCode: "sync.scope_changed" };
  }
  if (active === previous) {
    return { kind: "purge" };
  }
  return active === resulting
    ? { kind: "duplicate" }
    : { kind: "resync_required", errorCode: "sync.scope_changed" };
}

export const inboxV2EntityChangeApplicationDecisionSchema =
  z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("apply") }).strict(),
    z.object({ kind: z.literal("stale") }).strict(),
    z.object({ kind: z.literal("duplicate") }).strict(),
    z
      .object({
        kind: z.literal("conflict"),
        errorCode: z.literal("sync.revision_conflict")
      })
      .strict()
  ]);

export function decideInboxV2EntityChangeApplication(input: {
  current: z.input<typeof inboxV2EntityRevisionStateSchema> | null;
  incoming: z.input<typeof inboxV2EntityRevisionStateSchema>;
}): z.infer<typeof inboxV2EntityChangeApplicationDecisionSchema> {
  const incoming = inboxV2EntityRevisionStateSchema.parse(input.incoming);
  if (input.current === null) {
    return { kind: "apply" };
  }
  const current = inboxV2EntityRevisionStateSchema.parse(input.current);
  const comparison =
    BigInt(incoming.revision) < BigInt(current.revision)
      ? -1
      : BigInt(incoming.revision) > BigInt(current.revision)
        ? 1
        : 0;
  if (comparison < 0) {
    return { kind: "stale" };
  }
  if (comparison > 0) {
    return { kind: "apply" };
  }
  if (incoming.stateHash !== current.stateHash) {
    return { kind: "conflict", errorCode: "sync.revision_conflict" };
  }
  if (incoming.operation === current.operation) {
    if (
      incoming.operation === "invalidate" &&
      current.operation === "invalidate"
    ) {
      return incoming.invalidationHash === current.invalidationHash
        ? { kind: "duplicate" }
        : { kind: "conflict", errorCode: "sync.revision_conflict" };
    }
    return { kind: "duplicate" };
  }
  if (
    current.operation === "invalidate" &&
    incoming.operation !== "invalidate"
  ) {
    return { kind: "apply" };
  }
  if (
    incoming.operation === "invalidate" &&
    current.operation !== "invalidate"
  ) {
    return { kind: "duplicate" };
  }
  return { kind: "conflict", errorCode: "sync.revision_conflict" };
}
