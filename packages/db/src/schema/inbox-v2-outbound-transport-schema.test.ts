import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { inboxV2ExternalThreads } from "./inbox-v2/external-thread";
import {
  INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL,
  inboxV2ExternalMessageReferences,
  inboxV2OutboundDispatchArtifactReferenceLinks,
  inboxV2OutboundDispatchArtifacts,
  inboxV2OutboundDispatchAttempts,
  inboxV2OutboundDispatchReconciliationDecisions,
  inboxV2OutboundDispatchReconciliationPermissions,
  inboxV2OutboundDispatchState,
  inboxV2OutboundDispatches,
  inboxV2OutboundMultiSendChildren,
  inboxV2OutboundMultiSendOperations,
  inboxV2OutboundRoutes,
  inboxV2SourceOccurrenceResolutionCandidates,
  inboxV2SourceOccurrenceResolutionTransitions,
  inboxV2ThreadRoutePolicyFallbackBindings,
  inboxV2ThreadRoutePolicyHeads,
  inboxV2ThreadRoutePolicyVersions
} from "./inbox-v2/outbound-transport";
import {
  inboxV2Messages,
  inboxV2TimelineItems
} from "./inbox-v2/timeline-message";
import { inboxV2SourceOccurrences } from "./inbox-v2/source-occurrence";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./inbox-v2/source-thread-binding";

