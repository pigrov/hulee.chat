-- INBOX_V2_SOURCE_REGISTRY_MIGRATION_FINALIZED_V1
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
--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_tenant_id_connector_unique" UNIQUE("tenant_id","id","connector_id");
--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_tenant_id_connection_unique" UNIQUE("tenant_id","id","source_connection_id");
--> statement-breakpoint
ALTER TABLE "channel_provider_validation_jobs" ADD CONSTRAINT "channel_provider_validation_jobs_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_tenant_exact_unique" UNIQUE("tenant_id","id","session_id","connector_id");
--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_tenant_id_unique" UNIQUE("tenant_id","id");
--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_tenant_id_connector_unique" UNIQUE("tenant_id","id","connector_id");
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_actor_kind" AS ENUM('employee', 'trusted_service');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_artifact_kind" AS ENUM('configuration', 'capability', 'metadata', 'diagnostic', 'catalog_registration', 'module_registration');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_authority_kind" AS ENUM('source_connection', 'source_account', 'channel_connector', 'channel_session', 'channel_auth_challenge');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_copy_slot" AS ENUM('source_connection_registry', 'source_account_registry', 'channel_connector_registry', 'channel_session_state', 'channel_session_event', 'channel_auth_challenge_outcome', 'credential_binding', 'source_registry_artifact', 'source_ingress_route', 'source_catalog_registration', 'source_module_registration');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_related_authority_kind" AS ENUM('channel_connector', 'channel_session', 'channel_session_event', 'channel_auth_challenge', 'source_ingress_route');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_related_authority_status" AS ENUM('active', 'revoked');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_route_authority_state" AS ENUM('enabled', 'inbound_only', 'denied');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_state" AS ENUM('pending', 'active', 'degraded', 'disabled', 'replaced', 'deleted');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_registry_transition_intent" AS ENUM('create', 'enable', 'disable', 'degrade', 'recover', 'reconnect', 'replace', 'delete', 'update_metadata');
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_artifact_refs" (
	"tenant_id" text NOT NULL,
	"authority_id" text NOT NULL,
	"authority_revision" bigint NOT NULL,
	"transition_id" text NOT NULL,
	"artifact_kind" "inbox_v2_source_registry_artifact_kind" NOT NULL,
	"payload_record_id" text NOT NULL,
	"payload_schema_id" text NOT NULL,
	"payload_schema_version" text NOT NULL,
	"payload_digest_sha256" text NOT NULL,
	"copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"effective_policy_id" text NOT NULL,
	"effective_policy_version" bigint NOT NULL,
	"effective_rule_id" text NOT NULL,
	"effective_rule_revision" bigint NOT NULL,
	"policy_activation_id" text NOT NULL,
	"policy_activation_revision" bigint NOT NULL,
	"policy_activation_head_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_registry_artifact_refs_pk" PRIMARY KEY("tenant_id","authority_id","authority_revision","artifact_kind"),
	CONSTRAINT "inbox_v2_source_registry_artifact_refs_values_check" CHECK ("inbox_v2_source_registry_artifact_refs"."authority_revision" >= 1
        and "inbox_v2_source_registry_artifact_refs"."lineage_revision" >= 1
        and "inbox_v2_source_registry_artifact_refs"."effective_policy_version" >= 1
        and "inbox_v2_source_registry_artifact_refs"."effective_rule_revision" >= 1
        and "inbox_v2_source_registry_artifact_refs"."policy_activation_revision" >= 1
        and "inbox_v2_source_registry_artifact_refs"."policy_activation_head_revision" >= 1
        and "inbox_v2_source_registry_artifact_refs"."legal_hold_set_revision" >= 0
        and "inbox_v2_source_registry_artifact_refs"."restriction_set_revision" >= 0
        and "inbox_v2_source_registry_artifact_refs"."registry_composition_hash" ~ '^[0-9a-f]{64}$'
        and "inbox_v2_source_registry_artifact_refs"."payload_digest_sha256" ~ '^[0-9a-f]{64}$'
        and (
          ("inbox_v2_source_registry_artifact_refs"."artifact_kind" = 'catalog_registration' and "inbox_v2_source_registry_artifact_refs"."copy_slot" = 'source_catalog_registration')
          or ("inbox_v2_source_registry_artifact_refs"."artifact_kind" = 'module_registration' and "inbox_v2_source_registry_artifact_refs"."copy_slot" = 'source_module_registration')
          or ("inbox_v2_source_registry_artifact_refs"."artifact_kind" not in ('catalog_registration', 'module_registration') and "inbox_v2_source_registry_artifact_refs"."copy_slot" = 'source_registry_artifact')
        )
        and isfinite("inbox_v2_source_registry_artifact_refs"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_heads" (
	"tenant_id" text NOT NULL,
	"authority_id" text NOT NULL,
	"authority_kind" "inbox_v2_source_registry_authority_kind" NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"connector_id" text,
	"session_id" text,
	"auth_challenge_id" text,
	"revision" bigint NOT NULL,
	"state" "inbox_v2_source_registry_state" NOT NULL,
	"route_generation" bigint NOT NULL,
	"route_authority_state" "inbox_v2_source_registry_route_authority_state" NOT NULL,
	"route_authority_reason_code_id" text NOT NULL,
	"route_authority_changed_at" timestamp (3) with time zone NOT NULL,
	"account_identity_transition_id" text,
	"account_identity_revision" bigint,
	"account_generation" bigint,
	"account_identity_state" "inbox_v2_source_account_identity_state",
	"account_identity_fence_digest_sha256" text,
	"account_canonical_key_digest_sha256" text,
	"account_access_resource_head_id" text,
	"account_resource_access_revision" bigint,
	"account_structural_relation_revision" bigint,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"adapter_handler_id" text,
	"authority_copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"authority_registry_id" text NOT NULL,
	"authority_registry_composition_hash" text NOT NULL,
	"authority_registry_revision" bigint NOT NULL,
	"authority_data_class_id" text NOT NULL,
	"authority_storage_root_id" text NOT NULL,
	"authority_purpose_id" text NOT NULL,
	"authority_canonical_anchor_id" text NOT NULL,
	"authority_lineage_revision" bigint NOT NULL,
	"authority_effective_policy_id" text NOT NULL,
	"authority_effective_policy_version" bigint NOT NULL,
	"authority_effective_rule_id" text NOT NULL,
	"authority_effective_rule_revision" bigint NOT NULL,
	"authority_policy_activation_id" text NOT NULL,
	"authority_policy_activation_revision" bigint NOT NULL,
	"authority_policy_activation_head_revision" bigint NOT NULL,
	"authority_legal_hold_set_revision" bigint NOT NULL,
	"authority_restriction_set_revision" bigint NOT NULL,
	"last_transition_id" text NOT NULL,
	"created_by_actor_kind" "inbox_v2_source_registry_actor_kind" NOT NULL,
	"created_by_employee_id" text,
	"created_by_trusted_service_id" text,
	"created_by_authorization_epoch" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_registry_heads_pk" PRIMARY KEY("tenant_id","authority_id"),
	CONSTRAINT "inbox_v2_source_registry_heads_revision_unique" UNIQUE("tenant_id","authority_id","revision"),
	CONSTRAINT "inbox_v2_source_registry_heads_target_check" CHECK ((
      "inbox_v2_source_registry_heads"."authority_kind" = 'source_connection'
      and num_nonnulls("inbox_v2_source_registry_heads"."source_account_id", "inbox_v2_source_registry_heads"."connector_id", "inbox_v2_source_registry_heads"."session_id", "inbox_v2_source_registry_heads"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_heads"."authority_kind" = 'source_account'
      and "inbox_v2_source_registry_heads"."source_account_id" is not null
      and num_nonnulls("inbox_v2_source_registry_heads"."connector_id", "inbox_v2_source_registry_heads"."session_id", "inbox_v2_source_registry_heads"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_heads"."authority_kind" = 'channel_connector'
      and "inbox_v2_source_registry_heads"."connector_id" is not null
      and num_nonnulls("inbox_v2_source_registry_heads"."source_account_id", "inbox_v2_source_registry_heads"."session_id", "inbox_v2_source_registry_heads"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_heads"."authority_kind" = 'channel_session'
      and "inbox_v2_source_registry_heads"."connector_id" is not null
      and "inbox_v2_source_registry_heads"."session_id" is not null
      and num_nonnulls("inbox_v2_source_registry_heads"."source_account_id", "inbox_v2_source_registry_heads"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_heads"."authority_kind" = 'channel_auth_challenge'
      and "inbox_v2_source_registry_heads"."connector_id" is not null
      and "inbox_v2_source_registry_heads"."auth_challenge_id" is not null
      and num_nonnulls("inbox_v2_source_registry_heads"."source_account_id", "inbox_v2_source_registry_heads"."session_id") = 0
    )),
	CONSTRAINT "inbox_v2_source_registry_heads_identity_check" CHECK ((
      "inbox_v2_source_registry_heads"."source_account_id" is null
      and num_nonnulls(
        "inbox_v2_source_registry_heads"."account_identity_transition_id",
        "inbox_v2_source_registry_heads"."account_identity_revision",
        "inbox_v2_source_registry_heads"."account_generation",
        "inbox_v2_source_registry_heads"."account_identity_state",
        "inbox_v2_source_registry_heads"."account_identity_fence_digest_sha256",
        "inbox_v2_source_registry_heads"."account_canonical_key_digest_sha256"
      ) = 0
      and num_nonnulls(
        "inbox_v2_source_registry_heads"."account_access_resource_head_id",
        "inbox_v2_source_registry_heads"."account_resource_access_revision",
        "inbox_v2_source_registry_heads"."account_structural_relation_revision"
      ) = 0
    ) or (
      "inbox_v2_source_registry_heads"."source_account_id" is not null
      and num_nonnulls(
        "inbox_v2_source_registry_heads"."account_identity_transition_id",
        "inbox_v2_source_registry_heads"."account_identity_revision",
        "inbox_v2_source_registry_heads"."account_generation",
        "inbox_v2_source_registry_heads"."account_identity_state",
        "inbox_v2_source_registry_heads"."account_identity_fence_digest_sha256"
      ) = 5
      and "inbox_v2_source_registry_heads"."account_identity_revision" >= 1
      and "inbox_v2_source_registry_heads"."account_generation" >= 1
      and "inbox_v2_source_registry_heads"."account_identity_fence_digest_sha256" ~ '^[0-9a-f]{64}$'
      and (
        ("inbox_v2_source_registry_heads"."account_identity_state" = 'verified' and "inbox_v2_source_registry_heads"."account_canonical_key_digest_sha256" is not null and "inbox_v2_source_registry_heads"."account_canonical_key_digest_sha256" ~ '^[0-9a-f]{64}$')
        or ("inbox_v2_source_registry_heads"."account_identity_state" <> 'verified' and "inbox_v2_source_registry_heads"."account_canonical_key_digest_sha256" is null)
      )
      and (
        (
          "inbox_v2_source_registry_heads"."route_authority_state" in ('enabled', 'inbound_only')
          and num_nonnulls(
            "inbox_v2_source_registry_heads"."account_access_resource_head_id",
            "inbox_v2_source_registry_heads"."account_resource_access_revision",
            "inbox_v2_source_registry_heads"."account_structural_relation_revision"
          ) = 3
          and "inbox_v2_source_registry_heads"."account_resource_access_revision" >= 1
          and "inbox_v2_source_registry_heads"."account_structural_relation_revision" >= 1
        ) or (
          "inbox_v2_source_registry_heads"."route_authority_state" = 'denied'
          and num_nonnulls(
            "inbox_v2_source_registry_heads"."account_access_resource_head_id",
            "inbox_v2_source_registry_heads"."account_resource_access_revision",
            "inbox_v2_source_registry_heads"."account_structural_relation_revision"
          ) in (0, 3)
        )
      )
      and ("inbox_v2_source_registry_heads"."route_authority_state" <> 'enabled' or "inbox_v2_source_registry_heads"."account_identity_state" = 'verified')
    )),
	CONSTRAINT "inbox_v2_source_registry_heads_lifecycle_check" CHECK ("inbox_v2_source_registry_heads"."authority_registry_composition_hash" ~ '^[0-9a-f]{64}$'
    and "inbox_v2_source_registry_heads"."authority_registry_revision" >= 1
    and "inbox_v2_source_registry_heads"."authority_lineage_revision" >= 1
    and "inbox_v2_source_registry_heads"."authority_effective_policy_version" >= 1
    and "inbox_v2_source_registry_heads"."authority_effective_rule_revision" >= 1
    and "inbox_v2_source_registry_heads"."authority_policy_activation_revision" >= 1
    and "inbox_v2_source_registry_heads"."authority_policy_activation_head_revision" >= 1
    and "inbox_v2_source_registry_heads"."authority_legal_hold_set_revision" >= 0
    and "inbox_v2_source_registry_heads"."authority_restriction_set_revision" >= 0
    and (
      ("inbox_v2_source_registry_heads"."authority_kind" = 'source_connection' and "inbox_v2_source_registry_heads"."authority_copy_slot" = 'source_connection_registry')
      or ("inbox_v2_source_registry_heads"."authority_kind" = 'source_account' and "inbox_v2_source_registry_heads"."authority_copy_slot" = 'source_account_registry')
      or ("inbox_v2_source_registry_heads"."authority_kind" = 'channel_connector' and "inbox_v2_source_registry_heads"."authority_copy_slot" = 'channel_connector_registry')
      or ("inbox_v2_source_registry_heads"."authority_kind" = 'channel_session' and "inbox_v2_source_registry_heads"."authority_copy_slot" = 'channel_session_state')
      or ("inbox_v2_source_registry_heads"."authority_kind" = 'channel_auth_challenge' and "inbox_v2_source_registry_heads"."authority_copy_slot" = 'channel_auth_challenge_outcome')
    )),
	CONSTRAINT "inbox_v2_source_registry_heads_creator_check" CHECK ((
      "inbox_v2_source_registry_heads"."created_by_actor_kind" = 'employee'
      and "inbox_v2_source_registry_heads"."created_by_employee_id" is not null
      and "inbox_v2_source_registry_heads"."created_by_trusted_service_id" is null
      and "inbox_v2_source_registry_heads"."created_by_authorization_epoch" is not null
      and char_length("inbox_v2_source_registry_heads"."created_by_authorization_epoch") between 8 and 1024
      and "inbox_v2_source_registry_heads"."created_by_authorization_epoch" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    ) or (
      "inbox_v2_source_registry_heads"."created_by_actor_kind" = 'trusted_service'
      and "inbox_v2_source_registry_heads"."created_by_employee_id" is null
      and "inbox_v2_source_registry_heads"."created_by_trusted_service_id" is not null
      and "inbox_v2_source_registry_heads"."created_by_authorization_epoch" is null
    )),
	CONSTRAINT "inbox_v2_source_registry_heads_values_check" CHECK ("inbox_v2_source_registry_heads"."revision" >= 1
        and "inbox_v2_source_registry_heads"."route_generation" >= 1
        and "inbox_v2_source_registry_heads"."adapter_declaration_revision" >= 1
        and isfinite("inbox_v2_source_registry_heads"."created_at")
        and isfinite("inbox_v2_source_registry_heads"."updated_at")
        and isfinite("inbox_v2_source_registry_heads"."adapter_loaded_at")
        and isfinite("inbox_v2_source_registry_heads"."route_authority_changed_at")
        and "inbox_v2_source_registry_heads"."adapter_loaded_at" <= "inbox_v2_source_registry_heads"."created_at"
        and "inbox_v2_source_registry_heads"."created_at" <= "inbox_v2_source_registry_heads"."route_authority_changed_at"
        and "inbox_v2_source_registry_heads"."route_authority_changed_at" <= "inbox_v2_source_registry_heads"."updated_at"
        and (
          ("inbox_v2_source_registry_heads"."state" in ('pending', 'disabled', 'replaced', 'deleted') and "inbox_v2_source_registry_heads"."route_authority_state" = 'denied')
          or ("inbox_v2_source_registry_heads"."state" in ('active', 'degraded'))
        )
        and "inbox_v2_source_registry_heads"."created_at" <= "inbox_v2_source_registry_heads"."updated_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_ingress_routes" (
	"tenant_id" text NOT NULL,
	"route_id" text NOT NULL,
	"route_revision" bigint NOT NULL,
	"route_digest_sha256" text NOT NULL,
	"parent_authority_id" text NOT NULL,
	"parent_authority_revision" bigint NOT NULL,
	"parent_transition_id" text NOT NULL,
	"route_generation" bigint NOT NULL,
	"adapter_handler_id" text NOT NULL,
	"copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"effective_policy_id" text NOT NULL,
	"effective_policy_version" bigint NOT NULL,
	"effective_rule_id" text NOT NULL,
	"effective_rule_revision" bigint NOT NULL,
	"policy_activation_id" text NOT NULL,
	"policy_activation_revision" bigint NOT NULL,
	"policy_activation_head_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"invalidated_at" timestamp (3) with time zone,
	"invalidated_by_transition_id" text,
	"invalidation_reason_code" text,
	CONSTRAINT "inbox_v2_source_registry_ingress_routes_pk" PRIMARY KEY("tenant_id","route_id","route_revision"),
	CONSTRAINT "inbox_v2_source_registry_ingress_routes_digest_unique" UNIQUE("route_digest_sha256"),
	CONSTRAINT "inbox_v2_source_registry_ingress_routes_authority_unique" UNIQUE("tenant_id","route_id","route_revision","parent_authority_id","route_generation"),
	CONSTRAINT "inbox_v2_source_registry_ingress_routes_values_check" CHECK ("inbox_v2_source_registry_ingress_routes"."route_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."parent_authority_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."route_generation" >= 1
        and "inbox_v2_source_registry_ingress_routes"."route_digest_sha256" ~ '^[0-9a-f]{64}$'
        and "inbox_v2_source_registry_ingress_routes"."copy_slot" = 'source_ingress_route'
        and "inbox_v2_source_registry_ingress_routes"."lineage_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."effective_policy_version" >= 1
        and "inbox_v2_source_registry_ingress_routes"."effective_rule_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."policy_activation_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."policy_activation_head_revision" >= 1
        and "inbox_v2_source_registry_ingress_routes"."legal_hold_set_revision" >= 0
        and "inbox_v2_source_registry_ingress_routes"."restriction_set_revision" >= 0
        and "inbox_v2_source_registry_ingress_routes"."registry_composition_hash" ~ '^[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_registry_ingress_routes"."created_at")
        and (
          ("inbox_v2_source_registry_ingress_routes"."invalidated_at" is null and "inbox_v2_source_registry_ingress_routes"."invalidated_by_transition_id" is null and "inbox_v2_source_registry_ingress_routes"."invalidation_reason_code" is null)
          or ("inbox_v2_source_registry_ingress_routes"."invalidated_at" is not null and isfinite("inbox_v2_source_registry_ingress_routes"."invalidated_at") and "inbox_v2_source_registry_ingress_routes"."invalidated_by_transition_id" is not null and "inbox_v2_source_registry_ingress_routes"."invalidation_reason_code" is not null and "inbox_v2_source_registry_ingress_routes"."created_at" <= "inbox_v2_source_registry_ingress_routes"."invalidated_at")
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_related_authority_refs" (
	"tenant_id" text NOT NULL,
	"parent_authority_id" text NOT NULL,
	"parent_authority_revision" bigint NOT NULL,
	"parent_transition_id" text NOT NULL,
	"kind" "inbox_v2_source_registry_related_authority_kind" NOT NULL,
	"authority_id" text NOT NULL,
	"authority_revision" bigint NOT NULL,
	"status" "inbox_v2_source_registry_related_authority_status" NOT NULL,
	"child_transition_id" text,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"connector_authority_id" text,
	"session_authority_id" text,
	"route_parent_authority_id" text,
	"handler_generation" bigint,
	"copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"effective_policy_id" text NOT NULL,
	"effective_policy_version" bigint NOT NULL,
	"effective_rule_id" text NOT NULL,
	"effective_rule_revision" bigint NOT NULL,
	"policy_activation_id" text NOT NULL,
	"policy_activation_revision" bigint NOT NULL,
	"policy_activation_head_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_registry_related_authority_refs_pk" PRIMARY KEY("tenant_id","parent_authority_id","parent_authority_revision","kind","authority_id"),
	CONSTRAINT "inbox_v2_source_registry_related_shape_check" CHECK ("inbox_v2_source_registry_related_authority_refs"."authority_revision" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."lineage_revision" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."effective_policy_version" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."effective_rule_revision" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."policy_activation_revision" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."policy_activation_head_revision" >= 1
        and "inbox_v2_source_registry_related_authority_refs"."legal_hold_set_revision" >= 0
        and "inbox_v2_source_registry_related_authority_refs"."restriction_set_revision" >= 0
        and "inbox_v2_source_registry_related_authority_refs"."registry_composition_hash" ~ '^[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_registry_related_authority_refs"."created_at")
        and (
          ("inbox_v2_source_registry_related_authority_refs"."kind" = 'channel_connector'
            and "inbox_v2_source_registry_related_authority_refs"."child_transition_id" is not null
            and "inbox_v2_source_registry_related_authority_refs"."copy_slot" = 'channel_connector_registry'
            and num_nonnulls("inbox_v2_source_registry_related_authority_refs"."connector_authority_id", "inbox_v2_source_registry_related_authority_refs"."session_authority_id", "inbox_v2_source_registry_related_authority_refs"."route_parent_authority_id", "inbox_v2_source_registry_related_authority_refs"."handler_generation") = 0)
          or ("inbox_v2_source_registry_related_authority_refs"."kind" = 'channel_session'
            and "inbox_v2_source_registry_related_authority_refs"."child_transition_id" is not null
            and "inbox_v2_source_registry_related_authority_refs"."copy_slot" = 'channel_session_state'
            and "inbox_v2_source_registry_related_authority_refs"."connector_authority_id" is not null
            and num_nonnulls("inbox_v2_source_registry_related_authority_refs"."session_authority_id", "inbox_v2_source_registry_related_authority_refs"."route_parent_authority_id", "inbox_v2_source_registry_related_authority_refs"."handler_generation") = 0)
          or ("inbox_v2_source_registry_related_authority_refs"."kind" = 'channel_session_event'
            and "inbox_v2_source_registry_related_authority_refs"."child_transition_id" is null
            and "inbox_v2_source_registry_related_authority_refs"."authority_revision" = 1
            and "inbox_v2_source_registry_related_authority_refs"."copy_slot" = 'channel_session_event'
            and "inbox_v2_source_registry_related_authority_refs"."connector_authority_id" is not null
            and "inbox_v2_source_registry_related_authority_refs"."session_authority_id" is not null
            and num_nonnulls("inbox_v2_source_registry_related_authority_refs"."route_parent_authority_id", "inbox_v2_source_registry_related_authority_refs"."handler_generation") = 0)
          or ("inbox_v2_source_registry_related_authority_refs"."kind" = 'channel_auth_challenge'
            and "inbox_v2_source_registry_related_authority_refs"."child_transition_id" is not null
            and "inbox_v2_source_registry_related_authority_refs"."copy_slot" = 'channel_auth_challenge_outcome'
            and "inbox_v2_source_registry_related_authority_refs"."connector_authority_id" is not null
            and num_nonnulls("inbox_v2_source_registry_related_authority_refs"."route_parent_authority_id", "inbox_v2_source_registry_related_authority_refs"."handler_generation") = 0)
          or ("inbox_v2_source_registry_related_authority_refs"."kind" = 'source_ingress_route'
            and "inbox_v2_source_registry_related_authority_refs"."child_transition_id" is null
            and "inbox_v2_source_registry_related_authority_refs"."copy_slot" = 'source_ingress_route'
            and "inbox_v2_source_registry_related_authority_refs"."route_parent_authority_id" = "inbox_v2_source_registry_related_authority_refs"."parent_authority_id"
            and "inbox_v2_source_registry_related_authority_refs"."handler_generation" >= 1
            and num_nonnulls("inbox_v2_source_registry_related_authority_refs"."connector_authority_id", "inbox_v2_source_registry_related_authority_refs"."session_authority_id") = 0)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_secret_refs" (
	"tenant_id" text NOT NULL,
	"authority_id" text NOT NULL,
	"authority_revision" bigint NOT NULL,
	"transition_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"binding_revision" bigint NOT NULL,
	"secret_ref" text NOT NULL,
	"copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"registry_id" text NOT NULL,
	"registry_composition_hash" text NOT NULL,
	"registry_revision" bigint NOT NULL,
	"data_class_id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"lineage_revision" bigint NOT NULL,
	"effective_policy_id" text NOT NULL,
	"effective_policy_version" bigint NOT NULL,
	"effective_rule_id" text NOT NULL,
	"effective_rule_revision" bigint NOT NULL,
	"policy_activation_id" text NOT NULL,
	"policy_activation_revision" bigint NOT NULL,
	"policy_activation_head_revision" bigint NOT NULL,
	"legal_hold_set_revision" bigint NOT NULL,
	"restriction_set_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"revoked_at" timestamp (3) with time zone,
	"revoked_by_transition_id" text,
	CONSTRAINT "inbox_v2_source_registry_secret_refs_pk" PRIMARY KEY("tenant_id","authority_id","authority_revision","binding_id"),
	CONSTRAINT "inbox_v2_source_registry_secret_refs_values_check" CHECK ("inbox_v2_source_registry_secret_refs"."authority_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."binding_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."lineage_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."effective_policy_version" >= 1
        and "inbox_v2_source_registry_secret_refs"."effective_rule_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."policy_activation_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."policy_activation_head_revision" >= 1
        and "inbox_v2_source_registry_secret_refs"."legal_hold_set_revision" >= 0
        and "inbox_v2_source_registry_secret_refs"."restriction_set_revision" >= 0
        and "inbox_v2_source_registry_secret_refs"."copy_slot" = 'credential_binding'
        and "inbox_v2_source_registry_secret_refs"."registry_composition_hash" ~ '^[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_registry_secret_refs"."created_at")
        and (
          ("inbox_v2_source_registry_secret_refs"."revoked_at" is null and "inbox_v2_source_registry_secret_refs"."revoked_by_transition_id" is null)
          or ("inbox_v2_source_registry_secret_refs"."revoked_at" is not null and isfinite("inbox_v2_source_registry_secret_refs"."revoked_at") and "inbox_v2_source_registry_secret_refs"."revoked_by_transition_id" is not null and "inbox_v2_source_registry_secret_refs"."created_at" <= "inbox_v2_source_registry_secret_refs"."revoked_at")
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_registry_transitions" (
	"tenant_id" text NOT NULL,
	"transition_id" text NOT NULL,
	"authority_id" text NOT NULL,
	"authority_kind" "inbox_v2_source_registry_authority_kind" NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"connector_id" text,
	"session_id" text,
	"auth_challenge_id" text,
	"intent" "inbox_v2_source_registry_transition_intent" NOT NULL,
	"expected_revision" bigint NOT NULL,
	"expected_route_generation" bigint,
	"resulting_revision" bigint NOT NULL,
	"from_state" "inbox_v2_source_registry_state",
	"to_state" "inbox_v2_source_registry_state" NOT NULL,
	"route_generation" bigint NOT NULL,
	"route_authority_state" "inbox_v2_source_registry_route_authority_state" NOT NULL,
	"route_authority_reason_code_id" text NOT NULL,
	"route_authority_changed_at" timestamp (3) with time zone NOT NULL,
	"account_identity_transition_id" text,
	"account_identity_revision" bigint,
	"account_generation" bigint,
	"account_identity_state" "inbox_v2_source_account_identity_state",
	"account_identity_fence_digest_sha256" text,
	"account_canonical_key_digest_sha256" text,
	"account_access_resource_head_id" text,
	"account_resource_access_revision" bigint,
	"account_structural_relation_revision" bigint,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"adapter_handler_id" text,
	"authority_copy_slot" "inbox_v2_source_registry_copy_slot" NOT NULL,
	"authority_registry_id" text NOT NULL,
	"authority_registry_composition_hash" text NOT NULL,
	"authority_registry_revision" bigint NOT NULL,
	"authority_data_class_id" text NOT NULL,
	"authority_storage_root_id" text NOT NULL,
	"authority_purpose_id" text NOT NULL,
	"authority_canonical_anchor_id" text NOT NULL,
	"authority_lineage_revision" bigint NOT NULL,
	"authority_effective_policy_id" text NOT NULL,
	"authority_effective_policy_version" bigint NOT NULL,
	"authority_effective_rule_id" text NOT NULL,
	"authority_effective_rule_revision" bigint NOT NULL,
	"authority_policy_activation_id" text NOT NULL,
	"authority_policy_activation_revision" bigint NOT NULL,
	"authority_policy_activation_head_revision" bigint NOT NULL,
	"authority_legal_hold_set_revision" bigint NOT NULL,
	"authority_restriction_set_revision" bigint NOT NULL,
	"transition_digest_sha256" text NOT NULL,
	"created_by_actor_kind" "inbox_v2_source_registry_actor_kind" NOT NULL,
	"created_by_employee_id" text,
	"created_by_trusted_service_id" text,
	"created_by_authorization_epoch" text,
	"authority_created_at" timestamp (3) with time zone NOT NULL,
	"actor_kind" "inbox_v2_source_registry_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"actor_authorization_epoch" text,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_registry_transitions_pk" PRIMARY KEY("tenant_id","transition_id"),
	CONSTRAINT "inbox_v2_source_registry_transitions_revision_unique" UNIQUE("tenant_id","authority_id","resulting_revision"),
	CONSTRAINT "inbox_v2_source_registry_transitions_authority_revision_unique" UNIQUE("tenant_id","transition_id","authority_id","resulting_revision"),
	CONSTRAINT "inbox_v2_source_registry_transitions_head_unique" UNIQUE("tenant_id","transition_id","authority_id","resulting_revision","to_state","route_generation"),
	CONSTRAINT "inbox_v2_source_registry_transitions_target_check" CHECK ((
      "inbox_v2_source_registry_transitions"."authority_kind" = 'source_connection'
      and num_nonnulls("inbox_v2_source_registry_transitions"."source_account_id", "inbox_v2_source_registry_transitions"."connector_id", "inbox_v2_source_registry_transitions"."session_id", "inbox_v2_source_registry_transitions"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_transitions"."authority_kind" = 'source_account'
      and "inbox_v2_source_registry_transitions"."source_account_id" is not null
      and num_nonnulls("inbox_v2_source_registry_transitions"."connector_id", "inbox_v2_source_registry_transitions"."session_id", "inbox_v2_source_registry_transitions"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_transitions"."authority_kind" = 'channel_connector'
      and "inbox_v2_source_registry_transitions"."connector_id" is not null
      and num_nonnulls("inbox_v2_source_registry_transitions"."source_account_id", "inbox_v2_source_registry_transitions"."session_id", "inbox_v2_source_registry_transitions"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_transitions"."authority_kind" = 'channel_session'
      and "inbox_v2_source_registry_transitions"."connector_id" is not null
      and "inbox_v2_source_registry_transitions"."session_id" is not null
      and num_nonnulls("inbox_v2_source_registry_transitions"."source_account_id", "inbox_v2_source_registry_transitions"."auth_challenge_id") = 0
    ) or (
      "inbox_v2_source_registry_transitions"."authority_kind" = 'channel_auth_challenge'
      and "inbox_v2_source_registry_transitions"."connector_id" is not null
      and "inbox_v2_source_registry_transitions"."auth_challenge_id" is not null
      and num_nonnulls("inbox_v2_source_registry_transitions"."source_account_id", "inbox_v2_source_registry_transitions"."session_id") = 0
    )),
	CONSTRAINT "inbox_v2_source_registry_transitions_identity_check" CHECK ((
      "inbox_v2_source_registry_transitions"."source_account_id" is null
      and num_nonnulls(
        "inbox_v2_source_registry_transitions"."account_identity_transition_id",
        "inbox_v2_source_registry_transitions"."account_identity_revision",
        "inbox_v2_source_registry_transitions"."account_generation",
        "inbox_v2_source_registry_transitions"."account_identity_state",
        "inbox_v2_source_registry_transitions"."account_identity_fence_digest_sha256",
        "inbox_v2_source_registry_transitions"."account_canonical_key_digest_sha256"
      ) = 0
      and num_nonnulls(
        "inbox_v2_source_registry_transitions"."account_access_resource_head_id",
        "inbox_v2_source_registry_transitions"."account_resource_access_revision",
        "inbox_v2_source_registry_transitions"."account_structural_relation_revision"
      ) = 0
    ) or (
      "inbox_v2_source_registry_transitions"."source_account_id" is not null
      and num_nonnulls(
        "inbox_v2_source_registry_transitions"."account_identity_transition_id",
        "inbox_v2_source_registry_transitions"."account_identity_revision",
        "inbox_v2_source_registry_transitions"."account_generation",
        "inbox_v2_source_registry_transitions"."account_identity_state",
        "inbox_v2_source_registry_transitions"."account_identity_fence_digest_sha256"
      ) = 5
      and "inbox_v2_source_registry_transitions"."account_identity_revision" >= 1
      and "inbox_v2_source_registry_transitions"."account_generation" >= 1
      and "inbox_v2_source_registry_transitions"."account_identity_fence_digest_sha256" ~ '^[0-9a-f]{64}$'
      and (
        ("inbox_v2_source_registry_transitions"."account_identity_state" = 'verified' and "inbox_v2_source_registry_transitions"."account_canonical_key_digest_sha256" is not null and "inbox_v2_source_registry_transitions"."account_canonical_key_digest_sha256" ~ '^[0-9a-f]{64}$')
        or ("inbox_v2_source_registry_transitions"."account_identity_state" <> 'verified' and "inbox_v2_source_registry_transitions"."account_canonical_key_digest_sha256" is null)
      )
      and (
        (
          "inbox_v2_source_registry_transitions"."route_authority_state" in ('enabled', 'inbound_only')
          and num_nonnulls(
            "inbox_v2_source_registry_transitions"."account_access_resource_head_id",
            "inbox_v2_source_registry_transitions"."account_resource_access_revision",
            "inbox_v2_source_registry_transitions"."account_structural_relation_revision"
          ) = 3
          and "inbox_v2_source_registry_transitions"."account_resource_access_revision" >= 1
          and "inbox_v2_source_registry_transitions"."account_structural_relation_revision" >= 1
        ) or (
          "inbox_v2_source_registry_transitions"."route_authority_state" = 'denied'
          and num_nonnulls(
            "inbox_v2_source_registry_transitions"."account_access_resource_head_id",
            "inbox_v2_source_registry_transitions"."account_resource_access_revision",
            "inbox_v2_source_registry_transitions"."account_structural_relation_revision"
          ) in (0, 3)
        )
      )
      and ("inbox_v2_source_registry_transitions"."route_authority_state" <> 'enabled' or "inbox_v2_source_registry_transitions"."account_identity_state" = 'verified')
    )),
	CONSTRAINT "inbox_v2_source_registry_transitions_lifecycle_check" CHECK ("inbox_v2_source_registry_transitions"."authority_registry_composition_hash" ~ '^[0-9a-f]{64}$'
    and "inbox_v2_source_registry_transitions"."authority_registry_revision" >= 1
    and "inbox_v2_source_registry_transitions"."authority_lineage_revision" >= 1
    and "inbox_v2_source_registry_transitions"."authority_effective_policy_version" >= 1
    and "inbox_v2_source_registry_transitions"."authority_effective_rule_revision" >= 1
    and "inbox_v2_source_registry_transitions"."authority_policy_activation_revision" >= 1
    and "inbox_v2_source_registry_transitions"."authority_policy_activation_head_revision" >= 1
    and "inbox_v2_source_registry_transitions"."authority_legal_hold_set_revision" >= 0
    and "inbox_v2_source_registry_transitions"."authority_restriction_set_revision" >= 0
    and (
      ("inbox_v2_source_registry_transitions"."authority_kind" = 'source_connection' and "inbox_v2_source_registry_transitions"."authority_copy_slot" = 'source_connection_registry')
      or ("inbox_v2_source_registry_transitions"."authority_kind" = 'source_account' and "inbox_v2_source_registry_transitions"."authority_copy_slot" = 'source_account_registry')
      or ("inbox_v2_source_registry_transitions"."authority_kind" = 'channel_connector' and "inbox_v2_source_registry_transitions"."authority_copy_slot" = 'channel_connector_registry')
      or ("inbox_v2_source_registry_transitions"."authority_kind" = 'channel_session' and "inbox_v2_source_registry_transitions"."authority_copy_slot" = 'channel_session_state')
      or ("inbox_v2_source_registry_transitions"."authority_kind" = 'channel_auth_challenge' and "inbox_v2_source_registry_transitions"."authority_copy_slot" = 'channel_auth_challenge_outcome')
    )),
	CONSTRAINT "inbox_v2_source_registry_transitions_creator_check" CHECK ((
      "inbox_v2_source_registry_transitions"."created_by_actor_kind" = 'employee'
      and "inbox_v2_source_registry_transitions"."created_by_employee_id" is not null
      and "inbox_v2_source_registry_transitions"."created_by_trusted_service_id" is null
      and "inbox_v2_source_registry_transitions"."created_by_authorization_epoch" is not null
      and char_length("inbox_v2_source_registry_transitions"."created_by_authorization_epoch") between 8 and 1024
      and "inbox_v2_source_registry_transitions"."created_by_authorization_epoch" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    ) or (
      "inbox_v2_source_registry_transitions"."created_by_actor_kind" = 'trusted_service'
      and "inbox_v2_source_registry_transitions"."created_by_employee_id" is null
      and "inbox_v2_source_registry_transitions"."created_by_trusted_service_id" is not null
      and "inbox_v2_source_registry_transitions"."created_by_authorization_epoch" is null
    )),
	CONSTRAINT "inbox_v2_source_registry_transitions_actor_check" CHECK ((
      "inbox_v2_source_registry_transitions"."actor_kind" = 'employee'
      and "inbox_v2_source_registry_transitions"."actor_employee_id" is not null
      and "inbox_v2_source_registry_transitions"."actor_trusted_service_id" is null
      and "inbox_v2_source_registry_transitions"."actor_authorization_epoch" is not null
      and char_length("inbox_v2_source_registry_transitions"."actor_authorization_epoch") between 8 and 1024
      and "inbox_v2_source_registry_transitions"."actor_authorization_epoch" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    ) or (
      "inbox_v2_source_registry_transitions"."actor_kind" = 'trusted_service'
      and "inbox_v2_source_registry_transitions"."actor_employee_id" is null
      and "inbox_v2_source_registry_transitions"."actor_trusted_service_id" is not null
      and "inbox_v2_source_registry_transitions"."actor_authorization_epoch" is null
    )),
	CONSTRAINT "inbox_v2_source_registry_transitions_revision_check" CHECK ("inbox_v2_source_registry_transitions"."expected_revision" >= 0
        and "inbox_v2_source_registry_transitions"."resulting_revision" = "inbox_v2_source_registry_transitions"."expected_revision" + 1
        and "inbox_v2_source_registry_transitions"."route_generation" >= 1
        and "inbox_v2_source_registry_transitions"."adapter_declaration_revision" >= 1
        and isfinite("inbox_v2_source_registry_transitions"."adapter_loaded_at")
        and isfinite("inbox_v2_source_registry_transitions"."route_authority_changed_at")
        and isfinite("inbox_v2_source_registry_transitions"."authority_created_at")
        and "inbox_v2_source_registry_transitions"."adapter_loaded_at" <= "inbox_v2_source_registry_transitions"."occurred_at"
        and "inbox_v2_source_registry_transitions"."authority_created_at" <= "inbox_v2_source_registry_transitions"."occurred_at"
        and "inbox_v2_source_registry_transitions"."route_authority_changed_at" <= "inbox_v2_source_registry_transitions"."occurred_at"
        and (
          ("inbox_v2_source_registry_transitions"."to_state" in ('pending', 'disabled', 'replaced', 'deleted') and "inbox_v2_source_registry_transitions"."route_authority_state" = 'denied')
          or ("inbox_v2_source_registry_transitions"."to_state" in ('active', 'degraded'))
        )
        and (
          ("inbox_v2_source_registry_transitions"."expected_revision" = 0 and "inbox_v2_source_registry_transitions"."expected_route_generation" is null and "inbox_v2_source_registry_transitions"."route_generation" = 1 and "inbox_v2_source_registry_transitions"."intent" = 'create' and "inbox_v2_source_registry_transitions"."from_state" is null)
          or (
            "inbox_v2_source_registry_transitions"."expected_revision" >= 1
            and "inbox_v2_source_registry_transitions"."expected_route_generation" >= 1
            and "inbox_v2_source_registry_transitions"."route_generation" between "inbox_v2_source_registry_transitions"."expected_route_generation" and "inbox_v2_source_registry_transitions"."expected_route_generation" + 1
            and (
              "inbox_v2_source_registry_transitions"."intent" not in ('enable', 'disable', 'reconnect', 'replace', 'delete')
              or "inbox_v2_source_registry_transitions"."route_generation" = "inbox_v2_source_registry_transitions"."expected_route_generation" + 1
            )
            and "inbox_v2_source_registry_transitions"."intent" <> 'create'
            and "inbox_v2_source_registry_transitions"."from_state" is not null
          )
        )),
	CONSTRAINT "inbox_v2_source_registry_transitions_digest_check" CHECK ("inbox_v2_source_registry_transitions"."transition_digest_sha256" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_source_registry_transitions_time_check" CHECK (isfinite("inbox_v2_source_registry_transitions"."occurred_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_artifact_refs" ADD CONSTRAINT "inbox_v2_source_registry_artifact_refs_transition_fk" FOREIGN KEY ("tenant_id","transition_id","authority_id","authority_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_artifact_refs" ADD CONSTRAINT "inbox_v2_source_registry_artifact_refs_policy_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_artifact_refs" ADD CONSTRAINT "inbox_v2_source_registry_artifact_refs_rule_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version","effective_rule_id","effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_artifact_refs" ADD CONSTRAINT "inbox_v2_source_registry_artifact_refs_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_artifact_refs" ADD CONSTRAINT "inbox_v2_source_registry_artifact_refs_lineage_fk" FOREIGN KEY ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_connector_fk" FOREIGN KEY ("tenant_id","connector_id","source_connection_id") REFERENCES "public"."channel_connectors"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_session_fk" FOREIGN KEY ("tenant_id","session_id","connector_id") REFERENCES "public"."channel_sessions"("tenant_id","id","connector_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_challenge_fk" FOREIGN KEY ("tenant_id","auth_challenge_id","connector_id") REFERENCES "public"."channel_auth_challenges"("tenant_id","id","connector_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_lineage_fk" FOREIGN KEY ("authority_registry_id","authority_registry_revision","authority_data_class_id","authority_storage_root_id","authority_purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_policy_fk" FOREIGN KEY ("tenant_id","authority_effective_policy_id","authority_effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_rule_fk" FOREIGN KEY ("tenant_id","authority_effective_policy_id","authority_effective_policy_version","authority_effective_rule_id","authority_effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_access_head_fk" FOREIGN KEY ("tenant_id","account_access_resource_head_id") REFERENCES "public"."inbox_v2_auth_resource_heads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_identity_transition_fk" FOREIGN KEY ("tenant_id","account_identity_transition_id","source_account_id","account_identity_revision","account_generation") REFERENCES "public"."inbox_v2_source_account_identity_transitions"("tenant_id","id","source_account_id","resulting_revision","resulting_account_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_verified_identity_fk" FOREIGN KEY ("tenant_id","source_account_id","account_identity_revision","account_generation","account_identity_state","account_canonical_key_digest_sha256") REFERENCES "public"."inbox_v2_source_account_identity_verified_snapshots"("tenant_id","source_account_id","identity_revision","account_generation","state","canonical_key_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_heads" ADD CONSTRAINT "inbox_v2_source_registry_heads_transition_fk" FOREIGN KEY ("tenant_id","last_transition_id","authority_id","revision","state","route_generation") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision","to_state","route_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_transition_fk" FOREIGN KEY ("tenant_id","parent_transition_id","parent_authority_id","parent_authority_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_policy_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_rule_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version","effective_rule_id","effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_lineage_fk" FOREIGN KEY ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_ingress_routes" ADD CONSTRAINT "inbox_v2_source_registry_ingress_routes_invalidation_fk" FOREIGN KEY ("tenant_id","invalidated_by_transition_id") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_parent_transition_fk" FOREIGN KEY ("tenant_id","parent_transition_id","parent_authority_id","parent_authority_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_child_transition_fk" FOREIGN KEY ("tenant_id","child_transition_id","authority_id","authority_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_lineage_fk" FOREIGN KEY ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_policy_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_rule_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version","effective_rule_id","effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_related_authority_refs" ADD CONSTRAINT "inbox_v2_source_registry_related_ingress_route_fk" FOREIGN KEY ("tenant_id","authority_id","authority_revision","route_parent_authority_id","handler_generation") REFERENCES "public"."inbox_v2_source_registry_ingress_routes"("tenant_id","route_id","route_revision","parent_authority_id","route_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_transition_fk" FOREIGN KEY ("tenant_id","transition_id","authority_id","authority_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_policy_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_rule_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version","effective_rule_id","effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_secret_fk" FOREIGN KEY ("tenant_id","secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_revocation_fk" FOREIGN KEY ("tenant_id","revoked_by_transition_id") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_secret_refs" ADD CONSTRAINT "inbox_v2_source_registry_secret_refs_lineage_fk" FOREIGN KEY ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_connector_fk" FOREIGN KEY ("tenant_id","connector_id","source_connection_id") REFERENCES "public"."channel_connectors"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_session_fk" FOREIGN KEY ("tenant_id","session_id","connector_id") REFERENCES "public"."channel_sessions"("tenant_id","id","connector_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_challenge_fk" FOREIGN KEY ("tenant_id","auth_challenge_id","connector_id") REFERENCES "public"."channel_auth_challenges"("tenant_id","id","connector_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_lineage_fk" FOREIGN KEY ("authority_registry_id","authority_registry_revision","authority_data_class_id","authority_storage_root_id","authority_purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_policy_fk" FOREIGN KEY ("tenant_id","authority_effective_policy_id","authority_effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_rule_fk" FOREIGN KEY ("tenant_id","authority_effective_policy_id","authority_effective_policy_version","authority_effective_rule_id","authority_effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_access_head_fk" FOREIGN KEY ("tenant_id","account_access_resource_head_id") REFERENCES "public"."inbox_v2_auth_resource_heads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_identity_transition_fk" FOREIGN KEY ("tenant_id","account_identity_transition_id","source_account_id","account_identity_revision","account_generation") REFERENCES "public"."inbox_v2_source_account_identity_transitions"("tenant_id","id","source_account_id","resulting_revision","resulting_account_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_registry_transitions" ADD CONSTRAINT "inbox_v2_source_registry_transitions_verified_identity_fk" FOREIGN KEY ("tenant_id","source_account_id","account_identity_revision","account_generation","account_identity_state","account_canonical_key_digest_sha256") REFERENCES "public"."inbox_v2_source_account_identity_verified_snapshots"("tenant_id","source_account_id","identity_revision","account_generation","state","canonical_key_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_artifact_refs_lineage_idx" ON "inbox_v2_source_registry_artifact_refs" USING btree ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_registry_heads_connection_unique" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","source_connection_id") WHERE "inbox_v2_source_registry_heads"."authority_kind" = 'source_connection';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_registry_heads_account_unique" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","source_account_id") WHERE "inbox_v2_source_registry_heads"."authority_kind" = 'source_account';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_registry_heads_connector_unique" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","connector_id") WHERE "inbox_v2_source_registry_heads"."authority_kind" = 'channel_connector';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_registry_heads_session_unique" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","session_id") WHERE "inbox_v2_source_registry_heads"."authority_kind" = 'channel_session';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_registry_heads_challenge_unique" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","auth_challenge_id") WHERE "inbox_v2_source_registry_heads"."authority_kind" = 'channel_auth_challenge';
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_heads_state_idx" ON "inbox_v2_source_registry_heads" USING btree ("tenant_id","state","authority_kind");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_ingress_routes_authority_idx" ON "inbox_v2_source_registry_ingress_routes" USING btree ("tenant_id","parent_authority_id","parent_authority_revision","route_generation","invalidated_at");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_related_parent_idx" ON "inbox_v2_source_registry_related_authority_refs" USING btree ("tenant_id","parent_authority_id","parent_authority_revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_related_child_idx" ON "inbox_v2_source_registry_related_authority_refs" USING btree ("tenant_id","authority_id","authority_revision","status");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_secret_refs_current_idx" ON "inbox_v2_source_registry_secret_refs" USING btree ("tenant_id","authority_id","binding_id","revoked_at");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_registry_transitions_authority_idx" ON "inbox_v2_source_registry_transitions" USING btree ("tenant_id","authority_id","resulting_revision");
--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_tenant_connector_fk" FOREIGN KEY ("tenant_id","connector_id") REFERENCES "public"."channel_connectors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_auth_challenges" ADD CONSTRAINT "channel_auth_challenges_tenant_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_tenant_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_connectors" ADD CONSTRAINT "channel_connectors_tenant_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_provider_validation_jobs" ADD CONSTRAINT "channel_provider_validation_jobs_tenant_secret_fk" FOREIGN KEY ("tenant_id","bot_token_secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_provider_validation_jobs" ADD CONSTRAINT "channel_provider_validation_jobs_tenant_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_tenant_connector_fk" FOREIGN KEY ("tenant_id","connector_id") REFERENCES "public"."channel_connectors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_session_events" ADD CONSTRAINT "channel_session_events_tenant_session_connector_fk" FOREIGN KEY ("tenant_id","session_id","connector_id") REFERENCES "public"."channel_sessions"("tenant_id","id","connector_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "channel_sessions" ADD CONSTRAINT "channel_sessions_tenant_connector_fk" FOREIGN KEY ("tenant_id","connector_id") REFERENCES "public"."channel_connectors"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "source_connections" ADD CONSTRAINT "source_connections_tenant_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
create or replace function public.inbox_v2_assert_source_registry_lineage(
  checked_tenant_id text,
  checked_registry_id text,
  checked_registry_revision bigint,
  checked_registry_composition_hash text,
  checked_data_class_id text,
  checked_storage_root_id text,
  checked_purpose_id text,
  checked_canonical_anchor_id text,
  checked_lineage_revision bigint,
  checked_effective_policy_id text,
  checked_effective_policy_version bigint,
  checked_effective_rule_id text,
  checked_effective_rule_revision bigint,
  checked_policy_activation_id text,
  checked_policy_activation_revision bigint,
  checked_policy_activation_head_revision bigint,
  checked_legal_hold_set_revision bigint,
  checked_restriction_set_revision bigint,
  checked_requires_export boolean
)
returns void
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  perform 1
    from public.inbox_v2_data_governance_registry_versions registry_row
    join public.inbox_v2_data_governance_data_use_lineages lineage_row
      on lineage_row.registry_id = registry_row.id
     and lineage_row.registry_revision = registry_row.revision
    join public.inbox_v2_data_governance_effective_policies policy_row
      on policy_row.tenant_id = checked_tenant_id
     and policy_row.policy_id = checked_effective_policy_id
     and policy_row.version = checked_effective_policy_version
     and policy_row.registry_id = registry_row.id
     and policy_row.registry_revision = registry_row.revision
    join public.inbox_v2_data_governance_effective_policy_rules rule_row
      on rule_row.tenant_id = policy_row.tenant_id
     and rule_row.policy_id = policy_row.policy_id
     and rule_row.policy_version = policy_row.version
     and rule_row.rule_id = checked_effective_rule_id
     and rule_row.rule_revision = checked_effective_rule_revision
     and rule_row.data_class_id = lineage_row.data_class_id
     and rule_row.purpose_id = lineage_row.purpose_id
     and rule_row.retention_anchor_id = lineage_row.canonical_anchor_id
    join public.inbox_v2_data_governance_policy_activation_heads activation_head
      on activation_head.tenant_id = policy_row.tenant_id
     and activation_head.policy_id = policy_row.policy_id
     and activation_head.current_policy_version = policy_row.version
     and activation_head.current_activation_id = checked_policy_activation_id
     and activation_head.current_activation_revision = checked_policy_activation_revision
     and activation_head.head_revision = checked_policy_activation_head_revision
    join public.inbox_v2_data_governance_control_set_heads control_head
      on control_head.tenant_id = policy_row.tenant_id
     and control_head.legal_hold_set_revision = checked_legal_hold_set_revision
     and control_head.restriction_set_revision = checked_restriction_set_revision
   where registry_row.id = checked_registry_id
     and registry_row.revision = checked_registry_revision
     and registry_row.composition_hash =
       'sha256:' || checked_registry_composition_hash
     and lineage_row.data_class_id = checked_data_class_id
     and lineage_row.storage_root_id = checked_storage_root_id
     and lineage_row.purpose_id = checked_purpose_id
     and lineage_row.canonical_anchor_id = checked_canonical_anchor_id
     and lineage_row.lineage_revision = checked_lineage_revision
     and lineage_row.lifecycle_handler_id is not null
     and lineage_row.delete_handler_id is not null
     and lineage_row.verification_handler_id is not null
     and (
       not checked_requires_export
       or (
         lineage_row.subject_discovery_handler_id is not null
         and lineage_row.export_projection_handler_id is not null
         and lineage_row.export_handler_id is not null
       )
     );

  if not found then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_lineage_incomplete_or_stale';
  end if;
end;
$function$;

create or replace function public.inbox_v2_source_registry_transition_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_transition_immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_artifact_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op <> 'INSERT' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_artifact_immutable';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_related_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using
    errcode = '55000',
    message = 'inbox_v2.source_registry_related_authority_immutable';
end;
$function$;

create or replace function public.inbox_v2_source_registry_secret_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_secret_binding_immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.authority_id is distinct from old.authority_id
    or new.authority_revision is distinct from old.authority_revision
    or new.transition_id is distinct from old.transition_id
    or new.secret_ref is distinct from old.secret_ref
    or new.binding_id is distinct from old.binding_id
    or new.binding_revision is distinct from old.binding_revision
    or new.copy_slot is distinct from old.copy_slot
    or new.registry_id is distinct from old.registry_id
    or new.registry_composition_hash is distinct from old.registry_composition_hash
    or new.registry_revision is distinct from old.registry_revision
    or new.data_class_id is distinct from old.data_class_id
    or new.storage_root_id is distinct from old.storage_root_id
    or new.purpose_id is distinct from old.purpose_id
    or new.canonical_anchor_id is distinct from old.canonical_anchor_id
    or new.lineage_revision is distinct from old.lineage_revision
    or new.effective_policy_id is distinct from old.effective_policy_id
    or new.effective_policy_version is distinct from old.effective_policy_version
    or new.effective_rule_id is distinct from old.effective_rule_id
    or new.effective_rule_revision is distinct from old.effective_rule_revision
    or new.policy_activation_id is distinct from old.policy_activation_id
    or new.policy_activation_revision is distinct from old.policy_activation_revision
    or new.policy_activation_head_revision is distinct from old.policy_activation_head_revision
    or new.legal_hold_set_revision is distinct from old.legal_hold_set_revision
    or new.restriction_set_revision is distinct from old.restriction_set_revision
    or new.created_at is distinct from old.created_at
    or old.revoked_at is not null
    or new.revoked_at is null
    or new.revoked_by_transition_id is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_secret_binding_immutable';
  end if;
  if tg_op = 'UPDATE' and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.transition_id = new.revoked_by_transition_id
       and transition_row.authority_id = new.authority_id
       and transition_row.resulting_revision > old.authority_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_secret_revocation_authority_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_route_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_route_immutable';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.route_id is distinct from old.route_id
    or new.route_revision is distinct from old.route_revision
    or new.route_digest_sha256 is distinct from old.route_digest_sha256
    or new.parent_authority_id is distinct from old.parent_authority_id
    or new.parent_authority_revision is distinct from old.parent_authority_revision
    or new.parent_transition_id is distinct from old.parent_transition_id
    or new.route_generation is distinct from old.route_generation
    or new.adapter_handler_id is distinct from old.adapter_handler_id
    or new.copy_slot is distinct from old.copy_slot
    or new.registry_id is distinct from old.registry_id
    or new.registry_composition_hash is distinct from old.registry_composition_hash
    or new.registry_revision is distinct from old.registry_revision
    or new.data_class_id is distinct from old.data_class_id
    or new.storage_root_id is distinct from old.storage_root_id
    or new.purpose_id is distinct from old.purpose_id
    or new.canonical_anchor_id is distinct from old.canonical_anchor_id
    or new.lineage_revision is distinct from old.lineage_revision
    or new.effective_policy_id is distinct from old.effective_policy_id
    or new.effective_policy_version is distinct from old.effective_policy_version
    or new.effective_rule_id is distinct from old.effective_rule_id
    or new.effective_rule_revision is distinct from old.effective_rule_revision
    or new.policy_activation_id is distinct from old.policy_activation_id
    or new.policy_activation_revision is distinct from old.policy_activation_revision
    or new.policy_activation_head_revision is distinct from old.policy_activation_head_revision
    or new.legal_hold_set_revision is distinct from old.legal_hold_set_revision
    or new.restriction_set_revision is distinct from old.restriction_set_revision
    or new.created_at is distinct from old.created_at
    or old.invalidated_at is not null
    or new.invalidated_at is null
    or new.invalidated_by_transition_id is null
    or new.invalidation_reason_code is null
  ) then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_route_immutable';
  end if;
  if tg_op = 'UPDATE' and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = new.tenant_id
       and transition_row.transition_id = new.invalidated_by_transition_id
       and transition_row.authority_id = new.parent_authority_id
       and transition_row.resulting_revision > old.parent_authority_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_route_invalidation_authority_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception using
      errcode = '55000',
      message = 'inbox_v2.source_registry_head_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.route_generation <> 1 then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_initial_head_invalid';
    end if;
    return new;
  end if;
  if new.tenant_id is distinct from old.tenant_id
     or new.authority_id is distinct from old.authority_id
     or new.authority_kind is distinct from old.authority_kind
     or new.source_connection_id is distinct from old.source_connection_id
     or new.source_account_id is distinct from old.source_account_id
     or new.connector_id is distinct from old.connector_id
     or new.session_id is distinct from old.session_id
     or new.auth_challenge_id is distinct from old.auth_challenge_id
     or new.created_by_actor_kind is distinct from old.created_by_actor_kind
     or new.created_by_employee_id is distinct from old.created_by_employee_id
     or new.created_by_trusted_service_id is distinct from old.created_by_trusted_service_id
     or new.created_at is distinct from old.created_at
     or new.revision <> old.revision + 1
     or new.route_generation < old.route_generation
     or new.updated_at < old.updated_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_head_cas_or_edge_invalid';
  end if;
  if not exists (
    select 1
      from public.inbox_v2_source_registry_transitions transition_row
     where transition_row.tenant_id = old.tenant_id
       and transition_row.transition_id = new.last_transition_id
       and transition_row.authority_id = old.authority_id
       and transition_row.expected_revision = old.revision
       and transition_row.expected_route_generation = old.route_generation
       and transition_row.from_state = old.state
       and transition_row.resulting_revision = new.revision
       and transition_row.route_generation = new.route_generation
  ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.source_registry_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_head_after_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.route_generation <> old.route_generation
     or new.route_authority_state = 'denied'
     or new.adapter_handler_id is distinct from old.adapter_handler_id then
    update public.inbox_v2_source_registry_ingress_routes route_row
       set invalidated_at = statement_timestamp(),
           invalidated_by_transition_id = new.last_transition_id,
           invalidation_reason_code = case
             when new.route_authority_state = 'denied' then 'authority_not_routable'
             when new.adapter_handler_id is distinct from old.adapter_handler_id then 'adapter_handler_replaced'
             else 'authority_revised'
           end
     where route_row.tenant_id = old.tenant_id
       and route_row.parent_authority_id = old.authority_id
       and route_row.invalidated_at is null
       and (
         route_row.route_generation <> new.route_generation
         or route_row.adapter_handler_id is distinct from new.adapter_handler_id
         or new.route_authority_state = 'denied'
       );
  end if;

  if new.revision <> old.revision then
    update public.inbox_v2_source_registry_secret_refs secret_row
       set revoked_at = statement_timestamp(),
           revoked_by_transition_id = new.last_transition_id
     where secret_row.tenant_id = old.tenant_id
       and secret_row.authority_id = old.authority_id
       and secret_row.revoked_at is null
       and secret_row.authority_revision < new.revision;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_source_registry_assert_transition()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  checked_tenant_id text;
  checked_authority_id text;
  checked_revision bigint;
  artifact_row record;
  secret_row record;
  route_row record;
  related_row record;
  registry_head record;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  checked_tenant_id := changed_row->>'tenant_id';
  checked_authority_id := coalesce(
    changed_row->>'parent_authority_id',
    changed_row->>'authority_id'
  );
  checked_revision := coalesce(
    (changed_row->>'revision')::bigint,
    (changed_row->>'resulting_revision')::bigint,
    (changed_row->>'parent_authority_revision')::bigint,
    (changed_row->>'authority_revision')::bigint
  );

  if not exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
      join public.inbox_v2_source_registry_transitions transition_row
        on transition_row.tenant_id = head_row.tenant_id
       and transition_row.transition_id = head_row.last_transition_id
       and transition_row.authority_id = head_row.authority_id
       and transition_row.resulting_revision = head_row.revision
       and transition_row.expected_revision = head_row.revision - 1
       and transition_row.authority_kind = head_row.authority_kind
       and transition_row.source_connection_id = head_row.source_connection_id
       and transition_row.source_account_id is not distinct from head_row.source_account_id
       and transition_row.connector_id is not distinct from head_row.connector_id
       and transition_row.session_id is not distinct from head_row.session_id
       and transition_row.auth_challenge_id is not distinct from head_row.auth_challenge_id
       and transition_row.to_state = head_row.state
       and transition_row.route_generation = head_row.route_generation
       and transition_row.route_authority_state = head_row.route_authority_state
       and transition_row.route_authority_reason_code_id = head_row.route_authority_reason_code_id
       and transition_row.route_authority_changed_at = head_row.route_authority_changed_at
       and transition_row.account_identity_transition_id is not distinct from head_row.account_identity_transition_id
       and transition_row.account_identity_revision is not distinct from head_row.account_identity_revision
       and transition_row.account_generation is not distinct from head_row.account_generation
       and transition_row.account_identity_state is not distinct from head_row.account_identity_state
       and transition_row.account_identity_fence_digest_sha256 is not distinct from head_row.account_identity_fence_digest_sha256
       and transition_row.account_canonical_key_digest_sha256 is not distinct from head_row.account_canonical_key_digest_sha256
       and transition_row.account_access_resource_head_id is not distinct from head_row.account_access_resource_head_id
       and transition_row.account_resource_access_revision is not distinct from head_row.account_resource_access_revision
       and transition_row.account_structural_relation_revision is not distinct from head_row.account_structural_relation_revision
       and transition_row.adapter_contract_id = head_row.adapter_contract_id
       and transition_row.adapter_contract_version = head_row.adapter_contract_version
       and transition_row.adapter_declaration_revision = head_row.adapter_declaration_revision
       and transition_row.adapter_surface_id = head_row.adapter_surface_id
       and transition_row.adapter_loaded_by_trusted_service_id = head_row.adapter_loaded_by_trusted_service_id
       and transition_row.adapter_loaded_at = head_row.adapter_loaded_at
       and transition_row.adapter_handler_id is not distinct from head_row.adapter_handler_id
       and transition_row.authority_copy_slot = head_row.authority_copy_slot
       and transition_row.authority_registry_id = head_row.authority_registry_id
       and transition_row.authority_registry_composition_hash = head_row.authority_registry_composition_hash
       and transition_row.authority_registry_revision = head_row.authority_registry_revision
       and transition_row.authority_data_class_id = head_row.authority_data_class_id
       and transition_row.authority_storage_root_id = head_row.authority_storage_root_id
       and transition_row.authority_purpose_id = head_row.authority_purpose_id
       and transition_row.authority_canonical_anchor_id = head_row.authority_canonical_anchor_id
       and transition_row.authority_lineage_revision = head_row.authority_lineage_revision
       and transition_row.authority_effective_policy_id = head_row.authority_effective_policy_id
       and transition_row.authority_effective_policy_version = head_row.authority_effective_policy_version
       and transition_row.authority_effective_rule_id = head_row.authority_effective_rule_id
       and transition_row.authority_effective_rule_revision = head_row.authority_effective_rule_revision
       and transition_row.authority_policy_activation_id = head_row.authority_policy_activation_id
       and transition_row.authority_policy_activation_revision = head_row.authority_policy_activation_revision
       and transition_row.authority_policy_activation_head_revision = head_row.authority_policy_activation_head_revision
       and transition_row.authority_legal_hold_set_revision = head_row.authority_legal_hold_set_revision
       and transition_row.authority_restriction_set_revision = head_row.authority_restriction_set_revision
       and transition_row.created_by_actor_kind = head_row.created_by_actor_kind
       and transition_row.created_by_employee_id is not distinct from head_row.created_by_employee_id
       and transition_row.created_by_trusted_service_id is not distinct from head_row.created_by_trusted_service_id
       and transition_row.created_by_authorization_epoch is not distinct from head_row.created_by_authorization_epoch
       and transition_row.authority_created_at = head_row.created_at
       and transition_row.occurred_at = head_row.updated_at
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_head_transition_mismatch';
  end if;

  select *
    into registry_head
    from public.inbox_v2_source_registry_heads head_row
   where head_row.tenant_id = checked_tenant_id
     and head_row.authority_id = checked_authority_id
     and head_row.revision = checked_revision;

  perform public.inbox_v2_assert_source_registry_lineage(
    registry_head.tenant_id,
    registry_head.authority_registry_id,
    registry_head.authority_registry_revision,
    registry_head.authority_registry_composition_hash,
    registry_head.authority_data_class_id,
    registry_head.authority_storage_root_id,
    registry_head.authority_purpose_id,
    registry_head.authority_canonical_anchor_id,
    registry_head.authority_lineage_revision,
    registry_head.authority_effective_policy_id,
    registry_head.authority_effective_policy_version,
    registry_head.authority_effective_rule_id,
    registry_head.authority_effective_rule_revision,
    registry_head.authority_policy_activation_id,
    registry_head.authority_policy_activation_revision,
    registry_head.authority_policy_activation_head_revision,
    registry_head.authority_legal_hold_set_revision,
    registry_head.authority_restriction_set_revision,
    registry_head.authority_kind in (
      'source_connection', 'source_account', 'channel_connector'
    )
  );

  if checked_revision > 1 and not exists (
    select 1
      from public.inbox_v2_source_registry_transitions current_transition
      join public.inbox_v2_source_registry_transitions predecessor
        on predecessor.tenant_id = current_transition.tenant_id
       and predecessor.authority_id = current_transition.authority_id
       and predecessor.resulting_revision = current_transition.expected_revision
       and predecessor.route_generation = current_transition.expected_route_generation
       and predecessor.to_state = current_transition.from_state
       and predecessor.authority_kind = current_transition.authority_kind
       and predecessor.source_connection_id = current_transition.source_connection_id
       and predecessor.source_account_id is not distinct from current_transition.source_account_id
       and predecessor.connector_id is not distinct from current_transition.connector_id
       and predecessor.session_id is not distinct from current_transition.session_id
       and predecessor.auth_challenge_id is not distinct from current_transition.auth_challenge_id
       and predecessor.occurred_at <= current_transition.occurred_at
     where current_transition.tenant_id = checked_tenant_id
       and current_transition.authority_id = checked_authority_id
       and current_transition.resulting_revision = checked_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_transition_predecessor_mismatch';
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
       and head_row.source_account_id is not null
       and not exists (
         select 1
           from public.inbox_v2_source_account_identity_transitions identity_transition
           join public.inbox_v2_source_account_identities identity_head
             on identity_head.tenant_id = identity_transition.tenant_id
            and identity_head.source_account_id = identity_transition.source_account_id
            and identity_head.revision = identity_transition.resulting_revision
            and identity_head.account_generation = identity_transition.resulting_account_generation
            and identity_head.state = identity_transition.to_state
          where identity_transition.tenant_id = head_row.tenant_id
            and identity_transition.id = head_row.account_identity_transition_id
            and identity_transition.source_account_id = head_row.source_account_id
            and identity_transition.resulting_revision = head_row.account_identity_revision
            and identity_transition.resulting_account_generation = head_row.account_generation
            and identity_transition.to_state = head_row.account_identity_state
            and (
              (head_row.account_identity_state = 'provisional'
                and head_row.account_identity_fence_digest_sha256 = identity_head.provisional_key_digest_sha256)
              or (head_row.account_identity_state = 'verified'
                and head_row.account_identity_fence_digest_sha256 = identity_head.canonical_key_digest_sha256
                and head_row.account_canonical_key_digest_sha256 = identity_head.canonical_key_digest_sha256)
              or (head_row.account_identity_state = 'conflicted'
                and head_row.account_identity_fence_digest_sha256 is not null)
            )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_identity_fence_stale';
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.authority_id = checked_authority_id
       and head_row.revision = checked_revision
       and head_row.source_account_id is not null
       and head_row.route_authority_state in ('enabled', 'inbound_only')
       and (
         head_row.account_identity_state <> 'verified'
         or not exists (
           select 1
             from public.inbox_v2_source_account_identities identity_head
            where identity_head.tenant_id = head_row.tenant_id
              and identity_head.source_account_id = head_row.source_account_id
              and identity_head.revision = head_row.account_identity_revision
              and identity_head.account_generation = head_row.account_generation
              and identity_head.state = head_row.account_identity_state
              and identity_head.canonical_key_digest_sha256 = head_row.account_canonical_key_digest_sha256
         )
         or not exists (
           select 1
             from public.inbox_v2_auth_resource_heads access_head
            where access_head.tenant_id = head_row.tenant_id
              and access_head.id = head_row.account_access_resource_head_id
              and access_head.resource_kind = 'source_account'
              and access_head.source_account_id = head_row.source_account_id
              and access_head.resource_access_revision = head_row.account_resource_access_revision
              and access_head.structural_relation_revision = head_row.account_structural_relation_revision
         )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_routable_account_fence_stale';
  end if;

  for artifact_row in
    select *
      from public.inbox_v2_source_registry_artifact_refs
     where tenant_id = checked_tenant_id
       and authority_id = checked_authority_id
       and authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      artifact_row.tenant_id,
      artifact_row.registry_id,
      artifact_row.registry_revision,
      artifact_row.registry_composition_hash,
      artifact_row.data_class_id,
      artifact_row.storage_root_id,
      artifact_row.purpose_id,
      artifact_row.canonical_anchor_id,
      artifact_row.lineage_revision,
      artifact_row.effective_policy_id,
      artifact_row.effective_policy_version,
      artifact_row.effective_rule_id,
      artifact_row.effective_rule_revision,
      artifact_row.policy_activation_id,
      artifact_row.policy_activation_revision,
      artifact_row.policy_activation_head_revision,
      artifact_row.legal_hold_set_revision,
      artifact_row.restriction_set_revision,
      artifact_row.artifact_kind <> 'diagnostic'
    );
  end loop;

  for secret_row in
    select *
      from public.inbox_v2_source_registry_secret_refs
     where tenant_id = checked_tenant_id
       and authority_id = checked_authority_id
       and authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      secret_row.tenant_id,
      secret_row.registry_id,
      secret_row.registry_revision,
      secret_row.registry_composition_hash,
      secret_row.data_class_id,
      secret_row.storage_root_id,
      secret_row.purpose_id,
      secret_row.canonical_anchor_id,
      secret_row.lineage_revision,
      secret_row.effective_policy_id,
      secret_row.effective_policy_version,
      secret_row.effective_rule_id,
      secret_row.effective_rule_revision,
      secret_row.policy_activation_id,
      secret_row.policy_activation_revision,
      secret_row.policy_activation_head_revision,
      secret_row.legal_hold_set_revision,
      secret_row.restriction_set_revision,
      false
    );
  end loop;

  for route_row in
    select *
     from public.inbox_v2_source_registry_ingress_routes
     where tenant_id = checked_tenant_id
       and parent_authority_id = checked_authority_id
       and parent_authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      route_row.tenant_id,
      route_row.registry_id,
      route_row.registry_revision,
      route_row.registry_composition_hash,
      route_row.data_class_id,
      route_row.storage_root_id,
      route_row.purpose_id,
      route_row.canonical_anchor_id,
      route_row.lineage_revision,
      route_row.effective_policy_id,
      route_row.effective_policy_version,
      route_row.effective_rule_id,
      route_row.effective_rule_revision,
      route_row.policy_activation_id,
      route_row.policy_activation_revision,
      route_row.policy_activation_head_revision,
      route_row.legal_hold_set_revision,
      route_row.restriction_set_revision,
      true
    );
    if route_row.adapter_handler_id is distinct from (
      select head_row.adapter_handler_id
        from public.inbox_v2_source_registry_heads head_row
       where head_row.tenant_id = checked_tenant_id
         and head_row.authority_id = checked_authority_id
         and head_row.revision = checked_revision
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_route_adapter_mismatch';
    end if;
  end loop;

  for related_row in
    select *
      from public.inbox_v2_source_registry_related_authority_refs
     where tenant_id = checked_tenant_id
       and parent_authority_id = checked_authority_id
       and parent_authority_revision = checked_revision
  loop
    perform public.inbox_v2_assert_source_registry_lineage(
      related_row.tenant_id,
      related_row.registry_id,
      related_row.registry_revision,
      related_row.registry_composition_hash,
      related_row.data_class_id,
      related_row.storage_root_id,
      related_row.purpose_id,
      related_row.canonical_anchor_id,
      related_row.lineage_revision,
      related_row.effective_policy_id,
      related_row.effective_policy_version,
      related_row.effective_rule_id,
      related_row.effective_rule_revision,
      related_row.policy_activation_id,
      related_row.policy_activation_revision,
      related_row.policy_activation_head_revision,
      related_row.legal_hold_set_revision,
      related_row.restriction_set_revision,
      related_row.kind in ('channel_connector', 'source_ingress_route')
    );

    if related_row.status = 'active' and (
      (related_row.kind = 'channel_connector' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_connector'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'channel_session' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = child_head.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = child_head.connector_id
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_session'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'channel_session_event' and not exists (
        select 1
          from public.channel_session_events event_row
          join public.inbox_v2_source_registry_heads session_head
            on session_head.tenant_id = event_row.tenant_id
           and session_head.authority_id = related_row.session_authority_id
           and session_head.authority_kind = 'channel_session'
           and session_head.session_id = event_row.session_id
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = event_row.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = event_row.connector_id
         where event_row.tenant_id = related_row.tenant_id
           and event_row.id = related_row.authority_id
           and session_head.source_connection_id = related_row.source_connection_id
           and connector_head.source_connection_id = related_row.source_connection_id
      ))
      or (related_row.kind = 'channel_auth_challenge' and not exists (
        select 1
          from public.inbox_v2_source_registry_heads child_head
          join public.inbox_v2_source_registry_heads connector_head
            on connector_head.tenant_id = child_head.tenant_id
           and connector_head.authority_id = related_row.connector_authority_id
           and connector_head.authority_kind = 'channel_connector'
           and connector_head.connector_id = child_head.connector_id
         where child_head.tenant_id = related_row.tenant_id
           and child_head.authority_id = related_row.authority_id
           and child_head.revision = related_row.authority_revision
           and child_head.authority_kind = 'channel_auth_challenge'
           and child_head.source_connection_id = related_row.source_connection_id
           and child_head.state not in ('replaced', 'deleted')
      ))
      or (related_row.kind = 'source_ingress_route' and not exists (
        select 1
          from public.inbox_v2_source_registry_ingress_routes route_check
         where route_check.tenant_id = related_row.tenant_id
           and route_check.route_id = related_row.authority_id
           and route_check.route_revision = related_row.authority_revision
           and route_check.parent_authority_id = related_row.parent_authority_id
           and route_check.route_generation = related_row.handler_generation
           and route_check.invalidated_at is null
      ))
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_registry_related_authority_stale';
    end if;
  end loop;
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_registry_account_fence_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  checked_tenant_id text;
  checked_source_account_id text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  checked_tenant_id := changed_row->>'tenant_id';
  checked_source_account_id := changed_row->>'source_account_id';

  if checked_source_account_id is null then
    return null;
  end if;

  if exists (
    select 1
      from public.inbox_v2_source_registry_heads head_row
     where head_row.tenant_id = checked_tenant_id
       and head_row.source_account_id = checked_source_account_id
       and head_row.route_authority_state in ('enabled', 'inbound_only')
       and (
         not exists (
           select 1
             from public.inbox_v2_source_account_identities identity_head
            where identity_head.tenant_id = head_row.tenant_id
              and identity_head.source_account_id = head_row.source_account_id
              and identity_head.revision = head_row.account_identity_revision
              and identity_head.account_generation = head_row.account_generation
              and identity_head.state = 'verified'
              and identity_head.canonical_key_digest_sha256 = head_row.account_canonical_key_digest_sha256
         )
         or not exists (
           select 1
             from public.inbox_v2_auth_resource_heads access_head
            where access_head.tenant_id = head_row.tenant_id
              and access_head.id = head_row.account_access_resource_head_id
              and access_head.resource_kind = 'source_account'
              and access_head.source_account_id = head_row.source_account_id
              and access_head.resource_access_revision = head_row.account_resource_access_revision
              and access_head.structural_relation_revision = head_row.account_structural_relation_revision
         )
       )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_routable_account_fence_stale';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_source_registry_child_head_deferred()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_registry_related_authority_refs related_row
      join public.inbox_v2_source_registry_heads parent_head
        on parent_head.tenant_id = related_row.tenant_id
       and parent_head.authority_id = related_row.parent_authority_id
       and parent_head.revision = related_row.parent_authority_revision
     where related_row.tenant_id = new.tenant_id
       and related_row.authority_id = new.authority_id
       and related_row.status = 'active'
       and related_row.kind in (
         'channel_connector', 'channel_session', 'channel_auth_challenge'
       )
       and related_row.authority_revision <> new.revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.source_registry_related_authority_stale';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_source_registry_transitions_guard_trigger
before update or delete on public.inbox_v2_source_registry_transitions
for each row execute function public.inbox_v2_source_registry_transition_guard();

create trigger inbox_v2_source_registry_artifact_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_artifact_refs
for each row execute function public.inbox_v2_source_registry_artifact_guard();

create trigger inbox_v2_source_registry_related_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_related_authority_refs
for each row execute function public.inbox_v2_source_registry_related_guard();

create trigger inbox_v2_source_registry_secret_refs_guard_trigger
before update or delete on public.inbox_v2_source_registry_secret_refs
for each row execute function public.inbox_v2_source_registry_secret_guard();

create trigger inbox_v2_source_registry_ingress_routes_guard_trigger
before update or delete on public.inbox_v2_source_registry_ingress_routes
for each row execute function public.inbox_v2_source_registry_route_guard();

create trigger inbox_v2_source_registry_heads_guard_trigger
before insert or update or delete on public.inbox_v2_source_registry_heads
for each row execute function public.inbox_v2_source_registry_head_guard();

create trigger inbox_v2_source_registry_heads_invalidation_trigger
after update on public.inbox_v2_source_registry_heads
for each row execute function public.inbox_v2_source_registry_head_after_update();

create constraint trigger inbox_v2_source_registry_heads_exact_trigger
after insert or update on public.inbox_v2_source_registry_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_transitions_exact_trigger
after insert on public.inbox_v2_source_registry_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_artifact_refs_exact_trigger
after insert on public.inbox_v2_source_registry_artifact_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_secret_refs_exact_trigger
after insert on public.inbox_v2_source_registry_secret_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_ingress_routes_exact_trigger
after insert on public.inbox_v2_source_registry_ingress_routes
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_related_refs_exact_trigger
after insert on public.inbox_v2_source_registry_related_authority_refs
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_assert_transition();

create constraint trigger inbox_v2_source_registry_identity_fence_trigger
after update on public.inbox_v2_source_account_identities
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_account_fence_deferred();

create constraint trigger inbox_v2_source_registry_access_fence_trigger
after update on public.inbox_v2_auth_resource_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_account_fence_deferred();

create constraint trigger inbox_v2_source_registry_child_head_trigger
after update on public.inbox_v2_source_registry_heads
deferrable initially deferred
for each row execute function public.inbox_v2_source_registry_child_head_deferred();
