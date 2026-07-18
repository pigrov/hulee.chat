import {
  INBOX_V2_SOURCE_CURSOR_PURPOSE_ID,
  INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS,
  INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
  calculateInboxV2RawIngressLeaseTokenHash,
  calculateInboxV2SourceProcessingLeaseTokenHash,
  calculateInboxV2SourceTerminalDedupeSkeletonId,
  inboxV2ApplySourceProcessingOutcomeInputSchema,
  inboxV2ClaimSourceProcessingRuntimeInputSchema,
  inboxV2ClaimSourceProcessingRuntimeResultSchema,
  inboxV2EntityRevisionSchema,
  inboxV2RawIngressClaimSchema,
  inboxV2RawAdmissionSafeTerminalMaterialSchema,
  inboxV2LoadPendingRawAdmissionResultSchema,
  inboxV2SealRawAdmissionTerminalOutcomeInputSchema,
  inboxV2SealRawAdmissionTerminalOutcomeResultSchema,
  isInboxV2RawAdmissionTerminalOutcomeSealForInput,
  inboxV2SafeSourceDiagnosticSchema,
  inboxV2Sha256DigestSchema,
  inboxV2SourceCursorPersistenceInputSchema,
  inboxV2SourceCursorPersistenceResultSchema,
  inboxV2SourceCursorDurableTargetSchema,
  inboxV2SourceCursorDurableTargetLookupInputSchema,
  inboxV2SourceCursorDurableTargetLookupResultSchema,
  inboxV2SourceCursorLoadInputSchema,
  inboxV2SourceCursorLoadResultSchema,
  inboxV2SourceCursorPositionSchema,
  inboxV2SourceCursorProtectionSchema,
  inboxV2SourceBackpressurePolicySchema,
  inboxV2SourceDeadLetterRecordSchema,
  inboxV2SourceDedupeIdentityCandidatesSchema,
  inboxV2SourceDedupeOutcomeSchema,
  inboxV2SourceDedupeSkeletonExpireInputSchema,
  inboxV2SourceDedupeSkeletonExpireResultSchema,
  inboxV2SourceDedupeSkeletonLookupInputSchema,
  inboxV2SourceDedupeSkeletonLookupResultSchema,
  inboxV2SourceDedupeSkeletonSchema,
  inboxV2SourceDedupeSkeletonWriteInputSchema,
  inboxV2SourceDedupeSkeletonWriteResultSchema,
  inboxV2SourceDedupeHmacVerificationSchema,
  inboxV2SourceDedupeReplayabilityExpireInputSchema,
  inboxV2SourceDedupeReplayabilityExpireResultSchema,
  inboxV2SourceEvidenceDeadlinesSchema,
  inboxV2SourceProcessingAttemptSchema,
  inboxV2SourceProcessingAttemptIdSchema,
  inboxV2SourceProcessingKeyRetirementInputSchema,
  inboxV2SourceProcessingKeyRetirementResultSchema,
  inboxV2SourceProcessingKeyRotationInputSchema,
  inboxV2SourceProcessingKeyRotationResultSchema,
  inboxV2SourceProcessingLeaseTokenSchema,
  inboxV2SourceProcessingOutcomeSchema,
  inboxV2SourceReplayAuthorizationDecisionSchema,
  inboxV2SourceReplayRequestSchema,
  inboxV2SourceReplayEpisodeIdSchema,
  inboxV2SourceReplayResultSchema,
  inboxV2SourceTerminalDedupeLifecycleInputSchema,
  inboxV2SourceTerminalDedupeLifecycleResolutionSchema,
  inboxV2TenantIdSchema,
  inboxV2TimestampSchema,
  type InboxV2ApplySourceProcessingOutcomeInput,
  type InboxV2ApplySourceProcessingOutcomeResult,
  type InboxV2ClaimSourceProcessingRuntimeInput,
  type InboxV2ClaimSourceProcessingRuntimeResult,
  type InboxV2ClaimRawIngressResult,
  type InboxV2RawAdmissionPreflightPort,
  type InboxV2RawAdmissionSealedSkeletonInput,
  type InboxV2RawAdmissionTerminalOutcomeSealingPort,
  type InboxV2SealRawAdmissionTerminalOutcomeResult,
  type InboxV2SafeSourceDiagnostic,
  type InboxV2SourceBackpressurePolicy,
  type InboxV2SourceCursorPersistenceInput,
  type InboxV2SourceCursorPersistenceResult,
  type InboxV2SourceCursorDurableTarget,
  type InboxV2SourceCursorDurableTargetLookupInput,
  type InboxV2SourceCursorDurableTargetLookupResult,
  type InboxV2SourceCursorDurableTargetResolverPort,
  type InboxV2SourceCursorLoadInput,
  type InboxV2SourceCursorLoadResult,
  type InboxV2SourceCursorProtection,
  type InboxV2SourceDeadLetterRecord,
  type InboxV2SourceDedupeIdentityHmacCandidate,
  type InboxV2SourceDedupeIdentityCandidates,
  type InboxV2SourceDedupeHmacVerification,
  type InboxV2SourceDedupeReplayabilityExpireInput,
  type InboxV2SourceDedupeReplayabilityExpireResult,
  type InboxV2SourceDedupeSkeletonExpireInput,
  type InboxV2SourceDedupeSkeletonExpireResult,
  type InboxV2SourceDedupeSkeleton,
  type InboxV2SourceDedupeSkeletonWriteInput,
  type InboxV2SourceDedupeSkeletonWriteResult,
  type InboxV2SourceDedupeSkeletonLookupInput,
  type InboxV2SourceDedupeSkeletonLookupResult,
  type InboxV2SourceEvidenceDeadlines,
  type InboxV2SourceProcessingAttempt,
  type InboxV2SourceProcessingOutcome,
  type InboxV2SourceProcessingCryptographicAuthorityPort,
  type InboxV2SourceProcessingKeyRetirementInput,
  type InboxV2SourceProcessingKeyRetirementResult,
  type InboxV2SourceProcessingKeyRotationInput,
  type InboxV2SourceProcessingKeyRotationResult,
  type InboxV2SourceProcessingRuntimeRepositoryPort,
  type InboxV2SourceProcessingScope,
  type InboxV2SourceProcessingSourceScope,
  type InboxV2SourceReplayAuthorizationDecision,
  type InboxV2SourceReplayAuthorizationPort,
  type InboxV2SourceReplayRequest,
  type InboxV2SourceReplayResult,
  type InboxV2SourceTerminalDedupeLifecycleResolverPort
} from "@hulee/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import type { HuleeDatabase } from "../client";
import { buildInboxV2AdvisoryXactLockSql } from "./sql-inbox-v2-advisory-lock";
import { handoffInboxV2RawAdmissionSkeletonInTransaction } from "./sql-inbox-v2-raw-ingress-repository";
import type { RawSqlExecutor } from "./sql-outbox-repository";

const TRANSACTION_CONFIG = { isolationLevel: "read committed" } as const;
const TRANSACTION_ATTEMPTS = 3;
const RETRYABLE_SQLSTATES = new Set(["40001", "40P01"]);
const SQLSTATE_CAUSE_DEPTH_LIMIT = 8;
const MAX_RETENTION_SECONDS = 31_536_000;
const REPLAY_LEASE_OWNER_ID = "core:source-replay-runtime";
const REPLAY_LEASE_DURATION_SECONDS = 30;

type RawIngressClaim = Extract<
  InboxV2ClaimRawIngressResult,
  { outcome: "claimed" }
>["claims"][number];

export type InboxV2SourceProcessingLeaseTokenSource = (
  count: number
) => readonly string[];
export type InboxV2SourceProcessingAttemptIdSource = (
  count: number
) => readonly string[];
export type InboxV2SourceReplayEpisodeIdSource = (
  request: InboxV2SourceReplayRequest
) => string;

export type InboxV2SourceProcessingRetentionPolicy = Readonly<{
  attemptRetentionSeconds: number;
  replayRequestRetentionSeconds: number;
}>;

export type InboxV2SourceDeadLetterLifecycleResolution = Readonly<{
  evidenceDeadlines: InboxV2SourceEvidenceDeadlines;
  replayNotAfter: string;
  expiresAt: string;
}>;

export type InboxV2SourceDeadLetterLifecycleResolverInput = Readonly<{
  scope: InboxV2SourceProcessingScope;
  deadLetterId: string;
  deadLetteredAt: string;
  diagnostic: InboxV2SafeSourceDiagnostic;
}>;

export type InboxV2SourceDeadLetterLifecycleResolver = (
  input: InboxV2SourceDeadLetterLifecycleResolverInput
) =>
  | InboxV2SourceDeadLetterLifecycleResolution
  | Promise<InboxV2SourceDeadLetterLifecycleResolution>;

type InboxV2SourceTerminalDedupeCapabilities = Readonly<{
  rawAdmissionPreflight: InboxV2RawAdmissionPreflightPort;
  terminalOutcomeSealer: InboxV2RawAdmissionTerminalOutcomeSealingPort;
  terminalLifecycleResolver: InboxV2SourceTerminalDedupeLifecycleResolverPort;
}>;

export type InboxV2SourceTerminalDedupeOptions =
  | (InboxV2SourceTerminalDedupeCapabilities & Readonly<{ mode: "required" }>)
  | (Partial<InboxV2SourceTerminalDedupeCapabilities> &
      Readonly<{ mode: "compatibility_optional" }>);

export type CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions =
  Readonly<{
    replayAuthorization: InboxV2SourceReplayAuthorizationPort;
    cryptographicAuthority: InboxV2SourceProcessingCryptographicAuthorityPort;
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
    deadLetterLifecycleResolver: InboxV2SourceDeadLetterLifecycleResolver;
    terminalDedupe: InboxV2SourceTerminalDedupeOptions;
    leaseTokenSource?: InboxV2SourceProcessingLeaseTokenSource;
    attemptIdSource?: InboxV2SourceProcessingAttemptIdSource;
    replayEpisodeIdSource?: InboxV2SourceReplayEpisodeIdSource;
  }>;

export type InboxV2SourceProcessingTransactionExecutor = RawSqlExecutor & {
  transaction<TResult>(
    work: (transaction: RawSqlExecutor) => Promise<TResult>,
    config?: Readonly<{ isolationLevel: "read committed" }>
  ): Promise<TResult>;
};

type TerminalSourceProcessingOutcome = Exclude<
  InboxV2SourceProcessingOutcome,
  Readonly<{ kind: "retry_scheduled" }>
>;
type SealedRawAdmissionTerminalOutcome = Extract<
  InboxV2SealRawAdmissionTerminalOutcomeResult,
  Readonly<{ outcome: "sealed" }>
>;
type PreparedTerminalDedupeLifecycle = Pick<
  InboxV2SourceDedupeSkeleton,
  "evidenceDeadlines" | "skeletonExpiresAt" | "replayability"
>;
type TerminalDedupeAggregateSnapshot = Readonly<{
  fingerprint: string;
  state: "non_terminal" | "terminal";
  terminalOutcome: InboxV2SourceDedupeSkeleton["outcome"] | null;
  terminalAt: string | null;
  leafCount: number;
}>;
type TerminalDedupePreparation =
  | Readonly<{ kind: "not_terminal" }>
  | Readonly<{ kind: "compatibility_skipped" }>
  | Readonly<{ kind: "already_handed_off" }>
  | Readonly<{
      kind: "aggregate_pending";
      admission: InboxV2RawAdmissionSealedSkeletonInput;
      aggregate: TerminalDedupeAggregateSnapshot;
    }>
  | Readonly<{
      kind: "prepared";
      admission: InboxV2RawAdmissionSealedSkeletonInput;
      aggregate: TerminalDedupeAggregateSnapshot;
      seal: SealedRawAdmissionTerminalOutcome;
      lifecycle: PreparedTerminalDedupeLifecycle;
      skeletonId: string;
    }>;

function parseTerminalDedupeOptions(
  options: InboxV2SourceTerminalDedupeOptions
): InboxV2SourceTerminalDedupeOptions {
  if (
    options === null ||
    typeof options !== "object" ||
    (options.mode !== "required" && options.mode !== "compatibility_optional")
  ) {
    throw new TypeError(
      "Source-processing terminal dedupe requires an explicit runtime mode."
    );
  }
  const capabilities = [
    typeof options.rawAdmissionPreflight?.loadPendingDedupeAdmission ===
      "function",
    typeof options.terminalOutcomeSealer?.sealTerminalDedupeOutcome ===
      "function",
    typeof options.terminalLifecycleResolver?.resolveTerminalDedupeLifecycle ===
      "function"
  ];
  if (
    options.mode === "required"
      ? capabilities.some((value) => !value)
      : capabilities.some(Boolean) && !capabilities.every(Boolean)
  ) {
    throw new TypeError(
      "Source-processing terminal dedupe capabilities must be complete."
    );
  }
  return options;
}

async function prepareTerminalDedupeOutcome(
  input: Readonly<{
    executor: RawSqlExecutor;
    options: InboxV2SourceTerminalDedupeOptions;
    outcome: InboxV2SourceProcessingOutcome;
    deadLetterRecord: InboxV2SourceDeadLetterRecord | null;
  }>
): Promise<TerminalDedupePreparation> {
  if (input.outcome.kind === "retry_scheduled") {
    return { kind: "not_terminal" };
  }
  const capabilities = completeTerminalDedupeCapabilities(input.options);
  if (capabilities === null) {
    return { kind: "compatibility_skipped" };
  }
  const aggregate = await loadTerminalDedupeAggregate(
    input.executor,
    input.outcome,
    false
  );
  if (aggregate === null) {
    // Preserve the repository's normal not-found/stale classification without
    // invoking KMS for a work item that is not in the exact raw aggregate.
    return { kind: "not_terminal" };
  }
  const loaded = inboxV2LoadPendingRawAdmissionResultSchema.parse(
    await capabilities.rawAdmissionPreflight.loadPendingDedupeAdmission({
      tenantId: input.outcome.attempt.scope.tenantId,
      rawEventId: input.outcome.attempt.scope.rawEventId
    })
  );
  if (loaded.outcome !== "pending") {
    if (loaded.outcome === "not_pending") {
      return { kind: "already_handed_off" };
    }
    if (
      input.options.mode === "compatibility_optional" &&
      loaded.outcome === "not_found"
    ) {
      return { kind: "compatibility_skipped" };
    }
    throw invariantError(
      `Terminal dedupe admission preflight failed: ${loaded.outcome}.`
    );
  }

  if (aggregate.state === "non_terminal") {
    return Object.freeze({
      kind: "aggregate_pending",
      admission: loaded.snapshot,
      aggregate
    });
  }
  if (aggregate.terminalOutcome === null || aggregate.terminalAt === null) {
    throw invariantError(
      "Terminal raw aggregate omitted its bounded outcome material."
    );
  }
  const material = buildTerminalDedupeSafeMaterial({
    rawEventId: input.outcome.attempt.scope.rawEventId,
    terminalOutcome: aggregate.terminalOutcome,
    terminalAt: aggregate.terminalAt
  });
  const sealInput = inboxV2SealRawAdmissionTerminalOutcomeInputSchema.parse({
    admission: loaded.snapshot,
    material
  });
  const sealed = inboxV2SealRawAdmissionTerminalOutcomeResultSchema.parse(
    await capabilities.terminalOutcomeSealer.sealTerminalDedupeOutcome(
      sealInput
    )
  );
  if (!isInboxV2RawAdmissionTerminalOutcomeSealForInput(sealInput, sealed)) {
    throw invariantError(
      "Terminal dedupe seal rejected or escaped its exact admission material."
    );
  }
  const lifecycle = await resolvePreparedTerminalDedupeLifecycle({
    resolver: capabilities.terminalLifecycleResolver,
    admission: loaded.snapshot,
    scope: input.outcome.attempt.scope,
    terminalOutcome: aggregate.terminalOutcome,
    terminalAt: aggregate.terminalAt,
    deadLetterRecord: input.deadLetterRecord,
    seal: sealed
  });
  const skeletonId = calculateInboxV2SourceTerminalDedupeSkeletonId({
    source: sealed.source,
    target: sealed.material.target,
    keyGeneration: sealed.keyGeneration,
    identityHmacSha256: sealed.identityHmacSha256
  });
  return Object.freeze({
    kind: "prepared",
    admission: loaded.snapshot,
    aggregate,
    seal: sealed,
    lifecycle,
    skeletonId
  });
}

function completeTerminalDedupeCapabilities(
  options: InboxV2SourceTerminalDedupeOptions
): InboxV2SourceTerminalDedupeCapabilities | null {
  if (
    options.rawAdmissionPreflight === undefined ||
    options.terminalOutcomeSealer === undefined ||
    options.terminalLifecycleResolver === undefined
  ) {
    if (options.mode === "required") {
      throw invariantError(
        "Required terminal dedupe capabilities disappeared after composition."
      );
    }
    return null;
  }
  return options as InboxV2SourceTerminalDedupeCapabilities;
}

function buildTerminalDedupeSafeMaterial(
  input: Readonly<{
    rawEventId: string;
    terminalOutcome: InboxV2SourceDedupeSkeleton["outcome"];
    terminalAt: string;
  }>
) {
  return inboxV2RawAdmissionSafeTerminalMaterialSchema.parse({
    target: {
      phase: "raw",
      rawEventId: input.rawEventId,
      normalizedEventId: null
    },
    terminalOutcome: input.terminalOutcome,
    terminalAt: input.terminalAt
  });
}

async function resolvePreparedTerminalDedupeLifecycle(
  input: Readonly<{
    resolver: InboxV2SourceTerminalDedupeLifecycleResolverPort;
    admission: InboxV2RawAdmissionSealedSkeletonInput;
    scope: InboxV2SourceProcessingScope;
    terminalOutcome: InboxV2SourceDedupeSkeleton["outcome"];
    terminalAt: string;
    deadLetterRecord: InboxV2SourceDeadLetterRecord | null;
    seal: SealedRawAdmissionTerminalOutcome;
  }>
): Promise<PreparedTerminalDedupeLifecycle> {
  let lifecycle: PreparedTerminalDedupeLifecycle;
  if (input.terminalOutcome.kind === "dead_lettered") {
    const record = input.deadLetterRecord;
    if (
      record === null ||
      input.terminalOutcome.diagnosticCodeId !== record.diagnostic.codeId ||
      input.terminalAt !== record.deadLetteredAt
    ) {
      throw invariantError("Dead-lettered terminal dedupe requires lifecycle.");
    }
    lifecycle = {
      evidenceDeadlines: {
        ...record.evidenceDeadlines,
        normalizedPayloadExpiresAt: null
      },
      skeletonExpiresAt: record.expiresAt,
      replayability: {
        state: "replayable",
        replayUntil: record.replayNotAfter
      }
    };
  } else {
    const lifecycleInput =
      inboxV2SourceTerminalDedupeLifecycleInputSchema.parse({
        scope: input.scope,
        terminalOutcomeKind: input.terminalOutcome.kind,
        terminalAt: input.terminalAt,
        admissionGuaranteeUntil: input.admission.guaranteeUntil
      });
    const resolved = inboxV2SourceTerminalDedupeLifecycleResolutionSchema.parse(
      await input.resolver.resolveTerminalDedupeLifecycle(lifecycleInput)
    );
    if (
      resolved.replayability.reason !== input.terminalOutcome.kind ||
      resolved.replayability.decidedAt !== input.terminalAt
    ) {
      throw invariantError(
        "Terminal dedupe lifecycle escaped its exact non-replayable outcome."
      );
    }
    lifecycle = resolved;
  }
  inboxV2SourceDedupeSkeletonSchema.parse({
    source: input.seal.source,
    target: input.seal.material.target,
    purposeId: INBOX_V2_SOURCE_REPLAY_PURPOSE_ID,
    digestKeyGeneration: input.seal.keyGeneration,
    keyVerifyUntil: lifecycle.skeletonExpiresAt,
    identityHmacSha256: input.seal.identityHmacSha256,
    outcomeHmacSha256: input.seal.outcomeHmacSha256,
    outcome: input.seal.material.terminalOutcome,
    evidenceDeadlines: lifecycle.evidenceDeadlines,
    terminalAt: input.seal.material.terminalAt,
    guaranteeUntil: input.admission.guaranteeUntil,
    skeletonExpiresAt: lifecycle.skeletonExpiresAt,
    replayability: lifecycle.replayability,
    lifecycleState: "active",
    expiredAt: null
  });
  return Object.freeze(lifecycle);
}

type TerminalDedupeAggregateRow = Record<string, unknown> & {
  current_work_count: unknown;
  aggregate_fingerprint: unknown;
  aggregate_state: unknown;
  aggregate_outcome: unknown;
  diagnostic_code_id: unknown;
  terminal_at: unknown;
  leaf_count: unknown;
};

async function loadTerminalDedupeAggregate(
  executor: RawSqlExecutor,
  outcome: TerminalSourceProcessingOutcome,
  lock: boolean
): Promise<TerminalDedupeAggregateSnapshot | null> {
  const result = await executor.execute<TerminalDedupeAggregateRow>(
    buildLoadInboxV2TerminalDedupeAggregateSql({ outcome, lock })
  );
  const row = exactlyOneRow(result.rows, "terminal dedupe aggregate");
  if (integerValue(row.current_work_count) !== 1) return null;
  const state = stringValue(
    row.aggregate_state,
    "terminal dedupe aggregate state"
  );
  if (state !== "non_terminal" && state !== "terminal") {
    throw invariantError(
      "Terminal dedupe aggregate returned an invalid state."
    );
  }
  const fingerprint = inboxV2Sha256DigestSchema.parse(
    stringValue(row.aggregate_fingerprint, "terminal aggregate fingerprint")
  );
  const leafCount = integerValue(row.leaf_count);
  if (state === "non_terminal") {
    if (
      row.aggregate_outcome !== null ||
      row.diagnostic_code_id !== null ||
      row.terminal_at !== null
    ) {
      throw invariantError(
        "Non-terminal raw aggregate exposed terminal outcome material."
      );
    }
    return Object.freeze({
      fingerprint,
      state,
      terminalOutcome: null,
      terminalAt: null,
      leafCount
    });
  }
  const terminalOutcome = inboxV2SourceDedupeOutcomeSchema.parse({
    kind: stringValue(row.aggregate_outcome, "terminal aggregate outcome"),
    diagnosticCodeId: nullableString(
      row.diagnostic_code_id,
      "terminal aggregate diagnostic"
    )
  });
  return Object.freeze({
    fingerprint,
    state,
    terminalOutcome,
    terminalAt: timestampValue(row.terminal_at, "terminal aggregate time"),
    leafCount
  });
}

/**
 * Computes one raw-admission aggregate with the current outcome applied only
 * hypothetically. The locking form is used after the admission row lock, so
 * concurrent fan-out leaves serialize and a stale preflight rolls back before
 * any attempt, DLQ or handoff write.
 */
export function buildLoadInboxV2TerminalDedupeAggregateSql(
  input: Readonly<{
    outcome: TerminalSourceProcessingOutcome;
    lock: boolean;
  }>
): SQL {
  const outcome = inboxV2SourceProcessingOutcomeSchema.parse(input.outcome);
  if (outcome.kind === "retry_scheduled") {
    throw new TypeError("Retry outcomes cannot finalize a raw aggregate.");
  }
  const attempt = outcome.attempt;
  const diagnosticCodeId = outcome.diagnostic?.codeId ?? null;
  const lockClause = input.lock ? sql`for update of work` : sql``;
  return sql`
    with aggregate_work as materialized (
      select work.*
        from public.inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${attempt.scope.tenantId}
         and work.raw_event_id = ${attempt.scope.rawEventId}
       order by work.work_id collate "C"
       ${lockClause}
    ),
    effective_work as materialized (
      select work.*,
             (work.work_id = ${attempt.workId}
               and work.stage::text = ${attempt.scope.stage}
               and work.normalized_event_id is not distinct from
                   ${attempt.scope.normalizedEventId}
               and work.source_connection_id =
                   ${attempt.scope.sourceConnectionId}
               and work.source_account_id is not distinct from
                   ${attempt.scope.sourceAccountId}) as is_current,
             case when work.work_id = ${attempt.workId}
                        and work.stage::text = ${attempt.scope.stage}
                        and work.normalized_event_id is not distinct from
                            ${attempt.scope.normalizedEventId}
                        and work.source_connection_id =
                            ${attempt.scope.sourceConnectionId}
                        and work.source_account_id is not distinct from
                            ${attempt.scope.sourceAccountId}
                  then ${outcome.kind}::text
                  else work.state::text end as effective_state,
             case when work.work_id = ${attempt.workId}
                        and work.stage::text = ${attempt.scope.stage}
                        and work.normalized_event_id is not distinct from
                            ${attempt.scope.normalizedEventId}
                        and work.source_connection_id =
                            ${attempt.scope.sourceConnectionId}
                        and work.source_account_id is not distinct from
                            ${attempt.scope.sourceAccountId}
                  then ${outcome.completedAt}::timestamptz
                  else coalesce(work.completed_at, work.dead_lettered_at)
              end as effective_terminal_at,
             case when work.work_id = ${attempt.workId}
                        and work.stage::text = ${attempt.scope.stage}
                        and work.normalized_event_id is not distinct from
                            ${attempt.scope.normalizedEventId}
                        and work.source_connection_id =
                            ${attempt.scope.sourceConnectionId}
                        and work.source_account_id is not distinct from
                            ${attempt.scope.sourceAccountId}
                  then ${diagnosticCodeId}::text
                  else work.last_diagnostic_code_id
              end as effective_diagnostic_code_id
        from aggregate_work work
    ),
    classified_work as materialized (
      select work.*,
             exists (
               select 1
                 from effective_work successor
                where successor.tenant_id = work.tenant_id
                  and successor.raw_event_id = work.raw_event_id
                  and (
                    (work.stage = 'raw_ingest'
                      and successor.stage = 'normalization'
                      and successor.normalized_event_scope_key = '0:')
                    or (work.stage = 'normalization'
                      and successor.stage = 'identity_resolution')
                    or (work.stage = 'identity_resolution'
                      and successor.stage = 'conversation_resolution'
                      and successor.normalized_event_scope_key =
                          work.normalized_event_scope_key)
                    or (work.stage = 'conversation_resolution'
                      and successor.stage = 'routing'
                      and successor.normalized_event_scope_key =
                          work.normalized_event_scope_key)
                    or (work.stage = 'routing'
                      and successor.stage = 'message_reconciliation'
                      and successor.normalized_event_scope_key =
                          work.normalized_event_scope_key)
                    or (work.stage = 'message_reconciliation'
                      and successor.stage = 'materialization'
                      and successor.normalized_event_scope_key =
                          work.normalized_event_scope_key)
                  )
             ) as has_successor
        from effective_work work
    ),
    leaves as materialized (
      select * from classified_work where not has_successor
    ),
    aggregate_summary as materialized (
      select count(*) filter (where work.is_current)::integer
               as current_work_count,
             (select count(*)::integer from leaves) as leaf_count,
             exists (
               select 1 from classified_work dead
                where dead.effective_state = 'dead_lettered'
             ) as has_dead_letter,
             exists (
               select 1 from leaves leaf
                where leaf.effective_state = 'processed'
                  and leaf.stage = 'materialization'
             ) as has_materialized,
             not exists (
               select 1 from leaves leaf
                where not (
                  leaf.effective_state in ('ignored', 'duplicate')
                  or (leaf.effective_state = 'processed'
                    and leaf.stage = 'materialization')
                )
             ) as all_leaves_terminal,
             not exists (
               select 1 from leaves leaf
                where leaf.effective_state <> 'duplicate'
             ) as all_leaves_duplicate
        from classified_work work
    ),
    aggregate_classification as materialized (
      select summary.*,
             (summary.has_dead_letter
               or (summary.leaf_count > 0
                 and summary.all_leaves_terminal)) as is_terminal,
             case
               when summary.has_dead_letter then 'dead_lettered'
               when summary.leaf_count > 0 and summary.all_leaves_terminal
                    and summary.has_materialized then 'processed'
               when summary.leaf_count > 0 and summary.all_leaves_terminal
                    and summary.all_leaves_duplicate then 'duplicate'
               when summary.leaf_count > 0 and summary.all_leaves_terminal
                 then 'ignored'
               else null
             end as aggregate_outcome
        from aggregate_summary summary
    ),
    aggregate_material as materialized (
      select classification.*,
             case
               when classification.aggregate_outcome = 'dead_lettered' then (
                 select dead.effective_diagnostic_code_id
                   from classified_work dead
                  where dead.effective_state = 'dead_lettered'
                  order by dead.effective_terminal_at,
                           dead.work_id collate "C"
                  limit 1
               )
               when classification.aggregate_outcome = 'ignored' then (
                 select leaf.effective_diagnostic_code_id
                   from leaves leaf
                  where leaf.effective_state = 'ignored'
                  order by leaf.effective_terminal_at,
                           leaf.work_id collate "C"
                  limit 1
               )
               else null
             end as diagnostic_code_id,
             case
               when classification.aggregate_outcome = 'dead_lettered' then (
                 select dead.effective_terminal_at
                   from classified_work dead
                  where dead.effective_state = 'dead_lettered'
                  order by dead.effective_terminal_at,
                           dead.work_id collate "C"
                  limit 1
               )
               when classification.is_terminal then (
                 select max(leaf.effective_terminal_at) from leaves leaf
               )
               else null
             end as terminal_at
        from aggregate_classification classification
    ),
    aggregate_fingerprint as materialized (
      select 'sha256:' || encode(sha256(convert_to(
               coalesce(jsonb_agg(jsonb_build_object(
                 'workId', work.work_id,
                 'stage', work.stage::text,
                 'normalizedScope', work.normalized_event_scope_key,
                 'state', work.effective_state,
                 'terminalAt', work.effective_terminal_at,
                 'diagnosticCodeId', work.effective_diagnostic_code_id,
                 'hasSuccessor', work.has_successor,
                 'processingGeneration', work.processing_generation::text,
                 'attemptCount', work.attempt_count::text,
                 'revision', work.revision::text,
                 'routeGeneration', work.route_generation::text
               ) order by work.work_id collate "C")::text, '[]'),
               'UTF8')), 'hex') as fingerprint
        from classified_work work
    )
    select material.current_work_count,
           fingerprint.fingerprint as aggregate_fingerprint,
           case when material.is_terminal
                then 'terminal' else 'non_terminal' end as aggregate_state,
           material.aggregate_outcome,
           material.diagnostic_code_id,
           material.terminal_at,
           material.leaf_count
      from aggregate_material material
      cross join aggregate_fingerprint fingerprint
  `;
}

type TerminalDedupeAdmissionRow = Record<string, unknown> & {
  tenant_id: unknown;
  purpose_id: unknown;
  key_generation: unknown;
  hmac_key_secret_ref: unknown;
  identity_hmac_sha256: unknown;
  identity_kind: unknown;
  source_connection_id: unknown;
  source_account_id: unknown;
  raw_event_id: unknown;
  safe_envelope_digest_sha256: unknown;
  guarantee_until: unknown;
  state: unknown;
  terminal_skeleton_id: unknown;
  terminal_outcome_hmac_sha256: unknown;
  admission_revision: unknown;
  db_now: unknown;
};

export function buildLockInboxV2TerminalDedupeAdmissionSql(
  input: Readonly<{
    tenantId: string;
    rawEventId: string;
  }>
): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  return sql`
    select admission.tenant_id, admission.purpose_id,
           admission.key_generation, admission.hmac_key_secret_ref,
           admission.identity_hmac_sha256, admission.identity_kind,
           admission.source_connection_id, admission.source_account_id,
           admission.raw_event_id, admission.safe_envelope_digest_sha256,
           admission.guarantee_until, admission.state::text as state,
           admission.terminal_skeleton_id,
           admission.terminal_outcome_hmac_sha256,
           admission.revision::text as admission_revision,
           clock_timestamp() as db_now
      from public.inbox_v2_source_raw_admissions admission
     where admission.tenant_id = ${tenantId}
       and admission.raw_event_id = ${input.rawEventId}
     order by admission.key_generation collate "C"
     for update of admission
  `;
}

async function revalidatePendingTerminalDedupeAggregate(
  transaction: RawSqlExecutor,
  outcome: TerminalSourceProcessingOutcome,
  preparation: Extract<
    TerminalDedupePreparation,
    { kind: "aggregate_pending" | "prepared" }
  >
): Promise<void> {
  const result = await transaction.execute<TerminalDedupeAdmissionRow>(
    buildLockInboxV2TerminalDedupeAdmissionSql({
      tenantId: preparation.admission.source.tenantId,
      rawEventId: preparation.admission.rawEventId
    })
  );
  const row = exactlyOneRow(result.rows, "terminal dedupe admission lock");
  if (!lockedAdmissionMatchesSnapshot(row, preparation.admission)) {
    throw invariantError(
      "Terminal dedupe admission changed after its cryptographic preflight."
    );
  }
  const dbNow = timestampValue(row.db_now, "terminal admission database clock");
  if (
    stringValue(row.state, "terminal admission state") !== "skeleton_pending" ||
    row.terminal_skeleton_id !== null ||
    row.terminal_outcome_hmac_sha256 !== null ||
    Date.parse(dbNow) >= Date.parse(preparation.admission.guaranteeUntil)
  ) {
    throw invariantError(
      "Terminal dedupe admission is no longer pending within its guarantee."
    );
  }

  const aggregate = await loadTerminalDedupeAggregate(
    transaction,
    outcome,
    true
  );
  if (
    aggregate === null ||
    aggregate.fingerprint !== preparation.aggregate.fingerprint ||
    JSON.stringify(aggregate) !== JSON.stringify(preparation.aggregate)
  ) {
    throw invariantError(
      "Terminal raw aggregate changed after preflight; retry before applying the outcome."
    );
  }
}

