-- INBOX_V2_EMPLOYEE_CONVERSATION_STATE_MIGRATION_FINALIZED_V1
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
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_employee_conversation_notification_level" AS ENUM('inherit', 'all', 'mentions_only', 'none');
--> statement-breakpoint
CREATE TABLE "inbox_v2_employee_conversation_states" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"last_read_sequence" bigint DEFAULT 0 NOT NULL,
	"last_read_at" timestamp (3) with time zone,
	"manual_unread" boolean DEFAULT false NOT NULL,
	"manual_unread_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"mute_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"notification_level" "inbox_v2_employee_conversation_notification_level" DEFAULT 'inherit' NOT NULL,
	"notification_level_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"pin_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"archived" boolean DEFAULT false NOT NULL,
	"archive_changed_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp (3) with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inbox_v2_employee_conversation_states_pk" PRIMARY KEY("tenant_id","employee_id","conversation_id"),
	CONSTRAINT "inbox_v2_employee_conversation_states_read_check" CHECK ("inbox_v2_employee_conversation_states"."last_read_sequence" >= 0 and (
        ("inbox_v2_employee_conversation_states"."last_read_sequence" = 0 and "inbox_v2_employee_conversation_states"."last_read_at" is null)
        or ("inbox_v2_employee_conversation_states"."last_read_sequence" > 0 and "inbox_v2_employee_conversation_states"."last_read_at" is not null)
      )),
	CONSTRAINT "inbox_v2_employee_conversation_states_revision_check" CHECK ("inbox_v2_employee_conversation_states"."revision" >= 1 and "inbox_v2_employee_conversation_states"."last_changed_stream_position" >= 1),
	CONSTRAINT "inbox_v2_employee_conversation_states_timestamps_check" CHECK (isfinite("inbox_v2_employee_conversation_states"."created_at")
        and isfinite("inbox_v2_employee_conversation_states"."updated_at")
        and "inbox_v2_employee_conversation_states"."updated_at" >= "inbox_v2_employee_conversation_states"."created_at"
        and ("inbox_v2_employee_conversation_states"."last_read_at" is null or (
          isfinite("inbox_v2_employee_conversation_states"."last_read_at")
          and "inbox_v2_employee_conversation_states"."last_read_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at"
        ))
        and isfinite("inbox_v2_employee_conversation_states"."manual_unread_changed_at")
        and "inbox_v2_employee_conversation_states"."manual_unread_changed_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at"
        and isfinite("inbox_v2_employee_conversation_states"."mute_changed_at")
        and "inbox_v2_employee_conversation_states"."mute_changed_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at"
        and isfinite("inbox_v2_employee_conversation_states"."notification_level_changed_at")
        and "inbox_v2_employee_conversation_states"."notification_level_changed_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at"
        and isfinite("inbox_v2_employee_conversation_states"."pin_changed_at")
        and "inbox_v2_employee_conversation_states"."pin_changed_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at"
        and isfinite("inbox_v2_employee_conversation_states"."archive_changed_at")
        and "inbox_v2_employee_conversation_states"."archive_changed_at" between "inbox_v2_employee_conversation_states"."created_at" and "inbox_v2_employee_conversation_states"."updated_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_employee_conversation_states" ADD CONSTRAINT "inbox_v2_employee_conversation_states_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_employee_conversation_states" ADD CONSTRAINT "inbox_v2_employee_conversation_states_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_employee_conversation_states_conversation_idx" ON "inbox_v2_employee_conversation_states" USING btree ("tenant_id","conversation_id","employee_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_employee_conversation_states_sync_idx" ON "inbox_v2_employee_conversation_states" USING btree ("tenant_id","employee_id","last_changed_stream_position","conversation_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_employee_conversation_states_pinned_idx" ON "inbox_v2_employee_conversation_states" USING btree ("tenant_id","employee_id","pin_changed_at" DESC NULLS LAST,"conversation_id") WHERE "inbox_v2_employee_conversation_states"."pinned";
--> statement-breakpoint
CREATE INDEX "inbox_v2_employee_conversation_states_archived_idx" ON "inbox_v2_employee_conversation_states" USING btree ("tenant_id","employee_id","archive_changed_at" DESC NULLS LAST,"conversation_id") WHERE "inbox_v2_employee_conversation_states"."archived";
--> statement-breakpoint
create or replace function public.inbox_v2_ecs_state_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.updated_at <> new.created_at
       or new.manual_unread_changed_at <> new.created_at
       or new.mute_changed_at <> new.created_at
       or new.notification_level_changed_at <> new.created_at
       or new.pin_changed_at <> new.created_at
       or new.archive_changed_at <> new.created_at
       or (new.last_read_sequence = 0 and new.last_read_at is not null)
       or (new.last_read_sequence > 0 and new.last_read_at <> new.created_at) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.employee_conversation_state_invalid_initial_metadata';
    end if;
    return new;
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.employee_id is distinct from old.employee_id
     or new.conversation_id is distinct from old.conversation_id
     or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_identity_immutable';
  end if;

  if new.last_read_sequence < old.last_read_sequence then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_cursor_regression';
  end if;

  if new.revision <> old.revision + 1
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_revision_stream_regression';
  end if;

  if new.last_read_sequence = old.last_read_sequence then
    if new.last_read_at is distinct from old.last_read_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.employee_conversation_state_read_timestamp_without_advance';
    end if;
  elsif new.last_read_at is distinct from new.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_timestamp_mismatch';
  end if;

  if ((new.manual_unread is not distinct from old.manual_unread)
       and new.manual_unread_changed_at is distinct from old.manual_unread_changed_at)
     or ((new.manual_unread is distinct from old.manual_unread)
       and new.manual_unread_changed_at is distinct from new.updated_at)
     or ((new.muted is not distinct from old.muted)
       and new.mute_changed_at is distinct from old.mute_changed_at)
     or ((new.muted is distinct from old.muted)
       and new.mute_changed_at is distinct from new.updated_at)
     or ((new.notification_level is not distinct from old.notification_level)
       and new.notification_level_changed_at is distinct from old.notification_level_changed_at)
     or ((new.notification_level is distinct from old.notification_level)
       and new.notification_level_changed_at is distinct from new.updated_at)
     or ((new.pinned is not distinct from old.pinned)
       and new.pin_changed_at is distinct from old.pin_changed_at)
     or ((new.pinned is distinct from old.pinned)
       and new.pin_changed_at is distinct from new.updated_at)
     or ((new.archived is not distinct from old.archived)
       and new.archive_changed_at is distinct from old.archive_changed_at)
     or ((new.archived is distinct from old.archived)
       and new.archive_changed_at is distinct from new.updated_at) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_field_timestamp_mismatch';
  end if;

  if new.last_read_sequence = old.last_read_sequence
     and new.manual_unread = old.manual_unread
     and new.muted = old.muted
     and new.notification_level = old.notification_level
     and new.pinned = old.pinned
     and new.archived = old.archived then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_phantom_update';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_ecs_read_cursor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.last_read_sequence > 0 and not exists (
    select 1
      from public.inbox_v2_timeline_items timeline_item
     where timeline_item.tenant_id = new.tenant_id
       and timeline_item.conversation_id = new.conversation_id
       and timeline_item.timeline_sequence = new.last_read_sequence
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.employee_conversation_state_read_cursor_not_in_conversation';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_ecs_state_guard_trigger
before insert or update on public.inbox_v2_employee_conversation_states
for each row execute function public.inbox_v2_ecs_state_guard();

create constraint trigger inbox_v2_ecs_read_cursor_constraint
after insert or update of last_read_sequence
on public.inbox_v2_employee_conversation_states
deferrable initially deferred
for each row execute function public.inbox_v2_ecs_read_cursor_guard();