describe("Inbox V2 outbound transport schema", () => {
  it("persists canonical identity anchors and every bounded transport aggregate", () => {
    expect(transportTables.map((table) => getTableConfig(table).name)).toEqual([
      "inbox_v2_timeline_items",
      "inbox_v2_messages",
      "inbox_v2_external_message_references",
      "inbox_v2_thread_route_policy_versions",
      "inbox_v2_thread_route_policy_fallback_bindings",
      "inbox_v2_thread_route_policy_heads",
      "inbox_v2_outbound_routes",
      "inbox_v2_outbound_multi_send_operations",
      "inbox_v2_outbound_dispatches",
      "inbox_v2_outbound_dispatch_attempts",
      "inbox_v2_outbound_dispatch_reconciliation_decisions",
      "inbox_v2_outbound_dispatch_reconciliation_permissions",
      "inbox_v2_outbound_dispatch_artifacts",
      "inbox_v2_source_occurrence_resolution_transitions",
      "inbox_v2_source_occurrence_resolution_candidates",
      "inbox_v2_outbound_dispatch_artifact_reference_links",
      "inbox_v2_outbound_multi_send_children"
    ]);

    for (const table of transportTables) {
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
    }
    expect(primaryKeyColumns(inboxV2TimelineItems)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2Messages)).toEqual([["tenant_id", "id"]]);
    expect(
      indexColumns(
        inboxV2OutboundDispatches,
        "inbox_v2_outbound_dispatches_tenant_message_idx"
      )
    ).toEqual(["tenant_id", "message_id", "created_at", "id"]);
    expect(
      indexColumns(
        inboxV2OutboundMultiSendChildren,
        "inbox_v2_outbound_multi_send_children_dispatch_idx"
      )
    ).toEqual([
      "tenant_id",
      "dispatch_id",
      "route_id",
      "message_id",
      "operation_id"
    ]);
  });

  it("uses an exact canonical Message and ExternalThread identity chain", () => {
    expectForeignKey(
      inboxV2Messages,
      "inbox_v2_messages_timeline_fk",
      inboxV2TimelineItems,
      ["tenant_id", "timeline_item_id", "conversation_id"],
      ["tenant_id", "id", "conversation_id"]
    );
    expectForeignKey(
      inboxV2ExternalMessageReferences,
      "inbox_v2_external_message_references_thread_fk",
      inboxV2ExternalThreads,
      [
        "tenant_id",
        "external_thread_id",
        "conversation_id",
        "external_thread_revision"
      ],
      ["tenant_id", "id", "conversation_id", "revision"]
    );
    expectForeignKey(
      inboxV2ExternalMessageReferences,
      "inbox_v2_external_message_references_message_fk",
      inboxV2Messages,
      ["tenant_id", "message_id", "conversation_id", "timeline_item_id"],
      ["tenant_id", "id", "conversation_id", "timeline_item_id"]
    );

    const keyCheck = checkSql(
      inboxV2ExternalMessageReferences,
      "inbox_v2_external_message_references_key_check"
    );
    expect(keyCheck).toContain("external-message-key:v1");
    expect(keyCheck).toContain("sha256");
    expect(keyCheck).toContain("canonical_external_subject");
    expect(keyCheck).toContain("message_key_digest_sha256");
    expect(
      checkSql(
        inboxV2ExternalMessageReferences,
        "inbox_v2_external_message_references_declaration_check"
      )
    ).toContain("is true");
    expect(
      uniqueColumns(
        inboxV2ExternalMessageReferences,
        "inbox_v2_external_message_references_key_unique"
      )
    ).toEqual(["tenant_id", "message_key_digest_sha256"]);
    expect(
      indexColumns(
        inboxV2ExternalMessageReferences,
        "inbox_v2_external_message_references_tenant_account_idx"
      )
    ).toEqual(["tenant_id", "scope_source_account_id", "id"]);
    expect(
      indexColumns(
        inboxV2ExternalMessageReferences,
        "inbox_v2_external_message_references_tenant_binding_idx"
      )
    ).toEqual(["tenant_id", "scope_source_thread_binding_id", "id"]);
  });

  it("versions one exact route-policy scope without nullable-key FK holes", () => {
    expect(
      generatedColumnSql(
        inboxV2ThreadRoutePolicyVersions,
        "content_kind_scope_key"
      )
    ).toContain("coalesce(content_kind_id, '<no-content-kind>')");
    expect(
      generatedColumnSql(
        inboxV2ThreadRoutePolicyHeads,
        "content_kind_scope_key"
      )
    ).toContain("coalesce(content_kind_id, '<no-content-kind>')");
    expectForeignKey(
      inboxV2ThreadRoutePolicyHeads,
      "inbox_v2_thread_route_policy_heads_version_fk",
      inboxV2ThreadRoutePolicyVersions,
      [
        "tenant_id",
        "policy_id",
        "revision",
        "conversation_id",
        "external_thread_id",
        "operation_id",
        "content_kind_scope_key"
      ],
      [
        "tenant_id",
        "policy_id",
        "revision",
        "conversation_id",
        "external_thread_id",
        "operation_id",
        "content_kind_scope_key"
      ]
    );
    expectForeignKey(
      inboxV2ThreadRoutePolicyFallbackBindings,
      "inbox_v2_thread_route_policy_fallback_bindings_binding_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "binding_id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ],
      [
        "tenant_id",
        "id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ]
    );
    expect(
      checkSql(
        inboxV2ThreadRoutePolicyVersions,
        "inbox_v2_thread_route_policy_versions_fallback_check"
      )
    ).toContain("between 1 and 32");

    const policyVersionGuard = functionSql(
      INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL,
      "inbox_v2_thread_route_policy_guard_version_insert"
    );
    expect(policyVersionGuard).toContain(
      "if current_head.policy_id is null then"
    );
    expect(policyVersionGuard).toContain(
      "current_head.revision + 1 <> new.revision"
    );
    expect(policyVersionGuard).toContain("order by version_row.revision");
    expect(policyVersionGuard).toContain(
      "new.revision = 1 and new.created_at <> new.updated_at"
    );
    expect(policyVersionGuard).not.toContain("if new.revision = 1 then");

    const policyHeadGuard = functionSql(
      INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL,
      "inbox_v2_thread_route_policy_guard_head_write"
    );
    expect(policyHeadGuard).not.toContain("if new.revision <> 1 then");
  });

  it("pins immutable routes to exact binding, snapshot and policy fences", () => {
    expectForeignKey(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_binding_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "source_thread_binding_id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ],
      [
        "tenant_id",
        "id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ]
    );
    expectForeignKey(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_binding_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      ["tenant_id", "source_thread_binding_id", "binding_revision"],
      ["tenant_id", "binding_id", "revision"]
    );
    expectForeignKey(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_policy_fk",
      inboxV2ThreadRoutePolicyVersions,
      ["tenant_id", "route_policy_id", "route_policy_revision"],
      ["tenant_id", "policy_id", "revision"]
    );

    expect(
      checkSql(inboxV2OutboundRoutes, "inbox_v2_outbound_routes_fence_check")
    ).toContain("route_descriptor_revision");
    expect(
      checkSql(
        inboxV2OutboundRoutes,
        "inbox_v2_outbound_routes_snapshots_check"
      )
    ).toContain("jsonb_typeof");
    const authorizationSnapshots = checkSql(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_authorization_snapshots_check"
    );
    expect(authorizationSnapshots).toContain("conversation_action");
    expect(authorizationSnapshots).toContain("source_account_use");
    expect(authorizationSnapshots).toContain("core:source_account.use");
    expect(authorizationSnapshots).toContain("jsonb_build_object");
    expect(authorizationSnapshots).toContain("bindingFence");
    expect(authorizationSnapshots).toContain("referenceTarget");
    expect(authorizationSnapshots).toContain("is true");
    expect(
      checkSql(
        inboxV2OutboundRoutes,
        "inbox_v2_outbound_routes_snapshot_parity_check"
      )
    ).toContain("is true");
    const runtimeObservation = checkSql(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_runtime_observation_check"
    );
    expect(runtimeObservation).toContain("?& array");
    expect(runtimeObservation).toContain("::text[] = '{}'::jsonb");
    expect(runtimeObservation).toContain("#> '{diagnostic}') - array");
    expect(runtimeObservation).not.toContain("select count");
    expect(runtimeObservation).toContain("observedAt");
    expect(runtimeObservation).toContain("diagnostic");
    const referenceContext = checkSql(
      inboxV2OutboundRoutes,
      "inbox_v2_outbound_routes_reference_context_check"
    );
    expect(referenceContext).toContain("is true");
    expect(referenceContext).toContain("occurrenceDescriptor");
    expect(referenceContext).toContain("availabilityObservation");
    expect(referenceContext).toContain("observedByTrustedServiceId");
    expect(referenceContext).toContain("available");
    expect(
      checkSql(
        inboxV2OutboundRoutes,
        "inbox_v2_outbound_routes_selection_check"
      )
    ).toContain("is true");
    expect(
      checkSql(
        inboxV2OutboundRoutes,
        "inbox_v2_outbound_routes_immutable_check"
      )
    ).toContain("revision");
  });

  it("enforces dispatch-attempt and reconciliation chains without loose IDs", () => {
    expect(inboxV2OutboundDispatchState.enumValues).toEqual([
      "queued",
      "attempting",
      "accepted",
      "retryable_failure",
      "terminal_failure",
      "outcome_unknown",
      "cancelled"
    ]);
    expectForeignKey(
      inboxV2OutboundDispatchAttempts,
      "inbox_v2_outbound_dispatch_attempts_dispatch_fk",
      inboxV2OutboundDispatches,
      ["tenant_id", "dispatch_id", "route_id", "message_id"],
      ["tenant_id", "id", "route_id", "message_id"]
    );
    expectForeignKey(
      inboxV2OutboundDispatchReconciliationDecisions,
      "inbox_v2_outbound_dispatch_reconciliation_attempt_fk",
      inboxV2OutboundDispatchAttempts,
      [
        "tenant_id",
        "unknown_attempt_id",
        "dispatch_id",
        "route_id",
        "message_id",
        "unknown_attempt_outcome_kind",
        "unknown_attempt_revision"
      ],
      [
        "tenant_id",
        "id",
        "dispatch_id",
        "route_id",
        "message_id",
        "outcome_kind",
        "revision"
      ]
    );
    expect(
      uniqueColumns(
        inboxV2OutboundDispatchAttempts,
        "inbox_v2_outbound_dispatch_attempts_artifact_target_unique"
      )
    ).toEqual(["tenant_id", "id", "dispatch_id", "route_id", "message_id"]);
    const outcome = checkSql(
      inboxV2OutboundDispatchAttempts,
      "inbox_v2_outbound_dispatch_attempts_outcome_check"
    );
    expect(outcome).toContain("is true");
    expect(outcome).toContain("coalesce");
    expect(outcome).toContain("lease_expired");
    expect(outcome).toContain("operator_duplicate_risk_decision_required");
    expect(outcome).toContain("preflight_blocked");
    const reconciliationAuthorization = checkSql(
      inboxV2OutboundDispatchReconciliationDecisions,
      "inbox_v2_outbound_dispatch_reconciliation_authorization_check"
    );
    expect(reconciliationAuthorization).toContain("is true");
    expect(reconciliationAuthorization).toContain("?& array");
    expect(reconciliationAuthorization).toContain("::text[] = '{}'::jsonb");
    expect(reconciliationAuthorization).not.toContain("select count");
    expect(
      indexColumns(
        inboxV2OutboundDispatchReconciliationPermissions,
        "inbox_v2_outbound_reconciliation_permissions_tenant_idx"
      )
    ).toEqual(["tenant_id", "decision_id", "permission_id"]);
  });

  it("pins artifacts and resolution evidence to exact accepted chains", () => {
    expectForeignKey(
      inboxV2OutboundDispatchArtifacts,
      "inbox_v2_outbound_dispatch_artifacts_attempt_fk",
      inboxV2OutboundDispatchAttempts,
      ["tenant_id", "attempt_id", "dispatch_id", "route_id", "message_id"],
      ["tenant_id", "id", "dispatch_id", "route_id", "message_id"]
    );
    expectForeignKey(
      inboxV2SourceOccurrenceResolutionCandidates,
      "inbox_v2_source_occurrence_resolution_candidates_transition_fk",
      inboxV2SourceOccurrenceResolutionTransitions,
      [
        "tenant_id",
        "transition_id",
        "source_occurrence_id",
        "resulting_revision"
      ],
      ["tenant_id", "id", "source_occurrence_id", "resulting_revision"]
    );
    expectForeignKey(
      inboxV2OutboundDispatchArtifactReferenceLinks,
      "inbox_v2_outbound_dispatch_artifact_reference_links_reference_fk",
      inboxV2ExternalMessageReferences,
      [
        "tenant_id",
        "external_message_reference_id",
        "external_thread_id",
        "message_id"
      ],
      ["tenant_id", "id", "external_thread_id", "message_id"]
    );
    expectForeignKey(
      inboxV2OutboundDispatchArtifactReferenceLinks,
      "inbox_v2_outbound_dispatch_artifact_reference_links_occurrence_fk",
      inboxV2SourceOccurrences,
      [
        "tenant_id",
        "source_occurrence_id",
        "source_occurrence_revision",
        "source_occurrence_resolution_state",
        "external_message_reference_id"
      ],
      [
        "tenant_id",
        "id",
        "revision",
        "resolution_state",
        "resolved_external_message_reference_id"
      ]
    );
    expect(
      indexColumns(
        inboxV2SourceOccurrenceResolutionCandidates,
        "inbox_v2_source_occurrence_resolution_candidates_reference_idx"
      )
    ).toEqual(["tenant_id", "external_message_reference_id", "transition_id"]);
    expect(
      indexColumns(
        inboxV2OutboundDispatchArtifactReferenceLinks,
        "inbox_v2_outbound_artifact_reference_links_occurrence_idx"
      )
    ).toEqual([
      "tenant_id",
      "source_occurrence_id",
      "source_occurrence_revision",
      "source_occurrence_resolution_state",
      "external_message_reference_id",
      "id"
    ]);
  });

  it("keeps JSONB limited to bounded contract snapshots", () => {
    expect(jsonColumnNames(inboxV2ExternalMessageReferences)).toEqual([
      "identity_declaration"
    ]);
    expect(jsonColumnNames(inboxV2OutboundRoutes)).toEqual([
      "adapter_contract_snapshot",
      "route_descriptor_snapshot",
      "conversation_authorization_snapshot",
      "source_account_authorization_snapshot",
      "reference_context_snapshot",
      "runtime_observation_snapshot",
      "selection_intent_snapshot"
    ]);
    expect(jsonColumnNames(inboxV2OutboundDispatchAttempts)).toEqual([
      "retry_safety_adapter_contract_snapshot"
    ]);
    expect(
      jsonColumnNames(inboxV2OutboundDispatchReconciliationDecisions)
    ).toEqual(["operator_authorization_snapshot"]);
  });

  it("keeps every CHECK constraint row-local and free of subqueries", () => {
    const dialect = new PgDialect();
    for (const table of transportTables) {
      for (const constraint of getTableConfig(table).checks) {
        expect(dialect.sqlToQuery(constraint.value).sql).not.toMatch(
          /\bselect\b/iu
        );
      }
    }
  });

  it("installs immutable, CAS and deferred bounded-coherence SQL", () => {
    const invariantSql = INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL;
    expect(invariantSql).toContain(
      "alter table public.inbox_v2_source_occurrences"
    );
    expect(invariantSql).toContain(
      "inbox_v2_source_occurrences_provider_response_attempt_fk"
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_outbound_route_guard_insert()"
    );
    const routeGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_route_guard_insert"
    );
    expect(routeGuard).toContain("snapshot_row.runtime_health_state");
    expect(routeGuard).toContain("head_row.runtime_health_state");
    expect(routeGuard).toContain("new.runtime_observation_snapshot");
    expect(routeGuard).toContain("runtime_diagnostic_safe_operator_hint_id");
    expect(routeGuard).toContain(
      "occurrence_row.reference_portability_kind::text"
    );
    expect(routeGuard).toContain(
      "occurrence_row.reference_portability_decision_strength::text"
    );
    expect(routeGuard).toContain(
      "occurrence_row.adapter_declaration_revision ="
    );
    expect(routeGuard).toContain(
      "occurrence_row.adapter_loaded_at = new.adapter_loaded_at"
    );
    expect(routeGuard).toContain(
      "'{resolutionDecision,occurrenceDescriptor,descriptorDigestSha256}'"
    );
    expect(routeGuard).toContain(
      "'{resolutionDecision,availabilityObservation,occurrenceRevision}'"
    );
    expect(routeGuard).toContain(
      "'{resolutionDecision,availabilityObservation,observedByTrustedServiceId}' =\n             occurrence_row.adapter_loaded_by_trusted_service_id"
    );
    expect(routeGuard).toContain(
      "new.selection_intent_kind <> 'explicit_occurrence'"
    );
    expect(routeGuard).toContain("resolution_row.resolver_trusted_service_id");
    const attemptGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_attempt_guard_insert"
    );
    expect(attemptGuard).toContain("new.outcome_kind <> 'pending'");
    expect(attemptGuard).toContain("new.revision <> 1");
    expect(attemptGuard).toContain("outbound_attempt_initial_state_invalid");
    const dispatchHeadTrigger = functionSql(
      invariantSql,
      "inbox_v2_outbound_dispatch_deferred_head"
    );
    expect(dispatchHeadTrigger).toContain(
      "outbound_attempt_pre_io_commit_required"
    );
    expect(dispatchHeadTrigger).toContain(
      "attempt_row.outcome_kind = 'pending'"
    );
    expect(invariantSql).toContain("outbound_attempt_route_binding_changed");
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_outbound_dispatch_head("
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_thread_route_policy_fallbacks("
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_outbound_multi_send_children("
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_outbound_reconciliation("
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_assert_source_occurrence_resolution("
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_outbound_artifact_link_guard_insert()"
    );
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of transportTables) {
      for (const tableIndex of getTableConfig(table).indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
  });
});

const transportTables = [
  inboxV2TimelineItems,
  inboxV2Messages,
  inboxV2ExternalMessageReferences,
  inboxV2ThreadRoutePolicyVersions,
  inboxV2ThreadRoutePolicyFallbackBindings,
  inboxV2ThreadRoutePolicyHeads,
  inboxV2OutboundRoutes,
  inboxV2OutboundMultiSendOperations,
  inboxV2OutboundDispatches,
  inboxV2OutboundDispatchAttempts,
  inboxV2OutboundDispatchReconciliationDecisions,
  inboxV2OutboundDispatchReconciliationPermissions,
  inboxV2OutboundDispatchArtifacts,
  inboxV2SourceOccurrenceResolutionTransitions,
  inboxV2SourceOccurrenceResolutionCandidates,
  inboxV2OutboundDispatchArtifactReferenceLinks,
  inboxV2OutboundMultiSendChildren
] as const;

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
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

function generatedColumnSql(
  table: Parameters<typeof getTableConfig>[0],
  columnName: string
): string {
  const column = getTableConfig(table).columns.find(
    (candidate) => candidate.name === columnName
  );
  const generated = column?.generated;
  if (!generated || typeof generated.as !== "function") {
    throw new Error(`Missing generated expression: ${columnName}`);
  }
  return new PgDialect().sqlToQuery(generated.as()).sql;
}

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string[] {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing unique constraint: ${name}`);
  return constraint.columns.map((column) => column.name);
}

function jsonColumnNames(
  table: Parameters<typeof getTableConfig>[0]
): string[] {
  return getTableConfig(table)
    .columns.filter((column) => column.getSQLType() === "jsonb")
    .map((column) => column.name);
}

function indexColumns(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): Array<string | undefined> {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  if (!tableIndex) throw new Error(`Missing index: ${name}`);
  return tableIndex.config.columns.map(indexColumnName);
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

function functionSql(source: string, name: string): string {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`
    )
  );
  if (!match) throw new Error(`Missing invariant function: ${name}`);
  return match[0];
}
