import {
  INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
  INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
  calculateInboxV2SourceTerminalDedupeSkeletonId,
  calculateInboxV2SourceProcessingLeaseTokenHash,
  calculateInboxV2SourceReplayRequestHash,
  inboxV2ApplySourceProcessingOutcomeInputSchema,
  inboxV2ClaimSourceProcessingRuntimeInputSchema,
  inboxV2RawAdmissionSealedSkeletonInputSchema,
  inboxV2SourceCursorLoadInputSchema,
  inboxV2SourceCursorDurableTargetLookupInputSchema,
  inboxV2SourceCursorPersistenceInputSchema,
  inboxV2SourceCursorProtectionSchema,
  inboxV2SourceDedupeHmacVerificationSchema,
  inboxV2SourceDedupeIdentityCandidatesSchema,
  inboxV2SourceDedupeReplayabilityExpireInputSchema,
  inboxV2SourceDedupeSkeletonExpireInputSchema,
  inboxV2SourceDedupeSkeletonLookupInputSchema,
  inboxV2SourceDedupeSkeletonWriteInputSchema,
  inboxV2SourceDeadLetterRecordSchema,
  inboxV2SourceProcessingKeyRetirementInputSchema,
  inboxV2SourceProcessingKeyRotationInputSchema,
  inboxV2SourceProcessingOutcomeSchema,
  inboxV2SourceReplayAuthorizationDecisionSchema,
  inboxV2SourceReplayRequestSchema,
  type InboxV2SourceProcessingCryptographicAuthorityPort,
  type InboxV2SourceReplayAuthorizationPort
} from "@hulee/contracts";
import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it, vi } from "vitest";

import {
  buildAcknowledgeInboxV2SourceCursorSql,
  buildApplyInboxV2SourceProcessingOutcomeSql,
  buildApplyInboxV2SourceReplaySql,
  buildClassifyInboxV2SourceBackpressureSql,
  buildClaimInboxV2SourceProcessingSql,
  buildExpireInboxV2SourceDedupeReplayabilitySql,
  buildFinalizeInboxV2SourceReplaySql,
  buildLeaseInboxV2SourceReplaySql,
  buildLoadInboxV2SourceCursorProtectionSql,
  buildLoadInboxV2TerminalDedupeAggregateSql,
  buildLockInboxV2SourceProcessingKeyRetirementSql,
  buildLookupInboxV2SourceDedupeSkeletonSql,
  buildPersistInboxV2ReplayAuthorizationDenialSql,
  buildPersistInboxV2TerminalDedupeSkeletonSql,
  buildReconcileInboxV2CompletedNormalizationsSql,
  buildReconcileInboxV2SourceProcessingSuccessorsSql,
  buildReconcileMissingInboxV2SourceProcessingBridgeSql,
  buildResetInboxV2SourceReplayWorkSql,
  buildRetireInboxV2SourceProcessingKeySql,
  buildRotateInboxV2SourceProcessingKeySql,
  buildTransitionInboxV2SourceProcessingKeyToVerifyOnlySql,
  buildWriteInboxV2SourceDedupeSkeletonSql,
  createSqlInboxV2SourceProcessingRuntimeRepository,
  type CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions,
  type InboxV2SourceProcessingTransactionExecutor
} from "./sql-inbox-v2-source-processing-runtime-repository";
import type {
  RawSqlExecutor,
  RawSqlQueryResult
} from "./sql-outbox-repository";

const tenantId = "tenant:src008-unit";
const sourceConnectionId = "source_connection:src008-unit";
const rawEventId = "raw_inbound_event:src008-unit";
const workId = "source-work:src008-unit";
const rawWorkId = "source-work:raw-src008-unit";
const attemptId = "source-attempt:src008-unit";
const workerId = "core:source-worker-src008";
const deadLetterId = "source-dlq:src008-unit";
const replayRequestId = "request:src008-unit";
const replayEpisodeId = "replay-episode:src008-unit";
const leaseToken = `source-processing-token-${"a".repeat(40)}`;
const leaseTokenHash =
  calculateInboxV2SourceProcessingLeaseTokenHash(leaseToken);
const otherLeaseHash = `sha256:${"f".repeat(64)}`;
const identityMaterial = "provider-identity-material-must-never-reach-sql";
const cursorValue = "provider-cursor-value-must-never-reach-sql";
const t = {
  captured: "2026-07-17T08:00:00.000Z",
  claimed: "2026-07-17T08:01:00.000Z",
  completed: "2026-07-17T08:02:00.000Z",
  leaseExpires: "2026-07-17T08:05:00.000Z",
  replayUntil: "2026-07-17T09:00:00.000Z",
  evidenceExpires: "2026-07-17T10:00:00.000Z",
  guarantee: "2026-07-17T11:00:00.000Z",
  skeletonExpires: "2026-07-17T12:00:00.000Z",
  keyVerify: "2026-07-17T13:00:00.000Z"
} as const;

const claimInput = inboxV2ClaimSourceProcessingRuntimeInputSchema.parse({
  tenantId,
  workerId,
  leaseDurationSeconds: 60,
  policy: {
    maxClaimBatch: 2,
    maxInFlightPerTenant: 20,
    maxInFlightPerConnection: 10,
    maxInFlightPerAccount: 4,
    maxQueuedPerTenant: 1_000,
    maxQueuedPerConnection: 500,
    maxQueuedPerAccount: 100,
    maxAttempts: 5,
    baseRetryDelaySeconds: 2,
    maxRetryDelaySeconds: 120,
    jitterBasisPoints: 100
  }
});

const attempt = {
  attemptId,
  workId,
  scope: {
    tenantId,
    sourceConnectionId,
    sourceAccountId: null,
    rawEventId,
    normalizedEventId: null,
    stage: "normalization"
  },
  origin: "initial",
  replayRequestId: null,
  attemptNumber: 1,
  maxAttempts: 5,
  workRevision: "2",
  workerId,
  leaseTokenHash,
  leaseRevision: "2",
  leaseClaimedAt: t.claimed,
  startedAt: t.claimed,
  leaseExpiresAt: t.leaseExpires
} as const;

const terminalDiagnostic = {
  codeId: "core:source-processing.terminal",
  retryable: false,
  correlationToken: attemptId,
  safeOperatorHintId: null
} as const;

const processedOutcome = inboxV2SourceProcessingOutcomeSchema.parse({
  kind: "processed",
  attempt,
  completedAt: t.completed,
  diagnostic: null
});
if (processedOutcome.kind !== "processed") {
  throw new Error("Expected a processed source outcome fixture.");
}

const connectionRateLimitedOutcome = inboxV2SourceProcessingOutcomeSchema.parse(
  {
    kind: "retry_scheduled",
    attempt,
    completedAt: t.completed,
    diagnostic: {
      codeId: "core:source-provider-rate-limited",
      retryable: true,
      correlationToken: attemptId,
      safeOperatorHintId: "core:wait-for-provider-rate-limit"
    },
    retry: {
      reason: "rate_limited",
      nextAttemptAt: t.replayUntil,
      rateLimitHint: {
        kind: "provider_retry_after",
        scope: "source_connection",
        observedAt: t.completed,
        retryAt: t.replayUntil
      }
    }
  }
);

const deadLetterOutcome = inboxV2SourceProcessingOutcomeSchema.parse({
  kind: "dead_lettered",
  attempt,
  completedAt: t.completed,
  diagnostic: terminalDiagnostic,
  deadLetter: {
    id: deadLetterId,
    reason: "terminal_failure",
    deadLetteredAt: t.completed
  }
});

const deadLetterRecord = inboxV2SourceDeadLetterRecordSchema.parse({
  deadLetterId,
  attempt,
  reason: "terminal_failure",
  diagnostic: terminalDiagnostic,
  deadLetteredAt: t.completed,
  evidenceDeadlines: {
    capturedAt: t.captured,
    rawPayloadExpiresAt: t.evidenceExpires,
    allowedRawHeadersExpiresAt: t.evidenceExpires,
    normalizedPayloadExpiresAt: null
  },
  replayNotAfter: t.replayUntil,
  expiresAt: t.guarantee
});

const replayTarget = {
  kind: "raw_event",
  scope: attempt.scope
} as const;

const replayRequestedBy = {
  kind: "trusted_service",
  trustedServiceId: "core:source-replay-service"
} as const;

