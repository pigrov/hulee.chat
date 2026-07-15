import { z } from "zod";

import {
  inboxV2BigintCounterSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import { inboxV2TenantIdSchema } from "./ids";
import {
  createInboxV2SchemaEnvelopeSchema,
  INBOX_V2_INITIAL_SCHEMA_VERSION
} from "./schema-version";
import { inboxV2InternalOpaqueReferenceSchema } from "./sync-primitives";

export const INBOX_V2_SECURITY_DENIAL_ATTEMPT_SCHEMA_ID =
  "core:inbox-v2.security-denial-attempt" as const;
export const INBOX_V2_SECURITY_DENIAL_RESULT_SCHEMA_ID =
  "core:inbox-v2.security-denial-result" as const;
export const INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION =
  INBOX_V2_INITIAL_SCHEMA_VERSION;

export const INBOX_V2_SECURITY_DENIAL_POLICY = Object.freeze({
  policyId: "core:security-denial-policy.default-v1" as const,
  windowSeconds: 3_600 as const,
  retentionSeconds: 2_592_000 as const,
  shardCount: 16 as const,
  detailBucketLimitPerShard: 16 as const,
  reviewCandidateLimitPerShard: 4 as const,
  attemptRateLimitPerShard: 600 as const,
  lockTimeoutMilliseconds: 100 as const,
  statementTimeoutMilliseconds: 500 as const,
  maxInFlightObservations: 32 as const,
  maxInFlightTelemetryCallbacks: 8 as const,
  circuitFailureThreshold: 3 as const,
  circuitCooldownMilliseconds: 5_000 as const
});

export const inboxV2SecurityDenialPolicySchema = z
  .object({
    policyId: z.literal(INBOX_V2_SECURITY_DENIAL_POLICY.policyId),
    windowSeconds: z.literal(INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds),
    retentionSeconds: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.retentionSeconds
    ),
    shardCount: z.literal(INBOX_V2_SECURITY_DENIAL_POLICY.shardCount),
    detailBucketLimitPerShard: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard
    ),
    reviewCandidateLimitPerShard: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard
    ),
    attemptRateLimitPerShard: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.attemptRateLimitPerShard
    ),
    lockTimeoutMilliseconds: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.lockTimeoutMilliseconds
    ),
    statementTimeoutMilliseconds: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.statementTimeoutMilliseconds
    ),
    maxInFlightObservations: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightObservations
    ),
    maxInFlightTelemetryCallbacks: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.maxInFlightTelemetryCallbacks
    ),
    circuitFailureThreshold: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.circuitFailureThreshold
    ),
    circuitCooldownMilliseconds: z.literal(
      INBOX_V2_SECURITY_DENIAL_POLICY.circuitCooldownMilliseconds
    )
  })
  .strict();

export const inboxV2SecurityDenialFingerprintKeyEpochSchema = z
  .string()
  .regex(/^security-denial-key:[a-f0-9]{16,32}$/u);

/**
 * A server-produced, tenant-keyed HMAC. Raw IDs, IPs, contact values and
 * low-entropy public hashes are intentionally not representable here.
 */
export const inboxV2SecurityDenialFingerprintSchema = z
  .string()
  .regex(/^hmac-sha256:[a-f0-9]{64}$/u);

/**
 * A fresh server-generated nonce for one sink invocation. It is fixed-width,
 * contains no caller identifier and is echoed only by the trusted sink result
 * so a cached result from another denial cannot be accepted as this write.
 */
export const inboxV2SecurityDenialObservationReceiptSchema = z
  .string()
  .regex(/^security-denial-observation:[a-f0-9]{64}$/u);

export const inboxV2SecurityDenialActionSchema = z.enum([
  "resource.read",
  "resource.mutate",
  "authorization.privileged_mutation",
  "identity.claim",
  "privacy.hold.issue",
  "privacy.hold.release",
  "privacy.subject_evidence.view",
  "privacy.tenant_export",
  "privacy.deletion.preview",
  "privacy.deletion.approve",
  "privacy.deletion.execute"
]);

