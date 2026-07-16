-- INBOX_V2_CONVERSATION_TIMELINE_HEAD_MIGRATION_FINALIZED_V1
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
--> statement-breakpoint
CREATE TABLE "inbox_v2_conversation_identity_fences" (
	"tenant_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"retired_revision" bigint NOT NULL,
	"retired_stream_position" bigint NOT NULL,
	"retired_updated_at" timestamp (3) with time zone NOT NULL,
	"retired_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_v2_conversation_identity_fences_pk" PRIMARY KEY("tenant_id","conversation_id"),
	CONSTRAINT "inbox_v2_conversation_identity_fences_values_check" CHECK ("inbox_v2_conversation_identity_fences"."retired_revision" >= 1
        and "inbox_v2_conversation_identity_fences"."retired_stream_position" >= 1
        and isfinite("inbox_v2_conversation_identity_fences"."retired_updated_at")
        and isfinite("inbox_v2_conversation_identity_fences"."retired_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_conversation_identity_fences" ADD CONSTRAINT "inbox_v2_conversation_identity_fences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_conversation_identity_fences_tenant_retired_idx" ON "inbox_v2_conversation_identity_fences" USING btree ("tenant_id","retired_at","conversation_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_items_eligible_activity_tail_idx" ON "inbox_v2_timeline_items" USING btree ("tenant_id","conversation_id","timeline_sequence" DESC NULLS LAST,"id","occurred_at") WHERE "inbox_v2_timeline_items"."activity_kind" = 'eligible';
--> statement-breakpoint
create or replace function public.inbox_v2_assert_conversation_timeline_head(
  checked_tenant_id text,
  checked_conversation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  conversation_count integer;
  matching_head_count integer;
  latest_activity record;
begin
  if checked_tenant_id is null or checked_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_key_missing';
  end if;

  if not exists (
    select 1
      from public.tenants tenant_row
     where tenant_row.id = checked_tenant_id
  ) then
    return;
  end if;

  select count(*)::integer
    into conversation_count
    from public.inbox_v2_conversations conversation_row
   where conversation_row.tenant_id = checked_tenant_id
     and conversation_row.id = checked_conversation_id;

  if conversation_count = 0 then
    if exists (
      select 1
        from public.inbox_v2_conversation_heads head_row
       where head_row.tenant_id = checked_tenant_id
         and head_row.conversation_id = checked_conversation_id
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_orphaned';
    end if;
    return;
  end if;

  if exists (
    select 1
      from public.inbox_v2_conversation_identity_fences fence_row
     where fence_row.tenant_id = checked_tenant_id
       and fence_row.conversation_id = checked_conversation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_identity_retired';
  end if;

  select item_row.id, item_row.timeline_sequence, item_row.occurred_at
    into latest_activity
    from public.inbox_v2_timeline_items item_row
   where item_row.tenant_id = checked_tenant_id
     and item_row.conversation_id = checked_conversation_id
     and item_row.activity_kind = 'eligible'
   order by item_row.timeline_sequence desc
   limit 1;

  select count(*)::integer
    into matching_head_count
    from public.inbox_v2_conversation_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id
     and head_row.latest_timeline_sequence = coalesce((
       select max(item_row.timeline_sequence)
         from public.inbox_v2_timeline_items item_row
        where item_row.tenant_id = checked_tenant_id
          and item_row.conversation_id = checked_conversation_id
     ), 0)
     and (
       (latest_activity.id is null
         and head_row.latest_activity_item_id is null
         and head_row.latest_activity_timeline_sequence is null
         and head_row.latest_activity_at is null)
       or (latest_activity.id is not null
         and head_row.latest_activity_item_id = latest_activity.id
         and head_row.latest_activity_timeline_sequence =
           latest_activity.timeline_sequence
         and head_row.latest_activity_at = latest_activity.occurred_at)
     );

  if matching_head_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_coherence';
  end if;
end;
$function$;

create or replace function public.inbox_v2_lock_conversation_identity(
  checked_tenant_id text,
  checked_conversation_id text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if checked_tenant_id is null or checked_conversation_id is null then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_identity_lock_key_missing';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtext(checked_tenant_id),
    pg_catalog.hashtext(checked_conversation_id)
  );
end;
$function$;

create or replace function public.inbox_v2_conversation_timeline_head_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  changed_tenant_id text;
  changed_conversation_id text;
  old_sequence bigint;
  new_sequence bigint;
  inserted_count bigint;
  inserted_minimum bigint;
  inserted_maximum bigint;
begin
  changed_row := case
    when tg_op = 'DELETE' then to_jsonb(old)
    else to_jsonb(new)
  end;
  changed_tenant_id := changed_row->>'tenant_id';
  changed_conversation_id := coalesce(
    changed_row->>'conversation_id',
    changed_row->>'id'
  );

  if tg_op = 'DELETE' then
    if tg_table_name = 'inbox_v2_conversations'
       and exists (
         select 1
           from public.inbox_v2_conversations conversation_row
          where conversation_row.tenant_id = changed_tenant_id
            and conversation_row.id = changed_conversation_id
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_identity_reused';
    end if;

    if tg_table_name = 'inbox_v2_conversation_heads'
       and exists (
         select 1
           from public.inbox_v2_conversation_heads head_row
          where head_row.tenant_id = changed_tenant_id
            and head_row.conversation_id = changed_conversation_id
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_identity_reused';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_conversation_heads'
     and tg_op = 'UPDATE' then
    old_sequence := old.latest_timeline_sequence;
    new_sequence := new.latest_timeline_sequence;
    if new_sequence > old_sequence then
      select count(*)::bigint,
             min(item_row.timeline_sequence),
             max(item_row.timeline_sequence)
        into inserted_count, inserted_minimum, inserted_maximum
        from public.inbox_v2_timeline_items item_row
       where item_row.tenant_id = new.tenant_id
         and item_row.conversation_id = new.conversation_id
         and item_row.timeline_sequence > old_sequence
         and item_row.timeline_sequence <= new_sequence;

      if inserted_count <> new_sequence - old_sequence
         or inserted_minimum <> old_sequence + 1
         or inserted_maximum <> new_sequence then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.conversation_timeline_range_noncontiguous';
      end if;
    end if;
  end if;

  perform public.inbox_v2_assert_conversation_timeline_head(
    changed_tenant_id,
    changed_conversation_id
  );
  return null;
end;
$function$;

create or replace function public.inbox_v2_conversation_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
      from public.tenants tenant_row
     where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;

  perform public.inbox_v2_lock_conversation_identity(
    old.tenant_id,
    old.id
  );
  insert into public.inbox_v2_conversation_identity_fences (
    tenant_id,
    conversation_id,
    retired_revision,
    retired_stream_position,
    retired_updated_at,
    retired_at
  ) values (
    old.tenant_id,
    old.id,
    old.revision,
    old.last_changed_stream_position,
    old.updated_at,
    statement_timestamp()
  );
  return old;
end;
$function$;

create or replace function public.inbox_v2_conversation_insert_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform public.inbox_v2_lock_conversation_identity(
    new.tenant_id,
    new.id
  );
  if exists (
    select 1
      from public.inbox_v2_conversation_identity_fences fence_row
     where fence_row.tenant_id = new.tenant_id
       and fence_row.conversation_id = new.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_identity_retired';
  end if;

  if new.revision <> 1
     or new.created_at <> new.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_initial_revision_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_identity_fence_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    perform public.inbox_v2_lock_conversation_identity(
      new.tenant_id,
      new.conversation_id
    );
    if not exists (
      select 1
        from public.inbox_v2_conversations conversation_row
       where conversation_row.tenant_id = new.tenant_id
         and conversation_row.id = new.conversation_id
         and conversation_row.revision = new.retired_revision
         and conversation_row.last_changed_stream_position =
           new.retired_stream_position
         and conversation_row.updated_at = new.retired_updated_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.conversation_identity_fence_source_invalid';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and not exists (
    select 1
      from public.tenants tenant_row
     where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;

  perform public.inbox_v2_lock_conversation_identity(
    old.tenant_id,
    old.conversation_id
  );
  raise exception using
    errcode = '23514',
    message = 'inbox_v2.conversation_identity_fence_immutable';
end;
$function$;

create or replace function public.inbox_v2_conversation_head_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.tenants tenant_row
     where tenant_row.id = old.tenant_id
  ) and exists (
    select 1
      from public.inbox_v2_conversations conversation_row
     where conversation_row.tenant_id = old.tenant_id
       and conversation_row.id = old.conversation_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_delete_forbidden';
  end if;
  return old;
end;
$function$;

create or replace function public.inbox_v2_conversation_update_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.created_at is distinct from old.created_at
     or new.revision <= old.revision
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_revision_regressed';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_head_insert_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.revision <> 1
     or new.latest_timeline_sequence <> 0
     or num_nonnulls(
       new.latest_activity_item_id,
       new.latest_activity_timeline_sequence,
       new.latest_activity_at
     ) <> 0
     or new.created_at <> new.updated_at
     or not exists (
       select 1
         from public.inbox_v2_conversations conversation_row
        where conversation_row.tenant_id = new.tenant_id
          and conversation_row.id = new.conversation_id
          and conversation_row.last_changed_stream_position =
            new.last_changed_stream_position
          and conversation_row.created_at = new.created_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_initial_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_head_update_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.tenant_id is distinct from old.tenant_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at
     or new.latest_timeline_sequence < old.latest_timeline_sequence
     or new.revision <= old.revision
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.conversation_timeline_head_regressed';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_conversation_timeline_truncate_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using
    errcode = '23514',
    message = 'inbox_v2.conversation_timeline_truncate_forbidden';
end;
$function$;

create trigger inbox_v2_conversations_insert_guard_trigger
before insert on public.inbox_v2_conversations
for each row execute function public.inbox_v2_conversation_insert_guard();

create trigger inbox_v2_conversations_update_guard_trigger
before update on public.inbox_v2_conversations
for each row execute function public.inbox_v2_conversation_update_guard();

create trigger inbox_v2_conversations_delete_guard_trigger
before delete on public.inbox_v2_conversations
for each row execute function public.inbox_v2_conversation_delete_guard();

create trigger inbox_v2_conversation_heads_insert_guard_trigger
before insert on public.inbox_v2_conversation_heads
for each row execute function public.inbox_v2_conversation_head_insert_guard();

create trigger inbox_v2_conversation_heads_update_guard_trigger
before update on public.inbox_v2_conversation_heads
for each row execute function public.inbox_v2_conversation_head_update_guard();

create trigger inbox_v2_conversation_heads_delete_guard_trigger
before delete on public.inbox_v2_conversation_heads
for each row execute function public.inbox_v2_conversation_head_delete_guard();

create trigger inbox_v2_conversation_identity_fences_guard_trigger
before insert or update or delete on public.inbox_v2_conversation_identity_fences
for each row execute function public.inbox_v2_conversation_identity_fence_guard();

create trigger inbox_v2_conversations_truncate_guard_trigger
before truncate on public.inbox_v2_conversations
for each statement execute function public.inbox_v2_conversation_timeline_truncate_guard();

create trigger inbox_v2_conversation_heads_truncate_guard_trigger
before truncate on public.inbox_v2_conversation_heads
for each statement execute function public.inbox_v2_conversation_timeline_truncate_guard();

create trigger inbox_v2_timeline_items_truncate_guard_trigger
before truncate on public.inbox_v2_timeline_items
for each statement execute function public.inbox_v2_conversation_timeline_truncate_guard();

create trigger inbox_v2_conversation_identity_fences_truncate_guard_trigger
before truncate on public.inbox_v2_conversation_identity_fences
for each statement execute function public.inbox_v2_conversation_timeline_truncate_guard();

create constraint trigger inbox_v2_conversation_identity_fence_coherence_trigger
after insert or update or delete on public.inbox_v2_conversation_identity_fences
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_timeline_head_deferred();

create constraint trigger inbox_v2_conversations_timeline_head_constraint_trigger
after insert or update or delete on public.inbox_v2_conversations
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_timeline_head_deferred();

create constraint trigger inbox_v2_conversation_heads_timeline_constraint_trigger
after insert or update or delete on public.inbox_v2_conversation_heads
deferrable initially deferred
for each row execute function public.inbox_v2_conversation_timeline_head_deferred();
