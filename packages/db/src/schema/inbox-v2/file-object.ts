import { sql, type SQLWrapper } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique
} from "drizzle-orm/pg-core";

import { tenants } from "../tables";
import {
  inboxV2AuthorizationActorKind,
  inboxV2AuthorizationCommandRecords,
  inboxV2DomainEvents
} from "./authorization-relations";
import { inboxV2SourceOccurrences } from "./source-occurrence";

function brandedIdSql(column: SQLWrapper, prefix: string) {
  return sql`coalesce((char_length(${column}) <= 256
    and ${column} ~ ${sql.raw(
      `'^${prefix}:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'`
    )}), false)`;
}

function sha256Sql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^[a-f0-9]{64}$', false)`;
}

function hmacSha256Sql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^hmac-sha256:[a-f0-9]{64}$', false)`;
}

function tokenSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 8 and 256
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function correlationIdSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) between 1 and 512
    and ${column} ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)`;
}

function sourceLocatorHandleSql(column: SQLWrapper) {
  return sql`coalesce(${column} ~ '^src_ref_[A-Za-z0-9_-]{43}$', false)`;
}

function catalogIdSql(column: SQLWrapper) {
  return sql`coalesce((char_length(${column}) <= 256 and (
    ${column} ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or ${column} ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)`;
}

export const inboxV2FileObjectState = pgEnum("inbox_v2_file_object_state", [
  "pending",
  "ready",
  "quarantined",
  "unavailable",
  "delete_pending",
  "deleted"
]);

export const inboxV2FileObjectVersioningMode = pgEnum(
  "inbox_v2_file_object_versioning_mode",
  ["native_version", "immutable_key"]
);

export const inboxV2FileObjectVersionState = pgEnum(
  "inbox_v2_file_object_version_state",
  [
    "staging",
    "ready",
    "quarantined",
    "unavailable",
    "delete_pending",
    "deleted",
    "delete_failed"
  ]
);

export const inboxV2FileAttachmentMaterializationState = pgEnum(
  "inbox_v2_file_attachment_materialization_state",
  [
    "pending",
    "claimed",
    "transferring",
    "verifying",
    "ready",
    "failed",
    "quarantined",
    "cancelled"
  ]
);

export const inboxV2FileAttachmentMaterializationOutcome = pgEnum(
  "inbox_v2_file_attachment_materialization_outcome",
  ["ready", "failed", "quarantined"]
);

export const inboxV2FileAttachmentSourceLocatorKind = pgEnum(
  "inbox_v2_file_attachment_source_locator_kind",
  ["provider", "upload_staging", "derivative"]
);

export const inboxV2FileParentSetCompleteness = pgEnum(
  "inbox_v2_file_parent_set_completeness",
  ["unknown", "reconciling", "complete"]
);

export const inboxV2FileParentKind = pgEnum("inbox_v2_file_parent_kind", [
  "message",
  "staff_note",
  "upload_staging"
]);

export const inboxV2FileParentPurpose = pgEnum("inbox_v2_file_parent_purpose", [
  "attachment",
  "extension_payload"
]);

export const inboxV2FileParentVisibility = pgEnum(
  "inbox_v2_file_parent_visibility",
  ["external_work", "internal", "staff_note", "upload_staging"]
);

export const inboxV2FileParentLinkState = pgEnum(
  "inbox_v2_file_parent_link_state",
  ["live", "detached"]
);

export const inboxV2FileObjectOperationKind = pgEnum(
  "inbox_v2_file_object_operation_kind",
  [
    "put",
    "head",
    "list_versions",
    "quarantine",
    "delete_current",
    "delete_version",
    "orphan_reconcile"
  ]
);

export const inboxV2FileObjectOperationOutcome = pgEnum(
  "inbox_v2_file_object_operation_outcome",
  [
    "succeeded",
    "already_absent_verified",
    "retryable_failure",
    "terminal_failure",
    "unsupported"
  ]
);

export const inboxV2FileStorageOrphanState = pgEnum(
  "inbox_v2_file_storage_orphan_state",
  ["open", "claimed", "quarantined", "adopted", "deleted", "failed"]
);

export const inboxV2FileOutboundArtifactGrouping = pgEnum(
  "inbox_v2_file_outbound_artifact_grouping",
  ["single", "album", "split"]
);

export const inboxV2FileOutboundBlockKind = pgEnum(
  "inbox_v2_file_outbound_block_kind",
  [
    "text",
    "image",
    "audio",
    "video",
    "file",
    "sticker",
    "location",
    "contact",
    "extension"
  ]
);

/** Logical tenant file head. Bytes are pinned through immutable FileVersion rows. */
export const inboxV2FileObjects = pgTable(
  "inbox_v2_file_objects",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    processingPurposeId: text("processing_purpose_id").notNull(),
    retentionAnchorAt: timestamp("retention_anchor_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    state: inboxV2FileObjectState("state").notNull().default("pending"),
    currentFileVersionId: text("current_file_version_id"),
    currentObjectVersionId: text("current_object_version_id"),
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
      name: "inbox_v2_file_objects_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_objects_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_objects_current_unique").on(
      table.tenantId,
      table.id,
      table.currentFileVersionId,
      table.currentObjectVersionId
    ),
    check(
      "inbox_v2_file_objects_shape_check",
      sql`${brandedIdSql(table.id, "file")}
        and ${catalogIdSql(table.dataClassId)}
        and ${catalogIdSql(table.processingPurposeId)}
        and ${table.revision} >= 1
        and isfinite(${table.retentionAnchorAt})
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and ((${table.currentFileVersionId} is null
              and ${table.currentObjectVersionId} is null)
          or (${table.currentFileVersionId} is not null
              and ${table.currentObjectVersionId} is not null))
        and (${table.state} <> 'ready'
          or ${table.currentFileVersionId} is not null)
        and (${table.state} <> 'pending'
          or ${table.currentFileVersionId} is null)`
    ),
    index("inbox_v2_file_objects_state_idx").on(
      table.tenantId,
      table.state,
      table.updatedAt,
      table.id
    )
  ]
);

/** Immutable physical object version; checksum is evidence, never object identity. */
export const inboxV2FileObjectVersions = pgTable(
  "inbox_v2_file_object_versions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    storageObjectKey: text("storage_object_key").notNull(),
    storageVersionIdentity: text("storage_version_identity").notNull(),
    versioningMode:
      inboxV2FileObjectVersioningMode("versioning_mode").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    declaredMediaType: text("declared_media_type"),
    detectedMediaType: text("detected_media_type").notNull(),
    encryptionKeyRef: text("encryption_key_ref"),
    dataClassId: text("data_class_id").notNull(),
    retentionAnchorAt: timestamp("retention_anchor_at", {
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
      name: "inbox_v2_file_object_versions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_object_versions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_object_versions_storage_unique").on(
      table.tenantId,
      table.storageRootId,
      table.storageObjectKey,
      table.storageVersionIdentity
    ),
    unique("inbox_v2_file_object_versions_mapping_unique").on(
      table.tenantId,
      table.id,
      table.checksumSha256,
      table.sizeBytes
    ),
    check(
      "inbox_v2_file_object_versions_shape_check",
      sql`${brandedIdSql(table.id, "file_object_version")}
        and ${catalogIdSql(table.storageRootId)}
        and char_length(${table.storageObjectKey}) between 1 and 2048
        and char_length(${table.storageVersionIdentity}) between 1 and 1024
        and ${sha256Sql(table.checksumSha256)}
        and ${table.sizeBytes} >= 0
        and (${table.declaredMediaType} is null
          or char_length(${table.declaredMediaType}) between 1 and 255)
        and char_length(${table.detectedMediaType}) between 1 and 255
        and (${table.encryptionKeyRef} is null
          or char_length(${table.encryptionKeyRef}) between 1 and 512)
        and ${catalogIdSql(table.dataClassId)}
        and isfinite(${table.retentionAnchorAt})
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_object_versions_checksum_idx").on(
      table.tenantId,
      table.checksumSha256,
      table.sizeBytes,
      table.id
    )
  ]
);