export const inboxV2SecurityDenialPrincipalClassSchema = z.enum([
  "employee",
  "trusted_service",
  "platform_support",
  "invalid_or_anonymous"
]);

export const inboxV2SecurityDenialKindSchema = z.enum([
  "unknown_or_hidden_resource",
  "cross_tenant_probe",
  "missing_permission",
  "scope_mismatch",
  "stale_authorization",
  "manual_self_claim",
  "separation_of_duties",
  "hard_boundary",
  "state_guard",
  "other_denied"
]);

export const inboxV2SecurityDenialPublicErrorClassSchema = z.enum([
  "not_found",
  "permission_denied",
  "authorization_stale",
  "identity_claim_self_forbidden",
  "privacy_denied",
  "state_conflict",
  "other_denied"
]);

export const inboxV2SecurityDenialRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "critical"
]);

export const inboxV2SecurityDenialReviewTypeSchema = z.enum([
  "guessed_identifier_probe",
  "cross_tenant_probe",
  "manual_self_claim",
  "privacy_hold_issue_denied",
  "privacy_hold_release_denied",
  "privacy_evidence_access_denied",
  "tenant_export_denied",
  "destructive_preview_denied",
  "destructive_approval_denied",
  "destructive_execution_denied",
  "denial_rate_exceeded",
  "denial_volume_exceeded"
]);

export const inboxV2SecurityDenialAlertTypeSchema = z.enum([
  "security_probe_review",
  "identity_claim_review",
  "privacy_control_review",
  "abuse_threshold_alert"
]);

export const inboxV2SecurityDenialReviewSignalSchema = z
  .object({
    reviewType: inboxV2SecurityDenialReviewTypeSchema,
    alertType: inboxV2SecurityDenialAlertTypeSchema,
    candidateRef: inboxV2InternalOpaqueReferenceSchema.nullable()
  })
  .strict();

export const inboxV2SecurityDenialAttemptSchema = z
  .object({
    observationReceipt: inboxV2SecurityDenialObservationReceiptSchema,
    tenantId: inboxV2TenantIdSchema,
    action: inboxV2SecurityDenialActionSchema,
    principalClass: inboxV2SecurityDenialPrincipalClassSchema,
    fingerprintKeyEpoch: inboxV2SecurityDenialFingerprintKeyEpochSchema,
    actorFingerprint: inboxV2SecurityDenialFingerprintSchema,
    dedupeFingerprint: inboxV2SecurityDenialFingerprintSchema,
    denialKind: inboxV2SecurityDenialKindSchema,
    publicErrorClass: inboxV2SecurityDenialPublicErrorClassSchema,
    risk: inboxV2SecurityDenialRiskSchema,
    reviewSignal: inboxV2SecurityDenialReviewSignalSchema.nullable(),
    policy: inboxV2SecurityDenialPolicySchema
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.actorFingerprint === attempt.dedupeFingerprint) {
      context.addIssue({
        code: "custom",
        path: ["dedupeFingerprint"],
        message:
          "Actor and denial-dedupe fingerprints must be domain-separated."
      });
    }

    if (
      (attempt.denialKind === "unknown_or_hidden_resource" ||
        attempt.denialKind === "cross_tenant_probe") &&
      attempt.publicErrorClass !== "not_found"
    ) {
      context.addIssue({
        code: "custom",
        path: ["publicErrorClass"],
        message:
          "Hidden and cross-tenant targets require one non-disclosing public class."
      });
    }
    if (
      (attempt.denialKind === "manual_self_claim" &&
        (attempt.action !== "identity.claim" ||
          attempt.publicErrorClass !== "identity_claim_self_forbidden")) ||
      (attempt.publicErrorClass === "identity_claim_self_forbidden" &&
        attempt.denialKind !== "manual_self_claim")
    ) {
      context.addIssue({
        code: "custom",
        path: ["denialKind"],
        message:
          "Manual self-claim denial must use the identity claim action and error class."
      });
    }
    if (
      (attempt.denialKind === "unknown_or_hidden_resource" ||
        attempt.denialKind === "cross_tenant_probe") &&
      attempt.reviewSignal?.candidateRef !== null
    ) {
      context.addIssue({
        code: "custom",
        path: ["reviewSignal", "candidateRef"],
        message:
          "Undisclosable targets cannot create a resolvable review reference."
      });
    }

    const expectedReview = expectedReviewForAttempt(attempt);
    if (!sameReviewSignal(attempt.reviewSignal, expectedReview)) {
      context.addIssue({
        code: "custom",
        path: ["reviewSignal"],
        message:
          "High-risk denial review type must be derived from the denied action."
      });
    }
    if (attempt.risk !== expectedRiskForAttempt(attempt)) {
      context.addIssue({
        code: "custom",
        path: ["risk"],
        message:
          "Denial risk must be derived from the trusted action and denial class."
      });
    }
  });

