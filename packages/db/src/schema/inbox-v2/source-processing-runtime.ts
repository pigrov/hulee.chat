import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenantSecrets,
  tenants
} from "../tables";
import { inboxV2SourceNormalizedEnvelopes } from "./source-normalization";
import {
  inboxV2SourceRawEnvelopes,
  inboxV2SourceRawQuarantines
} from "./source-raw-ingress";
import { inboxV2SourceThreadBindings } from "./source-thread-binding";

export const inboxV2SourceProcessingKeyState = pgEnum(
  "inbox_v2_source_processing_key_state",
  ["active", "verify_only", "retired"]
);

export const inboxV2SourceDeliveryOutcome = pgEnum(
  "inbox_v2_source_delivery_outcome",
  ["processed", "ignored", "duplicate", "dead_lettered"]
);

export const inboxV2SourceProcessingStage = pgEnum(
  "inbox_v2_source_processing_stage",
  [
    "raw_ingest",
    "normalization",
    "identity_resolution",
    "conversation_resolution",
    "routing",
    "message_reconciliation",
    "materialization"
  ]
);

export const inboxV2SourceProcessingWorkState = pgEnum(
  "inbox_v2_source_processing_work_state",
  [
    "pending",
    "leased",
    "retry_scheduled",
    "processed",
    "ignored",
    "duplicate",
    "dead_lettered"
  ]
);

export const inboxV2SourceProcessingRetryability = pgEnum(
  "inbox_v2_source_processing_retryability",
  ["retryable", "not_retryable"]
);

export const inboxV2SourceProcessingAttemptOutcome = pgEnum(
  "inbox_v2_source_processing_attempt_outcome",
  ["retry_scheduled", "processed", "ignored", "duplicate", "dead_lettered"]
);

export const inboxV2SourceProcessingAttemptOrigin = pgEnum(
  "inbox_v2_source_processing_attempt_origin",
  ["initial", "retry", "replay"]
);

export const inboxV2SourceDeadLetterReason = pgEnum(
  "inbox_v2_source_dead_letter_reason",
  ["terminal_failure", "attempts_exhausted"]
);

export const inboxV2SourceDedupePhase = pgEnum("inbox_v2_source_dedupe_phase", [
  "raw",
  "normalized"
]);

export const inboxV2SourceReplayabilityState = pgEnum(
  "inbox_v2_source_replayability_state",
  ["replayable", "not_replayable", "expired"]
);

export const inboxV2SourceDedupeLifecycleState = pgEnum(
  "inbox_v2_source_dedupe_lifecycle_state",
  ["active", "expired"]
);

export const inboxV2SourceReplayMode = pgEnum("inbox_v2_source_replay_mode", [
  "raw_event",
  "normalized_event",
  "dead_letter"
]);

export const inboxV2SourceReplayState = pgEnum("inbox_v2_source_replay_state", [
  "pending",
  "leased",
  "applied",
  "denied",
  "expired"
]);

export const inboxV2SourceReplayRejectionReason = pgEnum(
  "inbox_v2_source_replay_rejection_reason",
  [
    "target_not_replayable",
    "replay_expired",
    "evidence_unavailable",
    "scope_mismatch",
    "revision_conflict",
    "key_unavailable",
    "idempotency_conflict"
  ]
);

export const inboxV2SourceReplayActorKind = pgEnum(
  "inbox_v2_source_replay_actor_kind",
  ["employee", "trusted_service"]
);

export const inboxV2SourceAccountPressureState = pgEnum(
  "inbox_v2_source_account_pressure_state",
  ["open", "rate_limited", "paused"]
);

export const inboxV2SourceCursorOwner = pgEnum("inbox_v2_source_cursor_owner", [
  "source_connection",
  "source_account",
  "source_thread_binding"
]);

export const inboxV2SourceCursorKind = pgEnum("inbox_v2_source_cursor_kind", [
  "receive_cursor",
  "history_cursor",
  "provider_watermark"
]);

export const inboxV2SourceCursorDurableTargetKind = pgEnum(
  "inbox_v2_source_cursor_durable_target_kind",
  ["raw_work", "quarantine"]
);

/**
 * Metadata for tenant/purpose scoped HMAC generations. Key material stays in
 * tenant_secrets; all issuance, guarantee and verification windows are finite.
 */
