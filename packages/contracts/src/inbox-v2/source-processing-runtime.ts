import { z } from "zod";

import type { Brand } from "../brand";
import { inboxV2CatalogIdSchema, type InboxV2CatalogId } from "./catalog";
import { inboxV2ProcessingPurposeIdSchema } from "./data-lifecycle-primitives";
import {
  inboxV2EntityRevisionSchema,
  inboxV2TimestampSchema,
  isInboxV2TimestampOrderValid
} from "./entity-metadata";
import {
  inboxV2EmployeeReferenceSchema,
  inboxV2NormalizedInboundEventIdSchema,
  inboxV2RawInboundEventIdSchema,
  inboxV2SourceAccountIdSchema,
  inboxV2SourceConnectionIdSchema,
  inboxV2SourceThreadBindingIdSchema,
  inboxV2TenantIdSchema
} from "./ids";
import { inboxV2NamespacedIdSchema } from "./namespace";
import {
  calculateInboxV2BytesSha256,
  calculateInboxV2CanonicalSha256
} from "./recipient-sync-hash";
import { inboxV2SourceNormalizationHmacSha256Schema } from "./source-normalized-ingress";
import {
  inboxV2RawIngressClaimSchema,
  inboxV2RawIngressQuarantineReasonSchema,
  inboxV2RawPersistedSafeEnvelopeDigestSchema
} from "./source-raw-ingress";
import {
  inboxV2OpaqueProviderSubjectSchema,
  inboxV2RoutingTokenSchema,
  inboxV2RoutingTrustedServiceIdSchema,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2SourceDiagnosticIdSchema
} from "./source-routing-primitives";
import {
  inboxV2RequestIdSchema,
  inboxV2Sha256DigestSchema
} from "./sync-primitives";

export const INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS = 100;
export const INBOX_V2_SOURCE_PROCESSING_MAX_CLAIM_BATCH = 1_000;
export const INBOX_V2_SOURCE_PROCESSING_MAX_IN_FLIGHT = 10_000;
export const INBOX_V2_SOURCE_PROCESSING_MAX_QUEUED = 10_000_000;
export const INBOX_V2_SOURCE_PROCESSING_MAX_RETRY_DELAY_SECONDS = 86_400;
export const INBOX_V2_SOURCE_PROCESSING_MAX_RATE_LIMIT_SECONDS = 604_800;
export const INBOX_V2_SOURCE_PROCESSING_MAX_JITTER_BASIS_POINTS = 5_000;
export const INBOX_V2_SOURCE_DEDUPE_MAX_LOOKUP_CANDIDATES = 8;
export const INBOX_V2_SOURCE_REPLAY_REASON_CATALOG =
  "source-replay-reason" as const;
export const INBOX_V2_SOURCE_REPLAY_PURPOSE_ID =
  "core:source_replay_and_diagnostics" as const;
export const INBOX_V2_SOURCE_CURSOR_PURPOSE_ID =
  "core:source_ingress_cursor" as const;
export const INBOX_V2_SOURCE_HMAC_TENANT_SECRET_PURPOSE =
  "inbox_v2.source_processing_hmac" as const;
export const INBOX_V2_SOURCE_CURSOR_VALUE_TENANT_SECRET_PURPOSE =
  "inbox_v2.source_cursor_value" as const;

export type InboxV2SourceProcessingAttemptId = Brand<
  string,
  "InboxV2SourceProcessingAttemptId"
>;
export type InboxV2SourceProcessingWorkId = Brand<
  string,
  "InboxV2SourceProcessingWorkId"
>;
export type InboxV2SourceDeadLetterId = Brand<
  string,
  "InboxV2SourceDeadLetterId"
>;
export type InboxV2SourceReplayEpisodeId = Brand<
  string,
  "InboxV2SourceReplayEpisodeId"
>;
export type InboxV2SourceDedupeKeyGeneration = Brand<
  string,
  "InboxV2SourceDedupeKeyGeneration"
>;
export type InboxV2SourceProcessingHmacSha256 = Brand<
  string,
  "InboxV2SourceProcessingHmacSha256"
>;
export type InboxV2SourceReplayReasonId = InboxV2CatalogId<
  typeof INBOX_V2_SOURCE_REPLAY_REASON_CATALOG
>;

export const inboxV2SourceProcessingAttemptIdSchema =
  inboxV2RoutingTokenSchema.transform(
    (value) => value as InboxV2SourceProcessingAttemptId
  );
export const inboxV2SourceProcessingWorkIdSchema =
  inboxV2RoutingTokenSchema.transform(
    (value) => value as InboxV2SourceProcessingWorkId
  );
export const inboxV2SourceDeadLetterIdSchema =
  inboxV2RoutingTokenSchema.transform(
    (value) => value as InboxV2SourceDeadLetterId
  );
export const inboxV2SourceReplayRequestIdSchema = inboxV2RequestIdSchema;
export const inboxV2SourceReplayEpisodeIdSchema =
  inboxV2RoutingTokenSchema.transform(
    (value) => value as InboxV2SourceReplayEpisodeId
  );
export const inboxV2SourceDedupeKeyGenerationSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u)
  .transform((value) => value as InboxV2SourceDedupeKeyGeneration);
export type InboxV2SourceProcessingKeyGeneration =
  InboxV2SourceDedupeKeyGeneration;
export const inboxV2SourceProcessingKeyGenerationSchema =
  inboxV2SourceDedupeKeyGenerationSchema;
export const inboxV2TenantSecretRefSchema = z
  .string()
  .min(8)
  .max(512)
  .regex(/^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$/u);
export const inboxV2SourceProcessingHmacSha256Schema =
  inboxV2SourceNormalizationHmacSha256Schema.transform(
    (value) => value as InboxV2SourceProcessingHmacSha256
  );
export const inboxV2SourceProcessingLeaseTokenSchema = z
  .string()
  .min(32)
  .max(512)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._~:-]*$/u);

export function calculateInboxV2SourceProcessingLeaseTokenHash(
  leaseToken: string
) {
  return calculateInboxV2BytesSha256(
    new TextEncoder().encode(
      `core:inbox-v2.source-processing-lease-token\u0000${inboxV2SourceProcessingLeaseTokenSchema.parse(
        leaseToken
      )}`
    )
  );
}

export const inboxV2SourceProcessingStageSchema = z.enum([
  "raw_ingest",
  "normalization",
  "identity_resolution",
  "conversation_resolution",
  "routing",
  "message_reconciliation",
  "materialization"
]);

const sourceScopeShape = {
  tenantId: inboxV2TenantIdSchema,
  sourceConnectionId: inboxV2SourceConnectionIdSchema,
  sourceAccountId: inboxV2SourceAccountIdSchema.nullable()
} as const;

export const inboxV2SourceProcessingSourceScopeSchema = z
  .object(sourceScopeShape)
  .strict();

export const inboxV2SourceProcessingScopeSchema = z
  .object({
    ...sourceScopeShape,
    rawEventId: inboxV2RawInboundEventIdSchema,
    normalizedEventId: inboxV2NormalizedInboundEventIdSchema.nullable(),
    stage: inboxV2SourceProcessingStageSchema
  })
  .strict()
  .superRefine((scope, context) => {
    const beforeNormalization =
      scope.stage === "raw_ingest" || scope.stage === "normalization";
    if (beforeNormalization !== (scope.normalizedEventId === null)) {
      addIssue(
        context,
        ["normalizedEventId"],
        "Raw-ingest and normalization scopes have no normalized event; every later stage requires one."
      );
    }
  });

export const inboxV2SourceProcessingAttemptOriginSchema = z.enum([
  "initial",
  "retry",
  "replay"
]);

export const inboxV2SourceProcessingAttemptSchema = z
  .object({
    attemptId: inboxV2SourceProcessingAttemptIdSchema,
    workId: inboxV2SourceProcessingWorkIdSchema,
    scope: inboxV2SourceProcessingScopeSchema,
    origin: inboxV2SourceProcessingAttemptOriginSchema,
    replayRequestId: inboxV2SourceReplayRequestIdSchema.nullable(),
    attemptNumber: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS),
    maxAttempts: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS),
    // Exact revision of the currently leased work head used as the outcome
    // CAS fence. The immutable attempt/DLQ facts bind workRevision + 1, the
    // resulting terminal or retry-scheduled work revision.
    workRevision: inboxV2EntityRevisionSchema,
    workerId: inboxV2NamespacedIdSchema,
    leaseTokenHash: inboxV2Sha256DigestSchema,
    leaseRevision: inboxV2EntityRevisionSchema,
    leaseClaimedAt: inboxV2TimestampSchema,
    startedAt: inboxV2TimestampSchema,
    leaseExpiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((attempt, context) => {
    if (attempt.attemptNumber > attempt.maxAttempts) {
      addIssue(
        context,
        ["attemptNumber"],
        "Attempt number cannot exceed its finite attempt budget."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        attempt.leaseClaimedAt,
        attempt.startedAt
      ) ||
      Date.parse(attempt.startedAt) >= Date.parse(attempt.leaseExpiresAt)
    ) {
      addIssue(
        context,
        ["leaseExpiresAt"],
        "Source-processing attempt must start inside its exact claimed lease."
      );
    }
    if ((attempt.origin === "replay") !== (attempt.replayRequestId !== null)) {
      addIssue(
        context,
        ["replayRequestId"],
        "Only replay attempts bind an exact replay request."
      );
    }
    if (attempt.origin === "initial" && attempt.attemptNumber !== 1) {
      addIssue(
        context,
        ["attemptNumber"],
        "Initial processing starts at attempt one."
      );
    }
    if (attempt.origin === "retry" && attempt.attemptNumber === 1) {
      addIssue(
        context,
        ["attemptNumber"],
        "Retry processing must follow an earlier attempt."
      );
    }
  });