const replayRequest = inboxV2SourceReplayRequestSchema.parse({
  requestId: replayRequestId,
  requestHash: calculateInboxV2SourceReplayRequestHash({
    target: replayTarget,
    expectedTargetRevision: "3",
    reasonId: "core:source-replay.operator-requested",
    requestedBy: replayRequestedBy,
    requestedAt: t.completed
  }),
  target: replayTarget,
  expectedTargetRevision: "3",
  reasonId: "core:source-replay.operator-requested",
  requestedBy: replayRequestedBy,
  requestedAt: t.completed
});

const deadLetterReplayTarget = {
  kind: "dead_letter",
  deadLetterId,
  scope: attempt.scope
} as const;

const deadLetterReplayRequest = inboxV2SourceReplayRequestSchema.parse({
  requestId: "request:src008-unit-dlq",
  requestHash: calculateInboxV2SourceReplayRequestHash({
    target: deadLetterReplayTarget,
    expectedTargetRevision: "3",
    reasonId: "core:source-replay.operator-requested",
    requestedBy: replayRequestedBy,
    requestedAt: t.completed
  }),
  target: deadLetterReplayTarget,
  expectedTargetRevision: "3",
  reasonId: "core:source-replay.operator-requested",
  requestedBy: replayRequestedBy,
  requestedAt: t.completed
});

const cursorPersistence = inboxV2SourceCursorPersistenceInputSchema.parse({
  acknowledgement: {
    target: {
      kind: "raw_work",
      scope: {
        ...attempt.scope,
        stage: "raw_ingest"
      },
      durableWorkId: rawWorkId,
      durableWorkRevision: "1",
      durableWorkState: "processed",
      persistedAt: t.completed
    },
    cursorOwner: "source_connection",
    sourceThreadBindingId: null,
    cursor: { kind: "receive_cursor", value: cursorValue },
    acknowledgedAt: t.leaseExpires
  },
  cursorSlotId: "receive-cursor:primary",
  routeGeneration: "1",
  expectedCheckpointRevision: null
});

const cursorProtection = inboxV2SourceCursorProtectionSchema.parse({
  tenantId,
  keyGeneration: "source-key:2026-07",
  hmacKeySecretRef: `secret:${tenantId}/source-processing-hmac`,
  cursorValueSecretRef: `secret:${tenantId}/cursor-primary`,
  cursorHmacSha256: `hmac-sha256:${"c".repeat(64)}`
});

const skeletonWrite = inboxV2SourceDedupeSkeletonWriteInputSchema.parse({
  skeletonId: "source-skeleton:src008-unit",
  routeGeneration: "1",
  skeleton: {
    source: {
      tenantId,
      sourceConnectionId,
      sourceAccountId: null
    },
    target: { phase: "raw", rawEventId, normalizedEventId: null },
    purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    digestKeyGeneration: "source-key:2026-07",
    keyVerifyUntil: t.keyVerify,
    identityHmacSha256: `hmac-sha256:${"d".repeat(64)}`,
    outcomeHmacSha256: `hmac-sha256:${"e".repeat(64)}`,
    outcome: {
      kind: "dead_lettered",
      diagnosticCodeId: terminalDiagnostic.codeId
    },
    evidenceDeadlines: deadLetterRecord.evidenceDeadlines,
    terminalAt: t.completed,
    guaranteeUntil: t.guarantee,
    skeletonExpiresAt: t.skeletonExpires,
    replayability: { state: "replayable", replayUntil: t.replayUntil },
    lifecycleState: "active",
    expiredAt: null
  },
  identityMaterial
});

const verifiedSkeleton = (() => {
  const verification = inboxV2SourceDedupeHmacVerificationSchema.parse({
    outcome: "verified",
    tenantId,
    hmacKeySecretRef: `secret:${tenantId}/source-processing-hmac`
  });
  if (verification.outcome !== "verified") {
    throw new Error("Expected a verified dedupe fixture.");
  }
  return verification;
})();

const skeletonLookup = inboxV2SourceDedupeSkeletonLookupInputSchema.parse({
  source: skeletonWrite.skeleton.source,
  phase: skeletonWrite.skeleton.target.phase,
  purposeId: skeletonWrite.skeleton.purposeId,
  identityMaterial
});

const derivedSkeletonCandidates = (() => {
  const derivation = inboxV2SourceDedupeIdentityCandidatesSchema.parse({
    outcome: "derived",
    source: skeletonLookup.source,
    phase: skeletonLookup.phase,
    purposeId: skeletonLookup.purposeId,
    candidates: [
      {
        generation: skeletonWrite.skeleton.digestKeyGeneration,
        hmacKeySecretRef: verifiedSkeleton.hmacKeySecretRef,
        identityHmacSha256: skeletonWrite.skeleton.identityHmacSha256
      },
      {
        generation: "source-key:2026-08",
        hmacKeySecretRef: `secret:${tenantId}/source-processing-hmac-2026-08`,
        identityHmacSha256: `hmac-sha256:${"f".repeat(64)}`
      }
    ]
  });
  if (derivation.outcome !== "derived") {
    throw new Error("Expected derived dedupe candidates fixture.");
  }
  return derivation;
})();

const replayAuthorizationDenial = (() => {
  const decision = inboxV2SourceReplayAuthorizationDecisionSchema.parse({
    outcome: "denied",
    decidedAt: t.completed,
    diagnostic: {
      codeId: "core:source-replay.denied",
      retryable: false,
      correlationToken: replayRequestId,
      safeOperatorHintId: null
    }
  });
  if (decision.outcome !== "denied") {
    throw new Error("Expected a denied replay-authorization fixture.");
  }
  return decision;
})();

