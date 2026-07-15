-- INBOX_V2_DATA_GOVERNANCE_PRIVACY_MIGRATION_FINALIZED_V1
-- INBOX_V2_DATA_GOVERNANCE_PRIVACY_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'module_catalog',
      'tenant_modules',
      'employees',
      'clients',
      'client_contacts',
      'source_connections',
      'source_accounts',
      'inbox_v2_source_external_identities',
      'inbox_v2_source_account_identities',
      'files',
      'event_store',
      'outbox',
      'inbox_v2_timeline_contents',
      'inbox_v2_timeline_content_revisions',
      'inbox_v2_employee_conversation_states'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.data_governance_privacy_foundation_missing',
      detail = 'Missing finalized 0032 anchor: ' || missing_anchor;
  end if;

  select anchor_name
    into missing_anchor
    from (
      select 'constraint:employees_tenant_id_unique' as anchor_name
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.employees'::regclass
            and conname = 'employees_tenant_id_unique'
       )
      union all
      select 'constraint:clients_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.clients'::regclass
            and conname = 'clients_tenant_id_unique'
       )
      union all
      select 'constraint:client_contacts_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.client_contacts'::regclass
            and conname = 'client_contacts_tenant_id_unique'
       )
      union all
      select 'constraint:inbox_v2_source_external_identities_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_source_external_identities'::regclass
            and conname = 'inbox_v2_source_external_identities_pk'
       )
      union all
      select 'constraint:inbox_v2_source_account_identities_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_source_account_identities'::regclass
            and conname = 'inbox_v2_source_account_identities_pk'
       )
      union all
      select 'constraint:files_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.files'::regclass
            and conname = 'files_tenant_id_unique'
       )
      union all
      select 'constraint:event_store_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.event_store'::regclass
            and conname = 'event_store_tenant_id_unique'
       )
      union all
      select 'constraint:inbox_v2_timeline_contents_owner_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_timeline_contents'::regclass
            and conname = 'inbox_v2_timeline_contents_owner_unique'
       )
      union all
      select 'trigger:inbox_v2_tm_content_coherence'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid = 'public.inbox_v2_timeline_contents'::regclass
            and tgname = 'inbox_v2_tm_content_coherence'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_ecs_state_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_employee_conversation_states'::regclass
            and tgname = 'inbox_v2_ecs_state_guard_trigger'
            and not tgisinternal
       )
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.data_governance_privacy_foundation_missing',
      detail = 'Missing finalized foundation constraint or trigger: ' ||
        missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'relation:' || relation_definition.relname as object_name
        from pg_catalog.pg_class relation_definition
        join pg_catalog.pg_namespace relation_namespace
          on relation_namespace.oid = relation_definition.relnamespace
       where relation_namespace.nspname = 'public'
         and position(
           'inbox_v2_data_governance_' in relation_definition.relname
         ) = 1
      union all
      select 'type:' || type_definition.typname
        from pg_catalog.pg_type type_definition
        join pg_catalog.pg_namespace type_namespace
          on type_namespace.oid = type_definition.typnamespace
       where type_namespace.nspname = 'public'
         and position(
           'inbox_v2_data_governance_' in type_definition.typname
         ) = 1
      union all
      select 'function:' || function_definition.proname
        from pg_catalog.pg_proc function_definition
        join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = function_definition.pronamespace
       where function_namespace.nspname = 'public'
         and position('inbox_v2_dg_' in function_definition.proname) = 1
      union all
      select 'trigger:' || trigger_definition.tgname
        from pg_catalog.pg_trigger trigger_definition
       where not trigger_definition.tgisinternal
         and position('inbox_v2_dg_' in trigger_definition.tgname) = 1
      union all
      select 'table:' || table_name
        from unnest(array[
          -- DB009_PARTIAL_TABLES_BEGIN
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
          'inbox_v2_data_governance_policy_activation_heads',
          'inbox_v2_data_governance_lifecycle_purpose_sets',
          'inbox_v2_data_governance_lifecycle_purpose_instances',
          'inbox_v2_data_governance_subject_links',
          'inbox_v2_data_governance_scope_manifests',
          'inbox_v2_data_governance_tenant_termination_scope_authorities',
          'inbox_v2_data_governance_scope_manifest_roots',
          'inbox_v2_data_governance_legal_hold_revisions',
          'inbox_v2_data_governance_legal_hold_data_classes',
          'inbox_v2_data_governance_legal_hold_targets',
          'inbox_v2_data_governance_legal_hold_heads',
          'inbox_v2_data_governance_restriction_revisions',
          'inbox_v2_data_governance_restriction_heads',
          'inbox_v2_data_governance_control_set_heads',
          'inbox_v2_data_governance_privacy_request_revisions',
          'inbox_v2_data_governance_privacy_request_aliases',
          'inbox_v2_data_governance_privacy_request_heads',
          'inbox_v2_data_governance_export_jobs',
          'inbox_v2_data_governance_export_manifests',
          'inbox_v2_data_governance_export_artifacts',
          'inbox_v2_data_governance_export_artifact_heads',
          'inbox_v2_data_governance_export_claims',
          'inbox_v2_data_governance_export_receipt_cas',
          'inbox_v2_data_governance_deletion_plans',
          'inbox_v2_data_governance_deletion_checkpoint_requirements',
          'inbox_v2_data_governance_deletion_runs',
          'inbox_v2_data_governance_deletion_run_terminal_exports',
          'inbox_v2_data_governance_deletion_stage_one_targets',
          'inbox_v2_data_governance_destructive_checkpoint_leases',
          'inbox_v2_data_governance_operated_checkpoint_attempts',
          'inbox_v2_data_governance_operated_checkpoint_heads',
          'inbox_v2_data_governance_backup_checkpoint_attempts',
          'inbox_v2_data_governance_backup_checkpoint_heads',
          'inbox_v2_data_governance_external_checkpoint_attempts',
          'inbox_v2_data_governance_external_checkpoint_heads',
          'inbox_v2_data_governance_erasure_restore_ledger',
          'inbox_v2_data_governance_erasure_restore_ledger_evidence',
          'inbox_v2_data_governance_erasure_restore_ledger_controls',
          'inbox_v2_data_governance_restore_heads',
          'inbox_v2_data_governance_restore_required_controls',
          'inbox_v2_data_governance_restore_leases'
          -- DB009_PARTIAL_TABLES_END
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          -- DB009_PARTIAL_TYPES_BEGIN
          'inbox_v2_data_governance_deployment_profile',
          'inbox_v2_data_governance_storage_root_kind',
          'inbox_v2_data_governance_root_boundary',
          'inbox_v2_data_governance_version_enumeration',
          'inbox_v2_data_governance_handler_kind',
          'inbox_v2_data_governance_policy_activation_kind',
          'inbox_v2_data_governance_approval_principal_kind',
          'inbox_v2_data_governance_copy_role',
          'inbox_v2_data_governance_subject_kind',
          'inbox_v2_data_governance_subject_link_role',
          'inbox_v2_data_governance_subject_provenance',
          'inbox_v2_data_governance_control_state',
          'inbox_v2_data_governance_control_reference_kind',
          'inbox_v2_data_governance_scope_kind',
          'inbox_v2_data_governance_privacy_request_state',
          'inbox_v2_data_governance_privacy_request_intent',
          'inbox_v2_data_governance_export_job_state',
          'inbox_v2_data_governance_export_product_kind',
          'inbox_v2_data_governance_export_artifact_state',
          'inbox_v2_data_governance_export_receipt_state',
          'inbox_v2_data_governance_deletion_run_state',
          'inbox_v2_data_governance_deletion_cause',
          'inbox_v2_data_governance_decision_basis_kind',
          'inbox_v2_data_governance_deletion_stage_one_state',
          'inbox_v2_data_governance_checkpoint_surface',
          'inbox_v2_data_governance_checkpoint_lease_state',
          'inbox_v2_data_governance_deletion_result',
          'inbox_v2_data_governance_operated_outcome',
          'inbox_v2_data_governance_backup_outcome',
          'inbox_v2_data_governance_external_outcome',
          'inbox_v2_data_governance_ledger_kind',
          'inbox_v2_data_governance_ledger_evidence_kind',
          'inbox_v2_data_governance_ledger_evidence_slot',
          'inbox_v2_data_governance_ledger_control_set_role',
          'inbox_v2_data_governance_backup_expiry_state',
          'inbox_v2_data_governance_restore_head_state',
          'inbox_v2_data_governance_restore_lease_state'
          -- DB009_PARTIAL_TYPES_END
        ]::text[]) as expected_type(type_name)
       where exists (
         select 1
           from pg_catalog.pg_type type_definition
           join pg_catalog.pg_namespace type_namespace
             on type_namespace.oid = type_definition.typnamespace
          where type_namespace.nspname = 'public'
            and type_definition.typname = expected_type.type_name
       )
      union all
      select 'function:' || function_name
        from unnest(array[
          -- DB009_PARTIAL_FUNCTIONS_BEGIN
          'inbox_v2_dg_reject_immutable',
          'inbox_v2_dg_deletion_run_terminal_export_required',
          'inbox_v2_dg_checkpoint_attempt_coherence',
          'inbox_v2_dg_governance_coherence',
          'inbox_v2_dg_deletion_run_transition_guard',
          'inbox_v2_dg_deletion_stage_one_target_coherence',
          'inbox_v2_dg_deletion_terminal_coherence',
          'inbox_v2_dg_erasure_ledger_coherence',
          'inbox_v2_dg_restore_current_controls',
          'inbox_v2_dg_restore_state_coherence',
          'inbox_v2_dg_cas_guard'
          -- DB009_PARTIAL_FUNCTIONS_END
        ]::text[]) as expected_function(function_name)
       where exists (
         select 1
           from pg_catalog.pg_proc function_definition
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = function_definition.pronamespace
          where function_namespace.nspname = 'public'
            and function_definition.proname = expected_function.function_name
       )
      union all
      select 'trigger:' || trigger_name
        from unnest(array[
          -- DB009_PARTIAL_TRIGGERS_BEGIN
          'inbox_v2_dg_deletion_run_terminal_export_required',
          'inbox_v2_dg_deletion_run_transition_guard_trigger',
          'inbox_v2_dg_deletion_stage_one_target_coherence_trigger',
          'inbox_v2_dg_deletion_terminal_coherence_constraint',
          'inbox_v2_dg_erasure_ledger_coherence_constraint',
          'inbox_v2_dg_erasure_ledger_controls_coherence_constraint',
          'inbox_v2_dg_erasure_ledger_evidence_coherence_constraint',
          'inbox_v2_dg_restore_ledger_state_coherence',
          'inbox_v2_dg_restore_head_state_coherence',
          'inbox_v2_dg_restore_required_state_coherence',
          'inbox_v2_dg_restore_lease_state_coherence',
          'inbox_v2_dg_immutable_49b4f7cff967328a',
          'inbox_v2_dg_immutable_cf8b178a68cc8673',
          'inbox_v2_dg_immutable_db9f391feab06629',
          'inbox_v2_dg_immutable_05896193d9ec8219',
          'inbox_v2_dg_immutable_21b264d071667f86',
          'inbox_v2_dg_immutable_f01d02f12173df37',
          'inbox_v2_dg_immutable_71d36b5cd6cefe42',
          'inbox_v2_dg_immutable_2b64a9e7002be6ad',
          'inbox_v2_dg_immutable_d1ccbb2931388c16',
          'inbox_v2_dg_immutable_1e231afa3108f21f',
          'inbox_v2_dg_immutable_4985356906de0ae4',
          'inbox_v2_dg_immutable_6e60303b3f666afc',
          'inbox_v2_dg_immutable_4b11635e16eb4250',
          'inbox_v2_dg_immutable_977e071fafecebe5',
          'inbox_v2_dg_immutable_14faf8c2832e40ad',
          'inbox_v2_dg_immutable_575137560ee16580',
          'inbox_v2_dg_immutable_944878708222fd08',
          'inbox_v2_dg_immutable_0a796064d2ba1d8f',
          'inbox_v2_dg_immutable_96524e152bfc9550',
          'inbox_v2_dg_immutable_54dbb2db2013af48',
          'inbox_v2_dg_immutable_cd886da2d88eb2bb',
          'inbox_v2_dg_immutable_5d66e9c05477f74f',
          'inbox_v2_dg_immutable_c6d6998403c75108',
          'inbox_v2_dg_immutable_45cf076df19ff79d',
          'inbox_v2_dg_immutable_c7c3fcfeba21cb31',
          'inbox_v2_dg_immutable_3de4aa94c3c6bf13',
          'inbox_v2_dg_immutable_3b49e7087ad08fff',
          'inbox_v2_dg_immutable_3f07e574df2744e4',
          'inbox_v2_dg_immutable_afa7bcb73ebea285',
          'inbox_v2_dg_immutable_20c8086e73b2f0fd',
          'inbox_v2_dg_immutable_78e39b66fe5223f9',
          'inbox_v2_dg_immutable_ece7abc26aa74e48',
          'inbox_v2_dg_immutable_5cc89ae3f6449bff',
          'inbox_v2_dg_immutable_d404ab87757a8e2a',
          'inbox_v2_dg_immutable_217c8e4e3b143ba2',
          'inbox_v2_dg_immutable_ab70a4b708588cd9',
          'inbox_v2_dg_attempt_78e39b66fe5223f9',
          'inbox_v2_dg_attempt_ece7abc26aa74e48',
          'inbox_v2_dg_attempt_5cc89ae3f6449bff',
          'inbox_v2_dg_coherence_944878708222fd08',
          'inbox_v2_dg_coherence_575137560ee16580',
          'inbox_v2_dg_coherence_977e071fafecebe5',
          'inbox_v2_dg_coherence_4985356906de0ae4',
          'inbox_v2_dg_coherence_ace306d23011cb30',
          'inbox_v2_dg_coherence_54dbb2db2013af48',
          'inbox_v2_dg_coherence_21f6f2c1b5275504',
          'inbox_v2_dg_coherence_5f810d52b6eaecf2',
          'inbox_v2_dg_coherence_0548adbde1f22a21',
          'inbox_v2_dg_coherence_dc57bd7924d8be9d',
          'inbox_v2_dg_coherence_45cf076df19ff79d',
          'inbox_v2_dg_coherence_c7c3fcfeba21cb31',
          'inbox_v2_dg_coherence_11e7cdcb5763cf1c',
          'inbox_v2_dg_coherence_3de4aa94c3c6bf13',
          'inbox_v2_dg_coherence_2f389db79b1fc4e1',
          'inbox_v2_dg_coherence_3f07e574df2744e4',
          'inbox_v2_dg_coherence_3b49e7087ad08fff',
          'inbox_v2_dg_coherence_d37849f32e3434f3',
          'inbox_v2_dg_coherence_afa7bcb73ebea285',
          'inbox_v2_dg_cas_dc57bd7924d8be9d',
          'inbox_v2_dg_cas_11e7cdcb5763cf1c',
          'inbox_v2_dg_cas_ace306d23011cb30',
          'inbox_v2_dg_cas_21f6f2c1b5275504',
          'inbox_v2_dg_cas_5f810d52b6eaecf2',
          'inbox_v2_dg_cas_ce65aa430812183a',
          'inbox_v2_dg_cas_0548adbde1f22a21',
          'inbox_v2_dg_cas_2f389db79b1fc4e1',
          'inbox_v2_dg_cas_d37849f32e3434f3',
          'inbox_v2_dg_cas_e86fba500d6dd368',
          'inbox_v2_dg_cas_1b24ea1c29167d5e',
          'inbox_v2_dg_cas_c1c6247540a0e0ff',
          'inbox_v2_dg_cas_d5c1460abc296493',
          'inbox_v2_dg_cas_1d216166d8782d5d',
          'inbox_v2_dg_cas_a8ad8a6d1f108e5f'
          -- DB009_PARTIAL_TRIGGERS_END
        ]::text[]) as expected_trigger(trigger_name)
       where exists (
         select 1
           from pg_catalog.pg_trigger trigger_definition
          where trigger_definition.tgname = expected_trigger.trigger_name
            and not trigger_definition.tgisinternal
       )
    ) partial_objects
   order by object_name
   limit 1;

  if partial_object is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.data_governance_privacy_partial_schema_detected',
      detail = 'Unexpected pre-existing DB-009 object: ' || partial_object;
  end if;
