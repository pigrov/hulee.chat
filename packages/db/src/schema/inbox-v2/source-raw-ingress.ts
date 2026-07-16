import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";

export const inboxV2SourceRawEvidenceKind = pgEnum(
  "inbox_v2_source_raw_evidence_kind",
  ["provider_payload", "allowed_headers"]
);

export const inboxV2SourceRawQuarantineReason = pgEnum(
  "inbox_v2_source_raw_quarantine_reason",
  [
    "source.payload_shape_unknown",
    "source.payload_malformed",
    "source.headers_malformed",
    "source.sanitizer_rejected",
    "source.sanitizer_failed",
    "source.sanitizer_output_invalid",
    "source.idempotency_collision"
  ]
);

export const inboxV2SourceRawWorkState = pgEnum(
  "inbox_v2_source_raw_work_state",
  ["pending", "leased"]
);

type SanitizedEvidence = Readonly<Record<string, unknown>>;

/**
 * Immutable, secret-free accepted-occurrence envelope. The legacy raw row is
 * retained as the compatibility/FK anchor, but its JSON/error fields are kept
 * empty by the deferred aggregate guard below.
 */
export const inboxV2SourceRawEnvelopes = pgTable(
  "inbox_v2_source_raw_envelopes",
  {
    tenantId: text("tenant_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    transportKind: text("transport_kind").notNull(),
    eventIdentityKind: text("event_identity_kind").notNull(),
    eventIdentityDigestSha256: text("event_identity_digest_sha256").notNull(),
    safeEnvelopeSchemaId: text("safe_envelope_schema_id").notNull(),
    safeEnvelopeSchemaVersion: text("safe_envelope_schema_version").notNull(),
    safeEnvelopeDigestSha256: text("safe_envelope_digest_sha256").notNull(),
    sanitizerId: text("sanitizer_id").notNull(),
    sanitizerVersion: text("sanitizer_version").notNull(),
    sanitizerDeclarationRevision: bigint("sanitizer_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    providerPayloadEvidencePresent: boolean(
      "provider_payload_evidence_present"
    ).notNull(),
    allowedHeadersEvidencePresent: boolean(
      "allowed_headers_evidence_present"
    ).notNull(),
    dataClassId: text("data_class_id").notNull(),
    sensitivityClass: text("sensitivity_class").notNull(),
    processingPurposeId: text("processing_purpose_id").notNull(),
    canonicalAnchorId: text("canonical_anchor_id").notNull(),
    expiryAction: text("expiry_action").notNull(),
    acceptedAt: timestamp("accepted_at", {
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
      name: "inbox_v2_source_raw_envelopes_pk",
      columns: [table.tenantId, table.rawEventId]
    }),
    unique("inbox_v2_source_raw_envelopes_idempotency_unique").on(
      table.tenantId,
      table.idempotencyKey
    ),
    unique("inbox_v2_source_raw_envelopes_digest_unique").on(
      table.tenantId,
      table.rawEventId,
      table.safeEnvelopeDigestSha256
    ),
    unique("inbox_v2_source_raw_envelopes_exact_scope_unique").on(
      table.tenantId,
      table.rawEventId,
      table.sourceConnectionId,
      table.sourceAccountScopeKey,
      table.transportKind,
      table.eventIdentityKind,
      table.eventIdentityDigestSha256,
      table.safeEnvelopeDigestSha256
    ),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_anchor_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_anchor_connection_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceConnectionId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_anchor_account_scope_fk",
      columns: [table.tenantId, table.rawEventId, table.sourceAccountScopeKey],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_envelopes_account_edge_fk",
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
      "inbox_v2_source_raw_envelopes_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_source_raw_envelopes_identity_check",
      sql`${table.idempotencyKey} ~ '^source:v2:raw:[0-9a-f]{64}$'
        and ${safeTokenSql(table.transportKind)}
        and ${safeTokenSql(table.eventIdentityKind)}
        and ${sha256Sql(table.eventIdentityDigestSha256)}
        and ${catalogIdSql(table.safeEnvelopeSchemaId)}
        and ${versionTokenSql(table.safeEnvelopeSchemaVersion)}
        and ${sha256Sql(table.safeEnvelopeDigestSha256)}`
    ),
    check(
      "inbox_v2_source_raw_envelopes_sanitizer_check",
      sql`${catalogIdSql(table.sanitizerId)}
        and ${versionTokenSql(table.sanitizerVersion)}
        and ${table.sanitizerDeclarationRevision} >= 1`
    ),
    check(
      "inbox_v2_source_raw_envelopes_lifecycle_check",
      sql`${table.dataClassId} = 'core:raw_event_envelope'
        and ${table.sensitivityClass} = 'personal_operational'
        and ${table.processingPurposeId} = 'core:source_replay_and_diagnostics'
        and ${table.canonicalAnchorId} = 'core:terminal_processing'
        and ${table.expiryAction} = 'compact_to_safe_skeleton'`
    ),
    check(
      "inbox_v2_source_raw_envelopes_times_check",
      sql`isfinite(${table.acceptedAt})
        and isfinite(${table.createdAt})
        and ${table.createdAt} >= ${table.acceptedAt}`
    ),
    index("inbox_v2_source_raw_envelopes_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.acceptedAt,
      table.rawEventId
    ),
    index("inbox_v2_source_raw_envelopes_account_idx").on(
      table.tenantId,
      table.sourceAccountScopeKey,
      table.acceptedAt,
      table.rawEventId
    )
  ]
);

