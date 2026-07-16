import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import {
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";
import { inboxV2SourceRawEnvelopes } from "./source-raw-ingress";

export const inboxV2SourceNormalizationOutcome = pgEnum(
  "inbox_v2_source_normalization_outcome",
  ["normalized", "ignored", "quarantined"]
);

type NormalizedSafeEnvelope = Readonly<Record<string, unknown>>;
type NormalizedEvidence = unknown;

/**
 * Immutable, provider-neutral normalized event envelope. The authentic safe
 * envelope retains exact typed source/thread/identity observations needed by
 * later resolvers, while message/contact content stays in independently
 * purgeable evidence rows. The legacy normalized row remains an empty
 * compatibility/FK anchor.
 */
export const inboxV2SourceNormalizedEnvelopes = pgTable(
  "inbox_v2_source_normalized_envelopes",
  {
    tenantId: text("tenant_id").notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    normalizedOrdinal: integer("normalized_ordinal").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    eventType: text("event_type").notNull(),
    direction: text("direction").notNull(),
    visibility: text("visibility").notNull(),
    providerOccurredAt: timestamp("provider_occurred_at", {
      withTimezone: true,
      precision: 3
    }),
    payloadSchemaId: text("payload_schema_id").notNull(),
    payloadSchemaVersion: text("payload_schema_version").notNull(),
    capabilitySchemaId: text("capability_schema_id").notNull(),
    capabilitySchemaVersion: text("capability_schema_version").notNull(),
    capabilityHmacSha256: text("capability_hmac_sha256").notNull(),
    identityObservationCount: integer("identity_observation_count").notNull(),
    rosterCompleteness: text("roster_completeness"),
    rosterAuthority: text("roster_authority"),
    rosterOmissionPolicy: text("roster_omission_policy"),
    normalizerId: text("normalizer_id").notNull(),
    normalizerVersion: text("normalizer_version").notNull(),
    normalizerDeclarationRevision: bigint("normalizer_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterDeclarationRevision: bigint("adapter_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    safeEnvelopeSchemaId: text("safe_envelope_schema_id").notNull(),
    safeEnvelopeSchemaVersion: text("safe_envelope_schema_version").notNull(),
    digestKeyGeneration: text("digest_key_generation").notNull(),
    safeEnvelopeHmacSha256: text("safe_envelope_hmac_sha256").notNull(),
    safeEnvelope: jsonb("safe_envelope")
      .$type<NormalizedSafeEnvelope>()
      .notNull(),
    normalizedEvidenceCount: integer("normalized_evidence_count").notNull(),
    dataClassId: text("data_class_id").notNull(),
    sensitivityClass: text("sensitivity_class").notNull(),
    processingPurposeId: text("processing_purpose_id").notNull(),
    canonicalAnchorId: text("canonical_anchor_id").notNull(),
    expiryAction: text("expiry_action").notNull(),
    normalizedAt: timestamp("normalized_at", {
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
      name: "inbox_v2_source_normalized_envelopes_pk",
      columns: [table.tenantId, table.normalizedEventId]
    }),
    unique("inbox_v2_source_normalized_envelopes_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    unique("inbox_v2_source_normalized_envelopes_raw_ordinal_unique").on(
      table.tenantId,
      table.rawEventId,
      table.normalizedOrdinal
    ),
    unique("inbox_v2_source_normalized_envelopes_digest_unique").on(
      table.tenantId,
      table.normalizedEventId,
      table.safeEnvelopeHmacSha256
    ),
    unique("inbox_v2_source_normalized_envelopes_exact_scope_unique").on(
      table.tenantId,
      table.normalizedEventId,
      table.rawEventId,
      table.sourceConnectionId,
      table.sourceAccountScopeKey,
      table.eventType,
      table.safeEnvelopeHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_anchor_fk",
      columns: [table.tenantId, table.normalizedEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_raw_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_raw_account_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_envelopes_account_edge_fk",
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
      "inbox_v2_source_normalized_envelopes_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_source_normalized_envelopes_identity_check",
      sql`${table.normalizedOrdinal} >= 0
        and ${table.idempotencyKey} ~ '^source:v2:normalized:[0-9a-f]{64}$'
        and ${safeTokenSql(table.sourceType)}
        and ${safeTokenSql(table.sourceName)}
        and ${safeTokenSql(table.eventType)}
        and ${table.direction} in ('inbound', 'outbound', 'system')
        and ${table.visibility} in ('private', 'public', 'internal')`
    ),
    check(
      "inbox_v2_source_normalized_envelopes_contract_check",
      sql`${catalogIdSql(table.payloadSchemaId)}
        and ${versionTokenSql(table.payloadSchemaVersion)}
        and ${catalogIdSql(table.capabilitySchemaId)}
        and ${versionTokenSql(table.capabilitySchemaVersion)}
        and ${hmacSha256Sql(table.capabilityHmacSha256)}
        and ${catalogIdSql(table.normalizerId)}
        and ${versionTokenSql(table.normalizerVersion)}
        and ${table.normalizerDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.safeEnvelopeSchemaId)}
        and ${versionTokenSql(table.safeEnvelopeSchemaVersion)}
        and ${keyGenerationSql(table.digestKeyGeneration)}
        and ${hmacSha256Sql(table.safeEnvelopeHmacSha256)}
        and jsonb_typeof(${table.safeEnvelope}) = 'object'
        and ${table.normalizedEvidenceCount} >= 0`
    ),
    check(
      "inbox_v2_source_normalized_envelopes_observation_check",
      sql`${table.identityObservationCount} >= 0
        and (
          (${table.rosterCompleteness} is null
            and ${table.rosterAuthority} is null
            and ${table.rosterOmissionPolicy} is null)
          or (
            ${table.rosterCompleteness} in ('unknown', 'partial', 'complete')
            and ${table.rosterAuthority} in ('advisory', 'authoritative')
            and ${table.rosterOmissionPolicy} in ('retain_missing', 'close_missing')
            and (
              ${table.rosterOmissionPolicy} = 'retain_missing'
              or (
                ${table.rosterCompleteness} = 'complete'
                and ${table.rosterAuthority} = 'authoritative'
              )
            )
          )
        )`
    ),
    check(
      "inbox_v2_source_normalized_envelopes_lifecycle_check",
      sql`${table.dataClassId} = 'core:normalized_event_envelope'
        and ${table.sensitivityClass} = 'personal_operational'
        and ${table.processingPurposeId} = 'core:source_replay_and_diagnostics'
        and ${table.canonicalAnchorId} = 'core:materialization_or_final_failure'
        and ${table.expiryAction} = 'compact_to_safe_skeleton'`
    ),
    check(
      "inbox_v2_source_normalized_envelopes_times_check",
      sql`(${table.providerOccurredAt} is null or isfinite(${table.providerOccurredAt}))
        and isfinite(${table.normalizedAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.normalizedAt}`
    ),
    index("inbox_v2_source_normalized_envelopes_raw_idx").on(
      table.tenantId,
      table.rawEventId,
      table.normalizedOrdinal
    ),
    index("inbox_v2_source_normalized_envelopes_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.normalizedAt,
      table.normalizedEventId
    ),
    index("inbox_v2_source_normalized_envelopes_account_idx").on(
      table.tenantId,
      table.sourceAccountScopeKey,
      table.normalizedAt,
      table.normalizedEventId
    )
  ]
);

/** Durable classified evidence reference retained after payload erasure. */
export const inboxV2SourceNormalizedEvidence = pgTable(
  "inbox_v2_source_normalized_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    evidenceKey: text("evidence_key").notNull(),
    slotId: text("slot_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    sensitivityClass: text("sensitivity_class").notNull(),
    purposeIds: jsonb("purpose_ids").$type<readonly string[]>().notNull(),
    evidenceSchemaId: text("evidence_schema_id").notNull(),
    evidenceSchemaVersion: text("evidence_schema_version").notNull(),
    digestKeyGeneration: text("digest_key_generation").notNull(),
    contentHmacSha256: text("content_hmac_sha256").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_normalized_evidence_pk",
      columns: [table.tenantId, table.normalizedEventId, table.evidenceKey]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_evidence_envelope_fk",
      columns: [table.tenantId, table.normalizedEventId],
      foreignColumns: [
        inboxV2SourceNormalizedEnvelopes.tenantId,
        inboxV2SourceNormalizedEnvelopes.normalizedEventId
      ]
    }),
    check(
      "inbox_v2_source_normalized_evidence_classification_check",
      sql`${catalogIdSql(table.evidenceKey)}
        and ${catalogIdSql(table.slotId)}
        and ${table.dataClassId} = 'core:normalized_event_payload'
        and ${table.sensitivityClass} = 'restricted_content'
        and ${table.purposeIds} in (
          '["core:source_replay_and_diagnostics"]'::jsonb,
          '["core:security_and_fraud_prevention"]'::jsonb,
          '["core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb
        )`
    ),
    check(
      "inbox_v2_source_normalized_evidence_content_check",
      sql`${catalogIdSql(table.evidenceSchemaId)}
        and ${versionTokenSql(table.evidenceSchemaVersion)}
        and ${keyGenerationSql(table.digestKeyGeneration)}
        and ${hmacSha256Sql(table.contentHmacSha256)}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_source_normalized_evidence_recorded_idx").on(
      table.tenantId,
      table.createdAt,
      table.normalizedEventId
    )
  ]
);

/** Restricted normalized content, independently hard-deletable by policy. */
export const inboxV2SourceNormalizedEvidencePayloads = pgTable(
  "inbox_v2_source_normalized_evidence_payloads",
  {
    tenantId: text("tenant_id").notNull(),
    normalizedEventId: text("normalized_event_id").notNull(),
    evidenceKey: text("evidence_key").notNull(),
    content: jsonb("content").$type<NormalizedEvidence>().notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_normalized_evidence_payloads_pk",
      columns: [table.tenantId, table.normalizedEventId, table.evidenceKey]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_evidence_payloads_reference_fk",
      columns: [table.tenantId, table.normalizedEventId, table.evidenceKey],
      foreignColumns: [
        inboxV2SourceNormalizedEvidence.tenantId,
        inboxV2SourceNormalizedEvidence.normalizedEventId,
        inboxV2SourceNormalizedEvidence.evidenceKey
      ]
    }),
    check(
      "inbox_v2_source_normalized_evidence_payloads_content_check",
      sql`jsonb_typeof(${table.content}) is not null
        and isfinite(${table.recordedAt})`
    ),
    index("inbox_v2_source_normalized_evidence_payloads_recorded_idx").on(
      table.tenantId,
      table.recordedAt,
      table.normalizedEventId,
      table.evidenceKey
    )
  ]
);

/** Immutable, content-free normalizer rejection or idempotency collision. */
export const inboxV2SourceNormalizedQuarantines = pgTable(
  "inbox_v2_source_normalized_quarantines",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    reasonCode: text("reason_code").notNull(),
    digestKeyGeneration: text("digest_key_generation").notNull(),
    quarantineFingerprintHmacSha256: text(
      "quarantine_fingerprint_hmac_sha256"
    ).notNull(),
    candidateCompletionHmacSha256: text(
      "candidate_completion_hmac_sha256"
    ).notNull(),
    rawEventId: text("raw_event_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    normalizedOrdinal: integer("normalized_ordinal"),
    eventType: text("event_type"),
    idempotencyKeyHmacSha256: text("idempotency_key_hmac_sha256"),
    safeEnvelopeHmacSha256: text("safe_envelope_hmac_sha256"),
    existingNormalizedEventId: text("existing_normalized_event_id"),
    existingRawEventId: text("existing_raw_event_id"),
    existingSourceConnectionId: text("existing_source_connection_id"),
    existingSourceAccountScopeKey: text("existing_source_account_scope_key"),
    existingEventType: text("existing_event_type"),
    existingSafeEnvelopeHmacSha256: text("existing_safe_envelope_hmac_sha256"),
    normalizerId: text("normalizer_id").notNull(),
    normalizerVersion: text("normalizer_version").notNull(),
    normalizerDeclarationRevision: bigint("normalizer_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_normalized_quarantines_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_source_normalized_quarantines_fingerprint_unique").on(
      table.tenantId,
      table.quarantineFingerprintHmacSha256
    ),
    unique("inbox_v2_source_normalized_quarantines_result_relation_unique").on(
      table.tenantId,
      table.id,
      table.rawEventId,
      table.reasonCode,
      table.digestKeyGeneration,
      table.candidateCompletionHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_source_normalized_quarantines_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_quarantines_raw_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_quarantines_raw_account_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalized_quarantines_existing_fk",
      columns: [
        table.tenantId,
        table.existingNormalizedEventId,
        table.existingRawEventId,
        table.existingSourceConnectionId,
        table.existingSourceAccountScopeKey,
        table.existingEventType,
        table.existingSafeEnvelopeHmacSha256
      ],
      foreignColumns: [
        inboxV2SourceNormalizedEnvelopes.tenantId,
        inboxV2SourceNormalizedEnvelopes.normalizedEventId,
        inboxV2SourceNormalizedEnvelopes.rawEventId,
        inboxV2SourceNormalizedEnvelopes.sourceConnectionId,
        inboxV2SourceNormalizedEnvelopes.sourceAccountScopeKey,
        inboxV2SourceNormalizedEnvelopes.eventType,
        inboxV2SourceNormalizedEnvelopes.safeEnvelopeHmacSha256
      ]
    }),
    check(
      "inbox_v2_source_normalized_quarantines_values_check",
      sql`${safeTokenSql(table.reasonCode)}
        and ${keyGenerationSql(table.digestKeyGeneration)}
        and ${hmacSha256Sql(table.quarantineFingerprintHmacSha256)}
        and ${hmacSha256Sql(table.candidateCompletionHmacSha256)}
        and ${catalogIdSql(table.normalizerId)}
        and ${versionTokenSql(table.normalizerVersion)}
        and ${table.normalizerDeclarationRevision} >= 1
        and isfinite(${table.recordedAt})
        and (
          (${table.reasonCode} <> 'source.idempotency_collision'
            and ${table.normalizedOrdinal} is null
            and ${table.eventType} is null
            and ${table.idempotencyKeyHmacSha256} is null
            and ${table.safeEnvelopeHmacSha256} is null
            and ${table.existingNormalizedEventId} is null
            and ${table.existingRawEventId} is null
            and ${table.existingSourceConnectionId} is null
            and ${table.existingSourceAccountScopeKey} is null
            and ${table.existingEventType} is null
            and ${table.existingSafeEnvelopeHmacSha256} is null)
          or (${table.reasonCode} = 'source.idempotency_collision'
            and ${table.normalizedOrdinal} is not null
            and ${table.normalizedOrdinal} >= 0
            and ${table.eventType} is not null
            and ${safeTokenSql(table.eventType)}
            and ${table.idempotencyKeyHmacSha256} is not null
            and ${hmacSha256Sql(table.idempotencyKeyHmacSha256)}
            and ${table.safeEnvelopeHmacSha256} is not null
            and ${hmacSha256Sql(table.safeEnvelopeHmacSha256)}
            and ${table.existingNormalizedEventId} is not null
            and ${table.existingRawEventId} is not null
            and ${table.existingSourceConnectionId} is not null
            and ${table.existingSourceAccountScopeKey} is not null
            and ${table.existingEventType} is not null
            and ${safeTokenSql(table.existingEventType)}
            and ${table.existingSafeEnvelopeHmacSha256} is not null
            and ${hmacSha256Sql(table.existingSafeEnvelopeHmacSha256)}
            and (
              ${table.rawEventId} <> ${table.existingRawEventId}
              or ${table.sourceConnectionId} <>
                ${table.existingSourceConnectionId}
              or ${table.sourceAccountScopeKey} <>
                ${table.existingSourceAccountScopeKey}
              or ${table.eventType} <> ${table.existingEventType}
              or ${table.safeEnvelopeHmacSha256} <>
                ${table.existingSafeEnvelopeHmacSha256}
            ))
        )`
    ),
    index("inbox_v2_source_normalized_quarantines_raw_idx").on(
      table.tenantId,
      table.rawEventId,
      table.recordedAt,
      table.id
    )
  ]
);

/**
 * One immutable completion head replaces the leased raw work row. Keeping the
 * result separate lets the N-1 claim query remain safe: completed work has no
 * pending/leased row to reclaim.
 */
export const inboxV2SourceNormalizationResults = pgTable(
  "inbox_v2_source_normalization_results",
  {
    tenantId: text("tenant_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    outcome: inboxV2SourceNormalizationOutcome("outcome").notNull(),
    normalizedEventCount: integer("normalized_event_count").notNull(),
    orderedEventHmacSha256: text("ordered_event_hmac_sha256").notNull(),
    reasonCode: text("reason_code"),
    quarantineId: text("quarantine_id"),
    digestKeyGeneration: text("digest_key_generation").notNull(),
    candidateCompletionHmacSha256: text(
      "candidate_completion_hmac_sha256"
    ).notNull(),
    workerId: text("worker_id").notNull(),
    completedAttemptCount: bigint("completed_attempt_count", {
      mode: "bigint"
    }).notNull(),
    completedReclaimCount: bigint("completed_reclaim_count", {
      mode: "bigint"
    }).notNull(),
    completedLeaseTokenHash: text("completed_lease_token_hash").notNull(),
    completedLeaseRevision: bigint("completed_lease_revision", {
      mode: "bigint"
    }).notNull(),
    completedLeaseClaimedAt: timestamp("completed_lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedLeaseExpiresAt: timestamp("completed_lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedWorkRevision: bigint("completed_work_revision", {
      mode: "bigint"
    }).notNull(),
    resultSchemaId: text("result_schema_id").notNull(),
    resultSchemaVersion: text("result_schema_version").notNull(),
    resultHmacSha256: text("result_hmac_sha256").notNull(),
    completedAt: timestamp("completed_at", {
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
      name: "inbox_v2_source_normalization_results_pk",
      columns: [table.tenantId, table.rawEventId]
    }),
    unique("inbox_v2_source_normalization_results_digest_unique").on(
      table.tenantId,
      table.rawEventId,
      table.resultHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_source_normalization_results_raw_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_normalization_results_quarantine_fk",
      columns: [
        table.tenantId,
        table.quarantineId,
        table.rawEventId,
        table.reasonCode,
        table.digestKeyGeneration,
        table.candidateCompletionHmacSha256
      ],
      foreignColumns: [
        inboxV2SourceNormalizedQuarantines.tenantId,
        inboxV2SourceNormalizedQuarantines.id,
        inboxV2SourceNormalizedQuarantines.rawEventId,
        inboxV2SourceNormalizedQuarantines.reasonCode,
        inboxV2SourceNormalizedQuarantines.digestKeyGeneration,
        inboxV2SourceNormalizedQuarantines.candidateCompletionHmacSha256
      ]
    }),
    check(
      "inbox_v2_source_normalization_results_shape_check",
      sql`${table.normalizedEventCount} >= 0
        and ${hmacSha256Sql(table.orderedEventHmacSha256)}
        and ${keyGenerationSql(table.digestKeyGeneration)}
        and ${hmacSha256Sql(table.candidateCompletionHmacSha256)}
        and (
          (${table.outcome} = 'normalized'
            and ${table.normalizedEventCount} >= 1
            and ${table.reasonCode} is null
            and ${table.quarantineId} is null)
          or (${table.outcome} = 'ignored'
            and ${table.normalizedEventCount} = 0
            and ${table.reasonCode} is not null
            and ${safeTokenSql(table.reasonCode)}
            and ${table.quarantineId} is null)
          or (${table.outcome} = 'quarantined'
            and ${table.normalizedEventCount} = 0
            and ${table.reasonCode} is not null
            and ${safeTokenSql(table.reasonCode)}
            and ${table.quarantineId} is not null)
        )`
    ),
    check(
      "inbox_v2_source_normalization_results_fence_check",
      sql`char_length(${table.workerId}) between 1 and 256
        and ${table.completedAttemptCount} >= 1
        and ${table.completedReclaimCount} >= 0
        and ${table.completedReclaimCount} <= ${table.completedAttemptCount}
        and ${sha256Sql(table.completedLeaseTokenHash)}
        and ${table.completedLeaseRevision} >= 1
        and ${table.completedWorkRevision} >= 1
        and ${catalogIdSql(table.resultSchemaId)}
        and ${versionTokenSql(table.resultSchemaVersion)}
        and ${hmacSha256Sql(table.resultHmacSha256)}
        and isfinite(${table.completedLeaseClaimedAt})
        and isfinite(${table.completedLeaseExpiresAt})
        and ${table.completedLeaseClaimedAt} < ${table.completedLeaseExpiresAt}
        and isfinite(${table.completedAt})
        and isfinite(${table.createdAt})
        and ${table.completedAt} >= ${table.completedLeaseClaimedAt}
        and ${table.completedAt} < ${table.completedLeaseExpiresAt}
        and ${table.createdAt} = ${table.completedAt}`
    ),
    index("inbox_v2_source_normalization_results_completed_idx").on(
      table.tenantId,
      table.completedAt,
      table.rawEventId
    )
  ]
);

/**
 * Commit-time closure and V2 compatibility guards. The work DELETE override is
 * intentionally installed here, after the completion relation exists.
 */
export const INBOX_V2_SOURCE_NORMALIZATION_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_source_normalized_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_source_normalized_evidence_payloads'
     and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception '% is immutable', tg_table_name using errcode = '23514';
end
$function$;

create trigger inbox_v2_source_normalized_envelopes_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_envelopes
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_evidence
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_payloads_immutable_trigger
before update on public.inbox_v2_source_normalized_evidence_payloads
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_quarantines_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_quarantines
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalization_results_immutable_trigger
before update or delete on public.inbox_v2_source_normalization_results
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_envelopes_truncate_guard
before truncate on public.inbox_v2_source_normalized_envelopes
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_truncate_guard
before truncate on public.inbox_v2_source_normalized_evidence
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_payloads_truncate_guard
before truncate on public.inbox_v2_source_normalized_evidence_payloads
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_quarantines_truncate_guard
before truncate on public.inbox_v2_source_normalized_quarantines
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalization_results_truncate_guard
before truncate on public.inbox_v2_source_normalization_results
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create or replace function public.inbox_v2_source_normalized_anchor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.idempotency_key like 'source:v2:normalized:%' then
    raise exception 'V2 normalized compatibility anchor is immutable'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger inbox_v2_source_normalized_anchor_immutable_trigger
before update or delete on public.normalized_inbound_events
for each row execute function public.inbox_v2_source_normalized_anchor_guard();

create or replace function public.inbox_v2_source_normalized_assert_aggregate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_normalized_event_id text;
  v_anchor public.normalized_inbound_events%rowtype;
  v_envelope public.inbox_v2_source_normalized_envelopes%rowtype;
  v_result public.inbox_v2_source_normalization_results%rowtype;
  v_evidence_count bigint;
  v_payload_count bigint;
  v_raw_event_count bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'normalized_inbound_events' then
    v_normalized_event_id := new.id;
  else
    v_normalized_event_id := new.normalized_event_id;
  end if;

  select * into v_anchor
    from public.normalized_inbound_events event_row
   where event_row.tenant_id = v_tenant_id
     and event_row.id = v_normalized_event_id;
  select * into v_envelope
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.normalized_event_id = v_normalized_event_id;

  if v_envelope.normalized_event_id is null then
    if v_anchor.id is not null
       and v_anchor.idempotency_key like 'source:v2:normalized:%' then
      raise exception 'V2 normalized anchor requires an immutable envelope'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_anchor.id is null
     or v_anchor.raw_event_id <> v_envelope.raw_event_id
     or v_anchor.source_connection_id <> v_envelope.source_connection_id
     or v_anchor.source_account_id is distinct from v_envelope.source_account_id
     or v_anchor.source_type <> v_envelope.source_type
     or v_anchor.source_name <> v_envelope.source_name
     or v_anchor.event_type <> v_envelope.event_type
     or v_anchor.direction <> v_envelope.direction
     or v_anchor.visibility <> v_envelope.visibility
     or v_anchor.payload_version <> v_envelope.payload_schema_version
     or v_anchor.idempotency_key <> v_envelope.idempotency_key
     or v_anchor.external_thread_id is not null
     or v_anchor.external_message_id is not null
     or v_anchor.external_user_id is not null
     or v_anchor.normalized_payload <> '{}'::jsonb
     or v_anchor.reply_capability <> '{}'::jsonb
     or v_anchor.conversation_id is not null
     or v_anchor.message_id is not null
     or v_anchor.processing_status <> 'ignored'
     or v_anchor.created_at <> v_envelope.created_at
     or v_anchor.updated_at <> v_envelope.created_at then
    raise exception 'V2 normalized compatibility anchor is unsafe or incoherent'
      using errcode = '23514';
  end if;

  select count(*) into v_evidence_count
    from public.inbox_v2_source_normalized_evidence evidence_row
   where evidence_row.tenant_id = v_tenant_id
     and evidence_row.normalized_event_id = v_normalized_event_id;
  select count(*) into v_payload_count
    from public.inbox_v2_source_normalized_evidence_payloads payload_row
   where payload_row.tenant_id = v_tenant_id
     and payload_row.normalized_event_id = v_normalized_event_id;

  if tg_table_name <> 'inbox_v2_source_normalized_evidence_payloads'
     and (v_evidence_count <> v_envelope.normalized_evidence_count
       or v_payload_count <> v_evidence_count) then
    raise exception 'V2 normalized envelope has incoherent evidence references'
      using errcode = '23514';
  end if;

  select * into v_result
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = v_tenant_id
     and result_row.raw_event_id = v_envelope.raw_event_id;
  select count(*) into v_raw_event_count
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.raw_event_id = v_envelope.raw_event_id;

  if v_result.raw_event_id is null
     or v_raw_event_count <> v_result.normalized_event_count
     or (v_result.outcome = 'normalized' and v_raw_event_count < 1)
     or (v_result.outcome <> 'normalized' and v_raw_event_count <> 0) then
    raise exception 'V2 normalized aggregate requires its exact immutable terminal result'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_source_normalized_anchor_constraint
after insert or update on public.normalized_inbound_events
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_envelope_constraint
after insert on public.inbox_v2_source_normalized_envelopes
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_evidence_constraint
after insert on public.inbox_v2_source_normalized_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_evidence_payload_constraint
after insert on public.inbox_v2_source_normalized_evidence_payloads
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create or replace function public.inbox_v2_source_normalization_assert_result()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work_count bigint;
  v_event_count bigint;
  v_quarantine_count bigint;
begin
  select count(*) into v_work_count
    from public.inbox_v2_source_raw_work_items work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.raw_event_id = new.raw_event_id;
  select count(*) into v_event_count
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = new.tenant_id
     and envelope_row.raw_event_id = new.raw_event_id;
  select count(*) into v_quarantine_count
    from public.inbox_v2_source_normalized_quarantines quarantine_row
   where quarantine_row.tenant_id = new.tenant_id
     and quarantine_row.id = new.quarantine_id
     and quarantine_row.raw_event_id = new.raw_event_id
     and quarantine_row.reason_code = new.reason_code
     and quarantine_row.digest_key_generation = new.digest_key_generation
     and quarantine_row.candidate_completion_hmac_sha256 =
       new.candidate_completion_hmac_sha256;

  if v_work_count <> 0
     or v_event_count <> new.normalized_event_count
     or (new.outcome = 'normalized' and v_event_count < 1)
     or (new.outcome <> 'normalized' and v_event_count <> 0)
     or (new.outcome = 'quarantined' and v_quarantine_count <> 1)
     or (new.outcome <> 'quarantined' and v_quarantine_count <> 0) then
    raise exception 'V2 source normalization result is not a closed aggregate'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_source_normalization_result_constraint
after insert on public.inbox_v2_source_normalization_results
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalization_assert_result();

create or replace function public.inbox_v2_source_raw_evidence_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_raw_work_items work_row
     where work_row.tenant_id = old.tenant_id
       and work_row.raw_event_id = old.raw_event_id
  ) then
    raise exception 'Raw source evidence cannot be purged before normalization completes'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

create trigger inbox_v2_source_raw_evidence_normalization_delete_guard
before delete on public.inbox_v2_source_raw_evidence
for each row execute function public.inbox_v2_source_raw_evidence_delete_guard();

create or replace function public.inbox_v2_source_raw_assert_aggregate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_raw_event_id text;
  v_anchor public.raw_inbound_events%rowtype;
  v_envelope public.inbox_v2_source_raw_envelopes%rowtype;
  v_work_count bigint;
  v_result_count bigint;
  v_payload_count bigint;
  v_header_count bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'raw_inbound_events' then
    v_raw_event_id := new.id;
  else
    v_raw_event_id := new.raw_event_id;
  end if;

  select * into v_anchor
    from public.raw_inbound_events raw_row
   where raw_row.tenant_id = v_tenant_id
     and raw_row.id = v_raw_event_id;
  select * into v_envelope
    from public.inbox_v2_source_raw_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.raw_event_id = v_raw_event_id;

  if v_envelope.raw_event_id is null then
    if v_anchor.id is not null
       and v_anchor.idempotency_key like 'source:v2:raw:%' then
      raise exception 'V2 raw anchor requires an immutable envelope'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_anchor.id is null
     or v_anchor.source_connection_id <> v_envelope.source_connection_id
     or v_anchor.source_account_scope_key <>
        v_envelope.source_account_scope_key
     or v_anchor.idempotency_key <> v_envelope.idempotency_key
     or v_anchor.received_at <> v_envelope.accepted_at
     or v_anchor.external_event_id is not null
     or v_anchor.event_signature is not null
     or v_anchor.payload <> '{}'::jsonb
     or v_anchor.headers <> '{}'::jsonb
     or v_anchor.processing_status <> 'ignored'
     or v_anchor.error_code is not null
     or v_anchor.error_message is not null then
    raise exception 'V2 raw compatibility anchor contains unsafe or incoherent data'
      using errcode = '23514';
  end if;

  select count(*) into v_work_count
    from public.inbox_v2_source_raw_work_items work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.raw_event_id = v_raw_event_id;
  select count(*) into v_result_count
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = v_tenant_id
     and result_row.raw_event_id = v_raw_event_id;
  select count(*) filter (where evidence_row.evidence_kind = 'provider_payload'),
         count(*) filter (where evidence_row.evidence_kind = 'allowed_headers')
    into v_payload_count, v_header_count
    from public.inbox_v2_source_raw_evidence evidence_row
   where evidence_row.tenant_id = v_tenant_id
     and evidence_row.raw_event_id = v_raw_event_id;

  if v_work_count + v_result_count <> 1
     or (
       tg_table_name <> 'inbox_v2_source_raw_work_items'
       and (
         (v_envelope.provider_payload_evidence_present and v_payload_count <> 1)
         or (not v_envelope.provider_payload_evidence_present and v_payload_count <> 0)
         or (v_envelope.allowed_headers_evidence_present and v_header_count <> 1)
         or (not v_envelope.allowed_headers_evidence_present and v_header_count <> 0)
       )
     ) then
    raise exception 'V2 raw aggregate requires exactly one work or completion head and exact evidence flags'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create or replace function public.inbox_v2_source_normalization_complete_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result public.inbox_v2_source_normalization_results%rowtype;
begin
  select * into v_result
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = old.tenant_id
     and result_row.raw_event_id = old.raw_event_id;

  if old.state <> 'leased'
     or v_result.raw_event_id is null
     or v_result.worker_id <> old.lease_owner_id
     or v_result.completed_attempt_count <> old.attempt_count
     or v_result.completed_reclaim_count <> old.reclaim_count
     or v_result.completed_lease_token_hash <> old.lease_token_hash
     or v_result.completed_lease_revision <> old.lease_revision
     or v_result.completed_lease_claimed_at <> old.lease_claimed_at
     or v_result.completed_lease_expires_at <> old.lease_expires_at
     or v_result.completed_work_revision <> old.revision
     or v_result.completed_at < old.updated_at
     or v_result.completed_at >= old.lease_expires_at
     or clock_timestamp() >= old.lease_expires_at then
    raise exception 'Raw work completion requires the exact unexpired lease result'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

drop trigger inbox_v2_source_raw_work_guard_trigger
  on public.inbox_v2_source_raw_work_items;

create trigger inbox_v2_source_raw_work_guard_trigger
before insert or update on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_raw_work_guard();

create trigger inbox_v2_source_raw_work_completion_delete_trigger
before delete on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_normalization_complete_work_guard();
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

function sha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^sha256:[0-9a-f]{64}$'`;
}

function hmacSha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^hmac-sha256:[0-9a-f]{64}$'`;
}

function keyGenerationSql(value: SQLWrapper): SQL {
  return sql`char_length(${value}) between 1 and 128
    and ${value} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
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

function versionTokenSql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^v[1-9][0-9]*$'`;
}
