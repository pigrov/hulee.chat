import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_CHECKPOINT_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_COHERENCE_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_GLOBAL_TABLES,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_TENANT_TABLES,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL,
  inboxV2DataGovernanceBackupCheckpointAttempts,
  inboxV2DataGovernanceDataUseLineages,
  inboxV2DataGovernanceDeletionCheckpointRequirements,
  inboxV2DataGovernanceDeletionRunTerminalExports,
  inboxV2DataGovernanceDeletionRuns,
  inboxV2DataGovernanceDeletionStageOneTargets,
  inboxV2DataGovernanceDestructiveCheckpointLeases,
  inboxV2DataGovernanceErasureRestoreLedger,
  inboxV2DataGovernanceErasureRestoreLedgerEvidence,
  inboxV2DataGovernanceExportArtifactHeads,
  inboxV2DataGovernanceExportArtifacts,
  inboxV2DataGovernanceExportClaims,
  inboxV2DataGovernanceExportJobs,
  inboxV2DataGovernanceExportManifests,
  inboxV2DataGovernanceExportReceiptCas,
  inboxV2DataGovernanceLedgerKind,
  inboxV2DataGovernanceLegalHoldDataClasses,
  inboxV2DataGovernanceLegalHoldTargets,
  inboxV2DataGovernanceLifecycleHandlers,
  inboxV2DataGovernanceLifecyclePurposeInstances,
  inboxV2DataGovernancePolicyActivations,
  inboxV2DataGovernancePolicyTemplates,
  inboxV2DataGovernancePrivacyRequestAliases,
  inboxV2DataGovernanceRestoreHeads,
  inboxV2DataGovernanceRestoreLeases,
  inboxV2DataGovernanceRestoreRequiredControls,
  inboxV2DataGovernanceStorageRoots,
  inboxV2DataGovernanceSubjectLinks,
  inboxV2DataGovernanceTenantTerminationScopeAuthorities
} from "./inbox-v2/data-governance-privacy";
import { accounts } from "./tables";

const globalTableNames = [
  "inbox_v2_data_governance_registry_versions",
  "inbox_v2_data_governance_storage_roots",
  "inbox_v2_data_governance_lifecycle_handlers",
  "inbox_v2_data_governance_data_use_lineages",
  "inbox_v2_data_governance_policy_templates",
  "inbox_v2_data_governance_policy_template_rules"
];

const tenantTableNames = [
  "inbox_v2_data_governance_contexts",
  "inbox_v2_data_governance_context_purpose_roles",
  "inbox_v2_data_governance_effective_policies",
  "inbox_v2_data_governance_effective_policy_rules",
  "inbox_v2_data_governance_policy_activations",
  "inbox_v2_data_governance_policy_activation_heads",
  "inbox_v2_data_governance_lifecycle_purpose_sets",
  "inbox_v2_data_governance_lifecycle_purpose_instances",
  "inbox_v2_data_governance_subject_links",
  "inbox_v2_data_governance_scope_manifests",
  "inbox_v2_data_governance_tenant_termination_scope_authorities",
  "inbox_v2_data_governance_scope_manifest_roots",
  "inbox_v2_data_governance_legal_hold_revisions",
  "inbox_v2_data_governance_legal_hold_data_classes",
  "inbox_v2_data_governance_legal_hold_targets",
  "inbox_v2_data_governance_legal_hold_heads",
  "inbox_v2_data_governance_restriction_revisions",
  "inbox_v2_data_governance_restriction_heads",
  "inbox_v2_data_governance_control_set_heads",
  "inbox_v2_data_governance_privacy_request_revisions",
  "inbox_v2_data_governance_privacy_request_aliases",
  "inbox_v2_data_governance_privacy_request_heads",
  "inbox_v2_data_governance_export_jobs",
  "inbox_v2_data_governance_export_manifests",
  "inbox_v2_data_governance_export_artifacts",
  "inbox_v2_data_governance_export_artifact_heads",
  "inbox_v2_data_governance_export_claims",
  "inbox_v2_data_governance_export_receipt_cas",
  "inbox_v2_data_governance_deletion_plans",
  "inbox_v2_data_governance_deletion_checkpoint_requirements",
  "inbox_v2_data_governance_deletion_runs",
  "inbox_v2_data_governance_deletion_run_terminal_exports",
  "inbox_v2_data_governance_deletion_stage_one_targets",
  "inbox_v2_data_governance_destructive_checkpoint_leases",
  "inbox_v2_data_governance_operated_checkpoint_attempts",
  "inbox_v2_data_governance_operated_checkpoint_heads",
  "inbox_v2_data_governance_backup_checkpoint_attempts",
  "inbox_v2_data_governance_backup_checkpoint_heads",
  "inbox_v2_data_governance_external_checkpoint_attempts",
  "inbox_v2_data_governance_external_checkpoint_heads",
  "inbox_v2_data_governance_erasure_restore_ledger",
  "inbox_v2_data_governance_erasure_restore_ledger_evidence",
  "inbox_v2_data_governance_erasure_restore_ledger_controls",
  "inbox_v2_data_governance_restore_heads",
  "inbox_v2_data_governance_restore_required_controls",
  "inbox_v2_data_governance_restore_leases"
];

