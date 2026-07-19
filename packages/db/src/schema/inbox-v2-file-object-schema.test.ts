import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_FILE_OBJECT_INVARIANTS_SQL,
  inboxV2FileAttachmentMaterializationAttempts,
  inboxV2FileAttachmentMaterializationEvidence,
  inboxV2FileAttachmentMaterializationJobs,
  inboxV2FileDerivativeEdges,
  inboxV2FileObjectOperationEvidence,
  inboxV2FileObjects,
  inboxV2FileObjectVersionHeads,
  inboxV2FileObjectVersions,
  inboxV2FileOutboundArtifactBlocks,
  inboxV2FileOutboundArtifactPlans,
  inboxV2FileOutboundDispatchPlans,
  inboxV2FileParentLinkHeads,
  inboxV2FileParentLinks,
  inboxV2FileParentSetHeads,
  inboxV2FileStorageOrphans,
  inboxV2FileVersions
} from "./inbox-v2/file-object";
import { inboxV2TimelineContentPayloads } from "./inbox-v2/timeline-message";
import { inboxV2DomainEvents } from "./inbox-v2/authorization-relations";
import { initialTables } from "./metadata";

describe("Inbox V2 file/object schema", () => {
  it("registers all 16 additive tenant-scoped file authority relations", () => {
    expect(fileObjectTables.map((table) => getTableConfig(table).name)).toEqual(
      expectedTableNames
    );

    const metadata = new Map<string, (typeof initialTables)[number]>(
      initialTables.map((definition) => [definition.name, definition])
    );
    for (const table of fileObjectTables) {
      const config = getTableConfig(table);
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
      expect(metadata.get(config.name)).toMatchObject({
        scope: "tenant",
        requiresTenantId: true
      });
      expect(jsonColumnNames(table)).toEqual([]);
      expect(config.indexes.length).toBeGreaterThan(0);
      for (const tableIndex of config.indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        expect(reference.columns[0]?.name).toBe("tenant_id");
        expect(reference.foreignColumns[0]?.name).toBe(
          getTableConfig(reference.foreignTable).name === "tenants"
            ? "id"
            : "tenant_id"
        );
      }
      const tenantCascade = config.foreignKeys.find((candidate) => {
        const reference = candidate.reference();
        return getTableConfig(reference.foreignTable).name === "tenants";
      });
      expect(tenantCascade?.onDelete).toBe("cascade");
    }
  });

  it("rejects direct durable deletes while preserving only a real tenant cascade", () => {
    const invariantSql = INBOX_V2_FILE_OBJECT_INVARIANTS_SQL;
    expect(invariantSql).toMatch(
      /inbox_v2_file_delete_is_tenant_cascade[\s\S]*?pg_catalog\.pg_trigger_depth\(\) > 1[\s\S]*?not exists \([\s\S]*?from public\.tenants/u
    );
    for (const trigger of [
      "inbox_v2_file_objects_guard_trigger",
      "inbox_v2_file_object_version_heads_guard_trigger",
      "inbox_v2_file_mat_jobs_guard_trigger",
      "inbox_v2_file_storage_orphans_guard_trigger",
      "inbox_v2_file_parent_link_heads_guard_trigger",
      "inbox_v2_file_parent_set_heads_guard_trigger",
      "inbox_v2_file_object_versions_immutable_trigger",
      "inbox_v2_file_versions_immutable_trigger",
      "inbox_v2_file_mat_attempts_immutable_trigger",
      "inbox_v2_file_mat_evidence_immutable_trigger",
      "inbox_v2_file_operation_evidence_immutable_trigger",
      "inbox_v2_file_parent_links_immutable_trigger",
      "inbox_v2_file_derivative_edges_immutable_trigger",
      "inbox_v2_file_dispatch_plans_immutable_trigger",
      "inbox_v2_file_artifact_plans_immutable_trigger",
      "inbox_v2_file_artifact_blocks_immutable_trigger"
    ]) {
      const triggerOffset = invariantSql.indexOf(`create trigger ${trigger}`);
      expect(triggerOffset).toBeGreaterThan(-1);
      expect(invariantSql.slice(triggerOffset, triggerOffset + 320)).toContain(
        "delete"
      );
    }
    expect(invariantSql).toContain(
      "public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id)"
    );
  });

  it("permits only evidence-bound materialization readiness before physical lifecycle handlers", () => {
    const invariantSql = INBOX_V2_FILE_OBJECT_INVARIANTS_SQL;
    expect(invariantSql).toMatch(
      /inbox_v2_file_object_head_guard\(\)[\s\S]*?old\.state <> 'pending' or new\.state <> 'ready'[\s\S]*?operation_kind = 'put'[\s\S]*?job_row\.state in \('claimed', 'transferring', 'verifying'\)/u
    );
    expect(invariantSql).toMatch(
      /inbox_v2_file_object_version_head_guard\(\)[\s\S]*?old\.state <> 'staging'[\s\S]*?new\.state <> 'ready'[\s\S]*?evidence_row\.operation_kind = 'put'[\s\S]*?evidence_row\.completed_at = new\.state_changed_at/u
    );
    expect(invariantSql).toContain(
      "message_row.revision >= job_row.expected_parent_revision"
    );
    expect(invariantSql).toContain(
      "content_row.revision >= job_row.expected_content_revision"
    );
    expect(invariantSql).toContain(
      "current_payload_row.attachment_id = job_row.attachment_id"
    );
    expect(invariantSql).toMatch(
      /requires_current_fence :=[\s\S]*?job_row\.state in \('ready', 'failed', 'quarantined'\)[\s\S]*?current_payload_row\.attachment_state::text = job_row\.state::text/u
    );
    expect(invariantSql).toMatch(
      /left join public\.inbox_v2_timeline_content_payloads origin_payload_row[\s\S]*?content_row\.state in \('privacy_erased', 'retention_purged'\)/u
    );
    expect(invariantSql).toMatch(
      /select exists \([\s\S]*?\) into identity_valid;[\s\S]*?if not identity_valid[\s\S]*?if job_row\.state = 'cancelled'/u
    );
  });

  it("separates logical files, immutable physical versions and mutable heads", () => {
    expect(columnNames(inboxV2FileObjectVersions)).toEqual(
      expect.arrayContaining([
        "storage_root_id",
        "storage_object_key",
        "storage_version_identity",
        "checksum_sha256",
        "size_bytes"
      ])
    );
    expect(column(inboxV2FileObjectVersions, "size_bytes").getSQLType()).toBe(
      "bigint"
    );
    expectForeignKey(
      inboxV2FileVersions,
      "inbox_v2_file_versions_object_version_fk",
      inboxV2FileObjectVersions,
      ["tenant_id", "object_version_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2FileObjectVersionHeads,
      "inbox_v2_file_object_version_heads_version_fk",
      inboxV2FileObjectVersions,
      ["tenant_id", "object_version_id"],
      ["tenant_id", "id"]
    );
    expect(
      foreignKey(inboxV2FileVersions, "inbox_v2_file_versions_file_fk").onDelete
    ).not.toBe("cascade");
    expect(
      checkSql(inboxV2FileVersions, "inbox_v2_file_versions_shape_check")
    ).toContain("file_version:");
  });

  it("persists restartable reservations, hashed leases and append-only completion evidence", () => {
    expect(columnNames(inboxV2FileAttachmentMaterializationJobs)).toEqual(
      expect.arrayContaining([
        "source_locator_kind",
        "source_locator_reference",
        "source_locator_digest_sha256",
        "reservation_namespace_generation",
        "cause_event_id",
        "correlation_id",
        "caused_at",
        "reserved_file_version_id",
        "reserved_object_version_id",
        "reserved_storage_root_id",
        "reserved_storage_object_key",
        "lease_token_hash",
        "lease_claimed_at",
        "content_mutation_fence_sha256"
      ])
    );
    expect(columnNames(inboxV2FileAttachmentMaterializationJobs)).not.toContain(
      "lease_token"
    );
    expect(
      columnNames(inboxV2FileAttachmentMaterializationAttempts)
    ).not.toContain("lease_token");
    expect(
      checkSql(
        inboxV2FileAttachmentMaterializationJobs,
        "inbox_v2_file_mat_jobs_shape_check"
      )
    ).toContain("lease_token_hash");
    expectForeignKey(
      inboxV2FileAttachmentMaterializationJobs,
      "inbox_v2_file_mat_jobs_cause_event_fk",
      inboxV2DomainEvents,
      ["tenant_id", "cause_event_id"],
      ["tenant_id", "id"]
    );
    const jobShape = checkSql(
      inboxV2FileAttachmentMaterializationJobs,
      "inbox_v2_file_mat_jobs_shape_check"
    );
    expect(jobShape).toContain("event:");
    expect(jobShape).toContain("correlation_id");
    expect(jobShape).toContain("caused_at");
    expect(jobShape).toContain("reservation_namespace_generation");
    expect(jobShape).toContain("core:attachment.materialization.reauthorize");
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toMatch(
      /reauthorization :=[\s\S]*?old\.state = 'pending'[\s\S]*?new\.state = 'pending'[\s\S]*?core:attachment\.materialization\.reauthorize[\s\S]*?if reauthorization then/u
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "new.reservation_namespace_generation is distinct from"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "cause_event_row.occurred_at = job_row.caused_at"
    );
    expect(
      uniqueColumns(
        inboxV2FileAttachmentMaterializationEvidence,
        "inbox_v2_file_mat_evidence_attempt_unique"
      )
    ).toEqual(["tenant_id", "job_id", "lease_generation"]);
    expect(columnNames(inboxV2FileStorageOrphans)).toEqual(
      expect.arrayContaining([
        "storage_root_id",
        "storage_object_key",
        "storage_version_identity",
        "size_bytes",
        "detected_media_type",
        "claim_token_hash"
      ])
    );
  });

  it("keeps exact parent facts immutable and liveness in a separately CASed head", () => {
    expect(columnNames(inboxV2FileParentLinks)).not.toEqual(
      expect.arrayContaining(["state", "detached_by_event_id"])
    );
    expect(columnNames(inboxV2FileParentLinkHeads)).toEqual(
      expect.arrayContaining([
        "link_id",
        "file_id",
        "state",
        "detached_by_event_id",
        "revision"
      ])
    );
    expectForeignKey(
      inboxV2FileParentLinkHeads,
      "inbox_v2_file_parent_link_heads_link_fk",
      inboxV2FileParentLinks,
      ["tenant_id", "link_id", "file_id"],
      ["tenant_id", "id", "file_id"]
    );
    expect(columnNames(inboxV2FileParentSetHeads)).toEqual(
      expect.arrayContaining([
        "completeness",
        "completeness_revision",
        "live_parent_count"
      ])
    );
  });

  it("stores explicit zero-count deletion authority and an acyclic derivative graph", () => {
    expect(columnNames(inboxV2FileObjectOperationEvidence)).toEqual(
      expect.arrayContaining([
        "expected_object_head_revision",
        "live_parent_count",
        "active_purpose_count",
        "active_hold_count",
        "deletion_authority_evaluated_at",
        "deletion_authority_decision_sha256"
      ])
    );
    const evidenceShape = checkSql(
      inboxV2FileObjectOperationEvidence,
      "inbox_v2_file_object_operation_evidence_shape_check"
    );
    expect(evidenceShape).toContain("live_parent_count");
    expect(evidenceShape).toContain("active_purpose_count");
    expect(evidenceShape).toContain("active_hold_count");
    expect(evidenceShape).toContain("= 0");
    expect(
      uniqueColumns(
        inboxV2FileDerivativeEdges,
        "inbox_v2_file_derivative_edges_transform_unique"
      )
    ).toEqual([
      "tenant_id",
      "original_file_version_id",
      "derived_file_version_id",
      "transform_profile_id",
      "transform_profile_version"
    ]);
    const invariantSql = INBOX_V2_FILE_OBJECT_INVARIANTS_SQL;
    const isolationGuardOffset = invariantSql.indexOf(
      "inbox_v2.file_derivative_isolation_unsafe"
    );
    const lockOffset = invariantSql.indexOf("pg_advisory_xact_lock");
    const cycleCheckOffset = invariantSql.indexOf(
      "with recursive descendants(file_version_id)"
    );
    expect(isolationGuardOffset).toBeGreaterThan(-1);
    expect(lockOffset).toBeGreaterThan(isolationGuardOffset);
    expect(cycleCheckOffset).toBeGreaterThan(lockOffset);
    expect(invariantSql).toContain(
      "pg_catalog.current_setting('transaction_isolation') <> 'read committed'"
    );
    expect(invariantSql).toContain(
      "'core:inbox-v2.file-derivative-graph:' || new.tenant_id"
    );
    expect(invariantSql).toMatch(
      /inbox_v2_file_derivative_cycle_guard\(\)[\s\S]*?language plpgsql\s+volatile\s+set search_path/u
    );
  });

  it("pins immutable outbound plans to exact route, capability, content and object blocks", () => {
    expect(columnNames(inboxV2FileOutboundDispatchPlans)).toEqual(
      expect.arrayContaining([
        "message_id",
        "message_revision",
        "route_id",
        "content_fingerprint_purpose_id",
        "content_fingerprint_key_generation",
        "content_fingerprint_valid_until",
        "content_fingerprint_hmac_sha256",
        "binding_id",
        "binding_revision",
        "capability_revision",
        "adapter_contract_declaration_revision",
        "adapter_loaded_by_trusted_service_id",
        "adapter_loaded_at",
        "plan_digest_sha256",
        "block_count",
        "artifact_count"
      ])
    );
    expect(columnNames(inboxV2FileOutboundArtifactPlans)).toEqual(
      expect.arrayContaining(["grouping", "capability_id", "operation_id"])
    );
    const dispatchPlanShape = checkSql(
      inboxV2FileOutboundDispatchPlans,
      "inbox_v2_file_outbound_dispatch_plans_shape_check"
    );
    expect(dispatchPlanShape).toContain(
      "adapter_contract_declaration_revision"
    );
    expect(dispatchPlanShape).toContain("core:outbound_dispatch_content_plan");
    expect(dispatchPlanShape).toContain("content_fingerprint_valid_until");
    expect(dispatchPlanShape).toContain("hmac-sha256:");
    expect(columnNames(inboxV2FileOutboundDispatchPlans)).not.toContain(
      "content_digest_sha256"
    );
    expect(dispatchPlanShape).toContain("adapter_loaded_by_trusted_service_id");
    expect(dispatchPlanShape).toContain("isfinite");
    expect(dispatchPlanShape).toContain("adapter_loaded_at");
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "content_row.state = 'available'"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).not.toContain(
      "plan_row.content_digest_sha256"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toMatch(
      /inbox_v2_file_dispatch_plan_coherence\(\)[\s\S]*?object_head_row\.state = 'ready'[\s\S]*?for share of file_row, object_head_row/u
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "inbox_v2.outbound_mixed_artifact_outcome_requires_operator"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toMatch(
      /inbox_v2_outbound_attempt_mixed_outcome_guard_trigger[\s\S]*?before insert or update on public\.inbox_v2_outbound_dispatch_attempts/u
    );
    expect(columnNames(inboxV2FileOutboundArtifactBlocks)).toEqual(
      expect.arrayContaining([
        "content_block_ordinal",
        "block_key",
        "block_kind",
        "file_revision",
        "file_version_id",
        "object_version_id"
      ])
    );
    expect(
      uniqueColumns(
        inboxV2FileOutboundArtifactBlocks,
        "inbox_v2_file_outbound_artifact_blocks_content_unique"
      )
    ).toEqual(["tenant_id", "content_plan_id", "content_block_ordinal"]);
  });

  it("bridges legacy files and exact V2 pins without requiring duplicate V1 rows", () => {
    expect(columnNames(inboxV2TimelineContentPayloads)).toEqual(
      expect.arrayContaining([
        "attachment_file_id",
        "attachment_v2_file_id",
        "attachment_file_revision",
        "attachment_file_version_id",
        "attachment_object_version_id",
        "extension_payload_file_id",
        "extension_payload_v2_file_id",
        "extension_payload_file_revision",
        "extension_payload_file_version_id",
        "extension_payload_object_version_id"
      ])
    );
    const pins = checkSql(
      inboxV2TimelineContentPayloads,
      "inbox_v2_timeline_content_payloads_version_pins_check"
    );
    expect(pins).toContain("attachment_v2_file_id");
    expect(pins).toContain("attachment_file_revision");
    expect(pins).toContain("attachment_file_id");
    expect(pins).toContain("extension_payload_v2_file_id");
    expect(pins).toContain("extension_payload_file_revision");
    expect(pins).toContain("extension_payload_file_id");
    const shape = checkSql(
      inboxV2TimelineContentPayloads,
      "inbox_v2_timeline_content_payloads_shape_check"
    );
    expect(shape).toContain("num_nonnulls");
    expect(shape).toContain("attachment_failure_reason_id");
    expect(shape).toContain("extension_payload_file_revision");
    expect(shape).toContain("contact_display_name");
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "inbox_v2_tm_payload_exact_pin_coherence"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "file_row.revision = new.attachment_file_revision"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "file_row.revision = new.extension_payload_file_revision"
    );
  });

  it("persists physical quarantine facts on non-adoptable storage orphans", () => {
    expect(columnNames(inboxV2FileStorageOrphans)).toEqual(
      expect.arrayContaining([
        "quarantine_reason_code",
        "quarantine_evidence_digest_sha256",
        "quarantine_physical_kind"
      ])
    );
    const shape = checkSql(
      inboxV2FileStorageOrphans,
      "inbox_v2_file_storage_orphans_shape_check"
    );
    expect(shape).toContain("= 'quarantined'");
    expect(shape).toContain("quarantine_reason_code");
    expect(shape).toContain("quarantine_evidence_digest_sha256");
    expect(shape).toContain("quarantine_physical_kind");
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "old.state in ('quarantined', 'adopted', 'deleted', 'failed')"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "old.state = 'open' and new.state in ('claimed', 'adopted', 'failed')"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toContain(
      "inbox_v2.file_storage_orphan_adoption_invalid"
    );
    expect(INBOX_V2_FILE_OBJECT_INVARIANTS_SQL).toMatch(
      /new\.state = 'adopted'[\s\S]*?evidence_row\.evidence_hash_sha256[\s\S]*?job_row\.state = 'ready'[\s\S]*?object_version_row\.storage_version_identity/u
    );
  });

  it("treats retention anchors as canonical parent time, not future expiry", () => {
    const shape = checkSql(
      inboxV2FileParentLinks,
      "inbox_v2_file_parent_links_shape_check"
    );
    expect(shape).toContain("isfinite");
    expect(shape).toContain("retention_anchor_at");
    expect(shape).not.toContain("retention_anchor_at >=");
  });

  it("installs strict CAS, completeness, cycle and dispatch coherence guards", () => {
    const invariantSql = INBOX_V2_FILE_OBJECT_INVARIANTS_SQL;
    expect(invariantSql).toContain(
      "attachment_materialization_transition_invalid"
    );
    expect(invariantSql).toContain("lease_token_hash");
    expect(invariantSql).toContain("file_storage_orphan_transition_invalid");
    expect(invariantSql).toContain("inbox_v2_file_parent_link_heads");
    expect(invariantSql).toContain("link_head_row.state = 'live'");
    expect(invariantSql).toContain("with recursive descendants");
    expect(invariantSql).toContain(
      "inbox_v2_source_thread_binding_capability_entries"
    );
    expect(invariantSql).toContain(
      "inbox_v2_source_thread_binding_capability_required_roles"
    );
    expect(invariantSql).toContain(
      "inbox_v2_source_thread_binding_provider_roles"
    );
    expect(invariantSql).toContain(
      "capability_row.content_kind_id is not distinct from"
    );
    expect(invariantSql).toContain(
      "capability_row.valid_until > plan_row.created_at"
    );
    expect(invariantSql).toContain("outbound_dispatch_block_mapping_invalid");
    expect(invariantSql).toContain("inbox_v2.outbound_artifact_retry_unsafe");
    expect(invariantSql).toContain(
      "artifact_row.attempt_id = new.unknown_attempt_id"
    );
    expect(invariantSql).toContain(
      "artifact_row.dispatch_id = new.dispatch_id"
    );
    expect(invariantSql).toContain("new.result_state = 'retryable_failure'");
    expect(invariantSql).toContain("artifact_row.state = 'accepted'");
    expect(invariantSql).toContain(
      "inbox_v2_outbound_accepted_artifact_retry_guard()"
    );
    expect(invariantSql).toContain("new.state = 'accepted'");
    expect(invariantSql).toContain(
      "decision_row.unknown_attempt_id = new.attempt_id"
    );
    expect(invariantSql).toContain(
      "decision_row.dispatch_id = new.dispatch_id"
    );
    expect(invariantSql).toContain(
      "inbox_v2.outbound_artifact_retry_isolation_unsafe"
    );
    expect(invariantSql).toMatch(
      /inbox_v2_outbound_artifact_retry_guard\(\)[\s\S]*?attempt_row\.message_id = new\.message_id\s+for update;/u
    );
    expect(invariantSql).toMatch(
      /inbox_v2_outbound_accepted_artifact_retry_guard\(\)[\s\S]*?attempt_row\.message_id = new\.message_id\s+for update;/u
    );
    expect(invariantSql).toContain(
      "route_row.adapter_declaration_revision =\n         plan_row.adapter_contract_declaration_revision"
    );
    expect(invariantSql).toContain(
      "route_row.adapter_loaded_by_trusted_service_id =\n         plan_row.adapter_loaded_by_trusted_service_id"
    );
    expect(invariantSql).toContain(
      "route_row.adapter_loaded_at = plan_row.adapter_loaded_at"
    );
    expect(invariantSql).toContain("deferrable initially deferred");
    for (const constraintName of [
      "inbox_v2_timeline_content_payloads_file_version_fk",
      "inbox_v2_timeline_content_payloads_object_version_fk",
      "inbox_v2_timeline_payloads_extension_file_version_fk",
      "inbox_v2_timeline_payloads_extension_object_version_fk"
    ]) {
      expect(invariantSql).toContain(
        `alter constraint ${constraintName}\n  deferrable initially deferred;`
      );
    }
    expect(invariantSql).not.toMatch(/\blease_token\b/u);
    expect(invariantSql).not.toContain("link_row.state");
    expect(invariantSql).not.toContain("segment_ordinal");
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/u);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/u);
  });
});

