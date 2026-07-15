-- INBOX_V2_SECURITY_DENIAL_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'inbox_v2_auth_command_records',
      'inbox_v2_auth_audit_events',
      'inbox_v2_auth_mutation_commits',
      'inbox_v2_tenant_stream_heads'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.security_denial_foundation_missing',
      detail = 'Missing finalized 0034 anchor: ' || missing_anchor;
  end if;

  select anchor_name
    into missing_anchor
    from (
      select 'constraint:inbox_v2_auth_command_records_pk' as anchor_name
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_command_records'::regclass
            and conname = 'inbox_v2_auth_command_records_pk'
       )
      union all
      select 'constraint:inbox_v2_auth_audit_events_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_audit_events'::regclass
            and conname = 'inbox_v2_auth_audit_events_pk'
       )
      union all
      select 'constraint:inbox_v2_auth_mutation_commits_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_mutation_commits'::regclass
            and conname = 'inbox_v2_auth_mutation_commits_pk'
       )
      union all
      select 'constraint:inbox_v2_tenant_stream_heads_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_tenant_stream_heads'::regclass
            and conname = 'inbox_v2_tenant_stream_heads_pk'
       )
      union all
      select 'function:inbox_v2_auth_mutation_coherence'
       where to_regprocedure(
         'public.inbox_v2_auth_mutation_coherence()'
       ) is null
      union all
      select 'trigger:inbox_v2_auth_mutation_commit_coherence'
       where not exists (
         select 1
           from pg_catalog.pg_trigger trigger_definition
           join pg_catalog.pg_proc function_definition
             on function_definition.oid = trigger_definition.tgfoid
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = function_definition.pronamespace
          where trigger_definition.tgrelid =
            'public.inbox_v2_auth_mutation_commits'::regclass
            and trigger_definition.tgname =
              'inbox_v2_auth_mutation_commit_coherence'
            and not trigger_definition.tgisinternal
            and trigger_definition.tgdeferrable
            and trigger_definition.tginitdeferred
            and function_namespace.nspname = 'public'
            and function_definition.proname =
              'inbox_v2_auth_mutation_coherence'
       )
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.security_denial_foundation_missing',
      detail = 'Missing finalized 0034 constraint/function/trigger: ' ||
        missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'table:' || table_name as object_name
        from unnest(array[
          -- RBAC007_PARTIAL_TABLES_BEGIN
          'inbox_v2_security_denial_window_shards',
          'inbox_v2_security_denial_buckets',
          'inbox_v2_security_denial_review_signals'
          -- RBAC007_PARTIAL_TABLES_END
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          -- RBAC007_PARTIAL_TYPES_BEGIN
          'inbox_v2_security_denial_action',
          'inbox_v2_security_denial_principal_class',
          'inbox_v2_security_denial_kind',
          'inbox_v2_security_denial_public_error_class',
          'inbox_v2_security_denial_risk',
          'inbox_v2_security_denial_review_type',
          'inbox_v2_security_denial_alert_type',
          'inbox_v2_security_denial_disposition',
          'inbox_v2_security_denial_review_disposition',
          'inbox_v2_security_denial_review_aggregation_kind',
          'inbox_v2_security_denial_review_status'
          -- RBAC007_PARTIAL_TYPES_END
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
          -- RBAC007_PARTIAL_FUNCTIONS_BEGIN
          'inbox_v2_security_denial_record',
          'inbox_v2_security_denial_prune',
          'inbox_v2_security_denial_integrity_guard'
          -- RBAC007_PARTIAL_FUNCTIONS_END
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
      message = 'inbox_v2.security_denial_partial_schema_detected',
      detail = 'Unexpected pre-existing RBAC-007 object: ' || partial_object;
  end if;
end;
$preflight$;