export const inboxV2SourceRateLimitHintSchema = z
  .object({
    kind: z.enum([
      "provider_retry_after",
      "provider_quota_reset",
      "local_circuit_open"
    ]),
    scope: z.enum(["source_connection", "source_account"]),
    observedAt: inboxV2TimestampSchema,
    retryAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((hint, context) => {
    const delay = Date.parse(hint.retryAt) - Date.parse(hint.observedAt);
    if (
      delay <= 0 ||
      delay > INBOX_V2_SOURCE_PROCESSING_MAX_RATE_LIMIT_SECONDS * 1_000
    ) {
      addIssue(
        context,
        ["retryAt"],
        "Rate-limit retry boundary must be future and within the finite maximum."
      );
    }
  });

export const inboxV2SourceEvidenceDeadlinesSchema = z
  .object({
    capturedAt: inboxV2TimestampSchema,
    rawPayloadExpiresAt: inboxV2TimestampSchema,
    allowedRawHeadersExpiresAt: inboxV2TimestampSchema,
    normalizedPayloadExpiresAt: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((deadlines, context) => {
    for (const [field, deadline] of [
      ["rawPayloadExpiresAt", deadlines.rawPayloadExpiresAt],
      ["allowedRawHeadersExpiresAt", deadlines.allowedRawHeadersExpiresAt],
      ["normalizedPayloadExpiresAt", deadlines.normalizedPayloadExpiresAt]
    ] as const) {
      if (
        deadline !== null &&
        Date.parse(deadline) <= Date.parse(deadlines.capturedAt)
      ) {
        addIssue(
          context,
          [field],
          "Every present source-evidence deadline must be finite and strictly after capture."
        );
      }
    }
  });

export const inboxV2SourceRetryScheduleSchema = z
  .object({
    reason: z.enum(["bounded_backoff", "rate_limited"]),
    nextAttemptAt: inboxV2TimestampSchema,
    rateLimitHint: inboxV2SourceRateLimitHintSchema.nullable()
  })
  .strict()
  .superRefine((retry, context) => {
    if ((retry.reason === "rate_limited") !== (retry.rateLimitHint !== null)) {
      addIssue(
        context,
        ["rateLimitHint"],
        "Only a rate-limited retry carries a bounded rate-limit hint."
      );
    }
    if (
      retry.rateLimitHint !== null &&
      Date.parse(retry.nextAttemptAt) < Date.parse(retry.rateLimitHint.retryAt)
    ) {
      addIssue(
        context,
        ["nextAttemptAt"],
        "Scheduled retry cannot precede the provider or circuit retry boundary."
      );
    }
  });

export const inboxV2SourceDeadLetterReasonSchema = z.enum([
  "terminal_failure",
  "attempts_exhausted"
]);

const sourceDeadLetterDecisionSchema = z
  .object({
    id: inboxV2SourceDeadLetterIdSchema,
    reason: inboxV2SourceDeadLetterReasonSchema,
    deadLetteredAt: inboxV2TimestampSchema
  })
  .strict();

const processedOutcomeSchema = z
  .object({
    kind: z.literal("processed"),
    attempt: inboxV2SourceProcessingAttemptSchema,
    completedAt: inboxV2TimestampSchema,
    diagnostic: z.null()
  })
  .strict();
const ignoredOutcomeSchema = z
  .object({
    kind: z.literal("ignored"),
    attempt: inboxV2SourceProcessingAttemptSchema,
    completedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema
  })
  .strict();
const duplicateOutcomeSchema = z
  .object({
    kind: z.literal("duplicate"),
    attempt: inboxV2SourceProcessingAttemptSchema,
    completedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema
  })
  .strict();
const retryScheduledOutcomeSchema = z
  .object({
    kind: z.literal("retry_scheduled"),
    attempt: inboxV2SourceProcessingAttemptSchema,
    completedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema,
    retry: inboxV2SourceRetryScheduleSchema
  })
  .strict();
const deadLetteredOutcomeSchema = z
  .object({
    kind: z.literal("dead_lettered"),
    attempt: inboxV2SourceProcessingAttemptSchema,
    completedAt: inboxV2TimestampSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema,
    deadLetter: sourceDeadLetterDecisionSchema
  })
  .strict();

export const inboxV2SourceProcessingOutcomeSchema = z
  .discriminatedUnion("kind", [
    processedOutcomeSchema,
    ignoredOutcomeSchema,
    duplicateOutcomeSchema,
    retryScheduledOutcomeSchema,
    deadLetteredOutcomeSchema
  ])
  .superRefine((outcome, context) => {
    if (
      !isInboxV2TimestampOrderValid(
        outcome.attempt.startedAt,
        outcome.completedAt
      ) ||
      Date.parse(outcome.completedAt) >=
        Date.parse(outcome.attempt.leaseExpiresAt)
    ) {
      addIssue(
        context,
        ["completedAt"],
        "A durable outcome must complete within the exact live lease."
      );
    }

    if (
      (outcome.kind === "ignored" || outcome.kind === "duplicate") &&
      outcome.diagnostic.retryable
    ) {
      addIssue(
        context,
        ["diagnostic", "retryable"],
        "Ignored and duplicate outcomes are terminal and not retryable."
      );
    }

    if (outcome.kind === "retry_scheduled") {
      if (
        !outcome.diagnostic.retryable ||
        outcome.attempt.attemptNumber >= outcome.attempt.maxAttempts
      ) {
        addIssue(
          context,
          ["retry"],
          "Retry requires a retryable diagnostic and remaining attempt budget."
        );
      }
      if (
        Date.parse(outcome.retry.nextAttemptAt) <=
        Date.parse(outcome.completedAt)
      ) {
        addIssue(
          context,
          ["retry", "nextAttemptAt"],
          "Retry must be scheduled strictly after durable completion."
        );
      }
      const maximumDelaySeconds =
        outcome.retry.reason === "rate_limited"
          ? INBOX_V2_SOURCE_PROCESSING_MAX_RATE_LIMIT_SECONDS
          : INBOX_V2_SOURCE_PROCESSING_MAX_RETRY_DELAY_SECONDS;
      if (
        Date.parse(outcome.retry.nextAttemptAt) -
          Date.parse(outcome.completedAt) >
        maximumDelaySeconds * 1_000
      ) {
        addIssue(
          context,
          ["retry", "nextAttemptAt"],
          "Retry schedule exceeds its finite delay boundary."
        );
      }
      if (
        outcome.retry.rateLimitHint?.scope === "source_account" &&
        outcome.attempt.scope.sourceAccountId === null
      ) {
        addIssue(
          context,
          ["retry", "rateLimitHint", "scope"],
          "Account rate limiting requires an exact SourceAccount scope."
        );
      }
    }

    if (outcome.kind === "dead_lettered") {
      const exhausted = outcome.deadLetter.reason === "attempts_exhausted";
      const validExhaustion =
        outcome.diagnostic.retryable &&
        outcome.attempt.attemptNumber === outcome.attempt.maxAttempts;
      const validTerminalFailure = !outcome.diagnostic.retryable;
      if (
        (exhausted && !validExhaustion) ||
        (!exhausted && !validTerminalFailure)
      ) {
        addIssue(
          context,
          ["deadLetter", "reason"],
          "Attempt exhaustion requires a retryable final-budget failure; terminal failure requires a non-retryable diagnostic."
        );
      }
      if (outcome.deadLetter.deadLetteredAt !== outcome.completedAt) {
        addIssue(
          context,
          ["deadLetter", "deadLetteredAt"],
          "Dead-letter creation and attempt completion are one durable decision."
        );
      }
    }
  });

export const inboxV2SourceDeadLetterRecordSchema = z
  .object({
    deadLetterId: inboxV2SourceDeadLetterIdSchema,
    attempt: inboxV2SourceProcessingAttemptSchema,
    reason: inboxV2SourceDeadLetterReasonSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema,
    deadLetteredAt: inboxV2TimestampSchema,
    evidenceDeadlines: inboxV2SourceEvidenceDeadlinesSchema,
    replayNotAfter: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((record, context) => {
    if (
      Date.parse(record.deadLetteredAt) <
        Date.parse(record.attempt.startedAt) ||
      Date.parse(record.deadLetteredAt) >=
        Date.parse(record.attempt.leaseExpiresAt)
    ) {
      addIssue(
        context,
        ["deadLetteredAt"],
        "Dead-letter creation must complete inside the exact attempt lease."
      );
    }
    if (
      Date.parse(record.deadLetteredAt) >= Date.parse(record.replayNotAfter) ||
      Date.parse(record.replayNotAfter) > Date.parse(record.expiresAt)
    ) {
      addIssue(
        context,
        ["replayNotAfter"],
        "DLQ replay and expiry windows must be finite and ordered."
      );
    }

    const exhausted = record.reason === "attempts_exhausted";
    const validExhaustion =
      record.diagnostic.retryable &&
      record.attempt.attemptNumber === record.attempt.maxAttempts;
    if (
      (exhausted && !validExhaustion) ||
      (!exhausted && record.diagnostic.retryable)
    ) {
      addIssue(
        context,
        ["reason"],
        "DLQ reason must agree with retryability and the finite attempt budget."
      );
    }
  });

export const inboxV2SourceBackpressurePolicySchema = z
  .object({
    maxClaimBatch: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_CLAIM_BATCH),
    maxInFlightPerTenant: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_IN_FLIGHT),
    maxInFlightPerConnection: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_IN_FLIGHT),
    maxInFlightPerAccount: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_IN_FLIGHT),
    maxQueuedPerTenant: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_QUEUED),
    maxQueuedPerConnection: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_QUEUED),
    maxQueuedPerAccount: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_QUEUED),
    maxAttempts: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS),
    baseRetryDelaySeconds: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_RETRY_DELAY_SECONDS),
    maxRetryDelaySeconds: z
      .number()
      .int()
      .min(1)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_RETRY_DELAY_SECONDS),
    jitterBasisPoints: z
      .number()
      .int()
      .min(0)
      .max(INBOX_V2_SOURCE_PROCESSING_MAX_JITTER_BASIS_POINTS)
  })
  .strict()
  .superRefine((policy, context) => {
    if (
      policy.maxInFlightPerAccount > policy.maxInFlightPerConnection ||
      policy.maxInFlightPerConnection > policy.maxInFlightPerTenant ||
      policy.maxClaimBatch > policy.maxInFlightPerTenant
    ) {
      addIssue(
        context,
        ["maxInFlightPerAccount"],
        "Account, connection, tenant and claim concurrency limits must be nested."
      );
    }
    if (
      policy.maxQueuedPerAccount > policy.maxQueuedPerConnection ||
      policy.maxQueuedPerConnection > policy.maxQueuedPerTenant
    ) {
      addIssue(
        context,
        ["maxQueuedPerAccount"],
        "Account, connection and tenant queue limits must be nested."
      );
    }
    if (policy.baseRetryDelaySeconds > policy.maxRetryDelaySeconds) {
      addIssue(
        context,
        ["baseRetryDelaySeconds"],
        "Base retry delay cannot exceed the bounded maximum delay."
      );
    }
  });