export const inboxV2SecurityDenialAttemptEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SECURITY_DENIAL_ATTEMPT_SCHEMA_ID,
    INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION,
    inboxV2SecurityDenialAttemptSchema
  );

export const inboxV2SecurityDenialDispositionSchema = z.enum([
  "recorded",
  "deduplicated",
  "aggregated_overflow",
  "rate_limited"
]);

export const inboxV2SecurityDenialReviewWriteSchema = z
  .object({
    reviewType: inboxV2SecurityDenialReviewTypeSchema,
    disposition: z.enum([
      "candidate_created",
      "candidate_aggregated",
      "overflow_created",
      "overflow_aggregated"
    ])
  })
  .strict();

export const inboxV2SecurityDenialResultSchema = z
  .object({
    observationReceipt: inboxV2SecurityDenialObservationReceiptSchema,
    tenantId: inboxV2TenantIdSchema,
    /** Trusted receive time produced by the sink, never by authorization input. */
    observedAt: inboxV2TimestampSchema,
    disposition: inboxV2SecurityDenialDispositionSchema,
    shardNo: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_SECURITY_DENIAL_POLICY.shardCount - 1),
    windowStartedAt: inboxV2TimestampSchema,
    windowEndedAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema,
    shardAttemptCount: inboxV2BigintCounterSchema,
    detailOccurrenceCount: inboxV2BigintCounterSchema.nullable(),
    admittedDetailBucketCount: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard),
    overflowCount: inboxV2BigintCounterSchema,
    counterSaturated: z.boolean(),
    reviewWrites: z.array(inboxV2SecurityDenialReviewWriteSchema).max(3)
  })
  .strict()
  .superRefine((result, context) => {
    const expectedWindow = inboxV2SecurityDenialWindowForObservedAt(
      result.observedAt
    );
    if (
      !isInboxV2TimestampOrderValid(
        result.windowStartedAt,
        result.windowEndedAt
      ) ||
      !isInboxV2TimestampOrderValid(result.windowEndedAt, result.expiresAt) ||
      result.windowStartedAt === result.windowEndedAt ||
      result.windowEndedAt === result.expiresAt ||
      result.windowStartedAt !== expectedWindow.windowStartedAt ||
      result.windowEndedAt !== expectedWindow.windowEndedAt ||
      result.expiresAt !== expectedWindow.expiresAt ||
      Date.parse(result.observedAt) < Date.parse(result.windowStartedAt) ||
      Date.parse(result.observedAt) >= Date.parse(result.windowEndedAt) ||
      ((result.disposition === "recorded" ||
        result.disposition === "deduplicated") &&
        result.detailOccurrenceCount === null) ||
      ((result.disposition === "aggregated_overflow" ||
        result.disposition === "rate_limited") &&
        result.detailOccurrenceCount !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Denial sink result must preserve one finite coherent window and disposition."
      });
    }
  });