export const inboxV2SourceProcessingKeyGenerations = pgTable(
  "inbox_v2_source_processing_key_generations",
  {
    tenantId: text("tenant_id").notNull(),
    purposeId: text("purpose_id").notNull(),
    generation: text("generation").notNull(),
    secretRef: text("secret_ref").notNull(),
    state: inboxV2SourceProcessingKeyState("state").notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    useUntil: timestamp("use_until", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    guaranteeNotAfter: timestamp("guarantee_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    verifyUntil: timestamp("verify_until", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    retiredAt: timestamp("retired_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_proc_key_gen_pk",
      columns: [table.tenantId, table.purposeId, table.generation]
    }),
    unique("inbox_v2_src_proc_key_secret_unique").on(
      table.tenantId,
      table.secretRef
    ),
    unique("inbox_v2_src_proc_key_exact_unique").on(
      table.tenantId,
      table.purposeId,
      table.generation,
      table.secretRef
    ),
    foreignKey({
      name: "inbox_v2_src_proc_key_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_key_secret_fk",
      columns: [table.tenantId, table.secretRef],
      foreignColumns: [tenantSecrets.tenantId, tenantSecrets.secretRef]
    }),
    check(
      "inbox_v2_src_proc_key_identity_check",
      sql`${catalogIdSql(table.purposeId)}
        and ${keyGenerationSql(table.generation)}
        and ${secretRefSql(table.secretRef)}
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_src_proc_key_window_check",
      sql`isfinite(${table.activatedAt})
        and isfinite(${table.useUntil})
        and isfinite(${table.guaranteeNotAfter})
        and isfinite(${table.verifyUntil})
        and ${table.activatedAt} < ${table.useUntil}
        and ${table.useUntil} <= ${table.guaranteeNotAfter}
        and ${table.guaranteeNotAfter} <= ${table.verifyUntil}
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} <= ${table.activatedAt}
        and ${table.createdAt} <= ${table.updatedAt}`
    ),
    check(
      "inbox_v2_src_proc_key_state_check",
      sql`(
          ${table.state} in ('active', 'verify_only')
          and ${table.retiredAt} is null
        ) or (
          ${table.state} = 'retired'
          and ${table.retiredAt} is not null
          and isfinite(${table.retiredAt})
          and ${table.retiredAt} >= ${table.verifyUntil}
        )`
    ),
    uniqueIndex("inbox_v2_src_proc_key_active_unique")
      .on(table.tenantId, table.purposeId)
      .where(sql`${table.state} = 'active'`),
    index("inbox_v2_src_proc_key_verify_idx").on(
      table.tenantId,
      table.verifyUntil,
      table.purposeId,
      table.generation
    )
  ]
);

/**
 * Finite dedupe/outcome evidence. Provider identifiers and unkeyed digests are
 * deliberately absent; lookup is through a tenant/purpose generation HMAC.
 */
export const inboxV2SourceDeliveryDedupeSkeletons = pgTable(
  "inbox_v2_source_delivery_dedupe_skeletons",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    phase: inboxV2SourceDedupePhase("phase").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    normalizedEventId: text("normalized_event_id"),
    purposeId: text("purpose_id").notNull(),
    keyGeneration: text("key_generation").notNull(),
    keyVerifyUntil: timestamp("key_verify_until", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    identityHmacSha256: text("identity_hmac_sha256").notNull(),
    outcomeHmacSha256: text("outcome_hmac_sha256").notNull(),
    outcome: inboxV2SourceDeliveryOutcome("outcome").notNull(),
    diagnosticCodeId: text("diagnostic_code_id"),
    evidenceCapturedAt: timestamp("evidence_captured_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    rawPayloadExpiresAt: timestamp("raw_payload_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    allowedRawHeadersExpiresAt: timestamp("allowed_raw_headers_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    normalizedPayloadExpiresAt: timestamp("normalized_payload_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    terminalAt: timestamp("terminal_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    guaranteeUntil: timestamp("guarantee_until", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    replayabilityState: inboxV2SourceReplayabilityState(
      "replayability_state"
    ).notNull(),
    replayUntil: timestamp("replay_until", {
      withTimezone: true,
      precision: 3
    }),
    replayabilityReasonCodeId: text("replayability_reason_code_id"),
    skeletonExpiresAt: timestamp("skeleton_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    lifecycleState:
      inboxV2SourceDedupeLifecycleState("lifecycle_state").notNull(),
    expiredAt: timestamp("expired_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_dedupe_skeleton_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_src_dedupe_hmac_unique").on(
      table.tenantId,
      table.purposeId,
      table.keyGeneration,
      table.identityHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_src_dedupe_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_account_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_key_fk",
      columns: [table.tenantId, table.purposeId, table.keyGeneration],
      foreignColumns: [
        inboxV2SourceProcessingKeyGenerations.tenantId,
        inboxV2SourceProcessingKeyGenerations.purposeId,
        inboxV2SourceProcessingKeyGenerations.generation
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_raw_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_raw_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_dedupe_normalized_fk",
      columns: [table.tenantId, table.normalizedEventId],
      foreignColumns: [
        inboxV2SourceNormalizedEnvelopes.tenantId,
        inboxV2SourceNormalizedEnvelopes.normalizedEventId
      ]
    }),
    check(
      "inbox_v2_src_dedupe_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_src_dedupe_identity_check",
      sql`${internalIdSql(table.id)}
        and ${table.routeGeneration} >= 1
        and ${table.purposeId} = 'core:source_replay_and_diagnostics'
        and ${keyGenerationSql(table.keyGeneration)}
        and isfinite(${table.keyVerifyUntil})
        and ${hmacSha256Sql(table.identityHmacSha256)}
        and ${hmacSha256Sql(table.outcomeHmacSha256)}
        and ${table.revision} >= 1
        and (
          (${table.phase} = 'raw' and ${table.normalizedEventId} is null)
          or (${table.phase} = 'normalized'
            and ${table.normalizedEventId} is not null)
        )`
    ),
    check(
      "inbox_v2_src_dedupe_outcome_check",
      sql`(
          ${table.outcome} in ('processed', 'duplicate')
          and ${table.diagnosticCodeId} is null
        ) or (
          ${table.outcome} in ('ignored', 'dead_lettered')
          and ${table.diagnosticCodeId} is not null
          and ${catalogIdSql(table.diagnosticCodeId)}
        )`
    ),
    check(
      "inbox_v2_src_dedupe_window_check",
      sql`isfinite(${table.evidenceCapturedAt})
        and isfinite(${table.rawPayloadExpiresAt})
        and isfinite(${table.allowedRawHeadersExpiresAt})
        and ${table.evidenceCapturedAt} < ${table.rawPayloadExpiresAt}
        and ${table.evidenceCapturedAt} < ${table.allowedRawHeadersExpiresAt}
        and (
          (${table.phase} = 'raw'
            and ${table.normalizedPayloadExpiresAt} is null)
          or (${table.phase} = 'normalized'
            and ${table.normalizedPayloadExpiresAt} is not null
            and isfinite(${table.normalizedPayloadExpiresAt})
            and ${table.evidenceCapturedAt} <
                ${table.normalizedPayloadExpiresAt})
        )
        and isfinite(${table.terminalAt})
        and isfinite(${table.guaranteeUntil})
        and isfinite(${table.skeletonExpiresAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} = ${table.terminalAt}
        and ${table.createdAt} <= ${table.updatedAt}
        and ${table.evidenceCapturedAt} <= ${table.terminalAt}
        and ${table.terminalAt} < ${table.guaranteeUntil}
        and ${table.guaranteeUntil} <= ${table.skeletonExpiresAt}
        and ${table.guaranteeUntil} <= ${table.keyVerifyUntil}
        and (
          (${table.replayabilityState} = 'replayable'
            and ${table.replayUntil} is not null
            and isfinite(${table.replayUntil})
            and ${table.replayUntil} > ${table.terminalAt}
            and ${table.replayUntil} <= ${table.guaranteeUntil}
            and ${table.replayUntil} <= case
              when ${table.phase} = 'raw' then ${table.rawPayloadExpiresAt}
              else ${table.normalizedPayloadExpiresAt}
            end
            and ${table.replayabilityReasonCodeId} is null)
          or (${table.replayabilityState} in ('not_replayable', 'expired')
            and ${table.replayUntil} is null
            and ${table.replayabilityReasonCodeId} is not null
            and ${catalogIdSql(table.replayabilityReasonCodeId)})
        )
        and (
          (${table.lifecycleState} = 'active' and ${table.expiredAt} is null)
          or (${table.lifecycleState} = 'expired'
            and ${table.expiredAt} is not null
            and isfinite(${table.expiredAt})
            and ${table.expiredAt} >= ${table.skeletonExpiresAt})
        )`
    ),
    index("inbox_v2_src_dedupe_expiry_idx").on(
      table.tenantId,
      table.skeletonExpiresAt,
      table.id
    ),
    index("inbox_v2_src_dedupe_replay_expiry_idx").on(
      table.tenantId,
      table.replayUntil,
      table.id
    ),
    index("inbox_v2_src_dedupe_account_idx").on(
      table.tenantId,
      table.sourceAccountScopeKey,
      table.guaranteeUntil,
      table.id
    )
  ]
);

/** Mutable current processing head. Historical attempts and DLQ facts are separate. */
export const inboxV2SourceProcessingWorkHeads = pgTable(
  "inbox_v2_source_processing_work_heads",
  {
    tenantId: text("tenant_id").notNull(),
    workId: text("work_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    normalizedEventId: text("normalized_event_id"),
    normalizedEventScopeKey: text("normalized_event_scope_key").notNull(),
    stage: inboxV2SourceProcessingStage("stage").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    state: inboxV2SourceProcessingWorkState("state").notNull(),
    processingGeneration: bigint("processing_generation", {
      mode: "bigint"
    }).notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    attemptCount: bigint("attempt_count", { mode: "bigint" }).notNull(),
    leaseOwnerId: text("lease_owner_id"),
    leaseTokenHash: text("lease_token_hash"),
    leaseRevision: bigint("lease_revision", { mode: "bigint" }),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    lastDiagnosticCodeId: text("last_diagnostic_code_id"),
    retryability: inboxV2SourceProcessingRetryability("retryability"),
    rateLimitResetAt: timestamp("rate_limit_reset_at", {
      withTimezone: true,
      precision: 3
    }),
    deadLetteredAt: timestamp("dead_lettered_at", {
      withTimezone: true,
      precision: 3
    }),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_proc_work_pk",
      columns: [table.tenantId, table.workId]
    }),
    unique("inbox_v2_src_proc_work_scope_unique").on(
      table.tenantId,
      table.rawEventId,
      table.normalizedEventScopeKey,
      table.stage
    ),
    unique("inbox_v2_src_proc_work_relation_unique").on(
      table.tenantId,
      table.workId,
      table.rawEventId,
      table.stage
    ),
    unique("inbox_v2_src_proc_work_replay_target_unique").on(
      table.tenantId,
      table.workId,
      table.rawEventId,
      table.normalizedEventScopeKey,
      table.stage,
      table.sourceConnectionId,
      table.sourceAccountScopeKey,
      table.routeGeneration
    ),
    foreignKey({
      name: "inbox_v2_src_proc_work_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_work_raw_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_work_normalized_fk",
      columns: [table.tenantId, table.normalizedEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_work_raw_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_work_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_work_account_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    uniqueIndex("inbox_v2_src_proc_work_lease_unique")
      .on(table.tenantId, table.leaseTokenHash)
      .where(sql`${table.leaseTokenHash} is not null`),
    check(
      "inbox_v2_src_proc_work_scope_check",
      sql`${accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)}
        and ${nullableScopeSql(
          table.normalizedEventId,
          table.normalizedEventScopeKey
        )}
        and (
          (${table.stage} in ('raw_ingest', 'normalization')
            and ${table.normalizedEventId} is null)
          or (${table.stage} not in ('raw_ingest', 'normalization')
            and ${table.normalizedEventId} is not null)
        )`
    ),
    check(
      "inbox_v2_src_proc_work_values_check",
      sql`${internalIdSql(table.workId)}
        and ${table.routeGeneration} >= 1
        and ${table.processingGeneration} >= 1
        and ${table.maxAttempts} between 1 and 100
        and ${table.attemptCount} between 0 and ${table.maxAttempts}
        and ${table.revision} >= 1
        and (${table.leaseOwnerId} is null or ${internalIdSql(table.leaseOwnerId)})
        and (${table.leaseTokenHash} is null
          or ${sha256Sql(table.leaseTokenHash)})
        and (${table.lastDiagnosticCodeId} is null
          or ${catalogIdSql(table.lastDiagnosticCodeId)})`
    ),
    check(
      "inbox_v2_src_proc_work_state_check",
      sql`(
          ${table.state} in ('pending', 'retry_scheduled')
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.deadLetteredAt} is null
          and ${table.completedAt} is null
          and (
            ${table.state} = 'pending'
            or (
              ${table.attemptCount} >= 1
              and ${table.lastDiagnosticCodeId} is not null
              and ${table.retryability} = 'retryable'
            )
          )
        ) or (
          ${table.state} = 'leased'
          and ${table.attemptCount} between 1 and ${table.maxAttempts}
          and ${table.leaseOwnerId} is not null
          and ${table.leaseTokenHash} is not null
          and ${table.leaseRevision} >= 1
          and ${table.leaseClaimedAt} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.deadLetteredAt} is null
          and ${table.completedAt} is null
        ) or (
          ${table.state} = 'processed'
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.lastDiagnosticCodeId} is null
          and ${table.retryability} is null
          and ${table.deadLetteredAt} is null
          and ${table.completedAt} is not null
        ) or (
          ${table.state} in ('ignored', 'duplicate')
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.lastDiagnosticCodeId} is not null
          and ${table.retryability} = 'not_retryable'
          and ${table.deadLetteredAt} is null
          and ${table.completedAt} is not null
        ) or (
          ${table.state} = 'dead_lettered'
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.lastDiagnosticCodeId} is not null
          and ${table.retryability} is not null
          and ${table.deadLetteredAt} is not null
          and ${table.completedAt} is null
        )`
    ),
    check(
      "inbox_v2_src_proc_work_times_check",
      sql`isfinite(${table.availableAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} <= ${table.updatedAt}
        and (${table.leaseClaimedAt} is null or (
          isfinite(${table.leaseClaimedAt})
          and ${table.leaseClaimedAt} <= ${table.updatedAt}
        ))
        and (${table.leaseExpiresAt} is null or (
          isfinite(${table.leaseExpiresAt})
          and ${table.leaseExpiresAt} > ${table.updatedAt}
        ))
        and (${table.rateLimitResetAt} is null
          or isfinite(${table.rateLimitResetAt}))
        and (${table.deadLetteredAt} is null
          or ${table.deadLetteredAt} = ${table.updatedAt})
        and (${table.completedAt} is null
          or ${table.completedAt} = ${table.updatedAt})`
    ),
    index("inbox_v2_src_proc_work_due_idx")
      .on(
        table.tenantId,
        table.sourceAccountScopeKey,
        table.availableAt,
        table.rawEventId,
        table.stage
      )
      .where(sql`${table.state} in ('pending', 'retry_scheduled')`),
    index("inbox_v2_src_proc_work_reclaim_idx")
      .on(
        table.tenantId,
        table.sourceAccountScopeKey,
        table.leaseExpiresAt,
        table.rawEventId,
        table.stage
      )
      .where(sql`${table.state} = 'leased'`),
    index("inbox_v2_src_proc_work_terminal_idx")
      .on(table.tenantId, table.state, table.updatedAt, table.rawEventId)
      .where(
        sql`${table.state} in ('processed', 'ignored', 'duplicate', 'dead_lettered')`
      )
  ]
);

/** Immutable bounded diagnostic for one completed processing attempt. */
export const inboxV2SourceProcessingAttempts = pgTable(
  "inbox_v2_source_processing_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    workId: text("work_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    stage: inboxV2SourceProcessingStage("stage").notNull(),
    origin: inboxV2SourceProcessingAttemptOrigin("origin").notNull(),
    replayRequestId: text("replay_request_id"),
    processingGeneration: bigint("processing_generation", {
      mode: "bigint"
    }).notNull(),
    attemptNumber: bigint("attempt_number", { mode: "bigint" }).notNull(),
    maxAttempts: integer("max_attempts").notNull(),
    workRevision: bigint("work_revision", { mode: "bigint" }).notNull(),
    outcome: inboxV2SourceProcessingAttemptOutcome("outcome").notNull(),
    workerId: text("worker_id").notNull(),
    leaseTokenHash: text("lease_token_hash").notNull(),
    leaseRevision: bigint("lease_revision", { mode: "bigint" }).notNull(),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    finishedAt: timestamp("finished_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    diagnosticCodeId: text("diagnostic_code_id"),
    retryability: inboxV2SourceProcessingRetryability("retryability"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    nextAttemptAt: timestamp("next_attempt_at", {
      withTimezone: true,
      precision: 3
    }),
    rateLimitResetAt: timestamp("rate_limit_reset_at", {
      withTimezone: true,
      precision: 3
    }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_proc_attempt_pk",
      columns: [table.tenantId, table.attemptId]
    }),
    unique("inbox_v2_src_proc_attempt_ordinal_unique").on(
      table.tenantId,
      table.workId,
      table.processingGeneration,
      table.attemptNumber
    ),
    unique("inbox_v2_src_proc_attempt_revision_unique").on(
      table.tenantId,
      table.workId,
      table.workRevision
    ),
    foreignKey({
      name: "inbox_v2_src_proc_attempt_work_fk",
      columns: [table.tenantId, table.workId, table.rawEventId, table.stage],
      foreignColumns: [
        inboxV2SourceProcessingWorkHeads.tenantId,
        inboxV2SourceProcessingWorkHeads.workId,
        inboxV2SourceProcessingWorkHeads.rawEventId,
        inboxV2SourceProcessingWorkHeads.stage
      ]
    }),
    check(
      "inbox_v2_src_proc_attempt_values_check",
      sql`${internalIdSql(table.attemptId)}
        and ${internalIdSql(table.workId)}
        and ${table.processingGeneration} >= 1
        and ${table.attemptNumber} >= 1
        and ${table.maxAttempts} between 1 and 100
        and ${table.attemptNumber} <= ${table.maxAttempts}
        and ${table.workRevision} >= 2
        and ${internalIdSql(table.workerId)}
        and ${sha256Sql(table.leaseTokenHash)}
        and ${table.leaseRevision} >= 1
        and (${table.diagnosticCodeId} is null
          or ${catalogIdSql(table.diagnosticCodeId)})
        and (${table.diagnosticCorrelationToken} is null
          or ${internalIdSql(table.diagnosticCorrelationToken)})
        and (${table.diagnosticSafeOperatorHintId} is null
          or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})
        and (
          (${table.origin} = 'replay' and ${table.replayRequestId} is not null)
          or (${table.origin} <> 'replay'
            and ${table.replayRequestId} is null)
        )
        and (${table.origin} <> 'initial' or ${table.attemptNumber} = 1)
        and (${table.origin} <> 'retry' or ${table.attemptNumber} > 1)`
    ),
    check(
      "inbox_v2_src_proc_attempt_outcome_check",
      sql`(
          ${table.outcome} = 'processed'
          and ${table.diagnosticCodeId} is null
          and ${table.retryability} is null
          and ${table.diagnosticCorrelationToken} is null
          and ${table.diagnosticSafeOperatorHintId} is null
          and ${table.nextAttemptAt} is null
        ) or (
          ${table.outcome} in ('ignored', 'duplicate')
          and ${table.diagnosticCodeId} is not null
          and ${table.retryability} = 'not_retryable'
          and ${table.diagnosticCorrelationToken} is not null
          and ${table.nextAttemptAt} is null
        ) or (
          ${table.outcome} = 'retry_scheduled'
          and ${table.diagnosticCodeId} is not null
          and ${table.retryability} = 'retryable'
          and ${table.diagnosticCorrelationToken} is not null
          and ${table.nextAttemptAt} is not null
        ) or (
          ${table.outcome} = 'dead_lettered'
          and ${table.diagnosticCodeId} is not null
          and ${table.retryability} is not null
          and ${table.diagnosticCorrelationToken} is not null
          and ${table.nextAttemptAt} is null
        )`
    ),
    check(
      "inbox_v2_src_proc_attempt_times_check",
      sql`isfinite(${table.leaseClaimedAt})
        and isfinite(${table.startedAt})
        and isfinite(${table.finishedAt})
        and isfinite(${table.leaseExpiresAt})
        and isfinite(${table.expiresAt})
        and isfinite(${table.createdAt})
        and ${table.leaseClaimedAt} <= ${table.startedAt}
        and ${table.startedAt} <= ${table.finishedAt}
        and ${table.finishedAt} < ${table.leaseExpiresAt}
        and ${table.createdAt} = ${table.finishedAt}
        and ${table.expiresAt} > ${table.finishedAt}
        and (${table.nextAttemptAt} is null
          or ${table.nextAttemptAt} > ${table.finishedAt})
        and (${table.rateLimitResetAt} is null
          or ${table.rateLimitResetAt} >= ${table.finishedAt})`
    ),
    index("inbox_v2_src_proc_attempt_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
      table.rawEventId,
      table.stage
    ),
    index("inbox_v2_src_proc_attempt_code_idx").on(
      table.tenantId,
      table.diagnosticCodeId,
      table.finishedAt,
      table.rawEventId
    )
  ]
);

/** Immutable safe DLQ fact; replay resolution is represented by a replay request. */
export const inboxV2SourceProcessingDeadLetters = pgTable(
  "inbox_v2_source_processing_dead_letters",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    workId: text("work_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    stage: inboxV2SourceProcessingStage("stage").notNull(),
    processingGeneration: bigint("processing_generation", {
      mode: "bigint"
    }).notNull(),
    attemptNumber: bigint("attempt_number", { mode: "bigint" }).notNull(),
    workRevision: bigint("work_revision", { mode: "bigint" }).notNull(),
    reason: inboxV2SourceDeadLetterReason("reason").notNull(),
    diagnosticCodeId: text("diagnostic_code_id").notNull(),
    retryability: inboxV2SourceProcessingRetryability("retryability").notNull(),
    diagnosticCorrelationToken: text("diagnostic_correlation_token").notNull(),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    evidenceCapturedAt: timestamp("evidence_captured_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    rawPayloadExpiresAt: timestamp("raw_payload_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    allowedRawHeadersExpiresAt: timestamp("allowed_raw_headers_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    normalizedPayloadExpiresAt: timestamp("normalized_payload_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    replayNotAfter: timestamp("replay_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_proc_dlq_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_src_proc_dlq_work_unique").on(
      table.tenantId,
      table.workId,
      table.processingGeneration,
      table.workRevision
    ),
    foreignKey({
      name: "inbox_v2_src_proc_dlq_work_fk",
      columns: [table.tenantId, table.workId, table.rawEventId, table.stage],
      foreignColumns: [
        inboxV2SourceProcessingWorkHeads.tenantId,
        inboxV2SourceProcessingWorkHeads.workId,
        inboxV2SourceProcessingWorkHeads.rawEventId,
        inboxV2SourceProcessingWorkHeads.stage
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_proc_dlq_attempt_fk",
      columns: [table.tenantId, table.attemptId],
      foreignColumns: [
        inboxV2SourceProcessingAttempts.tenantId,
        inboxV2SourceProcessingAttempts.attemptId
      ]
    }),
    check(
      "inbox_v2_src_proc_dlq_values_check",
      sql`${internalIdSql(table.id)}
        and ${internalIdSql(table.workId)}
        and ${internalIdSql(table.attemptId)}
        and ${table.processingGeneration} >= 1
        and ${table.attemptNumber} >= 1
        and ${table.workRevision} >= 2
        and ${catalogIdSql(table.diagnosticCodeId)}
        and ${internalIdSql(table.diagnosticCorrelationToken)}
        and (${table.diagnosticSafeOperatorHintId} is null
          or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})`
    ),
    check(
      "inbox_v2_src_proc_dlq_window_check",
      sql`isfinite(${table.evidenceCapturedAt})
        and isfinite(${table.rawPayloadExpiresAt})
        and isfinite(${table.allowedRawHeadersExpiresAt})
        and ${table.evidenceCapturedAt} < ${table.rawPayloadExpiresAt}
        and ${table.evidenceCapturedAt} < ${table.allowedRawHeadersExpiresAt}
        and (
          (${table.stage} in ('raw_ingest', 'normalization')
            and ${table.normalizedPayloadExpiresAt} is null
            and ${table.replayNotAfter} <= ${table.rawPayloadExpiresAt})
          or (${table.stage} not in ('raw_ingest', 'normalization')
            and ${table.normalizedPayloadExpiresAt} is not null
            and isfinite(${table.normalizedPayloadExpiresAt})
            and ${table.evidenceCapturedAt} <
                ${table.normalizedPayloadExpiresAt}
            and ${table.replayNotAfter} <=
                ${table.normalizedPayloadExpiresAt})
        )
        and isfinite(${table.recordedAt})
        and isfinite(${table.replayNotAfter})
        and isfinite(${table.expiresAt})
        and ${table.evidenceCapturedAt} <= ${table.recordedAt}
        and ${table.recordedAt} < ${table.replayNotAfter}
        and ${table.replayNotAfter} <= ${table.expiresAt}`
    ),
    check(
      "inbox_v2_src_proc_dlq_reason_check",
      sql`(
          ${table.reason} = 'attempts_exhausted'
          and ${table.retryability} = 'retryable'
          and ${table.attemptNumber} >= 1
        ) or (
          ${table.reason} = 'terminal_failure'
          and ${table.retryability} = 'not_retryable'
        )`
    ),
    index("inbox_v2_src_proc_dlq_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
      table.id
    ),
    index("inbox_v2_src_proc_dlq_replay_idx").on(
      table.tenantId,
      table.replayNotAfter,
      table.rawEventId,
      table.stage
    )
  ]
);

/** Exact canonical-hash-idempotent operator replay command head. */
export const inboxV2SourceReplayRequests = pgTable(
  "inbox_v2_source_replay_requests",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    targetWorkId: text("target_work_id").notNull(),
    mode: inboxV2SourceReplayMode("mode").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    normalizedEventId: text("normalized_event_id"),
    normalizedEventScopeKey: text("normalized_event_scope_key").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    deadLetterId: text("dead_letter_id"),
    stage: inboxV2SourceProcessingStage("stage").notNull(),
    expectedTargetRevision: bigint("expected_target_revision", {
      mode: "bigint"
    }).notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    requestHash: text("request_hash").notNull(),
    reasonId: text("reason_id").notNull(),
    requestedByKind:
      inboxV2SourceReplayActorKind("requested_by_kind").notNull(),
    requestedByEmployeeId: text("requested_by_employee_id"),
    requestedByTrustedServiceId: text("requested_by_trusted_service_id"),
    state: inboxV2SourceReplayState("state").notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    replayNotAfter: timestamp("replay_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    leaseOwnerId: text("lease_owner_id"),
    leaseTokenHash: text("lease_token_hash"),
    leaseRevision: bigint("lease_revision", { mode: "bigint" }),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    resultProcessingGeneration: bigint("result_processing_generation", {
      mode: "bigint"
    }),
    resultReplayEpisodeId: text("result_replay_episode_id"),
    resultWorkId: text("result_work_id"),
    resultWorkRevision: bigint("result_work_revision", {
      mode: "bigint"
    }),
    rejectionReason: inboxV2SourceReplayRejectionReason("rejection_reason"),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryability: inboxV2SourceProcessingRetryability(
      "diagnostic_retryability"
    ),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    requestedAt: timestamp("requested_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    })
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_replay_request_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_src_replay_request_hash_unique").on(
      table.tenantId,
      table.requestHash
    ),
    uniqueIndex("inbox_v2_src_replay_lease_unique")
      .on(table.tenantId, table.leaseTokenHash)
      .where(sql`${table.leaseTokenHash} is not null`),
    uniqueIndex("inbox_v2_src_replay_active_target_unique")
      .on(table.tenantId, table.targetWorkId)
      .where(sql`${table.state} in ('pending', 'leased')`),
    check(
      "inbox_v2_src_replay_identity_check",
      sql`${internalIdSql(table.id)}
        and ${internalIdSql(table.targetWorkId)}
        and ${table.expectedTargetRevision} >= 1
        and ${table.routeGeneration} >= 1
        and ${accountScopeSql(
          table.sourceAccountId,
          table.sourceAccountScopeKey
        )}
        and ${nullableScopeSql(
          table.normalizedEventId,
          table.normalizedEventScopeKey
        )}
        and ${sha256Sql(table.requestHash)}
        and ${catalogIdSql(table.reasonId)}
        and (
          (${table.requestedByKind} = 'employee'
            and ${table.requestedByEmployeeId} is not null
            and ${table.requestedByTrustedServiceId} is null)
          or (${table.requestedByKind} = 'trusted_service'
            and ${table.requestedByEmployeeId} is null
            and ${table.requestedByTrustedServiceId} is not null
            and ${internalIdSql(table.requestedByTrustedServiceId)})
        )
        and ${table.revision} >= 1
        and (${table.leaseOwnerId} is null or ${internalIdSql(table.leaseOwnerId)})
        and (${table.leaseTokenHash} is null
          or ${sha256Sql(table.leaseTokenHash)})
        and (${table.diagnosticCodeId} is null
          or ${catalogIdSql(table.diagnosticCodeId)})
        and (${table.diagnosticCorrelationToken} is null
          or ${internalIdSql(table.diagnosticCorrelationToken)})
        and (${table.diagnosticSafeOperatorHintId} is null
          or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})`
    ),
    check(
      "inbox_v2_src_replay_target_check",
      sql`(
          ${table.mode} = 'raw_event'
          and ${table.stage} = 'normalization'
          and ${table.normalizedEventId} is null
        ) or (
          ${table.mode} = 'normalized_event'
          and ${table.stage} not in ('raw_ingest', 'normalization')
          and ${table.normalizedEventId} is not null
        ) or (
          ${table.mode} = 'dead_letter'
          and (
            (${table.stage} in ('raw_ingest', 'normalization')
              and ${table.normalizedEventId} is null)
            or (${table.stage} not in ('raw_ingest', 'normalization')
              and ${table.normalizedEventId} is not null)
          )
        )`
    ),
    check(
      "inbox_v2_src_replay_state_check",
      sql`(
          ${table.state} = 'pending'
          and ${table.deadLetterId} is not null
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.resultProcessingGeneration} is null
          and ${table.resultReplayEpisodeId} is null
          and ${table.resultWorkId} is null
          and ${table.resultWorkRevision} is null
          and ${table.rejectionReason} is null
          and ${table.diagnosticCodeId} is null
          and ${table.diagnosticRetryability} is null
          and ${table.diagnosticCorrelationToken} is null
          and ${table.diagnosticSafeOperatorHintId} is null
          and ${table.completedAt} is null
        ) or (
          ${table.state} = 'leased'
          and ${table.deadLetterId} is not null
          and ${table.leaseOwnerId} is not null
          and ${table.leaseTokenHash} is not null
          and ${table.leaseRevision} >= 1
          and ${table.leaseClaimedAt} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.resultProcessingGeneration} is null
          and ${table.resultReplayEpisodeId} is null
          and ${table.resultWorkId} is null
          and ${table.resultWorkRevision} is null
          and ${table.rejectionReason} is null
          and ${table.diagnosticCodeId} is null
          and ${table.diagnosticRetryability} is null
          and ${table.diagnosticCorrelationToken} is null
          and ${table.diagnosticSafeOperatorHintId} is null
          and ${table.completedAt} is null
        ) or (
          ${table.state} = 'applied'
          and ${table.deadLetterId} is not null
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.resultProcessingGeneration} >= 2
          and ${table.resultReplayEpisodeId} is not null
          and ${internalIdSql(table.resultReplayEpisodeId)}
          and ${table.resultWorkId} is not null
          and ${internalIdSql(table.resultWorkId)}
          and ${table.resultWorkRevision} >= 1
          and ${table.rejectionReason} is null
          and ${table.diagnosticCodeId} is null
          and ${table.diagnosticRetryability} is null
          and ${table.diagnosticCorrelationToken} is null
          and ${table.diagnosticSafeOperatorHintId} is null
          and ${table.completedAt} is not null
        ) or (
          ${table.state} = 'denied'
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.resultProcessingGeneration} is null
          and ${table.resultReplayEpisodeId} is null
          and ${table.resultWorkId} is null
          and ${table.resultWorkRevision} is null
          and ${table.rejectionReason} is not null
          and ${table.rejectionReason} <> 'replay_expired'
          and ${table.diagnosticCodeId} is not null
          and ${table.diagnosticRetryability} = 'not_retryable'
          and ${table.diagnosticCorrelationToken} is not null
          and ${table.completedAt} is not null
        ) or (
          ${table.state} = 'expired'
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
          and ${table.resultProcessingGeneration} is null
          and ${table.resultReplayEpisodeId} is null
          and ${table.resultWorkId} is null
          and ${table.resultWorkRevision} is null
          and ${table.rejectionReason} = 'replay_expired'
          and ${table.diagnosticCodeId} is not null
          and ${table.diagnosticRetryability} = 'not_retryable'
          and ${table.diagnosticCorrelationToken} is not null
          and ${table.completedAt} is not null
        )`
    ),
    check(
      "inbox_v2_src_replay_times_check",
      sql`isfinite(${table.availableAt})
        and isfinite(${table.replayNotAfter})
        and isfinite(${table.expiresAt})
        and isfinite(${table.requestedAt})
        and isfinite(${table.updatedAt})
        and ${table.requestedAt} <= ${table.availableAt}
        and ${table.requestedAt} <= ${table.updatedAt}
        and (
          (${table.deadLetterId} is null
            and ${table.updatedAt} < ${table.expiresAt})
          or (${table.deadLetterId} is not null
            and ${table.replayNotAfter} <= ${table.expiresAt})
        )
        and (${table.leaseExpiresAt} is null or (
          ${table.leaseClaimedAt} is not null
          and ${table.leaseClaimedAt} <= ${table.updatedAt}
          and ${table.leaseExpiresAt} > ${table.updatedAt}
          and ${table.leaseExpiresAt} <= ${table.replayNotAfter}
        ))
        and (${table.completedAt} is null
          or ${table.completedAt} = ${table.updatedAt})
        and (
          (${table.state} in ('pending', 'leased', 'applied')
            and ${table.availableAt} < ${table.replayNotAfter}
            and ${table.updatedAt} < ${table.replayNotAfter})
          or ${table.state} = 'denied'
          or (${table.state} = 'expired'
            and ${table.updatedAt} >= ${table.replayNotAfter})
        )`
    ),
    index("inbox_v2_src_replay_due_idx")
      .on(table.tenantId, table.availableAt, table.id)
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_src_replay_reclaim_idx")
      .on(table.tenantId, table.leaseExpiresAt, table.id)
      .where(sql`${table.state} = 'leased'`),
    index("inbox_v2_src_replay_raw_idx").on(
      table.tenantId,
      table.rawEventId,
      table.requestedAt,
      table.id
    ),
    index("inbox_v2_src_replay_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
      table.id
    )
  ]
);

/** Per-account shared concurrency/backoff head for all worker replicas. */
export const inboxV2SourceAccountPressureHeads = pgTable(
  "inbox_v2_source_account_pressure_heads",
  {
    tenantId: text("tenant_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    state: inboxV2SourceAccountPressureState("state").notNull(),
    maxInFlight: integer("max_in_flight").notNull(),
    inFlight: integer("in_flight").notNull(),
    maxQueued: integer("max_queued").notNull(),
    queued: integer("queued").notNull(),
    consecutiveFailureCount: bigint("consecutive_failure_count", {
      mode: "bigint"
    }).notNull(),
    backoffUntil: timestamp("backoff_until", {
      withTimezone: true,
      precision: 3
    }),
    rateLimitResetAt: timestamp("rate_limit_reset_at", {
      withTimezone: true,
      precision: 3
    }),
    lastDiagnosticCodeId: text("last_diagnostic_code_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_pressure_head_pk",
      columns: [
        table.tenantId,
        table.sourceConnectionId,
        table.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_pressure_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_src_pressure_account_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    check(
      "inbox_v2_src_pressure_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_src_pressure_values_check",
      sql`${table.maxInFlight} between 1 and 10000
        and ${table.inFlight} between 0 and ${table.maxInFlight}
        and ${table.maxQueued} between 1 and 10000000
        and ${table.queued} between 0 and ${table.maxQueued}
        and ${table.consecutiveFailureCount} >= 0
        and ${table.revision} >= 1
        and (${table.lastDiagnosticCodeId} is null
          or ${catalogIdSql(table.lastDiagnosticCodeId)})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} <= ${table.updatedAt}`
    ),
    check(
      "inbox_v2_src_pressure_state_check",
      sql`(
          ${table.state} = 'open'
          and ${table.backoffUntil} is null
          and ${table.rateLimitResetAt} is null
        ) or (
          ${table.state} = 'rate_limited'
          and ${table.backoffUntil} is null
          and ${table.rateLimitResetAt} is not null
          and isfinite(${table.rateLimitResetAt})
          and ${table.rateLimitResetAt} > ${table.updatedAt}
          and ${table.lastDiagnosticCodeId} is not null
        ) or (
          ${table.state} = 'paused'
          and ${table.backoffUntil} is not null
          and isfinite(${table.backoffUntil})
          and ${table.backoffUntil} > ${table.updatedAt}
          and ${table.rateLimitResetAt} is null
          and ${table.lastDiagnosticCodeId} is not null
        )`
    ),
    index("inbox_v2_src_pressure_due_idx").on(
      table.tenantId,
      table.state,
      table.rateLimitResetAt,
      table.backoffUntil,
      table.sourceConnectionId,
      table.sourceAccountScopeKey
    )
  ]
);

/**
 * Current committed ingress cursor. Opaque provider cursor bytes live behind a
 * tenant secret ref; the row advances only with an exact durable raw aggregate.
 */
export const inboxV2SourceIngressCursorCheckpoints = pgTable(
  "inbox_v2_source_ingress_cursor_checkpoints",
  {
    tenantId: text("tenant_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    cursorOwner: inboxV2SourceCursorOwner("cursor_owner").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id"),
    cursorKind: inboxV2SourceCursorKind("cursor_kind").notNull(),
    cursorSlotId: text("cursor_slot_id").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    purposeId: text("purpose_id").notNull(),
    keyGeneration: text("key_generation").notNull(),
    cursorValueSecretRef: text("cursor_value_secret_ref").notNull(),
    cursorHmacSha256: text("cursor_hmac_sha256").notNull(),
    durableTargetKind: inboxV2SourceCursorDurableTargetKind(
      "durable_target_kind"
    ).notNull(),
    lastDurableRawEventId: text("last_durable_raw_event_id"),
    durableWorkId: text("durable_work_id"),
    durableWorkRevision: bigint("durable_work_revision", {
      mode: "bigint"
    }),
    durableWorkState: inboxV2SourceProcessingWorkState("durable_work_state"),
    quarantineId: text("quarantine_id"),
    quarantineFingerprintSha256: text("quarantine_fingerprint_sha256"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    persistedAt: timestamp("persisted_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    acknowledgedAt: timestamp("acknowledged_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_src_cursor_checkpoint_pk",
      columns: [
        table.tenantId,
        table.sourceConnectionId,
        table.sourceAccountScopeKey,
        table.cursorSlotId
      ]
    }),
    unique("inbox_v2_src_cursor_hmac_unique").on(
      table.tenantId,
      table.purposeId,
      table.keyGeneration,
      table.cursorHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_src_cursor_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_account_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_value_secret_fk",
      columns: [table.tenantId, table.cursorValueSecretRef],
      foreignColumns: [tenantSecrets.tenantId, tenantSecrets.secretRef]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_key_fk",
      columns: [table.tenantId, table.purposeId, table.keyGeneration],
      foreignColumns: [
        inboxV2SourceProcessingKeyGenerations.tenantId,
        inboxV2SourceProcessingKeyGenerations.purposeId,
        inboxV2SourceProcessingKeyGenerations.generation
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_raw_fk",
      columns: [table.tenantId, table.lastDurableRawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_raw_connection_fk",
      columns: [
        table.tenantId,
        table.lastDurableRawEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_raw_scope_fk",
      columns: [
        table.tenantId,
        table.lastDurableRawEventId,
        table.sourceAccountScopeKey
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_work_fk",
      columns: [table.tenantId, table.durableWorkId],
      foreignColumns: [
        inboxV2SourceProcessingWorkHeads.tenantId,
        inboxV2SourceProcessingWorkHeads.workId
      ]
    }),
    foreignKey({
      name: "inbox_v2_src_cursor_quarantine_fk",
      columns: [table.tenantId, table.quarantineId],
      foreignColumns: [
        inboxV2SourceRawQuarantines.tenantId,
        inboxV2SourceRawQuarantines.id
      ]
    }),
    check(
      "inbox_v2_src_cursor_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_src_cursor_owner_check",
      sql`(
          ${table.cursorOwner} = 'source_connection'
          and ${table.sourceThreadBindingId} is null
        ) or (
          ${table.cursorOwner} = 'source_account'
          and ${table.sourceAccountId} is not null
          and ${table.sourceThreadBindingId} is null
        ) or (
          ${table.cursorOwner} = 'source_thread_binding'
          and ${table.sourceAccountId} is not null
          and ${table.sourceThreadBindingId} is not null
        )`
    ),
    check(
      "inbox_v2_src_cursor_identity_check",
      sql`${safeTokenSql(table.cursorSlotId)}
        and ${table.routeGeneration} >= 1
        and ${table.purposeId} = 'core:source_ingress_cursor'
        and ${keyGenerationSql(table.keyGeneration)}
        and ${secretRefSql(table.cursorValueSecretRef)}
        and ${hmacSha256Sql(table.cursorHmacSha256)}
        and (
          (${table.durableTargetKind} = 'raw_work'
            and ${internalIdSql(table.durableWorkId)}
            and ${table.durableWorkRevision} >= 1
            and ${table.lastDurableRawEventId} is not null
            and ${table.durableWorkState} is not null
            and ${table.quarantineId} is null
            and ${table.quarantineFingerprintSha256} is null)
          or
          (${table.durableTargetKind} = 'quarantine'
            and ${table.lastDurableRawEventId} is null
            and ${table.durableWorkId} is null
            and ${table.durableWorkRevision} is null
            and ${table.durableWorkState} is null
            and ${internalIdSql(table.quarantineId)}
            and ${sha256Sql(table.quarantineFingerprintSha256)})
        )
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_src_cursor_times_check",
      sql`isfinite(${table.persistedAt})
        and isfinite(${table.acknowledgedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.createdAt} <= ${table.persistedAt}
        and ${table.persistedAt} <= ${table.acknowledgedAt}
        and ${table.acknowledgedAt} <= ${table.updatedAt}`
    ),
    index("inbox_v2_src_cursor_acknowledged_idx").on(
      table.tenantId,
      table.acknowledgedAt,
      table.sourceConnectionId,
      table.sourceAccountScopeKey
    )
  ]
);