describe("SQL Inbox V2 source-processing runtime repository", () => {
  it("claims fairly with DB time, SKIP LOCKED, pressure caps and domain-separated cross-fences", () => {
    const tokens = [
      {
        rawToken: leaseToken,
        tokenHash: leaseTokenHash,
        rawIngressTokenHash: `sha256:${"b".repeat(64)}`,
        attemptId
      },
      {
        rawToken: `${leaseToken}-two`,
        tokenHash: `sha256:${"1".repeat(64)}`,
        rawIngressTokenHash: `sha256:${"2".repeat(64)}`,
        attemptId: "source-attempt:src008-unit-two"
      }
    ] as const;

    const rendered = renderQuery(
      buildClaimInboxV2SourceProcessingSql(claimInput, tokens)
    );
    const normalized = normalizeSql(rendered.sql);

    expect(normalized).toContain(
      "date_trunc('milliseconds', clock_timestamp())"
    );
    expect(normalized).toContain("for update of work skip locked");
    expect(normalized).toContain("for update of raw_work skip locked");
    expect(normalized).toContain("candidate.connection_new_ordinal");
    expect(normalized).toContain("candidate.tenant_new_ordinal");
    expect(normalized).toContain('work.stage::text collate "c"');
    expect(normalized).not.toContain('work.stage collate "c"');
    expect(normalized).toContain("attempt_count = work.attempt_count + case");
    expect(normalized).toContain("attempt_count = raw_work.attempt_count + 1");
    expect(normalized).toContain(
      "not exists ( select 1 from public.inbox_v2_source_processing_attempts"
    );
    expect(JSON.stringify(rendered.params)).not.toContain(leaseToken);
    expect(JSON.stringify(rendered.params)).toContain(leaseTokenHash);
    expect(tokens[0].tokenHash).not.toBe(tokens[0].rawIngressTokenHash);
  });

  it("classifies queue and rate-limit pressure at the most specific durable scope", () => {
    const normalized = normalizeSql(
      renderQuery(buildClassifyInboxV2SourceBackpressureSql(claimInput)).sql
    );

    expect(normalized).toContain("connection_wide_rate_limit as materialized");
    expect(normalized).toContain("pressure.queued >=");
    expect(normalized).toContain("stats.queued >=");
    expect(normalized).toContain("tenant_stats as materialized");
    expect(normalized).toContain(
      "case scope when 'source_account' then 0 when 'source_connection' then 1 else 2 end"
    );
  });

  it("backfills only authority-backed legacy raw work before claim", () => {
    const normalized = normalizeSql(
      renderQuery(
        buildReconcileMissingInboxV2SourceProcessingBridgeSql({
          tenantId,
          batchSize: 25,
          policy: claimInput.policy
        })
      ).sql
    );

    expect(normalized).toContain("inbox_v2_src_runtime_route_generation");
    expect(normalized).toContain("for update of raw_work skip locked");
    expect(normalized).toContain("candidate.account_candidate_ordinal");
    expect(normalized).toContain("candidate.connection_candidate_ordinal");
    expect(normalized).toContain("candidate.tenant_candidate_ordinal");
    expect(normalized).toContain("max_in_flight = greatest");
    expect(normalized).toContain("connection_fence.source_account_id is null");
    expect(normalized).not.toContain("'open', 10000");
    expect(normalized).not.toContain("10000000");
    expect(normalized).toContain("'raw_ingest'");
    expect(normalized).toContain("'normalization'");
    expect(normalized).toContain(
      "'raw_ingest'::public.inbox_v2_source_processing_stage"
    );
    expect(normalized).toContain(
      "'normalization'::public.inbox_v2_source_processing_stage"
    );
    expect(normalized).toContain(
      "'processed'::public.inbox_v2_source_processing_work_state"
    );
    expect(normalized).toContain(
      "'pending'::public.inbox_v2_source_processing_work_state"
    );
    expect(normalized).toContain(
      "null::public.inbox_v2_source_processing_retryability"
    );
    expect(normalized).toContain("::integer, 0, null::text");
    expect(normalized).toContain("on conflict (tenant_id, work_id) do nothing");
  });

  it("reconciles every processed stage into one bounded idempotent successor chain", () => {
    const rendered = renderQuery(
      buildReconcileInboxV2SourceProcessingSuccessorsSql({
        tenantId,
        batchSize: 17,
        policy: claimInput.policy
      })
    );
    const normalized = normalizeSql(rendered.sql);

    expect(normalized).toContain(
      "join public.inbox_v2_source_normalization_results result"
    );
    expect(normalized).toContain(
      "join public.inbox_v2_source_normalized_envelopes envelope"
    );
    expect(normalized).toContain(
      "join public.inbox_v2_source_processing_attempts attempt"
    );
    expect(normalized).toContain("result.outcome = 'normalized'");
    expect(normalized).toContain(
      "attempt.attempt_number = result.completed_attempt_count"
    );
    expect(normalized).toContain(
      "attempt.lease_claimed_at = result.completed_lease_claimed_at"
    );
    expect(normalized).toContain(
      "attempt.finished_at = predecessor.completed_at"
    );
    expect(normalized).toContain(
      "predecessor.completed_at >= result.completed_at"
    );
    expect(normalized).toContain("predecessor.state = 'processed'");
    expect(normalized).toContain(
      "('identity_resolution', 'conversation_resolution')"
    );
    expect(normalized).toContain("('conversation_resolution', 'routing')");
    expect(normalized).toContain("('routing', 'message_reconciliation')");
    expect(normalized).toContain(
      "('message_reconciliation', 'materialization')"
    );
    expect(normalized).toContain("'identity_resolution'::text");
    expect(normalized).toContain("source-processing-work:v1|");
    expect(normalized).toContain("inbox_v2_src_runtime_route_generation");
    expect(normalized).toContain("candidate.account_candidate_ordinal");
    expect(normalized).toContain("candidate.connection_candidate_ordinal");
    expect(normalized).toContain("candidate.tenant_candidate_ordinal");
    expect(normalized).toContain("for update of predecessor skip locked");
    expect(normalized).toContain("on conflict do nothing");
    expect(normalized).toContain("from work_inserted inserted");
    expect(normalized).toContain(
      "queued = inbox_v2_source_account_pressure_heads.queued + excluded.queued"
    );
    expect(normalized).not.toContain("result.outcome = 'ignored'");
    expect(rendered.params).toContain(17);
    expect(rendered.params).toContain(claimInput.policy.maxQueuedPerTenant);
    expect(rendered.params).toContain(claimInput.policy.maxQueuedPerConnection);
    expect(rendered.params).toContain(claimInput.policy.maxQueuedPerAccount);
  });

  it("resolves quarantine lifecycle only after the prepare transaction releases its row locks", async () => {
    const executor = new ScriptedTransactionExecutor([
      [
        {
          ...leasedWorkRow(),
          normalization_outcome: "quarantined",
          quarantine_id: deadLetterId,
          completed_at: t.completed,
          replay_request_id: null,
          recovery_attempt_id: "source-recovery:src008-unit"
        }
      ],
      [],
      [],
      [],
      [],
      [],
      [],
      []
    ]);
    const resolver = vi.fn(async () => {
      expect(executor.activeTransactionCount).toBe(0);
      expect(executor.renderedQueries).toHaveLength(1);
      return {
        evidenceDeadlines: deadLetterRecord.evidenceDeadlines,
        replayNotAfter: deadLetterRecord.replayNotAfter,
        expiresAt: deadLetterRecord.expiresAt
      };
    });
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      { ...options(), deadLetterLifecycleResolver: resolver }
    );

    await expect(repository.claim(claimInput)).resolves.toEqual({
      outcome: "empty"
    });
    expect(resolver).toHaveBeenCalledOnce();
    expect(normalizeSql(executor.renderedQueries[0]!.sql)).toContain(
      "for update of work skip locked"
    );
    expect(normalizeSql(executor.renderedQueries[2]!.sql)).toContain(
      "work.revision + 1 = resolved.work_revision"
    );
    expect(normalizeSql(executor.renderedQueries[3]!.sql)).toContain(
      "join public.inbox_v2_source_normalization_results result"
    );
    expect(normalizeSql(executor.renderedQueries[4]!.sql)).toContain(
      "predecessor_candidates as materialized"
    );
    expect(normalizeSql(executor.renderedQueries[5]!.sql)).toContain(
      "from public.inbox_v2_source_raw_work_items raw_work"
    );
    executor.expectExhausted();
  });

  it("classifies and locks one raw aggregate across every normalized fan-out leaf", () => {
    const unlocked = normalizeSql(
      renderQuery(
        buildLoadInboxV2TerminalDedupeAggregateSql({
          outcome: processedOutcome,
          lock: false
        })
      ).sql
    );
    const locked = normalizeSql(
      renderQuery(
        buildLoadInboxV2TerminalDedupeAggregateSql({
          outcome: processedOutcome,
          lock: true
        })
      ).sql
    );

    expect(unlocked).toContain("aggregate_work as materialized");
    expect(unlocked).toContain("successor.stage = 'identity_resolution'");
    expect(unlocked).toContain("successor.stage = 'materialization'");
    expect(unlocked).toContain("summary.has_dead_letter");
    expect(unlocked).toContain("summary.has_materialized then 'processed'");
    expect(unlocked).toContain("summary.all_leaves_duplicate then 'duplicate'");
    expect(unlocked).toContain("jsonb_agg(jsonb_build_object");
    expect(unlocked).not.toContain("for update of work");
    expect(locked).toContain("for update of work");
  });

  it("persists a raw aggregate skeleton from DB key and current route only", () => {
    const preparation = {
      kind: "prepared",
      admission: {
        source: { tenantId, sourceConnectionId, sourceAccountId: null },
        rawEventId,
        identityKind: "provider_event_id",
        purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
        keyGeneration: "dedupe-v1",
        hmacKeySecretRef: `secret:${tenantId}/source-processing`,
        identityHmacSha256: `hmac-sha256:${"1".repeat(64)}`,
        safeEnvelopeDigest: `hmac-sha256:${"2".repeat(64)}`,
        guaranteeUntil: t.guarantee,
        admissionRevision: "1"
      },
      aggregate: {
        fingerprint: `sha256:${"3".repeat(64)}`,
        state: "terminal",
        terminalOutcome: { kind: "processed", diagnosticCodeId: null },
        terminalAt: t.completed,
        leafCount: 2
      },
      seal: {
        outcome: "sealed",
        source: { tenantId, sourceConnectionId, sourceAccountId: null },
        rawEventId,
        purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
        admissionRevision: "1",
        keyGeneration: "dedupe-v1",
        hmacKeySecretRef: `secret:${tenantId}/source-processing`,
        identityHmacSha256: `hmac-sha256:${"1".repeat(64)}`,
        material: {
          target: { phase: "raw", rawEventId, normalizedEventId: null },
          terminalOutcome: { kind: "processed", diagnosticCodeId: null },
          terminalAt: t.completed
        },
        outcomeHmacSha256: `hmac-sha256:${"4".repeat(64)}`
      },
      lifecycle: {
        evidenceDeadlines: {
          capturedAt: t.captured,
          rawPayloadExpiresAt: t.evidenceExpires,
          allowedRawHeadersExpiresAt: t.evidenceExpires,
          normalizedPayloadExpiresAt: null
        },
        skeletonExpiresAt: t.skeletonExpires,
        replayability: {
          state: "not_replayable",
          reason: "processed",
          decidedAt: t.completed
        }
      },
      skeletonId: `source-skeleton:${"5".repeat(64)}`
    } as unknown as Parameters<
      typeof buildPersistInboxV2TerminalDedupeSkeletonSql
    >[0];
    const normalized = normalizeSql(
      renderQuery(buildPersistInboxV2TerminalDedupeSkeletonSql(preparation)).sql
    );

    expect(normalized).toContain("admission.state = 'skeleton_handed_off'");
    expect(normalized).toContain(
      "admission.hmac_key_secret_ref = key.secret_ref"
    );
    expect(normalized).toContain("key.verify_until");
    expect(normalized).toContain("inbox_v2_src_runtime_route_generation");
    expect(normalized).toContain("'raw', admission.raw_event_id, null");
    expect(normalized).toContain("on conflict do nothing");
  });

  it("seals outside the transaction and lets a dominant DLQ precede a sibling without rewriting its skeleton", async () => {
    const admission = terminalAdmissionSnapshot();
    const target = {
      phase: "raw",
      rawEventId,
      normalizedEventId: null
    } as const;
    const skeletonId = calculateInboxV2SourceTerminalDedupeSkeletonId({
      source: admission.source,
      target,
      keyGeneration: admission.keyGeneration,
      identityHmacSha256: admission.identityHmacSha256
    });
    const aggregateRow = terminalAggregateRow();
    const firstExecutor = new ScriptedTransactionExecutor([
      [aggregateRow],
      [terminalAdmissionRow()],
      [aggregateRow],
      [leasedWorkRow()],
      [{ tenant_id: tenantId, work_id: workId }],
      [terminalAdmissionRow()],
      [
        terminalAdmissionRow({
          state: "skeleton_handed_off",
          terminal_skeleton_id: skeletonId,
          terminal_outcome_hmac_sha256: `hmac-sha256:${"4".repeat(64)}`,
          skeleton_handed_off_at: t.completed,
          revision: "2",
          admission_revision: "2"
        })
      ],
      [{ outcome: "written" }]
    ]);
    const sealer = vi.fn(async (input) => {
      expect(firstExecutor.activeTransactionCount).toBe(0);
      return {
        outcome: "sealed" as const,
        source: input.admission.source,
        rawEventId: input.admission.rawEventId,
        purposeId: input.admission.purposeId,
        admissionRevision: input.admission.admissionRevision,
        keyGeneration: input.admission.keyGeneration,
        hmacKeySecretRef: input.admission.hmacKeySecretRef,
        identityHmacSha256: input.admission.identityHmacSha256,
        material: input.material,
        outcomeHmacSha256: `hmac-sha256:${"4".repeat(64)}`
      };
    });
    const firstRepository = createSqlInboxV2SourceProcessingRuntimeRepository(
      firstExecutor,
      {
        ...options(),
        terminalDedupe: {
          mode: "required",
          rawAdmissionPreflight: {
            loadPendingDedupeAdmission: async () => ({
              outcome: "pending",
              snapshot: admission
            })
          },
          terminalOutcomeSealer: { sealTerminalDedupeOutcome: sealer },
          terminalLifecycleResolver: {
            resolveTerminalDedupeLifecycle: vi.fn()
          }
        }
      }
    );

    await expect(
      firstRepository.applyOutcome({
        leaseToken,
        outcome: deadLetterOutcome,
        deadLetterRecord
      })
    ).resolves.toEqual({ outcome: "applied" });
    expect(sealer).toHaveBeenCalledOnce();
    expect(firstExecutor.renderedQueries).toHaveLength(8);
    expect(normalizeSql(firstExecutor.renderedQueries[1]!.sql)).toContain(
      "for update of admission"
    );
    expect(normalizeSql(firstExecutor.renderedQueries[2]!.sql)).toContain(
      "for update of work"
    );
    firstExecutor.expectExhausted();

    const normalizedEventId = "normalized_inbound_event:src008-sibling";
    const siblingAttempt = {
      ...attempt,
      attemptId: "source-attempt:src008-sibling",
      workId: "source-work:src008-sibling",
      scope: {
        ...attempt.scope,
        normalizedEventId,
        stage: "materialization" as const
      }
    };
    const siblingOutcome = inboxV2SourceProcessingOutcomeSchema.parse({
      kind: "processed",
      attempt: siblingAttempt,
      completedAt: "2026-07-17T08:03:00.000Z",
      diagnostic: null
    });
    const handedAdmission = terminalAdmissionRow({
      state: "skeleton_handed_off",
      terminal_skeleton_id: skeletonId,
      terminal_outcome_hmac_sha256: `hmac-sha256:${"4".repeat(64)}`,
      skeleton_handed_off_at: t.completed,
      revision: "2",
      admission_revision: "2"
    });
    const siblingExecutor = new ScriptedTransactionExecutor([
      [aggregateRow],
      [
        {
          ...leasedWorkRow(),
          work_id: siblingAttempt.workId,
          normalized_event_id: normalizedEventId,
          stage: "materialization",
          db_now: siblingOutcome.completedAt
        }
      ],
      [handedAdmission],
      [aggregateRow],
      [
        {
          tenant_id: tenantId,
          source_connection_id: sourceConnectionId,
          source_account_id: null,
          raw_event_id: rawEventId,
          key_generation: admission.keyGeneration,
          identity_hmac_sha256: admission.identityHmacSha256,
          skeleton_id: skeletonId,
          outcome: "dead_lettered",
          diagnostic_code_id: terminalDiagnostic.codeId,
          terminal_at: t.completed
        }
      ],
      [{ tenant_id: tenantId, work_id: siblingAttempt.workId }]
    ]);
    const siblingRepository = createSqlInboxV2SourceProcessingRuntimeRepository(
      siblingExecutor,
      {
        ...options(),
        terminalDedupe: {
          mode: "required",
          rawAdmissionPreflight: {
            loadPendingDedupeAdmission: async () => ({ outcome: "not_pending" })
          },
          terminalOutcomeSealer: {
            sealTerminalDedupeOutcome: vi.fn()
          },
          terminalLifecycleResolver: {
            resolveTerminalDedupeLifecycle: vi.fn()
          }
        }
      }
    );

    await expect(
      siblingRepository.applyOutcome({
        leaseToken,
        outcome: siblingOutcome,
        deadLetterRecord: null
      })
    ).resolves.toEqual({ outcome: "applied" });
    expect(siblingExecutor.renderedQueries).toHaveLength(6);
    expect(
      siblingExecutor.renderedQueries.some((query) =>
        normalizeSql(query.sql).includes(
          "insert into public.inbox_v2_source_delivery_dedupe_skeletons"
        )
      )
    ).toBe(false);
    siblingExecutor.expectExhausted();
  });

  it.each([
    ["stale scope", { raw_event_id: "raw_inbound_event:other" }, "not_found"],
    ["stale token", { lease_token_hash: otherLeaseHash }, "stale_token"],
    ["expired lease", { db_now: "2026-07-17T08:06:00.000Z" }, "lease_expired"]
  ] as const)(
    "rejects %s without writing an attempt",
    async (_name, overrides, expected) => {
      const executor = new ScriptedTransactionExecutor([
        [{ ...leasedWorkRow(), ...overrides }]
      ]);
      const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
        executor,
        options()
      );

      const result = await repository.applyOutcome({
        leaseToken,
        outcome: processedOutcome,
        deadLetterRecord: null
      });

      expect(result).toEqual({ outcome: expected });
      expect(executor.renderedQueries).toHaveLength(1);
      expect(JSON.stringify(executor.renderedQueries[0]!.params)).not.toContain(
        "source-processing-admission"
      );
      executor.expectExhausted();
    }
  );

  it("writes attempt, DLQ, terminal work and pressure in one fenced statement", () => {
    const parsed = inboxV2ApplySourceProcessingOutcomeInputSchema.parse({
      leaseToken,
      outcome: deadLetterOutcome,
      deadLetterRecord
    });
    const rendered = normalizeSql(
      renderQuery(
        buildApplyInboxV2SourceProcessingOutcomeSql({
          outcome: parsed.outcome,
          tokenHash: leaseTokenHash,
          dbNow: t.completed,
          processingGeneration: "1",
          retentionPolicy: {
            attemptRetentionSeconds: 86_400,
            replayRequestRetentionSeconds: 86_400
          },
          deadLetterRecord: parsed.deadLetterRecord
        })
      ).sql
    );

    expect(rendered).toContain("attempt_inserted as materialized");
    expect(rendered).toContain("dlq_inserted as materialized");
    expect(rendered).toContain("work_updated as materialized");
    expect(rendered).toContain("current_pressure_updated as materialized");
    expect(rendered).toContain("sibling_pressure_updated as materialized");
    expect(rendered).toContain("source_connection");
    expect(rendered).toContain("work.lease_token_hash =");
    expect(rendered).toContain("work.lease_expires_at >");
    expect(rendered.match(/::bigint \+ 1/g)).toHaveLength(2);
    expect(rendered).toContain("and work.revision = ");
    expect(rendered).toContain("then pressure.last_diagnostic_code_id");
  });

  it("fences connection siblings without changing their queue or in-flight counters", () => {
    const rendered = normalizeSql(
      renderQuery(
        buildApplyInboxV2SourceProcessingOutcomeSql({
          outcome: connectionRateLimitedOutcome,
          tokenHash: leaseTokenHash,
          dbNow: t.completed,
          processingGeneration: "1",
          retentionPolicy: {
            attemptRetentionSeconds: 86_400,
            replayRequestRetentionSeconds: 86_400
          },
          deadLetterRecord: null
        })
      ).sql
    );
    const siblingUpdate = rendered.slice(
      rendered.indexOf("sibling_pressure_updated as materialized"),
      rendered.indexOf(") select work.tenant_id")
    );

    expect(siblingUpdate).toContain("set state = 'rate_limited'");
    expect(siblingUpdate).toContain("source_account_scope_key <>");
    expect(rendered).toContain("= 'source_connection'");
    expect(rendered).toContain(
      "connection_fence_head_inserted as materialized"
    );
    expect(siblingUpdate).not.toContain("in_flight =");
    expect(siblingUpdate).not.toContain("queued =");
  });

  it("records normalization recovery against the resulting work revision", () => {
    const rendered = normalizeSql(
      renderQuery(
        buildReconcileInboxV2CompletedNormalizationsSql({
          tenantId,
          batchSize: 10,
          attemptRetentionSeconds: 86_400
        })
      ).sql
    );

    expect(rendered).toContain(
      "completed.max_attempts, completed.previous_revision + 1"
    );
    expect(rendered).toContain("revision = completed.previous_revision + 1");
  });

  it("persists authorization denial after the mandatory authorizer", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [],
      [{ id: replayRequestId }]
    ]);
    const authorizeReplay = vi.fn(async () => {
      expect(executor.renderedQueries).toHaveLength(1);
      expect(JSON.stringify(executor.renderedQueries[0]!.params)).toContain(
        "source-processing-admission"
      );
      return replayAuthorizationDenial;
    });
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options({ authorizeReplay })
    );

    const result = await repository.requestReplay(replayRequest);

    expect(authorizeReplay).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "scope_mismatch"
    });
    expect(normalizeSql(executor.renderedQueries[2]!.sql)).toContain(
      "'denied'"
    );
    executor.expectExhausted();
  });

  it("does not disclose a prior applied replay after current authorization denial", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [{ id: replayRequestId, state_text: "applied" }]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options({ authorizeReplay: async () => replayAuthorizationDenial })
    );

    const result = await repository.requestReplay(replayRequest);

    expect(result).toMatchObject({
      outcome: "rejected",
      reason: "scope_mismatch",
      diagnostic: replayAuthorizationDenial.diagnostic
    });
    expect(result.outcome).not.toBe("idempotent_replay");
    expect(executor.renderedQueries).toHaveLength(2);
    executor.expectExhausted();
  });

  it("replay SQL exact-fences terminal scope, revision, evidence, key and expiry", () => {
    const rendered = normalizeSql(
      renderQuery(
        buildApplyInboxV2SourceReplaySql({
          request: replayRequest,
          replayEpisodeId,
          retentionPolicy: {
            attemptRetentionSeconds: 86_400,
            replayRequestRetentionSeconds: 86_400
          }
        })
      ).sql
    );

    expect(rendered).toContain(
      "select state_text from target_work) <> 'dead_lettered'"
    );
    expect(rendered).toContain("expected_target_revision");
    expect(rendered).toContain("target_work_id");
    expect(rendered).toContain("normalized_event_scope_key");
    expect(rendered).toContain("source_account_scope_key");
    expect(rendered).toContain("select replayability_state from skeleton");
    expect(rendered).toContain("normalized_evidence");
    expect(rendered).toContain("generation_verify_until");
    expect(rendered).toContain("'replay_expired'");
    expect(rendered).toContain("replay_not_after, expires_at");
    expect(rendered).toContain("select expires_at from dlq");
    expect(rendered).toContain("make_interval");
    expect(rendered).toContain("request_inserted as materialized");
    expect(rendered).toContain(
      "then 'pending'::public.inbox_v2_source_replay_state"
    );
    expect(rendered).not.toContain("work_requeued as materialized");
  });

  it("uses raw evidence for a normalization-stage DLQ replay", () => {
    const rendered = renderQuery(
      buildApplyInboxV2SourceReplaySql({
        request: deadLetterReplayRequest,
        replayEpisodeId,
        retentionPolicy: {
          attemptRetentionSeconds: 86_400,
          replayRequestRetentionSeconds: 86_400
        }
      })
    );
    const normalized = normalizeSql(rendered.sql);
    const rawBranch = normalized.match(
      /when \((\$\d+) and \(\s*\(select raw_payload_expires_at/
    );

    expect(rawBranch).not.toBeNull();
    const rawBranchParameter = Number(rawBranch![1]!.slice(1)) - 1;
    expect(rendered.params[rawBranchParameter]).toBe(true);
    expect(rendered.params).toContain("raw");
  });

  it("renders the exact pending-to-leased-to-applied replay state machine", () => {
    const tokenHash = `sha256:${"9".repeat(64)}`;
    const leased = normalizeSql(
      renderQuery(
        buildLeaseInboxV2SourceReplaySql({ request: replayRequest, tokenHash })
      ).sql
    );
    const reset = normalizeSql(
      renderQuery(
        buildResetInboxV2SourceReplayWorkSql({
          request: replayRequest,
          tokenHash
        })
      ).sql
    );
    const finalized = normalizeSql(
      renderQuery(
        buildFinalizeInboxV2SourceReplaySql({
          request: replayRequest,
          replayEpisodeId,
          tokenHash
        })
      ).sql
    );

    expect(leased).toContain("set state = 'leased'");
    expect(leased).toContain("replay.state = 'pending'");
    expect(reset).toContain("replay.state = 'leased'");
    expect(reset).toContain("work.state = 'dead_lettered'");
    expect(reset).toContain("pressure_updated as materialized");
    expect(finalized).toContain("set state = 'applied'");
    expect(finalized).toContain("available_at = db_clock.db_now");
    expect(finalized).toContain("replay.state = 'leased'");
    for (const replaySql of [leased, reset, finalized]) {
      expect(replaySql).toContain(
        "date_trunc('milliseconds', clock_timestamp()) as db_now"
      );
    }
  });

  it("applies replay through pending, leased, work reset and applied in one transaction", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [],
      [{ outcome: "pending", db_now: t.completed }],
      [{ id: replayRequestId, revision: "2" }],
      [
        {
          tenant_id: tenantId,
          work_id: workId,
          processing_generation: "2",
          result_work_revision: "4",
          available_at: t.completed,
          db_now: t.completed
        }
      ],
      [
        {
          outcome: "queued",
          id: replayRequestId,
          request_hash: replayRequest.requestHash,
          result_replay_episode_id: replayEpisodeId,
          result_work_id: workId,
          result_work_revision: "4",
          completed_at: t.completed,
          available_at: t.completed,
          rejection_reason: null,
          db_now: t.completed
        }
      ]
    ]);
    const authorizeReplay = vi.fn(async () => {
      expect(executor.renderedQueries).toHaveLength(1);
      return { outcome: "authorized" as const };
    });
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options({ authorizeReplay })
    );

    await expect(
      repository.requestReplay(replayRequest)
    ).resolves.toMatchObject({
      outcome: "queued",
      replayEpisodeId,
      workId,
      workRevision: "4"
    });

    expect(authorizeReplay).toHaveBeenCalledOnce();
    expect(executor.transactionConfigs).toHaveLength(1);
    expect(executor.renderedQueries).toHaveLength(6);
    expect(normalizeSql(executor.renderedQueries[2]!.sql)).toContain(
      "request_inserted as materialized"
    );
    expect(normalizeSql(executor.renderedQueries[3]!.sql)).toContain(
      "set state = 'leased'"
    );
    expect(normalizeSql(executor.renderedQueries[4]!.sql)).toContain(
      "work_requeued as materialized"
    );
    expect(normalizeSql(executor.renderedQueries[5]!.sql)).toContain(
      "set state = 'applied'"
    );
    executor.expectExhausted();
  });

  it("rejects before cursor protection when durable raw work does not match", async () => {
    const protectCursor = vi.fn(async () => cursorProtection);
    const executor = new ScriptedTransactionExecutor([
      [],
      [{ outcome: "durable_work_mismatch", revision: null }]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options(undefined, { protectCursor })
    );

    const result = await repository.acknowledgeCursor(cursorPersistence);

    expect(result).toEqual({ outcome: "durable_work_mismatch" });
    expect(protectCursor).not.toHaveBeenCalled();
    const parameters = JSON.stringify(
      executor.renderedQueries.flatMap((query) => query.params)
    );
    expect(parameters).not.toContain(cursorValue);
  });

  it("protects and commits a cursor only after durable raw validation", async () => {
    const protectCursor = vi.fn(async () => cursorProtection);
    const executor = new ScriptedTransactionExecutor([
      [],
      [{ outcome: "ready" }],
      [],
      [{ outcome: "acknowledged", revision: "1" }]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options(undefined, { protectCursor })
    );

    const result = await repository.acknowledgeCursor(cursorPersistence);

    expect(result).toEqual({ outcome: "acknowledged", revision: "1" });
    expect(protectCursor).toHaveBeenCalledWith(cursorPersistence);
    const parameters = JSON.stringify(
      executor.renderedQueries.flatMap((query) => query.params)
    );
    expect(parameters).not.toContain(cursorValue);
    expect(parameters).toContain(cursorProtection.cursorValueSecretRef);
    expect(parameters).toContain(cursorProtection.cursorHmacSha256);
    executor.expectExhausted();
  });

  it("resolves an immutable quarantine receipt without inventing raw work", async () => {
    const lookup = inboxV2SourceCursorDurableTargetLookupInputSchema.parse({
      source: {
        tenantId,
        sourceConnectionId,
        sourceAccountId: null
      },
      receipt: {
        kind: "quarantine",
        quarantineId: "core:source-quarantine-unit",
        safeEnvelopeDigest: `sha256:${"a".repeat(64)}`,
        reasonCode: "source.payload_malformed"
      }
    });
    if (lookup.receipt.kind !== "quarantine") {
      throw new Error("quarantine lookup fixture invariant");
    }
    const executor = new ScriptedTransactionExecutor([
      [],
      [
        {
          outcome: "resolved",
          quarantine_fingerprint_sha256: `sha256:${"b".repeat(64)}`,
          persisted_at: t.captured,
          resolved_at: t.claimed
        }
      ]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options()
    );

    await expect(
      repository.resolveCursorDurableTarget(lookup)
    ).resolves.toEqual({
      outcome: "resolved",
      target: {
        kind: "quarantine",
        source: lookup.source,
        quarantineId: lookup.receipt.quarantineId,
        quarantineFingerprintSha256: `sha256:${"b".repeat(64)}`,
        reasonCode: lookup.receipt.reasonCode,
        persistedAt: t.captured
      },
      resolvedAt: t.claimed
    });
    const normalized = normalizeSql(executor.renderedQueries[1]!.sql);
    expect(normalized).toContain(
      "from public.inbox_v2_source_raw_quarantines quarantine"
    );
    expect(normalized).toContain("quarantine_fingerprint_sha256");
    expect(normalized).not.toContain("durable_work_id");
    executor.expectExhausted();
  });

  it("renders quarantine cursor acknowledgement with an exact XOR target", () => {
    const quarantinePersistence =
      inboxV2SourceCursorPersistenceInputSchema.parse({
        ...cursorPersistence,
        acknowledgement: {
          ...cursorPersistence.acknowledgement,
          target: {
            kind: "quarantine",
            source: {
              tenantId,
              sourceConnectionId,
              sourceAccountId: null
            },
            quarantineId: "core:source-quarantine-unit",
            quarantineFingerprintSha256: `sha256:${"b".repeat(64)}`,
            reasonCode: "source.payload_malformed",
            persistedAt: t.completed
          }
        }
      });
    const rendered = renderQuery(
      buildAcknowledgeInboxV2SourceCursorSql({
        persistence: quarantinePersistence,
        protection: cursorProtection
      })
    );
    const normalized = normalizeSql(rendered.sql);

    expect(normalized).toContain("'quarantine'::text as durable_target_kind");
    expect(normalized).toContain("quarantine_fingerprint_sha256");
    expect(rendered.params).toContain("durable_quarantine_not_found");
    expect(rendered.params).toContain("durable_quarantine_mismatch");
  });

  it("loads only protected cursor metadata before resolving the clear value", () => {
    const loadInput = inboxV2SourceCursorLoadInputSchema.parse({
      source: skeletonWrite.skeleton.source,
      cursorOwner: "source_connection",
      sourceThreadBindingId: null,
      cursorSlotId: "receive-cursor:primary"
    });
    const normalized = normalizeSql(
      renderQuery(buildLoadInboxV2SourceCursorProtectionSql(loadInput)).sql
    );

    expect(normalized).toContain("key.state in ('active', 'verify_only')");
    expect(normalized).toContain("key.verify_until > db_clock.db_now");
    expect(normalized).not.toContain("cursor.value");
  });

  it("requires verified dedupe HMAC and never sends identity material to SQL", () => {
    const rendered = renderQuery(
      buildWriteInboxV2SourceDedupeSkeletonSql({
        persistence: skeletonWrite,
        verification: verifiedSkeleton
      })
    );
    const parameters = JSON.stringify(rendered.params);

    expect(parameters).not.toContain(identityMaterial);
    expect(parameters).toContain(verifiedSkeleton.hmacKeySecretRef);
    expect(normalizeSql(rendered.sql)).toContain(
      "key.verify_until > db_clock.db_now"
    );
  });

  it("looks up dedupe skeletons with bounded tenant-key candidates only", () => {
    const rendered = renderQuery(
      buildLookupInboxV2SourceDedupeSkeletonSql({
        source: skeletonLookup.source,
        phase: skeletonLookup.phase,
        purposeId: skeletonLookup.purposeId,
        candidates: derivedSkeletonCandidates.candidates
      })
    );
    const normalized = normalizeSql(rendered.sql);
    const parameters = JSON.stringify(rendered.params);

    expect(parameters).not.toContain(identityMaterial);
    for (const candidate of derivedSkeletonCandidates.candidates) {
      expect(parameters).toContain(candidate.hmacKeySecretRef);
      expect(parameters).toContain(candidate.identityHmacSha256);
    }
    expect(normalized).toContain(
      "key.secret_ref = candidate.hmac_key_secret_ref"
    );
    expect(normalized).toContain("key.state in ('active', 'verify_only')");
    expect(normalized).toContain("key.verify_until > db_clock.db_now");
    expect(normalized).toContain(
      "skeleton.source_account_id is not distinct from"
    );
    expect(normalized).toContain("skeleton.guarantee_until > db_clock.db_now");
  });

  it("returns one coherent duplicate across active and verification-only generations", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [
        dedupeLookupRow(
          derivedSkeletonCandidates.candidates[0]!.generation,
          derivedSkeletonCandidates.candidates[0]!.identityHmacSha256
        ),
        dedupeLookupRow(
          derivedSkeletonCandidates.candidates[1]!.generation,
          derivedSkeletonCandidates.candidates[1]!.identityHmacSha256
        )
      ]
    ]);
    const deriveDedupeIdentityCandidates = vi.fn(
      async () => derivedSkeletonCandidates
    );
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options(undefined, { deriveDedupeIdentityCandidates })
    );

    await expect(
      repository.lookupDedupeSkeleton(skeletonLookup)
    ).resolves.toMatchObject({
      outcome: "found",
      skeletonId: skeletonWrite.skeletonId,
      routeGeneration: skeletonWrite.routeGeneration,
      matchedKeyGenerations: derivedSkeletonCandidates.candidates.map(
        (candidate) => candidate.generation
      )
    });
    expect(deriveDedupeIdentityCandidates).toHaveBeenCalledWith(skeletonLookup);
    expect(
      JSON.stringify(executor.renderedQueries.flatMap((query) => query.params))
    ).not.toContain(identityMaterial);
    executor.expectExhausted();
  });

  it("fails closed when key-rotation matches disagree on safe outcome", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [
        dedupeLookupRow(
          derivedSkeletonCandidates.candidates[0]!.generation,
          derivedSkeletonCandidates.candidates[0]!.identityHmacSha256
        ),
        dedupeLookupRow(
          derivedSkeletonCandidates.candidates[1]!.generation,
          derivedSkeletonCandidates.candidates[1]!.identityHmacSha256,
          {
            outcome_text: "processed",
            diagnostic_code_id: null
          }
        )
      ]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options(undefined, {
        deriveDedupeIdentityCandidates: async () => derivedSkeletonCandidates
      })
    );

    await expect(
      repository.lookupDedupeSkeleton(skeletonLookup)
    ).resolves.toEqual({
      outcome: "integrity_failure"
    });
    executor.expectExhausted();
  });

  it("expires replayability and retires keys only after DB-clock fences", () => {
    const replayExpiry =
      inboxV2SourceDedupeReplayabilityExpireInputSchema.parse({
        tenantId,
        skeletonId: skeletonWrite.skeletonId,
        expectedRevision: "1",
        reason: "key_retired"
      });
    const retirement = inboxV2SourceProcessingKeyRetirementInputSchema.parse({
      tenantId,
      purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
      generation: "source-key:2026-07",
      expectedRevision: "2"
    });
    const retirementLockSql = normalizeSql(
      renderQuery(buildLockInboxV2SourceProcessingKeyRetirementSql(retirement))
        .sql
    );
    const verificationTransitionSql = normalizeSql(
      renderQuery(
        buildTransitionInboxV2SourceProcessingKeyToVerifyOnlySql({
          retirement,
          expectedRevision: "2",
          dbNow: t.keyVerify
        })
      ).sql
    );
    const retirementSql = normalizeSql(
      renderQuery(
        buildRetireInboxV2SourceProcessingKeySql({
          retirement,
          expectedRevision: "3",
          dbNow: t.keyVerify
        })
      ).sql
    );
    const replayExpirySql = normalizeSql(
      renderQuery(buildExpireInboxV2SourceDedupeReplayabilitySql(replayExpiry))
        .sql
    );

    expect(retirementLockSql).toContain("clock_timestamp() as db_now");
    expect(verificationTransitionSql).toContain("set state = 'verify_only'");
    expect(verificationTransitionSql).toContain("key.state = 'active'");
    expect(retirementSql).toContain("set state = 'retired'");
    expect(retirementSql).toContain("key.state = 'verify_only'");
    expect(retirementSql).not.toContain(
      "key.state in ('active', 'verify_only')"
    );
    expect(retirementSql).toContain("key.verify_until <=");
    expect(replayExpirySql).toContain("key_state_text");
    expect(replayExpirySql).toContain("'key_retired'");
    expect(replayExpirySql).toContain(
      "date_trunc('milliseconds', clock_timestamp()) as db_now"
    );
  });

  it("expires replayability before the skeleton lifecycle in separate CAS steps", async () => {
    const executor = new ScriptedTransactionExecutor([
      [],
      [{ outcome: "expired", revision: "2" }],
      [{ outcome: "expired", revision: "3" }]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options()
    );

    await expect(
      repository.expireDedupeSkeleton(
        inboxV2SourceDedupeSkeletonExpireInputSchema.parse({
          tenantId,
          skeletonId: skeletonWrite.skeletonId,
          expectedRevision: "1"
        })
      )
    ).resolves.toEqual({ outcome: "expired", revision: "3" });
    expect(normalizeSql(executor.renderedQueries[1]!.sql)).toContain(
      "set replayability_state = 'expired'"
    );
    const hardExpirySql = normalizeSql(executor.renderedQueries[2]!.sql);
    expect(hardExpirySql).toContain("set lifecycle_state = 'expired'");
    expect(hardExpirySql).not.toContain("set replayability_state");
    executor.expectExhausted();
  });

  it("retires an active cursor key through verification-only in two revisions", async () => {
    const retirement = inboxV2SourceProcessingKeyRetirementInputSchema.parse({
      tenantId,
      purposeId: INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
      generation: "cursor-key:active",
      expectedRevision: "1"
    });
    const executor = new ScriptedTransactionExecutor([
      [],
      [
        {
          generation: retirement.generation,
          state_text: "active",
          revision: "1",
          verify_until: t.completed,
          db_now: t.keyVerify
        }
      ],
      [{ generation: retirement.generation, revision: "2" }],
      [{ generation: retirement.generation, revision: "3" }]
    ]);
    const repository = createSqlInboxV2SourceProcessingRuntimeRepository(
      executor,
      options()
    );

    await expect(
      repository.retireProcessingKeyGeneration(retirement)
    ).resolves.toEqual({
      outcome: "retired",
      generation: retirement.generation,
      revision: "3"
    });
    expect(normalizeSql(executor.renderedQueries[2]!.sql)).toContain(
      "set state = 'verify_only'"
    );
    expect(normalizeSql(executor.renderedQueries[3]!.sql)).toContain(
      "set state = 'retired'"
    );
    executor.expectExhausted();
  });

  it("rotates one canonical tenant key generation under an exact active fence", () => {
    const rotation = inboxV2SourceProcessingKeyRotationInputSchema.parse({
      tenantId,
      purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
      generation: "source-key:2026-08",
      secretRef: `secret:${tenantId}/source-key-2026-08`,
      activatedAt: t.completed,
      useUntil: t.evidenceExpires,
      guaranteeUntil: t.guarantee,
      verifyUntil: t.keyVerify,
      expectedActiveGeneration: "source-key:2026-07"
    });
    const normalized = normalizeSql(
      renderQuery(
        buildRotateInboxV2SourceProcessingKeySql({
          rotation,
          dbNow: t.completed
        })
      ).sql
    );

    expect(normalized).toContain("set state = 'verify_only'");
    expect(normalized).toContain(
      "insert into public.inbox_v2_source_processing_key_generations"
    );
    expect(normalized).toContain("key.state = 'active'");
    expect(normalized).toMatch(/\$\d+::text is not null/);
    expect(normalized).toMatch(/key\.generation = \$\d+::text/);
    expect(normalized).toMatch(/\$\d+::text is null/);
  });

  it("renders cursor protection without the obsolete caller-supplied HMAC fields", () => {
    const rendered = renderQuery(
      buildAcknowledgeInboxV2SourceCursorSql({
        persistence: cursorPersistence,
        protection: cursorProtection
      })
    );

    expect(JSON.stringify(rendered.params)).not.toContain(cursorValue);
    expect(normalizeSql(rendered.sql)).toContain("cursor_value_secret_ref");
    expect(normalizeSql(rendered.sql)).not.toContain("cursor_secret_ref");
    expect(INBOX_V2_SOURCE_CURSOR_PURPOSE_ID).toBe(
      "core:source_ingress_cursor"
    );
  });

  it("renders durable denial with the exact request hash and safe diagnostic", () => {
    const normalized = normalizeSql(
      renderQuery(
        buildPersistInboxV2ReplayAuthorizationDenialSql({
          request: replayRequest,
          decision: replayAuthorizationDenial,
          retentionPolicy: {
            attemptRetentionSeconds: 86_400,
            replayRequestRetentionSeconds: 86_400
          }
        })
      ).sql
    );

    expect(normalized).toContain("request_hash");
    expect(normalized).toContain("diagnostic_correlation_token");
    expect(normalized).toContain("exact_dlq.expires_at as dlq_expires_at");
    expect(normalized).toContain("replay_not_after, expires_at");
    expect(normalized).toContain("make_interval");
    expect(normalized).toContain("'scope_mismatch'");
  });
});

