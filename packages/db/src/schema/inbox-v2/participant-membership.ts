import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import {
  clientContacts,
  employees,
  inboxV2Conversations,
  tenants
} from "../tables";
import { inboxV2SourceExternalIdentities } from "./identity-foundation";
import {
  inboxV2ProviderRosterEvidence,
  inboxV2ProviderRosterMemberEvidence
} from "./provider-roster-evidence";
import { inboxV2SourceThreadBindings } from "./source-thread-binding";

export const inboxV2ParticipantSubjectKind = pgEnum(
  "inbox_v2_participant_subject_kind",
  [
    "employee",
    "source_external_identity",
    "client_contact",
    "bot",
    "system",
    "legacy_unknown"
  ]
);

export const inboxV2ParticipantMembershipOriginKind = pgEnum(
  "inbox_v2_participant_membership_origin_kind",
  ["hulee_internal_command", "provider_roster", "migration", "system_policy"]
);

export const inboxV2ParticipantMembershipState = pgEnum(
  "inbox_v2_participant_membership_state",
  ["pending", "active", "left", "removed"]
);

export const inboxV2ParticipantMembershipRole = pgEnum(
  "inbox_v2_participant_membership_role",
  ["owner", "admin", "member", "guest", "observer", "unknown"]
);

export const inboxV2ParticipantMembershipEvidence = pgEnum(
  "inbox_v2_participant_membership_evidence",
  ["confirmed", "advisory", "imported"]
);

export const inboxV2ParticipantMembershipTransitionIntent = pgEnum(
  "inbox_v2_participant_membership_transition_intent",
  [
    "initial_pending",
    "initial_active",
    "activate",
    "change_role",
    "leave",
    "remove"
  ]
);

export const inboxV2ProviderMembershipEvidenceKind = pgEnum(
  "inbox_v2_provider_membership_evidence_kind",
  ["member", "roster_omission"]
);

/**
 * Minimal tenant-owned registration authority for Hulee bot participant IDs.
 * Provider bots remain SourceExternalIdentity subjects; this table is only for
 * bots that can be selected by trusted Hulee application code.
 */
export const inboxV2BotIdentities = pgTable(
  "inbox_v2_bot_identities",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    registeredByTrustedServiceId: text(
      "registered_by_trusted_service_id"
    ).notNull(),
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
      name: "inbox_v2_bot_identities_pk",
      columns: [table.tenantId, table.id]
    }),
    check(
      "inbox_v2_bot_identities_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^bot_identity:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_bot_identities_service_id_check",
      catalogIdCheck(table.registeredByTrustedServiceId)
    ),
    check(
      "inbox_v2_bot_identities_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "inbox_v2_bot_identities_timestamps_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_bot_identities_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
      table.id
    )
  ]
);