/**
 * Transition, retention and cross-aggregate closure for the processing runtime.
 * Keep this block byte-identical in migration 0048.
 */
export const INBOX_V2_SOURCE_PROCESSING_RUNTIME_INTEGRITY_SQL = String.raw`
-- INBOX_V2_SOURCE_PROCESSING_RUNTIME_FINALIZED_V1
alter table public.inbox_v2_source_raw_admissions
  add constraint inbox_v2_source_raw_admissions_processing_key_fk
  foreign key (
    tenant_id, purpose_id, key_generation, hmac_key_secret_ref
  ) references public.inbox_v2_source_processing_key_generations (
    tenant_id, purpose_id, generation, secret_ref
  ) deferrable initially deferred;

create or replace function public.inbox_v2_src_runtime_route_generation(
  p_tenant_id text,
  p_source_connection_id text,
  p_source_account_id text
)
returns bigint
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select head_row.route_generation
    from public.inbox_v2_source_registry_heads head_row
   where head_row.tenant_id = p_tenant_id
     and head_row.source_connection_id = p_source_connection_id
     and head_row.state in ('active', 'degraded')
     and head_row.route_authority_state in ('enabled', 'inbound_only')
     and (
       (p_source_account_id is not null
         and head_row.authority_kind = 'source_account'
         and head_row.source_account_id = p_source_account_id)
       or (head_row.authority_kind = 'source_connection'
         and head_row.source_account_id is null)
     )
   order by case when head_row.authority_kind = 'source_account' then 0 else 1 end,
            head_row.revision desc
   limit 1
$function$;

create or replace function public.inbox_v2_src_runtime_route_is_current(
  p_tenant_id text,
  p_source_connection_id text,
  p_source_account_id text,
  p_route_generation bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    public.inbox_v2_src_runtime_route_generation(
      p_tenant_id,
      p_source_connection_id,
      p_source_account_id
    ) = p_route_generation,
    false
  )
$function$;

create or replace function public.inbox_v2_src_runtime_reject_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception '% cannot be truncated', tg_table_name using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_proc_key_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_secret_purpose text;
begin
  if tg_op <> 'DELETE' then
    select secret_row.purpose into v_secret_purpose
      from public.tenant_secrets secret_row
     where secret_row.tenant_id = new.tenant_id
       and secret_row.secret_ref = new.secret_ref;
    if v_secret_purpose is distinct from
       'inbox_v2.source_processing_hmac' then
      raise exception 'Processing key generation requires an HMAC tenant secret'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.state <> 'active'
       or new.retired_at is not null
       or new.created_at <> new.updated_at then
      raise exception 'Processing key generation must start as active revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.state <> 'retired'
       or clock_timestamp() < old.retired_at
       or exists (
         select 1
           from public.inbox_v2_source_delivery_dedupe_skeletons skeleton_row
          where skeleton_row.tenant_id = old.tenant_id
            and skeleton_row.purpose_id = old.purpose_id
            and skeleton_row.key_generation = old.generation
       )
       or exists (
         select 1
           from public.inbox_v2_source_raw_admissions admission_row
          where admission_row.tenant_id = old.tenant_id
            and admission_row.purpose_id = old.purpose_id
            and admission_row.key_generation = old.generation
            and admission_row.hmac_key_secret_ref = old.secret_ref
       )
       or exists (
         select 1
           from public.inbox_v2_source_raw_quarantines quarantine_row
          where quarantine_row.tenant_id = old.tenant_id
            and quarantine_row.event_identity_key_generation = old.generation
            and quarantine_row.event_identity_hmac_key_secret_ref =
                old.secret_ref
            and quarantine_row.event_identity_guarantee_until >
                clock_timestamp()
       )
       or exists (
         select 1
           from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
          where cursor_row.tenant_id = old.tenant_id
            and cursor_row.purpose_id = old.purpose_id
            and cursor_row.key_generation = old.generation
       ) then
      raise exception 'Processing key generation is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.purpose_id <> old.purpose_id
     or new.generation <> old.generation
     or new.secret_ref <> old.secret_ref
     or new.activated_at <> old.activated_at
     or new.use_until <> old.use_until
     or new.guarantee_not_after <> old.guarantee_not_after
     or new.verify_until <> old.verify_until
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or not (
       (old.state = 'active'
         and new.state = 'verify_only'
         and new.retired_at is null
         and new.updated_at >= old.activated_at)
       or (old.state = 'verify_only'
         and new.state = 'retired'
         and new.retired_at = new.updated_at
         and new.updated_at >= old.verify_until)
     ) then
    raise exception 'Invalid processing key generation transition'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_dedupe_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_key public.inbox_v2_source_processing_key_generations%rowtype;
  v_replay_deadline timestamptz;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.lifecycle_state <> 'expired'
       or clock_timestamp() < old.skeleton_expires_at
       or exists (
         select 1
           from public.inbox_v2_source_raw_admissions admission_row
          where admission_row.tenant_id = old.tenant_id
            and admission_row.state = 'skeleton_handed_off'
            and admission_row.terminal_skeleton_id = old.id
            and admission_row.terminal_outcome_hmac_sha256 =
                old.outcome_hmac_sha256
       ) then
      raise exception 'Dedupe skeleton is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array[
         'replayability_state', 'replay_until',
         'replayability_reason_code_id', 'lifecycle_state', 'expired_at',
         'revision', 'updated_at'
       ]) <> (to_jsonb(old) - array[
         'replayability_state', 'replay_until',
         'replayability_reason_code_id', 'lifecycle_state', 'expired_at',
         'revision', 'updated_at'
       ])
       or new.revision <> old.revision + 1
       or new.updated_at < old.updated_at
       or new.updated_at > clock_timestamp() then
      raise exception 'Dedupe skeleton identity or CAS revision changed'
        using errcode = '23514';
    end if;

    if old.lifecycle_state = 'active'
       and new.lifecycle_state = 'active'
       and old.replayability_state = 'replayable'
       and new.replayability_state = 'expired' then
      v_replay_deadline := case
        when old.phase = 'raw' then least(
          old.replay_until,
          old.raw_payload_expires_at,
          old.allowed_raw_headers_expires_at,
          old.key_verify_until,
          old.guarantee_until
        )
        else least(
          old.replay_until,
          old.normalized_payload_expires_at,
          old.key_verify_until,
          old.guarantee_until
        )
      end;
      if new.replay_until is not null
         or new.replayability_reason_code_id is null
         or new.expired_at is not null
         or new.updated_at < v_replay_deadline
         or clock_timestamp() < v_replay_deadline then
        raise exception 'Invalid dedupe replayability expiry transition'
          using errcode = '23514';
      end if;
      return new;
    end if;

    if old.lifecycle_state = 'active'
       and new.lifecycle_state = 'expired' then
      if old.replayability_state = 'replayable'
         or new.replayability_state <> old.replayability_state
         or new.replay_until is distinct from old.replay_until
         or new.replayability_reason_code_id is distinct from
             old.replayability_reason_code_id
         or new.expired_at <> new.updated_at
         or new.updated_at < new.skeleton_expires_at
         or clock_timestamp() < new.skeleton_expires_at then
        raise exception 'Invalid dedupe skeleton lifecycle expiry transition'
          using errcode = '23514';
      end if;
      return new;
    end if;

    raise exception 'Invalid dedupe skeleton transition'
      using errcode = '23514';
  end if;

  select * into v_key
    from public.inbox_v2_source_processing_key_generations key_row
   where key_row.tenant_id = new.tenant_id
     and key_row.purpose_id = new.purpose_id
     and key_row.generation = new.key_generation;

  if new.revision <> 1
     or new.created_at <> new.updated_at
     or new.replayability_state = 'expired'
     or new.lifecycle_state <> 'active'
     or new.expired_at is not null
     or v_key.generation is null
     or v_key.state not in ('active', 'verify_only')
     or clock_timestamp() >= v_key.verify_until
     or new.terminal_at < v_key.activated_at
     or new.terminal_at >= v_key.use_until
     or new.guarantee_until > v_key.guarantee_not_after
     or new.guarantee_until > v_key.verify_until
     or new.key_verify_until <> v_key.verify_until
     or not public.inbox_v2_src_runtime_route_is_current(
       new.tenant_id,
       new.source_connection_id,
       new.source_account_id,
       new.route_generation
     )
     or (new.normalized_event_id is not null and not exists (
       select 1
         from public.inbox_v2_source_normalized_envelopes normalized_row
        where normalized_row.tenant_id = new.tenant_id
          and normalized_row.normalized_event_id = new.normalized_event_id
          and normalized_row.raw_event_id = new.raw_event_id
          and normalized_row.source_connection_id = new.source_connection_id
          and normalized_row.source_account_id is not distinct from
              new.source_account_id
          and normalized_row.source_account_scope_key =
              new.source_account_scope_key
     )) then
    raise exception 'Dedupe skeleton key, route or target is incoherent'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_expected_work_id text;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or old.state not in (
         'processed', 'ignored', 'duplicate', 'dead_lettered'
       ) then
      raise exception 'Source processing work head is not retention eligible'
        using errcode = '23514';
    end if;
    if exists (
         select 1
           from public.inbox_v2_source_processing_attempts attempt_row
          where attempt_row.tenant_id = old.tenant_id
            and attempt_row.work_id = old.work_id
       ) or exists (
         select 1
           from public.inbox_v2_source_processing_dead_letters dlq_row
          where dlq_row.tenant_id = old.tenant_id
            and dlq_row.work_id = old.work_id
       ) or exists (
         select 1
           from public.inbox_v2_source_replay_requests replay_row
          where replay_row.tenant_id = old.tenant_id
            and (replay_row.target_work_id = old.work_id
              or replay_row.result_work_id = old.work_id)
       ) or exists (
         select 1
           from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
          where cursor_row.tenant_id = old.tenant_id
            and cursor_row.durable_work_id = old.work_id
       ) then
      raise exception 'Source processing work head still has runtime dependents'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_expected_work_id := 'srcwork:' || encode(sha256(convert_to(
      'source-processing-work:v1|' || new.tenant_id || chr(31) ||
      new.raw_event_id || chr(31) || new.normalized_event_scope_key || chr(31) ||
      new.stage::text, 'UTF8')), 'hex');

    if new.revision <> 1
       or new.processing_generation <> 1
       or new.created_at <> new.updated_at
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       )
       or new.work_id <> v_expected_work_id
       or not (
         (new.stage = 'raw_ingest'
           and new.state = 'processed'
           and new.attempt_count = 0
           and new.completed_at = new.updated_at
           and exists (
             select 1
               from public.inbox_v2_source_raw_work_items raw_work
              where raw_work.tenant_id = new.tenant_id
                and raw_work.raw_event_id = new.raw_event_id
           ))
         or (new.stage <> 'raw_ingest'
           and new.state = 'pending'
           and new.attempt_count = 0
           and new.dead_lettered_at is null
           and new.completed_at is null)
       ) then
      raise exception 'Invalid initial source processing work head'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array[
       'state', 'processing_generation', 'available_at', 'attempt_count',
       'lease_owner_id', 'lease_token_hash', 'lease_revision',
       'lease_claimed_at', 'lease_expires_at', 'last_diagnostic_code_id',
       'retryability', 'rate_limit_reset_at', 'dead_lettered_at',
       'completed_at', 'revision', 'updated_at'
     ]) <> (to_jsonb(old) - array[
       'state', 'processing_generation', 'available_at', 'attempt_count',
       'lease_owner_id', 'lease_token_hash', 'lease_revision',
       'lease_claimed_at', 'lease_expires_at', 'last_diagnostic_code_id',
       'retryability', 'rate_limit_reset_at', 'dead_lettered_at',
       'completed_at', 'revision', 'updated_at'
     ])
     or new.revision <> old.revision + 1
     or new.updated_at <= old.updated_at then
    raise exception 'Source processing work identity or CAS revision changed'
      using errcode = '23514';
  end if;

  if old.state in ('pending', 'retry_scheduled') and new.state = 'leased' then
    if old.available_at > new.updated_at
       or new.attempt_count <> old.attempt_count + 1
       or new.attempt_count > new.max_attempts
       or new.processing_generation <> old.processing_generation
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid source processing lease claim'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased'
     and new.state = 'leased'
     and clock_timestamp() >= old.lease_expires_at then
    if new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count
       or new.available_at <> old.available_at
       or new.lease_token_hash = old.lease_token_hash
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or new.updated_at < old.lease_expires_at
       or new.updated_at > clock_timestamp()
       or new.lease_expires_at <= new.updated_at
       or new.last_diagnostic_code_id is distinct from
           old.last_diagnostic_code_id
       or new.retryability is distinct from old.retryability
       or new.rate_limit_reset_at is distinct from old.rate_limit_reset_at
       or exists (
         select 1
           from public.inbox_v2_source_processing_attempts attempt_row
          where attempt_row.tenant_id = old.tenant_id
            and attempt_row.work_id = old.work_id
            and attempt_row.processing_generation =
                old.processing_generation
            and attempt_row.attempt_number = old.attempt_count
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid same-attempt expired lease reclaim'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased' and new.state = 'leased' then
    if new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count
       or new.lease_owner_id <> old.lease_owner_id
       or new.lease_token_hash <> old.lease_token_hash
       or new.lease_claimed_at <> old.lease_claimed_at
       or new.lease_revision <> new.revision
       or new.lease_expires_at <= old.lease_expires_at
       or clock_timestamp() >= old.lease_expires_at then
      raise exception 'Invalid source processing lease renewal'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased'
     and new.state in (
       'retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered'
     ) then
    if clock_timestamp() >= old.lease_expires_at
       or new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count then
      raise exception 'Invalid source processing leased completion'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'dead_lettered' and new.state = 'pending' then
    if new.processing_generation <> old.processing_generation + 1
       or new.attempt_count <> 0
       or new.available_at < new.updated_at
       or new.last_diagnostic_code_id is not null
       or new.retryability is not null
       or new.rate_limit_reset_at is not null
       or new.dead_lettered_at is not null
       or new.completed_at is not null
       or not exists (
         select 1
           from public.inbox_v2_source_replay_requests request_row
           join public.inbox_v2_source_processing_dead_letters dlq_row
             on dlq_row.tenant_id = request_row.tenant_id
            and dlq_row.id = request_row.dead_letter_id
          where request_row.tenant_id = old.tenant_id
            and request_row.target_work_id = old.work_id
            and request_row.raw_event_id = old.raw_event_id
            and request_row.normalized_event_id is not distinct from
                old.normalized_event_id
            and request_row.normalized_event_scope_key =
                old.normalized_event_scope_key
            and request_row.stage = old.stage
            and request_row.source_connection_id = old.source_connection_id
            and request_row.source_account_id is not distinct from
                old.source_account_id
            and request_row.source_account_scope_key =
                old.source_account_scope_key
            and request_row.route_generation = old.route_generation
            and request_row.expected_target_revision = old.revision
            and request_row.state in ('pending', 'leased')
            and request_row.replay_not_after > new.updated_at
            and clock_timestamp() < request_row.replay_not_after
            and dlq_row.work_id = old.work_id
            and dlq_row.raw_event_id = old.raw_event_id
            and dlq_row.stage = old.stage
            and dlq_row.processing_generation = old.processing_generation
            and dlq_row.work_revision = old.revision
       ) then
      raise exception 'Invalid source processing replay reset'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Invalid source processing work transition'
    using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_attempt_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Source processing attempts are immutable'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or clock_timestamp() < old.expires_at then
      raise exception 'Source processing attempt is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.work_id;

  if v_work.work_id is null
     or v_work.raw_event_id <> new.raw_event_id
     or v_work.stage <> new.stage
     or v_work.processing_generation <> new.processing_generation
     or v_work.attempt_count <> new.attempt_number
     or v_work.max_attempts <> new.max_attempts
     or not (
       (v_work.state = 'leased'
         and new.work_revision = v_work.revision + 1
         and new.worker_id = v_work.lease_owner_id
         and new.lease_token_hash = v_work.lease_token_hash
         and new.lease_revision = v_work.lease_revision
         and new.lease_claimed_at = v_work.lease_claimed_at
         and new.lease_expires_at = v_work.lease_expires_at)
       or (v_work.state in (
           'retry_scheduled', 'processed', 'ignored', 'duplicate',
           'dead_lettered'
         ) and new.work_revision = v_work.revision)
     ) then
    raise exception 'Source processing attempt does not close its exact lease'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_dlq_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_attempt public.inbox_v2_source_processing_attempts%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Source processing dead-letter facts are immutable'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or clock_timestamp() < old.expires_at
       or exists (
         select 1
           from public.inbox_v2_source_replay_requests replay_row
          where replay_row.tenant_id = old.tenant_id
            and replay_row.dead_letter_id = old.id
       ) then
      raise exception 'Source processing dead-letter fact is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select * into v_attempt
    from public.inbox_v2_source_processing_attempts attempt_row
   where attempt_row.tenant_id = new.tenant_id
     and attempt_row.attempt_id = new.attempt_id;
  if v_attempt.attempt_id is null
     or v_attempt.work_id <> new.work_id
     or v_attempt.raw_event_id <> new.raw_event_id
     or v_attempt.stage <> new.stage
     or v_attempt.processing_generation <> new.processing_generation
     or v_attempt.attempt_number <> new.attempt_number
     or v_attempt.work_revision <> new.work_revision
     or v_attempt.outcome <> 'dead_lettered'
     or v_attempt.diagnostic_code_id <> new.diagnostic_code_id
     or v_attempt.retryability <> new.retryability
     or v_attempt.diagnostic_correlation_token <>
         new.diagnostic_correlation_token
     or v_attempt.diagnostic_safe_operator_hint_id is distinct from
         new.diagnostic_safe_operator_hint_id
     or (new.reason = 'attempts_exhausted'
       and v_attempt.attempt_number <> v_attempt.max_attempts) then
    raise exception 'Dead-letter fact does not match its exact terminal attempt'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_assert_work_closure()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_id text;
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_attempt public.inbox_v2_source_processing_attempts%rowtype;
  v_dlq_count bigint;
  v_replay_count bigint;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  v_work_id := coalesce(new.work_id, old.work_id);
  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.work_id = v_work_id;
  if v_work.work_id is null then
    return null;
  end if;

  if v_work.stage = 'raw_ingest'
     and v_work.state = 'processed'
     and v_work.attempt_count = 0 then
    return null;
  end if;

  if v_work.processing_generation > 1
     and v_work.state = 'pending'
     and v_work.attempt_count = 0 then
    select count(*) into v_replay_count
      from public.inbox_v2_source_replay_requests replay_row
     where replay_row.tenant_id = v_work.tenant_id
       and replay_row.state = 'applied'
       and replay_row.result_work_id = v_work.work_id
       and replay_row.result_processing_generation =
           v_work.processing_generation
       and replay_row.result_work_revision = v_work.revision;
    if v_replay_count <> 1 then
      raise exception 'Replay work generation requires one exact applied request'
        using errcode = '23514';
    end if;
  end if;

  if v_work.state not in (
       'retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered'
     ) then
    return null;
  end if;

  select * into v_attempt
    from public.inbox_v2_source_processing_attempts attempt_row
   where attempt_row.tenant_id = v_work.tenant_id
     and attempt_row.work_id = v_work.work_id
     and attempt_row.processing_generation = v_work.processing_generation
     and attempt_row.attempt_number = v_work.attempt_count
     and attempt_row.work_revision = v_work.revision;

  if v_attempt.attempt_id is null
     or v_attempt.outcome::text <> v_work.state::text
     or v_attempt.diagnostic_code_id is distinct from
         v_work.last_diagnostic_code_id
     or v_attempt.retryability is distinct from v_work.retryability
     or not (
       (v_work.processing_generation = 1 and v_work.attempt_count = 1
         and v_attempt.origin = 'initial')
       or (v_work.processing_generation > 1 and v_work.attempt_count = 1
         and v_attempt.origin = 'replay')
       or (v_work.attempt_count > 1 and v_attempt.origin = 'retry')
     ) then
    raise exception 'Terminal or retry work head requires its exact attempt fact'
      using errcode = '23514';
  end if;

  select count(*) into v_dlq_count
    from public.inbox_v2_source_processing_dead_letters dlq_row
   where dlq_row.tenant_id = v_work.tenant_id
     and dlq_row.work_id = v_work.work_id
     and dlq_row.processing_generation = v_work.processing_generation
     and dlq_row.work_revision = v_work.revision;
  if (v_work.state = 'dead_lettered' and v_dlq_count <> 1)
     or (v_work.state <> 'dead_lettered' and v_dlq_count <> 0) then
    raise exception 'Work head and dead-letter closure are incoherent'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_src_replay_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_scope_key text;
  v_target_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_dlq public.inbox_v2_source_processing_dead_letters%rowtype;
  v_has_evidence boolean;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or old.state not in ('applied', 'denied', 'expired')
       or clock_timestamp() < old.expires_at
       or exists (
         select 1
           from public.inbox_v2_source_processing_work_heads work_row
          where work_row.tenant_id = old.tenant_id
            and work_row.work_id = old.result_work_id
            and work_row.processing_generation =
                old.result_processing_generation
            and work_row.state in ('pending', 'retry_scheduled', 'leased')
       ) then
      raise exception 'Source replay request is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  v_scope_key := case when new.normalized_event_id is null then '0:' else
    '1:' || octet_length(new.normalized_event_id)::text || ':' ||
    new.normalized_event_id end;
  select * into v_target_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.target_work_id;
  select * into v_dlq
    from public.inbox_v2_source_processing_dead_letters dlq_row
   where dlq_row.tenant_id = new.tenant_id
     and dlq_row.id = new.dead_letter_id;

  v_has_evidence := case
    when new.stage in ('raw_ingest', 'normalization') then exists (
      select 1
        from public.inbox_v2_source_raw_evidence evidence_row
       where evidence_row.tenant_id = new.tenant_id
         and evidence_row.raw_event_id = new.raw_event_id
         and evidence_row.evidence_kind = 'provider_payload'
         and evidence_row.purpose_ids ? 'core:source_replay_and_diagnostics'
    )
    else exists (
      select 1
        from public.inbox_v2_source_normalized_evidence_payloads payload_row
        join public.inbox_v2_source_normalized_evidence evidence_row
          on evidence_row.tenant_id = payload_row.tenant_id
         and evidence_row.normalized_event_id = payload_row.normalized_event_id
         and evidence_row.evidence_key = payload_row.evidence_key
       where payload_row.tenant_id = new.tenant_id
         and payload_row.normalized_event_id = new.normalized_event_id
         and evidence_row.purpose_ids ? 'core:source_replay_and_diagnostics'
    )
  end;

  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.state not in ('pending', 'denied', 'expired')
       or new.requested_at > new.updated_at
       or new.updated_at > clock_timestamp()
       or v_target_work.work_id is null
       or v_target_work.work_id <> new.target_work_id
       or v_target_work.raw_event_id <> new.raw_event_id
       or v_target_work.normalized_event_id is distinct from
           new.normalized_event_id
       or v_target_work.normalized_event_scope_key <> v_scope_key
       or new.normalized_event_scope_key <> v_scope_key
       or v_target_work.stage <> new.stage
       or v_target_work.source_connection_id <> new.source_connection_id
       or v_target_work.source_account_id is distinct from
           new.source_account_id
       or v_target_work.source_account_scope_key <>
           new.source_account_scope_key
       or v_target_work.route_generation <> new.route_generation then
      raise exception 'Replay request target snapshot is incoherent'
        using errcode = '23514';
    end if;

    if new.state = 'pending' and (
      new.dead_letter_id is null
      or v_target_work.state <> 'dead_lettered'
      or v_target_work.revision <> new.expected_target_revision
      or v_dlq.id is null
      or v_dlq.work_id <> v_target_work.work_id
      or v_dlq.raw_event_id <> v_target_work.raw_event_id
      or v_dlq.stage <> v_target_work.stage
      or v_dlq.processing_generation <>
          v_target_work.processing_generation
      or v_dlq.attempt_number <> v_target_work.attempt_count
      or v_dlq.work_revision <> v_target_work.revision
      or v_dlq.recorded_at <> v_target_work.dead_lettered_at
      or new.replay_not_after <> v_dlq.replay_not_after
      or new.expires_at > v_dlq.expires_at
      or new.requested_at <> new.updated_at
      or new.updated_at >= new.replay_not_after
      or clock_timestamp() >= new.replay_not_after
      or not v_has_evidence
      or not public.inbox_v2_src_runtime_route_is_current(
        v_target_work.tenant_id,
        v_target_work.source_connection_id,
        v_target_work.source_account_id,
        new.route_generation
      )
    ) then
      raise exception 'Pending replay request is not currently eligible'
        using errcode = '23514';
    end if;
    if new.state in ('denied', 'expired')
       and new.dead_letter_id is not null
       and (v_dlq.id is null
         or v_dlq.work_id <> v_target_work.work_id
         or v_dlq.raw_event_id <> v_target_work.raw_event_id
         or v_dlq.stage <> v_target_work.stage
         or v_dlq.processing_generation <>
             v_target_work.processing_generation
         or v_dlq.attempt_number <> v_target_work.attempt_count
         or v_dlq.work_revision <> v_target_work.revision
         or v_dlq.recorded_at <> v_target_work.dead_lettered_at
         or new.expires_at > v_dlq.expires_at) then
      raise exception 'Terminal replay DLQ snapshot is incoherent'
        using errcode = '23514';
    end if;
    if new.state = 'expired' and (
      new.completed_at < new.replay_not_after
      or clock_timestamp() < new.replay_not_after
    ) then
      raise exception 'Expired replay decision predates its durable deadline'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array[
       'state', 'available_at', 'lease_owner_id', 'lease_token_hash',
       'lease_revision', 'lease_claimed_at', 'lease_expires_at',
       'result_processing_generation', 'result_replay_episode_id',
       'result_work_id', 'result_work_revision', 'rejection_reason',
       'diagnostic_code_id', 'diagnostic_retryability',
       'diagnostic_correlation_token', 'diagnostic_safe_operator_hint_id',
       'revision', 'updated_at', 'completed_at'
     ]) <> (to_jsonb(old) - array[
       'state', 'available_at', 'lease_owner_id', 'lease_token_hash',
       'lease_revision', 'lease_claimed_at', 'lease_expires_at',
       'result_processing_generation', 'result_replay_episode_id',
       'result_work_id', 'result_work_revision', 'rejection_reason',
       'diagnostic_code_id', 'diagnostic_retryability',
       'diagnostic_correlation_token', 'diagnostic_safe_operator_hint_id',
       'revision', 'updated_at', 'completed_at'
     ])
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or new.updated_at > clock_timestamp()
     or v_target_work.work_id is null
     or v_target_work.raw_event_id <> new.raw_event_id
     or v_target_work.normalized_event_id is distinct from
         new.normalized_event_id
     or v_target_work.normalized_event_scope_key <>
         new.normalized_event_scope_key
     or v_target_work.stage <> new.stage
     or v_target_work.source_connection_id <> new.source_connection_id
     or v_target_work.source_account_id is distinct from new.source_account_id
     or v_target_work.source_account_scope_key <>
         new.source_account_scope_key
     or v_target_work.route_generation <> new.route_generation
     or v_dlq.id is null
     or v_dlq.work_id <> new.target_work_id
     or v_dlq.raw_event_id <> new.raw_event_id
     or v_dlq.stage <> new.stage
     or v_dlq.work_revision <> new.expected_target_revision
     or v_dlq.replay_not_after <> new.replay_not_after
     or new.expires_at > v_dlq.expires_at then
    raise exception 'Replay request identity or CAS revision changed'
      using errcode = '23514';
  end if;

  if old.state = 'pending' and new.state = 'leased' then
    if old.available_at > new.updated_at
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or new.lease_expires_at > new.replay_not_after
       or new.updated_at >= new.replay_not_after
       or clock_timestamp() >= new.replay_not_after
       or not v_has_evidence
       or not (
         (v_target_work.state = 'dead_lettered'
           and v_target_work.revision = new.expected_target_revision
           and v_target_work.processing_generation =
               v_dlq.processing_generation)
         or (v_target_work.state = 'pending'
           and v_target_work.revision = new.expected_target_revision + 1
           and v_target_work.processing_generation =
               v_dlq.processing_generation + 1)
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid replay request lease claim'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state = 'leased' and new.state = 'leased' then
    if new.lease_owner_id <> old.lease_owner_id
       or new.lease_token_hash <> old.lease_token_hash
       or new.lease_claimed_at <> old.lease_claimed_at
       or new.lease_revision <> new.revision
       or new.lease_expires_at <= old.lease_expires_at
       or new.lease_expires_at > new.replay_not_after
       or clock_timestamp() >= old.lease_expires_at
       or clock_timestamp() >= new.replay_not_after
       or not v_has_evidence
       or not (
         (v_target_work.state = 'dead_lettered'
           and v_target_work.revision = new.expected_target_revision
           and v_target_work.processing_generation =
               v_dlq.processing_generation)
         or (v_target_work.state = 'pending'
           and v_target_work.revision = new.expected_target_revision + 1
           and v_target_work.processing_generation =
               v_dlq.processing_generation + 1)
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid replay request lease renewal'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state = 'leased' and new.state = 'applied' then
    if clock_timestamp() >= old.lease_expires_at
       or clock_timestamp() >= new.replay_not_after
       or new.updated_at >= new.replay_not_after
       or not v_has_evidence
       or v_target_work.state <> 'pending'
       or v_target_work.work_id <> new.target_work_id
       or new.result_work_id <> new.target_work_id
       or v_target_work.revision <> new.expected_target_revision + 1
       or new.result_work_revision <> new.expected_target_revision + 1
       or new.result_work_revision <> v_target_work.revision
       or v_target_work.processing_generation <>
           v_dlq.processing_generation + 1
       or new.result_processing_generation <>
           v_dlq.processing_generation + 1
       or new.result_processing_generation <>
           v_target_work.processing_generation
       or v_target_work.attempt_count <> 0
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Applied replay does not expose the exact reset target'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state in ('pending', 'leased') and new.state = 'denied' then
    return new;
  end if;

  if old.state in ('pending', 'leased') and new.state = 'expired' then
    if new.completed_at < new.replay_not_after
       or clock_timestamp() < new.replay_not_after then
      raise exception 'Replay request cannot expire before its DB deadline'
        using errcode = '23514';
    end if;
    return new;
  end if;
  raise exception 'Invalid replay request transition' using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_pressure_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Source account pressure heads cannot be deleted'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception 'Pressure head must start at revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.tenant_id <> old.tenant_id
     or new.source_connection_id <> old.source_connection_id
     or new.source_account_id is distinct from old.source_account_id
     or new.source_account_scope_key <> old.source_account_scope_key
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at <= old.updated_at then
    raise exception 'Pressure head identity or CAS revision changed'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_assert_pressure()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_connection_id text;
  v_scope_key text;
  v_pressure public.inbox_v2_source_account_pressure_heads%rowtype;
  v_in_flight bigint;
  v_queued bigint;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if tg_table_name = 'inbox_v2_source_processing_work_heads' then
    v_connection_id := coalesce(new.source_connection_id, old.source_connection_id);
    v_scope_key := coalesce(
      new.source_account_scope_key, old.source_account_scope_key
    );
  else
    v_connection_id := coalesce(new.source_connection_id, old.source_connection_id);
    v_scope_key := coalesce(
      new.source_account_scope_key, old.source_account_scope_key
    );
  end if;
  select * into v_pressure
    from public.inbox_v2_source_account_pressure_heads pressure_row
   where pressure_row.tenant_id = v_tenant_id
     and pressure_row.source_connection_id = v_connection_id
     and pressure_row.source_account_scope_key = v_scope_key;
  select count(*) filter (where work_row.state = 'leased'),
         count(*) filter (where work_row.state in ('pending', 'retry_scheduled'))
    into v_in_flight, v_queued
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.source_connection_id = v_connection_id
     and work_row.source_account_scope_key = v_scope_key
     and work_row.stage <> 'raw_ingest';
  if v_pressure.tenant_id is null then
    if v_in_flight <> 0 or v_queued <> 0 then
      raise exception 'Runtime work requires a pressure head'
        using errcode = '23514';
    end if;
    return null;
  end if;
  if v_pressure.in_flight <> v_in_flight
     or v_pressure.queued <> v_queued then
    raise exception 'Pressure head counters do not match durable work heads'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_src_secret_purpose_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.purpose = old.purpose then
    return new;
  end if;
  if exists (
    select 1
      from public.inbox_v2_source_processing_key_generations key_row
     where key_row.tenant_id = old.tenant_id
       and key_row.secret_ref = old.secret_ref
  ) and new.purpose <> 'inbox_v2.source_processing_hmac' then
    raise exception 'Referenced source-processing HMAC secret purpose cannot drift'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
     where cursor_row.tenant_id = old.tenant_id
       and cursor_row.cursor_value_secret_ref = old.secret_ref
  ) and new.purpose <> 'inbox_v2.source_cursor_value' then
    raise exception 'Referenced source cursor value secret purpose cannot drift'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_cursor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_key public.inbox_v2_source_processing_key_generations%rowtype;
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_quarantine public.inbox_v2_source_raw_quarantines%rowtype;
  v_cursor_secret_purpose text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Ingress cursor checkpoints cannot be deleted'
      using errcode = '23514';
  end if;
  select * into v_key
    from public.inbox_v2_source_processing_key_generations key_row
   where key_row.tenant_id = new.tenant_id
     and key_row.purpose_id = new.purpose_id
     and key_row.generation = new.key_generation;
  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.durable_work_id;
  select * into v_quarantine
    from public.inbox_v2_source_raw_quarantines quarantine_row
   where quarantine_row.tenant_id = new.tenant_id
     and quarantine_row.id = new.quarantine_id;
  select secret_row.purpose into v_cursor_secret_purpose
    from public.tenant_secrets secret_row
   where secret_row.tenant_id = new.tenant_id
     and secret_row.secret_ref = new.cursor_value_secret_ref;
  if v_key.generation is null
     or v_key.state <> 'active'
     or v_key.secret_ref = new.cursor_value_secret_ref
     or v_cursor_secret_purpose is distinct from
         'inbox_v2.source_cursor_value'
     or new.acknowledged_at < v_key.activated_at
     or new.acknowledged_at >= v_key.use_until
     or (new.durable_target_kind = 'raw_work' and (
       v_work.work_id is null
       or v_work.stage <> 'raw_ingest'
       or v_work.raw_event_id <> new.last_durable_raw_event_id
       or v_work.source_connection_id <> new.source_connection_id
       or v_work.source_account_id is distinct from new.source_account_id
       or v_work.source_account_scope_key <> new.source_account_scope_key
       or v_work.revision <> new.durable_work_revision
       or v_work.state <> new.durable_work_state
       or v_work.updated_at <> new.persisted_at
     ))
     or (new.durable_target_kind = 'quarantine' and (
       v_quarantine.id is null
       or v_quarantine.source_connection_id <> new.source_connection_id
       or v_quarantine.source_account_id is distinct from new.source_account_id
       or v_quarantine.source_account_scope_key <>
          new.source_account_scope_key
       or v_quarantine.quarantine_fingerprint_sha256 <>
          new.quarantine_fingerprint_sha256
       or v_quarantine.recorded_at <> new.persisted_at
     ))
     or not public.inbox_v2_src_runtime_route_is_current(
       new.tenant_id,
       new.source_connection_id,
       new.source_account_id,
       new.route_generation
     )
     or (new.cursor_owner = 'source_thread_binding' and not exists (
       select 1
         from public.inbox_v2_source_thread_bindings binding_row
        where binding_row.tenant_id = new.tenant_id
          and binding_row.id = new.source_thread_binding_id
          and binding_row.source_connection_id = new.source_connection_id
          and binding_row.source_account_id = new.source_account_id
     )) then
    raise exception 'Ingress cursor key, owner or durable target is incoherent'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'Ingress cursor must start at revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array[
       'route_generation', 'key_generation', 'cursor_value_secret_ref',
       'cursor_hmac_sha256', 'durable_target_kind',
       'last_durable_raw_event_id', 'durable_work_id',
       'durable_work_revision', 'durable_work_state', 'quarantine_id',
       'quarantine_fingerprint_sha256', 'revision',
       'persisted_at', 'acknowledged_at', 'updated_at'
     ]) <> (to_jsonb(old) - array[
       'route_generation', 'key_generation', 'cursor_value_secret_ref',
       'cursor_hmac_sha256', 'durable_target_kind',
       'last_durable_raw_event_id', 'durable_work_id',
       'durable_work_revision', 'durable_work_state', 'quarantine_id',
       'quarantine_fingerprint_sha256', 'revision',
       'persisted_at', 'acknowledged_at', 'updated_at'
     ])
     or new.revision <> old.revision + 1
     or new.persisted_at < old.persisted_at
     or new.acknowledged_at <= old.acknowledged_at
     or new.updated_at <= old.updated_at then
    raise exception 'Ingress cursor owner or monotonic checkpoint changed'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_raw_runtime_bridge()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_envelope public.inbox_v2_source_raw_envelopes%rowtype;
  v_route_generation bigint;
  v_raw_work_id text;
begin
  select * into strict v_envelope
    from public.inbox_v2_source_raw_envelopes envelope_row
   where envelope_row.tenant_id = new.tenant_id
     and envelope_row.raw_event_id = new.raw_event_id;
  v_route_generation := public.inbox_v2_src_runtime_route_generation(
    v_envelope.tenant_id,
    v_envelope.source_connection_id,
    v_envelope.source_account_id
  );
  if v_route_generation is null then
    return new;
  end if;
  v_raw_work_id := 'srcwork:' || encode(sha256(convert_to(
    'source-processing-work:v1|' || v_envelope.tenant_id || chr(31) ||
    v_envelope.raw_event_id || chr(31) || '0:' || chr(31) || 'raw_ingest',
    'UTF8')), 'hex');
  insert into public.inbox_v2_source_processing_work_heads (
    tenant_id, work_id, raw_event_id, normalized_event_id,
    normalized_event_scope_key, stage, source_connection_id,
    source_account_id, source_account_scope_key, route_generation, state,
    processing_generation, available_at, max_attempts, attempt_count,
    lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
    lease_expires_at, last_diagnostic_code_id, retryability,
    rate_limit_reset_at, dead_lettered_at, completed_at, revision,
    created_at, updated_at
  ) values (
    v_envelope.tenant_id, v_raw_work_id, v_envelope.raw_event_id, null,
    '0:', 'raw_ingest', v_envelope.source_connection_id,
    v_envelope.source_account_id, v_envelope.source_account_scope_key,
    v_route_generation, 'processed', 1, new.available_at, 100, 0,
    null, null, null, null, null, null, null, null, null, new.updated_at,
    1, new.created_at, new.updated_at
  );
  return new;
end
$function$;

create or replace function
  public.inbox_v2_src_runtime_raw_admission_terminal_skeleton_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state <> 'skeleton_handed_off' then
    return new;
  end if;

  -- A later DELETE in the same retention transaction removes the aggregate
  -- obligation; otherwise the exact handed-off admission must still exist.
  if not exists (
    select 1
      from public.inbox_v2_source_raw_admissions current_admission
     where current_admission.tenant_id = new.tenant_id
       and current_admission.purpose_id = new.purpose_id
       and current_admission.key_generation = new.key_generation
       and current_admission.identity_hmac_sha256 =
           new.identity_hmac_sha256
       and current_admission.state = 'skeleton_handed_off'
       and current_admission.revision = new.revision
  ) then
    return new;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_source_delivery_dedupe_skeletons skeleton_row
     where skeleton_row.tenant_id = new.tenant_id
       and skeleton_row.id = new.terminal_skeleton_id
       and skeleton_row.source_connection_id = new.source_connection_id
       and skeleton_row.source_account_id is not distinct from
           new.source_account_id
       and skeleton_row.source_account_scope_key =
           new.source_account_scope_key
       and skeleton_row.phase = 'raw'
       and skeleton_row.raw_event_id = new.raw_event_id
       and skeleton_row.normalized_event_id is null
       and skeleton_row.purpose_id = new.purpose_id
       and skeleton_row.key_generation = new.key_generation
       and skeleton_row.identity_hmac_sha256 = new.identity_hmac_sha256
       and skeleton_row.outcome_hmac_sha256 =
           new.terminal_outcome_hmac_sha256
       and skeleton_row.terminal_at = new.skeleton_handed_off_at
       and skeleton_row.guarantee_until = new.guarantee_until
  ) then
    raise exception 'Raw admission handoff requires its exact terminal skeleton'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function
  public.inbox_v2_src_runtime_terminal_skeleton_admission_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_raw_admissions admission_row
     where admission_row.tenant_id = old.tenant_id
       and admission_row.state = 'skeleton_handed_off'
       and admission_row.terminal_skeleton_id = old.id
       and admission_row.purpose_id = old.purpose_id
       and admission_row.key_generation = old.key_generation
       and admission_row.identity_hmac_sha256 = old.identity_hmac_sha256
       and admission_row.terminal_outcome_hmac_sha256 =
           old.outcome_hmac_sha256
  ) then
    raise exception 'Terminal skeleton remains referenced by a raw admission'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

create trigger inbox_v2_src_proc_key_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_key_generations
for each row execute function public.inbox_v2_src_proc_key_guard();

create trigger inbox_v2_src_secret_purpose_guard_trigger
before update of purpose
on public.tenant_secrets
for each row execute function public.inbox_v2_src_secret_purpose_guard();

create trigger inbox_v2_src_dedupe_guard_trigger
before insert or update or delete
on public.inbox_v2_source_delivery_dedupe_skeletons
for each row execute function public.inbox_v2_src_dedupe_guard();

create constraint trigger
  inbox_v2_src_runtime_raw_admission_terminal_skeleton_constraint
after insert or update on public.inbox_v2_source_raw_admissions
deferrable initially deferred
for each row execute function
  public.inbox_v2_src_runtime_raw_admission_terminal_skeleton_coherence();

create constraint trigger
  inbox_v2_src_runtime_terminal_skeleton_admission_constraint
after delete on public.inbox_v2_source_delivery_dedupe_skeletons
deferrable initially deferred
for each row execute function
  public.inbox_v2_src_runtime_terminal_skeleton_admission_coherence();

create trigger inbox_v2_src_work_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_work_heads
for each row execute function public.inbox_v2_src_work_guard();

create trigger inbox_v2_src_attempt_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_attempts
for each row execute function public.inbox_v2_src_attempt_guard();

create trigger inbox_v2_src_dlq_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_dead_letters
for each row execute function public.inbox_v2_src_dlq_guard();

create trigger inbox_v2_src_replay_guard_trigger
before insert or update or delete
on public.inbox_v2_source_replay_requests
for each row execute function public.inbox_v2_src_replay_guard();

create trigger inbox_v2_src_pressure_guard_trigger
before insert or update or delete
on public.inbox_v2_source_account_pressure_heads
for each row execute function public.inbox_v2_src_pressure_guard();

create trigger inbox_v2_src_cursor_guard_trigger
before insert or update or delete
on public.inbox_v2_source_ingress_cursor_checkpoints
for each row execute function public.inbox_v2_src_cursor_guard();

create trigger inbox_v2_src_raw_runtime_bridge_trigger
after insert on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_src_raw_runtime_bridge();

create constraint trigger inbox_v2_src_work_closure_from_work
after insert or update on public.inbox_v2_source_processing_work_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_work_closure_from_attempt
after insert on public.inbox_v2_source_processing_attempts
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_work_closure_from_dlq
after insert on public.inbox_v2_source_processing_dead_letters
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_pressure_closure_from_work
after insert or update on public.inbox_v2_source_processing_work_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_pressure();

create constraint trigger inbox_v2_src_pressure_closure_from_head
after insert or update on public.inbox_v2_source_account_pressure_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_pressure();

create trigger inbox_v2_src_proc_key_truncate_guard
before truncate on public.inbox_v2_source_processing_key_generations
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_dedupe_truncate_guard
before truncate on public.inbox_v2_source_delivery_dedupe_skeletons
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_work_truncate_guard
before truncate on public.inbox_v2_source_processing_work_heads
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_attempt_truncate_guard
before truncate on public.inbox_v2_source_processing_attempts
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_dlq_truncate_guard
before truncate on public.inbox_v2_source_processing_dead_letters
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_replay_truncate_guard
before truncate on public.inbox_v2_source_replay_requests
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_pressure_truncate_guard
before truncate on public.inbox_v2_source_account_pressure_heads
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_cursor_truncate_guard
before truncate on public.inbox_v2_source_ingress_cursor_checkpoints
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();

revoke all privileges on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
from public;

grant select, insert, update on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
to hulee_inbox_v2_runtime;
grant select, insert on table
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters
to hulee_inbox_v2_runtime;
grant select, delete on table
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests
to hulee_inbox_v2_retention_owner;
grant select on table
  public.inbox_v2_source_ingress_cursor_checkpoints
to hulee_inbox_v2_retention_owner;
grant select, update, delete on table
  public.inbox_v2_source_processing_key_generations
to hulee_inbox_v2_retention_owner;
revoke delete, truncate on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
from hulee_inbox_v2_runtime;
revoke update, truncate on table
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters
from hulee_inbox_v2_retention_owner;
`;

function accountScopeSql(
  accountId: SQLWrapper,
  accountScopeKey: SQLWrapper
): SQL {
  return sql`${accountScopeKey} = case
    when ${accountId} is null then '0:'
    else '1:' || octet_length(${accountId})::text || ':' || ${accountId}
  end`;
}

function nullableScopeSql(value: SQLWrapper, scopeKey: SQLWrapper): SQL {
  return sql`${scopeKey} = case
    when ${value} is null then '0:'
    else '1:' || octet_length(${value})::text || ':' || ${value}
  end`;
}

function hmacSha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^hmac-sha256:[0-9a-f]{64}$'`;
}

function sha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^sha256:[0-9a-f]{64}$'`;
}

function keyGenerationSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 1 and 128
    and ${value} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
}

function internalIdSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 8 and 256
    and ${value} ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'`;
}

function secretRefSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 8 and 512
    and ${value} ~ '^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$'`;
}

function safeTokenSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 1 and 128
    and ${value} ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'`;
}

function catalogIdSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) <= 256 and (
    (
      ${value} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 160
    ) or (
      ${value} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${value}, ':', 2)) <= 80
      and char_length(split_part(${value}, ':', 3)) <= 160
      and split_part(${value}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}