function lockedAdmissionMatchesSnapshot(
  row: TerminalDedupeAdmissionRow,
  admission: InboxV2RawAdmissionSealedSkeletonInput
): boolean {
  return (
    stringValue(row.tenant_id, "terminal admission tenant") ===
      admission.source.tenantId &&
    stringValue(row.purpose_id, "terminal admission purpose") ===
      admission.purposeId &&
    stringValue(row.key_generation, "terminal admission generation") ===
      admission.keyGeneration &&
    stringValue(row.hmac_key_secret_ref, "terminal admission secret") ===
      admission.hmacKeySecretRef &&
    stringValue(row.identity_hmac_sha256, "terminal admission identity") ===
      admission.identityHmacSha256 &&
    stringValue(row.identity_kind, "terminal admission identity kind") ===
      admission.identityKind &&
    stringValue(row.source_connection_id, "terminal admission connection") ===
      admission.source.sourceConnectionId &&
    nullableString(row.source_account_id, "terminal admission account") ===
      admission.source.sourceAccountId &&
    stringValue(row.raw_event_id, "terminal admission raw event") ===
      admission.rawEventId &&
    stringValue(
      row.safe_envelope_digest_sha256,
      "terminal admission envelope digest"
    ) === admission.safeEnvelopeDigest &&
    timestampValue(row.guarantee_until, "terminal admission guarantee") ===
      admission.guaranteeUntil &&
    bigintText(row.admission_revision, "terminal admission revision") ===
      admission.admissionRevision
  );
}

async function persistTerminalDedupeInTransaction(
  transaction: RawSqlExecutor,
  input: Readonly<{
    outcome: TerminalSourceProcessingOutcome;
    preparation: Extract<TerminalDedupePreparation, { kind: "prepared" }>;
  }>
): Promise<void> {
  const preparation = input.preparation;
  const handoff = await handoffInboxV2RawAdmissionSkeletonInTransaction(
    transaction,
    {
      tenantId: preparation.admission.source.tenantId,
      rawEventId: preparation.admission.rawEventId,
      expectedAdmissionRevision: preparation.admission.admissionRevision,
      handedOffAt: preparation.seal.material.terminalAt,
      terminalSkeletonId: preparation.skeletonId,
      terminalOutcomeHmacSha256: preparation.seal.outcomeHmacSha256
    }
  );
  if (
    handoff.outcome !== "handed_off" ||
    handoff.terminalSkeletonId !== preparation.skeletonId ||
    handoff.terminalOutcomeHmacSha256 !== preparation.seal.outcomeHmacSha256 ||
    JSON.stringify(handoff.sealedSkeleton) !==
      JSON.stringify(preparation.admission)
  ) {
    throw invariantError(
      `Terminal dedupe admission handoff failed closed: ${handoff.outcome}.`
    );
  }
  const written = await transaction.execute<Record<string, unknown>>(
    buildPersistInboxV2TerminalDedupeSkeletonSql(preparation)
  );
  const writeOutcome = stringValue(
    exactlyOneRow(written.rows, "terminal dedupe skeleton write").outcome,
    "terminal dedupe skeleton write outcome"
  );
  if (writeOutcome !== "written") {
    throw invariantError(
      `Terminal dedupe skeleton write failed closed: ${writeOutcome}.`
    );
  }
}

export function buildPersistInboxV2TerminalDedupeSkeletonSql(
  preparation: Extract<TerminalDedupePreparation, { kind: "prepared" }>
): SQL {
  const { admission, seal, lifecycle, skeletonId } = preparation;
  if (
    seal.material.target.phase !== "raw" ||
    seal.material.target.normalizedEventId !== null
  ) {
    throw new TypeError(
      "Terminal raw aggregate requires a raw skeleton target."
    );
  }
  const replayUntil =
    lifecycle.replayability.state === "replayable"
      ? lifecycle.replayability.replayUntil
      : null;
  const reasonCode =
    lifecycle.replayability.state === "replayable"
      ? null
      : `core:source-replay.${lifecycle.replayability.reason.replaceAll("_", "-")}`;
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    admission_scope as materialized (
      select admission.*
        from public.inbox_v2_source_raw_admissions admission
       where admission.tenant_id = ${admission.source.tenantId}
         and admission.raw_event_id = ${admission.rawEventId}
         and admission.purpose_id = ${admission.purposeId}
         and admission.key_generation = ${admission.keyGeneration}
         and admission.hmac_key_secret_ref = ${admission.hmacKeySecretRef}
         and admission.identity_hmac_sha256 =
             ${admission.identityHmacSha256}
         and admission.state = 'skeleton_handed_off'
         and admission.terminal_skeleton_id = ${skeletonId}
         and admission.terminal_outcome_hmac_sha256 =
             ${seal.outcomeHmacSha256}
       for share of admission
    ),
    key_generation as materialized (
      select key.*
        from public.inbox_v2_source_processing_key_generations key
        join admission_scope admission
          on admission.tenant_id = key.tenant_id
         and admission.purpose_id = key.purpose_id
         and admission.key_generation = key.generation
         and admission.hmac_key_secret_ref = key.secret_ref
        cross join db_clock
       where key.state in ('active', 'verify_only')
         and key.activated_at <= ${seal.material.terminalAt}::timestamptz
         and key.use_until > ${seal.material.terminalAt}::timestamptz
         and key.guarantee_not_after >=
             ${admission.guaranteeUntil}::timestamptz
         and key.verify_until > db_clock.db_now
       for share of key
    ),
    current_route as materialized (
      select public.inbox_v2_src_runtime_route_generation(
               admission.tenant_id,
               admission.source_connection_id,
               admission.source_account_id
             ) as route_generation
        from admission_scope admission
    ),
    existing as materialized (
      select stored.*
        from public.inbox_v2_source_delivery_dedupe_skeletons stored
       where stored.tenant_id = ${admission.source.tenantId}
         and (stored.id = ${skeletonId}
           or (stored.purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
             and stored.key_generation = ${seal.keyGeneration}
             and stored.identity_hmac_sha256 =
                 ${seal.identityHmacSha256}))
       order by stored.id collate "C"
       for update of stored
    ),
    classified as materialized (
      select case
               when not exists (select 1 from admission_scope)
                 then 'admission_conflict'
               when not exists (select 1 from key_generation)
                 or (select route_generation from current_route) is null
                 or ${lifecycle.skeletonExpiresAt}::timestamptz <= db_clock.db_now
                 then 'key_unavailable'
               when exists (select 1 from existing) then 'conflict'
               else null
             end::text as outcome
        from db_clock
    ),
    inserted as materialized (
      insert into public.inbox_v2_source_delivery_dedupe_skeletons (
        tenant_id, id, source_connection_id, source_account_id,
        source_account_scope_key, route_generation, phase, raw_event_id,
        normalized_event_id, purpose_id, key_generation,
        key_verify_until, identity_hmac_sha256, outcome_hmac_sha256,
        outcome, diagnostic_code_id, evidence_captured_at,
        raw_payload_expires_at, allowed_raw_headers_expires_at,
        normalized_payload_expires_at, terminal_at, guarantee_until,
        replayability_state, replay_until, replayability_reason_code_id,
        skeleton_expires_at, lifecycle_state, expired_at, revision,
        created_at, updated_at
      )
      select admission.tenant_id, ${skeletonId},
             admission.source_connection_id, admission.source_account_id,
             admission.source_account_scope_key, route.route_generation,
             'raw', admission.raw_event_id, null,
             ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}, key.generation,
             key.verify_until, admission.identity_hmac_sha256,
             ${seal.outcomeHmacSha256}, ${seal.material.terminalOutcome.kind},
             ${seal.material.terminalOutcome.diagnosticCodeId},
             ${lifecycle.evidenceDeadlines.capturedAt}::timestamptz,
             ${lifecycle.evidenceDeadlines.rawPayloadExpiresAt}::timestamptz,
             ${lifecycle.evidenceDeadlines.allowedRawHeadersExpiresAt}::timestamptz,
             null, ${seal.material.terminalAt}::timestamptz,
             admission.guarantee_until,
             ${lifecycle.replayability.state}, ${replayUntil}::timestamptz,
             ${reasonCode}, ${lifecycle.skeletonExpiresAt}::timestamptz,
             'active', null, 1,
             ${seal.material.terminalAt}::timestamptz,
             ${seal.material.terminalAt}::timestamptz
        from admission_scope admission
        cross join key_generation key
        cross join current_route route
        cross join classified
       where classified.outcome is null
      on conflict do nothing
      returning id
    )
    select case
             when classified.outcome is not null then classified.outcome
             when (select count(*) from inserted) = 1 then 'written'
             else 'conflict'
           end::text as outcome
      from classified
  `;
}

async function assertTerminalDedupeAlreadyApplied(
  transaction: RawSqlExecutor,
  outcome: TerminalSourceProcessingOutcome
): Promise<InboxV2SourceDedupeSkeleton["outcome"]["kind"]> {
  const admissionResult = await transaction.execute<TerminalDedupeAdmissionRow>(
    buildLockInboxV2TerminalDedupeAdmissionSql({
      tenantId: outcome.attempt.scope.tenantId,
      rawEventId: outcome.attempt.scope.rawEventId
    })
  );
  const admission = exactlyOneRow(
    admissionResult.rows,
    "terminal dedupe retry admission"
  );
  if (
    stringValue(admission.state, "terminal retry admission state") !==
      "skeleton_handed_off" ||
    admission.terminal_skeleton_id === null ||
    admission.terminal_outcome_hmac_sha256 === null
  ) {
    throw invariantError(
      "An already-applied terminal outcome lacks its exact handed-off admission."
    );
  }
  const aggregate = await loadTerminalDedupeAggregate(
    transaction,
    outcome,
    true
  );
  if (
    aggregate === null ||
    aggregate.state !== "terminal" ||
    aggregate.terminalOutcome === null ||
    aggregate.terminalAt === null
  ) {
    throw invariantError(
      "An already-applied terminal outcome no longer closes its raw aggregate."
    );
  }
  const linked = await transaction.execute<Record<string, unknown>>(
    buildAssertInboxV2TerminalDedupeAlreadyAppliedSql(outcome)
  );
  const row = exactlyOneRow(linked.rows, "terminal dedupe retry skeleton");
  const source = {
    tenantId: stringValue(row.tenant_id, "terminal retry tenant"),
    sourceConnectionId: stringValue(
      row.source_connection_id,
      "terminal retry connection"
    ),
    sourceAccountId: nullableString(
      row.source_account_id,
      "terminal retry account"
    )
  };
  const rawEventId = stringValue(row.raw_event_id, "terminal retry raw event");
  const keyGeneration = stringValue(
    row.key_generation,
    "terminal retry generation"
  );
  const identityHmacSha256 = stringValue(
    row.identity_hmac_sha256,
    "terminal retry identity HMAC"
  );
  const expectedSkeletonId = calculateInboxV2SourceTerminalDedupeSkeletonId({
    source,
    target: { phase: "raw", rawEventId, normalizedEventId: null },
    keyGeneration,
    identityHmacSha256
  });
  const storedOutcome = inboxV2SourceDedupeOutcomeSchema.parse({
    kind: stringValue(row.outcome, "terminal retry outcome"),
    diagnosticCodeId: nullableString(
      row.diagnostic_code_id,
      "terminal retry diagnostic"
    )
  });
  if (
    stringValue(row.skeleton_id, "terminal retry skeleton id") !==
      expectedSkeletonId ||
    stringValue(
      admission.terminal_skeleton_id,
      "terminal retry admission skeleton"
    ) !== expectedSkeletonId ||
    JSON.stringify(storedOutcome) !==
      JSON.stringify(aggregate.terminalOutcome) ||
    timestampValue(row.terminal_at, "terminal retry terminal time") !==
      aggregate.terminalAt
  ) {
    throw invariantError(
      "An already-applied terminal outcome conflicts with its aggregate skeleton."
    );
  }
  return storedOutcome.kind;
}

export function buildAssertInboxV2TerminalDedupeAlreadyAppliedSql(
  outcome: TerminalSourceProcessingOutcome
): SQL {
  const parsed = inboxV2SourceProcessingOutcomeSchema.parse(outcome);
  if (parsed.kind === "retry_scheduled") {
    throw new TypeError("Retry outcomes cannot own terminal dedupe evidence.");
  }
  const scope = parsed.attempt.scope;
  return sql`
    select admission.tenant_id, admission.source_connection_id,
           admission.source_account_id, admission.raw_event_id,
           admission.key_generation, admission.identity_hmac_sha256,
           skeleton.id as skeleton_id, skeleton.outcome::text as outcome,
           skeleton.diagnostic_code_id, skeleton.terminal_at
      from public.inbox_v2_source_raw_admissions admission
      join public.inbox_v2_source_delivery_dedupe_skeletons skeleton
        on skeleton.tenant_id = admission.tenant_id
       and skeleton.id = admission.terminal_skeleton_id
       and skeleton.source_connection_id = admission.source_connection_id
       and skeleton.source_account_id is not distinct from
           admission.source_account_id
       and skeleton.source_account_scope_key =
           admission.source_account_scope_key
       and skeleton.phase = 'raw'
       and skeleton.raw_event_id = admission.raw_event_id
       and skeleton.normalized_event_id is null
       and skeleton.purpose_id = admission.purpose_id
       and skeleton.key_generation = admission.key_generation
       and skeleton.identity_hmac_sha256 = admission.identity_hmac_sha256
       and skeleton.outcome_hmac_sha256 =
           admission.terminal_outcome_hmac_sha256
      join public.inbox_v2_source_processing_key_generations key
        on key.tenant_id = admission.tenant_id
       and key.purpose_id = admission.purpose_id
       and key.generation = admission.key_generation
       and key.secret_ref = admission.hmac_key_secret_ref
       and key.verify_until = skeleton.key_verify_until
     where admission.tenant_id = ${scope.tenantId}
       and admission.raw_event_id = ${scope.rawEventId}
       and admission.state = 'skeleton_handed_off'
     for share of admission, skeleton, key
  `;
}

type ClaimToken = Readonly<{
  rawToken: string;
  tokenHash: string;
  rawIngressTokenHash: string;
  attemptId: string;
}>;

type ClaimRow = Record<string, unknown> & {
  claim_ordinal: unknown;
};

type WorkLockRow = Record<string, unknown> & {
  db_now: unknown;
};

export class InboxV2SourceProcessingPersistenceInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InboxV2SourceProcessingPersistenceInvariantError";
  }
}

export function createSqlInboxV2SourceProcessingRuntimeRepository(
  executor: InboxV2SourceProcessingTransactionExecutor | HuleeDatabase,
  options: CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions
): InboxV2SourceProcessingRuntimeRepositoryPort &
  InboxV2SourceCursorDurableTargetResolverPort {
  const transactionExecutor =
    executor as unknown as InboxV2SourceProcessingTransactionExecutor;
  assertOptions(options);
  const leaseTokenSource = options.leaseTokenSource ?? defaultLeaseTokenSource;
  const attemptIdSource = options.attemptIdSource ?? defaultAttemptIdSource;
  const replayEpisodeIdSource =
    options.replayEpisodeIdSource ?? defaultReplayEpisodeIdSource;
  const retentionPolicy = parseRetentionPolicy(options.retentionPolicy);
  const terminalDedupeOptions = parseTerminalDedupeOptions(
    options.terminalDedupe
  );

  return Object.freeze({
    async claim(rawInput: InboxV2ClaimSourceProcessingRuntimeInput) {
      const input = parseClaimInput(rawInput);
      const tokens = createClaimTokens(
        leaseTokenSource,
        attemptIdSource,
        input.policy.maxClaimBatch
      );
      const preparedQuarantines = await prepareCompletedQuarantineRecoveries(
        transactionExecutor,
        {
          tenantId: input.tenantId,
          batchSize: input.policy.maxClaimBatch,
          retentionPolicy,
          deadLetterLifecycleResolver: options.deadLetterLifecycleResolver
        }
      );
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingAdmission(transaction, input.tenantId);
        await finalizePreparedQuarantineRecoveries(transaction, {
          recoveries: preparedQuarantines,
          retentionPolicy
        });
        await reconcileCompletedNormalizations(transaction, {
          tenantId: input.tenantId,
          batchSize: input.policy.maxClaimBatch,
          retentionPolicy
        });
        await reconcileSourceProcessingSuccessors(transaction, {
          tenantId: input.tenantId,
          batchSize: input.policy.maxClaimBatch,
          policy: input.policy
        });
        await reconcileMissingSourceProcessingBridge(transaction, {
          tenantId: input.tenantId,
          batchSize: input.policy.maxClaimBatch,
          policy: input.policy
        });
        const claimed = await transaction.execute<ClaimRow>(
          buildClaimInboxV2SourceProcessingSql(input, tokens)
        );
        if (claimed.rows.length > 0) {
          return mapClaimResult(input, tokens, claimed.rows);
        }
        const pressure = await transaction.execute<Record<string, unknown>>(
          buildClassifyInboxV2SourceBackpressureSql(input)
        );
        return mapEmptyOrBackpressured(pressure.rows);
      });
    },

    async applyOutcome(rawInput: InboxV2ApplySourceProcessingOutcomeInput) {
      const { leaseToken, outcome, deadLetterRecord } =
        parseApplyOutcomeInput(rawInput);
      const terminalDedupe = await prepareTerminalDedupeOutcome({
        executor: transactionExecutor,
        options: terminalDedupeOptions,
        outcome,
        deadLetterRecord
      });
      const terminalOutcome =
        outcome.kind === "retry_scheduled" ? null : outcome;
      const tokenHash =
        calculateInboxV2SourceProcessingLeaseTokenHash(leaseToken);
      return runTransaction(transactionExecutor, async (transaction) => {
        if (
          terminalDedupe.kind === "aggregate_pending" ||
          terminalDedupe.kind === "prepared"
        ) {
          if (terminalOutcome === null) {
            throw invariantError(
              "Retry outcome unexpectedly acquired terminal dedupe state."
            );
          }
          await revalidatePendingTerminalDedupeAggregate(
            transaction,
            terminalOutcome,
            terminalDedupe
          );
        }
        const locked = await lockAndClassifyOutcome(
          transaction,
          outcome,
          tokenHash,
          deadLetterRecord
        );
        if (locked.kind === "result") {
          if (locked.result.outcome === "already_applied") {
            if (terminalDedupe.kind === "prepared") {
              if (terminalOutcome === null) {
                throw invariantError(
                  "Retry outcome unexpectedly prepared a terminal skeleton."
                );
              }
              await persistTerminalDedupeInTransaction(transaction, {
                outcome: terminalOutcome,
                preparation: terminalDedupe
              });
            } else if (terminalDedupe.kind === "already_handed_off") {
              if (terminalOutcome === null) {
                throw invariantError(
                  "Retry outcome unexpectedly observed terminal handoff."
                );
              }
              await assertTerminalDedupeAlreadyApplied(
                transaction,
                terminalOutcome
              );
            }
          }
          return locked.result;
        }
        if (terminalDedupe.kind === "already_handed_off") {
          if (terminalOutcome === null) {
            throw invariantError(
              "Retry outcome unexpectedly observed terminal handoff."
            );
          }
          const dominantOutcome = await assertTerminalDedupeAlreadyApplied(
            transaction,
            terminalOutcome
          );
          if (dominantOutcome !== "dead_lettered") {
            throw invariantError(
              "Only a dominant dead-letter aggregate may precede a sibling outcome."
            );
          }
        }
        const applied = await transaction.execute<Record<string, unknown>>(
          buildApplyInboxV2SourceProcessingOutcomeSql({
            outcome,
            tokenHash,
            dbNow: locked.dbNow,
            processingGeneration: locked.processingGeneration,
            retentionPolicy,
            deadLetterRecord
          })
        );
        exactlyOneRow(applied.rows, "source-processing outcome application");
        if (terminalDedupe.kind === "prepared") {
          if (terminalOutcome === null) {
            throw invariantError(
              "Retry outcome unexpectedly prepared a terminal skeleton."
            );
          }
          await persistTerminalDedupeInTransaction(transaction, {
            outcome: terminalOutcome,
            preparation: terminalDedupe
          });
        }
        return { outcome: "applied" } as const;
      });
    },

    async requestReplay(rawRequest: InboxV2SourceReplayRequest) {
      const request = inboxV2SourceReplayRequestSchema.parse(rawRequest);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingAdmission(
          transaction,
          request.target.scope.tenantId
        );
        const authorization = parseReplayAuthorizationDecision(
          await options.replayAuthorization.authorizeReplay(request)
        );
        if (authorization.outcome === "denied") {
          return persistReplayAuthorizationDenial(
            transaction,
            request,
            authorization,
            retentionPolicy
          );
        }
        return requestReplay(
          transaction,
          request,
          replayEpisodeIdSource,
          retentionPolicy
        );
      });
    },

    async acknowledgeCursor(rawInput: InboxV2SourceCursorPersistenceInput) {
      const input = parseCursorPersistenceInput(rawInput);
      const source = cursorTargetSource(input.acknowledgement.target);
      const durable = await runTransaction(
        transactionExecutor,
        async (transaction) => {
          await lockSourceProcessingLifecycle(transaction, source.tenantId);
          return validateCursorDurableWork(transaction, input);
        }
      );
      if (durable !== null) return durable;
      const protection = inboxV2SourceCursorProtectionSchema.parse(
        await options.cryptographicAuthority.protectCursor(input)
      );
      if (protection.tenantId !== source.tenantId) {
        throw invariantError("Cursor protection escaped its tenant scope.");
      }
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, source.tenantId);
        return acknowledgeCursor(transaction, input, protection);
      });
    },

    async resolveCursorDurableTarget(
      rawInput: InboxV2SourceCursorDurableTargetLookupInput
    ) {
      const input =
        inboxV2SourceCursorDurableTargetLookupInputSchema.parse(rawInput);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.source.tenantId);
        return resolveCursorDurableTarget(transaction, input);
      });
    },

    async loadCursor(rawInput: InboxV2SourceCursorLoadInput) {
      const input = inboxV2SourceCursorLoadInputSchema.parse(rawInput);
      const loaded = await runTransaction(
        transactionExecutor,
        async (transaction) => {
          await lockSourceProcessingLifecycle(
            transaction,
            input.source.tenantId
          );
          return loadCursorProtection(transaction, input);
        }
      );
      if (loaded.outcome !== "protected") return loaded.result;
      const cursor = await options.cryptographicAuthority.resolveCursor({
        source: input.source,
        protection: loaded.protection
      });
      if (cursor === null) {
        return inboxV2SourceCursorLoadResultSchema.parse({
          outcome: "integrity_failure"
        });
      }
      const parsedCursor = inboxV2SourceCursorPositionSchema.parse(cursor);
      if (parsedCursor.kind !== loaded.cursorKind) {
        return inboxV2SourceCursorLoadResultSchema.parse({
          outcome: "integrity_failure"
        });
      }
      return inboxV2SourceCursorLoadResultSchema.parse({
        outcome: "loaded",
        cursor: parsedCursor,
        routeGeneration: loaded.routeGeneration,
        checkpointRevision: loaded.checkpointRevision,
        acknowledgedAt: loaded.acknowledgedAt
      });
    },

    async writeDedupeSkeleton(rawInput: InboxV2SourceDedupeSkeletonWriteInput) {
      const input = parseDedupeSkeletonWriteInput(rawInput);
      const verification = inboxV2SourceDedupeHmacVerificationSchema.parse(
        await options.cryptographicAuthority.verifyDedupeSkeleton(input)
      );
      if (verification.outcome === "rejected") {
        return inboxV2SourceDedupeSkeletonWriteResultSchema.parse({
          outcome:
            verification.reason === "key_unavailable"
              ? "key_unavailable"
              : "conflict"
        });
      }
      if (verification.tenantId !== input.skeleton.source.tenantId) {
        return inboxV2SourceDedupeSkeletonWriteResultSchema.parse({
          outcome: "conflict"
        });
      }
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(
          transaction,
          input.skeleton.source.tenantId
        );
        return writeDedupeSkeleton(transaction, input, verification);
      });
    },

    async lookupDedupeSkeleton(
      rawInput: InboxV2SourceDedupeSkeletonLookupInput
    ) {
      const input = parseDedupeSkeletonLookupInput(rawInput);
      const derivation = inboxV2SourceDedupeIdentityCandidatesSchema.parse(
        await options.cryptographicAuthority.deriveDedupeIdentityCandidates(
          input
        )
      );
      if (derivation.outcome === "rejected") {
        return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
          outcome:
            derivation.reason === "key_unavailable"
              ? "key_unavailable"
              : "integrity_failure"
        });
      }
      if (!dedupeLookupDerivationMatches(input, derivation)) {
        return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
          outcome: "integrity_failure"
        });
      }
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.source.tenantId);
        return lookupDedupeSkeleton(transaction, input, derivation.candidates);
      });
    },

    async expireDedupeSkeleton(
      rawInput: InboxV2SourceDedupeSkeletonExpireInput
    ) {
      const input = parseDedupeSkeletonExpireInput(rawInput);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.tenantId);
        return expireDedupeSkeleton(transaction, input);
      });
    },

    async expireDedupeReplayability(
      rawInput: InboxV2SourceDedupeReplayabilityExpireInput
    ) {
      const input = parseDedupeReplayabilityExpireInput(rawInput);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.tenantId);
        return expireDedupeReplayability(transaction, input);
      });
    },

    async rotateProcessingKeyGeneration(
      rawInput: InboxV2SourceProcessingKeyRotationInput
    ) {
      const input = parseProcessingKeyRotationInput(rawInput);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.tenantId);
        return rotateProcessingKeyGeneration(transaction, input);
      });
    },

    async retireProcessingKeyGeneration(
      rawInput: InboxV2SourceProcessingKeyRetirementInput
    ) {
      const input = parseProcessingKeyRetirementInput(rawInput);
      return runTransaction(transactionExecutor, async (transaction) => {
        await lockSourceProcessingLifecycle(transaction, input.tenantId);
        return retireProcessingKeyGeneration(transaction, input);
      });
    }
  });
}

type ParsedClaimInput = InboxV2ClaimSourceProcessingRuntimeInput;

function parseClaimInput(input: unknown): ParsedClaimInput {
  return inboxV2ClaimSourceProcessingRuntimeInputSchema.parse(input);
}

export function buildReconcileMissingInboxV2SourceProcessingBridgeSql(input: {
  tenantId: string;
  batchSize: number;
  policy: InboxV2SourceBackpressurePolicy;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const batchSize = z.number().int().min(1).max(1_000).parse(input.batchSize);
  const policy = inboxV2SourceBackpressurePolicySchema.parse(input.policy);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    pressure_totals as materialized (
      select pressure.tenant_id, pressure.source_connection_id,
             sum(pressure.queued)::integer as connection_queued,
             (
               select coalesce(sum(tenant_pressure.queued), 0)::integer
                 from public.inbox_v2_source_account_pressure_heads
                      tenant_pressure
                where tenant_pressure.tenant_id = pressure.tenant_id
             ) as tenant_queued
        from public.inbox_v2_source_account_pressure_heads pressure
       where pressure.tenant_id = ${tenantId}
       group by pressure.tenant_id, pressure.source_connection_id
    ),
    missing_candidates as materialized (
      select raw_work.tenant_id, raw_work.raw_event_id,
             raw_work.available_at, raw_work.created_at,
             raw_work.updated_at, envelope.source_connection_id,
             envelope.source_account_id,
             envelope.source_account_scope_key,
             coalesce(account_pressure.queued, 0)::integer as account_queued,
             coalesce(totals.connection_queued, 0)::integer
               as connection_queued,
             coalesce(totals.tenant_queued, 0)::integer as tenant_queued,
             coalesce(account_pressure.updated_at, raw_work.created_at)
               as account_last_touched_at,
             row_number() over (
               partition by envelope.source_connection_id,
                            envelope.source_account_scope_key
               order by raw_work.available_at,
                        raw_work.raw_event_id collate "C"
             )::integer as account_candidate_ordinal,
             public.inbox_v2_src_runtime_route_generation(
               envelope.tenant_id, envelope.source_connection_id,
               envelope.source_account_id
             ) as route_generation,
             'srcwork:' || encode(sha256(convert_to(
               'source-processing-work:v1|' || envelope.tenant_id || chr(31) ||
               envelope.raw_event_id || chr(31) || '0:' || chr(31) ||
               'raw_ingest', 'UTF8')), 'hex') as raw_work_id,
             'srcwork:' || encode(sha256(convert_to(
               'source-processing-work:v1|' || envelope.tenant_id || chr(31) ||
               envelope.raw_event_id || chr(31) || '0:' || chr(31) ||
               'normalization', 'UTF8')), 'hex') as normalization_work_id
        from public.inbox_v2_source_raw_work_items raw_work
         join public.inbox_v2_source_raw_envelopes envelope
           on envelope.tenant_id = raw_work.tenant_id
          and envelope.raw_event_id = raw_work.raw_event_id
         left join public.inbox_v2_source_account_pressure_heads
              account_pressure
           on account_pressure.tenant_id = envelope.tenant_id
          and account_pressure.source_connection_id =
              envelope.source_connection_id
          and account_pressure.source_account_scope_key =
              envelope.source_account_scope_key
         left join pressure_totals totals
           on totals.tenant_id = envelope.tenant_id
          and totals.source_connection_id = envelope.source_connection_id
        where raw_work.tenant_id = ${tenantId}
         and public.inbox_v2_src_runtime_route_generation(
               envelope.tenant_id, envelope.source_connection_id,
               envelope.source_account_id
             ) is not null
         and not exists (
           select 1
             from public.inbox_v2_source_processing_work_heads work
            where work.tenant_id = raw_work.tenant_id
              and work.raw_event_id = raw_work.raw_event_id
               and work.stage = 'normalization'
          )
         and not exists (
           select 1
             from public.inbox_v2_source_account_pressure_heads
                  connection_fence
             cross join db_clock
            where connection_fence.tenant_id = envelope.tenant_id
              and connection_fence.source_connection_id =
                  envelope.source_connection_id
              and connection_fence.source_account_id is null
              and connection_fence.source_account_scope_key = '0:'
              and connection_fence.state = 'rate_limited'
              and connection_fence.rate_limit_reset_at > db_clock.db_now
         )
    ),
    account_admissible as materialized (
      select candidate.*
        from missing_candidates candidate
       where candidate.account_candidate_ordinal <= greatest(
         0, ${policy.maxQueuedPerAccount} - candidate.account_queued
       )
    ),
    capacity_ranked as materialized (
      select candidate.*,
             row_number() over (
               partition by candidate.source_connection_id
               order by candidate.account_candidate_ordinal,
                        candidate.account_last_touched_at,
                        candidate.source_account_scope_key collate "C",
                        candidate.available_at,
                        candidate.raw_event_id collate "C"
             )::integer as connection_candidate_ordinal,
             row_number() over (
               order by candidate.account_candidate_ordinal,
                        candidate.account_last_touched_at,
                        candidate.source_connection_id collate "C",
                        candidate.source_account_scope_key collate "C",
                        candidate.available_at,
                        candidate.raw_event_id collate "C"
             )::integer as tenant_candidate_ordinal
        from account_admissible candidate
    ),
    fair_candidates as materialized (
      select candidate.*
        from capacity_ranked candidate
       where candidate.connection_candidate_ordinal <= greatest(
         0, ${policy.maxQueuedPerConnection} - candidate.connection_queued
       )
         and candidate.tenant_candidate_ordinal <= greatest(
           0, ${policy.maxQueuedPerTenant} - candidate.tenant_queued
         )
       order by candidate.account_candidate_ordinal,
                candidate.account_last_touched_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.available_at,
                candidate.raw_event_id collate "C"
       limit ${batchSize}
    ),
    missing as materialized (
      select candidate.*
        from fair_candidates candidate
        join public.inbox_v2_source_raw_work_items raw_work
          on raw_work.tenant_id = candidate.tenant_id
         and raw_work.raw_event_id = candidate.raw_event_id
       order by candidate.account_candidate_ordinal,
                candidate.account_last_touched_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.available_at,
                candidate.raw_event_id collate "C"
       for update of raw_work skip locked
    ),
    work_inserted as materialized (
      insert into public.inbox_v2_source_processing_work_heads (
        tenant_id, work_id, raw_event_id, normalized_event_id,
        normalized_event_scope_key, stage, source_connection_id,
        source_account_id, source_account_scope_key, route_generation,
        state, processing_generation, available_at, max_attempts,
        attempt_count, lease_owner_id, lease_token_hash, lease_revision,
        lease_claimed_at, lease_expires_at, last_diagnostic_code_id,
        retryability, rate_limit_reset_at, dead_lettered_at, completed_at,
        revision, created_at, updated_at
      )
      select missing.tenant_id, missing.raw_work_id,
             missing.raw_event_id, null, '0:',
             'raw_ingest'::public.inbox_v2_source_processing_stage,
             missing.source_connection_id, missing.source_account_id,
             missing.source_account_scope_key, missing.route_generation,
             'processed'::public.inbox_v2_source_processing_work_state,
             1, missing.available_at,
             ${INBOX_V2_SOURCE_PROCESSING_MAX_ATTEMPTS}::integer, 0,
             null::text, null::text, null::bigint,
             null::timestamptz, null::timestamptz, null::text,
             null::public.inbox_v2_source_processing_retryability,
             null::timestamptz, null::timestamptz,
             missing.updated_at, 1, missing.created_at, missing.updated_at
        from missing
      union all
      select missing.tenant_id, missing.normalization_work_id,
             missing.raw_event_id, null, '0:',
             'normalization'::public.inbox_v2_source_processing_stage,
             missing.source_connection_id, missing.source_account_id,
              missing.source_account_scope_key, missing.route_generation,
              'pending'::public.inbox_v2_source_processing_work_state,
              1, missing.available_at,
              ${policy.maxAttempts}::integer, 0,
             null, null, null, null, null, null, null, null, null, null,
             1, missing.created_at, missing.updated_at
        from missing
      on conflict (tenant_id, work_id) do nothing
      returning tenant_id, raw_event_id, stage::text as stage,
                source_connection_id, source_account_id,
                source_account_scope_key, created_at, updated_at
    ),
    normalization_inserted as materialized (
      select * from work_inserted where stage = 'normalization'
    ),
    pressure_inserted as materialized (
      insert into public.inbox_v2_source_account_pressure_heads (
        tenant_id, source_connection_id, source_account_id,
        source_account_scope_key, state, max_in_flight, in_flight,
        max_queued, queued, consecutive_failure_count, backoff_until,
        rate_limit_reset_at, last_diagnostic_code_id, revision,
        created_at, updated_at
      )
       select inserted.tenant_id, inserted.source_connection_id,
              inserted.source_account_id, inserted.source_account_scope_key,
              'open', ${policy.maxInFlightPerAccount}, 0,
              ${policy.maxQueuedPerAccount}, count(*)::integer, 0,
              null, null, null, 1, max(inserted.updated_at),
              max(inserted.updated_at)
        from normalization_inserted inserted
       group by inserted.tenant_id, inserted.source_connection_id,
                inserted.source_account_id,
                inserted.source_account_scope_key
      on conflict (tenant_id, source_connection_id,
                   source_account_scope_key) do update
        set max_in_flight = greatest(
              ${policy.maxInFlightPerAccount},
              inbox_v2_source_account_pressure_heads.in_flight
            ),
            max_queued = greatest(
              ${policy.maxQueuedPerAccount},
              inbox_v2_source_account_pressure_heads.queued + excluded.queued
            ),
            queued = inbox_v2_source_account_pressure_heads.queued
                     + excluded.queued,
            revision = inbox_v2_source_account_pressure_heads.revision + 1,
            updated_at = greatest(
              excluded.updated_at,
              inbox_v2_source_account_pressure_heads.updated_at
                + interval '1 millisecond'
            )
      returning tenant_id, source_connection_id, source_account_scope_key
    )
    select inserted.tenant_id, inserted.raw_event_id
      from normalization_inserted inserted
      join pressure_inserted pressure
        on pressure.tenant_id = inserted.tenant_id
       and pressure.source_connection_id = inserted.source_connection_id
       and pressure.source_account_scope_key =
           inserted.source_account_scope_key
     order by inserted.raw_event_id collate "C"
  `;
}

