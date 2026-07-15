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
