import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import { normalizedInboundEvents, sourceAccounts, tenants } from "../tables";
import { inboxV2ExternalThreads } from "./external-thread";
import { inboxV2SourceExternalIdentities } from "./identity-foundation";
import {
  inboxV2ExternalMessageReferences,
  inboxV2ExternalMessageScopeKind
} from "./outbound-transport";
import { inboxV2SourceOccurrences } from "./source-occurrence";
import { inboxV2SourceThreadBindings } from "./source-thread-binding";
import {
  inboxV2MessageProviderLifecycleOperations,
  inboxV2MessageRevisions,
  inboxV2Messages
} from "./timeline-message";

export const inboxV2DeferredSourceActionKind = pgEnum(
  "inbox_v2_deferred_source_action_kind",
  ["edit", "delete", "reaction", "delivery", "receipt"]
);

export const inboxV2DeferredSourceActionLane = pgEnum(
  "inbox_v2_deferred_source_action_lane",
  ["message_lifecycle", "reaction", "delivery", "receipt"]
);

export const inboxV2DeferredSourceActionOrderingKind = pgEnum(
  "inbox_v2_deferred_source_action_ordering_kind",
  ["monotonic_exact", "incomparable", "unavailable"]
);

export const inboxV2DeferredSourceActionState = pgEnum(
  "inbox_v2_deferred_source_action_state",
  [
    "pending",
    "applied",
    "target_conflicted",
    "stale",
    "duplicate",
    "ordering_conflict",
    "expired"
  ]
);

export const inboxV2DeferredSourceActionOrderingOutcome = pgEnum(
  "inbox_v2_deferred_source_action_ordering_outcome",
  ["advance", "stale", "duplicate", "conflict", "not_evaluated"]
);

export const inboxV2DeferredSourceActionEffectKind = pgEnum(
  "inbox_v2_deferred_source_action_effect_kind",
  [
    "message_lifecycle",
    "message_reaction",
    "message_transport_fact",
    "provider_delete_retain_local"
  ]
);

type CanonicalDetail = Readonly<Record<string, unknown>>;

/**
 * One immutable, tenant-scoped owner for a canonical external message key.
 *
 * The SHA-256 digest keeps every hot lookup and child FK bounded, while the
 * complete canonical key snapshot remains available for a collision-safe
 * equality check. Reconciliation registers this row while holding the same
 * per-key advisory lock used for reference/action induction.
 */