async function reconcileMissingSourceProcessingBridge(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    batchSize: number;
    policy: InboxV2SourceBackpressurePolicy;
  }>
): Promise<void> {
  const result = await executor.execute<Record<string, unknown>>(
    buildReconcileMissingInboxV2SourceProcessingBridgeSql(input)
  );
  if (result.rows.length > input.batchSize) {
    throw invariantError(
      "Source-processing bridge reconciliation exceeded its batch."
    );
  }
}

export function buildReconcileInboxV2SourceProcessingSuccessorsSql(input: {
  tenantId: string;
  batchSize: number;
  policy: InboxV2SourceBackpressurePolicy;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const batchSize = z.number().int().min(1).max(1_000).parse(input.batchSize);
  const policy = inboxV2SourceBackpressurePolicySchema.parse(input.policy);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    tenant_pressure_totals as materialized (
      select coalesce(sum(pressure.queued), 0)::integer as tenant_queued
        from public.inbox_v2_source_account_pressure_heads pressure
       where pressure.tenant_id = ${tenantId}
    ),
    connection_pressure_totals as materialized (
      select pressure.source_connection_id,
             sum(pressure.queued)::integer as connection_queued
        from public.inbox_v2_source_account_pressure_heads pressure
       where pressure.tenant_id = ${tenantId}
       group by pressure.source_connection_id
    ),
    predecessor_candidates as materialized (
      select predecessor.tenant_id, predecessor.work_id as predecessor_work_id,
             predecessor.raw_event_id, envelope.normalized_event_id,
             '1:' || octet_length(envelope.normalized_event_id)::text || ':' ||
               envelope.normalized_event_id as normalized_event_scope_key,
             'identity_resolution'::text as successor_stage,
             predecessor.source_connection_id,
             predecessor.source_account_id,
             predecessor.source_account_scope_key,
             predecessor.completed_at as available_at,
             predecessor.updated_at as predecessor_updated_at
        from public.inbox_v2_source_processing_work_heads predecessor
        join public.inbox_v2_source_normalization_results result
          on result.tenant_id = predecessor.tenant_id
         and result.raw_event_id = predecessor.raw_event_id
         and result.outcome = 'normalized'
        join public.inbox_v2_source_processing_attempts attempt
          on attempt.tenant_id = predecessor.tenant_id
         and attempt.work_id = predecessor.work_id
         and attempt.processing_generation =
             predecessor.processing_generation
         and attempt.attempt_number = result.completed_attempt_count
         and attempt.outcome = 'processed'
         and attempt.worker_id = result.worker_id
         and attempt.lease_claimed_at = result.completed_lease_claimed_at
         and attempt.lease_expires_at = result.completed_lease_expires_at
         and attempt.finished_at = predecessor.completed_at
        join public.inbox_v2_source_normalized_envelopes envelope
          on envelope.tenant_id = predecessor.tenant_id
         and envelope.raw_event_id = predecessor.raw_event_id
         and envelope.source_connection_id =
             predecessor.source_connection_id
         and envelope.source_account_id is not distinct from
             predecessor.source_account_id
         and envelope.source_account_scope_key =
             predecessor.source_account_scope_key
       where predecessor.tenant_id = ${tenantId}
         and predecessor.stage = 'normalization'
         and predecessor.state = 'processed'
         and predecessor.normalized_event_id is null
         and predecessor.completed_at >= result.completed_at
      union all
      select predecessor.tenant_id, predecessor.work_id,
             predecessor.raw_event_id, predecessor.normalized_event_id,
             predecessor.normalized_event_scope_key,
             stage_flow.successor_stage,
             predecessor.source_connection_id,
             predecessor.source_account_id,
             predecessor.source_account_scope_key,
             predecessor.completed_at,
             predecessor.updated_at
        from public.inbox_v2_source_processing_work_heads predecessor
        join (values
          ('identity_resolution', 'conversation_resolution'),
          ('conversation_resolution', 'routing'),
          ('routing', 'message_reconciliation'),
          ('message_reconciliation', 'materialization')
        ) as stage_flow(predecessor_stage, successor_stage)
          on predecessor.stage::text = stage_flow.predecessor_stage
       where predecessor.tenant_id = ${tenantId}
         and predecessor.state = 'processed'
         and predecessor.normalized_event_id is not null
         and predecessor.completed_at is not null
    ),
    missing_candidates as materialized (
      select candidate.*,
             route.route_generation,
             coalesce(account_pressure.queued, 0)::integer as account_queued,
             coalesce(connection_totals.connection_queued, 0)::integer
               as connection_queued,
             tenant_totals.tenant_queued,
             coalesce(
               account_pressure.updated_at,
               candidate.predecessor_updated_at
             ) as account_last_touched_at,
             row_number() over (
               partition by candidate.source_connection_id,
                            candidate.source_account_scope_key
               order by candidate.available_at,
                        candidate.raw_event_id collate "C",
                        candidate.normalized_event_id collate "C",
                        candidate.successor_stage collate "C"
             )::integer as account_candidate_ordinal,
             'srcwork:' || encode(sha256(convert_to(
               'source-processing-work:v1|' || candidate.tenant_id || chr(31) ||
               candidate.raw_event_id || chr(31) ||
               candidate.normalized_event_scope_key || chr(31) ||
               candidate.successor_stage, 'UTF8')), 'hex') as successor_work_id
        from predecessor_candidates candidate
        cross join tenant_pressure_totals tenant_totals
        cross join lateral (
          select public.inbox_v2_src_runtime_route_generation(
            candidate.tenant_id, candidate.source_connection_id,
            candidate.source_account_id
          ) as route_generation
        ) route
        left join connection_pressure_totals connection_totals
          on connection_totals.source_connection_id =
             candidate.source_connection_id
        left join public.inbox_v2_source_account_pressure_heads
             account_pressure
          on account_pressure.tenant_id = candidate.tenant_id
         and account_pressure.source_connection_id =
             candidate.source_connection_id
         and account_pressure.source_account_scope_key =
             candidate.source_account_scope_key
       where route.route_generation is not null
         and not exists (
           select 1
             from public.inbox_v2_source_processing_work_heads successor
            where successor.tenant_id = candidate.tenant_id
              and successor.raw_event_id = candidate.raw_event_id
              and successor.normalized_event_scope_key =
                  candidate.normalized_event_scope_key
              and successor.stage::text = candidate.successor_stage
         )
         and not exists (
           select 1
             from public.inbox_v2_source_account_pressure_heads
                  connection_fence
             cross join db_clock
            where connection_fence.tenant_id = candidate.tenant_id
              and connection_fence.source_connection_id =
                  candidate.source_connection_id
              and connection_fence.source_account_id is null
              and connection_fence.source_account_scope_key = '0:'
              and connection_fence.state = 'rate_limited'
              and connection_fence.rate_limit_reset_at > db_clock.db_now
         )
    ),
    account_admissible as materialized (
      select candidate.*
        from missing_candidates candidate
       where candidate.account_candidate_ordinal <= greatest(
         0, ${policy.maxQueuedPerAccount} - candidate.account_queued
       )
    ),
    capacity_ranked as materialized (
      select candidate.*,
             row_number() over (
               partition by candidate.source_connection_id
               order by candidate.account_candidate_ordinal,
                        candidate.account_last_touched_at,
                        candidate.source_account_scope_key collate "C",
                        candidate.available_at,
                        candidate.raw_event_id collate "C",
                        candidate.normalized_event_id collate "C",
                        candidate.successor_stage collate "C"
             )::integer as connection_candidate_ordinal,
             row_number() over (
               order by candidate.account_candidate_ordinal,
                        candidate.account_last_touched_at,
                        candidate.source_connection_id collate "C",
                        candidate.source_account_scope_key collate "C",
                        candidate.available_at,
                        candidate.raw_event_id collate "C",
                        candidate.normalized_event_id collate "C",
                        candidate.successor_stage collate "C"
             )::integer as tenant_candidate_ordinal
        from account_admissible candidate
    ),
    fair_candidates as materialized (
      select candidate.*
        from capacity_ranked candidate
       where candidate.connection_candidate_ordinal <= greatest(
         0, ${policy.maxQueuedPerConnection} - candidate.connection_queued
       )
         and candidate.tenant_candidate_ordinal <= greatest(
           0, ${policy.maxQueuedPerTenant} - candidate.tenant_queued
         )
       order by candidate.account_candidate_ordinal,
                candidate.account_last_touched_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.available_at,
                candidate.raw_event_id collate "C",
                candidate.normalized_event_id collate "C",
                candidate.successor_stage collate "C"
       limit ${batchSize}
    ),
    locked_candidates as materialized (
      select candidate.*
        from fair_candidates candidate
        join public.inbox_v2_source_processing_work_heads predecessor
          on predecessor.tenant_id = candidate.tenant_id
         and predecessor.work_id = candidate.predecessor_work_id
         and predecessor.state = 'processed'
       order by candidate.account_candidate_ordinal,
                candidate.account_last_touched_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.available_at,
                candidate.raw_event_id collate "C",
                candidate.normalized_event_id collate "C",
                candidate.successor_stage collate "C"
       for update of predecessor skip locked
    ),
    work_inserted as materialized (
      insert into public.inbox_v2_source_processing_work_heads (
        tenant_id, work_id, raw_event_id, normalized_event_id,
        normalized_event_scope_key, stage, source_connection_id,
        source_account_id, source_account_scope_key, route_generation,
        state, processing_generation, available_at, max_attempts,
        attempt_count, lease_owner_id, lease_token_hash, lease_revision,
        lease_claimed_at, lease_expires_at, last_diagnostic_code_id,
        retryability, rate_limit_reset_at, dead_lettered_at, completed_at,
        revision, created_at, updated_at
      )
      select candidate.tenant_id, candidate.successor_work_id,
             candidate.raw_event_id, candidate.normalized_event_id,
             candidate.normalized_event_scope_key,
             candidate.successor_stage::
               public.inbox_v2_source_processing_stage,
             candidate.source_connection_id, candidate.source_account_id,
             candidate.source_account_scope_key,
             candidate.route_generation,
             'pending', 1, candidate.available_at, ${policy.maxAttempts}, 0,
             null, null, null, null, null, null, null, null, null, null,
             1, candidate.available_at, candidate.available_at
        from locked_candidates candidate
      on conflict do nothing
      returning tenant_id, work_id, raw_event_id, source_connection_id,
                source_account_id, source_account_scope_key,
                created_at, updated_at
    ),
    pressure_inserted as materialized (
      insert into public.inbox_v2_source_account_pressure_heads (
        tenant_id, source_connection_id, source_account_id,
        source_account_scope_key, state, max_in_flight, in_flight,
        max_queued, queued, consecutive_failure_count, backoff_until,
        rate_limit_reset_at, last_diagnostic_code_id, revision,
        created_at, updated_at
      )
      select inserted.tenant_id, inserted.source_connection_id,
             inserted.source_account_id, inserted.source_account_scope_key,
             'open', ${policy.maxInFlightPerAccount}, 0,
             ${policy.maxQueuedPerAccount}, count(*)::integer, 0,
             null, null, null, 1, max(inserted.created_at),
             max(inserted.updated_at)
        from work_inserted inserted
       group by inserted.tenant_id, inserted.source_connection_id,
                inserted.source_account_id,
                inserted.source_account_scope_key
      on conflict (tenant_id, source_connection_id,
                   source_account_scope_key) do update
        set max_in_flight = greatest(
              ${policy.maxInFlightPerAccount},
              inbox_v2_source_account_pressure_heads.in_flight
            ),
            max_queued = greatest(
              ${policy.maxQueuedPerAccount},
              inbox_v2_source_account_pressure_heads.queued + excluded.queued
            ),
            queued = inbox_v2_source_account_pressure_heads.queued
                     + excluded.queued,
            revision = inbox_v2_source_account_pressure_heads.revision + 1,
            updated_at = greatest(
              excluded.updated_at,
              inbox_v2_source_account_pressure_heads.updated_at
                + interval '1 millisecond'
            )
      returning tenant_id, source_connection_id, source_account_scope_key
    )
    select inserted.tenant_id, inserted.work_id, inserted.raw_event_id
      from work_inserted inserted
      join pressure_inserted pressure
        on pressure.tenant_id = inserted.tenant_id
       and pressure.source_connection_id = inserted.source_connection_id
       and pressure.source_account_scope_key =
           inserted.source_account_scope_key
     order by inserted.work_id collate "C"
  `;
}

async function reconcileSourceProcessingSuccessors(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    batchSize: number;
    policy: InboxV2SourceBackpressurePolicy;
  }>
): Promise<void> {
  const result = await executor.execute<Record<string, unknown>>(
    buildReconcileInboxV2SourceProcessingSuccessorsSql(input)
  );
  if (result.rows.length > input.batchSize) {
    throw invariantError(
      "Source-processing successor reconciliation exceeded its batch."
    );
  }
}

export function buildClaimInboxV2SourceProcessingSql(
  rawInput: ParsedClaimInput,
  tokens: readonly ClaimToken[]
): SQL {
  const input = parseClaimInput(rawInput);
  if (
    tokens.length !== input.policy.maxClaimBatch ||
    new Set(tokens.map((token) => token.rawToken)).size !== tokens.length ||
    new Set(tokens.map((token) => token.tokenHash)).size !== tokens.length ||
    new Set(tokens.map((token) => token.rawIngressTokenHash)).size !==
      tokens.length ||
    new Set(tokens.map((token) => token.attemptId)).size !== tokens.length
  ) {
    throw invariantError(
      "Source-processing claim requires unique capability material per ordinal."
    );
  }
  const claimMaterials = JSON.stringify(
    tokens.map((token, index) => ({
      claim_ordinal: index + 1,
      attempt_id: token.attemptId,
      token_hash: token.tokenHash,
      raw_ingress_token_hash: token.rawIngressTokenHash
    }))
  );
  const policy = input.policy;

  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    pressure_totals as materialized (
      select pressure.tenant_id,
             pressure.source_connection_id,
             sum(pressure.in_flight)::integer as connection_in_flight,
             (
               select sum(tenant_pressure.in_flight)::integer
                 from public.inbox_v2_source_account_pressure_heads
                      tenant_pressure
                where tenant_pressure.tenant_id = pressure.tenant_id
             ) as tenant_in_flight
        from public.inbox_v2_source_account_pressure_heads pressure
       where pressure.tenant_id = ${input.tenantId}
       group by pressure.tenant_id, pressure.source_connection_id
    ),
    due_candidates as materialized (
      select work.tenant_id, work.work_id, work.raw_event_id,
             work.normalized_event_id, work.stage::text as stage,
             work.source_connection_id, work.source_account_id,
             work.source_account_scope_key, work.route_generation,
             work.state::text as previous_state,
             work.processing_generation,
             work.attempt_count as previous_attempt_count,
             work.max_attempts, work.revision as previous_revision,
             work.lease_owner_id as previous_lease_owner_id,
             work.lease_token_hash as previous_lease_token_hash,
             work.lease_revision as previous_lease_revision,
             work.lease_claimed_at as previous_lease_claimed_at,
             work.lease_expires_at as previous_lease_expires_at,
             pressure.max_in_flight as stored_max_in_flight,
             pressure.in_flight, pressure.queued,
             coalesce(totals.connection_in_flight, 0) as connection_in_flight,
             coalesce(totals.tenant_in_flight, 0) as tenant_in_flight,
             db_clock.db_now,
             case when work.state = 'leased' then work.lease_expires_at
                  else work.available_at end as due_at,
             case when (work.attempt_count + case
                         when work.state = 'leased' then 0 else 1 end) = 1
                       and work.processing_generation = 1 then 'initial'
                  when (work.attempt_count + case
                         when work.state = 'leased' then 0 else 1 end) = 1
                    then 'replay'
                  else 'retry' end as attempt_origin,
             replay.id as replay_request_id,
             row_number() over (
               partition by work.source_connection_id,
                            work.source_account_scope_key
               order by case when work.state = 'leased'
                              then work.lease_expires_at
                              else work.available_at end asc,
                        work.raw_event_id collate "C" asc,
                        work.stage::text collate "C" asc,
                        work.work_id collate "C" asc
             )::integer as account_claim_ordinal
        from public.inbox_v2_source_processing_work_heads work
        join public.inbox_v2_source_account_pressure_heads pressure
          on pressure.tenant_id = work.tenant_id
         and pressure.source_connection_id = work.source_connection_id
         and pressure.source_account_scope_key = work.source_account_scope_key
        left join pressure_totals totals
          on totals.tenant_id = work.tenant_id
         and totals.source_connection_id = work.source_connection_id
        left join lateral (
          select replay_request.id
            from public.inbox_v2_source_replay_requests replay_request
           where replay_request.tenant_id = work.tenant_id
             and replay_request.state = 'applied'
             and replay_request.result_work_id = work.work_id
             and replay_request.result_processing_generation =
                 work.processing_generation
           order by replay_request.completed_at desc,
                    replay_request.id collate "C" asc
           limit 1
        ) replay on true
        cross join db_clock
       where work.tenant_id = ${input.tenantId}
         and (
           (work.state in ('pending', 'retry_scheduled')
             and work.attempt_count < work.max_attempts
             and work.available_at <= db_clock.db_now)
           or (work.state = 'leased'
             and work.lease_expires_at <= db_clock.db_now
             and not exists (
               select 1
                 from public.inbox_v2_source_processing_attempts attempt
                where attempt.tenant_id = work.tenant_id
                  and attempt.work_id = work.work_id
                  and attempt.processing_generation =
                      work.processing_generation
                  and attempt.attempt_number = work.attempt_count
             ))
         )
          and (
            pressure.state = 'open'
            or pressure.backoff_until <= db_clock.db_now
            or pressure.rate_limit_reset_at <= db_clock.db_now
          )
          and not exists (
            select 1
              from public.inbox_v2_source_account_pressure_heads
                   connection_fence
             where connection_fence.tenant_id = work.tenant_id
               and connection_fence.source_connection_id =
                   work.source_connection_id
               and connection_fence.source_account_id is null
               and connection_fence.source_account_scope_key = '0:'
               and connection_fence.state = 'rate_limited'
               and connection_fence.rate_limit_reset_at > db_clock.db_now
          )
         and (work.processing_generation = 1
           or work.attempt_count > 0
           or replay.id is not null)
    ),
    capacity_ranked as materialized (
      select candidate.*,
             sum(case when candidate.previous_state = 'leased'
                      then 0 else 1 end) over (
               partition by candidate.source_connection_id,
                            candidate.source_account_scope_key
               order by candidate.account_claim_ordinal,
                        candidate.due_at,
                        candidate.work_id collate "C"
             )::integer as account_new_ordinal,
             sum(case when candidate.previous_state = 'leased'
                      then 0 else 1 end) over (
               partition by candidate.source_connection_id
               order by candidate.account_claim_ordinal,
                        candidate.due_at,
                        candidate.source_account_scope_key collate "C",
                        candidate.work_id collate "C"
             )::integer as connection_new_ordinal,
             sum(case when candidate.previous_state = 'leased'
                      then 0 else 1 end) over (
               order by candidate.account_claim_ordinal,
                        candidate.due_at,
                        candidate.source_connection_id collate "C",
                        candidate.source_account_scope_key collate "C",
                        candidate.work_id collate "C"
             )::integer as tenant_new_ordinal
        from due_candidates candidate
    ),
    fair_candidates as materialized (
      select *
        from capacity_ranked candidate
       where candidate.previous_state = 'leased'
          or (
            candidate.queued > 0
            and candidate.account_new_ordinal <= greatest(
              0,
              least(candidate.stored_max_in_flight,
                    ${policy.maxInFlightPerAccount}) - candidate.in_flight
            )
            and candidate.connection_new_ordinal <= greatest(
              0, ${policy.maxInFlightPerConnection}
                   - candidate.connection_in_flight
            )
            and candidate.tenant_new_ordinal <= greatest(
              0, ${policy.maxInFlightPerTenant} - candidate.tenant_in_flight
            )
          )
       order by candidate.account_claim_ordinal,
                candidate.due_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.work_id collate "C"
       limit ${policy.maxClaimBatch}
    ),
    locked_runtime as materialized (
      select candidate.*
        from fair_candidates candidate
        join public.inbox_v2_source_processing_work_heads work
          on work.tenant_id = candidate.tenant_id
         and work.work_id = candidate.work_id
       where work.revision = candidate.previous_revision
         and (
           (work.state in ('pending', 'retry_scheduled')
             and work.attempt_count < work.max_attempts
             and work.available_at <= candidate.db_now)
           or (work.state = 'leased'
             and work.lease_expires_at <= candidate.db_now
             and not exists (
               select 1
                 from public.inbox_v2_source_processing_attempts attempt
                where attempt.tenant_id = work.tenant_id
                  and attempt.work_id = work.work_id
                  and attempt.processing_generation =
                      work.processing_generation
                  and attempt.attempt_number = work.attempt_count
             ))
         )
       order by candidate.account_claim_ordinal,
                candidate.due_at,
                candidate.source_connection_id collate "C",
                candidate.source_account_scope_key collate "C",
                candidate.work_id collate "C"
       for update of work skip locked
    ),
    locked_raw as materialized (
      select runtime.work_id, raw_work.tenant_id, raw_work.raw_event_id,
             raw_work.state::text as previous_raw_state,
             raw_work.attempt_count as previous_raw_attempt_count,
             raw_work.lease_owner_id as previous_raw_lease_owner_id,
             raw_work.lease_token_hash as previous_raw_lease_token_hash,
             raw_work.lease_revision as previous_raw_lease_revision,
             raw_work.lease_claimed_at as previous_raw_lease_claimed_at,
             raw_work.lease_expires_at as previous_raw_lease_expires_at,
             raw_work.reclaim_count as previous_raw_reclaim_count,
             raw_work.revision as previous_raw_revision
        from locked_runtime runtime
        join public.inbox_v2_source_raw_work_items raw_work
          on runtime.stage = 'normalization'
         and raw_work.tenant_id = runtime.tenant_id
         and raw_work.raw_event_id = runtime.raw_event_id
       where (raw_work.state = 'pending'
               and raw_work.available_at <= runtime.db_now)
          or (raw_work.state = 'leased'
               and raw_work.lease_expires_at <= runtime.db_now)
       order by runtime.account_claim_ordinal, runtime.due_at,
                runtime.work_id collate "C"
       for update of raw_work skip locked
    ),
    bridge_eligible as materialized (
      select runtime.*
        from locked_runtime runtime
       where runtime.stage <> 'normalization'
          or exists (
            select 1 from locked_raw raw
             where raw.work_id = runtime.work_id
          )
    ),
    ranked_claims as materialized (
      select eligible.*,
             row_number() over (
               order by eligible.account_claim_ordinal,
                        eligible.due_at,
                        eligible.source_connection_id collate "C",
                        eligible.source_account_scope_key collate "C",
                        eligible.work_id collate "C"
             )::integer as claim_ordinal
        from bridge_eligible eligible
    ),
    claim_materials as materialized (
      select material.claim_ordinal, material.attempt_id,
             material.token_hash, material.raw_ingress_token_hash
        from jsonb_to_recordset(${claimMaterials}::jsonb)
          as material(
            claim_ordinal integer,
            attempt_id text,
            token_hash text,
            raw_ingress_token_hash text
          )
    ),
    runtime_claimed as materialized (
      update public.inbox_v2_source_processing_work_heads work
         set state = 'leased',
             attempt_count = work.attempt_count + case
               when claim.previous_state = 'leased' then 0 else 1 end,
             lease_owner_id = ${input.workerId},
             lease_token_hash = material.token_hash,
             lease_revision = work.revision + 1,
             lease_claimed_at = claim.db_now,
             lease_expires_at = claim.db_now
               + make_interval(secs => ${input.leaseDurationSeconds}),
             revision = work.revision + 1,
             updated_at = claim.db_now
        from ranked_claims claim
        join claim_materials material
          on material.claim_ordinal = claim.claim_ordinal
       where work.tenant_id = claim.tenant_id
         and work.work_id = claim.work_id
         and work.revision = claim.previous_revision
      returning ${runtimeClaimReturningColumns()},
                claim.previous_state, claim.previous_attempt_count::text,
                claim.previous_lease_owner_id,
                claim.previous_lease_revision::text,
                claim.previous_lease_claimed_at,
                claim.previous_lease_expires_at,
                claim.attempt_origin, claim.replay_request_id,
                claim.db_now, claim.claim_ordinal, material.attempt_id
    ),
    raw_claimed as materialized (
      update public.inbox_v2_source_raw_work_items raw_work
         set state = 'leased',
             attempt_count = raw_work.attempt_count + 1,
             lease_owner_id = ${input.workerId},
             lease_token_hash = material.raw_ingress_token_hash,
             lease_revision = raw_work.revision + 1,
             lease_claimed_at = runtime.db_now,
             lease_expires_at = runtime.db_now
               + make_interval(secs => ${input.leaseDurationSeconds}),
             reclaim_count = raw_work.reclaim_count + case
               when locked.previous_raw_state = 'leased' then 1 else 0 end,
             last_reclaimed_at = case
               when locked.previous_raw_state = 'leased'
                 then runtime.db_now else raw_work.last_reclaimed_at end,
             last_reclaimed_from_expires_at = case
               when locked.previous_raw_state = 'leased'
                 then locked.previous_raw_lease_expires_at
                 else raw_work.last_reclaimed_from_expires_at end,
             last_reclaimed_lease_owner_id = case
               when locked.previous_raw_state = 'leased'
                 then locked.previous_raw_lease_owner_id
                 else raw_work.last_reclaimed_lease_owner_id end,
             last_reclaimed_lease_token_hash = case
               when locked.previous_raw_state = 'leased'
                 then locked.previous_raw_lease_token_hash
                 else raw_work.last_reclaimed_lease_token_hash end,
             last_reclaimed_lease_revision = case
               when locked.previous_raw_state = 'leased'
                 then locked.previous_raw_lease_revision
                 else raw_work.last_reclaimed_lease_revision end,
             revision = raw_work.revision + 1,
             updated_at = runtime.db_now
        from runtime_claimed runtime
        join locked_raw locked on locked.work_id = runtime.work_id
        join claim_materials material
          on material.claim_ordinal = runtime.claim_ordinal
       where runtime.stage = 'normalization'
         and raw_work.tenant_id = locked.tenant_id
         and raw_work.raw_event_id = locked.raw_event_id
         and raw_work.revision = locked.previous_raw_revision
      returning raw_work.tenant_id, raw_work.raw_event_id,
                raw_work.attempt_count::text as raw_attempt_count,
                raw_work.lease_owner_id as raw_lease_owner_id,
                raw_work.lease_token_hash as raw_lease_token_hash,
                raw_work.lease_revision::text as raw_lease_revision,
                raw_work.lease_claimed_at as raw_lease_claimed_at,
                raw_work.lease_expires_at as raw_lease_expires_at,
                raw_work.revision::text as raw_revision,
                raw_work.updated_at as raw_updated_at,
                runtime.work_id,
                locked.previous_raw_state,
                locked.previous_raw_lease_owner_id,
                locked.previous_raw_lease_revision::text,
                locked.previous_raw_lease_claimed_at,
                locked.previous_raw_lease_expires_at
    ),
    pressure_deltas as materialized (
      select runtime.tenant_id, runtime.source_connection_id,
             runtime.source_account_scope_key,
             count(*) filter (
               where runtime.previous_state <> 'leased'
             )::integer as newly_in_flight
        from runtime_claimed runtime
       group by runtime.tenant_id, runtime.source_connection_id,
                runtime.source_account_scope_key
    ),
    pressure_updated as (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = 'open',
             in_flight = pressure.in_flight + delta.newly_in_flight,
             queued = pressure.queued - delta.newly_in_flight,
             backoff_until = null, rate_limit_reset_at = null,
             revision = pressure.revision + 1,
             updated_at = (select db_now from db_clock)
        from pressure_deltas delta
       where pressure.tenant_id = delta.tenant_id
         and pressure.source_connection_id = delta.source_connection_id
         and pressure.source_account_scope_key =
             delta.source_account_scope_key
      returning pressure.tenant_id
    )
    select runtime.*,
           raw_claimed.previous_raw_state,
           raw_claimed.previous_raw_lease_owner_id,
           raw_claimed.previous_raw_lease_revision,
           raw_claimed.previous_raw_lease_claimed_at,
           raw_claimed.previous_raw_lease_expires_at,
           raw_claimed.raw_attempt_count,
           raw_claimed.raw_lease_owner_id,
           raw_claimed.raw_lease_token_hash,
           raw_claimed.raw_lease_revision,
           raw_claimed.raw_lease_claimed_at,
           raw_claimed.raw_lease_expires_at,
           raw_claimed.raw_revision,
           raw_claimed.raw_updated_at
      from runtime_claimed runtime
      left join raw_claimed on raw_claimed.work_id = runtime.work_id
     where (select count(*) from pressure_updated) =
           (select count(*) from pressure_deltas)
     order by runtime.claim_ordinal
  `;
}

export function buildClassifyInboxV2SourceBackpressureSql(
  rawInput: ParsedClaimInput
): SQL {
  const input = parseClaimInput(rawInput);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    connection_stats as materialized (
      select pressure.tenant_id, pressure.source_connection_id,
             sum(pressure.in_flight)::integer as in_flight,
             sum(pressure.queued)::integer as queued
        from public.inbox_v2_source_account_pressure_heads pressure
        cross join db_clock
       where pressure.tenant_id = ${input.tenantId}
       group by pressure.tenant_id, pressure.source_connection_id
    ),
    connection_work_due as materialized (
      select work.tenant_id, work.source_connection_id,
             min(work.lease_expires_at) filter (
               where work.state = 'leased'
             ) as earliest_lease_expiry,
             min(work.available_at) filter (
               where work.state in ('pending', 'retry_scheduled')
             ) as earliest_queue_due
        from public.inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${input.tenantId}
       group by work.tenant_id, work.source_connection_id
    ),
    tenant_stats as materialized (
      select stats.tenant_id,
             sum(stats.in_flight)::integer as in_flight,
             sum(stats.queued)::integer as queued
        from connection_stats stats
       group by stats.tenant_id
    ),
    tenant_work_due as materialized (
      select work.tenant_id,
             min(work.lease_expires_at) filter (
               where work.state = 'leased'
             ) as earliest_lease_expiry,
             min(work.available_at) filter (
               where work.state in ('pending', 'retry_scheduled')
             ) as earliest_queue_due
        from public.inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${input.tenantId}
       group by work.tenant_id
    ),
    connection_wide_rate_limit as materialized (
      select pressure.tenant_id, pressure.source_connection_id,
             pressure.rate_limit_reset_at as retry_at
        from public.inbox_v2_source_account_pressure_heads pressure
        cross join db_clock
       where pressure.tenant_id = ${input.tenantId}
         and pressure.source_account_id is null
         and pressure.source_account_scope_key = '0:'
         and pressure.state = 'rate_limited'
         and pressure.rate_limit_reset_at > db_clock.db_now
    ),
    account_pressure as materialized (
      select 'source_account'::text as scope,
             coalesce(
                      case when pressure.rate_limit_reset_at > db_clock.db_now
                           then pressure.rate_limit_reset_at end,
                      case when pressure.backoff_until > db_clock.db_now
                           then pressure.backoff_until end,
                      work_due.earliest_lease_expiry,
                      work_due.earliest_queue_due,
                      db_clock.db_now + interval '1 second') as retry_at,
             pressure.source_connection_id,
             pressure.source_account_scope_key
        from public.inbox_v2_source_account_pressure_heads pressure
        left join lateral (
          select min(work.lease_expires_at) filter (
                   where work.state = 'leased'
                 ) as earliest_lease_expiry,
                 min(work.available_at) filter (
                   where work.state in ('pending', 'retry_scheduled')
                 ) as earliest_queue_due
            from public.inbox_v2_source_processing_work_heads work
           where work.tenant_id = pressure.tenant_id
             and work.source_connection_id = pressure.source_connection_id
             and work.source_account_scope_key =
                 pressure.source_account_scope_key
        ) work_due on true
        cross join db_clock
       where pressure.tenant_id = ${input.tenantId}
         and pressure.source_account_id is not null
         and not exists (
           select 1
             from connection_wide_rate_limit connection_limit
            where connection_limit.tenant_id = pressure.tenant_id
              and connection_limit.source_connection_id =
                  pressure.source_connection_id
         )
         and ((pressure.state = 'paused'
                and pressure.backoff_until > db_clock.db_now)
           or (pressure.state = 'rate_limited'
                and pressure.rate_limit_reset_at > db_clock.db_now)
           or pressure.in_flight >= least(
              pressure.max_in_flight,
              ${input.policy.maxInFlightPerAccount}
            )
           or pressure.queued >= ${input.policy.maxQueuedPerAccount})
       order by retry_at, pressure.source_connection_id collate "C",
                pressure.source_account_scope_key collate "C"
       limit 1
    ),
    connection_pressure as materialized (
      select 'source_connection'::text as scope,
             coalesce(connection_limit.retry_at,
                      work_due.earliest_lease_expiry,
                      work_due.earliest_queue_due,
                      db_clock.db_now + interval '1 second') as retry_at,
             stats.source_connection_id,
             ''::text as source_account_scope_key
        from connection_stats stats
        left join connection_wide_rate_limit connection_limit
          on connection_limit.tenant_id = stats.tenant_id
         and connection_limit.source_connection_id =
             stats.source_connection_id
        left join connection_work_due work_due
          on work_due.tenant_id = stats.tenant_id
         and work_due.source_connection_id = stats.source_connection_id
        cross join db_clock
       where connection_limit.tenant_id is not null
          or stats.in_flight >= ${input.policy.maxInFlightPerConnection}
          or stats.queued >= ${input.policy.maxQueuedPerConnection}
    ),
    tenant_pressure as materialized (
      select 'tenant'::text as scope,
             coalesce(work_due.earliest_lease_expiry,
                      work_due.earliest_queue_due,
                      db_clock.db_now + interval '1 second') as retry_at,
             ''::text as source_connection_id,
             ''::text as source_account_scope_key
        from tenant_stats stats
        left join tenant_work_due work_due
          on work_due.tenant_id = stats.tenant_id
        cross join db_clock
       where stats.in_flight >= ${input.policy.maxInFlightPerTenant}
          or stats.queued >= ${input.policy.maxQueuedPerTenant}
    )
    select scope, retry_at
      from (
        select * from account_pressure
        union all select * from connection_pressure
        union all select * from tenant_pressure
      ) blocked
     order by case scope when 'source_account' then 0
                         when 'source_connection' then 1 else 2 end,
              retry_at,
              source_connection_id collate "C",
              source_account_scope_key collate "C"
     limit 1
  `;
}

function mapClaimResult(
  input: ParsedClaimInput,
  tokens: readonly ClaimToken[],
  rows: readonly ClaimRow[]
): InboxV2ClaimSourceProcessingRuntimeResult {
  if (rows.length > input.policy.maxClaimBatch) {
    throw invariantError("Source-processing claim exceeded its batch limit.");
  }
  const ranked = rows
    .map((row) => ({ row, ordinal: integerValue(row.claim_ordinal) }))
    .sort((left, right) => left.ordinal - right.ordinal);
  if (
    ranked.some((item, index) => item.ordinal !== index + 1) ||
    new Set(ranked.map((item) => item.ordinal)).size !== ranked.length
  ) {
    throw invariantError(
      "Source-processing claim ordinals are not contiguous."
    );
  }

  const claims = ranked.map(({ row, ordinal }) => {
    const token = tokens[ordinal - 1];
    if (token === undefined) {
      throw invariantError(
        "Source-processing claim returned an unknown ordinal."
      );
    }
    const tenantId = stringValue(row.tenant_id, "claim tenant");
    if (tenantId !== input.tenantId) {
      throw invariantError("Source-processing claim escaped its tenant scope.");
    }
    const stage = stringValue(row.stage, "claim stage");
    const attempt = inboxV2SourceProcessingAttemptSchema.parse({
      attemptId: stringValue(row.attempt_id, "claim attempt id"),
      workId: stringValue(row.work_id, "claim work id"),
      scope: {
        tenantId,
        sourceConnectionId: stringValue(
          row.source_connection_id,
          "claim source connection"
        ),
        sourceAccountId: nullableString(
          row.source_account_id,
          "claim source account"
        ),
        rawEventId: stringValue(row.raw_event_id, "claim raw event"),
        normalizedEventId: nullableString(
          row.normalized_event_id,
          "claim normalized event"
        ),
        stage
      },
      origin: stringValue(row.attempt_origin, "claim attempt origin"),
      replayRequestId: nullableString(
        row.replay_request_id,
        "claim replay request"
      ),
      attemptNumber: integerValue(row.attempt_count),
      maxAttempts: integerValue(row.max_attempts),
      // The public attempt fences the currently leased head. Its immutable
      // database fact is written against the following result revision.
      workRevision: bigintText(row.revision, "claim leased work revision"),
      workerId: stringValue(row.lease_owner_id, "claim lease worker"),
      leaseTokenHash: stringValue(
        row.lease_token_hash,
        "claim lease token hash"
      ),
      leaseRevision: bigintText(row.lease_revision, "claim lease revision"),
      leaseClaimedAt: timestampValue(
        row.lease_claimed_at,
        "claim lease claimedAt"
      ),
      startedAt: timestampValue(row.db_now, "claim start"),
      leaseExpiresAt: timestampValue(row.lease_expires_at, "claim lease expiry")
    });
    if (
      attempt.workerId !== input.workerId ||
      attempt.attemptId !== token.attemptId ||
      attempt.leaseTokenHash !== token.tokenHash
    ) {
      throw invariantError(
        "Source-processing claim is not bound to its worker capability."
      );
    }

    const rawIngressClaim =
      stage === "normalization"
        ? mapRawIngressBridgeClaim(input, row, token)
        : assertNoRawIngressBridge(row);
    return Object.freeze({
      attempt,
      leaseToken: token.rawToken,
      rawIngressClaim
    });
  });
  return inboxV2ClaimSourceProcessingRuntimeResultSchema.parse({
    outcome: "claimed",
    claims
  });
}

function mapRawIngressBridgeClaim(
  input: ParsedClaimInput,
  row: ClaimRow,
  token: ClaimToken
): RawIngressClaim {
  const previousState = stringValue(
    row.previous_raw_state,
    "raw bridge previous state"
  );
  if (previousState !== "pending" && previousState !== "leased") {
    throw invariantError("Raw bridge returned an invalid prior state.");
  }
  const claim = {
    claimKind: previousState === "pending" ? "pending" : "reclaimed",
    work: {
      tenantId: input.tenantId,
      rawEventId: stringValue(row.raw_event_id, "raw bridge event"),
      state: "leased",
      attemptCount: bigintText(row.raw_attempt_count, "raw attempt count"),
      lease: {
        workerId: stringValue(row.raw_lease_owner_id, "raw lease worker"),
        leaseTokenHash: stringValue(
          row.raw_lease_token_hash,
          "raw lease token hash"
        ),
        leaseRevision: bigintText(row.raw_lease_revision, "raw lease revision"),
        claimedAt: timestampValue(
          row.raw_lease_claimed_at,
          "raw lease claimedAt"
        ),
        expiresAt: timestampValue(row.raw_lease_expires_at, "raw lease expiry")
      },
      revision: bigintText(row.raw_revision, "raw work revision"),
      updatedAt: timestampValue(row.raw_updated_at, "raw work updatedAt")
    },
    leaseToken: token.rawToken,
    expiredLease:
      previousState === "pending"
        ? null
        : {
            workerId: stringValue(
              row.previous_raw_lease_owner_id,
              "expired raw lease worker"
            ),
            leaseRevision: bigintText(
              row.previous_raw_lease_revision,
              "expired raw lease revision"
            ),
            claimedAt: timestampValue(
              row.previous_raw_lease_claimed_at,
              "expired raw lease claimedAt"
            ),
            expiredAt: timestampValue(
              row.previous_raw_lease_expires_at,
              "expired raw lease expiry"
            )
          }
  };
  const parsed = inboxV2RawIngressClaimSchema.parse(claim);
  if (
    parsed.work.lease?.workerId !== input.workerId ||
    parsed.work.lease?.leaseTokenHash !== token.rawIngressTokenHash
  ) {
    throw invariantError("Raw bridge claim is not cross-fenced to its worker.");
  }
  return parsed;
}

function assertNoRawIngressBridge(row: ClaimRow): null {
  for (const field of [
    "previous_raw_state",
    "raw_attempt_count",
    "raw_lease_token_hash",
    "raw_revision"
  ] as const) {
    if (row[field] !== null && row[field] !== undefined) {
      throw invariantError("A downstream stage received a raw-ingress claim.");
    }
  }
  return null;
}

function mapEmptyOrBackpressured(
  rows: readonly Record<string, unknown>[]
): InboxV2ClaimSourceProcessingRuntimeResult {
  if (rows.length === 0) {
    return inboxV2ClaimSourceProcessingRuntimeResultSchema.parse({
      outcome: "empty"
    });
  }
  const row = exactlyOneRow(rows, "source-processing backpressure lookup");
  const scope = stringValue(row.scope, "backpressure scope");
  if (
    scope !== "tenant" &&
    scope !== "source_connection" &&
    scope !== "source_account"
  ) {
    throw invariantError("Source-processing backpressure scope is invalid.");
  }
  return inboxV2ClaimSourceProcessingRuntimeResultSchema.parse({
    outcome: "backpressured",
    retryAt: timestampValue(row.retry_at, "backpressure retryAt"),
    scope
  });
}

function runtimeClaimReturningColumns(): SQL {
  return sql.raw(`
    work.tenant_id,
    work.work_id,
    work.raw_event_id,
    work.normalized_event_id,
    work.stage::text as stage,
    work.source_connection_id,
    work.source_account_id,
    work.source_account_scope_key,
    work.route_generation::text as route_generation,
    work.state::text as state,
    work.processing_generation::text as processing_generation,
    work.available_at,
    work.max_attempts,
    work.attempt_count::text as attempt_count,
    work.lease_owner_id,
    work.lease_token_hash,
    work.lease_revision::text as lease_revision,
    work.lease_claimed_at,
    work.lease_expires_at,
    work.revision::text as revision,
    work.created_at,
    work.updated_at
  `);
}

export function buildReconcileInboxV2CompletedNormalizationsSql(input: {
  tenantId: string;
  batchSize: number;
  attemptRetentionSeconds: number;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const batchSize = z.number().int().min(1).max(1_000).parse(input.batchSize);
  const attemptRetentionSeconds = z
    .number()
    .int()
    .min(1)
    .max(MAX_RETENTION_SECONDS)
    .parse(input.attemptRetentionSeconds);
  return sql`
    with completed as materialized (
      select work.tenant_id, work.work_id, work.raw_event_id, work.stage,
             work.processing_generation, work.attempt_count,
             work.max_attempts, work.revision as previous_revision,
             work.lease_owner_id, work.lease_token_hash,
             work.lease_revision, work.lease_claimed_at,
             work.lease_expires_at, work.source_connection_id,
             work.source_account_scope_key,
             result.outcome::text as normalization_outcome,
             result.completed_at,
             replay.id as replay_request_id,
             'source-recovery:' || md5(
               work.tenant_id || ':' || work.work_id || ':' ||
               work.processing_generation::text || ':' ||
               work.attempt_count::text
             ) as recovery_attempt_id
        from public.inbox_v2_source_processing_work_heads work
        join public.inbox_v2_source_normalization_results result
          on result.tenant_id = work.tenant_id
         and result.raw_event_id = work.raw_event_id
        left join lateral (
          select request.id
            from public.inbox_v2_source_replay_requests request
           where request.tenant_id = work.tenant_id
             and request.state = 'applied'
             and request.result_work_id = work.work_id
             and request.result_processing_generation =
                 work.processing_generation
           order by request.completed_at desc, request.id collate "C"
           limit 1
        ) replay on true
       where work.tenant_id = ${tenantId}
         and work.stage = 'normalization'
         and work.state = 'leased'
         and result.outcome in ('normalized', 'ignored')
         and result.worker_id = work.lease_owner_id
         and result.completed_attempt_count = work.attempt_count
         and result.completed_lease_claimed_at = work.lease_claimed_at
         and result.completed_lease_expires_at = work.lease_expires_at
         and result.completed_at >= work.lease_claimed_at
         and result.completed_at < work.lease_expires_at
         and (work.processing_generation = 1
           or work.attempt_count > 1
           or replay.id is not null)
       order by result.completed_at, work.work_id collate "C"
       limit ${batchSize}
       for update of work skip locked
    ),
    attempt_inserted as materialized (
      insert into public.inbox_v2_source_processing_attempts (
        tenant_id, attempt_id, work_id, raw_event_id, stage,
        origin, replay_request_id, processing_generation,
        attempt_number, max_attempts, work_revision, outcome,
        worker_id, lease_token_hash, lease_revision, lease_claimed_at,
        started_at, finished_at, lease_expires_at,
        diagnostic_code_id, retryability, diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, next_attempt_at,
        rate_limit_reset_at, expires_at, created_at
      )
      select completed.tenant_id, completed.recovery_attempt_id,
             completed.work_id, completed.raw_event_id, completed.stage,
             case
               when completed.processing_generation = 1
                    and completed.attempt_count = 1 then 'initial'
               when completed.attempt_count = 1 then 'replay'
               else 'retry'
             end::public.inbox_v2_source_processing_attempt_origin,
             case when completed.attempt_count = 1
                       and completed.processing_generation > 1
                  then completed.replay_request_id else null end,
             completed.processing_generation, completed.attempt_count,
             completed.max_attempts, completed.previous_revision + 1,
             case when completed.normalization_outcome = 'normalized'
                  then 'processed' else 'ignored' end::
                    public.inbox_v2_source_processing_attempt_outcome,
             completed.lease_owner_id, completed.lease_token_hash,
             completed.lease_revision, completed.lease_claimed_at,
             completed.lease_claimed_at, completed.completed_at,
             completed.lease_expires_at,
             case when completed.normalization_outcome = 'ignored'
                  then 'core:source-normalization-ignored' else null end,
             case when completed.normalization_outcome = 'ignored'
                  then 'not_retryable'::
                    public.inbox_v2_source_processing_retryability
                  else null end,
             case when completed.normalization_outcome = 'ignored'
                  then completed.recovery_attempt_id else null end,
             null, null, null,
             completed.completed_at
               + make_interval(secs => ${attemptRetentionSeconds}),
             completed.completed_at
        from completed
      on conflict (tenant_id, attempt_id) do nothing
      returning tenant_id, attempt_id, work_id
    ),
    work_finalized as materialized (
      update public.inbox_v2_source_processing_work_heads work
         set state = case when completed.normalization_outcome = 'normalized'
                          then 'processed'
                          else 'ignored' end::
                       public.inbox_v2_source_processing_work_state,
             lease_owner_id = null, lease_token_hash = null,
             lease_revision = null, lease_claimed_at = null,
             lease_expires_at = null,
             last_diagnostic_code_id = case
               when completed.normalization_outcome = 'ignored'
                 then 'core:source-normalization-ignored'
               else null end,
             retryability = case
               when completed.normalization_outcome = 'ignored'
                 then 'not_retryable'::
                   public.inbox_v2_source_processing_retryability
               else null end,
             rate_limit_reset_at = null, dead_lettered_at = null,
             completed_at = completed.completed_at,
             revision = completed.previous_revision + 1,
             updated_at = completed.completed_at
        from completed
        join attempt_inserted attempt
          on attempt.tenant_id = completed.tenant_id
         and attempt.work_id = completed.work_id
       where work.tenant_id = completed.tenant_id
         and work.work_id = completed.work_id
         and work.state = 'leased'
         and work.revision = completed.previous_revision
      returning work.tenant_id, work.work_id,
                work.source_connection_id, work.source_account_scope_key,
                work.updated_at
    ),
    pressure_updated as (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = 'open',
             in_flight = pressure.in_flight - 1,
             consecutive_failure_count = 0,
             backoff_until = null, rate_limit_reset_at = null,
             last_diagnostic_code_id = null,
             revision = pressure.revision + 1,
             updated_at = finalized.updated_at
        from work_finalized finalized
       where pressure.tenant_id = finalized.tenant_id
         and pressure.source_connection_id = finalized.source_connection_id
         and pressure.source_account_scope_key =
             finalized.source_account_scope_key
         and pressure.in_flight > 0
      returning pressure.tenant_id, pressure.source_connection_id,
                pressure.source_account_scope_key
    )
    select finalized.tenant_id, finalized.work_id
      from work_finalized finalized
      join pressure_updated pressure
        on pressure.tenant_id = finalized.tenant_id
       and pressure.source_connection_id = finalized.source_connection_id
       and pressure.source_account_scope_key =
           finalized.source_account_scope_key
     order by finalized.work_id collate "C"
  `;
}

type QuarantineRecoveryCandidate = Readonly<{
  attempt: InboxV2SourceProcessingAttempt;
  processingGeneration: string;
  completedAt: string;
  deadLetterId: string;
}>;

export function buildSelectInboxV2QuarantineRecoveriesSql(input: {
  tenantId: string;
  batchSize: number;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const batchSize = z.number().int().min(1).max(1_000).parse(input.batchSize);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select ${runtimeWorkLockColumns()}, db_clock.db_now,
           result.outcome::text as normalization_outcome,
           result.reason_code, result.quarantine_id, result.completed_at,
           replay.id as replay_request_id,
           'source-recovery:' || md5(
             work.tenant_id || ':' || work.work_id || ':' ||
             work.processing_generation::text || ':' ||
             work.attempt_count::text
           ) as recovery_attempt_id
      from public.inbox_v2_source_processing_work_heads work
      join public.inbox_v2_source_normalization_results result
        on result.tenant_id = work.tenant_id
       and result.raw_event_id = work.raw_event_id
      cross join db_clock
      left join lateral (
        select request.id
          from public.inbox_v2_source_replay_requests request
         where request.tenant_id = work.tenant_id
           and request.state = 'applied'
           and request.result_work_id = work.work_id
           and request.result_processing_generation =
               work.processing_generation
         order by request.completed_at desc, request.id collate "C"
         limit 1
      ) replay on true
     where work.tenant_id = ${tenantId}
       and work.stage = 'normalization'
       and work.state = 'leased'
       and result.outcome = 'quarantined'
       and result.worker_id = work.lease_owner_id
       and result.completed_attempt_count = work.attempt_count
       and result.completed_lease_claimed_at = work.lease_claimed_at
       and result.completed_lease_expires_at = work.lease_expires_at
       and result.completed_at >= work.lease_claimed_at
       and result.completed_at < work.lease_expires_at
       and (work.processing_generation = 1
         or work.attempt_count > 1
         or replay.id is not null)
     order by result.completed_at, work.work_id collate "C"
     limit ${batchSize}
     for update of work skip locked
  `;
}

function mapQuarantineRecoveryCandidate(
  row: WorkLockRow
): QuarantineRecoveryCandidate {
  if (
    stringValue(row.normalization_outcome, "normalization outcome") !==
    "quarantined"
  ) {
    throw invariantError(
      "Quarantine recovery selected a non-quarantined result."
    );
  }
  const processingGeneration = bigintText(
    row.processing_generation,
    "quarantine processing generation"
  );
  const attemptCount = integerValue(row.attempt_count);
  const origin =
    processingGeneration === "1" && attemptCount === 1
      ? "initial"
      : attemptCount === 1
        ? "replay"
        : "retry";
  const attempt = inboxV2SourceProcessingAttemptSchema.parse({
    attemptId: stringValue(row.recovery_attempt_id, "recovery attempt id"),
    workId: stringValue(row.work_id, "recovery work id"),
    scope: {
      tenantId: stringValue(row.tenant_id, "recovery tenant"),
      sourceConnectionId: stringValue(
        row.source_connection_id,
        "recovery connection"
      ),
      sourceAccountId: nullableString(
        row.source_account_id,
        "recovery account"
      ),
      rawEventId: stringValue(row.raw_event_id, "recovery raw event"),
      normalizedEventId: null,
      stage: "normalization"
    },
    origin,
    replayRequestId:
      origin === "replay"
        ? stringValue(row.replay_request_id, "recovery replay request")
        : null,
    attemptNumber: attemptCount,
    maxAttempts: integerValue(row.max_attempts),
    workRevision: bigintText(row.revision, "recovery leased work revision"),
    workerId: stringValue(row.lease_owner_id, "recovery worker"),
    leaseTokenHash: stringValue(row.lease_token_hash, "recovery token hash"),
    leaseRevision: bigintText(row.lease_revision, "recovery lease revision"),
    leaseClaimedAt: timestampValue(
      row.lease_claimed_at,
      "recovery lease claimedAt"
    ),
    startedAt: timestampValue(row.lease_claimed_at, "recovery startedAt"),
    leaseExpiresAt: timestampValue(
      row.lease_expires_at,
      "recovery lease expiry"
    )
  });
  const completedAt = timestampValue(row.completed_at, "recovery completion");
  if (
    Date.parse(completedAt) < Date.parse(attempt.startedAt) ||
    Date.parse(completedAt) >= Date.parse(attempt.leaseExpiresAt)
  ) {
    throw invariantError("Quarantine recovery completion escaped its lease.");
  }
  return Object.freeze({
    attempt,
    processingGeneration,
    completedAt,
    deadLetterId: stringValue(row.quarantine_id, "recovery quarantine id")
  });
}

const deadLetterLifecycleResolutionSchema = z
  .object({
    evidenceDeadlines: inboxV2SourceEvidenceDeadlinesSchema,
    replayNotAfter: inboxV2TimestampSchema,
    expiresAt: inboxV2TimestampSchema
  })
  .strict();

type ResolvedQuarantineRecovery = Readonly<{
  candidate: QuarantineRecoveryCandidate;
  record: InboxV2SourceDeadLetterRecord;
}>;

export function buildFinalizeInboxV2QuarantineRecoveriesSql(input: {
  recoveries: readonly ResolvedQuarantineRecovery[];
  attemptRetentionSeconds: number;
}): SQL {
  const attemptRetentionSeconds = z
    .number()
    .int()
    .min(1)
    .max(MAX_RETENTION_SECONDS)
    .parse(input.attemptRetentionSeconds);
  if (input.recoveries.length === 0 || input.recoveries.length > 1_000) {
    throw new TypeError(
      "Quarantine recovery finalization requires a bounded batch."
    );
  }
  const resolutions = JSON.stringify(
    input.recoveries.map(({ candidate, record }) => ({
      tenant_id: candidate.attempt.scope.tenantId,
      work_id: candidate.attempt.workId,
      recovery_attempt_id: candidate.attempt.attemptId,
      work_revision: nextRevision(
        candidate.attempt.workRevision,
        "recovery leased work revision"
      ),
      processing_generation: candidate.processingGeneration,
      dead_letter_id: record.deadLetterId,
      completed_at: candidate.completedAt,
      diagnostic_code_id: record.diagnostic.codeId,
      diagnostic_correlation_token: record.diagnostic.correlationToken,
      diagnostic_safe_operator_hint_id: record.diagnostic.safeOperatorHintId,
      evidence_captured_at: record.evidenceDeadlines.capturedAt,
      raw_payload_expires_at: record.evidenceDeadlines.rawPayloadExpiresAt,
      allowed_raw_headers_expires_at:
        record.evidenceDeadlines.allowedRawHeadersExpiresAt,
      normalized_payload_expires_at:
        record.evidenceDeadlines.normalizedPayloadExpiresAt,
      replay_not_after: record.replayNotAfter,
      expires_at: record.expiresAt
    }))
  );
  return sql`
    with resolutions as materialized (
      select *
        from jsonb_to_recordset(${resolutions}::jsonb) as resolved(
          tenant_id text, work_id text, recovery_attempt_id text,
          work_revision bigint, processing_generation bigint,
          dead_letter_id text, completed_at timestamptz,
          diagnostic_code_id text, diagnostic_correlation_token text,
          diagnostic_safe_operator_hint_id text,
          evidence_captured_at timestamptz,
          raw_payload_expires_at timestamptz,
          allowed_raw_headers_expires_at timestamptz,
          normalized_payload_expires_at timestamptz,
          replay_not_after timestamptz, expires_at timestamptz
        )
    ),
    completed as materialized (
      select work.tenant_id, work.work_id, work.raw_event_id, work.stage,
             work.processing_generation, work.attempt_count,
             work.max_attempts, work.revision as previous_revision,
             work.lease_owner_id, work.lease_token_hash,
             work.lease_revision, work.lease_claimed_at,
             work.lease_expires_at, work.source_connection_id,
             work.source_account_scope_key, result.completed_at,
             replay.id as replay_request_id,
             resolved.recovery_attempt_id, resolved.dead_letter_id,
             resolved.diagnostic_code_id,
             resolved.diagnostic_correlation_token,
             resolved.diagnostic_safe_operator_hint_id,
             resolved.evidence_captured_at,
             resolved.raw_payload_expires_at,
             resolved.allowed_raw_headers_expires_at,
             resolved.normalized_payload_expires_at,
             resolved.replay_not_after, resolved.expires_at
        from resolutions resolved
        join public.inbox_v2_source_processing_work_heads work
          on work.tenant_id = resolved.tenant_id
         and work.work_id = resolved.work_id
        join public.inbox_v2_source_normalization_results result
          on result.tenant_id = work.tenant_id
         and result.raw_event_id = work.raw_event_id
         and result.outcome = 'quarantined'
         and result.quarantine_id = resolved.dead_letter_id
         and result.completed_at = resolved.completed_at
         and result.worker_id = work.lease_owner_id
         and result.completed_attempt_count = work.attempt_count
         and result.completed_lease_claimed_at = work.lease_claimed_at
         and result.completed_lease_expires_at = work.lease_expires_at
        left join lateral (
          select request.id
            from public.inbox_v2_source_replay_requests request
           where request.tenant_id = work.tenant_id
             and request.state = 'applied'
             and request.result_work_id = work.work_id
             and request.result_processing_generation =
                 work.processing_generation
           order by request.completed_at desc, request.id collate "C"
           limit 1
        ) replay on true
       where work.stage = 'normalization'
         and work.state = 'leased'
         and work.revision + 1 = resolved.work_revision
         and work.processing_generation = resolved.processing_generation
         and resolved.recovery_attempt_id = 'source-recovery:' || md5(
           work.tenant_id || ':' || work.work_id || ':' ||
           work.processing_generation::text || ':' ||
           work.attempt_count::text
         )
         and resolved.completed_at >= work.lease_claimed_at
         and resolved.completed_at < work.lease_expires_at
         and resolved.completed_at < resolved.replay_not_after
         and resolved.replay_not_after <= resolved.expires_at
         and (work.processing_generation = 1
           or work.attempt_count > 1
           or replay.id is not null)
       for update of work
    ),
    attempt_inserted as materialized (
      insert into public.inbox_v2_source_processing_attempts (
        tenant_id, attempt_id, work_id, raw_event_id, stage,
        origin, replay_request_id, processing_generation,
        attempt_number, max_attempts, work_revision, outcome,
        worker_id, lease_token_hash, lease_revision, lease_claimed_at,
        started_at, finished_at, lease_expires_at,
        diagnostic_code_id, retryability, diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, next_attempt_at,
        rate_limit_reset_at, expires_at, created_at
      )
      select completed.tenant_id, completed.recovery_attempt_id,
             completed.work_id, completed.raw_event_id, completed.stage,
             case when completed.processing_generation = 1
                        and completed.attempt_count = 1 then 'initial'
                  when completed.attempt_count = 1 then 'replay'
                  else 'retry' end::
               public.inbox_v2_source_processing_attempt_origin,
             case when completed.attempt_count = 1
                       and completed.processing_generation > 1
                  then completed.replay_request_id else null end,
             completed.processing_generation, completed.attempt_count,
             completed.max_attempts, completed.previous_revision + 1,
             'dead_lettered', completed.lease_owner_id,
             completed.lease_token_hash, completed.lease_revision,
             completed.lease_claimed_at, completed.lease_claimed_at,
             completed.completed_at, completed.lease_expires_at,
             completed.diagnostic_code_id, 'not_retryable',
             completed.diagnostic_correlation_token,
             completed.diagnostic_safe_operator_hint_id, null, null,
             completed.completed_at
               + make_interval(secs => ${attemptRetentionSeconds}),
             completed.completed_at
        from completed
      on conflict (tenant_id, attempt_id) do nothing
      returning tenant_id, attempt_id, work_id
    ),
    dlq_inserted as materialized (
      insert into public.inbox_v2_source_processing_dead_letters (
        tenant_id, id, work_id, attempt_id, raw_event_id, stage,
        processing_generation, attempt_number, work_revision, reason,
        diagnostic_code_id, retryability, diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, evidence_captured_at,
        raw_payload_expires_at, allowed_raw_headers_expires_at,
        normalized_payload_expires_at, replay_not_after, expires_at,
        recorded_at
      )
      select completed.tenant_id, completed.dead_letter_id,
             completed.work_id, completed.recovery_attempt_id,
             completed.raw_event_id, completed.stage,
             completed.processing_generation, completed.attempt_count,
             completed.previous_revision + 1, 'terminal_failure',
             completed.diagnostic_code_id, 'not_retryable',
             completed.diagnostic_correlation_token,
             completed.diagnostic_safe_operator_hint_id,
             completed.evidence_captured_at,
             completed.raw_payload_expires_at,
             completed.allowed_raw_headers_expires_at,
             completed.normalized_payload_expires_at,
             completed.replay_not_after, completed.expires_at,
             completed.completed_at
        from completed
        join attempt_inserted attempt
          on attempt.tenant_id = completed.tenant_id
         and attempt.attempt_id = completed.recovery_attempt_id
      on conflict (tenant_id, id) do nothing
      returning tenant_id, id, work_id
    ),
    work_finalized as materialized (
      update public.inbox_v2_source_processing_work_heads work
         set state = 'dead_lettered', lease_owner_id = null,
             lease_token_hash = null, lease_revision = null,
             lease_claimed_at = null, lease_expires_at = null,
             last_diagnostic_code_id = completed.diagnostic_code_id,
             retryability = 'not_retryable', rate_limit_reset_at = null,
             dead_lettered_at = completed.completed_at,
             completed_at = null, revision = work.revision + 1,
             updated_at = completed.completed_at
        from completed
        join dlq_inserted dlq
          on dlq.tenant_id = completed.tenant_id
         and dlq.work_id = completed.work_id
       where work.tenant_id = completed.tenant_id
         and work.work_id = completed.work_id
         and work.state = 'leased'
         and work.revision = completed.previous_revision
      returning work.tenant_id, work.work_id,
                work.source_connection_id, work.source_account_scope_key,
                work.updated_at
    ),
    pressure_updated as materialized (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = 'open', in_flight = pressure.in_flight - 1,
             consecutive_failure_count =
               pressure.consecutive_failure_count + 1,
             backoff_until = null, rate_limit_reset_at = null,
             last_diagnostic_code_id =
               'core:source-normalization-quarantined',
             revision = pressure.revision + 1,
             updated_at = finalized.updated_at
        from work_finalized finalized
       where pressure.tenant_id = finalized.tenant_id
         and pressure.source_connection_id = finalized.source_connection_id
         and pressure.source_account_scope_key =
             finalized.source_account_scope_key
         and pressure.in_flight > 0
      returning pressure.tenant_id, pressure.source_connection_id,
                pressure.source_account_scope_key
    )
    select finalized.tenant_id, finalized.work_id
      from work_finalized finalized
      join pressure_updated pressure
        on pressure.tenant_id = finalized.tenant_id
       and pressure.source_connection_id = finalized.source_connection_id
       and pressure.source_account_scope_key =
           finalized.source_account_scope_key
     order by finalized.work_id collate "C"
  `;
}

async function prepareCompletedQuarantineRecoveries(
  executor: InboxV2SourceProcessingTransactionExecutor,
  input: Readonly<{
    tenantId: string;
    batchSize: number;
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
    deadLetterLifecycleResolver: InboxV2SourceDeadLetterLifecycleResolver;
  }>
): Promise<readonly ResolvedQuarantineRecovery[]> {
  const selected = await runTransaction(executor, (transaction) =>
    transaction.execute<WorkLockRow>(
      buildSelectInboxV2QuarantineRecoveriesSql(input)
    )
  );
  if (selected.rows.length > input.batchSize) {
    throw invariantError("Quarantine recovery exceeded its bounded batch.");
  }
  const recoveries: ResolvedQuarantineRecovery[] = [];
  for (const row of selected.rows) {
    const candidate = mapQuarantineRecoveryCandidate(row);
    const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse({
      codeId: "core:source-normalization-quarantined",
      retryable: false,
      correlationToken: candidate.attempt.attemptId,
      safeOperatorHintId: null
    });
    let record: InboxV2SourceDeadLetterRecord;
    try {
      const lifecycle = deadLetterLifecycleResolutionSchema.parse(
        await input.deadLetterLifecycleResolver({
          scope: candidate.attempt.scope,
          deadLetterId: candidate.deadLetterId,
          deadLetteredAt: candidate.completedAt,
          diagnostic
        })
      );
      record = inboxV2SourceDeadLetterRecordSchema.parse({
        deadLetterId: candidate.deadLetterId,
        attempt: candidate.attempt,
        reason: "terminal_failure",
        diagnostic,
        deadLetteredAt: candidate.completedAt,
        ...lifecycle
      });
    } catch {
      continue;
    }
    recoveries.push(Object.freeze({ candidate, record }));
  }
  return Object.freeze(recoveries);
}

async function finalizePreparedQuarantineRecoveries(
  executor: RawSqlExecutor,
  input: Readonly<{
    recoveries: readonly ResolvedQuarantineRecovery[];
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
  }>
): Promise<void> {
  if (input.recoveries.length === 0) return;
  const finalized = await executor.execute<Record<string, unknown>>(
    buildFinalizeInboxV2QuarantineRecoveriesSql({
      recoveries: input.recoveries,
      attemptRetentionSeconds: input.retentionPolicy.attemptRetentionSeconds
    })
  );
  if (finalized.rows.length > input.recoveries.length) {
    throw invariantError(
      "Quarantine recovery exceeded its prepared CAS batch."
    );
  }
}

async function reconcileCompletedNormalizations(
  executor: RawSqlExecutor,
  input: Readonly<{
    tenantId: string;
    batchSize: number;
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
  }>
): Promise<void> {
  const result = await executor.execute<Record<string, unknown>>(
    buildReconcileInboxV2CompletedNormalizationsSql({
      tenantId: input.tenantId,
      batchSize: input.batchSize,
      attemptRetentionSeconds: input.retentionPolicy.attemptRetentionSeconds
    })
  );
  if (result.rows.length > input.batchSize) {
    throw invariantError(
      "Normalization reconciliation exceeded its bounded batch."
    );
  }
}

type ParsedApplyOutcomeInput = InboxV2ApplySourceProcessingOutcomeInput;

function parseApplyOutcomeInput(input: unknown): ParsedApplyOutcomeInput {
  return inboxV2ApplySourceProcessingOutcomeInputSchema.parse(input);
}

export function buildLockInboxV2SourceProcessingWorkSql(input: {
  tenantId: string;
  workId: string;
  attemptId: string;
  deadLetterId: string | null;
}): SQL {
  const tenantId = inboxV2TenantIdSchema.parse(input.tenantId);
  const workId = z.string().min(8).max(512).parse(input.workId);
  const attemptId = inboxV2SourceProcessingAttemptIdSchema.parse(
    input.attemptId
  );
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select ${runtimeWorkLockColumns()}, db_clock.db_now,
           existing.attempt_id as existing_attempt_id,
           existing.work_id as existing_attempt_work_id,
           existing.work_revision::text as existing_attempt_work_revision,
           existing.outcome::text as existing_attempt_outcome,
           existing.diagnostic_code_id as existing_diagnostic_code_id,
           existing.retryability::text as existing_retryability,
           existing.diagnostic_correlation_token as
             existing_diagnostic_correlation_token,
           existing.diagnostic_safe_operator_hint_id as
             existing_diagnostic_safe_operator_hint_id,
           existing.next_attempt_at as existing_next_attempt_at,
           existing.finished_at as existing_finished_at,
           existing_dlq.id as existing_dlq_id,
           existing_dlq.reason::text as existing_dlq_reason,
           existing_dlq.diagnostic_code_id as existing_dlq_diagnostic_code_id,
           existing_dlq.retryability::text as existing_dlq_retryability,
           existing_dlq.diagnostic_correlation_token as
             existing_dlq_diagnostic_correlation_token,
           existing_dlq.diagnostic_safe_operator_hint_id as
             existing_dlq_diagnostic_safe_operator_hint_id,
           existing_dlq.evidence_captured_at as existing_evidence_captured_at,
           existing_dlq.raw_payload_expires_at as
             existing_raw_payload_expires_at,
           existing_dlq.allowed_raw_headers_expires_at as
             existing_allowed_raw_headers_expires_at,
           existing_dlq.normalized_payload_expires_at as
             existing_normalized_payload_expires_at,
           existing_dlq.replay_not_after as existing_replay_not_after,
           existing_dlq.expires_at as existing_dlq_expires_at,
           existing_dlq.recorded_at as existing_dlq_recorded_at
      from public.inbox_v2_source_processing_work_heads work
      cross join db_clock
      left join public.inbox_v2_source_processing_attempts existing
        on existing.tenant_id = work.tenant_id
       and existing.attempt_id = ${attemptId}
      left join public.inbox_v2_source_processing_dead_letters existing_dlq
        on existing_dlq.tenant_id = existing.tenant_id
       and existing_dlq.attempt_id = existing.attempt_id
       and existing_dlq.id = ${input.deadLetterId}
     where work.tenant_id = ${tenantId}
       and work.work_id = ${workId}
     for update of work
  `;
}

type LockedOutcome =
  | Readonly<{
      kind: "result";
      result: InboxV2ApplySourceProcessingOutcomeResult;
    }>
  | Readonly<{
      kind: "locked";
      dbNow: string;
      processingGeneration: string;
    }>;

async function lockAndClassifyOutcome(
  executor: RawSqlExecutor,
  outcome: InboxV2SourceProcessingOutcome,
  tokenHash: string,
  deadLetterRecord: InboxV2SourceDeadLetterRecord | null
): Promise<LockedOutcome> {
  const attempt = outcome.attempt;
  const result = await executor.execute<WorkLockRow>(
    buildLockInboxV2SourceProcessingWorkSql({
      tenantId: attempt.scope.tenantId,
      workId: attempt.workId,
      attemptId: attempt.attemptId,
      deadLetterId:
        outcome.kind === "dead_lettered" ? outcome.deadLetter.id : null
    })
  );
  if (result.rows.length === 0) {
    return { kind: "result", result: { outcome: "not_found" } };
  }
  const row = exactlyOneRow(result.rows, "source-processing work lock");
  if (!lockedWorkMatchesAttemptScope(row, attempt)) {
    return { kind: "result", result: { outcome: "not_found" } };
  }
  if (row.existing_attempt_id !== null) {
    if (!existingAttemptMatchesOutcome(row, outcome, deadLetterRecord)) {
      throw invariantError(
        "An existing source-processing attempt conflicts with the retry."
      );
    }
    return { kind: "result", result: { outcome: "already_applied" } };
  }
  if (stringValue(row.state, "locked work state") !== "leased") {
    return { kind: "result", result: { outcome: "not_leased" } };
  }
  const currentWorker = nullableString(row.lease_owner_id, "lease worker");
  const currentHash = nullableString(row.lease_token_hash, "lease token hash");
  if (currentWorker !== attempt.workerId || currentHash !== tokenHash) {
    return { kind: "result", result: { outcome: "stale_token" } };
  }
  const dbNow = timestampValue(row.db_now, "outcome database clock");
  const expiresAt = timestampValue(row.lease_expires_at, "lease expiry");
  if (Date.parse(expiresAt) <= Date.parse(dbNow)) {
    return { kind: "result", result: { outcome: "lease_expired" } };
  }
  const leaseRevision = bigintText(row.lease_revision, "lease revision");
  const workRevision = bigintText(row.revision, "work revision");
  if (
    leaseRevision !== attempt.leaseRevision ||
    workRevision !== attempt.workRevision ||
    timestampValue(row.lease_claimed_at, "lease claimedAt") !==
      attempt.leaseClaimedAt ||
    expiresAt !== attempt.leaseExpiresAt
  ) {
    return {
      kind: "result",
      result: { outcome: "lease_revision_conflict" }
    };
  }
  if (Date.parse(outcome.completedAt) > Date.parse(dbNow)) {
    throw new TypeError(
      "Source-processing completion cannot be later than the database clock."
    );
  }
  return {
    kind: "locked",
    dbNow,
    processingGeneration: bigintText(
      row.processing_generation,
      "processing generation"
    )
  };
}

function lockedWorkMatchesAttemptScope(
  row: WorkLockRow,
  attempt: InboxV2SourceProcessingAttempt
): boolean {
  return (
    stringValue(row.tenant_id, "locked tenant") === attempt.scope.tenantId &&
    stringValue(row.work_id, "locked work") === attempt.workId &&
    stringValue(row.raw_event_id, "locked raw event") ===
      attempt.scope.rawEventId &&
    nullableString(row.normalized_event_id, "locked normalized event") ===
      attempt.scope.normalizedEventId &&
    stringValue(row.stage, "locked stage") === attempt.scope.stage &&
    stringValue(row.source_connection_id, "locked connection") ===
      attempt.scope.sourceConnectionId &&
    nullableString(row.source_account_id, "locked account") ===
      attempt.scope.sourceAccountId &&
    integerValue(row.attempt_count) === attempt.attemptNumber &&
    integerValue(row.max_attempts) === attempt.maxAttempts
  );
}

function existingAttemptMatchesOutcome(
  row: WorkLockRow,
  outcome: InboxV2SourceProcessingOutcome,
  deadLetterRecord: InboxV2SourceDeadLetterRecord | null
): boolean {
  const diagnostic = outcome.diagnostic;
  const attemptMatches =
    stringValue(row.existing_attempt_id, "existing attempt id") ===
      outcome.attempt.attemptId &&
    stringValue(row.existing_attempt_work_id, "existing attempt work") ===
      outcome.attempt.workId &&
    bigintText(
      row.existing_attempt_work_revision,
      "existing attempt revision"
    ) === nextRevision(outcome.attempt.workRevision, "leased work revision") &&
    stringValue(row.existing_attempt_outcome, "existing attempt outcome") ===
      outcome.kind &&
    nullableString(row.existing_diagnostic_code_id, "existing diagnostic") ===
      (diagnostic?.codeId ?? null) &&
    nullableString(row.existing_retryability, "existing retryability") ===
      (diagnostic === null
        ? null
        : diagnostic.retryable
          ? "retryable"
          : "not_retryable") &&
    nullableString(
      row.existing_diagnostic_correlation_token,
      "existing diagnostic correlation"
    ) === (diagnostic?.correlationToken ?? null) &&
    nullableString(
      row.existing_diagnostic_safe_operator_hint_id,
      "existing operator hint"
    ) === (diagnostic?.safeOperatorHintId ?? null) &&
    nullableTimestamp(row.existing_next_attempt_at, "existing next attempt") ===
      (outcome.kind === "retry_scheduled"
        ? outcome.retry.nextAttemptAt
        : null) &&
    timestampValue(row.existing_finished_at, "existing finish") ===
      outcome.completedAt;
  if (!attemptMatches) return false;
  if (outcome.kind !== "dead_lettered") return deadLetterRecord === null;
  if (deadLetterRecord === null) return false;
  return (
    stringValue(row.existing_dlq_id, "existing DLQ id") ===
      deadLetterRecord.deadLetterId &&
    stringValue(row.existing_dlq_reason, "existing DLQ reason") ===
      deadLetterRecord.reason &&
    stringValue(
      row.existing_dlq_diagnostic_code_id,
      "existing DLQ diagnostic"
    ) === deadLetterRecord.diagnostic.codeId &&
    stringValue(row.existing_dlq_retryability, "existing DLQ retryability") ===
      (deadLetterRecord.diagnostic.retryable ? "retryable" : "not_retryable") &&
    stringValue(
      row.existing_dlq_diagnostic_correlation_token,
      "existing DLQ correlation"
    ) === deadLetterRecord.diagnostic.correlationToken &&
    nullableString(
      row.existing_dlq_diagnostic_safe_operator_hint_id,
      "existing DLQ hint"
    ) === deadLetterRecord.diagnostic.safeOperatorHintId &&
    timestampValue(
      row.existing_evidence_captured_at,
      "existing evidence capturedAt"
    ) === deadLetterRecord.evidenceDeadlines.capturedAt &&
    timestampValue(
      row.existing_raw_payload_expires_at,
      "existing raw payload expiry"
    ) === deadLetterRecord.evidenceDeadlines.rawPayloadExpiresAt &&
    timestampValue(
      row.existing_allowed_raw_headers_expires_at,
      "existing raw headers expiry"
    ) === deadLetterRecord.evidenceDeadlines.allowedRawHeadersExpiresAt &&
    nullableTimestamp(
      row.existing_normalized_payload_expires_at,
      "existing normalized payload expiry"
    ) === deadLetterRecord.evidenceDeadlines.normalizedPayloadExpiresAt &&
    timestampValue(
      row.existing_replay_not_after,
      "existing replay deadline"
    ) === deadLetterRecord.replayNotAfter &&
    timestampValue(row.existing_dlq_expires_at, "existing DLQ expiry") ===
      deadLetterRecord.expiresAt &&
    timestampValue(row.existing_dlq_recorded_at, "existing DLQ recordedAt") ===
      deadLetterRecord.deadLetteredAt
  );
}

export function buildApplyInboxV2SourceProcessingOutcomeSql(
  input: Readonly<{
    outcome: InboxV2SourceProcessingOutcome;
    tokenHash: string;
    dbNow: string;
    processingGeneration: string;
    retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
    deadLetterRecord: InboxV2SourceDeadLetterRecord | null;
  }>
): SQL {
  const outcome = inboxV2SourceProcessingOutcomeSchema.parse(input.outcome);
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  const processingGeneration = inboxV2EntityRevisionSchema.parse(
    input.processingGeneration
  );
  const retention = parseRetentionPolicy(input.retentionPolicy);
  const deadLetter = input.deadLetterRecord;
  if ((outcome.kind === "dead_lettered") !== (deadLetter !== null)) {
    throw new TypeError("Outcome SQL requires an exact optional DLQ record.");
  }
  const attempt = outcome.attempt;
  const diagnostic = outcome.diagnostic;
  const retryability =
    diagnostic === null
      ? null
      : diagnostic.retryable
        ? "retryable"
        : "not_retryable";
  const nextAttemptAt =
    outcome.kind === "retry_scheduled" ? outcome.retry.nextAttemptAt : null;
  const rateLimitResetAt =
    outcome.kind === "retry_scheduled"
      ? (outcome.retry.rateLimitHint?.retryAt ?? null)
      : null;
  const rateLimitScope =
    outcome.kind === "retry_scheduled"
      ? (outcome.retry.rateLimitHint?.scope ?? null)
      : null;
  const nextWorkState = outcome.kind;
  const pressureState =
    outcome.kind !== "retry_scheduled"
      ? "open"
      : outcome.retry.reason === "rate_limited"
        ? "rate_limited"
        : "paused";

  return sql`
    with db_fence as materialized (
      select ${dbNow}::timestamptz as db_now
    ),
    attempt_inserted as materialized (
      insert into public.inbox_v2_source_processing_attempts (
        tenant_id, attempt_id, work_id, raw_event_id, stage,
        origin, replay_request_id, processing_generation,
        attempt_number, max_attempts, work_revision, outcome,
        worker_id, lease_token_hash, lease_revision, lease_claimed_at,
        started_at, finished_at, lease_expires_at,
        diagnostic_code_id, retryability, diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, next_attempt_at,
        rate_limit_reset_at, expires_at, created_at
      ) values (
        ${attempt.scope.tenantId}, ${attempt.attemptId}, ${attempt.workId},
        ${attempt.scope.rawEventId}, ${attempt.scope.stage},
        ${attempt.origin}, ${attempt.replayRequestId},
        ${processingGeneration}::bigint,
        ${attempt.attemptNumber}::bigint, ${attempt.maxAttempts},
        ${attempt.workRevision}::bigint + 1, ${outcome.kind},
        ${attempt.workerId}, ${tokenHash}, ${attempt.leaseRevision}::bigint,
        ${attempt.leaseClaimedAt}::timestamptz,
        ${attempt.startedAt}::timestamptz,
        ${outcome.completedAt}::timestamptz,
        ${attempt.leaseExpiresAt}::timestamptz,
        ${diagnostic?.codeId ?? null}, ${retryability},
        ${diagnostic?.correlationToken ?? null},
        ${diagnostic?.safeOperatorHintId ?? null},
        ${nextAttemptAt}::timestamptz, ${rateLimitResetAt}::timestamptz,
        ${outcome.completedAt}::timestamptz
          + make_interval(secs => ${retention.attemptRetentionSeconds}),
        ${outcome.completedAt}::timestamptz
      )
      on conflict (tenant_id, attempt_id) do nothing
      returning tenant_id, attempt_id, work_id
    ),
    dlq_inserted as materialized (
      insert into public.inbox_v2_source_processing_dead_letters (
        tenant_id, id, work_id, attempt_id, raw_event_id, stage,
        processing_generation, attempt_number, work_revision, reason,
        diagnostic_code_id, retryability, diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, evidence_captured_at,
        raw_payload_expires_at, allowed_raw_headers_expires_at,
        normalized_payload_expires_at, replay_not_after, expires_at, recorded_at
      )
      select ${attempt.scope.tenantId}, ${deadLetter?.deadLetterId ?? null},
             ${attempt.workId}, ${attempt.attemptId},
             ${attempt.scope.rawEventId}, ${attempt.scope.stage},
             work.processing_generation, ${attempt.attemptNumber}::bigint,
             ${attempt.workRevision}::bigint + 1,
             ${deadLetter?.reason ?? null},
             ${deadLetter?.diagnostic.codeId ?? null}, ${retryability},
             ${deadLetter?.diagnostic.correlationToken ?? null},
             ${deadLetter?.diagnostic.safeOperatorHintId ?? null},
             ${deadLetter?.evidenceDeadlines.capturedAt ?? null}::timestamptz,
             ${deadLetter?.evidenceDeadlines.rawPayloadExpiresAt ?? null}::timestamptz,
             ${deadLetter?.evidenceDeadlines.allowedRawHeadersExpiresAt ?? null}::timestamptz,
             ${deadLetter?.evidenceDeadlines.normalizedPayloadExpiresAt ?? null}::timestamptz,
             ${deadLetter?.replayNotAfter ?? null}::timestamptz,
             ${deadLetter?.expiresAt ?? null}::timestamptz,
             ${outcome.completedAt}::timestamptz
        from public.inbox_v2_source_processing_work_heads work
        join attempt_inserted attempt
          on attempt.tenant_id = work.tenant_id
         and attempt.work_id = work.work_id
       where ${outcome.kind} = 'dead_lettered'
         and work.tenant_id = ${attempt.scope.tenantId}
         and work.work_id = ${attempt.workId}
      returning tenant_id, id, work_id
    ),
    work_updated as materialized (
      update public.inbox_v2_source_processing_work_heads work
         set state = ${nextWorkState}::
               public.inbox_v2_source_processing_work_state,
             available_at = case when ${outcome.kind} = 'retry_scheduled'
               then ${nextAttemptAt}::timestamptz
               else ${outcome.completedAt}::timestamptz end,
             lease_owner_id = null, lease_token_hash = null,
             lease_revision = null, lease_claimed_at = null,
             lease_expires_at = null,
             last_diagnostic_code_id = ${diagnostic?.codeId ?? null},
             retryability = ${retryability}::
               public.inbox_v2_source_processing_retryability,
             rate_limit_reset_at = ${rateLimitResetAt}::timestamptz,
             dead_lettered_at = case when ${outcome.kind} = 'dead_lettered'
               then ${outcome.completedAt}::timestamptz else null end,
             completed_at = case
               when ${outcome.kind} in ('processed', 'ignored', 'duplicate')
                 then ${outcome.completedAt}::timestamptz
               else null end,
             revision = work.revision + 1,
             updated_at = ${outcome.completedAt}::timestamptz
        from attempt_inserted attempt
       where work.tenant_id = ${attempt.scope.tenantId}
         and work.work_id = ${attempt.workId}
         and work.state = 'leased'
         and work.lease_owner_id = ${attempt.workerId}
         and work.lease_token_hash = ${tokenHash}
         and work.lease_revision = ${attempt.leaseRevision}::bigint
         and work.lease_expires_at > (select db_now from db_fence)
         and work.revision = ${attempt.workRevision}::bigint
      returning work.tenant_id, work.work_id,
                work.source_connection_id, work.source_account_scope_key,
                work.revision::text as revision
    ),
    connection_rate_limit_fence as materialized (
      select work.tenant_id, work.source_connection_id,
             work.source_account_scope_key as current_account_scope_key,
             greatest(
               ${rateLimitResetAt}::timestamptz,
               max(pressure.rate_limit_reset_at) filter (
                 where pressure.state = 'rate_limited'
               )
             ) as retry_at,
             max(pressure.max_in_flight)::integer as max_in_flight,
             max(pressure.max_queued)::integer as max_queued
        from work_updated work
        join public.inbox_v2_source_account_pressure_heads pressure
          on pressure.tenant_id = work.tenant_id
         and pressure.source_connection_id = work.source_connection_id
       where ${rateLimitScope}::text = 'source_connection'
       group by work.tenant_id, work.source_connection_id,
                work.source_account_scope_key
    ),
    connection_fence_head_inserted as materialized (
      insert into public.inbox_v2_source_account_pressure_heads (
        tenant_id, source_connection_id, source_account_id,
        source_account_scope_key, state, max_in_flight, in_flight,
        max_queued, queued, consecutive_failure_count, backoff_until,
        rate_limit_reset_at, last_diagnostic_code_id, revision,
        created_at, updated_at
      )
      select fence.tenant_id, fence.source_connection_id, null, '0:',
             'rate_limited', fence.max_in_flight, 0,
             fence.max_queued, 0, 0, null, fence.retry_at,
             ${diagnostic?.codeId ?? null}, 1,
             ${outcome.completedAt}::timestamptz,
             ${outcome.completedAt}::timestamptz
        from connection_rate_limit_fence fence
      on conflict (tenant_id, source_connection_id,
                   source_account_scope_key) do nothing
      returning tenant_id, source_connection_id, source_account_scope_key
    ),
    current_pressure_updated as materialized (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = case
               when pressure.state = 'rate_limited'
                and pressure.rate_limit_reset_at > greatest(
                    ${outcome.completedAt}::timestamptz,
                    pressure.updated_at + interval '1 millisecond'
                )
                and ${pressureState}::text <> 'rate_limited'
                 then 'rate_limited'
               else ${pressureState}
             end::public.inbox_v2_source_account_pressure_state,
              in_flight = pressure.in_flight - 1,
              max_queued = greatest(
                pressure.max_queued,
                pressure.queued + case
                  when ${outcome.kind} = 'retry_scheduled' then 1 else 0 end
              ),
              queued = pressure.queued + case
               when ${outcome.kind} = 'retry_scheduled' then 1 else 0 end,
             consecutive_failure_count = case
               when ${outcome.kind} in ('processed', 'ignored', 'duplicate')
                 then 0 else pressure.consecutive_failure_count + 1 end,
              backoff_until = case
                when pressure.state = 'rate_limited'
                 and pressure.rate_limit_reset_at > greatest(
                     ${outcome.completedAt}::timestamptz,
                     pressure.updated_at + interval '1 millisecond'
                 )
                 and ${pressureState}::text <> 'rate_limited'
                  then null
                when ${pressureState}::text = 'paused'
                  then ${nextAttemptAt}::timestamptz else null end,
              rate_limit_reset_at = case
                when ${pressureState}::text = 'rate_limited'
                  then greatest(
                    connection_fence.retry_at,
                    ${rateLimitResetAt}::timestamptz,
                    case when pressure.state = 'rate_limited'
                         then pressure.rate_limit_reset_at end
                  )
                when pressure.state = 'rate_limited'
                 and pressure.rate_limit_reset_at > greatest(
                     ${outcome.completedAt}::timestamptz,
                     pressure.updated_at + interval '1 millisecond'
                 )
                  then pressure.rate_limit_reset_at
                else null end,
             last_diagnostic_code_id = case
               when pressure.state = 'rate_limited'
                and pressure.rate_limit_reset_at > greatest(
                    ${outcome.completedAt}::timestamptz,
                    pressure.updated_at + interval '1 millisecond'
                )
                and ${pressureState}::text <> 'rate_limited'
                 then pressure.last_diagnostic_code_id
               else ${diagnostic?.codeId ?? null}
             end,
             revision = pressure.revision + 1,
             updated_at = greatest(
               ${outcome.completedAt}::timestamptz,
               pressure.updated_at + interval '1 millisecond'
             )
        from work_updated work
        left join connection_rate_limit_fence connection_fence
          on connection_fence.tenant_id = work.tenant_id
         and connection_fence.source_connection_id =
             work.source_connection_id
       where pressure.tenant_id = work.tenant_id
         and pressure.source_connection_id = work.source_connection_id
         and pressure.source_account_scope_key = work.source_account_scope_key
         and pressure.in_flight > 0
       returning pressure.tenant_id, pressure.source_connection_id,
                 pressure.source_account_scope_key
    ),
    sibling_pressure_updated as materialized (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = 'rate_limited', backoff_until = null,
             rate_limit_reset_at = connection_fence.retry_at,
             last_diagnostic_code_id = ${diagnostic?.codeId ?? null},
             revision = pressure.revision + 1,
             updated_at = greatest(
               ${outcome.completedAt}::timestamptz,
               pressure.updated_at + interval '1 millisecond'
             )
        from connection_rate_limit_fence connection_fence
       where pressure.tenant_id = connection_fence.tenant_id
         and pressure.source_connection_id =
             connection_fence.source_connection_id
         and pressure.source_account_scope_key <>
             connection_fence.current_account_scope_key
         and greatest(
               ${outcome.completedAt}::timestamptz,
               pressure.updated_at + interval '1 millisecond'
             ) < connection_fence.retry_at
       returning pressure.tenant_id, pressure.source_connection_id,
                 pressure.source_account_scope_key
    )
    select work.tenant_id, work.work_id, work.revision
      from work_updated work
      join current_pressure_updated pressure
        on pressure.tenant_id = work.tenant_id
       and pressure.source_connection_id = work.source_connection_id
       and pressure.source_account_scope_key = work.source_account_scope_key
     where (${outcome.kind} <> 'dead_lettered'
       or exists (select 1 from dlq_inserted))
  `;
}

function runtimeWorkLockColumns(): SQL {
  return sql.raw(`
    work.tenant_id,
    work.work_id,
    work.raw_event_id,
    work.normalized_event_id,
    work.stage::text as stage,
    work.source_connection_id,
    work.source_account_id,
    work.source_account_scope_key,
    work.state::text as state,
    work.processing_generation::text as processing_generation,
    work.max_attempts,
    work.attempt_count::text as attempt_count,
    work.lease_owner_id,
    work.lease_token_hash,
    work.lease_revision::text as lease_revision,
    work.lease_claimed_at,
    work.lease_expires_at,
    work.revision::text as revision,
    work.updated_at
  `);
}

type ReplayRequestRow = Record<string, unknown> & { db_now: unknown };

function replayDiagnostic(
  request: InboxV2SourceReplayRequest,
  reason: Exclude<
    InboxV2SourceReplayResult,
    { outcome: "queued" | "idempotent_replay" }
  >["reason"]
): InboxV2SafeSourceDiagnostic {
  return inboxV2SafeSourceDiagnosticSchema.parse({
    codeId: `core:source-replay.${reason.replaceAll("_", "-")}`,
    retryable: false,
    correlationToken: request.requestId,
    safeOperatorHintId: null
  });
}

function rejectedReplayResult(
  request: InboxV2SourceReplayRequest,
  reason: Extract<InboxV2SourceReplayResult, { outcome: "rejected" }>["reason"],
  diagnostic: InboxV2SafeSourceDiagnostic,
  decidedAt: string
): InboxV2SourceReplayResult {
  return inboxV2SourceReplayResultSchema.parse({
    requestId: request.requestId,
    requestHash: request.requestHash,
    target: request.target,
    expectedTargetRevision: request.expectedTargetRevision,
    decidedAt,
    outcome: "rejected",
    reason,
    diagnostic
  });
}

export function buildLockInboxV2SourceReplayRequestSql(
  request: InboxV2SourceReplayRequest
): SQL {
  const parsed = inboxV2SourceReplayRequestSchema.parse(request);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select existing.*, existing.mode::text as mode_text,
           existing.stage::text as stage_text,
           existing.requested_by_kind::text as requested_by_kind_text,
           existing.state::text as state_text,
           existing.rejection_reason::text as rejection_reason_text,
           existing.diagnostic_retryability::text as
             diagnostic_retryability_text,
           work.source_connection_id as result_source_connection_id,
           work.source_account_id as result_source_account_id,
           db_clock.db_now
      from public.inbox_v2_source_replay_requests existing
      cross join db_clock
      left join public.inbox_v2_source_processing_work_heads work
        on work.tenant_id = existing.tenant_id
       and work.work_id = existing.result_work_id
     where existing.tenant_id = ${parsed.target.scope.tenantId}
       and (existing.id = ${parsed.requestId}
         or existing.request_hash = ${parsed.requestHash})
     order by case when existing.id = ${parsed.requestId} then 0 else 1 end,
              existing.id collate "C"
     for update of existing
  `;
}

function existingReplayMatchesRequest(
  row: ReplayRequestRow,
  request: InboxV2SourceReplayRequest
): boolean {
  const target = request.target;
  const actor = request.requestedBy;
  return (
    stringValue(row.id, "replay request id") === request.requestId &&
    stringValue(row.request_hash, "replay request hash") ===
      request.requestHash &&
    stringValue(row.mode_text, "replay target mode") === target.kind &&
    stringValue(row.tenant_id, "replay tenant") === target.scope.tenantId &&
    stringValue(row.raw_event_id, "replay raw event") ===
      target.scope.rawEventId &&
    nullableString(row.normalized_event_id, "replay normalized event") ===
      target.scope.normalizedEventId &&
    stringValue(row.source_connection_id, "replay source connection") ===
      target.scope.sourceConnectionId &&
    nullableString(row.source_account_id, "replay source account") ===
      target.scope.sourceAccountId &&
    (target.kind !== "dead_letter" ||
      row.dead_letter_id === null ||
      nullableString(row.dead_letter_id, "replay dead letter") ===
        target.deadLetterId) &&
    stringValue(row.stage_text, "replay stage") === target.scope.stage &&
    bigintText(row.expected_target_revision, "replay expected revision") ===
      request.expectedTargetRevision &&
    stringValue(row.reason_id, "replay reason") === request.reasonId &&
    stringValue(row.requested_by_kind_text, "replay actor kind") ===
      actor.kind &&
    nullableString(row.requested_by_employee_id, "replay employee") ===
      (actor.kind === "employee" ? actor.employee.id : null) &&
    nullableString(row.requested_by_trusted_service_id, "replay service") ===
      (actor.kind === "trusted_service" ? actor.trustedServiceId : null) &&
    timestampValue(row.requested_at, "replay requestedAt") ===
      request.requestedAt &&
    (row.result_work_id === null ||
      (stringValue(
        row.result_source_connection_id,
        "replay result connection"
      ) === target.scope.sourceConnectionId &&
        nullableString(
          row.result_source_account_id,
          "replay result account"
        ) === target.scope.sourceAccountId))
  );
}

function mapExistingReplayResult(
  rows: readonly ReplayRequestRow[],
  request: InboxV2SourceReplayRequest
): InboxV2SourceReplayResult | null {
  if (rows.length === 0) return null;
  if (rows.length !== 1 || !existingReplayMatchesRequest(rows[0]!, request)) {
    const decidedAt = timestampValue(rows[0]!.db_now, "replay database clock");
    return rejectedReplayResult(
      request,
      "idempotency_conflict",
      replayDiagnostic(request, "idempotency_conflict"),
      decidedAt
    );
  }
  const row = rows[0]!;
  const state = stringValue(row.state_text, "replay state");
  if (state === "applied") {
    return inboxV2SourceReplayResultSchema.parse({
      requestId: request.requestId,
      requestHash: request.requestHash,
      target: request.target,
      expectedTargetRevision: request.expectedTargetRevision,
      decidedAt: timestampValue(row.completed_at, "replay completedAt"),
      outcome: "idempotent_replay",
      replayEpisodeId: stringValue(
        row.result_replay_episode_id,
        "replay episode"
      ),
      workId: stringValue(row.result_work_id, "replay work"),
      workRevision: bigintText(
        row.result_work_revision,
        "replay work revision"
      ),
      queuedAt: timestampValue(row.completed_at, "replay queuedAt"),
      availableAt: timestampValue(row.available_at, "replay availableAt"),
      diagnostic: null
    });
  }
  if (state === "denied" || state === "expired") {
    const diagnostic = inboxV2SafeSourceDiagnosticSchema.parse({
      codeId: stringValue(row.diagnostic_code_id, "replay diagnostic"),
      retryable:
        stringValue(row.diagnostic_retryability_text, "replay retryability") ===
        "retryable",
      correlationToken: stringValue(
        row.diagnostic_correlation_token,
        "replay diagnostic correlation"
      ),
      safeOperatorHintId: nullableString(
        row.diagnostic_safe_operator_hint_id,
        "replay operator hint"
      )
    });
    return rejectedReplayResult(
      request,
      stringValue(
        row.rejection_reason_text,
        "replay rejection reason"
      ) as Extract<
        InboxV2SourceReplayResult,
        { outcome: "rejected" }
      >["reason"],
      diagnostic,
      timestampValue(row.completed_at, "replay completedAt")
    );
  }
  throw invariantError("A replay request was found in a non-terminal state.");
}

function replayTargetPhase(
  target: InboxV2SourceReplayRequest["target"]
): "raw" | "normalized" {
  if (target.kind === "raw_event") return "raw";
  if (target.kind === "normalized_event") return "normalized";
  return target.scope.stage === "raw_ingest" ||
    target.scope.stage === "normalization"
    ? "raw"
    : "normalized";
}

export function buildPersistInboxV2ReplayAuthorizationDenialSql(input: {
  request: InboxV2SourceReplayRequest;
  decision: Extract<
    InboxV2SourceReplayAuthorizationDecision,
    { outcome: "denied" }
  >;
  retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
}): SQL {
  const request = inboxV2SourceReplayRequestSchema.parse(input.request);
  const retention = parseRetentionPolicy(input.retentionPolicy);
  const decision = inboxV2SourceReplayAuthorizationDecisionSchema.parse(
    input.decision
  );
  if (decision.outcome !== "denied") {
    throw new TypeError(
      "Replay denial persistence requires a denial decision."
    );
  }
  if (Date.parse(decision.decidedAt) < Date.parse(request.requestedAt)) {
    throw new TypeError("Replay authorization cannot predate its request.");
  }
  const target = request.target;
  const scope = target.scope;
  const targetPhase = replayTargetPhase(target);
  const employeeId =
    request.requestedBy.kind === "employee"
      ? request.requestedBy.employee.id
      : null;
  const trustedServiceId =
    request.requestedBy.kind === "trusted_service"
      ? request.requestedBy.trustedServiceId
      : null;
  const deadLetterId =
    target.kind === "dead_letter" ? target.deadLetterId : null;
  const retryability = decision.diagnostic.retryable
    ? "retryable"
    : "not_retryable";
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    target_work as materialized (
      select work.*
        from public.inbox_v2_source_processing_work_heads work
       where work.tenant_id = ${scope.tenantId}
         and work.raw_event_id = ${scope.rawEventId}
         and work.normalized_event_id is not distinct from
             ${scope.normalizedEventId}
         and work.stage = ${scope.stage}
         and work.source_connection_id = ${scope.sourceConnectionId}
         and work.source_account_id is not distinct from
             ${scope.sourceAccountId}
       order by work.work_id collate "C"
       limit 2
       for share
    ),
    exact_dlq as materialized (
      select dead_letter.*
        from target_work work
        join public.inbox_v2_source_processing_dead_letters dead_letter
          on dead_letter.tenant_id = work.tenant_id
         and dead_letter.work_id = work.work_id
         and dead_letter.raw_event_id = work.raw_event_id
         and dead_letter.stage = work.stage
         and dead_letter.processing_generation = work.processing_generation
         and dead_letter.attempt_number = work.attempt_count
         and dead_letter.work_revision = work.revision
         and (${target.kind !== "dead_letter"}
           or dead_letter.id = ${deadLetterId})
    ),
    lifecycle as materialized (
      select skeleton.replay_until, skeleton.guarantee_until,
             skeleton.skeleton_expires_at,
             exact_dlq.id as exact_dead_letter_id,
             exact_dlq.replay_not_after as dlq_replay_not_after,
             exact_dlq.expires_at as dlq_expires_at
        from target_work work
        left join lateral (
          select stored.*
            from public.inbox_v2_source_delivery_dedupe_skeletons stored
           where stored.tenant_id = work.tenant_id
             and stored.source_connection_id = work.source_connection_id
             and stored.source_account_id is not distinct from
                 work.source_account_id
             and stored.source_account_scope_key =
                 work.source_account_scope_key
             and stored.phase = ${targetPhase}
             and stored.raw_event_id = work.raw_event_id
             and stored.normalized_event_id is not distinct from
                 work.normalized_event_id
             and stored.purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
           order by stored.terminal_at desc, stored.id collate "C"
           limit 1
        ) skeleton on true
        left join exact_dlq on true
    ),
    denial as materialized (
      insert into public.inbox_v2_source_replay_requests (
        tenant_id, id, target_work_id, mode, raw_event_id,
        normalized_event_id, normalized_event_scope_key,
        source_connection_id, source_account_id,
        source_account_scope_key, dead_letter_id, stage,
        expected_target_revision, route_generation, request_hash,
        reason_id, requested_by_kind,
        requested_by_employee_id, requested_by_trusted_service_id,
        state, available_at, replay_not_after, expires_at,
        lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
        lease_expires_at, result_processing_generation,
        result_replay_episode_id, result_work_id, result_work_revision,
        rejection_reason, diagnostic_code_id, diagnostic_retryability,
        diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, revision, requested_at,
        updated_at, completed_at
      )
      select work.tenant_id, ${request.requestId}, work.work_id,
             ${target.kind}, work.raw_event_id, work.normalized_event_id,
             work.normalized_event_scope_key, work.source_connection_id,
             work.source_account_id, work.source_account_scope_key,
             lifecycle.exact_dead_letter_id,
             work.stage, ${request.expectedTargetRevision}::bigint,
             work.route_generation, ${request.requestHash},
             ${request.reasonId}, ${request.requestedBy.kind},
             ${employeeId}, ${trustedServiceId}, 'denied',
             ${decision.decidedAt}::timestamptz,
             coalesce(lifecycle.dlq_replay_not_after,
                      lifecycle.replay_until,
                      lifecycle.guarantee_until,
                      lifecycle.skeleton_expires_at,
                      ${decision.decidedAt}::timestamptz),
             coalesce(
               lifecycle.dlq_expires_at,
               db_clock.db_now + make_interval(
                 secs => ${retention.replayRequestRetentionSeconds}
               )
             ),
             null, null, null, null, null, null, null, null, null,
             'scope_mismatch', ${decision.diagnostic.codeId},
             ${retryability}, ${decision.diagnostic.correlationToken},
             ${decision.diagnostic.safeOperatorHintId}, 1,
             ${request.requestedAt}::timestamptz,
             ${decision.decidedAt}::timestamptz,
             ${decision.decidedAt}::timestamptz
        from target_work work cross join lifecycle cross join db_clock
       where (select count(*) from target_work) = 1
         and ${decision.decidedAt}::timestamptz <= db_clock.db_now
      returning id
    )
    select id from denial
  `;
}

async function persistReplayAuthorizationDenial(
  executor: RawSqlExecutor,
  request: InboxV2SourceReplayRequest,
  decision: Extract<
    InboxV2SourceReplayAuthorizationDecision,
    { outcome: "denied" }
  >,
  retentionPolicy: InboxV2SourceProcessingRetentionPolicy
): Promise<InboxV2SourceReplayResult> {
  const existing = await executor.execute<ReplayRequestRow>(
    buildLockInboxV2SourceReplayRequestSql(request)
  );
  // A current denial takes precedence over replay idempotency. Never disclose
  // whether the same request was applied previously, and never mutate that
  // immutable prior decision.
  if (existing.rows.length > 0) {
    return rejectedReplayResult(
      request,
      "scope_mismatch",
      decision.diagnostic,
      decision.decidedAt
    );
  }
  const inserted = await executor.execute<Record<string, unknown>>(
    buildPersistInboxV2ReplayAuthorizationDenialSql({
      request,
      decision,
      retentionPolicy
    })
  );
  if (inserted.rows.length > 1) {
    throw invariantError("Replay authorization denial escaped exact scope.");
  }
  return rejectedReplayResult(
    request,
    "scope_mismatch",
    decision.diagnostic,
    decision.decidedAt
  );
}

export function buildApplyInboxV2SourceReplaySql(input: {
  request: InboxV2SourceReplayRequest;
  replayEpisodeId: string;
  retentionPolicy: InboxV2SourceProcessingRetentionPolicy;
}): SQL {
  const request = inboxV2SourceReplayRequestSchema.parse(input.request);
  const retention = parseRetentionPolicy(input.retentionPolicy);
  inboxV2SourceReplayEpisodeIdSchema.parse(input.replayEpisodeId);
  const target = request.target;
  const scope = target.scope;
  const isDeadLetter = target.kind === "dead_letter";
  const targetPhase = replayTargetPhase(target);
  const usesRawEvidence = targetPhase === "raw";
  const requestedByEmployeeId =
    request.requestedBy.kind === "employee"
      ? request.requestedBy.employee.id
      : null;
  const requestedByTrustedServiceId =
    request.requestedBy.kind === "trusted_service"
      ? request.requestedBy.trustedServiceId
      : null;
  const deadLetterId = isDeadLetter ? target.deadLetterId : null;
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    target_work as materialized (
      select work.*, work.state::text as state_text, db_clock.db_now
        from public.inbox_v2_source_processing_work_heads work
        cross join db_clock
       where work.tenant_id = ${scope.tenantId}
         and work.raw_event_id = ${scope.rawEventId}
         and work.normalized_event_id is not distinct from
             ${scope.normalizedEventId}
         and work.stage = ${scope.stage}
         and work.source_connection_id = ${scope.sourceConnectionId}
         and work.source_account_id is not distinct from
             ${scope.sourceAccountId}
       order by work.work_id collate "C"
       limit 2
       for update of work
    ),
    skeleton as materialized (
      select candidate.*,
             key.state::text as key_state,
             key.verify_until as generation_verify_until
        from target_work work
        left join lateral (
          select skeleton.*
            from public.inbox_v2_source_delivery_dedupe_skeletons skeleton
           where skeleton.tenant_id = work.tenant_id
             and skeleton.source_connection_id = work.source_connection_id
             and skeleton.source_account_id is not distinct from
                 work.source_account_id
             and skeleton.source_account_scope_key =
                 work.source_account_scope_key
             and skeleton.phase = ${targetPhase}
             and skeleton.raw_event_id = work.raw_event_id
             and skeleton.normalized_event_id is not distinct from
                 work.normalized_event_id
             and skeleton.purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
           order by skeleton.terminal_at desc, skeleton.id collate "C"
           limit 1
        ) candidate on true
        left join public.inbox_v2_source_processing_key_generations key
          on key.tenant_id = candidate.tenant_id
         and key.purpose_id = candidate.purpose_id
         and key.generation = candidate.key_generation
    ),
    dlq as materialized (
      select dead_letter.*
        from target_work work
        join public.inbox_v2_source_processing_dead_letters dead_letter
          on dead_letter.tenant_id = work.tenant_id
         and dead_letter.work_id = work.work_id
         and dead_letter.raw_event_id = work.raw_event_id
         and dead_letter.stage = work.stage
         and dead_letter.processing_generation = work.processing_generation
         and dead_letter.attempt_number = work.attempt_count
         and dead_letter.work_revision = work.revision
         and (${!isDeadLetter} or dead_letter.id = ${deadLetterId})
    ),
    raw_evidence as materialized (
      select evidence.tenant_id, evidence.raw_event_id
        from public.inbox_v2_source_raw_evidence evidence
       where evidence.tenant_id = ${scope.tenantId}
         and evidence.raw_event_id = ${scope.rawEventId}
         and evidence.evidence_kind = 'provider_payload'
         and evidence.purpose_ids ? ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
    ),
    normalized_evidence as materialized (
      select payload.tenant_id, payload.normalized_event_id
        from public.inbox_v2_source_normalized_evidence_payloads payload
        join public.inbox_v2_source_normalized_evidence evidence
          on evidence.tenant_id = payload.tenant_id
         and evidence.normalized_event_id = payload.normalized_event_id
         and evidence.evidence_key = payload.evidence_key
       where payload.tenant_id = ${scope.tenantId}
         and payload.normalized_event_id = ${scope.normalizedEventId}
         and evidence.purpose_ids ? ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
       limit 1
    ),
    classified as materialized (
      select db_clock.db_now,
             case
               when (select count(*) from target_work) <> 1
                 then 'scope_mismatch'
               when (select revision from target_work) <>
                    ${request.expectedTargetRevision}::bigint
                 then 'revision_conflict'
               when (select state_text from target_work) <> 'dead_lettered'
                 then 'target_not_replayable'
               when (select id from dlq) is null
                 then case when ${isDeadLetter}
                           then 'replay_expired'
                           else 'target_not_replayable' end
               when (select id from skeleton) is null
                 then 'target_not_replayable'
               when (select outcome from skeleton) <> 'dead_lettered'
                 then 'target_not_replayable'
               when (select lifecycle_state from skeleton) <> 'active'
                 or (select replayability_state from skeleton) <> 'replayable'
                 or (select replay_until from skeleton) <= db_clock.db_now
                 or (select skeleton_expires_at from skeleton) <= db_clock.db_now
                 or (select guarantee_until from skeleton) <= db_clock.db_now
                 then 'replay_expired'
               when (select key_state from skeleton) not in
                    ('active', 'verify_only')
                 or (select generation_verify_until from skeleton) <=
                    db_clock.db_now
                 or (select key_verify_until from skeleton) <= db_clock.db_now
                 then 'key_unavailable'
               when (${usesRawEvidence} and (
                    (select raw_payload_expires_at from skeleton) <=
                      db_clock.db_now
                    or not exists (select 1 from raw_evidence)))
                 or (not ${usesRawEvidence} and (
                    (select normalized_payload_expires_at from skeleton) is null
                    or (select normalized_payload_expires_at from skeleton) <=
                      db_clock.db_now
                    or not exists (select 1 from normalized_evidence)))
                 then 'evidence_unavailable'
               when ${isDeadLetter} and (
                    (select id from dlq) is null
                    or (select replay_not_after from dlq) <= db_clock.db_now
                    or (select expires_at from dlq) <= db_clock.db_now)
                 then 'replay_expired'
               when (select queued from public.inbox_v2_source_account_pressure_heads
                      where tenant_id = ${scope.tenantId}
                        and source_connection_id = ${scope.sourceConnectionId}
                        and source_account_scope_key =
                          (select source_account_scope_key from target_work)) >=
                    (select max_queued from public.inbox_v2_source_account_pressure_heads
                      where tenant_id = ${scope.tenantId}
                        and source_connection_id = ${scope.sourceConnectionId}
                        and source_account_scope_key =
                          (select source_account_scope_key from target_work))
                 then 'target_not_replayable'
               when ${request.requestedAt}::timestamptz > db_clock.db_now
                 then 'scope_mismatch'
               else null
             end::text as rejection_reason,
             case
               when (${isDeadLetter} and (select id from dlq) is null)
                 or (select replay_until from skeleton) <= db_clock.db_now
                 or (select guarantee_until from skeleton) <= db_clock.db_now
                 or (select skeleton_expires_at from skeleton) <=
                    db_clock.db_now
                 then least(
                   db_clock.db_now,
                   coalesce((select replay_until from skeleton),
                            (select guarantee_until from skeleton),
                            (select skeleton_expires_at from skeleton),
                            db_clock.db_now)
                 )
               else coalesce(
                 (select replay_not_after from dlq),
                 (select replay_until from skeleton),
                 (select guarantee_until from skeleton),
                 (select skeleton_expires_at from skeleton),
                 db_clock.db_now
               )
             end as replay_not_after
        from db_clock
    ),
    request_inserted as materialized (
      insert into public.inbox_v2_source_replay_requests (
        tenant_id, id, target_work_id, mode, raw_event_id,
        normalized_event_id, normalized_event_scope_key,
        source_connection_id, source_account_id,
        source_account_scope_key, dead_letter_id, stage,
        expected_target_revision, route_generation, request_hash,
        reason_id, requested_by_kind,
        requested_by_employee_id, requested_by_trusted_service_id,
        state, available_at, replay_not_after, expires_at,
        lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
        lease_expires_at, result_processing_generation,
        result_replay_episode_id, result_work_id, result_work_revision,
        rejection_reason, diagnostic_code_id, diagnostic_retryability,
        diagnostic_correlation_token,
        diagnostic_safe_operator_hint_id, revision, requested_at,
        updated_at, completed_at
      )
      select work.tenant_id, ${request.requestId}, work.work_id,
             ${target.kind}, work.raw_event_id, work.normalized_event_id,
             work.normalized_event_scope_key, work.source_connection_id,
             work.source_account_id, work.source_account_scope_key,
             (select id from dlq),
             work.stage, ${request.expectedTargetRevision}::bigint,
             work.route_generation, ${request.requestHash}, ${request.reasonId},
             ${request.requestedBy.kind},
             ${requestedByEmployeeId}, ${requestedByTrustedServiceId},
             case when classified.rejection_reason = 'replay_expired'
                    then 'expired'::public.inbox_v2_source_replay_state
                  when classified.rejection_reason is null
                    then 'pending'::public.inbox_v2_source_replay_state
                  else 'denied'::public.inbox_v2_source_replay_state end,
             case when classified.rejection_reason is null
                    then ${request.requestedAt}::timestamptz
                  else classified.db_now end,
             case when classified.rejection_reason is null
                    then (select replay_not_after from dlq)
                  else classified.replay_not_after end,
             coalesce(
               (select expires_at from dlq),
               classified.db_now + make_interval(
                 secs => ${retention.replayRequestRetentionSeconds}
               )
             ),
             null, null, null, null, null, null, null, null, null,
             classified.rejection_reason::
               public.inbox_v2_source_replay_rejection_reason,
             case when classified.rejection_reason is null then null
                  else 'core:source-replay.' ||
                    replace(classified.rejection_reason, '_', '-') end,
             case when classified.rejection_reason is null then null
                  else 'not_retryable'::
                    public.inbox_v2_source_processing_retryability end,
             case when classified.rejection_reason is null then null
                  else ${request.requestId} end,
             null, 1,
             ${request.requestedAt}::timestamptz,
             case when classified.rejection_reason is null
                    then ${request.requestedAt}::timestamptz
                  else classified.db_now end,
             case when classified.rejection_reason is null
                    then null else classified.db_now end
        from target_work work cross join classified
       where (select count(*) from target_work) = 1
      returning *
    )
    select case when inserted.state = 'pending' then 'pending'
                else 'rejected' end::text as outcome,
           inserted.id, inserted.request_hash,
           inserted.rejection_reason::text as rejection_reason,
           classified.db_now
      from request_inserted inserted cross join classified
    union all
    select 'rejected', null, ${request.requestHash},
           classified.rejection_reason, classified.db_now
      from classified
     where not exists (select 1 from request_inserted)
  `;
}

export function buildLeaseInboxV2SourceReplaySql(input: {
  request: InboxV2SourceReplayRequest;
  tokenHash: string;
}): SQL {
  const request = inboxV2SourceReplayRequestSchema.parse(input.request);
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    leased as materialized (
      update public.inbox_v2_source_replay_requests replay
         set state = 'leased', lease_owner_id = ${REPLAY_LEASE_OWNER_ID},
             lease_token_hash = ${tokenHash},
             lease_revision = replay.revision + 1,
             lease_claimed_at = db_clock.db_now,
             lease_expires_at = least(
               db_clock.db_now + make_interval(
                 secs => ${REPLAY_LEASE_DURATION_SECONDS}
               ),
               replay.replay_not_after
             ),
             revision = replay.revision + 1,
             updated_at = db_clock.db_now
        from db_clock
       where replay.tenant_id = ${request.target.scope.tenantId}
         and replay.id = ${request.requestId}
         and replay.request_hash = ${request.requestHash}
         and replay.state = 'pending'
         and replay.available_at <= db_clock.db_now
         and replay.replay_not_after > db_clock.db_now
      returning replay.id, replay.revision::text as revision
    )
    select id, revision from leased
  `;
}

export function buildResetInboxV2SourceReplayWorkSql(input: {
  request: InboxV2SourceReplayRequest;
  tokenHash: string;
}): SQL {
  const request = inboxV2SourceReplayRequestSchema.parse(input.request);
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    leased_request as materialized (
      select replay.*
        from public.inbox_v2_source_replay_requests replay
        cross join db_clock
       where replay.tenant_id = ${request.target.scope.tenantId}
         and replay.id = ${request.requestId}
         and replay.request_hash = ${request.requestHash}
         and replay.state = 'leased'
         and replay.lease_owner_id = ${REPLAY_LEASE_OWNER_ID}
         and replay.lease_token_hash = ${tokenHash}
         and replay.lease_expires_at > db_clock.db_now
         and replay.replay_not_after > db_clock.db_now
       for update of replay
    ),
    work_requeued as materialized (
      update public.inbox_v2_source_processing_work_heads work
         set state = 'pending',
             processing_generation = work.processing_generation + 1,
             attempt_count = 0, available_at = db_clock.db_now,
             lease_owner_id = null, lease_token_hash = null,
             lease_revision = null, lease_claimed_at = null,
             lease_expires_at = null, last_diagnostic_code_id = null,
             retryability = null, rate_limit_reset_at = null,
             dead_lettered_at = null, completed_at = null,
             revision = work.revision + 1, updated_at = db_clock.db_now
        from leased_request replay cross join db_clock
       where work.tenant_id = replay.tenant_id
         and work.work_id = replay.target_work_id
         and work.raw_event_id = replay.raw_event_id
         and work.normalized_event_scope_key =
             replay.normalized_event_scope_key
         and work.stage = replay.stage
         and work.source_connection_id = replay.source_connection_id
         and work.source_account_scope_key = replay.source_account_scope_key
         and work.route_generation = replay.route_generation
         and work.revision = replay.expected_target_revision
         and work.state = 'dead_lettered'
      returning work.*
    ),
    pressure_updated as materialized (
      update public.inbox_v2_source_account_pressure_heads pressure
         set state = 'open', queued = pressure.queued + 1,
             backoff_until = null, rate_limit_reset_at = null,
             last_diagnostic_code_id = null,
             revision = pressure.revision + 1,
             updated_at = work.updated_at
        from work_requeued work
       where pressure.tenant_id = work.tenant_id
         and pressure.source_connection_id = work.source_connection_id
         and pressure.source_account_scope_key =
             work.source_account_scope_key
         and pressure.queued < pressure.max_queued
      returning pressure.tenant_id, pressure.source_connection_id,
                pressure.source_account_scope_key
    )
    select work.tenant_id, work.work_id,
           work.processing_generation::text as processing_generation,
           work.revision::text as result_work_revision,
           work.updated_at as available_at, db_clock.db_now
      from work_requeued work
      join pressure_updated pressure
        on pressure.tenant_id = work.tenant_id
       and pressure.source_connection_id = work.source_connection_id
       and pressure.source_account_scope_key = work.source_account_scope_key
      cross join db_clock
  `;
}

export function buildFinalizeInboxV2SourceReplaySql(input: {
  request: InboxV2SourceReplayRequest;
  replayEpisodeId: string;
  tokenHash: string;
}): SQL {
  const request = inboxV2SourceReplayRequestSchema.parse(input.request);
  const replayEpisodeId = inboxV2SourceReplayEpisodeIdSchema.parse(
    input.replayEpisodeId
  );
  const tokenHash = inboxV2Sha256DigestSchema.parse(input.tokenHash);
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    finalized as materialized (
      update public.inbox_v2_source_replay_requests replay
         set state = 'applied', available_at = db_clock.db_now,
             lease_owner_id = null, lease_token_hash = null,
             lease_revision = null, lease_claimed_at = null,
             lease_expires_at = null,
             result_processing_generation = work.processing_generation,
             result_replay_episode_id = ${replayEpisodeId},
             result_work_id = work.work_id,
             result_work_revision = work.revision,
             revision = replay.revision + 1,
             updated_at = db_clock.db_now,
             completed_at = db_clock.db_now
        from public.inbox_v2_source_processing_work_heads work
        cross join db_clock
       where replay.tenant_id = ${request.target.scope.tenantId}
         and replay.id = ${request.requestId}
         and replay.request_hash = ${request.requestHash}
         and replay.state = 'leased'
         and replay.lease_owner_id = ${REPLAY_LEASE_OWNER_ID}
         and replay.lease_token_hash = ${tokenHash}
         and replay.lease_expires_at > db_clock.db_now
         and replay.replay_not_after > db_clock.db_now
         and work.tenant_id = replay.tenant_id
         and work.work_id = replay.target_work_id
         and work.state = 'pending'
         and work.processing_generation >= 2
         and work.attempt_count = 0
         and work.revision = replay.expected_target_revision + 1
      returning replay.id, replay.request_hash,
                replay.result_replay_episode_id, replay.result_work_id,
                replay.result_work_revision::text as result_work_revision,
                replay.completed_at, replay.available_at
    )
    select 'queued'::text as outcome, finalized.*,
           null::text as rejection_reason, db_clock.db_now
      from finalized cross join db_clock
  `;
}

function mapPreparedReplayResult(
  row: Record<string, unknown>,
  request: InboxV2SourceReplayRequest
): InboxV2SourceReplayResult | null {
  const outcome = stringValue(row.outcome, "replay preparation outcome");
  if (outcome === "pending") return null;
  if (outcome !== "rejected") {
    throw invariantError("Replay preparation returned an invalid outcome.");
  }
  const reason = stringValue(
    row.rejection_reason,
    "replay preparation rejection"
  ) as Extract<InboxV2SourceReplayResult, { outcome: "rejected" }>["reason"];
  return rejectedReplayResult(
    request,
    reason,
    replayDiagnostic(request, reason),
    timestampValue(row.db_now, "replay preparation database clock")
  );
}

function mapFreshReplayResult(
  row: Record<string, unknown>,
  request: InboxV2SourceReplayRequest
): InboxV2SourceReplayResult {
  const outcome = stringValue(row.outcome, "replay outcome");
  if (outcome === "rejected") {
    const reason = stringValue(
      row.rejection_reason,
      "replay rejection"
    ) as Extract<InboxV2SourceReplayResult, { outcome: "rejected" }>["reason"];
    return rejectedReplayResult(
      request,
      reason,
      replayDiagnostic(request, reason),
      timestampValue(row.db_now, "replay database clock")
    );
  }
  if (outcome !== "queued") {
    throw invariantError("Replay mutation returned an invalid outcome.");
  }
  const completedAt = timestampValue(row.completed_at, "replay completedAt");
  return inboxV2SourceReplayResultSchema.parse({
    requestId: request.requestId,
    requestHash: request.requestHash,
    target: request.target,
    expectedTargetRevision: request.expectedTargetRevision,
    decidedAt: completedAt,
    outcome: "queued",
    replayEpisodeId: stringValue(
      row.result_replay_episode_id,
      "replay episode"
    ),
    workId: stringValue(row.result_work_id, "replay work"),
    workRevision: bigintText(row.result_work_revision, "replay work revision"),
    queuedAt: completedAt,
    availableAt: timestampValue(row.available_at, "replay availableAt"),
    diagnostic: null
  });
}

async function requestReplay(
  executor: RawSqlExecutor,
  request: InboxV2SourceReplayRequest,
  replayEpisodeIdSource: InboxV2SourceReplayEpisodeIdSource,
  retentionPolicy: InboxV2SourceProcessingRetentionPolicy
): Promise<InboxV2SourceReplayResult> {
  const existing = await executor.execute<ReplayRequestRow>(
    buildLockInboxV2SourceReplayRequestSql(request)
  );
  const existingResult = mapExistingReplayResult(existing.rows, request);
  if (existingResult !== null) return existingResult;
  const replayEpisodeId = replayEpisodeIdSource(request);
  const prepared = await executor.execute<Record<string, unknown>>(
    buildApplyInboxV2SourceReplaySql({
      request,
      replayEpisodeId,
      retentionPolicy
    })
  );
  const preparationResult = mapPreparedReplayResult(
    exactlyOneRow(prepared.rows, "source-processing replay preparation"),
    request
  );
  if (preparationResult !== null) return preparationResult;

  const replayLeaseToken = inboxV2SourceProcessingLeaseTokenSchema.parse(
    exactlyOneRow(defaultLeaseTokenSource(1), "replay lease token")
  );
  const tokenHash =
    calculateInboxV2SourceProcessingLeaseTokenHash(replayLeaseToken);
  const leased = await executor.execute<Record<string, unknown>>(
    buildLeaseInboxV2SourceReplaySql({ request, tokenHash })
  );
  exactlyOneRow(leased.rows, "source-processing replay lease");
  const reset = await executor.execute<Record<string, unknown>>(
    buildResetInboxV2SourceReplayWorkSql({ request, tokenHash })
  );
  exactlyOneRow(reset.rows, "source-processing replay reset");
  const applied = await executor.execute<Record<string, unknown>>(
    buildFinalizeInboxV2SourceReplaySql({
      request,
      replayEpisodeId,
      tokenHash
    })
  );
  return mapFreshReplayResult(
    exactlyOneRow(applied.rows, "source-processing replay finalization"),
    request
  );
}

function parseCursorPersistenceInput(
  input: unknown
): InboxV2SourceCursorPersistenceInput {
  return inboxV2SourceCursorPersistenceInputSchema.parse(input);
}

function cursorTargetSource(
  target: InboxV2SourceCursorDurableTarget
): InboxV2SourceProcessingSourceScope {
  return target.kind === "raw_work" ? target.scope : target.source;
}

export function buildResolveInboxV2SourceCursorDurableTargetSql(
  rawInput: InboxV2SourceCursorDurableTargetLookupInput
): SQL {
  const input =
    inboxV2SourceCursorDurableTargetLookupInputSchema.parse(rawInput);
  const source = input.source;
  if (input.receipt.kind === "raw_work") {
    return sql`
      with db_clock as materialized (select clock_timestamp() as db_now),
      candidate as materialized (
        select work.*, work.state::text as state_text,
               envelope.safe_envelope_digest_sha256
          from public.inbox_v2_source_processing_work_heads work
          join public.inbox_v2_source_raw_envelopes envelope
            on envelope.tenant_id = work.tenant_id
           and envelope.raw_event_id = work.raw_event_id
         where work.tenant_id = ${source.tenantId}
           and work.raw_event_id = ${input.receipt.rawEventId}
           and work.stage = 'raw_ingest'
           and work.normalized_event_id is null
         order by work.work_id
         limit 2
         for share of work, envelope
      )
      select case
               when (select count(*) from candidate) = 0 then 'not_found'
               when (select count(*) from candidate) <> 1
                 then 'integrity_failure'
               when (select source_connection_id from candidate) <>
                    ${source.sourceConnectionId}
                 or (select source_account_id from candidate)
                    is distinct from ${source.sourceAccountId}
                 or (select safe_envelope_digest_sha256 from candidate) <>
                    ${input.receipt.safeEnvelopeDigest}
                 then 'mismatch'
               else 'resolved'
             end::text as outcome,
             (select work_id from candidate) as durable_work_id,
             (select revision::text from candidate) as durable_work_revision,
             (select state_text from candidate) as durable_work_state,
             (select updated_at from candidate) as persisted_at,
             db_clock.db_now as resolved_at
        from db_clock
    `;
  }
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    candidate as materialized (
      select quarantine.*, quarantine.reason_code::text as reason_code_text
        from public.inbox_v2_source_raw_quarantines quarantine
       where quarantine.tenant_id = ${source.tenantId}
         and quarantine.id = ${input.receipt.quarantineId}
       order by quarantine.id
       limit 2
       for share
    )
    select case
             when (select count(*) from candidate) = 0 then 'not_found'
             when (select count(*) from candidate) <> 1
               then 'integrity_failure'
             when (select source_connection_id from candidate) <>
                  ${source.sourceConnectionId}
               or (select source_account_id from candidate)
                  is distinct from ${source.sourceAccountId}
               or (select safe_envelope_digest_sha256 from candidate)
                  is distinct from ${input.receipt.safeEnvelopeDigest}
               or (select reason_code_text from candidate) <>
                  ${input.receipt.reasonCode}
               then 'mismatch'
             else 'resolved'
           end::text as outcome,
           (select quarantine_fingerprint_sha256 from candidate) as
             quarantine_fingerprint_sha256,
           (select recorded_at from candidate) as persisted_at,
           db_clock.db_now as resolved_at
      from db_clock
  `;
}

async function resolveCursorDurableTarget(
  executor: RawSqlExecutor,
  rawInput: InboxV2SourceCursorDurableTargetLookupInput
): Promise<InboxV2SourceCursorDurableTargetLookupResult> {
  const input =
    inboxV2SourceCursorDurableTargetLookupInputSchema.parse(rawInput);
  const result = await executor.execute<Record<string, unknown>>(
    buildResolveInboxV2SourceCursorDurableTargetSql(input)
  );
  const row = exactlyOneRow(result.rows, "source cursor durable-target lookup");
  const outcome = stringValue(
    row.outcome,
    "source cursor durable-target outcome"
  );
  if (outcome !== "resolved") {
    return inboxV2SourceCursorDurableTargetLookupResultSchema.parse({
      outcome
    });
  }
  const target = inboxV2SourceCursorDurableTargetSchema.parse(
    input.receipt.kind === "raw_work"
      ? {
          kind: "raw_work",
          scope: {
            ...input.source,
            rawEventId: input.receipt.rawEventId,
            normalizedEventId: null,
            stage: "raw_ingest"
          },
          durableWorkId: stringValue(
            row.durable_work_id,
            "cursor durable work"
          ),
          durableWorkRevision: bigintText(
            row.durable_work_revision,
            "cursor durable work revision"
          ),
          durableWorkState: stringValue(
            row.durable_work_state,
            "cursor durable work state"
          ),
          persistedAt: timestampValue(
            row.persisted_at,
            "cursor durable work time"
          )
        }
      : {
          kind: "quarantine",
          source: input.source,
          quarantineId: input.receipt.quarantineId,
          quarantineFingerprintSha256: stringValue(
            row.quarantine_fingerprint_sha256,
            "cursor quarantine fingerprint"
          ),
          reasonCode: input.receipt.reasonCode,
          persistedAt: timestampValue(
            row.persisted_at,
            "cursor quarantine time"
          )
        }
  );
  return inboxV2SourceCursorDurableTargetLookupResultSchema.parse({
    outcome: "resolved",
    target,
    resolvedAt: timestampValue(row.resolved_at, "cursor target resolution time")
  });
}

export function buildValidateInboxV2SourceCursorDurableWorkSql(
  rawInput: InboxV2SourceCursorPersistenceInput
): SQL {
  const input = parseCursorPersistenceInput(rawInput);
  const acknowledgement = input.acknowledgement;
  const target = acknowledgement.target;
  const source = cursorTargetSource(target);
  if (target.kind === "raw_work") {
    return sql`
      with db_clock as materialized (select clock_timestamp() as db_now),
      durable_work as materialized (
        select work.*, work.state::text as state_text
          from public.inbox_v2_source_processing_work_heads work
         where work.tenant_id = ${source.tenantId}
           and work.work_id = ${target.durableWorkId}
         for share
      )
      select case
               when not exists (select 1 from durable_work)
                 then 'durable_work_not_found'
               when (select stage from durable_work) <> 'raw_ingest'
                 or (select normalized_event_id from durable_work) is not null
                 or (select raw_event_id from durable_work) <>
                    ${target.scope.rawEventId}
                 or (select source_connection_id from durable_work) <>
                    ${source.sourceConnectionId}
                 or (select source_account_id from durable_work)
                    is distinct from ${source.sourceAccountId}
                 or (select revision from durable_work) <>
                    ${target.durableWorkRevision}::bigint
                 or (select state_text from durable_work) <>
                    ${target.durableWorkState}
                 or (select route_generation from durable_work) <>
                    ${input.routeGeneration}::bigint
                 or (select updated_at from durable_work) <>
                    ${target.persistedAt}::timestamptz
                 or ${target.persistedAt}::timestamptz >
                    ${acknowledgement.acknowledgedAt}::timestamptz
                 or ${acknowledgement.acknowledgedAt}::timestamptz >
                    db_clock.db_now
                 then 'durable_work_mismatch'
               else 'ready'
             end::text as outcome
        from db_clock
    `;
  }
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    durable_quarantine as materialized (
      select quarantine.*, quarantine.reason_code::text as reason_code_text
        from public.inbox_v2_source_raw_quarantines quarantine
       where quarantine.tenant_id = ${source.tenantId}
         and quarantine.id = ${target.quarantineId}
       for share
    )
    select case
             when not exists (select 1 from durable_quarantine)
               then 'durable_quarantine_not_found'
             when (select source_connection_id from durable_quarantine) <>
                  ${source.sourceConnectionId}
               or (select source_account_id from durable_quarantine)
                  is distinct from ${source.sourceAccountId}
               or (select quarantine_fingerprint_sha256 from durable_quarantine)
                  <> ${target.quarantineFingerprintSha256}
               or (select reason_code_text from durable_quarantine) <>
                  ${target.reasonCode}
               or (select recorded_at from durable_quarantine) <>
                  ${target.persistedAt}::timestamptz
               or ${target.persistedAt}::timestamptz >
                  ${acknowledgement.acknowledgedAt}::timestamptz
               or ${acknowledgement.acknowledgedAt}::timestamptz >
                  db_clock.db_now
               then 'durable_quarantine_mismatch'
             else 'ready'
           end::text as outcome
      from db_clock
  `;
}

async function validateCursorDurableWork(
  executor: RawSqlExecutor,
  input: InboxV2SourceCursorPersistenceInput
): Promise<InboxV2SourceCursorPersistenceResult | null> {
  const result = await executor.execute<Record<string, unknown>>(
    buildValidateInboxV2SourceCursorDurableWorkSql(input)
  );
  const outcome = stringValue(
    exactlyOneRow(result.rows, "source cursor durable-work validation").outcome,
    "source cursor durable-work outcome"
  );
  return outcome === "ready"
    ? null
    : inboxV2SourceCursorPersistenceResultSchema.parse({ outcome });
}

export function buildAcknowledgeInboxV2SourceCursorSql(
  rawInput: Readonly<{
    persistence: InboxV2SourceCursorPersistenceInput;
    protection: InboxV2SourceCursorProtection;
  }>
): SQL {
  const input = parseCursorPersistenceInput(rawInput.persistence);
  const protection = inboxV2SourceCursorProtectionSchema.parse(
    rawInput.protection
  );
  const acknowledgement = input.acknowledgement;
  const target = acknowledgement.target;
  const source = cursorTargetSource(target);
  if (protection.tenantId !== source.tenantId) {
    throw new TypeError("Cursor persistence and protection tenant must match.");
  }
  const durableTargetSql =
    target.kind === "raw_work"
      ? sql`
          select work.tenant_id, work.source_connection_id,
                 work.source_account_id, work.source_account_scope_key,
                 'raw_work'::text as durable_target_kind,
                 work.raw_event_id as last_durable_raw_event_id,
                 work.work_id as durable_work_id,
                 work.revision as durable_work_revision,
                 work.state::text as durable_work_state_text,
                 null::text as quarantine_id,
                 null::text as quarantine_fingerprint_sha256,
                 work.stage::text as stage_text,
                 work.normalized_event_id,
                 work.route_generation,
                 null::text as quarantine_reason_code,
                 work.updated_at as persisted_at
            from public.inbox_v2_source_processing_work_heads work
           where work.tenant_id = ${source.tenantId}
             and work.work_id = ${target.durableWorkId}
           for share
        `
      : sql`
          select quarantine.tenant_id, quarantine.source_connection_id,
                 quarantine.source_account_id,
                 quarantine.source_account_scope_key,
                 'quarantine'::text as durable_target_kind,
                 null::text as last_durable_raw_event_id,
                 null::text as durable_work_id,
                 null::bigint as durable_work_revision,
                 null::text as durable_work_state_text,
                 quarantine.id as quarantine_id,
                 quarantine.quarantine_fingerprint_sha256,
                 null::text as stage_text,
                 null::text as normalized_event_id,
                 null::bigint as route_generation,
                 quarantine.reason_code::text as quarantine_reason_code,
                 quarantine.recorded_at as persisted_at
            from public.inbox_v2_source_raw_quarantines quarantine
           where quarantine.tenant_id = ${source.tenantId}
             and quarantine.id = ${target.quarantineId}
           for share
        `;
  const targetNotFoundOutcome =
    target.kind === "raw_work"
      ? "durable_work_not_found"
      : "durable_quarantine_not_found";
  const targetMismatchOutcome =
    target.kind === "raw_work"
      ? "durable_work_mismatch"
      : "durable_quarantine_mismatch";
  const targetMismatchSql =
    target.kind === "raw_work"
      ? sql`(select stage_text from durable_target) <> 'raw_ingest'
          or (select normalized_event_id from durable_target) is not null
          or (select last_durable_raw_event_id from durable_target) <>
             ${target.scope.rawEventId}
          or (select durable_work_revision from durable_target) <>
             ${target.durableWorkRevision}::bigint
          or (select durable_work_state_text from durable_target) <>
             ${target.durableWorkState}
          or (select route_generation from durable_target) <>
             ${input.routeGeneration}::bigint
          or (select persisted_at from durable_target) <>
             ${target.persistedAt}::timestamptz`
      : sql`(select quarantine_fingerprint_sha256 from durable_target) <>
             ${target.quarantineFingerprintSha256}
          or (select quarantine_reason_code from durable_target) <>
             ${target.reasonCode}
          or (select persisted_at from durable_target) <>
             ${target.persistedAt}::timestamptz`;
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    durable_target as materialized (
      ${durableTargetSql}
    ),
    key_generation as materialized (
      select key.*
        from public.inbox_v2_source_processing_key_generations key
        cross join db_clock
       where key.tenant_id = ${source.tenantId}
         and key.purpose_id = ${INBOX_V2_SOURCE_CURSOR_PURPOSE_ID}
         and key.generation = ${protection.keyGeneration}
         and key.secret_ref = ${protection.hmacKeySecretRef}
         and key.state = 'active'
         and key.activated_at <= db_clock.db_now
         and key.use_until > db_clock.db_now
       for share of key
    ),
    existing as materialized (
      select checkpoint.*,
             checkpoint.cursor_owner::text as cursor_owner_text,
             checkpoint.cursor_kind::text as cursor_kind_text,
             checkpoint.durable_target_kind::text as
               durable_target_kind_text,
             checkpoint.durable_work_state::text as durable_work_state_text
        from durable_target target_row
        join public.inbox_v2_source_ingress_cursor_checkpoints checkpoint
          on checkpoint.tenant_id = target_row.tenant_id
         and checkpoint.source_connection_id =
             target_row.source_connection_id
         and checkpoint.source_account_scope_key =
             target_row.source_account_scope_key
         and checkpoint.cursor_slot_id = ${input.cursorSlotId}
       for update of checkpoint
    ),
    classified as materialized (
      select db_clock.db_now,
             case
               when not exists (select 1 from durable_target)
                 then ${targetNotFoundOutcome}
               when (select source_connection_id from durable_target) <>
                    ${source.sourceConnectionId}
                 or (select source_account_id from durable_target)
                    is distinct from ${source.sourceAccountId}
                 or ${targetMismatchSql}
                 or not public.inbox_v2_src_runtime_route_is_current(
                   ${source.tenantId}, ${source.sourceConnectionId},
                   ${source.sourceAccountId}, ${input.routeGeneration}::bigint
                 )
                 or ${target.persistedAt}::timestamptz >
                    ${acknowledgement.acknowledgedAt}::timestamptz
                 or ${acknowledgement.acknowledgedAt}::timestamptz >
                    db_clock.db_now
                 then ${targetMismatchOutcome}
               when not exists (select 1 from key_generation)
                 then 'key_unavailable'
               when exists (select 1 from existing)
                 and (select cursor_owner_text from existing) =
                     ${acknowledgement.cursorOwner}
                 and (select source_account_id from existing)
                     is not distinct from ${source.sourceAccountId}
                 and (select source_thread_binding_id from existing)
                     is not distinct from
                       ${acknowledgement.sourceThreadBindingId}
                 and (select cursor_kind_text from existing) =
                     ${acknowledgement.cursor.kind}
                 and (select route_generation from existing) =
                     ${input.routeGeneration}::bigint
                 and (select key_generation from existing) =
                     ${protection.keyGeneration}
                 and (select cursor_value_secret_ref from existing) =
                     ${protection.cursorValueSecretRef}
                 and (select cursor_hmac_sha256 from existing) =
                     ${protection.cursorHmacSha256}
                 and (select durable_target_kind_text from existing) =
                     (select durable_target_kind from durable_target)
                 and (select last_durable_raw_event_id from existing)
                     is not distinct from
                       (select last_durable_raw_event_id from durable_target)
                 and (select durable_work_id from existing)
                     is not distinct from
                       (select durable_work_id from durable_target)
                 and (select durable_work_revision from existing)
                     is not distinct from
                       (select durable_work_revision from durable_target)
                 and (select durable_work_state_text from existing)
                     is not distinct from
                       (select durable_work_state_text from durable_target)
                 and (select quarantine_id from existing)
                     is not distinct from
                       (select quarantine_id from durable_target)
                 and (select quarantine_fingerprint_sha256 from existing)
                     is not distinct from
                       (select quarantine_fingerprint_sha256
                          from durable_target)
                 and (select persisted_at from existing) =
                     ${target.persistedAt}::timestamptz
                 and (select acknowledged_at from existing) =
                     ${acknowledgement.acknowledgedAt}::timestamptz
                 then 'already_acknowledged'
               when exists (select 1 from existing)
                 and (${input.expectedCheckpointRevision}::bigint is null
                   or (select revision from existing) <>
                      ${input.expectedCheckpointRevision}::bigint)
                 then 'revision_conflict'
               when not exists (select 1 from existing)
                 and ${input.expectedCheckpointRevision}::bigint is not null
                 then 'revision_conflict'
               else null
             end::text as outcome
        from db_clock
    ),
    checkpoint_written as materialized (
      insert into public.inbox_v2_source_ingress_cursor_checkpoints (
        tenant_id, source_connection_id, source_account_id,
        source_account_scope_key, cursor_owner,
        source_thread_binding_id, cursor_kind, cursor_slot_id,
        route_generation, purpose_id, key_generation,
        cursor_value_secret_ref,
        cursor_hmac_sha256, durable_target_kind,
        last_durable_raw_event_id, durable_work_id,
        durable_work_revision, durable_work_state, quarantine_id,
        quarantine_fingerprint_sha256, revision,
        persisted_at, acknowledged_at, created_at, updated_at
      )
      select target_row.tenant_id, target_row.source_connection_id,
             target_row.source_account_id,
             target_row.source_account_scope_key,
             ${acknowledgement.cursorOwner},
             ${acknowledgement.sourceThreadBindingId},
             ${acknowledgement.cursor.kind}, ${input.cursorSlotId},
             ${input.routeGeneration}::bigint,
             ${INBOX_V2_SOURCE_CURSOR_PURPOSE_ID},
             ${protection.keyGeneration},
             ${protection.cursorValueSecretRef},
             ${protection.cursorHmacSha256},
             target_row.durable_target_kind::
               public.inbox_v2_source_cursor_durable_target_kind,
             target_row.last_durable_raw_event_id,
             target_row.durable_work_id,
             target_row.durable_work_revision,
             target_row.durable_work_state_text::
               public.inbox_v2_source_processing_work_state,
             target_row.quarantine_id,
             target_row.quarantine_fingerprint_sha256, 1,
             ${target.persistedAt}::timestamptz,
             ${acknowledgement.acknowledgedAt}::timestamptz,
             ${target.persistedAt}::timestamptz, classified.db_now
        from durable_target target_row cross join classified
       where classified.outcome is null
      on conflict (
        tenant_id, source_connection_id, source_account_scope_key,
        cursor_slot_id
      ) do update
        set source_account_id = excluded.source_account_id,
            cursor_owner = excluded.cursor_owner,
            source_thread_binding_id = excluded.source_thread_binding_id,
            cursor_kind = excluded.cursor_kind,
            route_generation = excluded.route_generation,
            purpose_id = excluded.purpose_id,
            key_generation = excluded.key_generation,
            cursor_value_secret_ref = excluded.cursor_value_secret_ref,
            cursor_hmac_sha256 = excluded.cursor_hmac_sha256,
            durable_target_kind = excluded.durable_target_kind,
            last_durable_raw_event_id = excluded.last_durable_raw_event_id,
            durable_work_id = excluded.durable_work_id,
            durable_work_revision = excluded.durable_work_revision,
            durable_work_state = excluded.durable_work_state,
            quarantine_id = excluded.quarantine_id,
            quarantine_fingerprint_sha256 =
              excluded.quarantine_fingerprint_sha256,
            revision =
              inbox_v2_source_ingress_cursor_checkpoints.revision + 1,
            persisted_at = excluded.persisted_at,
            acknowledged_at = excluded.acknowledged_at,
            updated_at = excluded.updated_at
      returning revision::text as revision
    )
    select case when classified.outcome is null
                then 'acknowledged' else classified.outcome end as outcome,
           case
             when classified.outcome = 'already_acknowledged'
               then (select revision::text from existing)
             else (select revision from checkpoint_written)
           end as revision
      from classified
  `;
}

async function acknowledgeCursor(
  executor: RawSqlExecutor,
  input: InboxV2SourceCursorPersistenceInput,
  protection: InboxV2SourceCursorProtection
): Promise<InboxV2SourceCursorPersistenceResult> {
  const result = await executor.execute<Record<string, unknown>>(
    buildAcknowledgeInboxV2SourceCursorSql({ persistence: input, protection })
  );
  const row = exactlyOneRow(result.rows, "source cursor acknowledgement");
  const outcome = stringValue(row.outcome, "cursor acknowledgement outcome");
  return inboxV2SourceCursorPersistenceResultSchema.parse(
    outcome === "acknowledged" || outcome === "already_acknowledged"
      ? {
          outcome,
          revision: bigintText(row.revision, "cursor checkpoint revision")
        }
      : { outcome }
  );
}

export function buildLoadInboxV2SourceCursorProtectionSql(
  rawInput: InboxV2SourceCursorLoadInput
): SQL {
  const input = inboxV2SourceCursorLoadInputSchema.parse(rawInput);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    checkpoint as materialized (
      select stored.*, stored.cursor_kind::text as cursor_kind_text,
             stored.cursor_owner::text as cursor_owner_text
        from public.inbox_v2_source_ingress_cursor_checkpoints stored
       where stored.tenant_id = ${input.source.tenantId}
         and stored.source_connection_id =
             ${input.source.sourceConnectionId}
         and stored.source_account_id is not distinct from
             ${input.source.sourceAccountId}
         and stored.cursor_owner = ${input.cursorOwner}
         and stored.source_thread_binding_id is not distinct from
             ${input.sourceThreadBindingId}
         and stored.cursor_slot_id = ${input.cursorSlotId}
       order by stored.revision desc
       limit 2
       for share
    ),
    key_generation as materialized (
      select key.*
        from checkpoint stored
        join public.inbox_v2_source_processing_key_generations key
          on key.tenant_id = stored.tenant_id
         and key.purpose_id = stored.purpose_id
         and key.generation = stored.key_generation
        cross join db_clock
       where key.state in ('active', 'verify_only')
         and key.verify_until > db_clock.db_now
       for share of key
    )
    select case
             when (select count(*) from checkpoint) = 0 then 'not_found'
             when (select count(*) from checkpoint) <> 1
               then 'integrity_failure'
             when not exists (select 1 from key_generation)
               then 'key_unavailable'
             when not public.inbox_v2_src_runtime_route_is_current(
               (select tenant_id from checkpoint),
               (select source_connection_id from checkpoint),
               (select source_account_id from checkpoint),
               (select route_generation from checkpoint)
             ) then 'integrity_failure'
             else 'protected'
           end::text as outcome,
           (select tenant_id from checkpoint) as tenant_id,
           (select key_generation from checkpoint) as key_generation,
           (select secret_ref from key_generation) as hmac_key_secret_ref,
           (select cursor_value_secret_ref from checkpoint) as
             cursor_value_secret_ref,
           (select cursor_hmac_sha256 from checkpoint) as cursor_hmac_sha256,
           (select cursor_kind_text from checkpoint) as cursor_kind,
           (select route_generation::text from checkpoint) as route_generation,
           (select revision::text from checkpoint) as checkpoint_revision,
           (select acknowledged_at from checkpoint) as acknowledged_at
  `;
}

type LoadedCursorProtection =
  | Readonly<{
      outcome: "result";
      result: InboxV2SourceCursorLoadResult;
    }>
  | Readonly<{
      outcome: "protected";
      protection: InboxV2SourceCursorProtection;
      cursorKind: "receive_cursor" | "history_cursor" | "provider_watermark";
      routeGeneration: string;
      checkpointRevision: string;
      acknowledgedAt: string;
    }>;

async function loadCursorProtection(
  executor: RawSqlExecutor,
  input: InboxV2SourceCursorLoadInput
): Promise<LoadedCursorProtection> {
  const result = await executor.execute<Record<string, unknown>>(
    buildLoadInboxV2SourceCursorProtectionSql(input)
  );
  const row = exactlyOneRow(result.rows, "source cursor load");
  const outcome = stringValue(row.outcome, "source cursor load outcome");
  if (outcome !== "protected") {
    return {
      outcome: "result",
      result: inboxV2SourceCursorLoadResultSchema.parse({ outcome })
    };
  }
  const protection = inboxV2SourceCursorProtectionSchema.parse({
    tenantId: stringValue(row.tenant_id, "cursor tenant"),
    keyGeneration: stringValue(row.key_generation, "cursor key generation"),
    hmacKeySecretRef: stringValue(
      row.hmac_key_secret_ref,
      "cursor HMAC secret"
    ),
    cursorValueSecretRef: stringValue(
      row.cursor_value_secret_ref,
      "cursor value secret"
    ),
    cursorHmacSha256: stringValue(row.cursor_hmac_sha256, "cursor HMAC")
  });
  const cursorKind = stringValue(row.cursor_kind, "cursor kind");
  if (
    cursorKind !== "receive_cursor" &&
    cursorKind !== "history_cursor" &&
    cursorKind !== "provider_watermark"
  ) {
    throw invariantError("Stored cursor kind is invalid.");
  }
  return {
    outcome: "protected",
    protection,
    cursorKind,
    routeGeneration: bigintText(
      row.route_generation,
      "cursor route generation"
    ),
    checkpointRevision: bigintText(
      row.checkpoint_revision,
      "cursor checkpoint revision"
    ),
    acknowledgedAt: timestampValue(row.acknowledged_at, "cursor acknowledgedAt")
  };
}

function parseDedupeSkeletonWriteInput(
  input: unknown
): InboxV2SourceDedupeSkeletonWriteInput {
  return inboxV2SourceDedupeSkeletonWriteInputSchema.parse(input);
}

function replayabilityReasonCode(
  skeleton: InboxV2SourceDedupeSkeleton
): string | null {
  if (skeleton.replayability.state === "replayable") return null;
  return `core:source-replay.${skeleton.replayability.reason.replaceAll("_", "-")}`;
}

export function buildWriteInboxV2SourceDedupeSkeletonSql(
  rawInput: Readonly<{
    persistence: InboxV2SourceDedupeSkeletonWriteInput;
    verification: Extract<
      InboxV2SourceDedupeHmacVerification,
      { outcome: "verified" }
    >;
  }>
): SQL {
  const input = parseDedupeSkeletonWriteInput(rawInput.persistence);
  const verification = inboxV2SourceDedupeHmacVerificationSchema.parse(
    rawInput.verification
  );
  if (
    verification.outcome !== "verified" ||
    verification.tenantId !== input.skeleton.source.tenantId
  ) {
    throw new TypeError(
      "Dedupe write requires exact verified tenant HMAC authority."
    );
  }
  const skeleton = input.skeleton;
  const replayability = skeleton.replayability;
  const replayUntil =
    replayability.state === "replayable" ? replayability.replayUntil : null;
  const replayabilityReason = replayabilityReasonCode(skeleton);
  const expiredAt =
    skeleton.lifecycleState === "expired" ? skeleton.expiredAt : null;
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    raw_scope as materialized (
      select envelope.tenant_id, envelope.raw_event_id,
             envelope.source_connection_id, envelope.source_account_id,
             envelope.source_account_scope_key
        from public.inbox_v2_source_raw_envelopes envelope
       where envelope.tenant_id = ${skeleton.source.tenantId}
         and envelope.raw_event_id = ${skeleton.target.rawEventId}
         and envelope.source_connection_id =
             ${skeleton.source.sourceConnectionId}
         and envelope.source_account_id is not distinct from
             ${skeleton.source.sourceAccountId}
       for share
    ),
    key_generation as materialized (
      select key.*
        from public.inbox_v2_source_processing_key_generations key
        cross join db_clock
       where key.tenant_id = ${skeleton.source.tenantId}
         and key.purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
         and key.generation = ${skeleton.digestKeyGeneration}
         and key.secret_ref = ${verification.hmacKeySecretRef}
         and key.state in ('active', 'verify_only')
         and key.activated_at <= ${skeleton.terminalAt}::timestamptz
         and key.use_until > ${skeleton.terminalAt}::timestamptz
         and key.guarantee_not_after >=
             ${skeleton.guaranteeUntil}::timestamptz
         and key.verify_until = ${skeleton.keyVerifyUntil}::timestamptz
         and key.verify_until > db_clock.db_now
       for share of key
    ),
    existing as materialized (
      select stored.*
        from public.inbox_v2_source_delivery_dedupe_skeletons stored
       where stored.tenant_id = ${skeleton.source.tenantId}
         and (stored.id = ${input.skeletonId}
           or (stored.purpose_id = ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID}
             and stored.key_generation = ${skeleton.digestKeyGeneration}
             and stored.identity_hmac_sha256 =
                 ${skeleton.identityHmacSha256}))
       order by case when stored.id = ${input.skeletonId} then 0 else 1 end,
                stored.id collate "C"
       for update
    ),
    classified as materialized (
      select case
               when not exists (select 1 from raw_scope)
                 or not exists (select 1 from key_generation)
                 or ${skeleton.skeletonExpiresAt}::timestamptz <= db_clock.db_now
                 then 'key_unavailable'
               when (select count(*) from existing) > 1 then 'conflict'
               when exists (select 1 from existing) and not (
                    (select id from existing) = ${input.skeletonId}
                    and (select source_connection_id from existing) =
                        ${skeleton.source.sourceConnectionId}
                    and (select source_account_id from existing)
                        is not distinct from ${skeleton.source.sourceAccountId}
                    and (select source_account_scope_key from existing) =
                        (select source_account_scope_key from raw_scope)
                    and (select route_generation from existing) =
                        ${input.routeGeneration}::bigint
                    and (select phase::text from existing) =
                        ${skeleton.target.phase}
                    and (select raw_event_id from existing) =
                        ${skeleton.target.rawEventId}
                    and (select normalized_event_id from existing)
                        is not distinct from
                          ${skeleton.target.normalizedEventId}
                    and (select key_generation from existing) =
                        ${skeleton.digestKeyGeneration}
                    and (select key_verify_until from existing) =
                        ${skeleton.keyVerifyUntil}::timestamptz
                    and (select identity_hmac_sha256 from existing) =
                        ${skeleton.identityHmacSha256}
                    and (select outcome_hmac_sha256 from existing) =
                        ${skeleton.outcomeHmacSha256}
                    and (select outcome::text from existing) =
                        ${skeleton.outcome.kind}
                    and (select diagnostic_code_id from existing)
                        is not distinct from
                          ${skeleton.outcome.diagnosticCodeId}
                    and (select evidence_captured_at from existing) =
                        ${skeleton.evidenceDeadlines.capturedAt}::timestamptz
                    and (select raw_payload_expires_at from existing) =
                        ${skeleton.evidenceDeadlines.rawPayloadExpiresAt}::timestamptz
                    and (select allowed_raw_headers_expires_at from existing) =
                        ${skeleton.evidenceDeadlines.allowedRawHeadersExpiresAt}::timestamptz
                    and (select normalized_payload_expires_at from existing)
                        is not distinct from
                          ${skeleton.evidenceDeadlines.normalizedPayloadExpiresAt}::timestamptz
                    and (select terminal_at from existing) =
                        ${skeleton.terminalAt}::timestamptz
                    and (select guarantee_until from existing) =
                        ${skeleton.guaranteeUntil}::timestamptz
                    and (select replayability_state::text from existing) =
                        ${replayability.state}
                    and (select replay_until from existing)
                        is not distinct from ${replayUntil}::timestamptz
                    and (select replayability_reason_code_id from existing)
                        is not distinct from ${replayabilityReason}
                    and (select skeleton_expires_at from existing) =
                        ${skeleton.skeletonExpiresAt}::timestamptz
                    and (select lifecycle_state::text from existing) =
                        ${skeleton.lifecycleState}
                    and (select expired_at from existing)
                        is not distinct from ${expiredAt}::timestamptz
                  ) then 'conflict'
               when exists (select 1 from existing)
                 then 'already_written'
               else null
             end::text as outcome
        from db_clock
    ),
    inserted as materialized (
      insert into public.inbox_v2_source_delivery_dedupe_skeletons (
        tenant_id, id, source_connection_id, source_account_id,
        source_account_scope_key, route_generation, phase, raw_event_id,
        normalized_event_id, purpose_id, key_generation,
        key_verify_until, identity_hmac_sha256, outcome_hmac_sha256,
        outcome, diagnostic_code_id, evidence_captured_at,
        raw_payload_expires_at, allowed_raw_headers_expires_at,
        normalized_payload_expires_at, terminal_at, guarantee_until,
        replayability_state, replay_until, replayability_reason_code_id,
        skeleton_expires_at, lifecycle_state, expired_at, revision,
        created_at, updated_at
      )
      select scope.tenant_id, ${input.skeletonId},
             scope.source_connection_id, scope.source_account_id,
             scope.source_account_scope_key, ${input.routeGeneration}::bigint,
             ${skeleton.target.phase}, ${skeleton.target.rawEventId},
             ${skeleton.target.normalizedEventId},
             ${INBOX_V2_SOURCE_REPLAY_PURPOSE_ID},
             ${skeleton.digestKeyGeneration},
             ${skeleton.keyVerifyUntil}::timestamptz,
             ${skeleton.identityHmacSha256},
             ${skeleton.outcomeHmacSha256}, ${skeleton.outcome.kind},
             ${skeleton.outcome.diagnosticCodeId},
             ${skeleton.evidenceDeadlines.capturedAt}::timestamptz,
             ${skeleton.evidenceDeadlines.rawPayloadExpiresAt}::timestamptz,
             ${skeleton.evidenceDeadlines.allowedRawHeadersExpiresAt}::timestamptz,
             ${skeleton.evidenceDeadlines.normalizedPayloadExpiresAt}::timestamptz,
             ${skeleton.terminalAt}::timestamptz,
             ${skeleton.guaranteeUntil}::timestamptz,
             ${replayability.state}, ${replayUntil}::timestamptz,
             ${replayabilityReason},
             ${skeleton.skeletonExpiresAt}::timestamptz,
             ${skeleton.lifecycleState}, ${expiredAt}::timestamptz, 1,
             ${skeleton.terminalAt}::timestamptz,
             ${skeleton.terminalAt}::timestamptz
        from raw_scope scope cross join classified
       where classified.outcome is null
      returning id
    )
    select case when classified.outcome is null
                then 'written' else classified.outcome end as outcome
      from classified
  `;
}

async function writeDedupeSkeleton(
  executor: RawSqlExecutor,
  input: InboxV2SourceDedupeSkeletonWriteInput,
  verification: Extract<
    InboxV2SourceDedupeHmacVerification,
    { outcome: "verified" }
  >
): Promise<InboxV2SourceDedupeSkeletonWriteResult> {
  const result = await executor.execute<Record<string, unknown>>(
    buildWriteInboxV2SourceDedupeSkeletonSql({
      persistence: input,
      verification
    })
  );
  return inboxV2SourceDedupeSkeletonWriteResultSchema.parse({
    outcome: stringValue(
      exactlyOneRow(result.rows, "source dedupe skeleton write").outcome,
      "source dedupe skeleton outcome"
    )
  });
}

function parseDedupeSkeletonLookupInput(
  input: unknown
): InboxV2SourceDedupeSkeletonLookupInput {
  return inboxV2SourceDedupeSkeletonLookupInputSchema.parse(input);
}

function dedupeLookupDerivationMatches(
  input: InboxV2SourceDedupeSkeletonLookupInput,
  derivation: Extract<
    InboxV2SourceDedupeIdentityCandidates,
    { outcome: "derived" }
  >
): boolean {
  return (
    derivation.source.tenantId === input.source.tenantId &&
    derivation.source.sourceConnectionId === input.source.sourceConnectionId &&
    derivation.source.sourceAccountId === input.source.sourceAccountId &&
    derivation.phase === input.phase &&
    derivation.purposeId === input.purposeId
  );
}

export type InboxV2SourceDedupeSkeletonLookupPersistenceInput = Readonly<{
  source: InboxV2SourceDedupeSkeletonLookupInput["source"];
  phase: InboxV2SourceDedupeSkeletonLookupInput["phase"];
  purposeId: InboxV2SourceDedupeSkeletonLookupInput["purposeId"];
  candidates: readonly InboxV2SourceDedupeIdentityHmacCandidate[];
}>;

export function buildLookupInboxV2SourceDedupeSkeletonSql(
  rawInput: InboxV2SourceDedupeSkeletonLookupPersistenceInput
): SQL {
  const input = inboxV2SourceDedupeIdentityCandidatesSchema.parse({
    outcome: "derived",
    source: rawInput.source,
    phase: rawInput.phase,
    purposeId: rawInput.purposeId,
    candidates: rawInput.candidates
  });
  if (input.outcome !== "derived") {
    throw new TypeError("Dedupe lookup requires derived HMAC candidates.");
  }
  const candidateRows = input.candidates.map(
    (candidate, ordinal) => sql`(
      ${ordinal}::integer,
      ${candidate.generation}::text,
      ${candidate.hmacKeySecretRef}::text,
      ${candidate.identityHmacSha256}::text
    )`
  );
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now),
    candidates (
      candidate_ordinal, generation, hmac_key_secret_ref, identity_hmac_sha256
    ) as materialized (
      values ${sql.join(candidateRows, sql`, `)}
    ),
    eligible_candidates as materialized (
      select candidate.*, key.verify_until
        from candidates candidate
        join public.inbox_v2_source_processing_key_generations key
          on key.tenant_id = ${input.source.tenantId}
         and key.purpose_id = ${input.purposeId}
         and key.generation = candidate.generation
         and key.secret_ref = candidate.hmac_key_secret_ref
        cross join db_clock
       where key.state in ('active', 'verify_only')
         and key.activated_at <= db_clock.db_now
         and key.verify_until > db_clock.db_now
       for share of key
    )
    select candidate.candidate_ordinal,
           candidate.generation as candidate_generation,
           skeleton.id as skeleton_id,
           skeleton.route_generation,
           skeleton.source_connection_id,
           skeleton.source_account_id,
           skeleton.phase::text as phase_text,
           skeleton.raw_event_id,
           skeleton.normalized_event_id,
           skeleton.purpose_id,
           skeleton.key_generation,
           skeleton.key_verify_until,
           skeleton.identity_hmac_sha256,
           skeleton.outcome_hmac_sha256,
           skeleton.outcome::text as outcome_text,
           skeleton.diagnostic_code_id,
           skeleton.evidence_captured_at,
           skeleton.raw_payload_expires_at,
           skeleton.allowed_raw_headers_expires_at,
           skeleton.normalized_payload_expires_at,
           skeleton.terminal_at,
           skeleton.guarantee_until,
           skeleton.replayability_state::text as replayability_state_text,
           skeleton.replay_until,
           skeleton.replayability_reason_code_id,
           skeleton.skeleton_expires_at,
           skeleton.lifecycle_state::text as lifecycle_state_text,
           skeleton.expired_at,
           skeleton.updated_at
      from eligible_candidates candidate
      cross join db_clock
      left join public.inbox_v2_source_delivery_dedupe_skeletons skeleton
        on skeleton.tenant_id = ${input.source.tenantId}
       and skeleton.source_connection_id =
           ${input.source.sourceConnectionId}
       and skeleton.source_account_id is not distinct from
           ${input.source.sourceAccountId}
       and skeleton.purpose_id = ${input.purposeId}
       and skeleton.phase::text = ${input.phase}
       and skeleton.key_generation = candidate.generation
       and skeleton.key_verify_until = candidate.verify_until
       and skeleton.identity_hmac_sha256 = candidate.identity_hmac_sha256
       and skeleton.lifecycle_state = 'active'
       and skeleton.guarantee_until > db_clock.db_now
       and skeleton.skeleton_expires_at > db_clock.db_now
     order by candidate.candidate_ordinal
  `;
}

type DedupeSkeletonLookupMatch = Readonly<{
  candidateGeneration: string;
  skeletonId: string;
  routeGeneration: string;
  skeleton: InboxV2SourceDedupeSkeleton;
}>;

function replayabilityFromDedupeRow(
  row: Record<string, unknown>
): InboxV2SourceDedupeSkeleton["replayability"] {
  const state = stringValue(
    row.replayability_state_text,
    "dedupe replayability state"
  );
  if (state === "replayable") {
    return {
      state,
      replayUntil: timestampValue(row.replay_until, "dedupe replayUntil")
    };
  }
  const reasonCode = stringValue(
    row.replayability_reason_code_id,
    "dedupe replayability reason"
  );
  const reason = reasonCode.startsWith("core:source-replay.")
    ? reasonCode.slice("core:source-replay.".length).replaceAll("-", "_")
    : reasonCode;
  const changedAt = timestampValue(
    row.updated_at,
    "dedupe replayability decision time"
  );
  if (state === "not_replayable") {
    if (
      reason !== "processed" &&
      reason !== "ignored" &&
      reason !== "duplicate" &&
      reason !== "terminal_policy"
    ) {
      throw invariantError("Stored non-replayable reason is invalid.");
    }
    return { state, reason, decidedAt: changedAt };
  }
  if (state === "expired") {
    if (
      reason !== "evidence_expired" &&
      reason !== "guarantee_expired" &&
      reason !== "key_retired"
    ) {
      throw invariantError("Stored replay expiry reason is invalid.");
    }
    return { state, reason, expiredAt: changedAt };
  }
  throw invariantError("Stored replayability state is invalid.");
}

function dedupeSkeletonLookupMatchFromRow(
  row: Record<string, unknown>,
  tenantId: string
): DedupeSkeletonLookupMatch {
  const phase = stringValue(row.phase_text, "dedupe phase");
  const normalizedEventId = nullableString(
    row.normalized_event_id,
    "dedupe normalized event"
  );
  const lifecycleState = stringValue(
    row.lifecycle_state_text,
    "dedupe lifecycle state"
  );
  const skeleton = inboxV2SourceDedupeSkeletonSchema.parse({
    source: {
      tenantId,
      sourceConnectionId: stringValue(
        row.source_connection_id,
        "dedupe source connection"
      ),
      sourceAccountId: nullableString(
        row.source_account_id,
        "dedupe source account"
      )
    },
    target:
      phase === "raw"
        ? {
            phase,
            rawEventId: stringValue(row.raw_event_id, "dedupe raw event"),
            normalizedEventId: null
          }
        : {
            phase,
            rawEventId: stringValue(row.raw_event_id, "dedupe raw event"),
            normalizedEventId
          },
    purposeId: stringValue(row.purpose_id, "dedupe purpose"),
    digestKeyGeneration: stringValue(
      row.key_generation,
      "dedupe key generation"
    ),
    keyVerifyUntil: timestampValue(
      row.key_verify_until,
      "dedupe key verifyUntil"
    ),
    identityHmacSha256: stringValue(
      row.identity_hmac_sha256,
      "dedupe identity HMAC"
    ),
    outcomeHmacSha256: stringValue(
      row.outcome_hmac_sha256,
      "dedupe outcome HMAC"
    ),
    outcome: {
      kind: stringValue(row.outcome_text, "dedupe outcome"),
      diagnosticCodeId: nullableString(
        row.diagnostic_code_id,
        "dedupe diagnostic code"
      )
    },
    evidenceDeadlines: {
      capturedAt: timestampValue(
        row.evidence_captured_at,
        "dedupe evidence capturedAt"
      ),
      rawPayloadExpiresAt: timestampValue(
        row.raw_payload_expires_at,
        "dedupe raw payload expiry"
      ),
      allowedRawHeadersExpiresAt: timestampValue(
        row.allowed_raw_headers_expires_at,
        "dedupe allowed-header expiry"
      ),
      normalizedPayloadExpiresAt: nullableTimestamp(
        row.normalized_payload_expires_at,
        "dedupe normalized payload expiry"
      )
    },
    terminalAt: timestampValue(row.terminal_at, "dedupe terminalAt"),
    guaranteeUntil: timestampValue(
      row.guarantee_until,
      "dedupe guaranteeUntil"
    ),
    skeletonExpiresAt: timestampValue(
      row.skeleton_expires_at,
      "dedupe skeleton expiry"
    ),
    replayability: replayabilityFromDedupeRow(row),
    lifecycleState,
    expiredAt: nullableTimestamp(row.expired_at, "dedupe expiredAt")
  });
  return {
    candidateGeneration: stringValue(
      row.candidate_generation,
      "dedupe candidate generation"
    ),
    skeletonId: stringValue(row.skeleton_id, "dedupe skeleton id"),
    routeGeneration: bigintText(
      row.route_generation,
      "dedupe route generation"
    ),
    skeleton
  };
}

function coherentDedupeSkeletonFingerprint(
  match: DedupeSkeletonLookupMatch
): string {
  const {
    digestKeyGeneration: _digestKeyGeneration,
    keyVerifyUntil: _keyVerifyUntil,
    identityHmacSha256: _identityHmacSha256,
    outcomeHmacSha256: _outcomeHmacSha256,
    ...generationIndependentSkeleton
  } = match.skeleton;
  return JSON.stringify({
    routeGeneration: match.routeGeneration,
    skeleton: generationIndependentSkeleton
  });
}

async function lookupDedupeSkeleton(
  executor: RawSqlExecutor,
  input: InboxV2SourceDedupeSkeletonLookupInput,
  candidates: readonly InboxV2SourceDedupeIdentityHmacCandidate[]
): Promise<InboxV2SourceDedupeSkeletonLookupResult> {
  const result = await executor.execute<Record<string, unknown>>(
    buildLookupInboxV2SourceDedupeSkeletonSql({
      source: input.source,
      phase: input.phase,
      purposeId: input.purposeId,
      candidates
    })
  );
  if (result.rows.length === 0) {
    return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
      outcome: "key_unavailable"
    });
  }
  const matchedRows = result.rows.filter((row) => row.skeleton_id !== null);
  if (matchedRows.length === 0) {
    return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
      outcome: "not_found"
    });
  }
  const matches = matchedRows.map((row) =>
    dedupeSkeletonLookupMatchFromRow(row, input.source.tenantId)
  );
  if (
    matches.some(
      (match) =>
        match.candidateGeneration !== match.skeleton.digestKeyGeneration
    ) ||
    new Set(matches.map(coherentDedupeSkeletonFingerprint)).size !== 1
  ) {
    return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
      outcome: "integrity_failure"
    });
  }
  const selected = matches[0]!;
  return inboxV2SourceDedupeSkeletonLookupResultSchema.parse({
    outcome: "found",
    skeletonId: selected.skeletonId,
    routeGeneration: selected.routeGeneration,
    skeleton: selected.skeleton,
    matchedKeyGenerations: matches.map((match) => match.candidateGeneration)
  });
}

function parseDedupeSkeletonExpireInput(
  input: unknown
): InboxV2SourceDedupeSkeletonExpireInput {
  return inboxV2SourceDedupeSkeletonExpireInputSchema.parse(input);
}

export function buildExpireInboxV2SourceDedupeSkeletonSql(
  rawInput: InboxV2SourceDedupeSkeletonExpireInput
): SQL {
  const input = parseDedupeSkeletonExpireInput(rawInput);
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    existing as materialized (
      select skeleton.*, skeleton.lifecycle_state::text as lifecycle_state_text
        from public.inbox_v2_source_delivery_dedupe_skeletons skeleton
       where skeleton.tenant_id = ${input.tenantId}
         and skeleton.id = ${input.skeletonId}
       for update
    ),
    classified as materialized (
      select case
               when not exists (select 1 from existing) then 'not_found'
               when (select lifecycle_state_text from existing) = 'expired'
                 then 'already_expired'
               when (select revision from existing) <>
                    ${input.expectedRevision}::bigint
                 then 'revision_conflict'
                when (select skeleton_expires_at from existing) >
                     db_clock.db_now
                  then 'not_due'
                when (select replayability_state::text from existing) =
                     'replayable' then 'not_due'
                else null
             end::text as outcome,
             db_clock.db_now
        from db_clock
    ),
    expired as materialized (
      update public.inbox_v2_source_delivery_dedupe_skeletons skeleton
         set lifecycle_state = 'expired', expired_at = classified.db_now,
              revision = skeleton.revision + 1,
              updated_at = classified.db_now
        from classified
       where classified.outcome is null
         and skeleton.tenant_id = ${input.tenantId}
         and skeleton.id = ${input.skeletonId}
          and skeleton.revision = ${input.expectedRevision}::bigint
          and skeleton.lifecycle_state = 'active'
          and skeleton.replayability_state <> 'replayable'
          and skeleton.skeleton_expires_at <= classified.db_now
      returning skeleton.revision::text as revision
    )
    select case when classified.outcome is null
                then 'expired' else classified.outcome end as outcome,
           case when classified.outcome = 'already_expired'
                  then (select revision::text from existing)
                else (select revision from expired) end as revision
      from classified
  `;
}

