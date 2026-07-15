/**
 * Database-role boundary for the ADR 0010 revision-owned membership aggregate.
 *
 * The roles are deliberately NOLOGIN group roles. Deployment grants one of the
 * reader/executor roles to an environment-specific login; it must never grant
 * the owner role. The owner role exists only so SECURITY DEFINER entrypoints
 * can mutate the four revision-owned tables without giving application or
 * repair sessions direct DML privileges.
 *
 * This foundation installs the shared lock/isolation guard used by every
 * concrete membership mutation entrypoint. The guard intentionally does not
 * set a custom GUC or return a writable capability: PostgreSQL row locks are
 * the capability and remain attached to the caller's current transaction.
 */
export const INBOX_V2_MEMBERSHIP_PRIVILEGE_BOUNDARY_SQL = String.raw`
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
`;

/** Catalog query used by migration/install verification and live audits. */
export const INBOX_V2_MEMBERSHIP_PRIVILEGE_AUDIT_SQL = String.raw`
with expected_role(role_name) as (
  values
    ('hulee_inbox_v2_runtime'),
    ('hulee_inbox_v2_membership_repair')
),
revision_table(table_name) as (
  values
    ('public.inbox_v2_conversation_membership_heads'),
    ('public.inbox_v2_conversation_membership_commits'),
    ('public.inbox_v2_participant_membership_episodes'),
    ('public.inbox_v2_participant_membership_transitions')
),
forbidden_privilege(privilege_name) as (
  values
    ('INSERT'),
    ('UPDATE'),
    ('DELETE'),
    ('TRUNCATE'),
    ('REFERENCES'),
    ('TRIGGER')
),
head_lock_function as (
  select procedure_row.*
    from pg_catalog.pg_proc procedure_row
   where procedure_row.oid = pg_catalog.to_regprocedure(
     'public.inbox_v2_lock_conversation_membership_head_v1(text,text)'
   )
),
head_lock_function_acl as (
  select privilege_row.*
    from head_lock_function procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) privilege_row
),
boundary_function as (
  select procedure_row.*
    from pg_catalog.pg_proc procedure_row
   where procedure_row.oid = pg_catalog.to_regprocedure(
     'public.inbox_v2_apply_participant_membership_mutation_v1(jsonb)'
   )
),
boundary_function_acl as (
  select privilege_row.*
    from boundary_function procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) privilege_row
),
lock_function as (
  select procedure_row.*
    from pg_catalog.pg_proc procedure_row
   where procedure_row.oid = pg_catalog.to_regprocedure(
     'public.inbox_v2_lock_participant_membership_mutation_v1(text,text,bigint,text,text,public.inbox_v2_participant_membership_origin_kind,public.inbox_v2_participant_membership_state)'
   )
),
lock_function_acl as (
  select privilege_row.*
    from lock_function procedure_row
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        procedure_row.proacl,
        pg_catalog.acldefault('f', procedure_row.proowner)
      )
    ) privilege_row
)
select
  (
    select count(*) = 3 and pg_catalog.bool_and(
      not role_row.rolcanlogin
      and not role_row.rolsuper
      and not role_row.rolcreatedb
      and not role_row.rolcreaterole
      and not role_row.rolreplication
      and not role_row.rolbypassrls
    )
      from pg_catalog.pg_roles role_row
     where role_row.rolname in (
       'hulee_inbox_v2_membership_owner',
       'hulee_inbox_v2_runtime',
       'hulee_inbox_v2_membership_repair'
     )
  ) as database_roles_restricted,
  not exists (
    select 1
      from expected_role
      cross join revision_table
      cross join forbidden_privilege
     where pg_catalog.has_table_privilege(
       expected_role.role_name,
       revision_table.table_name,
       forbidden_privilege.privilege_name
     )
  ) as direct_mutation_denied,
  not exists (
    select 1
      from expected_role
      cross join revision_table
     where not pg_catalog.has_table_privilege(
       expected_role.role_name,
       revision_table.table_name,
       'SELECT'
     )
  ) as revision_select_allowed,
  pg_catalog.has_table_privilege(
    'hulee_inbox_v2_membership_owner',
    'public.inbox_v2_conversation_participants',
    'UPDATE'
  ) and pg_catalog.has_table_privilege(
    'hulee_inbox_v2_membership_owner',
    'public.employees',
    'UPDATE'
  ) and not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_runtime',
    'public.inbox_v2_conversation_participants',
    'UPDATE'
  ) and not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_runtime',
    'public.employees',
    'UPDATE'
  ) and not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_membership_repair',
    'public.inbox_v2_conversation_participants',
    'UPDATE'
  ) and not pg_catalog.has_table_privilege(
    'hulee_inbox_v2_membership_repair',
    'public.employees',
    'UPDATE'
  ) as lock_target_privileges_safe,
  coalesce((select procedure_row.prosecdef from boundary_function procedure_row), false)
    as entrypoint_security_definer,
  coalesce((
    select procedure_row.prosecdef
      and owner_role.rolname = 'hulee_inbox_v2_membership_owner'
      and procedure_row.proconfig @>
        array['search_path=pg_catalog, public, pg_temp']::text[]
      and pg_catalog.strpos(
        procedure_row.prosrc,
        'from public.inbox_v2_conversation_membership_heads'
      ) > 0
      and pg_catalog.strpos(procedure_row.prosrc, 'for update') > 0
      and not exists (
        select 1
          from head_lock_function_acl privilege_row
         where privilege_row.grantee = 0
           and privilege_row.privilege_type = 'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'hulee_inbox_v2_runtime', procedure_row.oid, 'EXECUTE'
      )
      and pg_catalog.has_function_privilege(
        'hulee_inbox_v2_membership_repair', procedure_row.oid, 'EXECUTE'
      )
      from head_lock_function procedure_row
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure_row.proowner
  ), false) as head_lock_entrypoint_safe,
  coalesce((
    select pg_catalog.strpos(
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
      from boundary_function procedure_row
  ), false) as entrypoint_fixed_writes,
  coalesce((
    select procedure_row.proconfig @>
      array['search_path=pg_catalog, public, pg_temp']::text[]
      from boundary_function procedure_row
  ), false) as entrypoint_search_path_fixed,
  coalesce((
    select owner_role.rolname = 'hulee_inbox_v2_membership_owner'
      from boundary_function procedure_row
      join pg_catalog.pg_roles owner_role
        on owner_role.oid = procedure_row.proowner
  ), false) as entrypoint_owner_isolated,
  not exists (
    select 1
      from boundary_function_acl privilege_row
     where privilege_row.grantee = 0
       and privilege_row.privilege_type = 'EXECUTE'
  ) as entrypoint_public_execute_denied,
  coalesce((
    select pg_catalog.has_function_privilege(
      'hulee_inbox_v2_runtime',
      procedure_row.oid,
      'EXECUTE'
    ) and pg_catalog.has_function_privilege(
      'hulee_inbox_v2_membership_repair',
      procedure_row.oid,
      'EXECUTE'
    )
      from boundary_function procedure_row
  ), false) as entrypoint_expected_execute_allowed,
  exists (select 1 from lock_function)
  and not exists (
    select 1
      from lock_function_acl privilege_row
     where privilege_row.privilege_type = 'EXECUTE'
       and privilege_row.grantee in (
         0,
         (select oid from pg_catalog.pg_roles
           where rolname = 'hulee_inbox_v2_runtime'),
         (select oid from pg_catalog.pg_roles
           where rolname = 'hulee_inbox_v2_membership_repair')
       )
  ) as lock_helper_not_executable,
  not pg_catalog.pg_has_role(
    'hulee_inbox_v2_runtime',
    'hulee_inbox_v2_membership_owner',
    'MEMBER'
  ) and not pg_catalog.pg_has_role(
    'hulee_inbox_v2_membership_repair',
    'hulee_inbox_v2_membership_owner',
    'MEMBER'
  ) as owner_role_not_inherited;
`;

/**
 * Retrying happens outside the aborted database transaction. No provider I/O
 * or other externally visible work may run inside this bounded retry loop.
 */
export const INBOX_V2_MEMBERSHIP_DB_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  retryableSqlStates: Object.freeze(["40P01", "40001"] as const)
});
