import { sql, type SQLWrapper } from "drizzle-orm";
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
  text,
  timestamp,
  unique,
  uniqueIndex
} from "drizzle-orm/pg-core";

import { inboxV2SourceExternalIdentities } from "./identity-foundation";
import {
  accounts,
  clientContacts,
  employees,
  moduleCatalog,
  tenants
} from "../tables";

type CanonicalSnapshot = Readonly<Record<string, unknown>>;

function digestSql(value: SQLWrapper) {
  return sql`${value} ~ '^sha256:[0-9a-f]{64}$'`;
}

export const inboxV2DataGovernanceDeploymentProfile = pgEnum(
  "inbox_v2_data_governance_deployment_profile",
  ["saas_shared", "saas_isolated", "on_prem"]
);

export const inboxV2DataGovernanceStorageRootKind = pgEnum(
  "inbox_v2_data_governance_storage_root_kind",
  [
    "sql",
    "json_blob",
    "object",
    "index_cache",
    "log_trace",
    "backup",
    "external_route"
  ]
);

export const inboxV2DataGovernanceRootBoundary = pgEnum(
  "inbox_v2_data_governance_root_boundary",
  ["operated_data_plane", "outside_operated_data_plane"]
);

export const inboxV2DataGovernanceVersionEnumeration = pgEnum(
  "inbox_v2_data_governance_version_enumeration",
  ["not_applicable", "supported", "expiry_ledger"]
);

export const inboxV2DataGovernanceLifecycleHandlerKind = pgEnum(
  "inbox_v2_data_governance_handler_kind",
  [
    "anchor_resolution",
    "condition_resolution",
    "scope_matcher",
    "lifecycle",
    "subject_discovery",
    "export_projection",
    "export_execution",
    "delete_execution",
    "verification",
    "backup_expiry_ledger",
    "external_deletion",
    "migration_uninstall"
  ]
);

export const inboxV2DataGovernancePolicyActivationKind = pgEnum(
  "inbox_v2_data_governance_policy_activation_kind",
  ["initial_reviewed_bootstrap", "supersede_current"]
);

export const inboxV2DataGovernanceApprovalPrincipalKind = pgEnum(
  "inbox_v2_data_governance_approval_principal_kind",
  ["employee", "account", "service", "module"]
);

export const inboxV2DataGovernanceCopyRole = pgEnum(
  "inbox_v2_data_governance_copy_role",
  ["primary", "derived", "backup", "external"]
);

export const inboxV2DataGovernanceSubjectKind = pgEnum(
  "inbox_v2_data_governance_subject_kind",
  [
    "employee",
    "client_contact",
    "source_external_identity",
    "account",
    "unresolved_provider_subject"
  ]
);

export const inboxV2DataGovernanceSubjectLinkRole = pgEnum(
  "inbox_v2_data_governance_subject_link_role",
  [
    "author",
    "participant",
    "contact",
    "caller",
    "recording_speaker",
    "mentioned_person",
    "crm_subject",
    "owner",
    "security_actor"
  ]
);

export const inboxV2DataGovernanceSubjectProvenance = pgEnum(
  "inbox_v2_data_governance_subject_provenance",
  [
    "canonical_relation",
    "source_observation",
    "reviewed_candidate",
    "migration"
  ]
);

export const inboxV2DataGovernanceControlState = pgEnum(
  "inbox_v2_data_governance_control_state",
  ["active", "released"]
);

export const inboxV2DataGovernanceControlReferenceKind = pgEnum(
  "inbox_v2_data_governance_control_reference_kind",
  ["legal_hold", "restriction"]
);

export const inboxV2DataGovernanceScopeKind = pgEnum(
  "inbox_v2_data_governance_scope_kind",
  ["exact", "prospective", "tenant_wide"]
);

export const inboxV2DataGovernancePrivacyRequestState = pgEnum(
  "inbox_v2_data_governance_privacy_request_state",
  [
    "received",
    "identity_verification",
    "scope_discovery",
    "policy_and_exception_review",
    "approved",
    "partially_approved",
    "rejected",
    "blocked_by_legal_hold",
    "executing",
    "verification_pending",
    "completed",
    "completed_with_external_residuals",
    "primary_purged_backup_expiry_pending",
    "verification_blocked_internal_residual",
    "failed_retryable"
  ]
);

export const inboxV2DataGovernancePrivacyRequestIntent = pgEnum(
  "inbox_v2_data_governance_privacy_request_intent",
  [
    "access",
    "portability",
    "erasure",
    "restriction",
    "correction",
    "objection",
    "tenant_termination_export_delete",
    "administrative_retention_purge"
  ]
);

export const inboxV2DataGovernanceExportJobState = pgEnum(
  "inbox_v2_data_governance_export_job_state",
  [
    "queued",
    "running",
    "ready",
    "revoked",
    "expired",
    "failed_retryable",
    "completed"
  ]
);

export const inboxV2DataGovernanceExportProductKind = pgEnum(
  "inbox_v2_data_governance_export_product_kind",
  ["tenant_deployment", "manager_report", "data_subject"]
);

export const inboxV2DataGovernanceExportArtifactState = pgEnum(
  "inbox_v2_data_governance_export_artifact_state",
  ["building", "ready", "quarantined", "deleted"]
);

export const inboxV2DataGovernanceExportReceiptState = pgEnum(
  "inbox_v2_data_governance_export_receipt_state",
  ["issued", "consumed", "revoked", "expired"]
);

export const inboxV2DataGovernanceDeletionRunState = pgEnum(
  "inbox_v2_data_governance_deletion_run_state",
  ["executing", "verification_pending", "terminal"]
);

export const inboxV2DataGovernanceDeletionCause = pgEnum(
  "inbox_v2_data_governance_deletion_cause",
  [
    "provider_message_delete",
    "employee_ui_delete",
    "retention_expiry",
    "privacy_erasure",
    "tenant_offboarding",
    "administrative_policy_purge"
  ]
);

export const inboxV2DataGovernanceDecisionBasisKind = pgEnum(
  "inbox_v2_data_governance_decision_basis_kind",
  [
    "lifecycle_policy",
    "privacy_request",
    "provider_lifecycle_event",
    "employee_content_action"
  ]
);

export const inboxV2DataGovernanceDeletionStageOneState = pgEnum(
  "inbox_v2_data_governance_deletion_stage_one_state",
  ["pending", "content_unavailable"]
);

export const inboxV2DataGovernanceCheckpointSurface = pgEnum(
  "inbox_v2_data_governance_checkpoint_surface",
  ["operated", "backup", "external"]
);

export const inboxV2DataGovernanceCheckpointLeaseState = pgEnum(
  "inbox_v2_data_governance_checkpoint_lease_state",
  ["claimed", "completed", "released", "expired"]
);

export const inboxV2DataGovernanceDeletionResult = pgEnum(
  "inbox_v2_data_governance_deletion_result",
  [
    "completed",
    "completed_with_external_residuals",
    "primary_purged_backup_expiry_pending",
    "verification_blocked_internal_residual",
    "failed_retryable"
  ]
);

export const inboxV2DataGovernanceOperatedOutcome = pgEnum(
  "inbox_v2_data_governance_operated_outcome",
  [
    "verified_absent",
    "failed_retryable",
    "unverified_terminal",
    "blocked_by_legal_hold",
    "stale_revision"
  ]
);

export const inboxV2DataGovernanceBackupOutcome = pgEnum(
  "inbox_v2_data_governance_backup_outcome",
  [
    "finite_expiry_pending",
    "expiry_verified",
    "failed_retryable",
    "unverified_terminal",
    "blocked_by_legal_hold",
    "stale_revision"
  ]
);

export const inboxV2DataGovernanceExternalOutcome = pgEnum(
  "inbox_v2_data_governance_external_outcome",
  [
    "requested",
    "confirmed",
    "unsupported",
    "unknown",
    "failed_retryable",
    "blocked_by_legal_hold",
    "stale_revision"
  ]
);

export const inboxV2DataGovernanceLedgerKind = pgEnum(
  "inbox_v2_data_governance_ledger_kind",
  [
    "erasure_applied",
    "hold_applied",
    "restriction_applied",
    "hold_released",
    "restriction_released",
    "restore_opened",
    "control_reapplied",
    "restore_sealed"
  ]
);

export const inboxV2DataGovernanceLedgerEvidenceKind = pgEnum(
  "inbox_v2_data_governance_ledger_evidence_kind",
  ["digest", "payload_reference"]
);

export const inboxV2DataGovernanceLedgerEvidenceSlot = pgEnum(
  "inbox_v2_data_governance_ledger_evidence_slot",
  ["primary_absence", "backup_expiry", "control_application", "restore"]
);

export const inboxV2DataGovernanceLedgerControlSetRole = pgEnum(
  "inbox_v2_data_governance_ledger_control_set_role",
  ["required", "reapplied"]
);

export const inboxV2DataGovernanceBackupExpiryState = pgEnum(
  "inbox_v2_data_governance_backup_expiry_state",
  ["not_applicable", "finite_expiry_pending", "verified_expired"]
);

export const inboxV2DataGovernanceRestoreHeadState = pgEnum(
  "inbox_v2_data_governance_restore_head_state",
  ["open", "sealed"]
);

export const inboxV2DataGovernanceRestoreLeaseState = pgEnum(
  "inbox_v2_data_governance_restore_lease_state",
  ["active", "completed", "released", "expired"]
);

/** Immutable deployment-local registry composition. It never contains tenant data. */
export const inboxV2DataGovernanceRegistryVersions = pgTable(
  "inbox_v2_data_governance_registry_versions",
  {
    id: text("id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    schemaVersion: text("schema_version").notNull(),
    compositionHash: text("composition_hash").notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    activatedAt: timestamp("activated_at", {
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
      name: "inbox_v2_dg_registry_versions_pk",
      columns: [table.id, table.revision]
    }),
    unique("inbox_v2_dg_registry_hash_unique").on(table.compositionHash),
    check(
      "inbox_v2_dg_registry_values_check",
      sql`${table.revision} >= 1 and ${digestSql(table.compositionHash)}`
    ),
    check(
      "inbox_v2_dg_registry_time_check",
      sql`isfinite(${table.activatedAt}) and isfinite(${table.createdAt}) and ${table.createdAt} <= ${table.activatedAt}`
    ),
    index("inbox_v2_dg_registry_active_idx").on(
      table.activatedAt.desc(),
      table.id
    )
  ]
);

export const inboxV2DataGovernanceStorageRoots = pgTable(
  "inbox_v2_data_governance_storage_roots",
  {
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    kind: inboxV2DataGovernanceStorageRootKind("kind").notNull(),
    boundary: inboxV2DataGovernanceRootBoundary("boundary").notNull(),
    versionEnumeration: inboxV2DataGovernanceVersionEnumeration(
      "version_enumeration"
    ).notNull(),
    configurationProfileId: text("configuration_profile_id").notNull(),
    ownerModuleId: text("owner_module_id"),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_storage_roots_pk",
      columns: [table.registryId, table.registryRevision, table.storageRootId]
    }),
    foreignKey({
      name: "inbox_v2_dg_storage_roots_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_storage_roots_module_fk",
      columns: [table.ownerModuleId],
      foreignColumns: [moduleCatalog.id]
    }),
    check(
      "inbox_v2_dg_storage_roots_shape_check",
      sql`(
          ${table.kind} = 'external_route'
          and ${table.boundary} = 'outside_operated_data_plane'
        ) or (
          ${table.kind} <> 'external_route'
          and ${table.boundary} = 'operated_data_plane'
        )`
    ),
    check(
      "inbox_v2_dg_storage_roots_versions_check",
      sql`(${table.kind} = 'object' and ${table.versionEnumeration} = 'supported')
        or (${table.kind} = 'backup' and ${table.versionEnumeration} = 'expiry_ledger')
        or (${table.kind} not in ('object', 'backup') and ${table.versionEnumeration} in ('not_applicable', 'supported'))`
    ),
    index("inbox_v2_dg_storage_roots_kind_idx").on(
      table.registryId,
      table.registryRevision,
      table.kind,
      table.storageRootId
    )
  ]
);

export const inboxV2DataGovernanceLifecycleHandlers = pgTable(
  "inbox_v2_data_governance_lifecycle_handlers",
  {
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    handlerId: text("handler_id").notNull(),
    kind: inboxV2DataGovernanceLifecycleHandlerKind("kind").notNull(),
    ownerModuleId: text("owner_module_id"),
    handlerVersion: bigint("handler_version", { mode: "bigint" }).notNull(),
    bounded: boolean("bounded").notNull(),
    idempotent: boolean("idempotent").notNull(),
    checksTenantFence: boolean("checks_tenant_fence").notNull(),
    checksRevisionFence: boolean("checks_revision_fence").notNull(),
    checksHoldFence: boolean("checks_hold_fence").notNull(),
    verifiesAbsence: boolean("verifies_absence").notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_handlers_pk",
      columns: [table.registryId, table.registryRevision, table.handlerId]
    }),
    foreignKey({
      name: "inbox_v2_dg_handlers_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_handlers_module_fk",
      columns: [table.ownerModuleId],
      foreignColumns: [moduleCatalog.id]
    }),
    check(
      "inbox_v2_dg_handlers_values_check",
      sql`${table.handlerVersion} >= 1 and ${table.bounded} and ${table.idempotent} and ${table.checksTenantFence} and ${table.checksRevisionFence}`
    ),
    check(
      "inbox_v2_dg_handlers_verify_check",
      sql`${table.kind} <> 'verification' or ${table.verifiesAbsence}`
    ),
    index("inbox_v2_dg_handlers_kind_idx").on(
      table.registryId,
      table.registryRevision,
      table.kind,
      table.handlerId
    )
  ]
);