export const inboxV2SourceCursorPositionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("receive_cursor"),
      value: inboxV2OpaqueProviderSubjectSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("history_cursor"),
      value: inboxV2OpaqueProviderSubjectSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("provider_watermark"),
      value: inboxV2OpaqueProviderSubjectSchema
    })
    .strict()
]);

const sourceCursorRawWorkTargetSchema = z
  .object({
    kind: z.literal("raw_work"),
    scope: inboxV2SourceProcessingScopeSchema,
    durableWorkId: inboxV2SourceProcessingWorkIdSchema,
    durableWorkRevision: inboxV2EntityRevisionSchema,
    durableWorkState: z.enum([
      "pending",
      "leased",
      "retry_scheduled",
      "dead_lettered",
      "processed",
      "ignored",
      "duplicate"
    ]),
    persistedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((target, context) => {
    if (
      target.scope.stage !== "raw_ingest" ||
      target.scope.normalizedEventId !== null
    ) {
      addIssue(
        context,
        ["scope"],
        "A raw-work cursor target must bind the exact durable raw-ingress scope."
      );
    }
  });

const sourceCursorQuarantineTargetSchema = z
  .object({
    kind: z.literal("quarantine"),
    source: inboxV2SourceProcessingSourceScopeSchema,
    quarantineId: inboxV2NamespacedIdSchema,
    quarantineFingerprintSha256: inboxV2Sha256DigestSchema,
    reasonCode: inboxV2RawIngressQuarantineReasonSchema,
    persistedAt: inboxV2TimestampSchema
  })
  .strict();

export const inboxV2SourceCursorDurableTargetSchema = z.discriminatedUnion(
  "kind",
  [sourceCursorRawWorkTargetSchema, sourceCursorQuarantineTargetSchema]
);

export const inboxV2SourceCursorDurableAcknowledgementSchema = z
  .object({
    target: inboxV2SourceCursorDurableTargetSchema,
    cursorOwner: z.enum([
      "source_connection",
      "source_account",
      "source_thread_binding"
    ]),
    sourceThreadBindingId: inboxV2SourceThreadBindingIdSchema.nullable(),
    cursor: inboxV2SourceCursorPositionSchema,
    acknowledgedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((acknowledgement, context) => {
    const source =
      acknowledgement.target.kind === "raw_work"
        ? acknowledgement.target.scope
        : acknowledgement.target.source;
    if (
      acknowledgement.cursorOwner === "source_connection" &&
      acknowledgement.sourceThreadBindingId !== null
    ) {
      addIssue(
        context,
        ["cursorOwner"],
        "Connection cursor cannot be acknowledged through a thread-binding owner."
      );
    }
    if (
      acknowledgement.cursorOwner === "source_account" &&
      (source.sourceAccountId === null ||
        acknowledgement.sourceThreadBindingId !== null)
    ) {
      addIssue(
        context,
        ["cursorOwner"],
        "Account cursor requires exactly one SourceAccount and no binding."
      );
    }
    if (
      acknowledgement.cursorOwner === "source_thread_binding" &&
      (source.sourceAccountId === null ||
        acknowledgement.sourceThreadBindingId === null)
    ) {
      addIssue(
        context,
        ["sourceThreadBindingId"],
        "Thread-binding cursor requires exact account and binding scope."
      );
    }
    if (
      !isInboxV2TimestampOrderValid(
        acknowledgement.target.persistedAt,
        acknowledgement.acknowledgedAt
      )
    ) {
      addIssue(
        context,
        ["acknowledgedAt"],
        "Provider cursor cannot be acknowledged before raw work is durable."
      );
    }
  });

export const inboxV2SourceReplayReasonIdSchema =
  inboxV2CatalogIdSchema.transform(
    (value) => value as InboxV2SourceReplayReasonId
  );
export const inboxV2SourceReplayReasonSchema =
  inboxV2SourceReplayReasonIdSchema;

export const inboxV2SourceReplayTargetSchema = z
  .discriminatedUnion("kind", [
    z
      .object({
        kind: z.literal("raw_event"),
        scope: inboxV2SourceProcessingScopeSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("normalized_event"),
        scope: inboxV2SourceProcessingScopeSchema
      })
      .strict(),
    z
      .object({
        kind: z.literal("dead_letter"),
        deadLetterId: inboxV2SourceDeadLetterIdSchema,
        scope: inboxV2SourceProcessingScopeSchema
      })
      .strict()
  ])
  .superRefine((target, context) => {
    if (
      target.kind === "raw_event" &&
      (target.scope.stage !== "normalization" ||
        target.scope.normalizedEventId !== null)
    ) {
      addIssue(
        context,
        ["scope"],
        "Raw replay restarts from the exact normalization scope."
      );
    }
    if (
      target.kind === "normalized_event" &&
      (target.scope.stage === "normalization" ||
        target.scope.normalizedEventId === null)
    ) {
      addIssue(
        context,
        ["scope"],
        "Normalized replay requires an exact normalized event and downstream stage."
      );
    }
  });

export const inboxV2SourceReplayActorSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("employee"),
      employee: inboxV2EmployeeReferenceSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("trusted_service"),
      trustedServiceId: inboxV2RoutingTrustedServiceIdSchema
    })
    .strict()
]);

const sourceReplayRequestHashMaterialSchema = z
  .object({
    target: inboxV2SourceReplayTargetSchema,
    expectedTargetRevision: inboxV2EntityRevisionSchema,
    reasonId: inboxV2SourceReplayReasonIdSchema,
    requestedBy: inboxV2SourceReplayActorSchema,
    requestedAt: inboxV2TimestampSchema
  })
  .strict();

export function calculateInboxV2SourceReplayRequestHash(input: {
  target: unknown;
  expectedTargetRevision: unknown;
  reasonId: unknown;
  requestedBy: unknown;
  requestedAt: unknown;
}) {
  const material = sourceReplayRequestHashMaterialSchema.parse(input);
  return calculateInboxV2CanonicalSha256({
    schemaId: "core:inbox-v2.source-replay-request-hash@v1",
    ...material
  });
}

