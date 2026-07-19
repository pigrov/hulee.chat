CREATE TYPE "public"."inbox_v2_file_attachment_materialization_outcome" AS ENUM('ready', 'failed', 'quarantined');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_attachment_materialization_state" AS ENUM('pending', 'claimed', 'transferring', 'verifying', 'ready', 'failed', 'quarantined', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_attachment_source_locator_kind" AS ENUM('provider', 'upload_staging', 'derivative');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_object_operation_kind" AS ENUM('put', 'head', 'list_versions', 'quarantine', 'delete_current', 'delete_version', 'orphan_reconcile');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_object_operation_outcome" AS ENUM('succeeded', 'already_absent_verified', 'retryable_failure', 'terminal_failure', 'unsupported');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_object_state" AS ENUM('pending', 'ready', 'quarantined', 'unavailable', 'delete_pending', 'deleted');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_object_version_state" AS ENUM('staging', 'ready', 'quarantined', 'unavailable', 'delete_pending', 'deleted', 'delete_failed');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_object_versioning_mode" AS ENUM('native_version', 'immutable_key');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_outbound_artifact_grouping" AS ENUM('single', 'album', 'split');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_outbound_block_kind" AS ENUM('text', 'image', 'audio', 'video', 'file', 'sticker', 'location', 'contact', 'extension');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_parent_kind" AS ENUM('message', 'staff_note', 'upload_staging');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_parent_link_state" AS ENUM('live', 'detached');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_parent_purpose" AS ENUM('attachment', 'extension_payload');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_parent_set_completeness" AS ENUM('unknown', 'reconciling', 'complete');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_parent_visibility" AS ENUM('external_work', 'internal', 'staff_note', 'upload_staging');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_file_storage_orphan_state" AS ENUM('open', 'claimed', 'quarantined', 'adopted', 'deleted', 'failed');
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_attachment_materialization_attempts" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"job_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"file_id" text NOT NULL,
	"expected_file_revision" bigint NOT NULL,
	"lease_generation" bigint NOT NULL,
	"lease_token_hash" text NOT NULL,
	"lease_owner_id" text NOT NULL,
	"expected_job_revision" bigint NOT NULL,
	"expected_attachment_revision" bigint NOT NULL,
	"claimed_at" timestamp (3) with time zone NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_mat_attempts_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_mat_attempts_generation_unique" UNIQUE("tenant_id","job_id","lease_generation"),
	CONSTRAINT "inbox_v2_file_mat_attempts_scope_unique" UNIQUE("tenant_id","id","job_id","attachment_id","file_id","lease_generation"),
	CONSTRAINT "inbox_v2_file_mat_attempts_shape_check" CHECK (coalesce((char_length("inbox_v2_file_attachment_materialization_attempts"."id") <= 256
    and "inbox_v2_file_attachment_materialization_attempts"."id" ~ '^attachment_materialization_attempt:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_attempts"."lease_generation" >= 1
        and coalesce("inbox_v2_file_attachment_materialization_attempts"."lease_token_hash" ~ '^[a-f0-9]{64}$', false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_attempts"."lease_owner_id") <= 256 and (
    "inbox_v2_file_attachment_materialization_attempts"."lease_owner_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_attachment_materialization_attempts"."lease_owner_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and "inbox_v2_file_attachment_materialization_attempts"."expected_job_revision" >= 1
        and "inbox_v2_file_attachment_materialization_attempts"."expected_attachment_revision" >= 1
        and "inbox_v2_file_attachment_materialization_attempts"."expected_file_revision" >= 1
        and isfinite("inbox_v2_file_attachment_materialization_attempts"."claimed_at")
        and isfinite("inbox_v2_file_attachment_materialization_attempts"."lease_expires_at")
        and "inbox_v2_file_attachment_materialization_attempts"."lease_expires_at" > "inbox_v2_file_attachment_materialization_attempts"."claimed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_attachment_materialization_evidence" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"job_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"file_id" text NOT NULL,
	"expected_file_revision" bigint NOT NULL,
	"lease_generation" bigint NOT NULL,
	"expected_attachment_revision" bigint NOT NULL,
	"resulting_attachment_revision" bigint NOT NULL,
	"timeline_content_id" text NOT NULL,
	"expected_content_revision" bigint NOT NULL,
	"resulting_content_revision" bigint NOT NULL,
	"content_mutation_fence_sha256" text NOT NULL,
	"outcome" "inbox_v2_file_attachment_materialization_outcome" NOT NULL,
	"result_file_version_id" text,
	"result_object_version_id" text,
	"resulting_file_revision" bigint,
	"object_operation_evidence_id" text,
	"safe_reason_id" text,
	"retryable" boolean,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"evidence_hash_sha256" text NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_file_mat_evidence_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_mat_evidence_attempt_unique" UNIQUE("tenant_id","job_id","lease_generation"),
	CONSTRAINT "inbox_v2_file_mat_evidence_hash_unique" UNIQUE("tenant_id","evidence_hash_sha256"),
	CONSTRAINT "inbox_v2_file_mat_evidence_shape_check" CHECK (coalesce((char_length("inbox_v2_file_attachment_materialization_evidence"."id") <= 256
    and "inbox_v2_file_attachment_materialization_evidence"."id" ~ '^attachment_materialization_evidence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_evidence"."lease_generation" >= 1
        and "inbox_v2_file_attachment_materialization_evidence"."expected_attachment_revision" >= 1
        and "inbox_v2_file_attachment_materialization_evidence"."resulting_attachment_revision" =
          "inbox_v2_file_attachment_materialization_evidence"."expected_attachment_revision" + 1
        and coalesce((char_length("inbox_v2_file_attachment_materialization_evidence"."timeline_content_id") <= 256
    and "inbox_v2_file_attachment_materialization_evidence"."timeline_content_id" ~ '^timeline_content:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_evidence"."expected_content_revision" >= 1
        and "inbox_v2_file_attachment_materialization_evidence"."resulting_content_revision" =
          "inbox_v2_file_attachment_materialization_evidence"."expected_content_revision" + 1
        and coalesce("inbox_v2_file_attachment_materialization_evidence"."content_mutation_fence_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce("inbox_v2_file_attachment_materialization_evidence"."evidence_hash_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_attachment_materialization_evidence"."revision" = 1
        and isfinite("inbox_v2_file_attachment_materialization_evidence"."completed_at")
        and (
          ("inbox_v2_file_attachment_materialization_evidence"."outcome" = 'ready'
            and num_nonnulls(
              "inbox_v2_file_attachment_materialization_evidence"."result_file_version_id", "inbox_v2_file_attachment_materialization_evidence"."result_object_version_id",
              "inbox_v2_file_attachment_materialization_evidence"."resulting_file_revision",
              "inbox_v2_file_attachment_materialization_evidence"."object_operation_evidence_id"
            ) = 4
            and "inbox_v2_file_attachment_materialization_evidence"."resulting_file_revision" >= 2
            and "inbox_v2_file_attachment_materialization_evidence"."resulting_file_revision" =
              "inbox_v2_file_attachment_materialization_evidence"."expected_file_revision" + 1
            and "inbox_v2_file_attachment_materialization_evidence"."safe_reason_id" is null
            and "inbox_v2_file_attachment_materialization_evidence"."retryable" is null)
          or ("inbox_v2_file_attachment_materialization_evidence"."outcome" = 'failed'
            and num_nonnulls(
              "inbox_v2_file_attachment_materialization_evidence"."result_file_version_id", "inbox_v2_file_attachment_materialization_evidence"."result_object_version_id",
              "inbox_v2_file_attachment_materialization_evidence"."resulting_file_revision",
              "inbox_v2_file_attachment_materialization_evidence"."object_operation_evidence_id"
            ) = 0
            and coalesce((char_length("inbox_v2_file_attachment_materialization_evidence"."safe_reason_id") <= 256 and (
    "inbox_v2_file_attachment_materialization_evidence"."safe_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_attachment_materialization_evidence"."safe_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
            and "inbox_v2_file_attachment_materialization_evidence"."retryable" is not null)
          or ("inbox_v2_file_attachment_materialization_evidence"."outcome" = 'quarantined'
            and "inbox_v2_file_attachment_materialization_evidence"."result_file_version_id" is null
            and "inbox_v2_file_attachment_materialization_evidence"."result_object_version_id" is null
            and "inbox_v2_file_attachment_materialization_evidence"."resulting_file_revision" is null
            and "inbox_v2_file_attachment_materialization_evidence"."object_operation_evidence_id" is not null
            and coalesce((char_length("inbox_v2_file_attachment_materialization_evidence"."safe_reason_id") <= 256 and (
    "inbox_v2_file_attachment_materialization_evidence"."safe_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_attachment_materialization_evidence"."safe_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
            and "inbox_v2_file_attachment_materialization_evidence"."retryable" is null)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_attachment_materialization_jobs" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"attachment_id" text NOT NULL,
	"file_id" text NOT NULL,
	"expected_file_revision" bigint NOT NULL,
	"conversation_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"parent_message_id" text NOT NULL,
	"expected_parent_revision" bigint NOT NULL,
	"visibility_boundary" "inbox_v2_file_parent_visibility" NOT NULL,
	"timeline_content_id" text NOT NULL,
	"expected_content_revision" bigint NOT NULL,
	"content_block_key" text NOT NULL,
	"content_mutation_fence_sha256" text NOT NULL,
	"source_occurrence_id" text,
	"source_locator_kind" "inbox_v2_file_attachment_source_locator_kind" NOT NULL,
	"source_locator_reference" text NOT NULL,
	"source_locator_digest_sha256" text NOT NULL,
	"reservation_namespace_generation" text NOT NULL,
	"idempotency_token" text NOT NULL,
	"cause_event_id" text NOT NULL,
	"cause_mutation_id" text NOT NULL,
	"cause_stream_commit_id" text NOT NULL,
	"cause_stream_position" bigint NOT NULL,
	"correlation_id" text NOT NULL,
	"caused_at" timestamp (3) with time zone NOT NULL,
	"authorization_command_id" text NOT NULL,
	"authorization_command_type_id" text NOT NULL,
	"authorization_client_mutation_id" text NOT NULL,
	"authorization_mutation_id" text NOT NULL,
	"authorization_decision_id" text NOT NULL,
	"authorization_epoch" text NOT NULL,
	"authorization_actor_kind" "inbox_v2_auth_actor_kind" NOT NULL,
	"authorization_actor_id" text NOT NULL,
	"authorization_authorized_at" timestamp (3) with time zone NOT NULL,
	"authorization_decision_set_digest_sha256" text NOT NULL,
	"authorization_resource_fence_set_digest_sha256" text NOT NULL,
	"authorization_tenant_rbac_revision" bigint NOT NULL,
	"authorization_shared_access_revision" bigint NOT NULL,
	"authorization_resource_head_id" text NOT NULL,
	"authorization_resource_access_revision" bigint NOT NULL,
	"authorization_structural_relation_revision" bigint NOT NULL,
	"authorization_collaborator_set_revision" bigint NOT NULL,
	"authorization_audit_grant_source_ids" text[] NOT NULL,
	"authorization_audit_policy_version" text,
	"expected_attachment_revision" bigint NOT NULL,
	"state" "inbox_v2_file_attachment_materialization_state" DEFAULT 'pending' NOT NULL,
	"lease_generation" bigint DEFAULT 0 NOT NULL,
	"lease_token_hash" text,
	"lease_owner_id" text,
	"lease_claimed_at" timestamp (3) with time zone,
	"lease_expires_at" timestamp (3) with time zone,
	"reserved_file_version_id" text NOT NULL,
	"reserved_object_version_id" text NOT NULL,
	"reserved_storage_root_id" text NOT NULL,
	"reserved_storage_object_key" text NOT NULL,
	"result_file_version_id" text,
	"result_object_version_id" text,
	"result_file_revision" bigint,
	"result_content_revision" bigint,
	"terminal_reason_id" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_mat_jobs_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_mat_jobs_idempotency_unique" UNIQUE("tenant_id","attachment_id","idempotency_token"),
	CONSTRAINT "inbox_v2_file_mat_jobs_attachment_generation_unique" UNIQUE("tenant_id","attachment_id","expected_attachment_revision"),
	CONSTRAINT "inbox_v2_file_mat_jobs_scope_unique" UNIQUE("tenant_id","id","attachment_id","file_id"),
	CONSTRAINT "inbox_v2_file_mat_jobs_reserved_file_version_unique" UNIQUE("tenant_id","reserved_file_version_id"),
	CONSTRAINT "inbox_v2_file_mat_jobs_reserved_object_version_unique" UNIQUE("tenant_id","reserved_object_version_id"),
	CONSTRAINT "inbox_v2_file_mat_jobs_reserved_storage_key_unique" UNIQUE("tenant_id","reserved_storage_root_id","reserved_storage_object_key"),
	CONSTRAINT "inbox_v2_file_mat_jobs_shape_check" CHECK (coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."id" ~ '^attachment_materialization_job:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."attachment_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."attachment_id" ~ '^message_attachment:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."file_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."file_id" ~ '^file:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_jobs"."expected_file_revision" >= 1
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."conversation_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."conversation_id" ~ '^conversation:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."timeline_item_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."timeline_item_id" ~ '^timeline_item:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."parent_message_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."parent_message_id" ~ '^message:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_jobs"."expected_parent_revision" >= 1
        and "inbox_v2_file_attachment_materialization_jobs"."visibility_boundary" in ('external_work', 'internal')
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."timeline_content_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."timeline_content_id" ~ '^timeline_content:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_attachment_materialization_jobs"."expected_content_revision" >= 1
        and char_length("inbox_v2_file_attachment_materialization_jobs"."content_block_key") between 1 and 80
        and "inbox_v2_file_attachment_materialization_jobs"."content_block_key" ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
        and coalesce("inbox_v2_file_attachment_materialization_jobs"."content_mutation_fence_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce("inbox_v2_file_attachment_materialization_jobs"."source_locator_reference" ~ '^src_ref_[A-Za-z0-9_-]{43}$', false)
        and coalesce("inbox_v2_file_attachment_materialization_jobs"."source_locator_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."reservation_namespace_generation") between 8 and 256
    and "inbox_v2_file_attachment_materialization_jobs"."reservation_namespace_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and (("inbox_v2_file_attachment_materialization_jobs"."source_locator_kind" = 'provider'
            and "inbox_v2_file_attachment_materialization_jobs"."source_occurrence_id" is not null
            and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."source_occurrence_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."source_occurrence_id" ~ '^source_occurrence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false))
          or ("inbox_v2_file_attachment_materialization_jobs"."source_locator_kind" in ('upload_staging', 'derivative')
            and "inbox_v2_file_attachment_materialization_jobs"."source_occurrence_id" is null))
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."idempotency_token") between 8 and 256
    and "inbox_v2_file_attachment_materialization_jobs"."idempotency_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."cause_event_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."cause_event_id" ~ '^event:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and char_length("inbox_v2_file_attachment_materialization_jobs"."cause_mutation_id") between 1 and 256
        and char_length("inbox_v2_file_attachment_materialization_jobs"."cause_stream_commit_id") between 1 and 256
        and "inbox_v2_file_attachment_materialization_jobs"."cause_stream_position" >= 1
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."correlation_id") between 1 and 512
    and "inbox_v2_file_attachment_materialization_jobs"."correlation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and isfinite("inbox_v2_file_attachment_materialization_jobs"."caused_at")
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_command_id") between 1 and 256
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_command_type_id" in (
          'core:attachment.materialization.reserve',
          'core:attachment.materialization.reauthorize'
        )
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_client_mutation_id") between 1 and 512
    and "inbox_v2_file_attachment_materialization_jobs"."authorization_client_mutation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_mutation_id") between 1 and 256
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_decision_id") between 1 and 256
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_epoch") between 8 and 1024
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_actor_id") between 1 and 256
        and isfinite("inbox_v2_file_attachment_materialization_jobs"."authorization_authorized_at")
        and coalesce("inbox_v2_file_attachment_materialization_jobs"."authorization_decision_set_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce("inbox_v2_file_attachment_materialization_jobs"."authorization_resource_fence_set_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_tenant_rbac_revision" >= 1
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_shared_access_revision" >= 1
        and char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_resource_head_id") between 1 and 256
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_resource_access_revision" >= 1
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_structural_relation_revision" >= 1
        and "inbox_v2_file_attachment_materialization_jobs"."authorization_collaborator_set_revision" >= 1
        and cardinality("inbox_v2_file_attachment_materialization_jobs"."authorization_audit_grant_source_ids") between 1 and 64
        and array_position("inbox_v2_file_attachment_materialization_jobs"."authorization_audit_grant_source_ids", null) is null
        and ("inbox_v2_file_attachment_materialization_jobs"."authorization_audit_policy_version" is null
          or char_length("inbox_v2_file_attachment_materialization_jobs"."authorization_audit_policy_version") between 1 and 256)
        and "inbox_v2_file_attachment_materialization_jobs"."expected_attachment_revision" >= 1
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."reserved_file_version_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."reserved_file_version_id" ~ '^file_version:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."reserved_object_version_id") <= 256
    and "inbox_v2_file_attachment_materialization_jobs"."reserved_object_version_id" ~ '^file_object_version:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_attachment_materialization_jobs"."reserved_storage_root_id") <= 256 and (
    "inbox_v2_file_attachment_materialization_jobs"."reserved_storage_root_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_attachment_materialization_jobs"."reserved_storage_root_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and char_length("inbox_v2_file_attachment_materialization_jobs"."reserved_storage_object_key") between 1 and 2048
        and "inbox_v2_file_attachment_materialization_jobs"."lease_generation" >= 0
        and "inbox_v2_file_attachment_materialization_jobs"."revision" >= 1
        and isfinite("inbox_v2_file_attachment_materialization_jobs"."created_at")
        and isfinite("inbox_v2_file_attachment_materialization_jobs"."updated_at")
        and "inbox_v2_file_attachment_materialization_jobs"."updated_at" >= "inbox_v2_file_attachment_materialization_jobs"."created_at"
        and (
          ("inbox_v2_file_attachment_materialization_jobs"."state" in ('claimed', 'transferring', 'verifying')
            and num_nonnulls(
              "inbox_v2_file_attachment_materialization_jobs"."lease_token_hash", "inbox_v2_file_attachment_materialization_jobs"."lease_owner_id",
              "inbox_v2_file_attachment_materialization_jobs"."lease_claimed_at", "inbox_v2_file_attachment_materialization_jobs"."lease_expires_at"
            ) = 4
            and coalesce("inbox_v2_file_attachment_materialization_jobs"."lease_token_hash" ~ '^[a-f0-9]{64}$', false)
            and "inbox_v2_file_attachment_materialization_jobs"."lease_generation" >= 1
            and isfinite("inbox_v2_file_attachment_materialization_jobs"."lease_claimed_at")
            and isfinite("inbox_v2_file_attachment_materialization_jobs"."lease_expires_at")
            and "inbox_v2_file_attachment_materialization_jobs"."lease_expires_at" > "inbox_v2_file_attachment_materialization_jobs"."lease_claimed_at")
          or ("inbox_v2_file_attachment_materialization_jobs"."state" not in ('claimed', 'transferring', 'verifying')
            and num_nonnulls(
              "inbox_v2_file_attachment_materialization_jobs"."lease_token_hash", "inbox_v2_file_attachment_materialization_jobs"."lease_owner_id",
              "inbox_v2_file_attachment_materialization_jobs"."lease_claimed_at", "inbox_v2_file_attachment_materialization_jobs"."lease_expires_at"
            ) = 0)
        )
        and (("inbox_v2_file_attachment_materialization_jobs"."state" = 'ready')
          = (num_nonnulls(
              "inbox_v2_file_attachment_materialization_jobs"."result_file_version_id", "inbox_v2_file_attachment_materialization_jobs"."result_object_version_id",
              "inbox_v2_file_attachment_materialization_jobs"."result_file_revision"
            ) = 3))
        and (("inbox_v2_file_attachment_materialization_jobs"."state" in ('ready', 'failed', 'quarantined'))
          = ("inbox_v2_file_attachment_materialization_jobs"."result_content_revision" is not null))
        and ("inbox_v2_file_attachment_materialization_jobs"."result_file_version_id" is null
          or "inbox_v2_file_attachment_materialization_jobs"."result_file_version_id" = "inbox_v2_file_attachment_materialization_jobs"."reserved_file_version_id")
        and ("inbox_v2_file_attachment_materialization_jobs"."result_object_version_id" is null
          or "inbox_v2_file_attachment_materialization_jobs"."result_object_version_id" = "inbox_v2_file_attachment_materialization_jobs"."reserved_object_version_id")
        and ("inbox_v2_file_attachment_materialization_jobs"."result_file_revision" is null
          or "inbox_v2_file_attachment_materialization_jobs"."result_file_revision" = "inbox_v2_file_attachment_materialization_jobs"."expected_file_revision" + 1)
        and ("inbox_v2_file_attachment_materialization_jobs"."result_content_revision" is null
          or "inbox_v2_file_attachment_materialization_jobs"."result_content_revision" > "inbox_v2_file_attachment_materialization_jobs"."expected_content_revision")
        and (("inbox_v2_file_attachment_materialization_jobs"."state" in ('failed', 'quarantined', 'cancelled'))
          = ("inbox_v2_file_attachment_materialization_jobs"."terminal_reason_id" is not null)))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_derivative_edges" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"original_file_version_id" text NOT NULL,
	"derived_file_version_id" text NOT NULL,
	"transform_kind_id" text NOT NULL,
	"transform_profile_id" text NOT NULL,
	"transform_profile_version" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_derivative_edges_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_derivative_edges_transform_unique" UNIQUE("tenant_id","original_file_version_id","derived_file_version_id","transform_profile_id","transform_profile_version"),
	CONSTRAINT "inbox_v2_file_derivative_edges_shape_check" CHECK (coalesce((char_length("inbox_v2_file_derivative_edges"."id") <= 256
    and "inbox_v2_file_derivative_edges"."id" ~ '^file_derivative_edge:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_derivative_edges"."original_file_version_id" <> "inbox_v2_file_derivative_edges"."derived_file_version_id"
        and coalesce((char_length("inbox_v2_file_derivative_edges"."transform_kind_id") <= 256 and (
    "inbox_v2_file_derivative_edges"."transform_kind_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_derivative_edges"."transform_kind_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_derivative_edges"."transform_profile_id") <= 256 and (
    "inbox_v2_file_derivative_edges"."transform_profile_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_derivative_edges"."transform_profile_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and char_length("inbox_v2_file_derivative_edges"."transform_profile_version") between 1 and 64
        and isfinite("inbox_v2_file_derivative_edges"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_object_operation_evidence" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"object_version_id" text NOT NULL,
	"materialization_job_id" text,
	"operation_kind" "inbox_v2_file_object_operation_kind" NOT NULL,
	"storage_root_id" text NOT NULL,
	"attempt_token" text NOT NULL,
	"outcome" "inbox_v2_file_object_operation_outcome" NOT NULL,
	"safe_reason_id" text,
	"observed_version_count" integer,
	"affected_bytes" bigint,
	"deletion_evidence_digest_sha256" text,
	"expected_object_head_revision" bigint,
	"live_parent_count" bigint,
	"active_purpose_count" bigint,
	"active_hold_count" bigint,
	"deletion_authority_evaluated_at" timestamp (3) with time zone,
	"deletion_authority_decision_sha256" text,
	"requested_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_file_object_operation_evidence_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_object_operation_evidence_attempt_unique" UNIQUE("tenant_id","object_version_id","operation_kind","attempt_token"),
	CONSTRAINT "inbox_v2_file_object_operation_evidence_shape_check" CHECK (coalesce((char_length("inbox_v2_file_object_operation_evidence"."id") <= 256
    and "inbox_v2_file_object_operation_evidence"."id" ~ '^object_operation_evidence:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_object_operation_evidence"."storage_root_id") <= 256 and (
    "inbox_v2_file_object_operation_evidence"."storage_root_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_object_operation_evidence"."storage_root_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_object_operation_evidence"."attempt_token") between 8 and 256
    and "inbox_v2_file_object_operation_evidence"."attempt_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and ("inbox_v2_file_object_operation_evidence"."safe_reason_id" is null or coalesce((char_length("inbox_v2_file_object_operation_evidence"."safe_reason_id") <= 256 and (
    "inbox_v2_file_object_operation_evidence"."safe_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_object_operation_evidence"."safe_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false))
        and ("inbox_v2_file_object_operation_evidence"."observed_version_count" is null
          or "inbox_v2_file_object_operation_evidence"."observed_version_count" between 0 and 1000000)
        and ("inbox_v2_file_object_operation_evidence"."affected_bytes" is null or "inbox_v2_file_object_operation_evidence"."affected_bytes" >= 0)
        and ("inbox_v2_file_object_operation_evidence"."deletion_evidence_digest_sha256" is null
          or coalesce("inbox_v2_file_object_operation_evidence"."deletion_evidence_digest_sha256" ~ '^[a-f0-9]{64}$', false))
        and num_nonnulls(
          "inbox_v2_file_object_operation_evidence"."expected_object_head_revision", "inbox_v2_file_object_operation_evidence"."live_parent_count",
          "inbox_v2_file_object_operation_evidence"."active_purpose_count", "inbox_v2_file_object_operation_evidence"."active_hold_count",
          "inbox_v2_file_object_operation_evidence"."deletion_authority_evaluated_at",
          "inbox_v2_file_object_operation_evidence"."deletion_authority_decision_sha256"
        ) in (0, 6)
        and ("inbox_v2_file_object_operation_evidence"."expected_object_head_revision" is null
          or "inbox_v2_file_object_operation_evidence"."expected_object_head_revision" >= 1)
        and ("inbox_v2_file_object_operation_evidence"."live_parent_count" is null or "inbox_v2_file_object_operation_evidence"."live_parent_count" >= 0)
        and ("inbox_v2_file_object_operation_evidence"."active_purpose_count" is null
          or "inbox_v2_file_object_operation_evidence"."active_purpose_count" >= 0)
        and ("inbox_v2_file_object_operation_evidence"."active_hold_count" is null or "inbox_v2_file_object_operation_evidence"."active_hold_count" >= 0)
        and ("inbox_v2_file_object_operation_evidence"."deletion_authority_evaluated_at" is null
          or isfinite("inbox_v2_file_object_operation_evidence"."deletion_authority_evaluated_at"))
        and ("inbox_v2_file_object_operation_evidence"."deletion_authority_decision_sha256" is null
          or coalesce("inbox_v2_file_object_operation_evidence"."deletion_authority_decision_sha256" ~ '^[a-f0-9]{64}$', false))
        and isfinite("inbox_v2_file_object_operation_evidence"."requested_at")
        and isfinite("inbox_v2_file_object_operation_evidence"."completed_at")
        and "inbox_v2_file_object_operation_evidence"."completed_at" >= "inbox_v2_file_object_operation_evidence"."requested_at"
        and "inbox_v2_file_object_operation_evidence"."revision" = 1
        and (("inbox_v2_file_object_operation_evidence"."outcome" in ('retryable_failure', 'terminal_failure', 'unsupported'))
          = ("inbox_v2_file_object_operation_evidence"."safe_reason_id" is not null))
        and (
          ("inbox_v2_file_object_operation_evidence"."operation_kind" in ('delete_current', 'delete_version')
            and "inbox_v2_file_object_operation_evidence"."deletion_evidence_digest_sha256" is not null
            and "inbox_v2_file_object_operation_evidence"."deletion_evidence_digest_sha256" =
              "inbox_v2_file_object_operation_evidence"."deletion_authority_decision_sha256"
            and "inbox_v2_file_object_operation_evidence"."live_parent_count" = 0
            and "inbox_v2_file_object_operation_evidence"."active_purpose_count" = 0
            and "inbox_v2_file_object_operation_evidence"."active_hold_count" = 0)
          or ("inbox_v2_file_object_operation_evidence"."operation_kind" not in ('delete_current', 'delete_version')
            and "inbox_v2_file_object_operation_evidence"."deletion_evidence_digest_sha256" is null
            and "inbox_v2_file_object_operation_evidence"."expected_object_head_revision" is null)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_object_version_heads" (
	"tenant_id" text NOT NULL,
	"object_version_id" text NOT NULL,
	"state" "inbox_v2_file_object_version_state" NOT NULL,
	"latest_operation_evidence_id" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"state_changed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_object_version_heads_pk" PRIMARY KEY("tenant_id","object_version_id"),
	CONSTRAINT "inbox_v2_file_object_version_heads_shape_check" CHECK ("inbox_v2_file_object_version_heads"."revision" >= 1
        and isfinite("inbox_v2_file_object_version_heads"."state_changed_at")
        and isfinite("inbox_v2_file_object_version_heads"."created_at")
        and "inbox_v2_file_object_version_heads"."state_changed_at" >= "inbox_v2_file_object_version_heads"."created_at"
        and ("inbox_v2_file_object_version_heads"."revision" = 1
          or "inbox_v2_file_object_version_heads"."latest_operation_evidence_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_object_versions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"storage_root_id" text NOT NULL,
	"storage_object_key" text NOT NULL,
	"storage_version_identity" text NOT NULL,
	"versioning_mode" "inbox_v2_file_object_versioning_mode" NOT NULL,
	"checksum_sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"declared_media_type" text,
	"detected_media_type" text NOT NULL,
	"encryption_key_ref" text,
	"data_class_id" text NOT NULL,
	"retention_anchor_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_object_versions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_object_versions_storage_unique" UNIQUE("tenant_id","storage_root_id","storage_object_key","storage_version_identity"),
	CONSTRAINT "inbox_v2_file_object_versions_mapping_unique" UNIQUE("tenant_id","id","checksum_sha256","size_bytes"),
	CONSTRAINT "inbox_v2_file_object_versions_shape_check" CHECK (coalesce((char_length("inbox_v2_file_object_versions"."id") <= 256
    and "inbox_v2_file_object_versions"."id" ~ '^file_object_version:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_object_versions"."storage_root_id") <= 256 and (
    "inbox_v2_file_object_versions"."storage_root_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_object_versions"."storage_root_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and char_length("inbox_v2_file_object_versions"."storage_object_key") between 1 and 2048
        and char_length("inbox_v2_file_object_versions"."storage_version_identity") between 1 and 1024
        and coalesce("inbox_v2_file_object_versions"."checksum_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_object_versions"."size_bytes" >= 0
        and ("inbox_v2_file_object_versions"."declared_media_type" is null
          or char_length("inbox_v2_file_object_versions"."declared_media_type") between 1 and 255)
        and char_length("inbox_v2_file_object_versions"."detected_media_type") between 1 and 255
        and ("inbox_v2_file_object_versions"."encryption_key_ref" is null
          or char_length("inbox_v2_file_object_versions"."encryption_key_ref") between 1 and 512)
        and coalesce((char_length("inbox_v2_file_object_versions"."data_class_id") <= 256 and (
    "inbox_v2_file_object_versions"."data_class_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_object_versions"."data_class_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and isfinite("inbox_v2_file_object_versions"."retention_anchor_at")
        and isfinite("inbox_v2_file_object_versions"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_objects" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"processing_purpose_id" text NOT NULL,
	"retention_anchor_at" timestamp (3) with time zone NOT NULL,
	"state" "inbox_v2_file_object_state" DEFAULT 'pending' NOT NULL,
	"current_file_version_id" text,
	"current_object_version_id" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_objects_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_objects_current_unique" UNIQUE("tenant_id","id","current_file_version_id","current_object_version_id"),
	CONSTRAINT "inbox_v2_file_objects_shape_check" CHECK (coalesce((char_length("inbox_v2_file_objects"."id") <= 256
    and "inbox_v2_file_objects"."id" ~ '^file:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_objects"."data_class_id") <= 256 and (
    "inbox_v2_file_objects"."data_class_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_objects"."data_class_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_objects"."processing_purpose_id") <= 256 and (
    "inbox_v2_file_objects"."processing_purpose_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_objects"."processing_purpose_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and "inbox_v2_file_objects"."revision" >= 1
        and isfinite("inbox_v2_file_objects"."retention_anchor_at")
        and isfinite("inbox_v2_file_objects"."created_at")
        and isfinite("inbox_v2_file_objects"."updated_at")
        and "inbox_v2_file_objects"."updated_at" >= "inbox_v2_file_objects"."created_at"
        and (("inbox_v2_file_objects"."current_file_version_id" is null
              and "inbox_v2_file_objects"."current_object_version_id" is null)
          or ("inbox_v2_file_objects"."current_file_version_id" is not null
              and "inbox_v2_file_objects"."current_object_version_id" is not null))
        and ("inbox_v2_file_objects"."state" <> 'ready'
          or "inbox_v2_file_objects"."current_file_version_id" is not null)
        and ("inbox_v2_file_objects"."state" <> 'pending'
          or "inbox_v2_file_objects"."current_file_version_id" is null))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_outbound_artifact_blocks" (
	"tenant_id" text NOT NULL,
	"content_plan_id" text NOT NULL,
	"artifact_plan_id" text NOT NULL,
	"artifact_ordinal" smallint NOT NULL,
	"artifact_block_ordinal" smallint NOT NULL,
	"content_block_ordinal" smallint NOT NULL,
	"block_key" text NOT NULL,
	"block_kind" "inbox_v2_file_outbound_block_kind" NOT NULL,
	"file_id" text,
	"file_revision" bigint,
	"file_version_id" text,
	"object_version_id" text,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_pk" PRIMARY KEY("tenant_id","content_plan_id","artifact_plan_id","artifact_block_ordinal"),
	CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_content_unique" UNIQUE("tenant_id","content_plan_id","content_block_ordinal"),
	CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_shape_check" CHECK ("inbox_v2_file_outbound_artifact_blocks"."artifact_ordinal" between 1 and 64
        and "inbox_v2_file_outbound_artifact_blocks"."artifact_block_ordinal" between 1 and 64
        and "inbox_v2_file_outbound_artifact_blocks"."content_block_ordinal" between 0 and 63
        and char_length("inbox_v2_file_outbound_artifact_blocks"."block_key") between 1 and 80
        and "inbox_v2_file_outbound_artifact_blocks"."block_key" ~ '^[A-Za-z0-9][A-Za-z0-9._~-]*$'
        and num_nonnulls(
          "inbox_v2_file_outbound_artifact_blocks"."file_id", "inbox_v2_file_outbound_artifact_blocks"."file_revision",
          "inbox_v2_file_outbound_artifact_blocks"."file_version_id", "inbox_v2_file_outbound_artifact_blocks"."object_version_id"
        ) in (0, 4)
        and (("inbox_v2_file_outbound_artifact_blocks"."block_kind" in (
              'image', 'audio', 'video', 'file', 'sticker', 'extension'
            ) and num_nonnulls(
              "inbox_v2_file_outbound_artifact_blocks"."file_id", "inbox_v2_file_outbound_artifact_blocks"."file_revision",
              "inbox_v2_file_outbound_artifact_blocks"."file_version_id", "inbox_v2_file_outbound_artifact_blocks"."object_version_id"
            ) = 4 and "inbox_v2_file_outbound_artifact_blocks"."file_revision" >= 1)
          or ("inbox_v2_file_outbound_artifact_blocks"."block_kind" in ('text', 'location', 'contact')
            and num_nonnulls(
              "inbox_v2_file_outbound_artifact_blocks"."file_id", "inbox_v2_file_outbound_artifact_blocks"."file_revision",
              "inbox_v2_file_outbound_artifact_blocks"."file_version_id", "inbox_v2_file_outbound_artifact_blocks"."object_version_id"
            ) = 0))
        and isfinite("inbox_v2_file_outbound_artifact_blocks"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_outbound_artifact_plans" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"content_plan_id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"grouping" "inbox_v2_file_outbound_artifact_grouping" NOT NULL,
	"capability_id" text NOT NULL,
	"operation_id" text NOT NULL,
	"artifact_plan_hash_sha256" text NOT NULL,
	"block_mapping_count" smallint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_outbound_artifact_plans_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_outbound_artifact_plans_ordinal_unique" UNIQUE("tenant_id","content_plan_id","ordinal"),
	CONSTRAINT "inbox_v2_file_outbound_artifact_plans_scope_unique" UNIQUE("tenant_id","content_plan_id","id","ordinal"),
	CONSTRAINT "inbox_v2_file_outbound_artifact_plans_shape_check" CHECK (coalesce((char_length("inbox_v2_file_outbound_artifact_plans"."id") <= 256
    and "inbox_v2_file_outbound_artifact_plans"."id" ~ '^outbound_dispatch_artifact_plan:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_outbound_artifact_plans"."ordinal" between 1 and 64
        and coalesce((char_length("inbox_v2_file_outbound_artifact_plans"."capability_id") <= 256 and (
    "inbox_v2_file_outbound_artifact_plans"."capability_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_outbound_artifact_plans"."capability_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_outbound_artifact_plans"."operation_id") <= 256 and (
    "inbox_v2_file_outbound_artifact_plans"."operation_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_outbound_artifact_plans"."operation_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce("inbox_v2_file_outbound_artifact_plans"."artifact_plan_hash_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_outbound_artifact_plans"."block_mapping_count" between 1 and 64
        and isfinite("inbox_v2_file_outbound_artifact_plans"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_outbound_dispatch_plans" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"dispatch_id" text NOT NULL,
	"message_id" text NOT NULL,
	"message_revision" bigint NOT NULL,
	"conversation_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"route_id" text NOT NULL,
	"content_id" text NOT NULL,
	"content_revision" bigint NOT NULL,
	"content_fingerprint_purpose_id" text NOT NULL,
	"content_fingerprint_key_generation" text NOT NULL,
	"content_fingerprint_valid_until" timestamp (3) with time zone NOT NULL,
	"content_fingerprint_hmac_sha256" text NOT NULL,
	"binding_id" text NOT NULL,
	"binding_revision" bigint NOT NULL,
	"capability_revision" bigint NOT NULL,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_contract_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"plan_digest_sha256" text NOT NULL,
	"block_count" smallint NOT NULL,
	"artifact_count" smallint NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_outbound_dispatch_plans_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_outbound_dispatch_plans_dispatch_unique" UNIQUE("tenant_id","dispatch_id"),
	CONSTRAINT "inbox_v2_file_outbound_dispatch_plans_scope_unique" UNIQUE("tenant_id","id","dispatch_id"),
	CONSTRAINT "inbox_v2_file_outbound_dispatch_plans_shape_check" CHECK (coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."id") <= 256
    and "inbox_v2_file_outbound_dispatch_plans"."id" ~ '^outbound_dispatch_content_plan:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."dispatch_id") <= 256
    and "inbox_v2_file_outbound_dispatch_plans"."dispatch_id" ~ '^outbound_dispatch:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."message_id") <= 256
    and "inbox_v2_file_outbound_dispatch_plans"."message_id" ~ '^message:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."route_id") <= 256
    and "inbox_v2_file_outbound_dispatch_plans"."route_id" ~ '^outbound_route:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_outbound_dispatch_plans"."message_revision" >= 1
        and "inbox_v2_file_outbound_dispatch_plans"."content_revision" >= 1
        and "inbox_v2_file_outbound_dispatch_plans"."binding_revision" >= 1
        and "inbox_v2_file_outbound_dispatch_plans"."capability_revision" >= 1
        and "inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_purpose_id" =
          'core:outbound_dispatch_content_plan'
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_key_generation") between 8 and 256
    and "inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and isfinite("inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_valid_until")
        and "inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_valid_until" > "inbox_v2_file_outbound_dispatch_plans"."created_at"
        and coalesce("inbox_v2_file_outbound_dispatch_plans"."content_fingerprint_hmac_sha256" ~ '^hmac-sha256:[a-f0-9]{64}$', false)
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."adapter_contract_id") <= 256 and (
    "inbox_v2_file_outbound_dispatch_plans"."adapter_contract_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_outbound_dispatch_plans"."adapter_contract_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and char_length("inbox_v2_file_outbound_dispatch_plans"."adapter_contract_version") between 1 and 64
        and "inbox_v2_file_outbound_dispatch_plans"."adapter_contract_declaration_revision" >= 1
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."adapter_surface_id") <= 256 and (
    "inbox_v2_file_outbound_dispatch_plans"."adapter_surface_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_outbound_dispatch_plans"."adapter_surface_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_by_trusted_service_id") <= 256 and (
    "inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_by_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_by_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and isfinite("inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_at")
        and "inbox_v2_file_outbound_dispatch_plans"."adapter_loaded_at" <= "inbox_v2_file_outbound_dispatch_plans"."created_at"
        and coalesce("inbox_v2_file_outbound_dispatch_plans"."plan_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_outbound_dispatch_plans"."block_count" between 1 and 64
        and "inbox_v2_file_outbound_dispatch_plans"."artifact_count" between 1 and 64
        and "inbox_v2_file_outbound_dispatch_plans"."revision" = 1
        and isfinite("inbox_v2_file_outbound_dispatch_plans"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_parent_link_heads" (
	"tenant_id" text NOT NULL,
	"link_id" text NOT NULL,
	"file_id" text NOT NULL,
	"state" "inbox_v2_file_parent_link_state" DEFAULT 'live' NOT NULL,
	"detached_by_event_id" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_parent_link_heads_pk" PRIMARY KEY("tenant_id","link_id"),
	CONSTRAINT "inbox_v2_file_parent_link_heads_scope_unique" UNIQUE("tenant_id","link_id","file_id","revision","state"),
	CONSTRAINT "inbox_v2_file_parent_link_heads_shape_check" CHECK ("inbox_v2_file_parent_link_heads"."revision" >= 1
        and isfinite("inbox_v2_file_parent_link_heads"."updated_at")
        and (("inbox_v2_file_parent_link_heads"."state" = 'live'
            and "inbox_v2_file_parent_link_heads"."detached_by_event_id" is null
            and "inbox_v2_file_parent_link_heads"."revision" = 1)
          or ("inbox_v2_file_parent_link_heads"."state" = 'detached'
            and "inbox_v2_file_parent_link_heads"."detached_by_event_id" is not null
            and "inbox_v2_file_parent_link_heads"."revision" >= 2)))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_parent_links" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"file_id" text NOT NULL,
	"file_version_id" text NOT NULL,
	"object_version_id" text NOT NULL,
	"parent_identity_digest_sha256" text NOT NULL,
	"parent_kind" "inbox_v2_file_parent_kind" NOT NULL,
	"parent_purpose" "inbox_v2_file_parent_purpose" NOT NULL,
	"visibility_boundary" "inbox_v2_file_parent_visibility" NOT NULL,
	"parent_conversation_visibility" "inbox_v2_file_parent_visibility",
	"parent_entity_id" text NOT NULL,
	"parent_entity_revision" bigint NOT NULL,
	"conversation_id" text,
	"timeline_item_id" text,
	"content_id" text,
	"content_revision" bigint,
	"block_key" text,
	"data_class_id" text NOT NULL,
	"processing_purpose_id" text NOT NULL,
	"retention_anchor_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	CONSTRAINT "inbox_v2_file_parent_links_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_parent_links_identity_unique" UNIQUE("tenant_id","file_id","parent_identity_digest_sha256"),
	CONSTRAINT "inbox_v2_file_parent_links_scope_unique" UNIQUE("tenant_id","id","file_id"),
	CONSTRAINT "inbox_v2_file_parent_links_shape_check" CHECK (coalesce((char_length("inbox_v2_file_parent_links"."id") <= 256
    and "inbox_v2_file_parent_links"."id" ~ '^file_parent_link:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce("inbox_v2_file_parent_links"."parent_identity_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_parent_links"."parent_entity_revision" >= 1
        and coalesce((char_length("inbox_v2_file_parent_links"."data_class_id") <= 256 and (
    "inbox_v2_file_parent_links"."data_class_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_parent_links"."data_class_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and coalesce((char_length("inbox_v2_file_parent_links"."processing_purpose_id") <= 256 and (
    "inbox_v2_file_parent_links"."processing_purpose_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_parent_links"."processing_purpose_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and isfinite("inbox_v2_file_parent_links"."retention_anchor_at")
        and isfinite("inbox_v2_file_parent_links"."created_at")
        and "inbox_v2_file_parent_links"."revision" = 1
        and (
          ("inbox_v2_file_parent_links"."parent_kind" = 'message'
            and "inbox_v2_file_parent_links"."visibility_boundary" in ('external_work', 'internal')
            and "inbox_v2_file_parent_links"."parent_conversation_visibility" is null
            and num_nonnulls(
              "inbox_v2_file_parent_links"."conversation_id", "inbox_v2_file_parent_links"."timeline_item_id",
              "inbox_v2_file_parent_links"."content_id", "inbox_v2_file_parent_links"."content_revision", "inbox_v2_file_parent_links"."block_key"
            ) = 5)
          or ("inbox_v2_file_parent_links"."parent_kind" = 'staff_note'
            and "inbox_v2_file_parent_links"."visibility_boundary" = 'staff_note'
            and "inbox_v2_file_parent_links"."parent_conversation_visibility" in (
              'external_work', 'internal'
            )
            and num_nonnulls(
              "inbox_v2_file_parent_links"."conversation_id", "inbox_v2_file_parent_links"."timeline_item_id",
              "inbox_v2_file_parent_links"."content_id", "inbox_v2_file_parent_links"."content_revision", "inbox_v2_file_parent_links"."block_key"
            ) = 5)
          or ("inbox_v2_file_parent_links"."parent_kind" = 'upload_staging'
            and "inbox_v2_file_parent_links"."visibility_boundary" = 'upload_staging'
            and "inbox_v2_file_parent_links"."parent_conversation_visibility" is null
            and "inbox_v2_file_parent_links"."parent_purpose" = 'attachment'
            and num_nonnulls(
              "inbox_v2_file_parent_links"."conversation_id", "inbox_v2_file_parent_links"."timeline_item_id",
              "inbox_v2_file_parent_links"."content_id", "inbox_v2_file_parent_links"."content_revision", "inbox_v2_file_parent_links"."block_key"
            ) = 0)
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_parent_set_heads" (
	"tenant_id" text NOT NULL,
	"file_id" text NOT NULL,
	"revision" bigint NOT NULL,
	"completeness" "inbox_v2_file_parent_set_completeness" NOT NULL,
	"completeness_revision" bigint NOT NULL,
	"live_parent_count" integer NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_parent_set_heads_pk" PRIMARY KEY("tenant_id","file_id"),
	CONSTRAINT "inbox_v2_file_parent_set_heads_revision_unique" UNIQUE("tenant_id","file_id","revision","completeness"),
	CONSTRAINT "inbox_v2_file_parent_set_heads_shape_check" CHECK ("inbox_v2_file_parent_set_heads"."revision" >= 1
        and "inbox_v2_file_parent_set_heads"."completeness_revision" between 0 and "inbox_v2_file_parent_set_heads"."revision"
        and "inbox_v2_file_parent_set_heads"."live_parent_count" between 0 and 1000000000
        and isfinite("inbox_v2_file_parent_set_heads"."updated_at")
        and ("inbox_v2_file_parent_set_heads"."completeness" <> 'complete'
          or "inbox_v2_file_parent_set_heads"."completeness_revision" = "inbox_v2_file_parent_set_heads"."revision"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_storage_orphans" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"materialization_job_id" text,
	"storage_root_id" text NOT NULL,
	"storage_object_key" text NOT NULL,
	"storage_version_identity" text NOT NULL,
	"checksum_sha256" text NOT NULL,
	"size_bytes" bigint NOT NULL,
	"detected_media_type" text NOT NULL,
	"state" "inbox_v2_file_storage_orphan_state" DEFAULT 'open' NOT NULL,
	"claim_token_hash" text,
	"claim_expires_at" timestamp (3) with time zone,
	"adopted_object_version_id" text,
	"terminal_evidence_digest_sha256" text,
	"safe_reason_id" text,
	"quarantine_reason_code" text,
	"quarantine_evidence_digest_sha256" text,
	"quarantine_physical_kind" text,
	"revision" bigint DEFAULT 1 NOT NULL,
	"first_observed_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_storage_orphans_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_storage_orphans_storage_unique" UNIQUE("tenant_id","storage_root_id","storage_object_key","storage_version_identity"),
	CONSTRAINT "inbox_v2_file_storage_orphans_shape_check" CHECK (coalesce((char_length("inbox_v2_file_storage_orphans"."id") <= 256
    and "inbox_v2_file_storage_orphans"."id" ~ '^file_storage_orphan:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_storage_orphans"."storage_root_id") <= 256 and (
    "inbox_v2_file_storage_orphans"."storage_root_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
    or "inbox_v2_file_storage_orphans"."storage_root_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
  )), false)
        and char_length("inbox_v2_file_storage_orphans"."storage_object_key") between 1 and 2048
        and char_length("inbox_v2_file_storage_orphans"."storage_version_identity") between 1 and 1024
        and coalesce("inbox_v2_file_storage_orphans"."checksum_sha256" ~ '^[a-f0-9]{64}$', false)
        and "inbox_v2_file_storage_orphans"."size_bytes" >= 0
        and char_length("inbox_v2_file_storage_orphans"."detected_media_type") between 1 and 255
        and "inbox_v2_file_storage_orphans"."revision" >= 1
        and isfinite("inbox_v2_file_storage_orphans"."first_observed_at")
        and isfinite("inbox_v2_file_storage_orphans"."updated_at")
        and "inbox_v2_file_storage_orphans"."updated_at" >= "inbox_v2_file_storage_orphans"."first_observed_at"
        and (("inbox_v2_file_storage_orphans"."state" = 'claimed')
          = (num_nonnulls("inbox_v2_file_storage_orphans"."claim_token_hash", "inbox_v2_file_storage_orphans"."claim_expires_at") = 2))
        and ("inbox_v2_file_storage_orphans"."claim_token_hash" is null or coalesce("inbox_v2_file_storage_orphans"."claim_token_hash" ~ '^[a-f0-9]{64}$', false))
        and ("inbox_v2_file_storage_orphans"."claim_expires_at" is null or isfinite("inbox_v2_file_storage_orphans"."claim_expires_at"))
        and (("inbox_v2_file_storage_orphans"."state" = 'adopted')
          = ("inbox_v2_file_storage_orphans"."adopted_object_version_id" is not null))
        and (("inbox_v2_file_storage_orphans"."state" in ('adopted', 'deleted'))
          = ("inbox_v2_file_storage_orphans"."terminal_evidence_digest_sha256" is not null))
        and ("inbox_v2_file_storage_orphans"."terminal_evidence_digest_sha256" is null
          or coalesce("inbox_v2_file_storage_orphans"."terminal_evidence_digest_sha256" ~ '^[a-f0-9]{64}$', false))
        and (("inbox_v2_file_storage_orphans"."state" = 'failed')
          = ("inbox_v2_file_storage_orphans"."safe_reason_id" is not null))
        and (("inbox_v2_file_storage_orphans"."state" = 'quarantined')
          = (num_nonnulls(
            "inbox_v2_file_storage_orphans"."quarantine_reason_code",
            "inbox_v2_file_storage_orphans"."quarantine_evidence_digest_sha256",
            "inbox_v2_file_storage_orphans"."quarantine_physical_kind"
          ) = 3))
        and ("inbox_v2_file_storage_orphans"."quarantine_reason_code" is null
          or coalesce((char_length("inbox_v2_file_storage_orphans"."quarantine_reason_code") between 8 and 256
    and "inbox_v2_file_storage_orphans"."quarantine_reason_code" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false))
        and ("inbox_v2_file_storage_orphans"."quarantine_evidence_digest_sha256" is null
          or coalesce("inbox_v2_file_storage_orphans"."quarantine_evidence_digest_sha256" ~ '^[a-f0-9]{64}$', false))
        and ("inbox_v2_file_storage_orphans"."quarantine_physical_kind" is null
          or coalesce((char_length("inbox_v2_file_storage_orphans"."quarantine_physical_kind") between 8 and 256
    and "inbox_v2_file_storage_orphans"."quarantine_physical_kind" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_file_versions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"file_id" text NOT NULL,
	"version_number" bigint NOT NULL,
	"object_version_id" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_file_versions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_file_versions_number_unique" UNIQUE("tenant_id","file_id","version_number"),
	CONSTRAINT "inbox_v2_file_versions_pin_unique" UNIQUE("tenant_id","id","file_id","object_version_id"),
	CONSTRAINT "inbox_v2_file_versions_shape_check" CHECK (coalesce((char_length("inbox_v2_file_versions"."id") <= 256
    and "inbox_v2_file_versions"."id" ~ '^file_version:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and coalesce((char_length("inbox_v2_file_versions"."file_id") <= 256
    and "inbox_v2_file_versions"."file_id" ~ '^file:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'), false)
        and "inbox_v2_file_versions"."version_number" >= 1
        and isfinite("inbox_v2_file_versions"."created_at"))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" DROP CONSTRAINT "inbox_v2_timeline_content_payloads_shape_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_action_attributions" DROP CONSTRAINT "inbox_v2_action_attributions_cause_event_fk";
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "owner_message_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "owner_timeline_item_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "owner_timeline_content_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "owner_block_key" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD COLUMN "materialization_state" "inbox_v2_attachment_materialization_state";
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "attachment_v2_file_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "attachment_file_revision" bigint;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "attachment_file_version_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "attachment_object_version_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "extension_payload_v2_file_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "extension_payload_file_revision" bigint;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "extension_payload_file_version_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD COLUMN "extension_payload_object_version_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_attempts" ADD CONSTRAINT "inbox_v2_file_mat_attempts_job_fk" FOREIGN KEY ("tenant_id","job_id","attachment_id","file_id") REFERENCES "public"."inbox_v2_file_attachment_materialization_jobs"("tenant_id","id","attachment_id","file_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_attempts" ADD CONSTRAINT "inbox_v2_file_mat_attempts_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_evidence" ADD CONSTRAINT "inbox_v2_file_mat_evidence_job_fk" FOREIGN KEY ("tenant_id","job_id","attachment_id","file_id") REFERENCES "public"."inbox_v2_file_attachment_materialization_jobs"("tenant_id","id","attachment_id","file_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_evidence" ADD CONSTRAINT "inbox_v2_file_mat_evidence_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id","job_id","attachment_id","file_id","lease_generation") REFERENCES "public"."inbox_v2_file_attachment_materialization_attempts"("tenant_id","id","job_id","attachment_id","file_id","lease_generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_evidence" ADD CONSTRAINT "inbox_v2_file_mat_evidence_result_fk" FOREIGN KEY ("tenant_id","result_file_version_id","file_id","result_object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_evidence" ADD CONSTRAINT "inbox_v2_file_mat_evidence_object_operation_fk" FOREIGN KEY ("tenant_id","object_operation_evidence_id") REFERENCES "public"."inbox_v2_file_object_operation_evidence"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_evidence" ADD CONSTRAINT "inbox_v2_file_mat_evidence_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."inbox_v2_file_objects"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_cause_event_fk" FOREIGN KEY ("tenant_id","cause_event_id") REFERENCES "public"."inbox_v2_domain_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_source_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_authorization_command_fk" FOREIGN KEY ("tenant_id","authorization_command_id","authorization_mutation_id") REFERENCES "public"."inbox_v2_auth_command_records"("tenant_id","id","mutation_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_result_fk" FOREIGN KEY ("tenant_id","result_file_version_id","file_id","result_object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_attachment_materialization_jobs" ADD CONSTRAINT "inbox_v2_file_mat_jobs_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_derivative_edges" ADD CONSTRAINT "inbox_v2_file_derivative_edges_original_fk" FOREIGN KEY ("tenant_id","original_file_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_derivative_edges" ADD CONSTRAINT "inbox_v2_file_derivative_edges_derived_fk" FOREIGN KEY ("tenant_id","derived_file_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_derivative_edges" ADD CONSTRAINT "inbox_v2_file_derivative_edges_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_operation_evidence" ADD CONSTRAINT "inbox_v2_file_object_operation_evidence_version_fk" FOREIGN KEY ("tenant_id","object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_operation_evidence" ADD CONSTRAINT "inbox_v2_file_object_operation_evidence_job_fk" FOREIGN KEY ("tenant_id","materialization_job_id") REFERENCES "public"."inbox_v2_file_attachment_materialization_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_operation_evidence" ADD CONSTRAINT "inbox_v2_file_object_operation_evidence_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_version_heads" ADD CONSTRAINT "inbox_v2_file_object_version_heads_version_fk" FOREIGN KEY ("tenant_id","object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_version_heads" ADD CONSTRAINT "inbox_v2_file_object_version_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_object_versions" ADD CONSTRAINT "inbox_v2_file_object_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_objects" ADD CONSTRAINT "inbox_v2_file_objects_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_artifact_blocks" ADD CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_plan_fk" FOREIGN KEY ("tenant_id","content_plan_id","artifact_plan_id","artifact_ordinal") REFERENCES "public"."inbox_v2_file_outbound_artifact_plans"("tenant_id","content_plan_id","id","ordinal") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_artifact_blocks" ADD CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_version_fk" FOREIGN KEY ("tenant_id","file_version_id","file_id","object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_artifact_blocks" ADD CONSTRAINT "inbox_v2_file_outbound_artifact_blocks_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_artifact_plans" ADD CONSTRAINT "inbox_v2_file_outbound_artifact_plans_content_fk" FOREIGN KEY ("tenant_id","content_plan_id","dispatch_id") REFERENCES "public"."inbox_v2_file_outbound_dispatch_plans"("tenant_id","id","dispatch_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_artifact_plans" ADD CONSTRAINT "inbox_v2_file_outbound_artifact_plans_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_outbound_dispatch_plans" ADD CONSTRAINT "inbox_v2_file_outbound_dispatch_plans_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_link_heads" ADD CONSTRAINT "inbox_v2_file_parent_link_heads_link_fk" FOREIGN KEY ("tenant_id","link_id","file_id") REFERENCES "public"."inbox_v2_file_parent_links"("tenant_id","id","file_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_link_heads" ADD CONSTRAINT "inbox_v2_file_parent_link_heads_event_fk" FOREIGN KEY ("tenant_id","detached_by_event_id") REFERENCES "public"."inbox_v2_domain_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_link_heads" ADD CONSTRAINT "inbox_v2_file_parent_link_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_links" ADD CONSTRAINT "inbox_v2_file_parent_links_version_fk" FOREIGN KEY ("tenant_id","file_version_id","file_id","object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_links" ADD CONSTRAINT "inbox_v2_file_parent_links_head_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."inbox_v2_file_parent_set_heads"("tenant_id","file_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_links" ADD CONSTRAINT "inbox_v2_file_parent_links_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_set_heads" ADD CONSTRAINT "inbox_v2_file_parent_set_heads_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."inbox_v2_file_objects"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_parent_set_heads" ADD CONSTRAINT "inbox_v2_file_parent_set_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_storage_orphans" ADD CONSTRAINT "inbox_v2_file_storage_orphans_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_storage_orphans" ADD CONSTRAINT "inbox_v2_file_storage_orphans_job_fk" FOREIGN KEY ("tenant_id","materialization_job_id") REFERENCES "public"."inbox_v2_file_attachment_materialization_jobs"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_storage_orphans" ADD CONSTRAINT "inbox_v2_file_storage_orphans_adopted_fk" FOREIGN KEY ("tenant_id","adopted_object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_versions" ADD CONSTRAINT "inbox_v2_file_versions_file_fk" FOREIGN KEY ("tenant_id","file_id") REFERENCES "public"."inbox_v2_file_objects"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_versions" ADD CONSTRAINT "inbox_v2_file_versions_object_version_fk" FOREIGN KEY ("tenant_id","object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_file_versions" ADD CONSTRAINT "inbox_v2_file_versions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_mat_attempts_job_idx" ON "inbox_v2_file_attachment_materialization_attempts" USING btree ("tenant_id","job_id","lease_generation","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_mat_evidence_job_idx" ON "inbox_v2_file_attachment_materialization_evidence" USING btree ("tenant_id","job_id","completed_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_mat_jobs_claim_idx" ON "inbox_v2_file_attachment_materialization_jobs" USING btree ("tenant_id","state","lease_expires_at","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_mat_jobs_namespace_drain_idx" ON "inbox_v2_file_attachment_materialization_jobs" USING btree ("tenant_id","reservation_namespace_generation","state","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_derivative_edges_derived_idx" ON "inbox_v2_file_derivative_edges" USING btree ("tenant_id","derived_file_version_id","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_object_operation_evidence_version_idx" ON "inbox_v2_file_object_operation_evidence" USING btree ("tenant_id","object_version_id","completed_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_object_version_heads_state_idx" ON "inbox_v2_file_object_version_heads" USING btree ("tenant_id","state","state_changed_at","object_version_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_object_versions_checksum_idx" ON "inbox_v2_file_object_versions" USING btree ("tenant_id","checksum_sha256","size_bytes","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_objects_state_idx" ON "inbox_v2_file_objects" USING btree ("tenant_id","state","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_outbound_artifact_blocks_version_idx" ON "inbox_v2_file_outbound_artifact_blocks" USING btree ("tenant_id","file_version_id","content_plan_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_outbound_artifact_plans_dispatch_idx" ON "inbox_v2_file_outbound_artifact_plans" USING btree ("tenant_id","dispatch_id","ordinal","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_outbound_dispatch_plans_message_idx" ON "inbox_v2_file_outbound_dispatch_plans" USING btree ("tenant_id","message_id","message_revision","dispatch_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_parent_link_heads_live_idx" ON "inbox_v2_file_parent_link_heads" USING btree ("tenant_id","file_id","state","link_id") WHERE "inbox_v2_file_parent_link_heads"."state" = 'live';
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_parent_links_file_idx" ON "inbox_v2_file_parent_links" USING btree ("tenant_id","file_id","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_parent_links_parent_idx" ON "inbox_v2_file_parent_links" USING btree ("tenant_id","parent_kind","parent_entity_id","parent_entity_revision","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_parent_set_heads_complete_idx" ON "inbox_v2_file_parent_set_heads" USING btree ("tenant_id","completeness","live_parent_count","file_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_storage_orphans_claim_idx" ON "inbox_v2_file_storage_orphans" USING btree ("tenant_id","state","claim_expires_at","updated_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_file_versions_object_idx" ON "inbox_v2_file_versions" USING btree ("tenant_id","object_version_id","id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_file_version_fk" FOREIGN KEY ("tenant_id","attachment_file_version_id","attachment_v2_file_id","attachment_object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_object_version_fk" FOREIGN KEY ("tenant_id","attachment_object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_payloads_extension_file_version_fk" FOREIGN KEY ("tenant_id","extension_payload_file_version_id","extension_payload_v2_file_id","extension_payload_object_version_id") REFERENCES "public"."inbox_v2_file_versions"("tenant_id","id","file_id","object_version_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_payloads_extension_object_version_fk" FOREIGN KEY ("tenant_id","extension_payload_object_version_id") REFERENCES "public"."inbox_v2_file_object_versions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_action_attributions_cause_event_idx" ON "inbox_v2_action_attributions" USING btree ("tenant_id","automation_cause_event_id") WHERE "inbox_v2_action_attributions"."automation_cause_event_id" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_timeline_content_payloads_attachment_unique" ON "inbox_v2_timeline_content_payloads" USING btree ("tenant_id","content_id","content_revision","attachment_id") WHERE "inbox_v2_timeline_content_payloads"."attachment_id" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_content_payloads_file_version_idx" ON "inbox_v2_timeline_content_payloads" USING btree ("tenant_id","attachment_file_version_id","content_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_timeline_payloads_extension_version_idx" ON "inbox_v2_timeline_content_payloads" USING btree ("tenant_id","extension_payload_file_version_id","content_id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD CONSTRAINT "inbox_v2_message_attachment_anchors_owner_block_unique" UNIQUE("tenant_id","owner_timeline_content_id","owner_block_key");
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD CONSTRAINT "inbox_v2_message_attachment_anchors_owner_identity_unique" UNIQUE("tenant_id","owner_timeline_content_id","id");
--> statement-breakpoint
ALTER TABLE "inbox_v2_message_attachment_anchors" ADD CONSTRAINT "inbox_v2_message_attachment_anchors_exact_owner_unique" UNIQUE("tenant_id","id","owner_timeline_content_id","owner_block_key");
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_version_pins_check" CHECK (num_nonnulls(
          "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
          "inbox_v2_timeline_content_payloads"."attachment_file_revision",
          "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
          "inbox_v2_timeline_content_payloads"."attachment_object_version_id"
        ) in (0, 4)
        and (("inbox_v2_timeline_content_payloads"."attachment_v2_file_id" is null
            and "inbox_v2_timeline_content_payloads"."attachment_file_revision" is null
            and "inbox_v2_timeline_content_payloads"."attachment_file_version_id" is null
            and "inbox_v2_timeline_content_payloads"."attachment_object_version_id" is null)
          or ("inbox_v2_timeline_content_payloads"."attachment_state" = 'ready'
            and "inbox_v2_timeline_content_payloads"."attachment_file_id" is null
            and "inbox_v2_timeline_content_payloads"."attachment_v2_file_id" is not null
            and "inbox_v2_timeline_content_payloads"."attachment_file_revision" >= 1
            and "inbox_v2_timeline_content_payloads"."attachment_file_version_id" is not null
            and "inbox_v2_timeline_content_payloads"."attachment_object_version_id" is not null))
        and num_nonnulls(
          "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
          "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
          "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
          "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id"
        ) in (0, 4)
        and (("inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id" is null
            and "inbox_v2_timeline_content_payloads"."extension_payload_file_revision" is null
            and "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id" is null
            and "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id" is null)
          or ("inbox_v2_timeline_content_payloads"."kind" = 'extension'
            and "inbox_v2_timeline_content_payloads"."extension_payload_file_id" is null
            and "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id" is not null
            and "inbox_v2_timeline_content_payloads"."extension_payload_file_revision" >= 1
            and "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id" is not null
            and "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id" is not null)));
--> statement-breakpoint
ALTER TABLE "inbox_v2_timeline_content_payloads" ADD CONSTRAINT "inbox_v2_timeline_content_payloads_shape_check" CHECK ((
          "inbox_v2_timeline_content_payloads"."kind" = 'text'
          and "inbox_v2_timeline_content_payloads"."text_role" in ('body', 'caption')
          and "inbox_v2_timeline_content_payloads"."text_value" is not null
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."attachment_id", "inbox_v2_timeline_content_payloads"."attachment_state",
            "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
            "inbox_v2_timeline_content_payloads"."attachment_file_revision",
            "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id", "inbox_v2_timeline_content_payloads"."display_name",
            "inbox_v2_timeline_content_payloads"."media_semantic", "inbox_v2_timeline_content_payloads"."latitude", "inbox_v2_timeline_content_payloads"."longitude",
            "inbox_v2_timeline_content_payloads"."accuracy_meters", "inbox_v2_timeline_content_payloads"."location_mode", "inbox_v2_timeline_content_payloads"."live_until",
            "inbox_v2_timeline_content_payloads"."heading_degrees", "inbox_v2_timeline_content_payloads"."location_label",
            "inbox_v2_timeline_content_payloads"."location_address", "inbox_v2_timeline_content_payloads"."contact_display_name",
            "inbox_v2_timeline_content_payloads"."contact_organization",
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id", "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id",
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 0
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" in ('image', 'audio', 'video', 'file', 'sticker')
          and "inbox_v2_timeline_content_payloads"."attachment_id" is not null
          and "inbox_v2_timeline_content_payloads"."attachment_state" is not null
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."text_role", "inbox_v2_timeline_content_payloads"."text_value", "inbox_v2_timeline_content_payloads"."language",
            "inbox_v2_timeline_content_payloads"."latitude", "inbox_v2_timeline_content_payloads"."longitude", "inbox_v2_timeline_content_payloads"."accuracy_meters",
            "inbox_v2_timeline_content_payloads"."location_mode", "inbox_v2_timeline_content_payloads"."live_until",
            "inbox_v2_timeline_content_payloads"."heading_degrees", "inbox_v2_timeline_content_payloads"."location_label",
            "inbox_v2_timeline_content_payloads"."location_address", "inbox_v2_timeline_content_payloads"."contact_display_name",
            "inbox_v2_timeline_content_payloads"."contact_organization",
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id", "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id",
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 0
          and (
            ("inbox_v2_timeline_content_payloads"."attachment_state" = 'pending'
              and num_nonnulls(
                "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
                "inbox_v2_timeline_content_payloads"."attachment_file_revision",
                "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
                "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
                "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id"
              ) = 0)
            or ("inbox_v2_timeline_content_payloads"."attachment_state" = 'ready'
              and "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id" is null
              and (
                ("inbox_v2_timeline_content_payloads"."attachment_file_id" is not null
                  and num_nonnulls(
                    "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
                    "inbox_v2_timeline_content_payloads"."attachment_file_revision",
                    "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
                    "inbox_v2_timeline_content_payloads"."attachment_object_version_id"
                  ) = 0)
                or ("inbox_v2_timeline_content_payloads"."attachment_file_id" is null
                  and num_nonnulls(
                    "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
                    "inbox_v2_timeline_content_payloads"."attachment_file_revision",
                    "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
                    "inbox_v2_timeline_content_payloads"."attachment_object_version_id"
                  ) = 4)
              ))
            or ("inbox_v2_timeline_content_payloads"."attachment_state" in ('failed', 'quarantined')
              and "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id" is not null
              and num_nonnulls(
                "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
                "inbox_v2_timeline_content_payloads"."attachment_file_revision",
                "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
                "inbox_v2_timeline_content_payloads"."attachment_object_version_id"
              ) = 0)
          )
          and (("inbox_v2_timeline_content_payloads"."kind" = 'audio'
              and "inbox_v2_timeline_content_payloads"."media_semantic" in ('audio', 'voice')
              and "inbox_v2_timeline_content_payloads"."display_name" is null)
            or ("inbox_v2_timeline_content_payloads"."kind" = 'video'
              and "inbox_v2_timeline_content_payloads"."media_semantic" in ('video', 'video_note')
              and "inbox_v2_timeline_content_payloads"."display_name" is null)
            or ("inbox_v2_timeline_content_payloads"."kind" in ('image', 'file', 'sticker')
              and "inbox_v2_timeline_content_payloads"."media_semantic" is null))
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'location'
          and "inbox_v2_timeline_content_payloads"."latitude" between -90 and 90
          and "inbox_v2_timeline_content_payloads"."longitude" between -180 and 180
          and "inbox_v2_timeline_content_payloads"."location_mode" in ('static', 'live')
          and (("inbox_v2_timeline_content_payloads"."location_mode" = 'live') = ("inbox_v2_timeline_content_payloads"."live_until" is not null))
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."text_role", "inbox_v2_timeline_content_payloads"."text_value", "inbox_v2_timeline_content_payloads"."language",
            "inbox_v2_timeline_content_payloads"."attachment_id", "inbox_v2_timeline_content_payloads"."attachment_state",
            "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
            "inbox_v2_timeline_content_payloads"."attachment_file_revision",
            "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id", "inbox_v2_timeline_content_payloads"."display_name",
            "inbox_v2_timeline_content_payloads"."media_semantic", "inbox_v2_timeline_content_payloads"."contact_display_name",
            "inbox_v2_timeline_content_payloads"."contact_organization",
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id", "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id",
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 0
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'contact'
          and "inbox_v2_timeline_content_payloads"."contact_display_name" is not null
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."text_role", "inbox_v2_timeline_content_payloads"."text_value", "inbox_v2_timeline_content_payloads"."language",
            "inbox_v2_timeline_content_payloads"."attachment_id", "inbox_v2_timeline_content_payloads"."attachment_state",
            "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
            "inbox_v2_timeline_content_payloads"."attachment_file_revision",
            "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id", "inbox_v2_timeline_content_payloads"."display_name",
            "inbox_v2_timeline_content_payloads"."media_semantic", "inbox_v2_timeline_content_payloads"."latitude", "inbox_v2_timeline_content_payloads"."longitude",
            "inbox_v2_timeline_content_payloads"."accuracy_meters", "inbox_v2_timeline_content_payloads"."location_mode", "inbox_v2_timeline_content_payloads"."live_until",
            "inbox_v2_timeline_content_payloads"."heading_degrees", "inbox_v2_timeline_content_payloads"."location_label",
            "inbox_v2_timeline_content_payloads"."location_address",
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id", "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id",
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 0
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'unsupported_source_content'
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id",
            "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id"
          ) = 3
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."text_role", "inbox_v2_timeline_content_payloads"."text_value", "inbox_v2_timeline_content_payloads"."language",
            "inbox_v2_timeline_content_payloads"."attachment_id", "inbox_v2_timeline_content_payloads"."attachment_state",
            "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
            "inbox_v2_timeline_content_payloads"."attachment_file_revision",
            "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id", "inbox_v2_timeline_content_payloads"."display_name",
            "inbox_v2_timeline_content_payloads"."media_semantic", "inbox_v2_timeline_content_payloads"."latitude", "inbox_v2_timeline_content_payloads"."longitude",
            "inbox_v2_timeline_content_payloads"."accuracy_meters", "inbox_v2_timeline_content_payloads"."location_mode", "inbox_v2_timeline_content_payloads"."live_until",
            "inbox_v2_timeline_content_payloads"."heading_degrees", "inbox_v2_timeline_content_payloads"."location_label",
            "inbox_v2_timeline_content_payloads"."location_address", "inbox_v2_timeline_content_payloads"."contact_display_name",
            "inbox_v2_timeline_content_payloads"."contact_organization",
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
            "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 0
        ) or (
          "inbox_v2_timeline_content_payloads"."kind" = 'extension'
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."extension_block_kind_id", "inbox_v2_timeline_content_payloads"."extension_payload_schema_id",
            "inbox_v2_timeline_content_payloads"."extension_payload_schema_version",
            coalesce("inbox_v2_timeline_content_payloads"."extension_payload_file_id", "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id"),
            "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256",
            "inbox_v2_timeline_content_payloads"."extension_renderer_id"
          ) = 6
          and "inbox_v2_timeline_content_payloads"."extension_payload_digest_sha256" ~ '^[a-f0-9]{64}$'
          and (( "inbox_v2_timeline_content_payloads"."extension_payload_file_id" is not null
                and num_nonnulls(
                  "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
                  "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
                  "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
                  "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id"
                ) = 0)
            or ("inbox_v2_timeline_content_payloads"."extension_payload_file_id" is null
              and num_nonnulls(
                "inbox_v2_timeline_content_payloads"."extension_payload_v2_file_id",
                "inbox_v2_timeline_content_payloads"."extension_payload_file_revision",
                "inbox_v2_timeline_content_payloads"."extension_payload_file_version_id",
                "inbox_v2_timeline_content_payloads"."extension_payload_object_version_id"
              ) = 4))
          and num_nonnulls(
            "inbox_v2_timeline_content_payloads"."text_role", "inbox_v2_timeline_content_payloads"."text_value", "inbox_v2_timeline_content_payloads"."language",
            "inbox_v2_timeline_content_payloads"."attachment_id", "inbox_v2_timeline_content_payloads"."attachment_state",
            "inbox_v2_timeline_content_payloads"."attachment_file_id", "inbox_v2_timeline_content_payloads"."attachment_v2_file_id",
            "inbox_v2_timeline_content_payloads"."attachment_file_revision",
            "inbox_v2_timeline_content_payloads"."attachment_file_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_object_version_id",
            "inbox_v2_timeline_content_payloads"."attachment_failure_reason_id", "inbox_v2_timeline_content_payloads"."display_name",
            "inbox_v2_timeline_content_payloads"."media_semantic", "inbox_v2_timeline_content_payloads"."latitude", "inbox_v2_timeline_content_payloads"."longitude",
            "inbox_v2_timeline_content_payloads"."accuracy_meters", "inbox_v2_timeline_content_payloads"."location_mode", "inbox_v2_timeline_content_payloads"."live_until",
            "inbox_v2_timeline_content_payloads"."heading_degrees", "inbox_v2_timeline_content_payloads"."location_label",
            "inbox_v2_timeline_content_payloads"."location_address", "inbox_v2_timeline_content_payloads"."contact_display_name",
            "inbox_v2_timeline_content_payloads"."contact_organization",
            "inbox_v2_timeline_content_payloads"."unsupported_source_occurrence_id",
            "inbox_v2_timeline_content_payloads"."provider_content_kind_id", "inbox_v2_timeline_content_payloads"."safe_fallback_reason_id"
          ) = 0
        ));
--> statement-breakpoint
-- INBOX_V2_FILE_OBJECT_MIGRATION_FINALIZED_V1
alter table public.inbox_v2_file_attachment_materialization_jobs
  alter constraint inbox_v2_file_mat_jobs_cause_event_fk
  deferrable initially deferred;
alter table public.inbox_v2_file_attachment_materialization_jobs
  alter constraint inbox_v2_file_mat_jobs_authorization_command_fk
  deferrable initially deferred;

alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_content_payloads_file_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_content_payloads_object_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_payloads_extension_file_version_fk
  deferrable initially deferred;
alter table public.inbox_v2_timeline_content_payloads
  alter constraint inbox_v2_timeline_payloads_extension_object_version_fk
  deferrable initially deferred;

-- Ready V2 pins are inserted before the materializer's file/object callback.
-- This deferred commit-time fence permits that ordering while rejecting any
-- transaction that does not close the exact immutable version and current
-- ready-head relationship before commit. Legacy file FKs remain immediate.
create or replace function public.inbox_v2_tm_payload_exact_pin_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.attachment_v2_file_id is not null and not exists (
    select 1
      from public.inbox_v2_file_objects file_row
      join public.inbox_v2_file_versions version_row
        on version_row.tenant_id = file_row.tenant_id
       and version_row.id = new.attachment_file_version_id
       and version_row.file_id = file_row.id
       and version_row.object_version_id = new.attachment_object_version_id
      join public.inbox_v2_file_object_versions object_version_row
        on object_version_row.tenant_id = version_row.tenant_id
       and object_version_row.id = version_row.object_version_id
      join public.inbox_v2_file_object_version_heads object_head_row
        on object_head_row.tenant_id = object_version_row.tenant_id
       and object_head_row.object_version_id = object_version_row.id
     where file_row.tenant_id = new.tenant_id
       and file_row.id = new.attachment_v2_file_id
       and file_row.revision = new.attachment_file_revision
       and file_row.state = 'ready'
       and file_row.current_file_version_id = version_row.id
       and file_row.current_object_version_id = version_row.object_version_id
       and object_head_row.state = 'ready'
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.timeline_payload_attachment_exact_pin_invalid';
  end if;

  if new.extension_payload_v2_file_id is not null and not exists (
    select 1
      from public.inbox_v2_file_objects file_row
      join public.inbox_v2_file_versions version_row
        on version_row.tenant_id = file_row.tenant_id
       and version_row.id = new.extension_payload_file_version_id
       and version_row.file_id = file_row.id
       and version_row.object_version_id =
         new.extension_payload_object_version_id
      join public.inbox_v2_file_object_versions object_version_row
        on object_version_row.tenant_id = version_row.tenant_id
       and object_version_row.id = version_row.object_version_id
      join public.inbox_v2_file_object_version_heads object_head_row
        on object_head_row.tenant_id = object_version_row.tenant_id
       and object_head_row.object_version_id = object_version_row.id
     where file_row.tenant_id = new.tenant_id
       and file_row.id = new.extension_payload_v2_file_id
       and file_row.revision = new.extension_payload_file_revision
       and file_row.state = 'ready'
       and file_row.current_file_version_id = version_row.id
       and file_row.current_object_version_id = version_row.object_version_id
       and object_head_row.state = 'ready'
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.timeline_payload_extension_exact_pin_invalid';
  end if;
  return null;
end;
$function$;

create constraint trigger inbox_v2_tm_payload_exact_pin_coherence
after insert on public.inbox_v2_timeline_content_payloads
deferrable initially deferred
for each row execute function public.inbox_v2_tm_payload_exact_pin_guard();

create or replace function public.inbox_v2_file_delete_is_tenant_cascade(
  tenant_id_value text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select pg_catalog.pg_trigger_depth() > 1
    and not exists (
      select 1
        from public.tenants tenant_row
       where tenant_row.id = tenant_id_value
    );
$function$;

create or replace function public.inbox_v2_file_immutable_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = 'inbox_v2.file_immutable';
end;
$function$;

create or replace function public.inbox_v2_file_object_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  mapped boolean;
  materialization_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' and (
    new.state <> 'pending'
    or new.revision <> 1
    or new.current_file_version_id is not null
    or new.current_object_version_id is not null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_head_initial_state_invalid';
  end if;

  if tg_op = 'UPDATE' then
    if new.tenant_id <> old.tenant_id
       or new.id <> old.id
       or new.data_class_id <> old.data_class_id
       or new.processing_purpose_id <> old.processing_purpose_id
       or new.retention_anchor_at <> old.retention_anchor_at
       or new.created_at <> old.created_at
       or new.revision <> old.revision + 1
       or new.updated_at < old.updated_at then
      raise exception using errcode = '23514',
        message = 'inbox_v2.file_object_head_cas_invalid';
    end if;

    if old.state <> 'pending' or new.state <> 'ready'
       or old.current_file_version_id is not null
       or old.current_object_version_id is not null
       or new.current_file_version_id is null
       or new.current_object_version_id is null then
      raise exception using errcode = '23514',
        message = 'inbox_v2.file_object_head_transition_invalid';
    end if;
  end if;

  if new.current_file_version_id is not null then
    select exists (
      select 1
        from public.inbox_v2_file_versions version_row
       where version_row.tenant_id = new.tenant_id
         and version_row.id = new.current_file_version_id
         and version_row.file_id = new.id
         and version_row.object_version_id = new.current_object_version_id
    ) into mapped;
    if not mapped then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_head_version_invalid';
    end if;
  end if;

  if tg_op = 'UPDATE' then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_jobs job_row
        join public.inbox_v2_file_versions version_row
          on version_row.tenant_id = job_row.tenant_id
         and version_row.id = job_row.reserved_file_version_id
         and version_row.file_id = job_row.file_id
         and version_row.object_version_id = job_row.reserved_object_version_id
        join public.inbox_v2_file_object_version_heads object_head_row
          on object_head_row.tenant_id = job_row.tenant_id
         and object_head_row.object_version_id =
           job_row.reserved_object_version_id
         and object_head_row.state = 'ready'
        join public.inbox_v2_file_object_operation_evidence evidence_row
          on evidence_row.tenant_id = object_head_row.tenant_id
         and evidence_row.id = object_head_row.latest_operation_evidence_id
         and evidence_row.object_version_id = object_head_row.object_version_id
         and evidence_row.materialization_job_id = job_row.id
         and evidence_row.operation_kind = 'put'
         and evidence_row.outcome = 'succeeded'
         and evidence_row.completed_at = object_head_row.state_changed_at
       where job_row.tenant_id = new.tenant_id
         and job_row.file_id = new.id
         and job_row.expected_file_revision = old.revision
         and job_row.reserved_file_version_id = new.current_file_version_id
         and job_row.reserved_object_version_id = new.current_object_version_id
         and job_row.state in ('claimed', 'transferring', 'verifying')
         and evidence_row.completed_at = new.updated_at
    ) into materialization_valid;
    if not materialization_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_head_materialization_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_object_version_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  evidence_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_delete_forbidden';
  end if;

  if tg_op = 'INSERT' and (
    new.revision <> 1
    or new.state not in ('staging', 'ready')
    or (new.state = 'staging' and new.latest_operation_evidence_id is not null)
    or (new.state = 'ready' and new.latest_operation_evidence_id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_initial_state_invalid';
  end if;

  if tg_op = 'UPDATE' and (
    new.tenant_id <> old.tenant_id
    or new.object_version_id <> old.object_version_id
    or new.created_at <> old.created_at
    or new.revision <> old.revision + 1
    or new.state_changed_at < old.state_changed_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_cas_invalid';
  end if;

  if tg_op = 'UPDATE' and (
    old.state <> 'staging'
    or new.state <> 'ready'
    or new.latest_operation_evidence_id is null
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_object_version_head_transition_invalid';
  end if;

  if new.state = 'ready' then
    select exists (
      select 1
        from public.inbox_v2_file_object_versions object_version_row
        join public.inbox_v2_file_object_operation_evidence evidence_row
          on evidence_row.tenant_id = object_version_row.tenant_id
         and evidence_row.object_version_id = object_version_row.id
        join public.inbox_v2_file_attachment_materialization_jobs job_row
          on job_row.tenant_id = evidence_row.tenant_id
         and job_row.id = evidence_row.materialization_job_id
         and job_row.reserved_object_version_id = evidence_row.object_version_id
         and job_row.reserved_storage_root_id = evidence_row.storage_root_id
       where evidence_row.tenant_id = new.tenant_id
         and evidence_row.id = new.latest_operation_evidence_id
         and evidence_row.object_version_id = new.object_version_id
         and evidence_row.operation_kind = 'put'
         and evidence_row.outcome = 'succeeded'
         and evidence_row.safe_reason_id is null
         and evidence_row.expected_object_head_revision is null
         and evidence_row.completed_at = new.state_changed_at
         and evidence_row.requested_at <= evidence_row.completed_at
         and evidence_row.affected_bytes = object_version_row.size_bytes
         and object_version_row.storage_root_id = evidence_row.storage_root_id
         and job_row.reserved_storage_object_key =
           object_version_row.storage_object_key
         and job_row.state in ('claimed', 'transferring', 'verifying')
    ) into evidence_valid;
    if not evidence_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_object_version_evidence_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_materialization_job_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_valid boolean := false;
  old_active boolean;
  new_active boolean;
  reauthorization boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_delete_forbidden';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.revision <> 1
       or new.lease_generation <> 0
       or new.authorization_command_type_id <>
         'core:attachment.materialization.reserve'
       or new.terminal_reason_id is not null then
      raise exception using errcode = '23514',
        message = 'inbox_v2.attachment_materialization_initial_state_invalid';
    end if;
    return new;
  end if;

  reauthorization :=
    old.state = 'pending'
    and new.state = 'pending'
    and num_nonnulls(
      old.lease_token_hash, old.lease_owner_id,
      old.lease_claimed_at, old.lease_expires_at
    ) = 0
    and num_nonnulls(
      new.lease_token_hash, new.lease_owner_id,
      new.lease_claimed_at, new.lease_expires_at
    ) = 0
    and new.lease_generation = old.lease_generation
    and new.authorization_command_type_id =
      'core:attachment.materialization.reauthorize'
    and new.authorization_command_id is distinct from
      old.authorization_command_id
    and new.authorization_actor_kind = 'trusted_service'
    and new.authorization_authorized_at >= old.authorization_authorized_at;

  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.attachment_id is distinct from old.attachment_id
     or new.file_id is distinct from old.file_id
     or new.expected_file_revision is distinct from old.expected_file_revision
     or new.conversation_id is distinct from old.conversation_id
     or new.timeline_item_id is distinct from old.timeline_item_id
     or new.parent_message_id is distinct from old.parent_message_id
     or new.expected_parent_revision is distinct from
       old.expected_parent_revision
     or new.visibility_boundary is distinct from old.visibility_boundary
     or new.timeline_content_id is distinct from old.timeline_content_id
     or new.expected_content_revision is distinct from old.expected_content_revision
     or new.content_block_key is distinct from old.content_block_key
     or new.content_mutation_fence_sha256 is distinct from
       old.content_mutation_fence_sha256
     or new.source_occurrence_id is distinct from old.source_occurrence_id
     or new.source_locator_kind is distinct from old.source_locator_kind
     or new.source_locator_reference is distinct from old.source_locator_reference
     or new.source_locator_digest_sha256 is distinct from
       old.source_locator_digest_sha256
     or new.reservation_namespace_generation is distinct from
       old.reservation_namespace_generation
     or new.idempotency_token is distinct from old.idempotency_token
     or new.cause_event_id is distinct from old.cause_event_id
     or new.cause_mutation_id is distinct from old.cause_mutation_id
     or new.cause_stream_commit_id is distinct from old.cause_stream_commit_id
     or new.cause_stream_position is distinct from old.cause_stream_position
     or new.correlation_id is distinct from old.correlation_id
     or new.caused_at is distinct from old.caused_at
     or (not reauthorization and (
       new.authorization_command_id is distinct from
         old.authorization_command_id
       or new.authorization_command_type_id is distinct from
         old.authorization_command_type_id
       or new.authorization_client_mutation_id is distinct from
         old.authorization_client_mutation_id
       or new.authorization_mutation_id is distinct from
         old.authorization_mutation_id
       or new.authorization_decision_id is distinct from
         old.authorization_decision_id
       or new.authorization_epoch is distinct from old.authorization_epoch
       or new.authorization_actor_kind is distinct from
         old.authorization_actor_kind
       or new.authorization_actor_id is distinct from
         old.authorization_actor_id
       or new.authorization_authorized_at is distinct from
         old.authorization_authorized_at
       or new.authorization_decision_set_digest_sha256 is distinct from
         old.authorization_decision_set_digest_sha256
       or new.authorization_resource_fence_set_digest_sha256 is distinct from
         old.authorization_resource_fence_set_digest_sha256
       or new.authorization_tenant_rbac_revision is distinct from
         old.authorization_tenant_rbac_revision
       or new.authorization_shared_access_revision is distinct from
         old.authorization_shared_access_revision
       or new.authorization_resource_head_id is distinct from
         old.authorization_resource_head_id
       or new.authorization_resource_access_revision is distinct from
         old.authorization_resource_access_revision
       or new.authorization_structural_relation_revision is distinct from
         old.authorization_structural_relation_revision
       or new.authorization_collaborator_set_revision is distinct from
         old.authorization_collaborator_set_revision
       or new.authorization_audit_grant_source_ids is distinct from
         old.authorization_audit_grant_source_ids
       or new.authorization_audit_policy_version is distinct from
         old.authorization_audit_policy_version
     ))
     or new.expected_attachment_revision is distinct from
       old.expected_attachment_revision
     or new.reserved_file_version_id is distinct from
       old.reserved_file_version_id
     or new.reserved_object_version_id is distinct from
       old.reserved_object_version_id
     or new.reserved_storage_root_id is distinct from
       old.reserved_storage_root_id
     or new.reserved_storage_object_key is distinct from
       old.reserved_storage_object_key
     or new.created_at is distinct from old.created_at
     or new.updated_at < old.updated_at
     or new.revision <> old.revision + 1
     or new.lease_generation < old.lease_generation
     or new.lease_generation > old.lease_generation + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_cas_invalid';
  end if;

  if old.state in ('ready', 'failed', 'quarantined', 'cancelled') then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_terminal';
  end if;

  old_active := old.state in ('claimed', 'transferring', 'verifying');
  new_active := new.state in ('claimed', 'transferring', 'verifying');

  if reauthorization then
    transition_valid := true;
  elsif old.state = 'pending' and new.state = 'claimed' then
    transition_valid :=
      new.lease_generation = old.lease_generation + 1;
  elsif old.state = 'pending' and new.state = 'cancelled' then
    transition_valid :=
      new.lease_generation = old.lease_generation;
  elsif old_active and new.state = 'pending' then
    transition_valid :=
      new.lease_generation = old.lease_generation
      and num_nonnulls(
        new.lease_token_hash, new.lease_owner_id,
        new.lease_claimed_at, new.lease_expires_at
      ) = 0;
  elsif old_active and new.state = old.state then
    transition_valid :=
      old.lease_expires_at <= clock_timestamp()
      and new.lease_generation = old.lease_generation + 1
      and new.lease_token_hash is distinct from old.lease_token_hash
      and new.lease_claimed_at >= old.lease_expires_at;
  elsif old_active and (
    (old.state = 'claimed' and new.state in (
      'transferring', 'verifying', 'ready', 'failed', 'quarantined',
      'cancelled'
    ))
    or (old.state = 'transferring' and new.state in (
      'verifying', 'ready', 'failed', 'quarantined', 'cancelled'
    ))
    or (old.state = 'verifying' and new.state in (
      'ready', 'failed', 'quarantined', 'cancelled'
    ))
  ) then
    transition_valid :=
      new.lease_generation = old.lease_generation
      and (
        (new_active
          and new.lease_token_hash is not distinct from old.lease_token_hash
          and new.lease_owner_id is not distinct from old.lease_owner_id
          and new.lease_claimed_at is not distinct from old.lease_claimed_at
          and new.lease_expires_at is not distinct from old.lease_expires_at)
        or (not new_active
          and num_nonnulls(
            new.lease_token_hash, new.lease_owner_id,
            new.lease_claimed_at, new.lease_expires_at
          ) = 0)
      );
  end if;

  if not transition_valid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.attachment_materialization_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_materialization_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  job_row public.inbox_v2_file_attachment_materialization_jobs%rowtype;
  identity_valid boolean;
  attempt_valid boolean;
  completion_valid boolean;
  requires_current_fence boolean;
begin
  if tg_table_name = 'inbox_v2_file_attachment_materialization_jobs'
     and tg_op = 'INSERT' then
    job_row := new;
  elsif tg_table_name = 'inbox_v2_file_attachment_materialization_jobs' then
    select * into job_row
      from public.inbox_v2_file_attachment_materialization_jobs candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.id = new.id;
  else
    select * into job_row
      from public.inbox_v2_file_attachment_materialization_jobs candidate_row
     where candidate_row.tenant_id = new.tenant_id
       and candidate_row.id = new.job_id;
  end if;

  -- The immutable reservation origin remains authoritative evidence even
  -- after current content or access has moved on. Only a completed terminal
  -- materialization is required to remain attached to the exact current head;
  -- claim and pre-I/O authorization own the live-current fence for pending,
  -- active and cancelled jobs.
  requires_current_fence :=
    job_row.state in ('ready', 'failed', 'quarantined');

  select exists (
    select 1
      from public.inbox_v2_message_attachment_anchors attachment_row
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = attachment_row.tenant_id
       and content_row.id = attachment_row.owner_timeline_content_id
       and content_row.id = job_row.timeline_content_id
      join public.inbox_v2_timeline_content_revisions origin_revision_row
        on origin_revision_row.tenant_id = content_row.tenant_id
       and origin_revision_row.content_id = content_row.id
       and origin_revision_row.revision = job_row.expected_content_revision
       and origin_revision_row.state = 'available'
       and origin_revision_row.recorded_stream_position =
         job_row.cause_stream_position
      left join public.inbox_v2_timeline_content_payloads origin_payload_row
        on origin_payload_row.tenant_id = content_row.tenant_id
       and origin_payload_row.content_id = content_row.id
       and origin_payload_row.content_revision = job_row.expected_content_revision
       and origin_payload_row.block_key = job_row.content_block_key
       and origin_payload_row.attachment_id = job_row.attachment_id
       and origin_payload_row.attachment_state = 'pending'
      left join public.inbox_v2_timeline_content_payloads current_payload_row
        on current_payload_row.tenant_id = content_row.tenant_id
       and current_payload_row.content_id = content_row.id
       and current_payload_row.content_revision = content_row.revision
       and current_payload_row.block_key = job_row.content_block_key
       and current_payload_row.attachment_id = job_row.attachment_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = content_row.tenant_id
       and message_row.id = job_row.parent_message_id
       and message_row.conversation_id = job_row.conversation_id
       and message_row.timeline_item_id = job_row.timeline_item_id
       and message_row.content_id = content_row.id
       and message_row.content_revision = content_row.revision
       and message_row.content_state = content_row.state
       and message_row.revision >= job_row.expected_parent_revision
       and content_row.owner_kind = 'message'
       and content_row.owner_id = message_row.id
      join public.inbox_v2_message_revisions origin_message_revision_row
        on origin_message_revision_row.tenant_id = message_row.tenant_id
       and origin_message_revision_row.message_id = message_row.id
       and origin_message_revision_row.timeline_item_id = message_row.timeline_item_id
       and origin_message_revision_row.message_revision =
         job_row.expected_parent_revision
       and origin_message_revision_row.after_content_id = content_row.id
       and origin_message_revision_row.after_content_revision =
         job_row.expected_content_revision
       and origin_message_revision_row.after_content_state = 'available'
       and origin_message_revision_row.recorded_stream_position =
         job_row.cause_stream_position
      join public.inbox_v2_timeline_items timeline_item_row
        on timeline_item_row.tenant_id = message_row.tenant_id
       and timeline_item_row.id = message_row.timeline_item_id
       and timeline_item_row.conversation_id = message_row.conversation_id
      left join public.inbox_v2_source_occurrences source_occurrence_row
        on source_occurrence_row.tenant_id = job_row.tenant_id
       and source_occurrence_row.id = job_row.source_occurrence_id
       and source_occurrence_row.conversation_id = job_row.conversation_id
      join public.inbox_v2_domain_events cause_event_row
        on cause_event_row.tenant_id = job_row.tenant_id
       and cause_event_row.id = job_row.cause_event_id
       and cause_event_row.mutation_id = job_row.cause_mutation_id
       and cause_event_row.stream_commit_id = job_row.cause_stream_commit_id
       and cause_event_row.stream_position = job_row.cause_stream_position
       and cause_event_row.correlation_id = job_row.correlation_id
       and cause_event_row.occurred_at = job_row.caused_at
       and cause_event_row.type_id = 'core:message.changed'
       and cause_event_row.subjects @> jsonb_build_array(
         jsonb_build_object(
           'tenantId', job_row.tenant_id,
           'entityTypeId', 'core:message',
           'entityId', message_row.id
         )
       )
      join public.inbox_v2_tenant_stream_changes cause_change_row
        on cause_change_row.tenant_id = cause_event_row.tenant_id
       and cause_change_row.stream_commit_id =
         cause_event_row.stream_commit_id
       and cause_change_row.mutation_id = cause_event_row.mutation_id
       and cause_change_row.stream_position = cause_event_row.stream_position
       and cause_change_row.entity_type_id = 'core:message'
       and cause_change_row.entity_id = message_row.id
       and cause_event_row.change_ids @>
         jsonb_build_array(cause_change_row.id)
      join public.inbox_v2_auth_command_records authorization_command_row
        on authorization_command_row.tenant_id = job_row.tenant_id
       and authorization_command_row.id = job_row.authorization_command_id
       and authorization_command_row.command_type_id =
         job_row.authorization_command_type_id
       and authorization_command_row.command_type_id in (
         'core:attachment.materialization.reserve',
         'core:attachment.materialization.reauthorize'
       )
       and authorization_command_row.client_mutation_id =
         job_row.authorization_client_mutation_id
       and authorization_command_row.mutation_id =
         job_row.authorization_mutation_id
       and authorization_command_row.authorization_decision_id =
         job_row.authorization_decision_id
       and authorization_command_row.authorization_epoch =
         job_row.authorization_epoch
       and authorization_command_row.authorized_at =
         job_row.authorization_authorized_at
       and authorization_command_row.state = 'completed'
       and authorization_command_row.result_reference->>'tenantId' =
         job_row.tenant_id
       and authorization_command_row.result_reference->>'recordId' = job_row.id
       and job_row.authorization_actor_kind = 'trusted_service'
       and authorization_command_row.actor_kind = 'trusted_service'
       and authorization_command_row.actor_trusted_service_id =
         job_row.authorization_actor_id
       and authorization_command_row.actor_employee_id is null
      join public.inbox_v2_auth_audit_events authorization_audit_row
        on authorization_audit_row.tenant_id = job_row.tenant_id
       and authorization_audit_row.command_record_id =
         job_row.authorization_command_id
       and authorization_audit_row.mutation_id =
         job_row.authorization_mutation_id
       and authorization_audit_row.grant_source_ids =
         job_row.authorization_audit_grant_source_ids
       and authorization_audit_row.policy_version is not distinct from
         job_row.authorization_audit_policy_version
      join public.inbox_v2_auth_tenant_heads authorization_tenant_head_row
        on authorization_tenant_head_row.tenant_id = job_row.tenant_id
      join public.inbox_v2_auth_resource_heads authorization_resource_head_row
        on authorization_resource_head_row.tenant_id = job_row.tenant_id
       and authorization_resource_head_row.id =
         job_row.authorization_resource_head_id
       and authorization_resource_head_row.resource_kind = 'conversation'
       and authorization_resource_head_row.conversation_id =
         job_row.conversation_id
       and not exists (
         select 1
           from unnest(job_row.authorization_audit_grant_source_ids)
                with ordinality grant_source(value, ordinal)
           left join unnest(job_row.authorization_audit_grant_source_ids)
                with ordinality previous_source(value, ordinal)
             on previous_source.ordinal = grant_source.ordinal - 1
          where grant_source.value !~ '^internal-ref:[a-f0-9]{32,64}$'
             or (grant_source.ordinal > 1
               and grant_source.value <= previous_source.value)
       )
       and jsonb_array_length(
         authorization_command_row.authorization_decision_refs
       ) = 2
       and exists (
         select 1
           from jsonb_array_elements(
             authorization_command_row.authorization_decision_refs
           ) decision
          where decision->>'id' = job_row.authorization_decision_id
            and decision->>'tenantId' = job_row.tenant_id
            and decision->>'authorizationEpoch' = job_row.authorization_epoch
            and decision->>'permissionId' = 'core:file.upload'
            and decision->>'resourceScopeId' = 'core:conversation'
            and decision->>'outcome' = 'allowed'
            and decision#>>'{principal,kind}' = 'trusted_service'
            and decision#>>'{principal,trustedServiceId}' =
              job_row.authorization_actor_id
            and decision#>>'{resource,entityTypeId}' = 'core:conversation'
            and decision#>>'{resource,entityId}' = job_row.conversation_id
            and (decision->>'resourceAccessRevision')::bigint =
              job_row.authorization_resource_access_revision
       )
       and exists (
         select 1
           from jsonb_array_elements(
             authorization_command_row.authorization_decision_refs
           ) decision
          where decision->>'tenantId' = job_row.tenant_id
            and decision->>'authorizationEpoch' = job_row.authorization_epoch
            and decision->>'permissionId' = case job_row.visibility_boundary
              when 'external_work' then 'core:conversation.read'
              when 'internal' then 'core:conversation.internal.read'
            end
            and decision->>'resourceScopeId' = 'core:conversation'
            and decision->>'outcome' = 'allowed'
            and decision#>>'{principal,kind}' = 'trusted_service'
            and decision#>>'{principal,trustedServiceId}' =
              job_row.authorization_actor_id
            and decision#>>'{resource,entityTypeId}' = 'core:conversation'
            and decision#>>'{resource,entityId}' = job_row.conversation_id
            and (decision->>'resourceAccessRevision')::bigint =
              job_row.authorization_resource_access_revision
       )
     where attachment_row.tenant_id = job_row.tenant_id
       and attachment_row.id = job_row.attachment_id
       and attachment_row.owner_message_id = job_row.parent_message_id
       and attachment_row.owner_timeline_item_id = job_row.timeline_item_id
       and attachment_row.owner_timeline_content_id =
         job_row.timeline_content_id
       and attachment_row.owner_block_key = job_row.content_block_key
       and (
         origin_payload_row.attachment_id = job_row.attachment_id
         or (
           content_row.state in ('privacy_erased', 'retention_purged')
           and origin_payload_row.attachment_id is null
         )
       )
       and content_row.revision >= job_row.expected_content_revision
       and (
         not requires_current_fence
         or (
           content_row.state = 'available'
           and message_row.lifecycle = 'active'
           and content_row.revision = job_row.result_content_revision
           and timeline_item_row.visibility = case job_row.visibility_boundary
             when 'external_work' then
               'conversation_external'::public.inbox_v2_timeline_visibility
             when 'internal' then
               'internal_participants'::public.inbox_v2_timeline_visibility
           end
           and attachment_row.materialization_state::text = job_row.state::text
           and attachment_row.revision =
             job_row.expected_attachment_revision + 1
           and current_payload_row.attachment_state::text = job_row.state::text
           and authorization_tenant_head_row.tenant_rbac_revision =
             job_row.authorization_tenant_rbac_revision
           and authorization_tenant_head_row.shared_access_revision =
             job_row.authorization_shared_access_revision
           and authorization_resource_head_row.resource_access_revision =
             job_row.authorization_resource_access_revision
           and authorization_resource_head_row.structural_relation_revision =
             job_row.authorization_structural_relation_revision
           and authorization_resource_head_row.collaborator_set_revision =
             job_row.authorization_collaborator_set_revision
         )
       )
       and (job_row.source_locator_kind <> 'provider'
         or (source_occurrence_row.id is not null
           and message_row.origin_source_occurrence_id =
             job_row.source_occurrence_id))
  ) into identity_valid;
  if not identity_valid then
    raise exception using errcode = '23503',
      message = 'inbox_v2.attachment_materialization_identity_invalid';
  end if;

  if job_row.state = 'cancelled' then
    return new;
  end if;

  if job_row.state in ('claimed', 'transferring', 'verifying',
                       'ready', 'failed', 'quarantined') then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_attempts attempt_row
       where attempt_row.tenant_id = job_row.tenant_id
         and attempt_row.job_id = job_row.id
         and attempt_row.attachment_id = job_row.attachment_id
         and attempt_row.file_id = job_row.file_id
         and attempt_row.lease_generation = job_row.lease_generation
         and attempt_row.expected_file_revision = job_row.expected_file_revision
         and attempt_row.expected_attachment_revision =
           job_row.expected_attachment_revision
         and attempt_row.expected_job_revision <= job_row.revision
         and (job_row.state not in ('claimed', 'transferring', 'verifying')
           or (attempt_row.lease_token_hash = job_row.lease_token_hash
             and attempt_row.lease_owner_id = job_row.lease_owner_id
             and attempt_row.claimed_at = job_row.lease_claimed_at
             and attempt_row.lease_expires_at = job_row.lease_expires_at))
    ) into attempt_valid;
    if not attempt_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.attachment_materialization_attempt_invalid';
    end if;
  end if;

  if job_row.state in ('ready', 'failed', 'quarantined') then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_evidence evidence_row
        join public.inbox_v2_message_attachment_anchors attachment_row
          on attachment_row.tenant_id = evidence_row.tenant_id
         and attachment_row.id = evidence_row.attachment_id
         and attachment_row.revision = evidence_row.resulting_attachment_revision
        join public.inbox_v2_timeline_content_revisions revision_row
          on revision_row.tenant_id = evidence_row.tenant_id
         and revision_row.content_id = evidence_row.timeline_content_id
         and revision_row.revision = evidence_row.resulting_content_revision
         and revision_row.expected_previous_revision =
           evidence_row.expected_content_revision
         and revision_row.transition_kind = 'attachment_materialization'
         and revision_row.state = 'available'
        join public.inbox_v2_timeline_content_payloads payload_row
          on payload_row.tenant_id = evidence_row.tenant_id
         and payload_row.content_id = evidence_row.timeline_content_id
         and payload_row.content_revision = evidence_row.resulting_content_revision
         and payload_row.block_key = job_row.content_block_key
         and payload_row.attachment_id = evidence_row.attachment_id
       where evidence_row.tenant_id = job_row.tenant_id
         and evidence_row.job_id = job_row.id
         and evidence_row.attachment_id = job_row.attachment_id
         and evidence_row.file_id = job_row.file_id
         and evidence_row.lease_generation = job_row.lease_generation
         and evidence_row.expected_file_revision = job_row.expected_file_revision
         and evidence_row.expected_attachment_revision =
           job_row.expected_attachment_revision
         and evidence_row.timeline_content_id = job_row.timeline_content_id
         and evidence_row.expected_content_revision >=
           job_row.expected_content_revision
         and evidence_row.resulting_content_revision =
           evidence_row.expected_content_revision + 1
         and evidence_row.resulting_content_revision =
           job_row.result_content_revision
         and evidence_row.content_mutation_fence_sha256 =
           job_row.content_mutation_fence_sha256
         and evidence_row.outcome::text = job_row.state::text
         and evidence_row.result_file_version_id is not distinct from
           job_row.result_file_version_id
         and evidence_row.result_object_version_id is not distinct from
           job_row.result_object_version_id
         and evidence_row.resulting_file_revision is not distinct from
           job_row.result_file_revision
         and evidence_row.safe_reason_id is not distinct from
           job_row.terminal_reason_id
         and (job_row.state = 'failed' or exists (
           select 1
             from public.inbox_v2_file_object_operation_evidence operation_row
            where operation_row.tenant_id = evidence_row.tenant_id
              and operation_row.id = evidence_row.object_operation_evidence_id
              and operation_row.materialization_job_id = job_row.id
              and operation_row.object_version_id = case
                when job_row.state = 'ready'
                  then job_row.result_object_version_id
                else job_row.reserved_object_version_id
              end
              and operation_row.operation_kind::text = case
                when job_row.state = 'ready' then 'put'
                else 'quarantine'
              end
              and operation_row.outcome = 'succeeded'
         ))
         and payload_row.attachment_state::text = job_row.state::text
         and payload_row.attachment_file_version_id is not distinct from
           job_row.result_file_version_id
         and payload_row.attachment_object_version_id is not distinct from
           job_row.result_object_version_id
         and payload_row.attachment_v2_file_id is not distinct from case
           when job_row.state = 'ready' then job_row.file_id else null end
         and payload_row.attachment_file_revision is not distinct from case
           when job_row.state = 'ready'
             then job_row.result_file_revision else null end
         and payload_row.attachment_failure_reason_id is not distinct from case
           when job_row.state in ('failed', 'quarantined')
             then job_row.terminal_reason_id else null end
         and (job_row.state <> 'ready' or exists (
           select 1
             from public.inbox_v2_file_objects file_row
             join public.inbox_v2_file_versions file_version_row
               on file_version_row.tenant_id = file_row.tenant_id
              and file_version_row.id = job_row.result_file_version_id
              and file_version_row.file_id = file_row.id
              and file_version_row.object_version_id =
                job_row.result_object_version_id
             join public.inbox_v2_file_object_versions object_version_row
               on object_version_row.tenant_id = file_row.tenant_id
              and object_version_row.id = job_row.result_object_version_id
             join public.inbox_v2_file_object_version_heads object_head_row
               on object_head_row.tenant_id = object_version_row.tenant_id
              and object_head_row.object_version_id = object_version_row.id
            where file_row.tenant_id = job_row.tenant_id
              and file_row.id = job_row.file_id
              and file_row.revision = job_row.result_file_revision
              and file_row.state = 'ready'
              and file_row.current_file_version_id =
                job_row.result_file_version_id
              and file_row.current_object_version_id =
                job_row.result_object_version_id
              and object_version_row.storage_root_id =
                job_row.reserved_storage_root_id
              and object_version_row.storage_object_key =
                job_row.reserved_storage_object_key
              and object_head_row.state = 'ready'
         ))
    ) into completion_valid;
    if not completion_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.attachment_materialization_completion_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_storage_orphan_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_valid boolean := false;
  adoption_valid boolean := false;
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_delete_forbidden';
  end if;
  if old.state in ('quarantined', 'adopted', 'deleted', 'failed')
     or new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.materialization_job_id is distinct from old.materialization_job_id
     or new.storage_root_id is distinct from old.storage_root_id
     or new.storage_object_key is distinct from old.storage_object_key
     or new.storage_version_identity is distinct from old.storage_version_identity
     or new.checksum_sha256 is distinct from old.checksum_sha256
     or new.size_bytes is distinct from old.size_bytes
     or new.detected_media_type is distinct from old.detected_media_type
     or new.quarantine_reason_code is distinct from old.quarantine_reason_code
     or new.quarantine_evidence_digest_sha256 is distinct from
       old.quarantine_evidence_digest_sha256
     or new.quarantine_physical_kind is distinct from old.quarantine_physical_kind
     or new.first_observed_at is distinct from old.first_observed_at
     or new.revision <> old.revision + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_cas_invalid';
  end if;

  if old.state = 'open' and new.state in ('claimed', 'adopted', 'failed') then
    transition_valid := true;
  elsif old.state = 'claimed' and new.state = 'claimed' then
    transition_valid :=
      old.claim_expires_at <= clock_timestamp()
      and new.claim_token_hash is distinct from old.claim_token_hash;
  elsif old.state = 'claimed' and new.state in ('adopted', 'deleted', 'failed') then
    transition_valid := true;
  end if;
  if not transition_valid then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_storage_orphan_transition_invalid';
  end if;

  if new.state = 'adopted' then
    select exists (
      select 1
        from public.inbox_v2_file_attachment_materialization_jobs job_row
        join public.inbox_v2_file_object_versions object_version_row
          on object_version_row.tenant_id = job_row.tenant_id
         and object_version_row.id = job_row.result_object_version_id
        join public.inbox_v2_file_attachment_materialization_evidence evidence_row
          on evidence_row.tenant_id = job_row.tenant_id
         and evidence_row.job_id = job_row.id
         and evidence_row.outcome = 'ready'
         and evidence_row.result_object_version_id =
           job_row.result_object_version_id
         and evidence_row.evidence_hash_sha256 =
           new.terminal_evidence_digest_sha256
       where job_row.tenant_id = new.tenant_id
         and job_row.id = new.materialization_job_id
         and job_row.state = 'ready'
         and job_row.result_object_version_id =
           new.adopted_object_version_id
         and job_row.reserved_object_version_id =
           new.adopted_object_version_id
         and object_version_row.storage_root_id = new.storage_root_id
         and object_version_row.storage_object_key = new.storage_object_key
         and object_version_row.storage_version_identity =
           new.storage_version_identity
         and object_version_row.checksum_sha256 = new.checksum_sha256
         and object_version_row.size_bytes = new.size_bytes
         and object_version_row.detected_media_type = new.detected_media_type
    ) into adoption_valid;
    if not adoption_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_storage_orphan_adoption_invalid';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  parent_valid boolean := false;
  head_row record;
begin
  if tg_table_name = 'inbox_v2_file_parent_links' then
    if new.parent_kind = 'message' then
      select exists (
        select 1
          from public.inbox_v2_messages message_row
          join public.inbox_v2_timeline_items item_row
            on item_row.tenant_id = message_row.tenant_id
           and item_row.id = message_row.timeline_item_id
           and item_row.conversation_id = message_row.conversation_id
         where message_row.tenant_id = new.tenant_id
           and message_row.id = new.parent_entity_id
           and message_row.revision = new.parent_entity_revision
           and message_row.conversation_id = new.conversation_id
           and message_row.timeline_item_id = new.timeline_item_id
           and message_row.content_id = new.content_id
           and message_row.content_revision = new.content_revision
           and ((new.visibility_boundary = 'external_work'
                and item_row.visibility = 'conversation_external')
             or (new.visibility_boundary = 'internal'
                and item_row.visibility = 'internal_participants'))
      ) into parent_valid;
    elsif new.parent_kind = 'staff_note' then
      select exists (
        select 1
          from public.inbox_v2_staff_notes note_row
          join public.inbox_v2_timeline_items item_row
            on item_row.tenant_id = note_row.tenant_id
           and item_row.id = note_row.timeline_item_id
           and item_row.conversation_id = note_row.conversation_id
         where note_row.tenant_id = new.tenant_id
           and note_row.id = new.parent_entity_id
           and note_row.revision = new.parent_entity_revision
           and note_row.conversation_id = new.conversation_id
           and note_row.timeline_item_id = new.timeline_item_id
           and note_row.content_id = new.content_id
           and note_row.content_revision = new.content_revision
           and item_row.visibility = 'staff_only'
      ) into parent_valid;
    else
      select exists (
        select 1
          from public.inbox_v2_message_attachment_anchors attachment_row
         where attachment_row.tenant_id = new.tenant_id
           and attachment_row.id = new.parent_entity_id
           and attachment_row.revision = new.parent_entity_revision
           and exists (
             select 1
               from public.inbox_v2_file_attachment_materialization_jobs job_row
              where job_row.tenant_id = attachment_row.tenant_id
                and job_row.attachment_id = attachment_row.id
                and job_row.file_id = new.file_id
           )
      ) into parent_valid;
    end if;

    if parent_valid and new.parent_kind in ('message', 'staff_note') then
      select exists (
        select 1
          from public.inbox_v2_timeline_content_payloads payload_row
         where payload_row.tenant_id = new.tenant_id
           and payload_row.content_id = new.content_id
           and payload_row.content_revision = new.content_revision
           and payload_row.block_key = new.block_key
           and (
             (new.parent_purpose = 'attachment'
               and payload_row.attachment_v2_file_id = new.file_id
               and payload_row.attachment_file_version_id = new.file_version_id
               and payload_row.attachment_object_version_id =
                 new.object_version_id)
             or (new.parent_purpose = 'extension_payload'
               and payload_row.extension_payload_v2_file_id = new.file_id
               and payload_row.extension_payload_file_version_id =
                 new.file_version_id
               and payload_row.extension_payload_object_version_id =
                 new.object_version_id)
           )
      ) into parent_valid;
    end if;

    if not parent_valid then
      raise exception using errcode = '23503',
        message = 'inbox_v2.file_parent_invalid';
    end if;
  end if;

  select * into head_row
    from public.inbox_v2_file_parent_set_heads head
   where head.tenant_id = new.tenant_id
     and head.file_id = new.file_id;

  if head_row.completeness = 'complete' and (
    head_row.completeness_revision <> head_row.revision
    or head_row.live_parent_count <> (
      select count(*)
        from public.inbox_v2_file_parent_links link_row
        join public.inbox_v2_file_parent_link_heads link_head_row
          on link_head_row.tenant_id = link_row.tenant_id
         and link_head_row.link_id = link_row.id
         and link_head_row.file_id = link_row.file_id
       where link_row.tenant_id = new.tenant_id
         and link_row.file_id = new.file_id
         and link_head_row.state = 'live'
    )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_incomplete';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_link_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_link_head_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and (
    old.state <> 'live' or new.state <> 'detached'
    or new.tenant_id is distinct from old.tenant_id
    or new.link_id is distinct from old.link_id
    or new.file_id is distinct from old.file_id
    or new.revision <> old.revision + 1
    or new.detached_by_event_id is null
    or new.updated_at < old.updated_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_link_head_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_parent_set_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if public.inbox_v2_file_delete_is_tenant_cascade(old.tenant_id) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_head_delete_forbidden';
  end if;
  if tg_op = 'UPDATE' and (
    new.tenant_id is distinct from old.tenant_id
    or new.file_id is distinct from old.file_id
    or new.revision <> old.revision + 1
    or new.updated_at < old.updated_at
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_parent_set_head_cas_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_derivative_cycle_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  cycle_exists boolean;
begin
  -- The advisory-lock recheck depends on READ COMMITTED taking a fresh
  -- statement snapshot after the previous lock owner commits. Fail closed
  -- before touching the graph when a caller pins an older transaction
  -- snapshot (for example REPEATABLE READ or SERIALIZABLE).
  if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
    raise exception using errcode = '25001',
      message = 'inbox_v2.file_derivative_isolation_unsafe';
  end if;

  -- Serialize only this tenant's derivative graph. The domain-separated,
  -- deterministic 64-bit key avoids cross-tenant contention while making a
  -- concurrent reciprocal/path-closing insert wait for the earlier commit.
  perform pg_catalog.pg_advisory_xact_lock(
    (
      'x' || pg_catalog.substr(
        pg_catalog.md5(
          'core:inbox-v2.file-derivative-graph:' || new.tenant_id
        ),
        1,
        16
      )
    )::bit(64)::bigint
  );

  -- VOLATILE PL/pgSQL executes this query with the post-lock READ COMMITTED
  -- snapshot, so an edge committed by the previous lock owner is rechecked.
  with recursive descendants(file_version_id) as (
    select new.derived_file_version_id
    union
    select edge.derived_file_version_id
      from public.inbox_v2_file_derivative_edges edge
      join descendants prior
        on prior.file_version_id = edge.original_file_version_id
     where edge.tenant_id = new.tenant_id
  )
  select exists (
    select 1 from descendants
     where file_version_id = new.original_file_version_id
  ) into cycle_exists;

  if cycle_exists then
    raise exception using errcode = '23514',
      message = 'inbox_v2.file_derivative_cycle';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_artifact_retry_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.result_state = 'retryable_failure' then
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode = '25001',
        message = 'inbox_v2.outbound_artifact_retry_isolation_unsafe';
    end if;

    -- Both sides of the invariant lock the same durable attempt row before
    -- their cross-table check. The post-lock READ COMMITTED statement then
    -- sees the winner and rejects the loser instead of allowing a write skew.
    perform 1
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = new.tenant_id
       and attempt_row.id = new.unknown_attempt_id
       and attempt_row.dispatch_id = new.dispatch_id
       and attempt_row.route_id = new.route_id
       and attempt_row.message_id = new.message_id
       for update;

    if exists (
      select 1
        from public.inbox_v2_outbound_dispatch_artifacts artifact_row
       where artifact_row.tenant_id = new.tenant_id
         and artifact_row.dispatch_id = new.dispatch_id
         and artifact_row.attempt_id = new.unknown_attempt_id
         and artifact_row.state = 'accepted'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_artifact_retry_unsafe';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_accepted_artifact_retry_guard()
returns trigger
language plpgsql
volatile
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state = 'accepted' then
    if pg_catalog.current_setting('transaction_isolation') <> 'read committed' then
      raise exception using errcode = '25001',
        message = 'inbox_v2.outbound_artifact_retry_isolation_unsafe';
    end if;

    perform 1
      from public.inbox_v2_outbound_dispatch_attempts attempt_row
     where attempt_row.tenant_id = new.tenant_id
       and attempt_row.id = new.attempt_id
       and attempt_row.dispatch_id = new.dispatch_id
       and attempt_row.route_id = new.route_id
       and attempt_row.message_id = new.message_id
       for update;

    if exists (
      select 1
        from public.inbox_v2_outbound_dispatch_reconciliation_decisions
          decision_row
       where decision_row.tenant_id = new.tenant_id
         and decision_row.dispatch_id = new.dispatch_id
         and decision_row.unknown_attempt_id = new.attempt_id
         and decision_row.result_state = 'retryable_failure'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_artifact_retry_unsafe';
    end if;
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_outbound_attempt_mixed_outcome_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.outcome_kind = 'outcome_unknown'
     and new.diagnostic_code_id = 'core:provider-artifact-outcomes-mixed'
     and new.unknown_required_action is distinct from
       'operator_duplicate_risk_decision_required' then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_mixed_artifact_outcome_requires_operator';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_file_dispatch_plan_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  checked_tenant_id text;
  checked_plan_id text;
  plan_row public.inbox_v2_file_outbound_dispatch_plans%rowtype;
  dispatch_valid boolean;
  artifact_total integer;
  block_total integer;
  payload_total integer;
begin
  checked_tenant_id := new.tenant_id;
  checked_plan_id := coalesce(
    to_jsonb(new) ->> 'content_plan_id',
    to_jsonb(new) ->> 'id'
  );

  select * into plan_row
    from public.inbox_v2_file_outbound_dispatch_plans candidate_row
   where candidate_row.tenant_id = checked_tenant_id
     and candidate_row.id = checked_plan_id;
  if not found then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_content_plan_missing';
  end if;

  select exists (
    select 1
      from public.inbox_v2_outbound_dispatches dispatch_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = dispatch_row.tenant_id
       and message_row.id = dispatch_row.message_id
       and message_row.conversation_id = dispatch_row.conversation_id
       and message_row.timeline_item_id = dispatch_row.timeline_item_id
      join public.inbox_v2_outbound_routes route_row
        on route_row.tenant_id = dispatch_row.tenant_id
       and route_row.id = dispatch_row.route_id
       and route_row.conversation_id = dispatch_row.conversation_id
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = message_row.tenant_id
       and content_row.id = message_row.content_id
       and content_row.revision = message_row.content_revision
     where dispatch_row.tenant_id = plan_row.tenant_id
       and dispatch_row.id = plan_row.dispatch_id
       and dispatch_row.message_id = plan_row.message_id
       and dispatch_row.conversation_id = plan_row.conversation_id
       and dispatch_row.timeline_item_id = plan_row.timeline_item_id
       and dispatch_row.route_id = plan_row.route_id
       and message_row.revision = plan_row.message_revision
       and message_row.content_id = plan_row.content_id
       and message_row.content_revision = plan_row.content_revision
       and content_row.state = 'available'
       and route_row.source_thread_binding_id = plan_row.binding_id
       and route_row.binding_revision = plan_row.binding_revision
       and route_row.capability_revision = plan_row.capability_revision
       and route_row.adapter_contract_id = plan_row.adapter_contract_id
       and route_row.adapter_contract_version = plan_row.adapter_contract_version
       and route_row.adapter_declaration_revision =
         plan_row.adapter_contract_declaration_revision
       and route_row.adapter_surface_id = plan_row.adapter_surface_id
       and route_row.adapter_loaded_by_trusted_service_id =
         plan_row.adapter_loaded_by_trusted_service_id
       and route_row.adapter_loaded_at = plan_row.adapter_loaded_at
       and route_row.selected_at <= plan_row.created_at
  ) into dispatch_valid;
  if not dispatch_valid then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_content_plan_invalid';
  end if;

  select count(*) into artifact_total
    from public.inbox_v2_file_outbound_artifact_plans artifact_row
   where artifact_row.tenant_id = plan_row.tenant_id
     and artifact_row.content_plan_id = plan_row.id;
  if artifact_total <> plan_row.artifact_count or not exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
    having min(artifact_row.ordinal) = 1
       and max(artifact_row.ordinal) = count(*)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_artifact_count_invalid';
  end if;

  select count(*) into block_total
    from public.inbox_v2_file_outbound_artifact_blocks block_row
   where block_row.tenant_id = plan_row.tenant_id
     and block_row.content_plan_id = plan_row.id;
  select count(*) into payload_total
    from public.inbox_v2_timeline_content_payloads payload_row
   where payload_row.tenant_id = plan_row.tenant_id
     and payload_row.content_id = plan_row.content_id
     and payload_row.content_revision = plan_row.content_revision;
  if block_total <> plan_row.block_count
     or payload_total <> plan_row.block_count then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_block_count_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
       and (artifact_row.created_at <> plan_row.created_at
         or artifact_row.block_mapping_count <> (
          select count(*)
           from public.inbox_v2_file_outbound_artifact_blocks block_row
          where block_row.tenant_id = artifact_row.tenant_id
            and block_row.content_plan_id = artifact_row.content_plan_id
             and block_row.artifact_plan_id = artifact_row.id
       ))
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.outbound_dispatch_block_mapping_count_invalid';
  end if;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_plans artifact_row
     where artifact_row.tenant_id = plan_row.tenant_id
       and artifact_row.content_plan_id = plan_row.id
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_entries capability_row
          where capability_row.tenant_id = plan_row.tenant_id
            and capability_row.binding_id = plan_row.binding_id
            and capability_row.capability_revision =
              plan_row.capability_revision
            and capability_row.capability_id = artifact_row.capability_id
            and capability_row.operation_id = artifact_row.operation_id
            and capability_row.content_kind_id is not distinct from (
              select route_row.content_kind_id
                from public.inbox_v2_outbound_routes route_row
               where route_row.tenant_id = plan_row.tenant_id
                 and route_row.id = plan_row.route_id
            )
            and capability_row.state = 'supported'
            and (capability_row.valid_until is null
              or capability_row.valid_until > plan_row.created_at)
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_capability_required_roles required_role_row
               where required_role_row.tenant_id = capability_row.tenant_id
                 and required_role_row.binding_id = capability_row.binding_id
                 and required_role_row.materialized_by_binding_revision =
                   capability_row.materialized_by_binding_revision
                 and required_role_row.capability_revision =
                   capability_row.capability_revision
                 and required_role_row.capability_ordinal = capability_row.ordinal
                 and required_role_row.capability_id = capability_row.capability_id
                 and required_role_row.operation_id = capability_row.operation_id
                 and required_role_row.content_kind_key =
                   capability_row.content_kind_key
                 and not exists (
                   select 1
                     from public.inbox_v2_source_thread_binding_snapshots binding_snapshot_row
                     join public.inbox_v2_source_thread_binding_provider_roles provider_role_row
                       on provider_role_row.tenant_id =
                         binding_snapshot_row.tenant_id
                      and provider_role_row.binding_id =
                         binding_snapshot_row.binding_id
                      and provider_role_row.provider_access_revision =
                         binding_snapshot_row.provider_access_revision
                      and provider_role_row.provider_role_id =
                         required_role_row.provider_role_id
                    where binding_snapshot_row.tenant_id = plan_row.tenant_id
                      and binding_snapshot_row.binding_id = plan_row.binding_id
                      and binding_snapshot_row.revision =
                        plan_row.binding_revision
                 )
            )
       )
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_artifact_capability_invalid';
  end if;

  -- Freeze every mutable logical/object head used by an exact planned pin.
  -- The following validation statement runs after these row locks, so a
  -- concurrent quarantine/delete/head move either wins first and is observed
  -- or waits until this plan transaction commits.
  perform 1
    from public.inbox_v2_file_outbound_artifact_blocks block_row
    join public.inbox_v2_file_objects file_row
      on file_row.tenant_id = block_row.tenant_id
     and file_row.id = block_row.file_id
     and file_row.revision = block_row.file_revision
     and file_row.state = 'ready'
     and file_row.current_file_version_id = block_row.file_version_id
     and file_row.current_object_version_id = block_row.object_version_id
    join public.inbox_v2_file_versions version_row
      on version_row.tenant_id = block_row.tenant_id
     and version_row.id = block_row.file_version_id
     and version_row.file_id = block_row.file_id
     and version_row.object_version_id = block_row.object_version_id
    join public.inbox_v2_file_object_version_heads object_head_row
      on object_head_row.tenant_id = block_row.tenant_id
     and object_head_row.object_version_id = block_row.object_version_id
     and object_head_row.state = 'ready'
   where block_row.tenant_id = plan_row.tenant_id
     and block_row.content_plan_id = plan_row.id
     and block_row.file_id is not null
   order by block_row.file_id, block_row.file_version_id,
     block_row.object_version_id
   for share of file_row, object_head_row;

  if exists (
    select 1
      from public.inbox_v2_file_outbound_artifact_blocks block_row
      left join public.inbox_v2_timeline_content_payloads payload_row
        on payload_row.tenant_id = plan_row.tenant_id
       and payload_row.content_id = plan_row.content_id
       and payload_row.content_revision = plan_row.content_revision
       and payload_row.ordinal = block_row.content_block_ordinal
       and payload_row.block_key = block_row.block_key
       and payload_row.kind::text = block_row.block_kind::text
     where block_row.tenant_id = plan_row.tenant_id
       and block_row.content_plan_id = plan_row.id
       and (
         payload_row.tenant_id is null
         or block_row.created_at <> plan_row.created_at
         or (
           block_row.block_kind in ('image', 'audio', 'video', 'file', 'sticker')
           and not (
             payload_row.attachment_state = 'ready'
             and payload_row.attachment_v2_file_id = block_row.file_id
             and payload_row.attachment_file_version_id = block_row.file_version_id
             and payload_row.attachment_object_version_id =
               block_row.object_version_id
           )
         )
         or (
           block_row.block_kind = 'extension'
           and not (
             payload_row.extension_payload_v2_file_id = block_row.file_id
             and payload_row.extension_payload_file_version_id =
               block_row.file_version_id
             and payload_row.extension_payload_object_version_id =
               block_row.object_version_id
           )
         )
         or (
           block_row.block_kind in ('text', 'location', 'contact')
           and num_nonnulls(
             block_row.file_id, block_row.file_revision,
             block_row.file_version_id, block_row.object_version_id
           ) <> 0
         )
         or (
           block_row.file_id is not null
           and not exists (
             select 1
               from public.inbox_v2_file_objects file_row
               join public.inbox_v2_file_versions version_row
                 on version_row.tenant_id = file_row.tenant_id
                and version_row.id = block_row.file_version_id
                and version_row.file_id = file_row.id
                and version_row.object_version_id =
                  block_row.object_version_id
               join public.inbox_v2_file_object_version_heads object_head_row
                 on object_head_row.tenant_id = file_row.tenant_id
                and object_head_row.object_version_id =
                  block_row.object_version_id
                and object_head_row.state = 'ready'
              where file_row.tenant_id = block_row.tenant_id
                and file_row.id = block_row.file_id
                and file_row.revision = block_row.file_revision
                and file_row.state = 'ready'
                and file_row.current_file_version_id = block_row.file_version_id
                and file_row.current_object_version_id =
                  block_row.object_version_id
           )
         )
       )
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.outbound_dispatch_block_mapping_invalid';
  end if;
  return new;
end;
$function$;

drop trigger if exists inbox_v2_file_objects_guard_trigger
  on public.inbox_v2_file_objects;
create trigger inbox_v2_file_objects_guard_trigger
before insert or update or delete on public.inbox_v2_file_objects
for each row execute function public.inbox_v2_file_object_head_guard();

drop trigger if exists inbox_v2_file_object_version_heads_guard_trigger
  on public.inbox_v2_file_object_version_heads;
create trigger inbox_v2_file_object_version_heads_guard_trigger
before insert or update or delete on public.inbox_v2_file_object_version_heads
for each row execute function public.inbox_v2_file_object_version_head_guard();

drop trigger if exists inbox_v2_file_mat_jobs_guard_trigger
  on public.inbox_v2_file_attachment_materialization_jobs;
create trigger inbox_v2_file_mat_jobs_guard_trigger
before insert or update or delete
on public.inbox_v2_file_attachment_materialization_jobs
for each row execute function public.inbox_v2_file_materialization_job_guard();

drop trigger if exists inbox_v2_file_mat_jobs_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_jobs;
create constraint trigger inbox_v2_file_mat_jobs_coherence_trigger
after insert or update on public.inbox_v2_file_attachment_materialization_jobs
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_mat_attempts_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_attempts;
create constraint trigger inbox_v2_file_mat_attempts_coherence_trigger
after insert on public.inbox_v2_file_attachment_materialization_attempts
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_mat_evidence_coherence_trigger
  on public.inbox_v2_file_attachment_materialization_evidence;
create constraint trigger inbox_v2_file_mat_evidence_coherence_trigger
after insert on public.inbox_v2_file_attachment_materialization_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_file_materialization_coherence();

drop trigger if exists inbox_v2_file_storage_orphans_guard_trigger
  on public.inbox_v2_file_storage_orphans;
create trigger inbox_v2_file_storage_orphans_guard_trigger
before update or delete on public.inbox_v2_file_storage_orphans
for each row execute function public.inbox_v2_file_storage_orphan_guard();

drop trigger if exists inbox_v2_file_parent_link_heads_guard_trigger
  on public.inbox_v2_file_parent_link_heads;
create trigger inbox_v2_file_parent_link_heads_guard_trigger
before update or delete on public.inbox_v2_file_parent_link_heads
for each row execute function public.inbox_v2_file_parent_link_head_guard();

drop trigger if exists inbox_v2_file_parent_set_heads_guard_trigger
  on public.inbox_v2_file_parent_set_heads;
create trigger inbox_v2_file_parent_set_heads_guard_trigger
before update or delete on public.inbox_v2_file_parent_set_heads
for each row execute function public.inbox_v2_file_parent_set_head_guard();

drop trigger if exists inbox_v2_file_parent_links_immutable_trigger
  on public.inbox_v2_file_parent_links;
create trigger inbox_v2_file_parent_links_immutable_trigger
before update or delete on public.inbox_v2_file_parent_links
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_parent_links_coherence_trigger
  on public.inbox_v2_file_parent_links;
create constraint trigger inbox_v2_file_parent_links_coherence_trigger
after insert on public.inbox_v2_file_parent_links
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_parent_link_heads_coherence_trigger
  on public.inbox_v2_file_parent_link_heads;
create constraint trigger inbox_v2_file_parent_link_heads_coherence_trigger
after insert or update on public.inbox_v2_file_parent_link_heads
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_parent_heads_coherence_trigger
  on public.inbox_v2_file_parent_set_heads;
create constraint trigger inbox_v2_file_parent_heads_coherence_trigger
after insert or update on public.inbox_v2_file_parent_set_heads
deferrable initially deferred
for each row execute function public.inbox_v2_file_parent_coherence();

drop trigger if exists inbox_v2_file_derivative_edges_cycle_trigger
  on public.inbox_v2_file_derivative_edges;
create trigger inbox_v2_file_derivative_edges_cycle_trigger
before insert on public.inbox_v2_file_derivative_edges
for each row execute function public.inbox_v2_file_derivative_cycle_guard();

drop trigger if exists inbox_v2_outbound_artifact_retry_guard_trigger
  on public.inbox_v2_outbound_dispatch_reconciliation_decisions;
create trigger inbox_v2_outbound_artifact_retry_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_reconciliation_decisions
for each row execute function public.inbox_v2_outbound_artifact_retry_guard();

drop trigger if exists inbox_v2_outbound_accepted_artifact_retry_guard_trigger
  on public.inbox_v2_outbound_dispatch_artifacts;
create trigger inbox_v2_outbound_accepted_artifact_retry_guard_trigger
before insert on public.inbox_v2_outbound_dispatch_artifacts
for each row execute function public.inbox_v2_outbound_accepted_artifact_retry_guard();

drop trigger if exists inbox_v2_outbound_attempt_mixed_outcome_guard_trigger
  on public.inbox_v2_outbound_dispatch_attempts;
create trigger inbox_v2_outbound_attempt_mixed_outcome_guard_trigger
before insert or update on public.inbox_v2_outbound_dispatch_attempts
for each row execute function public.inbox_v2_outbound_attempt_mixed_outcome_guard();

drop trigger if exists inbox_v2_file_dispatch_plans_coherence_trigger
  on public.inbox_v2_file_outbound_dispatch_plans;
create constraint trigger inbox_v2_file_dispatch_plans_coherence_trigger
after insert on public.inbox_v2_file_outbound_dispatch_plans
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_artifact_plans_coherence_trigger
  on public.inbox_v2_file_outbound_artifact_plans;
create constraint trigger inbox_v2_file_artifact_plans_coherence_trigger
after insert on public.inbox_v2_file_outbound_artifact_plans
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_artifact_blocks_coherence_trigger
  on public.inbox_v2_file_outbound_artifact_blocks;
create constraint trigger inbox_v2_file_artifact_blocks_coherence_trigger
after insert on public.inbox_v2_file_outbound_artifact_blocks
deferrable initially deferred
for each row execute function public.inbox_v2_file_dispatch_plan_coherence();

drop trigger if exists inbox_v2_file_object_versions_immutable_trigger
  on public.inbox_v2_file_object_versions;
create trigger inbox_v2_file_object_versions_immutable_trigger
before update or delete on public.inbox_v2_file_object_versions
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_versions_immutable_trigger
  on public.inbox_v2_file_versions;
create trigger inbox_v2_file_versions_immutable_trigger
before update or delete on public.inbox_v2_file_versions
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_mat_attempts_immutable_trigger
  on public.inbox_v2_file_attachment_materialization_attempts;
create trigger inbox_v2_file_mat_attempts_immutable_trigger
before update or delete on public.inbox_v2_file_attachment_materialization_attempts
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_mat_evidence_immutable_trigger
  on public.inbox_v2_file_attachment_materialization_evidence;
create trigger inbox_v2_file_mat_evidence_immutable_trigger
before update or delete on public.inbox_v2_file_attachment_materialization_evidence
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_operation_evidence_immutable_trigger
  on public.inbox_v2_file_object_operation_evidence;
create trigger inbox_v2_file_operation_evidence_immutable_trigger
before update or delete on public.inbox_v2_file_object_operation_evidence
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_derivative_edges_immutable_trigger
  on public.inbox_v2_file_derivative_edges;
create trigger inbox_v2_file_derivative_edges_immutable_trigger
before update or delete on public.inbox_v2_file_derivative_edges
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_dispatch_plans_immutable_trigger
  on public.inbox_v2_file_outbound_dispatch_plans;
create trigger inbox_v2_file_dispatch_plans_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_dispatch_plans
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_artifact_plans_immutable_trigger
  on public.inbox_v2_file_outbound_artifact_plans;
create trigger inbox_v2_file_artifact_plans_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_artifact_plans
for each row execute function public.inbox_v2_file_immutable_guard();

drop trigger if exists inbox_v2_file_artifact_blocks_immutable_trigger
  on public.inbox_v2_file_outbound_artifact_blocks;
create trigger inbox_v2_file_artifact_blocks_immutable_trigger
before update or delete on public.inbox_v2_file_outbound_artifact_blocks
for each row execute function public.inbox_v2_file_immutable_guard();

create or replace function public.inbox_v2_auth_attachment_message_change_valid(
  expected_tenant_id text,
  expected_stream_commit_id text,
  expected_mutation_id text,
  expected_change_id text,
  expected_stream_position bigint,
  expected_committed_at timestamptz,
  expected_trusted_service_id text,
  expected_correlation_id text,
  expected_command_result_reference jsonb,
  expected_audit_evidence_reference jsonb,
  expected_audit_revision_delta_hash text
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_tenant_stream_changes message_change
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = message_change.tenant_id
       and message_row.id = message_change.entity_id
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = message_row.tenant_id
       and timeline_row.id = message_row.timeline_item_id
      join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = message_row.tenant_id
       and content_row.id = message_row.content_id
      join public.inbox_v2_timeline_content_revisions content_revision_row
        on content_revision_row.tenant_id = content_row.tenant_id
       and content_revision_row.content_id = content_row.id
       and content_revision_row.revision = content_row.revision
      join public.inbox_v2_message_revisions revision_row
        on revision_row.tenant_id = message_change.tenant_id
       and revision_row.id =
         message_change.domain_commit_reference->>'recordId'
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = revision_row.tenant_id
       and attribution_row.id = revision_row.action_attribution_id
     where message_change.tenant_id = expected_tenant_id
       and message_change.stream_commit_id = expected_stream_commit_id
       and message_change.mutation_id = expected_mutation_id
       and message_change.id = expected_change_id
       and message_change.stream_position = expected_stream_position
       and message_change.entity_type_id = 'core:message'
       and message_change.resulting_revision >= 2
       and message_change.state_kind = 'upsert'
       and message_change.state_schema_id = 'core:inbox-v2.message'
       and message_change.state_schema_version = 'v1'
       and message_change.payload_reference->>'tenantId' =
         message_change.tenant_id
       and message_change.payload_reference->>'recordId' =
         message_change.entity_id
       and message_change.payload_reference->>'schemaId' =
         'core:inbox-v2.message'
       and message_change.payload_reference->>'schemaVersion' = 'v1'
       and message_change.payload_reference =
         expected_command_result_reference
       and message_change.state_hash =
         message_change.payload_reference->>'digest'
       and message_change.domain_commit_reference->>'tenantId' =
         message_change.tenant_id
       and message_change.domain_commit_reference->>'schemaId' =
         'core:inbox-v2.message-revision'
       and message_change.domain_commit_reference->>'schemaVersion' = 'v1'
       and message_change.domain_commit_reference =
         expected_audit_evidence_reference
       and expected_audit_revision_delta_hash <>
         'sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
       and message_change.audience in (
         'conversation_external', 'internal_participants'
       )
       and message_row.revision = message_change.resulting_revision
       and message_row.last_changed_stream_position = expected_stream_position
       and message_row.created_at <= expected_committed_at
       and message_row.updated_at = expected_committed_at
       and timeline_row.subject_kind = 'message'
       and timeline_row.subject_id = message_row.id
       and timeline_row.conversation_id = message_row.conversation_id
       and timeline_row.revision = message_row.revision
       and timeline_row.visibility::text = message_change.audience::text
       and timeline_row.last_changed_stream_position = expected_stream_position
       and timeline_row.created_at <= expected_committed_at
       and timeline_row.updated_at = expected_committed_at
       and content_row.owner_kind = 'message'
       and content_row.owner_id = message_row.id
       and content_row.revision = message_row.content_revision
       and content_row.state = message_row.content_state
       and content_row.state = 'available'
       and content_row.last_changed_stream_position = expected_stream_position
       and content_row.created_at <= expected_committed_at
       and content_row.updated_at = expected_committed_at
       and content_revision_row.expected_previous_revision =
         content_revision_row.revision - 1
       and content_revision_row.transition_kind = 'attachment_materialization'
       and content_revision_row.state = 'available'
       and content_revision_row.event_id is not null
       and content_revision_row.recorded_stream_position =
         expected_stream_position
       and content_revision_row.occurred_at = expected_committed_at
       and content_revision_row.recorded_at = expected_committed_at
       and message_change.timeline = jsonb_build_object(
         'conversation', jsonb_build_object(
           'tenantId', message_row.tenant_id,
           'id', message_row.conversation_id,
           'kind', 'conversation'
         ),
         'timelineSequence', timeline_row.timeline_sequence::text
       )
       and revision_row.message_id = message_row.id
       and revision_row.timeline_item_id = message_row.timeline_item_id
       and revision_row.message_revision = message_row.revision
       and revision_row.change_kind = 'attachment_materialized'
       and revision_row.expected_previous_revision =
         revision_row.message_revision - 1
       and revision_row.before_content_id = content_row.id
       and revision_row.before_content_revision = content_row.revision - 1
       and revision_row.before_content_state = 'available'
       and revision_row.after_content_id = content_row.id
       and revision_row.after_content_revision = content_row.revision
       and revision_row.after_content_state = 'available'
       and revision_row.provider_operation_id is null
       and revision_row.reason_id is null
       and revision_row.recorded_stream_position = expected_stream_position
       and revision_row.occurred_at = expected_committed_at
       and revision_row.recorded_at = expected_committed_at
       and attribution_row.conversation_id = message_row.conversation_id
       and attribution_row.action_participant_id is null
       and attribution_row.app_actor_kind = 'trusted_service'
       and attribution_row.app_trusted_service_id =
         expected_trusted_service_id
       and attribution_row.source_occurrence_id is null
       and attribution_row.automation_kind = 'system_event'
       and attribution_row.automation_cause_event_id is not null
       and attribution_row.automation_correlation_id = expected_correlation_id
       and attribution_row.automation_caused_at <= expected_committed_at
       and attribution_row.created_at = expected_committed_at
       and (
         select count(*)
           from public.inbox_v2_domain_events message_event
          where message_event.tenant_id = message_change.tenant_id
            and message_event.stream_commit_id =
              message_change.stream_commit_id
            and message_event.mutation_id = message_change.mutation_id
            and message_event.type_id = 'core:message.changed'
            and message_event.payload_schema_id =
              'core:inbox-v2.message-revision'
            and message_event.payload_schema_version = 'v1'
            and message_event.payload_reference =
              message_change.domain_commit_reference
            and content_revision_row.event_id = message_event.id
            and message_event.change_ids =
              jsonb_build_array(message_change.id)
            and message_event.subjects @> jsonb_build_array(
              jsonb_build_object(
                'tenantId', message_change.tenant_id,
                'entityTypeId', 'core:message',
                'entityId', message_change.entity_id
              )
            )
            and message_event.correlation_id = expected_correlation_id
            and message_event.occurred_at = expected_committed_at
            and message_event.recorded_at = expected_committed_at
       ) = 1
       and (
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
            and projection_intent.change_ids =
              jsonb_build_array(message_change.id)
            and projection_event.stream_commit_id =
              message_change.stream_commit_id
            and projection_event.mutation_id = message_change.mutation_id
            and projection_event.type_id = 'core:message.changed'
       ) = 1
       and (
         select count(*)
           from public.inbox_v2_file_attachment_materialization_evidence
             evidence_row
           join public.inbox_v2_file_attachment_materialization_jobs job_row
             on job_row.tenant_id = evidence_row.tenant_id
            and job_row.id = evidence_row.job_id
          where evidence_row.tenant_id = message_change.tenant_id
            and evidence_row.timeline_content_id = content_row.id
            and evidence_row.resulting_content_revision = content_row.revision
            and evidence_row.expected_content_revision =
              content_row.revision - 1
            and evidence_row.outcome in ('ready', 'failed')
            and job_row.parent_message_id = message_row.id
            and job_row.timeline_item_id = timeline_row.id
            and job_row.timeline_content_id = content_row.id
            and job_row.result_content_revision = content_row.revision
            and job_row.cause_event_id =
              attribution_row.automation_cause_event_id
            and job_row.correlation_id = expected_correlation_id
            and job_row.caused_at = attribution_row.automation_caused_at
            and job_row.authorization_actor_kind = 'trusted_service'
            and job_row.authorization_actor_id =
              expected_trusted_service_id
            and job_row.updated_at = evidence_row.completed_at
            and (
              (evidence_row.outcome = 'ready' and job_row.state = 'ready')
              or (evidence_row.outcome = 'failed' and job_row.state = 'failed')
            )
       ) = 1
       and not exists (
         select 1
           from public.inbox_v2_atomic_source_resolution_materializations
             source_materialization
          where source_materialization.tenant_id = message_change.tenant_id
            and source_materialization.stream_commit_id =
              message_change.stream_commit_id
            and source_materialization.mutation_id = message_change.mutation_id
       )
  );
$function$;

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
     and v_command.command_type_id <>
       'core:attachment.materialization.complete'
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
       or (
         v_command.command_type_id <> 'core:source.dispatch.reroute'
         and v_audit.evidence_reference is distinct from
            message_change.domain_commit_reference
       )
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
    from public.inbox_v2_tenant_stream_changes message_change
   where message_change.tenant_id = new.tenant_id
     and message_change.stream_commit_id = new.stream_commit_id
     and message_change.mutation_id = new.mutation_id
     and message_change.entity_type_id = 'core:message'
     and v_command.command_type_id =
       'core:attachment.materialization.complete'
     and not public.inbox_v2_auth_attachment_message_change_valid(
       message_change.tenant_id,
       message_change.stream_commit_id,
       message_change.mutation_id,
       message_change.id,
       message_change.stream_position,
       new.committed_at,
       v_command.actor_trusted_service_id,
       v_stream.correlation_id,
       v_command.result_reference,
       v_audit.evidence_reference,
       v_audit.revision_delta_hash
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

  if v_command.command_type_id in (
    'core:message.send',
    'core:message.receive',
    'core:source.dispatch.reroute'
  )
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
         v_command.command_type_id in (
           'core:message.send',
           'core:source.dispatch.reroute'
         )
         and (
           v_source_change_count <> 0
           or v_source_materialization_count <> 0
         )
       ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.domain_mutation_message_cardinality_invalid';
    end if;
  end if;

  if v_command.command_type_id =
     'core:attachment.materialization.complete' then
    select count(*)::integer into v_message_change_count
      from public.inbox_v2_tenant_stream_changes message_change
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message';
    select count(*)::integer into v_message_row_count
      from public.inbox_v2_tenant_stream_changes message_change
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = message_change.tenant_id
       and message_row.id = message_change.entity_id
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message'
       and message_row.revision = message_change.resulting_revision
       and message_row.revision >= 2
       and message_row.last_changed_stream_position = v_stream.position
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
       or v_source_change_count <> 0
       or v_source_materialization_count <> 0
       or v_change_count <> 1
       or v_event_count <> 1
       or v_outbox_count <> 1
       or v_projection_count <> 1 then
      raise exception using errcode = '23514',
        message =
          'inbox_v2.domain_mutation_attachment_cardinality_invalid';
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
     or (
       v_command.command_type_id <>
         'core:attachment.materialization.complete'
       and v_audit.revision_delta_hash <> v_empty_digest
     ) then
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

create or replace function public.inbox_v2_msg003_action_attribution_cause_event_coherence()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.automation_cause_event_id is null then
    return null;
  end if;

  perform 1
    from public.inbox_v2_domain_events event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.id = new.automation_cause_event_id
   for key share;
  if found then
    return null;
  end if;

  perform 1
    from public.event_store event_row
   where event_row.tenant_id = new.tenant_id
     and event_row.id = new.automation_cause_event_id
   for key share;
  if found then
    return null;
  end if;

  raise exception using errcode = '23503',
    message = 'inbox_v2.action_attribution_cause_event_missing';
end;
$function$;

create constraint trigger inbox_v2_msg003_action_attribution_cause_event_coherence
after insert or update on public.inbox_v2_action_attributions
deferrable initially deferred for each row
execute function public.inbox_v2_msg003_action_attribution_cause_event_coherence();

create or replace function public.inbox_v2_msg003_legacy_cause_event_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and pg_catalog.pg_trigger_depth() > 1
     and not exists (
       select 1 from public.tenants tenant_row
        where tenant_row.id = old.tenant_id
     ) then
    return old;
  end if;

  if exists (
    select 1
      from public.inbox_v2_action_attributions attribution_row
     where attribution_row.tenant_id = old.tenant_id
       and attribution_row.automation_cause_event_id = old.id
  ) then
    raise exception using errcode = '23503',
      message = 'inbox_v2.action_attribution_legacy_cause_event_referenced';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$function$;

create trigger inbox_v2_msg003_legacy_cause_event_guard
before update or delete on public.event_store
for each row execute function public.inbox_v2_msg003_legacy_cause_event_guard();

alter table public.inbox_v2_message_attachment_anchors
  add constraint inbox_v2_message_attachment_anchors_owner_message_fk
  foreign key (tenant_id, owner_message_id)
  references public.inbox_v2_messages (tenant_id, id)
  deferrable initially deferred not valid;
alter table public.inbox_v2_message_attachment_anchors
  add constraint inbox_v2_message_attachment_anchors_owner_timeline_fk
  foreign key (tenant_id, owner_timeline_item_id)
  references public.inbox_v2_timeline_items (tenant_id, id)
  deferrable initially deferred not valid;
alter table public.inbox_v2_message_attachment_anchors
  add constraint inbox_v2_message_attachment_anchors_owner_content_fk
  foreign key (tenant_id, owner_timeline_content_id)
  references public.inbox_v2_timeline_contents (tenant_id, id)
  deferrable initially deferred not valid;

create or replace function public.inbox_v2_msg003_attachment_anchor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if num_nonnulls(
      new.owner_message_id, new.owner_timeline_item_id,
      new.owner_timeline_content_id, new.owner_block_key,
      new.materialization_state
    ) <> 5 or new.revision <> 1 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_attachment_anchor_owner_required';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- Only the nested RI delete caused by removing the owning tenant may
    -- bypass immutability. An unrelated application trigger can also raise
    -- trigger depth and therefore must not be sufficient on its own.
    if pg_catalog.pg_trigger_depth() > 1
       and not exists (
         select 1 from public.tenants tenant_row
          where tenant_row.id = old.tenant_id
       ) then
      return old;
    end if;
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_immutable';
  end if;

  if new.tenant_id is distinct from old.tenant_id
     or new.id is distinct from old.id
     or new.owner_message_id is distinct from old.owner_message_id
     or new.owner_timeline_item_id is distinct from old.owner_timeline_item_id
     or new.owner_timeline_content_id is distinct from
       old.owner_timeline_content_id
     or new.owner_block_key is distinct from old.owner_block_key
     or new.created_at is distinct from old.created_at
     or old.materialization_state <> 'pending'
     or new.materialization_state not in ('ready', 'failed', 'quarantined')
     or new.revision <> old.revision + 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_transition_invalid';
  end if;
  return new;
end;
$function$;

create or replace function public.inbox_v2_msg003_attachment_anchor_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  content_key text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';
  content_key := case
    when tg_table_name = 'inbox_v2_message_attachment_anchors'
      then changed_row->>'owner_timeline_content_id'
    else coalesce(changed_row->>'id', changed_row->>'content_id')
  end;

  if content_key is null
     or not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if exists (
    select 1
      from public.inbox_v2_message_attachment_anchors anchor_row
      left join public.inbox_v2_timeline_contents content_row
        on content_row.tenant_id = anchor_row.tenant_id
       and content_row.id = anchor_row.owner_timeline_content_id
      left join public.inbox_v2_messages message_row
        on message_row.tenant_id = anchor_row.tenant_id
       and message_row.id = anchor_row.owner_message_id
     where anchor_row.tenant_id = tenant_key
       and anchor_row.owner_timeline_content_id = content_key
       and (
         content_row.id is null
         or content_row.owner_kind <> 'message'
         or content_row.owner_id <> anchor_row.owner_message_id
         or message_row.id is null
         or message_row.timeline_item_id <>
           anchor_row.owner_timeline_item_id
         or message_row.content_id <>
           anchor_row.owner_timeline_content_id
         or (content_row.state = 'available' and not exists (
           select 1
             from public.inbox_v2_timeline_content_payloads payload_row
            where payload_row.tenant_id = anchor_row.tenant_id
              and payload_row.content_id =
                anchor_row.owner_timeline_content_id
              and payload_row.content_revision = content_row.revision
              and payload_row.block_key = anchor_row.owner_block_key
              and payload_row.attachment_id = anchor_row.id
              and payload_row.attachment_state =
                anchor_row.materialization_state
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_anchor_owner_mismatch';
  end if;

  if exists (
    select 1
      from public.inbox_v2_timeline_contents content_row
      join public.inbox_v2_timeline_content_payloads payload_row
        on payload_row.tenant_id = content_row.tenant_id
       and payload_row.content_id = content_row.id
       and payload_row.content_revision = content_row.revision
      left join public.inbox_v2_messages message_row
        on message_row.tenant_id = content_row.tenant_id
       and message_row.id = content_row.owner_id
       and message_row.content_id = content_row.id
      left join public.inbox_v2_message_attachment_anchors anchor_row
        on anchor_row.tenant_id = payload_row.tenant_id
       and anchor_row.id = payload_row.attachment_id
       and anchor_row.owner_message_id = message_row.id
       and anchor_row.owner_timeline_item_id = message_row.timeline_item_id
       and anchor_row.owner_timeline_content_id = payload_row.content_id
       and anchor_row.owner_block_key = payload_row.block_key
       and anchor_row.materialization_state = payload_row.attachment_state
     where content_row.tenant_id = tenant_key
       and content_row.id = content_key
       and content_row.state = 'available'
       and payload_row.attachment_id is not null
       and (content_row.owner_kind <> 'message' or anchor_row.id is null)
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_attachment_payload_anchor_mismatch';
  end if;
  return null;
end;
$function$;

create trigger inbox_v2_msg003_attachment_anchor_guard_trigger
before insert or update or delete
on public.inbox_v2_message_attachment_anchors
for each row execute function public.inbox_v2_msg003_attachment_anchor_guard();

create constraint trigger inbox_v2_msg003_attachment_anchor_coherence
after insert or update or delete
on public.inbox_v2_message_attachment_anchors
deferrable initially deferred for each row
execute function public.inbox_v2_msg003_attachment_anchor_coherence();
create constraint trigger inbox_v2_msg003_attachment_payload_coherence
after insert or update or delete on public.inbox_v2_timeline_content_payloads
deferrable initially deferred for each row
execute function public.inbox_v2_msg003_attachment_anchor_coherence();
create constraint trigger inbox_v2_msg003_attachment_content_coherence
after insert or update or delete on public.inbox_v2_timeline_contents
deferrable initially deferred for each row
execute function public.inbox_v2_msg003_attachment_anchor_coherence();
