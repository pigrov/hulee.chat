CREATE UNIQUE INDEX "inbox_v2_timeline_subject_details_system_event_unique" ON "inbox_v2_timeline_subject_details" USING btree ("tenant_id","system_event_id") WHERE "inbox_v2_timeline_subject_details"."system_event_id" is not null;
--> statement-breakpoint
-- INB2-MSG-001_MONOTONIC_TIMELINE_GUARDS_V1
create or replace function public.inbox_v2_system_event_timeline_binding_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.subject_kind <> 'system_event' then
    return new;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_timeline_items item
      inner join public.event_store event_row
        on event_row.tenant_id = item.tenant_id
       and event_row.id = new.system_event_id
     where item.tenant_id = new.tenant_id
       and item.id = new.timeline_item_id
       and item.subject_kind = 'system_event'
       and event_row.payload->>'schemaId' =
         'core:inbox-v2.conversation-system-event-payload'
       and event_row.payload->>'schemaVersion' = 'v1'
       and event_row.payload#>>'{conversation,tenantId}' = new.tenant_id
       and event_row.payload#>>'{conversation,kind}' = 'conversation'
       and event_row.payload#>>'{conversation,id}' = item.conversation_id
       and event_row.payload->>'recordedAt' = to_char(
         event_row.created_at at time zone 'UTC',
         'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
       )
       and event_row.occurred_at = item.occurred_at
       and event_row.created_at = item.received_at
     for share of event_row
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.system_event_timeline_binding_invalid';
  end if;

  return new;
end;
$function$;
--> statement-breakpoint
drop trigger if exists inbox_v2_system_event_timeline_binding_guard
  on public.inbox_v2_timeline_subject_details;
--> statement-breakpoint
create trigger inbox_v2_system_event_timeline_binding_guard
before insert on public.inbox_v2_timeline_subject_details
for each row execute function public.inbox_v2_system_event_timeline_binding_guard();
--> statement-breakpoint
create or replace function public.inbox_v2_referenced_system_event_immutable_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_timeline_subject_details detail
     where detail.tenant_id = old.tenant_id
       and detail.subject_kind = 'system_event'
       and detail.system_event_id = old.id
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.referenced_system_event_immutable';
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
drop trigger if exists inbox_v2_referenced_system_event_immutable_guard
  on public.event_store;
--> statement-breakpoint
create trigger inbox_v2_referenced_system_event_immutable_guard
before update or delete on public.event_store
for each row execute function public.inbox_v2_referenced_system_event_immutable_guard();
