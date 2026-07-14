import { z } from "zod";

import type { Brand } from "../brand";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import {
  inboxV2EntityKeySchema,
  inboxV2RecipientStateFingerprintSchema,
  inboxV2Sha256DigestSchema,
  inboxV2StreamEpochSchema,
  inboxV2SyncGenerationSchema,
  inboxV2TenantStreamPositionSchema
} from "./sync-primitives";
import { calculateInboxV2CanonicalSha256 } from "./recipient-sync-hash";

export const INBOX_V2_RECIPIENT_FINGERPRINT_KEY_RING_SCHEMA_ID =
  "core:inbox-v2.recipient-fingerprint-key-ring" as const;
export const INBOX_V2_RECIPIENT_FINGERPRINT_LIFECYCLE_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export type InboxV2RecipientFingerprintKeyGeneration = Brand<
  string,
  "InboxV2RecipientFingerprintKeyGeneration"
>;

export const inboxV2RecipientFingerprintKeyGenerationSchema = z
  .string()
  .min(8)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u)
  .transform((value) => value as InboxV2RecipientFingerprintKeyGeneration);

export const inboxV2RecipientFingerprintKeyStateSchema = z.enum([
  "active",
  "verify_only",
  "retired"
]);

export const inboxV2RecipientFingerprintKeyGenerationStateSchema = z
  .object({
    generation: inboxV2RecipientFingerprintKeyGenerationSchema,
    state: inboxV2RecipientFingerprintKeyStateSchema,
    activatedAt: inboxV2TimestampSchema,
    useUntil: inboxV2TimestampSchema,
    verifyUntil: inboxV2TimestampSchema.nullable(),
    retiredAt: inboxV2TimestampSchema.nullable(),
    verificationAvailable: z.boolean()
  })
  .strict()
  .superRefine((generation, context) => {
    const invalidActive =
      generation.state === "active" &&
      (generation.verifyUntil !== null ||
        generation.retiredAt !== null ||
        !generation.verificationAvailable);
    const invalidVerifyOnly =
      generation.state === "verify_only" &&
      (generation.verifyUntil === null ||
        generation.retiredAt !== null ||
        !generation.verificationAvailable ||
        Date.parse(generation.useUntil) > Date.parse(generation.verifyUntil) ||
        !isInboxV2TimestampOrderValid(
          generation.activatedAt,
          generation.verifyUntil
        ));
    const invalidRetired =
      generation.state === "retired" &&
      (generation.retiredAt === null ||
        generation.verificationAvailable ||
        Date.parse(generation.useUntil) > Date.parse(generation.retiredAt) ||
        !isInboxV2TimestampOrderValid(
          generation.activatedAt,
          generation.retiredAt
        ) ||
        (generation.verifyUntil !== null &&
          !isInboxV2TimestampOrderValid(
            generation.verifyUntil,
            generation.retiredAt
          )));

    if (
      Date.parse(generation.activatedAt) >= Date.parse(generation.useUntil) ||
      invalidActive ||
      invalidVerifyOnly ||
      invalidRetired
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Fingerprint key generation state must expose only a finite verification lifecycle."
      });
    }
  });

export const inboxV2RetainedRecipientFingerprintSchema = z
  .object({
    entity: inboxV2EntityKeySchema,
    revision: inboxV2EntityRevisionSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    fingerprint: inboxV2RecipientStateFingerprintSchema,
    keyGeneration: inboxV2RecipientFingerprintKeyGenerationSchema,
    firstReplayPosition: inboxV2TenantStreamPositionSchema,
    lastReplayPosition: inboxV2TenantStreamPositionSchema,
    replayEligibleUntil: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((state, context) => {
    if (
      BigInt(state.lastReplayPosition) < BigInt(state.firstReplayPosition) ||
      recipientFingerprintGeneration(state.fingerprint) !== state.keyGeneration
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Retained fingerprint must bind its exact generation and ordered replay window."
      });
    }
  });

export const inboxV2RecipientFingerprintAuthoritySnapshotSchema = z
  .object({
    streamEpoch: inboxV2StreamEpochSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    checkpointPosition: inboxV2TenantStreamPositionSchema,
    highWaterPosition: inboxV2TenantStreamPositionSchema,
    rootHash: inboxV2Sha256DigestSchema,
    complete: z.literal(true)
  })
  .strict()
  .superRefine((snapshot, context) => {
    if (snapshot.checkpointPosition !== snapshot.highWaterPosition) {
      context.addIssue({
        code: "custom",
        path: ["checkpointPosition"],
        message:
          "A fingerprint authority snapshot is complete only at its exact high-water checkpoint."
      });
    }
  });

export const inboxV2RecipientFingerprintKeyRingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    purpose: z.literal("recipient_state_integrity"),
    syncGeneration: inboxV2SyncGenerationSchema,
    asOf: inboxV2TimestampSchema,
    authoritySnapshot: inboxV2RecipientFingerprintAuthoritySnapshotSchema,
    generations: z
      .array(inboxV2RecipientFingerprintKeyGenerationStateSchema)
      .min(1)
      .max(64),
    retainedFingerprints: z
      .array(inboxV2RetainedRecipientFingerprintSchema)
      .max(100_000),
    ringHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((ring, context) => {
    const generationIds = ring.generations.map(
      (generation) => generation.generation
    );
    const active = ring.generations.filter(
      (generation) => generation.state === "active"
    );
    if (
      ring.authoritySnapshot.syncGeneration !== ring.syncGeneration ||
      ring.ringHash !== calculateInboxV2RecipientFingerprintKeyRingHash(ring) ||
      active.length !== 1 ||
      ring.generations.at(-1)?.state !== "active" ||
      new Set(generationIds).size !== generationIds.length ||
      ring.generations.some(
        (generation, index) =>
          index > 0 &&
          Date.parse(generation.activatedAt) <=
            Date.parse(ring.generations[index - 1]!.activatedAt)
      ) ||
      ring.generations.some(
        (generation) =>
          Date.parse(generation.activatedAt) > Date.parse(ring.asOf) ||
          (generation.state === "active" &&
            Date.parse(generation.useUntil) <= Date.parse(ring.asOf)) ||
          (generation.state === "verify_only" &&
            (generation.verifyUntil === null ||
              Date.parse(generation.useUntil) > Date.parse(ring.asOf) ||
              Date.parse(generation.verifyUntil) <= Date.parse(ring.asOf))) ||
          (generation.state === "retired" &&
            (generation.retiredAt === null ||
              Date.parse(generation.retiredAt) > Date.parse(ring.asOf)))
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["generations"],
        message:
          "Fingerprint key ring requires one active generation and unique activation order."
      });
    }

    const generationById = new Map(
      ring.generations.map((generation) => [generation.generation, generation])
    );
    const retainedIdentityKeys = ring.retainedFingerprints.map(
      (retained) =>
        `${retained.entity.tenantId}\u0000${retained.entity.entityTypeId}\u0000${retained.entity.entityId}\u0000${retained.revision}`
    );
    if (new Set(retainedIdentityKeys).size !== retainedIdentityKeys.length) {
      context.addIssue({
        code: "custom",
        path: ["retainedFingerprints"],
        message:
          "One entity revision cannot retain conflicting fingerprint bindings."
      });
    }
    for (const [index, retained] of ring.retainedFingerprints.entries()) {
      const generation = generationById.get(retained.keyGeneration);
      if (
        retained.entity.tenantId !== ring.tenantId ||
        retained.syncGeneration !== ring.syncGeneration ||
        generation === undefined ||
        (Date.parse(ring.asOf) < Date.parse(retained.replayEligibleUntil) &&
          (!generation.verificationAvailable ||
            generation.state === "retired" ||
            (generation.verifyUntil !== null &&
              Date.parse(generation.verifyUntil) <
                Date.parse(retained.replayEligibleUntil))))
      ) {
        context.addIssue({
          code: "custom",
          path: ["retainedFingerprints", index],
          message:
            "Every replay-eligible fingerprint must belong to the current sync generation and requires a tenant-local historical verifier through its full replay window."
        });
      }
    }
  });

export const inboxV2RecipientFingerprintKeyRingEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_RECIPIENT_FINGERPRINT_KEY_RING_SCHEMA_ID,
    INBOX_V2_RECIPIENT_FINGERPRINT_LIFECYCLE_SCHEMA_VERSION,
    inboxV2RecipientFingerprintKeyRingSchema
  );

export const inboxV2RecipientFingerprintBindingSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    entity: inboxV2EntityKeySchema,
    revision: inboxV2EntityRevisionSchema,
    syncGeneration: inboxV2SyncGenerationSchema,
    fingerprint: inboxV2RecipientStateFingerprintSchema,
    keyGeneration: inboxV2RecipientFingerprintKeyGenerationSchema
  })
  .strict()
  .superRefine((binding, context) => {
    if (
      binding.entity.tenantId !== binding.tenantId ||
      recipientFingerprintGeneration(binding.fingerprint) !==
        binding.keyGeneration
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Recipient fingerprint binding must stay inside one tenant and expose its exact opaque generation."
      });
    }
  });

export const inboxV2RecipientFingerprintResetManifestSchema = z
  .object({
    id: z
      .string()
      .min(8)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u),
    snapshot: inboxV2RecipientFingerprintAuthoritySnapshotSchema,
    previousSnapshotRootHash: inboxV2Sha256DigestSchema,
    manifestHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.manifestHash !==
      calculateInboxV2RecipientFingerprintResetManifestHash(manifest)
    ) {
      context.addIssue({
        code: "custom",
        path: ["manifestHash"],
        message:
          "Fingerprint reset manifest hash must cover its complete snapshot high-water."
      });
    }
  });

export const inboxV2RecipientFingerprintAuthoritativeResetProofSchema = z
  .object({
    kind: z.literal("authoritative_sync_generation_reset"),
    sourceId: z
      .string()
      .min(8)
      .max(256)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u),
    tenantId: inboxV2TenantIdSchema,
    before: inboxV2RecipientFingerprintBindingSchema,
    after: inboxV2RecipientFingerprintBindingSchema,
    fromSyncGeneration: inboxV2SyncGenerationSchema,
    toSyncGeneration: inboxV2SyncGenerationSchema,
    fromKeyGeneration: inboxV2RecipientFingerprintKeyGenerationSchema,
    toKeyGeneration: inboxV2RecipientFingerprintKeyGenerationSchema,
    resetManifest: inboxV2RecipientFingerprintResetManifestSchema,
    ringHash: inboxV2Sha256DigestSchema,
    previousGenerationInvalidation: z
      .object({
        fromSyncGeneration: inboxV2SyncGenerationSchema,
        keyGeneration: inboxV2RecipientFingerprintKeyGenerationSchema,
        invalidatedAt: inboxV2TimestampSchema,
        resetManifestHash: inboxV2Sha256DigestSchema,
        atomic: z.literal(true)
      })
      .strict(),
    resetAt: inboxV2TimestampSchema,
    proofHash: inboxV2Sha256DigestSchema
  })
  .strict()
  .superRefine((proof, context) => {
    if (
      BigInt(proof.toSyncGeneration) <= BigInt(proof.fromSyncGeneration) ||
      proof.tenantId !== proof.before.tenantId ||
      proof.tenantId !== proof.after.tenantId ||
      proof.fromSyncGeneration !== proof.before.syncGeneration ||
      proof.toSyncGeneration !== proof.after.syncGeneration ||
      proof.fromKeyGeneration !== proof.before.keyGeneration ||
      proof.toKeyGeneration !== proof.after.keyGeneration ||
      proof.resetManifest.snapshot.syncGeneration !== proof.toSyncGeneration ||
      proof.previousGenerationInvalidation.fromSyncGeneration !==
        proof.fromSyncGeneration ||
      proof.previousGenerationInvalidation.keyGeneration !==
        proof.fromKeyGeneration ||
      proof.previousGenerationInvalidation.invalidatedAt !== proof.resetAt ||
      proof.previousGenerationInvalidation.resetManifestHash !==
        proof.resetManifest.manifestHash ||
      proof.proofHash !==
        calculateInboxV2RecipientFingerprintResetProofHash(proof)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Authoritative reset proof must bind exact bindings, generations, complete manifest and atomic prior-generation invalidation."
      });
    }
  });

export const inboxV2RecipientFingerprintTransitionInputSchema = z
  .object({
    before: inboxV2RecipientFingerprintBindingSchema,
    after: inboxV2RecipientFingerprintBindingSchema,
    resultingKeyRing: inboxV2RecipientFingerprintKeyRingSchema,
    resetProof:
      inboxV2RecipientFingerprintAuthoritativeResetProofSchema.nullable()
  })
  .strict();

