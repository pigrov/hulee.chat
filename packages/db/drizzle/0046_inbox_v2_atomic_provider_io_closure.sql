-- INB2-SRC-007_PROVIDER_IO_ATOMIC_CLOSURE_V1
create table public.inbox_v2_atomic_outbound_dispatch_materializations (
  tenant_id text not null,
  dispatch_id text not null,
  mutation_id text not null,
  stream_commit_id text not null,
  stream_position bigint not null,
  resulting_revision bigint not null,
  created_at timestamp (3) with time zone not null,
  constraint inbox_v2_atomic_outbound_dispatch_materializations_pk
    primary key (tenant_id, dispatch_id),
  constraint inbox_v2_atomic_outbound_dispatch_materializations_tenant_fk
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint inbox_v2_atomic_outbound_dispatch_materializations_stream_fk
    foreign key (
      tenant_id, stream_commit_id, mutation_id, stream_position
    ) references public.inbox_v2_tenant_stream_commits (
      tenant_id, id, mutation_id, position
    ) on delete cascade deferrable initially deferred,
  constraint inbox_v2_atomic_outbound_dispatch_materializations_values_check
    check (
      stream_position >= 1
      and resulting_revision = 1
      and isfinite(created_at)
    )
);

alter table public.inbox_v2_atomic_outbound_dispatch_materializations
  add constraint inbox_v2_atomic_outbound_dispatch_materializations_dispatch_fk
  foreign key (tenant_id, dispatch_id)
  references public.inbox_v2_outbound_dispatches (tenant_id, id)
  on delete cascade deferrable initially deferred;

alter table public.inbox_v2_atomic_outbound_dispatch_materializations
  add constraint inbox_v2_atomic_outbound_dispatch_materializations_mutation_fk
  foreign key (tenant_id, mutation_id)
  references public.inbox_v2_auth_mutation_commits (tenant_id, mutation_id)
  on delete cascade deferrable initially deferred;

create index inbox_v2_atomic_outbound_dispatch_materializations_commit_idx
  on public.inbox_v2_atomic_outbound_dispatch_materializations (
    tenant_id, stream_commit_id, mutation_id, stream_position, dispatch_id
  );

create trigger inbox_v2_atomic_dispatch_materializations_immutable_trigger
before update or delete
on public.inbox_v2_atomic_outbound_dispatch_materializations
for each row execute function public.inbox_v2_auth_reject_immutable();

create table public.inbox_v2_atomic_source_resolution_materializations (
  tenant_id text not null,
  source_occurrence_id text not null,
  resolution_transition_id text not null,
  external_message_reference_id text not null,
  message_id text not null,
  mutation_id text not null,
  stream_commit_id text not null,
  stream_position bigint not null,
  resulting_revision bigint not null,
  created_at timestamp (3) with time zone not null,
  constraint inbox_v2_atomic_source_resolution_materializations_pk
    primary key (tenant_id, source_occurrence_id),
  constraint inbox_v2_atomic_src_resolution_transition_uq
    unique (tenant_id, resolution_transition_id),
  constraint inbox_v2_atomic_source_resolution_materializations_tenant_fk
    foreign key (tenant_id) references public.tenants (id) on delete cascade,
  constraint inbox_v2_atomic_source_resolution_materializations_stream_fk
    foreign key (
      tenant_id, stream_commit_id, mutation_id, stream_position
    ) references public.inbox_v2_tenant_stream_commits (
      tenant_id, id, mutation_id, position
    ) on delete cascade deferrable initially deferred,
  constraint inbox_v2_atomic_source_resolution_materializations_values_check
    check (
      stream_position >= 1
      and resulting_revision >= 2
      and isfinite(created_at)
    )
);

alter table public.inbox_v2_atomic_source_resolution_materializations
  add constraint inbox_v2_atomic_src_resolution_occurrence_fk
  foreign key (tenant_id, source_occurrence_id)
  references public.inbox_v2_source_occurrences (tenant_id, id)
  on delete cascade deferrable initially deferred;

alter table public.inbox_v2_atomic_source_resolution_materializations
  add constraint inbox_v2_atomic_src_resolution_mutation_fk
  foreign key (tenant_id, mutation_id)
  references public.inbox_v2_auth_mutation_commits (tenant_id, mutation_id)
  on delete cascade deferrable initially deferred;

alter table public.inbox_v2_atomic_source_resolution_materializations
  add constraint inbox_v2_atomic_src_resolution_transition_fk
  foreign key (
    tenant_id, resolution_transition_id, source_occurrence_id,
    resulting_revision
  ) references public.inbox_v2_source_occurrence_resolution_transitions (
    tenant_id, id, source_occurrence_id, resulting_revision
  ) on delete cascade deferrable initially deferred;

alter table public.inbox_v2_atomic_source_resolution_materializations
  add constraint inbox_v2_atomic_source_resolution_materializations_reference_fk
  foreign key (tenant_id, external_message_reference_id)
  references public.inbox_v2_external_message_references (tenant_id, id)
  on delete cascade deferrable initially deferred;

alter table public.inbox_v2_atomic_source_resolution_materializations
  add constraint inbox_v2_atomic_source_resolution_materializations_message_fk
  foreign key (tenant_id, message_id)
  references public.inbox_v2_messages (tenant_id, id)
  on delete cascade deferrable initially deferred;

create index inbox_v2_atomic_source_resolution_materializations_commit_idx
  on public.inbox_v2_atomic_source_resolution_materializations (
    tenant_id, stream_commit_id, mutation_id, stream_position,
    source_occurrence_id
  );

create index inbox_v2_atomic_source_resolution_materializations_message_idx
  on public.inbox_v2_atomic_source_resolution_materializations (
    tenant_id, message_id, stream_position
  );

create trigger inbox_v2_atomic_src_resolution_immutable_trigger
before update or delete
on public.inbox_v2_atomic_source_resolution_materializations
for each row execute function public.inbox_v2_auth_reject_immutable();

create or replace function public.inbox_v2_auth_domain_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_command public.inbox_v2_auth_command_records%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_change_count integer;
  v_event_count integer;
  v_authorization_event_count integer;
  v_outbox_count integer;
  v_projection_count integer;
  v_facet_count integer;
  v_invalid_count integer;
  v_message_change_count integer;
  v_message_row_count integer;
  v_source_change_count integer;
  v_source_materialization_count integer;
  v_change_ids jsonb;
  v_event_ids jsonb;
  v_outbox_ids jsonb;
  v_facet_digest text;
  v_stream_manifest_digest text;
  v_mutation_manifest_digest text;
  v_decision_not_after timestamptz;
  v_closed boolean;
  v_empty_digest constant text :=
    'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