function leasedWorkRow(): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    work_id: workId,
    raw_event_id: rawEventId,
    normalized_event_id: null,
    stage: "normalization",
    source_connection_id: sourceConnectionId,
    source_account_id: null,
    source_account_scope_key: "0:",
    state: "leased",
    processing_generation: "1",
    max_attempts: 5,
    attempt_count: "1",
    lease_owner_id: workerId,
    lease_token_hash: leaseTokenHash,
    lease_revision: "2",
    lease_claimed_at: t.claimed,
    lease_expires_at: t.leaseExpires,
    revision: "2",
    updated_at: t.claimed,
    db_now: t.completed,
    existing_attempt_id: null
  };
}

function terminalAdmissionSnapshot() {
  return inboxV2RawAdmissionSealedSkeletonInputSchema.parse({
    source: { tenantId, sourceConnectionId, sourceAccountId: null },
    rawEventId,
    identityKind: "provider_event_id",
    purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    keyGeneration: "dedupe-v1",
    hmacKeySecretRef: `secret:${tenantId}/source-processing`,
    identityHmacSha256: `hmac-sha256:${"1".repeat(64)}`,
    safeEnvelopeDigest: `hmac-sha256:${"2".repeat(64)}`,
    guaranteeUntil: t.guarantee,
    admissionRevision: "1"
  });
}