async function expireDedupeSkeleton(
  executor: RawSqlExecutor,
  input: InboxV2SourceDedupeSkeletonExpireInput
): Promise<InboxV2SourceDedupeSkeletonExpireResult> {
  const replayability = await expireDedupeReplayability(executor, {
    tenantId: input.tenantId,
    skeletonId: input.skeletonId,
    expectedRevision: input.expectedRevision,
    reason: "guarantee_expired"
  });
  if (
    replayability.outcome === "not_found" ||
    replayability.outcome === "revision_conflict"
  ) {
    return inboxV2SourceDedupeSkeletonExpireResultSchema.parse(replayability);
  }
  if (
    replayability.outcome === "already_expired" &&
    replayability.revision !== input.expectedRevision
  ) {
    return inboxV2SourceDedupeSkeletonExpireResultSchema.parse({
      outcome: "revision_conflict"
    });
  }
  const hardExpiryInput = {
    ...input,
    expectedRevision:
      replayability.outcome === "expired"
        ? replayability.revision
        : input.expectedRevision
  };
  const result = await executor.execute<Record<string, unknown>>(
    buildExpireInboxV2SourceDedupeSkeletonSql(hardExpiryInput)
  );
  const row = exactlyOneRow(result.rows, "source dedupe skeleton expiry");
  const outcome = stringValue(row.outcome, "source dedupe expiry outcome");
  return inboxV2SourceDedupeSkeletonExpireResultSchema.parse(
    outcome === "expired" || outcome === "already_expired"
      ? {
          outcome,
          revision: bigintText(row.revision, "source dedupe revision")
        }
      : { outcome }
  );
}

