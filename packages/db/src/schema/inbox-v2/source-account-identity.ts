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
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import { sourceAccounts, sourceConnections, tenants } from "../tables";

export const inboxV2SourceAccountIdentityState = pgEnum(
  "inbox_v2_source_account_identity_state",
  ["provisional", "verified", "conflicted"]
);

export const inboxV2SourceAccountIdentityScopeKind = pgEnum(
  "inbox_v2_source_account_identity_scope_kind",
  ["provider", "source_connection"]
);

export const inboxV2SourceAccountIdentityTransitionIntent = pgEnum(
  "inbox_v2_source_account_identity_transition_intent",
  [
    "create_provisional",
    "promote_verified",
    "reauthenticate_verified",
    "mark_conflicted",
    "resolve_conflict"
  ]
);

const identityDeclarationColumns = () => ({
  identityDeclaration: jsonb("identity_declaration")
    .$type<Record<string, unknown>>()
    .notNull(),
  declarationContractId: text("declaration_contract_id").notNull(),
  declarationContractVersion: text("declaration_contract_version").notNull(),
  declarationRevision: bigint("declaration_revision", {
    mode: "bigint"
  }).notNull(),
  declarationSurfaceId: text("declaration_surface_id").notNull(),
  declarationLoadedByTrustedServiceId: text(
    "declaration_loaded_by_trusted_service_id"
  ).notNull(),
  declarationLoadedAt: timestamp("declaration_loaded_at", {
    withTimezone: true,
    precision: 3
  }).notNull(),
  declarationRealmId: text("declaration_realm_id").notNull(),
  declarationRealmVersion: text("declaration_realm_version").notNull(),
  declarationCanonicalizationVersion: text(
    "declaration_canonicalization_version"
  ).notNull(),
  declarationObjectKindId: text("declaration_object_kind_id").notNull(),
  declarationScopeKind: inboxV2SourceAccountIdentityScopeKind(
    "declaration_scope_kind"
  ).notNull()
});

/**
 * One durable owner for the connector/session fingerprint across both a
 * current provisional identity and every immutable alias. Keeping this claim
 * in one table closes the cross-table uniqueness hole that separate partial
 * indexes on identities and aliases cannot close.
 */