function terminalAdmissionRow(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const admission = terminalAdmissionSnapshot();
  return {
    tenant_id: admission.source.tenantId,
    purpose_id: admission.purposeId,
    key_generation: admission.keyGeneration,
    hmac_key_secret_ref: admission.hmacKeySecretRef,
    identity_hmac_sha256: admission.identityHmacSha256,
    identity_kind: admission.identityKind,
    source_connection_id: admission.source.sourceConnectionId,
    source_account_id: admission.source.sourceAccountId,
    source_account_scope_key: "0:",
    raw_event_id: admission.rawEventId,
    safe_envelope_digest_sha256: admission.safeEnvelopeDigest,
    guarantee_until: admission.guaranteeUntil,
    state: "skeleton_pending",
    terminal_skeleton_id: null,
    terminal_outcome_hmac_sha256: null,
    skeleton_handed_off_at: null,
    revision: admission.admissionRevision,
    admission_revision: admission.admissionRevision,
    db_now: t.completed,
    ...overrides
  };
}

function terminalAggregateRow(): Record<string, unknown> {
  return {
    current_work_count: 1,
    aggregate_fingerprint: `sha256:${"3".repeat(64)}`,
    aggregate_state: "terminal",
    aggregate_outcome: "dead_lettered",
    diagnostic_code_id: terminalDiagnostic.codeId,
    terminal_at: t.completed,
    leaf_count: 2
  };
}

