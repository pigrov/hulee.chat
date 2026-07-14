import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  defineInboxV2RecipientFingerprintKeyRing,
  defineInboxV2RecipientFingerprintResetLedgerSource,
  inboxV2RecipientFingerprintKeyRingEnvelopeSchema,
  inboxV2RecipientFingerprintKeyRingSchema,
  resolveInboxV2RecipientFingerprintAuthoritativeResetProof,
  validateInboxV2RecipientFingerprintLifecycleTransition
} from "./recipient-fingerprint-lifecycle";
import { assertInboxV2ClosedJsonSchema } from "./schema-safety";

const tenantId = "tenant:tenant-1";
const entity = {
  tenantId,
  entityTypeId: "core:message",
  entityId: "message:message-1"
} as const;
const firstGeneration = "recipient-key:g1";
const secondGeneration = "recipient-key:g2";
const thirdGeneration = "recipient-key:g3";
const firstFingerprint = `hmac-sha256:${firstGeneration}:${"1".repeat(64)}`;
const secondFingerprint = `hmac-sha256:${secondGeneration}:${"2".repeat(64)}`;
const thirdFingerprint = `hmac-sha256:${thirdGeneration}:${"3".repeat(64)}`;
const asOf = "2026-07-11T12:00:00.000Z";
const rootHashA = `sha256:${"a".repeat(64)}`;
const rootHashB = `sha256:${"b".repeat(64)}`;
const placeholderHash = `sha256:${"0".repeat(64)}`;

function keyRingInput() {
  return {
    tenantId,
    purpose: "recipient_state_integrity" as const,
    syncGeneration: "1",
    asOf,
    authoritySnapshot: {
      streamEpoch: "stream-epoch-1",
      syncGeneration: "1",
      checkpointPosition: "20",
      highWaterPosition: "20",
      rootHash: rootHashA,
      complete: true as const
    },
    generations: [
      {
        generation: firstGeneration,
        state: "verify_only" as const,
        activatedAt: "2026-01-01T00:00:00.000Z",
        useUntil: "2026-07-01T00:00:00.000Z",
        verifyUntil: "2026-12-31T23:59:59.999Z",
        retiredAt: null,
        verificationAvailable: true
      },
      {
        generation: secondGeneration,
        state: "active" as const,
        activatedAt: "2026-07-01T00:00:00.000Z",
        useUntil: "2026-08-01T00:00:00.000Z",
        verifyUntil: null,
        retiredAt: null,
        verificationAvailable: true
      }
    ],
    retainedFingerprints: [
      {
        entity,
        revision: "1",
        syncGeneration: "1",
        fingerprint: firstFingerprint,
        keyGeneration: firstGeneration,
        firstReplayPosition: "10",
        lastReplayPosition: "20",
        replayEligibleUntil: "2026-11-30T00:00:00.000Z"
      }
    ]
  };
}

function keyRing() {
  return defineInboxV2RecipientFingerprintKeyRing(keyRingInput());
}

function beforeBinding() {
  return {
    tenantId,
    entity,
    revision: "1",
    syncGeneration: "1",
    fingerprint: firstFingerprint,
    keyGeneration: firstGeneration
  };
}

function afterResetBinding() {
  return {
    ...beforeBinding(),
    syncGeneration: "2",
    fingerprint: thirdFingerprint,
    keyGeneration: thirdGeneration
  };
}

function nextKeyRingInput() {
  return {
    tenantId,
    purpose: "recipient_state_integrity" as const,
    syncGeneration: "2",
    asOf,
    authoritySnapshot: {
      streamEpoch: "stream-epoch-1",
      syncGeneration: "2",
      checkpointPosition: "30",
      highWaterPosition: "30",
      rootHash: rootHashB,
      complete: true as const
    },
    generations: [
      {
        generation: thirdGeneration,
        state: "active" as const,
        activatedAt: asOf,
        useUntil: "2026-08-01T00:00:00.000Z",
        verifyUntil: null,
        retiredAt: null,
        verificationAvailable: true
      }
    ],
    retainedFingerprints: []
  };
}

function nextKeyRing() {
  return defineInboxV2RecipientFingerprintKeyRing(nextKeyRingInput());
}

