import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
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
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  employees,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";
import { inboxV2ExternalThreads } from "./external-thread";
import {
  inboxV2SourceAccountIdentityAliases,
  inboxV2SourceAccountIdentityState,
  inboxV2SourceAccountIdentityTransitions,
  inboxV2SourceAccountIdentityVerifiedSnapshots
} from "./source-account-identity";

export const inboxV2SourceThreadBindingEvidenceKind = pgEnum(
  "inbox_v2_source_thread_binding_evidence_kind",
  [
    "raw_inbound_event",
    "normalized_inbound_event",
    "source_account_identity_transition",
    "source_account_identity_alias",
    "provider_roster_evidence",
    "provider_roster_member_evidence"
  ]
);

export const inboxV2SourceThreadBindingRemoteAccessState = pgEnum(
  "inbox_v2_source_thread_binding_remote_access_state",
  ["observed", "active", "left", "removed"]
);

export const inboxV2SourceThreadBindingRemoteEvidenceAuthority = pgEnum(
  "inbox_v2_source_thread_binding_remote_evidence_authority",
  [
    "direct_observation",
    "explicit_terminal_event",
    "authoritative_snapshot",
    "advisory_snapshot",
    "migration_observed"
  ]
);

export const inboxV2SourceThreadBindingAdministrativeState = pgEnum(
  "inbox_v2_source_thread_binding_administrative_state",
  ["enabled", "disabled"]
);

export const inboxV2SourceThreadBindingRuntimeHealthState = pgEnum(
  "inbox_v2_source_thread_binding_runtime_health_state",
  ["unknown", "ready", "degraded", "unavailable"]
);

export const inboxV2SourceThreadBindingHistorySyncState = pgEnum(
  "inbox_v2_source_thread_binding_history_sync_state",
  [
    "unsupported",
    "not_started",
    "backfilling",
    "catching_up",
    "live",
    "paused",
    "failed"
  ]
);

export const inboxV2SourceThreadBindingReferencePortability = pgEnum(
  "inbox_v2_source_thread_binding_reference_portability",
  ["not_applicable", "binding_only", "external_thread", "provider_global"]
);

export const inboxV2SourceThreadBindingCapabilityState = pgEnum(
  "inbox_v2_source_thread_binding_capability_state",
  ["supported", "unsupported", "unknown", "temporarily_unavailable", "expired"]
);

export const inboxV2SourceThreadBindingTransitionKind = pgEnum(
  "inbox_v2_source_thread_binding_transition_kind",
  [
    "remote_access",
    "administrative",
    "runtime_health",
    "history_sync",
    "capabilities",
    "route_descriptor",
    "account_generation",
    "provider_access"
  ]
);

export const inboxV2SourceThreadBindingTransitionActorKind = pgEnum(
  "inbox_v2_source_thread_binding_transition_actor_kind",
  ["employee", "trusted_service"]
);

export const inboxV2SourceThreadBindingAuthorizationEffect = pgEnum(
  "inbox_v2_source_thread_binding_authorization_effect",
  ["allow", "deny"]
);

/**
 * A bounded evidence set is created before the aggregate row that consumes it.
 * Reference rows below carry typed foreign keys; there is deliberately no
 * `kind + opaque_id` escape hatch. Provider-roster references are added only
 * when DB002 coherence persists those authorities.
 */