function dedupeLookupRow(
  generation: string,
  identityHmacSha256: string,
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const skeleton = skeletonWrite.skeleton;
  return {
    candidate_ordinal: generation === skeleton.digestKeyGeneration ? 0 : 1,
    candidate_generation: generation,
    skeleton_id: skeletonWrite.skeletonId,
    route_generation: skeletonWrite.routeGeneration,
    source_connection_id: skeleton.source.sourceConnectionId,
    source_account_id: skeleton.source.sourceAccountId,
    phase_text: skeleton.target.phase,
    raw_event_id: skeleton.target.rawEventId,
    normalized_event_id: skeleton.target.normalizedEventId,
    purpose_id: skeleton.purposeId,
    key_generation: generation,
    key_verify_until: skeleton.keyVerifyUntil,
    identity_hmac_sha256: identityHmacSha256,
    outcome_hmac_sha256:
      generation === skeleton.digestKeyGeneration
        ? skeleton.outcomeHmacSha256
        : `hmac-sha256:${"a".repeat(64)}`,
    outcome_text: skeleton.outcome.kind,
    diagnostic_code_id: skeleton.outcome.diagnosticCodeId,
    evidence_captured_at: skeleton.evidenceDeadlines.capturedAt,
    raw_payload_expires_at: skeleton.evidenceDeadlines.rawPayloadExpiresAt,
    allowed_raw_headers_expires_at:
      skeleton.evidenceDeadlines.allowedRawHeadersExpiresAt,
    normalized_payload_expires_at:
      skeleton.evidenceDeadlines.normalizedPayloadExpiresAt,
    terminal_at: skeleton.terminalAt,
    guarantee_until: skeleton.guaranteeUntil,
    replayability_state_text: skeleton.replayability.state,
    replay_until:
      skeleton.replayability.state === "replayable"
        ? skeleton.replayability.replayUntil
        : null,
    replayability_reason_code_id: null,
    skeleton_expires_at: skeleton.skeletonExpiresAt,
    lifecycle_state_text: skeleton.lifecycleState,
    expired_at: skeleton.expiredAt,
    updated_at: skeleton.terminalAt,
    ...overrides
  };
}