export const inboxV2SourceReplayRequestSchema = z
  .object({
    requestId: inboxV2SourceReplayRequestIdSchema,
    requestHash: inboxV2Sha256DigestSchema,
    target: inboxV2SourceReplayTargetSchema,
    expectedTargetRevision: inboxV2EntityRevisionSchema,
    reasonId: inboxV2SourceReplayReasonIdSchema,
    requestedBy: inboxV2SourceReplayActorSchema,
    requestedAt: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((request, context) => {
    const hashMaterial = sourceReplayRequestHashMaterialSchema.safeParse({
      target: request.target,
      expectedTargetRevision: request.expectedTargetRevision,
      reasonId: request.reasonId,
      requestedBy: request.requestedBy,
      requestedAt: request.requestedAt
    });
    if (
      hashMaterial.success &&
      request.requestHash !==
        calculateInboxV2CanonicalSha256({
          schemaId: "core:inbox-v2.source-replay-request-hash@v1",
          ...hashMaterial.data
        })
    ) {
      addIssue(
        context,
        ["requestHash"],
        "Replay request hash must match the canonical domain-separated command."
      );
    }
    if (
      request.requestedBy.kind === "employee" &&
      request.requestedBy.employee.tenantId !== request.target.scope.tenantId
    ) {
      addIssue(
        context,
        ["requestedBy", "employee", "tenantId"],
        "Replay employee and target must share one tenant."
      );
    }
  });

export const inboxV2SourceReplayRejectionReasonSchema = z.enum([
  "target_not_replayable",
  "replay_expired",
  "evidence_unavailable",
  "scope_mismatch",
  "revision_conflict",
  "key_unavailable",
  "idempotency_conflict"
]);

const replayResultBaseShape = {
  requestId: inboxV2SourceReplayRequestIdSchema,
  requestHash: inboxV2Sha256DigestSchema,
  target: inboxV2SourceReplayTargetSchema,
  expectedTargetRevision: inboxV2EntityRevisionSchema,
  decidedAt: inboxV2TimestampSchema
} as const;

const queuedReplayResultSchema = z
  .object({
    ...replayResultBaseShape,
    outcome: z.literal("queued"),
    replayEpisodeId: inboxV2SourceReplayEpisodeIdSchema,
    workId: inboxV2SourceProcessingWorkIdSchema,
    workRevision: inboxV2EntityRevisionSchema,
    queuedAt: inboxV2TimestampSchema,
    availableAt: inboxV2TimestampSchema,
    diagnostic: z.null()
  })
  .strict();
const idempotentReplayResultSchema = z
  .object({
    ...replayResultBaseShape,
    outcome: z.literal("idempotent_replay"),
    replayEpisodeId: inboxV2SourceReplayEpisodeIdSchema,
    workId: inboxV2SourceProcessingWorkIdSchema,
    workRevision: inboxV2EntityRevisionSchema,
    queuedAt: inboxV2TimestampSchema,
    availableAt: inboxV2TimestampSchema,
    diagnostic: z.null()
  })
  .strict();
const rejectedReplayResultSchema = z
  .object({
    ...replayResultBaseShape,
    outcome: z.literal("rejected"),
    reason: inboxV2SourceReplayRejectionReasonSchema,
    diagnostic: inboxV2SafeSourceDiagnosticSchema
  })
  .strict();

export const inboxV2SourceReplayResultSchema = z
  .discriminatedUnion("outcome", [
    queuedReplayResultSchema,
    idempotentReplayResultSchema,
    rejectedReplayResultSchema
  ])
  .superRefine((result, context) => {
    if (result.outcome === "rejected") {
      if (result.diagnostic.retryable) {
        addIssue(
          context,
          ["diagnostic", "retryable"],
          "Replay rejection is a stable non-retryable decision."
        );
      }
      return;
    }

    if (
      !isInboxV2TimestampOrderValid(result.queuedAt, result.availableAt) ||
      !isInboxV2TimestampOrderValid(result.queuedAt, result.decidedAt)
    ) {
      addIssue(
        context,
        ["queuedAt"],
        "Replay queue, availability and decision timestamps are incoherent."
      );
    }
    if (result.outcome === "queued" && result.queuedAt !== result.decidedAt) {
      addIssue(
        context,
        ["queuedAt"],
        "Fresh replay queueing and its durable decision occur atomically."
      );
    }
  });

export const inboxV2SourceReplayabilitySchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("replayable"),
      replayUntil: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      state: z.literal("not_replayable"),
      reason: z.enum(["processed", "ignored", "duplicate", "terminal_policy"]),
      decidedAt: inboxV2TimestampSchema
    })
    .strict(),
  z
    .object({
      state: z.literal("expired"),
      reason: z.enum(["evidence_expired", "guarantee_expired", "key_retired"]),
      expiredAt: inboxV2TimestampSchema
    })
    .strict()
]);

