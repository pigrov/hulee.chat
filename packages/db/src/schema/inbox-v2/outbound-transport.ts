import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import { employees, sourceAccounts, tenants } from "../tables";
import { inboxV2ExternalThreads } from "./external-thread";
import {
  inboxV2FileOutboundArtifactPlans,
  inboxV2FileOutboundDispatchPlans
} from "./file-object";
import {
  inboxV2SourceOccurrenceDecisionStrength,
  inboxV2SourceOccurrenceMessageScopeKind,
  inboxV2SourceOccurrenceResolutionState,
  inboxV2SourceOccurrences
} from "./source-occurrence";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./source-thread-binding";
import {
  inboxV2Messages,
  inboxV2MessageTransportOccurrenceLinks
} from "./timeline-message";

export const inboxV2ExternalMessageScopeKind = pgEnum(
  "inbox_v2_external_message_scope_kind",
  ["provider_thread", "source_account", "source_thread_binding"]
);

export const inboxV2ThreadRoutePolicyFallbackKind = pgEnum(
  "inbox_v2_thread_route_policy_fallback_kind",
  ["none", "ordered_allowlist"]
);

export const inboxV2OutboundRoutePrincipalKind = pgEnum(
  "inbox_v2_outbound_route_principal_kind",
  ["employee", "trusted_service"]
);

export const inboxV2OutboundRouteIntentKind = pgEnum(
  "inbox_v2_outbound_route_intent_kind",
  ["automatic", "explicit_binding", "explicit_occurrence", "explicit_reroute"]
);

export const inboxV2OutboundRouteSelectionReason = pgEnum(
  "inbox_v2_outbound_route_selection_reason",
  [
    "explicit_binding",
    "explicit_occurrence",
    "explicit_reroute",
    "preferred_binding",
    "sole_eligible_binding",
    "policy_fallback"
  ]
);

export const inboxV2OutboundActorKind = pgEnum("inbox_v2_outbound_actor_kind", [
  "employee",
  "trusted_service"
]);

export const inboxV2OutboundDispatchState = pgEnum(
  "inbox_v2_outbound_dispatch_state",
  [
    "queued",
    "attempting",
    "accepted",
    "retryable_failure",
    "terminal_failure",
    "outcome_unknown",
    "cancelled"
  ]
);

export const inboxV2OutboundRetrySafetyMechanism = pgEnum(
  "inbox_v2_outbound_retry_safety_mechanism",
  ["provider_idempotency_key", "recoverable_client_marker", "unsafe_or_unknown"]
);

export const inboxV2OutboundDispatchAttemptOutcome = pgEnum(
  "inbox_v2_outbound_dispatch_attempt_outcome",
  [
    "pending",
    "accepted",
    "retryable_failure",
    "terminal_failure",
    "outcome_unknown"
  ]
);

export const inboxV2OutboundDispatchAttemptCompletionSource = pgEnum(
  "inbox_v2_outbound_dispatch_attempt_completion_source",
  [
    "provider_result",
    "provider_observation",
    "lease_expired",
    "preflight_blocked"
  ]
);

export const inboxV2OutboundDispatchUnknownRequiredAction = pgEnum(
  "inbox_v2_outbound_dispatch_unknown_required_action",
  [
    "automated_reconciliation_required",
    "operator_duplicate_risk_decision_required"
  ]
);

export const inboxV2OutboundDispatchReconciliationResult = pgEnum(
  "inbox_v2_outbound_dispatch_reconciliation_result",
  ["accepted", "terminal_failure", "retryable_failure"]
);

export const inboxV2OutboundDispatchRetryAuthorizationKind = pgEnum(
  "inbox_v2_outbound_dispatch_retry_authorization_kind",
  ["not_applicable", "automatic", "employee_duplicate_risk_override"]
);

export const inboxV2OutboundDispatchArtifactState = pgEnum(
  "inbox_v2_outbound_dispatch_artifact_state",
  ["accepted", "failed", "outcome_unknown"]
);

export const inboxV2OutboundArtifactAssociationEvidenceKind = pgEnum(
  "inbox_v2_outbound_artifact_association_evidence_kind",
  ["provider_response_attempt", "provider_echo_correlation"]
);

export const inboxV2OutboundProviderSettlementTransitionKind = pgEnum(
  "inbox_v2_outbound_provider_settlement_transition_kind",
  [
    "retain_dispatch_state",
    "complete_pending_attempt",
    "reconcile_outcome_unknown",
    "already_accepted"
  ]
);

export const inboxV2OutboundProviderSettlementWorkState = pgEnum(
  "inbox_v2_outbound_provider_settlement_work_state",
  ["pending", "leased", "settled", "dead"]
);

export const inboxV2ExternalMessageReferences = pgTable(
  "inbox_v2_external_message_references",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    realmId: text("realm_id").notNull(),
    realmVersion: text("realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    scopeKind: inboxV2ExternalMessageScopeKind("scope_kind").notNull(),
    scopeSourceAccountId: text("scope_source_account_id"),
    scopeSourceThreadBindingId: text("scope_source_thread_binding_id"),
    objectKindId: text("object_kind_id").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    messageKeyDigestSha256: text("message_key_digest_sha256").notNull(),
    identityDeclaration: jsonb("identity_declaration")
      .$type<Record<string, unknown>>()
      .notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    externalThreadRevision: bigint("external_thread_revision", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`1`),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    messageId: text("message_id").notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_external_message_references_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_external_message_references_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_external_message_references_thread_fk",
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
      name: "inbox_v2_external_message_references_message_fk",
      columns: [
        table.tenantId,
        table.messageId,
        table.conversationId,
        table.timelineItemId
      ],
      foreignColumns: [
        inboxV2Messages.tenantId,
        inboxV2Messages.id,
        inboxV2Messages.conversationId,
        inboxV2Messages.timelineItemId
      ]
    }),
    foreignKey({
      name: "inbox_v2_external_message_references_scope_account_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_external_message_references_scope_binding_fk",
      columns: [table.tenantId, table.scopeSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    unique("inbox_v2_external_message_references_key_unique").on(
      table.tenantId,
      table.messageKeyDigestSha256
    ),
    unique("inbox_v2_external_message_references_target_unique").on(
      table.tenantId,
      table.id,
      table.externalThreadId,
      table.messageId,
      table.timelineItemId,
      table.messageKeyDigestSha256
    ),
    unique("inbox_v2_external_message_references_thread_target_unique").on(
      table.tenantId,
      table.id,
      table.externalThreadId
    ),
    unique("inbox_v2_external_message_references_message_target_unique").on(
      table.tenantId,
      table.id,
      table.externalThreadId,
      table.messageId
    ),
    check(
      "inbox_v2_external_message_references_id_check",
      idSql(table.id, "external_message_reference")
    ),
    check(
      "inbox_v2_external_message_references_scope_check",
      sql`(
          ${table.scopeKind} = 'provider_thread'
          and ${table.scopeSourceAccountId} is null
          and ${table.scopeSourceThreadBindingId} is null
        ) or (
          ${table.scopeKind} = 'source_account'
          and ${table.scopeSourceAccountId} is not null
          and ${table.scopeSourceThreadBindingId} is null
        ) or (
          ${table.scopeKind} = 'source_thread_binding'
          and ${table.scopeSourceAccountId} is null
          and ${table.scopeSourceThreadBindingId} is not null
        )`
    ),
    check(
      "inbox_v2_external_message_references_key_check",
      sql`${catalogIdSql(table.realmId)}
        and ${versionTokenSql(table.realmVersion)}
        and ${versionTokenSql(table.canonicalizationVersion)}
        and ${catalogIdSql(table.objectKindId)}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}
        and ${sha256DigestSql(table.messageKeyDigestSha256)}
        and ${table.messageKeyDigestSha256} = ${externalMessageKeyDigestSql(table)}`
    ),
    check(
      "inbox_v2_external_message_references_declaration_check",
      sql`(${boundedJsonObjectSql(table.identityDeclaration, 32_768)}
        and ${table.identityDeclaration} #>> '{identityKind}' = 'message'
        and ${table.identityDeclaration} #>> '{realmId}' = ${table.realmId}
        and ${table.identityDeclaration} #>> '{realmVersion}' = ${table.realmVersion}
        and ${table.identityDeclaration} #>> '{canonicalizationVersion}' =
          ${table.canonicalizationVersion}
        and ${table.identityDeclaration} #>> '{objectKindId}' = ${table.objectKindId}
        and ${table.identityDeclaration} #>> '{scopeKind}' = ${table.scopeKind}::text
        and ${table.identityDeclaration} #>> '{decisionStrength}' in (
          'authoritative', 'safe_default'
        )
        and (${table.identityDeclaration} #>> '{decisionStrength}' <>
          'safe_default' or ${table.scopeKind} in (
            'source_account', 'source_thread_binding'
          ))
        and (${table.scopeKind} <> 'provider_thread'
          or ${table.identityDeclaration} #>> '{decisionStrength}' = 'authoritative')
        and ${catalogIdSql(
          sql`${table.identityDeclaration} #>> '{adapterContract,contractId}'`
        )}
        and ${versionTokenSql(
          sql`${table.identityDeclaration} #>> '{adapterContract,contractVersion}'`
        )}
        and ${canonicalPositiveBigintTextSql(
          sql`${table.identityDeclaration} #>> '{adapterContract,declarationRevision}'`
        )}
        and ${catalogIdSql(
          sql`${table.identityDeclaration} #>> '{adapterContract,surfaceId}'`
        )}
        and ${catalogIdSql(
          sql`${table.identityDeclaration} #>>
            '{adapterContract,loadedByTrustedServiceId}'`
        )}
        and isfinite((${table.identityDeclaration} #>>
          '{adapterContract,loadedAt}')::timestamptz)
        and (${table.identityDeclaration} #>>
          '{adapterContract,loadedAt}')::timestamptz <= ${table.createdAt})
        is true`
    ),
    check(
      "inbox_v2_external_message_references_immutable_check",
      sql`${table.externalThreadRevision} = 1 and ${table.revision} = 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_external_message_references_tenant_message_idx").on(
      table.tenantId,
      table.messageId,
      table.id
    ),
    index("inbox_v2_external_message_references_tenant_thread_idx").on(
      table.tenantId,
      table.externalThreadId,
      table.id
    ),
    index("inbox_v2_external_message_references_tenant_account_idx").on(
      table.tenantId,
      table.scopeSourceAccountId,
      table.id
    ),
    index("inbox_v2_external_message_references_tenant_binding_idx").on(
      table.tenantId,
      table.scopeSourceThreadBindingId,
      table.id
    )
  ]
);

export const inboxV2ThreadRoutePolicyVersions = pgTable(
  "inbox_v2_thread_route_policy_versions",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    conversationId: text("conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    externalThreadRevision: bigint("external_thread_revision", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`1`),
    operationId: text("operation_id").notNull(),
    contentKindId: text("content_kind_id"),
    contentKindScopeKey: text("content_kind_scope_key")
      .notNull()
      .generatedAlwaysAs(
        () => sql`coalesce(content_kind_id, '<no-content-kind>')`
      ),
    routePolicyCatalogId: text("route_policy_catalog_id").notNull(),
    requiredConversationPermissionId: text(
      "required_conversation_permission_id"
    ).notNull(),
    preferredBindingId: text("preferred_binding_id"),
    preferredSourceConnectionId: text("preferred_source_connection_id"),
    preferredSourceAccountId: text("preferred_source_account_id"),
    fallbackKind: inboxV2ThreadRoutePolicyFallbackKind("fallback_kind")
      .notNull()
      .default("none"),
    fallbackBindingCount: smallint("fallback_binding_count")
      .notNull()
      .default(sql`0`),
    fallbackBindingsDigestSha256: text("fallback_bindings_digest_sha256"),
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
      name: "inbox_v2_thread_route_policy_versions_pk",
      columns: [table.tenantId, table.policyId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_thread_route_policy_versions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_thread_route_policy_versions_thread_fk",
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
      name: "inbox_v2_thread_route_policy_versions_preferred_binding_fk",
      columns: [
        table.tenantId,
        table.preferredBindingId,
        table.externalThreadId,
        table.preferredSourceConnectionId,
        table.preferredSourceAccountId
      ],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id,
        inboxV2SourceThreadBindings.externalThreadId,
        inboxV2SourceThreadBindings.sourceConnectionId,
        inboxV2SourceThreadBindings.sourceAccountId
      ]
    }),
    unique("inbox_v2_thread_route_policy_versions_target_unique").on(
      table.tenantId,
      table.policyId,
      table.revision,
      table.conversationId,
      table.externalThreadId,
      table.operationId,
      table.contentKindScopeKey
    ),
    check(
      "inbox_v2_thread_route_policy_versions_id_check",
      idSql(table.policyId, "thread_route_policy")
    ),
    check(
      "inbox_v2_thread_route_policy_versions_catalog_check",
      sql`${table.revision} >= 1
        and ${catalogIdSql(table.operationId)}
        and (${table.contentKindId} is null or ${catalogIdSql(table.contentKindId)})
        and ${catalogIdSql(table.routePolicyCatalogId)}
        and ${catalogIdSql(table.requiredConversationPermissionId)}`
    ),
    check(
      "inbox_v2_thread_route_policy_versions_preferred_check",
      sql`num_nonnulls(
          ${table.preferredBindingId},
          ${table.preferredSourceConnectionId},
          ${table.preferredSourceAccountId}
        ) in (0, 3)`
    ),
    check(
      "inbox_v2_thread_route_policy_versions_fallback_check",
      sql`(
          ${table.fallbackKind} = 'none'
          and ${table.fallbackBindingCount} = 0
          and ${table.fallbackBindingsDigestSha256} is null
        ) or (
          ${table.fallbackKind} = 'ordered_allowlist'
          and ${table.fallbackBindingCount} between 1 and 32
          and ${sha256DigestSql(table.fallbackBindingsDigestSha256)}
        )`
    ),
    check(
      "inbox_v2_thread_route_policy_versions_timestamps_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_thread_route_policy_versions_lookup_idx").on(
      table.tenantId,
      table.externalThreadId,
      table.operationId,
      table.contentKindId,
      table.revision.desc()
    ),
    index("inbox_v2_thread_route_policy_versions_preferred_idx").on(
      table.tenantId,
      table.preferredBindingId,
      table.policyId,
      table.revision
    )
  ]
);

export const inboxV2ThreadRoutePolicyFallbackBindings = pgTable(
  "inbox_v2_thread_route_policy_fallback_bindings",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    policyRevision: bigint("policy_revision", { mode: "bigint" }).notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    bindingId: text("binding_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_thread_route_policy_fallback_bindings_pk",
      columns: [
        table.tenantId,
        table.policyId,
        table.policyRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_thread_route_policy_fallback_bindings_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyRevision],
      foreignColumns: [
        inboxV2ThreadRoutePolicyVersions.tenantId,
        inboxV2ThreadRoutePolicyVersions.policyId,
        inboxV2ThreadRoutePolicyVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_thread_route_policy_fallback_bindings_binding_fk",
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
    unique("inbox_v2_thread_route_policy_fallback_binding_unique").on(
      table.tenantId,
      table.policyId,
      table.policyRevision,
      table.bindingId
    ),
    check(
      "inbox_v2_thread_route_policy_fallback_bindings_ordinal_check",
      sql`${table.ordinal} between 0 and 31`
    ),
    index("inbox_v2_thread_route_policy_fallback_bindings_target_idx").on(
      table.tenantId,
      table.bindingId,
      table.policyId,
      table.policyRevision
    )
  ]
);

export const inboxV2ThreadRoutePolicyHeads = pgTable(
  "inbox_v2_thread_route_policy_heads",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    operationId: text("operation_id").notNull(),
    contentKindId: text("content_kind_id"),
    contentKindScopeKey: text("content_kind_scope_key")
      .notNull()
      .generatedAlwaysAs(
        () => sql`coalesce(content_kind_id, '<no-content-kind>')`
      ),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_thread_route_policy_heads_pk",
      columns: [table.tenantId, table.policyId]
    }),
    foreignKey({
      name: "inbox_v2_thread_route_policy_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_thread_route_policy_heads_version_fk",
      columns: [
        table.tenantId,
        table.policyId,
        table.revision,
        table.conversationId,
        table.externalThreadId,
        table.operationId,
        table.contentKindScopeKey
      ],
      foreignColumns: [
        inboxV2ThreadRoutePolicyVersions.tenantId,
        inboxV2ThreadRoutePolicyVersions.policyId,
        inboxV2ThreadRoutePolicyVersions.revision,
        inboxV2ThreadRoutePolicyVersions.conversationId,
        inboxV2ThreadRoutePolicyVersions.externalThreadId,
        inboxV2ThreadRoutePolicyVersions.operationId,
        inboxV2ThreadRoutePolicyVersions.contentKindScopeKey
      ]
    }),
    uniqueIndex("inbox_v2_thread_route_policy_heads_scope_unique").on(
      table.tenantId,
      table.conversationId,
      table.externalThreadId,
      table.operationId,
      table.contentKindScopeKey
    ),
    check(
      "inbox_v2_thread_route_policy_heads_check",
      sql`${table.revision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_thread_route_policy_heads_lookup_idx").on(
      table.tenantId,
      table.externalThreadId,
      table.operationId,
      table.contentKindScopeKey
    )
  ]
);

/** Immutable route selected before any provider I/O. */
export const inboxV2OutboundRoutes = pgTable(
  "inbox_v2_outbound_routes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    principalKind:
      inboxV2OutboundRoutePrincipalKind("principal_kind").notNull(),
    principalEmployeeId: text("principal_employee_id"),
    principalTrustedServiceId: text("principal_trusted_service_id"),
    conversationId: text("conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    externalThreadRevision: bigint("external_thread_revision", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`1`),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    operationId: text("operation_id").notNull(),
    contentKindId: text("content_kind_id"),
    authorizationEpoch: text("authorization_epoch").notNull(),
    requiredConversationPermissionId: text(
      "required_conversation_permission_id"
    ).notNull(),
    bindingRevision: bigint("binding_revision", { mode: "bigint" }).notNull(),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    remoteAccessRevision: bigint("remote_access_revision", {
      mode: "bigint"
    }).notNull(),
    administrativeRevision: bigint("administrative_revision", {
      mode: "bigint"
    }).notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    routeDescriptorRevision: bigint("route_descriptor_revision", {
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
    adapterContractSnapshot: jsonb("adapter_contract_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    routeDescriptorSnapshot: jsonb("route_descriptor_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    routeDescriptorDigestSha256: text(
      "route_descriptor_digest_sha256"
    ).notNull(),
    routePolicyId: text("route_policy_id").notNull(),
    routePolicyRevision: bigint("route_policy_revision", {
      mode: "bigint"
    }).notNull(),
    conversationAuthorizationSnapshot: jsonb(
      "conversation_authorization_snapshot"
    )
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceAccountAuthorizationSnapshot: jsonb(
      "source_account_authorization_snapshot"
    )
      .$type<Record<string, unknown>>()
      .notNull(),
    referenceContextSnapshot: jsonb("reference_context_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    runtimeObservationSnapshot: jsonb("runtime_observation_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    selectionIntentKind: inboxV2OutboundRouteIntentKind(
      "selection_intent_kind"
    ).notNull(),
    selectionIntentSnapshot: jsonb("selection_intent_snapshot")
      .$type<Record<string, unknown>>()
      .notNull(),
    selectionReason:
      inboxV2OutboundRouteSelectionReason("selection_reason").notNull(),
    candidateSnapshotToken: text("candidate_snapshot_token").notNull(),
    candidateSnapshotNotAfter: timestamp("candidate_snapshot_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    fallbackPolicyOrdinal: smallint("fallback_policy_ordinal"),
    selectedAt: timestamp("selected_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    mutationToken: text("mutation_token").notNull(),
    idempotencyToken: text("idempotency_token").notNull(),
    correlationToken: text("correlation_token").notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_routes_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_routes_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_routes_employee_fk",
      columns: [table.tenantId, table.principalEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_routes_thread_fk",
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
      name: "inbox_v2_outbound_routes_binding_fk",
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
      name: "inbox_v2_outbound_routes_binding_snapshot_fk",
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
      name: "inbox_v2_outbound_routes_policy_fk",
      columns: [table.tenantId, table.routePolicyId, table.routePolicyRevision],
      foreignColumns: [
        inboxV2ThreadRoutePolicyVersions.tenantId,
        inboxV2ThreadRoutePolicyVersions.policyId,
        inboxV2ThreadRoutePolicyVersions.revision
      ]
    }),
    unique("inbox_v2_outbound_routes_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.externalThreadId,
      table.sourceThreadBindingId,
      table.sourceConnectionId,
      table.sourceAccountId
    ),
    unique("inbox_v2_outbound_routes_dispatch_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId
    ),
    unique("inbox_v2_outbound_routes_mutation_unique").on(
      table.tenantId,
      table.mutationToken
    ),
    unique("inbox_v2_outbound_routes_idempotency_unique").on(
      table.tenantId,
      table.idempotencyToken
    ),
    check(
      "inbox_v2_outbound_routes_id_check",
      idSql(table.id, "outbound_route")
    ),
    check(
      "inbox_v2_outbound_routes_principal_check",
      sql`(
          ${table.principalKind} = 'employee'
          and ${table.principalEmployeeId} is not null
          and ${table.principalTrustedServiceId} is null
        ) or (
          ${table.principalKind} = 'trusted_service'
          and ${table.principalEmployeeId} is null
          and ${catalogIdSql(table.principalTrustedServiceId)}
        )`
    ),
    check(
      "inbox_v2_outbound_routes_fence_check",
      sql`${table.externalThreadRevision} = 1
        and ${table.bindingRevision} >= 1
        and ${table.accountGeneration} >= 1
        and ${table.bindingGeneration} >= 1
        and ${table.remoteAccessRevision} >= 1
        and ${table.administrativeRevision} >= 1
        and ${table.capabilityRevision} >= 1
        and ${table.routeDescriptorRevision} >= 1`
    ),
    check(
      "inbox_v2_outbound_routes_adapter_check",
      sql`${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.adapterLoadedByTrustedServiceId)}
        and isfinite(${table.adapterLoadedAt})
        and ${table.adapterLoadedAt} <= ${table.createdAt}
        and ${sha256DigestSql(table.routeDescriptorDigestSha256)}`
    ),
    check(
      "inbox_v2_outbound_routes_snapshots_check",
      sql`${boundedJsonObjectSql(table.adapterContractSnapshot, 16_384)}
        and ${boundedJsonObjectSql(table.routeDescriptorSnapshot, 16_384)}
        and ${boundedJsonObjectSql(table.conversationAuthorizationSnapshot, 32_768)}
        and ${boundedJsonObjectSql(table.sourceAccountAuthorizationSnapshot, 32_768)}
        and ${boundedJsonObjectSql(table.referenceContextSnapshot, 32_768)}
        and ${boundedJsonObjectSql(table.runtimeObservationSnapshot, 16_384)}
        and ${boundedJsonObjectSql(table.selectionIntentSnapshot, 32_768)}`
    ),
    check(
      "inbox_v2_outbound_routes_snapshot_parity_check",
      sql`(${table.adapterContractSnapshot} #>> '{contractId}' =
          ${table.adapterContractId}
        and ${table.adapterContractSnapshot} #>> '{contractVersion}' =
          ${table.adapterContractVersion}
        and ${table.adapterContractSnapshot} #>> '{declarationRevision}' =
          ${table.adapterDeclarationRevision}::text
        and ${table.adapterContractSnapshot} #>> '{surfaceId}' =
          ${table.adapterSurfaceId}
        and ${table.adapterContractSnapshot} #>> '{loadedByTrustedServiceId}' =
          ${table.adapterLoadedByTrustedServiceId}
        and (${table.adapterContractSnapshot} #>> '{loadedAt}')::timestamptz =
          ${table.adapterLoadedAt}
        and ${table.routeDescriptorSnapshot} #>> '{descriptorRevision}' =
          ${table.routeDescriptorRevision}::text
        and ${table.routeDescriptorSnapshot} #>> '{descriptorDigestSha256}' =
          ${table.routeDescriptorDigestSha256}
        and ${table.routeDescriptorSnapshot} #>> '{adapterContract,contractId}' =
          ${table.adapterContractId}
        and ${table.routeDescriptorSnapshot} #>> '{adapterContract,contractVersion}' =
          ${table.adapterContractVersion}
        and ${table.routeDescriptorSnapshot} #>> '{adapterContract,declarationRevision}' =
          ${table.adapterDeclarationRevision}::text
        and ${table.routeDescriptorSnapshot} #>> '{adapterContract,surfaceId}' =
          ${table.adapterSurfaceId}
        and ${table.routeDescriptorSnapshot} #>>
          '{adapterContract,loadedByTrustedServiceId}' =
          ${table.adapterLoadedByTrustedServiceId}
        and (${table.routeDescriptorSnapshot} #>>
          '{adapterContract,loadedAt}')::timestamptz =
          ${table.adapterLoadedAt}) is true`
    ),
    check(
      "inbox_v2_outbound_routes_authorization_snapshots_check",
      routeAuthorizationSnapshotsSql(table)
    ),
    check(
      "inbox_v2_outbound_routes_runtime_observation_check",
      routeRuntimeObservationSql(table)
    ),
    check(
      "inbox_v2_outbound_routes_catalog_check",
      sql`${catalogIdSql(table.operationId)}
        and (${table.contentKindId} is null or ${catalogIdSql(table.contentKindId)})
        and ${authorizationEpochSql(table.authorizationEpoch)}
        and ${catalogIdSql(table.requiredConversationPermissionId)}`
    ),
    check(
      "inbox_v2_outbound_routes_reference_context_check",
      routeReferenceContextSql(table)
    ),
    check(
      "inbox_v2_outbound_routes_selection_check",
      sql`(${table.selectionIntentSnapshot} #>> '{kind}' = ${table.selectionIntentKind}::text
        and (
          (${table.selectionIntentKind} = 'automatic'
            and ${table.selectionIntentSnapshot} = '{"kind":"automatic"}'::jsonb
            and ${table.selectionReason} in (
              'preferred_binding', 'sole_eligible_binding', 'policy_fallback'
            ))
          or (${table.selectionIntentKind} = 'explicit_binding'
            and ${table.selectionReason} = 'explicit_binding'
            and ${table.selectionIntentSnapshot} = jsonb_build_object(
              'kind', 'explicit_binding',
              'binding', jsonb_build_object(
                'tenantId', ${table.tenantId},
                'kind', 'source_thread_binding',
                'id', ${table.sourceThreadBindingId}
              )
            ))
          or (${table.selectionIntentKind} = 'explicit_occurrence'
            and ${table.selectionReason} = 'explicit_occurrence'
            and ${idSql(
              sql`${table.selectionIntentSnapshot} #>> '{occurrence,id}'`,
              "source_occurrence"
            )}
            and ${table.selectionIntentSnapshot} = jsonb_build_object(
              'kind', 'explicit_occurrence',
              'occurrence', jsonb_build_object(
                'tenantId', ${table.tenantId},
                'kind', 'source_occurrence',
                'id', ${table.selectionIntentSnapshot} #>> '{occurrence,id}'
              )
            )
            and ${table.referenceContextSnapshot} #>> '{kind}' =
              'external_message'
            and ${table.referenceContextSnapshot} #>> '{sourceOccurrence,id}' =
              ${table.selectionIntentSnapshot} #>> '{occurrence,id}'
            and ${table.referenceContextSnapshot} #>> '{originBinding,id}' =
              ${table.sourceThreadBindingId})
          or (${table.selectionIntentKind} = 'explicit_reroute'
            and ${table.selectionReason} = 'explicit_reroute'
            and ${idSql(
              sql`${table.selectionIntentSnapshot} #>> '{originalRoute,id}'`,
              "outbound_route"
            )}
            and ${idSql(
              sql`${table.selectionIntentSnapshot} #>> '{originalDispatch,id}'`,
              "outbound_dispatch"
            )}
            and ${canonicalPositiveBigintTextSql(
              sql`${table.selectionIntentSnapshot} ->> 'expectedOriginalDispatchRevision'`
            )}
            and ${catalogIdSql(
              sql`${table.selectionIntentSnapshot} #>> '{reasonId}'`
            )}
            and ${table.selectionIntentSnapshot} = jsonb_build_object(
              'kind', 'explicit_reroute',
              'originalRoute', jsonb_build_object(
                'tenantId', ${table.tenantId},
                'kind', 'outbound_route',
                'id', ${table.selectionIntentSnapshot} #>> '{originalRoute,id}'
              ),
              'originalDispatch', jsonb_build_object(
                'tenantId', ${table.tenantId},
                'kind', 'outbound_dispatch',
                'id', ${table.selectionIntentSnapshot} #>> '{originalDispatch,id}'
              ),
              'expectedOriginalDispatchRevision',
                ${table.selectionIntentSnapshot} ->> 'expectedOriginalDispatchRevision',
              'replacementBinding', jsonb_build_object(
                'tenantId', ${table.tenantId},
                'kind', 'source_thread_binding',
                'id', ${table.sourceThreadBindingId}
              ),
              'reasonId', ${table.selectionIntentSnapshot} #>> '{reasonId}'
            ))
        )
        and (${table.selectionReason} = 'policy_fallback') =
          (${table.fallbackPolicyOrdinal} is not null)
        and (${table.fallbackPolicyOrdinal} is null
          or ${table.fallbackPolicyOrdinal} between 0 and 31)
        and ${routingTokenSql(table.candidateSnapshotToken)}
        and isfinite(${table.candidateSnapshotNotAfter})
        and isfinite(${table.selectedAt})
        and ${table.selectedAt} <= ${table.candidateSnapshotNotAfter}) is true`
    ),
    check(
      "inbox_v2_outbound_routes_tokens_check",
      sql`${routingTokenSql(table.mutationToken)}
        and ${routingTokenSql(table.idempotencyToken)}
        and ${routingTokenSql(table.correlationToken)}`
    ),
    check(
      "inbox_v2_outbound_routes_immutable_check",
      sql`${table.revision} = 1 and ${table.createdAt} = ${table.selectedAt}
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_outbound_routes_tenant_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
      table.id
    ),
    index("inbox_v2_outbound_routes_tenant_binding_idx").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.createdAt,
      table.id
    ),
    index("inbox_v2_outbound_routes_principal_employee_idx").on(
      table.tenantId,
      table.principalEmployeeId,
      table.id
    )
  ]
);