/**
 * Sanitized provider evidence. Rows are immutable on update, while delete is
 * intentionally allowed so payload and allowed-header evidence can expire
 * independently without removing the safe envelope.
 */
export const inboxV2SourceRawEvidence = pgTable(
  "inbox_v2_source_raw_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    evidenceKind: inboxV2SourceRawEvidenceKind("evidence_kind").notNull(),
    dataClassId: text("data_class_id").notNull(),
    sensitivityClass: text("sensitivity_class").notNull(),
    purposeIds: jsonb("purpose_ids").$type<readonly string[]>().notNull(),
    evidenceSchemaId: text("evidence_schema_id").notNull(),
    evidenceSchemaVersion: text("evidence_schema_version").notNull(),
    contentDigestSha256: text("content_digest_sha256").notNull(),
    content: jsonb("content").$type<SanitizedEvidence>().notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_raw_evidence_pk",
      columns: [table.tenantId, table.rawEventId, table.evidenceKind]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_evidence_envelope_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    check(
      "inbox_v2_source_raw_evidence_classification_check",
      sql`(
          ${table.evidenceKind} = 'provider_payload'
          and ${table.dataClassId} = 'core:raw_provider_payload'
          and ${table.sensitivityClass} = 'restricted_content'
        ) or (
          ${table.evidenceKind} = 'allowed_headers'
          and ${table.dataClassId} = 'core:raw_provider_allowed_headers'
          and ${table.sensitivityClass} = 'personal_identifier'
        )`
    ),
    check(
      "inbox_v2_source_raw_evidence_purpose_check",
      sql`${table.purposeIds} in (
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
      "inbox_v2_source_raw_evidence_content_check",
      sql`${catalogIdSql(table.evidenceSchemaId)}
        and ${versionTokenSql(table.evidenceSchemaVersion)}
        and ${sha256Sql(table.contentDigestSha256)}
        and jsonb_typeof(${table.content}) = 'object'
        and isfinite(${table.recordedAt})`
    ),
    index("inbox_v2_source_raw_evidence_recorded_idx").on(
      table.tenantId,
      table.recordedAt,
      table.rawEventId,
      table.evidenceKind
    )
  ]
);

/** Safe immutable diagnostic for sanitizer rejection or idempotency collision. */
export const inboxV2SourceRawQuarantines = pgTable(
  "inbox_v2_source_raw_quarantines",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    reasonCode: inboxV2SourceRawQuarantineReason("reason_code").notNull(),
    quarantineFingerprintSha256: text(
      "quarantine_fingerprint_sha256"
    ).notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    sourceAccountScopeKey: text("source_account_scope_key").notNull(),
    transportKind: text("transport_kind").notNull(),
    eventIdentityKind: text("event_identity_kind"),
    eventIdentityDigestSha256: text("event_identity_digest_sha256"),
    idempotencyKeyDigestSha256: text("idempotency_key_digest_sha256"),
    safeEnvelopeDigestSha256: text("safe_envelope_digest_sha256"),
    existingRawEventId: text("existing_raw_event_id"),
    existingSourceConnectionId: text("existing_source_connection_id"),
    existingSourceAccountScopeKey: text("existing_source_account_scope_key"),
    existingTransportKind: text("existing_transport_kind"),
    existingEventIdentityKind: text("existing_event_identity_kind"),
    existingEventIdentityDigestSha256: text(
      "existing_event_identity_digest_sha256"
    ),
    existingSafeEnvelopeDigestSha256: text(
      "existing_safe_envelope_digest_sha256"
    ),
    sanitizerId: text("sanitizer_id").notNull(),
    sanitizerVersion: text("sanitizer_version").notNull(),
    sanitizerDeclarationRevision: bigint("sanitizer_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_raw_quarantines_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_source_raw_quarantines_fingerprint_unique").on(
      table.tenantId,
      table.quarantineFingerprintSha256
    ),
    foreignKey({
      name: "inbox_v2_source_raw_quarantines_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_quarantines_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_quarantines_account_edge_fk",
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
      name: "inbox_v2_source_raw_quarantines_existing_connection_fk",
      columns: [
        table.tenantId,
        table.existingRawEventId,
        table.existingSourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_quarantines_existing_account_scope_fk",
      columns: [
        table.tenantId,
        table.existingRawEventId,
        table.existingSourceAccountScopeKey
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountScopeKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_quarantines_existing_envelope_fk",
      columns: [
        table.tenantId,
        table.existingRawEventId,
        table.existingSourceConnectionId,
        table.existingSourceAccountScopeKey,
        table.existingTransportKind,
        table.existingEventIdentityKind,
        table.existingEventIdentityDigestSha256,
        table.existingSafeEnvelopeDigestSha256
      ],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId,
        inboxV2SourceRawEnvelopes.sourceConnectionId,
        inboxV2SourceRawEnvelopes.sourceAccountScopeKey,
        inboxV2SourceRawEnvelopes.transportKind,
        inboxV2SourceRawEnvelopes.eventIdentityKind,
        inboxV2SourceRawEnvelopes.eventIdentityDigestSha256,
        inboxV2SourceRawEnvelopes.safeEnvelopeDigestSha256
      ]
    }),
    check(
      "inbox_v2_source_raw_quarantines_scope_check",
      accountScopeSql(table.sourceAccountId, table.sourceAccountScopeKey)
    ),
    check(
      "inbox_v2_source_raw_quarantines_safe_values_check",
      sql`${sha256Sql(table.quarantineFingerprintSha256)}
        and ${safeTokenSql(table.transportKind)}
        and (${table.eventIdentityKind} is null
          or ${safeTokenSql(table.eventIdentityKind)})
        and (${table.eventIdentityDigestSha256} is null
          or ${sha256Sql(table.eventIdentityDigestSha256)})
        and (${table.idempotencyKeyDigestSha256} is null
          or ${sha256Sql(table.idempotencyKeyDigestSha256)})
        and (${table.safeEnvelopeDigestSha256} is null
          or ${sha256Sql(table.safeEnvelopeDigestSha256)})
        and (${table.existingSafeEnvelopeDigestSha256} is null
          or ${sha256Sql(table.existingSafeEnvelopeDigestSha256)})
        and (${table.existingTransportKind} is null
          or ${safeTokenSql(table.existingTransportKind)})
        and (${table.existingEventIdentityKind} is null
          or ${safeTokenSql(table.existingEventIdentityKind)})
        and (${table.existingEventIdentityDigestSha256} is null
          or ${sha256Sql(table.existingEventIdentityDigestSha256)})
        and ${catalogIdSql(table.sanitizerId)}
        and ${versionTokenSql(table.sanitizerVersion)}
        and ${table.sanitizerDeclarationRevision} >= 1
        and isfinite(${table.recordedAt})`
    ),
    check(
      "inbox_v2_source_raw_quarantines_reason_shape_check",
      sql`(
          ${table.reasonCode} = 'source.idempotency_collision'
          and ${table.eventIdentityKind} is not null
          and ${table.eventIdentityDigestSha256} is not null
          and ${table.idempotencyKeyDigestSha256} is not null
          and ${table.safeEnvelopeDigestSha256} is not null
          and ${table.existingRawEventId} is not null
          and ${table.existingSourceConnectionId} is not null
          and ${table.existingSourceAccountScopeKey} is not null
          and ${table.existingTransportKind} is not null
          and ${table.existingEventIdentityKind} is not null
          and ${table.existingEventIdentityDigestSha256} is not null
          and ${table.existingSafeEnvelopeDigestSha256} is not null
          and (
            ${table.sourceConnectionId} <>
              ${table.existingSourceConnectionId}
            or ${table.sourceAccountScopeKey} <>
              ${table.existingSourceAccountScopeKey}
            or ${table.transportKind} <> ${table.existingTransportKind}
            or ${table.eventIdentityKind} <>
              ${table.existingEventIdentityKind}
            or ${table.eventIdentityDigestSha256} <>
              ${table.existingEventIdentityDigestSha256}
            or ${table.safeEnvelopeDigestSha256} <>
              ${table.existingSafeEnvelopeDigestSha256}
          )
        ) or (
          ${table.reasonCode} in (
            'source.payload_shape_unknown',
            'source.payload_malformed',
            'source.headers_malformed',
            'source.sanitizer_rejected',
            'source.sanitizer_failed',
            'source.sanitizer_output_invalid'
          )
          and ${table.existingRawEventId} is null
          and ${table.existingSourceConnectionId} is null
          and ${table.existingSourceAccountScopeKey} is null
          and ${table.existingTransportKind} is null
          and ${table.existingEventIdentityKind} is null
          and ${table.existingEventIdentityDigestSha256} is null
          and ${table.existingSafeEnvelopeDigestSha256} is null
        )`
    ),
    index("inbox_v2_source_raw_quarantines_reason_idx").on(
      table.tenantId,
      table.reasonCode,
      table.recordedAt,
      table.id
    ),
    index("inbox_v2_source_raw_quarantines_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.recordedAt,
      table.id
    )
  ]
);

/** Mutable, revision-fenced claim head; terminal processing belongs to SRC-003/008. */
export const inboxV2SourceRawWorkItems = pgTable(
  "inbox_v2_source_raw_work_items",
  {
    tenantId: text("tenant_id").notNull(),
    rawEventId: text("raw_event_id").notNull(),
    state: inboxV2SourceRawWorkState("state").notNull(),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
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
    reclaimCount: bigint("reclaim_count", { mode: "bigint" }).notNull(),
    lastReclaimedAt: timestamp("last_reclaimed_at", {
      withTimezone: true,
      precision: 3
    }),
    lastReclaimedFromExpiresAt: timestamp("last_reclaimed_from_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    lastReclaimedLeaseOwnerId: text("last_reclaimed_lease_owner_id"),
    lastReclaimedLeaseTokenHash: text("last_reclaimed_lease_token_hash"),
    lastReclaimedLeaseRevision: bigint("last_reclaimed_lease_revision", {
      mode: "bigint"
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
      name: "inbox_v2_source_raw_work_items_pk",
      columns: [table.tenantId, table.rawEventId]
    }),
    foreignKey({
      name: "inbox_v2_source_raw_work_items_envelope_fk",
      columns: [table.tenantId, table.rawEventId],
      foreignColumns: [
        inboxV2SourceRawEnvelopes.tenantId,
        inboxV2SourceRawEnvelopes.rawEventId
      ]
    }),
    uniqueIndex("inbox_v2_source_raw_work_items_lease_token_unique")
      .on(table.tenantId, table.leaseTokenHash)
      .where(sql`${table.leaseTokenHash} is not null`),
    check(
      "inbox_v2_source_raw_work_items_values_check",
      sql`${table.attemptCount} >= 0
        and ${table.reclaimCount} >= 0
        and ${table.reclaimCount} <= ${table.attemptCount}
        and ${table.revision} >= 1
        and (${table.leaseOwnerId} is null
          or char_length(${table.leaseOwnerId}) between 1 and 256)
        and (${table.leaseTokenHash} is null
          or ${sha256Sql(table.leaseTokenHash)})
        and (${table.lastReclaimedLeaseOwnerId} is null
          or char_length(${table.lastReclaimedLeaseOwnerId}) between 1 and 256)
        and (${table.lastReclaimedLeaseTokenHash} is null
          or ${sha256Sql(table.lastReclaimedLeaseTokenHash)})`
    ),
    check(
      "inbox_v2_source_raw_work_items_state_check",
      sql`(
          ${table.state} = 'pending'
          and ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
        ) or (
          ${table.state} = 'leased'
          and ${table.attemptCount} >= 1
          and ${table.leaseOwnerId} is not null
          and ${table.leaseTokenHash} is not null
          and ${table.leaseRevision} = ${table.revision}
          and ${table.leaseClaimedAt} is not null
          and ${table.leaseExpiresAt} is not null
        )`
    ),
    check(
      "inbox_v2_source_raw_work_items_reclaim_check",
      sql`(
          ${table.reclaimCount} = 0
          and ${table.lastReclaimedAt} is null
          and ${table.lastReclaimedFromExpiresAt} is null
          and ${table.lastReclaimedLeaseOwnerId} is null
          and ${table.lastReclaimedLeaseTokenHash} is null
          and ${table.lastReclaimedLeaseRevision} is null
        ) or (
          ${table.reclaimCount} >= 1
          and ${table.lastReclaimedAt} is not null
          and ${table.lastReclaimedFromExpiresAt} is not null
          and ${table.lastReclaimedLeaseOwnerId} is not null
          and ${table.lastReclaimedLeaseTokenHash} is not null
          and ${table.lastReclaimedLeaseRevision} >= 1
        )`
    ),
    check(
      "inbox_v2_source_raw_work_items_times_check",
      sql`isfinite(${table.availableAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.leaseClaimedAt} is null or (
          isfinite(${table.leaseClaimedAt})
          and ${table.leaseClaimedAt} between ${table.createdAt} and
            ${table.updatedAt}
        ))
        and (${table.leaseExpiresAt} is null or (
          isfinite(${table.leaseExpiresAt})
          and ${table.leaseExpiresAt} > ${table.updatedAt}
        ))
        and (${table.lastReclaimedAt} is null or (
          isfinite(${table.lastReclaimedAt})
          and ${table.lastReclaimedAt} between ${table.createdAt} and
            ${table.updatedAt}
        ))
        and (${table.lastReclaimedFromExpiresAt} is null or (
          isfinite(${table.lastReclaimedFromExpiresAt})
          and ${table.lastReclaimedFromExpiresAt} <= ${table.lastReclaimedAt}
        ))`
    ),
    index("inbox_v2_source_raw_work_items_due_idx")
      .on(table.tenantId, table.availableAt, table.rawEventId)
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_source_raw_work_items_reclaim_idx")
      .on(table.tenantId, table.leaseExpiresAt, table.rawEventId)
      .where(sql`${table.state} = 'leased'`),
    index("inbox_v2_source_raw_work_items_owner_idx")
      .on(table.tenantId, table.leaseOwnerId, table.leaseExpiresAt)
      .where(sql`${table.state} = 'leased'`)
  ]
);

/**
 * Commit-time closure plus immutable/transition guards. Evidence DELETE is
 * deliberately excluded from the closure trigger so independently classified
 * evidence can be purged after the accepted aggregate was committed.
 */
export const INBOX_V2_SOURCE_RAW_INGRESS_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_source_raw_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_source_raw_evidence' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception '% is immutable', tg_table_name using errcode = '23514';
end
$function$;

create trigger inbox_v2_source_raw_envelopes_immutable_trigger
before update or delete on public.inbox_v2_source_raw_envelopes
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_evidence_immutable_trigger
before update on public.inbox_v2_source_raw_evidence
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_quarantines_immutable_trigger
before update or delete on public.inbox_v2_source_raw_quarantines
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_envelopes_truncate_guard
before truncate on public.inbox_v2_source_raw_envelopes
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_evidence_truncate_guard
before truncate on public.inbox_v2_source_raw_evidence
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_quarantines_truncate_guard
before truncate on public.inbox_v2_source_raw_quarantines
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_work_items_truncate_guard
before truncate on public.inbox_v2_source_raw_work_items
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create or replace function public.inbox_v2_source_raw_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Raw work head cannot be deleted' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.attempt_count <> 0
       or new.reclaim_count <> 0
       or new.revision <> 1
       or new.available_at < new.created_at
       or new.updated_at <> new.created_at then
      raise exception 'Raw work head must start pending at revision one'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.raw_event_id <> old.raw_event_id
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'Raw work mutation requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  if old.state = 'pending' and new.state = 'leased' then
    if new.available_at <> old.available_at
       or old.available_at > new.lease_claimed_at
       or new.lease_claimed_at <> new.updated_at
       or new.attempt_count <> old.attempt_count + 1
       or new.reclaim_count <> old.reclaim_count
       or new.last_reclaimed_at is distinct from old.last_reclaimed_at
       or new.last_reclaimed_from_expires_at is distinct from
          old.last_reclaimed_from_expires_at
       or new.last_reclaimed_lease_owner_id is distinct from
          old.last_reclaimed_lease_owner_id
       or new.last_reclaimed_lease_token_hash is distinct from
          old.last_reclaimed_lease_token_hash
       or new.last_reclaimed_lease_revision is distinct from
          old.last_reclaimed_lease_revision then
      raise exception 'Pending raw work requires one exact due claim'
        using errcode = '23514';
    end if;
  elsif old.state = 'leased' and new.state = 'leased' then
    if new.lease_claimed_at >= old.lease_expires_at then
      if new.available_at <> old.available_at
         or new.lease_claimed_at <> new.updated_at
         or new.attempt_count <> old.attempt_count + 1
         or new.reclaim_count <> old.reclaim_count + 1
         or new.last_reclaimed_at <> new.lease_claimed_at
         or new.last_reclaimed_from_expires_at <> old.lease_expires_at
         or new.last_reclaimed_lease_owner_id <> old.lease_owner_id
         or new.last_reclaimed_lease_token_hash <> old.lease_token_hash
         or new.last_reclaimed_lease_revision <> old.lease_revision then
        raise exception 'Expired raw lease requires exact fenced reclaim evidence'
          using errcode = '23514';
      end if;
    elsif new.lease_owner_id = old.lease_owner_id
       and new.lease_token_hash = old.lease_token_hash
       and new.lease_claimed_at = old.lease_claimed_at then
      if new.updated_at >= old.lease_expires_at
         or new.lease_expires_at <= old.lease_expires_at
         or new.available_at <> old.available_at
         or new.attempt_count <> old.attempt_count
         or new.reclaim_count <> old.reclaim_count
         or new.last_reclaimed_at is distinct from old.last_reclaimed_at
         or new.last_reclaimed_from_expires_at is distinct from
            old.last_reclaimed_from_expires_at
         or new.last_reclaimed_lease_owner_id is distinct from
            old.last_reclaimed_lease_owner_id
         or new.last_reclaimed_lease_token_hash is distinct from
            old.last_reclaimed_lease_token_hash
         or new.last_reclaimed_lease_revision is distinct from
            old.last_reclaimed_lease_revision then
        raise exception 'Raw lease renewal requires the unexpired exact lease'
          using errcode = '23514';
      end if;
    else
      raise exception 'Raw lease cannot be replaced before expiry'
        using errcode = '23514';
    end if;
  elsif old.state = 'leased' and new.state = 'pending' then
    if new.updated_at >= old.lease_expires_at
       or new.available_at < new.updated_at
       or new.attempt_count <> old.attempt_count
       or new.reclaim_count <> old.reclaim_count
       or new.last_reclaimed_at is distinct from old.last_reclaimed_at
       or new.last_reclaimed_from_expires_at is distinct from
          old.last_reclaimed_from_expires_at
       or new.last_reclaimed_lease_owner_id is distinct from
          old.last_reclaimed_lease_owner_id
       or new.last_reclaimed_lease_token_hash is distinct from
          old.last_reclaimed_lease_token_hash
       or new.last_reclaimed_lease_revision is distinct from
          old.last_reclaimed_lease_revision then
      raise exception 'Raw lease release requires the unexpired exact lease'
        using errcode = '23514';
    end if;
  else
    raise exception 'Illegal raw work state transition' using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_source_raw_work_guard_trigger
before insert or update or delete on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_raw_work_guard();

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
    from public.raw_inbound_events r
   where r.tenant_id = v_tenant_id and r.id = v_raw_event_id;
  select * into v_envelope
    from public.inbox_v2_source_raw_envelopes e
   where e.tenant_id = v_tenant_id and e.raw_event_id = v_raw_event_id;

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
    from public.inbox_v2_source_raw_work_items w
   where w.tenant_id = v_tenant_id and w.raw_event_id = v_raw_event_id;
  select count(*) filter (where e.evidence_kind = 'provider_payload'),
         count(*) filter (where e.evidence_kind = 'allowed_headers')
    into v_payload_count, v_header_count
    from public.inbox_v2_source_raw_evidence e
   where e.tenant_id = v_tenant_id and e.raw_event_id = v_raw_event_id;

  if v_work_count <> 1
     or (
       tg_table_name <> 'inbox_v2_source_raw_work_items'
       and (
         (v_envelope.provider_payload_evidence_present and v_payload_count <> 1)
         or (not v_envelope.provider_payload_evidence_present and v_payload_count <> 0)
         or (v_envelope.allowed_headers_evidence_present and v_header_count <> 1)
         or (not v_envelope.allowed_headers_evidence_present and v_header_count <> 0)
       )
     ) then
    raise exception 'V2 raw aggregate requires one work head and exact evidence flags'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_source_raw_anchor_coherence_constraint
after insert or update on public.raw_inbound_events
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_envelope_coherence_constraint
after insert on public.inbox_v2_source_raw_envelopes
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_evidence_coherence_constraint
after insert on public.inbox_v2_source_raw_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_work_coherence_constraint
after insert or update on public.inbox_v2_source_raw_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();
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