export const inboxV2RecipientFingerprintTransitionDecisionSchema = z.union([
  z
    .object({
      kind: z.literal("accepted"),
      transition: z.enum([
        "unchanged_revision",
        "entity_revision_advanced",
        "sync_generation_reset"
      ])
    })
    .strict(),
  z
    .object({
      kind: z.literal("rejected"),
      errorCode: z.enum([
        "fingerprint.transition_invalid",
        "fingerprint.same_revision_changed",
        "fingerprint.generation_unverifiable",
        "fingerprint.reset_proof_required"
      ])
    })
    .strict()
]);

const authenticRecipientFingerprintKeyRings = new WeakSet<object>();
const authenticRecipientFingerprintResetSources = new WeakSet<object>();
const authenticRecipientFingerprintResetProofs = new WeakSet<object>();

export type InboxV2RecipientFingerprintResetLedgerSource = Readonly<{
  id: string;
  resolve(
    input: Readonly<{
      tenantId: string;
      before: z.infer<typeof inboxV2RecipientFingerprintBindingSchema>;
      after: z.infer<typeof inboxV2RecipientFingerprintBindingSchema>;
      resultingKeyRing: InboxV2RecipientFingerprintKeyRing;
    }>
  ): z.input<typeof inboxV2RecipientFingerprintAuthoritativeResetProofSchema>;
}>;

export function calculateInboxV2RecipientFingerprintKeyRingHash(
  ring: z.input<typeof inboxV2RecipientFingerprintKeyRingSchema>
): string {
  const { ringHash: _ringHash, ...body } = ring;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.recipient-fingerprint-key-ring",
    hashVersion: "v1",
    ring: body
  });
}

export function calculateInboxV2RecipientFingerprintResetManifestHash(
  manifest: z.input<typeof inboxV2RecipientFingerprintResetManifestSchema>
): string {
  const { manifestHash: _manifestHash, ...body } = manifest;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.recipient-fingerprint-reset-manifest",
    hashVersion: "v1",
    manifest: body
  });
}

export function calculateInboxV2RecipientFingerprintResetProofHash(
  proof: z.input<
    typeof inboxV2RecipientFingerprintAuthoritativeResetProofSchema
  >
): string {
  const { proofHash: _proofHash, ...body } = proof;
  return calculateInboxV2CanonicalSha256({
    domain: "core:inbox-v2.recipient-fingerprint-reset-proof",
    hashVersion: "v1",
    proof: body
  });
}

/** Canonical immutable public metadata only; secret/HMAC key bytes are absent. */
export function defineInboxV2RecipientFingerprintKeyRing(
  input: Omit<
    z.input<typeof inboxV2RecipientFingerprintKeyRingSchema>,
    "ringHash"
  >
): InboxV2RecipientFingerprintKeyRing {
  const candidate = {
    ...input,
    ringHash: `sha256:${"0".repeat(64)}`
  };
  const ring = deepFreezeFingerprintLifecycle(
    inboxV2RecipientFingerprintKeyRingSchema.parse({
      ...candidate,
      ringHash: calculateInboxV2RecipientFingerprintKeyRingHash(candidate)
    })
  );
  authenticRecipientFingerprintKeyRings.add(ring);
  return ring;
}

/**
 * Non-JSON composition-root capability registered once at service bootstrap.
 * Raw endpoint objects and callback lookalikes are not reset authority.
 */
export function defineInboxV2RecipientFingerprintResetLedgerSource(
  source: InboxV2RecipientFingerprintResetLedgerSource
): InboxV2RecipientFingerprintResetLedgerSource {
  if (source.id.length < 8 || typeof source.resolve !== "function") {
    throw new Error("Recipient fingerprint reset-ledger source is invalid.");
  }
  const result = Object.freeze({ ...source });
  authenticRecipientFingerprintResetSources.add(result);
  return result;
}

