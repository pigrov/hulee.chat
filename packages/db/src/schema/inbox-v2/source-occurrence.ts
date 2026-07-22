import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import {
  inboxV2Conversations,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";
import { inboxV2ExternalThreads } from "./external-thread";
import { inboxV2SourceExternalIdentities } from "./identity-foundation";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./source-thread-binding";

export const inboxV2SourceOccurrenceOriginKind = pgEnum(
  "inbox_v2_source_occurrence_origin_kind",
  ["webhook", "stream", "poll", "history", "provider_echo", "provider_response"]
);

export const inboxV2SourceOccurrenceMessageScopeKind = pgEnum(
  "inbox_v2_source_occurrence_message_scope_kind",
  ["provider_thread", "source_account", "source_thread_binding"]
);

export const inboxV2SourceOccurrenceDirection = pgEnum(
  "inbox_v2_source_occurrence_direction",
  ["inbound", "outbound", "system"]
);

export const inboxV2SourceOccurrenceProviderActorKind = pgEnum(
  "inbox_v2_source_occurrence_provider_actor_kind",
  ["source_external_identity", "provider_system"]
);

export const inboxV2SourceOccurrenceReferencePortabilityKind = pgEnum(
  "inbox_v2_source_occurrence_reference_portability_kind",
  ["binding_only", "external_thread", "provider_global"]
);

export const inboxV2SourceOccurrenceDecisionStrength = pgEnum(
  "inbox_v2_source_occurrence_decision_strength",
  ["authoritative", "safe_default"]
);

export const inboxV2SourceOccurrenceResolutionState = pgEnum(
  "inbox_v2_source_occurrence_resolution_state",
  ["pending", "resolved", "conflicted"]
);

type MessageKeyColumnNames = Readonly<{
  realmId: string;
  realmVersion: string;
  canonicalizationVersion: string;
  scopeKind: string;
  scopeSourceAccountId: string;
  scopeSourceThreadBindingId: string;
  objectKindId: string;
  externalThreadId: string;
  canonicalExternalSubject: string;
}>;

function messageKeyDigestSql(columns: MessageKeyColumnNames) {
  return sql`encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        ${lengthPrefixedColumn(columns.realmId)} ||
        ${lengthPrefixedColumn(columns.realmVersion)} ||
        ${lengthPrefixedColumn(columns.canonicalizationVersion)} ||
        case ${sql.identifier(columns.scopeKind)}
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        ${lengthPrefixedColumn(columns.scopeSourceAccountId, true)} ||
        ${lengthPrefixedColumn(columns.scopeSourceThreadBindingId, true)} ||
        ${lengthPrefixedColumn(columns.objectKindId)} ||
        ${lengthPrefixedColumn(columns.externalThreadId)} ||
        ${lengthPrefixedColumn(columns.canonicalExternalSubject)},
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )`;
}

function lengthPrefixedColumn(columnName: string, nullable = false) {
  const column = sql.identifier(columnName);

  if (nullable) {
    return sql`case
      when ${column} is null then '-1:'
      else octet_length(${column})::text || ':' || ${column}
    end`;
  }

  return sql`octet_length(${column})::text || ':' || ${column}`;
}

/**
 * One immutable provider observation with a narrowly mutable resolution head.
 * Provider-response attempt and external-message-reference foreign keys are
 * installed by outbound-transport integrity SQL after both sides exist, which
 * avoids a runtime TypeScript schema cycle.
 */
export const inboxV2SourceOccurrences = pgTable(
  "inbox_v2_source_occurrences",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    externalThreadRevision: bigint("external_thread_revision", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`1`),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    bindingRevision: bigint("binding_revision", { mode: "bigint" }).notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    accountIdentityRevision: bigint("account_identity_revision", {
      mode: "bigint"
    }).notNull(),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
    accountCanonicalKeyDigestSha256: text(
      "account_canonical_key_digest_sha256"
    ).notNull(),
    messageRealmId: text("message_realm_id").notNull(),
    messageRealmVersion: text("message_realm_version").notNull(),
    messageCanonicalizationVersion: text(
      "message_canonicalization_version"
    ).notNull(),
    messageScopeKind:
      inboxV2SourceOccurrenceMessageScopeKind("message_scope_kind").notNull(),
    messageScopeSourceAccountId: text("message_scope_source_account_id"),
    messageScopeSourceThreadBindingId: text(
      "message_scope_source_thread_binding_id"
    ),
    messageScopeOwnerKey: text("message_scope_owner_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case message_scope_kind
          when 'provider_thread' then 'provider_thread'
          when 'source_account' then
            'source_account|' || octet_length(message_scope_source_account_id)::text || ':' || message_scope_source_account_id
          when 'source_thread_binding' then
            'source_thread_binding|' || octet_length(message_scope_source_thread_binding_id)::text || ':' || message_scope_source_thread_binding_id
        end`
      ),
    messageObjectKindId: text("message_object_kind_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(() =>
        messageKeyDigestSql({
          realmId: "message_realm_id",
          realmVersion: "message_realm_version",
          canonicalizationVersion: "message_canonicalization_version",
          scopeKind: "message_scope_kind",
          scopeSourceAccountId: "message_scope_source_account_id",
          scopeSourceThreadBindingId: "message_scope_source_thread_binding_id",
          objectKindId: "message_object_kind_id",
          externalThreadId: "external_thread_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      ),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterDeclarationRevision: bigint("adapter_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    adapterLoadedByTrustedServiceId: text(
      "adapter_loaded_by_trusted_service_id"
    ).notNull(),
    adapterLoadedAt: timestamp("adapter_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    messageDecisionStrength: inboxV2SourceOccurrenceDecisionStrength(
      "message_decision_strength"
    ).notNull(),
    originKind: inboxV2SourceOccurrenceOriginKind("origin_kind").notNull(),
    rawInboundEventId: text("raw_inbound_event_id"),
    normalizedInboundEventId: text("normalized_inbound_event_id"),
    outboundDispatchAttemptId: text("outbound_dispatch_attempt_id"),
    providerActorKind: inboxV2SourceOccurrenceProviderActorKind(
      "provider_actor_kind"
    ),
    providerActorSourceExternalIdentityId: text(
      "provider_actor_source_external_identity_id"
    ),
    providerSystemActorKindId: text("provider_system_actor_kind_id"),
    providerSystemActorSubject: text("provider_system_actor_subject"),
    direction: inboxV2SourceOccurrenceDirection("direction").notNull(),
    descriptorSchemaId: text("descriptor_schema_id").notNull(),
    descriptorVersion: text("descriptor_version").notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    providerReferenceCount: smallint("provider_reference_count").notNull(),
    descriptorDigestSha256: text("descriptor_digest_sha256").notNull(),
    providerTimestampCount: smallint("provider_timestamp_count").notNull(),
    referencePortabilityKind: inboxV2SourceOccurrenceReferencePortabilityKind(
      "reference_portability_kind"
    ).notNull(),
    referencePortabilityDecisionStrength:
      inboxV2SourceOccurrenceDecisionStrength(
        "reference_portability_decision_strength"
      ).notNull(),
    resolutionState: inboxV2SourceOccurrenceResolutionState("resolution_state")
      .notNull()
      .default("pending"),
    resolvedExternalMessageReferenceId: text(
      "resolved_external_message_reference_id"
    ),
    resolutionCandidateCount: smallint("resolution_candidate_count")
      .notNull()
      .default(sql`0`),
    resolutionCandidateDigestSha256: text("resolution_candidate_digest_sha256"),
    resolutionDiagnosticCodeId: text("resolution_diagnostic_code_id"),
    resolutionDiagnosticRetryable: boolean("resolution_diagnostic_retryable"),
    resolutionDiagnosticCorrelationToken: text(
      "resolution_diagnostic_correlation_token"
    ),
    resolutionDiagnosticSafeOperatorHintId: text(
      "resolution_diagnostic_safe_operator_hint_id"
    ),
    materializedByTrustedServiceId: text(
      "materialized_by_trusted_service_id"
    ).notNull(),
    materializationAuthorizationToken: text(
      "materialization_authorization_token"
    ).notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
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
      name: "inbox_v2_source_occurrences_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_source_occurrences_exact_anchor_unique").on(
      table.tenantId,
      table.id,
      table.externalThreadId,
      table.sourceConnectionId,
      table.sourceAccountId,
      table.sourceThreadBindingId
    ),
    unique("inbox_v2_source_occurrences_actor_evidence_unique").on(
      table.tenantId,
      table.id,
      table.providerActorSourceExternalIdentityId
    ),
    unique("inbox_v2_source_occurrences_resolution_target_unique").on(
      table.tenantId,
      table.id,
      table.revision,
      table.resolutionState,
      table.resolvedExternalMessageReferenceId
    ),
    foreignKey({
      name: "inbox_v2_source_occurrences_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_occurrences_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_thread_mapping_fk",
      columns: [
        table.tenantId,
        table.externalThreadId,
        table.conversationId,
        table.externalThreadRevision
      ],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id,
        inboxV2ExternalThreads.conversationId,
        inboxV2ExternalThreads.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_account_edge_fk",
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
      name: "inbox_v2_source_occurrences_binding_edge_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.externalThreadId,
        table.sourceConnectionId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.externalThreadId,
        inboxV2SourceThreadBindings.sourceConnectionId,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_binding_snapshot_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.bindingRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingSnapshots.tenantId,
        inboxV2SourceThreadBindingSnapshots.bindingId,
        inboxV2SourceThreadBindingSnapshots.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_scope_account_fk",
      columns: [
        table.tenantId,
        table.messageScopeSourceAccountId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        sourceAccounts.tenantId,
        sourceAccounts.id,
        sourceAccounts.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_scope_binding_fk",
      columns: [
        table.tenantId,
        table.messageScopeSourceThreadBindingId,
        table.externalThreadId,
        table.sourceConnectionId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.externalThreadId,
        inboxV2SourceThreadBindings.sourceConnectionId,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_raw_connection_fk",
      columns: [
        table.tenantId,
        table.rawInboundEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_raw_account_fk",
      columns: [table.tenantId, table.rawInboundEventId, table.sourceAccountId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_normalized_connection_fk",
      columns: [
        table.tenantId,
        table.normalizedInboundEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_normalized_account_fk",
      columns: [
        table.tenantId,
        table.normalizedInboundEventId,
        table.sourceAccountId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrences_provider_identity_fk",
      columns: [table.tenantId, table.providerActorSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    check(
      "inbox_v2_source_occurrences_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_occurrence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_source_occurrences_message_scope_check",
      sql`((
          ${table.messageScopeKind} = 'provider_thread'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is null
          and ${table.messageDecisionStrength} = 'authoritative'
        ) or (
          ${table.messageScopeKind} = 'source_account'
          and ${table.messageScopeSourceAccountId} = ${table.sourceAccountId}
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_thread_binding'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} = ${table.sourceThreadBindingId}
        )) is true`
    ),
    check(
      "inbox_v2_source_occurrences_message_declaration_check",
      sql`${catalogIdSql(table.messageRealmId)}
        and ${versionTokenSql(table.messageRealmVersion)}
        and ${versionTokenSql(table.messageCanonicalizationVersion)}
        and ${catalogIdSql(table.messageObjectKindId)}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}
        and ${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.adapterLoadedByTrustedServiceId)}
        and isfinite(${table.adapterLoadedAt})
        and ${table.adapterLoadedAt} <= ${table.recordedAt}`
    ),
    check(
      "inbox_v2_source_occurrences_origin_check",
      sql`(
          ${table.originKind} in ('webhook', 'stream', 'poll', 'history')
          and ${table.rawInboundEventId} is not null
          and ${table.normalizedInboundEventId} is not null
          and ${table.outboundDispatchAttemptId} is null
        ) or (
          ${table.originKind} = 'provider_echo'
          and ${table.rawInboundEventId} is not null
          and ${table.normalizedInboundEventId} is not null
          and ${table.outboundDispatchAttemptId} is null
          and ${table.direction} = 'outbound'
          and ${table.providerActorKind} is null
        ) or (
          ${table.originKind} = 'provider_response'
          and ${table.rawInboundEventId} is null
          and ${table.normalizedInboundEventId} is null
          and ${table.outboundDispatchAttemptId} is not null
          and ${table.direction} = 'outbound'
          and ${table.providerActorKind} is null
        )`
    ),
    check(
      "inbox_v2_source_occurrences_provider_actor_check",
      sql`((
          ${table.providerActorKind} = 'source_external_identity'
          and ${table.providerActorSourceExternalIdentityId} is not null
          and ${table.providerSystemActorKindId} is null
          and ${table.providerSystemActorSubject} is null
          and ${table.direction} in ('inbound', 'outbound')
        ) or (
          ${table.providerActorKind} = 'provider_system'
          and ${table.providerActorSourceExternalIdentityId} is null
          and ${catalogIdSql(table.providerSystemActorKindId)}
          and ${opaqueSubjectSql(table.providerSystemActorSubject)}
          and ${table.direction} = 'system'
        ) or (
          ${table.providerActorKind} is null
          and ${table.providerActorSourceExternalIdentityId} is null
          and ${table.providerSystemActorKindId} is null
          and ${table.providerSystemActorSubject} is null
          and ${table.direction} = 'outbound'
          and ${table.originKind} in ('provider_echo', 'provider_response')
        )) is true`
    ),
    check(
      "inbox_v2_source_occurrences_descriptor_check",
      sql`${catalogIdSql(table.descriptorSchemaId)}
        and ${versionTokenSql(table.descriptorVersion)}
        and ${table.capabilityRevision} >= 1
        and ${table.providerReferenceCount} between 1 and 32
        and ${table.providerTimestampCount} between 0 and 16
        and ${sha256DigestSql(table.descriptorDigestSha256)}`
    ),
    check(
      "inbox_v2_source_occurrences_portability_check",
      sql`${table.referencePortabilityKind} = 'binding_only'
        or ${table.referencePortabilityDecisionStrength} = 'authoritative'`
    ),
    check(
      "inbox_v2_source_occurrences_resolution_check",
      sql`((
          ${table.resolutionState} = 'pending'
          and ${table.revision} = 1
          and ${table.resolvedExternalMessageReferenceId} is null
          and ${table.resolutionCandidateCount} = 0
          and ${table.resolutionCandidateDigestSha256} is null
          and ${catalogIdSql(table.resolutionDiagnosticCodeId)}
          and ${table.resolutionDiagnosticRetryable} is not null
          and ${routingTokenSql(table.resolutionDiagnosticCorrelationToken)}
        ) or (
          ${table.resolutionState} = 'resolved'
          and ${table.revision} >= 2
          and ${table.resolvedExternalMessageReferenceId} is not null
          and ${table.resolutionCandidateCount} = 0
          and ${table.resolutionCandidateDigestSha256} is null
          and ${table.resolutionDiagnosticCodeId} is null
          and ${table.resolutionDiagnosticRetryable} is null
          and ${table.resolutionDiagnosticCorrelationToken} is null
          and ${table.resolutionDiagnosticSafeOperatorHintId} is null
        ) or (
          ${table.resolutionState} = 'conflicted'
          and ${table.revision} >= 2
          and ${table.resolvedExternalMessageReferenceId} is null
          and ${table.resolutionCandidateCount} between 2 and 100
          and ${sha256DigestSql(table.resolutionCandidateDigestSha256)}
          and ${catalogIdSql(table.resolutionDiagnosticCodeId)}
          and ${table.resolutionDiagnosticRetryable} is not null
          and ${routingTokenSql(table.resolutionDiagnosticCorrelationToken)}
        )) and (
          ${table.resolutionDiagnosticSafeOperatorHintId} is null
          or ${catalogIdSql(table.resolutionDiagnosticSafeOperatorHintId)}
        )`
    ),
    check(
      "inbox_v2_source_occurrences_materialization_check",
      sql`${table.materializedByTrustedServiceId} = ${table.adapterLoadedByTrustedServiceId}
        and ${catalogIdSql(table.materializedByTrustedServiceId)}
        and ${routingTokenSql(table.materializationAuthorizationToken)}`
    ),
    check(
      "inbox_v2_source_occurrences_fence_check",
      sql`${table.externalThreadRevision} = 1
        and ${table.bindingRevision} >= 1
        and ${table.bindingGeneration} >= 1
        and ${table.accountIdentityRevision} >= 1
        and ${table.accountGeneration} >= 1
        and ${sha256DigestSql(table.accountCanonicalKeyDigestSha256)}
        and ${sha256DigestSql(table.messageKeyDigestSha256)}`
    ),
    check(
      "inbox_v2_source_occurrences_timestamps_check",
      sql`isfinite(${table.observedAt})
        and isfinite(${table.recordedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.observedAt} <= ${table.recordedAt}
        and ${table.recordedAt} = ${table.createdAt}
        and ${table.createdAt} <= ${table.updatedAt}
        and (${table.revision} <> 1 or ${table.createdAt} = ${table.updatedAt})`
    ),
    index("inbox_v2_source_occurrences_tenant_message_key_idx").on(
      table.tenantId,
      table.messageKeyDigestSha256,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_binding_idx").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.recordedAt,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.recordedAt,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_pending_idx").on(
      table.tenantId,
      table.resolutionState,
      table.recordedAt,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_actor_idx").on(
      table.tenantId,
      table.providerActorSourceExternalIdentityId,
      table.recordedAt,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_raw_idx").on(
      table.tenantId,
      table.rawInboundEventId,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_normalized_idx").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_attempt_idx").on(
      table.tenantId,
      table.outboundDispatchAttemptId,
      table.id
    ),
    index("inbox_v2_source_occurrences_tenant_resolved_reference_idx").on(
      table.tenantId,
      table.resolvedExternalMessageReferenceId,
      table.id
    )
  ]
);

export const inboxV2SourceOccurrenceProviderReferences = pgTable(
  "inbox_v2_source_occurrence_provider_references",
  {
    tenantId: text("tenant_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    kindId: text("kind_id").notNull(),
    subject: text("subject").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_occurrence_provider_references_pk",
      columns: [table.tenantId, table.sourceOccurrenceId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_occurrence_provider_references_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_occurrence_provider_references_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_occurrence_provider_references_kind_unique").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.kindId
    ),
    check(
      "inbox_v2_occurrence_provider_references_values_check",
      sql`${table.ordinal} between 0 and 31
        and ${catalogIdSql(table.kindId)}
        and ${opaqueSubjectSql(table.subject)}`
    ),
    index("inbox_v2_occurrence_provider_references_tenant_kind_idx").on(
      table.tenantId,
      table.kindId,
      table.sourceOccurrenceId,
      table.ordinal
    )
  ]
);

export const inboxV2SourceOccurrenceProviderTimestamps = pgTable(
  "inbox_v2_source_occurrence_provider_timestamps",
  {
    tenantId: text("tenant_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    kindId: text("kind_id").notNull(),
    timestamp: timestamp("timestamp", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_occurrence_provider_timestamps_pk",
      columns: [table.tenantId, table.sourceOccurrenceId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_occurrence_provider_timestamps_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_occurrence_provider_timestamps_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_occurrence_provider_timestamps_kind_unique").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.kindId
    ),
    check(
      "inbox_v2_occurrence_provider_timestamps_values_check",
      sql`${table.ordinal} between 0 and 15
        and ${catalogIdSql(table.kindId)}
        and isfinite(${table.timestamp})`
    ),
    index("inbox_v2_occurrence_provider_timestamps_tenant_kind_idx").on(
      table.tenantId,
      table.kindId,
      table.sourceOccurrenceId,
      table.ordinal
    )
  ]
);

/**
 * Direct-DML safety and deferred bounded children. Every lookup is a bounded
 * primary/unique-key read; no validator scans all occurrences for a tenant.
 */
export const INBOX_V2_SOURCE_OCCURRENCE_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_source_occurrence_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_row public.inbox_v2_source_thread_binding_heads%rowtype;
  snapshot_row public.inbox_v2_source_thread_binding_snapshots%rowtype;
  account_identity_row public.inbox_v2_source_account_identities%rowtype;
  account_snapshot_row public.inbox_v2_source_account_identity_verified_snapshots%rowtype;
  thread_identity_declaration jsonb;
  actor_scope_kind public.inbox_v2_source_identity_scope_kind;
  actor_scope_source_connection_id text;
  actor_scope_source_account_id text;
  actor_stability_kind public.inbox_v2_source_identity_stability_kind;
  actor_ephemeral_raw_event_id text;
  actor_ephemeral_normalized_event_id text;
  actor_declaration_contract_id text;
  actor_declaration_contract_version text;
  actor_declaration_surface_id text;
  actor_declaration_loaded_by_trusted_service_id text;
  actor_declaration_loaded_at timestamptz;
  actor_materialized_at timestamptz;
  actor_created_at timestamptz;
begin
  if new.resolution_state <> 'pending'
     or new.revision <> 1
     or new.created_at <> new.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_occurrence_initial_resolution_invalid';
  end if;

  if new.origin_kind <> 'provider_response' then
    select * into head_row
      from public.inbox_v2_source_thread_binding_heads candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.binding_id = new.source_thread_binding_id
     for share;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_occurrence_binding_head_missing';
    end if;
  end if;

  select * into snapshot_row
    from public.inbox_v2_source_thread_binding_snapshots candidate_row
   where candidate_row.tenant_id = new.tenant_id
     and candidate_row.binding_id = new.source_thread_binding_id
     and candidate_row.revision = new.binding_revision
   for share;

  if not found
     or (
       new.origin_kind <> 'provider_response'
       and (
         head_row.revision <> new.binding_revision
         or head_row.external_thread_id <> new.external_thread_id
         or head_row.source_connection_id <> new.source_connection_id
         or head_row.source_account_id <> new.source_account_id
         or head_row.binding_generation <> new.binding_generation
         or head_row.capability_revision <> new.capability_revision
         or head_row.account_identity_revision <> new.account_identity_revision
         or head_row.account_generation <> new.account_generation
         or head_row.account_canonical_key_digest_sha256 <>
            new.account_canonical_key_digest_sha256
         or head_row.created_at > new.recorded_at
         or head_row.updated_at > new.recorded_at
       )
     )
     or snapshot_row.external_thread_id <> new.external_thread_id
     or snapshot_row.source_connection_id <> new.source_connection_id
     or snapshot_row.source_account_id <> new.source_account_id
     or snapshot_row.binding_generation <> new.binding_generation
     or snapshot_row.capability_revision <> new.capability_revision
     or snapshot_row.account_identity_revision <> new.account_identity_revision
     or snapshot_row.account_generation <> new.account_generation
     or snapshot_row.account_canonical_key_digest_sha256 <>
        new.account_canonical_key_digest_sha256
     or snapshot_row.capability_contract_id <> new.adapter_contract_id
     or snapshot_row.capability_contract_version <> new.adapter_contract_version
     or snapshot_row.capability_surface_id <> new.adapter_surface_id
     or snapshot_row.created_at > new.recorded_at
     or snapshot_row.updated_at > new.recorded_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.source_occurrence_binding_fence_conflict';
  end if;

  if new.origin_kind = 'provider_response' then
    select * into account_snapshot_row
      from public.inbox_v2_source_account_identity_verified_snapshots candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.source_account_id = new.source_account_id
       and candidate_row.identity_revision = new.account_identity_revision
     for share;

    if not found
       or account_snapshot_row.source_connection_id <> new.source_connection_id
       or account_snapshot_row.state <> 'verified'
       or account_snapshot_row.account_generation <> new.account_generation
       or account_snapshot_row.canonical_key_digest_sha256 <>
          new.account_canonical_key_digest_sha256
       or account_snapshot_row.declaration_contract_id <>
          new.adapter_contract_id
       or account_snapshot_row.declaration_contract_version <>
          new.adapter_contract_version
       or account_snapshot_row.declaration_surface_id <>
          new.adapter_surface_id
       or account_snapshot_row.verified_at > new.recorded_at then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.source_occurrence_account_snapshot_fence_conflict';
    end if;
  else
    select * into account_identity_row
      from public.inbox_v2_source_account_identities candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.source_account_id = new.source_account_id
     for share;

    if not found
       or account_identity_row.source_connection_id <> new.source_connection_id
       or account_identity_row.state <> 'verified'
       or account_identity_row.revision <> new.account_identity_revision
       or account_identity_row.account_generation <> new.account_generation
       or account_identity_row.canonical_key_digest_sha256 <>
          new.account_canonical_key_digest_sha256
       or account_identity_row.declaration_contract_id <>
          new.adapter_contract_id
       or account_identity_row.declaration_contract_version <>
          new.adapter_contract_version
       or account_identity_row.declaration_surface_id <>
          new.adapter_surface_id
       or account_identity_row.updated_at > new.recorded_at then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.source_occurrence_account_identity_fence_conflict';
    end if;
  end if;

  select thread_row.identity_declaration
    into thread_identity_declaration
    from public.inbox_v2_external_threads thread_row
   where thread_row.tenant_id = new.tenant_id
     and thread_row.id = new.external_thread_id
     and thread_row.conversation_id = new.conversation_id
     and thread_row.revision = new.external_thread_revision
     and thread_row.created_at <= new.recorded_at
   for share;

  if not found
     or thread_identity_declaration #>> '{adapterContract,contractId}' is distinct from
        new.adapter_contract_id
     or thread_identity_declaration #>> '{adapterContract,contractVersion}' is distinct from
        new.adapter_contract_version
     or thread_identity_declaration #>> '{adapterContract,surfaceId}' is distinct from
        new.adapter_surface_id then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_occurrence_adapter_surface_mismatch';
  end if;

  if new.origin_kind <> 'provider_response' then
    perform 1
      from public.raw_inbound_events raw_event_row
      join public.normalized_inbound_events normalized_event_row
        on normalized_event_row.tenant_id = raw_event_row.tenant_id
       and normalized_event_row.raw_event_id = raw_event_row.id
       and normalized_event_row.source_connection_id =
          raw_event_row.source_connection_id
       and normalized_event_row.source_account_id is not distinct from
          raw_event_row.source_account_id
     where raw_event_row.tenant_id = new.tenant_id
       and raw_event_row.id = new.raw_inbound_event_id
       and raw_event_row.source_connection_id = new.source_connection_id
       and raw_event_row.source_account_id = new.source_account_id
       and normalized_event_row.id = new.normalized_inbound_event_id
       and normalized_event_row.created_at <= new.recorded_at
       and raw_event_row.received_at <= new.recorded_at
     for share of raw_event_row, normalized_event_row;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_occurrence_event_pair_mismatch';
    end if;
  else
    perform 1
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
      join public.inbox_v2_outbound_dispatches dispatch_row
        on dispatch_row.tenant_id = attempt_row.tenant_id
       and dispatch_row.id = attempt_row.dispatch_id
       and dispatch_row.route_id = attempt_row.route_id
       and dispatch_row.message_id = attempt_row.message_id
       and dispatch_row.last_attempt_id = attempt_row.id
      join public.inbox_v2_outbound_routes route_row
        on route_row.tenant_id = attempt_row.tenant_id
       and route_row.id = attempt_row.route_id
       and route_row.source_thread_binding_id = new.source_thread_binding_id
       and route_row.external_thread_id = new.external_thread_id
       and route_row.source_connection_id = new.source_connection_id
       and route_row.source_account_id = new.source_account_id
     where attempt_row.tenant_id = new.tenant_id
       and attempt_row.id = new.outbound_dispatch_attempt_id
       and route_row.adapter_contract_id = new.adapter_contract_id
       and route_row.adapter_contract_version = new.adapter_contract_version
       and route_row.adapter_surface_id = new.adapter_surface_id
       and route_row.binding_revision = snapshot_row.revision
       and route_row.account_generation = snapshot_row.account_generation
       and route_row.binding_generation = snapshot_row.binding_generation
       and route_row.remote_access_revision = snapshot_row.remote_access_revision
       and route_row.administrative_revision =
          snapshot_row.administrative_revision
       and route_row.capability_revision = snapshot_row.capability_revision
       and route_row.route_descriptor_revision =
          snapshot_row.route_descriptor_revision
       and route_row.created_at <= attempt_row.opened_at
       and attempt_row.opened_at <= new.observed_at
     for share of attempt_row, dispatch_row, route_row;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_occurrence_provider_response_chain_mismatch';
    end if;
  end if;

  if new.provider_actor_kind = 'source_external_identity' then
    select
      identity_row.scope_kind,
      identity_row.scope_source_connection_id,
      identity_row.scope_source_account_id,
      identity_row.stability_kind,
      identity_row.ephemeral_raw_inbound_event_id,
      identity_row.ephemeral_normalized_inbound_event_id,
      identity_row.declaration_contract_id,
      identity_row.declaration_contract_version,
      identity_row.declaration_surface_id,
      identity_row.declaration_loaded_by_trusted_service_id,
      identity_row.declaration_loaded_at,
      identity_row.materialized_at,
      identity_row.created_at
    into
      actor_scope_kind,
      actor_scope_source_connection_id,
      actor_scope_source_account_id,
      actor_stability_kind,
      actor_ephemeral_raw_event_id,
      actor_ephemeral_normalized_event_id,
      actor_declaration_contract_id,
      actor_declaration_contract_version,
      actor_declaration_surface_id,
      actor_declaration_loaded_by_trusted_service_id,
      actor_declaration_loaded_at,
      actor_materialized_at,
      actor_created_at
    from public.inbox_v2_source_external_identities identity_row
    where identity_row.tenant_id = new.tenant_id
      and identity_row.id = new.provider_actor_source_external_identity_id
    for share;

    if not found
       or actor_created_at > new.recorded_at
       or actor_declaration_loaded_at > new.recorded_at
       or actor_materialized_at > new.recorded_at
       or (actor_scope_kind = 'source_connection' and
           actor_scope_source_connection_id <> new.source_connection_id)
       or (actor_scope_kind = 'source_account' and
           actor_scope_source_account_id <> new.source_account_id)
       or (
         actor_scope_kind = 'provider'
         and (
           actor_declaration_contract_id <> new.adapter_contract_id
           or actor_declaration_contract_version <> new.adapter_contract_version
           or actor_declaration_surface_id <> new.adapter_surface_id
           or actor_declaration_loaded_by_trusted_service_id <>
              new.adapter_loaded_by_trusted_service_id
         )
       )
       or (
         actor_stability_kind = 'observation_ephemeral'
         and not (
           (
             actor_ephemeral_raw_event_id = new.raw_inbound_event_id
             and actor_ephemeral_normalized_event_id is null
           ) or (
             actor_ephemeral_raw_event_id is null
             and actor_ephemeral_normalized_event_id =
                new.normalized_inbound_event_id
           )
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_occurrence_provider_actor_scope_invalid';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_source_occurrence_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row
       where tenant_row.id = old_row->>'tenant_id'
    ) then
      return old;
    end if;

    if tg_table_name <>
       'inbox_v2_source_occurrences'
       and not exists (
         select 1
           from public.inbox_v2_source_occurrences occurrence_row
          where occurrence_row.tenant_id = old_row->>'tenant_id'
            and occurrence_row.id = old_row->>'source_occurrence_id'
       ) then
      return old;
    end if;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_occurrence_immutable:%s:%s',
      tg_table_name,
      tg_op
    );
end;
$function$;

create or replace function public.inbox_v2_source_occurrence_guard_resolution_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  immutable_old jsonb;
  immutable_new jsonb;
begin
  immutable_old := to_jsonb(old) - array[
    'resolution_state',
    'resolved_external_message_reference_id',
    'resolution_candidate_count',
    'resolution_candidate_digest_sha256',
    'resolution_diagnostic_code_id',
    'resolution_diagnostic_retryable',
    'resolution_diagnostic_correlation_token',
    'resolution_diagnostic_safe_operator_hint_id',
    'message_scope_owner_key',
    'message_key_digest_sha256',
    'revision',
    'updated_at'
  ];
  immutable_new := to_jsonb(new) - array[
    'resolution_state',
    'resolved_external_message_reference_id',
    'resolution_candidate_count',
    'resolution_candidate_digest_sha256',
    'resolution_diagnostic_code_id',
    'resolution_diagnostic_retryable',
    'resolution_diagnostic_correlation_token',
    'resolution_diagnostic_safe_operator_hint_id',
    'message_scope_owner_key',
    'message_key_digest_sha256',
    'revision',
    'updated_at'
  ];

  if immutable_old <> immutable_new
     or old.resolution_state = 'resolved'
     or new.resolution_state = 'pending'
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.source_occurrence_resolution_cas_conflict';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_source_occurrence_children(
  checked_tenant_id text,
  checked_source_occurrence_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  expected_reference_count smallint;
  expected_timestamp_count smallint;
  actual_count bigint;
  minimum_ordinal smallint;
  maximum_ordinal smallint;
begin
  select
    occurrence_row.provider_reference_count,
    occurrence_row.provider_timestamp_count
  into expected_reference_count, expected_timestamp_count
  from public.inbox_v2_source_occurrences occurrence_row
  where occurrence_row.tenant_id = checked_tenant_id
    and occurrence_row.id = checked_source_occurrence_id;

  if not found then
    return;
  end if;

  select count(*), min(reference_row.ordinal), max(reference_row.ordinal)
  into actual_count, minimum_ordinal, maximum_ordinal
  from public.inbox_v2_source_occurrence_provider_references reference_row
  where reference_row.tenant_id = checked_tenant_id
    and reference_row.source_occurrence_id = checked_source_occurrence_id;

  if actual_count <> expected_reference_count
     or minimum_ordinal <> 0
     or maximum_ordinal <> expected_reference_count - 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_occurrence_provider_references_invalid';
  end if;

  select count(*), min(timestamp_row.ordinal), max(timestamp_row.ordinal)
  into actual_count, minimum_ordinal, maximum_ordinal
  from public.inbox_v2_source_occurrence_provider_timestamps timestamp_row
  where timestamp_row.tenant_id = checked_tenant_id
    and timestamp_row.source_occurrence_id = checked_source_occurrence_id;

  if actual_count <> expected_timestamp_count
     or (
       expected_timestamp_count = 0
       and (minimum_ordinal is not null or maximum_ordinal is not null)
     )
     or (
       expected_timestamp_count > 0
       and (
         minimum_ordinal <> 0
         or maximum_ordinal <> expected_timestamp_count - 1
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_occurrence_provider_timestamps_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_source_occurrence_deferred_children()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_table_name = 'inbox_v2_source_occurrences'
     and tg_op = 'INSERT'
     and exists (
       select 1 from public.tenants tenant_row
        where tenant_row.id = new_row->>'tenant_id'
     )
     and not exists (
       select 1
         from public.inbox_v2_source_occurrences occurrence_row
        where occurrence_row.tenant_id = new_row->>'tenant_id'
          and occurrence_row.id = new_row->>'id'
          and (
            (occurrence_row.resolution_state = 'pending'
              and occurrence_row.revision = 1)
            or (
              new_row->>'origin_kind' = 'provider_response'
              and new_row->>'direction' = 'outbound'
              and new_row->>'resolution_state' = 'pending'
              and (new_row->>'revision')::bigint = 1
              and new_row->>'resolved_external_message_reference_id' is null
              and occurrence_row.origin_kind = 'provider_response'
              and occurrence_row.direction = 'outbound'
              and occurrence_row.outbound_dispatch_attempt_id is not null
              and occurrence_row.resolution_state = 'resolved'
              and occurrence_row.revision = 2
              and occurrence_row.resolved_external_message_reference_id
                is not null
              and occurrence_row.resolution_candidate_count = 0
              and occurrence_row.resolution_candidate_digest_sha256 is null
              and occurrence_row.resolution_diagnostic_code_id is null
              and occurrence_row.resolution_diagnostic_retryable is null
              and occurrence_row.resolution_diagnostic_correlation_token is null
              and occurrence_row.resolution_diagnostic_safe_operator_hint_id
                is null
              and 1 = (
                select count(*)
                  from public.inbox_v2_source_occurrence_resolution_transitions
                    transition_row
                  join public.inbox_v2_external_message_references reference_row
                    on reference_row.tenant_id = transition_row.tenant_id
                   and reference_row.id =
                     transition_row.resolved_external_message_reference_id
                 where transition_row.tenant_id = occurrence_row.tenant_id
                   and transition_row.source_occurrence_id = occurrence_row.id
                   and transition_row.expected_revision = 1
                   and transition_row.resulting_revision = 2
                   and transition_row.from_state = 'pending'
                   and transition_row.to_state = 'resolved'
                   and transition_row.resolved_external_message_reference_id =
                     occurrence_row.resolved_external_message_reference_id
                   and transition_row.candidate_count = 0
                   and transition_row.candidates_digest_sha256 is null
                   and transition_row.diagnostic_code_id is null
                   and transition_row.diagnostic_retryable is null
                   and transition_row.diagnostic_correlation_token is null
                   and transition_row.diagnostic_safe_operator_hint_id is null
                   and transition_row.resolver_trusted_service_id =
                     occurrence_row.adapter_loaded_by_trusted_service_id
                   and transition_row.changed_at = occurrence_row.updated_at
                   and transition_row.revision = 1
                   and reference_row.realm_id = occurrence_row.message_realm_id
                   and reference_row.realm_version =
                     occurrence_row.message_realm_version
                   and reference_row.canonicalization_version =
                     occurrence_row.message_canonicalization_version
                   and reference_row.scope_kind::text =
                     occurrence_row.message_scope_kind::text
                   and reference_row.scope_source_account_id is not distinct from
                     occurrence_row.message_scope_source_account_id
                   and reference_row.scope_source_thread_binding_id
                     is not distinct from
                     occurrence_row.message_scope_source_thread_binding_id
                   and reference_row.object_kind_id =
                     occurrence_row.message_object_kind_id
                   and reference_row.external_thread_id =
                     occurrence_row.external_thread_id
                   and reference_row.canonical_external_subject =
                     occurrence_row.canonical_external_subject
                   and reference_row.message_key_digest_sha256 =
                     occurrence_row.message_key_digest_sha256
                   and not exists (
                     select 1
                       from public.inbox_v2_source_occurrence_resolution_candidates
                         candidate_row
                      where candidate_row.tenant_id = transition_row.tenant_id
                        and candidate_row.transition_id = transition_row.id
                        and candidate_row.source_occurrence_id =
                          transition_row.source_occurrence_id
                        and candidate_row.resulting_revision =
                          transition_row.resulting_revision
                   )
              )
            )
          )
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_occurrence_initial_commit_required';
  end if;

  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_source_occurrence_children(
      old_row->>'tenant_id',
      coalesce(old_row->>'id', old_row->>'source_occurrence_id')
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_source_occurrence_children(
      new_row->>'tenant_id',
      coalesce(new_row->>'id', new_row->>'source_occurrence_id')
    );
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_source_occurrences_insert_guard_trigger
before insert on public.inbox_v2_source_occurrences
for each row execute function public.inbox_v2_source_occurrence_guard_insert();

create trigger inbox_v2_source_occurrences_immutable_trigger
before delete on public.inbox_v2_source_occurrences
for each row execute function public.inbox_v2_source_occurrence_reject_immutable();

create trigger inbox_v2_source_occurrences_resolution_update_guard_trigger
before update on public.inbox_v2_source_occurrences
for each row execute function public.inbox_v2_source_occurrence_guard_resolution_update();

create trigger inbox_v2_occurrence_provider_references_immutable_trigger
before update or delete on public.inbox_v2_source_occurrence_provider_references
for each row execute function public.inbox_v2_source_occurrence_reject_immutable();

create trigger inbox_v2_occurrence_provider_timestamps_immutable_trigger
before update or delete on public.inbox_v2_source_occurrence_provider_timestamps
for each row execute function public.inbox_v2_source_occurrence_reject_immutable();

create constraint trigger inbox_v2_source_occurrences_children_constraint
after insert on public.inbox_v2_source_occurrences
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_deferred_children();

create constraint trigger inbox_v2_occurrence_provider_references_constraint
after insert or update or delete
on public.inbox_v2_source_occurrence_provider_references
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_deferred_children();

create constraint trigger inbox_v2_occurrence_provider_timestamps_constraint
after insert or update or delete
on public.inbox_v2_source_occurrence_provider_timestamps
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_deferred_children();
`;

function catalogIdSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) <= 256 and (
    (
      ${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 160
    ) or (
      ${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 80
      and char_length(split_part(${column}, ':', 3)) <= 160
      and split_part(${column}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )), false)`;
}

function versionTokenSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^v[1-9][0-9]*$', false)`;
}

function opaqueSubjectSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 1 and 1024
    and ${column} ~ '[^[:space:]]'
    and ${column} !~ '[\\x00-\\x1F\\x7F]'), false)`;
}

function routingTokenSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function sha256DigestSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^[a-f0-9]{64}$', false)`;
}
