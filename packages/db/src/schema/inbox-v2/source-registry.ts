import { sql, type SQL, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
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
  channelAuthChallenges,
  channelConnectors,
  channelSessions,
  employees,
  sourceAccounts,
  sourceConnections,
  tenantSecrets,
  tenants
} from "../tables";
import {
  inboxV2AuthorizationCommandRecords,
  inboxV2AuthorizationResourceHeads
} from "./authorization-relations";
import {
  inboxV2DataGovernanceControlSetHeads,
  inboxV2DataGovernanceDataUseLineages,
  inboxV2DataGovernanceEffectivePolicies,
  inboxV2DataGovernanceEffectivePolicyRules
} from "./data-governance-privacy";
import {
  inboxV2SourceAccountIdentityState,
  inboxV2SourceAccountIdentityTransitions,
  inboxV2SourceAccountIdentityVerifiedSnapshots
} from "./source-account-identity";

export const inboxV2SourceRegistryAuthorityKind = pgEnum(
  "inbox_v2_source_registry_authority_kind",
  [
    "source_connection",
    "source_account",
    "channel_connector",
    "channel_session",
    "channel_auth_challenge"
  ]
);

export const inboxV2SourceRegistryState = pgEnum(
  "inbox_v2_source_registry_state",
  ["pending", "active", "degraded", "disabled", "replaced", "deleted"]
);

export const inboxV2SourceRegistryTransitionIntent = pgEnum(
  "inbox_v2_source_registry_transition_intent",
  [
    "create",
    "enable",
    "disable",
    "degrade",
    "recover",
    "reconnect",
    "replace",
    "delete",
    "update_metadata"
  ]
);

export const inboxV2SourceRegistryArtifactKind = pgEnum(
  "inbox_v2_source_registry_artifact_kind",
  [
    "configuration",
    "capability",
    "metadata",
    "diagnostic",
    "catalog_registration",
    "module_registration"
  ]
);

export const inboxV2SourceRegistryRouteAuthorityState = pgEnum(
  "inbox_v2_source_registry_route_authority_state",
  ["enabled", "inbound_only", "denied"]
);

export const inboxV2SourceRegistryActorKind = pgEnum(
  "inbox_v2_source_registry_actor_kind",
  ["employee", "trusted_service"]
);

export const inboxV2SourceRegistryRelatedAuthorityKind = pgEnum(
  "inbox_v2_source_registry_related_authority_kind",
  [
    "channel_connector",
    "channel_session",
    "channel_session_event",
    "channel_auth_challenge",
    "source_ingress_route"
  ]
);

export const inboxV2SourceRegistryRelatedAuthorityStatus = pgEnum(
  "inbox_v2_source_registry_related_authority_status",
  ["active", "revoked"]
);

export const inboxV2SourceRegistryCopySlot = pgEnum(
  "inbox_v2_source_registry_copy_slot",
  [
    "source_connection_registry",
    "source_account_registry",
    "channel_connector_registry",
    "channel_session_state",
    "channel_session_event",
    "channel_auth_challenge_outcome",
    "credential_binding",
    "source_registry_artifact",
    "source_ingress_route",
    "source_catalog_registration",
    "source_module_registration"
  ]
);

const authorityTargetColumns = () => ({
  authorityId: text("authority_id").notNull(),
  authorityKind: inboxV2SourceRegistryAuthorityKind("authority_kind").notNull(),
  sourceConnectionId: text("source_connection_id").notNull(),
  sourceAccountId: text("source_account_id"),
  connectorId: text("connector_id"),
  sessionId: text("session_id"),
  authChallengeId: text("auth_challenge_id")
});

const verifiedIdentityColumns = () => ({
  accountIdentityTransitionId: text("account_identity_transition_id"),
  accountIdentityRevision: bigint("account_identity_revision", {
    mode: "bigint"
  }),
  accountGeneration: bigint("account_generation", { mode: "bigint" }),
  accountIdentityState: inboxV2SourceAccountIdentityState(
    "account_identity_state"
  ),
  accountIdentityFenceDigestSha256: text(
    "account_identity_fence_digest_sha256"
  ),
  accountCanonicalKeyDigestSha256: text("account_canonical_key_digest_sha256"),
  accountAccessResourceHeadId: text("account_access_resource_head_id"),
  accountResourceAccessRevision: bigint("account_resource_access_revision", {
    mode: "bigint"
  }),
  accountStructuralRelationRevision: bigint(
    "account_structural_relation_revision",
    { mode: "bigint" }
  )
});

function sha256Sql(value: SQLWrapper): SQL {
  return sql`${value} ~ '^[0-9a-f]{64}$'`;
}

function authorityTargetShapeSql(table: {
  authorityKind: SQLWrapper;
  sourceAccountId: SQLWrapper;
  connectorId: SQLWrapper;
  sessionId: SQLWrapper;
  authChallengeId: SQLWrapper;
}): SQL {
  return sql`(
      ${table.authorityKind} = 'source_connection'
      and num_nonnulls(${table.sourceAccountId}, ${table.connectorId}, ${table.sessionId}, ${table.authChallengeId}) = 0
    ) or (
      ${table.authorityKind} = 'source_account'
      and ${table.sourceAccountId} is not null
      and num_nonnulls(${table.connectorId}, ${table.sessionId}, ${table.authChallengeId}) = 0
    ) or (
      ${table.authorityKind} = 'channel_connector'
      and ${table.connectorId} is not null
      and num_nonnulls(${table.sourceAccountId}, ${table.sessionId}, ${table.authChallengeId}) = 0
    ) or (
      ${table.authorityKind} = 'channel_session'
      and ${table.connectorId} is not null
      and ${table.sessionId} is not null
      and num_nonnulls(${table.sourceAccountId}, ${table.authChallengeId}) = 0
    ) or (
      ${table.authorityKind} = 'channel_auth_challenge'
      and ${table.connectorId} is not null
      and ${table.authChallengeId} is not null
      and num_nonnulls(${table.sourceAccountId}, ${table.sessionId}) = 0
    )`;
}

function verifiedIdentityShapeSql(table: {
  sourceAccountId: SQLWrapper;
  accountIdentityTransitionId: SQLWrapper;
  accountIdentityRevision: SQLWrapper;
  accountGeneration: SQLWrapper;
  accountIdentityState: SQLWrapper;
  accountIdentityFenceDigestSha256: SQLWrapper;
  accountCanonicalKeyDigestSha256: SQLWrapper;
  accountAccessResourceHeadId: SQLWrapper;
  accountResourceAccessRevision: SQLWrapper;
  accountStructuralRelationRevision: SQLWrapper;
  routeAuthorityState: SQLWrapper;
}): SQL {
  return sql`(
      ${table.sourceAccountId} is null
      and num_nonnulls(
        ${table.accountIdentityTransitionId},
        ${table.accountIdentityRevision},
        ${table.accountGeneration},
        ${table.accountIdentityState},
        ${table.accountIdentityFenceDigestSha256},
        ${table.accountCanonicalKeyDigestSha256}
      ) = 0
      and num_nonnulls(
        ${table.accountAccessResourceHeadId},
        ${table.accountResourceAccessRevision},
        ${table.accountStructuralRelationRevision}
      ) = 0
    ) or (
      ${table.sourceAccountId} is not null
      and num_nonnulls(
        ${table.accountIdentityTransitionId},
        ${table.accountIdentityRevision},
        ${table.accountGeneration},
        ${table.accountIdentityState},
        ${table.accountIdentityFenceDigestSha256}
      ) = 5
      and ${table.accountIdentityRevision} >= 1
      and ${table.accountGeneration} >= 1
      and ${sha256Sql(table.accountIdentityFenceDigestSha256)}
      and (
        (${table.accountIdentityState} = 'verified' and ${table.accountCanonicalKeyDigestSha256} is not null and ${sha256Sql(table.accountCanonicalKeyDigestSha256)})
        or (${table.accountIdentityState} <> 'verified' and ${table.accountCanonicalKeyDigestSha256} is null)
      )
      and (
        (
          ${table.routeAuthorityState} in ('enabled', 'inbound_only')
          and num_nonnulls(
            ${table.accountAccessResourceHeadId},
            ${table.accountResourceAccessRevision},
            ${table.accountStructuralRelationRevision}
          ) = 3
          and ${table.accountResourceAccessRevision} >= 1
          and ${table.accountStructuralRelationRevision} >= 1
        ) or (
          ${table.routeAuthorityState} = 'denied'
          and num_nonnulls(
            ${table.accountAccessResourceHeadId},
            ${table.accountResourceAccessRevision},
            ${table.accountStructuralRelationRevision}
          ) in (0, 3)
        )
      )
      and (${table.routeAuthorityState} <> 'enabled' or ${table.accountIdentityState} = 'verified')
    )`;
}

function actorShapeSql(input: {
  kind: SQLWrapper;
  employeeId: SQLWrapper;
  trustedServiceId: SQLWrapper;
  authorizationEpoch: SQLWrapper;
}): SQL {
  return sql`(
      ${input.kind} = 'employee'
      and ${input.employeeId} is not null
      and ${input.trustedServiceId} is null
      and ${input.authorizationEpoch} is not null
      and char_length(${input.authorizationEpoch}) between 8 and 1024
      and ${input.authorizationEpoch} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    ) or (
      ${input.kind} = 'trusted_service'
      and ${input.employeeId} is null
      and ${input.trustedServiceId} is not null
      and ${input.authorizationEpoch} is null
    )`;
}