export type InboxV2SecurityDenialWindow = Readonly<{
  windowStartedAt: string;
  windowEndedAt: string;
  expiresAt: string;
}>;

/** Canonical UTC window derived only from the trusted sink receive time. */
export function inboxV2SecurityDenialWindowForObservedAt(
  observedAtInput: string
): InboxV2SecurityDenialWindow {
  const observedAt = inboxV2TimestampSchema.parse(observedAtInput);
  const windowMilliseconds =
    INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds * 1_000;
  const startedMilliseconds =
    Math.floor(Date.parse(observedAt) / windowMilliseconds) *
    windowMilliseconds;
  const endedMilliseconds = startedMilliseconds + windowMilliseconds;
  return Object.freeze({
    windowStartedAt: new Date(startedMilliseconds).toISOString(),
    windowEndedAt: new Date(endedMilliseconds).toISOString(),
    expiresAt: new Date(
      startedMilliseconds +
        INBOX_V2_SECURITY_DENIAL_POLICY.retentionSeconds * 1_000
    ).toISOString()
  });
}

/**
 * One actor stays on one shard for a key generation. The rule intentionally
 * uses only the first unsigned 32 HMAC bits so PostgreSQL and JavaScript can
 * implement it without signed bigint ambiguity.
 */
export function inboxV2SecurityDenialShardForActorFingerprint(
  fingerprintInput: string
): number {
  const fingerprint =
    inboxV2SecurityDenialFingerprintSchema.parse(fingerprintInput);
  const unsignedPrefix = Number.parseInt(fingerprint.slice(12, 20), 16);
  return unsignedPrefix % INBOX_V2_SECURITY_DENIAL_POLICY.shardCount;
}

/**
 * A schema-valid result is not sufficient: it must describe this exact
 * attempt. This closes foreign-tenant/window/shard and fabricated-counter
 * responses from a compromised or stale sink implementation.
 */