function resetProof(options?: {
  ring?: ReturnType<typeof nextKeyRing>;
  mutate?: (proof: ReturnType<typeof resetProofInput>) => void;
}) {
  const before = beforeBinding();
  const after = afterResetBinding();
  const ring = options?.ring ?? nextKeyRing();
  const source = defineInboxV2RecipientFingerprintResetLedgerSource({
    id: "core:recipient-fingerprint-reset-ledger",
    resolve: () => {
      const proof = resetProofInput(before, after, ring);
      options?.mutate?.(proof);
      return proof;
    }
  });
  return resolveInboxV2RecipientFingerprintAuthoritativeResetProof({
    source,
    before,
    after,
    resultingKeyRing: ring
  });
}

function resetProofInput(
  before = beforeBinding(),
  after = afterResetBinding(),
  ring = nextKeyRing()
) {
  return {
    kind: "authoritative_sync_generation_reset" as const,
    sourceId: "core:recipient-fingerprint-reset-ledger",
    tenantId,
    before,
    after,
    fromSyncGeneration: before.syncGeneration,
    toSyncGeneration: after.syncGeneration,
    fromKeyGeneration: before.keyGeneration,
    toKeyGeneration: after.keyGeneration,
    resetManifest: {
      id: "recipient-fingerprint-reset:manifest-1",
      snapshot: structuredClone(ring.authoritySnapshot),
      previousSnapshotRootHash: rootHashA,
      manifestHash: placeholderHash
    },
    ringHash: ring.ringHash,
    previousGenerationInvalidation: {
      fromSyncGeneration: before.syncGeneration,
      keyGeneration: before.keyGeneration,
      invalidatedAt: asOf,
      resetManifestHash: placeholderHash,
      atomic: true as const
    },
    resetAt: asOf,
    proofHash: placeholderHash
  };
}