const authorityLifecycleColumns = () => ({
  authorityCopySlot: inboxV2SourceRegistryCopySlot(
    "authority_copy_slot"
  ).notNull(),
  authorityRegistryId: text("authority_registry_id").notNull(),
  authorityRegistryCompositionHash: text(
    "authority_registry_composition_hash"
  ).notNull(),
  authorityRegistryRevision: bigint("authority_registry_revision", {
    mode: "bigint"
  }).notNull(),
  authorityDataClassId: text("authority_data_class_id").notNull(),
  authorityStorageRootId: text("authority_storage_root_id").notNull(),
  authorityPurposeId: text("authority_purpose_id").notNull(),
  authorityCanonicalAnchorId: text("authority_canonical_anchor_id").notNull(),
  authorityLineageRevision: bigint("authority_lineage_revision", {
    mode: "bigint"
  }).notNull(),
  authorityEffectivePolicyId: text("authority_effective_policy_id").notNull(),
  authorityEffectivePolicyVersion: bigint(
    "authority_effective_policy_version",
    { mode: "bigint" }
  ).notNull(),
  authorityEffectiveRuleId: text("authority_effective_rule_id").notNull(),
  authorityEffectiveRuleRevision: bigint("authority_effective_rule_revision", {
    mode: "bigint"
  }).notNull(),
  authorityPolicyActivationId: text("authority_policy_activation_id").notNull(),
  authorityPolicyActivationRevision: bigint(
    "authority_policy_activation_revision",
    { mode: "bigint" }
  ).notNull(),
  authorityPolicyActivationHeadRevision: bigint(
    "authority_policy_activation_head_revision",
    { mode: "bigint" }
  ).notNull(),
  authorityLegalHoldSetRevision: bigint("authority_legal_hold_set_revision", {
    mode: "bigint"
  }).notNull(),
  authorityRestrictionSetRevision: bigint(
    "authority_restriction_set_revision",
    { mode: "bigint" }
  ).notNull()
});

function authorityLifecycleShapeSql(table: {
  authorityKind: SQLWrapper;
  authorityCopySlot: SQLWrapper;
  authorityRegistryCompositionHash: SQLWrapper;
  authorityRegistryRevision: SQLWrapper;
  authorityLineageRevision: SQLWrapper;
  authorityEffectivePolicyVersion: SQLWrapper;
  authorityEffectiveRuleRevision: SQLWrapper;
  authorityPolicyActivationRevision: SQLWrapper;
  authorityPolicyActivationHeadRevision: SQLWrapper;
  authorityLegalHoldSetRevision: SQLWrapper;
  authorityRestrictionSetRevision: SQLWrapper;
}): SQL {
  return sql`${sha256Sql(table.authorityRegistryCompositionHash)}
    and ${table.authorityRegistryRevision} >= 1
    and ${table.authorityLineageRevision} >= 1
    and ${table.authorityEffectivePolicyVersion} >= 1
    and ${table.authorityEffectiveRuleRevision} >= 1
    and ${table.authorityPolicyActivationRevision} >= 1
    and ${table.authorityPolicyActivationHeadRevision} >= 1
    and ${table.authorityLegalHoldSetRevision} >= 0
    and ${table.authorityRestrictionSetRevision} >= 0
    and (
      (${table.authorityKind} = 'source_connection' and ${table.authorityCopySlot} = 'source_connection_registry')
      or (${table.authorityKind} = 'source_account' and ${table.authorityCopySlot} = 'source_account_registry')
      or (${table.authorityKind} = 'channel_connector' and ${table.authorityCopySlot} = 'channel_connector_registry')
      or (${table.authorityKind} = 'channel_session' and ${table.authorityCopySlot} = 'channel_session_state')
      or (${table.authorityKind} = 'channel_auth_challenge' and ${table.authorityCopySlot} = 'channel_auth_challenge_outcome')
    )`;
}