export const inboxV2SourceDedupeKeyGenerationStateSchema = z
  .object({
    generation: inboxV2SourceDedupeKeyGenerationSchema,
    state: z.enum(["active", "verify_only", "retired"]),
    activatedAt: inboxV2TimestampSchema,
    useUntil: inboxV2TimestampSchema,
    verifyUntil: inboxV2TimestampSchema,
    retiredAt: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((key, context) => {
    if (
      Date.parse(key.activatedAt) >= Date.parse(key.useUntil) ||
      Date.parse(key.useUntil) > Date.parse(key.verifyUntil)
    ) {
      addIssue(
        context,
        ["verifyUntil"],
        "Dedupe key generation must have finite ordered use and verification windows."
      );
    }
    if (
      (key.state === "retired") !== (key.retiredAt !== null) ||
      (key.retiredAt !== null &&
        Date.parse(key.retiredAt) < Date.parse(key.verifyUntil))
    ) {
      addIssue(
        context,
        ["retiredAt"],
        "Only a retired key has a retirement time after its verification window."
      );
    }
  });

export const inboxV2SourceDedupeTargetSchema = z.discriminatedUnion("phase", [
  z
    .object({
      phase: z.literal("raw"),
      rawEventId: inboxV2RawInboundEventIdSchema,
      normalizedEventId: z.null()
    })
    .strict(),
  z
    .object({
      phase: z.literal("normalized"),
      rawEventId: inboxV2RawInboundEventIdSchema,
      normalizedEventId: inboxV2NormalizedInboundEventIdSchema
    })
    .strict()
]);

export const inboxV2SourceDedupeOutcomeSchema = z
  .object({
    kind: z.enum(["processed", "ignored", "duplicate", "dead_lettered"]),
    diagnosticCodeId: inboxV2SourceDiagnosticIdSchema.nullable()
  })
  .strict()
  .superRefine((outcome, context) => {
    const requiresDiagnostic =
      outcome.kind === "ignored" || outcome.kind === "dead_lettered";
    if (requiresDiagnostic !== (outcome.diagnosticCodeId !== null)) {
      addIssue(
        context,
        ["diagnosticCodeId"],
        "Only ignored and dead-lettered skeleton outcomes retain a bounded diagnostic code."
      );
    }
  });

export const inboxV2SourceReplayPurposeIdSchema =
  inboxV2ProcessingPurposeIdSchema.refine(
    (value) => value === INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    { message: "Source dedupe skeleton requires its exact lifecycle purpose." }
  );

export const inboxV2SourceProcessingKeyPurposeIdSchema = z.enum([
  INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
  INBOX_V2_SOURCE_CURSOR_PURPOSE_ID
]);

export const inboxV2SourceDedupeSkeletonSchema = z
  .object({
    source: inboxV2SourceProcessingSourceScopeSchema,
    target: inboxV2SourceDedupeTargetSchema,
    purposeId: inboxV2SourceReplayPurposeIdSchema,
    digestKeyGeneration: inboxV2SourceDedupeKeyGenerationSchema,
    keyVerifyUntil: inboxV2TimestampSchema,
    identityHmacSha256: inboxV2SourceProcessingHmacSha256Schema,
    outcomeHmacSha256: inboxV2SourceProcessingHmacSha256Schema,
    outcome: inboxV2SourceDedupeOutcomeSchema,
    evidenceDeadlines: inboxV2SourceEvidenceDeadlinesSchema,
    terminalAt: inboxV2TimestampSchema,
    guaranteeUntil: inboxV2TimestampSchema,
    skeletonExpiresAt: inboxV2TimestampSchema,
    replayability: inboxV2SourceReplayabilitySchema,
    lifecycleState: z.enum(["active", "expired"]),
    expiredAt: inboxV2TimestampSchema.nullable()
  })
  .strict()
  .superRefine((skeleton, context) => {
    if (
      Date.parse(skeleton.terminalAt) >= Date.parse(skeleton.guaranteeUntil) ||
      Date.parse(skeleton.guaranteeUntil) >
        Date.parse(skeleton.skeletonExpiresAt)
    ) {
      addIssue(
        context,
        ["guaranteeUntil"],
        "Dedupe guarantee and skeleton expiry must be explicit, finite and ordered."
      );
    }
    if (
      Date.parse(skeleton.keyVerifyUntil) < Date.parse(skeleton.guaranteeUntil)
    ) {
      addIssue(
        context,
        ["keyVerifyUntil"],
        "Pinned key generation must remain verifiable through the declared guarantee."
      );
    }
    if (
      (skeleton.lifecycleState === "expired") !==
      (skeleton.expiredAt !== null)
    ) {
      addIssue(
        context,
        ["expiredAt"],
        "Expired skeleton state requires its explicit terminal expiry time."
      );
    }
    if (
      skeleton.expiredAt !== null &&
      Date.parse(skeleton.expiredAt) < Date.parse(skeleton.skeletonExpiresAt)
    ) {
      addIssue(
        context,
        ["expiredAt"],
        "Skeleton cannot expire before its finite lifecycle deadline."
      );
    }

    const replayability = skeleton.replayability;
    const evidenceExpiresAt =
      skeleton.target.phase === "raw"
        ? skeleton.evidenceDeadlines.rawPayloadExpiresAt
        : skeleton.evidenceDeadlines.normalizedPayloadExpiresAt;
    if (skeleton.target.phase === "normalized" && evidenceExpiresAt === null) {
      addIssue(
        context,
        ["evidenceDeadlines", "normalizedPayloadExpiresAt"],
        "Normalized dedupe evidence requires its separate payload deadline."
      );
    }
    if (replayability.state === "replayable") {
      if (
        Date.parse(replayability.replayUntil) <=
          Date.parse(skeleton.terminalAt) ||
        Date.parse(replayability.replayUntil) >
          Date.parse(skeleton.guaranteeUntil) ||
        (evidenceExpiresAt !== null &&
          Date.parse(replayability.replayUntil) >
            Date.parse(evidenceExpiresAt)) ||
        skeleton.lifecycleState === "expired"
      ) {
        addIssue(
          context,
          ["replayability"],
          "Replay requires live evidence, key verification and a window inside the dedupe guarantee."
        );
      }
    } else if (replayability.state === "not_replayable") {
      if (
        !isInboxV2TimestampOrderValid(
          skeleton.terminalAt,
          replayability.decidedAt
        )
      ) {
        addIssue(
          context,
          ["replayability", "decidedAt"],
          "Non-replayable decision cannot predate terminal processing."
        );
      }
    } else {
      if (
        !isInboxV2TimestampOrderValid(
          skeleton.terminalAt,
          replayability.expiredAt
        ) ||
        ((replayability.reason === "guarantee_expired" ||
          replayability.reason === "key_retired") &&
          Date.parse(replayability.expiredAt) <
            Date.parse(skeleton.guaranteeUntil))
      ) {
        addIssue(
          context,
          ["replayability", "expiredAt"],
          "Replay expiry must follow terminal processing and cannot shorten a declared key/guarantee window."
        );
      }
      if (
        replayability.reason === "evidence_expired" &&
        evidenceExpiresAt !== null &&
        Date.parse(replayability.expiredAt) < Date.parse(evidenceExpiresAt)
      ) {
        addIssue(
          context,
          ["replayability", "expiredAt"],
          "Evidence expiry cannot predate the selected raw or normalized deadline."
        );
      }
    }
  });

export const inboxV2SourceTerminalDedupeLifecycleInputSchema = z
  .object({
    scope: inboxV2SourceProcessingScopeSchema,
    terminalOutcomeKind: z.enum(["processed", "ignored", "duplicate"]),
    terminalAt: inboxV2TimestampSchema,
    admissionGuaranteeUntil: inboxV2TimestampSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (
      Date.parse(input.terminalAt) >= Date.parse(input.admissionGuaranteeUntil)
    ) {
      addIssue(
        context,
        ["admissionGuaranteeUntil"],
        "Terminal dedupe lifecycle must remain inside the admitted finite guarantee."
      );
    }
  });

export const inboxV2SourceTerminalDedupeLifecycleResolutionSchema = z
  .object({
    evidenceDeadlines: inboxV2SourceEvidenceDeadlinesSchema,
    skeletonExpiresAt: inboxV2TimestampSchema,
    replayability: z
      .object({
        state: z.literal("not_replayable"),
        reason: z.enum(["processed", "ignored", "duplicate"]),
        decidedAt: inboxV2TimestampSchema
      })
      .strict()
  })
  .strict();

export type InboxV2SourceTerminalDedupeLifecycleInput = z.infer<
  typeof inboxV2SourceTerminalDedupeLifecycleInputSchema
>;
export type InboxV2SourceTerminalDedupeLifecycleResolution = z.infer<
  typeof inboxV2SourceTerminalDedupeLifecycleResolutionSchema
>;

export interface InboxV2SourceTerminalDedupeLifecycleResolverPort {
  resolveTerminalDedupeLifecycle(
    input: Readonly<InboxV2SourceTerminalDedupeLifecycleInput>
  ): Promise<InboxV2SourceTerminalDedupeLifecycleResolution>;
}

const sourceTerminalDedupeSkeletonIdMaterialSchema = z
  .object({
    source: inboxV2SourceProcessingSourceScopeSchema,
    target: inboxV2SourceDedupeTargetSchema,
    keyGeneration: inboxV2SourceDedupeKeyGenerationSchema,
    identityHmacSha256: inboxV2SourceProcessingHmacSha256Schema
  })
  .strict();

export function calculateInboxV2SourceTerminalDedupeSkeletonId(input: {
  source: unknown;
  target: unknown;
  keyGeneration: unknown;
  identityHmacSha256: unknown;
}): string {
  const material = sourceTerminalDedupeSkeletonIdMaterialSchema.parse(input);
  const digest = calculateInboxV2CanonicalSha256({
    schemaId: "core:inbox-v2.source-terminal-dedupe-skeleton-id@v1",
    ...material
  });
  return inboxV2RoutingTokenSchema.parse(
    `source-skeleton:${digest.slice("sha256:".length)}`
  );
}

/**
 * Shared runtime/persistence boundary. Keeping this port in contracts prevents
 * the worker and SQL implementation from silently drifting on lease fences,
 * DLQ retention, cursor durability or finite HMAC-key lifecycle behavior.
 */
export const inboxV2SourceProcessingRuntimeClaimSchema = z
  .object({
    attempt: inboxV2SourceProcessingAttemptSchema,
    leaseToken: inboxV2SourceProcessingLeaseTokenSchema,
    rawIngressClaim: inboxV2RawIngressClaimSchema.nullable()
  })
  .strict()
  .superRefine((claim, context) => {
    if (
      calculateInboxV2SourceProcessingLeaseTokenHash(claim.leaseToken) !==
      claim.attempt.leaseTokenHash
    ) {
      addIssue(
        context,
        ["leaseToken"],
        "Runtime lease capability must match the durable processing digest."
      );
    }
    if (
      (claim.attempt.scope.stage === "normalization") !==
      (claim.rawIngressClaim !== null)
    ) {
      addIssue(
        context,
        ["rawIngressClaim"],
        "Only normalization claims carry the exact raw-ingress lease."
      );
    }
    if (
      claim.rawIngressClaim !== null &&
      (claim.rawIngressClaim.leaseToken !== claim.leaseToken ||
        claim.rawIngressClaim.work.tenantId !== claim.attempt.scope.tenantId ||
        claim.rawIngressClaim.work.rawEventId !==
          claim.attempt.scope.rawEventId ||
        claim.rawIngressClaim.work.lease?.workerId !== claim.attempt.workerId)
    ) {
      addIssue(
        context,
        ["rawIngressClaim"],
        "Processing and raw-ingress claims must share one worker, scope and ephemeral capability."
      );
    }
  });

export const inboxV2ClaimSourceProcessingRuntimeInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    workerId: inboxV2NamespacedIdSchema,
    leaseDurationSeconds: z.number().int().min(1).max(300),
    policy: inboxV2SourceBackpressurePolicySchema
  })
  .strict();

export const inboxV2ClaimSourceProcessingRuntimeResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("claimed"),
        claims: z
          .array(inboxV2SourceProcessingRuntimeClaimSchema)
          .min(1)
          .max(INBOX_V2_SOURCE_PROCESSING_MAX_CLAIM_BATCH)
          .readonly()
      })
      .strict(),
    z.object({ outcome: z.literal("empty") }).strict(),
    z
      .object({
        outcome: z.literal("backpressured"),
        retryAt: inboxV2TimestampSchema,
        scope: z.enum(["tenant", "source_connection", "source_account"])
      })
      .strict()
  ]);