/** Mutable availability head for one immutable physical object version. */
export const inboxV2FileObjectVersionHeads = pgTable(
  "inbox_v2_file_object_version_heads",
  {
    tenantId: text("tenant_id").notNull(),
    objectVersionId: text("object_version_id").notNull(),
    state: inboxV2FileObjectVersionState("state").notNull(),
    latestOperationEvidenceId: text("latest_operation_evidence_id"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    stateChangedAt: timestamp("state_changed_at", {
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
      name: "inbox_v2_file_object_version_heads_pk",
      columns: [table.tenantId, table.objectVersionId]
    }),
    foreignKey({
      name: "inbox_v2_file_object_version_heads_version_fk",
      columns: [table.tenantId, table.objectVersionId],
      foreignColumns: [
        inboxV2FileObjectVersions.tenantId,
        inboxV2FileObjectVersions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_object_version_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_file_object_version_heads_shape_check",
      sql`${table.revision} >= 1
        and isfinite(${table.stateChangedAt})
        and isfinite(${table.createdAt})
        and ${table.stateChangedAt} >= ${table.createdAt}
        and (${table.revision} = 1
          or ${table.latestOperationEvidenceId} is not null)`
    ),
    index("inbox_v2_file_object_version_heads_state_idx").on(
      table.tenantId,
      table.state,
      table.stateChangedAt,
      table.objectVersionId
    )
  ]
);

/** Immutable logical file version pinned to one exact immutable object version. */
export const inboxV2FileVersions = pgTable(
  "inbox_v2_file_versions",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    fileId: text("file_id").notNull(),
    versionNumber: bigint("version_number", { mode: "bigint" }).notNull(),
    objectVersionId: text("object_version_id").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_versions_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_versions_file_fk",
      columns: [table.tenantId, table.fileId],
      foreignColumns: [inboxV2FileObjects.tenantId, inboxV2FileObjects.id]
    }),
    foreignKey({
      name: "inbox_v2_file_versions_object_version_fk",
      columns: [table.tenantId, table.objectVersionId],
      foreignColumns: [
        inboxV2FileObjectVersions.tenantId,
        inboxV2FileObjectVersions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_versions_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_versions_number_unique").on(
      table.tenantId,
      table.fileId,
      table.versionNumber
    ),
    unique("inbox_v2_file_versions_pin_unique").on(
      table.tenantId,
      table.id,
      table.fileId,
      table.objectVersionId
    ),
    check(
      "inbox_v2_file_versions_shape_check",
      sql`${brandedIdSql(table.id, "file_version")}
        and ${brandedIdSql(table.fileId, "file")}
        and ${table.versionNumber} >= 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_versions_object_idx").on(
      table.tenantId,
      table.objectVersionId,
      table.id
    )
  ]
);

export const inboxV2FileAttachmentMaterializationJobs = pgTable(
  "inbox_v2_file_attachment_materialization_jobs",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    fileId: text("file_id").notNull(),
    expectedFileRevision: bigint("expected_file_revision", {
      mode: "bigint"
    }).notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    parentMessageId: text("parent_message_id").notNull(),
    expectedParentRevision: bigint("expected_parent_revision", {
      mode: "bigint"
    }).notNull(),
    visibilityBoundary: inboxV2FileParentVisibility(
      "visibility_boundary"
    ).notNull(),
    timelineContentId: text("timeline_content_id").notNull(),
    expectedContentRevision: bigint("expected_content_revision", {
      mode: "bigint"
    }).notNull(),
    contentBlockKey: text("content_block_key").notNull(),
    contentMutationFenceSha256: text("content_mutation_fence_sha256").notNull(),
    sourceOccurrenceId: text("source_occurrence_id"),
    sourceLocatorKind: inboxV2FileAttachmentSourceLocatorKind(
      "source_locator_kind"
    ).notNull(),
    sourceLocatorReference: text("source_locator_reference").notNull(),
    sourceLocatorDigestSha256: text("source_locator_digest_sha256").notNull(),
    reservationNamespaceGeneration: text(
      "reservation_namespace_generation"
    ).notNull(),
    idempotencyToken: text("idempotency_token").notNull(),
    causeEventId: text("cause_event_id").notNull(),
    causeMutationId: text("cause_mutation_id").notNull(),
    causeStreamCommitId: text("cause_stream_commit_id").notNull(),
    causeStreamPosition: bigint("cause_stream_position", {
      mode: "bigint"
    }).notNull(),
    correlationId: text("correlation_id").notNull(),
    causedAt: timestamp("caused_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    authorizationCommandId: text("authorization_command_id").notNull(),
    authorizationCommandTypeId: text("authorization_command_type_id").notNull(),
    authorizationClientMutationId: text(
      "authorization_client_mutation_id"
    ).notNull(),
    authorizationMutationId: text("authorization_mutation_id").notNull(),
    authorizationDecisionId: text("authorization_decision_id").notNull(),
    authorizationEpoch: text("authorization_epoch").notNull(),
    authorizationActorKind: inboxV2AuthorizationActorKind(
      "authorization_actor_kind"
    ).notNull(),
    authorizationActorId: text("authorization_actor_id").notNull(),
    authorizationAuthorizedAt: timestamp("authorization_authorized_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    authorizationDecisionSetDigestSha256: text(
      "authorization_decision_set_digest_sha256"
    ).notNull(),
    authorizationResourceFenceSetDigestSha256: text(
      "authorization_resource_fence_set_digest_sha256"
    ).notNull(),
    authorizationTenantRbacRevision: bigint(
      "authorization_tenant_rbac_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationSharedAccessRevision: bigint(
      "authorization_shared_access_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationResourceHeadId: text(
      "authorization_resource_head_id"
    ).notNull(),
    authorizationResourceAccessRevision: bigint(
      "authorization_resource_access_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationStructuralRelationRevision: bigint(
      "authorization_structural_relation_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationCollaboratorSetRevision: bigint(
      "authorization_collaborator_set_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationAuditGrantSourceIds: text(
      "authorization_audit_grant_source_ids"
    )
      .array()
      .notNull(),
    authorizationAuditPolicyVersion: text("authorization_audit_policy_version"),
    expectedAttachmentRevision: bigint("expected_attachment_revision", {
      mode: "bigint"
    }).notNull(),
    state: inboxV2FileAttachmentMaterializationState("state")
      .notNull()
      .default("pending"),
    leaseGeneration: bigint("lease_generation", { mode: "bigint" })
      .notNull()
      .default(sql`0`),
    leaseTokenHash: text("lease_token_hash"),
    leaseOwnerId: text("lease_owner_id"),
    leaseClaimedAt: timestamp("lease_claimed_at", {
      withTimezone: true,
      precision: 3
    }),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    reservedFileVersionId: text("reserved_file_version_id").notNull(),
    reservedObjectVersionId: text("reserved_object_version_id").notNull(),
    reservedStorageRootId: text("reserved_storage_root_id").notNull(),
    reservedStorageObjectKey: text("reserved_storage_object_key").notNull(),
    resultFileVersionId: text("result_file_version_id"),
    resultObjectVersionId: text("result_object_version_id"),
    resultFileRevision: bigint("result_file_revision", { mode: "bigint" }),
    resultContentRevision: bigint("result_content_revision", {
      mode: "bigint"
    }),
    terminalReasonId: text("terminal_reason_id"),
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
      name: "inbox_v2_file_mat_jobs_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_file_fk",
      columns: [table.tenantId, table.fileId],
      foreignColumns: [inboxV2FileObjects.tenantId, inboxV2FileObjects.id]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_cause_event_fk",
      columns: [table.tenantId, table.causeEventId],
      foreignColumns: [inboxV2DomainEvents.tenantId, inboxV2DomainEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_source_occurrence_fk",
      columns: [table.tenantId, table.sourceOccurrenceId],
      foreignColumns: [
        inboxV2SourceOccurrences.tenantId,
        inboxV2SourceOccurrences.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_authorization_command_fk",
      columns: [
        table.tenantId,
        table.authorizationCommandId,
        table.authorizationMutationId
      ],
      foreignColumns: [
        inboxV2AuthorizationCommandRecords.tenantId,
        inboxV2AuthorizationCommandRecords.id,
        inboxV2AuthorizationCommandRecords.mutationId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_result_fk",
      columns: [
        table.tenantId,
        table.resultFileVersionId,
        table.fileId,
        table.resultObjectVersionId
      ],
      foreignColumns: [
        inboxV2FileVersions.tenantId,
        inboxV2FileVersions.id,
        inboxV2FileVersions.fileId,
        inboxV2FileVersions.objectVersionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_jobs_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_mat_jobs_idempotency_unique").on(
      table.tenantId,
      table.attachmentId,
      table.idempotencyToken
    ),
    unique("inbox_v2_file_mat_jobs_attachment_generation_unique").on(
      table.tenantId,
      table.attachmentId,
      table.expectedAttachmentRevision
    ),
    unique("inbox_v2_file_mat_jobs_scope_unique").on(
      table.tenantId,
      table.id,
      table.attachmentId,
      table.fileId
    ),
    unique("inbox_v2_file_mat_jobs_reserved_file_version_unique").on(
      table.tenantId,
      table.reservedFileVersionId
    ),
    unique("inbox_v2_file_mat_jobs_reserved_object_version_unique").on(
      table.tenantId,
      table.reservedObjectVersionId
    ),
    unique("inbox_v2_file_mat_jobs_reserved_storage_key_unique").on(
      table.tenantId,
      table.reservedStorageRootId,
      table.reservedStorageObjectKey
    ),
    check(
      "inbox_v2_file_mat_jobs_shape_check",
      sql`${brandedIdSql(table.id, "attachment_materialization_job")}
        and ${brandedIdSql(table.attachmentId, "message_attachment")}
        and ${brandedIdSql(table.fileId, "file")}
        and ${table.expectedFileRevision} >= 1
        and ${brandedIdSql(table.conversationId, "conversation")}
        and ${brandedIdSql(table.timelineItemId, "timeline_item")}
        and ${brandedIdSql(table.parentMessageId, "message")}
        and ${table.expectedParentRevision} >= 1
        and ${table.visibilityBoundary} in ('external_work', 'internal')
        and ${brandedIdSql(table.timelineContentId, "timeline_content")}
        and ${table.expectedContentRevision} >= 1
        and char_length(${table.contentBlockKey}) between 1 and 80
        and ${table.contentBlockKey} ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
        and ${sha256Sql(table.contentMutationFenceSha256)}
        and ${sourceLocatorHandleSql(table.sourceLocatorReference)}
        and ${sha256Sql(table.sourceLocatorDigestSha256)}
        and ${tokenSql(table.reservationNamespaceGeneration)}
        and ((${table.sourceLocatorKind} = 'provider'
            and ${table.sourceOccurrenceId} is not null
            and ${brandedIdSql(table.sourceOccurrenceId, "source_occurrence")})
          or (${table.sourceLocatorKind} in ('upload_staging', 'derivative')
            and ${table.sourceOccurrenceId} is null))
        and ${tokenSql(table.idempotencyToken)}
        and ${brandedIdSql(table.causeEventId, "event")}
        and char_length(${table.causeMutationId}) between 1 and 256
        and char_length(${table.causeStreamCommitId}) between 1 and 256
        and ${table.causeStreamPosition} >= 1
        and ${correlationIdSql(table.correlationId)}
        and isfinite(${table.causedAt})
        and char_length(${table.authorizationCommandId}) between 1 and 256
        and ${table.authorizationCommandTypeId} in (
          'core:attachment.materialization.reserve',
          'core:attachment.materialization.reauthorize'
        )
        and ${correlationIdSql(table.authorizationClientMutationId)}
        and char_length(${table.authorizationMutationId}) between 1 and 256
        and char_length(${table.authorizationDecisionId}) between 1 and 256
        and char_length(${table.authorizationEpoch}) between 8 and 1024
        and char_length(${table.authorizationActorId}) between 1 and 256
        and isfinite(${table.authorizationAuthorizedAt})
        and ${sha256Sql(table.authorizationDecisionSetDigestSha256)}
        and ${sha256Sql(table.authorizationResourceFenceSetDigestSha256)}
        and ${table.authorizationTenantRbacRevision} >= 1
        and ${table.authorizationSharedAccessRevision} >= 1
        and char_length(${table.authorizationResourceHeadId}) between 1 and 256
        and ${table.authorizationResourceAccessRevision} >= 1
        and ${table.authorizationStructuralRelationRevision} >= 1
        and ${table.authorizationCollaboratorSetRevision} >= 1
        and cardinality(${table.authorizationAuditGrantSourceIds}) between 1 and 64
        and array_position(${table.authorizationAuditGrantSourceIds}, null) is null
        and (${table.authorizationAuditPolicyVersion} is null
          or char_length(${table.authorizationAuditPolicyVersion}) between 1 and 256)
        and ${table.expectedAttachmentRevision} >= 1
        and ${brandedIdSql(table.reservedFileVersionId, "file_version")}
        and ${brandedIdSql(table.reservedObjectVersionId, "file_object_version")}
        and ${catalogIdSql(table.reservedStorageRootId)}
        and char_length(${table.reservedStorageObjectKey}) between 1 and 2048
        and ${table.leaseGeneration} >= 0
        and ${table.revision} >= 1
        and isfinite(${table.createdAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.createdAt}
        and (
          (${table.state} in ('claimed', 'transferring', 'verifying')
            and num_nonnulls(
              ${table.leaseTokenHash}, ${table.leaseOwnerId},
              ${table.leaseClaimedAt}, ${table.leaseExpiresAt}
            ) = 4
            and ${sha256Sql(table.leaseTokenHash)}
            and ${table.leaseGeneration} >= 1
            and isfinite(${table.leaseClaimedAt})
            and isfinite(${table.leaseExpiresAt})
            and ${table.leaseExpiresAt} > ${table.leaseClaimedAt})
          or (${table.state} not in ('claimed', 'transferring', 'verifying')
            and num_nonnulls(
              ${table.leaseTokenHash}, ${table.leaseOwnerId},
              ${table.leaseClaimedAt}, ${table.leaseExpiresAt}
            ) = 0)
        )
        and ((${table.state} = 'ready')
          = (num_nonnulls(
              ${table.resultFileVersionId}, ${table.resultObjectVersionId},
              ${table.resultFileRevision}
            ) = 3))
        and ((${table.state} in ('ready', 'failed', 'quarantined'))
          = (${table.resultContentRevision} is not null))
        and (${table.resultFileVersionId} is null
          or ${table.resultFileVersionId} = ${table.reservedFileVersionId})
        and (${table.resultObjectVersionId} is null
          or ${table.resultObjectVersionId} = ${table.reservedObjectVersionId})
        and (${table.resultFileRevision} is null
          or ${table.resultFileRevision} = ${table.expectedFileRevision} + 1)
        and (${table.resultContentRevision} is null
          or ${table.resultContentRevision} > ${table.expectedContentRevision})
        and ((${table.state} in ('failed', 'quarantined', 'cancelled'))
          = (${table.terminalReasonId} is not null))`
    ),
    index("inbox_v2_file_mat_jobs_claim_idx").on(
      table.tenantId,
      table.state,
      table.leaseExpiresAt,
      table.updatedAt,
      table.id
    ),
    index("inbox_v2_file_mat_jobs_namespace_drain_idx").on(
      table.tenantId,
      table.reservationNamespaceGeneration,
      table.state,
      table.updatedAt,
      table.id
    )
  ]
);

/** Append-only, content-free storage operation/deletion evidence. */
export const inboxV2FileObjectOperationEvidence = pgTable(
  "inbox_v2_file_object_operation_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    objectVersionId: text("object_version_id").notNull(),
    materializationJobId: text("materialization_job_id"),
    operationKind: inboxV2FileObjectOperationKind("operation_kind").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    attemptToken: text("attempt_token").notNull(),
    outcome: inboxV2FileObjectOperationOutcome("outcome").notNull(),
    safeReasonId: text("safe_reason_id"),
    observedVersionCount: integer("observed_version_count"),
    affectedBytes: bigint("affected_bytes", { mode: "bigint" }),
    deletionEvidenceDigestSha256: text("deletion_evidence_digest_sha256"),
    expectedObjectHeadRevision: bigint("expected_object_head_revision", {
      mode: "bigint"
    }),
    liveParentCount: bigint("live_parent_count", { mode: "bigint" }),
    activePurposeCount: bigint("active_purpose_count", { mode: "bigint" }),
    activeHoldCount: bigint("active_hold_count", { mode: "bigint" }),
    deletionAuthorityEvaluatedAt: timestamp("deletion_authority_evaluated_at", {
      withTimezone: true,
      precision: 3
    }),
    deletionAuthorityDecisionSha256: text("deletion_authority_decision_sha256"),
    requestedAt: timestamp("requested_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_object_operation_evidence_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_object_operation_evidence_version_fk",
      columns: [table.tenantId, table.objectVersionId],
      foreignColumns: [
        inboxV2FileObjectVersions.tenantId,
        inboxV2FileObjectVersions.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_object_operation_evidence_job_fk",
      columns: [table.tenantId, table.materializationJobId],
      foreignColumns: [
        inboxV2FileAttachmentMaterializationJobs.tenantId,
        inboxV2FileAttachmentMaterializationJobs.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_object_operation_evidence_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_object_operation_evidence_attempt_unique").on(
      table.tenantId,
      table.objectVersionId,
      table.operationKind,
      table.attemptToken
    ),
    check(
      "inbox_v2_file_object_operation_evidence_shape_check",
      sql`${brandedIdSql(table.id, "object_operation_evidence")}
        and ${catalogIdSql(table.storageRootId)}
        and ${tokenSql(table.attemptToken)}
        and (${table.safeReasonId} is null or ${catalogIdSql(table.safeReasonId)})
        and (${table.observedVersionCount} is null
          or ${table.observedVersionCount} between 0 and 1000000)
        and (${table.affectedBytes} is null or ${table.affectedBytes} >= 0)
        and (${table.deletionEvidenceDigestSha256} is null
          or ${sha256Sql(table.deletionEvidenceDigestSha256)})
        and num_nonnulls(
          ${table.expectedObjectHeadRevision}, ${table.liveParentCount},
          ${table.activePurposeCount}, ${table.activeHoldCount},
          ${table.deletionAuthorityEvaluatedAt},
          ${table.deletionAuthorityDecisionSha256}
        ) in (0, 6)
        and (${table.expectedObjectHeadRevision} is null
          or ${table.expectedObjectHeadRevision} >= 1)
        and (${table.liveParentCount} is null or ${table.liveParentCount} >= 0)
        and (${table.activePurposeCount} is null
          or ${table.activePurposeCount} >= 0)
        and (${table.activeHoldCount} is null or ${table.activeHoldCount} >= 0)
        and (${table.deletionAuthorityEvaluatedAt} is null
          or isfinite(${table.deletionAuthorityEvaluatedAt}))
        and (${table.deletionAuthorityDecisionSha256} is null
          or ${sha256Sql(table.deletionAuthorityDecisionSha256)})
        and isfinite(${table.requestedAt})
        and isfinite(${table.completedAt})
        and ${table.completedAt} >= ${table.requestedAt}
        and ${table.revision} = 1
        and ((${table.outcome} in ('retryable_failure', 'terminal_failure', 'unsupported'))
          = (${table.safeReasonId} is not null))
        and (
          (${table.operationKind} in ('delete_current', 'delete_version')
            and ${table.deletionEvidenceDigestSha256} is not null
            and ${table.deletionEvidenceDigestSha256} =
              ${table.deletionAuthorityDecisionSha256}
            and ${table.liveParentCount} = 0
            and ${table.activePurposeCount} = 0
            and ${table.activeHoldCount} = 0)
          or (${table.operationKind} not in ('delete_current', 'delete_version')
            and ${table.deletionEvidenceDigestSha256} is null
            and ${table.expectedObjectHeadRevision} is null)
        )`
    ),
    index("inbox_v2_file_object_operation_evidence_version_idx").on(
      table.tenantId,
      table.objectVersionId,
      table.completedAt,
      table.id
    )
  ]
);

export const inboxV2FileAttachmentMaterializationAttempts = pgTable(
  "inbox_v2_file_attachment_materialization_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    jobId: text("job_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    fileId: text("file_id").notNull(),
    expectedFileRevision: bigint("expected_file_revision", {
      mode: "bigint"
    }).notNull(),
    leaseGeneration: bigint("lease_generation", { mode: "bigint" }).notNull(),
    leaseTokenHash: text("lease_token_hash").notNull(),
    leaseOwnerId: text("lease_owner_id").notNull(),
    expectedJobRevision: bigint("expected_job_revision", {
      mode: "bigint"
    }).notNull(),
    expectedAttachmentRevision: bigint("expected_attachment_revision", {
      mode: "bigint"
    }).notNull(),
    claimedAt: timestamp("claimed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_mat_attempts_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_attempts_job_fk",
      columns: [table.tenantId, table.jobId, table.attachmentId, table.fileId],
      foreignColumns: [
        inboxV2FileAttachmentMaterializationJobs.tenantId,
        inboxV2FileAttachmentMaterializationJobs.id,
        inboxV2FileAttachmentMaterializationJobs.attachmentId,
        inboxV2FileAttachmentMaterializationJobs.fileId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_attempts_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_mat_attempts_generation_unique").on(
      table.tenantId,
      table.jobId,
      table.leaseGeneration
    ),
    unique("inbox_v2_file_mat_attempts_scope_unique").on(
      table.tenantId,
      table.id,
      table.jobId,
      table.attachmentId,
      table.fileId,
      table.leaseGeneration
    ),
    check(
      "inbox_v2_file_mat_attempts_shape_check",
      sql`${brandedIdSql(table.id, "attachment_materialization_attempt")}
        and ${table.leaseGeneration} >= 1
        and ${sha256Sql(table.leaseTokenHash)}
        and ${catalogIdSql(table.leaseOwnerId)}
        and ${table.expectedJobRevision} >= 1
        and ${table.expectedAttachmentRevision} >= 1
        and ${table.expectedFileRevision} >= 1
        and isfinite(${table.claimedAt})
        and isfinite(${table.leaseExpiresAt})
        and ${table.leaseExpiresAt} > ${table.claimedAt}`
    ),
    index("inbox_v2_file_mat_attempts_job_idx").on(
      table.tenantId,
      table.jobId,
      table.leaseGeneration,
      table.id
    )
  ]
);

/**
 * Append-only completion proof. The evidence pins both the claimed lease and
 * the attachment/content CAS that made the fallback or exact object visible.
 */
export const inboxV2FileAttachmentMaterializationEvidence = pgTable(
  "inbox_v2_file_attachment_materialization_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    jobId: text("job_id").notNull(),
    attemptId: text("attempt_id").notNull(),
    attachmentId: text("attachment_id").notNull(),
    fileId: text("file_id").notNull(),
    expectedFileRevision: bigint("expected_file_revision", {
      mode: "bigint"
    }).notNull(),
    leaseGeneration: bigint("lease_generation", { mode: "bigint" }).notNull(),
    expectedAttachmentRevision: bigint("expected_attachment_revision", {
      mode: "bigint"
    }).notNull(),
    resultingAttachmentRevision: bigint("resulting_attachment_revision", {
      mode: "bigint"
    }).notNull(),
    timelineContentId: text("timeline_content_id").notNull(),
    expectedContentRevision: bigint("expected_content_revision", {
      mode: "bigint"
    }).notNull(),
    resultingContentRevision: bigint("resulting_content_revision", {
      mode: "bigint"
    }).notNull(),
    contentMutationFenceSha256: text("content_mutation_fence_sha256").notNull(),
    outcome: inboxV2FileAttachmentMaterializationOutcome("outcome").notNull(),
    resultFileVersionId: text("result_file_version_id"),
    resultObjectVersionId: text("result_object_version_id"),
    resultingFileRevision: bigint("resulting_file_revision", {
      mode: "bigint"
    }),
    objectOperationEvidenceId: text("object_operation_evidence_id"),
    safeReasonId: text("safe_reason_id"),
    retryable: boolean("retryable"),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    evidenceHashSha256: text("evidence_hash_sha256").notNull(),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`)
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_mat_evidence_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_evidence_job_fk",
      columns: [table.tenantId, table.jobId, table.attachmentId, table.fileId],
      foreignColumns: [
        inboxV2FileAttachmentMaterializationJobs.tenantId,
        inboxV2FileAttachmentMaterializationJobs.id,
        inboxV2FileAttachmentMaterializationJobs.attachmentId,
        inboxV2FileAttachmentMaterializationJobs.fileId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_evidence_attempt_fk",
      columns: [
        table.tenantId,
        table.attemptId,
        table.jobId,
        table.attachmentId,
        table.fileId,
        table.leaseGeneration
      ],
      foreignColumns: [
        inboxV2FileAttachmentMaterializationAttempts.tenantId,
        inboxV2FileAttachmentMaterializationAttempts.id,
        inboxV2FileAttachmentMaterializationAttempts.jobId,
        inboxV2FileAttachmentMaterializationAttempts.attachmentId,
        inboxV2FileAttachmentMaterializationAttempts.fileId,
        inboxV2FileAttachmentMaterializationAttempts.leaseGeneration
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_evidence_result_fk",
      columns: [
        table.tenantId,
        table.resultFileVersionId,
        table.fileId,
        table.resultObjectVersionId
      ],
      foreignColumns: [
        inboxV2FileVersions.tenantId,
        inboxV2FileVersions.id,
        inboxV2FileVersions.fileId,
        inboxV2FileVersions.objectVersionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_evidence_object_operation_fk",
      columns: [table.tenantId, table.objectOperationEvidenceId],
      foreignColumns: [
        inboxV2FileObjectOperationEvidence.tenantId,
        inboxV2FileObjectOperationEvidence.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_mat_evidence_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_mat_evidence_attempt_unique").on(
      table.tenantId,
      table.jobId,
      table.leaseGeneration
    ),
    unique("inbox_v2_file_mat_evidence_hash_unique").on(
      table.tenantId,
      table.evidenceHashSha256
    ),
    check(
      "inbox_v2_file_mat_evidence_shape_check",
      sql`${brandedIdSql(table.id, "attachment_materialization_evidence")}
        and ${table.leaseGeneration} >= 1
        and ${table.expectedAttachmentRevision} >= 1
        and ${table.resultingAttachmentRevision} =
          ${table.expectedAttachmentRevision} + 1
        and ${brandedIdSql(table.timelineContentId, "timeline_content")}
        and ${table.expectedContentRevision} >= 1
        and ${table.resultingContentRevision} =
          ${table.expectedContentRevision} + 1
        and ${sha256Sql(table.contentMutationFenceSha256)}
        and ${sha256Sql(table.evidenceHashSha256)}
        and ${table.revision} = 1
        and isfinite(${table.completedAt})
        and (
          (${table.outcome} = 'ready'
            and num_nonnulls(
              ${table.resultFileVersionId}, ${table.resultObjectVersionId},
              ${table.resultingFileRevision},
              ${table.objectOperationEvidenceId}
            ) = 4
            and ${table.resultingFileRevision} >= 2
            and ${table.resultingFileRevision} =
              ${table.expectedFileRevision} + 1
            and ${table.safeReasonId} is null
            and ${table.retryable} is null)
          or (${table.outcome} = 'failed'
            and num_nonnulls(
              ${table.resultFileVersionId}, ${table.resultObjectVersionId},
              ${table.resultingFileRevision},
              ${table.objectOperationEvidenceId}
            ) = 0
            and ${catalogIdSql(table.safeReasonId)}
            and ${table.retryable} is not null)
          or (${table.outcome} = 'quarantined'
            and ${table.resultFileVersionId} is null
            and ${table.resultObjectVersionId} is null
            and ${table.resultingFileRevision} is null
            and ${table.objectOperationEvidenceId} is not null
            and ${catalogIdSql(table.safeReasonId)}
            and ${table.retryable} is null)
        )`
    ),
    index("inbox_v2_file_mat_evidence_job_idx").on(
      table.tenantId,
      table.jobId,
      table.completedAt,
      table.id
    )
  ]
);

/**
 * Durable inbox for storage-success -> registry-commit-failure. It intentionally
 * has no ObjectVersion FK because the canonical registry row may not exist yet.
 */
export const inboxV2FileStorageOrphans = pgTable(
  "inbox_v2_file_storage_orphans",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    materializationJobId: text("materialization_job_id"),
    storageRootId: text("storage_root_id").notNull(),
    storageObjectKey: text("storage_object_key").notNull(),
    storageVersionIdentity: text("storage_version_identity").notNull(),
    checksumSha256: text("checksum_sha256").notNull(),
    sizeBytes: bigint("size_bytes", { mode: "bigint" }).notNull(),
    detectedMediaType: text("detected_media_type").notNull(),
    state: inboxV2FileStorageOrphanState("state").notNull().default("open"),
    claimTokenHash: text("claim_token_hash"),
    claimExpiresAt: timestamp("claim_expires_at", {
      withTimezone: true,
      precision: 3
    }),
    adoptedObjectVersionId: text("adopted_object_version_id"),
    terminalEvidenceDigestSha256: text("terminal_evidence_digest_sha256"),
    safeReasonId: text("safe_reason_id"),
    quarantineReasonCode: text("quarantine_reason_code"),
    quarantineEvidenceDigestSha256: text("quarantine_evidence_digest_sha256"),
    quarantinePhysicalKind: text("quarantine_physical_kind"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    firstObservedAt: timestamp("first_observed_at", {
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
      name: "inbox_v2_file_storage_orphans_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_storage_orphans_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_file_storage_orphans_job_fk",
      columns: [table.tenantId, table.materializationJobId],
      foreignColumns: [
        inboxV2FileAttachmentMaterializationJobs.tenantId,
        inboxV2FileAttachmentMaterializationJobs.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_storage_orphans_adopted_fk",
      columns: [table.tenantId, table.adoptedObjectVersionId],
      foreignColumns: [
        inboxV2FileObjectVersions.tenantId,
        inboxV2FileObjectVersions.id
      ]
    }),
    unique("inbox_v2_file_storage_orphans_storage_unique").on(
      table.tenantId,
      table.storageRootId,
      table.storageObjectKey,
      table.storageVersionIdentity
    ),
    check(
      "inbox_v2_file_storage_orphans_shape_check",
      sql`${brandedIdSql(table.id, "file_storage_orphan")}
        and ${catalogIdSql(table.storageRootId)}
        and char_length(${table.storageObjectKey}) between 1 and 2048
        and char_length(${table.storageVersionIdentity}) between 1 and 1024
        and ${sha256Sql(table.checksumSha256)}
        and ${table.sizeBytes} >= 0
        and char_length(${table.detectedMediaType}) between 1 and 255
        and ${table.revision} >= 1
        and isfinite(${table.firstObservedAt})
        and isfinite(${table.updatedAt})
        and ${table.updatedAt} >= ${table.firstObservedAt}
        and ((${table.state} = 'claimed')
          = (num_nonnulls(${table.claimTokenHash}, ${table.claimExpiresAt}) = 2))
        and (${table.claimTokenHash} is null or ${sha256Sql(table.claimTokenHash)})
        and (${table.claimExpiresAt} is null or isfinite(${table.claimExpiresAt}))
        and ((${table.state} = 'adopted')
          = (${table.adoptedObjectVersionId} is not null))
        and ((${table.state} in ('adopted', 'deleted'))
          = (${table.terminalEvidenceDigestSha256} is not null))
        and (${table.terminalEvidenceDigestSha256} is null
          or ${sha256Sql(table.terminalEvidenceDigestSha256)})
        and ((${table.state} = 'failed')
          = (${table.safeReasonId} is not null))
        and ((${table.state} = 'quarantined')
          = (num_nonnulls(
            ${table.quarantineReasonCode},
            ${table.quarantineEvidenceDigestSha256},
            ${table.quarantinePhysicalKind}
          ) = 3))
        and (${table.quarantineReasonCode} is null
          or ${tokenSql(table.quarantineReasonCode)})
        and (${table.quarantineEvidenceDigestSha256} is null
          or ${sha256Sql(table.quarantineEvidenceDigestSha256)})
        and (${table.quarantinePhysicalKind} is null
          or ${tokenSql(table.quarantinePhysicalKind)})`
    ),
    index("inbox_v2_file_storage_orphans_claim_idx").on(
      table.tenantId,
      table.state,
      table.claimExpiresAt,
      table.updatedAt,
      table.id
    )
  ]
);

/** Lockable authority for a complete, revisioned set of live parents. */
export const inboxV2FileParentSetHeads = pgTable(
  "inbox_v2_file_parent_set_heads",
  {
    tenantId: text("tenant_id").notNull(),
    fileId: text("file_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    completeness: inboxV2FileParentSetCompleteness("completeness").notNull(),
    completenessRevision: bigint("completeness_revision", {
      mode: "bigint"
    }).notNull(),
    liveParentCount: integer("live_parent_count").notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_parent_set_heads_pk",
      columns: [table.tenantId, table.fileId]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_set_heads_file_fk",
      columns: [table.tenantId, table.fileId],
      foreignColumns: [inboxV2FileObjects.tenantId, inboxV2FileObjects.id]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_set_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_parent_set_heads_revision_unique").on(
      table.tenantId,
      table.fileId,
      table.revision,
      table.completeness
    ),
    check(
      "inbox_v2_file_parent_set_heads_shape_check",
      sql`${table.revision} >= 1
        and ${table.completenessRevision} between 0 and ${table.revision}
        and ${table.liveParentCount} between 0 and 1000000000
        and isfinite(${table.updatedAt})
        and (${table.completeness} <> 'complete'
          or ${table.completenessRevision} = ${table.revision})`
    ),
    index("inbox_v2_file_parent_set_heads_complete_idx").on(
      table.tenantId,
      table.completeness,
      table.liveParentCount,
      table.fileId
    )
  ]
);

export const inboxV2FileParentLinks = pgTable(
  "inbox_v2_file_parent_links",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    fileId: text("file_id").notNull(),
    fileVersionId: text("file_version_id").notNull(),
    objectVersionId: text("object_version_id").notNull(),
    parentIdentityDigestSha256: text("parent_identity_digest_sha256").notNull(),
    parentKind: inboxV2FileParentKind("parent_kind").notNull(),
    parentPurpose: inboxV2FileParentPurpose("parent_purpose").notNull(),
    visibilityBoundary: inboxV2FileParentVisibility(
      "visibility_boundary"
    ).notNull(),
    parentConversationVisibility: inboxV2FileParentVisibility(
      "parent_conversation_visibility"
    ),
    parentEntityId: text("parent_entity_id").notNull(),
    parentEntityRevision: bigint("parent_entity_revision", {
      mode: "bigint"
    }).notNull(),
    conversationId: text("conversation_id"),
    timelineItemId: text("timeline_item_id"),
    contentId: text("content_id"),
    contentRevision: bigint("content_revision", { mode: "bigint" }),
    blockKey: text("block_key"),
    dataClassId: text("data_class_id").notNull(),
    processingPurposeId: text("processing_purpose_id").notNull(),
    retentionAnchorAt: timestamp("retention_anchor_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
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
      name: "inbox_v2_file_parent_links_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_links_version_fk",
      columns: [
        table.tenantId,
        table.fileVersionId,
        table.fileId,
        table.objectVersionId
      ],
      foreignColumns: [
        inboxV2FileVersions.tenantId,
        inboxV2FileVersions.id,
        inboxV2FileVersions.fileId,
        inboxV2FileVersions.objectVersionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_links_head_fk",
      columns: [table.tenantId, table.fileId],
      foreignColumns: [
        inboxV2FileParentSetHeads.tenantId,
        inboxV2FileParentSetHeads.fileId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_links_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_parent_links_identity_unique").on(
      table.tenantId,
      table.fileId,
      table.parentIdentityDigestSha256
    ),
    unique("inbox_v2_file_parent_links_scope_unique").on(
      table.tenantId,
      table.id,
      table.fileId
    ),
    check(
      "inbox_v2_file_parent_links_shape_check",
      sql`${brandedIdSql(table.id, "file_parent_link")}
        and ${sha256Sql(table.parentIdentityDigestSha256)}
        and ${table.parentEntityRevision} >= 1
        and ${catalogIdSql(table.dataClassId)}
        and ${catalogIdSql(table.processingPurposeId)}
        and isfinite(${table.retentionAnchorAt})
        and isfinite(${table.createdAt})
        and ${table.revision} = 1
        and (
          (${table.parentKind} = 'message'
            and ${table.visibilityBoundary} in ('external_work', 'internal')
            and ${table.parentConversationVisibility} is null
            and num_nonnulls(
              ${table.conversationId}, ${table.timelineItemId},
              ${table.contentId}, ${table.contentRevision}, ${table.blockKey}
            ) = 5)
          or (${table.parentKind} = 'staff_note'
            and ${table.visibilityBoundary} = 'staff_note'
            and ${table.parentConversationVisibility} in (
              'external_work', 'internal'
            )
            and num_nonnulls(
              ${table.conversationId}, ${table.timelineItemId},
              ${table.contentId}, ${table.contentRevision}, ${table.blockKey}
            ) = 5)
          or (${table.parentKind} = 'upload_staging'
            and ${table.visibilityBoundary} = 'upload_staging'
            and ${table.parentConversationVisibility} is null
            and ${table.parentPurpose} = 'attachment'
            and num_nonnulls(
              ${table.conversationId}, ${table.timelineItemId},
              ${table.contentId}, ${table.contentRevision}, ${table.blockKey}
            ) = 0)
        )`
    ),
    index("inbox_v2_file_parent_links_file_idx").on(
      table.tenantId,
      table.fileId,
      table.id
    ),
    index("inbox_v2_file_parent_links_parent_idx").on(
      table.tenantId,
      table.parentKind,
      table.parentEntityId,
      table.parentEntityRevision,
      table.id
    )
  ]
);

/** Mutable CAS head for one immutable exact parent edge. */
export const inboxV2FileParentLinkHeads = pgTable(
  "inbox_v2_file_parent_link_heads",
  {
    tenantId: text("tenant_id").notNull(),
    linkId: text("link_id").notNull(),
    fileId: text("file_id").notNull(),
    state: inboxV2FileParentLinkState("state").notNull().default("live"),
    detachedByEventId: text("detached_by_event_id"),
    revision: bigint("revision", { mode: "bigint" })
      .notNull()
      .default(sql`1`),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_parent_link_heads_pk",
      columns: [table.tenantId, table.linkId]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_link_heads_link_fk",
      columns: [table.tenantId, table.linkId, table.fileId],
      foreignColumns: [
        inboxV2FileParentLinks.tenantId,
        inboxV2FileParentLinks.id,
        inboxV2FileParentLinks.fileId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_link_heads_event_fk",
      columns: [table.tenantId, table.detachedByEventId],
      foreignColumns: [inboxV2DomainEvents.tenantId, inboxV2DomainEvents.id]
    }),
    foreignKey({
      name: "inbox_v2_file_parent_link_heads_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_parent_link_heads_scope_unique").on(
      table.tenantId,
      table.linkId,
      table.fileId,
      table.revision,
      table.state
    ),
    check(
      "inbox_v2_file_parent_link_heads_shape_check",
      sql`${table.revision} >= 1
        and isfinite(${table.updatedAt})
        and ((${table.state} = 'live'
            and ${table.detachedByEventId} is null
            and ${table.revision} = 1)
          or (${table.state} = 'detached'
            and ${table.detachedByEventId} is not null
            and ${table.revision} >= 2))`
    ),
    index("inbox_v2_file_parent_link_heads_live_idx")
      .on(table.tenantId, table.fileId, table.state, table.linkId)
      .where(sql`${table.state} = 'live'`)
  ]
);

export const inboxV2FileDerivativeEdges = pgTable(
  "inbox_v2_file_derivative_edges",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    originalFileVersionId: text("original_file_version_id").notNull(),
    derivedFileVersionId: text("derived_file_version_id").notNull(),
    transformKindId: text("transform_kind_id").notNull(),
    transformProfileId: text("transform_profile_id").notNull(),
    transformProfileVersion: text("transform_profile_version").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_derivative_edges_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_derivative_edges_original_fk",
      columns: [table.tenantId, table.originalFileVersionId],
      foreignColumns: [inboxV2FileVersions.tenantId, inboxV2FileVersions.id]
    }),
    foreignKey({
      name: "inbox_v2_file_derivative_edges_derived_fk",
      columns: [table.tenantId, table.derivedFileVersionId],
      foreignColumns: [inboxV2FileVersions.tenantId, inboxV2FileVersions.id]
    }),
    foreignKey({
      name: "inbox_v2_file_derivative_edges_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_derivative_edges_transform_unique").on(
      table.tenantId,
      table.originalFileVersionId,
      table.derivedFileVersionId,
      table.transformProfileId,
      table.transformProfileVersion
    ),
    check(
      "inbox_v2_file_derivative_edges_shape_check",
      sql`${brandedIdSql(table.id, "file_derivative_edge")}
        and ${table.originalFileVersionId} <> ${table.derivedFileVersionId}
        and ${catalogIdSql(table.transformKindId)}
        and ${catalogIdSql(table.transformProfileId)}
        and char_length(${table.transformProfileVersion}) between 1 and 64
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_derivative_edges_derived_idx").on(
      table.tenantId,
      table.derivedFileVersionId,
      table.id
    )
  ]
);

/** Immutable snapshot consumed by every retry of one outbound dispatch. */
export const inboxV2FileOutboundDispatchPlans = pgTable(
  "inbox_v2_file_outbound_dispatch_plans",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    messageId: text("message_id").notNull(),
    messageRevision: bigint("message_revision", { mode: "bigint" }).notNull(),
    conversationId: text("conversation_id").notNull(),
    timelineItemId: text("timeline_item_id").notNull(),
    routeId: text("route_id").notNull(),
    contentId: text("content_id").notNull(),
    contentRevision: bigint("content_revision", { mode: "bigint" }).notNull(),
    contentFingerprintPurposeId: text(
      "content_fingerprint_purpose_id"
    ).notNull(),
    contentFingerprintKeyGeneration: text(
      "content_fingerprint_key_generation"
    ).notNull(),
    contentFingerprintValidUntil: timestamp("content_fingerprint_valid_until", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    contentFingerprintHmacSha256: text(
      "content_fingerprint_hmac_sha256"
    ).notNull(),
    bindingId: text("binding_id").notNull(),
    bindingRevision: bigint("binding_revision", { mode: "bigint" }).notNull(),
    capabilityRevision: bigint("capability_revision", {
      mode: "bigint"
    }).notNull(),
    adapterContractId: text("adapter_contract_id").notNull(),
    adapterContractVersion: text("adapter_contract_version").notNull(),
    adapterContractDeclarationRevision: bigint(
      "adapter_contract_declaration_revision",
      { mode: "bigint" }
    ).notNull(),
    adapterSurfaceId: text("adapter_surface_id").notNull(),
    adapterLoadedByTrustedServiceId: text(
      "adapter_loaded_by_trusted_service_id"
    ).notNull(),
    adapterLoadedAt: timestamp("adapter_loaded_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    planDigestSha256: text("plan_digest_sha256").notNull(),
    blockCount: smallint("block_count").notNull(),
    artifactCount: smallint("artifact_count").notNull(),
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
      name: "inbox_v2_file_outbound_dispatch_plans_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_outbound_dispatch_plans_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_outbound_dispatch_plans_dispatch_unique").on(
      table.tenantId,
      table.dispatchId
    ),
    unique("inbox_v2_file_outbound_dispatch_plans_scope_unique").on(
      table.tenantId,
      table.id,
      table.dispatchId
    ),
    check(
      "inbox_v2_file_outbound_dispatch_plans_shape_check",
      sql`${brandedIdSql(table.id, "outbound_dispatch_content_plan")}
        and ${brandedIdSql(table.dispatchId, "outbound_dispatch")}
        and ${brandedIdSql(table.messageId, "message")}
        and ${brandedIdSql(table.routeId, "outbound_route")}
        and ${table.messageRevision} >= 1
        and ${table.contentRevision} >= 1
        and ${table.bindingRevision} >= 1
        and ${table.capabilityRevision} >= 1
        and ${table.contentFingerprintPurposeId} =
          'core:outbound_dispatch_content_plan'
        and ${tokenSql(table.contentFingerprintKeyGeneration)}
        and isfinite(${table.contentFingerprintValidUntil})
        and ${table.contentFingerprintValidUntil} > ${table.createdAt}
        and ${hmacSha256Sql(table.contentFingerprintHmacSha256)}
        and ${catalogIdSql(table.adapterContractId)}
        and char_length(${table.adapterContractVersion}) between 1 and 64
        and ${table.adapterContractDeclarationRevision} >= 1
        and ${catalogIdSql(table.adapterSurfaceId)}
        and ${catalogIdSql(table.adapterLoadedByTrustedServiceId)}
        and isfinite(${table.adapterLoadedAt})
        and ${table.adapterLoadedAt} <= ${table.createdAt}
        and ${sha256Sql(table.planDigestSha256)}
        and ${table.blockCount} between 1 and 64
        and ${table.artifactCount} between 1 and 64
        and ${table.revision} = 1
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_outbound_dispatch_plans_message_idx").on(
      table.tenantId,
      table.messageId,
      table.messageRevision,
      table.dispatchId
    )
  ]
);

export const inboxV2FileOutboundArtifactPlans = pgTable(
  "inbox_v2_file_outbound_artifact_plans",
  {
    tenantId: text("tenant_id").notNull(),
    id: text("id").notNull(),
    contentPlanId: text("content_plan_id").notNull(),
    dispatchId: text("dispatch_id").notNull(),
    ordinal: smallint("ordinal").notNull(),
    grouping: inboxV2FileOutboundArtifactGrouping("grouping").notNull(),
    capabilityId: text("capability_id").notNull(),
    operationId: text("operation_id").notNull(),
    artifactPlanHashSha256: text("artifact_plan_hash_sha256").notNull(),
    blockMappingCount: smallint("block_mapping_count").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_outbound_artifact_plans_pk",
      columns: [table.tenantId, table.id]
    }),
    foreignKey({
      name: "inbox_v2_file_outbound_artifact_plans_content_fk",
      columns: [table.tenantId, table.contentPlanId, table.dispatchId],
      foreignColumns: [
        inboxV2FileOutboundDispatchPlans.tenantId,
        inboxV2FileOutboundDispatchPlans.id,
        inboxV2FileOutboundDispatchPlans.dispatchId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_outbound_artifact_plans_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_outbound_artifact_plans_ordinal_unique").on(
      table.tenantId,
      table.contentPlanId,
      table.ordinal
    ),
    unique("inbox_v2_file_outbound_artifact_plans_scope_unique").on(
      table.tenantId,
      table.contentPlanId,
      table.id,
      table.ordinal
    ),
    check(
      "inbox_v2_file_outbound_artifact_plans_shape_check",
      sql`${brandedIdSql(table.id, "outbound_dispatch_artifact_plan")}
        and ${table.ordinal} between 1 and 64
        and ${catalogIdSql(table.capabilityId)}
        and ${catalogIdSql(table.operationId)}
        and ${sha256Sql(table.artifactPlanHashSha256)}
        and ${table.blockMappingCount} between 1 and 64
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_outbound_artifact_plans_dispatch_idx").on(
      table.tenantId,
      table.dispatchId,
      table.ordinal,
      table.id
    )
  ]
);

export const inboxV2FileOutboundArtifactBlocks = pgTable(
  "inbox_v2_file_outbound_artifact_blocks",
  {
    tenantId: text("tenant_id").notNull(),
    contentPlanId: text("content_plan_id").notNull(),
    artifactPlanId: text("artifact_plan_id").notNull(),
    artifactOrdinal: smallint("artifact_ordinal").notNull(),
    artifactBlockOrdinal: smallint("artifact_block_ordinal").notNull(),
    contentBlockOrdinal: smallint("content_block_ordinal").notNull(),
    blockKey: text("block_key").notNull(),
    blockKind: inboxV2FileOutboundBlockKind("block_kind").notNull(),
    fileId: text("file_id"),
    fileRevision: bigint("file_revision", { mode: "bigint" }),
    fileVersionId: text("file_version_id"),
    objectVersionId: text("object_version_id"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_file_outbound_artifact_blocks_pk",
      columns: [
        table.tenantId,
        table.contentPlanId,
        table.artifactPlanId,
        table.artifactBlockOrdinal
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_outbound_artifact_blocks_plan_fk",
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
      name: "inbox_v2_file_outbound_artifact_blocks_version_fk",
      columns: [
        table.tenantId,
        table.fileVersionId,
        table.fileId,
        table.objectVersionId
      ],
      foreignColumns: [
        inboxV2FileVersions.tenantId,
        inboxV2FileVersions.id,
        inboxV2FileVersions.fileId,
        inboxV2FileVersions.objectVersionId
      ]
    }),
    foreignKey({
      name: "inbox_v2_file_outbound_artifact_blocks_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    unique("inbox_v2_file_outbound_artifact_blocks_content_unique").on(
      table.tenantId,
      table.contentPlanId,
      table.contentBlockOrdinal
    ),
    check(
      "inbox_v2_file_outbound_artifact_blocks_shape_check",
      sql`${table.artifactOrdinal} between 1 and 64
        and ${table.artifactBlockOrdinal} between 1 and 64
        and ${table.contentBlockOrdinal} between 0 and 63
        and char_length(${table.blockKey}) between 1 and 80
        and ${table.blockKey} ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
        and num_nonnulls(
          ${table.fileId}, ${table.fileRevision},
          ${table.fileVersionId}, ${table.objectVersionId}
        ) in (0, 4)
        and ((${table.blockKind} in (
              'image', 'audio', 'video', 'file', 'sticker', 'extension'
            ) and num_nonnulls(
              ${table.fileId}, ${table.fileRevision},
              ${table.fileVersionId}, ${table.objectVersionId}
            ) = 4 and ${table.fileRevision} >= 1)
          or (${table.blockKind} in ('text', 'location', 'contact')
            and num_nonnulls(
              ${table.fileId}, ${table.fileRevision},
              ${table.fileVersionId}, ${table.objectVersionId}
            ) = 0))
        and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_file_outbound_artifact_blocks_version_idx").on(
      table.tenantId,
      table.fileVersionId,
      table.contentPlanId
    )
  ]
);

/**
 * Cross-domain authority is installed by the later migration after all timeline
 * and outbound tables exist. The schema deliberately avoids a runtime import
 * cycle while retaining deferred, tenant-exact database enforcement.
 */
export const INBOX_V2_FILE_OBJECT_INVARIANTS_SQL = String.raw`
alter table public.inbox_v2_file_attachment_materialization_jobs
  alter constraint inbox_v2_file_mat_jobs_cause_event_fk
  deferrable initially deferred;
alter table public.inbox_v2_file_attachment_materialization_jobs
  alter constraint inbox_v2_file_mat_jobs_authorization_command_fk
  deferrable initially deferred;

alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_content_payloads_file_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_content_payloads_object_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_payloads_extension_file_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_payloads_extension_object_version_fk
  deferrable initially deferred;

-- Ready V2 pins are inserted before the materializer's file/object callback.
-- This deferred commit-time fence permits that ordering while rejecting any
-- transaction that does not close the exact immutable version and current
-- ready-head relationship before commit. Legacy file FKs remain immediate.
create or replace function public.inbox_v2_tm_payload_exact_pin_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.attachment_v2_file_id is not null and not exists (
    select 1
      from public.inbox_v2_file_objects file_row
      join public.inbox_v2_file_versions version_row
        on version_row.tenant_id = file_row.tenant_id
       and version_row.id = new.attachment_file_version_id
       and version_row.file_id = file_row.id
       and version_row.object_version_id = new.attachment_object_version_id
      join public.inbox_v2_file_object_versions object_version_row
        on object_version_row.tenant_id = version_row.tenant_id
       and object_version_row.id = version_row.object_version_id
      join public.inbox_v2_file_object_version_heads object_head_row
        on object_head_row.tenant_id = object_version_row.tenant_id
       and object_head_row.object_version_id = object_version_row.id
     where file_row.tenant_id = new.tenant_id
       and file_row.id = new.attachment_v2_file_id
       and file_row.revision = new.attachment_file_revision
       and file_row.state = 'ready'
       and file_row.current_file_version_id = version_row.id
       and file_row.current_object_version_id = version_row.object_version_id
       and object_head_row.state = 'ready'
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.timeline_payload_attachment_exact_pin_invalid';
  end if;

  if new.extension_payload_v2_file_id is not null and not exists (
    select 1
      from public.inbox_v2_file_objects file_row
      join public.inbox_v2_file_versions version_row
        on version_row.tenant_id = file_row.tenant_id
       and version_row.id = new.extension_payload_file_version_id
       and version_row.file_id = file_row.id
       and version_row.object_version_id =
         new.extension_payload_object_version_id
      join public.inbox_v2_file_object_versions object_version_row
        on object_version_row.tenant_id = version_row.tenant_id
       and object_version_row.id = version_row.object_version_id
      join public.inbox_v2_file_object_version_heads object_head_row
        on object_head_row.tenant_id = object_version_row.tenant_id
       and object_head_row.object_version_id = object_version_row.id
     where file_row.tenant_id = new.tenant_id
       and file_row.id = new.extension_payload_v2_file_id
       and file_row.revision = new.extension_payload_file_revision
       and file_row.state = 'ready'
       and file_row.current_file_version_id = version_row.id
       and file_row.current_object_version_id = version_row.object_version_id
       and object_head_row.state = 'ready'
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.timeline_payload_extension_exact_pin_invalid';
  end if;
  return null;
end;
$function$;

create constraint trigger inbox_v2_tm_payload_exact_pin_coherence
after insert on public.inbox_v2_timeline_content_payloads
deferrable initially deferred
for each row execute function public.inbox_v2_tm_payload_exact_pin_guard();

create or replace function public.inbox_v2_file_delete_is_tenant_cascade(
  tenant_id_value text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select pg_catalog.pg_trigger_depth() > 1
    and not exists (
      select 1
        from public.tenants tenant_row
       where tenant_row.id = tenant_id_value
    );
$function$;

create or replace function public.inbox_v2_file_immutable_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = 'inbox_v2.file_immutable';
end;
$function$;

create or replace function public.inbox_v2_file_object_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  mapped boolean;
  materialization_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' and (
    new.state <> 'pending'
    or new.revision <> 1
    or new.current_file_version_id is not null
    or new.current_object_version_id is not null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_head_initial_state_invalid';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id
       or new.id <> old.id
       or new.data_class_id <> old.data_class_id
       or new.processing_purpose_id <> old.processing_purpose_id
       or new.retention_anchor_at <> old.retention_anchor_at
       or new.created_at <> old.created_at
       or new.revision <> old.revision + 1
       or new.updated_at < old.updated_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.file_object_head_cas_invalid';
    end if;

    if old.state <> 'pending' or new.state <> 'ready'
       or old.current_file_version_id is not null
       or old.current_object_version_id is not null
       or new.current_file_version_id is null
       or new.current_object_version_id is null then
      raise exception using errcode = '23514',
        message = 'inbox_v2.file_object_head_transition_invalid';
    end if;
  end if;

  if new.current_file_version_id is not null then
    select exists (
      select 1
        from public.inbox_v2_file_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.id = new.current_file_version_id
         and version_row.file_id = new.id
         and version_row.object_version_id = new.current_object_version_id
    ) into mapped;
    if not mapped then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_head_version_invalid';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_jobs job_row
        join public.inbox_v2_file_versions version_row
          on version_row.tenant_id = job_row.tenant_id
         and version_row.id = job_row.reserved_file_version_id
         and version_row.file_id = job_row.file_id
         and version_row.object_version_id = job_row.reserved_object_version_id
        join public.inbox_v2_file_object_version_heads object_head_row
          on object_head_row.tenant_id = job_row.tenant_id
         and object_head_row.object_version_id =
           job_row.reserved_object_version_id
         and object_head_row.state = 'ready'
        join public.inbox_v2_file_object_operation_evidence evidence_row
          on evidence_row.tenant_id = object_head_row.tenant_id
         and evidence_row.id = object_head_row.latest_operation_evidence_id
         and evidence_row.object_version_id = object_head_row.object_version_id
         and evidence_row.materialization_job_id = job_row.id
         and evidence_row.operation_kind = 'put'
         and evidence_row.outcome = 'succeeded'
         and evidence_row.completed_at = object_head_row.state_changed_at
       where job_row.tenant_id = new.tenant_id
         and job_row.file_id = new.id
         and job_row.expected_file_revision = old.revision
         and job_row.reserved_file_version_id = new.current_file_version_id
         and job_row.reserved_object_version_id = new.current_object_version_id
         and job_row.state in ('claimed', 'transferring', 'verifying')
         and evidence_row.completed_at = new.updated_at
    ) into materialization_valid;
    if not materialization_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_head_materialization_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_object_version_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  evidence_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' and (
    new.revision <> 1
    or new.state not in ('staging', 'ready')
    or (new.state = 'staging' and new.latest_operation_evidence_id is not null)
    or (new.state = 'ready' and new.latest_operation_evidence_id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_initial_state_invalid';
  end if;

  if tg_op = 'UPDATE' and (
    new.tenant_id <> old.tenant_id
    or new.object_version_id <> old.object_version_id
    or new.created_at <> old.created_at
    or new.revision <> old.revision + 1
    or new.state_changed_at < old.state_changed_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_cas_invalid';
  end if;

  if tg_op = 'UPDATE' and (
    old.state <> 'staging'
    or new.state <> 'ready'
    or new.latest_operation_evidence_id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_transition_invalid';
  end if;

  if new.state = 'ready' then
    select exists (
      select 1
        from public.inbox_v2_file_object_versions object_version_row
        join public.inbox_v2_file_object_operation_evidence evidence_row
          on evidence_row.tenant_id = object_version_row.tenant_id
         and evidence_row.object_version_id = object_version_row.id
        join public.inbox_v2_file_attachment_materialization_jobs job_row
          on job_row.tenant_id = evidence_row.tenant_id
         and job_row.id = evidence_row.materialization_job_id
         and job_row.reserved_object_version_id = evidence_row.object_version_id
         and job_row.reserved_storage_root_id = evidence_row.storage_root_id
       where evidence_row.tenant_id = new.tenant_id
         and evidence_row.id = new.latest_operation_evidence_id
         and evidence_row.object_version_id = new.object_version_id
         and evidence_row.operation_kind = 'put'
         and evidence_row.outcome = 'succeeded'
         and evidence_row.safe_reason_id is null
         and evidence_row.expected_object_head_revision is null
         and evidence_row.completed_at = new.state_changed_at
         and evidence_row.requested_at <= evidence_row.completed_at
         and evidence_row.affected_bytes = object_version_row.size_bytes
         and object_version_row.storage_root_id = evidence_row.storage_root_id
         and job_row.reserved_storage_object_key =
           object_version_row.storage_object_key
         and job_row.state in ('claimed', 'transferring', 'verifying')
    ) into evidence_valid;
    if not evidence_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_version_evidence_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_materialization_job_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_valid boolean := false;
  old_active boolean;
  new_active boolean;
  reauthorization boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.revision <> 1
       or new.lease_generation <> 0
       or new.authorization_command_type_id <>
         'core:attachment.materialization.reserve'
       or new.terminal_reason_id is not null then
      raise exception using errcode = '23514',
        message = 'inbox_v2.attachment_materialization_initial_state_invalid';
    end if;
    return new;
  end if;

  reauthorization :=
    old.state = 'pending'
    and new.state = 'pending'
    and num_nonnulls(
      old.lease_token_hash, old.lease_owner_id,
      old.lease_claimed_at, old.lease_expires_at
    ) = 0
    and num_nonnulls(
      new.lease_token_hash, new.lease_owner_id,
      new.lease_claimed_at, new.lease_expires_at
    ) = 0
    and new.lease_generation = old.lease_generation
    and new.authorization_command_type_id =
      'core:attachment.materialization.reauthorize'
    and new.authorization_command_id is distinct from
      old.authorization_command_id
    and new.authorization_actor_kind = 'trusted_service'
    and new.authorization_authorized_at >= old.authorization_authorized_at;

  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.attachment_id is distinct from old.attachment_id
     or new.file_id is distinct from old.file_id
     or new.expected_file_revision is distinct from old.expected_file_revision
     or new.conversation_id is distinct from old.conversation_id
     or new.timeline_item_id is distinct from old.timeline_item_id
     or new.parent_message_id is distinct from old.parent_message_id
     or new.expected_parent_revision is distinct from
       old.expected_parent_revision
     or new.visibility_boundary is distinct from old.visibility_boundary
     or new.timeline_content_id is distinct from old.timeline_content_id
     or new.expected_content_revision is distinct from old.expected_content_revision
     or new.content_block_key is distinct from old.content_block_key
     or new.content_mutation_fence_sha256 is distinct from
       old.content_mutation_fence_sha256
     or new.source_occurrence_id is distinct from old.source_occurrence_id
     or new.source_locator_kind is distinct from old.source_locator_kind
     or new.source_locator_reference is distinct from old.source_locator_reference
     or new.source_locator_digest_sha256 is distinct from
       old.source_locator_digest_sha256
     or new.reservation_namespace_generation is distinct from
       old.reservation_namespace_generation
     or new.idempotency_token is distinct from old.idempotency_token
     or new.cause_event_id is distinct from old.cause_event_id
     or new.cause_mutation_id is distinct from old.cause_mutation_id
     or new.cause_stream_commit_id is distinct from old.cause_stream_commit_id
     or new.cause_stream_position is distinct from old.cause_stream_position
     or new.correlation_id is distinct from old.correlation_id
     or new.caused_at is distinct from old.caused_at
     or (not reauthorization and (
       new.authorization_command_id is distinct from
         old.authorization_command_id
       or new.authorization_command_type_id is distinct from
         old.authorization_command_type_id
       or new.authorization_client_mutation_id is distinct from
         old.authorization_client_mutation_id
       or new.authorization_mutation_id is distinct from
         old.authorization_mutation_id
       or new.authorization_decision_id is distinct from
         old.authorization_decision_id
       or new.authorization_epoch is distinct from old.authorization_epoch
       or new.authorization_actor_kind is distinct from
         old.authorization_actor_kind
       or new.authorization_actor_id is distinct from
         old.authorization_actor_id
       or new.authorization_authorized_at is distinct from
         old.authorization_authorized_at
       or new.authorization_decision_set_digest_sha256 is distinct from
         old.authorization_decision_set_digest_sha256
       or new.authorization_resource_fence_set_digest_sha256 is distinct from
         old.authorization_resource_fence_set_digest_sha256
       or new.authorization_tenant_rbac_revision is distinct from
         old.authorization_tenant_rbac_revision
       or new.authorization_shared_access_revision is distinct from
         old.authorization_shared_access_revision
       or new.authorization_resource_head_id is distinct from
         old.authorization_resource_head_id
       or new.authorization_resource_access_revision is distinct from
         old.authorization_resource_access_revision
       or new.authorization_structural_relation_revision is distinct from
         old.authorization_structural_relation_revision
       or new.authorization_collaborator_set_revision is distinct from
         old.authorization_collaborator_set_revision
       or new.authorization_audit_grant_source_ids is distinct from
         old.authorization_audit_grant_source_ids
       or new.authorization_audit_policy_version is distinct from
         old.authorization_audit_policy_version
     ))
     or new.expected_attachment_revision is distinct from
       old.expected_attachment_revision
     or new.reserved_file_version_id is distinct from
       old.reserved_file_version_id
     or new.reserved_object_version_id is distinct from
       old.reserved_object_version_id
     or new.reserved_storage_root_id is distinct from
       old.reserved_storage_root_id
     or new.reserved_storage_object_key is distinct from
       old.reserved_storage_object_key
     or new.created_at is distinct from old.created_at
     or new.updated_at < old.updated_at
     or new.revision <> old.revision + 1
     or new.lease_generation < old.lease_generation
     or new.lease_generation > old.lease_generation + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_cas_invalid';
  end if;

  if old.state in ('ready', 'failed', 'quarantined', 'cancelled') then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_terminal';
  end if;

  old_active := old.state in ('claimed', 'transferring', 'verifying');
  new_active := new.state in ('claimed', 'transferring', 'verifying');

  if reauthorization then
    transition_valid := true;
  elsif old.state = 'pending' and new.state = 'claimed' then
    transition_valid :=
      new.lease_generation = old.lease_generation + 1;
  elsif old.state = 'pending' and new.state = 'cancelled' then
    transition_valid :=
      new.lease_generation = old.lease_generation;
  elsif old_active and new.state = 'pending' then
    transition_valid :=
      new.lease_generation = old.lease_generation
      and num_nonnulls(
        new.lease_token_hash, new.lease_owner_id,
        new.lease_claimed_at, new.lease_expires_at
      ) = 0;
  elsif old_active and new.state = old.state then
    transition_valid :=
      old.lease_expires_at <= clock_timestamp()
      and new.lease_generation = old.lease_generation + 1
      and new.lease_token_hash is distinct from old.lease_token_hash
      and new.lease_claimed_at >= old.lease_expires_at;
  elsif old_active and (
    (old.state = 'claimed' and new.state in (
      'transferring', 'verifying', 'ready', 'failed', 'quarantined',
      'cancelled'
    ))
    or (old.state = 'transferring' and new.state in (
      'verifying', 'ready', 'failed', 'quarantined', 'cancelled'
    ))
    or (old.state = 'verifying' and new.state in (
      'ready', 'failed', 'quarantined', 'cancelled'
    ))
  ) then
    transition_valid :=
      new.lease_generation = old.lease_generation
      and (
        (new_active
          and new.lease_token_hash is not distinct from old.lease_token_hash
          and new.lease_owner_id is not distinct from old.lease_owner_id
          and new.lease_claimed_at is not distinct from old.lease_claimed_at
          and new.lease_expires_at is not distinct from old.lease_expires_at)
        or (not new_active
          and num_nonnulls(
            new.lease_token_hash, new.lease_owner_id,
            new.lease_claimed_at, new.lease_expires_at
          ) = 0)
      );
  end if;

  if not transition_valid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_materialization_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  job_row public.inbox_v2_file_attachment_materialization_jobs%rowtype;
  identity_valid boolean;
  attempt_valid boolean;
  completion_valid boolean;
  requires_current_fence boolean;
begin
  if tg_table_name = 'inbox_v2_file_attachment_materialization_jobs'
     and tg_op = 'INSERT' then
    job_row := new;
  elsif tg_table_name = 'inbox_v2_file_attachment_materialization_jobs' then
    select * into job_row
      from public.inbox_v2_file_attachment_materialization_jobs candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.id = new.id;
  else
    select * into job_row
      from public.inbox_v2_file_attachment_materialization_jobs candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.id = new.job_id;
  end if;

  -- The immutable reservation origin remains authoritative evidence even
  -- after current content or access has moved on. Only a completed terminal
  -- materialization is required to remain attached to the exact current head;
  -- claim and pre-I/O authorization own the live-current fence for pending,
  -- active and cancelled jobs.
  requires_current_fence :=
    job_row.state in ('ready', 'failed', 'quarantined');

  select exists (
    select 1
      from public.inbox_v2_message_attachment_anchors attachment_row
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = attachment_row.tenant_id
       and content_row.id = attachment_row.owner_timeline_content_id
       and content_row.id = job_row.timeline_content_id
      join public.inbox_v2_timeline_content_revisions origin_revision_row
        on origin_revision_row.tenant_id = content_row.tenant_id
       and origin_revision_row.content_id = content_row.id
       and origin_revision_row.revision = job_row.expected_content_revision
       and origin_revision_row.state = 'available'
       and origin_revision_row.recorded_stream_position =
         job_row.cause_stream_position
      left join public.inbox_v2_timeline_content_payloads origin_payload_row
        on origin_payload_row.tenant_id = content_row.tenant_id
       and origin_payload_row.content_id = content_row.id
       and origin_payload_row.content_revision = job_row.expected_content_revision
       and origin_payload_row.block_key = job_row.content_block_key
       and origin_payload_row.attachment_id = job_row.attachment_id
       and origin_payload_row.attachment_state = 'pending'
      left join public.inbox_v2_timeline_content_payloads current_payload_row
        on current_payload_row.tenant_id = content_row.tenant_id
       and current_payload_row.content_id = content_row.id
       and current_payload_row.content_revision = content_row.revision
       and current_payload_row.block_key = job_row.content_block_key
       and current_payload_row.attachment_id = job_row.attachment_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = content_row.tenant_id
       and message_row.id = job_row.parent_message_id
       and message_row.conversation_id = job_row.conversation_id
       and message_row.timeline_item_id = job_row.timeline_item_id
       and message_row.content_id = content_row.id
       and message_row.content_revision = content_row.revision
       and message_row.content_state = content_row.state
       and message_row.revision >= job_row.expected_parent_revision
       and content_row.owner_kind = 'message'
       and content_row.owner_id = message_row.id
      join public.inbox_v2_message_revisions origin_message_revision_row
        on origin_message_revision_row.tenant_id = message_row.tenant_id
       and origin_message_revision_row.message_id = message_row.id
       and origin_message_revision_row.timeline_item_id = message_row.timeline_item_id
       and origin_message_revision_row.message_revision =
         job_row.expected_parent_revision
       and origin_message_revision_row.after_content_id = content_row.id
       and origin_message_revision_row.after_content_revision =
         job_row.expected_content_revision
       and origin_message_revision_row.after_content_state = 'available'
       and origin_message_revision_row.recorded_stream_position =
         job_row.cause_stream_position
      join public.inbox_v2_timeline_items timeline_item_row
        on timeline_item_row.tenant_id = message_row.tenant_id
       and timeline_item_row.id = message_row.timeline_item_id
       and timeline_item_row.conversation_id = message_row.conversation_id
      left join public.inbox_v2_source_occurrences source_occurrence_row
        on source_occurrence_row.tenant_id = job_row.tenant_id
       and source_occurrence_row.id = job_row.source_occurrence_id
       and source_occurrence_row.conversation_id = job_row.conversation_id
      join public.inbox_v2_domain_events cause_event_row
        on cause_event_row.tenant_id = job_row.tenant_id
       and cause_event_row.id = job_row.cause_event_id
       and cause_event_row.mutation_id = job_row.cause_mutation_id
       and cause_event_row.stream_commit_id = job_row.cause_stream_commit_id
       and cause_event_row.stream_position = job_row.cause_stream_position
       and cause_event_row.correlation_id = job_row.correlation_id
       and cause_event_row.occurred_at = job_row.caused_at
       and cause_event_row.type_id = 'core:message.changed'
       and cause_event_row.subjects @> jsonb_build_array(
         jsonb_build_object(
           'tenantId', job_row.tenant_id,
           'entityTypeId', 'core:message',
           'entityId', message_row.id
         )
       )
      join public.inbox_v2_tenant_stream_changes cause_change_row
        on cause_change_row.tenant_id = cause_event_row.tenant_id
       and cause_change_row.stream_commit_id =
         cause_event_row.stream_commit_id
       and cause_change_row.mutation_id = cause_event_row.mutation_id
       and cause_change_row.stream_position = cause_event_row.stream_position
       and cause_change_row.entity_type_id = 'core:message'
       and cause_change_row.entity_id = message_row.id
       and cause_event_row.change_ids @>
         jsonb_build_array(cause_change_row.id)
      join public.inbox_v2_auth_command_records authorization_command_row
        on authorization_command_row.tenant_id = job_row.tenant_id
       and authorization_command_row.id = job_row.authorization_command_id
       and authorization_command_row.command_type_id =
         job_row.authorization_command_type_id
       and authorization_command_row.command_type_id in (
         'core:attachment.materialization.reserve',
         'core:attachment.materialization.reauthorize'
       )
       and authorization_command_row.client_mutation_id =
         job_row.authorization_client_mutation_id
       and authorization_command_row.mutation_id =
         job_row.authorization_mutation_id
       and authorization_command_row.authorization_decision_id =
         job_row.authorization_decision_id
       and authorization_command_row.authorization_epoch =
         job_row.authorization_epoch
       and authorization_command_row.authorized_at =
         job_row.authorization_authorized_at
       and authorization_command_row.state = 'completed'
       and authorization_command_row.result_reference->>'tenantId' =
         job_row.tenant_id
       and authorization_command_row.result_reference->>'recordId' = job_row.id
       and job_row.authorization_actor_kind = 'trusted_service'
       and authorization_command_row.actor_kind = 'trusted_service'
       and authorization_command_row.actor_trusted_service_id =
         job_row.authorization_actor_id
       and authorization_command_row.actor_employee_id is null
      join public.inbox_v2_auth_audit_events authorization_audit_row
        on authorization_audit_row.tenant_id = job_row.tenant_id
       and authorization_audit_row.command_record_id =
         job_row.authorization_command_id
       and authorization_audit_row.mutation_id =
         job_row.authorization_mutation_id
       and authorization_audit_row.grant_source_ids =
         job_row.authorization_audit_grant_source_ids
       and authorization_audit_row.policy_version is not distinct from
         job_row.authorization_audit_policy_version
      join public.inbox_v2_auth_tenant_heads authorization_tenant_head_row
        on authorization_tenant_head_row.tenant_id = job_row.tenant_id
      join public.inbox_v2_auth_resource_heads authorization_resource_head_row
        on authorization_resource_head_row.tenant_id = job_row.tenant_id
       and authorization_resource_head_row.id =
         job_row.authorization_resource_head_id
       and authorization_resource_head_row.resource_kind = 'conversation'
       and authorization_resource_head_row.conversation_id =
         job_row.conversation_id
       and not exists (
         select 1
           from unnest(job_row.authorization_audit_grant_source_ids)
                with ordinality grant_source(value, ordinal)
           left join unnest(job_row.authorization_audit_grant_source_ids)
                with ordinality previous_source(value, ordinal)
             on previous_source.ordinal = grant_source.ordinal - 1
          where grant_source.value !~ '^internal-ref:[a-f0-9]{32,64}$'
             or (grant_source.ordinal > 1
               and grant_source.value <= previous_source.value)
       )
       and jsonb_array_length(
         authorization_command_row.authorization_decision_refs
       ) = 2
       and exists (
         select 1
           from jsonb_array_elements(
             authorization_command_row.authorization_decision_refs
           ) decision
          where decision->>'id' = job_row.authorization_decision_id
            and decision->>'tenantId' = job_row.tenant_id
            and decision->>'authorizationEpoch' = job_row.authorization_epoch
            and decision->>'permissionId' = 'core:file.upload'
            and decision->>'resourceScopeId' = 'core:conversation'
            and decision->>'outcome' = 'allowed'
            and decision#>>'{principal,kind}' = 'trusted_service'
            and decision#>>'{principal,trustedServiceId}' =
              job_row.authorization_actor_id
            and decision#>>'{resource,entityTypeId}' = 'core:conversation'
            and decision#>>'{resource,entityId}' = job_row.conversation_id
            and (decision->>'resourceAccessRevision')::bigint =
              job_row.authorization_resource_access_revision
       )
       and exists (
         select 1
           from jsonb_array_elements(
             authorization_command_row.authorization_decision_refs
           ) decision
          where decision->>'tenantId' = job_row.tenant_id
            and decision->>'authorizationEpoch' = job_row.authorization_epoch
            and decision->>'permissionId' = case job_row.visibility_boundary
              when 'external_work' then 'core:conversation.read'
              when 'internal' then 'core:conversation.internal.read'
            end
            and decision->>'resourceScopeId' = 'core:conversation'
            and decision->>'outcome' = 'allowed'
            and decision#>>'{principal,kind}' = 'trusted_service'
            and decision#>>'{principal,trustedServiceId}' =
              job_row.authorization_actor_id
            and decision#>>'{resource,entityTypeId}' = 'core:conversation'
            and decision#>>'{resource,entityId}' = job_row.conversation_id
            and (decision->>'resourceAccessRevision')::bigint =
              job_row.authorization_resource_access_revision
       )
     where attachment_row.tenant_id = job_row.tenant_id
       and attachment_row.id = job_row.attachment_id
       and attachment_row.owner_message_id = job_row.parent_message_id
       and attachment_row.owner_timeline_item_id = job_row.timeline_item_id
       and attachment_row.owner_timeline_content_id =
         job_row.timeline_content_id
       and attachment_row.owner_block_key = job_row.content_block_key
       and (
         origin_payload_row.attachment_id = job_row.attachment_id
         or (
           content_row.state in ('privacy_erased', 'retention_purged')
           and origin_payload_row.attachment_id is null
         )
       )
       and content_row.revision >= job_row.expected_content_revision
       and (
         not requires_current_fence
         or (
           content_row.state = 'available'
           and message_row.lifecycle = 'active'
           and content_row.revision = job_row.result_content_revision
           and timeline_item_row.visibility = case job_row.visibility_boundary
             when 'external_work' then
               'conversation_external'::public.inbox_v2_timeline_visibility
             when 'internal' then
               'internal_participants'::public.inbox_v2_timeline_visibility
           end
           and attachment_row.materialization_state::text = job_row.state::text
           and attachment_row.revision =
             job_row.expected_attachment_revision + 1
           and current_payload_row.attachment_state::text = job_row.state::text
           and authorization_tenant_head_row.tenant_rbac_revision =
             job_row.authorization_tenant_rbac_revision
           and authorization_tenant_head_row.shared_access_revision =
             job_row.authorization_shared_access_revision
           and authorization_resource_head_row.resource_access_revision =
             job_row.authorization_resource_access_revision
           and authorization_resource_head_row.structural_relation_revision =
             job_row.authorization_structural_relation_revision
           and authorization_resource_head_row.collaborator_set_revision =
             job_row.authorization_collaborator_set_revision
         )
       )
       and (job_row.source_locator_kind <> 'provider'
         or (source_occurrence_row.id is not null
           and message_row.origin_source_occurrence_id =
             job_row.source_occurrence_id))
  ) into identity_valid;
  if not identity_valid then
    raise exception using errcode = '23503',
      message = 'inbox_v2.attachment_materialization_identity_invalid';
  end if;

  if job_row.state = 'cancelled' then
    return new;
  end if;

  if job_row.state in ('claimed', 'transferring', 'verifying',
                       'ready', 'failed', 'quarantined') then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_attempts attempt_row
       where attempt_row.tenant_id = job_row.tenant_id
         and attempt_row.job_id = job_row.id
         and attempt_row.attachment_id = job_row.attachment_id
         and attempt_row.file_id = job_row.file_id
         and attempt_row.lease_generation = job_row.lease_generation
         and attempt_row.expected_file_revision = job_row.expected_file_revision
         and attempt_row.expected_attachment_revision =
           job_row.expected_attachment_revision
         and attempt_row.expected_job_revision <= job_row.revision
         and (job_row.state not in ('claimed', 'transferring', 'verifying')
           or (attempt_row.lease_token_hash = job_row.lease_token_hash
             and attempt_row.lease_owner_id = job_row.lease_owner_id
             and attempt_row.claimed_at = job_row.lease_claimed_at
             and attempt_row.lease_expires_at = job_row.lease_expires_at))
    ) into attempt_valid;
    if not attempt_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.attachment_materialization_attempt_invalid';
    end if;
  end if;

  if job_row.state in ('ready', 'failed', 'quarantined') then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_evidence evidence_row
        join public.inbox_v2_message_attachment_anchors attachment_row
          on attachment_row.tenant_id = evidence_row.tenant_id
         and attachment_row.id = evidence_row.attachment_id
         and attachment_row.revision = evidence_row.resulting_attachment_revision
        join public.inbox_v2_timeline_content_revisions revision_row
          on revision_row.tenant_id = evidence_row.tenant_id
         and revision_row.content_id = evidence_row.timeline_content_id
         and revision_row.revision = evidence_row.resulting_content_revision
         and revision_row.expected_previous_revision =
           evidence_row.expected_content_revision
         and revision_row.transition_kind = 'attachment_materialization'
         and revision_row.state = 'available'
        join public.inbox_v2_timeline_content_payloads payload_row
          on payload_row.tenant_id = evidence_row.tenant_id
         and payload_row.content_id = evidence_row.timeline_content_id
         and payload_row.content_revision = evidence_row.resulting_content_revision
         and payload_row.block_key = job_row.content_block_key
         and payload_row.attachment_id = evidence_row.attachment_id
       where evidence_row.tenant_id = job_row.tenant_id
         and evidence_row.job_id = job_row.id
         and evidence_row.attachment_id = job_row.attachment_id
         and evidence_row.file_id = job_row.file_id
         and evidence_row.lease_generation = job_row.lease_generation
         and evidence_row.expected_file_revision = job_row.expected_file_revision
         and evidence_row.expected_attachment_revision =
           job_row.expected_attachment_revision
         and evidence_row.timeline_content_id = job_row.timeline_content_id
         and evidence_row.expected_content_revision >=
           job_row.expected_content_revision
         and evidence_row.resulting_content_revision =
           evidence_row.expected_content_revision + 1
         and evidence_row.resulting_content_revision =
           job_row.result_content_revision
         and evidence_row.content_mutation_fence_sha256 =
           job_row.content_mutation_fence_sha256
         and evidence_row.outcome::text = job_row.state::text
         and evidence_row.result_file_version_id is not distinct from
           job_row.result_file_version_id
         and evidence_row.result_object_version_id is not distinct from
           job_row.result_object_version_id
         and evidence_row.resulting_file_revision is not distinct from
           job_row.result_file_revision
         and evidence_row.safe_reason_id is not distinct from
           job_row.terminal_reason_id
         and (job_row.state = 'failed' or exists (
           select 1
             from public.inbox_v2_file_object_operation_evidence operation_row
            where operation_row.tenant_id = evidence_row.tenant_id
              and operation_row.id = evidence_row.object_operation_evidence_id
              and operation_row.materialization_job_id = job_row.id
              and operation_row.object_version_id = case
                when job_row.state = 'ready'
                  then job_row.result_object_version_id
                else job_row.reserved_object_version_id
              end
              and operation_row.operation_kind::text = case
                when job_row.state = 'ready' then 'put'
                else 'quarantine'
              end
              and operation_row.outcome = 'succeeded'
         ))
         and payload_row.attachment_state::text = job_row.state::text
         and payload_row.attachment_file_version_id is not distinct from
           job_row.result_file_version_id
         and payload_row.attachment_object_version_id is not distinct from
           job_row.result_object_version_id
         and payload_row.attachment_v2_file_id is not distinct from case
           when job_row.state = 'ready' then job_row.file_id else null end
         and payload_row.attachment_file_revision is not distinct from case
           when job_row.state = 'ready'
             then job_row.result_file_revision else null end
         and payload_row.attachment_failure_reason_id is not distinct from case
           when job_row.state in ('failed', 'quarantined')
             then job_row.terminal_reason_id else null end
         and (job_row.state <> 'ready' or exists (
           select 1
             from public.inbox_v2_file_objects file_row
             join public.inbox_v2_file_versions file_version_row
               on file_version_row.tenant_id = file_row.tenant_id
              and file_version_row.id = job_row.result_file_version_id
              and file_version_row.file_id = file_row.id
              and file_version_row.object_version_id =
                job_row.result_object_version_id
             join public.inbox_v2_file_object_versions object_version_row
               on object_version_row.tenant_id = file_row.tenant_id
              and object_version_row.id = job_row.result_object_version_id
             join public.inbox_v2_file_object_version_heads object_head_row
               on object_head_row.tenant_id = object_version_row.tenant_id
              and object_head_row.object_version_id = object_version_row.id
            where file_row.tenant_id = job_row.tenant_id
              and file_row.id = job_row.file_id
              and file_row.revision = job_row.result_file_revision
              and file_row.state = 'ready'
              and file_row.current_file_version_id =
                job_row.result_file_version_id
              and file_row.current_object_version_id =
                job_row.result_object_version_id
              and object_version_row.storage_root_id =
                job_row.reserved_storage_root_id
              and object_version_row.storage_object_key =
                job_row.reserved_storage_object_key
              and object_head_row.state = 'ready'
         ))
    ) into completion_valid;
    if not completion_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.attachment_materialization_completion_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_storage_orphan_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_valid boolean := false;
  adoption_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_delete_forbidden';
  end if;
  if old.state in ('quarantined', 'adopted', 'deleted', 'failed')
     or new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.materialization_job_id is distinct from old.materialization_job_id
     or new.storage_root_id is distinct from old.storage_root_id
     or new.storage_object_key is distinct from old.storage_object_key
     or new.storage_version_identity is distinct from old.storage_version_identity
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.size_bytes is distinct from old.size_bytes
     or new.detected_media_type is distinct from old.detected_media_type
     or new.quarantine_reason_code is distinct from old.quarantine_reason_code
     or new.quarantine_evidence_digest_sha256 is distinct from
       old.quarantine_evidence_digest_sha256
     or new.quarantine_physical_kind is distinct from old.quarantine_physical_kind
     or new.first_observed_at is distinct from old.first_observed_at
     or new.revision <> old.revision + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_cas_invalid';
  end if;

  if old.state = 'open' and new.state in ('claimed', 'adopted', 'failed') then
    transition_valid := true;
  elsif old.state = 'claimed' and new.state = 'claimed' then
    transition_valid :=
      old.claim_expires_at <= clock_timestamp()
      and new.claim_token_hash is distinct from old.claim_token_hash;
  elsif old.state = 'claimed' and new.state in ('adopted', 'deleted', 'failed') then
    transition_valid := true;
  end if;
  if not transition_valid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_transition_invalid';
  end if;

  if new.state = 'adopted' then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_jobs job_row
        join public.inbox_v2_file_object_versions object_version_row
          on object_version_row.tenant_id = job_row.tenant_id
         and object_version_row.id = job_row.result_object_version_id
        join public.inbox_v2_file_attachment_materialization_evidence evidence_row
          on evidence_row.tenant_id = job_row.tenant_id
         and evidence_row.job_id = job_row.id
         and evidence_row.outcome = 'ready'
         and evidence_row.result_object_version_id =
           job_row.result_object_version_id
         and evidence_row.evidence_hash_sha256 =
           new.terminal_evidence_digest_sha256
       where job_row.tenant_id = new.tenant_id
         and job_row.id = new.materialization_job_id
         and job_row.state = 'ready'
         and job_row.result_object_version_id =
           new.adopted_object_version_id
         and job_row.reserved_object_version_id =
           new.adopted_object_version_id
         and object_version_row.storage_root_id = new.storage_root_id
         and object_version_row.storage_object_key = new.storage_object_key
         and object_version_row.storage_version_identity =
           new.storage_version_identity
         and object_version_row.checksum_sha256 = new.checksum_sha256
         and object_version_row.size_bytes = new.size_bytes
         and object_version_row.detected_media_type = new.detected_media_type
    ) into adoption_valid;
    if not adoption_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_storage_orphan_adoption_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  parent_valid boolean := false;
  head_row record;
begin
  if tg_table_name = 'inbox_v2_file_parent_links' then
    if new.parent_kind = 'message' then
      select exists (
        select 1
          from public.inbox_v2_messages message_row
          join public.inbox_v2_timeline_items item_row
            on item_row.tenant_id = message_row.tenant_id
           and item_row.id = message_row.timeline_item_id
           and item_row.conversation_id = message_row.conversation_id
         where message_row.tenant_id = new.tenant_id
           and message_row.id = new.parent_entity_id
           and message_row.revision = new.parent_entity_revision
           and message_row.conversation_id = new.conversation_id
           and message_row.timeline_item_id = new.timeline_item_id
           and message_row.content_id = new.content_id
           and message_row.content_revision = new.content_revision
           and ((new.visibility_boundary = 'external_work'
                and item_row.visibility = 'conversation_external')
             or (new.visibility_boundary = 'internal'
                and item_row.visibility = 'internal_participants'))
      ) into parent_valid;
    elsif new.parent_kind = 'staff_note' then
      select exists (
        select 1
          from public.inbox_v2_staff_notes note_row
          join public.inbox_v2_timeline_items item_row
            on item_row.tenant_id = note_row.tenant_id
           and item_row.id = note_row.timeline_item_id
           and item_row.conversation_id = note_row.conversation_id
         where note_row.tenant_id = new.tenant_id
           and note_row.id = new.parent_entity_id
           and note_row.revision = new.parent_entity_revision
           and note_row.conversation_id = new.conversation_id
           and note_row.timeline_item_id = new.timeline_item_id
           and note_row.content_id = new.content_id
           and note_row.content_revision = new.content_revision
           and item_row.visibility = 'staff_only'
      ) into parent_valid;
    else
      select exists (
        select 1
          from public.inbox_v2_message_attachment_anchors attachment_row
         where attachment_row.tenant_id = new.tenant_id
           and attachment_row.id = new.parent_entity_id
           and attachment_row.revision = new.parent_entity_revision
           and exists (
             select 1
               from public.inbox_v2_file_attachment_materialization_jobs job_row
              where job_row.tenant_id = attachment_row.tenant_id
                and job_row.attachment_id = attachment_row.id
                and job_row.file_id = new.file_id
           )
      ) into parent_valid;
    end if;

    if parent_valid and new.parent_kind in ('message', 'staff_note') then
      select exists (
        select 1
          from public.inbox_v2_timeline_content_payloads payload_row
         where payload_row.tenant_id = new.tenant_id
           and payload_row.content_id = new.content_id
           and payload_row.content_revision = new.content_revision
           and payload_row.block_key = new.block_key
           and (
             (new.parent_purpose = 'attachment'
               and payload_row.attachment_v2_file_id = new.file_id
               and payload_row.attachment_file_version_id = new.file_version_id
               and payload_row.attachment_object_version_id =
                 new.object_version_id)
             or (new.parent_purpose = 'extension_payload'
               and payload_row.extension_payload_v2_file_id = new.file_id
               and payload_row.extension_payload_file_version_id =
                 new.file_version_id
               and payload_row.extension_payload_object_version_id =
                 new.object_version_id)
           )
      ) into parent_valid;
    end if;

    if not parent_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_parent_invalid';
    end if;
  end if;

  select * into head_row
    from public.inbox_v2_file_parent_set_heads head
   where head.tenant_id = new.tenant_id
     and head.file_id = new.file_id;

  if head_row.completeness = 'complete' and (
    head_row.completeness_revision <> head_row.revision
    or head_row.live_parent_count <> (
      select count(*)
        from public.inbox_v2_file_parent_links link_row
        join public.inbox_v2_file_parent_link_heads link_head_row
          on link_head_row.tenant_id = link_row.tenant_id
         and link_head_row.link_id = link_row.id
         and link_head_row.file_id = link_row.file_id
       where link_row.tenant_id = new.tenant_id
         and link_row.file_id = new.file_id
         and link_head_row.state = 'live'
    )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_incomplete';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_link_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_link_head_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and (
    old.state <> 'live' or new.state <> 'detached'
    or new.tenant_id is distinct from old.tenant_id
    or new.link_id is distinct from old.link_id
    or new.file_id is distinct from old.file_id
    or new.revision <> old.revision + 1
    or new.detached_by_event_id is null
    or new.updated_at < old.updated_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_link_head_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_set_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_head_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.file_id is distinct from old.file_id
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_head_cas_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_derivative_cycle_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  cycle_exists boolean;
begin
  -- The advisory-lock recheck depends on READ COMMITTED taking a fresh
  -- statement snapshot after the previous lock owner commits. Fail closed
  -- before touching the graph when a caller pins an older transaction
  -- snapshot (for example REPEATABLE READ or SERIALIZABLE).
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25001',
      message = 'inbox_v2.file_derivative_isolation_unsafe';
  end if;

  -- Serialize only this tenant's derivative graph. The domain-separated,
  -- deterministic 64-bit key avoids cross-tenant contention while making a
  -- concurrent reciprocal/path-closing insert wait for the earlier commit.
  perform pg_catalog.pg_advisory_xact_lock(
    (
      'x' || pg_catalog.substr(
        pg_catalog.md5(
          'core:inbox-v2.file-derivative-graph:' || new.tenant_id
        ),
        1,
        16
      )
    )::bit(64)::bigint
  );

  -- VOLATILE PL/pgSQL executes this query with the post-lock READ COMMITTED
  -- snapshot, so an edge committed by the previous lock owner is rechecked.
  with recursive descendants(file_version_id) as (
    select new.derived_file_version_id
    union
    select edge.derived_file_version_id
      from public.inbox_v2_file_derivative_edges edge
      join descendants prior
        on prior.file_version_id = edge.original_file_version_id
     where edge.tenant_id = new.tenant_id
  )
  select exists (
    select 1 from descendants
     where file_version_id = new.original_file_version_id
  ) into cycle_exists;

  if cycle_exists then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_derivative_cycle';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_artifact_retry_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.result_state = 'retryable_failure' then
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode = '25001',
        message = 'inbox_v2.outbound_artifact_retry_isolation_unsafe';
    end if;

    -- Both sides of the invariant lock the same durable attempt row before
    -- their cross-table check. The post-lock READ COMMITTED statement then
    -- sees the winner and rejects the loser instead of allowing a write skew.
    perform 1
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = new.tenant_id
       and attempt_row.id = new.unknown_attempt_id
       and attempt_row.dispatch_id = new.dispatch_id
       and attempt_row.route_id = new.route_id
       and attempt_row.message_id = new.message_id
       for update;

    if exists (
      select 1
        from public.inbox_v2_outbound_dispatch_artifacts artifact_row
       where artifact_row.tenant_id = new.tenant_id
         and artifact_row.dispatch_id = new.dispatch_id
         and artifact_row.attempt_id = new.unknown_attempt_id
         and artifact_row.state = 'accepted'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_artifact_retry_unsafe';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_accepted_artifact_retry_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state = 'accepted' then
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode = '25001',
        message = 'inbox_v2.outbound_artifact_retry_isolation_unsafe';
    end if;

    perform 1
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = new.tenant_id
       and attempt_row.id = new.attempt_id
       and attempt_row.dispatch_id = new.dispatch_id
       and attempt_row.route_id = new.route_id
       and attempt_row.message_id = new.message_id
       for update;

    if exists (
      select 1
        from public.inbox_v2_outbound_dispatch_reconciliation_decisions
          decision_row
       where decision_row.tenant_id = new.tenant_id
         and decision_row.dispatch_id = new.dispatch_id
         and decision_row.unknown_attempt_id = new.attempt_id
         and decision_row.result_state = 'retryable_failure'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_artifact_retry_unsafe';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_attempt_mixed_outcome_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.outcome_kind = 'outcome_unknown'
     and new.diagnostic_code_id = 'core:provider-artifact-outcomes-mixed'
     and new.unknown_required_action is distinct from
       'operator_duplicate_risk_decision_required' then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_mixed_artifact_outcome_requires_operator';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_dispatch_plan_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  checked_tenant_id text;
  checked_plan_id text;
  plan_row public.inbox_v2_file_outbound_dispatch_plans%rowtype;
  dispatch_valid boolean;
  artifact_total integer;
  block_total integer;
  payload_total integer;
begin
  checked_tenant_id := new.tenant_id;
  checked_plan_id := coalesce(
    to_jsonb(new) ->> 'content_plan_id',
    to_jsonb(new) ->> 'id'
  );

  select * into plan_row
    from public.inbox_v2_file_outbound_dispatch_plans candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_plan_id;
  if not found then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_content_plan_missing';
  end if;

  select exists (
    select 1
      from public.inbox_v2_outbound_dispatches dispatch_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = dispatch_row.tenant_id
       and message_row.id = dispatch_row.message_id
       and message_row.conversation_id = dispatch_row.conversation_id
       and message_row.timeline_item_id = dispatch_row.timeline_item_id
      join public.inbox_v2_outbound_routes route_row
        on route_row.tenant_id = dispatch_row.tenant_id
       and route_row.id = dispatch_row.route_id
       and route_row.conversation_id = dispatch_row.conversation_id
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = message_row.tenant_id
       and content_row.id = message_row.content_id
       and content_row.revision = message_row.content_revision
     where dispatch_row.tenant_id = plan_row.tenant_id
       and dispatch_row.id = plan_row.dispatch_id
       and dispatch_row.message_id = plan_row.message_id
       and dispatch_row.conversation_id = plan_row.conversation_id
       and dispatch_row.timeline_item_id = plan_row.timeline_item_id
       and dispatch_row.route_id = plan_row.route_id
       and message_row.revision = plan_row.message_revision
       and message_row.content_id = plan_row.content_id
       and message_row.content_revision = plan_row.content_revision
       and content_row.state = 'available'
       and route_row.source_thread_binding_id = plan_row.binding_id
       and route_row.binding_revision = plan_row.binding_revision
       and route_row.capability_revision = plan_row.capability_revision
       and route_row.adapter_contract_id = plan_row.adapter_contract_id
       and route_row.adapter_contract_version = plan_row.adapter_contract_version
       and route_row.adapter_declaration_revision =
         plan_row.adapter_contract_declaration_revision
       and route_row.adapter_surface_id = plan_row.adapter_surface_id
       and route_row.adapter_loaded_by_trusted_service_id =
         plan_row.adapter_loaded_by_trusted_service_id
       and route_row.adapter_loaded_at = plan_row.adapter_loaded_at
       and route_row.selected_at <= plan_row.created_at
  ) into dispatch_valid;
  if not dispatch_valid then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_content_plan_invalid';
  end if;

  select count(*) into artifact_total
    from public.inbox_v2_file_outbound_artifact_plans artifact_row
   where artifact_row.tenant_id = plan_row.tenant_id
     and artifact_row.content_plan_id = plan_row.id;
  if artifact_total <> plan_row.artifact_count or not exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
    having min(artifact_row.ordinal) = 1
       and max(artifact_row.ordinal) = count(*)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_artifact_count_invalid';
  end if;

  select count(*) into block_total
    from public.inbox_v2_file_outbound_artifact_blocks block_row
   where block_row.tenant_id = plan_row.tenant_id
     and block_row.content_plan_id = plan_row.id;
  select count(*) into payload_total
    from public.inbox_v2_timeline_content_payloads payload_row
   where payload_row.tenant_id = plan_row.tenant_id
     and payload_row.content_id = plan_row.content_id
     and payload_row.content_revision = plan_row.content_revision;
  if block_total <> plan_row.block_count
     or payload_total <> plan_row.block_count then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_block_count_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
       and (artifact_row.created_at <> plan_row.created_at
         or artifact_row.block_mapping_count <> (
          select count(*)
           from public.inbox_v2_file_outbound_artifact_blocks block_row
          where block_row.tenant_id = artifact_row.tenant_id
            and block_row.content_plan_id = artifact_row.content_plan_id
             and block_row.artifact_plan_id = artifact_row.id
       ))
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_block_mapping_count_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_entries capability_row
          where capability_row.tenant_id = plan_row.tenant_id
            and capability_row.binding_id = plan_row.binding_id
            and capability_row.capability_revision =
              plan_row.capability_revision
            and capability_row.capability_id = artifact_row.capability_id
            and capability_row.operation_id = artifact_row.operation_id
            and capability_row.content_kind_id is not distinct from (
              select route_row.content_kind_id
                from public.inbox_v2_outbound_routes route_row
               where route_row.tenant_id = plan_row.tenant_id
                 and route_row.id = plan_row.route_id
            )
            and capability_row.state = 'supported'
            and (capability_row.valid_until is null
              or capability_row.valid_until > plan_row.created_at)
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_capability_required_roles required_role_row
               where required_role_row.tenant_id = capability_row.tenant_id
                 and required_role_row.binding_id = capability_row.binding_id
                 and required_role_row.materialized_by_binding_revision =
                   capability_row.materialized_by_binding_revision
                 and required_role_row.capability_revision =
                   capability_row.capability_revision
                 and required_role_row.capability_ordinal = capability_row.ordinal
                 and required_role_row.capability_id = capability_row.capability_id
                 and required_role_row.operation_id = capability_row.operation_id
                 and required_role_row.content_kind_key =
                   capability_row.content_kind_key
                 and not exists (
                   select 1
                     from public.inbox_v2_source_thread_binding_snapshots binding_snapshot_row
                     join public.inbox_v2_source_thread_binding_provider_roles provider_role_row
                       on provider_role_row.tenant_id =
                         binding_snapshot_row.tenant_id
                      and provider_role_row.binding_id =
                         binding_snapshot_row.binding_id
                      and provider_role_row.provider_access_revision =
                         binding_snapshot_row.provider_access_revision
                      and provider_role_row.provider_role_id =
                         required_role_row.provider_role_id
                    where binding_snapshot_row.tenant_id = plan_row.tenant_id
                      and binding_snapshot_row.binding_id = plan_row.binding_id
                      and binding_snapshot_row.revision =
                        plan_row.binding_revision
                 )
            )
       )
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_artifact_capability_invalid';
  end if;

  -- Freeze every mutable logical/object head used by an exact planned pin.
  -- The following validation statement runs after these row locks, so a
  -- concurrent quarantine/delete/head move either wins first and is observed
  -- or waits until this plan transaction commits.
  perform 1
    from public.inbox_v2_file_outbound_artifact_blocks block_row
    join public.inbox_v2_file_objects file_row
      on file_row.tenant_id = block_row.tenant_id
     and file_row.id = block_row.file_id
     and file_row.revision = block_row.file_revision
     and file_row.state = 'ready'
     and file_row.current_file_version_id = block_row.file_version_id
     and file_row.current_object_version_id = block_row.object_version_id
    join public.inbox_v2_file_versions version_row
      on version_row.tenant_id = block_row.tenant_id
     and version_row.id = block_row.file_version_id
     and version_row.file_id = block_row.file_id
     and version_row.object_version_id = block_row.object_version_id
    join public.inbox_v2_file_object_version_heads object_head_row
      on object_head_row.tenant_id = block_row.tenant_id
     and object_head_row.object_version_id = block_row.object_version_id
     and object_head_row.state = 'ready'
   where block_row.tenant_id = plan_row.tenant_id
     and block_row.content_plan_id = plan_row.id
     and block_row.file_id is not null
   order by block_row.file_id, block_row.file_version_id,
     block_row.object_version_id
   for share of file_row, object_head_row;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_blocks block_row
      left join public.inbox_v2_timeline_content_payloads payload_row
        on payload_row.tenant_id = plan_row.tenant_id
       and payload_row.content_id = plan_row.content_id
       and payload_row.content_revision = plan_row.content_revision
       and payload_row.ordinal = block_row.content_block_ordinal
       and payload_row.block_key = block_row.block_key
       and payload_row.kind::text = block_row.block_kind::text
     where block_row.tenant_id = plan_row.tenant_id
       and block_row.content_plan_id = plan_row.id
       and (
         payload_row.tenant_id is null
         or block_row.created_at <> plan_row.created_at
         or (
           block_row.block_kind in ('image', 'audio', 'video', 'file', 'sticker')
           and not (
             payload_row.attachment_state = 'ready'
             and payload_row.attachment_v2_file_id = block_row.file_id
             and payload_row.attachment_file_version_id = block_row.file_version_id
             and payload_row.attachment_object_version_id =
               block_row.object_version_id
           )
         )
         or (
           block_row.block_kind = 'extension'
           and not (
             payload_row.extension_payload_v2_file_id = block_row.file_id
             and payload_row.extension_payload_file_version_id =
               block_row.file_version_id
             and payload_row.extension_payload_object_version_id =
               block_row.object_version_id
           )
         )
         or (
           block_row.block_kind in ('text', 'location', 'contact')
           and num_nonnulls(
             block_row.file_id, block_row.file_revision,
             block_row.file_version_id, block_row.object_version_id
           ) <> 0
         )
         or (
           block_row.file_id is not null
           and not exists (
             select 1
               from public.inbox_v2_file_objects file_row
               join public.inbox_v2_file_versions version_row
                 on version_row.tenant_id = file_row.tenant_id
                and version_row.id = block_row.file_version_id
                and version_row.file_id = file_row.id
                and version_row.object_version_id =
                  block_row.object_version_id
               join public.inbox_v2_file_object_version_heads object_head_row
                 on object_head_row.tenant_id = file_row.tenant_id
                and object_head_row.object_version_id =
                  block_row.object_version_id
                and object_head_row.state = 'ready'
              where file_row.tenant_id = block_row.tenant_id
                and file_row.id = block_row.file_id
                and file_row.revision = block_row.file_revision
                and file_row.state = 'ready'
                and file_row.current_file_version_id = block_row.file_version_id
                and file_row.current_object_version_id =
                  block_row.object_version_id
           )
         )
       )
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_block_mapping_invalid';
  end if;
  return new;
end;
$function$;

drop trigger if exists inbox_v2_file_objects_guard_trigger
  on public.inbox_v2_file_objects;
create trigger inbox_v2_file_objects_guard_trigger
before insert or update or delete on public.inbox_v2_file_objects
for each row execute function public.inbox_v2_file_object_head_guard();

drop trigger if exists inbox_v2_file_object_version_heads_guard_trigger
  on public.inbox_v2_file_object_version_heads;
create trigger inbox_v2_file_object_version_heads_guard_trigger
before insert or update or delete on public.inbox_v2_file_object_version_heads
for each row execute function public.inbox_v2_file_object_version_head_guard();

drop trigger if exists inbox_v2_file_mat_jobs_guard_trigger
  on public.inbox_v2_file_attachment_materialization_jobs;
create trigger inbox_v2_file_mat_jobs_guard_trigger
before insert or update or delete
on public.inbox_v2_file_attachment_materialization_jobs
for each row execute function public.inbox_v2_file_materialization_job_guard();

drop trigger if exists inbox_v2_file_mat_jobs_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_jobs;
create constraint trigger inbox_v2_file_mat_jobs_coherence_trigger
after insert or update on public.inbox_v2_file_attachment_materialization_jobs
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_mat_attempts_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_attempts;
create constraint trigger inbox_v2_file_mat_attempts_coherence_trigger
after insert on public.inbox_v2_file_attachment_materialization_attempts
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_mat_evidence_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_evidence;
create constraint trigger inbox_v2_file_mat_evidence_coherence_trigger
after insert on public.inbox_v2_file_attachment_materialization_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_storage_orphans_guard_trigger
  on public.inbox_v2_file_storage_orphans;
create trigger inbox_v2_file_storage_orphans_guard_trigger
before update or delete on public.inbox_v2_file_storage_orphans
for each row execute function public.inbox_v2_file_storage_orphan_guard();

drop trigger if exists inbox_v2_file_parent_link_heads_guard_trigger
  on public.inbox_v2_file_parent_link_heads;
create trigger inbox_v2_file_parent_link_heads_guard_trigger
before update or delete on public.inbox_v2_file_parent_link_heads
for each row execute function public.inbox_v2_file_parent_link_head_guard();

drop trigger if exists inbox_v2_file_parent_set_heads_guard_trigger
  on public.inbox_v2_file_parent_set_heads;
create trigger inbox_v2_file_parent_set_heads_guard_trigger
before update or delete on public.inbox_v2_file_parent_set_heads
for each row execute function public.inbox_v2_file_parent_set_head_guard();

drop trigger if exists inbox_v2_file_parent_links_immutable_trigger
  on public.inbox_v2_file_parent_links;
create trigger inbox_v2_file_parent_links_immutable_trigger
before update or delete on public.inbox_v2_file_parent_links
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_parent_links_coherence_trigger
  on public.inbox_v2_file_parent_links;
create constraint trigger inbox_v2_file_parent_links_coherence_trigger
after insert on public.inbox_v2_file_parent_links
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_parent_link_heads_coherence_trigger
  on public.inbox_v2_file_parent_link_heads;
create constraint trigger inbox_v2_file_parent_link_heads_coherence_trigger
after insert or update on public.inbox_v2_file_parent_link_heads
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_parent_heads_coherence_trigger
  on public.inbox_v2_file_parent_set_heads;
create constraint trigger inbox_v2_file_parent_heads_coherence_trigger
after insert or update on public.inbox_v2_file_parent_set_heads
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_derivative_edges_cycle_trigger
  on public.inbox_v2_file_derivative_edges;
create trigger inbox_v2_file_derivative_edges_cycle_trigger
before insert on public.inbox_v2_file_derivative_edges
for each row execute function public.inbox_v2_file_derivative_cycle_guard();

drop trigger if exists inbox_v2_outbound_artifact_retry_guard_trigger
  on public.inbox_v2_outbound_dispatch_reconciliation_decisions;
create trigger inbox_v2_outbound_artifact_retry_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_reconciliation_decisions
for each row execute function public.inbox_v2_outbound_artifact_retry_guard();

drop trigger if exists inbox_v2_outbound_accepted_artifact_retry_guard_trigger
  on public.inbox_v2_outbound_dispatch_artifacts;
create trigger inbox_v2_outbound_accepted_artifact_retry_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_artifacts
for each row execute function public.inbox_v2_outbound_accepted_artifact_retry_guard();

drop trigger if exists inbox_v2_outbound_attempt_mixed_outcome_guard_trigger
  on public.inbox_v2_outbound_dispatch_attempts;
create trigger inbox_v2_outbound_attempt_mixed_outcome_guard_trigger
before insert or update on public.inbox_v2_outbound_dispatch_attempts
for each row execute function public.inbox_v2_outbound_attempt_mixed_outcome_guard();

drop trigger if exists inbox_v2_file_dispatch_plans_coherence_trigger
  on public.inbox_v2_file_outbound_dispatch_plans;
create constraint trigger inbox_v2_file_dispatch_plans_coherence_trigger
after insert on public.inbox_v2_file_outbound_dispatch_plans
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_artifact_plans_coherence_trigger
  on public.inbox_v2_file_outbound_artifact_plans;
create constraint trigger inbox_v2_file_artifact_plans_coherence_trigger
after insert on public.inbox_v2_file_outbound_artifact_plans
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_artifact_blocks_coherence_trigger
  on public.inbox_v2_file_outbound_artifact_blocks;
create constraint trigger inbox_v2_file_artifact_blocks_coherence_trigger
after insert on public.inbox_v2_file_outbound_artifact_blocks
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_object_versions_immutable_trigger
  on public.inbox_v2_file_object_versions;
create trigger inbox_v2_file_object_versions_immutable_trigger
before update or delete on public.inbox_v2_file_object_versions
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_versions_immutable_trigger
  on public.inbox_v2_file_versions;
create trigger inbox_v2_file_versions_immutable_trigger
before update or delete on public.inbox_v2_file_versions
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_mat_attempts_immutable_trigger
  on public.inbox_v2_file_attachment_materialization_attempts;
create trigger inbox_v2_file_mat_attempts_immutable_trigger
before update or delete on public.inbox_v2_file_attachment_materialization_attempts
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_mat_evidence_immutable_trigger
  on public.inbox_v2_file_attachment_materialization_evidence;
create trigger inbox_v2_file_mat_evidence_immutable_trigger
before update or delete on public.inbox_v2_file_attachment_materialization_evidence
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_operation_evidence_immutable_trigger
  on public.inbox_v2_file_object_operation_evidence;
create trigger inbox_v2_file_operation_evidence_immutable_trigger
before update or delete on public.inbox_v2_file_object_operation_evidence
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_derivative_edges_immutable_trigger
  on public.inbox_v2_file_derivative_edges;
create trigger inbox_v2_file_derivative_edges_immutable_trigger
before update or delete on public.inbox_v2_file_derivative_edges
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_dispatch_plans_immutable_trigger
  on public.inbox_v2_file_outbound_dispatch_plans;
create trigger inbox_v2_file_dispatch_plans_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_dispatch_plans
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_artifact_plans_immutable_trigger
  on public.inbox_v2_file_outbound_artifact_plans;
create trigger inbox_v2_file_artifact_plans_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_artifact_plans
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_artifact_blocks_immutable_trigger
  on public.inbox_v2_file_outbound_artifact_blocks;
create trigger inbox_v2_file_artifact_blocks_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_artifact_blocks
for each row execute function public.inbox_v2_file_immutable_guard();
`;