export function inboxV2SecurityDenialResultMatchesAttempt(
  attemptInput: unknown,
  resultInput: unknown
): boolean {
  const attempt = inboxV2SecurityDenialAttemptSchema.safeParse(attemptInput);
  const result = inboxV2SecurityDenialResultSchema.safeParse(resultInput);
  if (!attempt.success || !result.success) return false;

  const expectedWindow = inboxV2SecurityDenialWindowForObservedAt(
    result.data.observedAt
  );
  const expectedReviewTypes = new Set<InboxV2SecurityDenialReviewType>();
  if (attempt.data.reviewSignal !== null) {
    expectedReviewTypes.add(attempt.data.reviewSignal.reviewType);
  }
  if (result.data.disposition === "aggregated_overflow") {
    expectedReviewTypes.add("denial_volume_exceeded");
  }
  if (result.data.disposition === "rate_limited") {
    expectedReviewTypes.add("denial_rate_exceeded");
  }
  const actualReviewTypes = result.data.reviewWrites.map(
    (write) => write.reviewType
  );
  const uniqueReviewTypes = new Set(actualReviewTypes);
  const shardAttemptCount = BigInt(result.data.shardAttemptCount);
  const detailOccurrenceCount =
    result.data.detailOccurrenceCount === null
      ? null
      : BigInt(result.data.detailOccurrenceCount);
  const overflowCount = BigInt(result.data.overflowCount);
  const admittedDetailBucketCount = BigInt(
    result.data.admittedDetailBucketCount
  );
  const isDetailDisposition =
    result.data.disposition === "recorded" ||
    result.data.disposition === "deduplicated";
  const thresholdWritesAreCoarse = result.data.reviewWrites.every((write) =>
    write.reviewType === "denial_rate_exceeded" ||
    write.reviewType === "denial_volume_exceeded"
      ? write.disposition === "overflow_created" ||
        write.disposition === "overflow_aggregated"
      : true
  );
  const noDetailWritesAreCoarse =
    isDetailDisposition ||
    result.data.reviewWrites.every(
      (write) =>
        write.disposition === "overflow_created" ||
        write.disposition === "overflow_aggregated"
    );
  const postgresBigintMaximum = 9_223_372_036_854_775_807n;
  const exposedCounterIsSaturated =
    shardAttemptCount === postgresBigintMaximum ||
    detailOccurrenceCount === postgresBigintMaximum ||
    overflowCount === postgresBigintMaximum;
  const countersAreCanonical =
    result.data.counterSaturated === exposedCounterIsSaturated;
  const minimumAccountedAttemptCount =
    detailOccurrenceCount === null
      ? admittedDetailBucketCount + overflowCount
      : detailOccurrenceCount + admittedDetailBucketCount - 1n + overflowCount;
  const nonsaturatedMassBalanceIsCanonical =
    result.data.counterSaturated ||
    minimumAccountedAttemptCount <= shardAttemptCount;
  const rateLimit = BigInt(
    INBOX_V2_SECURITY_DENIAL_POLICY.attemptRateLimitPerShard
  );
  const detailBucketLimit =
    INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard;
  const singleDetailBucketMassIsCanonical =
    result.data.counterSaturated ||
    detailOccurrenceCount === null ||
    result.data.admittedDetailBucketCount !== 1 ||
    detailOccurrenceCount + overflowCount === shardAttemptCount;
  const forcedRateOverflowCount =
    shardAttemptCount > rateLimit ? shardAttemptCount - rateLimit : 0n;
  const rateOverflowMassIsCanonical =
    result.data.disposition !== "rate_limited" ||
    (overflowCount >= forcedRateOverflowCount &&
      (result.data.counterSaturated ||
        result.data.admittedDetailBucketCount === detailBucketLimit ||
        overflowCount === forcedRateOverflowCount));
  const rateReviewWrite = result.data.reviewWrites.find(
    (write) => write.reviewType === "denial_rate_exceeded"
  );
  const volumeReviewWrite = result.data.reviewWrites.find(
    (write) => write.reviewType === "denial_volume_exceeded"
  );
  const thresholdTransitionsAreCanonical =
    (result.data.disposition !== "rate_limited" ||
      rateReviewWrite?.disposition ===
        (shardAttemptCount === rateLimit + 1n
          ? "overflow_created"
          : "overflow_aggregated")) &&
    (result.data.disposition !== "aggregated_overflow" ||
      volumeReviewWrite?.disposition ===
        (overflowCount === 1n ? "overflow_created" : "overflow_aggregated"));

  return (
    result.data.observationReceipt === attempt.data.observationReceipt &&
    result.data.tenantId === attempt.data.tenantId &&
    result.data.windowStartedAt === expectedWindow.windowStartedAt &&
    result.data.windowEndedAt === expectedWindow.windowEndedAt &&
    result.data.expiresAt === expectedWindow.expiresAt &&
    result.data.shardNo ===
      inboxV2SecurityDenialShardForActorFingerprint(
        attempt.data.actorFingerprint
      ) &&
    shardAttemptCount >= 1n &&
    admittedDetailBucketCount <= shardAttemptCount &&
    overflowCount <= shardAttemptCount &&
    (detailOccurrenceCount === null ||
      (detailOccurrenceCount >= 1n &&
        detailOccurrenceCount <= shardAttemptCount)) &&
    (result.data.disposition !== "recorded" || detailOccurrenceCount === 1n) &&
    (result.data.disposition !== "recorded" || overflowCount === 0n) &&
    (result.data.disposition !== "deduplicated" ||
      (detailOccurrenceCount !== null && detailOccurrenceCount >= 2n)) &&
    (isDetailDisposition || detailOccurrenceCount === null) &&
    (!isDetailDisposition || result.data.admittedDetailBucketCount >= 1) &&
    (result.data.disposition === "rate_limited" ||
      overflowCount === 0n ||
      result.data.admittedDetailBucketCount === detailBucketLimit) &&
    (result.data.disposition !== "aggregated_overflow" ||
      (result.data.admittedDetailBucketCount ===
        INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard &&
        overflowCount >= 1n)) &&
    (result.data.disposition !== "rate_limited" ||
      (shardAttemptCount > rateLimit &&
        overflowCount >= 1n &&
        result.data.admittedDetailBucketCount >= 1)) &&
    shardAttemptCount > rateLimit ===
      (result.data.disposition === "rate_limited") &&
    uniqueReviewTypes.size === actualReviewTypes.length &&
    uniqueReviewTypes.size === expectedReviewTypes.size &&
    [...expectedReviewTypes].every((reviewType) =>
      uniqueReviewTypes.has(reviewType)
    ) &&
    thresholdWritesAreCoarse &&
    thresholdTransitionsAreCanonical &&
    noDetailWritesAreCoarse &&
    countersAreCanonical &&
    nonsaturatedMassBalanceIsCanonical &&
    singleDetailBucketMassIsCanonical &&
    rateOverflowMassIsCanonical
  );
}