export const inboxV2OutboundMultiSendOperations = pgTable(
  "inbox_v2_outbound_multi_send_operations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    actorKind: inboxV2OutboundActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    mutationToken: text("mutation_token").notNull(),
    idempotencyToken: text("idempotency_token").notNull(),
    correlationToken: text("correlation_token").notNull(),
    childCount: smallint("child_count").notNull(),
    childrenDigestSha256: text("children_digest_sha256").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_multi_send_operations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_multi_send_operations_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_multi_send_operations_employee_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    unique("inbox_v2_outbound_multi_send_operations_mutation_unique").on(
      table.tenantId,
      table.mutationToken
    ),
    unique("inbox_v2_outbound_multi_send_operations_idempotency_unique").on(
      table.tenantId,
      table.idempotencyToken
    ),
    check(
      "inbox_v2_outbound_multi_send_operations_id_check",
      idSql(table.id, "outbound_multi_send_operation")
    ),
    check(
      "inbox_v2_outbound_multi_send_operations_actor_check",
      actorSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorTrustedServiceId
      )
    ),
    check(
      "inbox_v2_outbound_multi_send_operations_values_check",
      sql`${routingTokenSql(table.mutationToken)}
        and ${routingTokenSql(table.idempotencyToken)}
        and ${routingTokenSql(table.correlationToken)}
        and ${table.childCount} between 2 and 100
        and ${sha256DigestSql(table.childrenDigestSha256)}
        and ${table.revision} = 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_outbound_multi_send_operations_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
      table.id
    ),
    index("inbox_v2_outbound_multi_send_operations_actor_employee_idx").on(
      table.tenantId,
      table.actorEmployeeId,
      table.id
    )
  ]
);

export const inboxV2OutboundDispatches = pgTable(
  "inbox_v2_outbound_dispatches",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    routeId: text("route_id").notNull(),
    multiSendOperationId: text("multi_send_operation_id"),
    state: inboxV2OutboundDispatchState("state").notNull().default("queued"),
    attemptCount: integer("attempt_count").notNull().default(0),
    activeAttemptId: text("active_attempt_id"),
    lastAttemptId: text("last_attempt_id"),
    retryAuthorizationDecisionId: text("retry_authorization_decision_id"),
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
      name: "inbox_v2_outbound_dispatches_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatches_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatches_message_fk",
      columns: [
        table.tenantId,
        table.messageId,
        table.conversationId,
        table.timelineItemId
      ],
      foreignColumns: [
        inboxV2Messages.tenantId,
        inboxV2Messages.id,
        inboxV2Messages.conversationId,
        inboxV2Messages.timelineItemId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatches_route_fk",
      columns: [table.tenantId, table.routeId, table.conversationId],
      foreignColumns: [
        inboxV2OutboundRoutes.tenantId,
        inboxV2OutboundRoutes.id,
        inboxV2OutboundRoutes.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatches_multi_send_fk",
      columns: [table.tenantId, table.multiSendOperationId],
      foreignColumns: [
        inboxV2OutboundMultiSendOperations.tenantId,
        inboxV2OutboundMultiSendOperations.id
      ]
    }),
    unique("inbox_v2_outbound_dispatches_route_unique").on(
      table.tenantId,
      table.routeId
    ),
    unique("inbox_v2_outbound_dispatches_chain_target_unique").on(
      table.tenantId,
      table.id,
      table.routeId,
      table.messageId
    ),
    check(
      "inbox_v2_outbound_dispatches_id_check",
      idSql(table.id, "outbound_dispatch")
    ),
    check(
      "inbox_v2_outbound_dispatches_state_check",
      sql`(${table.attemptCount} between 0 and 1000000
        and (
          (${table.state} = 'queued'
            and ${table.attemptCount} = 0
            and ${table.activeAttemptId} is null
            and ${table.lastAttemptId} is null
            and ${table.retryAuthorizationDecisionId} is null
            and ${table.revision} = 1)
          or (${table.state} = 'attempting'
            and ${table.attemptCount} >= 1
            and ${table.activeAttemptId} is not null
            and ${table.activeAttemptId} = ${table.lastAttemptId}
            and ${table.retryAuthorizationDecisionId} is null
            and ${table.revision} >= 2)
          or (${table.state} not in ('queued', 'attempting')
            and ${table.activeAttemptId} is null
            and (${table.attemptCount} = 0 or ${table.lastAttemptId} is not null)
            and (${table.state} <> 'retryable_failure'
              or ${table.attemptCount} >= 1)
            and (${table.state} = 'retryable_failure'
              or ${table.retryAuthorizationDecisionId} is null)
            and ${table.revision} >= 2)
        )) is true`
    ),
    check(
      "inbox_v2_outbound_dispatches_timestamps_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_outbound_dispatches_tenant_message_idx").on(
      table.tenantId,
      table.messageId,
      table.createdAt,
      table.id
    ),
    index("inbox_v2_outbound_dispatches_tenant_state_idx").on(
      table.tenantId,
      table.state,
      table.updatedAt,
      table.id
    ),
    index("inbox_v2_outbound_dispatches_multi_send_idx").on(
      table.tenantId,
      table.multiSendOperationId,
      table.id
    )
  ]
);

export const inboxV2OutboundDispatchAttempts = pgTable(
  "inbox_v2_outbound_dispatch_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    messageId: text("message_id").notNull(),
    attemptNumber: integer("attempt_number").notNull(),
    claimToken: text("claim_token").notNull(),
    retrySafetyMechanism: inboxV2OutboundRetrySafetyMechanism(
      "retry_safety_mechanism"
    ).notNull(),
    retrySafetyAdapterContractSnapshot: jsonb(
      "retry_safety_adapter_contract_snapshot"
    )
      .$type<Record<string, unknown>>()
      .notNull(),
    retrySafetyDeclaredByTrustedServiceId: text(
      "retry_safety_declared_by_trusted_service_id"
    ).notNull(),
    retrySafetyDeclarationToken: text(
      "retry_safety_declaration_token"
    ).notNull(),
    retrySafetyDeclaredAt: timestamp("retry_safety_declared_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    providerCorrelationToken: text("provider_correlation_token"),
    automaticRetryAllowed: boolean("automatic_retry_allowed").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    openedAt: timestamp("opened_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    outcomeKind: inboxV2OutboundDispatchAttemptOutcome("outcome_kind")
      .notNull()
      .default("pending"),
    completionSource:
      inboxV2OutboundDispatchAttemptCompletionSource("completion_source"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    retryAt: timestamp("retry_at", { withTimezone: true, precision: 3 }),
    providerAcknowledgementToken: text("provider_acknowledgement_token"),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryable: boolean("diagnostic_retryable"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    unknownRequiredAction: inboxV2OutboundDispatchUnknownRequiredAction(
      "unknown_required_action"
    ),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_attempts_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_attempts_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_attempts_dispatch_fk",
      columns: [
        table.tenantId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatches.tenantId,
        inboxV2OutboundDispatches.id,
        inboxV2OutboundDispatches.routeId,
        inboxV2OutboundDispatches.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_attempts_route_fk",
      columns: [table.tenantId, table.routeId],
      foreignColumns: [inboxV2OutboundRoutes.tenantId, inboxV2OutboundRoutes.id]
    }),
    unique("inbox_v2_outbound_dispatch_attempts_number_unique").on(
      table.tenantId,
      table.dispatchId,
      table.attemptNumber
    ),
    unique("inbox_v2_outbound_dispatch_attempts_claim_unique").on(
      table.tenantId,
      table.claimToken
    ),
    unique("inbox_v2_outbound_dispatch_attempts_chain_target_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId,
      table.routeId,
      table.messageId,
      table.outcomeKind,
      table.revision
    ),
    unique("inbox_v2_outbound_dispatch_attempts_artifact_target_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId,
      table.routeId,
      table.messageId
    ),
    uniqueIndex("inbox_v2_outbound_dispatch_attempts_one_pending_unique")
      .on(table.tenantId, table.dispatchId)
      .where(sql`${table.outcomeKind} = 'pending'`),
    check(
      "inbox_v2_outbound_dispatch_attempts_id_check",
      idSql(table.id, "outbound_dispatch_attempt")
    ),
    check(
      "inbox_v2_outbound_dispatch_attempts_retry_safety_check",
      sql`(${boundedJsonObjectSql(table.retrySafetyAdapterContractSnapshot, 16_384)}
        and ${catalogIdSql(table.retrySafetyDeclaredByTrustedServiceId)}
        and ${routingTokenSql(table.retrySafetyDeclarationToken)}
        and isfinite((${table.retrySafetyAdapterContractSnapshot} #>>
          '{loadedAt}')::timestamptz)
        and isfinite(${table.retrySafetyDeclaredAt})
        and (${table.retrySafetyAdapterContractSnapshot} #>>
          '{loadedAt}')::timestamptz <= ${table.retrySafetyDeclaredAt}
        and ${table.retrySafetyDeclaredAt} <= ${table.openedAt}
        and (
          (${table.retrySafetyMechanism} = 'unsafe_or_unknown'
            and ${table.providerCorrelationToken} is null
            and not ${table.automaticRetryAllowed})
          or (${table.retrySafetyMechanism} <> 'unsafe_or_unknown'
            and ${routingTokenSql(table.providerCorrelationToken)})
        )) is true`
    ),
    check(
      "inbox_v2_outbound_dispatch_attempts_lease_check",
      sql`${table.attemptNumber} between 1 and 1000000
        and ${routingTokenSql(table.claimToken)}
        and isfinite(${table.openedAt})
        and isfinite(${table.leaseExpiresAt})
        and ${table.leaseExpiresAt} > ${table.openedAt}`
    ),
    check(
      "inbox_v2_outbound_dispatch_attempts_outcome_check",
      attemptOutcomeSql(table)
    ),
    index("inbox_v2_outbound_dispatch_attempts_tenant_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.attemptNumber.desc()
    ),
    index("inbox_v2_outbound_dispatch_attempts_tenant_retry_idx").on(
      table.tenantId,
      table.outcomeKind,
      table.retryAt,
      table.dispatchId
    ),
    index("inbox_v2_outbound_dispatch_attempts_pending_lease_idx")
      .on(table.tenantId, table.leaseExpiresAt, table.id)
      .where(sql`${table.outcomeKind} = 'pending'`)
  ]
);

/**
 * Immutable provider/client correlation ownership established by the first
 * durable attempt before provider I/O. Retries may reuse the token only for
 * this exact dispatch and route; another dispatch cannot claim it.
 */
export const inboxV2OutboundProviderCorrelationAnchors = pgTable(
  "inbox_v2_outbound_provider_correlation_anchors",
  {
    tenantId: text("tenant_id").notNull(),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterDeclarationRevision: bigint("adapter_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    correlationToken: text("correlation_token").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    messageId: text("message_id").notNull(),
    firstAttemptId: text("first_attempt_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    retrySafetyMechanism: inboxV2OutboundRetrySafetyMechanism(
      "retry_safety_mechanism"
    ).notNull(),
    declaredByTrustedServiceId: text(
      "declared_by_trusted_service_id"
    ).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_provider_correlation_anchors_pk",
      columns: [
        table.tenantId,
        table.adapterContractId,
        table.adapterContractVersion,
        table.adapterDeclarationRevision,
        table.adapterSurfaceId,
        table.correlationToken
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_correlation_anchors_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_provider_correlation_anchors_dispatch_fk",
      columns: [
        table.tenantId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatches.tenantId,
        inboxV2OutboundDispatches.id,
        inboxV2OutboundDispatches.routeId,
        inboxV2OutboundDispatches.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_correlation_anchors_attempt_fk",
      columns: [
        table.tenantId,
        table.firstAttemptId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatchAttempts.tenantId,
        inboxV2OutboundDispatchAttempts.id,
        inboxV2OutboundDispatchAttempts.dispatchId,
        inboxV2OutboundDispatchAttempts.routeId,
        inboxV2OutboundDispatchAttempts.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_correlation_anchors_binding_fk",
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
    unique("inbox_v2_outbound_provider_correlation_anchors_dispatch_unique").on(
      table.tenantId,
      table.dispatchId
    ),
    unique("inbox_v2_outbound_provider_correlation_anchors_target_unique").on(
      table.tenantId,
      table.adapterContractId,
      table.adapterContractVersion,
      table.adapterDeclarationRevision,
      table.adapterSurfaceId,
      table.correlationToken,
      table.dispatchId,
      table.routeId,
      table.messageId,
      table.firstAttemptId
    ),
    check(
      "inbox_v2_outbound_provider_correlation_anchors_value_check",
      sql`${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${routingTokenSql(table.correlationToken)}
        and ${table.bindingGeneration} >= 1
        and ${table.retrySafetyMechanism} <> 'unsafe_or_unknown'
        and ${catalogIdSql(table.declaredByTrustedServiceId)}
        and isfinite(${table.createdAt})
        and ${table.revision} = 1`
    ),
    index("inbox_v2_outbound_provider_correlation_anchors_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.firstAttemptId
    )
  ]
);

export const inboxV2OutboundDispatchReconciliationDecisions = pgTable(
  "inbox_v2_outbound_dispatch_reconciliation_decisions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    messageId: text("message_id").notNull(),
    unknownAttemptId: text("unknown_attempt_id").notNull(),
    unknownAttemptOutcomeKind: inboxV2OutboundDispatchAttemptOutcome(
      "unknown_attempt_outcome_kind"
    )
      .notNull()
      .default("outcome_unknown"),
    unknownAttemptRevision: bigint("unknown_attempt_revision", {
      mode: "bigint"
    })
      .notNull()
      .default(sql`2`),
    decidedByKind: inboxV2OutboundActorKind("decided_by_kind").notNull(),
    decidedByEmployeeId: text("decided_by_employee_id"),
    decidedByTrustedServiceId: text("decided_by_trusted_service_id"),
    authorizationEpoch: text("authorization_epoch"),
    resultState:
      inboxV2OutboundDispatchReconciliationResult("result_state").notNull(),
    providerAcknowledgementToken: text("provider_acknowledgement_token"),
    evidenceToken: text("evidence_token").notNull(),
    retryAt: timestamp("retry_at", { withTimezone: true, precision: 3 }),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryable: boolean("diagnostic_retryable"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    retryAuthorizationKind: inboxV2OutboundDispatchRetryAuthorizationKind(
      "retry_authorization_kind"
    )
      .notNull()
      .default("not_applicable"),
    retryAuthorizationEmployeeId: text("retry_authorization_employee_id"),
    duplicateRiskAcknowledged: boolean("duplicate_risk_acknowledged"),
    retryReasonId: text("retry_reason_id"),
    retryReason: text("retry_reason"),
    operatorAuthorizationSnapshot: jsonb(
      "operator_authorization_snapshot"
    ).$type<Record<string, unknown>>(),
    operatorAuthorizationDecisionToken: text(
      "operator_authorization_decision_token"
    ),
    operatorAuthorizationDecisionRevision: bigint(
      "operator_authorization_decision_revision",
      { mode: "bigint" }
    ),
    operatorAuthorizationLoadedByTrustedServiceId: text(
      "operator_authorization_loaded_by_trusted_service_id"
    ),
    operatorAuthorizationDecidedAt: timestamp(
      "operator_authorization_decided_at",
      { withTimezone: true, precision: 3 }
    ),
    operatorAuthorizationNotAfter: timestamp(
      "operator_authorization_not_after",
      { withTimezone: true, precision: 3 }
    ),
    matchedPermissionCount: smallint("matched_permission_count")
      .notNull()
      .default(sql`0`),
    matchedPermissionsDigestSha256: text("matched_permissions_digest_sha256"),
    decidedAt: timestamp("decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_decisions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_dispatch_fk",
      columns: [
        table.tenantId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatches.tenantId,
        inboxV2OutboundDispatches.id,
        inboxV2OutboundDispatches.routeId,
        inboxV2OutboundDispatches.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_attempt_fk",
      columns: [
        table.tenantId,
        table.unknownAttemptId,
        table.dispatchId,
        table.routeId,
        table.messageId,
        table.unknownAttemptOutcomeKind,
        table.unknownAttemptRevision
      ],
      foreignColumns: [
        inboxV2OutboundDispatchAttempts.tenantId,
        inboxV2OutboundDispatchAttempts.id,
        inboxV2OutboundDispatchAttempts.dispatchId,
        inboxV2OutboundDispatchAttempts.routeId,
        inboxV2OutboundDispatchAttempts.messageId,
        inboxV2OutboundDispatchAttempts.outcomeKind,
        inboxV2OutboundDispatchAttempts.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_actor_employee_fk",
      columns: [table.tenantId, table.decidedByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_retry_employee_fk",
      columns: [table.tenantId, table.retryAuthorizationEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    unique("inbox_v2_outbound_dispatch_reconciliation_attempt_unique").on(
      table.tenantId,
      table.unknownAttemptId
    ),
    unique("inbox_v2_outbound_dispatch_reconciliation_target_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId,
      table.routeId,
      table.unknownAttemptId,
      table.resultState
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_id_check",
      idSql(table.id, "outbound_dispatch_reconciliation_decision")
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_attempt_check",
      sql`${table.unknownAttemptOutcomeKind} = 'outcome_unknown'
        and ${table.unknownAttemptRevision} = 2`
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_actor_check",
      actorSql(
        table.decidedByKind,
        table.decidedByEmployeeId,
        table.decidedByTrustedServiceId
      )
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_result_check",
      reconciliationResultSql(table)
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_authorization_check",
      reconciliationAuthorizationSql(table)
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_immutable_check",
      sql`${routingTokenSql(table.evidenceToken)}
        and ${table.revision} = 1
        and isfinite(${table.decidedAt})`
    ),
    index("inbox_v2_outbound_dispatch_reconciliation_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.decidedAt,
      table.id
    ),
    index("inbox_v2_outbound_reconciliation_actor_employee_idx").on(
      table.tenantId,
      table.decidedByEmployeeId,
      table.id
    ),
    index("inbox_v2_outbound_reconciliation_retry_employee_idx").on(
      table.tenantId,
      table.retryAuthorizationEmployeeId,
      table.id
    )
  ]
);

export const inboxV2OutboundDispatchReconciliationPermissions = pgTable(
  "inbox_v2_outbound_dispatch_reconciliation_permissions",
  {
    tenantId: text("tenant_id").notNull(),
    decisionId: text("decision_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    permissionId: text("permission_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_permissions_pk",
      columns: [table.tenantId, table.decisionId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_reconciliation_permissions_decision_fk",
      columns: [table.tenantId, table.decisionId],
      foreignColumns: [
        inboxV2OutboundDispatchReconciliationDecisions.tenantId,
        inboxV2OutboundDispatchReconciliationDecisions.id
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_outbound_dispatch_reconciliation_permission_unique").on(
      table.tenantId,
      table.decisionId,
      table.permissionId
    ),
    check(
      "inbox_v2_outbound_dispatch_reconciliation_permissions_value_check",
      sql`${table.ordinal} between 0 and 63
        and ${catalogIdSql(table.permissionId)}`
    ),
    index("inbox_v2_outbound_reconciliation_permissions_tenant_idx").on(
      table.tenantId,
      table.decisionId,
      table.permissionId
    )
  ]
);

export const inboxV2OutboundDispatchArtifacts = pgTable(
  "inbox_v2_outbound_dispatch_artifacts",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    messageId: text("message_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    state: inboxV2OutboundDispatchArtifactState("state").notNull(),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryable: boolean("diagnostic_retryable"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_artifacts_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifacts_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifacts_attempt_fk",
      columns: [
        table.tenantId,
        table.attemptId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatchAttempts.tenantId,
        inboxV2OutboundDispatchAttempts.id,
        inboxV2OutboundDispatchAttempts.dispatchId,
        inboxV2OutboundDispatchAttempts.routeId,
        inboxV2OutboundDispatchAttempts.messageId
      ]
    }),
    unique("inbox_v2_outbound_dispatch_artifacts_ordinal_unique").on(
      table.tenantId,
      table.dispatchId,
      table.attemptId,
      table.ordinal
    ),
    unique("inbox_v2_outbound_dispatch_artifacts_chain_target_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId,
      table.routeId,
      table.attemptId,
      table.messageId
    ),
    unique("inbox_v2_outbound_dispatch_artifacts_resolution_target_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId,
      table.routeId,
      table.attemptId,
      table.messageId,
      table.ordinal,
      table.state
    ),
    check(
      "inbox_v2_outbound_dispatch_artifacts_id_check",
      idSql(table.id, "outbound_dispatch_artifact")
    ),
    check(
      "inbox_v2_outbound_dispatch_artifacts_state_check",
      sql`${table.ordinal} between 1 and 100
        and (
          (${table.state} = 'accepted'
            and ${table.diagnosticCodeId} is null
            and ${table.diagnosticRetryable} is null
            and ${table.diagnosticCorrelationToken} is null
            and ${table.diagnosticSafeOperatorHintId} is null)
          or (${table.state} <> 'accepted'
            and ${catalogIdSql(table.diagnosticCodeId)}
            and ${table.diagnosticRetryable} is not null
            and ${routingTokenSql(table.diagnosticCorrelationToken)}
            and (${table.diagnosticSafeOperatorHintId} is null
              or ${catalogIdSql(table.diagnosticSafeOperatorHintId)}))
        )`
    ),
    check(
      "inbox_v2_outbound_dispatch_artifacts_immutable_check",
      sql`${table.revision} = 1 and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_outbound_dispatch_artifacts_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.attemptId,
      table.ordinal
    )
  ]
);

export const inboxV2SourceOccurrenceResolutionTransitions = pgTable(
  "inbox_v2_source_occurrence_resolution_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    fromState: inboxV2SourceOccurrenceResolutionState("from_state").notNull(),
    toState: inboxV2SourceOccurrenceResolutionState("to_state").notNull(),
    resolvedExternalMessageReferenceId: text(
      "resolved_external_message_reference_id"
    ),
    candidateCount: smallint("candidate_count")
      .notNull()
      .default(sql`0`),
    candidatesDigestSha256: text("candidates_digest_sha256"),
    diagnosticCodeId: text("diagnostic_code_id"),
    diagnosticRetryable: boolean("diagnostic_retryable"),
    diagnosticCorrelationToken: text("diagnostic_correlation_token"),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    resolverTrustedServiceId: text("resolver_trusted_service_id").notNull(),
    resolutionToken: text("resolution_token").notNull(),
    changedAt: timestamp("changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_occurrence_resolution_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrence_resolution_transitions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_occurrence_resolution_transitions_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrence_resolution_transitions_reference_fk",
      columns: [table.tenantId, table.resolvedExternalMessageReferenceId],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id
      ]
    }),
    unique(
      "inbox_v2_source_occurrence_resolution_transition_revision_unique"
    ).on(table.tenantId, table.sourceOccurrenceId, table.resultingRevision),
    unique("inbox_v2_source_occurrence_resolution_transition_token_unique").on(
      table.tenantId,
      table.resolutionToken
    ),
    unique("inbox_v2_source_occurrence_resolution_transition_child_unique").on(
      table.tenantId,
      table.id,
      table.sourceOccurrenceId,
      table.resultingRevision
    ),
    unique("inbox_v2_source_occurrence_resolution_transition_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceOccurrenceId,
      table.resultingRevision,
      table.toState,
      table.resolvedExternalMessageReferenceId
    ),
    check(
      "inbox_v2_source_occurrence_resolution_transitions_id_check",
      idSql(table.id, "source_occurrence_resolution_transition")
    ),
    check(
      "inbox_v2_source_occurrence_resolution_transitions_revision_check",
      sql`${table.expectedRevision} >= 1
        and ${table.resultingRevision} = ${table.expectedRevision} + 1
        and ${table.fromState} <> 'resolved'
        and ${table.toState} <> 'pending'
        and ${table.revision} = 1`
    ),
    check(
      "inbox_v2_source_occurrence_resolution_transitions_result_check",
      sql`(
          ${table.toState} = 'resolved'
          and ${table.resolvedExternalMessageReferenceId} is not null
          and ${table.candidateCount} = 0
          and ${table.candidatesDigestSha256} is null
          and ${table.diagnosticCodeId} is null
          and ${table.diagnosticRetryable} is null
          and ${table.diagnosticCorrelationToken} is null
          and ${table.diagnosticSafeOperatorHintId} is null
        ) or (
          ${table.toState} = 'conflicted'
          and ${table.resolvedExternalMessageReferenceId} is null
          and ${table.candidateCount} between 2 and 100
          and ${sha256DigestSql(table.candidatesDigestSha256)}
          and ${catalogIdSql(table.diagnosticCodeId)}
          and ${table.diagnosticRetryable} is not null
          and ${routingTokenSql(table.diagnosticCorrelationToken)}
          and (${table.diagnosticSafeOperatorHintId} is null
            or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})
        )`
    ),
    check(
      "inbox_v2_source_occurrence_resolution_transitions_authority_check",
      sql`${catalogIdSql(table.resolverTrustedServiceId)}
        and ${routingTokenSql(table.resolutionToken)}
        and isfinite(${table.changedAt})`
    ),
    index("inbox_v2_source_occurrence_resolution_transitions_history_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.resultingRevision.desc()
    ),
    index("inbox_v2_source_occurrence_resolution_transitions_reference_idx").on(
      table.tenantId,
      table.resolvedExternalMessageReferenceId,
      table.id
    )
  ]
);

export const inboxV2SourceOccurrenceResolutionCandidates = pgTable(
  "inbox_v2_source_occurrence_resolution_candidates",
  {
    tenantId: text("tenant_id").notNull(),
    transitionId: text("transition_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_occurrence_resolution_candidates_pk",
      columns: [table.tenantId, table.transitionId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_source_occurrence_resolution_candidates_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.sourceOccurrenceId,
        table.resultingRevision
      ],
      foreignColumns: [
        inboxV2SourceOccurrenceResolutionTransitions.tenantId,
        inboxV2SourceOccurrenceResolutionTransitions.id,
        inboxV2SourceOccurrenceResolutionTransitions.sourceOccurrenceId,
        inboxV2SourceOccurrenceResolutionTransitions.resultingRevision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_occurrence_resolution_candidates_reference_fk",
      columns: [table.tenantId, table.externalMessageReferenceId],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id
      ]
    }),
    unique("inbox_v2_source_occurrence_resolution_candidate_unique").on(
      table.tenantId,
      table.transitionId,
      table.externalMessageReferenceId
    ),
    check(
      "inbox_v2_source_occurrence_resolution_candidates_ordinal_check",
      sql`${table.ordinal} between 0 and 99`
    ),
    index("inbox_v2_source_occurrence_resolution_candidates_reference_idx").on(
      table.tenantId,
      table.externalMessageReferenceId,
      table.transitionId
    )
  ]
);

export const inboxV2OutboundDispatchArtifactReferenceLinks = pgTable(
  "inbox_v2_outbound_dispatch_artifact_reference_links",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    artifactId: text("artifact_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    messageId: text("message_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    sourceOccurrenceRevision: bigint("source_occurrence_revision", {
      mode: "bigint"
    }).notNull(),
    sourceOccurrenceResolutionState: inboxV2SourceOccurrenceResolutionState(
      "source_occurrence_resolution_state"
    )
      .notNull()
      .default("resolved"),
    evidenceKind:
      inboxV2OutboundArtifactAssociationEvidenceKind("evidence_kind").notNull(),
    providerReferenceKindId: text("provider_reference_kind_id"),
    correlationToken: text("correlation_token"),
    linkedByTrustedServiceId: text("linked_by_trusted_service_id").notNull(),
    linkedAt: timestamp("linked_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_artifact_reference_links_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_artifact_reference_links_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_reference_links_artifact_fk",
      columns: [
        table.tenantId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatchArtifacts.tenantId,
        inboxV2OutboundDispatchArtifacts.id,
        inboxV2OutboundDispatchArtifacts.dispatchId,
        inboxV2OutboundDispatchArtifacts.routeId,
        inboxV2OutboundDispatchArtifacts.attemptId,
        inboxV2OutboundDispatchArtifacts.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_reference_links_reference_fk",
      columns: [
        table.tenantId,
        table.externalMessageReferenceId,
        table.externalThreadId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id,
        inboxV2ExternalMessageReferences.externalThreadId,
        inboxV2ExternalMessageReferences.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_reference_links_occurrence_fk",
      columns: [
        table.tenantId,
        table.sourceOccurrenceId,
        table.sourceOccurrenceRevision,
        table.sourceOccurrenceResolutionState,
        table.externalMessageReferenceId
      ],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id,
        inboxV2SourceOccurrences.revision,
        inboxV2SourceOccurrences.resolutionState,
        inboxV2SourceOccurrences.resolvedExternalMessageReferenceId
      ]
    }),
    unique("inbox_v2_outbound_artifact_reference_link_evidence_unique").on(
      table.tenantId,
      table.artifactId,
      table.externalMessageReferenceId,
      table.sourceOccurrenceId
    ),
    unique("inbox_v2_outbound_artifact_reference_link_artifact_unique").on(
      table.tenantId,
      table.artifactId
    ),
    check(
      "inbox_v2_outbound_artifact_reference_links_id_check",
      idSql(table.id, "outbound_dispatch_artifact_reference_link")
    ),
    check(
      "inbox_v2_outbound_artifact_reference_links_evidence_check",
      sql`(
          ${table.evidenceKind} = 'provider_response_attempt'
          and ${table.providerReferenceKindId} is null
          and ${table.correlationToken} is null
        ) or (
          ${table.evidenceKind} = 'provider_echo_correlation'
          and ${catalogIdSql(table.providerReferenceKindId)}
          and ${routingTokenSql(table.correlationToken)}
        )`
    ),
    check(
      "inbox_v2_outbound_artifact_reference_links_immutable_check",
      sql`${table.sourceOccurrenceRevision} >= 2
        and ${table.sourceOccurrenceResolutionState} = 'resolved'
        and ${catalogIdSql(table.linkedByTrustedServiceId)}
        and isfinite(${table.linkedAt})
        and ${table.revision} = 1`
    ),
    index("inbox_v2_outbound_artifact_reference_links_reference_idx").on(
      table.tenantId,
      table.externalMessageReferenceId,
      table.sourceOccurrenceId,
      table.id
    ),
    index("inbox_v2_outbound_artifact_reference_links_occurrence_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.sourceOccurrenceRevision,
      table.sourceOccurrenceResolutionState,
      table.externalMessageReferenceId,
      table.id
    ),
    index("inbox_v2_outbound_artifact_reference_links_correlation_idx").on(
      table.tenantId,
      table.correlationToken,
      table.id
    )
  ]
);

/**
 * Immutable provider response/echo fact. A synchronous provider response may
 * be recorded in the fenced provider-result transaction before its
 * SourceOccurrence row is materialized, so the bounded occurrence snapshot is
 * retained here and the FK is deliberately deferred to settlement.
 */