const invariantSql = [
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_COHERENCE_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_CHECKPOINT_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL,
  INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL
].join("\n");

describe("Inbox V2 data-governance/privacy persistence schema", () => {
  it("registers the exact global and tenant-owned table groups", () => {
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_GLOBAL_TABLES.map(
        (table) => getTableConfig(table).name
      )
    ).toEqual(globalTableNames);
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_TENANT_TABLES.map(
        (table) => getTableConfig(table).name
      )
    ).toEqual(tenantTableNames);
  });

  it("indexes retention purpose revisions and active exact-hold lookups", () => {
    expectIndex(
      inboxV2DataGovernanceLifecyclePurposeInstances,
      "inbox_v2_dg_purpose_instance_tenant_idx",
      [
        "tenant_id",
        "purpose_id",
        "anchor_at",
        "purpose_set_id",
        "purpose_set_revision"
      ]
    );
    expectIndex(
      inboxV2DataGovernanceLegalHoldDataClasses,
      "inbox_v2_dg_hold_data_class_tenant_idx",
      ["tenant_id", "data_class_id", "hold_id", "hold_revision"]
    );

    const activeRootLookup = getTableConfig(
      inboxV2DataGovernanceLegalHoldTargets
    ).indexes.find(
      (candidate) =>
        candidate.config.name === "inbox_v2_dg_hold_active_root_lookup_idx"
    );
    expect(activeRootLookup?.config.columns.map(indexColumnName)).toEqual([
      "tenant_id",
      "storage_root_id",
      "root_record_id",
      "hold_id",
      "hold_revision"
    ]);
    if (!activeRootLookup?.config.where) {
      throw new Error("Missing active legal-hold lookup predicate.");
    }
    expect(
      new PgDialect().sqlToQuery(activeRootLookup.config.where).sql
    ).toContain(`"state" = 'active'`);
  });

  it("keeps global registries/templates tenant-free and tenant tables fenced", () => {
    for (const table of INBOX_V2_DATA_GOVERNANCE_PRIVACY_GLOBAL_TABLES) {
      expect(columnNames(table)).not.toContain("tenant_id");
    }
    expect(columnNames(inboxV2DataGovernancePolicyTemplates)).not.toContain(
      "tenant_id"
    );

    for (const table of INBOX_V2_DATA_GOVERNANCE_PRIVACY_TENANT_TABLES) {
      const config = getTableConfig(table);
      expect(
        config.columns.find((column) => column.name === "tenant_id")?.notNull
      ).toBe(true);
      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });

  it("rejects missing registered roots and lifecycle handlers with exact FKs", () => {
    expectForeignKey(
      inboxV2DataGovernanceDataUseLineages,
      "inbox_v2_dg_lineages_root_fk",
      inboxV2DataGovernanceStorageRoots,
      ["registry_id", "registry_revision", "storage_root_id"]
    );
    expectForeignKey(
      inboxV2DataGovernanceDataUseLineages,
      "inbox_v2_dg_lineages_lifecycle_handler_fk",
      inboxV2DataGovernanceLifecycleHandlers,
      ["registry_id", "registry_revision", "lifecycle_handler_id"]
    );
    expectForeignKey(
      inboxV2DataGovernanceDeletionCheckpointRequirements,
      "inbox_v2_dg_checkpoint_requirement_expiry_fk",
      inboxV2DataGovernanceLifecycleHandlers,
      ["registry_id", "registry_revision", "expiry_ledger_handler_id"]
    );
    expectForeignKey(
      inboxV2DataGovernanceDestructiveCheckpointLeases,
      "inbox_v2_dg_destructive_lease_requirement_fk",
      inboxV2DataGovernanceDeletionCheckpointRequirements,
      ["tenant_id", "plan_id", "plan_revision", "checkpoint_id"]
    );
    expectForeignKey(
      inboxV2DataGovernanceExportClaims,
      "inbox_v2_dg_export_claim_manifest_fk",
      inboxV2DataGovernanceExportManifests,
      ["tenant_id", "manifest_id", "manifest_revision"]
    );
    expectForeignKey(
      inboxV2DataGovernanceExportReceiptCas,
      "inbox_v2_dg_export_receipt_claim_fk",
      inboxV2DataGovernanceExportClaims,
      ["tenant_id", "artifact_claim_key"]
    );
  });

  it("requires the Account discovery edge to stay inside the subject-link tenant", () => {
    const accountTenantKey = getTableConfig(accounts).uniqueConstraints.find(
      ({ name }) => name === "accounts_tenant_id_unique"
    );
    expect(accountTenantKey).toBeDefined();
    expect(accountTenantKey?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id"
    ]);

    const accountForeignKey = getTableConfig(
      inboxV2DataGovernanceSubjectLinks
    ).foreignKeys.find(
      (candidate) =>
        candidate.getName() === "inbox_v2_dg_subject_link_account_fk"
    );
    expect(accountForeignKey).toBeDefined();
    const reference = accountForeignKey?.reference();
    expect(reference?.foreignTable).toBe(accounts);
    expect(reference?.columns.map((column) => column.name)).toEqual([
      "tenant_id",
      "account_id"
    ]);
    expect(reference?.foreignColumns.map((column) => column.name)).toEqual([
      "tenant_id",
      "id"
    ]);
  });

  it("makes residual deletion results truthful in DDL", () => {
    const runColumns = columnNames(inboxV2DataGovernanceDeletionRuns);
    expect(runColumns).toContain("state_revision");
    expect(runColumns).toContain("updated_at");
    expect(runColumns).toContain("state_hash");
    expect(runColumns).not.toContain("canonical_snapshot");
    const runValuesSql = checkSql(
      inboxV2DataGovernanceDeletionRuns,
      "inbox_v2_dg_deletion_run_values_check"
    );
    expect(runValuesSql).toMatch(/"operated_checkpoint_count" >= 1/u);

    expect(
      checkSql(
        inboxV2DataGovernanceDeletionRuns,
        "inbox_v2_dg_deletion_run_internal_check"
      )
    ).toContain("verification_blocked_internal_residual");
    const externalSql = checkSql(
      inboxV2DataGovernanceDeletionRuns,
      "inbox_v2_dg_deletion_run_external_check"
    );
    expect(externalSql).toContain("completed_with_external_residuals");
    expect(externalSql).toContain("has_external_residual");
    expect(externalSql).toContain("has_internal_residual");

    const backupRunSql = checkSql(
      inboxV2DataGovernanceDeletionRuns,
      "inbox_v2_dg_deletion_run_backup_check"
    );
    expect(backupRunSql).toContain("primary_absence_verified");
    expect(backupRunSql).toContain("backup_latest_possible_expiry_at");

    const backupAttemptSql = checkSql(
      inboxV2DataGovernanceBackupCheckpointAttempts,
      "inbox_v2_dg_backup_attempt_pending_check"
    );
    expect(backupAttemptSql).toContain("finite_expiry_pending");
    expect(backupAttemptSql).toContain("primary_absence_verified");
    expect(backupAttemptSql).toContain("latest_possible_expiry_at");
  });

  it("declares composite FK parent anchors as constraints before child FKs", () => {
    expect(
      getTableConfig(inboxV2DataGovernanceDeletionRuns).uniqueConstraints.map(
        ({ name }) => name
      )
    ).toContain("inbox_v2_dg_deletion_run_plan_anchor_unique");
    expect(
      getTableConfig(
        inboxV2DataGovernanceErasureRestoreLedger
      ).uniqueConstraints.map(({ name }) => name)
    ).toEqual(
      expect.arrayContaining([
        "inbox_v2_dg_erasure_ledger_entry_anchor_unique",
        "inbox_v2_dg_erasure_ledger_hash_unique"
      ])
    );
  });

  it("requires an immutable exact stage-one target and tombstone proof set", () => {
    expectForeignKey(
      inboxV2DataGovernanceDeletionStageOneTargets,
      "inbox_v2_dg_deletion_stage_one_target_run_fk",
      inboxV2DataGovernanceDeletionRuns,
      ["tenant_id", "run_id", "run_revision", "plan_id", "plan_revision"]
    );
    expectForeignKey(
      inboxV2DataGovernanceDeletionStageOneTargets,
      "inbox_v2_dg_deletion_stage_one_target_requirement_fk",
      inboxV2DataGovernanceDeletionCheckpointRequirements,
      ["tenant_id", "plan_id", "plan_revision", "checkpoint_id"]
    );
    expect(columnNames(inboxV2DataGovernanceDeletionStageOneTargets)).toEqual(
      expect.arrayContaining([
        "expected_revision",
        "resulting_revision",
        "tombstone_tenant_id",
        "tombstone_record_id",
        "tombstone_schema_id",
        "tombstone_schema_version",
        "tombstone_digest",
        "invalidation_digest",
        "committed_at"
      ])
    );
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).toContain("'inbox_v2_data_governance_deletion_stage_one_targets'");
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "deletion_stage_one_target_coherence"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "exact relational operated-checkpoint proof set"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "new.resulting_revision > requirement.expected_entity_revision"
    );
  });

  it("materializes the required hold lookup and exactly-once export claims", () => {
    expectIndex(
      inboxV2DataGovernanceLegalHoldTargets,
      "inbox_v2_dg_hold_lookup_idx",
      [
        "tenant_id",
        "storage_root_id",
        "entity_type_id",
        "entity_id",
        "state",
        "hold_id"
      ]
    );
    expectUniqueIndex(
      inboxV2DataGovernanceExportClaims,
      "inbox_v2_dg_export_claim_artifact_unique",
      ["tenant_id", "artifact_claim_key"]
    );
    expectUniqueIndex(
      inboxV2DataGovernanceExportClaims,
      "inbox_v2_dg_export_claim_receipt_unique",
      ["tenant_id", "receipt_key"]
    );
    expect(
      checkSql(
        inboxV2DataGovernanceExportReceiptCas,
        "inbox_v2_dg_export_receipt_state_check"
      )
    ).toContain("consumed_at");
  });

  it("persists general approval principals without pretending every actor is an employee", () => {
    const columns = columnNames(inboxV2DataGovernancePolicyActivations);
    expect(columns).toContain("requester_principal_kind");
    expect(columns).toContain("requester_decision_hash");
    expect(columns).toContain("approver_principal_kind");
    expect(columns).toContain("approver_decision_hash");
    expect(columns).not.toContain("requester_employee_id");
    expect(columns).not.toContain("approver_employee_id");
  });

  it("freezes the complete destructive-lease authorization snapshot and lifetime", () => {
    expect(
      columnNames(inboxV2DataGovernanceDestructiveCheckpointLeases)
    ).toEqual(
      expect.arrayContaining([
        "authorization_decision_id",
        "authorization_epoch",
        "authorization_principal_kind",
        "authorization_principal_key",
        "authorization_permission_id",
        "authorization_resource_scope_id",
        "authorization_resource_entity_type_id",
        "authorization_resource_entity_id",
        "authorization_resource_access_revision",
        "authorization_decision_revision",
        "authorization_decision_hash",
        "authorization_outcome",
        "authorization_decided_at",
        "authorization_not_after"
      ])
    );

    const authorizationSql = checkSql(
      inboxV2DataGovernanceDestructiveCheckpointLeases,
      "inbox_v2_dg_destructive_lease_authorization_check"
    );
    expect(authorizationSql).toContain("authorization_decided_at");
    expect(authorizationSql).toContain("authorization_not_after");

    const timeSql = checkSql(
      inboxV2DataGovernanceDestructiveCheckpointLeases,
      "inbox_v2_dg_destructive_lease_time_check"
    );
    expect(timeSql).toContain("authorization_decided_at");
    expect(timeSql).toContain("authorization_not_after");
    expect(timeSql).toContain("lease_expires_at");
    const unqualifiedTimeSql = timeSql.replaceAll(
      '"inbox_v2_data_governance_destructive_checkpoint_leases".',
      ""
    );
    expect(unqualifiedTimeSql).toContain(
      '"authorization_decided_at" <= "claimed_at"'
    );
    expect(unqualifiedTimeSql).toContain(
      '"lease_expires_at" <= "authorization_not_after"'
    );
  });

  it("stores only typed opaque privacy aliases and typed ledger evidence", () => {
    const aliasColumns = columnNames(
      inboxV2DataGovernancePrivacyRequestAliases
    );
    expect(aliasColumns).toContain("subject_kind");
    expect(aliasColumns).toContain("subject_reference_key");
    expect(aliasColumns).toContain("normalized_external_subject_digest");
    expect(aliasColumns).not.toContain("alias");
    expect(aliasColumns).not.toContain("namespace");

    const evidenceColumns = columnNames(
      inboxV2DataGovernanceErasureRestoreLedgerEvidence
    );
    expect(evidenceColumns).toEqual(
      expect.arrayContaining([
        "slot",
        "kind",
        "digest",
        "payload_tenant_id",
        "payload_record_id",
        "payload_schema_id",
        "payload_schema_version"
      ])
    );
    const ledgerColumns = columnNames(
      inboxV2DataGovernanceErasureRestoreLedger
    );
    expect(ledgerColumns).not.toContain("canonical_snapshot");
    expect(ledgerColumns).not.toContain("copy_role");
    expect(ledgerColumns).not.toContain("handler_id");
  });

  it("uses the exact erasure/restore ledger kind contract", () => {
    expect(inboxV2DataGovernanceLedgerKind.enumValues).toEqual([
      "erasure_applied",
      "hold_applied",
      "restriction_applied",
      "hold_released",
      "restriction_released",
      "restore_opened",
      "control_reapplied",
      "restore_sealed"
    ]);
  });

  it("persists a database-owned restore head, exact control set, lease and release lineage", () => {
    expect(columnNames(inboxV2DataGovernanceRestoreHeads)).toEqual(
      expect.arrayContaining([
        "source_erasure_entry_hash",
        "opened_entry_hash",
        "opened_complete_through_position",
        "control_set_head_revision",
        "required_control_set_hash",
        "sealed_entry_hash",
        "head_revision"
      ])
    );
    expect(columnNames(inboxV2DataGovernanceRestoreRequiredControls)).toEqual(
      expect.arrayContaining([
        "control_head_revision",
        "source_control_entry_hash",
        "reapplied_entry_hash",
        "row_revision"
      ])
    );
    expect(columnNames(inboxV2DataGovernanceRestoreLeases)).toEqual(
      expect.arrayContaining([
        "lease_token_hash",
        "lease_revision",
        "restore_head_revision",
        "lease_expires_at"
      ])
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL).toContain(
      "inbox_v2_dg_restore_current_controls"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL).toContain(
      "hold_released"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL).toContain(
      "latest tamper-resistant ledger state"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL).toContain(
      "new.updated_at <= old.updated_at"
    );
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).not.toContain("'inbox_v2_data_governance_restore_heads'");
  });

  it("scopes ledger-only restore coherence fields before shared constraint triggers inspect NEW", () => {
    const restoreSql = INBOX_V2_DATA_GOVERNANCE_PRIVACY_LEDGER_INVARIANTS_SQL;

    expect(restoreSql).toContain(
      "if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger' then\n    if new.kind = 'control_reapplied'"
    );
    expect(restoreSql).not.toMatch(
      /if tg_table_name = 'inbox_v2_data_governance_erasure_restore_ledger'\s+and new\.kind/u
    );
    for (const triggerName of [
      "inbox_v2_dg_restore_ledger_state_coherence",
      "inbox_v2_dg_restore_head_state_coherence",
      "inbox_v2_dg_restore_required_state_coherence",
      "inbox_v2_dg_restore_lease_state_coherence"
    ]) {
      expect(restoreSql).toContain(`create constraint trigger ${triggerName}`);
    }
  });

  it("persists one CAS job authority and immutable artifact revisions behind a current head", () => {
    expect(columnNames(inboxV2DataGovernanceExportJobs)).toEqual(
      expect.arrayContaining([
        "state_revision",
        "scope_manifest_id",
        "governance_context_hash",
        "policy_hash",
        "activation_hash",
        "export_artifact_id",
        "export_artifact_revision"
      ])
    );
    expect(columnNames(inboxV2DataGovernanceExportArtifacts)).toEqual(
      expect.arrayContaining([
        "artifact_claim_key",
        "manifest_id",
        "manifest_hash",
        "payload_checksum",
        "payload_locator",
        "recorded_at"
      ])
    );
    expect(columnNames(inboxV2DataGovernanceExportArtifactHeads)).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "artifact_id",
        "artifact_claim_key",
        "current_revision",
        "current_state"
      ])
    );
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).not.toContain("'inbox_v2_data_governance_export_jobs'");
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).toContain("'inbox_v2_data_governance_export_artifacts'");
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL).toContain(
      "Export job requires immutable authority, legal edge and +1 state CAS"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_CAS_INVARIANTS_SQL).toContain(
      "Export artifact head requires immutable authority, legal edge and next revision"
    );
  });

  it("persists exact tenant-offboarding scope and terminal export authority without JSON lookup", () => {
    expect(
      columnNames(inboxV2DataGovernanceTenantTerminationScopeAuthorities)
    ).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "manifest_id",
        "manifest_revision",
        "registry_composition_hash",
        "root_set_hash",
        "export_root_set_hash",
        "proof_hash",
        "governance_context_hash",
        "policy_hash",
        "activation_hash"
      ])
    );
    expect(columnNames(inboxV2DataGovernanceExportManifests)).toEqual(
      expect.arrayContaining([
        "scope_manifest_id",
        "scope_manifest_revision",
        "scope_proof_hash",
        "root_set_hash",
        "stream_epoch",
        "sync_generation",
        "complete_through_position"
      ])
    );
    expect(
      columnNames(inboxV2DataGovernanceDeletionRunTerminalExports)
    ).toEqual(
      expect.arrayContaining([
        "tenant_id",
        "run_id",
        "run_revision",
        "job_id",
        "job_revision",
        "manifest_id",
        "manifest_revision",
        "artifact_id",
        "artifact_revision",
        "bound_at"
      ])
    );
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).toContain(
      "'inbox_v2_data_governance_tenant_termination_scope_authorities'"
    );
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).toContain("'inbox_v2_data_governance_deletion_run_terminal_exports'");
    expect(invariantSql).toContain(
      "Tenant deployment export job lacks exact current scope/policy authority"
    );
    expect(invariantSql).toContain(
      "Deletion run terminal export is not exact, current, ready or unexpired"
    );
    expect(invariantSql).toContain(
      "Deletion run terminal-export binding does not match its cause"
    );
    expect(invariantSql).toContain("new.bound_at >= dr.started_at");
    expect(invariantSql).toContain("new.bound_at <= clock_timestamp()");
    expect(invariantSql).toContain(
      "after insert on public.inbox_v2_data_governance_deletion_runs"
    );
  });

  it("exports deferred coherence, append-only, CAS, and fence enforcement SQL", () => {
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).toContain("before update or delete");
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain(
      "artifact_claim_key = new.artifact_claim_key"
    );
    expect(invariantSql).toContain("state = 'ready'");
    expect(invariantSql).toContain("requirement_hash");
    expect(invariantSql).toContain("execution_fence_hash");
    expect(invariantSql).toContain("policy_activation_heads");
    expect(invariantSql).toContain("for update");
    expect(invariantSql).toContain("source_control_entry_hash");
    expect(invariantSql).toContain("prev.sequence = new.sequence - 1");
    expect(invariantSql).toContain(
      "new.sync_generation > prev.sync_generation"
    );
    expect(invariantSql).toContain("active current legal hold");
    expect(invariantSql).toContain("exact checkpoint outcomes");
    expect(
      INBOX_V2_DATA_GOVERNANCE_PRIVACY_IMMUTABILITY_INVARIANTS_SQL
    ).not.toContain("'inbox_v2_data_governance_deletion_runs'");
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "deletion_run_transition_guard"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "new.state_revision <> old.state_revision + 1"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "old.state = 'terminal'"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "after insert or update"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "new.stage_one_committed_at > new.updated_at"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "new.committed_at <= clock_timestamp()"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "Stage-one commit cannot report destructive checkpoint outcomes"
    );
    expect(INBOX_V2_DATA_GOVERNANCE_PRIVACY_TERMINAL_INVARIANTS_SQL).toContain(
      "Pending deletion stage one cannot report destructive checkpoint aggregates"
    );

    const functionCount =
      invariantSql.match(/create or replace function public\./g)?.length ?? 0;
    const searchPathCount =
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
        ?.length ?? 0;
    expect(functionCount).toBeGreaterThanOrEqual(6);
    expect(searchPathCount).toBe(functionCount);
    expect(invariantSql).not.toMatch(/\b(?:from|join|update) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);
  });
});

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  expect(foreignKey?.reference().foreignTable).toBe(foreignTable);
  expect(foreignKey?.reference().columns.map((column) => column.name)).toEqual(
    columns
  );
}

function expectIndex(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  columns: string[]
): void {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  expect(tableIndex).toBeDefined();
  expect(tableIndex?.config.columns.map(indexColumnName)).toEqual(columns);
}

function expectUniqueIndex(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  columns: string[]
): void {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  expect(tableIndex?.config.unique).toBe(true);
  expect(tableIndex?.config.columns.map(indexColumnName)).toEqual(columns);
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing expected check: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in column && typeof column.name === "string"
    ? column.name
    : undefined;
}
