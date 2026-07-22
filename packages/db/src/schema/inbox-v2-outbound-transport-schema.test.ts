import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import { inboxV2ExternalThreads } from "./inbox-v2/external-thread";
import {
  inboxV2FileOutboundArtifactPlans,
  inboxV2FileOutboundDispatchPlans
} from "./inbox-v2/file-object";
import {
  INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL,
  inboxV2ExternalMessageReferences,
  inboxV2OutboundDispatchArtifactReferenceLinks,
  inboxV2OutboundDispatchArtifactResolutions,
  inboxV2OutboundDispatchArtifacts,
  inboxV2OutboundDispatchAttemptCompletionSource,
  inboxV2OutboundDispatchAttempts,
  inboxV2OutboundDispatchReconciliationDecisions,
  inboxV2OutboundDispatchReconciliationPermissions,
  inboxV2OutboundDispatchState,
  inboxV2OutboundDispatches,
  inboxV2OutboundMultiSendChildren,
  inboxV2OutboundMultiSendOperations,
  inboxV2OutboundProviderCorrelationAnchors,
  inboxV2OutboundProviderObservations,
  inboxV2OutboundProviderObservationSettlements,
  inboxV2OutboundProviderSettlementWorkItems,
  inboxV2OutboundProviderSettlementWorkState,
  inboxV2OutboundRoutes,
  inboxV2SourceOccurrenceResolutionCandidates,
  inboxV2SourceOccurrenceResolutionTransitions,
  inboxV2ThreadRoutePolicyFallbackBindings,
  inboxV2ThreadRoutePolicyHeads,
  inboxV2ThreadRoutePolicyVersions
} from "./inbox-v2/outbound-transport";
import {
  inboxV2MessageTransportOccurrenceLinks,
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
      "inbox_v2_outbound_provider_correlation_anchors",
      "inbox_v2_outbound_dispatch_reconciliation_decisions",
      "inbox_v2_outbound_dispatch_reconciliation_permissions",
      "inbox_v2_outbound_dispatch_artifacts",
      "inbox_v2_source_occurrence_resolution_transitions",
      "inbox_v2_source_occurrence_resolution_candidates",
      "inbox_v2_outbound_dispatch_artifact_reference_links",
      "inbox_v2_outbound_provider_observations",
      "inbox_v2_outbound_dispatch_artifact_resolutions",
      "inbox_v2_outbound_provider_observation_settlements",
      "inbox_v2_outbound_provider_settlement_work_items",
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

  it("forces mixed provider artifact outcomes to operator reconciliation even when retries are automatic", () => {
    const outcome = checkSql(
      inboxV2OutboundDispatchAttempts,
      "inbox_v2_outbound_dispatch_attempts_outcome_check"
    ).replace(/\s+/gu, " ");

    expect(outcome).toMatch(
      /automatic_retry_allowed" and .*diagnostic_code_id" <> 'core:provider-artifact-outcomes-mixed' and .*unknown_required_action" = 'automated_reconciliation_required'/u
    );
    expect(outcome).toMatch(
      /not .*automatic_retry_allowed" or .*diagnostic_code_id" = 'core:provider-artifact-outcomes-mixed'\) and .*unknown_required_action" = 'operator_duplicate_risk_decision_required'/u
    );
    expect(outcome).not.toMatch(
      /or \(not .*automatic_retry_allowed" and .*unknown_required_action" = 'operator_duplicate_risk_decision_required'\)/u
    );
  });

  it("keeps the raw provider observation guard parenthesis-balanced", () => {
    expectSqlParenthesesBalanced(
      functionSql(
        INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL,
        "inbox_v2_outbound_provider_observation_guard_insert"
      )
    );
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

  it("persists replay-safe provider observation and effective artifact settlement", () => {
    expect(inboxV2OutboundDispatchAttemptCompletionSource.enumValues).toContain(
      "provider_observation"
    );
    expect(
      primaryKeyColumns(inboxV2OutboundProviderCorrelationAnchors)
    ).toEqual([
      [
        "tenant_id",
        "adapter_contract_id",
        "adapter_contract_version",
        "adapter_declaration_revision",
        "adapter_surface_id",
        "correlation_token"
      ]
    ]);
    expect(
      uniqueColumns(
        inboxV2OutboundProviderCorrelationAnchors,
        "inbox_v2_outbound_provider_correlation_anchors_dispatch_unique"
      )
    ).toEqual(["tenant_id", "dispatch_id"]);
    expectForeignKey(
      inboxV2OutboundProviderCorrelationAnchors,
      "inbox_v2_outbound_provider_correlation_anchors_attempt_fk",
      inboxV2OutboundDispatchAttempts,
      [
        "tenant_id",
        "first_attempt_id",
        "dispatch_id",
        "route_id",
        "message_id"
      ],
      ["tenant_id", "id", "dispatch_id", "route_id", "message_id"]
    );

    expectForeignKey(
      inboxV2OutboundProviderObservations,
      "inbox_v2_outbound_provider_observations_artifact_fk",
      inboxV2OutboundDispatchArtifacts,
      [
        "tenant_id",
        "artifact_id",
        "dispatch_id",
        "route_id",
        "attempt_id",
        "message_id",
        "artifact_ordinal",
        "artifact_state"
      ],
      [
        "tenant_id",
        "id",
        "dispatch_id",
        "route_id",
        "attempt_id",
        "message_id",
        "ordinal",
        "state"
      ]
    );
    expectForeignKey(
      inboxV2OutboundProviderObservations,
      "inbox_v2_outbound_provider_observations_content_plan_fk",
      inboxV2FileOutboundDispatchPlans,
      ["tenant_id", "content_plan_id", "dispatch_id"],
      ["tenant_id", "id", "dispatch_id"]
    );
    expectForeignKey(
      inboxV2OutboundProviderObservations,
      "inbox_v2_outbound_provider_observations_artifact_plan_fk",
      inboxV2FileOutboundArtifactPlans,
      ["tenant_id", "content_plan_id", "artifact_plan_id", "artifact_ordinal"],
      ["tenant_id", "content_plan_id", "id", "ordinal"]
    );
    expect(
      getTableConfig(inboxV2OutboundProviderObservations).foreignKeys.some(
        (foreignKey) =>
          foreignKey.reference().foreignTable === inboxV2SourceOccurrences
      )
    ).toBe(false);
    expect(
      uniqueColumns(
        inboxV2OutboundProviderObservations,
        "inbox_v2_outbound_provider_observations_replay_unique"
      )
    ).toEqual([
      "tenant_id",
      "artifact_id",
      "source_occurrence_id",
      "evidence_kind",
      "source_occurrence_detail_digest_sha256"
    ]);
    expect(jsonColumnNames(inboxV2OutboundProviderObservations)).toEqual([
      "source_occurrence_detail",
      "observation_detail"
    ]);
    const observationSnapshotCheck = checkSql(
      inboxV2OutboundProviderObservations,
      "inbox_v2_outbound_provider_observations_snapshot_check"
    );
    expect(observationSnapshotCheck).toContain("262144");
    expect(observationSnapshotCheck).toContain(
      "observation_detail_digest_sha256"
    );
    expect(observationSnapshotCheck).toContain("sourceOccurrence");
    expect(observationSnapshotCheck).toContain("observedByTrustedServiceId");

    expectForeignKey(
      inboxV2OutboundDispatchArtifactResolutions,
      "inbox_v2_outbound_dispatch_artifact_resolutions_observation_fk",
      inboxV2OutboundProviderObservations,
      [
        "tenant_id",
        "observation_id",
        "artifact_id",
        "dispatch_id",
        "route_id",
        "attempt_id",
        "message_id",
        "artifact_ordinal",
        "effective_state",
        "observation_source_occurrence_id"
      ],
      [
        "tenant_id",
        "id",
        "artifact_id",
        "dispatch_id",
        "route_id",
        "attempt_id",
        "message_id",
        "artifact_ordinal",
        "effective_state",
        "source_occurrence_id"
      ]
    );
    expect(
      uniqueColumns(
        inboxV2OutboundDispatchArtifactResolutions,
        "inbox_v2_outbound_dispatch_artifact_resolutions_artifact_unique"
      )
    ).toEqual(["tenant_id", "artifact_id"]);

    expectForeignKey(
      inboxV2OutboundProviderObservationSettlements,
      "inbox_v2_outbound_provider_observation_settlements_occurrence_fk",
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
    expectForeignKey(
      inboxV2OutboundProviderObservationSettlements,
      "inbox_v2_outbound_provider_observation_settlements_transport_link_fk",
      inboxV2MessageTransportOccurrenceLinks,
      ["tenant_id", "message_transport_link_id", "message_id"],
      ["tenant_id", "id", "message_id"]
    );
    expect(
      uniqueColumns(
        inboxV2OutboundProviderObservationSettlements,
        "inbox_v2_outbound_provider_observation_settlements_occurrence_unique"
      )
    ).toEqual(["tenant_id", "source_occurrence_id"]);
    expect(
      getTableConfig(
        inboxV2OutboundProviderObservationSettlements
      ).uniqueConstraints.some((constraint) =>
        constraint.columns.some(
          (column) => column.name === "canonical_artifact_reference_link_id"
        )
      )
    ).toBe(false);

    expect(inboxV2OutboundProviderSettlementWorkState.enumValues).toEqual([
      "pending",
      "leased",
      "settled",
      "dead"
    ]);
    expectForeignKey(
      inboxV2OutboundProviderSettlementWorkItems,
      "inbox_v2_outbound_provider_settlement_work_items_observation_fk",
      inboxV2OutboundProviderObservations,
      ["tenant_id", "observation_id"],
      ["tenant_id", "id"]
    );
    expect(
      uniqueColumns(
        inboxV2OutboundProviderSettlementWorkItems,
        "inbox_v2_outbound_provider_settlement_work_items_link_uk"
      )
    ).toEqual(["tenant_id", "candidate_transport_link_id"]);
    expect(
      indexColumns(
        inboxV2OutboundProviderSettlementWorkItems,
        "inbox_v2_outbound_provider_settlement_work_items_due_idx"
      )
    ).toEqual(["tenant_id", "available_at", "observation_id"]);
    expect(
      checkSql(
        inboxV2OutboundProviderSettlementWorkItems,
        "inbox_v2_outbound_provider_settlement_work_items_state_check"
      )
    ).toContain("terminal_at");
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
    expect(jsonColumnNames(inboxV2OutboundProviderObservations)).toEqual([
      "source_occurrence_detail",
      "observation_detail"
    ]);
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
    expect(invariantSql).not.toContain(
      "inbox_v2_timeline_items_immutable_trigger"
    );
    expect(invariantSql).not.toContain("inbox_v2_messages_immutable_trigger");
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
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_outbound_correlation_anchor_guard_insert()"
    );
    expect(invariantSql).toContain(
      "create or replace function public.inbox_v2_outbound_provider_observation_guard_insert()"
    );
    const providerTransportLineage = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_transport_lineage"
    );
    for (const immutableProjectionFence of [
      "observation_dispatch #> '{message}' = jsonb_build_object(",
      "observation_dispatch #> '{multiSendOperation}' = case",
      "observation_attempt #>> '{claimToken}' = checked_attempt.claim_token",
      "observation_attempt #> '{retrySafety,adapterContract}' =",
      "observation_attempt #>> '{retrySafety,providerCorrelationToken}'",
      "(observation_attempt #>> '{leaseExpiresAt}')::timestamptz =",
      "(observation_attempt #>> '{openedAt}')::timestamptz ="
    ]) {
      expect(providerTransportLineage).toContain(immutableProjectionFence);
    }
    for (const mutableProjectionFence of [
      "observation_outcome -",
      "checked_attempt.provider_acknowledgement_token",
      "checked_attempt.diagnostic_correlation_token",
      "checked_attempt.unknown_required_action::text",
      "observation_attempt #>> '{completionSource}'",
      "observation_dispatch #> '{activeAttempt}' = case",
      "observation_dispatch #> '{retryAuthorization}' = case",
      "(observation_dispatch #>> '{updatedAt}')::timestamptz ="
    ]) {
      expect(providerTransportLineage).toContain(mutableProjectionFence);
    }
    for (const acceptedLineage of [
      "return 'exact_head';",
      "return 'pending_to_outcome_unknown';",
      "return 'pending_to_accepted';",
      "return 'outcome_unknown_to_accepted';",
      "return 'pending_to_outcome_unknown_to_accepted';"
    ]) {
      expect(providerTransportLineage).toContain(acceptedLineage);
    }
    expect(providerTransportLineage).toContain(
      "checked_attempt.revision =\n       (observation_attempt #>> '{revision}')::bigint + 1"
    );
    expect(providerTransportLineage).toContain(
      "checked_dispatch.revision =\n       (observation_dispatch #>> '{revision}')::bigint + 2"
    );
    expect(providerTransportLineage).toContain("return 'invalid';");

    const providerObservationGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_observation_guard_insert"
    );
    expect(providerObservationGuard).toContain(
      "new.observation_detail, dispatch_row, attempt_row"
    );
    expect(providerObservationGuard).toContain(
      "lineage_row.transport_lineage in (\n        'exact_head',\n        'pending_to_outcome_unknown',\n        'pending_to_accepted'\n      )"
    );
    expect(providerObservationGuard).not.toContain(
      "lineage_row.transport_lineage in (\n        'exact_head',\n        'outcome_unknown_to_accepted'"
    );
    expect(providerObservationGuard).toContain(
      "accepted_decision_row.decided_at = dispatch_row.updated_at"
    );
    for (const forgedDetailFence of [
      "new.observation_detail #>> '{sourceOccurrenceDetailDigestSha256}' =",
      "new.observation_detail #> '{effectDisposition}' =",
      "new.observation_detail #> '{artifact,dispatch}' = jsonb_build_object(",
      "new.observation_detail #> '{artifact,diagnostic}' = case",
      "(new.observation_detail #>> '{artifact,createdAt}')::timestamptz =",
      "new.observation_detail #> '{route,externalThread}' =",
      "new.observation_detail #> '{route,sourceConnection}' =",
      "new.observation_detail #> '{route,sourceAccount}' =",
      "new.observation_detail #> '{route,sourceThreadBinding}' =",
      "new.observation_detail #> '{route,bindingFence}' =",
      "new.observation_detail #> '{route,adapterContract}' =",
      "new.observation_detail #> '{route,conversationAuthorization}' =",
      "new.observation_detail #> '{route,sourceAccountAuthorization}' =",
      "new.observation_detail #> '{route,referenceContext}' =",
      "new.observation_detail #> '{route,runtimeObservationAtResolution}' =",
      "new.observation_detail #> '{route,selection,intent}' =",
      "new.observation_detail #> '{evidence}' = jsonb_build_object("
    ]) {
      expect(providerObservationGuard).toContain(forgedDetailFence);
    }
    const settlementGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_settlement_guard_insert"
    );
    expect(settlementGuard).toContain("coverage_complete");
    expect(settlementGuard).toContain("retain_dispatch_state");
    expect(settlementGuard).toContain("provider_observation");
    expect(settlementGuard).toContain("reconcile_outcome_unknown");
    expect(settlementGuard).toContain("canonical_artifact_reference_link_id");
    expect(settlementGuard).toContain(
      "observation_transport_lineage <> 'pending_to_accepted'"
    );
    expect(settlementGuard).toContain(
      "'outcome_unknown_to_accepted',\n         'pending_to_outcome_unknown_to_accepted'"
    );
    expect(settlementGuard).toContain(
      "current_attempt_completion_source <> 'provider_observation'"
    );
    expect(settlementGuard).toContain("not accepted_reconciliation_proven");
    expect(settlementGuard).toContain(
      "accepted_decision_row.decided_at = dispatch_row.updated_at"
    );
    expect(settlementGuard).toContain(
      "decision_row.decided_at = new.settled_at"
    );
    expect(invariantSql).toContain(
      "before update or delete on public.inbox_v2_outbound_provider_observations"
    );
    const settlementWorkGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_settlement_work_guard"
    );
    expect(settlementWorkGuard).toContain("for share of observation_row");
    expect(settlementWorkGuard).toContain("clock_timestamp()");
    expect(settlementWorkGuard).toContain("last_finalized_result_hash");
    expect(settlementWorkGuard).toContain(
      "inbox_v2_outbound_provider_observation_settlements"
    );
    const observationWorkClosure = functionSql(
      invariantSql,
      "inbox_v2_assert_outbound_provider_observation_work"
    );
    expect(observationWorkClosure).toContain(
      "join public.inbox_v2_outbound_provider_settlement_work_items work_row"
    );
    expect(observationWorkClosure).toContain(
      "work_row.trusted_service_id =\n       observation_row.observed_by_trusted_service_id"
    );
    expect(observationWorkClosure).toContain(
      "work_row.created_at = observation_row.recorded_at"
    );
    expect(observationWorkClosure).toContain("coherent_work_count <> 1");
    expect(observationWorkClosure).toContain(
      "inbox_v2.outbound_provider_observation_work_required"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_outbound_provider_observations_work_constraint"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_outbound_provider_settlement_work_observation_constraint"
    );
    expect(invariantSql).toContain(
      "execute function public.inbox_v2_outbound_provider_observation_work_deferred()"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_outbound_provider_settlement_work_guard_trigger"
    );
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);
  });

  it("fails closed when provider observation JSON could forge persisted transport projections", () => {
    const invariantSql = INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL;
    const lineage = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_transport_lineage"
    );
    const observationGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_observation_guard_insert"
    );

    expect(lineage).toContain("observation_dispatch - array[");
    expect(lineage).toContain("observation_attempt - array[");
    expect(lineage).toContain(
      "checked_dispatch.revision =\n       (observation_dispatch #>> '{revision}')::bigint + 2"
    );
    expect(observationGuard).toContain(
      "(new.observation_detail #> '{artifact}') - array["
    );
    expect(observationGuard).toContain(
      "(new.observation_detail #> '{route}') - array["
    );
    expect(observationGuard).toContain(
      "'accountGeneration', route_row.account_generation::text"
    );
    expect(observationGuard).toContain(
      "new.observation_detail #> '{route,conversationAuthorization}' =\n        route_row.conversation_authorization_snapshot"
    );
    expect(observationGuard).toContain(
      "new.observation_detail #> '{route,sourceAccountAuthorization}' =\n        route_row.source_account_authorization_snapshot"
    );
    expect(observationGuard).not.toContain(
      "lineage_row.transport_lineage in (\n        'exact_head',\n        'outcome_unknown_to_accepted'"
    );
  });

  it("rejects settlement lineage mismatches and orphan provider observations", () => {
    const invariantSql = INBOX_V2_OUTBOUND_TRANSPORT_INTEGRITY_SQL;
    const settlementGuard = functionSql(
      invariantSql,
      "inbox_v2_outbound_provider_settlement_guard_insert"
    );
    const workClosure = functionSql(
      invariantSql,
      "inbox_v2_assert_outbound_provider_observation_work"
    );

    expect(settlementGuard).toContain(
      "observation_transport_lineage <> 'pending_to_accepted'"
    );
    expect(settlementGuard).toContain(
      "observation_transport_lineage not in (\n         'outcome_unknown_to_accepted',\n         'pending_to_outcome_unknown_to_accepted'"
    );
    expect(settlementGuard).toContain("not accepted_reconciliation_proven");
    expect(workClosure).toContain("coherent_work_count <> 1");
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_outbound_provider_observations_work_constraint"
    );
    expect(invariantSql).toContain(
      "deferrable initially deferred for each row"
    );
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
  inboxV2OutboundProviderCorrelationAnchors,
  inboxV2OutboundDispatchReconciliationDecisions,
  inboxV2OutboundDispatchReconciliationPermissions,
  inboxV2OutboundDispatchArtifacts,
  inboxV2SourceOccurrenceResolutionTransitions,
  inboxV2SourceOccurrenceResolutionCandidates,
  inboxV2OutboundDispatchArtifactReferenceLinks,
  inboxV2OutboundProviderObservations,
  inboxV2OutboundDispatchArtifactResolutions,
  inboxV2OutboundProviderObservationSettlements,
  inboxV2OutboundProviderSettlementWorkItems,
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

function expectSqlParenthesesBalanced(source: string): void {
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (current === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (current === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote !== null) {
      if (current === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (current === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (current === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (current === "'" || current === '"') {
      quote = current;
      continue;
    }
    if (current === "(") depth += 1;
    if (current === ")") {
      depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }

  expect(quote).toBeNull();
  expect(blockComment).toBe(false);
  expect(depth).toBe(0);
}