export const inboxV2OutboundProviderObservations = pgTable(
  "inbox_v2_outbound_provider_observations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    artifactId: text("artifact_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    messageId: text("message_id").notNull(),
    artifactOrdinal: smallint("artifact_ordinal").notNull(),
    artifactState:
      inboxV2OutboundDispatchArtifactState("artifact_state").notNull(),
    effectiveState: inboxV2OutboundDispatchArtifactState("effective_state")
      .notNull()
      .default("accepted"),
    contentPlanId: text("content_plan_id").notNull(),
    contentPlanDigestSha256: text("content_plan_digest_sha256").notNull(),
    plannedArtifactCount: smallint("planned_artifact_count").notNull(),
    artifactPlanId: text("artifact_plan_id").notNull(),
    artifactPlanHashSha256: text("artifact_plan_hash_sha256").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    routeSourceConnectionId: text("route_source_connection_id").notNull(),
    routeSourceAccountId: text("route_source_account_id").notNull(),
    routeSourceThreadBindingId: text(
      "route_source_thread_binding_id"
    ).notNull(),
    routeBindingGeneration: bigint("route_binding_generation", {
      mode: "bigint"
    }).notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    sourceBindingGeneration: bigint("source_binding_generation", {
      mode: "bigint"
    }).notNull(),
    sourceMessageScopeKind: inboxV2SourceOccurrenceMessageScopeKind(
      "source_message_scope_kind"
    ).notNull(),
    sourceMessageDecisionStrength: inboxV2SourceOccurrenceDecisionStrength(
      "source_message_decision_strength"
    ).notNull(),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterDeclarationRevision: bigint("adapter_declaration_revision", {
      mode: "bigint"
    }).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    correlationAnchorFirstAttemptId: text(
      "correlation_anchor_first_attempt_id"
    ),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    sourceOccurrenceDetail: jsonb("source_occurrence_detail")
      .$type<Record<string, unknown>>()
      .notNull(),
    sourceOccurrenceDetailDigestSha256: text(
      "source_occurrence_detail_digest_sha256"
    ).notNull(),
    observationDetail: jsonb("observation_detail")
      .$type<Record<string, unknown>>()
      .notNull(),
    observationDetailDigestSha256: text(
      "observation_detail_digest_sha256"
    ).notNull(),
    evidenceKind:
      inboxV2OutboundArtifactAssociationEvidenceKind("evidence_kind").notNull(),
    providerReferenceKindId: text("provider_reference_kind_id"),
    correlationToken: text("correlation_token"),
    countsAsCustomerInbound: boolean("counts_as_customer_inbound")
      .notNull()
      .default(false),
    createsUnread: boolean("creates_unread").notNull().default(false),
    createsWorkItem: boolean("creates_work_item").notNull().default(false),
    requiresProviderIo: boolean("requires_provider_io")
      .notNull()
      .default(false),
    createsOutboundDispatch: boolean("creates_outbound_dispatch")
      .notNull()
      .default(false),
    notificationEligible: boolean("notification_eligible")
      .notNull()
      .default(false),
    observedByTrustedServiceId: text(
      "observed_by_trusted_service_id"
    ).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_provider_observations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_dispatch_fk",
      columns: [
        table.tenantId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatches.tenantId,
        inboxV2OutboundDispatches.id,
        inboxV2OutboundDispatches.routeId,
        inboxV2OutboundDispatches.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_attempt_fk",
      columns: [
        table.tenantId,
        table.attemptId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatchAttempts.tenantId,
        inboxV2OutboundDispatchAttempts.id,
        inboxV2OutboundDispatchAttempts.dispatchId,
        inboxV2OutboundDispatchAttempts.routeId,
        inboxV2OutboundDispatchAttempts.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_artifact_fk",
      columns: [
        table.tenantId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId,
        table.artifactOrdinal,
        table.artifactState
      ],
      foreignColumns: [
        inboxV2OutboundDispatchArtifacts.tenantId,
        inboxV2OutboundDispatchArtifacts.id,
        inboxV2OutboundDispatchArtifacts.dispatchId,
        inboxV2OutboundDispatchArtifacts.routeId,
        inboxV2OutboundDispatchArtifacts.attemptId,
        inboxV2OutboundDispatchArtifacts.messageId,
        inboxV2OutboundDispatchArtifacts.ordinal,
        inboxV2OutboundDispatchArtifacts.state
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_content_plan_fk",
      columns: [table.tenantId, table.contentPlanId, table.dispatchId],
      foreignColumns: [
        inboxV2FileOutboundDispatchPlans.tenantId,
        inboxV2FileOutboundDispatchPlans.id,
        inboxV2FileOutboundDispatchPlans.dispatchId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_artifact_plan_fk",
      columns: [
        table.tenantId,
        table.contentPlanId,
        table.artifactPlanId,
        table.artifactOrdinal
      ],
      foreignColumns: [
        inboxV2FileOutboundArtifactPlans.tenantId,
        inboxV2FileOutboundArtifactPlans.contentPlanId,
        inboxV2FileOutboundArtifactPlans.id,
        inboxV2FileOutboundArtifactPlans.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observations_route_binding_fk",
      columns: [
        table.tenantId,
        table.routeSourceThreadBindingId,
        table.externalThreadId,
        table.routeSourceConnectionId,
        table.routeSourceAccountId
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
      name: "inbox_v2_outbound_provider_observations_source_binding_fk",
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
      name: "inbox_v2_outbound_provider_observations_correlation_anchor_fk",
      columns: [
        table.tenantId,
        table.adapterContractId,
        table.adapterContractVersion,
        table.adapterDeclarationRevision,
        table.adapterSurfaceId,
        table.correlationToken,
        table.dispatchId,
        table.routeId,
        table.messageId,
        table.correlationAnchorFirstAttemptId
      ],
      foreignColumns: [
        inboxV2OutboundProviderCorrelationAnchors.tenantId,
        inboxV2OutboundProviderCorrelationAnchors.adapterContractId,
        inboxV2OutboundProviderCorrelationAnchors.adapterContractVersion,
        inboxV2OutboundProviderCorrelationAnchors.adapterDeclarationRevision,
        inboxV2OutboundProviderCorrelationAnchors.adapterSurfaceId,
        inboxV2OutboundProviderCorrelationAnchors.correlationToken,
        inboxV2OutboundProviderCorrelationAnchors.dispatchId,
        inboxV2OutboundProviderCorrelationAnchors.routeId,
        inboxV2OutboundProviderCorrelationAnchors.messageId,
        inboxV2OutboundProviderCorrelationAnchors.firstAttemptId
      ]
    }),
    unique("inbox_v2_outbound_provider_observations_replay_unique").on(
      table.tenantId,
      table.artifactId,
      table.sourceOccurrenceId,
      table.evidenceKind,
      table.sourceOccurrenceDetailDigestSha256
    ),
    unique("inbox_v2_outbound_provider_observations_target_unique").on(
      table.tenantId,
      table.id,
      table.artifactId,
      table.dispatchId,
      table.routeId,
      table.attemptId,
      table.messageId,
      table.artifactOrdinal,
      table.effectiveState,
      table.sourceOccurrenceId
    ),
    check(
      "inbox_v2_outbound_provider_observations_id_check",
      idSql(table.id, "outbound_provider_observation")
    ),
    check(
      "inbox_v2_outbound_provider_observations_artifact_check",
      sql`${table.artifactOrdinal} between 1 and 64
        and ${table.plannedArtifactCount} between 1 and 64
        and ${table.artifactOrdinal} <= ${table.plannedArtifactCount}
        and ${table.artifactState} in ('accepted', 'outcome_unknown')
        and ${table.effectiveState} = 'accepted'
        and ${sha256DigestSql(table.contentPlanDigestSha256)}
        and ${sha256DigestSql(table.artifactPlanHashSha256)}`
    ),
    check(
      "inbox_v2_outbound_provider_observations_surface_check",
      sql`${catalogIdSql(table.adapterContractId)}
        and ${versionTokenSql(table.adapterContractVersion)}
        and ${table.adapterDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${table.routeBindingGeneration} >= 1
        and ${table.sourceBindingGeneration} >= 1
        and (
          (${table.routeSourceConnectionId} = ${table.sourceConnectionId}
            and ${table.routeSourceAccountId} = ${table.sourceAccountId}
            and ${table.routeSourceThreadBindingId} = ${table.sourceThreadBindingId}
            and ${table.routeBindingGeneration} = ${table.sourceBindingGeneration})
          or (${table.evidenceKind} = 'provider_echo_correlation'
            and ${table.sourceMessageScopeKind} = 'provider_thread'
            and ${table.sourceMessageDecisionStrength} = 'authoritative')
        )`
    ),
    check(
      "inbox_v2_outbound_provider_observations_detail_check",
      sql`${boundedJsonObjectSql(table.sourceOccurrenceDetail, 65_536)}
        and ${sha256PrefixedSql(table.sourceOccurrenceDetailDigestSha256)}
        and (${table.sourceOccurrenceDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.sourceOccurrenceDetail} #>> '{id}') = ${table.sourceOccurrenceId}
        and (${table.sourceOccurrenceDetail} #>>
          '{bindingContext,externalThread,id}') = ${table.externalThreadId}
        and (${table.sourceOccurrenceDetail} #>>
          '{bindingContext,sourceAccount,id}') = ${table.sourceAccountId}
        and (${table.sourceOccurrenceDetail} #>>
          '{bindingContext,sourceThreadBinding,id}') = ${table.sourceThreadBindingId}
        and (${table.sourceOccurrenceDetail} #>>
          '{bindingContext,bindingGeneration}') = ${table.sourceBindingGeneration}::text
        and (${table.sourceOccurrenceDetail} #>>
          '{messageIdentityDeclaration,scopeKind}') = ${table.sourceMessageScopeKind}::text
        and (${table.sourceOccurrenceDetail} #>>
          '{messageIdentityDeclaration,decisionStrength}') =
          ${table.sourceMessageDecisionStrength}::text
        and (${table.sourceOccurrenceDetail} #>>
          '{descriptor,adapterContract,contractId}') = ${table.adapterContractId}
        and (${table.sourceOccurrenceDetail} #>>
          '{descriptor,adapterContract,contractVersion}') =
          ${table.adapterContractVersion}
        and (${table.sourceOccurrenceDetail} #>>
          '{descriptor,adapterContract,declarationRevision}') =
          ${table.adapterDeclarationRevision}::text
        and (${table.sourceOccurrenceDetail} #>>
          '{descriptor,adapterContract,surfaceId}') = ${table.adapterSurfaceId}
        and (${table.sourceOccurrenceDetail} #>> '{direction}') = 'outbound'
        and (${table.sourceOccurrenceDetail} -> 'providerActor') = 'null'::jsonb
        and (${table.sourceOccurrenceDetail} #>> '{resolution,state}') = 'pending'
        and (${table.sourceOccurrenceDetail} #>> '{revision}') = '1'
        and (${table.sourceOccurrenceDetail} #>> '{recordedAt}')::timestamptz =
          ${table.recordedAt}
        and (${table.sourceOccurrenceDetail} #>> '{createdAt}')::timestamptz =
          ${table.recordedAt}
        and (${table.sourceOccurrenceDetail} #>> '{updatedAt}')::timestamptz =
          ${table.recordedAt}`
    ),
    check(
      "inbox_v2_outbound_provider_observations_snapshot_check",
      sql`${boundedJsonObjectSql(table.observationDetail, 262_144)}
        and ${sha256PrefixedSql(table.observationDetailDigestSha256)}
        and (${table.observationDetail} #>> '{tenantId}') = ${table.tenantId}
        and (${table.observationDetail} #>> '{id}') = ${table.id}
        and (${table.observationDetail} #>> '{artifact,id}') = ${table.artifactId}
        and (${table.observationDetail} #>> '{artifact,ordinal}') =
          ${table.artifactOrdinal}::text
        and (${table.observationDetail} #>> '{artifact,state}') =
          ${table.artifactState}::text
        and (${table.observationDetail} #>> '{dispatch,id}') = ${table.dispatchId}
        and (${table.observationDetail} #>> '{route,id}') = ${table.routeId}
        and (${table.observationDetail} #>> '{attempt,id}') = ${table.attemptId}
        and (${table.observationDetail} #>> '{dispatch,message,id}') =
          ${table.messageId}
        and (${table.observationDetail} -> 'sourceOccurrence') =
          ${table.sourceOccurrenceDetail}
        and (${table.observationDetail} #>> '{evidence,kind}') =
          ${table.evidenceKind}::text
        and (${table.observationDetail} #>> '{observedByTrustedServiceId}') =
          ${table.observedByTrustedServiceId}
        and (${table.observationDetail} #>> '{recordedAt}')::timestamptz =
          ${table.recordedAt}
        and (${table.observationDetail} #>> '{revision}') = '1'`
    ),
    check(
      "inbox_v2_outbound_provider_observations_evidence_check",
      sql`(
          ${table.evidenceKind} = 'provider_response_attempt'
          and ${table.providerReferenceKindId} is null
          and ${table.correlationToken} is null
          and ${table.correlationAnchorFirstAttemptId} is null
          and (${table.sourceOccurrenceDetail} #>> '{origin,kind}') =
            'provider_response'
          and (${table.sourceOccurrenceDetail} #>>
            '{origin,outboundDispatchAttempt,id}') = ${table.attemptId}
          and ${table.routeSourceConnectionId} = ${table.sourceConnectionId}
          and ${table.routeSourceAccountId} = ${table.sourceAccountId}
          and ${table.routeSourceThreadBindingId} = ${table.sourceThreadBindingId}
          and ${table.routeBindingGeneration} = ${table.sourceBindingGeneration}
        ) or (
          ${table.evidenceKind} = 'provider_echo_correlation'
          and ${catalogIdSql(table.providerReferenceKindId)}
          and ${routingTokenSql(table.correlationToken)}
          and ${table.correlationAnchorFirstAttemptId} is not null
          and (${table.sourceOccurrenceDetail} #>> '{origin,kind}') =
            'provider_echo'
          and ${table.sourceOccurrenceDetail} @>
            jsonb_build_object(
              'descriptor', jsonb_build_object(
                'providerReferences', jsonb_build_array(
                  jsonb_build_object(
                    'kindId', ${table.providerReferenceKindId},
                    'subject', ${table.correlationToken}
                  )
                )
              )
            )
        )`
    ),
    check(
      "inbox_v2_outbound_provider_observations_effect_check",
      sql`not ${table.countsAsCustomerInbound}
        and not ${table.createsUnread}
        and not ${table.createsWorkItem}
        and not ${table.requiresProviderIo}
        and not ${table.createsOutboundDispatch}
        and not ${table.notificationEligible}`
    ),
    check(
      "inbox_v2_outbound_provider_observations_immutable_check",
      sql`${catalogIdSql(table.observedByTrustedServiceId)}
        and isfinite(${table.recordedAt})
        and ${table.revision} = 1`
    ),
    index("inbox_v2_outbound_provider_observations_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.attemptId,
      table.artifactOrdinal,
      table.id
    ),
    index("inbox_v2_outbound_provider_observations_occurrence_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.recordedAt,
      table.id
    )
  ]
);

/**
 * One append-only effective accepted result for one immutable artifact fact.
 * An outcome_unknown artifact is never rewritten; its accepted result is
 * backed by the exact observation and accepted reconciliation decision.
 */
export const inboxV2OutboundDispatchArtifactResolutions = pgTable(
  "inbox_v2_outbound_dispatch_artifact_resolutions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    artifactId: text("artifact_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    messageId: text("message_id").notNull(),
    artifactOrdinal: smallint("artifact_ordinal").notNull(),
    fromState: inboxV2OutboundDispatchArtifactState("from_state").notNull(),
    effectiveState: inboxV2OutboundDispatchArtifactState("effective_state")
      .notNull()
      .default("accepted"),
    observationId: text("observation_id").notNull(),
    observationSourceOccurrenceId: text(
      "observation_source_occurrence_id"
    ).notNull(),
    resolvedByTrustedServiceId: text(
      "resolved_by_trusted_service_id"
    ).notNull(),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_dispatch_artifact_resolutions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_resolutions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_resolutions_artifact_fk",
      columns: [
        table.tenantId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId,
        table.artifactOrdinal,
        table.fromState
      ],
      foreignColumns: [
        inboxV2OutboundDispatchArtifacts.tenantId,
        inboxV2OutboundDispatchArtifacts.id,
        inboxV2OutboundDispatchArtifacts.dispatchId,
        inboxV2OutboundDispatchArtifacts.routeId,
        inboxV2OutboundDispatchArtifacts.attemptId,
        inboxV2OutboundDispatchArtifacts.messageId,
        inboxV2OutboundDispatchArtifacts.ordinal,
        inboxV2OutboundDispatchArtifacts.state
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_dispatch_artifact_resolutions_observation_fk",
      columns: [
        table.tenantId,
        table.observationId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId,
        table.artifactOrdinal,
        table.effectiveState,
        table.observationSourceOccurrenceId
      ],
      foreignColumns: [
        inboxV2OutboundProviderObservations.tenantId,
        inboxV2OutboundProviderObservations.id,
        inboxV2OutboundProviderObservations.artifactId,
        inboxV2OutboundProviderObservations.dispatchId,
        inboxV2OutboundProviderObservations.routeId,
        inboxV2OutboundProviderObservations.attemptId,
        inboxV2OutboundProviderObservations.messageId,
        inboxV2OutboundProviderObservations.artifactOrdinal,
        inboxV2OutboundProviderObservations.effectiveState,
        inboxV2OutboundProviderObservations.sourceOccurrenceId
      ]
    }),
    unique(
      "inbox_v2_outbound_dispatch_artifact_resolutions_artifact_unique"
    ).on(table.tenantId, table.artifactId),
    unique("inbox_v2_outbound_dispatch_artifact_resolutions_target_unique").on(
      table.tenantId,
      table.id,
      table.artifactId,
      table.dispatchId,
      table.routeId,
      table.attemptId,
      table.messageId,
      table.effectiveState
    ),
    check(
      "inbox_v2_outbound_dispatch_artifact_resolutions_id_check",
      idSql(table.id, "outbound_dispatch_artifact_resolution")
    ),
    check(
      "inbox_v2_outbound_dispatch_artifact_resolutions_state_check",
      sql`${table.artifactOrdinal} between 1 and 64
        and ${table.fromState} in ('accepted', 'outcome_unknown')
        and ${table.effectiveState} = 'accepted'`
    ),
    check(
      "inbox_v2_outbound_dispatch_artifact_resolutions_immutable_check",
      sql`${catalogIdSql(table.resolvedByTrustedServiceId)}
        and isfinite(${table.resolvedAt})
        and ${table.revision} = 1`
    ),
    index("inbox_v2_outbound_dispatch_artifact_resolutions_attempt_idx").on(
      table.tenantId,
      table.dispatchId,
      table.attemptId,
      table.artifactOrdinal,
      table.id
    )
  ]
);

/**
 * Per-observation atomic settlement proof. Several response/echo occurrences
 * may reuse the first canonical artifact/reference link and one effective
 * artifact resolution, while each keeps its own SourceOccurrence and Message
 * transport link.
 */
export const inboxV2OutboundProviderObservationSettlements = pgTable(
  "inbox_v2_outbound_provider_observation_settlements",
  {
    tenantId: text("tenant_id").notNull(),
    observationId: text("observation_id").notNull(),
    artifactResolutionId: text("artifact_resolution_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    routeId: text("route_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    messageId: text("message_id").notNull(),
    artifactOrdinal: smallint("artifact_ordinal").notNull(),
    effectiveState: inboxV2OutboundDispatchArtifactState("effective_state")
      .notNull()
      .default("accepted"),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    sourceOccurrenceRevision: bigint("source_occurrence_revision", {
      mode: "bigint"
    }).notNull(),
    sourceOccurrenceResolutionState: inboxV2SourceOccurrenceResolutionState(
      "source_occurrence_resolution_state"
    )
      .notNull()
      .default("resolved"),
    externalThreadId: text("external_thread_id").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    canonicalArtifactReferenceLinkId: text(
      "canonical_artifact_reference_link_id"
    ).notNull(),
    messageTransportLinkId: text("message_transport_link_id").notNull(),
    transitionKind:
      inboxV2OutboundProviderSettlementTransitionKind(
        "transition_kind"
      ).notNull(),
    reconciliationDecisionId: text("reconciliation_decision_id"),
    reconciliationResultState: inboxV2OutboundDispatchReconciliationResult(
      "reconciliation_result_state"
    ),
    settledByTrustedServiceId: text("settled_by_trusted_service_id").notNull(),
    settledAt: timestamp("settled_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_provider_observation_settlements_pk",
      columns: [table.tenantId, table.observationId]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_observation_fk",
      columns: [
        table.tenantId,
        table.observationId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId,
        table.artifactOrdinal,
        table.effectiveState,
        table.sourceOccurrenceId
      ],
      foreignColumns: [
        inboxV2OutboundProviderObservations.tenantId,
        inboxV2OutboundProviderObservations.id,
        inboxV2OutboundProviderObservations.artifactId,
        inboxV2OutboundProviderObservations.dispatchId,
        inboxV2OutboundProviderObservations.routeId,
        inboxV2OutboundProviderObservations.attemptId,
        inboxV2OutboundProviderObservations.messageId,
        inboxV2OutboundProviderObservations.artifactOrdinal,
        inboxV2OutboundProviderObservations.effectiveState,
        inboxV2OutboundProviderObservations.sourceOccurrenceId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_resolution_fk",
      columns: [
        table.tenantId,
        table.artifactResolutionId,
        table.artifactId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.messageId,
        table.effectiveState
      ],
      foreignColumns: [
        inboxV2OutboundDispatchArtifactResolutions.tenantId,
        inboxV2OutboundDispatchArtifactResolutions.id,
        inboxV2OutboundDispatchArtifactResolutions.artifactId,
        inboxV2OutboundDispatchArtifactResolutions.dispatchId,
        inboxV2OutboundDispatchArtifactResolutions.routeId,
        inboxV2OutboundDispatchArtifactResolutions.attemptId,
        inboxV2OutboundDispatchArtifactResolutions.messageId,
        inboxV2OutboundDispatchArtifactResolutions.effectiveState
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_occurrence_fk",
      columns: [
        table.tenantId,
        table.sourceOccurrenceId,
        table.sourceOccurrenceRevision,
        table.sourceOccurrenceResolutionState,
        table.externalMessageReferenceId
      ],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id,
        inboxV2SourceOccurrences.revision,
        inboxV2SourceOccurrences.resolutionState,
        inboxV2SourceOccurrences.resolvedExternalMessageReferenceId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_reference_fk",
      columns: [
        table.tenantId,
        table.externalMessageReferenceId,
        table.externalThreadId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2ExternalMessageReferences.tenantId,
        inboxV2ExternalMessageReferences.id,
        inboxV2ExternalMessageReferences.externalThreadId,
        inboxV2ExternalMessageReferences.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_artifact_link_fk",
      columns: [table.tenantId, table.canonicalArtifactReferenceLinkId],
      foreignColumns: [
        inboxV2OutboundDispatchArtifactReferenceLinks.tenantId,
        inboxV2OutboundDispatchArtifactReferenceLinks.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_transport_link_fk",
      columns: [table.tenantId, table.messageTransportLinkId, table.messageId],
      foreignColumns: [
        inboxV2MessageTransportOccurrenceLinks.tenantId,
        inboxV2MessageTransportOccurrenceLinks.id,
        inboxV2MessageTransportOccurrenceLinks.messageId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_observation_settlements_decision_fk",
      columns: [
        table.tenantId,
        table.reconciliationDecisionId,
        table.dispatchId,
        table.routeId,
        table.attemptId,
        table.reconciliationResultState
      ],
      foreignColumns: [
        inboxV2OutboundDispatchReconciliationDecisions.tenantId,
        inboxV2OutboundDispatchReconciliationDecisions.id,
        inboxV2OutboundDispatchReconciliationDecisions.dispatchId,
        inboxV2OutboundDispatchReconciliationDecisions.routeId,
        inboxV2OutboundDispatchReconciliationDecisions.unknownAttemptId,
        inboxV2OutboundDispatchReconciliationDecisions.resultState
      ]
    }),
    unique(
      "inbox_v2_outbound_provider_observation_settlements_occurrence_unique"
    ).on(table.tenantId, table.sourceOccurrenceId),
    check(
      "inbox_v2_outbound_provider_observation_settlements_state_check",
      sql`${table.artifactOrdinal} between 1 and 64
        and ${table.effectiveState} = 'accepted'
        and ${table.sourceOccurrenceRevision} >= 2
        and ${table.sourceOccurrenceResolutionState} = 'resolved'
        and (
          (${table.transitionKind} = 'reconcile_outcome_unknown'
            and ${table.reconciliationDecisionId} is not null
            and ${table.reconciliationResultState} = 'accepted')
          or (${table.transitionKind} <> 'reconcile_outcome_unknown'
            and ${table.reconciliationDecisionId} is null
            and ${table.reconciliationResultState} is null)
        )`
    ),
    check(
      "inbox_v2_outbound_provider_observation_settlements_immutable_check",
      sql`${catalogIdSql(table.settledByTrustedServiceId)}
        and isfinite(${table.settledAt})
        and ${table.revision} = 1`
    ),
    index("inbox_v2_outbound_provider_observation_settlements_artifact_idx").on(
      table.tenantId,
      table.artifactId,
      table.settledAt,
      table.observationId
    ),
    index("inbox_v2_outbound_provider_observation_settlements_decision_idx").on(
      table.tenantId,
      table.reconciliationDecisionId,
      table.observationId
    )
  ]
);

/**
 * Durable execution handoff for an immutable provider observation. The two
 * candidate IDs are derived before enqueue because they do not exist until the
 * authorized settlement creates the canonical reference and transport link.
 * Lease tokens are stored only as hashes and every completion keeps a replay
 * fence for the worker result that moved the item.
 */
export const inboxV2OutboundProviderSettlementWorkItems = pgTable(
  "inbox_v2_outbound_provider_settlement_work_items",
  {
    tenantId: text("tenant_id").notNull(),
    observationId: text("observation_id").notNull(),
    candidateExternalMessageReferenceId: text(
      "candidate_external_message_reference_id"
    ).notNull(),
    candidateTransportLinkId: text("candidate_transport_link_id").notNull(),
    trustedServiceId: text("trusted_service_id").notNull(),
    state: inboxV2OutboundProviderSettlementWorkState("state")
      .notNull()
      .default("pending"),
    attemptCount: bigint("attempt_count", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    availableAt: timestamp("available_at", {
      withTimezone: true,
      precision: 3
    }),
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
    lastFinalizedLeaseOwnerId: text("last_finalized_lease_owner_id"),
    lastFinalizedLeaseTokenHash: text("last_finalized_lease_token_hash"),
    lastFinalizedLeaseRevision: bigint("last_finalized_lease_revision", {
      mode: "bigint"
    }),
    lastFinalizedResultHash: text("last_finalized_result_hash"),
    lastFinalizedAt: timestamp("last_finalized_at", {
      withTimezone: true,
      precision: 3
    }),
    lastErrorCode: text("last_error_code"),
    terminalAt: timestamp("terminal_at", {
      withTimezone: true,
      precision: 3
    }),
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
      name: "inbox_v2_outbound_provider_settlement_work_items_pk",
      columns: [table.tenantId, table.observationId]
    }),
    foreignKey({
      name: "inbox_v2_outbound_provider_settlement_work_items_observation_fk",
      columns: [table.tenantId, table.observationId],
      foreignColumns: [
        inboxV2OutboundProviderObservations.tenantId,
        inboxV2OutboundProviderObservations.id
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_outbound_provider_settlement_work_items_link_uk").on(
      table.tenantId,
      table.candidateTransportLinkId
    ),
    uniqueIndex("inbox_v2_outbound_provider_settlement_work_items_lease_uidx")
      .on(table.tenantId, table.leaseTokenHash)
      .where(sql`${table.leaseTokenHash} is not null`),
    check(
      "inbox_v2_outbound_provider_settlement_work_items_values_check",
      sql`${idSql(
        table.candidateExternalMessageReferenceId,
        "external_message_reference"
      )}
        and ${idSql(
          table.candidateTransportLinkId,
          "message_transport_occurrence_link"
        )}
        and ${catalogIdSql(table.trustedServiceId)}
        and ${table.attemptCount} >= 0
        and ${table.revision} >= 1
        and (${table.leaseOwnerId} is null
          or char_length(${table.leaseOwnerId}) between 1 and 256)
        and (${table.leaseTokenHash} is null
          or ${sha256PrefixedSql(table.leaseTokenHash)})
        and (${table.leaseRevision} is null or ${table.leaseRevision} >= 1)
        and (${table.lastFinalizedLeaseOwnerId} is null
          or char_length(${table.lastFinalizedLeaseOwnerId}) between 1 and 256)
        and (${table.lastFinalizedLeaseTokenHash} is null
          or ${sha256PrefixedSql(table.lastFinalizedLeaseTokenHash)})
        and (${table.lastFinalizedLeaseRevision} is null
          or ${table.lastFinalizedLeaseRevision} >= 1)
        and (${table.lastFinalizedResultHash} is null
          or ${sha256PrefixedSql(table.lastFinalizedResultHash)})
        and (${table.lastErrorCode} is null
          or char_length(${table.lastErrorCode}) between 3 and 256)`
    ),
    check(
      "inbox_v2_outbound_provider_settlement_work_items_lease_check",
      sql`(
          ${table.leaseOwnerId} is null
          and ${table.leaseTokenHash} is null
          and ${table.leaseRevision} is null
          and ${table.leaseClaimedAt} is null
          and ${table.leaseExpiresAt} is null
        ) or (
          ${table.leaseOwnerId} is not null
          and ${table.leaseTokenHash} is not null
          and ${table.leaseRevision} is not null
          and ${table.leaseClaimedAt} is not null
          and ${table.leaseExpiresAt} is not null
          and ${table.leaseExpiresAt} > ${table.leaseClaimedAt}
        )`
    ),
    check(
      "inbox_v2_outbound_provider_settlement_work_items_replay_check",
      sql`(
          ${table.lastFinalizedLeaseOwnerId} is null
          and ${table.lastFinalizedLeaseTokenHash} is null
          and ${table.lastFinalizedLeaseRevision} is null
          and ${table.lastFinalizedResultHash} is null
          and ${table.lastFinalizedAt} is null
        ) or (
          ${table.lastFinalizedLeaseOwnerId} is not null
          and ${table.lastFinalizedLeaseTokenHash} is not null
          and ${table.lastFinalizedLeaseRevision} is not null
          and ${table.lastFinalizedResultHash} is not null
          and ${table.lastFinalizedAt} is not null
        )`
    ),
    check(
      "inbox_v2_outbound_provider_settlement_work_items_state_check",
      sql`(
          ${table.state} = 'pending'
          and ${table.availableAt} is not null
          and ${table.leaseOwnerId} is null
          and ${table.terminalAt} is null
        ) or (
          ${table.state} = 'leased'
          and ${table.availableAt} is not null
          and ${table.leaseOwnerId} is not null
          and ${table.terminalAt} is null
        ) or (
          ${table.state} = 'settled'
          and ${table.availableAt} is null
          and ${table.leaseOwnerId} is null
          and ${table.lastFinalizedAt} is not null
          and ${table.lastErrorCode} is null
          and ${table.terminalAt} = ${table.lastFinalizedAt}
        ) or (
          ${table.state} = 'dead'
          and ${table.availableAt} is null
          and ${table.leaseOwnerId} is null
          and ${table.lastFinalizedAt} is not null
          and ${table.lastErrorCode} is not null
          and ${table.terminalAt} = ${table.lastFinalizedAt}
        )`
    ),
    check(
      "inbox_v2_outbound_provider_settlement_work_items_times_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.leaseClaimedAt} is null
          or isfinite(${table.leaseClaimedAt}))
        and (${table.leaseExpiresAt} is null
          or isfinite(${table.leaseExpiresAt}))
        and (${table.lastFinalizedAt} is null
          or isfinite(${table.lastFinalizedAt}))
        and (${table.terminalAt} is null or isfinite(${table.terminalAt}))`
    ),
    index("inbox_v2_outbound_provider_settlement_work_items_due_idx")
      .on(table.tenantId, table.availableAt, table.observationId)
      .where(sql`${table.state} = 'pending'`),
    index("inbox_v2_outbound_provider_settlement_work_items_reclaim_idx")
      .on(table.tenantId, table.leaseExpiresAt, table.observationId)
      .where(sql`${table.state} = 'leased'`),
    index("inbox_v2_outbound_provider_settlement_work_items_service_idx").on(
      table.tenantId,
      table.trustedServiceId,
      table.state,
      table.observationId
    )
  ]
);

export const inboxV2OutboundMultiSendChildren = pgTable(
  "inbox_v2_outbound_multi_send_children",
  {
    tenantId: text("tenant_id").notNull(),
    operationId: text("operation_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    conversationId: text("conversation_id").notNull(),
    externalThreadId: text("external_thread_id").notNull(),
    bindingId: text("binding_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    routeId: text("route_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    messageId: text("message_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_multi_send_children_pk",
      columns: [table.tenantId, table.operationId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_outbound_multi_send_children_operation_fk",
      columns: [table.tenantId, table.operationId],
      foreignColumns: [
        inboxV2OutboundMultiSendOperations.tenantId,
        inboxV2OutboundMultiSendOperations.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_multi_send_children_binding_fk",
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
      name: "inbox_v2_outbound_multi_send_children_route_fk",
      columns: [
        table.tenantId,
        table.routeId,
        table.conversationId,
        table.externalThreadId,
        table.bindingId,
        table.sourceConnectionId,
        table.sourceAccountId
      ],
      foreignColumns: [
        inboxV2OutboundRoutes.tenantId,
        inboxV2OutboundRoutes.id,
        inboxV2OutboundRoutes.conversationId,
        inboxV2OutboundRoutes.externalThreadId,
        inboxV2OutboundRoutes.sourceThreadBindingId,
        inboxV2OutboundRoutes.sourceConnectionId,
        inboxV2OutboundRoutes.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_outbound_multi_send_children_dispatch_fk",
      columns: [
        table.tenantId,
        table.dispatchId,
        table.routeId,
        table.messageId
      ],
      foreignColumns: [
        inboxV2OutboundDispatches.tenantId,
        inboxV2OutboundDispatches.id,
        inboxV2OutboundDispatches.routeId,
        inboxV2OutboundDispatches.messageId
      ]
    }),
    unique("inbox_v2_outbound_multi_send_children_dispatch_unique").on(
      table.tenantId,
      table.operationId,
      table.dispatchId
    ),
    unique("inbox_v2_outbound_multi_send_children_route_unique").on(
      table.tenantId,
      table.operationId,
      table.routeId
    ),
    unique("inbox_v2_outbound_multi_send_children_target_unique").on(
      table.tenantId,
      table.operationId,
      table.externalThreadId,
      table.bindingId
    ),
    check(
      "inbox_v2_outbound_multi_send_children_ordinal_check",
      sql`${table.ordinal} between 0 and 99`
    ),
    index("inbox_v2_outbound_multi_send_children_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.routeId,
      table.messageId,
      table.operationId
    )
  ]
);

/**
 * Cross-aggregate invariants that cannot be represented by Drizzle without a
 * runtime module cycle. Every lookup is by a primary/unique tenant key and every
 * bounded collection is checked by a deferred constraint trigger.
 */
export const INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL = String.raw`
alter table public.inbox_v2_source_occurrences
  add constraint inbox_v2_source_occurrences_provider_response_attempt_fk
  foreign key (tenant_id, outbound_dispatch_attempt_id)
  references public.inbox_v2_outbound_dispatch_attempts (tenant_id, id);

alter table public.inbox_v2_source_occurrences
  add constraint inbox_v2_source_occurrences_resolved_reference_fk
  foreign key (tenant_id, resolved_external_message_reference_id)
  references public.inbox_v2_external_message_references (tenant_id, id);

alter table public.inbox_v2_outbound_dispatches
  add constraint inbox_v2_outbound_dispatches_active_attempt_fk
  foreign key (tenant_id, active_attempt_id)
  references public.inbox_v2_outbound_dispatch_attempts (tenant_id, id)
  deferrable initially deferred;

alter table public.inbox_v2_outbound_dispatches
  add constraint inbox_v2_outbound_dispatches_last_attempt_fk
  foreign key (tenant_id, last_attempt_id)
  references public.inbox_v2_outbound_dispatch_attempts (tenant_id, id)
  deferrable initially deferred;

alter table public.inbox_v2_outbound_dispatches
  add constraint inbox_v2_outbound_dispatches_retry_decision_fk
  foreign key (tenant_id, retry_authorization_decision_id)
  references public.inbox_v2_outbound_dispatch_reconciliation_decisions
    (tenant_id, id)
  deferrable initially deferred;

create or replace function public.inbox_v2_outbound_transport_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row
     where tenant_row.id = old_row->>'tenant_id'
  ) then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format('inbox_v2.outbound_transport_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;
create or replace function public.inbox_v2_external_message_reference_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.scope_kind = 'source_thread_binding' then
    perform 1
      from public.inbox_v2_source_thread_bindings binding_row
     where binding_row.tenant_id = new.tenant_id
       and binding_row.id = new.scope_source_thread_binding_id
       and binding_row.external_thread_id = new.external_thread_id
     for share;

    if not found then
      raise exception using errcode = '23514',
        message = 'inbox_v2.external_message_reference_binding_thread_mismatch';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_route_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_source_thread_binding_snapshots snapshot_row
    join public.inbox_v2_source_thread_binding_heads head_row
      on head_row.tenant_id = snapshot_row.tenant_id
     and head_row.binding_id = snapshot_row.binding_id
     and head_row.revision = snapshot_row.revision
     and head_row.external_thread_id = snapshot_row.external_thread_id
     and head_row.source_connection_id = snapshot_row.source_connection_id
     and head_row.source_account_id = snapshot_row.source_account_id
     and head_row.account_generation = snapshot_row.account_generation
     and head_row.binding_generation = snapshot_row.binding_generation
     and head_row.remote_access_revision = snapshot_row.remote_access_revision
     and head_row.administrative_revision = snapshot_row.administrative_revision
     and head_row.capability_revision = snapshot_row.capability_revision
     and head_row.route_descriptor_revision = snapshot_row.route_descriptor_revision
   where snapshot_row.tenant_id = new.tenant_id
     and snapshot_row.binding_id = new.source_thread_binding_id
     and snapshot_row.revision = new.binding_revision
     and snapshot_row.external_thread_id = new.external_thread_id
     and snapshot_row.source_connection_id = new.source_connection_id
     and snapshot_row.source_account_id = new.source_account_id
     and snapshot_row.account_generation = new.account_generation
     and snapshot_row.binding_generation = new.binding_generation
     and snapshot_row.remote_access_revision = new.remote_access_revision
     and snapshot_row.administrative_revision = new.administrative_revision
     and snapshot_row.capability_revision = new.capability_revision
     and snapshot_row.route_descriptor_revision = new.route_descriptor_revision
     and snapshot_row.remote_access_state = 'active'
     and snapshot_row.administrative_state = 'enabled'
     and snapshot_row.route_contract_id = new.adapter_contract_id
     and snapshot_row.route_contract_version = new.adapter_contract_version
     and snapshot_row.route_declaration_revision =
        new.adapter_declaration_revision
     and snapshot_row.route_surface_id = new.adapter_surface_id
     and snapshot_row.route_loaded_by_trusted_service_id =
        new.adapter_loaded_by_trusted_service_id
     and snapshot_row.route_loaded_at = new.adapter_loaded_at
     and row(
       head_row.runtime_health_state,
       head_row.runtime_health_revision,
       head_row.runtime_health_checked_at,
       head_row.runtime_diagnostic_code_id,
       head_row.runtime_diagnostic_retryable,
       head_row.runtime_diagnostic_correlation_token,
       head_row.runtime_diagnostic_safe_operator_hint_id
     ) is not distinct from row(
       snapshot_row.runtime_health_state,
       snapshot_row.runtime_health_revision,
       snapshot_row.runtime_health_checked_at,
       snapshot_row.runtime_diagnostic_code_id,
       snapshot_row.runtime_diagnostic_retryable,
       snapshot_row.runtime_diagnostic_correlation_token,
       snapshot_row.runtime_diagnostic_safe_operator_hint_id
     )
     and new.runtime_observation_snapshot #>> '{state}' =
        snapshot_row.runtime_health_state::text
     and new.runtime_observation_snapshot #>> '{revision}' =
        snapshot_row.runtime_health_revision::text
     and (new.runtime_observation_snapshot #>> '{observedAt}')::timestamptz =
        snapshot_row.runtime_health_checked_at
     and (
       (
         snapshot_row.runtime_diagnostic_code_id is null
         and snapshot_row.runtime_diagnostic_retryable is null
         and snapshot_row.runtime_diagnostic_correlation_token is null
         and snapshot_row.runtime_diagnostic_safe_operator_hint_id is null
         and new.runtime_observation_snapshot #> '{diagnostic}' = 'null'::jsonb
       )
       or (
         snapshot_row.runtime_diagnostic_code_id =
           new.runtime_observation_snapshot #>> '{diagnostic,codeId}'
         and snapshot_row.runtime_diagnostic_retryable =
           (new.runtime_observation_snapshot #>>
             '{diagnostic,retryable}')::boolean
         and snapshot_row.runtime_diagnostic_correlation_token =
           new.runtime_observation_snapshot #>>
             '{diagnostic,correlationToken}'
         and snapshot_row.runtime_diagnostic_safe_operator_hint_id is not
           distinct from new.runtime_observation_snapshot #>>
             '{diagnostic,safeOperatorHintId}'
       )
     )
     and snapshot_row.route_descriptor_schema_id =
        new.route_descriptor_snapshot #>> '{descriptorSchemaId}'
     and snapshot_row.route_descriptor_version =
        new.route_descriptor_snapshot #>> '{descriptorVersion}'
     and snapshot_row.route_descriptor_revision::text =
        new.route_descriptor_snapshot #>> '{descriptorRevision}'
     and snapshot_row.route_destination_kind_id =
        new.route_descriptor_snapshot #>> '{destinationKindId}'
     and snapshot_row.route_destination_subject =
        new.route_descriptor_snapshot #>> '{destinationSubject}'
     and snapshot_row.route_descriptor_digest_sha256 =
        new.route_descriptor_digest_sha256
     and jsonb_typeof(new.route_descriptor_snapshot #> '{attributes}') = 'array'
     and jsonb_array_length(new.route_descriptor_snapshot #> '{attributes}') =
        snapshot_row.route_attribute_count
     and not exists (
       select 1
         from jsonb_array_elements(
           new.route_descriptor_snapshot #> '{attributes}'
         ) with ordinality as supplied_attribute(value, ordinal)
         left join public.inbox_v2_source_thread_binding_route_attributes
           stored_attribute
           on stored_attribute.tenant_id = snapshot_row.tenant_id
          and stored_attribute.binding_id = snapshot_row.binding_id
          and stored_attribute.route_descriptor_revision =
             snapshot_row.route_descriptor_revision
          and stored_attribute.ordinal = supplied_attribute.ordinal - 1
        where stored_attribute.ordinal is null
           or supplied_attribute.value is distinct from jsonb_build_object(
             'attributeId', stored_attribute.attribute_id,
             'value', stored_attribute.value
           )
     )
     and snapshot_row.updated_at <= new.created_at
   for share of snapshot_row, head_row;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.outbound_route_binding_fence_conflict';
  end if;

  perform 1
    from public.inbox_v2_thread_route_policy_versions policy_row
    join public.inbox_v2_thread_route_policy_heads policy_head
      on policy_head.tenant_id = policy_row.tenant_id
     and policy_head.policy_id = policy_row.policy_id
     and policy_head.revision = policy_row.revision
     and policy_head.conversation_id = policy_row.conversation_id
     and policy_head.external_thread_id = policy_row.external_thread_id
     and policy_head.operation_id = policy_row.operation_id
     and policy_head.content_kind_id is not distinct from policy_row.content_kind_id
   where policy_row.tenant_id = new.tenant_id
     and policy_row.policy_id = new.route_policy_id
     and policy_row.revision = new.route_policy_revision
     and policy_row.conversation_id = new.conversation_id
     and policy_row.external_thread_id = new.external_thread_id
     and policy_row.operation_id = new.operation_id
     and policy_row.content_kind_id is not distinct from new.content_kind_id
     and policy_row.required_conversation_permission_id =
        new.required_conversation_permission_id
     and policy_row.updated_at <= new.created_at
     and (
       new.selection_reason <> 'preferred_binding'
       or policy_row.preferred_binding_id = new.source_thread_binding_id
     )
     and (
       new.selection_reason <> 'policy_fallback'
       or exists (
         select 1
           from public.inbox_v2_thread_route_policy_fallback_bindings fallback_row
          where fallback_row.tenant_id = new.tenant_id
            and fallback_row.policy_id = new.route_policy_id
            and fallback_row.policy_revision = new.route_policy_revision
            and fallback_row.ordinal = new.fallback_policy_ordinal
            and fallback_row.external_thread_id = new.external_thread_id
            and fallback_row.binding_id = new.source_thread_binding_id
            and fallback_row.source_connection_id = new.source_connection_id
            and fallback_row.source_account_id = new.source_account_id
       )
     )
   for share of policy_row, policy_head;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.outbound_route_policy_mismatch';
  end if;

  if new.selection_intent_kind = 'explicit_occurrence' and not exists (
    select 1
      from public.inbox_v2_source_occurrences occurrence_row
     where occurrence_row.tenant_id = new.tenant_id
       and occurrence_row.id =
          new.selection_intent_snapshot #>> '{occurrence,id}'
       and occurrence_row.conversation_id = new.conversation_id
       and occurrence_row.external_thread_id = new.external_thread_id
       and occurrence_row.source_thread_binding_id =
          new.source_thread_binding_id
       and occurrence_row.source_connection_id = new.source_connection_id
       and occurrence_row.source_account_id = new.source_account_id
     for share
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_explicit_occurrence_mismatch';
  end if;

  if new.selection_intent_kind = 'explicit_reroute' and not exists (
    select 1
      from public.inbox_v2_outbound_routes original_route
     where original_route.tenant_id = new.tenant_id
       and original_route.id =
          new.selection_intent_snapshot #>> '{originalRoute,id}'
       and original_route.conversation_id = new.conversation_id
       and original_route.external_thread_id = new.external_thread_id
       and original_route.operation_id = new.operation_id
       and original_route.content_kind_id is not distinct from new.content_kind_id
       and original_route.created_at <= new.created_at
     for share
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_explicit_reroute_mismatch';
  end if;

  if new.reference_context_snapshot #>> '{kind}' = 'external_message'
     and not exists (
       select 1
         from public.inbox_v2_external_message_references reference_row
         join public.inbox_v2_source_occurrences occurrence_row
           on occurrence_row.tenant_id = reference_row.tenant_id
          and occurrence_row.id =
             new.reference_context_snapshot #>> '{sourceOccurrence,id}'
          and occurrence_row.external_thread_id = reference_row.external_thread_id
          and occurrence_row.resolution_state = 'resolved'
          and occurrence_row.resolved_external_message_reference_id =
             reference_row.id
         join public.inbox_v2_source_occurrence_resolution_transitions
           resolution_row
           on resolution_row.tenant_id = occurrence_row.tenant_id
          and resolution_row.source_occurrence_id = occurrence_row.id
          and resolution_row.resulting_revision = occurrence_row.revision
          and resolution_row.to_state = 'resolved'
          and resolution_row.resolved_external_message_reference_id =
             reference_row.id
        where reference_row.tenant_id = new.tenant_id
          and reference_row.id =
             new.reference_context_snapshot #>> '{externalMessageReference,id}'
          and reference_row.external_thread_id = new.external_thread_id
          and occurrence_row.source_thread_binding_id =
             new.reference_context_snapshot #>> '{originBinding,id}'
          and occurrence_row.source_account_id =
             new.reference_context_snapshot #>> '{originSourceAccount,id}'
          and occurrence_row.revision =
             (new.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceRevision}')::bigint
          and occurrence_row.binding_generation =
             (new.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceBindingGeneration}')::bigint
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorSchemaId}' =
             occurrence_row.descriptor_schema_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorVersion}' =
             occurrence_row.descriptor_version
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,capabilityRevision}' =
             occurrence_row.capability_revision::text
          and new.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorDigestSha256}' =
             occurrence_row.descriptor_digest_sha256
          and jsonb_array_length(new.reference_context_snapshot #>
             '{resolutionDecision,occurrenceDescriptor,providerReferences}') =
             occurrence_row.provider_reference_count
          and not exists (
            select 1
              from jsonb_array_elements(new.reference_context_snapshot #>
                '{resolutionDecision,occurrenceDescriptor,providerReferences}')
                with ordinality as supplied_reference(value, ordinal)
              left join public.inbox_v2_source_occurrence_provider_references
                stored_reference
                on stored_reference.tenant_id = occurrence_row.tenant_id
               and stored_reference.source_occurrence_id = occurrence_row.id
               and stored_reference.ordinal = supplied_reference.ordinal - 1
             where stored_reference.ordinal is null
                or supplied_reference.value is distinct from jsonb_build_object(
                  'kindId', stored_reference.kind_id,
                  'subject', stored_reference.subject
                )
          )
          and new.reference_context_snapshot #> '{portability}' =
             new.reference_context_snapshot #>
               '{resolutionDecision,portability}'
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,contractId}' = new.adapter_contract_id
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,contractVersion}' =
             new.adapter_contract_version
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,declarationRevision}' =
             new.adapter_declaration_revision::text
          and new.reference_context_snapshot #>>
             '{portability,adapterContract,surfaceId}' = new.adapter_surface_id
          and new.reference_context_snapshot #>> '{portability,kind}' =
             occurrence_row.reference_portability_kind::text
          and new.reference_context_snapshot #>>
             '{portability,decisionStrength}' =
             occurrence_row.reference_portability_decision_strength::text
          and occurrence_row.adapter_contract_id = new.adapter_contract_id
          and occurrence_row.adapter_contract_version =
             new.adapter_contract_version
          and occurrence_row.adapter_declaration_revision =
             new.adapter_declaration_revision
          and occurrence_row.adapter_surface_id = new.adapter_surface_id
          and occurrence_row.adapter_loaded_by_trusted_service_id =
             new.adapter_loaded_by_trusted_service_id
          and occurrence_row.adapter_loaded_at = new.adapter_loaded_at
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,state}' = 'available'
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,tenantId}' =
             new.tenant_id
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalThread}' =
             new.reference_context_snapshot #> '{externalThread}'
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalMessageReference}' =
             new.reference_context_snapshot #> '{externalMessageReference}'
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,sourceOccurrence}' =
             new.reference_context_snapshot #> '{sourceOccurrence}'
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceRevision}' =
             occurrence_row.revision::text
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceDescriptorDigestSha256}' =
             occurrence_row.descriptor_digest_sha256
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,adapterContract}' =
             new.adapter_contract_snapshot
          and new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedByTrustedServiceId}' =
             occurrence_row.adapter_loaded_by_trusted_service_id
          and new.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,diagnostic}' =
             'null'::jsonb
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedAt}')::timestamptz
             <= new.selected_at
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,notAfter}')::timestamptz
             >= new.selected_at
          and (
            new.reference_context_snapshot #>> '{portability,kind}' <>
              'binding_only'
            or (
              occurrence_row.source_thread_binding_id =
                new.source_thread_binding_id
              and occurrence_row.source_account_id = new.source_account_id
            )
          )
          and (
            new.selection_intent_kind <> 'explicit_occurrence'
            or new.selection_intent_snapshot #>> '{occurrence,id}' =
              occurrence_row.id
          )
          and new.reference_context_snapshot #>>
             '{resolutionDecision,externalThread,id}' =
             new.external_thread_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,externalMessageReference,id}' =
             reference_row.id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,sourceOccurrence,id}' =
             occurrence_row.id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,originBinding,id}' =
             occurrence_row.source_thread_binding_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,originSourceAccount,id}' =
             occurrence_row.source_account_id
          and new.reference_context_snapshot #>>
             '{resolutionDecision,loadedByTrustedServiceId}' =
             resolution_row.resolver_trusted_service_id
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,decidedAt}')::timestamptz <= new.selected_at
          and (new.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >= new.selected_at
          and new.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
          and (
            new.reference_context_snapshot #>>
              '{resolutionDecision,referenceWindow,state}' <> 'valid'
            or (new.reference_context_snapshot #>>
              '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
              new.selected_at
          )
        for share of reference_row, occurrence_row, resolution_row
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_reference_context_mismatch';
  end if;

  if (select count(*) from jsonb_object_keys(
        new.conversation_authorization_snapshot
      )) <> 12
     or (select count(*) from jsonb_object_keys(
        new.source_account_authorization_snapshot
      )) <> 12
     or exists (
       select 1
         from (values
           (new.conversation_authorization_snapshot),
           (new.source_account_authorization_snapshot)
         ) as decision(snapshot)
         cross join lateral jsonb_array_elements(
           decision.snapshot #> '{matchedPermissionIds}'
         ) as permission(value)
        group by decision.snapshot
       having count(*) <> count(distinct permission.value)
          or bool_or(
            jsonb_typeof(permission.value) <> 'string'
            or char_length(permission.value #>> '{}') > 256
            or not (
              (
                permission.value #>> '{}' ~
                  '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
                and char_length(split_part(
                  permission.value #>> '{}', ':', 2
                )) <= 160
              ) or (
                permission.value #>> '{}' ~
                  '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
                and char_length(split_part(
                  permission.value #>> '{}', ':', 2
                )) <= 80
                and char_length(split_part(
                  permission.value #>> '{}', ':', 3
                )) <= 160
                and split_part(permission.value #>> '{}', ':', 2) not in (
                  'core', 'hulee', 'module', 'platform', 'system'
                )
              )
            )
          )
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_route_authorization_snapshot_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_dispatch_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state <> 'queued'
     or new.attempt_count <> 0
     or new.active_attempt_id is not null
     or new.last_attempt_id is not null
     or new.retry_authorization_decision_id is not null
     or new.revision <> 1
     or new.created_at <> new.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_initial_state_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_dispatch_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if to_jsonb(old) - array[
       'state', 'attempt_count', 'active_attempt_id', 'last_attempt_id',
       'retry_authorization_decision_id', 'revision', 'updated_at'
     ] <> to_jsonb(new) - array[
       'state', 'attempt_count', 'active_attempt_id', 'last_attempt_id',
       'retry_authorization_decision_id', 'revision', 'updated_at'
     ]
     or new.revision <> old.revision + 1
     or new.attempt_count < old.attempt_count
     or new.updated_at < old.updated_at
     or old.state in ('accepted', 'terminal_failure', 'cancelled')
     or not (
       (old.state = 'queued' and
         new.state in ('attempting', 'cancelled', 'terminal_failure'))
       or (old.state = 'retryable_failure' and
         new.state in ('attempting', 'cancelled', 'terminal_failure'))
       or (old.state = 'attempting' and new.state in (
         'accepted', 'retryable_failure', 'terminal_failure',
         'outcome_unknown'
       ))
       or (old.state = 'outcome_unknown' and new.state in (
         'accepted', 'retryable_failure', 'terminal_failure'
       ))
     ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.outbound_dispatch_cas_conflict';
  end if;

  if old.state in ('queued', 'retryable_failure')
     and new.state = 'terminal_failure' then
    if new.attempt_count <> old.attempt_count
       or new.last_attempt_id is distinct from old.last_attempt_id
       or new.active_attempt_id is not null
       or new.retry_authorization_decision_id is not null then
      raise exception using errcode = '40001',
        message = 'inbox_v2.outbound_dispatch_route_failure_cas_conflict';
    end if;

    perform 1
      from public.inbox_v2_outbound_routes route_row
      join public.inbox_v2_source_thread_binding_heads binding_row
        on binding_row.tenant_id = route_row.tenant_id
       and binding_row.binding_id = route_row.source_thread_binding_id
     where route_row.tenant_id = new.tenant_id
       and route_row.id = new.route_id
       and binding_row.updated_at <= new.updated_at
       and (
         binding_row.remote_access_state <> 'active'
         or binding_row.administrative_state <> 'enabled'
         or binding_row.account_generation <> route_row.account_generation
         or binding_row.binding_generation <> route_row.binding_generation
         or binding_row.remote_access_revision <>
            route_row.remote_access_revision
         or binding_row.administrative_revision <>
            route_row.administrative_revision
         or binding_row.capability_revision <> route_row.capability_revision
         or binding_row.route_descriptor_revision <>
            route_row.route_descriptor_revision
       )
     for share of route_row, binding_row;

    if not found then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_route_failure_unproven';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_attempt_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.outcome_kind <> 'pending' or new.revision <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_attempt_initial_state_invalid';
  end if;

  perform 1
    from public.inbox_v2_outbound_dispatches dispatch_row
    join public.inbox_v2_outbound_routes route_row
      on route_row.tenant_id = dispatch_row.tenant_id
     and route_row.id = dispatch_row.route_id
    join public.inbox_v2_source_thread_binding_heads binding_row
      on binding_row.tenant_id = route_row.tenant_id
     and binding_row.binding_id = route_row.source_thread_binding_id
     and binding_row.account_generation = route_row.account_generation
     and binding_row.binding_generation = route_row.binding_generation
     and binding_row.remote_access_revision = route_row.remote_access_revision
     and binding_row.administrative_revision = route_row.administrative_revision
     and binding_row.capability_revision = route_row.capability_revision
     and binding_row.route_descriptor_revision = route_row.route_descriptor_revision
   where dispatch_row.tenant_id = new.tenant_id
     and dispatch_row.id = new.dispatch_id
     and dispatch_row.route_id = new.route_id
     and dispatch_row.message_id = new.message_id
     and route_row.id = new.route_id
     and dispatch_row.state in ('queued', 'retryable_failure')
     and ((new.attempt_number = 1 and dispatch_row.state = 'queued')
       or (new.attempt_number > 1 and
         dispatch_row.state = 'retryable_failure'))
     and dispatch_row.active_attempt_id is null
     and new.attempt_number = dispatch_row.attempt_count + 1
     and dispatch_row.updated_at <= new.opened_at
     and binding_row.remote_access_state = 'active'
     and binding_row.administrative_state = 'enabled'
     and binding_row.updated_at <= new.opened_at
     and route_row.adapter_contract_snapshot =
        new.retry_safety_adapter_contract_snapshot
     and route_row.adapter_loaded_by_trusted_service_id =
        new.retry_safety_declared_by_trusted_service_id
   for update of dispatch_row
   for share of route_row, binding_row;

  if not found then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.outbound_attempt_route_binding_changed';
  end if;

  if new.attempt_number > 1 then
    perform 1
      from public.inbox_v2_outbound_dispatch_attempts previous_attempt
      join public.inbox_v2_outbound_dispatches dispatch_row
        on dispatch_row.tenant_id = previous_attempt.tenant_id
       and dispatch_row.id = previous_attempt.dispatch_id
       and dispatch_row.route_id = previous_attempt.route_id
       and dispatch_row.message_id = previous_attempt.message_id
     where previous_attempt.tenant_id = new.tenant_id
       and previous_attempt.dispatch_id = new.dispatch_id
       and previous_attempt.route_id = new.route_id
       and previous_attempt.message_id = new.message_id
       and previous_attempt.attempt_number = new.attempt_number - 1
       and (
         (
           previous_attempt.outcome_kind = 'retryable_failure'
           and previous_attempt.retry_at <= new.opened_at
           and dispatch_row.retry_authorization_decision_id is null
         ) or (
           previous_attempt.outcome_kind = 'outcome_unknown'
           and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_reconciliation_decisions
                 decision_row
              where decision_row.tenant_id = previous_attempt.tenant_id
                and decision_row.id =
                   dispatch_row.retry_authorization_decision_id
                and decision_row.unknown_attempt_id = previous_attempt.id
                and decision_row.result_state = 'retryable_failure'
                and decision_row.retry_at <= new.opened_at
                and decision_row.decided_at <= new.opened_at
           )
         )
       )
     for share of previous_attempt;

    if not found then
      raise exception using errcode = '40001',
        message = 'inbox_v2.outbound_attempt_retry_boundary_conflict';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_attempt_guard_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.outcome_kind <> 'pending'
     or to_jsonb(old) - array[
       'outcome_kind', 'completion_source', 'completed_at', 'retry_at',
       'provider_acknowledgement_token', 'diagnostic_code_id',
       'diagnostic_retryable', 'diagnostic_correlation_token',
       'diagnostic_safe_operator_hint_id', 'unknown_required_action', 'revision'
     ] <> to_jsonb(new) - array[
       'outcome_kind', 'completion_source', 'completed_at', 'retry_at',
       'provider_acknowledgement_token', 'diagnostic_code_id',
       'diagnostic_retryable', 'diagnostic_correlation_token',
       'diagnostic_safe_operator_hint_id', 'unknown_required_action', 'revision'
     ]
     or new.outcome_kind = 'pending'
     or new.revision <> 2 then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.outbound_attempt_completion_cas_conflict';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_outbound_dispatch_head(
  checked_tenant_id text,
  checked_dispatch_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  dispatch_row public.inbox_v2_outbound_dispatches%rowtype;
  last_attempt_row public.inbox_v2_outbound_dispatch_attempts%rowtype;
  actual_attempt_count bigint;
  maximum_attempt_number integer;
begin
  select * into dispatch_row
    from public.inbox_v2_outbound_dispatches candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_dispatch_id;
  if not found then
    return;
  end if;

  select count(*), max(attempt_row.attempt_number)
    into actual_attempt_count, maximum_attempt_number
    from public.inbox_v2_outbound_dispatch_attempts attempt_row
   where attempt_row.tenant_id = checked_tenant_id
     and attempt_row.dispatch_id = checked_dispatch_id;

  if actual_attempt_count <> dispatch_row.attempt_count
     or (actual_attempt_count = 0 and maximum_attempt_number is not null)
     or (actual_attempt_count > 0 and
       maximum_attempt_number <> dispatch_row.attempt_count) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_attempt_set_invalid';
  end if;

  if dispatch_row.attempt_count = 0 then
    if dispatch_row.last_attempt_id is not null
       or dispatch_row.state in ('attempting', 'accepted', 'outcome_unknown') then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_zero_attempt_head_invalid';
    end if;
    if dispatch_row.state = 'terminal_failure' and not exists (
      select 1
        from public.inbox_v2_outbound_routes route_row
        join public.inbox_v2_source_thread_binding_heads binding_row
          on binding_row.tenant_id = route_row.tenant_id
         and binding_row.binding_id = route_row.source_thread_binding_id
       where route_row.tenant_id = checked_tenant_id
         and route_row.id = dispatch_row.route_id
         and binding_row.updated_at <= dispatch_row.updated_at
         and (
           binding_row.remote_access_state <> 'active'
           or binding_row.administrative_state <> 'enabled'
           or binding_row.account_generation <> route_row.account_generation
           or binding_row.binding_generation <> route_row.binding_generation
           or binding_row.remote_access_revision <>
              route_row.remote_access_revision
           or binding_row.administrative_revision <>
              route_row.administrative_revision
           or binding_row.capability_revision <> route_row.capability_revision
           or binding_row.route_descriptor_revision <>
              route_row.route_descriptor_revision
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_zero_attempt_route_failure_unproven';
    end if;
  else
    select * into last_attempt_row
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = checked_tenant_id
       and attempt_row.id = dispatch_row.last_attempt_id
       and attempt_row.dispatch_id = checked_dispatch_id
       and attempt_row.route_id = dispatch_row.route_id
       and attempt_row.message_id = dispatch_row.message_id;

    if not found or last_attempt_row.attempt_number <> dispatch_row.attempt_count then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_last_attempt_invalid';
    end if;

    if (dispatch_row.state = 'attempting' and last_attempt_row.outcome_kind <> 'pending')
       or (dispatch_row.state = 'accepted' and not (
         last_attempt_row.outcome_kind = 'accepted'
         or (
           last_attempt_row.outcome_kind = 'outcome_unknown'
           and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_reconciliation_decisions decision_row
              where decision_row.tenant_id = checked_tenant_id
                and decision_row.unknown_attempt_id = last_attempt_row.id
                and decision_row.result_state = 'accepted'
           )
         )
       ))
       or (dispatch_row.state = 'retryable_failure' and not (
         (
           last_attempt_row.outcome_kind = 'retryable_failure'
           and dispatch_row.retry_authorization_decision_id is null
         )
         or (
           last_attempt_row.outcome_kind = 'outcome_unknown'
           and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_reconciliation_decisions decision_row
              where decision_row.tenant_id = checked_tenant_id
                and decision_row.id = dispatch_row.retry_authorization_decision_id
                and decision_row.unknown_attempt_id = last_attempt_row.id
                and decision_row.result_state = 'retryable_failure'
           )
         )
       ))
       or (dispatch_row.state = 'terminal_failure' and not (
         last_attempt_row.outcome_kind = 'terminal_failure'
         or (
           last_attempt_row.outcome_kind = 'outcome_unknown'
           and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_reconciliation_decisions decision_row
              where decision_row.tenant_id = checked_tenant_id
                and decision_row.unknown_attempt_id = last_attempt_row.id
                and decision_row.result_state = 'terminal_failure'
           )
         )
         or exists (
           select 1
             from public.inbox_v2_outbound_routes route_row
             join public.inbox_v2_source_thread_binding_heads binding_row
               on binding_row.tenant_id = route_row.tenant_id
              and binding_row.binding_id = route_row.source_thread_binding_id
            where route_row.tenant_id = checked_tenant_id
              and route_row.id = dispatch_row.route_id
              and binding_row.updated_at <= dispatch_row.updated_at
              and (
                binding_row.remote_access_state <> 'active'
                or binding_row.administrative_state <> 'enabled'
                or binding_row.account_generation <>
                   route_row.account_generation
                or binding_row.binding_generation <>
                   route_row.binding_generation
                or binding_row.remote_access_revision <>
                   route_row.remote_access_revision
                or binding_row.administrative_revision <>
                   route_row.administrative_revision
                or binding_row.capability_revision <>
                   route_row.capability_revision
                or binding_row.route_descriptor_revision <>
                   route_row.route_descriptor_revision
              )
         )
       ))
       or (dispatch_row.state = 'outcome_unknown' and (
         last_attempt_row.outcome_kind <> 'outcome_unknown'
         or exists (
           select 1
             from public.inbox_v2_outbound_dispatch_reconciliation_decisions decision_row
            where decision_row.tenant_id = checked_tenant_id
              and decision_row.unknown_attempt_id = last_attempt_row.id
         )
       ))
       or (dispatch_row.state = 'cancelled'
         and last_attempt_row.outcome_kind = 'pending') then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_state_attempt_mismatch';
    end if;

    if (dispatch_row.state = 'attempting' and
         dispatch_row.updated_at <> last_attempt_row.opened_at)
       or (dispatch_row.state = 'outcome_unknown' and
         dispatch_row.updated_at <> last_attempt_row.completed_at)
       or (dispatch_row.state = 'accepted' and
         last_attempt_row.outcome_kind = 'accepted' and
         dispatch_row.updated_at <> last_attempt_row.completed_at)
       or (dispatch_row.state = 'retryable_failure' and
         last_attempt_row.outcome_kind = 'retryable_failure' and
         dispatch_row.updated_at <> last_attempt_row.completed_at)
       or (dispatch_row.state = 'terminal_failure' and
         last_attempt_row.outcome_kind = 'terminal_failure' and
         dispatch_row.updated_at <> last_attempt_row.completed_at)
       or (
         last_attempt_row.outcome_kind = 'outcome_unknown'
         and dispatch_row.state in (
           'accepted', 'retryable_failure', 'terminal_failure'
         )
         and exists (
           select 1
             from public.inbox_v2_outbound_dispatch_reconciliation_decisions
               decision_row
            where decision_row.tenant_id = checked_tenant_id
              and decision_row.unknown_attempt_id = last_attempt_row.id
              and decision_row.result_state::text = dispatch_row.state::text
         )
         and not exists (
           select 1
             from public.inbox_v2_outbound_dispatch_reconciliation_decisions
               decision_row
            where decision_row.tenant_id = checked_tenant_id
              and decision_row.unknown_attempt_id = last_attempt_row.id
              and decision_row.result_state::text = dispatch_row.state::text
              and decision_row.decided_at = dispatch_row.updated_at
         )
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_dispatch_transition_time_invalid';
    end if;
  end if;

  if dispatch_row.state = 'attempting' and not exists (
    select 1 from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = checked_tenant_id
       and attempt_row.id = dispatch_row.active_attempt_id
       and attempt_row.dispatch_id = checked_dispatch_id
       and attempt_row.outcome_kind = 'pending'
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_active_attempt_invalid';
  end if;

  if dispatch_row.retry_authorization_decision_id is not null and not exists (
    select 1
      from public.inbox_v2_outbound_dispatch_reconciliation_decisions decision_row
     where decision_row.tenant_id = checked_tenant_id
       and decision_row.id = dispatch_row.retry_authorization_decision_id
       and decision_row.dispatch_id = checked_dispatch_id
       and decision_row.result_state = 'retryable_failure'
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_retry_decision_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_outbound_dispatch_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_table_name = 'inbox_v2_outbound_dispatch_attempts'
     and tg_op = 'INSERT'
     and exists (
       select 1 from public.tenants tenant_row
        where tenant_row.id = new_row->>'tenant_id'
     )
     and not exists (
       select 1
         from public.inbox_v2_outbound_dispatch_attempts attempt_row
        where attempt_row.tenant_id = new_row->>'tenant_id'
          and attempt_row.id = new_row->>'id'
          and attempt_row.outcome_kind = 'pending'
          and attempt_row.revision = 1
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_attempt_pre_io_commit_required';
  end if;

  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_outbound_dispatch_head(
      old_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_outbound_dispatches'
        then old_row->>'id' else old_row->>'dispatch_id' end
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_outbound_dispatch_head(
      new_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_outbound_dispatches'
        then new_row->>'id' else new_row->>'dispatch_id' end
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_thread_route_policy_guard_version_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  current_head public.inbox_v2_thread_route_policy_heads%rowtype;
  first_version public.inbox_v2_thread_route_policy_versions%rowtype;
begin
  select * into current_head
    from public.inbox_v2_thread_route_policy_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.policy_id = new.policy_id
   for update;

  if current_head.policy_id is null then
    if (new.revision = 1 and new.created_at <> new.updated_at) or exists (
      select 1
        from public.inbox_v2_thread_route_policy_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.policy_id = new.policy_id
    ) then
      raise exception using errcode = '40001',
        message = 'inbox_v2.thread_route_policy_initial_revision_conflict';
    end if;
    return new;
  end if;

  select * into first_version
    from public.inbox_v2_thread_route_policy_versions version_row
   where version_row.tenant_id = new.tenant_id
     and version_row.policy_id = new.policy_id
   order by version_row.revision
   limit 1
   for share;

  if current_head.policy_id is null
     or first_version.policy_id is null
     or current_head.revision + 1 <> new.revision
     or current_head.conversation_id <> new.conversation_id
     or current_head.external_thread_id <> new.external_thread_id
     or current_head.operation_id <> new.operation_id
     or current_head.content_kind_id is distinct from new.content_kind_id
     or current_head.updated_at > new.updated_at
     or first_version.created_at <> new.created_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.thread_route_policy_version_cas_conflict';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_thread_route_policy_guard_head_write()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if exists (
      select 1
        from public.inbox_v2_thread_route_policy_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.policy_id = new.policy_id
         and version_row.revision <> new.revision
    ) then
      raise exception using errcode = '40001',
        message = 'inbox_v2.thread_route_policy_head_initial_revision_conflict';
    end if;
  elsif to_jsonb(old) - array['revision', 'updated_at'] <>
        to_jsonb(new) - array['revision', 'updated_at']
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.thread_route_policy_head_cas_conflict';
  end if;

  perform 1
    from public.inbox_v2_thread_route_policy_versions version_row
   where version_row.tenant_id = new.tenant_id
     and version_row.policy_id = new.policy_id
     and version_row.revision = new.revision
     and version_row.conversation_id = new.conversation_id
     and version_row.external_thread_id = new.external_thread_id
     and version_row.operation_id = new.operation_id
     and version_row.content_kind_id is not distinct from new.content_kind_id
     and version_row.updated_at = new.updated_at
   for share;
  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.thread_route_policy_head_version_mismatch';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_thread_route_policy_head(
  checked_tenant_id text,
  checked_policy_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  maximum_revision bigint;
  current_revision bigint;
begin
  select max(version_row.revision)
    into maximum_revision
    from public.inbox_v2_thread_route_policy_versions version_row
   where version_row.tenant_id = checked_tenant_id
     and version_row.policy_id = checked_policy_id;

  if maximum_revision is null then
    return;
  end if;

  select head_row.revision
    into current_revision
    from public.inbox_v2_thread_route_policy_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.policy_id = checked_policy_id;

  if not found or current_revision <> maximum_revision then
    raise exception using errcode = '23514',
      message = 'inbox_v2.thread_route_policy_current_head_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_thread_route_policy_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_thread_route_policy_head(
      old_row->>'tenant_id', old_row->>'policy_id'
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_thread_route_policy_head(
      new_row->>'tenant_id', new_row->>'policy_id'
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_assert_thread_route_policy_fallbacks(
  checked_tenant_id text,
  checked_policy_id text,
  checked_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  policy_row public.inbox_v2_thread_route_policy_versions%rowtype;
  actual_count bigint;
  minimum_ordinal smallint;
  maximum_ordinal smallint;
  actual_digest text;
  all_same_thread boolean;
begin
  select * into policy_row
    from public.inbox_v2_thread_route_policy_versions candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.policy_id = checked_policy_id
     and candidate_row.revision = checked_revision;
  if not found then
    return;
  end if;

  select
    count(*),
    min(fallback_row.ordinal),
    max(fallback_row.ordinal),
    case when count(*) = 0 then null else encode(
      sha256(convert_to(string_agg(
        fallback_row.ordinal::text || ':' ||
        octet_length(fallback_row.binding_id)::text || ':' ||
        fallback_row.binding_id,
        '|' order by fallback_row.ordinal
      ), 'UTF8')),
      'hex'
    ) end,
    coalesce(bool_and(
      fallback_row.external_thread_id = policy_row.external_thread_id
    ), true)
  into actual_count, minimum_ordinal, maximum_ordinal, actual_digest,
    all_same_thread
  from public.inbox_v2_thread_route_policy_fallback_bindings fallback_row
  where fallback_row.tenant_id = checked_tenant_id
    and fallback_row.policy_id = checked_policy_id
    and fallback_row.policy_revision = checked_revision;

  if actual_count <> policy_row.fallback_binding_count
     or (actual_count = 0 and (
       minimum_ordinal is not null or maximum_ordinal is not null
       or actual_digest is not null
     ))
     or (actual_count > 0 and (
       minimum_ordinal <> 0 or maximum_ordinal <> actual_count - 1
       or actual_digest <> policy_row.fallback_bindings_digest_sha256
     ))
     or not all_same_thread
     or exists (
       select 1
         from public.inbox_v2_thread_route_policy_fallback_bindings fallback_row
        where fallback_row.tenant_id = checked_tenant_id
          and fallback_row.policy_id = checked_policy_id
          and fallback_row.policy_revision = checked_revision
          and fallback_row.binding_id = policy_row.preferred_binding_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.thread_route_policy_fallbacks_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_thread_route_policy_deferred_fallbacks()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_thread_route_policy_fallbacks(
      old_row->>'tenant_id', old_row->>'policy_id',
      coalesce(old_row->>'revision', old_row->>'policy_revision')::bigint
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_thread_route_policy_fallbacks(
      new_row->>'tenant_id', new_row->>'policy_id',
      coalesce(new_row->>'revision', new_row->>'policy_revision')::bigint
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_assert_outbound_multi_send_children(
  checked_tenant_id text,
  checked_operation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  operation_row public.inbox_v2_outbound_multi_send_operations%rowtype;
  actual_count bigint;
  minimum_ordinal smallint;
  maximum_ordinal smallint;
  actual_digest text;
  all_dispatches_linked boolean;
begin
  select * into operation_row
    from public.inbox_v2_outbound_multi_send_operations candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_operation_id;
  if not found then
    return;
  end if;

  select
    count(*),
    min(child_row.ordinal),
    max(child_row.ordinal),
    case when count(*) = 0 then null else encode(
      sha256(convert_to(string_agg(
        child_row.ordinal::text || ':' ||
        octet_length(child_row.conversation_id)::text || ':' ||
        child_row.conversation_id || ':' ||
        octet_length(child_row.external_thread_id)::text || ':' ||
        child_row.external_thread_id || ':' ||
        octet_length(child_row.binding_id)::text || ':' || child_row.binding_id || ':' ||
        octet_length(child_row.source_account_id)::text || ':' ||
        child_row.source_account_id || ':' ||
        octet_length(child_row.route_id)::text || ':' || child_row.route_id || ':' ||
        octet_length(child_row.dispatch_id)::text || ':' || child_row.dispatch_id,
        '|' order by child_row.ordinal
      ), 'UTF8')),
      'hex'
    ) end,
    coalesce(bool_and(
      dispatch_row.multi_send_operation_id = checked_operation_id
    ), true)
  into actual_count, minimum_ordinal, maximum_ordinal, actual_digest,
    all_dispatches_linked
  from public.inbox_v2_outbound_multi_send_children child_row
  join public.inbox_v2_outbound_dispatches dispatch_row
    on dispatch_row.tenant_id = child_row.tenant_id
   and dispatch_row.id = child_row.dispatch_id
   and dispatch_row.route_id = child_row.route_id
   and dispatch_row.message_id = child_row.message_id
  where child_row.tenant_id = checked_tenant_id
    and child_row.operation_id = checked_operation_id;

  if actual_count <> operation_row.child_count
     or minimum_ordinal <> 0
     or maximum_ordinal <> actual_count - 1
     or actual_digest <> operation_row.children_digest_sha256
     or not all_dispatches_linked
     or exists (
       select 1
         from public.inbox_v2_outbound_dispatches dispatch_row
        where dispatch_row.tenant_id = checked_tenant_id
          and dispatch_row.multi_send_operation_id = checked_operation_id
          and not exists (
            select 1
              from public.inbox_v2_outbound_multi_send_children child_row
             where child_row.tenant_id = dispatch_row.tenant_id
               and child_row.operation_id = checked_operation_id
               and child_row.dispatch_id = dispatch_row.id
               and child_row.route_id = dispatch_row.route_id
               and child_row.message_id = dispatch_row.message_id
          )
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_multi_send_children_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_outbound_multi_send_deferred_children()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_outbound_multi_send_children(
      old_row->>'tenant_id', coalesce(
        old_row->>'multi_send_operation_id',
        old_row->>'id',
        old_row->>'operation_id'
      )
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_outbound_multi_send_children(
      new_row->>'tenant_id', coalesce(
        new_row->>'multi_send_operation_id',
        new_row->>'id',
        new_row->>'operation_id'
      )
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_assert_outbound_reconciliation(
  checked_tenant_id text,
  checked_decision_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  decision_row public.inbox_v2_outbound_dispatch_reconciliation_decisions%rowtype;
  attempt_row public.inbox_v2_outbound_dispatch_attempts%rowtype;
  route_row public.inbox_v2_outbound_routes%rowtype;
  actual_count bigint;
  minimum_ordinal smallint;
  maximum_ordinal smallint;
  actual_digest text;
  snapshot_permission_count bigint;
  snapshot_permissions_digest text;
begin
  select * into decision_row
    from public.inbox_v2_outbound_dispatch_reconciliation_decisions candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_decision_id;
  if not found then
    return;
  end if;

  select * into attempt_row
    from public.inbox_v2_outbound_dispatch_attempts candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = decision_row.unknown_attempt_id
     and candidate_row.dispatch_id = decision_row.dispatch_id
     and candidate_row.route_id = decision_row.route_id
     and candidate_row.message_id = decision_row.message_id
     and candidate_row.outcome_kind = 'outcome_unknown'
     and candidate_row.revision = 2;
  select * into route_row
    from public.inbox_v2_outbound_routes candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = decision_row.route_id;

  if attempt_row.id is null
     or route_row.id is null
     or decision_row.decided_at < attempt_row.completed_at
     or attempt_row.retry_safety_declared_by_trusted_service_id <>
        route_row.adapter_loaded_by_trusted_service_id
     or (
       decision_row.result_state in ('accepted', 'terminal_failure')
       and (
         decision_row.decided_by_kind <> 'trusted_service'
         or decision_row.decided_by_trusted_service_id <>
            attempt_row.retry_safety_declared_by_trusted_service_id
         or decision_row.authorization_epoch is not null
       )
     )
     or (
       decision_row.retry_authorization_kind = 'automatic'
       and (
         not attempt_row.automatic_retry_allowed
         or decision_row.decided_by_kind <> 'trusted_service'
         or decision_row.decided_by_trusted_service_id <>
            attempt_row.retry_safety_declared_by_trusted_service_id
       )
     )
     or (
       not attempt_row.automatic_retry_allowed
       and decision_row.result_state = 'retryable_failure'
       and decision_row.retry_authorization_kind <>
          'employee_duplicate_risk_override'
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_reconciliation_authority_invalid';
  end if;

  select
    count(*),
    min(permission_row.ordinal),
    max(permission_row.ordinal),
    case when count(*) = 0 then null else encode(
      sha256(convert_to(string_agg(
        permission_row.ordinal::text || ':' ||
        octet_length(permission_row.permission_id)::text || ':' ||
        permission_row.permission_id,
        '|' order by permission_row.ordinal
      ), 'UTF8')),
      'hex'
    ) end
  into actual_count, minimum_ordinal, maximum_ordinal, actual_digest
  from public.inbox_v2_outbound_dispatch_reconciliation_permissions permission_row
  where permission_row.tenant_id = checked_tenant_id
    and permission_row.decision_id = checked_decision_id;

  if actual_count <> decision_row.matched_permission_count
     or (actual_count = 0 and (
       minimum_ordinal is not null or maximum_ordinal is not null
       or actual_digest is not null
     ))
     or (actual_count > 0 and (
       minimum_ordinal <> 0 or maximum_ordinal <> actual_count - 1
       or actual_digest <> decision_row.matched_permissions_digest_sha256
     ))
     or (
       decision_row.retry_authorization_kind =
          'employee_duplicate_risk_override'
       and not exists (
         select 1
           from public.inbox_v2_outbound_dispatch_reconciliation_permissions permission_row
          where permission_row.tenant_id = checked_tenant_id
            and permission_row.decision_id = checked_decision_id
            and permission_row.permission_id =
               'core:outbound_dispatch.duplicate-risk-retry'
       )
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_reconciliation_permissions_invalid';
  end if;

  if decision_row.retry_authorization_kind =
       'employee_duplicate_risk_override' then
    select
      count(*),
      encode(sha256(convert_to(string_agg(
        (permission.ordinality - 1)::text || ':' ||
        octet_length(permission.permission_id)::text || ':' ||
        permission.permission_id,
        '|' order by permission.ordinality
      ), 'UTF8')), 'hex')
    into snapshot_permission_count, snapshot_permissions_digest
    from jsonb_array_elements_text(
      decision_row.operator_authorization_snapshot #> '{matchedPermissionIds}'
    ) with ordinality as permission(permission_id, ordinality);

    if snapshot_permission_count <> actual_count
       or snapshot_permissions_digest <>
          decision_row.matched_permissions_digest_sha256 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_reconciliation_authorization_snapshot_invalid';
    end if;
  end if;
end;
$function$;

create or replace function public.inbox_v2_outbound_reconciliation_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_outbound_reconciliation(
      old_row->>'tenant_id', coalesce(old_row->>'id', old_row->>'decision_id')
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_outbound_reconciliation(
      new_row->>'tenant_id', coalesce(new_row->>'id', new_row->>'decision_id')
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_occurrence_resolution_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
begin
  select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
   where candidate_row.tenant_id = new.tenant_id
     and candidate_row.id = new.source_occurrence_id
   for update;

  if not found
     or occurrence_row.revision <> new.expected_revision
     or occurrence_row.resolution_state <> new.from_state
     or occurrence_row.resolution_state = 'resolved'
     or occurrence_row.adapter_loaded_by_trusted_service_id <>
        new.resolver_trusted_service_id
     or occurrence_row.updated_at > new.changed_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.source_occurrence_resolution_transition_cas_conflict';
  end if;

  if new.to_state = 'resolved' and not exists (
    select 1
      from public.inbox_v2_external_message_references reference_row
     where reference_row.tenant_id = new.tenant_id
       and reference_row.id = new.resolved_external_message_reference_id
       and reference_row.realm_id = occurrence_row.message_realm_id
       and reference_row.realm_version = occurrence_row.message_realm_version
       and reference_row.canonicalization_version =
          occurrence_row.message_canonicalization_version
       and reference_row.scope_kind::text =
          occurrence_row.message_scope_kind::text
       and reference_row.scope_source_account_id is not distinct from
          occurrence_row.message_scope_source_account_id
       and reference_row.scope_source_thread_binding_id is not distinct from
          occurrence_row.message_scope_source_thread_binding_id
       and reference_row.object_kind_id = occurrence_row.message_object_kind_id
       and reference_row.external_thread_id = occurrence_row.external_thread_id
       and reference_row.canonical_external_subject =
          occurrence_row.canonical_external_subject
       and reference_row.message_key_digest_sha256 =
          occurrence_row.message_key_digest_sha256
     for share
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_occurrence_resolved_reference_key_mismatch';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_source_occurrence_resolution(
  checked_tenant_id text,
  checked_source_occurrence_id text,
  checked_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
  transition_row public.inbox_v2_source_occurrence_resolution_transitions%rowtype;
  actual_count bigint;
  minimum_ordinal smallint;
  maximum_ordinal smallint;
  actual_digest text;
begin
  select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_source_occurrence_id;
  if not found then
    return;
  end if;

  select * into transition_row
    from public.inbox_v2_source_occurrence_resolution_transitions candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.source_occurrence_id = checked_source_occurrence_id
     and candidate_row.resulting_revision = checked_revision;

  if not found
     or occurrence_row.revision <> checked_revision
     or occurrence_row.resolution_state <> transition_row.to_state
     or occurrence_row.resolved_external_message_reference_id is distinct from
        transition_row.resolved_external_message_reference_id
     or occurrence_row.resolution_candidate_count <>
        transition_row.candidate_count
     or occurrence_row.resolution_candidate_digest_sha256 is distinct from
        transition_row.candidates_digest_sha256
     or occurrence_row.resolution_diagnostic_code_id is distinct from
        transition_row.diagnostic_code_id
     or occurrence_row.resolution_diagnostic_retryable is distinct from
        transition_row.diagnostic_retryable
     or occurrence_row.resolution_diagnostic_correlation_token is distinct from
        transition_row.diagnostic_correlation_token
     or occurrence_row.resolution_diagnostic_safe_operator_hint_id is distinct from
        transition_row.diagnostic_safe_operator_hint_id
     or occurrence_row.updated_at <> transition_row.changed_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_occurrence_resolution_head_mismatch';
  end if;

  select
    count(*),
    min(candidate_row.ordinal),
    max(candidate_row.ordinal),
    case when count(*) = 0 then null else encode(
      sha256(convert_to(string_agg(
        candidate_row.ordinal::text || ':' ||
        octet_length(candidate_row.external_message_reference_id)::text || ':' ||
        candidate_row.external_message_reference_id,
        '|' order by candidate_row.ordinal
      ), 'UTF8')),
      'hex'
    ) end
  into actual_count, minimum_ordinal, maximum_ordinal, actual_digest
  from public.inbox_v2_source_occurrence_resolution_candidates candidate_row
  where candidate_row.tenant_id = checked_tenant_id
    and candidate_row.transition_id = transition_row.id
    and candidate_row.source_occurrence_id = checked_source_occurrence_id
    and candidate_row.resulting_revision = checked_revision;

  if actual_count <> transition_row.candidate_count
     or (actual_count = 0 and (
       minimum_ordinal is not null or maximum_ordinal is not null
       or actual_digest is not null
     ))
     or (actual_count > 0 and (
       minimum_ordinal <> 0 or maximum_ordinal <> actual_count - 1
       or actual_digest <> transition_row.candidates_digest_sha256
     )) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_occurrence_resolution_candidates_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_source_occurrence_resolution_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT'
     and tg_table_name <> 'inbox_v2_source_occurrences' then
    perform public.inbox_v2_assert_source_occurrence_resolution(
      old_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_source_occurrences'
        then old_row->>'id' else old_row->>'source_occurrence_id' end,
      case when tg_table_name = 'inbox_v2_source_occurrences'
        then (old_row->>'revision')::bigint
        else (old_row->>'resulting_revision')::bigint end
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_source_occurrence_resolution(
      new_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_source_occurrences'
        then new_row->>'id' else new_row->>'source_occurrence_id' end,
      case when tg_table_name = 'inbox_v2_source_occurrences'
        then (new_row->>'revision')::bigint
        else (new_row->>'resulting_revision')::bigint end
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_outbound_correlation_anchor_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_outbound_dispatch_attempts attempt_row
    join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = attempt_row.tenant_id
     and dispatch_row.id = attempt_row.dispatch_id
     and dispatch_row.route_id = attempt_row.route_id
     and dispatch_row.message_id = attempt_row.message_id
    join public.inbox_v2_outbound_routes route_row
      on route_row.tenant_id = attempt_row.tenant_id
     and route_row.id = attempt_row.route_id
   where attempt_row.tenant_id = new.tenant_id
     and attempt_row.id = new.first_attempt_id
     and attempt_row.dispatch_id = new.dispatch_id
     and attempt_row.route_id = new.route_id
     and attempt_row.message_id = new.message_id
     and attempt_row.attempt_number = 1
     and attempt_row.retry_safety_mechanism = new.retry_safety_mechanism
     and attempt_row.retry_safety_mechanism <> 'unsafe_or_unknown'
     and attempt_row.provider_correlation_token = new.correlation_token
     and attempt_row.retry_safety_declared_by_trusted_service_id =
       new.declared_by_trusted_service_id
     and attempt_row.retry_safety_adapter_contract_snapshot #>>
       '{contractId}' = new.adapter_contract_id
     and attempt_row.retry_safety_adapter_contract_snapshot #>>
       '{contractVersion}' = new.adapter_contract_version
     and attempt_row.retry_safety_adapter_contract_snapshot #>>
       '{declarationRevision}' = new.adapter_declaration_revision::text
     and attempt_row.retry_safety_adapter_contract_snapshot #>>
       '{surfaceId}' = new.adapter_surface_id
     and route_row.external_thread_id = new.external_thread_id
     and route_row.source_connection_id = new.source_connection_id
     and route_row.source_account_id = new.source_account_id
     and route_row.source_thread_binding_id = new.source_thread_binding_id
     and route_row.binding_generation = new.binding_generation
     and route_row.adapter_contract_id = new.adapter_contract_id
     and route_row.adapter_contract_version = new.adapter_contract_version
     and route_row.adapter_declaration_revision =
       new.adapter_declaration_revision
     and route_row.adapter_surface_id = new.adapter_surface_id
     and route_row.adapter_loaded_by_trusted_service_id =
       new.declared_by_trusted_service_id
     and new.created_at = attempt_row.opened_at
   for share of attempt_row, dispatch_row, route_row;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_correlation_anchor_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_provider_transport_lineage(
  checked_observation_detail jsonb,
  checked_dispatch public.inbox_v2_outbound_dispatches,
  checked_attempt public.inbox_v2_outbound_dispatch_attempts
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  observation_dispatch jsonb := checked_observation_detail #> '{dispatch}';
  observation_attempt jsonb := checked_observation_detail #> '{attempt}';
  observation_outcome jsonb := checked_observation_detail #> '{attempt,outcome}';
  stable_projection_matches boolean := false;
  current_attempt_projection_matches boolean := false;
  current_dispatch_projection_matches boolean := false;
  observation_is_pending_head boolean := false;
  observation_is_unknown_head boolean := false;
begin
  stable_projection_matches := (
    observation_dispatch ?& array[
      'tenantId', 'id', 'message', 'route', 'multiSendOperation', 'state',
      'attemptCount', 'activeAttempt', 'lastAttempt', 'retryAuthorization',
      'revision', 'createdAt', 'updatedAt'
    ]
    and observation_dispatch - array[
      'tenantId', 'id', 'message', 'route', 'multiSendOperation', 'state',
      'attemptCount', 'activeAttempt', 'lastAttempt', 'retryAuthorization',
      'revision', 'createdAt', 'updatedAt'
    ] = '{}'::jsonb
    and observation_attempt ?& array[
      'tenantId', 'id', 'dispatch', 'route', 'attemptNumber', 'claimToken',
      'retrySafety', 'leaseExpiresAt', 'openedAt', 'outcome',
      'completionSource', 'revision'
    ]
    and observation_attempt - array[
      'tenantId', 'id', 'dispatch', 'route', 'attemptNumber', 'claimToken',
      'retrySafety', 'leaseExpiresAt', 'openedAt', 'outcome',
      'completionSource', 'revision'
    ] = '{}'::jsonb
    and (observation_attempt #> '{retrySafety}') ?& array[
      'adapterContract', 'declaredByTrustedServiceId', 'declarationToken',
      'declaredAt', 'mechanism', 'providerCorrelationToken',
      'automaticRetryAllowed'
    ]
    and (observation_attempt #> '{retrySafety}') - array[
      'adapterContract', 'declaredByTrustedServiceId', 'declarationToken',
      'declaredAt', 'mechanism', 'providerCorrelationToken',
      'automaticRetryAllowed'
    ] = '{}'::jsonb
    and observation_dispatch #>> '{tenantId}' = checked_dispatch.tenant_id
    and observation_dispatch #>> '{id}' = checked_dispatch.id
    and observation_dispatch #> '{message}' = jsonb_build_object(
      'tenantId', checked_dispatch.tenant_id,
      'kind', 'message',
      'id', checked_dispatch.message_id
    )
    and observation_dispatch #> '{route}' = jsonb_build_object(
      'tenantId', checked_dispatch.tenant_id,
      'kind', 'outbound_route',
      'id', checked_dispatch.route_id
    )
    and observation_dispatch #> '{multiSendOperation}' = case
      when checked_dispatch.multi_send_operation_id is null then 'null'::jsonb
      else jsonb_build_object(
        'tenantId', checked_dispatch.tenant_id,
        'kind', 'outbound_multi_send_operation',
        'id', checked_dispatch.multi_send_operation_id
      )
    end
    and (observation_dispatch #>> '{createdAt}')::timestamptz =
      checked_dispatch.created_at
    and observation_attempt #>> '{tenantId}' = checked_attempt.tenant_id
    and observation_attempt #>> '{id}' = checked_attempt.id
    and observation_attempt #> '{dispatch}' = jsonb_build_object(
      'tenantId', checked_attempt.tenant_id,
      'kind', 'outbound_dispatch',
      'id', checked_attempt.dispatch_id
    )
    and observation_attempt #> '{route}' = jsonb_build_object(
      'tenantId', checked_attempt.tenant_id,
      'kind', 'outbound_route',
      'id', checked_attempt.route_id
    )
    and (observation_attempt #>> '{attemptNumber}')::integer =
      checked_attempt.attempt_number
    and observation_attempt #>> '{claimToken}' = checked_attempt.claim_token
    and observation_attempt #> '{retrySafety,adapterContract}' =
      checked_attempt.retry_safety_adapter_contract_snapshot
    and observation_attempt #>> '{retrySafety,declaredByTrustedServiceId}' =
      checked_attempt.retry_safety_declared_by_trusted_service_id
    and observation_attempt #>> '{retrySafety,declarationToken}' =
      checked_attempt.retry_safety_declaration_token
    and (observation_attempt #>> '{retrySafety,declaredAt}')::timestamptz =
      checked_attempt.retry_safety_declared_at
    and observation_attempt #>> '{retrySafety,mechanism}' =
      checked_attempt.retry_safety_mechanism::text
    and observation_attempt #>> '{retrySafety,providerCorrelationToken}'
      is not distinct from checked_attempt.provider_correlation_token
    and (observation_attempt #>>
      '{retrySafety,automaticRetryAllowed}')::boolean =
      checked_attempt.automatic_retry_allowed
    and (observation_attempt #>> '{leaseExpiresAt}')::timestamptz =
      checked_attempt.lease_expires_at
    and (observation_attempt #>> '{openedAt}')::timestamptz =
      checked_attempt.opened_at
  ) is true;

  if not stable_projection_matches then
    return 'invalid';
  end if;

  current_attempt_projection_matches := (
    case checked_attempt.outcome_kind::text
      when 'pending' then observation_outcome = '{"kind":"pending"}'::jsonb
      when 'accepted' then
        jsonb_typeof(observation_outcome) = 'object'
        and observation_outcome ?&
          array['kind', 'completedAt', 'providerAcknowledgementToken']
        and observation_outcome -
          array['kind', 'completedAt', 'providerAcknowledgementToken'] =
          '{}'::jsonb
        and observation_outcome #>> '{kind}' = 'accepted'
        and (observation_outcome #>> '{completedAt}')::timestamptz =
          checked_attempt.completed_at
        and observation_outcome #>> '{providerAcknowledgementToken}'
          is not distinct from checked_attempt.provider_acknowledgement_token
      when 'retryable_failure' then
        jsonb_typeof(observation_outcome) = 'object'
        and observation_outcome ?&
          array['kind', 'completedAt', 'retryAt', 'diagnostic']
        and observation_outcome -
          array['kind', 'completedAt', 'retryAt', 'diagnostic'] = '{}'::jsonb
        and observation_outcome #>> '{kind}' = 'retryable_failure'
        and (observation_outcome #>> '{completedAt}')::timestamptz =
          checked_attempt.completed_at
        and (observation_outcome #>> '{retryAt}')::timestamptz =
          checked_attempt.retry_at
        and observation_outcome #> '{diagnostic}' = jsonb_build_object(
          'codeId', checked_attempt.diagnostic_code_id,
          'retryable', checked_attempt.diagnostic_retryable,
          'correlationToken', checked_attempt.diagnostic_correlation_token,
          'safeOperatorHintId', checked_attempt.diagnostic_safe_operator_hint_id
        )
      when 'terminal_failure' then
        jsonb_typeof(observation_outcome) = 'object'
        and observation_outcome ?& array['kind', 'completedAt', 'diagnostic']
        and observation_outcome - array['kind', 'completedAt', 'diagnostic'] =
          '{}'::jsonb
        and observation_outcome #>> '{kind}' = 'terminal_failure'
        and (observation_outcome #>> '{completedAt}')::timestamptz =
          checked_attempt.completed_at
        and observation_outcome #> '{diagnostic}' = jsonb_build_object(
          'codeId', checked_attempt.diagnostic_code_id,
          'retryable', checked_attempt.diagnostic_retryable,
          'correlationToken', checked_attempt.diagnostic_correlation_token,
          'safeOperatorHintId', checked_attempt.diagnostic_safe_operator_hint_id
        )
      when 'outcome_unknown' then
        jsonb_typeof(observation_outcome) = 'object'
        and observation_outcome ?&
          array['kind', 'completedAt', 'diagnostic', 'requiredAction']
        and observation_outcome -
          array['kind', 'completedAt', 'diagnostic', 'requiredAction'] =
          '{}'::jsonb
        and observation_outcome #>> '{kind}' = 'outcome_unknown'
        and (observation_outcome #>> '{completedAt}')::timestamptz =
          checked_attempt.completed_at
        and observation_outcome #> '{diagnostic}' = jsonb_build_object(
          'codeId', checked_attempt.diagnostic_code_id,
          'retryable', checked_attempt.diagnostic_retryable,
          'correlationToken', checked_attempt.diagnostic_correlation_token,
          'safeOperatorHintId', checked_attempt.diagnostic_safe_operator_hint_id
        )
        and observation_outcome #>> '{requiredAction}' =
          checked_attempt.unknown_required_action::text
      else false
    end
    and observation_attempt ? 'completionSource'
    and observation_attempt #>> '{completionSource}'
      is not distinct from checked_attempt.completion_source::text
    and (observation_attempt #>> '{revision}')::bigint =
      checked_attempt.revision
  ) is true;

  current_dispatch_projection_matches := (
    observation_dispatch #>> '{state}' = checked_dispatch.state::text
    and (observation_dispatch #>> '{attemptCount}')::integer =
      checked_dispatch.attempt_count
    and observation_dispatch #> '{activeAttempt}' = case
      when checked_dispatch.active_attempt_id is null then 'null'::jsonb
      else jsonb_build_object(
        'tenantId', checked_dispatch.tenant_id,
        'kind', 'outbound_dispatch_attempt',
        'id', checked_dispatch.active_attempt_id
      )
    end
    and observation_dispatch #> '{lastAttempt}' = case
      when checked_dispatch.last_attempt_id is null then 'null'::jsonb
      else jsonb_build_object(
        'tenantId', checked_dispatch.tenant_id,
        'kind', 'outbound_dispatch_attempt',
        'id', checked_dispatch.last_attempt_id
      )
    end
    and observation_dispatch #> '{retryAuthorization}' = case
      when checked_dispatch.retry_authorization_decision_id is null then
        'null'::jsonb
      else jsonb_build_object(
        'tenantId', checked_dispatch.tenant_id,
        'kind', 'outbound_dispatch_reconciliation_decision',
        'id', checked_dispatch.retry_authorization_decision_id
      )
    end
    and (observation_dispatch #>> '{revision}')::bigint =
      checked_dispatch.revision
    and (observation_dispatch #>> '{updatedAt}')::timestamptz =
      checked_dispatch.updated_at
  ) is true;

  if current_attempt_projection_matches
     and current_dispatch_projection_matches
     and checked_dispatch.attempt_count = checked_attempt.attempt_number
     and checked_dispatch.last_attempt_id = checked_attempt.id
     and checked_dispatch.retry_authorization_decision_id is null
     and (
       (checked_dispatch.state = 'attempting'
         and checked_attempt.outcome_kind = 'pending'
         and checked_dispatch.active_attempt_id = checked_attempt.id)
       or (checked_dispatch.state = 'outcome_unknown'
         and checked_attempt.outcome_kind = 'outcome_unknown'
         and checked_dispatch.active_attempt_id is null)
       or (checked_dispatch.state = 'accepted'
         and checked_attempt.outcome_kind in ('accepted', 'outcome_unknown')
         and checked_dispatch.active_attempt_id is null)
     ) then
    return 'exact_head';
  end if;

  observation_is_pending_head := (
    observation_dispatch #>> '{state}' = 'attempting'
    and (observation_dispatch #>> '{attemptCount}')::integer =
      checked_attempt.attempt_number
    and observation_dispatch #> '{activeAttempt}' = jsonb_build_object(
      'tenantId', checked_attempt.tenant_id,
      'kind', 'outbound_dispatch_attempt',
      'id', checked_attempt.id
    )
    and observation_dispatch #> '{lastAttempt}' = jsonb_build_object(
      'tenantId', checked_attempt.tenant_id,
      'kind', 'outbound_dispatch_attempt',
      'id', checked_attempt.id
    )
    and observation_dispatch #> '{retryAuthorization}' = 'null'::jsonb
    and (observation_dispatch #>> '{updatedAt}')::timestamptz =
      checked_attempt.opened_at
    and observation_outcome = '{"kind":"pending"}'::jsonb
    and observation_attempt #> '{completionSource}' = 'null'::jsonb
    and (observation_attempt #>> '{revision}')::bigint = 1
  ) is true;

  if observation_is_pending_head
     and checked_dispatch.attempt_count = checked_attempt.attempt_number
     and checked_dispatch.active_attempt_id is null
     and checked_dispatch.last_attempt_id = checked_attempt.id
     and checked_dispatch.retry_authorization_decision_id is null
     and (checked_attempt.revision =
       (observation_attempt #>> '{revision}')::bigint + 1)
     and (checked_dispatch.revision =
       (observation_dispatch #>> '{revision}')::bigint + 1)
     and checked_dispatch.updated_at = checked_attempt.completed_at then
    if checked_dispatch.state = 'outcome_unknown'
       and checked_attempt.outcome_kind = 'outcome_unknown'
       and checked_attempt.completion_source in ('provider_result', 'lease_expired')
       then
      return 'pending_to_outcome_unknown';
    end if;
    if checked_dispatch.state = 'accepted'
       and checked_attempt.outcome_kind = 'accepted'
       and checked_attempt.completion_source in
         ('provider_result', 'provider_observation') then
      return 'pending_to_accepted';
    end if;
  end if;

  observation_is_unknown_head := (
    observation_dispatch #>> '{state}' = 'outcome_unknown'
    and (observation_dispatch #>> '{attemptCount}')::integer =
      checked_attempt.attempt_number
    and observation_dispatch #> '{activeAttempt}' = 'null'::jsonb
    and observation_dispatch #> '{lastAttempt}' = jsonb_build_object(
      'tenantId', checked_attempt.tenant_id,
      'kind', 'outbound_dispatch_attempt',
      'id', checked_attempt.id
    )
    and observation_dispatch #> '{retryAuthorization}' = 'null'::jsonb
    and current_attempt_projection_matches
    and checked_attempt.outcome_kind = 'outcome_unknown'
    and (observation_dispatch #>> '{updatedAt}')::timestamptz =
      checked_attempt.completed_at
  ) is true;

  if observation_is_unknown_head
     and checked_dispatch.state = 'accepted'
     and checked_dispatch.attempt_count = checked_attempt.attempt_number
     and checked_dispatch.active_attempt_id is null
     and checked_dispatch.last_attempt_id = checked_attempt.id
     and checked_dispatch.retry_authorization_decision_id is null
     and checked_dispatch.revision =
       (observation_dispatch #>> '{revision}')::bigint + 1
     and checked_dispatch.updated_at >= checked_attempt.completed_at then
    return 'outcome_unknown_to_accepted';
  end if;

  if observation_is_pending_head
     and checked_dispatch.state = 'accepted'
     and checked_attempt.outcome_kind = 'outcome_unknown'
     and checked_attempt.completion_source in ('provider_result', 'lease_expired')
     and checked_dispatch.attempt_count = checked_attempt.attempt_number
     and checked_dispatch.active_attempt_id is null
     and checked_dispatch.last_attempt_id = checked_attempt.id
     and checked_dispatch.retry_authorization_decision_id is null
     and checked_attempt.revision =
       (observation_attempt #>> '{revision}')::bigint + 1
     and checked_dispatch.revision =
       (observation_dispatch #>> '{revision}')::bigint + 2
     and checked_dispatch.updated_at >= checked_attempt.completed_at then
    return 'pending_to_outcome_unknown_to_accepted';
  end if;

  return 'invalid';
end;
$function$;

create or replace function public.inbox_v2_outbound_provider_observation_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_outbound_dispatch_artifacts artifact_row
    join public.inbox_v2_outbound_dispatch_attempts attempt_row
      on attempt_row.tenant_id = artifact_row.tenant_id
     and attempt_row.id = artifact_row.attempt_id
     and attempt_row.dispatch_id = artifact_row.dispatch_id
     and attempt_row.route_id = artifact_row.route_id
     and attempt_row.message_id = artifact_row.message_id
    join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = artifact_row.tenant_id
     and dispatch_row.id = artifact_row.dispatch_id
     and dispatch_row.route_id = artifact_row.route_id
     and dispatch_row.message_id = artifact_row.message_id
    join public.inbox_v2_outbound_routes route_row
      on route_row.tenant_id = artifact_row.tenant_id
     and route_row.id = artifact_row.route_id
    join public.inbox_v2_file_outbound_dispatch_plans content_plan_row
      on content_plan_row.tenant_id = artifact_row.tenant_id
     and content_plan_row.id = new.content_plan_id
     and content_plan_row.dispatch_id = artifact_row.dispatch_id
    join public.inbox_v2_file_outbound_artifact_plans artifact_plan_row
      on artifact_plan_row.tenant_id = content_plan_row.tenant_id
     and artifact_plan_row.content_plan_id = content_plan_row.id
     and artifact_plan_row.id = new.artifact_plan_id
     and artifact_plan_row.ordinal = artifact_row.ordinal
     and artifact_plan_row.dispatch_id = artifact_row.dispatch_id
    cross join lateral (
      select public.inbox_v2_outbound_provider_transport_lineage(
        new.observation_detail, dispatch_row, attempt_row
      ) as transport_lineage
    ) lineage_row
   where artifact_row.tenant_id = new.tenant_id
      and artifact_row.id = new.artifact_id
     and artifact_row.dispatch_id = new.dispatch_id
     and artifact_row.route_id = new.route_id
     and artifact_row.attempt_id = new.attempt_id
     and artifact_row.message_id = new.message_id
     and artifact_row.ordinal = new.artifact_ordinal
     and artifact_row.state = new.artifact_state
     and content_plan_row.message_id = new.message_id
     and content_plan_row.route_id = new.route_id
     and content_plan_row.plan_digest_sha256 =
       new.content_plan_digest_sha256
     and content_plan_row.artifact_count = new.planned_artifact_count
      and artifact_plan_row.artifact_plan_hash_sha256 =
        new.artifact_plan_hash_sha256
      and new.observation_detail ?& array[
        'tenantId', 'id', 'artifact', 'dispatch', 'route', 'attempt',
        'sourceOccurrence', 'sourceOccurrenceDetailDigestSha256', 'evidence',
        'effectDisposition', 'observedByTrustedServiceId', 'recordedAt',
        'revision'
      ]
      and new.observation_detail - array[
        'tenantId', 'id', 'artifact', 'dispatch', 'route', 'attempt',
        'sourceOccurrence', 'sourceOccurrenceDetailDigestSha256', 'evidence',
        'effectDisposition', 'observedByTrustedServiceId', 'recordedAt',
        'revision'
      ] = '{}'::jsonb
      and new.observation_detail #>> '{tenantId}' = new.tenant_id
      and new.observation_detail #>> '{id}' = new.id
      and new.observation_detail #>> '{revision}' = new.revision::text
      and new.observation_detail #>> '{observedByTrustedServiceId}' =
        new.observed_by_trusted_service_id
      and (new.observation_detail #>> '{recordedAt}')::timestamptz =
        new.recorded_at
      and new.observation_detail #> '{sourceOccurrence}' =
        new.source_occurrence_detail
      and new.observation_detail #>> '{sourceOccurrenceDetailDigestSha256}' =
        new.source_occurrence_detail_digest_sha256
      and new.observation_detail #> '{effectDisposition}' =
        jsonb_build_object(
          'countsAsCustomerInbound', new.counts_as_customer_inbound,
          'createsUnread', new.creates_unread,
          'createsWorkItem', new.creates_work_item,
          'requiresProviderIo', new.requires_provider_io,
          'createsOutboundDispatch', new.creates_outbound_dispatch,
          'notificationEligible', new.notification_eligible
        )
      and (new.observation_detail #> '{artifact}') ?& array[
        'tenantId', 'id', 'dispatch', 'route', 'attempt', 'ordinal', 'state',
        'diagnostic', 'createdAt', 'revision'
      ]
      and (new.observation_detail #> '{artifact}') - array[
        'tenantId', 'id', 'dispatch', 'route', 'attempt', 'ordinal', 'state',
        'diagnostic', 'createdAt', 'revision'
      ] = '{}'::jsonb
      and new.observation_detail #>> '{artifact,tenantId}' =
        artifact_row.tenant_id
      and new.observation_detail #>> '{artifact,id}' = artifact_row.id
      and new.observation_detail #> '{artifact,dispatch}' = jsonb_build_object(
        'tenantId', artifact_row.tenant_id,
        'kind', 'outbound_dispatch',
        'id', artifact_row.dispatch_id
      )
      and new.observation_detail #> '{artifact,route}' = jsonb_build_object(
        'tenantId', artifact_row.tenant_id,
        'kind', 'outbound_route',
        'id', artifact_row.route_id
      )
      and new.observation_detail #> '{artifact,attempt}' = jsonb_build_object(
        'tenantId', artifact_row.tenant_id,
        'kind', 'outbound_dispatch_attempt',
        'id', artifact_row.attempt_id
      )
      and (new.observation_detail #>> '{artifact,ordinal}')::integer =
        artifact_row.ordinal
      and new.observation_detail #>> '{artifact,state}' = artifact_row.state::text
      and new.observation_detail #> '{artifact,diagnostic}' = case
        when artifact_row.state = 'accepted' then 'null'::jsonb
        else jsonb_build_object(
          'codeId', artifact_row.diagnostic_code_id,
          'retryable', artifact_row.diagnostic_retryable,
          'correlationToken', artifact_row.diagnostic_correlation_token,
          'safeOperatorHintId', artifact_row.diagnostic_safe_operator_hint_id
        )
      end
      and (new.observation_detail #>> '{artifact,createdAt}')::timestamptz =
        artifact_row.created_at
      and (new.observation_detail #>> '{artifact,revision}')::bigint =
        artifact_row.revision
      and (new.observation_detail #> '{route}') ?& array[
        'tenantId', 'id', 'principal', 'conversation', 'externalThread',
        'sourceThreadBinding', 'sourceAccount', 'sourceConnection',
        'operationId', 'contentKindId', 'authorizationEpoch',
        'requiredConversationPermissionId', 'bindingFence', 'adapterContract',
        'routeDescriptor', 'routePolicy', 'routePolicyRevision',
        'conversationAuthorization', 'sourceAccountAuthorization',
        'referenceContext', 'runtimeObservationAtResolution', 'selection',
        'mutationToken', 'idempotencyToken', 'correlationToken', 'revision',
        'createdAt'
      ]
      and (new.observation_detail #> '{route}') - array[
        'tenantId', 'id', 'principal', 'conversation', 'externalThread',
        'sourceThreadBinding', 'sourceAccount', 'sourceConnection',
        'operationId', 'contentKindId', 'authorizationEpoch',
        'requiredConversationPermissionId', 'bindingFence', 'adapterContract',
        'routeDescriptor', 'routePolicy', 'routePolicyRevision',
        'conversationAuthorization', 'sourceAccountAuthorization',
        'referenceContext', 'runtimeObservationAtResolution', 'selection',
        'mutationToken', 'idempotencyToken', 'correlationToken', 'revision',
        'createdAt'
      ] = '{}'::jsonb
      and new.observation_detail #>> '{route,tenantId}' = route_row.tenant_id
      and new.observation_detail #>> '{route,id}' = route_row.id
      and new.observation_detail #> '{route,principal}' = case
        when route_row.principal_kind = 'employee' then jsonb_build_object(
          'kind', 'employee',
          'employee', jsonb_build_object(
            'tenantId', route_row.tenant_id,
            'kind', 'employee',
            'id', route_row.principal_employee_id
          )
        )
        else jsonb_build_object(
          'kind', 'trusted_service',
          'trustedServiceId', route_row.principal_trusted_service_id
        )
      end
      and new.observation_detail #> '{route,conversation}' =
        jsonb_build_object(
          'tenantId', route_row.tenant_id,
          'kind', 'conversation',
          'id', route_row.conversation_id
        )
      and new.observation_detail #> '{route,externalThread}' =
        jsonb_build_object(
          'tenantId', route_row.tenant_id,
          'kind', 'external_thread',
          'id', route_row.external_thread_id
        )
      and new.observation_detail #> '{route,sourceConnection}' =
        jsonb_build_object(
          'tenantId', route_row.tenant_id,
          'kind', 'source_connection',
          'id', route_row.source_connection_id
        )
      and new.observation_detail #> '{route,sourceAccount}' =
        jsonb_build_object(
          'tenantId', route_row.tenant_id,
          'kind', 'source_account',
          'id', route_row.source_account_id
        )
      and new.observation_detail #> '{route,sourceThreadBinding}' =
        jsonb_build_object(
          'tenantId', route_row.tenant_id,
          'kind', 'source_thread_binding',
          'id', route_row.source_thread_binding_id
        )
      and new.observation_detail #>> '{route,operationId}' = route_row.operation_id
      and new.observation_detail #> '{route,contentKindId}' = case
        when route_row.content_kind_id is null then 'null'::jsonb
        else to_jsonb(route_row.content_kind_id)
      end
      and new.observation_detail #>> '{route,authorizationEpoch}' =
        route_row.authorization_epoch
      and new.observation_detail #>>
        '{route,requiredConversationPermissionId}' =
        route_row.required_conversation_permission_id
      and new.observation_detail #> '{route,bindingFence}' =
        jsonb_build_object(
          'accountGeneration', route_row.account_generation::text,
          'bindingGeneration', route_row.binding_generation::text,
          'remoteAccessRevision', route_row.remote_access_revision::text,
          'administrativeRevision', route_row.administrative_revision::text,
          'capabilityRevision', route_row.capability_revision::text,
          'routeDescriptorRevision', route_row.route_descriptor_revision::text
        )
      and new.observation_detail #> '{route,adapterContract}' =
        route_row.adapter_contract_snapshot
      and new.observation_detail #> '{route,routeDescriptor}' =
        route_row.route_descriptor_snapshot
      and new.observation_detail #> '{route,routePolicy}' = jsonb_build_object(
        'tenantId', route_row.tenant_id,
        'kind', 'thread_route_policy',
        'id', route_row.route_policy_id
      )
      and (new.observation_detail #>> '{route,routePolicyRevision}')::bigint =
        route_row.route_policy_revision
      and new.observation_detail #> '{route,conversationAuthorization}' =
        route_row.conversation_authorization_snapshot
      and new.observation_detail #> '{route,sourceAccountAuthorization}' =
        route_row.source_account_authorization_snapshot
      and new.observation_detail #> '{route,referenceContext}' =
        route_row.reference_context_snapshot
      and new.observation_detail #> '{route,runtimeObservationAtResolution}' =
        route_row.runtime_observation_snapshot
      and new.observation_detail #> '{route,selection,intent}' =
        route_row.selection_intent_snapshot
      and (new.observation_detail #> '{route,selection}') ?& array[
        'intent', 'reason', 'candidateSnapshotToken',
        'candidateSnapshotNotAfter', 'fallbackPolicyOrdinal', 'selectedAt'
      ]
      and (new.observation_detail #> '{route,selection}') - array[
        'intent', 'reason', 'candidateSnapshotToken',
        'candidateSnapshotNotAfter', 'fallbackPolicyOrdinal', 'selectedAt'
      ] = '{}'::jsonb
      and new.observation_detail #>> '{route,selection,reason}' =
        route_row.selection_reason::text
      and new.observation_detail #>>
        '{route,selection,candidateSnapshotToken}' =
        route_row.candidate_snapshot_token
      and (new.observation_detail #>>
        '{route,selection,candidateSnapshotNotAfter}')::timestamptz =
        route_row.candidate_snapshot_not_after
      and new.observation_detail #> '{route,selection,fallbackPolicyOrdinal}' =
        case
          when route_row.fallback_policy_ordinal is null then 'null'::jsonb
          else to_jsonb(route_row.fallback_policy_ordinal)
        end
      and (new.observation_detail #>>
        '{route,selection,selectedAt}')::timestamptz = route_row.selected_at
      and new.observation_detail #>> '{route,mutationToken}' =
        route_row.mutation_token
      and new.observation_detail #>> '{route,idempotencyToken}' =
        route_row.idempotency_token
      and new.observation_detail #>> '{route,correlationToken}' =
        route_row.correlation_token
      and (new.observation_detail #>> '{route,revision}')::bigint =
        route_row.revision
      and (new.observation_detail #>> '{route,createdAt}')::timestamptz =
        route_row.created_at
      and (new.observation_detail #>> '{evidence,artifactOrdinal}')::integer =
        new.artifact_ordinal
      and (
        (new.evidence_kind = 'provider_response_attempt'
          and new.observation_detail #> '{evidence}' = jsonb_build_object(
            'kind', 'provider_response_attempt',
            'artifactOrdinal', new.artifact_ordinal,
            'outboundDispatchAttempt', jsonb_build_object(
              'tenantId', new.tenant_id,
              'kind', 'outbound_dispatch_attempt',
              'id', new.attempt_id
            )))
        or (new.evidence_kind = 'provider_echo_correlation'
          and new.observation_detail #> '{evidence}' = jsonb_build_object(
            'kind', 'provider_echo_correlation',
            'artifactOrdinal', new.artifact_ordinal,
            'providerReferenceKindId', new.provider_reference_kind_id,
            'correlationToken', new.correlation_token
          ))
      )
      and route_row.external_thread_id = new.external_thread_id
     and route_row.source_connection_id = new.route_source_connection_id
     and route_row.source_account_id = new.route_source_account_id
     and route_row.source_thread_binding_id =
       new.route_source_thread_binding_id
     and route_row.binding_generation = new.route_binding_generation
     and route_row.adapter_contract_id = new.adapter_contract_id
     and route_row.adapter_contract_version = new.adapter_contract_version
     and route_row.adapter_declaration_revision =
       new.adapter_declaration_revision
     and route_row.adapter_surface_id = new.adapter_surface_id
     and route_row.adapter_loaded_by_trusted_service_id =
       new.observed_by_trusted_service_id
     and new.source_occurrence_detail #>>
       '{messageIdentityDeclaration,adapterContract,loadedByTrustedServiceId}' =
       new.observed_by_trusted_service_id
      and (new.source_occurrence_detail #>>
        '{messageIdentityDeclaration,adapterContract,loadedAt}')::timestamptz =
        route_row.adapter_loaded_at
      and lineage_row.transport_lineage in (
        'exact_head',
        'pending_to_outcome_unknown',
        'pending_to_accepted'
      )
      and (
        dispatch_row.state <> 'accepted'
        or attempt_row.outcome_kind <> 'outcome_unknown'
        or exists (
          select 1
            from public.inbox_v2_outbound_dispatch_reconciliation_decisions
              accepted_decision_row
           where accepted_decision_row.tenant_id = dispatch_row.tenant_id
             and accepted_decision_row.dispatch_id = dispatch_row.id
             and accepted_decision_row.route_id = dispatch_row.route_id
             and accepted_decision_row.unknown_attempt_id = attempt_row.id
             and accepted_decision_row.result_state = 'accepted'
             and accepted_decision_row.decided_by_kind = 'trusted_service'
             and accepted_decision_row.decided_at = dispatch_row.updated_at
        )
      )
     and artifact_row.created_at >= attempt_row.opened_at
     and content_plan_row.created_at >= dispatch_row.created_at
     and (new.source_occurrence_detail #>> '{observedAt}')::timestamptz >=
       attempt_row.opened_at
     and (new.source_occurrence_detail #>> '{observedAt}')::timestamptz <=
       new.recorded_at
     and artifact_row.created_at <= new.recorded_at
     and content_plan_row.created_at <= new.recorded_at
     and dispatch_row.updated_at <= new.recorded_at
   for share of artifact_row, attempt_row, dispatch_row, route_row,
     content_plan_row, artifact_plan_row;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_observation_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_artifact_resolution_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_outbound_provider_observations observation_row
    join public.inbox_v2_outbound_dispatch_artifacts artifact_row
      on artifact_row.tenant_id = observation_row.tenant_id
     and artifact_row.id = observation_row.artifact_id
     and artifact_row.dispatch_id = observation_row.dispatch_id
     and artifact_row.route_id = observation_row.route_id
     and artifact_row.attempt_id = observation_row.attempt_id
     and artifact_row.message_id = observation_row.message_id
     and artifact_row.ordinal = observation_row.artifact_ordinal
     and artifact_row.state = observation_row.artifact_state
   where observation_row.tenant_id = new.tenant_id
     and observation_row.id = new.observation_id
     and observation_row.artifact_id = new.artifact_id
     and observation_row.dispatch_id = new.dispatch_id
     and observation_row.route_id = new.route_id
     and observation_row.attempt_id = new.attempt_id
     and observation_row.message_id = new.message_id
     and observation_row.artifact_ordinal = new.artifact_ordinal
     and observation_row.artifact_state = new.from_state
     and observation_row.effective_state = new.effective_state
     and observation_row.source_occurrence_id =
       new.observation_source_occurrence_id
     and observation_row.observed_by_trusted_service_id =
       new.resolved_by_trusted_service_id
     and observation_row.recorded_at <= new.resolved_at
     and artifact_row.created_at <= new.resolved_at
   for share of observation_row, artifact_row;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_artifact_resolution_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_provider_settlement_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  coverage_complete boolean := false;
  current_attempt_outcome public.inbox_v2_outbound_dispatch_attempt_outcome;
  current_attempt_completion_source
    public.inbox_v2_outbound_dispatch_attempt_completion_source;
  current_attempt_completed_at timestamptz;
  current_dispatch_state public.inbox_v2_outbound_dispatch_state;
  current_dispatch_updated_at timestamptz;
  observation_transport_lineage text := 'invalid';
  accepted_reconciliation_proven boolean := false;
begin
  perform 1
    from public.inbox_v2_outbound_provider_observations observation_row
    join public.inbox_v2_outbound_dispatch_artifact_resolutions resolution_row
      on resolution_row.tenant_id = observation_row.tenant_id
     and resolution_row.id = new.artifact_resolution_id
     and resolution_row.artifact_id = observation_row.artifact_id
     and resolution_row.dispatch_id = observation_row.dispatch_id
     and resolution_row.route_id = observation_row.route_id
     and resolution_row.attempt_id = observation_row.attempt_id
     and resolution_row.message_id = observation_row.message_id
     and resolution_row.artifact_ordinal = observation_row.artifact_ordinal
     and resolution_row.effective_state = observation_row.effective_state
    join public.inbox_v2_source_occurrences occurrence_row
      on occurrence_row.tenant_id = observation_row.tenant_id
     and occurrence_row.id = observation_row.source_occurrence_id
     and occurrence_row.revision = new.source_occurrence_revision
     and occurrence_row.resolution_state = 'resolved'
     and occurrence_row.resolved_external_message_reference_id =
       new.external_message_reference_id
    join public.inbox_v2_source_occurrence_resolution_transitions transition_row
      on transition_row.tenant_id = occurrence_row.tenant_id
     and transition_row.source_occurrence_id = occurrence_row.id
     and transition_row.resulting_revision = occurrence_row.revision
     and transition_row.to_state = 'resolved'
     and transition_row.resolved_external_message_reference_id =
       new.external_message_reference_id
    join public.inbox_v2_external_message_references reference_row
      on reference_row.tenant_id = occurrence_row.tenant_id
     and reference_row.id = new.external_message_reference_id
     and reference_row.external_thread_id = new.external_thread_id
     and reference_row.message_id = observation_row.message_id
    join public.inbox_v2_outbound_dispatch_artifact_reference_links artifact_link_row
      on artifact_link_row.tenant_id = observation_row.tenant_id
     and artifact_link_row.id = new.canonical_artifact_reference_link_id
     and artifact_link_row.artifact_id = observation_row.artifact_id
     and artifact_link_row.dispatch_id = observation_row.dispatch_id
     and artifact_link_row.route_id = observation_row.route_id
     and artifact_link_row.attempt_id = observation_row.attempt_id
     and artifact_link_row.message_id = observation_row.message_id
     and artifact_link_row.external_thread_id = new.external_thread_id
     and artifact_link_row.external_message_reference_id = reference_row.id
    join public.inbox_v2_message_transport_links transport_link_row
      on transport_link_row.tenant_id = observation_row.tenant_id
     and transport_link_row.id = new.message_transport_link_id
     and transport_link_row.message_id = observation_row.message_id
     and transport_link_row.source_occurrence_id = occurrence_row.id
     and transport_link_row.external_message_reference_id = reference_row.id
    join public.inbox_v2_outbound_dispatch_attempts attempt_row
      on attempt_row.tenant_id = observation_row.tenant_id
     and attempt_row.id = observation_row.attempt_id
     and attempt_row.dispatch_id = observation_row.dispatch_id
     and attempt_row.route_id = observation_row.route_id
     and attempt_row.message_id = observation_row.message_id
    join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = attempt_row.tenant_id
     and dispatch_row.id = attempt_row.dispatch_id
     and dispatch_row.route_id = attempt_row.route_id
     and dispatch_row.message_id = attempt_row.message_id
    join public.inbox_v2_outbound_routes route_row
      on route_row.tenant_id = attempt_row.tenant_id
     and route_row.id = attempt_row.route_id
   where observation_row.tenant_id = new.tenant_id
     and observation_row.id = new.observation_id
     and observation_row.artifact_id = new.artifact_id
     and observation_row.dispatch_id = new.dispatch_id
     and observation_row.route_id = new.route_id
     and observation_row.attempt_id = new.attempt_id
     and observation_row.message_id = new.message_id
     and observation_row.artifact_ordinal = new.artifact_ordinal
     and observation_row.effective_state = new.effective_state
     and observation_row.source_occurrence_id = new.source_occurrence_id
     and resolution_row.resolved_by_trusted_service_id =
       new.settled_by_trusted_service_id
     and resolution_row.resolved_at <= new.settled_at
     and observation_row.observed_by_trusted_service_id =
       new.settled_by_trusted_service_id
     and observation_row.recorded_at <= new.settled_at
     and occurrence_row.external_thread_id = observation_row.external_thread_id
     and occurrence_row.source_connection_id = observation_row.source_connection_id
     and occurrence_row.source_account_id = observation_row.source_account_id
     and occurrence_row.source_thread_binding_id =
       observation_row.source_thread_binding_id
     and occurrence_row.binding_generation =
       observation_row.source_binding_generation
     and occurrence_row.message_scope_kind =
       observation_row.source_message_scope_kind
     and occurrence_row.message_decision_strength =
       observation_row.source_message_decision_strength
     and occurrence_row.adapter_contract_id = observation_row.adapter_contract_id
     and occurrence_row.adapter_contract_version =
       observation_row.adapter_contract_version
     and occurrence_row.adapter_declaration_revision =
       observation_row.adapter_declaration_revision
     and occurrence_row.adapter_surface_id = observation_row.adapter_surface_id
     and occurrence_row.adapter_loaded_by_trusted_service_id =
       observation_row.observed_by_trusted_service_id
     and occurrence_row.direction = 'outbound'
     and occurrence_row.provider_actor_kind is null
     and occurrence_row.created_at = observation_row.recorded_at
     and occurrence_row.recorded_at = observation_row.recorded_at
     and occurrence_row.updated_at = new.settled_at
     and transition_row.resolver_trusted_service_id =
       new.settled_by_trusted_service_id
     and transition_row.changed_at = new.settled_at
     and artifact_link_row.linked_at <= new.settled_at
     and transport_link_row.linked_at = new.settled_at
     and transport_link_row.role = case observation_row.evidence_kind
       when 'provider_response_attempt' then
         'provider_response'::public.inbox_v2_message_transport_link_role
       when 'provider_echo_correlation' then
         'provider_echo'::public.inbox_v2_message_transport_link_role
     end
     and route_row.adapter_loaded_by_trusted_service_id =
       new.settled_by_trusted_service_id
     and (
       (observation_row.evidence_kind = 'provider_response_attempt'
         and occurrence_row.origin_kind = 'provider_response'
         and occurrence_row.outbound_dispatch_attempt_id = attempt_row.id)
       or (observation_row.evidence_kind = 'provider_echo_correlation'
         and occurrence_row.origin_kind = 'provider_echo')
     )
   for share of observation_row, resolution_row, occurrence_row,
     transition_row, reference_row, artifact_link_row, transport_link_row,
     attempt_row, dispatch_row, route_row;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_chain_invalid';
  end if;

  select
    not exists (
      select 1
        from public.inbox_v2_file_outbound_artifact_plans plan_artifact_row
       where plan_artifact_row.tenant_id = observation_row.tenant_id
         and plan_artifact_row.content_plan_id = observation_row.content_plan_id
         and not exists (
           select 1
             from public.inbox_v2_outbound_dispatch_artifact_resolutions
               coverage_resolution_row
             join public.inbox_v2_outbound_provider_observations
               coverage_observation_row
               on coverage_observation_row.tenant_id =
                    coverage_resolution_row.tenant_id
              and coverage_observation_row.id =
                    coverage_resolution_row.observation_id
            where coverage_resolution_row.tenant_id = observation_row.tenant_id
              and coverage_resolution_row.dispatch_id =
                    observation_row.dispatch_id
              and coverage_resolution_row.route_id = observation_row.route_id
              and coverage_resolution_row.attempt_id =
                    observation_row.attempt_id
              and coverage_resolution_row.message_id =
                    observation_row.message_id
              and coverage_resolution_row.artifact_ordinal =
                    plan_artifact_row.ordinal
              and coverage_resolution_row.effective_state = 'accepted'
              and coverage_resolution_row.resolved_at <= new.settled_at
              and coverage_observation_row.content_plan_id =
                    observation_row.content_plan_id
         )
    )
    and (
      select count(*)
        from public.inbox_v2_file_outbound_artifact_plans plan_artifact_row
       where plan_artifact_row.tenant_id = observation_row.tenant_id
         and plan_artifact_row.content_plan_id = observation_row.content_plan_id
    ) = observation_row.planned_artifact_count,
    attempt_row.outcome_kind,
    attempt_row.completion_source,
    attempt_row.completed_at,
    dispatch_row.state,
    dispatch_row.updated_at,
    public.inbox_v2_outbound_provider_transport_lineage(
      observation_row.observation_detail, dispatch_row, attempt_row
    ),
    exists (
      select 1
        from public.inbox_v2_outbound_dispatch_reconciliation_decisions
          accepted_decision_row
       where accepted_decision_row.tenant_id = observation_row.tenant_id
         and accepted_decision_row.dispatch_id = observation_row.dispatch_id
         and accepted_decision_row.route_id = observation_row.route_id
         and accepted_decision_row.unknown_attempt_id = observation_row.attempt_id
         and accepted_decision_row.result_state = 'accepted'
         and accepted_decision_row.decided_by_kind = 'trusted_service'
         and accepted_decision_row.decided_at = dispatch_row.updated_at
    )
    into coverage_complete, current_attempt_outcome,
      current_attempt_completion_source, current_attempt_completed_at,
      current_dispatch_state, current_dispatch_updated_at,
      observation_transport_lineage, accepted_reconciliation_proven
    from public.inbox_v2_outbound_provider_observations observation_row
    join public.inbox_v2_outbound_dispatch_attempts attempt_row
      on attempt_row.tenant_id = observation_row.tenant_id
     and attempt_row.id = observation_row.attempt_id
    join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = observation_row.tenant_id
     and dispatch_row.id = observation_row.dispatch_id
   where observation_row.tenant_id = new.tenant_id
     and observation_row.id = new.observation_id;

  if new.transition_kind = 'retain_dispatch_state' then
    if coverage_complete
       or observation_transport_lineage not in (
         'exact_head', 'pending_to_outcome_unknown'
       )
       or (current_dispatch_state = 'accepted'
         and current_attempt_outcome = 'outcome_unknown'
         and not accepted_reconciliation_proven) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_partial_settlement_invalid';
    end if;
  elsif new.transition_kind = 'complete_pending_attempt' then
    if not coverage_complete
       or observation_transport_lineage <> 'pending_to_accepted'
       or current_attempt_outcome <> 'accepted'
       or current_attempt_completion_source <> 'provider_observation'
       or current_attempt_completed_at <> new.settled_at
       or current_dispatch_state <> 'accepted'
       or current_dispatch_updated_at <> new.settled_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_completion_invalid';
    end if;
  elsif new.transition_kind = 'reconcile_outcome_unknown' then
    if not coverage_complete
       or observation_transport_lineage not in (
         'outcome_unknown_to_accepted',
         'pending_to_outcome_unknown_to_accepted'
       )
       or current_attempt_outcome <> 'outcome_unknown'
       or current_dispatch_state <> 'accepted'
       or current_dispatch_updated_at <> new.settled_at
       or not accepted_reconciliation_proven
       or not exists (
         select 1
           from public.inbox_v2_outbound_dispatch_reconciliation_decisions
             decision_row
          where decision_row.tenant_id = new.tenant_id
            and decision_row.id = new.reconciliation_decision_id
            and decision_row.dispatch_id = new.dispatch_id
            and decision_row.route_id = new.route_id
            and decision_row.unknown_attempt_id = new.attempt_id
            and decision_row.result_state = 'accepted'
            and decision_row.decided_by_kind = 'trusted_service'
            and decision_row.decided_by_trusted_service_id =
              new.settled_by_trusted_service_id
            and decision_row.decided_at = new.settled_at
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_reconciliation_invalid';
    end if;
  elsif new.transition_kind = 'already_accepted' then
    if current_dispatch_state <> 'accepted'
       or observation_transport_lineage not in (
         'exact_head',
         'pending_to_accepted',
         'outcome_unknown_to_accepted',
         'pending_to_outcome_unknown_to_accepted'
       )
       or (current_attempt_outcome = 'outcome_unknown'
         and not accepted_reconciliation_proven)
       or current_dispatch_updated_at > new.settled_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_already_accepted_invalid';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_transition_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_outbound_provider_observation_work(
  checked_tenant_id text,
  checked_observation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  coherent_work_count bigint := 0;
begin
  if not exists (
    select 1
      from public.tenants tenant_row
     where tenant_row.id = checked_tenant_id
  ) then
    return;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_outbound_provider_observations observation_row
     where observation_row.tenant_id = checked_tenant_id
       and observation_row.id = checked_observation_id
  ) then
    return;
  end if;

  select count(*)
    into coherent_work_count
    from public.inbox_v2_outbound_provider_observations observation_row
    join public.inbox_v2_outbound_provider_settlement_work_items work_row
      on work_row.tenant_id = observation_row.tenant_id
     and work_row.observation_id = observation_row.id
     and work_row.trusted_service_id =
       observation_row.observed_by_trusted_service_id
     and work_row.created_at = observation_row.recorded_at
   where observation_row.tenant_id = checked_tenant_id
     and observation_row.id = checked_observation_id;

  if coherent_work_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_observation_work_required';
  end if;
end;
$function$;

create or replace function public.inbox_v2_outbound_provider_observation_work_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
begin
  if tg_op <> 'INSERT' then
    perform public.inbox_v2_assert_outbound_provider_observation_work(
      old_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_outbound_provider_observations'
        then old_row->>'id' else old_row->>'observation_id' end
    );
  end if;
  if tg_op <> 'DELETE' then
    perform public.inbox_v2_assert_outbound_provider_observation_work(
      new_row->>'tenant_id',
      case when tg_table_name = 'inbox_v2_outbound_provider_observations'
        then new_row->>'id' else new_row->>'observation_id' end
    );
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_outbound_provider_settlement_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row
       where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_work_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    perform 1
      from public.inbox_v2_outbound_provider_observations observation_row
     where observation_row.tenant_id = new.tenant_id
       and observation_row.id = new.observation_id
       and observation_row.observed_by_trusted_service_id =
         new.trusted_service_id
       and observation_row.recorded_at = new.created_at
       and new.state = 'pending'
       and new.attempt_count = 0
       and new.available_at = new.created_at
       and new.created_at = new.updated_at
       and new.revision = 1
       and row(
         new.lease_owner_id, new.lease_token_hash, new.lease_revision,
         new.lease_claimed_at, new.lease_expires_at,
         new.last_finalized_lease_owner_id,
         new.last_finalized_lease_token_hash,
         new.last_finalized_lease_revision,
         new.last_finalized_result_hash, new.last_finalized_at,
         new.last_error_code, new.terminal_at
       ) is not distinct from row(
         null, null, null, null, null, null, null, null, null, null,
         null, null
       )
     for share of observation_row;

    if not found then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_initial_invalid';
    end if;
    return new;
  end if;

  if row(
       new.tenant_id, new.observation_id,
       new.candidate_external_message_reference_id,
       new.candidate_transport_link_id, new.trusted_service_id,
       new.created_at
     ) is distinct from row(
       old.tenant_id, old.observation_id,
       old.candidate_external_message_reference_id,
       old.candidate_transport_link_id, old.trusted_service_id,
       old.created_at
     )
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or new.attempt_count < old.attempt_count then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_work_fence_invalid';
  end if;

  if old.state in ('settled', 'dead') then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_work_terminal';
  end if;

  if old.state = 'pending' then
    if new.state <> 'leased'
       or old.available_at > clock_timestamp()
       or new.available_at is distinct from old.available_at
       or new.attempt_count <> old.attempt_count + 1
       or new.lease_revision <> new.attempt_count
       or new.lease_claimed_at <> new.updated_at
       or new.lease_expires_at <= new.lease_claimed_at
       or row(
         new.last_finalized_lease_owner_id,
         new.last_finalized_lease_token_hash,
         new.last_finalized_lease_revision,
         new.last_finalized_result_hash, new.last_finalized_at,
         new.last_error_code, new.terminal_at
       ) is distinct from row(
         old.last_finalized_lease_owner_id,
         old.last_finalized_lease_token_hash,
         old.last_finalized_lease_revision,
         old.last_finalized_result_hash, old.last_finalized_at,
         old.last_error_code, old.terminal_at
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_claim_invalid';
    end if;
    return new;
  end if;

  if new.state = 'leased' then
    if old.lease_expires_at > clock_timestamp()
       or new.available_at is distinct from old.available_at
       or new.attempt_count <> old.attempt_count + 1
       or new.lease_revision <> new.attempt_count
       or new.lease_claimed_at <> new.updated_at
       or new.lease_expires_at <= new.lease_claimed_at
       or row(
         new.last_finalized_lease_owner_id,
         new.last_finalized_lease_token_hash,
         new.last_finalized_lease_revision,
         new.last_finalized_result_hash, new.last_finalized_at,
         new.last_error_code, new.terminal_at
       ) is distinct from row(
         old.last_finalized_lease_owner_id,
         old.last_finalized_lease_token_hash,
         old.last_finalized_lease_revision,
         old.last_finalized_result_hash, old.last_finalized_at,
         old.last_error_code, old.terminal_at
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_reclaim_invalid';
    end if;
    return new;
  end if;

  if old.lease_expires_at <= new.updated_at
     or new.attempt_count <> old.attempt_count
     or new.lease_owner_id is not null
     or new.lease_token_hash is not null
     or new.lease_revision is not null
     or new.lease_claimed_at is not null
     or new.lease_expires_at is not null
     or new.last_finalized_lease_owner_id <> old.lease_owner_id
     or new.last_finalized_lease_token_hash <> old.lease_token_hash
     or new.last_finalized_lease_revision <> old.lease_revision
     or new.last_finalized_result_hash is null
     or new.last_finalized_at <> new.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_work_completion_fence_invalid';
  end if;

  if new.state = 'pending' then
    if new.available_at <= new.updated_at
       or new.last_error_code is null
       or new.terminal_at is not null then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_retry_invalid';
    end if;
  elsif new.state = 'settled' then
    if new.available_at is not null
       or new.last_error_code is not null
       or new.terminal_at <> new.updated_at
       or not exists (
         select 1
           from public.inbox_v2_outbound_provider_observation_settlements
             settlement_row
          where settlement_row.tenant_id = new.tenant_id
            and settlement_row.observation_id = new.observation_id
            and settlement_row.settled_by_trusted_service_id =
              new.trusted_service_id
            and settlement_row.settled_at <= new.updated_at
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_settled_invalid';
    end if;
  elsif new.state = 'dead' then
    if new.available_at is not null
       or new.last_error_code is null
       or new.terminal_at <> new.updated_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_provider_settlement_work_dead_invalid';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_provider_settlement_work_transition_invalid';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_artifact_link_guard_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_outbound_dispatch_artifacts artifact_row
    join public.inbox_v2_outbound_dispatch_attempts attempt_row
      on attempt_row.tenant_id = artifact_row.tenant_id
     and attempt_row.id = artifact_row.attempt_id
     and attempt_row.dispatch_id = artifact_row.dispatch_id
     and attempt_row.route_id = artifact_row.route_id
     and attempt_row.message_id = artifact_row.message_id
    join public.inbox_v2_outbound_routes route_row
      on route_row.tenant_id = artifact_row.tenant_id
     and route_row.id = artifact_row.route_id
    join public.inbox_v2_source_occurrences occurrence_row
      on occurrence_row.tenant_id = artifact_row.tenant_id
     and occurrence_row.id = new.source_occurrence_id
     and occurrence_row.revision = new.source_occurrence_revision
     and occurrence_row.resolution_state = 'resolved'
     and occurrence_row.resolved_external_message_reference_id =
        new.external_message_reference_id
    join public.inbox_v2_source_occurrence_resolution_transitions transition_row
      on transition_row.tenant_id = occurrence_row.tenant_id
     and transition_row.source_occurrence_id = occurrence_row.id
     and transition_row.resulting_revision = occurrence_row.revision
     and transition_row.to_state = 'resolved'
     and transition_row.resolved_external_message_reference_id =
        occurrence_row.resolved_external_message_reference_id
    join public.inbox_v2_external_message_references reference_row
      on reference_row.tenant_id = occurrence_row.tenant_id
     and reference_row.id = occurrence_row.resolved_external_message_reference_id
     and reference_row.external_thread_id = route_row.external_thread_id
     and reference_row.message_id = artifact_row.message_id
    left join public.inbox_v2_outbound_dispatch_artifact_resolutions
      resolution_row
      on resolution_row.tenant_id = artifact_row.tenant_id
     and resolution_row.artifact_id = artifact_row.id
     and resolution_row.dispatch_id = artifact_row.dispatch_id
     and resolution_row.route_id = artifact_row.route_id
     and resolution_row.attempt_id = artifact_row.attempt_id
     and resolution_row.message_id = artifact_row.message_id
     and resolution_row.artifact_ordinal = artifact_row.ordinal
     and resolution_row.effective_state = 'accepted'
   where artifact_row.tenant_id = new.tenant_id
     and artifact_row.id = new.artifact_id
     and artifact_row.dispatch_id = new.dispatch_id
     and artifact_row.route_id = new.route_id
     and artifact_row.attempt_id = new.attempt_id
     and artifact_row.message_id = new.message_id
     and (
       artifact_row.state = 'accepted'
       or (artifact_row.state = 'outcome_unknown'
         and resolution_row.id is not null)
     )
     and route_row.external_thread_id = new.external_thread_id
     and (
       (
         route_row.source_thread_binding_id =
           occurrence_row.source_thread_binding_id
         and route_row.source_connection_id = occurrence_row.source_connection_id
         and route_row.source_account_id = occurrence_row.source_account_id
         and route_row.binding_generation = occurrence_row.binding_generation
       )
       or (
         new.evidence_kind = 'provider_echo_correlation'
         and occurrence_row.origin_kind = 'provider_echo'
         and occurrence_row.message_scope_kind = 'provider_thread'
         and occurrence_row.message_decision_strength = 'authoritative'
         and reference_row.scope_kind = 'provider_thread'
       )
     )
     and route_row.adapter_contract_id = occurrence_row.adapter_contract_id
     and route_row.adapter_contract_version = occurrence_row.adapter_contract_version
     and route_row.adapter_surface_id = occurrence_row.adapter_surface_id
     and transition_row.resolver_trusted_service_id =
        new.linked_by_trusted_service_id
     and artifact_row.created_at >= attempt_row.opened_at
     and new.linked_at >= coalesce(
       resolution_row.resolved_at, artifact_row.created_at
     )
     and new.linked_at >= occurrence_row.updated_at
     and new.linked_at >= reference_row.created_at
     and (
       (
         new.evidence_kind = 'provider_response_attempt'
         and occurrence_row.origin_kind = 'provider_response'
         and occurrence_row.outbound_dispatch_attempt_id = attempt_row.id
       ) or (
         new.evidence_kind = 'provider_echo_correlation'
         and occurrence_row.origin_kind = 'provider_echo'
         and attempt_row.provider_correlation_token = new.correlation_token
         and exists (
           select 1
             from public.inbox_v2_source_occurrence_provider_references provider_reference_row
            where provider_reference_row.tenant_id = occurrence_row.tenant_id
              and provider_reference_row.source_occurrence_id = occurrence_row.id
              and provider_reference_row.kind_id = new.provider_reference_kind_id
              and provider_reference_row.subject = new.correlation_token
         )
       )
     )
   for share of artifact_row, attempt_row, route_row, occurrence_row,
     transition_row, reference_row;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_artifact_reference_link_invalid';
  end if;

  return new;
end;
$function$;

create trigger inbox_v2_external_message_references_immutable_trigger
before update or delete on public.inbox_v2_external_message_references
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_external_message_references_insert_guard_trigger
before insert on public.inbox_v2_external_message_references
for each row execute function public.inbox_v2_external_message_reference_guard_insert();

create trigger inbox_v2_thread_route_policy_versions_insert_guard_trigger
before insert on public.inbox_v2_thread_route_policy_versions
for each row execute function public.inbox_v2_thread_route_policy_guard_version_insert();

create trigger inbox_v2_thread_route_policy_versions_immutable_trigger
before update or delete on public.inbox_v2_thread_route_policy_versions
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_thread_route_policy_heads_write_guard_trigger
before insert or update on public.inbox_v2_thread_route_policy_heads
for each row execute function public.inbox_v2_thread_route_policy_guard_head_write();

create trigger inbox_v2_thread_route_policy_heads_delete_guard_trigger
before delete on public.inbox_v2_thread_route_policy_heads
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_thread_route_policy_fallbacks_immutable_trigger
before update or delete on public.inbox_v2_thread_route_policy_fallback_bindings
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_routes_insert_guard_trigger
before insert on public.inbox_v2_outbound_routes
for each row execute function public.inbox_v2_outbound_route_guard_insert();

create trigger inbox_v2_outbound_routes_immutable_trigger
before update or delete on public.inbox_v2_outbound_routes
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_multi_send_operations_immutable_trigger
before update or delete on public.inbox_v2_outbound_multi_send_operations
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_multi_send_children_immutable_trigger
before update or delete on public.inbox_v2_outbound_multi_send_children
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_dispatches_update_guard_trigger
before update on public.inbox_v2_outbound_dispatches
for each row execute function public.inbox_v2_outbound_dispatch_guard_update();

create trigger inbox_v2_outbound_dispatches_insert_guard_trigger
before insert on public.inbox_v2_outbound_dispatches
for each row execute function public.inbox_v2_outbound_dispatch_guard_insert();

create trigger inbox_v2_outbound_dispatches_delete_guard_trigger
before delete on public.inbox_v2_outbound_dispatches
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_dispatch_attempts_insert_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_attempts
for each row execute function public.inbox_v2_outbound_attempt_guard_insert();

create trigger inbox_v2_outbound_dispatch_attempts_update_guard_trigger
before update on public.inbox_v2_outbound_dispatch_attempts
for each row execute function public.inbox_v2_outbound_attempt_guard_update();

create trigger inbox_v2_outbound_dispatch_attempts_delete_guard_trigger
before delete on public.inbox_v2_outbound_dispatch_attempts
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_correlation_anchors_insert_guard_trigger
before insert on public.inbox_v2_outbound_provider_correlation_anchors
for each row execute function public.inbox_v2_outbound_correlation_anchor_guard_insert();

create trigger inbox_v2_outbound_correlation_anchors_immutable_trigger
before update or delete on public.inbox_v2_outbound_provider_correlation_anchors
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_reconciliation_decisions_immutable_trigger
before update or delete on public.inbox_v2_outbound_dispatch_reconciliation_decisions
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_reconciliation_permissions_immutable_trigger
before update or delete on public.inbox_v2_outbound_dispatch_reconciliation_permissions
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_dispatch_artifacts_immutable_trigger
before update or delete on public.inbox_v2_outbound_dispatch_artifacts
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_provider_observations_insert_guard_trigger
before insert on public.inbox_v2_outbound_provider_observations
for each row execute function public.inbox_v2_outbound_provider_observation_guard_insert();

create trigger inbox_v2_outbound_provider_observations_immutable_trigger
before update or delete on public.inbox_v2_outbound_provider_observations
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_artifact_resolutions_insert_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_artifact_resolutions
for each row execute function public.inbox_v2_outbound_artifact_resolution_guard_insert();

create trigger inbox_v2_outbound_artifact_resolutions_immutable_trigger
before update or delete on public.inbox_v2_outbound_dispatch_artifact_resolutions
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_provider_settlements_insert_guard_trigger
before insert on public.inbox_v2_outbound_provider_observation_settlements
for each row execute function public.inbox_v2_outbound_provider_settlement_guard_insert();

create trigger inbox_v2_outbound_provider_settlements_immutable_trigger
before update or delete on public.inbox_v2_outbound_provider_observation_settlements
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_provider_settlement_work_guard_trigger
before insert or update or delete
on public.inbox_v2_outbound_provider_settlement_work_items
for each row execute function public.inbox_v2_outbound_provider_settlement_work_guard();

create constraint trigger inbox_v2_outbound_provider_observations_work_constraint
after insert or update or delete on public.inbox_v2_outbound_provider_observations
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_provider_observation_work_deferred();

create constraint trigger inbox_v2_outbound_provider_settlement_work_observation_constraint
after insert or update or delete
on public.inbox_v2_outbound_provider_settlement_work_items
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_provider_observation_work_deferred();

create trigger inbox_v2_source_occurrence_resolution_transitions_insert_guard_trigger
before insert on public.inbox_v2_source_occurrence_resolution_transitions
for each row execute function public.inbox_v2_source_occurrence_resolution_guard_insert();

create trigger inbox_v2_source_occurrence_resolution_transitions_immutable_trigger
before update or delete on public.inbox_v2_source_occurrence_resolution_transitions
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_source_occurrence_resolution_candidates_immutable_trigger
before update or delete on public.inbox_v2_source_occurrence_resolution_candidates
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create trigger inbox_v2_outbound_artifact_reference_links_insert_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_artifact_reference_links
for each row execute function public.inbox_v2_outbound_artifact_link_guard_insert();

create trigger inbox_v2_outbound_artifact_reference_links_immutable_trigger
before update or delete on public.inbox_v2_outbound_dispatch_artifact_reference_links
for each row execute function public.inbox_v2_outbound_transport_reject_immutable();

create constraint trigger inbox_v2_thread_route_policy_versions_fallbacks_constraint
after insert on public.inbox_v2_thread_route_policy_versions
deferrable initially deferred for each row
execute function public.inbox_v2_thread_route_policy_deferred_fallbacks();

create constraint trigger inbox_v2_thread_route_policy_versions_head_constraint
after insert on public.inbox_v2_thread_route_policy_versions
deferrable initially deferred for each row
execute function public.inbox_v2_thread_route_policy_deferred_head();

create constraint trigger inbox_v2_thread_route_policy_heads_current_constraint
after insert or update or delete on public.inbox_v2_thread_route_policy_heads
deferrable initially deferred for each row
execute function public.inbox_v2_thread_route_policy_deferred_head();

create constraint trigger inbox_v2_thread_route_policy_fallbacks_constraint
after insert or update or delete
on public.inbox_v2_thread_route_policy_fallback_bindings
deferrable initially deferred for each row
execute function public.inbox_v2_thread_route_policy_deferred_fallbacks();

create constraint trigger inbox_v2_outbound_multi_send_operations_children_constraint
after insert on public.inbox_v2_outbound_multi_send_operations
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_multi_send_deferred_children();

create constraint trigger inbox_v2_outbound_multi_send_children_constraint
after insert or update or delete on public.inbox_v2_outbound_multi_send_children
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_multi_send_deferred_children();

create constraint trigger inbox_v2_outbound_multi_send_dispatches_constraint
after insert or update or delete on public.inbox_v2_outbound_dispatches
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_multi_send_deferred_children();

create constraint trigger inbox_v2_outbound_dispatches_head_constraint
after insert or update on public.inbox_v2_outbound_dispatches
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_dispatch_deferred_head();

create constraint trigger inbox_v2_outbound_dispatch_attempts_head_constraint
after insert or update or delete on public.inbox_v2_outbound_dispatch_attempts
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_dispatch_deferred_head();

create constraint trigger inbox_v2_outbound_reconciliation_dispatch_constraint
after insert or update or delete
on public.inbox_v2_outbound_dispatch_reconciliation_decisions
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_dispatch_deferred_head();

create constraint trigger inbox_v2_outbound_reconciliation_decisions_constraint
after insert on public.inbox_v2_outbound_dispatch_reconciliation_decisions
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_reconciliation_deferred();

create constraint trigger inbox_v2_outbound_reconciliation_permissions_constraint
after insert or update or delete
on public.inbox_v2_outbound_dispatch_reconciliation_permissions
deferrable initially deferred for each row
execute function public.inbox_v2_outbound_reconciliation_deferred();

create constraint trigger inbox_v2_source_occurrences_resolution_constraint
after update on public.inbox_v2_source_occurrences
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_resolution_deferred();

create constraint trigger inbox_v2_source_occurrence_resolution_transitions_constraint
after insert or update or delete
on public.inbox_v2_source_occurrence_resolution_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_resolution_deferred();

create constraint trigger inbox_v2_source_occurrence_resolution_candidates_constraint
after insert or update or delete
on public.inbox_v2_source_occurrence_resolution_candidates
deferrable initially deferred for each row
execute function public.inbox_v2_source_occurrence_resolution_deferred();
`;

function idSql(column: SQLWrapper, prefix: string) {
  return sql`coalesce((char_length(${column}) <= 256
    and ${column} ~ ${sql.raw(
      `'^${prefix}:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    )}), false)`;
}

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

function authorizationEpochSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 8 and 1024
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function sha256DigestSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^[a-f0-9]{64}$', false)`;
}

function sha256PrefixedSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^sha256:[a-f0-9]{64}$', false)`;
}

function boundedJsonObjectSql(column: SQLWrapper, maximumBytes: number) {
  return sql`coalesce((jsonb_typeof(${column}) = 'object'
    and octet_length(${column}::text) between 2 and ${sql.raw(
      String(maximumBytes)
    )}), false)`;
}

function externalMessageKeyDigestSql(table: Record<string, SQLWrapper>) {
  const lengthPrefixed = (column: SQLWrapper) =>
    sql`octet_length(${column})::text || ':' || ${column}`;
  const nullableLengthPrefixed = (column: SQLWrapper) =>
    sql`case when ${column} is null then '-1:'
      else octet_length(${column})::text || ':' || ${column} end`;

  return sql`encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        ${lengthPrefixed(table.realmId)} ||
        ${lengthPrefixed(table.realmVersion)} ||
        ${lengthPrefixed(table.canonicalizationVersion)} ||
        case ${table.scopeKind}
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        ${nullableLengthPrefixed(table.scopeSourceAccountId)} ||
        ${nullableLengthPrefixed(table.scopeSourceThreadBindingId)} ||
        ${lengthPrefixed(table.objectKindId)} ||
        ${lengthPrefixed(table.externalThreadId)} ||
        ${lengthPrefixed(table.canonicalExternalSubject)},
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )`;
}

function actorSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  trustedServiceId: SQLWrapper
) {
  return sql`(
      ${kind} = 'employee'
      and ${employeeId} is not null
      and ${trustedServiceId} is null
    ) or (
      ${kind} = 'trusted_service'
      and ${employeeId} is null
      and ${catalogIdSql(trustedServiceId)}
    )`;
}

function canonicalPositiveBigintTextSql(column: SQLWrapper) {
  return sql`coalesce((${column} ~ '^[1-9][0-9]{0,18}$'
    and (
      char_length(${column}) < 19
      or ${column} <= '9223372036854775807'
    )), false)`;
}

function routeAuthorizationSnapshotsSql(table: Record<string, SQLWrapper>) {
  const principal = sql`case ${table.principalKind}
    when 'employee' then jsonb_build_object(
      'kind', 'employee',
      'employee', jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'employee',
        'id', ${table.principalEmployeeId}
      )
    )
    else jsonb_build_object(
      'kind', 'trusted_service',
      'trustedServiceId', ${table.principalTrustedServiceId}
    )
  end`;
  const referenceTarget = sql`case
    when ${table.referenceContextSnapshot} #>> '{kind}' = 'none'
      then jsonb_build_object('kind', 'none')
    else jsonb_build_object(
      'kind', 'external_message',
      'externalMessageReference', jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'external_message_reference',
        'id', ${table.referenceContextSnapshot} #>>
          '{externalMessageReference,id}'
      ),
      'sourceOccurrence', jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'source_occurrence',
        'id', ${table.referenceContextSnapshot} #>> '{sourceOccurrence,id}'
      )
    )
  end`;
  const target = sql`jsonb_build_object(
    'conversation', jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', 'conversation',
      'id', ${table.conversationId}
    ),
    'externalThread', jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', 'external_thread',
      'id', ${table.externalThreadId}
    ),
    'sourceThreadBinding', jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', 'source_thread_binding',
      'id', ${table.sourceThreadBindingId}
    ),
    'sourceAccount', jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', 'source_account',
      'id', ${table.sourceAccountId}
    ),
    'sourceConnection', jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', 'source_connection',
      'id', ${table.sourceConnectionId}
    ),
    'operationId', ${table.operationId},
    'contentKindId', ${table.contentKindId},
    'authorizationEpoch', ${table.authorizationEpoch},
    'bindingFence', jsonb_build_object(
      'accountGeneration', ${table.accountGeneration}::text,
      'bindingGeneration', ${table.bindingGeneration}::text,
      'remoteAccessRevision', ${table.remoteAccessRevision}::text,
      'administrativeRevision', ${table.administrativeRevision}::text,
      'capabilityRevision', ${table.capabilityRevision}::text,
      'routeDescriptorRevision', ${table.routeDescriptorRevision}::text
    ),
    'referenceTarget', ${referenceTarget}
  )`;
  const decision = (
    snapshot: SQLWrapper,
    decisionKind: SQLWrapper,
    requiredPermissionId: SQLWrapper
  ) => sql`(
    ${snapshot} #>> '{decisionKind}' = ${decisionKind}
    and ${snapshot} #>> '{tenantId}' = ${table.tenantId}
    and ${snapshot} #> '{principal}' = ${principal}
    and ${snapshot} #> '{target}' = ${target}
    and ${snapshot} #>> '{effect}' = 'allow'
    and ${snapshot} #>> '{requiredPermissionId}' = ${requiredPermissionId}
    and jsonb_typeof(${snapshot} #> '{matchedPermissionIds}') = 'array'
    and jsonb_array_length(${snapshot} #> '{matchedPermissionIds}')
      between 1 and 64
    and (${snapshot} #> '{matchedPermissionIds}') @>
      jsonb_build_array(${requiredPermissionId})
    and ${routingTokenSql(sql`${snapshot} #>> '{decisionToken}'`)}
    and ${canonicalPositiveBigintTextSql(
      sql`${snapshot} #>> '{decisionRevision}'`
    )}
    and ${catalogIdSql(sql`${snapshot} #>> '{loadedByTrustedServiceId}'`)}
    and isfinite((${snapshot} #>> '{decidedAt}')::timestamptz)
    and isfinite((${snapshot} #>> '{notAfter}')::timestamptz)
    and (${snapshot} #>> '{decidedAt}')::timestamptz <= ${table.selectedAt}
    and (${snapshot} #>> '{notAfter}')::timestamptz >= ${table.selectedAt}
  )`;

  return sql`(${decision(
    table.conversationAuthorizationSnapshot,
    sql`'conversation_action'`,
    table.requiredConversationPermissionId
  )} and ${decision(
    table.sourceAccountAuthorizationSnapshot,
    sql`'source_account_use'`,
    sql`'core:source_account.use'`
  )}) is true`;
}

function routeReferenceContextSql(table: Record<string, SQLWrapper>) {
  const snapshot = table.referenceContextSnapshot;
  const reference = (path: string, kind: string, id: SQLWrapper) => sql`(
    ${snapshot} #> ${sql.raw(`'{${path}}'`)} = jsonb_build_object(
      'tenantId', ${table.tenantId},
      'kind', ${sql.raw(`'${kind}'`)},
      'id', ${id}
    )
  )`;
  const externalMessageReferenceId = sql`${snapshot} #>>
    '{externalMessageReference,id}'`;
  const sourceOccurrenceId = sql`${snapshot} #>> '{sourceOccurrence,id}'`;
  const originBindingId = sql`${snapshot} #>> '{originBinding,id}'`;
  const originSourceAccountId = sql`${snapshot} #>>
    '{originSourceAccount,id}'`;
  const portability = sql`${snapshot} #> '{portability}'`;
  const resolution = sql`${snapshot} #> '{resolutionDecision}'`;
  const descriptor = sql`${resolution} #> '{occurrenceDescriptor}'`;
  const availability = sql`${resolution} #> '{availabilityObservation}'`;

  return sql`((
      ${snapshot} = '{"kind":"none"}'::jsonb
    ) or (
      ${snapshot} #>> '{kind}' = 'external_message'
      and ${reference(
        "externalThread",
        "external_thread",
        table.externalThreadId
      )}
      and ${idSql(externalMessageReferenceId, "external_message_reference")}
      and ${reference(
        "externalMessageReference",
        "external_message_reference",
        externalMessageReferenceId
      )}
      and ${idSql(sourceOccurrenceId, "source_occurrence")}
      and ${reference(
        "sourceOccurrence",
        "source_occurrence",
        sourceOccurrenceId
      )}
      and ${idSql(originBindingId, "source_thread_binding")}
      and ${reference(
        "originBinding",
        "source_thread_binding",
        originBindingId
      )}
      and ${idSql(originSourceAccountId, "source_account")}
      and ${reference(
        "originSourceAccount",
        "source_account",
        originSourceAccountId
      )}
      and ${portability} #>> '{kind}' in (
        'binding_only', 'external_thread', 'provider_global'
      )
      and ${portability} #>> '{decisionStrength}' in (
        'authoritative', 'safe_default'
      )
      and (${portability} #>> '{kind}' = 'binding_only'
        or ${portability} #>> '{decisionStrength}' = 'authoritative')
      and ${portability} #> '{adapterContract}' =
        ${table.adapterContractSnapshot}
      and ${resolution} #>> '{decisionKind}' =
        'external_message_reference_resolution'
      and ${resolution} #>> '{tenantId}' = ${table.tenantId}
      and ${resolution} #> '{externalThread}' =
        ${snapshot} #> '{externalThread}'
      and ${resolution} #> '{externalMessageReference}' =
        ${snapshot} #> '{externalMessageReference}'
      and ${resolution} #> '{sourceOccurrence}' =
        ${snapshot} #> '{sourceOccurrence}'
      and ${resolution} #> '{originBinding}' =
        ${snapshot} #> '{originBinding}'
      and ${resolution} #> '{originSourceAccount}' =
        ${snapshot} #> '{originSourceAccount}'
      and ${canonicalPositiveBigintTextSql(
        sql`${resolution} #>> '{occurrenceRevision}'`
      )}
      and ${canonicalPositiveBigintTextSql(
        sql`${resolution} #>> '{occurrenceBindingGeneration}'`
      )}
      and ${descriptor} #> '{adapterContract}' =
        ${table.adapterContractSnapshot}
      and ${catalogIdSql(sql`${descriptor} #>> '{descriptorSchemaId}'`)}
      and ${versionTokenSql(sql`${descriptor} #>> '{descriptorVersion}'`)}
      and ${canonicalPositiveBigintTextSql(
        sql`${descriptor} #>> '{capabilityRevision}'`
      )}
      and jsonb_typeof(${descriptor} #> '{providerReferences}') = 'array'
      and jsonb_array_length(${descriptor} #> '{providerReferences}')
        between 1 and 32
      and ${sha256DigestSql(sql`${descriptor} #>> '{descriptorDigestSha256}'`)}
      and ${resolution} #> '{portability}' = ${portability}
      and ${availability} #>> '{observationKind}' =
        'external_message_reference_availability'
      and ${availability} #>> '{tenantId}' = ${table.tenantId}
      and ${availability} #> '{externalThread}' =
        ${snapshot} #> '{externalThread}'
      and ${availability} #> '{externalMessageReference}' =
        ${snapshot} #> '{externalMessageReference}'
      and ${availability} #> '{sourceOccurrence}' =
        ${snapshot} #> '{sourceOccurrence}'
      and ${availability} #>> '{occurrenceRevision}' =
        ${resolution} #>> '{occurrenceRevision}'
      and ${availability} #>> '{occurrenceDescriptorDigestSha256}' =
        ${descriptor} #>> '{descriptorDigestSha256}'
      and ${availability} #> '{adapterContract}' =
        ${table.adapterContractSnapshot}
      and ${availability} #>> '{state}' = 'available'
      and ${availability} #> '{diagnostic}' = 'null'::jsonb
      and ${routingTokenSql(sql`${availability} #>> '{observationToken}'`)}
      and ${catalogIdSql(
        sql`${availability} #>> '{observedByTrustedServiceId}'`
      )}
      and isfinite((${availability} #>> '{observedAt}')::timestamptz)
      and isfinite((${availability} #>> '{notAfter}')::timestamptz)
      and (${availability} #>> '{observedAt}')::timestamptz <=
        ${table.selectedAt}
      and (${availability} #>> '{notAfter}')::timestamptz >=
        ${table.selectedAt}
      and (
        ${resolution} #> '{referenceWindow}' =
          '{"state":"not_applicable"}'::jsonb
        or (
          ${resolution} #>> '{referenceWindow,state}' = 'valid'
          and isfinite((${resolution} #>>
            '{referenceWindow,notAfter}')::timestamptz)
          and (${resolution} #>>
            '{referenceWindow,notAfter}')::timestamptz >= ${table.selectedAt}
        )
      )
      and ${routingTokenSql(sql`${resolution} #>> '{decisionToken}'`)}
      and ${canonicalPositiveBigintTextSql(
        sql`${resolution} #>> '{decisionRevision}'`
      )}
      and ${catalogIdSql(sql`${resolution} #>> '{loadedByTrustedServiceId}'`)}
      and isfinite((${resolution} #>> '{decidedAt}')::timestamptz)
      and isfinite((${resolution} #>> '{notAfter}')::timestamptz)
      and (${descriptor} #>> '{adapterContract,loadedAt}')::timestamptz <=
        (${availability} #>> '{observedAt}')::timestamptz
      and (${availability} #>> '{observedAt}')::timestamptz <=
        (${resolution} #>> '{decidedAt}')::timestamptz
      and (${availability} #>> '{notAfter}')::timestamptz >=
        (${resolution} #>> '{notAfter}')::timestamptz
      and (${resolution} #>> '{decidedAt}')::timestamptz <= ${table.selectedAt}
      and (${resolution} #>> '{notAfter}')::timestamptz >= ${table.selectedAt}
    )) is true`;
}

function routeRuntimeObservationSql(table: Record<string, SQLWrapper>) {
  const snapshot = table.runtimeObservationSnapshot;
  const diagnostic = sql`${snapshot} #> '{diagnostic}'`;
  const safeDiagnostic = sql`(
    jsonb_typeof(${diagnostic}) = 'object'
    and (${diagnostic}) ?& array[
      'codeId', 'retryable', 'correlationToken', 'safeOperatorHintId'
    ]::text[]
    and (${diagnostic}) - array[
      'codeId', 'retryable', 'correlationToken', 'safeOperatorHintId'
    ]::text[] = '{}'::jsonb
    and ${catalogIdSql(sql`${snapshot} #>> '{diagnostic,codeId}'`)}
    and jsonb_typeof(${snapshot} #> '{diagnostic,retryable}') = 'boolean'
    and ${routingTokenSql(sql`${snapshot} #>> '{diagnostic,correlationToken}'`)}
    and (
      ${snapshot} #> '{diagnostic,safeOperatorHintId}' = 'null'::jsonb
      or ${catalogIdSql(sql`${snapshot} #>> '{diagnostic,safeOperatorHintId}'`)}
    )
  )`;

  return sql`(
    ${snapshot} ?& array[
      'state', 'revision', 'observedAt', 'diagnostic'
    ]::text[]
    and ${snapshot} - array[
      'state', 'revision', 'observedAt', 'diagnostic'
    ]::text[] = '{}'::jsonb
    and ${snapshot} #>> '{state}' in ('unknown', 'ready', 'degraded', 'unavailable')
    and ${canonicalPositiveBigintTextSql(sql`${snapshot} #>> '{revision}'`)}
    and isfinite((${snapshot} #>> '{observedAt}')::timestamptz)
    and (${snapshot} #>> '{observedAt}')::timestamptz <= ${table.selectedAt}
    and (
      (${snapshot} #>> '{state}' = 'ready'
        and ${diagnostic} = 'null'::jsonb)
      or (${snapshot} #>> '{state}' in ('degraded', 'unavailable')
        and ${safeDiagnostic})
      or (${snapshot} #>> '{state}' = 'unknown'
        and (${diagnostic} = 'null'::jsonb or ${safeDiagnostic}))
    )
  ) is true`;
}

function attemptOutcomeSql(table: Record<string, SQLWrapper>) {
  const safeDiagnostic = sql`${catalogIdSql(table.diagnosticCodeId)}
    and ${table.diagnosticRetryable} is not null
    and ${routingTokenSql(table.diagnosticCorrelationToken)}
    and (${table.diagnosticSafeOperatorHintId} is null
      or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})`;

  return sql`((
      ${table.outcomeKind} = 'pending'
      and ${table.completionSource} is null
      and ${table.completedAt} is null
      and ${table.retryAt} is null
      and ${table.providerAcknowledgementToken} is null
      and ${table.diagnosticCodeId} is null
      and ${table.diagnosticRetryable} is null
      and ${table.diagnosticCorrelationToken} is null
      and ${table.diagnosticSafeOperatorHintId} is null
      and ${table.unknownRequiredAction} is null
      and ${table.revision} = 1
    ) or (
      ${table.outcomeKind} = 'accepted'
      and ${table.completionSource} in ('provider_result', 'provider_observation')
      and isfinite(${table.completedAt})
      and ${table.completedAt} >= ${table.openedAt}
      and (${table.completionSource} = 'provider_observation'
        or ${table.completedAt} <= ${table.leaseExpiresAt})
      and ${table.retryAt} is null
      and (${table.providerAcknowledgementToken} is null
        or ${routingTokenSql(table.providerAcknowledgementToken)})
      and ${table.diagnosticCodeId} is null
      and ${table.diagnosticRetryable} is null
      and ${table.diagnosticCorrelationToken} is null
      and ${table.diagnosticSafeOperatorHintId} is null
      and ${table.unknownRequiredAction} is null
      and ${table.revision} = 2
    ) or (
      ${table.outcomeKind} = 'retryable_failure'
      and ${table.completionSource} in ('provider_result', 'preflight_blocked')
      and isfinite(${table.completedAt})
      and ${table.completedAt} between ${table.openedAt} and ${table.leaseExpiresAt}
      and isfinite(${table.retryAt})
      and ${table.retryAt} >= ${table.completedAt}
      and ${table.providerAcknowledgementToken} is null
      and ${safeDiagnostic}
      and ${table.diagnosticRetryable}
      and ${table.unknownRequiredAction} is null
      and ${table.revision} = 2
    ) or (
      ${table.outcomeKind} = 'terminal_failure'
      and ${table.completionSource} in ('provider_result', 'preflight_blocked')
      and isfinite(${table.completedAt})
      and ${table.completedAt} between ${table.openedAt} and ${table.leaseExpiresAt}
      and ${table.retryAt} is null
      and ${table.providerAcknowledgementToken} is null
      and ${safeDiagnostic}
      and not ${table.diagnosticRetryable}
      and ${table.unknownRequiredAction} is null
      and ${table.revision} = 2
    ) or (
      ${table.outcomeKind} = 'outcome_unknown'
      and ${table.completionSource} in ('provider_result', 'lease_expired')
      and isfinite(${table.completedAt})
      and ${table.completedAt} >= ${table.openedAt}
      and (
        (${table.completionSource} = 'provider_result'
          and ${table.completedAt} <= ${table.leaseExpiresAt})
        or (${table.completionSource} = 'lease_expired'
          and ${table.completedAt} >= ${table.leaseExpiresAt})
      )
      and ${table.retryAt} is null
      and ${table.providerAcknowledgementToken} is null
      and ${safeDiagnostic}
      and (
        (${table.automaticRetryAllowed}
          and ${table.diagnosticCodeId} <>
            'core:provider-artifact-outcomes-mixed'
          and ${table.unknownRequiredAction} = 'automated_reconciliation_required')
        or ((not ${table.automaticRetryAllowed}
            or ${table.diagnosticCodeId} =
              'core:provider-artifact-outcomes-mixed')
          and ${table.unknownRequiredAction} = 'operator_duplicate_risk_decision_required')
      )
      and ${table.revision} = 2
    )) is true`;
}

function reconciliationResultSql(table: Record<string, SQLWrapper>) {
  const safeDiagnostic = sql`${catalogIdSql(table.diagnosticCodeId)}
    and ${table.diagnosticRetryable} is not null
    and ${routingTokenSql(table.diagnosticCorrelationToken)}
    and (${table.diagnosticSafeOperatorHintId} is null
      or ${catalogIdSql(table.diagnosticSafeOperatorHintId)})`;

  return sql`((
      ${table.resultState} = 'accepted'
      and (${table.providerAcknowledgementToken} is null
        or ${routingTokenSql(table.providerAcknowledgementToken)})
      and ${table.retryAt} is null
      and ${table.diagnosticCodeId} is null
      and ${table.diagnosticRetryable} is null
      and ${table.diagnosticCorrelationToken} is null
      and ${table.diagnosticSafeOperatorHintId} is null
    ) or (
      ${table.resultState} = 'terminal_failure'
      and ${table.providerAcknowledgementToken} is null
      and ${table.retryAt} is null
      and ${safeDiagnostic}
      and not ${table.diagnosticRetryable}
    ) or (
      ${table.resultState} = 'retryable_failure'
      and ${table.providerAcknowledgementToken} is null
      and isfinite(${table.retryAt})
      and ${table.retryAt} >= ${table.decidedAt}
      and ${safeDiagnostic}
      and ${table.diagnosticRetryable}
    )) is true`;
}

function reconciliationAuthorizationSql(table: Record<string, SQLWrapper>) {
  const noOperatorAuthorization = sql`${table.authorizationEpoch} is null
    and ${table.retryAuthorizationEmployeeId} is null
    and ${table.duplicateRiskAcknowledged} is null
    and ${table.retryReasonId} is null
    and ${table.retryReason} is null
    and ${table.operatorAuthorizationSnapshot} is null
    and ${table.operatorAuthorizationDecisionToken} is null
    and ${table.operatorAuthorizationDecisionRevision} is null
    and ${table.operatorAuthorizationLoadedByTrustedServiceId} is null
    and ${table.operatorAuthorizationDecidedAt} is null
    and ${table.operatorAuthorizationNotAfter} is null
    and ${table.matchedPermissionCount} = 0
    and ${table.matchedPermissionsDigestSha256} is null`;
  const operatorSnapshotParity = sql`(
    ${table.operatorAuthorizationSnapshot} ?& array[
      'tenantId', 'employee', 'dispatch', 'route', 'unknownAttempt',
      'requiredPermissionId', 'authorizationEpoch', 'effect',
      'matchedPermissionIds', 'decisionToken', 'decisionRevision',
      'loadedByTrustedServiceId', 'decidedAt', 'notAfter'
    ]::text[]
    and ${table.operatorAuthorizationSnapshot} - array[
      'tenantId', 'employee', 'dispatch', 'route', 'unknownAttempt',
      'requiredPermissionId', 'authorizationEpoch', 'effect',
      'matchedPermissionIds', 'decisionToken', 'decisionRevision',
      'loadedByTrustedServiceId', 'decidedAt', 'notAfter'
    ]::text[] = '{}'::jsonb
    and ${table.operatorAuthorizationSnapshot} #>> '{tenantId}' = ${table.tenantId}
    and ${table.operatorAuthorizationSnapshot} #> '{employee}' =
      jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'employee',
        'id', ${table.retryAuthorizationEmployeeId}
      )
    and ${table.operatorAuthorizationSnapshot} #> '{dispatch}' =
      jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'outbound_dispatch',
        'id', ${table.dispatchId}
      )
    and ${table.operatorAuthorizationSnapshot} #> '{route}' =
      jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'outbound_route',
        'id', ${table.routeId}
      )
    and ${table.operatorAuthorizationSnapshot} #> '{unknownAttempt}' =
      jsonb_build_object(
        'tenantId', ${table.tenantId},
        'kind', 'outbound_dispatch_attempt',
        'id', ${table.unknownAttemptId}
      )
    and ${table.operatorAuthorizationSnapshot} #>> '{requiredPermissionId}' =
      'core:outbound_dispatch.duplicate-risk-retry'
    and ${table.operatorAuthorizationSnapshot} #>> '{authorizationEpoch}' =
      ${table.authorizationEpoch}
    and ${table.operatorAuthorizationSnapshot} #>> '{effect}' = 'allow'
    and jsonb_typeof(${table.operatorAuthorizationSnapshot} #>
      '{matchedPermissionIds}') = 'array'
    and jsonb_array_length(${table.operatorAuthorizationSnapshot} #>
      '{matchedPermissionIds}') = ${table.matchedPermissionCount}
    and (${table.operatorAuthorizationSnapshot} #> '{matchedPermissionIds}') @>
      '["core:outbound_dispatch.duplicate-risk-retry"]'::jsonb
    and ${table.operatorAuthorizationSnapshot} #>> '{decisionToken}' =
      ${table.operatorAuthorizationDecisionToken}
    and ${table.operatorAuthorizationSnapshot} #>> '{decisionRevision}' =
      ${table.operatorAuthorizationDecisionRevision}::text
    and ${table.operatorAuthorizationSnapshot} #>>
      '{loadedByTrustedServiceId}' =
      ${table.operatorAuthorizationLoadedByTrustedServiceId}
    and (${table.operatorAuthorizationSnapshot} #>>
      '{decidedAt}')::timestamptz = ${table.operatorAuthorizationDecidedAt}
    and (${table.operatorAuthorizationSnapshot} #>>
      '{notAfter}')::timestamptz = ${table.operatorAuthorizationNotAfter}
  )`;

  return sql`((
      ${table.resultState} <> 'retryable_failure'
      and ${table.retryAuthorizationKind} = 'not_applicable'
      and ${noOperatorAuthorization}
    ) or (
      ${table.resultState} = 'retryable_failure'
      and ${table.retryAuthorizationKind} = 'automatic'
      and ${table.decidedByKind} = 'trusted_service'
      and ${noOperatorAuthorization}
    ) or (
      ${table.resultState} = 'retryable_failure'
      and ${table.retryAuthorizationKind} = 'employee_duplicate_risk_override'
      and ${table.decidedByKind} = 'employee'
      and ${table.retryAuthorizationEmployeeId} = ${table.decidedByEmployeeId}
      and ${table.duplicateRiskAcknowledged}
      and ${authorizationEpochSql(table.authorizationEpoch)}
      and ${catalogIdSql(table.retryReasonId)}
      and char_length(${table.retryReason}) between 1 and 500
      and ${table.retryReason} ~ '[^[:space:]]'
      and ${boundedJsonObjectSql(table.operatorAuthorizationSnapshot, 32_768)}
      and ${operatorSnapshotParity}
      and ${routingTokenSql(table.operatorAuthorizationDecisionToken)}
      and ${table.operatorAuthorizationDecisionRevision} >= 1
      and ${catalogIdSql(table.operatorAuthorizationLoadedByTrustedServiceId)}
      and isfinite(${table.operatorAuthorizationDecidedAt})
      and isfinite(${table.operatorAuthorizationNotAfter})
      and ${table.operatorAuthorizationDecidedAt} <= ${table.decidedAt}
      and ${table.operatorAuthorizationNotAfter} >= ${table.decidedAt}
      and ${table.matchedPermissionCount} between 1 and 64
      and ${sha256DigestSql(table.matchedPermissionsDigestSha256)}
    )) is true`;
}
