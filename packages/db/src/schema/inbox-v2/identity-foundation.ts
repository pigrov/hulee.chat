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
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import type { InboxV2AdapterIdentityDeclaration } from "@hulee/contracts";

import {
  clientContacts,
  employees,
  normalizedInboundEvents,
  rawInboundEvents,
  sourceAccounts,
  sourceConnections,
  tenants
} from "../tables";
import {
  inboxV2TenantPolicyActivationTransitions,
  inboxV2TenantPolicyFamily
} from "./tenant-policy-authority";

export const inboxV2SourceIdentityScopeKind = pgEnum(
  "inbox_v2_source_identity_scope_kind",
  ["provider", "source_connection", "source_account"]
);

export const inboxV2SourceIdentityStabilityKind = pgEnum(
  "inbox_v2_source_identity_stability_kind",
  ["stable", "observation_ephemeral"]
);

export const inboxV2SourceIdentityResolutionStatus = pgEnum(
  "inbox_v2_source_identity_resolution_status",
  ["unresolved", "claimed", "conflicted"]
);

export const inboxV2SourceIdentityClaimTargetKind = pgEnum(
  "inbox_v2_source_identity_claim_target_kind",
  ["employee", "client_contact"]
);

export const inboxV2SourceIdentityClaimStatus = pgEnum(
  "inbox_v2_source_identity_claim_status",
  ["active", "revoked"]
);

export const inboxV2SourceIdentityClaimConfidence = pgEnum(
  "inbox_v2_source_identity_claim_confidence",
  ["verified", "strong", "weak"]
);

/**
 * SourceOccurrence and provider-roster evidence remain fail-closed until their
 * exact DB003 persistence anchors land in the same migration boundary.
 */
export const inboxV2SourceIdentityClaimEvidenceKind = pgEnum(
  "inbox_v2_source_identity_claim_evidence_kind",
  [
    "raw_inbound_event",
    "normalized_inbound_event",
    "source_occurrence",
    "provider_roster_evidence"
  ]
);

export const inboxV2SourceIdentityClaimDecisionKind = pgEnum(
  "inbox_v2_source_identity_claim_decision_kind",
  ["manual", "automatic_policy", "migration"]
);

export const inboxV2SourceIdentityClaimOperationKind = pgEnum(
  "inbox_v2_source_identity_claim_operation_kind",
  ["claim_employee", "claim_client_contact", "revoke"]
);

/**
 * Durable source-side actor identity. Authentication identities intentionally
 * remain in the separate external_identity_links boundary.
 */
