import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
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
  eventStore,
  files,
  inboxV2Conversations,
  normalizedInboundEvents,
  sourceAccounts,
  tenants
} from "../tables";
import {
  inboxV2SourceExternalIdentities,
  inboxV2SourceIdentityClaims
} from "./identity-foundation";
import {
  inboxV2ConversationParticipants,
  inboxV2ParticipantMembershipTransitions
} from "./participant-membership";
import { inboxV2SourceOccurrences } from "./source-occurrence";
import { inboxV2SourceThreadBindings } from "./source-thread-binding";
import {
  inboxV2WorkItemRelationTransitions,
  inboxV2WorkItemTransitions
} from "./work-item";

function inboxV2IdSql(column: SQLWrapper, prefix: string) {
  return sql`coalesce((char_length(${column}) <= 256
    and ${column} ~ ${sql.raw(
      `'^${prefix}:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    )}), false)`;
}

function inboxV2CatalogIdSql(column: SQLWrapper) {
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

function inboxV2RoutingTokenSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function inboxV2Sha256DigestSql(column: SQLWrapper) {
  return sql`coalesce((${column} ~ '^[a-f0-9]{64}$'), false)`;
}

export const inboxV2TimelineSubjectKind = pgEnum(
  "inbox_v2_timeline_subject_kind",
  [
    "message",
    "staff_note",
    "call",
    "review",
    "module_event",
    "participant_change",
    "work_change",
    "system_event"
  ]
);

export const inboxV2TimelineVisibility = pgEnum(
  "inbox_v2_timeline_visibility",
  [
    "conversation_external",
    "internal_participants",
    "staff_only",
    "workforce_metadata",
    "source_item_policy"
  ]
);

export const inboxV2TimelineActivityKind = pgEnum(
  "inbox_v2_timeline_activity_kind",
  ["eligible", "history_import", "migration", "non_activity"]
);

export const inboxV2AppActorKind = pgEnum("inbox_v2_app_actor_kind", [
  "employee",
  "trusted_service"
]);

export const inboxV2AutomationCausationKind = pgEnum(
  "inbox_v2_automation_causation_kind",
  ["employee_command", "system_event"]
);

export const inboxV2TimelineContentOwnerKind = pgEnum(
  "inbox_v2_timeline_content_owner_kind",
  ["message", "staff_note"]
);

export const inboxV2TimelineContentState = pgEnum(
  "inbox_v2_timeline_content_state",
  ["available", "privacy_erased", "retention_purged"]
);

export const inboxV2TimelineContentTransitionKind = pgEnum(
  "inbox_v2_timeline_content_transition_kind",
  [
    "created",
    "edit",
    "attachment_materialization",
    "privacy_erasure",
    "retention_purge"
  ]
);

export const inboxV2TimelineContentBlockKind = pgEnum(
  "inbox_v2_timeline_content_block_kind",
  [
    "text",
    "image",
    "audio",
    "video",
    "file",
    "sticker",
    "location",
    "contact",
    "unsupported_source_content",
    "extension"
  ]
);

export const inboxV2AttachmentMaterializationState = pgEnum(
  "inbox_v2_attachment_materialization_state",
  ["pending", "ready", "failed", "quarantined"]
);

export const inboxV2MessageOriginKind = pgEnum("inbox_v2_message_origin_kind", [
  "source_originated",
  "hulee_external",
  "internal",
  "migration"
]);

export const inboxV2MessageSourceDirection = pgEnum(
  "inbox_v2_message_source_direction",
  ["inbound", "outbound"]
);

export const inboxV2MessageLifecycle = pgEnum("inbox_v2_message_lifecycle", [
  "active",
  "local_delete_tombstone",
  "provider_delete_tombstone"
]);

export const inboxV2MessageReferenceKind = pgEnum(
  "inbox_v2_message_reference_kind",
  [
    "none",
    "reply_resolved_internal",
    "reply_resolved_external",
    "reply_unresolved_source",
    "forward_content_copy",
    "forward_provider_native",
    "forward_provider_observed"
  ]
);

export const inboxV2MessageRevisionChange = pgEnum(
  "inbox_v2_message_revision_change",
  [
    "created",
    "edited",
    "attachment_materialized",
    "local_delete_tombstone",
    "provider_delete_policy_tombstone",
    "privacy_erasure_tombstone",
    "retention_purge_tombstone"
  ]
);

export const inboxV2StaffNoteRevisionChange = pgEnum(
  "inbox_v2_staff_note_revision_change",
  [
    "created",
    "edited",
    "attachment_materialized",
    "privacy_erasure_tombstone",
    "retention_purge_tombstone"
  ]
);

export const inboxV2MessageReferenceContextKind = pgEnum(
  "inbox_v2_message_reference_context_kind",
  [
    "none",
    "reply",
    "forward_content_copy",
    "forward_provider_native",
    "forward_provider_observed"
  ]
);

export const inboxV2ProviderForwardProvenance = pgEnum(
  "inbox_v2_provider_forward_provenance",
  ["exact", "partial", "opaque"]
);

export const inboxV2MessageTransportLinkRole = pgEnum(
  "inbox_v2_message_transport_link_role",
  [
    "origin",
    "provider_echo",
    "provider_response",
    "native_outbound",
    "additional_artifact"
  ]
);

export const inboxV2OutboundRouteConsumerKind = pgEnum(
  "inbox_v2_outbound_route_consumer_kind",
  ["message_creation", "provider_lifecycle", "reaction"]
);

export const inboxV2ProviderLifecycleAction = pgEnum(
  "inbox_v2_provider_lifecycle_action",
  ["edit", "delete"]
);

export const inboxV2ProviderLifecycleOrigin = pgEnum(
  "inbox_v2_provider_lifecycle_origin",
  ["provider_observed", "hulee_requested"]
);

export const inboxV2ProviderLifecycleOutcome = pgEnum(
  "inbox_v2_provider_lifecycle_outcome",
  [
    "observed",
    "pending",
    "accepted",
    "confirmed",
    "failed",
    "unsupported",
    "outcome_unknown"
  ]
);

export const inboxV2ProviderDeleteLocalEffect = pgEnum(
  "inbox_v2_provider_delete_local_effect",
  ["not_evaluated", "retain_local", "tombstone_local"]
);

export const inboxV2ReactionActorKind = pgEnum("inbox_v2_reaction_actor_kind", [
  "participant",
  "unattributed_source_observation",
  "aggregate_only",
  "provider_system"
]);

export const inboxV2ReactionCapabilityKind = pgEnum(
  "inbox_v2_reaction_capability_kind",
  ["internal", "external"]
);

export const inboxV2ReactionCardinality = pgEnum(
  "inbox_v2_reaction_cardinality",
  ["single_value", "multiple_values", "aggregate_only"]
);

export const inboxV2ReactionValueKind = pgEnum("inbox_v2_reaction_value_kind", [
  "unicode",
  "provider_custom"
]);

export const inboxV2ReactionStateKind = pgEnum("inbox_v2_reaction_state_kind", [
  "active",
  "cleared",
  "pending_external",
  "external_terminal"
]);

export const inboxV2ReactionOperation = pgEnum("inbox_v2_reaction_operation", [
  "set",
  "replace",
  "clear"
]);

export const inboxV2ReactionTransitionMode = pgEnum(
  "inbox_v2_reaction_transition_mode",
  ["internal_apply", "external_request", "provider_observed", "provider_result"]
);

export const inboxV2DeliveryFact = pgEnum("inbox_v2_delivery_fact", [
  "accepted",
  "sent",
  "delivered",
  "failed"
]);

export const inboxV2DeliveryScopeKind = pgEnum("inbox_v2_delivery_scope_kind", [
  "dispatch",
  "external_reference",
  "recipient"
]);

export const inboxV2DeliveryEvidenceKind = pgEnum(
  "inbox_v2_delivery_evidence_kind",
  ["provider_result", "provider_artifact", "provider_event"]
);

export const inboxV2MessageTransportFactKind = pgEnum(
  "inbox_v2_message_transport_fact_kind",
  ["delivery", "receipt"]
);

export const inboxV2ReceiptTargetKind = pgEnum("inbox_v2_receipt_target_kind", [
  "exact_message",
  "provider_watermark",
  "thread_readmark"
]);

export const inboxV2ReceiptReaderKind = pgEnum("inbox_v2_receipt_reader_kind", [
  "source_external_identity",
  "aggregate_only"
]);

export const inboxV2TimelineWorkTransitionKind = pgEnum(
  "inbox_v2_timeline_work_transition_kind",
  ["work_item", "work_item_relation"]
);

/**
 * Immutable attribution used by Message/StaffNote revisions and authored
 * reaction/provider actions. It contains references only, never content.
 */
export const inboxV2ActionAttributions = pgTable(
  "inbox_v2_action_attributions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    actionParticipantId: text("action_participant_id"),
    appActorKind: inboxV2AppActorKind("app_actor_kind"),
    appActorEmployeeId: text("app_actor_employee_id"),
    appAuthorizationEpoch: text("app_authorization_epoch"),
    appTrustedServiceId: text("app_trusted_service_id"),
    sourceOccurrenceId: text("source_occurrence_id"),
    automationKind: inboxV2AutomationCausationKind("automation_kind"),
    automationCauseEventId: text("automation_cause_event_id"),
    automationCorrelationId: text("automation_correlation_id"),
    automationCausedAt: timestamp("automation_caused_at", {
      withTimezone: true,
      precision: 3
    }),
    automationInitiatingEmployeeId: text("automation_initiating_employee_id"),
    automationInitiatingAuthorizationEpoch: text(
      "automation_initiating_authorization_epoch"
    ),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_action_attributions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_action_attributions_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_participant_fk",
      columns: [
        table.tenantId,
        table.actionParticipantId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_employee_fk",
      columns: [table.tenantId, table.appActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_initiator_fk",
      columns: [table.tenantId, table.automationInitiatingEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_action_attributions_cause_event_fk",
      columns: [table.tenantId, table.automationCauseEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    unique("inbox_v2_action_attributions_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId
    ),
    check(
      "inbox_v2_action_attributions_actor_check",
      sql`num_nonnulls(${table.appActorKind}, ${table.sourceOccurrenceId}) = 1
        and (
          (${table.appActorKind} = 'employee'
            and ${table.appActorEmployeeId} is not null
            and ${table.appAuthorizationEpoch} is not null
            and ${table.appTrustedServiceId} is null
            and ${table.actionParticipantId} is not null
            and ${table.automationKind} is null)
          or (${table.appActorKind} = 'trusted_service'
            and ${table.appActorEmployeeId} is null
            and ${table.appAuthorizationEpoch} is null
            and ${table.appTrustedServiceId} is not null
            and ${table.automationKind} is not null)
          or (${table.appActorKind} is null
            and ${table.sourceOccurrenceId} is not null
            and ${table.automationKind} is null)
        )`
    ),
    check(
      "inbox_v2_action_attributions_automation_check",
      sql`(${table.automationKind} is null and num_nonnulls(
          ${table.automationCauseEventId}, ${table.automationCorrelationId},
          ${table.automationCausedAt}, ${table.automationInitiatingEmployeeId},
          ${table.automationInitiatingAuthorizationEpoch}
        ) = 0) or (
          ${table.automationKind} = 'system_event'
          and ${table.automationCauseEventId} is not null
          and ${table.automationCorrelationId} is not null
          and ${table.automationCausedAt} is not null
          and ${table.automationInitiatingEmployeeId} is null
          and ${table.automationInitiatingAuthorizationEpoch} is null
        ) or (
          ${table.automationKind} = 'employee_command'
          and num_nonnulls(
            ${table.automationCauseEventId}, ${table.automationCorrelationId},
            ${table.automationCausedAt}, ${table.automationInitiatingEmployeeId},
            ${table.automationInitiatingAuthorizationEpoch}
          ) = 5
        )`
    ),
    check(
      "inbox_v2_action_attributions_timestamp_check",
      sql`${inboxV2IdSql(table.id, "action_attribution")}
        and isfinite(${table.createdAt})
        and (${table.automationCausedAt} is null
          or (isfinite(${table.automationCausedAt})
            and ${table.automationCausedAt} <= ${table.createdAt}))`
    ),
    index("inbox_v2_action_attributions_conversation_created_idx").on(
      table.tenantId,
      table.conversationId,
      table.createdAt,
      table.id
    )
  ]
);

/** Identity anchor extended by MSG-003 with object/version lifecycle. */
export const inboxV2MessageAttachmentAnchors = pgTable(
  "inbox_v2_message_attachment_anchors",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_attachment_anchors_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_attachment_anchors_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_message_attachment_anchors_revision_check",
      sql`${inboxV2IdSql(table.id, "message_attachment")}
        and ${table.revision} >= 1`
    ),
    check(
      "inbox_v2_message_attachment_anchors_time_check",
      sql`isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_attachment_anchors_tenant_idx").on(
      table.tenantId,
      table.id
    )
  ]
);

export const inboxV2TimelineContents = pgTable(
  "inbox_v2_timeline_contents",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    ownerKind: inboxV2TimelineContentOwnerKind("owner_kind").notNull(),
    ownerId: text("owner_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    processingPurposeId: text("processing_purpose_id").notNull(),
    retentionAnchorAt: timestamp("retention_anchor_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    state: inboxV2TimelineContentState("state").notNull(),
    contentDigestSha256: text("content_digest_sha256"),
    tombstoneEventId: text("tombstone_event_id"),
    tombstoneReasonId: text("tombstone_reason_id"),
    retentionPolicyId: text("retention_policy_id"),
    retentionPolicyVersion: text("retention_policy_version"),
    retentionPolicyRevision: bigint("retention_policy_revision", {
      mode: "bigint"
    }),
    stateChangedAt: timestamp("state_changed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
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
      name: "inbox_v2_timeline_contents_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_contents_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_timeline_contents_tombstone_event_fk",
      columns: [table.tenantId, table.tombstoneEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    unique("inbox_v2_timeline_contents_owner_unique").on(
      table.tenantId,
      table.ownerKind,
      table.ownerId
    ),
    unique("inbox_v2_timeline_contents_head_unique").on(
      table.tenantId,
      table.id,
      table.revision,
      table.state
    ),
    check(
      "inbox_v2_timeline_contents_class_check",
      sql`${inboxV2CatalogIdSql(table.processingPurposeId)}
        and ((${table.ownerKind} = 'message'
          and ${table.dataClassId} = 'core:message_content_blocks')
        or (${table.ownerKind} = 'staff_note'
          and ${table.dataClassId} = 'core:staff_note_content_blocks'))`
    ),
    check(
      "inbox_v2_timeline_contents_state_check",
      sql`(
          ${table.state} = 'available'
          and ${table.contentDigestSha256} ~ '^[a-f0-9]{64}$'
          and num_nonnulls(
            ${table.tombstoneEventId}, ${table.tombstoneReasonId},
            ${table.retentionPolicyId}, ${table.retentionPolicyVersion},
            ${table.retentionPolicyRevision}
          ) = 0
        ) or (
          ${table.state} = 'privacy_erased'
          and ${table.contentDigestSha256} is null
          and ${table.tombstoneEventId} is not null
          and ${table.tombstoneReasonId} is not null
          and num_nonnulls(
            ${table.retentionPolicyId}, ${table.retentionPolicyVersion},
            ${table.retentionPolicyRevision}
          ) = 0
        ) or (
          ${table.state} = 'retention_purged'
          and ${table.contentDigestSha256} is null
          and ${table.tombstoneEventId} is not null
          and ${table.tombstoneReasonId} is null
          and num_nonnulls(
            ${table.retentionPolicyId}, ${table.retentionPolicyVersion},
            ${table.retentionPolicyRevision}
          ) = 3
          and ${table.retentionPolicyRevision} >= 1
        )`
    ),
    check(
      "inbox_v2_timeline_contents_clock_check",
      sql`${inboxV2IdSql(table.id, "timeline_content")}
        and ${table.revision} >= 1
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.retentionAnchorAt})
        and isfinite(${table.stateChangedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.stateChangedAt} <= ${table.updatedAt}
        and ${table.updatedAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_timeline_contents_retention_idx").on(
      table.tenantId,
      table.dataClassId,
      table.state,
      table.retentionAnchorAt,
      table.id
    ),
    index("inbox_v2_timeline_contents_retention_eligible_idx")
      .on(table.tenantId, table.dataClassId, table.retentionAnchorAt, table.id)
      .where(sql`${table.state} = 'available'`)
  ]
);

export const inboxV2TimelineContentRevisions = pgTable(
  "inbox_v2_timeline_content_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    contentId: text("content_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    expectedPreviousRevision: bigint("expected_previous_revision", {
      mode: "bigint"
    }),
    transitionKind:
      inboxV2TimelineContentTransitionKind("transition_kind").notNull(),
    state: inboxV2TimelineContentState("state").notNull(),
    eventId: text("event_id"),
    reasonId: text("reason_id"),
    retentionPolicyId: text("retention_policy_id"),
    retentionPolicyVersion: text("retention_policy_version"),
    retentionPolicyRevision: bigint("retention_policy_revision", {
      mode: "bigint"
    }),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_timeline_content_revisions_pk",
      columns: [table.tenantId, table.contentId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_revisions_content_fk",
      columns: [table.tenantId, table.contentId],
      foreignColumns: [
        inboxV2TimelineContents.tenantId,
        inboxV2TimelineContents.id
      ]
    }).onDelete("cascade"),
    uniqueIndex("inbox_v2_timeline_content_revisions_predecessor_unique")
      .on(table.tenantId, table.contentId, table.expectedPreviousRevision)
      .where(sql`${table.expectedPreviousRevision} is not null`),
    check(
      "inbox_v2_timeline_content_revisions_chain_check",
      sql`(${table.transitionKind} = 'created'
          and ${table.revision} = 1
          and ${table.expectedPreviousRevision} is null
          and ${table.state} = 'available')
        or (${table.transitionKind} <> 'created'
          and ${table.expectedPreviousRevision} is not null
          and ${table.revision} = ${table.expectedPreviousRevision} + 1)`
    ),
    check(
      "inbox_v2_timeline_content_revisions_time_check",
      sql`${table.recordedStreamPosition} >= 1
        and ${table.recordRevision} = 1
        and isfinite(${table.occurredAt})
        and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.occurredAt}`
    ),
    index("inbox_v2_timeline_content_revisions_time_idx").on(
      table.tenantId,
      table.contentId,
      table.recordedAt,
      table.revision
    )
  ]
);

/**
 * The only SQL row that carries Message/StaffNote text, caption, contact or
 * location values. Rows are independently purgeable while revision metadata
 * remains append-only.
 */