const fileObjectTables = [
  inboxV2FileObjects,
  inboxV2FileObjectVersions,
  inboxV2FileObjectVersionHeads,
  inboxV2FileVersions,
  inboxV2FileAttachmentMaterializationJobs,
  inboxV2FileObjectOperationEvidence,
  inboxV2FileAttachmentMaterializationAttempts,
  inboxV2FileAttachmentMaterializationEvidence,
  inboxV2FileStorageOrphans,
  inboxV2FileParentSetHeads,
  inboxV2FileParentLinks,
  inboxV2FileParentLinkHeads,
  inboxV2FileDerivativeEdges,
  inboxV2FileOutboundDispatchPlans,
  inboxV2FileOutboundArtifactPlans,
  inboxV2FileOutboundArtifactBlocks
] as const;

const expectedTableNames = [
  "inbox_v2_file_objects",
  "inbox_v2_file_object_versions",
  "inbox_v2_file_object_version_heads",
  "inbox_v2_file_versions",
  "inbox_v2_file_attachment_materialization_jobs",
  "inbox_v2_file_object_operation_evidence",
  "inbox_v2_file_attachment_materialization_attempts",
  "inbox_v2_file_attachment_materialization_evidence",
  "inbox_v2_file_storage_orphans",
  "inbox_v2_file_parent_set_heads",
  "inbox_v2_file_parent_links",
  "inbox_v2_file_parent_link_heads",
  "inbox_v2_file_derivative_edges",
  "inbox_v2_file_outbound_dispatch_plans",
  "inbox_v2_file_outbound_artifact_plans",
  "inbox_v2_file_outbound_artifact_blocks"
] as const;

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((candidate) => candidate.name);
}

function column(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): ReturnType<typeof getTableConfig>["columns"][number] {
  const result = getTableConfig(table).columns.find(
    (candidate) => candidate.name === name
  );
  if (!result) throw new Error(`Missing column: ${name}`);
  return result;
}

function foreignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): ReturnType<typeof getTableConfig>["foreignKeys"][number] {
  const result = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  if (!result) throw new Error(`Missing foreign key: ${name}`);
  return result;
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const reference = foreignKey(table, name).reference();
  expect(reference.foreignTable).toBe(foreignTable);
  expect(reference.columns.map((candidate) => candidate.name)).toEqual(columns);
  expect(reference.foreignColumns.map((candidate) => candidate.name)).toEqual(
    foreignColumns
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing check constraint: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string[] {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing unique constraint: ${name}`);
  return constraint.columns.map((candidate) => candidate.name);
}

function jsonColumnNames(
  table: Parameters<typeof getTableConfig>[0]
): string[] {
  return getTableConfig(table)
    .columns.filter((candidate) => candidate.getSQLType() === "jsonb")
    .map((candidate) => candidate.name);
}

function indexColumnName(
  columnValue: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in columnValue && typeof columnValue.name === "string"
    ? columnValue.name
    : undefined;
}