describe("Inbox V2 recipient fingerprint lifecycle", () => {
  it("accepts one active generation with replay-bounded historical verification", () => {
    const ring = keyRing();
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(ring).success
    ).toBe(true);
    expect(
      inboxV2RecipientFingerprintKeyRingEnvelopeSchema.safeParse({
        schemaId: "core:inbox-v2.recipient-fingerprint-key-ring",
        schemaVersion: "v1",
        payload: ring
      }).success
    ).toBe(true);
    expect(() =>
      assertInboxV2ClosedJsonSchema(
        inboxV2RecipientFingerprintKeyRingSchema,
        "recipient fingerprint key ring"
      )
    ).not.toThrow();
  });

  it("rejects raw key material, several active generations and premature retirement", () => {
    const rawKey = structuredClone(keyRing()) as ReturnType<typeof keyRing> & {
      key?: string;
    };
    rawKey.key = "secret-key-material";
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(rawKey).success
    ).toBe(false);

    const severalActive = structuredClone(keyRing());
    severalActive.generations[0] = {
      ...severalActive.generations[0]!,
      state: "active",
      verifyUntil: null
    };
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(severalActive).success
    ).toBe(false);

    const expiredActive = structuredClone(keyRing());
    expiredActive.generations[1]!.useUntil = asOf;
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(expiredActive).success
    ).toBe(false);

    const conflictingRevision = structuredClone(keyRing());
    conflictingRevision.retainedFingerprints.push({
      ...conflictingRevision.retainedFingerprints[0]!,
      fingerprint: secondFingerprint as never,
      keyGeneration: secondGeneration as never
    });
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(conflictingRevision)
        .success
    ).toBe(false);

    const retainedFromAnotherSyncGeneration = structuredClone(keyRing());
    retainedFromAnotherSyncGeneration.retainedFingerprints[0]!.syncGeneration =
      "2" as never;
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(
        retainedFromAnotherSyncGeneration
      ).success
    ).toBe(false);

    const prematurelyRetired: z.input<
      typeof inboxV2RecipientFingerprintKeyRingSchema
    > = structuredClone(keyRing());
    prematurelyRetired.generations[0] = {
      ...prematurelyRetired.generations[0]!,
      state: "retired",
      verifyUntil: "2026-07-01T00:00:00.000Z",
      retiredAt: asOf,
      verificationAvailable: false
    };
    expect(
      inboxV2RecipientFingerprintKeyRingSchema.safeParse(prematurelyRetired)
        .success
    ).toBe(false);
  });

  it("keeps equal-revision fingerprint and generation immutable", () => {
    const before = beforeBinding();
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after: before,
        resultingKeyRing: keyRing(),
        resetProof: null
      })
    ).toEqual({ kind: "accepted", transition: "unchanged_revision" });

    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after: {
          ...before,
          fingerprint: secondFingerprint,
          keyGeneration: secondGeneration
        },
        resultingKeyRing: keyRing(),
        resetProof: null
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.same_revision_changed"
    });
  });

  it("allows rekey through a higher entity revision and rejects an unverifiable prior revision", () => {
    const transition = {
      before: beforeBinding(),
      after: {
        ...beforeBinding(),
        revision: "2",
        fingerprint: secondFingerprint,
        keyGeneration: secondGeneration
      },
      resultingKeyRing: keyRing(),
      resetProof: null
    };
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition(transition)
    ).toEqual({ kind: "accepted", transition: "entity_revision_advanced" });

    const missingHistoricalVerifier = {
      ...transition,
      resultingKeyRing: defineInboxV2RecipientFingerprintKeyRing({
        ...keyRingInput(),
        retainedFingerprints: []
      })
    };
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition(
        missingHistoricalVerifier
      )
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.generation_unverifiable"
    });

    const verifyOnlyCurrent = {
      ...transition,
      after: {
        ...transition.after,
        fingerprint: firstFingerprint,
        keyGeneration: firstGeneration
      }
    };
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition(verifyOnlyCurrent)
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.generation_unverifiable"
    });
  });

  it("requires an exact authoritative reset proof for sync-generation rekey", () => {
    const before = beforeBinding();
    const after = afterResetBinding();
    const nextRing = nextKeyRing();

    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after,
        resultingKeyRing: nextRing,
        resetProof: null
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.reset_proof_required"
    });

    const inventedCallerProof = {
      kind: "authoritative_sync_generation_reset",
      tenantId,
      fromSyncGeneration: "1",
      toSyncGeneration: "2",
      previousGenerationInvalidated: true,
      resetManifestHash: rootHashA,
      resetAt: asOf
    };
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after,
        resultingKeyRing: nextRing,
        resetProof: inventedCallerProof
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.transition_invalid"
    });

    const authoritativeProof = resetProof({ ring: nextRing });
    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after,
        resultingKeyRing: nextRing,
        resetProof: authoritativeProof
      })
    ).toEqual({ kind: "accepted", transition: "sync_generation_reset" });

    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after,
        resultingKeyRing: structuredClone(nextRing),
        resetProof: authoritativeProof
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.transition_invalid"
    });

    expect(
      validateInboxV2RecipientFingerprintLifecycleTransition({
        before,
        after,
        resultingKeyRing: nextRing,
        resetProof: structuredClone(authoritativeProof)
      })
    ).toEqual({
      kind: "rejected",
      errorCode: "fingerprint.transition_invalid"
    });

    const registeredSource = defineInboxV2RecipientFingerprintResetLedgerSource(
      {
        id: "core:recipient-fingerprint-reset-ledger-clone",
        resolve: () => resetProofInput(before, after, nextRing)
      }
    );
    expect(() =>
      resolveInboxV2RecipientFingerprintAuthoritativeResetProof({
        source: { ...registeredSource },
        before,
        after,
        resultingKeyRing: nextRing
      })
    ).toThrow(/registered ledger source/u);

    expect(() =>
      resetProof({
        ring: nextRing,
        mutate: (proof) => {
          proof.resetManifest.snapshot.checkpointPosition = "29" as never;
          proof.resetManifest.snapshot.highWaterPosition = "29" as never;
        }
      })
    ).toThrow(/stale|high-water/u);

    expect(() =>
      resetProof({
        ring: nextRing,
        mutate: (proof) => {
          proof.toSyncGeneration = "3";
        }
      })
    ).toThrow();

    expect(() =>
      resetProof({
        ring: nextRing,
        mutate: (proof) => {
          proof.previousGenerationInvalidation.atomic = false as never;
        }
      })
    ).toThrow();
  });
});
