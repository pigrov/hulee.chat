import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_DEDUPE_MAX_LOOKUP_CANDIDATES,
  calculateInboxV2SourceTerminalDedupeSkeletonId,
  calculateInboxV2SourceReplayRequestHash,
  calculateInboxV2SourceProcessingLeaseTokenHash,
  inboxV2ApplySourceProcessingOutcomeInputSchema,
  inboxV2SourceBackpressurePolicySchema,
  inboxV2SourceCursorDurableAcknowledgementSchema,
  inboxV2SourceCursorPersistenceInputSchema,
  inboxV2SourceCursorProtectionSchema,
  inboxV2SourceDeadLetterRecordSchema,
  inboxV2SourceDedupeKeyRotationInputSchema,
  inboxV2SourceDedupeKeyGenerationStateSchema,
  inboxV2SourceDedupeIdentityCandidatesSchema,
  inboxV2SourceDedupeSkeletonLookupInputSchema,
  inboxV2SourceDedupeSkeletonLookupResultSchema,
  inboxV2SourceDedupeSkeletonExpireInputSchema,
  inboxV2SourceDedupeSkeletonSchema,
  inboxV2SourceEvidenceDeadlinesSchema,
  inboxV2SourceProcessingAttemptSchema,
  inboxV2SourceProcessingKeyRetirementInputSchema,
  inboxV2SourceProcessingKeyRotationInputSchema,
  inboxV2SourceProcessingOutcomeSchema,
  inboxV2SourceProcessingScopeSchema,
  inboxV2SourceReplayRequestSchema,
  inboxV2SourceReplayResultSchema,
  inboxV2SourceTerminalDedupeLifecycleInputSchema,
  inboxV2SourceTerminalDedupeLifecycleResolutionSchema
} from "./source-processing-runtime";
import { calculateInboxV2RawIngressLeaseTokenHash } from "./source-raw-ingress";
import { inboxV2SourceProcessingOutcomeSchema as barrelOutcomeSchema } from "./index";

const t = {
  captured: "2026-07-17T08:00:00.000Z",
  claimed: "2026-07-17T08:00:01.000Z",
  started: "2026-07-17T08:00:02.000Z",
  completed: "2026-07-17T08:01:00.000Z",
  retry: "2026-07-17T08:02:00.000Z",
  leaseExpires: "2026-07-17T08:10:00.000Z",
  rawExpires: "2026-08-17T08:00:00.000Z",
  headersExpire: "2026-08-01T08:00:00.000Z",
  normalizedExpires: "2026-08-10T08:00:00.000Z",
  guarantee: "2026-09-17T08:00:00.000Z",
  skeletonExpires: "2026-10-17T08:00:00.000Z"
} as const;

const source = {
  tenantId: "tenant:tenant-1",
  sourceConnectionId: "source_connection:connection-1",
  sourceAccountId: "source_account:account-1"
} as const;

const normalizationScope = {
  ...source,
  rawEventId: "raw_inbound_event:raw-event-1",
  normalizedEventId: null,
  stage: "normalization"
} as const;

const materializationScope = {
  ...source,
  rawEventId: "raw_inbound_event:raw-event-1",
  normalizedEventId: "normalized_inbound_event:normalized-event-1",
  stage: "materialization"
} as const;

const attempt = {
  attemptId: "attempt:0001",
  workId: "work-item:0001",
  scope: materializationScope,
  origin: "retry",
  replayRequestId: null,
  attemptNumber: 2,
  maxAttempts: 3,
  workRevision: "2",
  workerId: "core:source-worker",
  leaseTokenHash: `sha256:${"a".repeat(64)}`,
  leaseRevision: "1",
  leaseClaimedAt: t.claimed,
  startedAt: t.started,
  leaseExpiresAt: t.leaseExpires
} as const;

const retryableDiagnostic = {
  codeId: "core:source-processing.retryable",
  retryable: true,
  correlationToken: "correlation:0001",
  safeOperatorHintId: "core:source.retry-later"
} as const;

