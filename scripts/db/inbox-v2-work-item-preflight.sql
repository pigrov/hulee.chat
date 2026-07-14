-- INBOX_V2_WORK_ITEM_PREFLIGHT_V1
do $inbox_v2_work_item_preflight$
begin
  if to_regclass('public.inbox_v2_conversations') is null
    or to_regclass('public.inbox_v2_conversation_heads') is null
    or to_regclass('public.employees') is null
    or to_regclass('public.work_queues') is null
    or to_regclass('public.teams') is null
    or to_regclass('public.org_units') is null
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.work_item_foundation_missing',
      detail = 'INB2-DB-004 requires the finalized Inbox V2 conversation and tenant-resource foundation.';
  end if;

  if exists (
    select 1
    from pg_catalog.pg_class object_class
    inner join pg_catalog.pg_namespace object_namespace
      on object_namespace.oid = object_class.relnamespace
    where object_namespace.nspname = 'public'
      and (
        object_class.relname like 'inbox_v2_work\_%' escape '\'
        or object_class.relname like 'inbox_v2_conversation_work_item\_%' escape '\'
        or object_class.relname like 'inbox_v2_employee_assignment\_%' escape '\'
      )
  ) or exists (
    select 1
    from pg_catalog.pg_type object_type
    inner join pg_catalog.pg_namespace object_namespace
      on object_namespace.oid = object_type.typnamespace
    where object_namespace.nspname = 'public'
      and (
        object_type.typname like 'inbox_v2_work\_%' escape '\'
        or object_type.typname like 'inbox_v2_employee_assignment\_%' escape '\'
      )
  ) or exists (
    select 1
    from pg_catalog.pg_constraint parent_constraint
    inner join pg_catalog.pg_class parent_table
      on parent_table.oid = parent_constraint.conrelid
    inner join pg_catalog.pg_namespace parent_namespace
      on parent_namespace.oid = parent_table.relnamespace
    where parent_namespace.nspname = 'public'
      and parent_constraint.conname in (
      'org_units_tenant_id_unique',
      'teams_tenant_id_unique',
      'work_queues_tenant_id_unique'
    )
  )
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.work_item_partial_schema_detected',
      detail = 'Refusing to apply DB-004 over a partial or unmanaged WorkItem schema.';
  end if;
end;
$inbox_v2_work_item_preflight$;