/** Immutable conversation-local authorship/persona anchor. */
export const inboxV2ConversationParticipants = pgTable(
  "inbox_v2_conversation_participants",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    subjectKind: inboxV2ParticipantSubjectKind("subject_kind").notNull(),
    subjectEmployeeId: text("subject_employee_id"),
    subjectSourceExternalIdentityId: text(
      "subject_source_external_identity_id"
    ),
    subjectClientContactId: text("subject_client_contact_id"),
    subjectBotIdentityId: text("subject_bot_identity_id"),
    subjectSystemActorId: text("subject_system_actor_id"),
    subjectLegacyProvenanceId: text("subject_legacy_provenance_id"),
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
      name: "inbox_v2_conversation_participants_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_conversation_participants_exact_edge_unique").on(
      table.tenantId,
      table.id,
      table.conversationId
    ),
    foreignKey({
      name: "inbox_v2_conversation_participants_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_participants_employee_fk",
      columns: [table.tenantId, table.subjectEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_participants_source_identity_fk",
      columns: [table.tenantId, table.subjectSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_conversation_participants_client_contact_fk",
      columns: [table.tenantId, table.subjectClientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_participants_bot_fk",
      columns: [table.tenantId, table.subjectBotIdentityId],
      foreignColumns: [inboxV2BotIdentities.tenantId, inboxV2BotIdentities.id]
    }),
    check(
      "inbox_v2_conversation_participants_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^conversation_participant:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_conversation_participants_subject_xor_check",
      sql`num_nonnulls(
          ${table.subjectEmployeeId},
          ${table.subjectSourceExternalIdentityId},
          ${table.subjectClientContactId},
          ${table.subjectBotIdentityId},
          ${table.subjectSystemActorId},
          ${table.subjectLegacyProvenanceId}
        ) = 1 and (
          (${table.subjectKind} = 'employee'
            and ${table.subjectEmployeeId} is not null) or
          (${table.subjectKind} = 'source_external_identity'
            and ${table.subjectSourceExternalIdentityId} is not null) or
          (${table.subjectKind} = 'client_contact'
            and ${table.subjectClientContactId} is not null) or
          (${table.subjectKind} = 'bot'
            and ${table.subjectBotIdentityId} is not null) or
          (${table.subjectKind} = 'system'
            and ${table.subjectSystemActorId} is not null) or
          (${table.subjectKind} = 'legacy_unknown'
            and ${table.subjectLegacyProvenanceId} is not null)
        )`
    ),
    check(
      "inbox_v2_conversation_participants_system_actor_id_check",
      sql`${table.subjectSystemActorId} is null or ${catalogIdCheck(
        table.subjectSystemActorId
      )}`
    ),
    check(
      "inbox_v2_conversation_participants_legacy_provenance_id_check",
      sql`${table.subjectLegacyProvenanceId} is null or ${catalogIdCheck(
        table.subjectLegacyProvenanceId
      )}`
    ),
    check(
      "inbox_v2_conversation_participants_revision_check",
      sql`${table.revision} >= 1`
    ),
    check(
      "inbox_v2_conversation_participants_timestamps_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    uniqueIndex("inbox_v2_conversation_participants_employee_unique")
      .on(table.tenantId, table.conversationId, table.subjectEmployeeId)
      .where(
        sql`${table.subjectKind} = 'employee'
          and ${table.subjectEmployeeId} is not null`
      ),
    uniqueIndex("inbox_v2_conversation_participants_source_identity_unique")
      .on(
        table.tenantId,
        table.conversationId,
        table.subjectSourceExternalIdentityId
      )
      .where(
        sql`${table.subjectKind} = 'source_external_identity'
          and ${table.subjectSourceExternalIdentityId} is not null`
      ),
    uniqueIndex("inbox_v2_conversation_participants_client_contact_unique")
      .on(table.tenantId, table.conversationId, table.subjectClientContactId)
      .where(
        sql`${table.subjectKind} = 'client_contact'
          and ${table.subjectClientContactId} is not null`
      ),
    uniqueIndex("inbox_v2_conversation_participants_bot_unique")
      .on(table.tenantId, table.conversationId, table.subjectBotIdentityId)
      .where(
        sql`${table.subjectKind} = 'bot'
          and ${table.subjectBotIdentityId} is not null`
      ),
    uniqueIndex("inbox_v2_conversation_participants_system_unique")
      .on(table.tenantId, table.conversationId, table.subjectSystemActorId)
      .where(
        sql`${table.subjectKind} = 'system'
          and ${table.subjectSystemActorId} is not null`
      ),
    uniqueIndex("inbox_v2_conversation_participants_legacy_unique")
      .on(table.tenantId, table.conversationId, table.subjectLegacyProvenanceId)
      .where(
        sql`${table.subjectKind} = 'legacy_unknown'
          and ${table.subjectLegacyProvenanceId} is not null`
      ),
    index("inbox_v2_conversation_participants_tenant_employee_idx")
      .on(
        table.tenantId,
        table.subjectEmployeeId,
        table.conversationId,
        table.id
      )
      .where(sql`${table.subjectEmployeeId} is not null`),
    index("inbox_v2_conversation_participants_tenant_source_identity_idx")
      .on(
        table.tenantId,
        table.subjectSourceExternalIdentityId,
        table.conversationId,
        table.id
      )
      .where(sql`${table.subjectSourceExternalIdentityId} is not null`),
    index("inbox_v2_conversation_participants_tenant_client_contact_idx")
      .on(
        table.tenantId,
        table.subjectClientContactId,
        table.conversationId,
        table.id
      )
      .where(sql`${table.subjectClientContactId} is not null`),
    index("inbox_v2_conversation_participants_tenant_created_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
      table.id
    )
  ]
);

/**
 * Conversation-local membership-set clock. It intentionally remains separate
 * from the timeline/activity ConversationHead clock.
 */
export const inboxV2ConversationMembershipHeads = pgTable(
  "inbox_v2_conversation_membership_heads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: text("conversation_id").notNull(),
    membershipRevision: bigint("membership_revision", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
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
      name: "inbox_v2_conversation_membership_heads_pk",
      columns: [table.tenantId, table.conversationId]
    }),
    foreignKey({
      name: "inbox_v2_conversation_membership_heads_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    check(
      "inbox_v2_conversation_membership_heads_revision_check",
      sql`${table.membershipRevision} >= 0`
    ),
    check(
      "inbox_v2_conversation_membership_heads_timestamps_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_conversation_membership_heads_tenant_updated_idx").on(
      table.tenantId,
      table.updatedAt,
      table.conversationId
    )
  ]
);

/** One immutable aggregate membership-set commit; several episode transitions may share it. */
export const inboxV2ConversationMembershipCommits = pgTable(
  "inbox_v2_conversation_membership_commits",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    conversationId: text("conversation_id").notNull(),
    expectedMembershipRevision: bigint("expected_membership_revision", {
      mode: "bigint"
    }).notNull(),
    predecessorMembershipRevision: bigint("predecessor_membership_revision", {
      mode: "bigint"
    }).generatedAlwaysAs(sql`nullif(expected_membership_revision, 0)`),
    resultingMembershipRevision: bigint("resulting_membership_revision", {
      mode: "bigint"
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_conversation_membership_commits_pk",
      columns: [
        table.tenantId,
        table.conversationId,
        table.resultingMembershipRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_conversation_membership_commits_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_conversation_membership_commits_predecessor_fk",
      columns: [
        table.tenantId,
        table.conversationId,
        table.predecessorMembershipRevision
      ],
      foreignColumns: [
        table.tenantId,
        table.conversationId,
        table.resultingMembershipRevision
      ]
    }),
    check(
      "inbox_v2_conversation_membership_commits_revision_check",
      sql`${table.expectedMembershipRevision} >= 0
        and ${table.resultingMembershipRevision} =
          ${table.expectedMembershipRevision} + 1`
    ),
    check(
      "inbox_v2_conversation_membership_commits_timestamp_check",
      sql`isfinite(${table.occurredAt})`
    ),
    index("inbox_v2_conversation_membership_commits_tenant_occurred_idx").on(
      table.tenantId,
      table.conversationId,
      table.occurredAt,
      table.resultingMembershipRevision
    )
  ]
);

/** Current projection for one membership episode. */
export const inboxV2ParticipantMembershipEpisodes = pgTable(
  "inbox_v2_participant_membership_episodes",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    participantId: text("participant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    originKind: inboxV2ParticipantMembershipOriginKind("origin_kind").notNull(),
    originProviderRosterMemberEvidenceId: text(
      "origin_provider_roster_member_evidence_id"
    ),
    originProviderRosterEvidenceId: text("origin_provider_roster_evidence_id"),
    originSourceThreadBindingId: text("origin_source_thread_binding_id"),
    originSourceExternalIdentityId: text("origin_source_external_identity_id"),
    originOrderingKind: text("origin_ordering_kind"),
    originOrderingScopeToken: text("origin_ordering_scope_token"),
    originOrderingComparatorId: text("origin_ordering_comparator_id"),
    originOrderingComparatorRevision: bigint(
      "origin_ordering_comparator_revision",
      { mode: "bigint" }
    ),
    originOrderingPosition: bigint("origin_ordering_position", {
      mode: "bigint"
    }),
    providerOrderingHeadPosition: bigint("provider_ordering_head_position", {
      mode: "bigint"
    }),
    originMigrationProvenanceId: text("origin_migration_provenance_id"),
    originSystemPolicyId: text("origin_system_policy_id"),
    originScopeKey: text("origin_scope_key")
      .notNull()
      .generatedAlwaysAs(
        sql`case origin_kind
          when 'hulee_internal_command' then 'hulee_internal_command'
          when 'provider_roster' then
            'provider_roster|' ||
            octet_length(origin_source_thread_binding_id)::text || ':' ||
            origin_source_thread_binding_id
          when 'migration' then
            'migration|' || octet_length(origin_migration_provenance_id)::text ||
            ':' || origin_migration_provenance_id
          when 'system_policy' then
            'system_policy|' || octet_length(origin_system_policy_id)::text ||
            ':' || origin_system_policy_id
          else null
        end`
      ),
    state: inboxV2ParticipantMembershipState("state").notNull(),
    role: inboxV2ParticipantMembershipRole("role").notNull(),
    evidenceClassification: inboxV2ParticipantMembershipEvidence(
      "evidence_classification"
    ).notNull(),
    validFrom: timestamp("valid_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    validTo: timestamp("valid_to", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_participant_membership_episodes_pk",
      columns: [table.tenantId, table.id]
    }),
    unique("inbox_v2_participant_membership_episodes_exact_edge_unique").on(
      table.tenantId,
      table.id,
      table.participantId,
      table.conversationId,
      table.originKind
    ),
    foreignKey({
      name: "inbox_v2_participant_membership_episodes_participant_fk",
      columns: [table.tenantId, table.participantId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_episodes_provider_binding_fk",
      columns: [table.tenantId, table.originSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_episodes_provider_identity_fk",
      columns: [table.tenantId, table.originSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_episodes_provider_roster_fk",
      columns: [
        table.tenantId,
        table.originProviderRosterEvidenceId,
        table.originSourceThreadBindingId
      ],
      foreignColumns: [
        inboxV2ProviderRosterEvidence.tenantId,
        inboxV2ProviderRosterEvidence.id,
        inboxV2ProviderRosterEvidence.sourceThreadBindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_episodes_provider_member_fk",
      columns: [
        table.tenantId,
        table.originProviderRosterMemberEvidenceId,
        table.originProviderRosterEvidenceId,
        table.originSourceThreadBindingId,
        table.originSourceExternalIdentityId
      ],
      foreignColumns: [
        inboxV2ProviderRosterMemberEvidence.tenantId,
        inboxV2ProviderRosterMemberEvidence.id,
        inboxV2ProviderRosterMemberEvidence.rosterEvidenceId,
        inboxV2ProviderRosterMemberEvidence.sourceThreadBindingId,
        inboxV2ProviderRosterMemberEvidence.sourceExternalIdentityId
      ]
    }),
    check(
      "inbox_v2_participant_membership_episodes_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^participant_membership_episode:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_participant_membership_episodes_origin_xor_check",
      sql`(
          ${table.originKind} = 'hulee_internal_command'
          and ${table.originProviderRosterMemberEvidenceId} is null
          and ${table.originProviderRosterEvidenceId} is null
          and ${table.originSourceThreadBindingId} is null
          and ${table.originSourceExternalIdentityId} is null
          and ${table.originOrderingKind} is null
          and ${table.originOrderingScopeToken} is null
          and ${table.originOrderingComparatorId} is null
          and ${table.originOrderingComparatorRevision} is null
          and ${table.originOrderingPosition} is null
          and ${table.providerOrderingHeadPosition} is null
          and ${table.originMigrationProvenanceId} is null
          and ${table.originSystemPolicyId} is null
        ) or (
          ${table.originKind} = 'provider_roster'
          and ${table.originProviderRosterMemberEvidenceId} is not null
          and ${table.originProviderRosterEvidenceId} is not null
          and ${table.originSourceThreadBindingId} is not null
          and ${table.originSourceExternalIdentityId} is not null
          and ${table.originOrderingKind} is not null
          and ${table.originOrderingScopeToken} is not null
          and ${table.originOrderingComparatorId} is not null
          and ${table.originOrderingComparatorRevision} is not null
          and ${table.originOrderingPosition} is not null
          and ${table.providerOrderingHeadPosition} is not null
          and ${table.originMigrationProvenanceId} is null
          and ${table.originSystemPolicyId} is null
        ) or (
          ${table.originKind} = 'migration'
          and ${table.originProviderRosterMemberEvidenceId} is null
          and ${table.originProviderRosterEvidenceId} is null
          and ${table.originSourceThreadBindingId} is null
          and ${table.originSourceExternalIdentityId} is null
          and ${table.originOrderingKind} is null
          and ${table.originOrderingScopeToken} is null
          and ${table.originOrderingComparatorId} is null
          and ${table.originOrderingComparatorRevision} is null
          and ${table.originOrderingPosition} is null
          and ${table.providerOrderingHeadPosition} is null
          and ${table.originMigrationProvenanceId} is not null
          and ${table.originSystemPolicyId} is null
        ) or (
          ${table.originKind} = 'system_policy'
          and ${table.originProviderRosterMemberEvidenceId} is null
          and ${table.originProviderRosterEvidenceId} is null
          and ${table.originSourceThreadBindingId} is null
          and ${table.originSourceExternalIdentityId} is null
          and ${table.originOrderingKind} is null
          and ${table.originOrderingScopeToken} is null
          and ${table.originOrderingComparatorId} is null
          and ${table.originOrderingComparatorRevision} is null
          and ${table.originOrderingPosition} is null
          and ${table.providerOrderingHeadPosition} is null
          and ${table.originMigrationProvenanceId} is null
          and ${table.originSystemPolicyId} is not null
        )`
    ),
    check(
      "inbox_v2_participant_membership_episodes_origin_catalog_check",
      sql`(${table.originMigrationProvenanceId} is null or ${catalogIdCheck(
        table.originMigrationProvenanceId
      )}) and
        (${table.originSystemPolicyId} is null or ${catalogIdCheck(
          table.originSystemPolicyId
        )}) and
        (${table.originOrderingComparatorId} is null or ${catalogIdCheck(
          table.originOrderingComparatorId
        )})`
    ),
    check(
      "inbox_v2_participant_membership_episodes_evidence_check",
      sql`(
          ${table.originKind} = 'migration'
          and ${table.evidenceClassification} = 'imported'
        ) or (
          ${table.originKind} = 'provider_roster'
          and ${table.evidenceClassification} = 'confirmed'
        ) or (
          ${table.originKind} in ('hulee_internal_command', 'system_policy')
          and ${table.evidenceClassification} = 'confirmed'
        )`
    ),
    check(
      "inbox_v2_participant_membership_episodes_provider_ordering_check",
      sql`${table.originKind} <> 'provider_roster' or (
        ${table.originOrderingKind} = 'adapter_monotonic'
        and char_length(${table.originOrderingScopeToken}) between 8 and 256
        and ${table.originOrderingScopeToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${table.originOrderingComparatorRevision} >= 1
        and ${table.originOrderingPosition} >= 1
        and ${table.providerOrderingHeadPosition} >= ${table.originOrderingPosition}
      )`
    ),
    check(
      "inbox_v2_participant_membership_episodes_internal_role_check",
      sql`${table.originKind} <> 'hulee_internal_command'
        or ${table.role} in ('owner', 'admin', 'member', 'observer')`
    ),
    check(
      "inbox_v2_participant_membership_episodes_state_interval_check",
      sql`isfinite(${table.validFrom}) and (
        (
          ${table.state} in ('pending', 'active')
          and ${table.validTo} is null
        ) or (
          ${table.state} in ('left', 'removed')
          and ${table.validTo} is not null
          and isfinite(${table.validTo})
          and ${table.validTo} >= ${table.validFrom}
        )
      )`
    ),
    check(
      "inbox_v2_participant_membership_episodes_revision_check",
      sql`${table.revision} >= 1`
    ),
    uniqueIndex(
      "inbox_v2_participant_membership_episodes_current_origin_unique"
    )
      .on(table.tenantId, table.participantId, table.originScopeKey)
      .where(sql`${table.state} in ('pending', 'active')`),
    index("inbox_v2_participant_membership_episodes_tenant_current_idx")
      .on(
        table.tenantId,
        table.conversationId,
        table.state,
        table.role,
        table.participantId,
        table.id
      )
      .where(sql`${table.state} in ('pending', 'active')`),
    index("inbox_v2_participant_membership_episodes_tenant_history_idx").on(
      table.tenantId,
      table.participantId,
      table.validFrom,
      table.id
    ),
    index(
      "inbox_v2_participant_membership_episodes_tenant_origin_history_idx"
    ).on(
      table.tenantId,
      table.participantId,
      table.originScopeKey,
      table.validFrom,
      table.id
    )
  ]
);

/** Append-only audit fact for one episode projection change. */
export const inboxV2ParticipantMembershipTransitions = pgTable(
  "inbox_v2_participant_membership_transitions",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    id: text("id").notNull(),
    episodeId: text("episode_id").notNull(),
    participantId: text("participant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    membershipRevision: bigint("membership_revision", {
      mode: "bigint"
    }).notNull(),
    intent: inboxV2ParticipantMembershipTransitionIntent("intent").notNull(),
    fromState: inboxV2ParticipantMembershipState("from_state"),
    toState: inboxV2ParticipantMembershipState("to_state").notNull(),
    fromRole: inboxV2ParticipantMembershipRole("from_role"),
    toRole: inboxV2ParticipantMembershipRole("to_role").notNull(),
    causeKind: inboxV2ParticipantMembershipOriginKind("cause_kind").notNull(),
    causeProviderEvidenceKind: inboxV2ProviderMembershipEvidenceKind(
      "cause_provider_evidence_kind"
    ),
    causeProviderRosterMemberEvidenceId: text(
      "cause_provider_roster_member_evidence_id"
    ),
    causeProviderRosterEvidenceId: text("cause_provider_roster_evidence_id"),
    causeSourceThreadBindingId: text("cause_source_thread_binding_id"),
    causeSourceExternalIdentityId: text("cause_source_external_identity_id"),
    causeOrderingKind: text("cause_ordering_kind"),
    causeOrderingScopeToken: text("cause_ordering_scope_token"),
    causeOrderingComparatorId: text("cause_ordering_comparator_id"),
    causeOrderingComparatorRevision: bigint(
      "cause_ordering_comparator_revision",
      { mode: "bigint" }
    ),
    causeOrderingPosition: bigint("cause_ordering_position", {
      mode: "bigint"
    }),
    causeActorEmployeeId: text("cause_actor_employee_id"),
    causeTrustedServiceId: text("cause_trusted_service_id"),
    causeMigrationProvenanceId: text("cause_migration_provenance_id"),
    causeSystemPolicyId: text("cause_system_policy_id"),
    reasonCodeId: text("reason_code_id").notNull(),
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
      name: "inbox_v2_participant_membership_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    unique(
      "inbox_v2_participant_membership_transitions_episode_revision_unique"
    ).on(table.tenantId, table.episodeId, table.resultingRevision),
    unique(
      "inbox_v2_participant_membership_transitions_predecessor_target_unique"
    ).on(
      table.tenantId,
      table.episodeId,
      table.resultingRevision,
      table.toState,
      table.toRole
    ),
    foreignKey({
      name: "inbox_v2_participant_membership_transitions_episode_fk",
      columns: [
        table.tenantId,
        table.episodeId,
        table.participantId,
        table.conversationId,
        table.causeKind
      ],
      foreignColumns: [
        inboxV2ParticipantMembershipEpisodes.tenantId,
        inboxV2ParticipantMembershipEpisodes.id,
        inboxV2ParticipantMembershipEpisodes.participantId,
        inboxV2ParticipantMembershipEpisodes.conversationId,
        inboxV2ParticipantMembershipEpisodes.originKind
      ]
    }),
    foreignKey({
      name: "inbox_v2_participant_membership_transitions_commit_fk",
      columns: [table.tenantId, table.conversationId, table.membershipRevision],
      foreignColumns: [
        inboxV2ConversationMembershipCommits.tenantId,
        inboxV2ConversationMembershipCommits.conversationId,
        inboxV2ConversationMembershipCommits.resultingMembershipRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_participant_membership_transitions_actor_fk",
      columns: [table.tenantId, table.causeActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_membership_transitions_provider_binding_fk",
      columns: [table.tenantId, table.causeSourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_transitions_provider_identity_fk",
      columns: [table.tenantId, table.causeSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_transitions_provider_roster_fk",
      columns: [
        table.tenantId,
        table.causeProviderRosterEvidenceId,
        table.causeSourceThreadBindingId
      ],
      foreignColumns: [
        inboxV2ProviderRosterEvidence.tenantId,
        inboxV2ProviderRosterEvidence.id,
        inboxV2ProviderRosterEvidence.sourceThreadBindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_membership_transitions_provider_member_fk",
      columns: [
        table.tenantId,
        table.causeProviderRosterMemberEvidenceId,
        table.causeProviderRosterEvidenceId,
        table.causeSourceThreadBindingId,
        table.causeSourceExternalIdentityId
      ],
      foreignColumns: [
        inboxV2ProviderRosterMemberEvidence.tenantId,
        inboxV2ProviderRosterMemberEvidence.id,
        inboxV2ProviderRosterMemberEvidence.rosterEvidenceId,
        inboxV2ProviderRosterMemberEvidence.sourceThreadBindingId,
        inboxV2ProviderRosterMemberEvidence.sourceExternalIdentityId
      ]
    }),
    foreignKey({
      name: "inbox_v2_participant_membership_transitions_predecessor_fk",
      columns: [
        table.tenantId,
        table.episodeId,
        table.currentRevision,
        table.fromState,
        table.fromRole
      ],
      foreignColumns: [
        table.tenantId,
        table.episodeId,
        table.resultingRevision,
        table.toState,
        table.toRole
      ]
    }),
    check(
      "inbox_v2_participant_membership_transitions_id_format_check",
      sql`char_length(${table.id}) <= 256
        and ${table.id} ~ '^participant_membership_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    ),
    check(
      "inbox_v2_participant_membership_transitions_cause_xor_check",
      sql`(
          ${table.causeKind} = 'hulee_internal_command'
          and ${table.causeProviderEvidenceKind} is null
          and ${table.causeProviderRosterMemberEvidenceId} is null
          and ${table.causeProviderRosterEvidenceId} is null
          and ${table.causeSourceThreadBindingId} is null
          and ${table.causeSourceExternalIdentityId} is null
          and ${table.causeOrderingKind} is null
          and ${table.causeOrderingScopeToken} is null
          and ${table.causeOrderingComparatorId} is null
          and ${table.causeOrderingComparatorRevision} is null
          and ${table.causeOrderingPosition} is null
          and ${table.causeActorEmployeeId} is not null
          and ${table.causeTrustedServiceId} is null
          and ${table.causeMigrationProvenanceId} is null
          and ${table.causeSystemPolicyId} is null
        ) or (
          ${table.causeKind} = 'provider_roster'
          and ${table.causeProviderEvidenceKind} is not null
          and (
            (
              ${table.causeProviderEvidenceKind} = 'member'
              and ${table.causeProviderRosterMemberEvidenceId} is not null
            ) or (
              ${table.causeProviderEvidenceKind} = 'roster_omission'
              and ${table.causeProviderRosterMemberEvidenceId} is null
            )
          )
          and ${table.causeProviderRosterEvidenceId} is not null
          and ${table.causeSourceThreadBindingId} is not null
          and ${table.causeSourceExternalIdentityId} is not null
          and ${table.causeOrderingKind} is not null
          and ${table.causeOrderingScopeToken} is not null
          and ${table.causeOrderingComparatorId} is not null
          and ${table.causeOrderingComparatorRevision} is not null
          and ${table.causeOrderingPosition} is not null
          and ${table.causeActorEmployeeId} is null
          and ${table.causeTrustedServiceId} is null
          and ${table.causeMigrationProvenanceId} is null
          and ${table.causeSystemPolicyId} is null
        ) or (
          ${table.causeKind} = 'migration'
          and ${table.causeProviderEvidenceKind} is null
          and ${table.causeProviderRosterMemberEvidenceId} is null
          and ${table.causeProviderRosterEvidenceId} is null
          and ${table.causeSourceThreadBindingId} is null
          and ${table.causeSourceExternalIdentityId} is null
          and ${table.causeOrderingKind} is null
          and ${table.causeOrderingScopeToken} is null
          and ${table.causeOrderingComparatorId} is null
          and ${table.causeOrderingComparatorRevision} is null
          and ${table.causeOrderingPosition} is null
          and ${table.causeActorEmployeeId} is null
          and ${table.causeTrustedServiceId} is not null
          and ${table.causeMigrationProvenanceId} is not null
          and ${table.causeSystemPolicyId} is null
        ) or (
          ${table.causeKind} = 'system_policy'
          and ${table.causeProviderEvidenceKind} is null
          and ${table.causeProviderRosterMemberEvidenceId} is null
          and ${table.causeProviderRosterEvidenceId} is null
          and ${table.causeSourceThreadBindingId} is null
          and ${table.causeSourceExternalIdentityId} is null
          and ${table.causeOrderingKind} is null
          and ${table.causeOrderingScopeToken} is null
          and ${table.causeOrderingComparatorId} is null
          and ${table.causeOrderingComparatorRevision} is null
          and ${table.causeOrderingPosition} is null
          and ${table.causeActorEmployeeId} is null
          and ${table.causeTrustedServiceId} is not null
          and ${table.causeMigrationProvenanceId} is null
          and ${table.causeSystemPolicyId} is not null
        )`
    ),
    check(
      "inbox_v2_participant_membership_transitions_cause_catalog_check",
      sql`(${table.causeTrustedServiceId} is null or ${catalogIdCheck(
        table.causeTrustedServiceId
      )}) and
        (${table.causeMigrationProvenanceId} is null or ${catalogIdCheck(
          table.causeMigrationProvenanceId
        )}) and
        (${table.causeSystemPolicyId} is null or ${catalogIdCheck(
          table.causeSystemPolicyId
        )}) and
        (${table.causeOrderingComparatorId} is null or ${catalogIdCheck(
          table.causeOrderingComparatorId
        )}) and
        ${catalogIdCheck(table.reasonCodeId)}`
    ),
    check(
      "inbox_v2_participant_membership_transitions_provider_ordering_check",
      sql`${table.causeKind} <> 'provider_roster' or (
        ${table.causeOrderingKind} = 'adapter_monotonic'
        and char_length(${table.causeOrderingScopeToken}) between 8 and 256
        and ${table.causeOrderingScopeToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${table.causeOrderingComparatorRevision} >= 1
        and ${table.causeOrderingPosition} >= 1
      )`
    ),
    check(
      "inbox_v2_participant_membership_transitions_revision_check",
      sql`${table.expectedRevision} is not distinct from ${table.currentRevision}
        and (
          (${table.currentRevision} is null
            and ${table.resultingRevision} = 1) or
          (${table.currentRevision} is not null
            and ${table.currentRevision} < 9223372036854775807
            and ${table.resultingRevision} = ${table.currentRevision} + 1)
        )`
    ),
    check(
      "inbox_v2_participant_membership_transitions_shape_check",
      sql`(
          ${table.intent} = 'initial_pending'
          and ${table.fromState} is null
          and ${table.toState} = 'pending'
          and ${table.fromRole} is null
          and ${table.currentRevision} is null
        ) or (
          ${table.intent} = 'initial_active'
          and ${table.fromState} is null
          and ${table.toState} = 'active'
          and ${table.fromRole} is null
          and ${table.currentRevision} is null
        ) or (
          ${table.intent} = 'activate'
          and ${table.fromState} = 'pending'
          and ${table.toState} = 'active'
          and ${table.fromRole} is not null
          and ${table.fromRole} = ${table.toRole}
          and ${table.currentRevision} is not null
        ) or (
          ${table.intent} = 'change_role'
          and ${table.fromState} in ('pending', 'active')
          and ${table.toState} = ${table.fromState}
          and ${table.fromRole} is not null
          and ${table.fromRole} <> ${table.toRole}
          and ${table.currentRevision} is not null
        ) or (
          ${table.intent} = 'leave'
          and ${table.fromState} = 'active'
          and ${table.toState} = 'left'
          and ${table.fromRole} is not null
          and ${table.fromRole} = ${table.toRole}
          and ${table.currentRevision} is not null
        ) or (
          ${table.intent} = 'remove'
          and ${table.fromState} in ('pending', 'active')
          and ${table.toState} = 'removed'
          and ${table.fromRole} is not null
          and ${table.fromRole} = ${table.toRole}
          and ${table.currentRevision} is not null
        )`
    ),
    check(
      "inbox_v2_participant_membership_transitions_membership_revision_check",
      sql`${table.membershipRevision} >= 1`
    ),
    check(
      "inbox_v2_participant_membership_transitions_timestamp_check",
      sql`isfinite(${table.occurredAt})`
    ),
    uniqueIndex(
      "inbox_v2_membership_transitions_provider_member_evidence_unique"
    )
      .on(table.tenantId, table.causeProviderRosterMemberEvidenceId)
      .where(
        sql`${table.causeKind} = 'provider_roster'
          and ${table.causeProviderEvidenceKind} = 'member'`
      ),
    uniqueIndex(
      "inbox_v2_membership_transitions_provider_omission_evidence_unique"
    )
      .on(
        table.tenantId,
        table.causeProviderRosterEvidenceId,
        table.causeSourceExternalIdentityId
      )
      .where(
        sql`${table.causeKind} = 'provider_roster'
          and ${table.causeProviderEvidenceKind} = 'roster_omission'`
      ),
    index("inbox_v2_participant_membership_transitions_tenant_episode_idx").on(
      table.tenantId,
      table.episodeId,
      table.resultingRevision,
      table.id
    ),
    index("inbox_v2_participant_membership_transitions_tenant_commit_idx").on(
      table.tenantId,
      table.conversationId,
      table.membershipRevision,
      table.episodeId,
      table.id
    ),
    index("inbox_v2_participant_membership_transitions_tenant_occurred_idx").on(
      table.tenantId,
      table.occurredAt,
      table.id
    ),
    index("inbox_v2_membership_transitions_provider_ordering_idx").on(
      table.tenantId,
      table.causeSourceThreadBindingId,
      table.causeSourceExternalIdentityId,
      table.causeOrderingPosition,
      table.id
    )
  ]
);

/**
 * Durable provider ordering fence across membership episode boundaries.
 * Episode-local ordering heads describe one episode; this compact row prevents
 * an older, previously unused roster observation from reopening membership
 * after a later observation already closed the preceding episode.
 */
export const inboxV2ProviderMembershipOrderingHeads = pgTable(
  "inbox_v2_provider_membership_ordering_heads",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    participantId: text("participant_id").notNull(),
    conversationId: text("conversation_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    sourceExternalIdentityId: text("source_external_identity_id").notNull(),
    orderingKind: text("ordering_kind").notNull(),
    orderingScopeToken: text("ordering_scope_token").notNull(),
    orderingComparatorId: text("ordering_comparator_id").notNull(),
    orderingComparatorRevision: bigint("ordering_comparator_revision", {
      mode: "bigint"
    }).notNull(),
    orderingPosition: bigint("ordering_position", { mode: "bigint" }).notNull(),
    episodeId: text("episode_id").notNull(),
    transitionId: text("transition_id").notNull(),
    membershipRevision: bigint("membership_revision", {
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
      name: "inbox_v2_provider_membership_ordering_heads_pk",
      columns: [
        table.tenantId,
        table.participantId,
        table.sourceThreadBindingId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_membership_ordering_heads_participant_fk",
      columns: [table.tenantId, table.participantId, table.conversationId],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_membership_ordering_heads_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_membership_ordering_heads_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_membership_ordering_heads_episode_fk",
      columns: [table.tenantId, table.episodeId],
      foreignColumns: [
        inboxV2ParticipantMembershipEpisodes.tenantId,
        inboxV2ParticipantMembershipEpisodes.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_membership_ordering_heads_transition_fk",
      columns: [table.tenantId, table.transitionId],
      foreignColumns: [
        inboxV2ParticipantMembershipTransitions.tenantId,
        inboxV2ParticipantMembershipTransitions.id
      ]
    }),
    check(
      "inbox_v2_provider_membership_ordering_heads_values_check",
      sql`${table.orderingKind} = 'adapter_monotonic'
        and char_length(${table.orderingScopeToken}) between 8 and 256
        and ${table.orderingScopeToken} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and ${catalogIdCheck(table.orderingComparatorId)}
        and ${table.orderingComparatorRevision} >= 1
        and ${table.orderingPosition} >= 1
        and ${table.membershipRevision} >= 1
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_provider_membership_ordering_heads_timestamps_check",
      finiteOrderedTimestamps(table.createdAt, table.updatedAt)
    ),
    index("inbox_v2_provider_membership_ordering_heads_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.membershipRevision,
      table.participantId,
      table.sourceThreadBindingId
    )
  ]
);

function catalogIdCheck(
  column: Parameters<typeof sql>[0] extends never ? never : unknown
) {
  return sql`char_length(${column as never}) <= 256 and (
    (
      ${column as never} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column as never}, ':', 2)) <= 160
    ) or (
      ${column as never} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(${column as never}, ':', 2)) <= 80
      and char_length(split_part(${column as never}, ':', 3)) <= 160
      and split_part(${column as never}, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )`;
}

function finiteOrderedTimestamps(createdAt: unknown, updatedAt: unknown) {
  return sql`isfinite(${createdAt as never})
    and isfinite(${updatedAt as never})
    and ${updatedAt as never} >= ${createdAt as never}`;
}

/**
 * Commit-time closure and hot-path guards for the one-way ownership graph.
 * Every lookup is an exact PK/unique-index lookup; no validator loads lifetime
 * membership history or the full Conversation roster.
 */
export const INBOX_V2_PARTICIPANT_MEMBERSHIP_INTEGRITY_SQL = String.raw`
insert into public.inbox_v2_conversation_membership_heads (
  tenant_id,
  conversation_id,
  membership_revision,
  created_at,
  updated_at
)
select
  conversation_row.tenant_id,
  conversation_row.id,
  0,
  conversation_row.created_at,
  conversation_row.created_at
from public.inbox_v2_conversations conversation_row
on conflict (tenant_id, conversation_id) do nothing;

create or replace function public.inbox_v2_participant_membership_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.membership_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_conversation_transport()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.transport is distinct from old.transport then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_transport_immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_current_internal_membership_authority(
  checked_tenant_id text,
  checked_participant_id text,
  checked_conversation_id text,
  checked_origin_kind public.inbox_v2_participant_membership_origin_kind,
  checked_state public.inbox_v2_participant_membership_state
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  employee_deactivated_at timestamptz;
  conversation_transport public.inbox_v2_conversation_transport;
begin
  if checked_origin_kind <> 'hulee_internal_command'
     or checked_state not in ('pending', 'active') then
    return;
  end if;

  select employee_row.deactivated_at, conversation_row.transport
    into employee_deactivated_at, conversation_transport
    from public.inbox_v2_conversation_participants participant_row
    join public.employees employee_row
      on employee_row.tenant_id = participant_row.tenant_id
     and employee_row.id = participant_row.subject_employee_id
    join public.inbox_v2_conversations conversation_row
      on conversation_row.tenant_id = participant_row.tenant_id
     and conversation_row.id = participant_row.conversation_id
   where participant_row.tenant_id = checked_tenant_id
     and participant_row.id = checked_participant_id
     and participant_row.conversation_id = checked_conversation_id
     and participant_row.subject_kind = 'employee'
   for no key update of employee_row;

  if not found
     or employee_deactivated_at is not null
     or conversation_transport <> 'internal' then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.internal_membership_subject_or_employee_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_episode_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  latest_state public.inbox_v2_participant_membership_state;
  latest_boundary timestamptz;
  provider_shape_count integer;
  provider_ordering_head public.inbox_v2_provider_membership_ordering_heads%rowtype;
  provider_ordering_head_found boolean := false;
begin
  perform 1
    from public.inbox_v2_conversation_participants participant_row
   where participant_row.tenant_id = new.tenant_id
     and participant_row.id = new.participant_id
     and participant_row.conversation_id = new.conversation_id
   for update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.membership_episode_participant_missing';
  end if;

  if new.origin_kind = 'provider_roster' then
    select count(*)::integer
      into provider_shape_count
      from public.inbox_v2_provider_roster_member_evidence member_row
      join public.inbox_v2_provider_roster_evidence roster_row
        on roster_row.tenant_id = member_row.tenant_id
       and roster_row.id = member_row.roster_evidence_id
       and roster_row.source_thread_binding_id = member_row.source_thread_binding_id
      join public.inbox_v2_source_thread_bindings binding_row
        on binding_row.tenant_id = roster_row.tenant_id
       and binding_row.id = roster_row.source_thread_binding_id
      join public.inbox_v2_external_threads thread_row
        on thread_row.tenant_id = binding_row.tenant_id
       and thread_row.id = binding_row.external_thread_id
      join public.inbox_v2_source_external_identities identity_row
        on identity_row.tenant_id = member_row.tenant_id
       and identity_row.id = member_row.source_external_identity_id
      join public.inbox_v2_conversation_participants participant_row
        on participant_row.tenant_id = member_row.tenant_id
       and participant_row.id = new.participant_id
       and participant_row.conversation_id = new.conversation_id
     where member_row.tenant_id = new.tenant_id
       and member_row.id = new.origin_provider_roster_member_evidence_id
       and member_row.roster_evidence_id = new.origin_provider_roster_evidence_id
       and member_row.source_thread_binding_id = new.origin_source_thread_binding_id
       and member_row.source_external_identity_id = new.origin_source_external_identity_id
       and participant_row.subject_kind = 'source_external_identity'
       and participant_row.subject_source_external_identity_id =
         member_row.source_external_identity_id
       and thread_row.conversation_id = new.conversation_id
       and member_row.state = 'present'
       and roster_row.authority = 'authoritative'
       and new.state = 'active'
       and new.role::text = member_row.normalized_role::text
       and new.valid_from = member_row.observed_at
       and new.valid_to is null
       and new.evidence_classification = 'confirmed'
       and new.origin_ordering_kind = roster_row.ordering_kind
       and new.origin_ordering_scope_token = roster_row.ordering_scope_token
       and new.origin_ordering_comparator_id = roster_row.ordering_comparator_id
       and new.origin_ordering_comparator_revision =
         roster_row.ordering_comparator_revision
       and new.origin_ordering_position = roster_row.ordering_position
       and new.provider_ordering_head_position = roster_row.ordering_position
       and (
         (
           identity_row.scope_kind = 'provider'
           and identity_row.declaration_contract_id = roster_row.adapter_contract_id
           and identity_row.declaration_contract_version =
             roster_row.adapter_contract_version
           and identity_row.declaration_surface_id = roster_row.adapter_surface_id
           and identity_row.declaration_loaded_by_trusted_service_id =
             roster_row.adapter_loaded_by_trusted_service_id
         ) or (
           identity_row.scope_kind = 'source_connection'
           and identity_row.scope_source_connection_id =
             binding_row.source_connection_id
         ) or (
           identity_row.scope_kind = 'source_account'
           and identity_row.scope_source_account_id = binding_row.source_account_id
         )
       );

    if provider_shape_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_origin_invalid';
    end if;

    select *
      into provider_ordering_head
      from public.inbox_v2_provider_membership_ordering_heads head_row
     where head_row.tenant_id = new.tenant_id
       and head_row.participant_id = new.participant_id
       and head_row.source_thread_binding_id =
         new.origin_source_thread_binding_id
     for update;
    provider_ordering_head_found := found;

    if provider_ordering_head_found and row(
         provider_ordering_head.conversation_id,
         provider_ordering_head.source_external_identity_id,
         provider_ordering_head.ordering_kind,
         provider_ordering_head.ordering_scope_token,
         provider_ordering_head.ordering_comparator_id,
         provider_ordering_head.ordering_comparator_revision
       ) is distinct from row(
         new.conversation_id,
         new.origin_source_external_identity_id,
         new.origin_ordering_kind,
         new.origin_ordering_scope_token,
         new.origin_ordering_comparator_id,
         new.origin_ordering_comparator_revision
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_ordering_scope_invalid';
    end if;

    if provider_ordering_head_found
       and new.origin_ordering_position <=
         provider_ordering_head.ordering_position then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_ordering_stale';
    end if;
  end if;

  select episode_row.state,
         coalesce(episode_row.valid_to, episode_row.valid_from)
    into latest_state, latest_boundary
    from public.inbox_v2_participant_membership_episodes episode_row
   where episode_row.tenant_id = new.tenant_id
     and episode_row.participant_id = new.participant_id
      and episode_row.origin_kind = new.origin_kind
      and episode_row.origin_source_thread_binding_id is not distinct from
        new.origin_source_thread_binding_id
     and episode_row.origin_migration_provenance_id is not distinct from
       new.origin_migration_provenance_id
     and episode_row.origin_system_policy_id is not distinct from
       new.origin_system_policy_id
   order by episode_row.valid_from desc, episode_row.id desc
   limit 1;

  if found and (
       latest_state in ('pending', 'active')
       or new.valid_from < latest_boundary
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.membership_episode_history_overlap';
  end if;

  perform public.inbox_v2_assert_current_internal_membership_authority(
    new.tenant_id,
    new.participant_id,
    new.conversation_id,
    new.origin_kind,
    new.state
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_head_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.membership_revision <> old.membership_revision + 1
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_membership_head_invalid_advance';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_commit_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  current_head_revision bigint;
  predecessor_occurred_at timestamptz;
begin
  select head_row.membership_revision
    into current_head_revision
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.conversation_id = new.conversation_id
   for update;

  if not found or current_head_revision <> new.expected_membership_revision then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.conversation_membership_revision_conflict';
  end if;

  if new.expected_membership_revision > 0 then
    select commit_row.occurred_at
      into predecessor_occurred_at
      from public.inbox_v2_conversation_membership_commits commit_row
     where commit_row.tenant_id = new.tenant_id
       and commit_row.conversation_id = new.conversation_id
       and commit_row.resulting_membership_revision =
         new.expected_membership_revision;
    if not found or new.occurred_at < predecessor_occurred_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_membership_commit_time_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_transition_insert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  commit_expected_revision bigint;
  current_head_revision bigint;
  predecessor_occurred_at timestamptz;
  episode_origin_kind public.inbox_v2_participant_membership_origin_kind;
  episode_origin_provider_member_id text;
  episode_origin_provider_roster_id text;
  episode_origin_binding_id text;
  episode_origin_identity_id text;
  episode_origin_ordering_kind text;
  episode_origin_ordering_scope_token text;
  episode_origin_ordering_comparator_id text;
  episode_origin_ordering_comparator_revision bigint;
  episode_origin_ordering_position bigint;
  episode_provider_ordering_head_position bigint;
  episode_migration_provenance_id text;
  episode_system_policy_id text;
  provider_shape_count integer;
begin
  select commit_row.expected_membership_revision
    into commit_expected_revision
    from public.inbox_v2_conversation_membership_commits commit_row
   where commit_row.tenant_id = new.tenant_id
     and commit_row.conversation_id = new.conversation_id
     and commit_row.resulting_membership_revision = new.membership_revision;

  select head_row.membership_revision
    into current_head_revision
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.conversation_id = new.conversation_id;

  if commit_expected_revision is null
     or current_head_revision is null
     or current_head_revision <> commit_expected_revision then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.membership_transition_commit_not_open';
  end if;

  select episode_row.origin_kind,
         episode_row.origin_provider_roster_member_evidence_id,
         episode_row.origin_provider_roster_evidence_id,
         episode_row.origin_source_thread_binding_id,
         episode_row.origin_source_external_identity_id,
         episode_row.origin_ordering_kind,
         episode_row.origin_ordering_scope_token,
         episode_row.origin_ordering_comparator_id,
         episode_row.origin_ordering_comparator_revision,
         episode_row.origin_ordering_position,
         episode_row.provider_ordering_head_position,
         episode_row.origin_migration_provenance_id,
         episode_row.origin_system_policy_id
    into episode_origin_kind,
         episode_origin_provider_member_id,
         episode_origin_provider_roster_id,
         episode_origin_binding_id,
         episode_origin_identity_id,
         episode_origin_ordering_kind,
         episode_origin_ordering_scope_token,
         episode_origin_ordering_comparator_id,
         episode_origin_ordering_comparator_revision,
         episode_origin_ordering_position,
         episode_provider_ordering_head_position,
         episode_migration_provenance_id,
         episode_system_policy_id
    from public.inbox_v2_participant_membership_episodes episode_row
   where episode_row.tenant_id = new.tenant_id
     and episode_row.id = new.episode_id
     and episode_row.participant_id = new.participant_id
     and episode_row.conversation_id = new.conversation_id;
  if not found
     or episode_origin_kind is distinct from new.cause_kind
     or episode_migration_provenance_id is distinct from
       new.cause_migration_provenance_id
     or episode_system_policy_id is distinct from new.cause_system_policy_id then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.membership_transition_origin_evidence_mismatch';
  end if;

  if new.cause_kind = 'provider_roster' then
    if new.cause_source_thread_binding_id is distinct from episode_origin_binding_id
       or new.cause_source_external_identity_id is distinct from episode_origin_identity_id
       or new.cause_ordering_kind is distinct from episode_origin_ordering_kind
       or new.cause_ordering_scope_token is distinct from
         episode_origin_ordering_scope_token
       or new.cause_ordering_comparator_id is distinct from
         episode_origin_ordering_comparator_id
       or new.cause_ordering_comparator_revision is distinct from
         episode_origin_ordering_comparator_revision
       or (
         new.current_revision is null
         and (
           new.cause_provider_evidence_kind <> 'member'
           or new.cause_provider_roster_member_evidence_id is distinct from
             episode_origin_provider_member_id
           or new.cause_provider_roster_evidence_id is distinct from
             episode_origin_provider_roster_id
           or new.cause_ordering_position is distinct from
             episode_origin_ordering_position
         )
       )
       or (
         new.current_revision is not null
         and new.cause_ordering_position <=
           episode_provider_ordering_head_position
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_evidence_stale_or_scope_invalid';
    end if;

    if new.cause_provider_evidence_kind = 'member' then
      select count(*)::integer
        into provider_shape_count
        from public.inbox_v2_provider_roster_member_evidence member_row
        join public.inbox_v2_provider_roster_evidence roster_row
          on roster_row.tenant_id = member_row.tenant_id
         and roster_row.id = member_row.roster_evidence_id
         and roster_row.source_thread_binding_id = member_row.source_thread_binding_id
        join public.inbox_v2_source_thread_bindings binding_row
          on binding_row.tenant_id = roster_row.tenant_id
         and binding_row.id = roster_row.source_thread_binding_id
        join public.inbox_v2_external_threads thread_row
          on thread_row.tenant_id = binding_row.tenant_id
         and thread_row.id = binding_row.external_thread_id
        join public.inbox_v2_source_external_identities identity_row
          on identity_row.tenant_id = member_row.tenant_id
         and identity_row.id = member_row.source_external_identity_id
       where member_row.tenant_id = new.tenant_id
         and member_row.id = new.cause_provider_roster_member_evidence_id
         and member_row.roster_evidence_id = new.cause_provider_roster_evidence_id
         and member_row.source_thread_binding_id = new.cause_source_thread_binding_id
         and member_row.source_external_identity_id =
           new.cause_source_external_identity_id
         and thread_row.conversation_id = new.conversation_id
         and new.occurred_at = member_row.observed_at
         and roster_row.authority = 'authoritative'
         and member_row.normalized_role::text = new.to_role::text
         and member_row.state = case new.to_state
           when 'left' then 'left'::public.inbox_v2_provider_roster_member_state
           when 'removed' then 'removed'::public.inbox_v2_provider_roster_member_state
           else 'present'::public.inbox_v2_provider_roster_member_state
         end
         and roster_row.ordering_kind = new.cause_ordering_kind
         and roster_row.ordering_scope_token = new.cause_ordering_scope_token
         and roster_row.ordering_comparator_id = new.cause_ordering_comparator_id
         and roster_row.ordering_comparator_revision =
           new.cause_ordering_comparator_revision
         and roster_row.ordering_position = new.cause_ordering_position
         and (
           (
             identity_row.scope_kind = 'provider'
             and identity_row.declaration_contract_id = roster_row.adapter_contract_id
             and identity_row.declaration_contract_version =
               roster_row.adapter_contract_version
             and identity_row.declaration_surface_id = roster_row.adapter_surface_id
             and identity_row.declaration_loaded_by_trusted_service_id =
               roster_row.adapter_loaded_by_trusted_service_id
           ) or (
             identity_row.scope_kind = 'source_connection'
             and identity_row.scope_source_connection_id =
               binding_row.source_connection_id
           ) or (
             identity_row.scope_kind = 'source_account'
             and identity_row.scope_source_account_id = binding_row.source_account_id
           )
         );
    else
      select count(*)::integer
        into provider_shape_count
        from public.inbox_v2_provider_roster_evidence roster_row
        join public.inbox_v2_source_thread_bindings binding_row
          on binding_row.tenant_id = roster_row.tenant_id
         and binding_row.id = roster_row.source_thread_binding_id
        join public.inbox_v2_external_threads thread_row
          on thread_row.tenant_id = binding_row.tenant_id
         and thread_row.id = binding_row.external_thread_id
        join public.inbox_v2_source_external_identities identity_row
          on identity_row.tenant_id = roster_row.tenant_id
         and identity_row.id = new.cause_source_external_identity_id
       where roster_row.tenant_id = new.tenant_id
         and roster_row.id = new.cause_provider_roster_evidence_id
         and roster_row.source_thread_binding_id =
           new.cause_source_thread_binding_id
         and thread_row.conversation_id = new.conversation_id
         and new.to_state in ('left', 'removed')
         and new.occurred_at = roster_row.observed_at
         and roster_row.completeness = 'complete'
         and roster_row.authority = 'authoritative'
         and roster_row.omission_policy = 'close_missing'
         and roster_row.ordering_kind = new.cause_ordering_kind
         and roster_row.ordering_scope_token = new.cause_ordering_scope_token
         and roster_row.ordering_comparator_id = new.cause_ordering_comparator_id
         and roster_row.ordering_comparator_revision =
           new.cause_ordering_comparator_revision
         and roster_row.ordering_position = new.cause_ordering_position
         and (
           (
             identity_row.scope_kind = 'provider'
             and identity_row.declaration_contract_id = roster_row.adapter_contract_id
             and identity_row.declaration_contract_version =
               roster_row.adapter_contract_version
             and identity_row.declaration_surface_id = roster_row.adapter_surface_id
             and identity_row.declaration_loaded_by_trusted_service_id =
               roster_row.adapter_loaded_by_trusted_service_id
           ) or (
             identity_row.scope_kind = 'source_connection'
             and identity_row.scope_source_connection_id =
               binding_row.source_connection_id
           ) or (
             identity_row.scope_kind = 'source_account'
             and identity_row.scope_source_account_id = binding_row.source_account_id
           )
         )
         and not exists (
           select 1
             from public.inbox_v2_provider_roster_member_evidence omitted_member
            where omitted_member.tenant_id = roster_row.tenant_id
              and omitted_member.roster_evidence_id = roster_row.id
              and omitted_member.source_external_identity_id =
                new.cause_source_external_identity_id
         );
    end if;

    if provider_shape_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_transition_invalid';
    end if;
  end if;

  if new.current_revision is not null then
    select transition_row.occurred_at
      into predecessor_occurred_at
      from public.inbox_v2_participant_membership_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.episode_id = new.episode_id
       and transition_row.resulting_revision = new.current_revision;
    if predecessor_occurred_at is null
       or new.occurred_at < predecessor_occurred_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.membership_transition_predecessor_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_guard_episode_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.participant_id is distinct from old.participant_id
     or new.conversation_id is distinct from old.conversation_id
     or new.origin_kind is distinct from old.origin_kind
     or new.origin_provider_roster_member_evidence_id is distinct from
       old.origin_provider_roster_member_evidence_id
     or new.origin_provider_roster_evidence_id is distinct from
       old.origin_provider_roster_evidence_id
     or new.origin_source_thread_binding_id is distinct from
       old.origin_source_thread_binding_id
     or new.origin_source_external_identity_id is distinct from
       old.origin_source_external_identity_id
     or new.origin_ordering_kind is distinct from old.origin_ordering_kind
     or new.origin_ordering_scope_token is distinct from
       old.origin_ordering_scope_token
     or new.origin_ordering_comparator_id is distinct from
       old.origin_ordering_comparator_id
     or new.origin_ordering_comparator_revision is distinct from
       old.origin_ordering_comparator_revision
     or new.origin_ordering_position is distinct from old.origin_ordering_position
     or new.origin_migration_provenance_id is distinct from old.origin_migration_provenance_id
     or new.origin_system_policy_id is distinct from old.origin_system_policy_id
     or new.valid_from is distinct from old.valid_from
     or new.evidence_classification is distinct from old.evidence_classification
     or new.revision <> old.revision + 1
     or (
       old.origin_kind = 'provider_roster'
       and (
         new.provider_ordering_head_position is null
         or new.provider_ordering_head_position <= old.provider_ordering_head_position
       )
     )
     or (
       old.origin_kind <> 'provider_roster'
       and new.provider_ordering_head_position is distinct from
         old.provider_ordering_head_position
     )
     or old.state in ('left', 'removed') then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.participant_membership_episode_stable_fields_invalid';
  end if;
  perform public.inbox_v2_assert_current_internal_membership_authority(
    new.tenant_id,
    new.participant_id,
    new.conversation_id,
    new.origin_kind,
    new.state
  );
  return new;
end;
$function$;

create or replace function public.inbox_v2_provider_membership_ordering_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  target_shape_count integer;
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_membership_ordering_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.provider_membership_ordering_head_invalid';
    end if;
  elsif row(
      new.tenant_id,
      new.participant_id,
      new.conversation_id,
      new.source_thread_binding_id,
      new.source_external_identity_id,
      new.ordering_kind,
      new.ordering_scope_token,
      new.ordering_comparator_id,
      new.ordering_comparator_revision,
      new.created_at
    ) is distinct from row(
      old.tenant_id,
      old.participant_id,
      old.conversation_id,
      old.source_thread_binding_id,
      old.source_external_identity_id,
      old.ordering_kind,
      old.ordering_scope_token,
      old.ordering_comparator_id,
      old.ordering_comparator_revision,
      old.created_at
    )
    or new.ordering_position <= old.ordering_position
    or new.membership_revision <= old.membership_revision
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_membership_ordering_head_invalid_advance';
  end if;

  select count(*)::integer
    into target_shape_count
    from public.inbox_v2_participant_membership_transitions transition_row
    join public.inbox_v2_participant_membership_episodes episode_row
      on episode_row.tenant_id = transition_row.tenant_id
     and episode_row.id = transition_row.episode_id
     and episode_row.participant_id = transition_row.participant_id
     and episode_row.conversation_id = transition_row.conversation_id
     and episode_row.origin_kind = transition_row.cause_kind
   where transition_row.tenant_id = new.tenant_id
     and transition_row.id = new.transition_id
     and transition_row.episode_id = new.episode_id
     and transition_row.participant_id = new.participant_id
     and transition_row.conversation_id = new.conversation_id
     and transition_row.membership_revision = new.membership_revision
     and transition_row.cause_kind = 'provider_roster'
     and transition_row.cause_source_thread_binding_id =
       new.source_thread_binding_id
     and transition_row.cause_source_external_identity_id =
       new.source_external_identity_id
     and transition_row.cause_ordering_kind = new.ordering_kind
     and transition_row.cause_ordering_scope_token = new.ordering_scope_token
     and transition_row.cause_ordering_comparator_id =
       new.ordering_comparator_id
     and transition_row.cause_ordering_comparator_revision =
       new.ordering_comparator_revision
     and transition_row.cause_ordering_position = new.ordering_position
     and transition_row.occurred_at = new.updated_at
     and transition_row.resulting_revision = episode_row.revision
     and episode_row.origin_source_thread_binding_id =
       new.source_thread_binding_id
     and episode_row.origin_source_external_identity_id =
       new.source_external_identity_id
     and episode_row.origin_ordering_kind = new.ordering_kind
     and episode_row.origin_ordering_scope_token = new.ordering_scope_token
     and episode_row.origin_ordering_comparator_id =
       new.ordering_comparator_id
     and episode_row.origin_ordering_comparator_revision =
       new.ordering_comparator_revision
     and episode_row.provider_ordering_head_position = new.ordering_position;

  if target_shape_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.provider_membership_ordering_head_target_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_membership_head(
  checked_tenant_id text,
  checked_conversation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  conversation_count integer;
  head_count integer;
begin
  select count(*)::integer
    into conversation_count
    from public.inbox_v2_conversations conversation_row
   where conversation_row.tenant_id = checked_tenant_id
     and conversation_row.id = checked_conversation_id;
  select count(*)::integer
    into head_count
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id;

  if conversation_count <> head_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_membership_head_missing';
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_membership_projection(
  checked_tenant_id text,
  checked_conversation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_revision bigint;
  head_created_at timestamptz;
  head_updated_at timestamptz;
  matching_commit_count integer;
  matching_commit_occurred_at timestamptz;
  newer_commit_count integer;
begin
  select head_row.membership_revision,
         head_row.created_at,
         head_row.updated_at
    into head_revision, head_created_at, head_updated_at
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id;
  if not found then
    return;
  end if;

  select count(*)::integer, max(commit_row.occurred_at)
    into matching_commit_count, matching_commit_occurred_at
    from public.inbox_v2_conversation_membership_commits commit_row
   where commit_row.tenant_id = checked_tenant_id
     and commit_row.conversation_id = checked_conversation_id
     and commit_row.resulting_membership_revision = head_revision;
  select count(*)::integer
    into newer_commit_count
    from public.inbox_v2_conversation_membership_commits commit_row
   where commit_row.tenant_id = checked_tenant_id
     and commit_row.conversation_id = checked_conversation_id
     and commit_row.resulting_membership_revision > head_revision;

  if (head_revision = 0 and matching_commit_count <> 0)
     or (head_revision > 0 and matching_commit_count <> 1)
     or (
       head_revision = 0
       and head_updated_at is distinct from head_created_at
     )
     or (
       head_revision > 0
       and head_updated_at is distinct from matching_commit_occurred_at
     )
     or newer_commit_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_membership_head_projection_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_conversation_membership_commit(
  checked_tenant_id text,
  checked_conversation_id text,
  checked_membership_revision bigint
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  head_revision bigint;
  transition_count integer;
  transition_time_mismatch_count integer;
begin
  select head_row.membership_revision
    into head_revision
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id;
  select count(*)::integer,
         count(*) filter (
           where transition_row.occurred_at is distinct from
             commit_row.occurred_at
         )::integer
    into transition_count, transition_time_mismatch_count
    from public.inbox_v2_conversation_membership_commits commit_row
    join public.inbox_v2_participant_membership_transitions transition_row
      on transition_row.tenant_id = commit_row.tenant_id
     and transition_row.conversation_id = commit_row.conversation_id
     and transition_row.membership_revision =
       commit_row.resulting_membership_revision
   where commit_row.tenant_id = checked_tenant_id
     and commit_row.conversation_id = checked_conversation_id
     and commit_row.resulting_membership_revision = checked_membership_revision;

  if head_revision is null
     or head_revision < checked_membership_revision
     or transition_count < 1
     or transition_time_mismatch_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_membership_commit_uninduced';
  end if;
end;
$function$;

create or replace function public.inbox_v2_assert_participant_membership_episode(
  checked_tenant_id text,
  checked_episode_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  episode_row public.inbox_v2_participant_membership_episodes%rowtype;
  latest_transition public.inbox_v2_participant_membership_transitions%rowtype;
  initial_transition public.inbox_v2_participant_membership_transitions%rowtype;
  newer_transition_count integer;
  internal_shape_count integer;
begin
  select *
    into episode_row
    from public.inbox_v2_participant_membership_episodes episode_source
   where episode_source.tenant_id = checked_tenant_id
     and episode_source.id = checked_episode_id;
  if not found then
    return;
  end if;

  select *
    into latest_transition
    from public.inbox_v2_participant_membership_transitions transition_row
   where transition_row.tenant_id = checked_tenant_id
     and transition_row.episode_id = checked_episode_id
     and transition_row.resulting_revision = episode_row.revision;
  select *
    into initial_transition
    from public.inbox_v2_participant_membership_transitions transition_row
   where transition_row.tenant_id = checked_tenant_id
     and transition_row.episode_id = checked_episode_id
     and transition_row.resulting_revision = 1;
  select count(*)::integer
    into newer_transition_count
    from public.inbox_v2_participant_membership_transitions transition_row
   where transition_row.tenant_id = checked_tenant_id
     and transition_row.episode_id = checked_episode_id
     and transition_row.resulting_revision > episode_row.revision;

  if latest_transition.id is null
     or initial_transition.id is null
     or initial_transition.occurred_at <> episode_row.valid_from
     or latest_transition.to_state <> episode_row.state
     or latest_transition.to_role <> episode_row.role
     or newer_transition_count <> 0
     or (
       episode_row.origin_kind = 'provider_roster'
       and (
         initial_transition.cause_provider_evidence_kind <> 'member'
         or initial_transition.cause_provider_roster_member_evidence_id is distinct from
           episode_row.origin_provider_roster_member_evidence_id
         or initial_transition.cause_provider_roster_evidence_id is distinct from
           episode_row.origin_provider_roster_evidence_id
         or initial_transition.cause_ordering_position is distinct from
           episode_row.origin_ordering_position
         or latest_transition.cause_source_thread_binding_id is distinct from
           episode_row.origin_source_thread_binding_id
         or latest_transition.cause_source_external_identity_id is distinct from
           episode_row.origin_source_external_identity_id
         or latest_transition.cause_ordering_position is distinct from
           episode_row.provider_ordering_head_position
         or not exists (
           select 1
             from public.inbox_v2_provider_membership_ordering_heads ordering_head
            where ordering_head.tenant_id = episode_row.tenant_id
              and ordering_head.participant_id = episode_row.participant_id
              and ordering_head.conversation_id = episode_row.conversation_id
              and ordering_head.source_thread_binding_id =
                episode_row.origin_source_thread_binding_id
              and ordering_head.source_external_identity_id =
                episode_row.origin_source_external_identity_id
              and ordering_head.ordering_kind =
                episode_row.origin_ordering_kind
              and ordering_head.ordering_scope_token =
                episode_row.origin_ordering_scope_token
              and ordering_head.ordering_comparator_id =
                episode_row.origin_ordering_comparator_id
              and ordering_head.ordering_comparator_revision =
                episode_row.origin_ordering_comparator_revision
              and (
                (
                  ordering_head.ordering_position =
                    episode_row.provider_ordering_head_position
                  and ordering_head.episode_id = episode_row.id
                  and ordering_head.transition_id = latest_transition.id
                  and ordering_head.membership_revision =
                    latest_transition.membership_revision
                  and ordering_head.updated_at =
                    latest_transition.occurred_at
                ) or (
                  episode_row.state in ('left', 'removed')
                  and ordering_head.episode_id <> episode_row.id
                  and ordering_head.ordering_position >
                    episode_row.provider_ordering_head_position
                  and ordering_head.membership_revision >
                    latest_transition.membership_revision
                  and ordering_head.updated_at >=
                    latest_transition.occurred_at
                )
              )
         )
       )
     )
     or (
       episode_row.state in ('left', 'removed') and
       episode_row.valid_to is distinct from latest_transition.occurred_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.participant_membership_episode_projection_invalid';
  end if;

  if episode_row.origin_kind = 'hulee_internal_command' then
    select count(*)::integer
      into internal_shape_count
      from public.inbox_v2_conversation_participants participant_row
      join public.inbox_v2_conversations conversation_row
        on conversation_row.tenant_id = participant_row.tenant_id
       and conversation_row.id = participant_row.conversation_id
      join public.employees employee_row
        on employee_row.tenant_id = participant_row.tenant_id
       and employee_row.id = participant_row.subject_employee_id
     where participant_row.tenant_id = episode_row.tenant_id
       and participant_row.id = episode_row.participant_id
       and participant_row.conversation_id = episode_row.conversation_id
       and participant_row.subject_kind = 'employee'
       and conversation_row.transport = 'internal'
       and (
         episode_row.state in ('left', 'removed')
         or employee_row.deactivated_at is null
       );
    if internal_shape_count <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.internal_membership_subject_or_employee_invalid';
    end if;
  end if;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_conversation()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  checked_tenant_id text := coalesce(new.tenant_id, old.tenant_id);
  checked_conversation_id text := coalesce(new.id, old.id);
begin
  perform public.inbox_v2_assert_conversation_membership_head(
    checked_tenant_id,
    checked_conversation_id
  );
  perform public.inbox_v2_assert_conversation_membership_projection(
    checked_tenant_id,
    checked_conversation_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_head()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_membership_head(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.conversation_id, old.conversation_id)
  );
  perform public.inbox_v2_assert_conversation_membership_projection(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.conversation_id, old.conversation_id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_commit()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_membership_commit(
    new.tenant_id,
    new.conversation_id,
    new.resulting_membership_revision
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_episode()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_participant_membership_episode(
    coalesce(new.tenant_id, old.tenant_id),
    coalesce(new.id, old.id)
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_assert_conversation_membership_commit(
    new.tenant_id,
    new.conversation_id,
    new.membership_revision
  );
  perform public.inbox_v2_assert_participant_membership_episode(
    new.tenant_id,
    new.episode_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_participant_membership_deferred_employee()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  current_internal_count integer;
begin
  if new.deactivated_at is null then
    return null;
  end if;
  select count(*)::integer
    into current_internal_count
    from public.inbox_v2_conversation_participants participant_row
    join public.inbox_v2_participant_membership_episodes episode_row
      on episode_row.tenant_id = participant_row.tenant_id
     and episode_row.participant_id = participant_row.id
     and episode_row.conversation_id = participant_row.conversation_id
   where participant_row.tenant_id = new.tenant_id
     and participant_row.subject_kind = 'employee'
     and participant_row.subject_employee_id = new.id
     and episode_row.origin_kind = 'hulee_internal_command'
     and episode_row.state in ('pending', 'active');
  if current_internal_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.employee_deactivation_has_internal_membership';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_bot_identities_immutable_trigger
before update or delete on public.inbox_v2_bot_identities
for each row execute function public.inbox_v2_participant_membership_reject_immutable();

create trigger inbox_v2_conversations_transport_immutable_trigger
before update of transport on public.inbox_v2_conversations
for each row execute function public.inbox_v2_participant_membership_guard_conversation_transport();

create trigger inbox_v2_conversation_participants_immutable_trigger
before update or delete on public.inbox_v2_conversation_participants
for each row execute function public.inbox_v2_participant_membership_reject_immutable();

create trigger inbox_v2_conversation_membership_heads_guard_trigger
before update on public.inbox_v2_conversation_membership_heads
for each row execute function public.inbox_v2_participant_membership_guard_head_update();

create trigger inbox_v2_conversation_membership_commits_guard_insert_trigger
before insert on public.inbox_v2_conversation_membership_commits
for each row execute function public.inbox_v2_participant_membership_guard_commit_insert();

create trigger inbox_v2_conversation_membership_commits_immutable_trigger
before update or delete on public.inbox_v2_conversation_membership_commits
for each row execute function public.inbox_v2_participant_membership_reject_immutable();

create trigger inbox_v2_participant_membership_episodes_stable_guard_trigger
before update on public.inbox_v2_participant_membership_episodes
for each row execute function public.inbox_v2_participant_membership_guard_episode_update();

create trigger inbox_v2_participant_membership_episodes_insert_guard_trigger
before insert on public.inbox_v2_participant_membership_episodes
for each row execute function public.inbox_v2_participant_membership_guard_episode_insert();

create trigger inbox_v2_participant_membership_episodes_immutable_delete_trigger
before delete on public.inbox_v2_participant_membership_episodes
for each row execute function public.inbox_v2_participant_membership_reject_immutable();

create trigger inbox_v2_provider_membership_ordering_heads_guard_trigger
before insert or update or delete
on public.inbox_v2_provider_membership_ordering_heads
for each row execute function public.inbox_v2_provider_membership_ordering_head_guard();

create trigger inbox_v2_participant_membership_transitions_guard_insert_trigger
before insert on public.inbox_v2_participant_membership_transitions
for each row execute function public.inbox_v2_participant_membership_guard_transition_insert();

create trigger inbox_v2_participant_membership_transitions_immutable_trigger
before update or delete on public.inbox_v2_participant_membership_transitions
for each row execute function public.inbox_v2_participant_membership_reject_immutable();

create constraint trigger inbox_v2_conversations_membership_head_constraint_trigger
after insert or update or delete on public.inbox_v2_conversations
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_conversation();

create constraint trigger inbox_v2_conversation_membership_heads_constraint_trigger
after insert or update or delete on public.inbox_v2_conversation_membership_heads
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_head();

create constraint trigger inbox_v2_conversation_membership_commits_constraint_trigger
after insert on public.inbox_v2_conversation_membership_commits
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_commit();

create constraint trigger inbox_v2_participant_membership_episodes_constraint_trigger
after insert or update on public.inbox_v2_participant_membership_episodes
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_episode();

create constraint trigger inbox_v2_participant_membership_transitions_constraint_trigger
after insert on public.inbox_v2_participant_membership_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_transition();

create constraint trigger inbox_v2_employees_internal_membership_constraint_trigger
after update on public.employees
deferrable initially deferred
for each row execute function public.inbox_v2_participant_membership_deferred_employee();
`;
