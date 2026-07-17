-- INB2-SRC-009_OUTBOX_TERMINAL_PAYLOAD_PURGE_BOUNDARY_V1
CREATE TABLE "inbox_v2_outbox_terminal_payload_refs" (
	"tenant_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"outcome_revision" bigint NOT NULL,
	"result_reference" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_outbox_terminal_payload_refs_pk" PRIMARY KEY("tenant_id","intent_id","outcome_revision"),
	CONSTRAINT "inbox_v2_outbox_terminal_payload_refs_values_check" CHECK ("inbox_v2_outbox_terminal_payload_refs"."outcome_revision" >= 1
        and public.inbox_v2_auth_payload_reference_safe(
          "inbox_v2_outbox_terminal_payload_refs"."result_reference", "inbox_v2_outbox_terminal_payload_refs"."tenant_id"
        )
        and isfinite("inbox_v2_outbox_terminal_payload_refs"."recorded_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_outcomes" DROP CONSTRAINT "inbox_v2_outbox_outcomes_values_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_work_items" DROP CONSTRAINT "inbox_v2_outbox_work_items_values_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_outcomes" ADD COLUMN "payload_reference_recorded" boolean DEFAULT false NOT NULL;--> statement-breakpoint
do $outbox_terminal_payload_legacy_coherence$
begin
  if exists (
    select 1
      from public.inbox_v2_outbox_work_items work_row
      join public.inbox_v2_outbox_outcomes outcome_row
        on outcome_row.tenant_id = work_row.tenant_id
       and outcome_row.intent_id = work_row.intent_id
       and outcome_row.outcome_revision = work_row.revision
     where work_row.state in ('processed', 'dead')
       and work_row.terminal_result_reference is distinct from
         outcome_row.result_reference
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_terminal_payload_legacy_incoherent';
  end if;
end;
$outbox_terminal_payload_legacy_coherence$;--> statement-breakpoint
insert into public.inbox_v2_outbox_terminal_payload_refs (
  tenant_id,
  intent_id,
  outcome_revision,
  result_reference,
  recorded_at
)
select outcome_row.tenant_id,
       outcome_row.intent_id,
       outcome_row.outcome_revision,
       outcome_row.result_reference,
       outcome_row.occurred_at
  from public.inbox_v2_outbox_outcomes outcome_row
 where outcome_row.result_reference is not null
   and outcome_row.kind in ('processed', 'dead');--> statement-breakpoint
alter table public.inbox_v2_outbox_outcomes
  disable trigger inbox_v2_outbox_outcome_immutable_trigger;--> statement-breakpoint
update public.inbox_v2_outbox_outcomes
   set payload_reference_recorded = result_reference is not null,
       result_reference = null
 where result_reference is not null;--> statement-breakpoint
alter table public.inbox_v2_outbox_outcomes
  enable trigger inbox_v2_outbox_outcome_immutable_trigger;--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_terminal_payload_refs" ADD CONSTRAINT "inbox_v2_outbox_terminal_payload_refs_outcome_fk" FOREIGN KEY ("tenant_id","intent_id","outcome_revision") REFERENCES "public"."inbox_v2_outbox_outcomes"("tenant_id","intent_id","outcome_revision") ON DELETE cascade ON UPDATE no action DEFERRABLE INITIALLY DEFERRED;--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_terminal_payload_refs_recorded_idx" ON "inbox_v2_outbox_terminal_payload_refs" USING btree ("tenant_id","recorded_at","intent_id","outcome_revision");--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_outcomes" ADD CONSTRAINT "inbox_v2_outbox_outcomes_values_check" CHECK ("inbox_v2_outbox_outcomes"."outcome_revision" >= 1
        and "inbox_v2_outbox_outcomes"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_outbox_outcomes"."worker_id") between 1 and 256
        and ("inbox_v2_outbox_outcomes"."error_code" is null
          or char_length("inbox_v2_outbox_outcomes"."error_code") between 3 and 256)
        and "inbox_v2_outbox_outcomes"."result_reference" is null
        and "inbox_v2_outbox_outcomes"."outcome_hash" ~ '^sha256:[0-9a-f]{64}$'
        and (("inbox_v2_outbox_outcomes"."kind" = 'processed'
            and "inbox_v2_outbox_outcomes"."error_code" is null
            and "inbox_v2_outbox_outcomes"."retry_at" is null)
          or ("inbox_v2_outbox_outcomes"."kind" = 'retry'
            and "inbox_v2_outbox_outcomes"."error_code" is not null
            and "inbox_v2_outbox_outcomes"."retry_at" is not null
            and not "inbox_v2_outbox_outcomes"."payload_reference_recorded")
          or ("inbox_v2_outbox_outcomes"."kind" = 'dead'
            and "inbox_v2_outbox_outcomes"."error_code" is not null
            and "inbox_v2_outbox_outcomes"."retry_at" is null)));--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_work_items" ADD CONSTRAINT "inbox_v2_outbox_work_items_values_check" CHECK ("inbox_v2_outbox_work_items"."attempt_count" >= 0
        and "inbox_v2_outbox_work_items"."revision" >= 1
        and ("inbox_v2_outbox_work_items"."lease_owner_id" is null
          or char_length("inbox_v2_outbox_work_items"."lease_owner_id") between 1 and 256)
        and ("inbox_v2_outbox_work_items"."lease_token_hash" is null
          or "inbox_v2_outbox_work_items"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_outbox_work_items"."lease_revision" is null or "inbox_v2_outbox_work_items"."lease_revision" >= 1)
        and ("inbox_v2_outbox_work_items"."last_retry_result_hash" is null
          or "inbox_v2_outbox_work_items"."last_retry_result_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_outbox_work_items"."last_retry_error_code" is null
          or char_length("inbox_v2_outbox_work_items"."last_retry_error_code") between 3 and 256)
        and ("inbox_v2_outbox_work_items"."terminal_result_hash" is null
          or "inbox_v2_outbox_work_items"."terminal_result_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_outbox_work_items"."terminal_error_code" is null
          or char_length("inbox_v2_outbox_work_items"."terminal_error_code") between 3 and 256)
        and ("inbox_v2_outbox_work_items"."terminal_result_reference" is null
          or public.inbox_v2_auth_payload_reference_safe(
            "inbox_v2_outbox_work_items"."terminal_result_reference", "inbox_v2_outbox_work_items"."tenant_id"
          )));
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_terminal_payload_ref_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using errcode = '23514',
    message = 'inbox_v2.outbox_terminal_payload_reference_immutable';
end;
$function$;
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_terminal_payload_ref_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_outcome public.inbox_v2_outbox_outcomes%rowtype;
begin

  select * into v_outcome
    from public.inbox_v2_outbox_outcomes outcome_row
   where outcome_row.tenant_id = new.tenant_id
     and outcome_row.intent_id = new.intent_id
     and outcome_row.outcome_revision = new.outcome_revision;

  if not found
     or v_outcome.kind = 'retry'
     or not v_outcome.payload_reference_recorded
     or v_outcome.occurred_at <> new.recorded_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_terminal_payload_reference_incoherent';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_terminal_payload_ref_insert_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
      from public.inbox_v2_outbox_work_items work_row
     where work_row.tenant_id = new.tenant_id
       and work_row.intent_id = new.intent_id
       and work_row.state = 'leased'
       and new.outcome_revision = work_row.revision + 1
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_terminal_payload_insert_not_finalizing';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
create or replace function public.inbox_v2_repository_outbox_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.attempt_count <> 0
       or new.revision <> 1
       or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_work_initial_state_invalid';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if old.state in ('processed', 'dead')
     and new.state = old.state
     and old.terminal_result_reference is not null
     and new.terminal_result_reference is null
     and current_user = 'hulee_inbox_v2_retention_owner'
     and (to_jsonb(new) - 'terminal_result_reference') =
       (to_jsonb(old) - 'terminal_result_reference') then
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.intent_id is distinct from old.intent_id
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_work_identity_invalid';
  end if;
  if new.state = 'leased' then
    if old.state = 'pending' then
      if new.attempt_count <> old.attempt_count + 1
         or new.lease_revision <> 1
         or new.lease_claimed_at <> new.updated_at then
        raise exception using errcode = '40001',
          message = 'inbox_v2.outbox_claim_conflict';
      end if;
    elsif old.state = 'leased' then
      if old.lease_expires_at <= new.updated_at then
        if new.attempt_count <> old.attempt_count + 1
           or new.lease_token_hash is not distinct from old.lease_token_hash
           or new.lease_revision <> old.lease_revision + 1
           or new.lease_claimed_at <> new.updated_at then
          raise exception using errcode = '40001',
            message = 'inbox_v2.outbox_reclaim_conflict';
        end if;
      elsif new.attempt_count <> old.attempt_count
         or new.lease_token_hash is distinct from old.lease_token_hash
         or new.lease_owner_id is distinct from old.lease_owner_id
         or new.lease_revision <> old.lease_revision + 1
         or new.lease_claimed_at is distinct from old.lease_claimed_at
         or new.lease_expires_at < old.lease_expires_at
      then
        raise exception using errcode = '40001',
          message = 'inbox_v2.outbox_renew_conflict';
      end if;
    else
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_terminal_state_immutable';
    end if;
  elsif new.state in ('pending', 'processed', 'dead') then
    if old.state <> 'leased'
       or old.lease_expires_at <= new.updated_at
       or new.attempt_count <> old.attempt_count then
      raise exception using errcode = '40001',
        message = 'inbox_v2.outbox_finalize_conflict';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_state_transition_invalid';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_terminal_payload_ref_delete()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;
  update public.inbox_v2_outbox_work_items work_row
     set terminal_result_reference = null
   where work_row.tenant_id = old.tenant_id
     and work_row.intent_id = old.intent_id
     and work_row.revision = old.outcome_revision
     and work_row.state in ('processed', 'dead')
     and work_row.terminal_result_reference = old.result_reference;

  if exists (
    select 1
      from public.inbox_v2_outbox_work_items work_row
     where work_row.tenant_id = old.tenant_id
       and work_row.intent_id = old.intent_id
       and work_row.revision = old.outcome_revision
       and work_row.terminal_result_reference is not null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_terminal_payload_shadow_incoherent';
  end if;
  return old;
end;
$function$;
--> statement-breakpoint
create trigger inbox_v2_outbox_terminal_payload_refs_immutable_trigger
before update on public.inbox_v2_outbox_terminal_payload_refs
for each row execute function
  public.inbox_v2_outbox_terminal_payload_ref_immutable();
--> statement-breakpoint
create trigger inbox_v2_outbox_terminal_payload_refs_insert_guard
before insert on public.inbox_v2_outbox_terminal_payload_refs
for each row execute function
  public.inbox_v2_outbox_terminal_payload_ref_insert_guard();
--> statement-breakpoint
create trigger inbox_v2_outbox_terminal_payload_refs_truncate_guard
before truncate on public.inbox_v2_outbox_terminal_payload_refs
for each statement execute function
  public.inbox_v2_outbox_terminal_payload_ref_immutable();
--> statement-breakpoint
create trigger inbox_v2_outbox_terminal_payload_refs_delete_trigger
before delete on public.inbox_v2_outbox_terminal_payload_refs
for each row execute function
  public.inbox_v2_outbox_terminal_payload_ref_delete();
--> statement-breakpoint
create constraint trigger inbox_v2_outbox_terminal_payload_refs_coherence
after insert on public.inbox_v2_outbox_terminal_payload_refs
deferrable initially deferred
for each row execute function
  public.inbox_v2_outbox_terminal_payload_ref_coherence();
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_legacy_outcome_payload_bridge()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result_reference jsonb := new.result_reference;
begin
  if v_result_reference is null then
    return new;
  end if;
  if new.kind = 'retry'
     or not public.inbox_v2_auth_payload_reference_safe(
       v_result_reference, new.tenant_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_legacy_terminal_payload_invalid';
  end if;

  new.payload_reference_recorded := true;
  new.result_reference := null;
  insert into public.inbox_v2_outbox_terminal_payload_refs (
    tenant_id, intent_id, outcome_revision, result_reference, recorded_at
  ) values (
    new.tenant_id, new.intent_id, new.outcome_revision,
    v_result_reference, new.occurred_at
  );
  return new;
end;
$function$;
--> statement-breakpoint
create trigger inbox_v2_outbox_legacy_outcome_payload_bridge_trigger
before insert on public.inbox_v2_outbox_outcomes
for each row execute function
  public.inbox_v2_outbox_legacy_outcome_payload_bridge();
--> statement-breakpoint
create or replace function public.inbox_v2_outbox_legacy_work_payload_bridge()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.terminal_result_reference is null then
    return new;
  end if;
  if new.state not in ('processed', 'dead')
     or not public.inbox_v2_auth_payload_reference_safe(
       new.terminal_result_reference, new.tenant_id
     )
     or not exists (
       select 1
         from public.inbox_v2_outbox_terminal_payload_refs payload_row
        where payload_row.tenant_id = new.tenant_id
          and payload_row.intent_id = new.intent_id
          and payload_row.outcome_revision = new.revision
          and payload_row.result_reference = new.terminal_result_reference
          and payload_row.recorded_at = new.terminal_finalized_at
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbox_legacy_terminal_payload_shadow_invalid';
  end if;
  return new;
end;
$function$;
--> statement-breakpoint
create trigger inbox_v2_outbox_legacy_work_payload_bridge_trigger
before update on public.inbox_v2_outbox_work_items
for each row execute function
  public.inbox_v2_outbox_legacy_work_payload_bridge();
--> statement-breakpoint
create or replace function public.inbox_v2_source_onboarding_terminal_payload_ref_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_outbox_terminal_payload_refs payload_row
     where payload_row.tenant_id = old.tenant_id
       and payload_row.result_reference->>'recordId' = old.id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_onboarding_result_delete_forbidden';
  end if;
  return old;
end;
$function$;
--> statement-breakpoint
create trigger inbox_v2_source_onboarding_terminal_payload_ref_guard_trigger
before delete on public.inbox_v2_source_onboarding_result_snapshots
for each row execute function
  public.inbox_v2_source_onboarding_terminal_payload_ref_guard();
--> statement-breakpoint
revoke all privileges on table public.inbox_v2_outbox_terminal_payload_refs
from public;
grant select, insert on table
  public.inbox_v2_outbox_terminal_payload_refs
to hulee_inbox_v2_runtime;
grant select, delete on table
  public.inbox_v2_outbox_terminal_payload_refs
to hulee_inbox_v2_retention_owner;
grant update (terminal_result_reference) on table
  public.inbox_v2_outbox_work_items
to hulee_inbox_v2_retention_owner;
revoke update, truncate on table
  public.inbox_v2_outbox_terminal_payload_refs
from hulee_inbox_v2_runtime,
     hulee_inbox_v2_retention_owner;
--> statement-breakpoint
do $terminal_payload_retention_boundary_audit$
begin
  if not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_runtime',
    'public.inbox_v2_outbox_terminal_payload_refs',
    'SELECT,INSERT'
  ) or pg_catalog.has_table_privilege(
    'hulee_inbox_v2_runtime',
    'public.inbox_v2_outbox_terminal_payload_refs',
    'DELETE'
  ) or not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_terminal_payload_refs',
    'SELECT,DELETE'
  ) or not pg_catalog.has_column_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_work_items',
    'terminal_result_reference',
    'UPDATE'
  ) then
    raise exception using errcode = '42501',
      message = 'inbox_v2.outbox_terminal_payload_retention_boundary_invalid';
  end if;
end;
$terminal_payload_retention_boundary_audit$;
