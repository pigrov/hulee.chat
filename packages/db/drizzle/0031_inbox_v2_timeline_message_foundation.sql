-- INBOX_V2_TIMELINE_MESSAGE_MIGRATION_FINALIZED_V1
-- INBOX_V2_TIMELINE_MESSAGE_PREFLIGHT_V1
do $inbox_v2_timeline_message_preflight$
declare
  anchor_shape_is_partial boolean := false;
begin
  -- DB-005 alters the minimal DB-003 TimelineItem/Message identity anchors. It
  -- is safe only after the finalized DB-001..DB-004 foundation is present,
  -- including the invariant blocks injected into migrations 0029 and 0030.
  if to_regclass('public.inbox_v2_conversations') is null
    or to_regclass('public.inbox_v2_conversation_heads') is null
    or to_regclass('public.inbox_v2_conversation_participants') is null
    or to_regclass('public.inbox_v2_external_threads') is null
    or to_regclass('public.source_accounts') is null
    or to_regclass('public.normalized_inbound_events') is null
    or to_regclass('public.inbox_v2_source_thread_bindings') is null
    or to_regclass('public.inbox_v2_source_occurrences') is null
    or to_regclass('public.inbox_v2_outbound_dispatches') is null
    or to_regclass('public.inbox_v2_external_message_references') is null
    or to_regclass('public.inbox_v2_timeline_items') is null
    or to_regclass('public.inbox_v2_messages') is null
    or to_regclass('public.inbox_v2_work_items') is null
    or to_regclass('public.inbox_v2_work_item_transitions') is null
    or to_regclass('public.inbox_v2_work_queue_heads') is null
    or to_regclass('public.files') is null
    or to_regclass('public.event_store') is null
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.timeline_message_foundation_missing',
      detail = 'INB2-DB-005 requires the finalized 0028-0030 Conversation, identity/transport and WorkItem foundation.';
  end if;

  -- Keep regclass casts out of the missing-table branch: PostgreSQL may
  -- reorder boolean expressions, while this preflight promises one stable
  -- 23514 classification instead of leaking an undefined-table SQLSTATE.
  if not exists (
      select 1
      from pg_catalog.pg_constraint foundation_constraint
      where foundation_constraint.conname =
        'inbox_v2_conversations_tenant_id_shape_unique'
        and foundation_constraint.conrelid =
          'public.inbox_v2_conversations'::regclass
    )
    or not exists (
      select 1
      from pg_catalog.pg_trigger foundation_trigger
      where foundation_trigger.tgname =
        'inbox_v2_source_occurrences_children_constraint'
        and foundation_trigger.tgrelid =
          'public.inbox_v2_source_occurrences'::regclass
        and not foundation_trigger.tgisinternal
    )
    or not exists (
      select 1
      from pg_catalog.pg_trigger foundation_trigger
      where foundation_trigger.tgname =
        'inbox_v2_work_items_aggregate_constraint'
        and foundation_trigger.tgrelid = 'public.inbox_v2_work_items'::regclass
        and not foundation_trigger.tgisinternal
    )
    or not exists (
      select 1
      from pg_catalog.pg_trigger foundation_trigger
      where foundation_trigger.tgname =
        'inbox_v2_work_queue_heads_coherence_constraint'
        and foundation_trigger.tgrelid =
          'public.inbox_v2_work_queue_heads'::regclass
        and not foundation_trigger.tgisinternal
    )
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.timeline_message_foundation_missing',
      detail = 'INB2-DB-005 requires the finalized 0028-0030 Conversation, identity/transport and WorkItem foundation.';
  end if;

  -- The two DB-003 anchors have a deliberately exact pre-DB-005 shape. Any
  -- missing or additional column/constraint/index/trigger means a previous
  -- attempt or unmanaged DDL already changed the upgrade boundary.
  select
    (
      select count(*) <> 5
        or bool_or(anchor_column.attname not in (
          'tenant_id', 'id', 'conversation_id', 'revision', 'created_at'
        ))
      from pg_catalog.pg_attribute anchor_column
      where anchor_column.attrelid = 'public.inbox_v2_timeline_items'::regclass
        and anchor_column.attnum > 0
        and not anchor_column.attisdropped
    )
    or (
      select count(*) <> 6
        or bool_or(anchor_column.attname not in (
          'tenant_id', 'id', 'conversation_id', 'timeline_item_id',
          'revision', 'created_at'
        ))
      from pg_catalog.pg_attribute anchor_column
      where anchor_column.attrelid = 'public.inbox_v2_messages'::regclass
        and anchor_column.attnum > 0
        and not anchor_column.attisdropped
    )
    or (
      select count(*) <> 5
        or bool_or(anchor_constraint.conname not in (
          'inbox_v2_timeline_items_pk',
          'inbox_v2_timeline_items_target_unique',
          'inbox_v2_timeline_items_foundation_check',
          'inbox_v2_timeline_items_tenant_fk',
          'inbox_v2_timeline_items_conversation_fk'
        ))
      from pg_catalog.pg_constraint anchor_constraint
      where anchor_constraint.conrelid =
        'public.inbox_v2_timeline_items'::regclass
        and anchor_constraint.contype in ('c', 'f', 'p', 'u', 'x')
    )
    or (
      select count(*) <> 6
        or bool_or(anchor_constraint.conname not in (
          'inbox_v2_messages_pk',
          'inbox_v2_messages_timeline_unique',
          'inbox_v2_messages_target_unique',
          'inbox_v2_messages_foundation_check',
          'inbox_v2_messages_tenant_fk',
          'inbox_v2_messages_timeline_fk'
        ))
      from pg_catalog.pg_constraint anchor_constraint
      where anchor_constraint.conrelid = 'public.inbox_v2_messages'::regclass
        and anchor_constraint.contype in ('c', 'f', 'p', 'u', 'x')
    )
    or (
      select count(*) <> 3
        or bool_or(anchor_index.relname not in (
          'inbox_v2_timeline_items_pk',
          'inbox_v2_timeline_items_target_unique',
          'inbox_v2_timeline_items_tenant_conversation_idx'
        ))
      from pg_catalog.pg_index index_definition
      inner join pg_catalog.pg_class anchor_index
        on anchor_index.oid = index_definition.indexrelid
      where index_definition.indrelid =
        'public.inbox_v2_timeline_items'::regclass
    )
    or (
      select count(*) <> 4
        or bool_or(anchor_index.relname not in (
          'inbox_v2_messages_pk',
          'inbox_v2_messages_timeline_unique',
          'inbox_v2_messages_target_unique',
          'inbox_v2_messages_tenant_conversation_idx'
        ))
      from pg_catalog.pg_index index_definition
      inner join pg_catalog.pg_class anchor_index
        on anchor_index.oid = index_definition.indexrelid
      where index_definition.indrelid = 'public.inbox_v2_messages'::regclass
    )
    or (
      select count(*) <> 1
        or bool_or(
          anchor_trigger.tgname <> 'inbox_v2_timeline_items_immutable_trigger'
          or anchor_trigger.tgenabled <> 'O'
        )
      from pg_catalog.pg_trigger anchor_trigger
      where anchor_trigger.tgrelid =
        'public.inbox_v2_timeline_items'::regclass
        and not anchor_trigger.tgisinternal
    )
    or (
      select count(*) <> 1
        or bool_or(
          anchor_trigger.tgname <> 'inbox_v2_messages_immutable_trigger'
          or anchor_trigger.tgenabled <> 'O'
        )
      from pg_catalog.pg_trigger anchor_trigger
      where anchor_trigger.tgrelid = 'public.inbox_v2_messages'::regclass
        and not anchor_trigger.tgisinternal
    )
    into anchor_shape_is_partial;

  if coalesce(anchor_shape_is_partial, true)
    or exists (
      select 1
      from pg_catalog.pg_class partial_object
      inner join pg_catalog.pg_namespace object_namespace
        on object_namespace.oid = partial_object.relnamespace
      where object_namespace.nspname = 'public'
        and partial_object.relname not in (
          'inbox_v2_timeline_items', 'inbox_v2_messages'
        )
        and (
          partial_object.relname like 'inbox_v2_timeline_content%'
          or partial_object.relname like 'inbox_v2_timeline_subject%'
          or partial_object.relname like 'inbox_v2_message\_%' escape '\'
          or partial_object.relname like
            'inbox_v2_message_provider_lifecycle%'
          or partial_object.relname like 'inbox_v2_message_reaction%'
          or partial_object.relname like 'inbox_v2_message_delivery%'
          or partial_object.relname like 'inbox_v2_provider_receipt%'
          or partial_object.relname like 'inbox_v2_staff_note%'
          or partial_object.relname like 'inbox_v2_action_attribution%'
          or partial_object.relname like
            'inbox_v2_outbound_route_consumption%'
          or partial_object.relname like
            'inbox_v2_provider_semantic_ordering%'
        )
    )
    or exists (
      select 1
      from pg_catalog.pg_type partial_type
      inner join pg_catalog.pg_namespace object_namespace
        on object_namespace.oid = partial_type.typnamespace
      where object_namespace.nspname = 'public'
        and partial_type.typname not in (
          'inbox_v2_timeline_items', 'inbox_v2_messages'
        )
        and (
          partial_type.typname like 'inbox_v2_timeline\_%' escape '\'
          or partial_type.typname like 'inbox_v2_app_actor\_%' escape '\'
          or partial_type.typname like 'inbox_v2_automation_causation\_%'
            escape '\'
          or partial_type.typname like
            'inbox_v2_attachment_materialization\_%' escape '\'
          or partial_type.typname like 'inbox_v2_message\_%' escape '\'
          or partial_type.typname like 'inbox_v2_staff_note\_%' escape '\'
          or partial_type.typname like 'inbox_v2_provider_forward\_%'
            escape '\'
          or partial_type.typname like 'inbox_v2_provider_lifecycle\_%'
            escape '\'
          or partial_type.typname like 'inbox_v2_provider_delete\_%'
            escape '\'
          or partial_type.typname like 'inbox_v2_reaction\_%' escape '\'
          or partial_type.typname like 'inbox_v2_delivery\_%' escape '\'
          or partial_type.typname like 'inbox_v2_receipt\_%' escape '\'
          or partial_type.typname like 'inbox_v2_action_attribution%'
          or partial_type.typname like
            'inbox_v2_outbound_route_consumption%'
          or partial_type.typname like
            'inbox_v2_provider_semantic_ordering%'
        )
    )
    or exists (
      select 1
      from pg_catalog.pg_proc partial_function
      inner join pg_catalog.pg_namespace object_namespace
        on object_namespace.oid = partial_function.pronamespace
      where object_namespace.nspname = 'public'
        and (
          partial_function.proname like 'inbox_v2_tm\_%' escape '\'
          or partial_function.proname like 'inbox_v2_timeline_content%'
          or partial_function.proname like 'inbox_v2_timeline_item\_%'
            escape '\'
          or partial_function.proname like 'inbox_v2_message\_%' escape '\'
          or partial_function.proname like
            'inbox_v2_message_provider_lifecycle%'
          or partial_function.proname like 'inbox_v2_message_reaction%'
          or partial_function.proname like 'inbox_v2_message_delivery%'
          or partial_function.proname like 'inbox_v2_provider_receipt%'
          or partial_function.proname like 'inbox_v2_staff_note%'
          or partial_function.proname like 'inbox_v2_action_attribution%'
          or partial_function.proname like
            'inbox_v2_outbound_route_consumption%'
        )
    )
    or exists (
      select 1
      from pg_catalog.pg_constraint partial_constraint
      where partial_constraint.conname in (
        'files_tenant_id_unique', 'event_store_tenant_id_unique'
      )
    )
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.timeline_message_partial_schema_detected',
      detail = 'Refusing to apply DB-005 over partial or unmanaged Timeline/Message lifecycle objects.';
  end if;

  -- There is no truthful mechanical upgrade for populated DB-003 anchors:
  -- author, sequence, classified content and lifecycle provenance do not exist
  -- there. The current pre-production path must explicitly reset them; a
  -- preserve deployment needs its own versioned backfill contract.
  if exists (select 1 from public.inbox_v2_timeline_items limit 1)
    or exists (select 1 from public.inbox_v2_messages limit 1)
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.timeline_message_backfill_required',
      detail = 'Existing DB-003 TimelineItem/Message anchors do not contain enough evidence to infer immutable author, canonical sequence, classified content or lifecycle.',
      hint = 'Use an explicit preserve-path backfill or an approved disposable reset before retrying DB-005.';
  end if;
end;
$inbox_v2_timeline_message_preflight$;
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_app_actor_kind" AS ENUM('employee', 'trusted_service');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_attachment_materialization_state" AS ENUM('pending', 'ready', 'failed', 'quarantined');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_automation_causation_kind" AS ENUM('employee_command', 'system_event');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_delivery_evidence_kind" AS ENUM('provider_result', 'provider_artifact', 'provider_event');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_delivery_fact" AS ENUM('accepted', 'sent', 'delivered', 'failed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_delivery_scope_kind" AS ENUM('dispatch', 'external_reference', 'recipient');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_lifecycle" AS ENUM('active', 'local_delete_tombstone', 'provider_delete_tombstone');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_origin_kind" AS ENUM('source_originated', 'hulee_external', 'internal', 'migration');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_reference_context_kind" AS ENUM('none', 'reply', 'forward_content_copy', 'forward_provider_native', 'forward_provider_observed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_reference_kind" AS ENUM('none', 'reply_resolved_internal', 'reply_resolved_external', 'reply_unresolved_source', 'forward_content_copy', 'forward_provider_native', 'forward_provider_observed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_revision_change" AS ENUM('created', 'edited', 'attachment_materialized', 'local_delete_tombstone', 'provider_delete_policy_tombstone', 'privacy_erasure_tombstone', 'retention_purge_tombstone');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_source_direction" AS ENUM('inbound', 'outbound');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_transport_fact_kind" AS ENUM('delivery', 'receipt');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_message_transport_link_role" AS ENUM('origin', 'provider_echo', 'provider_response', 'native_outbound', 'additional_artifact');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_outbound_route_consumer_kind" AS ENUM('message_creation', 'provider_lifecycle', 'reaction');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_provider_delete_local_effect" AS ENUM('not_evaluated', 'retain_local', 'tombstone_local');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_provider_forward_provenance" AS ENUM('exact', 'partial', 'opaque');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_provider_lifecycle_action" AS ENUM('edit', 'delete');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_provider_lifecycle_origin" AS ENUM('provider_observed', 'hulee_requested');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_provider_lifecycle_outcome" AS ENUM('observed', 'pending', 'accepted', 'confirmed', 'failed', 'unsupported', 'outcome_unknown');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_actor_kind" AS ENUM('participant', 'unattributed_source_observation', 'aggregate_only', 'provider_system');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_capability_kind" AS ENUM('internal', 'external');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_cardinality" AS ENUM('single_value', 'multiple_values', 'aggregate_only');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_operation" AS ENUM('set', 'replace', 'clear');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_state_kind" AS ENUM('active', 'cleared', 'pending_external', 'external_terminal');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_transition_mode" AS ENUM('internal_apply', 'external_request', 'provider_observed', 'provider_result');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_reaction_value_kind" AS ENUM('unicode', 'provider_custom');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_receipt_reader_kind" AS ENUM('source_external_identity', 'aggregate_only');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_receipt_target_kind" AS ENUM('exact_message', 'provider_watermark', 'thread_readmark');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_staff_note_revision_change" AS ENUM('created', 'edited', 'attachment_materialized', 'privacy_erasure_tombstone', 'retention_purge_tombstone');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_activity_kind" AS ENUM('eligible', 'history_import', 'migration', 'non_activity');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_content_block_kind" AS ENUM('text', 'image', 'audio', 'video', 'file', 'sticker', 'location', 'contact', 'unsupported_source_content', 'extension');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_content_owner_kind" AS ENUM('message', 'staff_note');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_content_state" AS ENUM('available', 'privacy_erased', 'retention_purged');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_content_transition_kind" AS ENUM('created', 'edit', 'attachment_materialization', 'privacy_erasure', 'retention_purge');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_subject_kind" AS ENUM('message', 'staff_note', 'call', 'review', 'module_event', 'participant_change', 'work_change', 'system_event');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_visibility" AS ENUM('conversation_external', 'internal_participants', 'staff_only', 'workforce_metadata', 'source_item_policy');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_timeline_work_transition_kind" AS ENUM('work_item', 'work_item_relation');
--> statement-breakpoint
CREATE TABLE "inbox_v2_provider_semantic_ordering_heads" (
	"tenant_id" text NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"semantic_family_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"source_thread_binding_id" text NOT NULL,
	"binding_generation" bigint NOT NULL,
	"scope_token" text NOT NULL,
	"comparator_id" text NOT NULL,
	"comparator_revision" bigint NOT NULL,
	"position" text NOT NULL,
	"normalized_inbound_event_id" text NOT NULL,
	"proof_token" text NOT NULL,
	"revision" bigint NOT NULL,
	"head_detail" jsonb NOT NULL,
	"head_detail_digest_sha256" text NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_pk" PRIMARY KEY("tenant_id","external_message_reference_id","semantic_family_id"),
	CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_values_check" CHECK (coalesce((char_length("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id") <= 256 and (
    ("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id", ':', 2)) <= 160)
    or ("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id", ':', 3)) <= 160
      and split_part("inbox_v2_provider_semantic_ordering_heads"."semantic_family_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_provider_semantic_ordering_heads"."binding_generation" >= 1
        and coalesce((char_length("inbox_v2_provider_semantic_ordering_heads"."scope_token") between 8 and 256
    and "inbox_v2_provider_semantic_ordering_heads"."scope_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_provider_semantic_ordering_heads"."comparator_id") <= 256 and (
    ("inbox_v2_provider_semantic_ordering_heads"."comparator_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."comparator_id", ':', 2)) <= 160)
    or ("inbox_v2_provider_semantic_ordering_heads"."comparator_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."comparator_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_provider_semantic_ordering_heads"."comparator_id", ':', 3)) <= 160
      and split_part("inbox_v2_provider_semantic_ordering_heads"."comparator_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_provider_semantic_ordering_heads"."comparator_revision" >= 1
        and "inbox_v2_provider_semantic_ordering_heads"."position" ~ '^(0|[1-9][0-9]*)$'
        and coalesce((char_length("inbox_v2_provider_semantic_ordering_heads"."proof_token") between 8 and 256
    and "inbox_v2_provider_semantic_ordering_heads"."proof_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and "inbox_v2_provider_semantic_ordering_heads"."revision" >= 1
        and coalesce(("inbox_v2_provider_semantic_ordering_heads"."head_detail_digest_sha256" ~ '^[a-f0-9]{64}$'), false)
        and "inbox_v2_provider_semantic_ordering_heads"."last_changed_stream_position" >= 1
        and jsonb_typeof("inbox_v2_provider_semantic_ordering_heads"."head_detail") = 'object'
        and pg_column_size("inbox_v2_provider_semantic_ordering_heads"."head_detail") <= 65536),
	CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_detail_check" CHECK (("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{tenantId}') = "inbox_v2_provider_semantic_ordering_heads"."tenant_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{semanticFamilyId}') =
          "inbox_v2_provider_semantic_ordering_heads"."semantic_family_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{externalMessageReference,tenantId}') =
          "inbox_v2_provider_semantic_ordering_heads"."tenant_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{externalMessageReference,kind}') =
          'external_message_reference'
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{externalMessageReference,id}') =
          "inbox_v2_provider_semantic_ordering_heads"."external_message_reference_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceAccount,tenantId}') =
          "inbox_v2_provider_semantic_ordering_heads"."tenant_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceAccount,kind}') = 'source_account'
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceAccount,id}') =
          "inbox_v2_provider_semantic_ordering_heads"."source_account_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceThreadBinding,tenantId}') =
          "inbox_v2_provider_semantic_ordering_heads"."tenant_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceThreadBinding,kind}') =
          'source_thread_binding'
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{sourceThreadBinding,id}') =
          "inbox_v2_provider_semantic_ordering_heads"."source_thread_binding_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{bindingGeneration}') =
          "inbox_v2_provider_semantic_ordering_heads"."binding_generation"::text
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{scopeToken}') = "inbox_v2_provider_semantic_ordering_heads"."scope_token"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{comparatorId}') = "inbox_v2_provider_semantic_ordering_heads"."comparator_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{comparatorRevision}') =
          "inbox_v2_provider_semantic_ordering_heads"."comparator_revision"::text
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{position}') = "inbox_v2_provider_semantic_ordering_heads"."position"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{normalizedInboundEvent,tenantId}') =
          "inbox_v2_provider_semantic_ordering_heads"."tenant_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{normalizedInboundEvent,kind}') =
          'normalized_inbound_event'
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{normalizedInboundEvent,id}') =
          "inbox_v2_provider_semantic_ordering_heads"."normalized_inbound_event_id"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{proofToken}') = "inbox_v2_provider_semantic_ordering_heads"."proof_token"
        and ("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{revision}') = "inbox_v2_provider_semantic_ordering_heads"."revision"::text
        and (("inbox_v2_provider_semantic_ordering_heads"."head_detail" #>> '{updatedAt}')::timestamptz) =
          "inbox_v2_provider_semantic_ordering_heads"."updated_at"),
	CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_clock_check" CHECK (isfinite("inbox_v2_provider_semantic_ordering_heads"."created_at") and isfinite("inbox_v2_provider_semantic_ordering_heads"."updated_at")
        and "inbox_v2_provider_semantic_ordering_heads"."updated_at" >= "inbox_v2_provider_semantic_ordering_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_action_attributions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"action_participant_id" text,
	"app_actor_kind" "inbox_v2_app_actor_kind",
	"app_actor_employee_id" text,
	"app_authorization_epoch" text,
	"app_trusted_service_id" text,
	"source_occurrence_id" text,
	"automation_kind" "inbox_v2_automation_causation_kind",
	"automation_cause_event_id" text,
	"automation_correlation_id" text,
	"automation_caused_at" timestamp (3) with time zone,
	"automation_initiating_employee_id" text,
	"automation_initiating_authorization_epoch" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_action_attributions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_action_attributions_target_unique" UNIQUE("tenant_id","id","conversation_id"),
	CONSTRAINT "inbox_v2_action_attributions_actor_check" CHECK (num_nonnulls("inbox_v2_action_attributions"."app_actor_kind", "inbox_v2_action_attributions"."source_occurrence_id") = 1
        and (
          ("inbox_v2_action_attributions"."app_actor_kind" = 'employee'
            and "inbox_v2_action_attributions"."app_actor_employee_id" is not null
            and "inbox_v2_action_attributions"."app_authorization_epoch" is not null
            and "inbox_v2_action_attributions"."app_trusted_service_id" is null
            and "inbox_v2_action_attributions"."action_participant_id" is not null
            and "inbox_v2_action_attributions"."automation_kind" is null)
          or ("inbox_v2_action_attributions"."app_actor_kind" = 'trusted_service'
            and "inbox_v2_action_attributions"."app_actor_employee_id" is null
            and "inbox_v2_action_attributions"."app_authorization_epoch" is null
            and "inbox_v2_action_attributions"."app_trusted_service_id" is not null
            and "inbox_v2_action_attributions"."automation_kind" is not null)
          or ("inbox_v2_action_attributions"."app_actor_kind" is null
            and "inbox_v2_action_attributions"."source_occurrence_id" is not null
            and "inbox_v2_action_attributions"."automation_kind" is null)
        )),
	CONSTRAINT "inbox_v2_action_attributions_automation_check" CHECK (("inbox_v2_action_attributions"."automation_kind" is null and num_nonnulls(
          "inbox_v2_action_attributions"."automation_cause_event_id", "inbox_v2_action_attributions"."automation_correlation_id",
          "inbox_v2_action_attributions"."automation_caused_at", "inbox_v2_action_attributions"."automation_initiating_employee_id",
          "inbox_v2_action_attributions"."automation_initiating_authorization_epoch"
        ) = 0) or (
          "inbox_v2_action_attributions"."automation_kind" = 'system_event'
          and "inbox_v2_action_attributions"."automation_cause_event_id" is not null
          and "inbox_v2_action_attributions"."automation_correlation_id" is not null
          and "inbox_v2_action_attributions"."automation_caused_at" is not null
          and "inbox_v2_action_attributions"."automation_initiating_employee_id" is null
          and "inbox_v2_action_attributions"."automation_initiating_authorization_epoch" is null
        ) or (
          "inbox_v2_action_attributions"."automation_kind" = 'employee_command'
          and num_nonnulls(
            "inbox_v2_action_attributions"."automation_cause_event_id", "inbox_v2_action_attributions"."automation_correlation_id",
            "inbox_v2_action_attributions"."automation_caused_at", "inbox_v2_action_attributions"."automation_initiating_employee_id",
            "inbox_v2_action_attributions"."automation_initiating_authorization_epoch"
          ) = 5
        )),
	CONSTRAINT "inbox_v2_action_attributions_timestamp_check" CHECK (coalesce((char_length("inbox_v2_action_attributions"."id") <= 256
    and "inbox_v2_action_attributions"."id" ~ '^action_attribution:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and isfinite("inbox_v2_action_attributions"."created_at")
        and ("inbox_v2_action_attributions"."automation_caused_at" is null
          or (isfinite("inbox_v2_action_attributions"."automation_caused_at")
            and "inbox_v2_action_attributions"."automation_caused_at" <= "inbox_v2_action_attributions"."created_at")))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_attachment_anchors" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_attachment_anchors_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_attachment_anchors_revision_check" CHECK (coalesce((char_length("inbox_v2_message_attachment_anchors"."id") <= 256
    and "inbox_v2_message_attachment_anchors"."id" ~ '^message_attachment:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_attachment_anchors"."revision" >= 1),
	CONSTRAINT "inbox_v2_message_attachment_anchors_time_check" CHECK (isfinite("inbox_v2_message_attachment_anchors"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_delivery_observations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"fact" "inbox_v2_delivery_fact" NOT NULL,
	"scope_kind" "inbox_v2_delivery_scope_kind" NOT NULL,
	"scope_dispatch_id" text,
	"scope_attempt_id" text,
	"scope_artifact_id" text,
	"scope_external_message_reference_id" text,
	"scope_source_occurrence_id" text,
	"scope_recipient_source_identity_id" text,
	"source_account_id" text NOT NULL,
	"source_thread_binding_id" text NOT NULL,
	"binding_generation" bigint NOT NULL,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"capability_id" text NOT NULL,
	"capability_revision" bigint NOT NULL,
	"evidence_kind" "inbox_v2_delivery_evidence_kind" NOT NULL,
	"evidence_attempt_id" text,
	"evidence_artifact_id" text,
	"evidence_normalized_inbound_event_id" text,
	"evidence_external_message_reference_id" text,
	"evidence_source_occurrence_id" text,
	"semantic_proof_detail" jsonb,
	"semantic_proof_digest_sha256" text,
	"evidence_kind_id" text NOT NULL,
	"evidence_digest_sha256" text NOT NULL,
	"failure_reason_id" text,
	"commit_token" text NOT NULL,
	"commit_digest_sha256" text NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_delivery_observations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_delivery_observations_commit_unique" UNIQUE("tenant_id","commit_token"),
	CONSTRAINT "inbox_v2_message_delivery_observations_scope_check" CHECK (("inbox_v2_message_delivery_observations"."scope_kind" = 'dispatch'
          and "inbox_v2_message_delivery_observations"."scope_dispatch_id" is not null
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."scope_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."scope_source_occurrence_id",
            "inbox_v2_message_delivery_observations"."scope_recipient_source_identity_id"
          ) = 0)
        or ("inbox_v2_message_delivery_observations"."scope_kind" = 'external_reference'
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."scope_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."scope_source_occurrence_id"
          ) = 2
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."scope_dispatch_id", "inbox_v2_message_delivery_observations"."scope_attempt_id",
            "inbox_v2_message_delivery_observations"."scope_artifact_id", "inbox_v2_message_delivery_observations"."scope_recipient_source_identity_id"
          ) = 0)
        or ("inbox_v2_message_delivery_observations"."scope_kind" = 'recipient'
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."scope_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."scope_recipient_source_identity_id"
          ) = 2
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."scope_dispatch_id", "inbox_v2_message_delivery_observations"."scope_attempt_id",
            "inbox_v2_message_delivery_observations"."scope_artifact_id", "inbox_v2_message_delivery_observations"."scope_source_occurrence_id"
          ) = 0)),
	CONSTRAINT "inbox_v2_message_delivery_observations_evidence_check" CHECK (("inbox_v2_message_delivery_observations"."evidence_kind" = 'provider_result'
          and "inbox_v2_message_delivery_observations"."evidence_attempt_id" is not null
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."evidence_artifact_id",
            "inbox_v2_message_delivery_observations"."evidence_normalized_inbound_event_id",
            "inbox_v2_message_delivery_observations"."evidence_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."evidence_source_occurrence_id"
          ) = 0)
        or ("inbox_v2_message_delivery_observations"."evidence_kind" = 'provider_artifact'
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."evidence_attempt_id", "inbox_v2_message_delivery_observations"."evidence_artifact_id"
          ) = 2
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."evidence_normalized_inbound_event_id",
            "inbox_v2_message_delivery_observations"."evidence_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."evidence_source_occurrence_id"
          ) = 0)
        or ("inbox_v2_message_delivery_observations"."evidence_kind" = 'provider_event'
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."evidence_normalized_inbound_event_id",
            "inbox_v2_message_delivery_observations"."evidence_external_message_reference_id",
            "inbox_v2_message_delivery_observations"."evidence_source_occurrence_id"
          ) = 3
          and num_nonnulls(
            "inbox_v2_message_delivery_observations"."evidence_attempt_id", "inbox_v2_message_delivery_observations"."evidence_artifact_id"
          ) = 0)),
	CONSTRAINT "inbox_v2_message_delivery_observations_fact_check" CHECK ((("inbox_v2_message_delivery_observations"."fact" = 'failed') = ("inbox_v2_message_delivery_observations"."failure_reason_id" is not null))
        and ("inbox_v2_message_delivery_observations"."fact" not in ('sent', 'delivered')
          or "inbox_v2_message_delivery_observations"."evidence_kind" = 'provider_event')
        and ("inbox_v2_message_delivery_observations"."scope_kind" = 'dispatch'
          or "inbox_v2_message_delivery_observations"."evidence_kind" = 'provider_event')),
	CONSTRAINT "inbox_v2_message_delivery_observations_clock_check" CHECK (coalesce((char_length("inbox_v2_message_delivery_observations"."id") <= 256
    and "inbox_v2_message_delivery_observations"."id" ~ '^message_delivery_observation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_delivery_observations"."binding_generation" >= 1
        and "inbox_v2_message_delivery_observations"."adapter_declaration_revision" >= 1
        and "inbox_v2_message_delivery_observations"."capability_revision" >= 1
        and "inbox_v2_message_delivery_observations"."recorded_stream_position" >= 1 and "inbox_v2_message_delivery_observations"."revision" = 1
        and "inbox_v2_message_delivery_observations"."evidence_digest_sha256" ~ '^[a-f0-9]{64}$'
        and char_length("inbox_v2_message_delivery_observations"."commit_token") between 1 and 512
        and "inbox_v2_message_delivery_observations"."commit_digest_sha256" ~ '^[a-f0-9]{64}$'
        and isfinite("inbox_v2_message_delivery_observations"."adapter_loaded_at")
        and isfinite("inbox_v2_message_delivery_observations"."observed_at") and isfinite("inbox_v2_message_delivery_observations"."recorded_at")
        and "inbox_v2_message_delivery_observations"."adapter_loaded_at" <= "inbox_v2_message_delivery_observations"."recorded_at"
        and "inbox_v2_message_delivery_observations"."observed_at" <= "inbox_v2_message_delivery_observations"."recorded_at"
        and (num_nonnulls(
          "inbox_v2_message_delivery_observations"."semantic_proof_detail", "inbox_v2_message_delivery_observations"."semantic_proof_digest_sha256"
        ) in (0, 2))
        and ("inbox_v2_message_delivery_observations"."semantic_proof_detail" is null or (
          jsonb_typeof("inbox_v2_message_delivery_observations"."semantic_proof_detail") = 'object'
          and pg_column_size("inbox_v2_message_delivery_observations"."semantic_proof_detail") <= 65536
          and "inbox_v2_message_delivery_observations"."semantic_proof_digest_sha256" ~ '^[a-f0-9]{64}$'
        )))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_provider_lifecycle_operations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"action" "inbox_v2_provider_lifecycle_action" NOT NULL,
	"origin" "inbox_v2_provider_lifecycle_origin" NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"source_account_id" text NOT NULL,
	"source_thread_binding_id" text NOT NULL,
	"binding_generation" bigint NOT NULL,
	"outbound_route_id" text,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"capability_revision" bigint NOT NULL,
	"action_attribution_id" text,
	"initial_outcome" "inbox_v2_provider_lifecycle_outcome" NOT NULL,
	"initial_outcome_retryable" integer,
	"initial_outcome_reason_id" text,
	"initial_delete_local_effect" "inbox_v2_provider_delete_local_effect",
	"initial_policy_decision_event_id" text,
	"initial_policy_decision_revision" bigint,
	"initial_policy_decided_at" timestamp (3) with time zone,
	"provider_semantic_normalized_inbound_event_id" text,
	"provider_semantic_actor_external_identity_id" text,
	"provider_semantic_capability_id" text,
	"provider_semantic_capability_revision" bigint,
	"provider_semantic_id" text,
	"provider_semantic_revision" bigint,
	"provider_semantic_proof_token" text,
	"provider_semantic_ordering_scope_token" text,
	"provider_semantic_ordering_position" text,
	"provider_semantic_ordering_comparator_id" text,
	"provider_semantic_ordering_comparator_revision" bigint,
	"provider_semantic_declared_by_trusted_service_id" text,
	"provider_semantic_proof_revision" bigint,
	"provider_semantic_proof_detail" jsonb,
	"provider_semantic_proof_digest_sha256" text,
	"semantic_ordering_commit_detail" jsonb,
	"semantic_ordering_commit_digest_sha256" text,
	"semantic_ordering_committed_at" timestamp (3) with time zone,
	"outcome" "inbox_v2_provider_lifecycle_outcome" NOT NULL,
	"outcome_retryable" integer,
	"outcome_reason_id" text,
	"delete_local_effect" "inbox_v2_provider_delete_local_effect",
	"policy_decision_event_id" text,
	"policy_decision_revision" bigint,
	"policy_decided_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_stream_position" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_target_unique" UNIQUE("tenant_id","id","message_id"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_revision_unique" UNIQUE("tenant_id","id","revision"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_origin_check" CHECK (("inbox_v2_message_provider_lifecycle_operations"."origin" = 'provider_observed'
          and "inbox_v2_message_provider_lifecycle_operations"."outbound_route_id" is null
          and "inbox_v2_message_provider_lifecycle_operations"."action_attribution_id" is null
          and "inbox_v2_message_provider_lifecycle_operations"."outcome" = 'observed')
        or ("inbox_v2_message_provider_lifecycle_operations"."origin" = 'hulee_requested'
          and "inbox_v2_message_provider_lifecycle_operations"."outbound_route_id" is not null
          and "inbox_v2_message_provider_lifecycle_operations"."action_attribution_id" is not null
          and "inbox_v2_message_provider_lifecycle_operations"."outcome" <> 'observed')),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_outcome_check" CHECK (("inbox_v2_message_provider_lifecycle_operations"."outcome" = 'failed'
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_retryable" in (0, 1)
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_reason_id" is not null)
        or ("inbox_v2_message_provider_lifecycle_operations"."outcome" = 'unsupported'
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_retryable" is null
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_reason_id" is not null)
        or ("inbox_v2_message_provider_lifecycle_operations"."outcome" not in ('failed', 'unsupported')
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_retryable" is null
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_reason_id" is null)),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_policy_check" CHECK (("inbox_v2_message_provider_lifecycle_operations"."action" = 'edit'
          and num_nonnulls(
            "inbox_v2_message_provider_lifecycle_operations"."delete_local_effect", "inbox_v2_message_provider_lifecycle_operations"."policy_decision_event_id",
            "inbox_v2_message_provider_lifecycle_operations"."policy_decision_revision", "inbox_v2_message_provider_lifecycle_operations"."policy_decided_at"
          ) = 0)
        or ("inbox_v2_message_provider_lifecycle_operations"."action" = 'delete'
          and "inbox_v2_message_provider_lifecycle_operations"."delete_local_effect" = 'not_evaluated'
          and num_nonnulls(
            "inbox_v2_message_provider_lifecycle_operations"."policy_decision_event_id", "inbox_v2_message_provider_lifecycle_operations"."policy_decision_revision",
            "inbox_v2_message_provider_lifecycle_operations"."policy_decided_at"
          ) = 0)
        or ("inbox_v2_message_provider_lifecycle_operations"."action" = 'delete'
          and "inbox_v2_message_provider_lifecycle_operations"."delete_local_effect" in ('retain_local', 'tombstone_local')
          and num_nonnulls(
            "inbox_v2_message_provider_lifecycle_operations"."policy_decision_event_id", "inbox_v2_message_provider_lifecycle_operations"."policy_decision_revision",
            "inbox_v2_message_provider_lifecycle_operations"."policy_decided_at"
          ) = 3
          and "inbox_v2_message_provider_lifecycle_operations"."policy_decision_revision" >= 1)),
	CONSTRAINT "inbox_v2_provider_lifecycle_initial_state_check" CHECK ((
          ("inbox_v2_message_provider_lifecycle_operations"."initial_outcome" = 'failed'
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_retryable" in (0, 1)
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_reason_id" is not null)
          or ("inbox_v2_message_provider_lifecycle_operations"."initial_outcome" = 'unsupported'
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_retryable" is null
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_reason_id" is not null)
          or ("inbox_v2_message_provider_lifecycle_operations"."initial_outcome" not in ('failed', 'unsupported')
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_retryable" is null
            and "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_reason_id" is null)
        ) and (
          ("inbox_v2_message_provider_lifecycle_operations"."action" = 'edit' and num_nonnulls(
            "inbox_v2_message_provider_lifecycle_operations"."initial_delete_local_effect",
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_event_id",
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_revision",
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decided_at"
          ) = 0)
          or ("inbox_v2_message_provider_lifecycle_operations"."action" = 'delete'
            and "inbox_v2_message_provider_lifecycle_operations"."initial_delete_local_effect" = 'not_evaluated'
            and num_nonnulls(
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_event_id",
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_revision",
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decided_at"
            ) = 0)
          or ("inbox_v2_message_provider_lifecycle_operations"."action" = 'delete'
            and "inbox_v2_message_provider_lifecycle_operations"."initial_delete_local_effect" in (
              'retain_local', 'tombstone_local'
            )
            and num_nonnulls(
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_event_id",
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_revision",
              "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decided_at"
            ) = 3
            and "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_revision" >= 1)
        ) and ("inbox_v2_message_provider_lifecycle_operations"."revision" <> 1 or (
          "inbox_v2_message_provider_lifecycle_operations"."outcome" = "inbox_v2_message_provider_lifecycle_operations"."initial_outcome"
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_retryable" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_retryable"
          and "inbox_v2_message_provider_lifecycle_operations"."outcome_reason_id" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_outcome_reason_id"
          and "inbox_v2_message_provider_lifecycle_operations"."delete_local_effect" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_delete_local_effect"
          and "inbox_v2_message_provider_lifecycle_operations"."policy_decision_event_id" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_event_id"
          and "inbox_v2_message_provider_lifecycle_operations"."policy_decision_revision" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decision_revision"
          and "inbox_v2_message_provider_lifecycle_operations"."policy_decided_at" is not distinct from
            "inbox_v2_message_provider_lifecycle_operations"."initial_policy_decided_at"
        ))),
	CONSTRAINT "inbox_v2_provider_lifecycle_semantic_proof_check" CHECK ((
        "inbox_v2_message_provider_lifecycle_operations"."origin" = 'hulee_requested'
        and num_nonnulls(
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_normalized_inbound_event_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_actor_external_identity_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_id", "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_token",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_scope_token",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_position",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_declared_by_trusted_service_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_digest_sha256",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_digest_sha256",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_committed_at"
        ) = 0
      ) or (
        "inbox_v2_message_provider_lifecycle_operations"."origin" = 'provider_observed'
        and num_nonnulls(
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_normalized_inbound_event_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_id", "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_token",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_scope_token",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_position",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_declared_by_trusted_service_id",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_revision",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail",
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_digest_sha256",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_digest_sha256",
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_committed_at"
        ) = 17
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_id" =
          'core:message-' || "inbox_v2_message_provider_lifecycle_operations"."action"::text
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_revision" =
          "inbox_v2_message_provider_lifecycle_operations"."capability_revision"
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_id" =
          'core:message.lifecycle.' || "inbox_v2_message_provider_lifecycle_operations"."action"::text || '.observed'
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_revision" >= 1
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_revision" = 1
        and coalesce((char_length("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_token") between 8 and 256
    and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_scope_token") between 8 and 256
    and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_scope_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_position" ~ '^(0|[1-9][0-9]*)$'
        and coalesce((char_length("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id") <= 256 and (
    ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id", ':', 2)) <= 160)
    or ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id", ':', 3)) <= 160
      and split_part("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_revision" >= 1
        and "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_declared_by_trusted_service_id" =
          "inbox_v2_message_provider_lifecycle_operations"."adapter_loaded_by_trusted_service_id"
        and coalesce(("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_digest_sha256" ~ '^[a-f0-9]{64}$'), false)
        and coalesce(("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_digest_sha256" ~ '^[a-f0-9]{64}$'), false)
        and jsonb_typeof("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail") = 'object'
        and jsonb_typeof("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail") = 'object'
        and pg_column_size("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail") <= 65536
        and pg_column_size("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail") <= 65536
        and "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_committed_at" = "inbox_v2_message_provider_lifecycle_operations"."recorded_at"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{tenantId}') =
          "inbox_v2_message_provider_lifecycle_operations"."tenant_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{normalizedInboundEvent,id}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_normalized_inbound_event_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{externalMessageReference,id}') =
          "inbox_v2_message_provider_lifecycle_operations"."external_message_reference_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{sourceOccurrence,id}') = "inbox_v2_message_provider_lifecycle_operations"."source_occurrence_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{sourceAccount,id}') =
          "inbox_v2_message_provider_lifecycle_operations"."source_account_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{sourceThreadBinding,id}') = "inbox_v2_message_provider_lifecycle_operations"."source_thread_binding_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{bindingGeneration}') = "inbox_v2_message_provider_lifecycle_operations"."binding_generation"::text
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{capabilityId}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{capabilityRevision}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_capability_revision"::text
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{semanticId}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{semanticRevision}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_revision"::text
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{proofToken}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_token"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{declaredByTrustedServiceId}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_declared_by_trusted_service_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{ordering,kind}') =
          'monotonic_exact'
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{ordering,scopeToken}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_scope_token"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{ordering,position}') = "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_position"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{ordering,comparatorId}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>>
          '{ordering,comparatorRevision}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_ordering_comparator_revision"::text
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{actor,id}')
          is not distinct from "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_actor_external_identity_id"
        and ("inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail" #>> '{revision}') = '1'
        and ("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail" #>>
          '{semanticFamilyId}') = 'core:message.lifecycle'
        and ("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail" #> '{proof}') =
          "inbox_v2_message_provider_lifecycle_operations"."provider_semantic_proof_detail"
        and (("inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_commit_detail" #>> '{committedAt}')::timestamptz) =
          "inbox_v2_message_provider_lifecycle_operations"."semantic_ordering_committed_at"
      )),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_clock_check" CHECK (coalesce((char_length("inbox_v2_message_provider_lifecycle_operations"."id") <= 256
    and "inbox_v2_message_provider_lifecycle_operations"."id" ~ '^message_provider_lifecycle_operation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_provider_lifecycle_operations"."binding_generation" >= 1 and "inbox_v2_message_provider_lifecycle_operations"."capability_revision" >= 1
        and "inbox_v2_message_provider_lifecycle_operations"."adapter_declaration_revision" >= 1
        and "inbox_v2_message_provider_lifecycle_operations"."revision" >= 1 and "inbox_v2_message_provider_lifecycle_operations"."created_stream_position" >= 1
        and "inbox_v2_message_provider_lifecycle_operations"."last_changed_stream_position" >=
          "inbox_v2_message_provider_lifecycle_operations"."created_stream_position"
        and isfinite("inbox_v2_message_provider_lifecycle_operations"."occurred_at") and isfinite("inbox_v2_message_provider_lifecycle_operations"."recorded_at")
        and isfinite("inbox_v2_message_provider_lifecycle_operations"."created_at") and isfinite("inbox_v2_message_provider_lifecycle_operations"."updated_at")
        and isfinite("inbox_v2_message_provider_lifecycle_operations"."adapter_loaded_at")
        and "inbox_v2_message_provider_lifecycle_operations"."adapter_loaded_at" <= "inbox_v2_message_provider_lifecycle_operations"."recorded_at"
        and "inbox_v2_message_provider_lifecycle_operations"."occurred_at" <= "inbox_v2_message_provider_lifecycle_operations"."recorded_at"
        and "inbox_v2_message_provider_lifecycle_operations"."recorded_at" = "inbox_v2_message_provider_lifecycle_operations"."created_at"
        and "inbox_v2_message_provider_lifecycle_operations"."created_at" <= "inbox_v2_message_provider_lifecycle_operations"."updated_at"
        and ("inbox_v2_message_provider_lifecycle_operations"."policy_decided_at" is null
          or ("inbox_v2_message_provider_lifecycle_operations"."policy_decided_at" <= "inbox_v2_message_provider_lifecycle_operations"."updated_at"
            and isfinite("inbox_v2_message_provider_lifecycle_operations"."policy_decided_at"))))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_provider_lifecycle_transitions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"operation_id" text NOT NULL,
	"expected_revision" bigint NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"outcome" "inbox_v2_provider_lifecycle_outcome" NOT NULL,
	"outcome_retryable" integer,
	"outcome_reason_id" text,
	"delete_local_effect" "inbox_v2_provider_delete_local_effect",
	"policy_decision_event_id" text,
	"policy_decision_revision" bigint,
	"policy_decided_at" timestamp (3) with time zone,
	"result_token" text,
	"result_digest_sha256" text,
	"result_proof_outbound_route_id" text,
	"result_proof_capability_id" text,
	"result_proof_capability_revision" bigint,
	"result_proof_semantic_id" text,
	"result_proof_semantic_revision" bigint,
	"result_proof_state" text,
	"result_proof_declared_by_trusted_service_id" text,
	"result_proof_recorded_at" timestamp (3) with time zone,
	"result_proof_adapter_contract_detail" jsonb,
	"result_proof_adapter_contract_detail_digest_sha256" text,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_revision_unique" UNIQUE("tenant_id","operation_id","resulting_revision"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_expected_unique" UNIQUE("tenant_id","operation_id","expected_revision"),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_chain_check" CHECK (coalesce((char_length("inbox_v2_message_provider_lifecycle_transitions"."id") <= 256
    and "inbox_v2_message_provider_lifecycle_transitions"."id" ~ '^message_provider_lifecycle_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_provider_lifecycle_transitions"."expected_revision" >= 1
        and "inbox_v2_message_provider_lifecycle_transitions"."resulting_revision" = "inbox_v2_message_provider_lifecycle_transitions"."expected_revision" + 1
        and "inbox_v2_message_provider_lifecycle_transitions"."recorded_stream_position" >= 1
        and "inbox_v2_message_provider_lifecycle_transitions"."record_revision" = 1
        and isfinite("inbox_v2_message_provider_lifecycle_transitions"."recorded_at")),
	CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_proof_check" CHECK ((num_nonnulls(
          "inbox_v2_message_provider_lifecycle_transitions"."result_token", "inbox_v2_message_provider_lifecycle_transitions"."result_digest_sha256",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_outbound_route_id", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_capability_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_capability_revision", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_semantic_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_semantic_revision", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_state",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_declared_by_trusted_service_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_recorded_at",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail_digest_sha256"
        ) = 0)
        or (num_nonnulls(
          "inbox_v2_message_provider_lifecycle_transitions"."result_token", "inbox_v2_message_provider_lifecycle_transitions"."result_digest_sha256",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_outbound_route_id", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_capability_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_capability_revision", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_semantic_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_semantic_revision", "inbox_v2_message_provider_lifecycle_transitions"."result_proof_state",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_declared_by_trusted_service_id",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_recorded_at",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail",
          "inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail_digest_sha256"
        ) = 12
          and "inbox_v2_message_provider_lifecycle_transitions"."result_digest_sha256" ~ '^[a-f0-9]{64}$'
          and "inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail_digest_sha256" ~
            '^[a-f0-9]{64}$'
          and "inbox_v2_message_provider_lifecycle_transitions"."result_proof_capability_revision" >= 1
          and "inbox_v2_message_provider_lifecycle_transitions"."result_proof_semantic_revision" >= 1
          and "inbox_v2_message_provider_lifecycle_transitions"."result_proof_state" in (
            'accepted', 'confirmed', 'failed', 'unsupported', 'outcome_unknown'
          )
          and isfinite("inbox_v2_message_provider_lifecycle_transitions"."result_proof_recorded_at")
          and jsonb_typeof("inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail") =
            'object'
          and pg_column_size("inbox_v2_message_provider_lifecycle_transitions"."result_proof_adapter_contract_detail") <=
            65536
          and "inbox_v2_message_provider_lifecycle_transitions"."result_proof_recorded_at" = "inbox_v2_message_provider_lifecycle_transitions"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_provider_reaction_observations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"transition_id" text NOT NULL,
	"normalized_inbound_event_id" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"semantic_id" text NOT NULL,
	"semantic_proof_digest_sha256" text NOT NULL,
	"semantic_proof_detail" jsonb NOT NULL,
	"ordering_position" text NOT NULL,
	"ordering_proof_digest_sha256" text NOT NULL,
	"ordering_commit_detail" jsonb NOT NULL,
	"normalized_state_kind" "inbox_v2_reaction_state_kind" NOT NULL,
	"normalized_value_kind" "inbox_v2_reaction_value_kind" NOT NULL,
	"normalized_unicode_value" text,
	"normalized_provider_reaction_kind_id" text,
	"normalized_provider_canonical_code" text,
	"provider_actor_participant_id" text,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_provider_reaction_observations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_provider_reaction_observation_transition_unique" UNIQUE("tenant_id","transition_id"),
	CONSTRAINT "inbox_v2_message_provider_reaction_observations_proof_check" CHECK ("inbox_v2_message_provider_reaction_observations"."semantic_proof_digest_sha256" ~ '^[a-f0-9]{64}$'
        and "inbox_v2_message_provider_reaction_observations"."ordering_proof_digest_sha256" ~ '^[a-f0-9]{64}$'
        and jsonb_typeof("inbox_v2_message_provider_reaction_observations"."semantic_proof_detail") = 'object'
        and jsonb_typeof("inbox_v2_message_provider_reaction_observations"."ordering_commit_detail") = 'object'
        and pg_column_size("inbox_v2_message_provider_reaction_observations"."semantic_proof_detail") <= 65536
        and pg_column_size("inbox_v2_message_provider_reaction_observations"."ordering_commit_detail") <= 65536
        and "inbox_v2_message_provider_reaction_observations"."ordering_position" ~ '^(0|[1-9][0-9]*)$'
        and "inbox_v2_message_provider_reaction_observations"."revision" = 1
        and "inbox_v2_message_provider_reaction_observations"."normalized_state_kind" in ('active', 'cleared')),
	CONSTRAINT "inbox_v2_message_provider_reaction_observations_clock_check" CHECK (coalesce((char_length("inbox_v2_message_provider_reaction_observations"."id") <= 256
    and "inbox_v2_message_provider_reaction_observations"."id" ~ '^provider_reaction_observation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and isfinite("inbox_v2_message_provider_reaction_observations"."observed_at") and isfinite("inbox_v2_message_provider_reaction_observations"."recorded_at")
        and "inbox_v2_message_provider_reaction_observations"."recorded_at" >= "inbox_v2_message_provider_reaction_observations"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reaction_slot_heads" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"semantic_slot_key" text NOT NULL,
	"reaction_id" text NOT NULL,
	"state_kind" "inbox_v2_reaction_state_kind" NOT NULL,
	"revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reaction_slot_heads_pk" PRIMARY KEY("tenant_id","message_id","semantic_slot_key"),
	CONSTRAINT "inbox_v2_message_reaction_slot_heads_clock_check" CHECK ("inbox_v2_message_reaction_slot_heads"."revision" >= 1 and "inbox_v2_message_reaction_slot_heads"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_message_reaction_slot_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reaction_transitions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"reaction_id" text NOT NULL,
	"semantic_slot_key" text NOT NULL,
	"mode" "inbox_v2_reaction_transition_mode" NOT NULL,
	"operation" "inbox_v2_reaction_operation" NOT NULL,
	"expected_revision" bigint,
	"resulting_revision" bigint NOT NULL,
	"before_state_kind" "inbox_v2_reaction_state_kind",
	"after_state_kind" "inbox_v2_reaction_state_kind" NOT NULL,
	"before_state_detail" jsonb,
	"before_state_detail_digest_sha256" text,
	"after_state_detail" jsonb NOT NULL,
	"after_state_detail_digest_sha256" text NOT NULL,
	"value_kind" "inbox_v2_reaction_value_kind" NOT NULL,
	"unicode_value" text,
	"provider_reaction_kind_id" text,
	"provider_canonical_code" text,
	"action_attribution_id" text NOT NULL,
	"external_message_reference_id" text,
	"source_occurrence_id" text,
	"source_account_id" text,
	"source_thread_binding_id" text,
	"binding_generation" bigint,
	"outbound_route_id" text,
	"capability_id" text,
	"capability_revision" bigint,
	"adapter_contract_id" text,
	"adapter_contract_version" text,
	"external_authority_detail" jsonb,
	"external_authority_detail_digest_sha256" text,
	"provider_result_proof_detail" jsonb,
	"provider_result_proof_detail_digest_sha256" text,
	"result_token" text,
	"result_digest_sha256" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_reaction_transitions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_reaction_transitions_revision_unique" UNIQUE("tenant_id","reaction_id","resulting_revision"),
	CONSTRAINT "inbox_v2_message_reaction_transitions_chain_check" CHECK (("inbox_v2_message_reaction_transitions"."expected_revision" is null
          and "inbox_v2_message_reaction_transitions"."resulting_revision" = 1
          and "inbox_v2_message_reaction_transitions"."before_state_kind" is null
          and "inbox_v2_message_reaction_transitions"."before_state_detail" is null
          and "inbox_v2_message_reaction_transitions"."before_state_detail_digest_sha256" is null)
        or ("inbox_v2_message_reaction_transitions"."expected_revision" is not null
          and "inbox_v2_message_reaction_transitions"."resulting_revision" = "inbox_v2_message_reaction_transitions"."expected_revision" + 1
          and "inbox_v2_message_reaction_transitions"."before_state_kind" is not null
          and jsonb_typeof("inbox_v2_message_reaction_transitions"."before_state_detail") = 'object'
          and "inbox_v2_message_reaction_transitions"."before_state_detail_digest_sha256" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "inbox_v2_message_reaction_transitions_authority_check" CHECK (("inbox_v2_message_reaction_transitions"."mode" in ('internal_apply', 'provider_result')
          and num_nonnulls(
            "inbox_v2_message_reaction_transitions"."external_message_reference_id", "inbox_v2_message_reaction_transitions"."source_occurrence_id",
            "inbox_v2_message_reaction_transitions"."source_account_id", "inbox_v2_message_reaction_transitions"."source_thread_binding_id",
            "inbox_v2_message_reaction_transitions"."binding_generation", "inbox_v2_message_reaction_transitions"."outbound_route_id",
            "inbox_v2_message_reaction_transitions"."capability_id", "inbox_v2_message_reaction_transitions"."capability_revision",
            "inbox_v2_message_reaction_transitions"."adapter_contract_id", "inbox_v2_message_reaction_transitions"."adapter_contract_version",
            "inbox_v2_message_reaction_transitions"."external_authority_detail",
            "inbox_v2_message_reaction_transitions"."external_authority_detail_digest_sha256"
          ) = 0)
        or ("inbox_v2_message_reaction_transitions"."mode" in ('external_request', 'provider_observed')
          and num_nonnulls(
            "inbox_v2_message_reaction_transitions"."external_message_reference_id", "inbox_v2_message_reaction_transitions"."source_occurrence_id",
            "inbox_v2_message_reaction_transitions"."source_account_id", "inbox_v2_message_reaction_transitions"."source_thread_binding_id",
            "inbox_v2_message_reaction_transitions"."binding_generation", "inbox_v2_message_reaction_transitions"."capability_id",
            "inbox_v2_message_reaction_transitions"."capability_revision", "inbox_v2_message_reaction_transitions"."adapter_contract_id",
            "inbox_v2_message_reaction_transitions"."adapter_contract_version",
            "inbox_v2_message_reaction_transitions"."external_authority_detail",
            "inbox_v2_message_reaction_transitions"."external_authority_detail_digest_sha256"
          ) = 11
          and jsonb_typeof("inbox_v2_message_reaction_transitions"."external_authority_detail") = 'object'
          and "inbox_v2_message_reaction_transitions"."external_authority_detail_digest_sha256" ~ '^[a-f0-9]{64}$'
          and pg_column_size("inbox_v2_message_reaction_transitions"."external_authority_detail") <= 65536
          and (("inbox_v2_message_reaction_transitions"."mode" = 'provider_observed') =
            ("inbox_v2_message_reaction_transitions"."outbound_route_id" is null)))),
	CONSTRAINT "inbox_v2_message_reaction_transitions_clock_check" CHECK (coalesce((char_length("inbox_v2_message_reaction_transitions"."id") <= 256
    and "inbox_v2_message_reaction_transitions"."id" ~ '^message_reaction_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_reaction_transitions"."recorded_stream_position" >= 1
        and "inbox_v2_message_reaction_transitions"."record_revision" = 1
        and isfinite("inbox_v2_message_reaction_transitions"."occurred_at") and isfinite("inbox_v2_message_reaction_transitions"."recorded_at")
        and "inbox_v2_message_reaction_transitions"."recorded_at" >= "inbox_v2_message_reaction_transitions"."occurred_at"
        and jsonb_typeof("inbox_v2_message_reaction_transitions"."after_state_detail") = 'object'
        and "inbox_v2_message_reaction_transitions"."after_state_detail_digest_sha256" ~ '^[a-f0-9]{64}$'
        and pg_column_size("inbox_v2_message_reaction_transitions"."after_state_detail") <= 65536
        and ("inbox_v2_message_reaction_transitions"."before_state_detail" is null
          or pg_column_size("inbox_v2_message_reaction_transitions"."before_state_detail") <= 65536)
        and (
          ("inbox_v2_message_reaction_transitions"."mode" = 'provider_result'
            and num_nonnulls(
              "inbox_v2_message_reaction_transitions"."provider_result_proof_detail",
              "inbox_v2_message_reaction_transitions"."provider_result_proof_detail_digest_sha256",
              "inbox_v2_message_reaction_transitions"."result_token", "inbox_v2_message_reaction_transitions"."result_digest_sha256"
            ) = 4
            and jsonb_typeof("inbox_v2_message_reaction_transitions"."provider_result_proof_detail") = 'object'
            and pg_column_size("inbox_v2_message_reaction_transitions"."provider_result_proof_detail") <= 65536
            and "inbox_v2_message_reaction_transitions"."provider_result_proof_detail_digest_sha256" ~
              '^[a-f0-9]{64}$'
            and "inbox_v2_message_reaction_transitions"."result_digest_sha256" ~ '^[a-f0-9]{64}$')
          or ("inbox_v2_message_reaction_transitions"."mode" <> 'provider_result'
            and num_nonnulls(
              "inbox_v2_message_reaction_transitions"."provider_result_proof_detail",
              "inbox_v2_message_reaction_transitions"."provider_result_proof_detail_digest_sha256",
              "inbox_v2_message_reaction_transitions"."result_token", "inbox_v2_message_reaction_transitions"."result_digest_sha256"
            ) = 0)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reactions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"actor_kind" "inbox_v2_reaction_actor_kind" NOT NULL,
	"actor_participant_id" text,
	"actor_source_occurrence_id" text,
	"opaque_actor_key" text,
	"opaque_actor_key_digest_sha256" text,
	"aggregate_scope" text,
	"provider_actor_kind_id" text,
	"provider_actor_subject" text,
	"provider_actor_subject_digest_sha256" text,
	"actor_identity_data_class_id" text,
	"actor_identity_state" text,
	"actor_identity_tombstone_event_id" text,
	"actor_identity_purged_at" timestamp (3) with time zone,
	"capability_kind" "inbox_v2_reaction_capability_kind" NOT NULL,
	"capability_id" text,
	"capability_revision" bigint,
	"cardinality" "inbox_v2_reaction_cardinality" NOT NULL,
	"adapter_contract_id" text,
	"adapter_contract_version" text,
	"capability_detail" jsonb NOT NULL,
	"capability_detail_digest_sha256" text NOT NULL,
	"semantic_slot_key" text NOT NULL,
	"state_kind" "inbox_v2_reaction_state_kind" NOT NULL,
	"value_kind" "inbox_v2_reaction_value_kind" NOT NULL,
	"unicode_value" text,
	"provider_reaction_kind_id" text,
	"provider_canonical_code" text,
	"cleared_at" timestamp (3) with time zone,
	"external_operation" "inbox_v2_reaction_operation",
	"outbound_route_id" text,
	"request_transition_id" text,
	"request_attribution_id" text,
	"external_outcome" text,
	"result_token" text,
	"result_digest_sha256" text,
	"resolved_at" timestamp (3) with time zone,
	"state_detail" jsonb NOT NULL,
	"state_detail_digest_sha256" text NOT NULL,
	"revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reactions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_reactions_slot_unique" UNIQUE("tenant_id","message_id","semantic_slot_key"),
	CONSTRAINT "inbox_v2_message_reactions_target_unique" UNIQUE("tenant_id","id","message_id","semantic_slot_key"),
	CONSTRAINT "inbox_v2_message_reactions_transition_target_unique" UNIQUE("tenant_id","id","semantic_slot_key"),
	CONSTRAINT "inbox_v2_message_reactions_revision_unique" UNIQUE("tenant_id","id","revision"),
	CONSTRAINT "inbox_v2_message_reactions_actor_check" CHECK (("inbox_v2_message_reactions"."actor_kind" = 'participant'
          and "inbox_v2_message_reactions"."actor_participant_id" is not null
          and num_nonnulls(
            "inbox_v2_message_reactions"."actor_source_occurrence_id", "inbox_v2_message_reactions"."opaque_actor_key_digest_sha256",
            "inbox_v2_message_reactions"."aggregate_scope", "inbox_v2_message_reactions"."provider_actor_kind_id",
            "inbox_v2_message_reactions"."provider_actor_subject_digest_sha256", "inbox_v2_message_reactions"."opaque_actor_key",
            "inbox_v2_message_reactions"."provider_actor_subject", "inbox_v2_message_reactions"."actor_identity_data_class_id",
            "inbox_v2_message_reactions"."actor_identity_state", "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
            "inbox_v2_message_reactions"."actor_identity_purged_at"
          ) = 0)
        or ("inbox_v2_message_reactions"."actor_kind" = 'unattributed_source_observation'
          and "inbox_v2_message_reactions"."actor_source_occurrence_id" is not null
          and "inbox_v2_message_reactions"."actor_identity_data_class_id" = 'core:source_occurrence_and_external_reference'
          and (
            ("inbox_v2_message_reactions"."actor_identity_state" = 'available'
              and "inbox_v2_message_reactions"."opaque_actor_key" is not null
              and "inbox_v2_message_reactions"."opaque_actor_key_digest_sha256" ~ '^[a-f0-9]{64}$'
              and num_nonnulls(
                "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
                "inbox_v2_message_reactions"."actor_identity_purged_at"
              ) = 0)
            or ("inbox_v2_message_reactions"."actor_identity_state" = 'purged'
              and num_nonnulls(
                "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
                "inbox_v2_message_reactions"."actor_identity_purged_at"
              ) = 2
              and num_nonnulls(
                "inbox_v2_message_reactions"."opaque_actor_key", "inbox_v2_message_reactions"."opaque_actor_key_digest_sha256"
              ) = 0)
          )
          and num_nonnulls(
            "inbox_v2_message_reactions"."actor_participant_id", "inbox_v2_message_reactions"."aggregate_scope",
            "inbox_v2_message_reactions"."provider_actor_kind_id", "inbox_v2_message_reactions"."provider_actor_subject",
            "inbox_v2_message_reactions"."provider_actor_subject_digest_sha256"
          ) = 0)
        or ("inbox_v2_message_reactions"."actor_kind" = 'aggregate_only'
          and "inbox_v2_message_reactions"."actor_source_occurrence_id" is not null
          and "inbox_v2_message_reactions"."aggregate_scope" in ('thread', 'recipient_set', 'unknown')
          and num_nonnulls(
            "inbox_v2_message_reactions"."actor_participant_id", "inbox_v2_message_reactions"."opaque_actor_key_digest_sha256",
            "inbox_v2_message_reactions"."opaque_actor_key", "inbox_v2_message_reactions"."provider_actor_kind_id",
            "inbox_v2_message_reactions"."provider_actor_subject",
            "inbox_v2_message_reactions"."provider_actor_subject_digest_sha256",
            "inbox_v2_message_reactions"."actor_identity_data_class_id", "inbox_v2_message_reactions"."actor_identity_state",
            "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
            "inbox_v2_message_reactions"."actor_identity_purged_at"
          ) = 0)
        or ("inbox_v2_message_reactions"."actor_kind" = 'provider_system'
          and "inbox_v2_message_reactions"."actor_source_occurrence_id" is not null
          and "inbox_v2_message_reactions"."provider_actor_kind_id" is not null
          and "inbox_v2_message_reactions"."actor_identity_data_class_id" = 'core:source_occurrence_and_external_reference'
          and (
            ("inbox_v2_message_reactions"."actor_identity_state" = 'available'
              and "inbox_v2_message_reactions"."provider_actor_subject" is not null
              and "inbox_v2_message_reactions"."provider_actor_subject_digest_sha256" ~ '^[a-f0-9]{64}$'
              and num_nonnulls(
                "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
                "inbox_v2_message_reactions"."actor_identity_purged_at"
              ) = 0)
            or ("inbox_v2_message_reactions"."actor_identity_state" = 'purged'
              and num_nonnulls(
                "inbox_v2_message_reactions"."actor_identity_tombstone_event_id",
                "inbox_v2_message_reactions"."actor_identity_purged_at"
              ) = 2
              and num_nonnulls(
                "inbox_v2_message_reactions"."provider_actor_subject",
                "inbox_v2_message_reactions"."provider_actor_subject_digest_sha256"
              ) = 0)
          )
          and num_nonnulls(
            "inbox_v2_message_reactions"."actor_participant_id", "inbox_v2_message_reactions"."opaque_actor_key",
            "inbox_v2_message_reactions"."opaque_actor_key_digest_sha256", "inbox_v2_message_reactions"."aggregate_scope"
          ) = 0)),
	CONSTRAINT "inbox_v2_message_reactions_capability_check" CHECK (("inbox_v2_message_reactions"."capability_kind" = 'internal'
          and "inbox_v2_message_reactions"."cardinality" = 'multiple_values'
          and "inbox_v2_message_reactions"."actor_kind" = 'participant'
          and num_nonnulls(
            "inbox_v2_message_reactions"."capability_id", "inbox_v2_message_reactions"."capability_revision",
            "inbox_v2_message_reactions"."adapter_contract_id", "inbox_v2_message_reactions"."adapter_contract_version"
          ) = 0)
        or ("inbox_v2_message_reactions"."capability_kind" = 'external'
          and num_nonnulls(
            "inbox_v2_message_reactions"."capability_id", "inbox_v2_message_reactions"."capability_revision",
            "inbox_v2_message_reactions"."adapter_contract_id", "inbox_v2_message_reactions"."adapter_contract_version"
          ) = 4
          and coalesce((char_length("inbox_v2_message_reactions"."capability_id") <= 256 and (
    ("inbox_v2_message_reactions"."capability_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_reactions"."capability_id", ':', 2)) <= 160)
    or ("inbox_v2_message_reactions"."capability_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_reactions"."capability_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_message_reactions"."capability_id", ':', 3)) <= 160
      and split_part("inbox_v2_message_reactions"."capability_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
          and "inbox_v2_message_reactions"."capability_revision" >= 1
          and (("inbox_v2_message_reactions"."actor_kind" = 'aggregate_only') =
            ("inbox_v2_message_reactions"."cardinality" = 'aggregate_only')))),
	CONSTRAINT "inbox_v2_message_reactions_value_check" CHECK (("inbox_v2_message_reactions"."value_kind" = 'unicode'
          and char_length("inbox_v2_message_reactions"."unicode_value") between 1 and 64
          and num_nonnulls(
            "inbox_v2_message_reactions"."provider_reaction_kind_id", "inbox_v2_message_reactions"."provider_canonical_code"
          ) = 0)
        or ("inbox_v2_message_reactions"."value_kind" = 'provider_custom'
          and "inbox_v2_message_reactions"."unicode_value" is null
          and num_nonnulls(
            "inbox_v2_message_reactions"."provider_reaction_kind_id", "inbox_v2_message_reactions"."provider_canonical_code"
          ) = 2
          and coalesce((char_length("inbox_v2_message_reactions"."provider_reaction_kind_id") <= 256 and (
    ("inbox_v2_message_reactions"."provider_reaction_kind_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_reactions"."provider_reaction_kind_id", ':', 2)) <= 160)
    or ("inbox_v2_message_reactions"."provider_reaction_kind_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_message_reactions"."provider_reaction_kind_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_message_reactions"."provider_reaction_kind_id", ':', 3)) <= 160
      and split_part("inbox_v2_message_reactions"."provider_reaction_kind_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false))),
	CONSTRAINT "inbox_v2_message_reactions_state_check" CHECK (("inbox_v2_message_reactions"."state_kind" = 'active'
          and num_nonnulls(
            "inbox_v2_message_reactions"."cleared_at", "inbox_v2_message_reactions"."external_operation",
            "inbox_v2_message_reactions"."outbound_route_id", "inbox_v2_message_reactions"."request_transition_id",
            "inbox_v2_message_reactions"."request_attribution_id", "inbox_v2_message_reactions"."external_outcome",
            "inbox_v2_message_reactions"."result_token", "inbox_v2_message_reactions"."result_digest_sha256", "inbox_v2_message_reactions"."resolved_at"
          ) = 0)
        or ("inbox_v2_message_reactions"."state_kind" = 'cleared'
          and "inbox_v2_message_reactions"."cleared_at" = "inbox_v2_message_reactions"."updated_at"
          and num_nonnulls(
            "inbox_v2_message_reactions"."external_operation", "inbox_v2_message_reactions"."outbound_route_id",
            "inbox_v2_message_reactions"."request_transition_id", "inbox_v2_message_reactions"."request_attribution_id",
            "inbox_v2_message_reactions"."external_outcome", "inbox_v2_message_reactions"."result_token",
            "inbox_v2_message_reactions"."result_digest_sha256", "inbox_v2_message_reactions"."resolved_at"
          ) = 0)
        or ("inbox_v2_message_reactions"."state_kind" = 'pending_external'
          and num_nonnulls(
            "inbox_v2_message_reactions"."external_operation", "inbox_v2_message_reactions"."outbound_route_id",
            "inbox_v2_message_reactions"."request_transition_id", "inbox_v2_message_reactions"."request_attribution_id"
          ) = 4
          and num_nonnulls(
            "inbox_v2_message_reactions"."cleared_at", "inbox_v2_message_reactions"."external_outcome", "inbox_v2_message_reactions"."result_token",
            "inbox_v2_message_reactions"."result_digest_sha256", "inbox_v2_message_reactions"."resolved_at"
          ) = 0)
        or ("inbox_v2_message_reactions"."state_kind" = 'external_terminal'
          and "inbox_v2_message_reactions"."external_outcome" in ('failed', 'unsupported', 'outcome_unknown')
          and "inbox_v2_message_reactions"."result_digest_sha256" ~ '^[a-f0-9]{64}$'
          and "inbox_v2_message_reactions"."resolved_at" = "inbox_v2_message_reactions"."updated_at"
          and num_nonnulls(
            "inbox_v2_message_reactions"."external_operation", "inbox_v2_message_reactions"."outbound_route_id",
            "inbox_v2_message_reactions"."request_transition_id", "inbox_v2_message_reactions"."external_outcome",
            "inbox_v2_message_reactions"."result_token", "inbox_v2_message_reactions"."result_digest_sha256", "inbox_v2_message_reactions"."resolved_at"
          ) = 7
          and num_nonnulls("inbox_v2_message_reactions"."cleared_at", "inbox_v2_message_reactions"."request_attribution_id") = 0)),
	CONSTRAINT "inbox_v2_message_reactions_clock_check" CHECK (coalesce((char_length("inbox_v2_message_reactions"."id") <= 256
    and "inbox_v2_message_reactions"."id" ~ '^message_reaction:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and char_length("inbox_v2_message_reactions"."semantic_slot_key") between 1 and 2048
        and "inbox_v2_message_reactions"."semantic_slot_key" like 'v1:%'
        and "inbox_v2_message_reactions"."revision" >= 1
        and "inbox_v2_message_reactions"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_message_reactions"."created_at") and isfinite("inbox_v2_message_reactions"."updated_at")
        and "inbox_v2_message_reactions"."updated_at" >= "inbox_v2_message_reactions"."created_at"
        and ("inbox_v2_message_reactions"."revision" <> 1 or (
          "inbox_v2_message_reactions"."state_kind" in ('active', 'pending_external')
          and "inbox_v2_message_reactions"."created_at" = "inbox_v2_message_reactions"."updated_at"
        ))
        and "inbox_v2_message_reactions"."capability_detail_digest_sha256" ~ '^[a-f0-9]{64}$'
        and "inbox_v2_message_reactions"."state_detail_digest_sha256" ~ '^[a-f0-9]{64}$'
        and jsonb_typeof("inbox_v2_message_reactions"."capability_detail") = 'object'
        and jsonb_typeof("inbox_v2_message_reactions"."state_detail") = 'object'
        and pg_column_size("inbox_v2_message_reactions"."capability_detail") <= 65536
        and pg_column_size("inbox_v2_message_reactions"."state_detail") <= 65536
        and ("inbox_v2_message_reactions"."actor_identity_purged_at" is null
          or isfinite("inbox_v2_message_reactions"."actor_identity_purged_at")))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reference_canonical_targets" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"target_message_id" text NOT NULL,
	"target_timeline_item_id" text NOT NULL,
	"target_message_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reference_canonical_targets_pk" PRIMARY KEY("tenant_id","message_id","ordinal"),
	CONSTRAINT "inbox_v2_message_reference_canonical_targets_unique" UNIQUE("tenant_id","message_id","target_message_id","target_timeline_item_id"),
	CONSTRAINT "inbox_v2_message_reference_canonical_targets_check" CHECK ("inbox_v2_message_reference_canonical_targets"."ordinal" between 0 and 31
        and "inbox_v2_message_reference_canonical_targets"."target_message_revision" >= 1
        and isfinite("inbox_v2_message_reference_canonical_targets"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reference_contexts" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"kind" "inbox_v2_message_reference_context_kind" NOT NULL,
	"origin_source_occurrence_id" text,
	"provenance_completeness" "inbox_v2_provider_forward_provenance",
	"native_capability_id" text,
	"native_capability_revision" bigint,
	"native_adapter_contract_id" text,
	"native_adapter_contract_version" text,
	"native_adapter_declaration_revision" bigint,
	"native_adapter_surface_id" text,
	"native_adapter_loaded_by_trusted_service_id" text,
	"native_adapter_loaded_at" timestamp (3) with time zone,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reference_contexts_pk" PRIMARY KEY("tenant_id","message_id"),
	CONSTRAINT "inbox_v2_message_reference_contexts_shape_check" CHECK (("inbox_v2_message_reference_contexts"."kind" in ('none', 'reply', 'forward_content_copy')
          and num_nonnulls(
            "inbox_v2_message_reference_contexts"."origin_source_occurrence_id", "inbox_v2_message_reference_contexts"."provenance_completeness",
            "inbox_v2_message_reference_contexts"."native_capability_id", "inbox_v2_message_reference_contexts"."native_capability_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_id",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_version",
            "inbox_v2_message_reference_contexts"."native_adapter_declaration_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_surface_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_by_trusted_service_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_at"
          ) = 0)
        or ("inbox_v2_message_reference_contexts"."kind" = 'forward_provider_native'
          and num_nonnulls(
            "inbox_v2_message_reference_contexts"."native_capability_id", "inbox_v2_message_reference_contexts"."native_capability_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_id",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_version",
            "inbox_v2_message_reference_contexts"."native_adapter_declaration_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_surface_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_by_trusted_service_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_at"
          ) = 8
          and "inbox_v2_message_reference_contexts"."native_capability_revision" >= 1
          and "inbox_v2_message_reference_contexts"."native_adapter_declaration_revision" >= 1
          and isfinite("inbox_v2_message_reference_contexts"."native_adapter_loaded_at")
          and "inbox_v2_message_reference_contexts"."origin_source_occurrence_id" is null
          and "inbox_v2_message_reference_contexts"."provenance_completeness" is null)
        or ("inbox_v2_message_reference_contexts"."kind" = 'forward_provider_observed'
          and "inbox_v2_message_reference_contexts"."origin_source_occurrence_id" is not null
          and "inbox_v2_message_reference_contexts"."provenance_completeness" is not null
          and num_nonnulls(
            "inbox_v2_message_reference_contexts"."native_capability_id", "inbox_v2_message_reference_contexts"."native_capability_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_id",
            "inbox_v2_message_reference_contexts"."native_adapter_contract_version",
            "inbox_v2_message_reference_contexts"."native_adapter_declaration_revision",
            "inbox_v2_message_reference_contexts"."native_adapter_surface_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_by_trusted_service_id",
            "inbox_v2_message_reference_contexts"."native_adapter_loaded_at"
          ) = 0)),
	CONSTRAINT "inbox_v2_message_reference_contexts_record_check" CHECK ("inbox_v2_message_reference_contexts"."revision" = 1 and isfinite("inbox_v2_message_reference_contexts"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reference_external_targets" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reference_external_targets_pk" PRIMARY KEY("tenant_id","message_id","ordinal"),
	CONSTRAINT "inbox_v2_message_reference_external_targets_unique" UNIQUE("tenant_id","message_id","external_message_reference_id","source_occurrence_id"),
	CONSTRAINT "inbox_v2_message_reference_external_targets_check" CHECK ("inbox_v2_message_reference_external_targets"."ordinal" between 0 and 31 and isfinite("inbox_v2_message_reference_external_targets"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reference_unresolved_candidates" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reference_unresolved_candidates_pk" PRIMARY KEY("tenant_id","message_id","ordinal"),
	CONSTRAINT "inbox_v2_message_reference_unresolved_candidates_unique" UNIQUE("tenant_id","message_id","external_message_reference_id"),
	CONSTRAINT "inbox_v2_message_reference_unresolved_candidates_check" CHECK ("inbox_v2_message_reference_unresolved_candidates"."ordinal" between 0 and 99 and isfinite("inbox_v2_message_reference_unresolved_candidates"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_reference_unresolved_targets" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"external_message_key_digest_sha256" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"resolution_state" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_reference_unresolved_targets_pk" PRIMARY KEY("tenant_id","message_id"),
	CONSTRAINT "inbox_v2_message_reference_unresolved_targets_check" CHECK ("inbox_v2_message_reference_unresolved_targets"."external_message_key_digest_sha256" ~ '^[a-f0-9]{64}$'
        and "inbox_v2_message_reference_unresolved_targets"."resolution_state" in ('pending', 'conflicted')
        and isfinite("inbox_v2_message_reference_unresolved_targets"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_revisions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"expected_previous_revision" bigint,
	"message_revision" bigint NOT NULL,
	"change_kind" "inbox_v2_message_revision_change" NOT NULL,
	"before_content_id" text,
	"before_content_revision" bigint,
	"before_content_state" "inbox_v2_timeline_content_state",
	"after_content_id" text,
	"after_content_revision" bigint,
	"after_content_state" "inbox_v2_timeline_content_state",
	"provider_operation_id" text,
	"reason_id" text,
	"action_attribution_id" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_revisions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_revisions_message_revision_unique" UNIQUE("tenant_id","message_id","message_revision"),
	CONSTRAINT "inbox_v2_message_revisions_attribution_unique" UNIQUE("tenant_id","action_attribution_id"),
	CONSTRAINT "inbox_v2_message_revisions_chain_check" CHECK (("inbox_v2_message_revisions"."change_kind" = 'created'
          and "inbox_v2_message_revisions"."message_revision" = 1
          and "inbox_v2_message_revisions"."expected_previous_revision" is null)
        or ("inbox_v2_message_revisions"."change_kind" <> 'created'
          and "inbox_v2_message_revisions"."expected_previous_revision" is not null
          and "inbox_v2_message_revisions"."message_revision" = "inbox_v2_message_revisions"."expected_previous_revision" + 1)),
	CONSTRAINT "inbox_v2_message_revisions_content_check" CHECK (("inbox_v2_message_revisions"."change_kind" in (
          'created', 'edited', 'attachment_materialized',
          'privacy_erasure_tombstone', 'retention_purge_tombstone'
        ) and "inbox_v2_message_revisions"."after_content_id" is not null
          and "inbox_v2_message_revisions"."after_content_revision" is not null
          and "inbox_v2_message_revisions"."after_content_state" is not null)
        or ("inbox_v2_message_revisions"."change_kind" in (
          'local_delete_tombstone', 'provider_delete_policy_tombstone'
        ) and num_nonnulls(
          "inbox_v2_message_revisions"."before_content_id", "inbox_v2_message_revisions"."before_content_revision",
          "inbox_v2_message_revisions"."before_content_state", "inbox_v2_message_revisions"."after_content_id",
          "inbox_v2_message_revisions"."after_content_revision", "inbox_v2_message_revisions"."after_content_state"
        ) = 0)),
	CONSTRAINT "inbox_v2_message_revisions_clock_check" CHECK (coalesce((char_length("inbox_v2_message_revisions"."id") <= 256
    and "inbox_v2_message_revisions"."id" ~ '^message_revision:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_revisions"."recorded_stream_position" >= 1
        and "inbox_v2_message_revisions"."record_revision" = 1
        and isfinite("inbox_v2_message_revisions"."occurred_at")
        and isfinite("inbox_v2_message_revisions"."recorded_at")
        and "inbox_v2_message_revisions"."recorded_at" >= "inbox_v2_message_revisions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_transport_fact_commits" (
	"tenant_id" text NOT NULL,
	"commit_token" text NOT NULL,
	"fact_kind" "inbox_v2_message_transport_fact_kind" NOT NULL,
	"observation_id" text NOT NULL,
	"message_id" text,
	"commit_digest_sha256" text NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_message_transport_fact_commits_pk" PRIMARY KEY("tenant_id","commit_token"),
	CONSTRAINT "inbox_v2_message_transport_fact_commits_observation_unique" UNIQUE("tenant_id","observation_id"),
	CONSTRAINT "inbox_v2_message_transport_fact_commits_shape_check" CHECK (coalesce((char_length("inbox_v2_message_transport_fact_commits"."commit_token") between 8 and 256
    and "inbox_v2_message_transport_fact_commits"."commit_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and (("inbox_v2_message_transport_fact_commits"."fact_kind" = 'delivery'
            and coalesce((char_length("inbox_v2_message_transport_fact_commits"."observation_id") <= 256
    and "inbox_v2_message_transport_fact_commits"."observation_id" ~ '^message_delivery_observation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
            and "inbox_v2_message_transport_fact_commits"."message_id" is not null)
          or ("inbox_v2_message_transport_fact_commits"."fact_kind" = 'receipt'
            and coalesce((char_length("inbox_v2_message_transport_fact_commits"."observation_id") <= 256
    and "inbox_v2_message_transport_fact_commits"."observation_id" ~ '^provider_receipt_observation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)))
        and coalesce(("inbox_v2_message_transport_fact_commits"."commit_digest_sha256" ~ '^[a-f0-9]{64}$'), false)
        and "inbox_v2_message_transport_fact_commits"."recorded_stream_position" >= 1 and "inbox_v2_message_transport_fact_commits"."revision" = 1
        and isfinite("inbox_v2_message_transport_fact_commits"."observed_at") and isfinite("inbox_v2_message_transport_fact_commits"."recorded_at")
        and "inbox_v2_message_transport_fact_commits"."recorded_at" >= "inbox_v2_message_transport_fact_commits"."observed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_transport_link_heads" (
	"tenant_id" text NOT NULL,
	"message_id" text NOT NULL,
	"link_count" bigint NOT NULL,
	"latest_link_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_message_transport_link_heads_pk" PRIMARY KEY("tenant_id","message_id"),
	CONSTRAINT "inbox_v2_message_transport_link_heads_clock_check" CHECK ("inbox_v2_message_transport_link_heads"."link_count" >= 1 and "inbox_v2_message_transport_link_heads"."revision" = "inbox_v2_message_transport_link_heads"."link_count"
        and "inbox_v2_message_transport_link_heads"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_message_transport_link_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_message_transport_links" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_id" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"role" "inbox_v2_message_transport_link_role" NOT NULL,
	"resulting_head_revision" bigint NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"linked_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	CONSTRAINT "inbox_v2_message_transport_links_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_message_transport_links_occurrence_unique" UNIQUE("tenant_id","source_occurrence_id"),
	CONSTRAINT "inbox_v2_message_transport_links_target_unique" UNIQUE("tenant_id","id","message_id"),
	CONSTRAINT "inbox_v2_message_transport_links_head_revision_unique" UNIQUE("tenant_id","message_id","resulting_head_revision"),
	CONSTRAINT "inbox_v2_message_transport_links_record_check" CHECK (coalesce((char_length("inbox_v2_message_transport_links"."id") <= 256
    and "inbox_v2_message_transport_links"."id" ~ '^message_transport_occurrence_link:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_message_transport_links"."resulting_head_revision" >= 1
        and "inbox_v2_message_transport_links"."recorded_stream_position" >= 1
        and "inbox_v2_message_transport_links"."revision" = 1 and isfinite("inbox_v2_message_transport_links"."linked_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_outbound_route_consumptions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"consumer_kind" "inbox_v2_outbound_route_consumer_kind" NOT NULL,
	"consumer_id" text NOT NULL,
	"message_id" text NOT NULL,
	"outbound_route_id" text NOT NULL,
	"mutation_token" text NOT NULL,
	"idempotency_token" text NOT NULL,
	"correlation_token" text NOT NULL,
	"consumed_at" timestamp (3) with time zone NOT NULL,
	"consumed_by_trusted_service_id" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"commit_digest_sha256" text NOT NULL,
	CONSTRAINT "inbox_v2_outbound_route_consumptions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_outbound_route_consumptions_route_unique" UNIQUE("tenant_id","outbound_route_id"),
	CONSTRAINT "inbox_v2_outbound_route_consumptions_consumer_unique" UNIQUE("tenant_id","consumer_kind","consumer_id"),
	CONSTRAINT "inbox_v2_outbound_route_consumptions_shape_check" CHECK (coalesce((char_length("inbox_v2_outbound_route_consumptions"."id") <= 256
    and "inbox_v2_outbound_route_consumptions"."id" ~ '^outbound_route_consumption:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_outbound_route_consumptions"."outbound_route_id") <= 256
    and "inbox_v2_outbound_route_consumptions"."outbound_route_id" ~ '^outbound_route:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and (
          ("inbox_v2_outbound_route_consumptions"."consumer_kind" = 'message_creation'
            and coalesce((char_length("inbox_v2_outbound_route_consumptions"."consumer_id") <= 256
    and "inbox_v2_outbound_route_consumptions"."consumer_id" ~ '^message:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false))
          or ("inbox_v2_outbound_route_consumptions"."consumer_kind" = 'provider_lifecycle'
            and coalesce((char_length("inbox_v2_outbound_route_consumptions"."consumer_id") <= 256
    and "inbox_v2_outbound_route_consumptions"."consumer_id" ~ '^message_provider_lifecycle_operation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false))
          or ("inbox_v2_outbound_route_consumptions"."consumer_kind" = 'reaction'
            and coalesce((char_length("inbox_v2_outbound_route_consumptions"."consumer_id") <= 256
    and "inbox_v2_outbound_route_consumptions"."consumer_id" ~ '^message_reaction_transition:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false))
        )
        and coalesce((char_length("inbox_v2_outbound_route_consumptions"."mutation_token") between 8 and 256
    and "inbox_v2_outbound_route_consumptions"."mutation_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_outbound_route_consumptions"."idempotency_token") between 8 and 256
    and "inbox_v2_outbound_route_consumptions"."idempotency_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_outbound_route_consumptions"."correlation_token") between 8 and 256
    and "inbox_v2_outbound_route_consumptions"."correlation_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id") <= 256 and (
    ("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id", ':', 2)) <= 160)
    or ("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_outbound_route_consumptions"."consumed_by_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce(("inbox_v2_outbound_route_consumptions"."commit_digest_sha256" ~ '^[a-f0-9]{64}$'), false)
        and "inbox_v2_outbound_route_consumptions"."revision" = 1 and isfinite("inbox_v2_outbound_route_consumptions"."consumed_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_provider_receipt_observations" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"target_kind" "inbox_v2_receipt_target_kind" NOT NULL,
	"target_message_id" text,
	"target_external_message_reference_id" text,
	"target_source_occurrence_id" text,
	"provider_watermark_digest_sha256" text,
	"read_through_provider_time" timestamp (3) with time zone,
	"reader_kind" "inbox_v2_receipt_reader_kind" NOT NULL,
	"reader_source_external_identity_id" text,
	"reader_aggregate_key_digest_sha256" text,
	"opaque_payload_id" text,
	"opaque_data_class_id" text,
	"source_account_id" text NOT NULL,
	"source_thread_binding_id" text NOT NULL,
	"binding_generation" bigint NOT NULL,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"capability_id" text NOT NULL,
	"capability_revision" bigint NOT NULL,
	"evidence_normalized_inbound_event_id" text NOT NULL,
	"semantic_proof_detail" jsonb NOT NULL,
	"semantic_proof_digest_sha256" text NOT NULL,
	"evidence_kind_id" text NOT NULL,
	"evidence_digest_sha256" text NOT NULL,
	"commit_token" text NOT NULL,
	"commit_digest_sha256" text NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_provider_receipt_observations_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_provider_receipt_observations_commit_unique" UNIQUE("tenant_id","commit_token"),
	CONSTRAINT "inbox_v2_provider_receipt_observations_target_check" CHECK (("inbox_v2_provider_receipt_observations"."target_kind" = 'exact_message'
          and num_nonnulls(
            "inbox_v2_provider_receipt_observations"."target_message_id",
            "inbox_v2_provider_receipt_observations"."target_external_message_reference_id",
            "inbox_v2_provider_receipt_observations"."target_source_occurrence_id"
          ) = 3
          and num_nonnulls(
            "inbox_v2_provider_receipt_observations"."provider_watermark_digest_sha256",
            "inbox_v2_provider_receipt_observations"."read_through_provider_time"
          ) = 0)
        or ("inbox_v2_provider_receipt_observations"."target_kind" = 'provider_watermark'
          and "inbox_v2_provider_receipt_observations"."provider_watermark_digest_sha256" ~ '^[a-f0-9]{64}$'
          and num_nonnulls(
            "inbox_v2_provider_receipt_observations"."target_message_id",
            "inbox_v2_provider_receipt_observations"."target_external_message_reference_id",
            "inbox_v2_provider_receipt_observations"."target_source_occurrence_id", "inbox_v2_provider_receipt_observations"."read_through_provider_time"
          ) = 0)
        or ("inbox_v2_provider_receipt_observations"."target_kind" = 'thread_readmark'
          and "inbox_v2_provider_receipt_observations"."read_through_provider_time" is not null
          and num_nonnulls(
            "inbox_v2_provider_receipt_observations"."target_message_id",
            "inbox_v2_provider_receipt_observations"."target_external_message_reference_id",
            "inbox_v2_provider_receipt_observations"."target_source_occurrence_id",
            "inbox_v2_provider_receipt_observations"."provider_watermark_digest_sha256"
          ) = 0)),
	CONSTRAINT "inbox_v2_provider_receipt_observations_reader_check" CHECK (("inbox_v2_provider_receipt_observations"."reader_kind" = 'source_external_identity'
          and "inbox_v2_provider_receipt_observations"."reader_source_external_identity_id" is not null
          and "inbox_v2_provider_receipt_observations"."reader_aggregate_key_digest_sha256" is null)
        or ("inbox_v2_provider_receipt_observations"."reader_kind" = 'aggregate_only'
          and "inbox_v2_provider_receipt_observations"."reader_source_external_identity_id" is null
          and "inbox_v2_provider_receipt_observations"."reader_aggregate_key_digest_sha256" ~ '^[a-f0-9]{64}$')),
	CONSTRAINT "inbox_v2_provider_receipt_observations_clock_check" CHECK (coalesce((char_length("inbox_v2_provider_receipt_observations"."id") <= 256
    and "inbox_v2_provider_receipt_observations"."id" ~ '^provider_receipt_observation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and (
          ("inbox_v2_provider_receipt_observations"."provider_watermark_digest_sha256" is null
            and "inbox_v2_provider_receipt_observations"."reader_aggregate_key_digest_sha256" is null
            and num_nonnulls(
              "inbox_v2_provider_receipt_observations"."opaque_payload_id", "inbox_v2_provider_receipt_observations"."opaque_data_class_id"
            ) = 0)
          or ((
              "inbox_v2_provider_receipt_observations"."provider_watermark_digest_sha256" is not null
              or "inbox_v2_provider_receipt_observations"."reader_aggregate_key_digest_sha256" is not null
            )
            and coalesce((char_length("inbox_v2_provider_receipt_observations"."opaque_payload_id") <= 256
    and "inbox_v2_provider_receipt_observations"."opaque_payload_id" ~ '^provider_receipt_opaque_payload:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
            and "inbox_v2_provider_receipt_observations"."opaque_data_class_id" =
              'core:source_occurrence_and_external_reference')
        )
        and "inbox_v2_provider_receipt_observations"."binding_generation" >= 1
        and "inbox_v2_provider_receipt_observations"."adapter_declaration_revision" >= 1
        and "inbox_v2_provider_receipt_observations"."capability_revision" >= 1
        and "inbox_v2_provider_receipt_observations"."recorded_stream_position" >= 1 and "inbox_v2_provider_receipt_observations"."revision" = 1
        and "inbox_v2_provider_receipt_observations"."semantic_proof_digest_sha256" ~ '^[a-f0-9]{64}$'
        and "inbox_v2_provider_receipt_observations"."evidence_digest_sha256" ~ '^[a-f0-9]{64}$'
        and char_length("inbox_v2_provider_receipt_observations"."commit_token") between 1 and 512
        and "inbox_v2_provider_receipt_observations"."commit_digest_sha256" ~ '^[a-f0-9]{64}$'
        and jsonb_typeof("inbox_v2_provider_receipt_observations"."semantic_proof_detail") = 'object'
        and pg_column_size("inbox_v2_provider_receipt_observations"."semantic_proof_detail") <= 65536
        and isfinite("inbox_v2_provider_receipt_observations"."adapter_loaded_at")
        and isfinite("inbox_v2_provider_receipt_observations"."observed_at") and isfinite("inbox_v2_provider_receipt_observations"."recorded_at")
        and ("inbox_v2_provider_receipt_observations"."read_through_provider_time" is null
          or isfinite("inbox_v2_provider_receipt_observations"."read_through_provider_time"))
        and "inbox_v2_provider_receipt_observations"."adapter_loaded_at" <= "inbox_v2_provider_receipt_observations"."recorded_at"
        and "inbox_v2_provider_receipt_observations"."observed_at" <= "inbox_v2_provider_receipt_observations"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_provider_receipt_opaque_payloads" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"receipt_observation_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"provider_watermark" text,
	"reader_aggregate_key" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_provider_receipt_opaque_payloads_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_provider_receipt_opaque_payloads_receipt_unique" UNIQUE("tenant_id","receipt_observation_id"),
	CONSTRAINT "inbox_v2_provider_receipt_opaque_payloads_shape_check" CHECK (coalesce((char_length("inbox_v2_provider_receipt_opaque_payloads"."id") <= 256
    and "inbox_v2_provider_receipt_opaque_payloads"."id" ~ '^provider_receipt_opaque_payload:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_provider_receipt_opaque_payloads"."data_class_id" = 'core:source_occurrence_and_external_reference'
        and num_nonnulls(
          "inbox_v2_provider_receipt_opaque_payloads"."provider_watermark", "inbox_v2_provider_receipt_opaque_payloads"."reader_aggregate_key"
        ) between 1 and 2
        and ("inbox_v2_provider_receipt_opaque_payloads"."provider_watermark" is null
          or char_length("inbox_v2_provider_receipt_opaque_payloads"."provider_watermark") between 1 and 4096)
        and ("inbox_v2_provider_receipt_opaque_payloads"."reader_aggregate_key" is null
          or char_length("inbox_v2_provider_receipt_opaque_payloads"."reader_aggregate_key") between 1 and 4096)
        and isfinite("inbox_v2_provider_receipt_opaque_payloads"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_staff_note_revisions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"staff_note_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"expected_previous_revision" bigint,
	"staff_note_revision" bigint NOT NULL,
	"change_kind" "inbox_v2_staff_note_revision_change" NOT NULL,
	"before_content_id" text,
	"before_content_revision" bigint,
	"before_content_state" "inbox_v2_timeline_content_state",
	"after_content_id" text NOT NULL,
	"after_content_revision" bigint NOT NULL,
	"after_content_state" "inbox_v2_timeline_content_state" NOT NULL,
	"action_attribution_id" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_staff_note_revisions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_staff_note_revisions_note_revision_unique" UNIQUE("tenant_id","staff_note_id","staff_note_revision"),
	CONSTRAINT "inbox_v2_staff_note_revisions_attribution_unique" UNIQUE("tenant_id","action_attribution_id"),
	CONSTRAINT "inbox_v2_staff_note_revisions_chain_check" CHECK (("inbox_v2_staff_note_revisions"."change_kind" = 'created'
          and "inbox_v2_staff_note_revisions"."staff_note_revision" = 1
          and "inbox_v2_staff_note_revisions"."expected_previous_revision" is null
          and num_nonnulls(
            "inbox_v2_staff_note_revisions"."before_content_id", "inbox_v2_staff_note_revisions"."before_content_revision",
            "inbox_v2_staff_note_revisions"."before_content_state"
          ) = 0)
        or ("inbox_v2_staff_note_revisions"."change_kind" <> 'created'
          and "inbox_v2_staff_note_revisions"."expected_previous_revision" is not null
          and "inbox_v2_staff_note_revisions"."staff_note_revision" = "inbox_v2_staff_note_revisions"."expected_previous_revision" + 1
          and num_nonnulls(
            "inbox_v2_staff_note_revisions"."before_content_id", "inbox_v2_staff_note_revisions"."before_content_revision",
            "inbox_v2_staff_note_revisions"."before_content_state"
          ) = 3)),
	CONSTRAINT "inbox_v2_staff_note_revisions_content_check" CHECK ("inbox_v2_staff_note_revisions"."after_content_revision" = "inbox_v2_staff_note_revisions"."staff_note_revision"),
	CONSTRAINT "inbox_v2_staff_note_revisions_clock_check" CHECK (coalesce((char_length("inbox_v2_staff_note_revisions"."id") <= 256
    and "inbox_v2_staff_note_revisions"."id" ~ '^staff_note_revision:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_staff_note_revisions"."recorded_stream_position" >= 1
        and "inbox_v2_staff_note_revisions"."record_revision" = 1
        and isfinite("inbox_v2_staff_note_revisions"."occurred_at") and isfinite("inbox_v2_staff_note_revisions"."recorded_at")
        and "inbox_v2_staff_note_revisions"."recorded_at" >= "inbox_v2_staff_note_revisions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_staff_notes" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"conversation_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"author_participant_id" text NOT NULL,
	"creation_attribution_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"content_state" "inbox_v2_timeline_content_state" NOT NULL,
	"revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_staff_notes_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_staff_notes_timeline_unique" UNIQUE("tenant_id","timeline_item_id"),
	CONSTRAINT "inbox_v2_staff_notes_content_unique" UNIQUE("tenant_id","content_id"),
	CONSTRAINT "inbox_v2_staff_notes_target_unique" UNIQUE("tenant_id","id","conversation_id","timeline_item_id"),
	CONSTRAINT "inbox_v2_staff_notes_revision_unique" UNIQUE("tenant_id","id","timeline_item_id","revision"),
	CONSTRAINT "inbox_v2_staff_notes_clock_check" CHECK (coalesce((char_length("inbox_v2_staff_notes"."id") <= 256
    and "inbox_v2_staff_notes"."id" ~ '^staff_note:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_staff_notes"."revision" >= 1
        and "inbox_v2_staff_notes"."content_revision" = "inbox_v2_staff_notes"."revision"
        and "inbox_v2_staff_notes"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_staff_notes"."created_at") and isfinite("inbox_v2_staff_notes"."updated_at")
        and "inbox_v2_staff_notes"."updated_at" >= "inbox_v2_staff_notes"."created_at"
        and ("inbox_v2_staff_notes"."revision" <> 1 or (
          "inbox_v2_staff_notes"."content_state" = 'available'
          and "inbox_v2_staff_notes"."created_at" = "inbox_v2_staff_notes"."updated_at"
        )))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_timeline_content_contact_values" (
	"tenant_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"block_ordinal" smallint NOT NULL,
	"value_ordinal" smallint NOT NULL,
	"kind" text NOT NULL,
	"value" text NOT NULL,
	"label" text,
	CONSTRAINT "inbox_v2_timeline_content_contact_values_pk" PRIMARY KEY("tenant_id","content_id","content_revision","block_ordinal","value_ordinal"),
	CONSTRAINT "inbox_v2_timeline_content_contact_values_shape_check" CHECK ("inbox_v2_timeline_content_contact_values"."kind" in ('phone', 'email', 'url', 'other')
        and "inbox_v2_timeline_content_contact_values"."value_ordinal" between 0 and 63
        and char_length("inbox_v2_timeline_content_contact_values"."value") between 1 and 2000)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_timeline_content_payloads" (
	"tenant_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"block_key" text NOT NULL,
	"kind" "inbox_v2_timeline_content_block_kind" NOT NULL,
	"text_role" text,
	"text_value" text,
	"language" text,
	"attachment_id" text,
	"attachment_state" "inbox_v2_attachment_materialization_state",
	"attachment_file_id" text,
	"attachment_failure_reason_id" text,
	"display_name" text,
	"media_semantic" text,
	"latitude" numeric(10, 7),
	"longitude" numeric(10, 7),
	"accuracy_meters" numeric(12, 3),
	"location_mode" text,
	"live_until" timestamp (3) with time zone,
	"heading_degrees" numeric(6, 3),
	"location_label" text,
	"location_address" text,
	"contact_display_name" text,
	"contact_organization" text,
	"unsupported_source_occurrence_id" text,
	"provider_content_kind_id" text,
	"safe_fallback_reason_id" text,
	"extension_block_kind_id" text,
	"extension_payload_schema_id" text,
	"extension_payload_schema_version" text,
	"extension_payload_file_id" text,
	"extension_payload_digest_sha256" text,
	"extension_renderer_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_timeline_content_payloads_pk" PRIMARY KEY("tenant_id","content_id","content_revision","ordinal"),
	CONSTRAINT "inbox_v2_timeline_content_payloads_block_key_unique" UNIQUE("tenant_id","content_id","content_revision","block_key"),
	CONSTRAINT "inbox_v2_timeline_content_payloads_ordinal_check" CHECK ("inbox_v2_timeline_content_payloads"."ordinal" between 0 and 63),
	CONSTRAINT "inbox_v2_timeline_content_payloads_text_bounds_check" CHECK (("inbox_v2_timeline_content_payloads"."text_value" is null or char_length("inbox_v2_timeline_content_payloads"."text_value") between 1 and 100000)
        and ("inbox_v2_timeline_content_payloads"."display_name" is null or char_length("inbox_v2_timeline_content_payloads"."display_name") between 1 and 512)
        and ("inbox_v2_timeline_content_payloads"."location_label" is null or char_length("inbox_v2_timeline_content_payloads"."location_label") between 1 and 512)
        and ("inbox_v2_timeline_content_payloads"."location_address" is null or char_length("inbox_v2_timeline_content_payloads"."location_address") between 1 and 2000)
        and ("inbox_v2_timeline_content_payloads"."contact_display_name" is null or char_length("inbox_v2_timeline_content_payloads"."contact_display_name") between 1 and 512)),
	CONSTRAINT "inbox_v2_timeline_content_payloads_shape_check" CHECK ((
          "inbox_v2_timeline_content_payloads"."kind" = 'text'
          and "inbox_v2_timeline_content_payloads"."text_role" in ('body', 'caption')
          and "inbox_v2_timeline_content_payloads"."text_value" is not null
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" in ('image', 'audio', 'video', 'file', 'sticker')
          and "inbox_v2_timeline_content_payloads"."attachment_id" is not null
          and "inbox_v2_timeline_content_payloads"."attachment_state" is not null
          and ("inbox_v2_timeline_content_payloads"."attachment_state" <> 'ready' or "inbox_v2_timeline_content_payloads"."attachment_file_id" is not null)
          and ("inbox_v2_timeline_content_payloads"."attachment_state" not in ('failed', 'quarantined')
            or "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id" is not null)
          and ("inbox_v2_timeline_content_payloads"."kind" <> 'audio' or "inbox_v2_timeline_content_payloads"."media_semantic" in ('audio', 'voice'))
          and ("inbox_v2_timeline_content_payloads"."kind" <> 'video' or "inbox_v2_timeline_content_payloads"."media_semantic" in ('video', 'video_note'))
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'location'
          and "inbox_v2_timeline_content_payloads"."latitude" between -90 and 90
          and "inbox_v2_timeline_content_payloads"."longitude" between -180 and 180
          and "inbox_v2_timeline_content_payloads"."location_mode" in ('static', 'live')
          and (("inbox_v2_timeline_content_payloads"."location_mode" = 'live') = ("inbox_v2_timeline_content_payloads"."live_until" is not null))
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'contact'
          and "inbox_v2_timeline_content_payloads"."contact_display_name" is not null
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'unsupported_source_content'
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id",
            "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id"
          ) = 3
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'extension'
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id", "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 6
          and "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256" ~ '^[a-f0-9]{64}$'
        )),
	CONSTRAINT "inbox_v2_timeline_content_payloads_created_check" CHECK (isfinite("inbox_v2_timeline_content_payloads"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_timeline_content_revisions" (
	"tenant_id" text NOT NULL,
	"content_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"expected_previous_revision" bigint,
	"transition_kind" "inbox_v2_timeline_content_transition_kind" NOT NULL,
	"state" "inbox_v2_timeline_content_state" NOT NULL,
	"event_id" text,
	"reason_id" text,
	"retention_policy_id" text,
	"retention_policy_version" text,
	"retention_policy_revision" bigint,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"recorded_stream_position" bigint NOT NULL,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_timeline_content_revisions_pk" PRIMARY KEY("tenant_id","content_id","revision"),
	CONSTRAINT "inbox_v2_timeline_content_revisions_chain_check" CHECK (("inbox_v2_timeline_content_revisions"."transition_kind" = 'created'
          and "inbox_v2_timeline_content_revisions"."revision" = 1
          and "inbox_v2_timeline_content_revisions"."expected_previous_revision" is null
          and "inbox_v2_timeline_content_revisions"."state" = 'available')
        or ("inbox_v2_timeline_content_revisions"."transition_kind" <> 'created'
          and "inbox_v2_timeline_content_revisions"."expected_previous_revision" is not null
          and "inbox_v2_timeline_content_revisions"."revision" = "inbox_v2_timeline_content_revisions"."expected_previous_revision" + 1)),
	CONSTRAINT "inbox_v2_timeline_content_revisions_time_check" CHECK ("inbox_v2_timeline_content_revisions"."recorded_stream_position" >= 1
        and "inbox_v2_timeline_content_revisions"."record_revision" = 1
        and isfinite("inbox_v2_timeline_content_revisions"."occurred_at")
        and isfinite("inbox_v2_timeline_content_revisions"."recorded_at")
        and "inbox_v2_timeline_content_revisions"."recorded_at" >= "inbox_v2_timeline_content_revisions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_timeline_contents" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"owner_kind" "inbox_v2_timeline_content_owner_kind" NOT NULL,
	"owner_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"processing_purpose_id" text NOT NULL,
	"retention_anchor_at" timestamp (3) with time zone NOT NULL,
	"state" "inbox_v2_timeline_content_state" NOT NULL,
	"content_digest_sha256" text,
	"tombstone_event_id" text,
	"tombstone_reason_id" text,
	"retention_policy_id" text,
	"retention_policy_version" text,
	"retention_policy_revision" bigint,
	"state_changed_at" timestamp (3) with time zone NOT NULL,
	"revision" bigint NOT NULL,
	"last_changed_stream_position" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_timeline_contents_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_timeline_contents_owner_unique" UNIQUE("tenant_id","owner_kind","owner_id"),
	CONSTRAINT "inbox_v2_timeline_contents_head_unique" UNIQUE("tenant_id","id","revision","state"),
	CONSTRAINT "inbox_v2_timeline_contents_class_check" CHECK (coalesce((char_length("inbox_v2_timeline_contents"."processing_purpose_id") <= 256 and (
    ("inbox_v2_timeline_contents"."processing_purpose_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_timeline_contents"."processing_purpose_id", ':', 2)) <= 160)
    or ("inbox_v2_timeline_contents"."processing_purpose_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_timeline_contents"."processing_purpose_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_timeline_contents"."processing_purpose_id", ':', 3)) <= 160
      and split_part("inbox_v2_timeline_contents"."processing_purpose_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and (("inbox_v2_timeline_contents"."owner_kind" = 'message'
          and "inbox_v2_timeline_contents"."data_class_id" = 'core:message_content_blocks')
        or ("inbox_v2_timeline_contents"."owner_kind" = 'staff_note'
          and "inbox_v2_timeline_contents"."data_class_id" = 'core:staff_note_content_blocks'))),
	CONSTRAINT "inbox_v2_timeline_contents_state_check" CHECK ((
          "inbox_v2_timeline_contents"."state" = 'available'
          and "inbox_v2_timeline_contents"."content_digest_sha256" ~ '^[a-f0-9]{64}$'
          and num_nonnulls(
            "inbox_v2_timeline_contents"."tombstone_event_id", "inbox_v2_timeline_contents"."tombstone_reason_id",
            "inbox_v2_timeline_contents"."retention_policy_id", "inbox_v2_timeline_contents"."retention_policy_version",
            "inbox_v2_timeline_contents"."retention_policy_revision"
          ) = 0
        ) or (
          "inbox_v2_timeline_contents"."state" = 'privacy_erased'
          and "inbox_v2_timeline_contents"."content_digest_sha256" is null
          and "inbox_v2_timeline_contents"."tombstone_event_id" is not null
          and "inbox_v2_timeline_contents"."tombstone_reason_id" is not null
          and num_nonnulls(
            "inbox_v2_timeline_contents"."retention_policy_id", "inbox_v2_timeline_contents"."retention_policy_version",
            "inbox_v2_timeline_contents"."retention_policy_revision"
          ) = 0
        ) or (
          "inbox_v2_timeline_contents"."state" = 'retention_purged'
          and "inbox_v2_timeline_contents"."content_digest_sha256" is null
          and "inbox_v2_timeline_contents"."tombstone_event_id" is not null
          and "inbox_v2_timeline_contents"."tombstone_reason_id" is null
          and num_nonnulls(
            "inbox_v2_timeline_contents"."retention_policy_id", "inbox_v2_timeline_contents"."retention_policy_version",
            "inbox_v2_timeline_contents"."retention_policy_revision"
          ) = 3
          and "inbox_v2_timeline_contents"."retention_policy_revision" >= 1
        )),
	CONSTRAINT "inbox_v2_timeline_contents_clock_check" CHECK (coalesce((char_length("inbox_v2_timeline_contents"."id") <= 256
    and "inbox_v2_timeline_contents"."id" ~ '^timeline_content:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_timeline_contents"."revision" >= 1
        and "inbox_v2_timeline_contents"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_timeline_contents"."retention_anchor_at")
        and isfinite("inbox_v2_timeline_contents"."state_changed_at")
        and isfinite("inbox_v2_timeline_contents"."created_at")
        and isfinite("inbox_v2_timeline_contents"."updated_at")
        and "inbox_v2_timeline_contents"."state_changed_at" <= "inbox_v2_timeline_contents"."updated_at"
        and "inbox_v2_timeline_contents"."updated_at" >= "inbox_v2_timeline_contents"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_timeline_subject_details" (
	"tenant_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"subject_kind" "inbox_v2_timeline_subject_kind" NOT NULL,
	"source_object_id" text,
	"source_object_kind_id" text,
	"source_object_revision" bigint,
	"normalized_source_event_id" text,
	"actor_participant_id" text,
	"module_item_kind_id" text,
	"participant_transition_id" text,
	"work_transition_kind" "inbox_v2_timeline_work_transition_kind",
	"work_item_transition_id" text,
	"work_item_relation_transition_id" text,
	"system_event_id" text,
	"system_actor_id" text,
	"system_app_actor_kind" "inbox_v2_app_actor_kind",
	"system_app_actor_employee_id" text,
	"system_app_authorization_epoch" text,
	"system_app_trusted_service_id" text,
	"record_revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_timeline_subject_details_pk" PRIMARY KEY("tenant_id","timeline_item_id"),
	CONSTRAINT "inbox_v2_timeline_subject_details_shape_check" CHECK (("inbox_v2_timeline_subject_details"."subject_kind" = 'call'
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision"
          ) = 3
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."module_item_kind_id", "inbox_v2_timeline_subject_details"."participant_transition_id",
            "inbox_v2_timeline_subject_details"."work_transition_kind", "inbox_v2_timeline_subject_details"."work_item_transition_id",
            "inbox_v2_timeline_subject_details"."work_item_relation_transition_id", "inbox_v2_timeline_subject_details"."system_event_id",
            "inbox_v2_timeline_subject_details"."system_actor_id", "inbox_v2_timeline_subject_details"."system_app_actor_kind",
            "inbox_v2_timeline_subject_details"."system_app_actor_employee_id",
            "inbox_v2_timeline_subject_details"."system_app_authorization_epoch",
            "inbox_v2_timeline_subject_details"."system_app_trusted_service_id"
          ) = 0)
        or ("inbox_v2_timeline_subject_details"."subject_kind" = 'review'
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision", "inbox_v2_timeline_subject_details"."actor_participant_id"
          ) = 4
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."module_item_kind_id", "inbox_v2_timeline_subject_details"."participant_transition_id",
            "inbox_v2_timeline_subject_details"."work_transition_kind", "inbox_v2_timeline_subject_details"."work_item_transition_id",
            "inbox_v2_timeline_subject_details"."work_item_relation_transition_id", "inbox_v2_timeline_subject_details"."system_event_id",
            "inbox_v2_timeline_subject_details"."system_actor_id", "inbox_v2_timeline_subject_details"."system_app_actor_kind",
            "inbox_v2_timeline_subject_details"."system_app_actor_employee_id",
            "inbox_v2_timeline_subject_details"."system_app_authorization_epoch",
            "inbox_v2_timeline_subject_details"."system_app_trusted_service_id"
          ) = 0)
        or ("inbox_v2_timeline_subject_details"."subject_kind" = 'module_event'
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision", "inbox_v2_timeline_subject_details"."module_item_kind_id"
          ) = 4
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."participant_transition_id", "inbox_v2_timeline_subject_details"."work_transition_kind",
            "inbox_v2_timeline_subject_details"."work_item_transition_id",
            "inbox_v2_timeline_subject_details"."work_item_relation_transition_id", "inbox_v2_timeline_subject_details"."system_event_id",
            "inbox_v2_timeline_subject_details"."system_actor_id", "inbox_v2_timeline_subject_details"."system_app_actor_kind",
            "inbox_v2_timeline_subject_details"."system_app_actor_employee_id",
            "inbox_v2_timeline_subject_details"."system_app_authorization_epoch",
            "inbox_v2_timeline_subject_details"."system_app_trusted_service_id"
          ) = 0)
        or ("inbox_v2_timeline_subject_details"."subject_kind" = 'participant_change'
          and "inbox_v2_timeline_subject_details"."participant_transition_id" is not null
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision", "inbox_v2_timeline_subject_details"."normalized_source_event_id",
            "inbox_v2_timeline_subject_details"."actor_participant_id", "inbox_v2_timeline_subject_details"."module_item_kind_id",
            "inbox_v2_timeline_subject_details"."work_transition_kind", "inbox_v2_timeline_subject_details"."work_item_transition_id",
            "inbox_v2_timeline_subject_details"."work_item_relation_transition_id", "inbox_v2_timeline_subject_details"."system_event_id",
            "inbox_v2_timeline_subject_details"."system_actor_id", "inbox_v2_timeline_subject_details"."system_app_actor_kind",
            "inbox_v2_timeline_subject_details"."system_app_actor_employee_id",
            "inbox_v2_timeline_subject_details"."system_app_authorization_epoch",
            "inbox_v2_timeline_subject_details"."system_app_trusted_service_id"
          ) = 0)
        or ("inbox_v2_timeline_subject_details"."subject_kind" = 'work_change'
          and "inbox_v2_timeline_subject_details"."work_transition_kind" is not null
          and (("inbox_v2_timeline_subject_details"."work_transition_kind" = 'work_item'
            and "inbox_v2_timeline_subject_details"."work_item_transition_id" is not null
            and "inbox_v2_timeline_subject_details"."work_item_relation_transition_id" is null)
          or ("inbox_v2_timeline_subject_details"."work_transition_kind" = 'work_item_relation'
            and "inbox_v2_timeline_subject_details"."work_item_transition_id" is null
            and "inbox_v2_timeline_subject_details"."work_item_relation_transition_id" is not null))
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision", "inbox_v2_timeline_subject_details"."normalized_source_event_id",
            "inbox_v2_timeline_subject_details"."actor_participant_id", "inbox_v2_timeline_subject_details"."module_item_kind_id",
            "inbox_v2_timeline_subject_details"."participant_transition_id", "inbox_v2_timeline_subject_details"."system_event_id",
            "inbox_v2_timeline_subject_details"."system_actor_id", "inbox_v2_timeline_subject_details"."system_app_actor_kind",
            "inbox_v2_timeline_subject_details"."system_app_actor_employee_id",
            "inbox_v2_timeline_subject_details"."system_app_authorization_epoch",
            "inbox_v2_timeline_subject_details"."system_app_trusted_service_id"
          ) = 0)
        or ("inbox_v2_timeline_subject_details"."subject_kind" = 'system_event'
          and "inbox_v2_timeline_subject_details"."system_event_id" is not null
          and "inbox_v2_timeline_subject_details"."system_actor_id" is not null
          and (
            "inbox_v2_timeline_subject_details"."system_app_actor_kind" is null
            or ("inbox_v2_timeline_subject_details"."system_app_actor_kind" = 'employee'
              and "inbox_v2_timeline_subject_details"."system_app_actor_employee_id" is not null
              and "inbox_v2_timeline_subject_details"."system_app_authorization_epoch" is not null
              and "inbox_v2_timeline_subject_details"."system_app_trusted_service_id" is null)
            or ("inbox_v2_timeline_subject_details"."system_app_actor_kind" = 'trusted_service'
              and "inbox_v2_timeline_subject_details"."system_app_actor_employee_id" is null
              and "inbox_v2_timeline_subject_details"."system_app_authorization_epoch" is null
              and "inbox_v2_timeline_subject_details"."system_app_trusted_service_id" is not null)
          )
          and num_nonnulls(
            "inbox_v2_timeline_subject_details"."source_object_id", "inbox_v2_timeline_subject_details"."source_object_kind_id",
            "inbox_v2_timeline_subject_details"."source_object_revision", "inbox_v2_timeline_subject_details"."normalized_source_event_id",
            "inbox_v2_timeline_subject_details"."actor_participant_id", "inbox_v2_timeline_subject_details"."module_item_kind_id",
            "inbox_v2_timeline_subject_details"."participant_transition_id", "inbox_v2_timeline_subject_details"."work_transition_kind",
            "inbox_v2_timeline_subject_details"."work_item_transition_id", "inbox_v2_timeline_subject_details"."work_item_relation_transition_id"
          ) = 0)),
	CONSTRAINT "inbox_v2_timeline_subject_details_clock_check" CHECK ("inbox_v2_timeline_subject_details"."record_revision" = 1
        and ("inbox_v2_timeline_subject_details"."source_object_revision" is null
          or "inbox_v2_timeline_subject_details"."source_object_revision" >= 1)
        and isfinite("inbox_v2_timeline_subject_details"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" DROP CONSTRAINT "inbox_v2_messages_foundation_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" DROP CONSTRAINT "inbox_v2_timeline_items_foundation_check";
--> statement-breakpoint
DROP INDEX "inbox_v2_messages_tenant_conversation_idx";
--> statement-breakpoint
DROP INDEX "inbox_v2_timeline_items_tenant_conversation_idx";
--> statement-breakpoint
DROP INDEX "inbox_v2_outbound_dispatches_tenant_message_idx";
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ALTER COLUMN "revision" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ALTER COLUMN "revision" DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "author_participant_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "origin_kind" "inbox_v2_message_origin_kind" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "origin_source_occurrence_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "origin_source_direction" "inbox_v2_message_source_direction";
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "claim_at_occurrence_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "claim_at_occurrence_version" bigint;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "claim_resolved_employee_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "origin_outbound_route_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "migration_provenance_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "creation_attribution_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "content_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "content_revision" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "content_state" "inbox_v2_timeline_content_state" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "reference_kind" "inbox_v2_message_reference_kind" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle" "inbox_v2_message_lifecycle" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle_revision_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle_reason_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle_provider_operation_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle_policy_reason_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "lifecycle_changed_at" timestamp (3) with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "last_changed_stream_position" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD COLUMN "updated_at" timestamp (3) with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "timeline_sequence" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "subject_kind" "inbox_v2_timeline_subject_kind" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "subject_id" text NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "visibility" "inbox_v2_timeline_visibility" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "activity_kind" "inbox_v2_timeline_activity_kind" NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "activity_source_occurrence_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "activity_reason_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "migration_provenance_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "activity_imported_at" timestamp (3) with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "occurred_at" timestamp (3) with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "received_at" timestamp (3) with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "last_changed_stream_position" bigint NOT NULL;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD COLUMN "updated_at" timestamp (3) with time zone NOT NULL;
--> statement-breakpoint
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "event_store" ADD CONSTRAINT "event_store_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_content_unique" UNIQUE("tenant_id","content_id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_revision_unique" UNIQUE("tenant_id","id","timeline_item_id","revision");
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_revision_unique" UNIQUE("tenant_id","id","conversation_id","revision");
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_subject_unique" UNIQUE("tenant_id","id","subject_kind");
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_sequence_unique" UNIQUE("tenant_id","conversation_id","timeline_sequence");
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_thread_bindings" ADD CONSTRAINT "inbox_v2_source_thread_bindings_owner_account_unique" UNIQUE("tenant_id","id","source_account_id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_semantic_ordering_heads" ADD CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_semantic_ordering_heads" ADD CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_reference_fk" FOREIGN KEY ("tenant_id","external_message_reference_id") REFERENCES "public"."inbox_v2_external_message_references"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_semantic_ordering_heads" ADD CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_semantic_ordering_heads" ADD CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id","source_account_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id","source_account_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_semantic_ordering_heads" ADD CONSTRAINT "inbox_v2_provider_semantic_ordering_heads_event_fk" FOREIGN KEY ("tenant_id","normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_participant_fk" FOREIGN KEY ("tenant_id","action_participant_id","conversation_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_employee_fk" FOREIGN KEY ("tenant_id","app_actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_initiator_fk" FOREIGN KEY ("tenant_id","automation_initiating_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" ADD CONSTRAINT "inbox_v2_action_attributions_cause_event_fk" FOREIGN KEY ("tenant_id","automation_cause_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD CONSTRAINT "inbox_v2_message_attachment_anchors_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_commit_fk" FOREIGN KEY ("tenant_id","commit_token") REFERENCES "public"."inbox_v2_message_transport_fact_commits"("tenant_id","commit_token") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_scope_occurrence_fk" FOREIGN KEY ("tenant_id","scope_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_evidence_event_fk" FOREIGN KEY ("tenant_id","evidence_normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_evidence_occurrence_fk" FOREIGN KEY ("tenant_id","evidence_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_recipient_fk" FOREIGN KEY ("tenant_id","scope_recipient_source_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_delivery_observations" ADD CONSTRAINT "inbox_v2_message_delivery_observations_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_actor_fk" FOREIGN KEY ("tenant_id","action_attribution_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_provider_lifecycle_initial_policy_event_fk" FOREIGN KEY ("tenant_id","initial_policy_decision_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_provider_lifecycle_semantic_event_fk" FOREIGN KEY ("tenant_id","provider_semantic_normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_provider_lifecycle_semantic_actor_fk" FOREIGN KEY ("tenant_id","provider_semantic_actor_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_operations" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_operations_policy_event_fk" FOREIGN KEY ("tenant_id","policy_decision_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_transitions" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_operation_fk" FOREIGN KEY ("tenant_id","operation_id") REFERENCES "public"."inbox_v2_message_provider_lifecycle_operations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_lifecycle_transitions" ADD CONSTRAINT "inbox_v2_message_provider_lifecycle_transitions_policy_event_fk" FOREIGN KEY ("tenant_id","policy_decision_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_reaction_observations" ADD CONSTRAINT "inbox_v2_message_provider_reaction_observations_transition_fk" FOREIGN KEY ("tenant_id","transition_id") REFERENCES "public"."inbox_v2_message_reaction_transitions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_reaction_observations" ADD CONSTRAINT "inbox_v2_message_provider_reaction_observations_event_fk" FOREIGN KEY ("tenant_id","normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_reaction_observations" ADD CONSTRAINT "inbox_v2_message_provider_reaction_observations_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_provider_reaction_observations" ADD CONSTRAINT "inbox_v2_message_provider_reaction_observations_actor_fk" FOREIGN KEY ("tenant_id","provider_actor_participant_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_slot_heads" ADD CONSTRAINT "inbox_v2_message_reaction_slot_heads_reaction_fk" FOREIGN KEY ("tenant_id","reaction_id","message_id","semantic_slot_key") REFERENCES "public"."inbox_v2_message_reactions"("tenant_id","id","message_id","semantic_slot_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_transitions" ADD CONSTRAINT "inbox_v2_message_reaction_transitions_reaction_fk" FOREIGN KEY ("tenant_id","reaction_id","semantic_slot_key") REFERENCES "public"."inbox_v2_message_reactions"("tenant_id","id","semantic_slot_key") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_transitions" ADD CONSTRAINT "inbox_v2_message_reaction_transitions_attribution_fk" FOREIGN KEY ("tenant_id","action_attribution_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_transitions" ADD CONSTRAINT "inbox_v2_message_reaction_transitions_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_transitions" ADD CONSTRAINT "inbox_v2_message_reaction_transitions_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reaction_transitions" ADD CONSTRAINT "inbox_v2_message_reaction_transitions_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reactions" ADD CONSTRAINT "inbox_v2_message_reactions_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reactions" ADD CONSTRAINT "inbox_v2_message_reactions_participant_fk" FOREIGN KEY ("tenant_id","actor_participant_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reactions" ADD CONSTRAINT "inbox_v2_message_reactions_occurrence_fk" FOREIGN KEY ("tenant_id","actor_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reactions" ADD CONSTRAINT "inbox_v2_message_reactions_attribution_fk" FOREIGN KEY ("tenant_id","request_attribution_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reactions" ADD CONSTRAINT "inbox_v2_message_reactions_tombstone_event_fk" FOREIGN KEY ("tenant_id","actor_identity_tombstone_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_canonical_targets" ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_context_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_message_reference_contexts"("tenant_id","message_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_canonical_targets" ADD CONSTRAINT "inbox_v2_message_reference_canonical_targets_target_fk" FOREIGN KEY ("tenant_id","target_message_id","target_timeline_item_id","target_message_revision") REFERENCES "public"."inbox_v2_messages"("tenant_id","id","timeline_item_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_contexts" ADD CONSTRAINT "inbox_v2_message_reference_contexts_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_contexts" ADD CONSTRAINT "inbox_v2_message_reference_contexts_origin_fk" FOREIGN KEY ("tenant_id","origin_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_external_targets" ADD CONSTRAINT "inbox_v2_message_reference_external_targets_context_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_message_reference_contexts"("tenant_id","message_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_external_targets" ADD CONSTRAINT "inbox_v2_message_reference_external_targets_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_unresolved_candidates" ADD CONSTRAINT "inbox_v2_message_reference_unresolved_candidates_target_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_message_reference_unresolved_targets"("tenant_id","message_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_unresolved_targets" ADD CONSTRAINT "inbox_v2_message_reference_unresolved_targets_context_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_message_reference_contexts"("tenant_id","message_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_reference_unresolved_targets" ADD CONSTRAINT "inbox_v2_message_reference_unresolved_targets_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_timeline_fk" FOREIGN KEY ("tenant_id","timeline_item_id") REFERENCES "public"."inbox_v2_timeline_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_attribution_fk" FOREIGN KEY ("tenant_id","action_attribution_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_before_content_fk" FOREIGN KEY ("tenant_id","before_content_id","before_content_revision") REFERENCES "public"."inbox_v2_timeline_content_revisions"("tenant_id","content_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_revisions" ADD CONSTRAINT "inbox_v2_message_revisions_after_content_fk" FOREIGN KEY ("tenant_id","after_content_id","after_content_revision") REFERENCES "public"."inbox_v2_timeline_content_revisions"("tenant_id","content_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_fact_commits" ADD CONSTRAINT "inbox_v2_message_transport_fact_commits_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_fact_commits" ADD CONSTRAINT "inbox_v2_message_transport_fact_commits_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_link_heads" ADD CONSTRAINT "inbox_v2_message_transport_link_heads_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_link_heads" ADD CONSTRAINT "inbox_v2_message_transport_link_heads_latest_fk" FOREIGN KEY ("tenant_id","latest_link_id","message_id") REFERENCES "public"."inbox_v2_message_transport_links"("tenant_id","id","message_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_links" ADD CONSTRAINT "inbox_v2_message_transport_links_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_transport_links" ADD CONSTRAINT "inbox_v2_message_transport_links_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbound_route_consumptions" ADD CONSTRAINT "inbox_v2_outbound_route_consumptions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbound_route_consumptions" ADD CONSTRAINT "inbox_v2_outbound_route_consumptions_message_fk" FOREIGN KEY ("tenant_id","message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_commit_fk" FOREIGN KEY ("tenant_id","commit_token") REFERENCES "public"."inbox_v2_message_transport_fact_commits"("tenant_id","commit_token") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_message_fk" FOREIGN KEY ("tenant_id","target_message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_occurrence_fk" FOREIGN KEY ("tenant_id","target_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_reader_fk" FOREIGN KEY ("tenant_id","reader_source_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_observations" ADD CONSTRAINT "inbox_v2_provider_receipt_observations_event_fk" FOREIGN KEY ("tenant_id","evidence_normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_provider_receipt_opaque_payloads" ADD CONSTRAINT "inbox_v2_provider_receipt_opaque_payloads_receipt_fk" FOREIGN KEY ("tenant_id","receipt_observation_id") REFERENCES "public"."inbox_v2_provider_receipt_observations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_note_revisions" ADD CONSTRAINT "inbox_v2_staff_note_revisions_note_fk" FOREIGN KEY ("tenant_id","staff_note_id") REFERENCES "public"."inbox_v2_staff_notes"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_note_revisions" ADD CONSTRAINT "inbox_v2_staff_note_revisions_timeline_fk" FOREIGN KEY ("tenant_id","timeline_item_id") REFERENCES "public"."inbox_v2_timeline_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_note_revisions" ADD CONSTRAINT "inbox_v2_staff_note_revisions_attribution_fk" FOREIGN KEY ("tenant_id","action_attribution_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_note_revisions" ADD CONSTRAINT "inbox_v2_staff_note_revisions_before_content_fk" FOREIGN KEY ("tenant_id","before_content_id","before_content_revision") REFERENCES "public"."inbox_v2_timeline_content_revisions"("tenant_id","content_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_note_revisions" ADD CONSTRAINT "inbox_v2_staff_note_revisions_after_content_fk" FOREIGN KEY ("tenant_id","after_content_id","after_content_revision") REFERENCES "public"."inbox_v2_timeline_content_revisions"("tenant_id","content_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_notes" ADD CONSTRAINT "inbox_v2_staff_notes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_notes" ADD CONSTRAINT "inbox_v2_staff_notes_timeline_fk" FOREIGN KEY ("tenant_id","timeline_item_id","conversation_id") REFERENCES "public"."inbox_v2_timeline_items"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_notes" ADD CONSTRAINT "inbox_v2_staff_notes_author_fk" FOREIGN KEY ("tenant_id","author_participant_id","conversation_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_notes" ADD CONSTRAINT "inbox_v2_staff_notes_attribution_fk" FOREIGN KEY ("tenant_id","creation_attribution_id","conversation_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_staff_notes" ADD CONSTRAINT "inbox_v2_staff_notes_content_fk" FOREIGN KEY ("tenant_id","content_id","content_revision","content_state") REFERENCES "public"."inbox_v2_timeline_contents"("tenant_id","id","revision","state") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_contact_values" ADD CONSTRAINT "inbox_v2_timeline_content_contact_values_payload_fk" FOREIGN KEY ("tenant_id","content_id","content_revision","block_ordinal") REFERENCES "public"."inbox_v2_timeline_content_payloads"("tenant_id","content_id","content_revision","ordinal") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_revision_fk" FOREIGN KEY ("tenant_id","content_id","content_revision") REFERENCES "public"."inbox_v2_timeline_content_revisions"("tenant_id","content_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_attachment_fk" FOREIGN KEY ("tenant_id","attachment_id") REFERENCES "public"."inbox_v2_message_attachment_anchors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_file_fk" FOREIGN KEY ("tenant_id","attachment_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_extension_file_fk" FOREIGN KEY ("tenant_id","extension_payload_file_id") REFERENCES "public"."files"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_occurrence_fk" FOREIGN KEY ("tenant_id","unsupported_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_revisions" ADD CONSTRAINT "inbox_v2_timeline_content_revisions_content_fk" FOREIGN KEY ("tenant_id","content_id") REFERENCES "public"."inbox_v2_timeline_contents"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_contents" ADD CONSTRAINT "inbox_v2_timeline_contents_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_contents" ADD CONSTRAINT "inbox_v2_timeline_contents_tombstone_event_fk" FOREIGN KEY ("tenant_id","tombstone_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_timeline_fk" FOREIGN KEY ("tenant_id","timeline_item_id","subject_kind") REFERENCES "public"."inbox_v2_timeline_items"("tenant_id","id","subject_kind") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_event_fk" FOREIGN KEY ("tenant_id","normalized_source_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_participant_fk" FOREIGN KEY ("tenant_id","actor_participant_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_membership_fk" FOREIGN KEY ("tenant_id","participant_transition_id") REFERENCES "public"."inbox_v2_participant_membership_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_work_item_fk" FOREIGN KEY ("tenant_id","work_item_transition_id") REFERENCES "public"."inbox_v2_work_item_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_work_relation_fk" FOREIGN KEY ("tenant_id","work_item_relation_transition_id") REFERENCES "public"."inbox_v2_work_item_relation_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_system_event_fk" FOREIGN KEY ("tenant_id","system_event_id") REFERENCES "public"."event_store"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_subject_details" ADD CONSTRAINT "inbox_v2_timeline_subject_details_employee_fk" FOREIGN KEY ("tenant_id","system_app_actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_semantic_ordering_heads_binding_idx" ON "inbox_v2_provider_semantic_ordering_heads" USING btree ("tenant_id","source_thread_binding_id","semantic_family_id","external_message_reference_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_semantic_ordering_heads_event_idx" ON "inbox_v2_provider_semantic_ordering_heads" USING btree ("tenant_id","normalized_inbound_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_action_attributions_conversation_created_idx" ON "inbox_v2_action_attributions" USING btree ("tenant_id","conversation_id","created_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_attachment_anchors_tenant_idx" ON "inbox_v2_message_attachment_anchors" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_delivery_observations_page_idx" ON "inbox_v2_message_delivery_observations" USING btree ("tenant_id","message_id","recorded_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_provider_lifecycle_operations_message_idx" ON "inbox_v2_message_provider_lifecycle_operations" USING btree ("tenant_id","message_id","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_lifecycle_semantic_consumer_idx" ON "inbox_v2_message_provider_lifecycle_operations" USING btree ("tenant_id","external_message_reference_id","provider_semantic_normalized_inbound_event_id","provider_semantic_ordering_position","provider_semantic_proof_token") WHERE "inbox_v2_message_provider_lifecycle_operations"."origin" = 'provider_observed';
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_provider_lifecycle_transitions_tenant_idx" ON "inbox_v2_message_provider_lifecycle_transitions" USING btree ("tenant_id","operation_id","resulting_revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_provider_reaction_observations_tenant_idx" ON "inbox_v2_message_provider_reaction_observations" USING btree ("tenant_id","transition_id","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_reaction_semantic_consumer_idx" ON "inbox_v2_message_provider_reaction_observations" USING btree ("tenant_id","normalized_inbound_event_id","ordering_position","transition_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reaction_slot_heads_tenant_idx" ON "inbox_v2_message_reaction_slot_heads" USING btree ("tenant_id","message_id","semantic_slot_key");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_message_reaction_transitions_predecessor_unique" ON "inbox_v2_message_reaction_transitions" USING btree ("tenant_id","reaction_id","expected_revision") WHERE "inbox_v2_message_reaction_transitions"."expected_revision" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reaction_transitions_snapshot_idx" ON "inbox_v2_message_reaction_transitions" USING btree ("tenant_id","reaction_id","recorded_stream_position","resulting_revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reactions_message_idx" ON "inbox_v2_message_reactions" USING btree ("tenant_id","message_id","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reference_canonical_targets_tenant_idx" ON "inbox_v2_message_reference_canonical_targets" USING btree ("tenant_id","message_id","ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reference_contexts_tenant_idx" ON "inbox_v2_message_reference_contexts" USING btree ("tenant_id","message_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reference_external_targets_tenant_idx" ON "inbox_v2_message_reference_external_targets" USING btree ("tenant_id","message_id","ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reference_unresolved_candidates_tenant_idx" ON "inbox_v2_message_reference_unresolved_candidates" USING btree ("tenant_id","message_id","ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_reference_unresolved_targets_tenant_idx" ON "inbox_v2_message_reference_unresolved_targets" USING btree ("tenant_id","message_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_message_revisions_predecessor_unique" ON "inbox_v2_message_revisions" USING btree ("tenant_id","message_id","expected_previous_revision") WHERE "inbox_v2_message_revisions"."expected_previous_revision" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_revisions_page_idx" ON "inbox_v2_message_revisions" USING btree ("tenant_id","message_id","message_revision","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_transport_fact_commits_message_page_idx" ON "inbox_v2_message_transport_fact_commits" USING btree ("tenant_id","message_id","recorded_at","fact_kind","observation_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_transport_link_heads_tenant_idx" ON "inbox_v2_message_transport_link_heads" USING btree ("tenant_id","message_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_message_transport_links_message_idx" ON "inbox_v2_message_transport_links" USING btree ("tenant_id","message_id","linked_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbound_route_consumptions_tenant_idx" ON "inbox_v2_outbound_route_consumptions" USING btree ("tenant_id","message_id","consumer_kind","consumer_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_receipt_observations_page_idx" ON "inbox_v2_provider_receipt_observations" USING btree ("tenant_id","source_thread_binding_id","recorded_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_provider_receipt_opaque_payloads_tenant_idx" ON "inbox_v2_provider_receipt_opaque_payloads" USING btree ("tenant_id","receipt_observation_id","id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_staff_note_revisions_predecessor_unique" ON "inbox_v2_staff_note_revisions" USING btree ("tenant_id","staff_note_id","expected_previous_revision") WHERE "inbox_v2_staff_note_revisions"."expected_previous_revision" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_staff_note_revisions_page_idx" ON "inbox_v2_staff_note_revisions" USING btree ("tenant_id","staff_note_id","staff_note_revision","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_staff_notes_conversation_idx" ON "inbox_v2_staff_notes" USING btree ("tenant_id","conversation_id","timeline_item_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_content_contact_values_tenant_idx" ON "inbox_v2_timeline_content_contact_values" USING btree ("tenant_id","content_id","content_revision","block_ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_content_payloads_attachment_idx" ON "inbox_v2_timeline_content_payloads" USING btree ("tenant_id","attachment_id","content_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_timeline_content_revisions_predecessor_unique" ON "inbox_v2_timeline_content_revisions" USING btree ("tenant_id","content_id","expected_previous_revision") WHERE "inbox_v2_timeline_content_revisions"."expected_previous_revision" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_content_revisions_time_idx" ON "inbox_v2_timeline_content_revisions" USING btree ("tenant_id","content_id","recorded_at","revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_contents_retention_idx" ON "inbox_v2_timeline_contents" USING btree ("tenant_id","data_class_id","state","retention_anchor_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_subject_details_tenant_idx" ON "inbox_v2_timeline_subject_details" USING btree ("tenant_id","timeline_item_id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_author_fk" FOREIGN KEY ("tenant_id","author_participant_id","conversation_id") REFERENCES "public"."inbox_v2_conversation_participants"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_origin_occurrence_fk" FOREIGN KEY ("tenant_id","origin_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_claim_fk" FOREIGN KEY ("tenant_id","claim_at_occurrence_id") REFERENCES "public"."inbox_v2_source_identity_claims"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_claim_employee_fk" FOREIGN KEY ("tenant_id","claim_resolved_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_attribution_fk" FOREIGN KEY ("tenant_id","creation_attribution_id","conversation_id") REFERENCES "public"."inbox_v2_action_attributions"("tenant_id","id","conversation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_content_fk" FOREIGN KEY ("tenant_id","content_id","content_revision","content_state") REFERENCES "public"."inbox_v2_timeline_contents"("tenant_id","id","revision","state") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_activity_occurrence_fk" FOREIGN KEY ("tenant_id","activity_source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_messages_conversation_idx" ON "inbox_v2_messages" USING btree ("tenant_id","conversation_id","timeline_item_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_messages_stream_idx" ON "inbox_v2_messages" USING btree ("tenant_id","last_changed_stream_position","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_items_conversation_sequence_idx" ON "inbox_v2_timeline_items" USING btree ("tenant_id","conversation_id","timeline_sequence" DESC NULLS LAST);
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_items_stream_idx" ON "inbox_v2_timeline_items" USING btree ("tenant_id","last_changed_stream_position","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbound_dispatches_tenant_message_idx" ON "inbox_v2_outbound_dispatches" USING btree ("tenant_id","message_id","created_at","id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_origin_check" CHECK ((
          "inbox_v2_messages"."origin_kind" = 'source_originated'
          and "inbox_v2_messages"."origin_source_occurrence_id" is not null
          and "inbox_v2_messages"."origin_source_direction" is not null
          and "inbox_v2_messages"."origin_outbound_route_id" is null
          and "inbox_v2_messages"."migration_provenance_id" is null
          and (
            num_nonnulls(
              "inbox_v2_messages"."claim_at_occurrence_id", "inbox_v2_messages"."claim_at_occurrence_version",
              "inbox_v2_messages"."claim_resolved_employee_id"
            ) = 0
            or num_nonnulls(
              "inbox_v2_messages"."claim_at_occurrence_id", "inbox_v2_messages"."claim_at_occurrence_version",
              "inbox_v2_messages"."claim_resolved_employee_id"
            ) = 3
          )
        ) or (
          "inbox_v2_messages"."origin_kind" = 'hulee_external'
          and "inbox_v2_messages"."origin_outbound_route_id" is not null
          and num_nonnulls(
            "inbox_v2_messages"."origin_source_occurrence_id", "inbox_v2_messages"."origin_source_direction",
            "inbox_v2_messages"."claim_at_occurrence_id", "inbox_v2_messages"."claim_at_occurrence_version",
            "inbox_v2_messages"."claim_resolved_employee_id", "inbox_v2_messages"."migration_provenance_id"
          ) = 0
        ) or (
          "inbox_v2_messages"."origin_kind" = 'internal'
          and num_nonnulls(
            "inbox_v2_messages"."origin_source_occurrence_id", "inbox_v2_messages"."origin_source_direction",
            "inbox_v2_messages"."claim_at_occurrence_id", "inbox_v2_messages"."claim_at_occurrence_version",
            "inbox_v2_messages"."claim_resolved_employee_id", "inbox_v2_messages"."origin_outbound_route_id",
            "inbox_v2_messages"."migration_provenance_id"
          ) = 0
        ) or (
          "inbox_v2_messages"."origin_kind" = 'migration'
          and "inbox_v2_messages"."migration_provenance_id" is not null
          and num_nonnulls(
            "inbox_v2_messages"."origin_source_occurrence_id", "inbox_v2_messages"."origin_source_direction",
            "inbox_v2_messages"."claim_at_occurrence_id", "inbox_v2_messages"."claim_at_occurrence_version",
            "inbox_v2_messages"."claim_resolved_employee_id", "inbox_v2_messages"."origin_outbound_route_id"
          ) = 0
        ));
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_lifecycle_check" CHECK (("inbox_v2_messages"."lifecycle" = 'active'
          and num_nonnulls(
            "inbox_v2_messages"."lifecycle_revision_id", "inbox_v2_messages"."lifecycle_reason_id",
            "inbox_v2_messages"."lifecycle_provider_operation_id",
            "inbox_v2_messages"."lifecycle_policy_reason_id", "inbox_v2_messages"."lifecycle_changed_at"
          ) = 0)
        or ("inbox_v2_messages"."lifecycle" = 'local_delete_tombstone'
          and num_nonnulls(
            "inbox_v2_messages"."lifecycle_revision_id", "inbox_v2_messages"."lifecycle_reason_id",
            "inbox_v2_messages"."lifecycle_changed_at"
          ) = 3
          and num_nonnulls(
            "inbox_v2_messages"."lifecycle_provider_operation_id", "inbox_v2_messages"."lifecycle_policy_reason_id"
          ) = 0)
        or ("inbox_v2_messages"."lifecycle" = 'provider_delete_tombstone'
          and num_nonnulls(
            "inbox_v2_messages"."lifecycle_revision_id", "inbox_v2_messages"."lifecycle_provider_operation_id",
            "inbox_v2_messages"."lifecycle_policy_reason_id", "inbox_v2_messages"."lifecycle_changed_at"
          ) = 4
          and "inbox_v2_messages"."lifecycle_reason_id" is null));
--> statement-breakpoint
ALTER TABLE "inbox_v2_messages" ADD CONSTRAINT "inbox_v2_messages_clock_check" CHECK (coalesce((char_length("inbox_v2_messages"."id") <= 256
    and "inbox_v2_messages"."id" ~ '^message:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_messages"."revision" >= 1
        and "inbox_v2_messages"."content_revision" >= 1
        and "inbox_v2_messages"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_messages"."created_at")
        and isfinite("inbox_v2_messages"."updated_at")
        and "inbox_v2_messages"."updated_at" >= "inbox_v2_messages"."created_at"
        and ("inbox_v2_messages"."revision" <> 1 or (
          "inbox_v2_messages"."lifecycle" = 'active'
          and "inbox_v2_messages"."content_state" = 'available'
          and "inbox_v2_messages"."created_at" = "inbox_v2_messages"."updated_at"
        )));
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_activity_check" CHECK ((
          "inbox_v2_timeline_items"."activity_kind" = 'eligible'
          and num_nonnulls(
            "inbox_v2_timeline_items"."activity_source_occurrence_id", "inbox_v2_timeline_items"."activity_reason_id",
            "inbox_v2_timeline_items"."migration_provenance_id", "inbox_v2_timeline_items"."activity_imported_at"
          ) = 0
        ) or (
          "inbox_v2_timeline_items"."activity_kind" = 'history_import'
          and "inbox_v2_timeline_items"."activity_source_occurrence_id" is not null
          and "inbox_v2_timeline_items"."activity_imported_at" is not null
          and num_nonnulls("inbox_v2_timeline_items"."activity_reason_id", "inbox_v2_timeline_items"."migration_provenance_id") = 0
        ) or (
          "inbox_v2_timeline_items"."activity_kind" = 'migration'
          and "inbox_v2_timeline_items"."migration_provenance_id" is not null
          and "inbox_v2_timeline_items"."activity_imported_at" is not null
          and num_nonnulls("inbox_v2_timeline_items"."activity_source_occurrence_id", "inbox_v2_timeline_items"."activity_reason_id") = 0
        ) or (
          "inbox_v2_timeline_items"."activity_kind" = 'non_activity'
          and "inbox_v2_timeline_items"."activity_reason_id" is not null
          and num_nonnulls(
            "inbox_v2_timeline_items"."activity_source_occurrence_id", "inbox_v2_timeline_items"."migration_provenance_id",
            "inbox_v2_timeline_items"."activity_imported_at"
          ) = 0
        ));
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_visibility_check" CHECK (("inbox_v2_timeline_items"."subject_kind" = 'message'
          and "inbox_v2_timeline_items"."visibility" in ('conversation_external', 'internal_participants'))
        or ("inbox_v2_timeline_items"."subject_kind" = 'staff_note' and "inbox_v2_timeline_items"."visibility" = 'staff_only')
        or ("inbox_v2_timeline_items"."subject_kind" in ('participant_change', 'work_change', 'system_event')
          and "inbox_v2_timeline_items"."visibility" = 'workforce_metadata')
        or ("inbox_v2_timeline_items"."subject_kind" in ('call', 'review', 'module_event')
          and "inbox_v2_timeline_items"."visibility" = 'source_item_policy'));
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_items" ADD CONSTRAINT "inbox_v2_timeline_items_clock_check" CHECK (coalesce((char_length("inbox_v2_timeline_items"."id") <= 256
    and "inbox_v2_timeline_items"."id" ~ '^timeline_item:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_timeline_items"."timeline_sequence" >= 1
        and "inbox_v2_timeline_items"."revision" >= 1
        and "inbox_v2_timeline_items"."last_changed_stream_position" >= 1
        and isfinite("inbox_v2_timeline_items"."occurred_at")
        and isfinite("inbox_v2_timeline_items"."received_at")
        and isfinite("inbox_v2_timeline_items"."created_at")
        and isfinite("inbox_v2_timeline_items"."updated_at")
        and "inbox_v2_timeline_items"."occurred_at" <= "inbox_v2_timeline_items"."received_at"
        and "inbox_v2_timeline_items"."received_at" <= "inbox_v2_timeline_items"."created_at"
        and "inbox_v2_timeline_items"."created_at" <= "inbox_v2_timeline_items"."updated_at"
        and ("inbox_v2_timeline_items"."subject_kind" in ('message', 'staff_note') or "inbox_v2_timeline_items"."revision" = 1));
--> statement-breakpoint
alter table public.inbox_v2_messages
  alter constraint inbox_v2_messages_content_fk
  deferrable initially deferred;

alter table public.inbox_v2_staff_notes
  alter constraint inbox_v2_staff_notes_content_fk
  deferrable initially deferred;

drop trigger if exists inbox_v2_timeline_items_immutable_trigger
  on public.inbox_v2_timeline_items;
drop trigger if exists inbox_v2_messages_immutable_trigger
  on public.inbox_v2_messages;

create or replace function public.inbox_v2_tm_append_only_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  parent_exists boolean := true;
  parent_key text;
  parent_offset integer;
begin
  -- FK cascades invoke the child guard below their RI trigger (depth > 1).
  -- Direct application DELETE reaches this guard at depth 1 and stays blocked.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then
    return old;
  end if;

  if tg_op = 'DELETE' and not exists (
    select 1 from public.tenants tenant_row
     where tenant_row.id = old_row->>'tenant_id'
  ) then
    return old;
  end if;

  if tg_op = 'DELETE' and tg_nargs > 0 and tg_nargs % 3 = 0 then
    for parent_offset in 0..(tg_nargs / 3 - 1) loop
      parent_key := old_row->>tg_argv[parent_offset * 3 + 2];
      if parent_key is not null then
        execute format(
          'select exists (select 1 from %s where tenant_id = $1 and %I = $2)',
          tg_argv[parent_offset * 3]::regclass,
          tg_argv[parent_offset * 3 + 1]
        )
          into parent_exists
          using old_row->>'tenant_id', parent_key;

        if not parent_exists then
          return old;
        end if;
      end if;
    end loop;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.timeline_message_append_only:%s:%s',
      tg_table_name,
      tg_op
    );
end;
$function$;

create or replace function public.inbox_v2_tm_json_string_fields(
  document jsonb,
  field_names text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(document) = 'object'
    and not exists (
      select 1
        from unnest(field_names) as field_name
       where jsonb_typeof(document->field_name) is distinct from 'string'
    ),
    false
  );
$function$;

create or replace function public.inbox_v2_tm_json_exact_keys(
  document jsonb,
  allowed_keys text[],
  required_keys text[]
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    jsonb_typeof(document) = 'object'
    and pg_column_size(document) <= 65536
    and document ?& required_keys
    and document - allowed_keys = '{}'::jsonb,
    false
  );
$function$;

create or replace function public.inbox_v2_tm_json_family_valid(
  family text,
  document jsonb
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  kind text := document->>'kind';
begin
  if family = 'reference' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array['tenantId', 'kind', 'id'],
      array['tenantId', 'kind', 'id']
    ) and public.inbox_v2_tm_json_string_fields(
      document, array['tenantId', 'kind', 'id']
    );
  elsif family = 'adapter_contract' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ],
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ]
    ) and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'contractId', 'contractVersion', 'declarationRevision', 'surfaceId',
        'loadedByTrustedServiceId', 'loadedAt'
      ]
    );
  elsif family = 'provider_ordering' then
    if kind = 'monotonic_exact' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision'],
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision']
      ) and public.inbox_v2_tm_json_string_fields(
        document,
        array['kind', 'scopeToken', 'position', 'comparatorId', 'comparatorRevision']
      );
    elsif kind = 'incomparable' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'conflictToken'],
        array['kind', 'conflictToken']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'conflictToken']
      );
    elsif kind = 'unavailable' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'reasonId'],
        array['kind', 'reasonId']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'reasonId']
      );
    end if;
    return false;
  elsif family = 'provider_ordering_head' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'semanticFamilyId', 'externalMessageReference',
        'sourceAccount', 'sourceThreadBinding', 'bindingGeneration',
        'scopeToken', 'comparatorId', 'comparatorRevision', 'position',
        'normalizedInboundEvent', 'proofToken', 'revision', 'updatedAt'
      ],
      array[
        'tenantId', 'semanticFamilyId', 'externalMessageReference',
        'sourceAccount', 'sourceThreadBinding', 'bindingGeneration',
        'scopeToken', 'comparatorId', 'comparatorRevision', 'position',
        'normalizedInboundEvent', 'proofToken', 'revision', 'updatedAt'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'semanticFamilyId', 'bindingGeneration', 'scopeToken',
        'comparatorId', 'comparatorRevision', 'position', 'proofToken',
        'revision', 'updatedAt'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'externalMessageReference'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'normalizedInboundEvent'
    );
  elsif family = 'provider_semantic_proof' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'normalizedInboundEvent', 'externalMessageReference',
        'sourceOccurrence', 'sourceAccount', 'sourceThreadBinding',
        'bindingGeneration', 'adapterContract', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision', 'actor',
        'ordering', 'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ],
      array[
        'tenantId', 'normalizedInboundEvent', 'externalMessageReference',
        'sourceOccurrence', 'sourceAccount', 'sourceThreadBinding',
        'bindingGeneration', 'adapterContract', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision', 'actor',
        'ordering', 'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'bindingGeneration', 'capabilityId',
        'capabilityRevision', 'semanticId', 'semanticRevision',
        'declaredByTrustedServiceId', 'proofToken', 'occurredAt',
        'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'normalizedInboundEvent'
    )
    and (
      (document->'externalMessageReference' = 'null'::jsonb
        and document->'sourceOccurrence' = 'null'::jsonb)
      or (public.inbox_v2_tm_json_family_valid(
          'reference', document->'externalMessageReference'
        ) and public.inbox_v2_tm_json_family_valid(
          'reference', document->'sourceOccurrence'
        ))
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    )
    and (
      document->'actor' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid('reference', document->'actor')
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_ordering', document->'ordering'
    );
  elsif family = 'provider_ordering_commit' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array['tenantId', 'semanticFamilyId', 'before', 'proof', 'after', 'committedAt'],
      array['tenantId', 'semanticFamilyId', 'before', 'proof', 'after', 'committedAt']
    )
    and public.inbox_v2_tm_json_string_fields(
      document, array['tenantId', 'semanticFamilyId', 'committedAt']
    )
    and (
      document->'before' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'provider_ordering_head', document->'before'
      )
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_semantic_proof', document->'proof'
    )
    and public.inbox_v2_tm_json_family_valid(
      'provider_ordering_head', document->'after'
    );
  elsif family = 'provider_result_proof' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'tenantId', 'operation', 'outboundRoute', 'adapterContract',
        'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ],
      array[
        'tenantId', 'operation', 'outboundRoute', 'adapterContract',
        'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'tenantId', 'capabilityId', 'capabilityRevision', 'semanticId',
        'semanticRevision', 'resultState', 'declaredByTrustedServiceId',
        'resultToken', 'resultDigestSha256', 'recordedAt', 'revision'
      ]
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'operation'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'outboundRoute'
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    );
  elsif family = 'reaction_value' then
    if kind = 'unicode' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'value'], array['kind', 'value']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'value']
      );
    elsif kind = 'provider_custom' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'providerKindId', 'canonicalCode'],
        array['kind', 'providerKindId', 'canonicalCode']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'providerKindId', 'canonicalCode']
      );
    end if;
    return false;
  elsif family = 'reaction_capability' then
    if kind = 'internal' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'cardinality'], array['kind', 'cardinality']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'cardinality']
      );
    elsif kind = 'external' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'capabilityId', 'capabilityRevision', 'cardinality',
          'adapterContract'
        ],
        array[
          'kind', 'capabilityId', 'capabilityRevision', 'cardinality',
          'adapterContract'
        ]
      ) and public.inbox_v2_tm_json_string_fields(
        document,
        array['kind', 'capabilityId', 'capabilityRevision', 'cardinality']
      ) and public.inbox_v2_tm_json_family_valid(
        'adapter_contract', document->'adapterContract'
      );
    end if;
    return false;
  elsif family in ('reaction_canonical', 'reaction_desired') then
    if kind = 'active' then
      return public.inbox_v2_tm_json_exact_keys(
        document, array['kind', 'value'], array['kind', 'value']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind']
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_value', document->'value'
      );
    elsif kind = 'cleared' then
      if family = 'reaction_canonical' then
        return public.inbox_v2_tm_json_exact_keys(
          document,
          array['kind', 'lastValue', 'clearedAt'],
          array['kind', 'lastValue', 'clearedAt']
        ) and public.inbox_v2_tm_json_string_fields(
          document, array['kind', 'clearedAt']
        ) and public.inbox_v2_tm_json_family_valid(
          'reaction_value', document->'lastValue'
        );
      end if;
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'lastValue'],
        array['kind', 'lastValue']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind']
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_value', document->'lastValue'
      );
    end if;
    return false;
  elsif family = 'app_actor' then
    if kind = 'employee' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'employee', 'authorizationEpoch'],
        array['kind', 'employee', 'authorizationEpoch']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'authorizationEpoch']
      ) and public.inbox_v2_tm_json_family_valid(
        'reference', document->'employee'
      );
    elsif kind = 'trusted_service' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'trustedServiceId'],
        array['kind', 'trustedServiceId']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'trustedServiceId']
      );
    end if;
    return false;
  elsif family = 'automation_causation' then
    if kind = 'employee_command' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'initiatingActor', 'causeEvent', 'correlationId', 'causedAt'],
        array['kind', 'initiatingActor', 'causeEvent', 'correlationId', 'causedAt']
      )
      and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'correlationId', 'causedAt']
      )
      and public.inbox_v2_tm_json_family_valid(
        'app_actor', document->'initiatingActor'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'causeEvent'
      );
    elsif kind = 'system_event' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array['kind', 'causeEvent', 'correlationId', 'causedAt'],
        array['kind', 'causeEvent', 'correlationId', 'causedAt']
      ) and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'correlationId', 'causedAt']
      ) and public.inbox_v2_tm_json_family_valid(
        'reference', document->'causeEvent'
      );
    end if;
    return false;
  elsif family = 'reaction_attribution' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'actionParticipant', 'appActor', 'sourceOccurrence',
        'automationCausation'
      ],
      array[
        'actionParticipant', 'appActor', 'sourceOccurrence',
        'automationCausation'
      ]
    )
    and (
      document->'actionParticipant' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'actionParticipant'
      )
    )
    and (
      document->'appActor' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'app_actor', document->'appActor'
      )
    )
    and (
      document->'sourceOccurrence' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'sourceOccurrence'
      )
    )
    and (
      document->'automationCausation' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'automation_causation', document->'automationCausation'
      )
    );
  elsif family = 'reaction_state' then
    if kind in ('active', 'cleared') then
      return public.inbox_v2_tm_json_family_valid(
        'reaction_canonical', document
      );
    elsif kind = 'pending_external' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'operation', 'desired', 'confirmedBefore', 'outboundRoute',
          'requestTransition', 'requestAttribution', 'requestedAt'
        ],
        array[
          'kind', 'operation', 'desired', 'confirmedBefore', 'outboundRoute',
          'requestTransition', 'requestAttribution', 'requestedAt'
        ]
      )
      and public.inbox_v2_tm_json_string_fields(
        document, array['kind', 'operation', 'requestedAt']
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_desired', document->'desired'
      )
      and (
        document->'confirmedBefore' = 'null'::jsonb
        or public.inbox_v2_tm_json_family_valid(
          'reaction_canonical', document->'confirmedBefore'
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'requestTransition'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_attribution', document->'requestAttribution'
      );
    elsif kind = 'external_terminal' then
      return public.inbox_v2_tm_json_exact_keys(
        document,
        array[
          'kind', 'operation', 'desired', 'confirmedState', 'outboundRoute',
          'requestTransition', 'outcome', 'resultToken', 'resultDigestSha256',
          'resolvedAt'
        ],
        array[
          'kind', 'operation', 'desired', 'confirmedState', 'outboundRoute',
          'requestTransition', 'outcome', 'resultToken', 'resultDigestSha256',
          'resolvedAt'
        ]
      )
      and public.inbox_v2_tm_json_string_fields(
        document,
        array[
          'kind', 'operation', 'outcome', 'resultToken',
          'resultDigestSha256', 'resolvedAt'
        ]
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_desired', document->'desired'
      )
      and (
        document->'confirmedState' = 'null'::jsonb
        or public.inbox_v2_tm_json_family_valid(
          'reaction_canonical', document->'confirmedState'
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
      and public.inbox_v2_tm_json_family_valid(
        'reference', document->'requestTransition'
      );
    end if;
    return false;
  elsif family = 'reaction_fence' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'capabilityId', 'capabilityRevision', 'adapterContract', 'decision',
        'evaluatedAt', 'notAfter'
      ],
      array[
        'capabilityId', 'capabilityRevision', 'adapterContract', 'decision',
        'evaluatedAt', 'notAfter'
      ]
    ) and public.inbox_v2_tm_json_string_fields(
      document,
      array[
        'capabilityId', 'capabilityRevision', 'decision',
        'evaluatedAt', 'notAfter'
      ]
    ) and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    );
  elsif family = 'reaction_authority' then
    return public.inbox_v2_tm_json_exact_keys(
      document,
      array[
        'externalMessageReference', 'sourceOccurrence', 'sourceAccount',
        'sourceThreadBinding', 'bindingGeneration', 'outboundRoute',
        'adapterContract', 'capabilityFence'
      ],
      array[
        'externalMessageReference', 'sourceOccurrence', 'sourceAccount',
        'sourceThreadBinding', 'bindingGeneration', 'outboundRoute',
        'adapterContract', 'capabilityFence'
      ]
    )
    and public.inbox_v2_tm_json_string_fields(
      document, array['bindingGeneration']
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'externalMessageReference'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceOccurrence'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceAccount'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reference', document->'sourceThreadBinding'
    )
    and (
      document->'outboundRoute' = 'null'::jsonb
      or public.inbox_v2_tm_json_family_valid(
        'reference', document->'outboundRoute'
      )
    )
    and public.inbox_v2_tm_json_family_valid(
      'adapter_contract', document->'adapterContract'
    )
    and public.inbox_v2_tm_json_family_valid(
      'reaction_fence', document->'capabilityFence'
    );
  end if;

  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_value_flat_valid(
  state_detail jsonb,
  expected_state_kind text,
  expected_value_kind text,
  expected_unicode_value text,
  expected_provider_reaction_kind_id text,
  expected_provider_canonical_code text
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  desired_detail jsonb;
  value_detail jsonb;
begin
  if state_detail #>> '{kind}' is distinct from expected_state_kind then
    return false;
  end if;

  desired_detail := case expected_state_kind
    when 'active' then state_detail
    when 'cleared' then state_detail
    when 'pending_external' then state_detail -> 'desired'
    when 'external_terminal' then state_detail -> 'desired'
    else null
  end;
  if desired_detail is null then
    return false;
  end if;

  value_detail := case desired_detail #>> '{kind}'
    when 'active' then desired_detail -> 'value'
    when 'cleared' then desired_detail -> 'lastValue'
    else null
  end;
  if value_detail is null
     or value_detail #>> '{kind}' is distinct from expected_value_kind then
    return false;
  end if;

  if expected_value_kind = 'unicode' then
    return value_detail #>> '{value}' is not distinct from
        expected_unicode_value
      and expected_provider_reaction_kind_id is null
      and expected_provider_canonical_code is null;
  end if;
  if expected_value_kind = 'provider_custom' then
    return expected_unicode_value is null
      and value_detail #>> '{providerKindId}' is not distinct from
        expected_provider_reaction_kind_id
      and value_detail #>> '{canonicalCode}' is not distinct from
        expected_provider_canonical_code;
  end if;
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_transition_state_valid(
  before_state_detail jsonb,
  after_state_detail jsonb,
  transition_mode text,
  transition_operation text,
  transition_recorded_at timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  before_kind text := before_state_detail #>> '{kind}';
  after_kind text := after_state_detail #>> '{kind}';
  before_confirmed jsonb;
  after_desired jsonb;
  confirming_request boolean;
begin
  before_confirmed := case
    when before_state_detail is null then 'null'::jsonb
    when before_kind = 'pending_external' then
      before_state_detail -> 'confirmedBefore'
    when before_kind = 'external_terminal' then
      before_state_detail -> 'confirmedState'
    else before_state_detail
  end;

  after_desired := case
    when after_kind = 'active' then jsonb_build_object(
      'kind', 'active', 'value', after_state_detail -> 'value'
    )
    when after_kind = 'cleared' then jsonb_build_object(
      'kind', 'cleared', 'lastValue', after_state_detail -> 'lastValue'
    )
    when after_kind in ('pending_external', 'external_terminal') then
      after_state_detail -> 'desired'
    else null
  end;
  if after_desired is null then
    return false;
  end if;

  if transition_mode = 'provider_result' then
    return coalesce(before_kind = 'pending_external'
      and after_kind = 'external_terminal'
      and before_state_detail #>> '{operation}' = transition_operation
      and after_state_detail #>> '{operation}' = transition_operation
      and after_state_detail -> 'desired' =
        before_state_detail -> 'desired'
      and after_state_detail -> 'confirmedState' =
        before_state_detail -> 'confirmedBefore'
      and after_state_detail -> 'outboundRoute' =
        before_state_detail -> 'outboundRoute'
      and after_state_detail -> 'requestTransition' =
        before_state_detail -> 'requestTransition'
      and (after_state_detail #>> '{resolvedAt}')::timestamptz =
        transition_recorded_at, false);
  end if;

  if transition_mode = 'external_request'
     and (
       after_kind <> 'pending_external'
       or after_state_detail -> 'confirmedBefore' is distinct from
         before_confirmed
     ) then
    return false;
  end if;

  confirming_request := transition_mode = 'provider_observed'
    and (
      before_kind = 'pending_external'
      or (
        before_kind = 'external_terminal'
        and before_state_detail #>> '{outcome}' = 'outcome_unknown'
      )
    );
  if confirming_request then
    return coalesce(
      before_state_detail #>> '{operation}' = transition_operation
        and before_state_detail -> 'desired' = after_desired,
      false
    );
  end if;

  if transition_operation = 'set' then
    return coalesce((
        before_confirmed = 'null'::jsonb
        or before_confirmed #>> '{kind}' = 'cleared'
      )
      and after_desired #>> '{kind}' = 'active', false);
  end if;
  if transition_operation = 'replace' then
    return coalesce(before_confirmed #>> '{kind}' = 'active'
      and after_desired #>> '{kind}' = 'active'
      and before_confirmed -> 'value' is distinct from
        after_desired -> 'value', false);
  end if;
  if transition_operation = 'clear' then
    return coalesce(before_confirmed #>> '{kind}' = 'active'
      and after_desired #>> '{kind}' = 'cleared'
      and before_confirmed -> 'value' = after_desired -> 'lastValue', false);
  end if;
  return false;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_reaction_attribution_row_valid(
  expected_tenant_id text,
  expected_attribution_id text,
  attribution_detail jsonb,
  expected_created_at timestamptz
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_action_attributions attribution_row
     where attribution_row.tenant_id = expected_tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.created_at = expected_created_at
       and (
         (
           attribution_detail -> 'actionParticipant' = 'null'::jsonb
           and attribution_row.action_participant_id is null
         )
         or (
           attribution_detail #>> '{actionParticipant,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{actionParticipant,kind}' =
             'conversation_participant'
           and attribution_detail #>> '{actionParticipant,id}' =
             attribution_row.action_participant_id
         )
       )
       and (
         (
           attribution_detail -> 'appActor' = 'null'::jsonb
           and num_nonnulls(
             attribution_row.app_actor_kind,
             attribution_row.app_actor_employee_id,
             attribution_row.app_authorization_epoch,
             attribution_row.app_trusted_service_id
           ) = 0
         )
         or (
           attribution_detail #>> '{appActor,kind}' = 'employee'
           and attribution_detail #>> '{appActor,employee,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{appActor,employee,kind}' = 'employee'
           and attribution_row.app_actor_kind = 'employee'
           and attribution_detail #>> '{appActor,employee,id}' =
             attribution_row.app_actor_employee_id
           and attribution_detail #>> '{appActor,authorizationEpoch}' =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_detail #>> '{appActor,kind}' = 'trusted_service'
           and attribution_row.app_actor_kind = 'trusted_service'
           and attribution_detail #>> '{appActor,trustedServiceId}' =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and (
         (
           attribution_detail -> 'sourceOccurrence' = 'null'::jsonb
           and attribution_row.source_occurrence_id is null
         )
         or (
           attribution_detail #>> '{sourceOccurrence,tenantId}' =
             expected_tenant_id
           and attribution_detail #>> '{sourceOccurrence,kind}' =
             'source_occurrence'
           and attribution_detail #>> '{sourceOccurrence,id}' =
             attribution_row.source_occurrence_id
         )
       )
       and (
         (
           attribution_detail -> 'automationCausation' = 'null'::jsonb
           and num_nonnulls(
             attribution_row.automation_kind,
             attribution_row.automation_cause_event_id,
             attribution_row.automation_correlation_id,
             attribution_row.automation_caused_at,
             attribution_row.automation_initiating_employee_id,
             attribution_row.automation_initiating_authorization_epoch
           ) = 0
         )
         or (
           attribution_detail #>> '{automationCausation,kind}' =
             'system_event'
           and attribution_row.automation_kind = 'system_event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,tenantId}' = expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,causeEvent,kind}' = 'event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,id}' =
               attribution_row.automation_cause_event_id
           and attribution_detail #>>
             '{automationCausation,correlationId}' =
               attribution_row.automation_correlation_id
           and (attribution_detail #>>
             '{automationCausation,causedAt}')::timestamptz =
               attribution_row.automation_caused_at
           and attribution_row.automation_initiating_employee_id is null
           and attribution_row.automation_initiating_authorization_epoch is null
         )
         or (
           attribution_detail #>> '{automationCausation,kind}' =
             'employee_command'
           and attribution_row.automation_kind = 'employee_command'
           and attribution_detail #>>
             '{automationCausation,causeEvent,tenantId}' = expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,causeEvent,kind}' = 'event'
           and attribution_detail #>>
             '{automationCausation,causeEvent,id}' =
               attribution_row.automation_cause_event_id
           and attribution_detail #>>
             '{automationCausation,correlationId}' =
               attribution_row.automation_correlation_id
           and (attribution_detail #>>
             '{automationCausation,causedAt}')::timestamptz =
               attribution_row.automation_caused_at
           and attribution_detail #>>
             '{automationCausation,initiatingActor,kind}' = 'employee'
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,tenantId}' =
               expected_tenant_id
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,kind}' = 'employee'
           and attribution_detail #>>
             '{automationCausation,initiatingActor,employee,id}' =
               attribution_row.automation_initiating_employee_id
           and attribution_detail #>>
             '{automationCausation,initiatingActor,authorizationEpoch}' =
               attribution_row.automation_initiating_authorization_epoch
         )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_reaction_authority_flat_valid(
  authority_detail jsonb,
  expected_tenant_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_outbound_route_id text,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_occurred_at timestamptz
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return
    authority_detail #>> '{externalMessageReference,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{externalMessageReference,kind}' =
      'external_message_reference'
    and authority_detail #>> '{externalMessageReference,id}' =
      expected_external_message_reference_id
    and authority_detail #>> '{sourceOccurrence,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
    and authority_detail #>> '{sourceOccurrence,id}' =
      expected_source_occurrence_id
    and authority_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and authority_detail #>> '{sourceAccount,kind}' = 'source_account'
    and authority_detail #>> '{sourceAccount,id}' = expected_source_account_id
    and authority_detail #>> '{sourceThreadBinding,tenantId}' =
      expected_tenant_id
    and authority_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and authority_detail #>> '{sourceThreadBinding,id}' =
      expected_source_thread_binding_id
    and authority_detail #>> '{bindingGeneration}' =
      expected_binding_generation::text
    and (
      (
        expected_outbound_route_id is null
        and authority_detail -> 'outboundRoute' = 'null'::jsonb
      )
      or (
        expected_outbound_route_id is not null
        and authority_detail #>> '{outboundRoute,tenantId}' =
          expected_tenant_id
        and authority_detail #>> '{outboundRoute,kind}' = 'outbound_route'
        and authority_detail #>> '{outboundRoute,id}' =
          expected_outbound_route_id
      )
    )
    and authority_detail #>> '{adapterContract,contractId}' =
      expected_adapter_contract_id
    and authority_detail #>> '{adapterContract,contractVersion}' =
      expected_adapter_contract_version
    and authority_detail -> 'adapterContract' =
      authority_detail #> '{capabilityFence,adapterContract}'
    and authority_detail #>> '{capabilityFence,capabilityId}' =
      expected_capability_id
    and authority_detail #>> '{capabilityFence,capabilityRevision}' =
      expected_capability_revision::text
    and authority_detail #>> '{capabilityFence,decision}' = 'supported'
    and isfinite((authority_detail #>>
      '{adapterContract,loadedAt}')::timestamptz)
    and (authority_detail #>> '{adapterContract,loadedAt}')::timestamptz <=
      expected_occurred_at
    and isfinite((authority_detail #>>
      '{capabilityFence,evaluatedAt}')::timestamptz)
    and isfinite((authority_detail #>>
      '{capabilityFence,notAfter}')::timestamptz)
    and (authority_detail #>>
      '{capabilityFence,evaluatedAt}')::timestamptz <= expected_occurred_at
    and (authority_detail #>>
      '{capabilityFence,notAfter}')::timestamptz >= expected_occurred_at;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_outbound_route_action_valid(
  expected_tenant_id text,
  expected_route_id text,
  expected_message_id text,
  expected_reference_owner_message_id text,
  expected_conversation_id text,
  expected_authority_at timestamptz,
  expected_attribution_created_at timestamptz,
  expected_operation_id text,
  expected_required_permission_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_attribution_id text,
  require_explicit_occurrence boolean
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return exists (
    select 1
      from public.inbox_v2_outbound_routes route_row
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = route_row.tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = route_row.tenant_id
       and message_row.id = expected_message_id
       and message_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_source_thread_binding_snapshots binding_snapshot
        on binding_snapshot.tenant_id = route_row.tenant_id
       and binding_snapshot.binding_id = route_row.source_thread_binding_id
       and binding_snapshot.revision = route_row.binding_revision
       and binding_snapshot.external_thread_id = route_row.external_thread_id
       and binding_snapshot.source_connection_id = route_row.source_connection_id
       and binding_snapshot.source_account_id = route_row.source_account_id
       and binding_snapshot.account_generation = route_row.account_generation
       and binding_snapshot.binding_generation = route_row.binding_generation
       and binding_snapshot.remote_access_revision =
         route_row.remote_access_revision
       and binding_snapshot.administrative_revision =
         route_row.administrative_revision
       and binding_snapshot.capability_revision = route_row.capability_revision
       and binding_snapshot.route_descriptor_revision =
         route_row.route_descriptor_revision
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = route_row.tenant_id
       and occurrence_row.id = expected_source_occurrence_id
       and occurrence_row.conversation_id = route_row.conversation_id
       and occurrence_row.external_thread_id = route_row.external_thread_id
       and occurrence_row.source_thread_binding_id =
         route_row.source_thread_binding_id
       and occurrence_row.source_connection_id = route_row.source_connection_id
       and occurrence_row.source_account_id = route_row.source_account_id
       and occurrence_row.binding_generation = route_row.binding_generation
       and occurrence_row.adapter_contract_id = route_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         route_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         route_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = route_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = route_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = route_row.tenant_id
       and reference_row.id = expected_external_message_reference_id
       and reference_row.external_thread_id = route_row.external_thread_id
      left join public.inbox_v2_source_thread_binding_capability_entries capability_row
        on capability_row.tenant_id = route_row.tenant_id
       and capability_row.binding_id = route_row.source_thread_binding_id
       and capability_row.materialized_by_binding_revision =
         route_row.binding_revision
       and capability_row.capability_revision = route_row.capability_revision
       and (
         expected_capability_id is null
         or capability_row.capability_id = expected_capability_id
       )
       and capability_row.operation_id = route_row.operation_id
       and capability_row.content_kind_id is not distinct from
         route_row.content_kind_id
     where route_row.tenant_id = expected_tenant_id
       and route_row.id = expected_route_id
       and route_row.conversation_id = expected_conversation_id
       and route_row.operation_id = expected_operation_id
       and route_row.required_conversation_permission_id =
         expected_required_permission_id
       and (
         expected_source_account_id is null
         or route_row.source_account_id = expected_source_account_id
       )
       and (
         expected_source_thread_binding_id is null
         or route_row.source_thread_binding_id =
           expected_source_thread_binding_id
       )
       and (
         expected_binding_generation is null
         or route_row.binding_generation = expected_binding_generation
       )
       and (
         expected_adapter_contract_id is null
         or (
           route_row.adapter_contract_id = expected_adapter_contract_id
           and route_row.adapter_contract_version =
             expected_adapter_contract_version
           and route_row.adapter_declaration_revision =
             expected_adapter_declaration_revision
           and route_row.adapter_surface_id = expected_adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             expected_adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = expected_adapter_loaded_at
         )
       )
       and (
         expected_capability_revision is null
         or route_row.capability_revision = expected_capability_revision
       )
       and binding_snapshot.remote_access_state = 'active'
       and binding_snapshot.administrative_state = 'enabled'
       and binding_snapshot.runtime_health_state = 'ready'
       and binding_snapshot.capability_contract_id =
         route_row.adapter_contract_id
       and binding_snapshot.capability_contract_version =
         route_row.adapter_contract_version
       and binding_snapshot.capability_declaration_revision =
         route_row.adapter_declaration_revision
       and binding_snapshot.capability_surface_id = route_row.adapter_surface_id
       and binding_snapshot.capability_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and binding_snapshot.capability_loaded_at = route_row.adapter_loaded_at
       and binding_snapshot.updated_at <= expected_authority_at
       and binding_snapshot.capability_captured_at <= expected_authority_at
       and (
         (
           expected_external_message_reference_id is null
           and expected_source_occurrence_id is null
           and route_row.reference_context_snapshot =
             '{"kind":"none"}'::jsonb
         )
         or (
           expected_external_message_reference_id is not null
           and expected_source_occurrence_id is not null
           and occurrence_row.id is not null
           and reference_row.id is not null
           and (
             expected_reference_owner_message_id is null
             or reference_row.message_id =
               expected_reference_owner_message_id
           )
           and route_row.reference_context_snapshot #>> '{kind}' =
             'external_message'
           and route_row.reference_context_snapshot #>>
             '{externalMessageReference,id}' =
               expected_external_message_reference_id
           and route_row.reference_context_snapshot #>>
             '{sourceOccurrence,id}' = expected_source_occurrence_id
         )
       )
       and (
         not require_explicit_occurrence
         or (
           route_row.selection_intent_kind = 'explicit_occurrence'
           and route_row.selection_reason = 'explicit_occurrence'
           and route_row.selection_intent_snapshot #>> '{occurrence,id}' =
             expected_source_occurrence_id
         )
       )
       and attribution_row.created_at = expected_attribution_created_at
       and attribution_row.source_occurrence_id is null
       and (
         (
           attribution_row.app_actor_kind = 'employee'
           and route_row.principal_kind = 'employee'
           and route_row.principal_employee_id =
             attribution_row.app_actor_employee_id
           and route_row.authorization_epoch =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_row.app_actor_kind = 'trusted_service'
           and route_row.principal_kind = 'trusted_service'
           and route_row.principal_trusted_service_id =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and capability_row.state = 'supported'
       and (
         capability_row.valid_until is null
         or capability_row.valid_until >= expected_authority_at
       )
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_required_roles
             required_role
          where required_role.tenant_id = capability_row.tenant_id
            and required_role.binding_id = capability_row.binding_id
            and required_role.capability_revision =
              capability_row.capability_revision
            and required_role.capability_ordinal = capability_row.ordinal
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_provider_roles
                  provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                   binding_snapshot.provider_access_revision
                 and provider_role.provider_role_id =
                   required_role.provider_role_id
            )
       )
       and route_row.runtime_observation_snapshot #>> '{state}' = 'ready'
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at
       and route_row.selected_at <= expected_authority_at
       and route_row.created_at <= expected_authority_at
       and route_row.candidate_snapshot_not_after >= expected_authority_at
       and (route_row.conversation_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (route_row.source_account_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (
         expected_external_message_reference_id is null
         or (
           (route_row.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >=
               expected_authority_at
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
           and (
             route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,state}' <> 'valid'
             or (route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
                 expected_authority_at
           )
         )
       )
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_json_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  valid boolean := false;
begin
  case tg_table_name
    when 'inbox_v2_message_provider_lifecycle_operations' then
      valid := (
        (new.provider_semantic_proof_detail is null
          and new.semantic_ordering_commit_detail is null)
        or (public.inbox_v2_tm_json_family_valid(
            'provider_semantic_proof', new.provider_semantic_proof_detail
          ) and public.inbox_v2_tm_json_family_valid(
            'provider_ordering_commit', new.semantic_ordering_commit_detail
          ))
      );
    when 'inbox_v2_message_provider_lifecycle_transitions' then
      valid := new.result_proof_adapter_contract_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'adapter_contract', new.result_proof_adapter_contract_detail
        );
    when 'inbox_v2_message_reactions' then
      valid := public.inbox_v2_tm_json_family_valid(
        'reaction_capability', new.capability_detail
      ) and public.inbox_v2_tm_json_family_valid(
        'reaction_state', new.state_detail
      ) and public.inbox_v2_tm_reaction_value_flat_valid(
        new.state_detail,
        new.state_kind::text,
        new.value_kind::text,
        new.unicode_value,
        new.provider_reaction_kind_id,
        new.provider_canonical_code
      ) and new.capability_detail #>> '{kind}' = new.capability_kind::text
      and new.capability_detail #>> '{cardinality}' = new.cardinality::text
      and (
        new.capability_kind = 'internal'
        or (
          new.capability_detail #>> '{capabilityId}' = new.capability_id
          and new.capability_detail #>> '{capabilityRevision}' =
            new.capability_revision::text
          and new.capability_detail #>> '{adapterContract,contractId}' =
            new.adapter_contract_id
          and new.capability_detail #>> '{adapterContract,contractVersion}' =
            new.adapter_contract_version
        )
      )
      and (
        new.state_kind = 'active'
        or (
          new.state_kind = 'cleared'
          and (new.state_detail #>> '{clearedAt}')::timestamptz =
            new.cleared_at
        )
        or (
          new.state_kind = 'pending_external'
          and new.state_detail #>> '{operation}' =
            new.external_operation::text
          and new.state_detail #>> '{outboundRoute,tenantId}' = new.tenant_id
          and new.state_detail #>> '{outboundRoute,kind}' = 'outbound_route'
          and new.state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.state_detail #>> '{requestTransition,id}' =
            new.request_transition_id
          and (new.state_detail #>> '{requestedAt}')::timestamptz =
            new.updated_at
        )
        or (
          new.state_kind = 'external_terminal'
          and new.state_detail #>> '{operation}' =
            new.external_operation::text
          and new.state_detail #>> '{outboundRoute,tenantId}' = new.tenant_id
          and new.state_detail #>> '{outboundRoute,kind}' = 'outbound_route'
          and new.state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.state_detail #>> '{requestTransition,id}' =
            new.request_transition_id
          and new.state_detail #>> '{outcome}' = new.external_outcome
          and new.state_detail #>> '{resultToken}' = new.result_token
          and new.state_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.state_detail #>> '{resolvedAt}')::timestamptz =
            new.resolved_at
        )
      );
    when 'inbox_v2_message_reaction_transitions' then
      valid := (
        new.before_state_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'reaction_state', new.before_state_detail
        )
      )
      and public.inbox_v2_tm_json_family_valid(
        'reaction_state', new.after_state_detail
      )
      and public.inbox_v2_tm_reaction_value_flat_valid(
        new.after_state_detail,
        new.after_state_kind::text,
        new.value_kind::text,
        new.unicode_value,
        new.provider_reaction_kind_id,
        new.provider_canonical_code
      )
      and public.inbox_v2_tm_reaction_transition_state_valid(
        new.before_state_detail,
        new.after_state_detail,
        new.mode::text,
        new.operation::text,
        new.recorded_at
      )
      and (
        (
          new.after_state_kind = 'active'
          and new.mode in ('internal_apply', 'provider_observed')
        )
        or (
          new.after_state_kind = 'cleared'
          and new.mode in ('internal_apply', 'provider_observed')
          and (new.after_state_detail #>> '{clearedAt}')::timestamptz =
            new.recorded_at
        )
        or (
          new.after_state_kind = 'pending_external'
          and new.mode = 'external_request'
          and new.after_state_detail #>> '{operation}' = new.operation::text
          and new.after_state_detail #>> '{outboundRoute,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.after_state_detail #>> '{outboundRoute,id}' =
            new.outbound_route_id
          and new.after_state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.after_state_detail #>> '{requestTransition,id}' = new.id
          and public.inbox_v2_tm_reaction_attribution_row_valid(
            new.tenant_id,
            new.action_attribution_id,
            new.after_state_detail -> 'requestAttribution',
            new.recorded_at
          )
          and (new.after_state_detail #>> '{requestedAt}')::timestamptz =
            new.recorded_at
        )
        or (
          new.after_state_kind = 'external_terminal'
          and new.mode = 'provider_result'
          and new.before_state_detail #>> '{kind}' = 'pending_external'
          and public.inbox_v2_tm_reaction_attribution_row_valid(
            new.tenant_id,
            new.action_attribution_id,
            new.before_state_detail -> 'requestAttribution',
            new.recorded_at
          )
          and new.after_state_detail #>> '{operation}' = new.operation::text
          and new.after_state_detail -> 'outboundRoute' =
            new.before_state_detail -> 'outboundRoute'
          and new.after_state_detail -> 'requestTransition' =
            new.before_state_detail -> 'requestTransition'
          and new.after_state_detail #>> '{outboundRoute,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.after_state_detail #>> '{requestTransition,tenantId}' =
            new.tenant_id
          and new.after_state_detail #>> '{requestTransition,kind}' =
            'message_reaction_transition'
          and new.after_state_detail #>> '{outcome}' =
            new.provider_result_proof_detail #>> '{resultState}'
          and new.after_state_detail #>> '{resultToken}' = new.result_token
          and new.after_state_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.after_state_detail #>> '{resolvedAt}')::timestamptz =
            new.recorded_at
          and new.provider_result_proof_detail #>> '{tenantId}' =
            new.tenant_id
          and new.provider_result_proof_detail #>> '{operation,tenantId}' =
            new.tenant_id
          and new.provider_result_proof_detail #>> '{operation,kind}' =
            'message_reaction_transition'
          and new.provider_result_proof_detail #>> '{operation,id}' =
            new.after_state_detail #>> '{requestTransition,id}'
          and new.provider_result_proof_detail #>>
            '{outboundRoute,tenantId}' = new.tenant_id
          and new.provider_result_proof_detail #>> '{outboundRoute,kind}' =
            'outbound_route'
          and new.provider_result_proof_detail #>> '{outboundRoute,id}' =
            new.after_state_detail #>> '{outboundRoute,id}'
          and new.provider_result_proof_detail #>> '{resultToken}' =
            new.result_token
          and new.provider_result_proof_detail #>> '{resultDigestSha256}' =
            new.result_digest_sha256
          and (new.provider_result_proof_detail #>>
            '{recordedAt}')::timestamptz = new.recorded_at
        )
      )
      and (
        new.external_authority_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'reaction_authority', new.external_authority_detail
        )
      )
      and (
        new.mode not in ('external_request', 'provider_observed')
        or public.inbox_v2_tm_reaction_authority_flat_valid(
          new.external_authority_detail,
          new.tenant_id,
          new.external_message_reference_id,
          new.source_occurrence_id,
          new.source_account_id,
          new.source_thread_binding_id,
          new.binding_generation,
          new.outbound_route_id,
          new.adapter_contract_id,
          new.adapter_contract_version,
          new.capability_id,
          new.capability_revision,
          new.occurred_at
        )
      )
      and (
        new.mode <> 'external_request'
        or exists (
          select 1
            from public.inbox_v2_message_reactions reaction_row
            join public.inbox_v2_messages message_row
              on message_row.tenant_id = reaction_row.tenant_id
             and message_row.id = reaction_row.message_id
           where reaction_row.tenant_id = new.tenant_id
             and reaction_row.id = new.reaction_id
             and public.inbox_v2_tm_outbound_route_action_valid(
               new.tenant_id,
               new.outbound_route_id,
               reaction_row.message_id,
               reaction_row.message_id,
               message_row.conversation_id,
               new.occurred_at,
               new.recorded_at,
               'core:message.reaction.' || new.operation::text,
               'core:message.reaction.' || new.operation::text || '_external',
               new.external_message_reference_id,
               new.source_occurrence_id,
               new.source_account_id,
               new.source_thread_binding_id,
               new.binding_generation,
               new.adapter_contract_id,
               new.adapter_contract_version,
               (new.external_authority_detail #>>
                 '{adapterContract,declarationRevision}')::bigint,
               new.external_authority_detail #>>
                 '{adapterContract,surfaceId}',
               new.external_authority_detail #>>
                 '{adapterContract,loadedByTrustedServiceId}',
               (new.external_authority_detail #>>
                 '{adapterContract,loadedAt}')::timestamptz,
               new.capability_id,
               new.capability_revision,
               new.action_attribution_id,
               true
             )
        )
      )
      and (
        new.provider_result_proof_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'provider_result_proof', new.provider_result_proof_detail
        )
      )
      and (
        new.mode <> 'provider_result'
        or exists (
          select 1
            from public.inbox_v2_message_reactions reaction_row
            join public.inbox_v2_messages message_row
              on message_row.tenant_id = reaction_row.tenant_id
             and message_row.id = reaction_row.message_id
            join public.inbox_v2_outbound_routes route_row
              on route_row.tenant_id = reaction_row.tenant_id
             and route_row.id = new.provider_result_proof_detail #>>
               '{outboundRoute,id}'
             and route_row.conversation_id = message_row.conversation_id
            join public.inbox_v2_message_reaction_transitions request_row
              on request_row.tenant_id = reaction_row.tenant_id
             and request_row.id = new.provider_result_proof_detail #>>
               '{operation,id}'
             and request_row.reaction_id = reaction_row.id
             and request_row.mode = 'external_request'
             and request_row.resulting_revision = new.expected_revision
             and request_row.outbound_route_id = route_row.id
           where reaction_row.tenant_id = new.tenant_id
             and reaction_row.id = new.reaction_id
             and reaction_row.capability_kind = 'external'
             and new.provider_result_proof_detail #>> '{revision}' = '1'
             and new.provider_result_proof_detail #>> '{capabilityId}' =
               reaction_row.capability_id
             and new.provider_result_proof_detail #>>
               '{capabilityRevision}' = reaction_row.capability_revision::text
             and new.provider_result_proof_detail -> 'adapterContract' =
               reaction_row.capability_detail -> 'adapterContract'
             and new.provider_result_proof_detail #>> '{semanticId}' =
               'core:message.reaction.' || new.operation::text || '.result'
             and new.provider_result_proof_detail #>> '{semanticRevision}' ~
               '^[1-9][0-9]*$'
             and char_length(new.provider_result_proof_detail #>>
               '{semanticRevision}') <= 19
             and (
               char_length(new.provider_result_proof_detail #>>
                 '{semanticRevision}') < 19
               or (new.provider_result_proof_detail #>>
                 '{semanticRevision}') collate "C" <=
                   '9223372036854775807'
             )
             and new.provider_result_proof_detail #>>
               '{declaredByTrustedServiceId}' =
                 new.provider_result_proof_detail #>>
                   '{adapterContract,loadedByTrustedServiceId}'
             and isfinite((new.provider_result_proof_detail #>>
               '{adapterContract,loadedAt}')::timestamptz)
             and (new.provider_result_proof_detail #>>
               '{adapterContract,loadedAt}')::timestamptz <= new.recorded_at
             and route_row.adapter_contract_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,contractId}'
             and route_row.adapter_contract_version =
               new.provider_result_proof_detail #>>
                 '{adapterContract,contractVersion}'
             and route_row.adapter_declaration_revision::text =
               new.provider_result_proof_detail #>>
                 '{adapterContract,declarationRevision}'
             and route_row.adapter_surface_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,surfaceId}'
             and route_row.adapter_loaded_by_trusted_service_id =
               new.provider_result_proof_detail #>>
                 '{adapterContract,loadedByTrustedServiceId}'
             and route_row.adapter_loaded_at =
               (new.provider_result_proof_detail #>>
                 '{adapterContract,loadedAt}')::timestamptz
             and route_row.capability_revision =
               reaction_row.capability_revision
        )
      )
      and exists (
        select 1
          from public.inbox_v2_message_reactions reaction_row
          join public.inbox_v2_action_attributions attribution_row
            on attribution_row.tenant_id = new.tenant_id
           and attribution_row.id = new.action_attribution_id
         where reaction_row.tenant_id = new.tenant_id
           and reaction_row.id = new.reaction_id
           and (
             new.operation <> 'replace'
             or (
               reaction_row.capability_kind = 'external'
               and reaction_row.cardinality = 'single_value'
             )
           )
           and (
             (
               new.mode = 'internal_apply'
               and reaction_row.capability_kind = 'internal'
               and attribution_row.app_actor_kind is not null
               and attribution_row.source_occurrence_id is null
             )
             or (
               new.mode in ('external_request', 'provider_result')
               and reaction_row.capability_kind = 'external'
               and attribution_row.app_actor_kind is not null
               and attribution_row.source_occurrence_id is null
             )
             or (
               new.mode = 'provider_observed'
               and reaction_row.capability_kind = 'external'
               and attribution_row.app_actor_kind is null
               and attribution_row.source_occurrence_id =
                 new.source_occurrence_id
             )
           )
      );
    when 'inbox_v2_message_provider_reaction_observations' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_semantic_proof', new.semantic_proof_detail
      ) and public.inbox_v2_tm_json_family_valid(
        'provider_ordering_commit', new.ordering_commit_detail
      );
    when 'inbox_v2_provider_semantic_ordering_heads' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_ordering_head', new.head_detail
      );
    when 'inbox_v2_message_delivery_observations' then
      valid := new.semantic_proof_detail is null
        or public.inbox_v2_tm_json_family_valid(
          'provider_semantic_proof', new.semantic_proof_detail
        );
    when 'inbox_v2_provider_receipt_observations' then
      valid := public.inbox_v2_tm_json_family_valid(
        'provider_semantic_proof', new.semantic_proof_detail
      );
    else
      valid := false;
  end case;

  if not coalesce(valid, false) then
    raise exception using errcode = '23514',
      message = format(
        'inbox_v2.timeline_message_json_contract:%s', tg_table_name
      );
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_lifecycle_history_valid(
  expected_tenant_id text,
  expected_operation_id text
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  operation_row record;
  transition_row record;
  predecessor_row record;
  before_outcome text;
  before_outcome_retryable integer;
  before_outcome_reason_id text;
  before_delete_local_effect text;
  before_policy_decision_event_id text;
  before_policy_decision_revision bigint;
  before_policy_decided_at timestamptz;
  outcome_changed boolean;
  policy_changed boolean;
  proof_field_count integer;
begin
  select * into operation_row
    from public.inbox_v2_message_provider_lifecycle_operations
   where tenant_id = expected_tenant_id
     and id = expected_operation_id;
  if not found then
    return false;
  end if;

  for transition_row in
    select *
      from public.inbox_v2_message_provider_lifecycle_transitions
     where tenant_id = expected_tenant_id
       and operation_id = expected_operation_id
     order by resulting_revision
  loop
    if transition_row.resulting_revision > operation_row.revision then
      return false;
    end if;

    if transition_row.expected_revision = 1 then
      if transition_row.recorded_at < operation_row.created_at
         or transition_row.recorded_stream_position <=
           operation_row.created_stream_position then
        return false;
      end if;
      before_outcome := operation_row.initial_outcome::text;
      before_outcome_retryable := operation_row.initial_outcome_retryable;
      before_outcome_reason_id := operation_row.initial_outcome_reason_id;
      before_delete_local_effect :=
        operation_row.initial_delete_local_effect::text;
      before_policy_decision_event_id :=
        operation_row.initial_policy_decision_event_id;
      before_policy_decision_revision :=
        operation_row.initial_policy_decision_revision;
      before_policy_decided_at := operation_row.initial_policy_decided_at;
    else
      select * into predecessor_row
        from public.inbox_v2_message_provider_lifecycle_transitions
       where tenant_id = transition_row.tenant_id
         and operation_id = transition_row.operation_id
         and resulting_revision = transition_row.expected_revision;
      if not found then
        return false;
      end if;
      if transition_row.recorded_at < predecessor_row.recorded_at
         or transition_row.recorded_stream_position <=
           predecessor_row.recorded_stream_position then
        return false;
      end if;
      before_outcome := predecessor_row.outcome::text;
      before_outcome_retryable := predecessor_row.outcome_retryable;
      before_outcome_reason_id := predecessor_row.outcome_reason_id;
      before_delete_local_effect := predecessor_row.delete_local_effect::text;
      before_policy_decision_event_id :=
        predecessor_row.policy_decision_event_id;
      before_policy_decision_revision :=
        predecessor_row.policy_decision_revision;
      before_policy_decided_at := predecessor_row.policy_decided_at;
    end if;

    outcome_changed :=
      before_outcome is distinct from transition_row.outcome::text
      or before_outcome_retryable is distinct from
        transition_row.outcome_retryable
      or before_outcome_reason_id is distinct from
        transition_row.outcome_reason_id;
    policy_changed :=
      before_delete_local_effect is distinct from
        transition_row.delete_local_effect::text
      or before_policy_decision_event_id is distinct from
        transition_row.policy_decision_event_id
      or before_policy_decision_revision is distinct from
        transition_row.policy_decision_revision
      or before_policy_decided_at is distinct from
        transition_row.policy_decided_at;
    if not outcome_changed and not policy_changed then
      return false;
    end if;

    if outcome_changed then
      if operation_row.origin <> 'hulee_requested' then
        return false;
      end if;
      if not (
        (before_outcome = 'pending' and transition_row.outcome in (
          'accepted', 'confirmed', 'failed', 'unsupported', 'outcome_unknown'
        ))
        or (before_outcome = 'accepted' and transition_row.outcome in (
          'confirmed', 'failed', 'outcome_unknown'
        ))
        or (before_outcome = 'outcome_unknown' and
          transition_row.outcome in ('confirmed', 'failed'))
      ) then
        return false;
      end if;
    end if;

    if policy_changed and (
      before_delete_local_effect is null
      or before_delete_local_effect <> 'not_evaluated'
      or transition_row.delete_local_effect is null
    ) then
      return false;
    end if;

    proof_field_count := num_nonnulls(
      transition_row.result_token,
      transition_row.result_digest_sha256,
      transition_row.result_proof_outbound_route_id,
      transition_row.result_proof_capability_id,
      transition_row.result_proof_capability_revision,
      transition_row.result_proof_semantic_id,
      transition_row.result_proof_semantic_revision,
      transition_row.result_proof_state,
      transition_row.result_proof_declared_by_trusted_service_id,
      transition_row.result_proof_recorded_at,
      transition_row.result_proof_adapter_contract_detail,
      transition_row.result_proof_adapter_contract_detail_digest_sha256
    );
    if not outcome_changed then
      if proof_field_count <> 0 then
        return false;
      end if;
    elsif proof_field_count <> 12
      or operation_row.outbound_route_id is null
      or transition_row.result_proof_outbound_route_id <>
        operation_row.outbound_route_id
      or transition_row.result_proof_capability_id <>
        'core:message-' || operation_row.action::text
      or transition_row.result_proof_capability_revision <>
        operation_row.capability_revision
      or transition_row.result_proof_state <> transition_row.outcome::text
      or transition_row.result_proof_semantic_id <>
        'core:message.lifecycle.' || operation_row.action::text ||
          '.result.' || transition_row.outcome::text
      or transition_row.result_proof_declared_by_trusted_service_id <>
        operation_row.adapter_loaded_by_trusted_service_id
      or transition_row.result_proof_recorded_at <> transition_row.recorded_at
      or transition_row.result_proof_adapter_contract_detail #>>
        '{contractId}' <> operation_row.adapter_contract_id
      or transition_row.result_proof_adapter_contract_detail #>>
        '{contractVersion}' <> operation_row.adapter_contract_version
      or transition_row.result_proof_adapter_contract_detail #>>
        '{declarationRevision}' <>
          operation_row.adapter_declaration_revision::text
      or transition_row.result_proof_adapter_contract_detail #>>
        '{surfaceId}' <> operation_row.adapter_surface_id
      or transition_row.result_proof_adapter_contract_detail #>>
        '{loadedByTrustedServiceId}' <>
          operation_row.adapter_loaded_by_trusted_service_id
      or (transition_row.result_proof_adapter_contract_detail #>>
        '{loadedAt}')::timestamptz <> operation_row.adapter_loaded_at
    then
      return false;
    end if;
  end loop;
  return true;
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_transport_occurrence_link_valid(
  checked_tenant_id text,
  checked_link_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_message_transport_links link_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = link_row.tenant_id
       and message_row.id = link_row.message_id
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = link_row.tenant_id
       and occurrence_row.id = link_row.source_occurrence_id
       and occurrence_row.conversation_id = message_row.conversation_id
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         link_row.external_message_reference_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = link_row.tenant_id
       and reference_row.id = link_row.external_message_reference_id
       and reference_row.message_id = link_row.message_id
       and reference_row.conversation_id = message_row.conversation_id
       and reference_row.timeline_item_id = message_row.timeline_item_id
       and reference_row.external_thread_id = occurrence_row.external_thread_id
       and reference_row.message_key_digest_sha256 =
         occurrence_row.message_key_digest_sha256
      join public.inbox_v2_external_threads thread_row
        on thread_row.tenant_id = reference_row.tenant_id
       and thread_row.id = reference_row.external_thread_id
       and thread_row.conversation_id = message_row.conversation_id
      left join public.inbox_v2_outbound_routes route_row
        on route_row.tenant_id = message_row.tenant_id
       and route_row.id = message_row.origin_outbound_route_id
      left join public.inbox_v2_source_occurrences origin_occurrence_row
        on origin_occurrence_row.tenant_id = message_row.tenant_id
       and origin_occurrence_row.id = message_row.origin_source_occurrence_id
     where link_row.tenant_id = checked_tenant_id
       and link_row.id = checked_link_id
       and link_row.revision = 1
       and link_row.linked_at >= message_row.created_at
       and (
         (message_row.origin_kind = 'source_originated'
           and reference_row.created_at = message_row.created_at
           and origin_occurrence_row.resolution_state = 'resolved'
           and origin_occurrence_row.resolved_external_message_reference_id =
             reference_row.id
           and origin_occurrence_row.external_thread_id = reference_row.external_thread_id
           and origin_occurrence_row.conversation_id = message_row.conversation_id
           and origin_occurrence_row.direction::text =
             message_row.origin_source_direction::text
           and origin_occurrence_row.origin_kind not in (
             'provider_echo', 'provider_response'
           )
           and origin_occurrence_row.provider_actor_kind =
             'source_external_identity'
           and origin_occurrence_row.message_key_digest_sha256 =
             reference_row.message_key_digest_sha256
           and (
             (occurrence_row.id = origin_occurrence_row.id
               and link_row.resulting_head_revision = 1
               and link_row.linked_at = message_row.created_at
               and link_row.role = case message_row.origin_source_direction
                 when 'inbound' then 'origin'::public.inbox_v2_message_transport_link_role
                 when 'outbound' then 'native_outbound'::public.inbox_v2_message_transport_link_role
               end)
             or (occurrence_row.id <> origin_occurrence_row.id
               and (
                 (message_row.origin_source_direction = 'inbound'
                   and link_row.role = 'additional_artifact'
                   and occurrence_row.direction = 'inbound'
                   and occurrence_row.origin_kind not in (
                     'provider_echo', 'provider_response'
                   )
                   and occurrence_row.provider_actor_kind =
                     'source_external_identity')
                 or (message_row.origin_source_direction = 'outbound'
                   and occurrence_row.direction = 'outbound'
                   and (
                     (link_row.role = 'native_outbound'
                       and occurrence_row.origin_kind not in (
                         'provider_echo', 'provider_response'
                       )
                       and occurrence_row.provider_actor_kind =
                         'source_external_identity')
                     or (link_row.role = 'provider_echo'
                       and occurrence_row.origin_kind = 'provider_echo')
                   ))
               ))
           ))
         or (message_row.origin_kind = 'hulee_external'
           and route_row.conversation_id = message_row.conversation_id
           and route_row.external_thread_id = reference_row.external_thread_id
           and route_row.external_thread_id = occurrence_row.external_thread_id
           and route_row.adapter_contract_id = occurrence_row.adapter_contract_id
           and route_row.adapter_contract_version =
             occurrence_row.adapter_contract_version
           and route_row.adapter_declaration_revision =
             occurrence_row.adapter_declaration_revision
           and route_row.adapter_surface_id = occurrence_row.adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             occurrence_row.adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = occurrence_row.adapter_loaded_at
           and (
             (route_row.source_account_id = occurrence_row.source_account_id
               and route_row.source_thread_binding_id =
                 occurrence_row.source_thread_binding_id
               and route_row.binding_generation =
                 occurrence_row.binding_generation)
             or (not (
                 route_row.source_account_id = occurrence_row.source_account_id
                 and route_row.source_thread_binding_id =
                   occurrence_row.source_thread_binding_id
               )
               and link_row.role = 'provider_echo'
               and occurrence_row.origin_kind = 'provider_echo'
               and occurrence_row.message_scope_kind = 'provider_thread'
               and occurrence_row.message_decision_strength = 'authoritative'
               and reference_row.scope_kind = 'provider_thread'
               and thread_row.scope_kind = 'provider'
               and thread_row.identity_declaration ->> 'decisionStrength' =
                 'authoritative')
           )
           and (
             (link_row.role = 'provider_echo'
               and occurrence_row.origin_kind = 'provider_echo')
             or (link_row.role = 'provider_response'
               and occurrence_row.origin_kind = 'provider_response')
           ))
       )
  );
$function$;

create or replace function public.inbox_v2_tm_provider_fact_semantic_proof_valid(
  proof_detail jsonb,
  expected_tenant_id text,
  expected_normalized_event_id text,
  expected_external_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_semantic_id text,
  expected_actor_id text,
  expected_occurred_at timestamptz,
  expected_recorded_at timestamptz
) returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return coalesce(
    public.inbox_v2_tm_json_family_valid(
      'provider_semantic_proof', proof_detail
    )
    and proof_detail #>> '{tenantId}' = expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,kind}' =
      'normalized_inbound_event'
    and proof_detail #>> '{normalizedInboundEvent,id}' =
      expected_normalized_event_id
    and (
      (expected_external_reference_id is null
        and expected_source_occurrence_id is null
        and proof_detail -> 'externalMessageReference' = 'null'::jsonb
        and proof_detail -> 'sourceOccurrence' = 'null'::jsonb)
      or (expected_external_reference_id is not null
        and expected_source_occurrence_id is not null
        and proof_detail #>> '{externalMessageReference,tenantId}' =
          expected_tenant_id
        and proof_detail #>> '{externalMessageReference,kind}' =
          'external_message_reference'
        and proof_detail #>> '{externalMessageReference,id}' =
          expected_external_reference_id
        and proof_detail #>> '{sourceOccurrence,tenantId}' =
          expected_tenant_id
        and proof_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
        and proof_detail #>> '{sourceOccurrence,id}' =
          expected_source_occurrence_id)
    )
    and proof_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceAccount,kind}' = 'source_account'
    and proof_detail #>> '{sourceAccount,id}' = expected_source_account_id
    and proof_detail #>> '{sourceThreadBinding,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and proof_detail #>> '{sourceThreadBinding,id}' =
      expected_source_thread_binding_id
    and proof_detail #>> '{bindingGeneration}' =
      expected_binding_generation::text
    and proof_detail #>> '{adapterContract,contractId}' =
      expected_adapter_contract_id
    and proof_detail #>> '{adapterContract,contractVersion}' =
      expected_adapter_contract_version
    and proof_detail #>> '{adapterContract,declarationRevision}' =
      expected_adapter_declaration_revision::text
    and proof_detail #>> '{adapterContract,surfaceId}' =
      expected_adapter_surface_id
    and proof_detail #>> '{adapterContract,loadedByTrustedServiceId}' =
      expected_adapter_loaded_by_trusted_service_id
    and (proof_detail #>> '{adapterContract,loadedAt}')::timestamptz =
      expected_adapter_loaded_at
    and proof_detail #>> '{capabilityId}' = expected_capability_id
    and proof_detail #>> '{capabilityRevision}' =
      expected_capability_revision::text
    and proof_detail #>> '{semanticId}' = expected_semantic_id
    and proof_detail #>> '{semanticRevision}' = '1'
    and proof_detail #>> '{declaredByTrustedServiceId}' =
      expected_adapter_loaded_by_trusted_service_id
    and proof_detail #>> '{revision}' = '1'
    and (
      (expected_actor_id is null and proof_detail -> 'actor' = 'null'::jsonb)
      or (expected_actor_id is not null
        and proof_detail #>> '{actor,tenantId}' = expected_tenant_id
        and proof_detail #>> '{actor,kind}' = 'source_external_identity'
        and proof_detail #>> '{actor,id}' = expected_actor_id)
    )
    and (proof_detail #>> '{occurredAt}')::timestamptz =
      expected_occurred_at
    and (proof_detail #>> '{recordedAt}')::timestamptz =
      expected_recorded_at,
    false
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_action_attribution_valid(
  checked_tenant_id text,
  checked_attribution_id text,
  expected_conversation_id text,
  source_attribution_allowed boolean
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_action_attributions attribution_row
      left join public.inbox_v2_conversation_participants participant_row
        on participant_row.tenant_id = attribution_row.tenant_id
       and participant_row.id = attribution_row.action_participant_id
       and participant_row.conversation_id = attribution_row.conversation_id
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = attribution_row.tenant_id
       and occurrence_row.id = attribution_row.source_occurrence_id
     where attribution_row.tenant_id = checked_tenant_id
       and attribution_row.id = checked_attribution_id
       and attribution_row.conversation_id = expected_conversation_id
       and (
         (attribution_row.app_actor_kind = 'employee'
           and attribution_row.source_occurrence_id is null
           and attribution_row.automation_kind is null
           and participant_row.subject_kind = 'employee'
           and participant_row.subject_employee_id =
             attribution_row.app_actor_employee_id)
         or (attribution_row.app_actor_kind = 'trusted_service'
           and attribution_row.source_occurrence_id is null
           and attribution_row.automation_kind is not null
           and (
             attribution_row.action_participant_id is null
             or participant_row.subject_kind = 'bot'
           ))
         or (source_attribution_allowed
           and attribution_row.app_actor_kind is null
           and attribution_row.source_occurrence_id is not null
           and attribution_row.automation_kind is null
           and (
              (occurrence_row.provider_actor_kind = 'source_external_identity'
                and participant_row.subject_kind = 'source_external_identity'
                and participant_row.subject_source_external_identity_id =
                  occurrence_row.provider_actor_source_external_identity_id)
              or (occurrence_row.provider_actor_kind = 'provider_system'
                and (
                  attribution_row.action_participant_id is null
                  or participant_row.subject_kind = 'system'
                ))
              or (occurrence_row.provider_actor_kind is null
                and attribution_row.action_participant_id is null)
            ))
       )
  );
$function$;

create or replace function public.inbox_v2_tm_content_history_valid(
  checked_tenant_id text,
  checked_content_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_revisions latest_row
        on latest_row.tenant_id = content_row.tenant_id
       and latest_row.content_id = content_row.id
       and latest_row.revision = content_row.revision
       and latest_row.state = content_row.state
       and latest_row.recorded_stream_position =
         content_row.last_changed_stream_position
     where content_row.tenant_id = checked_tenant_id
       and content_row.id = checked_content_id
       and content_row.state_changed_at = case latest_row.transition_kind
         when 'created' then latest_row.recorded_at
         else latest_row.occurred_at
       end
       and content_row.updated_at = case latest_row.transition_kind
         when 'created' then latest_row.recorded_at
         else latest_row.occurred_at
       end
       and content_row.tombstone_event_id is not distinct from case
         when latest_row.transition_kind in (
           'privacy_erasure', 'retention_purge'
         ) then latest_row.event_id
         else null
       end
       and content_row.tombstone_reason_id is not distinct from
         latest_row.reason_id
       and content_row.retention_policy_id is not distinct from
         latest_row.retention_policy_id
       and content_row.retention_policy_version is not distinct from
         latest_row.retention_policy_version
       and content_row.retention_policy_revision is not distinct from
         latest_row.retention_policy_revision
       and (
         select count(*) = content_row.revision
            and min(history_row.revision) = 1
            and max(history_row.revision) = content_row.revision
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_timeline_content_revisions first_row
          where first_row.tenant_id = content_row.tenant_id
            and first_row.content_id = content_row.id
            and first_row.revision = 1
            and first_row.expected_previous_revision is null
            and first_row.transition_kind = 'created'
            and first_row.state = 'available'
            and first_row.event_id is null
            and first_row.reason_id is null
            and first_row.retention_policy_id is null
             and first_row.retention_policy_version is null
             and first_row.retention_policy_revision is null
             and first_row.occurred_at = content_row.retention_anchor_at
             and first_row.recorded_at = content_row.created_at
        )
       and (
         (content_row.owner_kind = 'message' and exists (
           select 1
             from public.inbox_v2_messages owner_row
             join public.inbox_v2_message_revisions first_owner_revision_row
               on first_owner_revision_row.tenant_id = owner_row.tenant_id
              and first_owner_revision_row.message_id = owner_row.id
              and first_owner_revision_row.message_revision = 1
              and first_owner_revision_row.change_kind = 'created'
              and first_owner_revision_row.after_content_id = content_row.id
              and first_owner_revision_row.after_content_revision = 1
              and first_owner_revision_row.after_content_state = 'available'
            where owner_row.tenant_id = content_row.tenant_id
              and owner_row.id = content_row.owner_id
              and owner_row.content_id = content_row.id
         ))
         or (content_row.owner_kind = 'staff_note' and exists (
           select 1
             from public.inbox_v2_staff_notes owner_row
             join public.inbox_v2_staff_note_revisions first_owner_revision_row
               on first_owner_revision_row.tenant_id = owner_row.tenant_id
              and first_owner_revision_row.staff_note_id = owner_row.id
              and first_owner_revision_row.staff_note_revision = 1
              and first_owner_revision_row.change_kind = 'created'
              and first_owner_revision_row.after_content_id = content_row.id
              and first_owner_revision_row.after_content_revision = 1
              and first_owner_revision_row.after_content_state = 'available'
            where owner_row.tenant_id = content_row.tenant_id
              and owner_row.id = content_row.owner_id
              and owner_row.content_id = content_row.id
         ))
       )
       and not exists (
         select 1
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
            and not (
              (content_row.owner_kind = 'message' and 1 = (
                select count(*)
                  from public.inbox_v2_message_revisions owner_revision_row
                 where owner_revision_row.tenant_id = content_row.tenant_id
                   and owner_revision_row.message_id = content_row.owner_id
                   and owner_revision_row.after_content_id = content_row.id
                   and owner_revision_row.after_content_revision =
                     history_row.revision
                   and owner_revision_row.after_content_state = history_row.state
                   and owner_revision_row.recorded_stream_position =
                     history_row.recorded_stream_position
                   and owner_revision_row.recorded_at = history_row.recorded_at
                   and owner_revision_row.change_kind::text = case
                     history_row.transition_kind
                     when 'created' then 'created'
                     when 'edit' then 'edited'
                     when 'attachment_materialization' then
                       'attachment_materialized'
                     when 'privacy_erasure' then 'privacy_erasure_tombstone'
                     when 'retention_purge' then 'retention_purge_tombstone'
                   end
              ))
              or (content_row.owner_kind = 'staff_note' and 1 = (
                select count(*)
                  from public.inbox_v2_staff_note_revisions owner_revision_row
                 where owner_revision_row.tenant_id = content_row.tenant_id
                   and owner_revision_row.staff_note_id = content_row.owner_id
                   and owner_revision_row.after_content_id = content_row.id
                   and owner_revision_row.after_content_revision =
                     history_row.revision
                   and owner_revision_row.after_content_state = history_row.state
                   and owner_revision_row.recorded_stream_position =
                     history_row.recorded_stream_position
                   and owner_revision_row.recorded_at = history_row.recorded_at
                   and owner_revision_row.change_kind::text = case
                     history_row.transition_kind
                     when 'created' then 'created'
                     when 'edit' then 'edited'
                     when 'privacy_erasure' then 'privacy_erasure_tombstone'
                     when 'retention_purge' then 'retention_purge_tombstone'
                     else null
                   end
              ))
            )
       )
       and not exists (
         select 1
           from public.inbox_v2_timeline_content_revisions history_row
          where history_row.tenant_id = content_row.tenant_id
            and history_row.content_id = content_row.id
            and (
              (history_row.revision > 1 and not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions predecessor_row
                 where predecessor_row.tenant_id = history_row.tenant_id
                   and predecessor_row.content_id = history_row.content_id
                   and predecessor_row.revision = history_row.revision - 1
                   and history_row.expected_previous_revision =
                     predecessor_row.revision
                   and predecessor_row.state = 'available'
                   and predecessor_row.recorded_at <= history_row.recorded_at
                   and predecessor_row.occurred_at <= history_row.occurred_at
                   and predecessor_row.recorded_stream_position <
                     history_row.recorded_stream_position
              ))
              or (history_row.transition_kind in (
                    'created', 'edit', 'attachment_materialization'
                  ) and history_row.state <> 'available')
              or (history_row.transition_kind in (
                    'edit', 'attachment_materialization'
                  ) and history_row.event_id is null)
              or (history_row.transition_kind = 'privacy_erasure' and not (
                history_row.state = 'privacy_erased'
                and history_row.event_id is not null
                and history_row.reason_id is not null
                and history_row.retention_policy_id is null
                and history_row.retention_policy_version is null
                and history_row.retention_policy_revision is null
              ))
              or (history_row.transition_kind = 'retention_purge' and not (
                history_row.state = 'retention_purged'
                and history_row.event_id is not null
                and history_row.reason_id is null
                and history_row.retention_policy_id is not null
                and history_row.retention_policy_version is not null
                and history_row.retention_policy_revision is not null
              ))
              or (history_row.transition_kind in (
                    'created', 'edit', 'attachment_materialization'
                  ) and num_nonnulls(
                    history_row.reason_id,
                    history_row.retention_policy_id,
                    history_row.retention_policy_version,
                    history_row.retention_policy_revision
                  ) <> 0)
            )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_message_history_valid(
  checked_tenant_id text,
  checked_message_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_messages message_row
      join public.inbox_v2_message_revisions latest_row
        on latest_row.tenant_id = message_row.tenant_id
       and latest_row.message_id = message_row.id
       and latest_row.timeline_item_id = message_row.timeline_item_id
       and latest_row.message_revision = message_row.revision
       and latest_row.recorded_stream_position =
         message_row.last_changed_stream_position
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = message_row.tenant_id
       and timeline_row.id = message_row.timeline_item_id
       and timeline_row.conversation_id = message_row.conversation_id
       and timeline_row.subject_kind = 'message'
       and timeline_row.subject_id = message_row.id
       and timeline_row.revision = message_row.revision
       and timeline_row.last_changed_stream_position =
         message_row.last_changed_stream_position
       and timeline_row.updated_at = latest_row.recorded_at
      join lateral (
        select content_head_row.*
          from public.inbox_v2_message_revisions content_head_row
         where content_head_row.tenant_id = message_row.tenant_id
           and content_head_row.message_id = message_row.id
           and content_head_row.after_content_id is not null
         order by content_head_row.message_revision desc
         limit 1
      ) latest_content_row on true
      left join lateral (
        select lifecycle_head_row.*
          from public.inbox_v2_message_revisions lifecycle_head_row
         where lifecycle_head_row.tenant_id = message_row.tenant_id
           and lifecycle_head_row.message_id = message_row.id
           and lifecycle_head_row.change_kind in (
             'local_delete_tombstone',
             'provider_delete_policy_tombstone'
           )
         order by lifecycle_head_row.message_revision desc
         limit 1
      ) latest_lifecycle_row on true
      where message_row.tenant_id = checked_tenant_id
        and message_row.id = checked_message_id
        and timeline_row.created_at = message_row.created_at
        and message_row.updated_at = latest_row.recorded_at
       and (
         select count(*) = message_row.revision
            and min(history_row.message_revision) = 1
            and max(history_row.message_revision) = message_row.revision
           from public.inbox_v2_message_revisions history_row
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_message_revisions first_row
          where first_row.tenant_id = message_row.tenant_id
            and first_row.message_id = message_row.id
            and first_row.timeline_item_id = message_row.timeline_item_id
            and first_row.message_revision = 1
            and first_row.expected_previous_revision is null
            and first_row.change_kind = 'created'
            and first_row.before_content_id is null
            and first_row.before_content_revision is null
            and first_row.before_content_state is null
            and first_row.after_content_id is not null
            and first_row.after_content_revision = 1
            and first_row.after_content_state = 'available'
            and first_row.provider_operation_id is null
            and first_row.reason_id is null
            and first_row.action_attribution_id =
              message_row.creation_attribution_id
            and first_row.occurred_at = timeline_row.occurred_at
            and first_row.recorded_at = message_row.created_at
       )
       and not exists (
         select 1
           from public.inbox_v2_message_revisions history_row
           join public.inbox_v2_action_attributions attribution_row
             on attribution_row.tenant_id = history_row.tenant_id
            and attribution_row.id = history_row.action_attribution_id
            left join public.inbox_v2_message_revisions predecessor_row
              on predecessor_row.tenant_id = history_row.tenant_id
             and predecessor_row.message_id = history_row.message_id
             and predecessor_row.message_revision =
               history_row.message_revision - 1
            left join lateral (
              select content_predecessor_candidate_row.*
                from public.inbox_v2_message_revisions
                  content_predecessor_candidate_row
               where content_predecessor_candidate_row.tenant_id =
                       history_row.tenant_id
                 and content_predecessor_candidate_row.message_id =
                       history_row.message_id
                 and content_predecessor_candidate_row.message_revision <
                       history_row.message_revision
                 and content_predecessor_candidate_row.after_content_id is not null
               order by content_predecessor_candidate_row.message_revision desc
               limit 1
            ) content_predecessor_row on true
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
            and (
              history_row.timeline_item_id <> message_row.timeline_item_id
              or not public.inbox_v2_tm_action_attribution_valid(
                history_row.tenant_id,
                history_row.action_attribution_id,
                message_row.conversation_id,
                true
              )
              or attribution_row.created_at <> history_row.recorded_at
              or (history_row.message_revision > 1 and (
                predecessor_row.id is null
                or history_row.expected_previous_revision <>
                  predecessor_row.message_revision
                or predecessor_row.recorded_at > history_row.recorded_at
                or predecessor_row.recorded_stream_position >=
                  history_row.recorded_stream_position
              ))
              or (history_row.message_revision > 1 and exists (
                select 1
                  from public.inbox_v2_message_revisions terminal_row
                 where terminal_row.tenant_id = history_row.tenant_id
                   and terminal_row.message_id = history_row.message_id
                   and terminal_row.message_revision <
                     history_row.message_revision
                   and terminal_row.change_kind in (
                     'privacy_erasure_tombstone',
                     'retention_purge_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and exists (
                select 1
                  from public.inbox_v2_message_revisions lifecycle_row
                 where lifecycle_row.tenant_id = history_row.tenant_id
                   and lifecycle_row.message_id = history_row.message_id
                   and lifecycle_row.message_revision <
                     history_row.message_revision
                   and lifecycle_row.change_kind in (
                     'local_delete_tombstone',
                     'provider_delete_policy_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'privacy_erasure_tombstone',
                    'retention_purge_tombstone'
                  ) and not (
                history_row.before_content_id =
                  content_predecessor_row.after_content_id
                and history_row.before_content_revision =
                  content_predecessor_row.after_content_revision
                and history_row.before_content_state =
                  content_predecessor_row.after_content_state
                and history_row.before_content_state = 'available'
                and history_row.after_content_id =
                  history_row.before_content_id
                and history_row.after_content_revision =
                  history_row.before_content_revision + 1
                and history_row.after_content_state = case history_row.change_kind
                  when 'privacy_erasure_tombstone' then
                    'privacy_erased'::public.inbox_v2_timeline_content_state
                  when 'retention_purge_tombstone' then
                    'retention_purged'::public.inbox_v2_timeline_content_state
                  else 'available'::public.inbox_v2_timeline_content_state
                end
              ))
              or (history_row.change_kind in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and num_nonnulls(
                    history_row.before_content_id,
                    history_row.before_content_revision,
                    history_row.before_content_state,
                    history_row.after_content_id,
                    history_row.after_content_revision,
                    history_row.after_content_state
                  ) <> 0)
              or (history_row.after_content_id is not null and not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions content_revision_row
                 where content_revision_row.tenant_id = history_row.tenant_id
                   and content_revision_row.content_id =
                     history_row.after_content_id
                   and content_revision_row.revision =
                     history_row.after_content_revision
                    and content_revision_row.state =
                      history_row.after_content_state
                    and content_revision_row.recorded_stream_position =
                      history_row.recorded_stream_position
                    and content_revision_row.recorded_at = history_row.recorded_at
                    and content_revision_row.transition_kind =
                     case history_row.change_kind
                       when 'created' then
                         'created'::public.inbox_v2_timeline_content_transition_kind
                       when 'edited' then
                         'edit'::public.inbox_v2_timeline_content_transition_kind
                       when 'attachment_materialized' then
                         'attachment_materialization'::public.inbox_v2_timeline_content_transition_kind
                       when 'privacy_erasure_tombstone' then
                         'privacy_erasure'::public.inbox_v2_timeline_content_transition_kind
                       when 'retention_purge_tombstone' then
                         'retention_purge'::public.inbox_v2_timeline_content_transition_kind
                     end
              ))
              or (history_row.change_kind = 'local_delete_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is null
              ))
              or (history_row.change_kind =
                    'provider_delete_policy_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is not null
              ))
              or (history_row.change_kind not in (
                    'edited', 'provider_delete_policy_tombstone'
                  ) and history_row.provider_operation_id is not null)
              or (history_row.change_kind not in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  )
                and history_row.reason_id is not null)
              or (history_row.change_kind = 'edited' and (
                (message_row.origin_kind in (
                    'source_originated', 'hulee_external'
                  )) <> (history_row.provider_operation_id is not null)
              ))
              or (history_row.change_kind in (
                    'attachment_materialized',
                    'privacy_erasure_tombstone',
                  'retention_purge_tombstone'
                  ) and attribution_row.app_actor_kind is distinct from
                    'trusted_service')
              or (history_row.change_kind = 'local_delete_tombstone'
                and attribution_row.app_actor_kind is null)
              or (history_row.change_kind = 'edited'
                and message_row.origin_kind in ('internal', 'migration')
                and attribution_row.app_actor_kind is null)
              or (history_row.message_revision > 1
                and attribution_row.source_occurrence_id is not null
                and history_row.provider_operation_id is null)
              or (history_row.provider_operation_id is not null and not exists (
                select 1
                  from public.inbox_v2_message_provider_lifecycle_operations op_row
                 where op_row.tenant_id = history_row.tenant_id
                   and op_row.id = history_row.provider_operation_id
                   and op_row.message_id = history_row.message_id
                   and op_row.action = case history_row.change_kind
                     when 'edited' then
                       'edit'::public.inbox_v2_provider_lifecycle_action
                     when 'provider_delete_policy_tombstone' then
                       'delete'::public.inbox_v2_provider_lifecycle_action
                   end
                   and (
                     history_row.change_kind = 'edited'
                     or (
                       op_row.delete_local_effect = 'tombstone_local'
                       and op_row.policy_decided_at <= history_row.recorded_at
                     )
                   )
                   and (
                     (op_row.origin = 'provider_observed'
                       and op_row.action_attribution_id is null
                       and attribution_row.app_actor_kind is null
                       and attribution_row.source_occurrence_id =
                         op_row.source_occurrence_id
                       and attribution_row.automation_kind is null)
                      or (op_row.origin = 'hulee_requested'
                        and attribution_row.app_actor_kind is not null
                        and attribution_row.source_occurrence_id is null
                        and exists (
                          select 1
                            from public.inbox_v2_action_attributions
                              operation_attribution_row
                           where operation_attribution_row.tenant_id =
                                   op_row.tenant_id
                             and operation_attribution_row.id =
                                   op_row.action_attribution_id
                             and operation_attribution_row.action_participant_id
                                   is not distinct from
                                   attribution_row.action_participant_id
                             and operation_attribution_row.app_actor_kind
                                   is not distinct from
                                   attribution_row.app_actor_kind
                             and operation_attribution_row.app_actor_employee_id
                                   is not distinct from
                                   attribution_row.app_actor_employee_id
                             and operation_attribution_row.app_authorization_epoch
                                   is not distinct from
                                   attribution_row.app_authorization_epoch
                             and operation_attribution_row.app_trusted_service_id
                                   is not distinct from
                                   attribution_row.app_trusted_service_id
                             and operation_attribution_row.source_occurrence_id
                                   is not distinct from
                                   attribution_row.source_occurrence_id
                             and operation_attribution_row.automation_kind
                                   is not distinct from
                                   attribution_row.automation_kind
                             and operation_attribution_row.automation_cause_event_id
                                   is not distinct from
                                   attribution_row.automation_cause_event_id
                             and operation_attribution_row.automation_correlation_id
                                   is not distinct from
                                   attribution_row.automation_correlation_id
                             and operation_attribution_row.automation_caused_at
                                   is not distinct from
                                   attribution_row.automation_caused_at
                             and operation_attribution_row
                                   .automation_initiating_employee_id
                                   is not distinct from
                                   attribution_row.automation_initiating_employee_id
                             and operation_attribution_row
                                   .automation_initiating_authorization_epoch
                                   is not distinct from
                                   attribution_row
                                     .automation_initiating_authorization_epoch
                        ))
                   )
              ))
            )
       )
       and message_row.content_id = latest_content_row.after_content_id
       and message_row.content_revision = latest_content_row.after_content_revision
       and message_row.content_state = latest_content_row.after_content_state
       and (
         (latest_lifecycle_row.change_kind = 'local_delete_tombstone'
           and message_row.lifecycle = 'local_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_reason_id = latest_lifecycle_row.reason_id
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at = latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.change_kind =
               'provider_delete_policy_tombstone'
           and message_row.lifecycle = 'provider_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_provider_operation_id =
             latest_lifecycle_row.provider_operation_id
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_policy_reason_id =
             latest_lifecycle_row.reason_id
           and message_row.lifecycle_changed_at =
             latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.id is null
           and message_row.lifecycle = 'active'
           and message_row.lifecycle_revision_id is null
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at is null)
       )
  );
$function$;

create or replace function public.inbox_v2_tm_staff_note_history_valid(
  checked_tenant_id text,
  checked_staff_note_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_staff_notes note_row
      join public.inbox_v2_staff_note_revisions latest_row
        on latest_row.tenant_id = note_row.tenant_id
       and latest_row.staff_note_id = note_row.id
       and latest_row.timeline_item_id = note_row.timeline_item_id
       and latest_row.staff_note_revision = note_row.revision
       and latest_row.recorded_stream_position =
         note_row.last_changed_stream_position
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = note_row.tenant_id
       and timeline_row.id = note_row.timeline_item_id
       and timeline_row.conversation_id = note_row.conversation_id
       and timeline_row.subject_kind = 'staff_note'
       and timeline_row.subject_id = note_row.id
       and timeline_row.revision = note_row.revision
       and timeline_row.last_changed_stream_position =
         note_row.last_changed_stream_position
       and timeline_row.updated_at = latest_row.recorded_at
      join public.inbox_v2_action_attributions creation_attribution_row
        on creation_attribution_row.tenant_id = note_row.tenant_id
       and creation_attribution_row.id = note_row.creation_attribution_id
       and creation_attribution_row.conversation_id = note_row.conversation_id
      where note_row.tenant_id = checked_tenant_id
        and note_row.id = checked_staff_note_id
        and timeline_row.created_at = note_row.created_at
        and note_row.updated_at = latest_row.recorded_at
       and note_row.content_id = latest_row.after_content_id
       and note_row.content_revision = latest_row.after_content_revision
       and note_row.content_state = latest_row.after_content_state
       and (
         select count(*) = note_row.revision
            and min(history_row.staff_note_revision) = 1
            and max(history_row.staff_note_revision) = note_row.revision
           from public.inbox_v2_staff_note_revisions history_row
          where history_row.tenant_id = note_row.tenant_id
            and history_row.staff_note_id = note_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_staff_note_revisions first_row
           join public.inbox_v2_action_attributions creation_attribution_row
             on creation_attribution_row.tenant_id = first_row.tenant_id
            and creation_attribution_row.id = first_row.action_attribution_id
            and creation_attribution_row.conversation_id = note_row.conversation_id
          where first_row.tenant_id = note_row.tenant_id
            and first_row.staff_note_id = note_row.id
            and first_row.timeline_item_id = note_row.timeline_item_id
            and first_row.staff_note_revision = 1
            and first_row.expected_previous_revision is null
            and first_row.change_kind = 'created'
            and first_row.before_content_id is null
            and first_row.before_content_revision is null
            and first_row.before_content_state is null
            and first_row.after_content_id = note_row.content_id
            and first_row.after_content_revision = 1
            and first_row.after_content_state = 'available'
            and first_row.action_attribution_id = note_row.creation_attribution_id
            and creation_attribution_row.action_participant_id =
              note_row.author_participant_id
            and first_row.occurred_at = timeline_row.occurred_at
            and first_row.recorded_at = note_row.created_at
       )
       and not exists (
         select 1
           from public.inbox_v2_staff_note_revisions history_row
           join public.inbox_v2_action_attributions attribution_row
             on attribution_row.tenant_id = history_row.tenant_id
            and attribution_row.id = history_row.action_attribution_id
           left join public.inbox_v2_staff_note_revisions predecessor_row
             on predecessor_row.tenant_id = history_row.tenant_id
            and predecessor_row.staff_note_id = history_row.staff_note_id
            and predecessor_row.staff_note_revision =
              history_row.staff_note_revision - 1
          where history_row.tenant_id = note_row.tenant_id
            and history_row.staff_note_id = note_row.id
            and (
              history_row.timeline_item_id <> note_row.timeline_item_id
              or not public.inbox_v2_tm_action_attribution_valid(
                history_row.tenant_id,
                history_row.action_attribution_id,
                note_row.conversation_id,
                false
              )
              or attribution_row.created_at <> history_row.recorded_at
              or (history_row.staff_note_revision > 1 and (
                predecessor_row.id is null
                or history_row.expected_previous_revision <>
                  predecessor_row.staff_note_revision
                or predecessor_row.after_content_state <> 'available'
                or predecessor_row.recorded_at > history_row.recorded_at
                or predecessor_row.recorded_at > history_row.occurred_at
                or predecessor_row.recorded_stream_position >=
                  history_row.recorded_stream_position
                or history_row.before_content_id <>
                  predecessor_row.after_content_id
                or history_row.before_content_revision <>
                  predecessor_row.after_content_revision
                or history_row.before_content_state <>
                  predecessor_row.after_content_state
              ))
              or (history_row.change_kind <> 'created' and not (
                history_row.before_content_state = 'available'
                and history_row.after_content_id =
                  history_row.before_content_id
                and history_row.after_content_revision =
                  history_row.before_content_revision + 1
                and history_row.after_content_revision =
                  history_row.staff_note_revision
                and history_row.after_content_state = case history_row.change_kind
                  when 'privacy_erasure_tombstone' then
                    'privacy_erased'::public.inbox_v2_timeline_content_state
                  when 'retention_purge_tombstone' then
                    'retention_purged'::public.inbox_v2_timeline_content_state
                  else 'available'::public.inbox_v2_timeline_content_state
                end
              ))
              or not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions content_revision_row
                 where content_revision_row.tenant_id = history_row.tenant_id
                   and content_revision_row.content_id =
                     history_row.after_content_id
                   and content_revision_row.revision =
                     history_row.after_content_revision
                    and content_revision_row.state =
                      history_row.after_content_state
                    and content_revision_row.recorded_stream_position =
                      history_row.recorded_stream_position
                    and content_revision_row.recorded_at = history_row.recorded_at
                    and (
                      history_row.staff_note_revision = 1
                      or content_revision_row.occurred_at =
                        history_row.recorded_at
                    )
                    and content_revision_row.transition_kind =
                      case history_row.change_kind
                        when 'created' then
                          'created'::public.inbox_v2_timeline_content_transition_kind
                        when 'edited' then
                         'edit'::public.inbox_v2_timeline_content_transition_kind
                       when 'attachment_materialized' then
                         'attachment_materialization'::public.inbox_v2_timeline_content_transition_kind
                       when 'privacy_erasure_tombstone' then
                         'privacy_erasure'::public.inbox_v2_timeline_content_transition_kind
                       when 'retention_purge_tombstone' then
                         'retention_purge'::public.inbox_v2_timeline_content_transition_kind
                     end
              )
              or (history_row.change_kind not in ('created', 'edited')
                and attribution_row.app_actor_kind is distinct from
                  'trusted_service')
              or (attribution_row.app_actor_kind = 'trusted_service'
                and attribution_row.action_participant_id is not null
                and not (
                  attribution_row.action_participant_id =
                    note_row.author_participant_id
                  and creation_attribution_row.app_actor_kind =
                    'trusted_service'
                  and creation_attribution_row.app_trusted_service_id =
                    attribution_row.app_trusted_service_id
                ))
            )
       )
  );
$function$;

create or replace function public.inbox_v2_tm_aux_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  message_key text;
  operation_key text;
  reaction_key text;
  receipt_key text;
  commit_token_key text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name in (
    'inbox_v2_message_transport_fact_commits',
    'inbox_v2_message_delivery_observations',
    'inbox_v2_provider_receipt_observations'
  ) then
    commit_token_key := changed_row->>'commit_token';

    if exists (
      select 1 from public.inbox_v2_message_transport_fact_commits ledger_row
       where ledger_row.tenant_id = tenant_key
         and ledger_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_message_delivery_observations delivery_row
       where delivery_row.tenant_id = tenant_key
         and delivery_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.commit_token = commit_token_key
    ) then
      if not exists (
        select 1
          from public.inbox_v2_message_transport_fact_commits ledger_row
         where ledger_row.tenant_id = tenant_key
           and ledger_row.commit_token = commit_token_key
           and (
             (ledger_row.fact_kind = 'delivery'
               and exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
                    and delivery_row.id = ledger_row.observation_id
                    and delivery_row.message_id = ledger_row.message_id
                    and delivery_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and delivery_row.observed_at = ledger_row.observed_at
                    and delivery_row.recorded_at = ledger_row.recorded_at
                    and delivery_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and delivery_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
               ))
             or (ledger_row.fact_kind = 'receipt'
               and exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
                    and receipt_row.id = ledger_row.observation_id
                    and receipt_row.target_message_id is not distinct from
                      ledger_row.message_id
                    and receipt_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and receipt_row.observed_at = ledger_row.observed_at
                    and receipt_row.recorded_at = ledger_row.recorded_at
                    and receipt_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and receipt_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
               ))
           )
      ) then
        raise exception using errcode = '23514',
          message = 'inbox_v2.message_transport_fact_commit_coherence';
      end if;
    end if;
  end if;

  if tg_table_name = 'inbox_v2_outbound_route_consumptions'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_outbound_route_consumptions consumption_row
        join public.inbox_v2_outbound_routes route_row
          on route_row.tenant_id = consumption_row.tenant_id
         and route_row.id = consumption_row.outbound_route_id
         and route_row.mutation_token = consumption_row.mutation_token
         and route_row.idempotency_token = consumption_row.idempotency_token
         and route_row.correlation_token = consumption_row.correlation_token
         and route_row.adapter_loaded_by_trusted_service_id =
           consumption_row.consumed_by_trusted_service_id
        join public.inbox_v2_messages message_row
          on message_row.tenant_id = consumption_row.tenant_id
         and message_row.id = consumption_row.message_id
         and message_row.conversation_id = route_row.conversation_id
       where consumption_row.tenant_id = tenant_key
         and consumption_row.id = changed_row->>'id'
         and (
           (consumption_row.consumer_kind = 'message_creation'
             and consumption_row.consumer_id = message_row.id
             and message_row.origin_kind = 'hulee_external'
             and message_row.origin_outbound_route_id = route_row.id
             and message_row.created_at = consumption_row.consumed_at)
           or (consumption_row.consumer_kind = 'provider_lifecycle'
             and exists (
               select 1
                 from public.inbox_v2_message_provider_lifecycle_operations op_row
                where op_row.tenant_id = consumption_row.tenant_id
                  and op_row.id = consumption_row.consumer_id
                  and op_row.message_id = consumption_row.message_id
                  and op_row.origin = 'hulee_requested'
                  and op_row.outbound_route_id = route_row.id
                  and op_row.recorded_at = consumption_row.consumed_at
             ))
           or (consumption_row.consumer_kind = 'reaction'
             and exists (
               select 1
                 from public.inbox_v2_message_reaction_transitions transition_row
                 join public.inbox_v2_message_reactions reaction_row
                   on reaction_row.tenant_id = transition_row.tenant_id
                  and reaction_row.id = transition_row.reaction_id
                where transition_row.tenant_id = consumption_row.tenant_id
                  and transition_row.id = consumption_row.consumer_id
                  and transition_row.mode = 'external_request'
                  and transition_row.outbound_route_id = route_row.id
                  and transition_row.recorded_at = consumption_row.consumed_at
                  and reaction_row.message_id = consumption_row.message_id
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_route_consumption_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_message_transport_links' then
    message_key := changed_row->>'message_id';
    if tg_op <> 'DELETE' and not public.inbox_v2_tm_transport_occurrence_link_valid(
      tenant_key,
      changed_row->>'id'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.transport_occurrence_link_invalid';
    end if;
  elsif tg_table_name = 'inbox_v2_message_transport_link_heads' then
    message_key := changed_row->>'message_id';
  end if;

  if message_key is not null and (
    exists (
      select 1 from public.inbox_v2_message_transport_links
       where tenant_id = tenant_key and message_id = message_key
    ) or exists (
      select 1 from public.inbox_v2_message_transport_link_heads
       where tenant_id = tenant_key and message_id = message_key
    )
  ) and not exists (
    select 1
      from public.inbox_v2_message_transport_link_heads head_row
      join public.inbox_v2_message_transport_links latest_row
        on latest_row.tenant_id = head_row.tenant_id
       and latest_row.id = head_row.latest_link_id
       and latest_row.message_id = head_row.message_id
       and latest_row.resulting_head_revision = head_row.revision
       and latest_row.recorded_stream_position =
         head_row.last_changed_stream_position
       and latest_row.linked_at = head_row.updated_at
     where head_row.tenant_id = tenant_key
       and head_row.message_id = message_key
       and head_row.link_count = (
         select count(*)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = head_row.link_count
       and 1 = (
         select min(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = (
         select max(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and latest_row.id = (
         select link_row.id
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
          order by link_row.resulting_head_revision desc
          limit 1
       )
       and not exists (
         select 1
           from public.inbox_v2_message_transport_links chain_row
          where chain_row.tenant_id = head_row.tenant_id
            and chain_row.message_id = head_row.message_id
            and chain_row.resulting_head_revision > 1
            and not exists (
              select 1
                from public.inbox_v2_message_transport_links predecessor_row
               where predecessor_row.tenant_id = chain_row.tenant_id
                 and predecessor_row.message_id = chain_row.message_id
                 and predecessor_row.resulting_head_revision =
                   chain_row.resulting_head_revision - 1
                 and predecessor_row.linked_at <= chain_row.linked_at
                 and predecessor_row.recorded_stream_position <
                   chain_row.recorded_stream_position
            )
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.transport_link_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_provider_lifecycle_operations' then
    operation_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_message_provider_lifecycle_transitions' then
    operation_key := changed_row->>'operation_id';
  end if;

  if operation_key is not null and exists (
    select 1 from public.inbox_v2_message_provider_lifecycle_operations
     where tenant_id = tenant_key and id = operation_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_provider_lifecycle_operations op_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = op_row.tenant_id
       and message_row.id = op_row.message_id
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = op_row.tenant_id
       and occurrence_row.id = op_row.source_occurrence_id
       and occurrence_row.source_account_id = op_row.source_account_id
       and occurrence_row.source_thread_binding_id = op_row.source_thread_binding_id
       and occurrence_row.binding_generation = op_row.binding_generation
       and occurrence_row.adapter_contract_id = op_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         op_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         op_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = op_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         op_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = op_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         op_row.external_message_reference_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = op_row.tenant_id
       and reference_row.id = op_row.external_message_reference_id
       and reference_row.message_id = op_row.message_id
     where op_row.tenant_id = tenant_key
       and op_row.id = operation_key
       and public.inbox_v2_tm_provider_lifecycle_history_valid(
         op_row.tenant_id,
         op_row.id
       )
       and (
         (op_row.origin = 'provider_observed' and op_row.outbound_route_id is null)
         or (op_row.origin = 'hulee_requested'
           and public.inbox_v2_tm_outbound_route_action_valid(
             op_row.tenant_id,
             op_row.outbound_route_id,
             op_row.message_id,
             op_row.message_id,
             message_row.conversation_id,
             op_row.recorded_at,
             op_row.recorded_at,
             'core:message.' || op_row.action::text,
             'core:message.' || op_row.action::text || '_external',
             op_row.external_message_reference_id,
             op_row.source_occurrence_id,
             op_row.source_account_id,
             op_row.source_thread_binding_id,
             op_row.binding_generation,
             op_row.adapter_contract_id,
             op_row.adapter_contract_version,
             op_row.adapter_declaration_revision,
             op_row.adapter_surface_id,
             op_row.adapter_loaded_by_trusted_service_id,
             op_row.adapter_loaded_at,
             'core:message-' || op_row.action::text,
             op_row.capability_revision,
             op_row.action_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_route_consumptions consumption_row
              where consumption_row.tenant_id = op_row.tenant_id
                and consumption_row.consumer_kind = 'provider_lifecycle'
                and consumption_row.consumer_id = op_row.id
                and consumption_row.message_id = op_row.message_id
                and consumption_row.outbound_route_id = op_row.outbound_route_id
           ))
       )
       and (
         op_row.origin <> 'provider_observed'
         or (
           occurrence_row.normalized_inbound_event_id =
             op_row.provider_semantic_normalized_inbound_event_id
           and occurrence_row.provider_actor_source_external_identity_id
             is not distinct from
               op_row.provider_semantic_actor_external_identity_id
           and op_row.provider_semantic_capability_revision =
             occurrence_row.capability_revision
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractId}' = op_row.adapter_contract_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractVersion}' =
               op_row.adapter_contract_version
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,declarationRevision}' =
               op_row.adapter_declaration_revision::text
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,surfaceId}' = op_row.adapter_surface_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedByTrustedServiceId}' =
               op_row.adapter_loaded_by_trusted_service_id
           and (op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedAt}')::timestamptz =
               op_row.adapter_loaded_at
           and (op_row.provider_semantic_proof_detail #>> '{occurredAt}')::timestamptz =
             op_row.occurred_at
           and (op_row.provider_semantic_proof_detail #>> '{recordedAt}')::timestamptz =
             op_row.recorded_at
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_provider_lifecycle_transitions chain_row
          where chain_row.tenant_id = op_row.tenant_id
            and chain_row.operation_id = op_row.id
            and (
              chain_row.resulting_revision > op_row.revision
              or (
                chain_row.expected_revision > 1
                and not exists (
                  select 1
                    from public.inbox_v2_message_provider_lifecycle_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.operation_id = chain_row.operation_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                )
              )
            )
       )
       and (
         (op_row.revision = 1 and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
         ))
         or (op_row.revision > 1 and exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
              and transition_row.resulting_revision = op_row.revision
              and transition_row.outcome = op_row.outcome
              and transition_row.outcome_retryable is not distinct from
                op_row.outcome_retryable
              and transition_row.outcome_reason_id is not distinct from
                op_row.outcome_reason_id
              and transition_row.delete_local_effect is not distinct from
                op_row.delete_local_effect
              and transition_row.policy_decision_event_id is not distinct from
                op_row.policy_decision_event_id
              and transition_row.policy_decision_revision is not distinct from
                op_row.policy_decision_revision
              and transition_row.policy_decided_at is not distinct from
                op_row.policy_decided_at
              and transition_row.recorded_at = op_row.updated_at
              and transition_row.recorded_stream_position =
                op_row.last_changed_stream_position
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_lifecycle_operation_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_reactions' then
    reaction_key := changed_row->>'id';
  elsif tg_table_name in (
    'inbox_v2_message_reaction_transitions',
    'inbox_v2_message_reaction_slot_heads'
  ) then
    reaction_key := changed_row->>'reaction_id';
  elsif tg_table_name = 'inbox_v2_message_provider_reaction_observations' then
    select transition_row.reaction_id into reaction_key
      from public.inbox_v2_message_reaction_transitions transition_row
     where transition_row.tenant_id = tenant_key
       and transition_row.id = changed_row->>'transition_id';
  end if;

  if tg_table_name = 'inbox_v2_message_reaction_transitions'
     and tg_op <> 'DELETE'
     and exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
          and transition_row.mode = 'external_request'
     )
     and not exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
         join public.inbox_v2_message_reactions reaction_row
           on reaction_row.tenant_id = transition_row.tenant_id
          and reaction_row.id = transition_row.reaction_id
         join public.inbox_v2_outbound_route_consumptions consumption_row
           on consumption_row.tenant_id = transition_row.tenant_id
          and consumption_row.consumer_kind = 'reaction'
          and consumption_row.consumer_id = transition_row.id
          and consumption_row.message_id = reaction_row.message_id
          and consumption_row.outbound_route_id = transition_row.outbound_route_id
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.reaction_route_consumption_missing';
  end if;

  if reaction_key is not null and exists (
    select 1 from public.inbox_v2_message_reactions
     where tenant_id = tenant_key and id = reaction_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_reactions reaction_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = reaction_row.tenant_id
       and message_row.id = reaction_row.message_id
      join public.inbox_v2_message_reaction_slot_heads slot_row
        on slot_row.tenant_id = reaction_row.tenant_id
       and slot_row.message_id = reaction_row.message_id
       and slot_row.semantic_slot_key = reaction_row.semantic_slot_key
       and slot_row.reaction_id = reaction_row.id
       and slot_row.state_kind = reaction_row.state_kind
       and slot_row.revision = reaction_row.revision
     where reaction_row.tenant_id = tenant_key
       and reaction_row.id = reaction_key
       and (
         reaction_row.actor_participant_id is null or exists (
           select 1 from public.inbox_v2_conversation_participants participant_row
            where participant_row.tenant_id = reaction_row.tenant_id
              and participant_row.id = reaction_row.actor_participant_id
              and participant_row.conversation_id = message_row.conversation_id
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_reaction_transitions chain_row
          where chain_row.tenant_id = reaction_row.tenant_id
            and chain_row.reaction_id = reaction_row.id
            and (
             chain_row.resulting_revision > reaction_row.revision
             or ((chain_row.mode = 'provider_observed') <>
               exists (
                 select 1
                   from public.inbox_v2_message_provider_reaction_observations
                     observation_row
                  where observation_row.tenant_id = chain_row.tenant_id
                    and observation_row.transition_id = chain_row.id
               ))
              or (
               chain_row.expected_revision is null
               and chain_row.recorded_at <> reaction_row.created_at
             )
             or (
               chain_row.expected_revision is not null
                and not exists (
                  select 1
                    from public.inbox_v2_message_reaction_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.reaction_id = chain_row.reaction_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                     and predecessor_row.after_state_kind =
                       chain_row.before_state_kind
                     and predecessor_row.after_state_detail =
                       chain_row.before_state_detail
                      and predecessor_row.after_state_detail_digest_sha256 =
                        chain_row.before_state_detail_digest_sha256
                      and predecessor_row.recorded_at <= chain_row.recorded_at
                      and predecessor_row.recorded_stream_position <
                        chain_row.recorded_stream_position
                 )
              )
            )
       )
       and exists (
         select 1 from public.inbox_v2_message_reaction_transitions transition_row
          where transition_row.tenant_id = reaction_row.tenant_id
            and transition_row.reaction_id = reaction_row.id
            and transition_row.semantic_slot_key = reaction_row.semantic_slot_key
            and transition_row.resulting_revision = reaction_row.revision
            and transition_row.after_state_kind = reaction_row.state_kind
            and transition_row.value_kind = reaction_row.value_kind
            and transition_row.unicode_value is not distinct from
              reaction_row.unicode_value
            and transition_row.provider_reaction_kind_id is not distinct from
              reaction_row.provider_reaction_kind_id
            and transition_row.provider_canonical_code is not distinct from
              reaction_row.provider_canonical_code
            and transition_row.after_state_detail = reaction_row.state_detail
            and transition_row.after_state_detail_digest_sha256 =
              reaction_row.state_detail_digest_sha256
            and transition_row.recorded_at = reaction_row.updated_at
            and transition_row.result_token is not distinct from
              reaction_row.result_token
            and transition_row.result_digest_sha256 is not distinct from
              reaction_row.result_digest_sha256
            and (
              reaction_row.state_kind = 'active'
              or (
                reaction_row.state_kind = 'cleared'
                and (reaction_row.state_detail #>>
                  '{clearedAt}')::timestamptz = reaction_row.cleared_at
              )
              or (
                reaction_row.state_kind = 'pending_external'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.request_transition_id = transition_row.id
                and reaction_row.request_attribution_id =
                  transition_row.action_attribution_id
                and (reaction_row.state_detail #>>
                  '{requestedAt}')::timestamptz = reaction_row.updated_at
              )
              or (
                reaction_row.state_kind = 'external_terminal'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.state_detail #>> '{outcome}' =
                  reaction_row.external_outcome
                and reaction_row.state_detail #>> '{resultToken}' =
                  reaction_row.result_token
                and reaction_row.state_detail #>> '{resultDigestSha256}' =
                  reaction_row.result_digest_sha256
                and (reaction_row.state_detail #>>
                  '{resolvedAt}')::timestamptz = reaction_row.resolved_at
              )
            )
            and transition_row.recorded_stream_position =
              reaction_row.last_changed_stream_position
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reaction_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_delivery_observations'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_message_delivery_observations observation_row
       where observation_row.tenant_id = tenant_key
         and observation_row.id = changed_row->>'id'
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
            where snapshot_row.tenant_id = observation_row.tenant_id
              and snapshot_row.binding_id =
                observation_row.source_thread_binding_id
              and snapshot_row.source_account_id =
                observation_row.source_account_id
              and snapshot_row.binding_generation =
                observation_row.binding_generation
              and snapshot_row.capability_contract_id =
                observation_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                observation_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                observation_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                observation_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                observation_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at =
                observation_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                observation_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id =
                     observation_row.capability_id
              )
         )
         and (
           (observation_row.scope_kind = 'dispatch' and exists (
             select 1
               from public.inbox_v2_outbound_dispatches dispatch_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = dispatch_row.tenant_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.dispatch_id = dispatch_row.id
                and attempt_row.route_id = dispatch_row.route_id
                and attempt_row.message_id = dispatch_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = dispatch_row.tenant_id
                and route_row.id = dispatch_row.route_id
               join public.inbox_v2_messages message_row
                 on message_row.tenant_id = dispatch_row.tenant_id
                and message_row.id = dispatch_row.message_id
               where dispatch_row.tenant_id = observation_row.tenant_id
                 and dispatch_row.id = observation_row.scope_dispatch_id
                 and dispatch_row.message_id = observation_row.message_id
                 and dispatch_row.state <> 'queued'
                 and dispatch_row.last_attempt_id = attempt_row.id
                 and dispatch_row.attempt_count >= attempt_row.attempt_number
                 and message_row.origin_kind = 'hulee_external'
                 and message_row.origin_outbound_route_id = route_row.id
                 and route_row.source_account_id = observation_row.source_account_id
                 and route_row.source_thread_binding_id =
                   observation_row.source_thread_binding_id
                 and route_row.binding_generation =
                   observation_row.binding_generation
                 and route_row.adapter_contract_id =
                   observation_row.adapter_contract_id
                 and route_row.adapter_contract_version =
                   observation_row.adapter_contract_version
                 and route_row.adapter_declaration_revision =
                   observation_row.adapter_declaration_revision
                 and route_row.adapter_surface_id = observation_row.adapter_surface_id
                 and route_row.adapter_loaded_by_trusted_service_id =
                   observation_row.adapter_loaded_by_trusted_service_id
                 and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   observation_row.scope_artifact_id is null
                   or exists (
                    select 1
                      from public.inbox_v2_outbound_dispatch_artifacts artifact_row
                     where artifact_row.tenant_id = dispatch_row.tenant_id
                       and artifact_row.id = observation_row.scope_artifact_id
                       and artifact_row.dispatch_id = dispatch_row.id
                       and artifact_row.route_id = dispatch_row.route_id
                       and artifact_row.message_id = dispatch_row.message_id
                       and artifact_row.attempt_id =
                         observation_row.scope_attempt_id
                  )
                 )
            ))
            or (observation_row.scope_kind = 'external_reference' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = reference_row.tenant_id
                 and occurrence_row.id = observation_row.scope_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.resolved_external_message_reference_id =
                   reference_row.id
                 and occurrence_row.external_thread_id =
                   reference_row.external_thread_id
                 and occurrence_row.conversation_id = reference_row.conversation_id
                 and occurrence_row.message_key_digest_sha256 =
                   reference_row.message_key_digest_sha256
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
            or (observation_row.scope_kind = 'recipient' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
          )
         and (
           (observation_row.evidence_kind = 'provider_result' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_attempts attempt_row
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where attempt_row.tenant_id = observation_row.tenant_id
                and attempt_row.id = observation_row.evidence_attempt_id
                and attempt_row.dispatch_id = observation_row.scope_dispatch_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and attempt_row.completion_source = 'provider_result'
                 and (
                   (observation_row.fact = 'accepted'
                     and attempt_row.outcome_kind = 'accepted')
                   or (observation_row.fact = 'failed'
                     and attempt_row.outcome_kind in (
                       'retryable_failure', 'terminal_failure'
                     ))
                 )
            ))
           or (observation_row.evidence_kind = 'provider_artifact' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_artifacts artifact_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = artifact_row.tenant_id
                and attempt_row.id = artifact_row.attempt_id
                and attempt_row.dispatch_id = artifact_row.dispatch_id
                and attempt_row.route_id = artifact_row.route_id
                and attempt_row.message_id = artifact_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where artifact_row.tenant_id = observation_row.tenant_id
                and artifact_row.id = observation_row.evidence_artifact_id
                and artifact_row.id = observation_row.scope_artifact_id
                and artifact_row.attempt_id = observation_row.evidence_attempt_id
                and artifact_row.attempt_id = observation_row.scope_attempt_id
                and artifact_row.dispatch_id = observation_row.scope_dispatch_id
                and artifact_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   (observation_row.fact = 'accepted'
                     and artifact_row.state = 'accepted')
                   or (observation_row.fact = 'failed'
                     and artifact_row.state = 'failed')
                 )
            ))
           or (observation_row.evidence_kind = 'provider_event' and exists (
               select 1
                 from public.inbox_v2_source_occurrences occurrence_row
                 join public.inbox_v2_external_message_references reference_row
                   on reference_row.tenant_id = occurrence_row.tenant_id
                   and reference_row.id =
                     observation_row.evidence_external_message_reference_id
                   and reference_row.message_id = observation_row.message_id
                   and reference_row.external_thread_id =
                     occurrence_row.external_thread_id
                   and reference_row.conversation_id = occurrence_row.conversation_id
                   and reference_row.message_key_digest_sha256 =
                     occurrence_row.message_key_digest_sha256
                 where occurrence_row.tenant_id = observation_row.tenant_id
                  and occurrence_row.id =
                    observation_row.evidence_source_occurrence_id
                  and occurrence_row.normalized_inbound_event_id =
                    observation_row.evidence_normalized_inbound_event_id
                  and occurrence_row.source_account_id =
                    observation_row.source_account_id
                  and occurrence_row.source_thread_binding_id =
                    observation_row.source_thread_binding_id
                  and occurrence_row.binding_generation =
                    observation_row.binding_generation
                  and occurrence_row.adapter_contract_id =
                    observation_row.adapter_contract_id
                  and occurrence_row.adapter_contract_version =
                    observation_row.adapter_contract_version
                  and occurrence_row.adapter_declaration_revision =
                    observation_row.adapter_declaration_revision
                  and occurrence_row.adapter_surface_id =
                    observation_row.adapter_surface_id
                  and occurrence_row.adapter_loaded_by_trusted_service_id =
                    observation_row.adapter_loaded_by_trusted_service_id
                  and occurrence_row.adapter_loaded_at =
                    observation_row.adapter_loaded_at
                   and occurrence_row.capability_revision =
                     observation_row.capability_revision
                   and occurrence_row.resolution_state = 'resolved'
                   and occurrence_row.resolved_external_message_reference_id =
                     observation_row.evidence_external_message_reference_id
                   and occurrence_row.origin_kind <> 'provider_response'
                   and (
                     observation_row.scope_kind <> 'dispatch'
                     or (
                       occurrence_row.origin_kind = 'provider_echo'
                       and occurrence_row.direction = 'outbound'
                     )
                   )
                   and (
                     observation_row.scope_kind = 'dispatch'
                     or (observation_row.scope_kind = 'external_reference'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id
                       and observation_row.scope_source_occurrence_id =
                         occurrence_row.id)
                     or (observation_row.scope_kind = 'recipient'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id)
                   )
              ))
         )
         and (
           (observation_row.evidence_kind <> 'provider_event'
             and observation_row.semantic_proof_detail is null
             and observation_row.semantic_proof_digest_sha256 is null)
           or (observation_row.evidence_kind = 'provider_event'
             and observation_row.semantic_proof_digest_sha256 is not null
             and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
               observation_row.semantic_proof_detail,
               observation_row.tenant_id,
               observation_row.evidence_normalized_inbound_event_id,
               observation_row.evidence_external_message_reference_id,
               observation_row.evidence_source_occurrence_id,
               observation_row.source_account_id,
               observation_row.source_thread_binding_id,
               observation_row.binding_generation,
               observation_row.adapter_contract_id,
               observation_row.adapter_contract_version,
               observation_row.adapter_declaration_revision,
               observation_row.adapter_surface_id,
               observation_row.adapter_loaded_by_trusted_service_id,
               observation_row.adapter_loaded_at,
               observation_row.capability_id,
               observation_row.capability_revision,
               'core:message.delivery.' || observation_row.fact::text,
               case when observation_row.scope_kind = 'recipient'
                 then observation_row.scope_recipient_source_identity_id
                 else null
               end,
               observation_row.observed_at,
               observation_row.recorded_at
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_delivery_observation_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_provider_receipt_observations'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_provider_receipt_opaque_payloads'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'receipt_observation_id';
  end if;

  if receipt_key is not null then
    if not exists (
      select 1
        from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.id = receipt_key
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
             join public.normalized_inbound_events event_row
               on event_row.tenant_id = snapshot_row.tenant_id
              and event_row.id = receipt_row.evidence_normalized_inbound_event_id
              and event_row.source_connection_id =
                snapshot_row.source_connection_id
              and event_row.source_account_id = snapshot_row.source_account_id
            where snapshot_row.tenant_id = receipt_row.tenant_id
              and snapshot_row.binding_id = receipt_row.source_thread_binding_id
              and snapshot_row.source_account_id = receipt_row.source_account_id
              and snapshot_row.binding_generation =
                receipt_row.binding_generation
              and snapshot_row.capability_contract_id =
                receipt_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                receipt_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                receipt_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                receipt_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                receipt_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at = receipt_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                receipt_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id = receipt_row.capability_id
              )
         )
         and (
           receipt_row.target_kind <> 'exact_message' or exists (
             select 1
               from public.inbox_v2_messages message_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = message_row.tenant_id
                 and occurrence_row.id = receipt_row.target_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.source_account_id = receipt_row.source_account_id
                 and occurrence_row.source_thread_binding_id =
                   receipt_row.source_thread_binding_id
                and occurrence_row.binding_generation =
                  receipt_row.binding_generation
                 and occurrence_row.normalized_inbound_event_id =
                   receipt_row.evidence_normalized_inbound_event_id
                 and occurrence_row.resolved_external_message_reference_id =
                   receipt_row.target_external_message_reference_id
                 and occurrence_row.origin_kind <> 'provider_response'
                 and occurrence_row.adapter_contract_id =
                   receipt_row.adapter_contract_id
                 and occurrence_row.adapter_contract_version =
                   receipt_row.adapter_contract_version
                 and occurrence_row.adapter_declaration_revision =
                   receipt_row.adapter_declaration_revision
                 and occurrence_row.adapter_surface_id = receipt_row.adapter_surface_id
                 and occurrence_row.adapter_loaded_by_trusted_service_id =
                   receipt_row.adapter_loaded_by_trusted_service_id
                 and occurrence_row.adapter_loaded_at = receipt_row.adapter_loaded_at
                 and occurrence_row.capability_revision =
                   receipt_row.capability_revision
                join public.inbox_v2_external_message_references reference_row
                  on reference_row.tenant_id = message_row.tenant_id
                 and reference_row.id =
                   receipt_row.target_external_message_reference_id
                 and reference_row.message_id = message_row.id
                 and reference_row.external_thread_id =
                   occurrence_row.external_thread_id
                 and reference_row.conversation_id = occurrence_row.conversation_id
                 and reference_row.message_key_digest_sha256 =
                   occurrence_row.message_key_digest_sha256
               where message_row.tenant_id = receipt_row.tenant_id
                 and message_row.id = receipt_row.target_message_id
                 and (
                   (occurrence_row.provider_actor_kind =
                       'source_external_identity'
                     and receipt_row.reader_kind = 'source_external_identity'
                     and receipt_row.reader_source_external_identity_id =
                       occurrence_row.provider_actor_source_external_identity_id)
                   or (occurrence_row.provider_actor_kind is distinct from
                         'source_external_identity'
                     and receipt_row.reader_kind = 'aggregate_only')
                 )
            )
         )
         and (
           (receipt_row.opaque_payload_id is null
             and receipt_row.opaque_data_class_id is null
             and receipt_row.provider_watermark_digest_sha256 is null
             and receipt_row.reader_aggregate_key_digest_sha256 is null
             and not exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.receipt_observation_id = receipt_row.id
             ))
           or (receipt_row.opaque_payload_id is not null
             and receipt_row.opaque_data_class_id =
               'core:source_occurrence_and_external_reference'
             and exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.id = receipt_row.opaque_payload_id
                  and payload_row.receipt_observation_id = receipt_row.id
                  and payload_row.data_class_id = receipt_row.opaque_data_class_id
                  and (payload_row.provider_watermark is null) =
                    (receipt_row.provider_watermark_digest_sha256 is null)
                  and (payload_row.reader_aggregate_key is null) =
                    (receipt_row.reader_aggregate_key_digest_sha256 is null)
                  and (payload_row.provider_watermark is null or
                    encode(sha256(convert_to(
                      payload_row.provider_watermark, 'UTF8'
                    )), 'hex') =
                      receipt_row.provider_watermark_digest_sha256)
                  and (payload_row.reader_aggregate_key is null or
                    encode(sha256(convert_to(
                      payload_row.reader_aggregate_key, 'UTF8'
                    )), 'hex') =
                      receipt_row.reader_aggregate_key_digest_sha256)
             ))
         )
         and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
           receipt_row.semantic_proof_detail,
           receipt_row.tenant_id,
           receipt_row.evidence_normalized_inbound_event_id,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_external_message_reference_id
             else null
           end,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_source_occurrence_id
             else null
           end,
           receipt_row.source_account_id,
           receipt_row.source_thread_binding_id,
           receipt_row.binding_generation,
           receipt_row.adapter_contract_id,
           receipt_row.adapter_contract_version,
           receipt_row.adapter_declaration_revision,
           receipt_row.adapter_surface_id,
           receipt_row.adapter_loaded_by_trusted_service_id,
           receipt_row.adapter_loaded_at,
           receipt_row.capability_id,
           receipt_row.capability_revision,
           'core:message.receipt.read',
           case when receipt_row.reader_kind = 'source_external_identity'
             then receipt_row.reader_source_external_identity_id
             else null
           end,
           receipt_row.observed_at,
           receipt_row.recorded_at
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.provider_receipt_observation_coherence';
    end if;
  end if;

  return null;
end;
$function$;

create or replace function public.inbox_v2_tm_payload_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format('inbox_v2.timeline_content_payload_immutable:%s', tg_table_name);
end;
$function$;

create or replace function public.inbox_v2_tm_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  old_row jsonb := to_jsonb(old);
  new_row jsonb := to_jsonb(new);
  mutable_columns text[];
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;

    if not exists (
      select 1 from public.tenants tenant_row
       where tenant_row.id = old_row->>'tenant_id'
    ) then
      return old;
    end if;

    if tg_table_name in (
      'inbox_v2_message_transport_link_heads',
      'inbox_v2_message_provider_lifecycle_operations',
      'inbox_v2_message_reactions',
      'inbox_v2_message_reaction_slot_heads'
    ) and not exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = old_row->>'tenant_id'
         and message_row.id = old_row->>'message_id'
    ) then
      return old;
    end if;

    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_head_delete:%s', tg_table_name);
  end if;

  case tg_table_name
    when 'inbox_v2_timeline_items' then
      mutable_columns := array[
        'revision', 'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_messages' then
      mutable_columns := array[
        'content_revision', 'content_state', 'lifecycle',
        'lifecycle_revision_id', 'lifecycle_reason_id',
        'lifecycle_provider_operation_id', 'lifecycle_policy_reason_id',
        'lifecycle_changed_at', 'revision', 'last_changed_stream_position',
        'updated_at'
      ];
    when 'inbox_v2_staff_notes' then
      mutable_columns := array[
        'content_revision', 'content_state', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_timeline_contents' then
      mutable_columns := array[
        'state', 'content_digest_sha256', 'tombstone_event_id',
        'tombstone_reason_id', 'retention_policy_id',
        'retention_policy_version', 'retention_policy_revision',
        'state_changed_at', 'revision', 'last_changed_stream_position',
        'updated_at'
      ];
    when 'inbox_v2_message_transport_link_heads' then
      mutable_columns := array[
        'link_count', 'latest_link_id', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_provider_lifecycle_operations' then
      mutable_columns := array[
        'outcome', 'outcome_retryable', 'outcome_reason_id',
        'delete_local_effect', 'policy_decision_event_id',
        'policy_decision_revision', 'policy_decided_at', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_reactions' then
      mutable_columns := array[
        'opaque_actor_key', 'opaque_actor_key_digest_sha256',
        'provider_actor_subject', 'provider_actor_subject_digest_sha256',
        'actor_identity_state', 'actor_identity_tombstone_event_id',
        'actor_identity_purged_at', 'state_kind', 'value_kind',
        'unicode_value', 'provider_reaction_kind_id',
        'provider_canonical_code', 'cleared_at', 'external_operation',
        'outbound_route_id', 'request_transition_id',
        'request_attribution_id', 'external_outcome', 'result_token',
        'result_digest_sha256', 'resolved_at', 'state_detail',
        'state_detail_digest_sha256', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    when 'inbox_v2_message_reaction_slot_heads' then
      mutable_columns := array[
        'reaction_id', 'state_kind', 'revision',
        'last_changed_stream_position', 'updated_at'
      ];
    else
      raise exception using errcode = '23514',
        message = format('inbox_v2.timeline_message_unknown_head:%s', tg_table_name);
  end case;

  if (new_row - mutable_columns) is distinct from (old_row - mutable_columns) then
    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_immutable_identity:%s', tg_table_name);
  end if;

  if (new_row->>'revision')::bigint <> (old_row->>'revision')::bigint + 1
     or (new_row->>'last_changed_stream_position')::bigint <=
        (old_row->>'last_changed_stream_position')::bigint
     or (new_row->>'updated_at')::timestamptz <
        (old_row->>'updated_at')::timestamptz then
    raise exception using errcode = '23514',
      message = format('inbox_v2.timeline_message_stale_head:%s', tg_table_name);
  end if;

  if tg_table_name = 'inbox_v2_message_transport_link_heads'
     and (new_row->>'link_count')::bigint <>
        (old_row->>'link_count')::bigint + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.transport_link_head_noncontiguous';
  end if;

  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_assert_reference_context(
  tenant_key text,
  message_key text
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  message_kind public.inbox_v2_message_reference_kind;
  context_kind public.inbox_v2_message_reference_context_kind;
  provenance public.inbox_v2_provider_forward_provenance;
  message_conversation_id text;
  canonical_count integer;
  external_count integer;
  unresolved_count integer;
begin
  select message_row.reference_kind, context_row.kind,
         context_row.provenance_completeness, message_row.conversation_id
    into message_kind, context_kind, provenance, message_conversation_id
    from public.inbox_v2_messages message_row
    left join public.inbox_v2_message_reference_contexts context_row
      on context_row.tenant_id = message_row.tenant_id
     and context_row.message_id = message_row.id
   where message_row.tenant_id = tenant_key
     and message_row.id = message_key;

  if context_kind is null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_missing';
  end if;

  select count(*) into canonical_count
    from public.inbox_v2_message_reference_canonical_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into external_count
    from public.inbox_v2_message_reference_external_targets
   where tenant_id = tenant_key and message_id = message_key;
  select count(*) into unresolved_count
    from public.inbox_v2_message_reference_unresolved_targets
   where tenant_id = tenant_key and message_id = message_key;

  if not (
    (message_kind = 'none' and context_kind = 'none'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_internal' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'reply_resolved_external' and context_kind = 'reply'
      and canonical_count = 1 and external_count = 1 and unresolved_count = 0)
    or (message_kind = 'reply_unresolved_source' and context_kind = 'reply'
      and canonical_count = 0 and external_count = 0 and unresolved_count = 1)
    or (message_kind = 'forward_content_copy'
      and context_kind = 'forward_content_copy'
      and canonical_count between 1 and 32
      and external_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_native'
      and context_kind = 'forward_provider_native'
      and external_count between 1 and 32
      and canonical_count = 0 and unresolved_count = 0)
    or (message_kind = 'forward_provider_observed'
      and context_kind = 'forward_provider_observed'
      and external_count between 0 and 32
      and canonical_count = 0 and unresolved_count = 0
      and (provenance <> 'exact' or external_count >= 1))
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_context_shape';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets target_row
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and target_row.target_message_id = message_key
  ) or exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and reference_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reference_self_target';
  end if;

  if message_kind in ('reply_resolved_internal', 'reply_resolved_external')
     and exists (
       select 1
         from public.inbox_v2_message_reference_canonical_targets target_row
         join public.inbox_v2_messages target_message
           on target_message.tenant_id = target_row.tenant_id
          and target_message.id = target_row.target_message_id
        where target_row.tenant_id = tenant_key
          and target_row.message_id = message_key
          and target_message.conversation_id <> message_conversation_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_conversation_mismatch';
  end if;

  if message_kind = 'reply_resolved_external' and not exists (
    select 1
      from public.inbox_v2_message_reference_canonical_targets canonical_row
      join public.inbox_v2_message_reference_external_targets external_row
        on external_row.tenant_id = canonical_row.tenant_id
       and external_row.message_id = canonical_row.message_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = external_row.tenant_id
       and reference_row.id = external_row.external_message_reference_id
       and reference_row.message_id = canonical_row.target_message_id
       and reference_row.timeline_item_id = canonical_row.target_timeline_item_id
     where canonical_row.tenant_id = tenant_key
       and canonical_row.message_id = message_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reply_target_identity_mismatch';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_external_targets target_row
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = target_row.tenant_id
       and reference_row.id = target_row.external_message_reference_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.id is null or reference_row.id is null
         or occurrence_row.resolution_state <> 'resolved'
         or occurrence_row.resolved_external_message_reference_id <>
            target_row.external_message_reference_id
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_external_reference_target_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_targets target_row
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = target_row.tenant_id
       and occurrence_row.id = target_row.source_occurrence_id
     where target_row.tenant_id = tenant_key
       and target_row.message_id = message_key
       and (
         occurrence_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
         or occurrence_row.resolution_state::text <>
           target_row.resolution_state
         or (target_row.resolution_state = 'pending' and exists (
           select 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ))
         or (target_row.resolution_state = 'conflicted' and (
           select count(*) = occurrence_row.resolution_candidate_count
              and min(candidate_row.ordinal) = 0
              and max(candidate_row.ordinal) =
                occurrence_row.resolution_candidate_count - 1
             from public.inbox_v2_message_reference_unresolved_candidates candidate_row
            where candidate_row.tenant_id = target_row.tenant_id
              and candidate_row.message_id = target_row.message_id
         ) is not true)
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_reference_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_reference_unresolved_candidates candidate_row
      join public.inbox_v2_message_reference_unresolved_targets target_row
        on target_row.tenant_id = candidate_row.tenant_id
       and target_row.message_id = candidate_row.message_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = candidate_row.tenant_id
       and reference_row.id = candidate_row.external_message_reference_id
     where candidate_row.tenant_id = tenant_key
       and candidate_row.message_id = message_key
       and (
         reference_row.id is null
         or reference_row.message_key_digest_sha256 <>
           target_row.external_message_key_digest_sha256
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_unresolved_candidate_invalid';
  end if;
end;
$function$;

create or replace function public.inbox_v2_tm_core_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  timeline_key text;
  message_key text;
  note_key text;
  content_key text;
  conversation_key text;
  actual_count bigint;
  latest_item record;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name = 'inbox_v2_timeline_items' then
    timeline_key := changed_row->>'id';
    conversation_key := changed_row->>'conversation_id';
  else
    timeline_key := changed_row->>'timeline_item_id';
  end if;

  if tg_table_name = 'inbox_v2_messages' then
    message_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_message_revisions' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_outbound_dispatches' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name like 'inbox_v2_message_reference_%' then
    message_key := changed_row->>'message_id';
  elsif tg_table_name = 'inbox_v2_staff_notes' then
    note_key := changed_row->>'id';
    content_key := changed_row->>'content_id';
    conversation_key := changed_row->>'conversation_id';
  elsif tg_table_name = 'inbox_v2_staff_note_revisions' then
    note_key := changed_row->>'staff_note_id';
  elsif tg_table_name in (
    'inbox_v2_timeline_contents', 'inbox_v2_timeline_content_revisions',
    'inbox_v2_timeline_content_payloads',
    'inbox_v2_timeline_content_contact_values'
  ) then
    content_key := coalesce(changed_row->>'id', changed_row->>'content_id');
  end if;

  if tg_table_name = 'inbox_v2_outbound_dispatches'
     and tg_op = 'INSERT'
     and not exists (
       select 1
         from public.inbox_v2_messages message_row
        where message_row.tenant_id = tenant_key
          and message_row.id = changed_row->>'message_id'
          and message_row.conversation_id =
            changed_row->>'conversation_id'
          and message_row.timeline_item_id =
            changed_row->>'timeline_item_id'
          and message_row.origin_kind = 'hulee_external'
          and message_row.origin_outbound_route_id = changed_row->>'route_id'
          and message_row.revision = 1
          and message_row.created_at =
            (changed_row->>'created_at')::timestamptz
          and changed_row->>'state' = 'queued'
          and (changed_row->>'attempt_count')::integer = 0
          and (changed_row->>'revision')::bigint = 1
          and (changed_row->>'created_at')::timestamptz =
            (changed_row->>'updated_at')::timestamptz
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_creation_dispatch_mismatch';
  end if;

  if timeline_key is not null and exists (
    select 1 from public.inbox_v2_timeline_items
     where tenant_id = tenant_key and id = timeline_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_timeline_items item_row
       where item_row.tenant_id = tenant_key
         and item_row.id = timeline_key
         and (
           (item_row.subject_kind = 'message' and exists (
             select 1 from public.inbox_v2_messages message_row
              where message_row.tenant_id = item_row.tenant_id
                and message_row.id = item_row.subject_id
                and message_row.timeline_item_id = item_row.id
                and message_row.conversation_id = item_row.conversation_id
                and message_row.revision = item_row.revision
           ))
           or (item_row.subject_kind = 'staff_note' and exists (
             select 1 from public.inbox_v2_staff_notes note_row
              where note_row.tenant_id = item_row.tenant_id
                and note_row.id = item_row.subject_id
                and note_row.timeline_item_id = item_row.id
                and note_row.conversation_id = item_row.conversation_id
                and note_row.revision = item_row.revision
           ))
           or (item_row.subject_kind not in ('message', 'staff_note') and exists (
             select 1 from public.inbox_v2_timeline_subject_details detail_row
              where detail_row.tenant_id = item_row.tenant_id
                and detail_row.timeline_item_id = item_row.id
                and detail_row.subject_kind = item_row.subject_kind
                and item_row.subject_id = case detail_row.subject_kind
                  when 'call' then detail_row.source_object_id
                  when 'review' then detail_row.source_object_id
                  when 'module_event' then detail_row.source_object_id
                  when 'participant_change' then detail_row.participant_transition_id
                  when 'work_change' then coalesce(
                    detail_row.work_item_transition_id,
                    detail_row.work_item_relation_transition_id
                  )
                  when 'system_event' then detail_row.system_event_id
                end
                and (
                  detail_row.actor_participant_id is null or exists (
                    select 1 from public.inbox_v2_conversation_participants participant_row
                     where participant_row.tenant_id = item_row.tenant_id
                       and participant_row.id = detail_row.actor_participant_id
                       and participant_row.conversation_id = item_row.conversation_id
                  )
                )
           ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.timeline_subject_coherence';
    end if;
  end if;

  if message_key is not null and exists (
    select 1 from public.inbox_v2_messages
     where tenant_id = tenant_key and id = message_key
  ) then
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_timeline_items item_row
          on item_row.tenant_id = message_row.tenant_id
         and item_row.id = message_row.timeline_item_id
         and item_row.conversation_id = message_row.conversation_id
         and item_row.subject_kind = 'message'
         and item_row.subject_id = message_row.id
         and item_row.revision = message_row.revision
        join public.inbox_v2_timeline_contents content_row
          on content_row.tenant_id = message_row.tenant_id
         and content_row.id = message_row.content_id
         and content_row.owner_kind = 'message'
         and content_row.owner_id = message_row.id
         and content_row.revision = message_row.content_revision
         and content_row.state = message_row.content_state
        join public.inbox_v2_timeline_content_revisions content_revision_row
          on content_revision_row.tenant_id = content_row.tenant_id
         and content_revision_row.content_id = content_row.id
         and content_revision_row.revision = content_row.revision
         and content_revision_row.state = content_row.state
         and content_revision_row.recorded_stream_position =
           content_row.last_changed_stream_position
        join public.inbox_v2_message_revisions revision_row
          on revision_row.tenant_id = message_row.tenant_id
         and revision_row.message_id = message_row.id
         and revision_row.timeline_item_id = message_row.timeline_item_id
         and revision_row.message_revision = message_row.revision
         and revision_row.recorded_stream_position =
           message_row.last_changed_stream_position
        join public.inbox_v2_action_attributions attribution_row
          on attribution_row.tenant_id = message_row.tenant_id
         and attribution_row.id = message_row.creation_attribution_id
         and attribution_row.conversation_id = message_row.conversation_id
        join public.inbox_v2_conversation_participants author_row
          on author_row.tenant_id = message_row.tenant_id
         and author_row.id = message_row.author_participant_id
         and author_row.conversation_id = message_row.conversation_id
        left join public.inbox_v2_source_occurrences origin_occurrence_row
          on origin_occurrence_row.tenant_id = message_row.tenant_id
         and origin_occurrence_row.id = message_row.origin_source_occurrence_id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and attribution_row.action_participant_id =
           message_row.author_participant_id
         and (
           (message_row.origin_kind = 'source_originated'
             and attribution_row.source_occurrence_id =
               message_row.origin_source_occurrence_id
             and attribution_row.app_actor_kind is null
             and author_row.subject_kind = 'source_external_identity'
             and origin_occurrence_row.provider_actor_kind =
               'source_external_identity'
             and author_row.subject_source_external_identity_id =
               origin_occurrence_row.provider_actor_source_external_identity_id)
           or (message_row.origin_kind in ('hulee_external', 'internal')
             and attribution_row.source_occurrence_id is null
             and (
               (attribution_row.app_actor_kind = 'employee'
                 and author_row.subject_kind = 'employee'
                 and author_row.subject_employee_id =
                   attribution_row.app_actor_employee_id)
               or (attribution_row.app_actor_kind = 'trusted_service'
                 and attribution_row.automation_kind is not null
                 and author_row.subject_kind = 'bot')
             ))
           or (message_row.origin_kind = 'migration'
             and attribution_row.source_occurrence_id is null
             and attribution_row.app_actor_kind = 'trusted_service'
             and attribution_row.automation_kind is not null
             and author_row.subject_kind in ('legacy_unknown', 'system'))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_head_coherence';
    end if;

    if not public.inbox_v2_tm_message_history_valid(
      tenant_key,
      message_key
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_revision_history_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'source_originated'
    ) and not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_source_occurrences occurrence_row
          on occurrence_row.tenant_id = message_row.tenant_id
         and occurrence_row.id = message_row.origin_source_occurrence_id
         and occurrence_row.conversation_id = message_row.conversation_id
         and occurrence_row.direction::text =
           message_row.origin_source_direction::text
         and occurrence_row.origin_kind not in (
           'provider_echo', 'provider_response'
         )
         and occurrence_row.provider_actor_kind = 'source_external_identity'
         and occurrence_row.resolution_state = 'resolved'
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = message_row.tenant_id
         and reference_row.id =
           occurrence_row.resolved_external_message_reference_id
         and reference_row.external_thread_id = occurrence_row.external_thread_id
         and reference_row.conversation_id = message_row.conversation_id
         and reference_row.timeline_item_id = message_row.timeline_item_id
         and reference_row.message_id = message_row.id
         and reference_row.message_key_digest_sha256 =
           occurrence_row.message_key_digest_sha256
         and reference_row.created_at = message_row.created_at
         and reference_row.revision = 1
        join public.inbox_v2_message_transport_links origin_link_row
          on origin_link_row.tenant_id = message_row.tenant_id
         and origin_link_row.message_id = message_row.id
         and origin_link_row.source_occurrence_id = occurrence_row.id
         and origin_link_row.external_message_reference_id = reference_row.id
         and origin_link_row.role = case message_row.origin_source_direction
           when 'inbound' then 'origin'::public.inbox_v2_message_transport_link_role
           when 'outbound' then 'native_outbound'::public.inbox_v2_message_transport_link_role
         end
         and origin_link_row.resulting_head_revision = 1
         and origin_link_row.revision = 1
         and origin_link_row.linked_at = message_row.created_at
        join public.inbox_v2_message_transport_link_heads head_row
          on head_row.tenant_id = message_row.tenant_id
         and head_row.message_id = message_row.id
         and head_row.link_count >= 1
         and head_row.revision = head_row.link_count
         and head_row.updated_at >= message_row.created_at
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and public.inbox_v2_tm_transport_occurrence_link_valid(
           origin_link_row.tenant_id,
           origin_link_row.id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_source_origin_transport_coherence';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_message_transport_links link_row
          on link_row.tenant_id = message_row.tenant_id
         and link_row.message_id = message_row.id
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind in ('internal', 'migration')
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_local_transport_link_forbidden';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
        left join public.inbox_v2_message_reference_contexts context_row
          on context_row.tenant_id = message_row.tenant_id
         and context_row.message_id = message_row.id
        left join lateral (
          select count(*)::integer as target_count,
                 min(target_row.external_message_reference_id) as
                   external_message_reference_id,
                 min(target_row.source_occurrence_id) as source_occurrence_id
            from public.inbox_v2_message_reference_external_targets target_row
           where target_row.tenant_id = message_row.tenant_id
             and target_row.message_id = message_row.id
        ) external_target on true
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           (
             context_row.kind in ('none', 'forward_content_copy')
             and external_target.target_count = 0
           )
           or (
             context_row.kind in ('reply', 'forward_provider_native')
             and external_target.target_count = 1
           )
         )
         or message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not (
           public.inbox_v2_tm_outbound_route_action_valid(
           message_row.tenant_id,
           message_row.origin_outbound_route_id,
           message_row.id,
           null,
           message_row.conversation_id,
           message_row.created_at,
           message_row.created_at,
           case context_row.kind
             when 'none' then 'core:message.send'
             when 'reply' then 'core:message.reply'
             when 'forward_content_copy' then
               'core:message.forward_content_copy'
             when 'forward_provider_native' then
               'core:message.forward_provider_native'
           end,
           case context_row.kind
             when 'none' then 'core:message.send_external'
             when 'reply' then 'core:message.reply_external'
             when 'forward_content_copy' then
               'core:message.forward_content_copy_external'
             when 'forward_provider_native' then
               'core:message.forward_provider_native_external'
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.external_message_reference_id
             else null
           end,
           case when context_row.kind in ('reply', 'forward_provider_native')
             then external_target.source_occurrence_id
             else null
           end,
           null,
           null,
           null,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_contract_version
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_declaration_revision
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_surface_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_by_trusted_service_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_adapter_loaded_at
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_id
             else null
           end,
           case when context_row.kind = 'forward_provider_native'
             then context_row.native_capability_revision
             else null
           end,
           message_row.creation_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_routes route_row
              where route_row.tenant_id = message_row.tenant_id
                and route_row.id = message_row.origin_outbound_route_id
                and route_row.created_at = message_row.created_at
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_origin_route_mismatch';
    end if;

    if exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and (
           (
             message_row.origin_kind = 'hulee_external'
             and (
               1 <> (
                 select count(*)
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
               )
               or not exists (
                 select 1
                   from public.inbox_v2_outbound_dispatches dispatch_row
                  where dispatch_row.tenant_id = message_row.tenant_id
                    and dispatch_row.message_id = message_row.id
                    and dispatch_row.conversation_id =
                      message_row.conversation_id
                    and dispatch_row.timeline_item_id =
                      message_row.timeline_item_id
                    and dispatch_row.route_id =
                      message_row.origin_outbound_route_id
                    and dispatch_row.created_at = message_row.created_at
               )
             )
           )
           or (
             message_row.origin_kind <> 'hulee_external'
             and exists (
               select 1
                 from public.inbox_v2_outbound_dispatches dispatch_row
                where dispatch_row.tenant_id = message_row.tenant_id
                  and dispatch_row.message_id = message_row.id
             )
           )
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_dispatch_coherence';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.origin_kind = 'hulee_external'
         and not exists (
           select 1
             from public.inbox_v2_outbound_route_consumptions consumption_row
            where consumption_row.tenant_id = message_row.tenant_id
              and consumption_row.consumer_kind = 'message_creation'
              and consumption_row.consumer_id = message_row.id
              and consumption_row.message_id = message_row.id
              and consumption_row.outbound_route_id =
                message_row.origin_outbound_route_id
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_route_consumption_missing';
    end if;

    if exists (
      select 1 from public.inbox_v2_messages message_row
       where message_row.tenant_id = tenant_key
         and message_row.id = message_key
         and message_row.lifecycle = 'provider_delete_tombstone'
         and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_operations op_row
            where op_row.tenant_id = message_row.tenant_id
              and op_row.id = message_row.lifecycle_provider_operation_id
              and op_row.message_id = message_row.id
              and op_row.action = 'delete'
              and op_row.delete_local_effect = 'tombstone_local'
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_lifecycle_operation_mismatch';
    end if;

    perform public.inbox_v2_tm_assert_reference_context(tenant_key, message_key);
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not exists (
    select 1
      from public.inbox_v2_staff_notes note_row
      join public.inbox_v2_timeline_items item_row
        on item_row.tenant_id = note_row.tenant_id
       and item_row.id = note_row.timeline_item_id
       and item_row.subject_kind = 'staff_note'
       and item_row.subject_id = note_row.id
       and item_row.visibility = 'staff_only'
       and item_row.revision = note_row.revision
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = note_row.tenant_id
       and content_row.id = note_row.content_id
       and content_row.owner_kind = 'staff_note'
       and content_row.owner_id = note_row.id
       and content_row.revision = note_row.content_revision
       and content_row.state = note_row.content_state
      join public.inbox_v2_staff_note_revisions revision_row
        on revision_row.tenant_id = note_row.tenant_id
       and revision_row.staff_note_id = note_row.id
       and revision_row.timeline_item_id = note_row.timeline_item_id
       and revision_row.staff_note_revision = note_row.revision
       and revision_row.recorded_stream_position =
         note_row.last_changed_stream_position
       and revision_row.after_content_id = note_row.content_id
       and revision_row.after_content_revision = note_row.content_revision
       and revision_row.after_content_state = note_row.content_state
     where note_row.tenant_id = tenant_key and note_row.id = note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_head_coherence';
  end if;

  if note_key is not null and exists (
    select 1 from public.inbox_v2_staff_notes
     where tenant_id = tenant_key and id = note_key
  ) and not public.inbox_v2_tm_staff_note_history_valid(
    tenant_key,
    note_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.staff_note_revision_history_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and tg_table_name = 'inbox_v2_timeline_contents'
    and tg_op = 'INSERT'
    and not exists (
      select 1
        from public.inbox_v2_timeline_contents content_row
       where content_row.tenant_id = tenant_key
         and content_row.id = content_key
         and (
           (content_row.owner_kind = 'message' and exists (
             select 1
               from public.inbox_v2_messages owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
           or (content_row.owner_kind = 'staff_note' and exists (
             select 1
               from public.inbox_v2_staff_notes owner_row
               join public.inbox_v2_conversations conversation_row
                 on conversation_row.tenant_id = owner_row.tenant_id
                and conversation_row.id = owner_row.conversation_id
              where owner_row.tenant_id = content_row.tenant_id
                and owner_row.id = content_row.owner_id
                and conversation_row.purpose_id =
                  content_row.processing_purpose_id
           ))
         )
    ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_creation_classification_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_revisions revision_row
        on revision_row.tenant_id = content_row.tenant_id
       and revision_row.content_id = content_row.id
       and revision_row.revision = content_row.revision
       and revision_row.state = content_row.state
       and revision_row.recorded_stream_position =
         content_row.last_changed_stream_position
     where content_row.tenant_id = tenant_key
       and content_row.id = content_key
       and (
         (content_row.owner_kind = 'message' and exists (
           select 1 from public.inbox_v2_messages message_row
            where message_row.tenant_id = content_row.tenant_id
              and message_row.id = content_row.owner_id
              and message_row.content_id = content_row.id
         ))
         or (content_row.owner_kind = 'staff_note' and exists (
           select 1 from public.inbox_v2_staff_notes note_row
            where note_row.tenant_id = content_row.tenant_id
              and note_row.id = content_row.owner_id
              and note_row.content_id = content_row.id
         ))
       )
       and (
         (content_row.state = 'available' and (
           select count(*) between 1 and 64
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and (
           select min(payload_row.ordinal) = 0
              and max(payload_row.ordinal) = count(*) - 1
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
         ) and not exists (
           select 1
             from public.inbox_v2_timeline_content_payloads payload_row
             left join lateral (
               select count(*)::integer as value_count,
                      min(value_row.value_ordinal) as minimum_ordinal,
                      max(value_row.value_ordinal) as maximum_ordinal
                 from public.inbox_v2_timeline_content_contact_values value_row
                where value_row.tenant_id = payload_row.tenant_id
                  and value_row.content_id = payload_row.content_id
                  and value_row.content_revision = payload_row.content_revision
                  and value_row.block_ordinal = payload_row.ordinal
             ) contact_values on true
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
              and payload_row.content_revision = content_row.revision
              and (
                (payload_row.kind = 'contact' and not (
                  contact_values.value_count between 1 and 64
                  and contact_values.minimum_ordinal = 0
                  and contact_values.maximum_ordinal =
                    contact_values.value_count - 1
                ))
                or (payload_row.kind <> 'contact'
                  and contact_values.value_count <> 0)
              )
         ))
         or (content_row.state <> 'available' and not exists (
           select 1 from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = content_row.tenant_id
              and payload_row.content_id = content_row.id
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_head_coherence';
  end if;

  if content_key is not null and exists (
    select 1 from public.inbox_v2_timeline_contents
     where tenant_id = tenant_key and id = content_key
  ) and not public.inbox_v2_tm_content_history_valid(
    tenant_key,
    content_key
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.timeline_content_revision_history_coherence';
  end if;

  if conversation_key is not null then
    select item_row.id, item_row.timeline_sequence, item_row.occurred_at
      into latest_item
      from public.inbox_v2_timeline_items item_row
     where item_row.tenant_id = tenant_key
       and item_row.conversation_id = conversation_key
       and item_row.activity_kind = 'eligible'
     order by item_row.timeline_sequence desc
     limit 1;

    select count(*) into actual_count
      from public.inbox_v2_conversation_heads head_row
     where head_row.tenant_id = tenant_key
       and head_row.conversation_id = conversation_key
       and head_row.latest_timeline_sequence = coalesce((
         select max(item_row.timeline_sequence)
           from public.inbox_v2_timeline_items item_row
          where item_row.tenant_id = tenant_key
            and item_row.conversation_id = conversation_key
       ), 0)
       and (
         (latest_item.id is null
           and head_row.latest_activity_item_id is null
           and head_row.latest_activity_timeline_sequence is null
           and head_row.latest_activity_at is null)
         or (latest_item.id is not null
           and head_row.latest_activity_item_id = latest_item.id
           and head_row.latest_activity_timeline_sequence =
             latest_item.timeline_sequence
           and head_row.latest_activity_at = latest_item.occurred_at)
       );

    if actual_count <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.conversation_timeline_head_coherence';
    end if;
  end if;

  return null;
end;
$function$;
create trigger inbox_v2_tm_timeline_head_guard
before update or delete on public.inbox_v2_timeline_items
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_message_head_guard
before update or delete on public.inbox_v2_messages
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_content_head_guard
before update or delete on public.inbox_v2_timeline_contents
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_note_head_guard
before update or delete on public.inbox_v2_staff_notes
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_link_head_guard
before update or delete on public.inbox_v2_message_transport_link_heads
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_provider_op_head_guard
before update or delete on public.inbox_v2_message_provider_lifecycle_operations
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_reaction_head_guard
before update or delete on public.inbox_v2_message_reactions
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_reaction_slot_head_guard
before update or delete on public.inbox_v2_message_reaction_slot_heads
for each row execute function public.inbox_v2_tm_head_guard();
create trigger inbox_v2_tm_content_payload_guard
before update on public.inbox_v2_timeline_content_payloads
for each row execute function public.inbox_v2_tm_payload_guard();
create trigger inbox_v2_tm_contact_payload_guard
before update on public.inbox_v2_timeline_content_contact_values
for each row execute function public.inbox_v2_tm_payload_guard();
create trigger inbox_v2_tm_receipt_payload_guard
before update on public.inbox_v2_provider_receipt_opaque_payloads
for each row execute function public.inbox_v2_tm_payload_guard();

create trigger inbox_v2_tm_provider_op_json_guard
before insert or update on public.inbox_v2_message_provider_lifecycle_operations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_provider_transition_json_guard
before insert on public.inbox_v2_message_provider_lifecycle_transitions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_json_guard
before insert or update on public.inbox_v2_message_reactions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_transition_json_guard
before insert on public.inbox_v2_message_reaction_transitions
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_reaction_observation_json_guard
before insert on public.inbox_v2_message_provider_reaction_observations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_delivery_json_guard
before insert on public.inbox_v2_message_delivery_observations
for each row execute function public.inbox_v2_tm_json_guard();
create trigger inbox_v2_tm_receipt_json_guard
before insert on public.inbox_v2_provider_receipt_observations
for each row execute function public.inbox_v2_tm_json_guard();

create trigger inbox_v2_tm_attribution_append_guard
before update or delete on public.inbox_v2_action_attributions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_conversations', 'id', 'conversation_id'
);
create trigger inbox_v2_tm_subject_detail_append_guard
before update or delete on public.inbox_v2_timeline_subject_details
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_timeline_items', 'id', 'timeline_item_id'
);
create trigger inbox_v2_tm_content_revision_append_guard
before update or delete on public.inbox_v2_timeline_content_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_timeline_contents', 'id', 'content_id'
);
create trigger inbox_v2_tm_message_revision_append_guard
before update or delete on public.inbox_v2_message_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_reference_context_append_guard
before update or delete on public.inbox_v2_message_reference_contexts
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_ref_canonical_append_guard
before update or delete on public.inbox_v2_message_reference_canonical_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_external_append_guard
before update or delete on public.inbox_v2_message_reference_external_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_unresolved_append_guard
before update or delete on public.inbox_v2_message_reference_unresolved_targets
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_contexts', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_ref_candidate_append_guard
before update or delete on public.inbox_v2_message_reference_unresolved_candidates
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reference_unresolved_targets', 'message_id', 'message_id'
);
create trigger inbox_v2_tm_note_revision_append_guard
before update or delete on public.inbox_v2_staff_note_revisions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_staff_notes', 'id', 'staff_note_id'
);
create trigger inbox_v2_tm_transport_link_append_guard
before update or delete on public.inbox_v2_message_transport_links
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_route_consumption_append_guard
before update or delete on public.inbox_v2_outbound_route_consumptions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_provider_transition_append_guard
before update or delete on public.inbox_v2_message_provider_lifecycle_transitions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_provider_lifecycle_operations', 'id', 'operation_id'
);
create trigger inbox_v2_tm_reaction_transition_append_guard
before update or delete on public.inbox_v2_message_reaction_transitions
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reactions', 'id', 'reaction_id'
);
create trigger inbox_v2_tm_reaction_observation_append_guard
before update or delete on public.inbox_v2_message_provider_reaction_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_message_reaction_transitions', 'id', 'transition_id'
);
create trigger inbox_v2_tm_transport_fact_commit_append_guard
before update or delete on public.inbox_v2_message_transport_fact_commits
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_delivery_append_guard
before update or delete on public.inbox_v2_message_delivery_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'message_id'
);
create trigger inbox_v2_tm_receipt_append_guard
before update or delete on public.inbox_v2_provider_receipt_observations
for each row execute function public.inbox_v2_tm_append_only_guard(
  'public.inbox_v2_messages', 'id', 'target_message_id',
  'public.inbox_v2_message_transport_fact_commits', 'commit_token', 'commit_token'
);

create constraint trigger inbox_v2_tm_timeline_coherence
after insert or update or delete on public.inbox_v2_timeline_items
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_message_coherence
after insert or update or delete on public.inbox_v2_messages
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_outbound_dispatch_coherence
after insert or update or delete on public.inbox_v2_outbound_dispatches
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_message_revision_coherence
after insert or delete on public.inbox_v2_message_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_reference_context_coherence
after insert or delete on public.inbox_v2_message_reference_contexts
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_canonical_coherence
after insert or delete on public.inbox_v2_message_reference_canonical_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_external_coherence
after insert or delete on public.inbox_v2_message_reference_external_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_unresolved_coherence
after insert or delete on public.inbox_v2_message_reference_unresolved_targets
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_ref_candidate_coherence
after insert or delete on public.inbox_v2_message_reference_unresolved_candidates
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_coherence
after insert or update or delete on public.inbox_v2_timeline_contents
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_revision_coherence
after insert or delete on public.inbox_v2_timeline_content_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_content_payload_coherence
after insert or delete on public.inbox_v2_timeline_content_payloads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_contact_payload_coherence
after insert or delete on public.inbox_v2_timeline_content_contact_values
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_note_coherence
after insert or update or delete on public.inbox_v2_staff_notes
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_note_revision_coherence
after insert or delete on public.inbox_v2_staff_note_revisions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();
create constraint trigger inbox_v2_tm_subject_detail_coherence
after insert or delete on public.inbox_v2_timeline_subject_details
deferrable initially deferred for each row
execute function public.inbox_v2_tm_core_coherence();

create constraint trigger inbox_v2_tm_transport_link_coherence
after insert or delete on public.inbox_v2_message_transport_links
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_transport_head_coherence
after insert or update or delete on public.inbox_v2_message_transport_link_heads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_route_consumption_coherence
after insert or delete on public.inbox_v2_outbound_route_consumptions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_provider_op_coherence
after insert or update or delete on public.inbox_v2_message_provider_lifecycle_operations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_provider_transition_coherence
after insert or delete on public.inbox_v2_message_provider_lifecycle_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_coherence
after insert or update or delete on public.inbox_v2_message_reactions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_transition_coherence
after insert or delete on public.inbox_v2_message_reaction_transitions
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_slot_coherence
after insert or update or delete on public.inbox_v2_message_reaction_slot_heads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_reaction_observation_coherence
after insert or delete on public.inbox_v2_message_provider_reaction_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_transport_fact_commit_coherence
after insert or delete on public.inbox_v2_message_transport_fact_commits
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_delivery_coherence
after insert on public.inbox_v2_message_delivery_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_receipt_coherence
after insert on public.inbox_v2_provider_receipt_observations
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
create constraint trigger inbox_v2_tm_receipt_payload_coherence
after insert on public.inbox_v2_provider_receipt_opaque_payloads
deferrable initially deferred for each row
execute function public.inbox_v2_tm_aux_coherence();
--> statement-breakpoint
create or replace function public.inbox_v2_tm_provider_semantic_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 then
      return old;
    end if;
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.provider_semantic_ordering_head_invalid_initial';
    end if;
    return new;
  end if;

  if row(
       new.tenant_id, new.external_message_reference_id,
       new.semantic_family_id, new.scope_token,
       new.comparator_id, new.comparator_revision,
       new.created_at
     ) is distinct from row(
       old.tenant_id, old.external_message_reference_id,
       old.semantic_family_id, old.scope_token,
       old.comparator_id, old.comparator_revision,
       old.created_at
     )
     or new.revision <> old.revision + 1
     or new.last_changed_stream_position <= old.last_changed_stream_position
     or new.updated_at < old.updated_at
     or char_length(new.position) < char_length(old.position)
     or (
       char_length(new.position) = char_length(old.position)
       and new.position collate "C" <= old.position collate "C"
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_invalid_advance';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_proof_scope_valid(
  proof_detail jsonb,
  expected_tenant_id text
)
returns boolean
language sql
immutable
strict
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    proof_detail #>> '{tenantId}' = expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{normalizedInboundEvent,kind}' =
      'normalized_inbound_event'
    and proof_detail #>> '{externalMessageReference,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{externalMessageReference,kind}' =
      'external_message_reference'
    and proof_detail #>> '{sourceOccurrence,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{sourceOccurrence,kind}' = 'source_occurrence'
    and proof_detail #>> '{sourceAccount,tenantId}' = expected_tenant_id
    and proof_detail #>> '{sourceAccount,kind}' = 'source_account'
    and proof_detail #>> '{sourceThreadBinding,tenantId}' =
      expected_tenant_id
    and proof_detail #>> '{sourceThreadBinding,kind}' =
      'source_thread_binding'
    and (
      proof_detail -> 'actor' = 'null'::jsonb
      or (
        proof_detail #>> '{actor,tenantId}' = expected_tenant_id
        and proof_detail #>> '{actor,kind}' = 'source_external_identity'
      )
    );
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_consumer_count(
  head_row public.inbox_v2_provider_semantic_ordering_heads,
  expected_before jsonb,
  require_before boolean
)
returns bigint
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select
    (
      select count(*)
        from public.inbox_v2_message_provider_lifecycle_operations operation_row
       where operation_row.tenant_id = (head_row).tenant_id
         and operation_row.origin = 'provider_observed'
         and operation_row.external_message_reference_id =
           (head_row).external_message_reference_id
         and operation_row.source_account_id = (head_row).source_account_id
         and operation_row.source_thread_binding_id =
           (head_row).source_thread_binding_id
         and operation_row.binding_generation = (head_row).binding_generation
         and operation_row.provider_semantic_normalized_inbound_event_id =
           (head_row).normalized_inbound_event_id
         and operation_row.provider_semantic_proof_token =
           (head_row).proof_token
         and operation_row.provider_semantic_ordering_scope_token =
           (head_row).scope_token
         and operation_row.provider_semantic_ordering_position =
           (head_row).position
         and operation_row.provider_semantic_ordering_comparator_id =
           (head_row).comparator_id
         and operation_row.provider_semantic_ordering_comparator_revision =
           (head_row).comparator_revision
         and operation_row.semantic_ordering_commit_detail #>>
           '{semanticFamilyId}' = (head_row).semantic_family_id
         and operation_row.semantic_ordering_commit_detail #>>
           '{tenantId}' = (head_row).tenant_id
         and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
           operation_row.provider_semantic_proof_detail,
           (head_row).tenant_id
         )
         and operation_row.semantic_ordering_commit_detail -> 'proof' =
           operation_row.provider_semantic_proof_detail
         and operation_row.semantic_ordering_commit_detail -> 'after' =
           (head_row).head_detail
         and (not require_before or
           operation_row.semantic_ordering_commit_detail -> 'before' =
             expected_before)
         and (operation_row.semantic_ordering_commit_detail #>>
           '{committedAt}')::timestamptz = (head_row).updated_at
         and operation_row.semantic_ordering_commit_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and operation_row.provider_semantic_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and operation_row.created_stream_position =
           (head_row).last_changed_stream_position
    ) + (
      select count(*)
        from public.inbox_v2_message_provider_reaction_observations observation_row
        join public.inbox_v2_message_reaction_transitions transition_row
          on transition_row.tenant_id = observation_row.tenant_id
         and transition_row.id = observation_row.transition_id
        join public.inbox_v2_message_reactions reaction_row
          on reaction_row.tenant_id = transition_row.tenant_id
         and reaction_row.id = transition_row.reaction_id
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = transition_row.tenant_id
         and reference_row.id = transition_row.external_message_reference_id
         and reference_row.message_id = reaction_row.message_id
        join public.inbox_v2_action_attributions attribution_row
          on attribution_row.tenant_id = transition_row.tenant_id
         and attribution_row.id = transition_row.action_attribution_id
        join public.inbox_v2_source_occurrences occurrence_actor_row
          on occurrence_actor_row.tenant_id = observation_row.tenant_id
         and occurrence_actor_row.id = observation_row.source_occurrence_id
       where observation_row.tenant_id = (head_row).tenant_id
         and transition_row.mode = 'provider_observed'
         and transition_row.external_message_reference_id =
           (head_row).external_message_reference_id
         and transition_row.source_occurrence_id =
           observation_row.source_occurrence_id
         and transition_row.source_account_id = (head_row).source_account_id
         and transition_row.source_thread_binding_id =
           (head_row).source_thread_binding_id
         and transition_row.binding_generation =
           (head_row).binding_generation
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,id}' =
             transition_row.external_message_reference_id
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{externalMessageReference,kind}' = 'external_message_reference'
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,id}' = transition_row.source_occurrence_id
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceOccurrence,kind}' = 'source_occurrence'
         and transition_row.external_authority_detail #>>
           '{sourceAccount,id}' = transition_row.source_account_id
         and transition_row.external_authority_detail #>>
           '{sourceAccount,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceAccount,kind}' = 'source_account'
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,id}' =
             transition_row.source_thread_binding_id
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,tenantId}' = (head_row).tenant_id
         and transition_row.external_authority_detail #>>
           '{sourceThreadBinding,kind}' = 'source_thread_binding'
         and transition_row.external_authority_detail #>>
           '{bindingGeneration}' = transition_row.binding_generation::text
         and transition_row.adapter_contract_id =
           observation_row.semantic_proof_detail #>>
             '{adapterContract,contractId}'
         and transition_row.adapter_contract_version =
           observation_row.semantic_proof_detail #>>
             '{adapterContract,contractVersion}'
         and transition_row.capability_id =
           observation_row.semantic_proof_detail #>> '{capabilityId}'
         and transition_row.capability_revision::text =
           observation_row.semantic_proof_detail #>> '{capabilityRevision}'
         and transition_row.external_authority_detail -> 'adapterContract' =
           observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail #>
           '{capabilityFence,adapterContract}' =
             observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail #>>
           '{capabilityFence,capabilityId}' = transition_row.capability_id
         and transition_row.external_authority_detail #>>
           '{capabilityFence,capabilityRevision}' =
             transition_row.capability_revision::text
         and transition_row.external_authority_detail #>>
           '{capabilityFence,decision}' = 'supported'
         and isfinite((transition_row.external_authority_detail #>>
           '{capabilityFence,evaluatedAt}')::timestamptz)
         and isfinite((transition_row.external_authority_detail #>>
           '{capabilityFence,notAfter}')::timestamptz)
         and (transition_row.external_authority_detail #>>
           '{capabilityFence,evaluatedAt}')::timestamptz <=
             transition_row.occurred_at
         and (transition_row.external_authority_detail #>>
           '{capabilityFence,notAfter}')::timestamptz >=
             transition_row.occurred_at
         and (observation_row.semantic_proof_detail #>>
           '{adapterContract,loadedAt}')::timestamptz <=
             transition_row.occurred_at
         and observation_row.semantic_proof_detail #>>
           '{declaredByTrustedServiceId}' =
             observation_row.semantic_proof_detail #>>
               '{adapterContract,loadedByTrustedServiceId}'
         and reaction_row.capability_kind = 'external'
         and reaction_row.capability_id = transition_row.capability_id
         and reaction_row.capability_revision =
           transition_row.capability_revision
         and reaction_row.adapter_contract_id =
           transition_row.adapter_contract_id
         and reaction_row.adapter_contract_version =
           transition_row.adapter_contract_version
         and reaction_row.capability_detail #>> '{kind}' = 'external'
         and reaction_row.capability_detail #>> '{capabilityId}' =
           transition_row.capability_id
         and reaction_row.capability_detail #>> '{capabilityRevision}' =
           transition_row.capability_revision::text
         and reaction_row.capability_detail #>> '{cardinality}' =
           reaction_row.cardinality::text
         and reaction_row.capability_detail -> 'adapterContract' =
           observation_row.semantic_proof_detail -> 'adapterContract'
         and transition_row.external_authority_detail -> 'outboundRoute' =
           'null'::jsonb
         and attribution_row.source_occurrence_id =
           observation_row.source_occurrence_id
         and attribution_row.conversation_id = reference_row.conversation_id
         and observation_row.normalized_inbound_event_id =
           (head_row).normalized_inbound_event_id
         and observation_row.ordering_position = (head_row).position
         and observation_row.semantic_proof_detail #>>
           '{normalizedInboundEvent,id}' =
             observation_row.normalized_inbound_event_id
         and observation_row.semantic_proof_detail #>>
           '{externalMessageReference,id}' =
             (head_row).external_message_reference_id
         and observation_row.semantic_proof_detail #>>
           '{sourceOccurrence,id}' = observation_row.source_occurrence_id
         and observation_row.semantic_proof_detail #>> '{semanticId}' =
           observation_row.semantic_id
         and observation_row.semantic_id =
           'core:message.reaction.' || transition_row.operation::text
         and observation_row.semantic_proof_detail #>> '{revision}' = '1'
         and observation_row.semantic_proof_detail #>> '{semanticRevision}'
           ~ '^[1-9][0-9]*$'
         and char_length(observation_row.semantic_proof_detail #>>
           '{semanticRevision}') <= 19
         and (
           char_length(observation_row.semantic_proof_detail #>>
             '{semanticRevision}') < 19
           or (observation_row.semantic_proof_detail #>>
             '{semanticRevision}') collate "C" <= '9223372036854775807'
         )
         and observation_row.semantic_proof_detail #>>
           '{ordering,position}' = observation_row.ordering_position
         and observation_row.semantic_proof_detail #>> '{sourceAccount,id}' =
           (head_row).source_account_id
         and observation_row.semantic_proof_detail #>>
           '{sourceThreadBinding,id}' = (head_row).source_thread_binding_id
         and observation_row.semantic_proof_detail #>> '{bindingGeneration}' =
           (head_row).binding_generation::text
         and observation_row.semantic_proof_detail #>> '{proofToken}' =
           (head_row).proof_token
         and observation_row.semantic_proof_detail #>> '{ordering,scopeToken}' =
           (head_row).scope_token
         and observation_row.semantic_proof_detail #>>
           '{ordering,comparatorId}' = (head_row).comparator_id
         and observation_row.semantic_proof_detail #>>
           '{ordering,comparatorRevision}' =
             (head_row).comparator_revision::text
         and observation_row.ordering_commit_detail #>>
           '{semanticFamilyId}' = (head_row).semantic_family_id
         and (head_row).semantic_family_id = 'core:message.reaction'
         and observation_row.ordering_commit_detail #>>
           '{tenantId}' = (head_row).tenant_id
         and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
           observation_row.semantic_proof_detail,
           (head_row).tenant_id
         )
         and observation_row.ordering_commit_detail -> 'proof' =
           observation_row.semantic_proof_detail
         and observation_row.ordering_commit_detail -> 'after' =
           (head_row).head_detail
         and (not require_before or
           observation_row.ordering_commit_detail -> 'before' =
             expected_before)
         and (observation_row.ordering_commit_detail #>>
           '{committedAt}')::timestamptz = (head_row).updated_at
         and (observation_row.semantic_proof_detail #>>
           '{occurredAt}')::timestamptz = observation_row.observed_at
         and (observation_row.semantic_proof_detail #>>
           '{recordedAt}')::timestamptz = observation_row.recorded_at
         and transition_row.occurred_at = observation_row.observed_at
         and observation_row.recorded_at <= transition_row.recorded_at
         and transition_row.recorded_at = (head_row).updated_at
         and transition_row.after_state_kind =
           observation_row.normalized_state_kind
         and transition_row.value_kind = observation_row.normalized_value_kind
         and transition_row.unicode_value is not distinct from
           observation_row.normalized_unicode_value
         and transition_row.provider_reaction_kind_id is not distinct from
           observation_row.normalized_provider_reaction_kind_id
         and transition_row.provider_canonical_code is not distinct from
           observation_row.normalized_provider_canonical_code
         and transition_row.after_state_detail #>> '{kind}' =
           transition_row.after_state_kind::text
         and transition_row.after_state_detail #>> (
           case when transition_row.after_state_kind = 'active'
             then array['value', 'kind']
             else array['lastValue', 'kind']
           end
         ) = transition_row.value_kind::text
         and (
           (
             transition_row.value_kind = 'unicode'
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'value']
                 else array['lastValue', 'value']
               end
             ) = transition_row.unicode_value
             and transition_row.provider_reaction_kind_id is null
             and transition_row.provider_canonical_code is null
           )
           or (
             transition_row.value_kind = 'provider_custom'
             and transition_row.unicode_value is null
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'providerKindId']
                 else array['lastValue', 'providerKindId']
               end
             ) = transition_row.provider_reaction_kind_id
             and transition_row.after_state_detail #>> (
               case when transition_row.after_state_kind = 'active'
                 then array['value', 'canonicalCode']
                 else array['lastValue', 'canonicalCode']
               end
             ) = transition_row.provider_canonical_code
           )
         )
         and (
           transition_row.after_state_kind = 'active'
           or (transition_row.after_state_detail #>>
             '{clearedAt}')::timestamptz = transition_row.recorded_at
         )
         and (
           (
             coalesce(
               transition_row.before_state_kind = 'pending_external'
               or (
                 transition_row.before_state_kind = 'external_terminal'
                 and transition_row.before_state_detail #>> '{outcome}' =
                   'outcome_unknown'
               ),
               false
             )
             and (
               observation_row.semantic_proof_detail #>> '{actor,id}' is null
               or occurrence_actor_row.provider_actor_source_external_identity_id
                 is null
               or observation_row.semantic_proof_detail #>> '{actor,id}' =
                 occurrence_actor_row.provider_actor_source_external_identity_id
             )
             and (
               (
                 coalesce(
                   observation_row.semantic_proof_detail #>> '{actor,id}',
                   occurrence_actor_row.provider_actor_source_external_identity_id
                 ) is null
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
               )
               or (
                 attribution_row.action_participant_id =
                   observation_row.provider_actor_participant_id
                 and exists (
                   select 1
                     from public.inbox_v2_conversation_participants participant_row
                    where participant_row.tenant_id =
                      observation_row.tenant_id
                      and participant_row.id =
                        observation_row.provider_actor_participant_id
                      and participant_row.conversation_id =
                        reference_row.conversation_id
                      and participant_row.subject_kind =
                        'source_external_identity'
                      and participant_row.subject_source_external_identity_id =
                        coalesce(
                          observation_row.semantic_proof_detail #>>
                            '{actor,id}',
                          occurrence_actor_row.provider_actor_source_external_identity_id
                        )
                 )
               )
             )
           )
           or (
             not coalesce(
               transition_row.before_state_kind = 'pending_external'
               or (
                 transition_row.before_state_kind = 'external_terminal'
                 and transition_row.before_state_detail #>> '{outcome}' =
                   'outcome_unknown'
               ),
               false
             )
             and (
               (
                 occurrence_actor_row.provider_actor_kind =
                   'source_external_identity'
                 and observation_row.semantic_proof_detail #>> '{actor,id}' =
                   occurrence_actor_row.provider_actor_source_external_identity_id
                 and attribution_row.action_participant_id =
                   observation_row.provider_actor_participant_id
                 and reaction_row.actor_kind = 'participant'
                 and reaction_row.actor_participant_id =
                   observation_row.provider_actor_participant_id
                 and exists (
                   select 1
                     from public.inbox_v2_conversation_participants participant_row
                    where participant_row.tenant_id =
                      observation_row.tenant_id
                      and participant_row.id =
                        observation_row.provider_actor_participant_id
                      and participant_row.conversation_id =
                        reference_row.conversation_id
                      and participant_row.subject_kind =
                        'source_external_identity'
                      and participant_row.subject_source_external_identity_id =
                        occurrence_actor_row.provider_actor_source_external_identity_id
                 )
               )
               or (
                 occurrence_actor_row.provider_actor_kind = 'provider_system'
                 and observation_row.semantic_proof_detail -> 'actor' =
                   'null'::jsonb
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
                 and reaction_row.actor_kind = 'provider_system'
                 and reaction_row.actor_source_occurrence_id =
                   occurrence_actor_row.id
                 and reaction_row.provider_actor_kind_id =
                   occurrence_actor_row.provider_system_actor_kind_id
                 and reaction_row.provider_actor_subject =
                   occurrence_actor_row.provider_system_actor_subject
               )
               or (
                 occurrence_actor_row.provider_actor_kind is null
                 and observation_row.semantic_proof_detail -> 'actor' =
                   'null'::jsonb
                 and observation_row.provider_actor_participant_id is null
                 and attribution_row.action_participant_id is null
                 and reaction_row.actor_kind in (
                   'unattributed_source_observation', 'aggregate_only'
                 )
                 and reaction_row.actor_source_occurrence_id =
                   occurrence_actor_row.id
               )
             )
           )
         )
         and observation_row.ordering_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and observation_row.semantic_proof_digest_sha256 ~
           '^[a-f0-9]{64}$'
         and transition_row.recorded_stream_position =
           (head_row).last_changed_stream_position
         and exists (
           select 1
             from public.inbox_v2_source_occurrences occurrence_row
            where occurrence_row.tenant_id = observation_row.tenant_id
              and occurrence_row.id = observation_row.source_occurrence_id
              and occurrence_row.normalized_inbound_event_id =
                observation_row.normalized_inbound_event_id
              and occurrence_row.source_account_id =
                (head_row).source_account_id
              and occurrence_row.source_thread_binding_id =
                (head_row).source_thread_binding_id
              and occurrence_row.binding_generation =
                (head_row).binding_generation
              and occurrence_row.adapter_contract_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,contractId}'
              and occurrence_row.adapter_contract_version =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,contractVersion}'
              and occurrence_row.adapter_declaration_revision::text =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,declarationRevision}'
              and occurrence_row.adapter_surface_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,surfaceId}'
              and occurrence_row.adapter_loaded_by_trusted_service_id =
                observation_row.semantic_proof_detail #>>
                  '{adapterContract,loadedByTrustedServiceId}'
              and occurrence_row.adapter_loaded_at =
                (observation_row.semantic_proof_detail #>>
                  '{adapterContract,loadedAt}')::timestamptz
              and occurrence_row.capability_revision::text =
                observation_row.semantic_proof_detail #>>
                  '{capabilityRevision}'
              and occurrence_row.resolution_state = 'resolved'
              and occurrence_row.resolved_external_message_reference_id =
                (head_row).external_message_reference_id
         )
    );
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_head_consumer_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  matching_consumer_count bigint;
  matching_before_count bigint;
  expected_before jsonb;
begin
  if not exists (
    select 1
      from public.inbox_v2_external_message_references reference_row
     where reference_row.tenant_id = new.tenant_id
       and reference_row.id = new.external_message_reference_id
  ) then
    return new;
  end if;

  expected_before := case tg_op
    when 'INSERT' then 'null'::jsonb
    else old.head_detail
  end;
  matching_consumer_count :=
    public.inbox_v2_tm_provider_semantic_consumer_count(
      new, 'null'::jsonb, false
    );
  matching_before_count :=
    public.inbox_v2_tm_provider_semantic_consumer_count(
      new, expected_before, true
    );

  if matching_consumer_count <> 1 or matching_before_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_head_consumer_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_tm_provider_semantic_consumer_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  matching_head_count bigint;
  matching_consumer_count bigint;
  matching_total_consumer_count bigint;
  consumer_before jsonb;
  consumer_after jsonb;
  consumer_stream_position bigint;
begin
  if tg_table_name = 'inbox_v2_message_provider_lifecycle_operations' then
    if new.semantic_ordering_commit_detail is null then
      return new;
    end if;
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = new.tenant_id
         and message_row.id = new.message_id
    ) then
      return new;
    end if;
    consumer_before := new.semantic_ordering_commit_detail -> 'before';
    consumer_after := new.semantic_ordering_commit_detail -> 'after';
    consumer_stream_position := new.created_stream_position;
    select count(*)
      into matching_head_count
      from public.inbox_v2_provider_semantic_ordering_heads head_row
     where head_row.tenant_id = new.tenant_id
       and head_row.external_message_reference_id =
         new.external_message_reference_id
       and head_row.semantic_family_id =
         new.semantic_ordering_commit_detail #>> '{semanticFamilyId}'
       and new.semantic_ordering_commit_detail #>> '{tenantId}' =
         head_row.tenant_id
       and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
         new.provider_semantic_proof_detail,
         head_row.tenant_id
       )
       and head_row.source_account_id = new.source_account_id
       and head_row.source_thread_binding_id = new.source_thread_binding_id
       and head_row.binding_generation = new.binding_generation
       and head_row.normalized_inbound_event_id =
         new.provider_semantic_normalized_inbound_event_id
       and head_row.proof_token = new.provider_semantic_proof_token
       and head_row.scope_token =
         new.provider_semantic_ordering_scope_token
       and head_row.position = new.provider_semantic_ordering_position
       and head_row.comparator_id =
         new.provider_semantic_ordering_comparator_id
       and head_row.comparator_revision =
         new.provider_semantic_ordering_comparator_revision
       and head_row.head_detail =
         new.semantic_ordering_commit_detail -> 'after'
       and new.semantic_ordering_commit_detail -> 'proof' =
         new.provider_semantic_proof_detail
       and (new.semantic_ordering_commit_detail #>>
         '{committedAt}')::timestamptz = head_row.updated_at
       and new.semantic_ordering_commit_digest_sha256 ~ '^[a-f0-9]{64}$'
       and new.provider_semantic_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and head_row.last_changed_stream_position =
         new.created_stream_position;
  elsif tg_table_name =
    'inbox_v2_message_provider_reaction_observations' then
    if not exists (
      select 1
        from public.inbox_v2_message_reaction_transitions transition_row
       where transition_row.tenant_id = new.tenant_id
         and transition_row.id = new.transition_id
    ) then
      return new;
    end if;
    consumer_before := new.ordering_commit_detail -> 'before';
    consumer_after := new.ordering_commit_detail -> 'after';
    select transition_row.recorded_stream_position
      into consumer_stream_position
      from public.inbox_v2_message_reaction_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.id = new.transition_id;
    select count(*)
      into matching_head_count
      from public.inbox_v2_provider_semantic_ordering_heads head_row
      join public.inbox_v2_message_reaction_transitions transition_row
        on transition_row.tenant_id = new.tenant_id
       and transition_row.id = new.transition_id
      join public.inbox_v2_message_reactions reaction_row
        on reaction_row.tenant_id = transition_row.tenant_id
       and reaction_row.id = transition_row.reaction_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = transition_row.tenant_id
       and reference_row.id = transition_row.external_message_reference_id
       and reference_row.message_id = reaction_row.message_id
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = transition_row.tenant_id
       and attribution_row.id = transition_row.action_attribution_id
      join public.inbox_v2_source_occurrences occurrence_actor_row
        on occurrence_actor_row.tenant_id = new.tenant_id
       and occurrence_actor_row.id = new.source_occurrence_id
     where head_row.tenant_id = new.tenant_id
       and transition_row.mode = 'provider_observed'
       and head_row.external_message_reference_id =
         new.semantic_proof_detail #>> '{externalMessageReference,id}'
       and transition_row.external_message_reference_id =
         head_row.external_message_reference_id
       and transition_row.source_occurrence_id = new.source_occurrence_id
       and transition_row.source_account_id = head_row.source_account_id
       and transition_row.source_thread_binding_id =
         head_row.source_thread_binding_id
       and transition_row.binding_generation = head_row.binding_generation
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,id}' =
           transition_row.external_message_reference_id
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{externalMessageReference,kind}' = 'external_message_reference'
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,id}' = transition_row.source_occurrence_id
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceOccurrence,kind}' = 'source_occurrence'
       and transition_row.external_authority_detail #>>
         '{sourceAccount,id}' = transition_row.source_account_id
       and transition_row.external_authority_detail #>>
         '{sourceAccount,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceAccount,kind}' = 'source_account'
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,id}' =
           transition_row.source_thread_binding_id
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,tenantId}' = head_row.tenant_id
       and transition_row.external_authority_detail #>>
         '{sourceThreadBinding,kind}' = 'source_thread_binding'
       and transition_row.external_authority_detail #>>
         '{bindingGeneration}' = transition_row.binding_generation::text
       and transition_row.adapter_contract_id =
         new.semantic_proof_detail #>> '{adapterContract,contractId}'
       and transition_row.adapter_contract_version =
         new.semantic_proof_detail #>> '{adapterContract,contractVersion}'
       and transition_row.capability_id =
         new.semantic_proof_detail #>> '{capabilityId}'
       and transition_row.capability_revision::text =
         new.semantic_proof_detail #>> '{capabilityRevision}'
       and transition_row.external_authority_detail -> 'adapterContract' =
         new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail #>
         '{capabilityFence,adapterContract}' =
           new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail #>>
         '{capabilityFence,capabilityId}' = transition_row.capability_id
       and transition_row.external_authority_detail #>>
         '{capabilityFence,capabilityRevision}' =
           transition_row.capability_revision::text
       and transition_row.external_authority_detail #>>
         '{capabilityFence,decision}' = 'supported'
       and isfinite((transition_row.external_authority_detail #>>
         '{capabilityFence,evaluatedAt}')::timestamptz)
       and isfinite((transition_row.external_authority_detail #>>
         '{capabilityFence,notAfter}')::timestamptz)
       and (transition_row.external_authority_detail #>>
         '{capabilityFence,evaluatedAt}')::timestamptz <=
           transition_row.occurred_at
       and (transition_row.external_authority_detail #>>
         '{capabilityFence,notAfter}')::timestamptz >=
           transition_row.occurred_at
       and (new.semantic_proof_detail #>>
         '{adapterContract,loadedAt}')::timestamptz <=
           transition_row.occurred_at
       and new.semantic_proof_detail #>> '{declaredByTrustedServiceId}' =
         new.semantic_proof_detail #>>
           '{adapterContract,loadedByTrustedServiceId}'
       and reaction_row.capability_kind = 'external'
       and reaction_row.capability_id = transition_row.capability_id
       and reaction_row.capability_revision = transition_row.capability_revision
       and reaction_row.adapter_contract_id = transition_row.adapter_contract_id
       and reaction_row.adapter_contract_version =
         transition_row.adapter_contract_version
       and reaction_row.capability_detail #>> '{kind}' = 'external'
       and reaction_row.capability_detail #>> '{capabilityId}' =
         transition_row.capability_id
       and reaction_row.capability_detail #>> '{capabilityRevision}' =
         transition_row.capability_revision::text
       and reaction_row.capability_detail #>> '{cardinality}' =
         reaction_row.cardinality::text
       and reaction_row.capability_detail -> 'adapterContract' =
         new.semantic_proof_detail -> 'adapterContract'
       and transition_row.external_authority_detail -> 'outboundRoute' =
         'null'::jsonb
       and attribution_row.source_occurrence_id = new.source_occurrence_id
       and attribution_row.conversation_id = reference_row.conversation_id
       and new.semantic_proof_detail #>> '{normalizedInboundEvent,id}' =
         new.normalized_inbound_event_id
       and new.semantic_proof_detail #>> '{sourceOccurrence,id}' =
         new.source_occurrence_id
       and new.semantic_proof_detail #>> '{semanticId}' = new.semantic_id
       and new.semantic_id =
         'core:message.reaction.' || transition_row.operation::text
       and new.semantic_proof_detail #>> '{revision}' = '1'
       and new.semantic_proof_detail #>> '{semanticRevision}' ~
         '^[1-9][0-9]*$'
       and char_length(new.semantic_proof_detail #>> '{semanticRevision}') <=
         19
       and (
         char_length(new.semantic_proof_detail #>> '{semanticRevision}') < 19
         or (new.semantic_proof_detail #>> '{semanticRevision}') collate "C" <=
           '9223372036854775807'
       )
       and new.semantic_proof_detail #>> '{ordering,position}' =
         new.ordering_position
       and head_row.semantic_family_id =
         new.ordering_commit_detail #>> '{semanticFamilyId}'
       and head_row.semantic_family_id = 'core:message.reaction'
       and new.ordering_commit_detail #>> '{tenantId}' = head_row.tenant_id
       and public.inbox_v2_tm_provider_semantic_proof_scope_valid(
         new.semantic_proof_detail,
         head_row.tenant_id
       )
       and head_row.source_account_id =
         new.semantic_proof_detail #>> '{sourceAccount,id}'
       and head_row.source_thread_binding_id =
         new.semantic_proof_detail #>> '{sourceThreadBinding,id}'
       and head_row.binding_generation::text =
         new.semantic_proof_detail #>> '{bindingGeneration}'
       and head_row.normalized_inbound_event_id =
         new.normalized_inbound_event_id
       and head_row.proof_token =
         new.semantic_proof_detail #>> '{proofToken}'
       and head_row.scope_token =
         new.semantic_proof_detail #>> '{ordering,scopeToken}'
       and head_row.position = new.ordering_position
       and head_row.comparator_id =
         new.semantic_proof_detail #>> '{ordering,comparatorId}'
       and head_row.comparator_revision::text =
         new.semantic_proof_detail #>> '{ordering,comparatorRevision}'
       and head_row.head_detail = new.ordering_commit_detail -> 'after'
       and new.ordering_commit_detail -> 'proof' = new.semantic_proof_detail
       and (new.ordering_commit_detail #>> '{committedAt}')::timestamptz =
         head_row.updated_at
       and (new.semantic_proof_detail #>> '{occurredAt}')::timestamptz =
         new.observed_at
       and (new.semantic_proof_detail #>> '{recordedAt}')::timestamptz =
         new.recorded_at
       and transition_row.occurred_at = new.observed_at
       and new.recorded_at <= transition_row.recorded_at
       and transition_row.recorded_at = head_row.updated_at
       and transition_row.after_state_kind = new.normalized_state_kind
       and transition_row.value_kind = new.normalized_value_kind
       and transition_row.unicode_value is not distinct from
         new.normalized_unicode_value
       and transition_row.provider_reaction_kind_id is not distinct from
         new.normalized_provider_reaction_kind_id
       and transition_row.provider_canonical_code is not distinct from
         new.normalized_provider_canonical_code
       and transition_row.after_state_detail #>> '{kind}' =
         transition_row.after_state_kind::text
       and transition_row.after_state_detail #>> (
         case when transition_row.after_state_kind = 'active'
           then array['value', 'kind']
           else array['lastValue', 'kind']
         end
       ) = transition_row.value_kind::text
       and (
         (
           transition_row.value_kind = 'unicode'
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'value']
               else array['lastValue', 'value']
             end
           ) = transition_row.unicode_value
           and transition_row.provider_reaction_kind_id is null
           and transition_row.provider_canonical_code is null
         )
         or (
           transition_row.value_kind = 'provider_custom'
           and transition_row.unicode_value is null
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'providerKindId']
               else array['lastValue', 'providerKindId']
             end
           ) = transition_row.provider_reaction_kind_id
           and transition_row.after_state_detail #>> (
             case when transition_row.after_state_kind = 'active'
               then array['value', 'canonicalCode']
               else array['lastValue', 'canonicalCode']
             end
           ) = transition_row.provider_canonical_code
         )
       )
       and (
         transition_row.after_state_kind = 'active'
         or (transition_row.after_state_detail #>>
           '{clearedAt}')::timestamptz = transition_row.recorded_at
       )
       and (
         (
           coalesce(
             transition_row.before_state_kind = 'pending_external'
             or (
               transition_row.before_state_kind = 'external_terminal'
               and transition_row.before_state_detail #>> '{outcome}' =
                 'outcome_unknown'
             ),
             false
           )
           and (
             new.semantic_proof_detail #>> '{actor,id}' is null
             or occurrence_actor_row.provider_actor_source_external_identity_id
               is null
             or new.semantic_proof_detail #>> '{actor,id}' =
               occurrence_actor_row.provider_actor_source_external_identity_id
           )
           and (
             (
               coalesce(
                 new.semantic_proof_detail #>> '{actor,id}',
                 occurrence_actor_row.provider_actor_source_external_identity_id
               ) is null
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
             )
             or (
               attribution_row.action_participant_id =
                 new.provider_actor_participant_id
               and exists (
                 select 1
                   from public.inbox_v2_conversation_participants participant_row
                  where participant_row.tenant_id = new.tenant_id
                    and participant_row.id =
                      new.provider_actor_participant_id
                    and participant_row.conversation_id =
                      reference_row.conversation_id
                    and participant_row.subject_kind =
                      'source_external_identity'
                    and participant_row.subject_source_external_identity_id =
                      coalesce(
                        new.semantic_proof_detail #>> '{actor,id}',
                        occurrence_actor_row.provider_actor_source_external_identity_id
                      )
               )
             )
           )
         )
         or (
           not coalesce(
             transition_row.before_state_kind = 'pending_external'
             or (
               transition_row.before_state_kind = 'external_terminal'
               and transition_row.before_state_detail #>> '{outcome}' =
                 'outcome_unknown'
             ),
             false
           )
           and (
             (
               occurrence_actor_row.provider_actor_kind =
                 'source_external_identity'
               and new.semantic_proof_detail #>> '{actor,id}' =
                 occurrence_actor_row.provider_actor_source_external_identity_id
               and attribution_row.action_participant_id =
                 new.provider_actor_participant_id
               and reaction_row.actor_kind = 'participant'
               and reaction_row.actor_participant_id =
                 new.provider_actor_participant_id
               and exists (
                 select 1
                   from public.inbox_v2_conversation_participants participant_row
                  where participant_row.tenant_id = new.tenant_id
                    and participant_row.id =
                      new.provider_actor_participant_id
                    and participant_row.conversation_id =
                      reference_row.conversation_id
                    and participant_row.subject_kind =
                      'source_external_identity'
                    and participant_row.subject_source_external_identity_id =
                      occurrence_actor_row.provider_actor_source_external_identity_id
               )
             )
             or (
               occurrence_actor_row.provider_actor_kind = 'provider_system'
               and new.semantic_proof_detail -> 'actor' = 'null'::jsonb
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
               and reaction_row.actor_kind = 'provider_system'
               and reaction_row.actor_source_occurrence_id =
                 occurrence_actor_row.id
               and reaction_row.provider_actor_kind_id =
                 occurrence_actor_row.provider_system_actor_kind_id
               and reaction_row.provider_actor_subject =
                 occurrence_actor_row.provider_system_actor_subject
             )
             or (
               occurrence_actor_row.provider_actor_kind is null
               and new.semantic_proof_detail -> 'actor' = 'null'::jsonb
               and new.provider_actor_participant_id is null
               and attribution_row.action_participant_id is null
               and reaction_row.actor_kind in (
                 'unattributed_source_observation', 'aggregate_only'
               )
               and reaction_row.actor_source_occurrence_id =
                 occurrence_actor_row.id
             )
           )
         )
       )
       and new.ordering_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and new.semantic_proof_digest_sha256 ~ '^[a-f0-9]{64}$'
       and head_row.last_changed_stream_position =
         transition_row.recorded_stream_position
       and exists (
         select 1
           from public.inbox_v2_source_occurrences occurrence_row
          where occurrence_row.tenant_id = new.tenant_id
            and occurrence_row.id = new.source_occurrence_id
            and occurrence_row.normalized_inbound_event_id =
              new.normalized_inbound_event_id
            and occurrence_row.source_account_id = head_row.source_account_id
            and occurrence_row.source_thread_binding_id =
              head_row.source_thread_binding_id
            and occurrence_row.binding_generation =
              head_row.binding_generation
            and occurrence_row.adapter_contract_id =
              new.semantic_proof_detail #>> '{adapterContract,contractId}'
            and occurrence_row.adapter_contract_version =
              new.semantic_proof_detail #>> '{adapterContract,contractVersion}'
            and occurrence_row.adapter_declaration_revision::text =
              new.semantic_proof_detail #>>
                '{adapterContract,declarationRevision}'
            and occurrence_row.adapter_surface_id =
              new.semantic_proof_detail #>> '{adapterContract,surfaceId}'
            and occurrence_row.adapter_loaded_by_trusted_service_id =
              new.semantic_proof_detail #>>
                '{adapterContract,loadedByTrustedServiceId}'
            and occurrence_row.adapter_loaded_at =
              (new.semantic_proof_detail #>>
                '{adapterContract,loadedAt}')::timestamptz
            and occurrence_row.capability_revision::text =
              new.semantic_proof_detail #>> '{capabilityRevision}'
            and occurrence_row.resolution_state = 'resolved'
            and occurrence_row.resolved_external_message_reference_id =
              head_row.external_message_reference_id
       );
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_table_invalid';
  end if;

  if matching_head_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_head_invalid';
  end if;
  select
    public.inbox_v2_tm_provider_semantic_consumer_count(
      head_row, consumer_before, true
    ),
    public.inbox_v2_tm_provider_semantic_consumer_count(
      head_row, 'null'::jsonb, false
    )
    into matching_consumer_count, matching_total_consumer_count
    from public.inbox_v2_provider_semantic_ordering_heads head_row
   where head_row.tenant_id = new.tenant_id
     and head_row.head_detail = consumer_after
     and head_row.last_changed_stream_position = consumer_stream_position;
  if coalesce(matching_consumer_count, 0) <> 1
     or coalesce(matching_total_consumer_count, 0) <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_semantic_ordering_consumer_count_invalid';
  end if;
  return new;
end;
$function$;

create trigger inbox_v2_tm_provider_semantic_head_guard
before insert or update or delete
on public.inbox_v2_provider_semantic_ordering_heads
for each row execute function public.inbox_v2_tm_provider_semantic_head_guard();

create trigger inbox_v2_tm_provider_semantic_json_guard
before insert or update on public.inbox_v2_provider_semantic_ordering_heads
for each row execute function public.inbox_v2_tm_json_guard();

create constraint trigger inbox_v2_tm_provider_semantic_head_consumer_constraint
after insert or update on public.inbox_v2_provider_semantic_ordering_heads
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_head_consumer_guard();

create constraint trigger inbox_v2_tm_provider_semantic_lifecycle_consumer_constraint
after insert on public.inbox_v2_message_provider_lifecycle_operations
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_consumer_head_guard();

create constraint trigger inbox_v2_tm_provider_semantic_reaction_consumer_constraint
after insert on public.inbox_v2_message_provider_reaction_observations
deferrable initially deferred
for each row execute function
  public.inbox_v2_tm_provider_semantic_consumer_head_guard();
