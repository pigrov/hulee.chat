-- INBOX_V2_CONVERSATION_TIMELINE_HEAD_PREFLIGHT_V1
do $preflight$
declare
  missing_relation text;
begin
  foreach missing_relation in array array[
    'public.tenants',
    'public.inbox_v2_conversations',
    'public.inbox_v2_conversation_heads',
    'public.inbox_v2_timeline_items'
  ] loop
    if to_regclass(missing_relation) is null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_preflight_missing_relation',
        detail = missing_relation;
    end if;
  end loop;

  if to_regprocedure('public.inbox_v2_tm_core_coherence()') is null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_preflight_missing_foundation';
  end if;
end;
$preflight$;

lock table
  public.inbox_v2_conversations,
  public.inbox_v2_conversation_heads,
  public.inbox_v2_timeline_items
in share row exclusive mode;

do $validation$
declare
  existing_target_trigger_count integer;
begin
  select count(*)::integer
    into existing_target_trigger_count
    from pg_catalog.pg_trigger trigger_row
    join pg_catalog.pg_class relation_row
      on relation_row.oid = trigger_row.tgrelid
    join pg_catalog.pg_namespace namespace_row
      on namespace_row.oid = relation_row.relnamespace
   where namespace_row.nspname = 'public'
     and not trigger_row.tgisinternal
     and trigger_row.tgname in (
       'inbox_v2_conversations_insert_guard_trigger',
       'inbox_v2_conversations_update_guard_trigger',
       'inbox_v2_conversations_delete_guard_trigger',
       'inbox_v2_conversation_heads_insert_guard_trigger',
       'inbox_v2_conversation_heads_update_guard_trigger',
       'inbox_v2_conversation_heads_delete_guard_trigger',
       'inbox_v2_conversation_identity_fences_guard_trigger',
       'inbox_v2_conversations_truncate_guard_trigger',
       'inbox_v2_conversation_heads_truncate_guard_trigger',
       'inbox_v2_timeline_items_truncate_guard_trigger',
       'inbox_v2_conversation_identity_fences_truncate_guard_trigger',
       'inbox_v2_conversation_identity_fence_coherence_trigger',
       'inbox_v2_conversations_timeline_head_constraint_trigger',
       'inbox_v2_conversation_heads_timeline_constraint_trigger'
     );

  if existing_target_trigger_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_preflight_partial_target';
  end if;

  if exists (
    select 1
      from public.inbox_v2_conversations conversation_row
      full join public.inbox_v2_conversation_heads head_row
        on head_row.tenant_id = conversation_row.tenant_id
       and head_row.conversation_id = conversation_row.id
     where conversation_row.id is null
        or head_row.conversation_id is null
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_preflight_missing_head';
  end if;

  if exists (
    select 1
      from public.inbox_v2_conversation_heads head_row
      left join lateral (
        select count(*)::bigint as item_count,
               coalesce(max(item_row.timeline_sequence), 0) as maximum_sequence
          from public.inbox_v2_timeline_items item_row
         where item_row.tenant_id = head_row.tenant_id
           and item_row.conversation_id = head_row.conversation_id
      ) timeline_summary on true
      left join lateral (
        select item_row.id,
               item_row.timeline_sequence,
               item_row.occurred_at
          from public.inbox_v2_timeline_items item_row
         where item_row.tenant_id = head_row.tenant_id
           and item_row.conversation_id = head_row.conversation_id
           and item_row.activity_kind = 'eligible'
         order by item_row.timeline_sequence desc
         limit 1
      ) latest_activity on true
     where head_row.latest_timeline_sequence <>
             timeline_summary.maximum_sequence
        or head_row.latest_timeline_sequence <> timeline_summary.item_count
        or head_row.latest_activity_item_id is distinct from latest_activity.id
        or head_row.latest_activity_timeline_sequence is distinct from
             latest_activity.timeline_sequence
        or head_row.latest_activity_at is distinct from latest_activity.occurred_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_preflight_incoherent';
  end if;
end;
$validation$;
