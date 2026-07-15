-- INBOX_V2_EMPLOYEE_CONVERSATION_STATE_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'employees',
      'inbox_v2_conversations',
      'inbox_v2_conversation_heads',
      'inbox_v2_timeline_items',
      'inbox_v2_provider_receipt_observations'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_foundation_missing',
      detail = 'Missing finalized 0031 anchor: ' || missing_anchor;
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
      select 'constraint:inbox_v2_conversations_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_conversations'::regclass
            and conname = 'inbox_v2_conversations_pk'
       )
      union all
      select 'constraint:inbox_v2_timeline_items_sequence_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_timeline_items'::regclass
            and conname = 'inbox_v2_timeline_items_sequence_unique'
       )
      union all
      select 'trigger:inbox_v2_tm_timeline_coherence'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid = 'public.inbox_v2_timeline_items'::regclass
            and tgname = 'inbox_v2_tm_timeline_coherence'
            and not tgisinternal
       )
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_foundation_missing',
      detail = 'Missing finalized 0031 constraint or trigger: ' || missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'table:inbox_v2_employee_conversation_states' as object_name
       where to_regclass(
         'public.inbox_v2_employee_conversation_states'
       ) is not null
      union all
      select 'type:inbox_v2_employee_conversation_notification_level'
       where exists (
         select 1
           from pg_catalog.pg_type type_definition
           join pg_catalog.pg_namespace type_namespace
             on type_namespace.oid = type_definition.typnamespace
          where type_namespace.nspname = 'public'
            and type_definition.typname =
              'inbox_v2_employee_conversation_notification_level'
       )
      union all
      select 'function:' || function_definition.proname
        from pg_catalog.pg_proc function_definition
        join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = function_definition.pronamespace
       where function_namespace.nspname = 'public'
         and function_definition.proname like 'inbox_v2_ecs\_%' escape '\'
      union all
      select 'trigger:' || trigger_definition.tgname
        from pg_catalog.pg_trigger trigger_definition
        join pg_catalog.pg_class trigger_table
          on trigger_table.oid = trigger_definition.tgrelid
        join pg_catalog.pg_namespace trigger_namespace
          on trigger_namespace.oid = trigger_table.relnamespace
       where trigger_namespace.nspname = 'public'
         and trigger_definition.tgname like 'inbox_v2_ecs\_%' escape '\'
         and not trigger_definition.tgisinternal
    ) partial_objects
   order by object_name
   limit 1;

  if partial_object is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_partial_schema_detected',
      detail = 'Unexpected pre-existing DB-006 object: ' || partial_object;
  end if;
end;
$preflight$;
