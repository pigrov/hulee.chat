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
