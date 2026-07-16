-- INBOX_V2_SOURCE_REGISTRY_PREFLIGHT_V1
do $preflight$
declare
  missing_relation text;
  target_relation text;
  target_type text;
begin
  foreach missing_relation in array array[
    'public.tenants',
    'public.employees',
    'public.tenant_secrets',
    'public.source_connections',
    'public.source_accounts',
    'public.channel_connectors',
    'public.channel_sessions',
    'public.channel_session_events',
    'public.channel_auth_challenges',
    'public.channel_provider_validation_jobs',
    'public.inbox_v2_source_account_identity_transitions',
    'public.inbox_v2_source_account_identity_verified_snapshots',
    'public.inbox_v2_source_account_identities',
    'public.inbox_v2_auth_resource_heads',
    'public.inbox_v2_data_governance_registry_versions',
    'public.inbox_v2_data_governance_data_use_lineages',
    'public.inbox_v2_data_governance_effective_policies',
    'public.inbox_v2_data_governance_effective_policy_rules',
    'public.inbox_v2_data_governance_policy_activation_heads',
    'public.inbox_v2_data_governance_control_set_heads'
  ] loop
    if to_regclass(missing_relation) is null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_preflight_missing_relation',
        detail = missing_relation;
    end if;
  end loop;

  foreach target_relation in array array[
    'public.inbox_v2_source_registry_transitions',
    'public.inbox_v2_source_registry_heads',
    'public.inbox_v2_source_registry_artifact_refs',
    'public.inbox_v2_source_registry_secret_refs',
    'public.inbox_v2_source_registry_ingress_routes',
    'public.inbox_v2_source_registry_related_authority_refs'
  ] loop
    if to_regclass(target_relation) is not null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_preflight_partial_target',
        detail = target_relation;
    end if;
  end loop;

  foreach target_type in array array[
    'public.inbox_v2_source_registry_actor_kind',
    'public.inbox_v2_source_registry_artifact_kind',
    'public.inbox_v2_source_registry_authority_kind',
    'public.inbox_v2_source_registry_copy_slot',
    'public.inbox_v2_source_registry_related_authority_kind',
    'public.inbox_v2_source_registry_related_authority_status',
    'public.inbox_v2_source_registry_route_authority_state',
    'public.inbox_v2_source_registry_state',
    'public.inbox_v2_source_registry_transition_intent'
  ] loop
    if to_regtype(target_type) is not null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_preflight_partial_target',
        detail = target_type;
    end if;
  end loop;

  if exists (
    select 1
      from pg_catalog.pg_proc procedure_row
     where procedure_row.proname like 'inbox_v2_source_registry_%'
  ) or exists (
    select 1
      from pg_catalog.pg_trigger trigger_row
     where not trigger_row.tgisinternal
       and trigger_row.tgname like 'inbox_v2_source_registry_%'
  ) or exists (
    select 1
      from pg_catalog.pg_constraint constraint_row
     where constraint_row.conname in (
       'channel_auth_challenges_tenant_connector_fk',
       'channel_auth_challenges_tenant_creator_fk',
       'channel_auth_challenges_tenant_id_unique',
       'channel_auth_challenges_tenant_id_connector_unique',
       'channel_connectors_tenant_connection_fk',
       'channel_connectors_tenant_creator_fk',
       'channel_connectors_tenant_id_unique',
       'channel_connectors_tenant_id_connection_unique',
       'channel_provider_validation_jobs_tenant_secret_fk',
       'channel_provider_validation_jobs_tenant_creator_fk',
       'channel_provider_validation_jobs_tenant_id_unique',
       'channel_session_events_tenant_connector_fk',
       'channel_session_events_tenant_session_connector_fk',
       'channel_session_events_tenant_id_unique',
       'channel_session_events_tenant_exact_unique',
       'channel_sessions_tenant_connector_fk',
       'channel_sessions_tenant_id_unique',
       'channel_sessions_tenant_id_connector_unique',
       'source_connections_tenant_creator_fk'
     )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_partial_target';
  end if;
end;
$preflight$;

lock table
  public.employees,
  public.tenant_secrets,
  public.source_connections,
  public.source_accounts,
  public.channel_connectors,
  public.channel_sessions,
  public.channel_session_events,
  public.channel_auth_challenges,
  public.channel_provider_validation_jobs,
  public.inbox_v2_source_account_identity_transitions,
  public.inbox_v2_source_account_identity_verified_snapshots,
  public.inbox_v2_source_account_identities,
  public.inbox_v2_auth_resource_heads,
  public.inbox_v2_data_governance_registry_versions,
  public.inbox_v2_data_governance_data_use_lineages,
  public.inbox_v2_data_governance_effective_policies,
  public.inbox_v2_data_governance_effective_policy_rules,
  public.inbox_v2_data_governance_policy_activation_heads,
  public.inbox_v2_data_governance_control_set_heads
in share row exclusive mode;

do $validation$
begin
  if exists (
    select 1
      from public.source_connections connection_row
      left join public.employees creator_row
        on creator_row.tenant_id = connection_row.tenant_id
       and creator_row.id = connection_row.created_by_employee_id
     where connection_row.created_by_employee_id is not null
       and creator_row.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_connection_creator_incoherent';
  end if;

  if exists (
    select 1
      from public.channel_connectors connector_row
      left join public.source_connections connection_row
        on connection_row.tenant_id = connector_row.tenant_id
       and connection_row.id = connector_row.source_connection_id
      left join public.employees creator_row
        on creator_row.tenant_id = connector_row.tenant_id
       and creator_row.id = connector_row.created_by_employee_id
     where (connector_row.source_connection_id is not null and connection_row.id is null)
        or (connector_row.created_by_employee_id is not null and creator_row.id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_connector_incoherent';
  end if;

  if exists (
    select 1
      from public.channel_sessions session_row
      left join public.channel_connectors connector_row
        on connector_row.tenant_id = session_row.tenant_id
       and connector_row.id = session_row.connector_id
     where connector_row.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_session_incoherent';
  end if;

  if exists (
    select 1
      from public.channel_session_events event_row
      left join public.channel_connectors connector_row
        on connector_row.tenant_id = event_row.tenant_id
       and connector_row.id = event_row.connector_id
      left join public.channel_sessions session_row
        on session_row.tenant_id = event_row.tenant_id
       and session_row.id = event_row.session_id
       and session_row.connector_id = event_row.connector_id
     where connector_row.id is null
        or session_row.id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_session_event_incoherent';
  end if;

  if exists (
    select 1
      from public.channel_auth_challenges challenge_row
      left join public.channel_connectors connector_row
        on connector_row.tenant_id = challenge_row.tenant_id
       and connector_row.id = challenge_row.connector_id
      left join public.employees creator_row
        on creator_row.tenant_id = challenge_row.tenant_id
       and creator_row.id = challenge_row.created_by_employee_id
     where connector_row.id is null
        or (challenge_row.created_by_employee_id is not null and creator_row.id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_auth_challenge_incoherent';
  end if;

  if exists (
    select 1
      from public.channel_provider_validation_jobs job_row
      left join public.tenant_secrets secret_row
        on secret_row.tenant_id = job_row.tenant_id
       and secret_row.secret_ref = job_row.bot_token_secret_ref
      left join public.employees creator_row
        on creator_row.tenant_id = job_row.tenant_id
       and creator_row.id = job_row.created_by_employee_id
     where (job_row.bot_token_secret_ref is not null and secret_row.secret_ref is null)
        or (job_row.created_by_employee_id is not null and creator_row.id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_registry_preflight_provider_validation_incoherent';
  end if;
end;
$validation$;