function options(
  replayAuthorizationOverrides?: Partial<InboxV2SourceReplayAuthorizationPort>,
  cryptographicOverrides?: Partial<InboxV2SourceProcessingCryptographicAuthorityPort>
): CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions {
  return {
    replayAuthorization: {
      authorizeReplay: async () => ({ outcome: "authorized" }),
      ...replayAuthorizationOverrides
    },
    cryptographicAuthority: {
      protectCursor: async () => cursorProtection,
      resolveCursor: async () => ({
        kind: "receive_cursor",
        value: cursorValue
      }),
      verifyDedupeSkeleton: async () => verifiedSkeleton,
      deriveDedupeIdentityCandidates: async () => derivedSkeletonCandidates,
      ...cryptographicOverrides
    } as InboxV2SourceProcessingCryptographicAuthorityPort,
    deadLetterLifecycleResolver: async () => ({
      evidenceDeadlines: deadLetterRecord.evidenceDeadlines,
      replayNotAfter: deadLetterRecord.replayNotAfter,
      expiresAt: deadLetterRecord.expiresAt
    }),
    terminalDedupe: { mode: "compatibility_optional" },
    retentionPolicy: {
      attemptRetentionSeconds: 86_400,
      replayRequestRetentionSeconds: 86_400
    },
    leaseTokenSource: (count) =>
      Array.from({ length: count }, (_, index) => `${leaseToken}-${index}`),
    attemptIdSource: (count) =>
      Array.from(
        { length: count },
        (_, index) => `source-attempt:src008-generated-${index}`
      ),
    replayEpisodeIdSource: () => replayEpisodeId
  };
}