export const inboxV2ApplySourceProcessingOutcomeInputSchema = z
  .object({
    leaseToken: inboxV2SourceProcessingLeaseTokenSchema,
    outcome: inboxV2SourceProcessingOutcomeSchema,
    deadLetterRecord: inboxV2SourceDeadLetterRecordSchema.nullable()
  })
  .strict()
  .superRefine((input, context) => {
    const deadLettered = input.outcome.kind === "dead_lettered";
    if (deadLettered !== (input.deadLetterRecord !== null)) {
      addIssue(
        context,
        ["deadLetterRecord"],
        "Exactly one complete DLQ record must accompany a dead-lettered outcome."
      );
      return;
    }
    if (
      input.outcome.kind !== "dead_lettered" ||
      input.deadLetterRecord === null
    ) {
      return;
    }
    const decision = input.outcome.deadLetter;
    const record = input.deadLetterRecord;
    const diagnostic = input.outcome.diagnostic;
    if (
      record.deadLetterId !== decision.id ||
      record.attempt.attemptId !== input.outcome.attempt.attemptId ||
      record.reason !== decision.reason ||
      record.deadLetteredAt !== decision.deadLetteredAt ||
      record.diagnostic.codeId !== diagnostic.codeId ||
      record.diagnostic.retryable !== diagnostic.retryable ||
      record.diagnostic.correlationToken !== diagnostic.correlationToken ||
      record.diagnostic.safeOperatorHintId !== diagnostic.safeOperatorHintId
    ) {
      addIssue(
        context,
        ["deadLetterRecord"],
        "DLQ record must be the lossless lifecycle projection of the fenced outcome."
      );
    }
  });

export const inboxV2ApplySourceProcessingOutcomeResultSchema =
  z.discriminatedUnion("outcome", [
    z.object({ outcome: z.enum(["applied", "already_applied"]) }).strict(),
    z
      .object({
        outcome: z.enum([
          "not_found",
          "not_leased",
          "stale_token",
          "lease_expired",
          "lease_revision_conflict"
        ])
      })
      .strict()
  ]);

export const inboxV2SourceReplayAuthorizationDecisionSchema =
  z.discriminatedUnion("outcome", [
    z.object({ outcome: z.literal("authorized") }).strict(),
    z
      .object({
        outcome: z.literal("denied"),
        decidedAt: inboxV2TimestampSchema,
        diagnostic: inboxV2SafeSourceDiagnosticSchema
      })
      .strict()
      .superRefine((decision, context) => {
        if (decision.diagnostic.retryable) {
          addIssue(
            context,
            ["diagnostic", "retryable"],
            "Authorization denial is a terminal replay decision."
          );
        }
      })
  ]);

export const inboxV2SourceCursorPersistenceInputSchema = z
  .object({
    acknowledgement: inboxV2SourceCursorDurableAcknowledgementSchema,
    cursorSlotId: inboxV2RoutingTokenSchema,
    routeGeneration: inboxV2EntityRevisionSchema,
    expectedCheckpointRevision: inboxV2EntityRevisionSchema.nullable()
  })
  .strict();

export const inboxV2SourceCursorProtectionSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    keyGeneration: inboxV2SourceDedupeKeyGenerationSchema,
    hmacKeySecretRef: inboxV2TenantSecretRefSchema,
    cursorValueSecretRef: inboxV2TenantSecretRefSchema,
    cursorHmacSha256: inboxV2SourceProcessingHmacSha256Schema
  })
  .strict()
  .superRefine((protection, context) => {
    if (
      !protection.hmacKeySecretRef.startsWith(
        `secret:${protection.tenantId}/`
      ) ||
      !protection.cursorValueSecretRef.startsWith(
        `secret:${protection.tenantId}/`
      )
    ) {
      addIssue(
        context,
        ["tenantId"],
        "Cursor HMAC key and encrypted value references must belong to the exact tenant."
      );
    }
    if (protection.hmacKeySecretRef === protection.cursorValueSecretRef) {
      addIssue(
        context,
        ["cursorValueSecretRef"],
        "Encrypted cursor value and HMAC key require distinct secret references."
      );
    }
  });

export const inboxV2SourceCursorPersistenceResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.enum(["acknowledged", "already_acknowledged"]),
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum([
          "durable_work_not_found",
          "durable_work_mismatch",
          "durable_quarantine_not_found",
          "durable_quarantine_mismatch",
          "revision_conflict",
          "key_unavailable"
        ])
      })
      .strict()
  ]
);

export const inboxV2SourceCursorDurableTargetLookupInputSchema = z
  .object({
    source: inboxV2SourceProcessingSourceScopeSchema,
    receipt: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("raw_work"),
          rawEventId: inboxV2RawInboundEventIdSchema,
          safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema
        })
        .strict(),
      z
        .object({
          kind: z.literal("quarantine"),
          quarantineId: inboxV2NamespacedIdSchema,
          safeEnvelopeDigest: inboxV2RawPersistedSafeEnvelopeDigestSchema,
          reasonCode: inboxV2RawIngressQuarantineReasonSchema
        })
        .strict()
    ])
  })
  .strict();

export const inboxV2SourceCursorDurableTargetLookupResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("resolved"),
        target: inboxV2SourceCursorDurableTargetSchema,
        resolvedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum(["not_found", "mismatch", "integrity_failure"])
      })
      .strict()
  ]);

export const inboxV2SourceCursorLoadInputSchema = z
  .object({
    source: inboxV2SourceProcessingSourceScopeSchema,
    cursorOwner: z.enum([
      "source_connection",
      "source_account",
      "source_thread_binding"
    ]),
    sourceThreadBindingId: inboxV2SourceThreadBindingIdSchema.nullable(),
    cursorSlotId: inboxV2RoutingTokenSchema
  })
  .strict()
  .superRefine((input, context) => {
    if (
      input.cursorOwner === "source_connection" &&
      input.sourceThreadBindingId !== null
    ) {
      addIssue(
        context,
        ["sourceThreadBindingId"],
        "Connection cursor cannot bind a source thread."
      );
    }
    if (
      input.cursorOwner === "source_account" &&
      (input.source.sourceAccountId === null ||
        input.sourceThreadBindingId !== null)
    ) {
      addIssue(
        context,
        ["cursorOwner"],
        "Account cursor requires one account and no source thread."
      );
    }
    if (
      input.cursorOwner === "source_thread_binding" &&
      (input.source.sourceAccountId === null ||
        input.sourceThreadBindingId === null)
    ) {
      addIssue(
        context,
        ["sourceThreadBindingId"],
        "Thread cursor requires one account and one source thread."
      );
    }
  });

export const inboxV2SourceCursorLoadResultSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("loaded"),
        cursor: inboxV2SourceCursorPositionSchema,
        routeGeneration: inboxV2EntityRevisionSchema,
        checkpointRevision: inboxV2EntityRevisionSchema,
        acknowledgedAt: inboxV2TimestampSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum(["not_found", "key_unavailable", "integrity_failure"])
      })
      .strict()
  ]
);

export const inboxV2SourceDedupeSkeletonWriteInputSchema = z
  .object({
    skeletonId: inboxV2RoutingTokenSchema,
    routeGeneration: inboxV2EntityRevisionSchema,
    skeleton: inboxV2SourceDedupeSkeletonSchema,
    /** Ephemeral provider identity used only by the trusted HMAC authority. */
    identityMaterial: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

export const inboxV2SourceDedupeSkeletonWriteResultSchema = z
  .object({
    outcome: z.enum([
      "written",
      "already_written",
      "conflict",
      "key_unavailable"
    ])
  })
  .strict();

export const inboxV2SourceDedupeSkeletonLookupInputSchema = z
  .object({
    source: inboxV2SourceProcessingSourceScopeSchema,
    phase: z.enum(["raw", "normalized"]),
    purposeId: inboxV2SourceReplayPurposeIdSchema,
    /** Ephemeral clear identity consumed only by the tenant HMAC authority. */
    identityMaterial: inboxV2OpaqueProviderSubjectSchema
  })
  .strict();

export const inboxV2SourceDedupeIdentityHmacCandidateSchema = z
  .object({
    generation: inboxV2SourceProcessingKeyGenerationSchema,
    hmacKeySecretRef: inboxV2TenantSecretRefSchema,
    identityHmacSha256: inboxV2SourceProcessingHmacSha256Schema
  })
  .strict();

export const inboxV2SourceDedupeIdentityCandidatesSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("derived"),
        source: inboxV2SourceProcessingSourceScopeSchema,
        phase: z.enum(["raw", "normalized"]),
        purposeId: inboxV2SourceReplayPurposeIdSchema,
        candidates: z
          .array(inboxV2SourceDedupeIdentityHmacCandidateSchema)
          .min(1)
          .max(INBOX_V2_SOURCE_DEDUPE_MAX_LOOKUP_CANDIDATES)
          .readonly()
      })
      .strict()
      .superRefine((derivation, context) => {
        const generations = new Set(
          derivation.candidates.map((candidate) => candidate.generation)
        );
        const hmacs = new Set(
          derivation.candidates.map((candidate) => candidate.identityHmacSha256)
        );
        if (
          generations.size !== derivation.candidates.length ||
          hmacs.size !== derivation.candidates.length
        ) {
          addIssue(
            context,
            ["candidates"],
            "Dedupe lookup candidates require unique key generations and HMACs."
          );
        }
        for (const [index, candidate] of derivation.candidates.entries()) {
          if (
            !candidate.hmacKeySecretRef.startsWith(
              `secret:${derivation.source.tenantId}/`
            )
          ) {
            addIssue(
              context,
              ["candidates", index, "hmacKeySecretRef"],
              "Dedupe lookup key reference must belong to the exact tenant."
            );
          }
        }
      }),
    z
      .object({
        outcome: z.literal("rejected"),
        reason: z.enum(["key_unavailable", "scope_mismatch"])
      })
      .strict()
  ]
);

