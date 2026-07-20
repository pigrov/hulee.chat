import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { initialTables } from "./metadata";
import { normalizedInboundEvents } from "./tables";
import { inboxV2ExternalMessageReferences } from "./inbox-v2/outbound-transport";
import { inboxV2SourceOccurrences } from "./inbox-v2/source-occurrence";
import {
  inboxV2MessageProviderLifecycleOperations,
  inboxV2MessageRevisions
} from "./inbox-v2/timeline-message";
import {
  INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL,
  inboxV2DeferredMessageSourceActions,
  inboxV2DeferredMessageSourceActionTransitions,
  inboxV2DeferredSourceActionConflictCandidates,
  inboxV2DeferredSourceActionOrderingHeads,
  inboxV2SourceMessageCorrelationEvidence,
  inboxV2SourceMessageKeyRegistry
} from "./inbox-v2/source-message-reconciliation";

const reconciliationTables = [
  inboxV2SourceMessageKeyRegistry,
  inboxV2DeferredMessageSourceActions,
  inboxV2DeferredMessageSourceActionTransitions,
  inboxV2DeferredSourceActionConflictCandidates,
  inboxV2DeferredSourceActionOrderingHeads,
  inboxV2SourceMessageCorrelationEvidence
] as const;

describe("Inbox V2 source message reconciliation schema", () => {
  it("keeps every reconciliation surface tenant-scoped and additive", () => {
    expect(
      reconciliationTables.map((table) => getTableConfig(table).name)
    ).toEqual([
      "inbox_v2_source_message_key_registry",
      "inbox_v2_deferred_message_source_actions",
      "inbox_v2_deferred_message_source_action_transitions",
      "inbox_v2_deferred_source_action_conflict_candidates",
      "inbox_v2_deferred_source_action_ordering_heads",
      "inbox_v2_source_message_correlation_evidence"
    ]);
    for (const table of reconciliationTables) {
      expect(getTableConfig(table).columns[0]?.name).toBe("tenant_id");
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
    }
    const tenantMetadata = new Map<string, (typeof initialTables)[number]>(
      initialTables.map((table) => [table.name, table])
    );
    for (const table of reconciliationTables) {
      const definition = tenantMetadata.get(getTableConfig(table).name);
      expect(definition).toMatchObject({
        scope: "tenant",
        requiresTenantId: true
      });
    }
  });

  it("owns full external-message keys in one bounded collision registry", () => {
    expect(primaryKeyColumns(inboxV2SourceMessageKeyRegistry)).toEqual([
      ["tenant_id", "message_key_digest_sha256"]
    ]);
    expect(columnNames(inboxV2SourceMessageKeyRegistry)).toEqual(
      expect.arrayContaining([
        "message_realm_id",
        "message_realm_version",
        "message_canonicalization_version",
        "message_scope_kind",
        "message_scope_source_account_id",
        "message_scope_source_thread_binding_id",
        "message_object_kind_id",
        "external_thread_id",
        "canonical_external_subject",
        "external_message_key_detail",
        "external_message_key_detail_digest_sha256"
      ])
    );
    expect(
      checkSql(
        inboxV2SourceMessageKeyRegistry,
        "inbox_v2_source_message_key_registry_detail_check"
      )
    ).toContain("external_message_key_detail_digest_sha256");
    expectForeignKey(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_message_key_registry_fk",
      inboxV2SourceMessageKeyRegistry,
      ["tenant_id", "message_key_digest_sha256"],
      ["tenant_id", "message_key_digest_sha256"]
    );
    expectForeignKey(
      inboxV2DeferredSourceActionOrderingHeads,
      "inbox_v2_deferred_action_ordering_heads_key_registry_fk",
      inboxV2SourceMessageKeyRegistry,
      ["tenant_id", "message_key_digest_sha256"],
      ["tenant_id", "message_key_digest_sha256"]
    );
    const ddl = INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL;
    expect(ddl).toContain(
      "deferred_source_action_message_key_registry_mismatch"
    );
    expect(ddl).toContain(
      "deferred_source_ordering_head_message_key_registry_mismatch"
    );
    expect(ddl).toContain(
      "inbox_v2_source_message_key_registry_immutable_trigger"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_deferred_source_action_key_registry_trigger\nafter insert"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_deferred_source_head_key_registry_trigger\nafter insert or update"
    );
    expect(ddl).not.toContain(
      "create trigger inbox_v2_deferred_source_action_key_registry_trigger\nbefore insert"
    );
  });

  it("persists one exact-key action with the complete replay tuple", () => {
    expect(uniqueColumns(inboxV2DeferredMessageSourceActions)).toContainEqual([
      "tenant_id",
      "normalized_inbound_event_id",
      "source_occurrence_id",
      "semantic_id",
      "event_fingerprint_sha256"
    ]);
    expectForeignKey(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_occurrence_fk",
      inboxV2SourceOccurrences,
      ["tenant_id", "source_occurrence_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_event_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_applied_message_revision_fk",
      inboxV2MessageRevisions,
      ["tenant_id", "applied_message_id", "applied_message_revision"],
      ["tenant_id", "message_id", "message_revision"]
    );
    expectForeignKey(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_applied_provider_operation_fk",
      inboxV2MessageProviderLifecycleOperations,
      [
        "tenant_id",
        "applied_provider_lifecycle_operation_id",
        "applied_provider_lifecycle_operation_revision"
      ],
      ["tenant_id", "id", "revision"]
    );

    const columns = columnNames(inboxV2DeferredMessageSourceActions);
    expect(columns).toEqual(
      expect.arrayContaining([
        "message_key_digest_sha256",
        "external_message_key_detail",
        "external_message_key_detail_digest_sha256",
        "source_occurrence_detail",
        "source_occurrence_detail_digest_sha256",
        "action_detail",
        "action_detail_digest_sha256",
        "semantic_proof_detail",
        "semantic_proof_detail_digest_sha256",
        "applied_provider_lifecycle_operation_id",
        "applied_provider_lifecycle_operation_revision"
      ])
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "body",
        "content",
        "sender",
        "display_sender",
        "message_content"
      ])
    );
    expect(
      checkSql(
        inboxV2DeferredMessageSourceActions,
        "inbox_v2_deferred_actions_detail_check"
      )
    ).toContain("messageContent");
    expect(
      checkSql(
        inboxV2DeferredMessageSourceActions,
        "inbox_v2_deferred_actions_key_check"
      )
    ).toContain("external_message_key_detail_digest_sha256");
    const semanticCheck = checkSql(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_semantic_check"
    );
    for (const path of [
      "adapterContract,contractId",
      "adapterContract,loadedAt",
      "capabilityRevision",
      "semanticRevision",
      "actor,id",
      "declaredByTrustedServiceId",
      "occurredAt",
      "recordedAt"
    ]) {
      expect(semanticCheck).toContain(path);
    }
    expect(semanticCheck).toContain("jsonb_build_object");
    expect(semanticCheck).toContain("ordering_position");
    expect(semanticCheck).toContain("ordering_conflict_token");
    expect(semanticCheck).toContain("ordering_unavailable_reason_id");
    expect(
      getTableConfig(inboxV2DeferredMessageSourceActions).indexes.map(
        (tableIndex) => tableIndex.config.name
      )
    ).toContain("inbox_v2_deferred_actions_pending_key_idx");
  });

  it("models one terminal CAS transition and normalized conflict candidates", () => {
    expect(
      primaryKeyColumns(inboxV2DeferredMessageSourceActionTransitions)
    ).toEqual([["tenant_id", "action_id", "resulting_revision"]]);
    expect(
      uniqueColumns(inboxV2DeferredMessageSourceActionTransitions)
    ).toContainEqual(["tenant_id", "action_id"]);
    expectForeignKey(
      inboxV2DeferredSourceActionConflictCandidates,
      "inbox_v2_deferred_action_candidates_reference_fk",
      inboxV2ExternalMessageReferences,
      [
        "tenant_id",
        "external_message_reference_id",
        "external_thread_id",
        "message_id",
        "timeline_item_id",
        "message_key_digest_sha256"
      ],
      [
        "tenant_id",
        "id",
        "external_thread_id",
        "message_id",
        "timeline_item_id",
        "message_key_digest_sha256"
      ]
    );
    expectForeignKey(
      inboxV2DeferredMessageSourceActionTransitions,
      "inbox_v2_deferred_action_transitions_message_revision_fk",
      inboxV2MessageRevisions,
      ["tenant_id", "target_message_id", "applied_message_revision"],
      ["tenant_id", "message_id", "message_revision"]
    );
    expectForeignKey(
      inboxV2DeferredMessageSourceActionTransitions,
      "inbox_v2_deferred_action_transitions_provider_operation_fk",
      inboxV2MessageProviderLifecycleOperations,
      [
        "tenant_id",
        "applied_provider_lifecycle_operation_id",
        "applied_provider_lifecycle_operation_revision"
      ],
      ["tenant_id", "id", "revision"]
    );
    const candidateCheck = checkSql(
      inboxV2DeferredSourceActionConflictCandidates,
      "inbox_v2_deferred_action_candidates_values_check"
    );
    expect(candidateCheck).toContain('"ordinal" between 0 and 99');
    expect(candidateCheck).toContain("candidate_detail_digest_sha256");

    const stateCheck = checkSql(
      inboxV2DeferredMessageSourceActions,
      "inbox_v2_deferred_actions_state_check"
    );
    expect(stateCheck).toContain("\"state\" = 'pending'");
    expect(stateCheck).toContain("\"state\" = 'target_conflicted'");
    expect(stateCheck).toContain(
      '"conflict_candidate_count" between 2 and 100'
    );
    expect(stateCheck).toContain(
      "\"effect_kind\" = 'provider_delete_retain_local'"
    );
    expect(stateCheck).toContain(
      '"applied_provider_lifecycle_operation_revision" >= 1'
    );

    const transitionStateCheck = checkSql(
      inboxV2DeferredMessageSourceActionTransitions,
      "inbox_v2_deferred_action_transitions_state_check"
    );
    expect(transitionStateCheck).toContain(
      "\"after_state\" in ('stale', 'duplicate')"
    );
    expect(transitionStateCheck).toContain(
      '"applied_message_revision" is null'
    );
    expect(transitionStateCheck).toContain('"effect_kind" is null');
    expect(transitionStateCheck).toContain(
      '"source_occurrence_resolution_digest_sha256"'
    );
    expect(transitionStateCheck).toContain(") = 5");
    expect(transitionStateCheck).toContain(
      "\"effect_kind\" = 'provider_delete_retain_local'"
    );
    expect(transitionStateCheck).toContain(
      '"applied_provider_lifecycle_operation_id" is null'
    );
    const transitionOrderingCheck = checkSql(
      inboxV2DeferredMessageSourceActionTransitions,
      "inbox_v2_deferred_action_transitions_ordering_check"
    );
    expect(transitionOrderingCheck).toContain(
      "\"ordering_outcome\" not in ('stale', 'duplicate')"
    );
    expect(transitionOrderingCheck).toContain(
      '"expected_ordering_head_revision" is not null'
    );
  });

  it("scopes monotonic heads by exact key, lane, scope and comparator revision", () => {
    expect(primaryKeyColumns(inboxV2DeferredSourceActionOrderingHeads)).toEqual(
      [
        [
          "tenant_id",
          "message_key_digest_sha256",
          "lane",
          "scope_token",
          "comparator_id",
          "comparator_revision"
        ]
      ]
    );
    expectForeignKey(
      inboxV2DeferredSourceActionOrderingHeads,
      "inbox_v2_deferred_action_ordering_heads_latest_fk",
      inboxV2DeferredMessageSourceActions,
      [
        "tenant_id",
        "latest_action_id",
        "message_key_digest_sha256",
        "lane",
        "scope_token",
        "comparator_id",
        "comparator_revision",
        "latest_normalized_inbound_event_id",
        "latest_source_occurrence_id",
        "latest_semantic_id",
        "latest_event_fingerprint_sha256"
      ],
      [
        "tenant_id",
        "id",
        "message_key_digest_sha256",
        "lane",
        "ordering_scope_token",
        "ordering_comparator_id",
        "ordering_comparator_revision",
        "normalized_inbound_event_id",
        "source_occurrence_id",
        "semantic_id",
        "event_fingerprint_sha256"
      ]
    );
    const ddl = INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL;
    expect(ddl).toContain("deferred_source_ordering_head_cas");
    expect(ddl).toContain(
      'new.latest_position collate "C" <= old.latest_position collate "C"'
    );
    expect(ddl).toContain("action_row.external_message_key_detail =");
    expect(
      checkSql(
        inboxV2DeferredMessageSourceActions,
        "inbox_v2_deferred_actions_ordering_check"
      )
    ).toContain("between 1 and 128");
    expect(
      checkSql(
        inboxV2DeferredSourceActionOrderingHeads,
        "inbox_v2_deferred_action_ordering_heads_values_check"
      )
    ).toContain("between 1 and 128");
  });

  it("retains only finite target-free weak-correlation evidence", () => {
    expect(columnNames(inboxV2SourceMessageCorrelationEvidence)).toEqual([
      "tenant_id",
      "source_occurrence_id",
      "ordinal",
      "code_id",
      "evidence_hmac_sha256",
      "expires_at",
      "data_class_id",
      "sensitivity_class",
      "processing_purpose_id",
      "canonical_anchor_id",
      "expiry_action",
      "created_at"
    ]);
    expectForeignKey(
      inboxV2SourceMessageCorrelationEvidence,
      "inbox_v2_source_message_correlation_evidence_occurrence_fk",
      inboxV2SourceOccurrences,
      ["tenant_id", "source_occurrence_id"],
      ["tenant_id", "id"]
    );
    const values = checkSql(
      inboxV2SourceMessageCorrelationEvidence,
      "inbox_v2_source_message_correlation_evidence_values_check"
    );
    expect(values).toContain('"ordinal" between 0 and 7');
    expect(values).toContain("^hmac-sha256:[a-f0-9]{64}$");
    expect(values).toContain('"expires_at" >');
    expect(values).toContain("interval '30 days'");
    expect(
      uniqueColumns(inboxV2SourceMessageCorrelationEvidence)
    ).toContainEqual([
      "tenant_id",
      "source_occurrence_id",
      "code_id",
      "evidence_hmac_sha256"
    ]);
    const governance = checkSql(
      inboxV2SourceMessageCorrelationEvidence,
      "inbox_v2_source_message_correlation_evidence_governance_check"
    );
    expect(governance).toContain("core:operational_log_trace_diagnostic");
    expect(governance).toContain("security_evidence");
    expect(governance).toContain("core:source_replay_and_diagnostics");
    expect(governance).toContain("core:creation");
    expect(governance).toContain("hard_delete");
    expect(columnNames(inboxV2SourceMessageCorrelationEvidence)).not.toEqual(
      expect.arrayContaining([
        "message_id",
        "external_message_reference_id",
        "outbound_dispatch_id",
        "candidate_id"
      ])
    );
    const ddl = INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL;
    expect(ddl).toContain("source_correlation_evidence_immutable");
    expect(ddl).toContain("source_correlation_evidence_expired");
    expect(ddl).toContain("new.expires_at <= clock_timestamp()");
    expect(ddl).toContain("clock_timestamp() >= old.expires_at");
  });

  it("installs immutable-history, exact induction and deferred coherence guards", () => {
    const ddl = INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_INTEGRITY_SQL;
    expect(ddl).toContain("deferred_source_action_induction_mismatch");
    expect(ddl).toContain(
      "deferred_source_action_occurrence_snapshot_mismatch"
    );
    expect(ddl).toContain(
      "inbox_v2_source_occurrence_provider_references child_row"
    );
    expect(ddl).toContain(
      "inbox_v2_source_occurrence_provider_timestamps child_row"
    );
    expect(ddl).toContain("jsonb_agg(\n                 jsonb_build_object(");
    expect(ddl).toContain(
      "new.source_occurrence_detail is distinct from\n          expected_occurrence_detail"
    );
    expect(ddl).toContain("deferred_source_action_cas");
    expect(ddl).toContain("deferred_source_action_transition_mismatch");
    expect(ddl).toContain(
      "deferred_source_action_occurrence_resolution_mismatch"
    );
    expect(ddl).toContain("deferred_source_action_historical_head_missing");
    expect(ddl).toContain("deferred_source_action_historical_head_mismatch");
    expect(ddl).toContain("deferred_source_action_stale_position_mismatch");
    expect(ddl).toContain("deferred_source_action_duplicate_identity_mismatch");
    expect(ddl).toContain(
      "deferred_source_action_ordering_conflict_identity_mismatch"
    );
    expect(ddl).toContain("deferred_source_action_candidate_key_mismatch");
    expect(ddl).toContain("deferred_source_ordering_head_action_mismatch");
    expect(ddl).toContain(
      "inbox_v2.deferred_source_action_applied_revision_missing"
    );
    expect(ddl).toContain(
      "inbox_v2.deferred_source_action_lifecycle_effect_mismatch"
    );
    expect(ddl).toContain(
      "inbox_v2.deferred_source_action_retain_local_effect_mismatch"
    );
    expect(ddl).toContain("revision_row.provider_operation_id");
    expect(ddl).toContain(
      "operation_row.source_occurrence_id = new.source_occurrence_id"
    );
    expect(ddl).toContain(
      "operation_row.source_thread_binding_id = new.source_thread_binding_id"
    );
    expect(ddl).toContain(
      "operation_row.binding_generation = new.binding_generation"
    );
    expect(ddl).toContain(
      "head_row.revision >= transition_row.resulting_ordering_head_revision"
    );
    expect(ddl).toContain(
      "head_row.revision > transition_row.resulting_ordering_head_revision"
    );
    expect(ddl).toContain(
      'head_row.latest_position collate "C" >\n                new.ordering_position collate "C"'
    );
    expect(ddl).toContain("before update or delete");
    expect(ddl).toContain(
      "create constraint trigger inbox_v2_deferred_source_action_constraint_trigger\nafter update"
    );
    expect(ddl).not.toContain(
      "create constraint trigger inbox_v2_deferred_source_action_constraint_trigger\nafter insert or update"
    );
    expect(ddl.match(/deferrable initially deferred/gu)).toHaveLength(4);
  });
});

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name)
  );
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  const reference = foreignKey?.reference();
  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
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