export const inboxV2SourceThreadBindingEvidenceSets = pgTable(
  "inbox_v2_source_thread_binding_evidence_sets",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    referenceCount: smallint("reference_count").notNull(),
    orderedReferenceDigestSha256: text(
      "ordered_reference_digest_sha256"
    ).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_evidence_sets_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_sets_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_sets_owner_fk",
      columns: [
        table.tenantId,
        table.bindingId,
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
    unique("inbox_v2_binding_evidence_sets_binding_target_unique").on(
      table.tenantId,
      table.id,
      table.bindingId
    ),
    unique("inbox_v2_binding_evidence_sets_account_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    unique("inbox_v2_binding_evidence_sets_exact_target_unique").on(
      table.tenantId,
      table.id,
      table.bindingId,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    check(
      "inbox_v2_binding_evidence_sets_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_thread_binding_evidence_set:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_binding_evidence_sets_bounds_check",
      sql`${table.referenceCount} between 1 and 32
        and ${sha256DigestSql(table.orderedReferenceDigestSha256)}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_binding_evidence_sets_tenant_created_idx").on(
      table.tenantId,
      table.bindingId,
      table.createdAt.desc(),
      table.id
    )
  ]
);

export const inboxV2SourceThreadBindingEvidenceReferences = pgTable(
  "inbox_v2_source_thread_binding_evidence_references",
  {
    tenantId: text("tenant_id").notNull(),
    evidenceSetId: text("evidence_set_id").notNull(),
    bindingId: text("binding_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    kind: inboxV2SourceThreadBindingEvidenceKind("kind").notNull(),
    rawInboundEventId: text("raw_inbound_event_id"),
    normalizedInboundEventId: text("normalized_inbound_event_id"),
    sourceAccountIdentityTransitionId: text(
      "source_account_identity_transition_id"
    ),
    sourceAccountIdentityTransitionResultingRevision: bigint(
      "source_account_identity_transition_resulting_revision",
      { mode: "bigint" }
    ),
    sourceAccountIdentityTransitionResultingGeneration: bigint(
      "source_account_identity_transition_resulting_generation",
      { mode: "bigint" }
    ),
    sourceAccountIdentityAliasId: text("source_account_identity_alias_id"),
    sourceAccountIdentityAliasExpectedRevision: bigint(
      "source_account_identity_alias_expected_revision",
      { mode: "bigint" }
    ),
    sourceAccountIdentityAliasExpectedGeneration: bigint(
      "source_account_identity_alias_expected_generation",
      { mode: "bigint" }
    ),
    sourceAccountIdentityAliasTargetState: inboxV2SourceAccountIdentityState(
      "source_account_identity_alias_target_state"
    ),
    sourceAccountIdentityAliasCanonicalKeyDigestSha256: text(
      "source_account_identity_alias_canonical_key_digest_sha256"
    ),
    providerRosterEvidenceId: text("provider_roster_evidence_id"),
    providerRosterMemberEvidenceId: text("provider_roster_member_evidence_id"),
    referenceKeyDigestSha256: text("reference_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(
        () =>
          sql`encode(
          sha256(
            replace(
              case kind
                when 'raw_inbound_event' then 'raw_inbound_event'
                when 'normalized_inbound_event' then 'normalized_inbound_event'
                when 'source_account_identity_transition' then
                  'source_account_identity_transition'
                when 'source_account_identity_alias' then
                  'source_account_identity_alias'
                when 'provider_roster_evidence' then
                  'provider_roster_evidence'
                when 'provider_roster_member_evidence' then
                  'provider_roster_member_evidence'
              end || ':' || coalesce(
                raw_inbound_event_id,
                normalized_inbound_event_id,
                source_account_identity_transition_id,
                source_account_identity_alias_id,
                provider_roster_evidence_id,
                provider_roster_member_evidence_id
              ),
              chr(92),
              chr(92) || chr(92)
            )::bytea
          ),
          'hex'
        )`
      )
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_evidence_references_pk",
      columns: [table.tenantId, table.evidenceSetId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_set_fk",
      columns: [
        table.tenantId,
        table.evidenceSetId,
        table.bindingId,
        table.sourceConnectionId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId,
        inboxV2SourceThreadBindingEvidenceSets.sourceConnectionId,
        inboxV2SourceThreadBindingEvidenceSets.sourceAccountId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_raw_fk",
      columns: [table.tenantId, table.rawInboundEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_raw_connection_fk",
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
      name: "inbox_v2_binding_evidence_references_raw_account_fk",
      columns: [table.tenantId, table.rawInboundEventId, table.sourceAccountId],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_normalized_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_normalized_connection_fk",
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
      name: "inbox_v2_binding_evidence_references_normalized_account_fk",
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
      name: "inbox_v2_binding_evidence_references_identity_transition_fk",
      columns: [
        table.tenantId,
        table.sourceAccountIdentityTransitionId,
        table.sourceAccountId,
        table.sourceAccountIdentityTransitionResultingRevision,
        table.sourceAccountIdentityTransitionResultingGeneration
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityTransitions.tenantId,
        inboxV2SourceAccountIdentityTransitions.id,
        inboxV2SourceAccountIdentityTransitions.sourceAccountId,
        inboxV2SourceAccountIdentityTransitions.resultingRevision,
        inboxV2SourceAccountIdentityTransitions.resultingAccountGeneration
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_evidence_references_identity_alias_fk",
      columns: [
        table.tenantId,
        table.sourceAccountIdentityAliasId,
        table.sourceAccountId,
        table.sourceAccountIdentityAliasExpectedRevision,
        table.sourceAccountIdentityAliasExpectedGeneration,
        table.sourceAccountIdentityAliasTargetState,
        table.sourceAccountIdentityAliasCanonicalKeyDigestSha256
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityAliases.tenantId,
        inboxV2SourceAccountIdentityAliases.id,
        inboxV2SourceAccountIdentityAliases.canonicalSourceAccountId,
        inboxV2SourceAccountIdentityAliases.expectedAccountIdentityRevision,
        inboxV2SourceAccountIdentityAliases.expectedAccountGeneration,
        inboxV2SourceAccountIdentityAliases.targetIdentityState,
        inboxV2SourceAccountIdentityAliases.canonicalKeyDigestSha256
      ]
    }),
    check(
      "inbox_v2_binding_evidence_references_kind_xor_check",
      evidenceReferenceKindSql(table)
    ),
    check(
      "inbox_v2_binding_evidence_references_ordinal_check",
      sql`${table.ordinal} between 0 and 31`
    ),
    unique("inbox_v2_binding_evidence_references_value_unique").on(
      table.tenantId,
      table.evidenceSetId,
      table.referenceKeyDigestSha256
    ),
    check(
      "inbox_v2_binding_evidence_references_digest_check",
      sha256DigestSql(table.referenceKeyDigestSha256)
    ),
    index("inbox_v2_binding_evidence_references_tenant_kind_idx").on(
      table.tenantId,
      table.kind,
      table.evidenceSetId,
      table.ordinal
    )
  ]
);

/** Stable `(ExternalThread, SourceAccount)` anchor. */
export const inboxV2SourceThreadBindings = pgTable(
  "inbox_v2_source_thread_bindings",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_thread_bindings_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_bindings_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_bindings_thread_fk",
      columns: [table.tenantId, table.externalThreadId],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_bindings_account_edge_fk",
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
      name: "inbox_v2_source_thread_bindings_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    unique("inbox_v2_source_thread_bindings_thread_account_unique").on(
      table.tenantId,
      table.externalThreadId,
      table.sourceAccountId
    ),
    unique("inbox_v2_source_thread_bindings_owner_account_unique").on(
      table.tenantId,
      table.id,
      table.sourceAccountId
    ),
    unique("inbox_v2_source_thread_bindings_owner_target_unique").on(
      table.tenantId,
      table.id,
      table.externalThreadId,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    check(
      "inbox_v2_source_thread_bindings_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_thread_binding:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_source_thread_bindings_created_at_check",
      sql`isfinite(${table.createdAt})`
    ),
    index("inbox_v2_source_thread_bindings_tenant_thread_idx").on(
      table.tenantId,
      table.externalThreadId,
      table.sourceAccountId,
      table.id
    ),
    index("inbox_v2_source_thread_bindings_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.externalThreadId,
      table.id
    )
  ]
);

/** Append-only membership/access episodes; closure is the only revision-2 write. */
export const inboxV2SourceThreadBindingRemoteAccessEpisodes = pgTable(
  "inbox_v2_source_thread_binding_remote_access_episodes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),
    state: inboxV2SourceThreadBindingRemoteAccessState("state").notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    endedAt: timestamp("ended_at", {
      withTimezone: true,
      precision: 3
    }),
    startEvidenceSetId: text("start_evidence_set_id").notNull(),
    endEvidenceSetId: text("end_evidence_set_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_remote_access_episodes_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_binding_remote_access_episodes_binding_fk",
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_remote_access_episodes_start_evidence_fk",
      columns: [table.tenantId, table.startEvidenceSetId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_remote_access_episodes_end_evidence_fk",
      columns: [table.tenantId, table.endEvidenceSetId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    unique("inbox_v2_binding_remote_access_episodes_head_target_unique").on(
      table.tenantId,
      table.bindingId,
      table.id,
      table.state,
      table.startedAt,
      table.revision
    ),
    uniqueIndex("inbox_v2_binding_remote_access_episodes_one_open_unique")
      .on(table.tenantId, table.bindingId)
      .where(sql`${table.endedAt} is null`),
    check(
      "inbox_v2_binding_remote_access_episodes_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_thread_binding_remote_access_episode:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_binding_remote_access_episodes_open_closed_check",
      sql`(
        ${table.endedAt} is null
        and ${table.endEvidenceSetId} is null
        and ${table.revision} = 1
        and ${table.updatedAt} = ${table.startedAt}
      ) or (
        ${table.endedAt} is not null
        and ${table.endEvidenceSetId} is not null
        and ${table.revision} = 2
        and ${table.updatedAt} = ${table.endedAt}
        and ${table.endedAt} >= ${table.startedAt}
      )`
    ),
    check(
      "inbox_v2_binding_remote_access_episodes_timestamps_check",
      sql`isfinite(${table.startedAt})
        and isfinite(${table.updatedAt})
        and (${table.endedAt} is null or isfinite(${table.endedAt}))`
    ),
    index("inbox_v2_binding_remote_access_episodes_tenant_history_idx").on(
      table.tenantId,
      table.bindingId,
      table.startedAt.desc(),
      table.id
    )
  ]
);

/**
 * Compact current head. Large role/capability/route-attribute collections are
 * stored in revision-keyed children so list reads do not load unbounded JSON.
 */
export const inboxV2SourceThreadBindingHeads = pgTable(
  "inbox_v2_source_thread_binding_heads",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    accountIdentityRevision: bigint("account_identity_revision", {
      mode: "bigint"
    }).notNull(),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
    accountIdentityState: inboxV2SourceAccountIdentityState(
      "account_identity_state"
    )
      .notNull()
      .default("verified"),
    accountCanonicalKeyDigestSha256: text(
      "account_canonical_key_digest_sha256"
    ).notNull(),
    accountIdentityTrustedServiceId: text(
      "account_identity_trusted_service_id"
    ).notNull(),
    accountVerifiedAt: timestamp("account_verified_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    accountVerificationEvidenceSetId: text(
      "account_verification_evidence_set_id"
    ).notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    currentRemoteAccessEpisodeId: text(
      "current_remote_access_episode_id"
    ).notNull(),
    currentRemoteAccessEpisodeRevision: bigint(
      "current_remote_access_episode_revision",
      { mode: "bigint" }
    )
      .notNull()
      .default(sql`1`),
    remoteAccessState: inboxV2SourceThreadBindingRemoteAccessState(
      "remote_access_state"
    ).notNull(),
    remoteAccessEvidenceAuthority:
      inboxV2SourceThreadBindingRemoteEvidenceAuthority(
        "remote_access_evidence_authority"
      ).notNull(),
    remoteAccessRevision: bigint("remote_access_revision", {
      mode: "bigint"
    }).notNull(),
    remoteAccessSince: timestamp("remote_access_since", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    remoteAccessEvidenceSetId: text("remote_access_evidence_set_id").notNull(),
    administrativeState: inboxV2SourceThreadBindingAdministrativeState(
      "administrative_state"
    ).notNull(),
    administrativeRevision: bigint("administrative_revision", {
      mode: "bigint"
    }).notNull(),
    administrativeChangedAt: timestamp("administrative_changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    runtimeHealthState: inboxV2SourceThreadBindingRuntimeHealthState(
      "runtime_health_state"
    ).notNull(),
    runtimeHealthRevision: bigint("runtime_health_revision", {
      mode: "bigint"
    }).notNull(),
    runtimeHealthCheckedAt: timestamp("runtime_health_checked_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    runtimeDiagnosticCodeId: text("runtime_diagnostic_code_id"),
    runtimeDiagnosticRetryable: boolean("runtime_diagnostic_retryable"),
    runtimeDiagnosticCorrelationToken: text(
      "runtime_diagnostic_correlation_token"
    ),
    runtimeDiagnosticSafeOperatorHintId: text(
      "runtime_diagnostic_safe_operator_hint_id"
    ),
    historySyncState:
      inboxV2SourceThreadBindingHistorySyncState(
        "history_sync_state"
      ).notNull(),
    historySyncRevision: bigint("history_sync_revision", {
      mode: "bigint"
    }).notNull(),
    historyReceiveCursor: text("history_receive_cursor"),
    historyCursor: text("history_cursor"),
    historyProviderWatermark: text("history_provider_watermark"),
    historyLastDurableRawEventId: text("history_last_durable_raw_event_id"),
    historyUpdatedAt: timestamp("history_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    historyDiagnosticCodeId: text("history_diagnostic_code_id"),
    historyDiagnosticRetryable: boolean("history_diagnostic_retryable"),
    historyDiagnosticCorrelationToken: text(
      "history_diagnostic_correlation_token"
    ),
    historyDiagnosticSafeOperatorHintId: text(
      "history_diagnostic_safe_operator_hint_id"
    ),
    providerAccessRevision: bigint("provider_access_revision", {
      mode: "bigint"
    }).notNull(),
    providerRoleCount: smallint("provider_role_count").notNull(),
    providerRolesDigestSha256: text("provider_roles_digest_sha256").notNull(),
    providerAccessEvidenceSetId: text(
      "provider_access_evidence_set_id"
    ).notNull(),
    providerAccessObservedAt: timestamp("provider_access_observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    capabilityContractId: text("capability_contract_id").notNull(),
    capabilityContractVersion: text("capability_contract_version").notNull(),
    capabilityDeclarationRevision: bigint("capability_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    capabilitySurfaceId: text("capability_surface_id").notNull(),
    capabilityLoadedByTrustedServiceId: text(
      "capability_loaded_by_trusted_service_id"
    ).notNull(),
    capabilityLoadedAt: timestamp("capability_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    capabilityEntryCount: smallint("capability_entry_count").notNull(),
    capabilitySemanticDigestSha256: text(
      "capability_semantic_digest_sha256"
    ).notNull(),
    capabilityCapturedAt: timestamp("capability_captured_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    routeContractId: text("route_contract_id").notNull(),
    routeContractVersion: text("route_contract_version").notNull(),
    routeDeclarationRevision: bigint("route_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    routeSurfaceId: text("route_surface_id").notNull(),
    routeLoadedByTrustedServiceId: text(
      "route_loaded_by_trusted_service_id"
    ).notNull(),
    routeLoadedAt: timestamp("route_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    routeDescriptorSchemaId: text("route_descriptor_schema_id").notNull(),
    routeDescriptorVersion: text("route_descriptor_version").notNull(),
    routeDescriptorRevision: bigint("route_descriptor_revision", {
      mode: "bigint"
    }).notNull(),
    routeDestinationKindId: text("route_destination_kind_id").notNull(),
    routeDestinationSubject: text("route_destination_subject").notNull(),
    routeDescriptorDigestSha256: text(
      "route_descriptor_digest_sha256"
    ).notNull(),
    routeAttributeCount: smallint("route_attribute_count").notNull(),
    routeAttributesDigestSha256: text(
      "route_attributes_digest_sha256"
    ).notNull(),
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
      name: "inbox_v2_source_thread_binding_heads_pk",
      columns: [table.tenantId, table.bindingId]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_binding_fk",
      columns: [
        table.tenantId,
        table.bindingId,
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
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_account_snapshot_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration,
        table.accountIdentityState,
        table.accountCanonicalKeyDigestSha256,
        table.accountIdentityTrustedServiceId,
        table.accountVerifiedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityVerifiedSnapshots.tenantId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.sourceAccountId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.revision,
        inboxV2SourceAccountIdentityVerifiedSnapshots.accountGeneration,
        inboxV2SourceAccountIdentityVerifiedSnapshots.state,
        inboxV2SourceAccountIdentityVerifiedSnapshots.canonicalKeyDigestSha256,
        inboxV2SourceAccountIdentityVerifiedSnapshots.declarationLoadedByTrustedServiceId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.verifiedDecisionDecidedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_current_episode_fk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.currentRemoteAccessEpisodeId,
        table.remoteAccessState,
        table.remoteAccessSince,
        table.currentRemoteAccessEpisodeRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingRemoteAccessEpisodes.tenantId,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.bindingId,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.id,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.state,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.startedAt,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_account_evidence_fk",
      columns: [
        table.tenantId,
        table.accountVerificationEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_remote_evidence_fk",
      columns: [
        table.tenantId,
        table.remoteAccessEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_provider_evidence_fk",
      columns: [
        table.tenantId,
        table.providerAccessEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_history_raw_fk",
      columns: [table.tenantId, table.historyLastDurableRawEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_history_raw_connection_fk",
      columns: [
        table.tenantId,
        table.historyLastDurableRawEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_heads_history_raw_account_fk",
      columns: [
        table.tenantId,
        table.historyLastDurableRawEventId,
        table.sourceAccountId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    unique("inbox_v2_source_thread_binding_heads_route_fence_unique").on(
      table.tenantId,
      table.bindingId,
      table.accountGeneration,
      table.bindingGeneration,
      table.remoteAccessRevision,
      table.administrativeRevision,
      table.capabilityRevision,
      table.routeDescriptorRevision
    ),
    check(
      "inbox_v2_source_thread_binding_heads_account_snapshot_check",
      sql`${table.accountIdentityState} = 'verified'
        and ${table.accountIdentityRevision} >= 1
        and ${table.accountGeneration} >= 1
        and ${sha256DigestSql(table.accountCanonicalKeyDigestSha256)}
        and ${catalogIdSql(table.accountIdentityTrustedServiceId)}`
    ),
    check(
      "inbox_v2_source_thread_binding_heads_revisions_check",
      sql`${table.bindingGeneration} >= 1
        and ${table.currentRemoteAccessEpisodeRevision} = 1
        and ${table.remoteAccessRevision} >= 1
        and ${table.administrativeRevision} >= 1
        and ${table.runtimeHealthRevision} >= 1
        and ${table.historySyncRevision} >= 1
        and ${table.providerAccessRevision} >= 1
        and ${table.providerRoleCount} between 0 and 32
        and ${sha256DigestSql(table.providerRolesDigestSha256)}
        and ${table.capabilityRevision} >= 1
        and ${table.capabilityEntryCount} between 0 and 256
        and ${sha256DigestSql(table.capabilitySemanticDigestSha256)}
        and ${table.routeDescriptorRevision} >= 1
        and ${table.routeAttributeCount} between 0 and 64
        and ${sha256DigestSql(table.routeAttributesDigestSha256)}
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_source_thread_binding_heads_remote_authority_check",
      remoteAccessAuthoritySql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_heads_runtime_diagnostic_check",
      diagnosticSql({
        state: table.runtimeHealthState,
        requiredStates: ["degraded", "unavailable"],
        forbiddenStates: ["ready"],
        codeId: table.runtimeDiagnosticCodeId,
        retryable: table.runtimeDiagnosticRetryable,
        correlationToken: table.runtimeDiagnosticCorrelationToken,
        safeHintId: table.runtimeDiagnosticSafeOperatorHintId
      })
    ),
    check(
      "inbox_v2_source_thread_binding_heads_history_check",
      historySnapshotSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_heads_adapter_surface_check",
      adapterSurfaceSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_heads_route_descriptor_check",
      sql`${catalogIdSql(table.routeDescriptorSchemaId)}
        and ${versionTokenSql(table.routeDescriptorVersion)}
        and ${catalogIdSql(table.routeDestinationKindId)}
        and ${opaqueSubjectSql(table.routeDestinationSubject)}
        and ${sha256DigestSql(table.routeDescriptorDigestSha256)}`
    ),
    check(
      "inbox_v2_source_thread_binding_heads_timestamps_check",
      bindingHeadTimestampsSql(table)
    ),
    index("inbox_v2_source_thread_binding_heads_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt.desc(),
      table.bindingId
    ),
    index("inbox_v2_source_thread_binding_heads_tenant_route_state_idx").on(
      table.tenantId,
      table.administrativeState,
      table.remoteAccessState,
      table.runtimeHealthState,
      table.bindingId
    )
  ]
);

/**
 * Immutable scalar projection captured for every binding revision. Revision 1
 * is the creation commit; later rows are induced by one exact transition. The
 * normalized role/capability/route collections stay in bounded child tables.
 */
export const inboxV2SourceThreadBindingSnapshots = pgTable(
  "inbox_v2_source_thread_binding_snapshots",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    transitionId: text("transition_id"),
    expectedBindingRevision: bigint("expected_binding_revision", {
      mode: "bigint"
    }),
    accountIdentityRevision: bigint("account_identity_revision", {
      mode: "bigint"
    }).notNull(),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
    accountIdentityState: inboxV2SourceAccountIdentityState(
      "account_identity_state"
    )
      .notNull()
      .default("verified"),
    accountCanonicalKeyDigestSha256: text(
      "account_canonical_key_digest_sha256"
    ).notNull(),
    accountIdentityTrustedServiceId: text(
      "account_identity_trusted_service_id"
    ).notNull(),
    accountVerifiedAt: timestamp("account_verified_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    accountVerificationEvidenceSetId: text(
      "account_verification_evidence_set_id"
    ).notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    currentRemoteAccessEpisodeId: text(
      "current_remote_access_episode_id"
    ).notNull(),
    currentRemoteAccessEpisodeRevision: bigint(
      "current_remote_access_episode_revision",
      { mode: "bigint" }
    )
      .notNull()
      .default(sql`1`),
    remoteAccessState: inboxV2SourceThreadBindingRemoteAccessState(
      "remote_access_state"
    ).notNull(),
    remoteAccessEvidenceAuthority:
      inboxV2SourceThreadBindingRemoteEvidenceAuthority(
        "remote_access_evidence_authority"
      ).notNull(),
    remoteAccessRevision: bigint("remote_access_revision", {
      mode: "bigint"
    }).notNull(),
    remoteAccessSince: timestamp("remote_access_since", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    remoteAccessEvidenceSetId: text("remote_access_evidence_set_id").notNull(),
    administrativeState: inboxV2SourceThreadBindingAdministrativeState(
      "administrative_state"
    ).notNull(),
    administrativeRevision: bigint("administrative_revision", {
      mode: "bigint"
    }).notNull(),
    administrativeChangedAt: timestamp("administrative_changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    runtimeHealthState: inboxV2SourceThreadBindingRuntimeHealthState(
      "runtime_health_state"
    ).notNull(),
    runtimeHealthRevision: bigint("runtime_health_revision", {
      mode: "bigint"
    }).notNull(),
    runtimeHealthCheckedAt: timestamp("runtime_health_checked_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    runtimeDiagnosticCodeId: text("runtime_diagnostic_code_id"),
    runtimeDiagnosticRetryable: boolean("runtime_diagnostic_retryable"),
    runtimeDiagnosticCorrelationToken: text(
      "runtime_diagnostic_correlation_token"
    ),
    runtimeDiagnosticSafeOperatorHintId: text(
      "runtime_diagnostic_safe_operator_hint_id"
    ),
    historySyncState:
      inboxV2SourceThreadBindingHistorySyncState(
        "history_sync_state"
      ).notNull(),
    historySyncRevision: bigint("history_sync_revision", {
      mode: "bigint"
    }).notNull(),
    historyReceiveCursor: text("history_receive_cursor"),
    historyCursor: text("history_cursor"),
    historyProviderWatermark: text("history_provider_watermark"),
    historyLastDurableRawEventId: text("history_last_durable_raw_event_id"),
    historyUpdatedAt: timestamp("history_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    historyDiagnosticCodeId: text("history_diagnostic_code_id"),
    historyDiagnosticRetryable: boolean("history_diagnostic_retryable"),
    historyDiagnosticCorrelationToken: text(
      "history_diagnostic_correlation_token"
    ),
    historyDiagnosticSafeOperatorHintId: text(
      "history_diagnostic_safe_operator_hint_id"
    ),
    providerAccessRevision: bigint("provider_access_revision", {
      mode: "bigint"
    }).notNull(),
    providerRoleCount: smallint("provider_role_count").notNull(),
    providerRolesDigestSha256: text("provider_roles_digest_sha256").notNull(),
    providerAccessEvidenceSetId: text(
      "provider_access_evidence_set_id"
    ).notNull(),
    providerAccessObservedAt: timestamp("provider_access_observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    capabilityContractId: text("capability_contract_id").notNull(),
    capabilityContractVersion: text("capability_contract_version").notNull(),
    capabilityDeclarationRevision: bigint("capability_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    capabilitySurfaceId: text("capability_surface_id").notNull(),
    capabilityLoadedByTrustedServiceId: text(
      "capability_loaded_by_trusted_service_id"
    ).notNull(),
    capabilityLoadedAt: timestamp("capability_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    capabilityEntryCount: smallint("capability_entry_count").notNull(),
    capabilitySemanticDigestSha256: text(
      "capability_semantic_digest_sha256"
    ).notNull(),
    capabilityCapturedAt: timestamp("capability_captured_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    routeContractId: text("route_contract_id").notNull(),
    routeContractVersion: text("route_contract_version").notNull(),
    routeDeclarationRevision: bigint("route_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    routeSurfaceId: text("route_surface_id").notNull(),
    routeLoadedByTrustedServiceId: text(
      "route_loaded_by_trusted_service_id"
    ).notNull(),
    routeLoadedAt: timestamp("route_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    routeDescriptorSchemaId: text("route_descriptor_schema_id").notNull(),
    routeDescriptorVersion: text("route_descriptor_version").notNull(),
    routeDescriptorRevision: bigint("route_descriptor_revision", {
      mode: "bigint"
    }).notNull(),
    routeDestinationKindId: text("route_destination_kind_id").notNull(),
    routeDestinationSubject: text("route_destination_subject").notNull(),
    routeDescriptorDigestSha256: text(
      "route_descriptor_digest_sha256"
    ).notNull(),
    routeAttributeCount: smallint("route_attribute_count").notNull(),
    routeAttributesDigestSha256: text(
      "route_attributes_digest_sha256"
    ).notNull(),
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
      name: "inbox_v2_source_thread_binding_snapshots_pk",
      columns: [table.tenantId, table.bindingId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_binding_fk",
      columns: [
        table.tenantId,
        table.bindingId,
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
      name: "inbox_v2_source_thread_binding_snapshots_account_snapshot_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration,
        table.accountIdentityState,
        table.accountCanonicalKeyDigestSha256,
        table.accountIdentityTrustedServiceId,
        table.accountVerifiedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityVerifiedSnapshots.tenantId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.sourceAccountId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.revision,
        inboxV2SourceAccountIdentityVerifiedSnapshots.accountGeneration,
        inboxV2SourceAccountIdentityVerifiedSnapshots.state,
        inboxV2SourceAccountIdentityVerifiedSnapshots.canonicalKeyDigestSha256,
        inboxV2SourceAccountIdentityVerifiedSnapshots.declarationLoadedByTrustedServiceId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.verifiedDecisionDecidedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_account_evidence_fk",
      columns: [
        table.tenantId,
        table.accountVerificationEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_remote_evidence_fk",
      columns: [
        table.tenantId,
        table.remoteAccessEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_provider_evidence_fk",
      columns: [
        table.tenantId,
        table.providerAccessEvidenceSetId,
        table.bindingId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_history_raw_fk",
      columns: [table.tenantId, table.historyLastDurableRawEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_history_raw_connection_fk",
      columns: [
        table.tenantId,
        table.historyLastDurableRawEventId,
        table.sourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_snapshots_history_raw_account_fk",
      columns: [
        table.tenantId,
        table.historyLastDurableRawEventId,
        table.sourceAccountId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    unique("inbox_v2_binding_snapshots_transition_target_unique").on(
      table.tenantId,
      table.transitionId,
      table.bindingId,
      table.expectedBindingRevision,
      table.revision
    ),
    unique("inbox_v2_binding_snapshots_provider_materialization_unique").on(
      table.tenantId,
      table.bindingId,
      table.revision,
      table.providerAccessRevision
    ),
    unique("inbox_v2_binding_snapshots_capability_materialization_unique").on(
      table.tenantId,
      table.bindingId,
      table.revision,
      table.capabilityRevision
    ),
    unique("inbox_v2_binding_snapshots_route_materialization_unique").on(
      table.tenantId,
      table.bindingId,
      table.revision,
      table.routeDescriptorRevision
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_marker_check",
      sql`(
        ${table.revision} = 1
        and ${table.expectedBindingRevision} is null
        and ${table.transitionId} is null
      ) or (
        ${table.revision} >= 2
        and ${table.expectedBindingRevision} = ${table.revision} - 1
        and ${table.transitionId} is not null
      )`
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_account_snapshot_check",
      sql`${table.accountIdentityState} = 'verified'
        and ${table.accountIdentityRevision} >= 1
        and ${table.accountGeneration} >= 1
        and ${sha256DigestSql(table.accountCanonicalKeyDigestSha256)}
        and ${catalogIdSql(table.accountIdentityTrustedServiceId)}`
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_revisions_check",
      sql`${table.bindingGeneration} >= 1
        and ${table.currentRemoteAccessEpisodeRevision} = 1
        and ${table.remoteAccessRevision} >= 1
        and ${table.administrativeRevision} >= 1
        and ${table.runtimeHealthRevision} >= 1
        and ${table.historySyncRevision} >= 1
        and ${table.providerAccessRevision} >= 1
        and ${table.providerRoleCount} between 0 and 32
        and ${sha256DigestSql(table.providerRolesDigestSha256)}
        and ${table.capabilityRevision} >= 1
        and ${table.capabilityEntryCount} between 0 and 256
        and ${sha256DigestSql(table.capabilitySemanticDigestSha256)}
        and ${table.routeDescriptorRevision} >= 1
        and ${table.routeAttributeCount} between 0 and 64
        and ${sha256DigestSql(table.routeAttributesDigestSha256)}
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_remote_authority_check",
      remoteAccessAuthoritySql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_runtime_diagnostic_check",
      diagnosticSql({
        state: table.runtimeHealthState,
        requiredStates: ["degraded", "unavailable"],
        forbiddenStates: ["ready"],
        codeId: table.runtimeDiagnosticCodeId,
        retryable: table.runtimeDiagnosticRetryable,
        correlationToken: table.runtimeDiagnosticCorrelationToken,
        safeHintId: table.runtimeDiagnosticSafeOperatorHintId
      })
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_history_check",
      historySnapshotSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_adapter_surface_check",
      adapterSurfaceSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_route_descriptor_check",
      sql`${catalogIdSql(table.routeDescriptorSchemaId)}
        and ${versionTokenSql(table.routeDescriptorVersion)}
        and ${catalogIdSql(table.routeDestinationKindId)}
        and ${opaqueSubjectSql(table.routeDestinationSubject)}
        and ${sha256DigestSql(table.routeDescriptorDigestSha256)}`
    ),
    check(
      "inbox_v2_source_thread_binding_snapshots_timestamps_check",
      bindingHeadTimestampsSql(table)
    ),
    index("inbox_v2_binding_snapshots_tenant_history_idx").on(
      table.tenantId,
      table.bindingId,
      table.revision.desc()
    )
  ]
);

export const inboxV2SourceThreadBindingProviderRoles = pgTable(
  "inbox_v2_source_thread_binding_provider_roles",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    providerAccessRevision: bigint("provider_access_revision", {
      mode: "bigint"
    }).notNull(),
    materializedByBindingRevision: bigint("materialized_by_binding_revision", {
      mode: "bigint"
    }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    providerRoleId: text("provider_role_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_provider_roles_pk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.providerAccessRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_provider_roles_binding_fk",
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_provider_roles_snapshot_fk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.materializedByBindingRevision,
        table.providerAccessRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingSnapshots.tenantId,
        inboxV2SourceThreadBindingSnapshots.bindingId,
        inboxV2SourceThreadBindingSnapshots.revision,
        inboxV2SourceThreadBindingSnapshots.providerAccessRevision
      ]
    }),
    unique("inbox_v2_binding_provider_roles_value_unique").on(
      table.tenantId,
      table.bindingId,
      table.providerAccessRevision,
      table.providerRoleId
    ),
    check(
      "inbox_v2_binding_provider_roles_values_check",
      sql`${table.providerAccessRevision} >= 1
        and ${table.materializedByBindingRevision} >= 1
        and ${table.ordinal} between 0 and 31
        and ${catalogIdSql(table.providerRoleId)}`
    ),
    index("inbox_v2_binding_provider_roles_tenant_binding_idx").on(
      table.tenantId,
      table.bindingId,
      table.providerAccessRevision.desc(),
      table.ordinal
    )
  ]
);

/** Up to 256 entries per capability revision; nullable content has a stable key. */
export const inboxV2SourceThreadBindingCapabilityEntries = pgTable(
  "inbox_v2_source_thread_binding_capability_entries",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    materializedByBindingRevision: bigint("materialized_by_binding_revision", {
      mode: "bigint"
    }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    capabilityId: text("capability_id").notNull(),
    operationId: text("operation_id").notNull(),
    contentKindId: text("content_kind_id"),
    contentKindKey: text("content_kind_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case
          when content_kind_id is null then '0:'
          else '1:' || octet_length(content_kind_id)::text || ':' || content_kind_id
        end`
      ),
    state: inboxV2SourceThreadBindingCapabilityState("state").notNull(),
    referencePortability: inboxV2SourceThreadBindingReferencePortability(
      "reference_portability"
    ).notNull(),
    validUntil: timestamp("valid_until", {
      withTimezone: true,
      precision: 3
    }),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryable: boolean("diagnostic_retryable"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    requiredProviderRoleCount: smallint(
      "required_provider_role_count"
    ).notNull(),
    evidenceSetId: text("evidence_set_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_capability_entries_pk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.capabilityRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_capability_entries_binding_fk",
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_capability_entries_snapshot_fk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.materializedByBindingRevision,
        table.capabilityRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingSnapshots.tenantId,
        inboxV2SourceThreadBindingSnapshots.bindingId,
        inboxV2SourceThreadBindingSnapshots.revision,
        inboxV2SourceThreadBindingSnapshots.capabilityRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_capability_entries_evidence_fk",
      columns: [table.tenantId, table.evidenceSetId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    unique("inbox_v2_binding_capability_entries_key_unique").on(
      table.tenantId,
      table.bindingId,
      table.capabilityRevision,
      table.capabilityId,
      table.operationId,
      table.contentKindKey
    ),
    unique("inbox_v2_binding_capability_entries_role_target_unique").on(
      table.tenantId,
      table.bindingId,
      table.materializedByBindingRevision,
      table.capabilityRevision,
      table.ordinal,
      table.capabilityId,
      table.operationId,
      table.contentKindKey
    ),
    check(
      "inbox_v2_binding_capability_entries_values_check",
      sql`${table.capabilityRevision} >= 1
        and ${table.materializedByBindingRevision} >= 1
        and ${table.ordinal} between 0 and 255
        and ${table.requiredProviderRoleCount} between 0 and 16
        and ${catalogIdSql(table.capabilityId)}
        and ${catalogIdSql(table.operationId)}
        and (${table.contentKindId} is null or ${catalogIdSql(table.contentKindId)})`
    ),
    check(
      "inbox_v2_binding_capability_entries_state_check",
      capabilityEntryStateSql(table)
    ),
    index("inbox_v2_binding_capability_entries_tenant_binding_idx").on(
      table.tenantId,
      table.bindingId,
      table.capabilityRevision.desc(),
      table.ordinal
    )
  ]
);

export const inboxV2SourceThreadBindingCapabilityRequiredRoles = pgTable(
  "inbox_v2_source_thread_binding_capability_required_roles",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    materializedByBindingRevision: bigint("materialized_by_binding_revision", {
      mode: "bigint"
    }).notNull(),
    capabilityOrdinal: smallint("capability_ordinal").notNull(),
    capabilityId: text("capability_id").notNull(),
    operationId: text("operation_id").notNull(),
    contentKindKey: text("content_kind_key").notNull(),
    ordinal: smallint("ordinal").notNull(),
    providerRoleId: text("provider_role_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_capability_required_roles_pk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.capabilityRevision,
        table.capabilityOrdinal,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_capability_required_roles_entry_fk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.materializedByBindingRevision,
        table.capabilityRevision,
        table.capabilityOrdinal,
        table.capabilityId,
        table.operationId,
        table.contentKindKey
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingCapabilityEntries.tenantId,
        inboxV2SourceThreadBindingCapabilityEntries.bindingId,
        inboxV2SourceThreadBindingCapabilityEntries.materializedByBindingRevision,
        inboxV2SourceThreadBindingCapabilityEntries.capabilityRevision,
        inboxV2SourceThreadBindingCapabilityEntries.ordinal,
        inboxV2SourceThreadBindingCapabilityEntries.capabilityId,
        inboxV2SourceThreadBindingCapabilityEntries.operationId,
        inboxV2SourceThreadBindingCapabilityEntries.contentKindKey
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_binding_capability_required_roles_value_unique").on(
      table.tenantId,
      table.bindingId,
      table.capabilityRevision,
      table.capabilityOrdinal,
      table.providerRoleId
    ),
    check(
      "inbox_v2_binding_capability_required_roles_values_check",
      sql`${table.materializedByBindingRevision} >= 1
        and ${table.ordinal} between 0 and 15
        and ${catalogIdSql(table.capabilityId)}
        and ${catalogIdSql(table.operationId)}
        and ${catalogIdSql(table.providerRoleId)}
        and char_length(${table.contentKindKey}) between 2 and 264`
    ),
    index("inbox_v2_binding_capability_required_roles_tenant_entry_idx").on(
      table.tenantId,
      table.bindingId,
      table.capabilityRevision,
      table.capabilityOrdinal,
      table.ordinal
    )
  ]
);

export const inboxV2SourceThreadBindingRouteAttributes = pgTable(
  "inbox_v2_source_thread_binding_route_attributes",
  {
    tenantId: text("tenant_id").notNull(),
    bindingId: text("binding_id").notNull(),
    routeDescriptorRevision: bigint("route_descriptor_revision", {
      mode: "bigint"
    }).notNull(),
    materializedByBindingRevision: bigint("materialized_by_binding_revision", {
      mode: "bigint"
    }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    attributeId: text("attribute_id").notNull(),
    value: text("value").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_route_attributes_pk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.routeDescriptorRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_route_attributes_binding_fk",
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_binding_route_attributes_snapshot_fk",
      columns: [
        table.tenantId,
        table.bindingId,
        table.materializedByBindingRevision,
        table.routeDescriptorRevision
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingSnapshots.tenantId,
        inboxV2SourceThreadBindingSnapshots.bindingId,
        inboxV2SourceThreadBindingSnapshots.revision,
        inboxV2SourceThreadBindingSnapshots.routeDescriptorRevision
      ]
    }),
    unique("inbox_v2_binding_route_attributes_value_unique").on(
      table.tenantId,
      table.bindingId,
      table.routeDescriptorRevision,
      table.attributeId
    ),
    check(
      "inbox_v2_binding_route_attributes_values_check",
      sql`${table.routeDescriptorRevision} >= 1
        and ${table.materializedByBindingRevision} >= 1
        and ${table.ordinal} between 0 and 63
        and ${catalogIdSql(table.attributeId)}
        and ${opaqueSubjectSql(table.value)}`
    ),
    index("inbox_v2_binding_route_attributes_tenant_binding_idx").on(
      table.tenantId,
      table.bindingId,
      table.routeDescriptorRevision.desc(),
      table.ordinal
    )
  ]
);

/**
 * Append-only axis transitions. One discriminator marker is non-null and the
 * per-kind check owns every optional field, which prevents cross-axis payload
 * leakage. Expected/resulting pairs are the persisted CAS proof.
 */
export const inboxV2SourceThreadBindingTransitions = pgTable(
  "inbox_v2_source_thread_binding_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    bindingId: text("binding_id").notNull(),
    kind: inboxV2SourceThreadBindingTransitionKind("kind").notNull(),
    actorKind:
      inboxV2SourceThreadBindingTransitionActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorAuthorizationEpoch: text("actor_authorization_epoch"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    reasonId: text("reason_id").notNull(),
    expectedBindingRevision: bigint("expected_binding_revision", {
      mode: "bigint"
    }).notNull(),
    resultingBindingRevision: bigint("resulting_binding_revision", {
      mode: "bigint"
    }).notNull(),
    evidenceSetId: text("evidence_set_id"),

    remoteFromState:
      inboxV2SourceThreadBindingRemoteAccessState("remote_from_state"),
    remoteToState:
      inboxV2SourceThreadBindingRemoteAccessState("remote_to_state"),
    expectedRemoteAccessRevision: bigint("expected_remote_access_revision", {
      mode: "bigint"
    }),
    resultingRemoteAccessRevision: bigint("resulting_remote_access_revision", {
      mode: "bigint"
    }),
    resultingRemoteEvidenceAuthority:
      inboxV2SourceThreadBindingRemoteEvidenceAuthority(
        "resulting_remote_evidence_authority"
      ),
    closedRemoteAccessEpisodeId: text("closed_remote_access_episode_id"),
    openedRemoteAccessEpisodeId: text("opened_remote_access_episode_id"),

    administrativeFromState: inboxV2SourceThreadBindingAdministrativeState(
      "administrative_from_state"
    ),
    administrativeToState: inboxV2SourceThreadBindingAdministrativeState(
      "administrative_to_state"
    ),
    expectedAdministrativeRevision: bigint("expected_administrative_revision", {
      mode: "bigint"
    }),
    resultingAdministrativeRevision: bigint(
      "resulting_administrative_revision",
      { mode: "bigint" }
    ),
    administrativeAuthorizationEffect:
      inboxV2SourceThreadBindingAuthorizationEffect(
        "administrative_authorization_effect"
      ),
    administrativeRequiredPermissionId: text(
      "administrative_required_permission_id"
    ),
    administrativeMatchedPermissionCount: smallint(
      "administrative_matched_permission_count"
    ),
    administrativeDecisionRevision: bigint("administrative_decision_revision", {
      mode: "bigint"
    }),
    administrativeDecisionToken: text("administrative_decision_token"),
    administrativeLoadedByTrustedServiceId: text(
      "administrative_loaded_by_trusted_service_id"
    ),
    administrativeDecidedAt: timestamp("administrative_decided_at", {
      withTimezone: true,
      precision: 3
    }),
    administrativeNotAfter: timestamp("administrative_not_after", {
      withTimezone: true,
      precision: 3
    }),
    administrativeTargetBindingId: text("administrative_target_binding_id"),
    administrativeTargetExternalThreadId: text(
      "administrative_target_external_thread_id"
    ),
    administrativeTargetSourceConnectionId: text(
      "administrative_target_source_connection_id"
    ),
    administrativeTargetSourceAccountId: text(
      "administrative_target_source_account_id"
    ),

    runtimeHealthFromState: inboxV2SourceThreadBindingRuntimeHealthState(
      "runtime_health_from_state"
    ),
    runtimeHealthToState: inboxV2SourceThreadBindingRuntimeHealthState(
      "runtime_health_to_state"
    ),
    expectedRuntimeHealthRevision: bigint("expected_runtime_health_revision", {
      mode: "bigint"
    }),
    resultingRuntimeHealthRevision: bigint(
      "resulting_runtime_health_revision",
      { mode: "bigint" }
    ),
    resultingRuntimeDiagnosticCodeId: text(
      "resulting_runtime_diagnostic_code_id"
    ),
    resultingRuntimeDiagnosticRetryable: boolean(
      "resulting_runtime_diagnostic_retryable"
    ),
    resultingRuntimeDiagnosticCorrelationToken: text(
      "resulting_runtime_diagnostic_correlation_token"
    ),
    resultingRuntimeDiagnosticSafeOperatorHintId: text(
      "resulting_runtime_diagnostic_safe_operator_hint_id"
    ),

    historySyncFromState: inboxV2SourceThreadBindingHistorySyncState(
      "history_sync_from_state"
    ),
    historySyncToState: inboxV2SourceThreadBindingHistorySyncState(
      "history_sync_to_state"
    ),
    expectedHistorySyncRevision: bigint("expected_history_sync_revision", {
      mode: "bigint"
    }),
    resultingHistorySyncRevision: bigint("resulting_history_sync_revision", {
      mode: "bigint"
    }),
    resultingHistoryReceiveCursor: text("resulting_history_receive_cursor"),
    resultingHistoryCursor: text("resulting_history_cursor"),
    resultingHistoryProviderWatermark: text(
      "resulting_history_provider_watermark"
    ),
    resultingHistoryLastDurableRawEventId: text(
      "resulting_history_last_durable_raw_event_id"
    ),
    resultingHistoryDiagnosticCodeId: text(
      "resulting_history_diagnostic_code_id"
    ),
    resultingHistoryDiagnosticRetryable: boolean(
      "resulting_history_diagnostic_retryable"
    ),
    resultingHistoryDiagnosticCorrelationToken: text(
      "resulting_history_diagnostic_correlation_token"
    ),
    resultingHistoryDiagnosticSafeOperatorHintId: text(
      "resulting_history_diagnostic_safe_operator_hint_id"
    ),

    expectedCapabilityRevision: bigint("expected_capability_revision", {
      mode: "bigint"
    }),
    resultingCapabilityRevision: bigint("resulting_capability_revision", {
      mode: "bigint"
    }),
    resultingCapabilitySemanticDigestSha256: text(
      "resulting_capability_semantic_digest_sha256"
    ),

    expectedBindingGeneration: bigint("expected_binding_generation", {
      mode: "bigint"
    }),
    resultingBindingGeneration: bigint("resulting_binding_generation", {
      mode: "bigint"
    }),
    expectedRouteDescriptorRevision: bigint(
      "expected_route_descriptor_revision",
      { mode: "bigint" }
    ),
    resultingRouteDescriptorRevision: bigint(
      "resulting_route_descriptor_revision",
      { mode: "bigint" }
    ),
    resultingRouteDescriptorDigestSha256: text(
      "resulting_route_descriptor_digest_sha256"
    ),
    resultingRouteAttributesDigestSha256: text(
      "resulting_route_attributes_digest_sha256"
    ),

    expectedAccountGeneration: bigint("expected_account_generation", {
      mode: "bigint"
    }),
    resultingAccountGeneration: bigint("resulting_account_generation", {
      mode: "bigint"
    }),
    resultingAccountIdentityRevision: bigint(
      "resulting_account_identity_revision",
      { mode: "bigint" }
    ),
    resultingAccountIdentityState: inboxV2SourceAccountIdentityState(
      "resulting_account_identity_state"
    ),
    resultingAccountCanonicalKeyDigestSha256: text(
      "resulting_account_canonical_key_digest_sha256"
    ),

    expectedProviderAccessRevision: bigint(
      "expected_provider_access_revision",
      { mode: "bigint" }
    ),
    resultingProviderAccessRevision: bigint(
      "resulting_provider_access_revision",
      { mode: "bigint" }
    ),
    resultingProviderRolesDigestSha256: text(
      "resulting_provider_roles_digest_sha256"
    ),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_thread_binding_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_binding_fk",
      columns: [table.tenantId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_employee_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_evidence_fk",
      columns: [table.tenantId, table.evidenceSetId, table.bindingId],
      foreignColumns: [
        inboxV2SourceThreadBindingEvidenceSets.tenantId,
        inboxV2SourceThreadBindingEvidenceSets.id,
        inboxV2SourceThreadBindingEvidenceSets.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_admin_target_fk",
      columns: [
        table.tenantId,
        table.administrativeTargetBindingId,
        table.administrativeTargetExternalThreadId,
        table.administrativeTargetSourceConnectionId,
        table.administrativeTargetSourceAccountId
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
      name: "inbox_v2_source_thread_binding_transitions_closed_episode_fk",
      columns: [table.tenantId, table.closedRemoteAccessEpisodeId],
      foreignColumns: [
        inboxV2SourceThreadBindingRemoteAccessEpisodes.tenantId,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_opened_episode_fk",
      columns: [table.tenantId, table.openedRemoteAccessEpisodeId],
      foreignColumns: [
        inboxV2SourceThreadBindingRemoteAccessEpisodes.tenantId,
        inboxV2SourceThreadBindingRemoteAccessEpisodes.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_thread_binding_transitions_history_raw_fk",
      columns: [table.tenantId, table.resultingHistoryLastDurableRawEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    unique("inbox_v2_source_thread_binding_transitions_revision_unique").on(
      table.tenantId,
      table.bindingId,
      table.resultingBindingRevision
    ),
    unique("inbox_v2_binding_transitions_snapshot_target_unique").on(
      table.tenantId,
      table.id,
      table.bindingId,
      table.expectedBindingRevision,
      table.resultingBindingRevision
    ),
    unique("inbox_v2_source_thread_binding_transitions_admin_target_unique").on(
      table.tenantId,
      table.id,
      table.kind,
      table.administrativeRequiredPermissionId,
      table.administrativeMatchedPermissionCount
    ),
    check(
      "inbox_v2_source_thread_binding_transitions_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_thread_binding_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_source_thread_binding_transitions_common_cas_check",
      sql`${table.expectedBindingRevision} >= 1
        and ${table.resultingBindingRevision} = ${table.expectedBindingRevision} + 1`
    ),
    check(
      "inbox_v2_source_thread_binding_transitions_actor_xor_check",
      transitionActorSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_transitions_kind_xor_cas_check",
      transitionKindSql(table)
    ),
    check(
      "inbox_v2_source_thread_binding_transitions_reason_clock_check",
      sql`${catalogIdSql(table.reasonId)} and isfinite(${table.occurredAt})`
    ),
    index("inbox_v2_source_thread_binding_transitions_tenant_binding_idx").on(
      table.tenantId,
      table.bindingId,
      table.resultingBindingRevision.desc(),
      table.id
    ),
    index("inbox_v2_source_thread_binding_transitions_tenant_time_idx").on(
      table.tenantId,
      table.occurredAt.desc(),
      table.id
    )
  ]
);

export const inboxV2SourceThreadBindingTransitionMatchedPermissions = pgTable(
  "inbox_v2_source_thread_binding_transition_matched_permissions",
  {
    tenantId: text("tenant_id").notNull(),
    transitionId: text("transition_id").notNull(),
    transitionKind: inboxV2SourceThreadBindingTransitionKind("transition_kind")
      .notNull()
      .default("administrative"),
    requiredPermissionId: text("required_permission_id").notNull(),
    expectedPermissionCount: smallint("expected_permission_count").notNull(),
    ordinal: smallint("ordinal").notNull(),
    permissionId: text("permission_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_binding_transition_matched_permissions_pk",
      columns: [table.tenantId, table.transitionId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_binding_transition_matched_permissions_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.transitionKind,
        table.requiredPermissionId,
        table.expectedPermissionCount
      ],
      foreignColumns: [
        inboxV2SourceThreadBindingTransitions.tenantId,
        inboxV2SourceThreadBindingTransitions.id,
        inboxV2SourceThreadBindingTransitions.kind,
        inboxV2SourceThreadBindingTransitions.administrativeRequiredPermissionId,
        inboxV2SourceThreadBindingTransitions.administrativeMatchedPermissionCount
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_binding_transition_matched_permissions_value_unique").on(
      table.tenantId,
      table.transitionId,
      table.permissionId
    ),
    check(
      "inbox_v2_binding_transition_matched_permissions_values_check",
      sql`${table.transitionKind} = 'administrative'
        and ${table.expectedPermissionCount} between 1 and 64
        and ${table.ordinal} between 0 and 63
        and ${catalogIdSql(table.requiredPermissionId)}
        and ${catalogIdSql(table.permissionId)}`
    ),
    index(
      "inbox_v2_binding_transition_matched_permissions_tenant_transition_idx"
    ).on(table.tenantId, table.transitionId, table.ordinal)
  ]
);

/**
 * Drizzle cannot model a deferred cross-row cardinality constraint. The final
 * coupled DB002+DB003 migration must execute this exact snippet after creating
 * the evidence tables. It makes declared count, contiguous ordinals and the
 * ordered digest a commit-time database invariant.
 */
export const INBOX_V2_SOURCE_THREAD_BINDING_EVIDENCE_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_assert_binding_evidence_set_integrity(
  p_tenant_id text,
  p_evidence_set_id text
) returns void language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_expected_count smallint;
  v_expected_digest text;
  v_actual_count bigint;
  v_min_ordinal smallint;
  v_max_ordinal smallint;
  v_actual_digest text;
begin
  select reference_count, ordered_reference_digest_sha256
    into v_expected_count, v_expected_digest
    from public.inbox_v2_source_thread_binding_evidence_sets
   where tenant_id = p_tenant_id and id = p_evidence_set_id;

  if not found then
    return;
  end if;

  select count(*), min(ordinal), max(ordinal),
         encode(sha256(convert_to(coalesce(string_agg(
           ordinal::text || '|' || kind::text || '|' ||
           octet_length(coalesce(
             raw_inbound_event_id,
             normalized_inbound_event_id,
             source_account_identity_transition_id,
             source_account_identity_alias_id
           ))::text || ':' || coalesce(
             raw_inbound_event_id,
             normalized_inbound_event_id,
             source_account_identity_transition_id,
             source_account_identity_alias_id
           ), '' order by ordinal
         ), ''), 'UTF8')), 'hex')
    into v_actual_count, v_min_ordinal, v_max_ordinal, v_actual_digest
    from public.inbox_v2_source_thread_binding_evidence_references
   where tenant_id = p_tenant_id and evidence_set_id = p_evidence_set_id;

  if v_actual_count <> v_expected_count
     or v_min_ordinal <> 0
     or v_max_ordinal <> v_expected_count - 1
     or v_actual_digest <> v_expected_digest then
    raise exception using
      errcode = '23514',
      message = 'Inbox V2 binding evidence set count, ordinals or digest mismatch';
  end if;
end;
$$;

create or replace function public.inbox_v2_check_binding_evidence_set_integrity()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_old jsonb;
  v_new jsonb;
begin
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_binding_evidence_set_integrity(
      v_old->>'tenant_id',
      coalesce(v_old->>'id', v_old->>'evidence_set_id')
    );
  end if;
  if tg_op <> 'DELETE' then
  perform public.inbox_v2_assert_binding_evidence_set_integrity(
      v_new->>'tenant_id',
      coalesce(v_new->>'id', v_new->>'evidence_set_id')
    );
  end if;
  return null;
end;
$$;

create constraint trigger inbox_v2_binding_evidence_sets_integrity
after insert or update on public.inbox_v2_source_thread_binding_evidence_sets
deferrable initially deferred for each row
execute function public.inbox_v2_check_binding_evidence_set_integrity();

create constraint trigger inbox_v2_binding_evidence_references_integrity
after insert or update or delete on public.inbox_v2_source_thread_binding_evidence_references
deferrable initially deferred for each row
execute function public.inbox_v2_check_binding_evidence_set_integrity();
`;

/**
 * Commit-time aggregate and append-only guards for the final coupled
 * migration. Repository order is transition -> head update; all normalized
 * snapshot children may be inserted before commit because aggregate checks
 * are deferred.
 */
export const INBOX_V2_SOURCE_THREAD_BINDING_AGGREGATE_INTEGRITY_SQL = String.raw`
alter table public.inbox_v2_source_thread_binding_heads
  alter constraint inbox_v2_source_thread_binding_heads_account_snapshot_fk
  deferrable initially deferred;
alter table public.inbox_v2_source_thread_binding_heads
  alter constraint inbox_v2_source_thread_binding_heads_current_episode_fk
  deferrable initially deferred;
alter table public.inbox_v2_source_thread_binding_snapshots
  add constraint inbox_v2_binding_snapshots_transition_fk
  foreign key (
    tenant_id, transition_id, binding_id,
    expected_binding_revision, revision
  ) references public.inbox_v2_source_thread_binding_transitions (
    tenant_id, id, binding_id,
    expected_binding_revision, resulting_binding_revision
  ) deferrable initially deferred;
alter table public.inbox_v2_source_thread_binding_provider_roles
  alter constraint inbox_v2_binding_provider_roles_snapshot_fk
  deferrable initially deferred;
alter table public.inbox_v2_source_thread_binding_capability_entries
  alter constraint inbox_v2_binding_capability_entries_snapshot_fk
  deferrable initially deferred;
alter table public.inbox_v2_source_thread_binding_route_attributes
  alter constraint inbox_v2_binding_route_attributes_snapshot_fk
  deferrable initially deferred;

create or replace function public.inbox_v2_reject_immutable_binding_row_change()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'Inbox V2 binding history and snapshot rows are append-only';
end;
$$;

create trigger inbox_v2_binding_evidence_sets_immutable
before update or delete on public.inbox_v2_source_thread_binding_evidence_sets
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_anchors_immutable
before update or delete on public.inbox_v2_source_thread_bindings
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_evidence_references_immutable
before update or delete on public.inbox_v2_source_thread_binding_evidence_references
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_transitions_immutable
before update or delete on public.inbox_v2_source_thread_binding_transitions
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_snapshots_immutable
before update or delete on public.inbox_v2_source_thread_binding_snapshots
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_provider_roles_immutable
before update or delete on public.inbox_v2_source_thread_binding_provider_roles
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_capability_entries_immutable
before update or delete on public.inbox_v2_source_thread_binding_capability_entries
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_capability_required_roles_immutable
before update or delete on public.inbox_v2_source_thread_binding_capability_required_roles
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_route_attributes_immutable
before update or delete on public.inbox_v2_source_thread_binding_route_attributes
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();
create trigger inbox_v2_binding_transition_permissions_immutable
before update or delete on public.inbox_v2_source_thread_binding_transition_matched_permissions
for each row execute function public.inbox_v2_reject_immutable_binding_row_change();

create or replace function public.inbox_v2_guard_binding_collection_insert()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_new jsonb := to_jsonb(new);
  v_tenant_id text := v_new->>'tenant_id';
  v_binding_id text;
  v_binding_revision bigint;
begin
  if tg_table_name =
     'inbox_v2_source_thread_binding_transition_matched_permissions' then
    select binding_id, resulting_binding_revision
      into v_binding_id, v_binding_revision
      from public.inbox_v2_source_thread_binding_transitions
     where tenant_id = v_tenant_id
       and id = v_new->>'transition_id';
  else
    v_binding_id := v_new->>'binding_id';
    v_binding_revision :=
      (v_new->>'materialized_by_binding_revision')::bigint;
  end if;

  if v_binding_id is null or v_binding_revision is null then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding collection row lacks its materialization commit';
  end if;
  if exists (
    select 1 from public.inbox_v2_source_thread_binding_snapshots s
     where s.tenant_id = v_tenant_id
       and s.binding_id = v_binding_id
       and s.revision = v_binding_revision
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding collection materialization is already closed';
  end if;
  return new;
end;
$$;

create trigger inbox_v2_binding_provider_roles_open_materialization
before insert on public.inbox_v2_source_thread_binding_provider_roles
for each row execute function public.inbox_v2_guard_binding_collection_insert();
create trigger inbox_v2_binding_capability_entries_open_materialization
before insert on public.inbox_v2_source_thread_binding_capability_entries
for each row execute function public.inbox_v2_guard_binding_collection_insert();
create trigger inbox_v2_binding_required_roles_open_materialization
before insert on public.inbox_v2_source_thread_binding_capability_required_roles
for each row execute function public.inbox_v2_guard_binding_collection_insert();
create trigger inbox_v2_binding_route_attributes_open_materialization
before insert on public.inbox_v2_source_thread_binding_route_attributes
for each row execute function public.inbox_v2_guard_binding_collection_insert();
create trigger inbox_v2_binding_transition_permissions_open_materialization
before insert on public.inbox_v2_source_thread_binding_transition_matched_permissions
for each row execute function public.inbox_v2_guard_binding_collection_insert();

create or replace function public.inbox_v2_guard_binding_episode_change()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding episodes cannot be deleted';
  end if;
  if old.ended_at is not null
     or old.revision <> 1
     or new.ended_at is null
     or new.end_evidence_set_id is null
     or new.revision <> 2
     or new.updated_at <> new.ended_at
     or row(old.tenant_id, old.id, old.binding_id, old.state,
            old.started_at, old.start_evidence_set_id)
        is distinct from
        row(new.tenant_id, new.id, new.binding_id, new.state,
            new.started_at, new.start_evidence_set_id) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding episode only permits an exact revision-1 to revision-2 close';
  end if;
  return new;
end;
$$;

create trigger inbox_v2_binding_episode_close_guard
before update or delete on public.inbox_v2_source_thread_binding_remote_access_episodes
for each row execute function public.inbox_v2_guard_binding_episode_change();

create or replace function public.inbox_v2_guard_binding_head_update()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_transition public.inbox_v2_source_thread_binding_transitions%rowtype;
  v_old jsonb;
  v_new jsonb;
begin
  if tg_op = 'DELETE' then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding current head cannot be deleted';
  end if;

  select * into strict v_transition
    from public.inbox_v2_source_thread_binding_transitions
   where tenant_id = new.tenant_id
     and binding_id = new.binding_id
     and resulting_binding_revision = new.revision;

  if old.revision <> v_transition.expected_binding_revision
     or new.updated_at <> v_transition.occurred_at
     or new.updated_at < old.updated_at
     or (v_transition.kind <> 'administrative'
       and v_transition.actor_trusted_service_id <>
           old.account_identity_trusted_service_id)
     or row(old.tenant_id, old.binding_id, old.external_thread_id,
            old.source_connection_id, old.source_account_id, old.created_at)
        is distinct from
        row(new.tenant_id, new.binding_id, new.external_thread_id,
            new.source_connection_id, new.source_account_id, new.created_at) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding head update lacks the exact transition CAS or changes its anchor';
  end if;

  case v_transition.kind
    when 'remote_access' then
      if old.remote_access_state <> v_transition.remote_from_state
         or old.remote_access_revision <>
            v_transition.expected_remote_access_revision then
        raise exception using errcode = '23514',
          message = 'Inbox V2 remote transition does not CAS the current axis';
      end if;
    when 'administrative' then
      if old.administrative_state <>
            v_transition.administrative_from_state
         or old.administrative_revision <>
            v_transition.expected_administrative_revision then
        raise exception using errcode = '23514',
          message = 'Inbox V2 administrative transition does not CAS the current axis';
      end if;
    when 'runtime_health' then
      if old.runtime_health_state <> v_transition.runtime_health_from_state
         or old.runtime_health_revision <>
            v_transition.expected_runtime_health_revision then
        raise exception using errcode = '23514',
          message = 'Inbox V2 runtime transition does not CAS the current axis';
      end if;
    when 'history_sync' then
      if old.history_sync_state <> v_transition.history_sync_from_state
         or old.history_sync_revision <>
            v_transition.expected_history_sync_revision
         or (v_transition.history_sync_from_state =
             v_transition.history_sync_to_state
           and row(old.history_receive_cursor, old.history_cursor,
                   old.history_provider_watermark)
             is not distinct from
             row(new.history_receive_cursor, new.history_cursor,
                 new.history_provider_watermark)) then
        raise exception using errcode = '23514',
          message = 'Inbox V2 history transition does not CAS or advance progress';
      end if;
    when 'capabilities' then
      if old.capability_revision <> v_transition.expected_capability_revision
         or old.capability_semantic_digest_sha256 =
            new.capability_semantic_digest_sha256 then
        raise exception using errcode = '23514',
          message = 'Inbox V2 capability transition does not CAS or change semantics';
      end if;
    when 'route_descriptor' then
      if old.binding_generation <> v_transition.expected_binding_generation
         or old.route_descriptor_revision <>
            v_transition.expected_route_descriptor_revision
         or row(old.route_descriptor_digest_sha256,
                old.route_attributes_digest_sha256)
           is not distinct from
           row(new.route_descriptor_digest_sha256,
               new.route_attributes_digest_sha256) then
        raise exception using errcode = '23514',
          message = 'Inbox V2 route transition does not CAS or change descriptor';
      end if;
    when 'account_generation' then
      if old.account_generation <> v_transition.expected_account_generation then
        raise exception using errcode = '23514',
          message = 'Inbox V2 account transition does not CAS current generation';
      end if;
    when 'provider_access' then
      if old.provider_access_revision <>
            v_transition.expected_provider_access_revision
         or old.binding_generation <>
            v_transition.expected_binding_generation
         or old.provider_roles_digest_sha256 =
            new.provider_roles_digest_sha256 then
        raise exception using errcode = '23514',
          message = 'Inbox V2 provider transition does not CAS or change roles';
      end if;
  end case;

  v_old := to_jsonb(old) - array['revision', 'updated_at'];
  v_new := to_jsonb(new) - array['revision', 'updated_at'];
  case v_transition.kind
    when 'remote_access' then
      v_old := v_old - array[
        'current_remote_access_episode_id', 'current_remote_access_episode_revision',
        'remote_access_state', 'remote_access_evidence_authority',
        'remote_access_revision', 'remote_access_since',
        'remote_access_evidence_set_id'
      ];
      v_new := v_new - array[
        'current_remote_access_episode_id', 'current_remote_access_episode_revision',
        'remote_access_state', 'remote_access_evidence_authority',
        'remote_access_revision', 'remote_access_since',
        'remote_access_evidence_set_id'
      ];
    when 'administrative' then
      v_old := v_old - array[
        'administrative_state', 'administrative_revision',
        'administrative_changed_at'
      ];
      v_new := v_new - array[
        'administrative_state', 'administrative_revision',
        'administrative_changed_at'
      ];
    when 'runtime_health' then
      v_old := v_old - array[
        'runtime_health_state', 'runtime_health_revision',
        'runtime_health_checked_at', 'runtime_diagnostic_code_id',
        'runtime_diagnostic_retryable', 'runtime_diagnostic_correlation_token',
        'runtime_diagnostic_safe_operator_hint_id'
      ];
      v_new := v_new - array[
        'runtime_health_state', 'runtime_health_revision',
        'runtime_health_checked_at', 'runtime_diagnostic_code_id',
        'runtime_diagnostic_retryable', 'runtime_diagnostic_correlation_token',
        'runtime_diagnostic_safe_operator_hint_id'
      ];
    when 'history_sync' then
      v_old := v_old - array[
        'history_sync_state', 'history_sync_revision', 'history_receive_cursor',
        'history_cursor', 'history_provider_watermark',
        'history_last_durable_raw_event_id', 'history_updated_at',
        'history_diagnostic_code_id', 'history_diagnostic_retryable',
        'history_diagnostic_correlation_token',
        'history_diagnostic_safe_operator_hint_id'
      ];
      v_new := v_new - array[
        'history_sync_state', 'history_sync_revision', 'history_receive_cursor',
        'history_cursor', 'history_provider_watermark',
        'history_last_durable_raw_event_id', 'history_updated_at',
        'history_diagnostic_code_id', 'history_diagnostic_retryable',
        'history_diagnostic_correlation_token',
        'history_diagnostic_safe_operator_hint_id'
      ];
    when 'capabilities' then
      v_old := v_old - array[
        'capability_contract_id', 'capability_contract_version',
        'capability_declaration_revision', 'capability_surface_id',
        'capability_loaded_by_trusted_service_id', 'capability_loaded_at',
        'capability_revision', 'capability_entry_count',
        'capability_semantic_digest_sha256', 'capability_captured_at'
      ];
      v_new := v_new - array[
        'capability_contract_id', 'capability_contract_version',
        'capability_declaration_revision', 'capability_surface_id',
        'capability_loaded_by_trusted_service_id', 'capability_loaded_at',
        'capability_revision', 'capability_entry_count',
        'capability_semantic_digest_sha256', 'capability_captured_at'
      ];
    when 'route_descriptor' then
      v_old := v_old - array[
        'binding_generation', 'route_contract_id', 'route_contract_version',
        'route_declaration_revision', 'route_surface_id',
        'route_loaded_by_trusted_service_id', 'route_loaded_at',
        'route_descriptor_schema_id', 'route_descriptor_version',
        'route_descriptor_revision', 'route_destination_kind_id',
        'route_destination_subject', 'route_descriptor_digest_sha256',
        'route_attribute_count', 'route_attributes_digest_sha256'
      ];
      v_new := v_new - array[
        'binding_generation', 'route_contract_id', 'route_contract_version',
        'route_declaration_revision', 'route_surface_id',
        'route_loaded_by_trusted_service_id', 'route_loaded_at',
        'route_descriptor_schema_id', 'route_descriptor_version',
        'route_descriptor_revision', 'route_destination_kind_id',
        'route_destination_subject', 'route_descriptor_digest_sha256',
        'route_attribute_count', 'route_attributes_digest_sha256'
      ];
    when 'account_generation' then
      v_old := v_old - array[
        'account_identity_revision', 'account_generation',
        'account_identity_state', 'account_canonical_key_digest_sha256',
        'account_identity_trusted_service_id', 'account_verified_at',
        'account_verification_evidence_set_id'
      ];
      v_new := v_new - array[
        'account_identity_revision', 'account_generation',
        'account_identity_state', 'account_canonical_key_digest_sha256',
        'account_identity_trusted_service_id', 'account_verified_at',
        'account_verification_evidence_set_id'
      ];
    when 'provider_access' then
      v_old := v_old - array[
        'binding_generation', 'provider_access_revision',
        'provider_role_count', 'provider_roles_digest_sha256',
        'provider_access_evidence_set_id', 'provider_access_observed_at'
      ];
      v_new := v_new - array[
        'binding_generation', 'provider_access_revision',
        'provider_role_count', 'provider_roles_digest_sha256',
        'provider_access_evidence_set_id', 'provider_access_observed_at'
      ];
  end case;

  if v_old is distinct from v_new then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding transition changed fields owned by another axis';
  end if;
  return new;
exception when no_data_found then
  raise exception using errcode = '23514',
    message = 'Inbox V2 binding head update requires a persisted typed transition';
end;
$$;

create trigger inbox_v2_binding_head_update_guard
before update or delete on public.inbox_v2_source_thread_binding_heads
for each row execute function public.inbox_v2_guard_binding_head_update();

create or replace function public.inbox_v2_assert_source_thread_binding_integrity(
  p_tenant_id text,
  p_binding_id text
) returns void language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  h public.inbox_v2_source_thread_binding_heads%rowtype;
  t public.inbox_v2_source_thread_binding_transitions%rowtype;
  s public.inbox_v2_source_thread_binding_snapshots%rowtype;
  v_count bigint;
  v_min smallint;
  v_max smallint;
  v_digest text;
  v_head jsonb;
  v_snapshot jsonb;
begin
  select * into h from public.inbox_v2_source_thread_binding_heads
   where tenant_id = p_tenant_id and binding_id = p_binding_id;
  if not found then
    if exists (
      select 1 from public.inbox_v2_source_thread_bindings b
       where b.tenant_id = p_tenant_id and b.id = p_binding_id
    ) then
      raise exception using errcode = '23514',
        message = 'Inbox V2 binding anchor requires one current head and open episode';
    end if;
    return;
  end if;

  select * into s from public.inbox_v2_source_thread_binding_snapshots
   where tenant_id = p_tenant_id
     and binding_id = p_binding_id
     and revision = h.revision;
  if not found then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding head requires one immutable revision snapshot';
  end if;
  v_head := to_jsonb(h);
  v_snapshot := to_jsonb(s) -
    array['transition_id', 'expected_binding_revision'];
  if v_snapshot is distinct from v_head then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding revision snapshot diverges from current head';
  end if;

  if not exists (
    select 1 from public.inbox_v2_source_thread_binding_snapshots initial
     where initial.tenant_id = p_tenant_id
       and initial.binding_id = p_binding_id
       and initial.revision = 1
       and initial.transition_id is null
       and initial.expected_binding_revision is null
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding requires its immutable creation snapshot';
  end if;

  if not exists (
    select 1 from public.inbox_v2_source_account_identity_verified_snapshots i
     where i.tenant_id = h.tenant_id
       and i.source_account_id = h.source_account_id
       and i.identity_revision = h.account_identity_revision
       and i.account_generation = h.account_generation
       and i.state = 'verified'
       and i.canonical_key_digest_sha256 =
           h.account_canonical_key_digest_sha256
       and i.declaration_contract_id = h.capability_contract_id
       and i.declaration_contract_version = h.capability_contract_version
       and i.declaration_surface_id = h.capability_surface_id
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 account identity, capability and route adapter surfaces diverge';
  end if;

  if not exists (
    select 1
      from public.inbox_v2_source_thread_bindings b
      join public.inbox_v2_external_threads x
        on x.tenant_id = b.tenant_id and x.id = b.external_thread_id
     where b.tenant_id = h.tenant_id and b.id = h.binding_id
       and b.created_at = h.created_at
       and (x.scope_kind <> 'source_account'
         or x.scope_source_account_id = h.source_account_id)
       and (x.scope_kind <> 'source_connection'
         or x.scope_source_connection_id = h.source_connection_id)
       and x.identity_declaration #>> '{adapterContract,contractId}' =
           h.route_contract_id
       and x.identity_declaration #>> '{adapterContract,contractVersion}' =
           h.route_contract_version
       and x.identity_declaration #>> '{adapterContract,surfaceId}' =
           h.route_surface_id
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding thread scope, creation clock or adapter surface diverges';
  end if;

  select * into t from public.inbox_v2_source_thread_binding_transitions
   where tenant_id = p_tenant_id and binding_id = p_binding_id
   order by resulting_binding_revision desc limit 1;

  if not found then
    if h.revision <> 1 or h.binding_generation <> 1
       or h.remote_access_revision <> 1
       or h.administrative_revision <> 1
       or h.runtime_health_revision <> 1
       or h.history_sync_revision <> 1
       or h.provider_access_revision <> 1
       or h.capability_revision <> 1
       or h.route_descriptor_revision <> 1
       or h.remote_access_since <> h.created_at
       or h.created_at <> h.updated_at then
      raise exception using errcode = '23514',
        message = 'Inbox V2 initial binding head must be an exact revision-1 projection';
    end if;
  else
    if h.revision <> t.resulting_binding_revision
       or h.updated_at <> t.occurred_at
       or s.transition_id is distinct from t.id
       or s.expected_binding_revision is distinct from
          t.expected_binding_revision then
      raise exception using errcode = '23514',
        message = 'Inbox V2 current binding head does not match its latest transition';
    end if;

    if t.kind <> 'administrative'
       and t.actor_trusted_service_id <> h.account_identity_trusted_service_id then
      raise exception using errcode = '23514',
        message = 'Inbox V2 provider transition is not pinned to the verified account actor';
    end if;

    case t.kind
      when 'remote_access' then
        if row(h.remote_access_state, h.remote_access_revision,
               h.remote_access_evidence_authority,
               h.current_remote_access_episode_id,
               h.remote_access_evidence_set_id, h.remote_access_since)
           is distinct from
           row(t.remote_to_state, t.resulting_remote_access_revision,
               t.resulting_remote_evidence_authority,
               t.opened_remote_access_episode_id,
               t.evidence_set_id, t.occurred_at)
           or not exists (
             select 1 from public.inbox_v2_source_thread_binding_remote_access_episodes e
              where e.tenant_id = p_tenant_id and e.binding_id = p_binding_id
                and e.id = t.closed_remote_access_episode_id
                and e.state = t.remote_from_state
                and e.ended_at = t.occurred_at and e.updated_at = t.occurred_at
                and e.end_evidence_set_id = t.evidence_set_id and e.revision = 2
           ) or not exists (
             select 1 from public.inbox_v2_source_thread_binding_remote_access_episodes e
              where e.tenant_id = p_tenant_id and e.binding_id = p_binding_id
                and e.id = t.opened_remote_access_episode_id
                and e.state = t.remote_to_state and e.started_at = t.occurred_at
                and e.start_evidence_set_id = t.evidence_set_id
                and e.ended_at is null and e.revision = 1
           ) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 remote transition, closed episode and current episode diverge';
        end if;
      when 'administrative' then
        if row(h.administrative_state, h.administrative_revision,
               h.administrative_changed_at)
           is distinct from
           row(t.administrative_to_state,
               t.resulting_administrative_revision, t.occurred_at) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 administrative head diverges from transition';
        end if;
        select count(*), min(ordinal), max(ordinal) into v_count, v_min, v_max
          from public.inbox_v2_source_thread_binding_transition_matched_permissions
         where tenant_id = p_tenant_id and transition_id = t.id;
        if v_count <> t.administrative_matched_permission_count
           or (v_count > 0 and (v_min <> 0 or v_max <> v_count - 1))
           or (t.administrative_authorization_effect = 'allow' and not exists (
             select 1
               from public.inbox_v2_source_thread_binding_transition_matched_permissions p
              where p.tenant_id = p_tenant_id and p.transition_id = t.id
                and p.permission_id = t.administrative_required_permission_id
           )) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 administrative permission proof is incomplete';
        end if;
      when 'runtime_health' then
        if row(h.runtime_health_state, h.runtime_health_revision,
               h.runtime_health_checked_at, h.runtime_diagnostic_code_id,
               h.runtime_diagnostic_retryable,
               h.runtime_diagnostic_correlation_token,
               h.runtime_diagnostic_safe_operator_hint_id)
           is distinct from
           row(t.runtime_health_to_state,
               t.resulting_runtime_health_revision, t.occurred_at,
               t.resulting_runtime_diagnostic_code_id,
               t.resulting_runtime_diagnostic_retryable,
               t.resulting_runtime_diagnostic_correlation_token,
               t.resulting_runtime_diagnostic_safe_operator_hint_id) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 runtime-health head diverges from transition';
        end if;
      when 'history_sync' then
        if row(h.history_sync_state, h.history_sync_revision,
               h.history_receive_cursor, h.history_cursor,
               h.history_provider_watermark,
               h.history_last_durable_raw_event_id, h.history_updated_at,
               h.history_diagnostic_code_id, h.history_diagnostic_retryable,
               h.history_diagnostic_correlation_token,
               h.history_diagnostic_safe_operator_hint_id)
           is distinct from
           row(t.history_sync_to_state, t.resulting_history_sync_revision,
               t.resulting_history_receive_cursor, t.resulting_history_cursor,
               t.resulting_history_provider_watermark,
               t.resulting_history_last_durable_raw_event_id, t.occurred_at,
               t.resulting_history_diagnostic_code_id,
               t.resulting_history_diagnostic_retryable,
               t.resulting_history_diagnostic_correlation_token,
               t.resulting_history_diagnostic_safe_operator_hint_id) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 history head diverges from transition';
        end if;
      when 'capabilities' then
        if h.capability_revision <> t.resulting_capability_revision
           or h.capability_captured_at <> t.occurred_at
           or h.capability_semantic_digest_sha256 <>
              t.resulting_capability_semantic_digest_sha256
           or t.actor_trusted_service_id <>
              h.capability_loaded_by_trusted_service_id then
          raise exception using errcode = '23514',
            message = 'Inbox V2 capability head diverges from transition';
        end if;
      when 'route_descriptor' then
        if h.binding_generation <> t.resulting_binding_generation
           or h.route_descriptor_revision <>
              t.resulting_route_descriptor_revision
           or h.route_descriptor_digest_sha256 <>
              t.resulting_route_descriptor_digest_sha256
           or h.route_attributes_digest_sha256 <>
              t.resulting_route_attributes_digest_sha256
           or t.actor_trusted_service_id <>
              h.route_loaded_by_trusted_service_id then
          raise exception using errcode = '23514',
            message = 'Inbox V2 route descriptor head diverges from transition';
        end if;
      when 'account_generation' then
        if row(h.account_generation, h.account_identity_revision,
               h.account_identity_state, h.account_canonical_key_digest_sha256,
               h.account_verified_at, h.account_verification_evidence_set_id)
           is distinct from
           row(t.resulting_account_generation,
               t.resulting_account_identity_revision,
               t.resulting_account_identity_state,
               t.resulting_account_canonical_key_digest_sha256,
               t.occurred_at, t.evidence_set_id) then
          raise exception using errcode = '23514',
            message = 'Inbox V2 verified account snapshot diverges from transition';
        end if;
      when 'provider_access' then
        if h.binding_generation <> t.resulting_binding_generation
           or h.provider_access_revision <>
              t.resulting_provider_access_revision
           or h.provider_access_observed_at <> t.occurred_at
           or h.provider_roles_digest_sha256 <>
              t.resulting_provider_roles_digest_sha256
           or h.provider_access_evidence_set_id <> t.evidence_set_id then
          raise exception using errcode = '23514',
            message = 'Inbox V2 provider-access head diverges from transition';
        end if;
    end case;
  end if;

  select count(*), min(ordinal), max(ordinal),
         encode(sha256(convert_to(coalesce(string_agg(
           octet_length(provider_role_id)::text || ':' || provider_role_id,
           '' order by provider_role_id), ''), 'UTF8')), 'hex')
    into v_count, v_min, v_max, v_digest
    from public.inbox_v2_source_thread_binding_provider_roles
   where tenant_id = p_tenant_id and binding_id = p_binding_id
     and provider_access_revision = h.provider_access_revision;
  if v_count <> h.provider_role_count
     or (v_count > 0 and (v_min <> 0 or v_max <> v_count - 1))
     or v_digest <> h.provider_roles_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'Inbox V2 provider-role snapshot count, ordinals or digest mismatch';
  end if;

  if exists (
    select 1 from public.inbox_v2_source_thread_binding_capability_entries e
     left join lateral (
       select count(*) c, min(r.ordinal) min_o, max(r.ordinal) max_o
         from public.inbox_v2_source_thread_binding_capability_required_roles r
        where r.tenant_id = e.tenant_id and r.binding_id = e.binding_id
          and r.capability_revision = e.capability_revision
          and r.capability_ordinal = e.ordinal
     ) roles on true
    where e.tenant_id = p_tenant_id and e.binding_id = p_binding_id
      and e.capability_revision = h.capability_revision
      and (roles.c <> e.required_provider_role_count
        or (roles.c > 0 and (roles.min_o <> 0 or roles.max_o <> roles.c - 1)))
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 capability required-role count or ordinals mismatch';
  end if;

  if exists (
    select 1 from public.inbox_v2_source_thread_binding_capability_entries e
     where e.tenant_id = p_tenant_id and e.binding_id = p_binding_id
       and e.capability_revision = h.capability_revision
       and ((e.state = 'expired' and e.valid_until > h.capability_captured_at)
         or (e.state = 'supported' and e.valid_until is not null
           and e.valid_until <= h.capability_captured_at))
  ) then
    raise exception using errcode = '23514',
      message = 'Inbox V2 capability validity boundary contradicts capture time';
  end if;

  with entry_payload as (
    select e.ordinal, e.capability_id, e.operation_id, e.content_kind_key,
           e.capability_id || '|' || e.operation_id ||
           '|' || e.content_kind_key || '|' || e.state::text || '|' ||
           e.reference_portability::text || '|' ||
           coalesce(
             ((extract(epoch from e.valid_until) * 1000)::numeric(20, 0))::text,
             '-'
           ) || '|' ||
           coalesce(e.diagnostic_code_id, '-') || '|' ||
           coalesce(e.diagnostic_retryable::text, '-') || '|' ||
           coalesce(e.diagnostic_correlation_token, '-') || '|' ||
           coalesce(e.diagnostic_safe_operator_hint_id, '-') || '|' ||
           coalesce((select string_agg(
             octet_length(r.provider_role_id)::text || ':' ||
               r.provider_role_id,
             '' order by r.provider_role_id)
             from public.inbox_v2_source_thread_binding_capability_required_roles r
            where r.tenant_id = e.tenant_id and r.binding_id = e.binding_id
              and r.capability_revision = e.capability_revision
              and r.capability_ordinal = e.ordinal), '') as payload
      from public.inbox_v2_source_thread_binding_capability_entries e
     where e.tenant_id = p_tenant_id and e.binding_id = p_binding_id
       and e.capability_revision = h.capability_revision
  )
  select count(*), min(ordinal), max(ordinal),
         encode(sha256(convert_to(
           octet_length(h.capability_contract_id)::text || ':' ||
             h.capability_contract_id ||
           octet_length(h.capability_contract_version)::text || ':' ||
             h.capability_contract_version ||
           h.capability_declaration_revision::text || '|' ||
           octet_length(h.capability_surface_id)::text || ':' ||
             h.capability_surface_id ||
           octet_length(h.capability_loaded_by_trusted_service_id)::text || ':' ||
             h.capability_loaded_by_trusted_service_id ||
           coalesce(string_agg(payload, '' order by
             capability_id, operation_id, content_kind_key), ''),
           'UTF8')), 'hex')
    into v_count, v_min, v_max, v_digest from entry_payload;
  if v_count <> h.capability_entry_count
     or (v_count > 0 and (v_min <> 0 or v_max <> v_count - 1))
     or v_digest <> h.capability_semantic_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'Inbox V2 capability snapshot count, ordinals or digest mismatch';
  end if;

  select count(*), min(ordinal), max(ordinal),
         encode(sha256(convert_to(coalesce(string_agg(
           ordinal::text || '|' || attribute_id || '|' ||
           octet_length(value)::text || ':' || value,
           '' order by ordinal), ''), 'UTF8')), 'hex')
    into v_count, v_min, v_max, v_digest
    from public.inbox_v2_source_thread_binding_route_attributes
   where tenant_id = p_tenant_id and binding_id = p_binding_id
     and route_descriptor_revision = h.route_descriptor_revision;
  if v_count <> h.route_attribute_count
     or (v_count > 0 and (v_min <> 0 or v_max <> v_count - 1))
     or v_digest <> h.route_attributes_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'Inbox V2 route-attribute snapshot count, ordinals or digest mismatch';
  end if;

  select encode(sha256(convert_to(
           octet_length(h.route_contract_id)::text || ':' ||
             h.route_contract_id ||
           octet_length(h.route_contract_version)::text || ':' ||
             h.route_contract_version ||
           octet_length(h.route_declaration_revision::text)::text || ':' ||
             h.route_declaration_revision::text ||
           octet_length(h.route_surface_id)::text || ':' ||
             h.route_surface_id ||
           octet_length(h.route_loaded_by_trusted_service_id)::text || ':' ||
             h.route_loaded_by_trusted_service_id ||
           octet_length(h.route_descriptor_schema_id)::text || ':' ||
             h.route_descriptor_schema_id ||
           octet_length(h.route_descriptor_version)::text || ':' ||
             h.route_descriptor_version ||
           octet_length(h.route_descriptor_revision::text)::text || ':' ||
             h.route_descriptor_revision::text ||
           octet_length(h.route_destination_kind_id)::text || ':' ||
             h.route_destination_kind_id ||
           octet_length(h.route_destination_subject)::text || ':' ||
             h.route_destination_subject ||
           coalesce((select string_agg(
             octet_length(attribute_id)::text || ':' || attribute_id ||
               octet_length(value)::text || ':' || value,
             '' order by attribute_id)
             from public.inbox_v2_source_thread_binding_route_attributes a
            where a.tenant_id = p_tenant_id
              and a.binding_id = p_binding_id
              and a.route_descriptor_revision =
                  h.route_descriptor_revision), ''),
           'UTF8')), 'hex')
    into v_digest;
  if v_digest <> h.route_descriptor_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'Inbox V2 route descriptor canonical digest mismatch';
  end if;

  if octet_length(h.route_contract_id) +
       octet_length(h.route_contract_version) +
       octet_length(h.route_surface_id) +
       octet_length(h.route_descriptor_schema_id) +
       octet_length(h.route_descriptor_version) +
       octet_length(h.route_destination_kind_id) +
       octet_length(h.route_destination_subject) +
       coalesce((select sum(octet_length(attribute_id) + octet_length(value))
         from public.inbox_v2_source_thread_binding_route_attributes a
        where a.tenant_id = p_tenant_id and a.binding_id = p_binding_id
          and a.route_descriptor_revision = h.route_descriptor_revision), 0)
       > 16384 then
    raise exception using errcode = '23514',
      message = 'Inbox V2 normalized route descriptor exceeds 16 KiB';
  end if;
end;
$$;

create or replace function public.inbox_v2_check_source_thread_binding_integrity()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id text := coalesce(new.tenant_id, old.tenant_id);
  v_binding_id text := coalesce(new.binding_id, old.binding_id);
  v_new jsonb := to_jsonb(new);
begin
  if tg_op = 'INSERT' then
    if tg_table_name = 'inbox_v2_source_thread_binding_transitions'
       and (v_new->>'resulting_binding_revision')::bigint <> (
         select revision from public.inbox_v2_source_thread_binding_heads
          where tenant_id = v_tenant_id and binding_id = v_binding_id
       ) then
      raise exception using errcode = '23514',
        message = 'Inbox V2 transition may only materialize the current head revision';
     elsif tg_table_name = 'inbox_v2_source_thread_binding_snapshots'
       and (v_new->>'revision')::bigint <> (
         select revision from public.inbox_v2_source_thread_binding_heads
          where tenant_id = v_tenant_id and binding_id = v_binding_id
       ) then
      raise exception using errcode = '23514',
        message = 'Inbox V2 revision snapshot may only close the current head';
    end if;
  end if;
  perform public.inbox_v2_assert_source_thread_binding_integrity(
    v_tenant_id, v_binding_id
  );
  return null;
end;
$$;

create or replace function public.inbox_v2_check_source_thread_binding_edge_integrity()
returns trigger language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  v_tenant_id text := coalesce(new.tenant_id, old.tenant_id);
  v_binding_id text;
  h public.inbox_v2_source_thread_binding_heads%rowtype;
  t public.inbox_v2_source_thread_binding_transitions%rowtype;
begin
  if tg_table_name = 'inbox_v2_source_thread_bindings' then
    v_binding_id := new.id;
  else
    v_binding_id := coalesce(new.binding_id, old.binding_id);
  end if;

  select * into h from public.inbox_v2_source_thread_binding_heads
   where tenant_id = v_tenant_id and binding_id = v_binding_id;
  if not found then
    raise exception using errcode = '23514',
      message = 'Inbox V2 binding anchor requires one current head and open episode';
  end if;

  if tg_table_name =
     'inbox_v2_source_thread_binding_remote_access_episodes' then
    if tg_op = 'INSERT' then
      if new.ended_at is not null
         or new.revision <> 1
         or h.current_remote_access_episode_id <> new.id then
        raise exception using errcode = '23514',
          message = 'Inbox V2 episode insert must establish the current open episode';
      end if;
    else
      select * into t from public.inbox_v2_source_thread_binding_transitions
       where tenant_id = v_tenant_id and binding_id = v_binding_id
       order by resulting_binding_revision desc limit 1;
      if not found
         or t.kind <> 'remote_access'
         or t.resulting_binding_revision <> h.revision
         or t.closed_remote_access_episode_id <> new.id
         or t.opened_remote_access_episode_id <>
            h.current_remote_access_episode_id
         or t.occurred_at <> new.ended_at then
        raise exception using errcode = '23514',
          message = 'Inbox V2 episode closure lacks its exact latest transition';
      end if;
    end if;
  end if;
  return null;
end;
$$;

create constraint trigger inbox_v2_binding_heads_integrity
after insert or update on public.inbox_v2_source_thread_binding_heads
deferrable initially deferred for each row
execute function public.inbox_v2_check_source_thread_binding_integrity();
create constraint trigger inbox_v2_binding_anchors_integrity
after insert on public.inbox_v2_source_thread_bindings
deferrable initially deferred for each row
execute function public.inbox_v2_check_source_thread_binding_edge_integrity();
create constraint trigger inbox_v2_binding_episodes_integrity
after insert or update on public.inbox_v2_source_thread_binding_remote_access_episodes
deferrable initially deferred for each row
execute function public.inbox_v2_check_source_thread_binding_edge_integrity();
create constraint trigger inbox_v2_binding_transitions_integrity
after insert on public.inbox_v2_source_thread_binding_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_check_source_thread_binding_integrity();
create constraint trigger inbox_v2_binding_snapshots_integrity
after insert on public.inbox_v2_source_thread_binding_snapshots
deferrable initially deferred for each row
execute function public.inbox_v2_check_source_thread_binding_integrity();
`;

function evidenceReferenceKindSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.kind} = 'raw_inbound_event'
    and ${table.rawInboundEventId} is not null
    and num_nonnulls(
      ${table.normalizedInboundEventId},
      ${table.sourceAccountIdentityTransitionId},
      ${table.sourceAccountIdentityTransitionResultingRevision},
      ${table.sourceAccountIdentityTransitionResultingGeneration},
      ${table.sourceAccountIdentityAliasId},
      ${table.sourceAccountIdentityAliasExpectedRevision},
      ${table.sourceAccountIdentityAliasExpectedGeneration},
      ${table.sourceAccountIdentityAliasTargetState},
      ${table.sourceAccountIdentityAliasCanonicalKeyDigestSha256},
      ${table.providerRosterEvidenceId},
      ${table.providerRosterMemberEvidenceId}
    ) = 0
  ) or (
    ${table.kind} = 'normalized_inbound_event'
    and ${table.normalizedInboundEventId} is not null
    and num_nonnulls(
      ${table.rawInboundEventId},
      ${table.sourceAccountIdentityTransitionId},
      ${table.sourceAccountIdentityTransitionResultingRevision},
      ${table.sourceAccountIdentityTransitionResultingGeneration},
      ${table.sourceAccountIdentityAliasId},
      ${table.sourceAccountIdentityAliasExpectedRevision},
      ${table.sourceAccountIdentityAliasExpectedGeneration},
      ${table.sourceAccountIdentityAliasTargetState},
      ${table.sourceAccountIdentityAliasCanonicalKeyDigestSha256},
      ${table.providerRosterEvidenceId},
      ${table.providerRosterMemberEvidenceId}
    ) = 0
  ) or (
    ${table.kind} = 'source_account_identity_transition'
    and ${table.sourceAccountIdentityTransitionId} is not null
    and ${table.sourceAccountIdentityTransitionResultingRevision} is not null
    and ${table.sourceAccountIdentityTransitionResultingGeneration} is not null
    and num_nonnulls(
      ${table.rawInboundEventId},
      ${table.normalizedInboundEventId},
      ${table.sourceAccountIdentityAliasId},
      ${table.sourceAccountIdentityAliasExpectedRevision},
      ${table.sourceAccountIdentityAliasExpectedGeneration},
      ${table.sourceAccountIdentityAliasTargetState},
      ${table.sourceAccountIdentityAliasCanonicalKeyDigestSha256},
      ${table.providerRosterEvidenceId},
      ${table.providerRosterMemberEvidenceId}
    ) = 0
  ) or (
    ${table.kind} = 'source_account_identity_alias'
    and ${table.sourceAccountIdentityAliasId} is not null
    and ${table.sourceAccountIdentityAliasExpectedRevision} is not null
    and ${table.sourceAccountIdentityAliasExpectedGeneration} is not null
    and ${table.sourceAccountIdentityAliasTargetState} = 'verified'
    and ${sha256DigestSql(
      table.sourceAccountIdentityAliasCanonicalKeyDigestSha256
    )}
    and num_nonnulls(
      ${table.rawInboundEventId},
      ${table.normalizedInboundEventId},
      ${table.sourceAccountIdentityTransitionId},
      ${table.sourceAccountIdentityTransitionResultingRevision},
      ${table.sourceAccountIdentityTransitionResultingGeneration},
      ${table.providerRosterEvidenceId},
      ${table.providerRosterMemberEvidenceId}
    ) = 0
  ) or (
    ${table.kind} = 'provider_roster_evidence'
    and ${table.providerRosterEvidenceId} is not null
    and num_nonnulls(
      ${table.rawInboundEventId},
      ${table.normalizedInboundEventId},
      ${table.sourceAccountIdentityTransitionId},
      ${table.sourceAccountIdentityTransitionResultingRevision},
      ${table.sourceAccountIdentityTransitionResultingGeneration},
      ${table.sourceAccountIdentityAliasId},
      ${table.sourceAccountIdentityAliasExpectedRevision},
      ${table.sourceAccountIdentityAliasExpectedGeneration},
      ${table.sourceAccountIdentityAliasTargetState},
      ${table.sourceAccountIdentityAliasCanonicalKeyDigestSha256},
      ${table.providerRosterMemberEvidenceId}
    ) = 0
  ) or (
    ${table.kind} = 'provider_roster_member_evidence'
    and ${table.providerRosterMemberEvidenceId} is not null
    and num_nonnulls(
      ${table.rawInboundEventId},
      ${table.normalizedInboundEventId},
      ${table.sourceAccountIdentityTransitionId},
      ${table.sourceAccountIdentityTransitionResultingRevision},
      ${table.sourceAccountIdentityTransitionResultingGeneration},
      ${table.sourceAccountIdentityAliasId},
      ${table.sourceAccountIdentityAliasExpectedRevision},
      ${table.sourceAccountIdentityAliasExpectedGeneration},
      ${table.sourceAccountIdentityAliasTargetState},
      ${table.sourceAccountIdentityAliasCanonicalKeyDigestSha256},
      ${table.providerRosterEvidenceId}
    ) = 0
  )`;
}

function remoteAccessAuthoritySql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.remoteAccessState} in ('left', 'removed')
    and ${table.remoteAccessEvidenceAuthority} in (
      'explicit_terminal_event', 'authoritative_snapshot'
    )
  ) or (
    ${table.remoteAccessState} = 'active'
    and ${table.remoteAccessEvidenceAuthority} in (
      'direct_observation', 'authoritative_snapshot'
    )
  ) or ${table.remoteAccessState} = 'observed'`;
}

function diagnosticSql(input: {
  state: SQLWrapper;
  requiredStates: readonly string[];
  forbiddenStates: readonly string[];
  codeId: SQLWrapper;
  retryable: SQLWrapper;
  correlationToken: SQLWrapper;
  safeHintId: SQLWrapper;
}): SQL {
  const required = sql.join(
    input.requiredStates.map((state) => sql.raw(`'${state}'`)),
    sql`, `
  );
  const forbidden = sql.join(
    input.forbiddenStates.map((state) => sql.raw(`'${state}'`)),
    sql`, `
  );
  const noDiagnosticAllowed =
    input.requiredStates.length === 0
      ? sql`true`
      : sql`${input.state} not in (${required})`;
  const diagnosticAllowed =
    input.forbiddenStates.length === 0
      ? sql`true`
      : sql`${input.state} not in (${forbidden})`;

  return sql`((
      num_nonnulls(
        ${input.codeId}, ${input.retryable}, ${input.correlationToken}
      ) = 0
      and ${input.safeHintId} is null
      and ${noDiagnosticAllowed}
    ) or (
      ${input.codeId} is not null
      and ${input.retryable} is not null
      and ${input.correlationToken} is not null
      and ${catalogIdSql(input.codeId)}
      and ${routingTokenSql(input.correlationToken)}
      and (${input.safeHintId} is null or ${catalogIdSql(input.safeHintId)})
      and ${diagnosticAllowed}
    ))`;
}

function historySnapshotSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.historySyncState} <> 'unsupported'
    or num_nonnulls(
      ${table.historyReceiveCursor},
      ${table.historyCursor},
      ${table.historyProviderWatermark}
    ) = 0
  ) and (
    ${table.historyReceiveCursor} is null
    or ${opaqueSubjectSql(table.historyReceiveCursor)}
  ) and (
    ${table.historyCursor} is null
    or ${opaqueSubjectSql(table.historyCursor)}
  ) and (
    ${table.historyProviderWatermark} is null
    or ${opaqueSubjectSql(table.historyProviderWatermark)}
  ) and ${diagnosticSql({
    state: table.historySyncState,
    requiredStates: ["failed"],
    forbiddenStates: [],
    codeId: table.historyDiagnosticCodeId,
    retryable: table.historyDiagnosticRetryable,
    correlationToken: table.historyDiagnosticCorrelationToken,
    safeHintId: table.historyDiagnosticSafeOperatorHintId
  })}`;
}

function adapterSurfaceSql(table: Record<string, SQLWrapper>): SQL {
  return sql`${catalogIdSql(table.capabilityContractId)}
    and ${versionTokenSql(table.capabilityContractVersion)}
    and ${table.capabilityDeclarationRevision} >= 1
    and ${catalogIdSql(table.capabilitySurfaceId)}
    and ${catalogIdSql(table.capabilityLoadedByTrustedServiceId)}
    and ${catalogIdSql(table.routeContractId)}
    and ${versionTokenSql(table.routeContractVersion)}
    and ${table.routeDeclarationRevision} >= 1
    and ${catalogIdSql(table.routeSurfaceId)}
    and ${catalogIdSql(table.routeLoadedByTrustedServiceId)}
    and ${table.capabilityContractId} = ${table.routeContractId}
    and ${table.capabilityContractVersion} = ${table.routeContractVersion}
    and ${table.capabilitySurfaceId} = ${table.routeSurfaceId}`;
}

function bindingHeadTimestampsSql(table: Record<string, SQLWrapper>): SQL {
  return sql`isfinite(${table.accountVerifiedAt})
    and isfinite(${table.remoteAccessSince})
    and isfinite(${table.administrativeChangedAt})
    and isfinite(${table.runtimeHealthCheckedAt})
    and isfinite(${table.historyUpdatedAt})
    and isfinite(${table.providerAccessObservedAt})
    and isfinite(${table.capabilityLoadedAt})
    and isfinite(${table.capabilityCapturedAt})
    and isfinite(${table.routeLoadedAt})
    and isfinite(${table.createdAt})
    and isfinite(${table.updatedAt})
    and ${table.updatedAt} >= ${table.createdAt}
    and ${table.accountVerifiedAt} <= ${table.updatedAt}
    and ${table.remoteAccessSince} <= ${table.updatedAt}
    and ${table.administrativeChangedAt} <= ${table.updatedAt}
    and ${table.runtimeHealthCheckedAt} <= ${table.updatedAt}
    and ${table.historyUpdatedAt} <= ${table.updatedAt}
    and ${table.providerAccessObservedAt} <= ${table.updatedAt}
    and ${table.capabilityLoadedAt} <= ${table.capabilityCapturedAt}
    and ${table.capabilityCapturedAt} <= ${table.updatedAt}
    and ${table.routeLoadedAt} <= ${table.updatedAt}`;
}

function capabilityEntryStateSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.state} <> 'expired'
    or ${table.validUntil} is not null
  ) and (
    ${table.validUntil} is null
    or isfinite(${table.validUntil})
  ) and ${diagnosticSql({
    state: table.state,
    requiredStates: ["temporarily_unavailable"],
    forbiddenStates: ["supported"],
    codeId: table.diagnosticCodeId,
    retryable: table.diagnosticRetryable,
    correlationToken: table.diagnosticCorrelationToken,
    safeHintId: table.diagnosticSafeOperatorHintId
  })}`;
}

function transitionActorSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.kind} = 'administrative'
    and ${table.actorKind} = 'employee'
    and ${table.actorEmployeeId} is not null
    and ${authorizationEpochSql(table.actorAuthorizationEpoch)}
    and ${table.actorTrustedServiceId} is null
  ) or (
    ${table.kind} <> 'administrative'
    and ${table.actorKind} = 'trusted_service'
    and ${table.actorEmployeeId} is null
    and ${table.actorAuthorizationEpoch} is null
    and ${catalogIdSql(table.actorTrustedServiceId)}
  )`;
}

function transitionKindSql(table: Record<string, SQLWrapper>): SQL {
  const remote = [
    table.remoteFromState,
    table.remoteToState,
    table.expectedRemoteAccessRevision,
    table.resultingRemoteAccessRevision,
    table.resultingRemoteEvidenceAuthority,
    table.closedRemoteAccessEpisodeId,
    table.openedRemoteAccessEpisodeId
  ];
  const administrative = [
    table.administrativeFromState,
    table.administrativeToState,
    table.expectedAdministrativeRevision,
    table.resultingAdministrativeRevision,
    table.administrativeAuthorizationEffect,
    table.administrativeRequiredPermissionId,
    table.administrativeMatchedPermissionCount,
    table.administrativeDecisionRevision,
    table.administrativeDecisionToken,
    table.administrativeLoadedByTrustedServiceId,
    table.administrativeDecidedAt,
    table.administrativeNotAfter,
    table.administrativeTargetBindingId,
    table.administrativeTargetExternalThreadId,
    table.administrativeTargetSourceConnectionId,
    table.administrativeTargetSourceAccountId
  ];
  const runtime = [
    table.runtimeHealthFromState,
    table.runtimeHealthToState,
    table.expectedRuntimeHealthRevision,
    table.resultingRuntimeHealthRevision,
    table.resultingRuntimeDiagnosticCodeId,
    table.resultingRuntimeDiagnosticRetryable,
    table.resultingRuntimeDiagnosticCorrelationToken,
    table.resultingRuntimeDiagnosticSafeOperatorHintId
  ];
  const history = [
    table.historySyncFromState,
    table.historySyncToState,
    table.expectedHistorySyncRevision,
    table.resultingHistorySyncRevision,
    table.resultingHistoryReceiveCursor,
    table.resultingHistoryCursor,
    table.resultingHistoryProviderWatermark,
    table.resultingHistoryLastDurableRawEventId,
    table.resultingHistoryDiagnosticCodeId,
    table.resultingHistoryDiagnosticRetryable,
    table.resultingHistoryDiagnosticCorrelationToken,
    table.resultingHistoryDiagnosticSafeOperatorHintId
  ];
  const capability = [
    table.expectedCapabilityRevision,
    table.resultingCapabilityRevision,
    table.resultingCapabilitySemanticDigestSha256
  ];
  const route = [
    table.expectedRouteDescriptorRevision,
    table.resultingRouteDescriptorRevision,
    table.resultingRouteDescriptorDigestSha256,
    table.resultingRouteAttributesDigestSha256
  ];
  const account = [
    table.expectedAccountGeneration,
    table.resultingAccountGeneration,
    table.resultingAccountIdentityRevision,
    table.resultingAccountIdentityState,
    table.resultingAccountCanonicalKeyDigestSha256
  ];
  const provider = [
    table.expectedProviderAccessRevision,
    table.resultingProviderAccessRevision,
    table.resultingProviderRolesDigestSha256
  ];
  const bindingGeneration = [
    table.expectedBindingGeneration,
    table.resultingBindingGeneration
  ];

  return sql`num_nonnulls(
    ${table.expectedRemoteAccessRevision},
    ${table.expectedAdministrativeRevision},
    ${table.expectedRuntimeHealthRevision},
    ${table.expectedHistorySyncRevision},
    ${table.expectedCapabilityRevision},
    ${table.expectedRouteDescriptorRevision},
    ${table.expectedAccountGeneration},
    ${table.expectedProviderAccessRevision}
  ) = 1 and (
    (
      ${table.kind} = 'remote_access'
      and ${allNotNullSql(remote)}
      and ${allNullSql([
        ...administrative,
        ...runtime,
        ...history,
        ...capability,
        ...route,
        ...account,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is not null
      and ${table.remoteFromState} <> ${table.remoteToState}
      and ${table.resultingRemoteAccessRevision} =
        ${table.expectedRemoteAccessRevision} + 1
      and ${table.closedRemoteAccessEpisodeId} <>
        ${table.openedRemoteAccessEpisodeId}
      and ${remoteTransitionAuthoritySql(table)}
    ) or (
      ${table.kind} = 'administrative'
      and ${allNotNullSql(administrative)}
      and ${allNullSql([
        ...remote,
        ...runtime,
        ...history,
        ...capability,
        ...route,
        ...account,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is null
      and ${table.administrativeFromState} <>
        ${table.administrativeToState}
      and ${table.resultingAdministrativeRevision} =
        ${table.expectedAdministrativeRevision} + 1
      and ${table.administrativeRequiredPermissionId} =
        'core:source_thread_binding.administrative.update'
      and ${table.administrativeMatchedPermissionCount} between 0 and 64
      and ${table.administrativeAuthorizationEffect} = 'allow'
      and ${table.administrativeMatchedPermissionCount} >= 1
      and ${table.administrativeTargetBindingId} = ${table.bindingId}
      and ${table.administrativeDecisionRevision} >= 1
      and ${routingTokenSql(table.administrativeDecisionToken)}
      and ${catalogIdSql(table.administrativeLoadedByTrustedServiceId)}
      and isfinite(${table.administrativeDecidedAt})
      and isfinite(${table.administrativeNotAfter})
      and ${table.administrativeDecidedAt} <= ${table.occurredAt}
      and ${table.administrativeNotAfter} >= ${table.occurredAt}
    ) or (
      ${table.kind} = 'runtime_health'
      and ${allNotNullSql(runtime.slice(0, 4))}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...history,
        ...capability,
        ...route,
        ...account,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is null
      and ${table.resultingRuntimeHealthRevision} =
        ${table.expectedRuntimeHealthRevision} + 1
      and (
        ${table.runtimeHealthFromState} <> ${table.runtimeHealthToState}
        or (
          ${table.runtimeHealthFromState} = 'ready'
          and ${table.runtimeHealthToState} = 'ready'
        )
      )
      and ${diagnosticSql({
        state: table.runtimeHealthToState,
        requiredStates: ["degraded", "unavailable"],
        forbiddenStates: ["ready"],
        codeId: table.resultingRuntimeDiagnosticCodeId,
        retryable: table.resultingRuntimeDiagnosticRetryable,
        correlationToken: table.resultingRuntimeDiagnosticCorrelationToken,
        safeHintId: table.resultingRuntimeDiagnosticSafeOperatorHintId
      })}
    ) or (
      ${table.kind} = 'history_sync'
      and ${allNotNullSql(history.slice(0, 4))}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...runtime,
        ...capability,
        ...route,
        ...account,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is null
      and ${table.resultingHistorySyncRevision} =
        ${table.expectedHistorySyncRevision} + 1
      and ${historyTransitionSql(table)}
    ) or (
      ${table.kind} = 'capabilities'
      and ${allNotNullSql(capability)}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...runtime,
        ...history,
        ...route,
        ...account,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is not null
      and ${table.resultingCapabilityRevision} =
        ${table.expectedCapabilityRevision} + 1
      and ${sha256DigestSql(table.resultingCapabilitySemanticDigestSha256)}
    ) or (
      ${table.kind} = 'route_descriptor'
      and ${allNotNullSql([...route, ...bindingGeneration])}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...runtime,
        ...history,
        ...capability,
        ...account,
        ...provider
      ])}
      and ${table.evidenceSetId} is not null
      and ${table.resultingBindingGeneration} =
        ${table.expectedBindingGeneration} + 1
      and ${table.resultingRouteDescriptorRevision} =
        ${table.expectedRouteDescriptorRevision} + 1
      and ${sha256DigestSql(table.resultingRouteDescriptorDigestSha256)}
      and ${sha256DigestSql(table.resultingRouteAttributesDigestSha256)}
    ) or (
      ${table.kind} = 'account_generation'
      and ${allNotNullSql(account)}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...runtime,
        ...history,
        ...capability,
        ...route,
        ...provider,
        ...bindingGeneration
      ])}
      and ${table.evidenceSetId} is not null
      and ${table.resultingAccountGeneration} =
        ${table.expectedAccountGeneration} + 1
      and ${table.resultingAccountIdentityRevision} =
        ${table.resultingAccountGeneration}
      and ${table.resultingAccountIdentityState} = 'verified'
      and ${sha256DigestSql(table.resultingAccountCanonicalKeyDigestSha256)}
    ) or (
      ${table.kind} = 'provider_access'
      and ${allNotNullSql([...provider, ...bindingGeneration])}
      and ${allNullSql([
        ...remote,
        ...administrative,
        ...runtime,
        ...history,
        ...capability,
        ...route,
        ...account
      ])}
      and ${table.evidenceSetId} is not null
      and ${table.resultingProviderAccessRevision} =
        ${table.expectedProviderAccessRevision} + 1
      and ${table.resultingBindingGeneration} =
        ${table.expectedBindingGeneration} + 1
      and ${sha256DigestSql(table.resultingProviderRolesDigestSha256)}
    )
  )`;
}

function remoteTransitionAuthoritySql(table: Record<string, SQLWrapper>): SQL {
  return sql`((
      ${table.remoteToState} in ('left', 'removed')
      and ${table.resultingRemoteEvidenceAuthority} in (
        'explicit_terminal_event', 'authoritative_snapshot'
      )
    ) or (
      ${table.remoteToState} = 'active'
      and ${table.resultingRemoteEvidenceAuthority} in (
        'direct_observation', 'authoritative_snapshot'
      )
    ) or ${table.remoteToState} = 'observed')`;
}

function historyTransitionSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    (
      ${table.historySyncFromState} = ${table.historySyncToState}
      and ${table.historySyncFromState} in (
        'backfilling', 'catching_up', 'live'
      )
      and num_nonnulls(
        ${table.resultingHistoryReceiveCursor},
        ${table.resultingHistoryCursor},
        ${table.resultingHistoryProviderWatermark}
      ) >= 1
    ) or (
      ${table.historySyncFromState} <> ${table.historySyncToState}
      and (
        (${table.historySyncFromState} = 'unsupported'
          and ${table.historySyncToState} = 'not_started')
        or (${table.historySyncFromState} = 'not_started'
          and ${table.historySyncToState} in ('backfilling', 'live'))
        or (${table.historySyncFromState} = 'backfilling'
          and ${table.historySyncToState} in ('catching_up', 'paused', 'failed'))
        or (${table.historySyncFromState} = 'catching_up'
          and ${table.historySyncToState} in ('live', 'paused', 'failed'))
        or (${table.historySyncFromState} = 'live'
          and ${table.historySyncToState} in ('paused', 'failed'))
        or (${table.historySyncFromState} = 'paused'
          and ${table.historySyncToState} in (
            'backfilling', 'catching_up', 'live', 'failed'
          ))
        or (${table.historySyncFromState} = 'failed'
          and ${table.historySyncToState} in (
            'not_started', 'backfilling', 'catching_up', 'paused'
          ))
      )
    )
  ) and (
    ${table.historySyncToState} <> 'unsupported'
    or num_nonnulls(
      ${table.resultingHistoryReceiveCursor},
      ${table.resultingHistoryCursor},
      ${table.resultingHistoryProviderWatermark}
    ) = 0
  ) and (
    ${table.resultingHistoryReceiveCursor} is null
    or ${opaqueSubjectSql(table.resultingHistoryReceiveCursor)}
  ) and (
    ${table.resultingHistoryCursor} is null
    or ${opaqueSubjectSql(table.resultingHistoryCursor)}
  ) and (
    ${table.resultingHistoryProviderWatermark} is null
    or ${opaqueSubjectSql(table.resultingHistoryProviderWatermark)}
  ) and ${diagnosticSql({
    state: table.historySyncToState,
    requiredStates: ["failed"],
    forbiddenStates: [],
    codeId: table.resultingHistoryDiagnosticCodeId,
    retryable: table.resultingHistoryDiagnosticRetryable,
    correlationToken: table.resultingHistoryDiagnosticCorrelationToken,
    safeHintId: table.resultingHistoryDiagnosticSafeOperatorHintId
  })}`;
}

function allNullSql(columns: readonly SQLWrapper[]): SQL {
  return sql.join(
    columns.map((column) => sql`${column} is null`),
    sql` and `
  );
}

function allNotNullSql(columns: readonly SQLWrapper[]): SQL {
  return sql.join(
    columns.map((column) => sql`${column} is not null`),
    sql` and `
  );
}

function catalogIdSql(column: SQLWrapper): SQL {
  return sql`char_length(${column}) <= 256 and (
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
  )`;
}

function versionTokenSql(column: SQLWrapper): SQL {
  return sql`${column} ~ '^v[1-9][0-9]*$'`;
}

function opaqueSubjectSql(column: SQLWrapper): SQL {
  return sql`char_length(${column}) between 1 and 1024
    and ${column} ~ '[^[:space:]]'
    and ${column} !~ '[\\x00-\\x1F\\x7F]'`;
}

function routingTokenSql(column: SQLWrapper): SQL {
  return sql`char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
}

function authorizationEpochSql(column: SQLWrapper): SQL {
  return sql`char_length(${column}) between 8 and 1024
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'`;
}

function sha256DigestSql(column: SQLWrapper): SQL {
  return sql`${column} ~ '^[a-f0-9]{64}$'`;
}
