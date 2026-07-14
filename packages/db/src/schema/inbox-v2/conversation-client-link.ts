import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
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
  clientContacts,
  clients,
  employees,
  inboxV2Conversations,
  normalizedInboundEvents,
  rawInboundEvents,
  tenants
} from "../tables";
import { inboxV2SourceIdentityClaims } from "./identity-foundation";
import { inboxV2ConversationParticipants } from "./participant-membership";
import { inboxV2SourceOccurrences } from "./source-occurrence";
import {
  inboxV2TenantPolicyActivationTransitions,
  inboxV2TenantPolicyFamily
} from "./tenant-policy-authority";

export const inboxV2ConversationClientLinkConfidence = pgEnum(
  "inbox_v2_conversation_client_link_confidence",
  ["confirmed", "supported", "tentative"]
);

export const inboxV2ConversationClientLinkProvenanceKind = pgEnum(
  "inbox_v2_conversation_client_link_provenance_kind",
  ["manual", "migration", "source_identity_claim", "trusted_policy"]
);

export const inboxV2ConversationClientLinkActorKind = pgEnum(
  "inbox_v2_conversation_client_link_actor_kind",
  ["employee", "trusted_service", "migration_service"]
);

export const inboxV2ConversationClientLinkEvidencePurpose = pgEnum(
  "inbox_v2_conversation_client_link_evidence_purpose",
  ["verification", "audit"]
);

export const inboxV2ConversationClientLinkEvidenceKind = pgEnum(
  "inbox_v2_conversation_client_link_evidence_kind",
  [
    "source_identity_claim",
    "client_contact",
    "conversation_participant",
    "raw_inbound_event",
    "normalized_inbound_event",
    "source_occurrence"
  ]
);

export const inboxV2ConversationClientLinkStartBasis = pgEnum(
  "inbox_v2_conversation_client_link_start_basis",
  ["known_effective", "migration_observed"]
);

export const inboxV2ConversationClientLinkState = pgEnum(
  "inbox_v2_conversation_client_link_state",
  ["active", "ended"]
);

export const inboxV2ConversationClientLinkOperationKind = pgEnum(
  "inbox_v2_conversation_client_link_operation_kind",
  ["create_link", "end_link"]
);

/**
 * One temporal Client-attribution episode. This foundation deliberately stores
 * manual, migration, exact SourceIdentityClaim or trusted-policy provenance.
 * Ordered evidence and immutable historical tenant-policy authority are stored
 * separately but fenced to this exact episode.
 */