export const inboxV2SourceMessageKeyRegistry = pgTable(
  "inbox_v2_source_message_key_registry",
  {
    tenantId: text("tenant_id").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(() =>
        externalMessageKeyDigestSql({
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
    messageRealmId: text("message_realm_id").notNull(),
    messageRealmVersion: text("message_realm_version").notNull(),
    messageCanonicalizationVersion: text(
      "message_canonicalization_version"
    ).notNull(),
    messageScopeKind:
      inboxV2ExternalMessageScopeKind("message_scope_kind").notNull(),
    messageScopeSourceAccountId: text("message_scope_source_account_id"),
    messageScopeSourceThreadBindingId: text(
      "message_scope_source_thread_binding_id"
    ),
    messageObjectKindId: text("message_object_kind_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    externalMessageKeyDetail: jsonb("external_message_key_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    externalMessageKeyDetailDigestSha256: text(
      "external_message_key_detail_digest_sha256"
    ).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_message_key_registry_pk",
      columns: [table.tenantId, table.messageKeyDigestSha256]
    }),
    foreignKey({
      name: "inbox_v2_source_message_key_registry_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_message_key_registry_thread_fk",
      columns: [table.tenantId, table.externalThreadId],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_message_key_registry_account_fk",
      columns: [table.tenantId, table.messageScopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_source_message_key_registry_binding_fk",
      columns: [table.tenantId, table.messageScopeSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    check(
      "inbox_v2_source_message_key_registry_key_check",
      sql`(${catalogIdSql(table.messageRealmId)}
        and ${versionTokenSql(table.messageRealmVersion)}
        and ${versionTokenSql(table.messageCanonicalizationVersion)}
        and ${catalogIdSql(table.messageObjectKindId)}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}
        and ${sha256HexSql(table.messageKeyDigestSha256)}) is true`
    ),
    check(
      "inbox_v2_source_message_key_registry_scope_check",
      sql`(
          ${table.messageScopeKind} = 'provider_thread'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_account'
          and ${table.messageScopeSourceAccountId} is not null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_thread_binding'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is not null
        )`
    ),
    check(
      "inbox_v2_source_message_key_registry_detail_check",
      sql`(${boundedJsonObjectSql(table.externalMessageKeyDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.externalMessageKeyDetail,
          table.externalMessageKeyDetailDigestSha256
        )}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmId}') =
          ${table.messageRealmId}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmVersion}') =
          ${table.messageRealmVersion}
        and (${table.externalMessageKeyDetail} #>>
          '{realm,canonicalizationVersion}') =
          ${table.messageCanonicalizationVersion}
        and (${table.externalMessageKeyDetail} #>> '{scope,kind}') =
          ${table.messageScopeKind}::text
        and (${table.externalMessageKeyDetail} #>> '{scope,owner,id}') is not
          distinct from coalesce(
            ${table.messageScopeSourceAccountId},
            ${table.messageScopeSourceThreadBindingId}
          )
        and (${table.externalMessageKeyDetail} #>> '{objectKindId}') =
          ${table.messageObjectKindId}
        and (${table.externalMessageKeyDetail} #>> '{externalThread,id}') =
          ${table.externalThreadId}
        and (${table.externalMessageKeyDetail} #>>
          '{canonicalExternalSubject}') = ${table.canonicalExternalSubject}
        and isfinite(${table.createdAt})) is true`
    ),
    index("inbox_v2_source_message_key_registry_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
      table.messageKeyDigestSha256
    )
  ]
);

/**
 * Durable head for one deferred edit/delete/reaction/delivery/read action.
 * Exact-key, occurrence and semantic provenance are immutable; only the
 * pending -> terminal state and its CAS revision may change.
 */
export const inboxV2DeferredMessageSourceActions = pgTable(
  "inbox_v2_deferred_message_source_actions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),

    messageRealmId: text("message_realm_id").notNull(),
    messageRealmVersion: text("message_realm_version").notNull(),
    messageCanonicalizationVersion: text(
      "message_canonicalization_version"
    ).notNull(),
    messageScopeKind:
      inboxV2ExternalMessageScopeKind("message_scope_kind").notNull(),
    messageScopeSourceAccountId: text("message_scope_source_account_id"),
    messageScopeSourceThreadBindingId: text(
      "message_scope_source_thread_binding_id"
    ),
    messageObjectKindId: text("message_object_kind_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(() =>
        externalMessageKeyDigestSql({
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
    externalMessageKeyDetail: jsonb("external_message_key_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    externalMessageKeyDetailDigestSha256: text(
      "external_message_key_detail_digest_sha256"
    ).notNull(),

    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    sourceOccurrenceRevision: bigint("source_occurrence_revision", {
      mode: "bigint"
    }).notNull(),
    sourceOccurrenceDetail: jsonb("source_occurrence_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    sourceOccurrenceDetailDigestSha256: text(
      "source_occurrence_detail_digest_sha256"
    ).notNull(),
    normalizedInboundEventId: text("normalized_inbound_event_id").notNull(),

    actionKind: inboxV2DeferredSourceActionKind("action_kind").notNull(),
    lane: inboxV2DeferredSourceActionLane("lane").notNull(),
    actionDetail: jsonb("action_detail").$type<CanonicalDetail>().notNull(),
    actionDetailDigestSha256: text("action_detail_digest_sha256").notNull(),

    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
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
    capabilityId: text("capability_id").notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    semanticId: text("semantic_id").notNull(),
    semanticRevision: bigint("semantic_revision", {
      mode: "bigint"
    }).notNull(),
    actorSourceExternalIdentityId: text("actor_source_external_identity_id"),
    orderingKind:
      inboxV2DeferredSourceActionOrderingKind("ordering_kind").notNull(),
    orderingScopeToken: text("ordering_scope_token"),
    orderingPosition: text("ordering_position"),
    orderingComparatorId: text("ordering_comparator_id"),
    orderingComparatorRevision: bigint("ordering_comparator_revision", {
      mode: "bigint"
    }),
    orderingConflictToken: text("ordering_conflict_token"),
    orderingUnavailableReasonId: text("ordering_unavailable_reason_id"),
    declaredByTrustedServiceId: text(
      "declared_by_trusted_service_id"
    ).notNull(),
    semanticProofToken: text("semantic_proof_token").notNull(),
    semanticProofDetail: jsonb("semantic_proof_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    semanticProofDetailDigestSha256: text(
      "semantic_proof_detail_digest_sha256"
    ).notNull(),

    eventFingerprintSha256: text("event_fingerprint_sha256").notNull(),

    state: inboxV2DeferredSourceActionState("state")
      .notNull()
      .default("pending"),
    appliedExternalMessageReferenceId: text(
      "applied_external_message_reference_id"
    ),
    appliedMessageId: text("applied_message_id"),
    appliedMessageRevision: bigint("applied_message_revision", {
      mode: "bigint"
    }),
    appliedProviderLifecycleOperationId: text(
      "applied_provider_lifecycle_operation_id"
    ),
    appliedProviderLifecycleOperationRevision: bigint(
      "applied_provider_lifecycle_operation_revision",
      { mode: "bigint" }
    ),
    effectKind: inboxV2DeferredSourceActionEffectKind("effect_kind"),
    relatedActionId: text("related_action_id"),
    stateReasonId: text("state_reason_id"),
    conflictCandidateCount: smallint("conflict_candidate_count")
      .notNull()
      .default(sql`0`),
    conflictCandidateDigestSha256: text("conflict_candidate_digest_sha256"),
    terminalAt: timestamp("terminal_at", {
      withTimezone: true,
      precision: 3
    }),

    dataClassId: text("data_class_id")
      .notNull()
      .default("core:source_occurrence_and_external_reference"),
    sensitivityClass: text("sensitivity_class")
      .notNull()
      .default("personal_operational"),
    processingPurposeId: text("processing_purpose_id")
      .notNull()
      .default("core:source_replay_and_diagnostics"),
    canonicalAnchorId: text("canonical_anchor_id")
      .notNull()
      .default("core:terminal_occurrence_or_resolution"),
    expiryAction: text("expiry_action")
      .notNull()
      .default("compact_to_safe_skeleton"),

    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
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
      name: "inbox_v2_deferred_actions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_deferred_actions_replay_unique").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.sourceOccurrenceId,
      table.semanticId,
      table.eventFingerprintSha256
    ),
    unique("inbox_v2_deferred_actions_ordering_target_unique").on(
      table.tenantId,
      table.id,
      table.messageKeyDigestSha256,
      table.lane,
      table.orderingScopeToken,
      table.orderingComparatorId,
      table.orderingComparatorRevision,
      table.normalizedInboundEventId,
      table.sourceOccurrenceId,
      table.semanticId,
      table.eventFingerprintSha256
    ),
    foreignKey({
      name: "inbox_v2_deferred_actions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_deferred_actions_message_key_registry_fk",
      columns: [table.tenantId, table.messageKeyDigestSha256],
      foreignColumns: [
        inboxV2SourceMessageKeyRegistry.tenantId,
        inboxV2SourceMessageKeyRegistry.messageKeyDigestSha256
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_thread_fk",
      columns: [table.tenantId, table.externalThreadId],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_scope_account_fk",
      columns: [table.tenantId, table.messageScopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_scope_binding_fk",
      columns: [table.tenantId, table.messageScopeSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_event_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_binding_fk",
      columns: [
        table.tenantId,
        table.sourceThreadBindingId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_actor_fk",
      columns: [table.tenantId, table.actorSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_applied_reference_fk",
      columns: [table.tenantId, table.appliedExternalMessageReferenceId],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_applied_message_fk",
      columns: [table.tenantId, table.appliedMessageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_applied_message_revision_fk",
      columns: [
        table.tenantId,
        table.appliedMessageId,
        table.appliedMessageRevision
      ],
      foreignColumns: [
        inboxV2MessageRevisions.tenantId,
        inboxV2MessageRevisions.messageId,
        inboxV2MessageRevisions.messageRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_applied_provider_operation_fk",
      columns: [
        table.tenantId,
        table.appliedProviderLifecycleOperationId,
        table.appliedProviderLifecycleOperationRevision
      ],
      foreignColumns: [
        inboxV2MessageProviderLifecycleOperations.tenantId,
        inboxV2MessageProviderLifecycleOperations.id,
        inboxV2MessageProviderLifecycleOperations.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_actions_related_action_fk",
      columns: [table.tenantId, table.relatedActionId],
      foreignColumns: [table.tenantId, table.id]
    }),
    check(
      "inbox_v2_deferred_actions_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^deferred_message_source_action:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_deferred_actions_key_check",
      sql`(${catalogIdSql(table.messageRealmId)}
        and ${versionTokenSql(table.messageRealmVersion)}
        and ${versionTokenSql(table.messageCanonicalizationVersion)}
        and ${catalogIdSql(table.messageObjectKindId)}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}
        and ${sha256HexSql(table.messageKeyDigestSha256)}
        and ${boundedJsonObjectSql(table.externalMessageKeyDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.externalMessageKeyDetail,
          table.externalMessageKeyDetailDigestSha256
        )}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmId}') =
          ${table.messageRealmId}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmVersion}') =
          ${table.messageRealmVersion}
        and (${table.externalMessageKeyDetail} #>>
          '{realm,canonicalizationVersion}') =
          ${table.messageCanonicalizationVersion}
        and (${table.externalMessageKeyDetail} #>> '{scope,kind}') =
          ${table.messageScopeKind}::text
        and (${table.externalMessageKeyDetail} #>> '{scope,owner,id}') is not
          distinct from coalesce(
            ${table.messageScopeSourceAccountId},
            ${table.messageScopeSourceThreadBindingId}
          )
        and (${table.externalMessageKeyDetail} #>> '{objectKindId}') =
          ${table.messageObjectKindId}
        and (${table.externalMessageKeyDetail} #>> '{externalThread,id}') =
          ${table.externalThreadId}
        and (${table.externalMessageKeyDetail} #>>
          '{canonicalExternalSubject}') = ${table.canonicalExternalSubject})
        is true`
    ),
    check(
      "inbox_v2_deferred_actions_scope_check",
      sql`(
          ${table.messageScopeKind} = 'provider_thread'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_account'
          and ${table.messageScopeSourceAccountId} is not null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_thread_binding'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is not null
        )`
    ),
    check(
      "inbox_v2_deferred_actions_detail_check",
      sql`(${table.sourceOccurrenceRevision} >= 1
        and ${boundedJsonObjectSql(table.sourceOccurrenceDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.sourceOccurrenceDetail,
          table.sourceOccurrenceDetailDigestSha256
        )}
        and (${table.sourceOccurrenceDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.sourceOccurrenceDetail} #>> '{id}') =
          ${table.sourceOccurrenceId}
        and (${table.sourceOccurrenceDetail} #>> '{revision}') =
          ${table.sourceOccurrenceRevision}::text
        and ${boundedJsonObjectSql(table.actionDetail, 32_768)}
        and ${jsonSha256PrefixedSql(
          table.actionDetail,
          table.actionDetailDigestSha256
        )}
        and (${table.actionDetail} #>> '{kind}') = ${table.actionKind}::text
        and (${table.actionDetail} #>> '{normalizedEvent,id}') =
          ${table.normalizedInboundEventId}
        and not (${table.actionDetail} ?| array[
          'body', 'content', 'sender', 'displaySender', 'messageContent'
        ])) is true`
    ),
    check(
      "inbox_v2_deferred_actions_lane_check",
      sql`(
          ${table.actionKind} in ('edit', 'delete')
          and ${table.lane} = 'message_lifecycle'
        ) or (${table.actionKind} = 'reaction' and ${table.lane} = 'reaction')
          or (${table.actionKind} = 'delivery' and ${table.lane} = 'delivery')
          or (${table.actionKind} = 'receipt' and ${table.lane} = 'receipt')`
    ),
    check(
      "inbox_v2_deferred_actions_semantic_check",
      sql`(${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.adapterLoadedByTrustedServiceId)}
        and ${catalogIdSql(table.capabilityId)}
        and ${table.capabilityRevision} >= 1
        and ${catalogIdSql(table.semanticId)}
        and ${table.semanticRevision} >= 1
        and ${catalogIdSql(table.declaredByTrustedServiceId)}
        and ${routingTokenSql(table.semanticProofToken)}
        and ${boundedJsonObjectSql(table.semanticProofDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.semanticProofDetail,
          table.semanticProofDetailDigestSha256
        )}
        and (${table.semanticProofDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.semanticProofDetail} #>>
          '{normalizedInboundEvent,id}') = ${table.normalizedInboundEventId}
        and (${table.semanticProofDetail} #>>
          '{normalizedInboundEvent,tenantId}') = ${table.tenantId}
        and (${table.semanticProofDetail} -> 'externalMessageReference') =
          'null'::jsonb
        and (${table.semanticProofDetail} -> 'sourceOccurrence') =
          'null'::jsonb
        and (${table.semanticProofDetail} #>> '{sourceAccount,id}') =
          ${table.sourceAccountId}
        and (${table.semanticProofDetail} #>> '{sourceAccount,tenantId}') =
          ${table.tenantId}
        and (${table.semanticProofDetail} #>> '{sourceThreadBinding,id}') =
          ${table.sourceThreadBindingId}
        and (${table.semanticProofDetail} #>>
          '{sourceThreadBinding,tenantId}') = ${table.tenantId}
        and (${table.semanticProofDetail} #>> '{bindingGeneration}') =
          ${table.bindingGeneration}::text
        and (${table.semanticProofDetail} #>>
          '{adapterContract,contractId}') = ${table.adapterContractId}
        and (${table.semanticProofDetail} #>>
          '{adapterContract,contractVersion}') = ${table.adapterContractVersion}
        and (${table.semanticProofDetail} #>>
          '{adapterContract,declarationRevision}') =
          ${table.adapterDeclarationRevision}::text
        and (${table.semanticProofDetail} #>>
          '{adapterContract,surfaceId}') = ${table.adapterSurfaceId}
        and (${table.semanticProofDetail} #>>
          '{adapterContract,loadedByTrustedServiceId}') =
          ${table.adapterLoadedByTrustedServiceId}
        and (${table.semanticProofDetail} #>>
          '{adapterContract,loadedAt}')::timestamptz = ${table.adapterLoadedAt}
        and (${table.semanticProofDetail} #>> '{capabilityId}') =
          ${table.capabilityId}
        and (${table.semanticProofDetail} #>> '{capabilityRevision}') =
          ${table.capabilityRevision}::text
        and (${table.semanticProofDetail} #>> '{semanticId}') =
          ${table.semanticId}
        and (${table.semanticProofDetail} #>> '{semanticRevision}') =
          ${table.semanticRevision}::text
        and ${table.semanticProofDetail} ? 'actor'
        and (${table.semanticProofDetail} #>> '{actor,id}') is not distinct from
          ${table.actorSourceExternalIdentityId}
        and (
          ${table.actorSourceExternalIdentityId} is null
          or (${table.semanticProofDetail} #>> '{actor,tenantId}') =
            ${table.tenantId}
        )
        and (${table.semanticProofDetail} -> 'ordering') = case
          when ${table.orderingKind} = 'monotonic_exact' then
            jsonb_build_object(
              'kind', 'monotonic_exact',
              'scopeToken', ${table.orderingScopeToken},
              'position', ${table.orderingPosition},
              'comparatorId', ${table.orderingComparatorId},
              'comparatorRevision', ${table.orderingComparatorRevision}::text
            )
          when ${table.orderingKind} = 'incomparable' then
            jsonb_build_object(
              'kind', 'incomparable',
              'conflictToken', ${table.orderingConflictToken}
            )
          when ${table.orderingKind} = 'unavailable' then
            jsonb_build_object(
              'kind', 'unavailable',
              'reasonId', ${table.orderingUnavailableReasonId}
            )
        end
        and (${table.semanticProofDetail} #>>
          '{declaredByTrustedServiceId}') =
          ${table.declaredByTrustedServiceId}
        and (${table.semanticProofDetail} #>> '{proofToken}') =
          ${table.semanticProofToken}
        and (${table.semanticProofDetail} #>> '{occurredAt}')::timestamptz =
          ${table.observedAt}
        and (${table.semanticProofDetail} #>> '{recordedAt}')::timestamptz =
          ${table.recordedAt}
        and (${table.semanticProofDetail} #>> '{revision}') = '1') is true`
    ),
    check(
      "inbox_v2_deferred_actions_ordering_check",
      sql`(
          ${table.orderingKind} = 'monotonic_exact'
          and ${routingTokenSql(table.orderingScopeToken)}
          and ${canonicalPositionSql(table.orderingPosition)}
          and ${catalogIdSql(table.orderingComparatorId)}
          and ${table.orderingComparatorRevision} >= 1
          and ${table.orderingConflictToken} is null
          and ${table.orderingUnavailableReasonId} is null
        ) or (
          ${table.orderingKind} = 'incomparable'
          and ${routingTokenSql(table.orderingConflictToken)}
          and num_nonnulls(
            ${table.orderingScopeToken}, ${table.orderingPosition},
            ${table.orderingComparatorId},
            ${table.orderingComparatorRevision},
            ${table.orderingUnavailableReasonId}
          ) = 0
        ) or (
          ${table.orderingKind} = 'unavailable'
          and ${catalogIdSql(table.orderingUnavailableReasonId)}
          and num_nonnulls(
            ${table.orderingScopeToken}, ${table.orderingPosition},
            ${table.orderingComparatorId},
            ${table.orderingComparatorRevision},
            ${table.orderingConflictToken}
          ) = 0
        )`
    ),
    check(
      "inbox_v2_deferred_actions_replay_check",
      sql`(${sha256HexSql(table.eventFingerprintSha256)}
        and (${table.semanticId} = case ${table.actionKind}
          when 'edit' then 'core:message.lifecycle.edit.observed'
          when 'delete' then 'core:message.lifecycle.delete.observed'
          when 'reaction' then 'core:message.reaction.' ||
            (${table.actionDetail} #>> '{operation}')
          when 'delivery' then 'core:message.delivery.' ||
            (${table.actionDetail} #>> '{fact}')
          when 'receipt' then 'core:message.receipt.read'
        end)) is true`
    ),
    check(
      "inbox_v2_deferred_actions_state_check",
      deferredActionStateSql(table)
    ),
    check(
      "inbox_v2_deferred_actions_governance_check",
      sql`${table.dataClassId} =
          'core:source_occurrence_and_external_reference'
        and ${table.sensitivityClass} = 'personal_operational'
        and ${table.processingPurposeId} =
          'core:source_replay_and_diagnostics'
        and ${table.canonicalAnchorId} =
          'core:terminal_occurrence_or_resolution'
        and ${table.expiryAction} = 'compact_to_safe_skeleton'`
    ),
    check(
      "inbox_v2_deferred_actions_clock_check",
      sql`${table.bindingGeneration} >= 1
        and isfinite(${table.adapterLoadedAt})
        and isfinite(${table.observedAt})
        and isfinite(${table.recordedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.adapterLoadedAt} <= ${table.recordedAt}
        and ${table.observedAt} <= ${table.recordedAt}
        and ${table.recordedAt} = ${table.createdAt}
        and ${table.createdAt} <= ${table.updatedAt}
        and ${table.revision} >= 1`
    ),
    index("inbox_v2_deferred_actions_pending_idx")
      .on(
        table.tenantId,
        table.state,
        table.recordedAt,
        table.sourceOccurrenceId,
        table.id
      )
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_deferred_actions_pending_key_idx")
      .on(table.tenantId, table.messageKeyDigestSha256, table.id)
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_deferred_actions_key_idx").on(
      table.tenantId,
      table.messageKeyDigestSha256,
      table.lane,
      table.id
    ),
    index("inbox_v2_deferred_actions_occurrence_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.revision,
      table.id
    )
  ]
);

/** One append-only terminal CAS record for a deferred action. */
export const inboxV2DeferredMessageSourceActionTransitions = pgTable(
  "inbox_v2_deferred_message_source_action_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    actionId: text("action_id").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    afterState: inboxV2DeferredSourceActionState("after_state").notNull(),
    orderingOutcome:
      inboxV2DeferredSourceActionOrderingOutcome("ordering_outcome").notNull(),
    expectedOrderingHeadRevision: bigint("expected_ordering_head_revision", {
      mode: "bigint"
    }),
    resultingOrderingHeadRevision: bigint("resulting_ordering_head_revision", {
      mode: "bigint"
    }),
    orderingHeadScopeToken: text("ordering_head_scope_token"),
    orderingHeadComparatorId: text("ordering_head_comparator_id"),
    orderingHeadComparatorRevision: bigint(
      "ordering_head_comparator_revision",
      { mode: "bigint" }
    ),
    targetExternalMessageReferenceId: text(
      "target_external_message_reference_id"
    ),
    targetMessageId: text("target_message_id"),
    appliedMessageRevision: bigint("applied_message_revision", {
      mode: "bigint"
    }),
    appliedProviderLifecycleOperationId: text(
      "applied_provider_lifecycle_operation_id"
    ),
    appliedProviderLifecycleOperationRevision: bigint(
      "applied_provider_lifecycle_operation_revision",
      { mode: "bigint" }
    ),
    effectKind: inboxV2DeferredSourceActionEffectKind("effect_kind"),
    relatedActionId: text("related_action_id"),
    reasonId: text("reason_id"),
    conflictCandidateCount: smallint("conflict_candidate_count")
      .notNull()
      .default(sql`0`),
    conflictCandidateDigestSha256: text("conflict_candidate_digest_sha256"),
    sourceOccurrenceExpectedRevision: bigint(
      "source_occurrence_expected_revision",
      { mode: "bigint" }
    ),
    sourceOccurrenceResultingRevision: bigint(
      "source_occurrence_resulting_revision",
      { mode: "bigint" }
    ),
    sourceOccurrenceResolutionDigestSha256: text(
      "source_occurrence_resolution_digest_sha256"
    ),
    effectProofDigestSha256: text("effect_proof_digest_sha256"),
    transitionDetail: jsonb("transition_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    transitionDetailDigestSha256: text(
      "transition_detail_digest_sha256"
    ).notNull(),
    commitDigestSha256: text("commit_digest_sha256").notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_deferred_action_transitions_pk",
      columns: [table.tenantId, table.actionId, table.resultingRevision]
    }),
    unique("inbox_v2_deferred_action_transitions_action_unique").on(
      table.tenantId,
      table.actionId
    ),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_action_fk",
      columns: [table.tenantId, table.actionId],
      foreignColumns: [
        inboxV2DeferredMessageSourceActions.tenantId,
        inboxV2DeferredMessageSourceActions.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_target_fk",
      columns: [table.tenantId, table.targetExternalMessageReferenceId],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_message_fk",
      columns: [table.tenantId, table.targetMessageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_message_revision_fk",
      columns: [
        table.tenantId,
        table.targetMessageId,
        table.appliedMessageRevision
      ],
      foreignColumns: [
        inboxV2MessageRevisions.tenantId,
        inboxV2MessageRevisions.messageId,
        inboxV2MessageRevisions.messageRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_provider_operation_fk",
      columns: [
        table.tenantId,
        table.appliedProviderLifecycleOperationId,
        table.appliedProviderLifecycleOperationRevision
      ],
      foreignColumns: [
        inboxV2MessageProviderLifecycleOperations.tenantId,
        inboxV2MessageProviderLifecycleOperations.id,
        inboxV2MessageProviderLifecycleOperations.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_transitions_related_fk",
      columns: [table.tenantId, table.relatedActionId],
      foreignColumns: [
        inboxV2DeferredMessageSourceActions.tenantId,
        inboxV2DeferredMessageSourceActions.id
      ]
    }),
    check(
      "inbox_v2_deferred_action_transitions_revision_check",
      sql`${table.expectedRevision} >= 1
        and ${table.resultingRevision} = ${table.expectedRevision} + 1
        and ${table.afterState} <> 'pending'`
    ),
    check(
      "inbox_v2_deferred_action_transitions_ordering_check",
      sql`((
          ${table.orderingOutcome} = 'advance'
          and ${table.resultingOrderingHeadRevision} is not null
          and ${table.resultingOrderingHeadRevision} =
            coalesce(${table.expectedOrderingHeadRevision}, 0) + 1
        ) or (
          ${table.orderingOutcome} in (
            'stale', 'duplicate', 'conflict', 'not_evaluated'
          )
          and ${table.expectedOrderingHeadRevision} is not distinct from
            ${table.resultingOrderingHeadRevision}
          and (
            ${table.orderingOutcome} not in ('stale', 'duplicate')
            or ${table.expectedOrderingHeadRevision} is not null
          )
        )) and (
          (
            ${table.expectedOrderingHeadRevision} is null
            and ${table.resultingOrderingHeadRevision} is null
            and ${table.orderingHeadScopeToken} is null
            and ${table.orderingHeadComparatorId} is null
            and ${table.orderingHeadComparatorRevision} is null
          ) or (
            ${table.resultingOrderingHeadRevision} is not null
            and ${routingTokenSql(table.orderingHeadScopeToken)}
            and ${catalogIdSql(table.orderingHeadComparatorId)}
            and ${table.orderingHeadComparatorRevision} >= 1
          )
        )`
    ),
    check(
      "inbox_v2_deferred_action_transitions_state_check",
      transitionStateSql(table)
    ),
    check(
      "inbox_v2_deferred_action_transitions_detail_check",
      sql`(${boundedJsonObjectSql(table.transitionDetail, 32_768)}
        and ${jsonSha256PrefixedSql(
          table.transitionDetail,
          table.transitionDetailDigestSha256
        )}
        and ${sha256PrefixedSql(table.commitDigestSha256)}
        and (${table.transitionDetail} #>> '{action,id}') = ${table.actionId}
        and (${table.transitionDetail} #>> '{expectedRevision}') =
          ${table.expectedRevision}::text
        and (${table.transitionDetail} #>> '{resultingRevision}') =
          ${table.resultingRevision}::text
        and (${table.transitionDetail} #>> '{afterState,state}') =
          ${table.afterState}::text
        and (${table.transitionDetail} #>> '{orderingOutcome}') =
          ${table.orderingOutcome}::text
        and not (${table.transitionDetail} ?| array[
          'body', 'content', 'sender', 'displaySender', 'messageContent',
          'effectProof'
        ])) is true`
    ),
    check(
      "inbox_v2_deferred_action_transitions_clock_check",
      sql`isfinite(${table.recordedAt})`
    ),
    index("inbox_v2_deferred_action_transitions_target_idx").on(
      table.tenantId,
      table.targetExternalMessageReferenceId,
      table.actionId
    )
  ]
);

/** Normalized, bounded candidates for target_conflicted terminal states. */
export const inboxV2DeferredSourceActionConflictCandidates = pgTable(
  "inbox_v2_deferred_source_action_conflict_candidates",
  {
    tenantId: text("tenant_id").notNull(),
    actionId: text("action_id").notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    messageId: text("message_id").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256").notNull(),
    candidateDetail: jsonb("candidate_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    candidateDetailDigestSha256: text(
      "candidate_detail_digest_sha256"
    ).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_deferred_action_candidates_pk",
      columns: [table.tenantId, table.actionId, table.ordinal]
    }),
    unique("inbox_v2_deferred_action_candidates_reference_unique").on(
      table.tenantId,
      table.actionId,
      table.externalMessageReferenceId
    ),
    foreignKey({
      name: "inbox_v2_deferred_action_candidates_transition_fk",
      columns: [table.tenantId, table.actionId, table.resultingRevision],
      foreignColumns: [
        inboxV2DeferredMessageSourceActionTransitions.tenantId,
        inboxV2DeferredMessageSourceActionTransitions.actionId,
        inboxV2DeferredMessageSourceActionTransitions.resultingRevision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_deferred_action_candidates_reference_fk",
      columns: [
        table.tenantId,
        table.externalMessageReferenceId,
        table.externalThreadId,
        table.messageId,
        table.timelineItemId,
        table.messageKeyDigestSha256
      ],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id,
        inboxV2ExternalMessageReferences.externalThreadId,
        inboxV2ExternalMessageReferences.messageId,
        inboxV2ExternalMessageReferences.timelineItemId,
        inboxV2ExternalMessageReferences.messageKeyDigestSha256
      ]
    }),
    check(
      "inbox_v2_deferred_action_candidates_values_check",
      sql`(${table.resultingRevision} >= 2
        and ${table.ordinal} between 0 and 99
        and ${sha256HexSql(table.messageKeyDigestSha256)}
        and ${boundedJsonObjectSql(table.candidateDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.candidateDetail,
          table.candidateDetailDigestSha256
        )}
        and (${table.candidateDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.candidateDetail} #>> '{id}') =
          ${table.externalMessageReferenceId}
        and (${table.candidateDetail} #>> '{externalThread,id}') =
          ${table.externalThreadId}
        and (${table.candidateDetail} #>> '{timelineItem,id}') =
          ${table.timelineItemId}
        and (${table.candidateDetail} #>> '{message,id}') = ${table.messageId}
        and isfinite(${table.createdAt})) is true`
    ),
    index("inbox_v2_deferred_action_candidates_reference_idx").on(
      table.tenantId,
      table.externalMessageReferenceId,
      table.actionId
    )
  ]
);

/**
 * Current monotonic provider position per complete exact-key ordering scope.
 * A digest collision is rejected by the immutable full-key comparison guard;
 * it can never select or mutate an unrelated head.
 */
export const inboxV2DeferredSourceActionOrderingHeads = pgTable(
  "inbox_v2_deferred_source_action_ordering_heads",
  {
    tenantId: text("tenant_id").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(() =>
        externalMessageKeyDigestSql({
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
    messageRealmId: text("message_realm_id").notNull(),
    messageRealmVersion: text("message_realm_version").notNull(),
    messageCanonicalizationVersion: text(
      "message_canonicalization_version"
    ).notNull(),
    messageScopeKind:
      inboxV2ExternalMessageScopeKind("message_scope_kind").notNull(),
    messageScopeSourceAccountId: text("message_scope_source_account_id"),
    messageScopeSourceThreadBindingId: text(
      "message_scope_source_thread_binding_id"
    ),
    messageObjectKindId: text("message_object_kind_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    externalMessageKeyDetail: jsonb("external_message_key_detail")
      .$type<CanonicalDetail>()
      .notNull(),
    externalMessageKeyDetailDigestSha256: text(
      "external_message_key_detail_digest_sha256"
    ).notNull(),
    lane: inboxV2DeferredSourceActionLane("lane").notNull(),
    scopeToken: text("scope_token").notNull(),
    comparatorId: text("comparator_id").notNull(),
    comparatorRevision: bigint("comparator_revision", {
      mode: "bigint"
    }).notNull(),
    latestActionId: text("latest_action_id").notNull(),
    latestNormalizedInboundEventId: text(
      "latest_normalized_inbound_event_id"
    ).notNull(),
    latestSourceOccurrenceId: text("latest_source_occurrence_id").notNull(),
    latestSemanticId: text("latest_semantic_id").notNull(),
    latestEventFingerprintSha256: text(
      "latest_event_fingerprint_sha256"
    ).notNull(),
    latestPosition: text("latest_position").notNull(),
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
      name: "inbox_v2_deferred_action_ordering_heads_pk",
      columns: [
        table.tenantId,
        table.messageKeyDigestSha256,
        table.lane,
        table.scopeToken,
        table.comparatorId,
        table.comparatorRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_key_registry_fk",
      columns: [table.tenantId, table.messageKeyDigestSha256],
      foreignColumns: [
        inboxV2SourceMessageKeyRegistry.tenantId,
        inboxV2SourceMessageKeyRegistry.messageKeyDigestSha256
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_thread_fk",
      columns: [table.tenantId, table.externalThreadId],
      foreignColumns: [
        inboxV2ExternalThreads.tenantId,
        inboxV2ExternalThreads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_account_fk",
      columns: [table.tenantId, table.messageScopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_binding_fk",
      columns: [table.tenantId, table.messageScopeSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_deferred_action_ordering_heads_latest_fk",
      columns: [
        table.tenantId,
        table.latestActionId,
        table.messageKeyDigestSha256,
        table.lane,
        table.scopeToken,
        table.comparatorId,
        table.comparatorRevision,
        table.latestNormalizedInboundEventId,
        table.latestSourceOccurrenceId,
        table.latestSemanticId,
        table.latestEventFingerprintSha256
      ],
      foreignColumns: [
        inboxV2DeferredMessageSourceActions.tenantId,
        inboxV2DeferredMessageSourceActions.id,
        inboxV2DeferredMessageSourceActions.messageKeyDigestSha256,
        inboxV2DeferredMessageSourceActions.lane,
        inboxV2DeferredMessageSourceActions.orderingScopeToken,
        inboxV2DeferredMessageSourceActions.orderingComparatorId,
        inboxV2DeferredMessageSourceActions.orderingComparatorRevision,
        inboxV2DeferredMessageSourceActions.normalizedInboundEventId,
        inboxV2DeferredMessageSourceActions.sourceOccurrenceId,
        inboxV2DeferredMessageSourceActions.semanticId,
        inboxV2DeferredMessageSourceActions.eventFingerprintSha256
      ]
    }),
    check(
      "inbox_v2_deferred_action_ordering_heads_key_check",
      sql`(${catalogIdSql(table.messageRealmId)}
        and ${versionTokenSql(table.messageRealmVersion)}
        and ${versionTokenSql(table.messageCanonicalizationVersion)}
        and ${catalogIdSql(table.messageObjectKindId)}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}
        and ${sha256HexSql(table.messageKeyDigestSha256)}
        and ${boundedJsonObjectSql(table.externalMessageKeyDetail, 65_536)}
        and ${jsonSha256PrefixedSql(
          table.externalMessageKeyDetail,
          table.externalMessageKeyDetailDigestSha256
        )}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmId}') =
          ${table.messageRealmId}
        and (${table.externalMessageKeyDetail} #>> '{realm,realmVersion}') =
          ${table.messageRealmVersion}
        and (${table.externalMessageKeyDetail} #>>
          '{realm,canonicalizationVersion}') =
          ${table.messageCanonicalizationVersion}
        and (${table.externalMessageKeyDetail} #>> '{scope,kind}') =
          ${table.messageScopeKind}::text
        and (${table.externalMessageKeyDetail} #>> '{scope,owner,id}') is not
          distinct from coalesce(
            ${table.messageScopeSourceAccountId},
            ${table.messageScopeSourceThreadBindingId}
          )
        and (${table.externalMessageKeyDetail} #>> '{objectKindId}') =
          ${table.messageObjectKindId}
        and (${table.externalMessageKeyDetail} #>> '{externalThread,id}') =
          ${table.externalThreadId}
        and (${table.externalMessageKeyDetail} #>>
          '{canonicalExternalSubject}') = ${table.canonicalExternalSubject})
        is true`
    ),
    check(
      "inbox_v2_deferred_action_ordering_heads_scope_check",
      sql`(
          ${table.messageScopeKind} = 'provider_thread'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_account'
          and ${table.messageScopeSourceAccountId} is not null
          and ${table.messageScopeSourceThreadBindingId} is null
        ) or (
          ${table.messageScopeKind} = 'source_thread_binding'
          and ${table.messageScopeSourceAccountId} is null
          and ${table.messageScopeSourceThreadBindingId} is not null
        )`
    ),
    check(
      "inbox_v2_deferred_action_ordering_heads_values_check",
      sql`${routingTokenSql(table.scopeToken)}
        and ${catalogIdSql(table.comparatorId)}
        and ${table.comparatorRevision} >= 1
        and ${catalogIdSql(table.latestSemanticId)}
        and ${sha256HexSql(table.latestEventFingerprintSha256)}
        and ${canonicalPositionSql(table.latestPosition)}
        and ${table.revision} >= 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_deferred_action_ordering_heads_latest_idx").on(
      table.tenantId,
      table.latestActionId,
      table.revision
    )
  ]
);

/**
 * Target-free, finite weak-correlation evidence. It is never a dedupe key and
 * cannot name a Message, external reference or outbound dispatch.
 */
export const inboxV2SourceMessageCorrelationEvidence = pgTable(
  "inbox_v2_source_message_correlation_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    codeId: text("code_id").notNull(),
    evidenceHmacSha256: text("evidence_hmac_sha256").notNull(),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    dataClassId: text("data_class_id")
      .notNull()
      .default("core:operational_log_trace_diagnostic"),
    sensitivityClass: text("sensitivity_class")
      .notNull()
      .default("security_evidence"),
    processingPurposeId: text("processing_purpose_id")
      .notNull()
      .default("core:source_replay_and_diagnostics"),
    canonicalAnchorId: text("canonical_anchor_id")
      .notNull()
      .default("core:creation"),
    expiryAction: text("expiry_action").notNull().default("hard_delete"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_message_correlation_evidence_pk",
      columns: [table.tenantId, table.sourceOccurrenceId, table.ordinal]
    }),
    unique("inbox_v2_source_message_correlation_evidence_identity_unique").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.codeId,
      table.evidenceHmacSha256
    ),
    foreignKey({
      name: "inbox_v2_source_message_correlation_evidence_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_message_correlation_evidence_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_source_message_correlation_evidence_values_check",
      sql`${table.ordinal} between 0 and 7
        and ${catalogIdSql(table.codeId)}
        and ${hmacSha256Sql(table.evidenceHmacSha256)}
        and isfinite(${table.createdAt})
        and isfinite(${table.expiresAt})
        and ${table.expiresAt} > ${table.createdAt}
        and ${table.expiresAt} <= ${table.createdAt} + interval '30 days'`
    ),
    check(
      "inbox_v2_source_message_correlation_evidence_governance_check",
      sql`${table.dataClassId} =
          'core:operational_log_trace_diagnostic'
        and ${table.sensitivityClass} = 'security_evidence'
        and ${table.processingPurposeId} =
          'core:source_replay_and_diagnostics'
        and ${table.canonicalAnchorId} = 'core:creation'
        and ${table.expiryAction} = 'hard_delete'`
    ),
    index("inbox_v2_source_message_correlation_evidence_expiry_idx").on(
      table.tenantId,
      table.expiresAt,
      table.sourceOccurrenceId,
      table.ordinal
    )
  ]
);

type ExternalMessageKeyColumnNames = Readonly<{
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

type DeferredActionStateColumns = Readonly<{
  id: SQLWrapper;
  state: SQLWrapper;
  appliedExternalMessageReferenceId: SQLWrapper;
  appliedMessageId: SQLWrapper;
  appliedMessageRevision: SQLWrapper;
  appliedProviderLifecycleOperationId: SQLWrapper;
  appliedProviderLifecycleOperationRevision: SQLWrapper;
  effectKind: SQLWrapper;
  relatedActionId: SQLWrapper;
  stateReasonId: SQLWrapper;
  conflictCandidateCount: SQLWrapper;
  conflictCandidateDigestSha256: SQLWrapper;
  terminalAt: SQLWrapper;
  revision: SQLWrapper;
}>;

type DeferredTransitionStateColumns = Readonly<{
  afterState: SQLWrapper;
  orderingOutcome: SQLWrapper;
  targetExternalMessageReferenceId: SQLWrapper;
  targetMessageId: SQLWrapper;
  appliedMessageRevision: SQLWrapper;
  appliedProviderLifecycleOperationId: SQLWrapper;
  appliedProviderLifecycleOperationRevision: SQLWrapper;
  effectKind: SQLWrapper;
  relatedActionId: SQLWrapper;
  reasonId: SQLWrapper;
  conflictCandidateCount: SQLWrapper;
  conflictCandidateDigestSha256: SQLWrapper;
  sourceOccurrenceExpectedRevision: SQLWrapper;
  sourceOccurrenceResultingRevision: SQLWrapper;
  sourceOccurrenceResolutionDigestSha256: SQLWrapper;
  effectProofDigestSha256: SQLWrapper;
}>;

function externalMessageKeyDigestSql(columns: ExternalMessageKeyColumnNames) {
  const lengthPrefixed = (columnName: string) => {
    const column = sql.identifier(columnName);
    return sql`octet_length(${column})::text || ':' || ${column}`;
  };
  const nullableLengthPrefixed = (columnName: string) => {
    const column = sql.identifier(columnName);
    return sql`case when ${column} is null then '-1:'
      else octet_length(${column})::text || ':' || ${column} end`;
  };

  return sql`encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        ${lengthPrefixed(columns.realmId)} ||
        ${lengthPrefixed(columns.realmVersion)} ||
        ${lengthPrefixed(columns.canonicalizationVersion)} ||
        case ${sql.identifier(columns.scopeKind)}
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        ${nullableLengthPrefixed(columns.scopeSourceAccountId)} ||
        ${nullableLengthPrefixed(columns.scopeSourceThreadBindingId)} ||
        ${lengthPrefixed(columns.objectKindId)} ||
        ${lengthPrefixed(columns.externalThreadId)} ||
        ${lengthPrefixed(columns.canonicalExternalSubject)},
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )`;
}

function catalogIdSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) <= 256 and (
    (${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 160)
    or (${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column}, ':', 2)) <= 80
      and char_length(split_part(${column}, ':', 3)) <= 160
      and split_part(${column}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
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

function sha256HexSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^[a-f0-9]{64}$', false)`;
}

function sha256PrefixedSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^sha256:[a-f0-9]{64}$', false)`;
}

function jsonSha256PrefixedSql(
  detailColumn: SQLWrapper,
  digestColumn: SQLWrapper
) {
  return sql`${sha256PrefixedSql(digestColumn)}
    and jsonb_typeof(${detailColumn}) = 'object'`;
}

function hmacSha256Sql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^hmac-sha256:[a-f0-9]{64}$', false)`;
}

function canonicalPositionSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 1 and 128
    and ${column} ~ '^(0|[1-9][0-9]*)$'), false)`;
}

function boundedJsonObjectSql(column: SQLWrapper, maximumBytes: number) {
  return sql`coalesce((jsonb_typeof(${column}) = 'object'
    and octet_length(${column}::text) between 2 and ${sql.raw(
      String(maximumBytes)
    )}), false)`;
}

function deferredActionStateSql(table: DeferredActionStateColumns) {
  return sql`(
      ${table.state} = 'pending'
      and ${table.revision} = 1
      and num_nonnulls(
        ${table.appliedExternalMessageReferenceId}, ${table.appliedMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.relatedActionId}, ${table.stateReasonId},
        ${table.conflictCandidateDigestSha256}, ${table.terminalAt}
      ) = 0
      and ${table.conflictCandidateCount} = 0
    ) or (
      ${table.state} = 'applied'
      and ${table.revision} = 2
      and ${table.appliedExternalMessageReferenceId} is not null
      and ${table.appliedMessageId} is not null
      and ${table.appliedMessageRevision} >= 1
      and ${table.effectKind} is not null
      and (
        (${table.effectKind} = 'provider_delete_retain_local'
          and ${table.appliedProviderLifecycleOperationId} is not null
          and ${table.appliedProviderLifecycleOperationRevision} >= 1)
        or (${table.effectKind} <> 'provider_delete_retain_local'
          and ${table.appliedProviderLifecycleOperationId} is null
          and ${table.appliedProviderLifecycleOperationRevision} is null)
      )
      and ${table.relatedActionId} is null
      and ${table.stateReasonId} is null
      and ${table.conflictCandidateCount} = 0
      and ${table.conflictCandidateDigestSha256} is null
      and isfinite(${table.terminalAt})
    ) or (
      ${table.state} = 'target_conflicted'
      and ${table.revision} = 2
      and ${catalogIdSql(table.stateReasonId)}
      and ${table.conflictCandidateCount} between 2 and 100
      and ${sha256PrefixedSql(table.conflictCandidateDigestSha256)}
      and isfinite(${table.terminalAt})
      and num_nonnulls(
        ${table.appliedExternalMessageReferenceId}, ${table.appliedMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.relatedActionId}
      ) = 0
    ) or (
      ${table.state} in ('stale', 'duplicate')
      and ${table.revision} = 2
      and ${table.relatedActionId} is not null
      and ${table.relatedActionId} <> ${table.id}
      and isfinite(${table.terminalAt})
      and ${table.conflictCandidateCount} = 0
      and num_nonnulls(
        ${table.appliedExternalMessageReferenceId}, ${table.appliedMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.stateReasonId}, ${table.conflictCandidateDigestSha256}
      ) = 0
    ) or (
      ${table.state} = 'ordering_conflict'
      and ${table.revision} = 2
      and ${catalogIdSql(table.stateReasonId)}
      and (${table.relatedActionId} is null or ${table.relatedActionId} <>
        ${table.id})
      and isfinite(${table.terminalAt})
      and ${table.conflictCandidateCount} = 0
      and num_nonnulls(
        ${table.appliedExternalMessageReferenceId}, ${table.appliedMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.conflictCandidateDigestSha256}
      ) = 0
    ) or (
      ${table.state} = 'expired'
      and ${table.revision} = 2
      and ${catalogIdSql(table.stateReasonId)}
      and isfinite(${table.terminalAt})
      and ${table.conflictCandidateCount} = 0
      and num_nonnulls(
        ${table.appliedExternalMessageReferenceId}, ${table.appliedMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.relatedActionId}, ${table.conflictCandidateDigestSha256}
      ) = 0
    )`;
}

function transitionStateSql(table: DeferredTransitionStateColumns) {
  return sql`(
      ${table.afterState} = 'applied'
      and ${table.orderingOutcome} = 'advance'
      and ${table.targetExternalMessageReferenceId} is not null
      and ${table.targetMessageId} is not null
      and ${table.appliedMessageRevision} >= 1
      and ${table.effectKind} is not null
      and (
        (${table.effectKind} = 'provider_delete_retain_local'
          and ${table.appliedProviderLifecycleOperationId} is not null
          and ${table.appliedProviderLifecycleOperationRevision} >= 1)
        or (${table.effectKind} <> 'provider_delete_retain_local'
          and ${table.appliedProviderLifecycleOperationId} is null
          and ${table.appliedProviderLifecycleOperationRevision} is null)
      )
      and ${table.sourceOccurrenceExpectedRevision} >= 1
      and ${table.sourceOccurrenceResultingRevision} =
        ${table.sourceOccurrenceExpectedRevision} + 1
      and ${sha256PrefixedSql(table.sourceOccurrenceResolutionDigestSha256)}
      and ${sha256PrefixedSql(table.effectProofDigestSha256)}
      and ${table.relatedActionId} is null
      and ${table.reasonId} is null
      and ${table.conflictCandidateCount} = 0
      and ${table.conflictCandidateDigestSha256} is null
    ) or (
      ${table.afterState} = 'target_conflicted'
      and ${table.orderingOutcome} = 'not_evaluated'
      and ${catalogIdSql(table.reasonId)}
      and ${table.conflictCandidateCount} between 2 and 100
      and ${sha256PrefixedSql(table.conflictCandidateDigestSha256)}
      and num_nonnulls(
        ${table.targetExternalMessageReferenceId}, ${table.targetMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.relatedActionId}, ${table.sourceOccurrenceExpectedRevision},
        ${table.sourceOccurrenceResultingRevision},
        ${table.sourceOccurrenceResolutionDigestSha256},
        ${table.effectProofDigestSha256}
      ) = 0
    ) or (
      ${table.afterState} in ('stale', 'duplicate')
      and (
        (${table.afterState} = 'stale'
          and ${table.orderingOutcome} = 'stale')
        or (${table.afterState} = 'duplicate'
          and ${table.orderingOutcome} = 'duplicate')
      )
      and ${table.relatedActionId} is not null
      and ${table.conflictCandidateCount} = 0
      and ${table.effectKind} is null
      and ${table.appliedMessageRevision} is null
      and ${table.appliedProviderLifecycleOperationId} is null
      and ${table.appliedProviderLifecycleOperationRevision} is null
      and ${table.reasonId} is null
      and ${table.conflictCandidateDigestSha256} is null
      and ${table.effectProofDigestSha256} is null
      and (
        num_nonnulls(
          ${table.targetExternalMessageReferenceId}, ${table.targetMessageId},
          ${table.sourceOccurrenceExpectedRevision},
          ${table.sourceOccurrenceResultingRevision},
          ${table.sourceOccurrenceResolutionDigestSha256}
        ) = 0
        or (
          num_nonnulls(
            ${table.targetExternalMessageReferenceId}, ${table.targetMessageId},
            ${table.sourceOccurrenceExpectedRevision},
            ${table.sourceOccurrenceResultingRevision},
            ${table.sourceOccurrenceResolutionDigestSha256}
          ) = 5
          and ${table.targetExternalMessageReferenceId} is not null
          and ${table.targetMessageId} is not null
          and ${table.sourceOccurrenceExpectedRevision} >= 1
          and ${table.sourceOccurrenceResultingRevision} =
            ${table.sourceOccurrenceExpectedRevision} + 1
          and ${sha256PrefixedSql(table.sourceOccurrenceResolutionDigestSha256)}
        )
      )
    ) or (
      ${table.afterState} = 'ordering_conflict'
      and ${table.orderingOutcome} = 'conflict'
      and ${catalogIdSql(table.reasonId)}
      and ${table.conflictCandidateCount} = 0
      and num_nonnulls(
        ${table.targetExternalMessageReferenceId}, ${table.targetMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.conflictCandidateDigestSha256},
        ${table.sourceOccurrenceExpectedRevision},
        ${table.sourceOccurrenceResultingRevision},
        ${table.sourceOccurrenceResolutionDigestSha256},
        ${table.effectProofDigestSha256}
      ) = 0
    ) or (
      ${table.afterState} = 'expired'
      and ${table.orderingOutcome} = 'not_evaluated'
      and ${catalogIdSql(table.reasonId)}
      and ${table.relatedActionId} is null
      and ${table.conflictCandidateCount} = 0
      and num_nonnulls(
        ${table.targetExternalMessageReferenceId}, ${table.targetMessageId},
        ${table.appliedMessageRevision},
        ${table.appliedProviderLifecycleOperationId},
        ${table.appliedProviderLifecycleOperationRevision}, ${table.effectKind},
        ${table.conflictCandidateDigestSha256},
        ${table.sourceOccurrenceExpectedRevision},
        ${table.sourceOccurrenceResultingRevision},
        ${table.sourceOccurrenceResolutionDigestSha256},
        ${table.effectProofDigestSha256}
      ) = 0
    )`;
}

/** Direct-DML guards for immutable provenance, one terminal CAS and exact heads. */
export const INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_source_reconciliation_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and pg_trigger_depth() > 1
     and not exists (
       select 1 from public.tenants tenant_row
       where tenant_row.id = old.tenant_id
     ) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_reconciliation_immutable:%s:%s',
      tg_table_name,
      tg_op
    );
end
$function$;

create or replace function public.inbox_v2_deferred_source_action_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
  adapter_contract_detail jsonb;
  provider_reference_detail jsonb;
  provider_timestamp_detail jsonb;
  provider_reference_count bigint;
  provider_timestamp_count bigint;
  expected_occurrence_detail jsonb;
  immutable_columns_changed boolean;
  immutable_changed_column_names text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 and not exists (
      select 1 from public.tenants tenant_row
      where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.revision <> 1
       or new.created_at <> new.updated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_invalid_initial';
    end if;

    select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = new.source_occurrence_id
    for share;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_induction_mismatch';
    end if;

    select reference_summary.detail,
           reference_summary.row_count,
           timestamp_summary.detail,
           timestamp_summary.row_count
    into provider_reference_detail,
         provider_reference_count,
         provider_timestamp_detail,
         provider_timestamp_count
    from (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kindId', child_row.kind_id,
                   'subject', child_row.subject
                 ) order by child_row.ordinal
               ),
               '[]'::jsonb
             ) as detail,
             count(*) as row_count
      from public.inbox_v2_source_occurrence_provider_references child_row
      where child_row.tenant_id = new.tenant_id
        and child_row.source_occurrence_id = new.source_occurrence_id
    ) reference_summary
    cross join (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kindId', child_row.kind_id,
                   'timestamp', to_char(
                     child_row.timestamp at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                   )
                 ) order by child_row.ordinal
               ),
               '[]'::jsonb
             ) as detail,
             count(*) as row_count
      from public.inbox_v2_source_occurrence_provider_timestamps child_row
      where child_row.tenant_id = new.tenant_id
        and child_row.source_occurrence_id = new.source_occurrence_id
    ) timestamp_summary;

    if occurrence_row.resolution_state <> 'pending'
       or occurrence_row.revision <> new.source_occurrence_revision
       or occurrence_row.normalized_inbound_event_id <>
          new.normalized_inbound_event_id
       or occurrence_row.message_realm_id <> new.message_realm_id
       or occurrence_row.message_realm_version <> new.message_realm_version
       or occurrence_row.message_canonicalization_version <>
          new.message_canonicalization_version
       or occurrence_row.message_scope_kind::text <>
          new.message_scope_kind::text
       or occurrence_row.message_scope_source_account_id is distinct from
          new.message_scope_source_account_id
       or occurrence_row.message_scope_source_thread_binding_id is distinct from
          new.message_scope_source_thread_binding_id
       or occurrence_row.message_object_kind_id <> new.message_object_kind_id
       or occurrence_row.external_thread_id <> new.external_thread_id
       or occurrence_row.canonical_external_subject <>
          new.canonical_external_subject
       or occurrence_row.message_key_digest_sha256 <>
          new.message_key_digest_sha256
       or occurrence_row.source_account_id <> new.source_account_id
       or occurrence_row.source_thread_binding_id <>
          new.source_thread_binding_id
       or occurrence_row.binding_generation <> new.binding_generation
       or occurrence_row.adapter_contract_id <> new.adapter_contract_id
       or occurrence_row.adapter_contract_version <>
          new.adapter_contract_version
       or occurrence_row.adapter_declaration_revision <>
          new.adapter_declaration_revision
       or occurrence_row.adapter_surface_id <> new.adapter_surface_id
       or occurrence_row.adapter_loaded_by_trusted_service_id <>
          new.adapter_loaded_by_trusted_service_id
       or occurrence_row.adapter_loaded_at <> new.adapter_loaded_at
       or occurrence_row.capability_revision <> new.capability_revision
       or occurrence_row.provider_actor_source_external_identity_id is distinct from
          new.actor_source_external_identity_id
       or occurrence_row.observed_at <> new.observed_at
       or occurrence_row.recorded_at <> new.recorded_at
       or new.declared_by_trusted_service_id <>
          new.adapter_loaded_by_trusted_service_id
       or new.semantic_proof_detail -> 'externalMessageReference' is distinct from
          'null'::jsonb
       or new.semantic_proof_detail -> 'sourceOccurrence' is distinct from
          'null'::jsonb
       or (new.semantic_proof_detail #>> '{occurredAt}')::timestamptz is distinct from
          new.observed_at
       or (new.semantic_proof_detail #>> '{recordedAt}')::timestamptz is distinct from
          new.recorded_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_induction_mismatch';
    end if;

    adapter_contract_detail := jsonb_build_object(
      'contractId', occurrence_row.adapter_contract_id,
      'contractVersion', occurrence_row.adapter_contract_version,
      'declarationRevision', occurrence_row.adapter_declaration_revision::text,
      'surfaceId', occurrence_row.adapter_surface_id,
      'loadedByTrustedServiceId',
        occurrence_row.adapter_loaded_by_trusted_service_id,
      'loadedAt', to_char(
        occurrence_row.adapter_loaded_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );

    expected_occurrence_detail := jsonb_build_object(
      'tenantId', occurrence_row.tenant_id,
      'id', occurrence_row.id,
      'messageKey', jsonb_build_object(
        'realm', jsonb_build_object(
          'realmId', occurrence_row.message_realm_id,
          'realmVersion', occurrence_row.message_realm_version,
          'canonicalizationVersion',
            occurrence_row.message_canonicalization_version
        ),
        'scope', case occurrence_row.message_scope_kind
          when 'provider_thread' then jsonb_build_object(
            'kind', 'provider_thread'
          )
          when 'source_account' then jsonb_build_object(
            'kind', 'source_account',
            'owner', jsonb_build_object(
              'tenantId', occurrence_row.tenant_id,
              'kind', 'source_account',
              'id', occurrence_row.message_scope_source_account_id
            )
          )
          when 'source_thread_binding' then jsonb_build_object(
            'kind', 'source_thread_binding',
            'owner', jsonb_build_object(
              'tenantId', occurrence_row.tenant_id,
              'kind', 'source_thread_binding',
              'id', occurrence_row.message_scope_source_thread_binding_id
            )
          )
        end,
        'objectKindId', occurrence_row.message_object_kind_id,
        'externalThread', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'external_thread',
          'id', occurrence_row.external_thread_id
        ),
        'canonicalExternalSubject',
          occurrence_row.canonical_external_subject
      ),
      'messageIdentityDeclaration', jsonb_build_object(
        'adapterContract', adapter_contract_detail,
        'identityKind', 'message',
        'realmId', occurrence_row.message_realm_id,
        'realmVersion', occurrence_row.message_realm_version,
        'canonicalizationVersion',
          occurrence_row.message_canonicalization_version,
        'objectKindId', occurrence_row.message_object_kind_id,
        'scopeKind', occurrence_row.message_scope_kind,
        'decisionStrength', occurrence_row.message_decision_strength
      ),
      'bindingContext', jsonb_build_object(
        'externalThread', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'external_thread',
          'id', occurrence_row.external_thread_id
        ),
        'sourceAccount', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'source_account',
          'id', occurrence_row.source_account_id
        ),
        'sourceThreadBinding', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'source_thread_binding',
          'id', occurrence_row.source_thread_binding_id
        ),
        'bindingGeneration', occurrence_row.binding_generation::text
      ),
      'origin', case occurrence_row.origin_kind
        when 'provider_response' then jsonb_build_object(
          'kind', 'provider_response',
          'sourceAccount', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_account',
            'id', occurrence_row.source_account_id
          ),
          'outboundDispatchAttempt', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'outbound_dispatch_attempt',
            'id', occurrence_row.outbound_dispatch_attempt_id
          )
        )
        else jsonb_build_object(
          'kind', occurrence_row.origin_kind,
          'sourceAccount', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_account',
            'id', occurrence_row.source_account_id
          ),
          'rawInboundEvent', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'raw_inbound_event',
            'id', occurrence_row.raw_inbound_event_id
          ),
          'normalizedInboundEvent', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'normalized_inbound_event',
            'id', occurrence_row.normalized_inbound_event_id
          )
        )
      end,
      'descriptor', jsonb_build_object(
        'adapterContract', adapter_contract_detail,
        'descriptorSchemaId', occurrence_row.descriptor_schema_id,
        'descriptorVersion', occurrence_row.descriptor_version,
        'capabilityRevision', occurrence_row.capability_revision::text,
        'providerReferences', provider_reference_detail,
        'descriptorDigestSha256', occurrence_row.descriptor_digest_sha256
      ),
      'providerActor', case occurrence_row.provider_actor_kind
        when 'source_external_identity' then jsonb_build_object(
          'kind', 'source_external_identity',
          'sourceExternalIdentity', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_external_identity',
            'id', occurrence_row.provider_actor_source_external_identity_id
          )
        )
        when 'provider_system' then jsonb_build_object(
          'kind', 'provider_system',
          'actorKindId', occurrence_row.provider_system_actor_kind_id,
          'actorSubject', occurrence_row.provider_system_actor_subject
        )
        else 'null'::jsonb
      end,
      'direction', occurrence_row.direction,
      'providerTimestamps', provider_timestamp_detail,
      'referencePortability', jsonb_build_object(
        'kind', occurrence_row.reference_portability_kind,
        'adapterContract', adapter_contract_detail,
        'decisionStrength',
          occurrence_row.reference_portability_decision_strength
      ),
      'resolution', jsonb_build_object(
        'state', 'pending',
        'diagnostic', jsonb_build_object(
          'codeId', occurrence_row.resolution_diagnostic_code_id,
          'retryable', occurrence_row.resolution_diagnostic_retryable,
          'correlationToken',
            occurrence_row.resolution_diagnostic_correlation_token,
          'safeOperatorHintId',
            occurrence_row.resolution_diagnostic_safe_operator_hint_id
        )
      ),
      'observedAt', to_char(
        occurrence_row.observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'recordedAt', to_char(
        occurrence_row.recorded_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'revision', occurrence_row.revision::text,
      'createdAt', to_char(
        occurrence_row.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'updatedAt', to_char(
        occurrence_row.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );

    if provider_reference_count <> occurrence_row.provider_reference_count
       or provider_timestamp_count <> occurrence_row.provider_timestamp_count
       or new.source_occurrence_detail is distinct from
          expected_occurrence_detail then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_occurrence_snapshot_mismatch';
    end if;
    return new;
  end if;

  if old.state <> 'pending'
     and (to_jsonb(new) - 'message_key_digest_sha256') is not distinct from
         (to_jsonb(old) - 'message_key_digest_sha256') then
    -- An exact replay is not a second state transition. Keeping it legal lets
    -- the deferred assertion revalidate immutable historical evidence after a
    -- later action has advanced the same ordering head.
    return new;
  end if;

  immutable_columns_changed := (
       to_jsonb(new) - array[
         'message_key_digest_sha256',
         'state', 'applied_external_message_reference_id',
         'applied_message_id', 'applied_message_revision',
         'applied_provider_lifecycle_operation_id',
         'applied_provider_lifecycle_operation_revision', 'effect_kind',
         'related_action_id', 'state_reason_id', 'conflict_candidate_count',
         'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
         'updated_at'
       ]
     ) is distinct from (
       to_jsonb(old) - array[
         'message_key_digest_sha256',
         'state', 'applied_external_message_reference_id',
         'applied_message_id', 'applied_message_revision',
         'applied_provider_lifecycle_operation_id',
         'applied_provider_lifecycle_operation_revision', 'effect_kind',
         'related_action_id', 'state_reason_id', 'conflict_candidate_count',
         'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
         'updated_at'
       ]
     );

  if immutable_columns_changed then
    select string_agg(keys.key, ',' order by keys.key)
    into immutable_changed_column_names
    from jsonb_object_keys(to_jsonb(new) || to_jsonb(old)) keys(key)
    where to_jsonb(new) -> keys.key is distinct from
          to_jsonb(old) -> keys.key
      and keys.key <> all (array[
        'message_key_digest_sha256',
        'state', 'applied_external_message_reference_id',
        'applied_message_id', 'applied_message_revision',
        'applied_provider_lifecycle_operation_id',
        'applied_provider_lifecycle_operation_revision', 'effect_kind',
        'related_action_id', 'state_reason_id', 'conflict_candidate_count',
        'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
        'updated_at'
      ]);
  end if;

  if immutable_columns_changed
     or old.state <> 'pending'
     or new.state = 'pending'
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or new.terminal_at <> new.updated_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.deferred_source_action_cas',
      detail = format(
        'immutable_columns_changed=%s immutable_changed_columns=%s old_state=%s new_state=%s old_revision=%s new_revision=%s old_updated_at=%s new_updated_at=%s terminal_at=%s',
        immutable_columns_changed, immutable_changed_column_names, old.state,
        new.state, old.revision, new.revision, old.updated_at, new.updated_at,
        new.terminal_at
      );
  end if;

  if new.state = 'applied' and not exists (
    select 1
    from public.inbox_v2_external_message_references reference_row
    where reference_row.tenant_id = new.tenant_id
      and reference_row.id = new.applied_external_message_reference_id
      and reference_row.message_id = new.applied_message_id
      and reference_row.external_thread_id = new.external_thread_id
      and reference_row.realm_id = new.message_realm_id
      and reference_row.realm_version = new.message_realm_version
      and reference_row.canonicalization_version =
        new.message_canonicalization_version
      and reference_row.scope_kind = new.message_scope_kind
      and reference_row.scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and reference_row.scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and reference_row.object_kind_id = new.message_object_kind_id
      and reference_row.canonical_external_subject =
        new.canonical_external_subject
      and reference_row.message_key_digest_sha256 =
        old.message_key_digest_sha256
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_applied_target_mismatch';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_deferred_source_ordering_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 and not exists (
      select 1 from public.tenants tenant_row
      where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_ordering_head_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_ordering_head_initial';
    end if;
    return new;
  end if;

  if row(
       new.tenant_id, new.message_realm_id, new.message_realm_version,
       new.message_canonicalization_version, new.message_scope_kind,
       new.message_scope_source_account_id,
       new.message_scope_source_thread_binding_id,
       new.message_object_kind_id, new.external_thread_id,
       new.canonical_external_subject, new.external_message_key_detail,
       new.external_message_key_detail_digest_sha256, new.lane,
       new.scope_token, new.comparator_id, new.comparator_revision,
       new.created_at
     ) is distinct from row(
       old.tenant_id, old.message_realm_id, old.message_realm_version,
       old.message_canonicalization_version, old.message_scope_kind,
       old.message_scope_source_account_id,
       old.message_scope_source_thread_binding_id,
       old.message_object_kind_id, old.external_thread_id,
       old.canonical_external_subject, old.external_message_key_detail,
       old.external_message_key_detail_digest_sha256, old.lane,
       old.scope_token, old.comparator_id, old.comparator_revision,
       old.created_at
     )
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or char_length(new.latest_position) < char_length(old.latest_position)
     or (
       char_length(new.latest_position) = char_length(old.latest_position)
       and new.latest_position collate "C" <= old.latest_position collate "C"
     ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.deferred_source_ordering_head_cas';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_source_message_key_registry_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.inbox_v2_source_message_key_registry registry_row
    where registry_row.tenant_id = new.tenant_id
      and registry_row.message_key_digest_sha256 =
        new.message_key_digest_sha256
      and registry_row.message_realm_id = new.message_realm_id
      and registry_row.message_realm_version = new.message_realm_version
      and registry_row.message_canonicalization_version =
        new.message_canonicalization_version
      and registry_row.message_scope_kind = new.message_scope_kind
      and registry_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and registry_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and registry_row.message_object_kind_id = new.message_object_kind_id
      and registry_row.external_thread_id = new.external_thread_id
      and registry_row.canonical_external_subject =
        new.canonical_external_subject
      and registry_row.external_message_key_detail =
        new.external_message_key_detail
      and registry_row.external_message_key_detail_digest_sha256 =
        new.external_message_key_detail_digest_sha256
  ) then
    raise exception using
      errcode = '23514',
      message = case tg_table_name
        when 'inbox_v2_deferred_message_source_actions' then
          'inbox_v2.deferred_source_action_message_key_registry_mismatch'
        else
          'inbox_v2.deferred_source_ordering_head_message_key_registry_mismatch'
      end;
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_source_correlation_evidence_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.expires_at <= clock_timestamp() then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_correlation_evidence_expired';
    end if;
    if not exists (
      select 1
      from public.inbox_v2_source_occurrences occurrence_row
      where occurrence_row.tenant_id = new.tenant_id
        and occurrence_row.id = new.source_occurrence_id
        and occurrence_row.recorded_at <= new.created_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_correlation_evidence_occurrence_mismatch';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and (
       clock_timestamp() >= old.expires_at
       or (
         pg_trigger_depth() > 1
         and (
           not exists (
             select 1 from public.tenants tenant_row
             where tenant_row.id = old.tenant_id
           )
           or not exists (
             select 1
             from public.inbox_v2_source_occurrences occurrence_row
             where occurrence_row.tenant_id = old.tenant_id
               and occurrence_row.id = old.source_occurrence_id
           )
         )
       )
     ) then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_correlation_evidence_immutable:%s', tg_op
    );
end
$function$;

create or replace function public.inbox_v2_deferred_source_action_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_row public.inbox_v2_deferred_message_source_action_transitions%rowtype;
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
  related_action_row public.inbox_v2_deferred_message_source_actions%rowtype;
  related_transition_row public.inbox_v2_deferred_message_source_action_transitions%rowtype;
  candidate_count bigint;
  candidate_min smallint;
  candidate_max smallint;
begin
  if new.state = 'pending' then
    if exists (
      select 1
      from public.inbox_v2_deferred_message_source_action_transitions t
      where t.tenant_id = new.tenant_id and t.action_id = new.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_pending_has_transition';
    end if;
    return null;
  end if;

  select * into transition_row
  from public.inbox_v2_deferred_message_source_action_transitions candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.action_id = new.id;

  if not found
     or transition_row.expected_revision <> new.revision - 1
     or transition_row.resulting_revision <> new.revision
     or transition_row.after_state <> new.state
     or transition_row.effect_kind is distinct from new.effect_kind
     or (new.state not in ('stale', 'duplicate') and (
       transition_row.target_external_message_reference_id is distinct from
         new.applied_external_message_reference_id
       or transition_row.target_message_id is distinct from
         new.applied_message_id
       or transition_row.applied_message_revision is distinct from
         new.applied_message_revision
       or transition_row.applied_provider_lifecycle_operation_id is distinct
         from new.applied_provider_lifecycle_operation_id
       or transition_row.applied_provider_lifecycle_operation_revision is
         distinct from new.applied_provider_lifecycle_operation_revision
      ))
     or transition_row.related_action_id is distinct from new.related_action_id
     or transition_row.reason_id is distinct from new.state_reason_id
     or transition_row.conflict_candidate_count <>
        new.conflict_candidate_count
     or transition_row.conflict_candidate_digest_sha256 is distinct from
        new.conflict_candidate_digest_sha256
     or transition_row.recorded_at <> new.updated_at then
    raise exception using
      errcode = '23514',
    message = 'inbox_v2.deferred_source_action_transition_mismatch';
  end if;

  if new.state in ('stale', 'duplicate')
     or (new.state = 'ordering_conflict'
       and new.ordering_kind = 'monotonic_exact') then
    if transition_row.related_action_id is null
       or transition_row.expected_ordering_head_revision is null
       or transition_row.resulting_ordering_head_revision <>
          transition_row.expected_ordering_head_revision
       or transition_row.ordering_head_scope_token is null
       or transition_row.ordering_head_comparator_id is null
       or transition_row.ordering_head_comparator_revision is null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_missing';
    end if;

    select * into related_action_row
    from public.inbox_v2_deferred_message_source_actions candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = transition_row.related_action_id;

    if not found
       or related_action_row.state <> 'applied'
       or related_action_row.message_key_digest_sha256 <>
          new.message_key_digest_sha256
       or related_action_row.external_message_key_detail <>
          new.external_message_key_detail
       or related_action_row.lane <> new.lane
       or related_action_row.ordering_kind <> 'monotonic_exact'
       or related_action_row.ordering_scope_token <>
          transition_row.ordering_head_scope_token
       or related_action_row.ordering_comparator_id <>
          transition_row.ordering_head_comparator_id
       or related_action_row.ordering_comparator_revision <>
          transition_row.ordering_head_comparator_revision
       or new.ordering_scope_token <>
          transition_row.ordering_head_scope_token
       or new.ordering_comparator_id <>
          transition_row.ordering_head_comparator_id
       or new.ordering_comparator_revision <>
          transition_row.ordering_head_comparator_revision then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_mismatch';
    end if;

    select * into related_transition_row
    from public.inbox_v2_deferred_message_source_action_transitions candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.action_id = related_action_row.id;

    if not found
       or related_transition_row.after_state <> 'applied'
       or related_transition_row.ordering_outcome <> 'advance'
       or related_transition_row.resulting_ordering_head_revision <>
          transition_row.expected_ordering_head_revision
       or related_transition_row.ordering_head_scope_token <>
          transition_row.ordering_head_scope_token
       or related_transition_row.ordering_head_comparator_id <>
          transition_row.ordering_head_comparator_id
       or related_transition_row.ordering_head_comparator_revision <>
          transition_row.ordering_head_comparator_revision then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_mismatch';
    end if;

    if new.state = 'stale' and not (
         char_length(related_action_row.ordering_position) >
           char_length(new.ordering_position)
         or (
           char_length(related_action_row.ordering_position) =
             char_length(new.ordering_position)
           and related_action_row.ordering_position collate "C" >
             new.ordering_position collate "C"
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_stale_position_mismatch';
    elsif new.state = 'duplicate' and (
      related_action_row.ordering_position <> new.ordering_position
      or related_action_row.semantic_id <> new.semantic_id
      or related_action_row.event_fingerprint_sha256 <>
        new.event_fingerprint_sha256
      or row(
        related_action_row.normalized_inbound_event_id,
        related_action_row.source_occurrence_id,
        related_action_row.semantic_id,
        related_action_row.event_fingerprint_sha256
      ) is not distinct from row(
        new.normalized_inbound_event_id,
        new.source_occurrence_id,
        new.semantic_id,
        new.event_fingerprint_sha256
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_duplicate_identity_mismatch';
    elsif new.state = 'ordering_conflict' and (
      related_action_row.ordering_position <> new.ordering_position
      or row(
        related_action_row.semantic_id,
        related_action_row.event_fingerprint_sha256
      ) is not distinct from row(
        new.semantic_id,
        new.event_fingerprint_sha256
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_ordering_conflict_identity_mismatch';
    end if;
  end if;

  if transition_row.target_external_message_reference_id is not null
     and not exists (
       select 1
       from public.inbox_v2_external_message_references reference_row
       where reference_row.tenant_id = new.tenant_id
         and reference_row.id =
           transition_row.target_external_message_reference_id
         and reference_row.message_id = transition_row.target_message_id
         and reference_row.external_thread_id = new.external_thread_id
         and reference_row.realm_id = new.message_realm_id
         and reference_row.realm_version = new.message_realm_version
         and reference_row.canonicalization_version =
           new.message_canonicalization_version
         and reference_row.scope_kind = new.message_scope_kind
         and reference_row.scope_source_account_id is not distinct from
           new.message_scope_source_account_id
         and reference_row.scope_source_thread_binding_id is not distinct from
           new.message_scope_source_thread_binding_id
         and reference_row.object_kind_id = new.message_object_kind_id
         and reference_row.canonical_external_subject =
           new.canonical_external_subject
         and reference_row.message_key_digest_sha256 =
           new.message_key_digest_sha256
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_exact_target_mismatch';
  end if;

  if new.state = 'applied' and not exists (
    select 1
    from public.inbox_v2_message_revisions revision_row
    where revision_row.tenant_id = new.tenant_id
      and revision_row.message_id = new.applied_message_id
      and revision_row.message_revision = new.applied_message_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_applied_revision_missing';
  end if;

  if new.state = 'applied'
     and new.effect_kind = 'message_lifecycle'
     and new.action_kind in ('edit', 'delete')
     and not exists (
       select 1
       from public.inbox_v2_message_revisions revision_row
       join public.inbox_v2_message_provider_lifecycle_operations operation_row
         on operation_row.tenant_id = revision_row.tenant_id
        and operation_row.id = revision_row.provider_operation_id
       where revision_row.tenant_id = new.tenant_id
         and revision_row.message_id = new.applied_message_id
         and revision_row.message_revision = new.applied_message_revision
         and revision_row.change_kind = case new.action_kind
           when 'edit' then 'edited'::public.inbox_v2_message_revision_change
           else 'provider_delete_policy_tombstone'::public.inbox_v2_message_revision_change
         end
         and operation_row.message_id = new.applied_message_id
         and operation_row.action::text = new.action_kind::text
         and operation_row.origin = 'provider_observed'
         and operation_row.source_occurrence_id = new.source_occurrence_id
         and operation_row.source_account_id = new.source_account_id
         and operation_row.source_thread_binding_id = new.source_thread_binding_id
         and operation_row.binding_generation = new.binding_generation
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_lifecycle_effect_mismatch';
  end if;

  if new.state = 'applied'
     and new.effect_kind = 'provider_delete_retain_local'
     and not exists (
       select 1
       from public.inbox_v2_message_provider_lifecycle_operations operation_row
       join public.inbox_v2_message_provider_lifecycle_transitions transition_effect
         on transition_effect.tenant_id = operation_row.tenant_id
        and transition_effect.operation_id = operation_row.id
        and transition_effect.resulting_revision = operation_row.revision
       where operation_row.tenant_id = new.tenant_id
         and operation_row.id = new.applied_provider_lifecycle_operation_id
         and operation_row.revision =
           new.applied_provider_lifecycle_operation_revision
         and operation_row.message_id = new.applied_message_id
         and operation_row.action = 'delete'
         and operation_row.origin = 'provider_observed'
         and operation_row.source_occurrence_id = new.source_occurrence_id
         and operation_row.source_account_id = new.source_account_id
         and operation_row.source_thread_binding_id = new.source_thread_binding_id
         and operation_row.binding_generation = new.binding_generation
         and operation_row.outcome = 'observed'
         and operation_row.delete_local_effect = 'retain_local'
         and transition_effect.delete_local_effect = 'retain_local'
         and transition_effect.recorded_at = new.terminal_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_retain_local_effect_mismatch';
  end if;

  if transition_row.source_occurrence_resulting_revision is not null then
    select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = new.source_occurrence_id;

    if not found
       or transition_row.source_occurrence_expected_revision <>
          new.source_occurrence_revision
       or occurrence_row.resolution_state <> 'resolved'
       or occurrence_row.revision <>
          transition_row.source_occurrence_resulting_revision
       or occurrence_row.resolved_external_message_reference_id <>
          transition_row.target_external_message_reference_id
       or occurrence_row.updated_at > transition_row.recorded_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_occurrence_resolution_mismatch';
    end if;
  end if;

  select count(*), min(candidate_row.ordinal), max(candidate_row.ordinal)
  into candidate_count, candidate_min, candidate_max
  from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.action_id = new.id
    and candidate_row.resulting_revision = new.revision;

  if candidate_count <> new.conflict_candidate_count
     or (candidate_count > 0 and (
       candidate_min <> 0 or candidate_max <> candidate_count - 1
     )) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_candidate_set_mismatch';
  end if;

  if new.state = 'target_conflicted' and exists (
    select 1
    from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
    join public.inbox_v2_external_message_references reference_row
      on reference_row.tenant_id = candidate_row.tenant_id
     and reference_row.id = candidate_row.external_message_reference_id
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.action_id = new.id
      and (
        reference_row.realm_id <> new.message_realm_id
        or reference_row.realm_version <> new.message_realm_version
        or reference_row.canonicalization_version <>
          new.message_canonicalization_version
        or reference_row.scope_kind <> new.message_scope_kind
        or reference_row.scope_source_account_id is distinct from
          new.message_scope_source_account_id
        or reference_row.scope_source_thread_binding_id is distinct from
          new.message_scope_source_thread_binding_id
        or reference_row.object_kind_id <> new.message_object_kind_id
        or reference_row.external_thread_id <> new.external_thread_id
        or reference_row.canonical_external_subject <>
          new.canonical_external_subject
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_candidate_key_mismatch';
  end if;

  if transition_row.ordering_outcome = 'advance' and not exists (
    select 1
    from public.inbox_v2_deferred_source_action_ordering_heads head_row
    where head_row.tenant_id = new.tenant_id
      and head_row.message_key_digest_sha256 = new.message_key_digest_sha256
      and head_row.message_realm_id = new.message_realm_id
      and head_row.message_realm_version = new.message_realm_version
      and head_row.message_canonicalization_version =
        new.message_canonicalization_version
      and head_row.message_scope_kind = new.message_scope_kind
      and head_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and head_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and head_row.message_object_kind_id = new.message_object_kind_id
      and head_row.external_thread_id = new.external_thread_id
      and head_row.canonical_external_subject =
        new.canonical_external_subject
      and head_row.external_message_key_detail =
        new.external_message_key_detail
      and head_row.lane = new.lane
      and head_row.scope_token = transition_row.ordering_head_scope_token
      and head_row.comparator_id = transition_row.ordering_head_comparator_id
      and head_row.comparator_revision =
        transition_row.ordering_head_comparator_revision
      and head_row.revision >= transition_row.resulting_ordering_head_revision
      and (
        (
          head_row.revision = transition_row.resulting_ordering_head_revision
          and head_row.latest_action_id = new.id
          and head_row.latest_position = new.ordering_position
        ) or (
          head_row.revision > transition_row.resulting_ordering_head_revision
          and (
            char_length(head_row.latest_position) >
              char_length(new.ordering_position)
            or (
              char_length(head_row.latest_position) =
                char_length(new.ordering_position)
              and head_row.latest_position collate "C" >
                new.ordering_position collate "C"
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_ordering_head_missing';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_transition_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  action_row public.inbox_v2_deferred_message_source_actions%rowtype;
begin
  select * into action_row
  from public.inbox_v2_deferred_message_source_actions candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.id = new.action_id;

  if not found
     or action_row.state = 'pending'
     or action_row.revision <> new.resulting_revision
     or action_row.state <> new.after_state
     or action_row.updated_at <> new.recorded_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_transition_action_mismatch';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_candidate_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  tenant_key text;
  action_key text;
  action_row public.inbox_v2_deferred_message_source_actions%rowtype;
  candidate_count bigint;
  candidate_min smallint;
  candidate_max smallint;
begin
  tenant_key := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  action_key := case when tg_op = 'DELETE' then old.action_id else new.action_id end;

  select * into action_row
  from public.inbox_v2_deferred_message_source_actions candidate_action
  where candidate_action.tenant_id = tenant_key
    and candidate_action.id = action_key;

  if not found then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = tenant_key
    ) then
      return null;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_candidate_action_missing';
  end if;

  select count(*), min(candidate_row.ordinal), max(candidate_row.ordinal)
  into candidate_count, candidate_min, candidate_max
  from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
  where candidate_row.tenant_id = tenant_key
    and candidate_row.action_id = action_key
    and candidate_row.resulting_revision = action_row.revision;

  if action_row.state <> 'target_conflicted'
     or candidate_count <> action_row.conflict_candidate_count
     or candidate_count < 2
     or candidate_min <> 0
     or candidate_max <> candidate_count - 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_candidate_set_mismatch';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_head_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.inbox_v2_deferred_message_source_actions action_row
    join public.inbox_v2_deferred_message_source_action_transitions transition_row
      on transition_row.tenant_id = action_row.tenant_id
     and transition_row.action_id = action_row.id
    where action_row.tenant_id = new.tenant_id
      and action_row.id = new.latest_action_id
      and action_row.state = 'applied'
      and action_row.ordering_kind = 'monotonic_exact'
      and action_row.message_key_digest_sha256 = new.message_key_digest_sha256
      and action_row.message_realm_id = new.message_realm_id
      and action_row.message_realm_version = new.message_realm_version
      and action_row.message_canonicalization_version =
        new.message_canonicalization_version
      and action_row.message_scope_kind = new.message_scope_kind
      and action_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and action_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and action_row.message_object_kind_id = new.message_object_kind_id
      and action_row.external_thread_id = new.external_thread_id
      and action_row.canonical_external_subject =
        new.canonical_external_subject
      and action_row.external_message_key_detail =
        new.external_message_key_detail
      and action_row.lane = new.lane
      and action_row.ordering_scope_token = new.scope_token
      and action_row.ordering_comparator_id = new.comparator_id
      and action_row.ordering_comparator_revision = new.comparator_revision
      and action_row.ordering_position = new.latest_position
      and transition_row.ordering_outcome = 'advance'
      and transition_row.ordering_head_scope_token = new.scope_token
      and transition_row.ordering_head_comparator_id = new.comparator_id
      and transition_row.ordering_head_comparator_revision =
        new.comparator_revision
      and transition_row.resulting_ordering_head_revision = new.revision
      and transition_row.recorded_at = new.updated_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_ordering_head_action_mismatch';
  end if;
  return null;
end
$function$;

create trigger inbox_v2_deferred_source_action_guard_trigger
before insert or update or delete
on public.inbox_v2_deferred_message_source_actions
for each row execute function public.inbox_v2_deferred_source_action_guard();

create trigger inbox_v2_deferred_source_action_key_registry_trigger
after insert
on public.inbox_v2_deferred_message_source_actions
for each row execute function public.inbox_v2_source_message_key_registry_assert();

create trigger inbox_v2_source_message_key_registry_immutable_trigger
before update or delete
on public.inbox_v2_source_message_key_registry
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_transition_immutable_trigger
before update or delete
on public.inbox_v2_deferred_message_source_action_transitions
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_candidate_immutable_trigger
before update or delete
on public.inbox_v2_deferred_source_action_conflict_candidates
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_head_guard_trigger
before insert or update or delete
on public.inbox_v2_deferred_source_action_ordering_heads
for each row execute function public.inbox_v2_deferred_source_ordering_head_guard();

create trigger inbox_v2_deferred_source_head_key_registry_trigger
after insert or update
on public.inbox_v2_deferred_source_action_ordering_heads
for each row execute function public.inbox_v2_source_message_key_registry_assert();

create trigger inbox_v2_source_correlation_evidence_guard_trigger
before insert or update or delete
on public.inbox_v2_source_message_correlation_evidence
for each row execute function public.inbox_v2_source_correlation_evidence_guard();

create constraint trigger inbox_v2_deferred_source_action_constraint_trigger
after update
on public.inbox_v2_deferred_message_source_actions
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_action_assert();

create constraint trigger inbox_v2_deferred_source_transition_constraint_trigger
after insert
on public.inbox_v2_deferred_message_source_action_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_transition_assert();

create constraint trigger inbox_v2_deferred_source_candidate_constraint_trigger
after insert or delete
on public.inbox_v2_deferred_source_action_conflict_candidates
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_candidate_assert();

create constraint trigger inbox_v2_deferred_source_head_constraint_trigger
after insert or update
on public.inbox_v2_deferred_source_action_ordering_heads
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_head_assert();
`;