export const inboxV2SourceExternalIdentities = pgTable(
  "inbox_v2_source_external_identities",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    realmId: text("realm_id").notNull(),
    realmVersion: text("realm_version").notNull(),
    canonicalizationVersion: text("canonicalization_version").notNull(),
    objectKindId: text("object_kind_id").notNull(),
    scopeKind: inboxV2SourceIdentityScopeKind("scope_kind").notNull(),
    scopeSourceConnectionId: text("scope_source_connection_id"),
    scopeSourceAccountId: text("scope_source_account_id"),
    identityDeclaration: jsonb("identity_declaration")
      .$type<InboxV2AdapterIdentityDeclaration>()
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
    materializedByTrustedServiceId: text(
      "materialized_by_trusted_service_id"
    ).notNull(),
    materializationAuthorizationToken: text(
      "materialization_authorization_token"
    ).notNull(),
    materializedAt: timestamp("materialized_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalExternalSubject: text("canonical_external_subject").notNull(),
    stabilityKind:
      inboxV2SourceIdentityStabilityKind("stability_kind").notNull(),
    ephemeralRawInboundEventId: text("ephemeral_raw_inbound_event_id"),
    ephemeralNormalizedInboundEventId: text(
      "ephemeral_normalized_inbound_event_id"
    ),
    ephemeralObservationKey: text("ephemeral_observation_key"),
    exactKeyDigestSha256: text("exact_key_digest_sha256")
      .notNull()
      .generatedAlwaysAs(
        sql`encode(
          sha256(
            replace(
              (
                octet_length(tenant_id)::text || ':' || tenant_id ||
                octet_length(realm_id)::text || ':' || realm_id ||
                octet_length(realm_version)::text || ':' || realm_version ||
                octet_length(canonicalization_version)::text || ':' || canonicalization_version ||
                octet_length(object_kind_id)::text || ':' || object_kind_id ||
                case scope_kind
                  when 'provider' then '8:provider'
                  when 'source_connection' then '17:source_connection'
                  when 'source_account' then '14:source_account'
                end ||
                case when scope_source_connection_id is null then '-'
                  else octet_length(scope_source_connection_id)::text || ':' || scope_source_connection_id end ||
                case when scope_source_account_id is null then '-'
                  else octet_length(scope_source_account_id)::text || ':' || scope_source_account_id end ||
                octet_length(canonical_external_subject)::text || ':' || canonical_external_subject ||
                case stability_kind
                  when 'stable' then '6:stable'
                  when 'observation_ephemeral' then '21:observation_ephemeral'
                end ||
                case when ephemeral_raw_inbound_event_id is null then '-'
                  else octet_length(ephemeral_raw_inbound_event_id)::text || ':' || ephemeral_raw_inbound_event_id end ||
                case when ephemeral_normalized_inbound_event_id is null then '-'
                  else octet_length(ephemeral_normalized_inbound_event_id)::text || ':' || ephemeral_normalized_inbound_event_id end ||
                case when ephemeral_observation_key is null then '-'
                  else octet_length(ephemeral_observation_key)::text || ':' || ephemeral_observation_key end
              ),
              chr(92),
              chr(92) || chr(92)
            )::bytea
          ),
          'hex'
        )`
      ),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    })
      .notNull()
      .defaultNow()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_external_identities_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_connection_fk",
      columns: [table.tenantId, table.scopeSourceConnectionId],
      foreignColumns: [sourceConnections.tenantId, sourceConnections.id]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_account_fk",
      columns: [table.tenantId, table.scopeSourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_raw_event_fk",
      columns: [table.tenantId, table.ephemeralRawInboundEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_normalized_event_fk",
      columns: [table.tenantId, table.ephemeralNormalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_raw_event_connection_fk",
      columns: [
        table.tenantId,
        table.ephemeralRawInboundEventId,
        table.scopeSourceConnectionId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_raw_event_account_fk",
      columns: [
        table.tenantId,
        table.ephemeralRawInboundEventId,
        table.scopeSourceAccountId
      ],
      foreignColumns: [
        rawInboundEvents.tenantId,
        rawInboundEvents.id,
        rawInboundEvents.sourceAccountId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_normalized_event_connection_fk",
      columns: [
        table.tenantId,
        table.ephemeralNormalizedInboundEventId,
        table.scopeSourceConnectionId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceConnectionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_source_external_identities_normalized_event_account_fk",
      columns: [
        table.tenantId,
        table.ephemeralNormalizedInboundEventId,
        table.scopeSourceAccountId
      ],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id,
        normalizedInboundEvents.sourceAccountId
      ]
    }),
    unique("inbox_v2_source_external_identities_scope_key_unique").on(
      table.tenantId,
      table.exactKeyDigestSha256
    ),
    check(
      "inbox_v2_source_external_identities_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_external_identity:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_source_external_identities_realm_id_check",
      sql`char_length(${table.realmId}) <= 256 and (
        (
          ${table.realmId} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.realmId}, ':', 2)) <= 160
        ) or (
          ${table.realmId} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
          and char_length(split_part(${table.realmId}, ':', 2)) <= 80
          and char_length(split_part(${table.realmId}, ':', 3)) <= 160
          and split_part(${table.realmId}, ':', 2) not in (
            'core', 'hulee', 'module', 'platform', 'system'
          )
        )
      )`
    ),
    check(
      "inbox_v2_source_external_identities_versions_check",
      sql`${table.realmVersion} ~ '^v[1-9][0-9]*$'
        and ${table.canonicalizationVersion} ~ '^v[1-9][0-9]*$'`
    ),
    check(
      "inbox_v2_source_external_identities_declaration_check",
      sourceIdentityDeclarationSql(table)
    ),
    check(
      "inbox_v2_source_external_identities_materialization_check",
      sql`${catalogIdSql(table.materializedByTrustedServiceId)}
        and char_length(${table.materializationAuthorizationToken}) between 8 and 256
        and ${table.materializationAuthorizationToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${table.materializedByTrustedServiceId} = ${table.declarationLoadedByTrustedServiceId}
        and isfinite(${table.materializedAt})
        and ${table.materializedAt} = ${table.createdAt}
        and ${table.declarationLoadedAt} <= ${table.materializedAt}`
    ),
    check(
      "inbox_v2_source_external_identities_scope_xor_check",
      sql`(
        ${table.scopeKind} = 'provider'
        and ${table.scopeSourceConnectionId} is null
        and ${table.scopeSourceAccountId} is null
      ) or (
        ${table.scopeKind} = 'source_connection'
        and ${table.scopeSourceConnectionId} is not null
        and ${table.scopeSourceAccountId} is null
      ) or (
        ${table.scopeKind} = 'source_account'
        and ${table.scopeSourceConnectionId} is null
        and ${table.scopeSourceAccountId} is not null
      )`
    ),
    check(
      "inbox_v2_source_external_identities_subject_check",
      sql`char_length(${table.canonicalExternalSubject}) between 1 and 512
        and ${table.canonicalExternalSubject} !~ '[\\x00-\\x1F\\x7F]'`
    ),
    check(
      "inbox_v2_source_external_identities_stability_xor_check",
      sql`(
        ${table.stabilityKind} = 'stable'
        and ${table.ephemeralRawInboundEventId} is null
        and ${table.ephemeralNormalizedInboundEventId} is null
        and ${table.ephemeralObservationKey} is null
      ) or (
        ${table.stabilityKind} = 'observation_ephemeral'
        and num_nonnulls(
          ${table.ephemeralRawInboundEventId},
          ${table.ephemeralNormalizedInboundEventId}
        ) = 1
        and ${table.ephemeralObservationKey} is not null
      )`
    ),
    check(
      "inbox_v2_source_external_identities_observation_key_check",
      sql`${table.ephemeralObservationKey} is null or (
        char_length(${table.ephemeralObservationKey}) between 1 and 512
        and ${table.ephemeralObservationKey} !~ '[\\x00-\\x1F\\x7F]'
      )`
    ),
    check(
      "inbox_v2_source_external_identities_digest_check",
      sql`${table.exactKeyDigestSha256} ~ '^[a-f0-9]{64}$'`
    ),
    check(
      "inbox_v2_source_external_identities_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "inbox_v2_source_external_identities_timestamps_check",
      sql`isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_source_external_identities_tenant_connection_idx").on(
      table.tenantId,
      table.scopeSourceConnectionId,
      table.id
    ),
    index("inbox_v2_source_external_identities_tenant_account_idx").on(
      table.tenantId,
      table.scopeSourceAccountId,
      table.id
    ),
    index("inbox_v2_source_external_identities_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt.desc(),
      table.id
    ),
    index("inbox_v2_source_external_identities_tenant_raw_event_idx").on(
      table.tenantId,
      table.ephemeralRawInboundEventId,
      table.id
    ),
    index("inbox_v2_source_external_identities_tenant_normalized_event_idx").on(
      table.tenantId,
      table.ephemeralNormalizedInboundEventId,
      table.id
    )
  ]
);

/** One temporal, immutable source-identity claim episode. */
export const inboxV2SourceIdentityClaims = pgTable(
  "inbox_v2_source_identity_claims",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    previousClaimVersion: bigint("previous_claim_version", {
      mode: "bigint"
    }),
    claimVersion: bigint("claim_version", { mode: "bigint" }).notNull(),
    targetKind: inboxV2SourceIdentityClaimTargetKind("target_kind").notNull(),
    targetEmployeeId: text("target_employee_id"),
    targetClientContactId: text("target_client_contact_id"),
    targetKey: text("target_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case ${sql.identifier("target_kind")}
          when 'employee' then
            'employee|' || octet_length(${sql.identifier("target_employee_id")})::text || ':' || ${sql.identifier("target_employee_id")}
          when 'client_contact' then
            'client_contact|' || octet_length(${sql.identifier("target_client_contact_id")})::text || ':' || ${sql.identifier("target_client_contact_id")}
        end`
      ),
    status: inboxV2SourceIdentityClaimStatus("status").notNull(),
    confidence: inboxV2SourceIdentityClaimConfidence("confidence").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    reasonCodeId: text("reason_code_id").notNull(),
    decisionKind:
      inboxV2SourceIdentityClaimDecisionKind("decision_kind").notNull(),
    decisionActorEmployeeId: text("decision_actor_employee_id"),
    decisionTrustedServiceId: text("decision_trusted_service_id"),
    policyFamily: inboxV2TenantPolicyFamily("policy_family"),
    policyDefinitionContractVersion: text("policy_definition_contract_version"),
    policyDefinitionDigestSha256: text("policy_definition_digest_sha256"),
    policyActivationHeadRevision: bigint("policy_activation_head_revision", {
      mode: "bigint"
    }),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revokedAt: timestamp("revoked_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_identity_claims_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_identity_claims_identity_version_unique").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.claimVersion
    ),
    unique("inbox_v2_identity_claims_exact_version_unique").on(
      table.tenantId,
      table.id,
      table.sourceExternalIdentityId,
      table.claimVersion
    ),
    unique("inbox_v2_identity_claims_exact_target_unique").on(
      table.tenantId,
      table.id,
      table.sourceExternalIdentityId,
      table.targetKind,
      table.targetKey
    ),
    unique("inbox_v2_identity_claims_exact_result_unique").on(
      table.tenantId,
      table.id,
      table.sourceExternalIdentityId,
      table.claimVersion,
      table.targetKind,
      table.targetKey
    ),
    unique("inbox_v2_identity_claims_exact_contact_target_unique").on(
      table.tenantId,
      table.id,
      table.claimVersion,
      table.targetClientContactId
    ),
    foreignKey({
      name: "inbox_v2_identity_claims_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_identity_claims_employee_fk",
      columns: [table.tenantId, table.targetEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claims_client_contact_fk",
      columns: [table.tenantId, table.targetClientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claims_actor_employee_fk",
      columns: [table.tenantId, table.decisionActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claims_policy_authority_fk",
      columns: [
        table.tenantId,
        table.policyFamily,
        table.policyId,
        table.policyActivationHeadRevision,
        table.policyVersion,
        table.policyDefinitionContractVersion,
        table.policyDefinitionDigestSha256,
        table.decisionTrustedServiceId
      ],
      foreignColumns: [
        inboxV2TenantPolicyActivationTransitions.tenantId,
        inboxV2TenantPolicyActivationTransitions.family,
        inboxV2TenantPolicyActivationTransitions.policyId,
        inboxV2TenantPolicyActivationTransitions.resultingHeadRevision,
        inboxV2TenantPolicyActivationTransitions.resultingPolicyVersion,
        inboxV2TenantPolicyActivationTransitions.resultingDefinitionContractVersion,
        inboxV2TenantPolicyActivationTransitions.resultingDefinitionDigestSha256,
        inboxV2TenantPolicyActivationTransitions.resultingApprovedTrustedServiceId
      ]
    }),
    check(
      "inbox_v2_identity_claims_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_identity_claim:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_identity_claims_version_check",
      sql`(
          ${table.previousClaimVersion} is null
          and ${table.claimVersion} = 1
        ) or (
          ${table.previousClaimVersion} is not null
          and ${table.claimVersion} = ${table.previousClaimVersion} + 1
        )`
    ),
    check(
      "inbox_v2_identity_claims_target_check",
      claimTargetColumnsSql(
        table.targetKind,
        table.targetEmployeeId,
        table.targetClientContactId
      )
    ),
    check(
      "inbox_v2_identity_claims_decision_check",
      claimDecisionColumnsSql(
        table.decisionKind,
        table.decisionActorEmployeeId,
        table.decisionTrustedServiceId
      )
    ),
    check(
      "inbox_v2_identity_claims_policy_authority_check",
      claimPolicyAuthorityColumnsSql({
        decisionKind: table.decisionKind,
        policyFamily: table.policyFamily,
        definitionContractVersion: table.policyDefinitionContractVersion,
        definitionDigestSha256: table.policyDefinitionDigestSha256,
        activationHeadRevision: table.policyActivationHeadRevision
      })
    ),
    check(
      "inbox_v2_identity_claims_manual_self_claim_check",
      sql`${table.decisionKind} <> 'manual'
        or ${table.targetKind} <> 'employee'
        or ${table.targetEmployeeId} <> ${table.decisionActorEmployeeId}`
    ),
    check(
      "inbox_v2_identity_claims_decision_catalog_check",
      decisionCatalogSql(
        table.policyId,
        table.policyVersion,
        table.reasonCodeId
      )
    ),
    check(
      "inbox_v2_identity_claims_state_check",
      sql`(
          ${table.status} = 'active'
          and ${table.revokedAt} is null
          and ${table.revision} = 1
        ) or (
          ${table.status} = 'revoked'
          and ${table.revokedAt} is not null
          and isfinite(${table.revokedAt})
          and ${table.revokedAt} >= ${table.createdAt}
          and ${table.revision} = 2
        )`
    ),
    check(
      "inbox_v2_identity_claims_created_at_check",
      sql`isfinite(${table.createdAt})`
    ),
    uniqueIndex("inbox_v2_identity_claims_one_active_unique")
      .on(table.tenantId, table.sourceExternalIdentityId)
      .where(sql`${table.status} = 'active'`),
    index("inbox_v2_identity_claims_tenant_target_idx").on(
      table.tenantId,
      table.targetKind,
      table.targetKey,
      table.claimVersion
    ),
    index("inbox_v2_identity_claims_tenant_created_idx").on(
      table.tenantId,
      table.createdAt.desc(),
      table.id
    )
  ]
);

/** Ordered evidence owned by one exact claim version. */
export const inboxV2SourceIdentityClaimEvidenceReferences = pgTable(
  "inbox_v2_source_identity_claim_evidence_references",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    claimId: text("claim_id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    claimVersion: bigint("claim_version", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    evidenceKind:
      inboxV2SourceIdentityClaimEvidenceKind("evidence_kind").notNull(),
    rawInboundEventId: text("raw_inbound_event_id"),
    normalizedInboundEventId: text("normalized_inbound_event_id"),
    sourceOccurrenceId: text("source_occurrence_id"),
    providerRosterEvidenceId: text("provider_roster_evidence_id")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_identity_claim_evidence_pk",
      columns: [table.tenantId, table.claimId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_evidence_claim_fk",
      columns: [
        table.tenantId,
        table.claimId,
        table.sourceExternalIdentityId,
        table.claimVersion
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.claimVersion
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_identity_claim_evidence_raw_event_fk",
      columns: [table.tenantId, table.rawInboundEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_evidence_normalized_event_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    check(
      "inbox_v2_identity_claim_evidence_ordinal_check",
      sql`${table.ordinal} between 0 and 49`
    ),
    check(
      "inbox_v2_identity_claim_evidence_kind_check",
      sql`(
          ${table.evidenceKind} = 'raw_inbound_event'
          and ${table.rawInboundEventId} is not null
          and ${table.normalizedInboundEventId} is null
          and ${table.sourceOccurrenceId} is null
          and ${table.providerRosterEvidenceId} is null
        ) or (
          ${table.evidenceKind} = 'normalized_inbound_event'
          and ${table.rawInboundEventId} is null
          and ${table.normalizedInboundEventId} is not null
          and ${table.sourceOccurrenceId} is null
          and ${table.providerRosterEvidenceId} is null
        ) or (
          ${table.evidenceKind} = 'source_occurrence'
          and ${table.rawInboundEventId} is null
          and ${table.normalizedInboundEventId} is null
          and ${table.sourceOccurrenceId} is not null
          and ${table.providerRosterEvidenceId} is null
        ) or (
          ${table.evidenceKind} = 'provider_roster_evidence'
          and ${table.rawInboundEventId} is null
          and ${table.normalizedInboundEventId} is null
          and ${table.sourceOccurrenceId} is null
          and ${table.providerRosterEvidenceId} is not null
        )`
    ),
    index("inbox_v2_identity_claim_evidence_identity_idx").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.claimVersion,
      table.ordinal
    ),
    index("inbox_v2_identity_claim_evidence_raw_idx").on(
      table.tenantId,
      table.rawInboundEventId,
      table.claimId
    ),
    index("inbox_v2_identity_claim_evidence_normalized_idx").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.claimId
    ),
    index("inbox_v2_identity_claim_evidence_occurrence_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.claimId
    ),
    index("inbox_v2_identity_claim_evidence_roster_idx").on(
      table.tenantId,
      table.providerRosterEvidenceId,
      table.claimId
    )
  ]
);

/** One append-only, server-stamped CAS result for the claim aggregate. */
export const inboxV2SourceIdentityClaimTransitions = pgTable(
  "inbox_v2_source_identity_claim_transitions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    operationKind:
      inboxV2SourceIdentityClaimOperationKind("operation_kind").notNull(),
    targetKind: inboxV2SourceIdentityClaimTargetKind("target_kind").notNull(),
    targetEmployeeId: text("target_employee_id"),
    targetClientContactId: text("target_client_contact_id"),
    targetKey: text("target_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case ${sql.identifier("target_kind")}
          when 'employee' then
            'employee|' || octet_length(${sql.identifier("target_employee_id")})::text || ':' || ${sql.identifier("target_employee_id")}
          when 'client_contact' then
            'client_contact|' || octet_length(${sql.identifier("target_client_contact_id")})::text || ':' || ${sql.identifier("target_client_contact_id")}
        end`
      ),
    previousClaimId: text("previous_claim_id"),
    previousTargetKind: inboxV2SourceIdentityClaimTargetKind(
      "previous_target_kind"
    ),
    previousTargetEmployeeId: text("previous_target_employee_id"),
    previousTargetClientContactId: text("previous_target_client_contact_id"),
    previousTargetKey: text("previous_target_key").generatedAlwaysAs(
      sql`case ${sql.identifier("previous_target_kind")}
        when 'employee' then
          'employee|' || octet_length(${sql.identifier("previous_target_employee_id")})::text || ':' || ${sql.identifier("previous_target_employee_id")}
        when 'client_contact' then
          'client_contact|' || octet_length(${sql.identifier("previous_target_client_contact_id")})::text || ':' || ${sql.identifier("previous_target_client_contact_id")}
      end`
    ),
    resultingClaimId: text("resulting_claim_id"),
    activeClaimId: text("active_claim_id"),
    decisionKind:
      inboxV2SourceIdentityClaimDecisionKind("decision_kind").notNull(),
    decisionActorEmployeeId: text("decision_actor_employee_id"),
    decisionTrustedServiceId: text("decision_trusted_service_id"),
    policyFamily: inboxV2TenantPolicyFamily("policy_family"),
    policyDefinitionContractVersion: text("policy_definition_contract_version"),
    policyDefinitionDigestSha256: text("policy_definition_digest_sha256"),
    policyActivationHeadRevision: bigint("policy_activation_head_revision", {
      mode: "bigint"
    }),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    reasonCodeId: text("reason_code_id").notNull(),
    expectedVersion: bigint("expected_version", { mode: "bigint" }),
    currentVersion: bigint("current_version", { mode: "bigint" }),
    resultingVersion: bigint("resulting_version", { mode: "bigint" }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_identity_claim_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_identity_claim_transition_version_unique").on(
      table.tenantId,
      table.sourceExternalIdentityId,
      table.resultingVersion
    ),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_target_employee_fk",
      columns: [table.tenantId, table.targetEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_target_contact_fk",
      columns: [table.tenantId, table.targetClientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_previous_employee_fk",
      columns: [table.tenantId, table.previousTargetEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_previous_contact_fk",
      columns: [table.tenantId, table.previousTargetClientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_actor_employee_fk",
      columns: [table.tenantId, table.decisionActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_policy_authority_fk",
      columns: [
        table.tenantId,
        table.policyFamily,
        table.policyId,
        table.policyActivationHeadRevision,
        table.policyVersion,
        table.policyDefinitionContractVersion,
        table.policyDefinitionDigestSha256,
        table.decisionTrustedServiceId
      ],
      foreignColumns: [
        inboxV2TenantPolicyActivationTransitions.tenantId,
        inboxV2TenantPolicyActivationTransitions.family,
        inboxV2TenantPolicyActivationTransitions.policyId,
        inboxV2TenantPolicyActivationTransitions.resultingHeadRevision,
        inboxV2TenantPolicyActivationTransitions.resultingPolicyVersion,
        inboxV2TenantPolicyActivationTransitions.resultingDefinitionContractVersion,
        inboxV2TenantPolicyActivationTransitions.resultingDefinitionDigestSha256,
        inboxV2TenantPolicyActivationTransitions.resultingApprovedTrustedServiceId
      ]
    }),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_resulting_claim_fk",
      columns: [
        table.tenantId,
        table.resultingClaimId,
        table.sourceExternalIdentityId,
        table.resultingVersion,
        table.targetKind,
        table.targetKey
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.claimVersion,
        inboxV2SourceIdentityClaims.targetKind,
        inboxV2SourceIdentityClaims.targetKey
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_previous_claim_fk",
      columns: [
        table.tenantId,
        table.previousClaimId,
        table.sourceExternalIdentityId,
        table.previousTargetKind,
        table.previousTargetKey
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.targetKind,
        inboxV2SourceIdentityClaims.targetKey
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_identity_claim_transition_active_claim_fk",
      columns: [
        table.tenantId,
        table.activeClaimId,
        table.sourceExternalIdentityId,
        table.targetKind,
        table.targetKey
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.targetKind,
        inboxV2SourceIdentityClaims.targetKey
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_identity_claim_transition_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^source_identity_claim_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_identity_claim_transition_target_check",
      claimTargetColumnsSql(
        table.targetKind,
        table.targetEmployeeId,
        table.targetClientContactId
      )
    ),
    check(
      "inbox_v2_identity_claim_transition_previous_target_check",
      sql`(
          ${table.previousClaimId} is null
          and ${table.previousTargetKind} is null
          and ${table.previousTargetEmployeeId} is null
          and ${table.previousTargetClientContactId} is null
          and ${table.previousTargetKey} is null
        ) or (
          ${table.previousClaimId} is not null
          and ${table.previousTargetKind} is not null
          and ${table.previousTargetKey} is not null
          and ${claimTargetColumnsSql(
            table.previousTargetKind,
            table.previousTargetEmployeeId,
            table.previousTargetClientContactId
          )}
        )`
    ),
    check(
      "inbox_v2_identity_claim_transition_operation_check",
      sql`(
          ${table.operationKind} = 'claim_employee'
          and ${table.targetKind} = 'employee'
          and ${table.resultingClaimId} is not null
          and ${table.activeClaimId} is null
        ) or (
          ${table.operationKind} = 'claim_client_contact'
          and ${table.targetKind} = 'client_contact'
          and ${table.resultingClaimId} is not null
          and ${table.activeClaimId} is null
        ) or (
          ${table.operationKind} = 'revoke'
          and ${table.resultingClaimId} is null
          and ${table.activeClaimId} is not null
          and ${table.previousClaimId} is null
        )`
    ),
    check(
      "inbox_v2_identity_claim_transition_decision_check",
      claimDecisionColumnsSql(
        table.decisionKind,
        table.decisionActorEmployeeId,
        table.decisionTrustedServiceId
      )
    ),
    check(
      "inbox_v2_identity_claim_transition_policy_authority_check",
      claimPolicyAuthorityColumnsSql({
        decisionKind: table.decisionKind,
        policyFamily: table.policyFamily,
        definitionContractVersion: table.policyDefinitionContractVersion,
        definitionDigestSha256: table.policyDefinitionDigestSha256,
        activationHeadRevision: table.policyActivationHeadRevision
      })
    ),
    check(
      "inbox_v2_identity_claim_transition_self_claim_check",
      sql`${table.operationKind} <> 'claim_employee'
        or ${table.decisionKind} <> 'manual'
        or ${table.targetEmployeeId} <> ${table.decisionActorEmployeeId}`
    ),
    check(
      "inbox_v2_identity_claim_transition_catalog_check",
      decisionCatalogSql(
        table.policyId,
        table.policyVersion,
        table.reasonCodeId
      )
    ),
    check(
      "inbox_v2_identity_claim_transition_cas_check",
      sql`(
          ${table.expectedVersion} is null
          and ${table.currentVersion} is null
          and ${table.resultingVersion} = 1
        ) or (
          ${table.expectedVersion} is not null
          and ${table.currentVersion} = ${table.expectedVersion}
          and ${table.resultingVersion} = ${table.currentVersion} + 1
        )`
    ),
    check(
      "inbox_v2_identity_claim_transition_clock_check",
      sql`isfinite(${table.occurredAt})`
    ),
    uniqueIndex("inbox_v2_identity_claim_transition_current_unique")
      .on(table.tenantId, table.sourceExternalIdentityId, table.currentVersion)
      .where(sql`${table.currentVersion} is not null`),
    uniqueIndex("inbox_v2_identity_claim_transition_result_unique")
      .on(table.tenantId, table.resultingClaimId)
      .where(sql`${table.resultingClaimId} is not null`),
    index("inbox_v2_identity_claim_transition_previous_idx").on(
      table.tenantId,
      table.previousClaimId,
      table.id
    ),
    index("inbox_v2_identity_claim_transition_active_idx").on(
      table.tenantId,
      table.activeClaimId,
      table.id
    ),
    index("inbox_v2_identity_claim_transition_occurred_idx").on(
      table.tenantId,
      table.occurredAt.desc(),
      table.id
    )
  ]
);

/** One mandatory current resolution head per source identity. */
export const inboxV2SourceIdentityClaimHeads = pgTable(
  "inbox_v2_source_identity_claim_heads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    resolutionStatus:
      inboxV2SourceIdentityResolutionStatus("resolution_status").notNull(),
    activeClaimId: text("active_claim_id"),
    latestClaimVersion: bigint("latest_claim_version", { mode: "bigint" })
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_source_identity_claim_heads_pk",
      columns: [table.tenantId, table.sourceExternalIdentityId]
    }),
    foreignKey({
      name: "inbox_v2_source_identity_claim_heads_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_source_identity_claim_heads_active_claim_fk",
      columns: [
        table.tenantId,
        table.activeClaimId,
        table.sourceExternalIdentityId,
        table.latestClaimVersion
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.sourceExternalIdentityId,
        inboxV2SourceIdentityClaims.claimVersion
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_source_identity_claim_heads_shape_check",
      sql`(
          ${table.resolutionStatus} = 'unresolved'
          and ${table.activeClaimId} is null
          and ${table.latestClaimVersion} is null
        ) or (
          ${table.resolutionStatus} in ('unresolved', 'conflicted')
          and ${table.activeClaimId} is null
          and ${table.latestClaimVersion} is not null
        ) or (
          ${table.resolutionStatus} = 'claimed'
          and ${table.activeClaimId} is not null
          and ${table.latestClaimVersion} is not null
        )`
    ),
    check(
      "inbox_v2_source_identity_claim_heads_version_check",
      sql`${table.latestClaimVersion} is null or ${table.latestClaimVersion} >= 1`
    ),
    index("inbox_v2_source_identity_claim_heads_tenant_status_idx").on(
      table.tenantId,
      table.resolutionStatus,
      table.sourceExternalIdentityId
    )
  ]
);

function claimTargetColumnsSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  clientContactId: SQLWrapper
) {
  return sql`(
      ${kind} = 'employee'
      and ${employeeId} is not null
      and ${clientContactId} is null
    ) or (
      ${kind} = 'client_contact'
      and ${employeeId} is null
      and ${clientContactId} is not null
    )`;
}

function claimDecisionColumnsSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  trustedServiceId: SQLWrapper
) {
  return sql`(
      ${kind} = 'manual'
      and ${employeeId} is not null
      and ${trustedServiceId} is null
    ) or (
      ${kind} in ('automatic_policy', 'migration')
      and ${employeeId} is null
      and ${trustedServiceId} is not null
      and ${catalogIdSql(trustedServiceId)}
    )`;
}

function decisionCatalogSql(
  policyId: SQLWrapper,
  policyVersion: SQLWrapper,
  reasonCodeId: SQLWrapper
) {
  return sql`${catalogIdSql(policyId)}
    and ${versionTokenSql(policyVersion)}
    and ${catalogIdSql(reasonCodeId)}`;
}

function catalogIdSql(column: SQLWrapper) {
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

function claimPolicyAuthorityColumnsSql(table: {
  decisionKind: SQLWrapper;
  policyFamily: SQLWrapper;
  definitionContractVersion: SQLWrapper;
  definitionDigestSha256: SQLWrapper;
  activationHeadRevision: SQLWrapper;
}) {
  return sql`(
      ${table.decisionKind} = 'automatic_policy'
      and ${table.policyFamily} = 'source_identity_claim'
      and ${table.definitionContractVersion} is not null
      and ${versionTokenSql(table.definitionContractVersion)}
      and ${table.definitionDigestSha256} is not null
      and ${table.definitionDigestSha256} ~ '^[a-f0-9]{64}$'
      and ${table.activationHeadRevision} >= 1
    ) or (
      ${table.decisionKind} <> 'automatic_policy'
      and ${table.policyFamily} is null
      and ${table.definitionContractVersion} is null
      and ${table.definitionDigestSha256} is null
      and ${table.activationHeadRevision} is null
    )`;
}

function versionTokenSql(column: SQLWrapper) {
  return sql`${column} ~ '^v[1-9][0-9]*$'`;
}

function sourceIdentityDeclarationSql(table: {
  identityDeclaration: SQLWrapper;
  realmId: SQLWrapper;
  realmVersion: SQLWrapper;
  canonicalizationVersion: SQLWrapper;
  objectKindId: SQLWrapper;
  scopeKind: SQLWrapper;
  declarationContractId: SQLWrapper;
  declarationContractVersion: SQLWrapper;
  declarationRevision: SQLWrapper;
  declarationSurfaceId: SQLWrapper;
  declarationLoadedByTrustedServiceId: SQLWrapper;
  declarationLoadedAt: SQLWrapper;
}) {
  return sql`(
    jsonb_typeof(${table.identityDeclaration}) = 'object'
    and ${table.identityDeclaration} ?& array[
      'adapterContract',
      'identityKind',
      'realmId',
      'realmVersion',
      'canonicalizationVersion',
      'objectKindId',
      'scopeKind',
      'decisionStrength'
    ]
    and ${table.identityDeclaration} - array[
      'adapterContract',
      'identityKind',
      'realmId',
      'realmVersion',
      'canonicalizationVersion',
      'objectKindId',
      'scopeKind',
      'decisionStrength'
    ] = '{}'::jsonb
    and jsonb_typeof(${table.identityDeclaration} -> 'adapterContract') = 'object'
    and (${table.identityDeclaration} -> 'adapterContract') ?& array[
      'contractId',
      'contractVersion',
      'declarationRevision',
      'surfaceId',
      'loadedByTrustedServiceId',
      'loadedAt'
    ]
    and (${table.identityDeclaration} -> 'adapterContract') - array[
      'contractId',
      'contractVersion',
      'declarationRevision',
      'surfaceId',
      'loadedByTrustedServiceId',
      'loadedAt'
    ] = '{}'::jsonb
    and ${table.identityDeclaration} ->> 'identityKind' = 'source_external_identity'
    and ${table.identityDeclaration} ->> 'realmId' = ${table.realmId}
    and ${table.identityDeclaration} ->> 'realmVersion' = ${table.realmVersion}
    and ${table.identityDeclaration} ->> 'canonicalizationVersion' = ${table.canonicalizationVersion}
    and ${table.identityDeclaration} ->> 'objectKindId' = ${table.objectKindId}
    and ${table.identityDeclaration} ->> 'scopeKind' = ${table.scopeKind}::text
    and ${table.identityDeclaration} ->> 'decisionStrength' in (
      'authoritative',
      'safe_default'
    )
    and (
      ${table.identityDeclaration} ->> 'decisionStrength' = 'authoritative'
      or (
        ${table.identityDeclaration} ->> 'decisionStrength' = 'safe_default'
        and ${table.scopeKind} = 'source_account'
      )
    )
    and (
      ${table.scopeKind} <> 'provider'
      or ${table.identityDeclaration} ->> 'decisionStrength' = 'authoritative'
    )
    and ${table.identityDeclaration} #>> '{adapterContract,contractId}' =
      ${table.declarationContractId}
    and ${table.identityDeclaration} #>> '{adapterContract,contractVersion}' =
      ${table.declarationContractVersion}
    and (${table.identityDeclaration} #>> '{adapterContract,declarationRevision}')::numeric =
      ${table.declarationRevision}
    and ${table.identityDeclaration} #>> '{adapterContract,surfaceId}' =
      ${table.declarationSurfaceId}
    and ${table.identityDeclaration} #>> '{adapterContract,loadedByTrustedServiceId}' =
      ${table.declarationLoadedByTrustedServiceId}
    and (${table.identityDeclaration} #>> '{adapterContract,loadedAt}')::timestamptz =
      ${table.declarationLoadedAt}
    and ${catalogIdSql(table.realmId)}
    and ${catalogIdSql(table.objectKindId)}
    and ${catalogIdSql(table.declarationContractId)}
    and ${catalogIdSql(table.declarationSurfaceId)}
    and ${catalogIdSql(table.declarationLoadedByTrustedServiceId)}
    and ${versionTokenSql(table.realmVersion)}
    and ${versionTokenSql(table.canonicalizationVersion)}
    and ${versionTokenSql(table.declarationContractVersion)}
    and ${table.declarationRevision} >= 1
    and isfinite(${table.declarationLoadedAt})
  ) is true`;
}

/**
 * Drizzle cannot model deferred, indexed graph closure. These checks validate
 * only one identity, claim or transition at a time; they never load a tenant-
 * wide or lifetime claim graph.
 */
export const INBOX_V2_SOURCE_IDENTITY_CLAIM_INTEGRITY_SQL = String.raw`
alter table public.inbox_v2_source_identity_claim_evidence_references
  add constraint inbox_v2_identity_claim_evidence_occurrence_actor_fk
  foreign key (
    tenant_id,
    source_occurrence_id,
    source_external_identity_id
  )
  references public.inbox_v2_source_occurrences (
    tenant_id,
    id,
    provider_actor_source_external_identity_id
  );

alter table public.inbox_v2_source_identity_claim_evidence_references
  add constraint inbox_v2_identity_claim_evidence_roster_member_fk
  foreign key (
    tenant_id,
    provider_roster_evidence_id,
    source_external_identity_id
  )
  references public.inbox_v2_provider_roster_member_evidence (
    tenant_id,
    roster_evidence_id,
    source_external_identity_id
  );

insert into public.inbox_v2_source_identity_claim_heads (
  tenant_id,
  source_external_identity_id,
  resolution_status,
  active_claim_id,
  latest_claim_version
)
select
  identity_row.tenant_id,
  identity_row.id,
  'unresolved'::public.inbox_v2_source_identity_resolution_status,
  null,
  null
from public.inbox_v2_source_external_identities identity_row
on conflict (tenant_id, source_external_identity_id) do nothing;

create or replace function public.inbox_v2_source_identity_claim_bootstrap_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_source_identity_claim_heads (
    tenant_id,
    source_external_identity_id,
    resolution_status,
    active_claim_id,
    latest_claim_version
  ) values (
    new.tenant_id,
    new.id,
    'unresolved',
    null,
    null
  )
  on conflict (tenant_id, source_external_identity_id) do nothing;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_parent_gone(
  checked_tenant_id text,
  checked_source_external_identity_id text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    not exists (
      select 1
      from public.tenants tenant_row
      where tenant_row.id = checked_tenant_id
    )
    or not exists (
      select 1
      from public.inbox_v2_source_external_identities identity_row
      where identity_row.tenant_id = checked_tenant_id
        and identity_row.id = checked_source_external_identity_id
    );
$function$;

create or replace function public.inbox_v2_source_identity_claim_reject_history_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and public.inbox_v2_source_identity_claim_parent_gone(
       old.tenant_id,
       old.source_external_identity_id
     ) then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_identity_claim_history_immutable:%s:%s',
      tg_table_name,
      tg_op
    );
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_guard_claim_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_source_identity_claim_parent_gone(
      old.tenant_id,
      old.source_external_identity_id
    ) then
      return old;
    end if;

    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_history_delete_forbidden';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.source_external_identity_id is distinct from old.source_external_identity_id
     or new.previous_claim_version is distinct from old.previous_claim_version
     or new.claim_version is distinct from old.claim_version
     or new.target_kind is distinct from old.target_kind
     or new.target_employee_id is distinct from old.target_employee_id
     or new.target_client_contact_id is distinct from old.target_client_contact_id
     or new.confidence is distinct from old.confidence
     or new.policy_id is distinct from old.policy_id
     or new.policy_version is distinct from old.policy_version
     or new.reason_code_id is distinct from old.reason_code_id
     or new.decision_kind is distinct from old.decision_kind
     or new.decision_actor_employee_id is distinct from old.decision_actor_employee_id
     or new.decision_trusted_service_id is distinct from old.decision_trusted_service_id
     or new.policy_family is distinct from old.policy_family
     or new.policy_definition_contract_version is distinct from old.policy_definition_contract_version
     or new.policy_definition_digest_sha256 is distinct from old.policy_definition_digest_sha256
     or new.policy_activation_head_revision is distinct from old.policy_activation_head_revision
     or new.created_at is distinct from old.created_at
     or old.status <> 'active'
     or old.revoked_at is not null
     or old.revision <> 1
     or new.status <> 'revoked'
     or new.revoked_at is null
     or new.revision <> 2 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_invalid_revocation';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_guard_head_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_source_identity_claim_parent_gone(
      old.tenant_id,
      old.source_external_identity_id
    ) then
      return old;
    end if;

    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_head_delete_forbidden';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.source_external_identity_id is distinct from old.source_external_identity_id
     or (
       old.latest_claim_version is null
       and new.latest_claim_version is distinct from 1
     )
     or (
       old.latest_claim_version is not null
       and new.latest_claim_version is distinct from old.latest_claim_version + 1
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_head_noncontiguous';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_guard_identity_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.realm_id is distinct from old.realm_id
     or new.realm_version is distinct from old.realm_version
     or new.canonicalization_version is distinct from old.canonicalization_version
     or new.object_kind_id is distinct from old.object_kind_id
     or new.scope_kind is distinct from old.scope_kind
     or new.scope_source_connection_id is distinct from old.scope_source_connection_id
     or new.scope_source_account_id is distinct from old.scope_source_account_id
     or new.identity_declaration is distinct from old.identity_declaration
     or new.declaration_contract_id is distinct from old.declaration_contract_id
     or new.declaration_contract_version is distinct from old.declaration_contract_version
     or new.declaration_revision is distinct from old.declaration_revision
     or new.declaration_surface_id is distinct from old.declaration_surface_id
     or new.declaration_loaded_by_trusted_service_id is distinct from old.declaration_loaded_by_trusted_service_id
     or new.declaration_loaded_at is distinct from old.declaration_loaded_at
     or new.materialized_by_trusted_service_id is distinct from old.materialized_by_trusted_service_id
     or new.materialization_authorization_token is distinct from old.materialization_authorization_token
     or new.materialized_at is distinct from old.materialized_at
     or new.canonical_external_subject is distinct from old.canonical_external_subject
     or new.stability_kind is distinct from old.stability_kind
     or new.ephemeral_raw_inbound_event_id is distinct from old.ephemeral_raw_inbound_event_id
     or new.ephemeral_normalized_inbound_event_id is distinct from old.ephemeral_normalized_inbound_event_id
     or new.ephemeral_observation_key is distinct from old.ephemeral_observation_key
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_identity_invalid_update';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_guard_transition_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_version bigint;
  predecessor_occurred_at timestamptz;
begin
  select head_row.latest_claim_version
  into head_version
  from public.inbox_v2_source_identity_claim_heads head_row
  where head_row.tenant_id = new.tenant_id
    and head_row.source_external_identity_id = new.source_external_identity_id
  for update;

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_head_missing';
  end if;

  if new.expected_version is distinct from head_version
     or new.current_version is distinct from head_version then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.source_identity_claim_revision_conflict';
  end if;

  if new.current_version is not null then
    select transition_row.occurred_at
    into predecessor_occurred_at
    from public.inbox_v2_source_identity_claim_transitions transition_row
    where transition_row.tenant_id = new.tenant_id
      and transition_row.source_external_identity_id = new.source_external_identity_id
      and transition_row.resulting_version = new.current_version;

    if not found or new.occurred_at < predecessor_occurred_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_transition_clock_invalid';
    end if;
  end if;

  if new.decision_kind = 'automatic_policy' then
    perform 1
    from public.inbox_v2_tenant_policy_activation_heads head_row
    join public.inbox_v2_tenant_policy_versions version_row
      on version_row.tenant_id = head_row.tenant_id
     and version_row.family = head_row.family
     and version_row.policy_id = head_row.policy_id
     and version_row.policy_version = head_row.policy_version
     and version_row.definition_contract_version = head_row.definition_contract_version
     and version_row.definition_digest_sha256 = head_row.definition_digest_sha256
     and version_row.approved_trusted_service_id = head_row.approved_trusted_service_id
    where head_row.tenant_id = new.tenant_id
      and head_row.family = 'source_identity_claim'
      and head_row.policy_id = new.policy_id
      and head_row.state = 'active'
      and head_row.revision = new.policy_activation_head_revision
      and head_row.policy_version = new.policy_version
      and head_row.definition_contract_version = new.policy_definition_contract_version
      and head_row.definition_digest_sha256 = new.policy_definition_digest_sha256
      and head_row.approved_trusted_service_id = new.decision_trusted_service_id
      and head_row.activated_at <= new.occurred_at
    for share of head_row, version_row;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_policy_authority_invalid';
    end if;
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_assert_identity(
  checked_tenant_id text,
  checked_source_external_identity_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  identity_revision bigint;
  identity_updated_at timestamptz;
  head_status public.inbox_v2_source_identity_resolution_status;
  head_active_claim_id text;
  head_version bigint;
  latest_transition_occurred_at timestamptz;
begin
  select
    identity_row.revision,
    identity_row.updated_at,
    head_row.resolution_status,
    head_row.active_claim_id,
    head_row.latest_claim_version
  into
    identity_revision,
    identity_updated_at,
    head_status,
    head_active_claim_id,
    head_version
  from public.inbox_v2_source_external_identities identity_row
  left join public.inbox_v2_source_identity_claim_heads head_row
    on head_row.tenant_id = identity_row.tenant_id
   and head_row.source_external_identity_id = identity_row.id
  where identity_row.tenant_id = checked_tenant_id
    and identity_row.id = checked_source_external_identity_id;

  if not found then
    return;
  end if;

  if head_status is null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_head_missing';
  end if;

  if head_version is null then
    if head_status <> 'unresolved'
       or head_active_claim_id is not null
       or identity_revision <> 1
       or exists (
         select 1
         from public.inbox_v2_source_identity_claim_transitions transition_row
         where transition_row.tenant_id = checked_tenant_id
           and transition_row.source_external_identity_id = checked_source_external_identity_id
           and transition_row.resulting_version = 1
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_initial_head_invalid';
    end if;
    return;
  end if;

  select transition_row.occurred_at
  into latest_transition_occurred_at
  from public.inbox_v2_source_identity_claim_transitions transition_row
  where transition_row.tenant_id = checked_tenant_id
    and transition_row.source_external_identity_id = checked_source_external_identity_id
    and transition_row.resulting_version = head_version;

  if not found
     or identity_revision <> head_version + 1
     or identity_updated_at is distinct from latest_transition_occurred_at
     or exists (
       select 1
       from public.inbox_v2_source_identity_claim_transitions successor_row
       where successor_row.tenant_id = checked_tenant_id
         and successor_row.source_external_identity_id = checked_source_external_identity_id
         and successor_row.current_version = head_version
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_head_clock_invalid';
  end if;

  if head_status = 'claimed' then
    if head_active_claim_id is null
       or not exists (
         select 1
         from public.inbox_v2_source_identity_claims claim_row
         where claim_row.tenant_id = checked_tenant_id
           and claim_row.id = head_active_claim_id
           and claim_row.source_external_identity_id = checked_source_external_identity_id
           and claim_row.claim_version = head_version
           and claim_row.status = 'active'
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_active_head_invalid';
    end if;
  elsif head_active_claim_id is not null
     or exists (
       select 1
       from public.inbox_v2_source_identity_claims claim_row
       where claim_row.tenant_id = checked_tenant_id
         and claim_row.source_external_identity_id = checked_source_external_identity_id
         and claim_row.status = 'active'
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_inactive_head_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_assert_claim(
  checked_tenant_id text,
  checked_claim_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  claim_source_external_identity_id text;
  claim_status public.inbox_v2_source_identity_claim_status;
  claim_revoked_at timestamptz;
  identity_scope_kind public.inbox_v2_source_identity_scope_kind;
  identity_scope_source_connection_id text;
  identity_scope_source_account_id text;
  evidence_count integer;
  minimum_ordinal integer;
  maximum_ordinal integer;
  creation_count integer;
  termination_count integer;
  termination_occurred_at timestamptz;
begin
  select
    claim_row.source_external_identity_id,
    claim_row.status,
    claim_row.revoked_at
  into
    claim_source_external_identity_id,
    claim_status,
    claim_revoked_at
  from public.inbox_v2_source_identity_claims claim_row
  where claim_row.tenant_id = checked_tenant_id
    and claim_row.id = checked_claim_id;

  if not found then
    return;
  end if;

  select
    identity_row.scope_kind,
    identity_row.scope_source_connection_id,
    identity_row.scope_source_account_id
  into
    identity_scope_kind,
    identity_scope_source_connection_id,
    identity_scope_source_account_id
  from public.inbox_v2_source_external_identities identity_row
  where identity_row.tenant_id = checked_tenant_id
    and identity_row.id = claim_source_external_identity_id;

  if not found then
    return;
  end if;

  select count(*), min(evidence_row.ordinal), max(evidence_row.ordinal)
  into evidence_count, minimum_ordinal, maximum_ordinal
  from public.inbox_v2_source_identity_claim_evidence_references evidence_row
  where evidence_row.tenant_id = checked_tenant_id
    and evidence_row.claim_id = checked_claim_id;

  if evidence_count < 1
     or evidence_count > 50
     or minimum_ordinal <> 0
     or maximum_ordinal <> evidence_count - 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_evidence_cardinality_invalid';
  end if;

  if identity_scope_kind = 'provider'
     and not exists (
       select 1
       from public.inbox_v2_source_identity_claim_evidence_references evidence_row
       where evidence_row.tenant_id = checked_tenant_id
         and evidence_row.claim_id = checked_claim_id
         and evidence_row.evidence_kind in (
           'source_occurrence',
           'provider_roster_evidence'
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_evidence_scope_invalid',
      detail = 'provider_scope_requires_exact_actor_evidence';
  end if;

  if identity_scope_kind = 'provider'
     and exists (
       select 1
       from public.inbox_v2_source_identity_claim_evidence_references supplemental_row
       where supplemental_row.tenant_id = checked_tenant_id
         and supplemental_row.claim_id = checked_claim_id
         and supplemental_row.evidence_kind in (
           'raw_inbound_event',
           'normalized_inbound_event'
         )
         and not exists (
           select 1
           from public.inbox_v2_source_identity_claim_evidence_references anchor_row
           left join public.inbox_v2_source_occurrences occurrence_row
             on anchor_row.evidence_kind = 'source_occurrence'
            and occurrence_row.tenant_id = anchor_row.tenant_id
            and occurrence_row.id = anchor_row.source_occurrence_id
           left join public.inbox_v2_provider_roster_evidence roster_row
             on anchor_row.evidence_kind = 'provider_roster_evidence'
            and roster_row.tenant_id = anchor_row.tenant_id
            and roster_row.id = anchor_row.provider_roster_evidence_id
           where anchor_row.tenant_id = supplemental_row.tenant_id
             and anchor_row.claim_id = supplemental_row.claim_id
             and (
               (
                 supplemental_row.evidence_kind = 'raw_inbound_event'
                 and coalesce(
                   occurrence_row.raw_inbound_event_id,
                   roster_row.raw_inbound_event_id
                 ) = supplemental_row.raw_inbound_event_id
               ) or (
                 supplemental_row.evidence_kind = 'normalized_inbound_event'
                 and coalesce(
                   occurrence_row.normalized_inbound_event_id,
                   roster_row.normalized_inbound_event_id
                 ) = supplemental_row.normalized_inbound_event_id
               )
             )
         )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_evidence_scope_invalid',
      detail = 'provider_event_requires_paired_exact_actor_evidence';
  end if;

  if exists (
    select 1
    from public.inbox_v2_source_identity_claim_evidence_references evidence_row
    left join public.raw_inbound_events raw_event_row
      on evidence_row.evidence_kind = 'raw_inbound_event'
     and raw_event_row.tenant_id = evidence_row.tenant_id
     and raw_event_row.id = evidence_row.raw_inbound_event_id
    left join public.normalized_inbound_events normalized_event_row
      on evidence_row.evidence_kind = 'normalized_inbound_event'
     and normalized_event_row.tenant_id = evidence_row.tenant_id
     and normalized_event_row.id = evidence_row.normalized_inbound_event_id
    left join public.inbox_v2_source_occurrences occurrence_row
      on evidence_row.evidence_kind = 'source_occurrence'
     and occurrence_row.tenant_id = evidence_row.tenant_id
     and occurrence_row.id = evidence_row.source_occurrence_id
    left join public.inbox_v2_provider_roster_evidence roster_row
      on evidence_row.evidence_kind = 'provider_roster_evidence'
     and roster_row.tenant_id = evidence_row.tenant_id
     and roster_row.id = evidence_row.provider_roster_evidence_id
    where evidence_row.tenant_id = checked_tenant_id
      and evidence_row.claim_id = checked_claim_id
      and (
        (
          identity_scope_kind = 'source_connection'
          and coalesce(
            raw_event_row.source_connection_id,
            normalized_event_row.source_connection_id,
            occurrence_row.source_connection_id,
            roster_row.source_connection_id
          ) is distinct from identity_scope_source_connection_id
        ) or (
          identity_scope_kind = 'source_account'
          and coalesce(
            raw_event_row.source_account_id,
            normalized_event_row.source_account_id,
            occurrence_row.source_account_id,
            roster_row.source_account_id
          ) is distinct from identity_scope_source_account_id
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_evidence_scope_invalid';
  end if;

  select count(*)
  into creation_count
  from public.inbox_v2_source_identity_claim_transitions transition_row
  where transition_row.tenant_id = checked_tenant_id
    and transition_row.resulting_claim_id = checked_claim_id;

  if creation_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_creation_transition_invalid';
  end if;

  select count(*), min(transition_row.occurred_at)
  into termination_count, termination_occurred_at
  from public.inbox_v2_source_identity_claim_transitions transition_row
  where transition_row.tenant_id = checked_tenant_id
    and (
      transition_row.previous_claim_id = checked_claim_id
      or transition_row.active_claim_id = checked_claim_id
    );

  if claim_status = 'active' then
    if termination_count <> 0 or claim_revoked_at is not null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_active_termination_invalid';
    end if;
  elsif termination_count <> 1
     or claim_revoked_at is distinct from termination_occurred_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_revocation_transition_invalid';
  end if;

  perform public.inbox_v2_source_identity_claim_assert_identity(
    checked_tenant_id,
    claim_source_external_identity_id
  );
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_assert_transition(
  checked_tenant_id text,
  checked_transition_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_row public.inbox_v2_source_identity_claim_transitions%rowtype;
  head_version bigint;
  predecessor_occurred_at timestamptz;
  exact_claim_found boolean;
begin
  select *
  into transition_row
  from public.inbox_v2_source_identity_claim_transitions candidate_row
  where candidate_row.tenant_id = checked_tenant_id
    and candidate_row.id = checked_transition_id;

  if not found then
    return;
  end if;

  select head_row.latest_claim_version
  into head_version
  from public.inbox_v2_source_identity_claim_heads head_row
  where head_row.tenant_id = transition_row.tenant_id
    and head_row.source_external_identity_id = transition_row.source_external_identity_id;

  if not found
     or head_version is null
     or head_version < transition_row.resulting_version
     or (
       head_version > transition_row.resulting_version
       and not exists (
         select 1
         from public.inbox_v2_source_identity_claim_transitions successor_row
         where successor_row.tenant_id = transition_row.tenant_id
           and successor_row.source_external_identity_id = transition_row.source_external_identity_id
           and successor_row.current_version = transition_row.resulting_version
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_transition_chain_invalid';
  end if;

  if transition_row.current_version is not null then
    select predecessor_row.occurred_at
    into predecessor_occurred_at
    from public.inbox_v2_source_identity_claim_transitions predecessor_row
    where predecessor_row.tenant_id = transition_row.tenant_id
      and predecessor_row.source_external_identity_id = transition_row.source_external_identity_id
      and predecessor_row.resulting_version = transition_row.current_version;

    if not found or transition_row.occurred_at < predecessor_occurred_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_transition_predecessor_invalid';
    end if;
  end if;

  if transition_row.operation_kind in ('claim_employee', 'claim_client_contact') then
    select exists (
      select 1
      from public.inbox_v2_source_identity_claims claim_row
      where claim_row.tenant_id = transition_row.tenant_id
        and claim_row.id = transition_row.resulting_claim_id
        and claim_row.source_external_identity_id = transition_row.source_external_identity_id
        and claim_row.previous_claim_version is not distinct from transition_row.current_version
        and claim_row.claim_version = transition_row.resulting_version
        and claim_row.target_kind = transition_row.target_kind
        and claim_row.target_key = transition_row.target_key
        and claim_row.policy_id = transition_row.policy_id
        and claim_row.policy_version = transition_row.policy_version
        and claim_row.reason_code_id = transition_row.reason_code_id
        and claim_row.decision_kind = transition_row.decision_kind
        and claim_row.decision_actor_employee_id is not distinct from transition_row.decision_actor_employee_id
        and claim_row.decision_trusted_service_id is not distinct from transition_row.decision_trusted_service_id
        and claim_row.policy_family is not distinct from transition_row.policy_family
        and claim_row.policy_definition_contract_version is not distinct from transition_row.policy_definition_contract_version
        and claim_row.policy_definition_digest_sha256 is not distinct from transition_row.policy_definition_digest_sha256
        and claim_row.policy_activation_head_revision is not distinct from transition_row.policy_activation_head_revision
        and claim_row.created_at = transition_row.occurred_at
    ) into exact_claim_found;

    if not exact_claim_found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_creation_exactness_invalid';
    end if;

    if transition_row.previous_claim_id is not null
       and not exists (
         select 1
         from public.inbox_v2_source_identity_claims previous_claim_row
         where previous_claim_row.tenant_id = transition_row.tenant_id
           and previous_claim_row.id = transition_row.previous_claim_id
           and previous_claim_row.source_external_identity_id = transition_row.source_external_identity_id
           and previous_claim_row.target_kind = transition_row.previous_target_kind
           and previous_claim_row.target_key = transition_row.previous_target_key
           and previous_claim_row.claim_version < transition_row.resulting_version
           and previous_claim_row.status = 'revoked'
           and previous_claim_row.revoked_at = transition_row.occurred_at
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_identity_claim_reassignment_exactness_invalid';
    end if;
  elsif not exists (
    select 1
    from public.inbox_v2_source_identity_claims active_claim_row
    where active_claim_row.tenant_id = transition_row.tenant_id
      and active_claim_row.id = transition_row.active_claim_id
      and active_claim_row.source_external_identity_id = transition_row.source_external_identity_id
      and active_claim_row.target_kind = transition_row.target_kind
      and active_claim_row.target_key = transition_row.target_key
      and active_claim_row.claim_version < transition_row.resulting_version
      and active_claim_row.status = 'revoked'
      and active_claim_row.revoked_at = transition_row.occurred_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_identity_claim_revoke_exactness_invalid';
  end if;

  perform public.inbox_v2_source_identity_claim_assert_identity(
    transition_row.tenant_id,
    transition_row.source_external_identity_id
  );
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_deferred_identity()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_claim_assert_identity(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_claim_assert_identity(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.source_external_identity_id, old.source_external_identity_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_deferred_claim()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_claim_assert_claim(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_deferred_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_claim_assert_claim(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.claim_id, old.claim_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_identity_claim_deferred_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_source_identity_claim_assert_transition(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );

  if coalesce(new.resulting_claim_id, old.resulting_claim_id) is not null then
    perform public.inbox_v2_source_identity_claim_assert_claim(
      coalesce(new.tenant_id, old.tenant_id),
      coalesce(new.resulting_claim_id, old.resulting_claim_id)
    );
  end if;
  if coalesce(new.previous_claim_id, old.previous_claim_id) is not null then
    perform public.inbox_v2_source_identity_claim_assert_claim(
      coalesce(new.tenant_id, old.tenant_id),
      coalesce(new.previous_claim_id, old.previous_claim_id)
    );
  end if;
  if coalesce(new.active_claim_id, old.active_claim_id) is not null then
    perform public.inbox_v2_source_identity_claim_assert_claim(
      coalesce(new.tenant_id, old.tenant_id),
      coalesce(new.active_claim_id, old.active_claim_id)
    );
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_source_identity_claim_bootstrap_head_trigger
after insert on public.inbox_v2_source_external_identities
for each row execute function public.inbox_v2_source_identity_claim_bootstrap_head();

create trigger inbox_v2_source_identity_claim_identity_update_trigger
before update on public.inbox_v2_source_external_identities
for each row execute function public.inbox_v2_source_identity_claim_guard_identity_update();

create trigger inbox_v2_source_identity_claim_head_change_trigger
before update or delete on public.inbox_v2_source_identity_claim_heads
for each row execute function public.inbox_v2_source_identity_claim_guard_head_change();

create trigger inbox_v2_source_identity_claim_claim_change_trigger
before update or delete on public.inbox_v2_source_identity_claims
for each row execute function public.inbox_v2_source_identity_claim_guard_claim_change();

create trigger inbox_v2_source_identity_claim_evidence_immutable_trigger
before update or delete on public.inbox_v2_source_identity_claim_evidence_references
for each row execute function public.inbox_v2_source_identity_claim_reject_history_change();

create trigger inbox_v2_source_identity_claim_transition_insert_trigger
before insert on public.inbox_v2_source_identity_claim_transitions
for each row execute function public.inbox_v2_source_identity_claim_guard_transition_insert();

create trigger inbox_v2_source_identity_claim_transition_immutable_trigger
before update or delete on public.inbox_v2_source_identity_claim_transitions
for each row execute function public.inbox_v2_source_identity_claim_reject_history_change();

create constraint trigger inbox_v2_source_identity_claim_identity_constraint
after insert or update on public.inbox_v2_source_external_identities
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_claim_deferred_identity();

create constraint trigger inbox_v2_source_identity_claim_head_constraint
after insert or update or delete on public.inbox_v2_source_identity_claim_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_claim_deferred_head();

create constraint trigger inbox_v2_source_identity_claim_claim_constraint
after insert or update or delete on public.inbox_v2_source_identity_claims
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_claim_deferred_claim();

create constraint trigger inbox_v2_source_identity_claim_evidence_constraint
after insert or update or delete on public.inbox_v2_source_identity_claim_evidence_references
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_claim_deferred_evidence();

create constraint trigger inbox_v2_source_identity_claim_transition_constraint
after insert or update or delete on public.inbox_v2_source_identity_claim_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_source_identity_claim_deferred_transition();
`;