/** One exact class/root lineage; missing root or handler cannot be persisted. */
export const inboxV2DataGovernanceDataUseLineages = pgTable(
  "inbox_v2_data_governance_data_use_lineages",
  {
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    purposeId: text("purpose_id").notNull(),
    canonicalAnchorId: text("canonical_anchor_id").notNull(),
    ownerModuleId: text("owner_module_id"),
    lineageRevision: bigint("lineage_revision", { mode: "bigint" }).notNull(),
    lifecycleHandlerId: text("lifecycle_handler_id").notNull(),
    subjectDiscoveryHandlerId: text("subject_discovery_handler_id"),
    exportProjectionHandlerId: text("export_projection_handler_id"),
    exportHandlerId: text("export_handler_id"),
    deleteHandlerId: text("delete_handler_id"),
    verificationHandlerId: text("verification_handler_id"),
    expiryLedgerHandlerId: text("expiry_ledger_handler_id"),
    externalDeleteHandlerId: text("external_delete_handler_id"),
    operationsMask: bigint("operations_mask", { mode: "number" }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_data_use_lineages_pk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.dataClassId,
        table.storageRootId,
        table.purposeId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_module_fk",
      columns: [table.ownerModuleId],
      foreignColumns: [moduleCatalog.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_lifecycle_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.lifecycleHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_discovery_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.subjectDiscoveryHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_projection_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.exportProjectionHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_export_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.exportHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_delete_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.deleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_verify_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.verificationHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_expiry_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.expiryLedgerHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_lineages_external_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.externalDeleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_lineages_values_check",
      sql`${table.lineageRevision} >= 1 and ${table.operationsMask} between 1 and 127`
    ),
    index("inbox_v2_dg_lineages_class_idx").on(
      table.registryId,
      table.registryRevision,
      table.dataClassId,
      table.storageRootId
    )
  ]
);

/** Global reviewed template. The absence of tenant_id is an intentional boundary. */
export const inboxV2DataGovernancePolicyTemplates = pgTable(
  "inbox_v2_data_governance_policy_templates",
  {
    templateId: text("template_id").notNull(),
    templateRevision: bigint("template_revision", { mode: "bigint" }).notNull(),
    templateHash: text("template_hash").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    deploymentProfile:
      inboxV2DataGovernanceDeploymentProfile("deployment_profile").notNull(),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    reviewAt: timestamp("review_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_policy_templates_pk",
      columns: [table.templateId, table.templateRevision]
    }),
    foreignKey({
      name: "inbox_v2_dg_templates_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    check(
      "inbox_v2_dg_templates_values_check",
      sql`${table.templateRevision} >= 1 and ${digestSql(table.templateHash)} and isfinite(${table.effectiveAt}) and isfinite(${table.reviewAt}) and ${table.reviewAt} > ${table.effectiveAt}`
    ),
    index("inbox_v2_dg_templates_profile_idx").on(
      table.deploymentProfile,
      table.effectiveAt.desc(),
      table.templateId
    )
  ]
);

export const inboxV2DataGovernancePolicyTemplateRules = pgTable(
  "inbox_v2_data_governance_policy_template_rules",
  {
    templateId: text("template_id").notNull(),
    templateRevision: bigint("template_revision", { mode: "bigint" }).notNull(),
    ruleId: text("rule_id").notNull(),
    ruleRevision: bigint("rule_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    purposeId: text("purpose_id").notNull(),
    retentionAnchorId: text("retention_anchor_id").notNull(),
    actionAtExpiry: text("action_at_expiry").notNull(),
    holdEligible: boolean("hold_eligible").notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_template_rules_pk",
      columns: [
        table.templateId,
        table.templateRevision,
        table.ruleId,
        table.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_template_rules_template_fk",
      columns: [table.templateId, table.templateRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyTemplates.templateId,
        inboxV2DataGovernancePolicyTemplates.templateRevision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_template_rules_values_check",
      sql`${table.templateRevision} >= 1 and ${table.ruleRevision} >= 1`
    ),
    uniqueIndex("inbox_v2_dg_template_rules_class_unique").on(
      table.templateId,
      table.templateRevision,
      table.dataClassId,
      table.purposeId
    ),
    index("inbox_v2_dg_template_rules_lookup_idx").on(
      table.dataClassId,
      table.purposeId,
      table.templateId
    )
  ]
);

export const inboxV2DataGovernanceContexts = pgTable(
  "inbox_v2_data_governance_contexts",
  {
    tenantId: text("tenant_id").notNull(),
    contextId: text("context_id").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    contextHash: text("context_hash").notNull(),
    policyRevision: bigint("policy_revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    deploymentProfile:
      inboxV2DataGovernanceDeploymentProfile("deployment_profile").notNull(),
    timeZone: text("time_zone").notNull(),
    tzdbVersion: text("tzdb_version").notNull(),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    reviewAt: timestamp("review_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_contexts_pk",
      columns: [table.tenantId, table.contextId, table.version]
    }),
    foreignKey({
      name: "inbox_v2_dg_contexts_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_contexts_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    check(
      "inbox_v2_dg_contexts_values_check",
      sql`${table.version} >= 1 and ${table.policyRevision} >= 1 and ${digestSql(table.contextHash)}`
    ),
    check(
      "inbox_v2_dg_contexts_time_check",
      sql`isfinite(${table.approvedAt}) and isfinite(${table.effectiveAt}) and isfinite(${table.reviewAt}) and ${table.approvedAt} <= ${table.effectiveAt} and ${table.reviewAt} > ${table.effectiveAt}`
    ),
    index("inbox_v2_dg_contexts_tenant_idx").on(
      table.tenantId,
      table.contextId,
      table.version.desc()
    )
  ]
);

export const inboxV2DataGovernanceContextPurposeRoles = pgTable(
  "inbox_v2_data_governance_context_purpose_roles",
  {
    tenantId: text("tenant_id").notNull(),
    contextId: text("context_id").notNull(),
    contextVersion: bigint("context_version", { mode: "bigint" }).notNull(),
    purposeId: text("purpose_id").notNull(),
    regimeId: text("regime_id").notNull(),
    roleId: text("role_id").notNull(),
    lawfulBasisReferenceCode: text("lawful_basis_reference_code").notNull(),
    customerInstructionReferenceCode: text(
      "customer_instruction_reference_code"
    )
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_context_roles_pk",
      columns: [
        table.tenantId,
        table.contextId,
        table.contextVersion,
        table.purposeId,
        table.regimeId,
        table.roleId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_context_roles_context_fk",
      columns: [table.tenantId, table.contextId, table.contextVersion],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }).onDelete("cascade"),
    index("inbox_v2_dg_context_roles_tenant_idx").on(
      table.tenantId,
      table.purposeId,
      table.contextId
    )
  ]
);

export const inboxV2DataGovernanceEffectivePolicies = pgTable(
  "inbox_v2_data_governance_effective_policies",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    version: bigint("version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    deploymentProfile:
      inboxV2DataGovernanceDeploymentProfile("deployment_profile").notNull(),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_effective_policies_pk",
      columns: [table.tenantId, table.policyId, table.version]
    }),
    foreignKey({
      name: "inbox_v2_dg_effective_policy_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_effective_policy_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_effective_policy_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    check(
      "inbox_v2_dg_effective_policy_values_check",
      sql`${table.version} >= 1 and ${digestSql(table.policyHash)} and isfinite(${table.effectiveAt}) and isfinite(${table.createdAt}) and ${table.createdAt} <= ${table.effectiveAt}`
    ),
    index("inbox_v2_dg_effective_policy_tenant_idx").on(
      table.tenantId,
      table.policyId,
      table.version.desc()
    )
  ]
);

export const inboxV2DataGovernanceEffectivePolicyRules = pgTable(
  "inbox_v2_data_governance_effective_policy_rules",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    ruleId: text("rule_id").notNull(),
    ruleRevision: bigint("rule_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    purposeId: text("purpose_id").notNull(),
    retentionAnchorId: text("retention_anchor_id").notNull(),
    actionAtExpiry: text("action_at_expiry").notNull(),
    holdEligible: boolean("hold_eligible").notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_effective_policy_rules_pk",
      columns: [
        table.tenantId,
        table.policyId,
        table.policyVersion,
        table.ruleId,
        table.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_effective_rule_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_effective_rule_values_check",
      sql`${table.policyVersion} >= 1 and ${table.ruleRevision} >= 1`
    ),
    uniqueIndex("inbox_v2_dg_effective_rule_class_unique").on(
      table.tenantId,
      table.policyId,
      table.policyVersion,
      table.dataClassId,
      table.purposeId
    ),
    index("inbox_v2_dg_effective_rule_tenant_idx").on(
      table.tenantId,
      table.dataClassId,
      table.purposeId,
      table.policyId
    )
  ]
);

/** Immutable reviewed activation record. Current authority lives only in its CAS head. */
export const inboxV2DataGovernancePolicyActivations = pgTable(
  "inbox_v2_data_governance_policy_activations",
  {
    tenantId: text("tenant_id").notNull(),
    activationId: text("activation_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    activationHash: text("activation_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    candidatePolicyHash: text("candidate_policy_hash").notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    transitionKind:
      inboxV2DataGovernancePolicyActivationKind("transition_kind").notNull(),
    priorActivationId: text("prior_activation_id"),
    priorActivationRevision: bigint("prior_activation_revision", {
      mode: "bigint"
    }),
    priorPolicyVersion: bigint("prior_policy_version", { mode: "bigint" }),
    requesterPrincipalKind: inboxV2DataGovernanceApprovalPrincipalKind(
      "requester_principal_kind"
    ).notNull(),
    requesterPrincipalKey: text("requester_principal_key").notNull(),
    requesterDecisionId: text("requester_decision_id").notNull(),
    requesterDecisionHash: text("requester_decision_hash").notNull(),
    approverPrincipalKind: inboxV2DataGovernanceApprovalPrincipalKind(
      "approver_principal_kind"
    ).notNull(),
    approverPrincipalKey: text("approver_principal_key").notNull(),
    approverDecisionId: text("approver_decision_id").notNull(),
    approverDecisionHash: text("approver_decision_hash").notNull(),
    reasonCode: text("reason_code").notNull(),
    impactPreviewHash: text("impact_preview_hash").notNull(),
    impactStreamEpoch: text("impact_stream_epoch").notNull(),
    impactSyncGeneration: bigint("impact_sync_generation", {
      mode: "bigint"
    }).notNull(),
    impactCompleteThroughPosition: bigint("impact_complete_through_position", {
      mode: "bigint"
    }).notNull(),
    affectedRootCount: bigint("affected_root_count", {
      mode: "bigint"
    }).notNull(),
    affectedByteCount: bigint("affected_byte_count", {
      mode: "bigint"
    }).notNull(),
    heldRootCount: bigint("held_root_count", { mode: "bigint" }).notNull(),
    backupCopyCount: bigint("backup_copy_count", { mode: "bigint" }).notNull(),
    earliestDestructiveAt: timestamp("earliest_destructive_at", {
      withTimezone: true,
      precision: 3
    }),
    requestedAt: timestamp("requested_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    approvedAt: timestamp("approved_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    notBefore: timestamp("not_before", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    activatedAt: timestamp("activated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_policy_activations_pk",
      columns: [table.tenantId, table.activationId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_activation_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_activation_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    check(
      "inbox_v2_dg_activation_values_check",
      sql`${table.revision} >= 1 and ${table.policyVersion} >= 1 and ${table.governanceContextVersion} >= 1 and ${digestSql(table.activationHash)} and ${digestSql(table.candidatePolicyHash)} and ${digestSql(table.governanceContextHash)} and ${digestSql(table.requesterDecisionHash)} and ${digestSql(table.approverDecisionHash)} and ${digestSql(table.impactPreviewHash)} and ${table.impactSyncGeneration} >= 1 and ${table.impactCompleteThroughPosition} >= 0 and ${table.affectedRootCount} >= 0 and ${table.affectedByteCount} >= 0 and ${table.heldRootCount} >= 0 and ${table.backupCopyCount} >= 0`
    ),
    check(
      "inbox_v2_dg_activation_separation_check",
      sql`(${table.requesterPrincipalKind}, ${table.requesterPrincipalKey}) <> (${table.approverPrincipalKind}, ${table.approverPrincipalKey})`
    ),
    check(
      "inbox_v2_dg_activation_transition_check",
      sql`(
        ${table.transitionKind} = 'initial_reviewed_bootstrap'
        and ${table.priorActivationId} is null
        and ${table.priorActivationRevision} is null
        and ${table.priorPolicyVersion} is null
      ) or (
        ${table.transitionKind} = 'supersede_current'
        and ${table.priorActivationId} is not null
        and ${table.priorActivationRevision} >= 1
        and ${table.priorPolicyVersion} >= 1
      )`
    ),
    check(
      "inbox_v2_dg_activation_time_check",
      sql`isfinite(${table.requestedAt}) and isfinite(${table.approvedAt}) and isfinite(${table.notBefore}) and isfinite(${table.activatedAt}) and ${table.approvedAt} > ${table.requestedAt} and ${table.notBefore} > ${table.approvedAt} and ${table.activatedAt} >= ${table.notBefore}`
    ),
    index("inbox_v2_dg_activation_tenant_idx").on(
      table.tenantId,
      table.policyId,
      table.activatedAt.desc(),
      table.activationId
    )
  ]
);

export const inboxV2DataGovernancePolicyActivationHeads = pgTable(
  "inbox_v2_data_governance_policy_activation_heads",
  {
    tenantId: text("tenant_id").notNull(),
    policyId: text("policy_id").notNull(),
    currentPolicyVersion: bigint("current_policy_version", {
      mode: "bigint"
    }).notNull(),
    currentActivationId: text("current_activation_id").notNull(),
    currentActivationRevision: bigint("current_activation_revision", {
      mode: "bigint"
    }).notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_policy_activation_heads_pk",
      columns: [table.tenantId, table.policyId]
    }),
    foreignKey({
      name: "inbox_v2_dg_activation_head_policy_fk",
      columns: [table.tenantId, table.policyId, table.currentPolicyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_activation_head_activation_fk",
      columns: [
        table.tenantId,
        table.currentActivationId,
        table.currentActivationRevision
      ],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    check(
      "inbox_v2_dg_activation_head_values_check",
      sql`${table.currentPolicyVersion} >= 1 and ${table.currentActivationRevision} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_activation_head_tenant_idx").on(
      table.tenantId,
      table.headRevision,
      table.policyId
    )
  ]
);

export const inboxV2DataGovernanceLifecyclePurposeSets = pgTable(
  "inbox_v2_data_governance_lifecycle_purpose_sets",
  {
    tenantId: text("tenant_id").notNull(),
    purposeSetId: text("purpose_set_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    entityRevision: bigint("entity_revision", { mode: "bigint" }).notNull(),
    lineageRevision: bigint("lineage_revision", { mode: "bigint" }).notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    syncGeneration: bigint("sync_generation", { mode: "bigint" }).notNull(),
    completeThroughPosition: bigint("complete_through_position", {
      mode: "bigint"
    }).notNull(),
    purposeSetRevision: bigint("purpose_set_revision", {
      mode: "bigint"
    }).notNull(),
    sourceStateHash: text("source_state_hash").notNull(),
    capturedAt: timestamp("captured_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_purpose_sets_pk",
      columns: [table.tenantId, table.purposeSetId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_purpose_set_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_purpose_set_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_purpose_set_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    check(
      "inbox_v2_dg_purpose_set_values_check",
      sql`${table.revision} >= 1 and ${table.policyVersion} >= 1 and ${table.entityRevision} >= 1 and ${table.lineageRevision} >= 1 and ${table.syncGeneration} >= 1 and ${table.completeThroughPosition} >= 0 and ${table.purposeSetRevision} >= 1 and ${digestSql(table.sourceStateHash)} and isfinite(${table.capturedAt})`
    ),
    index("inbox_v2_dg_purpose_set_target_idx").on(
      table.tenantId,
      table.storageRootId,
      table.rootRecordId,
      table.revision.desc()
    )
  ]
);

export const inboxV2DataGovernanceLifecyclePurposeInstances = pgTable(
  "inbox_v2_data_governance_lifecycle_purpose_instances",
  {
    tenantId: text("tenant_id").notNull(),
    purposeSetId: text("purpose_set_id").notNull(),
    purposeSetRevision: bigint("purpose_set_revision", {
      mode: "bigint"
    }).notNull(),
    purposeId: text("purpose_id").notNull(),
    ruleId: text("rule_id").notNull(),
    ruleRevision: bigint("rule_revision", { mode: "bigint" }).notNull(),
    anchorAt: timestamp("anchor_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    conditionState: text("condition_state"),
    conditionId: text("condition_id"),
    conditionVersion: bigint("condition_version", { mode: "bigint" }),
    conditionResolverHandlerId: text("condition_resolver_handler_id"),
    conditionEvidenceHash: text("condition_evidence_hash"),
    parentDeadlineSnapshotHash: text("parent_deadline_snapshot_hash"),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_purpose_instances_pk",
      columns: [
        table.tenantId,
        table.purposeSetId,
        table.purposeSetRevision,
        table.purposeId,
        table.ruleId,
        table.ruleRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_purpose_instance_set_fk",
      columns: [table.tenantId, table.purposeSetId, table.purposeSetRevision],
      foreignColumns: [
        inboxV2DataGovernanceLifecyclePurposeSets.tenantId,
        inboxV2DataGovernanceLifecyclePurposeSets.purposeSetId,
        inboxV2DataGovernanceLifecyclePurposeSets.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_purpose_instance_values_check",
      sql`${table.ruleRevision} >= 1 and isfinite(${table.anchorAt}) and (
      (${table.conditionState} is null and ${table.conditionId} is null and ${table.conditionVersion} is null and ${table.conditionResolverHandlerId} is null and ${table.conditionEvidenceHash} is null)
      or (${table.conditionState} in ('resolved', 'unresolved') and ${table.conditionId} is not null and ${table.conditionVersion} >= 1 and ${table.conditionResolverHandlerId} is not null and ${digestSql(table.conditionEvidenceHash)})
    )`
    ),
    index("inbox_v2_dg_purpose_instance_tenant_idx").on(
      table.tenantId,
      table.purposeId,
      table.anchorAt,
      table.purposeSetId,
      table.purposeSetRevision
    )
  ]
);

/** Typed discovery edge only; it never grants authentication or application access. */
export const inboxV2DataGovernanceSubjectLinks = pgTable(
  "inbox_v2_data_governance_subject_links",
  {
    tenantId: text("tenant_id").notNull(),
    linkId: text("link_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    subjectKind: inboxV2DataGovernanceSubjectKind("subject_kind").notNull(),
    employeeId: text("employee_id"),
    clientContactId: text("client_contact_id"),
    sourceExternalIdentityId: text("source_external_identity_id"),
    accountId: text("account_id"),
    unresolvedProviderSubjectId: text("unresolved_provider_subject_id"),
    unresolvedRealmId: text("unresolved_realm_id"),
    role: inboxV2DataGovernanceSubjectLinkRole("role").notNull(),
    provenanceKind:
      inboxV2DataGovernanceSubjectProvenance("provenance_kind").notNull(),
    provenanceReferenceId: text("provenance_reference_id").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_subject_links_pk",
      columns: [table.tenantId, table.linkId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_subject_link_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_subject_link_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_subject_link_employee_fk",
      columns: [table.tenantId, table.employeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_subject_link_contact_fk",
      columns: [table.tenantId, table.clientContactId],
      foreignColumns: [clientContacts.tenantId, clientContacts.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_subject_link_identity_fk",
      columns: [table.tenantId, table.sourceExternalIdentityId],
      foreignColumns: [
        inboxV2SourceExternalIdentities.tenantId,
        inboxV2SourceExternalIdentities.id
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_subject_link_account_fk",
      columns: [table.tenantId, table.accountId],
      foreignColumns: [accounts.tenantId, accounts.id]
    }),
    check(
      "inbox_v2_dg_subject_link_values_check",
      sql`${table.revision} >= 1 and ${digestSql(table.evidenceHash)} and isfinite(${table.createdAt})`
    ),
    check(
      "inbox_v2_dg_subject_link_subject_check",
      sql`(
          ${table.subjectKind} = 'employee' and ${table.employeeId} is not null
          and ${table.clientContactId} is null and ${table.sourceExternalIdentityId} is null
          and ${table.accountId} is null and ${table.unresolvedProviderSubjectId} is null and ${table.unresolvedRealmId} is null
        ) or (
          ${table.subjectKind} = 'client_contact' and ${table.employeeId} is null
          and ${table.clientContactId} is not null and ${table.sourceExternalIdentityId} is null
          and ${table.accountId} is null and ${table.unresolvedProviderSubjectId} is null and ${table.unresolvedRealmId} is null
        ) or (
          ${table.subjectKind} = 'source_external_identity' and ${table.employeeId} is null
          and ${table.clientContactId} is null and ${table.sourceExternalIdentityId} is not null
          and ${table.accountId} is null and ${table.unresolvedProviderSubjectId} is null and ${table.unresolvedRealmId} is null
        ) or (
          ${table.subjectKind} = 'account' and ${table.employeeId} is null
          and ${table.clientContactId} is null and ${table.sourceExternalIdentityId} is null
          and ${table.accountId} is not null and ${table.unresolvedProviderSubjectId} is null and ${table.unresolvedRealmId} is null
        ) or (
          ${table.subjectKind} = 'unresolved_provider_subject' and ${table.employeeId} is null
          and ${table.clientContactId} is null and ${table.sourceExternalIdentityId} is null
          and ${table.accountId} is null and ${table.unresolvedProviderSubjectId} is not null and ${table.unresolvedRealmId} is not null
        )`
    ),
    index("inbox_v2_dg_subject_link_root_idx").on(
      table.tenantId,
      table.storageRootId,
      table.rootRecordId,
      table.role
    ),
    index("inbox_v2_dg_subject_link_subject_idx").on(
      table.tenantId,
      table.subjectKind,
      table.employeeId,
      table.clientContactId,
      table.sourceExternalIdentityId,
      table.accountId
    )
  ]
);

export const inboxV2DataGovernanceScopeManifests = pgTable(
  "inbox_v2_data_governance_scope_manifests",
  {
    tenantId: text("tenant_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    kind: inboxV2DataGovernanceScopeKind("kind").notNull(),
    manifestHash: text("manifest_hash").notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    syncGeneration: bigint("sync_generation", { mode: "bigint" }).notNull(),
    completeThroughPosition: bigint("complete_through_position", {
      mode: "bigint"
    }).notNull(),
    frozenAt: timestamp("frozen_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_scope_manifests_pk",
      columns: [table.tenantId, table.manifestId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_scope_manifest_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_scope_manifest_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    check(
      "inbox_v2_dg_scope_manifest_values_check",
      sql`${table.revision} >= 1 and ${table.syncGeneration} >= 1 and ${table.completeThroughPosition} >= 0 and ${digestSql(table.manifestHash)} and isfinite(${table.frozenAt})`
    ),
    index("inbox_v2_dg_scope_manifest_tenant_idx").on(
      table.tenantId,
      table.kind,
      table.frozenAt.desc(),
      table.manifestId
    )
  ]
);

/** Typed tenant-termination authority layered over one immutable tenant-wide scope. */
export const inboxV2DataGovernanceTenantTerminationScopeAuthorities = pgTable(
  "inbox_v2_data_governance_tenant_termination_scope_authorities",
  {
    tenantId: text("tenant_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    registryCompositionHash: text("registry_composition_hash").notNull(),
    rootSetHash: text("root_set_hash").notNull(),
    exportRootSetHash: text("export_root_set_hash").notNull(),
    proofHash: text("proof_hash").notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    activationId: text("activation_id").notNull(),
    activationRevision: bigint("activation_revision", {
      mode: "bigint"
    }).notNull(),
    activationHash: text("activation_hash").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_tenant_term_scope_authorities_pk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision]
    }),
    foreignKey({
      name: "inbox_v2_dg_tenant_term_scope_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_tenant_term_scope_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_tenant_term_scope_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_tenant_term_scope_activation_fk",
      columns: [table.tenantId, table.activationId, table.activationRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    check(
      "inbox_v2_dg_tenant_term_scope_authority_values_check",
      sql`${table.manifestRevision} >= 1 and ${table.governanceContextVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.activationRevision} >= 1 and ${digestSql(table.registryCompositionHash)} and ${digestSql(table.rootSetHash)} and ${digestSql(table.exportRootSetHash)} and ${digestSql(table.proofHash)} and ${digestSql(table.governanceContextHash)} and ${digestSql(table.policyHash)} and ${digestSql(table.activationHash)}`
    ),
    index("inbox_v2_dg_tenant_term_scope_authority_tenant_idx").on(
      table.tenantId,
      table.manifestRevision.desc(),
      table.manifestId
    )
  ]
);

export const inboxV2DataGovernanceScopeManifestRoots = pgTable(
  "inbox_v2_data_governance_scope_manifest_roots",
  {
    tenantId: text("tenant_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    rootKind: inboxV2DataGovernanceStorageRootKind("root_kind").notNull(),
    boundary: inboxV2DataGovernanceRootBoundary("boundary").notNull(),
    copyRole: inboxV2DataGovernanceCopyRole("copy_role").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_scope_manifest_roots_pk",
      columns: [
        table.tenantId,
        table.manifestId,
        table.manifestRevision,
        table.storageRootId,
        table.rootRecordId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_scope_root_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_scope_root_registry_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    check(
      "inbox_v2_dg_scope_root_values_check",
      sql`${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1`
    ),
    check(
      "inbox_v2_dg_scope_root_role_check",
      sql`(
      ${table.copyRole} = 'backup' and ${table.rootKind} = 'backup' and ${table.boundary} = 'operated_data_plane'
    ) or (
      ${table.copyRole} = 'external' and ${table.rootKind} = 'external_route' and ${table.boundary} = 'outside_operated_data_plane'
    ) or (
      ${table.copyRole} in ('primary', 'derived') and ${table.rootKind} not in ('backup', 'external_route') and ${table.boundary} = 'operated_data_plane'
    )`
    ),
    index("inbox_v2_dg_scope_root_entity_idx").on(
      table.tenantId,
      table.storageRootId,
      table.entityTypeId,
      table.entityId,
      table.manifestId
    ),
    index("inbox_v2_dg_scope_root_class_idx").on(
      table.tenantId,
      table.dataClassId,
      table.copyRole,
      table.manifestId
    )
  ]
);

export const inboxV2DataGovernanceLegalHoldRevisions = pgTable(
  "inbox_v2_data_governance_legal_hold_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    holdId: text("hold_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceControlState("state").notNull(),
    scopeKind: inboxV2DataGovernanceScopeKind("scope_kind").notNull(),
    scopeManifestId: text("scope_manifest_id").notNull(),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    caseId: text("case_id").notNull(),
    matcherHandlerId: text("matcher_handler_id"),
    matcherVersion: bigint("matcher_version", { mode: "bigint" }),
    predicateHash: text("predicate_hash"),
    ownerEmployeeId: text("owner_employee_id").notNull(),
    approverEmployeeId: text("approver_employee_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    legalReferenceCode: text("legal_reference_code").notNull(),
    anchorFrom: timestamp("anchor_from", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    anchorThrough: timestamp("anchor_through", {
      withTimezone: true,
      precision: 3
    }),
    endConditionId: text("end_condition_id").notNull(),
    endConditionHash: text("end_condition_hash").notNull(),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    reviewAt: timestamp("review_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true, precision: 3 }),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_legal_hold_revisions_pk",
      columns: [table.tenantId, table.holdId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_legal_hold_scope_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_legal_hold_owner_fk",
      columns: [table.tenantId, table.ownerEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_legal_hold_approver_fk",
      columns: [table.tenantId, table.approverEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_legal_hold_matcher_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.matcherHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_legal_hold_values_check",
      sql`${table.revision} >= 1 and ${table.ownerEmployeeId} <> ${table.approverEmployeeId} and ${digestSql(table.endConditionHash)} and isfinite(${table.anchorFrom}) and (${table.anchorThrough} is null or (isfinite(${table.anchorThrough}) and ${table.anchorThrough} >= ${table.anchorFrom})) and isfinite(${table.effectiveAt}) and isfinite(${table.reviewAt}) and ${table.reviewAt} > ${table.effectiveAt}`
    ),
    check(
      "inbox_v2_dg_legal_hold_state_check",
      sql`(${table.state} = 'active' and ${table.releasedAt} is null) or (${table.state} = 'released' and ${table.releasedAt} is not null and ${table.releasedAt} >= ${table.effectiveAt})`
    ),
    check(
      "inbox_v2_dg_legal_hold_scope_check",
      sql`(
      ${table.scopeKind} = 'prospective' and ${table.matcherHandlerId} is not null and ${table.matcherVersion} >= 1 and ${digestSql(table.predicateHash)}
    ) or (
      ${table.scopeKind} = 'exact' and ${table.matcherHandlerId} is null and ${table.matcherVersion} is null and ${table.predicateHash} is null
    )`
    ),
    index("inbox_v2_dg_legal_hold_state_idx").on(
      table.tenantId,
      table.state,
      table.reviewAt,
      table.holdId
    )
  ]
);

export const inboxV2DataGovernanceLegalHoldDataClasses = pgTable(
  "inbox_v2_data_governance_legal_hold_data_classes",
  {
    tenantId: text("tenant_id").notNull(),
    holdId: text("hold_id").notNull(),
    holdRevision: bigint("hold_revision", { mode: "bigint" }).notNull(),
    dataClassId: text("data_class_id").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_hold_data_classes_pk",
      columns: [
        table.tenantId,
        table.holdId,
        table.holdRevision,
        table.dataClassId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_hold_data_class_hold_fk",
      columns: [table.tenantId, table.holdId, table.holdRevision],
      foreignColumns: [
        inboxV2DataGovernanceLegalHoldRevisions.tenantId,
        inboxV2DataGovernanceLegalHoldRevisions.holdId,
        inboxV2DataGovernanceLegalHoldRevisions.revision
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_hold_data_class_values_check",
      sql`${table.holdRevision} >= 1`
    ),
    index("inbox_v2_dg_hold_data_class_tenant_idx").on(
      table.tenantId,
      table.dataClassId,
      table.holdId,
      table.holdRevision
    )
  ]
);

/** Materialized exact hold lookup; state duplication is guarded by deferred SQL. */
export const inboxV2DataGovernanceLegalHoldTargets = pgTable(
  "inbox_v2_data_governance_legal_hold_targets",
  {
    tenantId: text("tenant_id").notNull(),
    holdId: text("hold_id").notNull(),
    holdRevision: bigint("hold_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceControlState("state").notNull(),
    scopeManifestId: text("scope_manifest_id").notNull(),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_legal_hold_targets_pk",
      columns: [
        table.tenantId,
        table.holdId,
        table.holdRevision,
        table.storageRootId,
        table.rootRecordId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_hold_target_hold_fk",
      columns: [table.tenantId, table.holdId, table.holdRevision],
      foreignColumns: [
        inboxV2DataGovernanceLegalHoldRevisions.tenantId,
        inboxV2DataGovernanceLegalHoldRevisions.holdId,
        inboxV2DataGovernanceLegalHoldRevisions.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_hold_target_scope_root_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision,
        table.storageRootId,
        table.rootRecordId
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifestRoots.tenantId,
        inboxV2DataGovernanceScopeManifestRoots.manifestId,
        inboxV2DataGovernanceScopeManifestRoots.manifestRevision,
        inboxV2DataGovernanceScopeManifestRoots.storageRootId,
        inboxV2DataGovernanceScopeManifestRoots.rootRecordId
      ]
    }),
    check(
      "inbox_v2_dg_hold_target_values_check",
      sql`${table.holdRevision} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1`
    ),
    index("inbox_v2_dg_hold_lookup_idx").on(
      table.tenantId,
      table.storageRootId,
      table.entityTypeId,
      table.entityId,
      table.state,
      table.holdId
    ),
    index("inbox_v2_dg_hold_active_root_lookup_idx")
      .on(
        table.tenantId,
        table.storageRootId,
        table.rootRecordId,
        table.holdId,
        table.holdRevision
      )
      .where(sql`${table.state} = 'active'`)
  ]
);

export const inboxV2DataGovernanceLegalHoldHeads = pgTable(
  "inbox_v2_data_governance_legal_hold_heads",
  {
    tenantId: text("tenant_id").notNull(),
    holdId: text("hold_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceControlState("state").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_legal_hold_heads_pk",
      columns: [table.tenantId, table.holdId]
    }),
    foreignKey({
      name: "inbox_v2_dg_legal_hold_head_revision_fk",
      columns: [table.tenantId, table.holdId, table.currentRevision],
      foreignColumns: [
        inboxV2DataGovernanceLegalHoldRevisions.tenantId,
        inboxV2DataGovernanceLegalHoldRevisions.holdId,
        inboxV2DataGovernanceLegalHoldRevisions.revision
      ]
    }),
    check(
      "inbox_v2_dg_legal_hold_head_values_check",
      sql`${table.currentRevision} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_legal_hold_head_tenant_idx").on(
      table.tenantId,
      table.state,
      table.headRevision,
      table.holdId
    )
  ]
);

export const inboxV2DataGovernanceRestrictionRevisions = pgTable(
  "inbox_v2_data_governance_restriction_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    restrictionId: text("restriction_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceControlState("state").notNull(),
    scopeKind: inboxV2DataGovernanceScopeKind("scope_kind").notNull(),
    scopeManifestId: text("scope_manifest_id").notNull(),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    matcherHandlerId: text("matcher_handler_id"),
    matcherVersion: bigint("matcher_version", { mode: "bigint" }),
    predicateHash: text("predicate_hash"),
    ownerEmployeeId: text("owner_employee_id").notNull(),
    reasonCode: text("reason_code").notNull(),
    continuingPurposeCount: bigint("continuing_purpose_count", {
      mode: "number"
    }).notNull(),
    allowedUseMask: bigint("allowed_use_mask", { mode: "number" }).notNull(),
    effectiveAt: timestamp("effective_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    reviewAt: timestamp("review_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    releasedAt: timestamp("released_at", { withTimezone: true, precision: 3 }),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_restriction_revisions_pk",
      columns: [table.tenantId, table.restrictionId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_restriction_scope_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_restriction_owner_fk",
      columns: [table.tenantId, table.ownerEmployeeId],
      foreignColumns: [employees.tenantId, employees.id]
    }),
    foreignKey({
      name: "inbox_v2_dg_restriction_matcher_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.matcherHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_restriction_values_check",
      sql`${table.revision} >= 1 and ${table.continuingPurposeCount} >= 1 and ${table.allowedUseMask} between 1 and 2047 and isfinite(${table.effectiveAt}) and isfinite(${table.reviewAt}) and ${table.reviewAt} > ${table.effectiveAt}`
    ),
    check(
      "inbox_v2_dg_restriction_state_check",
      sql`(${table.state} = 'active' and ${table.releasedAt} is null) or (${table.state} = 'released' and ${table.releasedAt} is not null and ${table.releasedAt} >= ${table.effectiveAt})`
    ),
    check(
      "inbox_v2_dg_restriction_scope_check",
      sql`(${table.scopeKind} = 'prospective' and ${table.matcherHandlerId} is not null and ${table.matcherVersion} >= 1 and ${digestSql(table.predicateHash)}) or (${table.scopeKind} = 'exact' and ${table.matcherHandlerId} is null and ${table.matcherVersion} is null and ${table.predicateHash} is null)`
    ),
    index("inbox_v2_dg_restriction_state_idx").on(
      table.tenantId,
      table.state,
      table.reviewAt,
      table.restrictionId
    )
  ]
);

export const inboxV2DataGovernanceRestrictionHeads = pgTable(
  "inbox_v2_data_governance_restriction_heads",
  {
    tenantId: text("tenant_id").notNull(),
    restrictionId: text("restriction_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceControlState("state").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_restriction_heads_pk",
      columns: [table.tenantId, table.restrictionId]
    }),
    foreignKey({
      name: "inbox_v2_dg_restriction_head_revision_fk",
      columns: [table.tenantId, table.restrictionId, table.currentRevision],
      foreignColumns: [
        inboxV2DataGovernanceRestrictionRevisions.tenantId,
        inboxV2DataGovernanceRestrictionRevisions.restrictionId,
        inboxV2DataGovernanceRestrictionRevisions.revision
      ]
    }),
    check(
      "inbox_v2_dg_restriction_head_values_check",
      sql`${table.currentRevision} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_restriction_head_tenant_idx").on(
      table.tenantId,
      table.state,
      table.headRevision,
      table.restrictionId
    )
  ]
);

/** Tenant-wide monotonic control-set fence consumed by destructive operations. */
export const inboxV2DataGovernanceControlSetHeads = pgTable(
  "inbox_v2_data_governance_control_set_heads",
  {
    tenantId: text("tenant_id").notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    lastChangedStreamPosition: bigint("last_changed_stream_position", {
      mode: "bigint"
    }).notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_control_set_heads_pk",
      columns: [table.tenantId]
    }),
    foreignKey({
      name: "inbox_v2_dg_control_set_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_control_set_values_check",
      sql`${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${table.lastChangedStreamPosition} >= 0 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_control_set_tenant_idx").on(
      table.tenantId,
      table.lastChangedStreamPosition
    )
  ]
);

/** Immutable request history. Mutable routing and current state live in the CAS head. */
export const inboxV2DataGovernancePrivacyRequestRevisions = pgTable(
  "inbox_v2_data_governance_privacy_request_revisions",
  {
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    intent: inboxV2DataGovernancePrivacyRequestIntent("intent").notNull(),
    state: inboxV2DataGovernancePrivacyRequestState("state").notNull(),
    subjectKind: inboxV2DataGovernanceSubjectKind("subject_kind").notNull(),
    subjectKey: text("subject_key").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    scopeManifestId: text("scope_manifest_id"),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    decisionHash: text("decision_hash").notNull(),
    reasonCode: text("reason_code").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, precision: 3 }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_privacy_requests_pk",
      columns: [table.tenantId, table.requestId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_request_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_privacy_request_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_request_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_request_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_request_manifest_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    check(
      "inbox_v2_dg_privacy_request_values_check",
      sql`${table.revision} >= 1 and ${table.governanceContextVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${digestSql(table.governanceContextHash)} and ${digestSql(table.policyHash)} and ${digestSql(table.decisionHash)}`
    ),
    check(
      "inbox_v2_dg_privacy_request_manifest_check",
      sql`(${table.scopeManifestId} is null and ${table.scopeManifestRevision} is null) or (${table.scopeManifestId} is not null and ${table.scopeManifestRevision} >= 1)`
    ),
    check(
      "inbox_v2_dg_privacy_request_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.dueAt}) and ${table.dueAt} > ${table.createdAt} and (${table.completedAt} is null or (isfinite(${table.completedAt}) and ${table.completedAt} >= ${table.createdAt}))`
    ),
    index("inbox_v2_dg_privacy_request_tenant_idx").on(
      table.tenantId,
      table.state,
      table.dueAt,
      table.requestId
    )
  ]
);

export const inboxV2DataGovernancePrivacyRequestAliases = pgTable(
  "inbox_v2_data_governance_privacy_request_aliases",
  {
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull(),
    requestRevision: bigint("request_revision", { mode: "bigint" }).notNull(),
    subjectKind: inboxV2DataGovernanceSubjectKind("subject_kind").notNull(),
    subjectReferenceKey: text("subject_reference_key").notNull(),
    providerScopeKey: text("provider_scope_key"),
    normalizedExternalSubjectDigest: text("normalized_external_subject_digest"),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_privacy_request_aliases_pk",
      columns: [
        table.tenantId,
        table.requestId,
        table.requestRevision,
        table.subjectKind,
        table.subjectReferenceKey
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_alias_request_fk",
      columns: [table.tenantId, table.requestId, table.requestRevision],
      foreignColumns: [
        inboxV2DataGovernancePrivacyRequestRevisions.tenantId,
        inboxV2DataGovernancePrivacyRequestRevisions.requestId,
        inboxV2DataGovernancePrivacyRequestRevisions.revision
      ]
    }),
    check(
      "inbox_v2_dg_privacy_alias_values_check",
      sql`${table.requestRevision} >= 1 and length(${table.subjectReferenceKey}) between 3 and 160 and ${table.subjectReferenceKey} ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9_-]+$' and ${table.subjectReferenceKey} !~ '[[:cntrl:]@+[:space:]]' and isfinite(${table.createdAt})`
    ),
    check(
      "inbox_v2_dg_privacy_alias_provider_check",
      sql`(${table.subjectKind} = 'unresolved_provider_subject' and ${table.providerScopeKey} is not null and length(${table.providerScopeKey}) between 3 and 160 and ${table.providerScopeKey} !~ '[[:cntrl:]@+[:space:]]' and ${digestSql(table.normalizedExternalSubjectDigest)}) or (${table.subjectKind} <> 'unresolved_provider_subject' and ${table.providerScopeKey} is null and ${table.normalizedExternalSubjectDigest} is null)`
    ),
    index("inbox_v2_dg_privacy_alias_tenant_idx").on(
      table.tenantId,
      table.subjectKind,
      table.subjectReferenceKey,
      table.requestId
    )
  ]
);

export const inboxV2DataGovernancePrivacyRequestHeads = pgTable(
  "inbox_v2_data_governance_privacy_request_heads",
  {
    tenantId: text("tenant_id").notNull(),
    requestId: text("request_id").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    currentState:
      inboxV2DataGovernancePrivacyRequestState("current_state").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_privacy_request_heads_pk",
      columns: [table.tenantId, table.requestId]
    }),
    foreignKey({
      name: "inbox_v2_dg_privacy_head_revision_fk",
      columns: [table.tenantId, table.requestId, table.currentRevision],
      foreignColumns: [
        inboxV2DataGovernancePrivacyRequestRevisions.tenantId,
        inboxV2DataGovernancePrivacyRequestRevisions.requestId,
        inboxV2DataGovernancePrivacyRequestRevisions.revision
      ]
    }),
    check(
      "inbox_v2_dg_privacy_head_values_check",
      sql`${table.currentRevision} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_privacy_head_tenant_idx").on(
      table.tenantId,
      table.currentState,
      table.headRevision,
      table.requestId
    )
  ]
);

export const inboxV2DataGovernanceExportJobs = pgTable(
  "inbox_v2_data_governance_export_jobs",
  {
    tenantId: text("tenant_id").notNull(),
    jobId: text("job_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    stateRevision: bigint("state_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceExportJobState("state").notNull(),
    productKind:
      inboxV2DataGovernanceExportProductKind("product_kind").notNull(),
    productAuthorityId: text("product_authority_id").notNull(),
    productAuthorityRevision: bigint("product_authority_revision", {
      mode: "bigint"
    }).notNull(),
    productAuthorityHash: text("product_authority_hash").notNull(),
    requestId: text("request_id"),
    requestRevision: bigint("request_revision", { mode: "bigint" }),
    scopeManifestId: text("scope_manifest_id"),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }),
    governanceContextId: text("governance_context_id"),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }),
    governanceContextHash: text("governance_context_hash"),
    policyId: text("policy_id"),
    policyVersion: bigint("policy_version", { mode: "bigint" }),
    policyHash: text("policy_hash"),
    activationId: text("activation_id"),
    activationRevision: bigint("activation_revision", { mode: "bigint" }),
    activationHash: text("activation_hash"),
    exportManifestId: text("export_manifest_id"),
    exportManifestRevision: bigint("export_manifest_revision", {
      mode: "bigint"
    }),
    exportArtifactId: text("export_artifact_id"),
    exportArtifactRevision: bigint("export_artifact_revision", {
      mode: "bigint"
    }),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    exportHandlerId: text("export_handler_id").notNull(),
    principalKey: text("principal_key").notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
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
      name: "inbox_v2_dg_export_jobs_pk",
      columns: [table.tenantId, table.jobId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_request_fk",
      columns: [table.tenantId, table.requestId, table.requestRevision],
      foreignColumns: [
        inboxV2DataGovernancePrivacyRequestRevisions.tenantId,
        inboxV2DataGovernancePrivacyRequestRevisions.requestId,
        inboxV2DataGovernancePrivacyRequestRevisions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_scope_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_activation_fk",
      columns: [table.tenantId, table.activationId, table.activationRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_job_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.exportHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_export_job_values_check",
      sql`${table.revision} >= 1 and ${table.stateRevision} >= 1 and ${table.productAuthorityRevision} >= 1 and ${digestSql(table.productAuthorityHash)} and (${table.governanceContextHash} is null or ${digestSql(table.governanceContextHash)}) and (${table.policyHash} is null or ${digestSql(table.policyHash)}) and (${table.activationHash} is null or ${digestSql(table.activationHash)}) and isfinite(${table.createdAt}) and isfinite(${table.updatedAt}) and ${table.updatedAt} >= ${table.createdAt}`
    ),
    check(
      "inbox_v2_dg_export_job_product_check",
      sql`(${table.productKind} = 'tenant_deployment' and ${table.requestId} is null and ${table.requestRevision} is null and ${table.scopeManifestId} is not null and ${table.scopeManifestRevision} >= 1 and ${table.governanceContextId} is not null and ${table.governanceContextVersion} >= 1 and ${digestSql(table.governanceContextHash)} and ${table.policyId} is not null and ${table.policyVersion} >= 1 and ${digestSql(table.policyHash)} and ${table.activationId} is not null and ${table.activationRevision} >= 1 and ${digestSql(table.activationHash)}) or (${table.productKind} = 'data_subject' and ${table.requestId} is not null and ${table.requestRevision} >= 1 and ${table.scopeManifestId} is not null and ${table.scopeManifestRevision} >= 1 and ${table.governanceContextId} is null and ${table.governanceContextVersion} is null and ${table.governanceContextHash} is null and ${table.policyId} is null and ${table.policyVersion} is null and ${table.policyHash} is null and ${table.activationId} is null and ${table.activationRevision} is null and ${table.activationHash} is null) or (${table.productKind} = 'manager_report' and ${table.requestId} is null and ${table.requestRevision} is null and ${table.scopeManifestId} is null and ${table.scopeManifestRevision} is null and ${table.governanceContextId} is null and ${table.governanceContextVersion} is null and ${table.governanceContextHash} is null and ${table.policyId} is null and ${table.policyVersion} is null and ${table.policyHash} is null and ${table.activationId} is null and ${table.activationRevision} is null and ${table.activationHash} is null)`
    ),
    check(
      "inbox_v2_dg_export_job_manifest_state_check",
      sql`(${table.state} = 'queued' and ${table.exportManifestId} is null and ${table.exportManifestRevision} is null and ${table.exportArtifactId} is null and ${table.exportArtifactRevision} is null) or (${table.state} = 'running' and ${table.exportManifestId} is null and ${table.exportManifestRevision} is null and ${table.exportArtifactId} is not null and ${table.exportArtifactRevision} >= 1) or (${table.state} in ('ready', 'completed') and ${table.exportManifestId} is not null and ${table.exportManifestRevision} >= 1 and ${table.exportArtifactId} is not null and ${table.exportArtifactRevision} >= 1) or (${table.state} in ('revoked', 'expired', 'failed_retryable') and ${table.exportArtifactId} is not null and ${table.exportArtifactRevision} >= 1 and ((${table.exportManifestId} is null and ${table.exportManifestRevision} is null) or (${table.exportManifestId} is not null and ${table.exportManifestRevision} >= 1)))`
    ),
    index("inbox_v2_dg_export_job_tenant_idx").on(
      table.tenantId,
      table.state,
      table.stateRevision,
      table.updatedAt,
      table.jobId
    )
  ]
);

/** Immutable export projection manifest, distinct from the frozen discovery scope. */
export const inboxV2DataGovernanceExportManifests = pgTable(
  "inbox_v2_data_governance_export_manifests",
  {
    tenantId: text("tenant_id").notNull(),
    manifestId: text("manifest_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    manifestHash: text("manifest_hash").notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    scopeManifestId: text("scope_manifest_id"),
    scopeManifestRevision: bigint("scope_manifest_revision", {
      mode: "bigint"
    }),
    scopeProofHash: text("scope_proof_hash").notNull(),
    rootSetHash: text("root_set_hash").notNull(),
    boundary: inboxV2DataGovernanceRootBoundary("boundary").notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    syncGeneration: bigint("sync_generation", { mode: "bigint" }).notNull(),
    completeThroughPosition: bigint("complete_through_position", {
      mode: "bigint"
    }).notNull(),
    rootCount: bigint("root_count", { mode: "bigint" }).notNull(),
    recordCount: bigint("record_count", { mode: "bigint" }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_export_manifests_pk",
      columns: [table.tenantId, table.manifestId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_manifest_job_fk",
      columns: [table.tenantId, table.jobId, table.jobRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportJobs.tenantId,
        inboxV2DataGovernanceExportJobs.jobId,
        inboxV2DataGovernanceExportJobs.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_manifest_scope_fk",
      columns: [
        table.tenantId,
        table.scopeManifestId,
        table.scopeManifestRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    uniqueIndex("inbox_v2_dg_export_manifest_job_unique").on(
      table.tenantId,
      table.jobId,
      table.jobRevision,
      table.manifestId,
      table.revision
    ),
    check(
      "inbox_v2_dg_export_manifest_values_check",
      sql`${table.revision} >= 1 and ${table.jobRevision} >= 1 and ${table.syncGeneration} >= 1 and ${table.completeThroughPosition} >= 0 and ${table.rootCount} >= 0 and ${table.recordCount} >= 0 and ${digestSql(table.manifestHash)} and ${digestSql(table.scopeProofHash)} and ${digestSql(table.rootSetHash)} and ((${table.scopeManifestId} is null and ${table.scopeManifestRevision} is null) or (${table.scopeManifestId} is not null and ${table.scopeManifestRevision} >= 1)) and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_dg_export_manifest_tenant_idx").on(
      table.tenantId,
      table.jobId,
      table.revision.desc(),
      table.manifestId
    )
  ]
);

export const inboxV2DataGovernanceExportArtifacts = pgTable(
  "inbox_v2_data_governance_export_artifacts",
  {
    tenantId: text("tenant_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceExportArtifactState("state").notNull(),
    artifactClaimKey: text("artifact_claim_key").notNull(),
    manifestId: text("manifest_id"),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }),
    manifestHash: text("manifest_hash"),
    payloadChecksum: text("payload_checksum"),
    payloadLocator: text("payload_locator"),
    packagingProofHash: text("packaging_proof_hash"),
    archiveCompositionHash: text("archive_composition_hash"),
    byteCount: bigint("byte_count", { mode: "bigint" }).notNull(),
    readyAt: timestamp("ready_at", { withTimezone: true, precision: 3 }),
    expiresAt: timestamp("expires_at", {
      withTimezone: true,
      precision: 3
    }),
    deletedAt: timestamp("deleted_at", { withTimezone: true, precision: 3 }),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_export_artifacts_pk",
      columns: [table.tenantId, table.artifactId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_artifact_job_fk",
      columns: [table.tenantId, table.jobId, table.jobRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportJobs.tenantId,
        inboxV2DataGovernanceExportJobs.jobId,
        inboxV2DataGovernanceExportJobs.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_artifact_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportManifests.tenantId,
        inboxV2DataGovernanceExportManifests.manifestId,
        inboxV2DataGovernanceExportManifests.revision
      ]
    }),
    uniqueIndex("inbox_v2_dg_export_artifact_claim_revision_unique").on(
      table.tenantId,
      table.artifactClaimKey,
      table.revision
    ),
    check(
      "inbox_v2_dg_export_artifact_values_check",
      sql`${table.revision} >= 1 and ${table.jobRevision} >= 1 and ${table.byteCount} >= 0 and isfinite(${table.recordedAt})`
    ),
    check(
      "inbox_v2_dg_export_artifact_state_check",
      sql`(${table.state} = 'building' and ${table.manifestId} is null and ${table.manifestRevision} is null and ${table.manifestHash} is null and ${table.payloadChecksum} is null and ${table.byteCount} = 0 and ${table.packagingProofHash} is null and ${table.archiveCompositionHash} is null and ${table.readyAt} is null and ${table.expiresAt} is null and ${table.deletedAt} is null) or (${table.state} = 'ready' and ${table.manifestId} is not null and ${table.manifestRevision} >= 1 and ${digestSql(table.manifestHash)} and ${digestSql(table.payloadChecksum)} and ${table.payloadLocator} is not null and ${table.byteCount} > 0 and ${digestSql(table.packagingProofHash)} and ${digestSql(table.archiveCompositionHash)} and ${table.readyAt} is not null and ${table.expiresAt} is not null and ${table.deletedAt} is null and ${table.readyAt} >= ${table.recordedAt} and ${table.expiresAt} > ${table.readyAt} and ${table.expiresAt} <= ${table.readyAt} + interval '24 hours') or (${table.state} = 'quarantined' and ${table.manifestId} is null and ${table.manifestRevision} is null and ${table.manifestHash} is null and ${table.payloadChecksum} is null and ${table.packagingProofHash} is null and ${table.archiveCompositionHash} is null and ${table.readyAt} is null and ${table.expiresAt} is null and ${table.deletedAt} is null) or (${table.state} = 'deleted' and ${table.manifestId} is null and ${table.manifestRevision} is null and ${table.manifestHash} is null and ${table.payloadChecksum} is null and ${table.payloadLocator} is null and ${table.packagingProofHash} is null and ${table.archiveCompositionHash} is null and ${table.readyAt} is null and ${table.expiresAt} is null and ${table.deletedAt} is not null and ${table.deletedAt} >= ${table.recordedAt})`
    ),
    index("inbox_v2_dg_export_artifact_tenant_idx").on(
      table.tenantId,
      table.state,
      table.recordedAt,
      table.artifactId
    )
  ]
);

/** Mutable tenant-scoped pointer to exactly one current immutable artifact revision. */
export const inboxV2DataGovernanceExportArtifactHeads = pgTable(
  "inbox_v2_data_governance_export_artifact_heads",
  {
    tenantId: text("tenant_id").notNull(),
    artifactId: text("artifact_id").notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    artifactClaimKey: text("artifact_claim_key").notNull(),
    currentRevision: bigint("current_revision", { mode: "bigint" }).notNull(),
    currentState:
      inboxV2DataGovernanceExportArtifactState("current_state").notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_export_artifact_heads_pk",
      columns: [table.tenantId, table.artifactId]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_artifact_head_revision_fk",
      columns: [table.tenantId, table.artifactId, table.currentRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportArtifacts.tenantId,
        inboxV2DataGovernanceExportArtifacts.artifactId,
        inboxV2DataGovernanceExportArtifacts.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_artifact_head_job_fk",
      columns: [table.tenantId, table.jobId, table.jobRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportJobs.tenantId,
        inboxV2DataGovernanceExportJobs.jobId,
        inboxV2DataGovernanceExportJobs.revision
      ]
    }),
    uniqueIndex("inbox_v2_dg_export_artifact_head_claim_unique").on(
      table.tenantId,
      table.artifactClaimKey
    ),
    check(
      "inbox_v2_dg_export_artifact_head_values_check",
      sql`${table.currentRevision} >= 1 and ${table.jobRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_export_artifact_head_tenant_idx").on(
      table.tenantId,
      table.currentState,
      table.updatedAt,
      table.artifactId
    )
  ]
);

/** Immutable, exactly-once claim lineage. */
export const inboxV2DataGovernanceExportClaims = pgTable(
  "inbox_v2_data_governance_export_claims",
  {
    tenantId: text("tenant_id").notNull(),
    artifactClaimKey: text("artifact_claim_key").notNull(),
    receiptKey: text("receipt_key").notNull(),
    principalKey: text("principal_key").notNull(),
    claimRevision: bigint("claim_revision", { mode: "bigint" }).notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    packagingProofHash: text("packaging_proof_hash").notNull(),
    archiveCompositionHash: text("archive_composition_hash").notNull(),
    issuedReceiptHash: text("issued_receipt_hash").notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_export_claims_pk",
      columns: [table.tenantId, table.artifactClaimKey]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_claim_job_fk",
      columns: [table.tenantId, table.jobId, table.jobRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportJobs.tenantId,
        inboxV2DataGovernanceExportJobs.jobId,
        inboxV2DataGovernanceExportJobs.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_claim_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportManifests.tenantId,
        inboxV2DataGovernanceExportManifests.manifestId,
        inboxV2DataGovernanceExportManifests.revision
      ]
    }),
    uniqueIndex("inbox_v2_dg_export_claim_artifact_unique").on(
      table.tenantId,
      table.artifactClaimKey
    ),
    uniqueIndex("inbox_v2_dg_export_claim_receipt_unique").on(
      table.tenantId,
      table.receiptKey
    ),
    check(
      "inbox_v2_dg_export_claim_values_check",
      sql`${table.claimRevision} >= 1 and ${table.jobRevision} >= 1 and ${table.manifestRevision} >= 1 and ${digestSql(table.packagingProofHash)} and ${digestSql(table.archiveCompositionHash)} and ${digestSql(table.issuedReceiptHash)} and isfinite(${table.createdAt})`
    ),
    index("inbox_v2_dg_export_claim_tenant_idx").on(
      table.tenantId,
      table.principalKey,
      table.createdAt,
      table.receiptKey
    )
  ]
);

/** Mutable only through compare-and-swap; all lineage columns are immutable. */
export const inboxV2DataGovernanceExportReceiptCas = pgTable(
  "inbox_v2_data_governance_export_receipt_cas",
  {
    tenantId: text("tenant_id").notNull(),
    artifactClaimKey: text("artifact_claim_key").notNull(),
    receiptKey: text("receipt_key").notNull(),
    principalKey: text("principal_key").notNull(),
    claimRevision: bigint("claim_revision", { mode: "bigint" }).notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    packagingProofHash: text("packaging_proof_hash").notNull(),
    archiveCompositionHash: text("archive_composition_hash").notNull(),
    issuedReceiptHash: text("issued_receipt_hash").notNull(),
    state: inboxV2DataGovernanceExportReceiptState("state").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true, precision: 3 }),
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
      name: "inbox_v2_dg_export_receipt_cas_pk",
      columns: [table.tenantId, table.receiptKey]
    }),
    foreignKey({
      name: "inbox_v2_dg_export_receipt_claim_fk",
      columns: [table.tenantId, table.artifactClaimKey],
      foreignColumns: [
        inboxV2DataGovernanceExportClaims.tenantId,
        inboxV2DataGovernanceExportClaims.artifactClaimKey
      ]
    }),
    uniqueIndex("inbox_v2_dg_export_receipt_artifact_unique").on(
      table.tenantId,
      table.artifactClaimKey
    ),
    check(
      "inbox_v2_dg_export_receipt_values_check",
      sql`${table.claimRevision} >= 1 and ${table.jobRevision} >= 1 and ${table.manifestRevision} >= 1 and ${table.revision} >= 1 and ${digestSql(table.packagingProofHash)} and ${digestSql(table.archiveCompositionHash)} and ${digestSql(table.issuedReceiptHash)} and isfinite(${table.createdAt}) and isfinite(${table.updatedAt}) and ${table.updatedAt} >= ${table.createdAt}`
    ),
    check(
      "inbox_v2_dg_export_receipt_state_check",
      sql`(${table.state} = 'consumed' and ${table.consumedAt} is not null and ${table.consumedAt} >= ${table.createdAt}) or (${table.state} in ('issued', 'revoked', 'expired') and ${table.consumedAt} is null)`
    ),
    index("inbox_v2_dg_export_receipt_tenant_idx").on(
      table.tenantId,
      table.state,
      table.updatedAt,
      table.receiptKey
    )
  ]
);

export const inboxV2DataGovernanceDeletionPlans = pgTable(
  "inbox_v2_data_governance_deletion_plans",
  {
    tenantId: text("tenant_id").notNull(),
    planId: text("plan_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    planHash: text("plan_hash").notNull(),
    cause: inboxV2DataGovernanceDeletionCause("cause").notNull(),
    decisionBasisKind: inboxV2DataGovernanceDecisionBasisKind(
      "decision_basis_kind"
    ).notNull(),
    decisionBasisId: text("decision_basis_id").notNull(),
    decisionBasisHash: text("decision_basis_hash").notNull(),
    requestId: text("request_id"),
    requestRevision: bigint("request_revision", { mode: "bigint" }),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    registryCompositionHash: text("registry_composition_hash").notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    activationId: text("activation_id").notNull(),
    activationRevision: bigint("activation_revision", {
      mode: "bigint"
    }).notNull(),
    activationHash: text("activation_hash").notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    streamEpoch: text("stream_epoch").notNull(),
    syncGeneration: bigint("sync_generation", { mode: "bigint" }).notNull(),
    completeThroughPosition: bigint("complete_through_position", {
      mode: "bigint"
    }).notNull(),
    earliestExecutionAt: timestamp("earliest_execution_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull(),
    createdAt: timestamp("created_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_deletion_plans_pk",
      columns: [table.tenantId, table.planId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_request_fk",
      columns: [table.tenantId, table.requestId, table.requestRevision],
      foreignColumns: [
        inboxV2DataGovernancePrivacyRequestRevisions.tenantId,
        inboxV2DataGovernancePrivacyRequestRevisions.requestId,
        inboxV2DataGovernancePrivacyRequestRevisions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceScopeManifests.tenantId,
        inboxV2DataGovernanceScopeManifests.manifestId,
        inboxV2DataGovernanceScopeManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_plan_activation_fk",
      columns: [table.tenantId, table.activationId, table.activationRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    check(
      "inbox_v2_dg_deletion_plan_values_check",
      sql`${table.revision} >= 1 and ${table.manifestRevision} >= 1 and ${table.governanceContextVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.activationRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${table.syncGeneration} >= 1 and ${table.completeThroughPosition} >= 0 and ${digestSql(table.planHash)} and ${digestSql(table.decisionBasisHash)} and ${digestSql(table.registryCompositionHash)} and ${digestSql(table.governanceContextHash)} and ${digestSql(table.policyHash)} and ${digestSql(table.activationHash)}`
    ),
    check(
      "inbox_v2_dg_deletion_plan_request_check",
      sql`(${table.cause} in ('privacy_erasure', 'tenant_offboarding') and ${table.decisionBasisKind} = 'privacy_request' and ${table.requestId} is not null and ${table.requestRevision} >= 1) or (${table.cause} not in ('privacy_erasure', 'tenant_offboarding') and ${table.decisionBasisKind} <> 'privacy_request' and ${table.requestId} is null and ${table.requestRevision} is null)`
    ),
    check(
      "inbox_v2_dg_deletion_plan_basis_check",
      sql`(${table.cause} in ('retention_expiry', 'administrative_policy_purge') and ${table.decisionBasisKind} = 'lifecycle_policy') or (${table.cause} = 'provider_message_delete' and ${table.decisionBasisKind} = 'provider_lifecycle_event') or (${table.cause} = 'employee_ui_delete' and ${table.decisionBasisKind} = 'employee_content_action') or (${table.cause} in ('privacy_erasure', 'tenant_offboarding') and ${table.decisionBasisKind} = 'privacy_request')`
    ),
    check(
      "inbox_v2_dg_deletion_plan_time_check",
      sql`isfinite(${table.createdAt}) and isfinite(${table.earliestExecutionAt}) and ${table.earliestExecutionAt} >= ${table.createdAt}`
    ),
    index("inbox_v2_dg_deletion_plan_tenant_idx").on(
      table.tenantId,
      table.requestId,
      table.createdAt,
      table.planId
    )
  ]
);

/** Frozen exact checkpoint set; workers cannot substitute another root or handler. */
export const inboxV2DataGovernanceDeletionCheckpointRequirements = pgTable(
  "inbox_v2_data_governance_deletion_checkpoint_requirements",
  {
    tenantId: text("tenant_id").notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    surface: inboxV2DataGovernanceCheckpointSurface("surface").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootKind: inboxV2DataGovernanceStorageRootKind("root_kind").notNull(),
    boundary: inboxV2DataGovernanceRootBoundary("boundary").notNull(),
    copyRole: inboxV2DataGovernanceCopyRole("copy_role").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull(),
    deleteHandlerId: text("delete_handler_id"),
    verificationHandlerId: text("verification_handler_id"),
    expiryLedgerHandlerId: text("expiry_ledger_handler_id"),
    externalDeleteHandlerId: text("external_delete_handler_id"),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_checkpoint_requirements_pk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_plan_fk",
      columns: [table.tenantId, table.planId, table.planRevision],
      foreignColumns: [
        inboxV2DataGovernanceDeletionPlans.tenantId,
        inboxV2DataGovernanceDeletionPlans.planId,
        inboxV2DataGovernanceDeletionPlans.revision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_delete_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.deleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_verify_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.verificationHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_expiry_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.expiryLedgerHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_checkpoint_requirement_external_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.externalDeleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_checkpoint_requirement_values_check",
      sql`${table.planRevision} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1 and ${digestSql(table.requirementHash)}`
    ),
    check(
      "inbox_v2_dg_checkpoint_requirement_surface_check",
      sql`(${table.surface} = 'operated' and ${table.boundary} = 'operated_data_plane' and ${table.rootKind} not in ('backup', 'external_route') and ${table.copyRole} in ('primary', 'derived') and ${table.deleteHandlerId} is not null and ${table.verificationHandlerId} is not null and ${table.expiryLedgerHandlerId} is null and ${table.externalDeleteHandlerId} is null) or (${table.surface} = 'backup' and ${table.boundary} = 'operated_data_plane' and ${table.rootKind} = 'backup' and ${table.copyRole} = 'backup' and ${table.deleteHandlerId} is null and ${table.verificationHandlerId} is not null and ${table.expiryLedgerHandlerId} is not null and ${table.externalDeleteHandlerId} is null) or (${table.surface} = 'external' and ${table.boundary} = 'outside_operated_data_plane' and ${table.rootKind} = 'external_route' and ${table.copyRole} = 'external' and ${table.deleteHandlerId} is null and ${table.verificationHandlerId} is null and ${table.expiryLedgerHandlerId} is null and ${table.externalDeleteHandlerId} is not null)`
    ),
    index("inbox_v2_dg_checkpoint_requirement_tenant_idx").on(
      table.tenantId,
      table.planId,
      table.surface,
      table.storageRootId,
      table.checkpointId
    )
  ]
);

/** Aggregated state is constrained so residual classifications cannot be overstated. */
export const inboxV2DataGovernanceDeletionRuns = pgTable(
  "inbox_v2_data_governance_deletion_runs",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    revision: bigint("revision", { mode: "bigint" }).notNull(),
    stateRevision: bigint("state_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceDeletionRunState("state").notNull(),
    result: inboxV2DataGovernanceDeletionResult("result"),
    stageOneState:
      inboxV2DataGovernanceDeletionStageOneState("stage_one_state").notNull(),
    stageOneCommittedAt: timestamp("stage_one_committed_at", {
      withTimezone: true,
      precision: 3
    }),
    primaryAbsenceVerified: boolean("primary_absence_verified").notNull(),
    hasInternalResidual: boolean("has_internal_residual").notNull(),
    hasExternalResidual: boolean("has_external_residual").notNull(),
    hasBackupExpiryPending: boolean("has_backup_expiry_pending").notNull(),
    backupLatestPossibleExpiryAt: timestamp(
      "backup_latest_possible_expiry_at",
      { withTimezone: true, precision: 3 }
    ),
    operatedCheckpointCount: bigint("operated_checkpoint_count", {
      mode: "bigint"
    }).notNull(),
    backupCheckpointCount: bigint("backup_checkpoint_count", {
      mode: "bigint"
    }).notNull(),
    externalCheckpointCount: bigint("external_checkpoint_count", {
      mode: "bigint"
    }).notNull(),
    completedCheckpointCount: bigint("completed_checkpoint_count", {
      mode: "bigint"
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    stateHash: text("state_hash").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_deletion_runs_pk",
      columns: [table.tenantId, table.runId, table.revision]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_run_plan_fk",
      columns: [table.tenantId, table.planId, table.planRevision],
      foreignColumns: [
        inboxV2DataGovernanceDeletionPlans.tenantId,
        inboxV2DataGovernanceDeletionPlans.planId,
        inboxV2DataGovernanceDeletionPlans.revision
      ]
    }),
    unique("inbox_v2_dg_deletion_run_plan_anchor_unique").on(
      table.tenantId,
      table.runId,
      table.revision,
      table.planId,
      table.planRevision
    ),
    check(
      "inbox_v2_dg_deletion_run_values_check",
      sql`${table.revision} >= 1 and ${table.stateRevision} >= 1 and ${table.planRevision} >= 1 and ${table.operatedCheckpointCount} >= 1 and ${table.backupCheckpointCount} >= 0 and ${table.externalCheckpointCount} >= 0 and ${table.completedCheckpointCount} >= 0 and ${table.completedCheckpointCount} <= ${table.operatedCheckpointCount} + ${table.backupCheckpointCount} + ${table.externalCheckpointCount} and ${digestSql(table.stateHash)}`
    ),
    check(
      "inbox_v2_dg_deletion_run_terminal_check",
      sql`(${table.state} = 'terminal' and ${table.result} is not null and ${table.completedAt} is not null and ${table.stageOneState} = 'content_unavailable' and ${table.stageOneCommittedAt} is not null) or (${table.state} <> 'terminal' and ${table.result} is null and ${table.completedAt} is null)`
    ),
    check(
      "inbox_v2_dg_deletion_run_stage_one_check",
      sql`(${table.stageOneState} = 'pending' and ${table.stageOneCommittedAt} is null) or (${table.stageOneState} = 'content_unavailable' and ${table.stageOneCommittedAt} is not null and isfinite(${table.stageOneCommittedAt}) and ${table.stageOneCommittedAt} >= ${table.startedAt})`
    ),
    check(
      "inbox_v2_dg_deletion_run_time_check",
      sql`isfinite(${table.startedAt}) and isfinite(${table.updatedAt}) and ${table.updatedAt} >= ${table.startedAt} and (${table.completedAt} is null or (isfinite(${table.completedAt}) and ${table.completedAt} >= ${table.startedAt} and ${table.updatedAt} >= ${table.completedAt}))`
    ),
    check(
      "inbox_v2_dg_deletion_run_internal_check",
      sql`not ${table.hasInternalResidual} or ${table.result} = 'verification_blocked_internal_residual'`
    ),
    check(
      "inbox_v2_dg_deletion_run_external_check",
      sql`${table.result} <> 'completed_with_external_residuals' or (${table.hasExternalResidual} and not ${table.hasInternalResidual} and not ${table.hasBackupExpiryPending} and ${table.primaryAbsenceVerified})`
    ),
    check(
      "inbox_v2_dg_deletion_run_backup_check",
      sql`${table.result} <> 'primary_purged_backup_expiry_pending' or (${table.hasBackupExpiryPending} and ${table.primaryAbsenceVerified} and not ${table.hasInternalResidual} and ${table.backupLatestPossibleExpiryAt} is not null and isfinite(${table.backupLatestPossibleExpiryAt}))`
    ),
    check(
      "inbox_v2_dg_deletion_run_completed_check",
      sql`${table.result} <> 'completed' or (${table.primaryAbsenceVerified} and not ${table.hasInternalResidual} and not ${table.hasExternalResidual} and not ${table.hasBackupExpiryPending})`
    ),
    check(
      "inbox_v2_dg_deletion_run_backup_shape_check",
      sql`${table.hasBackupExpiryPending} = (${table.backupLatestPossibleExpiryAt} is not null)`
    ),
    index("inbox_v2_dg_deletion_run_tenant_idx").on(
      table.tenantId,
      table.state,
      table.startedAt,
      table.runId
    )
  ]
);

/** Immutable terminal-export authority frozen for one tenant-offboarding run. */
export const inboxV2DataGovernanceDeletionRunTerminalExports = pgTable(
  "inbox_v2_data_governance_deletion_run_terminal_exports",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    jobId: text("job_id").notNull(),
    jobRevision: bigint("job_revision", { mode: "bigint" }).notNull(),
    manifestId: text("manifest_id").notNull(),
    manifestRevision: bigint("manifest_revision", { mode: "bigint" }).notNull(),
    artifactId: text("artifact_id").notNull(),
    artifactRevision: bigint("artifact_revision", { mode: "bigint" }).notNull(),
    boundAt: timestamp("bound_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_deletion_run_terminal_exports_pk",
      columns: [table.tenantId, table.runId, table.runRevision]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_run_terminal_export_run_fk",
      columns: [table.tenantId, table.runId, table.runRevision],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_run_terminal_export_job_fk",
      columns: [table.tenantId, table.jobId, table.jobRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportJobs.tenantId,
        inboxV2DataGovernanceExportJobs.jobId,
        inboxV2DataGovernanceExportJobs.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_run_terminal_export_manifest_fk",
      columns: [table.tenantId, table.manifestId, table.manifestRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportManifests.tenantId,
        inboxV2DataGovernanceExportManifests.manifestId,
        inboxV2DataGovernanceExportManifests.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_run_terminal_export_artifact_fk",
      columns: [table.tenantId, table.artifactId, table.artifactRevision],
      foreignColumns: [
        inboxV2DataGovernanceExportArtifacts.tenantId,
        inboxV2DataGovernanceExportArtifacts.artifactId,
        inboxV2DataGovernanceExportArtifacts.revision
      ]
    }),
    check(
      "inbox_v2_dg_deletion_run_terminal_export_values_check",
      sql`${table.runRevision} >= 1 and ${table.jobRevision} >= 1 and ${table.manifestRevision} >= 1 and ${table.artifactRevision} >= 1 and isfinite(${table.boundAt})`
    ),
    index("inbox_v2_dg_deletion_run_terminal_export_job_idx").on(
      table.tenantId,
      table.jobId,
      table.jobRevision,
      table.artifactId,
      table.artifactRevision
    )
  ]
);

/** Immutable per-operated-checkpoint proof committed before destructive I/O. */
export const inboxV2DataGovernanceDeletionStageOneTargets = pgTable(
  "inbox_v2_data_governance_deletion_stage_one_targets",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    expectedRevision: bigint("expected_revision", { mode: "bigint" }).notNull(),
    resultingRevision: bigint("resulting_revision", {
      mode: "bigint"
    }).notNull(),
    tombstoneTenantId: text("tombstone_tenant_id").notNull(),
    tombstoneRecordId: text("tombstone_record_id").notNull(),
    tombstoneSchemaId: text("tombstone_schema_id").notNull(),
    tombstoneSchemaVersion: text("tombstone_schema_version").notNull(),
    tombstoneDigest: text("tombstone_digest").notNull(),
    invalidationDigest: text("invalidation_digest").notNull(),
    committedAt: timestamp("committed_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_deletion_stage_one_targets_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_stage_one_target_run_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.planId,
        table.planRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision,
        inboxV2DataGovernanceDeletionRuns.planId,
        inboxV2DataGovernanceDeletionRuns.planRevision
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_deletion_stage_one_target_requirement_fk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionCheckpointRequirements.tenantId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planRevision,
        inboxV2DataGovernanceDeletionCheckpointRequirements.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_deletion_stage_one_target_tenant_fk",
      columns: [table.tombstoneTenantId],
      foreignColumns: [tenants.id]
    }),
    check(
      "inbox_v2_dg_deletion_stage_one_target_values_check",
      sql`${table.runRevision} >= 1 and ${table.planRevision} >= 1 and ${table.expectedRevision} >= 1 and ${table.resultingRevision} > ${table.expectedRevision} and ${table.tombstoneTenantId} = ${table.tenantId} and ${digestSql(table.requirementHash)} and ${digestSql(table.tombstoneDigest)} and ${digestSql(table.invalidationDigest)} and ${table.rootRecordId} ~ '^data_root:[A-Za-z0-9][A-Za-z0-9._~-]*$' and length(${table.tombstoneRecordId}) between 3 and 200 and ${table.tombstoneRecordId} !~ '[[:cntrl:]@+[:space:]]' and length(${table.tombstoneSchemaId}) between 3 and 120 and ${table.tombstoneSchemaId} !~ '[[:cntrl:]@+[:space:]]' and ${table.tombstoneSchemaVersion} ~ '^v[1-9][0-9]*$' and isfinite(${table.committedAt})`
    ),
    index("inbox_v2_dg_deletion_stage_one_target_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.runRevision,
      table.checkpointId
    )
  ]
);

/** Durable claim authority acquired before destructive I/O and consumed exactly once. */
export const inboxV2DataGovernanceDestructiveCheckpointLeases = pgTable(
  "inbox_v2_data_governance_destructive_checkpoint_leases",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    claimRevision: bigint("claim_revision", { mode: "bigint" }).notNull(),
    state: inboxV2DataGovernanceCheckpointLeaseState("state").notNull(),
    executionFenceHash: text("execution_fence_hash").notNull(),
    surface: inboxV2DataGovernanceCheckpointSurface("surface").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    registryCompositionHash: text("registry_composition_hash").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    executionHandlerId: text("execution_handler_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    activationId: text("activation_id").notNull(),
    activationRevision: bigint("activation_revision", {
      mode: "bigint"
    }).notNull(),
    activationHash: text("activation_hash").notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    authorizationDecisionId: text("authorization_decision_id").notNull(),
    authorizationEpoch: text("authorization_epoch").notNull(),
    authorizationPrincipalKind: text("authorization_principal_kind").notNull(),
    authorizationPrincipalKey: text("authorization_principal_key").notNull(),
    authorizationPermissionId: text("authorization_permission_id").notNull(),
    authorizationResourceScopeId: text(
      "authorization_resource_scope_id"
    ).notNull(),
    authorizationResourceEntityTypeId: text(
      "authorization_resource_entity_type_id"
    ).notNull(),
    authorizationResourceEntityId: text(
      "authorization_resource_entity_id"
    ).notNull(),
    authorizationResourceAccessRevision: bigint(
      "authorization_resource_access_revision",
      { mode: "bigint" }
    ).notNull(),
    authorizationDecisionRevision: bigint("authorization_decision_revision", {
      mode: "bigint"
    }).notNull(),
    authorizationDecisionHash: text("authorization_decision_hash").notNull(),
    authorizationOutcome: text("authorization_outcome").notNull(),
    authorizationDecidedAt: timestamp("authorization_decided_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    authorizationNotAfter: timestamp("authorization_not_after", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    claimedAt: timestamp("claimed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_destructive_leases_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_run_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.planId,
        table.planRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision,
        inboxV2DataGovernanceDeletionRuns.planId,
        inboxV2DataGovernanceDeletionRuns.planRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_requirement_fk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionCheckpointRequirements.tenantId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planRevision,
        inboxV2DataGovernanceDeletionCheckpointRequirements.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.executionHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_destructive_lease_activation_fk",
      columns: [table.tenantId, table.activationId, table.activationRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    uniqueIndex("inbox_v2_dg_destructive_lease_fence_unique").on(
      table.tenantId,
      table.executionFenceHash
    ),
    check(
      "inbox_v2_dg_destructive_lease_values_check",
      sql`${table.runRevision} >= 1 and ${table.planRevision} >= 1 and ${table.claimRevision} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1 and ${table.governanceContextVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.activationRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${table.authorizationResourceAccessRevision} >= 0 and ${table.authorizationDecisionRevision} >= 1 and ${digestSql(table.requirementHash)} and ${digestSql(table.executionFenceHash)} and ${digestSql(table.registryCompositionHash)} and ${digestSql(table.governanceContextHash)} and ${digestSql(table.policyHash)} and ${digestSql(table.activationHash)} and ${digestSql(table.authorizationDecisionHash)}`
    ),
    check(
      "inbox_v2_dg_destructive_lease_authorization_check",
      sql`${table.authorizationPrincipalKind} in ('employee', 'trusted_service') and ${table.authorizationPermissionId} = 'core:privacy.deletion.execute' and ${table.authorizationResourceScopeId} = 'core:privacy-deletion-plan' and ${table.authorizationResourceEntityTypeId} = 'core:privacy-deletion-plan' and ${table.authorizationResourceEntityId} = ${table.planId} and ${table.authorizationResourceAccessRevision} = ${table.planRevision} and ${table.authorizationOutcome} = 'allowed' and isfinite(${table.authorizationDecidedAt}) and isfinite(${table.authorizationNotAfter}) and ${table.authorizationNotAfter} > ${table.authorizationDecidedAt}`
    ),
    check(
      "inbox_v2_dg_destructive_lease_time_check",
      sql`isfinite(${table.claimedAt}) and isfinite(${table.leaseExpiresAt}) and isfinite(${table.updatedAt}) and ${table.authorizationDecidedAt} <= ${table.claimedAt} and ${table.leaseExpiresAt} > ${table.claimedAt} and ${table.leaseExpiresAt} <= ${table.authorizationNotAfter} and ${table.updatedAt} >= ${table.claimedAt} and ((${table.state} = 'completed' and ${table.completedAt} is not null and ${table.completedAt} >= ${table.claimedAt}) or (${table.state} <> 'completed' and ${table.completedAt} is null))`
    ),
    index("inbox_v2_dg_destructive_lease_tenant_idx").on(
      table.tenantId,
      table.state,
      table.leaseExpiresAt,
      table.runId,
      table.checkpointId
    )
  ]
);

export const inboxV2DataGovernanceOperatedCheckpointAttempts = pgTable(
  "inbox_v2_data_governance_operated_checkpoint_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    attempt: bigint("attempt", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    deleteHandlerId: text("delete_handler_id").notNull(),
    verificationHandlerId: text("verification_handler_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    outcome: inboxV2DataGovernanceOperatedOutcome("outcome").notNull(),
    absenceVerified: boolean("absence_verified").notNull(),
    evidenceHash: text("evidence_hash"),
    errorCode: text("error_code"),
    executionFenceHash: text("execution_fence_hash").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_operated_attempts_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.attempt
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_attempt_run_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.planId,
        table.planRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision,
        inboxV2DataGovernanceDeletionRuns.planId,
        inboxV2DataGovernanceDeletionRuns.planRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_attempt_requirement_fk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionCheckpointRequirements.tenantId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planRevision,
        inboxV2DataGovernanceDeletionCheckpointRequirements.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_attempt_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_attempt_delete_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.deleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_attempt_verify_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.verificationHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_operated_attempt_values_check",
      sql`${table.runRevision} >= 1 and ${table.planRevision} >= 1 and ${table.attempt} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${digestSql(table.requirementHash)} and ${digestSql(table.executionFenceHash)}`
    ),
    check(
      "inbox_v2_dg_operated_attempt_outcome_check",
      sql`(${table.outcome} = 'verified_absent' and ${table.absenceVerified} and ${digestSql(table.evidenceHash)} and ${table.errorCode} is null) or (${table.outcome} <> 'verified_absent' and not ${table.absenceVerified} and ${table.evidenceHash} is null and ${table.errorCode} is not null)`
    ),
    check(
      "inbox_v2_dg_operated_attempt_time_check",
      sql`isfinite(${table.startedAt}) and isfinite(${table.completedAt}) and isfinite(${table.leaseExpiresAt}) and ${table.completedAt} >= ${table.startedAt} and ${table.leaseExpiresAt} > ${table.startedAt}`
    ),
    index("inbox_v2_dg_operated_attempt_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.runRevision,
      table.checkpointId,
      table.attempt.desc()
    )
  ]
);

export const inboxV2DataGovernanceOperatedCheckpointHeads = pgTable(
  "inbox_v2_data_governance_operated_checkpoint_heads",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    currentAttempt: bigint("current_attempt", { mode: "bigint" }).notNull(),
    currentOutcome:
      inboxV2DataGovernanceOperatedOutcome("current_outcome").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_operated_heads_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_operated_head_attempt_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.currentAttempt
      ],
      foreignColumns: [
        inboxV2DataGovernanceOperatedCheckpointAttempts.tenantId,
        inboxV2DataGovernanceOperatedCheckpointAttempts.runId,
        inboxV2DataGovernanceOperatedCheckpointAttempts.runRevision,
        inboxV2DataGovernanceOperatedCheckpointAttempts.checkpointId,
        inboxV2DataGovernanceOperatedCheckpointAttempts.attempt
      ]
    }),
    check(
      "inbox_v2_dg_operated_head_values_check",
      sql`${table.runRevision} >= 1 and ${table.currentAttempt} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_operated_head_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.currentOutcome,
      table.checkpointId
    )
  ]
);

export const inboxV2DataGovernanceBackupCheckpointAttempts = pgTable(
  "inbox_v2_data_governance_backup_checkpoint_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    attempt: bigint("attempt", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    verificationHandlerId: text("verification_handler_id").notNull(),
    expiryLedgerHandlerId: text("expiry_ledger_handler_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    outcome: inboxV2DataGovernanceBackupOutcome("outcome").notNull(),
    primaryAbsenceVerified: boolean("primary_absence_verified").notNull(),
    latestPossibleExpiryAt: timestamp("latest_possible_expiry_at", {
      withTimezone: true,
      precision: 3
    }),
    expiryVerifiedAt: timestamp("expiry_verified_at", {
      withTimezone: true,
      precision: 3
    }),
    evidenceHash: text("evidence_hash").notNull(),
    executionFenceHash: text("execution_fence_hash").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_backup_attempts_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.attempt
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_attempt_run_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.planId,
        table.planRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision,
        inboxV2DataGovernanceDeletionRuns.planId,
        inboxV2DataGovernanceDeletionRuns.planRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_attempt_requirement_fk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionCheckpointRequirements.tenantId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planRevision,
        inboxV2DataGovernanceDeletionCheckpointRequirements.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_attempt_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_attempt_verify_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.verificationHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_attempt_expiry_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.expiryLedgerHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_backup_attempt_values_check",
      sql`${table.runRevision} >= 1 and ${table.planRevision} >= 1 and ${table.attempt} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${digestSql(table.requirementHash)} and ${digestSql(table.evidenceHash)} and ${digestSql(table.executionFenceHash)}`
    ),
    check(
      "inbox_v2_dg_backup_attempt_pending_check",
      sql`${table.outcome} <> 'finite_expiry_pending' or (${table.primaryAbsenceVerified} and ${table.latestPossibleExpiryAt} is not null and isfinite(${table.latestPossibleExpiryAt}) and ${table.latestPossibleExpiryAt} > ${table.completedAt} and ${table.expiryVerifiedAt} is null)`
    ),
    check(
      "inbox_v2_dg_backup_attempt_verified_check",
      sql`${table.outcome} <> 'expiry_verified' or (${table.primaryAbsenceVerified} and ${table.latestPossibleExpiryAt} is not null and ${table.expiryVerifiedAt} is not null and isfinite(${table.expiryVerifiedAt}) and ${table.expiryVerifiedAt} >= ${table.latestPossibleExpiryAt})`
    ),
    check(
      "inbox_v2_dg_backup_attempt_time_check",
      sql`isfinite(${table.startedAt}) and isfinite(${table.completedAt}) and isfinite(${table.leaseExpiresAt}) and ${table.completedAt} >= ${table.startedAt} and ${table.leaseExpiresAt} > ${table.startedAt}`
    ),
    index("inbox_v2_dg_backup_attempt_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.runRevision,
      table.checkpointId,
      table.attempt.desc()
    )
  ]
);

export const inboxV2DataGovernanceBackupCheckpointHeads = pgTable(
  "inbox_v2_data_governance_backup_checkpoint_heads",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    currentAttempt: bigint("current_attempt", { mode: "bigint" }).notNull(),
    currentOutcome:
      inboxV2DataGovernanceBackupOutcome("current_outcome").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_backup_heads_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_backup_head_attempt_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.currentAttempt
      ],
      foreignColumns: [
        inboxV2DataGovernanceBackupCheckpointAttempts.tenantId,
        inboxV2DataGovernanceBackupCheckpointAttempts.runId,
        inboxV2DataGovernanceBackupCheckpointAttempts.runRevision,
        inboxV2DataGovernanceBackupCheckpointAttempts.checkpointId,
        inboxV2DataGovernanceBackupCheckpointAttempts.attempt
      ]
    }),
    check(
      "inbox_v2_dg_backup_head_values_check",
      sql`${table.runRevision} >= 1 and ${table.currentAttempt} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_backup_head_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.currentOutcome,
      table.checkpointId
    )
  ]
);

export const inboxV2DataGovernanceExternalCheckpointAttempts = pgTable(
  "inbox_v2_data_governance_external_checkpoint_attempts",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    planId: text("plan_id").notNull(),
    planRevision: bigint("plan_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    requirementHash: text("requirement_hash").notNull(),
    attempt: bigint("attempt", { mode: "bigint" }).notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    externalDeleteHandlerId: text("external_delete_handler_id").notNull(),
    expectedEntityRevision: bigint("expected_entity_revision", {
      mode: "bigint"
    }).notNull(),
    expectedLineageRevision: bigint("expected_lineage_revision", {
      mode: "bigint"
    }).notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    externalRequestId: text("external_request_id").notNull(),
    outcome: inboxV2DataGovernanceExternalOutcome("outcome").notNull(),
    evidenceHash: text("evidence_hash").notNull(),
    executionFenceHash: text("execution_fence_hash").notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    startedAt: timestamp("started_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    canonicalSnapshot: jsonb("canonical_snapshot")
      .$type<CanonicalSnapshot>()
      .notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_external_attempts_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.attempt
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_external_attempt_run_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.planId,
        table.planRevision
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision,
        inboxV2DataGovernanceDeletionRuns.planId,
        inboxV2DataGovernanceDeletionRuns.planRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_external_attempt_requirement_fk",
      columns: [
        table.tenantId,
        table.planId,
        table.planRevision,
        table.checkpointId
      ],
      foreignColumns: [
        inboxV2DataGovernanceDeletionCheckpointRequirements.tenantId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planId,
        inboxV2DataGovernanceDeletionCheckpointRequirements.planRevision,
        inboxV2DataGovernanceDeletionCheckpointRequirements.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_external_attempt_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_external_attempt_handler_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.externalDeleteHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    check(
      "inbox_v2_dg_external_attempt_values_check",
      sql`${table.runRevision} >= 1 and ${table.planRevision} >= 1 and ${table.attempt} >= 1 and ${table.expectedEntityRevision} >= 1 and ${table.expectedLineageRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${digestSql(table.requirementHash)} and ${digestSql(table.evidenceHash)} and ${digestSql(table.executionFenceHash)}`
    ),
    check(
      "inbox_v2_dg_external_attempt_time_check",
      sql`isfinite(${table.startedAt}) and isfinite(${table.completedAt}) and isfinite(${table.leaseExpiresAt}) and ${table.completedAt} >= ${table.startedAt} and ${table.leaseExpiresAt} > ${table.startedAt}`
    ),
    index("inbox_v2_dg_external_attempt_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.runRevision,
      table.checkpointId,
      table.attempt.desc()
    )
  ]
);

export const inboxV2DataGovernanceExternalCheckpointHeads = pgTable(
  "inbox_v2_data_governance_external_checkpoint_heads",
  {
    tenantId: text("tenant_id").notNull(),
    runId: text("run_id").notNull(),
    runRevision: bigint("run_revision", { mode: "bigint" }).notNull(),
    checkpointId: text("checkpoint_id").notNull(),
    currentAttempt: bigint("current_attempt", { mode: "bigint" }).notNull(),
    currentOutcome:
      inboxV2DataGovernanceExternalOutcome("current_outcome").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_external_heads_pk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_external_head_attempt_fk",
      columns: [
        table.tenantId,
        table.runId,
        table.runRevision,
        table.checkpointId,
        table.currentAttempt
      ],
      foreignColumns: [
        inboxV2DataGovernanceExternalCheckpointAttempts.tenantId,
        inboxV2DataGovernanceExternalCheckpointAttempts.runId,
        inboxV2DataGovernanceExternalCheckpointAttempts.runRevision,
        inboxV2DataGovernanceExternalCheckpointAttempts.checkpointId,
        inboxV2DataGovernanceExternalCheckpointAttempts.attempt
      ]
    }),
    check(
      "inbox_v2_dg_external_head_values_check",
      sql`${table.runRevision} >= 1 and ${table.currentAttempt} >= 1 and ${table.headRevision} >= 1 and isfinite(${table.updatedAt})`
    ),
    index("inbox_v2_dg_external_head_tenant_idx").on(
      table.tenantId,
      table.runId,
      table.currentOutcome,
      table.checkpointId
    )
  ]
);

/** Append-only erasure/control/restore chain used to prevent deleted data resurrection. */
export const inboxV2DataGovernanceErasureRestoreLedger = pgTable(
  "inbox_v2_data_governance_erasure_restore_ledger",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    sequence: bigint("sequence", { mode: "bigint" }).notNull(),
    kind: inboxV2DataGovernanceLedgerKind("kind").notNull(),
    registryId: text("registry_id").notNull(),
    registryRevision: bigint("registry_revision", { mode: "bigint" }).notNull(),
    registryCompositionHash: text("registry_composition_hash").notNull(),
    governanceContextId: text("governance_context_id").notNull(),
    governanceContextVersion: bigint("governance_context_version", {
      mode: "bigint"
    }).notNull(),
    governanceContextHash: text("governance_context_hash").notNull(),
    policyId: text("policy_id").notNull(),
    policyVersion: bigint("policy_version", { mode: "bigint" }).notNull(),
    policyHash: text("policy_hash").notNull(),
    activationId: text("activation_id").notNull(),
    activationRevision: bigint("activation_revision", {
      mode: "bigint"
    }).notNull(),
    activationHash: text("activation_hash").notNull(),
    storageRootId: text("storage_root_id").notNull(),
    rootKind: inboxV2DataGovernanceStorageRootKind("root_kind").notNull(),
    boundary: inboxV2DataGovernanceRootBoundary("boundary").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    entityRevision: bigint("entity_revision", { mode: "bigint" }).notNull(),
    lineageRevision: bigint("lineage_revision", { mode: "bigint" }).notNull(),
    deletionRunId: text("deletion_run_id"),
    deletionRunRevision: bigint("deletion_run_revision", { mode: "bigint" }),
    controlKind: inboxV2DataGovernanceControlReferenceKind("control_kind"),
    controlId: text("control_id"),
    controlRevision: bigint("control_revision", { mode: "bigint" }),
    restoreId: text("restore_id"),
    primaryAbsenceVerified: boolean("primary_absence_verified").notNull(),
    primaryAbsenceVerifiedAt: timestamp("primary_absence_verified_at", {
      withTimezone: true,
      precision: 3
    }),
    primaryVerificationHandlerId: text("primary_verification_handler_id"),
    backupExpiryState: inboxV2DataGovernanceBackupExpiryState(
      "backup_expiry_state"
    ).notNull(),
    backupLatestPossibleExpiryAt: timestamp(
      "backup_latest_possible_expiry_at",
      { withTimezone: true, precision: 3 }
    ),
    backupVerifiedAt: timestamp("backup_verified_at", {
      withTimezone: true,
      precision: 3
    }),
    controlAppliedAt: timestamp("control_applied_at", {
      withTimezone: true,
      precision: 3
    }),
    controlReleasedAt: timestamp("control_released_at", {
      withTimezone: true,
      precision: 3
    }),
    controlReappliedAt: timestamp("control_reapplied_at", {
      withTimezone: true,
      precision: 3
    }),
    restoreSealedAt: timestamp("restore_sealed_at", {
      withTimezone: true,
      precision: 3
    }),
    requiredControlHash: text("required_control_hash"),
    reappliedControlHash: text("reapplied_control_hash"),
    sourceErasureEntryHash: text("source_erasure_entry_hash"),
    sourceControlEntryHash: text("source_control_entry_hash"),
    streamEpoch: text("stream_epoch").notNull(),
    syncGeneration: bigint("sync_generation", { mode: "bigint" }).notNull(),
    completeThroughPosition: bigint("complete_through_position", {
      mode: "bigint"
    }).notNull(),
    previousEntryHash: text("previous_entry_hash"),
    entryHash: text("entry_hash").notNull(),
    occurredAt: timestamp("occurred_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    recordedAt: timestamp("recorded_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_erasure_restore_ledger_pk",
      columns: [table.tenantId, table.ledgerEntryId]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_registry_fk",
      columns: [table.registryId, table.registryRevision],
      foreignColumns: [
        inboxV2DataGovernanceRegistryVersions.id,
        inboxV2DataGovernanceRegistryVersions.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_context_fk",
      columns: [
        table.tenantId,
        table.governanceContextId,
        table.governanceContextVersion
      ],
      foreignColumns: [
        inboxV2DataGovernanceContexts.tenantId,
        inboxV2DataGovernanceContexts.contextId,
        inboxV2DataGovernanceContexts.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_policy_fk",
      columns: [table.tenantId, table.policyId, table.policyVersion],
      foreignColumns: [
        inboxV2DataGovernanceEffectivePolicies.tenantId,
        inboxV2DataGovernanceEffectivePolicies.policyId,
        inboxV2DataGovernanceEffectivePolicies.version
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_activation_fk",
      columns: [table.tenantId, table.activationId, table.activationRevision],
      foreignColumns: [
        inboxV2DataGovernancePolicyActivations.tenantId,
        inboxV2DataGovernancePolicyActivations.activationId,
        inboxV2DataGovernancePolicyActivations.revision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_root_fk",
      columns: [table.registryId, table.registryRevision, table.storageRootId],
      foreignColumns: [
        inboxV2DataGovernanceStorageRoots.registryId,
        inboxV2DataGovernanceStorageRoots.registryRevision,
        inboxV2DataGovernanceStorageRoots.storageRootId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_primary_verify_fk",
      columns: [
        table.registryId,
        table.registryRevision,
        table.primaryVerificationHandlerId
      ],
      foreignColumns: [
        inboxV2DataGovernanceLifecycleHandlers.registryId,
        inboxV2DataGovernanceLifecycleHandlers.registryRevision,
        inboxV2DataGovernanceLifecycleHandlers.handlerId
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_run_fk",
      columns: [table.tenantId, table.deletionRunId, table.deletionRunRevision],
      foreignColumns: [
        inboxV2DataGovernanceDeletionRuns.tenantId,
        inboxV2DataGovernanceDeletionRuns.runId,
        inboxV2DataGovernanceDeletionRuns.revision
      ]
    }),
    unique("inbox_v2_dg_erasure_ledger_entry_anchor_unique").on(
      table.tenantId,
      table.ledgerId,
      table.ledgerEntryId
    ),
    uniqueIndex("inbox_v2_dg_erasure_ledger_sequence_unique").on(
      table.tenantId,
      table.ledgerId,
      table.sequence
    ),
    unique("inbox_v2_dg_erasure_ledger_hash_unique").on(
      table.tenantId,
      table.ledgerId,
      table.entryHash
    ),
    check(
      "inbox_v2_dg_erasure_ledger_values_check",
      sql`${table.sequence} >= 1 and ${table.governanceContextVersion} >= 1 and ${table.policyVersion} >= 1 and ${table.activationRevision} >= 1 and ${table.entityRevision} >= 1 and ${table.lineageRevision} >= 1 and ${table.syncGeneration} >= 1 and ${table.completeThroughPosition} >= 0 and ${digestSql(table.registryCompositionHash)} and ${digestSql(table.governanceContextHash)} and ${digestSql(table.policyHash)} and ${digestSql(table.activationHash)} and ${digestSql(table.entryHash)} and (${table.previousEntryHash} is null or ${digestSql(table.previousEntryHash)}) and isfinite(${table.occurredAt}) and isfinite(${table.recordedAt}) and ${table.recordedAt} >= ${table.occurredAt}`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_run_check",
      sql`(${table.kind} = 'erasure_applied' and ${table.deletionRunId} is not null and ${table.deletionRunRevision} >= 1) or (${table.kind} <> 'erasure_applied' and ${table.deletionRunId} is null and ${table.deletionRunRevision} is null)`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_erasure_check",
      sql`${table.kind} <> 'erasure_applied' or ${table.primaryAbsenceVerified}`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_control_check",
      sql`(${table.kind} in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied') and ${table.controlKind} is not null and ${table.controlId} is not null and ${table.controlRevision} >= 1) or (${table.kind} not in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied') and ${table.controlKind} is null and ${table.controlId} is null and ${table.controlRevision} is null)`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_control_kind_check",
      sql`${table.kind} not in ('hold_applied', 'hold_released') or ${table.controlKind} = 'legal_hold'`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_restriction_kind_check",
      sql`${table.kind} not in ('restriction_applied', 'restriction_released') or ${table.controlKind} = 'restriction'`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_restore_check",
      sql`(${table.kind} in ('erasure_applied', 'hold_applied', 'restriction_applied', 'hold_released', 'restriction_released') and ${table.restoreId} is null and ${table.requiredControlHash} is null and ${table.reappliedControlHash} is null) or (${table.kind} = 'restore_opened' and ${table.restoreId} is not null and ${digestSql(table.requiredControlHash)} and ${table.reappliedControlHash} is null) or (${table.kind} = 'control_reapplied' and ${table.restoreId} is not null and ${table.requiredControlHash} is null and ${table.reappliedControlHash} is null) or (${table.kind} = 'restore_sealed' and ${table.restoreId} is not null and ${digestSql(table.requiredControlHash)} and ${digestSql(table.reappliedControlHash)})`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_source_check",
      sql`(${table.kind} in ('restore_opened', 'restore_sealed') and ${digestSql(table.sourceErasureEntryHash)} and ${table.sourceControlEntryHash} is null) or (${table.kind} = 'control_reapplied' and ${table.sourceErasureEntryHash} is null and ${digestSql(table.sourceControlEntryHash)}) or (${table.kind} not in ('restore_opened', 'control_reapplied', 'restore_sealed') and ${table.sourceErasureEntryHash} is null and ${table.sourceControlEntryHash} is null)`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_primary_evidence_check",
      sql`(${table.primaryAbsenceVerified} and ${table.primaryAbsenceVerifiedAt} is not null and isfinite(${table.primaryAbsenceVerifiedAt}) and ${table.primaryVerificationHandlerId} is not null) or (not ${table.primaryAbsenceVerified} and ${table.primaryAbsenceVerifiedAt} is null and ${table.primaryVerificationHandlerId} is null)`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_backup_check",
      sql`(${table.backupExpiryState} = 'not_applicable' and ${table.backupLatestPossibleExpiryAt} is null and ${table.backupVerifiedAt} is null) or (${table.backupExpiryState} = 'finite_expiry_pending' and ${table.primaryAbsenceVerified} and ${table.backupLatestPossibleExpiryAt} is not null and isfinite(${table.backupLatestPossibleExpiryAt}) and ${table.backupLatestPossibleExpiryAt} > ${table.recordedAt} and ${table.backupVerifiedAt} is null) or (${table.backupExpiryState} = 'verified_expired' and ${table.primaryAbsenceVerified} and ${table.backupLatestPossibleExpiryAt} is not null and isfinite(${table.backupLatestPossibleExpiryAt}) and ${table.backupLatestPossibleExpiryAt} <= ${table.recordedAt} and ${table.backupVerifiedAt} is not null and isfinite(${table.backupVerifiedAt}) and ${table.backupVerifiedAt} >= ${table.backupLatestPossibleExpiryAt})`
    ),
    check(
      "inbox_v2_dg_erasure_ledger_control_time_check",
      sql`(${table.kind} in ('hold_applied', 'restriction_applied') and ${table.controlAppliedAt} is not null and isfinite(${table.controlAppliedAt}) and ${table.controlAppliedAt} <= ${table.occurredAt} and ${table.controlReleasedAt} is null and ${table.controlReappliedAt} is null and ${table.restoreSealedAt} is null) or (${table.kind} in ('hold_released', 'restriction_released') and ${table.controlAppliedAt} is null and ${table.controlReleasedAt} is not null and isfinite(${table.controlReleasedAt}) and ${table.controlReleasedAt} <= ${table.occurredAt} and ${table.controlReappliedAt} is null and ${table.restoreSealedAt} is null) or (${table.kind} = 'control_reapplied' and ${table.controlAppliedAt} is null and ${table.controlReleasedAt} is null and ${table.controlReappliedAt} is not null and isfinite(${table.controlReappliedAt}) and ${table.controlReappliedAt} <= ${table.occurredAt} and ${table.restoreSealedAt} is null) or (${table.kind} = 'restore_sealed' and ${table.controlAppliedAt} is null and ${table.controlReleasedAt} is null and ${table.controlReappliedAt} is null and ${table.restoreSealedAt} is not null and isfinite(${table.restoreSealedAt}) and ${table.restoreSealedAt} <= ${table.occurredAt}) or (${table.kind} in ('erasure_applied', 'restore_opened') and ${table.controlAppliedAt} is null and ${table.controlReleasedAt} is null and ${table.controlReappliedAt} is null and ${table.restoreSealedAt} is null)`
    ),
    index("inbox_v2_dg_erasure_ledger_target_idx").on(
      table.tenantId,
      table.storageRootId,
      table.dataClassId,
      table.entityTypeId,
      table.entityId,
      table.sequence.desc()
    ),
    index("inbox_v2_dg_erasure_ledger_restore_idx").on(
      table.tenantId,
      table.ledgerId,
      table.restoreId,
      table.sequence
    ),
    uniqueIndex("inbox_v2_dg_erasure_ledger_restore_open_unique")
      .on(table.tenantId, table.ledgerId, table.restoreId)
      .where(sql`${table.kind} = 'restore_opened'`),
    uniqueIndex("inbox_v2_dg_erasure_ledger_restore_seal_unique")
      .on(table.tenantId, table.ledgerId, table.restoreId)
      .where(sql`${table.kind} = 'restore_sealed'`)
  ]
);

export const inboxV2DataGovernanceErasureRestoreLedgerEvidence = pgTable(
  "inbox_v2_data_governance_erasure_restore_ledger_evidence",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    slot: inboxV2DataGovernanceLedgerEvidenceSlot("slot").notNull(),
    kind: inboxV2DataGovernanceLedgerEvidenceKind("kind").notNull(),
    digest: text("digest").notNull(),
    payloadTenantId: text("payload_tenant_id"),
    payloadRecordId: text("payload_record_id"),
    payloadSchemaId: text("payload_schema_id"),
    payloadSchemaVersion: text("payload_schema_version")
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_erasure_ledger_evidence_pk",
      columns: [table.tenantId, table.ledgerId, table.ledgerEntryId, table.slot]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_evidence_entry_fk",
      columns: [table.tenantId, table.ledgerId, table.ledgerEntryId],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerEntryId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_evidence_tenant_fk",
      columns: [table.payloadTenantId],
      foreignColumns: [tenants.id]
    }),
    check(
      "inbox_v2_dg_erasure_ledger_evidence_values_check",
      sql`${digestSql(table.digest)} and ((${table.kind} = 'digest' and ${table.payloadTenantId} is null and ${table.payloadRecordId} is null and ${table.payloadSchemaId} is null and ${table.payloadSchemaVersion} is null) or (${table.kind} = 'payload_reference' and ${table.payloadTenantId} = ${table.tenantId} and ${table.payloadRecordId} is not null and length(${table.payloadRecordId}) between 3 and 200 and ${table.payloadRecordId} !~ '[[:cntrl:]@+[:space:]]' and ${table.payloadSchemaId} is not null and length(${table.payloadSchemaId}) between 3 and 120 and ${table.payloadSchemaId} !~ '[[:cntrl:]@+[:space:]]' and ${table.payloadSchemaVersion} is not null and length(${table.payloadSchemaVersion}) between 1 and 64 and ${table.payloadSchemaVersion} !~ '[[:cntrl:]@+[:space:]]'))`
    ),
    index("inbox_v2_dg_erasure_ledger_evidence_tenant_idx").on(
      table.tenantId,
      table.slot,
      table.ledgerId,
      table.ledgerEntryId
    )
  ]
);

/** Relationalized canonical required/reapplied control sets for restore sealing. */
export const inboxV2DataGovernanceErasureRestoreLedgerControls = pgTable(
  "inbox_v2_data_governance_erasure_restore_ledger_controls",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    ledgerEntryId: text("ledger_entry_id").notNull(),
    role: inboxV2DataGovernanceLedgerControlSetRole("role").notNull(),
    controlKind:
      inboxV2DataGovernanceControlReferenceKind("control_kind").notNull(),
    controlId: text("control_id").notNull(),
    controlRevision: bigint("control_revision", { mode: "bigint" }).notNull(),
    controlEntryHash: text("control_entry_hash").notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_erasure_ledger_controls_pk",
      columns: [
        table.tenantId,
        table.ledgerId,
        table.ledgerEntryId,
        table.role,
        table.controlKind,
        table.controlId,
        table.controlRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_erasure_ledger_control_entry_fk",
      columns: [table.tenantId, table.ledgerId, table.ledgerEntryId],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerEntryId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_erasure_ledger_control_values_check",
      sql`${table.controlRevision} >= 1 and ${digestSql(table.controlEntryHash)}`
    ),
    index("inbox_v2_dg_erasure_ledger_control_tenant_idx").on(
      table.tenantId,
      table.controlKind,
      table.controlId,
      table.ledgerId,
      table.ledgerEntryId
    )
  ]
);

/**
 * Database-owned restore authority. The target, source erasure, ledger
 * high-water and tenant control-set revisions are frozen at open time; callers
 * cannot substitute their own required-control set at seal time.
 */
export const inboxV2DataGovernanceRestoreHeads = pgTable(
  "inbox_v2_data_governance_restore_heads",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    restoreId: text("restore_id").notNull(),
    state: inboxV2DataGovernanceRestoreHeadState("state").notNull(),
    headRevision: bigint("head_revision", { mode: "bigint" }).notNull(),
    sourceErasureEntryHash: text("source_erasure_entry_hash").notNull(),
    sourceErasureSequence: bigint("source_erasure_sequence", {
      mode: "bigint"
    }).notNull(),
    storageRootId: text("storage_root_id").notNull(),
    dataClassId: text("data_class_id").notNull(),
    rootRecordId: text("root_record_id").notNull(),
    entityTypeId: text("entity_type_id").notNull(),
    entityId: text("entity_id").notNull(),
    entityRevision: bigint("entity_revision", { mode: "bigint" }).notNull(),
    lineageRevision: bigint("lineage_revision", { mode: "bigint" }).notNull(),
    openedEntryHash: text("opened_entry_hash").notNull(),
    openedSequence: bigint("opened_sequence", { mode: "bigint" }).notNull(),
    openedStreamEpoch: text("opened_stream_epoch").notNull(),
    openedSyncGeneration: bigint("opened_sync_generation", {
      mode: "bigint"
    }).notNull(),
    openedCompleteThroughPosition: bigint("opened_complete_through_position", {
      mode: "bigint"
    }).notNull(),
    controlSetHeadRevision: bigint("control_set_head_revision", {
      mode: "bigint"
    }).notNull(),
    legalHoldSetRevision: bigint("legal_hold_set_revision", {
      mode: "bigint"
    }).notNull(),
    restrictionSetRevision: bigint("restriction_set_revision", {
      mode: "bigint"
    }).notNull(),
    controlSetStreamPosition: bigint("control_set_stream_position", {
      mode: "bigint"
    }).notNull(),
    requiredControlSetHash: text("required_control_set_hash").notNull(),
    requiredControlCount: bigint("required_control_count", {
      mode: "number"
    }).notNull(),
    sealedEntryHash: text("sealed_entry_hash"),
    sealedSequence: bigint("sealed_sequence", { mode: "bigint" }),
    openedAt: timestamp("opened_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    sealedAt: timestamp("sealed_at", { withTimezone: true, precision: 3 }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_restore_heads_pk",
      columns: [table.tenantId, table.ledgerId, table.restoreId]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_head_tenant_fk",
      columns: [table.tenantId],
      foreignColumns: [tenants.id]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_restore_head_source_fk",
      columns: [table.tenantId, table.ledgerId, table.sourceErasureEntryHash],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.entryHash
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_head_opened_fk",
      columns: [table.tenantId, table.ledgerId, table.openedEntryHash],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.entryHash
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_head_sealed_fk",
      columns: [table.tenantId, table.ledgerId, table.sealedEntryHash],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.entryHash
      ]
    }),
    check(
      "inbox_v2_dg_restore_head_values_check",
      sql`${table.headRevision} >= 1 and ${table.sourceErasureSequence} >= 1 and ${table.openedSequence} > ${table.sourceErasureSequence} and ${table.openedSyncGeneration} >= 1 and ${table.openedCompleteThroughPosition} >= 0 and ${table.controlSetHeadRevision} >= 1 and ${table.legalHoldSetRevision} >= 0 and ${table.restrictionSetRevision} >= 0 and ${table.controlSetStreamPosition} >= 0 and ${table.requiredControlCount} between 0 and 10000 and ${digestSql(table.sourceErasureEntryHash)} and ${digestSql(table.openedEntryHash)} and ${digestSql(table.requiredControlSetHash)} and isfinite(${table.openedAt}) and isfinite(${table.updatedAt})`
    ),
    check(
      "inbox_v2_dg_restore_head_state_check",
      sql`(${table.state} = 'open' and ${table.sealedEntryHash} is null and ${table.sealedSequence} is null and ${table.sealedAt} is null) or (${table.state} = 'sealed' and ${digestSql(table.sealedEntryHash)} and ${table.sealedSequence} > ${table.openedSequence} and ${table.sealedAt} is not null and isfinite(${table.sealedAt}) and ${table.sealedAt} >= ${table.openedAt})`
    ),
    uniqueIndex("inbox_v2_dg_restore_head_open_source_unique")
      .on(table.tenantId, table.ledgerId, table.sourceErasureEntryHash)
      .where(sql`${table.state} = 'open'`),
    uniqueIndex("inbox_v2_dg_restore_head_seal_unique")
      .on(table.tenantId, table.ledgerId, table.sealedEntryHash)
      .where(sql`${table.sealedEntryHash} is not null`),
    index("inbox_v2_dg_restore_head_target_idx").on(
      table.tenantId,
      table.storageRootId,
      table.dataClassId,
      table.entityTypeId,
      table.entityId,
      table.state
    )
  ]
);

/** Exact controls selected by the database from current control heads. */
export const inboxV2DataGovernanceRestoreRequiredControls = pgTable(
  "inbox_v2_data_governance_restore_required_controls",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    restoreId: text("restore_id").notNull(),
    controlKind:
      inboxV2DataGovernanceControlReferenceKind("control_kind").notNull(),
    controlId: text("control_id").notNull(),
    controlRevision: bigint("control_revision", { mode: "bigint" }).notNull(),
    controlHeadRevision: bigint("control_head_revision", {
      mode: "bigint"
    }).notNull(),
    sourceControlEntryHash: text("source_control_entry_hash").notNull(),
    rowRevision: bigint("row_revision", { mode: "bigint" }).notNull(),
    reappliedEntryHash: text("reapplied_entry_hash"),
    reappliedAt: timestamp("reapplied_at", {
      withTimezone: true,
      precision: 3
    })
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_restore_required_controls_pk",
      columns: [
        table.tenantId,
        table.ledgerId,
        table.restoreId,
        table.controlKind,
        table.controlId,
        table.controlRevision
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_required_head_fk",
      columns: [table.tenantId, table.ledgerId, table.restoreId],
      foreignColumns: [
        inboxV2DataGovernanceRestoreHeads.tenantId,
        inboxV2DataGovernanceRestoreHeads.ledgerId,
        inboxV2DataGovernanceRestoreHeads.restoreId
      ]
    }).onDelete("cascade"),
    foreignKey({
      name: "inbox_v2_dg_restore_required_source_fk",
      columns: [table.tenantId, table.ledgerId, table.sourceControlEntryHash],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.entryHash
      ]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_required_reapplied_fk",
      columns: [table.tenantId, table.ledgerId, table.reappliedEntryHash],
      foreignColumns: [
        inboxV2DataGovernanceErasureRestoreLedger.tenantId,
        inboxV2DataGovernanceErasureRestoreLedger.ledgerId,
        inboxV2DataGovernanceErasureRestoreLedger.entryHash
      ]
    }),
    check(
      "inbox_v2_dg_restore_required_values_check",
      sql`${table.controlRevision} >= 1 and ${table.controlHeadRevision} >= 1 and ${table.rowRevision} >= 1 and ${digestSql(table.sourceControlEntryHash)} and ((${table.reappliedEntryHash} is null and ${table.reappliedAt} is null) or (${digestSql(table.reappliedEntryHash)} and ${table.reappliedAt} is not null and isfinite(${table.reappliedAt})) )`
    ),
    uniqueIndex("inbox_v2_dg_restore_required_source_unique").on(
      table.tenantId,
      table.ledgerId,
      table.restoreId,
      table.sourceControlEntryHash
    ),
    index("inbox_v2_dg_restore_required_control_idx").on(
      table.tenantId,
      table.controlKind,
      table.controlId,
      table.controlRevision,
      table.restoreId
    )
  ]
);

/** Short-lived opaque capability for mutating one restore head. */
export const inboxV2DataGovernanceRestoreLeases = pgTable(
  "inbox_v2_data_governance_restore_leases",
  {
    tenantId: text("tenant_id").notNull(),
    ledgerId: text("ledger_id").notNull(),
    restoreId: text("restore_id").notNull(),
    leaseRevision: bigint("lease_revision", { mode: "bigint" }).notNull(),
    restoreHeadRevision: bigint("restore_head_revision", {
      mode: "bigint"
    }).notNull(),
    state: inboxV2DataGovernanceRestoreLeaseState("state").notNull(),
    leaseTokenHash: text("lease_token_hash").notNull(),
    claimedAt: timestamp("claimed_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    leaseExpiresAt: timestamp("lease_expires_at", {
      withTimezone: true,
      precision: 3
    }).notNull(),
    completedAt: timestamp("completed_at", {
      withTimezone: true,
      precision: 3
    }),
    updatedAt: timestamp("updated_at", {
      withTimezone: true,
      precision: 3
    }).notNull()
  },
  (table) => [
    primaryKey({
      name: "inbox_v2_dg_restore_leases_pk",
      columns: [table.tenantId, table.ledgerId, table.restoreId]
    }),
    foreignKey({
      name: "inbox_v2_dg_restore_lease_head_fk",
      columns: [table.tenantId, table.ledgerId, table.restoreId],
      foreignColumns: [
        inboxV2DataGovernanceRestoreHeads.tenantId,
        inboxV2DataGovernanceRestoreHeads.ledgerId,
        inboxV2DataGovernanceRestoreHeads.restoreId
      ]
    }).onDelete("cascade"),
    check(
      "inbox_v2_dg_restore_lease_values_check",
      sql`${table.leaseRevision} >= 1 and ${table.restoreHeadRevision} >= 1 and ${digestSql(table.leaseTokenHash)} and isfinite(${table.claimedAt}) and isfinite(${table.leaseExpiresAt}) and ${table.leaseExpiresAt} > ${table.claimedAt} and isfinite(${table.updatedAt})`
    ),
    check(
      "inbox_v2_dg_restore_lease_state_check",
      sql`(${table.state} = 'active' and ${table.completedAt} is null) or (${table.state} = 'completed' and ${table.completedAt} is not null and isfinite(${table.completedAt}) and ${table.completedAt} >= ${table.claimedAt} and ${table.completedAt} <= ${table.leaseExpiresAt}) or (${table.state} in ('released', 'expired') and ${table.completedAt} is null)`
    ),
    uniqueIndex("inbox_v2_dg_restore_lease_token_unique").on(
      table.tenantId,
      table.leaseTokenHash
    ),
    index("inbox_v2_dg_restore_lease_state_idx").on(
      table.tenantId,
      table.state,
      table.leaseExpiresAt,
      table.restoreId
    )
  ]
);

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception '% is append-only', tg_table_name using errcode = '23514';
end
$function$;

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_data_governance_registry_versions',
    'inbox_v2_data_governance_storage_roots',
    'inbox_v2_data_governance_lifecycle_handlers',
    'inbox_v2_data_governance_data_use_lineages',
    'inbox_v2_data_governance_policy_templates',
    'inbox_v2_data_governance_policy_template_rules',
    'inbox_v2_data_governance_contexts',
    'inbox_v2_data_governance_context_purpose_roles',
    'inbox_v2_data_governance_effective_policies',
    'inbox_v2_data_governance_effective_policy_rules',
    'inbox_v2_data_governance_policy_activations',
    'inbox_v2_data_governance_lifecycle_purpose_sets',
    'inbox_v2_data_governance_lifecycle_purpose_instances',
    'inbox_v2_data_governance_subject_links',
    'inbox_v2_data_governance_scope_manifests',
    'inbox_v2_data_governance_tenant_termination_scope_authorities',
    'inbox_v2_data_governance_scope_manifest_roots',
    'inbox_v2_data_governance_legal_hold_revisions',
    'inbox_v2_data_governance_legal_hold_data_classes',
    'inbox_v2_data_governance_legal_hold_targets',
    'inbox_v2_data_governance_restriction_revisions',
    'inbox_v2_data_governance_privacy_request_revisions',
    'inbox_v2_data_governance_privacy_request_aliases',
    'inbox_v2_data_governance_export_manifests',
    'inbox_v2_data_governance_export_artifacts',
    'inbox_v2_data_governance_export_claims',
    'inbox_v2_data_governance_deletion_plans',
    'inbox_v2_data_governance_deletion_run_terminal_exports',
    'inbox_v2_data_governance_deletion_checkpoint_requirements',
    'inbox_v2_data_governance_deletion_stage_one_targets',
    'inbox_v2_data_governance_operated_checkpoint_attempts',
    'inbox_v2_data_governance_backup_checkpoint_attempts',
    'inbox_v2_data_governance_external_checkpoint_attempts',
    'inbox_v2_data_governance_erasure_restore_ledger',
    'inbox_v2_data_governance_erasure_restore_ledger_evidence',
    'inbox_v2_data_governance_erasure_restore_ledger_controls'
  ]
  loop
    v_trigger := 'inbox_v2_dg_immutable_' || substr(md5(v_table), 1, 16);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.inbox_v2_dg_reject_immutable()',
      v_trigger,
      v_table
    );
  end loop;
end
$block$;

create or replace function public.inbox_v2_dg_deletion_run_terminal_export_required()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_cause text;
  v_binding_count bigint;
begin
  select p.cause, count(te.run_id)
    into v_cause, v_binding_count
    from public.inbox_v2_data_governance_deletion_plans p
    left join public.inbox_v2_data_governance_deletion_run_terminal_exports te
      on te.tenant_id = new.tenant_id
     and te.run_id = new.run_id
     and te.run_revision = new.revision
   where p.tenant_id = new.tenant_id
     and p.plan_id = new.plan_id
     and p.revision = new.plan_revision
   group by p.cause;

  if v_cause is null then
    raise exception 'Deletion run terminal-export requirement lacks its exact plan'
      using errcode = '23514';
  end if;
  if (v_cause = 'tenant_offboarding' and v_binding_count <> 1)
     or (v_cause <> 'tenant_offboarding' and v_binding_count <> 0) then
    raise exception 'Deletion run terminal-export binding does not match its cause'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_dg_deletion_run_terminal_export_required
after insert on public.inbox_v2_data_governance_deletion_runs
deferrable initially deferred
for each row execute function public.inbox_v2_dg_deletion_run_terminal_export_required();
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_CHECKPOINT_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_checkpoint_attempt_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_row jsonb;
  v_surface text;
begin
  v_row := to_jsonb(new);
  v_surface := case tg_table_name
    when 'inbox_v2_data_governance_operated_checkpoint_attempts' then 'operated'
    when 'inbox_v2_data_governance_backup_checkpoint_attempts' then 'backup'
    when 'inbox_v2_data_governance_external_checkpoint_attempts' then 'external'
  end;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_deletion_checkpoint_requirements q
      join public.inbox_v2_data_governance_deletion_plans p
        on p.tenant_id = q.tenant_id
       and p.plan_id = q.plan_id
       and p.revision = q.plan_revision
      join public.inbox_v2_data_governance_destructive_checkpoint_leases l
        on l.tenant_id = q.tenant_id
       and l.plan_id = q.plan_id
       and l.plan_revision = q.plan_revision
       and l.checkpoint_id = q.checkpoint_id
      join public.inbox_v2_data_governance_contexts c
        on c.tenant_id = l.tenant_id
       and c.context_id = l.governance_context_id
       and c.version = l.governance_context_version
      join public.inbox_v2_data_governance_effective_policies ep
        on ep.tenant_id = l.tenant_id
       and ep.policy_id = l.policy_id
       and ep.version = l.policy_version
      join public.inbox_v2_data_governance_policy_activations a
        on a.tenant_id = l.tenant_id
       and a.activation_id = l.activation_id
       and a.revision = l.activation_revision
      join public.inbox_v2_data_governance_policy_activation_heads ah
        on ah.tenant_id = l.tenant_id
       and ah.policy_id = l.policy_id
       and ah.current_policy_version = l.policy_version
       and ah.current_activation_id = l.activation_id
       and ah.current_activation_revision = l.activation_revision
      join public.inbox_v2_data_governance_control_set_heads cs
        on cs.tenant_id = l.tenant_id
     where q.tenant_id = v_row->>'tenant_id'
       and q.plan_id = v_row->>'plan_id'
       and q.plan_revision = (v_row->>'plan_revision')::bigint
       and q.checkpoint_id = v_row->>'checkpoint_id'
       and q.surface::text = v_surface
       and q.requirement_hash = v_row->>'requirement_hash'
       and q.registry_id = v_row->>'registry_id'
       and q.registry_revision = (v_row->>'registry_revision')::bigint
       and q.storage_root_id = v_row->>'storage_root_id'
       and q.data_class_id = v_row->>'data_class_id'
       and q.root_record_id = v_row->>'root_record_id'
       and q.entity_type_id = v_row->>'entity_type_id'
       and q.entity_id = v_row->>'entity_id'
       and q.expected_entity_revision = (v_row->>'expected_entity_revision')::bigint
       and q.expected_lineage_revision = (v_row->>'expected_lineage_revision')::bigint
       and l.run_id = v_row->>'run_id'
       and l.run_revision = (v_row->>'run_revision')::bigint
       and l.surface::text = v_surface
       and l.requirement_hash = q.requirement_hash
       and l.registry_id = q.registry_id
       and l.registry_revision = q.registry_revision
       and l.registry_composition_hash = p.registry_composition_hash
       and l.storage_root_id = q.storage_root_id
       and l.data_class_id = q.data_class_id
       and l.root_record_id = q.root_record_id
       and l.entity_type_id = q.entity_type_id
       and l.entity_id = q.entity_id
       and l.expected_entity_revision = q.expected_entity_revision
       and l.expected_lineage_revision = q.expected_lineage_revision
       and l.execution_fence_hash = v_row->>'execution_fence_hash'
       and l.state = 'completed'
       and l.completed_at = (v_row->>'completed_at')::timestamptz
       and l.completed_at <= l.lease_expires_at
       and l.lease_expires_at = (v_row->>'lease_expires_at')::timestamptz
       and l.governance_context_id = p.governance_context_id
       and l.governance_context_version = p.governance_context_version
       and l.governance_context_hash = p.governance_context_hash
       and c.context_hash = l.governance_context_hash
       and l.policy_id = p.policy_id
       and l.policy_version = p.policy_version
       and l.policy_hash = p.policy_hash
       and ep.policy_hash = l.policy_hash
       and l.activation_id = p.activation_id
       and l.activation_revision = p.activation_revision
       and l.activation_hash = p.activation_hash
       and a.activation_hash = l.activation_hash
       and l.legal_hold_set_revision = p.legal_hold_set_revision
       and l.restriction_set_revision = p.restriction_set_revision
       and cs.legal_hold_set_revision = l.legal_hold_set_revision
       and cs.restriction_set_revision = l.restriction_set_revision
       and (v_row->>'legal_hold_set_revision')::bigint = l.legal_hold_set_revision
       and (v_row->>'restriction_set_revision')::bigint = l.restriction_set_revision
       and (
         (v_surface = 'operated'
           and q.delete_handler_id = v_row->>'delete_handler_id'
           and q.verification_handler_id = v_row->>'verification_handler_id'
           and l.execution_handler_id = q.delete_handler_id)
         or (v_surface = 'backup'
           and q.verification_handler_id = v_row->>'verification_handler_id'
           and q.expiry_ledger_handler_id = v_row->>'expiry_ledger_handler_id'
           and l.execution_handler_id = q.expiry_ledger_handler_id)
         or (v_surface = 'external'
           and q.external_delete_handler_id = v_row->>'external_delete_handler_id'
           and l.execution_handler_id = q.external_delete_handler_id)
       )
       and not exists (
         select 1
           from public.inbox_v2_data_governance_legal_hold_targets ht
           join public.inbox_v2_data_governance_legal_hold_heads hh
             on hh.tenant_id = ht.tenant_id
            and hh.hold_id = ht.hold_id
            and hh.current_revision = ht.hold_revision
            and hh.state = 'active'
          where ht.tenant_id = q.tenant_id
            and ht.storage_root_id = q.storage_root_id
            and ht.root_record_id = q.root_record_id
            and ht.entity_type_id = q.entity_type_id
            and ht.entity_id = q.entity_id
            and ht.state = 'active'
       )
  ) then
    raise exception 'Checkpoint attempt does not consume an exact live durable fence'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_data_governance_operated_checkpoint_attempts',
    'inbox_v2_data_governance_backup_checkpoint_attempts',
    'inbox_v2_data_governance_external_checkpoint_attempts'
  ]
  loop
    v_trigger := 'inbox_v2_dg_attempt_' || substr(md5(v_table), 1, 16);
    execute format(
      'create constraint trigger %I after insert on public.%I deferrable initially deferred for each row execute function public.inbox_v2_dg_checkpoint_attempt_coherence()',
      v_trigger,
      v_table
    );
  end loop;
end
$block$;
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_COHERENCE_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_governance_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_data_governance_scope_manifest_roots' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_storage_roots r
       where r.registry_id = new.registry_id
         and r.registry_revision = new.registry_revision
         and r.storage_root_id = new.storage_root_id
         and r.kind = new.root_kind
         and r.boundary = new.boundary
    ) then
      raise exception 'Scope root kind/boundary differs from the registered root'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_tenant_termination_scope_authorities' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_scope_manifests sm
        join public.inbox_v2_data_governance_registry_versions rv
          on rv.id = sm.registry_id and rv.revision = sm.registry_revision
        join public.inbox_v2_data_governance_contexts c
          on c.tenant_id = sm.tenant_id
         and c.context_id = new.governance_context_id
         and c.version = new.governance_context_version
        join public.inbox_v2_data_governance_effective_policies p
          on p.tenant_id = sm.tenant_id
         and p.policy_id = new.policy_id
         and p.version = new.policy_version
        join public.inbox_v2_data_governance_policy_activations a
          on a.tenant_id = sm.tenant_id
         and a.activation_id = new.activation_id
         and a.revision = new.activation_revision
       where sm.tenant_id = new.tenant_id
         and sm.manifest_id = new.manifest_id
         and sm.revision = new.manifest_revision
         and sm.kind = 'tenant_wide'
         and rv.composition_hash = new.registry_composition_hash
         and c.context_hash = new.governance_context_hash
         and c.registry_id = sm.registry_id
         and c.registry_revision = sm.registry_revision
         and p.policy_hash = new.policy_hash
         and p.registry_id = sm.registry_id
         and p.registry_revision = sm.registry_revision
         and p.governance_context_id = c.context_id
         and p.governance_context_version = c.version
         and a.activation_hash = new.activation_hash
         and a.policy_id = p.policy_id
         and a.policy_version = p.version
         and a.governance_context_id = c.context_id
         and a.governance_context_version = c.version
         and a.governance_context_hash = c.context_hash
    ) then
      raise exception 'Tenant-termination scope authority is not exact or tenant-wide'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_subject_links' then
    if new.account_id is not null and not exists (
      select 1 from public.accounts a
       where a.id = new.account_id and a.tenant_id = new.tenant_id
    ) then
      raise exception 'Subject-link account crosses the tenant boundary'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_policy_activations' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_effective_policies p
        join public.inbox_v2_data_governance_contexts c
          on c.tenant_id = p.tenant_id
         and c.context_id = p.governance_context_id
         and c.version = p.governance_context_version
       where p.tenant_id = new.tenant_id
         and p.policy_id = new.policy_id
         and p.version = new.policy_version
         and p.policy_hash = new.candidate_policy_hash
         and c.context_id = new.governance_context_id
         and c.version = new.governance_context_version
         and c.context_hash = new.governance_context_hash
    ) then
      raise exception 'Policy activation authority hash/context mismatch'
        using errcode = '23514';
    end if;
    if new.transition_kind = 'supersede_current' and not exists (
      select 1 from public.inbox_v2_data_governance_policy_activations p
       where p.tenant_id = new.tenant_id
         and p.activation_id = new.prior_activation_id
         and p.revision = new.prior_activation_revision
         and p.policy_id = new.policy_id
         and p.policy_version = new.prior_policy_version
         and p.policy_version < new.policy_version
    ) then
      raise exception 'Policy activation prior lineage is missing or stale'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_policy_activation_heads' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_policy_activations a
       where a.tenant_id = new.tenant_id
         and a.activation_id = new.current_activation_id
         and a.revision = new.current_activation_revision
         and a.policy_id = new.policy_id
         and a.policy_version = new.current_policy_version
         and (
           (tg_op = 'INSERT' and a.transition_kind = 'initial_reviewed_bootstrap')
           or (tg_op = 'UPDATE'
             and a.transition_kind = 'supersede_current'
             and a.prior_activation_id = old.current_activation_id
             and a.prior_activation_revision = old.current_activation_revision
             and a.prior_policy_version = old.current_policy_version)
         )
    ) then
      raise exception 'Policy activation head points to a different policy lineage'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_legal_hold_targets' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_legal_hold_revisions h
        join public.inbox_v2_data_governance_scope_manifest_roots s
          on s.tenant_id = h.tenant_id
         and s.manifest_id = h.scope_manifest_id
         and s.manifest_revision = h.scope_manifest_revision
         and s.storage_root_id = new.storage_root_id
         and s.root_record_id = new.root_record_id
       where h.tenant_id = new.tenant_id
         and h.hold_id = new.hold_id
         and h.revision = new.hold_revision
         and h.state = new.state
         and h.scope_manifest_id = new.scope_manifest_id
         and h.scope_manifest_revision = new.scope_manifest_revision
         and s.entity_type_id = new.entity_type_id
         and s.entity_id = new.entity_id
         and s.expected_entity_revision = new.expected_entity_revision
         and s.expected_lineage_revision = new.expected_lineage_revision
    ) then
      raise exception 'Legal-hold target is not an exact frozen scope member'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_legal_hold_heads' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_legal_hold_revisions h
       where h.tenant_id = new.tenant_id
         and h.hold_id = new.hold_id
         and h.revision = new.current_revision
         and h.state = new.state
    ) then
      raise exception 'Legal-hold head/revision state mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_restriction_heads' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_restriction_revisions r
       where r.tenant_id = new.tenant_id
         and r.restriction_id = new.restriction_id
         and r.revision = new.current_revision
         and r.state = new.state
    ) then
      raise exception 'Restriction head/revision state mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_privacy_request_heads' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_privacy_request_revisions r
       where r.tenant_id = new.tenant_id
         and r.request_id = new.request_id
         and r.revision = new.current_revision
         and r.state = new.current_state
    ) then
      raise exception 'Privacy-request head/revision state mismatch' using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_jobs' then
    if new.product_kind = 'tenant_deployment' and not exists (
      select 1
        from public.inbox_v2_data_governance_tenant_termination_scope_authorities tsa
        join public.inbox_v2_data_governance_scope_manifests sm
          on sm.tenant_id = tsa.tenant_id
         and sm.manifest_id = tsa.manifest_id
         and sm.revision = tsa.manifest_revision
        join public.inbox_v2_data_governance_policy_activation_heads ah
          on ah.tenant_id = tsa.tenant_id
         and ah.policy_id = tsa.policy_id
       where tsa.tenant_id = new.tenant_id
         and tsa.manifest_id = new.scope_manifest_id
         and tsa.manifest_revision = new.scope_manifest_revision
         and tsa.proof_hash = new.product_authority_hash
         and tsa.manifest_id = new.product_authority_id
         and tsa.manifest_revision = new.product_authority_revision
         and tsa.governance_context_id = new.governance_context_id
         and tsa.governance_context_version = new.governance_context_version
         and tsa.governance_context_hash = new.governance_context_hash
         and tsa.policy_id = new.policy_id
         and tsa.policy_version = new.policy_version
         and tsa.policy_hash = new.policy_hash
         and tsa.activation_id = new.activation_id
         and tsa.activation_revision = new.activation_revision
         and tsa.activation_hash = new.activation_hash
         and sm.registry_id = new.registry_id
         and sm.registry_revision = new.registry_revision
         and ah.current_policy_version = tsa.policy_version
         and ah.current_activation_id = tsa.activation_id
         and ah.current_activation_revision = tsa.activation_revision
    ) then
      raise exception 'Tenant deployment export job lacks exact current scope/policy authority'
        using errcode = '23514';
    end if;
    if new.product_kind <> 'tenant_deployment' and exists (
      select 1
        from public.inbox_v2_data_governance_tenant_termination_scope_authorities tsa
       where tsa.tenant_id = new.tenant_id
         and tsa.manifest_id = new.scope_manifest_id
         and tsa.manifest_revision = new.scope_manifest_revision
    ) then
      raise exception 'Non-tenant export cannot reuse tenant-termination scope authority'
        using errcode = '23514';
    end if;
    if new.export_manifest_id is not null and not exists (
      select 1 from public.inbox_v2_data_governance_export_manifests m
       where m.tenant_id = new.tenant_id
         and m.manifest_id = new.export_manifest_id
         and m.revision = new.export_manifest_revision
         and m.job_id = new.job_id
         and m.job_revision = new.revision
    ) then
      raise exception 'Export job references a manifest from another job/revision'
        using errcode = '23514';
    end if;
    if new.export_artifact_id is not null and not exists (
      select 1
        from public.inbox_v2_data_governance_export_artifact_heads h
        join public.inbox_v2_data_governance_export_artifacts ar
          on ar.tenant_id = h.tenant_id
         and ar.artifact_id = h.artifact_id
         and ar.revision = h.current_revision
         and ar.job_id = h.job_id
         and ar.job_revision = h.job_revision
         and ar.artifact_claim_key = h.artifact_claim_key
         and ar.state = h.current_state
       where h.tenant_id = new.tenant_id
         and h.artifact_id = new.export_artifact_id
         and h.current_revision = new.export_artifact_revision
         and h.job_id = new.job_id
         and h.job_revision = new.revision
         and (
           (new.state = 'running' and h.current_state = 'building')
           or (new.state = 'ready' and h.current_state = 'ready')
           or (new.state in ('revoked', 'expired', 'failed_retryable')
             and h.current_state in ('quarantined', 'deleted'))
           or (new.state = 'completed' and h.current_state = 'deleted')
         )
    ) then
      raise exception 'Export job does not bind its exact current artifact head'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_manifests' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_export_jobs j
        left join public.inbox_v2_data_governance_scope_manifests sm
          on sm.tenant_id = j.tenant_id
         and sm.manifest_id = j.scope_manifest_id
         and sm.revision = j.scope_manifest_revision
        left join public.inbox_v2_data_governance_tenant_termination_scope_authorities tsa
          on tsa.tenant_id = j.tenant_id
         and tsa.manifest_id = j.scope_manifest_id
         and tsa.manifest_revision = j.scope_manifest_revision
       where j.tenant_id = new.tenant_id
         and j.job_id = new.job_id
         and j.revision = new.job_revision
         and new.scope_proof_hash = j.product_authority_hash
         and (j.export_manifest_id is null or (
           j.export_manifest_id = new.manifest_id
           and j.export_manifest_revision = new.revision
         ))
         and (
           (j.product_kind = 'manager_report'
             and new.scope_manifest_id is null
             and new.scope_manifest_revision is null)
           or (j.product_kind = 'data_subject'
             and new.scope_manifest_id = j.scope_manifest_id
             and new.scope_manifest_revision = j.scope_manifest_revision
             and new.stream_epoch = sm.stream_epoch
             and new.sync_generation = sm.sync_generation
             and new.complete_through_position = sm.complete_through_position)
           or (j.product_kind = 'tenant_deployment'
             and new.scope_manifest_id = tsa.manifest_id
             and new.scope_manifest_revision = tsa.manifest_revision
             and new.scope_proof_hash = tsa.proof_hash
             and new.root_set_hash = tsa.export_root_set_hash
             and new.stream_epoch = sm.stream_epoch
             and new.sync_generation = sm.sync_generation
             and new.complete_through_position = sm.complete_through_position)
         )
    ) then
      raise exception 'Export manifest does not bind exact job scope/root/high-water authority'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_artifacts' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_export_jobs j
       where j.tenant_id = new.tenant_id
         and j.job_id = new.job_id
         and j.revision = new.job_revision
    ) then
      raise exception 'Export artifact crosses its job authority'
        using errcode = '23514';
    end if;
    if new.state = 'ready' and not exists (
      select 1
        from public.inbox_v2_data_governance_export_manifests m
        join public.inbox_v2_data_governance_export_jobs j
          on j.tenant_id = m.tenant_id
         and j.job_id = m.job_id
         and j.revision = m.job_revision
       where m.tenant_id = new.tenant_id
         and m.manifest_id = new.manifest_id
         and m.revision = new.manifest_revision
         and m.manifest_hash = new.manifest_hash
         and m.job_id = new.job_id
         and m.job_revision = new.job_revision
         and (j.export_manifest_id is null or (
           j.export_manifest_id = m.manifest_id
           and j.export_manifest_revision = m.revision
         ))
    ) then
      raise exception 'Ready export artifact is not bound to its exact manifest hash'
        using errcode = '23514';
    end if;
    if (new.revision = 1 and new.state <> 'building')
       or (new.revision > 1 and not exists (
         select 1 from public.inbox_v2_data_governance_export_artifacts prior
          where prior.tenant_id = new.tenant_id
            and prior.artifact_id = new.artifact_id
            and prior.revision = new.revision - 1
            and prior.job_id = new.job_id
            and prior.job_revision = new.job_revision
            and prior.artifact_claim_key = new.artifact_claim_key
            and new.recorded_at > prior.recorded_at
            and (
              (prior.state = 'building' and new.state in ('ready', 'quarantined', 'deleted'))
              or (prior.state = 'ready' and new.state in ('quarantined', 'deleted'))
              or (prior.state = 'quarantined' and new.state = 'deleted')
            )
       )) then
      raise exception 'Export artifact revision uses a gap, changed authority or illegal edge'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_artifact_heads' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_export_artifacts ar
       where ar.tenant_id = new.tenant_id
         and ar.artifact_id = new.artifact_id
         and ar.revision = new.current_revision
         and ar.job_id = new.job_id
         and ar.job_revision = new.job_revision
         and ar.artifact_claim_key = new.artifact_claim_key
         and ar.state = new.current_state
    ) then
      raise exception 'Export artifact head points to a different immutable revision'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_claims' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_export_manifests m
        join public.inbox_v2_data_governance_export_artifact_heads h
          on h.tenant_id = m.tenant_id
         and h.job_id = m.job_id
         and h.job_revision = m.job_revision
         and h.artifact_claim_key = new.artifact_claim_key
        join public.inbox_v2_data_governance_export_artifacts ar
          on ar.tenant_id = h.tenant_id
         and ar.artifact_id = h.artifact_id
         and ar.revision = h.current_revision
         and ar.job_id = h.job_id
         and ar.job_revision = h.job_revision
         and ar.artifact_claim_key = h.artifact_claim_key
         and ar.state = h.current_state
       where m.tenant_id = new.tenant_id
         and m.manifest_id = new.manifest_id
         and m.revision = new.manifest_revision
         and m.job_id = new.job_id
         and m.job_revision = new.job_revision
         and h.current_state = 'ready'
         and ar.state = 'ready'
         and ar.manifest_id = m.manifest_id
         and ar.manifest_revision = m.revision
         and ar.manifest_hash = m.manifest_hash
         and ar.payload_checksum is not null
         and ar.packaging_proof_hash = new.packaging_proof_hash
         and ar.archive_composition_hash = new.archive_composition_hash
         and ar.ready_at <= new.created_at
         and ar.expires_at > new.created_at
         and ar.deleted_at is null
    ) then
      raise exception 'Export claim mixes job and export-manifest lineages'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_export_receipt_cas' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_export_claims c
       where c.tenant_id = new.tenant_id
         and c.artifact_claim_key = new.artifact_claim_key
         and c.receipt_key = new.receipt_key
         and c.principal_key = new.principal_key
         and c.claim_revision = new.claim_revision
         and c.job_id = new.job_id
         and c.job_revision = new.job_revision
         and c.manifest_id = new.manifest_id
         and c.manifest_revision = new.manifest_revision
         and c.packaging_proof_hash = new.packaging_proof_hash
         and c.archive_composition_hash = new.archive_composition_hash
         and c.issued_receipt_hash = new.issued_receipt_hash
    ) then
      raise exception 'Receipt CAS lineage differs from its immutable claim'
        using errcode = '23514';
    end if;
    if new.state in ('issued', 'consumed') and not exists (
      select 1
        from public.inbox_v2_data_governance_export_artifact_heads h
        join public.inbox_v2_data_governance_export_artifacts ar
          on ar.tenant_id = h.tenant_id
         and ar.artifact_id = h.artifact_id
         and ar.revision = h.current_revision
         and ar.job_id = h.job_id
         and ar.job_revision = h.job_revision
         and ar.artifact_claim_key = h.artifact_claim_key
         and ar.state = h.current_state
        join public.inbox_v2_data_governance_export_jobs j
          on j.tenant_id = h.tenant_id
         and j.job_id = h.job_id
         and j.revision = h.job_revision
         and j.export_artifact_id = h.artifact_id
         and j.export_artifact_revision = h.current_revision
       where h.tenant_id = new.tenant_id
         and h.artifact_claim_key = new.artifact_claim_key
         and h.current_state = 'ready'
         and j.job_id = new.job_id
         and j.revision = new.job_revision
         and j.state = 'ready'
         and j.export_manifest_id = new.manifest_id
         and j.export_manifest_revision = new.manifest_revision
         and ar.manifest_id = new.manifest_id
         and ar.manifest_revision = new.manifest_revision
         and ar.payload_checksum is not null
         and ar.packaging_proof_hash = new.packaging_proof_hash
         and ar.archive_composition_hash = new.archive_composition_hash
         and ar.ready_at <= new.updated_at
         and ar.expires_at > new.updated_at
         and ar.deleted_at is null
    ) then
      raise exception 'Receipt issue/consume requires the exact current ready artifact head'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_deletion_run_terminal_exports' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_deletion_runs dr
        join public.inbox_v2_data_governance_deletion_plans p
          on p.tenant_id = dr.tenant_id
         and p.plan_id = dr.plan_id
         and p.revision = dr.plan_revision
        join public.inbox_v2_data_governance_export_jobs j
          on j.tenant_id = dr.tenant_id
         and j.job_id = new.job_id
         and j.revision = new.job_revision
        join public.inbox_v2_data_governance_export_manifests m
          on m.tenant_id = j.tenant_id
         and m.manifest_id = new.manifest_id
         and m.revision = new.manifest_revision
         and m.job_id = j.job_id
         and m.job_revision = j.revision
        join public.inbox_v2_data_governance_export_artifact_heads h
          on h.tenant_id = j.tenant_id
         and h.artifact_id = new.artifact_id
         and h.job_id = j.job_id
         and h.job_revision = j.revision
        join public.inbox_v2_data_governance_export_artifacts ar
          on ar.tenant_id = h.tenant_id
         and ar.artifact_id = h.artifact_id
         and ar.revision = new.artifact_revision
         and ar.job_id = h.job_id
         and ar.job_revision = h.job_revision
         and ar.artifact_claim_key = h.artifact_claim_key
        join public.inbox_v2_data_governance_scope_manifests sm
          on sm.tenant_id = p.tenant_id
         and sm.manifest_id = p.manifest_id
         and sm.revision = p.manifest_revision
        join public.inbox_v2_data_governance_tenant_termination_scope_authorities tsa
          on tsa.tenant_id = sm.tenant_id
         and tsa.manifest_id = sm.manifest_id
         and tsa.manifest_revision = sm.revision
        join public.inbox_v2_data_governance_policy_activation_heads ah
          on ah.tenant_id = p.tenant_id
         and ah.policy_id = p.policy_id
       where dr.tenant_id = new.tenant_id
         and dr.run_id = new.run_id
         and dr.revision = new.run_revision
         and new.bound_at >= dr.started_at
         and new.bound_at <= clock_timestamp()
         and p.cause = 'tenant_offboarding'
         and j.product_kind = 'tenant_deployment'
         and j.state = 'ready'
         and j.product_authority_id = tsa.manifest_id
         and j.product_authority_revision = tsa.manifest_revision
         and j.product_authority_hash = tsa.proof_hash
         and j.scope_manifest_id = p.manifest_id
         and j.scope_manifest_revision = p.manifest_revision
         and j.registry_id = p.registry_id
         and j.registry_revision = p.registry_revision
         and j.governance_context_id = p.governance_context_id
         and j.governance_context_version = p.governance_context_version
         and j.governance_context_hash = p.governance_context_hash
         and j.policy_id = p.policy_id
         and j.policy_version = p.policy_version
         and j.policy_hash = p.policy_hash
         and j.activation_id = p.activation_id
         and j.activation_revision = p.activation_revision
         and j.activation_hash = p.activation_hash
         and j.export_manifest_id = m.manifest_id
         and j.export_manifest_revision = m.revision
         and j.export_artifact_id = h.artifact_id
         and j.export_artifact_revision = h.current_revision
         and m.scope_manifest_id = sm.manifest_id
         and m.scope_manifest_revision = sm.revision
         and m.scope_proof_hash = tsa.proof_hash
         and m.root_set_hash = tsa.export_root_set_hash
         and m.stream_epoch = p.stream_epoch
         and m.sync_generation = p.sync_generation
         and m.complete_through_position = p.complete_through_position
         and m.stream_epoch = sm.stream_epoch
         and m.sync_generation = sm.sync_generation
         and m.complete_through_position = sm.complete_through_position
         and tsa.registry_composition_hash = p.registry_composition_hash
         and tsa.governance_context_id = p.governance_context_id
         and tsa.governance_context_version = p.governance_context_version
         and tsa.governance_context_hash = p.governance_context_hash
         and tsa.policy_id = p.policy_id
         and tsa.policy_version = p.policy_version
         and tsa.policy_hash = p.policy_hash
         and tsa.activation_id = p.activation_id
         and tsa.activation_revision = p.activation_revision
         and tsa.activation_hash = p.activation_hash
         and ah.current_policy_version = p.policy_version
         and ah.current_activation_id = p.activation_id
         and ah.current_activation_revision = p.activation_revision
         and h.current_revision = ar.revision
         and h.current_state = 'ready'
         and ar.state = 'ready'
         and ar.manifest_id = m.manifest_id
         and ar.manifest_revision = m.revision
         and ar.manifest_hash = m.manifest_hash
         and ar.payload_checksum is not null
         and ar.payload_locator is not null
         and ar.ready_at <= new.bound_at
         and ar.expires_at > new.bound_at
         and ar.expires_at > clock_timestamp()
         and ar.deleted_at is null
    ) then
      raise exception 'Deletion run terminal export is not exact, current, ready or unexpired'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_deletion_plans' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_registry_versions rv
        join public.inbox_v2_data_governance_scope_manifests sm
          on sm.registry_id = rv.id and sm.registry_revision = rv.revision
        join public.inbox_v2_data_governance_contexts c
          on c.tenant_id = new.tenant_id
         and c.context_id = new.governance_context_id
         and c.version = new.governance_context_version
        join public.inbox_v2_data_governance_effective_policies p
          on p.tenant_id = new.tenant_id
         and p.policy_id = new.policy_id
         and p.version = new.policy_version
        join public.inbox_v2_data_governance_policy_activations a
          on a.tenant_id = new.tenant_id
         and a.activation_id = new.activation_id
         and a.revision = new.activation_revision
       where rv.id = new.registry_id
         and rv.revision = new.registry_revision
         and rv.composition_hash = new.registry_composition_hash
         and sm.tenant_id = new.tenant_id
         and sm.manifest_id = new.manifest_id
         and sm.revision = new.manifest_revision
         and sm.stream_epoch = new.stream_epoch
         and sm.sync_generation = new.sync_generation
         and sm.complete_through_position = new.complete_through_position
         and c.context_hash = new.governance_context_hash
         and c.registry_id = rv.id and c.registry_revision = rv.revision
         and p.policy_hash = new.policy_hash
         and p.registry_id = rv.id and p.registry_revision = rv.revision
         and p.governance_context_id = c.context_id
         and p.governance_context_version = c.version
         and a.activation_hash = new.activation_hash
         and a.policy_id = p.policy_id and a.policy_version = p.version
         and a.governance_context_id = c.context_id
         and a.governance_context_version = c.version
         and (
           new.request_id is null
           or exists (
             select 1 from public.inbox_v2_data_governance_privacy_request_revisions pr
              where pr.tenant_id = new.tenant_id
                and pr.request_id = new.request_id
                and pr.revision = new.request_revision
                and new.decision_basis_id = pr.request_id
                and new.decision_basis_hash = pr.decision_hash
                and pr.policy_id = p.policy_id and pr.policy_version = p.version
                and pr.governance_context_id = c.context_id
                and pr.governance_context_version = c.version
           )
         )
    ) then
      raise exception 'Deletion plan authority, manifest or decision lineage is incoherent'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_destructive_checkpoint_leases' then
    if not exists (
      select 1
        from public.inbox_v2_data_governance_deletion_checkpoint_requirements q
        join public.inbox_v2_data_governance_deletion_plans p
          on p.tenant_id = q.tenant_id and p.plan_id = q.plan_id
         and p.revision = q.plan_revision
        join public.inbox_v2_data_governance_policy_activation_heads ah
          on ah.tenant_id = p.tenant_id and ah.policy_id = p.policy_id
         and ah.current_policy_version = p.policy_version
         and ah.current_activation_id = p.activation_id
         and ah.current_activation_revision = p.activation_revision
        join public.inbox_v2_data_governance_control_set_heads cs
          on cs.tenant_id = p.tenant_id
         and cs.legal_hold_set_revision = p.legal_hold_set_revision
         and cs.restriction_set_revision = p.restriction_set_revision
       where q.tenant_id = new.tenant_id
         and q.plan_id = new.plan_id and q.plan_revision = new.plan_revision
         and q.checkpoint_id = new.checkpoint_id
         and q.requirement_hash = new.requirement_hash
         and q.surface = new.surface
         and q.registry_id = new.registry_id
         and q.registry_revision = new.registry_revision
         and p.registry_composition_hash = new.registry_composition_hash
         and q.storage_root_id = new.storage_root_id
         and q.data_class_id = new.data_class_id
         and q.root_record_id = new.root_record_id
         and q.entity_type_id = new.entity_type_id
         and q.entity_id = new.entity_id
         and q.expected_entity_revision = new.expected_entity_revision
         and q.expected_lineage_revision = new.expected_lineage_revision
         and p.governance_context_id = new.governance_context_id
         and p.governance_context_version = new.governance_context_version
         and p.governance_context_hash = new.governance_context_hash
         and p.policy_id = new.policy_id and p.policy_version = new.policy_version
         and p.policy_hash = new.policy_hash
         and p.activation_id = new.activation_id
         and p.activation_revision = new.activation_revision
         and p.activation_hash = new.activation_hash
         and p.legal_hold_set_revision = new.legal_hold_set_revision
         and p.restriction_set_revision = new.restriction_set_revision
         and ((q.surface = 'operated' and q.delete_handler_id = new.execution_handler_id)
           or (q.surface = 'backup' and q.expiry_ledger_handler_id = new.execution_handler_id)
           or (q.surface = 'external' and q.external_delete_handler_id = new.execution_handler_id))
         and not exists (
           select 1
             from public.inbox_v2_data_governance_legal_hold_targets ht
             join public.inbox_v2_data_governance_legal_hold_heads hh
               on hh.tenant_id = ht.tenant_id and hh.hold_id = ht.hold_id
              and hh.current_revision = ht.hold_revision and hh.state = 'active'
            where ht.tenant_id = q.tenant_id
              and ht.storage_root_id = q.storage_root_id
              and ht.root_record_id = q.root_record_id
              and ht.entity_type_id = q.entity_type_id
              and ht.entity_id = q.entity_id
              and ht.state = 'active'
         )
         and (
           p.cause <> 'tenant_offboarding'
           or exists (
             select 1
               from public.inbox_v2_data_governance_deletion_run_terminal_exports binding
               join public.inbox_v2_data_governance_export_jobs export_job
                 on export_job.tenant_id = binding.tenant_id
                and export_job.job_id = binding.job_id
                and export_job.revision = binding.job_revision
                and export_job.state = 'ready'
                and export_job.product_kind = 'tenant_deployment'
                and export_job.export_manifest_id = binding.manifest_id
                and export_job.export_manifest_revision = binding.manifest_revision
                and export_job.export_artifact_id = binding.artifact_id
                and export_job.export_artifact_revision = binding.artifact_revision
               join public.inbox_v2_data_governance_export_artifact_heads artifact_head
                 on artifact_head.tenant_id = binding.tenant_id
                and artifact_head.artifact_id = binding.artifact_id
                and artifact_head.job_id = binding.job_id
                and artifact_head.job_revision = binding.job_revision
                and artifact_head.current_revision = binding.artifact_revision
                and artifact_head.current_state = 'ready'
               join public.inbox_v2_data_governance_export_artifacts artifact
                 on artifact.tenant_id = artifact_head.tenant_id
                and artifact.artifact_id = artifact_head.artifact_id
                and artifact.revision = artifact_head.current_revision
                and artifact.job_id = artifact_head.job_id
                and artifact.job_revision = artifact_head.job_revision
                and artifact.artifact_claim_key = artifact_head.artifact_claim_key
                and artifact.state = 'ready'
                and artifact.manifest_id = binding.manifest_id
                and artifact.manifest_revision = binding.manifest_revision
              where binding.tenant_id = new.tenant_id
                and binding.run_id = new.run_id
                and binding.run_revision = new.run_revision
                and binding.bound_at <= new.claimed_at
                and artifact.ready_at <= new.claimed_at
                and artifact.expires_at > new.claimed_at
                and artifact.expires_at >= new.lease_expires_at
                and artifact.payload_locator is not null
                and artifact.payload_checksum is not null
           )
         )
    ) then
      raise exception 'Destructive lease uses stale or substituted authority'
        using errcode = '23514';
    end if;
  elsif tg_table_name = 'inbox_v2_data_governance_deletion_checkpoint_requirements' then
    if not exists (
      select 1 from public.inbox_v2_data_governance_storage_roots r
       where r.registry_id = new.registry_id
         and r.registry_revision = new.registry_revision
         and r.storage_root_id = new.storage_root_id
         and r.kind = new.root_kind
         and r.boundary = new.boundary
    ) then
      raise exception 'Checkpoint requirement root kind/boundary mismatch'
        using errcode = '23514';
    end if;
    if (new.surface = 'operated' and not (
          exists (select 1 from public.inbox_v2_data_governance_lifecycle_handlers h where h.registry_id = new.registry_id and h.registry_revision = new.registry_revision and h.handler_id = new.delete_handler_id and h.kind = 'delete_execution')
      and exists (select 1 from public.inbox_v2_data_governance_lifecycle_handlers h where h.registry_id = new.registry_id and h.registry_revision = new.registry_revision and h.handler_id = new.verification_handler_id and h.kind = 'verification')
       )) or (new.surface = 'backup' and not (
          exists (select 1 from public.inbox_v2_data_governance_lifecycle_handlers h where h.registry_id = new.registry_id and h.registry_revision = new.registry_revision and h.handler_id = new.verification_handler_id and h.kind = 'verification')
      and exists (select 1 from public.inbox_v2_data_governance_lifecycle_handlers h where h.registry_id = new.registry_id and h.registry_revision = new.registry_revision and h.handler_id = new.expiry_ledger_handler_id and h.kind = 'backup_expiry_ledger')
       )) or (new.surface = 'external' and not exists (
          select 1 from public.inbox_v2_data_governance_lifecycle_handlers h
           where h.registry_id = new.registry_id
             and h.registry_revision = new.registry_revision
             and h.handler_id = new.external_delete_handler_id
             and h.kind = 'external_deletion'
       )) then
      raise exception 'Checkpoint requirement uses a handler of the wrong kind'
        using errcode = '23514';
    end if;
  end if;
  return null;
end
$function$;

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_data_governance_scope_manifest_roots',
    'inbox_v2_data_governance_tenant_termination_scope_authorities',
    'inbox_v2_data_governance_subject_links',
    'inbox_v2_data_governance_policy_activations',
    'inbox_v2_data_governance_policy_activation_heads',
    'inbox_v2_data_governance_legal_hold_targets',
    'inbox_v2_data_governance_legal_hold_heads',
    'inbox_v2_data_governance_restriction_heads',
    'inbox_v2_data_governance_privacy_request_heads',
    'inbox_v2_data_governance_export_jobs',
    'inbox_v2_data_governance_export_manifests',
    'inbox_v2_data_governance_export_artifacts',
    'inbox_v2_data_governance_export_artifact_heads',
    'inbox_v2_data_governance_export_claims',
    'inbox_v2_data_governance_export_receipt_cas',
    'inbox_v2_data_governance_deletion_run_terminal_exports',
    'inbox_v2_data_governance_deletion_plans',
    'inbox_v2_data_governance_destructive_checkpoint_leases',
    'inbox_v2_data_governance_deletion_checkpoint_requirements'
  ]
  loop
    v_trigger := 'inbox_v2_dg_coherence_' || substr(md5(v_table), 1, 16);
    execute format(
      'create constraint trigger %I after insert or update on public.%I deferrable initially deferred for each row execute function public.inbox_v2_dg_governance_coherence()',
      v_trigger,
      v_table
    );
  end loop;
end
$block$;
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_deletion_run_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_stage_one_committed_at timestamptz;
begin
  if tg_op = 'DELETE' then
    raise exception 'Deletion runs cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.state_revision <> 1
       or new.state <> 'executing'
       or new.result is not null
       or new.stage_one_state <> 'pending'
       or new.stage_one_committed_at is not null
       or new.primary_absence_verified
       or new.has_internal_residual
       or new.has_external_residual
       or new.has_backup_expiry_pending
       or new.backup_latest_possible_expiry_at is not null
       or new.completed_checkpoint_count <> 0
       or new.completed_at is not null
       or not exists (
         select 1
           from (
             select count(*) filter (where requirement.surface = 'operated') as operated_count,
                    count(*) filter (where requirement.surface = 'backup') as backup_count,
                    count(*) filter (where requirement.surface = 'external') as external_count
               from public.inbox_v2_data_governance_deletion_checkpoint_requirements requirement
              where requirement.tenant_id = new.tenant_id
                and requirement.plan_id = new.plan_id
                and requirement.plan_revision = new.plan_revision
           ) frozen
          where frozen.operated_count = new.operated_checkpoint_count
            and frozen.backup_count = new.backup_checkpoint_count
            and frozen.external_count = new.external_checkpoint_count
            and frozen.operated_count >= 1
       ) then
      raise exception 'Deletion run must start at the exact frozen checkpoint set'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.run_id is distinct from old.run_id
     or new.revision is distinct from old.revision
     or new.plan_id is distinct from old.plan_id
     or new.plan_revision is distinct from old.plan_revision
     or new.operated_checkpoint_count is distinct from old.operated_checkpoint_count
     or new.backup_checkpoint_count is distinct from old.backup_checkpoint_count
     or new.external_checkpoint_count is distinct from old.external_checkpoint_count
     or new.started_at is distinct from old.started_at then
    raise exception 'Deletion run identity, plan, start, and frozen checkpoint totals are immutable'
      using errcode = '23514';
  end if;

  if old.state = 'terminal' then
    raise exception 'Terminal deletion runs are immutable' using errcode = '23514';
  end if;
  if new.state_revision <> old.state_revision + 1 then
    raise exception 'Deletion run state_revision must advance by exactly one'
      using errcode = '40001';
  end if;
  if new.updated_at <= old.updated_at then
    raise exception 'Deletion run updated_at must advance monotonically'
      using errcode = '23514';
  end if;
  if not (
    (old.state = 'executing' and new.state in ('executing', 'verification_pending'))
    or (old.state = 'verification_pending' and new.state in ('verification_pending', 'terminal'))
  ) then
    raise exception 'Invalid deletion run state transition' using errcode = '23514';
  end if;
  if old.stage_one_state = 'content_unavailable'
     and (new.stage_one_state <> 'content_unavailable'
       or new.stage_one_committed_at is distinct from old.stage_one_committed_at) then
    raise exception 'Deletion stage one cannot be reopened or rewritten'
      using errcode = '23514';
  end if;
  if new.completed_checkpoint_count < old.completed_checkpoint_count then
    raise exception 'Deletion completed checkpoint count cannot regress'
      using errcode = '23514';
  end if;
  if new.stage_one_state = 'pending'
     and (new.state <> 'executing'
       or new.completed_checkpoint_count <> 0
       or new.primary_absence_verified
       or new.has_internal_residual
       or new.has_external_residual
       or new.has_backup_expiry_pending
       or new.backup_latest_possible_expiry_at is not null) then
    raise exception 'Pending deletion stage one cannot report destructive checkpoint aggregates'
      using errcode = '23514';
  end if;
  if old.stage_one_state = 'pending'
     and new.stage_one_state = 'content_unavailable'
     and (new.completed_checkpoint_count <> 0
       or new.primary_absence_verified
       or new.has_internal_residual
       or new.has_external_residual
       or new.has_backup_expiry_pending
       or new.backup_latest_possible_expiry_at is not null
       or new.result is not null
       or new.completed_at is not null) then
    raise exception 'Stage-one commit cannot report destructive checkpoint outcomes before lease execution'
      using errcode = '23514';
  end if;

  if new.stage_one_state = 'content_unavailable' then
    select max(target.committed_at)
      into v_stage_one_committed_at
      from public.inbox_v2_data_governance_deletion_stage_one_targets target
     where target.tenant_id = new.tenant_id
       and target.run_id = new.run_id
       and target.run_revision = new.revision;

    if v_stage_one_committed_at is null
       or new.stage_one_committed_at is distinct from v_stage_one_committed_at
       or new.stage_one_committed_at > new.updated_at
       or exists (
         select 1
           from public.inbox_v2_data_governance_deletion_checkpoint_requirements requirement
          where requirement.tenant_id = new.tenant_id
            and requirement.plan_id = new.plan_id
            and requirement.plan_revision = new.plan_revision
            and requirement.surface = 'operated'
            and not exists (
              select 1
                from public.inbox_v2_data_governance_deletion_stage_one_targets target
               where target.tenant_id = new.tenant_id
                 and target.run_id = new.run_id
                 and target.run_revision = new.revision
                 and target.plan_id = new.plan_id
                 and target.plan_revision = new.plan_revision
                 and target.checkpoint_id = requirement.checkpoint_id
                 and target.requirement_hash = requirement.requirement_hash
                 and target.storage_root_id = requirement.storage_root_id
                 and target.data_class_id = requirement.data_class_id
                 and target.root_record_id = requirement.root_record_id
                 and target.entity_type_id = requirement.entity_type_id
                 and target.entity_id = requirement.entity_id
                 and target.expected_revision = requirement.expected_entity_revision
                 and target.resulting_revision > requirement.expected_entity_revision
            )
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_deletion_stage_one_targets target
          where target.tenant_id = new.tenant_id
            and target.run_id = new.run_id
            and target.run_revision = new.revision
            and not exists (
              select 1
                from public.inbox_v2_data_governance_deletion_checkpoint_requirements requirement
               where requirement.tenant_id = target.tenant_id
                 and requirement.plan_id = target.plan_id
                 and requirement.plan_revision = target.plan_revision
                 and requirement.checkpoint_id = target.checkpoint_id
                 and requirement.surface = 'operated'
                 and requirement.requirement_hash = target.requirement_hash
                 and requirement.storage_root_id = target.storage_root_id
                 and requirement.data_class_id = target.data_class_id
                 and requirement.root_record_id = target.root_record_id
                 and requirement.entity_type_id = target.entity_type_id
                 and requirement.entity_id = target.entity_id
                 and requirement.expected_entity_revision = target.expected_revision
            )
       ) then
      raise exception 'Deletion stage one requires the exact relational operated-checkpoint proof set'
        using errcode = '23514';
    end if;
  end if;
  if new.state <> 'executing' and new.stage_one_state <> 'content_unavailable' then
    raise exception 'Deletion verification cannot start before exact stage-one commit'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create trigger inbox_v2_dg_deletion_run_transition_guard_trigger
before insert or update or delete on public.inbox_v2_data_governance_deletion_runs
for each row execute function public.inbox_v2_dg_deletion_run_transition_guard();

create or replace function public.inbox_v2_dg_deletion_stage_one_target_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
      from public.inbox_v2_data_governance_deletion_runs run_row
      join public.inbox_v2_data_governance_deletion_checkpoint_requirements requirement
        on requirement.tenant_id = run_row.tenant_id
       and requirement.plan_id = run_row.plan_id
       and requirement.plan_revision = run_row.plan_revision
       and requirement.checkpoint_id = new.checkpoint_id
     where run_row.tenant_id = new.tenant_id
       and run_row.run_id = new.run_id
       and run_row.revision = new.run_revision
       and run_row.plan_id = new.plan_id
       and run_row.plan_revision = new.plan_revision
       and run_row.state = 'executing'
       and run_row.stage_one_state = 'pending'
       and requirement.surface = 'operated'
       and requirement.requirement_hash = new.requirement_hash
       and requirement.storage_root_id = new.storage_root_id
       and requirement.data_class_id = new.data_class_id
       and requirement.root_record_id = new.root_record_id
       and requirement.entity_type_id = new.entity_type_id
       and requirement.entity_id = new.entity_id
       and requirement.expected_entity_revision = new.expected_revision
       and new.resulting_revision > requirement.expected_entity_revision
       and new.committed_at >= run_row.started_at
       and new.committed_at <= clock_timestamp()
  ) then
    raise exception 'Stage-one target does not match an exact pending operated checkpoint'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create trigger inbox_v2_dg_deletion_stage_one_target_coherence_trigger
after insert on public.inbox_v2_data_governance_deletion_stage_one_targets
for each row execute function public.inbox_v2_dg_deletion_stage_one_target_coherence();

create or replace function public.inbox_v2_dg_deletion_terminal_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_total bigint;
  v_operated bigint;
  v_backup bigint;
  v_external bigint;
  v_retryable boolean;
  v_internal_residual boolean;
  v_external_residual boolean;
  v_backup_pending boolean;
  v_primary_verified boolean;
  v_latest_backup_expiry timestamptz;
  v_expected_result text;
begin
  if new.state <> 'terminal' then
    return null;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_deletion_plans p
      join public.inbox_v2_data_governance_control_set_heads c
        on c.tenant_id = p.tenant_id
       and c.legal_hold_set_revision = p.legal_hold_set_revision
       and c.restriction_set_revision = p.restriction_set_revision
      join public.inbox_v2_data_governance_policy_activation_heads ah
        on ah.tenant_id = p.tenant_id and ah.policy_id = p.policy_id
       and ah.current_policy_version = p.policy_version
       and ah.current_activation_id = p.activation_id
       and ah.current_activation_revision = p.activation_revision
     where p.tenant_id = new.tenant_id
       and p.plan_id = new.plan_id
       and p.revision = new.plan_revision
       and p.earliest_execution_at <= new.started_at
  ) then
    raise exception 'Deletion run authority/control-set is stale at terminalization'
      using errcode = '23514';
  end if;

  select count(*),
         count(*) filter (where q.surface = 'operated'),
         count(*) filter (where q.surface = 'backup'),
         count(*) filter (where q.surface = 'external')
    into v_total, v_operated, v_backup, v_external
    from public.inbox_v2_data_governance_deletion_checkpoint_requirements q
   where q.tenant_id = new.tenant_id
     and q.plan_id = new.plan_id
     and q.plan_revision = new.plan_revision;

  if v_total <> new.completed_checkpoint_count
     or v_operated <> new.operated_checkpoint_count
     or v_backup <> new.backup_checkpoint_count
     or v_external <> new.external_checkpoint_count then
    raise exception 'Terminal deletion counts differ from the frozen checkpoint set'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_data_governance_deletion_checkpoint_requirements q
     where q.tenant_id = new.tenant_id
       and q.plan_id = new.plan_id
       and q.plan_revision = new.plan_revision
       and (
         (q.surface = 'operated' and not exists (
           select 1
             from public.inbox_v2_data_governance_operated_checkpoint_heads h
             join public.inbox_v2_data_governance_operated_checkpoint_attempts a
               on a.tenant_id = h.tenant_id
              and a.run_id = h.run_id
              and a.run_revision = h.run_revision
              and a.checkpoint_id = h.checkpoint_id
              and a.attempt = h.current_attempt
            where h.tenant_id = new.tenant_id
              and h.run_id = new.run_id
              and h.run_revision = new.revision
              and h.checkpoint_id = q.checkpoint_id
              and h.current_outcome = a.outcome
         )) or
         (q.surface = 'backup' and not exists (
           select 1
             from public.inbox_v2_data_governance_backup_checkpoint_heads h
             join public.inbox_v2_data_governance_backup_checkpoint_attempts a
               on a.tenant_id = h.tenant_id
              and a.run_id = h.run_id
              and a.run_revision = h.run_revision
              and a.checkpoint_id = h.checkpoint_id
              and a.attempt = h.current_attempt
            where h.tenant_id = new.tenant_id
              and h.run_id = new.run_id
              and h.run_revision = new.revision
              and h.checkpoint_id = q.checkpoint_id
              and h.current_outcome = a.outcome
         )) or
         (q.surface = 'external' and not exists (
           select 1
             from public.inbox_v2_data_governance_external_checkpoint_heads h
             join public.inbox_v2_data_governance_external_checkpoint_attempts a
               on a.tenant_id = h.tenant_id
              and a.run_id = h.run_id
              and a.run_revision = h.run_revision
              and a.checkpoint_id = h.checkpoint_id
              and a.attempt = h.current_attempt
            where h.tenant_id = new.tenant_id
              and h.run_id = new.run_id
              and h.run_revision = new.revision
              and h.checkpoint_id = q.checkpoint_id
              and h.current_outcome = a.outcome
         ))
       )
  ) then
    raise exception 'Terminal deletion run is missing an exact current checkpoint attempt'
      using errcode = '23514';
  end if;

  select
    exists (
      select 1 from public.inbox_v2_data_governance_operated_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome in ('failed_retryable', 'blocked_by_legal_hold', 'stale_revision')
    ) or exists (
      select 1 from public.inbox_v2_data_governance_backup_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome in ('failed_retryable', 'blocked_by_legal_hold', 'stale_revision')
    ) or exists (
      select 1 from public.inbox_v2_data_governance_external_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome in ('requested', 'failed_retryable', 'blocked_by_legal_hold', 'stale_revision')
    ),
    exists (
      select 1 from public.inbox_v2_data_governance_operated_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome = 'unverified_terminal'
    ) or exists (
      select 1 from public.inbox_v2_data_governance_backup_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome = 'unverified_terminal'
    ),
    exists (
      select 1 from public.inbox_v2_data_governance_external_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome in ('unsupported', 'unknown')
    ),
    exists (
      select 1 from public.inbox_v2_data_governance_backup_checkpoint_heads h
       where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
         and h.current_outcome = 'finite_expiry_pending'
    )
  into v_retryable, v_internal_residual, v_external_residual, v_backup_pending;

  select not exists (
    select 1
      from public.inbox_v2_data_governance_operated_checkpoint_heads h
     where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
       and h.current_outcome <> 'verified_absent'
  ) and not exists (
    select 1
      from public.inbox_v2_data_governance_backup_checkpoint_heads h
      join public.inbox_v2_data_governance_backup_checkpoint_attempts a
        on a.tenant_id = h.tenant_id and a.run_id = h.run_id
       and a.run_revision = h.run_revision and a.checkpoint_id = h.checkpoint_id
       and a.attempt = h.current_attempt
     where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision
       and not a.primary_absence_verified
  ), max(a.latest_possible_expiry_at) filter (where h.current_outcome = 'finite_expiry_pending')
  into v_primary_verified, v_latest_backup_expiry
  from public.inbox_v2_data_governance_backup_checkpoint_heads h
  left join public.inbox_v2_data_governance_backup_checkpoint_attempts a
    on a.tenant_id = h.tenant_id and a.run_id = h.run_id
   and a.run_revision = h.run_revision and a.checkpoint_id = h.checkpoint_id
   and a.attempt = h.current_attempt
  where h.tenant_id = new.tenant_id and h.run_id = new.run_id and h.run_revision = new.revision;

  if exists (
    select 1
      from public.inbox_v2_data_governance_deletion_checkpoint_requirements q
      join public.inbox_v2_data_governance_legal_hold_targets ht
        on ht.tenant_id = q.tenant_id
       and ht.storage_root_id = q.storage_root_id
       and ht.root_record_id = q.root_record_id
       and ht.entity_type_id = q.entity_type_id
       and ht.entity_id = q.entity_id
      join public.inbox_v2_data_governance_legal_hold_heads hh
        on hh.tenant_id = ht.tenant_id and hh.hold_id = ht.hold_id
       and hh.current_revision = ht.hold_revision and hh.state = 'active'
     where q.tenant_id = new.tenant_id
       and q.plan_id = new.plan_id
       and q.plan_revision = new.plan_revision
       and ht.state = 'active'
  ) then
    raise exception 'Terminal deletion run intersects an active current legal hold'
      using errcode = '23514';
  end if;

  v_expected_result := case
    when v_retryable then 'failed_retryable'
    when v_internal_residual then 'verification_blocked_internal_residual'
    when v_backup_pending then 'primary_purged_backup_expiry_pending'
    when v_external_residual then 'completed_with_external_residuals'
    else 'completed'
  end;

  if new.result::text <> v_expected_result
     or new.primary_absence_verified <> v_primary_verified
     or new.has_internal_residual <> v_internal_residual
     or new.has_external_residual <> v_external_residual
     or new.has_backup_expiry_pending <> v_backup_pending
     or new.backup_latest_possible_expiry_at is distinct from v_latest_backup_expiry then
    raise exception 'Terminal deletion result does not match exact checkpoint outcomes'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_dg_deletion_terminal_coherence_constraint
after insert or update on public.inbox_v2_data_governance_deletion_runs
deferrable initially deferred
for each row when (new.state = 'terminal')
execute function public.inbox_v2_dg_deletion_terminal_coherence();
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_erasure_ledger_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_entry public.inbox_v2_data_governance_erasure_restore_ledger%rowtype;
begin
  if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger_evidence' then
    select e.* into v_entry
      from public.inbox_v2_data_governance_erasure_restore_ledger e
     where e.tenant_id = new.tenant_id
       and e.ledger_id = new.ledger_id
       and e.ledger_entry_id = new.ledger_entry_id;

    if v_entry.ledger_entry_id is null
       or (new.slot = 'primary_absence' and v_entry.kind <> 'erasure_applied')
       or (new.slot = 'backup_expiry' and v_entry.kind <> 'erasure_applied')
       or (new.slot = 'control_application' and v_entry.kind not in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied'))
       or (new.slot = 'restore' and v_entry.kind not in ('restore_opened', 'restore_sealed')) then
      raise exception 'Ledger evidence slot is incompatible with its entry kind'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger_controls' then
    select e.* into v_entry
      from public.inbox_v2_data_governance_erasure_restore_ledger e
     where e.tenant_id = new.tenant_id
       and e.ledger_id = new.ledger_id
       and e.ledger_entry_id = new.ledger_entry_id;

    if v_entry.ledger_entry_id is null
       or (new.role = 'required' and v_entry.kind not in ('restore_opened', 'restore_sealed'))
       or (new.role = 'reapplied' and v_entry.kind not in ('control_reapplied', 'restore_sealed')) then
      raise exception 'Ledger control-set row has an incompatible parent entry'
        using errcode = '23514';
    end if;

    if not exists (
      select 1
        from public.inbox_v2_data_governance_erasure_restore_ledger source
       where source.tenant_id = new.tenant_id
         and source.ledger_id = new.ledger_id
         and source.entry_hash = new.control_entry_hash
         and source.control_kind = new.control_kind
         and source.control_id = new.control_id
         and source.control_revision = new.control_revision
         and ((new.control_kind = 'legal_hold' and source.kind = 'hold_applied')
           or (new.control_kind = 'restriction' and source.kind = 'restriction_applied'))
    ) then
      raise exception 'Ledger control-set row does not reference an applied control entry'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_registry_versions rv
      join public.inbox_v2_data_governance_storage_roots sr
        on sr.registry_id = rv.id and sr.registry_revision = rv.revision
      join public.inbox_v2_data_governance_contexts c
        on c.tenant_id = new.tenant_id
       and c.context_id = new.governance_context_id
       and c.version = new.governance_context_version
      join public.inbox_v2_data_governance_effective_policies p
        on p.tenant_id = new.tenant_id
       and p.policy_id = new.policy_id
       and p.version = new.policy_version
      join public.inbox_v2_data_governance_policy_activations a
        on a.tenant_id = new.tenant_id
       and a.activation_id = new.activation_id
       and a.revision = new.activation_revision
     where rv.id = new.registry_id
       and rv.revision = new.registry_revision
       and rv.composition_hash = new.registry_composition_hash
       and sr.storage_root_id = new.storage_root_id
       and sr.kind = new.root_kind
       and sr.boundary = new.boundary
       and c.context_hash = new.governance_context_hash
       and c.registry_id = rv.id
       and c.registry_revision = rv.revision
       and p.policy_hash = new.policy_hash
       and p.governance_context_id = c.context_id
       and p.governance_context_version = c.version
       and p.registry_id = rv.id
       and p.registry_revision = rv.revision
       and a.activation_hash = new.activation_hash
       and a.policy_id = p.policy_id
       and a.policy_version = p.version
  ) then
    raise exception 'Ledger entry authority/root hashes are incoherent'
      using errcode = '23514';
  end if;

  if (new.sequence = 1 and new.previous_entry_hash is not null)
     or (new.sequence > 1 and not exists (
       select 1 from public.inbox_v2_data_governance_erasure_restore_ledger prev
        where prev.tenant_id = new.tenant_id
          and prev.ledger_id = new.ledger_id
          and prev.sequence = new.sequence - 1
          and prev.entry_hash = new.previous_entry_hash
          and prev.occurred_at <= new.occurred_at
          and prev.recorded_at <= new.recorded_at
          and (
            new.sync_generation > prev.sync_generation
            or (new.sync_generation = prev.sync_generation
              and new.stream_epoch = prev.stream_epoch
              and new.complete_through_position >= prev.complete_through_position)
          )
     )) then
    raise exception 'Ledger hash chain must be contiguous and high-water monotonic'
      using errcode = '23514';
  end if;

  if new.primary_verification_handler_id is not null and not exists (
    select 1 from public.inbox_v2_data_governance_lifecycle_handlers h
     where h.registry_id = new.registry_id
       and h.registry_revision = new.registry_revision
       and h.handler_id = new.primary_verification_handler_id
       and h.kind = 'verification'
  ) then
    raise exception 'Primary absence evidence uses a non-verification handler'
      using errcode = '23514';
  end if;
  if new.kind = 'erasure_applied' and not exists (
    select 1
      from public.inbox_v2_data_governance_deletion_runs r
      join public.inbox_v2_data_governance_deletion_checkpoint_requirements q
        on q.tenant_id = r.tenant_id
       and q.plan_id = r.plan_id
       and q.plan_revision = r.plan_revision
       and q.surface = 'operated'
      join public.inbox_v2_data_governance_operated_checkpoint_heads h
        on h.tenant_id = r.tenant_id
       and h.run_id = r.run_id
       and h.run_revision = r.revision
       and h.checkpoint_id = q.checkpoint_id
       and h.current_outcome = 'verified_absent'
     where r.tenant_id = new.tenant_id
       and r.run_id = new.deletion_run_id
       and r.revision = new.deletion_run_revision
       and r.state = 'terminal'
       and r.primary_absence_verified
       and q.registry_id = new.registry_id
       and q.registry_revision = new.registry_revision
       and q.storage_root_id = new.storage_root_id
       and q.data_class_id = new.data_class_id
       and q.root_record_id = new.root_record_id
       and q.entity_type_id = new.entity_type_id
       and q.entity_id = new.entity_id
       and q.expected_entity_revision = new.entity_revision
       and q.expected_lineage_revision = new.lineage_revision
  ) then
    raise exception 'Erasure ledger entry requires a terminal verified deletion run'
      using errcode = '23514';
  end if;

  if (new.kind = 'erasure_applied' and not exists (
        select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_evidence ev
         where ev.tenant_id = new.tenant_id and ev.ledger_id = new.ledger_id
           and ev.ledger_entry_id = new.ledger_entry_id and ev.slot = 'primary_absence'
      )) or (new.kind = 'erasure_applied' and not exists (
        select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_evidence ev
         where ev.tenant_id = new.tenant_id and ev.ledger_id = new.ledger_id
           and ev.ledger_entry_id = new.ledger_entry_id and ev.slot = 'backup_expiry'
      )) or (new.kind in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied') and not exists (
        select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_evidence ev
         where ev.tenant_id = new.tenant_id and ev.ledger_id = new.ledger_id
           and ev.ledger_entry_id = new.ledger_entry_id and ev.slot = 'control_application'
      )) or (new.kind in ('restore_opened', 'restore_sealed') and not exists (
        select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_evidence ev
         where ev.tenant_id = new.tenant_id and ev.ledger_id = new.ledger_id
           and ev.ledger_entry_id = new.ledger_entry_id and ev.slot = 'restore'
      )) then
    raise exception 'Ledger entry is missing its typed evidence slot'
      using errcode = '23514';
  end if;

  if new.control_kind = 'legal_hold' and not exists (
    select 1 from public.inbox_v2_data_governance_legal_hold_revisions h
     where h.tenant_id = new.tenant_id and h.hold_id = new.control_id
       and h.revision = new.control_revision
  ) then
    raise exception 'Ledger legal-hold reference is missing' using errcode = '23514';
  elsif new.control_kind = 'restriction' and not exists (
    select 1 from public.inbox_v2_data_governance_restriction_revisions r
     where r.tenant_id = new.tenant_id and r.restriction_id = new.control_id
       and r.revision = new.control_revision
  ) then
    raise exception 'Ledger restriction reference is missing' using errcode = '23514';
  end if;

  if new.kind = 'hold_applied' and not exists (
    select 1
      from public.inbox_v2_data_governance_legal_hold_revisions h
      join public.inbox_v2_data_governance_legal_hold_data_classes dc
        on dc.tenant_id = h.tenant_id and dc.hold_id = h.hold_id
       and dc.hold_revision = h.revision and dc.data_class_id = new.data_class_id
      join public.inbox_v2_data_governance_legal_hold_targets ht
        on ht.tenant_id = h.tenant_id and ht.hold_id = h.hold_id
       and ht.hold_revision = h.revision
     where h.tenant_id = new.tenant_id
       and h.hold_id = new.control_id and h.revision = new.control_revision
       and h.state = 'active' and ht.state = 'active'
       and ht.storage_root_id = new.storage_root_id
       and ht.root_record_id = new.root_record_id
       and ht.entity_type_id = new.entity_type_id
       and ht.entity_id = new.entity_id
       and ht.expected_entity_revision = new.entity_revision
       and ht.expected_lineage_revision = new.lineage_revision
  ) then
    raise exception 'Applied hold does not cover the exact ledger target/data class'
      using errcode = '23514';
  elsif new.kind = 'restriction_applied' and not exists (
    select 1
      from public.inbox_v2_data_governance_restriction_revisions r
      join public.inbox_v2_data_governance_scope_manifest_roots sr
        on sr.tenant_id = r.tenant_id
       and sr.manifest_id = r.scope_manifest_id
       and sr.manifest_revision = r.scope_manifest_revision
     where r.tenant_id = new.tenant_id
       and r.restriction_id = new.control_id
       and r.revision = new.control_revision
       and r.state = 'active'
       and sr.data_class_id = new.data_class_id
       and sr.storage_root_id = new.storage_root_id
       and sr.root_record_id = new.root_record_id
       and sr.entity_type_id = new.entity_type_id
       and sr.entity_id = new.entity_id
       and sr.expected_entity_revision = new.entity_revision
       and sr.expected_lineage_revision = new.lineage_revision
  ) then
    raise exception 'Applied restriction does not cover the exact ledger target'
      using errcode = '23514';
  end if;

  if new.kind = 'hold_released' and not exists (
    select 1
      from public.inbox_v2_data_governance_legal_hold_revisions h
      join public.inbox_v2_data_governance_legal_hold_data_classes dc
        on dc.tenant_id = h.tenant_id and dc.hold_id = h.hold_id
       and dc.hold_revision = h.revision and dc.data_class_id = new.data_class_id
      join public.inbox_v2_data_governance_legal_hold_targets ht
        on ht.tenant_id = h.tenant_id and ht.hold_id = h.hold_id
       and ht.hold_revision = h.revision
     where h.tenant_id = new.tenant_id
       and h.hold_id = new.control_id and h.revision = new.control_revision
       and h.state = 'released' and ht.state = 'released'
       and ht.storage_root_id = new.storage_root_id
       and ht.root_record_id = new.root_record_id
       and ht.entity_type_id = new.entity_type_id
       and ht.entity_id = new.entity_id
       and ht.expected_entity_revision = new.entity_revision
       and ht.expected_lineage_revision = new.lineage_revision
  ) then
    raise exception 'Released hold tombstone does not cover the exact ledger target/data class'
      using errcode = '23514';
  elsif new.kind = 'restriction_released' and not exists (
    select 1
      from public.inbox_v2_data_governance_restriction_revisions r
      join public.inbox_v2_data_governance_scope_manifest_roots sr
        on sr.tenant_id = r.tenant_id
       and sr.manifest_id = r.scope_manifest_id
       and sr.manifest_revision = r.scope_manifest_revision
     where r.tenant_id = new.tenant_id
       and r.restriction_id = new.control_id
       and r.revision = new.control_revision
       and r.state = 'released'
       and sr.data_class_id = new.data_class_id
       and sr.storage_root_id = new.storage_root_id
       and sr.root_record_id = new.root_record_id
       and sr.entity_type_id = new.entity_type_id
       and sr.entity_id = new.entity_id
       and sr.expected_entity_revision = new.entity_revision
       and sr.expected_lineage_revision = new.lineage_revision
  ) then
    raise exception 'Released restriction tombstone does not cover the exact ledger target'
      using errcode = '23514';
  end if;

  if new.kind in ('hold_released', 'restriction_released') and not exists (
    select 1
      from public.inbox_v2_data_governance_erasure_restore_ledger applied
     where applied.tenant_id = new.tenant_id
       and applied.ledger_id = new.ledger_id
       and applied.control_kind = new.control_kind
       and applied.control_id = new.control_id
       and applied.kind = case
         when new.kind = 'hold_released' then 'hold_applied'::public.inbox_v2_data_governance_ledger_kind
         else 'restriction_applied'::public.inbox_v2_data_governance_ledger_kind
       end
       and applied.storage_root_id = new.storage_root_id
       and applied.data_class_id = new.data_class_id
       and applied.root_record_id = new.root_record_id
       and applied.entity_type_id = new.entity_type_id
       and applied.entity_id = new.entity_id
       and applied.entity_revision = new.entity_revision
       and applied.lineage_revision = new.lineage_revision
       and applied.sequence < new.sequence
  ) then
    raise exception 'Control release tombstone requires prior applied lineage for the exact target'
      using errcode = '23514';
  end if;

  if new.kind in ('restore_opened', 'restore_sealed') and not exists (
    select 1 from public.inbox_v2_data_governance_erasure_restore_ledger e
     where e.tenant_id = new.tenant_id
       and e.ledger_id = new.ledger_id
       and e.entry_hash = new.source_erasure_entry_hash
       and e.kind = 'erasure_applied'
       and e.storage_root_id = new.storage_root_id
       and e.data_class_id = new.data_class_id
       and e.root_record_id = new.root_record_id
       and e.entity_type_id = new.entity_type_id
       and e.entity_id = new.entity_id
       and e.entity_revision = new.entity_revision
       and e.lineage_revision = new.lineage_revision
       and e.sequence < new.sequence
  ) then
    raise exception 'Restore entry does not reference the target erasure entry'
      using errcode = '23514';
  end if;

  if new.kind = 'restore_opened' and exists (
    select 1 from public.inbox_v2_data_governance_erasure_restore_ledger e
     where e.tenant_id = new.tenant_id and e.ledger_id = new.ledger_id
       and e.restore_id = new.restore_id and e.kind = 'restore_opened'
       and e.ledger_entry_id <> new.ledger_entry_id
  ) then
    raise exception 'Restore id may have only one opening entry' using errcode = '23514';
  end if;

  if new.kind = 'control_reapplied' and not exists (
    select 1
      from public.inbox_v2_data_governance_erasure_restore_ledger opened
      join public.inbox_v2_data_governance_erasure_restore_ledger control
        on control.tenant_id = opened.tenant_id
       and control.ledger_id = opened.ledger_id
       and control.entry_hash = new.source_control_entry_hash
      join public.inbox_v2_data_governance_erasure_restore_ledger_controls required
        on required.tenant_id = opened.tenant_id
       and required.ledger_id = opened.ledger_id
       and required.ledger_entry_id = opened.ledger_entry_id
       and required.role = 'required'
       and required.control_entry_hash = new.source_control_entry_hash
     where opened.tenant_id = new.tenant_id
       and opened.ledger_id = new.ledger_id
       and opened.restore_id = new.restore_id
       and opened.kind = 'restore_opened'
       and opened.sequence < new.sequence
       and opened.storage_root_id = new.storage_root_id
       and opened.data_class_id = new.data_class_id
       and opened.root_record_id = new.root_record_id
       and opened.entity_type_id = new.entity_type_id
       and opened.entity_id = new.entity_id
       and opened.entity_revision = new.entity_revision
       and opened.lineage_revision = new.lineage_revision
       and control.control_kind = new.control_kind
       and control.control_id = new.control_id
       and control.control_revision = new.control_revision
       and control.storage_root_id = new.storage_root_id
       and control.data_class_id = new.data_class_id
       and control.root_record_id = new.root_record_id
       and control.entity_type_id = new.entity_type_id
       and control.entity_id = new.entity_id
       and required.control_kind = new.control_kind
       and required.control_id = new.control_id
       and required.control_revision = new.control_revision
       and not exists (
         select 1 from public.inbox_v2_data_governance_erasure_restore_ledger duplicate
          where duplicate.tenant_id = new.tenant_id
            and duplicate.ledger_id = new.ledger_id
            and duplicate.restore_id = new.restore_id
            and duplicate.kind = 'control_reapplied'
            and duplicate.source_control_entry_hash = new.source_control_entry_hash
            and duplicate.ledger_entry_id <> new.ledger_entry_id
       )
  ) then
    raise exception 'Control reapplication lacks its restore/control source lineage'
      using errcode = '23514';
  end if;

  if new.kind = 'restore_sealed' then
    if new.required_control_hash <> new.reapplied_control_hash
       or not exists (
         select 1 from public.inbox_v2_data_governance_erasure_restore_ledger opened
          where opened.tenant_id = new.tenant_id
            and opened.ledger_id = new.ledger_id
            and opened.restore_id = new.restore_id
            and opened.kind = 'restore_opened'
            and opened.source_erasure_entry_hash = new.source_erasure_entry_hash
            and opened.required_control_hash = new.required_control_hash
            and opened.sequence < new.sequence
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_erasure_restore_ledger opened
           join public.inbox_v2_data_governance_erasure_restore_ledger_controls required
             on required.tenant_id = opened.tenant_id
            and required.ledger_id = opened.ledger_id
            and required.ledger_entry_id = opened.ledger_entry_id
            and required.role = 'required'
          where opened.tenant_id = new.tenant_id
            and opened.ledger_id = new.ledger_id
            and opened.restore_id = new.restore_id
            and opened.kind = 'restore_opened'
            and not exists (
              select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_controls sealed_required
               where sealed_required.tenant_id = new.tenant_id
                 and sealed_required.ledger_id = new.ledger_id
                 and sealed_required.ledger_entry_id = new.ledger_entry_id
                 and sealed_required.role = 'required'
                 and sealed_required.control_kind = required.control_kind
                 and sealed_required.control_id = required.control_id
                 and sealed_required.control_revision = required.control_revision
                 and sealed_required.control_entry_hash = required.control_entry_hash
            )
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_erasure_restore_ledger_controls sealed_required
          where sealed_required.tenant_id = new.tenant_id
            and sealed_required.ledger_id = new.ledger_id
            and sealed_required.ledger_entry_id = new.ledger_entry_id
            and sealed_required.role = 'required'
            and not exists (
              select 1
                from public.inbox_v2_data_governance_erasure_restore_ledger opened
                join public.inbox_v2_data_governance_erasure_restore_ledger_controls required
                  on required.tenant_id = opened.tenant_id
                 and required.ledger_id = opened.ledger_id
                 and required.ledger_entry_id = opened.ledger_entry_id
                 and required.role = 'required'
               where opened.tenant_id = new.tenant_id
                 and opened.ledger_id = new.ledger_id
                 and opened.restore_id = new.restore_id
                 and opened.kind = 'restore_opened'
                 and required.control_kind = sealed_required.control_kind
                 and required.control_id = sealed_required.control_id
                 and required.control_revision = sealed_required.control_revision
                 and required.control_entry_hash = sealed_required.control_entry_hash
            )
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_erasure_restore_ledger opened
           join public.inbox_v2_data_governance_erasure_restore_ledger_controls required
             on required.tenant_id = opened.tenant_id
            and required.ledger_id = opened.ledger_id
            and required.ledger_entry_id = opened.ledger_entry_id
            and required.role = 'required'
          where opened.tenant_id = new.tenant_id
            and opened.ledger_id = new.ledger_id
            and opened.restore_id = new.restore_id
            and opened.kind = 'restore_opened'
            and not exists (
              select 1 from public.inbox_v2_data_governance_erasure_restore_ledger reapplied_entry
               where reapplied_entry.tenant_id = new.tenant_id
                 and reapplied_entry.ledger_id = new.ledger_id
                 and reapplied_entry.restore_id = new.restore_id
                 and reapplied_entry.kind = 'control_reapplied'
                 and reapplied_entry.source_control_entry_hash = required.control_entry_hash
                 and reapplied_entry.control_kind = required.control_kind
                 and reapplied_entry.control_id = required.control_id
                 and reapplied_entry.control_revision = required.control_revision
                 and reapplied_entry.sequence < new.sequence
            )
       )
       or exists (
         select 1 from public.inbox_v2_data_governance_erasure_restore_ledger reapplied_entry
          where reapplied_entry.tenant_id = new.tenant_id
            and reapplied_entry.ledger_id = new.ledger_id
            and reapplied_entry.restore_id = new.restore_id
            and reapplied_entry.kind = 'control_reapplied'
            and reapplied_entry.sequence < new.sequence
            and not exists (
              select 1
                from public.inbox_v2_data_governance_erasure_restore_ledger opened
                join public.inbox_v2_data_governance_erasure_restore_ledger_controls required
                  on required.tenant_id = opened.tenant_id
                 and required.ledger_id = opened.ledger_id
                 and required.ledger_entry_id = opened.ledger_entry_id
                 and required.role = 'required'
               where opened.tenant_id = new.tenant_id
                 and opened.ledger_id = new.ledger_id
                 and opened.restore_id = new.restore_id
                 and opened.kind = 'restore_opened'
                 and required.control_entry_hash = reapplied_entry.source_control_entry_hash
                 and required.control_kind = reapplied_entry.control_kind
                 and required.control_id = reapplied_entry.control_id
                 and required.control_revision = reapplied_entry.control_revision
            )
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_erasure_restore_ledger_controls required
          where required.tenant_id = new.tenant_id
            and required.ledger_id = new.ledger_id
            and required.ledger_entry_id = new.ledger_entry_id
            and required.role = 'required'
            and not exists (
              select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_controls reapplied
               where reapplied.tenant_id = required.tenant_id
                 and reapplied.ledger_id = required.ledger_id
                 and reapplied.ledger_entry_id = required.ledger_entry_id
                 and reapplied.role = 'reapplied'
                 and reapplied.control_kind = required.control_kind
                 and reapplied.control_id = required.control_id
                 and reapplied.control_revision = required.control_revision
                 and reapplied.control_entry_hash = required.control_entry_hash
            )
       )
       or exists (
         select 1
           from public.inbox_v2_data_governance_erasure_restore_ledger_controls reapplied
          where reapplied.tenant_id = new.tenant_id
            and reapplied.ledger_id = new.ledger_id
            and reapplied.ledger_entry_id = new.ledger_entry_id
            and reapplied.role = 'reapplied'
            and not exists (
              select 1 from public.inbox_v2_data_governance_erasure_restore_ledger_controls required
               where required.tenant_id = reapplied.tenant_id
                 and required.ledger_id = reapplied.ledger_id
                 and required.ledger_entry_id = reapplied.ledger_entry_id
                 and required.role = 'required'
                 and required.control_kind = reapplied.control_kind
                 and required.control_id = reapplied.control_id
                 and required.control_revision = reapplied.control_revision
                 and required.control_entry_hash = reapplied.control_entry_hash
            )
       ) then
      raise exception 'Restore seal does not prove the exact required/reapplied control set'
        using errcode = '23514';
    end if;
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_dg_erasure_ledger_coherence_constraint
after insert on public.inbox_v2_data_governance_erasure_restore_ledger
deferrable initially deferred
for each row execute function public.inbox_v2_dg_erasure_ledger_coherence();

create constraint trigger inbox_v2_dg_erasure_ledger_controls_coherence_constraint
after insert on public.inbox_v2_data_governance_erasure_restore_ledger_controls
deferrable initially deferred
for each row execute function public.inbox_v2_dg_erasure_ledger_coherence();

create constraint trigger inbox_v2_dg_erasure_ledger_evidence_coherence_constraint
after insert on public.inbox_v2_data_governance_erasure_restore_ledger_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_dg_erasure_ledger_coherence();

create or replace function public.inbox_v2_dg_restore_current_controls(
  p_tenant_id text,
  p_ledger_id text,
  p_storage_root_id text,
  p_data_class_id text,
  p_root_record_id text,
  p_entity_type_id text,
  p_entity_id text,
  p_entity_revision bigint,
  p_lineage_revision bigint,
  p_before_sequence bigint
)
returns table (
  control_kind public.inbox_v2_data_governance_control_reference_kind,
  control_id text,
  control_revision bigint,
  control_head_revision bigint,
  control_entry_hash text
)
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  with ranked as (
    select ledger.control_kind,
           ledger.control_id,
           ledger.control_revision,
           ledger.sequence,
           ledger.entry_hash,
           ledger.kind,
           row_number() over (
             partition by ledger.control_kind, ledger.control_id
             order by ledger.sequence desc
           ) as rank
      from public.inbox_v2_data_governance_erasure_restore_ledger ledger
     where ledger.tenant_id = p_tenant_id
       and ledger.ledger_id = p_ledger_id
       and ledger.kind in (
         'hold_applied', 'restriction_applied',
         'hold_released', 'restriction_released'
       )
       and ledger.storage_root_id = p_storage_root_id
       and ledger.data_class_id = p_data_class_id
       and ledger.root_record_id = p_root_record_id
       and ledger.entity_type_id = p_entity_type_id
       and ledger.entity_id = p_entity_id
       and ledger.entity_revision = p_entity_revision
       and ledger.lineage_revision = p_lineage_revision
       and ledger.sequence < p_before_sequence
  )
  select ranked.control_kind,
         ranked.control_id,
         ranked.control_revision,
         ranked.sequence as control_head_revision,
         ranked.entry_hash as control_entry_hash
    from ranked
   where ranked.rank = 1
     and (
       (ranked.control_kind = 'legal_hold' and ranked.kind = 'hold_applied')
       or (ranked.control_kind = 'restriction' and ranked.kind = 'restriction_applied')
     )
$function$;

create or replace function public.inbox_v2_dg_restore_state_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_ledger_id text;
  v_restore_id text;
  v_before_sequence bigint;
  v_head public.inbox_v2_data_governance_restore_heads%rowtype;
begin
  if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger' then
    if new.kind not in ('restore_opened', 'control_reapplied', 'restore_sealed') then
      return null;
    end if;
    v_tenant_id := new.tenant_id;
    v_ledger_id := new.ledger_id;
    v_restore_id := new.restore_id;
  elsif tg_table_name in (
    'inbox_v2_data_governance_restore_heads',
    'inbox_v2_data_governance_restore_required_controls',
    'inbox_v2_data_governance_restore_leases'
  ) then
    v_tenant_id := new.tenant_id;
    v_ledger_id := new.ledger_id;
    v_restore_id := new.restore_id;
  else
    return null;
  end if;

  select head.* into v_head
    from public.inbox_v2_data_governance_restore_heads head
   where head.tenant_id = v_tenant_id
     and head.ledger_id = v_ledger_id
     and head.restore_id = v_restore_id;
  if v_head.restore_id is null then
    raise exception 'Restore ledger mutation lacks its database-owned head'
      using errcode = '23514';
  end if;

  select coalesce(v_head.sealed_sequence, max(ledger.sequence) + 1)
    into v_before_sequence
    from public.inbox_v2_data_governance_erasure_restore_ledger ledger
   where ledger.tenant_id = v_head.tenant_id
     and ledger.ledger_id = v_head.ledger_id;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_erasure_restore_ledger opened
      join public.inbox_v2_data_governance_erasure_restore_ledger erased
        on erased.tenant_id = opened.tenant_id
       and erased.ledger_id = opened.ledger_id
       and erased.entry_hash = opened.source_erasure_entry_hash
       and erased.kind = 'erasure_applied'
     where opened.tenant_id = v_head.tenant_id
       and opened.ledger_id = v_head.ledger_id
       and opened.restore_id = v_head.restore_id
       and opened.kind = 'restore_opened'
       and opened.entry_hash = v_head.opened_entry_hash
       and opened.sequence = v_head.opened_sequence
       and opened.source_erasure_entry_hash = v_head.source_erasure_entry_hash
       and erased.sequence = v_head.source_erasure_sequence
       and opened.storage_root_id = v_head.storage_root_id
       and opened.data_class_id = v_head.data_class_id
       and opened.root_record_id = v_head.root_record_id
       and opened.entity_type_id = v_head.entity_type_id
       and opened.entity_id = v_head.entity_id
       and opened.entity_revision = v_head.entity_revision
       and opened.lineage_revision = v_head.lineage_revision
       and opened.stream_epoch = v_head.opened_stream_epoch
       and opened.sync_generation = v_head.opened_sync_generation
       and opened.complete_through_position = v_head.opened_complete_through_position
       and opened.required_control_hash = v_head.required_control_set_hash
  ) then
    raise exception 'Restore head does not bind its exact source/opening ledger state'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_control_set_heads control_set
     where control_set.tenant_id = v_head.tenant_id
       and control_set.head_revision = v_head.control_set_head_revision
       and control_set.legal_hold_set_revision = v_head.legal_hold_set_revision
       and control_set.restriction_set_revision = v_head.restriction_set_revision
       and control_set.last_changed_stream_position = v_head.control_set_stream_position
       and v_head.opened_complete_through_position >= control_set.last_changed_stream_position
  ) then
    raise exception 'Restore head control-set/high-water fence is stale'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_data_governance_legal_hold_heads hold_head
      join public.inbox_v2_data_governance_legal_hold_revisions hold_revision
        on hold_revision.tenant_id = hold_head.tenant_id
       and hold_revision.hold_id = hold_head.hold_id
       and hold_revision.revision = hold_head.current_revision
      join public.inbox_v2_data_governance_legal_hold_data_classes data_class
        on data_class.tenant_id = hold_revision.tenant_id
       and data_class.hold_id = hold_revision.hold_id
       and data_class.hold_revision = hold_revision.revision
       and data_class.data_class_id = v_head.data_class_id
     where hold_head.tenant_id = v_head.tenant_id
       and hold_head.state = 'active'
       and hold_revision.state = 'active'
       and hold_revision.scope_kind = 'prospective'
  ) or exists (
    select 1
      from public.inbox_v2_data_governance_restriction_heads restriction_head
      join public.inbox_v2_data_governance_restriction_revisions restriction_revision
        on restriction_revision.tenant_id = restriction_head.tenant_id
       and restriction_revision.restriction_id = restriction_head.restriction_id
       and restriction_revision.revision = restriction_head.current_revision
     where restriction_head.tenant_id = v_head.tenant_id
       and restriction_head.state = 'active'
       and restriction_revision.state = 'active'
       and restriction_revision.scope_kind = 'prospective'
  ) then
    raise exception 'Restore cannot seal across an unresolved prospective control'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_data_governance_legal_hold_heads hold_head
      join public.inbox_v2_data_governance_legal_hold_revisions hold_revision
        on hold_revision.tenant_id = hold_head.tenant_id
       and hold_revision.hold_id = hold_head.hold_id
       and hold_revision.revision = hold_head.current_revision
       and hold_revision.state = 'active'
       and hold_revision.scope_kind = 'exact'
      join public.inbox_v2_data_governance_legal_hold_data_classes data_class
        on data_class.tenant_id = hold_revision.tenant_id
       and data_class.hold_id = hold_revision.hold_id
       and data_class.hold_revision = hold_revision.revision
       and data_class.data_class_id = v_head.data_class_id
      join public.inbox_v2_data_governance_legal_hold_targets exact_target
        on exact_target.tenant_id = hold_revision.tenant_id
       and exact_target.hold_id = hold_revision.hold_id
       and exact_target.hold_revision = hold_revision.revision
       and exact_target.state = 'active'
       and exact_target.storage_root_id = v_head.storage_root_id
       and exact_target.root_record_id = v_head.root_record_id
       and exact_target.entity_type_id = v_head.entity_type_id
       and exact_target.entity_id = v_head.entity_id
       and exact_target.expected_entity_revision = v_head.entity_revision
       and exact_target.expected_lineage_revision = v_head.lineage_revision
      left join lateral (
        select transition.control_revision
          from public.inbox_v2_data_governance_erasure_restore_ledger transition
         where transition.tenant_id = v_head.tenant_id
           and transition.ledger_id = v_head.ledger_id
           and transition.control_kind = 'legal_hold'
           and transition.control_id = hold_head.hold_id
           and transition.kind in ('hold_applied', 'hold_released')
           and transition.storage_root_id = v_head.storage_root_id
           and transition.data_class_id = v_head.data_class_id
           and transition.root_record_id = v_head.root_record_id
           and transition.entity_type_id = v_head.entity_type_id
           and transition.entity_id = v_head.entity_id
           and transition.entity_revision = v_head.entity_revision
           and transition.lineage_revision = v_head.lineage_revision
           and transition.sequence < v_before_sequence
         order by transition.sequence desc
         limit 1
      ) latest_transition on true
     where hold_head.tenant_id = v_head.tenant_id
       and hold_head.state = 'active'
       and (latest_transition.control_revision is null
         or latest_transition.control_revision < hold_head.current_revision)
  ) or exists (
    select 1
      from public.inbox_v2_data_governance_restriction_heads restriction_head
      join public.inbox_v2_data_governance_restriction_revisions restriction_revision
        on restriction_revision.tenant_id = restriction_head.tenant_id
       and restriction_revision.restriction_id = restriction_head.restriction_id
       and restriction_revision.revision = restriction_head.current_revision
       and restriction_revision.state = 'active'
       and restriction_revision.scope_kind = 'exact'
      join public.inbox_v2_data_governance_scope_manifest_roots exact_target
        on exact_target.tenant_id = restriction_revision.tenant_id
       and exact_target.manifest_id = restriction_revision.scope_manifest_id
       and exact_target.manifest_revision = restriction_revision.scope_manifest_revision
       and exact_target.storage_root_id = v_head.storage_root_id
       and exact_target.data_class_id = v_head.data_class_id
       and exact_target.root_record_id = v_head.root_record_id
       and exact_target.entity_type_id = v_head.entity_type_id
       and exact_target.entity_id = v_head.entity_id
       and exact_target.expected_entity_revision = v_head.entity_revision
       and exact_target.expected_lineage_revision = v_head.lineage_revision
      left join lateral (
        select transition.control_revision
          from public.inbox_v2_data_governance_erasure_restore_ledger transition
         where transition.tenant_id = v_head.tenant_id
           and transition.ledger_id = v_head.ledger_id
           and transition.control_kind = 'restriction'
           and transition.control_id = restriction_head.restriction_id
           and transition.kind in ('restriction_applied', 'restriction_released')
           and transition.storage_root_id = v_head.storage_root_id
           and transition.data_class_id = v_head.data_class_id
           and transition.root_record_id = v_head.root_record_id
           and transition.entity_type_id = v_head.entity_type_id
           and transition.entity_id = v_head.entity_id
           and transition.entity_revision = v_head.entity_revision
           and transition.lineage_revision = v_head.lineage_revision
           and transition.sequence < v_before_sequence
         order by transition.sequence desc
         limit 1
      ) latest_transition on true
     where restriction_head.tenant_id = v_head.tenant_id
       and restriction_head.state = 'active'
       and (latest_transition.control_revision is null
         or latest_transition.control_revision < restriction_head.current_revision)
  ) then
    raise exception 'Active exact restore control lacks a current tamper-resistant ledger transition'
      using errcode = '23514';
  end if;

  if v_head.required_control_count <> (
       select count(*)
         from public.inbox_v2_data_governance_restore_required_controls required
        where required.tenant_id = v_head.tenant_id
          and required.ledger_id = v_head.ledger_id
          and required.restore_id = v_head.restore_id
     )
     or exists (
       select 1
         from public.inbox_v2_dg_restore_current_controls(
           v_head.tenant_id, v_head.ledger_id, v_head.storage_root_id,
           v_head.data_class_id, v_head.root_record_id, v_head.entity_type_id,
           v_head.entity_id, v_head.entity_revision, v_head.lineage_revision,
           v_before_sequence
         ) current_control
        where not exists (
          select 1
            from public.inbox_v2_data_governance_restore_required_controls required
           where required.tenant_id = v_head.tenant_id
             and required.ledger_id = v_head.ledger_id
             and required.restore_id = v_head.restore_id
             and required.control_kind = current_control.control_kind
             and required.control_id = current_control.control_id
             and required.control_revision = current_control.control_revision
             and required.control_head_revision = current_control.control_head_revision
             and required.source_control_entry_hash = current_control.control_entry_hash
        )
     )
     or exists (
       select 1
         from public.inbox_v2_data_governance_restore_required_controls required
        where required.tenant_id = v_head.tenant_id
          and required.ledger_id = v_head.ledger_id
          and required.restore_id = v_head.restore_id
          and not exists (
            select 1
              from public.inbox_v2_dg_restore_current_controls(
                v_head.tenant_id, v_head.ledger_id, v_head.storage_root_id,
                v_head.data_class_id, v_head.root_record_id, v_head.entity_type_id,
                v_head.entity_id, v_head.entity_revision, v_head.lineage_revision,
                v_before_sequence
              ) current_control
             where current_control.control_kind = required.control_kind
               and current_control.control_id = required.control_id
               and current_control.control_revision = required.control_revision
               and current_control.control_head_revision = required.control_head_revision
               and current_control.control_entry_hash = required.source_control_entry_hash
          )
     ) then
    raise exception 'Restore required controls differ from the latest tamper-resistant ledger state'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_data_governance_restore_required_controls required
     where required.tenant_id = v_head.tenant_id
       and required.ledger_id = v_head.ledger_id
       and required.restore_id = v_head.restore_id
       and (
         not exists (
           select 1
             from public.inbox_v2_data_governance_erasure_restore_ledger_controls opened_control
            where opened_control.tenant_id = v_head.tenant_id
              and opened_control.ledger_id = v_head.ledger_id
              and opened_control.ledger_entry_id = v_head.opened_entry_hash
              and opened_control.role = 'required'
              and opened_control.control_kind = required.control_kind
              and opened_control.control_id = required.control_id
              and opened_control.control_revision = required.control_revision
              and opened_control.control_entry_hash = required.source_control_entry_hash
         )
         or (required.reapplied_entry_hash is not null and not exists (
           select 1
             from public.inbox_v2_data_governance_erasure_restore_ledger reapplied
            where reapplied.tenant_id = v_head.tenant_id
              and reapplied.ledger_id = v_head.ledger_id
              and reapplied.restore_id = v_head.restore_id
              and reapplied.entry_hash = required.reapplied_entry_hash
              and reapplied.kind = 'control_reapplied'
              and reapplied.source_control_entry_hash = required.source_control_entry_hash
              and reapplied.control_kind = required.control_kind
              and reapplied.control_id = required.control_id
              and reapplied.control_revision = required.control_revision
              and reapplied.sequence > v_head.opened_sequence
         ))
       )
  ) or exists (
    select 1
      from public.inbox_v2_data_governance_erasure_restore_ledger_controls opened_control
     where opened_control.tenant_id = v_head.tenant_id
       and opened_control.ledger_id = v_head.ledger_id
       and opened_control.ledger_entry_id = v_head.opened_entry_hash
       and opened_control.role = 'required'
       and not exists (
         select 1
           from public.inbox_v2_data_governance_restore_required_controls required
          where required.tenant_id = v_head.tenant_id
            and required.ledger_id = v_head.ledger_id
            and required.restore_id = v_head.restore_id
            and required.control_kind = opened_control.control_kind
            and required.control_id = opened_control.control_id
            and required.control_revision = opened_control.control_revision
            and required.source_control_entry_hash = opened_control.control_entry_hash
       )
  ) then
    raise exception 'Restore materialized control state lacks exact ledger lineage'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
      from public.inbox_v2_data_governance_restore_leases lease
     where lease.tenant_id = v_head.tenant_id
       and lease.ledger_id = v_head.ledger_id
       and lease.restore_id = v_head.restore_id
       and lease.restore_head_revision = v_head.head_revision
       and ((v_head.state = 'open' and lease.state = 'active')
         or (v_head.state = 'sealed' and lease.state = 'completed'))
  ) then
    raise exception 'Restore head and lease revisions/states are incoherent'
      using errcode = '23514';
  end if;

  if v_head.state = 'sealed' then
    if exists (
      select 1
        from public.inbox_v2_data_governance_restore_required_controls required
       where required.tenant_id = v_head.tenant_id
         and required.ledger_id = v_head.ledger_id
         and required.restore_id = v_head.restore_id
         and required.reapplied_entry_hash is null
    ) or not exists (
      select 1
        from public.inbox_v2_data_governance_erasure_restore_ledger sealed
       where sealed.tenant_id = v_head.tenant_id
         and sealed.ledger_id = v_head.ledger_id
         and sealed.restore_id = v_head.restore_id
         and sealed.kind = 'restore_sealed'
         and sealed.entry_hash = v_head.sealed_entry_hash
         and sealed.sequence = v_head.sealed_sequence
         and sealed.source_erasure_entry_hash = v_head.source_erasure_entry_hash
         and sealed.complete_through_position >= v_head.control_set_stream_position
    ) then
      raise exception 'Sealed restore lacks its unique exact ledger/control proof'
        using errcode = '23514';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger' then
    if new.kind = 'control_reapplied' and not exists (
         select 1
           from public.inbox_v2_data_governance_restore_required_controls required
          where required.tenant_id = new.tenant_id
            and required.ledger_id = new.ledger_id
            and required.restore_id = new.restore_id
            and required.source_control_entry_hash = new.source_control_entry_hash
            and required.reapplied_entry_hash = new.entry_hash
       ) then
      raise exception 'Control reapplication did not CAS its database-owned required row'
        using errcode = '23514';
    end if;
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_dg_restore_ledger_state_coherence
after insert on public.inbox_v2_data_governance_erasure_restore_ledger
deferrable initially deferred
for each row execute function public.inbox_v2_dg_restore_state_coherence();

create constraint trigger inbox_v2_dg_restore_head_state_coherence
after insert or update on public.inbox_v2_data_governance_restore_heads
deferrable initially deferred
for each row execute function public.inbox_v2_dg_restore_state_coherence();

create constraint trigger inbox_v2_dg_restore_required_state_coherence
after insert or update on public.inbox_v2_data_governance_restore_required_controls
deferrable initially deferred
for each row execute function public.inbox_v2_dg_restore_state_coherence();

create constraint trigger inbox_v2_dg_restore_lease_state_coherence
after insert or update on public.inbox_v2_data_governance_restore_leases
deferrable initially deferred
for each row execute function public.inbox_v2_dg_restore_state_coherence();
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL = String.raw`
create or replace function public.inbox_v2_dg_cas_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_new jsonb;
  v_old jsonb;
  v_mutable text[];
begin
  if tg_op = 'DELETE' then
    raise exception '% CAS authority cannot be deleted', tg_table_name
      using errcode = '23514';
  end if;

  v_new := to_jsonb(new);
  if tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
  end if;

  if tg_table_name = 'inbox_v2_data_governance_restore_heads' then
    if tg_op = 'INSERT' then
      if new.head_revision <> 1 or new.state <> 'open'
         or new.sealed_entry_hash is not null or new.sealed_sequence is not null
         or new.sealed_at is not null then
        raise exception 'Restore head must start open at revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array[
        'state', 'head_revision', 'sealed_entry_hash', 'sealed_sequence',
        'sealed_at', 'updated_at'
      ];
      if new.head_revision <> old.head_revision + 1
         or new.updated_at <= old.updated_at
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or old.state <> 'open'
         or not (
           (new.state = 'open' and new.sealed_entry_hash is null
             and new.sealed_sequence is null and new.sealed_at is null)
           or (new.state = 'sealed' and new.sealed_entry_hash is not null
             and new.sealed_sequence is not null and new.sealed_at is not null)
         ) then
        raise exception 'Restore head requires immutable fence and one legal +1 CAS edge'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_restore_required_controls' then
    if tg_op = 'INSERT' then
      if new.row_revision <> 1 or new.reapplied_entry_hash is not null
         or new.reapplied_at is not null then
        raise exception 'Required restore control must start pending at revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array['row_revision', 'reapplied_entry_hash', 'reapplied_at'];
      if new.row_revision <> old.row_revision + 1
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or old.reapplied_entry_hash is not null
         or new.reapplied_entry_hash is null or new.reapplied_at is null then
        raise exception 'Required restore control can be reapplied exactly once under CAS'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_restore_leases' then
    if tg_op = 'INSERT' then
      if new.lease_revision <> 1 or new.restore_head_revision <> 1
         or new.state <> 'active' or new.completed_at is not null then
        raise exception 'Restore lease must start active at revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array[
        'lease_revision', 'restore_head_revision', 'state', 'completed_at',
        'updated_at'
      ];
      if new.lease_revision <> old.lease_revision + 1
         or new.restore_head_revision <> old.restore_head_revision + 1
         or new.updated_at <= old.updated_at
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or old.state <> 'active'
         or new.state not in ('active', 'completed', 'released', 'expired')
         or (new.state = 'active' and new.completed_at is not null)
         or (new.state = 'completed' and new.completed_at is null)
         or (new.state in ('released', 'expired') and new.completed_at is not null) then
        raise exception 'Restore lease requires immutable token, legal edge and +1 CAS'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_export_jobs' then
    if tg_op = 'INSERT' then
      if new.state_revision <> 1
         or new.state <> 'queued'
         or new.export_manifest_id is not null
         or new.export_manifest_revision is not null
         or new.export_artifact_id is not null
         or new.export_artifact_revision is not null then
        raise exception 'Export job must bootstrap queued at state revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array[
        'state', 'state_revision', 'export_manifest_id',
        'export_manifest_revision', 'export_artifact_id',
        'export_artifact_revision', 'updated_at'
      ];
      if new.state_revision <> old.state_revision + 1
         or new.updated_at <= old.updated_at
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or not (
           (old.state = 'queued' and new.state = 'running')
           or (old.state = 'running' and new.state in ('ready', 'revoked', 'expired', 'failed_retryable'))
           or (old.state = 'ready' and new.state in ('completed', 'revoked', 'expired', 'failed_retryable'))
           or (old.state = 'failed_retryable' and new.state in ('running', 'failed_retryable', 'revoked', 'expired'))
           or (old.state = 'revoked' and new.state = 'revoked')
           or (old.state = 'expired' and new.state = 'expired')
         )
         or (
           old.state = 'queued' and (
             new.export_artifact_id is null
             or new.export_artifact_revision <> 1
           )
         )
         or (
           old.state = 'failed_retryable' and new.state = 'running' and (
             new.export_artifact_id is null
             or new.export_artifact_id = old.export_artifact_id
             or new.export_artifact_revision <> 1
           )
         )
         or (
           old.state = 'failed_retryable'
           and new.state in ('revoked', 'expired')
           and (
             new.export_artifact_id is distinct from old.export_artifact_id
             or new.export_artifact_revision is distinct from old.export_artifact_revision
           )
         )
         or (
           old.state <> 'queued'
           and not (
             old.state = 'failed_retryable'
             and new.state in ('running', 'revoked', 'expired')
           )
           and (
             new.export_artifact_id is distinct from old.export_artifact_id
             or new.export_artifact_revision <> old.export_artifact_revision + 1
           )
         ) then
        raise exception 'Export job requires immutable authority, legal edge and +1 state CAS'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_export_artifact_heads' then
    if tg_op = 'INSERT' then
      if new.current_revision <> 1 or new.current_state <> 'building' then
        raise exception 'Export artifact head must start building at revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array['current_revision', 'current_state', 'updated_at'];
      if new.current_revision <> old.current_revision + 1
         or new.updated_at <= old.updated_at
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or not (
           (old.current_state = 'building' and new.current_state in ('ready', 'quarantined', 'deleted'))
           or (old.current_state = 'ready' and new.current_state in ('quarantined', 'deleted'))
           or (old.current_state = 'quarantined' and new.current_state = 'deleted')
         ) then
        raise exception 'Export artifact head requires immutable authority, legal edge and next revision'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_export_receipt_cas' then
    if tg_op = 'INSERT' then
      if new.revision <> 1 or new.state <> 'issued' or new.consumed_at is not null then
        raise exception 'Receipt CAS must start issued at revision 1'
          using errcode = '23514';
      end if;
    else
      if new.revision <> old.revision + 1
         or new.updated_at < old.updated_at
         or (v_new - array['state', 'revision', 'consumed_at', 'updated_at'])
            <> (v_old - array['state', 'revision', 'consumed_at', 'updated_at'])
         or not (old.state = 'issued' and new.state in ('consumed', 'revoked', 'expired')) then
        raise exception 'Receipt requires immutable lineage, legal edge and +1 CAS'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_table_name = 'inbox_v2_data_governance_destructive_checkpoint_leases' then
    perform 1
      from public.inbox_v2_data_governance_control_set_heads c
     where c.tenant_id = new.tenant_id
       and c.legal_hold_set_revision = new.legal_hold_set_revision
       and c.restriction_set_revision = new.restriction_set_revision
     for update;
    if not found then
      raise exception 'Destructive lease must lock the current control-set authority'
        using errcode = '23514';
    end if;
    if tg_op = 'INSERT' then
      if new.claim_revision <> 1 or new.state <> 'claimed'
         or new.completed_at is not null then
        raise exception 'Destructive lease must start claimed at revision 1'
          using errcode = '23514';
      end if;
    else
      v_mutable := array[
        'state', 'claim_revision', 'execution_fence_hash', 'claimed_at',
        'lease_expires_at', 'completed_at', 'updated_at'
      ];
      if new.claim_revision <> old.claim_revision + 1
         or new.updated_at < old.updated_at
         or (v_new - v_mutable) <> (v_old - v_mutable)
         or not (
           (old.state = 'claimed' and new.state in ('completed', 'released', 'expired'))
           or (old.state in ('released', 'expired') and new.state = 'claimed')
         )
         or (new.state = 'claimed' and (
           new.execution_fence_hash = old.execution_fence_hash
           or new.claimed_at <= old.updated_at
           or new.lease_expires_at <= new.claimed_at
           or new.completed_at is not null
         ))
         or (new.state = 'completed' and (
           new.execution_fence_hash <> old.execution_fence_hash
           or new.completed_at is null
           or new.completed_at < old.claimed_at
           or new.completed_at > old.lease_expires_at
         ))
         or (new.state in ('released', 'expired') and (
           new.execution_fence_hash <> old.execution_fence_hash
           or new.completed_at is not null
         )) then
        raise exception 'Destructive lease requires frozen authority, legal edge and +1 CAS'
          using errcode = '23514';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if (v_new->>'head_revision')::bigint <> 1 then
      raise exception '% head must start at revision 1', tg_table_name
        using errcode = '23514';
    end if;
    if tg_table_name like '%_checkpoint_heads'
       and (v_new->>'current_attempt')::bigint <> 1 then
      raise exception 'Checkpoint head must start at attempt 1'
        using errcode = '23514';
    end if;
    return new;
  end if;

  v_mutable := array[
    'head_revision', 'updated_at', 'current_revision', 'current_state', 'state',
    'current_policy_version', 'current_activation_id', 'current_activation_revision',
    'current_attempt', 'current_outcome', 'legal_hold_set_revision',
    'restriction_set_revision', 'last_changed_stream_position'
  ];
  if (v_new->>'head_revision')::bigint <> (v_old->>'head_revision')::bigint + 1
     or (v_new->>'updated_at')::timestamptz < (v_old->>'updated_at')::timestamptz
     or (v_new - v_mutable) <> (v_old - v_mutable) then
    raise exception '% requires immutable identity and +1 CAS', tg_table_name
      using errcode = '23514';
  end if;

  if tg_table_name in (
       'inbox_v2_data_governance_legal_hold_heads',
       'inbox_v2_data_governance_restriction_heads',
       'inbox_v2_data_governance_privacy_request_heads'
     ) and (v_new->>'current_revision')::bigint
       <> (v_old->>'current_revision')::bigint + 1 then
    raise exception '% current revision must advance exactly once', tg_table_name
      using errcode = '23514';
  elsif tg_table_name = 'inbox_v2_data_governance_policy_activation_heads'
     and (v_new->>'current_policy_version')::bigint
       <= (v_old->>'current_policy_version')::bigint then
    raise exception 'Policy activation head cannot regress or repeat policy version'
      using errcode = '23514';
  elsif tg_table_name = 'inbox_v2_data_governance_control_set_heads'
     and ((v_new->>'legal_hold_set_revision')::bigint
            < (v_old->>'legal_hold_set_revision')::bigint
       or (v_new->>'restriction_set_revision')::bigint
            < (v_old->>'restriction_set_revision')::bigint
       or (v_new->>'last_changed_stream_position')::bigint
            <= (v_old->>'last_changed_stream_position')::bigint) then
    raise exception 'Control-set revisions/stream position must be monotonic'
      using errcode = '23514';
  elsif tg_table_name like '%_checkpoint_heads'
     and (v_new->>'current_attempt')::bigint
       <> (v_old->>'current_attempt')::bigint + 1 then
    raise exception 'Checkpoint current attempt must advance exactly once'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

