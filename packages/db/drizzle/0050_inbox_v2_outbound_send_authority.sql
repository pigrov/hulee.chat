-- INB2-MSG-002_NORMAL_SEND_REPLY_AUTHORITY_V1
--
-- Migrations 0031 and 0046 are immutable history. Install the reviewed
-- MSG-002 successors without copying their large function bodies. Every
-- rewrite is guarded by the exact normalized prosrc predecessor/successor
-- hashes and exact fragment counts. Because all five rewrites live in one DO
-- statement, any missing or drifted function rolls the complete overlay back.
do $migration$
declare
  function_ddl text;
  function_source text;
  old_occurrence_count integer;
  new_occurrence_count integer;

  core_legacy_literal constant text := 'core:message.send_external';
  core_canonical_literal constant text := 'core:message.reply_external';
  core_predecessor_md5 constant text := '959088528b76cb0336e446a65058d013';
  core_successor_md5 constant text := '4b118cf12b40161556d2ca89b9ffa1ac';

  route_action_signature constant text :=
    'public.inbox_v2_tm_outbound_route_action_valid(text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,text,text,bigint,text,text,bigint,text,text,timestamptz,text,bigint,text,boolean)';
  route_action_binding_ready_fragment constant text :=
    $fragment$       and binding_snapshot.runtime_health_state = 'ready'$fragment$;
  route_action_observation_ready_fragment constant text :=
    $fragment$       and route_row.runtime_observation_snapshot #>> '{state}' = 'ready'
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at$fragment$;
  route_action_runtime_provenance_fragment constant text :=
    $fragment$       and binding_snapshot.runtime_health_state::text =
         route_row.runtime_observation_snapshot #>> '{state}'
       and binding_snapshot.runtime_health_revision::text =
         route_row.runtime_observation_snapshot #>> '{revision}'
       and binding_snapshot.runtime_health_checked_at =
         (route_row.runtime_observation_snapshot #>>
           '{observedAt}')::timestamptz$fragment$;
  route_action_observation_time_fragment constant text :=
    $fragment$       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at$fragment$;
  route_action_predecessor_md5 constant text :=
    'f81c60cfdf704fbe553a55bb19ef6d43';
  route_action_successor_md5 constant text :=
    '82327beb054ed48ba763824b1f7cbbe2';

  domain_mutation_outer_predecessor_fragment constant text :=
    $fragment$  if v_command.command_type_id in ('core:message.send', 'core:message.receive')
  then$fragment$;
  domain_mutation_outer_successor_fragment constant text :=
    $fragment$  if v_command.command_type_id in (
    'core:message.send',
    'core:message.receive',
    'core:source.dispatch.reroute'
  )
  then$fragment$;
  domain_mutation_no_source_predecessor_fragment constant text :=
    $fragment$         v_command.command_type_id = 'core:message.send'
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )$fragment$;
  domain_mutation_no_source_successor_fragment constant text :=
    $fragment$         v_command.command_type_id in (
           'core:message.send',
           'core:source.dispatch.reroute'
         )
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )$fragment$;
  domain_mutation_dispatch_predecessor_fragment constant text :=
    $fragment$     and dispatch_change.entity_type_id = 'core:outbound-dispatch'
     and (
       dispatch_change.resulting_revision <> 1$fragment$;
  domain_mutation_dispatch_successor_fragment constant text :=
    $fragment$     and dispatch_change.entity_type_id = 'core:outbound-dispatch'
     and not (
       v_command.command_type_id = 'core:source.dispatch.reroute'
       and dispatch_change.resulting_revision = 2
       and dispatch_change.state_kind = 'upsert'
       and dispatch_change.state_schema_id =
          'core:inbox-v2.outbound-dispatch'
       and dispatch_change.state_schema_version = 'v1'
       and dispatch_change.payload_reference->>'tenantId' =
          dispatch_change.tenant_id
       and dispatch_change.payload_reference->>'recordId' =
          dispatch_change.entity_id
       and dispatch_change.payload_reference->>'schemaId' =
          'core:inbox-v2.outbound-dispatch'
       and dispatch_change.payload_reference->>'schemaVersion' = 'v1'
       and dispatch_change.state_hash =
          dispatch_change.payload_reference->>'digest'
       and dispatch_change.domain_commit_reference->>'tenantId' =
          dispatch_change.tenant_id
       and dispatch_change.domain_commit_reference->>'recordId' =
          dispatch_change.entity_id
       and dispatch_change.domain_commit_reference->>'schemaId' =
          'core:inbox-v2.outbound-dispatch-reroute-commit'
       and dispatch_change.domain_commit_reference->>'schemaVersion' = 'v1'
       and dispatch_change.domain_commit_reference =
          v_audit.evidence_reference
       and dispatch_row.id is not null
       and dispatch_row.state = 'cancelled'
       and dispatch_row.attempt_count = 0
       and dispatch_row.active_attempt_id is null
       and dispatch_row.last_attempt_id is null
       and dispatch_row.retry_authorization_decision_id is null
       and dispatch_row.revision = 2
       and dispatch_row.updated_at = new.committed_at
       and not exists (
         select 1
           from public.inbox_v2_outbound_dispatch_attempts attempt_row
          where attempt_row.tenant_id = dispatch_change.tenant_id
            and attempt_row.dispatch_id = dispatch_change.entity_id
       )
       and exists (
         select 1
           from public.inbox_v2_outbound_routes reroute_route
           join public.inbox_v2_messages reroute_message
             on reroute_message.tenant_id = reroute_route.tenant_id
            and reroute_message.origin_outbound_route_id = reroute_route.id
            and reroute_message.last_changed_stream_position =
              dispatch_change.stream_position
            and reroute_message.created_at = new.committed_at
          where reroute_route.tenant_id = dispatch_change.tenant_id
            and reroute_route.selection_intent_kind = 'explicit_reroute'
            and reroute_route.selection_intent_snapshot #>>
                '{originalDispatch,tenantId}' = dispatch_change.tenant_id
            and reroute_route.selection_intent_snapshot #>>
                '{originalDispatch,id}' = dispatch_change.entity_id
            and reroute_route.selection_intent_snapshot ->>
                'expectedOriginalDispatchRevision' = '1'
            and reroute_route.selection_intent_snapshot #>>
                '{originalRoute,id}' = dispatch_row.route_id
            and dispatch_change.state_reason_id is null
       )
     )
     and (
       dispatch_change.resulting_revision <> 1$fragment$;
  domain_mutation_audit_predecessor_fragment constant text :=
    $fragment$       or v_audit.evidence_reference is distinct from
          message_change.domain_commit_reference$fragment$;
  domain_mutation_audit_successor_fragment constant text :=
    $fragment$       or (
         v_command.command_type_id <> 'core:source.dispatch.reroute'
         and v_audit.evidence_reference is distinct from
            message_change.domain_commit_reference
       )$fragment$;
  domain_mutation_predecessor_md5 constant text :=
    '24694cc88bcffc55d354204599fe190c';
  domain_mutation_successor_md5 constant text :=
    'e64df642da1c36a22e54c3881adf1ac6';

  atomic_message_predecessor_fragment constant text :=
    $fragment$         message_row.origin_kind = 'hulee_external'
         and command_row.command_type_id = 'core:message.send'
         and ($fragment$;
  atomic_message_successor_fragment constant text :=
    $fragment$         message_row.origin_kind = 'hulee_external'
         and (
           (
             command_row.command_type_id = 'core:message.send'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind <> 'explicit_reroute'
             )
           )
           or (
             command_row.command_type_id = 'core:source.dispatch.reroute'
             and exists (
               select 1
                 from public.inbox_v2_outbound_routes route_row
                where route_row.tenant_id = message_row.tenant_id
                  and route_row.id = message_row.origin_outbound_route_id
                  and route_row.selection_intent_kind = 'explicit_reroute'
             )
           )
         )
         and ($fragment$;
  atomic_message_predecessor_md5 constant text :=
    '7db8c0373f7ddeb62878dac1849ec40e';
  atomic_message_successor_md5 constant text :=
    '9814887b7feefdeddc29df564619b80b';

  atomic_outbound_predecessor_fragment constant text :=
    $fragment$     and command_row.state = 'completed'
     and command_row.command_type_id = 'core:message.send'
    join public.inbox_v2_messages message_row$fragment$;
  atomic_outbound_successor_fragment constant text :=
    $fragment$     and command_row.state = 'completed'
     and (
       (
         command_row.command_type_id = 'core:message.send'
         and route_row.selection_intent_kind <> 'explicit_reroute'
       )
       or (
         command_row.command_type_id = 'core:source.dispatch.reroute'
         and route_row.selection_intent_kind = 'explicit_reroute'
         and (
           select count(*)
             from jsonb_array_elements(
               command_row.authorization_decision_refs
             ) decision_ref
             join public.inbox_v2_outbound_routes original_route
               on original_route.tenant_id = route_row.tenant_id
              and original_route.id =
                route_row.selection_intent_snapshot #>>
                  '{originalRoute,id}'
            where decision_ref->>'id' =
                    command_row.authorization_decision_id
              and decision_ref->>'authorizationEpoch' =
                    command_row.authorization_epoch
              and decision_ref->>'permissionId' =
                    'core:source.dispatch.reroute'
              and decision_ref->>'resourceScopeId' =
                    'core:source-account'
              and decision_ref->>'outcome' = 'allowed'
              and decision_ref #>> '{resource,tenantId}' =
                    route_row.tenant_id
              and decision_ref #>> '{resource,entityTypeId}' =
                    'core:source-account'
              and decision_ref #>> '{resource,entityId}' =
                    original_route.source_account_id
         ) = 1
         and route_row.selection_intent_snapshot #>>
               '{originalRoute,tenantId}' = route_row.tenant_id
         and route_row.selection_intent_snapshot #>>
               '{originalDispatch,tenantId}' = route_row.tenant_id
         and route_row.selection_intent_snapshot ->>
               'expectedOriginalDispatchRevision' = '1'
         and route_row.selection_reason = 'explicit_reroute'
         and route_row.selection_intent_snapshot #>>
               '{originalRoute,id}' <> route_row.id
         and route_row.selection_intent_snapshot #>>
               '{originalDispatch,id}' <> dispatch_row.id
         and (
           select count(*)
             from public.inbox_v2_outbound_routes original_route
             join public.inbox_v2_outbound_dispatches original_dispatch
               on original_dispatch.tenant_id = original_route.tenant_id
              and original_dispatch.route_id = original_route.id
              and original_dispatch.id =
                route_row.selection_intent_snapshot #>>
                  '{originalDispatch,id}'
             join public.inbox_v2_tenant_stream_changes original_change
               on original_change.tenant_id = stream_row.tenant_id
              and original_change.stream_commit_id = stream_row.id
              and original_change.mutation_id = stream_row.mutation_id
              and original_change.stream_position = stream_row.position
              and original_change.entity_type_id =
                'core:outbound-dispatch'
              and original_change.entity_id = original_dispatch.id
              and original_change.resulting_revision =
                original_dispatch.revision
              and original_change.state_kind = 'upsert'
              and original_change.state_schema_id =
                'core:inbox-v2.outbound-dispatch'
              and original_change.state_schema_version = 'v1'
              and original_change.state_reason_id is null
              and original_change.state_hash =
                original_change.payload_reference->>'digest'
              and original_change.payload_reference->>'tenantId' =
                original_change.tenant_id
              and original_change.payload_reference->>'recordId' =
                original_dispatch.id
              and original_change.payload_reference->>'schemaId' =
                'core:inbox-v2.outbound-dispatch'
              and original_change.payload_reference->>'schemaVersion' = 'v1'
              and original_change.domain_commit_reference->>'tenantId' =
                original_change.tenant_id
              and original_change.domain_commit_reference->>'recordId' =
                original_dispatch.id
              and original_change.domain_commit_reference->>'schemaId' =
                'core:inbox-v2.outbound-dispatch-reroute-commit'
              and original_change.domain_commit_reference->>'schemaVersion' =
                'v1'
            where original_route.tenant_id = route_row.tenant_id
              and original_route.id =
                route_row.selection_intent_snapshot #>>
                  '{originalRoute,id}'
              and original_route.conversation_id = route_row.conversation_id
              and original_route.external_thread_id =
                route_row.external_thread_id
              and original_route.source_thread_binding_id <>
                route_row.source_thread_binding_id
              and original_dispatch.message_id <> dispatch_row.message_id
              and original_dispatch.state = 'cancelled'
              and original_dispatch.attempt_count = 0
              and original_dispatch.active_attempt_id is null
              and original_dispatch.last_attempt_id is null
              and original_dispatch.retry_authorization_decision_id is null
              and original_dispatch.revision = 2
              and original_dispatch.updated_at = stream_row.committed_at
              and original_dispatch.created_at <= original_dispatch.updated_at
              and not exists (
                select 1
                  from public.inbox_v2_outbound_dispatch_attempts
                    original_attempt
                 where original_attempt.tenant_id = original_dispatch.tenant_id
                   and original_attempt.dispatch_id = original_dispatch.id
              )
              and (
                select count(*)
                  from public.inbox_v2_domain_events original_event
                  join public.inbox_v2_outbox_intents projection_intent
                    on projection_intent.tenant_id = original_event.tenant_id
                   and projection_intent.event_id = original_event.id
                   and projection_intent.stream_commit_id = stream_row.id
                   and projection_intent.mutation_id = stream_row.mutation_id
                   and projection_intent.effect_class = 'projection'
                   and projection_intent.type_id = 'core:projection.update'
                   and jsonb_array_length(projection_intent.change_ids) = 1
                   and projection_intent.change_ids ? original_change.id
                 where original_event.tenant_id = original_change.tenant_id
                   and original_event.stream_commit_id = stream_row.id
                   and original_event.mutation_id = stream_row.mutation_id
                   and original_event.type_id =
                     'core:outbound-dispatch.changed'
                   and original_event.payload_schema_id =
                     'core:inbox-v2.outbound-dispatch-reroute-commit'
                   and original_event.payload_schema_version = 'v1'
                   and original_event.payload_reference =
                     original_change.domain_commit_reference
                   and jsonb_array_length(original_event.change_ids) = 1
                   and original_event.change_ids ? original_change.id
                   and original_event.subjects @> jsonb_build_array(
                     jsonb_build_object(
                       'tenantId', original_dispatch.tenant_id,
                       'entityTypeId', 'core:outbound-dispatch',
                       'entityId', original_dispatch.id
                     )
                   )
                   and original_event.occurred_at = stream_row.committed_at
                   and original_event.recorded_at = stream_row.committed_at
              ) = 1
              and (
                select count(*)
                  from public.inbox_v2_outbox_intents original_intent
                  join public.inbox_v2_outbox_work_items original_work
                    on original_work.tenant_id = original_intent.tenant_id
                   and original_work.intent_id = original_intent.id
                   and original_work.state in ('pending', 'leased')
                 where original_intent.tenant_id = original_dispatch.tenant_id
                   and original_intent.effect_class = 'provider_io'
                   and original_intent.type_id = 'core:provider.dispatch'
                   and original_intent.payload_reference->>'tenantId' =
                     original_dispatch.tenant_id
                   and original_intent.payload_reference->>'recordId' =
                     original_dispatch.id
                   and original_intent.payload_reference->>'schemaId' =
                     'core:inbox-v2.outbound-dispatch'
                   and original_intent.payload_reference->>'schemaVersion' =
                     'v1'
              ) = 1
              and not exists (
                select 1
                  from public.inbox_v2_outbox_intents forbidden_provider_intent
                 where forbidden_provider_intent.tenant_id =
                         original_change.tenant_id
                   and forbidden_provider_intent.stream_commit_id =
                         original_change.stream_commit_id
                   and forbidden_provider_intent.mutation_id =
                         original_change.mutation_id
                   and forbidden_provider_intent.effect_class = 'provider_io'
                   and forbidden_provider_intent.change_ids ?
                         original_change.id
              )
              and (
                select count(*)
                  from public.inbox_v2_auth_audit_events reroute_audit
                 where reroute_audit.tenant_id = original_change.tenant_id
                   and reroute_audit.id = mutation_row.audit_event_id
                   and reroute_audit.mutation_id = stream_row.mutation_id
                   and reroute_audit.action_id =
                     'core:source.dispatch.reroute'
                   and reroute_audit.target_type_id =
                     'core:outbound-dispatch'
                   and reroute_audit.reason_code_id =
                     route_row.selection_intent_snapshot ->> 'reasonId'
                   and reroute_audit.evidence_reference =
                     original_change.domain_commit_reference
                   and reroute_audit.matched_permission_ids @>
                     array['core:source.dispatch.reroute']::text[]
              ) = 1
         ) = 1
         and (
           select count(*)
             from public.inbox_v2_tenant_stream_changes sibling_dispatch_change
            where sibling_dispatch_change.tenant_id = stream_row.tenant_id
              and sibling_dispatch_change.stream_commit_id = stream_row.id
              and sibling_dispatch_change.mutation_id = stream_row.mutation_id
              and sibling_dispatch_change.stream_position = stream_row.position
              and sibling_dispatch_change.entity_type_id =
                'core:outbound-dispatch'
         ) = 2
       )
     )
    join public.inbox_v2_messages message_row$fragment$;
  atomic_outbound_predecessor_md5 constant text :=
    '11fb5a565d6402e50e28997b3cacdb16';
  atomic_outbound_successor_md5 constant text :=
    'c5577a04b744fa297dd3f729452ea14f';
begin
  -- Canonical external-reply permission in Message coherence.
  select pg_get_functiondef(function_row.oid),
         replace(function_row.prosrc, E'\r\n', E'\n')
    into function_ddl, function_source
    from pg_proc function_row
   where function_row.oid =
     to_regprocedure('public.inbox_v2_tm_core_coherence()');

  if function_ddl is null or function_source is null then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_core_coherence_missing';
  end if;
  old_occurrence_count := (length(function_source) - length(replace(
    function_source, core_legacy_literal, ''))) / length(core_legacy_literal);
  new_occurrence_count := (length(function_source) - length(replace(
    function_source, core_canonical_literal, ''))) /
    length(core_canonical_literal);

  if md5(function_source) = core_predecessor_md5
     and old_occurrence_count = 1 and new_occurrence_count = 1 then
    execute replace(
      function_ddl, core_legacy_literal, core_canonical_literal
    );
    select replace(function_row.prosrc, E'\r\n', E'\n')
      into function_source from pg_proc function_row
     where function_row.oid =
       to_regprocedure('public.inbox_v2_tm_core_coherence()');
    if md5(function_source) <> core_successor_md5 then
      raise exception using errcode = '55000',
        message = 'inbox_v2.msg002_core_coherence_successor_mismatch';
    end if;
  elsif not (
    md5(function_source) = core_successor_md5
    and old_occurrence_count = 0 and new_occurrence_count = 2
  ) then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_core_coherence_unreviewed_shape';
  end if;

  -- Runtime health is observational at creation time. Preserve the exact
  -- immutable runtime observation provenance while removing only readiness.
  select pg_get_functiondef(function_row.oid),
         replace(function_row.prosrc, E'\r\n', E'\n')
    into function_ddl, function_source
    from pg_proc function_row
   where function_row.oid = to_regprocedure(route_action_signature);

  if function_ddl is null or function_source is null then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_route_action_missing';
  end if;
  old_occurrence_count :=
    (length(function_source) - length(replace(
      function_source, route_action_binding_ready_fragment, ''))) /
      length(route_action_binding_ready_fragment) +
    (length(function_source) - length(replace(
      function_source, route_action_observation_ready_fragment, ''))) /
      length(route_action_observation_ready_fragment);
  new_occurrence_count := (length(function_source) - length(replace(
    function_source, route_action_runtime_provenance_fragment, ''))) /
    length(route_action_runtime_provenance_fragment);

  if md5(function_source) = route_action_predecessor_md5
     and old_occurrence_count = 2 and new_occurrence_count = 0 then
    function_ddl := replace(
      function_ddl,
      route_action_binding_ready_fragment,
      route_action_runtime_provenance_fragment
    );
    function_ddl := replace(
      function_ddl,
      route_action_observation_ready_fragment,
      route_action_observation_time_fragment
    );
    execute function_ddl;
    select replace(function_row.prosrc, E'\r\n', E'\n')
      into function_source from pg_proc function_row
     where function_row.oid = to_regprocedure(route_action_signature);
    if md5(function_source) <> route_action_successor_md5 then
      raise exception using errcode = '55000',
        message = 'inbox_v2.msg002_route_action_successor_mismatch';
    end if;
  elsif not (
    md5(function_source) = route_action_successor_md5
    and old_occurrence_count = 0 and new_occurrence_count = 1
  ) then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_route_action_unreviewed_shape';
  end if;

  -- A reroute still creates exactly one Message and no source occurrence.
  select pg_get_functiondef(function_row.oid),
         replace(function_row.prosrc, E'\r\n', E'\n')
    into function_ddl, function_source
    from pg_proc function_row
   where function_row.oid = to_regprocedure(
     'public.inbox_v2_auth_domain_mutation_coherence()'
   );

  if function_ddl is null or function_source is null then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_domain_mutation_missing';
  end if;
  old_occurrence_count :=
    (length(function_source) - length(replace(
      function_source, domain_mutation_outer_predecessor_fragment, ''))) /
      length(domain_mutation_outer_predecessor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_no_source_predecessor_fragment, ''))) /
      length(domain_mutation_no_source_predecessor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_dispatch_predecessor_fragment, ''))) /
      length(domain_mutation_dispatch_predecessor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_audit_predecessor_fragment, ''))) /
      length(domain_mutation_audit_predecessor_fragment);
  new_occurrence_count :=
    (length(function_source) - length(replace(
      function_source, domain_mutation_outer_successor_fragment, ''))) /
      length(domain_mutation_outer_successor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_no_source_successor_fragment, ''))) /
      length(domain_mutation_no_source_successor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_dispatch_successor_fragment, ''))) /
      length(domain_mutation_dispatch_successor_fragment) +
    (length(function_source) - length(replace(
      function_source, domain_mutation_audit_successor_fragment, ''))) /
      length(domain_mutation_audit_successor_fragment);

  if md5(function_source) = domain_mutation_predecessor_md5
     and old_occurrence_count = 4 and new_occurrence_count = 0 then
    function_ddl := replace(
      function_ddl,
      domain_mutation_outer_predecessor_fragment,
      domain_mutation_outer_successor_fragment
    );
    function_ddl := replace(
      function_ddl,
      domain_mutation_no_source_predecessor_fragment,
      domain_mutation_no_source_successor_fragment
    );
    function_ddl := replace(
      function_ddl,
      domain_mutation_dispatch_predecessor_fragment,
      domain_mutation_dispatch_successor_fragment
    );
    function_ddl := replace(
      function_ddl,
      domain_mutation_audit_predecessor_fragment,
      domain_mutation_audit_successor_fragment
    );
    execute function_ddl;
    select replace(function_row.prosrc, E'\r\n', E'\n')
      into function_source from pg_proc function_row
     where function_row.oid = to_regprocedure(
       'public.inbox_v2_auth_domain_mutation_coherence()'
     );
    if md5(function_source) <> domain_mutation_successor_md5 then
      raise exception using errcode = '55000',
        message = 'inbox_v2.msg002_domain_mutation_successor_mismatch',
        detail = md5(function_source);
    end if;
  elsif not (
    md5(function_source) = domain_mutation_successor_md5
    and old_occurrence_count = 0 and new_occurrence_count = 4
  ) then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_domain_mutation_unreviewed_shape';
  end if;

  -- External Message closure pairs a normal command with a normal route and
  -- an explicit reroute command with an explicit reroute route.
  select pg_get_functiondef(function_row.oid),
         replace(function_row.prosrc, E'\r\n', E'\n')
    into function_ddl, function_source
    from pg_proc function_row
   where function_row.oid = to_regprocedure(
     'public.inbox_v2_atomic_message_creation_coherence()'
   );

  if function_ddl is null or function_source is null then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_atomic_message_missing';
  end if;
  old_occurrence_count := (length(function_source) - length(replace(
    function_source, atomic_message_predecessor_fragment, ''))) /
    length(atomic_message_predecessor_fragment);
  new_occurrence_count := (length(function_source) - length(replace(
    function_source, atomic_message_successor_fragment, ''))) /
    length(atomic_message_successor_fragment);

  if md5(function_source) = atomic_message_predecessor_md5
     and old_occurrence_count = 1 and new_occurrence_count = 0 then
    execute replace(
      function_ddl,
      atomic_message_predecessor_fragment,
      atomic_message_successor_fragment
    );
    select replace(function_row.prosrc, E'\r\n', E'\n')
      into function_source from pg_proc function_row
     where function_row.oid = to_regprocedure(
       'public.inbox_v2_atomic_message_creation_coherence()'
     );
    if md5(function_source) <> atomic_message_successor_md5 then
      raise exception using errcode = '55000',
        message = 'inbox_v2.msg002_atomic_message_successor_mismatch';
    end if;
  elsif not (
    md5(function_source) = atomic_message_successor_md5
    and old_occurrence_count = 0 and new_occurrence_count = 1
  ) then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_atomic_message_unreviewed_shape';
  end if;

  -- Outbound closure repeats the command/intent pair and additionally binds
  -- the primary reroute decision to the original route's source account.
  select pg_get_functiondef(function_row.oid),
         replace(function_row.prosrc, E'\r\n', E'\n')
    into function_ddl, function_source
    from pg_proc function_row
   where function_row.oid = to_regprocedure(
     'public.inbox_v2_atomic_outbound_creation_coherence()'
   );

  if function_ddl is null or function_source is null then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_atomic_outbound_missing';
  end if;
  old_occurrence_count := (length(function_source) - length(replace(
    function_source, atomic_outbound_predecessor_fragment, ''))) /
    length(atomic_outbound_predecessor_fragment);
  new_occurrence_count := (length(function_source) - length(replace(
    function_source, atomic_outbound_successor_fragment, ''))) /
    length(atomic_outbound_successor_fragment);

  if md5(function_source) = atomic_outbound_predecessor_md5
     and old_occurrence_count = 1 and new_occurrence_count = 0 then
    execute replace(
      function_ddl,
      atomic_outbound_predecessor_fragment,
      atomic_outbound_successor_fragment
    );
    select replace(function_row.prosrc, E'\r\n', E'\n')
      into function_source from pg_proc function_row
     where function_row.oid = to_regprocedure(
       'public.inbox_v2_atomic_outbound_creation_coherence()'
     );
    if md5(function_source) <> atomic_outbound_successor_md5 then
      raise exception using errcode = '55000',
        message = 'inbox_v2.msg002_atomic_outbound_successor_mismatch',
        detail = md5(function_source);
    end if;
  elsif not (
    md5(function_source) = atomic_outbound_successor_md5
    and old_occurrence_count = 0 and new_occurrence_count = 1
  ) then
    raise exception using errcode = '55000',
      message = 'inbox_v2.msg002_atomic_outbound_unreviewed_shape';
  end if;
end
$migration$;