const terminalDiagnostic = {
  ...retryableDiagnostic,
  codeId: "core:source-processing.terminal",
  retryable: false
} as const;

const evidenceDeadlines = {
  capturedAt: t.captured,
  rawPayloadExpiresAt: t.rawExpires,
  allowedRawHeadersExpiresAt: t.headersExpire,
  normalizedPayloadExpiresAt: t.normalizedExpires
} as const;

const rawReplayTarget = {
  kind: "raw_event",
  scope: normalizationScope
} as const;

const replayRequestMaterial = {
  target: rawReplayTarget,
  expectedTargetRevision: "2",
  reasonId: "core:source-replay.operator-requested",
  requestedBy: {
    kind: "trusted_service",
    trustedServiceId: "core:source-replay-worker"
  },
  requestedAt: t.completed
} as const;

const replayRequest = {
  requestId: "request:0001",
  requestHash: calculateInboxV2SourceReplayRequestHash(replayRequestMaterial),
  ...replayRequestMaterial
} as const;

describe("Inbox V2 source processing runtime contracts", () => {
  it("hashes source-processing lease tokens with a stable private domain", () => {
    const token = "source-processing-lease-token-0001";

    expect(calculateInboxV2SourceProcessingLeaseTokenHash(token)).toBe(
      "sha256:025ce7dd27352cc91fd5f6a875f8d6781b499af3264a90482eec251da0a4dd03"
    );
    expect(calculateInboxV2SourceProcessingLeaseTokenHash(token)).not.toBe(
      calculateInboxV2RawIngressLeaseTokenHash(token)
    );
    expect(() =>
      calculateInboxV2SourceProcessingLeaseTokenHash("short")
    ).toThrow();
  });

  it("keeps raw/normalization and downstream scopes exact", () => {
    expect(
      inboxV2SourceProcessingScopeSchema.safeParse(normalizationScope).success
    ).toBe(true);
    expect(
      inboxV2SourceProcessingScopeSchema.safeParse({
        ...normalizationScope,
        stage: "raw_ingest"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceProcessingScopeSchema.safeParse({
        ...materializationScope,
        normalizedEventId: null
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingScopeSchema.safeParse({
        ...normalizationScope,
        normalizedEventId: materializationScope.normalizedEventId
      }).success
    ).toBe(false);
  });

  it("binds each attempt to an exact finite lease and replay origin", () => {
    expect(
      inboxV2SourceProcessingAttemptSchema.safeParse(attempt).success
    ).toBe(true);
    expect(
      inboxV2SourceProcessingAttemptSchema.safeParse({
        ...attempt,
        attemptNumber: 4
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingAttemptSchema.safeParse({
        ...attempt,
        leaseClaimedAt: t.completed,
        startedAt: t.started
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingAttemptSchema.safeParse({
        ...attempt,
        origin: "replay",
        replayRequestId: null
      }).success
    ).toBe(false);
  });

  it("accepts safe terminal and retry outcomes but rejects unsafe retries", () => {
    const retryOutcome = {
      kind: "retry_scheduled",
      attempt,
      completedAt: t.completed,
      diagnostic: retryableDiagnostic,
      retry: {
        reason: "bounded_backoff",
        nextAttemptAt: t.retry,
        rateLimitHint: null
      }
    } as const;

    expect(
      inboxV2SourceProcessingOutcomeSchema.safeParse(retryOutcome).success
    ).toBe(true);
    expect(
      inboxV2SourceProcessingOutcomeSchema.safeParse({
        ...retryOutcome,
        diagnostic: terminalDiagnostic
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingOutcomeSchema.safeParse({
        ...retryOutcome,
        diagnostic: { ...retryableDiagnostic, rawError: "secret" }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingOutcomeSchema.safeParse({
        kind: "processed",
        attempt,
        completedAt: t.completed,
        diagnostic: null
      }).success
    ).toBe(true);
  });

  it("enforces typed DLQ reasons, safe diagnostics and finite replay expiry", () => {
    const finalAttempt = {
      ...attempt,
      attemptNumber: 3
    } as const;
    const record = {
      deadLetterId: "dead-letter:0001",
      attempt: finalAttempt,
      reason: "attempts_exhausted",
      diagnostic: retryableDiagnostic,
      deadLetteredAt: t.completed,
      evidenceDeadlines,
      replayNotAfter: t.rawExpires,
      expiresAt: t.skeletonExpires
    } as const;

    expect(inboxV2SourceDeadLetterRecordSchema.safeParse(record).success).toBe(
      true
    );
    expect(
      inboxV2SourceDeadLetterRecordSchema.safeParse({
        ...record,
        attempt,
        reason: "attempts_exhausted"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDeadLetterRecordSchema.safeParse({
        ...record,
        reason: "terminal_failure"
      }).success
    ).toBe(false);
  });

  it("requires a lossless DLQ record at the exact fenced apply boundary", () => {
    const finalAttempt = { ...attempt, attemptNumber: 3 } as const;
    const outcome = {
      kind: "dead_lettered",
      attempt: finalAttempt,
      completedAt: t.completed,
      diagnostic: retryableDiagnostic,
      deadLetter: {
        id: "dead-letter:0001",
        reason: "attempts_exhausted",
        deadLetteredAt: t.completed
      }
    } as const;
    const deadLetterRecord = {
      deadLetterId: outcome.deadLetter.id,
      attempt: finalAttempt,
      reason: outcome.deadLetter.reason,
      diagnostic: retryableDiagnostic,
      deadLetteredAt: t.completed,
      evidenceDeadlines,
      replayNotAfter: t.rawExpires,
      expiresAt: t.skeletonExpires
    } as const;

    expect(
      inboxV2ApplySourceProcessingOutcomeInputSchema.safeParse({
        leaseToken: "source-processing-lease-token-0001",
        outcome,
        deadLetterRecord
      }).success
    ).toBe(true);
    expect(
      inboxV2ApplySourceProcessingOutcomeInputSchema.safeParse({
        leaseToken: "source-processing-lease-token-0001",
        outcome,
        deadLetterRecord: null
      }).success
    ).toBe(false);
    expect(
      inboxV2ApplySourceProcessingOutcomeInputSchema.safeParse({
        leaseToken: "source-processing-lease-token-0001",
        outcome,
        deadLetterRecord: {
          ...deadLetterRecord,
          deadLetterId: "dead-letter:other"
        }
      }).success
    ).toBe(false);
  });

  it("keeps raw, allowed-header and normalized evidence deadlines separate", () => {
    expect(
      inboxV2SourceEvidenceDeadlinesSchema.safeParse(evidenceDeadlines).success
    ).toBe(true);
    expect(
      inboxV2SourceEvidenceDeadlinesSchema.safeParse({
        ...evidenceDeadlines,
        normalizedPayloadExpiresAt: null
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceEvidenceDeadlinesSchema.safeParse({
        ...evidenceDeadlines,
        allowedRawHeadersExpiresAt: t.captured
      }).success
    ).toBe(false);
  });

  it("bounds account-isolated backpressure and rate limits", () => {
    const policy = {
      maxClaimBatch: 20,
      maxInFlightPerTenant: 100,
      maxInFlightPerConnection: 50,
      maxInFlightPerAccount: 10,
      maxQueuedPerTenant: 10_000,
      maxQueuedPerConnection: 2_000,
      maxQueuedPerAccount: 500,
      maxAttempts: 5,
      baseRetryDelaySeconds: 2,
      maxRetryDelaySeconds: 120,
      jitterBasisPoints: 1_000
    } as const;

    expect(
      inboxV2SourceBackpressurePolicySchema.safeParse(policy).success
    ).toBe(true);
    expect(
      inboxV2SourceBackpressurePolicySchema.safeParse({
        ...policy,
        maxInFlightPerAccount: 51
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceBackpressurePolicySchema.safeParse({
        ...policy,
        maxRetryDelaySeconds: 1
      }).success
    ).toBe(false);
  });

  it("allows cursor acknowledgement only after durable raw work", () => {
    const acknowledgement = {
      target: {
        kind: "raw_work",
        scope: { ...normalizationScope, stage: "raw_ingest" },
        durableWorkId: "work-item:0001",
        durableWorkRevision: "1",
        durableWorkState: "pending",
        persistedAt: t.captured
      },
      cursorOwner: "source_connection",
      sourceThreadBindingId: null,
      cursor: { kind: "receive_cursor", value: "cursor-100" },
      acknowledgedAt: t.claimed
    } as const;

    expect(
      inboxV2SourceCursorDurableAcknowledgementSchema.safeParse(acknowledgement)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceCursorDurableAcknowledgementSchema.safeParse({
        ...acknowledgement,
        target: { ...acknowledgement.target, scope: normalizationScope }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceCursorDurableAcknowledgementSchema.safeParse({
        ...acknowledgement,
        target: { ...acknowledgement.target, persistedAt: t.completed },
        acknowledgedAt: t.claimed
      }).success
    ).toBe(false);

    expect(
      inboxV2SourceCursorPersistenceInputSchema.safeParse({
        acknowledgement,
        cursorSlotId: "receive-cursor:primary",
        routeGeneration: "1",
        expectedCheckpointRevision: null
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceCursorProtectionSchema.safeParse({
        tenantId: source.tenantId,
        keyGeneration: "source-key:2026-07",
        hmacKeySecretRef: `secret:${source.tenantId}/inbox-v2/source-hmac`,
        cursorValueSecretRef: `secret:${source.tenantId}/inbox-v2/cursor-primary`,
        cursorHmacSha256: `hmac-sha256:${"e".repeat(64)}`
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceCursorProtectionSchema.safeParse({
        tenantId: source.tenantId,
        keyGeneration: "source-key:2026-07",
        hmacKeySecretRef: `secret:${source.tenantId}/inbox-v2/source-hmac`,
        cursorValueSecretRef: `secret:tenant:other/inbox-v2/cursor-primary`,
        cursorHmacSha256: `hmac-sha256:${"e".repeat(64)}`
      }).success
    ).toBe(false);

    const quarantineAcknowledgement = {
      ...acknowledgement,
      target: {
        kind: "quarantine",
        source,
        quarantineId: "core:source-quarantine-0001",
        quarantineFingerprintSha256: `sha256:${"a".repeat(64)}`,
        reasonCode: "source.payload_malformed",
        persistedAt: t.captured
      }
    } as const;
    expect(
      inboxV2SourceCursorDurableAcknowledgementSchema.safeParse(
        quarantineAcknowledgement
      ).success
    ).toBe(true);
    expect(
      inboxV2SourceCursorDurableAcknowledgementSchema.safeParse({
        ...quarantineAcknowledgement,
        target: {
          ...quarantineAcknowledgement.target,
          durableWorkId: "work-item:forbidden"
        }
      }).success
    ).toBe(false);
  });

  it("fences key rotation and skeleton cleanup with finite revisions", () => {
    const rotation = {
      tenantId: source.tenantId,
      purposeId: "core:source_replay_and_diagnostics",
      generation: "source-key:2026-07",
      secretRef: `secret:${source.tenantId}/inbox-v2/source-key-2026-07`,
      activatedAt: t.captured,
      useUntil: t.rawExpires,
      guaranteeUntil: t.guarantee,
      verifyUntil: t.skeletonExpires,
      expectedActiveGeneration: null
    } as const;

    expect(
      inboxV2SourceDedupeKeyRotationInputSchema.safeParse(rotation).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeKeyRotationInputSchema.safeParse({
        ...rotation,
        verifyUntil: t.rawExpires
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingKeyRotationInputSchema.safeParse({
        ...rotation,
        purposeId: "core:source_ingress_cursor"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceProcessingKeyRotationInputSchema.safeParse({
        ...rotation,
        purposeId: "company:unbounded-key-purpose"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceProcessingKeyRetirementInputSchema.safeParse({
        tenantId: source.tenantId,
        purposeId: "core:source_ingress_cursor",
        generation: rotation.generation,
        expectedRevision: "2"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeSkeletonExpireInputSchema.safeParse({
        tenantId: source.tenantId,
        skeletonId: "dedupe-skeleton:0001",
        expectedRevision: "2"
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeSkeletonExpireInputSchema.safeParse({
        tenantId: source.tenantId,
        skeletonId: "dedupe-skeleton:0001"
      }).success
    ).toBe(false);
  });

  it("requires an exact, strict and tenant-safe replay request", () => {
    expect(
      inboxV2SourceReplayRequestSchema.safeParse(replayRequest).success
    ).toBe(true);
    expect(
      inboxV2SourceReplayRequestSchema.safeParse({
        ...replayRequest,
        requestHash: `sha256:${"b".repeat(64)}`
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceReplayRequestSchema.safeParse({
        ...replayRequest,
        force: true
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceReplayRequestSchema.safeParse({
        ...replayRequest,
        target: {
          kind: "normalized_event",
          scope: normalizationScope
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceReplayRequestSchema.safeParse({
        ...replayRequest,
        requestedBy: {
          kind: "employee",
          employee: {
            tenantId: "tenant:tenant-2",
            id: "employee:employee-1"
          }
        }
      }).success
    ).toBe(false);
  });

  it("returns a strict idempotent replay decision", () => {
    const result = {
      requestId: replayRequest.requestId,
      requestHash: replayRequest.requestHash,
      target: replayRequest.target,
      expectedTargetRevision: replayRequest.expectedTargetRevision,
      decidedAt: t.completed,
      outcome: "queued",
      replayEpisodeId: "replay-episode:0001",
      workId: "work-item:0002",
      workRevision: "3",
      queuedAt: t.completed,
      availableAt: t.retry,
      diagnostic: null
    } as const;

    expect(inboxV2SourceReplayResultSchema.safeParse(result).success).toBe(
      true
    );
    expect(
      inboxV2SourceReplayResultSchema.safeParse({
        ...result,
        queuedAt: t.started
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceReplayResultSchema.safeParse({
        requestId: replayRequest.requestId,
        requestHash: replayRequest.requestHash,
        target: replayRequest.target,
        expectedTargetRevision: replayRequest.expectedTargetRevision,
        decidedAt: t.completed,
        outcome: "rejected",
        reason: "evidence_unavailable",
        diagnostic: retryableDiagnostic
      }).success
    ).toBe(false);
  });

  it("retains only a finite generation-pinned HMAC dedupe skeleton", () => {
    const skeleton = {
      source,
      target: {
        phase: "raw",
        rawEventId: normalizationScope.rawEventId,
        normalizedEventId: null
      },
      purposeId: "core:source_replay_and_diagnostics",
      digestKeyGeneration: "source-key:2026-07",
      keyVerifyUntil: t.skeletonExpires,
      identityHmacSha256: `hmac-sha256:${"c".repeat(64)}`,
      outcomeHmacSha256: `hmac-sha256:${"d".repeat(64)}`,
      outcome: {
        kind: "dead_lettered",
        diagnosticCodeId: retryableDiagnostic.codeId
      },
      evidenceDeadlines,
      terminalAt: t.completed,
      guaranteeUntil: t.guarantee,
      skeletonExpiresAt: t.skeletonExpires,
      replayability: {
        state: "replayable",
        replayUntil: t.rawExpires
      },
      lifecycleState: "active",
      expiredAt: null
    } as const;

    expect(inboxV2SourceDedupeSkeletonSchema.safeParse(skeleton).success).toBe(
      true
    );
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        identityHmacSha256: `sha256:${"c".repeat(64)}`
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        keyVerifyUntil: t.rawExpires
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        externalEventId: "provider-message-1"
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        outcome: {
          kind: "processed",
          diagnosticCodeId: retryableDiagnostic.codeId
        }
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        target: {
          phase: "normalized",
          rawEventId: normalizationScope.rawEventId,
          normalizedEventId: materializationScope.normalizedEventId
        },
        evidenceDeadlines: {
          ...evidenceDeadlines,
          normalizedPayloadExpiresAt: null
        }
      }).success
    ).toBe(false);

    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        replayability: {
          state: "expired",
          reason: "evidence_expired",
          expiredAt: t.rawExpires
        }
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeSkeletonSchema.safeParse({
        ...skeleton,
        lifecycleState: "expired",
        expiredAt: t.skeletonExpires,
        replayability: {
          state: "expired",
          reason: "guarantee_expired",
          expiredAt: t.rawExpires
        }
      }).success
    ).toBe(false);
  });

  it("defines finite non-DLQ terminal lifecycle and a safe deterministic skeleton id", () => {
    const lifecycleInput = {
      scope: materializationScope,
      terminalOutcomeKind: "processed",
      terminalAt: t.completed,
      admissionGuaranteeUntil: t.guarantee
    } as const;
    const lifecycle = {
      evidenceDeadlines,
      skeletonExpiresAt: t.skeletonExpires,
      replayability: {
        state: "not_replayable",
        reason: "processed",
        decidedAt: t.completed
      }
    } as const;
    expect(
      inboxV2SourceTerminalDedupeLifecycleInputSchema.safeParse(lifecycleInput)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceTerminalDedupeLifecycleResolutionSchema.safeParse(lifecycle)
        .success
    ).toBe(true);
    expect(
      inboxV2SourceTerminalDedupeLifecycleInputSchema.safeParse({
        ...lifecycleInput,
        admissionGuaranteeUntil: t.completed
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceTerminalDedupeLifecycleResolutionSchema.safeParse({
        ...lifecycle,
        replayability: {
          state: "replayable",
          replayUntil: t.rawExpires
        }
      }).success
    ).toBe(false);

    const idInput = {
      source,
      target: {
        phase: "normalized",
        rawEventId: materializationScope.rawEventId,
        normalizedEventId: materializationScope.normalizedEventId
      },
      keyGeneration: "source-key:2026-07",
      identityHmacSha256: `hmac-sha256:${"c".repeat(64)}`
    } as const;
    const first = calculateInboxV2SourceTerminalDedupeSkeletonId(idInput);
    expect(first).toBe(calculateInboxV2SourceTerminalDedupeSkeletonId(idInput));
    expect(first).toMatch(/^source-skeleton:[0-9a-f]{64}$/u);
    expect(JSON.stringify(idInput)).not.toContain("provider-message");
    expect(
      calculateInboxV2SourceTerminalDedupeSkeletonId({
        ...idInput,
        identityHmacSha256: `hmac-sha256:${"e".repeat(64)}`
      })
    ).not.toBe(first);
  });

  it("derives only bounded, generation-scoped HMAC lookup candidates", () => {
    const lookup = {
      source,
      phase: "raw",
      purposeId: "core:source_replay_and_diagnostics",
      identityMaterial: "provider-message:clear-ephemeral-only"
    } as const;
    const candidates = [
      {
        generation: "source-key:2026-07",
        hmacKeySecretRef: `secret:${source.tenantId}/inbox-v2/source-key-2026-07`,
        identityHmacSha256: `hmac-sha256:${"c".repeat(64)}`
      },
      {
        generation: "source-key:2026-08",
        hmacKeySecretRef: `secret:${source.tenantId}/inbox-v2/source-key-2026-08`,
        identityHmacSha256: `hmac-sha256:${"e".repeat(64)}`
      }
    ] as const;

    expect(
      inboxV2SourceDedupeSkeletonLookupInputSchema.safeParse(lookup).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeIdentityCandidatesSchema.safeParse({
        outcome: "derived",
        source,
        phase: lookup.phase,
        purposeId: lookup.purposeId,
        candidates
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeIdentityCandidatesSchema.safeParse({
        outcome: "derived",
        source,
        phase: lookup.phase,
        purposeId: lookup.purposeId,
        candidates: [candidates[0], candidates[0]]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeIdentityCandidatesSchema.safeParse({
        outcome: "derived",
        source,
        phase: lookup.phase,
        purposeId: lookup.purposeId,
        candidates: [
          {
            ...candidates[0],
            hmacKeySecretRef: "secret:tenant:other/inbox-v2/source-key"
          }
        ]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeIdentityCandidatesSchema.safeParse({
        outcome: "derived",
        source,
        phase: lookup.phase,
        purposeId: lookup.purposeId,
        candidates: Array.from(
          { length: INBOX_V2_SOURCE_DEDUPE_MAX_LOOKUP_CANDIDATES + 1 },
          (_, index) => ({
            generation: `source-key:bounded-${index}`,
            hmacKeySecretRef: `secret:${source.tenantId}/inbox-v2/source-key-${index}`,
            identityHmacSha256: `hmac-sha256:${index.toString(16).padStart(64, "0")}`
          })
        )
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeIdentityCandidatesSchema.safeParse({
        outcome: "derived",
        source,
        phase: lookup.phase,
        purposeId: lookup.purposeId,
        candidates: [
          { ...candidates[0], identityMaterial: lookup.identityMaterial }
        ]
      }).success
    ).toBe(false);
  });

  it("returns a strict safe skeleton match across coherent key generations", () => {
    const skeleton = {
      source,
      target: {
        phase: "raw",
        rawEventId: normalizationScope.rawEventId,
        normalizedEventId: null
      },
      purposeId: "core:source_replay_and_diagnostics",
      digestKeyGeneration: "source-key:2026-07",
      keyVerifyUntil: t.skeletonExpires,
      identityHmacSha256: `hmac-sha256:${"c".repeat(64)}`,
      outcomeHmacSha256: `hmac-sha256:${"d".repeat(64)}`,
      outcome: {
        kind: "dead_lettered",
        diagnosticCodeId: retryableDiagnostic.codeId
      },
      evidenceDeadlines,
      terminalAt: t.completed,
      guaranteeUntil: t.guarantee,
      skeletonExpiresAt: t.skeletonExpires,
      replayability: {
        state: "replayable",
        replayUntil: t.rawExpires
      },
      lifecycleState: "active",
      expiredAt: null
    } as const;

    expect(
      inboxV2SourceDedupeSkeletonLookupResultSchema.safeParse({
        outcome: "found",
        skeletonId: "dedupe-skeleton:0001",
        routeGeneration: "1",
        skeleton,
        matchedKeyGenerations: [
          skeleton.digestKeyGeneration,
          "source-key:2026-08"
        ]
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeSkeletonLookupResultSchema.safeParse({
        outcome: "found",
        skeletonId: "dedupe-skeleton:0001",
        routeGeneration: "1",
        skeleton,
        matchedKeyGenerations: ["source-key:2026-08"]
      }).success
    ).toBe(false);
    expect(
      inboxV2SourceDedupeSkeletonLookupResultSchema.safeParse({
        outcome: "found",
        skeletonId: "dedupe-skeleton:0001",
        routeGeneration: "1",
        skeleton,
        matchedKeyGenerations: [skeleton.digestKeyGeneration],
        identityMaterial: "provider-message:must-not-leak"
      }).success
    ).toBe(false);
  });

  it("makes HMAC generation rotation and retirement windows finite", () => {
    const generation = {
      generation: "source-key:2026-07",
      state: "active",
      activatedAt: t.captured,
      useUntil: t.rawExpires,
      verifyUntil: t.skeletonExpires,
      retiredAt: null
    } as const;

    expect(
      inboxV2SourceDedupeKeyGenerationStateSchema.safeParse(generation).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeKeyGenerationStateSchema.safeParse({
        ...generation,
        state: "retired",
        retiredAt: t.skeletonExpires
      }).success
    ).toBe(true);
    expect(
      inboxV2SourceDedupeKeyGenerationStateSchema.safeParse({
        ...generation,
        state: "retired",
        retiredAt: t.guarantee
      }).success
    ).toBe(false);
  });

  it("is exported from the Inbox V2 public barrel", () => {
    expect(barrelOutcomeSchema).toBe(inboxV2SourceProcessingOutcomeSchema);
  });
});