do $block$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_data_governance_export_jobs',
    'inbox_v2_data_governance_export_artifact_heads',
    'inbox_v2_data_governance_policy_activation_heads',
    'inbox_v2_data_governance_legal_hold_heads',
    'inbox_v2_data_governance_restriction_heads',
    'inbox_v2_data_governance_control_set_heads',
    'inbox_v2_data_governance_privacy_request_heads',
    'inbox_v2_data_governance_export_receipt_cas',
    'inbox_v2_data_governance_destructive_checkpoint_leases',
    'inbox_v2_data_governance_operated_checkpoint_heads',
    'inbox_v2_data_governance_backup_checkpoint_heads',
    'inbox_v2_data_governance_external_checkpoint_heads',
    'inbox_v2_data_governance_restore_heads',
    'inbox_v2_data_governance_restore_required_controls',
    'inbox_v2_data_governance_restore_leases'
  ]
  loop
    v_trigger := 'inbox_v2_dg_cas_' || substr(md5(v_table), 1, 16);
    execute format(
      'create trigger %I before insert or update or delete on public.%I for each row execute function public.inbox_v2_dg_cas_guard()',
      v_trigger,
      v_table
    );
  end loop;
end
$block$;
`;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_GLOBAL_TABLES = [
  inboxV2DataGovernanceRegistryVersions,
  inboxV2DataGovernanceStorageRoots,
  inboxV2DataGovernanceLifecycleHandlers,
  inboxV2DataGovernanceDataUseLineages,
  inboxV2DataGovernancePolicyTemplates,
  inboxV2DataGovernancePolicyTemplateRules
] as const;

export const INBOX_V2_DATA_GOVERNANCE_PRIVACY_TENANT_TABLES = [
  inboxV2DataGovernanceContexts,
  inboxV2DataGovernanceContextPurposeRoles,
  inboxV2DataGovernanceEffectivePolicies,
  inboxV2DataGovernanceEffectivePolicyRules,
  inboxV2DataGovernancePolicyActivations,
  inboxV2DataGovernancePolicyActivationHeads,
  inboxV2DataGovernanceLifecyclePurposeSets,
  inboxV2DataGovernanceLifecyclePurposeInstances,
  inboxV2DataGovernanceSubjectLinks,
  inboxV2DataGovernanceScopeManifests,
  inboxV2DataGovernanceTenantTerminationScopeAuthorities,
  inboxV2DataGovernanceScopeManifestRoots,
  inboxV2DataGovernanceLegalHoldRevisions,
  inboxV2DataGovernanceLegalHoldDataClasses,
  inboxV2DataGovernanceLegalHoldTargets,
  inboxV2DataGovernanceLegalHoldHeads,
  inboxV2DataGovernanceRestrictionRevisions,
  inboxV2DataGovernanceRestrictionHeads,
  inboxV2DataGovernanceControlSetHeads,
  inboxV2DataGovernancePrivacyRequestRevisions,
  inboxV2DataGovernancePrivacyRequestAliases,
  inboxV2DataGovernancePrivacyRequestHeads,
  inboxV2DataGovernanceExportJobs,
  inboxV2DataGovernanceExportManifests,
  inboxV2DataGovernanceExportArtifacts,
  inboxV2DataGovernanceExportArtifactHeads,
  inboxV2DataGovernanceExportClaims,
  inboxV2DataGovernanceExportReceiptCas,
  inboxV2DataGovernanceDeletionPlans,
  inboxV2DataGovernanceDeletionCheckpointRequirements,
  inboxV2DataGovernanceDeletionRuns,
  inboxV2DataGovernanceDeletionRunTerminalExports,
  inboxV2DataGovernanceDeletionStageOneTargets,
  inboxV2DataGovernanceDestructiveCheckpointLeases,
  inboxV2DataGovernanceOperatedCheckpointAttempts,
  inboxV2DataGovernanceOperatedCheckpointHeads,
  inboxV2DataGovernanceBackupCheckpointAttempts,
  inboxV2DataGovernanceBackupCheckpointHeads,
  inboxV2DataGovernanceExternalCheckpointAttempts,
  inboxV2DataGovernanceExternalCheckpointHeads,
  inboxV2DataGovernanceErasureRestoreLedger,
  inboxV2DataGovernanceErasureRestoreLedgerEvidence,
  inboxV2DataGovernanceErasureRestoreLedgerControls,
  inboxV2DataGovernanceRestoreHeads,
  inboxV2DataGovernanceRestoreRequiredControls,
  inboxV2DataGovernanceRestoreLeases
] as const;