/** Resolves an immutable reset proof only through the registered ledger. */
export function resolveInboxV2RecipientFingerprintAuthoritativeResetProof(input: {
  source: InboxV2RecipientFingerprintResetLedgerSource;
  before: z.input<typeof inboxV2RecipientFingerprintBindingSchema>;
  after: z.input<typeof inboxV2RecipientFingerprintBindingSchema>;
  resultingKeyRing: InboxV2RecipientFingerprintKeyRing;
}): z.infer<typeof inboxV2RecipientFingerprintAuthoritativeResetProofSchema> {
  if (
    !authenticRecipientFingerprintResetSources.has(input.source) ||
    !authenticRecipientFingerprintKeyRings.has(input.resultingKeyRing)
  ) {
    throw new Error(
      "Authoritative reset requires registered ledger source and authentic current key ring."
    );
  }
  const before = inboxV2RecipientFingerprintBindingSchema.parse(input.before);
  const after = inboxV2RecipientFingerprintBindingSchema.parse(input.after);
  const sourceResult = input.source.resolve({
    tenantId: before.tenantId,
    before,
    after,
    resultingKeyRing: input.resultingKeyRing
  });
  const manifestBody = sourceResult.resetManifest;
  const resetManifest = {
    ...manifestBody,
    manifestHash:
      calculateInboxV2RecipientFingerprintResetManifestHash(manifestBody)
  };
  const proofBody = {
    ...sourceResult,
    resetManifest,
    previousGenerationInvalidation: {
      ...sourceResult.previousGenerationInvalidation,
      resetManifestHash: resetManifest.manifestHash
    }
  };
  const proof = inboxV2RecipientFingerprintAuthoritativeResetProofSchema.parse({
    ...proofBody,
    proofHash: calculateInboxV2RecipientFingerprintResetProofHash(proofBody)
  });
  const activeGeneration = input.resultingKeyRing.generations.find(
    ({ state }) => state === "active"
  );
  if (
    proof.sourceId !== input.source.id ||
    !sameFingerprintLifecycleValue(proof.before, before) ||
    !sameFingerprintLifecycleValue(proof.after, after) ||
    proof.ringHash !== input.resultingKeyRing.ringHash ||
    !sameFingerprintLifecycleValue(
      proof.resetManifest.snapshot,
      input.resultingKeyRing.authoritySnapshot
    ) ||
    proof.resetManifest.previousSnapshotRootHash ===
      input.resultingKeyRing.authoritySnapshot.rootHash ||
    proof.resetAt !== input.resultingKeyRing.asOf ||
    activeGeneration?.generation !== after.keyGeneration ||
    activeGeneration.activatedAt !== proof.resetAt
  ) {
    throw new Error(
      "Reset-ledger result is stale or does not bind the exact transition, high-water snapshot and key ring."
    );
  }
  const result = deepFreezeFingerprintLifecycle(proof);
  authenticRecipientFingerprintResetProofs.add(result);
  return result;
}

