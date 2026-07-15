-- INBOX_V2_SECURITY_DENIAL_MIGRATION_FINALIZED_V1
-- INBOX_V2_SECURITY_DENIAL_PREFLIGHT_V1
do $preflight$
declare
  missing_anchor text;
  partial_object text;
begin
  select anchor_name
    into missing_anchor
    from unnest(array[
      'tenants',
      'inbox_v2_auth_command_records',
      'inbox_v2_auth_audit_events',
      'inbox_v2_auth_mutation_commits',
      'inbox_v2_tenant_stream_heads'
    ]::text[]) as required_anchor(anchor_name)
   where to_regclass('public.' || required_anchor.anchor_name) is null
   order by required_anchor.anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.security_denial_foundation_missing',
      detail = 'Missing finalized 0034 anchor: ' || missing_anchor;
  end if;

  select anchor_name
    into missing_anchor
    from (
      select 'constraint:inbox_v2_auth_command_records_pk' as anchor_name
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_command_records'::regclass
            and conname = 'inbox_v2_auth_command_records_pk'
       )
      union all
      select 'constraint:inbox_v2_auth_audit_events_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_audit_events'::regclass
            and conname = 'inbox_v2_auth_audit_events_pk'
       )
      union all
      select 'constraint:inbox_v2_auth_mutation_commits_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_auth_mutation_commits'::regclass
            and conname = 'inbox_v2_auth_mutation_commits_pk'
       )
      union all
      select 'constraint:inbox_v2_tenant_stream_heads_pk'
       where not exists (
         select 1 from pg_catalog.pg_constraint
          where conrelid = 'public.inbox_v2_tenant_stream_heads'::regclass
            and conname = 'inbox_v2_tenant_stream_heads_pk'
       )
      union all
      select 'function:inbox_v2_auth_mutation_coherence'
       where to_regprocedure(
         'public.inbox_v2_auth_mutation_coherence()'
       ) is null
      union all
      select 'trigger:inbox_v2_auth_mutation_commit_coherence'
       where not exists (
         select 1
           from pg_catalog.pg_trigger trigger_definition
           join pg_catalog.pg_proc function_definition
             on function_definition.oid = trigger_definition.tgfoid
           join pg_catalog.pg_namespace function_namespace
             on function_namespace.oid = function_definition.pronamespace
          where trigger_definition.tgrelid =
            'public.inbox_v2_auth_mutation_commits'::regclass
            and trigger_definition.tgname =
              'inbox_v2_auth_mutation_commit_coherence'
            and not trigger_definition.tgisinternal
            and trigger_definition.tgdeferrable
            and trigger_definition.tginitdeferred
            and function_namespace.nspname = 'public'
            and function_definition.proname =
              'inbox_v2_auth_mutation_coherence'
       )
    ) missing_finalized_anchor
   order by anchor_name
   limit 1;

  if missing_anchor is not null then
    raise exception using errcode = '23514',
      message = 'inbox_v2.security_denial_foundation_missing',
      detail = 'Missing finalized 0034 constraint/function/trigger: ' ||
        missing_anchor;
  end if;

  select object_name
    into partial_object
    from (
      select 'table:' || table_name as object_name
        from unnest(array[
          -- RBAC007_PARTIAL_TABLES_BEGIN
          'inbox_v2_security_denial_window_shards',
          'inbox_v2_security_denial_buckets',
          'inbox_v2_security_denial_review_signals'
          -- RBAC007_PARTIAL_TABLES_END
        ]::text[]) as expected_table(table_name)
       where to_regclass('public.' || expected_table.table_name) is not null
      union all
      select 'type:' || type_name
        from unnest(array[
          -- RBAC007_PARTIAL_TYPES_BEGIN
          'inbox_v2_security_denial_action',
          'inbox_v2_security_denial_principal_class',
          'inbox_v2_security_denial_kind',
          'inbox_v2_security_denial_public_error_class',
          'inbox_v2_security_denial_risk',
          'inbox_v2_security_denial_review_type',
          'inbox_v2_security_denial_alert_type',
          'inbox_v2_security_denial_disposition',
          'inbox_v2_security_denial_review_disposition',
          'inbox_v2_security_denial_review_aggregation_kind',
          'inbox_v2_security_denial_review_status'
          -- RBAC007_PARTIAL_TYPES_END
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
          -- RBAC007_PARTIAL_FUNCTIONS_BEGIN
          'inbox_v2_security_denial_record',
          'inbox_v2_security_denial_prune',
          'inbox_v2_security_denial_integrity_guard'
          -- RBAC007_PARTIAL_FUNCTIONS_END
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
      message = 'inbox_v2.security_denial_partial_schema_detected',
      detail = 'Unexpected pre-existing RBAC-007 object: ' || partial_object;
  end if;
end;
$preflight$;
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_action" AS ENUM('resource.read', 'resource.mutate', 'authorization.privileged_mutation', 'identity.claim', 'privacy.hold.issue', 'privacy.hold.release', 'privacy.subject_evidence.view', 'privacy.tenant_export', 'privacy.deletion.preview', 'privacy.deletion.approve', 'privacy.deletion.execute');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_alert_type" AS ENUM('security_probe_review', 'identity_claim_review', 'privacy_control_review', 'abuse_threshold_alert');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_disposition" AS ENUM('recorded', 'deduplicated', 'aggregated_overflow', 'rate_limited');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_kind" AS ENUM('unknown_or_hidden_resource', 'cross_tenant_probe', 'missing_permission', 'scope_mismatch', 'stale_authorization', 'manual_self_claim', 'separation_of_duties', 'hard_boundary', 'state_guard', 'other_denied');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_principal_class" AS ENUM('employee', 'trusted_service', 'platform_support', 'invalid_or_anonymous');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_public_error_class" AS ENUM('not_found', 'permission_denied', 'authorization_stale', 'identity_claim_self_forbidden', 'privacy_denied', 'state_conflict', 'other_denied');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_review_aggregation_kind" AS ENUM('candidate', 'overflow');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_review_disposition" AS ENUM('candidate_created', 'candidate_aggregated', 'overflow_created', 'overflow_aggregated');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_review_status" AS ENUM('open', 'acknowledged', 'closed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_review_type" AS ENUM('guessed_identifier_probe', 'cross_tenant_probe', 'manual_self_claim', 'privacy_hold_issue_denied', 'privacy_hold_release_denied', 'privacy_evidence_access_denied', 'tenant_export_denied', 'destructive_preview_denied', 'destructive_approval_denied', 'destructive_execution_denied', 'denial_rate_exceeded', 'denial_volume_exceeded');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_security_denial_risk" AS ENUM('low', 'medium', 'high', 'critical');
--> statement-breakpoint
CREATE TABLE "inbox_v2_security_denial_buckets" (
	"tenant_id" text NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"shard_no" smallint NOT NULL,
	"dedupe_fingerprint" text NOT NULL,
	"window_ended_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"action" "inbox_v2_security_denial_action" NOT NULL,
	"principal_class" "inbox_v2_security_denial_principal_class" NOT NULL,
	"fingerprint_key_epoch" text NOT NULL,
	"actor_fingerprint" text NOT NULL,
	"denial_kind" "inbox_v2_security_denial_kind" NOT NULL,
	"public_error_class" "inbox_v2_security_denial_public_error_class" NOT NULL,
	"risk" "inbox_v2_security_denial_risk" NOT NULL,
	"occurrence_count" bigint NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_security_denial_buckets_pk" PRIMARY KEY("tenant_id","window_started_at","shard_no","dedupe_fingerprint"),
	CONSTRAINT "inbox_v2_security_denial_buckets_identity_check" CHECK ("inbox_v2_security_denial_buckets"."fingerprint_key_epoch" ~
          '^security-denial-key:[a-f0-9]{16,32}$'
        and "inbox_v2_security_denial_buckets"."actor_fingerprint" ~ '^hmac-sha256:[a-f0-9]{64}$'
        and "inbox_v2_security_denial_buckets"."dedupe_fingerprint" ~ '^hmac-sha256:[a-f0-9]{64}$'
        and "inbox_v2_security_denial_buckets"."actor_fingerprint" <> "inbox_v2_security_denial_buckets"."dedupe_fingerprint"),
	CONSTRAINT "inbox_v2_security_denial_buckets_decision_check" CHECK (("inbox_v2_security_denial_buckets"."denial_kind" not in (
          'unknown_or_hidden_resource', 'cross_tenant_probe'
        ) or "inbox_v2_security_denial_buckets"."public_error_class" = 'not_found')
        and ("inbox_v2_security_denial_buckets"."denial_kind" = 'manual_self_claim') =
          ("inbox_v2_security_denial_buckets"."action" = 'identity.claim'
            and "inbox_v2_security_denial_buckets"."public_error_class" =
              'identity_claim_self_forbidden')
        and "inbox_v2_security_denial_buckets"."risk" = case
          when "inbox_v2_security_denial_buckets"."denial_kind" = 'cross_tenant_probe'
            or "inbox_v2_security_denial_buckets"."action" = 'privacy.deletion.execute'
            then 'critical'::inbox_v2_security_denial_risk
          when "inbox_v2_security_denial_buckets"."denial_kind" in (
              'manual_self_claim', 'unknown_or_hidden_resource'
            ) or "inbox_v2_security_denial_buckets"."action" in (
              'authorization.privileged_mutation', 'identity.claim'
            ) or "inbox_v2_security_denial_buckets"."action"::text like 'privacy.%'
            then 'high'::inbox_v2_security_denial_risk
          when "inbox_v2_security_denial_buckets"."denial_kind" in ('state_guard', 'other_denied')
            then 'low'::inbox_v2_security_denial_risk
          else 'medium'::inbox_v2_security_denial_risk
        end),
	CONSTRAINT "inbox_v2_security_denial_buckets_window_check" CHECK ("inbox_v2_security_denial_buckets"."shard_no" between 0 and 16 - 1
        and "inbox_v2_security_denial_buckets"."window_ended_at" =
          "inbox_v2_security_denial_buckets"."window_started_at" + make_interval(secs => 3600)
        and "inbox_v2_security_denial_buckets"."expires_at" =
          "inbox_v2_security_denial_buckets"."window_started_at" + make_interval(secs => 2592000)
        and "inbox_v2_security_denial_buckets"."occurrence_count" >= 1),
	CONSTRAINT "inbox_v2_security_denial_buckets_times_check" CHECK (isfinite("inbox_v2_security_denial_buckets"."window_started_at")
        and isfinite("inbox_v2_security_denial_buckets"."window_ended_at")
        and isfinite("inbox_v2_security_denial_buckets"."first_seen_at")
        and isfinite("inbox_v2_security_denial_buckets"."last_seen_at")
        and isfinite("inbox_v2_security_denial_buckets"."expires_at")
        and isfinite("inbox_v2_security_denial_buckets"."created_at")
        and isfinite("inbox_v2_security_denial_buckets"."updated_at")
        and "inbox_v2_security_denial_buckets"."first_seen_at" >= "inbox_v2_security_denial_buckets"."window_started_at"
        and "inbox_v2_security_denial_buckets"."last_seen_at" >= "inbox_v2_security_denial_buckets"."first_seen_at"
        and "inbox_v2_security_denial_buckets"."last_seen_at" < "inbox_v2_security_denial_buckets"."window_ended_at"
        and "inbox_v2_security_denial_buckets"."updated_at" >= "inbox_v2_security_denial_buckets"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_security_denial_review_signals" (
	"tenant_id" text NOT NULL,
	"review_sequence" bigint GENERATED ALWAYS AS IDENTITY (sequence name "inbox_v2_security_denial_review_signals_review_sequence_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"shard_no" smallint NOT NULL,
	"review_type" "inbox_v2_security_denial_review_type" NOT NULL,
	"aggregation_kind" "inbox_v2_security_denial_review_aggregation_kind" NOT NULL,
	"candidate_fingerprint" text,
	"aggregation_key" text GENERATED ALWAYS AS (case aggregation_kind
          when 'candidate' then candidate_fingerprint
          else 'overflow'
        end) STORED NOT NULL,
	"alert_type" "inbox_v2_security_denial_alert_type" NOT NULL,
	"candidate_ref" text,
	"risk" "inbox_v2_security_denial_risk" NOT NULL,
	"status" "inbox_v2_security_denial_review_status" NOT NULL,
	"trigger_count" bigint NOT NULL,
	"window_ended_at" timestamp (3) with time zone NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_security_denial_review_signals_pk" PRIMARY KEY("tenant_id","window_started_at","shard_no","review_type","aggregation_kind","aggregation_key"),
	CONSTRAINT "inbox_v2_security_denial_review_shape_check" CHECK (("inbox_v2_security_denial_review_signals"."aggregation_kind" = 'candidate'
          and "inbox_v2_security_denial_review_signals"."candidate_fingerprint" ~
            '^hmac-sha256:[a-f0-9]{64}$'
          and ("inbox_v2_security_denial_review_signals"."candidate_ref" is null
            or "inbox_v2_security_denial_review_signals"."candidate_ref" ~ '^internal-ref:[a-f0-9]{32,64}$')
          and ("inbox_v2_security_denial_review_signals"."review_type" = 'manual_self_claim'
            or "inbox_v2_security_denial_review_signals"."candidate_ref" is null))
        or ("inbox_v2_security_denial_review_signals"."aggregation_kind" = 'overflow'
          and "inbox_v2_security_denial_review_signals"."candidate_fingerprint" is null
          and "inbox_v2_security_denial_review_signals"."candidate_ref" is null)),
	CONSTRAINT "inbox_v2_security_denial_review_presentation_check" CHECK (case
          when "inbox_v2_security_denial_review_signals"."review_type" = 'cross_tenant_probe' then
            "inbox_v2_security_denial_review_signals"."alert_type" = 'security_probe_review'
              and "inbox_v2_security_denial_review_signals"."risk" = 'critical'
          when "inbox_v2_security_denial_review_signals"."review_type" = 'guessed_identifier_probe' then
            "inbox_v2_security_denial_review_signals"."alert_type" = 'security_probe_review'
              and "inbox_v2_security_denial_review_signals"."risk" = 'high'
          when "inbox_v2_security_denial_review_signals"."review_type" = 'manual_self_claim' then
            "inbox_v2_security_denial_review_signals"."alert_type" = 'identity_claim_review'
              and "inbox_v2_security_denial_review_signals"."risk" = 'high'
          when "inbox_v2_security_denial_review_signals"."review_type" in (
            'denial_rate_exceeded', 'denial_volume_exceeded'
          ) then
            "inbox_v2_security_denial_review_signals"."alert_type" = 'abuse_threshold_alert'
              and "inbox_v2_security_denial_review_signals"."risk" in ('high', 'critical')
          when "inbox_v2_security_denial_review_signals"."review_type" = 'destructive_execution_denied' then
            "inbox_v2_security_denial_review_signals"."alert_type" = 'privacy_control_review'
              and "inbox_v2_security_denial_review_signals"."risk" = 'critical'
          else
            "inbox_v2_security_denial_review_signals"."alert_type" = 'privacy_control_review'
              and "inbox_v2_security_denial_review_signals"."risk" in ('high', 'critical')
        end),
	CONSTRAINT "inbox_v2_security_denial_review_window_check" CHECK ("inbox_v2_security_denial_review_signals"."shard_no" between 0 and 16 - 1
        and "inbox_v2_security_denial_review_signals"."window_ended_at" =
          "inbox_v2_security_denial_review_signals"."window_started_at" + make_interval(secs => 3600)
        and "inbox_v2_security_denial_review_signals"."expires_at" =
          "inbox_v2_security_denial_review_signals"."window_started_at" + make_interval(secs => 2592000)
        and "inbox_v2_security_denial_review_signals"."trigger_count" >= 1),
	CONSTRAINT "inbox_v2_security_denial_review_times_check" CHECK (isfinite("inbox_v2_security_denial_review_signals"."window_started_at")
        and isfinite("inbox_v2_security_denial_review_signals"."window_ended_at")
        and isfinite("inbox_v2_security_denial_review_signals"."first_seen_at")
        and isfinite("inbox_v2_security_denial_review_signals"."last_seen_at")
        and isfinite("inbox_v2_security_denial_review_signals"."expires_at")
        and isfinite("inbox_v2_security_denial_review_signals"."created_at")
        and isfinite("inbox_v2_security_denial_review_signals"."updated_at")
        and "inbox_v2_security_denial_review_signals"."first_seen_at" >= "inbox_v2_security_denial_review_signals"."window_started_at"
        and "inbox_v2_security_denial_review_signals"."last_seen_at" >= "inbox_v2_security_denial_review_signals"."first_seen_at"
        and "inbox_v2_security_denial_review_signals"."last_seen_at" < "inbox_v2_security_denial_review_signals"."window_ended_at"
        and "inbox_v2_security_denial_review_signals"."updated_at" >= "inbox_v2_security_denial_review_signals"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_security_denial_window_shards" (
	"tenant_id" text NOT NULL,
	"window_started_at" timestamp (3) with time zone NOT NULL,
	"shard_no" smallint NOT NULL,
	"window_ended_at" timestamp (3) with time zone NOT NULL,
	"policy_id" text NOT NULL,
	"attempt_count" bigint NOT NULL,
	"admitted_detail_bucket_count" smallint NOT NULL,
	"admitted_review_candidate_count" smallint NOT NULL,
	"overflow_count" bigint NOT NULL,
	"counter_saturated" boolean NOT NULL,
	"first_seen_at" timestamp (3) with time zone NOT NULL,
	"last_seen_at" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_security_denial_window_shards_pk" PRIMARY KEY("tenant_id","window_started_at","shard_no"),
	CONSTRAINT "inbox_v2_security_denial_window_policy_check" CHECK ("inbox_v2_security_denial_window_shards"."policy_id" = 'core:security-denial-policy.default-v1'
        and "inbox_v2_security_denial_window_shards"."shard_no" between 0 and 16 - 1
        and "inbox_v2_security_denial_window_shards"."window_ended_at" =
          "inbox_v2_security_denial_window_shards"."window_started_at" + make_interval(secs => 3600)
        and "inbox_v2_security_denial_window_shards"."expires_at" =
          "inbox_v2_security_denial_window_shards"."window_started_at" + make_interval(secs => 2592000)),
	CONSTRAINT "inbox_v2_security_denial_window_counts_check" CHECK ("inbox_v2_security_denial_window_shards"."attempt_count" >= 1
        and "inbox_v2_security_denial_window_shards"."admitted_detail_bucket_count"
          between 0 and 16
        and "inbox_v2_security_denial_window_shards"."admitted_review_candidate_count"
          between 0 and 4
        and "inbox_v2_security_denial_window_shards"."admitted_detail_bucket_count" <= "inbox_v2_security_denial_window_shards"."attempt_count"
        and "inbox_v2_security_denial_window_shards"."admitted_review_candidate_count" <=
          "inbox_v2_security_denial_window_shards"."admitted_detail_bucket_count"
        and "inbox_v2_security_denial_window_shards"."overflow_count" between 0 and "inbox_v2_security_denial_window_shards"."attempt_count"),
	CONSTRAINT "inbox_v2_security_denial_window_times_check" CHECK (isfinite("inbox_v2_security_denial_window_shards"."window_started_at")
        and isfinite("inbox_v2_security_denial_window_shards"."window_ended_at")
        and isfinite("inbox_v2_security_denial_window_shards"."first_seen_at")
        and isfinite("inbox_v2_security_denial_window_shards"."last_seen_at")
        and isfinite("inbox_v2_security_denial_window_shards"."expires_at")
        and isfinite("inbox_v2_security_denial_window_shards"."created_at")
        and isfinite("inbox_v2_security_denial_window_shards"."updated_at")
        and "inbox_v2_security_denial_window_shards"."first_seen_at" >= "inbox_v2_security_denial_window_shards"."window_started_at"
        and "inbox_v2_security_denial_window_shards"."last_seen_at" >= "inbox_v2_security_denial_window_shards"."first_seen_at"
        and "inbox_v2_security_denial_window_shards"."last_seen_at" < "inbox_v2_security_denial_window_shards"."window_ended_at"
        and "inbox_v2_security_denial_window_shards"."updated_at" >= "inbox_v2_security_denial_window_shards"."created_at")
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_security_denial_buckets" ADD CONSTRAINT "inbox_v2_security_denial_buckets_window_fk" FOREIGN KEY ("tenant_id","window_started_at","shard_no") REFERENCES "public"."inbox_v2_security_denial_window_shards"("tenant_id","window_started_at","shard_no") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_security_denial_review_signals" ADD CONSTRAINT "inbox_v2_security_denial_review_signals_window_fk" FOREIGN KEY ("tenant_id","window_started_at","shard_no") REFERENCES "public"."inbox_v2_security_denial_window_shards"("tenant_id","window_started_at","shard_no") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_security_denial_review_signals" ADD CONSTRAINT "inbox_v2_security_denial_review_signals_bucket_fk" FOREIGN KEY ("tenant_id","window_started_at","shard_no","candidate_fingerprint") REFERENCES "public"."inbox_v2_security_denial_buckets"("tenant_id","window_started_at","shard_no","dedupe_fingerprint") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_security_denial_window_shards" ADD CONSTRAINT "inbox_v2_security_denial_window_shards_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_buckets_action_idx" ON "inbox_v2_security_denial_buckets" USING btree ("tenant_id","action","last_seen_at" DESC NULLS LAST,"dedupe_fingerprint");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_buckets_expiry_idx" ON "inbox_v2_security_denial_buckets" USING btree ("tenant_id","expires_at","window_started_at","shard_no","dedupe_fingerprint");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_review_status_idx" ON "inbox_v2_security_denial_review_signals" USING btree ("tenant_id","status","review_sequence" DESC NULLS LAST,"window_started_at" DESC NULLS LAST,"shard_no","review_type","aggregation_kind","aggregation_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_review_sequence_idx" ON "inbox_v2_security_denial_review_signals" USING btree ("tenant_id","review_sequence" DESC NULLS LAST,"window_started_at" DESC NULLS LAST,"shard_no","review_type","aggregation_kind","aggregation_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_review_type_sequence_idx" ON "inbox_v2_security_denial_review_signals" USING btree ("tenant_id","review_type","review_sequence" DESC NULLS LAST,"window_started_at" DESC NULLS LAST,"shard_no","aggregation_kind","aggregation_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_review_status_type_sequence_idx" ON "inbox_v2_security_denial_review_signals" USING btree ("tenant_id","status","review_type","review_sequence" DESC NULLS LAST,"window_started_at" DESC NULLS LAST,"shard_no","aggregation_kind","aggregation_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_review_expiry_idx" ON "inbox_v2_security_denial_review_signals" USING btree ("tenant_id","expires_at","window_started_at","shard_no","review_type");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_window_expiry_idx" ON "inbox_v2_security_denial_window_shards" USING btree ("tenant_id","expires_at","window_started_at","shard_no");
--> statement-breakpoint
CREATE INDEX "inbox_v2_security_denial_window_activity_idx" ON "inbox_v2_security_denial_window_shards" USING btree ("tenant_id","last_seen_at" DESC NULLS LAST,"window_started_at","shard_no");
--> statement-breakpoint
create or replace function public.inbox_v2_security_denial_record(
  p_tenant_id text,
  p_action public.inbox_v2_security_denial_action,
  p_principal_class public.inbox_v2_security_denial_principal_class,
	  p_fingerprint_key_epoch text,
	  p_actor_fingerprint text,
	  p_dedupe_fingerprint text,
	  p_observation_receipt text,
	  p_denial_kind public.inbox_v2_security_denial_kind,
  p_public_error_class public.inbox_v2_security_denial_public_error_class,
	  p_risk public.inbox_v2_security_denial_risk,
  p_review_type public.inbox_v2_security_denial_review_type,
  p_alert_type public.inbox_v2_security_denial_alert_type,
  p_candidate_ref text,
  p_policy_id text,
  p_window_seconds integer,
  p_retention_seconds integer,
  p_shard_count integer,
  p_detail_bucket_limit_per_shard integer,
  p_review_candidate_limit_per_shard integer,
  p_attempt_rate_limit_per_shard integer,
  p_lock_timeout_milliseconds integer,
  p_statement_timeout_milliseconds integer
)
	returns table (
	  observation_receipt text,
	  observed_at timestamptz,
	  disposition public.inbox_v2_security_denial_disposition,
  shard_no smallint,
  window_started_at timestamptz,
  window_ended_at timestamptz,
  expires_at timestamptz,
  shard_attempt_count bigint,
  detail_occurrence_count bigint,
  admitted_detail_bucket_count smallint,
  overflow_count bigint,
  counter_saturated boolean,
  review_types public.inbox_v2_security_denial_review_type[],
  review_dispositions public.inbox_v2_security_denial_review_disposition[]
)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
	  v_bigint_max constant bigint := 9223372036854775807;
	  v_observed_at timestamptz := date_trunc(
	    'milliseconds', clock_timestamp()
	  );
  v_window_started_at timestamptz;
  v_window_ended_at timestamptz;
  v_expires_at timestamptz;
  v_shard_no smallint;
  v_shard public.inbox_v2_security_denial_window_shards%rowtype;
  v_bucket public.inbox_v2_security_denial_buckets%rowtype;
  v_review public.inbox_v2_security_denial_review_signals%rowtype;
  v_detail_exists boolean := false;
  v_rate_limited boolean := false;
  v_volume_exceeded boolean := false;
  v_local_saturated boolean := false;
  v_expected_risk public.inbox_v2_security_denial_risk;
  v_expected_review_type public.inbox_v2_security_denial_review_type;
  v_expected_alert_type public.inbox_v2_security_denial_alert_type;
  v_pending_review_types public.inbox_v2_security_denial_review_type[] :=
    array[]::public.inbox_v2_security_denial_review_type[];
  v_pending_alert_types public.inbox_v2_security_denial_alert_type[] :=
    array[]::public.inbox_v2_security_denial_alert_type[];
  v_pending_candidate public.inbox_v2_security_denial_review_type[] :=
    array[]::public.inbox_v2_security_denial_review_type[];
  v_review_types public.inbox_v2_security_denial_review_type[] :=
    array[]::public.inbox_v2_security_denial_review_type[];
  v_review_dispositions public.inbox_v2_security_denial_review_disposition[] :=
    array[]::public.inbox_v2_security_denial_review_disposition[];
  v_current_review_type public.inbox_v2_security_denial_review_type;
  v_current_alert_type public.inbox_v2_security_denial_alert_type;
  v_current_candidate boolean;
  v_current_risk public.inbox_v2_security_denial_risk;
	  v_index integer;
begin
  if p_policy_id is distinct from 'core:security-denial-policy.default-v1'
    or p_window_seconds is distinct from 3600
    or p_retention_seconds is distinct from 2592000
    or p_shard_count is distinct from 16
    or p_detail_bucket_limit_per_shard is distinct from
      16
    or p_review_candidate_limit_per_shard is distinct from
      4
    or p_attempt_rate_limit_per_shard is distinct from
      600
    or p_lock_timeout_milliseconds is distinct from
      100
    or p_statement_timeout_milliseconds is distinct from
      500
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_policy_mismatch';
  end if;

  perform pg_catalog.set_config(
    'lock_timeout', '100ms', true
  );
  perform pg_catalog.set_config(
    'statement_timeout', '500ms', true
  );

  if p_tenant_id is null or char_length(p_tenant_id) = 0
    or p_action is null
    or p_principal_class is null
    or p_fingerprint_key_epoch is null
    or p_fingerprint_key_epoch !~
      '^security-denial-key:[a-f0-9]{16,32}$'
    or p_actor_fingerprint is null
    or p_actor_fingerprint !~ '^hmac-sha256:[a-f0-9]{64}$'
	    or p_dedupe_fingerprint is null
	    or p_dedupe_fingerprint !~ '^hmac-sha256:[a-f0-9]{64}$'
	    or p_actor_fingerprint = p_dedupe_fingerprint
	    or p_observation_receipt is null
	    or p_observation_receipt !~
	      '^security-denial-observation:[a-f0-9]{64}$'
	    or p_denial_kind is null
    or p_public_error_class is null
	    or p_risk is null
    or (p_candidate_ref is not null and
      p_candidate_ref !~ '^internal-ref:[a-f0-9]{32,64}$')
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_input_invalid';
  end if;

  if p_denial_kind in (
      'unknown_or_hidden_resource', 'cross_tenant_probe'
    ) and p_public_error_class <> 'not_found'
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_public_class_invalid';
  end if;

  if (p_denial_kind = 'manual_self_claim') is distinct from
    (p_action = 'identity.claim'
      and p_public_error_class = 'identity_claim_self_forbidden')
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_manual_self_claim_invalid';
  end if;

  v_expected_risk := case
    when p_denial_kind = 'cross_tenant_probe'
      or p_action = 'privacy.deletion.execute'
      then 'critical'::public.inbox_v2_security_denial_risk
    when p_denial_kind in (
        'manual_self_claim', 'unknown_or_hidden_resource'
      ) or p_action in (
        'authorization.privileged_mutation', 'identity.claim'
      ) or p_action::text like 'privacy.%'
      then 'high'::public.inbox_v2_security_denial_risk
    when p_denial_kind in ('state_guard', 'other_denied')
      then 'low'::public.inbox_v2_security_denial_risk
    else 'medium'::public.inbox_v2_security_denial_risk
  end;
  if p_risk is distinct from v_expected_risk then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_risk_invalid';
  end if;

  if p_denial_kind = 'manual_self_claim' then
    v_expected_review_type := 'manual_self_claim';
    v_expected_alert_type := 'identity_claim_review';
  elsif p_action::text like 'privacy.%' then
    v_expected_review_type := case p_action
      when 'privacy.hold.issue' then 'privacy_hold_issue_denied'
      when 'privacy.hold.release' then 'privacy_hold_release_denied'
      when 'privacy.subject_evidence.view' then
        'privacy_evidence_access_denied'
      when 'privacy.tenant_export' then 'tenant_export_denied'
      when 'privacy.deletion.preview' then 'destructive_preview_denied'
      when 'privacy.deletion.approve' then 'destructive_approval_denied'
      when 'privacy.deletion.execute' then 'destructive_execution_denied'
      else null
    end;
    v_expected_alert_type := 'privacy_control_review';
  elsif p_denial_kind = 'cross_tenant_probe' then
    v_expected_review_type := 'cross_tenant_probe';
    v_expected_alert_type := 'security_probe_review';
  elsif p_denial_kind = 'unknown_or_hidden_resource' then
    v_expected_review_type := 'guessed_identifier_probe';
    v_expected_alert_type := 'security_probe_review';
  end if;

  if v_expected_review_type is null then
    if p_review_type is not null or p_alert_type is not null
      or p_candidate_ref is not null
    then
      raise exception using
        errcode = '22023',
        message = 'inbox_v2.security_denial_review_invalid';
    end if;
  elsif p_review_type is distinct from v_expected_review_type
    or p_alert_type is distinct from v_expected_alert_type
    or (p_denial_kind <> 'manual_self_claim'
      and p_candidate_ref is not null)
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_review_invalid';
  end if;

	  v_window_started_at := date_bin(
	    make_interval(secs => 3600),
	    v_observed_at,
    timestamptz '1970-01-01 00:00:00+00'
  );
  v_window_ended_at := v_window_started_at +
    make_interval(secs => 3600);
  v_expires_at := v_window_started_at +
    make_interval(secs => 2592000);
  v_shard_no := (
    (('x' || substring(p_actor_fingerprint from 13 for 8))::bit(32)::bigint)
      % 16
  )::smallint;

  insert into public.inbox_v2_security_denial_window_shards as shard (
    tenant_id,
    window_started_at,
    shard_no,
    window_ended_at,
    policy_id,
    attempt_count,
    admitted_detail_bucket_count,
    admitted_review_candidate_count,
    overflow_count,
    counter_saturated,
    first_seen_at,
    last_seen_at,
    expires_at,
    created_at,
    updated_at
  ) values (
    p_tenant_id,
    v_window_started_at,
    v_shard_no,
    v_window_ended_at,
    p_policy_id,
    1,
    0,
    0,
    0,
    false,
    v_observed_at,
    v_observed_at,
    v_expires_at,
    v_observed_at,
    v_observed_at
  )
  on conflict on constraint inbox_v2_security_denial_window_shards_pk
  do update
  set attempt_count = case
        when shard.attempt_count = v_bigint_max then v_bigint_max
        else shard.attempt_count + 1
      end,
      counter_saturated = shard.counter_saturated
        or shard.attempt_count >= v_bigint_max - 1,
      first_seen_at = least(shard.first_seen_at, excluded.first_seen_at),
      last_seen_at = greatest(shard.last_seen_at, excluded.last_seen_at),
      updated_at = v_observed_at
  returning shard.* into v_shard;

  v_rate_limited :=
    v_shard.attempt_count > 600;

  if not v_rate_limited then
    select bucket.*
    into v_bucket
    from public.inbox_v2_security_denial_buckets as bucket
    where bucket.tenant_id = p_tenant_id
      and bucket.window_started_at = v_window_started_at
      and bucket.shard_no = v_shard_no
      and bucket.dedupe_fingerprint = p_dedupe_fingerprint
    for update;

    if found then
      if v_bucket.action is distinct from p_action
        or v_bucket.principal_class is distinct from p_principal_class
        or v_bucket.fingerprint_key_epoch is distinct from
          p_fingerprint_key_epoch
        or v_bucket.actor_fingerprint is distinct from p_actor_fingerprint
        or v_bucket.denial_kind is distinct from p_denial_kind
        or v_bucket.public_error_class is distinct from p_public_error_class
        or v_bucket.risk is distinct from p_risk
      then
        raise exception using
          errcode = '23505',
          message = 'inbox_v2.security_denial_fingerprint_conflict';
      end if;

      update public.inbox_v2_security_denial_buckets as bucket
      set occurrence_count = case
            when bucket.occurrence_count = v_bigint_max then v_bigint_max
            else bucket.occurrence_count + 1
          end,
          first_seen_at = least(bucket.first_seen_at, v_observed_at),
          last_seen_at = greatest(bucket.last_seen_at, v_observed_at),
          updated_at = v_observed_at
      where bucket.tenant_id = p_tenant_id
        and bucket.window_started_at = v_window_started_at
        and bucket.shard_no = v_shard_no
        and bucket.dedupe_fingerprint = p_dedupe_fingerprint
      returning bucket.* into v_bucket;
      v_local_saturated := v_bucket.occurrence_count = v_bigint_max;
      disposition := 'deduplicated';
      detail_occurrence_count := v_bucket.occurrence_count;
      v_detail_exists := true;
    elsif v_shard.admitted_detail_bucket_count <
      16
    then
      insert into public.inbox_v2_security_denial_buckets (
        tenant_id,
        window_started_at,
        shard_no,
        dedupe_fingerprint,
        window_ended_at,
        expires_at,
        action,
        principal_class,
        fingerprint_key_epoch,
        actor_fingerprint,
        denial_kind,
        public_error_class,
        risk,
        occurrence_count,
        first_seen_at,
        last_seen_at,
        created_at,
        updated_at
      ) values (
        p_tenant_id,
        v_window_started_at,
        v_shard_no,
        p_dedupe_fingerprint,
        v_window_ended_at,
        v_expires_at,
        p_action,
        p_principal_class,
        p_fingerprint_key_epoch,
        p_actor_fingerprint,
        p_denial_kind,
        p_public_error_class,
        p_risk,
        1,
        v_observed_at,
        v_observed_at,
        v_observed_at,
        v_observed_at
      );
      update public.inbox_v2_security_denial_window_shards as shard
      set admitted_detail_bucket_count =
            shard.admitted_detail_bucket_count + 1,
          updated_at = v_observed_at
      where shard.tenant_id = p_tenant_id
        and shard.window_started_at = v_window_started_at
        and shard.shard_no = v_shard_no
      returning shard.* into v_shard;
      disposition := 'recorded';
      detail_occurrence_count := 1;
      v_detail_exists := true;
    else
      disposition := 'aggregated_overflow';
      detail_occurrence_count := null;
      v_volume_exceeded := true;
    end if;
  else
    disposition := 'rate_limited';
    detail_occurrence_count := null;
  end if;

  if not v_detail_exists then
    update public.inbox_v2_security_denial_window_shards as shard
    set overflow_count = case
          when shard.overflow_count = v_bigint_max then v_bigint_max
          else shard.overflow_count + 1
        end,
        counter_saturated = shard.counter_saturated
          or shard.overflow_count >= v_bigint_max - 1,
        updated_at = v_observed_at
    where shard.tenant_id = p_tenant_id
      and shard.window_started_at = v_window_started_at
      and shard.shard_no = v_shard_no
    returning shard.* into v_shard;
  end if;

  if v_expected_review_type is not null then
    v_pending_review_types := array_append(
      v_pending_review_types, v_expected_review_type
    );
    v_pending_alert_types := array_append(
      v_pending_alert_types, v_expected_alert_type
    );
    if v_detail_exists then
      v_pending_candidate := array_append(
        v_pending_candidate, v_expected_review_type
      );
    end if;
  end if;
  if v_rate_limited then
    v_pending_review_types := array_append(
      v_pending_review_types, 'denial_rate_exceeded'
    );
    v_pending_alert_types := array_append(
      v_pending_alert_types, 'abuse_threshold_alert'
    );
  end if;
  if v_volume_exceeded then
    v_pending_review_types := array_append(
      v_pending_review_types, 'denial_volume_exceeded'
    );
    v_pending_alert_types := array_append(
      v_pending_alert_types, 'abuse_threshold_alert'
    );
  end if;

  if cardinality(v_pending_review_types) > 3
    or cardinality(v_pending_review_types) <>
      cardinality(v_pending_alert_types)
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.security_denial_review_budget_invalid';
  end if;

  for v_index in
    select generate_subscripts(v_pending_review_types, 1)
  loop
    v_current_review_type := v_pending_review_types[v_index];
    v_current_alert_type := v_pending_alert_types[v_index];
    v_current_candidate :=
      v_current_review_type = any(v_pending_candidate);
    v_current_risk := case
      when v_current_review_type in (
        'denial_rate_exceeded', 'denial_volume_exceeded'
      ) then 'high'::public.inbox_v2_security_denial_risk
      else p_risk
    end;

    if v_current_candidate then
      select review.*
      into v_review
      from public.inbox_v2_security_denial_review_signals as review
      where review.tenant_id = p_tenant_id
        and review.window_started_at = v_window_started_at
        and review.shard_no = v_shard_no
        and review.review_type = v_current_review_type
        and review.aggregation_kind = 'candidate'
        and review.candidate_fingerprint = p_dedupe_fingerprint
      for update;

      if found then
        if v_review.alert_type is distinct from v_current_alert_type
          or v_review.candidate_ref is distinct from p_candidate_ref
          or v_review.risk is distinct from v_current_risk
        then
          raise exception using
            errcode = '23505',
            message = 'inbox_v2.security_denial_review_conflict';
        end if;
        update public.inbox_v2_security_denial_review_signals as review
        set trigger_count = case
              when review.trigger_count = v_bigint_max then v_bigint_max
              else review.trigger_count + 1
            end,
            first_seen_at = least(review.first_seen_at, v_observed_at),
            last_seen_at = greatest(review.last_seen_at, v_observed_at),
            updated_at = v_observed_at
        where review.tenant_id = p_tenant_id
          and review.window_started_at = v_window_started_at
          and review.shard_no = v_shard_no
          and review.review_type = v_current_review_type
          and review.aggregation_kind = 'candidate'
          and review.candidate_fingerprint = p_dedupe_fingerprint
        returning review.* into v_review;
        v_local_saturated := v_local_saturated
          or v_review.trigger_count = v_bigint_max;
        v_review_types := array_append(
          v_review_types, v_current_review_type
        );
        v_review_dispositions := array_append(
          v_review_dispositions, 'candidate_aggregated'
        );
        continue;
      elsif v_shard.admitted_review_candidate_count <
        4
      then
        insert into public.inbox_v2_security_denial_review_signals (
          tenant_id,
          window_started_at,
          shard_no,
          review_type,
          aggregation_kind,
          candidate_fingerprint,
          alert_type,
          candidate_ref,
          risk,
          status,
          trigger_count,
          window_ended_at,
          first_seen_at,
          last_seen_at,
          expires_at,
          created_at,
          updated_at
        ) values (
          p_tenant_id,
          v_window_started_at,
          v_shard_no,
          v_current_review_type,
          'candidate',
          p_dedupe_fingerprint,
          v_current_alert_type,
          p_candidate_ref,
          v_current_risk,
          'open',
          1,
          v_window_ended_at,
          v_observed_at,
          v_observed_at,
          v_expires_at,
          v_observed_at,
          v_observed_at
        );
        update public.inbox_v2_security_denial_window_shards as shard
        set admitted_review_candidate_count =
              shard.admitted_review_candidate_count + 1,
            updated_at = v_observed_at
        where shard.tenant_id = p_tenant_id
          and shard.window_started_at = v_window_started_at
          and shard.shard_no = v_shard_no
        returning shard.* into v_shard;
        v_review_types := array_append(
          v_review_types, v_current_review_type
        );
        v_review_dispositions := array_append(
          v_review_dispositions, 'candidate_created'
        );
        continue;
      end if;
    end if;

    select review.*
    into v_review
    from public.inbox_v2_security_denial_review_signals as review
    where review.tenant_id = p_tenant_id
      and review.window_started_at = v_window_started_at
      and review.shard_no = v_shard_no
      and review.review_type = v_current_review_type
      and review.aggregation_kind = 'overflow'
    for update;
    if found then
      if v_review.alert_type is distinct from v_current_alert_type then
        raise exception using
          errcode = '23505',
          message = 'inbox_v2.security_denial_review_conflict';
      end if;
      update public.inbox_v2_security_denial_review_signals as review
      set trigger_count = case
            when review.trigger_count = v_bigint_max then v_bigint_max
            else review.trigger_count + 1
          end,
          risk = case
            when review.risk = 'critical' or v_current_risk = 'critical'
              then 'critical'::public.inbox_v2_security_denial_risk
            when review.risk = 'high' or v_current_risk = 'high'
              then 'high'::public.inbox_v2_security_denial_risk
            when review.risk = 'medium' or v_current_risk = 'medium'
              then 'medium'::public.inbox_v2_security_denial_risk
            else 'low'::public.inbox_v2_security_denial_risk
          end,
          first_seen_at = least(review.first_seen_at, v_observed_at),
          last_seen_at = greatest(review.last_seen_at, v_observed_at),
          updated_at = v_observed_at
      where review.tenant_id = p_tenant_id
        and review.window_started_at = v_window_started_at
        and review.shard_no = v_shard_no
        and review.review_type = v_current_review_type
        and review.aggregation_kind = 'overflow'
      returning review.* into v_review;
      v_local_saturated := v_local_saturated
        or v_review.trigger_count = v_bigint_max;
      v_review_types := array_append(v_review_types, v_current_review_type);
      v_review_dispositions := array_append(
        v_review_dispositions, 'overflow_aggregated'
      );
    else
      insert into public.inbox_v2_security_denial_review_signals (
        tenant_id,
        window_started_at,
        shard_no,
        review_type,
        aggregation_kind,
        candidate_fingerprint,
        alert_type,
        candidate_ref,
        risk,
        status,
        trigger_count,
        window_ended_at,
        first_seen_at,
        last_seen_at,
        expires_at,
        created_at,
        updated_at
      ) values (
        p_tenant_id,
        v_window_started_at,
        v_shard_no,
        v_current_review_type,
        'overflow',
        null,
        v_current_alert_type,
        null,
        v_current_risk,
        'open',
        1,
        v_window_ended_at,
        v_observed_at,
        v_observed_at,
        v_expires_at,
        v_observed_at,
        v_observed_at
      );
      v_review_types := array_append(v_review_types, v_current_review_type);
      v_review_dispositions := array_append(
        v_review_dispositions, 'overflow_created'
      );
    end if;
  end loop;

  if v_local_saturated then
    update public.inbox_v2_security_denial_window_shards as shard
    set counter_saturated = true,
        updated_at = v_observed_at
    where shard.tenant_id = p_tenant_id
      and shard.window_started_at = v_window_started_at
      and shard.shard_no = v_shard_no
    returning shard.* into v_shard;
  end if;

  observation_receipt := p_observation_receipt;
  observed_at := v_observed_at;
  shard_no := v_shard_no;
  window_started_at := v_window_started_at;
  window_ended_at := v_window_ended_at;
  expires_at := v_expires_at;
  shard_attempt_count := v_shard.attempt_count;
  admitted_detail_bucket_count := v_shard.admitted_detail_bucket_count;
  overflow_count := v_shard.overflow_count;
  counter_saturated := v_shard.counter_saturated;
  review_types := v_review_types;
  review_dispositions := v_review_dispositions;
  return next;
end;
$function$;

create or replace function public.inbox_v2_security_denial_prune(
  p_tenant_id text,
  p_batch_size integer
)
returns table (deleted_window_count bigint)
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_pruned_at timestamptz := clock_timestamp();
begin
  if p_tenant_id is null or char_length(p_tenant_id) = 0
    or p_batch_size is null or p_batch_size < 1 or p_batch_size > 1000
  then
    raise exception using
      errcode = '22023',
      message = 'inbox_v2.security_denial_prune_input_invalid';
  end if;

  perform pg_catalog.set_config('lock_timeout', '100ms', true);
  perform pg_catalog.set_config('statement_timeout', '500ms', true);

  return query
  with expired as (
    select shard.tenant_id, shard.window_started_at, shard.shard_no
    from public.inbox_v2_security_denial_window_shards as shard
    where shard.tenant_id = p_tenant_id
      and shard.expires_at <= v_pruned_at
    order by shard.expires_at, shard.window_started_at, shard.shard_no
    for update skip locked
    limit p_batch_size
  ), deleted as (
    delete from public.inbox_v2_security_denial_window_shards as shard
    using expired
    where shard.tenant_id = expired.tenant_id
      and shard.window_started_at = expired.window_started_at
      and shard.shard_no = expired.shard_no
    returning 1
  )
  select count(*)::bigint from deleted;
end;
$function$;

create or replace function public.inbox_v2_security_denial_integrity_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_window_started_at timestamptz;
  v_shard_no smallint;
  v_shard public.inbox_v2_security_denial_window_shards%rowtype;
  v_detail_count bigint;
  v_review_candidate_count bigint;
  v_current_window_started_at timestamptz;
begin
  if tg_when = 'BEFORE' then
    if tg_table_name = 'inbox_v2_security_denial_window_shards' then
      if tg_op = 'UPDATE' and (
        new.tenant_id is distinct from old.tenant_id
        or new.window_started_at is distinct from old.window_started_at
        or new.shard_no is distinct from old.shard_no
      ) then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.security_denial_identity_immutable';
      end if;
      if tg_op = 'INSERT' then
        v_current_window_started_at := date_bin(
          make_interval(secs => 3600),
          clock_timestamp(),
          timestamptz '1970-01-01 00:00:00+00'
        );
        if new.window_started_at < v_current_window_started_at -
            make_interval(secs => 3600)
          or new.window_started_at > v_current_window_started_at
        then
          raise exception using
            errcode = '23514',
            message = 'inbox_v2.security_denial_window_clock_invalid';
        end if;
      end if;
    elsif tg_table_name = 'inbox_v2_security_denial_buckets' then
      if tg_op = 'INSERT' then
        select shard.*
          into v_shard
          from public.inbox_v2_security_denial_window_shards as shard
         where shard.tenant_id = new.tenant_id
           and shard.window_started_at = new.window_started_at
           and shard.shard_no = new.shard_no
         for update;
        if not found then
          raise exception using
            errcode = '23514',
            message = 'inbox_v2.security_denial_parent_missing';
        end if;
        select count(*)::bigint
          into v_detail_count
          from public.inbox_v2_security_denial_buckets as bucket
         where bucket.tenant_id = new.tenant_id
           and bucket.window_started_at = new.window_started_at
           and bucket.shard_no = new.shard_no;
        if v_detail_count >= 16 then
          raise exception using
            errcode = '23514',
            message = 'inbox_v2.security_denial_detail_budget_exceeded';
        end if;
      elsif new.tenant_id is distinct from old.tenant_id
        or new.window_started_at is distinct from old.window_started_at
        or new.shard_no is distinct from old.shard_no
        or new.dedupe_fingerprint is distinct from old.dedupe_fingerprint
      then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.security_denial_identity_immutable';
      end if;
    elsif tg_table_name = 'inbox_v2_security_denial_review_signals' then
      if tg_op = 'INSERT' then
        new.review_sequence := nextval(
          pg_get_serial_sequence(
            'public.inbox_v2_security_denial_review_signals',
            'review_sequence'
          )
        );
        if new.aggregation_kind = 'candidate' then
          select shard.*
            into v_shard
            from public.inbox_v2_security_denial_window_shards as shard
           where shard.tenant_id = new.tenant_id
             and shard.window_started_at = new.window_started_at
             and shard.shard_no = new.shard_no
           for update;
          if not found then
            raise exception using
              errcode = '23514',
              message = 'inbox_v2.security_denial_parent_missing';
          end if;
          select count(*)::bigint
            into v_review_candidate_count
            from public.inbox_v2_security_denial_review_signals as review
           where review.tenant_id = new.tenant_id
             and review.window_started_at = new.window_started_at
             and review.shard_no = new.shard_no
             and review.aggregation_kind = 'candidate';
          if v_review_candidate_count >= 4 then
            raise exception using
              errcode = '23514',
              message = 'inbox_v2.security_denial_review_budget_exceeded';
          end if;
        end if;
      elsif new.tenant_id is distinct from old.tenant_id
        or new.review_sequence is distinct from old.review_sequence
        or new.window_started_at is distinct from old.window_started_at
        or new.shard_no is distinct from old.shard_no
        or new.review_type is distinct from old.review_type
        or new.aggregation_kind is distinct from old.aggregation_kind
        or new.candidate_fingerprint is distinct from old.candidate_fingerprint
      then
        raise exception using
          errcode = '23514',
          message = 'inbox_v2.security_denial_identity_immutable';
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    v_tenant_id := old.tenant_id;
    v_window_started_at := old.window_started_at;
    v_shard_no := old.shard_no;
  else
    v_tenant_id := new.tenant_id;
    v_window_started_at := new.window_started_at;
    v_shard_no := new.shard_no;
  end if;

  select shard.*
    into v_shard
    from public.inbox_v2_security_denial_window_shards as shard
   where shard.tenant_id = v_tenant_id
     and shard.window_started_at = v_window_started_at
     and shard.shard_no = v_shard_no;
  if not found then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  select count(*)::bigint
    into v_detail_count
    from public.inbox_v2_security_denial_buckets as bucket
   where bucket.tenant_id = v_tenant_id
     and bucket.window_started_at = v_window_started_at
     and bucket.shard_no = v_shard_no;
  select count(*)::bigint
    into v_review_candidate_count
    from public.inbox_v2_security_denial_review_signals as review
   where review.tenant_id = v_tenant_id
     and review.window_started_at = v_window_started_at
     and review.shard_no = v_shard_no
     and review.aggregation_kind = 'candidate';

  if v_detail_count > 16
    or v_review_candidate_count > 4
    or v_detail_count is distinct from
      v_shard.admitted_detail_bucket_count::bigint
    or v_review_candidate_count is distinct from
      v_shard.admitted_review_candidate_count::bigint
  then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.security_denial_cardinality_invalid';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$function$;

create trigger inbox_v2_security_denial_window_guard
before insert or update on public.inbox_v2_security_denial_window_shards
for each row execute function public.inbox_v2_security_denial_integrity_guard();

create trigger inbox_v2_security_denial_bucket_guard
before insert or update on public.inbox_v2_security_denial_buckets
for each row execute function public.inbox_v2_security_denial_integrity_guard();

create trigger inbox_v2_security_denial_review_guard
before insert or update on public.inbox_v2_security_denial_review_signals
for each row execute function public.inbox_v2_security_denial_integrity_guard();

create constraint trigger inbox_v2_security_denial_window_cardinality
after insert or update or delete on public.inbox_v2_security_denial_window_shards
deferrable initially deferred
for each row execute function public.inbox_v2_security_denial_integrity_guard();

create constraint trigger inbox_v2_security_denial_bucket_cardinality
after insert or update or delete on public.inbox_v2_security_denial_buckets
deferrable initially deferred
for each row execute function public.inbox_v2_security_denial_integrity_guard();

create constraint trigger inbox_v2_security_denial_review_cardinality
after insert or update or delete on public.inbox_v2_security_denial_review_signals
deferrable initially deferred
for each row execute function public.inbox_v2_security_denial_integrity_guard();