function parseDedupeReplayabilityExpireInput(
  input: unknown
): InboxV2SourceDedupeReplayabilityExpireInput {
  return inboxV2SourceDedupeReplayabilityExpireInputSchema.parse(input);
}

export function buildExpireInboxV2SourceDedupeReplayabilitySql(
  rawInput: InboxV2SourceDedupeReplayabilityExpireInput
): SQL {
  const input = parseDedupeReplayabilityExpireInput(rawInput);
  const reasonCode = `core:source-replay.${input.reason.replaceAll("_", "-")}`;
  return sql`
    with db_clock as materialized (
      select date_trunc('milliseconds', clock_timestamp()) as db_now
    ),
    existing as materialized (
      select skeleton.*,
             skeleton.phase::text as phase_text,
             skeleton.replayability_state::text as replayability_state_text,
             key.state::text as key_state_text,
             key.retired_at as key_retired_at
        from public.inbox_v2_source_delivery_dedupe_skeletons skeleton
        left join public.inbox_v2_source_processing_key_generations key
          on key.tenant_id = skeleton.tenant_id
         and key.purpose_id = skeleton.purpose_id
         and key.generation = skeleton.key_generation
       where skeleton.tenant_id = ${input.tenantId}
         and skeleton.id = ${input.skeletonId}
       for update of skeleton
    ),
    classified as materialized (
      select case
               when not exists (select 1 from existing) then 'not_found'
               when (select replayability_state_text from existing) = 'expired'
                 then 'already_expired'
               when (select revision from existing) <>
                    ${input.expectedRevision}::bigint
                 then 'revision_conflict'
               when (select replayability_state_text from existing) <>
                    'replayable' then 'not_due'
               when ${input.reason} = 'evidence_expired' and not (
                    ((select phase_text from existing) = 'raw'
                      and (select raw_payload_expires_at from existing) <=
                          db_clock.db_now)
                    or ((select phase_text from existing) = 'normalized'
                      and (select normalized_payload_expires_at from existing)
                          <= db_clock.db_now)
                  ) then 'not_due'
               when ${input.reason} = 'guarantee_expired'
                 and (select guarantee_until from existing) > db_clock.db_now
                 then 'not_due'
               when ${input.reason} = 'key_retired' and not (
                    (select key_state_text from existing) = 'retired'
                    and (select key_retired_at from existing) <= db_clock.db_now
                  ) then 'not_due'
               else null
             end::text as outcome,
             db_clock.db_now
        from db_clock
    ),
    expired as materialized (
      update public.inbox_v2_source_delivery_dedupe_skeletons skeleton
         set replayability_state = 'expired', replay_until = null,
             replayability_reason_code_id = ${reasonCode},
             revision = skeleton.revision + 1,
             updated_at = classified.db_now
        from classified
       where classified.outcome is null
         and skeleton.tenant_id = ${input.tenantId}
         and skeleton.id = ${input.skeletonId}
         and skeleton.revision = ${input.expectedRevision}::bigint
         and skeleton.replayability_state = 'replayable'
      returning skeleton.revision::text as revision
    )
    select case when classified.outcome is null
                then 'expired' else classified.outcome end as outcome,
           case when classified.outcome = 'already_expired'
                  then (select revision::text from existing)
                else (select revision from expired) end as revision
      from classified
  `;
}