export const inboxV2TimelineContentPayloads = pgTable(
  "inbox_v2_timeline_content_payloads",
  {
    tenantId: text("tenant_id").notNull(),
    contentId: text("content_id").notNull(),
    contentRevision: bigint("content_revision", { mode: "bigint" }).notNull(),
    ordinal: smallint("ordinal").notNull(),
    blockKey: text("block_key").notNull(),
    kind: inboxV2TimelineContentBlockKind("kind").notNull(),
    textRole: text("text_role"),
    textValue: text("text_value"),
    language: text("language"),
    attachmentId: text("attachment_id"),
    attachmentState: inboxV2AttachmentMaterializationState("attachment_state"),
    attachmentFileId: text("attachment_file_id"),
    attachmentFailureReasonId: text("attachment_failure_reason_id"),
    displayName: text("display_name"),
    mediaSemantic: text("media_semantic"),
    latitude: numeric("latitude", { precision: 10, scale: 7 }),
    longitude: numeric("longitude", { precision: 10, scale: 7 }),
    accuracyMeters: numeric("accuracy_meters", { precision: 12, scale: 3 }),
    locationMode: text("location_mode"),
    liveUntil: timestamp("live_until", {
      withTimezone: true,
      precision: 3
    }),
    headingDegrees: numeric("heading_degrees", { precision: 6, scale: 3 }),
    locationLabel: text("location_label"),
    locationAddress: text("location_address"),
    contactDisplayName: text("contact_display_name"),
    contactOrganization: text("contact_organization"),
    unsupportedSourceOccurrenceId: text("unsupported_source_occurrence_id"),
    providerContentKindId: text("provider_content_kind_id"),
    safeFallbackReasonId: text("safe_fallback_reason_id"),
    extensionBlockKindId: text("extension_block_kind_id"),
    extensionPayloadSchemaId: text("extension_payload_schema_id"),
    extensionPayloadSchemaVersion: text("extension_payload_schema_version"),
    extensionPayloadFileId: text("extension_payload_file_id"),
    extensionPayloadDigestSha256: text("extension_payload_digest_sha256"),
    extensionRendererId: text("extension_renderer_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_timeline_content_payloads_pk",
      columns: [
        table.tenantId,
        table.contentId,
        table.contentRevision,
        table.ordinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_payloads_revision_fk",
      columns: [table.tenantId, table.contentId, table.contentRevision],
      foreignColumns: [
        inboxV2TimelineContentRevisions.tenantId,
        inboxV2TimelineContentRevisions.contentId,
        inboxV2TimelineContentRevisions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_timeline_content_payloads_attachment_fk",
      columns: [table.tenantId, table.attachmentId],
      foreignColumns: [
        inboxV2MessageAttachmentAnchors.tenantId,
        inboxV2MessageAttachmentAnchors.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_payloads_file_fk",
      columns: [table.tenantId, table.attachmentFileId],
      foreignColumns: [files.tenantId, files.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_payloads_extension_file_fk",
      columns: [table.tenantId, table.extensionPayloadFileId],
      foreignColumns: [files.tenantId, files.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_payloads_occurrence_fk",
      columns: [table.tenantId, table.unsupportedSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_timeline_content_payloads_block_key_unique").on(
      table.tenantId,
      table.contentId,
      table.contentRevision,
      table.blockKey
    ),
    check(
      "inbox_v2_timeline_content_payloads_ordinal_check",
      sql`${table.ordinal} between 0 and 63`
    ),
    check(
      "inbox_v2_timeline_content_payloads_text_bounds_check",
      sql`(${table.textValue} is null or char_length(${table.textValue}) between 1 and 100000)
        and (${table.displayName} is null or char_length(${table.displayName}) between 1 and 512)
        and (${table.locationLabel} is null or char_length(${table.locationLabel}) between 1 and 512)
        and (${table.locationAddress} is null or char_length(${table.locationAddress}) between 1 and 2000)
        and (${table.contactDisplayName} is null or char_length(${table.contactDisplayName}) between 1 and 512)`
    ),
    check(
      "inbox_v2_timeline_content_payloads_shape_check",
      sql`(
          ${table.kind} = 'text'
          and ${table.textRole} in ('body', 'caption')
          and ${table.textValue} is not null
        ) or (
          ${table.kind} in ('image', 'audio', 'video', 'file', 'sticker')
          and ${table.attachmentId} is not null
          and ${table.attachmentState} is not null
          and (${table.attachmentState} <> 'ready' or ${table.attachmentFileId} is not null)
          and (${table.attachmentState} not in ('failed', 'quarantined')
            or ${table.attachmentFailureReasonId} is not null)
          and (${table.kind} <> 'audio' or ${table.mediaSemantic} in ('audio', 'voice'))
          and (${table.kind} <> 'video' or ${table.mediaSemantic} in ('video', 'video_note'))
        ) or (
          ${table.kind} = 'location'
          and ${table.latitude} between -90 and 90
          and ${table.longitude} between -180 and 180
          and ${table.locationMode} in ('static', 'live')
          and ((${table.locationMode} = 'live') = (${table.liveUntil} is not null))
        ) or (
          ${table.kind} = 'contact'
          and ${table.contactDisplayName} is not null
        ) or (
          ${table.kind} = 'unsupported_source_content'
          and num_nonnulls(
            ${table.unsupportedSourceOccurrenceId},
            ${table.providerContentKindId},
            ${table.safeFallbackReasonId}
          ) = 3
        ) or (
          ${table.kind} = 'extension'
          and num_nonnulls(
            ${table.extensionBlockKindId}, ${table.extensionPayloadSchemaId},
            ${table.extensionPayloadSchemaVersion},
            ${table.extensionPayloadFileId},
            ${table.extensionPayloadDigestSha256},
            ${table.extensionRendererId}
          ) = 6
          and ${table.extensionPayloadDigestSha256} ~ '^[a-f0-9]{64}$'
        )`
    ),
    check(
      "inbox_v2_timeline_content_payloads_created_check",
      sql`isfinite(${table.createdAt})`
    ),
    index("inbox_v2_timeline_content_payloads_attachment_idx").on(
      table.tenantId,
      table.attachmentId,
      table.contentId
    )
  ]
);

export const inboxV2TimelineContentContactValues = pgTable(
  "inbox_v2_timeline_content_contact_values",
  {
    tenantId: text("tenant_id").notNull(),
    contentId: text("content_id").notNull(),
    contentRevision: bigint("content_revision", { mode: "bigint" }).notNull(),
    blockOrdinal: smallint("block_ordinal").notNull(),
    valueOrdinal: smallint("value_ordinal").notNull(),
    kind: text("kind").notNull(),
    value: text("value").notNull(),
    label: text("label")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_timeline_content_contact_values_pk",
      columns: [
        table.tenantId,
        table.contentId,
        table.contentRevision,
        table.blockOrdinal,
        table.valueOrdinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_content_contact_values_payload_fk",
      columns: [
        table.tenantId,
        table.contentId,
        table.contentRevision,
        table.blockOrdinal
      ],
      foreignColumns: [
        inboxV2TimelineContentPayloads.tenantId,
        inboxV2TimelineContentPayloads.contentId,
        inboxV2TimelineContentPayloads.contentRevision,
        inboxV2TimelineContentPayloads.ordinal
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_timeline_content_contact_values_shape_check",
      sql`${table.kind} in ('phone', 'email', 'url', 'other')
        and ${table.valueOrdinal} between 0 and 63
        and char_length(${table.value}) between 1 and 2000`
    ),
    index("inbox_v2_timeline_content_contact_values_tenant_idx").on(
      table.tenantId,
      table.contentId,
      table.contentRevision,
      table.blockOrdinal
    )
  ]
);

/** Ordered envelope; subject payload belongs to its typed table. */
export const inboxV2TimelineItems = pgTable(
  "inbox_v2_timeline_items",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineSequence: bigint("timeline_sequence", { mode: "bigint" }).notNull(),
    subjectKind: inboxV2TimelineSubjectKind("subject_kind").notNull(),
    subjectId: text("subject_id").notNull(),
    visibility: inboxV2TimelineVisibility("visibility").notNull(),
    activityKind: inboxV2TimelineActivityKind("activity_kind").notNull(),
    activitySourceOccurrenceId: text("activity_source_occurrence_id"),
    activityReasonId: text("activity_reason_id"),
    migrationProvenanceId: text("migration_provenance_id"),
    activityImportedAt: timestamp("activity_imported_at", {
      withTimezone: true,
      precision: 3
    }),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    receivedAt: timestamp("received_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
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
      name: "inbox_v2_timeline_items_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_items_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_timeline_items_conversation_fk",
      columns: [table.tenantId, table.conversationId],
      foreignColumns: [inboxV2Conversations.tenantId, inboxV2Conversations.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_items_activity_occurrence_fk",
      columns: [table.tenantId, table.activitySourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_timeline_items_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId
    ),
    unique("inbox_v2_timeline_items_revision_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.revision
    ),
    unique("inbox_v2_timeline_items_subject_unique").on(
      table.tenantId,
      table.id,
      table.subjectKind
    ),
    unique("inbox_v2_timeline_items_sequence_unique").on(
      table.tenantId,
      table.conversationId,
      table.timelineSequence
    ),
    check(
      "inbox_v2_timeline_items_activity_check",
      sql`(
          ${table.activityKind} = 'eligible'
          and num_nonnulls(
            ${table.activitySourceOccurrenceId}, ${table.activityReasonId},
            ${table.migrationProvenanceId}, ${table.activityImportedAt}
          ) = 0
        ) or (
          ${table.activityKind} = 'history_import'
          and ${table.activitySourceOccurrenceId} is not null
          and ${table.activityImportedAt} is not null
          and num_nonnulls(${table.activityReasonId}, ${table.migrationProvenanceId}) = 0
        ) or (
          ${table.activityKind} = 'migration'
          and ${table.migrationProvenanceId} is not null
          and ${table.activityImportedAt} is not null
          and num_nonnulls(${table.activitySourceOccurrenceId}, ${table.activityReasonId}) = 0
        ) or (
          ${table.activityKind} = 'non_activity'
          and ${table.activityReasonId} is not null
          and num_nonnulls(
            ${table.activitySourceOccurrenceId}, ${table.migrationProvenanceId},
            ${table.activityImportedAt}
          ) = 0
        )`
    ),
    check(
      "inbox_v2_timeline_items_visibility_check",
      sql`(${table.subjectKind} = 'message'
          and ${table.visibility} in ('conversation_external', 'internal_participants'))
        or (${table.subjectKind} = 'staff_note' and ${table.visibility} = 'staff_only')
        or (${table.subjectKind} in ('participant_change', 'work_change', 'system_event')
          and ${table.visibility} = 'workforce_metadata')
        or (${table.subjectKind} in ('call', 'review', 'module_event')
          and ${table.visibility} = 'source_item_policy')`
    ),
    check(
      "inbox_v2_timeline_items_clock_check",
      sql`${inboxV2IdSql(table.id, "timeline_item")}
        and ${table.timelineSequence} >= 1
        and ${table.revision} >= 1
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.occurredAt})
        and isfinite(${table.receivedAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.occurredAt} <= ${table.receivedAt}
        and ${table.receivedAt} <= ${table.createdAt}
        and ${table.createdAt} <= ${table.updatedAt}
        and (${table.subjectKind} in ('message', 'staff_note') or ${table.revision} = 1)`
    ),
    index("inbox_v2_timeline_items_conversation_sequence_idx").on(
      table.tenantId,
      table.conversationId,
      table.timelineSequence.desc()
    ),
    index("inbox_v2_timeline_items_stream_idx").on(
      table.tenantId,
      table.lastChangedStreamPosition,
      table.id
    )
  ]
);

/** Exact typed payload for immutable non-communication Timeline subjects. */
export const inboxV2TimelineSubjectDetails = pgTable(
  "inbox_v2_timeline_subject_details",
  {
    tenantId: text("tenant_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    subjectKind: inboxV2TimelineSubjectKind("subject_kind").notNull(),
    sourceObjectId: text("source_object_id"),
    sourceObjectKindId: text("source_object_kind_id"),
    sourceObjectRevision: bigint("source_object_revision", { mode: "bigint" }),
    normalizedSourceEventId: text("normalized_source_event_id"),
    actorParticipantId: text("actor_participant_id"),
    moduleItemKindId: text("module_item_kind_id"),
    participantTransitionId: text("participant_transition_id"),
    workTransitionKind: inboxV2TimelineWorkTransitionKind(
      "work_transition_kind"
    ),
    workItemTransitionId: text("work_item_transition_id"),
    workItemRelationTransitionId: text("work_item_relation_transition_id"),
    systemEventId: text("system_event_id"),
    systemActorId: text("system_actor_id"),
    systemAppActorKind: inboxV2AppActorKind("system_app_actor_kind"),
    systemAppActorEmployeeId: text("system_app_actor_employee_id"),
    systemAppAuthorizationEpoch: text("system_app_authorization_epoch"),
    systemAppTrustedServiceId: text("system_app_trusted_service_id"),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_timeline_subject_details_pk",
      columns: [table.tenantId, table.timelineItemId]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_timeline_fk",
      columns: [table.tenantId, table.timelineItemId, table.subjectKind],
      foreignColumns: [
        inboxV2TimelineItems.tenantId,
        inboxV2TimelineItems.id,
        inboxV2TimelineItems.subjectKind
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_event_fk",
      columns: [table.tenantId, table.normalizedSourceEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_participant_fk",
      columns: [table.tenantId, table.actorParticipantId],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_membership_fk",
      columns: [table.tenantId, table.participantTransitionId],
      foreignColumns: [
        inboxV2ParticipantMembershipTransitions.tenantId,
        inboxV2ParticipantMembershipTransitions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_work_item_fk",
      columns: [table.tenantId, table.workItemTransitionId],
      foreignColumns: [
        inboxV2WorkItemTransitions.tenantId,
        inboxV2WorkItemTransitions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_work_relation_fk",
      columns: [table.tenantId, table.workItemRelationTransitionId],
      foreignColumns: [
        inboxV2WorkItemRelationTransitions.tenantId,
        inboxV2WorkItemRelationTransitions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_system_event_fk",
      columns: [table.tenantId, table.systemEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    foreignKey({
      name: "inbox_v2_timeline_subject_details_employee_fk",
      columns: [table.tenantId, table.systemAppActorEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    check(
      "inbox_v2_timeline_subject_details_shape_check",
      sql`(${table.subjectKind} = 'call'
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}
          ) = 3
          and num_nonnulls(
            ${table.moduleItemKindId}, ${table.participantTransitionId},
            ${table.workTransitionKind}, ${table.workItemTransitionId},
            ${table.workItemRelationTransitionId}, ${table.systemEventId},
            ${table.systemActorId}, ${table.systemAppActorKind},
            ${table.systemAppActorEmployeeId},
            ${table.systemAppAuthorizationEpoch},
            ${table.systemAppTrustedServiceId}
          ) = 0)
        or (${table.subjectKind} = 'review'
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}, ${table.actorParticipantId}
          ) = 4
          and num_nonnulls(
            ${table.moduleItemKindId}, ${table.participantTransitionId},
            ${table.workTransitionKind}, ${table.workItemTransitionId},
            ${table.workItemRelationTransitionId}, ${table.systemEventId},
            ${table.systemActorId}, ${table.systemAppActorKind},
            ${table.systemAppActorEmployeeId},
            ${table.systemAppAuthorizationEpoch},
            ${table.systemAppTrustedServiceId}
          ) = 0)
        or (${table.subjectKind} = 'module_event'
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}, ${table.moduleItemKindId}
          ) = 4
          and num_nonnulls(
            ${table.participantTransitionId}, ${table.workTransitionKind},
            ${table.workItemTransitionId},
            ${table.workItemRelationTransitionId}, ${table.systemEventId},
            ${table.systemActorId}, ${table.systemAppActorKind},
            ${table.systemAppActorEmployeeId},
            ${table.systemAppAuthorizationEpoch},
            ${table.systemAppTrustedServiceId}
          ) = 0)
        or (${table.subjectKind} = 'participant_change'
          and ${table.participantTransitionId} is not null
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}, ${table.normalizedSourceEventId},
            ${table.actorParticipantId}, ${table.moduleItemKindId},
            ${table.workTransitionKind}, ${table.workItemTransitionId},
            ${table.workItemRelationTransitionId}, ${table.systemEventId},
            ${table.systemActorId}, ${table.systemAppActorKind},
            ${table.systemAppActorEmployeeId},
            ${table.systemAppAuthorizationEpoch},
            ${table.systemAppTrustedServiceId}
          ) = 0)
        or (${table.subjectKind} = 'work_change'
          and ${table.workTransitionKind} is not null
          and ((${table.workTransitionKind} = 'work_item'
            and ${table.workItemTransitionId} is not null
            and ${table.workItemRelationTransitionId} is null)
          or (${table.workTransitionKind} = 'work_item_relation'
            and ${table.workItemTransitionId} is null
            and ${table.workItemRelationTransitionId} is not null))
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}, ${table.normalizedSourceEventId},
            ${table.actorParticipantId}, ${table.moduleItemKindId},
            ${table.participantTransitionId}, ${table.systemEventId},
            ${table.systemActorId}, ${table.systemAppActorKind},
            ${table.systemAppActorEmployeeId},
            ${table.systemAppAuthorizationEpoch},
            ${table.systemAppTrustedServiceId}
          ) = 0)
        or (${table.subjectKind} = 'system_event'
          and ${table.systemEventId} is not null
          and ${table.systemActorId} is not null
          and (
            ${table.systemAppActorKind} is null
            or (${table.systemAppActorKind} = 'employee'
              and ${table.systemAppActorEmployeeId} is not null
              and ${table.systemAppAuthorizationEpoch} is not null
              and ${table.systemAppTrustedServiceId} is null)
            or (${table.systemAppActorKind} = 'trusted_service'
              and ${table.systemAppActorEmployeeId} is null
              and ${table.systemAppAuthorizationEpoch} is null
              and ${table.systemAppTrustedServiceId} is not null)
          )
          and num_nonnulls(
            ${table.sourceObjectId}, ${table.sourceObjectKindId},
            ${table.sourceObjectRevision}, ${table.normalizedSourceEventId},
            ${table.actorParticipantId}, ${table.moduleItemKindId},
            ${table.participantTransitionId}, ${table.workTransitionKind},
            ${table.workItemTransitionId}, ${table.workItemRelationTransitionId}
          ) = 0)`
    ),
    check(
      "inbox_v2_timeline_subject_details_clock_check",
      sql`${table.recordRevision} = 1
        and (${table.sourceObjectRevision} is null
          or ${table.sourceObjectRevision} >= 1)
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_timeline_subject_details_tenant_idx").on(
      table.tenantId,
      table.timelineItemId
    )
  ]
);

export const inboxV2Messages = pgTable(
  "inbox_v2_messages",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    authorParticipantId: text("author_participant_id").notNull(),
    originKind: inboxV2MessageOriginKind("origin_kind").notNull(),
    originSourceOccurrenceId: text("origin_source_occurrence_id"),
    originSourceDirection: inboxV2MessageSourceDirection(
      "origin_source_direction"
    ),
    claimAtOccurrenceId: text("claim_at_occurrence_id"),
    claimAtOccurrenceVersion: bigint("claim_at_occurrence_version", {
      mode: "bigint"
    }),
    claimResolvedEmployeeId: text("claim_resolved_employee_id"),
    originOutboundRouteId: text("origin_outbound_route_id"),
    migrationProvenanceId: text("migration_provenance_id"),
    creationAttributionId: text("creation_attribution_id").notNull(),
    contentId: text("content_id").notNull(),
    contentRevision: bigint("content_revision", { mode: "bigint" }).notNull(),
    contentState: inboxV2TimelineContentState("content_state").notNull(),
    referenceKind: inboxV2MessageReferenceKind("reference_kind").notNull(),
    lifecycle: inboxV2MessageLifecycle("lifecycle").notNull(),
    lifecycleRevisionId: text("lifecycle_revision_id"),
    lifecycleReasonId: text("lifecycle_reason_id"),
    lifecycleProviderOperationId: text("lifecycle_provider_operation_id"),
    lifecyclePolicyReasonId: text("lifecycle_policy_reason_id"),
    lifecycleChangedAt: timestamp("lifecycle_changed_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
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
      name: "inbox_v2_messages_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_messages_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_messages_timeline_fk",
      columns: [table.tenantId, table.timelineItemId, table.conversationId],
      foreignColumns: [
        inboxV2TimelineItems.tenantId,
        inboxV2TimelineItems.id,
        inboxV2TimelineItems.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_messages_author_fk",
      columns: [
        table.tenantId,
        table.authorParticipantId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_messages_origin_occurrence_fk",
      columns: [table.tenantId, table.originSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_messages_claim_fk",
      columns: [table.tenantId, table.claimAtOccurrenceId],
      foreignColumns: [
        inboxV2SourceIdentityClaims.tenantId,
        inboxV2SourceIdentityClaims.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_messages_claim_employee_fk",
      columns: [table.tenantId, table.claimResolvedEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_messages_attribution_fk",
      columns: [
        table.tenantId,
        table.creationAttributionId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id,
        inboxV2ActionAttributions.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_messages_content_fk",
      columns: [
        table.tenantId,
        table.contentId,
        table.contentRevision,
        table.contentState
      ],
      foreignColumns: [
        inboxV2TimelineContents.tenantId,
        inboxV2TimelineContents.id,
        inboxV2TimelineContents.revision,
        inboxV2TimelineContents.state
      ]
    }),
    unique("inbox_v2_messages_timeline_unique").on(
      table.tenantId,
      table.timelineItemId
    ),
    unique("inbox_v2_messages_content_unique").on(
      table.tenantId,
      table.contentId
    ),
    unique("inbox_v2_messages_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.timelineItemId
    ),
    unique("inbox_v2_messages_revision_unique").on(
      table.tenantId,
      table.id,
      table.timelineItemId,
      table.revision
    ),
    check(
      "inbox_v2_messages_origin_check",
      sql`(
          ${table.originKind} = 'source_originated'
          and ${table.originSourceOccurrenceId} is not null
          and ${table.originSourceDirection} is not null
          and ${table.originOutboundRouteId} is null
          and ${table.migrationProvenanceId} is null
          and (
            num_nonnulls(
              ${table.claimAtOccurrenceId}, ${table.claimAtOccurrenceVersion},
              ${table.claimResolvedEmployeeId}
            ) = 0
            or num_nonnulls(
              ${table.claimAtOccurrenceId}, ${table.claimAtOccurrenceVersion},
              ${table.claimResolvedEmployeeId}
            ) = 3
          )
        ) or (
          ${table.originKind} = 'hulee_external'
          and ${table.originOutboundRouteId} is not null
          and num_nonnulls(
            ${table.originSourceOccurrenceId}, ${table.originSourceDirection},
            ${table.claimAtOccurrenceId}, ${table.claimAtOccurrenceVersion},
            ${table.claimResolvedEmployeeId}, ${table.migrationProvenanceId}
          ) = 0
        ) or (
          ${table.originKind} = 'internal'
          and num_nonnulls(
            ${table.originSourceOccurrenceId}, ${table.originSourceDirection},
            ${table.claimAtOccurrenceId}, ${table.claimAtOccurrenceVersion},
            ${table.claimResolvedEmployeeId}, ${table.originOutboundRouteId},
            ${table.migrationProvenanceId}
          ) = 0
        ) or (
          ${table.originKind} = 'migration'
          and ${table.migrationProvenanceId} is not null
          and num_nonnulls(
            ${table.originSourceOccurrenceId}, ${table.originSourceDirection},
            ${table.claimAtOccurrenceId}, ${table.claimAtOccurrenceVersion},
            ${table.claimResolvedEmployeeId}, ${table.originOutboundRouteId}
          ) = 0
        )`
    ),
    check(
      "inbox_v2_messages_lifecycle_check",
      sql`(${table.lifecycle} = 'active'
          and num_nonnulls(
            ${table.lifecycleRevisionId}, ${table.lifecycleReasonId},
            ${table.lifecycleProviderOperationId},
            ${table.lifecyclePolicyReasonId}, ${table.lifecycleChangedAt}
          ) = 0)
        or (${table.lifecycle} = 'local_delete_tombstone'
          and num_nonnulls(
            ${table.lifecycleRevisionId}, ${table.lifecycleReasonId},
            ${table.lifecycleChangedAt}
          ) = 3
          and num_nonnulls(
            ${table.lifecycleProviderOperationId}, ${table.lifecyclePolicyReasonId}
          ) = 0)
        or (${table.lifecycle} = 'provider_delete_tombstone'
          and num_nonnulls(
            ${table.lifecycleRevisionId}, ${table.lifecycleProviderOperationId},
            ${table.lifecyclePolicyReasonId}, ${table.lifecycleChangedAt}
          ) = 4
          and ${table.lifecycleReasonId} is null)`
    ),
    check(
      "inbox_v2_messages_clock_check",
      sql`${inboxV2IdSql(table.id, "message")}
        and ${table.revision} >= 1
        and ${table.contentRevision} >= 1
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.revision} <> 1 or (
          ${table.lifecycle} = 'active'
          and ${table.contentState} = 'available'
          and ${table.createdAt} = ${table.updatedAt}
        ))`
    ),
    index("inbox_v2_messages_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.timelineItemId
    ),
    index("inbox_v2_messages_stream_idx").on(
      table.tenantId,
      table.lastChangedStreamPosition,
      table.id
    )
  ]
);

export const inboxV2MessageRevisions = pgTable(
  "inbox_v2_message_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    expectedPreviousRevision: bigint("expected_previous_revision", {
      mode: "bigint"
    }),
    messageRevision: bigint("message_revision", { mode: "bigint" }).notNull(),
    changeKind: inboxV2MessageRevisionChange("change_kind").notNull(),
    beforeContentId: text("before_content_id"),
    beforeContentRevision: bigint("before_content_revision", {
      mode: "bigint"
    }),
    beforeContentState: inboxV2TimelineContentState("before_content_state"),
    afterContentId: text("after_content_id"),
    afterContentRevision: bigint("after_content_revision", {
      mode: "bigint"
    }),
    afterContentState: inboxV2TimelineContentState("after_content_state"),
    providerOperationId: text("provider_operation_id"),
    reasonId: text("reason_id"),
    actionAttributionId: text("action_attribution_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_revisions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_revisions_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_revisions_timeline_fk",
      columns: [table.tenantId, table.timelineItemId],
      foreignColumns: [inboxV2TimelineItems.tenantId, inboxV2TimelineItems.id]
    }),
    foreignKey({
      name: "inbox_v2_message_revisions_attribution_fk",
      columns: [table.tenantId, table.actionAttributionId],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_revisions_before_content_fk",
      columns: [
        table.tenantId,
        table.beforeContentId,
        table.beforeContentRevision
      ],
      foreignColumns: [
        inboxV2TimelineContentRevisions.tenantId,
        inboxV2TimelineContentRevisions.contentId,
        inboxV2TimelineContentRevisions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_revisions_after_content_fk",
      columns: [
        table.tenantId,
        table.afterContentId,
        table.afterContentRevision
      ],
      foreignColumns: [
        inboxV2TimelineContentRevisions.tenantId,
        inboxV2TimelineContentRevisions.contentId,
        inboxV2TimelineContentRevisions.revision
      ]
    }),
    unique("inbox_v2_message_revisions_message_revision_unique").on(
      table.tenantId,
      table.messageId,
      table.messageRevision
    ),
    unique("inbox_v2_message_revisions_attribution_unique").on(
      table.tenantId,
      table.actionAttributionId
    ),
    uniqueIndex("inbox_v2_message_revisions_predecessor_unique")
      .on(table.tenantId, table.messageId, table.expectedPreviousRevision)
      .where(sql`${table.expectedPreviousRevision} is not null`),
    check(
      "inbox_v2_message_revisions_chain_check",
      sql`(${table.changeKind} = 'created'
          and ${table.messageRevision} = 1
          and ${table.expectedPreviousRevision} is null)
        or (${table.changeKind} <> 'created'
          and ${table.expectedPreviousRevision} is not null
          and ${table.messageRevision} = ${table.expectedPreviousRevision} + 1)`
    ),
    check(
      "inbox_v2_message_revisions_content_check",
      sql`(${table.changeKind} in (
          'created', 'edited', 'attachment_materialized',
          'privacy_erasure_tombstone', 'retention_purge_tombstone'
        ) and ${table.afterContentId} is not null
          and ${table.afterContentRevision} is not null
          and ${table.afterContentState} is not null)
        or (${table.changeKind} in (
          'local_delete_tombstone', 'provider_delete_policy_tombstone'
        ) and num_nonnulls(
          ${table.beforeContentId}, ${table.beforeContentRevision},
          ${table.beforeContentState}, ${table.afterContentId},
          ${table.afterContentRevision}, ${table.afterContentState}
        ) = 0)`
    ),
    check(
      "inbox_v2_message_revisions_clock_check",
      sql`${inboxV2IdSql(table.id, "message_revision")}
        and ${table.recordedStreamPosition} >= 1
        and ${table.recordRevision} = 1
        and isfinite(${table.occurredAt})
        and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.occurredAt}`
    ),
    index("inbox_v2_message_revisions_page_idx").on(
      table.tenantId,
      table.messageId,
      table.messageRevision,
      table.id
    )
  ]
);

/** Typed, non-content envelope for reply/forward provenance. */
export const inboxV2MessageReferenceContexts = pgTable(
  "inbox_v2_message_reference_contexts",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    kind: inboxV2MessageReferenceContextKind("kind").notNull(),
    originSourceOccurrenceId: text("origin_source_occurrence_id"),
    provenanceCompleteness: inboxV2ProviderForwardProvenance(
      "provenance_completeness"
    ),
    nativeCapabilityId: text("native_capability_id"),
    nativeCapabilityRevision: bigint("native_capability_revision", {
      mode: "bigint"
    }),
    nativeAdapterContractId: text("native_adapter_contract_id"),
    nativeAdapterContractVersion: text("native_adapter_contract_version"),
    nativeAdapterDeclarationRevision: bigint(
      "native_adapter_declaration_revision",
      { mode: "bigint" }
    ),
    nativeAdapterSurfaceId: text("native_adapter_surface_id"),
    nativeAdapterLoadedByTrustedServiceId: text(
      "native_adapter_loaded_by_trusted_service_id"
    ),
    nativeAdapterLoadedAt: timestamp("native_adapter_loaded_at", {
      withTimezone: true,
      precision: 3
    }),
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
      name: "inbox_v2_message_reference_contexts_pk",
      columns: [table.tenantId, table.messageId]
    }),
    foreignKey({
      name: "inbox_v2_message_reference_contexts_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reference_contexts_origin_fk",
      columns: [table.tenantId, table.originSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    check(
      "inbox_v2_message_reference_contexts_shape_check",
      sql`(${table.kind} in ('none', 'reply', 'forward_content_copy')
          and num_nonnulls(
            ${table.originSourceOccurrenceId}, ${table.provenanceCompleteness},
            ${table.nativeCapabilityId}, ${table.nativeCapabilityRevision},
            ${table.nativeAdapterContractId},
            ${table.nativeAdapterContractVersion},
            ${table.nativeAdapterDeclarationRevision},
            ${table.nativeAdapterSurfaceId},
            ${table.nativeAdapterLoadedByTrustedServiceId},
            ${table.nativeAdapterLoadedAt}
          ) = 0)
        or (${table.kind} = 'forward_provider_native'
          and num_nonnulls(
            ${table.nativeCapabilityId}, ${table.nativeCapabilityRevision},
            ${table.nativeAdapterContractId},
            ${table.nativeAdapterContractVersion},
            ${table.nativeAdapterDeclarationRevision},
            ${table.nativeAdapterSurfaceId},
            ${table.nativeAdapterLoadedByTrustedServiceId},
            ${table.nativeAdapterLoadedAt}
          ) = 8
          and ${table.nativeCapabilityRevision} >= 1
          and ${table.nativeAdapterDeclarationRevision} >= 1
          and isfinite(${table.nativeAdapterLoadedAt})
          and ${table.originSourceOccurrenceId} is null
          and ${table.provenanceCompleteness} is null)
        or (${table.kind} = 'forward_provider_observed'
          and ${table.originSourceOccurrenceId} is not null
          and ${table.provenanceCompleteness} is not null
          and num_nonnulls(
            ${table.nativeCapabilityId}, ${table.nativeCapabilityRevision},
            ${table.nativeAdapterContractId},
            ${table.nativeAdapterContractVersion},
            ${table.nativeAdapterDeclarationRevision},
            ${table.nativeAdapterSurfaceId},
            ${table.nativeAdapterLoadedByTrustedServiceId},
            ${table.nativeAdapterLoadedAt}
          ) = 0)`
    ),
    check(
      "inbox_v2_message_reference_contexts_record_check",
      sql`${table.revision} = 1 and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_reference_contexts_tenant_idx").on(
      table.tenantId,
      table.messageId
    )
  ]
);

export const inboxV2MessageReferenceCanonicalTargets = pgTable(
  "inbox_v2_message_reference_canonical_targets",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    targetMessageId: text("target_message_id").notNull(),
    targetTimelineItemId: text("target_timeline_item_id").notNull(),
    targetMessageRevision: bigint("target_message_revision", {
      mode: "bigint"
    }).notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reference_canonical_targets_pk",
      columns: [table.tenantId, table.messageId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_message_reference_canonical_targets_context_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [
        inboxV2MessageReferenceContexts.tenantId,
        inboxV2MessageReferenceContexts.messageId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reference_canonical_targets_target_fk",
      columns: [
        table.tenantId,
        table.targetMessageId,
        table.targetTimelineItemId,
        table.targetMessageRevision
      ],
      foreignColumns: [
        inboxV2Messages.tenantId,
        inboxV2Messages.id,
        inboxV2Messages.timelineItemId,
        inboxV2Messages.revision
      ]
    }),
    unique("inbox_v2_message_reference_canonical_targets_unique").on(
      table.tenantId,
      table.messageId,
      table.targetMessageId,
      table.targetTimelineItemId
    ),
    check(
      "inbox_v2_message_reference_canonical_targets_check",
      sql`${table.ordinal} between 0 and 31
        and ${table.targetMessageRevision} >= 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_reference_canonical_targets_tenant_idx").on(
      table.tenantId,
      table.messageId,
      table.ordinal
    )
  ]
);

export const inboxV2MessageReferenceExternalTargets = pgTable(
  "inbox_v2_message_reference_external_targets",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reference_external_targets_pk",
      columns: [table.tenantId, table.messageId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_message_reference_external_targets_context_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [
        inboxV2MessageReferenceContexts.tenantId,
        inboxV2MessageReferenceContexts.messageId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reference_external_targets_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_message_reference_external_targets_unique").on(
      table.tenantId,
      table.messageId,
      table.externalMessageReferenceId,
      table.sourceOccurrenceId
    ),
    check(
      "inbox_v2_message_reference_external_targets_check",
      sql`${table.ordinal} between 0 and 31 and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_reference_external_targets_tenant_idx").on(
      table.tenantId,
      table.messageId,
      table.ordinal
    )
  ]
);

export const inboxV2MessageReferenceUnresolvedTargets = pgTable(
  "inbox_v2_message_reference_unresolved_targets",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    externalMessageKeyDigestSha256: text(
      "external_message_key_digest_sha256"
    ).notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    resolutionState: text("resolution_state").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reference_unresolved_targets_pk",
      columns: [table.tenantId, table.messageId]
    }),
    foreignKey({
      name: "inbox_v2_message_reference_unresolved_targets_context_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [
        inboxV2MessageReferenceContexts.tenantId,
        inboxV2MessageReferenceContexts.messageId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reference_unresolved_targets_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    check(
      "inbox_v2_message_reference_unresolved_targets_check",
      sql`${table.externalMessageKeyDigestSha256} ~ '^[a-f0-9]{64}$'
        and ${table.resolutionState} in ('pending', 'conflicted')
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_reference_unresolved_targets_tenant_idx").on(
      table.tenantId,
      table.messageId
    )
  ]
);

export const inboxV2MessageReferenceUnresolvedCandidates = pgTable(
  "inbox_v2_message_reference_unresolved_candidates",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reference_unresolved_candidates_pk",
      columns: [table.tenantId, table.messageId, table.ordinal]
    }),
    foreignKey({
      name: "inbox_v2_message_reference_unresolved_candidates_target_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [
        inboxV2MessageReferenceUnresolvedTargets.tenantId,
        inboxV2MessageReferenceUnresolvedTargets.messageId
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_message_reference_unresolved_candidates_unique").on(
      table.tenantId,
      table.messageId,
      table.externalMessageReferenceId
    ),
    check(
      "inbox_v2_message_reference_unresolved_candidates_check",
      sql`${table.ordinal} between 0 and 99 and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_message_reference_unresolved_candidates_tenant_idx").on(
      table.tenantId,
      table.messageId,
      table.ordinal
    )
  ]
);

/** Staff-only timeline subject. It deliberately has no transport columns. */
export const inboxV2StaffNotes = pgTable(
  "inbox_v2_staff_notes",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    authorParticipantId: text("author_participant_id").notNull(),
    creationAttributionId: text("creation_attribution_id").notNull(),
    contentId: text("content_id").notNull(),
    contentRevision: bigint("content_revision", { mode: "bigint" }).notNull(),
    contentState: inboxV2TimelineContentState("content_state").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
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
      name: "inbox_v2_staff_notes_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_staff_notes_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_staff_notes_timeline_fk",
      columns: [table.tenantId, table.timelineItemId, table.conversationId],
      foreignColumns: [
        inboxV2TimelineItems.tenantId,
        inboxV2TimelineItems.id,
        inboxV2TimelineItems.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_staff_notes_author_fk",
      columns: [
        table.tenantId,
        table.authorParticipantId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id,
        inboxV2ConversationParticipants.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_staff_notes_attribution_fk",
      columns: [
        table.tenantId,
        table.creationAttributionId,
        table.conversationId
      ],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id,
        inboxV2ActionAttributions.conversationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_staff_notes_content_fk",
      columns: [
        table.tenantId,
        table.contentId,
        table.contentRevision,
        table.contentState
      ],
      foreignColumns: [
        inboxV2TimelineContents.tenantId,
        inboxV2TimelineContents.id,
        inboxV2TimelineContents.revision,
        inboxV2TimelineContents.state
      ]
    }),
    unique("inbox_v2_staff_notes_timeline_unique").on(
      table.tenantId,
      table.timelineItemId
    ),
    unique("inbox_v2_staff_notes_content_unique").on(
      table.tenantId,
      table.contentId
    ),
    unique("inbox_v2_staff_notes_target_unique").on(
      table.tenantId,
      table.id,
      table.conversationId,
      table.timelineItemId
    ),
    unique("inbox_v2_staff_notes_revision_unique").on(
      table.tenantId,
      table.id,
      table.timelineItemId,
      table.revision
    ),
    check(
      "inbox_v2_staff_notes_clock_check",
      sql`${inboxV2IdSql(table.id, "staff_note")}
        and ${table.revision} >= 1
        and ${table.contentRevision} = ${table.revision}
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.revision} <> 1 or (
          ${table.contentState} = 'available'
          and ${table.createdAt} = ${table.updatedAt}
        ))`
    ),
    index("inbox_v2_staff_notes_conversation_idx").on(
      table.tenantId,
      table.conversationId,
      table.timelineItemId
    )
  ]
);

export const inboxV2StaffNoteRevisions = pgTable(
  "inbox_v2_staff_note_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    staffNoteId: text("staff_note_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    expectedPreviousRevision: bigint("expected_previous_revision", {
      mode: "bigint"
    }),
    staffNoteRevision: bigint("staff_note_revision", {
      mode: "bigint"
    }).notNull(),
    changeKind: inboxV2StaffNoteRevisionChange("change_kind").notNull(),
    beforeContentId: text("before_content_id"),
    beforeContentRevision: bigint("before_content_revision", {
      mode: "bigint"
    }),
    beforeContentState: inboxV2TimelineContentState("before_content_state"),
    afterContentId: text("after_content_id").notNull(),
    afterContentRevision: bigint("after_content_revision", {
      mode: "bigint"
    }).notNull(),
    afterContentState: inboxV2TimelineContentState(
      "after_content_state"
    ).notNull(),
    actionAttributionId: text("action_attribution_id").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_staff_note_revisions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_staff_note_revisions_note_fk",
      columns: [table.tenantId, table.staffNoteId],
      foreignColumns: [inboxV2StaffNotes.tenantId, inboxV2StaffNotes.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_staff_note_revisions_timeline_fk",
      columns: [table.tenantId, table.timelineItemId],
      foreignColumns: [inboxV2TimelineItems.tenantId, inboxV2TimelineItems.id]
    }),
    foreignKey({
      name: "inbox_v2_staff_note_revisions_attribution_fk",
      columns: [table.tenantId, table.actionAttributionId],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_staff_note_revisions_before_content_fk",
      columns: [
        table.tenantId,
        table.beforeContentId,
        table.beforeContentRevision
      ],
      foreignColumns: [
        inboxV2TimelineContentRevisions.tenantId,
        inboxV2TimelineContentRevisions.contentId,
        inboxV2TimelineContentRevisions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_staff_note_revisions_after_content_fk",
      columns: [
        table.tenantId,
        table.afterContentId,
        table.afterContentRevision
      ],
      foreignColumns: [
        inboxV2TimelineContentRevisions.tenantId,
        inboxV2TimelineContentRevisions.contentId,
        inboxV2TimelineContentRevisions.revision
      ]
    }),
    unique("inbox_v2_staff_note_revisions_note_revision_unique").on(
      table.tenantId,
      table.staffNoteId,
      table.staffNoteRevision
    ),
    unique("inbox_v2_staff_note_revisions_attribution_unique").on(
      table.tenantId,
      table.actionAttributionId
    ),
    uniqueIndex("inbox_v2_staff_note_revisions_predecessor_unique")
      .on(table.tenantId, table.staffNoteId, table.expectedPreviousRevision)
      .where(sql`${table.expectedPreviousRevision} is not null`),
    check(
      "inbox_v2_staff_note_revisions_chain_check",
      sql`(${table.changeKind} = 'created'
          and ${table.staffNoteRevision} = 1
          and ${table.expectedPreviousRevision} is null
          and num_nonnulls(
            ${table.beforeContentId}, ${table.beforeContentRevision},
            ${table.beforeContentState}
          ) = 0)
        or (${table.changeKind} <> 'created'
          and ${table.expectedPreviousRevision} is not null
          and ${table.staffNoteRevision} = ${table.expectedPreviousRevision} + 1
          and num_nonnulls(
            ${table.beforeContentId}, ${table.beforeContentRevision},
            ${table.beforeContentState}
          ) = 3)`
    ),
    check(
      "inbox_v2_staff_note_revisions_content_check",
      sql`${table.afterContentRevision} = ${table.staffNoteRevision}`
    ),
    check(
      "inbox_v2_staff_note_revisions_clock_check",
      sql`${inboxV2IdSql(table.id, "staff_note_revision")}
        and ${table.recordedStreamPosition} >= 1
        and ${table.recordRevision} = 1
        and isfinite(${table.occurredAt}) and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.occurredAt}`
    ),
    index("inbox_v2_staff_note_revisions_page_idx").on(
      table.tenantId,
      table.staffNoteId,
      table.staffNoteRevision,
      table.id
    )
  ]
);

/** One immutable source-side occurrence associated with one canonical Message. */
export const inboxV2MessageTransportOccurrenceLinks = pgTable(
  "inbox_v2_message_transport_links",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    role: inboxV2MessageTransportLinkRole("role").notNull(),
    resultingHeadRevision: bigint("resulting_head_revision", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    linkedAt: timestamp("linked_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_transport_links_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_transport_links_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_transport_links_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_message_transport_links_occurrence_unique").on(
      table.tenantId,
      table.sourceOccurrenceId
    ),
    unique("inbox_v2_message_transport_links_target_unique").on(
      table.tenantId,
      table.id,
      table.messageId
    ),
    unique("inbox_v2_message_transport_links_head_revision_unique").on(
      table.tenantId,
      table.messageId,
      table.resultingHeadRevision
    ),
    check(
      "inbox_v2_message_transport_links_record_check",
      sql`${inboxV2IdSql(table.id, "message_transport_occurrence_link")}
        and ${table.resultingHeadRevision} >= 1
        and ${table.recordedStreamPosition} >= 1
        and ${table.revision} = 1 and isfinite(${table.linkedAt})`
    ),
    index("inbox_v2_message_transport_links_message_idx").on(
      table.tenantId,
      table.messageId,
      table.linkedAt,
      table.id
    )
  ]
);

export const inboxV2MessageTransportLinkHeads = pgTable(
  "inbox_v2_message_transport_link_heads",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    linkCount: bigint("link_count", { mode: "bigint" }).notNull(),
    latestLinkId: text("latest_link_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_transport_link_heads_pk",
      columns: [table.tenantId, table.messageId]
    }),
    foreignKey({
      name: "inbox_v2_message_transport_link_heads_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_transport_link_heads_latest_fk",
      columns: [table.tenantId, table.latestLinkId, table.messageId],
      foreignColumns: [
        inboxV2MessageTransportOccurrenceLinks.tenantId,
        inboxV2MessageTransportOccurrenceLinks.id,
        inboxV2MessageTransportOccurrenceLinks.messageId
      ]
    }),
    check(
      "inbox_v2_message_transport_link_heads_clock_check",
      sql`${table.linkCount} >= 1 and ${table.revision} = ${table.linkCount}
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_message_transport_link_heads_tenant_idx").on(
      table.tenantId,
      table.messageId
    )
  ]
);

/**
 * Immutable single-use route ledger shared by Message creation, provider
 * lifecycle requests and external reaction transitions. The outbound route FK
 * is verified by the deferred SQL invariant to avoid a schema module cycle.
 */
export const inboxV2OutboundRouteConsumptions = pgTable(
  "inbox_v2_outbound_route_consumptions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    consumerKind: inboxV2OutboundRouteConsumerKind("consumer_kind").notNull(),
    consumerId: text("consumer_id").notNull(),
    messageId: text("message_id").notNull(),
    outboundRouteId: text("outbound_route_id").notNull(),
    mutationToken: text("mutation_token").notNull(),
    idempotencyToken: text("idempotency_token").notNull(),
    correlationToken: text("correlation_token").notNull(),
    consumedAt: timestamp("consumed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    consumedByTrustedServiceId: text(
      "consumed_by_trusted_service_id"
    ).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    commitDigestSha256: text("commit_digest_sha256").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_outbound_route_consumptions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_outbound_route_consumptions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_outbound_route_consumptions_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    unique("inbox_v2_outbound_route_consumptions_route_unique").on(
      table.tenantId,
      table.outboundRouteId
    ),
    unique("inbox_v2_outbound_route_consumptions_consumer_unique").on(
      table.tenantId,
      table.consumerKind,
      table.consumerId
    ),
    check(
      "inbox_v2_outbound_route_consumptions_shape_check",
      sql`${inboxV2IdSql(table.id, "outbound_route_consumption")}
        and ${inboxV2IdSql(table.outboundRouteId, "outbound_route")}
        and (
          (${table.consumerKind} = 'message_creation'
            and ${inboxV2IdSql(table.consumerId, "message")})
          or (${table.consumerKind} = 'provider_lifecycle'
            and ${inboxV2IdSql(
              table.consumerId,
              "message_provider_lifecycle_operation"
            )})
          or (${table.consumerKind} = 'reaction'
            and ${inboxV2IdSql(
              table.consumerId,
              "message_reaction_transition"
            )})
        )
        and ${inboxV2RoutingTokenSql(table.mutationToken)}
        and ${inboxV2RoutingTokenSql(table.idempotencyToken)}
        and ${inboxV2RoutingTokenSql(table.correlationToken)}
        and ${inboxV2CatalogIdSql(table.consumedByTrustedServiceId)}
        and ${inboxV2Sha256DigestSql(table.commitDigestSha256)}
        and ${table.revision} = 1 and isfinite(${table.consumedAt})`
    ),
    index("inbox_v2_outbound_route_consumptions_tenant_idx").on(
      table.tenantId,
      table.messageId,
      table.consumerKind,
      table.consumerId
    )
  ]
);

export const inboxV2MessageProviderLifecycleOperations = pgTable(
  "inbox_v2_message_provider_lifecycle_operations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    action: inboxV2ProviderLifecycleAction("action").notNull(),
    origin: inboxV2ProviderLifecycleOrigin("origin").notNull(),
    externalMessageReferenceId: text("external_message_reference_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    sourceAccountId: text("source_account_id").notNull(),
    sourceThreadBindingId: text("source_thread_binding_id").notNull(),
    bindingGeneration: bigint("binding_generation", {
      mode: "bigint"
    }).notNull(),
    outboundRouteId: text("outbound_route_id"),
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
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    actionAttributionId: text("action_attribution_id"),
    initialOutcome:
      inboxV2ProviderLifecycleOutcome("initial_outcome").notNull(),
    initialOutcomeRetryable: integer("initial_outcome_retryable"),
    initialOutcomeReasonId: text("initial_outcome_reason_id"),
    initialDeleteLocalEffect: inboxV2ProviderDeleteLocalEffect(
      "initial_delete_local_effect"
    ),
    initialPolicyDecisionEventId: text("initial_policy_decision_event_id"),
    initialPolicyDecisionRevision: bigint("initial_policy_decision_revision", {
      mode: "bigint"
    }),
    initialPolicyDecidedAt: timestamp("initial_policy_decided_at", {
      withTimezone: true,
      precision: 3
    }),
    providerSemanticNormalizedInboundEventId: text(
      "provider_semantic_normalized_inbound_event_id"
    ),
    providerSemanticActorExternalIdentityId: text(
      "provider_semantic_actor_external_identity_id"
    ),
    providerSemanticCapabilityId: text("provider_semantic_capability_id"),
    providerSemanticCapabilityRevision: bigint(
      "provider_semantic_capability_revision",
      { mode: "bigint" }
    ),
    providerSemanticId: text("provider_semantic_id"),
    providerSemanticRevision: bigint("provider_semantic_revision", {
      mode: "bigint"
    }),
    providerSemanticProofToken: text("provider_semantic_proof_token"),
    providerSemanticOrderingScopeToken: text(
      "provider_semantic_ordering_scope_token"
    ),
    providerSemanticOrderingPosition: text(
      "provider_semantic_ordering_position"
    ),
    providerSemanticOrderingComparatorId: text(
      "provider_semantic_ordering_comparator_id"
    ),
    providerSemanticOrderingComparatorRevision: bigint(
      "provider_semantic_ordering_comparator_revision",
      { mode: "bigint" }
    ),
    providerSemanticDeclaredByTrustedServiceId: text(
      "provider_semantic_declared_by_trusted_service_id"
    ),
    providerSemanticProofRevision: bigint("provider_semantic_proof_revision", {
      mode: "bigint"
    }),
    providerSemanticProofDetail: jsonb("provider_semantic_proof_detail").$type<
      Readonly<Record<string, unknown>>
    >(),
    providerSemanticProofDigestSha256: text(
      "provider_semantic_proof_digest_sha256"
    ),
    semanticOrderingCommitDetail: jsonb(
      "semantic_ordering_commit_detail"
    ).$type<Readonly<Record<string, unknown>>>(),
    semanticOrderingCommitDigestSha256: text(
      "semantic_ordering_commit_digest_sha256"
    ),
    semanticOrderingCommittedAt: timestamp("semantic_ordering_committed_at", {
      withTimezone: true,
      precision: 3
    }),
    outcome: inboxV2ProviderLifecycleOutcome("outcome").notNull(),
    outcomeRetryable: integer("outcome_retryable"),
    outcomeReasonId: text("outcome_reason_id"),
    deleteLocalEffect: inboxV2ProviderDeleteLocalEffect("delete_local_effect"),
    policyDecisionEventId: text("policy_decision_event_id"),
    policyDecisionRevision: bigint("policy_decision_revision", {
      mode: "bigint"
    }),
    policyDecidedAt: timestamp("policy_decided_at", {
      withTimezone: true,
      precision: 3
    }),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    createdStreamPosition: bigint("created_stream_position", {
      mode: "bigint"
    }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    occurredAt: timestamp("occurred_at", {
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
      name: "inbox_v2_message_provider_lifecycle_operations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_actor_fk",
      columns: [table.tenantId, table.actionAttributionId],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_lifecycle_initial_policy_event_fk",
      columns: [table.tenantId, table.initialPolicyDecisionEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_lifecycle_semantic_event_fk",
      columns: [table.tenantId, table.providerSemanticNormalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_lifecycle_semantic_actor_fk",
      columns: [table.tenantId, table.providerSemanticActorExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_operations_policy_event_fk",
      columns: [table.tenantId, table.policyDecisionEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    unique("inbox_v2_message_provider_lifecycle_operations_target_unique").on(
      table.tenantId,
      table.id,
      table.messageId
    ),
    unique("inbox_v2_message_provider_lifecycle_operations_revision_unique").on(
      table.tenantId,
      table.id,
      table.revision
    ),
    check(
      "inbox_v2_message_provider_lifecycle_operations_origin_check",
      sql`(${table.origin} = 'provider_observed'
          and ${table.outboundRouteId} is null
          and ${table.actionAttributionId} is null
          and ${table.outcome} = 'observed')
        or (${table.origin} = 'hulee_requested'
          and ${table.outboundRouteId} is not null
          and ${table.actionAttributionId} is not null
          and ${table.outcome} <> 'observed')`
    ),
    check(
      "inbox_v2_message_provider_lifecycle_operations_outcome_check",
      sql`(${table.outcome} = 'failed'
          and ${table.outcomeRetryable} in (0, 1)
          and ${table.outcomeReasonId} is not null)
        or (${table.outcome} = 'unsupported'
          and ${table.outcomeRetryable} is null
          and ${table.outcomeReasonId} is not null)
        or (${table.outcome} not in ('failed', 'unsupported')
          and ${table.outcomeRetryable} is null
          and ${table.outcomeReasonId} is null)`
    ),
    check(
      "inbox_v2_message_provider_lifecycle_operations_policy_check",
      sql`(${table.action} = 'edit'
          and num_nonnulls(
            ${table.deleteLocalEffect}, ${table.policyDecisionEventId},
            ${table.policyDecisionRevision}, ${table.policyDecidedAt}
          ) = 0)
        or (${table.action} = 'delete'
          and ${table.deleteLocalEffect} = 'not_evaluated'
          and num_nonnulls(
            ${table.policyDecisionEventId}, ${table.policyDecisionRevision},
            ${table.policyDecidedAt}
          ) = 0)
        or (${table.action} = 'delete'
          and ${table.deleteLocalEffect} in ('retain_local', 'tombstone_local')
          and num_nonnulls(
            ${table.policyDecisionEventId}, ${table.policyDecisionRevision},
            ${table.policyDecidedAt}
          ) = 3
          and ${table.policyDecisionRevision} >= 1)`
    ),
    check(
      "inbox_v2_provider_lifecycle_initial_state_check",
      sql`(
          (${table.initialOutcome} = 'failed'
            and ${table.initialOutcomeRetryable} in (0, 1)
            and ${table.initialOutcomeReasonId} is not null)
          or (${table.initialOutcome} = 'unsupported'
            and ${table.initialOutcomeRetryable} is null
            and ${table.initialOutcomeReasonId} is not null)
          or (${table.initialOutcome} not in ('failed', 'unsupported')
            and ${table.initialOutcomeRetryable} is null
            and ${table.initialOutcomeReasonId} is null)
        ) and (
          (${table.action} = 'edit' and num_nonnulls(
            ${table.initialDeleteLocalEffect},
            ${table.initialPolicyDecisionEventId},
            ${table.initialPolicyDecisionRevision},
            ${table.initialPolicyDecidedAt}
          ) = 0)
          or (${table.action} = 'delete'
            and ${table.initialDeleteLocalEffect} = 'not_evaluated'
            and num_nonnulls(
              ${table.initialPolicyDecisionEventId},
              ${table.initialPolicyDecisionRevision},
              ${table.initialPolicyDecidedAt}
            ) = 0)
          or (${table.action} = 'delete'
            and ${table.initialDeleteLocalEffect} in (
              'retain_local', 'tombstone_local'
            )
            and num_nonnulls(
              ${table.initialPolicyDecisionEventId},
              ${table.initialPolicyDecisionRevision},
              ${table.initialPolicyDecidedAt}
            ) = 3
            and ${table.initialPolicyDecisionRevision} >= 1)
        ) and (${table.revision} <> 1 or (
          ${table.outcome} = ${table.initialOutcome}
          and ${table.outcomeRetryable} is not distinct from
            ${table.initialOutcomeRetryable}
          and ${table.outcomeReasonId} is not distinct from
            ${table.initialOutcomeReasonId}
          and ${table.deleteLocalEffect} is not distinct from
            ${table.initialDeleteLocalEffect}
          and ${table.policyDecisionEventId} is not distinct from
            ${table.initialPolicyDecisionEventId}
          and ${table.policyDecisionRevision} is not distinct from
            ${table.initialPolicyDecisionRevision}
          and ${table.policyDecidedAt} is not distinct from
            ${table.initialPolicyDecidedAt}
        ))`
    ),
    check(
      "inbox_v2_provider_lifecycle_semantic_proof_check",
      sql`(
        ${table.origin} = 'hulee_requested'
        and num_nonnulls(
          ${table.providerSemanticNormalizedInboundEventId},
          ${table.providerSemanticActorExternalIdentityId},
          ${table.providerSemanticCapabilityId},
          ${table.providerSemanticCapabilityRevision},
          ${table.providerSemanticId}, ${table.providerSemanticRevision},
          ${table.providerSemanticProofToken},
          ${table.providerSemanticOrderingScopeToken},
          ${table.providerSemanticOrderingPosition},
          ${table.providerSemanticOrderingComparatorId},
          ${table.providerSemanticOrderingComparatorRevision},
          ${table.providerSemanticDeclaredByTrustedServiceId},
          ${table.providerSemanticProofRevision},
          ${table.providerSemanticProofDetail},
          ${table.providerSemanticProofDigestSha256},
          ${table.semanticOrderingCommitDetail},
          ${table.semanticOrderingCommitDigestSha256},
          ${table.semanticOrderingCommittedAt}
        ) = 0
      ) or (
        ${table.origin} = 'provider_observed'
        and num_nonnulls(
          ${table.providerSemanticNormalizedInboundEventId},
          ${table.providerSemanticCapabilityId},
          ${table.providerSemanticCapabilityRevision},
          ${table.providerSemanticId}, ${table.providerSemanticRevision},
          ${table.providerSemanticProofToken},
          ${table.providerSemanticOrderingScopeToken},
          ${table.providerSemanticOrderingPosition},
          ${table.providerSemanticOrderingComparatorId},
          ${table.providerSemanticOrderingComparatorRevision},
          ${table.providerSemanticDeclaredByTrustedServiceId},
          ${table.providerSemanticProofRevision},
          ${table.providerSemanticProofDetail},
          ${table.providerSemanticProofDigestSha256},
          ${table.semanticOrderingCommitDetail},
          ${table.semanticOrderingCommitDigestSha256},
          ${table.semanticOrderingCommittedAt}
        ) = 17
        and ${table.providerSemanticCapabilityId} =
          'core:message-' || ${table.action}::text
        and ${table.providerSemanticCapabilityRevision} =
          ${table.capabilityRevision}
        and ${table.providerSemanticId} =
          'core:message.lifecycle.' || ${table.action}::text || '.observed'
        and ${table.providerSemanticRevision} >= 1
        and ${table.providerSemanticProofRevision} = 1
        and ${inboxV2RoutingTokenSql(table.providerSemanticProofToken)}
        and ${inboxV2RoutingTokenSql(table.providerSemanticOrderingScopeToken)}
        and ${table.providerSemanticOrderingPosition} ~ '^(0|[1-9][0-9]*)$'
        and ${inboxV2CatalogIdSql(table.providerSemanticOrderingComparatorId)}
        and ${table.providerSemanticOrderingComparatorRevision} >= 1
        and ${table.providerSemanticDeclaredByTrustedServiceId} =
          ${table.adapterLoadedByTrustedServiceId}
        and ${inboxV2Sha256DigestSql(table.providerSemanticProofDigestSha256)}
        and ${inboxV2Sha256DigestSql(table.semanticOrderingCommitDigestSha256)}
        and jsonb_typeof(${table.providerSemanticProofDetail}) = 'object'
        and jsonb_typeof(${table.semanticOrderingCommitDetail}) = 'object'
        and pg_column_size(${table.providerSemanticProofDetail}) <= 65536
        and pg_column_size(${table.semanticOrderingCommitDetail}) <= 65536
        and ${table.semanticOrderingCommittedAt} = ${table.recordedAt}
        and (${table.providerSemanticProofDetail} #>> '{tenantId}') =
          ${table.tenantId}
        and (${table.providerSemanticProofDetail} #>>
          '{normalizedInboundEvent,id}') =
          ${table.providerSemanticNormalizedInboundEventId}
        and (${table.providerSemanticProofDetail} #>>
          '{externalMessageReference,id}') =
          ${table.externalMessageReferenceId}
        and (${table.providerSemanticProofDetail} #>>
          '{sourceOccurrence,id}') = ${table.sourceOccurrenceId}
        and (${table.providerSemanticProofDetail} #>> '{sourceAccount,id}') =
          ${table.sourceAccountId}
        and (${table.providerSemanticProofDetail} #>>
          '{sourceThreadBinding,id}') = ${table.sourceThreadBindingId}
        and (${table.providerSemanticProofDetail} #>>
          '{bindingGeneration}') = ${table.bindingGeneration}::text
        and (${table.providerSemanticProofDetail} #>> '{capabilityId}') =
          ${table.providerSemanticCapabilityId}
        and (${table.providerSemanticProofDetail} #>> '{capabilityRevision}') =
          ${table.providerSemanticCapabilityRevision}::text
        and (${table.providerSemanticProofDetail} #>> '{semanticId}') =
          ${table.providerSemanticId}
        and (${table.providerSemanticProofDetail} #>> '{semanticRevision}') =
          ${table.providerSemanticRevision}::text
        and (${table.providerSemanticProofDetail} #>> '{proofToken}') =
          ${table.providerSemanticProofToken}
        and (${table.providerSemanticProofDetail} #>>
          '{declaredByTrustedServiceId}') =
          ${table.providerSemanticDeclaredByTrustedServiceId}
        and (${table.providerSemanticProofDetail} #>> '{ordering,kind}') =
          'monotonic_exact'
        and (${table.providerSemanticProofDetail} #>>
          '{ordering,scopeToken}') =
          ${table.providerSemanticOrderingScopeToken}
        and (${table.providerSemanticProofDetail} #>>
          '{ordering,position}') = ${table.providerSemanticOrderingPosition}
        and (${table.providerSemanticProofDetail} #>>
          '{ordering,comparatorId}') =
          ${table.providerSemanticOrderingComparatorId}
        and (${table.providerSemanticProofDetail} #>>
          '{ordering,comparatorRevision}') =
          ${table.providerSemanticOrderingComparatorRevision}::text
        and (${table.providerSemanticProofDetail} #>> '{actor,id}')
          is not distinct from ${table.providerSemanticActorExternalIdentityId}
        and (${table.providerSemanticProofDetail} #>> '{revision}') = '1'
        and (${table.semanticOrderingCommitDetail} #>>
          '{semanticFamilyId}') = 'core:message.lifecycle'
        and (${table.semanticOrderingCommitDetail} #> '{proof}') =
          ${table.providerSemanticProofDetail}
        and ((${table.semanticOrderingCommitDetail} #>> '{committedAt}')::timestamptz) =
          ${table.semanticOrderingCommittedAt}
      )`
    ),
    check(
      "inbox_v2_message_provider_lifecycle_operations_clock_check",
      sql`${inboxV2IdSql(table.id, "message_provider_lifecycle_operation")}
        and ${table.bindingGeneration} >= 1 and ${table.capabilityRevision} >= 1
        and ${table.adapterDeclarationRevision} >= 1
        and ${table.revision} >= 1 and ${table.createdStreamPosition} >= 1
        and ${table.lastChangedStreamPosition} >=
          ${table.createdStreamPosition}
        and isfinite(${table.occurredAt}) and isfinite(${table.recordedAt})
        and isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and isfinite(${table.adapterLoadedAt})
        and ${table.adapterLoadedAt} <= ${table.recordedAt}
        and ${table.occurredAt} <= ${table.recordedAt}
        and ${table.recordedAt} = ${table.createdAt}
        and ${table.createdAt} <= ${table.updatedAt}
        and (${table.policyDecidedAt} is null
          or (${table.policyDecidedAt} <= ${table.updatedAt}
            and isfinite(${table.policyDecidedAt})))`
    ),
    index("inbox_v2_message_provider_lifecycle_operations_message_idx").on(
      table.tenantId,
      table.messageId,
      table.updatedAt,
      table.id
    ),
    index("inbox_v2_provider_lifecycle_semantic_consumer_idx")
      .on(
        table.tenantId,
        table.externalMessageReferenceId,
        table.providerSemanticNormalizedInboundEventId,
        table.providerSemanticOrderingPosition,
        table.providerSemanticProofToken
      )
      .where(sql`${table.origin} = 'provider_observed'`)
  ]
);

export const inboxV2MessageProviderLifecycleTransitions = pgTable(
  "inbox_v2_message_provider_lifecycle_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    operationId: text("operation_id").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    outcome: inboxV2ProviderLifecycleOutcome("outcome").notNull(),
    outcomeRetryable: integer("outcome_retryable"),
    outcomeReasonId: text("outcome_reason_id"),
    deleteLocalEffect: inboxV2ProviderDeleteLocalEffect("delete_local_effect"),
    policyDecisionEventId: text("policy_decision_event_id"),
    policyDecisionRevision: bigint("policy_decision_revision", {
      mode: "bigint"
    }),
    policyDecidedAt: timestamp("policy_decided_at", {
      withTimezone: true,
      precision: 3
    }),
    resultToken: text("result_token"),
    resultDigestSha256: text("result_digest_sha256"),
    resultProofOutboundRouteId: text("result_proof_outbound_route_id"),
    resultProofCapabilityId: text("result_proof_capability_id"),
    resultProofCapabilityRevision: bigint("result_proof_capability_revision", {
      mode: "bigint"
    }),
    resultProofSemanticId: text("result_proof_semantic_id"),
    resultProofSemanticRevision: bigint("result_proof_semantic_revision", {
      mode: "bigint"
    }),
    resultProofState: text("result_proof_state"),
    resultProofDeclaredByTrustedServiceId: text(
      "result_proof_declared_by_trusted_service_id"
    ),
    resultProofRecordedAt: timestamp("result_proof_recorded_at", {
      withTimezone: true,
      precision: 3
    }),
    resultProofAdapterContractDetail: jsonb(
      "result_proof_adapter_contract_detail"
    ).$type<Readonly<Record<string, unknown>>>(),
    resultProofAdapterContractDetailDigestSha256: text(
      "result_proof_adapter_contract_detail_digest_sha256"
    ),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_provider_lifecycle_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_transitions_operation_fk",
      columns: [table.tenantId, table.operationId],
      foreignColumns: [
        inboxV2MessageProviderLifecycleOperations.tenantId,
        inboxV2MessageProviderLifecycleOperations.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_provider_lifecycle_transitions_policy_event_fk",
      columns: [table.tenantId, table.policyDecisionEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    unique(
      "inbox_v2_message_provider_lifecycle_transitions_revision_unique"
    ).on(table.tenantId, table.operationId, table.resultingRevision),
    unique(
      "inbox_v2_message_provider_lifecycle_transitions_expected_unique"
    ).on(table.tenantId, table.operationId, table.expectedRevision),
    check(
      "inbox_v2_message_provider_lifecycle_transitions_chain_check",
      sql`${inboxV2IdSql(table.id, "message_provider_lifecycle_transition")}
        and ${table.expectedRevision} >= 1
        and ${table.resultingRevision} = ${table.expectedRevision} + 1
        and ${table.recordedStreamPosition} >= 1
        and ${table.recordRevision} = 1
        and isfinite(${table.recordedAt})`
    ),
    check(
      "inbox_v2_message_provider_lifecycle_transitions_proof_check",
      sql`(num_nonnulls(
          ${table.resultToken}, ${table.resultDigestSha256},
          ${table.resultProofOutboundRouteId}, ${table.resultProofCapabilityId},
          ${table.resultProofCapabilityRevision}, ${table.resultProofSemanticId},
          ${table.resultProofSemanticRevision}, ${table.resultProofState},
          ${table.resultProofDeclaredByTrustedServiceId},
          ${table.resultProofRecordedAt},
          ${table.resultProofAdapterContractDetail},
          ${table.resultProofAdapterContractDetailDigestSha256}
        ) = 0)
        or (num_nonnulls(
          ${table.resultToken}, ${table.resultDigestSha256},
          ${table.resultProofOutboundRouteId}, ${table.resultProofCapabilityId},
          ${table.resultProofCapabilityRevision}, ${table.resultProofSemanticId},
          ${table.resultProofSemanticRevision}, ${table.resultProofState},
          ${table.resultProofDeclaredByTrustedServiceId},
          ${table.resultProofRecordedAt},
          ${table.resultProofAdapterContractDetail},
          ${table.resultProofAdapterContractDetailDigestSha256}
        ) = 12
          and ${table.resultDigestSha256} ~ '^[a-f0-9]{64}$'
          and ${table.resultProofAdapterContractDetailDigestSha256} ~
            '^[a-f0-9]{64}$'
          and ${table.resultProofCapabilityRevision} >= 1
          and ${table.resultProofSemanticRevision} >= 1
          and ${table.resultProofState} in (
            'accepted', 'confirmed', 'failed', 'unsupported', 'outcome_unknown'
          )
          and isfinite(${table.resultProofRecordedAt})
          and jsonb_typeof(${table.resultProofAdapterContractDetail}) =
            'object'
          and pg_column_size(${table.resultProofAdapterContractDetail}) <=
            65536
          and ${table.resultProofRecordedAt} = ${table.recordedAt})`
    ),
    index("inbox_v2_message_provider_lifecycle_transitions_tenant_idx").on(
      table.tenantId,
      table.operationId,
      table.resultingRevision
    )
  ]
);

/** Compact reaction slot head; typed transitions retain every state change. */
export const inboxV2MessageReactions = pgTable(
  "inbox_v2_message_reactions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    actorKind: inboxV2ReactionActorKind("actor_kind").notNull(),
    actorParticipantId: text("actor_participant_id"),
    actorSourceOccurrenceId: text("actor_source_occurrence_id"),
    opaqueActorKey: text("opaque_actor_key"),
    opaqueActorKeyDigestSha256: text("opaque_actor_key_digest_sha256"),
    aggregateScope: text("aggregate_scope"),
    providerActorKindId: text("provider_actor_kind_id"),
    providerActorSubject: text("provider_actor_subject"),
    providerActorSubjectDigestSha256: text(
      "provider_actor_subject_digest_sha256"
    ),
    actorIdentityDataClassId: text("actor_identity_data_class_id"),
    actorIdentityState: text("actor_identity_state"),
    actorIdentityTombstoneEventId: text("actor_identity_tombstone_event_id"),
    actorIdentityPurgedAt: timestamp("actor_identity_purged_at", {
      withTimezone: true,
      precision: 3
    }),
    capabilityKind: inboxV2ReactionCapabilityKind("capability_kind").notNull(),
    capabilityId: text("capability_id"),
    capabilityRevision: bigint("capability_revision", { mode: "bigint" }),
    cardinality: inboxV2ReactionCardinality("cardinality").notNull(),
    adapterContractId: text("adapter_contract_id"),
    adapterContractVersion: text("adapter_contract_version"),
    capabilityDetail: jsonb("capability_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    capabilityDetailDigestSha256: text(
      "capability_detail_digest_sha256"
    ).notNull(),
    semanticSlotKey: text("semantic_slot_key").notNull(),
    stateKind: inboxV2ReactionStateKind("state_kind").notNull(),
    valueKind: inboxV2ReactionValueKind("value_kind").notNull(),
    unicodeValue: text("unicode_value"),
    providerReactionKindId: text("provider_reaction_kind_id"),
    providerCanonicalCode: text("provider_canonical_code"),
    clearedAt: timestamp("cleared_at", {
      withTimezone: true,
      precision: 3
    }),
    externalOperation: inboxV2ReactionOperation("external_operation"),
    outboundRouteId: text("outbound_route_id"),
    requestTransitionId: text("request_transition_id"),
    requestAttributionId: text("request_attribution_id"),
    externalOutcome: text("external_outcome"),
    resultToken: text("result_token"),
    resultDigestSha256: text("result_digest_sha256"),
    resolvedAt: timestamp("resolved_at", {
      withTimezone: true,
      precision: 3
    }),
    stateDetail: jsonb("state_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    stateDetailDigestSha256: text("state_detail_digest_sha256").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
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
      name: "inbox_v2_message_reactions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_reactions_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reactions_participant_fk",
      columns: [table.tenantId, table.actorParticipantId],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_reactions_occurrence_fk",
      columns: [table.tenantId, table.actorSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_reactions_attribution_fk",
      columns: [table.tenantId, table.requestAttributionId],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_reactions_tombstone_event_fk",
      columns: [table.tenantId, table.actorIdentityTombstoneEventId],
      foreignColumns: [eventStore.tenantId, eventStore.id]
    }),
    unique("inbox_v2_message_reactions_slot_unique").on(
      table.tenantId,
      table.messageId,
      table.semanticSlotKey
    ),
    unique("inbox_v2_message_reactions_target_unique").on(
      table.tenantId,
      table.id,
      table.messageId,
      table.semanticSlotKey
    ),
    unique("inbox_v2_message_reactions_transition_target_unique").on(
      table.tenantId,
      table.id,
      table.semanticSlotKey
    ),
    unique("inbox_v2_message_reactions_revision_unique").on(
      table.tenantId,
      table.id,
      table.revision
    ),
    check(
      "inbox_v2_message_reactions_actor_check",
      sql`(${table.actorKind} = 'participant'
          and ${table.actorParticipantId} is not null
          and num_nonnulls(
            ${table.actorSourceOccurrenceId}, ${table.opaqueActorKeyDigestSha256},
            ${table.aggregateScope}, ${table.providerActorKindId},
            ${table.providerActorSubjectDigestSha256}, ${table.opaqueActorKey},
            ${table.providerActorSubject}, ${table.actorIdentityDataClassId},
            ${table.actorIdentityState}, ${table.actorIdentityTombstoneEventId},
            ${table.actorIdentityPurgedAt}
          ) = 0)
        or (${table.actorKind} = 'unattributed_source_observation'
          and ${table.actorSourceOccurrenceId} is not null
          and ${table.actorIdentityDataClassId} = 'core:source_occurrence_and_external_reference'
          and (
            (${table.actorIdentityState} = 'available'
              and ${table.opaqueActorKey} is not null
              and ${table.opaqueActorKeyDigestSha256} ~ '^[a-f0-9]{64}$'
              and num_nonnulls(
                ${table.actorIdentityTombstoneEventId},
                ${table.actorIdentityPurgedAt}
              ) = 0)
            or (${table.actorIdentityState} = 'purged'
              and num_nonnulls(
                ${table.actorIdentityTombstoneEventId},
                ${table.actorIdentityPurgedAt}
              ) = 2
              and num_nonnulls(
                ${table.opaqueActorKey}, ${table.opaqueActorKeyDigestSha256}
              ) = 0)
          )
          and num_nonnulls(
            ${table.actorParticipantId}, ${table.aggregateScope},
            ${table.providerActorKindId}, ${table.providerActorSubject},
            ${table.providerActorSubjectDigestSha256}
          ) = 0)
        or (${table.actorKind} = 'aggregate_only'
          and ${table.actorSourceOccurrenceId} is not null
          and ${table.aggregateScope} in ('thread', 'recipient_set', 'unknown')
          and num_nonnulls(
            ${table.actorParticipantId}, ${table.opaqueActorKeyDigestSha256},
            ${table.opaqueActorKey}, ${table.providerActorKindId},
            ${table.providerActorSubject},
            ${table.providerActorSubjectDigestSha256},
            ${table.actorIdentityDataClassId}, ${table.actorIdentityState},
            ${table.actorIdentityTombstoneEventId},
            ${table.actorIdentityPurgedAt}
          ) = 0)
        or (${table.actorKind} = 'provider_system'
          and ${table.actorSourceOccurrenceId} is not null
          and ${table.providerActorKindId} is not null
          and ${table.actorIdentityDataClassId} = 'core:source_occurrence_and_external_reference'
          and (
            (${table.actorIdentityState} = 'available'
              and ${table.providerActorSubject} is not null
              and ${table.providerActorSubjectDigestSha256} ~ '^[a-f0-9]{64}$'
              and num_nonnulls(
                ${table.actorIdentityTombstoneEventId},
                ${table.actorIdentityPurgedAt}
              ) = 0)
            or (${table.actorIdentityState} = 'purged'
              and num_nonnulls(
                ${table.actorIdentityTombstoneEventId},
                ${table.actorIdentityPurgedAt}
              ) = 2
              and num_nonnulls(
                ${table.providerActorSubject},
                ${table.providerActorSubjectDigestSha256}
              ) = 0)
          )
          and num_nonnulls(
            ${table.actorParticipantId}, ${table.opaqueActorKey},
            ${table.opaqueActorKeyDigestSha256}, ${table.aggregateScope}
          ) = 0)`
    ),
    check(
      "inbox_v2_message_reactions_capability_check",
      sql`(${table.capabilityKind} = 'internal'
          and ${table.cardinality} = 'multiple_values'
          and ${table.actorKind} = 'participant'
          and num_nonnulls(
            ${table.capabilityId}, ${table.capabilityRevision},
            ${table.adapterContractId}, ${table.adapterContractVersion}
          ) = 0)
        or (${table.capabilityKind} = 'external'
          and num_nonnulls(
            ${table.capabilityId}, ${table.capabilityRevision},
            ${table.adapterContractId}, ${table.adapterContractVersion}
          ) = 4
          and ${inboxV2CatalogIdSql(table.capabilityId)}
          and ${table.capabilityRevision} >= 1
          and ((${table.actorKind} = 'aggregate_only') =
            (${table.cardinality} = 'aggregate_only')))`
    ),
    check(
      "inbox_v2_message_reactions_value_check",
      sql`(${table.valueKind} = 'unicode'
          and char_length(${table.unicodeValue}) between 1 and 64
          and num_nonnulls(
            ${table.providerReactionKindId}, ${table.providerCanonicalCode}
          ) = 0)
        or (${table.valueKind} = 'provider_custom'
          and ${table.unicodeValue} is null
          and num_nonnulls(
            ${table.providerReactionKindId}, ${table.providerCanonicalCode}
          ) = 2
          and ${inboxV2CatalogIdSql(table.providerReactionKindId)})`
    ),
    check(
      "inbox_v2_message_reactions_state_check",
      sql`(${table.stateKind} = 'active'
          and num_nonnulls(
            ${table.clearedAt}, ${table.externalOperation},
            ${table.outboundRouteId}, ${table.requestTransitionId},
            ${table.requestAttributionId}, ${table.externalOutcome},
            ${table.resultToken}, ${table.resultDigestSha256}, ${table.resolvedAt}
          ) = 0)
        or (${table.stateKind} = 'cleared'
          and ${table.clearedAt} = ${table.updatedAt}
          and num_nonnulls(
            ${table.externalOperation}, ${table.outboundRouteId},
            ${table.requestTransitionId}, ${table.requestAttributionId},
            ${table.externalOutcome}, ${table.resultToken},
            ${table.resultDigestSha256}, ${table.resolvedAt}
          ) = 0)
        or (${table.stateKind} = 'pending_external'
          and num_nonnulls(
            ${table.externalOperation}, ${table.outboundRouteId},
            ${table.requestTransitionId}, ${table.requestAttributionId}
          ) = 4
          and num_nonnulls(
            ${table.clearedAt}, ${table.externalOutcome}, ${table.resultToken},
            ${table.resultDigestSha256}, ${table.resolvedAt}
          ) = 0)
        or (${table.stateKind} = 'external_terminal'
          and ${table.externalOutcome} in ('failed', 'unsupported', 'outcome_unknown')
          and ${table.resultDigestSha256} ~ '^[a-f0-9]{64}$'
          and ${table.resolvedAt} = ${table.updatedAt}
          and num_nonnulls(
            ${table.externalOperation}, ${table.outboundRouteId},
            ${table.requestTransitionId}, ${table.externalOutcome},
            ${table.resultToken}, ${table.resultDigestSha256}, ${table.resolvedAt}
          ) = 7
          and num_nonnulls(${table.clearedAt}, ${table.requestAttributionId}) = 0)`
    ),
    check(
      "inbox_v2_message_reactions_clock_check",
      sql`${inboxV2IdSql(table.id, "message_reaction")}
        and char_length(${table.semanticSlotKey}) between 1 and 2048
        and ${table.semanticSlotKey} like 'v1:%'
        and ${table.revision} >= 1
        and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.createdAt}) and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (${table.revision} <> 1 or (
          ${table.stateKind} in ('active', 'pending_external')
          and ${table.createdAt} = ${table.updatedAt}
        ))
        and ${table.capabilityDetailDigestSha256} ~ '^[a-f0-9]{64}$'
        and ${table.stateDetailDigestSha256} ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(${table.capabilityDetail}) = 'object'
        and jsonb_typeof(${table.stateDetail}) = 'object'
        and pg_column_size(${table.capabilityDetail}) <= 65536
        and pg_column_size(${table.stateDetail}) <= 65536
        and (${table.actorIdentityPurgedAt} is null
          or isfinite(${table.actorIdentityPurgedAt}))`
    ),
    index("inbox_v2_message_reactions_message_idx").on(
      table.tenantId,
      table.messageId,
      table.updatedAt,
      table.id
    )
  ]
);

export const inboxV2MessageReactionTransitions = pgTable(
  "inbox_v2_message_reaction_transitions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    reactionId: text("reaction_id").notNull(),
    semanticSlotKey: text("semantic_slot_key").notNull(),
    mode: inboxV2ReactionTransitionMode("mode").notNull(),
    operation: inboxV2ReactionOperation("operation").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    beforeStateKind: inboxV2ReactionStateKind("before_state_kind"),
    afterStateKind: inboxV2ReactionStateKind("after_state_kind").notNull(),
    beforeStateDetail: jsonb("before_state_detail").$type<
      Readonly<Record<string, unknown>>
    >(),
    beforeStateDetailDigestSha256: text("before_state_detail_digest_sha256"),
    afterStateDetail: jsonb("after_state_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    afterStateDetailDigestSha256: text(
      "after_state_detail_digest_sha256"
    ).notNull(),
    valueKind: inboxV2ReactionValueKind("value_kind").notNull(),
    unicodeValue: text("unicode_value"),
    providerReactionKindId: text("provider_reaction_kind_id"),
    providerCanonicalCode: text("provider_canonical_code"),
    actionAttributionId: text("action_attribution_id").notNull(),
    externalMessageReferenceId: text("external_message_reference_id"),
    sourceOccurrenceId: text("source_occurrence_id"),
    sourceAccountId: text("source_account_id"),
    sourceThreadBindingId: text("source_thread_binding_id"),
    bindingGeneration: bigint("binding_generation", { mode: "bigint" }),
    outboundRouteId: text("outbound_route_id"),
    capabilityId: text("capability_id"),
    capabilityRevision: bigint("capability_revision", { mode: "bigint" }),
    adapterContractId: text("adapter_contract_id"),
    adapterContractVersion: text("adapter_contract_version"),
    externalAuthorityDetail: jsonb("external_authority_detail").$type<
      Readonly<Record<string, unknown>>
    >(),
    externalAuthorityDetailDigestSha256: text(
      "external_authority_detail_digest_sha256"
    ),
    providerResultProofDetail: jsonb("provider_result_proof_detail").$type<
      Readonly<Record<string, unknown>>
    >(),
    providerResultProofDetailDigestSha256: text(
      "provider_result_proof_detail_digest_sha256"
    ),
    resultToken: text("result_token"),
    resultDigestSha256: text("result_digest_sha256"),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    recordRevision: bigint("record_revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reaction_transitions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_reaction_transitions_reaction_fk",
      columns: [table.tenantId, table.reactionId, table.semanticSlotKey],
      foreignColumns: [
        inboxV2MessageReactions.tenantId,
        inboxV2MessageReactions.id,
        inboxV2MessageReactions.semanticSlotKey
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_reaction_transitions_attribution_fk",
      columns: [table.tenantId, table.actionAttributionId],
      foreignColumns: [
        inboxV2ActionAttributions.tenantId,
        inboxV2ActionAttributions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_reaction_transitions_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_reaction_transitions_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_message_reaction_transitions_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    unique("inbox_v2_message_reaction_transitions_revision_unique").on(
      table.tenantId,
      table.reactionId,
      table.resultingRevision
    ),
    uniqueIndex("inbox_v2_message_reaction_transitions_predecessor_unique")
      .on(table.tenantId, table.reactionId, table.expectedRevision)
      .where(sql`${table.expectedRevision} is not null`),
    check(
      "inbox_v2_message_reaction_transitions_chain_check",
      sql`(${table.expectedRevision} is null
          and ${table.resultingRevision} = 1
          and ${table.beforeStateKind} is null
          and ${table.beforeStateDetail} is null
          and ${table.beforeStateDetailDigestSha256} is null)
        or (${table.expectedRevision} is not null
          and ${table.resultingRevision} = ${table.expectedRevision} + 1
          and ${table.beforeStateKind} is not null
          and jsonb_typeof(${table.beforeStateDetail}) = 'object'
          and ${table.beforeStateDetailDigestSha256} ~ '^[a-f0-9]{64}$')`
    ),
    check(
      "inbox_v2_message_reaction_transitions_authority_check",
      sql`(${table.mode} in ('internal_apply', 'provider_result')
          and num_nonnulls(
            ${table.externalMessageReferenceId}, ${table.sourceOccurrenceId},
            ${table.sourceAccountId}, ${table.sourceThreadBindingId},
            ${table.bindingGeneration}, ${table.outboundRouteId},
            ${table.capabilityId}, ${table.capabilityRevision},
            ${table.adapterContractId}, ${table.adapterContractVersion},
            ${table.externalAuthorityDetail},
            ${table.externalAuthorityDetailDigestSha256}
          ) = 0)
        or (${table.mode} in ('external_request', 'provider_observed')
          and num_nonnulls(
            ${table.externalMessageReferenceId}, ${table.sourceOccurrenceId},
            ${table.sourceAccountId}, ${table.sourceThreadBindingId},
            ${table.bindingGeneration}, ${table.capabilityId},
            ${table.capabilityRevision}, ${table.adapterContractId},
            ${table.adapterContractVersion},
            ${table.externalAuthorityDetail},
            ${table.externalAuthorityDetailDigestSha256}
          ) = 11
          and jsonb_typeof(${table.externalAuthorityDetail}) = 'object'
          and ${table.externalAuthorityDetailDigestSha256} ~ '^[a-f0-9]{64}$'
          and pg_column_size(${table.externalAuthorityDetail}) <= 65536
          and ((${table.mode} = 'provider_observed') =
            (${table.outboundRouteId} is null)))`
    ),
    check(
      "inbox_v2_message_reaction_transitions_clock_check",
      sql`${inboxV2IdSql(table.id, "message_reaction_transition")}
        and ${table.recordedStreamPosition} >= 1
        and ${table.recordRevision} = 1
        and isfinite(${table.occurredAt}) and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.occurredAt}
        and jsonb_typeof(${table.afterStateDetail}) = 'object'
        and ${table.afterStateDetailDigestSha256} ~ '^[a-f0-9]{64}$'
        and pg_column_size(${table.afterStateDetail}) <= 65536
        and (${table.beforeStateDetail} is null
          or pg_column_size(${table.beforeStateDetail}) <= 65536)
        and (
          (${table.mode} = 'provider_result'
            and num_nonnulls(
              ${table.providerResultProofDetail},
              ${table.providerResultProofDetailDigestSha256},
              ${table.resultToken}, ${table.resultDigestSha256}
            ) = 4
            and jsonb_typeof(${table.providerResultProofDetail}) = 'object'
            and pg_column_size(${table.providerResultProofDetail}) <= 65536
            and ${table.providerResultProofDetailDigestSha256} ~
              '^[a-f0-9]{64}$'
            and ${table.resultDigestSha256} ~ '^[a-f0-9]{64}$')
          or (${table.mode} <> 'provider_result'
            and num_nonnulls(
              ${table.providerResultProofDetail},
              ${table.providerResultProofDetailDigestSha256},
              ${table.resultToken}, ${table.resultDigestSha256}
            ) = 0)
        )`
    ),
    index("inbox_v2_message_reaction_transitions_snapshot_idx").on(
      table.tenantId,
      table.reactionId,
      table.recordedStreamPosition,
      table.resultingRevision
    )
  ]
);

export const inboxV2MessageReactionSlotHeads = pgTable(
  "inbox_v2_message_reaction_slot_heads",
  {
    tenantId: text("tenant_id").notNull(),
    messageId: text("message_id").notNull(),
    semanticSlotKey: text("semantic_slot_key").notNull(),
    reactionId: text("reaction_id").notNull(),
    stateKind: inboxV2ReactionStateKind("state_kind").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_reaction_slot_heads_pk",
      columns: [table.tenantId, table.messageId, table.semanticSlotKey]
    }),
    foreignKey({
      name: "inbox_v2_message_reaction_slot_heads_reaction_fk",
      columns: [
        table.tenantId,
        table.reactionId,
        table.messageId,
        table.semanticSlotKey
      ],
      foreignColumns: [
        inboxV2MessageReactions.tenantId,
        inboxV2MessageReactions.id,
        inboxV2MessageReactions.messageId,
        inboxV2MessageReactions.semanticSlotKey
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_message_reaction_slot_heads_clock_check",
      sql`${table.revision} >= 1 and ${table.lastChangedStreamPosition} >= 1
        and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_message_reaction_slot_heads_tenant_idx").on(
      table.tenantId,
      table.messageId,
      table.semanticSlotKey
    )
  ]
);

export const inboxV2MessageProviderReactionObservations = pgTable(
  "inbox_v2_message_provider_reaction_observations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    transitionId: text("transition_id").notNull(),
    normalizedInboundEventId: text("normalized_inbound_event_id").notNull(),
    sourceOccurrenceId: text("source_occurrence_id").notNull(),
    semanticId: text("semantic_id").notNull(),
    semanticProofDigestSha256: text("semantic_proof_digest_sha256").notNull(),
    semanticProofDetail: jsonb("semantic_proof_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    orderingPosition: text("ordering_position").notNull(),
    orderingProofDigestSha256: text("ordering_proof_digest_sha256").notNull(),
    orderingCommitDetail: jsonb("ordering_commit_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    normalizedStateKind: inboxV2ReactionStateKind(
      "normalized_state_kind"
    ).notNull(),
    normalizedValueKind: inboxV2ReactionValueKind(
      "normalized_value_kind"
    ).notNull(),
    normalizedUnicodeValue: text("normalized_unicode_value"),
    normalizedProviderReactionKindId: text(
      "normalized_provider_reaction_kind_id"
    ),
    normalizedProviderCanonicalCode: text("normalized_provider_canonical_code"),
    providerActorParticipantId: text("provider_actor_participant_id"),
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
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_provider_reaction_observations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_reaction_observations_transition_fk",
      columns: [table.tenantId, table.transitionId],
      foreignColumns: [
        inboxV2MessageReactionTransitions.tenantId,
        inboxV2MessageReactionTransitions.id
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_provider_reaction_observations_event_fk",
      columns: [table.tenantId, table.normalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_reaction_observations_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_provider_reaction_observations_actor_fk",
      columns: [table.tenantId, table.providerActorParticipantId],
      foreignColumns: [
        inboxV2ConversationParticipants.tenantId,
        inboxV2ConversationParticipants.id
      ]
    }),
    unique("inbox_v2_provider_reaction_observation_transition_unique").on(
      table.tenantId,
      table.transitionId
    ),
    check(
      "inbox_v2_message_provider_reaction_observations_proof_check",
      sql`${table.semanticProofDigestSha256} ~ '^[a-f0-9]{64}$'
        and ${table.orderingProofDigestSha256} ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(${table.semanticProofDetail}) = 'object'
        and jsonb_typeof(${table.orderingCommitDetail}) = 'object'
        and pg_column_size(${table.semanticProofDetail}) <= 65536
        and pg_column_size(${table.orderingCommitDetail}) <= 65536
        and ${table.orderingPosition} ~ '^(0|[1-9][0-9]*)$'
        and ${table.revision} = 1
        and ${table.normalizedStateKind} in ('active', 'cleared')`
    ),
    check(
      "inbox_v2_message_provider_reaction_observations_clock_check",
      sql`${inboxV2IdSql(table.id, "provider_reaction_observation")}
        and isfinite(${table.observedAt}) and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.observedAt}`
    ),
    index("inbox_v2_message_provider_reaction_observations_tenant_idx").on(
      table.tenantId,
      table.transitionId,
      table.id
    ),
    index("inbox_v2_provider_reaction_semantic_consumer_idx").on(
      table.tenantId,
      table.normalizedInboundEventId,
      table.orderingPosition,
      table.transitionId
    )
  ]
);

/**
 * Shared immutable idempotency ledger for every Message transport fact.
 *
 * Delivery and receipt rows deliberately share this physical primary key so a
 * commit token cannot be won concurrently by the two otherwise independent
 * fact tables. The deferred invariant below requires exactly one matching
 * child before commit.
 */
export const inboxV2MessageTransportFactCommits = pgTable(
  "inbox_v2_message_transport_fact_commits",
  {
    tenantId: text("tenant_id").notNull(),
    commitToken: text("commit_token").notNull(),
    factKind: inboxV2MessageTransportFactKind("fact_kind").notNull(),
    observationId: text("observation_id").notNull(),
    messageId: text("message_id"),
    commitDigestSha256: text("commit_digest_sha256").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_transport_fact_commits_pk",
      columns: [table.tenantId, table.commitToken]
    }),
    foreignKey({
      name: "inbox_v2_message_transport_fact_commits_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_transport_fact_commits_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    unique("inbox_v2_message_transport_fact_commits_observation_unique").on(
      table.tenantId,
      table.observationId
    ),
    check(
      "inbox_v2_message_transport_fact_commits_shape_check",
      sql`${inboxV2RoutingTokenSql(table.commitToken)}
        and ((${table.factKind} = 'delivery'
            and ${inboxV2IdSql(table.observationId, "message_delivery_observation")}
            and ${table.messageId} is not null)
          or (${table.factKind} = 'receipt'
            and ${inboxV2IdSql(table.observationId, "provider_receipt_observation")}))
        and ${inboxV2Sha256DigestSql(table.commitDigestSha256)}
        and ${table.recordedStreamPosition} >= 1 and ${table.revision} = 1
        and isfinite(${table.observedAt}) and isfinite(${table.recordedAt})
        and ${table.recordedAt} >= ${table.observedAt}`
    ),
    index("inbox_v2_message_transport_fact_commits_message_page_idx").on(
      table.tenantId,
      table.messageId,
      table.recordedAt,
      table.factKind,
      table.observationId
    )
  ]
);

/** Immutable provider delivery evidence; never mutates Message/Timeline heads. */
export const inboxV2MessageDeliveryObservations = pgTable(
  "inbox_v2_message_delivery_observations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    messageId: text("message_id").notNull(),
    fact: inboxV2DeliveryFact("fact").notNull(),
    scopeKind: inboxV2DeliveryScopeKind("scope_kind").notNull(),
    scopeDispatchId: text("scope_dispatch_id"),
    scopeAttemptId: text("scope_attempt_id"),
    scopeArtifactId: text("scope_artifact_id"),
    scopeExternalMessageReferenceId: text(
      "scope_external_message_reference_id"
    ),
    scopeSourceOccurrenceId: text("scope_source_occurrence_id"),
    scopeRecipientSourceIdentityId: text("scope_recipient_source_identity_id"),
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
    evidenceKind: inboxV2DeliveryEvidenceKind("evidence_kind").notNull(),
    evidenceAttemptId: text("evidence_attempt_id"),
    evidenceArtifactId: text("evidence_artifact_id"),
    evidenceNormalizedInboundEventId: text(
      "evidence_normalized_inbound_event_id"
    ),
    evidenceExternalMessageReferenceId: text(
      "evidence_external_message_reference_id"
    ),
    evidenceSourceOccurrenceId: text("evidence_source_occurrence_id"),
    semanticProofDetail: jsonb("semantic_proof_detail").$type<
      Readonly<Record<string, unknown>>
    >(),
    semanticProofDigestSha256: text("semantic_proof_digest_sha256"),
    evidenceKindId: text("evidence_kind_id").notNull(),
    evidenceDigestSha256: text("evidence_digest_sha256").notNull(),
    failureReasonId: text("failure_reason_id"),
    commitToken: text("commit_token").notNull(),
    commitDigestSha256: text("commit_digest_sha256").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_message_delivery_observations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_message_fk",
      columns: [table.tenantId, table.messageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_commit_fk",
      columns: [table.tenantId, table.commitToken],
      foreignColumns: [
        inboxV2MessageTransportFactCommits.tenantId,
        inboxV2MessageTransportFactCommits.commitToken
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_scope_occurrence_fk",
      columns: [table.tenantId, table.scopeSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_message_delivery_observations_commit_unique").on(
      table.tenantId,
      table.commitToken
    ),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_evidence_event_fk",
      columns: [table.tenantId, table.evidenceNormalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_evidence_occurrence_fk",
      columns: [table.tenantId, table.evidenceSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_recipient_fk",
      columns: [table.tenantId, table.scopeRecipientSourceIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_message_delivery_observations_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    check(
      "inbox_v2_message_delivery_observations_scope_check",
      sql`(${table.scopeKind} = 'dispatch'
          and ${table.scopeDispatchId} is not null
          and num_nonnulls(
            ${table.scopeExternalMessageReferenceId},
            ${table.scopeSourceOccurrenceId},
            ${table.scopeRecipientSourceIdentityId}
          ) = 0)
        or (${table.scopeKind} = 'external_reference'
          and num_nonnulls(
            ${table.scopeExternalMessageReferenceId},
            ${table.scopeSourceOccurrenceId}
          ) = 2
          and num_nonnulls(
            ${table.scopeDispatchId}, ${table.scopeAttemptId},
            ${table.scopeArtifactId}, ${table.scopeRecipientSourceIdentityId}
          ) = 0)
        or (${table.scopeKind} = 'recipient'
          and num_nonnulls(
            ${table.scopeExternalMessageReferenceId},
            ${table.scopeRecipientSourceIdentityId}
          ) = 2
          and num_nonnulls(
            ${table.scopeDispatchId}, ${table.scopeAttemptId},
            ${table.scopeArtifactId}, ${table.scopeSourceOccurrenceId}
          ) = 0)`
    ),
    check(
      "inbox_v2_message_delivery_observations_evidence_check",
      sql`(${table.evidenceKind} = 'provider_result'
          and ${table.evidenceAttemptId} is not null
          and num_nonnulls(
            ${table.evidenceArtifactId},
            ${table.evidenceNormalizedInboundEventId},
            ${table.evidenceExternalMessageReferenceId},
            ${table.evidenceSourceOccurrenceId}
          ) = 0)
        or (${table.evidenceKind} = 'provider_artifact'
          and num_nonnulls(
            ${table.evidenceAttemptId}, ${table.evidenceArtifactId}
          ) = 2
          and num_nonnulls(
            ${table.evidenceNormalizedInboundEventId},
            ${table.evidenceExternalMessageReferenceId},
            ${table.evidenceSourceOccurrenceId}
          ) = 0)
        or (${table.evidenceKind} = 'provider_event'
          and num_nonnulls(
            ${table.evidenceNormalizedInboundEventId},
            ${table.evidenceExternalMessageReferenceId},
            ${table.evidenceSourceOccurrenceId}
          ) = 3
          and num_nonnulls(
            ${table.evidenceAttemptId}, ${table.evidenceArtifactId}
          ) = 0)`
    ),
    check(
      "inbox_v2_message_delivery_observations_fact_check",
      sql`((${table.fact} = 'failed') = (${table.failureReasonId} is not null))
        and (${table.fact} not in ('sent', 'delivered')
          or ${table.evidenceKind} = 'provider_event')
        and (${table.scopeKind} = 'dispatch'
          or ${table.evidenceKind} = 'provider_event')`
    ),
    check(
      "inbox_v2_message_delivery_observations_clock_check",
      sql`${inboxV2IdSql(table.id, "message_delivery_observation")}
        and ${table.bindingGeneration} >= 1
        and ${table.adapterDeclarationRevision} >= 1
        and ${table.capabilityRevision} >= 1
        and ${table.recordedStreamPosition} >= 1 and ${table.revision} = 1
        and ${table.evidenceDigestSha256} ~ '^[a-f0-9]{64}$'
        and char_length(${table.commitToken}) between 1 and 512
        and ${table.commitDigestSha256} ~ '^[a-f0-9]{64}$'
        and isfinite(${table.adapterLoadedAt})
        and isfinite(${table.observedAt}) and isfinite(${table.recordedAt})
        and ${table.adapterLoadedAt} <= ${table.recordedAt}
        and ${table.observedAt} <= ${table.recordedAt}
        and (num_nonnulls(
          ${table.semanticProofDetail}, ${table.semanticProofDigestSha256}
        ) in (0, 2))
        and (${table.semanticProofDetail} is null or (
          jsonb_typeof(${table.semanticProofDetail}) = 'object'
          and pg_column_size(${table.semanticProofDetail}) <= 65536
          and ${table.semanticProofDigestSha256} ~ '^[a-f0-9]{64}$'
        ))`
    ),
    index("inbox_v2_message_delivery_observations_page_idx").on(
      table.tenantId,
      table.messageId,
      table.recordedAt,
      table.id
    )
  ]
);

/** Provider read evidence is independent from employee Inbox read state. */
export const inboxV2ProviderReceiptObservations = pgTable(
  "inbox_v2_provider_receipt_observations",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    targetKind: inboxV2ReceiptTargetKind("target_kind").notNull(),
    targetMessageId: text("target_message_id"),
    targetExternalMessageReferenceId: text(
      "target_external_message_reference_id"
    ),
    targetSourceOccurrenceId: text("target_source_occurrence_id"),
    providerWatermarkDigestSha256: text("provider_watermark_digest_sha256"),
    readThroughProviderTime: timestamp("read_through_provider_time", {
      withTimezone: true,
      precision: 3
    }),
    readerKind: inboxV2ReceiptReaderKind("reader_kind").notNull(),
    readerSourceExternalIdentityId: text("reader_source_external_identity_id"),
    readerAggregateKeyDigestSha256: text("reader_aggregate_key_digest_sha256"),
    opaquePayloadId: text("opaque_payload_id"),
    opaqueDataClassId: text("opaque_data_class_id"),
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
    evidenceNormalizedInboundEventId: text(
      "evidence_normalized_inbound_event_id"
    ).notNull(),
    semanticProofDetail: jsonb("semantic_proof_detail")
      .$type<Readonly<Record<string, unknown>>>()
      .notNull(),
    semanticProofDigestSha256: text("semantic_proof_digest_sha256").notNull(),
    evidenceKindId: text("evidence_kind_id").notNull(),
    evidenceDigestSha256: text("evidence_digest_sha256").notNull(),
    commitToken: text("commit_token").notNull(),
    commitDigestSha256: text("commit_digest_sha256").notNull(),
    observedAt: timestamp("observed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedStreamPosition: bigint("recorded_stream_position", {
      mode: "bigint"
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_provider_receipt_observations_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_commit_fk",
      columns: [table.tenantId, table.commitToken],
      foreignColumns: [
        inboxV2MessageTransportFactCommits.tenantId,
        inboxV2MessageTransportFactCommits.commitToken
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_message_fk",
      columns: [table.tenantId, table.targetMessageId],
      foreignColumns: [inboxV2Messages.tenantId, inboxV2Messages.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_occurrence_fk",
      columns: [table.tenantId, table.targetSourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    unique("inbox_v2_provider_receipt_observations_commit_unique").on(
      table.tenantId,
      table.commitToken
    ),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_reader_fk",
      columns: [table.tenantId, table.readerSourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_account_fk",
      columns: [table.tenantId, table.sourceAccountId],
      foreignColumns: [sourceAccounts.tenantId, sourceAccounts.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_binding_fk",
      columns: [table.tenantId, table.sourceThreadBindingId],
      foreignColumns: [
        inboxV2SourceThreadBindings.tenantId,
        inboxV2SourceThreadBindings.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_provider_receipt_observations_event_fk",
      columns: [table.tenantId, table.evidenceNormalizedInboundEventId],
      foreignColumns: [
        normalizedInboundEvents.tenantId,
        normalizedInboundEvents.id
      ]
    }),
    check(
      "inbox_v2_provider_receipt_observations_target_check",
      sql`(${table.targetKind} = 'exact_message'
          and num_nonnulls(
            ${table.targetMessageId},
            ${table.targetExternalMessageReferenceId},
            ${table.targetSourceOccurrenceId}
          ) = 3
          and num_nonnulls(
            ${table.providerWatermarkDigestSha256},
            ${table.readThroughProviderTime}
          ) = 0)
        or (${table.targetKind} = 'provider_watermark'
          and ${table.providerWatermarkDigestSha256} ~ '^[a-f0-9]{64}$'
          and num_nonnulls(
            ${table.targetMessageId},
            ${table.targetExternalMessageReferenceId},
            ${table.targetSourceOccurrenceId}, ${table.readThroughProviderTime}
          ) = 0)
        or (${table.targetKind} = 'thread_readmark'
          and ${table.readThroughProviderTime} is not null
          and num_nonnulls(
            ${table.targetMessageId},
            ${table.targetExternalMessageReferenceId},
            ${table.targetSourceOccurrenceId},
            ${table.providerWatermarkDigestSha256}
          ) = 0)`
    ),
    check(
      "inbox_v2_provider_receipt_observations_reader_check",
      sql`(${table.readerKind} = 'source_external_identity'
          and ${table.readerSourceExternalIdentityId} is not null
          and ${table.readerAggregateKeyDigestSha256} is null)
        or (${table.readerKind} = 'aggregate_only'
          and ${table.readerSourceExternalIdentityId} is null
          and ${table.readerAggregateKeyDigestSha256} ~ '^[a-f0-9]{64}$')`
    ),
    check(
      "inbox_v2_provider_receipt_observations_clock_check",
      sql`${inboxV2IdSql(table.id, "provider_receipt_observation")}
        and (
          (${table.providerWatermarkDigestSha256} is null
            and ${table.readerAggregateKeyDigestSha256} is null
            and num_nonnulls(
              ${table.opaquePayloadId}, ${table.opaqueDataClassId}
            ) = 0)
          or ((
              ${table.providerWatermarkDigestSha256} is not null
              or ${table.readerAggregateKeyDigestSha256} is not null
            )
            and ${inboxV2IdSql(
              table.opaquePayloadId,
              "provider_receipt_opaque_payload"
            )}
            and ${table.opaqueDataClassId} =
              'core:source_occurrence_and_external_reference')
        )
        and ${table.bindingGeneration} >= 1
        and ${table.adapterDeclarationRevision} >= 1
        and ${table.capabilityRevision} >= 1
        and ${table.recordedStreamPosition} >= 1 and ${table.revision} = 1
        and ${table.semanticProofDigestSha256} ~ '^[a-f0-9]{64}$'
        and ${table.evidenceDigestSha256} ~ '^[a-f0-9]{64}$'
        and char_length(${table.commitToken}) between 1 and 512
        and ${table.commitDigestSha256} ~ '^[a-f0-9]{64}$'
        and jsonb_typeof(${table.semanticProofDetail}) = 'object'
        and pg_column_size(${table.semanticProofDetail}) <= 65536
        and isfinite(${table.adapterLoadedAt})
        and isfinite(${table.observedAt}) and isfinite(${table.recordedAt})
        and (${table.readThroughProviderTime} is null
          or isfinite(${table.readThroughProviderTime}))
        and ${table.adapterLoadedAt} <= ${table.recordedAt}
        and ${table.observedAt} <= ${table.recordedAt}`
    ),
    index("inbox_v2_provider_receipt_observations_page_idx").on(
      table.tenantId,
      table.sourceThreadBindingId,
      table.recordedAt,
      table.id
    )
  ]
);

/** Classified provider opaque values; independently purgeable safe skeleton. */
export const inboxV2ProviderReceiptOpaquePayloads = pgTable(
  "inbox_v2_provider_receipt_opaque_payloads",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    receiptObservationId: text("receipt_observation_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    providerWatermark: text("provider_watermark"),
    readerAggregateKey: text("reader_aggregate_key"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_provider_receipt_opaque_payloads_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_provider_receipt_opaque_payloads_receipt_fk",
      columns: [table.tenantId, table.receiptObservationId],
      foreignColumns: [
        inboxV2ProviderReceiptObservations.tenantId,
        inboxV2ProviderReceiptObservations.id
      ]
    }).onDelete("cascade"),
    unique("inbox_v2_provider_receipt_opaque_payloads_receipt_unique").on(
      table.tenantId,
      table.receiptObservationId
    ),
    check(
      "inbox_v2_provider_receipt_opaque_payloads_shape_check",
      sql`${inboxV2IdSql(table.id, "provider_receipt_opaque_payload")}
        and ${table.dataClassId} = 'core:source_occurrence_and_external_reference'
        and num_nonnulls(
          ${table.providerWatermark}, ${table.readerAggregateKey}
        ) between 1 and 2
        and (${table.providerWatermark} is null
          or char_length(${table.providerWatermark}) between 1 and 4096)
        and (${table.readerAggregateKey} is null
          or char_length(${table.readerAggregateKey}) between 1 and 4096)
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_provider_receipt_opaque_payloads_tenant_idx").on(
      table.tenantId,
      table.receiptObservationId,
      table.id
    )
  ]
);

/**
 * Cross-table and mutation invariants installed by migration 0031 after all
 * DB003/DB005 relations exist. Every function has a fixed search_path.
 */
export const INBOX_V2_TIMELINE_MESSAGE_INVARIANTS_SQL = String.raw`
alter table public.inbox_v2_messages
  alter constraint inbox_v2_messages_content_fk
  deferrable initially deferred;

alter table public.inbox_v2_staff_notes
  alter constraint inbox_v2_staff_notes_content_fk
  deferrable initially deferred;

drop trigger if exists inbox_v2_timeline_items_immutable_trigger
  on public.inbox_v2_timeline_items;
drop trigger if exists inbox_v2_messages_immutable_trigger
  on public.inbox_v2_messages;

create or replace function public.inbox_v2_tm_append_only_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  parent_exists boolean := true;
  parent_key text;
  parent_offset integer;
begin
  -- FK cascades invoke the child guard below their RI trigger (depth > 1).
  -- Direct application DELETE reaches this guard at depth 1 and stays blocked.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row
     where tenant_row.id = old_row->>'tenant_id'
  ) then
    return old;
  end if;

  if tg_op = 'DELETE' and tg_nargs > 0 and tg_nargs % 3 = 0 then
    for parent_offset in 0..(tg_nargs / 3 - 1) loop
      parent_key := old_row->>tg_argv[parent_offset * 3 + 2];
      if parent_key is not null then
        execute format(
          'select exists (select 1 from %s where tenant_id = $1 and %I = $2)',
          tg_argv[parent_offset * 3]::regclass,
          tg_argv[parent_offset * 3 + 1]
        )
          into parent_exists
          using old_row->>'tenant_id', parent_key;

        if not parent_exists then
          return old;
        end if;
      end if;
    end loop;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.timeline_message_append_only:%s:%s',
      tg_table_name,
      tg_op
    );
end;
$function$;

create or replace function public.inbox_v2_tm_json_string_fields(
  document jsonb,
  field_names text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(document) = 'object'
    and not exists (
      select 1
        from unnest(field_names) as field_name
       where jsonb_typeof(document->field_name) is distinct from 'string'
    ),
    false
  );
$function$;

create or replace function public.inbox_v2_tm_json_exact_keys(
  document jsonb,
  allowed_keys text[],
  required_keys text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(document) = 'object'
    and pg_column_size(document) <= 65536
    and document ?& required_keys
    and document - allowed_keys = '{}'::jsonb,
    false
  );
$function$;

create or replace function public.inbox_v2_tm_json_family_valid(
  family text,
  document jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  kind text := document->>'kind';
begin
  if family = 'reference' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array['tenantId', 'kind', 'id'],
      array['tenantId', 'kind', 'id']
    ) and public.inbox_v2_tm_json_string_fields(
      document, array['tenantId', 'kind', 'id']
    );
  elsif family = 'adapter_contract' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ],
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ]
    ) and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ]
    );
  elsif family = 'provider_ordering' then
    if kind = 'monotonic_exact' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision'],
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision']
      ) and public.inbox_v2_tm_json_string_fields(
        document,
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision']
      );
    elsif kind = 'incomparable' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'conflictToken'],
        array['kind', 'conflictToken']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'conflictToken']
      );
    elsif kind = 'unavailable' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'reasonId'],
        array['kind', 'reasonId']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'reasonId']
      );
    end if;
    return false;
  elsif family = 'provider_ordering_head' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'semanticFamilyId', 'externalMessageReference',
        'sourceAccount', 'sourceThreadBinding', 'bindingGeneration',
        'scopeToken', 'comparatorId', 'comparatorRevision', 'position',
        'normalizedInboundEvent', 'proofToken', 'revision', 'updatedAt'
      ],
      array[
        'tenantId', 'semanticFamilyId', 'externalMessageReference',
        'sourceAccount', 'sourceThreadBinding', 'bindingGeneration',
        'scopeToken', 'comparatorId', 'comparatorRevision', 'position',
        'normalizedInboundEvent', 'proofToken', 'revision', 'updatedAt'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'semanticFamilyId', 'bindingGeneration', 'scopeToken',
        'comparatorId', 'comparatorRevision', 'position', 'proofToken',
        'revision', 'updatedAt'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'externalMessageReference'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'normalizedInboundEvent'
    );
  elsif family = 'provider_semantic_proof' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'normalizedInboundEvent', 'externalMessageReference',
        'sourceOccurrence', 'sourceAccount', 'sourceThreadBinding',
        'bindingGeneration', 'adapterContract', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision', 'actor',
        'ordering', 'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ],
      array[
        'tenantId', 'normalizedInboundEvent', 'externalMessageReference',
        'sourceOccurrence', 'sourceAccount', 'sourceThreadBinding',
        'bindingGeneration', 'adapterContract', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision', 'actor',
        'ordering', 'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'bindingGeneration', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision',
        'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'normalizedInboundEvent'
    )
    and (
      (document->'externalMessageReference' = 'null'::jsonb
        and document->'sourceOccurrence' = 'null'::jsonb)
      or (public.inbox_v2_tm_json_family_valid(
          'reference', document->'externalMessageReference'
        ) and public.inbox_v2_tm_json_family_valid(
          'reference', document->'sourceOccurrence'
        ))
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    )
    and (
      document->'actor' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid('reference', document->'actor')
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_ordering', document->'ordering'
    );
  elsif family = 'provider_ordering_commit' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array['tenantId', 'semanticFamilyId', 'before', 'proof', 'after', 'committedAt'],
      array['tenantId', 'semanticFamilyId', 'before', 'proof', 'after', 'committedAt']
    )
    and public.inbox_v2_tm_json_string_fields(
      document, array['tenantId', 'semanticFamilyId', 'committedAt']
    )
    and (
      document->'before' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'provider_ordering_head', document->'before'
      )
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_semantic_proof', document->'proof'
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_ordering_head', document->'after'
    );
  elsif family = 'provider_result_proof' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'operation', 'outboundRoute', 'adapterContract',
        'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ],
      array[
        'tenantId', 'operation', 'outboundRoute', 'adapterContract',
        'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'operation'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'outboundRoute'
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    );
  elsif family = 'reaction_value' then
    if kind = 'unicode' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'value'], array['kind', 'value']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'value']
      );
    elsif kind = 'provider_custom' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'providerKindId', 'canonicalCode'],
        array['kind', 'providerKindId', 'canonicalCode']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'providerKindId', 'canonicalCode']
      );
    end if;
    return false;
  elsif family = 'reaction_capability' then
    if kind = 'internal' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'cardinality'], array['kind', 'cardinality']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'cardinality']
      );
    elsif kind = 'external' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'capabilityId', 'capabilityRevision', 'cardinality',
          'adapterContract'
        ],
        array[
          'kind', 'capabilityId', 'capabilityRevision', 'cardinality',
          'adapterContract'
        ]
      ) and public.inbox_v2_tm_json_string_fields(
        document,
        array['kind', 'capabilityId', 'capabilityRevision', 'cardinality']
      ) and public.inbox_v2_tm_json_family_valid(
        'adapter_contract', document->'adapterContract'
      );
    end if;
    return false;
  elsif family in ('reaction_canonical', 'reaction_desired') then
    if kind = 'active' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'value'], array['kind', 'value']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind']
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_value', document->'value'
      );
    elsif kind = 'cleared' then
      if family = 'reaction_canonical' then
        return public.inbox_v2_tm_json_exact_keys(
          document,
          array['kind', 'lastValue', 'clearedAt'],
          array['kind', 'lastValue', 'clearedAt']
        ) and public.inbox_v2_tm_json_string_fields(
          document, array['kind', 'clearedAt']
        ) and public.inbox_v2_tm_json_family_valid(
          'reaction_value', document->'lastValue'
        );
      end if;
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'lastValue'],
        array['kind', 'lastValue']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind']
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_value', document->'lastValue'
      );
    end if;
    return false;
  elsif family = 'app_actor' then
    if kind = 'employee' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'employee', 'authorizationEpoch'],
        array['kind', 'employee', 'authorizationEpoch']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'authorizationEpoch']
      ) and public.inbox_v2_tm_json_family_valid(
        'reference', document->'employee'
      );
    elsif kind = 'trusted_service' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'trustedServiceId'],
        array['kind', 'trustedServiceId']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'trustedServiceId']
      );
    end if;
    return false;
  elsif family = 'automation_causation' then
    if kind = 'employee_command' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'initiatingActor', 'causeEvent', 'correlationId', 'causedAt'],
        array['kind', 'initiatingActor', 'causeEvent', 'correlationId', 'causedAt']
      )
      and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'correlationId', 'causedAt']
      )
      and public.inbox_v2_tm_json_family_valid(
        'app_actor', document->'initiatingActor'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'causeEvent'
      );
    elsif kind = 'system_event' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'causeEvent', 'correlationId', 'causedAt'],
        array['kind', 'causeEvent', 'correlationId', 'causedAt']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'correlationId', 'causedAt']
      ) and public.inbox_v2_tm_json_family_valid(
        'reference', document->'causeEvent'
      );
    end if;
    return false;
  elsif family = 'reaction_attribution' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'actionParticipant', 'appActor', 'sourceOccurrence',
        'automationCausation'
      ],
      array[
        'actionParticipant', 'appActor', 'sourceOccurrence',
        'automationCausation'
      ]
    )
    and (
      document->'actionParticipant' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'actionParticipant'
      )
    )
    and (
      document->'appActor' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'app_actor', document->'appActor'
      )
    )
    and (
      document->'sourceOccurrence' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'sourceOccurrence'
      )
    )
    and (
      document->'automationCausation' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'automation_causation', document->'automationCausation'
      )
    );
  elsif family = 'reaction_state' then
    if kind in ('active', 'cleared') then
      return public.inbox_v2_tm_json_family_valid(
        'reaction_canonical', document
      );
    elsif kind = 'pending_external' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'operation', 'desired', 'confirmedBefore', 'outboundRoute',
          'requestTransition', 'requestAttribution', 'requestedAt'
        ],
        array[
          'kind', 'operation', 'desired', 'confirmedBefore', 'outboundRoute',
          'requestTransition', 'requestAttribution', 'requestedAt'
        ]
      )
      and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'operation', 'requestedAt']
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_desired', document->'desired'
      )
      and (
        document->'confirmedBefore' = 'null'::jsonb
        or public.inbox_v2_tm_json_family_valid(
          'reaction_canonical', document->'confirmedBefore'
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'requestTransition'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_attribution', document->'requestAttribution'
      );
    elsif kind = 'external_terminal' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'operation', 'desired', 'confirmedState', 'outboundRoute',
          'requestTransition', 'outcome', 'resultToken', 'resultDigestSha256',
          'resolvedAt'
        ],
        array[
          'kind', 'operation', 'desired', 'confirmedState', 'outboundRoute',
          'requestTransition', 'outcome', 'resultToken', 'resultDigestSha256',
          'resolvedAt'
        ]
      )
      and public.inbox_v2_tm_json_string_fields(
        document,
        array[
          'kind', 'operation', 'outcome', 'resultToken',
          'resultDigestSha256', 'resolvedAt'
        ]
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_desired', document->'desired'
      )
      and (
        document->'confirmedState' = 'null'::jsonb
        or public.inbox_v2_tm_json_family_valid(
          'reaction_canonical', document->'confirmedState'
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'requestTransition'
      );
    end if;
    return false;
  elsif family = 'reaction_fence' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'capabilityId', 'capabilityRevision', 'adapterContract', 'decision',
        'evaluatedAt', 'notAfter'
      ],
      array[
        'capabilityId', 'capabilityRevision', 'adapterContract', 'decision',
        'evaluatedAt', 'notAfter'
      ]
    ) and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'capabilityId', 'capabilityRevision', 'decision',
        'evaluatedAt', 'notAfter'
      ]
    ) and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    );
  elsif family = 'reaction_authority' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'externalMessageReference', 'sourceOccurrence', 'sourceAccount',
        'sourceThreadBinding', 'bindingGeneration', 'outboundRoute',
        'adapterContract', 'capabilityFence'
      ],
      array[
        'externalMessageReference', 'sourceOccurrence', 'sourceAccount',
        'sourceThreadBinding', 'bindingGeneration', 'outboundRoute',
        'adapterContract', 'capabilityFence'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document, array['bindingGeneration']
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'externalMessageReference'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceOccurrence'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and (
      document->'outboundRoute' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reaction_fence', document->'capabilityFence'
    );
  end if;

  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_value_flat_valid(
  state_detail jsonb,
  expected_state_kind text,
  expected_value_kind text,
  expected_unicode_value text,
  expected_provider_reaction_kind_id text,
  expected_provider_canonical_code text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  desired_detail jsonb;
  value_detail jsonb;
begin
  if state_detail #>> '{kind}' is distinct from expected_state_kind then
    return false;
  end if;

  desired_detail := case expected_state_kind
    when 'active' then state_detail
    when 'cleared' then state_detail
    when 'pending_external' then state_detail -> 'desired'
    when 'external_terminal' then state_detail -> 'desired'
    else null
  end;
  if desired_detail is null then
    return false;
  end if;

  value_detail := case desired_detail #>> '{kind}'
    when 'active' then desired_detail -> 'value'
    when 'cleared' then desired_detail -> 'lastValue'
    else null
  end;
  if value_detail is null
     or value_detail #>> '{kind}' is distinct from expected_value_kind then
    return false;
  end if;

  if expected_value_kind = 'unicode' then
    return value_detail #>> '{value}' is not distinct from
        expected_unicode_value
      and expected_provider_reaction_kind_id is null
      and expected_provider_canonical_code is null;
  end if;
  if expected_value_kind = 'provider_custom' then
    return expected_unicode_value is null
      and value_detail #>> '{providerKindId}' is not distinct from
        expected_provider_reaction_kind_id
      and value_detail #>> '{canonicalCode}' is not distinct from
        expected_provider_canonical_code;
  end if;
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_transition_state_valid(
  before_state_detail jsonb,
  after_state_detail jsonb,
  transition_mode text,
  transition_operation text,
  transition_recorded_at timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  before_kind text := before_state_detail #>> '{kind}';
  after_kind text := after_state_detail #>> '{kind}';
  before_confirmed jsonb;
  after_desired jsonb;
  confirming_request boolean;
begin
  before_confirmed := case
    when before_state_detail is null then 'null'::jsonb
    when before_kind = 'pending_external' then
      before_state_detail -> 'confirmedBefore'
    when before_kind = 'external_terminal' then
      before_state_detail -> 'confirmedState'
    else before_state_detail
  end;

  after_desired := case
    when after_kind = 'active' then jsonb_build_object(
      'kind', 'active', 'value', after_state_detail -> 'value'
    )
    when after_kind = 'cleared' then jsonb_build_object(
      'kind', 'cleared', 'lastValue', after_state_detail -> 'lastValue'
    )
    when after_kind in ('pending_external', 'external_terminal') then
      after_state_detail -> 'desired'
    else null
  end;
  if after_desired is null then
    return false;
  end if;

  if transition_mode = 'provider_result' then
    return coalesce(before_kind = 'pending_external'
      and after_kind = 'external_terminal'
      and before_state_detail #>> '{operation}' = transition_operation
      and after_state_detail #>> '{operation}' = transition_operation
      and after_state_detail -> 'desired' =
        before_state_detail -> 'desired'
      and after_state_detail -> 'confirmedState' =
        before_state_detail -> 'confirmedBefore'
      and after_state_detail -> 'outboundRoute' =
        before_state_detail -> 'outboundRoute'
      and after_state_detail -> 'requestTransition' =
        before_state_detail -> 'requestTransition'
      and (after_state_detail #>> '{resolvedAt}')::timestamptz =
        transition_recorded_at, false);
  end if;

  if transition_mode = 'external_request'
     and (
       after_kind <> 'pending_external'
       or after_state_detail -> 'confirmedBefore' is distinct from
         before_confirmed
     ) then
    return false;
  end if;

  confirming_request := transition_mode = 'provider_observed'
    and (
      before_kind = 'pending_external'
      or (
        before_kind = 'external_terminal'
        and before_state_detail #>> '{outcome}' = 'outcome_unknown'
      )
    );
  if confirming_request then
    return coalesce(
      before_state_detail #>> '{operation}' = transition_operation
        and before_state_detail -> 'desired' = after_desired,
      false
    );
  end if;

  if transition_operation = 'set' then
    return coalesce((
        before_confirmed = 'null'::jsonb
        or before_confirmed #>> '{kind}' = 'cleared'
      )
      and after_desired #>> '{kind}' = 'active', false);
  end if;
  if transition_operation = 'replace' then
    return coalesce(before_confirmed #>> '{kind}' = 'active'
      and after_desired #>> '{kind}' = 'active'
      and before_confirmed -> 'value' is distinct from
        after_desired -> 'value', false);
  end if;
  if transition_operation = 'clear' then
    return coalesce(before_confirmed #>> '{kind}' = 'active'
      and after_desired #>> '{kind}' = 'cleared'
      and before_confirmed -> 'value' = after_desired -> 'lastValue', false);
  end if;
  return false;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_attribution_row_valid(
  expected_tenant_id text,
  expected_attribution_id text,
  attribution_detail jsonb,
  expected_created_at timestamptz
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_action_attributions attribution_row
     where attribution_row.tenant_id = expected_tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.created_at = expected_created_at
       and (
         (
           attribution_detail -> 'actionParticipant' = 'null'::jsonb
           and attribution_row.action_participant_id is null
         )
         or (
           attribution_detail #>> '{actionParticipant,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{actionParticipant,kind}' =
             'conversation_participant'
           and attribution_detail #>> '{actionParticipant,id}' =
             attribution_row.action_participant_id
         )
       )
       and (
         (
           attribution_detail -> 'appActor' = 'null'::jsonb
           and num_nonnulls(
             attribution_row.app_actor_kind,
             attribution_row.app_actor_employee_id,
             attribution_row.app_authorization_epoch,
             attribution_row.app_trusted_service_id
           ) = 0
         )
         or (
           attribution_detail #>> '{appActor,kind}' = 'employee'
           and attribution_detail #>> '{appActor,employee,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{appActor,employee,kind}' = 'employee'
           and attribution_row.app_actor_kind = 'employee'
           and attribution_detail #>> '{appActor,employee,id}' =
             attribution_row.app_actor_employee_id
           and attribution_detail #>> '{appActor,authorizationEpoch}' =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_detail #>> '{appActor,kind}' = 'trusted_service'
           and attribution_row.app_actor_kind = 'trusted_service'
           and attribution_detail #>> '{appActor,trustedServiceId}' =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and (
         (
           attribution_detail -> 'sourceOccurrence' = 'null'::jsonb
           and attribution_row.source_occurrence_id is null
         )
         or (
           attribution_detail #>> '{sourceOccurrence,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{sourceOccurrence,kind}' =
             'source_occurrence'
           and attribution_detail #>> '{sourceOccurrence,id}' =
             attribution_row.source_occurrence_id
         )
       )
       and (
         (
           attribution_detail -> 'automationCausation' = 'null'::jsonb
           and num_nonnulls(
             attribution_row.automation_kind,
             attribution_row.automation_cause_event_id,
             attribution_row.automation_correlation_id,
             attribution_row.automation_caused_at,
             attribution_row.automation_initiating_employee_id,
             attribution_row.automation_initiating_authorization_epoch
           ) = 0
         )
         or (
           attribution_detail #>> '{automationCausation,kind}' =
             'system_event'
           and attribution_row.automation_kind = 'system_event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,tenantId}' = expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,causeEvent,kind}' = 'event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,id}' =
               attribution_row.automation_cause_event_id
           and attribution_detail #>>
             '{automationCausation,correlationId}' =
               attribution_row.automation_correlation_id
           and (attribution_detail #>>
             '{automationCausation,causedAt}')::timestamptz =
               attribution_row.automation_caused_at
           and attribution_row.automation_initiating_employee_id is null
           and attribution_row.automation_initiating_authorization_epoch is null
         )
         or (
           attribution_detail #>> '{automationCausation,kind}' =
             'employee_command'
           and attribution_row.automation_kind = 'employee_command'
           and attribution_detail #>>
             '{automationCausation,causeEvent,tenantId}' = expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,causeEvent,kind}' = 'event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,id}' =
               attribution_row.automation_cause_event_id
           and attribution_detail #>>
             '{automationCausation,correlationId}' =
               attribution_row.automation_correlation_id
           and (attribution_detail #>>
             '{automationCausation,causedAt}')::timestamptz =
               attribution_row.automation_caused_at
           and attribution_detail #>>
             '{automationCausation,initiatingActor,kind}' = 'employee'
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,tenantId}' =
               expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,kind}' = 'employee'
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,id}' =
               attribution_row.automation_initiating_employee_id
           and attribution_detail #>>
             '{automationCausation,initiatingActor,authorizationEpoch}' =
               attribution_row.automation_initiating_authorization_epoch
         )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_reaction_authority_flat_valid(
  authority_detail jsonb,
  expected_tenant_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_outbound_route_id text,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_occurred_at timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return
    authority_detail #>> '{externalMessageReference,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{externalMessageReference,kind}' =
      'external_message_reference'
    and authority_detail #>> '{externalMessageReference,id}' =
      expected_external_message_reference_id
    and authority_detail #>> '{sourceOccurrence,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
    and authority_detail #>> '{sourceOccurrence,id}' =
      expected_source_occurrence_id
    and authority_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and authority_detail #>> '{sourceAccount,kind}' = 'source_account'
    and authority_detail #>> '{sourceAccount,id}' = expected_source_account_id
    and authority_detail #>> '{sourceThreadBinding,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and authority_detail #>> '{sourceThreadBinding,id}' =
      expected_source_thread_binding_id
    and authority_detail #>> '{bindingGeneration}' =
      expected_binding_generation::text
    and (
      (
        expected_outbound_route_id is null
        and authority_detail -> 'outboundRoute' = 'null'::jsonb
      )
      or (
        expected_outbound_route_id is not null
        and authority_detail #>> '{outboundRoute,tenantId}' =
          expected_tenant_id
        and authority_detail #>> '{outboundRoute,kind}' = 'outbound_route'
        and authority_detail #>> '{outboundRoute,id}' =
          expected_outbound_route_id
      )
    )
    and authority_detail #>> '{adapterContract,contractId}' =
      expected_adapter_contract_id
    and authority_detail #>> '{adapterContract,contractVersion}' =
      expected_adapter_contract_version
    and authority_detail -> 'adapterContract' =
      authority_detail #> '{capabilityFence,adapterContract}'
    and authority_detail #>> '{capabilityFence,capabilityId}' =
      expected_capability_id
    and authority_detail #>> '{capabilityFence,capabilityRevision}' =
      expected_capability_revision::text
    and authority_detail #>> '{capabilityFence,decision}' = 'supported'
    and isfinite((authority_detail #>>
      '{adapterContract,loadedAt}')::timestamptz)
    and (authority_detail #>> '{adapterContract,loadedAt}')::timestamptz <=
      expected_occurred_at
    and isfinite((authority_detail #>>
      '{capabilityFence,evaluatedAt}')::timestamptz)
    and isfinite((authority_detail #>>
      '{capabilityFence,notAfter}')::timestamptz)
    and (authority_detail #>>
      '{capabilityFence,evaluatedAt}')::timestamptz <= expected_occurred_at
    and (authority_detail #>>
      '{capabilityFence,notAfter}')::timestamptz >= expected_occurred_at;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_outbound_route_action_valid(
  expected_tenant_id text,
  expected_route_id text,
  expected_message_id text,
  expected_reference_owner_message_id text,
  expected_conversation_id text,
  expected_authority_at timestamptz,
  expected_attribution_created_at timestamptz,
  expected_operation_id text,
  expected_required_permission_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_attribution_id text,
  require_explicit_occurrence boolean
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return exists (
    select 1
      from public.inbox_v2_outbound_routes route_row
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = route_row.tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = route_row.tenant_id
       and message_row.id = expected_message_id
       and message_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_source_thread_binding_snapshots binding_snapshot
        on binding_snapshot.tenant_id = route_row.tenant_id
       and binding_snapshot.binding_id = route_row.source_thread_binding_id
       and binding_snapshot.revision = route_row.binding_revision
       and binding_snapshot.external_thread_id = route_row.external_thread_id
       and binding_snapshot.source_connection_id = route_row.source_connection_id
       and binding_snapshot.source_account_id = route_row.source_account_id
       and binding_snapshot.account_generation = route_row.account_generation
       and binding_snapshot.binding_generation = route_row.binding_generation
       and binding_snapshot.remote_access_revision =
         route_row.remote_access_revision
       and binding_snapshot.administrative_revision =
         route_row.administrative_revision
       and binding_snapshot.capability_revision = route_row.capability_revision
       and binding_snapshot.route_descriptor_revision =
         route_row.route_descriptor_revision
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = route_row.tenant_id
       and occurrence_row.id = expected_source_occurrence_id
       and occurrence_row.conversation_id = route_row.conversation_id
       and occurrence_row.external_thread_id = route_row.external_thread_id
       and occurrence_row.source_thread_binding_id =
         route_row.source_thread_binding_id
       and occurrence_row.source_connection_id = route_row.source_connection_id
       and occurrence_row.source_account_id = route_row.source_account_id
       and occurrence_row.binding_generation = route_row.binding_generation
       and occurrence_row.adapter_contract_id = route_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         route_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         route_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = route_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = route_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = route_row.tenant_id
       and reference_row.id = expected_external_message_reference_id
       and reference_row.external_thread_id = route_row.external_thread_id
      left join public.inbox_v2_source_thread_binding_capability_entries capability_row
        on capability_row.tenant_id = route_row.tenant_id
       and capability_row.binding_id = route_row.source_thread_binding_id
       and capability_row.materialized_by_binding_revision =
         route_row.binding_revision
       and capability_row.capability_revision = route_row.capability_revision
       and (
         expected_capability_id is null
         or capability_row.capability_id = expected_capability_id
       )
       and capability_row.operation_id = route_row.operation_id
       and capability_row.content_kind_id is not distinct from
         route_row.content_kind_id
     where route_row.tenant_id = expected_tenant_id
       and route_row.id = expected_route_id
       and route_row.conversation_id = expected_conversation_id
       and route_row.operation_id = expected_operation_id
       and route_row.required_conversation_permission_id =
         expected_required_permission_id
       and (
         expected_source_account_id is null
         or route_row.source_account_id = expected_source_account_id
       )
       and (
         expected_source_thread_binding_id is null
         or route_row.source_thread_binding_id =
           expected_source_thread_binding_id
       )
       and (
         expected_binding_generation is null
         or route_row.binding_generation = expected_binding_generation
       )
       and (
         expected_adapter_contract_id is null
         or (
           route_row.adapter_contract_id = expected_adapter_contract_id
           and route_row.adapter_contract_version =
             expected_adapter_contract_version
           and route_row.adapter_declaration_revision =
             expected_adapter_declaration_revision
           and route_row.adapter_surface_id = expected_adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             expected_adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = expected_adapter_loaded_at
         )
       )
       and (
         expected_capability_revision is null
         or route_row.capability_revision = expected_capability_revision
       )
       and binding_snapshot.remote_access_state = 'active'
       and binding_snapshot.administrative_state = 'enabled'
       and binding_snapshot.runtime_health_state = 'ready'
       and binding_snapshot.capability_contract_id =
         route_row.adapter_contract_id
       and binding_snapshot.capability_contract_version =
         route_row.adapter_contract_version
       and binding_snapshot.capability_declaration_revision =
         route_row.adapter_declaration_revision
       and binding_snapshot.capability_surface_id = route_row.adapter_surface_id
       and binding_snapshot.capability_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and binding_snapshot.capability_loaded_at = route_row.adapter_loaded_at
       and binding_snapshot.updated_at <= expected_authority_at
       and binding_snapshot.capability_captured_at <= expected_authority_at
       and (
         (
           expected_external_message_reference_id is null
           and expected_source_occurrence_id is null
           and route_row.reference_context_snapshot =
             '{"kind":"none"}'::jsonb
         )
         or (
           expected_external_message_reference_id is not null
           and expected_source_occurrence_id is not null
           and occurrence_row.id is not null
           and reference_row.id is not null
           and (
             expected_reference_owner_message_id is null
             or reference_row.message_id =
               expected_reference_owner_message_id
           )
           and route_row.reference_context_snapshot #>> '{kind}' =
             'external_message'
           and route_row.reference_context_snapshot #>>
             '{externalMessageReference,id}' =
               expected_external_message_reference_id
           and route_row.reference_context_snapshot #>>
             '{sourceOccurrence,id}' = expected_source_occurrence_id
         )
       )
       and (
         not require_explicit_occurrence
         or (
           route_row.selection_intent_kind = 'explicit_occurrence'
           and route_row.selection_reason = 'explicit_occurrence'
           and route_row.selection_intent_snapshot #>> '{occurrence,id}' =
             expected_source_occurrence_id
         )
       )
       and attribution_row.created_at = expected_attribution_created_at
       and attribution_row.source_occurrence_id is null
       and (
         (
           attribution_row.app_actor_kind = 'employee'
           and route_row.principal_kind = 'employee'
           and route_row.principal_employee_id =
             attribution_row.app_actor_employee_id
           and route_row.authorization_epoch =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_row.app_actor_kind = 'trusted_service'
           and route_row.principal_kind = 'trusted_service'
           and route_row.principal_trusted_service_id =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and capability_row.state = 'supported'
       and (
         capability_row.valid_until is null
         or capability_row.valid_until >= expected_authority_at
       )
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_required_roles
             required_role
          where required_role.tenant_id = capability_row.tenant_id
            and required_role.binding_id = capability_row.binding_id
            and required_role.capability_revision =
              capability_row.capability_revision
            and required_role.capability_ordinal = capability_row.ordinal
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_provider_roles
                  provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                   binding_snapshot.provider_access_revision
                 and provider_role.provider_role_id =
                   required_role.provider_role_id
            )
       )
       and route_row.runtime_observation_snapshot #>> '{state}' = 'ready'
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at
       and route_row.selected_at <= expected_authority_at
       and route_row.created_at <= expected_authority_at
       and route_row.candidate_snapshot_not_after >= expected_authority_at
       and (route_row.conversation_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (route_row.source_account_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (
         expected_external_message_reference_id is null
         or (
           (route_row.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >=
               expected_authority_at
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
           and (
             route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,state}' <> 'valid'
             or (route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
                 expected_authority_at
           )
         )
       )
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_json_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  valid boolean := false;
begin
  case tg_table_name
    when 'inbox_v2_message_provider_lifecycle_operations' then
      valid := (
        (new.provider_semantic_proof_detail is null
          and new.semantic_ordering_commit_detail is null)
        or (public.inbox_v2_tm_json_family_valid(
            'provider_semantic_proof', new.provider_semantic_proof_detail
          ) and public.inbox_v2_tm_json_family_valid(
            'provider_ordering_commit', new.semantic_ordering_commit_detail
          ))
      );
    when 'inbox_v2_message_provider_lifecycle_transitions' then
      valid := new.result_proof_adapter_contract_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'adapter_contract', new.result_proof_adapter_contract_detail
        );
    when 'inbox_v2_message_reactions' then
      valid := public.inbox_v2_tm_json_family_valid(
        'reaction_capability', new.capability_detail
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_state', new.state_detail
      ) and public.inbox_v2_tm_reaction_value_flat_valid(
        new.state_detail,
        new.state_kind::text,
        new.value_kind::text,
        new.unicode_value,
        new.provider_reaction_kind_id,
        new.provider_canonical_code
      ) and new.capability_detail #>> '{kind}' = new.capability_kind::text
      and new.capability_detail #>> '{cardinality}' = new.cardinality::text
      and (
        new.capability_kind = 'internal'
        or (
          new.capability_detail #>> '{capabilityId}' = new.capability_id
          and new.capability_detail #>> '{capabilityRevision}' =
            new.capability_revision::text
          and new.capability_detail #>> '{adapterContract,contractId}' =
            new.adapter_contract_id
          and new.capability_detail #>> '{adapterContract,contractVersion}' =
            new.adapter_contract_version
        )
      )
      and (
        new.state_kind = 'active'
        or (
          new.state_kind = 'cleared'
          and (new.state_detail #>> '{clearedAt}')::timestamptz =
            new.cleared_at
        )
        or (
          new.state_kind = 'pending_external'
          and new.state_detail #>> '{operation}' =
            new.external_operation::text
          and new.state_detail #>> '{outboundRoute,tenantId}' = new.tenant_id
          and new.state_detail #>> '{outboundRoute,kind}' = 'outbound_route'
          and new.state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.state_detail #>> '{requestTransition,id}' =
            new.request_transition_id
          and (new.state_detail #>> '{requestedAt}')::timestamptz =
            new.updated_at
        )
        or (
          new.state_kind = 'external_terminal'
          and new.state_detail #>> '{operation}' =
            new.external_operation::text
          and new.state_detail #>> '{outboundRoute,tenantId}' = new.tenant_id
          and new.state_detail #>> '{outboundRoute,kind}' = 'outbound_route'
          and new.state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.state_detail #>> '{requestTransition,id}' =
            new.request_transition_id
          and new.state_detail #>> '{outcome}' = new.external_outcome
          and new.state_detail #>> '{resultToken}' = new.result_token
          and new.state_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.state_detail #>> '{resolvedAt}')::timestamptz =
            new.resolved_at
        )
      );
    when 'inbox_v2_message_reaction_transitions' then
      valid := (
        new.before_state_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'reaction_state', new.before_state_detail
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_state', new.after_state_detail
      )
      and public.inbox_v2_tm_reaction_value_flat_valid(
        new.after_state_detail,
        new.after_state_kind::text,
        new.value_kind::text,
        new.unicode_value,
        new.provider_reaction_kind_id,
        new.provider_canonical_code
      )
      and public.inbox_v2_tm_reaction_transition_state_valid(
        new.before_state_detail,
        new.after_state_detail,
        new.mode::text,
        new.operation::text,
        new.recorded_at
      )
      and (
        (
          new.after_state_kind = 'active'
          and new.mode in ('internal_apply', 'provider_observed')
        )
        or (
          new.after_state_kind = 'cleared'
          and new.mode in ('internal_apply', 'provider_observed')
          and (new.after_state_detail #>> '{clearedAt}')::timestamptz =
            new.recorded_at
        )
        or (
          new.after_state_kind = 'pending_external'
          and new.mode = 'external_request'
          and new.after_state_detail #>> '{operation}' = new.operation::text
          and new.after_state_detail #>> '{outboundRoute,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.after_state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.after_state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.after_state_detail #>> '{requestTransition,id}' = new.id
          and public.inbox_v2_tm_reaction_attribution_row_valid(
            new.tenant_id,
            new.action_attribution_id,
            new.after_state_detail -> 'requestAttribution',
            new.recorded_at
          )
          and (new.after_state_detail #>> '{requestedAt}')::timestamptz =
            new.recorded_at
        )
        or (
          new.after_state_kind = 'external_terminal'
          and new.mode = 'provider_result'
          and new.before_state_detail #>> '{kind}' = 'pending_external'
          and public.inbox_v2_tm_reaction_attribution_row_valid(
            new.tenant_id,
            new.action_attribution_id,
            new.before_state_detail -> 'requestAttribution',
            new.recorded_at
          )
          and new.after_state_detail #>> '{operation}' = new.operation::text
          and new.after_state_detail -> 'outboundRoute' =
            new.before_state_detail -> 'outboundRoute'
          and new.after_state_detail -> 'requestTransition' =
            new.before_state_detail -> 'requestTransition'
          and new.after_state_detail #>> '{outboundRoute,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.after_state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.after_state_detail #>> '{outcome}' =
            new.provider_result_proof_detail #>> '{resultState}'
          and new.after_state_detail #>> '{resultToken}' = new.result_token
          and new.after_state_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.after_state_detail #>> '{resolvedAt}')::timestamptz =
            new.recorded_at
          and new.provider_result_proof_detail #>> '{tenantId}' =
            new.tenant_id
          and new.provider_result_proof_detail #>> '{operation,tenantId}' =
            new.tenant_id
          and new.provider_result_proof_detail #>> '{operation,kind}' =
            'message_reaction_transition'
          and new.provider_result_proof_detail #>> '{operation,id}' =
            new.after_state_detail #>> '{requestTransition,id}'
          and new.provider_result_proof_detail #>>
            '{outboundRoute,tenantId}' = new.tenant_id
          and new.provider_result_proof_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.provider_result_proof_detail #>> '{outboundRoute,id}' =
            new.after_state_detail #>> '{outboundRoute,id}'
          and new.provider_result_proof_detail #>> '{resultToken}' =
            new.result_token
          and new.provider_result_proof_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.provider_result_proof_detail #>>
            '{recordedAt}')::timestamptz = new.recorded_at
        )
      )
      and (
        new.external_authority_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'reaction_authority', new.external_authority_detail
        )
      )
      and (
        new.mode not in ('external_request', 'provider_observed')
        or public.inbox_v2_tm_reaction_authority_flat_valid(
          new.external_authority_detail,
          new.tenant_id,
          new.external_message_reference_id,
          new.source_occurrence_id,
          new.source_account_id,
          new.source_thread_binding_id,
          new.binding_generation,
          new.outbound_route_id,
          new.adapter_contract_id,
          new.adapter_contract_version,
          new.capability_id,
          new.capability_revision,
          new.occurred_at
        )
      )
      and (
        new.mode <> 'external_request'
        or exists (
          select 1
            from public.inbox_v2_message_reactions reaction_row
            join public.inbox_v2_messages message_row
              on message_row.tenant_id = reaction_row.tenant_id
             and message_row.id = reaction_row.message_id
           where reaction_row.tenant_id = new.tenant_id
             and reaction_row.id = new.reaction_id
             and public.inbox_v2_tm_outbound_route_action_valid(
               new.tenant_id,
               new.outbound_route_id,
               reaction_row.message_id,
               reaction_row.message_id,
               message_row.conversation_id,
               new.occurred_at,
               new.recorded_at,
               'core:message.reaction.' || new.operation::text,
               'core:message.reaction.' || new.operation::text || '_external',
               new.external_message_reference_id,
               new.source_occurrence_id,
               new.source_account_id,
               new.source_thread_binding_id,
               new.binding_generation,
               new.adapter_contract_id,
               new.adapter_contract_version,
               (new.external_authority_detail #>>
                 '{adapterContract,declarationRevision}')::bigint,
               new.external_authority_detail #>>
                 '{adapterContract,surfaceId}',
               new.external_authority_detail #>>
                 '{adapterContract,loadedByTrustedServiceId}',
               (new.external_authority_detail #>>
                 '{adapterContract,loadedAt}')::timestamptz,
               new.capability_id,
               new.capability_revision,
               new.action_attribution_id,
               true
             )
        )
      )
      and (
        new.provider_result_proof_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'provider_result_proof', new.provider_result_proof_detail
        )
      )
      and (
        new.mode <> 'provider_result'
        or exists (
          select 1
            from public.inbox_v2_message_reactions reaction_row
            join public.inbox_v2_messages message_row
              on message_row.tenant_id = reaction_row.tenant_id
             and message_row.id = reaction_row.message_id
            join public.inbox_v2_outbound_routes route_row
              on route_row.tenant_id = reaction_row.tenant_id
             and route_row.id = new.provider_result_proof_detail #>>
               '{outboundRoute,id}'
             and route_row.conversation_id = message_row.conversation_id
            join public.inbox_v2_message_reaction_transitions request_row
              on request_row.tenant_id = reaction_row.tenant_id
             and request_row.id = new.provider_result_proof_detail #>>
               '{operation,id}'
             and request_row.reaction_id = reaction_row.id
             and request_row.mode = 'external_request'
             and request_row.resulting_revision = new.expected_revision
             and request_row.outbound_route_id = route_row.id
           where reaction_row.tenant_id = new.tenant_id
             and reaction_row.id = new.reaction_id
             and reaction_row.capability_kind = 'external'
             and new.provider_result_proof_detail #>> '{revision}' = '1'
             and new.provider_result_proof_detail #>> '{capabilityId}' =
               reaction_row.capability_id
             and new.provider_result_proof_detail #>>
               '{capabilityRevision}' = reaction_row.capability_revision::text
             and new.provider_result_proof_detail -> 'adapterContract' =
               reaction_row.capability_detail -> 'adapterContract'
             and new.provider_result_proof_detail #>> '{semanticId}' =
               'core:message.reaction.' || new.operation::text || '.result'
             and new.provider_result_proof_detail #>> '{semanticRevision}' ~
               '^[1-9][0-9]*$'
             and char_length(new.provider_result_proof_detail #>>
               '{semanticRevision}') <= 19
             and (
               char_length(new.provider_result_proof_detail #>>
                 '{semanticRevision}') < 19
               or (new.provider_result_proof_detail #>>
                 '{semanticRevision}') collate "C" <=
                   '9223372036854775807'
             )
             and new.provider_result_proof_detail #>>
               '{declaredByTrustedServiceId}' =
                 new.provider_result_proof_detail #>>
                   '{adapterContract,loadedByTrustedServiceId}'
             and isfinite((new.provider_result_proof_detail #>>
               '{adapterContract,loadedAt}')::timestamptz)
             and (new.provider_result_proof_detail #>>
               '{adapterContract,loadedAt}')::timestamptz <= new.recorded_at
             and route_row.adapter_contract_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,contractId}'
             and route_row.adapter_contract_version =
               new.provider_result_proof_detail #>>
                 '{adapterContract,contractVersion}'
             and route_row.adapter_declaration_revision::text =
               new.provider_result_proof_detail #>>
                 '{adapterContract,declarationRevision}'
             and route_row.adapter_surface_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,surfaceId}'
             and route_row.adapter_loaded_by_trusted_service_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,loadedByTrustedServiceId}'
             and route_row.adapter_loaded_at =
               (new.provider_result_proof_detail #>>
                 '{adapterContract,loadedAt}')::timestamptz
             and route_row.capability_revision =
               reaction_row.capability_revision
        )
      )
      and exists (
        select 1
          from public.inbox_v2_message_reactions reaction_row
          join public.inbox_v2_action_attributions attribution_row
            on attribution_row.tenant_id = new.tenant_id
           and attribution_row.id = new.action_attribution_id
         where reaction_row.tenant_id = new.tenant_id
           and reaction_row.id = new.reaction_id
           and (
             new.operation <> 'replace'
             or (
               reaction_row.capability_kind = 'external'
               and reaction_row.cardinality = 'single_value'
             )
           )
           and (
             (
               new.mode = 'internal_apply'
               and reaction_row.capability_kind = 'internal'
               and attribution_row.app_actor_kind is not null
               and attribution_row.source_occurrence_id is null
             )
             or (
               new.mode in ('external_request', 'provider_result')
               and reaction_row.capability_kind = 'external'
               and attribution_row.app_actor_kind is not null
               and attribution_row.source_occurrence_id is null
             )
             or (
               new.mode = 'provider_observed'
               and reaction_row.capability_kind = 'external'
               and attribution_row.app_actor_kind is null
               and attribution_row.source_occurrence_id =
                 new.source_occurrence_id
             )
           )
      );
    when 'inbox_v2_message_provider_reaction_observations' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_semantic_proof', new.semantic_proof_detail
      ) and public.inbox_v2_tm_json_family_valid(
        'provider_ordering_commit', new.ordering_commit_detail
      );
    when 'inbox_v2_provider_semantic_ordering_heads' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_ordering_head', new.head_detail
      );
    when 'inbox_v2_message_delivery_observations' then
      valid := new.semantic_proof_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'provider_semantic_proof', new.semantic_proof_detail
        );
    when 'inbox_v2_provider_receipt_observations' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_semantic_proof', new.semantic_proof_detail
      );
    else
      valid := false;
  end case;

  if not coalesce(valid, false) then
    raise exception using errcode = '23514',
      message = format(
        'inbox_v2.timeline_message_json_contract:%s', tg_table_name
      );
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_lifecycle_history_valid(
  expected_tenant_id text,
  expected_operation_id text
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  operation_row record;
  transition_row record;
  predecessor_row record;
  before_outcome text;
  before_outcome_retryable integer;
  before_outcome_reason_id text;
  before_delete_local_effect text;
  before_policy_decision_event_id text;
  before_policy_decision_revision bigint;
  before_policy_decided_at timestamptz;
  outcome_changed boolean;
  policy_changed boolean;
  proof_field_count integer;
begin
  select * into operation_row
    from public.inbox_v2_message_provider_lifecycle_operations
   where tenant_id = expected_tenant_id
     and id = expected_operation_id;
  if not found then
    return false;
  end if;

  for transition_row in
    select *
      from public.inbox_v2_message_provider_lifecycle_transitions
     where tenant_id = expected_tenant_id
       and operation_id = expected_operation_id
     order by resulting_revision
  loop
    if transition_row.resulting_revision > operation_row.revision then
      return false;
    end if;

    if transition_row.expected_revision = 1 then
      if transition_row.recorded_at < operation_row.created_at
         or transition_row.recorded_stream_position <=
           operation_row.created_stream_position then
        return false;
      end if;
      before_outcome := operation_row.initial_outcome::text;
      before_outcome_retryable := operation_row.initial_outcome_retryable;
      before_outcome_reason_id := operation_row.initial_outcome_reason_id;
      before_delete_local_effect :=
        operation_row.initial_delete_local_effect::text;
      before_policy_decision_event_id :=
        operation_row.initial_policy_decision_event_id;
      before_policy_decision_revision :=
        operation_row.initial_policy_decision_revision;
      before_policy_decided_at := operation_row.initial_policy_decided_at;
    else
      select * into predecessor_row
        from public.inbox_v2_message_provider_lifecycle_transitions
       where tenant_id = transition_row.tenant_id
         and operation_id = transition_row.operation_id
         and resulting_revision = transition_row.expected_revision;
      if not found then
        return false;
      end if;
      if transition_row.recorded_at < predecessor_row.recorded_at
         or transition_row.recorded_stream_position <=
           predecessor_row.recorded_stream_position then
        return false;
      end if;
      before_outcome := predecessor_row.outcome::text;
      before_outcome_retryable := predecessor_row.outcome_retryable;
      before_outcome_reason_id := predecessor_row.outcome_reason_id;
      before_delete_local_effect := predecessor_row.delete_local_effect::text;
      before_policy_decision_event_id :=
        predecessor_row.policy_decision_event_id;
      before_policy_decision_revision :=
        predecessor_row.policy_decision_revision;
      before_policy_decided_at := predecessor_row.policy_decided_at;
    end if;

    outcome_changed :=
      before_outcome is distinct from transition_row.outcome::text
      or before_outcome_retryable is distinct from
        transition_row.outcome_retryable
      or before_outcome_reason_id is distinct from
        transition_row.outcome_reason_id;
    policy_changed :=
      before_delete_local_effect is distinct from
        transition_row.delete_local_effect::text
      or before_policy_decision_event_id is distinct from
        transition_row.policy_decision_event_id
      or before_policy_decision_revision is distinct from
        transition_row.policy_decision_revision
      or before_policy_decided_at is distinct from
        transition_row.policy_decided_at;
    if not outcome_changed and not policy_changed then
      return false;
    end if;

    if outcome_changed then
      if operation_row.origin <> 'hulee_requested' then
        return false;
      end if;
      if not (
        (before_outcome = 'pending' and transition_row.outcome in (
          'accepted', 'confirmed', 'failed', 'unsupported', 'outcome_unknown'
        ))
        or (before_outcome = 'accepted' and transition_row.outcome in (
          'confirmed', 'failed', 'outcome_unknown'
        ))
        or (before_outcome = 'outcome_unknown' and
          transition_row.outcome in ('confirmed', 'failed'))
      ) then
        return false;
      end if;
    end if;

    if policy_changed and (
      before_delete_local_effect is null
      or before_delete_local_effect <> 'not_evaluated'
      or transition_row.delete_local_effect is null
    ) then
      return false;
    end if;

    proof_field_count := num_nonnulls(
      transition_row.result_token,
      transition_row.result_digest_sha256,
      transition_row.result_proof_outbound_route_id,
      transition_row.result_proof_capability_id,
      transition_row.result_proof_capability_revision,
      transition_row.result_proof_semantic_id,
      transition_row.result_proof_semantic_revision,
      transition_row.result_proof_state,
      transition_row.result_proof_declared_by_trusted_service_id,
      transition_row.result_proof_recorded_at,
      transition_row.result_proof_adapter_contract_detail,
      transition_row.result_proof_adapter_contract_detail_digest_sha256
    );
    if not outcome_changed then
      if proof_field_count <> 0 then
        return false;
      end if;
    elsif proof_field_count <> 12
      or operation_row.outbound_route_id is null
      or transition_row.result_proof_outbound_route_id <>
        operation_row.outbound_route_id
      or transition_row.result_proof_capability_id <>
        'core:message-' || operation_row.action::text
      or transition_row.result_proof_capability_revision <>
        operation_row.capability_revision
      or transition_row.result_proof_state <> transition_row.outcome::text
      or transition_row.result_proof_semantic_id <>
        'core:message.lifecycle.' || operation_row.action::text ||
          '.result.' || transition_row.outcome::text
      or transition_row.result_proof_declared_by_trusted_service_id <>
        operation_row.adapter_loaded_by_trusted_service_id
      or transition_row.result_proof_recorded_at <> transition_row.recorded_at
      or transition_row.result_proof_adapter_contract_detail #>>
        '{contractId}' <> operation_row.adapter_contract_id
      or transition_row.result_proof_adapter_contract_detail #>>
        '{contractVersion}' <> operation_row.adapter_contract_version
      or transition_row.result_proof_adapter_contract_detail #>>
        '{declarationRevision}' <>
          operation_row.adapter_declaration_revision::text
      or transition_row.result_proof_adapter_contract_detail #>>
        '{surfaceId}' <> operation_row.adapter_surface_id
      or transition_row.result_proof_adapter_contract_detail #>>
        '{loadedByTrustedServiceId}' <>
          operation_row.adapter_loaded_by_trusted_service_id
      or (transition_row.result_proof_adapter_contract_detail #>>
        '{loadedAt}')::timestamptz <> operation_row.adapter_loaded_at
    then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_transport_occurrence_link_valid(
  checked_tenant_id text,
  checked_link_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_message_transport_links link_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = link_row.tenant_id
       and message_row.id = link_row.message_id
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = link_row.tenant_id
       and occurrence_row.id = link_row.source_occurrence_id
       and occurrence_row.conversation_id = message_row.conversation_id
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         link_row.external_message_reference_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = link_row.tenant_id
       and reference_row.id = link_row.external_message_reference_id
       and reference_row.message_id = link_row.message_id
       and reference_row.conversation_id = message_row.conversation_id
       and reference_row.timeline_item_id = message_row.timeline_item_id
       and reference_row.external_thread_id = occurrence_row.external_thread_id
       and reference_row.message_key_digest_sha256 =
         occurrence_row.message_key_digest_sha256
      join public.inbox_v2_external_threads thread_row
        on thread_row.tenant_id = reference_row.tenant_id
       and thread_row.id = reference_row.external_thread_id
       and thread_row.conversation_id = message_row.conversation_id
      left join public.inbox_v2_outbound_routes route_row
        on route_row.tenant_id = message_row.tenant_id
       and route_row.id = message_row.origin_outbound_route_id
      left join public.inbox_v2_source_occurrences origin_occurrence_row
        on origin_occurrence_row.tenant_id = message_row.tenant_id
       and origin_occurrence_row.id = message_row.origin_source_occurrence_id
     where link_row.tenant_id = checked_tenant_id
       and link_row.id = checked_link_id
       and link_row.revision = 1
       and link_row.linked_at >= message_row.created_at
       and (
         (message_row.origin_kind = 'source_originated'
           and reference_row.created_at = message_row.created_at
           and origin_occurrence_row.resolution_state = 'resolved'
           and origin_occurrence_row.resolved_external_message_reference_id =
             reference_row.id
           and origin_occurrence_row.external_thread_id = reference_row.external_thread_id
           and origin_occurrence_row.conversation_id = message_row.conversation_id
           and origin_occurrence_row.direction::text =
             message_row.origin_source_direction::text
           and origin_occurrence_row.origin_kind not in (
             'provider_echo', 'provider_response'
           )
           and origin_occurrence_row.provider_actor_kind =
             'source_external_identity'
           and origin_occurrence_row.message_key_digest_sha256 =
             reference_row.message_key_digest_sha256
           and (
             (occurrence_row.id = origin_occurrence_row.id
               and link_row.resulting_head_revision = 1
               and link_row.linked_at = message_row.created_at
               and link_row.role = case message_row.origin_source_direction
                 when 'inbound' then 'origin'::public.inbox_v2_message_transport_link_role
                 when 'outbound' then 'native_outbound'::public.inbox_v2_message_transport_link_role
               end)
             or (occurrence_row.id <> origin_occurrence_row.id
               and (
                 (message_row.origin_source_direction = 'inbound'
                   and link_row.role = 'additional_artifact'
                   and occurrence_row.direction = 'inbound'
                   and occurrence_row.origin_kind not in (
                     'provider_echo', 'provider_response'
                   )
                   and occurrence_row.provider_actor_kind =
                     'source_external_identity')
                 or (message_row.origin_source_direction = 'outbound'
                   and occurrence_row.direction = 'outbound'
                   and (
                     (link_row.role = 'native_outbound'
                       and occurrence_row.origin_kind not in (
                         'provider_echo', 'provider_response'
                       )
                       and occurrence_row.provider_actor_kind =
                         'source_external_identity')
                     or (link_row.role = 'provider_echo'
                       and occurrence_row.origin_kind = 'provider_echo')
                   ))
               ))
           ))
         or (message_row.origin_kind = 'hulee_external'
           and route_row.conversation_id = message_row.conversation_id
           and route_row.external_thread_id = reference_row.external_thread_id
           and route_row.external_thread_id = occurrence_row.external_thread_id
           and route_row.adapter_contract_id = occurrence_row.adapter_contract_id
           and route_row.adapter_contract_version =
             occurrence_row.adapter_contract_version
           and route_row.adapter_declaration_revision =
             occurrence_row.adapter_declaration_revision
           and route_row.adapter_surface_id = occurrence_row.adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             occurrence_row.adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = occurrence_row.adapter_loaded_at
           and (
             (route_row.source_account_id = occurrence_row.source_account_id
               and route_row.source_thread_binding_id =
                 occurrence_row.source_thread_binding_id
               and route_row.binding_generation =
                 occurrence_row.binding_generation)
             or (not (
                 route_row.source_account_id = occurrence_row.source_account_id
                 and route_row.source_thread_binding_id =
                   occurrence_row.source_thread_binding_id
               )
               and link_row.role = 'provider_echo'
               and occurrence_row.origin_kind = 'provider_echo'
               and occurrence_row.message_scope_kind = 'provider_thread'
               and occurrence_row.message_decision_strength = 'authoritative'
               and reference_row.scope_kind = 'provider_thread'
               and thread_row.scope_kind = 'provider'
               and thread_row.identity_declaration ->> 'decisionStrength' =
                 'authoritative')
           )
           and (
             (link_row.role = 'provider_echo'
               and occurrence_row.origin_kind = 'provider_echo')
             or (link_row.role = 'provider_response'
               and occurrence_row.origin_kind = 'provider_response')
           ))
       )
  );
$function$;

create or replace function public.inbox_v2_tm_provider_fact_semantic_proof_valid(
  proof_detail jsonb,
  expected_tenant_id text,
  expected_normalized_event_id text,
  expected_external_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_semantic_id text,
  expected_actor_id text,
  expected_occurred_at timestamptz,
  expected_recorded_at timestamptz
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return coalesce(
    public.inbox_v2_tm_json_family_valid(
      'provider_semantic_proof', proof_detail
    )
    and proof_detail #>> '{tenantId}' = expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,kind}' =
      'normalized_inbound_event'
    and proof_detail #>> '{normalizedInboundEvent,id}' =
      expected_normalized_event_id
    and (
      (expected_external_reference_id is null
        and expected_source_occurrence_id is null
        and proof_detail -> 'externalMessageReference' = 'null'::jsonb
        and proof_detail -> 'sourceOccurrence' = 'null'::jsonb)
      or (expected_external_reference_id is not null
        and expected_source_occurrence_id is not null
        and proof_detail #>> '{externalMessageReference,tenantId}' =
          expected_tenant_id
        and proof_detail #>> '{externalMessageReference,kind}' =
          'external_message_reference'
        and proof_detail #>> '{externalMessageReference,id}' =
          expected_external_reference_id
        and proof_detail #>> '{sourceOccurrence,tenantId}' =
          expected_tenant_id
        and proof_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
        and proof_detail #>> '{sourceOccurrence,id}' =
          expected_source_occurrence_id)
    )
    and proof_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceAccount,kind}' = 'source_account'
    and proof_detail #>> '{sourceAccount,id}' = expected_source_account_id
    and proof_detail #>> '{sourceThreadBinding,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and proof_detail #>> '{sourceThreadBinding,id}' =
      expected_source_thread_binding_id
    and proof_detail #>> '{bindingGeneration}' =
      expected_binding_generation::text
    and proof_detail #>> '{adapterContract,contractId}' =
      expected_adapter_contract_id
    and proof_detail #>> '{adapterContract,contractVersion}' =
      expected_adapter_contract_version
    and proof_detail #>> '{adapterContract,declarationRevision}' =
      expected_adapter_declaration_revision::text
    and proof_detail #>> '{adapterContract,surfaceId}' =
      expected_adapter_surface_id
    and proof_detail #>> '{adapterContract,loadedByTrustedServiceId}' =
      expected_adapter_loaded_by_trusted_service_id
    and (proof_detail #>> '{adapterContract,loadedAt}')::timestamptz =
      expected_adapter_loaded_at
    and proof_detail #>> '{capabilityId}' = expected_capability_id
    and proof_detail #>> '{capabilityRevision}' =
      expected_capability_revision::text
    and proof_detail #>> '{semanticId}' = expected_semantic_id
    and proof_detail #>> '{semanticRevision}' = '1'
    and proof_detail #>> '{declaredByTrustedServiceId}' =
      expected_adapter_loaded_by_trusted_service_id
    and proof_detail #>> '{revision}' = '1'
    and (
      (expected_actor_id is null and proof_detail -> 'actor' = 'null'::jsonb)
      or (expected_actor_id is not null
        and proof_detail #>> '{actor,tenantId}' = expected_tenant_id
        and proof_detail #>> '{actor,kind}' = 'source_external_identity'
        and proof_detail #>> '{actor,id}' = expected_actor_id)
    )
    and (proof_detail #>> '{occurredAt}')::timestamptz =
      expected_occurred_at
    and (proof_detail #>> '{recordedAt}')::timestamptz =
      expected_recorded_at,
    false
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_action_attribution_valid(
  checked_tenant_id text,
  checked_attribution_id text,
  expected_conversation_id text,
  source_attribution_allowed boolean
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_action_attributions attribution_row
      left join public.inbox_v2_conversation_participants participant_row
        on participant_row.tenant_id = attribution_row.tenant_id
       and participant_row.id = attribution_row.action_participant_id
       and participant_row.conversation_id = attribution_row.conversation_id
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = attribution_row.tenant_id
       and occurrence_row.id = attribution_row.source_occurrence_id
     where attribution_row.tenant_id = checked_tenant_id
       and attribution_row.id = checked_attribution_id
       and attribution_row.conversation_id = expected_conversation_id
       and (
         (attribution_row.app_actor_kind = 'employee'
           and attribution_row.source_occurrence_id is null
           and attribution_row.automation_kind is null
           and participant_row.subject_kind = 'employee'
           and participant_row.subject_employee_id =
             attribution_row.app_actor_employee_id)
         or (attribution_row.app_actor_kind = 'trusted_service'
           and attribution_row.source_occurrence_id is null
           and attribution_row.automation_kind is not null
           and (
             attribution_row.action_participant_id is null
             or participant_row.subject_kind = 'bot'
           ))
         or (source_attribution_allowed
           and attribution_row.app_actor_kind is null
           and attribution_row.source_occurrence_id is not null
           and attribution_row.automation_kind is null
           and (
              (occurrence_row.provider_actor_kind = 'source_external_identity'
                and participant_row.subject_kind = 'source_external_identity'
                and participant_row.subject_source_external_identity_id =
                  occurrence_row.provider_actor_source_external_identity_id)
              or (occurrence_row.provider_actor_kind = 'provider_system'
                and (
                  attribution_row.action_participant_id is null
                  or participant_row.subject_kind = 'system'
                ))
              or (occurrence_row.provider_actor_kind is null
                and attribution_row.action_participant_id is null)
            ))
       )
  );
$function$;

create or replace function public.inbox_v2_tm_content_history_valid(
  checked_tenant_id text,
  checked_content_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_revisions latest_row
        on latest_row.tenant_id = content_row.tenant_id
       and latest_row.content_id = content_row.id
       and latest_row.revision = content_row.revision
       and latest_row.state = content_row.state
       and latest_row.recorded_stream_position =
         content_row.last_changed_stream_position
     where content_row.tenant_id = checked_tenant_id
       and content_row.id = checked_content_id
       and content_row.state_changed_at = case latest_row.transition_kind
         when 'created' then latest_row.recorded_at
         else latest_row.occurred_at
       end
       and content_row.updated_at = case latest_row.transition_kind
         when 'created' then latest_row.recorded_at
         else latest_row.occurred_at
       end
       and content_row.tombstone_event_id is not distinct from case
         when latest_row.transition_kind in (
           'privacy_erasure', 'retention_purge'
         ) then latest_row.event_id
         else null
       end
       and content_row.tombstone_reason_id is not distinct from
         latest_row.reason_id
       and content_row.retention_policy_id is not distinct from
         latest_row.retention_policy_id
       and content_row.retention_policy_version is not distinct from
         latest_row.retention_policy_version
       and content_row.retention_policy_revision is not distinct from
         latest_row.retention_policy_revision
       and (
         select count(*) = content_row.revision
            and min(history_row.revision) = 1
            and max(history_row.revision) = content_row.revision
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_timeline_content_revisions first_row
          where first_row.tenant_id = content_row.tenant_id
            and first_row.content_id = content_row.id
            and first_row.revision = 1
            and first_row.expected_previous_revision is null
            and first_row.transition_kind = 'created'
            and first_row.state = 'available'
            and first_row.event_id is null
            and first_row.reason_id is null
            and first_row.retention_policy_id is null
             and first_row.retention_policy_version is null
             and first_row.retention_policy_revision is null
             and first_row.occurred_at = content_row.retention_anchor_at
             and first_row.recorded_at = content_row.created_at
        )
       and (
         (content_row.owner_kind = 'message' and exists (
           select 1
             from public.inbox_v2_messages owner_row
             join public.inbox_v2_message_revisions first_owner_revision_row
               on first_owner_revision_row.tenant_id = owner_row.tenant_id
              and first_owner_revision_row.message_id = owner_row.id
              and first_owner_revision_row.message_revision = 1
              and first_owner_revision_row.change_kind = 'created'
              and first_owner_revision_row.after_content_id = content_row.id
              and first_owner_revision_row.after_content_revision = 1
              and first_owner_revision_row.after_content_state = 'available'
            where owner_row.tenant_id = content_row.tenant_id
              and owner_row.id = content_row.owner_id
              and owner_row.content_id = content_row.id
         ))
         or (content_row.owner_kind = 'staff_note' and exists (
           select 1
             from public.inbox_v2_staff_notes owner_row
             join public.inbox_v2_staff_note_revisions first_owner_revision_row
               on first_owner_revision_row.tenant_id = owner_row.tenant_id
              and first_owner_revision_row.staff_note_id = owner_row.id
              and first_owner_revision_row.staff_note_revision = 1
              and first_owner_revision_row.change_kind = 'created'
              and first_owner_revision_row.after_content_id = content_row.id
              and first_owner_revision_row.after_content_revision = 1
              and first_owner_revision_row.after_content_state = 'available'
            where owner_row.tenant_id = content_row.tenant_id
              and owner_row.id = content_row.owner_id
              and owner_row.content_id = content_row.id
         ))
       )
       and not exists (
         select 1
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
            and not (
              (content_row.owner_kind = 'message' and 1 = (
                select count(*)
                  from public.inbox_v2_message_revisions owner_revision_row
                 where owner_revision_row.tenant_id = content_row.tenant_id
                   and owner_revision_row.message_id = content_row.owner_id
                   and owner_revision_row.after_content_id = content_row.id
                   and owner_revision_row.after_content_revision =
                     history_row.revision
                   and owner_revision_row.after_content_state = history_row.state
                   and owner_revision_row.recorded_stream_position =
                     history_row.recorded_stream_position
                   and owner_revision_row.recorded_at = history_row.recorded_at
                   and owner_revision_row.change_kind::text = case
                     history_row.transition_kind
                     when 'created' then 'created'
                     when 'edit' then 'edited'
                     when 'attachment_materialization' then
                       'attachment_materialized'
                     when 'privacy_erasure' then 'privacy_erasure_tombstone'
                     when 'retention_purge' then 'retention_purge_tombstone'
                   end
              ))
              or (content_row.owner_kind = 'staff_note' and 1 = (
                select count(*)
                  from public.inbox_v2_staff_note_revisions owner_revision_row
                 where owner_revision_row.tenant_id = content_row.tenant_id
                   and owner_revision_row.staff_note_id = content_row.owner_id
                   and owner_revision_row.after_content_id = content_row.id
                   and owner_revision_row.after_content_revision =
                     history_row.revision
                   and owner_revision_row.after_content_state = history_row.state
                   and owner_revision_row.recorded_stream_position =
                     history_row.recorded_stream_position
                   and owner_revision_row.recorded_at = history_row.recorded_at
                   and owner_revision_row.change_kind::text = case
                     history_row.transition_kind
                     when 'created' then 'created'
                     when 'edit' then 'edited'
                     when 'privacy_erasure' then 'privacy_erasure_tombstone'
                     when 'retention_purge' then 'retention_purge_tombstone'
                     else null
                   end
              ))
            )
       )
       and not exists (
         select 1
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
            and (
              (history_row.revision > 1 and not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions predecessor_row
                 where predecessor_row.tenant_id = history_row.tenant_id
                   and predecessor_row.content_id = history_row.content_id
                   and predecessor_row.revision = history_row.revision - 1
                   and history_row.expected_previous_revision =
                     predecessor_row.revision
                   and predecessor_row.state = 'available'
                   and predecessor_row.recorded_at <= history_row.recorded_at
                   and predecessor_row.occurred_at <= history_row.occurred_at
                   and predecessor_row.recorded_stream_position <
                     history_row.recorded_stream_position
              ))
              or (history_row.transition_kind in (
                    'created', 'edit', 'attachment_materialization'
                  ) and history_row.state <> 'available')
              or (history_row.transition_kind in (
                    'edit', 'attachment_materialization'
                  ) and history_row.event_id is null)
              or (history_row.transition_kind = 'privacy_erasure' and not (
                history_row.state = 'privacy_erased'
                and history_row.event_id is not null
                and history_row.reason_id is not null
                and history_row.retention_policy_id is null
                and history_row.retention_policy_version is null
                and history_row.retention_policy_revision is null
              ))
              or (history_row.transition_kind = 'retention_purge' and not (
                history_row.state = 'retention_purged'
                and history_row.event_id is not null
                and history_row.reason_id is null
                and history_row.retention_policy_id is not null
                and history_row.retention_policy_version is not null
                and history_row.retention_policy_revision is not null
              ))
              or (history_row.transition_kind in (
                    'created', 'edit', 'attachment_materialization'
                  ) and num_nonnulls(
                    history_row.reason_id,
                    history_row.retention_policy_id,
                    history_row.retention_policy_version,
                    history_row.retention_policy_revision
                  ) <> 0)
            )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_message_history_valid(
  checked_tenant_id text,
  checked_message_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_messages message_row
      join public.inbox_v2_message_revisions latest_row
        on latest_row.tenant_id = message_row.tenant_id
       and latest_row.message_id = message_row.id
       and latest_row.timeline_item_id = message_row.timeline_item_id
       and latest_row.message_revision = message_row.revision
       and latest_row.recorded_stream_position =
         message_row.last_changed_stream_position
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = message_row.tenant_id
       and timeline_row.id = message_row.timeline_item_id
       and timeline_row.conversation_id = message_row.conversation_id
       and timeline_row.subject_kind = 'message'
       and timeline_row.subject_id = message_row.id
       and timeline_row.revision = message_row.revision
       and timeline_row.last_changed_stream_position =
         message_row.last_changed_stream_position
       and timeline_row.updated_at = latest_row.recorded_at
      join lateral (
        select content_head_row.*
          from public.inbox_v2_message_revisions content_head_row
         where content_head_row.tenant_id = message_row.tenant_id
           and content_head_row.message_id = message_row.id
           and content_head_row.after_content_id is not null
         order by content_head_row.message_revision desc
         limit 1
      ) latest_content_row on true
      left join lateral (
        select lifecycle_head_row.*
          from public.inbox_v2_message_revisions lifecycle_head_row
         where lifecycle_head_row.tenant_id = message_row.tenant_id
           and lifecycle_head_row.message_id = message_row.id
           and lifecycle_head_row.change_kind in (
             'local_delete_tombstone',
             'provider_delete_policy_tombstone'
           )
         order by lifecycle_head_row.message_revision desc
         limit 1
      ) latest_lifecycle_row on true
      where message_row.tenant_id = checked_tenant_id
        and message_row.id = checked_message_id
        and timeline_row.created_at = message_row.created_at
        and message_row.updated_at = latest_row.recorded_at
       and (
         select count(*) = message_row.revision
            and min(history_row.message_revision) = 1
            and max(history_row.message_revision) = message_row.revision
           from public.inbox_v2_message_revisions history_row
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_message_revisions first_row
          where first_row.tenant_id = message_row.tenant_id
            and first_row.message_id = message_row.id
            and first_row.timeline_item_id = message_row.timeline_item_id
            and first_row.message_revision = 1
            and first_row.expected_previous_revision is null
            and first_row.change_kind = 'created'
            and first_row.before_content_id is null
            and first_row.before_content_revision is null
            and first_row.before_content_state is null
            and first_row.after_content_id is not null
            and first_row.after_content_revision = 1
            and first_row.after_content_state = 'available'
            and first_row.provider_operation_id is null
            and first_row.reason_id is null
            and first_row.action_attribution_id =
              message_row.creation_attribution_id
            and first_row.occurred_at = timeline_row.occurred_at
            and first_row.recorded_at = message_row.created_at
       )
       and not exists (
         select 1
           from public.inbox_v2_message_revisions history_row
           join public.inbox_v2_action_attributions attribution_row
             on attribution_row.tenant_id = history_row.tenant_id
            and attribution_row.id = history_row.action_attribution_id
            left join public.inbox_v2_message_revisions predecessor_row
              on predecessor_row.tenant_id = history_row.tenant_id
             and predecessor_row.message_id = history_row.message_id
             and predecessor_row.message_revision =
               history_row.message_revision - 1
            left join lateral (
              select content_predecessor_candidate_row.*
                from public.inbox_v2_message_revisions
                  content_predecessor_candidate_row
               where content_predecessor_candidate_row.tenant_id =
                       history_row.tenant_id
                 and content_predecessor_candidate_row.message_id =
                       history_row.message_id
                 and content_predecessor_candidate_row.message_revision <
                       history_row.message_revision
                 and content_predecessor_candidate_row.after_content_id is not null
               order by content_predecessor_candidate_row.message_revision desc
               limit 1
            ) content_predecessor_row on true
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
            and (
              history_row.timeline_item_id <> message_row.timeline_item_id
              or not public.inbox_v2_tm_action_attribution_valid(
                history_row.tenant_id,
                history_row.action_attribution_id,
                message_row.conversation_id,
                true
              )
              or attribution_row.created_at <> history_row.recorded_at
              or (history_row.message_revision > 1 and (
                predecessor_row.id is null
                or history_row.expected_previous_revision <>
                  predecessor_row.message_revision
                or predecessor_row.recorded_at > history_row.recorded_at
                or predecessor_row.recorded_stream_position >=
                  history_row.recorded_stream_position
              ))
              or (history_row.message_revision > 1 and exists (
                select 1
                  from public.inbox_v2_message_revisions terminal_row
                 where terminal_row.tenant_id = history_row.tenant_id
                   and terminal_row.message_id = history_row.message_id
                   and terminal_row.message_revision <
                     history_row.message_revision
                   and terminal_row.change_kind in (
                     'privacy_erasure_tombstone',
                     'retention_purge_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and exists (
                select 1
                  from public.inbox_v2_message_revisions lifecycle_row
                 where lifecycle_row.tenant_id = history_row.tenant_id
                   and lifecycle_row.message_id = history_row.message_id
                   and lifecycle_row.message_revision <
                     history_row.message_revision
                   and lifecycle_row.change_kind in (
                     'local_delete_tombstone',
                     'provider_delete_policy_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'privacy_erasure_tombstone',
                    'retention_purge_tombstone'
                  ) and not (
                history_row.before_content_id =
                  content_predecessor_row.after_content_id
                and history_row.before_content_revision =
                  content_predecessor_row.after_content_revision
                and history_row.before_content_state =
                  content_predecessor_row.after_content_state
                and history_row.before_content_state = 'available'
                and history_row.after_content_id =
                  history_row.before_content_id
                and history_row.after_content_revision =
                  history_row.before_content_revision + 1
                and history_row.after_content_state = case history_row.change_kind
                  when 'privacy_erasure_tombstone' then
                    'privacy_erased'::public.inbox_v2_timeline_content_state
                  when 'retention_purge_tombstone' then
                    'retention_purged'::public.inbox_v2_timeline_content_state
                  else 'available'::public.inbox_v2_timeline_content_state
                end
              ))
              or (history_row.change_kind in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and num_nonnulls(
                    history_row.before_content_id,
                    history_row.before_content_revision,
                    history_row.before_content_state,
                    history_row.after_content_id,
                    history_row.after_content_revision,
                    history_row.after_content_state
                  ) <> 0)
              or (history_row.after_content_id is not null and not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions content_revision_row
                 where content_revision_row.tenant_id = history_row.tenant_id
                   and content_revision_row.content_id =
                     history_row.after_content_id
                   and content_revision_row.revision =
                     history_row.after_content_revision
                    and content_revision_row.state =
                      history_row.after_content_state
                    and content_revision_row.recorded_stream_position =
                      history_row.recorded_stream_position
                    and content_revision_row.recorded_at = history_row.recorded_at
                    and content_revision_row.transition_kind =
                     case history_row.change_kind
                       when 'created' then
                         'created'::public.inbox_v2_timeline_content_transition_kind
                       when 'edited' then
                         'edit'::public.inbox_v2_timeline_content_transition_kind
                       when 'attachment_materialized' then
                         'attachment_materialization'::public.inbox_v2_timeline_content_transition_kind
                       when 'privacy_erasure_tombstone' then
                         'privacy_erasure'::public.inbox_v2_timeline_content_transition_kind
                       when 'retention_purge_tombstone' then
                         'retention_purge'::public.inbox_v2_timeline_content_transition_kind
                     end
              ))
              or (history_row.change_kind = 'local_delete_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is null
              ))
              or (history_row.change_kind =
                    'provider_delete_policy_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is not null
              ))
              or (history_row.change_kind not in (
                    'edited', 'provider_delete_policy_tombstone'
                  ) and history_row.provider_operation_id is not null)
              or (history_row.change_kind not in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  )
                and history_row.reason_id is not null)
              or (history_row.change_kind = 'edited' and (
                (message_row.origin_kind in (
                    'source_originated', 'hulee_external'
                  )) <> (history_row.provider_operation_id is not null)
              ))
              or (history_row.change_kind in (
                    'attachment_materialized',
                    'privacy_erasure_tombstone',
                  'retention_purge_tombstone'
                  ) and attribution_row.app_actor_kind is distinct from
                    'trusted_service')
              or (history_row.change_kind = 'local_delete_tombstone'
                and attribution_row.app_actor_kind is null)
              or (history_row.change_kind = 'edited'
                and message_row.origin_kind in ('internal', 'migration')
                and attribution_row.app_actor_kind is null)
              or (history_row.message_revision > 1
                and attribution_row.source_occurrence_id is not null
                and history_row.provider_operation_id is null)
              or (history_row.provider_operation_id is not null and not exists (
                select 1
                  from public.inbox_v2_message_provider_lifecycle_operations op_row
                 where op_row.tenant_id = history_row.tenant_id
                   and op_row.id = history_row.provider_operation_id
                   and op_row.message_id = history_row.message_id
                   and op_row.action = case history_row.change_kind
                     when 'edited' then
                       'edit'::public.inbox_v2_provider_lifecycle_action
                     when 'provider_delete_policy_tombstone' then
                       'delete'::public.inbox_v2_provider_lifecycle_action
                   end
                   and (
                     history_row.change_kind = 'edited'
                     or (
                       op_row.delete_local_effect = 'tombstone_local'
                       and op_row.policy_decided_at <= history_row.recorded_at
                     )
                   )
                   and (
                     (op_row.origin = 'provider_observed'
                       and op_row.action_attribution_id is null
                       and attribution_row.app_actor_kind is null
                       and attribution_row.source_occurrence_id =
                         op_row.source_occurrence_id
                       and attribution_row.automation_kind is null)
                      or (op_row.origin = 'hulee_requested'
                        and attribution_row.app_actor_kind is not null
                        and attribution_row.source_occurrence_id is null
                        and exists (
                          select 1
                            from public.inbox_v2_action_attributions
                              operation_attribution_row
                           where operation_attribution_row.tenant_id =
                                   op_row.tenant_id
                             and operation_attribution_row.id =
                                   op_row.action_attribution_id
                             and operation_attribution_row.action_participant_id
                                   is not distinct from
                                   attribution_row.action_participant_id
                             and operation_attribution_row.app_actor_kind
                                   is not distinct from
                                   attribution_row.app_actor_kind
                             and operation_attribution_row.app_actor_employee_id
                                   is not distinct from
                                   attribution_row.app_actor_employee_id
                             and operation_attribution_row.app_authorization_epoch
                                   is not distinct from
                                   attribution_row.app_authorization_epoch
                             and operation_attribution_row.app_trusted_service_id
                                   is not distinct from
                                   attribution_row.app_trusted_service_id
                             and operation_attribution_row.source_occurrence_id
                                   is not distinct from
                                   attribution_row.source_occurrence_id
                             and operation_attribution_row.automation_kind
                                   is not distinct from
                                   attribution_row.automation_kind
                             and operation_attribution_row.automation_cause_event_id
                                   is not distinct from
                                   attribution_row.automation_cause_event_id
                             and operation_attribution_row.automation_correlation_id
                                   is not distinct from
                                   attribution_row.automation_correlation_id
                             and operation_attribution_row.automation_caused_at
                                   is not distinct from
                                   attribution_row.automation_caused_at
                             and operation_attribution_row
                                   .automation_initiating_employee_id
                                   is not distinct from
                                   attribution_row.automation_initiating_employee_id
                             and operation_attribution_row
                                   .automation_initiating_authorization_epoch
                                   is not distinct from
                                   attribution_row
                                     .automation_initiating_authorization_epoch
                        ))
                   )
              ))
            )
       )
       and message_row.content_id = latest_content_row.after_content_id
       and message_row.content_revision = latest_content_row.after_content_revision
       and message_row.content_state = latest_content_row.after_content_state
       and (
         (latest_lifecycle_row.change_kind = 'local_delete_tombstone'
           and message_row.lifecycle = 'local_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_reason_id = latest_lifecycle_row.reason_id
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at = latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.change_kind =
               'provider_delete_policy_tombstone'
           and message_row.lifecycle = 'provider_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_provider_operation_id =
             latest_lifecycle_row.provider_operation_id
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_policy_reason_id =
             latest_lifecycle_row.reason_id
           and message_row.lifecycle_changed_at =
             latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.id is null
           and message_row.lifecycle = 'active'
           and message_row.lifecycle_revision_id is null
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at is null)
       )
  );
$function$;

create or replace function public.inbox_v2_tm_staff_note_history_valid(
  checked_tenant_id text,
  checked_staff_note_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_staff_notes note_row
      join public.inbox_v2_staff_note_revisions latest_row
        on latest_row.tenant_id = note_row.tenant_id
       and latest_row.staff_note_id = note_row.id
       and latest_row.timeline_item_id = note_row.timeline_item_id
       and latest_row.staff_note_revision = note_row.revision
       and latest_row.recorded_stream_position =
         note_row.last_changed_stream_position
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = note_row.tenant_id
       and timeline_row.id = note_row.timeline_item_id
       and timeline_row.conversation_id = note_row.conversation_id
       and timeline_row.subject_kind = 'staff_note'
       and timeline_row.subject_id = note_row.id
       and timeline_row.revision = note_row.revision
       and timeline_row.last_changed_stream_position =
         note_row.last_changed_stream_position
       and timeline_row.updated_at = latest_row.recorded_at
      join public.inbox_v2_action_attributions creation_attribution_row
        on creation_attribution_row.tenant_id = note_row.tenant_id
       and creation_attribution_row.id = note_row.creation_attribution_id
       and creation_attribution_row.conversation_id = note_row.conversation_id
      where note_row.tenant_id = checked_tenant_id
        and note_row.id = checked_staff_note_id
        and timeline_row.created_at = note_row.created_at
        and note_row.updated_at = latest_row.recorded_at
       and note_row.content_id = latest_row.after_content_id
       and note_row.content_revision = latest_row.after_content_revision
       and note_row.content_state = latest_row.after_content_state
       and (
         select count(*) = note_row.revision
            and min(history_row.staff_note_revision) = 1
            and max(history_row.staff_note_revision) = note_row.revision
           from public.inbox_v2_staff_note_revisions history_row
          where history_row.tenant_id = note_row.tenant_id
            and history_row.staff_note_id = note_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_staff_note_revisions first_row
           join public.inbox_v2_action_attributions creation_attribution_row
             on creation_attribution_row.tenant_id = first_row.tenant_id
            and creation_attribution_row.id = first_row.action_attribution_id
            and creation_attribution_row.conversation_id = note_row.conversation_id
          where first_row.tenant_id = note_row.tenant_id
            and first_row.staff_note_id = note_row.id
            and first_row.timeline_item_id = note_row.timeline_item_id
            and first_row.staff_note_revision = 1
            and first_row.expected_previous_revision is null
            and first_row.change_kind = 'created'
            and first_row.before_content_id is null
            and first_row.before_content_revision is null
            and first_row.before_content_state is null
            and first_row.after_content_id = note_row.content_id
            and first_row.after_content_revision = 1
            and first_row.after_content_state = 'available'
            and first_row.action_attribution_id = note_row.creation_attribution_id
            and creation_attribution_row.action_participant_id =
              note_row.author_participant_id
            and first_row.occurred_at = timeline_row.occurred_at
            and first_row.recorded_at = note_row.created_at
       )
       and not exists (
         select 1
           from public.inbox_v2_staff_note_revisions history_row
           join public.inbox_v2_action_attributions attribution_row
             on attribution_row.tenant_id = history_row.tenant_id
            and attribution_row.id = history_row.action_attribution_id
           left join public.inbox_v2_staff_note_revisions predecessor_row
             on predecessor_row.tenant_id = history_row.tenant_id
            and predecessor_row.staff_note_id = history_row.staff_note_id
            and predecessor_row.staff_note_revision =
              history_row.staff_note_revision - 1
          where history_row.tenant_id = note_row.tenant_id
            and history_row.staff_note_id = note_row.id
            and (
              history_row.timeline_item_id <> note_row.timeline_item_id
              or not public.inbox_v2_tm_action_attribution_valid(
                history_row.tenant_id,
                history_row.action_attribution_id,
                note_row.conversation_id,
                false
              )
              or attribution_row.created_at <> history_row.recorded_at
              or (history_row.staff_note_revision > 1 and (
                predecessor_row.id is null
                or history_row.expected_previous_revision <>
                  predecessor_row.staff_note_revision
                or predecessor_row.after_content_state <> 'available'
                or predecessor_row.recorded_at > history_row.recorded_at
                or predecessor_row.recorded_at > history_row.occurred_at
                or predecessor_row.recorded_stream_position >=
                  history_row.recorded_stream_position
                or history_row.before_content_id <>
                  predecessor_row.after_content_id
                or history_row.before_content_revision <>
                  predecessor_row.after_content_revision
                or history_row.before_content_state <>
                  predecessor_row.after_content_state
              ))
              or (history_row.change_kind <> 'created' and not (
                history_row.before_content_state = 'available'
                and history_row.after_content_id =
                  history_row.before_content_id
                and history_row.after_content_revision =
                  history_row.before_content_revision + 1
                and history_row.after_content_revision =
                  history_row.staff_note_revision
                and history_row.after_content_state = case history_row.change_kind
                  when 'privacy_erasure_tombstone' then
                    'privacy_erased'::public.inbox_v2_timeline_content_state
                  when 'retention_purge_tombstone' then
                    'retention_purged'::public.inbox_v2_timeline_content_state
                  else 'available'::public.inbox_v2_timeline_content_state
                end
              ))
              or not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions content_revision_row
                 where content_revision_row.tenant_id = history_row.tenant_id
                   and content_revision_row.content_id =
                     history_row.after_content_id
                   and content_revision_row.revision =
                     history_row.after_content_revision
                    and content_revision_row.state =
                      history_row.after_content_state
                    and content_revision_row.recorded_stream_position =
                      history_row.recorded_stream_position
                    and content_revision_row.recorded_at = history_row.recorded_at
                    and (
                      history_row.staff_note_revision = 1
                      or content_revision_row.occurred_at =
                        history_row.recorded_at
                    )
                    and content_revision_row.transition_kind =
                      case history_row.change_kind
                        when 'created' then
                          'created'::public.inbox_v2_timeline_content_transition_kind
                        when 'edited' then
                         'edit'::public.inbox_v2_timeline_content_transition_kind
                       when 'attachment_materialized' then
                         'attachment_materialization'::public.inbox_v2_timeline_content_transition_kind
                       when 'privacy_erasure_tombstone' then
                         'privacy_erasure'::public.inbox_v2_timeline_content_transition_kind
                       when 'retention_purge_tombstone' then
                         'retention_purge'::public.inbox_v2_timeline_content_transition_kind
                     end
              )
              or (history_row.change_kind not in ('created', 'edited')
                and attribution_row.app_actor_kind is distinct from
                  'trusted_service')
              or (attribution_row.app_actor_kind = 'trusted_service'
                and attribution_row.action_participant_id is not null
                and not (
                  attribution_row.action_participant_id =
                    note_row.author_participant_id
                  and creation_attribution_row.app_actor_kind =
                    'trusted_service'
                  and creation_attribution_row.app_trusted_service_id =
                    attribution_row.app_trusted_service_id
                ))
            )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_aux_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  message_key text;
  operation_key text;
  reaction_key text;
  receipt_key text;
  commit_token_key text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name in (
    'inbox_v2_message_transport_fact_commits',
    'inbox_v2_message_delivery_observations',
    'inbox_v2_provider_receipt_observations'
  ) then
    commit_token_key := changed_row->>'commit_token';

    if exists (
      select 1 from public.inbox_v2_message_transport_fact_commits ledger_row
       where ledger_row.tenant_id = tenant_key
         and ledger_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_message_delivery_observations delivery_row
       where delivery_row.tenant_id = tenant_key
         and delivery_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.commit_token = commit_token_key
    ) then
      if not exists (
        select 1
          from public.inbox_v2_message_transport_fact_commits ledger_row
         where ledger_row.tenant_id = tenant_key
           and ledger_row.commit_token = commit_token_key
           and (
             (ledger_row.fact_kind = 'delivery'
               and exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
                    and delivery_row.id = ledger_row.observation_id
                    and delivery_row.message_id = ledger_row.message_id
                    and delivery_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and delivery_row.observed_at = ledger_row.observed_at
                    and delivery_row.recorded_at = ledger_row.recorded_at
                    and delivery_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and delivery_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
               ))
             or (ledger_row.fact_kind = 'receipt'
               and exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
                    and receipt_row.id = ledger_row.observation_id
                    and receipt_row.target_message_id is not distinct from
                      ledger_row.message_id
                    and receipt_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and receipt_row.observed_at = ledger_row.observed_at
                    and receipt_row.recorded_at = ledger_row.recorded_at
                    and receipt_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and receipt_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
               ))
           )
      ) then
        raise exception using errcode = '23514',
          message = 'inbox_v2.message_transport_fact_commit_coherence';
      end if;
    end if;
  end if;

  if tg_table_name = 'inbox_v2_outbound_route_consumptions'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_outbound_route_consumptions consumption_row
        join public.inbox_v2_outbound_routes route_row
          on route_row.tenant_id = consumption_row.tenant_id
         and route_row.id = consumption_row.outbound_route_id
         and route_row.mutation_token = consumption_row.mutation_token
         and route_row.idempotency_token = consumption_row.idempotency_token
         and route_row.correlation_token = consumption_row.correlation_token
         and route_row.adapter_loaded_by_trusted_service_id =
           consumption_row.consumed_by_trusted_service_id
        join public.inbox_v2_messages message_row
          on message_row.tenant_id = consumption_row.tenant_id
         and message_row.id = consumption_row.message_id
         and message_row.conversation_id = route_row.conversation_id
       where consumption_row.tenant_id = tenant_key
         and consumption_row.id = changed_row->>'id'
         and (
           (consumption_row.consumer_kind = 'message_creation'
             and consumption_row.consumer_id = message_row.id
             and message_row.origin_kind = 'hulee_external'
             and message_row.origin_outbound_route_id = route_row.id
             and message_row.created_at = consumption_row.consumed_at)
           or (consumption_row.consumer_kind = 'provider_lifecycle'
             and exists (
               select 1
                 from public.inbox_v2_message_provider_lifecycle_operations op_row
                where op_row.tenant_id = consumption_row.tenant_id
                  and op_row.id = consumption_row.consumer_id
                  and op_row.message_id = consumption_row.message_id
                  and op_row.origin = 'hulee_requested'
                  and op_row.outbound_route_id = route_row.id
                  and op_row.recorded_at = consumption_row.consumed_at
             ))
           or (consumption_row.consumer_kind = 'reaction'
             and exists (
               select 1
                 from public.inbox_v2_message_reaction_transitions transition_row
                 join public.inbox_v2_message_reactions reaction_row
                   on reaction_row.tenant_id = transition_row.tenant_id
                  and reaction_row.id = transition_row.reaction_id
                where transition_row.tenant_id = consumption_row.tenant_id
                  and transition_row.id = consumption_row.consumer_id
                  and transition_row.mode = 'external_request'
                  and transition_row.outbound_route_id = route_row.id
                  and transition_row.recorded_at = consumption_row.consumed_at
                  and reaction_row.message_id = consumption_row.message_id
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_route_consumption_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_message_transport_links' then
    message_key := changed_row->>'message_id';
    if tg_op <> 'DELETE' and not public.inbox_v2_tm_transport_occurrence_link_valid(
      tenant_key,
      changed_row->>'id'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.transport_occurrence_link_invalid';
    end if;
  elsif tg_table_name = 'inbox_v2_message_transport_link_heads' then
    message_key := changed_row->>'message_id';
  end if;

  if message_key is not null and (
    exists (
      select 1 from public.inbox_v2_message_transport_links
       where tenant_id = tenant_key and message_id = message_key
    ) or exists (
      select 1 from public.inbox_v2_message_transport_link_heads
       where tenant_id = tenant_key and message_id = message_key
    )
  ) and not exists (
    select 1
      from public.inbox_v2_message_transport_link_heads head_row
      join public.inbox_v2_message_transport_links latest_row
        on latest_row.tenant_id = head_row.tenant_id
       and latest_row.id = head_row.latest_link_id
       and latest_row.message_id = head_row.message_id
       and latest_row.resulting_head_revision = head_row.revision
       and latest_row.recorded_stream_position =
         head_row.last_changed_stream_position
       and latest_row.linked_at = head_row.updated_at
     where head_row.tenant_id = tenant_key
       and head_row.message_id = message_key
       and head_row.link_count = (
         select count(*)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = head_row.link_count
       and 1 = (
         select min(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = (
         select max(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and latest_row.id = (
         select link_row.id
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
          order by link_row.resulting_head_revision desc
          limit 1
       )
       and not exists (
         select 1
           from public.inbox_v2_message_transport_links chain_row
          where chain_row.tenant_id = head_row.tenant_id
            and chain_row.message_id = head_row.message_id
            and chain_row.resulting_head_revision > 1
            and not exists (
              select 1
                from public.inbox_v2_message_transport_links predecessor_row
               where predecessor_row.tenant_id = chain_row.tenant_id
                 and predecessor_row.message_id = chain_row.message_id
                 and predecessor_row.resulting_head_revision =
                   chain_row.resulting_head_revision - 1
                 and predecessor_row.linked_at <= chain_row.linked_at
                 and predecessor_row.recorded_stream_position <
                   chain_row.recorded_stream_position
            )
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.transport_link_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_provider_lifecycle_operations' then
    operation_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_message_provider_lifecycle_transitions' then
    operation_key := changed_row->>'operation_id';
  end if;

  if operation_key is not null and exists (
    select 1 from public.inbox_v2_message_provider_lifecycle_operations
     where tenant_id = tenant_key and id = operation_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_provider_lifecycle_operations op_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = op_row.tenant_id
       and message_row.id = op_row.message_id
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = op_row.tenant_id
       and occurrence_row.id = op_row.source_occurrence_id
       and occurrence_row.source_account_id = op_row.source_account_id
       and occurrence_row.source_thread_binding_id = op_row.source_thread_binding_id
       and occurrence_row.binding_generation = op_row.binding_generation
       and occurrence_row.adapter_contract_id = op_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         op_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         op_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = op_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         op_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = op_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         op_row.external_message_reference_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = op_row.tenant_id
       and reference_row.id = op_row.external_message_reference_id
       and reference_row.message_id = op_row.message_id
     where op_row.tenant_id = tenant_key
       and op_row.id = operation_key
       and public.inbox_v2_tm_provider_lifecycle_history_valid(
         op_row.tenant_id,
         op_row.id
       )
       and (
         (op_row.origin = 'provider_observed' and op_row.outbound_route_id is null)
         or (op_row.origin = 'hulee_requested'
           and public.inbox_v2_tm_outbound_route_action_valid(
             op_row.tenant_id,
             op_row.outbound_route_id,
             op_row.message_id,
             op_row.message_id,
             message_row.conversation_id,
             op_row.recorded_at,
             op_row.recorded_at,
             'core:message.' || op_row.action::text,
             'core:message.' || op_row.action::text || '_external',
             op_row.external_message_reference_id,
             op_row.source_occurrence_id,
             op_row.source_account_id,
             op_row.source_thread_binding_id,
             op_row.binding_generation,
             op_row.adapter_contract_id,
             op_row.adapter_contract_version,
             op_row.adapter_declaration_revision,
             op_row.adapter_surface_id,
             op_row.adapter_loaded_by_trusted_service_id,
             op_row.adapter_loaded_at,
             'core:message-' || op_row.action::text,
             op_row.capability_revision,
             op_row.action_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_route_consumptions consumption_row
              where consumption_row.tenant_id = op_row.tenant_id
                and consumption_row.consumer_kind = 'provider_lifecycle'
                and consumption_row.consumer_id = op_row.id
                and consumption_row.message_id = op_row.message_id
                and consumption_row.outbound_route_id = op_row.outbound_route_id
           ))
       )
       and (
         op_row.origin <> 'provider_observed'
         or (
           occurrence_row.normalized_inbound_event_id =
             op_row.provider_semantic_normalized_inbound_event_id
           and occurrence_row.provider_actor_source_external_identity_id
             is not distinct from
               op_row.provider_semantic_actor_external_identity_id
           and op_row.provider_semantic_capability_revision =
             occurrence_row.capability_revision
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractId}' = op_row.adapter_contract_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractVersion}' =
               op_row.adapter_contract_version
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,declarationRevision}' =
               op_row.adapter_declaration_revision::text
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,surfaceId}' = op_row.adapter_surface_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedByTrustedServiceId}' =
               op_row.adapter_loaded_by_trusted_service_id
           and (op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedAt}')::timestamptz =
               op_row.adapter_loaded_at
           and (op_row.provider_semantic_proof_detail #>> '{occurredAt}')::timestamptz =
             op_row.occurred_at
           and (op_row.provider_semantic_proof_detail #>> '{recordedAt}')::timestamptz =
             op_row.recorded_at
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_provider_lifecycle_transitions chain_row
          where chain_row.tenant_id = op_row.tenant_id
            and chain_row.operation_id = op_row.id
            and (
              chain_row.resulting_revision > op_row.revision
              or (
                chain_row.expected_revision > 1
                and not exists (
                  select 1
                    from public.inbox_v2_message_provider_lifecycle_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.operation_id = chain_row.operation_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                )
              )
            )
       )
       and (
         (op_row.revision = 1 and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
         ))
         or (op_row.revision > 1 and exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
              and transition_row.resulting_revision = op_row.revision
              and transition_row.outcome = op_row.outcome
              and transition_row.outcome_retryable is not distinct from
                op_row.outcome_retryable
              and transition_row.outcome_reason_id is not distinct from
                op_row.outcome_reason_id
              and transition_row.delete_local_effect is not distinct from
                op_row.delete_local_effect
              and transition_row.policy_decision_event_id is not distinct from
                op_row.policy_decision_event_id
              and transition_row.policy_decision_revision is not distinct from
                op_row.policy_decision_revision
              and transition_row.policy_decided_at is not distinct from
                op_row.policy_decided_at
              and transition_row.recorded_at = op_row.updated_at
              and transition_row.recorded_stream_position =
                op_row.last_changed_stream_position
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_lifecycle_operation_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_reactions' then
    reaction_key := changed_row->>'id';
  elsif tg_table_name in (
    'inbox_v2_message_reaction_transitions',
    'inbox_v2_message_reaction_slot_heads'
  ) then
    reaction_key := changed_row->>'reaction_id';
  elsif tg_table_name = 'inbox_v2_message_provider_reaction_observations' then
    select transition_row.reaction_id into reaction_key
      from public.inbox_v2_message_reaction_transitions transition_row
     where transition_row.tenant_id = tenant_key
       and transition_row.id = changed_row->>'transition_id';
  end if;

  if tg_table_name = 'inbox_v2_message_reaction_transitions'
     and tg_op <> 'DELETE'
     and exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
          and transition_row.mode = 'external_request'
     )
     and not exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
         join public.inbox_v2_message_reactions reaction_row
           on reaction_row.tenant_id = transition_row.tenant_id
          and reaction_row.id = transition_row.reaction_id
         join public.inbox_v2_outbound_route_consumptions consumption_row
           on consumption_row.tenant_id = transition_row.tenant_id
          and consumption_row.consumer_kind = 'reaction'
          and consumption_row.consumer_id = transition_row.id
          and consumption_row.message_id = reaction_row.message_id
          and consumption_row.outbound_route_id = transition_row.outbound_route_id
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.reaction_route_consumption_missing';
  end if;

  if reaction_key is not null and exists (
    select 1 from public.inbox_v2_message_reactions
     where tenant_id = tenant_key and id = reaction_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_reactions reaction_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = reaction_row.tenant_id
       and message_row.id = reaction_row.message_id
      join public.inbox_v2_message_reaction_slot_heads slot_row
        on slot_row.tenant_id = reaction_row.tenant_id
       and slot_row.message_id = reaction_row.message_id
       and slot_row.semantic_slot_key = reaction_row.semantic_slot_key
       and slot_row.reaction_id = reaction_row.id
       and slot_row.state_kind = reaction_row.state_kind
       and slot_row.revision = reaction_row.revision
     where reaction_row.tenant_id = tenant_key
       and reaction_row.id = reaction_key
       and (
         reaction_row.actor_participant_id is null or exists (
           select 1 from public.inbox_v2_conversation_participants participant_row
            where participant_row.tenant_id = reaction_row.tenant_id
              and participant_row.id = reaction_row.actor_participant_id
              and participant_row.conversation_id = message_row.conversation_id
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_reaction_transitions chain_row
          where chain_row.tenant_id = reaction_row.tenant_id
            and chain_row.reaction_id = reaction_row.id
            and (
             chain_row.resulting_revision > reaction_row.revision
             or ((chain_row.mode = 'provider_observed') <>
               exists (
                 select 1
                   from public.inbox_v2_message_provider_reaction_observations
                     observation_row
                  where observation_row.tenant_id = chain_row.tenant_id
                    and observation_row.transition_id = chain_row.id
               ))
              or (
               chain_row.expected_revision is null
               and chain_row.recorded_at <> reaction_row.created_at
             )
             or (
               chain_row.expected_revision is not null
                and not exists (
                  select 1
                    from public.inbox_v2_message_reaction_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.reaction_id = chain_row.reaction_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                     and predecessor_row.after_state_kind =
                       chain_row.before_state_kind
                     and predecessor_row.after_state_detail =
                       chain_row.before_state_detail
                      and predecessor_row.after_state_detail_digest_sha256 =
                        chain_row.before_state_detail_digest_sha256
                      and predecessor_row.recorded_at <= chain_row.recorded_at
                      and predecessor_row.recorded_stream_position <
                        chain_row.recorded_stream_position
                 )
              )
            )
       )
       and exists (
         select 1 from public.inbox_v2_message_reaction_transitions transition_row
          where transition_row.tenant_id = reaction_row.tenant_id
            and transition_row.reaction_id = reaction_row.id
            and transition_row.semantic_slot_key = reaction_row.semantic_slot_key
            and transition_row.resulting_revision = reaction_row.revision
            and transition_row.after_state_kind = reaction_row.state_kind
            and transition_row.value_kind = reaction_row.value_kind
            and transition_row.unicode_value is not distinct from
              reaction_row.unicode_value
            and transition_row.provider_reaction_kind_id is not distinct from
              reaction_row.provider_reaction_kind_id
            and transition_row.provider_canonical_code is not distinct from
              reaction_row.provider_canonical_code
            and transition_row.after_state_detail = reaction_row.state_detail
            and transition_row.after_state_detail_digest_sha256 =
              reaction_row.state_detail_digest_sha256
            and transition_row.recorded_at = reaction_row.updated_at
            and transition_row.result_token is not distinct from
              reaction_row.result_token
            and transition_row.result_digest_sha256 is not distinct from
              reaction_row.result_digest_sha256
            and (
              reaction_row.state_kind = 'active'
              or (
                reaction_row.state_kind = 'cleared'
                and (reaction_row.state_detail #>>
                  '{clearedAt}')::timestamptz = reaction_row.cleared_at
              )
              or (
                reaction_row.state_kind = 'pending_external'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.request_transition_id = transition_row.id
                and reaction_row.request_attribution_id =
                  transition_row.action_attribution_id
                and (reaction_row.state_detail #>>
                  '{requestedAt}')::timestamptz = reaction_row.updated_at
              )
              or (
                reaction_row.state_kind = 'external_terminal'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.state_detail #>> '{outcome}' =
                  reaction_row.external_outcome
                and reaction_row.state_detail #>> '{resultToken}' =
                  reaction_row.result_token
                and reaction_row.state_detail #>> '{resultDigestSha256}' =
                  reaction_row.result_digest_sha256
                and (reaction_row.state_detail #>>
                  '{resolvedAt}')::timestamptz = reaction_row.resolved_at
              )
            )
            and transition_row.recorded_stream_position =
              reaction_row.last_changed_stream_position
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reaction_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_delivery_observations'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_message_delivery_observations observation_row
       where observation_row.tenant_id = tenant_key
         and observation_row.id = changed_row->>'id'
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
            where snapshot_row.tenant_id = observation_row.tenant_id
              and snapshot_row.binding_id =
                observation_row.source_thread_binding_id
              and snapshot_row.source_account_id =
                observation_row.source_account_id
              and snapshot_row.binding_generation =
                observation_row.binding_generation
              and snapshot_row.capability_contract_id =
                observation_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                observation_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                observation_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                observation_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                observation_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at =
                observation_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                observation_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id =
                     observation_row.capability_id
              )
         )
         and (
           (observation_row.scope_kind = 'dispatch' and exists (
             select 1
               from public.inbox_v2_outbound_dispatches dispatch_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = dispatch_row.tenant_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.dispatch_id = dispatch_row.id
                and attempt_row.route_id = dispatch_row.route_id
                and attempt_row.message_id = dispatch_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = dispatch_row.tenant_id
                and route_row.id = dispatch_row.route_id
               join public.inbox_v2_messages message_row
                 on message_row.tenant_id = dispatch_row.tenant_id
                and message_row.id = dispatch_row.message_id
               where dispatch_row.tenant_id = observation_row.tenant_id
                 and dispatch_row.id = observation_row.scope_dispatch_id
                 and dispatch_row.message_id = observation_row.message_id
                 and dispatch_row.state <> 'queued'
                 and dispatch_row.last_attempt_id = attempt_row.id
                 and dispatch_row.attempt_count >= attempt_row.attempt_number
                 and message_row.origin_kind = 'hulee_external'
                 and message_row.origin_outbound_route_id = route_row.id
                 and route_row.source_account_id = observation_row.source_account_id
                 and route_row.source_thread_binding_id =
                   observation_row.source_thread_binding_id
                 and route_row.binding_generation =
                   observation_row.binding_generation
                 and route_row.adapter_contract_id =
                   observation_row.adapter_contract_id
                 and route_row.adapter_contract_version =
                   observation_row.adapter_contract_version
                 and route_row.adapter_declaration_revision =
                   observation_row.adapter_declaration_revision
                 and route_row.adapter_surface_id = observation_row.adapter_surface_id
                 and route_row.adapter_loaded_by_trusted_service_id =
                   observation_row.adapter_loaded_by_trusted_service_id
                 and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   observation_row.scope_artifact_id is null
                   or exists (
                    select 1
                      from public.inbox_v2_outbound_dispatch_artifacts artifact_row
                     where artifact_row.tenant_id = dispatch_row.tenant_id
                       and artifact_row.id = observation_row.scope_artifact_id
                       and artifact_row.dispatch_id = dispatch_row.id
                       and artifact_row.route_id = dispatch_row.route_id
                       and artifact_row.message_id = dispatch_row.message_id
                       and artifact_row.attempt_id =
                         observation_row.scope_attempt_id
                  )
                 )
            ))
            or (observation_row.scope_kind = 'external_reference' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = reference_row.tenant_id
                 and occurrence_row.id = observation_row.scope_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.resolved_external_message_reference_id =
                   reference_row.id
                 and occurrence_row.external_thread_id =
                   reference_row.external_thread_id
                 and occurrence_row.conversation_id = reference_row.conversation_id
                 and occurrence_row.message_key_digest_sha256 =
                   reference_row.message_key_digest_sha256
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
            or (observation_row.scope_kind = 'recipient' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
          )
         and (
           (observation_row.evidence_kind = 'provider_result' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_attempts attempt_row
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where attempt_row.tenant_id = observation_row.tenant_id
                and attempt_row.id = observation_row.evidence_attempt_id
                and attempt_row.dispatch_id = observation_row.scope_dispatch_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and attempt_row.completion_source = 'provider_result'
                 and (
                   (observation_row.fact = 'accepted'
                     and attempt_row.outcome_kind = 'accepted')
                   or (observation_row.fact = 'failed'
                     and attempt_row.outcome_kind in (
                       'retryable_failure', 'terminal_failure'
                     ))
                 )
            ))
           or (observation_row.evidence_kind = 'provider_artifact' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_artifacts artifact_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = artifact_row.tenant_id
                and attempt_row.id = artifact_row.attempt_id
                and attempt_row.dispatch_id = artifact_row.dispatch_id
                and attempt_row.route_id = artifact_row.route_id
                and attempt_row.message_id = artifact_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where artifact_row.tenant_id = observation_row.tenant_id
                and artifact_row.id = observation_row.evidence_artifact_id
                and artifact_row.id = observation_row.scope_artifact_id
                and artifact_row.attempt_id = observation_row.evidence_attempt_id
                and artifact_row.attempt_id = observation_row.scope_attempt_id
                and artifact_row.dispatch_id = observation_row.scope_dispatch_id
                and artifact_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   (observation_row.fact = 'accepted'
                     and artifact_row.state = 'accepted')
                   or (observation_row.fact = 'failed'
                     and artifact_row.state = 'failed')
                 )
            ))
           or (observation_row.evidence_kind = 'provider_event' and exists (
               select 1
                 from public.inbox_v2_source_occurrences occurrence_row
                 join public.inbox_v2_external_message_references reference_row
                   on reference_row.tenant_id = occurrence_row.tenant_id
                   and reference_row.id =
                     observation_row.evidence_external_message_reference_id
                   and reference_row.message_id = observation_row.message_id
                   and reference_row.external_thread_id =
                     occurrence_row.external_thread_id
                   and reference_row.conversation_id = occurrence_row.conversation_id
                   and reference_row.message_key_digest_sha256 =
                     occurrence_row.message_key_digest_sha256
                 where occurrence_row.tenant_id = observation_row.tenant_id
                  and occurrence_row.id =
                    observation_row.evidence_source_occurrence_id
                  and occurrence_row.normalized_inbound_event_id =
                    observation_row.evidence_normalized_inbound_event_id
                  and occurrence_row.source_account_id =
                    observation_row.source_account_id
                  and occurrence_row.source_thread_binding_id =
                    observation_row.source_thread_binding_id
                  and occurrence_row.binding_generation =
                    observation_row.binding_generation
                  and occurrence_row.adapter_contract_id =
                    observation_row.adapter_contract_id
                  and occurrence_row.adapter_contract_version =
                    observation_row.adapter_contract_version
                  and occurrence_row.adapter_declaration_revision =
                    observation_row.adapter_declaration_revision
                  and occurrence_row.adapter_surface_id =
                    observation_row.adapter_surface_id
                  and occurrence_row.adapter_loaded_by_trusted_service_id =
                    observation_row.adapter_loaded_by_trusted_service_id
                  and occurrence_row.adapter_loaded_at =
                    observation_row.adapter_loaded_at
                   and occurrence_row.capability_revision =
                     observation_row.capability_revision
                   and occurrence_row.resolution_state = 'resolved'
                   and occurrence_row.resolved_external_message_reference_id =
                     observation_row.evidence_external_message_reference_id
                   and occurrence_row.origin_kind <> 'provider_response'
                   and (
                     observation_row.scope_kind <> 'dispatch'
                     or (
                       occurrence_row.origin_kind = 'provider_echo'
                       and occurrence_row.direction = 'outbound'
                     )
                   )
                   and (
                     observation_row.scope_kind = 'dispatch'
                     or (observation_row.scope_kind = 'external_reference'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id
                       and observation_row.scope_source_occurrence_id =
                         occurrence_row.id)
                     or (observation_row.scope_kind = 'recipient'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id)
                   )
              ))
         )
         and (
           (observation_row.evidence_kind <> 'provider_event'
             and observation_row.semantic_proof_detail is null
             and observation_row.semantic_proof_digest_sha256 is null)
           or (observation_row.evidence_kind = 'provider_event'
             and observation_row.semantic_proof_digest_sha256 is not null
             and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
               observation_row.semantic_proof_detail,
               observation_row.tenant_id,
               observation_row.evidence_normalized_inbound_event_id,
               observation_row.evidence_external_message_reference_id,
               observation_row.evidence_source_occurrence_id,
               observation_row.source_account_id,
               observation_row.source_thread_binding_id,
               observation_row.binding_generation,
               observation_row.adapter_contract_id,
               observation_row.adapter_contract_version,
               observation_row.adapter_declaration_revision,
               observation_row.adapter_surface_id,
               observation_row.adapter_loaded_by_trusted_service_id,
               observation_row.adapter_loaded_at,
               observation_row.capability_id,
               observation_row.capability_revision,
               'core:message.delivery.' || observation_row.fact::text,
               case when observation_row.scope_kind = 'recipient'
                 then observation_row.scope_recipient_source_identity_id
                 else null
               end,
               observation_row.observed_at,
               observation_row.recorded_at
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_delivery_observation_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_provider_receipt_observations'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_provider_receipt_opaque_payloads'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'receipt_observation_id';
  end if;

  if receipt_key is not null then
    if not exists (
      select 1
        from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.id = receipt_key
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
             join public.normalized_inbound_events event_row
               on event_row.tenant_id = snapshot_row.tenant_id
              and event_row.id = receipt_row.evidence_normalized_inbound_event_id
              and event_row.source_connection_id =
                snapshot_row.source_connection_id
              and event_row.source_account_id = snapshot_row.source_account_id
            where snapshot_row.tenant_id = receipt_row.tenant_id
              and snapshot_row.binding_id = receipt_row.source_thread_binding_id
              and snapshot_row.source_account_id = receipt_row.source_account_id
              and snapshot_row.binding_generation =
                receipt_row.binding_generation
              and snapshot_row.capability_contract_id =
                receipt_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                receipt_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                receipt_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                receipt_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                receipt_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at = receipt_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                receipt_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id = receipt_row.capability_id
              )
         )
         and (
           receipt_row.target_kind <> 'exact_message' or exists (
             select 1
               from public.inbox_v2_messages message_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = message_row.tenant_id
                 and occurrence_row.id = receipt_row.target_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.source_account_id = receipt_row.source_account_id
                 and occurrence_row.source_thread_binding_id =
                   receipt_row.source_thread_binding_id
                and occurrence_row.binding_generation =
                  receipt_row.binding_generation
                 and occurrence_row.normalized_inbound_event_id =
                   receipt_row.evidence_normalized_inbound_event_id
                 and occurrence_row.resolved_external_message_reference_id =
                   receipt_row.target_external_message_reference_id
                 and occurrence_row.origin_kind <> 'provider_response'
                 and occurrence_row.adapter_contract_id =
                   receipt_row.adapter_contract_id
                 and occurrence_row.adapter_contract_version =
                   receipt_row.adapter_contract_version
                 and occurrence_row.adapter_declaration_revision =
                   receipt_row.adapter_declaration_revision
                 and occurrence_row.adapter_surface_id = receipt_row.adapter_surface_id
                 and occurrence_row.adapter_loaded_by_trusted_service_id =
                   receipt_row.adapter_loaded_by_trusted_service_id
                 and occurrence_row.adapter_loaded_at = receipt_row.adapter_loaded_at
                 and occurrence_row.capability_revision =
                   receipt_row.capability_revision
                join public.inbox_v2_external_message_references reference_row
                  on reference_row.tenant_id = message_row.tenant_id
                 and reference_row.id =
                   receipt_row.target_external_message_reference_id
                 and reference_row.message_id = message_row.id
                 and reference_row.external_thread_id =
                   occurrence_row.external_thread_id
                 and reference_row.conversation_id = occurrence_row.conversation_id
                 and reference_row.message_key_digest_sha256 =
                   occurrence_row.message_key_digest_sha256
               where message_row.tenant_id = receipt_row.tenant_id
                 and message_row.id = receipt_row.target_message_id
                 and (
                   (occurrence_row.provider_actor_kind =
                       'source_external_identity'
                     and receipt_row.reader_kind = 'source_external_identity'
                     and receipt_row.reader_source_external_identity_id =
                       occurrence_row.provider_actor_source_external_identity_id)
                   or (occurrence_row.provider_actor_kind is distinct from
                         'source_external_identity'
                     and receipt_row.reader_kind = 'aggregate_only')
                 )
            )
         )
         and (
           (receipt_row.opaque_payload_id is null
             and receipt_row.opaque_data_class_id is null
             and receipt_row.provider_watermark_digest_sha256 is null
             and receipt_row.reader_aggregate_key_digest_sha256 is null
             and not exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.receipt_observation_id = receipt_row.id
             ))
           or (receipt_row.opaque_payload_id is not null
             and receipt_row.opaque_data_class_id =
               'core:source_occurrence_and_external_reference'
             and exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.id = receipt_row.opaque_payload_id
                  and payload_row.receipt_observation_id = receipt_row.id
                  and payload_row.data_class_id = receipt_row.opaque_data_class_id
                  and (payload_row.provider_watermark is null) =
                    (receipt_row.provider_watermark_digest_sha256 is null)
                  and (payload_row.reader_aggregate_key is null) =
                    (receipt_row.reader_aggregate_key_digest_sha256 is null)
                  and (payload_row.provider_watermark is null or
                    encode(sha256(convert_to(
                      payload_row.provider_watermark, 'UTF8'
                    )), 'hex') =
                      receipt_row.provider_watermark_digest_sha256)
                  and (payload_row.reader_aggregate_key is null or
                    encode(sha256(convert_to(
                      payload_row.reader_aggregate_key, 'UTF8'
                    )), 'hex') =
                      receipt_row.reader_aggregate_key_digest_sha256)
             ))
         )
         and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
           receipt_row.semantic_proof_detail,
           receipt_row.tenant_id,
           receipt_row.evidence_normalized_inbound_event_id,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_external_message_reference_id
             else null
           end,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_source_occurrence_id
             else null
           end,
           receipt_row.source_account_id,
           receipt_row.source_thread_binding_id,
           receipt_row.binding_generation,
           receipt_row.adapter_contract_id,
           receipt_row.adapter_contract_version,
           receipt_row.adapter_declaration_revision,
           receipt_row.adapter_surface_id,
           receipt_row.adapter_loaded_by_trusted_service_id,
           receipt_row.adapter_loaded_at,
           receipt_row.capability_id,
           receipt_row.capability_revision,
           'core:message.receipt.read',
           case when receipt_row.reader_kind = 'source_external_identity'
             then receipt_row.reader_source_external_identity_id
             else null
           end,
           receipt_row.observed_at,
           receipt_row.recorded_at
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.provider_receipt_observation_coherence';
    end if;
  end if;

  return null;
end;
$function$;

create or replace function public.inbox_v2_tm_payload_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format('inbox_v2.timeline_content_payload_immutable:%s', tg_table_name);
end;
$function$;

create or replace function public.inbox_v2_tm_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  mutable_columns text[];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;

    if not exists (
      select 1 from public.tenants tenant_row
       where tenant_row.id = old_row->>'tenant_id'
    ) then
      return old;
    end if;

    if tg_table_name in (
      'inbox_v2_message_transport_link_heads',
      'inbox_v2_message_provider_lifecycle_operations',
      'inbox_v2_message_reactions',
      'inbox_v2_message_reaction_slot_heads'
    ) and not exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = old_row->>'tenant_id'
         and message_row.id = old_row->>'message_id'
    ) then
      return old;
    end if;

    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_head_delete:%s', tg_table_name);
  end if;

  case tg_table_name
    when 'inbox_v2_timeline_items' then
      mutable_columns := array[
        'revision', 'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_messages' then
      mutable_columns := array[
        'content_revision', 'content_state', 'lifecycle',
        'lifecycle_revision_id', 'lifecycle_reason_id',
        'lifecycle_provider_operation_id', 'lifecycle_policy_reason_id',
        'lifecycle_changed_at', 'revision', 'last_changed_stream_position',
        'updated_at'
      ];
    when 'inbox_v2_staff_notes' then
      mutable_columns := array[
        'content_revision', 'content_state', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_timeline_contents' then
      mutable_columns := array[
        'state', 'content_digest_sha256', 'tombstone_event_id',
        'tombstone_reason_id', 'retention_policy_id',
        'retention_policy_version', 'retention_policy_revision',
        'state_changed_at', 'revision', 'last_changed_stream_position',
        'updated_at'
      ];
    when 'inbox_v2_message_transport_link_heads' then
      mutable_columns := array[
        'link_count', 'latest_link_id', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_provider_lifecycle_operations' then
      mutable_columns := array[
        'outcome', 'outcome_retryable', 'outcome_reason_id',
        'delete_local_effect', 'policy_decision_event_id',
        'policy_decision_revision', 'policy_decided_at', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_reactions' then
      mutable_columns := array[
        'opaque_actor_key', 'opaque_actor_key_digest_sha256',
        'provider_actor_subject', 'provider_actor_subject_digest_sha256',
        'actor_identity_state', 'actor_identity_tombstone_event_id',
        'actor_identity_purged_at', 'state_kind', 'value_kind',
        'unicode_value', 'provider_reaction_kind_id',
        'provider_canonical_code', 'cleared_at', 'external_operation',
        'outbound_route_id', 'request_transition_id',
        'request_attribution_id', 'external_outcome', 'result_token',
        'result_digest_sha256', 'resolved_at', 'state_detail',
        'state_detail_digest_sha256', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_reaction_slot_heads' then
      mutable_columns := array[
        'reaction_id', 'state_kind', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    else
      raise exception using errcode = '23514',
        message = format('inbox_v2.timeline_message_unknown_head:%s', tg_table_name);
  end case;

  if (new_row - mutable_columns) is distinct from (old_row - mutable_columns) then
    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_immutable_identity:%s', tg_table_name);
  end if;

  if (new_row->>'revision')::bigint <> (old_row->>'revision')::bigint + 1
     or (new_row->>'last_changed_stream_position')::bigint <=
        (old_row->>'last_changed_stream_position')::bigint
     or (new_row->>'updated_at')::timestamptz <
        (old_row->>'updated_at')::timestamptz then
    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_stale_head:%s', tg_table_name);
  end if;

  if tg_table_name = 'inbox_v2_message_transport_link_heads'
     and (new_row->>'link_count')::bigint <>
        (old_row->>'link_count')::bigint + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.transport_link_head_noncontiguous';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_assert_reference_context(
  tenant_key text,
  message_key text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  message_kind public.inbox_v2_message_reference_kind;
  context_kind public.inbox_v2_message_reference_context_kind;
  provenance public.inbox_v2_provider_forward_provenance;
  message_conversation_id text;
  canonical_count integer;
  external_count integer;
  unresolved_count integer;
begin
  select message_row.reference_kind, context_row.kind,
         context_row.provenance_completeness, message_row.conversation_id
    into message_kind, context_kind, provenance, message_conversation_id
    from public.inbox_v2_messages message_row
    left join public.inbox_v2_message_reference_contexts context_row
      on context_row.tenant_id = message_row.tenant_id
     and context_row.message_id = message_row.id
   where message_row.tenant_id = tenant_key
     and message_row.id = message_key;

  if context_kind is null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_missing';
  end if;

  select count(*) into canonical_count
    from public.inbox_v2_message_reference_canonical_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into external_count
    from public.inbox_v2_message_reference_external_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into unresolved_count
    from public.inbox_v2_message_reference_unresolved_targets
   where tenant_id = tenant_key and message_id = message_key;

  if not (
    (message_kind = 'none' and context_kind = 'none'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_internal' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_external' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 1 and unresolved_count = 0)
    or (message_kind = 'reply_unresolved_source' and context_kind = 'reply'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 1)
    or (message_kind = 'forward_content_copy'
      and context_kind = 'forward_content_copy'
      and canonical_count between 1 and 32
      and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_native'
      and context_kind = 'forward_provider_native'
      and external_count between 1 and 32
      and canonical_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_observed'
      and context_kind = 'forward_provider_observed'
      and external_count between 0 and 32
      and canonical_count = 0 and unresolved_count = 0
      and (provenance <> 'exact' or external_count >= 1))
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_shape';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets target_row
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and target_row.target_message_id = message_key
  ) or exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and reference_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_self_target';
  end if;

  if message_kind in ('reply_resolved_internal', 'reply_resolved_external')
     and exists (
       select 1
         from public.inbox_v2_message_reference_canonical_targets target_row
         join public.inbox_v2_messages target_message
           on target_message.tenant_id = target_row.tenant_id
          and target_message.id = target_row.target_message_id
        where target_row.tenant_id = tenant_key
          and target_row.message_id = message_key
          and target_message.conversation_id <> message_conversation_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_conversation_mismatch';
  end if;

  if message_kind = 'reply_resolved_external' and not exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets canonical_row
      join public.inbox_v2_message_reference_external_targets external_row
        on external_row.tenant_id = canonical_row.tenant_id
       and external_row.message_id = canonical_row.message_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = external_row.tenant_id
       and reference_row.id = external_row.external_message_reference_id
       and reference_row.message_id = canonical_row.target_message_id
       and reference_row.timeline_item_id = canonical_row.target_timeline_item_id
     where canonical_row.tenant_id = tenant_key
       and canonical_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_identity_mismatch';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.id is null or reference_row.id is null
         or occurrence_row.resolution_state <> 'resolved'
         or occurrence_row.resolved_external_message_reference_id <>
            target_row.external_message_reference_id
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_external_reference_target_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_targets target_row
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
         or occurrence_row.resolution_state::text <>
           target_row.resolution_state
         or (target_row.resolution_state = 'pending' and exists (
           select 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ))
         or (target_row.resolution_state = 'conflicted' and (
           select count(*) = occurrence_row.resolution_candidate_count
              and min(candidate_row.ordinal) = 0
              and max(candidate_row.ordinal) =
                occurrence_row.resolution_candidate_count - 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ) is not true)
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_reference_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_candidates candidate_row
      join public.inbox_v2_message_reference_unresolved_targets target_row
        on target_row.tenant_id = candidate_row.tenant_id
       and target_row.message_id = candidate_row.message_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = candidate_row.tenant_id
       and reference_row.id = candidate_row.external_message_reference_id
     where candidate_row.tenant_id = tenant_key
       and candidate_row.message_id = message_key
       and (
         reference_row.id is null
         or reference_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_candidate_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_tm_core_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  timeline_key text;
  message_key text;
  note_key text;
  content_key text;
  conversation_key text;
  actual_count bigint;
  latest_item record;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name = 'inbox_v2_timeline_items' then
    timeline_key := changed_row->>'id';
    conversation_key := changed_row->>'conversation_id';
  else
    timeline_key := changed_row->>'timeline_item_id';
  end if;

  if tg_table_name = 'inbox_v2_messages' then
    message_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_message_revisions' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_outbound_dispatches' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name like 'inbox_v2_message_reference_%' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_staff_notes' then
    note_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_staff_note_revisions' then
    note_key := changed_row->>'staff_note_id';
  elsif tg_table_name in (
    'inbox_v2_timeline_contents', 'inbox_v2_timeline_content_revisions',
    'inbox_v2_timeline_content_payloads',
    'inbox_v2_timeline_content_contact_values'
  ) then
    content_key := coalesce(changed_row->>'id', changed_row->>'content_id');
  end if;

  if tg_table_name = 'inbox_v2_outbound_dispatches'
     and tg_op = 'INSERT'
     and not exists (
       select 1
         from public.inbox_v2_messages message_row
        where message_row.tenant_id = tenant_key
          and message_row.id = changed_row->>'message_id'
          and message_row.conversation_id =
            changed_row->>'conversation_id'
          and message_row.timeline_item_id =
            changed_row->>'timeline_item_id'
          and message_row.origin_kind = 'hulee_external'
          and message_row.origin_outbound_route_id = changed_row->>'route_id'
          and message_row.revision = 1
          and message_row.created_at =
            (changed_row->>'created_at')::timestamptz
          and changed_row->>'state' = 'queued'
          and (changed_row->>'attempt_count')::integer = 0
          and (changed_row->>'revision')::bigint = 1
          and (changed_row->>'created_at')::timestamptz =
            (changed_row->>'updated_at')::timestamptz
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_creation_dispatch_mismatch';
  end if;

  if timeline_key is not null and exists (
    select 1 from public.inbox_v2_timeline_items
     where tenant_id = tenant_key and id = timeline_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_timeline_items item_row
       where item_row.tenant_id = tenant_key
         and item_row.id = timeline_key
         and (
           (item_row.subject_kind = 'message' and exists (
             select 1 from public.inbox_v2_messages message_row
              where message_row.tenant_id = item_row.tenant_id
                and message_row.id = item_row.subject_id
                and message_row.timeline_item_id = item_row.id
                and message_row.conversation_id = item_row.conversation_id
                and message_row.revision = item_row.revision
           ))
           or (item_row.subject_kind = 'staff_note' and exists (
             select 1 from public.inbox_v2_staff_notes note_row
              where note_row.tenant_id = item_row.tenant_id
                and note_row.id = item_row.subject_id
                and note_row.timeline_item_id = item_row.id
                and note_row.conversation_id = item_row.conversation_id
                and note_row.revision = item_row.revision
           ))
           or (item_row.subject_kind not in ('message', 'staff_note') and exists (
             select 1 from public.inbox_v2_timeline_subject_details detail_row
              where detail_row.tenant_id = item_row.tenant_id
                and detail_row.timeline_item_id = item_row.id
                and detail_row.subject_kind = item_row.subject_kind
                and item_row.subject_id = case detail_row.subject_kind
                  when 'call' then detail_row.source_object_id
                  when 'review' then detail_row.source_object_id
                  when 'module_event' then detail_row.source_object_id
                  when 'participant_change' then detail_row.participant_transition_id
                  when 'work_change' then coalesce(
                    detail_row.work_item_transition_id,
                    detail_row.work_item_relation_transition_id
                  )
                  when 'system_event' then detail_row.system_event_id
                end
                and (
                  detail_row.actor_participant_id is null or exists (
                    select 1 from public.inbox_v2_conversation_participants participant_row
                     where participant_row.tenant_id = item_row.tenant_id
                       and participant_row.id = detail_row.actor_participant_id
                       and participant_row.conversation_id = item_row.conversation_id
                  )
                )
           ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.timeline_subject_coherence';
    end if;
  end if;

  if message_key is not null and exists (
    select 1 from public.inbox_v2_messages
     where tenant_id = tenant_key and id = message_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_timeline_items item_row
          on item_row.tenant_id = message_row.tenant_id
         and item_row.id = message_row.timeline_item_id
         and item_row.conversation_id = message_row.conversation_id
         and item_row.subject_kind = 'message'
         and item_row.subject_id = message_row.id
         and item_row.revision = message_row.revision
        join public.inbox_v2_timeline_contents content_row
          on content_row.tenant_id = message_row.tenant_id
         and content_row.id = message_row.content_id
         and content_row.owner_kind = 'message'
         and content_row.owner_id = message_row.id
         and content_row.revision = message_row.content_revision
         and content_row.state = message_row.content_state
        join public.inbox_v2_timeline_content_revisions content_revision_row
          on content_revision_row.tenant_id = content_row.tenant_id
         and content_revision_row.content_id = content_row.id
         and content_revision_row.revision = content_row.revision
         and content_revision_row.state = content_row.state
         and content_revision_row.recorded_stream_position =
           content_row.last_changed_stream_position
        join public.inbox_v2_message_revisions revision_row
          on revision_row.tenant_id = message_row.tenant_id
         and revision_row.message_id = message_row.id
         and revision_row.timeline_item_id = message_row.timeline_item_id
         and revision_row.message_revision = message_row.revision
         and revision_row.recorded_stream_position =
           message_row.last_changed_stream_position
        join public.inbox_v2_action_attributions attribution_row
          on attribution_row.tenant_id = message_row.tenant_id
         and attribution_row.id = message_row.creation_attribution_id
         and attribution_row.conversation_id = message_row.conversation_id
        join public.inbox_v2_conversation_participants author_row
          on author_row.tenant_id = message_row.tenant_id
         and author_row.id = message_row.author_participant_id
         and author_row.conversation_id = message_row.conversation_id
        left join public.inbox_v2_source_occurrences origin_occurrence_row
          on origin_occurrence_row.tenant_id = message_row.tenant_id
         and origin_occurrence_row.id = message_row.origin_source_occurrence_id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and attribution_row.action_participant_id =
           message_row.author_participant_id
         and (
           (message_row.origin_kind = 'source_originated'
             and attribution_row.source_occurrence_id =
               message_row.origin_source_occurrence_id
             and attribution_row.app_actor_kind is null
             and author_row.subject_kind = 'source_external_identity'
             and origin_occurrence_row.provider_actor_kind =
               'source_external_identity'
             and author_row.subject_source_external_identity_id =
               origin_occurrence_row.provider_actor_source_external_identity_id)
           or (message_row.origin_kind in ('hulee_external', 'internal')
             and attribution_row.source_occurrence_id is null
             and (
               (attribution_row.app_actor_kind = 'employee'
                 and author_row.subject_kind = 'employee'
                 and author_row.subject_employee_id =
                   attribution_row.app_actor_employee_id)
               or (attribution_row.app_actor_kind = 'trusted_service'
                 and attribution_row.automation_kind is not null
                 and author_row.subject_kind = 'bot')
             ))
           or (message_row.origin_kind = 'migration'
             and attribution_row.source_occurrence_id is null
             and attribution_row.app_actor_kind = 'trusted_service'
             and attribution_row.automation_kind is not null
             and author_row.subject_kind in ('legacy_unknown', 'system'))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_head_coherence';
    end if;

    if not public.inbox_v2_tm_message_history_valid(
      tenant_key,
      message_key
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_revision_history_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'source_originated'
    ) and not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_source_occurrences occurrence_row
          on occurrence_row.tenant_id = message_row.tenant_id
         and occurrence_row.id = message_row.origin_source_occurrence_id
         and occurrence_row.conversation_id = message_row.conversation_id
         and occurrence_row.direction::text =
           message_row.origin_source_direction::text
         and occurrence_row.origin_kind not in (
           'provider_echo', 'provider_response'
         )
         and occurrence_row.provider_actor_kind = 'source_external_identity'
         and occurrence_row.resolution_state = 'resolved'
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = message_row.tenant_id
         and reference_row.id =
           occurrence_row.resolved_external_message_reference_id
         and reference_row.external_thread_id = occurrence_row.external_thread_id
         and reference_row.conversation_id = message_row.conversation_id
         and reference_row.timeline_item_id = message_row.timeline_item_id
         and reference_row.message_id = message_row.id
         and reference_row.message_key_digest_sha256 =
           occurrence_row.message_key_digest_sha256
         and reference_row.created_at = message_row.created_at
         and reference_row.revision = 1
        join public.inbox_v2_message_transport_links origin_link_row
          on origin_link_row.tenant_id = message_row.tenant_id
         and origin_link_row.message_id = message_row.id
         and origin_link_row.source_occurrence_id = occurrence_row.id
         and origin_link_row.external_message_reference_id = reference_row.id
         and origin_link_row.role = case message_row.origin_source_direction
           when 'inbound' then 'origin'::public.inbox_v2_message_transport_link_role
           when 'outbound' then 'native_outbound'::public.inbox_v2_message_transport_link_role
         end
         and origin_link_row.resulting_head_revision = 1
         and origin_link_row.revision = 1
         and origin_link_row.linked_at = message_row.created_at
        join public.inbox_v2_message_transport_link_heads head_row
          on head_row.tenant_id = message_row.tenant_id
         and head_row.message_id = message_row.id
         and head_row.link_count >= 1
         and head_row.revision = head_row.link_count
         and head_row.updated_at >= message_row.created_at
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and public.inbox_v2_tm_transport_occurrence_link_valid(
           origin_link_row.tenant_id,
           origin_link_row.id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_source_origin_transport_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_message_transport_links link_row
          on link_row.tenant_id = message_row.tenant_id
         and link_row.message_id = message_row.id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind in ('internal', 'migration')
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_local_transport_link_forbidden';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        left join public.inbox_v2_message_reference_contexts context_row
          on context_row.tenant_id = message_row.tenant_id
         and context_row.message_id = message_row.id
        left join lateral (
          select count(*)::integer as target_count,
                 min(target_row.external_message_reference_id) as
                   external_message_reference_id,
                 min(target_row.source_occurrence_id) as source_occurrence_id
            from public.inbox_v2_message_reference_external_targets target_row
           where target_row.tenant_id = message_row.tenant_id
             and target_row.message_id = message_row.id
        ) external_target on true
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           (
             context_row.kind in ('none', 'forward_content_copy')
             and external_target.target_count = 0
           )
           or (
             context_row.kind in ('reply', 'forward_provider_native')
             and external_target.target_count = 1
           )
         )
         or message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           public.inbox_v2_tm_outbound_route_action_valid(
           message_row.tenant_id,
           message_row.origin_outbound_route_id,
           message_row.id,
           null,
           message_row.conversation_id,
           message_row.created_at,
           message_row.created_at,
           case context_row.kind
             when 'none' then 'core:message.send'
             when 'reply' then 'core:message.reply'
             when 'forward_content_copy' then
               'core:message.forward_content_copy'
             when 'forward_provider_native' then
               'core:message.forward_provider_native'
           end,
           case context_row.kind
             when 'none' then 'core:message.send_external'
             when 'reply' then 'core:message.reply_external'
             when 'forward_content_copy' then
               'core:message.forward_content_copy_external'
             when 'forward_provider_native' then
               'core:message.forward_provider_native_external'
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.external_message_reference_id
             else null
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.source_occurrence_id
             else null
           end,
           null,
           null,
           null,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_version
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_declaration_revision
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_surface_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_by_trusted_service_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_at
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_revision
             else null
           end,
           message_row.creation_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_routes route_row
              where route_row.tenant_id = message_row.tenant_id
                and route_row.id = message_row.origin_outbound_route_id
                and route_row.created_at = message_row.created_at
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_origin_route_mismatch';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and (
           (
             message_row.origin_kind = 'hulee_external'
             and (
               1 <> (
                 select count(*)
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
               )
               or not exists (
                 select 1
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
                    and dispatch_row.conversation_id =
                      message_row.conversation_id
                    and dispatch_row.timeline_item_id =
                      message_row.timeline_item_id
                    and dispatch_row.route_id =
                      message_row.origin_outbound_route_id
                    and dispatch_row.created_at = message_row.created_at
               )
             )
           )
           or (
             message_row.origin_kind <> 'hulee_external'
             and exists (
               select 1
                 from public.inbox_v2_outbound_dispatches dispatch_row
                where dispatch_row.tenant_id = message_row.tenant_id
                  and dispatch_row.message_id = message_row.id
             )
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_dispatch_coherence';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not exists (
           select 1
             from public.inbox_v2_outbound_route_consumptions consumption_row
            where consumption_row.tenant_id = message_row.tenant_id
              and consumption_row.consumer_kind = 'message_creation'
              and consumption_row.consumer_id = message_row.id
              and consumption_row.message_id = message_row.id
              and consumption_row.outbound_route_id =
                message_row.origin_outbound_route_id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_route_consumption_missing';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.lifecycle = 'provider_delete_tombstone'
         and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_operations op_row
            where op_row.tenant_id = message_row.tenant_id
              and op_row.id = message_row.lifecycle_provider_operation_id
              and op_row.message_id = message_row.id
              and op_row.action = 'delete'
              and op_row.delete_local_effect = 'tombstone_local'
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_lifecycle_operation_mismatch';
    end if;

    perform public.inbox_v2_tm_assert_reference_context(tenant_key, message_key);
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not exists (
    select 1
      from public.inbox_v2_staff_notes note_row
      join public.inbox_v2_timeline_items item_row
        on item_row.tenant_id = note_row.tenant_id
       and item_row.id = note_row.timeline_item_id
       and item_row.subject_kind = 'staff_note'
       and item_row.subject_id = note_row.id
       and item_row.visibility = 'staff_only'
       and item_row.revision = note_row.revision
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = note_row.tenant_id
       and content_row.id = note_row.content_id
       and content_row.owner_kind = 'staff_note'
       and content_row.owner_id = note_row.id
       and content_row.revision = note_row.content_revision
       and content_row.state = note_row.content_state
      join public.inbox_v2_staff_note_revisions revision_row
        on revision_row.tenant_id = note_row.tenant_id
       and revision_row.staff_note_id = note_row.id
       and revision_row.timeline_item_id = note_row.timeline_item_id
       and revision_row.staff_note_revision = note_row.revision
       and revision_row.recorded_stream_position =
         note_row.last_changed_stream_position
       and revision_row.after_content_id = note_row.content_id
       and revision_row.after_content_revision = note_row.content_revision
       and revision_row.after_content_state = note_row.content_state
     where note_row.tenant_id = tenant_key and note_row.id = note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_head_coherence';
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not public.inbox_v2_tm_staff_note_history_valid(
    tenant_key,
    note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_revision_history_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and tg_table_name = 'inbox_v2_timeline_contents'
    and tg_op = 'INSERT'
    and not exists (
      select 1
        from public.inbox_v2_timeline_contents content_row
       where content_row.tenant_id = tenant_key
         and content_row.id = content_key
         and (
           (content_row.owner_kind = 'message' and exists (
             select 1
               from public.inbox_v2_messages owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
           or (content_row.owner_kind = 'staff_note' and exists (
             select 1
               from public.inbox_v2_staff_notes owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
         )
    ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_creation_classification_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_revisions revision_row
        on revision_row.tenant_id = content_row.tenant_id
       and revision_row.content_id = content_row.id
       and revision_row.revision = content_row.revision
       and revision_row.state = content_row.state
       and revision_row.recorded_stream_position =
         content_row.last_changed_stream_position
     where content_row.tenant_id = tenant_key
       and content_row.id = content_key
       and (
         (content_row.owner_kind = 'message' and exists (
           select 1 from public.inbox_v2_messages message_row
            where message_row.tenant_id = content_row.tenant_id
              and message_row.id = content_row.owner_id
              and message_row.content_id = content_row.id
         ))
         or (content_row.owner_kind = 'staff_note' and exists (
           select 1 from public.inbox_v2_staff_notes note_row
            where note_row.tenant_id = content_row.tenant_id
              and note_row.id = content_row.owner_id
              and note_row.content_id = content_row.id
         ))
       )
       and (
         (content_row.state = 'available' and (
           select count(*) between 1 and 64
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and (
           select min(payload_row.ordinal) = 0
              and max(payload_row.ordinal) = count(*) - 1
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and not exists (
           select 1
             from public.inbox_v2_timeline_content_payloads payload_row
             left join lateral (
               select count(*)::integer as value_count,
                      min(value_row.value_ordinal) as minimum_ordinal,
                      max(value_row.value_ordinal) as maximum_ordinal
                 from public.inbox_v2_timeline_content_contact_values value_row
                where value_row.tenant_id = payload_row.tenant_id
                  and value_row.content_id = payload_row.content_id
                  and value_row.content_revision = payload_row.content_revision
                  and value_row.block_ordinal = payload_row.ordinal
             ) contact_values on true
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
              and (
                (payload_row.kind = 'contact' and not (
                  contact_values.value_count between 1 and 64
                  and contact_values.minimum_ordinal = 0
                  and contact_values.maximum_ordinal =
                    contact_values.value_count - 1
                ))
                or (payload_row.kind <> 'contact'
                  and contact_values.value_count <> 0)
              )
         ))
         or (content_row.state <> 'available' and not exists (
           select 1 from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_head_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not public.inbox_v2_tm_content_history_valid(
    tenant_key,
    content_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_revision_history_coherence';
  end if;

  if conversation_key is not null then
    select item_row.id, item_row.timeline_sequence, item_row.occurred_at
      into latest_item
      from public.inbox_v2_timeline_items item_row
     where item_row.tenant_id = tenant_key
       and item_row.conversation_id = conversation_key
       and item_row.activity_kind = 'eligible'
     order by item_row.timeline_sequence desc
     limit 1;

    select count(*) into actual_count
      from public.inbox_v2_conversation_heads head_row
     where head_row.tenant_id = tenant_key
       and head_row.conversation_id = conversation_key
       and head_row.latest_timeline_sequence = coalesce((
         select max(item_row.timeline_sequence)
           from public.inbox_v2_timeline_items item_row
          where item_row.tenant_id = tenant_key
            and item_row.conversation_id = conversation_key
       ), 0)
       and (
         (latest_item.id is null
           and head_row.latest_activity_item_id is null
           and head_row.latest_activity_timeline_sequence is null
           and head_row.latest_activity_at is null)
         or (latest_item.id is not null
           and head_row.latest_activity_item_id = latest_item.id
           and head_row.latest_activity_timeline_sequence =
             latest_item.timeline_sequence
           and head_row.latest_activity_at = latest_item.occurred_at)
       );

    if actual_count <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_coherence';
    end if;
  end if;

  return null;
end;
$function$;
create trigger inbox_v2_tm_timeline_head_guard
before update or delete on public.inbox_v2_timeline_items
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_message_head_guard
before update or delete on public.inbox_v2_messages
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_content_head_guard
before update or delete on public.inbox_v2_timeline_contents
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_note_head_guard
before update or delete on public.inbox_v2_staff_notes
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_link_head_guard
before update or delete on public.inbox_v2_message_transport_link_heads
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_provider_op_head_guard
before update or delete on public.inbox_v2_message_provider_lifecycle_operations
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_reaction_head_guard
before update or delete on public.inbox_v2_message_reactions
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_reaction_slot_head_guard
before update or delete on public.inbox_v2_message_reaction_slot_heads
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_content_payload_guard
before update on public.inbox_v2_timeline_content_payloads
for each row execute function public.inbox_v2_tm_payload_guard();
create trigger inbox_v2_tm_contact_payload_guard
before update on public.inbox_v2_timeline_content_contact_values
for each row execute function public.inbox_v2_tm_payload_guard();
create trigger inbox_v2_tm_receipt_payload_guard
before update on public.inbox_v2_provider_receipt_opaque_payloads
for each row execute function public.inbox_v2_tm_payload_guard();

create trigger inbox_v2_tm_provider_op_json_guard
before insert or update on public.inbox_v2_message_provider_lifecycle_operations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_provider_transition_json_guard
before insert on public.inbox_v2_message_provider_lifecycle_transitions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_json_guard
before insert or update on public.inbox_v2_message_reactions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_transition_json_guard
before insert on public.inbox_v2_message_reaction_transitions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_observation_json_guard
before insert on public.inbox_v2_message_provider_reaction_observations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_delivery_json_guard
before insert on public.inbox_v2_message_delivery_observations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_receipt_json_guard
before insert on public.inbox_v2_provider_receipt_observations
for each row execute function public.inbox_v2_tm_json_guard();

create trigger inbox_v2_tm_attribution_append_guard
before update or delete on public.inbox_v2_action_attributions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_conversations', 'id', 'conversation_id'
);
create trigger inbox_v2_tm_subject_detail_append_guard
before update or delete on public.inbox_v2_timeline_subject_details
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_timeline_items', 'id', 'timeline_item_id'
);
create trigger inbox_v2_tm_content_revision_append_guard
before update or delete on public.inbox_v2_timeline_content_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_timeline_contents', 'id', 'content_id'
);
create trigger inbox_v2_tm_message_revision_append_guard
before update or delete on public.inbox_v2_message_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_reference_context_append_guard
before update or delete on public.inbox_v2_message_reference_contexts
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_ref_canonical_append_guard
before update or delete on public.inbox_v2_message_reference_canonical_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_external_append_guard
before update or delete on public.inbox_v2_message_reference_external_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_unresolved_append_guard
before update or delete on public.inbox_v2_message_reference_unresolved_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_candidate_append_guard
before update or delete on public.inbox_v2_message_reference_unresolved_candidates
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_unresolved_targets', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_note_revision_append_guard
before update or delete on public.inbox_v2_staff_note_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_staff_notes', 'id', 'staff_note_id'
);
create trigger inbox_v2_tm_transport_link_append_guard
before update or delete on public.inbox_v2_message_transport_links
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_route_consumption_append_guard
before update or delete on public.inbox_v2_outbound_route_consumptions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_provider_transition_append_guard
before update or delete on public.inbox_v2_message_provider_lifecycle_transitions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_provider_lifecycle_operations', 'id', 'operation_id'
);
create trigger inbox_v2_tm_reaction_transition_append_guard
before update or delete on public.inbox_v2_message_reaction_transitions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reactions', 'id', 'reaction_id'
);
create trigger inbox_v2_tm_reaction_observation_append_guard
before update or delete on public.inbox_v2_message_provider_reaction_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reaction_transitions', 'id', 'transition_id'
);
create trigger inbox_v2_tm_transport_fact_commit_append_guard
before update or delete on public.inbox_v2_message_transport_fact_commits
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_delivery_append_guard
before update or delete on public.inbox_v2_message_delivery_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_receipt_append_guard
before update or delete on public.inbox_v2_provider_receipt_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'target_message_id',
  'public.inbox_v2_message_transport_fact_commits', 'commit_token', 'commit_token'
);

create constraint trigger inbox_v2_tm_timeline_coherence
after insert or update or delete on public.inbox_v2_timeline_items
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_message_coherence
after insert or update or delete on public.inbox_v2_messages
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_outbound_dispatch_coherence
after insert or update or delete on public.inbox_v2_outbound_dispatches
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_message_revision_coherence
after insert or delete on public.inbox_v2_message_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_reference_context_coherence
after insert or delete on public.inbox_v2_message_reference_contexts
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_canonical_coherence
after insert or delete on public.inbox_v2_message_reference_canonical_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_external_coherence
after insert or delete on public.inbox_v2_message_reference_external_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_unresolved_coherence
after insert or delete on public.inbox_v2_message_reference_unresolved_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_candidate_coherence
after insert or delete on public.inbox_v2_message_reference_unresolved_candidates
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_coherence
after insert or update or delete on public.inbox_v2_timeline_contents
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_revision_coherence
after insert or delete on public.inbox_v2_timeline_content_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_payload_coherence
after insert or delete on public.inbox_v2_timeline_content_payloads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_contact_payload_coherence
after insert or delete on public.inbox_v2_timeline_content_contact_values
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_note_coherence
after insert or update or delete on public.inbox_v2_staff_notes
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_note_revision_coherence
after insert or delete on public.inbox_v2_staff_note_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_subject_detail_coherence
after insert or delete on public.inbox_v2_timeline_subject_details
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();

create constraint trigger inbox_v2_tm_transport_link_coherence
after insert or delete on public.inbox_v2_message_transport_links
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_transport_head_coherence
after insert or update or delete on public.inbox_v2_message_transport_link_heads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_route_consumption_coherence
after insert or delete on public.inbox_v2_outbound_route_consumptions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_provider_op_coherence
after insert or update or delete on public.inbox_v2_message_provider_lifecycle_operations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_provider_transition_coherence
after insert or delete on public.inbox_v2_message_provider_lifecycle_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_coherence
after insert or update or delete on public.inbox_v2_message_reactions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_transition_coherence
after insert or delete on public.inbox_v2_message_reaction_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_slot_coherence
after insert or update or delete on public.inbox_v2_message_reaction_slot_heads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_observation_coherence
after insert or delete on public.inbox_v2_message_provider_reaction_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_transport_fact_commit_coherence
after insert or delete on public.inbox_v2_message_transport_fact_commits
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_delivery_coherence
after insert on public.inbox_v2_message_delivery_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_receipt_coherence
after insert on public.inbox_v2_provider_receipt_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_receipt_payload_coherence
after insert on public.inbox_v2_provider_receipt_opaque_payloads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
`;