export function validateInboxV2RecipientFingerprintLifecycleTransition(
  input: unknown
): z.infer<typeof inboxV2RecipientFingerprintTransitionDecisionSchema> {
  if (typeof input !== "object" || input === null) {
    return rejectFingerprintTransition("fingerprint.transition_invalid");
  }
  const authorityInput = input as {
    resultingKeyRing?: unknown;
    resetProof?: unknown;
  };
  if (
    typeof authorityInput.resultingKeyRing !== "object" ||
    authorityInput.resultingKeyRing === null ||
    !authenticRecipientFingerprintKeyRings.has(
      authorityInput.resultingKeyRing
    ) ||
    (authorityInput.resetProof !== null &&
      authorityInput.resetProof !== undefined &&
      (typeof authorityInput.resetProof !== "object" ||
        !authenticRecipientFingerprintResetProofs.has(
          authorityInput.resetProof
        )))
  ) {
    return rejectFingerprintTransition("fingerprint.transition_invalid");
  }
  const parsed =
    inboxV2RecipientFingerprintTransitionInputSchema.safeParse(input);
  if (!parsed.success) {
    return rejectFingerprintTransition("fingerprint.transition_invalid");
  }
  const { before, after, resultingKeyRing, resetProof } = parsed.data;
  if (
    before.tenantId !== after.tenantId ||
    before.tenantId !== resultingKeyRing.tenantId ||
    before.entity.entityTypeId !== after.entity.entityTypeId ||
    before.entity.entityId !== after.entity.entityId ||
    BigInt(after.revision) < BigInt(before.revision) ||
    BigInt(after.syncGeneration) < BigInt(before.syncGeneration)
  ) {
    return rejectFingerprintTransition("fingerprint.transition_invalid");
  }

  const resultingGeneration = resultingKeyRing.generations.find(
    (generation) => generation.generation === after.keyGeneration
  );
  if (
    resultingKeyRing.syncGeneration !== after.syncGeneration ||
    resultingGeneration === undefined ||
    !resultingGeneration.verificationAvailable ||
    resultingGeneration.state === "retired"
  ) {
    return rejectFingerprintTransition("fingerprint.generation_unverifiable");
  }

  const revisionAdvanced = BigInt(after.revision) > BigInt(before.revision);
  const generationAdvanced =
    BigInt(after.syncGeneration) > BigInt(before.syncGeneration);
  if (
    (revisionAdvanced || generationAdvanced) &&
    resultingGeneration.state !== "active"
  ) {
    return rejectFingerprintTransition("fingerprint.generation_unverifiable");
  }
  const retainedBeforeIsVerifiable = resultingKeyRing.retainedFingerprints.some(
    (retained) =>
      retained.entity.entityTypeId === before.entity.entityTypeId &&
      retained.entity.entityId === before.entity.entityId &&
      retained.revision === before.revision &&
      retained.syncGeneration === before.syncGeneration &&
      retained.fingerprint === before.fingerprint &&
      retained.keyGeneration === before.keyGeneration
  );
  if (!generationAdvanced && !retainedBeforeIsVerifiable) {
    return rejectFingerprintTransition("fingerprint.generation_unverifiable");
  }
  if (!revisionAdvanced && !generationAdvanced) {
    if (
      before.fingerprint !== after.fingerprint ||
      before.keyGeneration !== after.keyGeneration
    ) {
      return rejectFingerprintTransition("fingerprint.same_revision_changed");
    }
    if (resetProof !== null) {
      return rejectFingerprintTransition("fingerprint.transition_invalid");
    }
    return { kind: "accepted", transition: "unchanged_revision" };
  }

  if (generationAdvanced) {
    if (
      resetProof === null ||
      !authenticRecipientFingerprintResetProofs.has(
        authorityInput.resetProof as object
      ) ||
      resetProof.tenantId !== before.tenantId ||
      !sameFingerprintLifecycleValue(resetProof.before, before) ||
      !sameFingerprintLifecycleValue(resetProof.after, after) ||
      resetProof.fromSyncGeneration !== before.syncGeneration ||
      resetProof.toSyncGeneration !== after.syncGeneration ||
      resetProof.fromKeyGeneration !== before.keyGeneration ||
      resetProof.toKeyGeneration !== after.keyGeneration ||
      resetProof.ringHash !== resultingKeyRing.ringHash ||
      !sameFingerprintLifecycleValue(
        resetProof.resetManifest.snapshot,
        resultingKeyRing.authoritySnapshot
      ) ||
      resetProof.resetAt !== resultingKeyRing.asOf ||
      resultingGeneration.activatedAt !== resetProof.resetAt
    ) {
      return rejectFingerprintTransition("fingerprint.reset_proof_required");
    }
    return { kind: "accepted", transition: "sync_generation_reset" };
  }

  if (resetProof !== null) {
    return rejectFingerprintTransition("fingerprint.transition_invalid");
  }
  return { kind: "accepted", transition: "entity_revision_advanced" };
}

function recipientFingerprintGeneration(
  fingerprint: string
): string | undefined {
  return fingerprint.match(/^hmac-sha256:(.+):[a-f0-9]{64}$/u)?.[1];
}

function rejectFingerprintTransition(
  errorCode: z.infer<
    typeof inboxV2RecipientFingerprintTransitionDecisionSchema
  > extends infer TDecision
    ? TDecision extends { kind: "rejected"; errorCode: infer TError }
      ? TError
      : never
    : never
) {
  return { kind: "rejected" as const, errorCode };
}

function sameFingerprintLifecycleValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function deepFreezeFingerprintLifecycle<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value)) {
    deepFreezeFingerprintLifecycle(child);
  }
  return Object.freeze(value);
}

export type InboxV2RecipientFingerprintKeyGenerationState = z.infer<
  typeof inboxV2RecipientFingerprintKeyGenerationStateSchema
>;
export type InboxV2RecipientFingerprintKeyRing = z.infer<
  typeof inboxV2RecipientFingerprintKeyRingSchema
>;
export type InboxV2RecipientFingerprintBinding = z.infer<
  typeof inboxV2RecipientFingerprintBindingSchema
>;
export type InboxV2RecipientFingerprintAuthoritativeResetProof = z.infer<
  typeof inboxV2RecipientFingerprintAuthoritativeResetProofSchema
>;
export type InboxV2RecipientFingerprintTransitionDecision = z.infer<
  typeof inboxV2RecipientFingerprintTransitionDecisionSchema
>;