begin
  if new.revision_effect_count <> 0
     or new.relation_write_count <> 0
     or new.revision_effect_digest_sha256 <> v_empty_digest
     or new.relation_write_digest_sha256 <> v_empty_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_authorization_delta_forbidden';
  end if;

  select * into strict v_command
    from public.inbox_v2_auth_command_records command_row
   where command_row.tenant_id = new.tenant_id
     and command_row.id = new.command_record_id
     and command_row.mutation_id = new.mutation_id;
  select * into strict v_stream
    from public.inbox_v2_tenant_stream_commits stream_row
   where stream_row.tenant_id = new.tenant_id
     and stream_row.id = new.stream_commit_id
     and stream_row.mutation_id = new.mutation_id;
  select * into strict v_audit
    from public.inbox_v2_auth_audit_events audit_row
   where audit_row.tenant_id = new.tenant_id
     and audit_row.id = new.audit_event_id
     and audit_row.mutation_id = new.mutation_id;

  if v_command.state <> 'completed'
     or v_command.updated_at <> new.committed_at
     or v_stream.committed_at <> new.committed_at
     or v_audit.recorded_at <> new.committed_at
     or v_command.authorized_at > new.committed_at
     or new.committed_at >= v_command.authorization_not_after
     or v_command.authorization_decision_refs <>
        v_stream.authorization_decision_refs
     or row(v_audit.actor_kind, v_audit.actor_employee_id,
            v_audit.actor_trusted_service_id, v_audit.authorization_epoch,
            v_audit.client_mutation_id, v_audit.command_type_id,
            v_audit.request_hash)
       is distinct from
       row(v_command.actor_kind, v_command.actor_employee_id,
           v_command.actor_trusted_service_id, v_command.authorization_epoch,
           v_command.client_mutation_id, v_command.command_type_id,
           v_command.request_hash)
     or v_audit.correlation_id <> v_stream.correlation_id
     or v_audit.authorization_decision_refs <>
        v_stream.authorization_decision_refs
     or v_stream.command_ids <> to_jsonb(array[v_command.id]::text[])
     or v_stream.client_mutation_ids <>
        to_jsonb(array[v_command.client_mutation_id]::text[])
     or v_stream.audience_impact_kind <> 'none'
     or v_stream.audience_impact_manifest <> '{"kind":"none"}'::jsonb then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_command_audit_mismatch';
  end if;

  if not public.inbox_v2_auth_decision_refs_safe(
       v_command.authorization_decision_refs,
       new.tenant_id,
       v_command.authorized_at,
       true
     )
     or not public.inbox_v2_auth_decision_refs_safe(
       v_stream.authorization_decision_refs,
       new.tenant_id,
       new.committed_at,
       true
     )
     or not public.inbox_v2_auth_payload_reference_safe(
       v_audit.evidence_reference, new.tenant_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_decision_manifest_invalid';
  end if;

  select min((decision_ref->>'notAfter')::timestamptz)
    into v_decision_not_after
    from jsonb_array_elements(
      v_command.authorization_decision_refs
    ) decision_ref;
  if v_command.authorization_not_after is distinct from v_decision_not_after
     or not exists (
       select 1
         from jsonb_array_elements(
           v_command.authorization_decision_refs
         ) decision_ref
        where decision_ref->>'id' = v_command.authorization_decision_id
          and decision_ref->>'authorizationEpoch' =
            v_command.authorization_epoch
          and decision_ref->>'outcome' = 'allowed'
     )
     or exists (
       select 1
         from jsonb_array_elements(
           v_command.authorization_decision_refs
         ) decision_ref
        where decision_ref->>'authorizationEpoch' <>
            v_command.authorization_epoch
           or case v_command.actor_kind
             when 'employee' then
               decision_ref->'principal'->>'kind' <> 'employee'
               or decision_ref->'principal'->'employee'->>'tenantId' <>
                 new.tenant_id
               or decision_ref->'principal'->'employee'->>'id' <>
                 v_command.actor_employee_id
             when 'trusted_service' then
               decision_ref->'principal'->>'kind' <> 'trusted_service'
               or decision_ref->'principal'->>'trustedServiceId' <>
                 v_command.actor_trusted_service_id
             else true
           end
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_decision_manifest_invalid';
  end if;

  select count(*)::integer,
         coalesce(to_jsonb(array_agg(change_row.id order by change_row.ordinal)),
                  '[]'::jsonb)
    into v_change_count, v_change_ids
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = new.tenant_id
     and change_row.stream_commit_id = new.stream_commit_id
     and change_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         coalesce(to_jsonb(array_agg(event_row.id order by event_row.ordinal)),
                  '[]'::jsonb),
         count(*) filter (
           where event_row.type_id = 'core:authorization.changed'
         )::integer
    into v_event_count, v_event_ids, v_authorization_event_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.stream_commit_id = new.stream_commit_id
     and event_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         coalesce(to_jsonb(array_agg(intent_row.id order by intent_row.ordinal)),
                  '[]'::jsonb),
         count(*) filter (
           where intent_row.effect_class = 'projection'
             and intent_row.type_id = 'core:projection.update'
         )::integer
    into v_outbox_count, v_outbox_ids, v_projection_count
    from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = new.tenant_id
     and intent_row.stream_commit_id = new.stream_commit_id
     and intent_row.mutation_id = new.mutation_id;

  if row(v_change_count, v_event_count, v_outbox_count,
         v_change_ids, v_event_ids, v_outbox_ids)
       is distinct from
     row(v_stream.change_count, v_stream.event_count,
         v_stream.outbox_intent_count, v_stream.change_ids,
         v_stream.event_ids, v_stream.outbox_intent_ids)
     or v_projection_count <> new.projection_intent_count
     or v_projection_count < 1
     or v_authorization_event_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_stream_manifest_incomplete';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = new.tenant_id
     and change_row.stream_commit_id = new.stream_commit_id
     and (change_row.mutation_id <> new.mutation_id
       or change_row.stream_position <> v_stream.position
       or change_row.created_at <> new.committed_at
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.domain_commit_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.payload_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_json_tenant_safe(
         change_row.timeline, new.tenant_id
       ));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.stream_commit_id = new.stream_commit_id
     and (event_row.mutation_id <> new.mutation_id
       or event_row.stream_position <> v_stream.position
       or event_row.recorded_at <> new.committed_at
       or event_row.correlation_id <> v_stream.correlation_id
       or event_row.command_ids <> v_stream.command_ids
       or event_row.client_mutation_ids <> v_stream.client_mutation_ids
       or event_row.authorization_decision_refs <>
          v_stream.authorization_decision_refs
       or event_row.access_effect <> 'none'
       or event_row.access_effect_causes <> '[]'::jsonb
       or not (v_stream.change_ids @> event_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         event_row.payload_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_json_tenant_safe(
         event_row.subjects, new.tenant_id
       )
       or not public.inbox_v2_auth_decision_refs_safe(
         event_row.authorization_decision_refs,
         new.tenant_id,
         new.committed_at,
         true
       ));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_outbox_intents intent_row
    join public.inbox_v2_domain_events event_row
      on event_row.tenant_id = intent_row.tenant_id
     and event_row.id = intent_row.event_id
   where intent_row.tenant_id = new.tenant_id
     and intent_row.stream_commit_id = new.stream_commit_id
     and (intent_row.mutation_id <> new.mutation_id
       or intent_row.stream_position <> v_stream.position
       or intent_row.created_at <> new.committed_at
       or intent_row.available_at < new.committed_at
       or intent_row.correlation_id <> v_stream.correlation_id
       or event_row.stream_commit_id <> new.stream_commit_id
       or event_row.mutation_id <> new.mutation_id
       or event_row.correlation_id <> intent_row.correlation_id
       or (
         intent_row.type_id = 'core:provider.dispatch'
         and intent_row.effect_class <> 'provider_io'
       )
       or (
         intent_row.effect_class = 'provider_io'
         and (
           intent_row.type_id <> 'core:provider.dispatch'
           or intent_row.payload_reference is null
           or intent_row.payload_reference->>'schemaId' <>
             'core:inbox-v2.outbound-dispatch'
           or intent_row.payload_reference->>'schemaVersion' <> 'v1'
           or jsonb_array_length(intent_row.change_ids) <> 1
           or event_row.type_id <> 'core:message.changed'
           or exists (
             select 1
               from public.inbox_v2_tenant_stream_changes referenced_change
              where referenced_change.tenant_id = intent_row.tenant_id
                and referenced_change.stream_commit_id =
                  intent_row.stream_commit_id
                and referenced_change.mutation_id = intent_row.mutation_id
                and referenced_change.id in (
                  select jsonb_array_elements_text(intent_row.change_ids)
                )
                and (
                  referenced_change.audience = 'staff_only'
                  or referenced_change.entity_type_id = 'core:staff-note'
                )
           )
           or not exists (
             select 1
               from public.inbox_v2_tenant_stream_changes dispatch_change
              where dispatch_change.tenant_id = intent_row.tenant_id
                and dispatch_change.stream_commit_id =
                  intent_row.stream_commit_id
                and dispatch_change.mutation_id = intent_row.mutation_id
                and dispatch_change.id in (
                  select jsonb_array_elements_text(intent_row.change_ids)
                )
                and dispatch_change.entity_type_id =
                  'core:outbound-dispatch'
                and dispatch_change.entity_id =
                  intent_row.payload_reference->>'recordId'
                and dispatch_change.state_kind = 'upsert'
                and dispatch_change.state_schema_id =
                  'core:inbox-v2.outbound-dispatch'
                 and dispatch_change.state_schema_version = 'v1'
                 and dispatch_change.payload_reference =
                   intent_row.payload_reference
                 and dispatch_change.state_hash =
                   dispatch_change.payload_reference->>'digest'
                 and dispatch_change.resulting_revision = 1
                 and exists (
                   select 1
                     from public.inbox_v2_outbound_dispatches dispatch_row
                     join public.inbox_v2_atomic_outbound_dispatch_materializations
                       materialization_row
                       on materialization_row.tenant_id = dispatch_row.tenant_id
                      and materialization_row.dispatch_id = dispatch_row.id
                    where dispatch_row.tenant_id = dispatch_change.tenant_id
                      and dispatch_row.id = dispatch_change.entity_id
                      and materialization_row.mutation_id =
                        dispatch_change.mutation_id
                      and materialization_row.stream_commit_id =
                        dispatch_change.stream_commit_id
                      and materialization_row.stream_position =
                        dispatch_change.stream_position
                      and materialization_row.resulting_revision =
                        dispatch_change.resulting_revision
                      and materialization_row.created_at = new.committed_at
                      and dispatch_row.state = 'queued'
                     and dispatch_row.attempt_count = 0
                     and dispatch_row.active_attempt_id is null
                     and dispatch_row.last_attempt_id is null
                     and dispatch_row.retry_authorization_decision_id is null
                     and dispatch_row.revision = 1
                     and dispatch_row.created_at = new.committed_at
                      and dispatch_row.updated_at = new.committed_at
                      and event_row.subjects @> jsonb_build_array(
                        jsonb_build_object(
                          'tenantId', dispatch_change.tenant_id,
                          'entityTypeId', 'core:message',
                          'entityId', dispatch_row.message_id
                        )
                      )
                      and not exists (
                       select 1
                         from public.inbox_v2_outbound_dispatch_attempts
                           attempt_row
                        where attempt_row.tenant_id = dispatch_row.tenant_id
                          and attempt_row.dispatch_id = dispatch_row.id
                     )
                )
           )
         )
       )
       or not (v_stream.change_ids @> intent_row.change_ids)
       or not (event_row.change_ids @> intent_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         intent_row.payload_reference, new.tenant_id
       ));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes dispatch_change
    left join public.inbox_v2_atomic_outbound_dispatch_materializations
      materialization_row
      on materialization_row.tenant_id = dispatch_change.tenant_id
     and materialization_row.dispatch_id = dispatch_change.entity_id
     and materialization_row.stream_commit_id =
       dispatch_change.stream_commit_id
     and materialization_row.mutation_id = dispatch_change.mutation_id
     and materialization_row.stream_position =
       dispatch_change.stream_position
    left join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = dispatch_change.tenant_id
     and dispatch_row.id = dispatch_change.entity_id
   where dispatch_change.tenant_id = new.tenant_id
     and dispatch_change.stream_commit_id = new.stream_commit_id
     and dispatch_change.mutation_id = new.mutation_id
     and dispatch_change.entity_type_id = 'core:outbound-dispatch'
     and (
       dispatch_change.resulting_revision <> 1
       or dispatch_change.state_kind <> 'upsert'
       or dispatch_change.state_schema_id is distinct from
          'core:inbox-v2.outbound-dispatch'
       or dispatch_change.state_schema_version is distinct from 'v1'
       or dispatch_change.payload_reference->>'recordId' is distinct from
          dispatch_change.entity_id
       or dispatch_change.payload_reference->>'schemaId' is distinct from
          'core:inbox-v2.outbound-dispatch'
       or dispatch_change.payload_reference->>'schemaVersion' is distinct from
          'v1'
       or dispatch_change.state_hash is distinct from
          dispatch_change.payload_reference->>'digest'
       or materialization_row.dispatch_id is null
       or materialization_row.resulting_revision is distinct from
          dispatch_change.resulting_revision
       or materialization_row.created_at <> new.committed_at
       or dispatch_row.id is null
       or dispatch_row.state <> 'queued'
       or dispatch_row.attempt_count <> 0
       or dispatch_row.active_attempt_id is not null
       or dispatch_row.last_attempt_id is not null
       or dispatch_row.retry_authorization_decision_id is not null
       or dispatch_row.revision <> 1
       or dispatch_row.created_at <> new.committed_at
       or dispatch_row.updated_at <> new.committed_at
       or exists (
         select 1
           from public.inbox_v2_outbound_dispatch_attempts attempt_row
          where attempt_row.tenant_id = dispatch_change.tenant_id
            and attempt_row.dispatch_id = dispatch_change.entity_id
       )
       or (
         select count(*)
           from public.inbox_v2_tenant_stream_changes sibling_change
          where sibling_change.tenant_id = dispatch_change.tenant_id
            and sibling_change.stream_commit_id =
              dispatch_change.stream_commit_id
             and sibling_change.mutation_id = dispatch_change.mutation_id
             and sibling_change.entity_type_id = 'core:outbound-dispatch'
             and sibling_change.entity_id = dispatch_change.entity_id
       ) <> 1
       or (
         select count(*)
           from public.inbox_v2_outbox_intents provider_intent
          where provider_intent.tenant_id = dispatch_change.tenant_id
            and provider_intent.stream_commit_id =
              dispatch_change.stream_commit_id
            and provider_intent.mutation_id = dispatch_change.mutation_id
            and provider_intent.effect_class = 'provider_io'
            and provider_intent.type_id = 'core:provider.dispatch'
            and provider_intent.payload_reference->>'recordId' =
              dispatch_change.entity_id
            and provider_intent.payload_reference->>'schemaId' =
              'core:inbox-v2.outbound-dispatch'
            and provider_intent.payload_reference->>'schemaVersion' = 'v1'
            and jsonb_array_length(provider_intent.change_ids) = 1
            and provider_intent.change_ids ? dispatch_change.id
            and exists (
              select 1
                from public.inbox_v2_domain_events message_event
               where message_event.tenant_id = provider_intent.tenant_id
                 and message_event.id = provider_intent.event_id
                 and message_event.stream_commit_id =
                   provider_intent.stream_commit_id
                 and message_event.mutation_id = provider_intent.mutation_id
                 and message_event.type_id = 'core:message.changed'
                 and message_event.change_ids ? dispatch_change.id
                 and message_event.subjects @> jsonb_build_array(
                   jsonb_build_object(
                     'tenantId', dispatch_change.tenant_id,
                     'entityTypeId', 'core:message',
                     'entityId', dispatch_row.message_id
                   )
                 )
            )
       ) <> 1
       or not exists (
         select 1
           from public.inbox_v2_outbox_intents provider_intent
          where provider_intent.tenant_id = dispatch_change.tenant_id
            and provider_intent.stream_commit_id =
              dispatch_change.stream_commit_id
            and provider_intent.mutation_id = dispatch_change.mutation_id
            and provider_intent.effect_class = 'provider_io'
            and provider_intent.type_id = 'core:provider.dispatch'
            and provider_intent.payload_reference =
              dispatch_change.payload_reference
            and jsonb_array_length(provider_intent.change_ids) = 1
            and provider_intent.change_ids ? dispatch_change.id
            and exists (
              select 1
                from public.inbox_v2_domain_events message_event
               where message_event.tenant_id = provider_intent.tenant_id
                 and message_event.id = provider_intent.event_id
                 and message_event.stream_commit_id =
                   provider_intent.stream_commit_id
                 and message_event.mutation_id = provider_intent.mutation_id
                 and message_event.type_id = 'core:message.changed'
                 and message_event.change_ids ? dispatch_change.id
                 and message_event.subjects @> jsonb_build_array(
                   jsonb_build_object(
                     'tenantId', dispatch_change.tenant_id,
                     'entityTypeId', 'core:message',
                     'entityId', dispatch_row.message_id
                   )
                 )
                 )
            )
       or (
         select count(*)
           from public.inbox_v2_outbox_intents projection_intent
           join public.inbox_v2_domain_events projection_event
             on projection_event.tenant_id = projection_intent.tenant_id
            and projection_event.id = projection_intent.event_id
          where projection_intent.tenant_id = dispatch_change.tenant_id
            and projection_intent.stream_commit_id =
              dispatch_change.stream_commit_id
            and projection_intent.mutation_id = dispatch_change.mutation_id
            and projection_intent.effect_class = 'projection'
            and projection_intent.type_id = 'core:projection.update'
            and projection_intent.change_ids ? dispatch_change.id
            and projection_event.stream_commit_id =
              dispatch_change.stream_commit_id
            and projection_event.mutation_id = dispatch_change.mutation_id
            and projection_event.type_id = 'core:message.changed'
            and projection_event.change_ids ? dispatch_change.id
            and projection_event.subjects @> jsonb_build_array(
              jsonb_build_object(
                'tenantId', dispatch_change.tenant_id,
                'entityTypeId', 'core:message',
                'entityId', dispatch_row.message_id
              )
            )
       ) <> 1
     );
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_atomic_outbound_dispatch_materializations
      materialization_row
    left join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = materialization_row.tenant_id
     and dispatch_row.id = materialization_row.dispatch_id
   where materialization_row.tenant_id = new.tenant_id
     and materialization_row.stream_commit_id = new.stream_commit_id
     and materialization_row.mutation_id = new.mutation_id
     and materialization_row.stream_position = v_stream.position
     and (
       materialization_row.resulting_revision <> 1
       or materialization_row.created_at <> new.committed_at
       or dispatch_row.id is null
       or dispatch_row.state <> 'queued'
       or dispatch_row.attempt_count <> 0
       or dispatch_row.active_attempt_id is not null
       or dispatch_row.last_attempt_id is not null
       or dispatch_row.retry_authorization_decision_id is not null
       or dispatch_row.revision <> materialization_row.resulting_revision
       or dispatch_row.created_at <> new.committed_at
       or dispatch_row.updated_at <> new.committed_at
       or exists (
         select 1
           from public.inbox_v2_outbound_dispatch_attempts attempt_row
          where attempt_row.tenant_id = materialization_row.tenant_id
            and attempt_row.dispatch_id = materialization_row.dispatch_id
       )
       or not exists (
         select 1
           from public.inbox_v2_tenant_stream_changes dispatch_change
          where dispatch_change.tenant_id = materialization_row.tenant_id
            and dispatch_change.stream_commit_id =
              materialization_row.stream_commit_id
            and dispatch_change.mutation_id = materialization_row.mutation_id
            and dispatch_change.stream_position =
              materialization_row.stream_position
            and dispatch_change.entity_type_id = 'core:outbound-dispatch'
            and dispatch_change.entity_id = materialization_row.dispatch_id
            and dispatch_change.resulting_revision =
              materialization_row.resulting_revision
       )
     );

  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes message_change
    left join public.inbox_v2_messages message_row
      on message_row.tenant_id = message_change.tenant_id
     and message_row.id = message_change.entity_id
    left join public.inbox_v2_timeline_items timeline_row
      on timeline_row.tenant_id = message_row.tenant_id
     and timeline_row.id = message_row.timeline_item_id
    left join public.inbox_v2_timeline_contents content_row
      on content_row.tenant_id = message_row.tenant_id
     and content_row.id = message_row.content_id
    left join public.inbox_v2_timeline_content_revisions
      content_revision_row
      on content_revision_row.tenant_id = content_row.tenant_id
     and content_revision_row.content_id = content_row.id
     and content_revision_row.revision = content_row.revision
    left join public.inbox_v2_message_revisions initial_revision_row
      on initial_revision_row.tenant_id = message_change.tenant_id
     and initial_revision_row.id =
       message_change.domain_commit_reference->>'recordId'
   where message_change.tenant_id = new.tenant_id
     and message_change.stream_commit_id = new.stream_commit_id
     and message_change.mutation_id = new.mutation_id
     and message_change.entity_type_id = 'core:message'
     and (
       message_change.resulting_revision <> 1
       or message_change.state_kind <> 'upsert'
       or message_change.state_schema_id is distinct from
          'core:inbox-v2.message'
       or message_change.state_schema_version is distinct from 'v1'
       or message_change.payload_reference->>'tenantId' is distinct from
          message_change.tenant_id
       or message_change.payload_reference->>'recordId' is distinct from
          message_change.entity_id
       or message_change.payload_reference->>'schemaId' is distinct from
          'core:inbox-v2.message'
       or message_change.payload_reference->>'schemaVersion' is distinct from
          'v1'
       or message_change.payload_reference is distinct from
          v_command.result_reference
       or message_change.state_hash is distinct from
          message_change.payload_reference->>'digest'
       or message_change.domain_commit_reference->>'tenantId' is distinct from
          message_change.tenant_id
       or message_change.domain_commit_reference->>'schemaId' is distinct from
          'core:inbox-v2.message-creation-commit'
       or message_change.domain_commit_reference->>'schemaVersion' is distinct
          from 'v1'
       or v_audit.evidence_reference is distinct from
          message_change.domain_commit_reference
       or message_change.audience not in (
         'conversation_external', 'internal_participants'
       )
       or message_row.id is null
       or message_row.revision <> message_change.resulting_revision
       or message_row.last_changed_stream_position <>
          message_change.stream_position
       or message_row.created_at <> new.committed_at
       or message_row.updated_at <> new.committed_at
       or timeline_row.id is null
       or timeline_row.subject_kind <> 'message'
       or timeline_row.subject_id <> message_row.id
       or timeline_row.conversation_id <> message_row.conversation_id
       or timeline_row.revision <> message_row.revision
       or timeline_row.visibility::text <> message_change.audience::text
       or timeline_row.last_changed_stream_position <>
          message_change.stream_position
       or timeline_row.created_at <> new.committed_at
       or timeline_row.updated_at <> new.committed_at
       or content_row.id is null
       or content_row.owner_kind <> 'message'
       or content_row.owner_id <> message_row.id
       or content_row.revision <> message_row.content_revision
       or content_row.state <> message_row.content_state
       or content_row.last_changed_stream_position <>
          message_change.stream_position
       or content_row.created_at <> new.committed_at
       or content_row.updated_at <> new.committed_at
       or content_revision_row.content_id is null
       or content_revision_row.revision <> 1
       or content_revision_row.transition_kind <> 'created'
       or content_revision_row.expected_previous_revision is not null
       or content_revision_row.recorded_stream_position <>
          message_change.stream_position
       or content_revision_row.recorded_at <> new.committed_at
       or message_change.timeline is distinct from jsonb_build_object(
         'conversation', jsonb_build_object(
           'tenantId', message_row.tenant_id,
           'id', message_row.conversation_id,
           'kind', 'conversation'
         ),
         'timelineSequence', timeline_row.timeline_sequence::text
       )
       or initial_revision_row.id is null
       or initial_revision_row.message_id <> message_row.id
       or initial_revision_row.timeline_item_id <> message_row.timeline_item_id
       or initial_revision_row.message_revision <> 1
       or initial_revision_row.change_kind <> 'created'
       or initial_revision_row.expected_previous_revision is not null
       or initial_revision_row.recorded_stream_position <>
          message_change.stream_position
       or initial_revision_row.recorded_at <> new.committed_at
       or (
         select count(*)
           from public.inbox_v2_domain_events message_event
          where message_event.tenant_id = message_change.tenant_id
            and message_event.stream_commit_id =
              message_change.stream_commit_id
            and message_event.mutation_id = message_change.mutation_id
            and message_event.type_id = 'core:message.changed'
            and message_event.payload_schema_id =
              message_change.domain_commit_reference->>'schemaId'
            and message_event.payload_schema_version =
              message_change.domain_commit_reference->>'schemaVersion'
            and message_event.payload_reference =
              message_change.domain_commit_reference
            and message_event.change_ids ? message_change.id
            and message_event.subjects @> jsonb_build_array(
              jsonb_build_object(
                'tenantId', message_change.tenant_id,
                'entityTypeId', 'core:message',
                'entityId', message_change.entity_id
              )
            )
            and message_event.occurred_at = initial_revision_row.occurred_at
            and message_event.recorded_at = new.committed_at
       ) <> 1
       or (
         select count(*)
           from public.inbox_v2_domain_events related_event
          where related_event.tenant_id = message_change.tenant_id
            and related_event.stream_commit_id =
              message_change.stream_commit_id
            and related_event.mutation_id = message_change.mutation_id
            and (
              related_event.change_ids ? message_change.id
              or related_event.subjects @> jsonb_build_array(
                jsonb_build_object(
                  'tenantId', message_change.tenant_id,
                  'entityTypeId', 'core:message',
                  'entityId', message_change.entity_id
                )
              )
            )
       ) <> 1
       or (
         select count(*)
           from public.inbox_v2_outbox_intents projection_intent
           join public.inbox_v2_domain_events projection_event
             on projection_event.tenant_id = projection_intent.tenant_id
            and projection_event.id = projection_intent.event_id
          where projection_intent.tenant_id = message_change.tenant_id
            and projection_intent.stream_commit_id =
              message_change.stream_commit_id
            and projection_intent.mutation_id = message_change.mutation_id
            and projection_intent.effect_class = 'projection'
            and projection_intent.type_id = 'core:projection.update'
            and projection_intent.change_ids ? message_change.id
            and projection_event.stream_commit_id =
              message_change.stream_commit_id
            and projection_event.mutation_id = message_change.mutation_id
            and projection_event.type_id = 'core:message.changed'
            and projection_event.change_ids ? message_change.id
       ) <> 1
       or (message_row.origin_kind = 'source_originated' and (
         select count(*)
           from public.inbox_v2_atomic_source_resolution_materializations
             source_materialization
          where source_materialization.tenant_id = message_change.tenant_id
            and source_materialization.message_id = message_change.entity_id
            and source_materialization.mutation_id = message_change.mutation_id
            and source_materialization.stream_commit_id =
              message_change.stream_commit_id
            and source_materialization.stream_position =
              message_change.stream_position
       ) <> 1)
       or (message_row.origin_kind <> 'source_originated' and exists (
         select 1
           from public.inbox_v2_atomic_source_resolution_materializations
             source_materialization
          where source_materialization.tenant_id = message_change.tenant_id
            and source_materialization.message_id = message_change.entity_id
            and source_materialization.mutation_id = message_change.mutation_id
            and source_materialization.stream_commit_id =
              message_change.stream_commit_id
       ))
     );

  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes occurrence_change
    left join public.inbox_v2_atomic_source_resolution_materializations
      source_materialization
      on source_materialization.tenant_id = occurrence_change.tenant_id
     and source_materialization.source_occurrence_id =
       occurrence_change.entity_id
     and source_materialization.mutation_id = occurrence_change.mutation_id
     and source_materialization.stream_commit_id =
       occurrence_change.stream_commit_id
     and source_materialization.stream_position =
       occurrence_change.stream_position
    left join public.inbox_v2_source_occurrences occurrence_row
      on occurrence_row.tenant_id = occurrence_change.tenant_id
     and occurrence_row.id = occurrence_change.entity_id
    left join public.inbox_v2_source_occurrence_resolution_transitions
      transition_row
      on transition_row.tenant_id = source_materialization.tenant_id
     and transition_row.id = source_materialization.resolution_transition_id
    left join public.inbox_v2_external_message_references reference_row
      on reference_row.tenant_id = source_materialization.tenant_id
     and reference_row.id =
       source_materialization.external_message_reference_id
    left join public.inbox_v2_messages message_row
      on message_row.tenant_id = source_materialization.tenant_id
     and message_row.id = source_materialization.message_id
   where occurrence_change.tenant_id = new.tenant_id
     and occurrence_change.stream_commit_id = new.stream_commit_id
     and occurrence_change.mutation_id = new.mutation_id
     and occurrence_change.entity_type_id = 'core:source-occurrence'
     and (
       occurrence_change.state_kind <> 'upsert'
       or occurrence_change.state_schema_id is distinct from
          'core:inbox-v2.source-occurrence'
       or occurrence_change.state_schema_version is distinct from 'v1'
       or occurrence_change.timeline is not null
       or occurrence_change.audience <> 'policy_filtered'
       or occurrence_change.payload_reference->>'tenantId' is distinct from
          occurrence_change.tenant_id
       or occurrence_change.payload_reference->>'recordId' is distinct from
          occurrence_change.entity_id
       or occurrence_change.payload_reference->>'schemaId' is distinct from
          'core:inbox-v2.source-occurrence'
       or occurrence_change.payload_reference->>'schemaVersion' is distinct
          from 'v1'
       or occurrence_change.state_hash is distinct from
          occurrence_change.payload_reference->>'digest'
       or occurrence_change.domain_commit_reference->>'tenantId' is distinct
          from occurrence_change.tenant_id
       or occurrence_change.domain_commit_reference->>'schemaId' is distinct
          from 'core:inbox-v2.source-occurrence-resolution-commit'
       or occurrence_change.domain_commit_reference->>'schemaVersion' is
          distinct from 'v1'
       or source_materialization.source_occurrence_id is null
       or source_materialization.resulting_revision is distinct from
          occurrence_change.resulting_revision
       or source_materialization.created_at <> new.committed_at
       or source_materialization.resolution_transition_id is distinct from
          occurrence_change.domain_commit_reference->>'recordId'
       or occurrence_row.id is null
       or occurrence_row.revision <> occurrence_change.resulting_revision
       or occurrence_row.resolution_state <> 'resolved'
       or occurrence_row.resolved_external_message_reference_id is distinct
          from source_materialization.external_message_reference_id
       or occurrence_row.updated_at <> new.committed_at
       or transition_row.id is null
       or transition_row.source_occurrence_id <> occurrence_row.id
       or transition_row.resulting_revision <>
          source_materialization.resulting_revision
       or transition_row.to_state <> 'resolved'
       or transition_row.resolved_external_message_reference_id is distinct
          from source_materialization.external_message_reference_id
       or transition_row.changed_at <> new.committed_at
       or reference_row.id is null
       or reference_row.message_id <> source_materialization.message_id
       or message_row.id is null
       or message_row.origin_kind <> 'source_originated'
       or message_row.origin_source_occurrence_id <> occurrence_row.id
       or message_row.revision <> 1
       or message_row.last_changed_stream_position <>
          occurrence_change.stream_position
       or message_row.created_at <> new.committed_at
       or (
         select count(*)
           from public.inbox_v2_domain_events occurrence_event
          where occurrence_event.tenant_id = occurrence_change.tenant_id
            and occurrence_event.stream_commit_id =
              occurrence_change.stream_commit_id
            and occurrence_event.mutation_id = occurrence_change.mutation_id
            and occurrence_event.type_id = 'core:source-occurrence.changed'
            and occurrence_event.payload_schema_id =
              occurrence_change.domain_commit_reference->>'schemaId'
            and occurrence_event.payload_schema_version =
              occurrence_change.domain_commit_reference->>'schemaVersion'
            and occurrence_event.payload_reference =
              occurrence_change.domain_commit_reference
            and occurrence_event.change_ids ? occurrence_change.id
            and occurrence_event.subjects @> jsonb_build_array(
              jsonb_build_object(
                'tenantId', occurrence_change.tenant_id,
                'entityTypeId', 'core:source-occurrence',
                'entityId', occurrence_change.entity_id
              )
            )
            and occurrence_event.occurred_at = transition_row.changed_at
            and occurrence_event.recorded_at = new.committed_at
       ) <> 1
       or (
         select count(*)
           from public.inbox_v2_domain_events related_event
          where related_event.tenant_id = occurrence_change.tenant_id
            and related_event.stream_commit_id =
              occurrence_change.stream_commit_id
            and related_event.mutation_id = occurrence_change.mutation_id
            and (
              related_event.change_ids ? occurrence_change.id
              or related_event.subjects @> jsonb_build_array(
                jsonb_build_object(
                  'tenantId', occurrence_change.tenant_id,
                  'entityTypeId', 'core:source-occurrence',
                  'entityId', occurrence_change.entity_id
                )
              )
            )
       ) <> 1
       or (
         select count(*)
           from public.inbox_v2_outbox_intents projection_intent
           join public.inbox_v2_domain_events projection_event
             on projection_event.tenant_id = projection_intent.tenant_id
            and projection_event.id = projection_intent.event_id
          where projection_intent.tenant_id = occurrence_change.tenant_id
            and projection_intent.stream_commit_id =
              occurrence_change.stream_commit_id
            and projection_intent.mutation_id = occurrence_change.mutation_id
            and projection_intent.effect_class = 'projection'
            and projection_intent.type_id = 'core:projection.update'
            and projection_intent.change_ids ? occurrence_change.id
            and projection_event.stream_commit_id =
              occurrence_change.stream_commit_id
            and projection_event.mutation_id = occurrence_change.mutation_id
            and projection_event.type_id = 'core:source-occurrence.changed'
            and projection_event.change_ids ? occurrence_change.id
       ) <> 1
     );

  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_atomic_source_resolution_materializations
      source_materialization
    left join public.inbox_v2_source_occurrences occurrence_row
      on occurrence_row.tenant_id = source_materialization.tenant_id
     and occurrence_row.id = source_materialization.source_occurrence_id
    left join public.inbox_v2_source_occurrence_resolution_transitions
      transition_row
      on transition_row.tenant_id = source_materialization.tenant_id
     and transition_row.id = source_materialization.resolution_transition_id
   where source_materialization.tenant_id = new.tenant_id
     and source_materialization.stream_commit_id = new.stream_commit_id
     and source_materialization.mutation_id = new.mutation_id
     and source_materialization.stream_position = v_stream.position
     and (
       source_materialization.resulting_revision < 2
       or source_materialization.created_at <> new.committed_at
       or occurrence_row.id is null
       or occurrence_row.revision <> source_materialization.resulting_revision
       or occurrence_row.resolution_state <> 'resolved'
       or occurrence_row.resolved_external_message_reference_id is distinct
          from source_materialization.external_message_reference_id
       or occurrence_row.updated_at <> new.committed_at
       or transition_row.id is null
       or transition_row.source_occurrence_id <>
          source_materialization.source_occurrence_id
       or transition_row.resulting_revision <>
          source_materialization.resulting_revision
       or transition_row.resolved_external_message_reference_id is distinct
          from source_materialization.external_message_reference_id
       or transition_row.changed_at <> new.committed_at
       or (
         select count(*)
           from public.inbox_v2_tenant_stream_changes occurrence_change
          where occurrence_change.tenant_id = source_materialization.tenant_id
            and occurrence_change.stream_commit_id =
              source_materialization.stream_commit_id
            and occurrence_change.mutation_id = source_materialization.mutation_id
            and occurrence_change.stream_position =
              source_materialization.stream_position
            and occurrence_change.entity_type_id = 'core:source-occurrence'
            and occurrence_change.entity_id =
              source_materialization.source_occurrence_id
            and occurrence_change.resulting_revision =
              source_materialization.resulting_revision
       ) <> 1
     );

  if v_command.command_type_id in ('core:message.send', 'core:message.receive')
  then
    select count(*)::integer into v_message_change_count
      from public.inbox_v2_tenant_stream_changes message_change
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message';
    select count(*)::integer into v_message_row_count
      from public.inbox_v2_messages message_row
     where message_row.tenant_id = new.tenant_id
       and message_row.revision = 1
       and message_row.last_changed_stream_position = v_stream.position
       and message_row.created_at = new.committed_at
       and message_row.updated_at = new.committed_at;
    select count(*)::integer into v_source_change_count
      from public.inbox_v2_tenant_stream_changes occurrence_change
     where occurrence_change.tenant_id = new.tenant_id
       and occurrence_change.stream_commit_id = new.stream_commit_id
       and occurrence_change.mutation_id = new.mutation_id
       and occurrence_change.stream_position = v_stream.position
       and occurrence_change.entity_type_id = 'core:source-occurrence';
    select count(*)::integer into v_source_materialization_count
      from public.inbox_v2_atomic_source_resolution_materializations
        source_materialization
     where source_materialization.tenant_id = new.tenant_id
       and source_materialization.stream_commit_id = new.stream_commit_id
       and source_materialization.mutation_id = new.mutation_id
       and source_materialization.stream_position = v_stream.position;

    if v_message_change_count <> 1
       or v_message_row_count <> 1
       or (
         v_command.command_type_id = 'core:message.receive'
         and (
           v_source_change_count <> 1
           or v_source_materialization_count <> 1
         )
       )
       or (
         v_command.command_type_id = 'core:message.send'
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.domain_mutation_message_cardinality_invalid';
    end if;
  end if;

  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_stream_child_mismatch';
  end if;

  select 'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           manifest_row.item_hash,
           chr(10) order by manifest_row.kind_ordinal, manifest_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_stream_manifest_digest
    from (
      select 1 as kind_ordinal, change_row.ordinal,
             'change:' || change_row.state_hash as item_hash
        from public.inbox_v2_tenant_stream_changes change_row
       where change_row.tenant_id = new.tenant_id
         and change_row.stream_commit_id = new.stream_commit_id
      union all
      select 2, event_row.ordinal, 'event:' || event_row.event_hash
        from public.inbox_v2_domain_events event_row
       where event_row.tenant_id = new.tenant_id
         and event_row.stream_commit_id = new.stream_commit_id
      union all
      select 3, intent_row.ordinal, 'intent:' || intent_row.intent_hash
        from public.inbox_v2_outbox_intents intent_row
       where intent_row.tenant_id = new.tenant_id
         and intent_row.stream_commit_id = new.stream_commit_id
    ) manifest_row;
  if v_stream_manifest_digest <> v_stream.manifest_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_stream_digest_mismatch';
  end if;

  if exists (
       select 1 from public.inbox_v2_auth_revision_effects effect_row
        where effect_row.tenant_id = new.tenant_id
          and effect_row.mutation_id = new.mutation_id
     )
     or exists (
       select 1 from public.inbox_v2_auth_relation_writes write_row
        where write_row.tenant_id = new.tenant_id
          and write_row.mutation_id = new.mutation_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_authorization_delta_forbidden';
  end if;

  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           facet_row.facet_hash, chr(10) order by facet_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_facet_count, v_facet_digest
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = new.tenant_id
     and facet_row.audit_event_id = new.audit_event_id;
  if row(v_facet_count, v_facet_digest)
       is distinct from
     row(v_audit.facet_count, v_audit.facets_digest_sha256)
     or v_audit.revision_delta_hash <> v_empty_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_audit_manifest_incomplete';
  end if;

  select stream_head.last_position = v_stream.position
         and stream_head.stream_epoch = v_stream.stream_epoch
         and stream_head.updated_at = new.committed_at
    into v_closed
    from public.inbox_v2_tenant_stream_heads stream_head
   where stream_head.tenant_id = new.tenant_id;
  if not coalesce(v_closed, false) then
    raise exception using errcode = '40001',
      message = 'inbox_v2.domain_mutation_stream_head_not_closed';
  end if;

  v_mutation_manifest_digest := 'sha256:' || encode(sha256(convert_to(
    'effects:' || v_empty_digest || chr(10) ||
    'relations:' || v_empty_digest || chr(10) ||
    'stream:' || v_stream.commit_hash || chr(10) ||
    'audit:' || v_audit.audit_hash,
    'UTF8'
  )), 'hex');
  if v_mutation_manifest_digest <> new.manifest_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_digest_mismatch';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.domain_mutation_parent_incomplete';
end;
$function$;

create or replace function public.inbox_v2_atomic_message_creation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_changed jsonb;
  v_tenant_id text;
  v_message_id text;
  v_valid_count integer;
begin
  v_changed := to_jsonb(new);
  v_tenant_id := v_changed->>'tenant_id';

  if tg_table_name =
     'inbox_v2_source_occurrence_resolution_transitions' then
    if v_changed->>'to_state' <> 'resolved' then
      return null;
    end if;
    select reference_row.message_id into v_message_id
      from public.inbox_v2_external_message_references reference_row
     where reference_row.tenant_id = v_tenant_id
       and reference_row.id =
         v_changed->>'resolved_external_message_reference_id';
    if v_message_id is null or not exists (
      select 1
        from public.inbox_v2_messages message_row
       where message_row.tenant_id = v_tenant_id
         and message_row.id = v_message_id
         and message_row.origin_kind = 'source_originated'
         and message_row.origin_source_occurrence_id =
           v_changed->>'source_occurrence_id'
         and message_row.created_at =
           (v_changed->>'changed_at')::timestamptz
    ) then
      return null;
    end if;
  elsif tg_table_name =
        'inbox_v2_atomic_source_resolution_materializations' then
    v_message_id := v_changed->>'message_id';
    if not exists (
      select 1
        from public.inbox_v2_messages message_row
        join public.inbox_v2_external_message_references reference_row
          on reference_row.tenant_id = message_row.tenant_id
         and reference_row.id =
           v_changed->>'external_message_reference_id'
         and reference_row.message_id = message_row.id
        join public.inbox_v2_source_occurrences occurrence_row
          on occurrence_row.tenant_id = message_row.tenant_id
         and occurrence_row.id = v_changed->>'source_occurrence_id'
         and occurrence_row.resolution_state = 'resolved'
         and occurrence_row.resolved_external_message_reference_id =
           reference_row.id
         and occurrence_row.revision =
           (v_changed->>'resulting_revision')::bigint
         and occurrence_row.updated_at =
           (v_changed->>'created_at')::timestamptz
        join public.inbox_v2_source_occurrence_resolution_transitions
          transition_row
          on transition_row.tenant_id = occurrence_row.tenant_id
         and transition_row.id = v_changed->>'resolution_transition_id'
         and transition_row.source_occurrence_id = occurrence_row.id
         and transition_row.resulting_revision = occurrence_row.revision
         and transition_row.to_state = 'resolved'
         and transition_row.resolved_external_message_reference_id =
           reference_row.id
         and transition_row.changed_at =
           (v_changed->>'created_at')::timestamptz
        join public.inbox_v2_tenant_stream_commits stream_row
          on stream_row.tenant_id = message_row.tenant_id
         and stream_row.id = v_changed->>'stream_commit_id'
         and stream_row.mutation_id = v_changed->>'mutation_id'
         and stream_row.position =
           (v_changed->>'stream_position')::bigint
         and stream_row.committed_at =
           (v_changed->>'created_at')::timestamptz
        join public.inbox_v2_auth_mutation_commits mutation_row
          on mutation_row.tenant_id = stream_row.tenant_id
         and mutation_row.mutation_id = stream_row.mutation_id
         and mutation_row.stream_commit_id = stream_row.id
         and mutation_row.committed_at = stream_row.committed_at
        join public.inbox_v2_tenant_stream_changes occurrence_change
          on occurrence_change.tenant_id = stream_row.tenant_id
         and occurrence_change.stream_commit_id = stream_row.id
         and occurrence_change.mutation_id = stream_row.mutation_id
         and occurrence_change.stream_position = stream_row.position
         and occurrence_change.entity_type_id = 'core:source-occurrence'
         and occurrence_change.entity_id = occurrence_row.id
         and occurrence_change.resulting_revision = occurrence_row.revision
         and occurrence_change.state_kind = 'upsert'
         and occurrence_change.state_schema_id =
           'core:inbox-v2.source-occurrence'
         and occurrence_change.state_schema_version = 'v1'
         and occurrence_change.state_hash =
           occurrence_change.payload_reference->>'digest'
         and occurrence_change.payload_reference->>'recordId' =
           occurrence_row.id
         and occurrence_change.domain_commit_reference->>'recordId' =
           transition_row.id
        join public.inbox_v2_tenant_stream_changes message_change
          on message_change.tenant_id = stream_row.tenant_id
         and message_change.stream_commit_id = stream_row.id
         and message_change.mutation_id = stream_row.mutation_id
         and message_change.stream_position = stream_row.position
         and message_change.entity_type_id = 'core:message'
         and message_change.entity_id = message_row.id
         and message_change.resulting_revision = message_row.revision
         and message_change.state_kind = 'upsert'
         and message_change.state_schema_id = 'core:inbox-v2.message'
         and message_change.state_schema_version = 'v1'
         and message_change.state_hash =
           message_change.payload_reference->>'digest'
         and message_change.payload_reference->>'recordId' = message_row.id
       where message_row.tenant_id = v_tenant_id
         and message_row.id = v_message_id
         and message_row.origin_kind = 'source_originated'
         and message_row.origin_source_occurrence_id = occurrence_row.id
         and message_row.revision = 1
         and message_row.last_changed_stream_position = stream_row.position
         and message_row.created_at = stream_row.committed_at
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.atomic_source_resolution_closure_missing';
    end if;
  else
    v_message_id := coalesce(
      v_changed->>'message_id',
      v_changed->>'id'
    );
  end if;

  if v_message_id is null
     or not exists (
       select 1 from public.tenants tenant_row
        where tenant_row.id = v_tenant_id
     ) then
    return null;
  end if;

  select count(*)::integer into v_valid_count
    from public.inbox_v2_messages message_row
    join public.inbox_v2_tenant_stream_commits stream_row
      on stream_row.tenant_id = message_row.tenant_id
     and stream_row.position = message_row.last_changed_stream_position
     and stream_row.committed_at = message_row.created_at
    join public.inbox_v2_auth_mutation_commits mutation_row
      on mutation_row.tenant_id = stream_row.tenant_id
     and mutation_row.mutation_id = stream_row.mutation_id
     and mutation_row.stream_commit_id = stream_row.id
     and mutation_row.committed_at = stream_row.committed_at
     and mutation_row.revision_effect_count = 0
     and mutation_row.relation_write_count = 0
    join public.inbox_v2_auth_command_records command_row
      on command_row.tenant_id = mutation_row.tenant_id
     and command_row.id = mutation_row.command_record_id
     and command_row.mutation_id = mutation_row.mutation_id
     and command_row.state = 'completed'
    join public.inbox_v2_tenant_stream_changes message_change
      on message_change.tenant_id = stream_row.tenant_id
     and message_change.stream_commit_id = stream_row.id
     and message_change.mutation_id = stream_row.mutation_id
     and message_change.stream_position = stream_row.position
     and message_change.entity_type_id = 'core:message'
     and message_change.entity_id = message_row.id
     and message_change.resulting_revision = message_row.revision
     and message_change.state_kind = 'upsert'
     and message_change.state_schema_id = 'core:inbox-v2.message'
     and message_change.state_schema_version = 'v1'
     and message_change.state_hash =
       message_change.payload_reference->>'digest'
     and message_change.payload_reference = command_row.result_reference
   where message_row.tenant_id = v_tenant_id
     and message_row.id = v_message_id
     and message_row.revision = 1
     and message_row.created_at = message_row.updated_at
     and (
       (
         message_row.origin_kind = 'source_originated'
         and command_row.command_type_id = 'core:message.receive'
         and (
           select count(*)
             from public.inbox_v2_atomic_source_resolution_materializations
               source_materialization
            where source_materialization.tenant_id = message_row.tenant_id
              and source_materialization.source_occurrence_id =
                message_row.origin_source_occurrence_id
              and source_materialization.message_id = message_row.id
              and source_materialization.mutation_id = stream_row.mutation_id
              and source_materialization.stream_commit_id = stream_row.id
              and source_materialization.stream_position = stream_row.position
              and source_materialization.created_at = stream_row.committed_at
         ) = 1
       )
       or (
         message_row.origin_kind = 'hulee_external'
         and command_row.command_type_id = 'core:message.send'
         and (
           select count(*)
             from public.inbox_v2_atomic_outbound_dispatch_materializations
               dispatch_materialization
             join public.inbox_v2_outbound_dispatches dispatch_row
               on dispatch_row.tenant_id = dispatch_materialization.tenant_id
              and dispatch_row.id = dispatch_materialization.dispatch_id
            where dispatch_materialization.tenant_id = message_row.tenant_id
              and dispatch_materialization.mutation_id = stream_row.mutation_id
              and dispatch_materialization.stream_commit_id = stream_row.id
              and dispatch_materialization.stream_position = stream_row.position
              and dispatch_materialization.created_at = stream_row.committed_at
              and dispatch_row.message_id = message_row.id
              and dispatch_row.route_id = message_row.origin_outbound_route_id
              and dispatch_row.state = 'queued'
              and dispatch_row.attempt_count = 0
         ) = 1
       )
       or (
         message_row.origin_kind = 'internal'
         and command_row.command_type_id = 'core:message.send'
         and not exists (
           select 1
             from public.inbox_v2_atomic_source_resolution_materializations
               source_materialization
            where source_materialization.tenant_id = message_row.tenant_id
              and source_materialization.message_id = message_row.id
         )
         and not exists (
           select 1
             from public.inbox_v2_atomic_outbound_dispatch_materializations
               dispatch_materialization
             join public.inbox_v2_outbound_dispatches dispatch_row
               on dispatch_row.tenant_id = dispatch_materialization.tenant_id
              and dispatch_row.id = dispatch_materialization.dispatch_id
            where dispatch_materialization.tenant_id = message_row.tenant_id
              and dispatch_row.message_id = message_row.id
         )
       )
     );

  if v_valid_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.atomic_message_creation_closure_missing';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.atomic_message_creation_closure_missing';
end;
$function$;

create constraint trigger inbox_v2_atomic_message_creation_constraint
after insert on public.inbox_v2_messages
deferrable initially deferred for each row
execute function public.inbox_v2_atomic_message_creation_coherence();

create constraint trigger inbox_v2_atomic_src_resolution_constraint
after insert on public.inbox_v2_atomic_source_resolution_materializations
deferrable initially deferred for each row
execute function public.inbox_v2_atomic_message_creation_coherence();

create constraint trigger inbox_v2_atomic_src_transition_constraint
after insert on public.inbox_v2_source_occurrence_resolution_transitions
deferrable initially deferred for each row
when (new.to_state = 'resolved')
execute function public.inbox_v2_atomic_message_creation_coherence();

create or replace function public.inbox_v2_atomic_outbound_creation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_changed jsonb;
  v_tenant_id text;
  v_route_id text;
  v_dispatch_id text;
  v_valid_count integer;
begin
  v_changed := to_jsonb(new);
  v_tenant_id := v_changed->>'tenant_id';
  if tg_table_name = 'inbox_v2_outbound_routes' then
    v_route_id := v_changed->>'id';
  elsif tg_table_name = 'inbox_v2_outbound_dispatches' then
    v_route_id := v_changed->>'route_id';
    v_dispatch_id := v_changed->>'id';
  else
    v_dispatch_id := v_changed->>'dispatch_id';
    select dispatch_row.route_id into v_route_id
      from public.inbox_v2_outbound_dispatches dispatch_row
     where dispatch_row.tenant_id = v_tenant_id
       and dispatch_row.id = v_dispatch_id;
  end if;

  if v_route_id is null
     or not exists (
       select 1 from public.tenants tenant_row
        where tenant_row.id = v_tenant_id
     ) then
    return null;
  end if;

  select count(*)::integer into v_valid_count
    from public.inbox_v2_outbound_routes route_row
    join public.inbox_v2_outbound_dispatches dispatch_row
      on dispatch_row.tenant_id = route_row.tenant_id
     and dispatch_row.route_id = route_row.id
     and (v_dispatch_id is null or dispatch_row.id = v_dispatch_id)
     and dispatch_row.state = 'queued'
     and dispatch_row.attempt_count = 0
     and dispatch_row.active_attempt_id is null
     and dispatch_row.last_attempt_id is null
     and dispatch_row.retry_authorization_decision_id is null
     and dispatch_row.revision = 1
     and dispatch_row.created_at = dispatch_row.updated_at
    join public.inbox_v2_atomic_outbound_dispatch_materializations
      dispatch_materialization
      on dispatch_materialization.tenant_id = dispatch_row.tenant_id
     and dispatch_materialization.dispatch_id = dispatch_row.id
     and dispatch_materialization.resulting_revision = dispatch_row.revision
     and dispatch_materialization.created_at = dispatch_row.created_at
    join public.inbox_v2_tenant_stream_commits stream_row
      on stream_row.tenant_id = dispatch_materialization.tenant_id
     and stream_row.id = dispatch_materialization.stream_commit_id
     and stream_row.mutation_id = dispatch_materialization.mutation_id
     and stream_row.position = dispatch_materialization.stream_position
     and stream_row.committed_at = dispatch_materialization.created_at
    join public.inbox_v2_auth_mutation_commits mutation_row
      on mutation_row.tenant_id = stream_row.tenant_id
     and mutation_row.mutation_id = stream_row.mutation_id
     and mutation_row.stream_commit_id = stream_row.id
     and mutation_row.committed_at = stream_row.committed_at
     and mutation_row.revision_effect_count = 0
     and mutation_row.relation_write_count = 0
    join public.inbox_v2_auth_command_records command_row
      on command_row.tenant_id = mutation_row.tenant_id
     and command_row.id = mutation_row.command_record_id
     and command_row.mutation_id = mutation_row.mutation_id
     and command_row.state = 'completed'
     and command_row.command_type_id = 'core:message.send'
    join public.inbox_v2_messages message_row
      on message_row.tenant_id = dispatch_row.tenant_id
     and message_row.id = dispatch_row.message_id
     and message_row.conversation_id = dispatch_row.conversation_id
     and message_row.timeline_item_id = dispatch_row.timeline_item_id
     and message_row.origin_kind = 'hulee_external'
     and message_row.origin_outbound_route_id = route_row.id
     and message_row.revision = 1
     and message_row.last_changed_stream_position = stream_row.position
     and message_row.created_at = stream_row.committed_at
    join public.inbox_v2_tenant_stream_changes dispatch_change
      on dispatch_change.tenant_id = stream_row.tenant_id
     and dispatch_change.stream_commit_id = stream_row.id
     and dispatch_change.mutation_id = stream_row.mutation_id
     and dispatch_change.stream_position = stream_row.position
     and dispatch_change.entity_type_id = 'core:outbound-dispatch'
     and dispatch_change.entity_id = dispatch_row.id
     and dispatch_change.resulting_revision = dispatch_row.revision
     and dispatch_change.state_kind = 'upsert'
     and dispatch_change.state_schema_id = 'core:inbox-v2.outbound-dispatch'
     and dispatch_change.state_schema_version = 'v1'
     and dispatch_change.state_hash =
       dispatch_change.payload_reference->>'digest'
   where route_row.tenant_id = v_tenant_id
     and route_row.id = v_route_id
     and route_row.revision = 1
     and route_row.created_at = stream_row.committed_at
     and dispatch_row.created_at = stream_row.committed_at
     and (
       select count(*)
         from public.inbox_v2_outbox_intents provider_intent
        where provider_intent.tenant_id = dispatch_change.tenant_id
          and provider_intent.stream_commit_id = dispatch_change.stream_commit_id
          and provider_intent.mutation_id = dispatch_change.mutation_id
          and provider_intent.effect_class = 'provider_io'
          and provider_intent.type_id = 'core:provider.dispatch'
          and provider_intent.payload_reference =
            dispatch_change.payload_reference
          and jsonb_array_length(provider_intent.change_ids) = 1
          and provider_intent.change_ids ? dispatch_change.id
          and exists (
            select 1
              from public.inbox_v2_domain_events message_event
             where message_event.tenant_id = provider_intent.tenant_id
               and message_event.id = provider_intent.event_id
               and message_event.stream_commit_id =
                 provider_intent.stream_commit_id
               and message_event.mutation_id = provider_intent.mutation_id
               and message_event.type_id = 'core:message.changed'
               and message_event.change_ids ? dispatch_change.id
               and message_event.subjects @> jsonb_build_array(
                 jsonb_build_object(
                   'tenantId', dispatch_change.tenant_id,
                   'entityTypeId', 'core:message',
                   'entityId', dispatch_row.message_id
                 )
               )
          )
     ) = 1;

  if v_valid_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.atomic_outbound_creation_closure_missing';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.atomic_outbound_creation_closure_missing';
end;
$function$;

create constraint trigger inbox_v2_atomic_outbound_route_constraint
after insert on public.inbox_v2_outbound_routes
deferrable initially deferred for each row
execute function public.inbox_v2_atomic_outbound_creation_coherence();

create constraint trigger inbox_v2_atomic_outbound_dispatch_constraint
after insert on public.inbox_v2_outbound_dispatches
deferrable initially deferred for each row
execute function public.inbox_v2_atomic_outbound_creation_coherence();

create constraint trigger inbox_v2_atomic_outbound_ledger_constraint
after insert on public.inbox_v2_atomic_outbound_dispatch_materializations
deferrable initially deferred for each row
execute function public.inbox_v2_atomic_outbound_creation_coherence();
