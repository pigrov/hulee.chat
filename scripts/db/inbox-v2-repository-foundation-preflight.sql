-- INBOX_V2_REPOSITORY_FOUNDATION_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'accounts',
      'employees',
      'inbox_v2_conversations',
      'inbox_v2_conversation_participants',
      'inbox_v2_conversation_membership_heads',
      'inbox_v2_conversation_membership_commits',
      'inbox_v2_participant_membership_episodes',
      'inbox_v2_participant_membership_transitions',
      'inbox_v2_tenant_stream_heads',
      'inbox_v2_tenant_stream_commits',
      'inbox_v2_tenant_stream_changes',
      'inbox_v2_domain_events',
      'inbox_v2_outbox_intents',
      'inbox_v2_data_governance_subject_links'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.repository_foundation_missing',
      detail = 'Missing finalized Inbox V2 anchor: ' || missing_anchor;
  end if;

  if not exists (
    select 1
      from pg_catalog.pg_trigger trigger_definition
     where trigger_definition.tgrelid =
           'public.inbox_v2_tenant_stream_changes'::regclass
       and trigger_definition.tgname =
           'inbox_v2_auth_immutable_dbcc9ea93cbd94ba'
       and not trigger_definition.tgisinternal
       and trigger_definition.tgenabled = 'O'
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.repository_foundation_missing',
      detail = 'Missing enabled immutable stream-change trigger required by the guarded tombstone backfill.';
  end if;

  if exists (
    select 1
      from public.inbox_v2_data_governance_subject_links subject_link
      join public.accounts account_row
        on account_row.id = subject_link.account_id
     where subject_link.account_id is not null
       and account_row.tenant_id <> subject_link.tenant_id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.repository_cross_tenant_account_link',
      detail = 'Subject-link account ownership must be repaired before DB-007.';
  end if;

  if exists (
    select 1
      from (
        select change_row.tenant_id,
               change_row.stream_commit_id,
               change_row.mutation_id,
               change_row.stream_position
          from public.inbox_v2_tenant_stream_changes change_row
        union all
        select event_row.tenant_id,
               event_row.stream_commit_id,
               event_row.mutation_id,
               event_row.stream_position
          from public.inbox_v2_domain_events event_row
        union all
        select intent_row.tenant_id,
               intent_row.stream_commit_id,
               intent_row.mutation_id,
               intent_row.stream_position
          from public.inbox_v2_outbox_intents intent_row
      ) child_row
      left join public.inbox_v2_tenant_stream_commits commit_row
        on commit_row.tenant_id = child_row.tenant_id
       and commit_row.id = child_row.stream_commit_id
       and commit_row.mutation_id = child_row.mutation_id
       and commit_row.position = child_row.stream_position
     where commit_row.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.repository_stream_child_position_incoherent',
      detail = 'Stream children must reference the exact tenant commit position.';
  end if;

  select object_name
    into partial_object
    from (
      select 'table:' || table_name as object_name
        from unnest(array[
          'inbox_v2_projection_generations',
          'inbox_v2_projection_heads',
          'inbox_v2_projection_checkpoints',
          'inbox_v2_outbox_work_items',
          'inbox_v2_outbox_outcomes',
          'inbox_v2_tenant_stream_retention_advances'
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          'inbox_v2_projection_generation_state',
          'inbox_v2_outbox_work_state',
          'inbox_v2_outbox_outcome_kind'
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
      select 'column:inbox_v2_tenant_stream_changes.state_reason_id'
       where exists (
         select 1
           from pg_catalog.pg_attribute attribute_definition
          where attribute_definition.attrelid =
                'public.inbox_v2_tenant_stream_changes'::regclass
            and attribute_definition.attname = 'state_reason_id'
            and attribute_definition.attnum > 0
            and not attribute_definition.attisdropped
       )
      union all
      select 'constraint:' || constraint_name
        from unnest(array[
          'accounts_tenant_id_unique',
          'inbox_v2_tenant_stream_commits_checkpoint_unique',
          'inbox_v2_tenant_stream_commits_identity_position_unique'
        ]::text[]) as expected_constraint(constraint_name)
       where exists (
         select 1
           from pg_catalog.pg_constraint constraint_definition
          where constraint_definition.conname =
                expected_constraint.constraint_name
       )
      union all
      select 'index:' || index_name
        from unnest(array[
          'inbox_v2_auth_collaborator_employee_conversation_idx',
          'inbox_v2_auth_collaborator_employee_work_item_idx',
          'inbox_v2_auth_structural_heads_conversation_org_actor_idx',
          'inbox_v2_auth_structural_heads_conversation_team_actor_idx',
          'inbox_v2_dg_hold_active_root_lookup_idx',
          'inbox_v2_participant_membership_internal_actor_idx',
          'inbox_v2_timeline_contents_retention_eligible_idx',
          'inbox_v2_work_item_primary_assignment_employee_active_idx'
        ]::text[]) as expected_index(index_name)
       where to_regclass('public.' || expected_index.index_name) is not null
      union all
      select 'function:' || function_name
        from unnest(array[
          'inbox_v2_advance_tenant_stream_retained_prefix_v1',
          'inbox_v2_repository_projection_checkpoint_guard',
          'inbox_v2_repository_projection_head_coherence',
          'inbox_v2_repository_outbox_intent_work_init',
          'inbox_v2_repository_outbox_work_guard',
          'inbox_v2_repository_outbox_finalize_coherence',
          'inbox_v2_repository_outbox_outcome_immutable',
          'inbox_v2_repository_retention_advance_immutable',
          'inbox_v2_lock_conversation_membership_head_v1',
          'inbox_v2_lock_participant_membership_mutation_v1',
          'inbox_v2_apply_participant_membership_mutation_v1'
        ]::text[]) as expected_function(function_name)
       where exists (
         select 1
           from pg_catalog.pg_proc function_definition
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = function_definition.pronamespace
          where function_namespace.nspname = 'public'
            and function_definition.proname = expected_function.function_name
       )
    ) partial_objects
   order by object_name
   limit 1;

  if partial_object is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.repository_foundation_partial_schema_detected',
      detail = 'Unexpected pre-existing DB-007 object: ' || partial_object;
  end if;
end;
$preflight$;
