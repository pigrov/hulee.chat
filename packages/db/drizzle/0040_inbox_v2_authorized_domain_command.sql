ALTER TABLE "inbox_v2_auth_mutation_commits" DROP CONSTRAINT "inbox_v2_auth_mutation_commits_manifest_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_mutation_commits" ADD CONSTRAINT "inbox_v2_auth_mutation_commits_manifest_check" CHECK ((("inbox_v2_auth_mutation_commits"."revision_effect_count" = 0
          and "inbox_v2_auth_mutation_commits"."relation_write_count" = 0)
        or ("inbox_v2_auth_mutation_commits"."revision_effect_count" >= 1
          and "inbox_v2_auth_mutation_commits"."relation_write_count" >= 1))
        and "inbox_v2_auth_mutation_commits"."projection_intent_count" >= 1
        and "inbox_v2_auth_mutation_commits"."revision_effect_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_mutation_commits"."relation_write_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_mutation_commits"."manifest_digest_sha256" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
-- INB2-SRC-011_AUTHORIZED_DOMAIN_COMMAND_V1
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
       or intent_row.effect_class = 'provider_io'
       or not (v_stream.change_ids @> intent_row.change_ids)
       or not (event_row.change_ids @> intent_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         intent_row.payload_reference, new.tenant_id
       ));
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
$function$;--> statement-breakpoint
drop trigger inbox_v2_auth_mutation_commit_coherence
  on public.inbox_v2_auth_mutation_commits;--> statement-breakpoint
create constraint trigger inbox_v2_auth_mutation_commit_coherence
after insert on public.inbox_v2_auth_mutation_commits
deferrable initially deferred
for each row
when (new.revision_effect_count > 0 and new.relation_write_count > 0)
execute function public.inbox_v2_auth_mutation_coherence();--> statement-breakpoint
create constraint trigger inbox_v2_auth_domain_mutation_commit_coherence
after insert on public.inbox_v2_auth_mutation_commits
deferrable initially deferred
for each row
when (new.revision_effect_count = 0 and new.relation_write_count = 0)
execute function public.inbox_v2_auth_domain_mutation_coherence();