export const inboxV2SecurityDenialResultEnvelopeSchema =
  createInboxV2SchemaEnvelopeSchema(
    INBOX_V2_SECURITY_DENIAL_RESULT_SCHEMA_ID,
    INBOX_V2_SECURITY_DENIAL_SCHEMA_VERSION,
    inboxV2SecurityDenialResultSchema
  );

export const inboxV2SecurityDenialReviewAggregationKindSchema = z.enum([
  "candidate",
  "overflow"
]);

export const inboxV2SecurityDenialReviewStatusSchema = z.enum([
  "open",
  "acknowledged",
  "closed"
]);

export const inboxV2SecurityDenialReviewRecordSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    windowStartedAt: inboxV2TimestampSchema,
    windowEndedAt: inboxV2TimestampSchema,
    shardNo: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_SECURITY_DENIAL_POLICY.shardCount - 1),
    reviewType: inboxV2SecurityDenialReviewTypeSchema,
    alertType: inboxV2SecurityDenialAlertTypeSchema,
    aggregationKind: inboxV2SecurityDenialReviewAggregationKindSchema,
    candidateFingerprint: inboxV2SecurityDenialFingerprintSchema.nullable(),
    candidateRef: inboxV2InternalOpaqueReferenceSchema.nullable(),
    risk: inboxV2SecurityDenialRiskSchema,
    status: inboxV2SecurityDenialReviewStatusSchema,
    triggerCount: inboxV2BigintCounterSchema,
    firstSeenAt: inboxV2TimestampSchema,
    lastSeenAt: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((review, context) => {
    const expectedPresentation = reviewPresentation(review.reviewType);
    const candidateShape =
      review.aggregationKind === "candidate"
        ? review.candidateFingerprint !== null &&
          review.reviewType !== "denial_rate_exceeded" &&
          review.reviewType !== "denial_volume_exceeded"
        : review.candidateFingerprint === null && review.candidateRef === null;
    const referenceIsConservativelyRedacted =
      review.reviewType === "manual_self_claim" || review.candidateRef === null;
    const windowStartedMilliseconds = Date.parse(review.windowStartedAt);
    const windowEndedMilliseconds = Date.parse(review.windowEndedAt);
    const firstSeenMilliseconds = Date.parse(review.firstSeenAt);
    const lastSeenMilliseconds = Date.parse(review.lastSeenAt);
    const windowMilliseconds =
      INBOX_V2_SECURITY_DENIAL_POLICY.windowSeconds * 1_000;
    const expectedExpiry = new Date(
      windowStartedMilliseconds +
        INBOX_V2_SECURITY_DENIAL_POLICY.retentionSeconds * 1_000
    ).toISOString();
    if (
      !candidateShape ||
      !referenceIsConservativelyRedacted ||
      review.alertType !== expectedPresentation.alertType ||
      !expectedPresentation.risks.includes(review.risk) ||
      BigInt(review.triggerCount) < 1n ||
      windowStartedMilliseconds % windowMilliseconds !== 0 ||
      windowEndedMilliseconds - windowStartedMilliseconds !==
        windowMilliseconds ||
      firstSeenMilliseconds < windowStartedMilliseconds ||
      lastSeenMilliseconds < firstSeenMilliseconds ||
      lastSeenMilliseconds >= windowEndedMilliseconds ||
      !isInboxV2TimestampOrderValid(
        review.windowStartedAt,
        review.windowEndedAt
      ) ||
      !isInboxV2TimestampOrderValid(
        review.windowStartedAt,
        review.firstSeenAt
      ) ||
      !isInboxV2TimestampOrderValid(review.firstSeenAt, review.lastSeenAt) ||
      !isInboxV2TimestampOrderValid(review.lastSeenAt, review.windowEndedAt) ||
      !isInboxV2TimestampOrderValid(review.windowEndedAt, review.expiresAt) ||
      review.expiresAt !== expectedExpiry
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Review rows must remain redacted, bounded and ordered inside one finite window."
      });
    }
  });

