-- INBOX_V2_REPOSITORY_FOUNDATION_MIGRATION_FINALIZED_V1
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
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_outbox_outcome_kind" AS ENUM('retry', 'processed', 'dead');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_outbox_work_state" AS ENUM('pending', 'leased', 'processed', 'dead');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_projection_generation_state" AS ENUM('shadow', 'active', 'retired');
--> statement-breakpoint
CREATE TABLE "inbox_v2_outbox_outcomes" (
	"tenant_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"outcome_revision" bigint NOT NULL,
	"kind" "inbox_v2_outbox_outcome_kind" NOT NULL,
	"lease_token_hash" text NOT NULL,
	"worker_id" text NOT NULL,
	"error_code" text,
	"result_reference" jsonb,
	"retry_at" timestamp (3) with time zone,
	"outcome_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_outbox_outcomes_pk" PRIMARY KEY("tenant_id","intent_id","outcome_revision"),
	CONSTRAINT "inbox_v2_outbox_outcomes_lease_unique" UNIQUE("tenant_id","intent_id","lease_token_hash"),
	CONSTRAINT "inbox_v2_outbox_outcomes_values_check" CHECK ("inbox_v2_outbox_outcomes"."outcome_revision" >= 1
        and "inbox_v2_outbox_outcomes"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_outbox_outcomes"."worker_id") between 1 and 256
        and ("inbox_v2_outbox_outcomes"."error_code" is null
          or char_length("inbox_v2_outbox_outcomes"."error_code") between 3 and 256)
        and ("inbox_v2_outbox_outcomes"."result_reference" is null
          or jsonb_typeof("inbox_v2_outbox_outcomes"."result_reference") = 'object')
        and "inbox_v2_outbox_outcomes"."outcome_hash" ~ '^sha256:[0-9a-f]{64}$'
        and (("inbox_v2_outbox_outcomes"."kind" = 'processed'
            and "inbox_v2_outbox_outcomes"."error_code" is null
            and "inbox_v2_outbox_outcomes"."retry_at" is null)
          or ("inbox_v2_outbox_outcomes"."kind" = 'retry'
            and "inbox_v2_outbox_outcomes"."error_code" is not null
            and "inbox_v2_outbox_outcomes"."retry_at" is not null)
          or ("inbox_v2_outbox_outcomes"."kind" = 'dead'
            and "inbox_v2_outbox_outcomes"."error_code" is not null
            and "inbox_v2_outbox_outcomes"."retry_at" is null))),
	CONSTRAINT "inbox_v2_outbox_outcomes_times_check" CHECK (isfinite("inbox_v2_outbox_outcomes"."occurred_at")
        and "inbox_v2_outbox_outcomes"."created_at" = "inbox_v2_outbox_outcomes"."occurred_at"
        and ("inbox_v2_outbox_outcomes"."retry_at" is null
          or (isfinite("inbox_v2_outbox_outcomes"."retry_at") and "inbox_v2_outbox_outcomes"."retry_at" > "inbox_v2_outbox_outcomes"."occurred_at")))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_outbox_work_items" (
	"tenant_id" text NOT NULL,
	"intent_id" text NOT NULL,
	"state" "inbox_v2_outbox_work_state" NOT NULL,
	"attempt_count" bigint NOT NULL,
	"available_at" timestamp (3) with time zone,
	"lease_owner_id" text,
	"lease_token_hash" text,
	"lease_revision" bigint,
	"lease_claimed_at" timestamp (3) with time zone,
	"lease_expires_at" timestamp (3) with time zone,
	"last_retry_result_hash" text,
	"last_retry_error_code" text,
	"last_retry_available_at" timestamp (3) with time zone,
	"last_retry_recorded_at" timestamp (3) with time zone,
	"terminal_result_hash" text,
	"terminal_error_code" text,
	"terminal_result_reference" jsonb,
	"terminal_finalized_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_outbox_work_items_pk" PRIMARY KEY("tenant_id","intent_id"),
	CONSTRAINT "inbox_v2_outbox_work_items_values_check" CHECK ("inbox_v2_outbox_work_items"."attempt_count" >= 0
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
          or jsonb_typeof("inbox_v2_outbox_work_items"."terminal_result_reference") = 'object')),
	CONSTRAINT "inbox_v2_outbox_work_items_state_check" CHECK (("inbox_v2_outbox_work_items"."state" = 'pending'
          and "inbox_v2_outbox_work_items"."available_at" is not null
          and "inbox_v2_outbox_work_items"."lease_owner_id" is null
          and "inbox_v2_outbox_work_items"."lease_token_hash" is null
          and "inbox_v2_outbox_work_items"."lease_revision" is null
          and "inbox_v2_outbox_work_items"."lease_claimed_at" is null
          and "inbox_v2_outbox_work_items"."lease_expires_at" is null
          and "inbox_v2_outbox_work_items"."terminal_result_hash" is null
          and "inbox_v2_outbox_work_items"."terminal_error_code" is null
          and "inbox_v2_outbox_work_items"."terminal_result_reference" is null
          and "inbox_v2_outbox_work_items"."terminal_finalized_at" is null)
        or ("inbox_v2_outbox_work_items"."state" = 'leased'
          and "inbox_v2_outbox_work_items"."available_at" is not null
          and "inbox_v2_outbox_work_items"."lease_owner_id" is not null
          and "inbox_v2_outbox_work_items"."lease_token_hash" is not null
          and "inbox_v2_outbox_work_items"."lease_revision" is not null
          and "inbox_v2_outbox_work_items"."lease_claimed_at" is not null
          and "inbox_v2_outbox_work_items"."lease_expires_at" is not null
          and "inbox_v2_outbox_work_items"."terminal_result_hash" is null
          and "inbox_v2_outbox_work_items"."terminal_error_code" is null
          and "inbox_v2_outbox_work_items"."terminal_result_reference" is null
          and "inbox_v2_outbox_work_items"."terminal_finalized_at" is null)
        or ("inbox_v2_outbox_work_items"."state" = 'processed'
          and "inbox_v2_outbox_work_items"."available_at" is null
          and "inbox_v2_outbox_work_items"."lease_owner_id" is null
          and "inbox_v2_outbox_work_items"."lease_token_hash" is null
          and "inbox_v2_outbox_work_items"."lease_revision" is null
          and "inbox_v2_outbox_work_items"."lease_claimed_at" is null
          and "inbox_v2_outbox_work_items"."lease_expires_at" is null
          and "inbox_v2_outbox_work_items"."terminal_result_hash" is not null
          and "inbox_v2_outbox_work_items"."terminal_error_code" is null
          and "inbox_v2_outbox_work_items"."terminal_finalized_at" is not null)
        or ("inbox_v2_outbox_work_items"."state" = 'dead'
          and "inbox_v2_outbox_work_items"."available_at" is null
          and "inbox_v2_outbox_work_items"."lease_owner_id" is null
          and "inbox_v2_outbox_work_items"."lease_token_hash" is null
          and "inbox_v2_outbox_work_items"."lease_revision" is null
          and "inbox_v2_outbox_work_items"."lease_claimed_at" is null
          and "inbox_v2_outbox_work_items"."lease_expires_at" is null
          and "inbox_v2_outbox_work_items"."terminal_result_hash" is not null
          and "inbox_v2_outbox_work_items"."terminal_error_code" is not null
          and "inbox_v2_outbox_work_items"."terminal_finalized_at" is not null)),
	CONSTRAINT "inbox_v2_outbox_work_items_retry_check" CHECK ((
          "inbox_v2_outbox_work_items"."last_retry_result_hash" is null
          and "inbox_v2_outbox_work_items"."last_retry_error_code" is null
          and "inbox_v2_outbox_work_items"."last_retry_available_at" is null
          and "inbox_v2_outbox_work_items"."last_retry_recorded_at" is null
        ) or (
          "inbox_v2_outbox_work_items"."last_retry_result_hash" is not null
          and "inbox_v2_outbox_work_items"."last_retry_error_code" is not null
          and "inbox_v2_outbox_work_items"."last_retry_available_at" is not null
          and "inbox_v2_outbox_work_items"."last_retry_recorded_at" is not null
          and "inbox_v2_outbox_work_items"."available_at" = "inbox_v2_outbox_work_items"."last_retry_available_at"
        )),
	CONSTRAINT "inbox_v2_outbox_work_items_times_check" CHECK (isfinite("inbox_v2_outbox_work_items"."created_at")
        and isfinite("inbox_v2_outbox_work_items"."updated_at")
        and "inbox_v2_outbox_work_items"."updated_at" >= "inbox_v2_outbox_work_items"."created_at"
        and ("inbox_v2_outbox_work_items"."available_at" is null or isfinite("inbox_v2_outbox_work_items"."available_at"))
        and ("inbox_v2_outbox_work_items"."lease_claimed_at" is null or (
          isfinite("inbox_v2_outbox_work_items"."lease_claimed_at")
          and "inbox_v2_outbox_work_items"."lease_claimed_at" between "inbox_v2_outbox_work_items"."created_at" and "inbox_v2_outbox_work_items"."updated_at"
        ))
        and ("inbox_v2_outbox_work_items"."lease_expires_at" is null or (
          isfinite("inbox_v2_outbox_work_items"."lease_expires_at")
          and "inbox_v2_outbox_work_items"."lease_expires_at" > "inbox_v2_outbox_work_items"."lease_claimed_at"
        ))
        and ("inbox_v2_outbox_work_items"."last_retry_available_at" is null or (
          isfinite("inbox_v2_outbox_work_items"."last_retry_available_at")
          and "inbox_v2_outbox_work_items"."last_retry_available_at" > "inbox_v2_outbox_work_items"."last_retry_recorded_at"
        ))
        and ("inbox_v2_outbox_work_items"."last_retry_recorded_at" is null or (
          isfinite("inbox_v2_outbox_work_items"."last_retry_recorded_at")
          and "inbox_v2_outbox_work_items"."last_retry_recorded_at" between "inbox_v2_outbox_work_items"."created_at" and "inbox_v2_outbox_work_items"."updated_at"
        ))
        and ("inbox_v2_outbox_work_items"."terminal_finalized_at" is null or (
          isfinite("inbox_v2_outbox_work_items"."terminal_finalized_at")
          and "inbox_v2_outbox_work_items"."terminal_finalized_at" between "inbox_v2_outbox_work_items"."created_at" and "inbox_v2_outbox_work_items"."updated_at"
        )))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_projection_checkpoints" (
	"tenant_id" text NOT NULL,
	"projection_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"stream_epoch" text NOT NULL,
	"position" bigint NOT NULL,
	"last_commit_id" text,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_projection_checkpoints_pk" PRIMARY KEY("tenant_id","projection_id","scope_id","generation"),
	CONSTRAINT "inbox_v2_projection_checkpoints_values_check" CHECK ("inbox_v2_projection_checkpoints"."generation" >= 1
        and "inbox_v2_projection_checkpoints"."position" >= 0
        and "inbox_v2_projection_checkpoints"."revision" >= 1
        and ("inbox_v2_projection_checkpoints"."position" > 0
          or "inbox_v2_projection_checkpoints"."last_commit_id" is null)
        and ("inbox_v2_projection_checkpoints"."last_commit_id" is null
          or char_length("inbox_v2_projection_checkpoints"."last_commit_id") between 1 and 256)),
	CONSTRAINT "inbox_v2_projection_checkpoints_times_check" CHECK (isfinite("inbox_v2_projection_checkpoints"."created_at")
        and isfinite("inbox_v2_projection_checkpoints"."updated_at")
        and "inbox_v2_projection_checkpoints"."updated_at" >= "inbox_v2_projection_checkpoints"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_projection_generations" (
	"tenant_id" text NOT NULL,
	"projection_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"generation" bigint NOT NULL,
	"stream_epoch" text NOT NULL,
	"projection_schema_version" text NOT NULL,
	"state" "inbox_v2_projection_generation_state" NOT NULL,
	"min_retained_position" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"activated_at" timestamp (3) with time zone,
	"retired_at" timestamp (3) with time zone,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_projection_generations_pk" PRIMARY KEY("tenant_id","projection_id","scope_id","generation"),
	CONSTRAINT "inbox_v2_projection_generations_epoch_unique" UNIQUE("tenant_id","projection_id","scope_id","generation","stream_epoch"),
	CONSTRAINT "inbox_v2_projection_generations_values_check" CHECK ("inbox_v2_projection_generations"."generation" >= 1
        and "inbox_v2_projection_generations"."min_retained_position" >= 0
        and "inbox_v2_projection_generations"."revision" >= 1
        and char_length("inbox_v2_projection_generations"."projection_id") between 3 and 256
        and char_length("inbox_v2_projection_generations"."scope_id") between 1 and 256
        and char_length("inbox_v2_projection_generations"."stream_epoch") between 8 and 256
        and char_length("inbox_v2_projection_generations"."projection_schema_version") between 1 and 64),
	CONSTRAINT "inbox_v2_projection_generations_state_check" CHECK (("inbox_v2_projection_generations"."state" = 'shadow'
          and "inbox_v2_projection_generations"."activated_at" is null
          and "inbox_v2_projection_generations"."retired_at" is null)
        or ("inbox_v2_projection_generations"."state" = 'active'
          and "inbox_v2_projection_generations"."activated_at" is not null
          and "inbox_v2_projection_generations"."retired_at" is null)
        or ("inbox_v2_projection_generations"."state" = 'retired'
          and "inbox_v2_projection_generations"."activated_at" is not null
          and "inbox_v2_projection_generations"."retired_at" is not null)),
	CONSTRAINT "inbox_v2_projection_generations_times_check" CHECK (isfinite("inbox_v2_projection_generations"."created_at")
        and isfinite("inbox_v2_projection_generations"."updated_at")
        and "inbox_v2_projection_generations"."updated_at" >= "inbox_v2_projection_generations"."created_at"
        and ("inbox_v2_projection_generations"."activated_at" is null or (
          isfinite("inbox_v2_projection_generations"."activated_at")
          and "inbox_v2_projection_generations"."activated_at" between "inbox_v2_projection_generations"."created_at" and "inbox_v2_projection_generations"."updated_at"
        ))
        and ("inbox_v2_projection_generations"."retired_at" is null or (
          isfinite("inbox_v2_projection_generations"."retired_at")
          and "inbox_v2_projection_generations"."retired_at" between "inbox_v2_projection_generations"."created_at" and "inbox_v2_projection_generations"."updated_at"
          and ("inbox_v2_projection_generations"."activated_at" is null
            or "inbox_v2_projection_generations"."retired_at" >= "inbox_v2_projection_generations"."activated_at")
        )))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_projection_heads" (
	"tenant_id" text NOT NULL,
	"projection_id" text NOT NULL,
	"scope_id" text NOT NULL,
	"current_generation" bigint NOT NULL,
	"stream_epoch" text NOT NULL,
	"projection_schema_version" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_projection_heads_pk" PRIMARY KEY("tenant_id","projection_id","scope_id"),
	CONSTRAINT "inbox_v2_projection_heads_values_check" CHECK ("inbox_v2_projection_heads"."current_generation" >= 1
        and "inbox_v2_projection_heads"."revision" >= 1
        and char_length("inbox_v2_projection_heads"."projection_schema_version") between 1 and 64),
	CONSTRAINT "inbox_v2_projection_heads_times_check" CHECK (isfinite("inbox_v2_projection_heads"."created_at")
        and isfinite("inbox_v2_projection_heads"."updated_at")
        and "inbox_v2_projection_heads"."updated_at" >= "inbox_v2_projection_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_tenant_stream_retention_advances" (
	"tenant_id" text NOT NULL,
	"stream_epoch" text NOT NULL,
	"from_position" bigint NOT NULL,
	"to_position" bigint NOT NULL,
	"expected_head_revision" bigint NOT NULL,
	"resulting_head_revision" bigint NOT NULL,
	"mandatory_checkpoint_floor" bigint NOT NULL,
	"pruned_commit_count" bigint NOT NULL,
	"reason_id" text NOT NULL,
	"advance_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_tenant_stream_retention_advances_pk" PRIMARY KEY("tenant_id","stream_epoch","to_position"),
	CONSTRAINT "inbox_v2_tenant_stream_retention_values_check" CHECK ("inbox_v2_tenant_stream_retention_advances"."from_position" >= 0
        and "inbox_v2_tenant_stream_retention_advances"."to_position" > "inbox_v2_tenant_stream_retention_advances"."from_position"
        and "inbox_v2_tenant_stream_retention_advances"."to_position" <= "inbox_v2_tenant_stream_retention_advances"."mandatory_checkpoint_floor"
        and "inbox_v2_tenant_stream_retention_advances"."expected_head_revision" >= 1
        and "inbox_v2_tenant_stream_retention_advances"."resulting_head_revision" = "inbox_v2_tenant_stream_retention_advances"."expected_head_revision" + 1
        and "inbox_v2_tenant_stream_retention_advances"."pruned_commit_count" =
          "inbox_v2_tenant_stream_retention_advances"."to_position" - greatest("inbox_v2_tenant_stream_retention_advances"."from_position", 1)
        and char_length("inbox_v2_tenant_stream_retention_advances"."reason_id") between 3 and 256
        and "inbox_v2_tenant_stream_retention_advances"."advance_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_tenant_stream_retention_advances"."stream_epoch") between 8 and 256),
	CONSTRAINT "inbox_v2_tenant_stream_retention_times_check" CHECK (isfinite("inbox_v2_tenant_stream_retention_advances"."occurred_at")
        and "inbox_v2_tenant_stream_retention_advances"."created_at" = "inbox_v2_tenant_stream_retention_advances"."occurred_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" DROP CONSTRAINT "inbox_v2_tenant_stream_changes_values_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_domain_events" DROP CONSTRAINT "inbox_v2_domain_events_commit_fk";
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_intents" DROP CONSTRAINT "inbox_v2_outbox_intents_commit_fk";
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" DROP CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk";
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" DROP CONSTRAINT "inbox_v2_dg_subject_link_account_fk";
--> statement-breakpoint
DROP INDEX "inbox_v2_dg_hold_data_class_tenant_idx";
--> statement-breakpoint
DROP INDEX "inbox_v2_dg_purpose_instance_tenant_idx";
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" ADD COLUMN "state_reason_id" text;
--> statement-breakpoint
alter table public.inbox_v2_tenant_stream_changes disable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba;
--> statement-breakpoint
update public.inbox_v2_tenant_stream_changes
set state_reason_id = 'core:retention-tombstone'
where state_kind = 'tombstone'
  and state_reason_id is null;
--> statement-breakpoint
alter table public.inbox_v2_tenant_stream_changes enable trigger inbox_v2_auth_immutable_dbcc9ea93cbd94ba;
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_identity_position_unique" UNIQUE("tenant_id","id","mutation_id","position");
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_checkpoint_unique" UNIQUE("tenant_id","id","stream_epoch","position");
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_outcomes" ADD CONSTRAINT "inbox_v2_outbox_outcomes_work_item_fk" FOREIGN KEY ("tenant_id","intent_id") REFERENCES "public"."inbox_v2_outbox_work_items"("tenant_id","intent_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_work_items" ADD CONSTRAINT "inbox_v2_outbox_work_items_intent_fk" FOREIGN KEY ("tenant_id","intent_id") REFERENCES "public"."inbox_v2_outbox_intents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_projection_checkpoints" ADD CONSTRAINT "inbox_v2_projection_checkpoints_generation_fk" FOREIGN KEY ("tenant_id","projection_id","scope_id","generation","stream_epoch") REFERENCES "public"."inbox_v2_projection_generations"("tenant_id","projection_id","scope_id","generation","stream_epoch") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_projection_checkpoints" ADD CONSTRAINT "inbox_v2_projection_checkpoints_commit_fk" FOREIGN KEY ("tenant_id","last_commit_id","stream_epoch","position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","stream_epoch","position") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_projection_generations" ADD CONSTRAINT "inbox_v2_projection_generations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_projection_generations" ADD CONSTRAINT "inbox_v2_projection_generations_stream_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_tenant_stream_heads"("tenant_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_projection_heads" ADD CONSTRAINT "inbox_v2_projection_heads_generation_fk" FOREIGN KEY ("tenant_id","projection_id","scope_id","current_generation","stream_epoch") REFERENCES "public"."inbox_v2_projection_generations"("tenant_id","projection_id","scope_id","generation","stream_epoch") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_retention_advances" ADD CONSTRAINT "inbox_v2_tenant_stream_retention_advances_head_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_tenant_stream_heads"("tenant_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_outcomes_history_idx" ON "inbox_v2_outbox_outcomes" USING btree ("tenant_id","intent_id","occurred_at","outcome_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_outbox_work_items_lease_token_unique" ON "inbox_v2_outbox_work_items" USING btree ("tenant_id","lease_token_hash") WHERE "inbox_v2_outbox_work_items"."lease_token_hash" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_work_items_due_idx" ON "inbox_v2_outbox_work_items" USING btree ("tenant_id","available_at","intent_id") WHERE "inbox_v2_outbox_work_items"."state" = 'pending';
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_work_items_reclaim_idx" ON "inbox_v2_outbox_work_items" USING btree ("tenant_id","lease_expires_at","intent_id") WHERE "inbox_v2_outbox_work_items"."state" = 'leased';
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_work_items_dead_idx" ON "inbox_v2_outbox_work_items" USING btree ("tenant_id","terminal_finalized_at" DESC NULLS LAST,"intent_id") WHERE "inbox_v2_outbox_work_items"."state" = 'dead';
--> statement-breakpoint
CREATE INDEX "inbox_v2_projection_checkpoints_catchup_idx" ON "inbox_v2_projection_checkpoints" USING btree ("tenant_id","projection_id","position","scope_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_projection_generations_current_unique" ON "inbox_v2_projection_generations" USING btree ("tenant_id","projection_id","scope_id") WHERE "inbox_v2_projection_generations"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_projection_generations_worker_idx" ON "inbox_v2_projection_generations" USING btree ("tenant_id","projection_id","state","min_retained_position","scope_id","generation") WHERE "inbox_v2_projection_generations"."state" = 'shadow';
--> statement-breakpoint
CREATE INDEX "inbox_v2_tenant_stream_retention_history_idx" ON "inbox_v2_tenant_stream_retention_advances" USING btree ("tenant_id","occurred_at","to_position");
--> statement-breakpoint
ALTER TABLE "inbox_v2_domain_events" ADD CONSTRAINT "inbox_v2_domain_events_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_intents" ADD CONSTRAINT "inbox_v2_outbox_intents_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id","stream_position") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id","position") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_data_governance_subject_links" ADD CONSTRAINT "inbox_v2_dg_subject_link_account_fk" FOREIGN KEY ("tenant_id","account_id") REFERENCES "public"."accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_collaborator_employee_conversation_idx" ON "inbox_v2_auth_collaborator_heads" USING btree ("tenant_id","employee_id","conversation_id") WHERE "inbox_v2_auth_collaborator_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_collaborator_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_collaborator_employee_work_item_idx" ON "inbox_v2_auth_collaborator_heads" USING btree ("tenant_id","employee_id","work_item_id","work_item_cycle") WHERE "inbox_v2_auth_collaborator_heads"."resource_kind" = 'work_item'
          and "inbox_v2_auth_collaborator_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_structural_heads_conversation_org_actor_idx" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","target_org_unit_id","conversation_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'org_unit'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_structural_heads_conversation_team_actor_idx" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","target_team_id","conversation_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'team'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_hold_active_root_lookup_idx" ON "inbox_v2_data_governance_legal_hold_targets" USING btree ("tenant_id","storage_root_id","root_record_id","hold_id","hold_revision") WHERE "inbox_v2_data_governance_legal_hold_targets"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_participant_membership_internal_actor_idx" ON "inbox_v2_participant_membership_episodes" USING btree ("tenant_id","participant_id","conversation_id","id") WHERE "inbox_v2_participant_membership_episodes"."origin_kind" = 'hulee_internal_command'
          and "inbox_v2_participant_membership_episodes"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_contents_retention_eligible_idx" ON "inbox_v2_timeline_contents" USING btree ("tenant_id","data_class_id","retention_anchor_at","id") WHERE "inbox_v2_timeline_contents"."state" = 'available';
--> statement-breakpoint
CREATE INDEX "inbox_v2_work_item_primary_assignment_employee_active_idx" ON "inbox_v2_work_item_primary_assignments" USING btree ("tenant_id","employee_id","work_item_id","id") WHERE "inbox_v2_work_item_primary_assignments"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_hold_data_class_tenant_idx" ON "inbox_v2_data_governance_legal_hold_data_classes" USING btree ("tenant_id","data_class_id","hold_id","hold_revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_dg_purpose_instance_tenant_idx" ON "inbox_v2_data_governance_lifecycle_purpose_instances" USING btree ("tenant_id","purpose_id","anchor_at","purpose_set_id","purpose_set_revision");
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_values_check" CHECK ("inbox_v2_tenant_stream_changes"."stream_position" >= 1
        and "inbox_v2_tenant_stream_changes"."ordinal" >= 1
        and "inbox_v2_tenant_stream_changes"."resulting_revision" >= 1
        and char_length("inbox_v2_tenant_stream_changes"."entity_type_id") between 3 and 256
        and char_length("inbox_v2_tenant_stream_changes"."entity_id") between 1 and 256
        and "inbox_v2_tenant_stream_changes"."state_kind" in ('upsert', 'tombstone')
        and "inbox_v2_tenant_stream_changes"."state_hash" ~ '^sha256:[0-9a-f]{64}$'
        and ("inbox_v2_tenant_stream_changes"."state_reason_id" is null
          or char_length("inbox_v2_tenant_stream_changes"."state_reason_id") <= 256 and (
    (
      "inbox_v2_tenant_stream_changes"."state_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_tenant_stream_changes"."state_reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_tenant_stream_changes"."state_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_tenant_stream_changes"."state_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_tenant_stream_changes"."state_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_tenant_stream_changes"."state_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and ("inbox_v2_tenant_stream_changes"."timeline" is null
          or jsonb_typeof("inbox_v2_tenant_stream_changes"."timeline") = 'object')
        and jsonb_typeof("inbox_v2_tenant_stream_changes"."domain_commit_reference") = 'object'
        and ("inbox_v2_tenant_stream_changes"."payload_reference" is null
          or jsonb_typeof("inbox_v2_tenant_stream_changes"."payload_reference") = 'object')
        and (("inbox_v2_tenant_stream_changes"."state_kind" = 'upsert'
          and "inbox_v2_tenant_stream_changes"."state_schema_id" is not null
          and "inbox_v2_tenant_stream_changes"."state_schema_version" is not null
          and "inbox_v2_tenant_stream_changes"."state_reason_id" is null
          and "inbox_v2_tenant_stream_changes"."payload_reference" is not null)
          or ("inbox_v2_tenant_stream_changes"."state_kind" = 'tombstone'
            and "inbox_v2_tenant_stream_changes"."state_schema_id" is null
            and "inbox_v2_tenant_stream_changes"."state_schema_version" is null
            and "inbox_v2_tenant_stream_changes"."state_reason_id" is not null
            and "inbox_v2_tenant_stream_changes"."payload_reference" is null))
        and isfinite("inbox_v2_tenant_stream_changes"."created_at"));
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
--> statement-breakpoint


do $retention_role_bootstrap$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_retention_owner'
  ) then
    create role hulee_inbox_v2_retention_owner
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_runtime'
  ) then
    create role hulee_inbox_v2_runtime
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if pg_catalog.pg_has_role(
    'hulee_inbox_v2_runtime',
    'hulee_inbox_v2_retention_owner',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_owner_role_must_not_be_inherited';
  end if;
end;
$retention_role_bootstrap$;

alter role hulee_inbox_v2_retention_owner
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;

revoke create on schema public
  from hulee_inbox_v2_retention_owner,
       hulee_inbox_v2_runtime;
grant usage on schema public
  to hulee_inbox_v2_retention_owner,
     hulee_inbox_v2_runtime;

create or replace function public.inbox_v2_auth_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    if current_user = 'hulee_inbox_v2_retention_owner'
       and pg_catalog.current_setting(
         'hulee.inbox_v2_retention_prune', true
       ) = 'enabled'
       and tg_table_name in (
         'inbox_v2_tenant_stream_changes',
         'inbox_v2_domain_events',
         'inbox_v2_outbox_intents'
       ) then
      return old;
    end if;
  end if;
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.authorization_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_auth_stream_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then return old; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.tenant_stream_head_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.last_position <> 0 or new.min_retained_position <> 0
       or new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.tenant_stream_head_initial_state_invalid';
    end if;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.stream_epoch is distinct from old.stream_epoch
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or not (
       (
         new.last_position = old.last_position + 1
         and new.min_retained_position = old.min_retained_position
       ) or (
         new.last_position = old.last_position
         and new.min_retained_position > old.min_retained_position
         and new.min_retained_position <= new.last_position
         and current_user = 'hulee_inbox_v2_retention_owner'
         and pg_catalog.current_setting(
           'hulee.inbox_v2_retention_prune', true
         ) = 'enabled'
       )
     ) then
    raise exception using errcode = '40001',
      message = 'inbox_v2.tenant_stream_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_projection_checkpoint_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.projection_checkpoint_initial_state_invalid';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.projection_id is distinct from old.projection_id
     or new.scope_id is distinct from old.scope_id
     or new.generation is distinct from old.generation
     or new.stream_epoch is distinct from old.stream_epoch
     or new.created_at is distinct from old.created_at
     or new.position <> old.position + 1
     or new.last_commit_id is null
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.projection_checkpoint_gap';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_repository_projection_head_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text := coalesce(to_jsonb(new)->>'tenant_id', to_jsonb(old)->>'tenant_id');
  v_projection_id text := coalesce(to_jsonb(new)->>'projection_id', to_jsonb(old)->>'projection_id');
  v_scope_id text := coalesce(to_jsonb(new)->>'scope_id', to_jsonb(old)->>'scope_id');
begin
  if exists (
    select 1
      from public.inbox_v2_projection_generations generation_row
     where generation_row.tenant_id = v_tenant_id
       and generation_row.projection_id = v_projection_id
       and generation_row.scope_id = v_scope_id
       and not exists (
         select 1
           from public.inbox_v2_projection_checkpoints checkpoint_row
          where checkpoint_row.tenant_id = generation_row.tenant_id
            and checkpoint_row.projection_id = generation_row.projection_id
            and checkpoint_row.scope_id = generation_row.scope_id
            and checkpoint_row.generation = generation_row.generation
            and checkpoint_row.stream_epoch = generation_row.stream_epoch
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.projection_generation_checkpoint_missing';
  end if;

  if (
    exists (
      select 1
        from public.inbox_v2_projection_heads head_row
       where head_row.tenant_id = v_tenant_id
         and head_row.projection_id = v_projection_id
         and head_row.scope_id = v_scope_id
    ) or exists (
      select 1
        from public.inbox_v2_projection_generations generation_row
       where generation_row.tenant_id = v_tenant_id
         and generation_row.projection_id = v_projection_id
         and generation_row.scope_id = v_scope_id
         and generation_row.state = 'active'
    )
  ) and not exists (
    select 1
      from public.inbox_v2_projection_heads head_row
      join public.inbox_v2_projection_generations generation_row
        on generation_row.tenant_id = head_row.tenant_id
       and generation_row.projection_id = head_row.projection_id
       and generation_row.scope_id = head_row.scope_id
       and generation_row.generation = head_row.current_generation
       and generation_row.stream_epoch = head_row.stream_epoch
       and generation_row.projection_schema_version =
           head_row.projection_schema_version
       and generation_row.state = 'active'
     where head_row.tenant_id = v_tenant_id
       and head_row.projection_id = v_projection_id
       and head_row.scope_id = v_scope_id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.projection_head_generation_incoherent';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
  checked_tenant_id text,
  checked_stream_epoch text,
  checked_from_position bigint,
  checked_to_position bigint,
  checked_expected_head_revision bigint,
  checked_mandatory_checkpoint_floor bigint,
  checked_reason_id text,
  checked_advance_hash text,
  checked_changed_at timestamptz
)
returns table (
  tenant_id text,
  stream_epoch text,
  last_position bigint,
  min_retained_position bigint,
  revision bigint,
  created_at timestamptz,
  updated_at timestamptz,
  pruned_commit_count bigint,
  to_position bigint
)
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_db_now timestamptz := pg_catalog.clock_timestamp();
  v_head public.inbox_v2_tenant_stream_heads%rowtype;
  v_persisted_checkpoint_floor bigint;
  v_expected_commit_count bigint;
  v_commit_count bigint;
  v_expected_change_count bigint;
  v_expected_event_count bigint;
  v_expected_intent_count bigint;
  v_expected_work_count bigint;
  v_expected_outcome_count bigint;
  v_deleted_change_count bigint;
  v_deleted_event_count bigint;
  v_deleted_intent_count bigint;
  v_deleted_work_count bigint;
  v_deleted_outcome_count bigint;
begin
  if checked_tenant_id is null
     or checked_stream_epoch is null
     or checked_from_position is null
     or checked_to_position is null
     or checked_expected_head_revision is null
     or checked_mandatory_checkpoint_floor is null
     or checked_reason_id is null
     or checked_advance_hash is null
     or checked_changed_at is null
     or checked_from_position < 0
     or checked_to_position <= checked_from_position
     or checked_expected_head_revision < 1
     or checked_mandatory_checkpoint_floor < checked_to_position
     or not pg_catalog.isfinite(checked_changed_at)
     or pg_catalog.length(checked_stream_epoch) not between 8 and 256
     or pg_catalog.length(checked_reason_id) not between 3 and 256
     or pg_catalog.strpos(checked_reason_id, ':') = 0
     or checked_advance_hash !~ '^sha256:[0-9a-f]{64}$' then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_arguments_invalid';
  end if;

  if checked_changed_at > v_db_now then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_changed_at_future';
  end if;

  if checked_changed_at < v_db_now - interval '1 minute' then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.retained_prefix_changed_at_stale';
  end if;

  select head_row.*
    into v_head
    from public.inbox_v2_tenant_stream_heads head_row
   where head_row.tenant_id = checked_tenant_id
   for update;

  if not found or v_head.stream_epoch <> checked_stream_epoch then
    raise exception using
      errcode = 'P0002',
      message = 'inbox_v2.tenant_stream_not_found';
  end if;
  if v_head.min_retained_position <> checked_from_position
     or v_head.revision <> checked_expected_head_revision then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.retained_prefix_cas_conflict';
  end if;
  if checked_to_position > v_head.last_position
     or checked_changed_at < v_head.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_head_boundary_invalid';
  end if;

  select min(checkpoint_row.position)
    into v_persisted_checkpoint_floor
    from public.inbox_v2_projection_generations generation_row
    join public.inbox_v2_projection_checkpoints checkpoint_row
      on checkpoint_row.tenant_id = generation_row.tenant_id
     and checkpoint_row.projection_id = generation_row.projection_id
     and checkpoint_row.scope_id = generation_row.scope_id
     and checkpoint_row.generation = generation_row.generation
     and checkpoint_row.stream_epoch = generation_row.stream_epoch
   where generation_row.tenant_id = checked_tenant_id
     and generation_row.stream_epoch = checked_stream_epoch
     and generation_row.state in ('active', 'shadow');

  if v_persisted_checkpoint_floor is null
     or checked_mandatory_checkpoint_floor > v_persisted_checkpoint_floor
     or checked_to_position > checked_mandatory_checkpoint_floor then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_checkpoint_blocked';
  end if;

  v_expected_commit_count :=
    checked_to_position - greatest(checked_from_position, 1);
  select count(*),
         coalesce(sum(commit_row.change_count), 0),
         coalesce(sum(commit_row.event_count), 0),
         coalesce(sum(commit_row.outbox_intent_count), 0)
    into v_commit_count,
         v_expected_change_count,
         v_expected_event_count,
         v_expected_intent_count
    from public.inbox_v2_tenant_stream_commits commit_row
   where commit_row.tenant_id = checked_tenant_id
     and commit_row.stream_epoch = checked_stream_epoch
     and commit_row.position >= greatest(checked_from_position, 1)
     and commit_row.position < checked_to_position;

  if v_commit_count <> v_expected_commit_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_commit_gap';
  end if;

  if exists (
    select 1
      from public.inbox_v2_outbox_intents intent_row
      join public.inbox_v2_outbox_work_items work_row
        on work_row.tenant_id = intent_row.tenant_id
       and work_row.intent_id = intent_row.id
     where intent_row.tenant_id = checked_tenant_id
       and intent_row.stream_position >=
           greatest(checked_from_position, 1)
       and intent_row.stream_position < checked_to_position
       and work_row.state in ('pending', 'leased')
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.retained_prefix_outbox_inflight';
  end if;

  select count(*)
    into v_expected_work_count
    from public.inbox_v2_outbox_work_items work_row
    join public.inbox_v2_outbox_intents intent_row
      on intent_row.tenant_id = work_row.tenant_id
     and intent_row.id = work_row.intent_id
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;

  if v_expected_work_count <> v_expected_intent_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_manifest_incoherent';
  end if;

  select count(*)
    into v_expected_outcome_count
    from public.inbox_v2_outbox_outcomes outcome_row
    join public.inbox_v2_outbox_intents intent_row
      on intent_row.tenant_id = outcome_row.tenant_id
     and intent_row.id = outcome_row.intent_id
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;

  perform pg_catalog.set_config(
    'hulee.inbox_v2_retention_prune',
    'enabled',
    true
  );

  delete from public.inbox_v2_outbox_outcomes outcome_row
  using public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position
     and outcome_row.tenant_id = intent_row.tenant_id
     and outcome_row.intent_id = intent_row.id;
  get diagnostics v_deleted_outcome_count = row_count;

  delete from public.inbox_v2_outbox_work_items work_row
  using public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position
     and work_row.tenant_id = intent_row.tenant_id
     and work_row.intent_id = intent_row.id;
  get diagnostics v_deleted_work_count = row_count;

  delete from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = checked_tenant_id
     and intent_row.stream_position >=
         greatest(checked_from_position, 1)
     and intent_row.stream_position < checked_to_position;
  get diagnostics v_deleted_intent_count = row_count;

  delete from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = checked_tenant_id
     and event_row.stream_position >=
         greatest(checked_from_position, 1)
     and event_row.stream_position < checked_to_position;
  get diagnostics v_deleted_event_count = row_count;

  delete from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = checked_tenant_id
     and change_row.stream_position >=
         greatest(checked_from_position, 1)
     and change_row.stream_position < checked_to_position;
  get diagnostics v_deleted_change_count = row_count;

  if v_deleted_change_count <> v_expected_change_count
     or v_deleted_event_count <> v_expected_event_count
     or v_deleted_intent_count <> v_expected_intent_count
     or v_deleted_work_count <> v_expected_work_count
     or v_deleted_outcome_count <> v_expected_outcome_count then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.retained_prefix_manifest_incoherent';
  end if;

  update public.inbox_v2_tenant_stream_heads head_row
     set min_retained_position = checked_to_position,
         revision = head_row.revision + 1,
         updated_at = checked_changed_at
   where head_row.tenant_id = checked_tenant_id
     and head_row.stream_epoch = checked_stream_epoch
     and head_row.min_retained_position = checked_from_position
     and head_row.revision = checked_expected_head_revision
  returning head_row.* into v_head;
  if not found then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.retained_prefix_cas_conflict';
  end if;

  insert into public.inbox_v2_tenant_stream_retention_advances (
    tenant_id, stream_epoch, from_position, to_position,
    expected_head_revision, resulting_head_revision,
    mandatory_checkpoint_floor, pruned_commit_count, reason_id,
    advance_hash, occurred_at, created_at
  ) values (
    checked_tenant_id,
    checked_stream_epoch,
    checked_from_position,
    checked_to_position,
    checked_expected_head_revision,
    v_head.revision,
    checked_mandatory_checkpoint_floor,
    v_commit_count,
    checked_reason_id,
    checked_advance_hash,
    checked_changed_at,
    checked_changed_at
  );

  perform pg_catalog.set_config(
    'hulee.inbox_v2_retention_prune',
    'disabled',
    true
  );

  return query select
    v_head.tenant_id,
    v_head.stream_epoch,
    v_head.last_position,
    v_head.min_retained_position,
    v_head.revision,
    v_head.created_at,
    v_head.updated_at,
    v_commit_count,
    checked_to_position;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_intent_work_init()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  insert into public.inbox_v2_outbox_work_items (
    tenant_id, intent_id, state, attempt_count, available_at,
    revision, created_at, updated_at
  ) values (
    new.tenant_id, new.id, 'pending', 0, new.available_at, 1,
    new.created_at, new.created_at
  );
  return new;
end;
$function$;

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

create or replace function public.inbox_v2_repository_outbox_finalize_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_expected_kind public.inbox_v2_outbox_outcome_kind;
begin
  if old.state = 'leased' and new.state <> 'leased' then
    v_expected_kind := case new.state
      when 'pending' then 'retry'::public.inbox_v2_outbox_outcome_kind
      when 'processed' then 'processed'::public.inbox_v2_outbox_outcome_kind
      when 'dead' then 'dead'::public.inbox_v2_outbox_outcome_kind
    end;
    if not exists (
      select 1
        from public.inbox_v2_outbox_outcomes outcome_row
       where outcome_row.tenant_id = new.tenant_id
         and outcome_row.intent_id = new.intent_id
         and outcome_row.outcome_revision = new.revision
         and outcome_row.kind = v_expected_kind
         and outcome_row.lease_token_hash = old.lease_token_hash
         and outcome_row.occurred_at = new.updated_at
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbox_finalize_outcome_missing';
    end if;
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_repository_outbox_outcome_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    if current_user = 'hulee_inbox_v2_retention_owner'
       and pg_catalog.current_setting(
         'hulee.inbox_v2_retention_prune', true
       ) = 'enabled' then
      return old;
    end if;
  end if;
  raise exception using errcode = '23514',
    message = 'inbox_v2.outbox_outcome_immutable';
end;
$function$;

create or replace function public.inbox_v2_repository_retention_advance_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
  ) then
    return old;
  end if;
  raise exception using errcode = '23514',
    message = 'inbox_v2.tenant_stream_retention_advance_immutable';
end;
$function$;

grant select on table
  public.tenants,
  public.inbox_v2_tenant_stream_heads,
  public.inbox_v2_tenant_stream_commits,
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_projection_generations,
  public.inbox_v2_projection_checkpoints,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes
to hulee_inbox_v2_retention_owner;

grant update on table
  public.inbox_v2_tenant_stream_heads
to hulee_inbox_v2_retention_owner;

grant delete on table
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes
to hulee_inbox_v2_retention_owner;

grant insert on table
  public.inbox_v2_tenant_stream_retention_advances
to hulee_inbox_v2_retention_owner;

grant create on schema public to hulee_inbox_v2_retention_owner;
alter function public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
  text,
  text,
  bigint,
  bigint,
  bigint,
  bigint,
  text,
  text,
  timestamptz
) owner to hulee_inbox_v2_retention_owner;
revoke create on schema public from hulee_inbox_v2_retention_owner;

revoke all privileges on function
  public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    text,
    text,
    timestamptz
  )
from public;

grant execute on function
  public.inbox_v2_advance_tenant_stream_retained_prefix_v1(
    text,
    text,
    bigint,
    bigint,
    bigint,
    bigint,
    text,
    text,
    timestamptz
  )
to hulee_inbox_v2_runtime;

revoke delete, truncate on table
  public.inbox_v2_tenant_stream_commits,
  public.inbox_v2_tenant_stream_changes,
  public.inbox_v2_domain_events,
  public.inbox_v2_outbox_intents,
  public.inbox_v2_outbox_work_items,
  public.inbox_v2_outbox_outcomes,
  public.inbox_v2_tenant_stream_retention_advances
from public,
     hulee_inbox_v2_runtime;

do $retention_boundary_audit$
declare
  v_function_oid oid := pg_catalog.to_regprocedure(
    'public.inbox_v2_advance_tenant_stream_retained_prefix_v1(text,text,bigint,bigint,bigint,bigint,text,text,timestamp with time zone)'
  );
begin
  if not exists (
    select 1
      from pg_catalog.pg_roles role_row
     where role_row.rolname = 'hulee_inbox_v2_retention_owner'
       and not role_row.rolcanlogin
       and not role_row.rolsuper
       and not role_row.rolcreatedb
       and not role_row.rolcreaterole
       and not role_row.rolreplication
       and not role_row.rolbypassrls
  ) or pg_catalog.pg_has_role(
    'hulee_inbox_v2_runtime',
    'hulee_inbox_v2_retention_owner',
    'MEMBER'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_database_role_unsafe';
  end if;

  if v_function_oid is null or not exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure_row.proowner
     where procedure_row.oid = v_function_oid
       and procedure_row.prosecdef
       and owner_role.rolname = 'hulee_inbox_v2_retention_owner'
       and procedure_row.proconfig @>
         array['search_path=pg_catalog, public, pg_temp']::text[]
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_outcomes%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_work_items%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_outbox_intents%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_domain_events%'
       and procedure_row.prosrc like
         '%delete from public.inbox_v2_tenant_stream_changes%'
       and procedure_row.prosrc not like
         '%delete from public.inbox_v2_tenant_stream_commits%'
       and procedure_row.prosrc like
         '%v_db_now timestamptz := pg_catalog.clock_timestamp()%'
       and procedure_row.prosrc like
         '%inbox_v2.retained_prefix_changed_at_future%'
       and procedure_row.prosrc like
         '%inbox_v2.retained_prefix_changed_at_stale%'
       and procedure_row.prosrc like
         '%update public.inbox_v2_tenant_stream_heads%'
       and procedure_row.prosrc like
         '%updated_at = checked_changed_at%'
       and procedure_row.prosrc like
         '%insert into public.inbox_v2_tenant_stream_retention_advances%'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_entrypoint_definition_invalid';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) privilege_row
     where procedure_row.oid = v_function_oid
       and privilege_row.grantee = 0
       and privilege_row.privilege_type = 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hulee_inbox_v2_runtime',
    v_function_oid,
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_entrypoint_acl_invalid';
  end if;

  if exists (
    select 1
      from (
        values
          ('public.inbox_v2_tenant_stream_commits'),
          ('public.inbox_v2_tenant_stream_changes'),
          ('public.inbox_v2_domain_events'),
          ('public.inbox_v2_outbox_intents'),
          ('public.inbox_v2_outbox_work_items'),
          ('public.inbox_v2_outbox_outcomes'),
          ('public.inbox_v2_tenant_stream_retention_advances')
      ) as protected_table(table_name)
     where pg_catalog.has_table_privilege(
       'hulee_inbox_v2_runtime',
       protected_table.table_name,
       'DELETE'
     )
  ) or pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_tenant_stream_commits',
    'DELETE'
  ) or pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_tenant_stream_retention_advances',
    'DELETE'
  ) or not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_work_items',
    'SELECT,DELETE'
  ) or not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_retention_owner',
    'public.inbox_v2_outbox_outcomes',
    'SELECT,DELETE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.retention_direct_delete_boundary_invalid';
  end if;
end;
$retention_boundary_audit$;

create trigger inbox_v2_projection_checkpoint_guard_trigger
before insert or update on public.inbox_v2_projection_checkpoints
for each row execute function public.inbox_v2_repository_projection_checkpoint_guard();

create constraint trigger inbox_v2_projection_generation_head_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_generations
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create constraint trigger inbox_v2_projection_head_generation_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_heads
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create constraint trigger inbox_v2_projection_checkpoint_generation_coherence_trigger
after insert or update or delete on public.inbox_v2_projection_checkpoints
deferrable initially deferred
for each row execute function public.inbox_v2_repository_projection_head_coherence();

create trigger inbox_v2_outbox_intent_work_init_trigger
after insert on public.inbox_v2_outbox_intents
for each row execute function public.inbox_v2_repository_outbox_intent_work_init();

create trigger inbox_v2_outbox_work_guard_trigger
before insert or update on public.inbox_v2_outbox_work_items
for each row execute function public.inbox_v2_repository_outbox_work_guard();

create constraint trigger inbox_v2_outbox_finalize_coherence_trigger
after update on public.inbox_v2_outbox_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_repository_outbox_finalize_coherence();

create trigger inbox_v2_outbox_outcome_immutable_trigger
before update or delete on public.inbox_v2_outbox_outcomes
for each row execute function public.inbox_v2_repository_outbox_outcome_immutable();

create trigger inbox_v2_tenant_stream_retention_advance_immutable_trigger
before update or delete on public.inbox_v2_tenant_stream_retention_advances
for each row execute function public.inbox_v2_repository_retention_advance_immutable();


--> statement-breakpoint
do $role_bootstrap$
begin
  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_membership_owner'
  ) then
    create role hulee_inbox_v2_membership_owner
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_runtime'
  ) then
    create role hulee_inbox_v2_runtime
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if not exists (
    select 1 from pg_catalog.pg_roles
     where rolname = 'hulee_inbox_v2_membership_repair'
  ) then
    create role hulee_inbox_v2_membership_repair
      nologin nosuperuser nocreatedb nocreaterole
      inherit noreplication nobypassrls;
  end if;

  if pg_catalog.pg_has_role(
       'hulee_inbox_v2_runtime',
       'hulee_inbox_v2_membership_owner',
       'MEMBER'
     ) or pg_catalog.pg_has_role(
       'hulee_inbox_v2_membership_repair',
       'hulee_inbox_v2_membership_owner',
       'MEMBER'
     ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_owner_role_must_not_be_inherited';
  end if;
end;
$role_bootstrap$;

alter role hulee_inbox_v2_membership_owner
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
alter role hulee_inbox_v2_runtime
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;
alter role hulee_inbox_v2_membership_repair
  with nologin nosuperuser nocreatedb nocreaterole
       inherit noreplication nobypassrls;

revoke create on schema public
  from hulee_inbox_v2_membership_owner,
       hulee_inbox_v2_runtime,
       hulee_inbox_v2_membership_repair;
grant usage on schema public
  to hulee_inbox_v2_membership_owner,
     hulee_inbox_v2_runtime,
     hulee_inbox_v2_membership_repair;

revoke all privileges on table
  public.inbox_v2_conversation_membership_heads,
  public.inbox_v2_conversation_membership_commits,
  public.inbox_v2_participant_membership_episodes,
  public.inbox_v2_participant_membership_transitions
from public,
     hulee_inbox_v2_runtime,
     hulee_inbox_v2_membership_repair;

grant select on table
  public.inbox_v2_conversation_membership_heads,
  public.inbox_v2_conversation_membership_commits,
  public.inbox_v2_participant_membership_episodes,
  public.inbox_v2_participant_membership_transitions
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;

grant select, insert, update, delete on table
  public.inbox_v2_conversation_membership_heads,
  public.inbox_v2_conversation_membership_commits,
  public.inbox_v2_participant_membership_episodes,
  public.inbox_v2_participant_membership_transitions
to hulee_inbox_v2_membership_owner;

grant select on table
  public.inbox_v2_conversation_participants,
  public.inbox_v2_conversations,
  public.employees,
  public.inbox_v2_provider_roster_member_evidence,
  public.inbox_v2_provider_roster_evidence,
  public.inbox_v2_source_thread_bindings,
  public.inbox_v2_external_threads,
  public.inbox_v2_source_external_identities,
  public.inbox_v2_provider_membership_ordering_heads
to hulee_inbox_v2_membership_owner;
grant update on table
  public.inbox_v2_conversation_participants,
  public.employees,
  public.inbox_v2_provider_membership_ordering_heads
to hulee_inbox_v2_membership_owner;

grant select on table
  public.inbox_v2_conversation_participants,
  public.inbox_v2_conversations,
  public.employees,
  public.inbox_v2_provider_roster_member_evidence,
  public.inbox_v2_provider_roster_evidence,
  public.inbox_v2_source_thread_bindings,
  public.inbox_v2_external_threads,
  public.inbox_v2_source_external_identities,
  public.inbox_v2_provider_membership_ordering_heads
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;
grant insert on table
  public.inbox_v2_conversation_participants
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;
grant insert, update on table
  public.inbox_v2_provider_membership_ordering_heads
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;

create or replace function public.inbox_v2_lock_conversation_membership_head_v1(
  checked_tenant_id text,
  checked_conversation_id text
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  locked_membership_revision bigint;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25001',
      message = 'inbox_v2.membership_requires_read_committed';
  end if;
  if checked_tenant_id is null or checked_conversation_id is null then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.membership_head_lock_scope_invalid';
  end if;

  select head_row.membership_revision
    into locked_membership_revision
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id
   for update;

  return locked_membership_revision;
end;
$function$;

grant create on schema public to hulee_inbox_v2_membership_owner;
alter function public.inbox_v2_lock_conversation_membership_head_v1(text, text)
  owner to hulee_inbox_v2_membership_owner;
revoke create on schema public from hulee_inbox_v2_membership_owner;

revoke all privileges on function
  public.inbox_v2_lock_conversation_membership_head_v1(text, text)
from public;
grant execute on function
  public.inbox_v2_lock_conversation_membership_head_v1(text, text)
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;

create or replace function public.inbox_v2_lock_participant_membership_mutation_v1(
  checked_tenant_id text,
  checked_conversation_id text,
  checked_expected_membership_revision bigint,
  checked_participant_id text,
  checked_episode_id text,
  checked_origin_kind public.inbox_v2_participant_membership_origin_kind,
  checked_target_state public.inbox_v2_participant_membership_state
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  locked_membership_revision bigint;
  locked_employee_id text;
  locked_employee_deactivated_at timestamptz;
  locked_conversation_transport public.inbox_v2_conversation_transport;
  locked_episode_origin public.inbox_v2_participant_membership_origin_kind;
begin
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using
      errcode = '25001',
      message = 'inbox_v2.membership_requires_read_committed';
  end if;

  if checked_tenant_id is null
     or checked_conversation_id is null
     or checked_expected_membership_revision is null
     or checked_expected_membership_revision < 0
     or checked_participant_id is null
     or checked_origin_kind is null
     or checked_target_state is null then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.membership_lock_scope_invalid';
  end if;

  -- Aggregate mutex is always first. It also makes the following unlocked
  -- discovery reads stable against every supported membership writer.
  select head_row.membership_revision
    into locked_membership_revision
    from public.inbox_v2_conversation_membership_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.conversation_id = checked_conversation_id
   for update;

  if not found
     or locked_membership_revision <> checked_expected_membership_revision then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.conversation_membership_revision_conflict';
  end if;

  if checked_episode_id is not null then
    select episode_row.origin_kind
      into locked_episode_origin
      from public.inbox_v2_participant_membership_episodes episode_row
     where episode_row.tenant_id = checked_tenant_id
       and episode_row.id = checked_episode_id
       and episode_row.participant_id = checked_participant_id
       and episode_row.conversation_id = checked_conversation_id;

    if not found or locked_episode_origin <> checked_origin_kind then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.membership_episode_lock_target_missing';
    end if;
  end if;

  -- Employee fencing is second. Closing an internal episode still takes the
  -- fence, but it deliberately permits an already-deactivated Employee.
  if checked_origin_kind = 'hulee_internal_command' then
    select employee_row.id,
           employee_row.deactivated_at,
           conversation_row.transport
      into locked_employee_id,
           locked_employee_deactivated_at,
           locked_conversation_transport
      from public.inbox_v2_conversation_participants participant_row
      join public.employees employee_row
        on employee_row.tenant_id = participant_row.tenant_id
       and employee_row.id = participant_row.subject_employee_id
      join public.inbox_v2_conversations conversation_row
        on conversation_row.tenant_id = participant_row.tenant_id
       and conversation_row.id = participant_row.conversation_id
     where participant_row.tenant_id = checked_tenant_id
       and participant_row.id = checked_participant_id
       and participant_row.conversation_id = checked_conversation_id
       and participant_row.subject_kind = 'employee'
     for no key update of employee_row;

    if not found
       or locked_employee_id is null
       or locked_conversation_transport <> 'internal'
       or (
         checked_target_state in ('pending', 'active')
         and locked_employee_deactivated_at is not null
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.internal_membership_subject_or_employee_invalid';
    end if;
  end if;

  -- The exact participant and current episode are locked only after the
  -- aggregate head and optional Employee fence.
  perform 1
    from public.inbox_v2_conversation_participants participant_row
   where participant_row.tenant_id = checked_tenant_id
     and participant_row.id = checked_participant_id
     and participant_row.conversation_id = checked_conversation_id
   for update;
  if not found then
    raise exception using
      errcode = '23503',
      message = 'inbox_v2.membership_participant_lock_target_missing';
  end if;

  if checked_episode_id is not null then
    perform 1
      from public.inbox_v2_participant_membership_episodes episode_row
     where episode_row.tenant_id = checked_tenant_id
       and episode_row.id = checked_episode_id
       and episode_row.participant_id = checked_participant_id
       and episode_row.conversation_id = checked_conversation_id
       and episode_row.origin_kind = checked_origin_kind
     for update;
    if not found then
      raise exception using
        errcode = '23503',
        message = 'inbox_v2.membership_episode_lock_target_missing';
    end if;
  end if;

  return locked_membership_revision;
end;
$function$;

grant create on schema public to hulee_inbox_v2_membership_owner;
alter function public.inbox_v2_lock_participant_membership_mutation_v1(
  text,
  text,
  bigint,
  text,
  text,
  public.inbox_v2_participant_membership_origin_kind,
  public.inbox_v2_participant_membership_state
) owner to hulee_inbox_v2_membership_owner;
revoke create on schema public from hulee_inbox_v2_membership_owner;

revoke all privileges on function
  public.inbox_v2_lock_participant_membership_mutation_v1(
    text,
    text,
    bigint,
    text,
    text,
    public.inbox_v2_participant_membership_origin_kind,
    public.inbox_v2_participant_membership_state
  )
from public,
     hulee_inbox_v2_runtime,
     hulee_inbox_v2_membership_repair;

create or replace function public.inbox_v2_apply_participant_membership_mutation_v1(
  checked_payload jsonb
)
returns bigint
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  allowed_keys constant text[] := array[
    'version',
    'operation',
    'tenantId',
    'conversationId',
    'participantId',
    'episodeId',
    'transitionId',
    'expectedMembershipRevision',
    'resultingMembershipRevision',
    'occurredAt',
    'originKind',
    'targetState',
    'episodeOriginProviderRosterMemberEvidenceId',
    'episodeOriginProviderRosterEvidenceId',
    'episodeOriginSourceThreadBindingId',
    'episodeOriginSourceExternalIdentityId',
    'episodeOriginOrderingKind',
    'episodeOriginOrderingScopeToken',
    'episodeOriginOrderingComparatorId',
    'episodeOriginOrderingComparatorRevision',
    'episodeOriginOrderingPosition',
    'episodeProviderOrderingHeadPosition',
    'episodeOriginMigrationProvenanceId',
    'episodeOriginSystemPolicyId',
    'episodeState',
    'episodeRole',
    'episodeEvidenceClassification',
    'episodeValidFrom',
    'episodeValidTo',
    'episodeExpectedRevision',
    'episodeResultingRevision',
    'transitionIntent',
    'transitionFromState',
    'transitionToState',
    'transitionFromRole',
    'transitionToRole',
    'transitionCauseKind',
    'transitionCauseProviderEvidenceKind',
    'transitionCauseProviderRosterMemberEvidenceId',
    'transitionCauseProviderRosterEvidenceId',
    'transitionCauseSourceThreadBindingId',
    'transitionCauseSourceExternalIdentityId',
    'transitionCauseOrderingKind',
    'transitionCauseOrderingScopeToken',
    'transitionCauseOrderingComparatorId',
    'transitionCauseOrderingComparatorRevision',
    'transitionCauseOrderingPosition',
    'transitionCauseActorEmployeeId',
    'transitionCauseTrustedServiceId',
    'transitionCauseMigrationProvenanceId',
    'transitionCauseSystemPolicyId',
    'transitionReasonCodeId',
    'transitionExpectedRevision',
    'transitionCurrentRevision',
    'transitionResultingRevision'
  ]::text[];
  mutation_version integer;
  mutation_operation text;
  mutation_tenant_id text;
  mutation_conversation_id text;
  mutation_participant_id text;
  mutation_episode_id text;
  mutation_transition_id text;
  mutation_expected_membership_revision bigint;
  mutation_resulting_membership_revision bigint;
  mutation_occurred_at timestamptz;
  mutation_origin_kind public.inbox_v2_participant_membership_origin_kind;
  mutation_target_state public.inbox_v2_participant_membership_state;
  mutation_episode_expected_revision bigint;
  mutation_episode_resulting_revision bigint;
  mutation_transition_expected_revision bigint;
  mutation_transition_current_revision bigint;
  mutation_transition_resulting_revision bigint;
  affected_rows bigint;
begin
  if checked_payload is null
     or pg_catalog.jsonb_typeof(checked_payload) <> 'object'
     or not (checked_payload ?& allowed_keys)
     or checked_payload - allowed_keys <> '{}'::jsonb then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.membership_mutation_payload_shape_invalid';
  end if;

  mutation_version := (checked_payload ->> 'version')::integer;
  mutation_operation := checked_payload ->> 'operation';
  mutation_tenant_id := checked_payload ->> 'tenantId';
  mutation_conversation_id := checked_payload ->> 'conversationId';
  mutation_participant_id := checked_payload ->> 'participantId';
  mutation_episode_id := checked_payload ->> 'episodeId';
  mutation_transition_id := checked_payload ->> 'transitionId';
  mutation_expected_membership_revision :=
    (checked_payload ->> 'expectedMembershipRevision')::bigint;
  mutation_resulting_membership_revision :=
    (checked_payload ->> 'resultingMembershipRevision')::bigint;
  mutation_occurred_at := (checked_payload ->> 'occurredAt')::timestamptz;
  mutation_origin_kind :=
    (checked_payload ->> 'originKind')::public.inbox_v2_participant_membership_origin_kind;
  mutation_target_state :=
    (checked_payload ->> 'targetState')::public.inbox_v2_participant_membership_state;
  mutation_episode_expected_revision :=
    (checked_payload ->> 'episodeExpectedRevision')::bigint;
  mutation_episode_resulting_revision :=
    (checked_payload ->> 'episodeResultingRevision')::bigint;
  mutation_transition_expected_revision :=
    (checked_payload ->> 'transitionExpectedRevision')::bigint;
  mutation_transition_current_revision :=
    (checked_payload ->> 'transitionCurrentRevision')::bigint;
  mutation_transition_resulting_revision :=
    (checked_payload ->> 'transitionResultingRevision')::bigint;

  if mutation_version <> 1
     or mutation_operation not in ('start', 'transition')
     or mutation_tenant_id is null
     or mutation_conversation_id is null
     or mutation_participant_id is null
     or mutation_episode_id is null
     or mutation_transition_id is null
     or mutation_expected_membership_revision is null
     or mutation_expected_membership_revision < 0
     or mutation_resulting_membership_revision is null
     or mutation_resulting_membership_revision < 1
     or mutation_resulting_membership_revision <>
       mutation_expected_membership_revision + 1
     or mutation_occurred_at is null
     or not pg_catalog.isfinite(mutation_occurred_at)
     or mutation_occurred_at >
       pg_catalog.clock_timestamp() + interval '5 minutes'
     or mutation_origin_kind is null
     or mutation_target_state is null
     or (checked_payload ->> 'episodeState')::public.inbox_v2_participant_membership_state
       is distinct from mutation_target_state
     or (checked_payload ->> 'transitionToState')::public.inbox_v2_participant_membership_state
       is distinct from mutation_target_state
     or (checked_payload ->> 'transitionCauseKind')::public.inbox_v2_participant_membership_origin_kind
       is distinct from mutation_origin_kind
     or mutation_episode_resulting_revision is null
     or mutation_transition_resulting_revision is null
     or mutation_episode_resulting_revision <>
       mutation_transition_resulting_revision then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.membership_mutation_payload_invalid';
  end if;

  if mutation_operation = 'start' then
    if mutation_target_state not in ('pending', 'active')
       or mutation_episode_expected_revision is not null
       or mutation_episode_resulting_revision <> 1
       or mutation_transition_expected_revision is not null
       or mutation_transition_current_revision is not null
       or checked_payload ->> 'transitionFromState' is not null
       or checked_payload ->> 'transitionFromRole' is not null
       or (checked_payload ->> 'episodeValidFrom')::timestamptz <>
         mutation_occurred_at
       or checked_payload ->> 'episodeValidTo' is not null
       or (
         mutation_target_state = 'pending'
         and checked_payload ->> 'transitionIntent' <> 'initial_pending'
       )
       or (
         mutation_target_state = 'active'
         and checked_payload ->> 'transitionIntent' <> 'initial_active'
       ) then
      raise exception using
        errcode = '22023',
        message = 'inbox_v2.membership_start_payload_invalid';
    end if;
  elsif mutation_episode_expected_revision is null
     or mutation_episode_expected_revision < 1
     or mutation_transition_expected_revision is distinct from
       mutation_episode_expected_revision
     or mutation_transition_current_revision is distinct from
       mutation_episode_expected_revision
     or mutation_episode_resulting_revision <>
       mutation_episode_expected_revision + 1
     or checked_payload ->> 'transitionFromState' is null
     or checked_payload ->> 'transitionFromRole' is null
     or checked_payload ->> 'transitionIntent' in (
       'initial_pending',
       'initial_active'
     ) then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.membership_transition_payload_invalid';
  end if;

  perform public.inbox_v2_lock_participant_membership_mutation_v1(
    mutation_tenant_id,
    mutation_conversation_id,
    mutation_expected_membership_revision,
    mutation_participant_id,
    case when mutation_operation = 'transition' then mutation_episode_id end,
    mutation_origin_kind,
    mutation_target_state
  );

  insert into public.inbox_v2_conversation_membership_commits (
    tenant_id,
    conversation_id,
    expected_membership_revision,
    resulting_membership_revision,
    occurred_at
  ) values (
    mutation_tenant_id,
    mutation_conversation_id,
    mutation_expected_membership_revision,
    mutation_resulting_membership_revision,
    mutation_occurred_at
  );

  if mutation_operation = 'start' then
    insert into public.inbox_v2_participant_membership_episodes (
      tenant_id,
      id,
      participant_id,
      conversation_id,
      origin_kind,
      origin_provider_roster_member_evidence_id,
      origin_provider_roster_evidence_id,
      origin_source_thread_binding_id,
      origin_source_external_identity_id,
      origin_ordering_kind,
      origin_ordering_scope_token,
      origin_ordering_comparator_id,
      origin_ordering_comparator_revision,
      origin_ordering_position,
      provider_ordering_head_position,
      origin_migration_provenance_id,
      origin_system_policy_id,
      state,
      role,
      evidence_classification,
      valid_from,
      valid_to,
      revision
    ) values (
      mutation_tenant_id,
      mutation_episode_id,
      mutation_participant_id,
      mutation_conversation_id,
      mutation_origin_kind,
      checked_payload ->> 'episodeOriginProviderRosterMemberEvidenceId',
      checked_payload ->> 'episodeOriginProviderRosterEvidenceId',
      checked_payload ->> 'episodeOriginSourceThreadBindingId',
      checked_payload ->> 'episodeOriginSourceExternalIdentityId',
      checked_payload ->> 'episodeOriginOrderingKind',
      checked_payload ->> 'episodeOriginOrderingScopeToken',
      checked_payload ->> 'episodeOriginOrderingComparatorId',
      (checked_payload ->> 'episodeOriginOrderingComparatorRevision')::bigint,
      (checked_payload ->> 'episodeOriginOrderingPosition')::bigint,
      (checked_payload ->> 'episodeProviderOrderingHeadPosition')::bigint,
      checked_payload ->> 'episodeOriginMigrationProvenanceId',
      checked_payload ->> 'episodeOriginSystemPolicyId',
      mutation_target_state,
      (checked_payload ->> 'episodeRole')::public.inbox_v2_participant_membership_role,
      (checked_payload ->> 'episodeEvidenceClassification')::public.inbox_v2_participant_membership_evidence,
      (checked_payload ->> 'episodeValidFrom')::timestamptz,
      (checked_payload ->> 'episodeValidTo')::timestamptz,
      mutation_episode_resulting_revision
    );
  end if;

  insert into public.inbox_v2_participant_membership_transitions (
    tenant_id,
    id,
    episode_id,
    participant_id,
    conversation_id,
    membership_revision,
    intent,
    from_state,
    to_state,
    from_role,
    to_role,
    cause_kind,
    cause_provider_evidence_kind,
    cause_provider_roster_member_evidence_id,
    cause_provider_roster_evidence_id,
    cause_source_thread_binding_id,
    cause_source_external_identity_id,
    cause_ordering_kind,
    cause_ordering_scope_token,
    cause_ordering_comparator_id,
    cause_ordering_comparator_revision,
    cause_ordering_position,
    cause_actor_employee_id,
    cause_trusted_service_id,
    cause_migration_provenance_id,
    cause_system_policy_id,
    reason_code_id,
    expected_revision,
    current_revision,
    resulting_revision,
    occurred_at
  ) values (
    mutation_tenant_id,
    mutation_transition_id,
    mutation_episode_id,
    mutation_participant_id,
    mutation_conversation_id,
    mutation_resulting_membership_revision,
    (checked_payload ->> 'transitionIntent')::public.inbox_v2_participant_membership_transition_intent,
    (checked_payload ->> 'transitionFromState')::public.inbox_v2_participant_membership_state,
    mutation_target_state,
    (checked_payload ->> 'transitionFromRole')::public.inbox_v2_participant_membership_role,
    (checked_payload ->> 'transitionToRole')::public.inbox_v2_participant_membership_role,
    mutation_origin_kind,
    (checked_payload ->> 'transitionCauseProviderEvidenceKind')::public.inbox_v2_provider_membership_evidence_kind,
    checked_payload ->> 'transitionCauseProviderRosterMemberEvidenceId',
    checked_payload ->> 'transitionCauseProviderRosterEvidenceId',
    checked_payload ->> 'transitionCauseSourceThreadBindingId',
    checked_payload ->> 'transitionCauseSourceExternalIdentityId',
    checked_payload ->> 'transitionCauseOrderingKind',
    checked_payload ->> 'transitionCauseOrderingScopeToken',
    checked_payload ->> 'transitionCauseOrderingComparatorId',
    (checked_payload ->> 'transitionCauseOrderingComparatorRevision')::bigint,
    (checked_payload ->> 'transitionCauseOrderingPosition')::bigint,
    checked_payload ->> 'transitionCauseActorEmployeeId',
    checked_payload ->> 'transitionCauseTrustedServiceId',
    checked_payload ->> 'transitionCauseMigrationProvenanceId',
    checked_payload ->> 'transitionCauseSystemPolicyId',
    checked_payload ->> 'transitionReasonCodeId',
    mutation_transition_expected_revision,
    mutation_transition_current_revision,
    mutation_transition_resulting_revision,
    mutation_occurred_at
  );

  if mutation_operation = 'transition' then
    update public.inbox_v2_participant_membership_episodes
       set state = mutation_target_state,
           role = (checked_payload ->> 'episodeRole')::public.inbox_v2_participant_membership_role,
           valid_to = (checked_payload ->> 'episodeValidTo')::timestamptz,
           revision = mutation_episode_resulting_revision,
           provider_ordering_head_position =
             (checked_payload ->> 'episodeProviderOrderingHeadPosition')::bigint
     where tenant_id = mutation_tenant_id
       and id = mutation_episode_id
       and participant_id = mutation_participant_id
       and conversation_id = mutation_conversation_id
       and origin_kind = mutation_origin_kind
       and origin_provider_roster_member_evidence_id is not distinct from
         checked_payload ->> 'episodeOriginProviderRosterMemberEvidenceId'
       and origin_provider_roster_evidence_id is not distinct from
         checked_payload ->> 'episodeOriginProviderRosterEvidenceId'
       and origin_source_thread_binding_id is not distinct from
         checked_payload ->> 'episodeOriginSourceThreadBindingId'
       and origin_source_external_identity_id is not distinct from
         checked_payload ->> 'episodeOriginSourceExternalIdentityId'
       and origin_ordering_kind is not distinct from
         checked_payload ->> 'episodeOriginOrderingKind'
       and origin_ordering_scope_token is not distinct from
         checked_payload ->> 'episodeOriginOrderingScopeToken'
       and origin_ordering_comparator_id is not distinct from
         checked_payload ->> 'episodeOriginOrderingComparatorId'
       and origin_ordering_comparator_revision is not distinct from
         (checked_payload ->> 'episodeOriginOrderingComparatorRevision')::bigint
       and origin_ordering_position is not distinct from
         (checked_payload ->> 'episodeOriginOrderingPosition')::bigint
       and origin_migration_provenance_id is not distinct from
         checked_payload ->> 'episodeOriginMigrationProvenanceId'
       and origin_system_policy_id is not distinct from
         checked_payload ->> 'episodeOriginSystemPolicyId'
       and evidence_classification =
         (checked_payload ->> 'episodeEvidenceClassification')::public.inbox_v2_participant_membership_evidence
       and valid_from = (checked_payload ->> 'episodeValidFrom')::timestamptz
       and state =
         (checked_payload ->> 'transitionFromState')::public.inbox_v2_participant_membership_state
       and role =
         (checked_payload ->> 'transitionFromRole')::public.inbox_v2_participant_membership_role
       and revision = mutation_episode_expected_revision;
    get diagnostics affected_rows = row_count;
    if affected_rows <> 1 then
      raise exception using
        errcode = '40001',
        message = 'inbox_v2.membership_episode_revision_conflict';
    end if;
  end if;

  update public.inbox_v2_conversation_membership_heads
     set membership_revision = mutation_resulting_membership_revision,
         updated_at = mutation_occurred_at
   where tenant_id = mutation_tenant_id
     and conversation_id = mutation_conversation_id
     and membership_revision = mutation_expected_membership_revision;
  get diagnostics affected_rows = row_count;
  if affected_rows <> 1 then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.conversation_membership_revision_conflict';
  end if;

  return mutation_resulting_membership_revision;
end;
$function$;

grant create on schema public to hulee_inbox_v2_membership_owner;
alter function public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)
  owner to hulee_inbox_v2_membership_owner;
revoke create on schema public from hulee_inbox_v2_membership_owner;

revoke all privileges on function
  public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)
from public;

grant execute on function
  public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)
to hulee_inbox_v2_runtime,
   hulee_inbox_v2_membership_repair;

do $boundary_audit$
declare
  head_lock_function_oid oid := pg_catalog.to_regprocedure(
    'public.inbox_v2_lock_conversation_membership_head_v1(text,text)'
  );
  boundary_function_oid oid := pg_catalog.to_regprocedure(
    'public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)'
  );
  lock_function_oid oid := pg_catalog.to_regprocedure(
    'public.inbox_v2_lock_participant_membership_mutation_v1(text,text,bigint,text,text,public.inbox_v2_participant_membership_origin_kind,public.inbox_v2_participant_membership_state)'
  );
begin
  if exists (
    select 1
      from pg_catalog.pg_roles role_row
     where role_row.rolname in (
       'hulee_inbox_v2_membership_owner',
       'hulee_inbox_v2_runtime',
       'hulee_inbox_v2_membership_repair'
     )
       and (
         role_row.rolcanlogin
         or role_row.rolsuper
         or role_row.rolcreatedb
         or role_row.rolcreaterole
         or role_row.rolreplication
         or role_row.rolbypassrls
       )
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_database_role_unsafe';
  end if;

  if exists (
    select 1
      from (
        values
          ('hulee_inbox_v2_runtime'),
          ('hulee_inbox_v2_membership_repair')
      ) as expected_role(role_name)
      cross join (
        values
          ('public.inbox_v2_conversation_membership_heads'),
          ('public.inbox_v2_conversation_membership_commits'),
          ('public.inbox_v2_participant_membership_episodes'),
          ('public.inbox_v2_participant_membership_transitions')
      ) as revision_table(table_name)
      cross join (
        values
          ('INSERT'),
          ('UPDATE'),
          ('DELETE'),
          ('TRUNCATE'),
          ('REFERENCES'),
          ('TRIGGER')
      ) as forbidden_privilege(privilege_name)
     where pg_catalog.has_table_privilege(
       expected_role.role_name,
       revision_table.table_name,
       forbidden_privilege.privilege_name
     )
  ) or exists (
    select 1
      from (
        values
          ('hulee_inbox_v2_runtime'),
          ('hulee_inbox_v2_membership_repair')
      ) as expected_role(role_name)
      cross join (
        values
          ('public.inbox_v2_conversation_membership_heads'),
          ('public.inbox_v2_conversation_membership_commits'),
          ('public.inbox_v2_participant_membership_episodes'),
          ('public.inbox_v2_participant_membership_transitions')
      ) as revision_table(table_name)
     where not pg_catalog.has_table_privilege(
       expected_role.role_name,
       revision_table.table_name,
       'SELECT'
     )
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_table_privilege_boundary_invalid';
  end if;

  if not pg_catalog.has_table_privilege(
       'hulee_inbox_v2_membership_owner',
       'public.inbox_v2_conversation_participants',
       'UPDATE'
     )
     or not pg_catalog.has_table_privilege(
       'hulee_inbox_v2_membership_owner',
       'public.employees',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'hulee_inbox_v2_runtime',
       'public.inbox_v2_conversation_participants',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'hulee_inbox_v2_runtime',
       'public.employees',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'hulee_inbox_v2_membership_repair',
       'public.inbox_v2_conversation_participants',
       'UPDATE'
     )
     or pg_catalog.has_table_privilege(
       'hulee_inbox_v2_membership_repair',
       'public.employees',
       'UPDATE'
     ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_lock_target_privileges_invalid';
  end if;

  if boundary_function_oid is null or not exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure_row.proowner
     where procedure_row.oid = boundary_function_oid
       and procedure_row.prosecdef
       and owner_role.rolname = 'hulee_inbox_v2_membership_owner'
       and procedure_row.proconfig @>
         array['search_path=pg_catalog, public, pg_temp']::text[]
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'perform public.inbox_v2_lock_participant_membership_mutation_v1('
       ) > 0
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'insert into public.inbox_v2_conversation_membership_commits'
       ) > 0
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'insert into public.inbox_v2_participant_membership_episodes'
       ) > 0
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'insert into public.inbox_v2_participant_membership_transitions'
       ) > 0
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'update public.inbox_v2_participant_membership_episodes'
       ) > 0
       and pg_catalog.strpos(
         procedure_row.prosrc,
         'update public.inbox_v2_conversation_membership_heads'
       ) > 0
       and pg_catalog.strpos(procedure_row.prosrc, 'clock_timestamp()') > 0
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_entrypoint_definition_invalid';
  end if;

  if head_lock_function_oid is null
     or not exists (
       select 1
         from pg_catalog.pg_proc procedure_row
         join pg_catalog.pg_roles owner_role
           on owner_role.oid = procedure_row.proowner
        where procedure_row.oid = head_lock_function_oid
          and procedure_row.prosecdef
          and owner_role.rolname = 'hulee_inbox_v2_membership_owner'
          and procedure_row.proconfig @>
            array['search_path=pg_catalog, public, pg_temp']::text[]
          and pg_catalog.strpos(
            procedure_row.prosrc,
            'from public.inbox_v2_conversation_membership_heads'
          ) > 0
          and pg_catalog.strpos(procedure_row.prosrc, 'for update') > 0
     )
     or exists (
       select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) privilege_row
        where procedure_row.oid = head_lock_function_oid
          and privilege_row.grantee = 0
          and privilege_row.privilege_type = 'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'hulee_inbox_v2_runtime',
       head_lock_function_oid,
       'EXECUTE'
     )
     or not pg_catalog.has_function_privilege(
       'hulee_inbox_v2_membership_repair',
       head_lock_function_oid,
       'EXECUTE'
     ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_head_lock_entrypoint_invalid';
  end if;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure_row
      cross join lateral pg_catalog.aclexplode(
        coalesce(
          procedure_row.proacl,
          pg_catalog.acldefault('f', procedure_row.proowner)
        )
      ) privilege_row
     where procedure_row.oid = boundary_function_oid
       and privilege_row.grantee = 0
       and privilege_row.privilege_type = 'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hulee_inbox_v2_runtime',
    boundary_function_oid,
    'EXECUTE'
  ) or not pg_catalog.has_function_privilege(
    'hulee_inbox_v2_membership_repair',
    boundary_function_oid,
    'EXECUTE'
  ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_entrypoint_acl_invalid';
  end if;

  if lock_function_oid is null
     or exists (
       select 1
         from pg_catalog.pg_proc procedure_row
         cross join lateral pg_catalog.aclexplode(
           coalesce(
             procedure_row.proacl,
             pg_catalog.acldefault('f', procedure_row.proowner)
           )
         ) privilege_row
        where procedure_row.oid = lock_function_oid
          and privilege_row.privilege_type = 'EXECUTE'
          and privilege_row.grantee in (
            0,
            (select oid from pg_catalog.pg_roles
              where rolname = 'hulee_inbox_v2_runtime'),
            (select oid from pg_catalog.pg_roles
              where rolname = 'hulee_inbox_v2_membership_repair')
          )
     ) then
    raise exception using
      errcode = '42501',
      message = 'inbox_v2.membership_lock_helper_acl_invalid';
  end if;
end;
$boundary_audit$;