export const inboxV2SourceDedupeSkeletonLookupResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.literal("found"),
        skeletonId: inboxV2RoutingTokenSchema,
        routeGeneration: inboxV2EntityRevisionSchema,
        skeleton: inboxV2SourceDedupeSkeletonSchema,
        matchedKeyGenerations: z
          .array(inboxV2SourceProcessingKeyGenerationSchema)
          .min(1)
          .max(INBOX_V2_SOURCE_DEDUPE_MAX_LOOKUP_CANDIDATES)
          .readonly()
      })
      .strict()
      .superRefine((result, context) => {
        if (
          new Set(result.matchedKeyGenerations).size !==
            result.matchedKeyGenerations.length ||
          !result.matchedKeyGenerations.includes(
            result.skeleton.digestKeyGeneration
          )
        ) {
          addIssue(
            context,
            ["matchedKeyGenerations"],
            "Found dedupe skeleton requires unique matched generations including its persisted generation."
          );
        }
      }),
    z
      .object({
        outcome: z.enum(["not_found", "key_unavailable", "integrity_failure"])
      })
      .strict()
  ]);

export const inboxV2SourceDedupeSkeletonExpireInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    skeletonId: inboxV2RoutingTokenSchema,
    expectedRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2SourceDedupeSkeletonExpireResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["expired", "already_expired"]),
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum(["not_due", "not_found", "revision_conflict"])
      })
      .strict()
  ]);

export const inboxV2SourceDedupeReplayabilityExpireInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    skeletonId: inboxV2RoutingTokenSchema,
    expectedRevision: inboxV2EntityRevisionSchema,
    reason: z.enum(["evidence_expired", "guarantee_expired", "key_retired"])
  })
  .strict();

export const inboxV2SourceDedupeReplayabilityExpireResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["expired", "already_expired"]),
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum(["not_due", "not_found", "revision_conflict"])
      })
      .strict()
  ]);

export const inboxV2SourceProcessingKeyRotationInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    purposeId: inboxV2SourceProcessingKeyPurposeIdSchema,
    generation: inboxV2SourceProcessingKeyGenerationSchema,
    secretRef: inboxV2TenantSecretRefSchema,
    activatedAt: inboxV2TimestampSchema,
    useUntil: inboxV2TimestampSchema,
    guaranteeUntil: inboxV2TimestampSchema,
    verifyUntil: inboxV2TimestampSchema,
    expectedActiveGeneration:
      inboxV2SourceProcessingKeyGenerationSchema.nullable()
  })
  .strict()
  .superRefine((input, context) => {
    if (!input.secretRef.startsWith(`secret:${input.tenantId}/`)) {
      addIssue(
        context,
        ["secretRef"],
        "Dedupe HMAC key reference must belong to the exact tenant."
      );
    }
    if (
      Date.parse(input.activatedAt) >= Date.parse(input.useUntil) ||
      Date.parse(input.useUntil) > Date.parse(input.guaranteeUntil) ||
      Date.parse(input.guaranteeUntil) > Date.parse(input.verifyUntil)
    ) {
      addIssue(
        context,
        ["verifyUntil"],
        "Rotated dedupe key requires finite ordered use, guarantee and verification windows."
      );
    }
  });

export const inboxV2SourceProcessingKeyRotationResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["rotated", "already_active"]),
        generation: inboxV2SourceProcessingKeyGenerationSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z.object({ outcome: z.literal("active_generation_conflict") }).strict()
  ]);

export const inboxV2SourceProcessingKeyRetirementInputSchema = z
  .object({
    tenantId: inboxV2TenantIdSchema,
    purposeId: inboxV2SourceProcessingKeyPurposeIdSchema,
    generation: inboxV2SourceProcessingKeyGenerationSchema,
    expectedRevision: inboxV2EntityRevisionSchema
  })
  .strict();

export const inboxV2SourceProcessingKeyRetirementResultSchema =
  z.discriminatedUnion("outcome", [
    z
      .object({
        outcome: z.enum(["retired", "already_retired"]),
        generation: inboxV2SourceProcessingKeyGenerationSchema,
        revision: inboxV2EntityRevisionSchema
      })
      .strict(),
    z
      .object({
        outcome: z.enum(["not_due", "not_found", "revision_conflict"])
      })
      .strict()
  ]);

/** Compatibility aliases for the pre-generalized replay-only API names. */
export const inboxV2SourceDedupeKeyRotationInputSchema =
  inboxV2SourceProcessingKeyRotationInputSchema;
export const inboxV2SourceDedupeKeyRotationResultSchema =
  inboxV2SourceProcessingKeyRotationResultSchema;
export const inboxV2SourceDedupeKeyRetirementInputSchema =
  inboxV2SourceProcessingKeyRetirementInputSchema;
export const inboxV2SourceDedupeKeyRetirementResultSchema =
  inboxV2SourceProcessingKeyRetirementResultSchema;

export const inboxV2SourceDedupeHmacVerificationSchema = z.discriminatedUnion(
  "outcome",
  [
    z
      .object({
        outcome: z.literal("verified"),
        tenantId: inboxV2TenantIdSchema,
        hmacKeySecretRef: inboxV2TenantSecretRefSchema
      })
      .strict()
      .superRefine((verification, context) => {
        if (
          !verification.hmacKeySecretRef.startsWith(
            `secret:${verification.tenantId}/`
          )
        ) {
          addIssue(
            context,
            ["hmacKeySecretRef"],
            "Verified HMAC key reference must belong to the exact tenant."
          );
        }
      }),
    z
      .object({
        outcome: z.literal("rejected"),
        reason: z.enum(["key_unavailable", "digest_mismatch", "scope_mismatch"])
      })
      .strict()
  ]
);

export type InboxV2SourceProcessingStage = z.infer<
  typeof inboxV2SourceProcessingStageSchema
>;
export type InboxV2SourceProcessingSourceScope = z.infer<
  typeof inboxV2SourceProcessingSourceScopeSchema
>;
export type InboxV2SourceProcessingScope = z.infer<
  typeof inboxV2SourceProcessingScopeSchema
>;
export type InboxV2SourceProcessingAttemptOrigin = z.infer<
  typeof inboxV2SourceProcessingAttemptOriginSchema
>;
export type InboxV2SourceProcessingAttempt = z.infer<
  typeof inboxV2SourceProcessingAttemptSchema
>;
export type InboxV2SourceRateLimitHint = z.infer<
  typeof inboxV2SourceRateLimitHintSchema
>;
export type InboxV2SourceEvidenceDeadlines = z.infer<
  typeof inboxV2SourceEvidenceDeadlinesSchema
>;
export type InboxV2SourceRetrySchedule = z.infer<
  typeof inboxV2SourceRetryScheduleSchema
>;
export type InboxV2SourceDeadLetterReason = z.infer<
  typeof inboxV2SourceDeadLetterReasonSchema
>;
export type InboxV2SourceProcessingOutcome = z.infer<
  typeof inboxV2SourceProcessingOutcomeSchema
>;
export type InboxV2SourceDeadLetterRecord = z.infer<
  typeof inboxV2SourceDeadLetterRecordSchema
>;
export type InboxV2SourceBackpressurePolicy = z.infer<
  typeof inboxV2SourceBackpressurePolicySchema
>;
export type InboxV2SourceCursorPosition = z.infer<
  typeof inboxV2SourceCursorPositionSchema
>;
export type InboxV2SourceCursorDurableAcknowledgement = z.infer<
  typeof inboxV2SourceCursorDurableAcknowledgementSchema
>;
export type InboxV2SourceCursorDurableTarget = z.infer<
  typeof inboxV2SourceCursorDurableTargetSchema
>;
export type InboxV2SourceReplayReason = z.infer<
  typeof inboxV2SourceReplayReasonSchema
>;
export type InboxV2SourceReplayTarget = z.infer<
  typeof inboxV2SourceReplayTargetSchema
>;
export type InboxV2SourceReplayActor = z.infer<
  typeof inboxV2SourceReplayActorSchema
>;
export type InboxV2SourceReplayRequestId = z.infer<
  typeof inboxV2SourceReplayRequestIdSchema
>;
export type InboxV2SourceReplayRequest = z.infer<
  typeof inboxV2SourceReplayRequestSchema
>;
export type InboxV2SourceReplayRejectionReason = z.infer<
  typeof inboxV2SourceReplayRejectionReasonSchema
>;
export type InboxV2SourceReplayResult = z.infer<
  typeof inboxV2SourceReplayResultSchema
>;
export type InboxV2SourceReplayability = z.infer<
  typeof inboxV2SourceReplayabilitySchema
>;
export type InboxV2SourceDedupeKeyGenerationState = z.infer<
  typeof inboxV2SourceDedupeKeyGenerationStateSchema