end;
$preflight$;
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_approval_principal_kind" AS ENUM('employee', 'account', 'service', 'module');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_backup_expiry_state" AS ENUM('not_applicable', 'finite_expiry_pending', 'verified_expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_backup_outcome" AS ENUM('finite_expiry_pending', 'expiry_verified', 'failed_retryable', 'unverified_terminal', 'blocked_by_legal_hold', 'stale_revision');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_checkpoint_lease_state" AS ENUM('claimed', 'completed', 'released', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_checkpoint_surface" AS ENUM('operated', 'backup', 'external');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_control_reference_kind" AS ENUM('legal_hold', 'restriction');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_control_state" AS ENUM('active', 'released');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_copy_role" AS ENUM('primary', 'derived', 'backup', 'external');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_decision_basis_kind" AS ENUM('lifecycle_policy', 'privacy_request', 'provider_lifecycle_event', 'employee_content_action');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_deletion_cause" AS ENUM('provider_message_delete', 'employee_ui_delete', 'retention_expiry', 'privacy_erasure', 'tenant_offboarding', 'administrative_policy_purge');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_deletion_result" AS ENUM('completed', 'completed_with_external_residuals', 'primary_purged_backup_expiry_pending', 'verification_blocked_internal_residual', 'failed_retryable');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_deletion_run_state" AS ENUM('executing', 'verification_pending', 'terminal');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_deletion_stage_one_state" AS ENUM('pending', 'content_unavailable');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_deployment_profile" AS ENUM('saas_shared', 'saas_isolated', 'on_prem');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_export_artifact_state" AS ENUM('building', 'ready', 'quarantined', 'deleted');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_export_job_state" AS ENUM('queued', 'running', 'ready', 'revoked', 'expired', 'failed_retryable', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_export_product_kind" AS ENUM('tenant_deployment', 'manager_report', 'data_subject');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_export_receipt_state" AS ENUM('issued', 'consumed', 'revoked', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_external_outcome" AS ENUM('requested', 'confirmed', 'unsupported', 'unknown', 'failed_retryable', 'blocked_by_legal_hold', 'stale_revision');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_ledger_control_set_role" AS ENUM('required', 'reapplied');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_ledger_evidence_kind" AS ENUM('digest', 'payload_reference');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_ledger_evidence_slot" AS ENUM('primary_absence', 'backup_expiry', 'control_application', 'restore');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_ledger_kind" AS ENUM('erasure_applied', 'hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'restore_opened', 'control_reapplied', 'restore_sealed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_handler_kind" AS ENUM('anchor_resolution', 'condition_resolution', 'scope_matcher', 'lifecycle', 'subject_discovery', 'export_projection', 'export_execution', 'delete_execution', 'verification', 'backup_expiry_ledger', 'external_deletion', 'migration_uninstall');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_operated_outcome" AS ENUM('verified_absent', 'failed_retryable', 'unverified_terminal', 'blocked_by_legal_hold', 'stale_revision');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_policy_activation_kind" AS ENUM('initial_reviewed_bootstrap', 'supersede_current');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_privacy_request_intent" AS ENUM('access', 'portability', 'erasure', 'restriction', 'correction', 'objection', 'tenant_termination_export_delete', 'administrative_retention_purge');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_privacy_request_state" AS ENUM('received', 'identity_verification', 'scope_discovery', 'policy_and_exception_review', 'approved', 'partially_approved', 'rejected', 'blocked_by_legal_hold', 'executing', 'verification_pending', 'completed', 'completed_with_external_residuals', 'primary_purged_backup_expiry_pending', 'verification_blocked_internal_residual', 'failed_retryable');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_restore_head_state" AS ENUM('open', 'sealed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_restore_lease_state" AS ENUM('active', 'completed', 'released', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_root_boundary" AS ENUM('operated_data_plane', 'outside_operated_data_plane');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_scope_kind" AS ENUM('exact', 'prospective', 'tenant_wide');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_storage_root_kind" AS ENUM('sql', 'json_blob', 'object', 'index_cache', 'log_trace', 'backup', 'external_route');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_subject_kind" AS ENUM('employee', 'client_contact', 'source_external_identity', 'account', 'unresolved_provider_subject');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_subject_link_role" AS ENUM('author', 'participant', 'contact', 'caller', 'recording_speaker', 'mentioned_person', 'crm_subject', 'owner', 'security_actor');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_subject_provenance" AS ENUM('canonical_relation', 'source_observation', 'reviewed_candidate', 'migration');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_data_governance_version_enumeration" AS ENUM('not_applicable', 'supported', 'expiry_ledger');
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"attempt" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"verification_handler_id" text NOT NULL,
	"expiry_ledger_handler_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"outcome" "inbox_v2_data_governance_backup_outcome" NOT NULL,
	"primary_absence_verified" boolean NOT NULL,
	"latest_possible_expiry_at" timestamp (3) with time zone,
	"expiry_verified_at" timestamp (3) with time zone,
	"evidence_hash" text NOT NULL,
	"execution_fence_hash" text NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_backup_attempts_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id","attempt"),
	CONSTRAINT "inbox_v2_dg_backup_attempt_values_check" CHECK ("inbox_v2_data_governance_backup_checkpoint_attempts"."run_revision" >= 1 and "inbox_v2_data_governance_backup_checkpoint_attempts"."plan_revision" >= 1 and "inbox_v2_data_governance_backup_checkpoint_attempts"."attempt" >= 1 and "inbox_v2_data_governance_backup_checkpoint_attempts"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_backup_checkpoint_attempts"."expected_lineage_revision" >= 1 and "inbox_v2_data_governance_backup_checkpoint_attempts"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_backup_checkpoint_attempts"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_backup_checkpoint_attempts"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_backup_checkpoint_attempts"."evidence_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_backup_checkpoint_attempts"."execution_fence_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_backup_attempt_pending_check" CHECK ("inbox_v2_data_governance_backup_checkpoint_attempts"."outcome" <> 'finite_expiry_pending' or ("inbox_v2_data_governance_backup_checkpoint_attempts"."primary_absence_verified" and "inbox_v2_data_governance_backup_checkpoint_attempts"."latest_possible_expiry_at" is not null and isfinite("inbox_v2_data_governance_backup_checkpoint_attempts"."latest_possible_expiry_at") and "inbox_v2_data_governance_backup_checkpoint_attempts"."latest_possible_expiry_at" > "inbox_v2_data_governance_backup_checkpoint_attempts"."completed_at" and "inbox_v2_data_governance_backup_checkpoint_attempts"."expiry_verified_at" is null)),
	CONSTRAINT "inbox_v2_dg_backup_attempt_verified_check" CHECK ("inbox_v2_data_governance_backup_checkpoint_attempts"."outcome" <> 'expiry_verified' or ("inbox_v2_data_governance_backup_checkpoint_attempts"."primary_absence_verified" and "inbox_v2_data_governance_backup_checkpoint_attempts"."latest_possible_expiry_at" is not null and "inbox_v2_data_governance_backup_checkpoint_attempts"."expiry_verified_at" is not null and isfinite("inbox_v2_data_governance_backup_checkpoint_attempts"."expiry_verified_at") and "inbox_v2_data_governance_backup_checkpoint_attempts"."expiry_verified_at" >= "inbox_v2_data_governance_backup_checkpoint_attempts"."latest_possible_expiry_at")),
	CONSTRAINT "inbox_v2_dg_backup_attempt_time_check" CHECK (isfinite("inbox_v2_data_governance_backup_checkpoint_attempts"."started_at") and isfinite("inbox_v2_data_governance_backup_checkpoint_attempts"."completed_at") and isfinite("inbox_v2_data_governance_backup_checkpoint_attempts"."lease_expires_at") and "inbox_v2_data_governance_backup_checkpoint_attempts"."completed_at" >= "inbox_v2_data_governance_backup_checkpoint_attempts"."started_at" and "inbox_v2_data_governance_backup_checkpoint_attempts"."lease_expires_at" > "inbox_v2_data_governance_backup_checkpoint_attempts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_backup_checkpoint_heads" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"current_attempt" bigint NOT NULL,
	"current_outcome" "inbox_v2_data_governance_backup_outcome" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_backup_heads_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_backup_head_values_check" CHECK ("inbox_v2_data_governance_backup_checkpoint_heads"."run_revision" >= 1 and "inbox_v2_data_governance_backup_checkpoint_heads"."current_attempt" >= 1 and "inbox_v2_data_governance_backup_checkpoint_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_backup_checkpoint_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_context_purpose_roles" (
	"tenant_id" text NOT NULL,
	"context_id" text NOT NULL,
	"context_version" bigint NOT NULL,
	"purpose_id" text NOT NULL,
	"regime_id" text NOT NULL,
	"role_id" text NOT NULL,
	"lawful_basis_reference_code" text NOT NULL,
	"customer_instruction_reference_code" text,
	CONSTRAINT "inbox_v2_dg_context_roles_pk" PRIMARY KEY("tenant_id","context_id","context_version","purpose_id","regime_id","role_id")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_contexts" (
	"tenant_id" text NOT NULL,
	"context_id" text NOT NULL,
	"version" bigint NOT NULL,
	"context_hash" text NOT NULL,
	"policy_revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"deployment_profile" "inbox_v2_data_governance_deployment_profile" NOT NULL,
	"time_zone" text NOT NULL,
	"tzdb_version" text NOT NULL,
	"approved_at" timestamp (3) with time zone NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"review_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_contexts_pk" PRIMARY KEY("tenant_id","context_id","version"),
	CONSTRAINT "inbox_v2_dg_contexts_values_check" CHECK ("inbox_v2_data_governance_contexts"."version" >= 1 and "inbox_v2_data_governance_contexts"."policy_revision" >= 1 and "inbox_v2_data_governance_contexts"."context_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_contexts_time_check" CHECK (isfinite("inbox_v2_data_governance_contexts"."approved_at") and isfinite("inbox_v2_data_governance_contexts"."effective_at") and isfinite("inbox_v2_data_governance_contexts"."review_at") and "inbox_v2_data_governance_contexts"."approved_at" <= "inbox_v2_data_governance_contexts"."effective_at" and "inbox_v2_data_governance_contexts"."review_at" > "inbox_v2_data_governance_contexts"."effective_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_control_set_heads" (
	"tenant_id" text NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_control_set_heads_pk" PRIMARY KEY("tenant_id"),
	CONSTRAINT "inbox_v2_dg_control_set_values_check" CHECK ("inbox_v2_data_governance_control_set_heads"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_control_set_heads"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_control_set_heads"."last_changed_stream_position" >= 0 and "inbox_v2_data_governance_control_set_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_control_set_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_data_use_lineages" (
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"owner_module_id" text,
	"lineage_revision" bigint NOT NULL,
	"lifecycle_handler_id" text NOT NULL,
	"subject_discovery_handler_id" text,
	"export_projection_handler_id" text,
	"export_handler_id" text,
	"delete_handler_id" text,
	"verification_handler_id" text,
	"expiry_ledger_handler_id" text,
	"external_delete_handler_id" text,
	"operations_mask" bigint NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_data_use_lineages_pk" PRIMARY KEY("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id"),
	CONSTRAINT "inbox_v2_dg_lineages_values_check" CHECK ("inbox_v2_data_governance_data_use_lineages"."lineage_revision" >= 1 and "inbox_v2_data_governance_data_use_lineages"."operations_mask" between 1 and 127)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" (
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"surface" "inbox_v2_data_governance_checkpoint_surface" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_kind" "inbox_v2_data_governance_storage_root_kind" NOT NULL,
	"boundary" "inbox_v2_data_governance_root_boundary" NOT NULL,
	"copy_role" "inbox_v2_data_governance_copy_role" NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	"delete_handler_id" text,
	"verification_handler_id" text,
	"expiry_ledger_handler_id" text,
	"external_delete_handler_id" text,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_checkpoint_requirements_pk" PRIMARY KEY("tenant_id","plan_id","plan_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_checkpoint_requirement_values_check" CHECK ("inbox_v2_data_governance_deletion_checkpoint_requirements"."plan_revision" >= 1 and "inbox_v2_data_governance_deletion_checkpoint_requirements"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_deletion_checkpoint_requirements"."expected_lineage_revision" >= 1 and "inbox_v2_data_governance_deletion_checkpoint_requirements"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_checkpoint_requirement_surface_check" CHECK (("inbox_v2_data_governance_deletion_checkpoint_requirements"."surface" = 'operated' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."boundary" = 'operated_data_plane' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."root_kind" not in ('backup', 'external_route') and "inbox_v2_data_governance_deletion_checkpoint_requirements"."copy_role" in ('primary', 'derived') and "inbox_v2_data_governance_deletion_checkpoint_requirements"."delete_handler_id" is not null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."verification_handler_id" is not null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."expiry_ledger_handler_id" is null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."external_delete_handler_id" is null) or ("inbox_v2_data_governance_deletion_checkpoint_requirements"."surface" = 'backup' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."boundary" = 'operated_data_plane' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."root_kind" = 'backup' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."copy_role" = 'backup' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."delete_handler_id" is null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."verification_handler_id" is not null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."expiry_ledger_handler_id" is not null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."external_delete_handler_id" is null) or ("inbox_v2_data_governance_deletion_checkpoint_requirements"."surface" = 'external' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."boundary" = 'outside_operated_data_plane' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."root_kind" = 'external_route' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."copy_role" = 'external' and "inbox_v2_data_governance_deletion_checkpoint_requirements"."delete_handler_id" is null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."verification_handler_id" is null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."expiry_ledger_handler_id" is null and "inbox_v2_data_governance_deletion_checkpoint_requirements"."external_delete_handler_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_deletion_plans" (
	"tenant_id" text NOT NULL,
	"plan_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"plan_hash" text NOT NULL,
	"cause" "inbox_v2_data_governance_deletion_cause" NOT NULL,
	"decision_basis_kind" "inbox_v2_data_governance_decision_basis_kind" NOT NULL,
	"decision_basis_id" text NOT NULL,
	"decision_basis_hash" text NOT NULL,
	"request_id" text,
	"request_revision" bigint,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"activation_id" text NOT NULL,
	"activation_revision" bigint NOT NULL,
	"activation_hash" text NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"stream_epoch" text NOT NULL,
	"sync_generation" bigint NOT NULL,
	"complete_through_position" bigint NOT NULL,
	"earliest_execution_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_deletion_plans_pk" PRIMARY KEY("tenant_id","plan_id","revision"),
	CONSTRAINT "inbox_v2_dg_deletion_plan_values_check" CHECK ("inbox_v2_data_governance_deletion_plans"."revision" >= 1 and "inbox_v2_data_governance_deletion_plans"."manifest_revision" >= 1 and "inbox_v2_data_governance_deletion_plans"."governance_context_version" >= 1 and "inbox_v2_data_governance_deletion_plans"."policy_version" >= 1 and "inbox_v2_data_governance_deletion_plans"."activation_revision" >= 1 and "inbox_v2_data_governance_deletion_plans"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_deletion_plans"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_deletion_plans"."sync_generation" >= 1 and "inbox_v2_data_governance_deletion_plans"."complete_through_position" >= 0 and "inbox_v2_data_governance_deletion_plans"."plan_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_plans"."decision_basis_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_plans"."registry_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_plans"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_plans"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_plans"."activation_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_deletion_plan_request_check" CHECK (("inbox_v2_data_governance_deletion_plans"."cause" in ('privacy_erasure', 'tenant_offboarding') and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" = 'privacy_request' and "inbox_v2_data_governance_deletion_plans"."request_id" is not null and "inbox_v2_data_governance_deletion_plans"."request_revision" >= 1) or ("inbox_v2_data_governance_deletion_plans"."cause" not in ('privacy_erasure', 'tenant_offboarding') and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" <> 'privacy_request' and "inbox_v2_data_governance_deletion_plans"."request_id" is null and "inbox_v2_data_governance_deletion_plans"."request_revision" is null)),
	CONSTRAINT "inbox_v2_dg_deletion_plan_basis_check" CHECK (("inbox_v2_data_governance_deletion_plans"."cause" in ('retention_expiry', 'administrative_policy_purge') and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" = 'lifecycle_policy') or ("inbox_v2_data_governance_deletion_plans"."cause" = 'provider_message_delete' and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" = 'provider_lifecycle_event') or ("inbox_v2_data_governance_deletion_plans"."cause" = 'employee_ui_delete' and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" = 'employee_content_action') or ("inbox_v2_data_governance_deletion_plans"."cause" in ('privacy_erasure', 'tenant_offboarding') and "inbox_v2_data_governance_deletion_plans"."decision_basis_kind" = 'privacy_request')),
	CONSTRAINT "inbox_v2_dg_deletion_plan_time_check" CHECK (isfinite("inbox_v2_data_governance_deletion_plans"."created_at") and isfinite("inbox_v2_data_governance_deletion_plans"."earliest_execution_at") and "inbox_v2_data_governance_deletion_plans"."earliest_execution_at" >= "inbox_v2_data_governance_deletion_plans"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_deletion_run_terminal_exports" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"artifact_id" text NOT NULL,
	"artifact_revision" bigint NOT NULL,
	"bound_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_deletion_run_terminal_exports_pk" PRIMARY KEY("tenant_id","run_id","run_revision"),
	CONSTRAINT "inbox_v2_dg_deletion_run_terminal_export_values_check" CHECK ("inbox_v2_data_governance_deletion_run_terminal_exports"."run_revision" >= 1 and "inbox_v2_data_governance_deletion_run_terminal_exports"."job_revision" >= 1 and "inbox_v2_data_governance_deletion_run_terminal_exports"."manifest_revision" >= 1 and "inbox_v2_data_governance_deletion_run_terminal_exports"."artifact_revision" >= 1 and isfinite("inbox_v2_data_governance_deletion_run_terminal_exports"."bound_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_deletion_runs" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"state_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_deletion_run_state" NOT NULL,
	"result" "inbox_v2_data_governance_deletion_result",
	"stage_one_state" "inbox_v2_data_governance_deletion_stage_one_state" NOT NULL,
	"stage_one_committed_at" timestamp (3) with time zone,
	"primary_absence_verified" boolean NOT NULL,
	"has_internal_residual" boolean NOT NULL,
	"has_external_residual" boolean NOT NULL,
	"has_backup_expiry_pending" boolean NOT NULL,
	"backup_latest_possible_expiry_at" timestamp (3) with time zone,
	"operated_checkpoint_count" bigint NOT NULL,
	"backup_checkpoint_count" bigint NOT NULL,
	"external_checkpoint_count" bigint NOT NULL,
	"completed_checkpoint_count" bigint NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"state_hash" text NOT NULL,
	CONSTRAINT "inbox_v2_dg_deletion_runs_pk" PRIMARY KEY("tenant_id","run_id","revision"),
	CONSTRAINT "inbox_v2_dg_deletion_run_plan_anchor_unique" UNIQUE("tenant_id","run_id","revision","plan_id","plan_revision"),
	CONSTRAINT "inbox_v2_dg_deletion_run_values_check" CHECK ("inbox_v2_data_governance_deletion_runs"."revision" >= 1 and "inbox_v2_data_governance_deletion_runs"."state_revision" >= 1 and "inbox_v2_data_governance_deletion_runs"."plan_revision" >= 1 and "inbox_v2_data_governance_deletion_runs"."operated_checkpoint_count" >= 1 and "inbox_v2_data_governance_deletion_runs"."backup_checkpoint_count" >= 0 and "inbox_v2_data_governance_deletion_runs"."external_checkpoint_count" >= 0 and "inbox_v2_data_governance_deletion_runs"."completed_checkpoint_count" >= 0 and "inbox_v2_data_governance_deletion_runs"."completed_checkpoint_count" <= "inbox_v2_data_governance_deletion_runs"."operated_checkpoint_count" + "inbox_v2_data_governance_deletion_runs"."backup_checkpoint_count" + "inbox_v2_data_governance_deletion_runs"."external_checkpoint_count" and "inbox_v2_data_governance_deletion_runs"."state_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_deletion_run_terminal_check" CHECK (("inbox_v2_data_governance_deletion_runs"."state" = 'terminal' and "inbox_v2_data_governance_deletion_runs"."result" is not null and "inbox_v2_data_governance_deletion_runs"."completed_at" is not null and "inbox_v2_data_governance_deletion_runs"."stage_one_state" = 'content_unavailable' and "inbox_v2_data_governance_deletion_runs"."stage_one_committed_at" is not null) or ("inbox_v2_data_governance_deletion_runs"."state" <> 'terminal' and "inbox_v2_data_governance_deletion_runs"."result" is null and "inbox_v2_data_governance_deletion_runs"."completed_at" is null)),
	CONSTRAINT "inbox_v2_dg_deletion_run_stage_one_check" CHECK (("inbox_v2_data_governance_deletion_runs"."stage_one_state" = 'pending' and "inbox_v2_data_governance_deletion_runs"."stage_one_committed_at" is null) or ("inbox_v2_data_governance_deletion_runs"."stage_one_state" = 'content_unavailable' and "inbox_v2_data_governance_deletion_runs"."stage_one_committed_at" is not null and isfinite("inbox_v2_data_governance_deletion_runs"."stage_one_committed_at") and "inbox_v2_data_governance_deletion_runs"."stage_one_committed_at" >= "inbox_v2_data_governance_deletion_runs"."started_at")),
	CONSTRAINT "inbox_v2_dg_deletion_run_time_check" CHECK (isfinite("inbox_v2_data_governance_deletion_runs"."started_at") and isfinite("inbox_v2_data_governance_deletion_runs"."updated_at") and "inbox_v2_data_governance_deletion_runs"."updated_at" >= "inbox_v2_data_governance_deletion_runs"."started_at" and ("inbox_v2_data_governance_deletion_runs"."completed_at" is null or (isfinite("inbox_v2_data_governance_deletion_runs"."completed_at") and "inbox_v2_data_governance_deletion_runs"."completed_at" >= "inbox_v2_data_governance_deletion_runs"."started_at" and "inbox_v2_data_governance_deletion_runs"."updated_at" >= "inbox_v2_data_governance_deletion_runs"."completed_at"))),
	CONSTRAINT "inbox_v2_dg_deletion_run_internal_check" CHECK (not "inbox_v2_data_governance_deletion_runs"."has_internal_residual" or "inbox_v2_data_governance_deletion_runs"."result" = 'verification_blocked_internal_residual'),
	CONSTRAINT "inbox_v2_dg_deletion_run_external_check" CHECK ("inbox_v2_data_governance_deletion_runs"."result" <> 'completed_with_external_residuals' or ("inbox_v2_data_governance_deletion_runs"."has_external_residual" and not "inbox_v2_data_governance_deletion_runs"."has_internal_residual" and not "inbox_v2_data_governance_deletion_runs"."has_backup_expiry_pending" and "inbox_v2_data_governance_deletion_runs"."primary_absence_verified")),
	CONSTRAINT "inbox_v2_dg_deletion_run_backup_check" CHECK ("inbox_v2_data_governance_deletion_runs"."result" <> 'primary_purged_backup_expiry_pending' or ("inbox_v2_data_governance_deletion_runs"."has_backup_expiry_pending" and "inbox_v2_data_governance_deletion_runs"."primary_absence_verified" and not "inbox_v2_data_governance_deletion_runs"."has_internal_residual" and "inbox_v2_data_governance_deletion_runs"."backup_latest_possible_expiry_at" is not null and isfinite("inbox_v2_data_governance_deletion_runs"."backup_latest_possible_expiry_at"))),
	CONSTRAINT "inbox_v2_dg_deletion_run_completed_check" CHECK ("inbox_v2_data_governance_deletion_runs"."result" <> 'completed' or ("inbox_v2_data_governance_deletion_runs"."primary_absence_verified" and not "inbox_v2_data_governance_deletion_runs"."has_internal_residual" and not "inbox_v2_data_governance_deletion_runs"."has_external_residual" and not "inbox_v2_data_governance_deletion_runs"."has_backup_expiry_pending")),
	CONSTRAINT "inbox_v2_dg_deletion_run_backup_shape_check" CHECK ("inbox_v2_data_governance_deletion_runs"."has_backup_expiry_pending" = ("inbox_v2_data_governance_deletion_runs"."backup_latest_possible_expiry_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_deletion_stage_one_targets" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"expected_revision" bigint NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"tombstone_tenant_id" text NOT NULL,
	"tombstone_record_id" text NOT NULL,
	"tombstone_schema_id" text NOT NULL,
	"tombstone_schema_version" text NOT NULL,
	"tombstone_digest" text NOT NULL,
	"invalidation_digest" text NOT NULL,
	"committed_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_deletion_stage_one_targets_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_deletion_stage_one_target_values_check" CHECK ("inbox_v2_data_governance_deletion_stage_one_targets"."run_revision" >= 1 and "inbox_v2_data_governance_deletion_stage_one_targets"."plan_revision" >= 1 and "inbox_v2_data_governance_deletion_stage_one_targets"."expected_revision" >= 1 and "inbox_v2_data_governance_deletion_stage_one_targets"."resulting_revision" > "inbox_v2_data_governance_deletion_stage_one_targets"."expected_revision" and "inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_tenant_id" = "inbox_v2_data_governance_deletion_stage_one_targets"."tenant_id" and "inbox_v2_data_governance_deletion_stage_one_targets"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_digest" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_stage_one_targets"."invalidation_digest" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_deletion_stage_one_targets"."root_record_id" ~ '^data_root:[A-Za-z0-9][A-Za-z0-9._~-]*$' and length("inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_record_id") between 3 and 200 and "inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_record_id" !~ '[[:cntrl:]@+[:space:]]' and length("inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_schema_id") between 3 and 120 and "inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_schema_id" !~ '[[:cntrl:]@+[:space:]]' and "inbox_v2_data_governance_deletion_stage_one_targets"."tombstone_schema_version" ~ '^v[1-9][0-9]*$' and isfinite("inbox_v2_data_governance_deletion_stage_one_targets"."committed_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"claim_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_checkpoint_lease_state" NOT NULL,
	"execution_fence_hash" text NOT NULL,
	"surface" "inbox_v2_data_governance_checkpoint_surface" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"execution_handler_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"activation_id" text NOT NULL,
	"activation_revision" bigint NOT NULL,
	"activation_hash" text NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"authorization_decision_id" text NOT NULL,
	"authorization_epoch" text NOT NULL,
	"authorization_principal_kind" text NOT NULL,
	"authorization_principal_key" text NOT NULL,
	"authorization_permission_id" text NOT NULL,
	"authorization_resource_scope_id" text NOT NULL,
	"authorization_resource_entity_type_id" text NOT NULL,
	"authorization_resource_entity_id" text NOT NULL,
	"authorization_resource_access_revision" bigint NOT NULL,
	"authorization_decision_revision" bigint NOT NULL,
	"authorization_decision_hash" text NOT NULL,
	"authorization_outcome" text NOT NULL,
	"authorization_decided_at" timestamp (3) with time zone NOT NULL,
	"authorization_not_after" timestamp (3) with time zone NOT NULL,
	"claimed_at" timestamp (3) with time zone NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_destructive_leases_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_destructive_lease_values_check" CHECK ("inbox_v2_data_governance_destructive_checkpoint_leases"."run_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."plan_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."claim_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."expected_lineage_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."governance_context_version" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."policy_version" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."activation_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_destructive_checkpoint_leases"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_resource_access_revision" >= 0 and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_decision_revision" >= 1 and "inbox_v2_data_governance_destructive_checkpoint_leases"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."execution_fence_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."registry_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."activation_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_decision_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_destructive_lease_authorization_check" CHECK ("inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_principal_kind" in ('employee', 'trusted_service') and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_permission_id" = 'core:privacy.deletion.execute' and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_resource_scope_id" = 'core:privacy-deletion-plan' and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_resource_entity_type_id" = 'core:privacy-deletion-plan' and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_resource_entity_id" = "inbox_v2_data_governance_destructive_checkpoint_leases"."plan_id" and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_resource_access_revision" = "inbox_v2_data_governance_destructive_checkpoint_leases"."plan_revision" and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_outcome" = 'allowed' and isfinite("inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_decided_at") and isfinite("inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_not_after") and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_not_after" > "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_decided_at"),
	CONSTRAINT "inbox_v2_dg_destructive_lease_time_check" CHECK (isfinite("inbox_v2_data_governance_destructive_checkpoint_leases"."claimed_at") and isfinite("inbox_v2_data_governance_destructive_checkpoint_leases"."lease_expires_at") and isfinite("inbox_v2_data_governance_destructive_checkpoint_leases"."updated_at") and "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_decided_at" <= "inbox_v2_data_governance_destructive_checkpoint_leases"."claimed_at" and "inbox_v2_data_governance_destructive_checkpoint_leases"."lease_expires_at" > "inbox_v2_data_governance_destructive_checkpoint_leases"."claimed_at" and "inbox_v2_data_governance_destructive_checkpoint_leases"."lease_expires_at" <= "inbox_v2_data_governance_destructive_checkpoint_leases"."authorization_not_after" and "inbox_v2_data_governance_destructive_checkpoint_leases"."updated_at" >= "inbox_v2_data_governance_destructive_checkpoint_leases"."claimed_at" and (("inbox_v2_data_governance_destructive_checkpoint_leases"."state" = 'completed' and "inbox_v2_data_governance_destructive_checkpoint_leases"."completed_at" is not null and "inbox_v2_data_governance_destructive_checkpoint_leases"."completed_at" >= "inbox_v2_data_governance_destructive_checkpoint_leases"."claimed_at") or ("inbox_v2_data_governance_destructive_checkpoint_leases"."state" <> 'completed' and "inbox_v2_data_governance_destructive_checkpoint_leases"."completed_at" is null)))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_effective_policies" (
	"tenant_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"deployment_profile" "inbox_v2_data_governance_deployment_profile" NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_effective_policies_pk" PRIMARY KEY("tenant_id","policy_id","version"),
	CONSTRAINT "inbox_v2_dg_effective_policy_values_check" CHECK ("inbox_v2_data_governance_effective_policies"."version" >= 1 and "inbox_v2_data_governance_effective_policies"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_effective_policies"."effective_at") and isfinite("inbox_v2_data_governance_effective_policies"."created_at") and "inbox_v2_data_governance_effective_policies"."created_at" <= "inbox_v2_data_governance_effective_policies"."effective_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_effective_policy_rules" (
	"tenant_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"rule_id" text NOT NULL,
	"rule_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"retention_anchor_id" text NOT NULL,
	"action_at_expiry" text NOT NULL,
	"hold_eligible" boolean NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_effective_policy_rules_pk" PRIMARY KEY("tenant_id","policy_id","policy_version","rule_id","rule_revision"),
	CONSTRAINT "inbox_v2_dg_effective_rule_values_check" CHECK ("inbox_v2_data_governance_effective_policy_rules"."policy_version" >= 1 and "inbox_v2_data_governance_effective_policy_rules"."rule_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_erasure_restore_ledger" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"sequence" bigint NOT NULL,
	"kind" "inbox_v2_data_governance_ledger_kind" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"activation_id" text NOT NULL,
	"activation_revision" bigint NOT NULL,
	"activation_hash" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"root_kind" "inbox_v2_data_governance_storage_root_kind" NOT NULL,
	"boundary" "inbox_v2_data_governance_root_boundary" NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_revision" bigint NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"deletion_run_id" text,
	"deletion_run_revision" bigint,
	"control_kind" "inbox_v2_data_governance_control_reference_kind",
	"control_id" text,
	"control_revision" bigint,
	"restore_id" text,
	"primary_absence_verified" boolean NOT NULL,
	"primary_absence_verified_at" timestamp (3) with time zone,
	"primary_verification_handler_id" text,
	"backup_expiry_state" "inbox_v2_data_governance_backup_expiry_state" NOT NULL,
	"backup_latest_possible_expiry_at" timestamp (3) with time zone,
	"backup_verified_at" timestamp (3) with time zone,
	"control_applied_at" timestamp (3) with time zone,
	"control_released_at" timestamp (3) with time zone,
	"control_reapplied_at" timestamp (3) with time zone,
	"restore_sealed_at" timestamp (3) with time zone,
	"required_control_hash" text,
	"reapplied_control_hash" text,
	"source_erasure_entry_hash" text,
	"source_control_entry_hash" text,
	"stream_epoch" text NOT NULL,
	"sync_generation" bigint NOT NULL,
	"complete_through_position" bigint NOT NULL,
	"previous_entry_hash" text,
	"entry_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_erasure_restore_ledger_pk" PRIMARY KEY("tenant_id","ledger_entry_id"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_entry_anchor_unique" UNIQUE("tenant_id","ledger_id","ledger_entry_id"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_hash_unique" UNIQUE("tenant_id","ledger_id","entry_hash"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_values_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger"."sequence" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."governance_context_version" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."policy_version" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."activation_revision" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."entity_revision" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."lineage_revision" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."sync_generation" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger"."complete_through_position" >= 0 and "inbox_v2_data_governance_erasure_restore_ledger"."registry_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."activation_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."entry_hash" ~ '^sha256:[0-9a-f]{64}$' and ("inbox_v2_data_governance_erasure_restore_ledger"."previous_entry_hash" is null or "inbox_v2_data_governance_erasure_restore_ledger"."previous_entry_hash" ~ '^sha256:[0-9a-f]{64}$') and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."occurred_at") and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."recorded_at") and "inbox_v2_data_governance_erasure_restore_ledger"."recorded_at" >= "inbox_v2_data_governance_erasure_restore_ledger"."occurred_at"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_run_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'erasure_applied' and "inbox_v2_data_governance_erasure_restore_ledger"."deletion_run_id" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."deletion_run_revision" >= 1) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" <> 'erasure_applied' and "inbox_v2_data_governance_erasure_restore_ledger"."deletion_run_id" is null and "inbox_v2_data_governance_erasure_restore_ledger"."deletion_run_revision" is null)),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_erasure_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger"."kind" <> 'erasure_applied' or "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_control_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied') and "inbox_v2_data_governance_erasure_restore_ledger"."control_kind" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."control_id" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."control_revision" >= 1) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" not in ('hold_applied', 'restriction_applied', 'hold_released', 'restriction_released', 'control_reapplied') and "inbox_v2_data_governance_erasure_restore_ledger"."control_kind" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_id" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_revision" is null)),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_control_kind_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger"."kind" not in ('hold_applied', 'hold_released') or "inbox_v2_data_governance_erasure_restore_ledger"."control_kind" = 'legal_hold'),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_restriction_kind_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger"."kind" not in ('restriction_applied', 'restriction_released') or "inbox_v2_data_governance_erasure_restore_ledger"."control_kind" = 'restriction'),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_restore_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('erasure_applied', 'hold_applied', 'restriction_applied', 'hold_released', 'restriction_released') and "inbox_v2_data_governance_erasure_restore_ledger"."restore_id" is null and "inbox_v2_data_governance_erasure_restore_ledger"."required_control_hash" is null and "inbox_v2_data_governance_erasure_restore_ledger"."reapplied_control_hash" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'restore_opened' and "inbox_v2_data_governance_erasure_restore_ledger"."restore_id" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."required_control_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."reapplied_control_hash" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'control_reapplied' and "inbox_v2_data_governance_erasure_restore_ledger"."restore_id" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."required_control_hash" is null and "inbox_v2_data_governance_erasure_restore_ledger"."reapplied_control_hash" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'restore_sealed' and "inbox_v2_data_governance_erasure_restore_ledger"."restore_id" is not null and "inbox_v2_data_governance_erasure_restore_ledger"."required_control_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."reapplied_control_hash" ~ '^sha256:[0-9a-f]{64}$')),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_source_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('restore_opened', 'restore_sealed') and "inbox_v2_data_governance_erasure_restore_ledger"."source_erasure_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_erasure_restore_ledger"."source_control_entry_hash" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'control_reapplied' and "inbox_v2_data_governance_erasure_restore_ledger"."source_erasure_entry_hash" is null and "inbox_v2_data_governance_erasure_restore_ledger"."source_control_entry_hash" ~ '^sha256:[0-9a-f]{64}$') or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" not in ('restore_opened', 'control_reapplied', 'restore_sealed') and "inbox_v2_data_governance_erasure_restore_ledger"."source_erasure_entry_hash" is null and "inbox_v2_data_governance_erasure_restore_ledger"."source_control_entry_hash" is null)),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_primary_evidence_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified" and "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified_at") and "inbox_v2_data_governance_erasure_restore_ledger"."primary_verification_handler_id" is not null) or (not "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified" and "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."primary_verification_handler_id" is null)),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_backup_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."backup_expiry_state" = 'not_applicable' and "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."backup_verified_at" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."backup_expiry_state" = 'finite_expiry_pending' and "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified" and "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at") and "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at" > "inbox_v2_data_governance_erasure_restore_ledger"."recorded_at" and "inbox_v2_data_governance_erasure_restore_ledger"."backup_verified_at" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."backup_expiry_state" = 'verified_expired' and "inbox_v2_data_governance_erasure_restore_ledger"."primary_absence_verified" and "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at") and "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at" <= "inbox_v2_data_governance_erasure_restore_ledger"."recorded_at" and "inbox_v2_data_governance_erasure_restore_ledger"."backup_verified_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."backup_verified_at") and "inbox_v2_data_governance_erasure_restore_ledger"."backup_verified_at" >= "inbox_v2_data_governance_erasure_restore_ledger"."backup_latest_possible_expiry_at")),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_control_time_check" CHECK (("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('hold_applied', 'restriction_applied') and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at") and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" <= "inbox_v2_data_governance_erasure_restore_ledger"."occurred_at" and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('hold_released', 'restriction_released') and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."control_released_at") and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" <= "inbox_v2_data_governance_erasure_restore_ledger"."occurred_at" and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'control_reapplied' and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at") and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" <= "inbox_v2_data_governance_erasure_restore_ledger"."occurred_at" and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" is null) or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'restore_sealed' and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" is not null and isfinite("inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at") and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" <= "inbox_v2_data_governance_erasure_restore_ledger"."occurred_at") or ("inbox_v2_data_governance_erasure_restore_ledger"."kind" in ('erasure_applied', 'restore_opened') and "inbox_v2_data_governance_erasure_restore_ledger"."control_applied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_released_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."control_reapplied_at" is null and "inbox_v2_data_governance_erasure_restore_ledger"."restore_sealed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_erasure_restore_ledger_controls" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"role" "inbox_v2_data_governance_ledger_control_set_role" NOT NULL,
	"control_kind" "inbox_v2_data_governance_control_reference_kind" NOT NULL,
	"control_id" text NOT NULL,
	"control_revision" bigint NOT NULL,
	"control_entry_hash" text NOT NULL,
	CONSTRAINT "inbox_v2_dg_erasure_ledger_controls_pk" PRIMARY KEY("tenant_id","ledger_id","ledger_entry_id","role","control_kind","control_id","control_revision"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_control_values_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger_controls"."control_revision" >= 1 and "inbox_v2_data_governance_erasure_restore_ledger_controls"."control_entry_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_erasure_restore_ledger_evidence" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"ledger_entry_id" text NOT NULL,
	"slot" "inbox_v2_data_governance_ledger_evidence_slot" NOT NULL,
	"kind" "inbox_v2_data_governance_ledger_evidence_kind" NOT NULL,
	"digest" text NOT NULL,
	"payload_tenant_id" text,
	"payload_record_id" text,
	"payload_schema_id" text,
	"payload_schema_version" text,
	CONSTRAINT "inbox_v2_dg_erasure_ledger_evidence_pk" PRIMARY KEY("tenant_id","ledger_id","ledger_entry_id","slot"),
	CONSTRAINT "inbox_v2_dg_erasure_ledger_evidence_values_check" CHECK ("inbox_v2_data_governance_erasure_restore_ledger_evidence"."digest" ~ '^sha256:[0-9a-f]{64}$' and (("inbox_v2_data_governance_erasure_restore_ledger_evidence"."kind" = 'digest' and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_tenant_id" is null and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_record_id" is null and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_id" is null and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_version" is null) or ("inbox_v2_data_governance_erasure_restore_ledger_evidence"."kind" = 'payload_reference' and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_tenant_id" = "inbox_v2_data_governance_erasure_restore_ledger_evidence"."tenant_id" and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_record_id" is not null and length("inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_record_id") between 3 and 200 and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_record_id" !~ '[[:cntrl:]@+[:space:]]' and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_id" is not null and length("inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_id") between 3 and 120 and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_id" !~ '[[:cntrl:]@+[:space:]]' and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_version" is not null and length("inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_version") between 1 and 64 and "inbox_v2_data_governance_erasure_restore_ledger_evidence"."payload_schema_version" !~ '[[:cntrl:]@+[:space:]]')))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_artifact_heads" (
	"tenant_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"artifact_claim_key" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_state" "inbox_v2_data_governance_export_artifact_state" NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_artifact_heads_pk" PRIMARY KEY("tenant_id","artifact_id"),
	CONSTRAINT "inbox_v2_dg_export_artifact_head_values_check" CHECK ("inbox_v2_data_governance_export_artifact_heads"."current_revision" >= 1 and "inbox_v2_data_governance_export_artifact_heads"."job_revision" >= 1 and isfinite("inbox_v2_data_governance_export_artifact_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_artifacts" (
	"tenant_id" text NOT NULL,
	"artifact_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_export_artifact_state" NOT NULL,
	"artifact_claim_key" text NOT NULL,
	"manifest_id" text,
	"manifest_revision" bigint,
	"manifest_hash" text,
	"payload_checksum" text,
	"payload_locator" text,
	"packaging_proof_hash" text,
	"archive_composition_hash" text,
	"byte_count" bigint NOT NULL,
	"ready_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone,
	"deleted_at" timestamp (3) with time zone,
	"canonical_snapshot" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_artifacts_pk" PRIMARY KEY("tenant_id","artifact_id","revision"),
	CONSTRAINT "inbox_v2_dg_export_artifact_values_check" CHECK ("inbox_v2_data_governance_export_artifacts"."revision" >= 1 and "inbox_v2_data_governance_export_artifacts"."job_revision" >= 1 and "inbox_v2_data_governance_export_artifacts"."byte_count" >= 0 and isfinite("inbox_v2_data_governance_export_artifacts"."recorded_at")),
	CONSTRAINT "inbox_v2_dg_export_artifact_state_check" CHECK (("inbox_v2_data_governance_export_artifacts"."state" = 'building' and "inbox_v2_data_governance_export_artifacts"."manifest_id" is null and "inbox_v2_data_governance_export_artifacts"."manifest_revision" is null and "inbox_v2_data_governance_export_artifacts"."manifest_hash" is null and "inbox_v2_data_governance_export_artifacts"."payload_checksum" is null and "inbox_v2_data_governance_export_artifacts"."byte_count" = 0 and "inbox_v2_data_governance_export_artifacts"."packaging_proof_hash" is null and "inbox_v2_data_governance_export_artifacts"."archive_composition_hash" is null and "inbox_v2_data_governance_export_artifacts"."ready_at" is null and "inbox_v2_data_governance_export_artifacts"."expires_at" is null and "inbox_v2_data_governance_export_artifacts"."deleted_at" is null) or ("inbox_v2_data_governance_export_artifacts"."state" = 'ready' and "inbox_v2_data_governance_export_artifacts"."manifest_id" is not null and "inbox_v2_data_governance_export_artifacts"."manifest_revision" >= 1 and "inbox_v2_data_governance_export_artifacts"."manifest_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_artifacts"."payload_checksum" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_artifacts"."payload_locator" is not null and "inbox_v2_data_governance_export_artifacts"."byte_count" > 0 and "inbox_v2_data_governance_export_artifacts"."packaging_proof_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_artifacts"."archive_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_artifacts"."ready_at" is not null and "inbox_v2_data_governance_export_artifacts"."expires_at" is not null and "inbox_v2_data_governance_export_artifacts"."deleted_at" is null and "inbox_v2_data_governance_export_artifacts"."ready_at" >= "inbox_v2_data_governance_export_artifacts"."recorded_at" and "inbox_v2_data_governance_export_artifacts"."expires_at" > "inbox_v2_data_governance_export_artifacts"."ready_at" and "inbox_v2_data_governance_export_artifacts"."expires_at" <= "inbox_v2_data_governance_export_artifacts"."ready_at" + interval '24 hours') or ("inbox_v2_data_governance_export_artifacts"."state" = 'quarantined' and "inbox_v2_data_governance_export_artifacts"."manifest_id" is null and "inbox_v2_data_governance_export_artifacts"."manifest_revision" is null and "inbox_v2_data_governance_export_artifacts"."manifest_hash" is null and "inbox_v2_data_governance_export_artifacts"."payload_checksum" is null and "inbox_v2_data_governance_export_artifacts"."packaging_proof_hash" is null and "inbox_v2_data_governance_export_artifacts"."archive_composition_hash" is null and "inbox_v2_data_governance_export_artifacts"."ready_at" is null and "inbox_v2_data_governance_export_artifacts"."expires_at" is null and "inbox_v2_data_governance_export_artifacts"."deleted_at" is null) or ("inbox_v2_data_governance_export_artifacts"."state" = 'deleted' and "inbox_v2_data_governance_export_artifacts"."manifest_id" is null and "inbox_v2_data_governance_export_artifacts"."manifest_revision" is null and "inbox_v2_data_governance_export_artifacts"."manifest_hash" is null and "inbox_v2_data_governance_export_artifacts"."payload_checksum" is null and "inbox_v2_data_governance_export_artifacts"."payload_locator" is null and "inbox_v2_data_governance_export_artifacts"."packaging_proof_hash" is null and "inbox_v2_data_governance_export_artifacts"."archive_composition_hash" is null and "inbox_v2_data_governance_export_artifacts"."ready_at" is null and "inbox_v2_data_governance_export_artifacts"."expires_at" is null and "inbox_v2_data_governance_export_artifacts"."deleted_at" is not null and "inbox_v2_data_governance_export_artifacts"."deleted_at" >= "inbox_v2_data_governance_export_artifacts"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_claims" (
	"tenant_id" text NOT NULL,
	"artifact_claim_key" text NOT NULL,
	"receipt_key" text NOT NULL,
	"principal_key" text NOT NULL,
	"claim_revision" bigint NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"packaging_proof_hash" text NOT NULL,
	"archive_composition_hash" text NOT NULL,
	"issued_receipt_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_claims_pk" PRIMARY KEY("tenant_id","artifact_claim_key"),
	CONSTRAINT "inbox_v2_dg_export_claim_values_check" CHECK ("inbox_v2_data_governance_export_claims"."claim_revision" >= 1 and "inbox_v2_data_governance_export_claims"."job_revision" >= 1 and "inbox_v2_data_governance_export_claims"."manifest_revision" >= 1 and "inbox_v2_data_governance_export_claims"."packaging_proof_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_claims"."archive_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_claims"."issued_receipt_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_export_claims"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_jobs" (
	"tenant_id" text NOT NULL,
	"job_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"state_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_export_job_state" NOT NULL,
	"product_kind" "inbox_v2_data_governance_export_product_kind" NOT NULL,
	"product_authority_id" text NOT NULL,
	"product_authority_revision" bigint NOT NULL,
	"product_authority_hash" text NOT NULL,
	"request_id" text,
	"request_revision" bigint,
	"scope_manifest_id" text,
	"scope_manifest_revision" bigint,
	"governance_context_id" text,
	"governance_context_version" bigint,
	"governance_context_hash" text,
	"policy_id" text,
	"policy_version" bigint,
	"policy_hash" text,
	"activation_id" text,
	"activation_revision" bigint,
	"activation_hash" text,
	"export_manifest_id" text,
	"export_manifest_revision" bigint,
	"export_artifact_id" text,
	"export_artifact_revision" bigint,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"export_handler_id" text NOT NULL,
	"principal_key" text NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_jobs_pk" PRIMARY KEY("tenant_id","job_id","revision"),
	CONSTRAINT "inbox_v2_dg_export_job_values_check" CHECK ("inbox_v2_data_governance_export_jobs"."revision" >= 1 and "inbox_v2_data_governance_export_jobs"."state_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."product_authority_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."product_authority_hash" ~ '^sha256:[0-9a-f]{64}$' and ("inbox_v2_data_governance_export_jobs"."governance_context_hash" is null or "inbox_v2_data_governance_export_jobs"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$') and ("inbox_v2_data_governance_export_jobs"."policy_hash" is null or "inbox_v2_data_governance_export_jobs"."policy_hash" ~ '^sha256:[0-9a-f]{64}$') and ("inbox_v2_data_governance_export_jobs"."activation_hash" is null or "inbox_v2_data_governance_export_jobs"."activation_hash" ~ '^sha256:[0-9a-f]{64}$') and isfinite("inbox_v2_data_governance_export_jobs"."created_at") and isfinite("inbox_v2_data_governance_export_jobs"."updated_at") and "inbox_v2_data_governance_export_jobs"."updated_at" >= "inbox_v2_data_governance_export_jobs"."created_at"),
	CONSTRAINT "inbox_v2_dg_export_job_product_check" CHECK (("inbox_v2_data_governance_export_jobs"."product_kind" = 'tenant_deployment' and "inbox_v2_data_governance_export_jobs"."request_id" is null and "inbox_v2_data_governance_export_jobs"."request_revision" is null and "inbox_v2_data_governance_export_jobs"."scope_manifest_id" is not null and "inbox_v2_data_governance_export_jobs"."scope_manifest_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."governance_context_id" is not null and "inbox_v2_data_governance_export_jobs"."governance_context_version" >= 1 and "inbox_v2_data_governance_export_jobs"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_jobs"."policy_id" is not null and "inbox_v2_data_governance_export_jobs"."policy_version" >= 1 and "inbox_v2_data_governance_export_jobs"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_jobs"."activation_id" is not null and "inbox_v2_data_governance_export_jobs"."activation_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."activation_hash" ~ '^sha256:[0-9a-f]{64}$') or ("inbox_v2_data_governance_export_jobs"."product_kind" = 'data_subject' and "inbox_v2_data_governance_export_jobs"."request_id" is not null and "inbox_v2_data_governance_export_jobs"."request_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."scope_manifest_id" is not null and "inbox_v2_data_governance_export_jobs"."scope_manifest_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."governance_context_id" is null and "inbox_v2_data_governance_export_jobs"."governance_context_version" is null and "inbox_v2_data_governance_export_jobs"."governance_context_hash" is null and "inbox_v2_data_governance_export_jobs"."policy_id" is null and "inbox_v2_data_governance_export_jobs"."policy_version" is null and "inbox_v2_data_governance_export_jobs"."policy_hash" is null and "inbox_v2_data_governance_export_jobs"."activation_id" is null and "inbox_v2_data_governance_export_jobs"."activation_revision" is null and "inbox_v2_data_governance_export_jobs"."activation_hash" is null) or ("inbox_v2_data_governance_export_jobs"."product_kind" = 'manager_report' and "inbox_v2_data_governance_export_jobs"."request_id" is null and "inbox_v2_data_governance_export_jobs"."request_revision" is null and "inbox_v2_data_governance_export_jobs"."scope_manifest_id" is null and "inbox_v2_data_governance_export_jobs"."scope_manifest_revision" is null and "inbox_v2_data_governance_export_jobs"."governance_context_id" is null and "inbox_v2_data_governance_export_jobs"."governance_context_version" is null and "inbox_v2_data_governance_export_jobs"."governance_context_hash" is null and "inbox_v2_data_governance_export_jobs"."policy_id" is null and "inbox_v2_data_governance_export_jobs"."policy_version" is null and "inbox_v2_data_governance_export_jobs"."policy_hash" is null and "inbox_v2_data_governance_export_jobs"."activation_id" is null and "inbox_v2_data_governance_export_jobs"."activation_revision" is null and "inbox_v2_data_governance_export_jobs"."activation_hash" is null)),
	CONSTRAINT "inbox_v2_dg_export_job_manifest_state_check" CHECK (("inbox_v2_data_governance_export_jobs"."state" = 'queued' and "inbox_v2_data_governance_export_jobs"."export_manifest_id" is null and "inbox_v2_data_governance_export_jobs"."export_manifest_revision" is null and "inbox_v2_data_governance_export_jobs"."export_artifact_id" is null and "inbox_v2_data_governance_export_jobs"."export_artifact_revision" is null) or ("inbox_v2_data_governance_export_jobs"."state" = 'running' and "inbox_v2_data_governance_export_jobs"."export_manifest_id" is null and "inbox_v2_data_governance_export_jobs"."export_manifest_revision" is null and "inbox_v2_data_governance_export_jobs"."export_artifact_id" is not null and "inbox_v2_data_governance_export_jobs"."export_artifact_revision" >= 1) or ("inbox_v2_data_governance_export_jobs"."state" in ('ready', 'completed') and "inbox_v2_data_governance_export_jobs"."export_manifest_id" is not null and "inbox_v2_data_governance_export_jobs"."export_manifest_revision" >= 1 and "inbox_v2_data_governance_export_jobs"."export_artifact_id" is not null and "inbox_v2_data_governance_export_jobs"."export_artifact_revision" >= 1) or ("inbox_v2_data_governance_export_jobs"."state" in ('revoked', 'expired', 'failed_retryable') and "inbox_v2_data_governance_export_jobs"."export_artifact_id" is not null and "inbox_v2_data_governance_export_jobs"."export_artifact_revision" >= 1 and (("inbox_v2_data_governance_export_jobs"."export_manifest_id" is null and "inbox_v2_data_governance_export_jobs"."export_manifest_revision" is null) or ("inbox_v2_data_governance_export_jobs"."export_manifest_id" is not null and "inbox_v2_data_governance_export_jobs"."export_manifest_revision" >= 1))))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_manifests" (
	"tenant_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"manifest_hash" text NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"scope_manifest_id" text,
	"scope_manifest_revision" bigint,
	"scope_proof_hash" text NOT NULL,
	"root_set_hash" text NOT NULL,
	"boundary" "inbox_v2_data_governance_root_boundary" NOT NULL,
	"stream_epoch" text NOT NULL,
	"sync_generation" bigint NOT NULL,
	"complete_through_position" bigint NOT NULL,
	"root_count" bigint NOT NULL,
	"record_count" bigint NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_manifests_pk" PRIMARY KEY("tenant_id","manifest_id","revision"),
	CONSTRAINT "inbox_v2_dg_export_manifest_values_check" CHECK ("inbox_v2_data_governance_export_manifests"."revision" >= 1 and "inbox_v2_data_governance_export_manifests"."job_revision" >= 1 and "inbox_v2_data_governance_export_manifests"."sync_generation" >= 1 and "inbox_v2_data_governance_export_manifests"."complete_through_position" >= 0 and "inbox_v2_data_governance_export_manifests"."root_count" >= 0 and "inbox_v2_data_governance_export_manifests"."record_count" >= 0 and "inbox_v2_data_governance_export_manifests"."manifest_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_manifests"."scope_proof_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_manifests"."root_set_hash" ~ '^sha256:[0-9a-f]{64}$' and (("inbox_v2_data_governance_export_manifests"."scope_manifest_id" is null and "inbox_v2_data_governance_export_manifests"."scope_manifest_revision" is null) or ("inbox_v2_data_governance_export_manifests"."scope_manifest_id" is not null and "inbox_v2_data_governance_export_manifests"."scope_manifest_revision" >= 1)) and isfinite("inbox_v2_data_governance_export_manifests"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_export_receipt_cas" (
	"tenant_id" text NOT NULL,
	"artifact_claim_key" text NOT NULL,
	"receipt_key" text NOT NULL,
	"principal_key" text NOT NULL,
	"claim_revision" bigint NOT NULL,
	"job_id" text NOT NULL,
	"job_revision" bigint NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"packaging_proof_hash" text NOT NULL,
	"archive_composition_hash" text NOT NULL,
	"issued_receipt_hash" text NOT NULL,
	"state" "inbox_v2_data_governance_export_receipt_state" NOT NULL,
	"revision" bigint NOT NULL,
	"consumed_at" timestamp (3) with time zone,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_export_receipt_cas_pk" PRIMARY KEY("tenant_id","receipt_key"),
	CONSTRAINT "inbox_v2_dg_export_receipt_values_check" CHECK ("inbox_v2_data_governance_export_receipt_cas"."claim_revision" >= 1 and "inbox_v2_data_governance_export_receipt_cas"."job_revision" >= 1 and "inbox_v2_data_governance_export_receipt_cas"."manifest_revision" >= 1 and "inbox_v2_data_governance_export_receipt_cas"."revision" >= 1 and "inbox_v2_data_governance_export_receipt_cas"."packaging_proof_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_receipt_cas"."archive_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_export_receipt_cas"."issued_receipt_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_export_receipt_cas"."created_at") and isfinite("inbox_v2_data_governance_export_receipt_cas"."updated_at") and "inbox_v2_data_governance_export_receipt_cas"."updated_at" >= "inbox_v2_data_governance_export_receipt_cas"."created_at"),
	CONSTRAINT "inbox_v2_dg_export_receipt_state_check" CHECK (("inbox_v2_data_governance_export_receipt_cas"."state" = 'consumed' and "inbox_v2_data_governance_export_receipt_cas"."consumed_at" is not null and "inbox_v2_data_governance_export_receipt_cas"."consumed_at" >= "inbox_v2_data_governance_export_receipt_cas"."created_at") or ("inbox_v2_data_governance_export_receipt_cas"."state" in ('issued', 'revoked', 'expired') and "inbox_v2_data_governance_export_receipt_cas"."consumed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_external_checkpoint_attempts" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"attempt" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"external_delete_handler_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"external_request_id" text NOT NULL,
	"outcome" "inbox_v2_data_governance_external_outcome" NOT NULL,
	"evidence_hash" text NOT NULL,
	"execution_fence_hash" text NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_external_attempts_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id","attempt"),
	CONSTRAINT "inbox_v2_dg_external_attempt_values_check" CHECK ("inbox_v2_data_governance_external_checkpoint_attempts"."run_revision" >= 1 and "inbox_v2_data_governance_external_checkpoint_attempts"."plan_revision" >= 1 and "inbox_v2_data_governance_external_checkpoint_attempts"."attempt" >= 1 and "inbox_v2_data_governance_external_checkpoint_attempts"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_external_checkpoint_attempts"."expected_lineage_revision" >= 1 and "inbox_v2_data_governance_external_checkpoint_attempts"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_external_checkpoint_attempts"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_external_checkpoint_attempts"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_external_checkpoint_attempts"."evidence_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_external_checkpoint_attempts"."execution_fence_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_external_attempt_time_check" CHECK (isfinite("inbox_v2_data_governance_external_checkpoint_attempts"."started_at") and isfinite("inbox_v2_data_governance_external_checkpoint_attempts"."completed_at") and isfinite("inbox_v2_data_governance_external_checkpoint_attempts"."lease_expires_at") and "inbox_v2_data_governance_external_checkpoint_attempts"."completed_at" >= "inbox_v2_data_governance_external_checkpoint_attempts"."started_at" and "inbox_v2_data_governance_external_checkpoint_attempts"."lease_expires_at" > "inbox_v2_data_governance_external_checkpoint_attempts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_external_checkpoint_heads" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"current_attempt" bigint NOT NULL,
	"current_outcome" "inbox_v2_data_governance_external_outcome" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_external_heads_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_external_head_values_check" CHECK ("inbox_v2_data_governance_external_checkpoint_heads"."run_revision" >= 1 and "inbox_v2_data_governance_external_checkpoint_heads"."current_attempt" >= 1 and "inbox_v2_data_governance_external_checkpoint_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_external_checkpoint_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_legal_hold_data_classes" (
	"tenant_id" text NOT NULL,
	"hold_id" text NOT NULL,
	"hold_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	CONSTRAINT "inbox_v2_dg_hold_data_classes_pk" PRIMARY KEY("tenant_id","hold_id","hold_revision","data_class_id"),
	CONSTRAINT "inbox_v2_dg_hold_data_class_values_check" CHECK ("inbox_v2_data_governance_legal_hold_data_classes"."hold_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_legal_hold_heads" (
	"tenant_id" text NOT NULL,
	"hold_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_control_state" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_legal_hold_heads_pk" PRIMARY KEY("tenant_id","hold_id"),
	CONSTRAINT "inbox_v2_dg_legal_hold_head_values_check" CHECK ("inbox_v2_data_governance_legal_hold_heads"."current_revision" >= 1 and "inbox_v2_data_governance_legal_hold_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_legal_hold_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_legal_hold_revisions" (
	"tenant_id" text NOT NULL,
	"hold_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_control_state" NOT NULL,
	"scope_kind" "inbox_v2_data_governance_scope_kind" NOT NULL,
	"scope_manifest_id" text NOT NULL,
	"scope_manifest_revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"case_id" text NOT NULL,
	"matcher_handler_id" text,
	"matcher_version" bigint,
	"predicate_hash" text,
	"owner_employee_id" text NOT NULL,
	"approver_employee_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"legal_reference_code" text NOT NULL,
	"anchor_from" timestamp (3) with time zone NOT NULL,
	"anchor_through" timestamp (3) with time zone,
	"end_condition_id" text NOT NULL,
	"end_condition_hash" text NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"review_at" timestamp (3) with time zone NOT NULL,
	"released_at" timestamp (3) with time zone,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_legal_hold_revisions_pk" PRIMARY KEY("tenant_id","hold_id","revision"),
	CONSTRAINT "inbox_v2_dg_legal_hold_values_check" CHECK ("inbox_v2_data_governance_legal_hold_revisions"."revision" >= 1 and "inbox_v2_data_governance_legal_hold_revisions"."owner_employee_id" <> "inbox_v2_data_governance_legal_hold_revisions"."approver_employee_id" and "inbox_v2_data_governance_legal_hold_revisions"."end_condition_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_legal_hold_revisions"."anchor_from") and ("inbox_v2_data_governance_legal_hold_revisions"."anchor_through" is null or (isfinite("inbox_v2_data_governance_legal_hold_revisions"."anchor_through") and "inbox_v2_data_governance_legal_hold_revisions"."anchor_through" >= "inbox_v2_data_governance_legal_hold_revisions"."anchor_from")) and isfinite("inbox_v2_data_governance_legal_hold_revisions"."effective_at") and isfinite("inbox_v2_data_governance_legal_hold_revisions"."review_at") and "inbox_v2_data_governance_legal_hold_revisions"."review_at" > "inbox_v2_data_governance_legal_hold_revisions"."effective_at"),
	CONSTRAINT "inbox_v2_dg_legal_hold_state_check" CHECK (("inbox_v2_data_governance_legal_hold_revisions"."state" = 'active' and "inbox_v2_data_governance_legal_hold_revisions"."released_at" is null) or ("inbox_v2_data_governance_legal_hold_revisions"."state" = 'released' and "inbox_v2_data_governance_legal_hold_revisions"."released_at" is not null and "inbox_v2_data_governance_legal_hold_revisions"."released_at" >= "inbox_v2_data_governance_legal_hold_revisions"."effective_at")),
	CONSTRAINT "inbox_v2_dg_legal_hold_scope_check" CHECK ((
      "inbox_v2_data_governance_legal_hold_revisions"."scope_kind" = 'prospective' and "inbox_v2_data_governance_legal_hold_revisions"."matcher_handler_id" is not null and "inbox_v2_data_governance_legal_hold_revisions"."matcher_version" >= 1 and "inbox_v2_data_governance_legal_hold_revisions"."predicate_hash" ~ '^sha256:[0-9a-f]{64}$'
    ) or (
      "inbox_v2_data_governance_legal_hold_revisions"."scope_kind" = 'exact' and "inbox_v2_data_governance_legal_hold_revisions"."matcher_handler_id" is null and "inbox_v2_data_governance_legal_hold_revisions"."matcher_version" is null and "inbox_v2_data_governance_legal_hold_revisions"."predicate_hash" is null
    ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_legal_hold_targets" (
	"tenant_id" text NOT NULL,
	"hold_id" text NOT NULL,
	"hold_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_control_state" NOT NULL,
	"scope_manifest_id" text NOT NULL,
	"scope_manifest_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	CONSTRAINT "inbox_v2_dg_legal_hold_targets_pk" PRIMARY KEY("tenant_id","hold_id","hold_revision","storage_root_id","root_record_id"),
	CONSTRAINT "inbox_v2_dg_hold_target_values_check" CHECK ("inbox_v2_data_governance_legal_hold_targets"."hold_revision" >= 1 and "inbox_v2_data_governance_legal_hold_targets"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_legal_hold_targets"."expected_lineage_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_lifecycle_handlers" (
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"handler_id" text NOT NULL,
	"kind" "inbox_v2_data_governance_handler_kind" NOT NULL,
	"owner_module_id" text,
	"handler_version" bigint NOT NULL,
	"bounded" boolean NOT NULL,
	"idempotent" boolean NOT NULL,
	"checks_tenant_fence" boolean NOT NULL,
	"checks_revision_fence" boolean NOT NULL,
	"checks_hold_fence" boolean NOT NULL,
	"verifies_absence" boolean NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_handlers_pk" PRIMARY KEY("registry_id","registry_revision","handler_id"),
	CONSTRAINT "inbox_v2_dg_handlers_values_check" CHECK ("inbox_v2_data_governance_lifecycle_handlers"."handler_version" >= 1 and "inbox_v2_data_governance_lifecycle_handlers"."bounded" and "inbox_v2_data_governance_lifecycle_handlers"."idempotent" and "inbox_v2_data_governance_lifecycle_handlers"."checks_tenant_fence" and "inbox_v2_data_governance_lifecycle_handlers"."checks_revision_fence"),
	CONSTRAINT "inbox_v2_dg_handlers_verify_check" CHECK ("inbox_v2_data_governance_lifecycle_handlers"."kind" <> 'verification' or "inbox_v2_data_governance_lifecycle_handlers"."verifies_absence")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_lifecycle_purpose_instances" (
	"tenant_id" text NOT NULL,
	"purpose_set_id" text NOT NULL,
	"purpose_set_revision" bigint NOT NULL,
	"purpose_id" text NOT NULL,
	"rule_id" text NOT NULL,
	"rule_revision" bigint NOT NULL,
	"anchor_at" timestamp (3) with time zone NOT NULL,
	"condition_state" text,
	"condition_id" text,
	"condition_version" bigint,
	"condition_resolver_handler_id" text,
	"condition_evidence_hash" text,
	"parent_deadline_snapshot_hash" text,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_purpose_instances_pk" PRIMARY KEY("tenant_id","purpose_set_id","purpose_set_revision","purpose_id","rule_id","rule_revision"),
	CONSTRAINT "inbox_v2_dg_purpose_instance_values_check" CHECK ("inbox_v2_data_governance_lifecycle_purpose_instances"."rule_revision" >= 1 and isfinite("inbox_v2_data_governance_lifecycle_purpose_instances"."anchor_at") and (
      ("inbox_v2_data_governance_lifecycle_purpose_instances"."condition_state" is null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_id" is null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_version" is null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_resolver_handler_id" is null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_evidence_hash" is null)
      or ("inbox_v2_data_governance_lifecycle_purpose_instances"."condition_state" in ('resolved', 'unresolved') and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_id" is not null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_version" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_resolver_handler_id" is not null and "inbox_v2_data_governance_lifecycle_purpose_instances"."condition_evidence_hash" ~ '^sha256:[0-9a-f]{64}$')
    ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_lifecycle_purpose_sets" (
	"tenant_id" text NOT NULL,
	"purpose_set_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_revision" bigint NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"stream_epoch" text NOT NULL,
	"sync_generation" bigint NOT NULL,
	"complete_through_position" bigint NOT NULL,
	"purpose_set_revision" bigint NOT NULL,
	"source_state_hash" text NOT NULL,
	"captured_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_purpose_sets_pk" PRIMARY KEY("tenant_id","purpose_set_id","revision"),
	CONSTRAINT "inbox_v2_dg_purpose_set_values_check" CHECK ("inbox_v2_data_governance_lifecycle_purpose_sets"."revision" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."policy_version" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."entity_revision" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."lineage_revision" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."sync_generation" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."complete_through_position" >= 0 and "inbox_v2_data_governance_lifecycle_purpose_sets"."purpose_set_revision" >= 1 and "inbox_v2_data_governance_lifecycle_purpose_sets"."source_state_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_lifecycle_purpose_sets"."captured_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"plan_id" text NOT NULL,
	"plan_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"requirement_hash" text NOT NULL,
	"attempt" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"delete_handler_id" text NOT NULL,
	"verification_handler_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"outcome" "inbox_v2_data_governance_operated_outcome" NOT NULL,
	"absence_verified" boolean NOT NULL,
	"evidence_hash" text,
	"error_code" text,
	"execution_fence_hash" text NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_operated_attempts_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id","attempt"),
	CONSTRAINT "inbox_v2_dg_operated_attempt_values_check" CHECK ("inbox_v2_data_governance_operated_checkpoint_attempts"."run_revision" >= 1 and "inbox_v2_data_governance_operated_checkpoint_attempts"."plan_revision" >= 1 and "inbox_v2_data_governance_operated_checkpoint_attempts"."attempt" >= 1 and "inbox_v2_data_governance_operated_checkpoint_attempts"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_operated_checkpoint_attempts"."expected_lineage_revision" >= 1 and "inbox_v2_data_governance_operated_checkpoint_attempts"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_operated_checkpoint_attempts"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_operated_checkpoint_attempts"."requirement_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_operated_checkpoint_attempts"."execution_fence_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_operated_attempt_outcome_check" CHECK (("inbox_v2_data_governance_operated_checkpoint_attempts"."outcome" = 'verified_absent' and "inbox_v2_data_governance_operated_checkpoint_attempts"."absence_verified" and "inbox_v2_data_governance_operated_checkpoint_attempts"."evidence_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_operated_checkpoint_attempts"."error_code" is null) or ("inbox_v2_data_governance_operated_checkpoint_attempts"."outcome" <> 'verified_absent' and not "inbox_v2_data_governance_operated_checkpoint_attempts"."absence_verified" and "inbox_v2_data_governance_operated_checkpoint_attempts"."evidence_hash" is null and "inbox_v2_data_governance_operated_checkpoint_attempts"."error_code" is not null)),
	CONSTRAINT "inbox_v2_dg_operated_attempt_time_check" CHECK (isfinite("inbox_v2_data_governance_operated_checkpoint_attempts"."started_at") and isfinite("inbox_v2_data_governance_operated_checkpoint_attempts"."completed_at") and isfinite("inbox_v2_data_governance_operated_checkpoint_attempts"."lease_expires_at") and "inbox_v2_data_governance_operated_checkpoint_attempts"."completed_at" >= "inbox_v2_data_governance_operated_checkpoint_attempts"."started_at" and "inbox_v2_data_governance_operated_checkpoint_attempts"."lease_expires_at" > "inbox_v2_data_governance_operated_checkpoint_attempts"."started_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_operated_checkpoint_heads" (
	"tenant_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_revision" bigint NOT NULL,
	"checkpoint_id" text NOT NULL,
	"current_attempt" bigint NOT NULL,
	"current_outcome" "inbox_v2_data_governance_operated_outcome" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_operated_heads_pk" PRIMARY KEY("tenant_id","run_id","run_revision","checkpoint_id"),
	CONSTRAINT "inbox_v2_dg_operated_head_values_check" CHECK ("inbox_v2_data_governance_operated_checkpoint_heads"."run_revision" >= 1 and "inbox_v2_data_governance_operated_checkpoint_heads"."current_attempt" >= 1 and "inbox_v2_data_governance_operated_checkpoint_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_operated_checkpoint_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_policy_activation_heads" (
	"tenant_id" text NOT NULL,
	"policy_id" text NOT NULL,
	"current_policy_version" bigint NOT NULL,
	"current_activation_id" text NOT NULL,
	"current_activation_revision" bigint NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_policy_activation_heads_pk" PRIMARY KEY("tenant_id","policy_id"),
	CONSTRAINT "inbox_v2_dg_activation_head_values_check" CHECK ("inbox_v2_data_governance_policy_activation_heads"."current_policy_version" >= 1 and "inbox_v2_data_governance_policy_activation_heads"."current_activation_revision" >= 1 and "inbox_v2_data_governance_policy_activation_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_policy_activation_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_policy_activations" (
	"tenant_id" text NOT NULL,
	"activation_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"activation_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"candidate_policy_hash" text NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"transition_kind" "inbox_v2_data_governance_policy_activation_kind" NOT NULL,
	"prior_activation_id" text,
	"prior_activation_revision" bigint,
	"prior_policy_version" bigint,
	"requester_principal_kind" "inbox_v2_data_governance_approval_principal_kind" NOT NULL,
	"requester_principal_key" text NOT NULL,
	"requester_decision_id" text NOT NULL,
	"requester_decision_hash" text NOT NULL,
	"approver_principal_kind" "inbox_v2_data_governance_approval_principal_kind" NOT NULL,
	"approver_principal_key" text NOT NULL,
	"approver_decision_id" text NOT NULL,
	"approver_decision_hash" text NOT NULL,
	"reason_code" text NOT NULL,
	"impact_preview_hash" text NOT NULL,
	"impact_stream_epoch" text NOT NULL,
	"impact_sync_generation" bigint NOT NULL,
	"impact_complete_through_position" bigint NOT NULL,
	"affected_root_count" bigint NOT NULL,
	"affected_byte_count" bigint NOT NULL,
	"held_root_count" bigint NOT NULL,
	"backup_copy_count" bigint NOT NULL,
	"earliest_destructive_at" timestamp (3) with time zone,
	"requested_at" timestamp (3) with time zone NOT NULL,
	"approved_at" timestamp (3) with time zone NOT NULL,
	"not_before" timestamp (3) with time zone NOT NULL,
	"activated_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_policy_activations_pk" PRIMARY KEY("tenant_id","activation_id","revision"),
	CONSTRAINT "inbox_v2_dg_activation_values_check" CHECK ("inbox_v2_data_governance_policy_activations"."revision" >= 1 and "inbox_v2_data_governance_policy_activations"."policy_version" >= 1 and "inbox_v2_data_governance_policy_activations"."governance_context_version" >= 1 and "inbox_v2_data_governance_policy_activations"."activation_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."candidate_policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."requester_decision_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."approver_decision_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."impact_preview_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_policy_activations"."impact_sync_generation" >= 1 and "inbox_v2_data_governance_policy_activations"."impact_complete_through_position" >= 0 and "inbox_v2_data_governance_policy_activations"."affected_root_count" >= 0 and "inbox_v2_data_governance_policy_activations"."affected_byte_count" >= 0 and "inbox_v2_data_governance_policy_activations"."held_root_count" >= 0 and "inbox_v2_data_governance_policy_activations"."backup_copy_count" >= 0),
	CONSTRAINT "inbox_v2_dg_activation_separation_check" CHECK (("inbox_v2_data_governance_policy_activations"."requester_principal_kind", "inbox_v2_data_governance_policy_activations"."requester_principal_key") <> ("inbox_v2_data_governance_policy_activations"."approver_principal_kind", "inbox_v2_data_governance_policy_activations"."approver_principal_key")),
	CONSTRAINT "inbox_v2_dg_activation_transition_check" CHECK ((
        "inbox_v2_data_governance_policy_activations"."transition_kind" = 'initial_reviewed_bootstrap'
        and "inbox_v2_data_governance_policy_activations"."prior_activation_id" is null
        and "inbox_v2_data_governance_policy_activations"."prior_activation_revision" is null
        and "inbox_v2_data_governance_policy_activations"."prior_policy_version" is null
      ) or (
        "inbox_v2_data_governance_policy_activations"."transition_kind" = 'supersede_current'
        and "inbox_v2_data_governance_policy_activations"."prior_activation_id" is not null
        and "inbox_v2_data_governance_policy_activations"."prior_activation_revision" >= 1
        and "inbox_v2_data_governance_policy_activations"."prior_policy_version" >= 1
      )),
	CONSTRAINT "inbox_v2_dg_activation_time_check" CHECK (isfinite("inbox_v2_data_governance_policy_activations"."requested_at") and isfinite("inbox_v2_data_governance_policy_activations"."approved_at") and isfinite("inbox_v2_data_governance_policy_activations"."not_before") and isfinite("inbox_v2_data_governance_policy_activations"."activated_at") and "inbox_v2_data_governance_policy_activations"."approved_at" > "inbox_v2_data_governance_policy_activations"."requested_at" and "inbox_v2_data_governance_policy_activations"."not_before" > "inbox_v2_data_governance_policy_activations"."approved_at" and "inbox_v2_data_governance_policy_activations"."activated_at" >= "inbox_v2_data_governance_policy_activations"."not_before")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_policy_template_rules" (
	"template_id" text NOT NULL,
	"template_revision" bigint NOT NULL,
	"rule_id" text NOT NULL,
	"rule_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"retention_anchor_id" text NOT NULL,
	"action_at_expiry" text NOT NULL,
	"hold_eligible" boolean NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_template_rules_pk" PRIMARY KEY("template_id","template_revision","rule_id","rule_revision"),
	CONSTRAINT "inbox_v2_dg_template_rules_values_check" CHECK ("inbox_v2_data_governance_policy_template_rules"."template_revision" >= 1 and "inbox_v2_data_governance_policy_template_rules"."rule_revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_policy_templates" (
	"template_id" text NOT NULL,
	"template_revision" bigint NOT NULL,
	"template_hash" text NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"deployment_profile" "inbox_v2_data_governance_deployment_profile" NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"review_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_policy_templates_pk" PRIMARY KEY("template_id","template_revision"),
	CONSTRAINT "inbox_v2_dg_templates_values_check" CHECK ("inbox_v2_data_governance_policy_templates"."template_revision" >= 1 and "inbox_v2_data_governance_policy_templates"."template_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_policy_templates"."effective_at") and isfinite("inbox_v2_data_governance_policy_templates"."review_at") and "inbox_v2_data_governance_policy_templates"."review_at" > "inbox_v2_data_governance_policy_templates"."effective_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_privacy_request_aliases" (
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"request_revision" bigint NOT NULL,
	"subject_kind" "inbox_v2_data_governance_subject_kind" NOT NULL,
	"subject_reference_key" text NOT NULL,
	"provider_scope_key" text,
	"normalized_external_subject_digest" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_privacy_request_aliases_pk" PRIMARY KEY("tenant_id","request_id","request_revision","subject_kind","subject_reference_key"),
	CONSTRAINT "inbox_v2_dg_privacy_alias_values_check" CHECK ("inbox_v2_data_governance_privacy_request_aliases"."request_revision" >= 1 and length("inbox_v2_data_governance_privacy_request_aliases"."subject_reference_key") between 3 and 160 and "inbox_v2_data_governance_privacy_request_aliases"."subject_reference_key" ~ '^[a-z][a-z0-9_]*:[A-Za-z0-9_-]+$' and "inbox_v2_data_governance_privacy_request_aliases"."subject_reference_key" !~ '[[:cntrl:]@+[:space:]]' and isfinite("inbox_v2_data_governance_privacy_request_aliases"."created_at")),
	CONSTRAINT "inbox_v2_dg_privacy_alias_provider_check" CHECK (("inbox_v2_data_governance_privacy_request_aliases"."subject_kind" = 'unresolved_provider_subject' and "inbox_v2_data_governance_privacy_request_aliases"."provider_scope_key" is not null and length("inbox_v2_data_governance_privacy_request_aliases"."provider_scope_key") between 3 and 160 and "inbox_v2_data_governance_privacy_request_aliases"."provider_scope_key" !~ '[[:cntrl:]@+[:space:]]' and "inbox_v2_data_governance_privacy_request_aliases"."normalized_external_subject_digest" ~ '^sha256:[0-9a-f]{64}$') or ("inbox_v2_data_governance_privacy_request_aliases"."subject_kind" <> 'unresolved_provider_subject' and "inbox_v2_data_governance_privacy_request_aliases"."provider_scope_key" is null and "inbox_v2_data_governance_privacy_request_aliases"."normalized_external_subject_digest" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_privacy_request_heads" (
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"current_state" "inbox_v2_data_governance_privacy_request_state" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_privacy_request_heads_pk" PRIMARY KEY("tenant_id","request_id"),
	CONSTRAINT "inbox_v2_dg_privacy_head_values_check" CHECK ("inbox_v2_data_governance_privacy_request_heads"."current_revision" >= 1 and "inbox_v2_data_governance_privacy_request_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_privacy_request_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_privacy_request_revisions" (
	"tenant_id" text NOT NULL,
	"request_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"intent" "inbox_v2_data_governance_privacy_request_intent" NOT NULL,
	"state" "inbox_v2_data_governance_privacy_request_state" NOT NULL,
	"subject_kind" "inbox_v2_data_governance_subject_kind" NOT NULL,
	"subject_key" text NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"scope_manifest_id" text,
	"scope_manifest_revision" bigint,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"decision_hash" text NOT NULL,
	"reason_code" text NOT NULL,
	"due_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"canonical_snapshot" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_privacy_requests_pk" PRIMARY KEY("tenant_id","request_id","revision"),
	CONSTRAINT "inbox_v2_dg_privacy_request_values_check" CHECK ("inbox_v2_data_governance_privacy_request_revisions"."revision" >= 1 and "inbox_v2_data_governance_privacy_request_revisions"."governance_context_version" >= 1 and "inbox_v2_data_governance_privacy_request_revisions"."policy_version" >= 1 and "inbox_v2_data_governance_privacy_request_revisions"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_privacy_request_revisions"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_privacy_request_revisions"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_privacy_request_revisions"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_privacy_request_revisions"."decision_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_privacy_request_manifest_check" CHECK (("inbox_v2_data_governance_privacy_request_revisions"."scope_manifest_id" is null and "inbox_v2_data_governance_privacy_request_revisions"."scope_manifest_revision" is null) or ("inbox_v2_data_governance_privacy_request_revisions"."scope_manifest_id" is not null and "inbox_v2_data_governance_privacy_request_revisions"."scope_manifest_revision" >= 1)),
	CONSTRAINT "inbox_v2_dg_privacy_request_time_check" CHECK (isfinite("inbox_v2_data_governance_privacy_request_revisions"."created_at") and isfinite("inbox_v2_data_governance_privacy_request_revisions"."due_at") and "inbox_v2_data_governance_privacy_request_revisions"."due_at" > "inbox_v2_data_governance_privacy_request_revisions"."created_at" and ("inbox_v2_data_governance_privacy_request_revisions"."completed_at" is null or (isfinite("inbox_v2_data_governance_privacy_request_revisions"."completed_at") and "inbox_v2_data_governance_privacy_request_revisions"."completed_at" >= "inbox_v2_data_governance_privacy_request_revisions"."created_at")))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_registry_versions" (
	"id" text NOT NULL,
	"revision" bigint NOT NULL,
	"schema_version" text NOT NULL,
	"composition_hash" text NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	"activated_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_registry_versions_pk" PRIMARY KEY("id","revision"),
	CONSTRAINT "inbox_v2_dg_registry_hash_unique" UNIQUE("composition_hash"),
	CONSTRAINT "inbox_v2_dg_registry_values_check" CHECK ("inbox_v2_data_governance_registry_versions"."revision" >= 1 and "inbox_v2_data_governance_registry_versions"."composition_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_dg_registry_time_check" CHECK (isfinite("inbox_v2_data_governance_registry_versions"."activated_at") and isfinite("inbox_v2_data_governance_registry_versions"."created_at") and "inbox_v2_data_governance_registry_versions"."created_at" <= "inbox_v2_data_governance_registry_versions"."activated_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_restore_heads" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"restore_id" text NOT NULL,
	"state" "inbox_v2_data_governance_restore_head_state" NOT NULL,
	"head_revision" bigint NOT NULL,
	"source_erasure_entry_hash" text NOT NULL,
	"source_erasure_sequence" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"entity_revision" bigint NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"opened_entry_hash" text NOT NULL,
	"opened_sequence" bigint NOT NULL,
	"opened_stream_epoch" text NOT NULL,
	"opened_sync_generation" bigint NOT NULL,
	"opened_complete_through_position" bigint NOT NULL,
	"control_set_head_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"control_set_stream_position" bigint NOT NULL,
	"required_control_set_hash" text NOT NULL,
	"required_control_count" bigint NOT NULL,
	"sealed_entry_hash" text,
	"sealed_sequence" bigint,
	"opened_at" timestamp (3) with time zone NOT NULL,
	"sealed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_restore_heads_pk" PRIMARY KEY("tenant_id","ledger_id","restore_id"),
	CONSTRAINT "inbox_v2_dg_restore_head_values_check" CHECK ("inbox_v2_data_governance_restore_heads"."head_revision" >= 1 and "inbox_v2_data_governance_restore_heads"."source_erasure_sequence" >= 1 and "inbox_v2_data_governance_restore_heads"."opened_sequence" > "inbox_v2_data_governance_restore_heads"."source_erasure_sequence" and "inbox_v2_data_governance_restore_heads"."opened_sync_generation" >= 1 and "inbox_v2_data_governance_restore_heads"."opened_complete_through_position" >= 0 and "inbox_v2_data_governance_restore_heads"."control_set_head_revision" >= 1 and "inbox_v2_data_governance_restore_heads"."legal_hold_set_revision" >= 0 and "inbox_v2_data_governance_restore_heads"."restriction_set_revision" >= 0 and "inbox_v2_data_governance_restore_heads"."control_set_stream_position" >= 0 and "inbox_v2_data_governance_restore_heads"."required_control_count" between 0 and 10000 and "inbox_v2_data_governance_restore_heads"."source_erasure_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_restore_heads"."opened_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_restore_heads"."required_control_set_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_restore_heads"."opened_at") and isfinite("inbox_v2_data_governance_restore_heads"."updated_at")),
	CONSTRAINT "inbox_v2_dg_restore_head_state_check" CHECK (("inbox_v2_data_governance_restore_heads"."state" = 'open' and "inbox_v2_data_governance_restore_heads"."sealed_entry_hash" is null and "inbox_v2_data_governance_restore_heads"."sealed_sequence" is null and "inbox_v2_data_governance_restore_heads"."sealed_at" is null) or ("inbox_v2_data_governance_restore_heads"."state" = 'sealed' and "inbox_v2_data_governance_restore_heads"."sealed_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_restore_heads"."sealed_sequence" > "inbox_v2_data_governance_restore_heads"."opened_sequence" and "inbox_v2_data_governance_restore_heads"."sealed_at" is not null and isfinite("inbox_v2_data_governance_restore_heads"."sealed_at") and "inbox_v2_data_governance_restore_heads"."sealed_at" >= "inbox_v2_data_governance_restore_heads"."opened_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_restore_leases" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"restore_id" text NOT NULL,
	"lease_revision" bigint NOT NULL,
	"restore_head_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_restore_lease_state" NOT NULL,
	"lease_token_hash" text NOT NULL,
	"claimed_at" timestamp (3) with time zone NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_restore_leases_pk" PRIMARY KEY("tenant_id","ledger_id","restore_id"),
	CONSTRAINT "inbox_v2_dg_restore_lease_values_check" CHECK ("inbox_v2_data_governance_restore_leases"."lease_revision" >= 1 and "inbox_v2_data_governance_restore_leases"."restore_head_revision" >= 1 and "inbox_v2_data_governance_restore_leases"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_restore_leases"."claimed_at") and isfinite("inbox_v2_data_governance_restore_leases"."lease_expires_at") and "inbox_v2_data_governance_restore_leases"."lease_expires_at" > "inbox_v2_data_governance_restore_leases"."claimed_at" and isfinite("inbox_v2_data_governance_restore_leases"."updated_at")),
	CONSTRAINT "inbox_v2_dg_restore_lease_state_check" CHECK (("inbox_v2_data_governance_restore_leases"."state" = 'active' and "inbox_v2_data_governance_restore_leases"."completed_at" is null) or ("inbox_v2_data_governance_restore_leases"."state" = 'completed' and "inbox_v2_data_governance_restore_leases"."completed_at" is not null and isfinite("inbox_v2_data_governance_restore_leases"."completed_at") and "inbox_v2_data_governance_restore_leases"."completed_at" >= "inbox_v2_data_governance_restore_leases"."claimed_at" and "inbox_v2_data_governance_restore_leases"."completed_at" <= "inbox_v2_data_governance_restore_leases"."lease_expires_at") or ("inbox_v2_data_governance_restore_leases"."state" in ('released', 'expired') and "inbox_v2_data_governance_restore_leases"."completed_at" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_restore_required_controls" (
	"tenant_id" text NOT NULL,
	"ledger_id" text NOT NULL,
	"restore_id" text NOT NULL,
	"control_kind" "inbox_v2_data_governance_control_reference_kind" NOT NULL,
	"control_id" text NOT NULL,
	"control_revision" bigint NOT NULL,
	"control_head_revision" bigint NOT NULL,
	"source_control_entry_hash" text NOT NULL,
	"row_revision" bigint NOT NULL,
	"reapplied_entry_hash" text,
	"reapplied_at" timestamp (3) with time zone,
	CONSTRAINT "inbox_v2_dg_restore_required_controls_pk" PRIMARY KEY("tenant_id","ledger_id","restore_id","control_kind","control_id","control_revision"),
	CONSTRAINT "inbox_v2_dg_restore_required_values_check" CHECK ("inbox_v2_data_governance_restore_required_controls"."control_revision" >= 1 and "inbox_v2_data_governance_restore_required_controls"."control_head_revision" >= 1 and "inbox_v2_data_governance_restore_required_controls"."row_revision" >= 1 and "inbox_v2_data_governance_restore_required_controls"."source_control_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and (("inbox_v2_data_governance_restore_required_controls"."reapplied_entry_hash" is null and "inbox_v2_data_governance_restore_required_controls"."reapplied_at" is null) or ("inbox_v2_data_governance_restore_required_controls"."reapplied_entry_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_restore_required_controls"."reapplied_at" is not null and isfinite("inbox_v2_data_governance_restore_required_controls"."reapplied_at")) ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_restriction_heads" (
	"tenant_id" text NOT NULL,
	"restriction_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_control_state" NOT NULL,
	"head_revision" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_restriction_heads_pk" PRIMARY KEY("tenant_id","restriction_id"),
	CONSTRAINT "inbox_v2_dg_restriction_head_values_check" CHECK ("inbox_v2_data_governance_restriction_heads"."current_revision" >= 1 and "inbox_v2_data_governance_restriction_heads"."head_revision" >= 1 and isfinite("inbox_v2_data_governance_restriction_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_restriction_revisions" (
	"tenant_id" text NOT NULL,
	"restriction_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"state" "inbox_v2_data_governance_control_state" NOT NULL,
	"scope_kind" "inbox_v2_data_governance_scope_kind" NOT NULL,
	"scope_manifest_id" text NOT NULL,
	"scope_manifest_revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"matcher_handler_id" text,
	"matcher_version" bigint,
	"predicate_hash" text,
	"owner_employee_id" text NOT NULL,
	"reason_code" text NOT NULL,
	"continuing_purpose_count" bigint NOT NULL,
	"allowed_use_mask" bigint NOT NULL,
	"effective_at" timestamp (3) with time zone NOT NULL,
	"review_at" timestamp (3) with time zone NOT NULL,
	"released_at" timestamp (3) with time zone,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_restriction_revisions_pk" PRIMARY KEY("tenant_id","restriction_id","revision"),
	CONSTRAINT "inbox_v2_dg_restriction_values_check" CHECK ("inbox_v2_data_governance_restriction_revisions"."revision" >= 1 and "inbox_v2_data_governance_restriction_revisions"."continuing_purpose_count" >= 1 and "inbox_v2_data_governance_restriction_revisions"."allowed_use_mask" between 1 and 2047 and isfinite("inbox_v2_data_governance_restriction_revisions"."effective_at") and isfinite("inbox_v2_data_governance_restriction_revisions"."review_at") and "inbox_v2_data_governance_restriction_revisions"."review_at" > "inbox_v2_data_governance_restriction_revisions"."effective_at"),
	CONSTRAINT "inbox_v2_dg_restriction_state_check" CHECK (("inbox_v2_data_governance_restriction_revisions"."state" = 'active' and "inbox_v2_data_governance_restriction_revisions"."released_at" is null) or ("inbox_v2_data_governance_restriction_revisions"."state" = 'released' and "inbox_v2_data_governance_restriction_revisions"."released_at" is not null and "inbox_v2_data_governance_restriction_revisions"."released_at" >= "inbox_v2_data_governance_restriction_revisions"."effective_at")),
	CONSTRAINT "inbox_v2_dg_restriction_scope_check" CHECK (("inbox_v2_data_governance_restriction_revisions"."scope_kind" = 'prospective' and "inbox_v2_data_governance_restriction_revisions"."matcher_handler_id" is not null and "inbox_v2_data_governance_restriction_revisions"."matcher_version" >= 1 and "inbox_v2_data_governance_restriction_revisions"."predicate_hash" ~ '^sha256:[0-9a-f]{64}$') or ("inbox_v2_data_governance_restriction_revisions"."scope_kind" = 'exact' and "inbox_v2_data_governance_restriction_revisions"."matcher_handler_id" is null and "inbox_v2_data_governance_restriction_revisions"."matcher_version" is null and "inbox_v2_data_governance_restriction_revisions"."predicate_hash" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_scope_manifest_roots" (
	"tenant_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"root_kind" "inbox_v2_data_governance_storage_root_kind" NOT NULL,
	"boundary" "inbox_v2_data_governance_root_boundary" NOT NULL,
	"copy_role" "inbox_v2_data_governance_copy_role" NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"expected_entity_revision" bigint NOT NULL,
	"expected_lineage_revision" bigint NOT NULL,
	CONSTRAINT "inbox_v2_dg_scope_manifest_roots_pk" PRIMARY KEY("tenant_id","manifest_id","manifest_revision","storage_root_id","root_record_id"),
	CONSTRAINT "inbox_v2_dg_scope_root_values_check" CHECK ("inbox_v2_data_governance_scope_manifest_roots"."expected_entity_revision" >= 1 and "inbox_v2_data_governance_scope_manifest_roots"."expected_lineage_revision" >= 1),
	CONSTRAINT "inbox_v2_dg_scope_root_role_check" CHECK ((
      "inbox_v2_data_governance_scope_manifest_roots"."copy_role" = 'backup' and "inbox_v2_data_governance_scope_manifest_roots"."root_kind" = 'backup' and "inbox_v2_data_governance_scope_manifest_roots"."boundary" = 'operated_data_plane'
    ) or (
      "inbox_v2_data_governance_scope_manifest_roots"."copy_role" = 'external' and "inbox_v2_data_governance_scope_manifest_roots"."root_kind" = 'external_route' and "inbox_v2_data_governance_scope_manifest_roots"."boundary" = 'outside_operated_data_plane'
    ) or (
      "inbox_v2_data_governance_scope_manifest_roots"."copy_role" in ('primary', 'derived') and "inbox_v2_data_governance_scope_manifest_roots"."root_kind" not in ('backup', 'external_route') and "inbox_v2_data_governance_scope_manifest_roots"."boundary" = 'operated_data_plane'
    ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_scope_manifests" (
	"tenant_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"kind" "inbox_v2_data_governance_scope_kind" NOT NULL,
	"manifest_hash" text NOT NULL,
	"stream_epoch" text NOT NULL,
	"sync_generation" bigint NOT NULL,
	"complete_through_position" bigint NOT NULL,
	"frozen_at" timestamp (3) with time zone NOT NULL,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_scope_manifests_pk" PRIMARY KEY("tenant_id","manifest_id","revision"),
	CONSTRAINT "inbox_v2_dg_scope_manifest_values_check" CHECK ("inbox_v2_data_governance_scope_manifests"."revision" >= 1 and "inbox_v2_data_governance_scope_manifests"."sync_generation" >= 1 and "inbox_v2_data_governance_scope_manifests"."complete_through_position" >= 0 and "inbox_v2_data_governance_scope_manifests"."manifest_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_scope_manifests"."frozen_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_storage_roots" (
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"storage_root_id" text NOT NULL,
	"kind" "inbox_v2_data_governance_storage_root_kind" NOT NULL,
	"boundary" "inbox_v2_data_governance_root_boundary" NOT NULL,
	"version_enumeration" "inbox_v2_data_governance_version_enumeration" NOT NULL,
	"configuration_profile_id" text NOT NULL,
	"owner_module_id" text,
	"canonical_snapshot" jsonb NOT NULL,
	CONSTRAINT "inbox_v2_dg_storage_roots_pk" PRIMARY KEY("registry_id","registry_revision","storage_root_id"),
	CONSTRAINT "inbox_v2_dg_storage_roots_shape_check" CHECK ((
          "inbox_v2_data_governance_storage_roots"."kind" = 'external_route'
          and "inbox_v2_data_governance_storage_roots"."boundary" = 'outside_operated_data_plane'
        ) or (
          "inbox_v2_data_governance_storage_roots"."kind" <> 'external_route'
          and "inbox_v2_data_governance_storage_roots"."boundary" = 'operated_data_plane'
        )),
	CONSTRAINT "inbox_v2_dg_storage_roots_versions_check" CHECK (("inbox_v2_data_governance_storage_roots"."kind" = 'object' and "inbox_v2_data_governance_storage_roots"."version_enumeration" = 'supported')
        or ("inbox_v2_data_governance_storage_roots"."kind" = 'backup' and "inbox_v2_data_governance_storage_roots"."version_enumeration" = 'expiry_ledger')
        or ("inbox_v2_data_governance_storage_roots"."kind" not in ('object', 'backup') and "inbox_v2_data_governance_storage_roots"."version_enumeration" in ('not_applicable', 'supported')))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_subject_links" (
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"registry_id" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"root_record_id" text NOT NULL,
	"subject_kind" "inbox_v2_data_governance_subject_kind" NOT NULL,
	"employee_id" text,
	"client_contact_id" text,
	"source_external_identity_id" text,
	"account_id" text,
	"unresolved_provider_subject_id" text,
	"unresolved_realm_id" text,
	"role" "inbox_v2_data_governance_subject_link_role" NOT NULL,
	"provenance_kind" "inbox_v2_data_governance_subject_provenance" NOT NULL,
	"provenance_reference_id" text NOT NULL,
	"evidence_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_dg_subject_links_pk" PRIMARY KEY("tenant_id","link_id","revision"),
	CONSTRAINT "inbox_v2_dg_subject_link_values_check" CHECK ("inbox_v2_data_governance_subject_links"."revision" >= 1 and "inbox_v2_data_governance_subject_links"."evidence_hash" ~ '^sha256:[0-9a-f]{64}$' and isfinite("inbox_v2_data_governance_subject_links"."created_at")),
	CONSTRAINT "inbox_v2_dg_subject_link_subject_check" CHECK ((
          "inbox_v2_data_governance_subject_links"."subject_kind" = 'employee' and "inbox_v2_data_governance_subject_links"."employee_id" is not null
          and "inbox_v2_data_governance_subject_links"."client_contact_id" is null and "inbox_v2_data_governance_subject_links"."source_external_identity_id" is null
          and "inbox_v2_data_governance_subject_links"."account_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_provider_subject_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_realm_id" is null
        ) or (
          "inbox_v2_data_governance_subject_links"."subject_kind" = 'client_contact' and "inbox_v2_data_governance_subject_links"."employee_id" is null
          and "inbox_v2_data_governance_subject_links"."client_contact_id" is not null and "inbox_v2_data_governance_subject_links"."source_external_identity_id" is null
          and "inbox_v2_data_governance_subject_links"."account_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_provider_subject_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_realm_id" is null
        ) or (
          "inbox_v2_data_governance_subject_links"."subject_kind" = 'source_external_identity' and "inbox_v2_data_governance_subject_links"."employee_id" is null
          and "inbox_v2_data_governance_subject_links"."client_contact_id" is null and "inbox_v2_data_governance_subject_links"."source_external_identity_id" is not null
          and "inbox_v2_data_governance_subject_links"."account_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_provider_subject_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_realm_id" is null
        ) or (
          "inbox_v2_data_governance_subject_links"."subject_kind" = 'account' and "inbox_v2_data_governance_subject_links"."employee_id" is null
          and "inbox_v2_data_governance_subject_links"."client_contact_id" is null and "inbox_v2_data_governance_subject_links"."source_external_identity_id" is null
          and "inbox_v2_data_governance_subject_links"."account_id" is not null and "inbox_v2_data_governance_subject_links"."unresolved_provider_subject_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_realm_id" is null
        ) or (
          "inbox_v2_data_governance_subject_links"."subject_kind" = 'unresolved_provider_subject' and "inbox_v2_data_governance_subject_links"."employee_id" is null
          and "inbox_v2_data_governance_subject_links"."client_contact_id" is null and "inbox_v2_data_governance_subject_links"."source_external_identity_id" is null
          and "inbox_v2_data_governance_subject_links"."account_id" is null and "inbox_v2_data_governance_subject_links"."unresolved_provider_subject_id" is not null and "inbox_v2_data_governance_subject_links"."unresolved_realm_id" is not null
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_data_governance_tenant_termination_scope_authorities" (
	"tenant_id" text NOT NULL,
	"manifest_id" text NOT NULL,
	"manifest_revision" bigint NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"root_set_hash" text NOT NULL,
	"export_root_set_hash" text NOT NULL,
	"proof_hash" text NOT NULL,
	"governance_context_id" text NOT NULL,
	"governance_context_version" bigint NOT NULL,
	"governance_context_hash" text NOT NULL,
	"policy_id" text NOT NULL,
	"policy_version" bigint NOT NULL,
	"policy_hash" text NOT NULL,
	"activation_id" text NOT NULL,
	"activation_revision" bigint NOT NULL,
	"activation_hash" text NOT NULL,
	CONSTRAINT "inbox_v2_dg_tenant_term_scope_authorities_pk" PRIMARY KEY("tenant_id","manifest_id","manifest_revision"),
	CONSTRAINT "inbox_v2_dg_tenant_term_scope_authority_values_check" CHECK ("inbox_v2_data_governance_tenant_termination_scope_authorities"."manifest_revision" >= 1 and "inbox_v2_data_governance_tenant_termination_scope_authorities"."governance_context_version" >= 1 and "inbox_v2_data_governance_tenant_termination_scope_authorities"."policy_version" >= 1 and "inbox_v2_data_governance_tenant_termination_scope_authorities"."activation_revision" >= 1 and "inbox_v2_data_governance_tenant_termination_scope_authorities"."registry_composition_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."root_set_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."export_root_set_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."proof_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."governance_context_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."policy_hash" ~ '^sha256:[0-9a-f]{64}$' and "inbox_v2_data_governance_tenant_termination_scope_authorities"."activation_hash" ~ '^sha256:[0-9a-f]{64}$')
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_backup_attempt_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision","plan_id","plan_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_backup_attempt_requirement_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision","checkpoint_id") REFERENCES "public"."inbox_v2_data_governance_deletion_checkpoint_requirements"("tenant_id","plan_id","plan_revision","checkpoint_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_backup_attempt_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_backup_attempt_verify_fk" FOREIGN KEY ("registry_id","registry_revision","verification_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_backup_attempt_expiry_fk" FOREIGN KEY ("registry_id","registry_revision","expiry_ledger_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_backup_checkpoint_heads" ADD CONSTRAINT "inbox_v2_dg_backup_head_attempt_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","checkpoint_id","current_attempt") REFERENCES "public"."inbox_v2_data_governance_backup_checkpoint_attempts"("tenant_id","run_id","run_revision","checkpoint_id","attempt") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_context_purpose_roles" ADD CONSTRAINT "inbox_v2_dg_context_roles_context_fk" FOREIGN KEY ("tenant_id","context_id","context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_contexts" ADD CONSTRAINT "inbox_v2_dg_contexts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_contexts" ADD CONSTRAINT "inbox_v2_dg_contexts_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_control_set_heads" ADD CONSTRAINT "inbox_v2_dg_control_set_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_module_fk" FOREIGN KEY ("owner_module_id") REFERENCES "public"."module_catalog"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_lifecycle_handler_fk" FOREIGN KEY ("registry_id","registry_revision","lifecycle_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_discovery_handler_fk" FOREIGN KEY ("registry_id","registry_revision","subject_discovery_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_projection_handler_fk" FOREIGN KEY ("registry_id","registry_revision","export_projection_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_export_handler_fk" FOREIGN KEY ("registry_id","registry_revision","export_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_delete_handler_fk" FOREIGN KEY ("registry_id","registry_revision","delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_verify_handler_fk" FOREIGN KEY ("registry_id","registry_revision","verification_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_expiry_handler_fk" FOREIGN KEY ("registry_id","registry_revision","expiry_ledger_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_data_use_lineages" ADD CONSTRAINT "inbox_v2_dg_lineages_external_handler_fk" FOREIGN KEY ("registry_id","registry_revision","external_delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_plan_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_plans"("tenant_id","plan_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_delete_fk" FOREIGN KEY ("registry_id","registry_revision","delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_verify_fk" FOREIGN KEY ("registry_id","registry_revision","verification_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_expiry_fk" FOREIGN KEY ("registry_id","registry_revision","expiry_ledger_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_checkpoint_requirements" ADD CONSTRAINT "inbox_v2_dg_checkpoint_requirement_external_fk" FOREIGN KEY ("registry_id","registry_revision","external_delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_request_fk" FOREIGN KEY ("tenant_id","request_id","request_revision") REFERENCES "public"."inbox_v2_data_governance_privacy_request_revisions"("tenant_id","request_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_plans" ADD CONSTRAINT "inbox_v2_dg_deletion_plan_activation_fk" FOREIGN KEY ("tenant_id","activation_id","activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_run_terminal_exports" ADD CONSTRAINT "inbox_v2_dg_deletion_run_terminal_export_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_run_terminal_exports" ADD CONSTRAINT "inbox_v2_dg_deletion_run_terminal_export_job_fk" FOREIGN KEY ("tenant_id","job_id","job_revision") REFERENCES "public"."inbox_v2_data_governance_export_jobs"("tenant_id","job_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_run_terminal_exports" ADD CONSTRAINT "inbox_v2_dg_deletion_run_terminal_export_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_export_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_run_terminal_exports" ADD CONSTRAINT "inbox_v2_dg_deletion_run_terminal_export_artifact_fk" FOREIGN KEY ("tenant_id","artifact_id","artifact_revision") REFERENCES "public"."inbox_v2_data_governance_export_artifacts"("tenant_id","artifact_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_runs" ADD CONSTRAINT "inbox_v2_dg_deletion_run_plan_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_plans"("tenant_id","plan_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_stage_one_targets" ADD CONSTRAINT "inbox_v2_dg_deletion_stage_one_target_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision","plan_id","plan_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_stage_one_targets" ADD CONSTRAINT "inbox_v2_dg_deletion_stage_one_target_requirement_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision","checkpoint_id") REFERENCES "public"."inbox_v2_data_governance_deletion_checkpoint_requirements"("tenant_id","plan_id","plan_revision","checkpoint_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_deletion_stage_one_targets" ADD CONSTRAINT "inbox_v2_dg_deletion_stage_one_target_tenant_fk" FOREIGN KEY ("tombstone_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision","plan_id","plan_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_requirement_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision","checkpoint_id") REFERENCES "public"."inbox_v2_data_governance_deletion_checkpoint_requirements"("tenant_id","plan_id","plan_revision","checkpoint_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_handler_fk" FOREIGN KEY ("registry_id","registry_revision","execution_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_destructive_checkpoint_leases" ADD CONSTRAINT "inbox_v2_dg_destructive_lease_activation_fk" FOREIGN KEY ("tenant_id","activation_id","activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_effective_policies" ADD CONSTRAINT "inbox_v2_dg_effective_policy_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_effective_policies" ADD CONSTRAINT "inbox_v2_dg_effective_policy_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_effective_policies" ADD CONSTRAINT "inbox_v2_dg_effective_policy_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_effective_policy_rules" ADD CONSTRAINT "inbox_v2_dg_effective_rule_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_activation_fk" FOREIGN KEY ("tenant_id","activation_id","activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_primary_verify_fk" FOREIGN KEY ("registry_id","registry_revision","primary_verification_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_run_fk" FOREIGN KEY ("tenant_id","deletion_run_id","deletion_run_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger_controls" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_control_entry_fk" FOREIGN KEY ("tenant_id","ledger_id","ledger_entry_id") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","ledger_entry_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger_evidence" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_evidence_entry_fk" FOREIGN KEY ("tenant_id","ledger_id","ledger_entry_id") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","ledger_entry_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_erasure_restore_ledger_evidence" ADD CONSTRAINT "inbox_v2_dg_erasure_ledger_evidence_tenant_fk" FOREIGN KEY ("payload_tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_artifact_heads" ADD CONSTRAINT "inbox_v2_dg_export_artifact_head_revision_fk" FOREIGN KEY ("tenant_id","artifact_id","current_revision") REFERENCES "public"."inbox_v2_data_governance_export_artifacts"("tenant_id","artifact_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_artifact_heads" ADD CONSTRAINT "inbox_v2_dg_export_artifact_head_job_fk" FOREIGN KEY ("tenant_id","job_id","job_revision") REFERENCES "public"."inbox_v2_data_governance_export_jobs"("tenant_id","job_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_artifacts" ADD CONSTRAINT "inbox_v2_dg_export_artifact_job_fk" FOREIGN KEY ("tenant_id","job_id","job_revision") REFERENCES "public"."inbox_v2_data_governance_export_jobs"("tenant_id","job_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_artifacts" ADD CONSTRAINT "inbox_v2_dg_export_artifact_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_export_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_claims" ADD CONSTRAINT "inbox_v2_dg_export_claim_job_fk" FOREIGN KEY ("tenant_id","job_id","job_revision") REFERENCES "public"."inbox_v2_data_governance_export_jobs"("tenant_id","job_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_claims" ADD CONSTRAINT "inbox_v2_dg_export_claim_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_export_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_request_fk" FOREIGN KEY ("tenant_id","request_id","request_revision") REFERENCES "public"."inbox_v2_data_governance_privacy_request_revisions"("tenant_id","request_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_scope_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_activation_fk" FOREIGN KEY ("tenant_id","activation_id","activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_jobs" ADD CONSTRAINT "inbox_v2_dg_export_job_handler_fk" FOREIGN KEY ("registry_id","registry_revision","export_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_manifests" ADD CONSTRAINT "inbox_v2_dg_export_manifest_job_fk" FOREIGN KEY ("tenant_id","job_id","job_revision") REFERENCES "public"."inbox_v2_data_governance_export_jobs"("tenant_id","job_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_manifests" ADD CONSTRAINT "inbox_v2_dg_export_manifest_scope_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_export_receipt_cas" ADD CONSTRAINT "inbox_v2_dg_export_receipt_claim_fk" FOREIGN KEY ("tenant_id","artifact_claim_key") REFERENCES "public"."inbox_v2_data_governance_export_claims"("tenant_id","artifact_claim_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_external_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_external_attempt_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision","plan_id","plan_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_external_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_external_attempt_requirement_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision","checkpoint_id") REFERENCES "public"."inbox_v2_data_governance_deletion_checkpoint_requirements"("tenant_id","plan_id","plan_revision","checkpoint_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_external_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_external_attempt_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_external_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_external_attempt_handler_fk" FOREIGN KEY ("registry_id","registry_revision","external_delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_external_checkpoint_heads" ADD CONSTRAINT "inbox_v2_dg_external_head_attempt_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","checkpoint_id","current_attempt") REFERENCES "public"."inbox_v2_data_governance_external_checkpoint_attempts"("tenant_id","run_id","run_revision","checkpoint_id","attempt") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_data_classes" ADD CONSTRAINT "inbox_v2_dg_hold_data_class_hold_fk" FOREIGN KEY ("tenant_id","hold_id","hold_revision") REFERENCES "public"."inbox_v2_data_governance_legal_hold_revisions"("tenant_id","hold_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_heads" ADD CONSTRAINT "inbox_v2_dg_legal_hold_head_revision_fk" FOREIGN KEY ("tenant_id","hold_id","current_revision") REFERENCES "public"."inbox_v2_data_governance_legal_hold_revisions"("tenant_id","hold_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_revisions" ADD CONSTRAINT "inbox_v2_dg_legal_hold_scope_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_revisions" ADD CONSTRAINT "inbox_v2_dg_legal_hold_owner_fk" FOREIGN KEY ("tenant_id","owner_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_revisions" ADD CONSTRAINT "inbox_v2_dg_legal_hold_approver_fk" FOREIGN KEY ("tenant_id","approver_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_revisions" ADD CONSTRAINT "inbox_v2_dg_legal_hold_matcher_fk" FOREIGN KEY ("registry_id","registry_revision","matcher_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_targets" ADD CONSTRAINT "inbox_v2_dg_hold_target_hold_fk" FOREIGN KEY ("tenant_id","hold_id","hold_revision") REFERENCES "public"."inbox_v2_data_governance_legal_hold_revisions"("tenant_id","hold_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_legal_hold_targets" ADD CONSTRAINT "inbox_v2_dg_hold_target_scope_root_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision","storage_root_id","root_record_id") REFERENCES "public"."inbox_v2_data_governance_scope_manifest_roots"("tenant_id","manifest_id","manifest_revision","storage_root_id","root_record_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_handlers" ADD CONSTRAINT "inbox_v2_dg_handlers_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_handlers" ADD CONSTRAINT "inbox_v2_dg_handlers_module_fk" FOREIGN KEY ("owner_module_id") REFERENCES "public"."module_catalog"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_purpose_instances" ADD CONSTRAINT "inbox_v2_dg_purpose_instance_set_fk" FOREIGN KEY ("tenant_id","purpose_set_id","purpose_set_revision") REFERENCES "public"."inbox_v2_data_governance_lifecycle_purpose_sets"("tenant_id","purpose_set_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_purpose_sets" ADD CONSTRAINT "inbox_v2_dg_purpose_set_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_purpose_sets" ADD CONSTRAINT "inbox_v2_dg_purpose_set_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_lifecycle_purpose_sets" ADD CONSTRAINT "inbox_v2_dg_purpose_set_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_operated_attempt_run_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","plan_id","plan_revision") REFERENCES "public"."inbox_v2_data_governance_deletion_runs"("tenant_id","run_id","revision","plan_id","plan_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_operated_attempt_requirement_fk" FOREIGN KEY ("tenant_id","plan_id","plan_revision","checkpoint_id") REFERENCES "public"."inbox_v2_data_governance_deletion_checkpoint_requirements"("tenant_id","plan_id","plan_revision","checkpoint_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_operated_attempt_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_operated_attempt_delete_fk" FOREIGN KEY ("registry_id","registry_revision","delete_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_attempts" ADD CONSTRAINT "inbox_v2_dg_operated_attempt_verify_fk" FOREIGN KEY ("registry_id","registry_revision","verification_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_operated_checkpoint_heads" ADD CONSTRAINT "inbox_v2_dg_operated_head_attempt_fk" FOREIGN KEY ("tenant_id","run_id","run_revision","checkpoint_id","current_attempt") REFERENCES "public"."inbox_v2_data_governance_operated_checkpoint_attempts"("tenant_id","run_id","run_revision","checkpoint_id","attempt") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_activation_heads" ADD CONSTRAINT "inbox_v2_dg_activation_head_policy_fk" FOREIGN KEY ("tenant_id","policy_id","current_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_activation_heads" ADD CONSTRAINT "inbox_v2_dg_activation_head_activation_fk" FOREIGN KEY ("tenant_id","current_activation_id","current_activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_activations" ADD CONSTRAINT "inbox_v2_dg_activation_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_activations" ADD CONSTRAINT "inbox_v2_dg_activation_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_template_rules" ADD CONSTRAINT "inbox_v2_dg_template_rules_template_fk" FOREIGN KEY ("template_id","template_revision") REFERENCES "public"."inbox_v2_data_governance_policy_templates"("template_id","template_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_policy_templates" ADD CONSTRAINT "inbox_v2_dg_templates_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_aliases" ADD CONSTRAINT "inbox_v2_dg_privacy_alias_request_fk" FOREIGN KEY ("tenant_id","request_id","request_revision") REFERENCES "public"."inbox_v2_data_governance_privacy_request_revisions"("tenant_id","request_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_heads" ADD CONSTRAINT "inbox_v2_dg_privacy_head_revision_fk" FOREIGN KEY ("tenant_id","request_id","current_revision") REFERENCES "public"."inbox_v2_data_governance_privacy_request_revisions"("tenant_id","request_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_revisions" ADD CONSTRAINT "inbox_v2_dg_privacy_request_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_revisions" ADD CONSTRAINT "inbox_v2_dg_privacy_request_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_revisions" ADD CONSTRAINT "inbox_v2_dg_privacy_request_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_revisions" ADD CONSTRAINT "inbox_v2_dg_privacy_request_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_privacy_request_revisions" ADD CONSTRAINT "inbox_v2_dg_privacy_request_manifest_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_heads" ADD CONSTRAINT "inbox_v2_dg_restore_head_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_heads" ADD CONSTRAINT "inbox_v2_dg_restore_head_source_fk" FOREIGN KEY ("tenant_id","ledger_id","source_erasure_entry_hash") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","entry_hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_heads" ADD CONSTRAINT "inbox_v2_dg_restore_head_opened_fk" FOREIGN KEY ("tenant_id","ledger_id","opened_entry_hash") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","entry_hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_heads" ADD CONSTRAINT "inbox_v2_dg_restore_head_sealed_fk" FOREIGN KEY ("tenant_id","ledger_id","sealed_entry_hash") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","entry_hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_leases" ADD CONSTRAINT "inbox_v2_dg_restore_lease_head_fk" FOREIGN KEY ("tenant_id","ledger_id","restore_id") REFERENCES "public"."inbox_v2_data_governance_restore_heads"("tenant_id","ledger_id","restore_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_required_controls" ADD CONSTRAINT "inbox_v2_dg_restore_required_head_fk" FOREIGN KEY ("tenant_id","ledger_id","restore_id") REFERENCES "public"."inbox_v2_data_governance_restore_heads"("tenant_id","ledger_id","restore_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_required_controls" ADD CONSTRAINT "inbox_v2_dg_restore_required_source_fk" FOREIGN KEY ("tenant_id","ledger_id","source_control_entry_hash") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","entry_hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restore_required_controls" ADD CONSTRAINT "inbox_v2_dg_restore_required_reapplied_fk" FOREIGN KEY ("tenant_id","ledger_id","reapplied_entry_hash") REFERENCES "public"."inbox_v2_data_governance_erasure_restore_ledger"("tenant_id","ledger_id","entry_hash") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restriction_heads" ADD CONSTRAINT "inbox_v2_dg_restriction_head_revision_fk" FOREIGN KEY ("tenant_id","restriction_id","current_revision") REFERENCES "public"."inbox_v2_data_governance_restriction_revisions"("tenant_id","restriction_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restriction_revisions" ADD CONSTRAINT "inbox_v2_dg_restriction_scope_fk" FOREIGN KEY ("tenant_id","scope_manifest_id","scope_manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restriction_revisions" ADD CONSTRAINT "inbox_v2_dg_restriction_owner_fk" FOREIGN KEY ("tenant_id","owner_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_restriction_revisions" ADD CONSTRAINT "inbox_v2_dg_restriction_matcher_fk" FOREIGN KEY ("registry_id","registry_revision","matcher_handler_id") REFERENCES "public"."inbox_v2_data_governance_lifecycle_handlers"("registry_id","registry_revision","handler_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_scope_manifest_roots" ADD CONSTRAINT "inbox_v2_dg_scope_root_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_scope_manifest_roots" ADD CONSTRAINT "inbox_v2_dg_scope_root_registry_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_scope_manifests" ADD CONSTRAINT "inbox_v2_dg_scope_manifest_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_scope_manifests" ADD CONSTRAINT "inbox_v2_dg_scope_manifest_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_storage_roots" ADD CONSTRAINT "inbox_v2_dg_storage_roots_registry_fk" FOREIGN KEY ("registry_id","registry_revision") REFERENCES "public"."inbox_v2_data_governance_registry_versions"("id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_storage_roots" ADD CONSTRAINT "inbox_v2_dg_storage_roots_module_fk" FOREIGN KEY ("owner_module_id") REFERENCES "public"."module_catalog"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_root_fk" FOREIGN KEY ("registry_id","registry_revision","storage_root_id") REFERENCES "public"."inbox_v2_data_governance_storage_roots"("registry_id","registry_revision","storage_root_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_contact_fk" FOREIGN KEY ("tenant_id","client_contact_id") REFERENCES "public"."client_contacts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_identity_fk" FOREIGN KEY ("tenant_id","source_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_account_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_tenant_termination_scope_authorities" ADD CONSTRAINT "inbox_v2_dg_tenant_term_scope_manifest_fk" FOREIGN KEY ("tenant_id","manifest_id","manifest_revision") REFERENCES "public"."inbox_v2_data_governance_scope_manifests"("tenant_id","manifest_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_tenant_termination_scope_authorities" ADD CONSTRAINT "inbox_v2_dg_tenant_term_scope_context_fk" FOREIGN KEY ("tenant_id","governance_context_id","governance_context_version") REFERENCES "public"."inbox_v2_data_governance_contexts"("tenant_id","context_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_tenant_termination_scope_authorities" ADD CONSTRAINT "inbox_v2_dg_tenant_term_scope_policy_fk" FOREIGN KEY ("tenant_id","policy_id","policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_tenant_termination_scope_authorities" ADD CONSTRAINT "inbox_v2_dg_tenant_term_scope_activation_fk" FOREIGN KEY ("tenant_id","activation_id","activation_revision") REFERENCES "public"."inbox_v2_data_governance_policy_activations"("tenant_id","activation_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_backup_attempt_tenant_idx" ON "inbox_v2_data_governance_backup_checkpoint_attempts" USING btree ("tenant_id","run_id","run_revision","checkpoint_id","attempt" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_backup_head_tenant_idx" ON "inbox_v2_data_governance_backup_checkpoint_heads" USING btree ("tenant_id","run_id","current_outcome","checkpoint_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_context_roles_tenant_idx" ON "inbox_v2_data_governance_context_purpose_roles" USING btree ("tenant_id","purpose_id","context_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_contexts_tenant_idx" ON "inbox_v2_data_governance_contexts" USING btree ("tenant_id","context_id","version" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_control_set_tenant_idx" ON "inbox_v2_data_governance_control_set_heads" USING btree ("tenant_id","last_changed_stream_position");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_lineages_class_idx" ON "inbox_v2_data_governance_data_use_lineages" USING btree ("registry_id","registry_revision","data_class_id","storage_root_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_checkpoint_requirement_tenant_idx" ON "inbox_v2_data_governance_deletion_checkpoint_requirements" USING btree ("tenant_id","plan_id","surface","storage_root_id","checkpoint_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_deletion_plan_tenant_idx" ON "inbox_v2_data_governance_deletion_plans" USING btree ("tenant_id","request_id","created_at","plan_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_deletion_run_terminal_export_job_idx" ON "inbox_v2_data_governance_deletion_run_terminal_exports" USING btree ("tenant_id","job_id","job_revision","artifact_id","artifact_revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_deletion_run_tenant_idx" ON "inbox_v2_data_governance_deletion_runs" USING btree ("tenant_id","state","started_at","run_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_deletion_stage_one_target_tenant_idx" ON "inbox_v2_data_governance_deletion_stage_one_targets" USING btree ("tenant_id","run_id","run_revision","checkpoint_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_destructive_lease_fence_unique" ON "inbox_v2_data_governance_destructive_checkpoint_leases" USING btree ("tenant_id","execution_fence_hash");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_destructive_lease_tenant_idx" ON "inbox_v2_data_governance_destructive_checkpoint_leases" USING btree ("tenant_id","state","lease_expires_at","run_id","checkpoint_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_effective_policy_tenant_idx" ON "inbox_v2_data_governance_effective_policies" USING btree ("tenant_id","policy_id","version" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_effective_rule_class_unique" ON "inbox_v2_data_governance_effective_policy_rules" USING btree ("tenant_id","policy_id","policy_version","data_class_id","purpose_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_effective_rule_tenant_idx" ON "inbox_v2_data_governance_effective_policy_rules" USING btree ("tenant_id","data_class_id","purpose_id","policy_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_erasure_ledger_sequence_unique" ON "inbox_v2_data_governance_erasure_restore_ledger" USING btree ("tenant_id","ledger_id","sequence");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_erasure_ledger_target_idx" ON "inbox_v2_data_governance_erasure_restore_ledger" USING btree ("tenant_id","storage_root_id","data_class_id","entity_type_id","entity_id","sequence" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_erasure_ledger_restore_idx" ON "inbox_v2_data_governance_erasure_restore_ledger" USING btree ("tenant_id","ledger_id","restore_id","sequence");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_erasure_ledger_restore_open_unique" ON "inbox_v2_data_governance_erasure_restore_ledger" USING btree ("tenant_id","ledger_id","restore_id") WHERE "inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'restore_opened';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_erasure_ledger_restore_seal_unique" ON "inbox_v2_data_governance_erasure_restore_ledger" USING btree ("tenant_id","ledger_id","restore_id") WHERE "inbox_v2_data_governance_erasure_restore_ledger"."kind" = 'restore_sealed';
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_erasure_ledger_control_tenant_idx" ON "inbox_v2_data_governance_erasure_restore_ledger_controls" USING btree ("tenant_id","control_kind","control_id","ledger_id","ledger_entry_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_erasure_ledger_evidence_tenant_idx" ON "inbox_v2_data_governance_erasure_restore_ledger_evidence" USING btree ("tenant_id","slot","ledger_id","ledger_entry_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_artifact_head_claim_unique" ON "inbox_v2_data_governance_export_artifact_heads" USING btree ("tenant_id","artifact_claim_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_artifact_head_tenant_idx" ON "inbox_v2_data_governance_export_artifact_heads" USING btree ("tenant_id","current_state","updated_at","artifact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_artifact_claim_revision_unique" ON "inbox_v2_data_governance_export_artifacts" USING btree ("tenant_id","artifact_claim_key","revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_artifact_tenant_idx" ON "inbox_v2_data_governance_export_artifacts" USING btree ("tenant_id","state","recorded_at","artifact_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_claim_artifact_unique" ON "inbox_v2_data_governance_export_claims" USING btree ("tenant_id","artifact_claim_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_claim_receipt_unique" ON "inbox_v2_data_governance_export_claims" USING btree ("tenant_id","receipt_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_claim_tenant_idx" ON "inbox_v2_data_governance_export_claims" USING btree ("tenant_id","principal_key","created_at","receipt_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_job_tenant_idx" ON "inbox_v2_data_governance_export_jobs" USING btree ("tenant_id","state","state_revision","updated_at","job_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_manifest_job_unique" ON "inbox_v2_data_governance_export_manifests" USING btree ("tenant_id","job_id","job_revision","manifest_id","revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_manifest_tenant_idx" ON "inbox_v2_data_governance_export_manifests" USING btree ("tenant_id","job_id","revision" DESC NULLS LAST,"manifest_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_export_receipt_artifact_unique" ON "inbox_v2_data_governance_export_receipt_cas" USING btree ("tenant_id","artifact_claim_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_export_receipt_tenant_idx" ON "inbox_v2_data_governance_export_receipt_cas" USING btree ("tenant_id","state","updated_at","receipt_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_external_attempt_tenant_idx" ON "inbox_v2_data_governance_external_checkpoint_attempts" USING btree ("tenant_id","run_id","run_revision","checkpoint_id","attempt" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_external_head_tenant_idx" ON "inbox_v2_data_governance_external_checkpoint_heads" USING btree ("tenant_id","run_id","current_outcome","checkpoint_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_hold_data_class_tenant_idx" ON "inbox_v2_data_governance_legal_hold_data_classes" USING btree ("tenant_id","data_class_id","hold_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_legal_hold_head_tenant_idx" ON "inbox_v2_data_governance_legal_hold_heads" USING btree ("tenant_id","state","head_revision","hold_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_legal_hold_state_idx" ON "inbox_v2_data_governance_legal_hold_revisions" USING btree ("tenant_id","state","review_at","hold_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_hold_lookup_idx" ON "inbox_v2_data_governance_legal_hold_targets" USING btree ("tenant_id","storage_root_id","entity_type_id","entity_id","state","hold_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_handlers_kind_idx" ON "inbox_v2_data_governance_lifecycle_handlers" USING btree ("registry_id","registry_revision","kind","handler_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_purpose_instance_tenant_idx" ON "inbox_v2_data_governance_lifecycle_purpose_instances" USING btree ("tenant_id","purpose_id","anchor_at","purpose_set_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_purpose_set_target_idx" ON "inbox_v2_data_governance_lifecycle_purpose_sets" USING btree ("tenant_id","storage_root_id","root_record_id","revision" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_operated_attempt_tenant_idx" ON "inbox_v2_data_governance_operated_checkpoint_attempts" USING btree ("tenant_id","run_id","run_revision","checkpoint_id","attempt" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_operated_head_tenant_idx" ON "inbox_v2_data_governance_operated_checkpoint_heads" USING btree ("tenant_id","run_id","current_outcome","checkpoint_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_activation_head_tenant_idx" ON "inbox_v2_data_governance_policy_activation_heads" USING btree ("tenant_id","head_revision","policy_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_activation_tenant_idx" ON "inbox_v2_data_governance_policy_activations" USING btree ("tenant_id","policy_id","activated_at" DESC NULLS LAST,"activation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_template_rules_class_unique" ON "inbox_v2_data_governance_policy_template_rules" USING btree ("template_id","template_revision","data_class_id","purpose_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_template_rules_lookup_idx" ON "inbox_v2_data_governance_policy_template_rules" USING btree ("data_class_id","purpose_id","template_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_templates_profile_idx" ON "inbox_v2_data_governance_policy_templates" USING btree ("deployment_profile","effective_at" DESC NULLS LAST,"template_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_privacy_alias_tenant_idx" ON "inbox_v2_data_governance_privacy_request_aliases" USING btree ("tenant_id","subject_kind","subject_reference_key","request_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_privacy_head_tenant_idx" ON "inbox_v2_data_governance_privacy_request_heads" USING btree ("tenant_id","current_state","head_revision","request_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_privacy_request_tenant_idx" ON "inbox_v2_data_governance_privacy_request_revisions" USING btree ("tenant_id","state","due_at","request_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_registry_active_idx" ON "inbox_v2_data_governance_registry_versions" USING btree ("activated_at" DESC NULLS LAST,"id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_restore_head_open_source_unique" ON "inbox_v2_data_governance_restore_heads" USING btree ("tenant_id","ledger_id","source_erasure_entry_hash") WHERE "inbox_v2_data_governance_restore_heads"."state" = 'open';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_restore_head_seal_unique" ON "inbox_v2_data_governance_restore_heads" USING btree ("tenant_id","ledger_id","sealed_entry_hash") WHERE "inbox_v2_data_governance_restore_heads"."sealed_entry_hash" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_restore_head_target_idx" ON "inbox_v2_data_governance_restore_heads" USING btree ("tenant_id","storage_root_id","data_class_id","entity_type_id","entity_id","state");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_restore_lease_token_unique" ON "inbox_v2_data_governance_restore_leases" USING btree ("tenant_id","lease_token_hash");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_restore_lease_state_idx" ON "inbox_v2_data_governance_restore_leases" USING btree ("tenant_id","state","lease_expires_at","restore_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_dg_restore_required_source_unique" ON "inbox_v2_data_governance_restore_required_controls" USING btree ("tenant_id","ledger_id","restore_id","source_control_entry_hash");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_restore_required_control_idx" ON "inbox_v2_data_governance_restore_required_controls" USING btree ("tenant_id","control_kind","control_id","control_revision","restore_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_restriction_head_tenant_idx" ON "inbox_v2_data_governance_restriction_heads" USING btree ("tenant_id","state","head_revision","restriction_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_restriction_state_idx" ON "inbox_v2_data_governance_restriction_revisions" USING btree ("tenant_id","state","review_at","restriction_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_scope_root_entity_idx" ON "inbox_v2_data_governance_scope_manifest_roots" USING btree ("tenant_id","storage_root_id","entity_type_id","entity_id","manifest_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_scope_root_class_idx" ON "inbox_v2_data_governance_scope_manifest_roots" USING btree ("tenant_id","data_class_id","copy_role","manifest_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_scope_manifest_tenant_idx" ON "inbox_v2_data_governance_scope_manifests" USING btree ("tenant_id","kind","frozen_at" DESC NULLS LAST,"manifest_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_storage_roots_kind_idx" ON "inbox_v2_data_governance_storage_roots" USING btree ("registry_id","registry_revision","kind","storage_root_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_subject_link_root_idx" ON "inbox_v2_data_governance_subject_links" USING btree ("tenant_id","storage_root_id","root_record_id","role");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_subject_link_subject_idx" ON "inbox_v2_data_governance_subject_links" USING btree ("tenant_id","subject_kind","employee_id","client_contact_id","source_external_identity_id","account_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_tenant_term_scope_authority_tenant_idx" ON "inbox_v2_data_governance_tenant_termination_scope_authorities" USING btree ("tenant_id","manifest_revision" DESC NULLS LAST,"manifest_id");
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
--> statement-breakpoint
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
