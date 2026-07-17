-- INBOX_V2_AUTHORIZATION_RELATIONS_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'employees',
      'org_units',
      'teams',
      'work_queues',
      'clients',
      'source_accounts',
      'inbox_v2_conversations',
      'inbox_v2_work_items',
      'inbox_v2_work_item_sla_snapshots',
      'inbox_v2_work_item_creation_decisions',
      'inbox_v2_work_item_primary_assignments',
      'inbox_v2_work_item_servicing_team_episodes',
      'inbox_v2_participant_membership_transitions',
      'inbox_v2_work_item_transitions',
      'inbox_v2_work_item_relation_transitions',
      'inbox_v2_employee_conversation_states',
      'inbox_v2_data_governance_deletion_runs'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relations_foundation_missing',
      detail = 'Missing finalized 0033 anchor: ' || missing_anchor;
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
      select 'constraint:org_units_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.org_units'::regclass
            and conname = 'org_units_tenant_id_unique'
       )
      union all
      select 'constraint:teams_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.teams'::regclass
            and conname = 'teams_tenant_id_unique'
       )
      union all
      select 'constraint:work_queues_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.work_queues'::regclass
            and conname = 'work_queues_tenant_id_unique'
       )
      union all
      select 'constraint:clients_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.clients'::regclass
            and conname = 'clients_tenant_id_unique'
       )
      union all
      select 'constraint:source_accounts_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.source_accounts'::regclass
            and conname = 'source_accounts_tenant_id_unique'
       )
      union all
      select 'constraint:inbox_v2_conversations_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_conversations'::regclass
            and conname = 'inbox_v2_conversations_pk'
       )
      union all
      select 'constraint:inbox_v2_work_items_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_work_items'::regclass
            and conname = 'inbox_v2_work_items_pk'
       )
      union all
      select 'constraint:inbox_v2_participant_membership_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_participant_membership_transitions'::regclass
            and conname = 'inbox_v2_participant_membership_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_work_item_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_work_item_transitions'::regclass
            and conname = 'inbox_v2_work_item_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_work_item_relation_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_work_item_relation_transitions'::regclass
            and conname = 'inbox_v2_work_item_relation_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_dg_deletion_run_plan_anchor_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_data_governance_deletion_runs'::regclass
            and conname = 'inbox_v2_dg_deletion_run_plan_anchor_unique'
       )
      union all
      select 'trigger:inbox_v2_participant_membership_transitions_guard_insert_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_participant_membership_transitions'::regclass
            and tgname =
              'inbox_v2_participant_membership_transitions_guard_insert_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_work_item_transitions_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid = 'public.inbox_v2_work_item_transitions'::regclass
            and tgname = 'inbox_v2_work_item_transitions_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_work_item_relation_transitions_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_work_item_relation_transitions'::regclass
            and tgname = 'inbox_v2_work_item_relation_transitions_guard_trigger'
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
      union all
      select 'trigger:inbox_v2_dg_deletion_run_transition_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_data_governance_deletion_runs'::regclass
            and tgname =
              'inbox_v2_dg_deletion_run_transition_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:' || expected_trigger.trigger_name
        from (values
          -- RBAC003_FOUNDATION_TRIGGERS_BEGIN
          (
            'inbox_v2_work_item_mutation_coherence_constraint',
            'inbox_v2_work_items',
            'inbox_v2_work_item_mutation_coherence',
            17
          ),
          (
            'inbox_v2_work_items_aggregate_constraint',
            'inbox_v2_work_items',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_sla_aggregate_constraint',
            'inbox_v2_work_item_sla_snapshots',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_creation_aggregate_constraint',
            'inbox_v2_work_item_creation_decisions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_assignment_aggregate_constraint',
            'inbox_v2_work_item_primary_assignments',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_transition_aggregate_constraint',
            'inbox_v2_work_item_transitions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_team_episode_aggregate_constraint',
            'inbox_v2_work_item_servicing_team_episodes',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_relation_transition_aggregate_constraint',
            'inbox_v2_work_item_relation_transitions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          )
          -- RBAC003_FOUNDATION_TRIGGERS_END
        ) as expected_trigger(
          trigger_name,
          table_name,
          function_name,
          trigger_type
        )
        left join pg_catalog.pg_trigger trigger_definition
          on trigger_definition.tgrelid =
            ('public.' || expected_trigger.table_name)::regclass
          and trigger_definition.tgname = expected_trigger.trigger_name
        left join pg_catalog.pg_proc function_definition
          on function_definition.oid = trigger_definition.tgfoid
        left join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = function_definition.pronamespace
        left join pg_catalog.pg_constraint trigger_constraint
          on trigger_constraint.oid = trigger_definition.tgconstraint
       where trigger_definition.oid is null
          or trigger_definition.tgisinternal is distinct from false
          or trigger_definition.tgenabled is distinct from 'O'
          or trigger_definition.tgtype is distinct from
            expected_trigger.trigger_type::smallint
          or trigger_definition.tgdeferrable is distinct from true
          or trigger_definition.tginitdeferred is distinct from true
          or function_namespace.nspname is distinct from 'public'
          or function_definition.proname is distinct from
            expected_trigger.function_name
          or trigger_constraint.oid is null
          or trigger_constraint.contype is distinct from 't'
          or trigger_constraint.conrelid is distinct from
            ('public.' || expected_trigger.table_name)::regclass
          or trigger_constraint.condeferrable is distinct from true
          or trigger_constraint.condeferred is distinct from true
      union all
      select 'function:' || function_name
        from unnest(array[
          -- RBAC003_FOUNDATION_FUNCTIONS_BEGIN
          'inbox_v2_work_item_aggregate_coherence',
          'inbox_v2_work_item_mutation_coherence'
          -- RBAC003_FOUNDATION_FUNCTIONS_END
        ]::text[]) as required_function(function_name)
       where to_regprocedure('public.' || required_function.function_name ||
         '()') is null
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relations_foundation_missing',
      detail = 'Missing finalized foundation constraint or trigger: ' ||
        missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'table:' || table_name as object_name
        from unnest(array[
          -- RBAC003_PARTIAL_TABLES_BEGIN
          'inbox_v2_auth_tenant_heads',
          'inbox_v2_auth_employee_heads',
          'inbox_v2_auth_role_versions',
          'inbox_v2_auth_role_version_permissions',
          'inbox_v2_auth_role_heads',
          'inbox_v2_auth_role_binding_versions',
          'inbox_v2_auth_role_binding_heads',
          'inbox_v2_auth_direct_grant_versions',
          'inbox_v2_auth_direct_grant_heads',
          'inbox_v2_auth_workforce_membership_versions',
          'inbox_v2_auth_workforce_membership_heads',
          'inbox_v2_auth_resource_heads',
          'inbox_v2_auth_structural_access_versions',
          'inbox_v2_auth_structural_access_heads',
          'inbox_v2_auth_collaborator_versions',
          'inbox_v2_auth_collaborator_heads',
          'inbox_v2_auth_command_records',
          'inbox_v2_tenant_stream_heads',
          'inbox_v2_tenant_stream_commits',
          'inbox_v2_tenant_stream_changes',
          'inbox_v2_atomic_outbound_dispatch_materializations',
          'inbox_v2_atomic_source_resolution_materializations',
          'inbox_v2_domain_events',
          'inbox_v2_outbox_intents',
          'inbox_v2_auth_audit_events',
          'inbox_v2_auth_audit_facets',
          'inbox_v2_auth_mutation_commits',
          'inbox_v2_auth_revision_effects',
          'inbox_v2_auth_relation_writes'
          -- RBAC003_PARTIAL_TABLES_END
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          -- RBAC003_PARTIAL_TYPES_BEGIN
          'inbox_v2_auth_actor_kind',
          'inbox_v2_auth_record_state',
          'inbox_v2_auth_binding_subject_kind',
          'inbox_v2_auth_scope_kind',
          'inbox_v2_auth_org_unit_mode',
          'inbox_v2_auth_workforce_membership_kind',
          'inbox_v2_auth_structural_resource_kind',
          'inbox_v2_auth_structural_target_kind',
          'inbox_v2_auth_collaborator_resource_kind',
          'inbox_v2_auth_command_state',
          'inbox_v2_audience_impact_kind',
          'inbox_v2_tenant_stream_audience',
          'inbox_v2_domain_event_access_effect',
          'inbox_v2_outbox_intent_effect_class',
          'inbox_v2_auth_audit_facet_kind',
          'inbox_v2_auth_revision_effect_kind',
          'inbox_v2_auth_relation_kind'
          -- RBAC003_PARTIAL_TYPES_END
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
          -- RBAC003_PARTIAL_FUNCTIONS_BEGIN
          'inbox_v2_auth_reject_immutable',
          'inbox_v2_auth_json_tenant_safe',
          'inbox_v2_auth_catalog_id_safe',
          'inbox_v2_auth_payload_reference_safe',
          'inbox_v2_auth_invalidations_safe',
          'inbox_v2_auth_decision_refs_safe',
          'inbox_v2_auth_audit_identifier_guard',
          'inbox_v2_auth_relation_version_guard',
          'inbox_v2_auth_head_guard',
          'inbox_v2_auth_command_guard',
          'inbox_v2_auth_stream_head_guard',
          'inbox_v2_auth_role_permission_coherence',
          'inbox_v2_auth_head_commit_coherence',
          'inbox_v2_auth_relation_version_commit_coherence',
          'inbox_v2_auth_command_commit_coherence',
          'inbox_v2_auth_mutation_coherence',
          'inbox_v2_auth_mutation_child_coherence'
          -- RBAC003_PARTIAL_FUNCTIONS_END
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
          -- RBAC003_PARTIAL_TRIGGERS_BEGIN
          'inbox_v2_auth_role_version_insert_guard',
          'inbox_v2_auth_binding_version_insert_guard',
          'inbox_v2_auth_grant_version_insert_guard',
          'inbox_v2_auth_workforce_version_insert_guard',
          'inbox_v2_auth_structural_version_insert_guard',
          'inbox_v2_auth_collaborator_version_insert_guard',
          'inbox_v2_auth_role_version_commit_coherence',
          'inbox_v2_auth_binding_version_commit_coherence',
          'inbox_v2_auth_grant_version_commit_coherence',
          'inbox_v2_auth_workforce_version_commit_coherence',
          'inbox_v2_auth_structural_version_commit_coherence',
          'inbox_v2_auth_collaborator_version_commit_coherence',
          'inbox_v2_auth_tenant_head_guard',
          'inbox_v2_auth_employee_head_guard',
          'inbox_v2_auth_role_head_guard',
          'inbox_v2_auth_binding_head_guard',
          'inbox_v2_auth_grant_head_guard',
          'inbox_v2_auth_workforce_head_guard',
          'inbox_v2_auth_resource_head_guard',
          'inbox_v2_auth_structural_head_guard',
          'inbox_v2_auth_collaborator_head_guard',
          'inbox_v2_auth_tenant_head_commit_coherence',
          'inbox_v2_auth_employee_head_commit_coherence',
          'inbox_v2_auth_role_head_commit_coherence',
          'inbox_v2_auth_binding_head_commit_coherence',
          'inbox_v2_auth_grant_head_commit_coherence',
          'inbox_v2_auth_workforce_head_commit_coherence',
          'inbox_v2_auth_resource_head_commit_coherence',
          'inbox_v2_auth_structural_head_commit_coherence',
          'inbox_v2_auth_collaborator_head_commit_coherence',
          'inbox_v2_auth_command_guard_trigger',
          'inbox_v2_auth_command_commit_coherence',
          'inbox_v2_auth_audit_identifier_guard_trigger',
          'inbox_v2_tenant_stream_head_guard_trigger',
          'inbox_v2_auth_role_version_permissions_coherence',
          'inbox_v2_auth_role_permission_rows_coherence',
          'inbox_v2_auth_mutation_commit_coherence',
          'inbox_v2_auth_change_mutation_child_coherence',
          'inbox_v2_auth_event_mutation_child_coherence',
          'inbox_v2_auth_outbox_mutation_child_coherence',
          'inbox_v2_auth_facet_mutation_child_coherence',
          'inbox_v2_auth_effect_mutation_child_coherence',
          'inbox_v2_auth_relation_mutation_child_coherence',
          'inbox_v2_auth_immutable_f294fc074aec07c5',
          'inbox_v2_auth_immutable_8d3bca723658bf87',
          'inbox_v2_auth_immutable_60a4e6a91d5c5fe3',
          'inbox_v2_auth_immutable_0fd1b83dc9a02dd4',
          'inbox_v2_auth_immutable_7b4299c7591433c9',
          'inbox_v2_auth_immutable_09a11878babcde81',
          'inbox_v2_auth_immutable_4a50da517e54c1bb',
          'inbox_v2_auth_immutable_552c1165f5ed8785',
          'inbox_v2_auth_immutable_dbcc9ea93cbd94ba',
          'inbox_v2_auth_immutable_017a2961147225fb',
          'inbox_v2_auth_immutable_8af9c3f10f095491',
          'inbox_v2_auth_immutable_a724ad2579ac19a8',
          'inbox_v2_auth_immutable_b7060d104e2cd2ac',
          'inbox_v2_auth_immutable_ef02df9ab538c8e3',
          'inbox_v2_auth_immutable_ff0a2efcdb94dda8',
          'inbox_v2_auth_immutable_d4633dd6133275ae'
          -- RBAC003_PARTIAL_TRIGGERS_END
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
      message = 'inbox_v2.authorization_relations_partial_schema_detected',
      detail = 'Unexpected pre-existing RBAC-003 object: ' || partial_object;
  end if;
end;
$preflight$;