export const inboxV2ConversationClientLinks = pgTable(
  "inbox_v2_conversation_client_links",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    clientId: text("client_id").notNull(),
    associationConfidence: inboxV2ConversationClientLinkConfidence(
      "association_confidence"
    ).notNull(),
    provenanceKind:
      inboxV2ConversationClientLinkProvenanceKind("provenance_kind").notNull(),
    provenanceMigrationId: text("provenance_migration_id"),
    provenanceContractVersion: text("provenance_contract_version"),
    provenanceClaimId: text("provenance_claim_id"),
    provenanceClaimVersion: bigint("provenance_claim_version", {
      mode: "bigint"
    }),
    provenanceClaimTargetClientContactId: text(
      "provenance_claim_target_client_contact_id"
    ),
    provenanceVerificationServiceId: text("provenance_verification_service_id"),
    provenanceVerificationPolicyId: text("provenance_verification_policy_id"),
    provenanceVerificationPolicyVersion: text(
      "provenance_verification_policy_version"
    ),
    provenanceVerificationPolicyFamily: inboxV2TenantPolicyFamily(
      "provenance_verification_policy_family"
    ),
    provenanceVerificationDefinitionContractVersion: text(
      "provenance_verification_definition_contract_version"
    ),
    provenanceVerificationDefinitionDigestSha256: text(
      "provenance_verification_definition_digest_sha256"
    ),
    provenanceVerificationActivationHeadRevision: bigint(
      "provenance_verification_activation_head_revision",
      { mode: "bigint" }
    ),
    provenanceVerificationVerifiedAt: timestamp(
      "provenance_verification_verified_at",
      { withTimezone: true, precision: 3 }
    ),
    linkedActorKind:
      inboxV2ConversationClientLinkActorKind("linked_actor_kind").notNull(),
    linkedActorEmployeeId: text("linked_actor_employee_id"),
    linkedActorServiceId: text("linked_actor_service_id"),
    linkedPolicyId: text("linked_policy_id").notNull(),
    linkedPolicyVersion: text("linked_policy_version").notNull(),
    linkedReasonCodeId: text("linked_reason_code_id").notNull(),
    linkedPolicyFamily: inboxV2TenantPolicyFamily("linked_policy_family"),
    linkedPolicyDefinitionContractVersion: text(
      "linked_policy_definition_contract_version"
    ),
    linkedPolicyDefinitionDigestSha256: text(
      "linked_policy_definition_digest_sha256"
    ),
    linkedPolicyActivationHeadRevision: bigint(
      "linked_policy_activation_head_revision",
      { mode: "bigint" }
    ),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validFromBasis:
      inboxV2ConversationClientLinkStartBasis("valid_from_basis").notNull(),
    state: inboxV2ConversationClientLinkState("state").notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, precision: 3 }),
    endedActorKind: inboxV2ConversationClientLinkActorKind("ended_actor_kind"),
    endedActorEmployeeId: text("ended_actor_employee_id"),
    endedActorServiceId: text("ended_actor_service_id"),
    endedPolicyId: text("ended_policy_id"),
    endedPolicyVersion: text("ended_policy_version"),
    endedReasonCodeId: text("ended_reason_code_id"),
    endedPolicyFamily: inboxV2TenantPolicyFamily("ended_policy_family"),
    endedPolicyDefinitionContractVersion: text(
      "ended_policy_definition_contract_version"
    ),
    endedPolicyDefinitionDigestSha256: text(
      "ended_policy_definition_digest_sha256"
    ),
    endedPolicyActivationHeadRevision: bigint(
      "ended_policy_activation_head_revision",
      { mode: "bigint" }
    ),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_client_links_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_conversation_client_links_exact_edge_unique").on(
      table.tenantId,
      table.id,
      table.conversationId
    ),
    foreignKey({
      name: "inbox_v2_conversation_client_links_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_conversation_client_links_client_fk",
      columns: [table.tenantId, table.clientId],
      foreignColumns: [clients.tenantId, clients.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_links_claim_fk",
      columns: [
        table.tenantId,
        table.provenanceClaimId,
        table.provenanceClaimVersion,
        table.provenanceClaimTargetClientContactId
      ],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id,
        inboxV2SourceIdentityClaims.claimVersion,
        inboxV2SourceIdentityClaims.targetClientContactId
      ]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_links_claim_contact_fk",
      columns: [table.tenantId, table.provenanceClaimTargetClientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_links_linked_employee_fk",
      columns: [table.tenantId, table.linkedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_links_ended_employee_fk",
      columns: [table.tenantId, table.endedActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_client_links_linked_policy_authority_fk",
      columns: [
        table.tenantId,
        table.linkedPolicyFamily,
        table.linkedPolicyId,
        table.linkedPolicyActivationHeadRevision,
        table.linkedPolicyVersion,
        table.linkedPolicyDefinitionContractVersion,
        table.linkedPolicyDefinitionDigestSha256,
        table.linkedActorServiceId
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
      name: "inbox_v2_client_links_verify_policy_authority_fk",
      columns: [
        table.tenantId,
        table.provenanceVerificationPolicyFamily,
        table.provenanceVerificationPolicyId,
        table.provenanceVerificationActivationHeadRevision,
        table.provenanceVerificationPolicyVersion,
        table.provenanceVerificationDefinitionContractVersion,
        table.provenanceVerificationDefinitionDigestSha256,
        table.provenanceVerificationServiceId
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
      name: "inbox_v2_client_links_ended_policy_authority_fk",
      columns: [
        table.tenantId,
        table.endedPolicyFamily,
        table.endedPolicyId,
        table.endedPolicyActivationHeadRevision,
        table.endedPolicyVersion,
        table.endedPolicyDefinitionContractVersion,
        table.endedPolicyDefinitionDigestSha256,
        table.endedActorServiceId
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
      "inbox_v2_conversation_client_links_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^conversation_client_link:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_conversation_client_links_provenance_check",
      sql`(
          ${table.provenanceKind} = 'manual'
          and ${table.provenanceMigrationId} is null
          and ${table.provenanceContractVersion} is null
          and ${table.provenanceClaimId} is null
          and ${table.provenanceClaimVersion} is null
          and ${table.provenanceClaimTargetClientContactId} is null
          and ${table.provenanceVerificationServiceId} is null
          and ${table.provenanceVerificationPolicyId} is null
          and ${table.provenanceVerificationPolicyVersion} is null
          and ${table.provenanceVerificationPolicyFamily} is null
          and ${table.provenanceVerificationDefinitionContractVersion} is null
          and ${table.provenanceVerificationDefinitionDigestSha256} is null
          and ${table.provenanceVerificationActivationHeadRevision} is null
          and ${table.provenanceVerificationVerifiedAt} is null
          and ${table.linkedActorKind} = 'employee'
        ) or (
          ${table.provenanceKind} = 'migration'
          and ${table.provenanceMigrationId} is not null
          and ${catalogIdSql(table.provenanceMigrationId)}
          and ${table.provenanceContractVersion} is not null
          and ${versionTokenSql(table.provenanceContractVersion)}
          and ${table.provenanceClaimId} is null
          and ${table.provenanceClaimVersion} is null
          and ${table.provenanceClaimTargetClientContactId} is null
          and ${table.provenanceVerificationServiceId} is null
          and ${table.provenanceVerificationPolicyId} is null
          and ${table.provenanceVerificationPolicyVersion} is null
          and ${table.provenanceVerificationPolicyFamily} is null
          and ${table.provenanceVerificationDefinitionContractVersion} is null
          and ${table.provenanceVerificationDefinitionDigestSha256} is null
          and ${table.provenanceVerificationActivationHeadRevision} is null
          and ${table.provenanceVerificationVerifiedAt} is null
          and ${table.linkedActorKind} = 'migration_service'
        ) or (
          ${table.provenanceKind} = 'source_identity_claim'
          and ${table.provenanceMigrationId} is null
          and ${table.provenanceContractVersion} is null
          and ${table.provenanceClaimId} is not null
          and ${table.provenanceClaimVersion} is not null
          and ${table.provenanceClaimVersion} >= 1
          and ${table.provenanceClaimTargetClientContactId} is not null
          and ${table.provenanceVerificationServiceId} is not null
          and ${catalogIdSql(table.provenanceVerificationServiceId)}
          and ${table.provenanceVerificationPolicyId} is not null
          and ${catalogIdSql(table.provenanceVerificationPolicyId)}
          and ${table.provenanceVerificationPolicyVersion} is not null
          and ${versionTokenSql(table.provenanceVerificationPolicyVersion)}
          and ${table.provenanceVerificationVerifiedAt} is not null
          and isfinite(${table.provenanceVerificationVerifiedAt})
          and ${table.provenanceVerificationVerifiedAt} <= ${table.validFrom}
          and ${table.linkedActorKind} in ('employee', 'trusted_service')
          and ${table.provenanceVerificationPolicyId} = ${table.linkedPolicyId}
          and ${table.provenanceVerificationPolicyVersion} = ${table.linkedPolicyVersion}
          and ${table.associationConfidence} = 'confirmed'
          and ${table.validFromBasis} = 'known_effective'
        ) or (
          ${table.provenanceKind} = 'trusted_policy'
          and ${table.provenanceMigrationId} is null
          and ${table.provenanceContractVersion} is null
          and ${table.provenanceClaimId} is null
          and ${table.provenanceClaimVersion} is null
          and ${table.provenanceClaimTargetClientContactId} is null
          and ${table.provenanceVerificationServiceId} is not null
          and ${catalogIdSql(table.provenanceVerificationServiceId)}
          and ${table.provenanceVerificationPolicyId} = ${table.linkedPolicyId}
          and ${table.provenanceVerificationPolicyVersion} = ${table.linkedPolicyVersion}
          and ${table.provenanceVerificationVerifiedAt} is not null
          and isfinite(${table.provenanceVerificationVerifiedAt})
          and ${table.provenanceVerificationVerifiedAt} <= ${table.validFrom}
          and ${table.linkedActorKind} = 'trusted_service'
          and ${table.associationConfidence} = 'confirmed'
          and ${table.validFromBasis} = 'known_effective'
        )`
    ),
    check(
      "inbox_v2_conversation_client_links_linked_actor_check",
      actorColumnsSql(
        table.linkedActorKind,
        table.linkedActorEmployeeId,
        table.linkedActorServiceId
      )
    ),
    check(
      "inbox_v2_conversation_client_links_linked_decision_check",
      decisionCatalogSql(
        table.linkedPolicyId,
        table.linkedPolicyVersion,
        table.linkedReasonCodeId
      )
    ),
    check(
      "inbox_v2_conversation_client_links_linked_authority_check",
      policyAuthorityColumnsSql({
        actorKind: table.linkedActorKind,
        family: table.linkedPolicyFamily,
        definitionContractVersion: table.linkedPolicyDefinitionContractVersion,
        definitionDigestSha256: table.linkedPolicyDefinitionDigestSha256,
        activationHeadRevision: table.linkedPolicyActivationHeadRevision
      })
    ),
    check(
      "inbox_v2_conversation_client_links_verification_check",
      sql`(
          ${table.provenanceKind} in ('manual', 'migration')
          and num_nonnulls(
            ${table.provenanceVerificationServiceId},
            ${table.provenanceVerificationPolicyId},
            ${table.provenanceVerificationPolicyVersion},
            ${table.provenanceVerificationPolicyFamily},
            ${table.provenanceVerificationDefinitionContractVersion},
            ${table.provenanceVerificationDefinitionDigestSha256},
            ${table.provenanceVerificationActivationHeadRevision},
            ${table.provenanceVerificationVerifiedAt}
          ) = 0
        ) or (
          ${table.provenanceKind} in ('source_identity_claim', 'trusted_policy')
          and ${table.provenanceVerificationServiceId} is not null
          and ${table.provenanceVerificationPolicyId} = ${table.linkedPolicyId}
          and ${table.provenanceVerificationPolicyVersion} = ${table.linkedPolicyVersion}
          and ${table.provenanceVerificationVerifiedAt} is not null
          and (
            (${table.linkedActorKind} = 'employee'
              and num_nonnulls(
                ${table.provenanceVerificationPolicyFamily},
                ${table.provenanceVerificationDefinitionContractVersion},
                ${table.provenanceVerificationDefinitionDigestSha256},
                ${table.provenanceVerificationActivationHeadRevision}
              ) = 0)
            or
            (${table.linkedActorKind} = 'trusted_service'
              and ${table.provenanceVerificationServiceId} = ${table.linkedActorServiceId}
              and ${table.provenanceVerificationPolicyFamily} = ${table.linkedPolicyFamily}
              and ${table.provenanceVerificationDefinitionContractVersion} = ${table.linkedPolicyDefinitionContractVersion}
              and ${table.provenanceVerificationDefinitionDigestSha256} = ${table.linkedPolicyDefinitionDigestSha256}
              and ${table.provenanceVerificationActivationHeadRevision} = ${table.linkedPolicyActivationHeadRevision})
          )
        )`
    ),
    check(
      "inbox_v2_conversation_client_links_start_basis_check",
      sql`${table.validFromBasis} <> 'migration_observed'
        or ${table.provenanceKind} = 'migration'`
    ),
    check(
      "inbox_v2_conversation_client_links_state_check",
      sql`(
          ${table.state} = 'active'
          and ${table.revision} = 1
          and num_nonnulls(
            ${table.endedAt},
            ${table.endedActorKind},
            ${table.endedActorEmployeeId},
            ${table.endedActorServiceId},
            ${table.endedPolicyId},
            ${table.endedPolicyVersion},
            ${table.endedReasonCodeId},
            ${table.endedPolicyFamily},
            ${table.endedPolicyDefinitionContractVersion},
            ${table.endedPolicyDefinitionDigestSha256},
            ${table.endedPolicyActivationHeadRevision}
          ) = 0
        ) or (
          ${table.state} = 'ended'
          and ${table.revision} = 2
          and ${table.endedAt} is not null
          and ${table.endedAt} > ${table.validFrom}
          and ${table.endedActorKind} is not null
          and ${actorColumnsSql(
            table.endedActorKind,
            table.endedActorEmployeeId,
            table.endedActorServiceId
          )}
          and ${table.endedPolicyId} is not null
          and ${table.endedPolicyVersion} is not null
          and ${table.endedReasonCodeId} is not null
          and ${decisionCatalogSql(
            table.endedPolicyId,
            table.endedPolicyVersion,
            table.endedReasonCodeId
          )}
          and ${policyAuthorityColumnsSql({
            actorKind: table.endedActorKind,
            family: table.endedPolicyFamily,
            definitionContractVersion:
              table.endedPolicyDefinitionContractVersion,
            definitionDigestSha256: table.endedPolicyDefinitionDigestSha256,
            activationHeadRevision: table.endedPolicyActivationHeadRevision
          })}
        )`
    ),
    check(
      "inbox_v2_conversation_client_links_timestamp_check",
      sql`isfinite(${table.validFrom})
        and (${table.endedAt} is null or isfinite(${table.endedAt}))`
    ),
    uniqueIndex("inbox_v2_conversation_client_links_current_client_unique")
      .on(table.tenantId, table.conversationId, table.clientId)
      .where(sql`${table.state} = 'active'`),
    index("inbox_v2_conversation_client_links_tenant_history_idx").on(
      table.tenantId,
      table.conversationId,
      table.clientId,
      table.validFrom,
      table.id
    ),
    index("inbox_v2_conversation_client_links_tenant_client_idx").on(
      table.tenantId,
      table.clientId,
      table.conversationId,
      table.id
    ),
    index("inbox_v2_conversation_client_links_tenant_claim_idx")
      .on(table.tenantId, table.provenanceClaimId, table.validFrom, table.id)
      .where(sql`${table.provenanceClaimId} is not null`)
  ]
);

/**
 * Immutable ordered evidence captured with one exact link episode. Purpose is
 * explicit so verification and generic audit arrays round-trip independently.
 */
export const inboxV2ConversationClientLinkEvidenceReferences = pgTable(
  "inbox_v2_conversation_client_link_evidence_references",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    purpose: inboxV2ConversationClientLinkEvidencePurpose("purpose").notNull(),
    ordinal: smallint("ordinal").notNull(),
    evidenceKind:
      inboxV2ConversationClientLinkEvidenceKind("evidence_kind").notNull(),
    sourceIdentityClaimId: text("source_identity_claim_id"),
    clientContactId: text("client_contact_id"),
    conversationParticipantId: text("conversation_participant_id"),
    rawInboundEventId: text("raw_inbound_event_id"),
    normalizedInboundEventId: text("normalized_inbound_event_id"),
    sourceOccurrenceId: text("source_occurrence_id")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_client_link_evidence_pk",
      columns: [table.tenantId, table.linkId, table.purpose, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_link_fk",
      columns: [table.tenantId, table.linkId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_client_link_evidence_claim_fk",
      columns: [table.tenantId, table.sourceIdentityClaimId],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_contact_fk",
      columns: [table.tenantId, table.clientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_participant_fk",
      columns: [
        table.tenantId,
        table.conversationParticipantId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_raw_fk",
      columns: [table.tenantId, table.rawInboundEventId],
      foreignColumns: [rawInboundEvents.tenantId, rawInboundEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_normalized_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_client_link_evidence_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    check(
      "inbox_v2_client_link_evidence_ordinal_check",
      sql`${table.ordinal} between 0 and 49`
    ),
    check(
      "inbox_v2_client_link_evidence_kind_check",
      sql`num_nonnulls(
          ${table.sourceIdentityClaimId},
          ${table.clientContactId},
          ${table.conversationParticipantId},
          ${table.rawInboundEventId},
          ${table.normalizedInboundEventId},
          ${table.sourceOccurrenceId}
        ) = 1 and (
          (${table.evidenceKind} = 'source_identity_claim'
            and ${table.sourceIdentityClaimId} is not null) or
          (${table.evidenceKind} = 'client_contact'
            and ${table.clientContactId} is not null) or
          (${table.evidenceKind} = 'conversation_participant'
            and ${table.conversationParticipantId} is not null) or
          (${table.evidenceKind} = 'raw_inbound_event'
            and ${table.rawInboundEventId} is not null) or
          (${table.evidenceKind} = 'normalized_inbound_event'
            and ${table.normalizedInboundEventId} is not null) or
          (${table.evidenceKind} = 'source_occurrence'
            and ${table.sourceOccurrenceId} is not null)
        )`
    ),
    index("inbox_v2_client_link_evidence_claim_idx").on(
      table.tenantId,
      table.sourceIdentityClaimId,
      table.linkId
    ),
    index("inbox_v2_client_link_evidence_contact_idx").on(
      table.tenantId,
      table.clientContactId,
      table.linkId
    ),
    index("inbox_v2_client_link_evidence_participant_idx").on(
      table.tenantId,
      table.conversationParticipantId,
      table.linkId
    ),
    index("inbox_v2_client_link_evidence_occurrence_idx").on(
      table.tenantId,
      table.sourceOccurrenceId,
      table.linkId
    ),
    index("inbox_v2_client_link_evidence_raw_idx").on(
      table.tenantId,
      table.rawInboundEventId,
      table.linkId
    ),
    index("inbox_v2_client_link_evidence_normalized_idx").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.linkId
    )
  ]
);

/** Optional set head: an untouched Conversation intentionally has no row. */
export const inboxV2ConversationClientLinkHeads = pgTable(
  "inbox_v2_conversation_client_link_heads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    conversationId: text("conversation_id").notNull(),
    primaryLinkId: text("primary_link_id"),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_client_link_heads_pk",
      columns: [table.tenantId, table.conversationId]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_link_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_conversation_client_link_heads_primary_fk",
      columns: [table.tenantId, table.primaryLinkId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }),
    check(
      "inbox_v2_conversation_client_link_heads_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "inbox_v2_conversation_client_link_heads_timestamp_check",
      sql`isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_conversation_client_link_heads_tenant_revision_idx").on(
      table.tenantId,
      table.revision,
      table.conversationId
    )
  ]
);

/** One immutable CAS-fenced mutation of the Conversation Client-link set. */
export const inboxV2ConversationClientLinkTransitions = pgTable(
  "inbox_v2_conversation_client_link_transitions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    previousPrimaryLinkId: text("previous_primary_link_id"),
    resultingPrimaryLinkId: text("resulting_primary_link_id"),
    actorKind: inboxV2ConversationClientLinkActorKind("actor_kind").notNull(),
    actorEmployeeId: text("actor_employee_id"),
    actorServiceId: text("actor_service_id"),
    policyId: text("policy_id").notNull(),
    policyVersion: text("policy_version").notNull(),
    reasonCodeId: text("reason_code_id").notNull(),
    policyFamily: inboxV2TenantPolicyFamily("policy_family"),
    policyDefinitionContractVersion: text("policy_definition_contract_version"),
    policyDefinitionDigestSha256: text("policy_definition_digest_sha256"),
    policyActivationHeadRevision: bigint("policy_activation_head_revision", {
      mode: "bigint"
    }),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }),
    currentRevision: bigint("current_revision", { mode: "bigint" }),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_client_link_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_conversation_client_link_transitions_revision_unique").on(
      table.tenantId,
      table.conversationId,
      table.resultingRevision
    ),
    unique("inbox_v2_conversation_client_link_transitions_exact_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.resultingRevision
    ),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transitions_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transitions_previous_primary_fk",
      columns: [
        table.tenantId,
        table.previousPrimaryLinkId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transitions_result_primary_fk",
      columns: [
        table.tenantId,
        table.resultingPrimaryLinkId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transitions_employee_fk",
      columns: [table.tenantId, table.actorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_client_link_transitions_policy_authority_fk",
      columns: [
        table.tenantId,
        table.policyFamily,
        table.policyId,
        table.policyActivationHeadRevision,
        table.policyVersion,
        table.policyDefinitionContractVersion,
        table.policyDefinitionDigestSha256,
        table.actorServiceId
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
      "inbox_v2_conversation_client_link_transitions_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^conversation_client_link_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_conversation_client_link_transitions_actor_check",
      actorColumnsSql(
        table.actorKind,
        table.actorEmployeeId,
        table.actorServiceId
      )
    ),
    check(
      "inbox_v2_conversation_client_link_transitions_decision_check",
      decisionCatalogSql(
        table.policyId,
        table.policyVersion,
        table.reasonCodeId
      )
    ),
    check(
      "inbox_v2_client_link_transitions_authority_check",
      policyAuthorityColumnsSql({
        actorKind: table.actorKind,
        family: table.policyFamily,
        definitionContractVersion: table.policyDefinitionContractVersion,
        definitionDigestSha256: table.policyDefinitionDigestSha256,
        activationHeadRevision: table.policyActivationHeadRevision
      })
    ),
    check(
      "inbox_v2_conversation_client_link_transitions_cas_check",
      sql`${table.expectedRevision} is not distinct from ${table.currentRevision}
        and (
          (${table.currentRevision} is null and ${table.resultingRevision} = 1)
          or (
            ${table.currentRevision} is not null
            and ${table.currentRevision} >= 1
            and ${table.resultingRevision} = ${table.currentRevision} + 1
          )
        )`
    ),
    check(
      "inbox_v2_conversation_client_link_transitions_timestamp_check",
      sql`isfinite(${table.occurredAt})`
    ),
    index("inbox_v2_conversation_client_link_transitions_tenant_time_idx").on(
      table.tenantId,
      table.conversationId,
      table.occurredAt,
      table.resultingRevision
    )
  ]
);

/** Immutable, bounded role set owned by the link's create transition. */
export const inboxV2ConversationClientLinkRoles = pgTable(
  "inbox_v2_conversation_client_link_roles",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    linkId: text("link_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    creationTransitionId: text("creation_transition_id").notNull(),
    creationRevision: bigint("creation_revision", {
      mode: "bigint"
    }).notNull(),
    roleId: text("role_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_client_link_roles_pk",
      columns: [table.tenantId, table.linkId, table.roleId]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_link_roles_link_fk",
      columns: [table.tenantId, table.linkId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_conversation_client_link_roles_transition_fk",
      columns: [
        table.tenantId,
        table.creationTransitionId,
        table.conversationId,
        table.creationRevision
      ],
      foreignColumns: [
        inboxV2ConversationClientLinkTransitions.tenantId,
        inboxV2ConversationClientLinkTransitions.id,
        inboxV2ConversationClientLinkTransitions.conversationId,
        inboxV2ConversationClientLinkTransitions.resultingRevision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_conversation_client_link_roles_role_check",
      catalogIdSql(table.roleId)
    ),
    check(
      "inbox_v2_conversation_client_link_roles_revision_check",
      sql`${table.creationRevision} >= 1`
    ),
    index("inbox_v2_conversation_client_link_roles_tenant_role_idx").on(
      table.tenantId,
      table.roleId,
      table.conversationId,
      table.linkId
    )
  ]
);

/** One-way transition ownership avoids a link/transition insertion FK cycle. */
export const inboxV2ConversationClientLinkTransitionOperations = pgTable(
  "inbox_v2_conversation_client_link_transition_operations",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    transitionId: text("transition_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    linkId: text("link_id").notNull(),
    operationKind:
      inboxV2ConversationClientLinkOperationKind("operation_kind").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_client_link_transition_operations_pk",
      columns: [table.tenantId, table.transitionId, table.linkId]
    }),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transition_operations_transition_fk",
      columns: [
        table.tenantId,
        table.transitionId,
        table.conversationId,
        table.resultingRevision
      ],
      foreignColumns: [
        inboxV2ConversationClientLinkTransitions.tenantId,
        inboxV2ConversationClientLinkTransitions.id,
        inboxV2ConversationClientLinkTransitions.conversationId,
        inboxV2ConversationClientLinkTransitions.resultingRevision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_conversation_client_link_transition_operations_link_fk",
      columns: [table.tenantId, table.linkId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationClientLinks.tenantId,
        inboxV2ConversationClientLinks.id,
        inboxV2ConversationClientLinks.conversationId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_conversation_client_link_transition_operations_revision_check",
      sql`${table.resultingRevision} >= 1`
    ),
    index(
      "inbox_v2_conversation_client_link_transition_operations_tenant_link_idx"
    ).on(
      table.tenantId,
      table.linkId,
      table.resultingRevision,
      table.transitionId
    )
  ]
);

function actorColumnsSql(
  kind: SQLWrapper,
  employeeId: SQLWrapper,
  serviceId: SQLWrapper
) {
  return sql`(
      ${kind} = 'employee'
      and ${employeeId} is not null
      and ${serviceId} is null
    ) or (
      ${kind} = 'trusted_service'
      and ${employeeId} is null
      and ${serviceId} is not null
      and ${catalogIdSql(serviceId)}
    ) or (
      ${kind} = 'migration_service'
      and ${employeeId} is null
      and ${serviceId} is not null
      and ${catalogIdSql(serviceId)}
    )`;
}

function policyAuthorityColumnsSql(input: {
  actorKind: SQLWrapper;
  family: SQLWrapper;
  definitionContractVersion: SQLWrapper;
  definitionDigestSha256: SQLWrapper;
  activationHeadRevision: SQLWrapper;
}) {
  return sql`(
      ${input.actorKind} = 'trusted_service'
      and ${input.family} = 'conversation_client_link'
      and ${input.definitionContractVersion} is not null
      and ${versionTokenSql(input.definitionContractVersion)}
      and ${input.definitionDigestSha256} ~ '^[a-f0-9]{64}$'
      and ${input.activationHeadRevision} >= 1
    ) or (
      ${input.actorKind} <> 'trusted_service'
      and num_nonnulls(
        ${input.family},
        ${input.definitionContractVersion},
        ${input.definitionDigestSha256},
        ${input.activationHeadRevision}
      ) = 0
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

function versionTokenSql(column: SQLWrapper) {
  return sql`${column} ~ '^v[1-9][0-9]*$'`;
}

/**
 * Commit-time graph closure plus hot-path write guards. Validation is bounded
 * to one Conversation, transition or link episode and uses tenant-leading
 * indexes; runtime writes never load a tenant-wide graph.
 */
export const INBOX_V2_CONVERSATION_CLIENT_LINK_INTEGRITY_SQL = String.raw`
create or replace function public.inbox_v2_conversation_client_link_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and (
    not exists (
      select 1
        from public.tenants tenant_row
       where tenant_row.id = old.tenant_id
    )
    or not exists (
      select 1
        from public.inbox_v2_conversations conversation_row
       where conversation_row.tenant_id = old.tenant_id
         and conversation_row.id = old.conversation_id
    )
  ) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.conversation_client_link_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_assert_current_policy(
  checked_tenant_id text,
  checked_actor_kind public.inbox_v2_conversation_client_link_actor_kind,
  checked_service_id text,
  checked_family public.inbox_v2_tenant_policy_family,
  checked_policy_id text,
  checked_policy_version text,
  checked_definition_contract_version text,
  checked_definition_digest_sha256 text,
  checked_activation_head_revision bigint,
  checked_occurred_at timestamptz
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_row public.inbox_v2_tenant_policy_activation_heads%rowtype;
begin
  if checked_actor_kind <> 'trusted_service' then
    return;
  end if;
  select * into head_row
    from public.inbox_v2_tenant_policy_activation_heads candidate
   where candidate.tenant_id = checked_tenant_id
     and candidate.family = checked_family
     and candidate.policy_id = checked_policy_id
   for share;
  if not found
     or head_row.state <> 'active'
     or head_row.policy_version <> checked_policy_version
     or head_row.definition_contract_version <>
       checked_definition_contract_version
     or head_row.definition_digest_sha256 <>
       checked_definition_digest_sha256
     or head_row.approved_trusted_service_id <> checked_service_id
     or head_row.revision <> checked_activation_head_revision
     or head_row.activated_at > checked_occurred_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_policy_not_current';
  end if;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_assert_employee_at(
  checked_tenant_id text,
  checked_actor_kind public.inbox_v2_conversation_client_link_actor_kind,
  checked_employee_id text,
  checked_occurred_at timestamptz
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  employee_created_at timestamptz;
  employee_deactivated_at timestamptz;
begin
  if checked_actor_kind <> 'employee' then
    return;
  end if;

  select employee_row.created_at, employee_row.deactivated_at
    into employee_created_at, employee_deactivated_at
    from public.employees employee_row
   where employee_row.tenant_id = checked_tenant_id
     and employee_row.id = checked_employee_id
   for share;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.conversation_client_link_employee_missing';
  end if;

  if employee_created_at > checked_occurred_at
     or (employee_deactivated_at is not null
         and employee_deactivated_at <= checked_occurred_at) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_employee_inactive';
  end if;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_episode_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  claim_source_external_identity_id text;
  claim_status public.inbox_v2_source_identity_claim_status;
  claim_created_at timestamptz;
  claim_revoked_at timestamptz;
begin
  perform 1
    from public.inbox_v2_conversations conversation_row
   where conversation_row.tenant_id = new.tenant_id
     and conversation_row.id = new.conversation_id
   for no key update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.conversation_client_link_conversation_missing';
  end if;

  perform public.inbox_v2_conversation_client_link_assert_current_policy(
    new.tenant_id,
    new.linked_actor_kind,
    new.linked_actor_service_id,
    new.linked_policy_family,
    new.linked_policy_id,
    new.linked_policy_version,
    new.linked_policy_definition_contract_version,
    new.linked_policy_definition_digest_sha256,
    new.linked_policy_activation_head_revision,
    new.valid_from
  );
  perform public.inbox_v2_conversation_client_link_assert_employee_at(
    new.tenant_id,
    new.linked_actor_kind,
    new.linked_actor_employee_id,
    new.valid_from
  );

  if new.provenance_kind = 'source_identity_claim' then
    select claim_row.source_external_identity_id
      into claim_source_external_identity_id
      from public.inbox_v2_source_identity_claims claim_row
     where claim_row.tenant_id = new.tenant_id
       and claim_row.id = new.provenance_claim_id
       and claim_row.claim_version = new.provenance_claim_version
       and claim_row.target_client_contact_id =
         new.provenance_claim_target_client_contact_id;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.conversation_client_link_claim_missing';
    end if;

    perform 1
      from public.inbox_v2_source_external_identities identity_row
     where identity_row.tenant_id = new.tenant_id
       and identity_row.id = claim_source_external_identity_id
     for share;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.conversation_client_link_claim_identity_missing';
    end if;

    select claim_row.status, claim_row.created_at, claim_row.revoked_at
      into claim_status, claim_created_at, claim_revoked_at
      from public.inbox_v2_source_identity_claims claim_row
     where claim_row.tenant_id = new.tenant_id
       and claim_row.source_external_identity_id =
         claim_source_external_identity_id
       and claim_row.id = new.provenance_claim_id
       and claim_row.claim_version = new.provenance_claim_version
       and claim_row.target_kind = 'client_contact'
       and claim_row.target_client_contact_id =
         new.provenance_claim_target_client_contact_id
     for share;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.conversation_client_link_claim_missing';
    end if;

    perform 1
      from public.client_contacts contact_row
     where contact_row.tenant_id = new.tenant_id
       and contact_row.id = new.provenance_claim_target_client_contact_id
       and contact_row.client_id = new.client_id
     for share;
    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_claim_target_invalid';
    end if;

    perform 1
      from public.clients client_row
     where client_row.tenant_id = new.tenant_id
       and client_row.id = new.client_id
     for share;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.conversation_client_link_client_missing';
    end if;

    if new.provenance_verification_verified_at is null
       or new.valid_from is null
       or claim_created_at > new.provenance_verification_verified_at
       or new.provenance_verification_verified_at > new.valid_from
       or claim_created_at > new.valid_from
       or (
         claim_revoked_at is not null
         and claim_revoked_at < new.valid_from
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_claim_time_invalid';
    end if;
  end if;

  if exists (
    select 1
      from public.inbox_v2_conversation_client_links existing_row
     where existing_row.tenant_id = new.tenant_id
       and existing_row.conversation_id = new.conversation_id
       and existing_row.client_id = new.client_id
       and existing_row.id <> new.id
       and tstzrange(
         existing_row.valid_from,
         coalesce(existing_row.ended_at, 'infinity'::timestamptz),
         '[)'
       ) && tstzrange(
         new.valid_from,
         coalesce(new.ended_at, 'infinity'::timestamptz),
         '[)'
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_history_overlap';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_episode_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_conversations conversation_row
   where conversation_row.tenant_id = old.tenant_id
     and conversation_row.id = old.conversation_id
   for no key update;

  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.conversation_id is distinct from old.conversation_id
     or new.client_id is distinct from old.client_id
     or new.association_confidence is distinct from old.association_confidence
     or new.provenance_kind is distinct from old.provenance_kind
     or new.provenance_migration_id is distinct from old.provenance_migration_id
     or new.provenance_contract_version is distinct from old.provenance_contract_version
     or new.provenance_claim_id is distinct from old.provenance_claim_id
     or new.provenance_claim_version is distinct from old.provenance_claim_version
     or new.provenance_claim_target_client_contact_id is distinct from old.provenance_claim_target_client_contact_id
     or new.provenance_verification_service_id is distinct from old.provenance_verification_service_id
     or new.provenance_verification_policy_id is distinct from old.provenance_verification_policy_id
     or new.provenance_verification_policy_version is distinct from old.provenance_verification_policy_version
     or new.provenance_verification_policy_family is distinct from old.provenance_verification_policy_family
     or new.provenance_verification_definition_contract_version is distinct from old.provenance_verification_definition_contract_version
     or new.provenance_verification_definition_digest_sha256 is distinct from old.provenance_verification_definition_digest_sha256
     or new.provenance_verification_activation_head_revision is distinct from old.provenance_verification_activation_head_revision
     or new.provenance_verification_verified_at is distinct from old.provenance_verification_verified_at
     or new.linked_actor_kind is distinct from old.linked_actor_kind
     or new.linked_actor_employee_id is distinct from old.linked_actor_employee_id
     or new.linked_actor_service_id is distinct from old.linked_actor_service_id
     or new.linked_policy_id is distinct from old.linked_policy_id
     or new.linked_policy_version is distinct from old.linked_policy_version
     or new.linked_reason_code_id is distinct from old.linked_reason_code_id
     or new.linked_policy_family is distinct from old.linked_policy_family
     or new.linked_policy_definition_contract_version is distinct from old.linked_policy_definition_contract_version
     or new.linked_policy_definition_digest_sha256 is distinct from old.linked_policy_definition_digest_sha256
     or new.linked_policy_activation_head_revision is distinct from old.linked_policy_activation_head_revision
     or new.valid_from is distinct from old.valid_from
     or new.valid_from_basis is distinct from old.valid_from_basis
     or old.state <> 'active'
     or new.state <> 'ended'
     or new.revision <> old.revision + 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_episode_invalid_update';
  end if;
  perform public.inbox_v2_conversation_client_link_assert_current_policy(
    new.tenant_id,
    new.ended_actor_kind,
    new.ended_actor_service_id,
    new.ended_policy_family,
    new.ended_policy_id,
    new.ended_policy_version,
    new.ended_policy_definition_contract_version,
    new.ended_policy_definition_digest_sha256,
    new.ended_policy_activation_head_revision,
    new.ended_at
  );
  perform public.inbox_v2_conversation_client_link_assert_employee_at(
    new.tenant_id,
    new.ended_actor_kind,
    new.ended_actor_employee_id,
    new.ended_at
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_transition_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_revision bigint;
  head_primary_link_id text;
  predecessor_time timestamptz;
begin
  perform 1
    from public.inbox_v2_conversations conversation_row
   where conversation_row.tenant_id = new.tenant_id
     and conversation_row.id = new.conversation_id
   for no key update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.conversation_client_link_conversation_missing';
  end if;

  perform public.inbox_v2_conversation_client_link_assert_current_policy(
    new.tenant_id,
    new.actor_kind,
    new.actor_service_id,
    new.policy_family,
    new.policy_id,
    new.policy_version,
    new.policy_definition_contract_version,
    new.policy_definition_digest_sha256,
    new.policy_activation_head_revision,
    new.occurred_at
  );
  perform public.inbox_v2_conversation_client_link_assert_employee_at(
    new.tenant_id,
    new.actor_kind,
    new.actor_employee_id,
    new.occurred_at
  );

  select head_row.revision, head_row.primary_link_id
    into head_revision, head_primary_link_id
    from public.inbox_v2_conversation_client_link_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.conversation_id = new.conversation_id
   for update;

  if new.current_revision is null then
    if found or new.previous_primary_link_id is not null then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.conversation_client_link_revision_conflict';
    end if;
  elsif not found
     or head_revision <> new.current_revision
     or head_primary_link_id is distinct from new.previous_primary_link_id then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.conversation_client_link_revision_conflict';
  end if;

  if new.current_revision is not null then
    select transition_row.occurred_at
      into predecessor_time
      from public.inbox_v2_conversation_client_link_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.conversation_id = new.conversation_id
       and transition_row.resulting_revision = new.current_revision;
    if not found or new.occurred_at < predecessor_time then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_transition_time_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_assert_open_transition(
  checked_tenant_id text,
  checked_conversation_id text,
  checked_transition_id text,
  checked_resulting_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_current_revision bigint;
  head_revision bigint;
  has_head boolean := false;
begin
  select transition_row.current_revision
    into transition_current_revision
    from public.inbox_v2_conversation_client_link_transitions transition_row
   where transition_row.tenant_id = checked_tenant_id
     and transition_row.id = checked_transition_id
     and transition_row.conversation_id = checked_conversation_id
     and transition_row.resulting_revision = checked_resulting_revision;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.conversation_client_link_transition_missing';
  end if;

  select head_row.revision
    into head_revision
    from public.inbox_v2_conversation_client_link_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id
   for update;
  has_head := found;

  if (transition_current_revision is null and has_head)
     or (transition_current_revision is not null and (
       not has_head or head_revision <> transition_current_revision
     )) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_transition_closed';
  end if;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_role_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_conversation_client_link_assert_open_transition(
    new.tenant_id,
    new.conversation_id,
    new.creation_transition_id,
    new.creation_revision
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_operation_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_conversation_client_link_assert_open_transition(
    new.tenant_id,
    new.conversation_id,
    new.transition_id,
    new.resulting_revision
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_head_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.revision <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_head_invalid_initial';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_head_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.conversation_id is distinct from old.conversation_id
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_head_invalid_advance';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_client_link_evidence(
  checked_tenant_id text,
  checked_link_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  link_row public.inbox_v2_conversation_client_links%rowtype;
  verification_count integer;
  verification_min integer;
  verification_max integer;
  verification_distinct integer;
  audit_count integer;
  audit_min integer;
  audit_max integer;
  audit_distinct integer;
  duplicate_count integer;
  invalid_count integer;
begin
  select * into link_row
    from public.inbox_v2_conversation_client_links candidate
   where candidate.tenant_id = checked_tenant_id
     and candidate.id = checked_link_id;
  if not found then
    return;
  end if;

  select
    count(*) filter (where evidence_row.purpose = 'verification')::integer,
    min(evidence_row.ordinal) filter (where evidence_row.purpose = 'verification'),
    max(evidence_row.ordinal) filter (where evidence_row.purpose = 'verification'),
    count(distinct evidence_row.ordinal) filter (where evidence_row.purpose = 'verification')::integer,
    count(*) filter (where evidence_row.purpose = 'audit')::integer,
    min(evidence_row.ordinal) filter (where evidence_row.purpose = 'audit'),
    max(evidence_row.ordinal) filter (where evidence_row.purpose = 'audit'),
    count(distinct evidence_row.ordinal) filter (where evidence_row.purpose = 'audit')::integer
    into verification_count, verification_min, verification_max,
         verification_distinct, audit_count, audit_min, audit_max,
         audit_distinct
    from public.inbox_v2_conversation_client_link_evidence_references evidence_row
   where evidence_row.tenant_id = checked_tenant_id
     and evidence_row.link_id = checked_link_id;

  if (
       link_row.provenance_kind in ('source_identity_claim', 'trusted_policy')
       and (
         verification_count < 1 or verification_count > 50
         or verification_min <> 0
         or verification_max <> verification_count - 1
         or verification_distinct <> verification_count
       )
     ) or (
       link_row.provenance_kind not in ('source_identity_claim', 'trusted_policy')
       and verification_count <> 0
     ) or audit_count > 50 or (
       audit_count > 0 and (
         audit_min <> 0
         or audit_max <> audit_count - 1
         or audit_distinct <> audit_count
       )
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_evidence_cardinality_invalid';
  end if;

  select count(*)::integer into duplicate_count
    from (
      select evidence_row.purpose, evidence_row.evidence_kind,
             coalesce(
               evidence_row.source_identity_claim_id,
               evidence_row.client_contact_id,
               evidence_row.conversation_participant_id,
               evidence_row.raw_inbound_event_id,
               evidence_row.normalized_inbound_event_id,
               evidence_row.source_occurrence_id
             ) as evidence_id
        from public.inbox_v2_conversation_client_link_evidence_references evidence_row
       where evidence_row.tenant_id = checked_tenant_id
         and evidence_row.link_id = checked_link_id
       group by evidence_row.purpose, evidence_row.evidence_kind,
                coalesce(
                  evidence_row.source_identity_claim_id,
                  evidence_row.client_contact_id,
                  evidence_row.conversation_participant_id,
                  evidence_row.raw_inbound_event_id,
                  evidence_row.normalized_inbound_event_id,
                  evidence_row.source_occurrence_id
                )
      having count(*) > 1
    ) duplicate_row;
  if duplicate_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_evidence_duplicate';
  end if;

  select count(*)::integer into invalid_count
    from public.inbox_v2_conversation_client_link_evidence_references evidence_row
   where evidence_row.tenant_id = checked_tenant_id
     and evidence_row.link_id = checked_link_id
     and case evidence_row.evidence_kind
       when 'source_identity_claim' then not exists (
         select 1
           from public.inbox_v2_source_identity_claims claim_row
           join public.client_contacts contact_row
             on contact_row.tenant_id = claim_row.tenant_id
            and contact_row.id = claim_row.target_client_contact_id
          where claim_row.tenant_id = link_row.tenant_id
            and claim_row.id = evidence_row.source_identity_claim_id
            and claim_row.target_kind = 'client_contact'
            and contact_row.client_id = link_row.client_id
       )
       when 'client_contact' then not exists (
         select 1 from public.client_contacts contact_row
          where contact_row.tenant_id = link_row.tenant_id
            and contact_row.id = evidence_row.client_contact_id
            and contact_row.client_id = link_row.client_id
       )
       when 'conversation_participant' then not exists (
         select 1 from public.inbox_v2_conversation_participants participant_row
          where participant_row.tenant_id = link_row.tenant_id
            and participant_row.id = evidence_row.conversation_participant_id
            and participant_row.conversation_id = link_row.conversation_id
       )
       when 'source_occurrence' then not exists (
         select 1 from public.inbox_v2_source_occurrences occurrence_row
          where occurrence_row.tenant_id = link_row.tenant_id
            and occurrence_row.id = evidence_row.source_occurrence_id
            and occurrence_row.conversation_id = link_row.conversation_id
       )
       when 'raw_inbound_event' then not exists (
         select 1
           from public.inbox_v2_conversation_client_link_evidence_references occurrence_evidence
           join public.inbox_v2_source_occurrences occurrence_row
             on occurrence_row.tenant_id = occurrence_evidence.tenant_id
            and occurrence_row.id = occurrence_evidence.source_occurrence_id
          where occurrence_evidence.tenant_id = evidence_row.tenant_id
            and occurrence_evidence.link_id = evidence_row.link_id
            and occurrence_evidence.purpose = evidence_row.purpose
            and occurrence_evidence.evidence_kind = 'source_occurrence'
            and occurrence_row.raw_inbound_event_id = evidence_row.raw_inbound_event_id
       )
       when 'normalized_inbound_event' then not exists (
         select 1
           from public.inbox_v2_conversation_client_link_evidence_references occurrence_evidence
           join public.inbox_v2_source_occurrences occurrence_row
             on occurrence_row.tenant_id = occurrence_evidence.tenant_id
            and occurrence_row.id = occurrence_evidence.source_occurrence_id
          where occurrence_evidence.tenant_id = evidence_row.tenant_id
            and occurrence_evidence.link_id = evidence_row.link_id
            and occurrence_evidence.purpose = evidence_row.purpose
            and occurrence_evidence.evidence_kind = 'source_occurrence'
            and occurrence_row.normalized_inbound_event_id =
              evidence_row.normalized_inbound_event_id
       )
     end;
  if invalid_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_evidence_scope_invalid';
  end if;

  select count(*)::integer into invalid_count
    from public.inbox_v2_conversation_client_link_evidence_references evidence_row
   where evidence_row.tenant_id = checked_tenant_id
     and evidence_row.link_id = checked_link_id
     and evidence_row.purpose = 'verification'
     and case evidence_row.evidence_kind
       when 'source_identity_claim' then not exists (
         select 1
           from public.inbox_v2_source_identity_claims claim_row
           join public.client_contacts contact_row
             on contact_row.tenant_id = claim_row.tenant_id
            and contact_row.id = claim_row.target_client_contact_id
          where claim_row.tenant_id = link_row.tenant_id
            and claim_row.id = evidence_row.source_identity_claim_id
            and claim_row.target_kind = 'client_contact'
            and contact_row.client_id = link_row.client_id
            and claim_row.created_at <= link_row.valid_from
            and (
              claim_row.revoked_at is null
              or claim_row.revoked_at >= link_row.valid_from
            )
            and (
              exists (
                select 1
                  from public.inbox_v2_conversation_client_link_evidence_references participant_evidence
                  join public.inbox_v2_conversation_participants participant_row
                    on participant_row.tenant_id = participant_evidence.tenant_id
                   and participant_row.id = participant_evidence.conversation_participant_id
                 where participant_evidence.tenant_id = evidence_row.tenant_id
                   and participant_evidence.link_id = evidence_row.link_id
                   and participant_evidence.purpose = 'verification'
                   and participant_evidence.evidence_kind = 'conversation_participant'
                   and participant_row.conversation_id = link_row.conversation_id
                   and participant_row.subject_kind = 'source_external_identity'
                   and participant_row.subject_source_external_identity_id =
                     claim_row.source_external_identity_id
              ) or exists (
                select 1
                  from public.inbox_v2_conversation_client_link_evidence_references occurrence_evidence
                  join public.inbox_v2_source_occurrences occurrence_row
                    on occurrence_row.tenant_id = occurrence_evidence.tenant_id
                   and occurrence_row.id = occurrence_evidence.source_occurrence_id
                 where occurrence_evidence.tenant_id = evidence_row.tenant_id
                   and occurrence_evidence.link_id = evidence_row.link_id
                   and occurrence_evidence.purpose = 'verification'
                   and occurrence_evidence.evidence_kind = 'source_occurrence'
                   and occurrence_row.conversation_id = link_row.conversation_id
                   and occurrence_row.provider_actor_source_external_identity_id =
                     claim_row.source_external_identity_id
              )
            )
       )
       when 'client_contact' then not exists (
         select 1
           from public.inbox_v2_conversation_client_link_evidence_references participant_evidence
           join public.inbox_v2_conversation_participants participant_row
             on participant_row.tenant_id = participant_evidence.tenant_id
            and participant_row.id = participant_evidence.conversation_participant_id
          where participant_evidence.tenant_id = evidence_row.tenant_id
            and participant_evidence.link_id = evidence_row.link_id
            and participant_evidence.purpose = 'verification'
            and participant_evidence.evidence_kind = 'conversation_participant'
            and participant_row.conversation_id = link_row.conversation_id
            and participant_row.subject_kind = 'client_contact'
            and participant_row.subject_client_contact_id =
              evidence_row.client_contact_id
       )
       when 'conversation_participant' then not exists (
         select 1
           from public.inbox_v2_conversation_participants participant_row
          where participant_row.tenant_id = evidence_row.tenant_id
            and participant_row.id = evidence_row.conversation_participant_id
            and participant_row.conversation_id = link_row.conversation_id
            and (
              (
                participant_row.subject_kind = 'client_contact'
                and exists (
                  select 1
                    from public.inbox_v2_conversation_client_link_evidence_references contact_evidence
                   where contact_evidence.tenant_id = evidence_row.tenant_id
                     and contact_evidence.link_id = evidence_row.link_id
                     and contact_evidence.purpose = 'verification'
                     and contact_evidence.evidence_kind = 'client_contact'
                     and contact_evidence.client_contact_id =
                       participant_row.subject_client_contact_id
                )
              ) or (
                participant_row.subject_kind = 'source_external_identity'
                and exists (
                  select 1
                    from public.inbox_v2_conversation_client_link_evidence_references claim_evidence
                    join public.inbox_v2_source_identity_claims claim_row
                      on claim_row.tenant_id = claim_evidence.tenant_id
                     and claim_row.id = claim_evidence.source_identity_claim_id
                    join public.client_contacts contact_row
                      on contact_row.tenant_id = claim_row.tenant_id
                     and contact_row.id = claim_row.target_client_contact_id
                   where claim_evidence.tenant_id = evidence_row.tenant_id
                     and claim_evidence.link_id = evidence_row.link_id
                     and claim_evidence.purpose = 'verification'
                     and claim_evidence.evidence_kind = 'source_identity_claim'
                     and claim_row.source_external_identity_id =
                       participant_row.subject_source_external_identity_id
                     and claim_row.created_at <= link_row.valid_from
                     and (
                       claim_row.revoked_at is null
                       or claim_row.revoked_at >= link_row.valid_from
                     )
                     and contact_row.client_id = link_row.client_id
                )
              )
            )
       )
       when 'source_occurrence' then not exists (
         select 1
           from public.inbox_v2_source_occurrences occurrence_row
           join public.inbox_v2_conversation_client_link_evidence_references claim_evidence
             on claim_evidence.tenant_id = occurrence_row.tenant_id
            and claim_evidence.link_id = evidence_row.link_id
            and claim_evidence.purpose = 'verification'
            and claim_evidence.evidence_kind = 'source_identity_claim'
           join public.inbox_v2_source_identity_claims claim_row
             on claim_row.tenant_id = claim_evidence.tenant_id
            and claim_row.id = claim_evidence.source_identity_claim_id
           join public.client_contacts contact_row
             on contact_row.tenant_id = claim_row.tenant_id
            and contact_row.id = claim_row.target_client_contact_id
          where occurrence_row.tenant_id = evidence_row.tenant_id
            and occurrence_row.id = evidence_row.source_occurrence_id
            and occurrence_row.conversation_id = link_row.conversation_id
            and occurrence_row.provider_actor_source_external_identity_id =
              claim_row.source_external_identity_id
            and claim_row.created_at <= link_row.valid_from
            and (
              claim_row.revoked_at is null
              or claim_row.revoked_at >= link_row.valid_from
            )
            and contact_row.client_id = link_row.client_id
       )
       when 'raw_inbound_event' then false
       when 'normalized_inbound_event' then false
     end;
  if invalid_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_verification_graph_invalid';
  end if;

  if link_row.provenance_kind = 'source_identity_claim'
     and not exists (
       select 1
         from public.inbox_v2_conversation_client_link_evidence_references evidence_row
        where evidence_row.tenant_id = link_row.tenant_id
          and evidence_row.link_id = link_row.id
          and evidence_row.purpose = 'verification'
          and evidence_row.evidence_kind = 'source_identity_claim'
          and evidence_row.source_identity_claim_id =
            link_row.provenance_claim_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_claim_evidence_missing';
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_client_link_episode(
  checked_tenant_id text,
  checked_link_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  link_row public.inbox_v2_conversation_client_links%rowtype;
  claim_source_external_identity_id text;
  claim_created_at timestamptz;
  claim_revoked_at timestamptz;
  role_count integer;
  legacy_role_count integer;
  create_count integer;
  end_count integer;
  create_matches boolean;
  end_matches boolean;
begin
  select * into link_row
    from public.inbox_v2_conversation_client_links candidate
   where candidate.tenant_id = checked_tenant_id
     and candidate.id = checked_link_id;
  if not found then
    return;
  end if;

  if link_row.provenance_kind = 'source_identity_claim' then
    select
      claim_row.source_external_identity_id,
      claim_row.created_at,
      claim_row.revoked_at
      into
        claim_source_external_identity_id,
        claim_created_at,
        claim_revoked_at
      from public.inbox_v2_source_identity_claims claim_row
     where claim_row.tenant_id = link_row.tenant_id
       and claim_row.id = link_row.provenance_claim_id
       and claim_row.claim_version = link_row.provenance_claim_version
       and claim_row.target_kind = 'client_contact'
       and claim_row.target_client_contact_id =
         link_row.provenance_claim_target_client_contact_id;
    if not found
       or link_row.provenance_verification_verified_at is null
       or claim_created_at > link_row.provenance_verification_verified_at
       or link_row.provenance_verification_verified_at > link_row.valid_from
       or (
         claim_revoked_at is not null
         and link_row.valid_from > claim_revoked_at
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_claim_anchor_invalid';
    end if;

  end if;

  perform public.inbox_v2_assert_conversation_client_link_evidence(
    checked_tenant_id,
    checked_link_id
  );

  select count(*)::integer,
         count(*) filter (where role_row.role_id = 'core:legacy-unspecified')::integer
    into role_count, legacy_role_count
    from public.inbox_v2_conversation_client_link_roles role_row
   where role_row.tenant_id = checked_tenant_id
     and role_row.link_id = checked_link_id;
  if role_count < 1 or role_count > 16
     or (legacy_role_count <> 0 and role_count <> 1) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_roles_invalid';
  end if;

  if link_row.provenance_migration_id = 'core:legacy-v1'
     and (
       role_count <> 1
       or legacy_role_count <> 1
       or link_row.association_confidence <> 'confirmed'
       or link_row.valid_from_basis <> 'migration_observed'
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_legacy_v1_invalid';
  end if;

  select count(*)::integer,
         coalesce(bool_and(
           transition_row.occurred_at = link_row.valid_from
           and transition_row.actor_kind = link_row.linked_actor_kind
           and transition_row.actor_employee_id is not distinct from link_row.linked_actor_employee_id
           and transition_row.actor_service_id is not distinct from link_row.linked_actor_service_id
           and transition_row.policy_id = link_row.linked_policy_id
           and transition_row.policy_version = link_row.linked_policy_version
           and transition_row.reason_code_id = link_row.linked_reason_code_id
           and transition_row.policy_family is not distinct from link_row.linked_policy_family
           and transition_row.policy_definition_contract_version is not distinct from link_row.linked_policy_definition_contract_version
           and transition_row.policy_definition_digest_sha256 is not distinct from link_row.linked_policy_definition_digest_sha256
           and transition_row.policy_activation_head_revision is not distinct from link_row.linked_policy_activation_head_revision
         ), false)
    into create_count, create_matches
    from public.inbox_v2_conversation_client_link_transition_operations operation_row
    join public.inbox_v2_conversation_client_link_transitions transition_row
      on transition_row.tenant_id = operation_row.tenant_id
     and transition_row.id = operation_row.transition_id
     and transition_row.conversation_id = operation_row.conversation_id
     and transition_row.resulting_revision = operation_row.resulting_revision
   where operation_row.tenant_id = checked_tenant_id
     and operation_row.link_id = checked_link_id
     and operation_row.operation_kind = 'create_link';
  if create_count <> 1 or not create_matches then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_create_transition_invalid';
  end if;

  select count(*)::integer,
         coalesce(bool_and(
           transition_row.occurred_at = link_row.ended_at
           and transition_row.actor_kind = link_row.ended_actor_kind
           and transition_row.actor_employee_id is not distinct from link_row.ended_actor_employee_id
           and transition_row.actor_service_id is not distinct from link_row.ended_actor_service_id
           and transition_row.policy_id = link_row.ended_policy_id
           and transition_row.policy_version = link_row.ended_policy_version
           and transition_row.reason_code_id = link_row.ended_reason_code_id
           and transition_row.policy_family is not distinct from link_row.ended_policy_family
           and transition_row.policy_definition_contract_version is not distinct from link_row.ended_policy_definition_contract_version
           and transition_row.policy_definition_digest_sha256 is not distinct from link_row.ended_policy_definition_digest_sha256
           and transition_row.policy_activation_head_revision is not distinct from link_row.ended_policy_activation_head_revision
         ), false)
    into end_count, end_matches
    from public.inbox_v2_conversation_client_link_transition_operations operation_row
    join public.inbox_v2_conversation_client_link_transitions transition_row
      on transition_row.tenant_id = operation_row.tenant_id
     and transition_row.id = operation_row.transition_id
     and transition_row.conversation_id = operation_row.conversation_id
     and transition_row.resulting_revision = operation_row.resulting_revision
   where operation_row.tenant_id = checked_tenant_id
     and operation_row.link_id = checked_link_id
     and operation_row.operation_kind = 'end_link';
  if (link_row.state = 'active' and end_count <> 0)
     or (link_row.state = 'ended' and (end_count <> 1 or not end_matches)) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_end_transition_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_conversation_client_links other_row
     where other_row.tenant_id = link_row.tenant_id
       and other_row.conversation_id = link_row.conversation_id
       and other_row.client_id = link_row.client_id
       and other_row.id <> link_row.id
       and tstzrange(
         other_row.valid_from,
         coalesce(other_row.ended_at, 'infinity'::timestamptz),
         '[)'
       ) && tstzrange(
         link_row.valid_from,
         coalesce(link_row.ended_at, 'infinity'::timestamptz),
         '[)'
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_history_overlap';
  end if;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_claim_revocation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.revoked_at is not null
     and new.revoked_at is distinct from old.revoked_at
     and exists (
       select 1
         from public.inbox_v2_conversation_client_links link_row
        where link_row.tenant_id = new.tenant_id
          and link_row.provenance_kind = 'source_identity_claim'
          and link_row.provenance_claim_id = new.id
          and link_row.provenance_claim_version = new.claim_version
          and link_row.valid_from > new.revoked_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_claim_revocation_precedes_link';
  end if;
  if new.revoked_at is distinct from old.revoked_at then
    perform public.inbox_v2_assert_conversation_client_link_episode(
      evidence_row.tenant_id,
      evidence_row.link_id
    )
      from (
        select distinct candidate.tenant_id, candidate.link_id
          from public.inbox_v2_conversation_client_link_evidence_references candidate
         where candidate.tenant_id = new.tenant_id
           and candidate.evidence_kind = 'source_identity_claim'
           and candidate.source_identity_claim_id = new.id
      ) evidence_row;
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_client_link_transition(
  checked_tenant_id text,
  checked_conversation_id text,
  checked_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_row public.inbox_v2_conversation_client_link_transitions%rowtype;
  predecessor_primary text;
  predecessor_time timestamptz;
  operation_count integer;
  invalid_operation_count integer;
  primary_create_revision bigint;
  primary_end_revision bigint;
  primary_confidence public.inbox_v2_conversation_client_link_confidence;
  primary_provenance public.inbox_v2_conversation_client_link_provenance_kind;
  primary_legacy_count integer;
begin
  select * into transition_row
    from public.inbox_v2_conversation_client_link_transitions candidate
   where candidate.tenant_id = checked_tenant_id
     and candidate.conversation_id = checked_conversation_id
     and candidate.resulting_revision = checked_revision;
  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_transition_missing';
  end if;

  if checked_revision = 1 then
    if transition_row.current_revision is not null
       or transition_row.previous_primary_link_id is not null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_transition_predecessor_invalid';
    end if;
  else
    select predecessor.resulting_primary_link_id, predecessor.occurred_at
      into predecessor_primary, predecessor_time
      from public.inbox_v2_conversation_client_link_transitions predecessor
     where predecessor.tenant_id = checked_tenant_id
       and predecessor.conversation_id = checked_conversation_id
       and predecessor.resulting_revision = checked_revision - 1;
    if not found
       or transition_row.current_revision <> checked_revision - 1
       or transition_row.previous_primary_link_id is distinct from predecessor_primary
       or transition_row.occurred_at < predecessor_time then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_transition_predecessor_invalid';
    end if;
  end if;

  select count(*)::integer,
         count(*) filter (where (
           (operation_row.operation_kind = 'create_link' and (
             link_row.valid_from <> transition_row.occurred_at
             or link_row.linked_actor_kind <> transition_row.actor_kind
             or link_row.linked_actor_employee_id is distinct from transition_row.actor_employee_id
             or link_row.linked_actor_service_id is distinct from transition_row.actor_service_id
             or link_row.linked_policy_id <> transition_row.policy_id
             or link_row.linked_policy_version <> transition_row.policy_version
             or link_row.linked_reason_code_id <> transition_row.reason_code_id
             or link_row.linked_policy_family is distinct from transition_row.policy_family
             or link_row.linked_policy_definition_contract_version is distinct from transition_row.policy_definition_contract_version
             or link_row.linked_policy_definition_digest_sha256 is distinct from transition_row.policy_definition_digest_sha256
             or link_row.linked_policy_activation_head_revision is distinct from transition_row.policy_activation_head_revision
           ))
           or (operation_row.operation_kind = 'end_link' and (
             link_row.ended_at is distinct from transition_row.occurred_at
             or link_row.ended_actor_kind is distinct from transition_row.actor_kind
             or link_row.ended_actor_employee_id is distinct from transition_row.actor_employee_id
             or link_row.ended_actor_service_id is distinct from transition_row.actor_service_id
             or link_row.ended_policy_id is distinct from transition_row.policy_id
             or link_row.ended_policy_version is distinct from transition_row.policy_version
             or link_row.ended_reason_code_id is distinct from transition_row.reason_code_id
             or link_row.ended_policy_family is distinct from transition_row.policy_family
             or link_row.ended_policy_definition_contract_version is distinct from transition_row.policy_definition_contract_version
             or link_row.ended_policy_definition_digest_sha256 is distinct from transition_row.policy_definition_digest_sha256
             or link_row.ended_policy_activation_head_revision is distinct from transition_row.policy_activation_head_revision
           ))
         ))::integer
    into operation_count, invalid_operation_count
    from public.inbox_v2_conversation_client_link_transition_operations operation_row
    join public.inbox_v2_conversation_client_links link_row
      on link_row.tenant_id = operation_row.tenant_id
     and link_row.id = operation_row.link_id
     and link_row.conversation_id = operation_row.conversation_id
   where operation_row.tenant_id = checked_tenant_id
     and operation_row.transition_id = transition_row.id;
  if operation_count > 100
     or invalid_operation_count <> 0
     or (
       operation_count = 0
       and transition_row.previous_primary_link_id is not distinct from
         transition_row.resulting_primary_link_id
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_transition_operations_invalid';
  end if;

  if transition_row.resulting_primary_link_id is not null then
    select link_row.association_confidence,
           link_row.provenance_kind,
           count(role_row.role_id) filter (
             where role_row.role_id = 'core:legacy-unspecified'
           )::integer,
           min(operation_row.resulting_revision) filter (
             where operation_row.operation_kind = 'create_link'
           ),
           min(operation_row.resulting_revision) filter (
             where operation_row.operation_kind = 'end_link'
           )
      into primary_confidence,
           primary_provenance,
           primary_legacy_count,
           primary_create_revision,
           primary_end_revision
      from public.inbox_v2_conversation_client_links link_row
      left join public.inbox_v2_conversation_client_link_roles role_row
        on role_row.tenant_id = link_row.tenant_id
       and role_row.link_id = link_row.id
      left join public.inbox_v2_conversation_client_link_transition_operations operation_row
        on operation_row.tenant_id = link_row.tenant_id
       and operation_row.link_id = link_row.id
     where link_row.tenant_id = checked_tenant_id
       and link_row.id = transition_row.resulting_primary_link_id
       and link_row.conversation_id = checked_conversation_id
     group by link_row.association_confidence, link_row.provenance_kind;
    if not found
       or primary_confidence <> 'confirmed'
       or primary_provenance = 'migration'
       or primary_legacy_count <> 0
       or primary_create_revision is null
       or primary_create_revision > checked_revision
       or (primary_end_revision is not null and primary_end_revision <= checked_revision) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_primary_invalid';
    end if;
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_client_link_head(
  checked_tenant_id text,
  checked_conversation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_revision bigint;
  head_primary text;
  head_updated_at timestamptz;
  latest_revision bigint;
  latest_primary text;
  latest_occurred_at timestamptz;
begin
  select head_row.revision, head_row.primary_link_id, head_row.updated_at
    into head_revision, head_primary, head_updated_at
    from public.inbox_v2_conversation_client_link_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id;
  if not found then
    if exists (
      select 1
        from public.inbox_v2_conversation_client_link_transitions transition_row
       where transition_row.tenant_id = checked_tenant_id
         and transition_row.conversation_id = checked_conversation_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_client_link_head_missing';
    end if;
    return;
  end if;

  select transition_row.resulting_revision,
         transition_row.resulting_primary_link_id,
         transition_row.occurred_at
    into latest_revision, latest_primary, latest_occurred_at
    from public.inbox_v2_conversation_client_link_transitions transition_row
   where transition_row.tenant_id = checked_tenant_id
     and transition_row.conversation_id = checked_conversation_id
   order by transition_row.resulting_revision desc
   limit 1;
  if not found
     or head_revision <> latest_revision
     or head_primary is distinct from latest_primary
     or head_updated_at <> latest_occurred_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_head_projection_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_head(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.conversation_id, old.conversation_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_transition(
    new.tenant_id,
    new.conversation_id,
    new.resulting_revision
  );
  perform public.inbox_v2_assert_conversation_client_link_head(
    new.tenant_id,
    new.conversation_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_episode()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_episode(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_role()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_episode(
    new.tenant_id,
    new.link_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_guard_evidence_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_conversation_client_links link_row
   where link_row.tenant_id = new.tenant_id
     and link_row.id = new.link_id
     and link_row.conversation_id = new.conversation_id
   for update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.conversation_client_link_evidence_link_missing';
  end if;
  if exists (
    select 1
      from public.inbox_v2_conversation_client_link_transition_operations operation_row
     where operation_row.tenant_id = new.tenant_id
       and operation_row.link_id = new.link_id
       and operation_row.operation_kind = 'create_link'
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_client_link_evidence_closed';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_evidence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_episode(
    new.tenant_id,
    new.link_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_contact()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.client_id is distinct from old.client_id then
    perform public.inbox_v2_assert_conversation_client_link_episode(
      affected_row.tenant_id,
      affected_row.link_id
    )
      from (
        select distinct evidence_row.tenant_id, evidence_row.link_id
          from public.inbox_v2_conversation_client_link_evidence_references evidence_row
         where evidence_row.tenant_id = new.tenant_id
           and (
             evidence_row.client_contact_id = new.id
             or evidence_row.source_identity_claim_id in (
               select claim_row.id
                 from public.inbox_v2_source_identity_claims claim_row
                where claim_row.tenant_id = new.tenant_id
                  and claim_row.target_client_contact_id = new.id
             )
           )
        union
        select link_row.tenant_id, link_row.id
          from public.inbox_v2_conversation_client_links link_row
         where link_row.tenant_id = new.tenant_id
           and link_row.provenance_claim_target_client_contact_id = new.id
      ) affected_row;
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_client_link_deferred_operation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_client_link_transition(
    new.tenant_id,
    new.conversation_id,
    new.resulting_revision
  );
  perform public.inbox_v2_assert_conversation_client_link_episode(
    new.tenant_id,
    new.link_id
  );
  return null;
end;
$function$;

create trigger inbox_v2_conversation_client_links_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_links
for each row execute function public.inbox_v2_conversation_client_link_guard_episode_insert();

create trigger inbox_v2_conversation_client_links_update_guard_trigger
before update on public.inbox_v2_conversation_client_links
for each row execute function public.inbox_v2_conversation_client_link_guard_episode_update();

create trigger inbox_v2_conversation_client_links_delete_immutable_trigger
before delete on public.inbox_v2_conversation_client_links
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create trigger inbox_v2_conversation_client_link_heads_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_link_heads
for each row execute function public.inbox_v2_conversation_client_link_guard_head_insert();

create trigger inbox_v2_conversation_client_link_heads_update_guard_trigger
before update on public.inbox_v2_conversation_client_link_heads
for each row execute function public.inbox_v2_conversation_client_link_guard_head_update();

create trigger inbox_v2_conversation_client_link_heads_delete_immutable_trigger
before delete on public.inbox_v2_conversation_client_link_heads
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create trigger inbox_v2_conversation_client_link_transitions_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_link_transitions
for each row execute function public.inbox_v2_conversation_client_link_guard_transition_insert();

create trigger inbox_v2_conversation_client_link_transitions_immutable_trigger
before update or delete on public.inbox_v2_conversation_client_link_transitions
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create trigger inbox_v2_conversation_client_link_roles_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_link_roles
for each row execute function public.inbox_v2_conversation_client_link_guard_role_insert();

create trigger inbox_v2_conversation_client_link_roles_immutable_trigger
before update or delete on public.inbox_v2_conversation_client_link_roles
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create trigger inbox_v2_conversation_client_link_evidence_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_link_evidence_references
for each row execute function public.inbox_v2_conversation_client_link_guard_evidence_insert();

create trigger inbox_v2_conversation_client_link_evidence_immutable_trigger
before update or delete on public.inbox_v2_conversation_client_link_evidence_references
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create trigger inbox_v2_conversation_client_link_operations_insert_guard_trigger
before insert on public.inbox_v2_conversation_client_link_transition_operations
for each row execute function public.inbox_v2_conversation_client_link_guard_operation_insert();

create trigger inbox_v2_conversation_client_link_operations_immutable_trigger
before update or delete on public.inbox_v2_conversation_client_link_transition_operations
for each row execute function public.inbox_v2_conversation_client_link_reject_immutable();

create constraint trigger inbox_v2_conversation_client_link_heads_constraint_trigger
after insert or update on public.inbox_v2_conversation_client_link_heads
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_head();

create constraint trigger inbox_v2_conversation_client_link_transitions_constraint_trigger
after insert on public.inbox_v2_conversation_client_link_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_transition();

create constraint trigger inbox_v2_conversation_client_links_constraint_trigger
after insert or update on public.inbox_v2_conversation_client_links
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_episode();

create constraint trigger inbox_v2_conversation_client_link_claim_revocation_constraint_trigger
after update on public.inbox_v2_source_identity_claims
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_claim_revocation();

create constraint trigger inbox_v2_conversation_client_link_roles_constraint_trigger
after insert on public.inbox_v2_conversation_client_link_roles
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_role();

create constraint trigger inbox_v2_conversation_client_link_evidence_constraint_trigger
after insert on public.inbox_v2_conversation_client_link_evidence_references
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_evidence();

create constraint trigger inbox_v2_conversation_client_link_contact_constraint_trigger
after update on public.client_contacts
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_contact();

create constraint trigger inbox_v2_conversation_client_link_operations_constraint_trigger
after insert on public.inbox_v2_conversation_client_link_transition_operations
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_client_link_deferred_operation();
`;