>;
export type InboxV2SourceDedupeTarget = z.infer<
  typeof inboxV2SourceDedupeTargetSchema
>;
export type InboxV2SourceDedupeOutcome = z.infer<
  typeof inboxV2SourceDedupeOutcomeSchema
>;
export type InboxV2SourceDedupeSkeleton = z.infer<
  typeof inboxV2SourceDedupeSkeletonSchema
>;
export type InboxV2SourceProcessingRuntimeClaim = z.infer<
  typeof inboxV2SourceProcessingRuntimeClaimSchema
>;
export type InboxV2ClaimSourceProcessingRuntimeInput = z.infer<
  typeof inboxV2ClaimSourceProcessingRuntimeInputSchema
>;
export type InboxV2ClaimSourceProcessingRuntimeResult = z.infer<
  typeof inboxV2ClaimSourceProcessingRuntimeResultSchema
>;
export type InboxV2ApplySourceProcessingOutcomeInput = z.infer<
  typeof inboxV2ApplySourceProcessingOutcomeInputSchema
>;
export type InboxV2ApplySourceProcessingOutcomeResult = z.infer<
  typeof inboxV2ApplySourceProcessingOutcomeResultSchema
>;
export type InboxV2SourceReplayAuthorizationDecision = z.infer<
  typeof inboxV2SourceReplayAuthorizationDecisionSchema
>;
export type InboxV2SourceCursorPersistenceInput = z.infer<
  typeof inboxV2SourceCursorPersistenceInputSchema
>;
export type InboxV2SourceCursorPersistenceResult = z.infer<
  typeof inboxV2SourceCursorPersistenceResultSchema
>;
export type InboxV2SourceCursorDurableTargetLookupInput = z.infer<
  typeof inboxV2SourceCursorDurableTargetLookupInputSchema
>;
export type InboxV2SourceCursorDurableTargetLookupResult = z.infer<
  typeof inboxV2SourceCursorDurableTargetLookupResultSchema
>;
export type InboxV2SourceCursorProtection = z.infer<
  typeof inboxV2SourceCursorProtectionSchema
>;
export type InboxV2SourceCursorLoadInput = z.infer<
  typeof inboxV2SourceCursorLoadInputSchema
>;
export type InboxV2SourceCursorLoadResult = z.infer<
  typeof inboxV2SourceCursorLoadResultSchema
>;
export type InboxV2SourceDedupeSkeletonWriteInput = z.infer<
  typeof inboxV2SourceDedupeSkeletonWriteInputSchema
>;
export type InboxV2SourceDedupeSkeletonWriteResult = z.infer<
  typeof inboxV2SourceDedupeSkeletonWriteResultSchema
>;
export type InboxV2SourceDedupeSkeletonLookupInput = z.infer<
  typeof inboxV2SourceDedupeSkeletonLookupInputSchema
>;
export type InboxV2SourceDedupeIdentityHmacCandidate = z.infer<
  typeof inboxV2SourceDedupeIdentityHmacCandidateSchema
>;
export type InboxV2SourceDedupeIdentityCandidates = z.infer<
  typeof inboxV2SourceDedupeIdentityCandidatesSchema
>;
export type InboxV2SourceDedupeSkeletonLookupResult = z.infer<
  typeof inboxV2SourceDedupeSkeletonLookupResultSchema
>;
export type InboxV2SourceDedupeSkeletonExpireInput = z.infer<
  typeof inboxV2SourceDedupeSkeletonExpireInputSchema
>;
export type InboxV2SourceDedupeSkeletonExpireResult = z.infer<
  typeof inboxV2SourceDedupeSkeletonExpireResultSchema
>;
export type InboxV2SourceDedupeReplayabilityExpireInput = z.infer<
  typeof inboxV2SourceDedupeReplayabilityExpireInputSchema
>;
export type InboxV2SourceDedupeReplayabilityExpireResult = z.infer<
  typeof inboxV2SourceDedupeReplayabilityExpireResultSchema
>;
export type InboxV2SourceDedupeKeyRotationInput = z.infer<
  typeof inboxV2SourceDedupeKeyRotationInputSchema
>;
export type InboxV2SourceDedupeKeyRotationResult = z.infer<
  typeof inboxV2SourceDedupeKeyRotationResultSchema
>;
export type InboxV2SourceProcessingKeyRotationInput = z.infer<
  typeof inboxV2SourceProcessingKeyRotationInputSchema
>;
export type InboxV2SourceProcessingKeyRotationResult = z.infer<
  typeof inboxV2SourceProcessingKeyRotationResultSchema
>;
export type InboxV2SourceDedupeKeyRetirementInput = z.infer<
  typeof inboxV2SourceDedupeKeyRetirementInputSchema
>;
export type InboxV2SourceDedupeKeyRetirementResult = z.infer<
  typeof inboxV2SourceDedupeKeyRetirementResultSchema
>;
export type InboxV2SourceProcessingKeyRetirementInput = z.infer<
  typeof inboxV2SourceProcessingKeyRetirementInputSchema
>;
export type InboxV2SourceProcessingKeyRetirementResult = z.infer<
  typeof inboxV2SourceProcessingKeyRetirementResultSchema
>;
export type InboxV2SourceDedupeHmacVerification = z.infer<
  typeof inboxV2SourceDedupeHmacVerificationSchema
>;

export interface InboxV2SourceReplayAuthorizationPort {
  authorizeReplay(
    request: InboxV2SourceReplayRequest
  ):
    | InboxV2SourceReplayAuthorizationDecision
    | Promise<InboxV2SourceReplayAuthorizationDecision>;
}

export interface InboxV2SourceCursorDurableTargetResolverPort {
  resolveCursorDurableTarget(
    input: Readonly<InboxV2SourceCursorDurableTargetLookupInput>
  ): Promise<InboxV2SourceCursorDurableTargetLookupResult>;
}

/**
 * Mandatory tenant-key authority. Clear cursor/identity material is ephemeral;
 * implementations persist only encrypted cursor refs and verified HMACs.
 */
export interface InboxV2SourceProcessingCryptographicAuthorityPort {
  protectCursor(
    input: Readonly<InboxV2SourceCursorPersistenceInput>
  ): Promise<InboxV2SourceCursorProtection>;
  resolveCursor(
    input: Readonly<{
      source: InboxV2SourceProcessingSourceScope;
      protection: InboxV2SourceCursorProtection;
    }>
  ): Promise<InboxV2SourceCursorPosition | null>;
  verifyDedupeSkeleton(
    input: Readonly<InboxV2SourceDedupeSkeletonWriteInput>
  ): Promise<InboxV2SourceDedupeHmacVerification>;
  deriveDedupeIdentityCandidates(
    input: Readonly<InboxV2SourceDedupeSkeletonLookupInput>
  ): Promise<InboxV2SourceDedupeIdentityCandidates>;
}

export interface InboxV2SourceProcessingRuntimeRepositoryPort {
  claim(
    input: Readonly<InboxV2ClaimSourceProcessingRuntimeInput>
  ): Promise<InboxV2ClaimSourceProcessingRuntimeResult>;
  applyOutcome(
    input: Readonly<InboxV2ApplySourceProcessingOutcomeInput>
  ): Promise<InboxV2ApplySourceProcessingOutcomeResult>;
  requestReplay(
    request: Readonly<InboxV2SourceReplayRequest>
  ): Promise<InboxV2SourceReplayResult>;
  acknowledgeCursor(
    input: Readonly<InboxV2SourceCursorPersistenceInput>
  ): Promise<InboxV2SourceCursorPersistenceResult>;
  loadCursor(
    input: Readonly<InboxV2SourceCursorLoadInput>
  ): Promise<InboxV2SourceCursorLoadResult>;
  writeDedupeSkeleton(
    input: Readonly<InboxV2SourceDedupeSkeletonWriteInput>
  ): Promise<InboxV2SourceDedupeSkeletonWriteResult>;
  lookupDedupeSkeleton(
    input: Readonly<InboxV2SourceDedupeSkeletonLookupInput>
  ): Promise<InboxV2SourceDedupeSkeletonLookupResult>;
  expireDedupeSkeleton(
    input: Readonly<InboxV2SourceDedupeSkeletonExpireInput>
  ): Promise<InboxV2SourceDedupeSkeletonExpireResult>;
  expireDedupeReplayability(
    input: Readonly<InboxV2SourceDedupeReplayabilityExpireInput>
  ): Promise<InboxV2SourceDedupeReplayabilityExpireResult>;
  rotateProcessingKeyGeneration(
    input: Readonly<InboxV2SourceProcessingKeyRotationInput>
  ): Promise<InboxV2SourceProcessingKeyRotationResult>;
  retireProcessingKeyGeneration(
    input: Readonly<InboxV2SourceProcessingKeyRetirementInput>
  ): Promise<InboxV2SourceProcessingKeyRetirementResult>;
}

function addIssue(
  context: z.RefinementCtx,
  path: PropertyKey[],
  message: string
): void {
  context.addIssue({ code: "custom", path, message });
}
