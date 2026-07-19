export type TableScope = "global" | "tenant";

export type TableDefinition = {
  name: string;
  scope: TableScope;
  requiresTenantId: boolean;
};

export const initialTables = [
  { name: "tenants", scope: "global", requiresTenantId: false },
  { name: "tenant_domains", scope: "global", requiresTenantId: false },
  { name: "platform_admin_accounts", scope: "global", requiresTenantId: false },
  { name: "platform_audit_log", scope: "global", requiresTenantId: false },
  {
    name: "deployment_egress_status_snapshots",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_egress_provider_policies",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_channel_provider_policies",
    scope: "global",
    requiresTenantId: false
  },
  {
    name: "deployment_channel_catalog_overrides",
    scope: "global",
    requiresTenantId: false
  },
  { name: "module_catalog", scope: "global", requiresTenantId: false },
  { name: "tenant_settings", scope: "tenant", requiresTenantId: true },
  { name: "tenant_brand_profiles", scope: "tenant", requiresTenantId: true },
  { name: "tenant_brand_assets", scope: "tenant", requiresTenantId: true },
  { name: "tenant_modules", scope: "tenant", requiresTenantId: true },
  { name: "channel_connectors", scope: "tenant", requiresTenantId: true },
  { name: "channel_sessions", scope: "tenant", requiresTenantId: true },
  { name: "channel_session_events", scope: "tenant", requiresTenantId: true },
  {
    name: "channel_auth_challenges",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "channel_provider_validation_jobs",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "source_connections", scope: "tenant", requiresTenantId: true },
  { name: "source_accounts", scope: "tenant", requiresTenantId: true },
  { name: "raw_inbound_events", scope: "tenant", requiresTenantId: true },
  // Inbox V2 raw ingress keeps a safe envelope/work head beside the legacy
  // compatibility anchor; restricted evidence remains independently purgeable.
  // prettier-ignore
  { name: "inbox_v2_source_raw_envelopes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_raw_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_raw_quarantines", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_raw_work_items", scope: "tenant", requiresTenantId: true },
  // SRC-008 processing runtime state is tenant-scoped and additive to the
  // N-1 raw-ingress work contract.
  // prettier-ignore
  { name: "inbox_v2_source_processing_key_generations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_delivery_dedupe_skeletons", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_processing_work_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_processing_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_processing_dead_letters", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_replay_requests", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_pressure_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_ingress_cursor_checkpoints", scope: "tenant", requiresTenantId: true },
  {
    name: "normalized_inbound_events",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "tenant_secrets", scope: "tenant", requiresTenantId: true },
  { name: "tenant_entitlements", scope: "tenant", requiresTenantId: true },
  { name: "tenant_usage_policies", scope: "tenant", requiresTenantId: true },
  { name: "usage_records", scope: "tenant", requiresTenantId: true },
  { name: "usage_period_summaries", scope: "tenant", requiresTenantId: true },
  { name: "tenant_api_keys", scope: "tenant", requiresTenantId: true },
  { name: "accounts", scope: "tenant", requiresTenantId: true },
  {
    name: "auth_email_verification_tokens",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "external_identity_links", scope: "tenant", requiresTenantId: true },
  { name: "employees", scope: "tenant", requiresTenantId: true },
  { name: "tenant_roles", scope: "tenant", requiresTenantId: true },
  { name: "tenant_role_permissions", scope: "tenant", requiresTenantId: true },
  { name: "tenant_role_bindings", scope: "tenant", requiresTenantId: true },
  {
    name: "direct_permission_grants",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "employee_invitations", scope: "tenant", requiresTenantId: true },
  { name: "sessions", scope: "global", requiresTenantId: false },
  {
    name: "auth_rate_limit_buckets",
    scope: "global",
    requiresTenantId: false
  },
  { name: "teams", scope: "tenant", requiresTenantId: true },
  { name: "org_units", scope: "tenant", requiresTenantId: true },
  { name: "work_queues", scope: "tenant", requiresTenantId: true },
  {
    name: "employee_org_unit_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "employee_work_queue_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  {
    name: "employee_team_memberships",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "clients", scope: "tenant", requiresTenantId: true },
  { name: "client_contacts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_bot_identities", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_identity_fences", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_employee_conversation_states", scope: "tenant", requiresTenantId: true },
  // Inbox V2 data-governance registry/template catalogs are deployment-global;
  // all effective policy, privacy and operation state below is tenant-local.
  // prettier-ignore
  { name: "inbox_v2_data_governance_registry_versions", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_storage_roots", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_lifecycle_handlers", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_data_use_lineages", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_policy_templates", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_policy_template_rules", scope: "global", requiresTenantId: false },
  // prettier-ignore
  { name: "inbox_v2_data_governance_contexts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_context_purpose_roles", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_effective_policies", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_effective_policy_rules", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_policy_activations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_policy_activation_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_lifecycle_purpose_sets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_lifecycle_purpose_instances", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_subject_links", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_scope_manifests", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_tenant_termination_scope_authorities", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_scope_manifest_roots", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_legal_hold_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_legal_hold_data_classes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_legal_hold_targets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_legal_hold_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_restriction_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_restriction_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_control_set_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_privacy_request_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_privacy_request_aliases", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_privacy_request_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_jobs", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_manifests", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_artifacts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_artifact_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_claims", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_export_receipt_cas", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_deletion_plans", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_deletion_checkpoint_requirements", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_deletion_runs", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_deletion_run_terminal_exports", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_deletion_stage_one_targets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_destructive_checkpoint_leases", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_operated_checkpoint_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_operated_checkpoint_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_backup_checkpoint_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_backup_checkpoint_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_external_checkpoint_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_external_checkpoint_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_erasure_restore_ledger", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_erasure_restore_ledger_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_erasure_restore_ledger_controls", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_restore_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_restore_required_controls", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_data_governance_restore_leases", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_client_link_evidence_references", scope: "tenant", requiresTenantId: true },
  {
    name: "inbox_v2_conversation_client_link_heads",
    scope: "tenant",
    requiresTenantId: true
  },
  // prettier-ignore
  { name: "inbox_v2_conversation_client_links", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_client_link_roles", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_client_link_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_client_link_transition_operations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_participants", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_membership_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_membership_commits", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_participant_membership_episodes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_participant_membership_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_external_identities", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_identity_claims", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_identity_claim_evidence_references", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_identity_claim_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_identity_claim_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_client_merge_graph_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_client_merge_node_states", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_client_merge_redirects", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_external_thread_key_registry", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_external_threads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_external_thread_aliases", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_provisional_keys", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identity_conflicts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identity_conflict_candidates", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identities", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identity_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identity_verified_snapshots", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_account_identity_aliases", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_evidence_sets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_evidence_references", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_bindings", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_remote_access_episodes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_snapshots", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_provider_roles", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_capability_entries", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_capability_required_roles", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_route_attributes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_thread_binding_transition_matched_permissions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_occurrences", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_occurrence_provider_references", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_occurrence_provider_timestamps", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_message_key_registry", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_items", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_subject_details", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_messages", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_action_attributions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_attachment_anchors", scope: "tenant", requiresTenantId: true },
  // MSG-003 file/object authority is additive to legacy files and attachment
  // anchors. Physical versions never inherit parent-link cascade semantics.
  // prettier-ignore
  { name: "inbox_v2_file_objects", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_object_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_object_version_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_attachment_materialization_jobs", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_object_operation_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_attachment_materialization_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_attachment_materialization_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_storage_orphans", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_parent_set_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_parent_links", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_parent_link_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_derivative_edges", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_outbound_dispatch_plans", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_outbound_artifact_plans", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_file_outbound_artifact_blocks", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_contents", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_content_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_content_payloads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_timeline_content_contact_values", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reference_contexts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reference_canonical_targets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reference_external_targets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reference_unresolved_targets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reference_unresolved_candidates", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_staff_notes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_staff_note_revisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_transport_links", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_transport_link_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_route_consumptions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_provider_lifecycle_operations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_provider_lifecycle_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reactions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reaction_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_reaction_slot_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_provider_reaction_observations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_provider_semantic_ordering_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_transport_fact_commits", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_message_delivery_observations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_provider_receipt_observations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_provider_receipt_opaque_payloads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_external_message_references", scope: "tenant", requiresTenantId: true },
  // SRC-006 keeps exact-key deferred actions and target-free finite weak
  // correlation evidence separate from canonical Message content.
  // prettier-ignore
  { name: "inbox_v2_deferred_message_source_actions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_deferred_message_source_action_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_deferred_source_action_conflict_candidates", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_deferred_source_action_ordering_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_message_correlation_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_thread_route_policy_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_thread_route_policy_fallback_bindings", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_thread_route_policy_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_routes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_multi_send_operations", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatches", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatch_attempts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatch_reconciliation_decisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatch_reconciliation_permissions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatch_artifacts", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_occurrence_resolution_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_source_occurrence_resolution_candidates", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_dispatch_artifact_reference_links", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbound_multi_send_children", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_provider_roster_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_provider_roster_member_evidence", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_policy_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_policy_activation_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_policy_activation_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_queue_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_queue_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_employee_assignment_fence_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_employee_assignment_fence_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_items", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_work_item_slots", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_conversation_work_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_sla_snapshots", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_queue_eligibility_decisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_creation_decisions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_primary_assignments", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_transitions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_servicing_team_episodes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_work_item_relation_transitions", scope: "tenant", requiresTenantId: true },
  // Inbox V2 RBAC-003 authorization relations, bounded revision fences and
  // reference-only tenant stream/audit commit manifests are tenant-local.
  // prettier-ignore
  { name: "inbox_v2_auth_tenant_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_employee_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_role_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_role_version_permissions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_role_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_role_binding_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_role_binding_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_direct_grant_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_direct_grant_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_workforce_membership_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_workforce_membership_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_resource_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_structural_access_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_structural_access_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_collaborator_versions", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_collaborator_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_command_records", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_stream_heads", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_stream_commits", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_tenant_stream_changes", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_domain_events", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbox_intents", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_outbox_terminal_payload_refs", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_audit_events", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_audit_facets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_mutation_commits", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_revision_effects", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_auth_relation_writes", scope: "tenant", requiresTenantId: true },
  // Inbox V2 RBAC-007 denial evidence is a separate bounded tenant-local sink;
  // it never participates in the tenant stream or domain/provider outbox.
  // prettier-ignore
  { name: "inbox_v2_security_denial_window_shards", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_security_denial_buckets", scope: "tenant", requiresTenantId: true },
  // prettier-ignore
  { name: "inbox_v2_security_denial_review_signals", scope: "tenant", requiresTenantId: true },
  // Immutable DB-008 reset completion evidence is tenant-owned and excluded
  // from the reset inventory digest only to avoid hashing its own receipt row.
  // prettier-ignore
  { name: "inbox_v2_database_reset_receipts", scope: "tenant", requiresTenantId: true },
  { name: "conversations", scope: "tenant", requiresTenantId: true },
  {
    name: "conversation_participants",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "messages", scope: "tenant", requiresTenantId: true },
  {
    name: "message_delivery_attempts",
    scope: "tenant",
    requiresTenantId: true
  },
  { name: "files", scope: "tenant", requiresTenantId: true },
  { name: "message_attachments", scope: "tenant", requiresTenantId: true },
  { name: "event_store", scope: "tenant", requiresTenantId: true },
  { name: "outbox", scope: "tenant", requiresTenantId: true },
  { name: "audit_log", scope: "tenant", requiresTenantId: true },
  { name: "webhook_subscriptions", scope: "tenant", requiresTenantId: true },
  { name: "integration_diagnostics", scope: "tenant", requiresTenantId: true },
  { name: "notification_endpoints", scope: "tenant", requiresTenantId: true },
  { name: "notification_events", scope: "tenant", requiresTenantId: true }
] as const satisfies readonly TableDefinition[];