export type InboxV2SecurityDenialAttempt = z.infer<
  typeof inboxV2SecurityDenialAttemptSchema
>;
export type InboxV2SecurityDenialResult = z.infer<
  typeof inboxV2SecurityDenialResultSchema
>;
export type InboxV2SecurityDenialReviewRecord = z.infer<
  typeof inboxV2SecurityDenialReviewRecordSchema
>;
export type InboxV2SecurityDenialAction = z.infer<
  typeof inboxV2SecurityDenialActionSchema
>;
export type InboxV2SecurityDenialKind = z.infer<
  typeof inboxV2SecurityDenialKindSchema
>;
export type InboxV2SecurityDenialPublicErrorClass = z.infer<
  typeof inboxV2SecurityDenialPublicErrorClassSchema
>;
export type InboxV2SecurityDenialRisk = z.infer<
  typeof inboxV2SecurityDenialRiskSchema
>;
export type InboxV2SecurityDenialReviewType = z.infer<
  typeof inboxV2SecurityDenialReviewTypeSchema
>;

export function inboxV2SecurityDenialMaximumRowsPerWindow(): number {
  return (
    INBOX_V2_SECURITY_DENIAL_POLICY.shardCount *
    (1 +
      INBOX_V2_SECURITY_DENIAL_POLICY.detailBucketLimitPerShard +
      INBOX_V2_SECURITY_DENIAL_POLICY.reviewCandidateLimitPerShard +
      inboxV2SecurityDenialReviewTypeSchema.options.length)
  );
}

type ReviewDerivationInput = Readonly<{
  action: z.infer<typeof inboxV2SecurityDenialActionSchema>;
  denialKind: z.infer<typeof inboxV2SecurityDenialKindSchema>;
  reviewSignal: z.infer<typeof inboxV2SecurityDenialReviewSignalSchema> | null;
}>;

