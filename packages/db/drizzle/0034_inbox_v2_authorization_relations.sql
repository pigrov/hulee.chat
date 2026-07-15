-- INBOX_V2_AUTHORIZATION_RELATIONS_MIGRATION_FINALIZED_V1
-- INBOX_V2_AUTHORIZATION_RELATIONS_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'employees',
      'org_units',
      'teams',
      'work_queues',
      'clients',
      'source_accounts',
      'inbox_v2_conversations',
      'inbox_v2_work_items',
      'inbox_v2_work_item_sla_snapshots',
      'inbox_v2_work_item_creation_decisions',
      'inbox_v2_work_item_primary_assignments',
      'inbox_v2_work_item_servicing_team_episodes',
      'inbox_v2_participant_membership_transitions',
      'inbox_v2_work_item_transitions',
      'inbox_v2_work_item_relation_transitions',
      'inbox_v2_employee_conversation_states',
      'inbox_v2_data_governance_deletion_runs'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relations_foundation_missing',
      detail = 'Missing finalized 0033 anchor: ' || missing_anchor;
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
      select 'constraint:org_units_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.org_units'::regclass
            and conname = 'org_units_tenant_id_unique'
       )
      union all
      select 'constraint:teams_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.teams'::regclass
            and conname = 'teams_tenant_id_unique'
       )
      union all
      select 'constraint:work_queues_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.work_queues'::regclass
            and conname = 'work_queues_tenant_id_unique'
       )
      union all
      select 'constraint:clients_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.clients'::regclass
            and conname = 'clients_tenant_id_unique'
       )
      union all
      select 'constraint:source_accounts_tenant_id_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.source_accounts'::regclass
            and conname = 'source_accounts_tenant_id_unique'
       )
      union all
      select 'constraint:inbox_v2_conversations_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_conversations'::regclass
            and conname = 'inbox_v2_conversations_pk'
       )
      union all
      select 'constraint:inbox_v2_work_items_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_work_items'::regclass
            and conname = 'inbox_v2_work_items_pk'
       )
      union all
      select 'constraint:inbox_v2_participant_membership_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_participant_membership_transitions'::regclass
            and conname = 'inbox_v2_participant_membership_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_work_item_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_work_item_transitions'::regclass
            and conname = 'inbox_v2_work_item_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_work_item_relation_transitions_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_work_item_relation_transitions'::regclass
            and conname = 'inbox_v2_work_item_relation_transitions_pk'
       )
      union all
      select 'constraint:inbox_v2_dg_deletion_run_plan_anchor_unique'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid =
            'public.inbox_v2_data_governance_deletion_runs'::regclass
            and conname = 'inbox_v2_dg_deletion_run_plan_anchor_unique'
       )
      union all
      select 'trigger:inbox_v2_participant_membership_transitions_guard_insert_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_participant_membership_transitions'::regclass
            and tgname =
              'inbox_v2_participant_membership_transitions_guard_insert_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_work_item_transitions_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid = 'public.inbox_v2_work_item_transitions'::regclass
            and tgname = 'inbox_v2_work_item_transitions_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_work_item_relation_transitions_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_work_item_relation_transitions'::regclass
            and tgname = 'inbox_v2_work_item_relation_transitions_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_ecs_state_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_employee_conversation_states'::regclass
            and tgname = 'inbox_v2_ecs_state_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:inbox_v2_dg_deletion_run_transition_guard_trigger'
       where not exists (
         select 1 from pg_catalog.pg_trigger
          where tgrelid =
            'public.inbox_v2_data_governance_deletion_runs'::regclass
            and tgname =
              'inbox_v2_dg_deletion_run_transition_guard_trigger'
            and not tgisinternal
       )
      union all
      select 'trigger:' || expected_trigger.trigger_name
        from (values
          -- RBAC003_FOUNDATION_TRIGGERS_BEGIN
          (
            'inbox_v2_work_item_mutation_coherence_constraint',
            'inbox_v2_work_items',
            'inbox_v2_work_item_mutation_coherence',
            17
          ),
          (
            'inbox_v2_work_items_aggregate_constraint',
            'inbox_v2_work_items',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_sla_aggregate_constraint',
            'inbox_v2_work_item_sla_snapshots',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_creation_aggregate_constraint',
            'inbox_v2_work_item_creation_decisions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_assignment_aggregate_constraint',
            'inbox_v2_work_item_primary_assignments',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_transition_aggregate_constraint',
            'inbox_v2_work_item_transitions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          ),
          (
            'inbox_v2_work_team_episode_aggregate_constraint',
            'inbox_v2_work_item_servicing_team_episodes',
            'inbox_v2_work_item_aggregate_coherence',
            21
          ),
          (
            'inbox_v2_work_relation_transition_aggregate_constraint',
            'inbox_v2_work_item_relation_transitions',
            'inbox_v2_work_item_aggregate_coherence',
            5
          )
          -- RBAC003_FOUNDATION_TRIGGERS_END
        ) as expected_trigger(
          trigger_name,
          table_name,
          function_name,
          trigger_type
        )
        left join pg_catalog.pg_trigger trigger_definition
          on trigger_definition.tgrelid =
            ('public.' || expected_trigger.table_name)::regclass
          and trigger_definition.tgname = expected_trigger.trigger_name
        left join pg_catalog.pg_proc function_definition
          on function_definition.oid = trigger_definition.tgfoid
        left join pg_catalog.pg_namespace function_namespace
          on function_namespace.oid = function_definition.pronamespace
        left join pg_catalog.pg_constraint trigger_constraint
          on trigger_constraint.oid = trigger_definition.tgconstraint
       where trigger_definition.oid is null
          or trigger_definition.tgisinternal is distinct from false
          or trigger_definition.tgenabled is distinct from 'O'
          or trigger_definition.tgtype is distinct from
            expected_trigger.trigger_type::smallint
          or trigger_definition.tgdeferrable is distinct from true
          or trigger_definition.tginitdeferred is distinct from true
          or function_namespace.nspname is distinct from 'public'
          or function_definition.proname is distinct from
            expected_trigger.function_name
          or trigger_constraint.oid is null
          or trigger_constraint.contype is distinct from 't'
          or trigger_constraint.conrelid is distinct from
            ('public.' || expected_trigger.table_name)::regclass
          or trigger_constraint.condeferrable is distinct from true
          or trigger_constraint.condeferred is distinct from true
      union all
      select 'function:' || function_name
        from unnest(array[
          -- RBAC003_FOUNDATION_FUNCTIONS_BEGIN
          'inbox_v2_work_item_aggregate_coherence',
          'inbox_v2_work_item_mutation_coherence'
          -- RBAC003_FOUNDATION_FUNCTIONS_END
        ]::text[]) as required_function(function_name)
       where to_regprocedure('public.' || required_function.function_name ||
         '()') is null
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relations_foundation_missing',
      detail = 'Missing finalized foundation constraint or trigger: ' ||
        missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'table:' || table_name as object_name
        from unnest(array[
          -- RBAC003_PARTIAL_TABLES_BEGIN
          'inbox_v2_auth_tenant_heads',
          'inbox_v2_auth_employee_heads',
          'inbox_v2_auth_role_versions',
          'inbox_v2_auth_role_version_permissions',
          'inbox_v2_auth_role_heads',
          'inbox_v2_auth_role_binding_versions',
          'inbox_v2_auth_role_binding_heads',
          'inbox_v2_auth_direct_grant_versions',
          'inbox_v2_auth_direct_grant_heads',
          'inbox_v2_auth_workforce_membership_versions',
          'inbox_v2_auth_workforce_membership_heads',
          'inbox_v2_auth_resource_heads',
          'inbox_v2_auth_structural_access_versions',
          'inbox_v2_auth_structural_access_heads',
          'inbox_v2_auth_collaborator_versions',
          'inbox_v2_auth_collaborator_heads',
          'inbox_v2_auth_command_records',
          'inbox_v2_tenant_stream_heads',
          'inbox_v2_tenant_stream_commits',
          'inbox_v2_tenant_stream_changes',
          'inbox_v2_domain_events',
          'inbox_v2_outbox_intents',
          'inbox_v2_auth_audit_events',
          'inbox_v2_auth_audit_facets',
          'inbox_v2_auth_mutation_commits',
          'inbox_v2_auth_revision_effects',
          'inbox_v2_auth_relation_writes'
          -- RBAC003_PARTIAL_TABLES_END
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          -- RBAC003_PARTIAL_TYPES_BEGIN
          'inbox_v2_auth_actor_kind',
          'inbox_v2_auth_record_state',
          'inbox_v2_auth_binding_subject_kind',
          'inbox_v2_auth_scope_kind',
          'inbox_v2_auth_org_unit_mode',
          'inbox_v2_auth_workforce_membership_kind',
          'inbox_v2_auth_structural_resource_kind',
          'inbox_v2_auth_structural_target_kind',
          'inbox_v2_auth_collaborator_resource_kind',
          'inbox_v2_auth_command_state',
          'inbox_v2_audience_impact_kind',
          'inbox_v2_tenant_stream_audience',
          'inbox_v2_domain_event_access_effect',
          'inbox_v2_outbox_intent_effect_class',
          'inbox_v2_auth_audit_facet_kind',
          'inbox_v2_auth_revision_effect_kind',
          'inbox_v2_auth_relation_kind'
          -- RBAC003_PARTIAL_TYPES_END
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
      select 'function:' || function_name
        from unnest(array[
          -- RBAC003_PARTIAL_FUNCTIONS_BEGIN
          'inbox_v2_auth_reject_immutable',
          'inbox_v2_auth_json_tenant_safe',
          'inbox_v2_auth_catalog_id_safe',
          'inbox_v2_auth_payload_reference_safe',
          'inbox_v2_auth_invalidations_safe',
          'inbox_v2_auth_decision_refs_safe',
          'inbox_v2_auth_audit_identifier_guard',
          'inbox_v2_auth_relation_version_guard',
          'inbox_v2_auth_head_guard',
          'inbox_v2_auth_command_guard',
          'inbox_v2_auth_stream_head_guard',
          'inbox_v2_auth_role_permission_coherence',
          'inbox_v2_auth_head_commit_coherence',
          'inbox_v2_auth_relation_version_commit_coherence',
          'inbox_v2_auth_command_commit_coherence',
          'inbox_v2_auth_mutation_coherence',
          'inbox_v2_auth_mutation_child_coherence'
          -- RBAC003_PARTIAL_FUNCTIONS_END
        ]::text[]) as expected_function(function_name)
       where exists (
         select 1
           from pg_catalog.pg_proc function_definition
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = function_definition.pronamespace
          where function_namespace.nspname = 'public'
            and function_definition.proname = expected_function.function_name
       )
      union all
      select 'trigger:' || trigger_name
        from unnest(array[
          -- RBAC003_PARTIAL_TRIGGERS_BEGIN
          'inbox_v2_auth_role_version_insert_guard',
          'inbox_v2_auth_binding_version_insert_guard',
          'inbox_v2_auth_grant_version_insert_guard',
          'inbox_v2_auth_workforce_version_insert_guard',
          'inbox_v2_auth_structural_version_insert_guard',
          'inbox_v2_auth_collaborator_version_insert_guard',
          'inbox_v2_auth_role_version_commit_coherence',
          'inbox_v2_auth_binding_version_commit_coherence',
          'inbox_v2_auth_grant_version_commit_coherence',
          'inbox_v2_auth_workforce_version_commit_coherence',
          'inbox_v2_auth_structural_version_commit_coherence',
          'inbox_v2_auth_collaborator_version_commit_coherence',
          'inbox_v2_auth_tenant_head_guard',
          'inbox_v2_auth_employee_head_guard',
          'inbox_v2_auth_role_head_guard',
          'inbox_v2_auth_binding_head_guard',
          'inbox_v2_auth_grant_head_guard',
          'inbox_v2_auth_workforce_head_guard',
          'inbox_v2_auth_resource_head_guard',
          'inbox_v2_auth_structural_head_guard',
          'inbox_v2_auth_collaborator_head_guard',
          'inbox_v2_auth_tenant_head_commit_coherence',
          'inbox_v2_auth_employee_head_commit_coherence',
          'inbox_v2_auth_role_head_commit_coherence',
          'inbox_v2_auth_binding_head_commit_coherence',
          'inbox_v2_auth_grant_head_commit_coherence',
          'inbox_v2_auth_workforce_head_commit_coherence',
          'inbox_v2_auth_resource_head_commit_coherence',
          'inbox_v2_auth_structural_head_commit_coherence',
          'inbox_v2_auth_collaborator_head_commit_coherence',
          'inbox_v2_auth_command_guard_trigger',
          'inbox_v2_auth_command_commit_coherence',
          'inbox_v2_auth_audit_identifier_guard_trigger',
          'inbox_v2_tenant_stream_head_guard_trigger',
          'inbox_v2_auth_role_version_permissions_coherence',
          'inbox_v2_auth_role_permission_rows_coherence',
          'inbox_v2_auth_mutation_commit_coherence',
          'inbox_v2_auth_change_mutation_child_coherence',
          'inbox_v2_auth_event_mutation_child_coherence',
          'inbox_v2_auth_outbox_mutation_child_coherence',
          'inbox_v2_auth_facet_mutation_child_coherence',
          'inbox_v2_auth_effect_mutation_child_coherence',
          'inbox_v2_auth_relation_mutation_child_coherence',
          'inbox_v2_auth_immutable_f294fc074aec07c5',
          'inbox_v2_auth_immutable_8d3bca723658bf87',
          'inbox_v2_auth_immutable_60a4e6a91d5c5fe3',
          'inbox_v2_auth_immutable_0fd1b83dc9a02dd4',
          'inbox_v2_auth_immutable_7b4299c7591433c9',
          'inbox_v2_auth_immutable_09a11878babcde81',
          'inbox_v2_auth_immutable_4a50da517e54c1bb',
          'inbox_v2_auth_immutable_552c1165f5ed8785',
          'inbox_v2_auth_immutable_dbcc9ea93cbd94ba',
          'inbox_v2_auth_immutable_017a2961147225fb',
          'inbox_v2_auth_immutable_8af9c3f10f095491',
          'inbox_v2_auth_immutable_a724ad2579ac19a8',
          'inbox_v2_auth_immutable_b7060d104e2cd2ac',
          'inbox_v2_auth_immutable_ef02df9ab538c8e3',
          'inbox_v2_auth_immutable_ff0a2efcdb94dda8',
          'inbox_v2_auth_immutable_d4633dd6133275ae'
          -- RBAC003_PARTIAL_TRIGGERS_END
        ]::text[]) as expected_trigger(trigger_name)
       where exists (
         select 1
           from pg_catalog.pg_trigger trigger_definition
          where trigger_definition.tgname = expected_trigger.trigger_name
            and not trigger_definition.tgisinternal
       )
    ) partial_objects
   order by object_name
   limit 1;

  if partial_object is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relations_partial_schema_detected',
      detail = 'Unexpected pre-existing RBAC-003 object: ' || partial_object;
  end if;
end;
$preflight$;
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_audience_impact_kind" AS ENUM('none', 'direct', 'structural', 'tenant_rbac');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_actor_kind" AS ENUM('employee', 'trusted_service');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_audit_facet_kind" AS ENUM('source', 'destination', 'affected');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_collaborator_resource_kind" AS ENUM('conversation', 'work_item');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_command_state" AS ENUM('pending', 'completed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_org_unit_mode" AS ENUM('exact', 'subtree');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_record_state" AS ENUM('active', 'revoked', 'archived');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_relation_kind" AS ENUM('role', 'role_binding', 'direct_grant', 'workforce_membership', 'structural_access', 'conversation_collaborator', 'work_item_collaborator', 'internal_membership', 'primary_responsibility', 'servicing_team', 'client_owner');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_revision_effect_kind" AS ENUM('tenant_rbac', 'shared_access', 'employee_access', 'employee_inbox_relation', 'resource_access', 'collaborator_set');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_binding_subject_kind" AS ENUM('employee', 'team', 'org_unit', 'queue');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_scope_kind" AS ENUM('tenant', 'org_unit', 'team', 'queue', 'client', 'conversation', 'work_item', 'source_account', 'responsible', 'collaborator', 'internal_participant', 'client_owner');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_structural_resource_kind" AS ENUM('conversation', 'client', 'source_account');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_structural_target_kind" AS ENUM('org_unit', 'team');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_auth_workforce_membership_kind" AS ENUM('org_unit', 'team', 'queue');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_domain_event_access_effect" AS ENUM('none', 'may_change_access');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_outbox_intent_effect_class" AS ENUM('projection', 'notification', 'provider_io', 'search', 'workflow');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_tenant_stream_audience" AS ENUM('conversation_external', 'internal_participants', 'staff_only', 'workforce_metadata', 'policy_filtered');
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_audit_events" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"command_record_id" text NOT NULL,
	"category" text NOT NULL,
	"action_id" text NOT NULL,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"target_type_id" text NOT NULL,
	"internal_target_ref" text NOT NULL,
	"facet_count" smallint NOT NULL,
	"facets_digest_sha256" text NOT NULL,
	"authorization_decision_refs" jsonb NOT NULL,
	"authorization_epoch" text NOT NULL,
	"revision_delta_hash" text NOT NULL,
	"reason_code_id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"command_type_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"correlation_id" text NOT NULL,
	"matched_permission_ids" text[] NOT NULL,
	"grant_source_ids" text[] NOT NULL,
	"scope_ids" text[] NOT NULL,
	"override_reason_id" text,
	"policy_version" text,
	"evidence_reference" jsonb,
	"outcome" text NOT NULL,
	"previous_audit_hash" text,
	"audit_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_audit_events_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_auth_audit_events_mutation_unique" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "inbox_v2_auth_audit_events_id_mutation_unique" UNIQUE("tenant_id","id","mutation_id"),
	CONSTRAINT "inbox_v2_auth_audit_events_hash_unique" UNIQUE("tenant_id","audit_hash"),
	CONSTRAINT "inbox_v2_auth_audit_events_actor_check" CHECK ((
      "inbox_v2_auth_audit_events"."actor_kind" = 'employee'
      and "inbox_v2_auth_audit_events"."actor_employee_id" is not null
      and "inbox_v2_auth_audit_events"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_audit_events"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_audit_events"."actor_employee_id" is null
      and "inbox_v2_auth_audit_events"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_audit_events"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_audit_events_reference_check" CHECK ("inbox_v2_auth_audit_events"."category" = 'privileged_security'
        and char_length("inbox_v2_auth_audit_events"."action_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."action_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."action_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."action_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."action_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."action_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."action_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_audit_events"."target_type_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."target_type_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."target_type_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."target_type_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."target_type_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."target_type_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."target_type_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_auth_audit_events"."internal_target_ref" ~ '^internal-ref:[a-f0-9]{32,64}$'
        and "inbox_v2_auth_audit_events"."facet_count" between 1 and 64
        and "inbox_v2_auth_audit_events"."facets_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and jsonb_typeof("inbox_v2_auth_audit_events"."authorization_decision_refs") = 'array'
        and jsonb_array_length("inbox_v2_auth_audit_events"."authorization_decision_refs") between 1 and 64
        and char_length("inbox_v2_auth_audit_events"."authorization_epoch") between 8 and 1024
        and "inbox_v2_auth_audit_events"."revision_delta_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_auth_audit_events"."reason_code_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."reason_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."reason_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."reason_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."reason_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."reason_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."reason_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_audit_events"."client_mutation_id") between 1 and 256
        and char_length("inbox_v2_auth_audit_events"."command_type_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."command_type_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."command_type_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."command_type_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."command_type_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."command_type_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."command_type_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_auth_audit_events"."request_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_auth_audit_events"."correlation_id") between 1 and 256
        and cardinality("inbox_v2_auth_audit_events"."matched_permission_ids") between 1 and 256
        and array_position("inbox_v2_auth_audit_events"."matched_permission_ids", null) is null
        and cardinality("inbox_v2_auth_audit_events"."grant_source_ids") between 1 and 256
        and array_position("inbox_v2_auth_audit_events"."grant_source_ids", null) is null
        and cardinality("inbox_v2_auth_audit_events"."scope_ids") between 1 and 256
        and array_position("inbox_v2_auth_audit_events"."scope_ids", null) is null
        and ("inbox_v2_auth_audit_events"."override_reason_id" is null
          or char_length("inbox_v2_auth_audit_events"."override_reason_id") <= 256 and (
    (
      "inbox_v2_auth_audit_events"."override_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."override_reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_audit_events"."override_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_audit_events"."override_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_audit_events"."override_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_audit_events"."override_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and ("inbox_v2_auth_audit_events"."policy_version" is null
          or (char_length("inbox_v2_auth_audit_events"."policy_version") between 2 and 128
            and "inbox_v2_auth_audit_events"."policy_version" ~ '^v[1-9][0-9]*$'))
        and ("inbox_v2_auth_audit_events"."evidence_reference" is null or (
          jsonb_typeof("inbox_v2_auth_audit_events"."evidence_reference") = 'object'
          and "inbox_v2_auth_audit_events"."evidence_reference" ?&
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]
          and ("inbox_v2_auth_audit_events"."evidence_reference" -
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =
              '{}'::jsonb
          and "inbox_v2_auth_audit_events"."evidence_reference"->>'tenantId' = "inbox_v2_auth_audit_events"."tenant_id"
          and "inbox_v2_auth_audit_events"."evidence_reference"->>'digest' ~ '^sha256:[0-9a-f]{64}$'
        ))
        and "inbox_v2_auth_audit_events"."outcome" = 'succeeded'
        and ("inbox_v2_auth_audit_events"."previous_audit_hash" is null
          or "inbox_v2_auth_audit_events"."previous_audit_hash" ~ '^sha256:[0-9a-f]{64}$')
        and "inbox_v2_auth_audit_events"."audit_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_auth_audit_events_times_check" CHECK (isfinite("inbox_v2_auth_audit_events"."occurred_at")
        and isfinite("inbox_v2_auth_audit_events"."recorded_at")
        and isfinite("inbox_v2_auth_audit_events"."expires_at")
        and "inbox_v2_auth_audit_events"."recorded_at" >= "inbox_v2_auth_audit_events"."occurred_at"
        and "inbox_v2_auth_audit_events"."expires_at" > "inbox_v2_auth_audit_events"."recorded_at"
        and "inbox_v2_auth_audit_events"."created_at" = "inbox_v2_auth_audit_events"."recorded_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_audit_facets" (
	"tenant_id" text NOT NULL,
	"audit_event_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"dimension" text NOT NULL,
	"facet_kind" "inbox_v2_auth_audit_facet_kind" NOT NULL,
	"entity_type_id" text NOT NULL,
	"internal_entity_ref" text NOT NULL,
	"facet_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_audit_facets_pk" PRIMARY KEY("tenant_id","audit_event_id","ordinal"),
	CONSTRAINT "inbox_v2_auth_audit_facets_value_unique" UNIQUE("tenant_id","audit_event_id","dimension","entity_type_id","internal_entity_ref","facet_kind"),
	CONSTRAINT "inbox_v2_auth_audit_facets_values_check" CHECK ("inbox_v2_auth_audit_facets"."ordinal" between 1 and 64
        and "inbox_v2_auth_audit_facets"."dimension" in ('tenant', 'org_unit', 'team', 'queue', 'resource')
        and case "inbox_v2_auth_audit_facets"."dimension"
          when 'tenant' then "inbox_v2_auth_audit_facets"."entity_type_id" = 'core:tenant'
          when 'org_unit' then "inbox_v2_auth_audit_facets"."entity_type_id" = 'core:org-unit'
          when 'team' then "inbox_v2_auth_audit_facets"."entity_type_id" = 'core:team'
          when 'queue' then "inbox_v2_auth_audit_facets"."entity_type_id" = 'core:work-queue'
          when 'resource' then "inbox_v2_auth_audit_facets"."entity_type_id" in (
            'core:conversation', 'core:client', 'core:work-item',
            'core:source-account'
          )
          else false
        end
        and "inbox_v2_auth_audit_facets"."entity_type_id" ~ '^core:[A-Za-z0-9][A-Za-z0-9._~:-]{0,250}$'
        and "inbox_v2_auth_audit_facets"."internal_entity_ref" ~ '^internal-ref:[a-f0-9]{32,64}$'
        and "inbox_v2_auth_audit_facets"."facet_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_audit_facets"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_collaborator_heads" (
	"tenant_id" text NOT NULL,
	"collaborator_id" text NOT NULL,
	"resource_kind" "inbox_v2_auth_collaborator_resource_kind" NOT NULL,
	"conversation_id" text,
	"work_item_id" text,
	"work_item_cycle" bigint,
	"employee_id" text NOT NULL,
	"current_state" "inbox_v2_auth_record_state" NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_collaborator_heads_pk" PRIMARY KEY("tenant_id","collaborator_id"),
	CONSTRAINT "inbox_v2_auth_collaborator_heads_resource_check" CHECK (case "inbox_v2_auth_collaborator_heads"."resource_kind"
    when 'conversation' then "inbox_v2_auth_collaborator_heads"."conversation_id" is not null
      and "inbox_v2_auth_collaborator_heads"."work_item_id" is null and "inbox_v2_auth_collaborator_heads"."work_item_cycle" is null
    when 'work_item' then "inbox_v2_auth_collaborator_heads"."work_item_id" is not null
      and "inbox_v2_auth_collaborator_heads"."work_item_cycle" is not null
      and "inbox_v2_auth_collaborator_heads"."work_item_cycle" >= 0
      and "inbox_v2_auth_collaborator_heads"."conversation_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_collaborator_heads_values_check" CHECK ("inbox_v2_auth_collaborator_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_collaborator_heads_times_check" CHECK (isfinite("inbox_v2_auth_collaborator_heads"."created_at")
    and isfinite("inbox_v2_auth_collaborator_heads"."updated_at")
    and "inbox_v2_auth_collaborator_heads"."updated_at" >= "inbox_v2_auth_collaborator_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_collaborator_versions" (
	"tenant_id" text NOT NULL,
	"collaborator_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"resource_kind" "inbox_v2_auth_collaborator_resource_kind" NOT NULL,
	"conversation_id" text,
	"work_item_id" text,
	"work_item_cycle" bigint,
	"employee_id" text NOT NULL,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_collaborator_versions_pk" PRIMARY KEY("tenant_id","collaborator_id","revision"),
	CONSTRAINT "inbox_v2_auth_collaborator_versions_mutation_unique" UNIQUE("tenant_id","collaborator_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_collaborator_versions_resource_check" CHECK (case "inbox_v2_auth_collaborator_versions"."resource_kind"
    when 'conversation' then "inbox_v2_auth_collaborator_versions"."conversation_id" is not null
      and "inbox_v2_auth_collaborator_versions"."work_item_id" is null and "inbox_v2_auth_collaborator_versions"."work_item_cycle" is null
    when 'work_item' then "inbox_v2_auth_collaborator_versions"."work_item_id" is not null
      and "inbox_v2_auth_collaborator_versions"."work_item_cycle" is not null
      and "inbox_v2_auth_collaborator_versions"."work_item_cycle" >= 0
      and "inbox_v2_auth_collaborator_versions"."conversation_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_collaborator_versions_state_check" CHECK (isfinite("inbox_v2_auth_collaborator_versions"."valid_from")
    and ("inbox_v2_auth_collaborator_versions"."valid_until" is null or (
      isfinite("inbox_v2_auth_collaborator_versions"."valid_until") and "inbox_v2_auth_collaborator_versions"."valid_until" > "inbox_v2_auth_collaborator_versions"."valid_from"
    ))
    and (("inbox_v2_auth_collaborator_versions"."state" = 'active'
        and "inbox_v2_auth_collaborator_versions"."revoked_at" is null
        and "inbox_v2_auth_collaborator_versions"."occurred_at" <= "inbox_v2_auth_collaborator_versions"."valid_from")
      or ("inbox_v2_auth_collaborator_versions"."state" = 'revoked'
        and "inbox_v2_auth_collaborator_versions"."revoked_at" is not null
        and isfinite("inbox_v2_auth_collaborator_versions"."revoked_at")
        and "inbox_v2_auth_collaborator_versions"."revoked_at" > "inbox_v2_auth_collaborator_versions"."valid_from"
        and ("inbox_v2_auth_collaborator_versions"."valid_until" is null or "inbox_v2_auth_collaborator_versions"."revoked_at" <= "inbox_v2_auth_collaborator_versions"."valid_until")
        and "inbox_v2_auth_collaborator_versions"."occurred_at" = "inbox_v2_auth_collaborator_versions"."revoked_at")
      or ("inbox_v2_auth_collaborator_versions"."state" = 'archived'
        and "inbox_v2_auth_collaborator_versions"."revoked_at" is null
        and "inbox_v2_auth_collaborator_versions"."valid_until" is not null
        and "inbox_v2_auth_collaborator_versions"."occurred_at" >= "inbox_v2_auth_collaborator_versions"."valid_until"))),
	CONSTRAINT "inbox_v2_auth_collaborator_versions_actor_check" CHECK ((
      "inbox_v2_auth_collaborator_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_collaborator_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_collaborator_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_collaborator_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_collaborator_versions"."actor_employee_id" is null
      and "inbox_v2_auth_collaborator_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_collaborator_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_collaborator_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_collaborator_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_collaborator_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_collaborator_versions_values_check" CHECK ("inbox_v2_auth_collaborator_versions"."revision" >= 1
        and char_length("inbox_v2_auth_collaborator_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_collaborator_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_collaborator_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_collaborator_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_collaborator_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_collaborator_versions"."mutation_id") between 1 and 256
        and "inbox_v2_auth_collaborator_versions"."record_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_collaborator_versions"."occurred_at")
        and "inbox_v2_auth_collaborator_versions"."created_at" = "inbox_v2_auth_collaborator_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_command_records" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"command_type_id" text NOT NULL,
	"first_request_id" text NOT NULL,
	"request_hash" text NOT NULL,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"principal_scope_key" text GENERATED ALWAYS AS (case actor_kind
          when 'employee' then
            'employee|' || octet_length(actor_employee_id)::text || ':' ||
              actor_employee_id
          when 'trusted_service' then
            'trusted_service|' ||
              octet_length(actor_trusted_service_id)::text || ':' ||
              actor_trusted_service_id
          else null
        end) STORED NOT NULL,
	"authorization_decision_id" text NOT NULL,
	"authorization_epoch" text NOT NULL,
	"authorization_decision_refs" jsonb NOT NULL,
	"authorized_at" timestamp (3) with time zone NOT NULL,
	"authorization_not_after" timestamp (3) with time zone NOT NULL,
	"state" "inbox_v2_auth_command_state" NOT NULL,
	"mutation_id" text,
	"public_result_code" text NOT NULL,
	"sensitive_result_reference" text,
	"revision" bigint NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_command_records_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_auth_command_records_mutation_unique" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "inbox_v2_auth_command_records_id_mutation_unique" UNIQUE("tenant_id","id","mutation_id"),
	CONSTRAINT "inbox_v2_auth_command_records_actor_check" CHECK ((
      "inbox_v2_auth_command_records"."actor_kind" = 'employee'
      and "inbox_v2_auth_command_records"."actor_employee_id" is not null
      and "inbox_v2_auth_command_records"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_command_records"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_command_records"."actor_employee_id" is null
      and "inbox_v2_auth_command_records"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_command_records"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_command_records"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_command_records"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_command_records"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_command_records"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_command_records_state_check" CHECK (("inbox_v2_auth_command_records"."state" = 'completed'
          and "inbox_v2_auth_command_records"."mutation_id" is not null)
        or ("inbox_v2_auth_command_records"."state" = 'pending'
          and "inbox_v2_auth_command_records"."mutation_id" is null
          and "inbox_v2_auth_command_records"."sensitive_result_reference" is null)),
	CONSTRAINT "inbox_v2_auth_command_records_values_check" CHECK (char_length("inbox_v2_auth_command_records"."client_mutation_id") between 1 and 256
        and char_length("inbox_v2_auth_command_records"."command_type_id") <= 256 and (
    (
      "inbox_v2_auth_command_records"."command_type_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."command_type_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_command_records"."command_type_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."command_type_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_command_records"."command_type_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_command_records"."command_type_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_command_records"."first_request_id") between 1 and 512
        and "inbox_v2_auth_command_records"."first_request_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_auth_command_records"."request_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_auth_command_records"."authorization_decision_id") between 1 and 256
        and char_length("inbox_v2_auth_command_records"."authorization_epoch") between 8 and 1024
        and jsonb_typeof("inbox_v2_auth_command_records"."authorization_decision_refs") = 'array'
        and jsonb_array_length("inbox_v2_auth_command_records"."authorization_decision_refs") between 1 and 64
        and isfinite("inbox_v2_auth_command_records"."authorized_at")
        and isfinite("inbox_v2_auth_command_records"."authorization_not_after")
        and "inbox_v2_auth_command_records"."authorization_not_after" > "inbox_v2_auth_command_records"."authorized_at"
        and char_length("inbox_v2_auth_command_records"."public_result_code") <= 256 and (
    (
      "inbox_v2_auth_command_records"."public_result_code" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."public_result_code", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_command_records"."public_result_code" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_command_records"."public_result_code", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_command_records"."public_result_code", ':', 3)) <= 160
      and split_part("inbox_v2_auth_command_records"."public_result_code", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and ("inbox_v2_auth_command_records"."sensitive_result_reference" is null
          or "inbox_v2_auth_command_records"."sensitive_result_reference" ~
            '^internal-ref:[a-f0-9]{32,64}$')
        and "inbox_v2_auth_command_records"."revision" >= 1
        and isfinite("inbox_v2_auth_command_records"."occurred_at")
        and "inbox_v2_auth_command_records"."created_at" = "inbox_v2_auth_command_records"."occurred_at"
        and isfinite("inbox_v2_auth_command_records"."updated_at")
        and "inbox_v2_auth_command_records"."updated_at" >= "inbox_v2_auth_command_records"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_direct_grant_heads" (
	"tenant_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_direct_grant_heads_pk" PRIMARY KEY("tenant_id","grant_id"),
	CONSTRAINT "inbox_v2_auth_direct_grant_heads_revision_check" CHECK ("inbox_v2_auth_direct_grant_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_direct_grant_heads_times_check" CHECK (isfinite("inbox_v2_auth_direct_grant_heads"."created_at")
    and isfinite("inbox_v2_auth_direct_grant_heads"."updated_at")
    and "inbox_v2_auth_direct_grant_heads"."updated_at" >= "inbox_v2_auth_direct_grant_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_direct_grant_versions" (
	"tenant_id" text NOT NULL,
	"grant_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"employee_id" text NOT NULL,
	"permission_id" text NOT NULL,
	"catalog_schema_id" text NOT NULL,
	"catalog_version" text NOT NULL,
	"catalog_digest_sha256" text NOT NULL,
	"scope_kind" "inbox_v2_auth_scope_kind" NOT NULL,
	"scope_org_unit_mode" "inbox_v2_auth_org_unit_mode",
	"scope_org_unit_id" text,
	"scope_team_id" text,
	"scope_work_queue_id" text,
	"scope_client_id" text,
	"scope_conversation_id" text,
	"scope_work_item_id" text,
	"scope_source_account_id" text,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_direct_grant_versions_pk" PRIMARY KEY("tenant_id","grant_id","revision"),
	CONSTRAINT "inbox_v2_auth_direct_grant_versions_mutation_unique" UNIQUE("tenant_id","grant_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_direct_grant_scope_check" CHECK (case "inbox_v2_auth_direct_grant_versions"."scope_kind"
    when 'tenant' then num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode",
      "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id", "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
      "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
      "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'org_unit' then "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id" is not null
      and "inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
        "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
        "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'team' then "inbox_v2_auth_direct_grant_versions"."scope_team_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id", "inbox_v2_auth_direct_grant_versions"."scope_client_id",
        "inbox_v2_auth_direct_grant_versions"."scope_conversation_id", "inbox_v2_auth_direct_grant_versions"."scope_work_item_id",
        "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'queue' then "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_client_id",
        "inbox_v2_auth_direct_grant_versions"."scope_conversation_id", "inbox_v2_auth_direct_grant_versions"."scope_work_item_id",
        "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'client' then "inbox_v2_auth_direct_grant_versions"."scope_client_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
        "inbox_v2_auth_direct_grant_versions"."scope_conversation_id", "inbox_v2_auth_direct_grant_versions"."scope_work_item_id",
        "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'conversation' then "inbox_v2_auth_direct_grant_versions"."scope_conversation_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id", "inbox_v2_auth_direct_grant_versions"."scope_client_id",
        "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'work_item' then "inbox_v2_auth_direct_grant_versions"."scope_work_item_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id", "inbox_v2_auth_direct_grant_versions"."scope_client_id",
        "inbox_v2_auth_direct_grant_versions"."scope_conversation_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'source_account' then "inbox_v2_auth_direct_grant_versions"."scope_source_account_id" is not null
      and num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode", "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id",
        "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id", "inbox_v2_auth_direct_grant_versions"."scope_client_id",
        "inbox_v2_auth_direct_grant_versions"."scope_conversation_id", "inbox_v2_auth_direct_grant_versions"."scope_work_item_id") = 0
    when 'responsible' then num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode",
      "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id", "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
      "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
      "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'collaborator' then num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode",
      "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id", "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
      "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
      "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'internal_participant' then num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode",
      "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id", "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
      "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
      "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    when 'client_owner' then num_nonnulls("inbox_v2_auth_direct_grant_versions"."scope_org_unit_mode",
      "inbox_v2_auth_direct_grant_versions"."scope_org_unit_id", "inbox_v2_auth_direct_grant_versions"."scope_team_id", "inbox_v2_auth_direct_grant_versions"."scope_work_queue_id",
      "inbox_v2_auth_direct_grant_versions"."scope_client_id", "inbox_v2_auth_direct_grant_versions"."scope_conversation_id",
      "inbox_v2_auth_direct_grant_versions"."scope_work_item_id", "inbox_v2_auth_direct_grant_versions"."scope_source_account_id") = 0
    else false
  end),
	CONSTRAINT "inbox_v2_auth_direct_grant_state_check" CHECK (isfinite("inbox_v2_auth_direct_grant_versions"."valid_from")
    and ("inbox_v2_auth_direct_grant_versions"."valid_until" is null or (
      isfinite("inbox_v2_auth_direct_grant_versions"."valid_until") and "inbox_v2_auth_direct_grant_versions"."valid_until" > "inbox_v2_auth_direct_grant_versions"."valid_from"
    ))
    and (("inbox_v2_auth_direct_grant_versions"."state" = 'active'
        and "inbox_v2_auth_direct_grant_versions"."revoked_at" is null
        and "inbox_v2_auth_direct_grant_versions"."occurred_at" <= "inbox_v2_auth_direct_grant_versions"."valid_from")
      or ("inbox_v2_auth_direct_grant_versions"."state" = 'revoked'
        and "inbox_v2_auth_direct_grant_versions"."revoked_at" is not null
        and isfinite("inbox_v2_auth_direct_grant_versions"."revoked_at")
        and "inbox_v2_auth_direct_grant_versions"."revoked_at" > "inbox_v2_auth_direct_grant_versions"."valid_from"
        and ("inbox_v2_auth_direct_grant_versions"."valid_until" is null or "inbox_v2_auth_direct_grant_versions"."revoked_at" <= "inbox_v2_auth_direct_grant_versions"."valid_until")
        and "inbox_v2_auth_direct_grant_versions"."occurred_at" = "inbox_v2_auth_direct_grant_versions"."revoked_at")
      or ("inbox_v2_auth_direct_grant_versions"."state" = 'archived'
        and "inbox_v2_auth_direct_grant_versions"."revoked_at" is null
        and "inbox_v2_auth_direct_grant_versions"."valid_until" is not null
        and "inbox_v2_auth_direct_grant_versions"."occurred_at" >= "inbox_v2_auth_direct_grant_versions"."valid_until"))),
	CONSTRAINT "inbox_v2_auth_direct_grant_values_check" CHECK ("inbox_v2_auth_direct_grant_versions"."revision" >= 1
        and char_length("inbox_v2_auth_direct_grant_versions"."permission_id") <= 256 and (
    (
      "inbox_v2_auth_direct_grant_versions"."permission_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."permission_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_direct_grant_versions"."permission_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."permission_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."permission_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_direct_grant_versions"."permission_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_auth_direct_grant_versions"."catalog_schema_id" =
          'core:inbox-v2.permission-scope-catalog'
        and "inbox_v2_auth_direct_grant_versions"."catalog_version" = 'v1'
        and "inbox_v2_auth_direct_grant_versions"."catalog_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_auth_direct_grant_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_direct_grant_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_direct_grant_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_direct_grant_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_direct_grant_versions"."mutation_id") between 1 and 256
        and "inbox_v2_auth_direct_grant_versions"."record_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_auth_direct_grant_actor_check" CHECK ((
      "inbox_v2_auth_direct_grant_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_direct_grant_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_direct_grant_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_direct_grant_versions"."actor_employee_id" is null
      and "inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_direct_grant_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_direct_grant_times_check" CHECK (isfinite("inbox_v2_auth_direct_grant_versions"."occurred_at")
        and "inbox_v2_auth_direct_grant_versions"."created_at" = "inbox_v2_auth_direct_grant_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_employee_heads" (
	"tenant_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"employee_access_revision" bigint NOT NULL,
	"employee_inbox_relation_revision" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_employee_heads_pk" PRIMARY KEY("tenant_id","employee_id"),
	CONSTRAINT "inbox_v2_auth_employee_heads_revisions_check" CHECK ("inbox_v2_auth_employee_heads"."employee_access_revision" >= 1
        and "inbox_v2_auth_employee_heads"."employee_inbox_relation_revision" >= 1
        and "inbox_v2_auth_employee_heads"."revision" >= 1),
	CONSTRAINT "inbox_v2_auth_employee_heads_times_check" CHECK (isfinite("inbox_v2_auth_employee_heads"."created_at")
    and isfinite("inbox_v2_auth_employee_heads"."updated_at")
    and "inbox_v2_auth_employee_heads"."updated_at" >= "inbox_v2_auth_employee_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_mutation_commits" (
	"tenant_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"command_record_id" text NOT NULL,
	"stream_commit_id" text NOT NULL,
	"audit_event_id" text NOT NULL,
	"revision_effect_count" integer NOT NULL,
	"revision_effect_digest_sha256" text NOT NULL,
	"relation_write_count" integer NOT NULL,
	"relation_write_digest_sha256" text NOT NULL,
	"projection_intent_count" integer NOT NULL,
	"manifest_digest_sha256" text NOT NULL,
	"committed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_mutation_commits_pk" PRIMARY KEY("tenant_id","mutation_id"),
	CONSTRAINT "inbox_v2_auth_mutation_commits_command_unique" UNIQUE("tenant_id","command_record_id"),
	CONSTRAINT "inbox_v2_auth_mutation_commits_stream_unique" UNIQUE("tenant_id","stream_commit_id"),
	CONSTRAINT "inbox_v2_auth_mutation_commits_audit_unique" UNIQUE("tenant_id","audit_event_id"),
	CONSTRAINT "inbox_v2_auth_mutation_commits_manifest_check" CHECK ("inbox_v2_auth_mutation_commits"."revision_effect_count" >= 1
        and "inbox_v2_auth_mutation_commits"."relation_write_count" >= 1
        and "inbox_v2_auth_mutation_commits"."projection_intent_count" >= 1
        and "inbox_v2_auth_mutation_commits"."revision_effect_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_mutation_commits"."relation_write_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_mutation_commits"."manifest_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_auth_mutation_commits_times_check" CHECK (isfinite("inbox_v2_auth_mutation_commits"."committed_at")
        and "inbox_v2_auth_mutation_commits"."created_at" = "inbox_v2_auth_mutation_commits"."committed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_relation_writes" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"relation_kind" "inbox_v2_auth_relation_kind" NOT NULL,
	"relation_id" text NOT NULL,
	"previous_revision" bigint,
	"resulting_revision" bigint NOT NULL,
	"role_id" text,
	"role_binding_id" text,
	"direct_grant_id" text,
	"workforce_membership_id" text,
	"structural_access_binding_id" text,
	"collaborator_id" text,
	"internal_membership_transition_id" text,
	"primary_responsibility_transition_id" text,
	"servicing_team_transition_id" text,
	"write_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_relation_writes_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_auth_relation_writes_ordinal_unique" UNIQUE("tenant_id","mutation_id","ordinal"),
	CONSTRAINT "inbox_v2_auth_relation_writes_target_unique" UNIQUE("tenant_id","mutation_id","relation_kind","relation_id","resulting_revision"),
	CONSTRAINT "inbox_v2_auth_relation_writes_shape_check" CHECK (num_nonnulls("inbox_v2_auth_relation_writes"."role_id", "inbox_v2_auth_relation_writes"."role_binding_id",
    "inbox_v2_auth_relation_writes"."direct_grant_id", "inbox_v2_auth_relation_writes"."workforce_membership_id",
    "inbox_v2_auth_relation_writes"."structural_access_binding_id", "inbox_v2_auth_relation_writes"."collaborator_id",
    "inbox_v2_auth_relation_writes"."internal_membership_transition_id",
    "inbox_v2_auth_relation_writes"."primary_responsibility_transition_id",
    "inbox_v2_auth_relation_writes"."servicing_team_transition_id") = 1
    and case "inbox_v2_auth_relation_writes"."relation_kind"
      when 'role' then "inbox_v2_auth_relation_writes"."role_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'role_binding' then "inbox_v2_auth_relation_writes"."role_binding_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'direct_grant' then "inbox_v2_auth_relation_writes"."direct_grant_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'workforce_membership' then
        "inbox_v2_auth_relation_writes"."workforce_membership_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'structural_access' then
        "inbox_v2_auth_relation_writes"."structural_access_binding_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'conversation_collaborator' then
        "inbox_v2_auth_relation_writes"."collaborator_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'work_item_collaborator' then
        "inbox_v2_auth_relation_writes"."collaborator_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'internal_membership' then
        "inbox_v2_auth_relation_writes"."internal_membership_transition_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'primary_responsibility' then
        "inbox_v2_auth_relation_writes"."primary_responsibility_transition_id" = "inbox_v2_auth_relation_writes"."relation_id"
      when 'servicing_team' then
        "inbox_v2_auth_relation_writes"."servicing_team_transition_id" = "inbox_v2_auth_relation_writes"."relation_id"
      else false
    end),
	CONSTRAINT "inbox_v2_auth_relation_writes_values_check" CHECK ("inbox_v2_auth_relation_writes"."ordinal" between 1 and 1000
        and (("inbox_v2_auth_relation_writes"."previous_revision" is null
            and "inbox_v2_auth_relation_writes"."resulting_revision" = 1)
          or ("inbox_v2_auth_relation_writes"."previous_revision" >= 1
            and "inbox_v2_auth_relation_writes"."previous_revision" < 9223372036854775807
            and "inbox_v2_auth_relation_writes"."resulting_revision" = "inbox_v2_auth_relation_writes"."previous_revision" + 1))
        and char_length("inbox_v2_auth_relation_writes"."relation_id") between 1 and 256
        and "inbox_v2_auth_relation_writes"."relation_kind" <> 'client_owner'
        and "inbox_v2_auth_relation_writes"."write_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_relation_writes"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_resource_heads" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"resource_kind" "inbox_v2_auth_structural_resource_kind" NOT NULL,
	"conversation_id" text,
	"client_id" text,
	"source_account_id" text,
	"resource_access_revision" bigint NOT NULL,
	"structural_relation_revision" bigint NOT NULL,
	"collaborator_set_revision" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_resource_heads_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_auth_resource_heads_resource_check" CHECK (case "inbox_v2_auth_resource_heads"."resource_kind"
    when 'conversation' then "inbox_v2_auth_resource_heads"."conversation_id" is not null
      and "inbox_v2_auth_resource_heads"."client_id" is null and "inbox_v2_auth_resource_heads"."source_account_id" is null
    when 'client' then "inbox_v2_auth_resource_heads"."client_id" is not null
      and "inbox_v2_auth_resource_heads"."conversation_id" is null and "inbox_v2_auth_resource_heads"."source_account_id" is null
    when 'source_account' then "inbox_v2_auth_resource_heads"."source_account_id" is not null
      and "inbox_v2_auth_resource_heads"."conversation_id" is null and "inbox_v2_auth_resource_heads"."client_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_resource_heads_revisions_check" CHECK ("inbox_v2_auth_resource_heads"."resource_access_revision" >= 1
        and "inbox_v2_auth_resource_heads"."structural_relation_revision" >= 1
        and "inbox_v2_auth_resource_heads"."collaborator_set_revision" >= 1
        and "inbox_v2_auth_resource_heads"."revision" >= 1),
	CONSTRAINT "inbox_v2_auth_resource_heads_times_check" CHECK (isfinite("inbox_v2_auth_resource_heads"."created_at")
    and isfinite("inbox_v2_auth_resource_heads"."updated_at")
    and "inbox_v2_auth_resource_heads"."updated_at" >= "inbox_v2_auth_resource_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_revision_effects" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"effect_kind" "inbox_v2_auth_revision_effect_kind" NOT NULL,
	"before_revision" bigint NOT NULL,
	"after_revision" bigint NOT NULL,
	"employee_id" text,
	"resource_head_id" text,
	"work_item_id" text,
	"work_item_cycle" bigint,
	"expected_work_item_revision" bigint,
	"resulting_work_item_revision" bigint,
	"effect_hash" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_revision_effects_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_auth_revision_effects_ordinal_unique" UNIQUE("tenant_id","mutation_id","ordinal"),
	CONSTRAINT "inbox_v2_auth_revision_effects_hash_unique" UNIQUE("tenant_id","mutation_id","effect_hash"),
	CONSTRAINT "inbox_v2_auth_revision_effects_shape_check" CHECK (case "inbox_v2_auth_revision_effects"."effect_kind"
    when 'tenant_rbac' then num_nonnulls("inbox_v2_auth_revision_effects"."employee_id",
      "inbox_v2_auth_revision_effects"."resource_head_id", "inbox_v2_auth_revision_effects"."work_item_id", "inbox_v2_auth_revision_effects"."work_item_cycle",
      "inbox_v2_auth_revision_effects"."expected_work_item_revision", "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0
    when 'shared_access' then num_nonnulls("inbox_v2_auth_revision_effects"."employee_id",
      "inbox_v2_auth_revision_effects"."resource_head_id", "inbox_v2_auth_revision_effects"."work_item_id", "inbox_v2_auth_revision_effects"."work_item_cycle",
      "inbox_v2_auth_revision_effects"."expected_work_item_revision", "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0
    when 'employee_access' then "inbox_v2_auth_revision_effects"."employee_id" is not null
      and num_nonnulls("inbox_v2_auth_revision_effects"."resource_head_id", "inbox_v2_auth_revision_effects"."work_item_id",
        "inbox_v2_auth_revision_effects"."work_item_cycle", "inbox_v2_auth_revision_effects"."expected_work_item_revision",
        "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0
    when 'employee_inbox_relation' then "inbox_v2_auth_revision_effects"."employee_id" is not null
      and num_nonnulls("inbox_v2_auth_revision_effects"."resource_head_id", "inbox_v2_auth_revision_effects"."work_item_id",
        "inbox_v2_auth_revision_effects"."work_item_cycle", "inbox_v2_auth_revision_effects"."expected_work_item_revision",
        "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0
    when 'resource_access' then "inbox_v2_auth_revision_effects"."employee_id" is null
      and num_nonnulls("inbox_v2_auth_revision_effects"."resource_head_id", "inbox_v2_auth_revision_effects"."work_item_id") = 1
      and num_nonnulls("inbox_v2_auth_revision_effects"."work_item_cycle",
        "inbox_v2_auth_revision_effects"."expected_work_item_revision", "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0
    when 'collaborator_set' then "inbox_v2_auth_revision_effects"."employee_id" is null
      and (
        ("inbox_v2_auth_revision_effects"."resource_head_id" is not null
          and num_nonnulls("inbox_v2_auth_revision_effects"."work_item_id", "inbox_v2_auth_revision_effects"."work_item_cycle",
            "inbox_v2_auth_revision_effects"."expected_work_item_revision",
            "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 0)
        or
        ("inbox_v2_auth_revision_effects"."resource_head_id" is null
          and num_nonnulls("inbox_v2_auth_revision_effects"."work_item_id", "inbox_v2_auth_revision_effects"."work_item_cycle",
            "inbox_v2_auth_revision_effects"."expected_work_item_revision",
            "inbox_v2_auth_revision_effects"."resulting_work_item_revision") = 4
          and "inbox_v2_auth_revision_effects"."work_item_cycle" >= 0
          and "inbox_v2_auth_revision_effects"."expected_work_item_revision" >= 1
          and "inbox_v2_auth_revision_effects"."resulting_work_item_revision" =
            "inbox_v2_auth_revision_effects"."expected_work_item_revision" + 1)
      )
    else false
  end),
	CONSTRAINT "inbox_v2_auth_revision_effects_values_check" CHECK ("inbox_v2_auth_revision_effects"."ordinal" between 1 and 1000
        and "inbox_v2_auth_revision_effects"."before_revision" >= 1
        and "inbox_v2_auth_revision_effects"."after_revision" = "inbox_v2_auth_revision_effects"."before_revision" + 1
        and "inbox_v2_auth_revision_effects"."effect_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_revision_effects"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_role_binding_heads" (
	"tenant_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_role_binding_heads_pk" PRIMARY KEY("tenant_id","binding_id"),
	CONSTRAINT "inbox_v2_auth_role_binding_heads_revision_check" CHECK ("inbox_v2_auth_role_binding_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_role_binding_heads_times_check" CHECK (isfinite("inbox_v2_auth_role_binding_heads"."created_at")
    and isfinite("inbox_v2_auth_role_binding_heads"."updated_at")
    and "inbox_v2_auth_role_binding_heads"."updated_at" >= "inbox_v2_auth_role_binding_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_role_binding_versions" (
	"tenant_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"role_id" text NOT NULL,
	"role_revision_observed" bigint NOT NULL,
	"subject_kind" "inbox_v2_auth_binding_subject_kind" NOT NULL,
	"subject_employee_id" text,
	"subject_team_id" text,
	"subject_org_unit_id" text,
	"subject_work_queue_id" text,
	"scope_kind" "inbox_v2_auth_scope_kind" NOT NULL,
	"scope_org_unit_mode" "inbox_v2_auth_org_unit_mode",
	"scope_org_unit_id" text,
	"scope_team_id" text,
	"scope_work_queue_id" text,
	"scope_client_id" text,
	"scope_conversation_id" text,
	"scope_work_item_id" text,
	"scope_source_account_id" text,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_role_binding_versions_pk" PRIMARY KEY("tenant_id","binding_id","revision"),
	CONSTRAINT "inbox_v2_auth_role_binding_versions_mutation_unique" UNIQUE("tenant_id","binding_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_role_binding_subject_check" CHECK (case "inbox_v2_auth_role_binding_versions"."subject_kind"
    when 'employee' then num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_employee_id") = 1
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_team_id", "inbox_v2_auth_role_binding_versions"."subject_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."subject_work_queue_id") = 0
    when 'team' then num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_team_id") = 1
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_employee_id", "inbox_v2_auth_role_binding_versions"."subject_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."subject_work_queue_id") = 0
    when 'org_unit' then num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_org_unit_id") = 1
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_employee_id", "inbox_v2_auth_role_binding_versions"."subject_team_id",
        "inbox_v2_auth_role_binding_versions"."subject_work_queue_id") = 0
    when 'queue' then num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_work_queue_id") = 1
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."subject_employee_id", "inbox_v2_auth_role_binding_versions"."subject_team_id",
        "inbox_v2_auth_role_binding_versions"."subject_org_unit_id") = 0
    else false
  end),
	CONSTRAINT "inbox_v2_auth_role_binding_scope_check" CHECK (case "inbox_v2_auth_role_binding_versions"."scope_kind"
    when 'tenant' then num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode",
      "inbox_v2_auth_role_binding_versions"."scope_org_unit_id", "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
      "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
      "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'org_unit' then "inbox_v2_auth_role_binding_versions"."scope_org_unit_id" is not null
      and "inbox_v2_auth_role_binding_versions"."scope_org_unit_mode" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
        "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
        "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'team' then "inbox_v2_auth_role_binding_versions"."scope_team_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_work_queue_id", "inbox_v2_auth_role_binding_versions"."scope_client_id",
        "inbox_v2_auth_role_binding_versions"."scope_conversation_id", "inbox_v2_auth_role_binding_versions"."scope_work_item_id",
        "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'queue' then "inbox_v2_auth_role_binding_versions"."scope_work_queue_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_client_id",
        "inbox_v2_auth_role_binding_versions"."scope_conversation_id", "inbox_v2_auth_role_binding_versions"."scope_work_item_id",
        "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'client' then "inbox_v2_auth_role_binding_versions"."scope_client_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
        "inbox_v2_auth_role_binding_versions"."scope_conversation_id", "inbox_v2_auth_role_binding_versions"."scope_work_item_id",
        "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'conversation' then "inbox_v2_auth_role_binding_versions"."scope_conversation_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id", "inbox_v2_auth_role_binding_versions"."scope_client_id",
        "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'work_item' then "inbox_v2_auth_role_binding_versions"."scope_work_item_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id", "inbox_v2_auth_role_binding_versions"."scope_client_id",
        "inbox_v2_auth_role_binding_versions"."scope_conversation_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'source_account' then "inbox_v2_auth_role_binding_versions"."scope_source_account_id" is not null
      and num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode", "inbox_v2_auth_role_binding_versions"."scope_org_unit_id",
        "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id", "inbox_v2_auth_role_binding_versions"."scope_client_id",
        "inbox_v2_auth_role_binding_versions"."scope_conversation_id", "inbox_v2_auth_role_binding_versions"."scope_work_item_id") = 0
    when 'responsible' then num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode",
      "inbox_v2_auth_role_binding_versions"."scope_org_unit_id", "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
      "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
      "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'collaborator' then num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode",
      "inbox_v2_auth_role_binding_versions"."scope_org_unit_id", "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
      "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
      "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'internal_participant' then num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode",
      "inbox_v2_auth_role_binding_versions"."scope_org_unit_id", "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
      "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
      "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    when 'client_owner' then num_nonnulls("inbox_v2_auth_role_binding_versions"."scope_org_unit_mode",
      "inbox_v2_auth_role_binding_versions"."scope_org_unit_id", "inbox_v2_auth_role_binding_versions"."scope_team_id", "inbox_v2_auth_role_binding_versions"."scope_work_queue_id",
      "inbox_v2_auth_role_binding_versions"."scope_client_id", "inbox_v2_auth_role_binding_versions"."scope_conversation_id",
      "inbox_v2_auth_role_binding_versions"."scope_work_item_id", "inbox_v2_auth_role_binding_versions"."scope_source_account_id") = 0
    else false
  end),
	CONSTRAINT "inbox_v2_auth_role_binding_state_check" CHECK (isfinite("inbox_v2_auth_role_binding_versions"."valid_from")
    and ("inbox_v2_auth_role_binding_versions"."valid_until" is null or (
      isfinite("inbox_v2_auth_role_binding_versions"."valid_until") and "inbox_v2_auth_role_binding_versions"."valid_until" > "inbox_v2_auth_role_binding_versions"."valid_from"
    ))
    and (("inbox_v2_auth_role_binding_versions"."state" = 'active'
        and "inbox_v2_auth_role_binding_versions"."revoked_at" is null
        and "inbox_v2_auth_role_binding_versions"."occurred_at" <= "inbox_v2_auth_role_binding_versions"."valid_from")
      or ("inbox_v2_auth_role_binding_versions"."state" = 'revoked'
        and "inbox_v2_auth_role_binding_versions"."revoked_at" is not null
        and isfinite("inbox_v2_auth_role_binding_versions"."revoked_at")
        and "inbox_v2_auth_role_binding_versions"."revoked_at" > "inbox_v2_auth_role_binding_versions"."valid_from"
        and ("inbox_v2_auth_role_binding_versions"."valid_until" is null or "inbox_v2_auth_role_binding_versions"."revoked_at" <= "inbox_v2_auth_role_binding_versions"."valid_until")
        and "inbox_v2_auth_role_binding_versions"."occurred_at" = "inbox_v2_auth_role_binding_versions"."revoked_at")
      or ("inbox_v2_auth_role_binding_versions"."state" = 'archived'
        and "inbox_v2_auth_role_binding_versions"."revoked_at" is null
        and "inbox_v2_auth_role_binding_versions"."valid_until" is not null
        and "inbox_v2_auth_role_binding_versions"."occurred_at" >= "inbox_v2_auth_role_binding_versions"."valid_until"))),
	CONSTRAINT "inbox_v2_auth_role_binding_values_check" CHECK ("inbox_v2_auth_role_binding_versions"."revision" >= 1
        and "inbox_v2_auth_role_binding_versions"."role_revision_observed" >= 1
        and char_length("inbox_v2_auth_role_binding_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_role_binding_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_role_binding_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_role_binding_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_role_binding_versions"."mutation_id") between 1 and 256
        and "inbox_v2_auth_role_binding_versions"."record_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_auth_role_binding_actor_check" CHECK ((
      "inbox_v2_auth_role_binding_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_role_binding_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_role_binding_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_role_binding_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_role_binding_versions"."actor_employee_id" is null
      and "inbox_v2_auth_role_binding_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_role_binding_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_role_binding_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_role_binding_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_role_binding_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_role_binding_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_role_binding_times_check" CHECK (isfinite("inbox_v2_auth_role_binding_versions"."occurred_at")
        and "inbox_v2_auth_role_binding_versions"."created_at" = "inbox_v2_auth_role_binding_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_role_heads" (
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_role_heads_pk" PRIMARY KEY("tenant_id","role_id"),
	CONSTRAINT "inbox_v2_auth_role_heads_revision_check" CHECK ("inbox_v2_auth_role_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_role_heads_times_check" CHECK (isfinite("inbox_v2_auth_role_heads"."created_at")
    and isfinite("inbox_v2_auth_role_heads"."updated_at")
    and "inbox_v2_auth_role_heads"."updated_at" >= "inbox_v2_auth_role_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_role_version_permissions" (
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"role_revision" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"permission_id" text NOT NULL,
	"catalog_schema_id" text NOT NULL,
	"catalog_version" text NOT NULL,
	CONSTRAINT "inbox_v2_auth_role_version_permissions_pk" PRIMARY KEY("tenant_id","role_id","role_revision","ordinal"),
	CONSTRAINT "inbox_v2_auth_role_permissions_value_unique" UNIQUE("tenant_id","role_id","role_revision","permission_id"),
	CONSTRAINT "inbox_v2_auth_role_permissions_values_check" CHECK ("inbox_v2_auth_role_version_permissions"."role_revision" >= 1
        and "inbox_v2_auth_role_version_permissions"."ordinal" between 1 and 256
        and char_length("inbox_v2_auth_role_version_permissions"."permission_id") <= 256 and (
    (
      "inbox_v2_auth_role_version_permissions"."permission_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_version_permissions"."permission_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_role_version_permissions"."permission_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_version_permissions"."permission_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_role_version_permissions"."permission_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_role_version_permissions"."permission_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_auth_role_version_permissions"."catalog_schema_id" =
          'core:inbox-v2.permission-scope-catalog'
        and "inbox_v2_auth_role_version_permissions"."catalog_version" = 'v1')
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_role_versions" (
	"tenant_id" text NOT NULL,
	"role_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"permission_count" integer NOT NULL,
	"permission_set_digest_sha256" text NOT NULL,
	"catalog_digest_sha256" text NOT NULL,
	"snapshot_hash" text NOT NULL,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_role_versions_pk" PRIMARY KEY("tenant_id","role_id","revision"),
	CONSTRAINT "inbox_v2_auth_role_versions_mutation_unique" UNIQUE("tenant_id","role_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_role_versions_values_check" CHECK ("inbox_v2_auth_role_versions"."revision" >= 1
        and char_length("inbox_v2_auth_role_versions"."name") between 1 and 160
        and ("inbox_v2_auth_role_versions"."description" is null
          or char_length("inbox_v2_auth_role_versions"."description") <= 2000)
        and "inbox_v2_auth_role_versions"."permission_count" between 1 and 256
        and "inbox_v2_auth_role_versions"."permission_set_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_role_versions"."catalog_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_auth_role_versions"."snapshot_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_auth_role_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_role_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_role_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_role_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_role_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_role_versions"."mutation_id") between 1 and 256),
	CONSTRAINT "inbox_v2_auth_role_versions_actor_check" CHECK ((
      "inbox_v2_auth_role_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_role_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_role_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_role_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_role_versions"."actor_employee_id" is null
      and "inbox_v2_auth_role_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_role_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_role_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_role_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_role_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_role_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_role_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_role_versions_times_check" CHECK (isfinite("inbox_v2_auth_role_versions"."occurred_at")
        and "inbox_v2_auth_role_versions"."created_at" = "inbox_v2_auth_role_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_structural_access_heads" (
	"tenant_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"resource_head_id" text NOT NULL,
	"resource_kind" "inbox_v2_auth_structural_resource_kind" NOT NULL,
	"conversation_id" text,
	"client_id" text,
	"source_account_id" text,
	"target_kind" "inbox_v2_auth_structural_target_kind" NOT NULL,
	"target_org_unit_id" text,
	"target_team_id" text,
	"current_state" "inbox_v2_auth_record_state" NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_structural_heads_pk" PRIMARY KEY("tenant_id","binding_id"),
	CONSTRAINT "inbox_v2_auth_structural_heads_resource_check" CHECK (case "inbox_v2_auth_structural_access_heads"."resource_kind"
    when 'conversation' then "inbox_v2_auth_structural_access_heads"."conversation_id" is not null
      and "inbox_v2_auth_structural_access_heads"."client_id" is null and "inbox_v2_auth_structural_access_heads"."source_account_id" is null
    when 'client' then "inbox_v2_auth_structural_access_heads"."client_id" is not null
      and "inbox_v2_auth_structural_access_heads"."conversation_id" is null and "inbox_v2_auth_structural_access_heads"."source_account_id" is null
    when 'source_account' then "inbox_v2_auth_structural_access_heads"."source_account_id" is not null
      and "inbox_v2_auth_structural_access_heads"."conversation_id" is null and "inbox_v2_auth_structural_access_heads"."client_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_structural_heads_target_check" CHECK (case "inbox_v2_auth_structural_access_heads"."target_kind"
    when 'org_unit' then "inbox_v2_auth_structural_access_heads"."target_org_unit_id" is not null
      and "inbox_v2_auth_structural_access_heads"."target_team_id" is null
    when 'team' then "inbox_v2_auth_structural_access_heads"."target_team_id" is not null
      and "inbox_v2_auth_structural_access_heads"."target_org_unit_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_structural_heads_source_target_check" CHECK ("inbox_v2_auth_structural_access_heads"."resource_kind" <> 'source_account'
        or "inbox_v2_auth_structural_access_heads"."target_kind" = 'org_unit'),
	CONSTRAINT "inbox_v2_auth_structural_heads_values_check" CHECK ("inbox_v2_auth_structural_access_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_structural_heads_times_check" CHECK (isfinite("inbox_v2_auth_structural_access_heads"."created_at")
    and isfinite("inbox_v2_auth_structural_access_heads"."updated_at")
    and "inbox_v2_auth_structural_access_heads"."updated_at" >= "inbox_v2_auth_structural_access_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_structural_access_versions" (
	"tenant_id" text NOT NULL,
	"binding_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"resource_head_id" text NOT NULL,
	"resource_kind" "inbox_v2_auth_structural_resource_kind" NOT NULL,
	"conversation_id" text,
	"client_id" text,
	"source_account_id" text,
	"target_kind" "inbox_v2_auth_structural_target_kind" NOT NULL,
	"target_org_unit_id" text,
	"target_team_id" text,
	"policy_id" text,
	"policy_revision" bigint,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_structural_versions_pk" PRIMARY KEY("tenant_id","binding_id","revision"),
	CONSTRAINT "inbox_v2_auth_structural_versions_mutation_unique" UNIQUE("tenant_id","binding_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_structural_versions_resource_check" CHECK (case "inbox_v2_auth_structural_access_versions"."resource_kind"
    when 'conversation' then "inbox_v2_auth_structural_access_versions"."conversation_id" is not null
      and "inbox_v2_auth_structural_access_versions"."client_id" is null and "inbox_v2_auth_structural_access_versions"."source_account_id" is null
    when 'client' then "inbox_v2_auth_structural_access_versions"."client_id" is not null
      and "inbox_v2_auth_structural_access_versions"."conversation_id" is null and "inbox_v2_auth_structural_access_versions"."source_account_id" is null
    when 'source_account' then "inbox_v2_auth_structural_access_versions"."source_account_id" is not null
      and "inbox_v2_auth_structural_access_versions"."conversation_id" is null and "inbox_v2_auth_structural_access_versions"."client_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_structural_versions_target_check" CHECK (case "inbox_v2_auth_structural_access_versions"."target_kind"
    when 'org_unit' then "inbox_v2_auth_structural_access_versions"."target_org_unit_id" is not null
      and "inbox_v2_auth_structural_access_versions"."target_team_id" is null
    when 'team' then "inbox_v2_auth_structural_access_versions"."target_team_id" is not null
      and "inbox_v2_auth_structural_access_versions"."target_org_unit_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_structural_versions_source_target_check" CHECK ("inbox_v2_auth_structural_access_versions"."resource_kind" <> 'source_account'
        or "inbox_v2_auth_structural_access_versions"."target_kind" = 'org_unit'),
	CONSTRAINT "inbox_v2_auth_structural_versions_policy_check" CHECK (("inbox_v2_auth_structural_access_versions"."policy_id" is null and "inbox_v2_auth_structural_access_versions"."policy_revision" is null)
        or ("inbox_v2_auth_structural_access_versions"."policy_id" is not null
          and char_length("inbox_v2_auth_structural_access_versions"."policy_id") <= 256 and (
    (
      "inbox_v2_auth_structural_access_versions"."policy_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."policy_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_structural_access_versions"."policy_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."policy_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."policy_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_structural_access_versions"."policy_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
          and "inbox_v2_auth_structural_access_versions"."policy_revision" >= 1)),
	CONSTRAINT "inbox_v2_auth_structural_versions_state_check" CHECK (isfinite("inbox_v2_auth_structural_access_versions"."valid_from")
    and ("inbox_v2_auth_structural_access_versions"."valid_until" is null or (
      isfinite("inbox_v2_auth_structural_access_versions"."valid_until") and "inbox_v2_auth_structural_access_versions"."valid_until" > "inbox_v2_auth_structural_access_versions"."valid_from"
    ))
    and (("inbox_v2_auth_structural_access_versions"."state" = 'active'
        and "inbox_v2_auth_structural_access_versions"."revoked_at" is null
        and "inbox_v2_auth_structural_access_versions"."occurred_at" <= "inbox_v2_auth_structural_access_versions"."valid_from")
      or ("inbox_v2_auth_structural_access_versions"."state" = 'revoked'
        and "inbox_v2_auth_structural_access_versions"."revoked_at" is not null
        and isfinite("inbox_v2_auth_structural_access_versions"."revoked_at")
        and "inbox_v2_auth_structural_access_versions"."revoked_at" > "inbox_v2_auth_structural_access_versions"."valid_from"
        and ("inbox_v2_auth_structural_access_versions"."valid_until" is null or "inbox_v2_auth_structural_access_versions"."revoked_at" <= "inbox_v2_auth_structural_access_versions"."valid_until")
        and "inbox_v2_auth_structural_access_versions"."occurred_at" = "inbox_v2_auth_structural_access_versions"."revoked_at")
      or ("inbox_v2_auth_structural_access_versions"."state" = 'archived'
        and "inbox_v2_auth_structural_access_versions"."revoked_at" is null
        and "inbox_v2_auth_structural_access_versions"."valid_until" is not null
        and "inbox_v2_auth_structural_access_versions"."occurred_at" >= "inbox_v2_auth_structural_access_versions"."valid_until"))),
	CONSTRAINT "inbox_v2_auth_structural_versions_actor_check" CHECK ((
      "inbox_v2_auth_structural_access_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_structural_access_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_structural_access_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_structural_access_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_structural_access_versions"."actor_employee_id" is null
      and "inbox_v2_auth_structural_access_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_structural_access_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_structural_access_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_structural_access_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_structural_access_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_structural_versions_values_check" CHECK ("inbox_v2_auth_structural_access_versions"."revision" >= 1
        and char_length("inbox_v2_auth_structural_access_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_structural_access_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_structural_access_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_structural_access_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_structural_access_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_structural_access_versions"."mutation_id") between 1 and 256
        and "inbox_v2_auth_structural_access_versions"."record_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_structural_access_versions"."occurred_at")
        and "inbox_v2_auth_structural_access_versions"."created_at" = "inbox_v2_auth_structural_access_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_tenant_heads" (
	"tenant_id" text NOT NULL,
	"tenant_rbac_revision" bigint NOT NULL,
	"shared_access_revision" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_tenant_heads_pk" PRIMARY KEY("tenant_id"),
	CONSTRAINT "inbox_v2_auth_tenant_heads_revisions_check" CHECK ("inbox_v2_auth_tenant_heads"."tenant_rbac_revision" >= 1
        and "inbox_v2_auth_tenant_heads"."shared_access_revision" >= 1
        and "inbox_v2_auth_tenant_heads"."revision" >= 1),
	CONSTRAINT "inbox_v2_auth_tenant_heads_times_check" CHECK (isfinite("inbox_v2_auth_tenant_heads"."created_at")
    and isfinite("inbox_v2_auth_tenant_heads"."updated_at")
    and "inbox_v2_auth_tenant_heads"."updated_at" >= "inbox_v2_auth_tenant_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_workforce_membership_heads" (
	"tenant_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"employee_id" text NOT NULL,
	"membership_kind" "inbox_v2_auth_workforce_membership_kind" NOT NULL,
	"org_unit_id" text,
	"team_id" text,
	"work_queue_id" text,
	"current_state" "inbox_v2_auth_record_state" NOT NULL,
	"current_revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_workforce_heads_pk" PRIMARY KEY("tenant_id","membership_id"),
	CONSTRAINT "inbox_v2_auth_workforce_heads_target_check" CHECK (case "inbox_v2_auth_workforce_membership_heads"."membership_kind"
    when 'org_unit' then "inbox_v2_auth_workforce_membership_heads"."org_unit_id" is not null
      and "inbox_v2_auth_workforce_membership_heads"."team_id" is null and "inbox_v2_auth_workforce_membership_heads"."work_queue_id" is null
    when 'team' then "inbox_v2_auth_workforce_membership_heads"."team_id" is not null
      and "inbox_v2_auth_workforce_membership_heads"."org_unit_id" is null and "inbox_v2_auth_workforce_membership_heads"."work_queue_id" is null
    when 'queue' then "inbox_v2_auth_workforce_membership_heads"."work_queue_id" is not null
      and "inbox_v2_auth_workforce_membership_heads"."org_unit_id" is null and "inbox_v2_auth_workforce_membership_heads"."team_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_workforce_heads_values_check" CHECK ("inbox_v2_auth_workforce_membership_heads"."current_revision" >= 1),
	CONSTRAINT "inbox_v2_auth_workforce_heads_times_check" CHECK (isfinite("inbox_v2_auth_workforce_membership_heads"."created_at")
    and isfinite("inbox_v2_auth_workforce_membership_heads"."updated_at")
    and "inbox_v2_auth_workforce_membership_heads"."updated_at" >= "inbox_v2_auth_workforce_membership_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_auth_workforce_membership_versions" (
	"tenant_id" text NOT NULL,
	"membership_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"employee_id" text NOT NULL,
	"membership_kind" "inbox_v2_auth_workforce_membership_kind" NOT NULL,
	"org_unit_id" text,
	"team_id" text,
	"work_queue_id" text,
	"state" "inbox_v2_auth_record_state" NOT NULL,
	"valid_from" timestamp (3) with time zone NOT NULL,
	"valid_until" timestamp (3) with time zone,
	"revoked_at" timestamp (3) with time zone,
	"actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"actor_employee_id" text,
	"actor_trusted_service_id" text,
	"reason_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"record_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_auth_workforce_versions_pk" PRIMARY KEY("tenant_id","membership_id","revision"),
	CONSTRAINT "inbox_v2_auth_workforce_versions_mutation_unique" UNIQUE("tenant_id","membership_id","revision","mutation_id"),
	CONSTRAINT "inbox_v2_auth_workforce_versions_target_check" CHECK (case "inbox_v2_auth_workforce_membership_versions"."membership_kind"
    when 'org_unit' then "inbox_v2_auth_workforce_membership_versions"."org_unit_id" is not null
      and "inbox_v2_auth_workforce_membership_versions"."team_id" is null and "inbox_v2_auth_workforce_membership_versions"."work_queue_id" is null
    when 'team' then "inbox_v2_auth_workforce_membership_versions"."team_id" is not null
      and "inbox_v2_auth_workforce_membership_versions"."org_unit_id" is null and "inbox_v2_auth_workforce_membership_versions"."work_queue_id" is null
    when 'queue' then "inbox_v2_auth_workforce_membership_versions"."work_queue_id" is not null
      and "inbox_v2_auth_workforce_membership_versions"."org_unit_id" is null and "inbox_v2_auth_workforce_membership_versions"."team_id" is null
    else false
  end),
	CONSTRAINT "inbox_v2_auth_workforce_versions_state_check" CHECK (isfinite("inbox_v2_auth_workforce_membership_versions"."valid_from")
    and ("inbox_v2_auth_workforce_membership_versions"."valid_until" is null or (
      isfinite("inbox_v2_auth_workforce_membership_versions"."valid_until") and "inbox_v2_auth_workforce_membership_versions"."valid_until" > "inbox_v2_auth_workforce_membership_versions"."valid_from"
    ))
    and (("inbox_v2_auth_workforce_membership_versions"."state" = 'active'
        and "inbox_v2_auth_workforce_membership_versions"."revoked_at" is null
        and "inbox_v2_auth_workforce_membership_versions"."occurred_at" <= "inbox_v2_auth_workforce_membership_versions"."valid_from")
      or ("inbox_v2_auth_workforce_membership_versions"."state" = 'revoked'
        and "inbox_v2_auth_workforce_membership_versions"."revoked_at" is not null
        and isfinite("inbox_v2_auth_workforce_membership_versions"."revoked_at")
        and "inbox_v2_auth_workforce_membership_versions"."revoked_at" > "inbox_v2_auth_workforce_membership_versions"."valid_from"
        and ("inbox_v2_auth_workforce_membership_versions"."valid_until" is null or "inbox_v2_auth_workforce_membership_versions"."revoked_at" <= "inbox_v2_auth_workforce_membership_versions"."valid_until")
        and "inbox_v2_auth_workforce_membership_versions"."occurred_at" = "inbox_v2_auth_workforce_membership_versions"."revoked_at")
      or ("inbox_v2_auth_workforce_membership_versions"."state" = 'archived'
        and "inbox_v2_auth_workforce_membership_versions"."revoked_at" is null
        and "inbox_v2_auth_workforce_membership_versions"."valid_until" is not null
        and "inbox_v2_auth_workforce_membership_versions"."occurred_at" >= "inbox_v2_auth_workforce_membership_versions"."valid_until"))),
	CONSTRAINT "inbox_v2_auth_workforce_versions_actor_check" CHECK ((
      "inbox_v2_auth_workforce_membership_versions"."actor_kind" = 'employee'
      and "inbox_v2_auth_workforce_membership_versions"."actor_employee_id" is not null
      and "inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id" is null
    ) or (
      "inbox_v2_auth_workforce_membership_versions"."actor_kind" = 'trusted_service'
      and "inbox_v2_auth_workforce_membership_versions"."actor_employee_id" is null
      and "inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id" is not null
      and char_length("inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id") <= 256 and (
    (
      "inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_workforce_membership_versions"."actor_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
    )),
	CONSTRAINT "inbox_v2_auth_workforce_versions_values_check" CHECK ("inbox_v2_auth_workforce_membership_versions"."revision" >= 1
        and char_length("inbox_v2_auth_workforce_membership_versions"."reason_id") <= 256 and (
    (
      "inbox_v2_auth_workforce_membership_versions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_auth_workforce_membership_versions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_auth_workforce_membership_versions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_auth_workforce_membership_versions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_auth_workforce_membership_versions"."mutation_id") between 1 and 256
        and "inbox_v2_auth_workforce_membership_versions"."record_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_auth_workforce_membership_versions"."occurred_at")
        and "inbox_v2_auth_workforce_membership_versions"."created_at" = "inbox_v2_auth_workforce_membership_versions"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_domain_events" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"stream_commit_id" text NOT NULL,
	"stream_position" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"type_id" text NOT NULL,
	"payload_schema_id" text NOT NULL,
	"payload_schema_version" text NOT NULL,
	"change_ids" jsonb NOT NULL,
	"subjects" jsonb NOT NULL,
	"payload_reference" jsonb,
	"correlation_id" text NOT NULL,
	"command_ids" jsonb NOT NULL,
	"client_mutation_ids" jsonb NOT NULL,
	"authorization_decision_refs" jsonb NOT NULL,
	"access_effect" "inbox_v2_domain_event_access_effect" NOT NULL,
	"access_effect_causes" jsonb NOT NULL,
	"event_hash" text NOT NULL,
	"occurred_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_domain_events_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_domain_events_ordinal_unique" UNIQUE("tenant_id","stream_commit_id","ordinal"),
	CONSTRAINT "inbox_v2_domain_events_values_check" CHECK ("inbox_v2_domain_events"."stream_position" >= 1
        and "inbox_v2_domain_events"."ordinal" >= 1
        and char_length("inbox_v2_domain_events"."type_id") between 3 and 256
        and char_length("inbox_v2_domain_events"."payload_schema_id") between 3 and 256
        and char_length("inbox_v2_domain_events"."payload_schema_version") between 1 and 64
        and jsonb_typeof("inbox_v2_domain_events"."change_ids") = 'array'
        and jsonb_array_length("inbox_v2_domain_events"."change_ids") between 1 and 1000
        and jsonb_typeof("inbox_v2_domain_events"."subjects") = 'array'
        and jsonb_array_length("inbox_v2_domain_events"."subjects") between 1 and 1000
        and char_length("inbox_v2_domain_events"."correlation_id") between 1 and 256
        and jsonb_typeof("inbox_v2_domain_events"."command_ids") = 'array'
        and jsonb_array_length("inbox_v2_domain_events"."command_ids") <= 64
        and jsonb_typeof("inbox_v2_domain_events"."client_mutation_ids") = 'array'
        and jsonb_array_length("inbox_v2_domain_events"."client_mutation_ids") <= 64
        and jsonb_typeof("inbox_v2_domain_events"."authorization_decision_refs") = 'array'
        and jsonb_array_length("inbox_v2_domain_events"."authorization_decision_refs") <= 64
        and jsonb_typeof("inbox_v2_domain_events"."access_effect_causes") = 'array'
        and (("inbox_v2_domain_events"."access_effect" = 'none'
            and jsonb_array_length("inbox_v2_domain_events"."access_effect_causes") = 0)
          or ("inbox_v2_domain_events"."access_effect" = 'may_change_access'
            and jsonb_array_length("inbox_v2_domain_events"."access_effect_causes") between 1 and 8))
        and ("inbox_v2_domain_events"."payload_reference" is null
          or jsonb_typeof("inbox_v2_domain_events"."payload_reference") = 'object')
        and "inbox_v2_domain_events"."event_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_domain_events_times_check" CHECK (isfinite("inbox_v2_domain_events"."occurred_at")
        and isfinite("inbox_v2_domain_events"."recorded_at")
        and "inbox_v2_domain_events"."recorded_at" >= "inbox_v2_domain_events"."occurred_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_outbox_intents" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"stream_commit_id" text NOT NULL,
	"stream_position" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"type_id" text NOT NULL,
	"handler_id" text NOT NULL,
	"effect_class" "inbox_v2_outbox_intent_effect_class" NOT NULL,
	"event_id" text NOT NULL,
	"consumer_dedupe_key" text NOT NULL,
	"change_ids" jsonb NOT NULL,
	"payload_reference" jsonb,
	"correlation_id" text NOT NULL,
	"intent_hash" text NOT NULL,
	"available_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_outbox_intents_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_outbox_intents_ordinal_unique" UNIQUE("tenant_id","stream_commit_id","ordinal"),
	CONSTRAINT "inbox_v2_outbox_intents_dedupe_unique" UNIQUE("tenant_id","consumer_dedupe_key"),
	CONSTRAINT "inbox_v2_outbox_intents_values_check" CHECK ("inbox_v2_outbox_intents"."stream_position" >= 1
        and "inbox_v2_outbox_intents"."ordinal" >= 1
        and char_length("inbox_v2_outbox_intents"."type_id") between 3 and 256
        and char_length("inbox_v2_outbox_intents"."handler_id") between 3 and 256
        and "inbox_v2_outbox_intents"."consumer_dedupe_key" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_outbox_intents"."correlation_id") between 1 and 256
        and jsonb_typeof("inbox_v2_outbox_intents"."change_ids") = 'array'
        and jsonb_array_length("inbox_v2_outbox_intents"."change_ids") <= 1000
        and ("inbox_v2_outbox_intents"."payload_reference" is null
          or jsonb_typeof("inbox_v2_outbox_intents"."payload_reference") = 'object')
        and "inbox_v2_outbox_intents"."intent_hash" ~ '^sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_outbox_intents"."available_at")
        and isfinite("inbox_v2_outbox_intents"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_tenant_stream_changes" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"stream_commit_id" text NOT NULL,
	"stream_position" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"entity_type_id" text NOT NULL,
	"entity_id" text NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"timeline" jsonb,
	"audience" "inbox_v2_tenant_stream_audience" NOT NULL,
	"state_kind" text NOT NULL,
	"state_schema_id" text,
	"state_schema_version" text,
	"state_hash" text NOT NULL,
	"payload_reference" jsonb,
	"domain_commit_reference" jsonb NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_tenant_stream_changes_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_tenant_stream_changes_ordinal_unique" UNIQUE("tenant_id","stream_commit_id","ordinal"),
	CONSTRAINT "inbox_v2_tenant_stream_changes_values_check" CHECK ("inbox_v2_tenant_stream_changes"."stream_position" >= 1
        and "inbox_v2_tenant_stream_changes"."ordinal" >= 1
        and "inbox_v2_tenant_stream_changes"."resulting_revision" >= 1
        and char_length("inbox_v2_tenant_stream_changes"."entity_type_id") between 3 and 256
        and char_length("inbox_v2_tenant_stream_changes"."entity_id") between 1 and 256
        and "inbox_v2_tenant_stream_changes"."state_kind" in ('upsert', 'tombstone')
        and "inbox_v2_tenant_stream_changes"."state_hash" ~ '^sha256:[0-9a-f]{64}$'
        and ("inbox_v2_tenant_stream_changes"."timeline" is null
          or jsonb_typeof("inbox_v2_tenant_stream_changes"."timeline") = 'object')
        and jsonb_typeof("inbox_v2_tenant_stream_changes"."domain_commit_reference") = 'object'
        and ("inbox_v2_tenant_stream_changes"."payload_reference" is null
          or jsonb_typeof("inbox_v2_tenant_stream_changes"."payload_reference") = 'object')
        and (("inbox_v2_tenant_stream_changes"."state_kind" = 'upsert'
          and "inbox_v2_tenant_stream_changes"."state_schema_id" is not null
          and "inbox_v2_tenant_stream_changes"."state_schema_version" is not null
          and "inbox_v2_tenant_stream_changes"."payload_reference" is not null)
          or ("inbox_v2_tenant_stream_changes"."state_kind" = 'tombstone'
            and "inbox_v2_tenant_stream_changes"."state_schema_id" is null
            and "inbox_v2_tenant_stream_changes"."state_schema_version" is null
            and "inbox_v2_tenant_stream_changes"."payload_reference" is null))
        and isfinite("inbox_v2_tenant_stream_changes"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_tenant_stream_commits" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"stream_epoch" text NOT NULL,
	"position" bigint NOT NULL,
	"previous_position" bigint NOT NULL,
	"schema_version" text NOT NULL,
	"correlation_id" text NOT NULL,
	"command_ids" jsonb NOT NULL,
	"client_mutation_ids" jsonb NOT NULL,
	"authorization_decision_refs" jsonb NOT NULL,
	"change_ids" jsonb NOT NULL,
	"event_ids" jsonb NOT NULL,
	"outbox_intent_ids" jsonb NOT NULL,
	"audience_impact_kind" "inbox_v2_audience_impact_kind" NOT NULL,
	"audience_impact_manifest" jsonb NOT NULL,
	"change_count" integer NOT NULL,
	"event_count" integer NOT NULL,
	"outbox_intent_count" integer NOT NULL,
	"manifest_digest_sha256" text NOT NULL,
	"commit_hash" text NOT NULL,
	"committed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_tenant_stream_commits_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_tenant_stream_commits_mutation_unique" UNIQUE("tenant_id","id","mutation_id"),
	CONSTRAINT "inbox_v2_tenant_stream_commits_position_unique" UNIQUE("tenant_id","stream_epoch","position"),
	CONSTRAINT "inbox_v2_tenant_stream_commits_mutation_id_unique" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "inbox_v2_tenant_stream_commits_position_check" CHECK ("inbox_v2_tenant_stream_commits"."previous_position" >= 0
        and "inbox_v2_tenant_stream_commits"."position" = "inbox_v2_tenant_stream_commits"."previous_position" + 1),
	CONSTRAINT "inbox_v2_tenant_stream_commits_manifest_check" CHECK ("inbox_v2_tenant_stream_commits"."change_count" >= 1
        and "inbox_v2_tenant_stream_commits"."event_count" >= 1
        and "inbox_v2_tenant_stream_commits"."outbox_intent_count" >= 0
        and char_length("inbox_v2_tenant_stream_commits"."schema_version") between 1 and 64
        and char_length("inbox_v2_tenant_stream_commits"."correlation_id") between 1 and 256
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."command_ids") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."command_ids") <= 64
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."client_mutation_ids") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."client_mutation_ids") <= 64
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."authorization_decision_refs") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."authorization_decision_refs") <= 64
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."change_ids") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."change_ids") between 1 and 1000
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."change_ids") = "inbox_v2_tenant_stream_commits"."change_count"
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."event_ids") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."event_ids") between 1 and 1000
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."event_ids") = "inbox_v2_tenant_stream_commits"."event_count"
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."outbox_intent_ids") = 'array'
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."outbox_intent_ids") <= 1000
        and jsonb_array_length("inbox_v2_tenant_stream_commits"."outbox_intent_ids") =
          "inbox_v2_tenant_stream_commits"."outbox_intent_count"
        and jsonb_typeof("inbox_v2_tenant_stream_commits"."audience_impact_manifest") = 'object'
        and "inbox_v2_tenant_stream_commits"."audience_impact_manifest"->>'kind' =
          "inbox_v2_tenant_stream_commits"."audience_impact_kind"::text
        and "inbox_v2_tenant_stream_commits"."manifest_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_tenant_stream_commits"."commit_hash" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_tenant_stream_commits_times_check" CHECK (isfinite("inbox_v2_tenant_stream_commits"."committed_at")
        and "inbox_v2_tenant_stream_commits"."created_at" = "inbox_v2_tenant_stream_commits"."committed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_tenant_stream_heads" (
	"tenant_id" text NOT NULL,
	"stream_epoch" text NOT NULL,
	"last_position" bigint NOT NULL,
	"min_retained_position" bigint NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_tenant_stream_heads_pk" PRIMARY KEY("tenant_id"),
	CONSTRAINT "inbox_v2_tenant_stream_heads_values_check" CHECK ("inbox_v2_tenant_stream_heads"."last_position" >= 0
        and "inbox_v2_tenant_stream_heads"."min_retained_position" >= 0
        and "inbox_v2_tenant_stream_heads"."min_retained_position" <= "inbox_v2_tenant_stream_heads"."last_position"
        and "inbox_v2_tenant_stream_heads"."revision" >= 1
        and char_length("inbox_v2_tenant_stream_heads"."stream_epoch") between 8 and 256),
	CONSTRAINT "inbox_v2_tenant_stream_heads_times_check" CHECK (isfinite("inbox_v2_tenant_stream_heads"."created_at")
    and isfinite("inbox_v2_tenant_stream_heads"."updated_at")
    and "inbox_v2_tenant_stream_heads"."updated_at" >= "inbox_v2_tenant_stream_heads"."created_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_audit_events" ADD CONSTRAINT "inbox_v2_auth_audit_events_command_fk" FOREIGN KEY ("tenant_id","command_record_id","mutation_id") REFERENCES "public"."inbox_v2_auth_command_records"("tenant_id","id","mutation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_audit_events" ADD CONSTRAINT "inbox_v2_auth_audit_events_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_audit_facets" ADD CONSTRAINT "inbox_v2_auth_audit_facets_event_fk" FOREIGN KEY ("tenant_id","audit_event_id") REFERENCES "public"."inbox_v2_auth_audit_events"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_heads" ADD CONSTRAINT "inbox_v2_auth_collaborator_heads_current_fk" FOREIGN KEY ("tenant_id","collaborator_id","current_revision") REFERENCES "public"."inbox_v2_auth_collaborator_versions"("tenant_id","collaborator_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_heads" ADD CONSTRAINT "inbox_v2_auth_collaborator_heads_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_heads" ADD CONSTRAINT "inbox_v2_auth_collaborator_heads_work_item_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."inbox_v2_work_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_heads" ADD CONSTRAINT "inbox_v2_auth_collaborator_heads_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_versions" ADD CONSTRAINT "inbox_v2_auth_collaborator_versions_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_versions" ADD CONSTRAINT "inbox_v2_auth_collaborator_versions_work_item_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."inbox_v2_work_items"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_versions" ADD CONSTRAINT "inbox_v2_auth_collaborator_versions_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_collaborator_versions" ADD CONSTRAINT "inbox_v2_auth_collaborator_versions_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" ADD CONSTRAINT "inbox_v2_auth_command_records_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" ADD CONSTRAINT "inbox_v2_auth_command_records_employee_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_heads" ADD CONSTRAINT "inbox_v2_auth_direct_grant_heads_current_fk" FOREIGN KEY ("tenant_id","grant_id","current_revision") REFERENCES "public"."inbox_v2_auth_direct_grant_versions"("tenant_id","grant_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_org_fk" FOREIGN KEY ("tenant_id","scope_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_team_fk" FOREIGN KEY ("tenant_id","scope_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_queue_fk" FOREIGN KEY ("tenant_id","scope_work_queue_id") REFERENCES "public"."work_queues"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_client_fk" FOREIGN KEY ("tenant_id","scope_client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_conversation_fk" FOREIGN KEY ("tenant_id","scope_conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_work_item_fk" FOREIGN KEY ("tenant_id","scope_work_item_id") REFERENCES "public"."inbox_v2_work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_direct_grant_versions" ADD CONSTRAINT "inbox_v2_auth_direct_grant_scope_source_fk" FOREIGN KEY ("tenant_id","scope_source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_employee_heads" ADD CONSTRAINT "inbox_v2_auth_employee_heads_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_mutation_commits" ADD CONSTRAINT "inbox_v2_auth_mutation_commits_command_fk" FOREIGN KEY ("tenant_id","command_record_id","mutation_id") REFERENCES "public"."inbox_v2_auth_command_records"("tenant_id","id","mutation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_mutation_commits" ADD CONSTRAINT "inbox_v2_auth_mutation_commits_stream_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_mutation_commits" ADD CONSTRAINT "inbox_v2_auth_mutation_commits_audit_fk" FOREIGN KEY ("tenant_id","audit_event_id","mutation_id") REFERENCES "public"."inbox_v2_auth_audit_events"("tenant_id","id","mutation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_commit_fk" FOREIGN KEY ("tenant_id","mutation_id") REFERENCES "public"."inbox_v2_auth_mutation_commits"("tenant_id","mutation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_role_fk" FOREIGN KEY ("tenant_id","role_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_role_versions"("tenant_id","role_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_binding_fk" FOREIGN KEY ("tenant_id","role_binding_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_role_binding_versions"("tenant_id","binding_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_grant_fk" FOREIGN KEY ("tenant_id","direct_grant_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_direct_grant_versions"("tenant_id","grant_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_workforce_fk" FOREIGN KEY ("tenant_id","workforce_membership_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_workforce_membership_versions"("tenant_id","membership_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_structural_fk" FOREIGN KEY ("tenant_id","structural_access_binding_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_structural_access_versions"("tenant_id","binding_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_collaborator_fk" FOREIGN KEY ("tenant_id","collaborator_id","resulting_revision") REFERENCES "public"."inbox_v2_auth_collaborator_versions"("tenant_id","collaborator_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_membership_transition_fk" FOREIGN KEY ("tenant_id","internal_membership_transition_id") REFERENCES "public"."inbox_v2_participant_membership_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_primary_transition_fk" FOREIGN KEY ("tenant_id","primary_responsibility_transition_id") REFERENCES "public"."inbox_v2_work_item_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_relation_writes" ADD CONSTRAINT "inbox_v2_auth_relation_writes_team_transition_fk" FOREIGN KEY ("tenant_id","servicing_team_transition_id") REFERENCES "public"."inbox_v2_work_item_relation_transitions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_resource_heads" ADD CONSTRAINT "inbox_v2_auth_resource_heads_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_resource_heads" ADD CONSTRAINT "inbox_v2_auth_resource_heads_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_resource_heads" ADD CONSTRAINT "inbox_v2_auth_resource_heads_source_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_revision_effects" ADD CONSTRAINT "inbox_v2_auth_revision_effects_commit_fk" FOREIGN KEY ("tenant_id","mutation_id") REFERENCES "public"."inbox_v2_auth_mutation_commits"("tenant_id","mutation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_revision_effects" ADD CONSTRAINT "inbox_v2_auth_revision_effects_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_revision_effects" ADD CONSTRAINT "inbox_v2_auth_revision_effects_resource_fk" FOREIGN KEY ("tenant_id","resource_head_id") REFERENCES "public"."inbox_v2_auth_resource_heads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_revision_effects" ADD CONSTRAINT "inbox_v2_auth_revision_effects_work_item_fk" FOREIGN KEY ("tenant_id","work_item_id") REFERENCES "public"."inbox_v2_work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_heads" ADD CONSTRAINT "inbox_v2_auth_role_binding_heads_current_fk" FOREIGN KEY ("tenant_id","binding_id","current_revision") REFERENCES "public"."inbox_v2_auth_role_binding_versions"("tenant_id","binding_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_versions_role_fk" FOREIGN KEY ("tenant_id","role_id") REFERENCES "public"."inbox_v2_auth_role_heads"("tenant_id","role_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_versions_role_observed_fk" FOREIGN KEY ("tenant_id","role_id","role_revision_observed") REFERENCES "public"."inbox_v2_auth_role_versions"("tenant_id","role_id","revision") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_subject_employee_fk" FOREIGN KEY ("tenant_id","subject_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_subject_team_fk" FOREIGN KEY ("tenant_id","subject_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_subject_org_fk" FOREIGN KEY ("tenant_id","subject_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_subject_queue_fk" FOREIGN KEY ("tenant_id","subject_work_queue_id") REFERENCES "public"."work_queues"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_org_fk" FOREIGN KEY ("tenant_id","scope_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_team_fk" FOREIGN KEY ("tenant_id","scope_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_queue_fk" FOREIGN KEY ("tenant_id","scope_work_queue_id") REFERENCES "public"."work_queues"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_client_fk" FOREIGN KEY ("tenant_id","scope_client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_conversation_fk" FOREIGN KEY ("tenant_id","scope_conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_work_item_fk" FOREIGN KEY ("tenant_id","scope_work_item_id") REFERENCES "public"."inbox_v2_work_items"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_binding_versions" ADD CONSTRAINT "inbox_v2_auth_role_binding_scope_source_fk" FOREIGN KEY ("tenant_id","scope_source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_heads" ADD CONSTRAINT "inbox_v2_auth_role_heads_current_fk" FOREIGN KEY ("tenant_id","role_id","current_revision") REFERENCES "public"."inbox_v2_auth_role_versions"("tenant_id","role_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_version_permissions" ADD CONSTRAINT "inbox_v2_auth_role_permissions_version_fk" FOREIGN KEY ("tenant_id","role_id","role_revision") REFERENCES "public"."inbox_v2_auth_role_versions"("tenant_id","role_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_versions" ADD CONSTRAINT "inbox_v2_auth_role_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_role_versions" ADD CONSTRAINT "inbox_v2_auth_role_versions_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_current_fk" FOREIGN KEY ("tenant_id","binding_id","current_revision") REFERENCES "public"."inbox_v2_auth_structural_access_versions"("tenant_id","binding_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_resource_head_fk" FOREIGN KEY ("tenant_id","resource_head_id") REFERENCES "public"."inbox_v2_auth_resource_heads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_source_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_org_fk" FOREIGN KEY ("tenant_id","target_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_heads" ADD CONSTRAINT "inbox_v2_auth_structural_heads_team_fk" FOREIGN KEY ("tenant_id","target_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_head_fk" FOREIGN KEY ("tenant_id","resource_head_id") REFERENCES "public"."inbox_v2_auth_resource_heads"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_conversation_fk" FOREIGN KEY ("tenant_id","conversation_id") REFERENCES "public"."inbox_v2_conversations"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_client_fk" FOREIGN KEY ("tenant_id","client_id") REFERENCES "public"."clients"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_source_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_org_fk" FOREIGN KEY ("tenant_id","target_org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_team_fk" FOREIGN KEY ("tenant_id","target_team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_structural_access_versions" ADD CONSTRAINT "inbox_v2_auth_structural_versions_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_tenant_heads" ADD CONSTRAINT "inbox_v2_auth_tenant_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_heads" ADD CONSTRAINT "inbox_v2_auth_workforce_heads_current_fk" FOREIGN KEY ("tenant_id","membership_id","current_revision") REFERENCES "public"."inbox_v2_auth_workforce_membership_versions"("tenant_id","membership_id","revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_heads" ADD CONSTRAINT "inbox_v2_auth_workforce_heads_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_heads" ADD CONSTRAINT "inbox_v2_auth_workforce_heads_org_fk" FOREIGN KEY ("tenant_id","org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_heads" ADD CONSTRAINT "inbox_v2_auth_workforce_heads_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_heads" ADD CONSTRAINT "inbox_v2_auth_workforce_heads_queue_fk" FOREIGN KEY ("tenant_id","work_queue_id") REFERENCES "public"."work_queues"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_versions" ADD CONSTRAINT "inbox_v2_auth_workforce_versions_employee_fk" FOREIGN KEY ("tenant_id","employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_versions" ADD CONSTRAINT "inbox_v2_auth_workforce_versions_org_fk" FOREIGN KEY ("tenant_id","org_unit_id") REFERENCES "public"."org_units"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_versions" ADD CONSTRAINT "inbox_v2_auth_workforce_versions_team_fk" FOREIGN KEY ("tenant_id","team_id") REFERENCES "public"."teams"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_versions" ADD CONSTRAINT "inbox_v2_auth_workforce_versions_queue_fk" FOREIGN KEY ("tenant_id","work_queue_id") REFERENCES "public"."work_queues"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_workforce_membership_versions" ADD CONSTRAINT "inbox_v2_auth_workforce_versions_actor_fk" FOREIGN KEY ("tenant_id","actor_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_domain_events" ADD CONSTRAINT "inbox_v2_domain_events_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_intents" ADD CONSTRAINT "inbox_v2_outbox_intents_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_outbox_intents" ADD CONSTRAINT "inbox_v2_outbox_intents_event_fk" FOREIGN KEY ("tenant_id","event_id") REFERENCES "public"."inbox_v2_domain_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_changes" ADD CONSTRAINT "inbox_v2_tenant_stream_changes_commit_fk" FOREIGN KEY ("tenant_id","stream_commit_id","mutation_id") REFERENCES "public"."inbox_v2_tenant_stream_commits"("tenant_id","id","mutation_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_commits" ADD CONSTRAINT "inbox_v2_tenant_stream_commits_head_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_tenant_stream_heads"("tenant_id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_tenant_stream_heads" ADD CONSTRAINT "inbox_v2_tenant_stream_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_audit_events_time_idx" ON "inbox_v2_auth_audit_events" USING btree ("tenant_id","occurred_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_audit_events_target_idx" ON "inbox_v2_auth_audit_events" USING btree ("tenant_id","target_type_id","internal_target_ref","occurred_at");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_audit_facets_lookup_idx" ON "inbox_v2_auth_audit_facets" USING btree ("tenant_id","dimension","entity_type_id","internal_entity_ref","audit_event_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_collaborator_heads_conversation_unique" ON "inbox_v2_auth_collaborator_heads" USING btree ("tenant_id","conversation_id","employee_id") WHERE "inbox_v2_auth_collaborator_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_collaborator_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_collaborator_heads_work_item_unique" ON "inbox_v2_auth_collaborator_heads" USING btree ("tenant_id","work_item_id","work_item_cycle","employee_id") WHERE "inbox_v2_auth_collaborator_heads"."resource_kind" = 'work_item'
          and "inbox_v2_auth_collaborator_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_collaborator_heads_employee_idx" ON "inbox_v2_auth_collaborator_heads" USING btree ("tenant_id","employee_id","resource_kind","collaborator_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_collaborator_versions_employee_idx" ON "inbox_v2_auth_collaborator_versions" USING btree ("tenant_id","employee_id","resource_kind","valid_from","collaborator_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_collaborator_versions_resource_idx" ON "inbox_v2_auth_collaborator_versions" USING btree ("tenant_id","resource_kind","conversation_id","work_item_id","valid_from");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_command_records_idempotency_unique" ON "inbox_v2_auth_command_records" USING btree ("tenant_id","principal_scope_key","command_type_id","client_mutation_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_command_records_time_idx" ON "inbox_v2_auth_command_records" USING btree ("tenant_id","occurred_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_direct_grant_heads_tenant_revision_idx" ON "inbox_v2_auth_direct_grant_heads" USING btree ("tenant_id","current_revision","grant_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_direct_grant_tenant_employee_idx" ON "inbox_v2_auth_direct_grant_versions" USING btree ("tenant_id","employee_id","valid_from","grant_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_direct_grant_tenant_permission_idx" ON "inbox_v2_auth_direct_grant_versions" USING btree ("tenant_id","permission_id","valid_from","grant_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_employee_heads_access_idx" ON "inbox_v2_auth_employee_heads" USING btree ("tenant_id","employee_access_revision","employee_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_employee_heads_relation_idx" ON "inbox_v2_auth_employee_heads" USING btree ("tenant_id","employee_inbox_relation_revision","employee_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_mutation_commits_time_idx" ON "inbox_v2_auth_mutation_commits" USING btree ("tenant_id","committed_at","mutation_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_relation_writes_relation_idx" ON "inbox_v2_auth_relation_writes" USING btree ("tenant_id","relation_kind","relation_id","resulting_revision");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_resource_heads_conversation_unique" ON "inbox_v2_auth_resource_heads" USING btree ("tenant_id","conversation_id") WHERE "inbox_v2_auth_resource_heads"."resource_kind" = 'conversation';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_resource_heads_client_unique" ON "inbox_v2_auth_resource_heads" USING btree ("tenant_id","client_id") WHERE "inbox_v2_auth_resource_heads"."resource_kind" = 'client';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_resource_heads_source_unique" ON "inbox_v2_auth_resource_heads" USING btree ("tenant_id","source_account_id") WHERE "inbox_v2_auth_resource_heads"."resource_kind" = 'source_account';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_resource_heads_access_idx" ON "inbox_v2_auth_resource_heads" USING btree ("tenant_id","resource_access_revision","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_revision_effects_target_idx" ON "inbox_v2_auth_revision_effects" USING btree ("tenant_id","effect_kind","employee_id","resource_head_id","work_item_id","work_item_cycle","mutation_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_revision_effects_tenant_clock_unique" ON "inbox_v2_auth_revision_effects" USING btree ("tenant_id","effect_kind","after_revision") WHERE "inbox_v2_auth_revision_effects"."effect_kind" in ('tenant_rbac', 'shared_access');
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_revision_effects_employee_clock_unique" ON "inbox_v2_auth_revision_effects" USING btree ("tenant_id","effect_kind","employee_id","after_revision") WHERE "inbox_v2_auth_revision_effects"."employee_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_revision_effects_resource_clock_unique" ON "inbox_v2_auth_revision_effects" USING btree ("tenant_id","effect_kind","resource_head_id","after_revision") WHERE "inbox_v2_auth_revision_effects"."resource_head_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_revision_effects_work_item_clock_unique" ON "inbox_v2_auth_revision_effects" USING btree ("tenant_id","effect_kind","work_item_id","after_revision") WHERE "inbox_v2_auth_revision_effects"."work_item_id" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_binding_heads_tenant_revision_idx" ON "inbox_v2_auth_role_binding_heads" USING btree ("tenant_id","current_revision","binding_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_binding_tenant_subject_idx" ON "inbox_v2_auth_role_binding_versions" USING btree ("tenant_id","subject_kind","subject_employee_id","subject_team_id","subject_org_unit_id","subject_work_queue_id","valid_from");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_binding_tenant_scope_idx" ON "inbox_v2_auth_role_binding_versions" USING btree ("tenant_id","scope_kind","valid_from","binding_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_binding_tenant_role_active_idx" ON "inbox_v2_auth_role_binding_versions" USING btree ("tenant_id","role_id","binding_id","revision") WHERE "inbox_v2_auth_role_binding_versions"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_heads_tenant_revision_idx" ON "inbox_v2_auth_role_heads" USING btree ("tenant_id","current_revision","role_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_permissions_tenant_permission_idx" ON "inbox_v2_auth_role_version_permissions" USING btree ("tenant_id","permission_id","role_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_role_versions_tenant_history_idx" ON "inbox_v2_auth_role_versions" USING btree ("tenant_id","role_id","revision" DESC NULLS LAST);
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_structural_heads_conversation_org_unique" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","conversation_id","target_org_unit_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'org_unit'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_structural_heads_conversation_team_unique" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","conversation_id","target_team_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'conversation'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'team'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_structural_heads_client_org_unique" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","client_id","target_org_unit_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'client'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'org_unit'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_structural_heads_client_team_unique" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","client_id","target_team_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'client'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'team'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_structural_heads_source_org_unique" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","source_account_id","target_org_unit_id") WHERE "inbox_v2_auth_structural_access_heads"."resource_kind" = 'source_account'
          and "inbox_v2_auth_structural_access_heads"."target_kind" = 'org_unit'
          and "inbox_v2_auth_structural_access_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_structural_heads_resource_idx" ON "inbox_v2_auth_structural_access_heads" USING btree ("tenant_id","resource_head_id","binding_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_structural_versions_resource_idx" ON "inbox_v2_auth_structural_access_versions" USING btree ("tenant_id","resource_head_id","valid_from","binding_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_structural_versions_target_idx" ON "inbox_v2_auth_structural_access_versions" USING btree ("tenant_id","target_kind","target_org_unit_id","target_team_id","valid_from");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_tenant_heads_tenant_idx" ON "inbox_v2_auth_tenant_heads" USING btree ("tenant_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_workforce_heads_org_unique" ON "inbox_v2_auth_workforce_membership_heads" USING btree ("tenant_id","employee_id","org_unit_id") WHERE "inbox_v2_auth_workforce_membership_heads"."membership_kind" = 'org_unit'
          and "inbox_v2_auth_workforce_membership_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_workforce_heads_team_unique" ON "inbox_v2_auth_workforce_membership_heads" USING btree ("tenant_id","employee_id","team_id") WHERE "inbox_v2_auth_workforce_membership_heads"."membership_kind" = 'team'
          and "inbox_v2_auth_workforce_membership_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_auth_workforce_heads_queue_unique" ON "inbox_v2_auth_workforce_membership_heads" USING btree ("tenant_id","employee_id","work_queue_id") WHERE "inbox_v2_auth_workforce_membership_heads"."membership_kind" = 'queue'
          and "inbox_v2_auth_workforce_membership_heads"."current_state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_workforce_heads_employee_idx" ON "inbox_v2_auth_workforce_membership_heads" USING btree ("tenant_id","employee_id","membership_kind","membership_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_auth_workforce_versions_employee_idx" ON "inbox_v2_auth_workforce_membership_versions" USING btree ("tenant_id","employee_id","membership_kind","valid_from","membership_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_domain_events_type_idx" ON "inbox_v2_domain_events" USING btree ("tenant_id","type_id","stream_position");
--> statement-breakpoint
CREATE INDEX "inbox_v2_outbox_intents_available_idx" ON "inbox_v2_outbox_intents" USING btree ("tenant_id","available_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_tenant_stream_changes_entity_idx" ON "inbox_v2_tenant_stream_changes" USING btree ("tenant_id","entity_type_id","entity_id","stream_position");
--> statement-breakpoint
CREATE INDEX "inbox_v2_tenant_stream_commits_time_idx" ON "inbox_v2_tenant_stream_commits" USING btree ("tenant_id","committed_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_tenant_stream_heads_tenant_idx" ON "inbox_v2_tenant_stream_heads" USING btree ("tenant_id");
--> statement-breakpoint
create or replace function public.inbox_v2_work_item_aggregate_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_item_id text;
  v_work public.inbox_v2_work_items%rowtype;
  v_creation public.inbox_v2_work_item_creation_decisions%rowtype;
  v_creation_queue public.inbox_v2_work_queue_versions%rowtype;
  v_creation_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_sla_count bigint;
  v_sla_min_revision bigint;
  v_sla_max_revision bigint;
  v_sla_cycle_count bigint;
  v_sla_min_cycle bigint;
  v_sla_max_cycle bigint;
  v_slot_revision bigint;
  v_conversation_transport public.inbox_v2_conversation_transport;
  v_expected_creation_slot_revision bigint;
  v_active_assignment_count bigint;
  v_active_assignment_id text;
  v_last_effect_opened_assignment_id text;
  v_last_effect_closed_assignment_id text;
  v_active_team_count bigint;
  v_active_team_episode_id text;
  v_active_team_id text;
  v_active_team_cycle bigint;
  v_last_effect_opened_team_episode_id text;
  v_last_effect_closed_team_episode_id text;
  v_proof_count bigint;
  v_distinct_proof_count bigint;
  v_min_proof_revision bigint;
  v_max_proof_revision bigint;
  v_collaborator_effect_count bigint;
  v_distinct_collaborator_revision_count bigint;
  v_min_collaborator_revision bigint;
  v_max_collaborator_revision bigint;
  v_reopen_count bigint;
  v_access_change_count bigint;
  v_relation_count bigint;
  v_distinct_relation_count bigint;
  v_min_relation_revision bigint;
  v_max_relation_revision bigint;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_chain_state public.inbox_v2_work_item_state;
  v_chain_queue_id text;
  v_chain_queue_revision bigint;
  v_chain_relation_revision bigint;
  v_revision_proof record;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'inbox_v2_work_items' then
    v_work_item_id := new.id;
  else
    v_work_item_id := new.work_item_id;
  end if;

  select * into v_work
    from public.inbox_v2_work_items w
   where w.tenant_id = v_tenant_id and w.id = v_work_item_id;
  if not found then
    return null;
  end if;

  select * into v_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle
     and s.revision = v_work.sla_snapshot_revision;
  if not found then
    raise exception 'WorkItem SLA head must reference an exact immutable snapshot'
      using errcode = '23514';
  end if;
  select count(*), min(s.revision), max(s.revision)
    into v_sla_count, v_sla_min_revision, v_sla_max_revision
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = v_work.sla_cycle;
  if v_sla_min_revision <> 1
     or v_sla_max_revision <> v_work.sla_snapshot_revision
     or v_sla_count <> v_work.sla_snapshot_revision then
    raise exception 'WorkItem SLA snapshot revisions must be contiguous through the cycle head'
      using errcode = '23514';
  end if;
  select count(distinct s.sla_cycle), min(s.sla_cycle), max(s.sla_cycle)
    into v_sla_cycle_count, v_sla_min_cycle, v_sla_max_cycle
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id and s.work_item_id = v_work.id;
  if v_sla_min_cycle <> 1
     or v_sla_max_cycle <> v_work.sla_cycle
     or v_sla_cycle_count <> v_work.sla_cycle
     or exists (
       select 1
         from public.inbox_v2_work_item_sla_snapshots s
        where s.tenant_id = v_work.tenant_id
          and s.work_item_id = v_work.id
        group by s.sla_cycle
       having min(s.revision) <> 1 or count(*) <> max(s.revision)
     ) then
    raise exception 'WorkItem SLA cycles and per-cycle revisions must be gap-free'
      using errcode = '23514';
  end if;

  select * into v_creation
    from public.inbox_v2_work_item_creation_decisions d
   where d.tenant_id = v_work.tenant_id and d.work_item_id = v_work.id;
  select * into v_creation_queue
    from public.inbox_v2_work_queue_versions q
   where q.tenant_id = v_creation.tenant_id
     and q.work_queue_id = v_creation.work_queue_id
     and q.revision = v_creation.work_queue_revision;
  select * into v_creation_sla
    from public.inbox_v2_work_item_sla_snapshots s
   where s.tenant_id = v_work.tenant_id
     and s.work_item_id = v_work.id
     and s.sla_cycle = 1
     and s.revision = 1;
  select c.transport into v_conversation_transport
    from public.inbox_v2_conversations c
   where c.tenant_id = v_work.tenant_id and c.id = v_work.conversation_id;
  select s.revision into v_slot_revision
    from public.inbox_v2_conversation_work_item_slots s
   where s.tenant_id = v_work.tenant_id
     and s.conversation_id = v_work.conversation_id;
  select 1 + v_work.ordinal + count(t.id)
    into v_expected_creation_slot_revision
    from public.inbox_v2_work_items prior
    join public.inbox_v2_work_item_transitions t
      on t.tenant_id = prior.tenant_id and t.work_item_id = prior.id
   where prior.tenant_id = v_work.tenant_id
     and prior.conversation_id = v_work.conversation_id
     and prior.ordinal < v_work.ordinal
     and t.kind in (
       'close_resolved',
       'close_dismissed',
       'reopen_unassigned',
       'reopen_assigned'
     );
  if v_creation.work_item_id is null
     or v_creation.conversation_id <> v_work.conversation_id
     or v_creation.transport <> v_conversation_transport
     or v_creation.reason_id <> v_work.creation_reason_id
     or v_work.created_actor_kind <> 'trusted_service'
     or v_creation.decided_by_trusted_service_id <>
        v_work.created_actor_trusted_service_id
     or v_creation.decided_at > v_work.created_at
     or v_creation.slot_after_revision > v_slot_revision
     or v_creation.slot_after_revision <>
        v_expected_creation_slot_revision
     or (v_work.ordinal = 1 and
       v_creation.latest_terminal_handling <> 'no_latest_work_item')
     or (v_work.ordinal > 1 and
       v_creation.latest_terminal_handling <> 'create_sequential') then
    raise exception 'WorkItem must retain its exact creation decision authority'
      using errcode = '23514';
  end if;

  if v_creation_sla.revision is null
     or v_creation_sla.kind <> v_creation_queue.default_sla_kind
     or v_creation_sla.calculated_at <> v_work.created_at
     or v_creation_sla.created_at <> v_work.created_at
     or (
       v_creation_queue.default_sla_kind = 'tracked'
       and (
         v_creation_sla.policy_id <>
            v_creation_queue.default_sla_policy_id
         or v_creation_sla.policy_version <>
            v_creation_queue.default_sla_policy_version
         or v_creation_sla.policy_revision <>
            v_creation_queue.default_sla_policy_revision
         or v_creation_sla.input_revision <> 1
         or v_creation_sla.business_calendar_id <>
            v_creation_queue.default_business_calendar_id
         or v_creation_sla.business_calendar_version <>
            v_creation_queue.default_business_calendar_version
         or v_creation_sla.business_calendar_revision <>
            v_creation_queue.default_business_calendar_revision
         or v_creation_sla.time_zone <>
            v_creation_queue.default_sla_time_zone
         or v_creation_sla.clock_state <> 'running'
         or v_creation_sla.started_at <> v_work.created_at
         or v_creation_sla.paused_at is not null
         or v_creation_sla.pause_condition_id is not null
         or v_creation_sla.stopped_at is not null
         or v_creation_sla.first_human_response_at is not null
       )
     ) then
    raise exception 'WorkItem cycle-one SLA must retain exact creation Queue defaults'
      using errcode = '23514';
  end if;

  if v_work.revision = 1 and (
    v_work.state <> 'new'
    or v_work.queue_id <> v_creation.work_queue_id
    or v_work.queue_revision <> v_creation.work_queue_revision
    or v_work.reopen_cycle <> 0
    or v_work.servicing_team_relation_revision <> 1
    or v_work.collaborator_set_revision <> 1
    or v_work.resource_access_revision <> 1
    or v_work.priority_id <> v_creation_queue.default_priority_id
    or v_work.sla_cycle <> 1
    or v_work.sla_snapshot_revision <> 1
    or v_work.current_primary_assignment_id is not null
    or v_work.current_servicing_team_episode_id is not null
  ) then
    raise exception 'Revision-one WorkItem must be the unassigned creation snapshot'
      using errcode = '23514';
  end if;

  if v_sla.kind = 'tracked' and (
       (v_work.state in ('resolved', 'dismissed') and
         (
           v_sla.clock_state <> 'stopped'
           or v_sla.stopped_at <> v_work.updated_at
           or v_sla.calculated_at <> v_work.updated_at
         ))
       or (v_work.state in ('new', 'assigned', 'in_progress', 'waiting') and
         v_sla.clock_state = 'stopped')
     ) then
    raise exception 'Tracked SLA clock state must follow WorkItem terminality'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where a.state = 'active'),
    max(a.id) filter (where a.state = 'active')
    into v_active_assignment_count, v_active_assignment_id
    from public.inbox_v2_work_item_primary_assignments a
   where a.tenant_id = v_work.tenant_id and a.work_item_id = v_work.id;
  if (
      v_work.state in ('assigned', 'in_progress', 'waiting')
      and (
        v_active_assignment_count <> 1
        or v_work.current_primary_assignment_id is distinct from
           v_active_assignment_id
      )
    ) or (
      v_work.state in ('new', 'resolved', 'dismissed')
      and (
        v_active_assignment_count <> 0
        or v_work.current_primary_assignment_id is not null
      )
    ) then
    raise exception 'WorkItem state and active primary-assignment head diverged'
      using errcode = '23514';
  end if;
  if v_work.last_primary_assignment_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.id = v_work.last_primary_assignment_id
  ) then
    raise exception 'WorkItem last primary-assignment pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select t.opened_primary_assignment_id, t.closed_primary_assignment_id
    into v_last_effect_opened_assignment_id,
         v_last_effect_closed_assignment_id
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and (
       t.opened_primary_assignment_id is not null
       or t.closed_primary_assignment_id is not null
     )
   order by t.resulting_revision desc
   limit 1;
  if v_work.last_primary_assignment_id is distinct from coalesce(
       v_last_effect_opened_assignment_id,
       v_last_effect_closed_assignment_id
     )
     or (v_work.state in ('assigned', 'in_progress', 'waiting') and
       v_work.current_primary_assignment_id is distinct from
         v_last_effect_opened_assignment_id) then
    raise exception 'WorkItem primary-assignment pointers must follow the latest assignment effect'
      using errcode = '23514';
  end if;

  select
    count(*) filter (where e.state = 'active'),
    max(e.id) filter (where e.state = 'active'),
    max(e.team_id) filter (where e.state = 'active'),
    max(e.work_item_cycle) filter (where e.state = 'active')
    into v_active_team_count,
         v_active_team_episode_id,
         v_active_team_id,
         v_active_team_cycle
    from public.inbox_v2_work_item_servicing_team_episodes e
   where e.tenant_id = v_work.tenant_id and e.work_item_id = v_work.id;
  if v_work.state in ('resolved', 'dismissed') and v_active_team_count <> 0 then
    raise exception 'Terminal WorkItem cannot retain an active servicing team'
      using errcode = '23514';
  end if;
  if (
      v_work.current_servicing_team_episode_id is null
      and (v_active_team_count <> 0 or v_work.current_servicing_team_id is not null)
    ) or (
      v_work.current_servicing_team_episode_id is not null
      and (
        v_active_team_count <> 1
        or v_work.current_servicing_team_episode_id is distinct from
           v_active_team_episode_id
        or v_work.current_servicing_team_id is distinct from v_active_team_id
        or v_work.reopen_cycle <> v_active_team_cycle
      )
    ) then
    raise exception 'WorkItem servicing-team head is not the exact active episode'
      using errcode = '23514';
  end if;
  if v_work.last_servicing_team_episode_id is not null and not exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.id = v_work.last_servicing_team_episode_id
  ) then
    raise exception 'WorkItem last servicing-team pointer crosses aggregate scope'
      using errcode = '23514';
  end if;
  select effect.opened_episode_id, effect.closed_episode_id
    into v_last_effect_opened_team_episode_id,
         v_last_effect_closed_team_episode_id
    from (
      select
        r.resulting_work_item_revision as work_item_revision,
        r.next_episode_id as opened_episode_id,
        r.previous_episode_id as closed_episode_id
      from public.inbox_v2_work_item_relation_transitions r
      where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select
        t.resulting_revision as work_item_revision,
        null::text as opened_episode_id,
        t.closed_servicing_team_episode_id as closed_episode_id
      from public.inbox_v2_work_item_transitions t
      where t.tenant_id = v_work.tenant_id
        and t.work_item_id = v_work.id
        and t.closed_servicing_team_episode_id is not null
    ) effect
   order by effect.work_item_revision desc
   limit 1;
  if v_work.last_servicing_team_episode_id is distinct from coalesce(
       v_last_effect_opened_team_episode_id,
       v_last_effect_closed_team_episode_id
     )
     or (v_work.current_servicing_team_episode_id is not null and
       v_work.current_servicing_team_episode_id is distinct from
         v_last_effect_opened_team_episode_id) then
    raise exception 'WorkItem servicing-team pointers must follow the latest relation effect'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and a.state = 'ended'
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.id = a.termination_transition_id
            and t.closed_primary_assignment_id = a.id
            and t.occurred_at = a.end_recorded_at
            and t.actor_kind = a.ended_actor_kind
            and t.actor_employee_id is not distinct from a.ended_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.ended_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.ended_actor_trusted_service_id
            and t.reason_id = a.end_reason_id
            and (
              (t.kind in ('recovery_requeue', 'recovery_transfer')
                and a.end_basis = 'employee_fence_time')
              or (t.kind in (
                'release',
                'transfer',
                'close_resolved',
                'close_dismissed'
              ) and a.end_basis = 'command_time')
            )
       )
  ) then
    raise exception 'Ended assignment must name its exact WorkItem transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_primary_assignments a
      join public.inbox_v2_work_queue_eligibility_decisions d
        on d.tenant_id = a.tenant_id and d.id = a.eligibility_decision_id
     where a.tenant_id = v_work.tenant_id
       and a.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_transitions t
          where t.tenant_id = a.tenant_id
            and t.work_item_id = a.work_item_id
            and t.opened_primary_assignment_id = a.id
            and t.expected_revision = d.expected_work_item_revision
            and t.destination_queue_id = a.queue_at_start_id
            and t.destination_queue_revision = a.queue_at_start_revision
            and t.occurred_at = a.started_at
            and a.created_at = t.occurred_at
            and d.decided_at = t.occurred_at
            and d.employee_fence_loaded_at = t.occurred_at
            and t.actor_kind = a.started_actor_kind
            and t.actor_employee_id is not distinct from a.started_actor_employee_id
            and t.actor_authorization_epoch is not distinct from
                a.started_actor_authorization_epoch
            and t.actor_trusted_service_id is not distinct from
                a.started_actor_trusted_service_id
            and t.reason_id = a.start_reason_id
            and (
              (t.kind = 'claim'
                and a.source = 'claim'
                and t.actor_kind = 'employee'
                and t.actor_employee_id = a.employee_id)
              or (t.kind = 'assign' and
                a.source in ('manual_assignment', 'policy_assignment'))
              or (t.kind = 'transfer' and a.source = 'transfer')
              or (t.kind = 'reopen_assigned' and a.source = 'reopen')
              or (t.kind = 'recovery_transfer' and
                a.source = 'recovery_transfer')
            )
       )
  ) then
    raise exception 'Primary assignment must retain its exact opening transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and (
         (t.opened_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
             join public.inbox_v2_work_queue_eligibility_decisions d
               on d.tenant_id = a.tenant_id
              and d.id = a.eligibility_decision_id
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.opened_primary_assignment_id
              and d.expected_work_item_revision = t.expected_revision
              and a.queue_at_start_id = t.destination_queue_id
              and a.queue_at_start_revision = t.destination_queue_revision
              and a.started_at = t.occurred_at
              and a.created_at = t.occurred_at
              and d.decided_at = t.occurred_at
              and d.employee_fence_loaded_at = t.occurred_at
              and a.started_actor_kind = t.actor_kind
              and a.started_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.started_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.started_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.start_reason_id = t.reason_id
              and (
                (t.kind = 'claim'
                  and a.source = 'claim'
                  and t.actor_kind = 'employee'
                  and t.actor_employee_id = a.employee_id)
                or (t.kind = 'assign' and
                  a.source in ('manual_assignment', 'policy_assignment'))
                or (t.kind = 'transfer' and a.source = 'transfer')
                or (t.kind = 'reopen_assigned' and a.source = 'reopen')
                or (t.kind = 'recovery_transfer' and
                  a.source = 'recovery_transfer')
              )
         ))
         or (t.closed_primary_assignment_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_primary_assignments a
            where a.tenant_id = t.tenant_id
              and a.work_item_id = t.work_item_id
              and a.id = t.closed_primary_assignment_id
              and a.state = 'ended'
              and a.termination_transition_id = t.id
              and a.end_recorded_at = t.occurred_at
              and a.ended_actor_kind = t.actor_kind
              and a.ended_actor_employee_id is not distinct from
                  t.actor_employee_id
              and a.ended_actor_authorization_epoch is not distinct from
                  t.actor_authorization_epoch
              and a.ended_actor_trusted_service_id is not distinct from
                  t.actor_trusted_service_id
              and a.end_reason_id = t.reason_id
              and (
                (t.kind in ('recovery_requeue', 'recovery_transfer')
                  and a.end_basis = 'employee_fence_time')
                or (t.kind in (
                  'release',
                  'transfer',
                  'close_resolved',
                  'close_dismissed'
                ) and a.end_basis = 'command_time')
              )
         ))
       )
  ) then
    raise exception 'WorkItem transition assignment effect lacks exact bidirectional history'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
      join public.inbox_v2_work_item_primary_assignments closed
        on closed.tenant_id = t.tenant_id
       and closed.id = t.closed_primary_assignment_id
      join public.inbox_v2_work_item_primary_assignments opened
        on opened.tenant_id = t.tenant_id
       and opened.id = t.opened_primary_assignment_id
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.kind in ('transfer', 'recovery_transfer')
       and closed.employee_id = opened.employee_id
       and closed.queue_at_start_id = opened.queue_at_start_id
       and closed.queue_at_start_revision = opened.queue_at_start_revision
  ) then
    raise exception 'Primary transfer must change Employee or Queue'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and e.state = 'ended'
       and (
         (e.end_cause = 'relation_command' and not exists (
           select 1
             from public.inbox_v2_work_item_relation_transitions r
            where r.tenant_id = e.tenant_id
              and r.work_item_id = e.work_item_id
              and r.id = e.end_relation_transition_id
              and r.previous_episode_id = e.id
              and r.occurred_at = e.end_recorded_at
              and r.occurred_at = e.ended_at
         ))
         or (e.end_cause = 'work_item_terminal' and not exists (
           select 1
             from public.inbox_v2_work_item_transitions t
            where t.tenant_id = e.tenant_id
              and t.work_item_id = e.work_item_id
              and t.id = e.end_work_item_transition_id
              and t.kind in ('close_resolved', 'close_dismissed')
              and t.closed_servicing_team_episode_id = e.id
              and t.occurred_at = e.end_recorded_at
              and t.occurred_at = e.ended_at
         ))
       )
  ) then
    raise exception 'Ended servicing-team episode must name its exact transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
      join public.inbox_v2_work_item_servicing_team_episodes previous
        on previous.tenant_id = r.tenant_id
       and previous.id = r.previous_episode_id
      join public.inbox_v2_work_item_servicing_team_episodes following
        on following.tenant_id = r.tenant_id
       and following.id = r.next_episode_id
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and r.kind = 'servicing_team_change'
       and previous.team_id = following.team_id
  ) then
    raise exception 'Servicing-team change must target a different Team'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_revision),
         min(p.resulting_revision), max(p.resulting_revision)
    into v_proof_count, v_distinct_proof_count,
         v_min_proof_revision, v_max_proof_revision
    from (
      select t.resulting_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
      union all
      select r.resulting_work_item_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select effect_row.resulting_work_item_revision
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = v_work.tenant_id
         and effect_row.effect_kind = 'collaborator_set'
         and effect_row.work_item_id = v_work.id
    ) p;
  if (v_work.revision = 1 and v_proof_count <> 0)
     or (v_work.revision > 1 and (
       v_proof_count <> v_work.revision - 1
       or v_distinct_proof_count <> v_proof_count
       or v_min_proof_revision <> 2
       or v_max_proof_revision <> v_work.revision
     )) then
    raise exception 'WorkItem revision chain requires exactly one immutable proof per +1'
      using errcode = '23514';
  end if;

  select count(*) into v_reopen_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.kind in ('reopen_unassigned', 'reopen_assigned');
  select count(*), count(distinct effect_row.after_revision),
         min(effect_row.before_revision), max(effect_row.after_revision)
    into v_collaborator_effect_count,
         v_distinct_collaborator_revision_count,
         v_min_collaborator_revision, v_max_collaborator_revision
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = v_work.tenant_id
     and effect_row.effect_kind = 'collaborator_set'
     and effect_row.work_item_id = v_work.id;
  if v_work.reopen_cycle <> v_reopen_count
     or v_work.collaborator_set_revision < 1
     or v_collaborator_effect_count <>
        v_work.collaborator_set_revision - 1
     or v_distinct_collaborator_revision_count <>
        v_collaborator_effect_count
     or (v_collaborator_effect_count > 0 and (
       v_min_collaborator_revision <> 1
       or v_max_collaborator_revision <> v_work.collaborator_set_revision
     ))
     or exists (
       select 1
         from public.inbox_v2_auth_revision_effects effect_row
        where effect_row.tenant_id = v_work.tenant_id
          and effect_row.effect_kind = 'collaborator_set'
          and effect_row.work_item_id = v_work.id
          and (
            effect_row.resulting_work_item_revision <>
              effect_row.expected_work_item_revision + 1
            or effect_row.work_item_cycle <> (
              select count(*)
                from public.inbox_v2_work_item_transitions reopen
               where reopen.tenant_id = effect_row.tenant_id
                 and reopen.work_item_id = effect_row.work_item_id
                 and reopen.resulting_revision <=
                   effect_row.expected_work_item_revision
                 and reopen.kind in ('reopen_unassigned', 'reopen_assigned')
            )
          )
     ) then
    raise exception 'WorkItem reopen/collaborator revisions lack exact history proof'
      using errcode = '23514';
  end if;

  select count(*) into v_access_change_count
    from (
      select t.id
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and (
           t.opened_primary_assignment_id is not null
           or t.closed_primary_assignment_id is not null
           or t.source_queue_id <> t.destination_queue_id
           or t.source_queue_revision <> t.destination_queue_revision
           or t.from_state in ('resolved', 'dismissed')
           or t.to_state in ('resolved', 'dismissed')
         )
      union all
      select r.id
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    ) access_change;
  if v_work.resource_access_revision <> 1 + v_access_change_count then
    raise exception 'WorkItem resource-access revision lacks exact authority-change proof'
      using errcode = '23514';
  end if;

  v_chain_state := 'new';
  v_chain_queue_id := v_creation.work_queue_id;
  v_chain_queue_revision := v_creation.work_queue_revision;
  for v_transition in
    select *
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
     order by t.resulting_revision
  loop
    if v_transition.from_state <> v_chain_state
       or v_transition.source_queue_id <> v_chain_queue_id
       or v_transition.source_queue_revision <> v_chain_queue_revision then
      raise exception 'WorkItem transition source breaks the persisted lifecycle chain'
        using errcode = '23514';
    end if;
    v_chain_state := v_transition.to_state;
    v_chain_queue_id := v_transition.destination_queue_id;
    v_chain_queue_revision := v_transition.destination_queue_revision;
  end loop;
  if v_chain_state <> v_work.state
     or v_chain_queue_id <> v_work.queue_id
     or v_chain_queue_revision <> v_work.queue_revision then
    raise exception 'WorkItem lifecycle transition chain does not induce the head'
      using errcode = '23514';
  end if;

  v_chain_relation_revision := 1;
  for v_revision_proof in
    select
      t.resulting_revision as work_item_revision,
      t.expected_servicing_team_relation_revision as expected_relation_revision,
      t.resulting_servicing_team_relation_revision as resulting_relation_revision
    from public.inbox_v2_work_item_transitions t
    where t.tenant_id = v_work.tenant_id and t.work_item_id = v_work.id
    union all
    select
      r.resulting_work_item_revision as work_item_revision,
      r.expected_relation_revision,
      r.resulting_relation_revision
    from public.inbox_v2_work_item_relation_transitions r
    where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
    order by work_item_revision
  loop
    if v_revision_proof.expected_relation_revision <>
         v_chain_relation_revision then
      raise exception 'WorkItem proof breaks the servicing-team relation chain'
        using errcode = '23514';
    end if;
    v_chain_relation_revision := v_revision_proof.resulting_relation_revision;
  end loop;
  if v_chain_relation_revision <> v_work.servicing_team_relation_revision then
    raise exception 'Servicing-team relation proof chain does not induce the head'
      using errcode = '23514';
  end if;

  select * into v_transition
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = v_work.tenant_id
     and t.work_item_id = v_work.id
     and t.resulting_revision = v_work.revision;
  if found and (
    v_transition.occurred_at <> v_work.updated_at
    or v_transition.resulting_servicing_team_relation_revision <>
       v_work.servicing_team_relation_revision
  ) then
    raise exception 'Latest WorkItem transition timestamp/relation does not induce the head'
      using errcode = '23514';
  end if;

  select count(*), count(distinct p.resulting_relation_revision),
         min(p.resulting_relation_revision), max(p.resulting_relation_revision)
    into v_relation_count, v_distinct_relation_count,
         v_min_relation_revision, v_max_relation_revision
    from (
      select r.resulting_relation_revision
        from public.inbox_v2_work_item_relation_transitions r
       where r.tenant_id = v_work.tenant_id and r.work_item_id = v_work.id
      union all
      select t.resulting_servicing_team_relation_revision
        from public.inbox_v2_work_item_transitions t
       where t.tenant_id = v_work.tenant_id
         and t.work_item_id = v_work.id
         and t.closed_servicing_team_episode_id is not null
    ) p;
  if (v_work.servicing_team_relation_revision = 1 and v_relation_count <> 0)
     or (v_work.servicing_team_relation_revision > 1 and (
       v_relation_count <> v_work.servicing_team_relation_revision - 1
       or v_distinct_relation_count <> v_relation_count
       or v_min_relation_revision <> 2
       or v_max_relation_revision <> v_work.servicing_team_relation_revision
     )) then
    raise exception 'Servicing-team relation revision chain is not contiguous'
      using errcode = '23514';
  end if;

  select * into v_relation
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = v_work.tenant_id
     and r.work_item_id = v_work.id
     and r.resulting_work_item_revision = v_work.revision;
  if found then
    if v_relation.resulting_relation_revision <>
         v_work.servicing_team_relation_revision
       or v_relation.occurred_at <> v_work.updated_at
       or (v_relation.kind = 'servicing_team_add' and (
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or v_relation.previous_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_remove' and (
         v_work.current_servicing_team_episode_id is not null
         or v_relation.next_episode_id is not null
       ))
       or (v_relation.kind = 'servicing_team_change' and
         v_work.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id) then
      raise exception 'Latest servicing-team transition does not induce the relation head'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = v_work.tenant_id
       and r.work_item_id = v_work.id
       and (
         (r.previous_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.previous_episode_id
              and e.state = 'ended'
              and e.end_cause = 'relation_command'
              and e.end_relation_transition_id = r.id
              and e.end_recorded_at = r.occurred_at
              and e.ended_at = r.occurred_at
              and e.ended_actor_kind = r.actor_kind
              and e.ended_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.ended_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.ended_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.end_reason_id = r.reason_id
         ))
         or (r.next_episode_id is not null and not exists (
           select 1
             from public.inbox_v2_work_item_servicing_team_episodes e
            where e.tenant_id = r.tenant_id
              and e.work_item_id = r.work_item_id
              and e.id = r.next_episode_id
              and e.started_at = r.occurred_at
              and e.started_actor_kind = r.actor_kind
              and e.started_actor_employee_id is not distinct from
                  r.actor_employee_id
              and e.started_actor_authorization_epoch is not distinct from
                  r.actor_authorization_epoch
              and e.started_actor_trusted_service_id is not distinct from
                  r.actor_trusted_service_id
              and e.start_reason_id = r.reason_id
              and e.work_item_cycle = (
                select count(*)
                  from public.inbox_v2_work_item_transitions reopen
                 where reopen.tenant_id = r.tenant_id
                   and reopen.work_item_id = r.work_item_id
                   and reopen.resulting_revision <=
                       r.expected_work_item_revision
                   and reopen.kind in (
                     'reopen_unassigned',
                     'reopen_assigned'
                   )
              )
         ))
       )
  ) then
    raise exception 'Servicing-team transition episode pointers cross aggregate scope'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_servicing_team_episodes e
     where e.tenant_id = v_work.tenant_id
       and e.work_item_id = v_work.id
       and not exists (
         select 1
           from public.inbox_v2_work_item_relation_transitions r
          where r.tenant_id = e.tenant_id
            and r.work_item_id = e.work_item_id
            and r.next_episode_id = e.id
            and r.occurred_at = e.started_at
            and r.actor_kind = e.started_actor_kind
            and r.actor_employee_id is not distinct from
                e.started_actor_employee_id
            and r.actor_authorization_epoch is not distinct from
                e.started_actor_authorization_epoch
            and r.actor_trusted_service_id is not distinct from
                e.started_actor_trusted_service_id
            and r.reason_id = e.start_reason_id
            and e.work_item_cycle = (
              select count(*)
                from public.inbox_v2_work_item_transitions reopen
               where reopen.tenant_id = r.tenant_id
                 and reopen.work_item_id = r.work_item_id
                 and reopen.resulting_revision <=
                     r.expected_work_item_revision
                 and reopen.kind in ('reopen_unassigned', 'reopen_assigned')
            )
       )
  ) then
    raise exception 'Servicing-team episode must retain its exact opening relation transition'
      using errcode = '23514';
  end if;

  if exists (
    select 1
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = v_work.tenant_id
       and t.work_item_id = v_work.id
       and t.closed_servicing_team_episode_id is not null
       and not exists (
         select 1
           from public.inbox_v2_work_item_servicing_team_episodes e
          where e.tenant_id = t.tenant_id
            and e.work_item_id = t.work_item_id
            and e.id = t.closed_servicing_team_episode_id
            and e.state = 'ended'
            and e.end_cause = 'work_item_terminal'
            and e.end_work_item_transition_id = t.id
            and e.end_recorded_at = t.occurred_at
            and e.ended_at = t.occurred_at
            and e.ended_actor_kind = t.actor_kind
            and e.ended_actor_employee_id is not distinct from
                t.actor_employee_id
            and e.ended_actor_authorization_epoch is not distinct from
                t.actor_authorization_epoch
            and e.ended_actor_trusted_service_id is not distinct from
                t.actor_trusted_service_id
            and e.end_reason_id = t.reason_id
       )
  ) then
    raise exception 'Terminal WorkItem relation proof must close its exact team episode'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create or replace function public.inbox_v2_work_item_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_transition_count bigint;
  v_relation_transition_count bigint;
  v_collaborator_effect_count bigint;
  v_collaborator_effect record;
  v_transition public.inbox_v2_work_item_transitions%rowtype;
  v_relation public.inbox_v2_work_item_relation_transitions%rowtype;
  v_old_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_new_sla public.inbox_v2_work_item_sla_snapshots%rowtype;
  v_destination_queue public.inbox_v2_work_queue_versions%rowtype;
  v_previous_team_id text;
  v_next_team_id text;
  v_expected_access_revision bigint;
begin
  if not exists (
    select 1
      from public.inbox_v2_work_items w
     where w.tenant_id = new.tenant_id and w.id = new.id
  ) then
    return null;
  end if;

  select count(*) into v_transition_count
    from public.inbox_v2_work_item_transitions t
   where t.tenant_id = new.tenant_id
     and t.work_item_id = new.id
     and t.resulting_revision = new.revision;
  select count(*) into v_relation_transition_count
    from public.inbox_v2_work_item_relation_transitions r
   where r.tenant_id = new.tenant_id
     and r.work_item_id = new.id
     and r.resulting_work_item_revision = new.revision;
  select count(*) into v_collaborator_effect_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.effect_kind = 'collaborator_set'
     and effect_row.work_item_id = new.id
     and effect_row.resulting_work_item_revision = new.revision;

  if v_transition_count + v_relation_transition_count +
       v_collaborator_effect_count <> 1 then
    raise exception 'Each WorkItem +1 mutation requires exactly one lifecycle XOR servicing-team XOR collaborator-set proof'
      using errcode = '23514';
  end if;

  if v_transition_count = 1 then
    select * into strict v_transition
      from public.inbox_v2_work_item_transitions t
     where t.tenant_id = new.tenant_id
       and t.work_item_id = new.id
       and t.resulting_revision = new.revision;

    if v_transition.expected_revision <> old.revision
       or v_transition.resulting_revision <> new.revision
       or v_transition.from_state <> old.state
       or v_transition.to_state <> new.state
       or v_transition.source_queue_id <> old.queue_id
       or v_transition.source_queue_revision <> old.queue_revision
       or v_transition.destination_queue_id <> new.queue_id
       or v_transition.destination_queue_revision <> new.queue_revision
       or v_transition.occurred_at <> new.updated_at
       or v_transition.expected_servicing_team_relation_revision <>
          old.servicing_team_relation_revision
       or v_transition.resulting_servicing_team_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'WorkItem lifecycle proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;

    if v_transition.opened_primary_assignment_id is not null then
      if (
          v_transition.closed_primary_assignment_id is null
          and old.current_primary_assignment_id is not null
        )
        or (
          v_transition.closed_primary_assignment_id is not null
          and old.current_primary_assignment_id is distinct from
              v_transition.closed_primary_assignment_id
        )
        or new.current_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id
        or new.last_primary_assignment_id is distinct from
            v_transition.opened_primary_assignment_id then
        raise exception 'WorkItem assignment opening does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_primary_assignment_id is not null then
      if old.current_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id
         or new.current_primary_assignment_id is not null
         or new.last_primary_assignment_id is distinct from
           v_transition.closed_primary_assignment_id then
        raise exception 'WorkItem assignment closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_primary_assignment_id is distinct from
            old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
            old.last_primary_assignment_id then
      raise exception 'WorkItem transition without assignment effect changed assignment pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_transition.closed_servicing_team_episode_id is distinct from
           old.current_servicing_team_episode_id then
        raise exception 'Terminal WorkItem transition must close the exact OLD servicing-team head'
          using errcode = '23514';
      end if;
    elsif v_transition.closed_servicing_team_episode_id is not null then
      raise exception 'Non-terminal WorkItem transition cannot close a servicing-team episode'
        using errcode = '23514';
    end if;

    if v_transition.closed_servicing_team_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_transition.closed_servicing_team_episode_id;
      if old.current_servicing_team_id is distinct from v_previous_team_id
         or new.current_servicing_team_episode_id is not null
         or new.current_servicing_team_id is not null
         or new.last_servicing_team_episode_id is distinct from
            v_transition.closed_servicing_team_episode_id then
        raise exception 'Terminal WorkItem relation closure does not induce the exact OLD and NEW pointers'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is distinct from
            old.current_servicing_team_episode_id
       or new.current_servicing_team_id is distinct from
            old.current_servicing_team_id
       or new.last_servicing_team_episode_id is distinct from
            old.last_servicing_team_episode_id then
      raise exception 'Lifecycle transition without team closure changed servicing-team pointers'
        using errcode = '23514';
    end if;

    if v_transition.kind = 'priority_change' then
      if new.priority_id is not distinct from old.priority_id then
        raise exception 'Priority change cannot be a no-op'
          using errcode = '23514';
      end if;
    elsif new.priority_id is distinct from old.priority_id then
      raise exception 'Only priority_change may mutate WorkItem priority'
        using errcode = '23514';
    end if;

    select * into v_old_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = old.tenant_id
       and s.work_item_id = old.id
       and s.sla_cycle = old.sla_cycle
       and s.revision = old.sla_snapshot_revision;
    select * into v_new_sla
      from public.inbox_v2_work_item_sla_snapshots s
     where s.tenant_id = new.tenant_id
       and s.work_item_id = new.id
       and s.sla_cycle = new.sla_cycle
       and s.revision = new.sla_snapshot_revision;
    if v_old_sla.revision is null or v_new_sla.revision is null then
      raise exception 'WorkItem mutation must retain exact OLD and NEW SLA snapshots'
        using errcode = '23514';
    end if;
    if v_transition.kind = 'sla_refresh' then
      if new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_old_sla.kind <> 'tracked'
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.input_revision < v_old_sla.input_revision
         or (v_old_sla.first_human_response_at is not null and
           v_new_sla.first_human_response_at is distinct from
             v_old_sla.first_human_response_at) then
        raise exception 'SLA refresh must advance one tracked SLA snapshot revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind not in (
      'close_resolved',
      'close_dismissed',
      'reopen_unassigned',
      'reopen_assigned'
    ) and (
      new.sla_cycle <> old.sla_cycle
      or new.sla_snapshot_revision <> old.sla_snapshot_revision
    ) then
      raise exception 'This WorkItem transition cannot mutate SLA'
        using errcode = '23514';
    end if;
    if (
         new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision
       )
       and (
         v_new_sla.calculated_at <> new.updated_at
         or v_new_sla.created_at <> new.updated_at
       ) then
      raise exception 'New WorkItem SLA snapshot must be recorded at transition time'
        using errcode = '23514';
    end if;
    if v_transition.kind in ('close_resolved', 'close_dismissed') then
      if v_old_sla.kind = 'not_applied' then
        if new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision then
          raise exception 'Terminal close cannot synthesize an absent SLA'
            using errcode = '23514';
        end if;
      elsif new.sla_cycle <> old.sla_cycle
         or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
         or v_new_sla.kind <> 'tracked'
         or v_new_sla.policy_id <> v_old_sla.policy_id
         or v_new_sla.policy_version <> v_old_sla.policy_version
         or v_new_sla.policy_revision <> v_old_sla.policy_revision
         or v_new_sla.business_calendar_id <>
            v_old_sla.business_calendar_id
         or v_new_sla.business_calendar_version <>
            v_old_sla.business_calendar_version
         or v_new_sla.business_calendar_revision <>
            v_old_sla.business_calendar_revision
         or v_new_sla.time_zone <> v_old_sla.time_zone
         or v_new_sla.started_at <> v_old_sla.started_at
         or v_new_sla.clock_state <> 'stopped'
         or v_new_sla.stopped_at <> new.updated_at then
        raise exception 'Terminal close must append the exact stopped SLA revision'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.last_reopen_snapshot ->> 'slaMode' = 'new_cycle' then
        select * into v_destination_queue
          from public.inbox_v2_work_queue_versions q
         where q.tenant_id = v_transition.tenant_id
           and q.work_queue_id = v_transition.destination_queue_id
           and q.revision = v_transition.destination_queue_revision;
        if v_destination_queue.revision is null
           or new.sla_cycle <> old.sla_cycle + 1
           or new.sla_snapshot_revision <> 1
           or v_new_sla.kind <> v_destination_queue.default_sla_kind
           or (
             v_destination_queue.default_sla_kind = 'tracked'
             and (
               v_new_sla.policy_id <>
                  v_destination_queue.default_sla_policy_id
               or v_new_sla.policy_version <>
                  v_destination_queue.default_sla_policy_version
               or v_new_sla.policy_revision <>
                  v_destination_queue.default_sla_policy_revision
               or v_new_sla.input_revision <> 1
               or v_new_sla.business_calendar_id <>
                  v_destination_queue.default_business_calendar_id
               or v_new_sla.business_calendar_version <>
                  v_destination_queue.default_business_calendar_version
               or v_new_sla.business_calendar_revision <>
                  v_destination_queue.default_business_calendar_revision
               or v_new_sla.time_zone <>
                  v_destination_queue.default_sla_time_zone
               or v_new_sla.clock_state <> 'running'
               or v_new_sla.started_at <> new.updated_at
               or v_new_sla.paused_at is not null
               or v_new_sla.pause_condition_id is not null
               or v_new_sla.stopped_at is not null
               or v_new_sla.first_human_response_at is not null
             )
           ) then
          raise exception 'New-cycle reopen must reset SLA to exact destination Queue defaults'
            using errcode = '23514';
        end if;
      elsif new.last_reopen_snapshot ->> 'slaMode' = 'resume_remaining' then
        if v_old_sla.kind = 'not_applied' then
          if new.sla_cycle <> old.sla_cycle
             or new.sla_snapshot_revision <>
                old.sla_snapshot_revision then
            raise exception 'Resume cannot invent an SLA absent from the prior cycle'
              using errcode = '23514';
          end if;
        elsif new.sla_cycle <> old.sla_cycle
           or new.sla_snapshot_revision <> old.sla_snapshot_revision + 1
           or v_new_sla.kind <> 'tracked'
           or v_new_sla.policy_id <> v_old_sla.policy_id
           or v_new_sla.policy_version <> v_old_sla.policy_version
           or v_new_sla.policy_revision <> v_old_sla.policy_revision
           or v_new_sla.business_calendar_id <>
              v_old_sla.business_calendar_id
           or v_new_sla.business_calendar_version <>
              v_old_sla.business_calendar_version
           or v_new_sla.business_calendar_revision <>
              v_old_sla.business_calendar_revision
           or v_new_sla.time_zone <> v_old_sla.time_zone
           or v_new_sla.started_at <> v_old_sla.started_at
           or v_new_sla.clock_state = 'stopped' then
          raise exception 'Resume reopen must append one non-stopped SLA revision in the same cycle'
            using errcode = '23514';
        end if;
      else
        raise exception 'Reopen snapshot must select new_cycle or resume_remaining SLA mode'
          using errcode = '23514';
      end if;
    end if;
    if v_new_sla.kind = 'tracked' and (
      (new.state in ('resolved', 'dismissed') and
        v_new_sla.clock_state <> 'stopped')
      or (new.state in ('new', 'assigned', 'in_progress', 'waiting') and
        v_new_sla.clock_state = 'stopped')
    ) then
      raise exception 'Every WorkItem mutation must retain lifecycle-correct SLA clock state'
        using errcode = '23514';
    end if;

    if v_transition.kind in ('reopen_unassigned', 'reopen_assigned') then
      if new.reopen_cycle <> old.reopen_cycle + 1
         or new.last_reopen_snapshot is not distinct from
            old.last_reopen_snapshot
         or old.terminal_snapshot is null
         or new.terminal_snapshot is not null then
        raise exception 'Reopen must advance exact cycle and snapshot fields'
          using errcode = '23514';
      end if;
    elsif v_transition.kind in ('close_resolved', 'close_dismissed') then
      if new.reopen_cycle <> old.reopen_cycle
         or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
         or old.terminal_snapshot is not null
         or new.terminal_snapshot is null then
        raise exception 'Terminal close must preserve reopen history and append terminal snapshot'
          using errcode = '23514';
      end if;
    elsif new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Only terminal close or reopen may mutate lifecycle snapshots'
        using errcode = '23514';
    end if;

    if new.collaborator_set_revision <> old.collaborator_set_revision then
      raise exception 'Lifecycle transition cannot mutate collaborator-set revision'
        using errcode = '23514';
    end if;

    v_expected_access_revision := old.resource_access_revision;
    if new.current_primary_assignment_id is distinct from
         old.current_primary_assignment_id
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or old.state in ('resolved', 'dismissed')
       or new.state in ('resolved', 'dismissed') then
      v_expected_access_revision := v_expected_access_revision + 1;
    end if;
    if new.resource_access_revision <> v_expected_access_revision then
      raise exception 'WorkItem mutation has an invalid resource-access revision step'
        using errcode = '23514';
    end if;
  elsif v_relation_transition_count = 1 then
    select * into strict v_relation
      from public.inbox_v2_work_item_relation_transitions r
     where r.tenant_id = new.tenant_id
       and r.work_item_id = new.id
       and r.resulting_work_item_revision = new.revision;

    if v_relation.expected_work_item_revision <> old.revision
       or v_relation.resulting_work_item_revision <> new.revision
       or v_relation.occurred_at <> new.updated_at
       or v_relation.expected_relation_revision <>
          old.servicing_team_relation_revision
       or v_relation.resulting_relation_revision <>
          new.servicing_team_relation_revision then
      raise exception 'Servicing-team relation proof does not bind the exact OLD and NEW heads'
        using errcode = '23514';
    end if;
    if old.state in ('resolved', 'dismissed')
       or new.state <> old.state
       or new.queue_id <> old.queue_id
       or new.queue_revision <> old.queue_revision
       or new.priority_id <> old.priority_id
       or new.sla_cycle <> old.sla_cycle
       or new.sla_snapshot_revision <> old.sla_snapshot_revision
       or new.current_primary_assignment_id is distinct from
          old.current_primary_assignment_id
       or new.last_primary_assignment_id is distinct from
          old.last_primary_assignment_id
       or new.collaborator_set_revision <> old.collaborator_set_revision
       or new.reopen_cycle <> old.reopen_cycle
       or new.last_reopen_snapshot is distinct from old.last_reopen_snapshot
       or new.terminal_snapshot is distinct from old.terminal_snapshot then
      raise exception 'Servicing-team relation command mutated an unrelated WorkItem field'
        using errcode = '23514';
    end if;
    if new.resource_access_revision <> old.resource_access_revision + 1 then
      raise exception 'Servicing-team relation command must advance resource access once'
        using errcode = '23514';
    end if;

    if v_relation.previous_episode_id is not null then
      select e.team_id into strict v_previous_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.previous_episode_id;
      if old.current_servicing_team_episode_id is distinct from
           v_relation.previous_episode_id
         or old.current_servicing_team_id is distinct from
           v_previous_team_id then
        raise exception 'Servicing-team relation command did not close the exact OLD head'
          using errcode = '23514';
      end if;
    elsif old.current_servicing_team_episode_id is not null
       or old.current_servicing_team_id is not null then
      raise exception 'Servicing-team add requires an empty OLD relation head'
        using errcode = '23514';
    end if;

    if v_relation.next_episode_id is not null then
      select e.team_id into strict v_next_team_id
        from public.inbox_v2_work_item_servicing_team_episodes e
       where e.tenant_id = new.tenant_id
         and e.work_item_id = new.id
         and e.id = v_relation.next_episode_id;
      if new.current_servicing_team_episode_id is distinct from
           v_relation.next_episode_id
         or new.current_servicing_team_id is distinct from v_next_team_id
         or new.last_servicing_team_episode_id is distinct from
           v_relation.next_episode_id then
        raise exception 'Servicing-team relation command did not open the exact NEW head'
          using errcode = '23514';
      end if;
    elsif new.current_servicing_team_episode_id is not null
       or new.current_servicing_team_id is not null
       or new.last_servicing_team_episode_id is distinct from
          v_relation.previous_episode_id then
      raise exception 'Servicing-team removal did not induce the exact NEW head'
        using errcode = '23514';
    end if;
  else
    select * into strict v_collaborator_effect
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.effect_kind = 'collaborator_set'
       and effect_row.work_item_id = new.id
       and effect_row.resulting_work_item_revision = new.revision;

    if v_collaborator_effect.before_revision <>
         old.collaborator_set_revision
       or v_collaborator_effect.after_revision <>
         new.collaborator_set_revision
       or v_collaborator_effect.expected_work_item_revision <> old.revision
       or v_collaborator_effect.resulting_work_item_revision <> new.revision
       or v_collaborator_effect.work_item_cycle <> new.reopen_cycle
       or v_collaborator_effect.created_at <> new.updated_at
       or new.collaborator_set_revision <>
         old.collaborator_set_revision + 1
       or (to_jsonb(new) - array[
         'revision', 'updated_at', 'collaborator_set_revision'
       ]::text[]) is distinct from (to_jsonb(old) - array[
         'revision', 'updated_at', 'collaborator_set_revision'
       ]::text[]) then
      raise exception 'Collaborator-set proof does not bind the exact OLD and NEW WorkItem heads'
        using errcode = '23514';
    end if;
  end if;

  return null;
end
$function$;
--> statement-breakpoint
create or replace function public.inbox_v2_auth_reject_immutable()
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
  raise exception using
    errcode = '23514',
    message = format('inbox_v2.authorization_immutable:%s:%s', tg_table_name, tg_op);
end;
$function$;

create or replace function public.inbox_v2_auth_json_tenant_safe(
  checked_value jsonb,
  checked_tenant_id text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select checked_value is null or not exists (
    select 1
      from jsonb_path_query(checked_value, '$.**.tenantId') tenant_ref
     where jsonb_typeof(tenant_ref) <> 'string'
        or tenant_ref #>> '{}' is distinct from checked_tenant_id
  );
$function$;

create or replace function public.inbox_v2_auth_catalog_id_safe(
  checked_value text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(char_length(checked_value) <= 256 and (
    (
      checked_value ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(checked_value, ':', 2)) <= 160
    ) or (
      checked_value ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part(checked_value, ':', 2)) <= 80
      and char_length(split_part(checked_value, ':', 3)) <= 160
      and split_part(checked_value, ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ), false);
$function$;

create or replace function public.inbox_v2_auth_payload_reference_safe(
  checked_value jsonb,
  checked_tenant_id text
)
returns boolean
language sql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
  select checked_value is null or (
    jsonb_typeof(checked_value) = 'object'
    and checked_value ?&
      array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]
    and (checked_value -
      array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =
        '{}'::jsonb
    and jsonb_typeof(checked_value->'tenantId') = 'string'
    and checked_value->>'tenantId' = checked_tenant_id
    and jsonb_typeof(checked_value->'recordId') = 'string'
    and char_length(checked_value->>'recordId') between 1 and 512
    and checked_value->>'recordId' ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
    and jsonb_typeof(checked_value->'schemaId') = 'string'
    and public.inbox_v2_auth_catalog_id_safe(checked_value->>'schemaId')
    and jsonb_typeof(checked_value->'schemaVersion') = 'string'
    and char_length(checked_value->>'schemaVersion') between 1 and 64
    and checked_value->>'schemaVersion' ~
      '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
    and jsonb_typeof(checked_value->'digest') = 'string'
    and checked_value->>'digest' ~ '^sha256:[0-9a-f]{64}$'
  );
$function$;

create or replace function public.inbox_v2_auth_invalidations_safe(
  checked_value jsonb,
  checked_tenant_id text,
  checked_max integer
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  invalidation jsonb;
begin
  if jsonb_typeof(checked_value) <> 'array' then
    return false;
  end if;
  if checked_max is null or checked_max < 1
     or jsonb_array_length(checked_value) not between 1 and checked_max
     or not public.inbox_v2_auth_json_tenant_safe(
       checked_value, checked_tenant_id
     ) then
    return false;
  end if;
  for invalidation in select value from jsonb_array_elements(checked_value)
  loop
    if jsonb_typeof(invalidation) <> 'object' then
      return false;
    end if;
    case invalidation->>'kind'
      when 'recipient_scope' then
        if (invalidation - array['kind']::text[]) <> '{}'::jsonb then
          return false;
        end if;
      when 'projection' then
        if not (invalidation ?& array['kind', 'projectionId']::text[])
           or (invalidation - array['kind', 'projectionId']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'projectionId') <> 'string'
           or char_length(invalidation->>'projectionId') not between 1 and 512
           or invalidation->>'projectionId' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      when 'conversation' then
        if not (invalidation ?& array['kind', 'conversation']::text[])
           or (invalidation - array['kind', 'conversation']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'conversation') <> 'object'
           or not (invalidation->'conversation' ?&
             array['tenantId', 'kind', 'id']::text[])
           or ((invalidation->'conversation') -
             array['tenantId', 'kind', 'id']::text[]) <> '{}'::jsonb
           or jsonb_typeof(
             invalidation->'conversation'->'tenantId'
           ) <> 'string'
           or invalidation->'conversation'->>'tenantId' <>
             checked_tenant_id
           or jsonb_typeof(
             invalidation->'conversation'->'kind'
           ) <> 'string'
           or invalidation->'conversation'->>'kind' <> 'conversation'
           or jsonb_typeof(invalidation->'conversation'->'id') <> 'string'
           or char_length(invalidation->'conversation'->>'id')
             not between 1 and 256
           or invalidation->'conversation'->>'id' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      when 'entity' then
        if not (invalidation ?& array['kind', 'entity']::text[])
           or (invalidation - array['kind', 'entity']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'entity') <> 'object'
           or not (invalidation->'entity' ?&
             array['tenantId', 'entityTypeId', 'entityId']::text[])
           or ((invalidation->'entity') -
             array['tenantId', 'entityTypeId', 'entityId']::text[]) <> '{}'::jsonb
           or jsonb_typeof(invalidation->'entity'->'tenantId') <> 'string'
           or invalidation->'entity'->>'tenantId' <> checked_tenant_id
           or jsonb_typeof(
             invalidation->'entity'->'entityTypeId'
           ) <> 'string'
           or not public.inbox_v2_auth_catalog_id_safe(
             invalidation->'entity'->>'entityTypeId'
           )
           or jsonb_typeof(invalidation->'entity'->'entityId') <> 'string'
           or char_length(invalidation->'entity'->>'entityId')
             not between 1 and 512
           or invalidation->'entity'->>'entityId' !~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$' then
          return false;
        end if;
      else
        return false;
    end case;
  end loop;
  return true;
end;
$function$;

create or replace function public.inbox_v2_auth_decision_refs_safe(
  checked_value jsonb,
  checked_tenant_id text,
  checked_at timestamptz,
  require_allowed boolean
)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  decision_ref jsonb;
begin
  if jsonb_typeof(checked_value) <> 'array' then
    return false;
  end if;
  if jsonb_array_length(checked_value) not between 1 and 64
     or not public.inbox_v2_auth_json_tenant_safe(
       checked_value, checked_tenant_id
     ) then
    return false;
  end if;
  if (
    select count(*) <> count(distinct decision_value->>'id')
      from jsonb_array_elements(checked_value)
        as decision_rows(decision_value)
  ) then
    return false;
  end if;

  for decision_ref in select value from jsonb_array_elements(checked_value)
  loop
    if jsonb_typeof(decision_ref) <> 'object'
       or not (decision_ref ?& array[
         'tenantId', 'id', 'authorizationEpoch', 'principal',
         'permissionId', 'resourceScopeId', 'resource',
         'resourceAccessRevision', 'decisionRevision', 'decisionHash',
         'outcome', 'decidedAt', 'notAfter'
       ]::text[])
       or (decision_ref - array[
         'tenantId', 'id', 'authorizationEpoch', 'principal',
         'permissionId', 'resourceScopeId', 'resource',
         'resourceAccessRevision', 'decisionRevision', 'decisionHash',
         'outcome', 'decidedAt', 'notAfter'
       ]::text[]) <> '{}'::jsonb
       or decision_ref->>'tenantId' <> checked_tenant_id
       or jsonb_typeof(decision_ref->'id') <> 'string'
       or char_length(decision_ref->>'id') not between 1 and 512
       or decision_ref->>'id' !~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(decision_ref->'authorizationEpoch') <> 'string'
       or char_length(decision_ref->>'authorizationEpoch') not between 8 and 1024
       or jsonb_typeof(decision_ref->'permissionId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->>'permissionId'
       )
       or jsonb_typeof(decision_ref->'resourceScopeId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->>'resourceScopeId'
       )
       or jsonb_typeof(decision_ref->'principal') <> 'object'
       or jsonb_typeof(decision_ref->'resource') <> 'object'
       or not (
         (
           decision_ref->'principal'->>'kind' = 'employee'
           and decision_ref->'principal' ?& array['kind', 'employee']::text[]
           and ((decision_ref->'principal') -
             array['kind', 'employee']::text[]) =
             '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'employee'
           ) = 'object'
           and decision_ref->'principal'->'employee' ?&
             array['tenantId', 'kind', 'id']::text[]
           and ((decision_ref->'principal'->'employee') -
             array['tenantId', 'kind', 'id']::text[]) = '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'tenantId'
           ) = 'string'
           and decision_ref->'principal'->'employee'->>'tenantId' =
             checked_tenant_id
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'kind'
           ) = 'string'
           and decision_ref->'principal'->'employee'->>'kind' = 'employee'
           and jsonb_typeof(
             decision_ref->'principal'->'employee'->'id'
           ) = 'string'
           and char_length(
             decision_ref->'principal'->'employee'->>'id'
           ) between 1 and 256
           and decision_ref->'principal'->'employee'->>'id' ~
             '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
         ) or (
           decision_ref->'principal'->>'kind' = 'trusted_service'
           and decision_ref->'principal' ?&
             array['kind', 'trustedServiceId']::text[]
           and ((decision_ref->'principal') -
             array['kind', 'trustedServiceId']::text[]) = '{}'::jsonb
           and jsonb_typeof(
             decision_ref->'principal'->'trustedServiceId'
           ) = 'string'
           and public.inbox_v2_auth_catalog_id_safe(
             decision_ref->'principal'->>'trustedServiceId'
           )
         )
       )
       or not (decision_ref->'resource' ?&
         array['tenantId', 'entityTypeId', 'entityId']::text[])
       or jsonb_typeof(decision_ref->'resource'->'tenantId') <> 'string'
       or decision_ref->'resource'->>'tenantId' <> checked_tenant_id
       or ((decision_ref->'resource') -
         array['tenantId', 'entityTypeId', 'entityId']::text[]) <> '{}'::jsonb
       or jsonb_typeof(decision_ref->'resource'->'entityTypeId') <> 'string'
       or not public.inbox_v2_auth_catalog_id_safe(
         decision_ref->'resource'->>'entityTypeId'
       )
       or jsonb_typeof(decision_ref->'resource'->'entityId') <> 'string'
       or char_length(decision_ref->'resource'->>'entityId') not between 1 and 512
       or decision_ref->'resource'->>'entityId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(decision_ref->'resourceAccessRevision') <> 'string'
       or decision_ref->>'resourceAccessRevision' !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(decision_ref->'decisionRevision') <> 'string'
       or decision_ref->>'decisionRevision' !~ '^[1-9][0-9]{0,18}$'
       or jsonb_typeof(decision_ref->'decisionHash') <> 'string'
       or decision_ref->>'decisionHash' !~ '^sha256:[0-9a-f]{64}$'
       or jsonb_typeof(decision_ref->'outcome') <> 'string'
       or decision_ref->>'outcome' not in ('allowed', 'denied')
       or jsonb_typeof(decision_ref->'decidedAt') <> 'string'
       or jsonb_typeof(decision_ref->'notAfter') <> 'string'
       or (require_allowed and decision_ref->>'outcome' <> 'allowed') then
      return false;
    end if;
    begin
      if (decision_ref->>'resourceAccessRevision')::numeric >
           9223372036854775807
         or (decision_ref->>'decisionRevision')::numeric >
           9223372036854775807
         or not isfinite((decision_ref->>'decidedAt')::timestamptz)
         or not isfinite((decision_ref->>'notAfter')::timestamptz)
         or (decision_ref->>'decidedAt')::timestamptz > checked_at
         or checked_at >= (decision_ref->>'notAfter')::timestamptz then
        return false;
      end if;
    exception when others then
      return false;
    end;
  end loop;
  return true;
end;
$function$;

create or replace function public.inbox_v2_auth_audit_identifier_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_invalid boolean;
begin
  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.matched_permission_ids) with ordinality
            identifier_row(identifier, ordinal)
     ) checked
     where checked.identifier is null
        or not public.inbox_v2_auth_catalog_id_safe(checked.identifier)
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_permission_ids_invalid';
  end if;

  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.scope_ids) with ordinality
            identifier_row(identifier, ordinal)
     ) checked
     where checked.identifier is null
        or not public.inbox_v2_auth_catalog_id_safe(checked.identifier)
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_scope_ids_invalid';
  end if;

  select exists (
    select 1
      from (
        select identifier,
               lag(identifier) over (order by ordinal) as previous_identifier
          from unnest(new.grant_source_ids) with ordinality
            identifier_row(identifier, ordinal)
      ) checked
     where checked.identifier is null
        or checked.identifier !~ '^internal-ref:[a-f0-9]{32,64}$'
        or (checked.previous_identifier is not null and
            checked.previous_identifier collate "C" >=
              checked.identifier collate "C")
  ) into v_invalid;
  if v_invalid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_audit_grant_refs_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_relation_version_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_current_revision bigint;
  v_head_found boolean := false;
  v_previous jsonb;
  v_incoming jsonb := to_jsonb(new);
  v_identity_matches boolean := true;
  v_temporal boolean := false;
begin
  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_role_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.role_id = new.role_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_role_binding_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_role_binding_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.binding_id = new.binding_id
       for update;
      v_head_found := found;
      perform 1
        from public.inbox_v2_auth_role_heads role_head
       where role_head.tenant_id = new.tenant_id
         and role_head.role_id = new.role_id
         and role_head.current_revision = new.role_revision_observed
       for share;
      if not found then
        raise exception using errcode = '40001',
          message = 'inbox_v2.authorization_role_observation_stale';
      end if;
    when 'inbox_v2_auth_direct_grant_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_direct_grant_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.grant_id = new.grant_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_workforce_membership_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_workforce_membership_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.membership_id = new.membership_id
       for update;
      v_head_found := found;
    when 'inbox_v2_auth_structural_access_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_structural_access_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.binding_id = new.binding_id
       for update;
      v_head_found := found;
      perform 1
        from public.inbox_v2_auth_resource_heads resource_head
       where resource_head.tenant_id = new.tenant_id
         and resource_head.id = new.resource_head_id
         and row(
           resource_head.resource_kind,
           resource_head.conversation_id,
           resource_head.client_id,
           resource_head.source_account_id
         ) is not distinct from row(
           new.resource_kind,
           new.conversation_id,
           new.client_id,
           new.source_account_id
         )
       for share;
      if not found then
        raise exception using errcode = '23514',
          message = 'inbox_v2.authorization_structural_resource_mismatch';
      end if;
    when 'inbox_v2_auth_collaborator_versions' then
      v_temporal := true;
      select head_row.current_revision into v_current_revision
        from public.inbox_v2_auth_collaborator_heads head_row
       where head_row.tenant_id = new.tenant_id
         and head_row.collaborator_id = new.collaborator_id
       for update;
      v_head_found := found;
    else
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_version_guard_table_invalid';
  end case;

  if new.revision = 1 then
    if v_head_found then
      raise exception using errcode = '40001',
        message = 'inbox_v2.authorization_version_cas_conflict';
    end if;
  elsif not v_head_found or v_current_revision <> new.revision - 1 then
    raise exception using errcode = '40001',
      message = 'inbox_v2.authorization_version_cas_conflict';
  end if;

  if not v_head_found then
    if v_temporal and v_incoming->>'state' <> 'active' then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_initial_relation_state_invalid';
    end if;
    return new;
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_role_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.role_id = new.role_id
         and version_row.revision = v_current_revision;
    when 'inbox_v2_auth_role_binding_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_role_binding_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'role_id',
        v_previous->'subject_kind',
        v_previous->'subject_employee_id',
        v_previous->'subject_team_id',
        v_previous->'subject_org_unit_id',
        v_previous->'subject_work_queue_id',
        v_previous->'scope_kind',
        v_previous->'scope_org_unit_mode',
        v_previous->'scope_org_unit_id',
        v_previous->'scope_team_id',
        v_previous->'scope_work_queue_id',
        v_previous->'scope_client_id',
        v_previous->'scope_conversation_id',
        v_previous->'scope_work_item_id',
        v_previous->'scope_source_account_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'role_id',
        v_incoming->'subject_kind',
        v_incoming->'subject_employee_id',
        v_incoming->'subject_team_id',
        v_incoming->'subject_org_unit_id',
        v_incoming->'subject_work_queue_id',
        v_incoming->'scope_kind',
        v_incoming->'scope_org_unit_mode',
        v_incoming->'scope_org_unit_id',
        v_incoming->'scope_team_id',
        v_incoming->'scope_work_queue_id',
        v_incoming->'scope_client_id',
        v_incoming->'scope_conversation_id',
        v_incoming->'scope_work_item_id',
        v_incoming->'scope_source_account_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_direct_grant_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_direct_grant_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.grant_id = new.grant_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'employee_id',
        v_previous->'catalog_schema_id',
        v_previous->'catalog_schema_version',
        v_previous->'catalog_digest_sha256',
        v_previous->'permission_id',
        v_previous->'scope_kind',
        v_previous->'scope_org_unit_mode',
        v_previous->'scope_org_unit_id',
        v_previous->'scope_team_id',
        v_previous->'scope_work_queue_id',
        v_previous->'scope_client_id',
        v_previous->'scope_conversation_id',
        v_previous->'scope_work_item_id',
        v_previous->'scope_source_account_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'employee_id',
        v_incoming->'catalog_schema_id',
        v_incoming->'catalog_schema_version',
        v_incoming->'catalog_digest_sha256',
        v_incoming->'permission_id',
        v_incoming->'scope_kind',
        v_incoming->'scope_org_unit_mode',
        v_incoming->'scope_org_unit_id',
        v_incoming->'scope_team_id',
        v_incoming->'scope_work_queue_id',
        v_incoming->'scope_client_id',
        v_incoming->'scope_conversation_id',
        v_incoming->'scope_work_item_id',
        v_incoming->'scope_source_account_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_workforce_membership_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_workforce_membership_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.membership_id = new.membership_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'employee_id',
        v_previous->'membership_kind',
        v_previous->'org_unit_id',
        v_previous->'team_id',
        v_previous->'work_queue_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'employee_id',
        v_incoming->'membership_kind',
        v_incoming->'org_unit_id',
        v_incoming->'team_id',
        v_incoming->'work_queue_id',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_structural_access_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_structural_access_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'resource_head_id',
        v_previous->'resource_kind',
        v_previous->'conversation_id',
        v_previous->'client_id',
        v_previous->'source_account_id',
        v_previous->'target_kind',
        v_previous->'target_org_unit_id',
        v_previous->'target_team_id',
        v_previous->'policy_id',
        v_previous->'policy_revision',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'resource_head_id',
        v_incoming->'resource_kind',
        v_incoming->'conversation_id',
        v_incoming->'client_id',
        v_incoming->'source_account_id',
        v_incoming->'target_kind',
        v_incoming->'target_org_unit_id',
        v_incoming->'target_team_id',
        v_incoming->'policy_id',
        v_incoming->'policy_revision',
        v_incoming->'valid_from'
      );
    when 'inbox_v2_auth_collaborator_versions' then
      select to_jsonb(version_row) into strict v_previous
        from public.inbox_v2_auth_collaborator_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.collaborator_id = new.collaborator_id
         and version_row.revision = v_current_revision;
      v_identity_matches := jsonb_build_array(
        v_previous->'resource_kind',
        v_previous->'conversation_id',
        v_previous->'work_item_id',
        v_previous->'work_item_cycle',
        v_previous->'employee_id',
        v_previous->'valid_from'
      ) = jsonb_build_array(
        v_incoming->'resource_kind',
        v_incoming->'conversation_id',
        v_incoming->'work_item_id',
        v_incoming->'work_item_cycle',
        v_incoming->'employee_id',
        v_incoming->'valid_from'
      );
  end case;

  if (v_incoming->>'occurred_at')::timestamptz <
     (v_previous->>'occurred_at')::timestamptz then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_version_time_regression';
  end if;

  if v_temporal then
    if not v_identity_matches then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_identity_morph';
    end if;
    if v_previous->>'state' <> 'active'
       or v_incoming->>'state' not in ('revoked', 'archived') then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_state_transition_invalid';
    end if;
    if v_incoming->>'valid_until' is distinct from
       v_previous->>'valid_until' then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_interval_morph';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_version_matches boolean := true;
begin
  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    case tg_table_name
      when 'inbox_v2_auth_tenant_heads' then
        if new.revision <> 1 or new.tenant_rbac_revision <> 1
           or new.shared_access_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      when 'inbox_v2_auth_employee_heads' then
        if new.revision <> 1 or new.employee_access_revision <> 1
           or new.employee_inbox_relation_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      when 'inbox_v2_auth_resource_heads' then
        if new.revision <> 1 or new.resource_access_revision <> 1
           or new.structural_relation_revision <> 1
           or new.collaborator_set_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
      else
        if new.current_revision <> 1 then
          raise exception using errcode = '23514',
            message = 'inbox_v2.authorization_head_initial_revision_invalid';
        end if;
    end case;
  elsif new.tenant_id is distinct from old.tenant_id
     or new.created_at is distinct from old.created_at
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_identity_invalid';
  elsif tg_table_name = 'inbox_v2_auth_tenant_heads' then
    if new.revision <> old.revision + 1
       or new.tenant_rbac_revision not in (
         old.tenant_rbac_revision, old.tenant_rbac_revision + 1
       )
       or new.shared_access_revision not in (
         old.shared_access_revision, old.shared_access_revision + 1
       )
       or (new.tenant_rbac_revision - old.tenant_rbac_revision) +
          (new.shared_access_revision - old.shared_access_revision) <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_tenant_head_invalid_advance';
    end if;
  elsif tg_table_name = 'inbox_v2_auth_employee_heads' then
    if new.employee_id is distinct from old.employee_id
       or new.revision <> old.revision + 1
       or new.employee_access_revision not in (
         old.employee_access_revision, old.employee_access_revision + 1
       )
       or new.employee_inbox_relation_revision not in (
         old.employee_inbox_relation_revision,
         old.employee_inbox_relation_revision + 1
       )
       or (new.employee_access_revision - old.employee_access_revision) +
          (new.employee_inbox_relation_revision -
            old.employee_inbox_relation_revision) <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_head_invalid_advance';
    end if;
  elsif tg_table_name = 'inbox_v2_auth_resource_heads' then
    if row(new.id, new.resource_kind, new.conversation_id, new.client_id,
           new.source_account_id) is distinct from
       row(old.id, old.resource_kind, old.conversation_id, old.client_id,
           old.source_account_id)
       or new.revision <> old.revision + 1
       or not (
         (new.resource_access_revision = old.resource_access_revision + 1
          and new.structural_relation_revision =
            old.structural_relation_revision + 1
          and new.collaborator_set_revision = old.collaborator_set_revision)
         or
         (new.resource_kind = 'conversation'
          and new.resource_access_revision = old.resource_access_revision
          and new.structural_relation_revision = old.structural_relation_revision
          and new.collaborator_set_revision =
            old.collaborator_set_revision + 1)
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_resource_head_invalid_advance';
    end if;
  else
    if new.current_revision <> old.current_revision + 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_head_invalid_advance';
    end if;
    case tg_table_name
      when 'inbox_v2_auth_role_heads' then
        if new.role_id is distinct from old.role_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_role_binding_heads' then
        if new.binding_id is distinct from old.binding_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_direct_grant_heads' then
        if new.grant_id is distinct from old.grant_id then v_version_matches := false; end if;
      when 'inbox_v2_auth_workforce_membership_heads' then
        if row(new.membership_id, new.employee_id, new.membership_kind,
               new.org_unit_id, new.team_id, new.work_queue_id) is distinct from
           row(old.membership_id, old.employee_id, old.membership_kind,
               old.org_unit_id, old.team_id, old.work_queue_id) then
          v_version_matches := false;
        end if;
      when 'inbox_v2_auth_structural_access_heads' then
        if row(new.binding_id, new.resource_head_id, new.resource_kind,
               new.conversation_id, new.client_id, new.source_account_id,
               new.target_kind, new.target_org_unit_id, new.target_team_id)
             is distinct from
           row(old.binding_id, old.resource_head_id, old.resource_kind,
               old.conversation_id, old.client_id, old.source_account_id,
               old.target_kind, old.target_org_unit_id, old.target_team_id) then
          v_version_matches := false;
        end if;
      when 'inbox_v2_auth_collaborator_heads' then
        if row(new.collaborator_id, new.resource_kind, new.conversation_id,
               new.work_item_id, new.work_item_cycle, new.employee_id)
             is distinct from
           row(old.collaborator_id, old.resource_kind, old.conversation_id,
               old.work_item_id, old.work_item_cycle, old.employee_id) then
          v_version_matches := false;
        end if;
      else
        v_version_matches := false;
    end case;
    if not v_version_matches then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_relation_head_identity_invalid';
    end if;
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_role_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.role_id = new.role_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_role_binding_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_role_binding_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.binding_id = new.binding_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_direct_grant_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_direct_grant_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.grant_id = new.grant_id
           and version_row.revision = new.current_revision
           and version_row.occurred_at = new.updated_at
      ) into v_version_matches;
    when 'inbox_v2_auth_workforce_membership_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_workforce_membership_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.membership_id = new.membership_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.employee_id, version_row.membership_kind,
                   version_row.org_unit_id, version_row.team_id,
                   version_row.work_queue_id) is not distinct from
               row(new.employee_id, new.membership_kind, new.org_unit_id,
                   new.team_id, new.work_queue_id)
      ) into v_version_matches;
    when 'inbox_v2_auth_structural_access_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_structural_access_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.binding_id = new.binding_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.resource_head_id, version_row.resource_kind,
                   version_row.conversation_id, version_row.client_id,
                   version_row.source_account_id, version_row.target_kind,
                   version_row.target_org_unit_id, version_row.target_team_id)
             is not distinct from
               row(new.resource_head_id, new.resource_kind,
                   new.conversation_id, new.client_id, new.source_account_id,
                   new.target_kind, new.target_org_unit_id, new.target_team_id)
      ) into v_version_matches;
    when 'inbox_v2_auth_collaborator_heads' then
      select exists (
        select 1 from public.inbox_v2_auth_collaborator_versions version_row
         where version_row.tenant_id = new.tenant_id
           and version_row.collaborator_id = new.collaborator_id
           and version_row.revision = new.current_revision
           and version_row.state = new.current_state
           and version_row.occurred_at = new.updated_at
           and row(version_row.resource_kind, version_row.conversation_id,
                   version_row.work_item_id, version_row.work_item_cycle,
                   version_row.employee_id) is not distinct from
               row(new.resource_kind, new.conversation_id, new.work_item_id,
                   new.work_item_cycle, new.employee_id)
      ) into v_version_matches;
    else
      v_version_matches := true;
  end case;
  if not v_version_matches then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_version_mismatch';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_command_guard()
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
      message = 'inbox_v2.authorization_command_delete_forbidden';
  end if;
  if tg_op = 'INSERT' then
    if new.state <> 'pending' or new.mutation_id is not null
       or new.revision <> 1 or new.updated_at <> new.created_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_command_initial_state_invalid';
    end if;
    return new;
  end if;
  if old.state <> 'pending' or new.state <> 'completed'
     or old.mutation_id is not null or new.mutation_id is null
     or new.revision <> old.revision + 1
     or row(new.tenant_id, new.id, new.client_mutation_id,
            new.command_type_id, new.first_request_id, new.request_hash,
            new.actor_kind,
            new.actor_employee_id, new.actor_trusted_service_id,
            new.authorization_decision_id,
            new.authorization_epoch, new.authorization_decision_refs,
            new.authorized_at, new.authorization_not_after,
            new.occurred_at, new.created_at)
        is distinct from
        row(old.tenant_id, old.id, old.client_mutation_id,
            old.command_type_id, old.first_request_id, old.request_hash,
            old.actor_kind,
            old.actor_employee_id, old.actor_trusted_service_id,
            old.authorization_decision_id,
            old.authorization_epoch, old.authorization_decision_refs,
            old.authorized_at, old.authorization_not_after,
            old.occurred_at, old.created_at)
     or new.updated_at < old.updated_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_command_invalid_completion';
  end if;
  return new;
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
     or new.last_position <> old.last_position + 1
     or new.min_retained_position <> old.min_retained_position
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception using errcode = '40001',
      message = 'inbox_v2.tenant_stream_head_cas_conflict';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_auth_role_permission_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_role_id text;
  v_role_revision bigint;
  v_expected_count integer;
  v_expected_digest text;
  v_actual_count integer;
  v_min_ordinal integer;
  v_max_ordinal integer;
  v_sorted_contiguous boolean;
  v_actual_digest text;
begin
  v_tenant_id := coalesce(to_jsonb(new)->>'tenant_id', to_jsonb(old)->>'tenant_id');
  v_role_id := coalesce(to_jsonb(new)->>'role_id', to_jsonb(old)->>'role_id');
  v_role_revision := coalesce(
    (to_jsonb(new)->>'role_revision')::bigint,
    (to_jsonb(new)->>'revision')::bigint,
    (to_jsonb(old)->>'role_revision')::bigint,
    (to_jsonb(old)->>'revision')::bigint
  );

  select version_row.permission_count,
         version_row.permission_set_digest_sha256
    into v_expected_count, v_expected_digest
    from public.inbox_v2_auth_role_versions version_row
   where version_row.tenant_id = v_tenant_id
     and version_row.role_id = v_role_id
     and version_row.revision = v_role_revision;
  if not found then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = v_tenant_id
    ) then return null; end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_role_permission_version_missing';
  end if;

  select count(*)::integer,
         min(permission_row.ordinal)::integer,
         max(permission_row.ordinal)::integer,
         coalesce(bool_and(permission_row.ordinal = permission_row.sorted_ordinal), false),
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           permission_row.ordinal::text || ':' ||
           octet_length(permission_row.permission_id)::text || ':' ||
           permission_row.permission_id,
           chr(10) order by permission_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_actual_count, v_min_ordinal, v_max_ordinal,
         v_sorted_contiguous, v_actual_digest
    from (
      select permission_row.*,
             row_number() over (order by permission_row.permission_id)::integer
               as sorted_ordinal
        from public.inbox_v2_auth_role_version_permissions permission_row
       where permission_row.tenant_id = v_tenant_id
         and permission_row.role_id = v_role_id
         and permission_row.role_revision = v_role_revision
    ) permission_row;

  if v_actual_count <> v_expected_count
     or v_min_ordinal <> 1
     or v_max_ordinal <> v_expected_count
     or not v_sorted_contiguous
     or v_actual_digest <> v_expected_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_role_permission_manifest_incomplete';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_head_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean := false;
begin
  if tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_tenant_heads' then
    if new.tenant_rbac_revision = old.tenant_rbac_revision + 1 then
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'tenant_rbac'
           and effect_row.before_revision = old.tenant_rbac_revision
           and effect_row.after_revision = new.tenant_rbac_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    else
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'shared_access'
           and effect_row.before_revision = old.shared_access_revision
           and effect_row.after_revision = new.shared_access_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    end if;
  elsif tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_employee_heads' then
    select exists (
      select 1 from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.employee_id = new.employee_id
         and effect_row.effect_kind = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then 'employee_access'::public.inbox_v2_auth_revision_effect_kind
           else 'employee_inbox_relation'::public.inbox_v2_auth_revision_effect_kind
         end
         and effect_row.before_revision = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then old.employee_access_revision
           else old.employee_inbox_relation_revision
         end
         and effect_row.after_revision = case
           when new.employee_access_revision = old.employee_access_revision + 1
             then new.employee_access_revision
           else new.employee_inbox_relation_revision
         end
         and effect_row.created_at = new.updated_at
    ) into v_closed;
  elsif tg_op = 'UPDATE' and tg_table_name = 'inbox_v2_auth_resource_heads' then
    if new.resource_access_revision = old.resource_access_revision + 1 then
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'resource_access'
           and effect_row.resource_head_id = new.id
           and effect_row.before_revision = old.resource_access_revision
           and effect_row.after_revision = new.resource_access_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    else
      select exists (
        select 1 from public.inbox_v2_auth_revision_effects effect_row
         where effect_row.tenant_id = new.tenant_id
           and effect_row.effect_kind = 'collaborator_set'
           and effect_row.resource_head_id = new.id
           and effect_row.before_revision = old.collaborator_set_revision
           and effect_row.after_revision = new.collaborator_set_revision
           and effect_row.created_at = new.updated_at
      ) into v_closed;
    end if;
  elsif tg_table_name = 'inbox_v2_auth_role_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_role_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'role'
         and write_row.role_id = version_row.role_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.role_id = new.role_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_role_binding_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_role_binding_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'role_binding'
         and write_row.role_binding_id = version_row.binding_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_direct_grant_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_direct_grant_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'direct_grant'
         and write_row.direct_grant_id = version_row.grant_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.grant_id = new.grant_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_workforce_membership_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_workforce_membership_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'workforce_membership'
         and write_row.workforce_membership_id = version_row.membership_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.membership_id = new.membership_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_structural_access_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_structural_access_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = 'structural_access'
         and write_row.structural_access_binding_id = version_row.binding_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.binding_id = new.binding_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  elsif tg_table_name = 'inbox_v2_auth_collaborator_heads' then
    select exists (
      select 1
        from public.inbox_v2_auth_collaborator_versions version_row
        join public.inbox_v2_auth_relation_writes write_row
          on write_row.tenant_id = version_row.tenant_id
         and write_row.mutation_id = version_row.mutation_id
         and write_row.relation_kind = case version_row.resource_kind
           when 'conversation' then
             'conversation_collaborator'::public.inbox_v2_auth_relation_kind
           else 'work_item_collaborator'::public.inbox_v2_auth_relation_kind
         end
         and write_row.collaborator_id = version_row.collaborator_id
         and write_row.resulting_revision = version_row.revision
       where version_row.tenant_id = new.tenant_id
         and version_row.collaborator_id = new.collaborator_id
         and version_row.revision = new.current_revision
    ) into v_closed;
  else
    v_closed := tg_op = 'INSERT';
  end if;

  if not v_closed then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_head_commit_incomplete';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_relation_version_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean := false;
  v_command_actor_kind public.inbox_v2_auth_actor_kind;
  v_command_actor_employee_id text;
  v_command_actor_trusted_service_id text;
  v_mutation_committed_at timestamptz;
begin
  select
    command_row.actor_kind,
    command_row.actor_employee_id,
    command_row.actor_trusted_service_id,
    mutation_row.committed_at
    into
      v_command_actor_kind,
      v_command_actor_employee_id,
      v_command_actor_trusted_service_id,
      v_mutation_committed_at
    from public.inbox_v2_auth_mutation_commits mutation_row
    join public.inbox_v2_auth_command_records command_row
      on command_row.tenant_id = mutation_row.tenant_id
     and command_row.id = mutation_row.command_record_id
     and command_row.mutation_id = mutation_row.mutation_id
   where mutation_row.tenant_id = new.tenant_id
     and mutation_row.mutation_id = new.mutation_id;

  if not found then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_version_orphan';
  end if;

  if row(
    new.actor_kind,
    new.actor_employee_id,
    new.actor_trusted_service_id
  ) is distinct from row(
    v_command_actor_kind,
    v_command_actor_employee_id,
    v_command_actor_trusted_service_id
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_actor_mismatch';
  end if;

  if new.occurred_at is distinct from v_mutation_committed_at then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_occurred_at_mismatch';
  end if;

  case tg_table_name
    when 'inbox_v2_auth_role_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_role_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'role'
           and write_row.role_id = new.role_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.role_id = new.role_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_role_binding_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_role_binding_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'role_binding'
           and write_row.role_binding_id = new.binding_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.binding_id = new.binding_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_direct_grant_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_direct_grant_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'direct_grant'
           and write_row.direct_grant_id = new.grant_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.grant_id = new.grant_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_workforce_membership_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_workforce_membership_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'workforce_membership'
           and write_row.workforce_membership_id = new.membership_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.membership_id = new.membership_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_structural_access_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_structural_access_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = 'structural_access'
           and write_row.structural_access_binding_id = new.binding_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.binding_id = new.binding_id
           and head_row.current_revision = new.revision
      ) into v_closed;
    when 'inbox_v2_auth_collaborator_versions' then
      select exists (
        select 1
          from public.inbox_v2_auth_collaborator_heads head_row
          join public.inbox_v2_auth_relation_writes write_row
            on write_row.tenant_id = head_row.tenant_id
           and write_row.mutation_id = new.mutation_id
           and write_row.relation_kind = case new.resource_kind
             when 'conversation' then
               'conversation_collaborator'::public.inbox_v2_auth_relation_kind
             else 'work_item_collaborator'::public.inbox_v2_auth_relation_kind
           end
           and write_row.collaborator_id = new.collaborator_id
           and write_row.resulting_revision = new.revision
           and write_row.previous_revision is not distinct from case
             when new.revision = 1 then null::bigint else new.revision - 1
           end
          join public.inbox_v2_auth_mutation_commits mutation_row
            on mutation_row.tenant_id = write_row.tenant_id
           and mutation_row.mutation_id = write_row.mutation_id
         where head_row.tenant_id = new.tenant_id
           and head_row.collaborator_id = new.collaborator_id
           and head_row.current_revision = new.revision
      ) into v_closed;
  end case;

  if not coalesce(v_closed, false) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_version_orphan';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_command_commit_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_closed boolean;
begin
  select exists (
    select 1
      from public.inbox_v2_auth_command_records command_row
      join public.inbox_v2_auth_mutation_commits mutation_row
        on mutation_row.tenant_id = command_row.tenant_id
       and mutation_row.mutation_id = command_row.mutation_id
       and mutation_row.command_record_id = command_row.id
     where command_row.tenant_id = new.tenant_id
       and command_row.id = new.id
       and command_row.state = 'completed'
       and command_row.updated_at = mutation_row.committed_at
  ) into v_closed;
  if not v_closed then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_command_orphan';
  end if;
  return null;
end;
$function$;

create or replace function public.inbox_v2_auth_mutation_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_command public.inbox_v2_auth_command_records%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_count integer;
  v_invalid_count integer;
  v_change_count integer;
  v_event_count integer;
  v_authorization_event_count integer;
  v_outbox_count integer;
  v_effect_count integer;
  v_relation_count integer;
  v_facet_count integer;
  v_projection_count integer;
  v_role_write_count integer;
  v_structural_write_count integer;
  v_direct_access_write_count integer;
  v_direct_relation_write_count integer;
  v_change_ids jsonb;
  v_event_ids jsonb;
  v_outbox_ids jsonb;
  v_effect_digest text;
  v_relation_digest text;
  v_facet_digest text;
  v_stream_manifest_digest text;
  v_mutation_manifest_digest text;
  v_closed boolean;
  v_before_revision bigint;
  v_after_revision bigint;
  v_decision_not_after timestamptz;
begin
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
        to_jsonb(array[v_command.client_mutation_id]::text[]) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_command_audit_mismatch';
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
     or not public.inbox_v2_auth_json_tenant_safe(
       v_stream.audience_impact_manifest, new.tenant_id
     )
     or not public.inbox_v2_auth_payload_reference_safe(
       v_audit.evidence_reference, new.tenant_id
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_decision_manifest_invalid';
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
      message = 'inbox_v2.authorization_decision_manifest_invalid';
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
     or v_authorization_event_count < 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_stream_manifest_incomplete';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = new.tenant_id
     and change_row.stream_commit_id = new.stream_commit_id
     and (change_row.stream_position <> v_stream.position
       or change_row.created_at <> new.committed_at
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.domain_commit_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_payload_reference_safe(
         change_row.payload_reference, new.tenant_id
       )
       or not public.inbox_v2_auth_json_tenant_safe(
         change_row.timeline, new.tenant_id
       )
       or (change_row.timeline is not null and (
         not (change_row.timeline ?&
           array['conversation', 'timelineSequence']::text[])
         or (change_row.timeline -
           array['conversation', 'timelineSequence']::text[]) <> '{}'::jsonb
         or jsonb_typeof(change_row.timeline->'conversation') <> 'object'
         or not (change_row.timeline->'conversation' ?&
           array['tenantId', 'kind', 'id']::text[])
         or ((change_row.timeline->'conversation') -
           array['tenantId', 'kind', 'id']::text[]) <> '{}'::jsonb
         or jsonb_typeof(
           change_row.timeline->'conversation'->'tenantId'
         ) <> 'string'
         or change_row.timeline->'conversation'->>'tenantId' <>
           new.tenant_id
         or jsonb_typeof(
           change_row.timeline->'conversation'->'kind'
         ) <> 'string'
         or change_row.timeline->'conversation'->>'kind' <> 'conversation'
         or jsonb_typeof(
           change_row.timeline->'conversation'->'id'
         ) <> 'string'
         or char_length(
           change_row.timeline->'conversation'->>'id'
         ) not between 1 and 256
         or change_row.timeline->'conversation'->>'id' !~
           '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
         or jsonb_typeof(change_row.timeline->'timelineSequence') <> 'string'
         or change_row.timeline->>'timelineSequence' !~
           '^[1-9][0-9]{0,18}$'
       ))
       or (change_row.state_kind = 'upsert' and (
         change_row.payload_reference->>'schemaId' <>
           change_row.state_schema_id
         or change_row.payload_reference->>'schemaVersion' <>
           change_row.state_schema_version
       )));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.stream_commit_id = new.stream_commit_id
     and (event_row.stream_position <> v_stream.position
       or event_row.recorded_at <> new.committed_at
       or event_row.correlation_id <> v_stream.correlation_id
       or event_row.command_ids <> v_stream.command_ids
       or event_row.client_mutation_ids <> v_stream.client_mutation_ids
       or event_row.authorization_decision_refs <>
          v_stream.authorization_decision_refs
       or (event_row.type_id = 'core:authorization.changed'
         and event_row.access_effect <> 'may_change_access')
       or not (v_stream.change_ids @> event_row.change_ids)
       or not public.inbox_v2_auth_payload_reference_safe(
         event_row.payload_reference, new.tenant_id
       )
       or (event_row.payload_reference is not null and (
         event_row.payload_reference->>'schemaId' <>
           event_row.payload_schema_id
         or event_row.payload_reference->>'schemaVersion' <>
           event_row.payload_schema_version
       ))
       or not public.inbox_v2_auth_decision_refs_safe(
         event_row.authorization_decision_refs,
         new.tenant_id,
         new.committed_at,
         true
       )
       or exists (
         select 1
           from jsonb_array_elements(event_row.subjects) subject_row
          where jsonb_typeof(subject_row) <> 'object'
             or not (subject_row ?&
               array['tenantId', 'entityTypeId', 'entityId']::text[])
             or (subject_row -
               array['tenantId', 'entityTypeId', 'entityId']::text[]) <>
                 '{}'::jsonb
             or subject_row->>'tenantId' <> new.tenant_id
             or jsonb_typeof(subject_row->'tenantId') <> 'string'
             or jsonb_typeof(subject_row->'entityTypeId') <> 'string'
             or not public.inbox_v2_auth_catalog_id_safe(
               subject_row->>'entityTypeId'
             )
             or jsonb_typeof(subject_row->'entityId') <> 'string'
             or char_length(subject_row->>'entityId') not between 1 and 512
             or subject_row->>'entityId' !~
               '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       ));
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_outbox_intents intent_row
    join public.inbox_v2_domain_events event_row
      on event_row.tenant_id = intent_row.tenant_id
     and event_row.id = intent_row.event_id
   where intent_row.tenant_id = new.tenant_id
     and intent_row.stream_commit_id = new.stream_commit_id
     and (intent_row.stream_position <> v_stream.position
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
      message = 'inbox_v2.authorization_stream_child_mismatch';
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
      message = 'inbox_v2.authorization_stream_digest_mismatch';
  end if;

  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           effect_row.effect_hash, chr(10) order by effect_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_effect_count, v_effect_digest
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           write_row.write_hash, chr(10) order by write_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_relation_count, v_relation_digest
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id;
  select count(*)::integer,
         'sha256:' || encode(sha256(convert_to(coalesce(string_agg(
           facet_row.facet_hash, chr(10) order by facet_row.ordinal
         ), ''), 'UTF8')), 'hex')
    into v_facet_count, v_facet_digest
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = new.tenant_id
     and facet_row.audit_event_id = new.audit_event_id;

  if row(v_effect_count, v_effect_digest, v_relation_count,
         v_relation_digest, v_facet_count, v_facet_digest)
       is distinct from
     row(new.revision_effect_count, new.revision_effect_digest_sha256,
         new.relation_write_count, new.relation_write_digest_sha256,
         v_audit.facet_count, v_audit.facets_digest_sha256)
     or v_audit.revision_delta_hash <> v_effect_digest then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_manifest_incomplete';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = new.tenant_id
     and effect_row.mutation_id = new.mutation_id
     and (effect_row.created_at <> new.committed_at or not case effect_row.effect_kind
       when 'tenant_rbac' then exists (
         select 1 from public.inbox_v2_auth_tenant_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.tenant_rbac_revision = effect_row.after_revision
       )
       when 'shared_access' then exists (
         select 1 from public.inbox_v2_auth_tenant_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.shared_access_revision = effect_row.after_revision
       )
       when 'employee_access' then exists (
         select 1 from public.inbox_v2_auth_employee_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.employee_id = effect_row.employee_id
            and head_row.employee_access_revision = effect_row.after_revision
       )
       when 'employee_inbox_relation' then exists (
         select 1 from public.inbox_v2_auth_employee_heads head_row
          where head_row.tenant_id = effect_row.tenant_id
            and head_row.employee_id = effect_row.employee_id
            and head_row.employee_inbox_relation_revision =
                effect_row.after_revision
       )
        when 'resource_access' then (
         (effect_row.resource_head_id is not null and exists (
           select 1 from public.inbox_v2_auth_resource_heads head_row
            where head_row.tenant_id = effect_row.tenant_id
              and head_row.id = effect_row.resource_head_id
              and head_row.resource_access_revision = effect_row.after_revision
         )) or
         (effect_row.work_item_id is not null and exists (
           select 1 from public.inbox_v2_work_items work_item
            where work_item.tenant_id = effect_row.tenant_id
              and work_item.id = effect_row.work_item_id
              and work_item.resource_access_revision = effect_row.after_revision
          ))
        )
       when 'collaborator_set' then (
         (effect_row.resource_head_id is not null and exists (
           select 1 from public.inbox_v2_auth_resource_heads head_row
            where head_row.tenant_id = effect_row.tenant_id
              and head_row.id = effect_row.resource_head_id
              and head_row.collaborator_set_revision =
                  effect_row.after_revision
              and head_row.updated_at = effect_row.created_at
         )) or
         (effect_row.work_item_id is not null and exists (
           select 1 from public.inbox_v2_work_items work_item_row
            where work_item_row.tenant_id = effect_row.tenant_id
              and work_item_row.id = effect_row.work_item_id
              and work_item_row.reopen_cycle = effect_row.work_item_cycle
              and work_item_row.revision =
                  effect_row.resulting_work_item_revision
              and work_item_row.collaborator_set_revision =
                  effect_row.after_revision
              and work_item_row.updated_at = effect_row.created_at
         ))
       )
       else false
     end);
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_revision_effect_invalid';
  end if;

  select count(*)::integer into v_invalid_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id
     and (write_row.created_at <> new.committed_at or not case write_row.relation_kind
       when 'role' then exists (
         select 1 from public.inbox_v2_auth_role_versions version_row
          join public.inbox_v2_auth_role_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.role_id = version_row.role_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.role_id = write_row.role_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'role_binding' then exists (
         select 1 from public.inbox_v2_auth_role_binding_versions version_row
          join public.inbox_v2_auth_role_binding_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.binding_id = version_row.binding_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.binding_id = write_row.role_binding_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'direct_grant' then exists (
         select 1 from public.inbox_v2_auth_direct_grant_versions version_row
          join public.inbox_v2_auth_direct_grant_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.grant_id = version_row.grant_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.grant_id = write_row.direct_grant_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'workforce_membership' then exists (
         select 1 from public.inbox_v2_auth_workforce_membership_versions version_row
          join public.inbox_v2_auth_workforce_membership_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.membership_id = version_row.membership_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.membership_id = write_row.workforce_membership_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'structural_access' then exists (
         select 1 from public.inbox_v2_auth_structural_access_versions version_row
          join public.inbox_v2_auth_structural_access_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.binding_id = version_row.binding_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.binding_id = write_row.structural_access_binding_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
       )
       when 'conversation_collaborator' then exists (
         select 1 from public.inbox_v2_auth_collaborator_versions version_row
          join public.inbox_v2_auth_collaborator_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.collaborator_id = version_row.collaborator_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.collaborator_id = write_row.collaborator_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.resource_kind = 'conversation'
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
            and exists (
              select 1 from public.inbox_v2_auth_resource_heads resource_head
               where resource_head.tenant_id = version_row.tenant_id
                 and resource_head.resource_kind = 'conversation'
                 and resource_head.conversation_id = version_row.conversation_id
                 and resource_head.updated_at = new.committed_at
            )
       )
       when 'work_item_collaborator' then exists (
         select 1 from public.inbox_v2_auth_collaborator_versions version_row
          join public.inbox_v2_auth_collaborator_heads head_row
            on head_row.tenant_id = version_row.tenant_id
           and head_row.collaborator_id = version_row.collaborator_id
           and head_row.current_revision = version_row.revision
          where version_row.tenant_id = write_row.tenant_id
            and version_row.collaborator_id = write_row.collaborator_id
            and version_row.revision = write_row.resulting_revision
            and write_row.previous_revision is not distinct from case
              when version_row.revision = 1 then null::bigint
              else version_row.revision - 1
            end
            and version_row.resource_kind = 'work_item'
            and version_row.work_item_cycle >= 0
            and version_row.mutation_id = write_row.mutation_id
            and version_row.occurred_at = new.committed_at
            and exists (
              select 1 from public.inbox_v2_work_items work_item
               where work_item.tenant_id = version_row.tenant_id
                 and work_item.id = version_row.work_item_id
                 and work_item.reopen_cycle = version_row.work_item_cycle
            )
       )
       when 'internal_membership' then exists (
         select 1 from public.inbox_v2_participant_membership_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.internal_membership_transition_id
            and transition_row.resulting_revision = write_row.resulting_revision
            and transition_row.current_revision is not distinct from
                write_row.previous_revision
            and transition_row.cause_kind = 'hulee_internal_command'
            and v_command.actor_kind = 'employee'
            and transition_row.cause_actor_employee_id =
                v_command.actor_employee_id
            and transition_row.occurred_at = new.committed_at
       )
       when 'primary_responsibility' then exists (
         select 1 from public.inbox_v2_work_item_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.primary_responsibility_transition_id
            and transition_row.resulting_revision = write_row.resulting_revision
            and transition_row.expected_revision = write_row.previous_revision
            and (transition_row.closed_primary_assignment_id is not null
              or transition_row.opened_primary_assignment_id is not null)
            and row(
              transition_row.actor_kind::text,
              transition_row.actor_employee_id,
              transition_row.actor_trusted_service_id,
              transition_row.actor_authorization_epoch
            ) is not distinct from row(
              v_command.actor_kind::text,
              v_command.actor_employee_id,
              v_command.actor_trusted_service_id,
              case when v_command.actor_kind = 'employee'
                then v_command.authorization_epoch else null::text end
            )
            and transition_row.occurred_at = new.committed_at
       )
       when 'servicing_team' then exists (
         select 1 from public.inbox_v2_work_item_relation_transitions transition_row
          where transition_row.tenant_id = write_row.tenant_id
            and transition_row.id = write_row.servicing_team_transition_id
            and transition_row.resulting_relation_revision =
                write_row.resulting_revision
            and transition_row.expected_relation_revision =
                write_row.previous_revision
            and row(
              transition_row.actor_kind::text,
              transition_row.actor_employee_id,
              transition_row.actor_trusted_service_id,
              transition_row.actor_authorization_epoch
            ) is not distinct from row(
              v_command.actor_kind::text,
              v_command.actor_employee_id,
              v_command.actor_trusted_service_id,
              case when v_command.actor_kind = 'employee'
                then v_command.authorization_epoch else null::text end
            )
            and transition_row.occurred_at = new.committed_at
       )
       else false
     end);
  if v_invalid_count <> 0 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_relation_write_invalid';
  end if;

  select count(*) filter (
           where write_row.relation_kind in ('role', 'role_binding')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in ('structural_access', 'servicing_team')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in ('direct_grant', 'workforce_membership')
         )::integer,
         count(*) filter (
           where write_row.relation_kind in (
             'conversation_collaborator', 'work_item_collaborator',
             'internal_membership', 'primary_responsibility'
           )
         )::integer
    into v_role_write_count, v_structural_write_count,
         v_direct_access_write_count, v_direct_relation_write_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = new.tenant_id
     and write_row.mutation_id = new.mutation_id;

  if v_role_write_count = v_relation_count then
    select count(*)::integer,
           min(effect_row.before_revision),
           max(effect_row.after_revision)
      into v_count, v_before_revision, v_after_revision
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'tenant_rbac';
    if v_stream.audience_impact_kind <> 'tenant_rbac'
       or v_count <> 1 or v_effect_count <> 1
       or not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence',
         'previousTenantRbacRevision', 'resultingTenantRbacRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence',
         'previousTenantRbacRevision', 'resultingTenantRbacRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'previousTenantRbacRevision'
       ) <> 'string'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'resultingTenantRbacRevision'
       ) <> 'string'
       or v_stream.audience_impact_manifest->>'previousTenantRbacRevision' <>
         v_before_revision::text
       or v_stream.audience_impact_manifest->>'resultingTenantRbacRevision' <>
         v_after_revision::text
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'indexedFanoutPlanId'
       ) <> 'string'
       or char_length(
         v_stream.audience_impact_manifest->>'indexedFanoutPlanId'
       ) not between 1 and 512
       or v_stream.audience_impact_manifest->>'indexedFanoutPlanId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'invalidations'
       ) not between 1 and 1000 else true end)
       or not public.inbox_v2_auth_invalidations_safe(
         v_stream.audience_impact_manifest->'invalidations',
         new.tenant_id,
         1000
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_tenant_rbac_fanout_invalid';
    end if;
  elsif v_structural_write_count = v_relation_count then
    select count(*) filter (where effect_row.effect_kind = 'shared_access')::integer,
           count(*) filter (where effect_row.effect_kind = 'resource_access')::integer
      into v_count, v_invalid_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id;
    if v_stream.audience_impact_kind <> 'structural'
       or v_count <> 1 or v_invalid_count < 1
       or v_effect_count <> v_count + v_invalid_count then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_impact_invalid';
    end if;

    with expected_targets(resource_head_id, work_item_id) as (
      select version_row.resource_head_id, null::text
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_structural_access_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.binding_id = write_row.structural_access_binding_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'structural_access'
      union
      select null::text, transition_row.work_item_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_relation_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.servicing_team_transition_id
         and transition_row.resulting_relation_revision =
           write_row.resulting_revision
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'servicing_team'
    ), actual_targets as (
      select effect_row.resource_head_id, effect_row.work_item_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'resource_access'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_target_set_mismatch';
    end if;

    select effect_row.before_revision, effect_row.after_revision
      into strict v_before_revision, v_after_revision
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'shared_access';
    if not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence',
         'previousSharedAccessRevision', 'resultingSharedAccessRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence',
         'previousSharedAccessRevision', 'resultingSharedAccessRevision',
         'invalidations', 'indexedFanoutPlanId'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'previousSharedAccessRevision'
       ) <> 'string'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'resultingSharedAccessRevision'
       ) <> 'string'
       or v_stream.audience_impact_manifest->>'previousSharedAccessRevision' <>
         v_before_revision::text
       or v_stream.audience_impact_manifest->>'resultingSharedAccessRevision' <>
         v_after_revision::text
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'indexedFanoutPlanId'
       ) <> 'string'
       or char_length(
         v_stream.audience_impact_manifest->>'indexedFanoutPlanId'
       ) not between 1 and 512
       or v_stream.audience_impact_manifest->>'indexedFanoutPlanId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'invalidations'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'invalidations'
       ) not between 1 and 1000 else true end)
       or not public.inbox_v2_auth_invalidations_safe(
         v_stream.audience_impact_manifest->'invalidations',
         new.tenant_id,
         1000
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_structural_audience_invalid';
    end if;
  elsif v_direct_access_write_count = v_relation_count then
    select count(*)::integer into v_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id
       and effect_row.effect_kind = 'employee_access';
    if v_stream.audience_impact_kind <> 'direct'
       or v_count < 1 or v_count <> v_effect_count then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_access_impact_invalid';
    end if;

    with expected_targets(employee_id) as (
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_direct_grant_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.grant_id = write_row.direct_grant_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'direct_grant'
      union
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_workforce_membership_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.membership_id = write_row.workforce_membership_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'workforce_membership'
    ), actual_targets as (
      select effect_row.employee_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'employee_access'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_employee_access_target_set_mismatch';
    end if;
  elsif v_direct_relation_write_count = v_relation_count then
    select count(*) filter (
             where effect_row.effect_kind = 'employee_inbox_relation'
           )::integer,
           count(*) filter (
             where effect_row.effect_kind = 'collaborator_set'
           )::integer
      into v_count, v_invalid_count
      from public.inbox_v2_auth_revision_effects effect_row
     where effect_row.tenant_id = new.tenant_id
       and effect_row.mutation_id = new.mutation_id;
    if v_stream.audience_impact_kind <> 'direct'
       or v_count < 1
       or v_count + v_invalid_count <> v_effect_count
       or (exists (
         select 1 from public.inbox_v2_auth_relation_writes write_row
          where write_row.tenant_id = new.tenant_id
            and write_row.mutation_id = new.mutation_id
            and write_row.relation_kind in (
              'conversation_collaborator', 'work_item_collaborator'
            )
       )) is distinct from (v_invalid_count = 1) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_relation_impact_invalid';
    end if;

    with expected_targets(employee_id) as (
      select version_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_collaborator_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.collaborator_id = write_row.collaborator_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind in (
           'conversation_collaborator', 'work_item_collaborator'
         )
      union
      select participant_row.subject_employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_participant_membership_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.internal_membership_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_conversation_participants participant_row
          on participant_row.tenant_id = transition_row.tenant_id
         and participant_row.id = transition_row.participant_id
         and participant_row.conversation_id = transition_row.conversation_id
         and participant_row.subject_kind = 'employee'
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'internal_membership'
      union
      select assignment_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.primary_responsibility_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_work_item_primary_assignments assignment_row
          on assignment_row.tenant_id = transition_row.tenant_id
         and assignment_row.id = transition_row.closed_primary_assignment_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'primary_responsibility'
      union
      select assignment_row.employee_id
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_work_item_transitions transition_row
          on transition_row.tenant_id = write_row.tenant_id
         and transition_row.id = write_row.primary_responsibility_transition_id
         and transition_row.resulting_revision = write_row.resulting_revision
        join public.inbox_v2_work_item_primary_assignments assignment_row
          on assignment_row.tenant_id = transition_row.tenant_id
         and assignment_row.id = transition_row.opened_primary_assignment_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind = 'primary_responsibility'
    ), actual_targets as (
      select effect_row.employee_id
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'employee_inbox_relation'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_relation_target_set_mismatch';
    end if;

    with expected_targets(
      resource_head_id, work_item_id, work_item_cycle
    ) as (
      select resource_head.id, version_row.work_item_id,
             version_row.work_item_cycle
        from public.inbox_v2_auth_relation_writes write_row
        join public.inbox_v2_auth_collaborator_versions version_row
          on version_row.tenant_id = write_row.tenant_id
         and version_row.collaborator_id = write_row.collaborator_id
         and version_row.revision = write_row.resulting_revision
         and version_row.mutation_id = write_row.mutation_id
        left join public.inbox_v2_auth_resource_heads resource_head
          on resource_head.tenant_id = version_row.tenant_id
         and version_row.resource_kind = 'conversation'
         and resource_head.resource_kind = 'conversation'
         and resource_head.conversation_id = version_row.conversation_id
       where write_row.tenant_id = new.tenant_id
         and write_row.mutation_id = new.mutation_id
         and write_row.relation_kind in (
           'conversation_collaborator', 'work_item_collaborator'
         )
    ), actual_targets as (
      select effect_row.resource_head_id, effect_row.work_item_id,
             effect_row.work_item_cycle
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind = 'collaborator_set'
    )
    select exists (
      (select * from expected_targets except select * from actual_targets)
      union all
      (select * from actual_targets except select * from expected_targets)
    ) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_collaborator_set_target_mismatch';
    end if;
  else
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_relation_class_mixed';
  end if;

  if v_stream.audience_impact_kind = 'direct' then
    if not (v_stream.audience_impact_manifest ?& array[
         'kind', 'impactId', 'deliveryFence', 'affectedRecipients'
       ]::text[])
       or (v_stream.audience_impact_manifest - array[
         'kind', 'impactId', 'deliveryFence', 'affectedRecipients'
       ]::text[]) <> '{}'::jsonb
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'impactId'
       ) <> 'string'
       or char_length(v_stream.audience_impact_manifest->>'impactId')
         not between 1 and 512
       or v_stream.audience_impact_manifest->>'impactId' !~
         '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
       or v_stream.audience_impact_manifest->>'deliveryFence' <>
         'invalidate_before_payload'
       or jsonb_typeof(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) <> 'array'
       or (case when jsonb_typeof(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) = 'array' then jsonb_array_length(
         v_stream.audience_impact_manifest->'affectedRecipients'
       ) not between 1 and 1000 else true end) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_audience_invalid';
    end if;

    select count(*)::integer into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row
     where jsonb_typeof(recipient_row) <> 'object'
        or not (recipient_row ?& array[
          'employee', 'relation', 'previousAuthorizationEpoch',
          'resultingAuthorizationEpoch', 'invalidations',
          'authorizationDecisionRefs'
        ]::text[])
        or (recipient_row - array[
          'employee', 'relation', 'previousAuthorizationEpoch',
          'resultingAuthorizationEpoch', 'invalidations',
          'authorizationDecisionRefs'
        ]::text[]) <> '{}'::jsonb
        or jsonb_typeof(recipient_row->'employee') <> 'object'
        or not (recipient_row->'employee' ?&
          array['tenantId', 'kind', 'id']::text[])
        or ((recipient_row->'employee') -
          array['tenantId', 'kind', 'id']::text[]) <>
          '{}'::jsonb
        or jsonb_typeof(recipient_row->'employee'->'tenantId') <> 'string'
        or recipient_row->'employee'->>'tenantId' <> new.tenant_id
        or jsonb_typeof(recipient_row->'employee'->'kind') <> 'string'
        or recipient_row->'employee'->>'kind' <> 'employee'
        or jsonb_typeof(recipient_row->'employee'->'id') <> 'string'
        or char_length(recipient_row->'employee'->>'id') not between 1 and 256
        or recipient_row->'employee'->>'id' !~
          '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        or jsonb_typeof(recipient_row->'relation') <> 'string'
        or recipient_row->>'relation' not in ('previous', 'resulting', 'both')
        or jsonb_typeof(
          recipient_row->'previousAuthorizationEpoch'
        ) <> 'string'
        or char_length(recipient_row->>'previousAuthorizationEpoch')
          not between 8 and 1024
        or jsonb_typeof(
          recipient_row->'resultingAuthorizationEpoch'
        ) <> 'string'
        or char_length(recipient_row->>'resultingAuthorizationEpoch')
          not between 8 and 1024
        or recipient_row->>'previousAuthorizationEpoch' =
          recipient_row->>'resultingAuthorizationEpoch'
        or jsonb_typeof(recipient_row->'invalidations') <> 'array'
        or (case when jsonb_typeof(recipient_row->'invalidations') = 'array'
          then jsonb_array_length(recipient_row->'invalidations')
            not between 1 and 64 else true end)
        or not public.inbox_v2_auth_json_tenant_safe(
          recipient_row->'invalidations', new.tenant_id
        )
        or not public.inbox_v2_auth_invalidations_safe(
          recipient_row->'invalidations', new.tenant_id, 64
        )
        or not public.inbox_v2_auth_decision_refs_safe(
          recipient_row->'authorizationDecisionRefs',
          new.tenant_id,
          new.committed_at,
          false
        )
        or not exists (
          select 1 from public.employees employee_row
           where employee_row.tenant_id = new.tenant_id
             and employee_row.id = recipient_row->'employee'->>'id'
        );
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_invalid';
    end if;

    select count(*)::integer into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row
     where exists (
       select 1
         from jsonb_array_elements(
           recipient_row->'authorizationDecisionRefs'
         ) decision_ref
        where decision_ref->>'authorizationEpoch' <>
            recipient_row->>'resultingAuthorizationEpoch'
           or decision_ref->'principal'->>'kind' <> 'employee'
           or decision_ref->'principal'->'employee'->>'tenantId' <>
             new.tenant_id
           or decision_ref->'principal'->'employee'->>'id' <>
             recipient_row->'employee'->>'id'
     )
        or case recipient_row->>'relation'
          when 'previous' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'denied'
            ) or exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            )
          when 'resulting' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            ) or exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'denied'
            )
          when 'both' then
            not exists (
              select 1
                from jsonb_array_elements(
                  recipient_row->'authorizationDecisionRefs'
                ) decision_ref
               where decision_ref->>'outcome' = 'allowed'
            )
          else true
        end
        or (
          exists (
            select 1
              from jsonb_array_elements(
                recipient_row->'authorizationDecisionRefs'
              ) decision_ref
             where decision_ref->>'outcome' = 'denied'
          ) and not exists (
            select 1
              from jsonb_array_elements(
                recipient_row->'invalidations'
              ) invalidation
             where invalidation->>'kind' = 'recipient_scope'
          )
        );
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_relation_invalid';
    end if;

    select count(*)::integer - count(distinct
             recipient_row->'employee'->>'id')::integer
      into v_invalid_count
      from jsonb_array_elements(
        v_stream.audience_impact_manifest->'affectedRecipients'
      ) recipient_row;
    if v_invalid_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_duplicate';
    end if;

    select coalesce((
      select to_jsonb(array_agg(
        recipient_row.value->'employee'->>'id'
        order by recipient_row.ordinal
      ))
        from jsonb_array_elements(
          v_stream.audience_impact_manifest->'affectedRecipients'
        ) with ordinality recipient_row(value, ordinal)
    ), '[]'::jsonb) is distinct from coalesce((
      select to_jsonb(array_agg(
        effect_row.employee_id order by effect_row.ordinal
      ))
        from public.inbox_v2_auth_revision_effects effect_row
       where effect_row.tenant_id = new.tenant_id
         and effect_row.mutation_id = new.mutation_id
         and effect_row.effect_kind in (
           'employee_access', 'employee_inbox_relation'
         )
    ), '[]'::jsonb) into v_closed;
    if v_closed then
      raise exception using errcode = '23514',
        message = 'inbox_v2.authorization_direct_recipient_set_mismatch';
    end if;
  end if;

  select stream_head.last_position = v_stream.position
         and stream_head.stream_epoch = v_stream.stream_epoch
         and stream_head.updated_at = new.committed_at
    into v_closed
    from public.inbox_v2_tenant_stream_heads stream_head
   where stream_head.tenant_id = new.tenant_id;
  if not coalesce(v_closed, false) then
    raise exception using errcode = '40001',
      message = 'inbox_v2.authorization_stream_head_not_closed';
  end if;

  v_mutation_manifest_digest := 'sha256:' || encode(sha256(convert_to(
    'effects:' || v_effect_digest || chr(10) ||
    'relations:' || v_relation_digest || chr(10) ||
    'stream:' || v_stream.commit_hash || chr(10) ||
    'audit:' || v_audit.audit_hash,
    'UTF8'
  )), 'hex');
  if v_mutation_manifest_digest <> new.manifest_digest_sha256 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_digest_mismatch';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_parent_incomplete';
end;
$function$;

create or replace function public.inbox_v2_auth_mutation_child_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_mutation public.inbox_v2_auth_mutation_commits%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_change_count integer;
  v_event_count integer;
  v_outbox_count integer;
  v_projection_count integer;
  v_effect_count integer;
  v_relation_count integer;
  v_facet_count integer;
begin
  if tg_table_name = 'inbox_v2_auth_audit_facets' then
    select mutation_row.* into strict v_mutation
      from public.inbox_v2_auth_audit_events audit_row
      join public.inbox_v2_auth_mutation_commits mutation_row
        on mutation_row.tenant_id = audit_row.tenant_id
       and mutation_row.audit_event_id = audit_row.id
       and mutation_row.mutation_id = audit_row.mutation_id
     where audit_row.tenant_id = new.tenant_id
       and audit_row.id = new.audit_event_id;
  elsif tg_table_name in (
    'inbox_v2_tenant_stream_changes',
    'inbox_v2_domain_events',
    'inbox_v2_outbox_intents'
  ) then
    select * into v_mutation
      from public.inbox_v2_auth_mutation_commits mutation_row
     where mutation_row.tenant_id = new.tenant_id
       and mutation_row.mutation_id = new.mutation_id;
    -- The tenant stream is shared by every V2 domain writer. Only children of
    -- an authorization mutation use this authorization-specific seal.
    if not found then
      return null;
    end if;
  else
    select * into strict v_mutation
      from public.inbox_v2_auth_mutation_commits mutation_row
     where mutation_row.tenant_id = new.tenant_id
       and mutation_row.mutation_id = new.mutation_id;
  end if;

  select * into strict v_stream
    from public.inbox_v2_tenant_stream_commits stream_row
   where stream_row.tenant_id = v_mutation.tenant_id
     and stream_row.id = v_mutation.stream_commit_id
     and stream_row.mutation_id = v_mutation.mutation_id;
  select * into strict v_audit
    from public.inbox_v2_auth_audit_events audit_row
   where audit_row.tenant_id = v_mutation.tenant_id
     and audit_row.id = v_mutation.audit_event_id
     and audit_row.mutation_id = v_mutation.mutation_id;

  select count(*)::integer into v_change_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = v_mutation.tenant_id
     and change_row.stream_commit_id = v_mutation.stream_commit_id
     and change_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_event_count
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = v_mutation.tenant_id
     and event_row.stream_commit_id = v_mutation.stream_commit_id
     and event_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer,
         count(*) filter (
           where intent_row.effect_class = 'projection'
             and intent_row.type_id = 'core:projection.update'
         )::integer
    into v_outbox_count, v_projection_count
    from public.inbox_v2_outbox_intents intent_row
   where intent_row.tenant_id = v_mutation.tenant_id
     and intent_row.stream_commit_id = v_mutation.stream_commit_id
     and intent_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_effect_count
    from public.inbox_v2_auth_revision_effects effect_row
   where effect_row.tenant_id = v_mutation.tenant_id
     and effect_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_relation_count
    from public.inbox_v2_auth_relation_writes write_row
   where write_row.tenant_id = v_mutation.tenant_id
     and write_row.mutation_id = v_mutation.mutation_id;
  select count(*)::integer into v_facet_count
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = v_mutation.tenant_id
     and facet_row.audit_event_id = v_mutation.audit_event_id;

  if row(v_change_count, v_event_count, v_outbox_count,
         v_projection_count, v_effect_count, v_relation_count,
         v_facet_count)
       is distinct from
     row(v_stream.change_count, v_stream.event_count,
         v_stream.outbox_intent_count, v_mutation.projection_intent_count,
         v_mutation.revision_effect_count,
         v_mutation.relation_write_count, v_audit.facet_count) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_sealed_manifest_changed';
  end if;
  return null;
exception
  when no_data_found or too_many_rows then
    raise exception using errcode = '23514',
      message = 'inbox_v2.authorization_mutation_parent_incomplete';
end;
$function$;

do $triggers$
declare
  v_table text;
  v_trigger text;
begin
  foreach v_table in array array[
    'inbox_v2_auth_role_versions',
    'inbox_v2_auth_role_version_permissions',
    'inbox_v2_auth_role_binding_versions',
    'inbox_v2_auth_direct_grant_versions',
    'inbox_v2_auth_workforce_membership_versions',
    'inbox_v2_auth_structural_access_versions',
    'inbox_v2_auth_collaborator_versions',
    'inbox_v2_tenant_stream_commits',
    'inbox_v2_tenant_stream_changes',
    'inbox_v2_domain_events',
    'inbox_v2_outbox_intents',
    'inbox_v2_auth_audit_events',
    'inbox_v2_auth_audit_facets',
    'inbox_v2_auth_mutation_commits',
    'inbox_v2_auth_revision_effects',
    'inbox_v2_auth_relation_writes'
  ]
  loop
    v_trigger := 'inbox_v2_auth_immutable_' || substr(md5(v_table), 1, 16);
    execute format(
      'create trigger %I before update or delete on public.%I for each row execute function public.inbox_v2_auth_reject_immutable()',
      v_trigger,
      v_table
    );
  end loop;
end;
$triggers$;

create trigger inbox_v2_auth_role_version_insert_guard
before insert on public.inbox_v2_auth_role_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_binding_version_insert_guard
before insert on public.inbox_v2_auth_role_binding_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_grant_version_insert_guard
before insert on public.inbox_v2_auth_direct_grant_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_workforce_version_insert_guard
before insert on public.inbox_v2_auth_workforce_membership_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_structural_version_insert_guard
before insert on public.inbox_v2_auth_structural_access_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create trigger inbox_v2_auth_collaborator_version_insert_guard
before insert on public.inbox_v2_auth_collaborator_versions
for each row execute function public.inbox_v2_auth_relation_version_guard();

create constraint trigger inbox_v2_auth_role_version_commit_coherence
after insert on public.inbox_v2_auth_role_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_binding_version_commit_coherence
after insert on public.inbox_v2_auth_role_binding_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_grant_version_commit_coherence
after insert on public.inbox_v2_auth_direct_grant_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_workforce_version_commit_coherence
after insert on public.inbox_v2_auth_workforce_membership_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_structural_version_commit_coherence
after insert on public.inbox_v2_auth_structural_access_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create constraint trigger inbox_v2_auth_collaborator_version_commit_coherence
after insert on public.inbox_v2_auth_collaborator_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_relation_version_commit_coherence();

create trigger inbox_v2_auth_tenant_head_guard
before insert or update or delete on public.inbox_v2_auth_tenant_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_employee_head_guard
before insert or update or delete on public.inbox_v2_auth_employee_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_role_head_guard
before insert or update or delete on public.inbox_v2_auth_role_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_binding_head_guard
before insert or update or delete on public.inbox_v2_auth_role_binding_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_grant_head_guard
before insert or update or delete on public.inbox_v2_auth_direct_grant_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_workforce_head_guard
before insert or update or delete on public.inbox_v2_auth_workforce_membership_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_resource_head_guard
before insert or update or delete on public.inbox_v2_auth_resource_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_structural_head_guard
before insert or update or delete on public.inbox_v2_auth_structural_access_heads
for each row execute function public.inbox_v2_auth_head_guard();

create trigger inbox_v2_auth_collaborator_head_guard
before insert or update or delete on public.inbox_v2_auth_collaborator_heads
for each row execute function public.inbox_v2_auth_head_guard();

create constraint trigger inbox_v2_auth_tenant_head_commit_coherence
after insert or update on public.inbox_v2_auth_tenant_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_employee_head_commit_coherence
after insert or update on public.inbox_v2_auth_employee_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_role_head_commit_coherence
after insert or update on public.inbox_v2_auth_role_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_binding_head_commit_coherence
after insert or update on public.inbox_v2_auth_role_binding_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_grant_head_commit_coherence
after insert or update on public.inbox_v2_auth_direct_grant_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_workforce_head_commit_coherence
after insert or update on public.inbox_v2_auth_workforce_membership_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_resource_head_commit_coherence
after insert or update on public.inbox_v2_auth_resource_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_structural_head_commit_coherence
after insert or update on public.inbox_v2_auth_structural_access_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create constraint trigger inbox_v2_auth_collaborator_head_commit_coherence
after insert or update on public.inbox_v2_auth_collaborator_heads
deferrable initially deferred
for each row execute function public.inbox_v2_auth_head_commit_coherence();

create trigger inbox_v2_auth_command_guard_trigger
before insert or update or delete on public.inbox_v2_auth_command_records
for each row execute function public.inbox_v2_auth_command_guard();

create constraint trigger inbox_v2_auth_command_commit_coherence
after insert or update on public.inbox_v2_auth_command_records
deferrable initially deferred
for each row execute function public.inbox_v2_auth_command_commit_coherence();

create trigger inbox_v2_auth_audit_identifier_guard_trigger
before insert on public.inbox_v2_auth_audit_events
for each row execute function public.inbox_v2_auth_audit_identifier_guard();

create trigger inbox_v2_tenant_stream_head_guard_trigger
before insert or update or delete on public.inbox_v2_tenant_stream_heads
for each row execute function public.inbox_v2_auth_stream_head_guard();

create constraint trigger inbox_v2_auth_role_version_permissions_coherence
after insert on public.inbox_v2_auth_role_versions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_role_permission_coherence();

create constraint trigger inbox_v2_auth_role_permission_rows_coherence
after insert on public.inbox_v2_auth_role_version_permissions
deferrable initially deferred
for each row execute function public.inbox_v2_auth_role_permission_coherence();

create constraint trigger inbox_v2_auth_mutation_commit_coherence
after insert on public.inbox_v2_auth_mutation_commits
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_coherence();

create constraint trigger inbox_v2_auth_change_mutation_child_coherence
after insert on public.inbox_v2_tenant_stream_changes
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_event_mutation_child_coherence
after insert on public.inbox_v2_domain_events
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_outbox_mutation_child_coherence
after insert on public.inbox_v2_outbox_intents
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_facet_mutation_child_coherence
after insert on public.inbox_v2_auth_audit_facets
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_effect_mutation_child_coherence
after insert on public.inbox_v2_auth_revision_effects
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();

create constraint trigger inbox_v2_auth_relation_mutation_child_coherence
after insert on public.inbox_v2_auth_relation_writes
deferrable initially deferred
for each row execute function public.inbox_v2_auth_mutation_child_coherence();
