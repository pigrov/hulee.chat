alter table public.inbox_v2_tenant_stream_changes disable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba;
--> statement-breakpoint
update public.inbox_v2_tenant_stream_changes
set state_reason_id = 'core:retention-tombstone'
where state_kind = 'tombstone'
  and state_reason_id is null;
--> statement-breakpoint
alter table public.inbox_v2_tenant_stream_changes enable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba;
--> statement-breakpoint
insert into public.inbox_v2_outbox_work_items (
  tenant_id,
  intent_id,
  state,
  attempt_count,
  available_at,
  revision,
  created_at,
  updated_at
)
select intent_row.tenant_id,
       intent_row.id,
       'pending'::public.inbox_v2_outbox_work_state,
       0,
       intent_row.available_at,
       1,
       intent_row.created_at,
       intent_row.created_at
  from public.inbox_v2_outbox_intents intent_row
on conflict (tenant_id, intent_id) do nothing;