/** Immutable transition evidence. The mutable current authority is the head below. */
export const inboxV2SourceRegistryTransitions = pgTable(
  "inbox_v2_source_registry_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    transitionId: text("transition_id").notNull(),
    ...authorityTargetColumns(),
    intent: inboxV2SourceRegistryTransitionIntent("intent").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    expectedRouteGeneration: bigint("expected_route_generation", {
      mode: "bigint"
    }),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    fromState: inboxV2SourceRegistryState("from_state"),
    toState: inboxV2SourceRegistryState("to_state").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    routeAuthorityState: inboxV2SourceRegistryRouteAuthorityState(
      "route_authority_state"
    ).notNull(),
    routeAuthorityReasonCodeId: text(
      "route_authority_reason_code_id"
    ).notNull(),
    routeAuthorityChangedAt: timestamp("route_authority_changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    ...verifiedIdentityColumns(),
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
    adapterHandlerId: text("adapter_handler_id"),
    ...authorityLifecycleColumns(),
    transitionDigestSha256: text("transition_digest_sha256").notNull(),
    createdByActorKind: inboxV2SourceRegistryActorKind(
      "created_by_actor_kind"
    ).notNull(),
    createdByEmployeeId: text("created_by_employee_id"),
    createdByTrustedServiceId: text("created_by_trusted_service_id"),
    createdByAuthorizationEpoch: text("created_by_authorization_epoch"),
    authorityCreatedAt: timestamp("authority_created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    actorKind: inboxV2SourceRegistryActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorTrustedServiceId: text("actor_trusted_service_id"),
    actorAuthorizationEpoch: text("actor_authorization_epoch"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_registry_transitions_pk",
      columns: [table.tenantId, table.transitionId]
    }),
    unique("inbox_v2_source_registry_transitions_revision_unique").on(
      table.tenantId,
      table.authorityId,
      table.resultingRevision
    ),
    unique("inbox_v2_source_registry_transitions_authority_revision_unique").on(
      table.tenantId,
      table.transitionId,
      table.authorityId,
      table.resultingRevision
    ),
    unique("inbox_v2_source_registry_transitions_head_unique").on(
      table.tenantId,
      table.transitionId,
      table.authorityId,
      table.resultingRevision,
      table.toState,
      table.routeGeneration
    ),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_account_fk",
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
      name: "inbox_v2_source_registry_transitions_connector_fk",
      columns: [table.tenantId, table.connectorId, table.sourceConnectionId],
      foreignColumns: [
        channelConnectors.tenantId,
        channelConnectors.id,
        channelConnectors.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_session_fk",
      columns: [table.tenantId, table.sessionId, table.connectorId],
      foreignColumns: [
        channelSessions.tenantId,
        channelSessions.id,
        channelSessions.connectorId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_challenge_fk",
      columns: [table.tenantId, table.authChallengeId, table.connectorId],
      foreignColumns: [
        channelAuthChallenges.tenantId,
        channelAuthChallenges.id,
        channelAuthChallenges.connectorId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_lineage_fk",
      columns: [
        table.authorityRegistryId,
        table.authorityRegistryRevision,
        table.authorityDataClassId,
        table.authorityStorageRootId,
        table.authorityPurposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_policy_fk",
      columns: [
        table.tenantId,
        table.authorityEffectivePolicyId,
        table.authorityEffectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_rule_fk",
      columns: [
        table.tenantId,
        table.authorityEffectivePolicyId,
        table.authorityEffectivePolicyVersion,
        table.authorityEffectiveRuleId,
        table.authorityEffectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_creator_fk",
      columns: [table.tenantId, table.createdByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_actor_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_access_head_fk",
      columns: [table.tenantId, table.accountAccessResourceHeadId],
      foreignColumns: [
        inboxV2AuthorizationResourceHeads.tenantId,
        inboxV2AuthorizationResourceHeads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_transitions_identity_transition_fk",
      columns: [
        table.tenantId,
        table.accountIdentityTransitionId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration
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
      name: "inbox_v2_source_registry_transitions_verified_identity_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration,
        table.accountIdentityState,
        table.accountCanonicalKeyDigestSha256
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityVerifiedSnapshots.tenantId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.sourceAccountId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.revision,
        inboxV2SourceAccountIdentityVerifiedSnapshots.accountGeneration,
        inboxV2SourceAccountIdentityVerifiedSnapshots.state,
        inboxV2SourceAccountIdentityVerifiedSnapshots.canonicalKeyDigestSha256
      ]
    }),
    check(
      "inbox_v2_source_registry_transitions_target_check",
      authorityTargetShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_transitions_identity_check",
      verifiedIdentityShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_transitions_lifecycle_check",
      authorityLifecycleShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_transitions_creator_check",
      actorShapeSql({
        kind: table.createdByActorKind,
        employeeId: table.createdByEmployeeId,
        trustedServiceId: table.createdByTrustedServiceId,
        authorizationEpoch: table.createdByAuthorizationEpoch
      })
    ),
    check(
      "inbox_v2_source_registry_transitions_actor_check",
      actorShapeSql({
        kind: table.actorKind,
        employeeId: table.actorEmployeeId,
        trustedServiceId: table.actorTrustedServiceId,
        authorizationEpoch: table.actorAuthorizationEpoch
      })
    ),
    check(
      "inbox_v2_source_registry_transitions_revision_check",
      sql`${table.expectedRevision} >= 0
        and ${table.resultingRevision} = ${table.expectedRevision} + 1
        and ${table.routeGeneration} >= 1
        and ${table.adapterDeclarationRevision} >= 1
        and isfinite(${table.adapterLoadedAt})
        and isfinite(${table.routeAuthorityChangedAt})
        and isfinite(${table.authorityCreatedAt})
        and ${table.adapterLoadedAt} <= ${table.occurredAt}
        and ${table.authorityCreatedAt} <= ${table.occurredAt}
        and ${table.routeAuthorityChangedAt} <= ${table.occurredAt}
        and (
          (${table.toState} in ('pending', 'disabled', 'replaced', 'deleted') and ${table.routeAuthorityState} = 'denied')
          or (${table.toState} in ('active', 'degraded'))
        )
        and (
          (${table.expectedRevision} = 0 and ${table.expectedRouteGeneration} is null and ${table.routeGeneration} = 1 and ${table.intent} = 'create' and ${table.fromState} is null)
          or (
            ${table.expectedRevision} >= 1
            and ${table.expectedRouteGeneration} >= 1
            and ${table.routeGeneration} between ${table.expectedRouteGeneration} and ${table.expectedRouteGeneration} + 1
            and (
              ${table.intent} not in ('enable', 'disable', 'reconnect', 'replace', 'delete')
              or ${table.routeGeneration} = ${table.expectedRouteGeneration} + 1
            )
            and ${table.intent} <> 'create'
            and ${table.fromState} is not null
          )
        )`
    ),
    check(
      "inbox_v2_source_registry_transitions_digest_check",
      sha256Sql(table.transitionDigestSha256)
    ),
    check(
      "inbox_v2_source_registry_transitions_time_check",
      sql`isfinite(${table.occurredAt})`
    ),
    index("inbox_v2_source_registry_transitions_authority_idx").on(
      table.tenantId,
      table.authorityId,
      table.resultingRevision
    )
  ]
);

/**
 * Immutable, non-sensitive command result for standalone onboarding. The
 * compatibility SourceConnection and registry head remain mutable; replay and
 * old stream references resolve exclusively through this versioned snapshot.
 */
export const inboxV2SourceOnboardingResultSnapshots = pgTable(
  "inbox_v2_source_onboarding_result_snapshots",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    commandRecordId: text("command_record_id").notNull(),
    clientMutationId: text("client_mutation_id").notNull(),
    mutationId: text("mutation_id").notNull(),
    streamCommitId: text("stream_commit_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceTransitionId: text("source_transition_id").notNull(),
    sourceRegistryRevision: bigint("source_registry_revision", {
      mode: "bigint"
    }).notNull(),
    sourceType: text("source_type").notNull(),
    sourceName: text("source_name").notNull(),
    displayName: text("display_name").notNull(),
    status: text("status").notNull(),
    authType: text("auth_type").notNull(),
    createdByEmployeeId: text("created_by_employee_id").notNull(),
    connectionCreatedAt: timestamp("connection_created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    connectionUpdatedAt: timestamp("connection_updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    resultDigestSha256: text("result_digest_sha256").notNull(),
    resultCanonicalJson: text("result_canonical_json").notNull(),
    statePayload: jsonb("state_payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    stateDigestSha256: text("state_digest_sha256").notNull(),
    stateCanonicalJson: text("state_canonical_json").notNull(),
    transitionPayload: jsonb("transition_payload")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    transitionDigestSha256: text("transition_digest_sha256").notNull(),
    transitionCanonicalJson: text("transition_canonical_json").notNull(),
    auditTargetRef: text("audit_target_ref").notNull(),
    tenantFacetRef: text("tenant_facet_ref").notNull(),
    grantSourceMappings: jsonb("grant_source_mappings")
      .$type<
        readonly Readonly<{
          internalReference: string;
          authorizationDecisionId: string;
        }>[]
      >()
      .notNull(),
    ...retainedResultLifecycleReferenceColumns(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_onboarding_result_snapshots_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_source_onboarding_results_command_unique").on(
      table.tenantId,
      table.commandRecordId
    ),
    unique("inbox_v2_source_onboarding_results_mutation_unique").on(
      table.tenantId,
      table.mutationId
    ),
    unique("inbox_v2_source_onboarding_results_source_unique").on(
      table.tenantId,
      table.sourceConnectionId
    ),
    unique("inbox_v2_source_onboarding_results_transition_unique").on(
      table.tenantId,
      table.sourceTransitionId
    ),
    unique("inbox_v2_source_onboarding_results_target_ref_unique").on(
      table.tenantId,
      table.auditTargetRef
    ),
    unique("inbox_v2_source_onboarding_results_tenant_ref_unique").on(
      table.tenantId,
      table.tenantFacetRef
    ),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_command_fk",
      columns: [table.tenantId, table.commandRecordId],
      foreignColumns: [
        inboxV2AuthorizationCommandRecords.tenantId,
        inboxV2AuthorizationCommandRecords.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_transition_fk",
      columns: [
        table.tenantId,
        table.sourceTransitionId,
        table.sourceConnectionId,
        table.sourceRegistryRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_creator_fk",
      columns: [table.tenantId, table.createdByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_policy_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_rule_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion,
        table.effectiveRuleId,
        table.effectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_onboarding_results_lineage_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    check(
      "inbox_v2_source_onboarding_results_values_check",
      sql`char_length(${table.id}) between 1 and 512
        and ${table.id} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and char_length(${table.clientMutationId}) between 1 and 512
        and ${table.clientMutationId} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${table.sourceRegistryRevision} = 1
        and char_length(${table.sourceName}) between 1 and 160
        and char_length(${table.displayName}) between 1 and 200
        and ${table.status} = 'onboarding'
        and char_length(${table.sourceType}) between 1 and 160
        and char_length(${table.authType}) between 1 and 160
        and ${table.resultDigestSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.resultCanonicalJson}::jsonb->>'protocol' is not distinct from
          'core:inbox-v2.source-onboarding-result@v1'
        and octet_length(${table.resultCanonicalJson}) <= 8388608
        and ${table.resultDigestSha256} = 'sha256:' || encode(
          sha256(convert_to(${table.resultCanonicalJson}, 'UTF8')), 'hex'
        )
        and jsonb_typeof(${table.statePayload}) = 'object'
        and ${table.stateDigestSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.stateCanonicalJson}::jsonb = ${table.statePayload}
        and octet_length(${table.stateCanonicalJson}) <= 8388608
        and ${table.stateDigestSha256} = 'sha256:' || encode(
          sha256(convert_to(${table.stateCanonicalJson}, 'UTF8')), 'hex'
        )
        and jsonb_typeof(${table.transitionPayload}) = 'object'
        and ${table.transitionDigestSha256} ~ '^sha256:[0-9a-f]{64}$'
        and ${table.transitionCanonicalJson}::jsonb = ${table.transitionPayload}
        and octet_length(${table.transitionCanonicalJson}) <= 8388608
        and ${table.transitionDigestSha256} = 'sha256:' || encode(
          sha256(convert_to(${table.transitionCanonicalJson}, 'UTF8')), 'hex'
        )
        and ${table.auditTargetRef} ~ '^internal-ref:[a-f0-9]{64}$'
        and ${table.tenantFacetRef} ~ '^internal-ref:[a-f0-9]{64}$'
        and ${table.auditTargetRef} <> ${table.tenantFacetRef}
        and jsonb_typeof(${table.grantSourceMappings}) = 'array'
        and jsonb_array_length(${table.grantSourceMappings}) between 1 and 64
        and ${table.copySlot} = 'source_onboarding_result_snapshot'
        and ${table.dataClassId} = 'core:source_account_connector_metadata'
        and ${table.storageRootId} = 'core:source-registry-sql'
        and ${table.purposeId} = 'core:source_replay_and_diagnostics'
        and ${table.canonicalAnchorId} = 'core:disconnect_or_account_termination'
        and ${table.registryRevision} >= 1
        and ${table.lineageRevision} >= 1
        and ${table.effectivePolicyVersion} >= 1
        and ${table.effectiveRuleRevision} >= 1
        and ${table.policyActivationRevision} >= 1
        and ${table.policyActivationHeadRevision} >= 1
        and ${table.legalHoldSetRevision} >= 0
        and ${table.restrictionSetRevision} >= 0
        and ${sha256Sql(table.registryCompositionHash)}
        and isfinite(${table.connectionCreatedAt})
        and isfinite(${table.connectionUpdatedAt})
        and ${table.connectionUpdatedAt} = ${table.connectionCreatedAt}
        and isfinite(${table.createdAt})
        and ${table.createdAt} = ${table.connectionCreatedAt}`
    ),
    index("inbox_v2_source_onboarding_results_time_idx").on(
      table.tenantId,
      table.createdAt,
      table.id
    ),
    index("inbox_v2_source_onboarding_results_lineage_idx").on(
      table.registryId,
      table.registryRevision,
      table.dataClassId,
      table.storageRootId,
      table.purposeId
    )
  ]
);

/** Exact current authority. A head can only project one immutable transition. */
export const inboxV2SourceRegistryHeads = pgTable(
  "inbox_v2_source_registry_heads",
  {
    tenantId: text("tenant_id").notNull(),
    ...authorityTargetColumns(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    state: inboxV2SourceRegistryState("state").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    routeAuthorityState: inboxV2SourceRegistryRouteAuthorityState(
      "route_authority_state"
    ).notNull(),
    routeAuthorityReasonCodeId: text(
      "route_authority_reason_code_id"
    ).notNull(),
    routeAuthorityChangedAt: timestamp("route_authority_changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    ...verifiedIdentityColumns(),
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
    adapterHandlerId: text("adapter_handler_id"),
    ...authorityLifecycleColumns(),
    lastTransitionId: text("last_transition_id").notNull(),
    createdByActorKind: inboxV2SourceRegistryActorKind(
      "created_by_actor_kind"
    ).notNull(),
    createdByEmployeeId: text("created_by_employee_id"),
    createdByTrustedServiceId: text("created_by_trusted_service_id"),
    createdByAuthorizationEpoch: text("created_by_authorization_epoch"),
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
      name: "inbox_v2_source_registry_heads_pk",
      columns: [table.tenantId, table.authorityId]
    }),
    unique("inbox_v2_source_registry_heads_revision_unique").on(
      table.tenantId,
      table.authorityId,
      table.revision
    ),
    foreignKey({
      name: "inbox_v2_source_registry_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_account_fk",
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
      name: "inbox_v2_source_registry_heads_connector_fk",
      columns: [table.tenantId, table.connectorId, table.sourceConnectionId],
      foreignColumns: [
        channelConnectors.tenantId,
        channelConnectors.id,
        channelConnectors.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_session_fk",
      columns: [table.tenantId, table.sessionId, table.connectorId],
      foreignColumns: [
        channelSessions.tenantId,
        channelSessions.id,
        channelSessions.connectorId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_challenge_fk",
      columns: [table.tenantId, table.authChallengeId, table.connectorId],
      foreignColumns: [
        channelAuthChallenges.tenantId,
        channelAuthChallenges.id,
        channelAuthChallenges.connectorId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_lineage_fk",
      columns: [
        table.authorityRegistryId,
        table.authorityRegistryRevision,
        table.authorityDataClassId,
        table.authorityStorageRootId,
        table.authorityPurposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_policy_fk",
      columns: [
        table.tenantId,
        table.authorityEffectivePolicyId,
        table.authorityEffectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_rule_fk",
      columns: [
        table.tenantId,
        table.authorityEffectivePolicyId,
        table.authorityEffectivePolicyVersion,
        table.authorityEffectiveRuleId,
        table.authorityEffectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_creator_fk",
      columns: [table.tenantId, table.createdByEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_access_head_fk",
      columns: [table.tenantId, table.accountAccessResourceHeadId],
      foreignColumns: [
        inboxV2AuthorizationResourceHeads.tenantId,
        inboxV2AuthorizationResourceHeads.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_identity_transition_fk",
      columns: [
        table.tenantId,
        table.accountIdentityTransitionId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration
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
      name: "inbox_v2_source_registry_heads_verified_identity_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.accountIdentityRevision,
        table.accountGeneration,
        table.accountIdentityState,
        table.accountCanonicalKeyDigestSha256
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityVerifiedSnapshots.tenantId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.sourceAccountId,
        inboxV2SourceAccountIdentityVerifiedSnapshots.revision,
        inboxV2SourceAccountIdentityVerifiedSnapshots.accountGeneration,
        inboxV2SourceAccountIdentityVerifiedSnapshots.state,
        inboxV2SourceAccountIdentityVerifiedSnapshots.canonicalKeyDigestSha256
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_heads_transition_fk",
      columns: [
        table.tenantId,
        table.lastTransitionId,
        table.authorityId,
        table.revision,
        table.state,
        table.routeGeneration
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision,
        inboxV2SourceRegistryTransitions.toState,
        inboxV2SourceRegistryTransitions.routeGeneration
      ]
    }),
    check(
      "inbox_v2_source_registry_heads_target_check",
      authorityTargetShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_heads_identity_check",
      verifiedIdentityShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_heads_lifecycle_check",
      authorityLifecycleShapeSql(table)
    ),
    check(
      "inbox_v2_source_registry_heads_creator_check",
      actorShapeSql({
        kind: table.createdByActorKind,
        employeeId: table.createdByEmployeeId,
        trustedServiceId: table.createdByTrustedServiceId,
        authorizationEpoch: table.createdByAuthorizationEpoch
      })
    ),
    check(
      "inbox_v2_source_registry_heads_values_check",
      sql`${table.revision} >= 1
        and ${table.routeGeneration} >= 1
        and ${table.adapterDeclarationRevision} >= 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and isfinite(${table.adapterLoadedAt})
        and isfinite(${table.routeAuthorityChangedAt})
        and ${table.adapterLoadedAt} <= ${table.createdAt}
        and ${table.createdAt} <= ${table.routeAuthorityChangedAt}
        and ${table.routeAuthorityChangedAt} <= ${table.updatedAt}
        and (
          (${table.state} in ('pending', 'disabled', 'replaced', 'deleted') and ${table.routeAuthorityState} = 'denied')
          or (${table.state} in ('active', 'degraded'))
        )
        and ${table.createdAt} <= ${table.updatedAt}`
    ),
    uniqueIndex("inbox_v2_source_registry_heads_connection_unique")
      .on(table.tenantId, table.sourceConnectionId)
      .where(sql`${table.authorityKind} = 'source_connection'`),
    uniqueIndex("inbox_v2_source_registry_heads_account_unique")
      .on(table.tenantId, table.sourceAccountId)
      .where(sql`${table.authorityKind} = 'source_account'`),
    uniqueIndex("inbox_v2_source_registry_heads_connector_unique")
      .on(table.tenantId, table.connectorId)
      .where(sql`${table.authorityKind} = 'channel_connector'`),
    uniqueIndex("inbox_v2_source_registry_heads_session_unique")
      .on(table.tenantId, table.sessionId)
      .where(sql`${table.authorityKind} = 'channel_session'`),
    uniqueIndex("inbox_v2_source_registry_heads_challenge_unique")
      .on(table.tenantId, table.authChallengeId)
      .where(sql`${table.authorityKind} = 'channel_auth_challenge'`),
    index("inbox_v2_source_registry_heads_state_idx").on(
      table.tenantId,
      table.state,
      table.authorityKind
    )
  ]
);

function lifecycleReferenceColumns() {
  return {
    copySlot: inboxV2SourceRegistryCopySlot("copy_slot").notNull(),
    ...lifecycleReferenceAuthorityColumns()
  };
}

function retainedResultLifecycleReferenceColumns() {
  return {
    copySlot: text("copy_slot").notNull(),
    ...lifecycleReferenceAuthorityColumns()
  };
}

function lifecycleReferenceAuthorityColumns() {
  return {
    registryId: text("registry_id").notNull(),
    registryCompositionHash: text("registry_composition_hash").notNull(),
    registryRevision: bigint("registry_revision", {
      mode: "bigint"
    }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    purposeId: text("purpose_id").notNull(),
    canonicalAnchorId: text("canonical_anchor_id").notNull(),
    lineageRevision: bigint("lineage_revision", { mode: "bigint" }).notNull(),
    effectivePolicyId: text("effective_policy_id").notNull(),
    effectivePolicyVersion: bigint("effective_policy_version", {
      mode: "bigint"
    }).notNull(),
    effectiveRuleId: text("effective_rule_id").notNull(),
    effectiveRuleRevision: bigint("effective_rule_revision", {
      mode: "bigint"
    }).notNull(),
    policyActivationId: text("policy_activation_id").notNull(),
    policyActivationRevision: bigint("policy_activation_revision", {
      mode: "bigint"
    }).notNull(),
    policyActivationHeadRevision: bigint("policy_activation_head_revision", {
      mode: "bigint"
    }).notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull()
  };
}

/** Typed envelope pointer only; provider JSON/content is stored behind the classified ref. */
export const inboxV2SourceRegistryArtifactRefs = pgTable(
  "inbox_v2_source_registry_artifact_refs",
  {
    tenantId: text("tenant_id").notNull(),
    authorityId: text("authority_id").notNull(),
    authorityRevision: bigint("authority_revision", {
      mode: "bigint"
    }).notNull(),
    transitionId: text("transition_id").notNull(),
    artifactKind: inboxV2SourceRegistryArtifactKind("artifact_kind").notNull(),
    payloadRecordId: text("payload_record_id").notNull(),
    payloadSchemaId: text("payload_schema_id").notNull(),
    payloadSchemaVersion: text("payload_schema_version").notNull(),
    payloadDigestSha256: text("payload_digest_sha256").notNull(),
    ...lifecycleReferenceColumns(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_registry_artifact_refs_pk",
      columns: [
        table.tenantId,
        table.authorityId,
        table.authorityRevision,
        table.artifactKind
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_artifact_refs_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.authorityId,
        table.authorityRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_artifact_refs_policy_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_artifact_refs_rule_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion,
        table.effectiveRuleId,
        table.effectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_artifact_refs_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_artifact_refs_lineage_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    check(
      "inbox_v2_source_registry_artifact_refs_values_check",
      sql`${table.authorityRevision} >= 1
        and ${table.lineageRevision} >= 1
        and ${table.effectivePolicyVersion} >= 1
        and ${table.effectiveRuleRevision} >= 1
        and ${table.policyActivationRevision} >= 1
        and ${table.policyActivationHeadRevision} >= 1
        and ${table.legalHoldSetRevision} >= 0
        and ${table.restrictionSetRevision} >= 0
        and ${sha256Sql(table.registryCompositionHash)}
        and ${sha256Sql(table.payloadDigestSha256)}
        and (
          (${table.artifactKind} = 'catalog_registration' and ${table.copySlot} = 'source_catalog_registration')
          or (${table.artifactKind} = 'module_registration' and ${table.copySlot} = 'source_module_registration')
          or (${table.artifactKind} not in ('catalog_registration', 'module_registration') and ${table.copySlot} = 'source_registry_artifact')
        )
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_source_registry_artifact_refs_lineage_idx").on(
      table.registryId,
      table.registryRevision,
      table.dataClassId,
      table.storageRootId,
      table.purposeId
    )
  ]
);

/** Revocable binding to the tenant secret store. No ciphertext is accepted here. */
export const inboxV2SourceRegistrySecretRefs = pgTable(
  "inbox_v2_source_registry_secret_refs",
  {
    tenantId: text("tenant_id").notNull(),
    authorityId: text("authority_id").notNull(),
    authorityRevision: bigint("authority_revision", {
      mode: "bigint"
    }).notNull(),
    transitionId: text("transition_id").notNull(),
    bindingId: text("binding_id").notNull(),
    bindingRevision: bigint("binding_revision", { mode: "bigint" }).notNull(),
    secretRef: text("secret_ref").notNull(),
    ...lifecycleReferenceColumns(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    revokedByTransitionId: text("revoked_by_transition_id")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_registry_secret_refs_pk",
      columns: [
        table.tenantId,
        table.authorityId,
        table.authorityRevision,
        table.bindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.authorityId,
        table.authorityRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_policy_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_rule_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion,
        table.effectiveRuleId,
        table.effectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_secret_fk",
      columns: [table.tenantId, table.secretRef],
      foreignColumns: [tenantSecrets.tenantId, tenantSecrets.secretRef]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_revocation_fk",
      columns: [table.tenantId, table.revokedByTransitionId],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_secret_refs_lineage_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    check(
      "inbox_v2_source_registry_secret_refs_values_check",
      sql`${table.authorityRevision} >= 1
        and ${table.bindingRevision} >= 1
        and ${table.lineageRevision} >= 1
        and ${table.effectivePolicyVersion} >= 1
        and ${table.effectiveRuleRevision} >= 1
        and ${table.policyActivationRevision} >= 1
        and ${table.policyActivationHeadRevision} >= 1
        and ${table.legalHoldSetRevision} >= 0
        and ${table.restrictionSetRevision} >= 0
        and ${table.copySlot} = 'credential_binding'
        and ${sha256Sql(table.registryCompositionHash)}
        and isfinite(${table.createdAt})
        and (
          (${table.revokedAt} is null and ${table.revokedByTransitionId} is null)
          or (${table.revokedAt} is not null and isfinite(${table.revokedAt}) and ${table.revokedByTransitionId} is not null and ${table.createdAt} <= ${table.revokedAt})
        )`
    ),
    index("inbox_v2_source_registry_secret_refs_current_idx").on(
      table.tenantId,
      table.authorityId,
      table.bindingId,
      table.revokedAt
    )
  ]
);

/** Public callback capability lookup. Only the SHA-256/HMAC digest is durable. */
export const inboxV2SourceRegistryIngressRoutes = pgTable(
  "inbox_v2_source_registry_ingress_routes",
  {
    tenantId: text("tenant_id").notNull(),
    routeId: text("route_id").notNull(),
    routeRevision: bigint("route_revision", { mode: "bigint" }).notNull(),
    routeDigestSha256: text("route_digest_sha256").notNull(),
    parentAuthorityId: text("parent_authority_id").notNull(),
    parentAuthorityRevision: bigint("parent_authority_revision", {
      mode: "bigint"
    }).notNull(),
    parentTransitionId: text("parent_transition_id").notNull(),
    routeGeneration: bigint("route_generation", { mode: "bigint" }).notNull(),
    adapterHandlerId: text("adapter_handler_id").notNull(),
    ...lifecycleReferenceColumns(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    invalidatedAt: timestamp("invalidated_at", {
      withTimezone: true,
      precision: 3
    }),
    invalidatedByTransitionId: text("invalidated_by_transition_id"),
    invalidationReasonCode: text("invalidation_reason_code")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_registry_ingress_routes_pk",
      columns: [table.tenantId, table.routeId, table.routeRevision]
    }),
    unique("inbox_v2_source_registry_ingress_routes_digest_unique").on(
      table.routeDigestSha256
    ),
    unique("inbox_v2_source_registry_ingress_routes_authority_unique").on(
      table.tenantId,
      table.routeId,
      table.routeRevision,
      table.parentAuthorityId,
      table.routeGeneration
    ),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_transition_fk",
      columns: [
        table.tenantId,
        table.parentTransitionId,
        table.parentAuthorityId,
        table.parentAuthorityRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_policy_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_rule_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion,
        table.effectiveRuleId,
        table.effectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_lineage_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_ingress_routes_invalidation_fk",
      columns: [table.tenantId, table.invalidatedByTransitionId],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId
      ]
    }),
    check(
      "inbox_v2_source_registry_ingress_routes_values_check",
      sql`${table.routeRevision} >= 1
        and ${table.parentAuthorityRevision} >= 1
        and ${table.routeGeneration} >= 1
        and ${sha256Sql(table.routeDigestSha256)}
        and ${table.copySlot} = 'source_ingress_route'
        and ${table.lineageRevision} >= 1
        and ${table.effectivePolicyVersion} >= 1
        and ${table.effectiveRuleRevision} >= 1
        and ${table.policyActivationRevision} >= 1
        and ${table.policyActivationHeadRevision} >= 1
        and ${table.legalHoldSetRevision} >= 0
        and ${table.restrictionSetRevision} >= 0
        and ${sha256Sql(table.registryCompositionHash)}
        and isfinite(${table.createdAt})
        and (
          (${table.invalidatedAt} is null and ${table.invalidatedByTransitionId} is null and ${table.invalidationReasonCode} is null)
          or (${table.invalidatedAt} is not null and isfinite(${table.invalidatedAt}) and ${table.invalidatedByTransitionId} is not null and ${table.invalidationReasonCode} is not null and ${table.createdAt} <= ${table.invalidatedAt})
        )`
    ),
    index("inbox_v2_source_registry_ingress_routes_authority_idx").on(
      table.tenantId,
      table.parentAuthorityId,
      table.parentAuthorityRevision,
      table.routeGeneration,
      table.invalidatedAt
    )
  ]
);

/** Immutable typed connector/session/challenge/route references for one parent revision. */
export const inboxV2SourceRegistryRelatedAuthorityRefs = pgTable(
  "inbox_v2_source_registry_related_authority_refs",
  {
    tenantId: text("tenant_id").notNull(),
    parentAuthorityId: text("parent_authority_id").notNull(),
    parentAuthorityRevision: bigint("parent_authority_revision", {
      mode: "bigint"
    }).notNull(),
    parentTransitionId: text("parent_transition_id").notNull(),
    kind: inboxV2SourceRegistryRelatedAuthorityKind("kind").notNull(),
    authorityId: text("authority_id").notNull(),
    authorityRevision: bigint("authority_revision", {
      mode: "bigint"
    }).notNull(),
    status: inboxV2SourceRegistryRelatedAuthorityStatus("status").notNull(),
    childTransitionId: text("child_transition_id"),
    sourceConnectionId: text("source_connection_id").notNull(),
    sourceAccountId: text("source_account_id"),
    connectorAuthorityId: text("connector_authority_id"),
    sessionAuthorityId: text("session_authority_id"),
    routeParentAuthorityId: text("route_parent_authority_id"),
    handlerGeneration: bigint("handler_generation", { mode: "bigint" }),
    ...lifecycleReferenceColumns(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_registry_related_authority_refs_pk",
      columns: [
        table.tenantId,
        table.parentAuthorityId,
        table.parentAuthorityRevision,
        table.kind,
        table.authorityId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_parent_transition_fk",
      columns: [
        table.tenantId,
        table.parentTransitionId,
        table.parentAuthorityId,
        table.parentAuthorityRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_child_transition_fk",
      columns: [
        table.tenantId,
        table.childTransitionId,
        table.authorityId,
        table.authorityRevision
      ],
      foreignColumns: [
        inboxV2SourceRegistryTransitions.tenantId,
        inboxV2SourceRegistryTransitions.transitionId,
        inboxV2SourceRegistryTransitions.authorityId,
        inboxV2SourceRegistryTransitions.resultingRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_connection_fk",
      columns: [table.tenantId, table.sourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_account_fk",
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
      name: "inbox_v2_source_registry_related_lineage_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDataUseLineages.registryId,
        inboxV2DataGovernanceDataUseLineages.registryRevision,
        inboxV2DataGovernanceDataUseLineages.dataClassId,
        inboxV2DataGovernanceDataUseLineages.storageRootId,
        inboxV2DataGovernanceDataUseLineages.purposeId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_policy_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_rule_fk",
      columns: [
        table.tenantId,
        table.effectivePolicyId,
        table.effectivePolicyVersion,
        table.effectiveRuleId,
        table.effectiveRuleRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicyRules.tenantId,
        inboxV2DataGovernanceEffectivePolicyRules.policyId,
        inboxV2DataGovernanceEffectivePolicyRules.policyVersion,
        inboxV2DataGovernanceEffectivePolicyRules.ruleId,
        inboxV2DataGovernanceEffectivePolicyRules.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_control_set_fk",
      columns: [table.tenantId],
      foreignColumns: [inboxV2DataGovernanceControlSetHeads.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_source_registry_related_ingress_route_fk",
      columns: [
        table.tenantId,
        table.authorityId,
        table.authorityRevision,
        table.routeParentAuthorityId,
        table.handlerGeneration
      ],
      foreignColumns: [
        inboxV2SourceRegistryIngressRoutes.tenantId,
        inboxV2SourceRegistryIngressRoutes.routeId,
        inboxV2SourceRegistryIngressRoutes.routeRevision,
        inboxV2SourceRegistryIngressRoutes.parentAuthorityId,
        inboxV2SourceRegistryIngressRoutes.routeGeneration
      ]
    }),
    check(
      "inbox_v2_source_registry_related_shape_check",
      sql`${table.authorityRevision} >= 1
        and ${table.lineageRevision} >= 1
        and ${table.effectivePolicyVersion} >= 1
        and ${table.effectiveRuleRevision} >= 1
        and ${table.policyActivationRevision} >= 1
        and ${table.policyActivationHeadRevision} >= 1
        and ${table.legalHoldSetRevision} >= 0
        and ${table.restrictionSetRevision} >= 0
        and ${sha256Sql(table.registryCompositionHash)}
        and isfinite(${table.createdAt})
        and (
          (${table.kind} = 'channel_connector'
            and ${table.childTransitionId} is not null
            and ${table.copySlot} = 'channel_connector_registry'
            and num_nonnulls(${table.connectorAuthorityId}, ${table.sessionAuthorityId}, ${table.routeParentAuthorityId}, ${table.handlerGeneration}) = 0)
          or (${table.kind} = 'channel_session'
            and ${table.childTransitionId} is not null
            and ${table.copySlot} = 'channel_session_state'
            and ${table.connectorAuthorityId} is not null
            and num_nonnulls(${table.sessionAuthorityId}, ${table.routeParentAuthorityId}, ${table.handlerGeneration}) = 0)
          or (${table.kind} = 'channel_session_event'
            and ${table.childTransitionId} is null
            and ${table.authorityRevision} = 1
            and ${table.copySlot} = 'channel_session_event'
            and ${table.connectorAuthorityId} is not null
            and ${table.sessionAuthorityId} is not null
            and num_nonnulls(${table.routeParentAuthorityId}, ${table.handlerGeneration}) = 0)
          or (${table.kind} = 'channel_auth_challenge'
            and ${table.childTransitionId} is not null
            and ${table.copySlot} = 'channel_auth_challenge_outcome'
            and ${table.connectorAuthorityId} is not null
            and num_nonnulls(${table.routeParentAuthorityId}, ${table.handlerGeneration}) = 0)
          or (${table.kind} = 'source_ingress_route'
            and ${table.childTransitionId} is null
            and ${table.copySlot} = 'source_ingress_route'
            and ${table.routeParentAuthorityId} = ${table.parentAuthorityId}
            and ${table.handlerGeneration} >= 1
            and num_nonnulls(${table.connectorAuthorityId}, ${table.sessionAuthorityId}) = 0)
        )`
    ),
    index("inbox_v2_source_registry_related_parent_idx").on(
      table.tenantId,
      table.parentAuthorityId,
      table.parentAuthorityRevision
    ),
    index("inbox_v2_source_registry_related_child_idx").on(
      table.tenantId,
      table.authorityId,
      table.authorityRevision,
      table.status
    )
  ]
);

/** Cross-table guards installed verbatim by migration 0039. */
export const INBOX_V2_SOURCE_REGISTRY_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_assert_source_registry_lineage(
  checked_tenant_id text,
  checked_registry_id text,
  checked_registry_revision bigint,
  checked_registry_composition_hash text,
  checked_data_class_id text,
  checked_storage_root_id text,
  checked_purpose_id text,
  checked_canonical_anchor_id text,
  checked_lineage_revision bigint,
  checked_effective_policy_id text,
  checked_effective_policy_version bigint,
  checked_effective_rule_id text,
  checked_effective_rule_revision bigint,
  checked_policy_activation_id text,
  checked_policy_activation_revision bigint,
  checked_policy_activation_head_revision bigint,
  checked_legal_hold_set_revision bigint,
  checked_restriction_set_revision bigint,
  checked_requires_export boolean
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_data_governance_registry_versions registry_row
    join public.inbox_v2_data_governance_data_use_lineages lineage_row
      on lineage_row.registry_id = registry_row.id
     and lineage_row.registry_revision = registry_row.revision
    join public.inbox_v2_data_governance_effective_policies policy_row
      on policy_row.tenant_id = checked_tenant_id
     and policy_row.policy_id = checked_effective_policy_id
     and policy_row.version = checked_effective_policy_version
     and policy_row.registry_id = registry_row.id
     and policy_row.registry_revision = registry_row.revision
    join public.inbox_v2_data_governance_effective_policy_rules rule_row
      on rule_row.tenant_id = policy_row.tenant_id
     and rule_row.policy_id = policy_row.policy_id
     and rule_row.policy_version = policy_row.version
     and rule_row.rule_id = checked_effective_rule_id
     and rule_row.rule_revision = checked_effective_rule_revision
     and rule_row.data_class_id = lineage_row.data_class_id
     and rule_row.purpose_id = lineage_row.purpose_id
     and rule_row.retention_anchor_id = lineage_row.canonical_anchor_id
    join public.inbox_v2_data_governance_policy_activation_heads activation_head
      on activation_head.tenant_id = policy_row.tenant_id
     and activation_head.policy_id = policy_row.policy_id
     and activation_head.current_policy_version = policy_row.version
     and activation_head.current_activation_id = checked_policy_activation_id
     and activation_head.current_activation_revision = checked_policy_activation_revision
     and activation_head.head_revision = checked_policy_activation_head_revision
    join public.inbox_v2_data_governance_control_set_heads control_head
      on control_head.tenant_id = policy_row.tenant_id
     and control_head.legal_hold_set_revision = checked_legal_hold_set_revision
     and control_head.restriction_set_revision = checked_restriction_set_revision
   where registry_row.id = checked_registry_id
     and registry_row.revision = checked_registry_revision
     and registry_row.composition_hash =
       'sha256:' || checked_registry_composition_hash
     and lineage_row.data_class_id = checked_data_class_id
     and lineage_row.storage_root_id = checked_storage_root_id
     and lineage_row.purpose_id = checked_purpose_id
     and lineage_row.canonical_anchor_id = checked_canonical_anchor_id
     and lineage_row.lineage_revision = checked_lineage_revision
     and lineage_row.lifecycle_handler_id is not null
     and lineage_row.delete_handler_id is not null
     and lineage_row.verification_handler_id is not null
     and (
       not checked_requires_export
       or (
         lineage_row.subject_discovery_handler_id is not null
         and lineage_row.export_projection_handler_id is not null
         and lineage_row.export_handler_id is not null
       )
     );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_lineage_incomplete_or_stale';
  end if;
end;
$function$;

create or replace function public.inbox_v2_source_registry_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_transition_immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_artifact_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_artifact_immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_related_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'inbox_v2.source_registry_related_authority_immutable';
end;
$function$;

create or replace function public.inbox_v2_source_registry_secret_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_secret_binding_immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.authority_id is distinct from old.authority_id
    or new.authority_revision is distinct from old.authority_revision
    or new.transition_id is distinct from old.transition_id
    or new.secret_ref is distinct from old.secret_ref
    or new.binding_id is distinct from old.binding_id
    or new.binding_revision is distinct from old.binding_revision
    or new.copy_slot is distinct from old.copy_slot
    or new.registry_id is distinct from old.registry_id
    or new.registry_composition_hash is distinct from old.registry_composition_hash
    or new.registry_revision is distinct from old.registry_revision
    or new.data_class_id is distinct from old.data_class_id
    or new.storage_root_id is distinct from old.storage_root_id
    or new.purpose_id is distinct from old.purpose_id
    or new.canonical_anchor_id is distinct from old.canonical_anchor_id
    or new.lineage_revision is distinct from old.lineage_revision
    or new.effective_policy_id is distinct from old.effective_policy_id
    or new.effective_policy_version is distinct from old.effective_policy_version
    or new.effective_rule_id is distinct from old.effective_rule_id
    or new.effective_rule_revision is distinct from old.effective_rule_revision
    or new.policy_activation_id is distinct from old.policy_activation_id
    or new.policy_activation_revision is distinct from old.policy_activation_revision
    or new.policy_activation_head_revision is distinct from old.policy_activation_head_revision
    or new.legal_hold_set_revision is distinct from old.legal_hold_set_revision
    or new.restriction_set_revision is distinct from old.restriction_set_revision
    or new.created_at is distinct from old.created_at
    or old.revoked_at is not null
    or new.revoked_at is null
    or new.revoked_by_transition_id is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_secret_binding_immutable';
  end if;
  if tg_op = 'UPDATE' and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.transition_id = new.revoked_by_transition_id
       and transition_row.authority_id = new.authority_id
       and transition_row.resulting_revision > old.authority_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_secret_revocation_authority_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_route_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_route_immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.route_id is distinct from old.route_id
    or new.route_revision is distinct from old.route_revision
    or new.route_digest_sha256 is distinct from old.route_digest_sha256
    or new.parent_authority_id is distinct from old.parent_authority_id
    or new.parent_authority_revision is distinct from old.parent_authority_revision
    or new.parent_transition_id is distinct from old.parent_transition_id
    or new.route_generation is distinct from old.route_generation
    or new.adapter_handler_id is distinct from old.adapter_handler_id
    or new.copy_slot is distinct from old.copy_slot
    or new.registry_id is distinct from old.registry_id
    or new.registry_composition_hash is distinct from old.registry_composition_hash
    or new.registry_revision is distinct from old.registry_revision
    or new.data_class_id is distinct from old.data_class_id
    or new.storage_root_id is distinct from old.storage_root_id
    or new.purpose_id is distinct from old.purpose_id
    or new.canonical_anchor_id is distinct from old.canonical_anchor_id
    or new.lineage_revision is distinct from old.lineage_revision
    or new.effective_policy_id is distinct from old.effective_policy_id
    or new.effective_policy_version is distinct from old.effective_policy_version
    or new.effective_rule_id is distinct from old.effective_rule_id
    or new.effective_rule_revision is distinct from old.effective_rule_revision
    or new.policy_activation_id is distinct from old.policy_activation_id
    or new.policy_activation_revision is distinct from old.policy_activation_revision
    or new.policy_activation_head_revision is distinct from old.policy_activation_head_revision
    or new.legal_hold_set_revision is distinct from old.legal_hold_set_revision
    or new.restriction_set_revision is distinct from old.restriction_set_revision
    or new.created_at is distinct from old.created_at
    or old.invalidated_at is not null
    or new.invalidated_at is null
    or new.invalidated_by_transition_id is null
    or new.invalidation_reason_code is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_route_immutable';
  end if;
  if tg_op = 'UPDATE' and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.transition_id = new.invalidated_by_transition_id
       and transition_row.authority_id = new.parent_authority_id
       and transition_row.resulting_revision > old.parent_authority_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_route_invalidation_authority_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_head_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.route_generation <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_initial_head_invalid';
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.authority_id is distinct from old.authority_id
     or new.authority_kind is distinct from old.authority_kind
     or new.source_connection_id is distinct from old.source_connection_id
     or new.source_account_id is distinct from old.source_account_id
     or new.connector_id is distinct from old.connector_id
     or new.session_id is distinct from old.session_id
     or new.auth_challenge_id is distinct from old.auth_challenge_id
     or new.created_by_actor_kind is distinct from old.created_by_actor_kind
     or new.created_by_employee_id is distinct from old.created_by_employee_id
     or new.created_by_trusted_service_id is distinct from old.created_by_trusted_service_id
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.route_generation < old.route_generation
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_head_cas_or_edge_invalid';
  end if;
  if not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = old.tenant_id
       and transition_row.transition_id = new.last_transition_id
       and transition_row.authority_id = old.authority_id
       and transition_row.expected_revision = old.revision
       and transition_row.expected_route_generation = old.route_generation
       and transition_row.from_state = old.state
       and transition_row.resulting_revision = new.revision
       and transition_row.route_generation = new.route_generation
  ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.source_registry_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_head_after_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.route_generation <> old.route_generation
     or new.route_authority_state = 'denied'
     or new.adapter_handler_id is distinct from old.adapter_handler_id then
    update public.inbox_v2_source_registry_ingress_routes route_row
       set invalidated_at = statement_timestamp(),
           invalidated_by_transition_id = new.last_transition_id,
           invalidation_reason_code = case
             when new.route_authority_state = 'denied' then 'authority_not_routable'
             when new.adapter_handler_id is distinct from old.adapter_handler_id then 'adapter_handler_replaced'
             else 'authority_revised'
           end
     where route_row.tenant_id = old.tenant_id
       and route_row.parent_authority_id = old.authority_id
       and route_row.invalidated_at is null
       and (
         route_row.route_generation <> new.route_generation
         or route_row.adapter_handler_id is distinct from new.adapter_handler_id
         or new.route_authority_state = 'denied'
       );
  end if;

  if new.revision <> old.revision then
    update public.inbox_v2_source_registry_secret_refs secret_row
       set revoked_at = statement_timestamp(),
           revoked_by_transition_id = new.last_transition_id
     where secret_row.tenant_id = old.tenant_id
       and secret_row.authority_id = old.authority_id
       and secret_row.revoked_at is null
       and secret_row.authority_revision < new.revision;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_assert_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  checked_tenant_id text;
  checked_authority_id text;
  checked_revision bigint;
  artifact_row record;
  secret_row record;
  route_row record;
  related_row record;
  registry_head record;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  checked_tenant_id := changed_row->>'tenant_id';
  checked_authority_id := coalesce(
    changed_row->>'parent_authority_id',
    changed_row->>'authority_id'
  );
  checked_revision := coalesce(
    (changed_row->>'revision')::bigint,
    (changed_row->>'resulting_revision')::bigint,
    (changed_row->>'parent_authority_revision')::bigint,
    (changed_row->>'authority_revision')::bigint
  );

  if not exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
      join public.inbox_v2_source_registry_transitions transition_row
        on transition_row.tenant_id = head_row.tenant_id
       and transition_row.transition_id = head_row.last_transition_id
       and transition_row.authority_id = head_row.authority_id
       and transition_row.resulting_revision = head_row.revision
       and transition_row.expected_revision = head_row.revision - 1
       and transition_row.authority_kind = head_row.authority_kind
       and transition_row.source_connection_id = head_row.source_connection_id
       and transition_row.source_account_id is not distinct from head_row.source_account_id
       and transition_row.connector_id is not distinct from head_row.connector_id
       and transition_row.session_id is not distinct from head_row.session_id
       and transition_row.auth_challenge_id is not distinct from head_row.auth_challenge_id
       and transition_row.to_state = head_row.state
       and transition_row.route_generation = head_row.route_generation
       and transition_row.route_authority_state = head_row.route_authority_state
       and transition_row.route_authority_reason_code_id = head_row.route_authority_reason_code_id
       and transition_row.route_authority_changed_at = head_row.route_authority_changed_at
       and transition_row.account_identity_transition_id is not distinct from head_row.account_identity_transition_id
       and transition_row.account_identity_revision is not distinct from head_row.account_identity_revision
       and transition_row.account_generation is not distinct from head_row.account_generation
       and transition_row.account_identity_state is not distinct from head_row.account_identity_state
       and transition_row.account_identity_fence_digest_sha256 is not distinct from head_row.account_identity_fence_digest_sha256
       and transition_row.account_canonical_key_digest_sha256 is not distinct from head_row.account_canonical_key_digest_sha256
       and transition_row.account_access_resource_head_id is not distinct from head_row.account_access_resource_head_id
       and transition_row.account_resource_access_revision is not distinct from head_row.account_resource_access_revision
       and transition_row.account_structural_relation_revision is not distinct from head_row.account_structural_relation_revision
       and transition_row.adapter_contract_id = head_row.adapter_contract_id
       and transition_row.adapter_contract_version = head_row.adapter_contract_version
       and transition_row.adapter_declaration_revision = head_row.adapter_declaration_revision
       and transition_row.adapter_surface_id = head_row.adapter_surface_id
       and transition_row.adapter_loaded_by_trusted_service_id = head_row.adapter_loaded_by_trusted_service_id
       and transition_row.adapter_loaded_at = head_row.adapter_loaded_at
       and transition_row.adapter_handler_id is not distinct from head_row.adapter_handler_id
       and transition_row.authority_copy_slot = head_row.authority_copy_slot
       and transition_row.authority_registry_id = head_row.authority_registry_id
       and transition_row.authority_registry_composition_hash = head_row.authority_registry_composition_hash
       and transition_row.authority_registry_revision = head_row.authority_registry_revision
       and transition_row.authority_data_class_id = head_row.authority_data_class_id
       and transition_row.authority_storage_root_id = head_row.authority_storage_root_id
       and transition_row.authority_purpose_id = head_row.authority_purpose_id
       and transition_row.authority_canonical_anchor_id = head_row.authority_canonical_anchor_id
       and transition_row.authority_lineage_revision = head_row.authority_lineage_revision
       and transition_row.authority_effective_policy_id = head_row.authority_effective_policy_id
       and transition_row.authority_effective_policy_version = head_row.authority_effective_policy_version
       and transition_row.authority_effective_rule_id = head_row.authority_effective_rule_id
       and transition_row.authority_effective_rule_revision = head_row.authority_effective_rule_revision
       and transition_row.authority_policy_activation_id = head_row.authority_policy_activation_id
       and transition_row.authority_policy_activation_revision = head_row.authority_policy_activation_revision
       and transition_row.authority_policy_activation_head_revision = head_row.authority_policy_activation_head_revision
       and transition_row.authority_legal_hold_set_revision = head_row.authority_legal_hold_set_revision
       and transition_row.authority_restriction_set_revision = head_row.authority_restriction_set_revision
       and transition_row.created_by_actor_kind = head_row.created_by_actor_kind
       and transition_row.created_by_employee_id is not distinct from head_row.created_by_employee_id
       and transition_row.created_by_trusted_service_id is not distinct from head_row.created_by_trusted_service_id
       and transition_row.created_by_authorization_epoch is not distinct from head_row.created_by_authorization_epoch
       and transition_row.authority_created_at = head_row.created_at
       and transition_row.occurred_at = head_row.updated_at
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_head_transition_mismatch';
  end if;

  select *
    into registry_head
    from public.inbox_v2_source_registry_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.authority_id = checked_authority_id
     and head_row.revision = checked_revision;

  perform public.inbox_v2_assert_source_registry_lineage(
    registry_head.tenant_id,
    registry_head.authority_registry_id,
    registry_head.authority_registry_revision,
    registry_head.authority_registry_composition_hash,
    registry_head.authority_data_class_id,
    registry_head.authority_storage_root_id,
    registry_head.authority_purpose_id,
    registry_head.authority_canonical_anchor_id,
    registry_head.authority_lineage_revision,
    registry_head.authority_effective_policy_id,
    registry_head.authority_effective_policy_version,
    registry_head.authority_effective_rule_id,
    registry_head.authority_effective_rule_revision,
    registry_head.authority_policy_activation_id,
    registry_head.authority_policy_activation_revision,
    registry_head.authority_policy_activation_head_revision,
    registry_head.authority_legal_hold_set_revision,
    registry_head.authority_restriction_set_revision,
    registry_head.authority_kind in (
      'source_connection', 'source_account', 'channel_connector'
    )
  );

  if checked_revision > 1 and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions current_transition
      join public.inbox_v2_source_registry_transitions predecessor
        on predecessor.tenant_id = current_transition.tenant_id
       and predecessor.authority_id = current_transition.authority_id
       and predecessor.resulting_revision = current_transition.expected_revision
       and predecessor.route_generation = current_transition.expected_route_generation
       and predecessor.to_state = current_transition.from_state
       and predecessor.authority_kind = current_transition.authority_kind
       and predecessor.source_connection_id = current_transition.source_connection_id
       and predecessor.source_account_id is not distinct from current_transition.source_account_id
       and predecessor.connector_id is not distinct from current_transition.connector_id
       and predecessor.session_id is not distinct from current_transition.session_id
       and predecessor.auth_challenge_id is not distinct from current_transition.auth_challenge_id
       and predecessor.occurred_at <= current_transition.occurred_at
     where current_transition.tenant_id = checked_tenant_id
       and current_transition.authority_id = checked_authority_id
       and current_transition.resulting_revision = checked_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_transition_predecessor_mismatch';
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
       and head_row.source_account_id is not null
       and not exists (
         select 1
           from public.inbox_v2_source_account_identity_transitions identity_transition
           join public.inbox_v2_source_account_identities identity_head
             on identity_head.tenant_id = identity_transition.tenant_id
            and identity_head.source_account_id = identity_transition.source_account_id
            and identity_head.revision = identity_transition.resulting_revision
            and identity_head.account_generation = identity_transition.resulting_account_generation
            and identity_head.state = identity_transition.to_state
          where identity_transition.tenant_id = head_row.tenant_id
            and identity_transition.id = head_row.account_identity_transition_id
            and identity_transition.source_account_id = head_row.source_account_id
            and identity_transition.resulting_revision = head_row.account_identity_revision
            and identity_transition.resulting_account_generation = head_row.account_generation
            and identity_transition.to_state = head_row.account_identity_state
            and (
              (head_row.account_identity_state = 'provisional'
                and head_row.account_identity_fence_digest_sha256 = identity_head.provisional_key_digest_sha256)
              or (head_row.account_identity_state = 'verified'
                and head_row.account_identity_fence_digest_sha256 = identity_head.canonical_key_digest_sha256
                and head_row.account_canonical_key_digest_sha256 = identity_head.canonical_key_digest_sha256)
              or (head_row.account_identity_state = 'conflicted'
                and head_row.account_identity_fence_digest_sha256 is not null)
            )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_identity_fence_stale';
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
       and head_row.source_account_id is not null
       and head_row.route_authority_state in ('enabled', 'inbound_only')
       and (
         head_row.account_identity_state <> 'verified'
         or not exists (
           select 1
             from public.inbox_v2_source_account_identities identity_head
            where identity_head.tenant_id = head_row.tenant_id
              and identity_head.source_account_id = head_row.source_account_id
              and identity_head.revision = head_row.account_identity_revision
              and identity_head.account_generation = head_row.account_generation
              and identity_head.state = head_row.account_identity_state
              and identity_head.canonical_key_digest_sha256 = head_row.account_canonical_key_digest_sha256
         )
         or not exists (
           select 1
             from public.inbox_v2_auth_resource_heads access_head
            where access_head.tenant_id = head_row.tenant_id
              and access_head.id = head_row.account_access_resource_head_id
              and access_head.resource_kind = 'source_account'
              and access_head.source_account_id = head_row.source_account_id
              and access_head.resource_access_revision = head_row.account_resource_access_revision
              and access_head.structural_relation_revision = head_row.account_structural_relation_revision
         )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_routable_account_fence_stale';
  end if;

  for artifact_row in
    select *
      from public.inbox_v2_source_registry_artifact_refs
     where tenant_id = checked_tenant_id
       and authority_id = checked_authority_id
       and authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      artifact_row.tenant_id,
      artifact_row.registry_id,
      artifact_row.registry_revision,
      artifact_row.registry_composition_hash,
      artifact_row.data_class_id,
      artifact_row.storage_root_id,
      artifact_row.purpose_id,
      artifact_row.canonical_anchor_id,
      artifact_row.lineage_revision,
      artifact_row.effective_policy_id,
      artifact_row.effective_policy_version,
      artifact_row.effective_rule_id,
      artifact_row.effective_rule_revision,
      artifact_row.policy_activation_id,
      artifact_row.policy_activation_revision,
      artifact_row.policy_activation_head_revision,
      artifact_row.legal_hold_set_revision,
      artifact_row.restriction_set_revision,
      artifact_row.artifact_kind <> 'diagnostic'
    );
  end loop;

  for secret_row in
    select *
      from public.inbox_v2_source_registry_secret_refs
     where tenant_id = checked_tenant_id
       and authority_id = checked_authority_id
       and authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      secret_row.tenant_id,
      secret_row.registry_id,
      secret_row.registry_revision,
      secret_row.registry_composition_hash,
      secret_row.data_class_id,
      secret_row.storage_root_id,
      secret_row.purpose_id,
      secret_row.canonical_anchor_id,
      secret_row.lineage_revision,
      secret_row.effective_policy_id,
      secret_row.effective_policy_version,
      secret_row.effective_rule_id,
      secret_row.effective_rule_revision,
      secret_row.policy_activation_id,
      secret_row.policy_activation_revision,
      secret_row.policy_activation_head_revision,
      secret_row.legal_hold_set_revision,
      secret_row.restriction_set_revision,
      false
    );
  end loop;

  for route_row in
    select *
     from public.inbox_v2_source_registry_ingress_routes
     where tenant_id = checked_tenant_id
       and parent_authority_id = checked_authority_id
       and parent_authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      route_row.tenant_id,
      route_row.registry_id,
      route_row.registry_revision,
      route_row.registry_composition_hash,
      route_row.data_class_id,
      route_row.storage_root_id,
      route_row.purpose_id,
      route_row.canonical_anchor_id,
      route_row.lineage_revision,
      route_row.effective_policy_id,
      route_row.effective_policy_version,
      route_row.effective_rule_id,
      route_row.effective_rule_revision,
      route_row.policy_activation_id,
      route_row.policy_activation_revision,
      route_row.policy_activation_head_revision,
      route_row.legal_hold_set_revision,
      route_row.restriction_set_revision,
      true
    );
    if route_row.adapter_handler_id is distinct from (
      select head_row.adapter_handler_id
        from public.inbox_v2_source_registry_heads head_row
       where head_row.tenant_id = checked_tenant_id
         and head_row.authority_id = checked_authority_id
         and head_row.revision = checked_revision
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_route_adapter_mismatch';
    end if;
  end loop;

  for related_row in
    select *
      from public.inbox_v2_source_registry_related_authority_refs
     where tenant_id = checked_tenant_id
       and parent_authority_id = checked_authority_id
       and parent_authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      related_row.tenant_id,
      related_row.registry_id,
      related_row.registry_revision,
      related_row.registry_composition_hash,
      related_row.data_class_id,
      related_row.storage_root_id,
      related_row.purpose_id,
      related_row.canonical_anchor_id,
      related_row.lineage_revision,
      related_row.effective_policy_id,
      related_row.effective_policy_version,
      related_row.effective_rule_id,
      related_row.effective_rule_revision,
      related_row.policy_activation_id,
      related_row.policy_activation_revision,
      related_row.policy_activation_head_revision,
      related_row.legal_hold_set_revision,
      related_row.restriction_set_revision,
      related_row.kind in ('channel_connector', 'source_ingress_route')
    );

    if related_row.status = 'active' and (
      (related_row.kind = 'channel_connector' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_connector'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'channel_session' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = child_head.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = child_head.connector_id
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_session'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'channel_session_event' and not exists (
        select 1
          from public.channel_session_events event_row
          join public.inbox_v2_source_registry_heads session_head
            on session_head.tenant_id = event_row.tenant_id
           and session_head.authority_id = related_row.session_authority_id
           and session_head.authority_kind = 'channel_session'
           and session_head.session_id = event_row.session_id
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = event_row.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = event_row.connector_id
         where event_row.tenant_id = related_row.tenant_id
           and event_row.id = related_row.authority_id
           and session_head.source_connection_id = related_row.source_connection_id
           and connector_head.source_connection_id = related_row.source_connection_id
      ))
      or (related_row.kind = 'channel_auth_challenge' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = child_head.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = child_head.connector_id
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_auth_challenge'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'source_ingress_route' and not exists (
        select 1
          from public.inbox_v2_source_registry_ingress_routes route_check
         where route_check.tenant_id = related_row.tenant_id
           and route_check.route_id = related_row.authority_id
           and route_check.route_revision = related_row.authority_revision
           and route_check.parent_authority_id = related_row.parent_authority_id
           and route_check.route_generation = related_row.handler_generation
           and route_check.invalidated_at is null
      ))
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_related_authority_stale';
    end if;
  end loop;
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_registry_account_fence_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  checked_tenant_id text;
  checked_source_account_id text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  checked_tenant_id := changed_row->>'tenant_id';
  checked_source_account_id := changed_row->>'source_account_id';

  if checked_source_account_id is null then
    return null;
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.source_account_id = checked_source_account_id
       and head_row.route_authority_state in ('enabled', 'inbound_only')
       and (
         not exists (
           select 1
             from public.inbox_v2_source_account_identities identity_head
            where identity_head.tenant_id = head_row.tenant_id
              and identity_head.source_account_id = head_row.source_account_id
              and identity_head.revision = head_row.account_identity_revision
              and identity_head.account_generation = head_row.account_generation
              and identity_head.state = 'verified'
              and identity_head.canonical_key_digest_sha256 = head_row.account_canonical_key_digest_sha256
         )
         or not exists (
           select 1
             from public.inbox_v2_auth_resource_heads access_head
            where access_head.tenant_id = head_row.tenant_id
              and access_head.id = head_row.account_access_resource_head_id
              and access_head.resource_kind = 'source_account'
              and access_head.source_account_id = head_row.source_account_id
              and access_head.resource_access_revision = head_row.account_resource_access_revision
              and access_head.structural_relation_revision = head_row.account_structural_relation_revision
         )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_routable_account_fence_stale';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_registry_child_head_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_registry_related_authority_refs related_row
      join public.inbox_v2_source_registry_heads parent_head
        on parent_head.tenant_id = related_row.tenant_id
       and parent_head.authority_id = related_row.parent_authority_id
       and parent_head.revision = related_row.parent_authority_revision
     where related_row.tenant_id = new.tenant_id
       and related_row.authority_id = new.authority_id
       and related_row.status = 'active'
       and related_row.kind in (
         'channel_connector', 'channel_session', 'channel_auth_challenge'
       )
       and related_row.authority_revision <> new.revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_related_authority_stale';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_source_registry_transitions_guard_trigger
before update or delete on public.inbox_v2_source_registry_transitions
for each row execute function public.inbox_v2_source_registry_transition_guard();

create trigger inbox_v2_source_registry_artifact_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_artifact_refs
for each row execute function public.inbox_v2_source_registry_artifact_guard();

create trigger inbox_v2_source_registry_related_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_related_authority_refs
for each row execute function public.inbox_v2_source_registry_related_guard();

create trigger inbox_v2_source_registry_secret_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_secret_refs
for each row execute function public.inbox_v2_source_registry_secret_guard();

create trigger inbox_v2_source_registry_ingress_routes_guard_trigger
before update or delete on public.inbox_v2_source_registry_ingress_routes
for each row execute function public.inbox_v2_source_registry_route_guard();

create trigger inbox_v2_source_registry_heads_guard_trigger
before insert or update or delete on public.inbox_v2_source_registry_heads
for each row execute function public.inbox_v2_source_registry_head_guard();

create trigger inbox_v2_source_registry_heads_invalidation_trigger
after update on public.inbox_v2_source_registry_heads
for each row execute function public.inbox_v2_source_registry_head_after_update();

create constraint trigger inbox_v2_source_registry_heads_exact_trigger
after insert or update on public.inbox_v2_source_registry_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_transitions_exact_trigger
after insert on public.inbox_v2_source_registry_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_artifact_refs_exact_trigger
after insert on public.inbox_v2_source_registry_artifact_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_secret_refs_exact_trigger
after insert on public.inbox_v2_source_registry_secret_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_ingress_routes_exact_trigger
after insert on public.inbox_v2_source_registry_ingress_routes
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_related_refs_exact_trigger
after insert on public.inbox_v2_source_registry_related_authority_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_identity_fence_trigger
after update on public.inbox_v2_source_account_identities
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_account_fence_deferred();

create constraint trigger inbox_v2_source_registry_access_fence_trigger
after update on public.inbox_v2_auth_resource_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_account_fence_deferred();

create constraint trigger inbox_v2_source_registry_child_head_trigger
after update on public.inbox_v2_source_registry_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_child_head_deferred();
`;