async function expireDedupeReplayability(
  executor: RawSqlExecutor,
  input: InboxV2SourceDedupeReplayabilityExpireInput
): Promise<InboxV2SourceDedupeReplayabilityExpireResult> {
  const result = await executor.execute<Record<string, unknown>>(
    buildExpireInboxV2SourceDedupeReplayabilitySql(input)
  );
  const row = exactlyOneRow(result.rows, "source dedupe replayability expiry");
  const outcome = stringValue(
    row.outcome,
    "source dedupe replayability outcome"
  );
  return inboxV2SourceDedupeReplayabilityExpireResultSchema.parse(
    outcome === "expired" || outcome === "already_expired"
      ? {
          outcome,
          revision: bigintText(row.revision, "source dedupe revision")
        }
      : { outcome }
  );
}

function parseProcessingKeyRotationInput(
  input: unknown
): InboxV2SourceProcessingKeyRotationInput {
  return inboxV2SourceProcessingKeyRotationInputSchema.parse(input);
}

export function buildLockInboxV2SourceProcessingKeyRotationSql(
  rawInput: InboxV2SourceProcessingKeyRotationInput
): SQL {
  const input = parseProcessingKeyRotationInput(rawInput);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select key.*, key.state::text as state_text, db_clock.db_now
      from public.inbox_v2_source_processing_key_generations key
      cross join db_clock
     where key.tenant_id = ${input.tenantId}
       and key.purpose_id = ${input.purposeId}
       and (key.generation = ${input.generation} or key.state = 'active')
     order by case when key.generation = ${input.generation} then 0 else 1 end,
              key.generation collate "C"
     for update of key
  `;
}

function keyRotationRowMatches(
  row: Record<string, unknown>,
  input: InboxV2SourceProcessingKeyRotationInput
): boolean {
  return (
    stringValue(row.generation, "dedupe key generation") === input.generation &&
    stringValue(row.state_text, "dedupe key state") === "active" &&
    stringValue(row.secret_ref, "dedupe key secret") === input.secretRef &&
    timestampValue(row.activated_at, "dedupe key activatedAt") ===
      input.activatedAt &&
    timestampValue(row.use_until, "dedupe key useUntil") === input.useUntil &&
    timestampValue(row.guarantee_not_after, "dedupe key guaranteeUntil") ===
      input.guaranteeUntil &&
    timestampValue(row.verify_until, "dedupe key verifyUntil") ===
      input.verifyUntil
  );
}

export function buildRotateInboxV2SourceProcessingKeySql(input: {
  rotation: InboxV2SourceProcessingKeyRotationInput;
  dbNow: string;
}): SQL {
  const rotation = parseProcessingKeyRotationInput(input.rotation);
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  const expected = rotation.expectedActiveGeneration;
  return sql`
    with prior_updated as materialized (
      update public.inbox_v2_source_processing_key_generations key
         set state = 'verify_only', revision = key.revision + 1,
             updated_at = ${dbNow}::timestamptz
       where ${expected}::text is not null
         and key.tenant_id = ${rotation.tenantId}
         and key.purpose_id = ${rotation.purposeId}
         and key.generation = ${expected}::text
         and key.state = 'active'
      returning key.generation
    ),
    inserted as materialized (
      insert into public.inbox_v2_source_processing_key_generations (
        tenant_id, purpose_id, generation, secret_ref, state,
        activated_at, use_until, guarantee_not_after, verify_until,
        retired_at, revision, created_at, updated_at
      )
      select ${rotation.tenantId}, ${rotation.purposeId},
             ${rotation.generation}, ${rotation.secretRef}, 'active',
             ${rotation.activatedAt}::timestamptz,
             ${rotation.useUntil}::timestamptz,
             ${rotation.guaranteeUntil}::timestamptz,
             ${rotation.verifyUntil}::timestamptz, null, 1,
             ${rotation.activatedAt}::timestamptz,
             ${rotation.activatedAt}::timestamptz
       where (${expected}::text is null and not exists (
                select 1
                  from public.inbox_v2_source_processing_key_generations key
                 where key.tenant_id = ${rotation.tenantId}
                   and key.purpose_id = ${rotation.purposeId}
                   and key.state = 'active'
              ))
          or (${expected}::text is not null and exists (
                select 1 from prior_updated
              ))
      returning generation, revision::text as revision
    )
    select generation, revision from inserted
  `;
}

async function rotateProcessingKeyGeneration(
  executor: RawSqlExecutor,
  input: InboxV2SourceProcessingKeyRotationInput
): Promise<InboxV2SourceProcessingKeyRotationResult> {
  const locked = await executor.execute<Record<string, unknown>>(
    buildLockInboxV2SourceProcessingKeyRotationSql(input)
  );
  const requested = locked.rows.find(
    (row) =>
      stringValue(row.generation, "dedupe key generation") === input.generation
  );
  if (requested !== undefined) {
    if (!keyRotationRowMatches(requested, input)) {
      return inboxV2SourceProcessingKeyRotationResultSchema.parse({
        outcome: "active_generation_conflict"
      });
    }
    return inboxV2SourceProcessingKeyRotationResultSchema.parse({
      outcome: "already_active",
      generation: input.generation,
      revision: bigintText(requested.revision, "dedupe key revision")
    });
  }
  const active = locked.rows.find(
    (row) => stringValue(row.state_text, "dedupe key state") === "active"
  );
  if (
    (active === undefined
      ? null
      : stringValue(active.generation, "active key")) !==
    input.expectedActiveGeneration
  ) {
    return inboxV2SourceProcessingKeyRotationResultSchema.parse({
      outcome: "active_generation_conflict"
    });
  }
  const dbNow =
    locked.rows[0] === undefined
      ? timestampValue(
          exactlyOneRow(
            (
              await executor.execute<Record<string, unknown>>(sql`
                select clock_timestamp() as db_now
              `)
            ).rows,
            "dedupe key database clock"
          ).db_now,
          "dedupe key database clock"
        )
      : timestampValue(locked.rows[0].db_now, "dedupe key database clock");
  if (
    Date.parse(input.activatedAt) > Date.parse(dbNow) ||
    Date.parse(input.useUntil) <= Date.parse(dbNow)
  ) {
    return inboxV2SourceProcessingKeyRotationResultSchema.parse({
      outcome: "active_generation_conflict"
    });
  }
  const rotated = await executor.execute<Record<string, unknown>>(
    buildRotateInboxV2SourceProcessingKeySql({ rotation: input, dbNow })
  );
  if (rotated.rows.length === 0) {
    throw invariantError(
      "Dedupe key rotation lost its active-generation fence."
    );
  }
  const row = exactlyOneRow(rotated.rows, "dedupe key rotation");
  return inboxV2SourceProcessingKeyRotationResultSchema.parse({
    outcome: "rotated",
    generation: stringValue(row.generation, "dedupe key generation"),
    revision: bigintText(row.revision, "dedupe key revision")
  });
}

function parseProcessingKeyRetirementInput(
  input: unknown
): InboxV2SourceProcessingKeyRetirementInput {
  return inboxV2SourceProcessingKeyRetirementInputSchema.parse(input);
}

export function buildLockInboxV2SourceProcessingKeyRetirementSql(
  rawInput: InboxV2SourceProcessingKeyRetirementInput
): SQL {
  const input = parseProcessingKeyRetirementInput(rawInput);
  return sql`
    with db_clock as materialized (select clock_timestamp() as db_now)
    select key.*, key.state::text as state_text, db_clock.db_now
      from public.inbox_v2_source_processing_key_generations key
      cross join db_clock
     where key.tenant_id = ${input.tenantId}
       and key.purpose_id = ${input.purposeId}
       and key.generation = ${input.generation}
     for update of key
  `;
}

export function buildTransitionInboxV2SourceProcessingKeyToVerifyOnlySql(input: {
  retirement: InboxV2SourceProcessingKeyRetirementInput;
  expectedRevision: string;
  dbNow: string;
}): SQL {
  const retirement = parseProcessingKeyRetirementInput(input.retirement);
  const expectedRevision = inboxV2EntityRevisionSchema.parse(
    input.expectedRevision
  );
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  return sql`
    update public.inbox_v2_source_processing_key_generations key
       set state = 'verify_only', revision = key.revision + 1,
           updated_at = ${dbNow}::timestamptz
     where key.tenant_id = ${retirement.tenantId}
       and key.purpose_id = ${retirement.purposeId}
       and key.generation = ${retirement.generation}
       and key.revision = ${expectedRevision}::bigint
       and key.state = 'active'
    returning key.generation, key.revision::text as revision
  `;
}

export function buildRetireInboxV2SourceProcessingKeySql(input: {
  retirement: InboxV2SourceProcessingKeyRetirementInput;
  expectedRevision: string;
  dbNow: string;
}): SQL {
  const retirement = parseProcessingKeyRetirementInput(input.retirement);
  const expectedRevision = inboxV2EntityRevisionSchema.parse(
    input.expectedRevision
  );
  const dbNow = inboxV2TimestampSchema.parse(input.dbNow);
  return sql`
    update public.inbox_v2_source_processing_key_generations key
       set state = 'retired', retired_at = ${dbNow}::timestamptz,
           revision = key.revision + 1, updated_at = ${dbNow}::timestamptz
     where key.tenant_id = ${retirement.tenantId}
       and key.purpose_id = ${retirement.purposeId}
       and key.generation = ${retirement.generation}
       and key.revision = ${expectedRevision}::bigint
       and key.state = 'verify_only'
       and key.verify_until <= ${dbNow}::timestamptz
    returning key.generation, key.revision::text as revision
  `;
}

async function retireProcessingKeyGeneration(
  executor: RawSqlExecutor,
  input: InboxV2SourceProcessingKeyRetirementInput
): Promise<InboxV2SourceProcessingKeyRetirementResult> {
  const locked = await executor.execute<Record<string, unknown>>(
    buildLockInboxV2SourceProcessingKeyRetirementSql(input)
  );
  if (locked.rows.length === 0) {
    return inboxV2SourceProcessingKeyRetirementResultSchema.parse({
      outcome: "not_found"
    });
  }
  const key = exactlyOneRow(locked.rows, "source processing key retirement");
  const state = stringValue(key.state_text, "processing key state");
  const revision = bigintText(key.revision, "processing key revision");
  if (state === "retired") {
    return inboxV2SourceProcessingKeyRetirementResultSchema.parse({
      outcome: "already_retired",
      generation: input.generation,
      revision
    });
  }
  if (revision !== input.expectedRevision) {
    return inboxV2SourceProcessingKeyRetirementResultSchema.parse({
      outcome: "revision_conflict"
    });
  }
  const dbNow = timestampValue(key.db_now, "processing key database clock");
  if (
    Date.parse(timestampValue(key.verify_until, "processing key verifyUntil")) >
    Date.parse(dbNow)
  ) {
    return inboxV2SourceProcessingKeyRetirementResultSchema.parse({
      outcome: "not_due"
    });
  }
  let retirementRevision = revision;
  if (state === "active") {
    const transitioned = await executor.execute<Record<string, unknown>>(
      buildTransitionInboxV2SourceProcessingKeyToVerifyOnlySql({
        retirement: input,
        expectedRevision: retirementRevision,
        dbNow
      })
    );
    retirementRevision = bigintText(
      exactlyOneRow(
        transitioned.rows,
        "processing key verification-only transition"
      ).revision,
      "processing key verification-only revision"
    );
  } else if (state !== "verify_only") {
    throw invariantError("Stored processing key state is invalid.");
  }
  const retired = await executor.execute<Record<string, unknown>>(
    buildRetireInboxV2SourceProcessingKeySql({
      retirement: input,
      expectedRevision: retirementRevision,
      dbNow
    })
  );
  const retiredRow = exactlyOneRow(
    retired.rows,
    "source processing key retirement"
  );
  return inboxV2SourceProcessingKeyRetirementResultSchema.parse({
    outcome: "retired",
    generation: stringValue(
      retiredRow.generation,
      "retired processing key generation"
    ),
    revision: bigintText(retiredRow.revision, "retired processing key revision")
  });
}

async function lockSourceProcessingAdmission(
  executor: RawSqlExecutor,
  tenantId: string
): Promise<void> {
  await executor.execute(
    buildInboxV2AdvisoryXactLockSql([
      "core:inbox-v2.source-processing-admission",
      inboxV2TenantIdSchema.parse(tenantId)
    ])
  );
}

async function lockSourceProcessingLifecycle(
  executor: RawSqlExecutor,
  tenantId: string
): Promise<void> {
  await executor.execute(
    buildInboxV2AdvisoryXactLockSql([
      "core:inbox-v2.source-processing-lifecycle",
      inboxV2TenantIdSchema.parse(tenantId)
    ])
  );
}

function createClaimTokens(
  tokenSource: InboxV2SourceProcessingLeaseTokenSource,
  attemptIdSource: InboxV2SourceProcessingAttemptIdSource,
  count: number
): readonly ClaimToken[] {
  const rawTokens = Array.from(tokenSource(count));
  const attemptIds = Array.from(attemptIdSource(count));
  if (rawTokens.length !== count || attemptIds.length !== count) {
    throw invariantError(
      "Source-processing capability sources must return one value per ordinal."
    );
  }
  const tokens = rawTokens.map((value, index) => {
    const rawToken = inboxV2SourceProcessingLeaseTokenSchema.parse(value);
    const attemptId = inboxV2SourceProcessingAttemptIdSchema.parse(
      attemptIds[index]
    );
    return Object.freeze({
      rawToken,
      tokenHash: calculateInboxV2SourceProcessingLeaseTokenHash(rawToken),
      rawIngressTokenHash: calculateInboxV2RawIngressLeaseTokenHash(rawToken),
      attemptId
    });
  });
  for (const values of [
    tokens.map((token) => token.rawToken),
    tokens.map((token) => token.tokenHash),
    tokens.map((token) => token.rawIngressTokenHash),
    tokens.map((token) => token.attemptId)
  ]) {
    if (new Set(values).size !== values.length) {
      throw invariantError(
        "Source-processing capability sources returned duplicate values."
      );
    }
  }
  return Object.freeze(tokens);
}

function defaultLeaseTokenSource(count: number): readonly string[] {
  return Array.from(
    { length: count },
    () => `source-processing-${randomBytes(32).toString("base64url")}`
  );
}

function defaultAttemptIdSource(count: number): readonly string[] {
  return Array.from({ length: count }, () => `source-attempt:${randomUUID()}`);
}

function defaultReplayEpisodeIdSource(): string {
  return inboxV2SourceReplayEpisodeIdSchema.parse(
    `replay-episode:${randomUUID()}`
  );
}

function assertOptions(
  options: CreateSqlInboxV2SourceProcessingRuntimeRepositoryOptions
): void {
  if (
    typeof options !== "object" ||
    options === null ||
    typeof options.replayAuthorization?.authorizeReplay !== "function" ||
    typeof options.cryptographicAuthority?.protectCursor !== "function" ||
    typeof options.cryptographicAuthority?.resolveCursor !== "function" ||
    typeof options.cryptographicAuthority?.verifyDedupeSkeleton !==
      "function" ||
    typeof options.cryptographicAuthority?.deriveDedupeIdentityCandidates !==
      "function" ||
    typeof options.deadLetterLifecycleResolver !== "function"
  ) {
    throw new TypeError(
      "Source-processing repository requires replay authorization and DLQ lifecycle ports."
    );
  }
  parseRetentionPolicy(options.retentionPolicy);
}

const retentionPolicySchema = z
  .object({
    attemptRetentionSeconds: z.number().int().min(1).max(MAX_RETENTION_SECONDS),
    replayRequestRetentionSeconds: z
      .number()
      .int()
      .min(1)
      .max(MAX_RETENTION_SECONDS)
  })
  .strict();

function parseRetentionPolicy(
  input: InboxV2SourceProcessingRetentionPolicy
): InboxV2SourceProcessingRetentionPolicy {
  return retentionPolicySchema.parse(input);
}

function parseReplayAuthorizationDecision(
  input: InboxV2SourceReplayAuthorizationDecision
): InboxV2SourceReplayAuthorizationDecision {
  return inboxV2SourceReplayAuthorizationDecisionSchema.parse(input);
}

async function runTransaction<TResult>(
  executor: InboxV2SourceProcessingTransactionExecutor,
  work: (transaction: RawSqlExecutor) => Promise<TResult>
): Promise<TResult> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await executor.transaction(work, TRANSACTION_CONFIG);
    } catch (error) {
      if (attempt >= TRANSACTION_ATTEMPTS || !hasRetryableSqlState(error)) {
        throw error;
      }
    }
  }
}

function hasRetryableSqlState(error: unknown): boolean {
  let current = error;
  const visited = new Set<object>();
  for (let depth = 0; depth < SQLSTATE_CAUSE_DEPTH_LIMIT; depth += 1) {
    if (
      typeof current !== "object" ||
      current === null ||
      visited.has(current)
    ) {
      return false;
    }
    visited.add(current);
    let code: unknown;
    let cause: unknown;
    try {
      code = Reflect.get(current, "code");
      cause = Reflect.get(current, "cause");
    } catch {
      return false;
    }
    if (typeof code === "string" && RETRYABLE_SQLSTATES.has(code)) return true;
    current = cause;
  }
  return false;
}

function timestampValue(value: unknown, label: string): string {
  const timestamp =
    value instanceof Date
      ? value
      : typeof value === "string"
        ? new Date(value)
        : null;
  if (timestamp === null || Number.isNaN(timestamp.getTime())) {
    throw invariantError(`${label} must be a timestamp.`);
  }
  return inboxV2TimestampSchema.parse(timestamp.toISOString());
}

function bigintText(value: unknown, label: string): string {
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string") return value;
  throw invariantError(`${label} must be a lossless bigint string.`);
}

function nextRevision(value: unknown, label: string): string {
  const current = inboxV2EntityRevisionSchema.parse(bigintText(value, label));
  return inboxV2EntityRevisionSchema.parse((BigInt(current) + 1n).toString());
}

function integerValue(value: unknown): number {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "bigint" || typeof value === "string"
        ? Number(value)
        : Number.NaN;
  if (!Number.isSafeInteger(parsed)) {
    throw invariantError("Source-processing integer value is invalid.");
  }
  return parsed;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw invariantError(`${label} must be a string.`);
  }
  return value;
}

function nullableString(value: unknown, label: string): string | null {
  return value === null ? null : stringValue(value, label);
}

function nullableTimestamp(value: unknown, label: string): string | null {
  return value === null ? null : timestampValue(value, label);
}

function exactlyOneRow<Row>(rows: readonly Row[], label: string): Row {
  if (rows.length !== 1) {
    throw invariantError(`${label} must return exactly one row.`);
  }
  return rows[0]!;
}

function invariantError(
  message: string
): InboxV2SourceProcessingPersistenceInvariantError {
  return new InboxV2SourceProcessingPersistenceInvariantError(message);
}