export const inboxV2SourceAccountProvisionalIdentityKeys = pgTable(
  "inbox_v2_source_account_provisional_keys",
  {
    tenantId: text("tenant_id").notNull(),
    provisionalKeyDigestSha256: text("provisional_key_digest_sha256")
      .generatedAlwaysAs(() =>
        provisionalSourceAccountKeyDigestSql({
          sourceConnectionId: "source_connection_id",
          contractId: "declaration_contract_id",
          contractVersion: "declaration_contract_version",
          surfaceId: "declaration_surface_id",
          connectorSessionSubject: "connector_session_subject"
        })
      )
      .notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    declarationContractId: text("declaration_contract_id").notNull(),
    declarationContractVersion: text("declaration_contract_version").notNull(),
    declarationSurfaceId: text("declaration_surface_id").notNull(),
    connectorSessionSubject: text("connector_session_subject").notNull(),
    provisionalObservedAt: timestamp("provisional_observed_at", {
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
      name: "inbox_v2_account_provisional_keys_pk",
      columns: [table.tenantId, table.provisionalKeyDigestSha256]
    }),
    unique("inbox_v2_account_provisional_keys_owner_unique").on(
      table.tenantId,
      table.provisionalKeyDigestSha256,
      table.sourceAccountId,
      table.sourceConnectionId,
      table.provisionalObservedAt
    ),
    unique("inbox_v2_account_provisional_keys_transition_unique").on(
      table.tenantId,
      table.provisionalKeyDigestSha256,
      table.sourceAccountId,
      table.provisionalObservedAt
    ),
    foreignKey({
      name: "inbox_v2_account_provisional_keys_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_provisional_keys_account_edge_fk",
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
      "inbox_v2_account_provisional_keys_value_check",
      sql`${sha256DigestSql(table.provisionalKeyDigestSha256)}
        and ${catalogIdSql(table.declarationContractId)}
        and ${versionTokenSql(table.declarationContractVersion)}
        and ${catalogIdSql(table.declarationSurfaceId)}
        and ${opaqueSubjectSql(table.connectorSessionSubject)}
        and isfinite(${table.provisionalObservedAt})
        and isfinite(${table.createdAt})
        and ${table.provisionalObservedAt} <= ${table.createdAt}`
    ),
    index("inbox_v2_account_provisional_keys_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.provisionalKeyDigestSha256
    ),
    index("inbox_v2_account_provisional_keys_tenant_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.provisionalKeyDigestSha256
    )
  ]
);

/**
 * Immutable conflict evidence for one current-identity revision. Candidate
 * canonical keys live in normalized child rows; no candidate is represented
 * by an unverified opaque reference.
 */
export const inboxV2SourceAccountIdentityConflicts = pgTable(
  "inbox_v2_source_account_identity_conflicts",
  {
    tenantId: text("tenant_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    identityRevision: bigint("identity_revision", {
      mode: "bigint"
    }).notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    expectedScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "expected_scope_kind"
    ).notNull(),
    expectedScopeSourceConnectionId: text(
      "expected_scope_source_connection_id"
    ),
    expectedScopeOwnerKey: text("expected_scope_owner_key").notNull(),
    provisionalKeyDigestSha256: text("provisional_key_digest_sha256")
      .generatedAlwaysAs(() =>
        provisionalSourceAccountKeyDigestSql({
          sourceConnectionId: "source_connection_id",
          contractId: "declaration_contract_id",
          contractVersion: "declaration_contract_version",
          surfaceId: "declaration_surface_id",
          connectorSessionSubject: "provisional_connector_session_subject"
        })
      )
      .notNull(),
    provisionalConnectorSessionSubject: text(
      "provisional_connector_session_subject"
    ).notNull(),
    provisionalObservedAt: timestamp("provisional_observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    declarationContractId: text("declaration_contract_id").notNull(),
    declarationContractVersion: text("declaration_contract_version").notNull(),
    declarationRevision: bigint("declaration_revision", {
      mode: "bigint"
    }).notNull(),
    declarationSurfaceId: text("declaration_surface_id").notNull(),
    declarationLoadedByTrustedServiceId: text(
      "declaration_loaded_by_trusted_service_id"
    ).notNull(),
    declarationLoadedAt: timestamp("declaration_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    declarationRealmId: text("declaration_realm_id").notNull(),
    declarationRealmVersion: text("declaration_realm_version").notNull(),
    declarationCanonicalizationVersion: text(
      "declaration_canonicalization_version"
    ).notNull(),
    declarationObjectKindId: text("declaration_object_kind_id").notNull(),
    declarationScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "declaration_scope_kind"
    ).notNull(),
    candidateCount: smallint("candidate_count").notNull(),
    diagnosticCodeId: text("diagnostic_code_id").notNull(),
    diagnosticRetryable: boolean("diagnostic_retryable").notNull(),
    diagnosticCorrelationToken: text("diagnostic_correlation_token").notNull(),
    diagnosticSafeOperatorHintId: text("diagnostic_safe_operator_hint_id"),
    decisionActorTrustedServiceId: text(
      "decision_actor_trusted_service_id"
    ).notNull(),
    decisionPolicyId: text("decision_policy_id").notNull(),
    decisionPolicyVersion: text("decision_policy_version").notNull(),
    decisionReasonCodeId: text("decision_reason_code_id").notNull(),
    decisionVerificationEvidenceToken: text(
      "decision_verification_evidence_token"
    ).notNull(),
    decisionDecidedAt: timestamp("decision_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    detectedAt: timestamp("detected_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_account_identity_conflicts_pk",
      columns: [table.tenantId, table.sourceAccountId, table.identityRevision]
    }),
    unique("inbox_v2_account_identity_conflicts_account_edge_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.identityRevision,
      table.sourceConnectionId
    ),
    foreignKey({
      name: "inbox_v2_account_identity_conflicts_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_conflicts_account_edge_fk",
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
      name: "inbox_v2_account_identity_conflicts_provisional_key_fk",
      columns: [
        table.tenantId,
        table.provisionalKeyDigestSha256,
        table.sourceAccountId,
        table.sourceConnectionId,
        table.provisionalObservedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountProvisionalIdentityKeys.tenantId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalKeyDigestSha256,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceAccountId,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceConnectionId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalObservedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_conflicts_scope_owner_fk",
      columns: [table.tenantId, table.expectedScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    check(
      "inbox_v2_account_identity_conflicts_revision_check",
      sql`${table.identityRevision} >= 2`
    ),
    check(
      "inbox_v2_account_identity_conflicts_scope_check",
      accountScopeSql(
        table.expectedScopeKind,
        table.expectedScopeSourceConnectionId,
        table.expectedScopeOwnerKey,
        table.sourceConnectionId
      )
    ),
    check(
      "inbox_v2_account_identity_conflicts_subject_check",
      opaqueSubjectSql(table.provisionalConnectorSessionSubject)
    ),
    check(
      "inbox_v2_account_identity_conflicts_digest_check",
      sha256DigestSql(table.provisionalKeyDigestSha256)
    ),
    check(
      "inbox_v2_account_identity_conflicts_declaration_check",
      sql`${catalogIdSql(table.declarationContractId)}
        and ${versionTokenSql(table.declarationContractVersion)}
        and ${table.declarationRevision} >= 1
        and ${catalogIdSql(table.declarationSurfaceId)}
        and ${catalogIdSql(table.declarationLoadedByTrustedServiceId)}
        and ${catalogIdSql(table.declarationRealmId)}
        and ${versionTokenSql(table.declarationRealmVersion)}
        and ${versionTokenSql(table.declarationCanonicalizationVersion)}
        and ${catalogIdSql(table.declarationObjectKindId)}
        and ${table.declarationScopeKind} = ${table.expectedScopeKind}`
    ),
    check(
      "inbox_v2_account_identity_conflicts_candidate_count_check",
      sql`${table.candidateCount} between 1 and 16`
    ),
    check(
      "inbox_v2_account_identity_conflicts_diagnostic_check",
      sql`${catalogIdSql(table.diagnosticCodeId)}
        and ${routingTokenSql(table.diagnosticCorrelationToken)}
        and (
          ${table.diagnosticSafeOperatorHintId} is null
          or ${catalogIdSql(table.diagnosticSafeOperatorHintId)}
        )`
    ),
    check(
      "inbox_v2_account_identity_conflicts_decision_check",
      trustedDecisionSql({
        actor: table.decisionActorTrustedServiceId,
        pinnedActor: table.declarationLoadedByTrustedServiceId,
        policyId: table.decisionPolicyId,
        policyVersion: table.decisionPolicyVersion,
        reasonCodeId: table.decisionReasonCodeId,
        evidenceToken: table.decisionVerificationEvidenceToken,
        decidedAt: table.decisionDecidedAt,
        actionAt: table.detectedAt
      })
    ),
    check(
      "inbox_v2_account_identity_conflicts_timestamps_check",
      sql`isfinite(${table.provisionalObservedAt})
        and isfinite(${table.declarationLoadedAt})
        and isfinite(${table.decisionDecidedAt})
        and isfinite(${table.detectedAt})
        and ${table.declarationLoadedAt} <= ${table.provisionalObservedAt}
        and ${table.provisionalObservedAt} <= ${table.detectedAt}`
    ),
    index("inbox_v2_account_identity_conflicts_tenant_time_idx").on(
      table.tenantId,
      table.detectedAt.desc(),
      table.sourceAccountId
    )
  ]
);

export const inboxV2SourceAccountIdentityConflictCandidates = pgTable(
  "inbox_v2_source_account_identity_conflict_candidates",
  {
    tenantId: text("tenant_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    identityRevision: bigint("identity_revision", {
      mode: "bigint"
    }).notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    canonicalKeyDigestSha256: text("canonical_key_digest_sha256")
      .generatedAlwaysAs(() =>
        canonicalSourceAccountKeyDigestSql({
          realmId: "realm_id",
          realmVersion: "realm_version",
          canonicalizationVersion: "canonicalization_version",
          objectKindId: "object_kind_id",
          scopeKind: "scope_kind",
          scopeSourceConnectionId: "scope_source_connection_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    realmId: text("realm_id").notNull(),
    realmVersion: text("realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    objectKindId: text("object_kind_id").notNull(),
    scopeKind: inboxV2SourceAccountIdentityScopeKind("scope_kind").notNull(),
    scopeSourceConnectionId: text("scope_source_connection_id"),
    scopeOwnerKey: text("scope_owner_key").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_account_identity_conflict_candidates_pk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.identityRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_conflict_candidates_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_conflict_candidates_parent_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.identityRevision,
        table.sourceConnectionId
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityConflicts.tenantId,
        inboxV2SourceAccountIdentityConflicts.sourceAccountId,
        inboxV2SourceAccountIdentityConflicts.identityRevision,
        inboxV2SourceAccountIdentityConflicts.sourceConnectionId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_account_identity_conflict_candidates_scope_fk",
      columns: [table.tenantId, table.scopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    unique("inbox_v2_account_identity_conflict_candidate_digest_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.identityRevision,
      table.canonicalKeyDigestSha256
    ),
    check(
      "inbox_v2_account_identity_conflict_candidates_ordinal_check",
      sql`${table.ordinal} between 1 and 16`
    ),
    check(
      "inbox_v2_account_identity_conflict_candidates_digest_check",
      sha256DigestSql(table.canonicalKeyDigestSha256)
    ),
    check(
      "inbox_v2_account_identity_conflict_candidates_key_check",
      sql`${catalogIdSql(table.realmId)}
        and ${versionTokenSql(table.realmVersion)}
        and ${versionTokenSql(table.canonicalizationVersion)}
        and ${catalogIdSql(table.objectKindId)}
        and ${accountScopeSql(
          table.scopeKind,
          table.scopeSourceConnectionId,
          table.scopeOwnerKey,
          table.sourceConnectionId
        )}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}`
    ),
    index("inbox_v2_account_identity_conflict_candidates_tenant_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.identityRevision,
      table.ordinal
    )
  ]
);

/** Current exact identity and route fence for one SourceAccount. */
export const inboxV2SourceAccountIdentities = pgTable(
  "inbox_v2_source_account_identities",
  {
    tenantId: text("tenant_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    state: inboxV2SourceAccountIdentityState("state").notNull(),
    ...identityDeclarationColumns(),
    expectedScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "expected_scope_kind"
    ),
    expectedScopeSourceConnectionId: text(
      "expected_scope_source_connection_id"
    ),
    expectedScopeOwnerKey: text("expected_scope_owner_key"),
    provisionalKeyDigestSha256: text(
      "provisional_key_digest_sha256"
    ).generatedAlwaysAs(() =>
      provisionalSourceAccountKeyDigestSql({
        sourceConnectionId: "source_connection_id",
        contractId: "declaration_contract_id",
        contractVersion: "declaration_contract_version",
        surfaceId: "declaration_surface_id",
        connectorSessionSubject: "provisional_connector_session_subject"
      })
    ),
    provisionalConnectorSessionSubject: text(
      "provisional_connector_session_subject"
    ),
    provisionalObservedAt: timestamp("provisional_observed_at", {
      withTimezone: true,
      precision: 3
    }),
    canonicalKeyDigestSha256: text(
      "canonical_key_digest_sha256"
    ).generatedAlwaysAs(() =>
      canonicalSourceAccountKeyDigestSql({
        realmId: "canonical_realm_id",
        realmVersion: "canonical_realm_version",
        canonicalizationVersion: "canonicalization_version",
        objectKindId: "canonical_object_kind_id",
        scopeKind: "canonical_scope_kind",
        scopeSourceConnectionId: "canonical_scope_source_connection_id",
        canonicalExternalSubject: "canonical_external_subject"
      })
    ),
    canonicalRealmId: text("canonical_realm_id"),
    canonicalRealmVersion: text("canonical_realm_version"),
    canonicalizationVersion: text("canonicalization_version"),
    canonicalObjectKindId: text("canonical_object_kind_id"),
    canonicalScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "canonical_scope_kind"
    ),
    canonicalScopeSourceConnectionId: text(
      "canonical_scope_source_connection_id"
    ),
    canonicalScopeOwnerKey: text("canonical_scope_owner_key"),
    canonicalExternalSubject: text("canonical_external_subject"),
    verifiedDecisionActorTrustedServiceId: text(
      "verified_decision_actor_trusted_service_id"
    ),
    verifiedDecisionPolicyId: text("verified_decision_policy_id"),
    verifiedDecisionPolicyVersion: text("verified_decision_policy_version"),
    verifiedDecisionReasonCodeId: text("verified_decision_reason_code_id"),
    verifiedDecisionVerificationEvidenceToken: text(
      "verified_decision_verification_evidence_token"
    ),
    verifiedDecisionDecidedAt: timestamp("verified_decision_decided_at", {
      withTimezone: true,
      precision: 3
    }),
    activeConflictRevision: bigint("active_conflict_revision", {
      mode: "bigint"
    }),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
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
      name: "inbox_v2_source_account_identities_pk",
      columns: [table.tenantId, table.sourceAccountId]
    }),
    foreignKey({
      name: "inbox_v2_source_account_identities_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_source_account_identities_account_edge_fk",
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
      name: "inbox_v2_source_account_identities_provisional_key_fk",
      columns: [
        table.tenantId,
        table.provisionalKeyDigestSha256,
        table.sourceAccountId,
        table.sourceConnectionId,
        table.provisionalObservedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountProvisionalIdentityKeys.tenantId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalKeyDigestSha256,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceAccountId,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceConnectionId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalObservedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_account_identities_expected_scope_fk",
      columns: [table.tenantId, table.expectedScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_account_identities_canonical_scope_fk",
      columns: [table.tenantId, table.canonicalScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_account_identities_active_conflict_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.activeConflictRevision
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentityConflicts.tenantId,
        inboxV2SourceAccountIdentityConflicts.sourceAccountId,
        inboxV2SourceAccountIdentityConflicts.identityRevision
      ]
    }),
    unique("inbox_v2_source_account_identities_actor_fence_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.declarationLoadedByTrustedServiceId
    ),
    unique("inbox_v2_source_account_identities_snapshot_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.revision,
      table.accountGeneration,
      table.state,
      table.canonicalKeyDigestSha256
    ),
    unique("inbox_v2_source_account_identities_verified_snapshot_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.revision,
      table.accountGeneration,
      table.state,
      table.canonicalKeyDigestSha256,
      table.declarationLoadedByTrustedServiceId,
      table.verifiedDecisionDecidedAt
    ),
    uniqueIndex("inbox_v2_source_account_identities_verified_key_unique")
      .on(table.tenantId, table.canonicalKeyDigestSha256)
      .where(sql`${table.state} = 'verified'`),
    uniqueIndex("inbox_v2_source_account_identities_provisional_key_unique")
      .on(table.tenantId, table.provisionalKeyDigestSha256)
      .where(sql`${table.state} in ('provisional', 'conflicted')`),
    check(
      "inbox_v2_source_account_identities_declaration_check",
      sql`${declarationJsonParitySql(table)}
        and ${catalogIdSql(table.declarationContractId)}
        and ${versionTokenSql(table.declarationContractVersion)}
        and ${table.declarationRevision} >= 1
        and ${catalogIdSql(table.declarationSurfaceId)}
        and ${catalogIdSql(table.declarationLoadedByTrustedServiceId)}
        and ${catalogIdSql(table.declarationRealmId)}
        and ${versionTokenSql(table.declarationRealmVersion)}
        and ${versionTokenSql(table.declarationCanonicalizationVersion)}
        and ${catalogIdSql(table.declarationObjectKindId)}`
    ),
    check(
      "inbox_v2_source_account_identities_state_xor_check",
      sourceAccountIdentityStateSql(table)
    ),
    check(
      "inbox_v2_source_account_identities_scope_check",
      sql`(
        ${table.expectedScopeKind} is null
        or ${accountScopeSql(
          table.expectedScopeKind,
          table.expectedScopeSourceConnectionId,
          table.expectedScopeOwnerKey,
          table.sourceConnectionId
        )}
      ) and (
        ${table.canonicalScopeKind} is null
        or ${accountScopeSql(
          table.canonicalScopeKind,
          table.canonicalScopeSourceConnectionId,
          table.canonicalScopeOwnerKey,
          table.sourceConnectionId
        )}
      )`
    ),
    check(
      "inbox_v2_source_account_identities_key_parity_check",
      sql`(
        ${table.state} in ('provisional', 'conflicted')
        and ${table.declarationScopeKind} = ${table.expectedScopeKind}
      ) or (
        ${table.state} = 'verified'
        and ${table.declarationRealmId} = ${table.canonicalRealmId}
        and ${table.declarationRealmVersion} = ${table.canonicalRealmVersion}
        and ${table.declarationCanonicalizationVersion} = ${table.canonicalizationVersion}
        and ${table.declarationObjectKindId} = ${table.canonicalObjectKindId}
        and ${table.declarationScopeKind} = ${table.canonicalScopeKind}
      )`
    ),
    check(
      "inbox_v2_source_account_identities_key_values_check",
      sql`(
        ${table.provisionalConnectorSessionSubject} is null
        or ${opaqueSubjectSql(table.provisionalConnectorSessionSubject)}
      ) and (
        ${table.provisionalKeyDigestSha256} is null
        or ${sha256DigestSql(table.provisionalKeyDigestSha256)}
      ) and (
        ${table.canonicalKeyDigestSha256} is null
        or ${sha256DigestSql(table.canonicalKeyDigestSha256)}
      ) and (
        ${table.canonicalRealmId} is null
        or ${catalogIdSql(table.canonicalRealmId)}
      ) and (
        ${table.canonicalRealmVersion} is null
        or ${versionTokenSql(table.canonicalRealmVersion)}
      ) and (
        ${table.canonicalizationVersion} is null
        or ${versionTokenSql(table.canonicalizationVersion)}
      ) and (
        ${table.canonicalObjectKindId} is null
        or ${catalogIdSql(table.canonicalObjectKindId)}
      ) and (
        ${table.canonicalExternalSubject} is null
        or ${opaqueSubjectSql(table.canonicalExternalSubject)}
      )`
    ),
    check(
      "inbox_v2_source_account_identities_revision_check",
      sql`${table.revision} >= 1
        and ${table.accountGeneration} = ${table.revision}
        and (
          ${table.state} <> 'provisional'
          or (
            ${table.revision} = 1
            and ${table.createdAt} = ${table.updatedAt}
          )
        )`
    ),
    check(
      "inbox_v2_source_account_identities_timestamps_check",
      sql`isfinite(${table.declarationLoadedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and (
          ${table.provisionalObservedAt} is null
          or (
            isfinite(${table.provisionalObservedAt})
            and ${table.declarationLoadedAt} <= ${table.provisionalObservedAt}
            and ${table.provisionalObservedAt} <= ${table.updatedAt}
          )
        )
        and (
          ${table.verifiedDecisionDecidedAt} is null
          or isfinite(${table.verifiedDecisionDecidedAt})
        )
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_source_account_identities_tenant_connection_idx").on(
      table.tenantId,
      table.sourceConnectionId,
      table.state,
      table.sourceAccountId
    ),
    index("inbox_v2_source_account_identities_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt.desc(),
      table.sourceAccountId
    )
  ]
);

/** Append-only CAS history for identity state and route-fence changes. */
export const inboxV2SourceAccountIdentityTransitions = pgTable(
  "inbox_v2_source_account_identity_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    provisionalKeyDigestSha256: text("provisional_key_digest_sha256").notNull(),
    provisionalObservedAt: timestamp("provisional_observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    intent: inboxV2SourceAccountIdentityTransitionIntent("intent").notNull(),
    fromState: inboxV2SourceAccountIdentityState("from_state"),
    toState: inboxV2SourceAccountIdentityState("to_state").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }),
    currentRevision: bigint("current_revision", { mode: "bigint" }),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    expectedAccountGeneration: bigint("expected_account_generation", {
      mode: "bigint"
    }),
    currentAccountGeneration: bigint("current_account_generation", {
      mode: "bigint"
    }),
    resultingAccountGeneration: bigint("resulting_account_generation", {
      mode: "bigint"
    }).notNull(),
    pinnedDeclarationTrustedServiceId: text(
      "pinned_declaration_trusted_service_id"
    ).notNull(),
    decisionActorTrustedServiceId: text(
      "decision_actor_trusted_service_id"
    ).notNull(),
    decisionPolicyId: text("decision_policy_id").notNull(),
    decisionPolicyVersion: text("decision_policy_version").notNull(),
    decisionReasonCodeId: text("decision_reason_code_id").notNull(),
    decisionVerificationEvidenceToken: text(
      "decision_verification_evidence_token"
    ).notNull(),
    decisionDecidedAt: timestamp("decision_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_account_identity_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_transitions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_transitions_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_transitions_provisional_key_fk",
      columns: [
        table.tenantId,
        table.provisionalKeyDigestSha256,
        table.sourceAccountId,
        table.provisionalObservedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountProvisionalIdentityKeys.tenantId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalKeyDigestSha256,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceAccountId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalObservedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_transitions_actor_fence_fk",
      columns: [
        table.tenantId,
        table.sourceAccountId,
        table.pinnedDeclarationTrustedServiceId
      ],
      foreignColumns: [
        inboxV2SourceAccountIdentities.tenantId,
        inboxV2SourceAccountIdentities.sourceAccountId,
        inboxV2SourceAccountIdentities.declarationLoadedByTrustedServiceId
      ]
    }),
    unique("inbox_v2_account_identity_transitions_revision_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.resultingRevision
    ),
    unique("inbox_v2_account_identity_transitions_result_edge_unique").on(
      table.tenantId,
      table.id,
      table.sourceAccountId,
      table.resultingRevision,
      table.resultingAccountGeneration
    ),
    check(
      "inbox_v2_source_account_identity_transitions_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_account_identity_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_account_identity_transitions_provisional_key_check",
      sha256DigestSql(table.provisionalKeyDigestSha256)
    ),
    check(
      "inbox_v2_account_identity_transitions_kind_cas_check",
      transitionCasSql(table)
    ),
    check(
      "inbox_v2_account_identity_transitions_decision_check",
      trustedDecisionSql({
        actor: table.decisionActorTrustedServiceId,
        pinnedActor: table.pinnedDeclarationTrustedServiceId,
        policyId: table.decisionPolicyId,
        policyVersion: table.decisionPolicyVersion,
        reasonCodeId: table.decisionReasonCodeId,
        evidenceToken: table.decisionVerificationEvidenceToken,
        decidedAt: table.decisionDecidedAt,
        actionAt: table.occurredAt
      })
    ),
    check(
      "inbox_v2_account_identity_transitions_timestamps_check",
      sql`isfinite(${table.provisionalObservedAt})
        and isfinite(${table.decisionDecidedAt})
        and isfinite(${table.occurredAt})
        and ${table.provisionalObservedAt} <= ${table.occurredAt}`
    ),
    index("inbox_v2_account_identity_transitions_tenant_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.resultingRevision.desc()
    ),
    index("inbox_v2_account_identity_transitions_tenant_time_idx").on(
      table.tenantId,
      table.occurredAt.desc(),
      table.id
    )
  ]
);

/**
 * Append-only authority for every verified account generation. Current identity
 * rows are mutable heads; aliases, bindings and historical route fences target
 * this table so a later successful reauthentication never rewrites evidence.
 */
export const inboxV2SourceAccountIdentityVerifiedSnapshots = pgTable(
  "inbox_v2_source_account_identity_verified_snapshots",
  {
    tenantId: text("tenant_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceConnectionId: text("source_connection_id").notNull(),
    transitionId: text("transition_id").notNull(),
    revision: bigint("identity_revision", { mode: "bigint" }).notNull(),
    accountGeneration: bigint("account_generation", {
      mode: "bigint"
    }).notNull(),
    state: inboxV2SourceAccountIdentityState("state")
      .notNull()
      .default("verified"),
    ...identityDeclarationColumns(),
    canonicalKeyDigestSha256: text("canonical_key_digest_sha256")
      .generatedAlwaysAs(() =>
        canonicalSourceAccountKeyDigestSql({
          realmId: "canonical_realm_id",
          realmVersion: "canonical_realm_version",
          canonicalizationVersion: "canonicalization_version",
          objectKindId: "canonical_object_kind_id",
          scopeKind: "canonical_scope_kind",
          scopeSourceConnectionId: "canonical_scope_source_connection_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    canonicalRealmId: text("canonical_realm_id").notNull(),
    canonicalRealmVersion: text("canonical_realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    canonicalObjectKindId: text("canonical_object_kind_id").notNull(),
    canonicalScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "canonical_scope_kind"
    ).notNull(),
    canonicalScopeSourceConnectionId: text(
      "canonical_scope_source_connection_id"
    ),
    canonicalScopeOwnerKey: text("canonical_scope_owner_key").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    verifiedDecisionActorTrustedServiceId: text(
      "verified_decision_actor_trusted_service_id"
    ).notNull(),
    verifiedDecisionPolicyId: text("verified_decision_policy_id").notNull(),
    verifiedDecisionPolicyVersion: text(
      "verified_decision_policy_version"
    ).notNull(),
    verifiedDecisionReasonCodeId: text(
      "verified_decision_reason_code_id"
    ).notNull(),
    verifiedDecisionVerificationEvidenceToken: text(
      "verified_decision_verification_evidence_token"
    ).notNull(),
    verifiedDecisionDecidedAt: timestamp("verified_decision_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    identityCreatedAt: timestamp("identity_created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    verifiedAt: timestamp("verified_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_account_identity_verified_snapshots_pk",
      columns: [table.tenantId, table.sourceAccountId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_verified_snapshots_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_verified_snapshots_account_fk",
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
      name: "inbox_v2_account_identity_verified_snapshots_scope_fk",
      columns: [table.tenantId, table.canonicalScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_verified_snapshots_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.sourceAccountId,
        table.revision,
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
    unique("inbox_v2_account_identity_verified_snapshots_surface_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.revision,
      table.accountGeneration,
      table.state,
      table.canonicalKeyDigestSha256,
      table.declarationLoadedByTrustedServiceId,
      table.verifiedDecisionDecidedAt
    ),
    unique("inbox_v2_account_identity_verified_snapshots_target_unique").on(
      table.tenantId,
      table.sourceAccountId,
      table.revision,
      table.accountGeneration,
      table.state,
      table.canonicalKeyDigestSha256
    ),
    unique("inbox_v2_account_identity_verified_snapshots_transition_unique").on(
      table.tenantId,
      table.transitionId
    ),
    check(
      "inbox_v2_account_identity_verified_snapshots_declaration_check",
      sql`${declarationJsonParitySql(table)}
        and ${catalogIdSql(table.declarationContractId)}
        and ${versionTokenSql(table.declarationContractVersion)}
        and ${table.declarationRevision} >= 1
        and ${catalogIdSql(table.declarationSurfaceId)}
        and ${catalogIdSql(table.declarationLoadedByTrustedServiceId)}
        and ${catalogIdSql(table.declarationRealmId)}
        and ${versionTokenSql(table.declarationRealmVersion)}
        and ${versionTokenSql(table.declarationCanonicalizationVersion)}
        and ${catalogIdSql(table.declarationObjectKindId)}
        and ${table.declarationRealmId} = ${table.canonicalRealmId}
        and ${table.declarationRealmVersion} = ${table.canonicalRealmVersion}
        and ${table.declarationCanonicalizationVersion} = ${table.canonicalizationVersion}
        and ${table.declarationObjectKindId} = ${table.canonicalObjectKindId}
        and ${table.declarationScopeKind} = ${table.canonicalScopeKind}`
    ),
    check(
      "inbox_v2_account_identity_verified_snapshots_key_check",
      sql`${table.state} = 'verified'
        and ${table.revision} >= 2
        and ${table.accountGeneration} = ${table.revision}
        and ${sha256DigestSql(table.canonicalKeyDigestSha256)}
        and ${catalogIdSql(table.canonicalRealmId)}
        and ${versionTokenSql(table.canonicalRealmVersion)}
        and ${versionTokenSql(table.canonicalizationVersion)}
        and ${catalogIdSql(table.canonicalObjectKindId)}
        and ${accountScopeSql(
          table.canonicalScopeKind,
          table.canonicalScopeSourceConnectionId,
          table.canonicalScopeOwnerKey,
          table.sourceConnectionId
        )}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}`
    ),
    check(
      "inbox_v2_account_identity_verified_snapshots_decision_check",
      trustedDecisionSql({
        actor: table.verifiedDecisionActorTrustedServiceId,
        pinnedActor: table.declarationLoadedByTrustedServiceId,
        policyId: table.verifiedDecisionPolicyId,
        policyVersion: table.verifiedDecisionPolicyVersion,
        reasonCodeId: table.verifiedDecisionReasonCodeId,
        evidenceToken: table.verifiedDecisionVerificationEvidenceToken,
        decidedAt: table.verifiedDecisionDecidedAt,
        actionAt: table.verifiedAt
      })
    ),
    check(
      "inbox_v2_account_identity_verified_snapshots_timestamps_check",
      sql`isfinite(${table.declarationLoadedAt})
        and isfinite(${table.verifiedDecisionDecidedAt})
        and isfinite(${table.identityCreatedAt})
        and isfinite(${table.verifiedAt})
        and ${table.identityCreatedAt} <= ${table.verifiedAt}
        and ${table.declarationLoadedAt} <= ${table.verifiedAt}`
    ),
    index("inbox_v2_account_identity_verified_snapshots_account_idx").on(
      table.tenantId,
      table.sourceAccountId,
      table.revision.desc()
    ),
    index("inbox_v2_account_identity_verified_snapshots_key_idx").on(
      table.tenantId,
      table.canonicalKeyDigestSha256,
      table.sourceAccountId,
      table.revision.desc()
    )
  ]
);

/** Immutable direct connector/session -> verified SourceAccount alias. */
export const inboxV2SourceAccountIdentityAliases = pgTable(
  "inbox_v2_source_account_identity_aliases",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    provisionalSourceConnectionId: text(
      "provisional_source_connection_id"
    ).notNull(),
    provisionalKeyDigestSha256: text("provisional_key_digest_sha256")
      .generatedAlwaysAs(() =>
        provisionalSourceAccountKeyDigestSql({
          sourceConnectionId: "provisional_source_connection_id",
          contractId: "declaration_contract_id",
          contractVersion: "declaration_contract_version",
          surfaceId: "declaration_surface_id",
          connectorSessionSubject: "provisional_connector_session_subject"
        })
      )
      .notNull(),
    provisionalConnectorSessionSubject: text(
      "provisional_connector_session_subject"
    ).notNull(),
    provisionalObservedAt: timestamp("provisional_observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSourceAccountId: text("canonical_source_account_id").notNull(),
    canonicalKeyDigestSha256: text("canonical_key_digest_sha256")
      .generatedAlwaysAs(() =>
        canonicalSourceAccountKeyDigestSql({
          realmId: "canonical_realm_id",
          realmVersion: "canonical_realm_version",
          canonicalizationVersion: "canonicalization_version",
          objectKindId: "canonical_object_kind_id",
          scopeKind: "canonical_scope_kind",
          scopeSourceConnectionId: "canonical_scope_source_connection_id",
          canonicalExternalSubject: "canonical_external_subject"
        })
      )
      .notNull(),
    canonicalRealmId: text("canonical_realm_id").notNull(),
    canonicalRealmVersion: text("canonical_realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    canonicalObjectKindId: text("canonical_object_kind_id").notNull(),
    canonicalScopeKind: inboxV2SourceAccountIdentityScopeKind(
      "canonical_scope_kind"
    ).notNull(),
    canonicalScopeSourceConnectionId: text(
      "canonical_scope_source_connection_id"
    ),
    canonicalScopeOwnerKey: text("canonical_scope_owner_key").notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    ...identityDeclarationColumns(),
    expectedAccountIdentityRevision: bigint(
      "expected_account_identity_revision",
      { mode: "bigint" }
    ).notNull(),
    expectedAccountGeneration: bigint("expected_account_generation", {
      mode: "bigint"
    }).notNull(),
    targetIdentityState: inboxV2SourceAccountIdentityState(
      "target_identity_state"
    ).notNull(),
    decisionActorTrustedServiceId: text(
      "decision_actor_trusted_service_id"
    ).notNull(),
    decisionPolicyId: text("decision_policy_id").notNull(),
    decisionPolicyVersion: text("decision_policy_version").notNull(),
    decisionReasonCodeId: text("decision_reason_code_id").notNull(),
    decisionVerificationEvidenceToken: text(
      "decision_verification_evidence_token"
    ).notNull(),
    decisionDecidedAt: timestamp("decision_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_account_identity_aliases_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_aliases_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_aliases_provisional_conn_fk",
      columns: [table.tenantId, table.provisionalSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_aliases_provisional_key_fk",
      columns: [
        table.tenantId,
        table.provisionalKeyDigestSha256,
        table.canonicalSourceAccountId,
        table.provisionalSourceConnectionId,
        table.provisionalObservedAt
      ],
      foreignColumns: [
        inboxV2SourceAccountProvisionalIdentityKeys.tenantId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalKeyDigestSha256,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceAccountId,
        inboxV2SourceAccountProvisionalIdentityKeys.sourceConnectionId,
        inboxV2SourceAccountProvisionalIdentityKeys.provisionalObservedAt
      ]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_aliases_scope_owner_fk",
      columns: [table.tenantId, table.canonicalScopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_account_identity_aliases_target_snapshot_fk",
      columns: [
        table.tenantId,
        table.canonicalSourceAccountId,
        table.expectedAccountIdentityRevision,
        table.expectedAccountGeneration,
        table.targetIdentityState,
        table.canonicalKeyDigestSha256
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
    unique("inbox_v2_account_identity_aliases_provisional_key_unique").on(
      table.tenantId,
      table.provisionalKeyDigestSha256
    ),
    unique("inbox_v2_account_identity_aliases_target_edge_unique").on(
      table.tenantId,
      table.id,
      table.canonicalSourceAccountId,
      table.expectedAccountIdentityRevision,
      table.expectedAccountGeneration,
      table.targetIdentityState,
      table.canonicalKeyDigestSha256
    ),
    check(
      "inbox_v2_source_account_identity_aliases_id_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_account_identity_alias:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_account_identity_aliases_declaration_check",
      sql`${declarationJsonParitySql(table)}
        and ${catalogIdSql(table.declarationContractId)}
        and ${versionTokenSql(table.declarationContractVersion)}
        and ${table.declarationRevision} >= 1
        and ${catalogIdSql(table.declarationSurfaceId)}
        and ${catalogIdSql(table.declarationLoadedByTrustedServiceId)}
        and ${catalogIdSql(table.declarationRealmId)}
        and ${versionTokenSql(table.declarationRealmVersion)}
        and ${versionTokenSql(table.declarationCanonicalizationVersion)}
        and ${catalogIdSql(table.declarationObjectKindId)}
        and ${table.declarationRealmId} = ${table.canonicalRealmId}
        and ${table.declarationRealmVersion} = ${table.canonicalRealmVersion}
        and ${table.declarationCanonicalizationVersion} = ${table.canonicalizationVersion}
        and ${table.declarationObjectKindId} = ${table.canonicalObjectKindId}
        and ${table.declarationScopeKind} = ${table.canonicalScopeKind}`
    ),
    check(
      "inbox_v2_account_identity_aliases_keys_check",
      sql`${sha256DigestSql(table.provisionalKeyDigestSha256)}
        and ${opaqueSubjectSql(table.provisionalConnectorSessionSubject)}
        and ${sha256DigestSql(table.canonicalKeyDigestSha256)}
        and ${catalogIdSql(table.canonicalRealmId)}
        and ${versionTokenSql(table.canonicalRealmVersion)}
        and ${versionTokenSql(table.canonicalizationVersion)}
        and ${catalogIdSql(table.canonicalObjectKindId)}
        and ${accountScopeSql(
          table.canonicalScopeKind,
          table.canonicalScopeSourceConnectionId,
          table.canonicalScopeOwnerKey,
          table.provisionalSourceConnectionId
        )}
        and ${opaqueSubjectSql(table.canonicalExternalSubject)}`
    ),
    check(
      "inbox_v2_account_identity_aliases_fence_check",
      sql`${table.expectedAccountIdentityRevision} >= 1
        and ${table.expectedAccountGeneration} = ${table.expectedAccountIdentityRevision}
        and ${table.targetIdentityState} = 'verified'
        and ${table.revision} = 1`
    ),
    check(
      "inbox_v2_account_identity_aliases_decision_check",
      trustedDecisionSql({
        actor: table.decisionActorTrustedServiceId,
        pinnedActor: table.declarationLoadedByTrustedServiceId,
        policyId: table.decisionPolicyId,
        policyVersion: table.decisionPolicyVersion,
        reasonCodeId: table.decisionReasonCodeId,
        evidenceToken: table.decisionVerificationEvidenceToken,
        decidedAt: table.decisionDecidedAt,
        actionAt: table.createdAt
      })
    ),
    check(
      "inbox_v2_account_identity_aliases_timestamps_check",
      sql`isfinite(${table.provisionalObservedAt})
        and isfinite(${table.declarationLoadedAt})
        and isfinite(${table.decisionDecidedAt})
        and isfinite(${table.createdAt})
        and ${table.declarationLoadedAt} <= ${table.provisionalObservedAt}
        and ${table.provisionalObservedAt} <= ${table.createdAt}`
    ),
    index("inbox_v2_account_identity_aliases_tenant_account_idx").on(
      table.tenantId,
      table.canonicalSourceAccountId,
      table.createdAt.desc(),
      table.id
    ),
    index("inbox_v2_account_identity_aliases_tenant_connection_idx").on(
      table.tenantId,
      table.provisionalSourceConnectionId,
      table.createdAt.desc(),
      table.id
    )
  ]
);

type CanonicalSourceAccountDigestColumnNames = Readonly<{
  realmId: string;
  realmVersion: string;
  canonicalizationVersion: string;
  objectKindId: string;
  scopeKind: string;
  scopeSourceConnectionId: string;
  canonicalExternalSubject: string;
}>;

type ProvisionalSourceAccountDigestColumnNames = Readonly<{
  sourceConnectionId: string;
  contractId: string;
  contractVersion: string;
  surfaceId: string;
  connectorSessionSubject: string;
}>;

/**
 * PostgreSQL computes every authority digest from an unambiguous UTF-8 byte
 * tuple. Null has its own marker, every value is byte-length prefixed and
 * backslashes are doubled before text-to-bytea conversion. Adapters therefore
 * cannot choose a digest that bypasses exact-key uniqueness.
 */
function canonicalSourceAccountKeyDigestSql(
  columns: CanonicalSourceAccountDigestColumnNames
): SQL {
  const values = [
    lengthPrefixedColumn(columns.realmId),
    lengthPrefixedColumn(columns.realmVersion),
    lengthPrefixedColumn(columns.canonicalizationVersion),
    lengthPrefixedColumn(columns.objectKindId),
    accountScopeKindColumn(columns.scopeKind),
    lengthPrefixedColumn(columns.scopeSourceConnectionId, true),
    lengthPrefixedColumn(columns.canonicalExternalSubject)
  ];
  const requiredColumns = [
    columns.realmId,
    columns.realmVersion,
    columns.canonicalizationVersion,
    columns.objectKindId,
    columns.scopeKind,
    columns.canonicalExternalSubject
  ].map((column) => sql.identifier(column));

  return sql`case
    when ${sql.join(requiredColumns, sql` is null or `)} is null then null
    else encode(
      sha256(
        replace(
          'source-account-canonical-key:v1|' ||
          ${sql.join(values, sql` || `)},
          chr(92),
          chr(92) || chr(92)
        )::bytea
      ),
      'hex'
    )
  end`;
}

function provisionalSourceAccountKeyDigestSql(
  columns: ProvisionalSourceAccountDigestColumnNames
): SQL {
  const values = [
    lengthPrefixedColumn(columns.sourceConnectionId),
    lengthPrefixedColumn(columns.contractId),
    lengthPrefixedColumn(columns.contractVersion),
    lengthPrefixedColumn(columns.surfaceId),
    lengthPrefixedColumn(columns.connectorSessionSubject)
  ];
  const requiredColumns = Object.values(columns).map((column) =>
    sql.identifier(column)
  );

  return sql`case
    when ${sql.join(requiredColumns, sql` is null or `)} is null then null
    else encode(
      sha256(
        replace(
          'source-account-provisional-key:v1|' ||
          ${sql.join(values, sql` || `)},
          chr(92),
          chr(92) || chr(92)
        )::bytea
      ),
      'hex'
    )
  end`;
}

function accountScopeKindColumn(columnName: string): SQL {
  const column = sql.identifier(columnName);

  return sql`case ${column}
    when 'provider' then '8:provider'
    when 'source_connection' then '17:source_connection'
  end`;
}

function lengthPrefixedColumn(columnName: string, nullable = false): SQL {
  const column = sql.identifier(columnName);

  if (nullable) {
    return sql`case
      when ${column} is null then '-1:'
      else octet_length(${column})::text || ':' || ${column}
    end`;
  }

  return sql`octet_length(${column})::text || ':' || ${column}`;
}

type DeclarationSqlColumns = {
  identityDeclaration: SQLWrapper;
  declarationContractId: SQLWrapper;
  declarationContractVersion: SQLWrapper;
  declarationRevision: SQLWrapper;
  declarationSurfaceId: SQLWrapper;
  declarationLoadedByTrustedServiceId: SQLWrapper;
  declarationLoadedAt: SQLWrapper;
  declarationRealmId: SQLWrapper;
  declarationRealmVersion: SQLWrapper;
  declarationCanonicalizationVersion: SQLWrapper;
  declarationObjectKindId: SQLWrapper;
  declarationScopeKind: SQLWrapper;
};

function declarationJsonParitySql(table: DeclarationSqlColumns): SQL {
  return sql`jsonb_typeof(${table.identityDeclaration}) = 'object'
    and pg_column_size(${table.identityDeclaration}) <= 16384
    and ${table.identityDeclaration} = jsonb_build_object(
      'adapterContract', jsonb_build_object(
        'contractId', ${table.declarationContractId},
        'contractVersion', ${table.declarationContractVersion},
        'declarationRevision', ${table.declarationRevision}::text,
        'surfaceId', ${table.declarationSurfaceId},
        'loadedByTrustedServiceId', ${table.declarationLoadedByTrustedServiceId},
        'loadedAt', ${table.identityDeclaration} #>> '{adapterContract,loadedAt}'
      ),
      'identityKind', 'source_account',
      'realmId', ${table.declarationRealmId},
      'realmVersion', ${table.declarationRealmVersion},
      'canonicalizationVersion', ${table.declarationCanonicalizationVersion},
      'objectKindId', ${table.declarationObjectKindId},
      'scopeKind', ${table.declarationScopeKind}::text,
      'decisionStrength', 'authoritative'
    )
    and (${table.identityDeclaration} #>> '{adapterContract,loadedAt}')
      ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\\.[0-9]{3}(Z|[+-][0-9]{2}:[0-9]{2})$'
    and (${table.identityDeclaration} #>> '{adapterContract,loadedAt}')::timestamptz
      = ${table.declarationLoadedAt}`;
}

type SourceAccountIdentityStateSqlColumns = {
  state: SQLWrapper;
  expectedScopeKind: SQLWrapper;
  expectedScopeSourceConnectionId: SQLWrapper;
  expectedScopeOwnerKey: SQLWrapper;
  provisionalKeyDigestSha256: SQLWrapper;
  provisionalConnectorSessionSubject: SQLWrapper;
  provisionalObservedAt: SQLWrapper;
  canonicalKeyDigestSha256: SQLWrapper;
  canonicalRealmId: SQLWrapper;
  canonicalRealmVersion: SQLWrapper;
  canonicalizationVersion: SQLWrapper;
  canonicalObjectKindId: SQLWrapper;
  canonicalScopeKind: SQLWrapper;
  canonicalScopeSourceConnectionId: SQLWrapper;
  canonicalScopeOwnerKey: SQLWrapper;
  canonicalExternalSubject: SQLWrapper;
  verifiedDecisionActorTrustedServiceId: SQLWrapper;
  verifiedDecisionPolicyId: SQLWrapper;
  verifiedDecisionPolicyVersion: SQLWrapper;
  verifiedDecisionReasonCodeId: SQLWrapper;
  verifiedDecisionVerificationEvidenceToken: SQLWrapper;
  verifiedDecisionDecidedAt: SQLWrapper;
  declarationLoadedByTrustedServiceId: SQLWrapper;
  activeConflictRevision: SQLWrapper;
  revision: SQLWrapper;
  updatedAt: SQLWrapper;
};

function sourceAccountIdentityStateSql(
  table: SourceAccountIdentityStateSqlColumns
): SQL {
  return sql`(
    ${table.state} = 'provisional'
    and ${table.expectedScopeKind} is not null
    and ${table.expectedScopeOwnerKey} is not null
    and ${table.provisionalKeyDigestSha256} is not null
    and ${table.provisionalConnectorSessionSubject} is not null
    and ${table.provisionalObservedAt} is not null
    and num_nonnulls(
      ${table.canonicalKeyDigestSha256},
      ${table.canonicalRealmId},
      ${table.canonicalRealmVersion},
      ${table.canonicalizationVersion},
      ${table.canonicalObjectKindId},
      ${table.canonicalScopeKind},
      ${table.canonicalScopeSourceConnectionId},
      ${table.canonicalScopeOwnerKey},
      ${table.canonicalExternalSubject},
      ${table.verifiedDecisionActorTrustedServiceId},
      ${table.verifiedDecisionPolicyId},
      ${table.verifiedDecisionPolicyVersion},
      ${table.verifiedDecisionReasonCodeId},
      ${table.verifiedDecisionVerificationEvidenceToken},
      ${table.verifiedDecisionDecidedAt},
      ${table.activeConflictRevision}
    ) = 0
  ) or (
    ${table.state} = 'verified'
    and num_nonnulls(
      ${table.expectedScopeKind},
      ${table.expectedScopeSourceConnectionId},
      ${table.expectedScopeOwnerKey},
      ${table.provisionalKeyDigestSha256},
      ${table.provisionalConnectorSessionSubject},
      ${table.provisionalObservedAt},
      ${table.activeConflictRevision}
    ) = 0
    and ${table.canonicalKeyDigestSha256} is not null
    and ${table.canonicalRealmId} is not null
    and ${table.canonicalRealmVersion} is not null
    and ${table.canonicalizationVersion} is not null
    and ${table.canonicalObjectKindId} is not null
    and ${table.canonicalScopeKind} is not null
    and ${table.canonicalScopeOwnerKey} is not null
    and ${table.canonicalExternalSubject} is not null
    and ${table.verifiedDecisionActorTrustedServiceId} is not null
    and ${table.verifiedDecisionPolicyId} is not null
    and ${table.verifiedDecisionPolicyVersion} is not null
    and ${table.verifiedDecisionReasonCodeId} is not null
    and ${table.verifiedDecisionVerificationEvidenceToken} is not null
    and ${table.verifiedDecisionDecidedAt} = ${table.updatedAt}
    and ${trustedDecisionSql({
      actor: table.verifiedDecisionActorTrustedServiceId,
      pinnedActor: table.declarationLoadedByTrustedServiceId,
      policyId: table.verifiedDecisionPolicyId,
      policyVersion: table.verifiedDecisionPolicyVersion,
      reasonCodeId: table.verifiedDecisionReasonCodeId,
      evidenceToken: table.verifiedDecisionVerificationEvidenceToken,
      decidedAt: table.verifiedDecisionDecidedAt,
      actionAt: table.updatedAt
    })}
  ) or (
    ${table.state} = 'conflicted'
    and ${table.expectedScopeKind} is not null
    and ${table.expectedScopeOwnerKey} is not null
    and ${table.provisionalKeyDigestSha256} is not null
    and ${table.provisionalConnectorSessionSubject} is not null
    and ${table.provisionalObservedAt} is not null
    and ${table.activeConflictRevision} = ${table.revision}
    and num_nonnulls(
      ${table.canonicalKeyDigestSha256},
      ${table.canonicalRealmId},
      ${table.canonicalRealmVersion},
      ${table.canonicalizationVersion},
      ${table.canonicalObjectKindId},
      ${table.canonicalScopeKind},
      ${table.canonicalScopeSourceConnectionId},
      ${table.canonicalScopeOwnerKey},
      ${table.canonicalExternalSubject},
      ${table.verifiedDecisionActorTrustedServiceId},
      ${table.verifiedDecisionPolicyId},
      ${table.verifiedDecisionPolicyVersion},
      ${table.verifiedDecisionReasonCodeId},
      ${table.verifiedDecisionVerificationEvidenceToken},
      ${table.verifiedDecisionDecidedAt}
    ) = 0
  )`;
}

function transitionCasSql(table: Record<string, SQLWrapper>): SQL {
  return sql`(
    ${table.intent} = 'create_provisional'
    and ${table.fromState} is null
    and ${table.toState} = 'provisional'
    and num_nonnulls(
      ${table.expectedRevision},
      ${table.currentRevision},
      ${table.expectedAccountGeneration},
      ${table.currentAccountGeneration}
    ) = 0
    and ${table.resultingRevision} = 1
    and ${table.resultingAccountGeneration} = 1
  ) or (
    ${table.intent} = 'promote_verified'
    and ${table.fromState} = 'provisional'
    and ${table.toState} = 'verified'
    and ${nonCreateCasSql(table)}
  ) or (
    ${table.intent} = 'reauthenticate_verified'
    and ${table.fromState} = 'verified'
    and ${table.toState} = 'verified'
    and ${nonCreateCasSql(table)}
  ) or (
    ${table.intent} = 'mark_conflicted'
    and ${table.fromState} = 'provisional'
    and ${table.toState} = 'conflicted'
    and ${nonCreateCasSql(table)}
  ) or (
    ${table.intent} = 'resolve_conflict'
    and ${table.fromState} = 'conflicted'
    and ${table.toState} = 'verified'
    and ${nonCreateCasSql(table)}
  )`;
}

function nonCreateCasSql(table: Record<string, SQLWrapper>): SQL {
  return sql`${table.expectedRevision} is not null
    and ${table.expectedRevision} = ${table.currentRevision}
    and ${table.resultingRevision} = ${table.currentRevision} + 1
    and ${table.expectedAccountGeneration} is not null
    and ${table.expectedAccountGeneration} = ${table.currentAccountGeneration}
    and ${table.resultingAccountGeneration} = ${table.currentAccountGeneration} + 1
    and ${table.expectedRevision} = ${table.expectedAccountGeneration}
    and ${table.resultingRevision} = ${table.resultingAccountGeneration}`;
}

function accountScopeSql(
  kind: SQLWrapper,
  ownerId: SQLWrapper,
  ownerKey: SQLWrapper,
  owningConnectionId: SQLWrapper
): SQL {
  return sql`(
    ${kind} = 'provider'
    and ${ownerId} is null
    and ${ownerKey} = 'provider'
  ) or (
    ${kind} = 'source_connection'
    and ${ownerId} = ${owningConnectionId}
    and ${ownerKey} = ${ownerId}
  )`;
}

function trustedDecisionSql(input: {
  actor: SQLWrapper;
  pinnedActor: SQLWrapper;
  policyId: SQLWrapper;
  policyVersion: SQLWrapper;
  reasonCodeId: SQLWrapper;
  evidenceToken: SQLWrapper;
  decidedAt: SQLWrapper;
  actionAt: SQLWrapper;
}): SQL {
  return sql`${input.actor} = ${input.pinnedActor}
    and ${catalogIdSql(input.actor)}
    and ${catalogIdSql(input.policyId)}
    and ${versionTokenSql(input.policyVersion)}
    and ${catalogIdSql(input.reasonCodeId)}
    and ${routingTokenSql(input.evidenceToken)}
    and ${input.decidedAt} = ${input.actionAt}`;
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

function sha256DigestSql(column: SQLWrapper): SQL {
  return sql`${column} ~ '^[a-f0-9]{64}$'`;
}

/**
 * Drizzle does not model deferred constraint triggers. The final generated
 * migration must append this exact block after the account-identity tables
 * have been created. It turns the bounded transition/conflict commit contract
 * into a database invariant while retaining an insertion order without an
 * immediate FK cycle: registry -> current/evidence -> transition/alias.
 */
export const INBOX_V2_SOURCE_ACCOUNT_IDENTITY_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_assert_account_provisional_key(
  checked_tenant_id text,
  checked_key_digest text,
  checked_source_account_id text,
  checked_source_connection_id text,
  checked_contract_id text,
  checked_contract_version text,
  checked_surface_id text,
  checked_connector_session_subject text,
  checked_provisional_observed_at timestamptz
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  key_row record;
begin
  select *
    into key_row
    from public.inbox_v2_source_account_provisional_keys
   where tenant_id = checked_tenant_id
     and provisional_key_digest_sha256 = checked_key_digest;

  if not found
     or key_row.source_account_id is distinct from checked_source_account_id
     or key_row.source_connection_id is distinct from checked_source_connection_id
     or key_row.declaration_contract_id is distinct from checked_contract_id
     or key_row.declaration_contract_version is distinct from checked_contract_version
     or key_row.declaration_surface_id is distinct from checked_surface_id
     or key_row.connector_session_subject
       is distinct from checked_connector_session_subject
     or key_row.provisional_observed_at
       is distinct from checked_provisional_observed_at then
    raise exception 'provisional key registry does not match the exact raw fingerprint'
      using errcode = '23514';
  end if;
end
$function$;

create or replace function public.inbox_v2_assert_account_identity_conflict(
  checked_tenant_id text,
  checked_source_account_id text,
  checked_identity_revision bigint
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  conflict_row record;
  candidate_stats record;
  identity_row record;
  transition_row record;
begin
  select *
    into conflict_row
    from public.inbox_v2_source_account_identity_conflicts
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and identity_revision = checked_identity_revision;

  if not found then
    raise exception 'missing source account identity conflict evidence'
      using errcode = '23514';
  end if;

  perform public.inbox_v2_assert_account_provisional_key(
    conflict_row.tenant_id,
    conflict_row.provisional_key_digest_sha256,
    conflict_row.source_account_id,
    conflict_row.source_connection_id,
    conflict_row.declaration_contract_id,
    conflict_row.declaration_contract_version,
    conflict_row.declaration_surface_id,
    conflict_row.provisional_connector_session_subject,
    conflict_row.provisional_observed_at
  );

  select
    count(*)::integer as actual_count,
    min(candidate.ordinal)::integer as minimum_ordinal,
    max(candidate.ordinal)::integer as maximum_ordinal,
    bool_and(
      candidate.realm_id = conflict_row.declaration_realm_id
      and candidate.realm_version = conflict_row.declaration_realm_version
      and candidate.canonicalization_version = conflict_row.declaration_canonicalization_version
      and candidate.object_kind_id = conflict_row.declaration_object_kind_id
      and candidate.scope_kind = conflict_row.declaration_scope_kind
      and candidate.scope_source_connection_id
        is not distinct from conflict_row.expected_scope_source_connection_id
      and candidate.scope_owner_key = conflict_row.expected_scope_owner_key
    ) as declaration_matches
    into candidate_stats
    from public.inbox_v2_source_account_identity_conflict_candidates candidate
   where candidate.tenant_id = checked_tenant_id
     and candidate.source_account_id = checked_source_account_id
     and candidate.identity_revision = checked_identity_revision;

  if candidate_stats.actual_count <> conflict_row.candidate_count
     or candidate_stats.minimum_ordinal <> 1
     or candidate_stats.maximum_ordinal <> conflict_row.candidate_count
     or candidate_stats.declaration_matches is distinct from true then
    raise exception 'source account identity conflict candidates are not exact and contiguous'
      using errcode = '23514';
  end if;

  select *
    into identity_row
    from public.inbox_v2_source_account_identities
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and revision = checked_identity_revision
     and state = 'conflicted'
     and active_conflict_revision = checked_identity_revision;

  if not found then
    raise exception 'source account identity conflict evidence has no exact current result'
      using errcode = '23514';
  end if;

  select *
    into transition_row
    from public.inbox_v2_source_account_identity_transitions
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and resulting_revision = checked_identity_revision
     and intent = 'mark_conflicted';

  if not found then
    raise exception 'source account identity conflict evidence has no exact inducing transition'
      using errcode = '23514';
  end if;

  if transition_row.to_state is distinct from identity_row.state
     or transition_row.resulting_account_generation
       is distinct from identity_row.account_generation
     or transition_row.occurred_at is distinct from identity_row.updated_at
     or transition_row.pinned_declaration_trusted_service_id
       is distinct from identity_row.declaration_loaded_by_trusted_service_id
     or conflict_row.source_connection_id
       is distinct from identity_row.source_connection_id
     or conflict_row.expected_scope_kind
       is distinct from identity_row.expected_scope_kind
     or conflict_row.expected_scope_source_connection_id
       is distinct from identity_row.expected_scope_source_connection_id
     or conflict_row.expected_scope_owner_key
       is distinct from identity_row.expected_scope_owner_key
     or conflict_row.provisional_key_digest_sha256
       is distinct from identity_row.provisional_key_digest_sha256
     or conflict_row.provisional_key_digest_sha256
       is distinct from transition_row.provisional_key_digest_sha256
     or conflict_row.provisional_connector_session_subject
       is distinct from identity_row.provisional_connector_session_subject
     or conflict_row.provisional_observed_at
       is distinct from identity_row.provisional_observed_at
     or conflict_row.provisional_observed_at
       is distinct from transition_row.provisional_observed_at
     or conflict_row.declaration_contract_id
       is distinct from identity_row.declaration_contract_id
     or conflict_row.declaration_contract_version
       is distinct from identity_row.declaration_contract_version
     or conflict_row.declaration_revision
       is distinct from identity_row.declaration_revision
     or conflict_row.declaration_surface_id
       is distinct from identity_row.declaration_surface_id
     or conflict_row.declaration_loaded_by_trusted_service_id
       is distinct from identity_row.declaration_loaded_by_trusted_service_id
     or conflict_row.declaration_loaded_at
       is distinct from identity_row.declaration_loaded_at
     or conflict_row.declaration_realm_id
       is distinct from identity_row.declaration_realm_id
     or conflict_row.declaration_realm_version
       is distinct from identity_row.declaration_realm_version
     or conflict_row.declaration_canonicalization_version
       is distinct from identity_row.declaration_canonicalization_version
     or conflict_row.declaration_object_kind_id
       is distinct from identity_row.declaration_object_kind_id
     or conflict_row.declaration_scope_kind
       is distinct from identity_row.declaration_scope_kind
     or conflict_row.decision_actor_trusted_service_id
       is distinct from transition_row.decision_actor_trusted_service_id
     or conflict_row.decision_policy_id
       is distinct from transition_row.decision_policy_id
     or conflict_row.decision_policy_version
       is distinct from transition_row.decision_policy_version
     or conflict_row.decision_reason_code_id
       is distinct from transition_row.decision_reason_code_id
     or conflict_row.decision_verification_evidence_token
       is distinct from transition_row.decision_verification_evidence_token
     or conflict_row.decision_decided_at
       is distinct from transition_row.decision_decided_at
     or conflict_row.detected_at is distinct from identity_row.updated_at
     or conflict_row.detected_at is distinct from transition_row.occurred_at then
    raise exception 'conflicted identity does not induce its exact evidence snapshot'
      using errcode = '23514';
  end if;
end
$function$;

create or replace function public.inbox_v2_assert_account_verified_snapshot(
  checked_tenant_id text,
  checked_source_account_id text,
  checked_identity_revision bigint
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  snapshot_row record;
  transition_row record;
  predecessor_snapshot_row record;
  alias_row record;
begin
  select *
    into snapshot_row
    from public.inbox_v2_source_account_identity_verified_snapshots
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and identity_revision = checked_identity_revision;

  if not found then
    raise exception 'missing verified source account generation snapshot'
      using errcode = '23514';
  end if;

  select *
    into transition_row
    from public.inbox_v2_source_account_identity_transitions
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and resulting_revision = checked_identity_revision;

  if not found
     or transition_row.id is distinct from snapshot_row.transition_id
     or transition_row.intent not in (
       'promote_verified', 'resolve_conflict', 'reauthenticate_verified'
     )
     or transition_row.to_state is distinct from 'verified'
     or transition_row.resulting_account_generation
       is distinct from snapshot_row.account_generation
     or transition_row.pinned_declaration_trusted_service_id
       is distinct from snapshot_row.declaration_loaded_by_trusted_service_id
     or transition_row.decision_actor_trusted_service_id
       is distinct from snapshot_row.verified_decision_actor_trusted_service_id
     or transition_row.decision_policy_id
       is distinct from snapshot_row.verified_decision_policy_id
     or transition_row.decision_policy_version
       is distinct from snapshot_row.verified_decision_policy_version
     or transition_row.decision_reason_code_id
       is distinct from snapshot_row.verified_decision_reason_code_id
     or transition_row.decision_verification_evidence_token
       is distinct from snapshot_row.verified_decision_verification_evidence_token
     or transition_row.decision_decided_at
       is distinct from snapshot_row.verified_decision_decided_at
     or transition_row.occurred_at is distinct from snapshot_row.verified_at then
    raise exception 'verified account snapshot differs from its inducing transition'
      using errcode = '23514';
  end if;

  select *
    into alias_row
    from public.inbox_v2_source_account_identity_aliases
   where tenant_id = checked_tenant_id
     and canonical_source_account_id = checked_source_account_id
     and provisional_key_digest_sha256 =
       transition_row.provisional_key_digest_sha256
     and provisional_observed_at = transition_row.provisional_observed_at
     and expected_account_identity_revision = snapshot_row.identity_revision
     and expected_account_generation = snapshot_row.account_generation
     and target_identity_state = snapshot_row.state
     and canonical_key_digest_sha256 = snapshot_row.canonical_key_digest_sha256
     and decision_actor_trusted_service_id =
       transition_row.decision_actor_trusted_service_id
     and decision_policy_id = transition_row.decision_policy_id
     and decision_policy_version = transition_row.decision_policy_version
     and decision_reason_code_id = transition_row.decision_reason_code_id
     and decision_verification_evidence_token =
       transition_row.decision_verification_evidence_token
     and decision_decided_at = transition_row.decision_decided_at
     and created_at = transition_row.occurred_at
   limit 1;

  if not found
     or alias_row.provisional_source_connection_id
       is distinct from snapshot_row.source_connection_id
     or alias_row.identity_declaration is distinct from snapshot_row.identity_declaration
     or alias_row.canonical_realm_id is distinct from snapshot_row.canonical_realm_id
     or alias_row.canonical_realm_version
       is distinct from snapshot_row.canonical_realm_version
     or alias_row.canonicalization_version
       is distinct from snapshot_row.canonicalization_version
     or alias_row.canonical_object_kind_id
       is distinct from snapshot_row.canonical_object_kind_id
     or alias_row.canonical_scope_kind
       is distinct from snapshot_row.canonical_scope_kind
     or alias_row.canonical_scope_source_connection_id
       is distinct from snapshot_row.canonical_scope_source_connection_id
     or alias_row.canonical_scope_owner_key
       is distinct from snapshot_row.canonical_scope_owner_key
     or alias_row.canonical_external_subject
       is distinct from snapshot_row.canonical_external_subject then
    raise exception 'verified account generation has no exact inducing alias'
      using errcode = '23514';
  end if;

  if transition_row.intent = 'reauthenticate_verified' then
    select *
      into predecessor_snapshot_row
      from public.inbox_v2_source_account_identity_verified_snapshots
     where tenant_id = checked_tenant_id
       and source_account_id = checked_source_account_id
       and identity_revision = transition_row.current_revision;

    if not found
       or predecessor_snapshot_row.account_generation
         is distinct from transition_row.current_account_generation
       or predecessor_snapshot_row.source_connection_id
         is distinct from snapshot_row.source_connection_id
       or predecessor_snapshot_row.identity_declaration
         is distinct from snapshot_row.identity_declaration
       or predecessor_snapshot_row.canonical_key_digest_sha256
         is distinct from snapshot_row.canonical_key_digest_sha256
       or predecessor_snapshot_row.canonical_realm_id
         is distinct from snapshot_row.canonical_realm_id
       or predecessor_snapshot_row.canonical_realm_version
         is distinct from snapshot_row.canonical_realm_version
       or predecessor_snapshot_row.canonicalization_version
         is distinct from snapshot_row.canonicalization_version
       or predecessor_snapshot_row.canonical_object_kind_id
         is distinct from snapshot_row.canonical_object_kind_id
       or predecessor_snapshot_row.canonical_scope_kind
         is distinct from snapshot_row.canonical_scope_kind
       or predecessor_snapshot_row.canonical_scope_source_connection_id
         is distinct from snapshot_row.canonical_scope_source_connection_id
       or predecessor_snapshot_row.canonical_scope_owner_key
         is distinct from snapshot_row.canonical_scope_owner_key
       or predecessor_snapshot_row.canonical_external_subject
         is distinct from snapshot_row.canonical_external_subject
       or predecessor_snapshot_row.identity_created_at
         is distinct from snapshot_row.identity_created_at
       or predecessor_snapshot_row.verified_at > snapshot_row.verified_at then
      raise exception 'reauthentication changed the canonical account history anchor'
        using errcode = '23514';
    end if;
  end if;
end
$function$;

create or replace function public.inbox_v2_assert_account_identity_transition(
  checked_tenant_id text,
  checked_source_account_id text,
  checked_resulting_revision bigint
) returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  identity_row record;
  transition_row record;
  predecessor_row record;
  snapshot_row record;
  conflict_row record;
begin
  select *
    into identity_row
    from public.inbox_v2_source_account_identities
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and revision = checked_resulting_revision;

  if not found then
    raise exception 'identity transition has no exact current result'
      using errcode = '23514';
  end if;

  select *
    into transition_row
    from public.inbox_v2_source_account_identity_transitions
   where tenant_id = checked_tenant_id
     and source_account_id = checked_source_account_id
     and resulting_revision = checked_resulting_revision;

  if not found then
    raise exception 'current account identity has no inducing transition'
      using errcode = '23514';
  end if;

  if transition_row.to_state is distinct from identity_row.state
     or transition_row.resulting_account_generation
       is distinct from identity_row.account_generation
     or transition_row.occurred_at is distinct from identity_row.updated_at
     or transition_row.pinned_declaration_trusted_service_id
       is distinct from identity_row.declaration_loaded_by_trusted_service_id then
    raise exception 'identity transition does not induce the exact current result fence'
      using errcode = '23514';
  end if;

  perform 1
    from public.inbox_v2_source_account_provisional_keys provisional_key
   where provisional_key.tenant_id = checked_tenant_id
     and provisional_key.source_account_id = checked_source_account_id
     and provisional_key.provisional_key_digest_sha256 =
       transition_row.provisional_key_digest_sha256
     and provisional_key.provisional_observed_at =
       transition_row.provisional_observed_at
     and provisional_key.source_connection_id = identity_row.source_connection_id
     and provisional_key.created_at <= transition_row.occurred_at;

  if not found then
    raise exception 'identity transition provisional key belongs to another account'
      using errcode = '23514';
  end if;

  if identity_row.state in ('provisional', 'conflicted') then
    perform public.inbox_v2_assert_account_provisional_key(
      identity_row.tenant_id,
      identity_row.provisional_key_digest_sha256,
      identity_row.source_account_id,
      identity_row.source_connection_id,
      identity_row.declaration_contract_id,
      identity_row.declaration_contract_version,
      identity_row.declaration_surface_id,
      identity_row.provisional_connector_session_subject,
      identity_row.provisional_observed_at
    );
  end if;

  if transition_row.intent = 'create_provisional' then
    if identity_row.provisional_key_digest_sha256
         is distinct from transition_row.provisional_key_digest_sha256
       or identity_row.provisional_observed_at
         is distinct from transition_row.provisional_observed_at then
      raise exception 'initial identity transition does not induce its provisional key'
        using errcode = '23514';
    end if;
  else
    select *
      into predecessor_row
      from public.inbox_v2_source_account_identity_transitions
     where tenant_id = checked_tenant_id
       and source_account_id = checked_source_account_id
       and resulting_revision = transition_row.current_revision;

    if not found
       or predecessor_row.resulting_account_generation
         is distinct from transition_row.current_account_generation
       or predecessor_row.to_state is distinct from transition_row.from_state
       or (
         transition_row.intent <> 'reauthenticate_verified'
         and (
           predecessor_row.provisional_key_digest_sha256
             is distinct from transition_row.provisional_key_digest_sha256
           or predecessor_row.provisional_observed_at
             is distinct from transition_row.provisional_observed_at
         )
       )
       or predecessor_row.pinned_declaration_trusted_service_id
         is distinct from transition_row.pinned_declaration_trusted_service_id
       or predecessor_row.occurred_at > transition_row.occurred_at then
      raise exception 'identity transition predecessor is missing or discontinuous'
        using errcode = '23514';
    end if;
  end if;

  if identity_row.state = 'verified' then
    if identity_row.verified_decision_actor_trusted_service_id
         is distinct from transition_row.decision_actor_trusted_service_id
       or identity_row.verified_decision_policy_id
         is distinct from transition_row.decision_policy_id
       or identity_row.verified_decision_policy_version
         is distinct from transition_row.decision_policy_version
       or identity_row.verified_decision_reason_code_id
         is distinct from transition_row.decision_reason_code_id
       or identity_row.verified_decision_verification_evidence_token
         is distinct from transition_row.decision_verification_evidence_token
       or identity_row.verified_decision_decided_at
         is distinct from transition_row.decision_decided_at then
      raise exception 'verified identity decision differs from its transition'
        using errcode = '23514';
    end if;

    select *
      into snapshot_row
      from public.inbox_v2_source_account_identity_verified_snapshots
     where tenant_id = checked_tenant_id
       and source_account_id = checked_source_account_id
       and identity_revision = identity_row.revision;

    if not found
       or snapshot_row.source_connection_id
         is distinct from identity_row.source_connection_id
       or snapshot_row.account_generation
         is distinct from identity_row.account_generation
       or snapshot_row.state is distinct from identity_row.state
       or snapshot_row.identity_declaration
         is distinct from identity_row.identity_declaration
       or snapshot_row.canonical_key_digest_sha256
         is distinct from identity_row.canonical_key_digest_sha256
       or snapshot_row.canonical_realm_id
         is distinct from identity_row.canonical_realm_id
       or snapshot_row.canonical_realm_version
         is distinct from identity_row.canonical_realm_version
       or snapshot_row.canonicalization_version
         is distinct from identity_row.canonicalization_version
       or snapshot_row.canonical_object_kind_id
         is distinct from identity_row.canonical_object_kind_id
       or snapshot_row.canonical_scope_kind
         is distinct from identity_row.canonical_scope_kind
       or snapshot_row.canonical_scope_source_connection_id
         is distinct from identity_row.canonical_scope_source_connection_id
       or snapshot_row.canonical_scope_owner_key
         is distinct from identity_row.canonical_scope_owner_key
       or snapshot_row.canonical_external_subject
         is distinct from identity_row.canonical_external_subject
       or snapshot_row.verified_decision_actor_trusted_service_id
         is distinct from identity_row.verified_decision_actor_trusted_service_id
       or snapshot_row.verified_decision_policy_id
         is distinct from identity_row.verified_decision_policy_id
       or snapshot_row.verified_decision_policy_version
         is distinct from identity_row.verified_decision_policy_version
       or snapshot_row.verified_decision_reason_code_id
         is distinct from identity_row.verified_decision_reason_code_id
       or snapshot_row.verified_decision_verification_evidence_token
         is distinct from identity_row.verified_decision_verification_evidence_token
       or snapshot_row.verified_decision_decided_at
         is distinct from identity_row.verified_decision_decided_at
       or snapshot_row.identity_created_at is distinct from identity_row.created_at
       or snapshot_row.verified_at is distinct from identity_row.updated_at then
      raise exception 'current verified identity differs from append-only generation authority'
        using errcode = '23514';
    end if;

    perform public.inbox_v2_assert_account_verified_snapshot(
      checked_tenant_id,
      checked_source_account_id,
      identity_row.revision
    );
  elsif identity_row.state = 'conflicted' then
    select *
      into conflict_row
      from public.inbox_v2_source_account_identity_conflicts
     where tenant_id = checked_tenant_id
       and source_account_id = checked_source_account_id
       and identity_revision = identity_row.active_conflict_revision;

    if not found
       or conflict_row.source_connection_id
         is distinct from identity_row.source_connection_id
       or conflict_row.expected_scope_kind
         is distinct from identity_row.expected_scope_kind
       or conflict_row.expected_scope_source_connection_id
         is distinct from identity_row.expected_scope_source_connection_id
       or conflict_row.expected_scope_owner_key
         is distinct from identity_row.expected_scope_owner_key
       or conflict_row.provisional_key_digest_sha256
         is distinct from identity_row.provisional_key_digest_sha256
       or conflict_row.provisional_key_digest_sha256
         is distinct from transition_row.provisional_key_digest_sha256
       or conflict_row.provisional_connector_session_subject
         is distinct from identity_row.provisional_connector_session_subject
       or conflict_row.provisional_observed_at
         is distinct from identity_row.provisional_observed_at
       or conflict_row.provisional_observed_at
         is distinct from transition_row.provisional_observed_at
       or conflict_row.declaration_contract_id
         is distinct from identity_row.declaration_contract_id
       or conflict_row.declaration_contract_version
         is distinct from identity_row.declaration_contract_version
       or conflict_row.declaration_revision
         is distinct from identity_row.declaration_revision
       or conflict_row.declaration_surface_id
         is distinct from identity_row.declaration_surface_id
       or conflict_row.declaration_loaded_by_trusted_service_id
         is distinct from identity_row.declaration_loaded_by_trusted_service_id
       or conflict_row.declaration_loaded_at
         is distinct from identity_row.declaration_loaded_at
       or conflict_row.declaration_realm_id
         is distinct from identity_row.declaration_realm_id
       or conflict_row.declaration_realm_version
         is distinct from identity_row.declaration_realm_version
       or conflict_row.declaration_canonicalization_version
         is distinct from identity_row.declaration_canonicalization_version
       or conflict_row.declaration_object_kind_id
         is distinct from identity_row.declaration_object_kind_id
       or conflict_row.declaration_scope_kind
         is distinct from identity_row.declaration_scope_kind
       or conflict_row.decision_actor_trusted_service_id
         is distinct from transition_row.decision_actor_trusted_service_id
       or conflict_row.decision_policy_id
         is distinct from transition_row.decision_policy_id
       or conflict_row.decision_policy_version
         is distinct from transition_row.decision_policy_version
       or conflict_row.decision_reason_code_id
         is distinct from transition_row.decision_reason_code_id
       or conflict_row.decision_verification_evidence_token
         is distinct from transition_row.decision_verification_evidence_token
       or conflict_row.decision_decided_at
         is distinct from transition_row.decision_decided_at
       or conflict_row.detected_at is distinct from identity_row.updated_at then
      raise exception 'conflicted identity does not induce its exact evidence snapshot'
        using errcode = '23514';
    end if;

    perform public.inbox_v2_assert_account_identity_conflict(
      checked_tenant_id,
      checked_source_account_id,
      identity_row.active_conflict_revision
    );
  end if;
end
$function$;

create or replace function public.inbox_v2_check_account_identity_alias_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  snapshot_row record;
begin
  perform public.inbox_v2_assert_account_provisional_key(
    new.tenant_id,
    new.provisional_key_digest_sha256,
    new.canonical_source_account_id,
    new.provisional_source_connection_id,
    new.declaration_contract_id,
    new.declaration_contract_version,
    new.declaration_surface_id,
    new.provisional_connector_session_subject,
    new.provisional_observed_at
  );

  select *
    into snapshot_row
    from public.inbox_v2_source_account_identity_verified_snapshots
   where tenant_id = new.tenant_id
     and source_account_id = new.canonical_source_account_id
     and identity_revision = new.expected_account_identity_revision
     and account_generation = new.expected_account_generation
     and state = new.target_identity_state
     and canonical_key_digest_sha256 = new.canonical_key_digest_sha256;

  if not found
     or snapshot_row.source_connection_id
       is distinct from new.provisional_source_connection_id
     or snapshot_row.identity_declaration is distinct from new.identity_declaration
     or snapshot_row.canonical_realm_id is distinct from new.canonical_realm_id
     or snapshot_row.canonical_realm_version
       is distinct from new.canonical_realm_version
     or snapshot_row.canonicalization_version
       is distinct from new.canonicalization_version
     or snapshot_row.canonical_object_kind_id
       is distinct from new.canonical_object_kind_id
     or snapshot_row.canonical_scope_kind
       is distinct from new.canonical_scope_kind
     or snapshot_row.canonical_scope_source_connection_id
       is distinct from new.canonical_scope_source_connection_id
     or snapshot_row.canonical_scope_owner_key
       is distinct from new.canonical_scope_owner_key
     or snapshot_row.canonical_external_subject
       is distinct from new.canonical_external_subject then
    raise exception 'account alias differs from its immutable verified generation'
      using errcode = '23514';
  end if;

  perform 1
    from public.inbox_v2_source_account_identity_transitions transition_row
   where transition_row.tenant_id = new.tenant_id
     and transition_row.id = snapshot_row.transition_id
     and transition_row.source_account_id = new.canonical_source_account_id
     and transition_row.resulting_revision = new.expected_account_identity_revision
     and transition_row.resulting_account_generation =
       new.expected_account_generation
     and transition_row.provisional_key_digest_sha256 =
       new.provisional_key_digest_sha256
     and transition_row.provisional_observed_at = new.provisional_observed_at
     and transition_row.decision_actor_trusted_service_id =
       new.decision_actor_trusted_service_id
     and transition_row.decision_policy_id = new.decision_policy_id
     and transition_row.decision_policy_version = new.decision_policy_version
     and transition_row.decision_reason_code_id = new.decision_reason_code_id
     and transition_row.decision_verification_evidence_token =
       new.decision_verification_evidence_token
     and transition_row.decision_decided_at = new.decision_decided_at
     and transition_row.occurred_at = new.created_at;

  if not found then
    raise exception 'account alias does not match its exact verified transition'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_check_account_verified_snapshot_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_account_verified_snapshot(
    new.tenant_id,
    new.source_account_id,
    new.identity_revision
  );
  return new;
end
$function$;

create or replace function public.inbox_v2_reject_account_identity_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception 'source account identity evidence is immutable'
    using errcode = '55000';
end
$function$;

create or replace function public.inbox_v2_guard_account_identity_stable_edge()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.tenant_id is distinct from new.tenant_id
     or old.source_account_id is distinct from new.source_account_id
     or old.source_connection_id is distinct from new.source_connection_id
     or old.identity_declaration is distinct from new.identity_declaration
     or old.declaration_contract_id is distinct from new.declaration_contract_id
     or old.declaration_contract_version is distinct from new.declaration_contract_version
     or old.declaration_revision is distinct from new.declaration_revision
     or old.declaration_surface_id is distinct from new.declaration_surface_id
     or old.declaration_loaded_by_trusted_service_id
       is distinct from new.declaration_loaded_by_trusted_service_id
     or old.declaration_loaded_at is distinct from new.declaration_loaded_at
     or old.declaration_realm_id is distinct from new.declaration_realm_id
     or old.declaration_realm_version is distinct from new.declaration_realm_version
     or old.declaration_canonicalization_version
       is distinct from new.declaration_canonicalization_version
     or old.declaration_object_kind_id is distinct from new.declaration_object_kind_id
     or old.declaration_scope_kind is distinct from new.declaration_scope_kind
     or (
       old.state = 'verified'
       and new.state = 'verified'
       and (
         old.canonical_realm_id is distinct from new.canonical_realm_id
         or old.canonical_realm_version
           is distinct from new.canonical_realm_version
         or old.canonicalization_version
           is distinct from new.canonicalization_version
         or old.canonical_object_kind_id
           is distinct from new.canonical_object_kind_id
         or old.canonical_scope_kind is distinct from new.canonical_scope_kind
         or old.canonical_scope_source_connection_id
           is distinct from new.canonical_scope_source_connection_id
         or old.canonical_scope_owner_key
           is distinct from new.canonical_scope_owner_key
         or old.canonical_external_subject
           is distinct from new.canonical_external_subject
       )
     )
     or old.created_at is distinct from new.created_at then
    raise exception 'source account identity stable edge or declaration changed'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_check_account_identity_conflict_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if exists (
      select 1
        from public.inbox_v2_source_account_identity_conflicts
       where tenant_id = old.tenant_id
         and source_account_id = old.source_account_id
         and identity_revision = old.identity_revision
    ) then
      perform public.inbox_v2_assert_account_identity_conflict(
        old.tenant_id,
        old.source_account_id,
        old.identity_revision
      );
    end if;
    return old;
  end if;

  perform public.inbox_v2_assert_account_identity_conflict(
    new.tenant_id,
    new.source_account_id,
    new.identity_revision
  );
  return new;
end
$function$;

create or replace function public.inbox_v2_check_account_identity_head_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_account_identity_transition(
    new.tenant_id,
    new.source_account_id,
    new.revision
  );
  return new;
end
$function$;

create or replace function public.inbox_v2_check_account_identity_transition_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_account_identity_transition(
    new.tenant_id,
    new.source_account_id,
    new.resulting_revision
  );
  return new;
end
$function$;

create or replace function public.inbox_v2_check_account_provisional_key_induction_trigger()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_source_account_identity_transitions transition_row
    join public.source_accounts account_row
      on account_row.tenant_id = transition_row.tenant_id
     and account_row.id = transition_row.source_account_id
     and account_row.source_connection_id = new.source_connection_id
   where transition_row.tenant_id = new.tenant_id
     and transition_row.source_account_id = new.source_account_id
     and transition_row.provisional_key_digest_sha256 =
       new.provisional_key_digest_sha256
     and transition_row.provisional_observed_at = new.provisional_observed_at
     and transition_row.intent in (
       'create_provisional', 'reauthenticate_verified'
     )
     and new.created_at <= transition_row.occurred_at;

  if not found then
    raise exception 'provisional account identity key has no exact inducing transition'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create constraint trigger inbox_v2_account_provisional_key_induction_trigger
after insert on public.inbox_v2_source_account_provisional_keys
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_provisional_key_induction_trigger();

create constraint trigger inbox_v2_account_identity_conflict_exact_trigger
after insert or update on public.inbox_v2_source_account_identity_conflicts
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_identity_conflict_trigger();

create constraint trigger inbox_v2_account_identity_candidate_exact_trigger
after insert or update or delete on public.inbox_v2_source_account_identity_conflict_candidates
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_identity_conflict_trigger();

create constraint trigger inbox_v2_account_identity_head_exact_trigger
after insert or update on public.inbox_v2_source_account_identities
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_identity_head_trigger();

create constraint trigger inbox_v2_account_identity_transition_exact_trigger
after insert or update on public.inbox_v2_source_account_identity_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_identity_transition_trigger();

create constraint trigger inbox_v2_account_identity_verified_snapshot_trigger
after insert on public.inbox_v2_source_account_identity_verified_snapshots
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_verified_snapshot_trigger();

create constraint trigger inbox_v2_account_identity_alias_exact_trigger
after insert on public.inbox_v2_source_account_identity_aliases
deferrable initially deferred
for each row execute function public.inbox_v2_check_account_identity_alias_trigger();

create trigger inbox_v2_account_provisional_keys_immutable_trigger
before update or delete on public.inbox_v2_source_account_provisional_keys
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_transitions_immutable_trigger
before update or delete on public.inbox_v2_source_account_identity_transitions
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_verified_snapshots_immutable_trigger
before update or delete on public.inbox_v2_source_account_identity_verified_snapshots
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_aliases_immutable_trigger
before update or delete on public.inbox_v2_source_account_identity_aliases
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_conflicts_immutable_trigger
before update or delete on public.inbox_v2_source_account_identity_conflicts
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_candidates_immutable_trigger
before update or delete on public.inbox_v2_source_account_identity_conflict_candidates
for each row execute function public.inbox_v2_reject_account_identity_history_mutation();

create trigger inbox_v2_account_identity_stable_edge_trigger
before update on public.inbox_v2_source_account_identities
for each row execute function public.inbox_v2_guard_account_identity_stable_edge();
`;