function expectedReviewForAttempt(
  attempt: ReviewDerivationInput
): z.infer<typeof inboxV2SecurityDenialReviewSignalSchema> | null {
  const candidateRef =
    attempt.denialKind === "unknown_or_hidden_resource" ||
    attempt.denialKind === "cross_tenant_probe"
      ? null
      : (attempt.reviewSignal?.candidateRef ?? null);
  if (attempt.denialKind === "manual_self_claim") {
    return {
      reviewType: "manual_self_claim",
      alertType: "identity_claim_review",
      candidateRef
    };
  }
  const byAction: Partial<
    Record<
      z.infer<typeof inboxV2SecurityDenialActionSchema>,
      readonly [
        z.infer<typeof inboxV2SecurityDenialReviewTypeSchema>,
        z.infer<typeof inboxV2SecurityDenialAlertTypeSchema>
      ]
    >
  > = {
    "privacy.hold.issue": [
      "privacy_hold_issue_denied",
      "privacy_control_review"
    ],
    "privacy.hold.release": [
      "privacy_hold_release_denied",
      "privacy_control_review"
    ],
    "privacy.subject_evidence.view": [
      "privacy_evidence_access_denied",
      "privacy_control_review"
    ],
    "privacy.tenant_export": ["tenant_export_denied", "privacy_control_review"],
    "privacy.deletion.preview": [
      "destructive_preview_denied",
      "privacy_control_review"
    ],
    "privacy.deletion.approve": [
      "destructive_approval_denied",
      "privacy_control_review"
    ],
    "privacy.deletion.execute": [
      "destructive_execution_denied",
      "privacy_control_review"
    ]
  };
  const derived = byAction[attempt.action];
  if (derived !== undefined) {
    return {
      reviewType: derived[0],
      alertType: derived[1],
      candidateRef: null
    };
  }
  if (attempt.denialKind === "cross_tenant_probe") {
    return {
      reviewType: "cross_tenant_probe",
      alertType: "security_probe_review",
      candidateRef: null
    };
  }
  if (attempt.denialKind === "unknown_or_hidden_resource") {
    return {
      reviewType: "guessed_identifier_probe",
      alertType: "security_probe_review",
      candidateRef: null
    };
  }
  return null;
}

function expectedRiskForAttempt(
  attempt: Pick<ReviewDerivationInput, "action" | "denialKind">
): z.infer<typeof inboxV2SecurityDenialRiskSchema> {
  if (
    attempt.denialKind === "cross_tenant_probe" ||
    attempt.action === "privacy.deletion.execute"
  ) {
    return "critical";
  }
  if (
    attempt.denialKind === "manual_self_claim" ||
    attempt.denialKind === "unknown_or_hidden_resource" ||
    attempt.action === "authorization.privileged_mutation" ||
    attempt.action === "identity.claim" ||
    attempt.action.startsWith("privacy.")
  ) {
    return "high";
  }
  return attempt.denialKind === "state_guard" ||
    attempt.denialKind === "other_denied"
    ? "low"
    : "medium";
}

function reviewPresentation(
  reviewType: z.infer<typeof inboxV2SecurityDenialReviewTypeSchema>
): Readonly<{
  alertType: z.infer<typeof inboxV2SecurityDenialAlertTypeSchema>;
  risks: readonly z.infer<typeof inboxV2SecurityDenialRiskSchema>[];
}> {
  if (reviewType === "cross_tenant_probe") {
    return { alertType: "security_probe_review", risks: ["critical"] };
  }
  if (reviewType === "guessed_identifier_probe") {
    return { alertType: "security_probe_review", risks: ["high"] };
  }
  if (reviewType === "manual_self_claim") {
    return { alertType: "identity_claim_review", risks: ["high"] };
  }
  if (
    reviewType === "denial_rate_exceeded" ||
    reviewType === "denial_volume_exceeded"
  ) {
    return {
      alertType: "abuse_threshold_alert",
      risks: ["high", "critical"]
    };
  }
  return {
    alertType: "privacy_control_review",
    risks:
      reviewType === "destructive_execution_denied"
        ? ["critical"]
        : ["high", "critical"]
  };
}

function sameReviewSignal(
  actual: z.infer<typeof inboxV2SecurityDenialReviewSignalSchema> | null,
  expected: z.infer<typeof inboxV2SecurityDenialReviewSignalSchema> | null
): boolean {
  return (
    actual === expected ||
    (actual !== null &&
      expected !== null &&
      actual.reviewType === expected.reviewType &&
      actual.alertType === expected.alertType &&
      actual.candidateRef === expected.candidateRef)
  );
}