class ScriptedTransactionExecutor implements InboxV2SourceProcessingTransactionExecutor {
  readonly renderedQueries: Array<{ sql: string; params: unknown[] }> = [];
  readonly transactionConfigs: unknown[] = [];
  private readonly responses: Array<readonly Record<string, unknown>[]>;
  private transactionDepth = 0;

  get activeTransactionCount(): number {
    return this.transactionDepth;
  }

  constructor(responses: readonly (readonly Record<string, unknown>[])[]) {
    this.responses = responses.map((rows) => [...rows]);
  }

  async execute<Row extends Record<string, unknown>>(
    query: SQL
  ): Promise<RawSqlQueryResult<Row>> {
    this.renderedQueries.push(renderQuery(query));
    const rows = this.responses.shift();
    if (rows === undefined) throw new Error("Unexpected SQL execution.");
    return { rows: rows as readonly Row[] };
  }

  async transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult> {
    this.transactionConfigs.push(config);
    this.transactionDepth += 1;
    try {
      return await work(this);
    } finally {
      this.transactionDepth -= 1;
    }
  }

  expectExhausted(): void {
    expect(this.responses).toHaveLength(0);
  }
}

function renderQuery(query: SQL): { sql: string; params: unknown[] } {
  return new PgDialect().sqlToQuery(query);
}

function normalizeSql(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLowerCase();
}
