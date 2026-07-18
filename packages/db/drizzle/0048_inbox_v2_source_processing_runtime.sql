CREATE TYPE "public"."inbox_v2_source_account_pressure_state" AS ENUM('open', 'rate_limited', 'paused');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_cursor_durable_target_kind" AS ENUM('raw_work', 'quarantine');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_cursor_kind" AS ENUM('receive_cursor', 'history_cursor', 'provider_watermark');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_cursor_owner" AS ENUM('source_connection', 'source_account', 'source_thread_binding');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_dead_letter_reason" AS ENUM('terminal_failure', 'attempts_exhausted');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_dedupe_lifecycle_state" AS ENUM('active', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_dedupe_phase" AS ENUM('raw', 'normalized');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_delivery_outcome" AS ENUM('processed', 'ignored', 'duplicate', 'dead_lettered');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_attempt_origin" AS ENUM('initial', 'retry', 'replay');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_attempt_outcome" AS ENUM('retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_key_state" AS ENUM('active', 'verify_only', 'retired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_retryability" AS ENUM('retryable', 'not_retryable');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_stage" AS ENUM('raw_ingest', 'normalization', 'identity_resolution', 'conversation_resolution', 'routing', 'message_reconciliation', 'materialization');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_processing_work_state" AS ENUM('pending', 'leased', 'retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_replay_actor_kind" AS ENUM('employee', 'trusted_service');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_replay_mode" AS ENUM('raw_event', 'normalized_event', 'dead_letter');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_replay_rejection_reason" AS ENUM('target_not_replayable', 'replay_expired', 'evidence_unavailable', 'scope_mismatch', 'revision_conflict', 'key_unavailable', 'idempotency_conflict');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_replay_state" AS ENUM('pending', 'leased', 'applied', 'denied', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_replayability_state" AS ENUM('replayable', 'not_replayable', 'expired');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_raw_admission_state" AS ENUM('skeleton_pending', 'skeleton_handed_off');
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_account_pressure_heads" (
	"tenant_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"state" "inbox_v2_source_account_pressure_state" NOT NULL,
	"max_in_flight" integer NOT NULL,
	"in_flight" integer NOT NULL,
	"max_queued" integer NOT NULL,
	"queued" integer NOT NULL,
	"consecutive_failure_count" bigint NOT NULL,
	"backoff_until" timestamp (3) with time zone,
	"rate_limit_reset_at" timestamp (3) with time zone,
	"last_diagnostic_code_id" text,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_pressure_head_pk" PRIMARY KEY("tenant_id","source_connection_id","source_account_scope_key"),
	CONSTRAINT "inbox_v2_src_pressure_scope_check" CHECK ("inbox_v2_source_account_pressure_heads"."source_account_scope_key" = case
    when "inbox_v2_source_account_pressure_heads"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_account_pressure_heads"."source_account_id")::text || ':' || "inbox_v2_source_account_pressure_heads"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_src_pressure_values_check" CHECK ("inbox_v2_source_account_pressure_heads"."max_in_flight" between 1 and 10000
        and "inbox_v2_source_account_pressure_heads"."in_flight" between 0 and "inbox_v2_source_account_pressure_heads"."max_in_flight"
        and "inbox_v2_source_account_pressure_heads"."max_queued" between 1 and 10000000
        and "inbox_v2_source_account_pressure_heads"."queued" between 0 and "inbox_v2_source_account_pressure_heads"."max_queued"
        and "inbox_v2_source_account_pressure_heads"."consecutive_failure_count" >= 0
        and "inbox_v2_source_account_pressure_heads"."revision" >= 1
        and ("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id" is null
          or char_length("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and isfinite("inbox_v2_source_account_pressure_heads"."created_at")
        and isfinite("inbox_v2_source_account_pressure_heads"."updated_at")
        and "inbox_v2_source_account_pressure_heads"."created_at" <= "inbox_v2_source_account_pressure_heads"."updated_at"),
	CONSTRAINT "inbox_v2_src_pressure_state_check" CHECK ((
          "inbox_v2_source_account_pressure_heads"."state" = 'open'
          and "inbox_v2_source_account_pressure_heads"."backoff_until" is null
          and "inbox_v2_source_account_pressure_heads"."rate_limit_reset_at" is null
        ) or (
          "inbox_v2_source_account_pressure_heads"."state" = 'rate_limited'
          and "inbox_v2_source_account_pressure_heads"."backoff_until" is null
          and "inbox_v2_source_account_pressure_heads"."rate_limit_reset_at" is not null
          and isfinite("inbox_v2_source_account_pressure_heads"."rate_limit_reset_at")
          and "inbox_v2_source_account_pressure_heads"."rate_limit_reset_at" > "inbox_v2_source_account_pressure_heads"."updated_at"
          and "inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id" is not null
        ) or (
          "inbox_v2_source_account_pressure_heads"."state" = 'paused'
          and "inbox_v2_source_account_pressure_heads"."backoff_until" is not null
          and isfinite("inbox_v2_source_account_pressure_heads"."backoff_until")
          and "inbox_v2_source_account_pressure_heads"."backoff_until" > "inbox_v2_source_account_pressure_heads"."updated_at"
          and "inbox_v2_source_account_pressure_heads"."rate_limit_reset_at" is null
          and "inbox_v2_source_account_pressure_heads"."last_diagnostic_code_id" is not null
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_delivery_dedupe_skeletons" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"route_generation" bigint NOT NULL,
	"phase" "inbox_v2_source_dedupe_phase" NOT NULL,
	"raw_event_id" text NOT NULL,
	"normalized_event_id" text,
	"purpose_id" text NOT NULL,
	"key_generation" text NOT NULL,
	"key_verify_until" timestamp (3) with time zone NOT NULL,
	"identity_hmac_sha256" text NOT NULL,
	"outcome_hmac_sha256" text NOT NULL,
	"outcome" "inbox_v2_source_delivery_outcome" NOT NULL,
	"diagnostic_code_id" text,
	"evidence_captured_at" timestamp (3) with time zone NOT NULL,
	"raw_payload_expires_at" timestamp (3) with time zone NOT NULL,
	"allowed_raw_headers_expires_at" timestamp (3) with time zone NOT NULL,
	"normalized_payload_expires_at" timestamp (3) with time zone,
	"terminal_at" timestamp (3) with time zone NOT NULL,
	"guarantee_until" timestamp (3) with time zone NOT NULL,
	"replayability_state" "inbox_v2_source_replayability_state" NOT NULL,
	"replay_until" timestamp (3) with time zone,
	"replayability_reason_code_id" text,
	"skeleton_expires_at" timestamp (3) with time zone NOT NULL,
	"lifecycle_state" "inbox_v2_source_dedupe_lifecycle_state" NOT NULL,
	"expired_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_dedupe_skeleton_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_src_dedupe_hmac_unique" UNIQUE("tenant_id","purpose_id","key_generation","identity_hmac_sha256"),
	CONSTRAINT "inbox_v2_src_dedupe_scope_check" CHECK ("inbox_v2_source_delivery_dedupe_skeletons"."source_account_scope_key" = case
    when "inbox_v2_source_delivery_dedupe_skeletons"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_delivery_dedupe_skeletons"."source_account_id")::text || ':' || "inbox_v2_source_delivery_dedupe_skeletons"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_src_dedupe_identity_check" CHECK (char_length("inbox_v2_source_delivery_dedupe_skeletons"."id") between 8 and 256
    and "inbox_v2_source_delivery_dedupe_skeletons"."id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_delivery_dedupe_skeletons"."route_generation" >= 1
        and "inbox_v2_source_delivery_dedupe_skeletons"."purpose_id" = 'core:source_replay_and_diagnostics'
        and char_length("inbox_v2_source_delivery_dedupe_skeletons"."key_generation") between 1 and 128
    and "inbox_v2_source_delivery_dedupe_skeletons"."key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."key_verify_until")
        and "inbox_v2_source_delivery_dedupe_skeletons"."identity_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_delivery_dedupe_skeletons"."outcome_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_delivery_dedupe_skeletons"."revision" >= 1
        and (
          ("inbox_v2_source_delivery_dedupe_skeletons"."phase" = 'raw' and "inbox_v2_source_delivery_dedupe_skeletons"."normalized_event_id" is null)
          or ("inbox_v2_source_delivery_dedupe_skeletons"."phase" = 'normalized'
            and "inbox_v2_source_delivery_dedupe_skeletons"."normalized_event_id" is not null)
        )),
	CONSTRAINT "inbox_v2_src_dedupe_outcome_check" CHECK ((
          "inbox_v2_source_delivery_dedupe_skeletons"."outcome" in ('processed', 'duplicate')
          and "inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id" is null
        ) or (
          "inbox_v2_source_delivery_dedupe_skeletons"."outcome" in ('ignored', 'dead_lettered')
          and "inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id" is not null
          and char_length("inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_delivery_dedupe_skeletons"."diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        )),
	CONSTRAINT "inbox_v2_src_dedupe_window_check" CHECK (isfinite("inbox_v2_source_delivery_dedupe_skeletons"."evidence_captured_at")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."raw_payload_expires_at")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."allowed_raw_headers_expires_at")
        and "inbox_v2_source_delivery_dedupe_skeletons"."evidence_captured_at" < "inbox_v2_source_delivery_dedupe_skeletons"."raw_payload_expires_at"
        and "inbox_v2_source_delivery_dedupe_skeletons"."evidence_captured_at" < "inbox_v2_source_delivery_dedupe_skeletons"."allowed_raw_headers_expires_at"
        and (
          ("inbox_v2_source_delivery_dedupe_skeletons"."phase" = 'raw'
            and "inbox_v2_source_delivery_dedupe_skeletons"."normalized_payload_expires_at" is null)
          or ("inbox_v2_source_delivery_dedupe_skeletons"."phase" = 'normalized'
            and "inbox_v2_source_delivery_dedupe_skeletons"."normalized_payload_expires_at" is not null
            and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."normalized_payload_expires_at")
            and "inbox_v2_source_delivery_dedupe_skeletons"."evidence_captured_at" <
                "inbox_v2_source_delivery_dedupe_skeletons"."normalized_payload_expires_at")
        )
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."terminal_at")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."guarantee_until")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."skeleton_expires_at")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."created_at")
        and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."updated_at")
        and "inbox_v2_source_delivery_dedupe_skeletons"."created_at" = "inbox_v2_source_delivery_dedupe_skeletons"."terminal_at"
        and "inbox_v2_source_delivery_dedupe_skeletons"."created_at" <= "inbox_v2_source_delivery_dedupe_skeletons"."updated_at"
        and "inbox_v2_source_delivery_dedupe_skeletons"."evidence_captured_at" <= "inbox_v2_source_delivery_dedupe_skeletons"."terminal_at"
        and "inbox_v2_source_delivery_dedupe_skeletons"."terminal_at" < "inbox_v2_source_delivery_dedupe_skeletons"."guarantee_until"
        and "inbox_v2_source_delivery_dedupe_skeletons"."guarantee_until" <= "inbox_v2_source_delivery_dedupe_skeletons"."skeleton_expires_at"
        and "inbox_v2_source_delivery_dedupe_skeletons"."guarantee_until" <= "inbox_v2_source_delivery_dedupe_skeletons"."key_verify_until"
        and (
          ("inbox_v2_source_delivery_dedupe_skeletons"."replayability_state" = 'replayable'
            and "inbox_v2_source_delivery_dedupe_skeletons"."replay_until" is not null
            and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."replay_until")
            and "inbox_v2_source_delivery_dedupe_skeletons"."replay_until" > "inbox_v2_source_delivery_dedupe_skeletons"."terminal_at"
            and "inbox_v2_source_delivery_dedupe_skeletons"."replay_until" <= "inbox_v2_source_delivery_dedupe_skeletons"."guarantee_until"
            and "inbox_v2_source_delivery_dedupe_skeletons"."replay_until" <= case
              when "inbox_v2_source_delivery_dedupe_skeletons"."phase" = 'raw' then "inbox_v2_source_delivery_dedupe_skeletons"."raw_payload_expires_at"
              else "inbox_v2_source_delivery_dedupe_skeletons"."normalized_payload_expires_at"
            end
            and "inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id" is null)
          or ("inbox_v2_source_delivery_dedupe_skeletons"."replayability_state" in ('not_replayable', 'expired')
            and "inbox_v2_source_delivery_dedupe_skeletons"."replay_until" is null
            and "inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id" is not null
            and char_length("inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id") <= 256 and (
    (
      "inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_delivery_dedupe_skeletons"."replayability_reason_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        )
        and (
          ("inbox_v2_source_delivery_dedupe_skeletons"."lifecycle_state" = 'active' and "inbox_v2_source_delivery_dedupe_skeletons"."expired_at" is null)
          or ("inbox_v2_source_delivery_dedupe_skeletons"."lifecycle_state" = 'expired'
            and "inbox_v2_source_delivery_dedupe_skeletons"."expired_at" is not null
            and isfinite("inbox_v2_source_delivery_dedupe_skeletons"."expired_at")
            and "inbox_v2_source_delivery_dedupe_skeletons"."expired_at" >= "inbox_v2_source_delivery_dedupe_skeletons"."skeleton_expires_at")
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_ingress_cursor_checkpoints" (
	"tenant_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"cursor_owner" "inbox_v2_source_cursor_owner" NOT NULL,
	"source_thread_binding_id" text,
	"cursor_kind" "inbox_v2_source_cursor_kind" NOT NULL,
	"cursor_slot_id" text NOT NULL,
	"route_generation" bigint NOT NULL,
	"purpose_id" text NOT NULL,
	"key_generation" text NOT NULL,
	"cursor_value_secret_ref" text NOT NULL,
	"cursor_hmac_sha256" text NOT NULL,
	"durable_target_kind" "inbox_v2_source_cursor_durable_target_kind" NOT NULL,
	"last_durable_raw_event_id" text,
	"durable_work_id" text,
	"durable_work_revision" bigint,
	"durable_work_state" "inbox_v2_source_processing_work_state",
	"quarantine_id" text,
	"quarantine_fingerprint_sha256" text,
	"revision" bigint NOT NULL,
	"persisted_at" timestamp (3) with time zone NOT NULL,
	"acknowledged_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_cursor_checkpoint_pk" PRIMARY KEY("tenant_id","source_connection_id","source_account_scope_key","cursor_slot_id"),
	CONSTRAINT "inbox_v2_src_cursor_hmac_unique" UNIQUE("tenant_id","purpose_id","key_generation","cursor_hmac_sha256"),
	CONSTRAINT "inbox_v2_src_cursor_scope_check" CHECK ("inbox_v2_source_ingress_cursor_checkpoints"."source_account_scope_key" = case
    when "inbox_v2_source_ingress_cursor_checkpoints"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_ingress_cursor_checkpoints"."source_account_id")::text || ':' || "inbox_v2_source_ingress_cursor_checkpoints"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_src_cursor_owner_check" CHECK ((
          "inbox_v2_source_ingress_cursor_checkpoints"."cursor_owner" = 'source_connection'
          and "inbox_v2_source_ingress_cursor_checkpoints"."source_thread_binding_id" is null
        ) or (
          "inbox_v2_source_ingress_cursor_checkpoints"."cursor_owner" = 'source_account'
          and "inbox_v2_source_ingress_cursor_checkpoints"."source_account_id" is not null
          and "inbox_v2_source_ingress_cursor_checkpoints"."source_thread_binding_id" is null
        ) or (
          "inbox_v2_source_ingress_cursor_checkpoints"."cursor_owner" = 'source_thread_binding'
          and "inbox_v2_source_ingress_cursor_checkpoints"."source_account_id" is not null
          and "inbox_v2_source_ingress_cursor_checkpoints"."source_thread_binding_id" is not null
        )),
	CONSTRAINT "inbox_v2_src_cursor_identity_check" CHECK (char_length("inbox_v2_source_ingress_cursor_checkpoints"."cursor_slot_id") between 1 and 128
    and "inbox_v2_source_ingress_cursor_checkpoints"."cursor_slot_id" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and "inbox_v2_source_ingress_cursor_checkpoints"."route_generation" >= 1
        and "inbox_v2_source_ingress_cursor_checkpoints"."purpose_id" = 'core:source_ingress_cursor'
        and char_length("inbox_v2_source_ingress_cursor_checkpoints"."key_generation") between 1 and 128
    and "inbox_v2_source_ingress_cursor_checkpoints"."key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and char_length("inbox_v2_source_ingress_cursor_checkpoints"."cursor_value_secret_ref") between 8 and 512
    and "inbox_v2_source_ingress_cursor_checkpoints"."cursor_value_secret_ref" ~ '^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_ingress_cursor_checkpoints"."cursor_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and (
          ("inbox_v2_source_ingress_cursor_checkpoints"."durable_target_kind" = 'raw_work'
            and char_length("inbox_v2_source_ingress_cursor_checkpoints"."durable_work_id") between 8 and 256
    and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
            and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_revision" >= 1
            and "inbox_v2_source_ingress_cursor_checkpoints"."last_durable_raw_event_id" is not null
            and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_state" is not null
            and "inbox_v2_source_ingress_cursor_checkpoints"."quarantine_id" is null
            and "inbox_v2_source_ingress_cursor_checkpoints"."quarantine_fingerprint_sha256" is null)
          or
          ("inbox_v2_source_ingress_cursor_checkpoints"."durable_target_kind" = 'quarantine'
            and "inbox_v2_source_ingress_cursor_checkpoints"."last_durable_raw_event_id" is null
            and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_id" is null
            and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_revision" is null
            and "inbox_v2_source_ingress_cursor_checkpoints"."durable_work_state" is null
            and char_length("inbox_v2_source_ingress_cursor_checkpoints"."quarantine_id") between 8 and 256
    and "inbox_v2_source_ingress_cursor_checkpoints"."quarantine_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
            and "inbox_v2_source_ingress_cursor_checkpoints"."quarantine_fingerprint_sha256" ~ '^sha256:[0-9a-f]{64}$')
        )
        and "inbox_v2_source_ingress_cursor_checkpoints"."revision" >= 1),
	CONSTRAINT "inbox_v2_src_cursor_times_check" CHECK (isfinite("inbox_v2_source_ingress_cursor_checkpoints"."persisted_at")
        and isfinite("inbox_v2_source_ingress_cursor_checkpoints"."acknowledged_at")
        and isfinite("inbox_v2_source_ingress_cursor_checkpoints"."created_at")
        and isfinite("inbox_v2_source_ingress_cursor_checkpoints"."updated_at")
        and "inbox_v2_source_ingress_cursor_checkpoints"."created_at" <= "inbox_v2_source_ingress_cursor_checkpoints"."persisted_at"
        and "inbox_v2_source_ingress_cursor_checkpoints"."persisted_at" <= "inbox_v2_source_ingress_cursor_checkpoints"."acknowledged_at"
        and "inbox_v2_source_ingress_cursor_checkpoints"."acknowledged_at" <= "inbox_v2_source_ingress_cursor_checkpoints"."updated_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_processing_attempts" (
	"tenant_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"work_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"stage" "inbox_v2_source_processing_stage" NOT NULL,
	"origin" "inbox_v2_source_processing_attempt_origin" NOT NULL,
	"replay_request_id" text,
	"processing_generation" bigint NOT NULL,
	"attempt_number" bigint NOT NULL,
	"max_attempts" integer NOT NULL,
	"work_revision" bigint NOT NULL,
	"outcome" "inbox_v2_source_processing_attempt_outcome" NOT NULL,
	"worker_id" text NOT NULL,
	"lease_token_hash" text NOT NULL,
	"lease_revision" bigint NOT NULL,
	"lease_claimed_at" timestamp (3) with time zone NOT NULL,
	"started_at" timestamp (3) with time zone NOT NULL,
	"finished_at" timestamp (3) with time zone NOT NULL,
	"lease_expires_at" timestamp (3) with time zone NOT NULL,
	"diagnostic_code_id" text,
	"retryability" "inbox_v2_source_processing_retryability",
	"diagnostic_correlation_token" text,
	"diagnostic_safe_operator_hint_id" text,
	"next_attempt_at" timestamp (3) with time zone,
	"rate_limit_reset_at" timestamp (3) with time zone,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_proc_attempt_pk" PRIMARY KEY("tenant_id","attempt_id"),
	CONSTRAINT "inbox_v2_src_proc_attempt_ordinal_unique" UNIQUE("tenant_id","work_id","processing_generation","attempt_number"),
	CONSTRAINT "inbox_v2_src_proc_attempt_revision_unique" UNIQUE("tenant_id","work_id","work_revision"),
	CONSTRAINT "inbox_v2_src_proc_attempt_values_check" CHECK (char_length("inbox_v2_source_processing_attempts"."attempt_id") between 8 and 256
    and "inbox_v2_source_processing_attempts"."attempt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and char_length("inbox_v2_source_processing_attempts"."work_id") between 8 and 256
    and "inbox_v2_source_processing_attempts"."work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_processing_attempts"."processing_generation" >= 1
        and "inbox_v2_source_processing_attempts"."attempt_number" >= 1
        and "inbox_v2_source_processing_attempts"."max_attempts" between 1 and 100
        and "inbox_v2_source_processing_attempts"."attempt_number" <= "inbox_v2_source_processing_attempts"."max_attempts"
        and "inbox_v2_source_processing_attempts"."work_revision" >= 2
        and char_length("inbox_v2_source_processing_attempts"."worker_id") between 8 and 256
    and "inbox_v2_source_processing_attempts"."worker_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_processing_attempts"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_processing_attempts"."lease_revision" >= 1
        and ("inbox_v2_source_processing_attempts"."diagnostic_code_id" is null
          or char_length("inbox_v2_source_processing_attempts"."diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_processing_attempts"."diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_attempts"."diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_attempts"."diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and ("inbox_v2_source_processing_attempts"."diagnostic_correlation_token" is null
          or char_length("inbox_v2_source_processing_attempts"."diagnostic_correlation_token") between 8 and 256
    and "inbox_v2_source_processing_attempts"."diagnostic_correlation_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$')
        and ("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id" is null
          or char_length("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id") <= 256 and (
    (
      "inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and (
          ("inbox_v2_source_processing_attempts"."origin" = 'replay' and "inbox_v2_source_processing_attempts"."replay_request_id" is not null)
          or ("inbox_v2_source_processing_attempts"."origin" <> 'replay'
            and "inbox_v2_source_processing_attempts"."replay_request_id" is null)
        )
        and ("inbox_v2_source_processing_attempts"."origin" <> 'initial' or "inbox_v2_source_processing_attempts"."attempt_number" = 1)
        and ("inbox_v2_source_processing_attempts"."origin" <> 'retry' or "inbox_v2_source_processing_attempts"."attempt_number" > 1)),
	CONSTRAINT "inbox_v2_src_proc_attempt_outcome_check" CHECK ((
          "inbox_v2_source_processing_attempts"."outcome" = 'processed'
          and "inbox_v2_source_processing_attempts"."diagnostic_code_id" is null
          and "inbox_v2_source_processing_attempts"."retryability" is null
          and "inbox_v2_source_processing_attempts"."diagnostic_correlation_token" is null
          and "inbox_v2_source_processing_attempts"."diagnostic_safe_operator_hint_id" is null
          and "inbox_v2_source_processing_attempts"."next_attempt_at" is null
        ) or (
          "inbox_v2_source_processing_attempts"."outcome" in ('ignored', 'duplicate')
          and "inbox_v2_source_processing_attempts"."diagnostic_code_id" is not null
          and "inbox_v2_source_processing_attempts"."retryability" = 'not_retryable'
          and "inbox_v2_source_processing_attempts"."diagnostic_correlation_token" is not null
          and "inbox_v2_source_processing_attempts"."next_attempt_at" is null
        ) or (
          "inbox_v2_source_processing_attempts"."outcome" = 'retry_scheduled'
          and "inbox_v2_source_processing_attempts"."diagnostic_code_id" is not null
          and "inbox_v2_source_processing_attempts"."retryability" = 'retryable'
          and "inbox_v2_source_processing_attempts"."diagnostic_correlation_token" is not null
          and "inbox_v2_source_processing_attempts"."next_attempt_at" is not null
        ) or (
          "inbox_v2_source_processing_attempts"."outcome" = 'dead_lettered'
          and "inbox_v2_source_processing_attempts"."diagnostic_code_id" is not null
          and "inbox_v2_source_processing_attempts"."retryability" is not null
          and "inbox_v2_source_processing_attempts"."diagnostic_correlation_token" is not null
          and "inbox_v2_source_processing_attempts"."next_attempt_at" is null
        )),
	CONSTRAINT "inbox_v2_src_proc_attempt_times_check" CHECK (isfinite("inbox_v2_source_processing_attempts"."lease_claimed_at")
        and isfinite("inbox_v2_source_processing_attempts"."started_at")
        and isfinite("inbox_v2_source_processing_attempts"."finished_at")
        and isfinite("inbox_v2_source_processing_attempts"."lease_expires_at")
        and isfinite("inbox_v2_source_processing_attempts"."expires_at")
        and isfinite("inbox_v2_source_processing_attempts"."created_at")
        and "inbox_v2_source_processing_attempts"."lease_claimed_at" <= "inbox_v2_source_processing_attempts"."started_at"
        and "inbox_v2_source_processing_attempts"."started_at" <= "inbox_v2_source_processing_attempts"."finished_at"
        and "inbox_v2_source_processing_attempts"."finished_at" < "inbox_v2_source_processing_attempts"."lease_expires_at"
        and "inbox_v2_source_processing_attempts"."created_at" = "inbox_v2_source_processing_attempts"."finished_at"
        and "inbox_v2_source_processing_attempts"."expires_at" > "inbox_v2_source_processing_attempts"."finished_at"
        and ("inbox_v2_source_processing_attempts"."next_attempt_at" is null
          or "inbox_v2_source_processing_attempts"."next_attempt_at" > "inbox_v2_source_processing_attempts"."finished_at")
        and ("inbox_v2_source_processing_attempts"."rate_limit_reset_at" is null
          or "inbox_v2_source_processing_attempts"."rate_limit_reset_at" >= "inbox_v2_source_processing_attempts"."finished_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_processing_dead_letters" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"work_id" text NOT NULL,
	"attempt_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"stage" "inbox_v2_source_processing_stage" NOT NULL,
	"processing_generation" bigint NOT NULL,
	"attempt_number" bigint NOT NULL,
	"work_revision" bigint NOT NULL,
	"reason" "inbox_v2_source_dead_letter_reason" NOT NULL,
	"diagnostic_code_id" text NOT NULL,
	"retryability" "inbox_v2_source_processing_retryability" NOT NULL,
	"diagnostic_correlation_token" text NOT NULL,
	"diagnostic_safe_operator_hint_id" text,
	"evidence_captured_at" timestamp (3) with time zone NOT NULL,
	"raw_payload_expires_at" timestamp (3) with time zone NOT NULL,
	"allowed_raw_headers_expires_at" timestamp (3) with time zone NOT NULL,
	"normalized_payload_expires_at" timestamp (3) with time zone,
	"replay_not_after" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_proc_dlq_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_src_proc_dlq_work_unique" UNIQUE("tenant_id","work_id","processing_generation","work_revision"),
	CONSTRAINT "inbox_v2_src_proc_dlq_values_check" CHECK (char_length("inbox_v2_source_processing_dead_letters"."id") between 8 and 256
    and "inbox_v2_source_processing_dead_letters"."id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and char_length("inbox_v2_source_processing_dead_letters"."work_id") between 8 and 256
    and "inbox_v2_source_processing_dead_letters"."work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and char_length("inbox_v2_source_processing_dead_letters"."attempt_id") between 8 and 256
    and "inbox_v2_source_processing_dead_letters"."attempt_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_processing_dead_letters"."processing_generation" >= 1
        and "inbox_v2_source_processing_dead_letters"."attempt_number" >= 1
        and "inbox_v2_source_processing_dead_letters"."work_revision" >= 2
        and char_length("inbox_v2_source_processing_dead_letters"."diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_processing_dead_letters"."diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_dead_letters"."diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_dead_letters"."diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_source_processing_dead_letters"."diagnostic_correlation_token") between 8 and 256
    and "inbox_v2_source_processing_dead_letters"."diagnostic_correlation_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and ("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id" is null
          or char_length("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id") <= 256 and (
    (
      "inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_dead_letters"."diagnostic_safe_operator_hint_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))),
	CONSTRAINT "inbox_v2_src_proc_dlq_window_check" CHECK (isfinite("inbox_v2_source_processing_dead_letters"."evidence_captured_at")
        and isfinite("inbox_v2_source_processing_dead_letters"."raw_payload_expires_at")
        and isfinite("inbox_v2_source_processing_dead_letters"."allowed_raw_headers_expires_at")
        and "inbox_v2_source_processing_dead_letters"."evidence_captured_at" < "inbox_v2_source_processing_dead_letters"."raw_payload_expires_at"
        and "inbox_v2_source_processing_dead_letters"."evidence_captured_at" < "inbox_v2_source_processing_dead_letters"."allowed_raw_headers_expires_at"
        and (
          ("inbox_v2_source_processing_dead_letters"."stage" in ('raw_ingest', 'normalization')
            and "inbox_v2_source_processing_dead_letters"."normalized_payload_expires_at" is null
            and "inbox_v2_source_processing_dead_letters"."replay_not_after" <= "inbox_v2_source_processing_dead_letters"."raw_payload_expires_at")
          or ("inbox_v2_source_processing_dead_letters"."stage" not in ('raw_ingest', 'normalization')
            and "inbox_v2_source_processing_dead_letters"."normalized_payload_expires_at" is not null
            and isfinite("inbox_v2_source_processing_dead_letters"."normalized_payload_expires_at")
            and "inbox_v2_source_processing_dead_letters"."evidence_captured_at" <
                "inbox_v2_source_processing_dead_letters"."normalized_payload_expires_at"
            and "inbox_v2_source_processing_dead_letters"."replay_not_after" <=
                "inbox_v2_source_processing_dead_letters"."normalized_payload_expires_at")
        )
        and isfinite("inbox_v2_source_processing_dead_letters"."recorded_at")
        and isfinite("inbox_v2_source_processing_dead_letters"."replay_not_after")
        and isfinite("inbox_v2_source_processing_dead_letters"."expires_at")
        and "inbox_v2_source_processing_dead_letters"."evidence_captured_at" <= "inbox_v2_source_processing_dead_letters"."recorded_at"
        and "inbox_v2_source_processing_dead_letters"."recorded_at" < "inbox_v2_source_processing_dead_letters"."replay_not_after"
        and "inbox_v2_source_processing_dead_letters"."replay_not_after" <= "inbox_v2_source_processing_dead_letters"."expires_at"),
	CONSTRAINT "inbox_v2_src_proc_dlq_reason_check" CHECK ((
          "inbox_v2_source_processing_dead_letters"."reason" = 'attempts_exhausted'
          and "inbox_v2_source_processing_dead_letters"."retryability" = 'retryable'
          and "inbox_v2_source_processing_dead_letters"."attempt_number" >= 1
        ) or (
          "inbox_v2_source_processing_dead_letters"."reason" = 'terminal_failure'
          and "inbox_v2_source_processing_dead_letters"."retryability" = 'not_retryable'
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_processing_key_generations" (
	"tenant_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"generation" text NOT NULL,
	"secret_ref" text NOT NULL,
	"state" "inbox_v2_source_processing_key_state" NOT NULL,
	"activated_at" timestamp (3) with time zone NOT NULL,
	"use_until" timestamp (3) with time zone NOT NULL,
	"guarantee_not_after" timestamp (3) with time zone NOT NULL,
	"verify_until" timestamp (3) with time zone NOT NULL,
	"retired_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_proc_key_gen_pk" PRIMARY KEY("tenant_id","purpose_id","generation"),
	CONSTRAINT "inbox_v2_src_proc_key_secret_unique" UNIQUE("tenant_id","secret_ref"),
	CONSTRAINT "inbox_v2_src_proc_key_exact_unique" UNIQUE("tenant_id","purpose_id","generation","secret_ref"),
	CONSTRAINT "inbox_v2_src_proc_key_identity_check" CHECK (char_length("inbox_v2_source_processing_key_generations"."purpose_id") <= 256 and (
    (
      "inbox_v2_source_processing_key_generations"."purpose_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_key_generations"."purpose_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_key_generations"."purpose_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_key_generations"."purpose_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_key_generations"."purpose_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_key_generations"."purpose_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_source_processing_key_generations"."generation") between 1 and 128
    and "inbox_v2_source_processing_key_generations"."generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and char_length("inbox_v2_source_processing_key_generations"."secret_ref") between 8 and 512
    and "inbox_v2_source_processing_key_generations"."secret_ref" ~ '^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_processing_key_generations"."revision" >= 1),
	CONSTRAINT "inbox_v2_src_proc_key_window_check" CHECK (isfinite("inbox_v2_source_processing_key_generations"."activated_at")
        and isfinite("inbox_v2_source_processing_key_generations"."use_until")
        and isfinite("inbox_v2_source_processing_key_generations"."guarantee_not_after")
        and isfinite("inbox_v2_source_processing_key_generations"."verify_until")
        and "inbox_v2_source_processing_key_generations"."activated_at" < "inbox_v2_source_processing_key_generations"."use_until"
        and "inbox_v2_source_processing_key_generations"."use_until" <= "inbox_v2_source_processing_key_generations"."guarantee_not_after"
        and "inbox_v2_source_processing_key_generations"."guarantee_not_after" <= "inbox_v2_source_processing_key_generations"."verify_until"
        and isfinite("inbox_v2_source_processing_key_generations"."created_at")
        and isfinite("inbox_v2_source_processing_key_generations"."updated_at")
        and "inbox_v2_source_processing_key_generations"."created_at" <= "inbox_v2_source_processing_key_generations"."activated_at"
        and "inbox_v2_source_processing_key_generations"."created_at" <= "inbox_v2_source_processing_key_generations"."updated_at"),
	CONSTRAINT "inbox_v2_src_proc_key_state_check" CHECK ((
          "inbox_v2_source_processing_key_generations"."state" in ('active', 'verify_only')
          and "inbox_v2_source_processing_key_generations"."retired_at" is null
        ) or (
          "inbox_v2_source_processing_key_generations"."state" = 'retired'
          and "inbox_v2_source_processing_key_generations"."retired_at" is not null
          and isfinite("inbox_v2_source_processing_key_generations"."retired_at")
          and "inbox_v2_source_processing_key_generations"."retired_at" >= "inbox_v2_source_processing_key_generations"."verify_until"
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_processing_work_heads" (
	"tenant_id" text NOT NULL,
	"work_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"normalized_event_id" text,
	"normalized_event_scope_key" text NOT NULL,
	"stage" "inbox_v2_source_processing_stage" NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"route_generation" bigint NOT NULL,
	"state" "inbox_v2_source_processing_work_state" NOT NULL,
	"processing_generation" bigint NOT NULL,
	"available_at" timestamp (3) with time zone NOT NULL,
	"max_attempts" integer NOT NULL,
	"attempt_count" bigint NOT NULL,
	"lease_owner_id" text,
	"lease_token_hash" text,
	"lease_revision" bigint,
	"lease_claimed_at" timestamp (3) with time zone,
	"lease_expires_at" timestamp (3) with time zone,
	"last_diagnostic_code_id" text,
	"retryability" "inbox_v2_source_processing_retryability",
	"rate_limit_reset_at" timestamp (3) with time zone,
	"dead_lettered_at" timestamp (3) with time zone,
	"completed_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_src_proc_work_pk" PRIMARY KEY("tenant_id","work_id"),
	CONSTRAINT "inbox_v2_src_proc_work_scope_unique" UNIQUE("tenant_id","raw_event_id","normalized_event_scope_key","stage"),
	CONSTRAINT "inbox_v2_src_proc_work_relation_unique" UNIQUE("tenant_id","work_id","raw_event_id","stage"),
	CONSTRAINT "inbox_v2_src_proc_work_replay_target_unique" UNIQUE("tenant_id","work_id","raw_event_id","normalized_event_scope_key","stage","source_connection_id","source_account_scope_key","route_generation"),
	CONSTRAINT "inbox_v2_src_proc_work_scope_check" CHECK ("inbox_v2_source_processing_work_heads"."source_account_scope_key" = case
    when "inbox_v2_source_processing_work_heads"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_processing_work_heads"."source_account_id")::text || ':' || "inbox_v2_source_processing_work_heads"."source_account_id"
  end
        and "inbox_v2_source_processing_work_heads"."normalized_event_scope_key" = case
    when "inbox_v2_source_processing_work_heads"."normalized_event_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_processing_work_heads"."normalized_event_id")::text || ':' || "inbox_v2_source_processing_work_heads"."normalized_event_id"
  end
        and (
          ("inbox_v2_source_processing_work_heads"."stage" in ('raw_ingest', 'normalization')
            and "inbox_v2_source_processing_work_heads"."normalized_event_id" is null)
          or ("inbox_v2_source_processing_work_heads"."stage" not in ('raw_ingest', 'normalization')
            and "inbox_v2_source_processing_work_heads"."normalized_event_id" is not null)
        )),
	CONSTRAINT "inbox_v2_src_proc_work_values_check" CHECK (char_length("inbox_v2_source_processing_work_heads"."work_id") between 8 and 256
    and "inbox_v2_source_processing_work_heads"."work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_processing_work_heads"."route_generation" >= 1
        and "inbox_v2_source_processing_work_heads"."processing_generation" >= 1
        and "inbox_v2_source_processing_work_heads"."max_attempts" between 1 and 100
        and "inbox_v2_source_processing_work_heads"."attempt_count" between 0 and "inbox_v2_source_processing_work_heads"."max_attempts"
        and "inbox_v2_source_processing_work_heads"."revision" >= 1
        and ("inbox_v2_source_processing_work_heads"."lease_owner_id" is null or char_length("inbox_v2_source_processing_work_heads"."lease_owner_id") between 8 and 256
    and "inbox_v2_source_processing_work_heads"."lease_owner_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$')
        and ("inbox_v2_source_processing_work_heads"."lease_token_hash" is null
          or "inbox_v2_source_processing_work_heads"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" is null
          or char_length("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_processing_work_heads"."last_diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))),
	CONSTRAINT "inbox_v2_src_proc_work_state_check" CHECK ((
          "inbox_v2_source_processing_work_heads"."state" in ('pending', 'retry_scheduled')
          and "inbox_v2_source_processing_work_heads"."lease_owner_id" is null
          and "inbox_v2_source_processing_work_heads"."lease_token_hash" is null
          and "inbox_v2_source_processing_work_heads"."lease_revision" is null
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" is null
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" is null
          and "inbox_v2_source_processing_work_heads"."dead_lettered_at" is null
          and "inbox_v2_source_processing_work_heads"."completed_at" is null
          and (
            "inbox_v2_source_processing_work_heads"."state" = 'pending'
            or (
              "inbox_v2_source_processing_work_heads"."attempt_count" >= 1
              and "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" is not null
              and "inbox_v2_source_processing_work_heads"."retryability" = 'retryable'
            )
          )
        ) or (
          "inbox_v2_source_processing_work_heads"."state" = 'leased'
          and "inbox_v2_source_processing_work_heads"."attempt_count" between 1 and "inbox_v2_source_processing_work_heads"."max_attempts"
          and "inbox_v2_source_processing_work_heads"."lease_owner_id" is not null
          and "inbox_v2_source_processing_work_heads"."lease_token_hash" is not null
          and "inbox_v2_source_processing_work_heads"."lease_revision" >= 1
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" is not null
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" is not null
          and "inbox_v2_source_processing_work_heads"."dead_lettered_at" is null
          and "inbox_v2_source_processing_work_heads"."completed_at" is null
        ) or (
          "inbox_v2_source_processing_work_heads"."state" = 'processed'
          and "inbox_v2_source_processing_work_heads"."lease_owner_id" is null
          and "inbox_v2_source_processing_work_heads"."lease_token_hash" is null
          and "inbox_v2_source_processing_work_heads"."lease_revision" is null
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" is null
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" is null
          and "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" is null
          and "inbox_v2_source_processing_work_heads"."retryability" is null
          and "inbox_v2_source_processing_work_heads"."dead_lettered_at" is null
          and "inbox_v2_source_processing_work_heads"."completed_at" is not null
        ) or (
          "inbox_v2_source_processing_work_heads"."state" in ('ignored', 'duplicate')
          and "inbox_v2_source_processing_work_heads"."lease_owner_id" is null
          and "inbox_v2_source_processing_work_heads"."lease_token_hash" is null
          and "inbox_v2_source_processing_work_heads"."lease_revision" is null
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" is null
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" is null
          and "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" is not null
          and "inbox_v2_source_processing_work_heads"."retryability" = 'not_retryable'
          and "inbox_v2_source_processing_work_heads"."dead_lettered_at" is null
          and "inbox_v2_source_processing_work_heads"."completed_at" is not null
        ) or (
          "inbox_v2_source_processing_work_heads"."state" = 'dead_lettered'
          and "inbox_v2_source_processing_work_heads"."lease_owner_id" is null
          and "inbox_v2_source_processing_work_heads"."lease_token_hash" is null
          and "inbox_v2_source_processing_work_heads"."lease_revision" is null
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" is null
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" is null
          and "inbox_v2_source_processing_work_heads"."last_diagnostic_code_id" is not null
          and "inbox_v2_source_processing_work_heads"."retryability" is not null
          and "inbox_v2_source_processing_work_heads"."dead_lettered_at" is not null
          and "inbox_v2_source_processing_work_heads"."completed_at" is null
        )),
	CONSTRAINT "inbox_v2_src_proc_work_times_check" CHECK (isfinite("inbox_v2_source_processing_work_heads"."available_at")
        and isfinite("inbox_v2_source_processing_work_heads"."created_at")
        and isfinite("inbox_v2_source_processing_work_heads"."updated_at")
        and "inbox_v2_source_processing_work_heads"."created_at" <= "inbox_v2_source_processing_work_heads"."updated_at"
        and ("inbox_v2_source_processing_work_heads"."lease_claimed_at" is null or (
          isfinite("inbox_v2_source_processing_work_heads"."lease_claimed_at")
          and "inbox_v2_source_processing_work_heads"."lease_claimed_at" <= "inbox_v2_source_processing_work_heads"."updated_at"
        ))
        and ("inbox_v2_source_processing_work_heads"."lease_expires_at" is null or (
          isfinite("inbox_v2_source_processing_work_heads"."lease_expires_at")
          and "inbox_v2_source_processing_work_heads"."lease_expires_at" > "inbox_v2_source_processing_work_heads"."updated_at"
        ))
        and ("inbox_v2_source_processing_work_heads"."rate_limit_reset_at" is null
          or isfinite("inbox_v2_source_processing_work_heads"."rate_limit_reset_at"))
        and ("inbox_v2_source_processing_work_heads"."dead_lettered_at" is null
          or "inbox_v2_source_processing_work_heads"."dead_lettered_at" = "inbox_v2_source_processing_work_heads"."updated_at")
        and ("inbox_v2_source_processing_work_heads"."completed_at" is null
          or "inbox_v2_source_processing_work_heads"."completed_at" = "inbox_v2_source_processing_work_heads"."updated_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_replay_requests" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"target_work_id" text NOT NULL,
	"mode" "inbox_v2_source_replay_mode" NOT NULL,
	"raw_event_id" text NOT NULL,
	"normalized_event_id" text,
	"normalized_event_scope_key" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"dead_letter_id" text,
	"stage" "inbox_v2_source_processing_stage" NOT NULL,
	"expected_target_revision" bigint NOT NULL,
	"route_generation" bigint NOT NULL,
	"request_hash" text NOT NULL,
	"reason_id" text NOT NULL,
	"requested_by_kind" "inbox_v2_source_replay_actor_kind" NOT NULL,
	"requested_by_employee_id" text,
	"requested_by_trusted_service_id" text,
	"state" "inbox_v2_source_replay_state" NOT NULL,
	"available_at" timestamp (3) with time zone NOT NULL,
	"replay_not_after" timestamp (3) with time zone NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"lease_owner_id" text,
	"lease_token_hash" text,
	"lease_revision" bigint,
	"lease_claimed_at" timestamp (3) with time zone,
	"lease_expires_at" timestamp (3) with time zone,
	"result_processing_generation" bigint,
	"result_replay_episode_id" text,
	"result_work_id" text,
	"result_work_revision" bigint,
	"rejection_reason" "inbox_v2_source_replay_rejection_reason",
	"diagnostic_code_id" text,
	"diagnostic_retryability" "inbox_v2_source_processing_retryability",
	"diagnostic_correlation_token" text,
	"diagnostic_safe_operator_hint_id" text,
	"revision" bigint NOT NULL,
	"requested_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	"completed_at" timestamp (3) with time zone,
	CONSTRAINT "inbox_v2_src_replay_request_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_src_replay_request_hash_unique" UNIQUE("tenant_id","request_hash"),
	CONSTRAINT "inbox_v2_src_replay_identity_check" CHECK (char_length("inbox_v2_source_replay_requests"."id") between 8 and 256
    and "inbox_v2_source_replay_requests"."id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and char_length("inbox_v2_source_replay_requests"."target_work_id") between 8 and 256
    and "inbox_v2_source_replay_requests"."target_work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_replay_requests"."expected_target_revision" >= 1
        and "inbox_v2_source_replay_requests"."route_generation" >= 1
        and "inbox_v2_source_replay_requests"."source_account_scope_key" = case
    when "inbox_v2_source_replay_requests"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_replay_requests"."source_account_id")::text || ':' || "inbox_v2_source_replay_requests"."source_account_id"
  end
        and "inbox_v2_source_replay_requests"."normalized_event_scope_key" = case
    when "inbox_v2_source_replay_requests"."normalized_event_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_replay_requests"."normalized_event_id")::text || ':' || "inbox_v2_source_replay_requests"."normalized_event_id"
  end
        and "inbox_v2_source_replay_requests"."request_hash" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_replay_requests"."reason_id") <= 256 and (
    (
      "inbox_v2_source_replay_requests"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."reason_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_replay_requests"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_replay_requests"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_replay_requests"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and (
          ("inbox_v2_source_replay_requests"."requested_by_kind" = 'employee'
            and "inbox_v2_source_replay_requests"."requested_by_employee_id" is not null
            and "inbox_v2_source_replay_requests"."requested_by_trusted_service_id" is null)
          or ("inbox_v2_source_replay_requests"."requested_by_kind" = 'trusted_service'
            and "inbox_v2_source_replay_requests"."requested_by_employee_id" is null
            and "inbox_v2_source_replay_requests"."requested_by_trusted_service_id" is not null
            and char_length("inbox_v2_source_replay_requests"."requested_by_trusted_service_id") between 8 and 256
    and "inbox_v2_source_replay_requests"."requested_by_trusted_service_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$')
        )
        and "inbox_v2_source_replay_requests"."revision" >= 1
        and ("inbox_v2_source_replay_requests"."lease_owner_id" is null or char_length("inbox_v2_source_replay_requests"."lease_owner_id") between 8 and 256
    and "inbox_v2_source_replay_requests"."lease_owner_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$')
        and ("inbox_v2_source_replay_requests"."lease_token_hash" is null
          or "inbox_v2_source_replay_requests"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_replay_requests"."diagnostic_code_id" is null
          or char_length("inbox_v2_source_replay_requests"."diagnostic_code_id") <= 256 and (
    (
      "inbox_v2_source_replay_requests"."diagnostic_code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_code_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_replay_requests"."diagnostic_code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_replay_requests"."diagnostic_code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))
        and ("inbox_v2_source_replay_requests"."diagnostic_correlation_token" is null
          or char_length("inbox_v2_source_replay_requests"."diagnostic_correlation_token") between 8 and 256
    and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$')
        and ("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" is null
          or char_length("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id") <= 256 and (
    (
      "inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  ))),
	CONSTRAINT "inbox_v2_src_replay_target_check" CHECK ((
          "inbox_v2_source_replay_requests"."mode" = 'raw_event'
          and "inbox_v2_source_replay_requests"."stage" = 'normalization'
          and "inbox_v2_source_replay_requests"."normalized_event_id" is null
        ) or (
          "inbox_v2_source_replay_requests"."mode" = 'normalized_event'
          and "inbox_v2_source_replay_requests"."stage" not in ('raw_ingest', 'normalization')
          and "inbox_v2_source_replay_requests"."normalized_event_id" is not null
        ) or (
          "inbox_v2_source_replay_requests"."mode" = 'dead_letter'
          and (
            ("inbox_v2_source_replay_requests"."stage" in ('raw_ingest', 'normalization')
              and "inbox_v2_source_replay_requests"."normalized_event_id" is null)
            or ("inbox_v2_source_replay_requests"."stage" not in ('raw_ingest', 'normalization')
              and "inbox_v2_source_replay_requests"."normalized_event_id" is not null)
          )
        )),
	CONSTRAINT "inbox_v2_src_replay_state_check" CHECK ((
          "inbox_v2_source_replay_requests"."state" = 'pending'
          and "inbox_v2_source_replay_requests"."dead_letter_id" is not null
          and "inbox_v2_source_replay_requests"."lease_owner_id" is null
          and "inbox_v2_source_replay_requests"."lease_token_hash" is null
          and "inbox_v2_source_replay_requests"."lease_revision" is null
          and "inbox_v2_source_replay_requests"."lease_claimed_at" is null
          and "inbox_v2_source_replay_requests"."lease_expires_at" is null
          and "inbox_v2_source_replay_requests"."result_processing_generation" is null
          and "inbox_v2_source_replay_requests"."result_replay_episode_id" is null
          and "inbox_v2_source_replay_requests"."result_work_id" is null
          and "inbox_v2_source_replay_requests"."result_work_revision" is null
          and "inbox_v2_source_replay_requests"."rejection_reason" is null
          and "inbox_v2_source_replay_requests"."diagnostic_code_id" is null
          and "inbox_v2_source_replay_requests"."diagnostic_retryability" is null
          and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" is null
          and "inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" is null
          and "inbox_v2_source_replay_requests"."completed_at" is null
        ) or (
          "inbox_v2_source_replay_requests"."state" = 'leased'
          and "inbox_v2_source_replay_requests"."dead_letter_id" is not null
          and "inbox_v2_source_replay_requests"."lease_owner_id" is not null
          and "inbox_v2_source_replay_requests"."lease_token_hash" is not null
          and "inbox_v2_source_replay_requests"."lease_revision" >= 1
          and "inbox_v2_source_replay_requests"."lease_claimed_at" is not null
          and "inbox_v2_source_replay_requests"."lease_expires_at" is not null
          and "inbox_v2_source_replay_requests"."result_processing_generation" is null
          and "inbox_v2_source_replay_requests"."result_replay_episode_id" is null
          and "inbox_v2_source_replay_requests"."result_work_id" is null
          and "inbox_v2_source_replay_requests"."result_work_revision" is null
          and "inbox_v2_source_replay_requests"."rejection_reason" is null
          and "inbox_v2_source_replay_requests"."diagnostic_code_id" is null
          and "inbox_v2_source_replay_requests"."diagnostic_retryability" is null
          and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" is null
          and "inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" is null
          and "inbox_v2_source_replay_requests"."completed_at" is null
        ) or (
          "inbox_v2_source_replay_requests"."state" = 'applied'
          and "inbox_v2_source_replay_requests"."dead_letter_id" is not null
          and "inbox_v2_source_replay_requests"."lease_owner_id" is null
          and "inbox_v2_source_replay_requests"."lease_token_hash" is null
          and "inbox_v2_source_replay_requests"."lease_revision" is null
          and "inbox_v2_source_replay_requests"."lease_claimed_at" is null
          and "inbox_v2_source_replay_requests"."lease_expires_at" is null
          and "inbox_v2_source_replay_requests"."result_processing_generation" >= 2
          and "inbox_v2_source_replay_requests"."result_replay_episode_id" is not null
          and char_length("inbox_v2_source_replay_requests"."result_replay_episode_id") between 8 and 256
    and "inbox_v2_source_replay_requests"."result_replay_episode_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
          and "inbox_v2_source_replay_requests"."result_work_id" is not null
          and char_length("inbox_v2_source_replay_requests"."result_work_id") between 8 and 256
    and "inbox_v2_source_replay_requests"."result_work_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
          and "inbox_v2_source_replay_requests"."result_work_revision" >= 1
          and "inbox_v2_source_replay_requests"."rejection_reason" is null
          and "inbox_v2_source_replay_requests"."diagnostic_code_id" is null
          and "inbox_v2_source_replay_requests"."diagnostic_retryability" is null
          and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" is null
          and "inbox_v2_source_replay_requests"."diagnostic_safe_operator_hint_id" is null
          and "inbox_v2_source_replay_requests"."completed_at" is not null
        ) or (
          "inbox_v2_source_replay_requests"."state" = 'denied'
          and "inbox_v2_source_replay_requests"."lease_owner_id" is null
          and "inbox_v2_source_replay_requests"."lease_token_hash" is null
          and "inbox_v2_source_replay_requests"."lease_revision" is null
          and "inbox_v2_source_replay_requests"."lease_claimed_at" is null
          and "inbox_v2_source_replay_requests"."lease_expires_at" is null
          and "inbox_v2_source_replay_requests"."result_processing_generation" is null
          and "inbox_v2_source_replay_requests"."result_replay_episode_id" is null
          and "inbox_v2_source_replay_requests"."result_work_id" is null
          and "inbox_v2_source_replay_requests"."result_work_revision" is null
          and "inbox_v2_source_replay_requests"."rejection_reason" is not null
          and "inbox_v2_source_replay_requests"."rejection_reason" <> 'replay_expired'
          and "inbox_v2_source_replay_requests"."diagnostic_code_id" is not null
          and "inbox_v2_source_replay_requests"."diagnostic_retryability" = 'not_retryable'
          and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" is not null
          and "inbox_v2_source_replay_requests"."completed_at" is not null
        ) or (
          "inbox_v2_source_replay_requests"."state" = 'expired'
          and "inbox_v2_source_replay_requests"."lease_owner_id" is null
          and "inbox_v2_source_replay_requests"."lease_token_hash" is null
          and "inbox_v2_source_replay_requests"."lease_revision" is null
          and "inbox_v2_source_replay_requests"."lease_claimed_at" is null
          and "inbox_v2_source_replay_requests"."lease_expires_at" is null
          and "inbox_v2_source_replay_requests"."result_processing_generation" is null
          and "inbox_v2_source_replay_requests"."result_replay_episode_id" is null
          and "inbox_v2_source_replay_requests"."result_work_id" is null
          and "inbox_v2_source_replay_requests"."result_work_revision" is null
          and "inbox_v2_source_replay_requests"."rejection_reason" = 'replay_expired'
          and "inbox_v2_source_replay_requests"."diagnostic_code_id" is not null
          and "inbox_v2_source_replay_requests"."diagnostic_retryability" = 'not_retryable'
          and "inbox_v2_source_replay_requests"."diagnostic_correlation_token" is not null
          and "inbox_v2_source_replay_requests"."completed_at" is not null
        )),
	CONSTRAINT "inbox_v2_src_replay_times_check" CHECK (isfinite("inbox_v2_source_replay_requests"."available_at")
        and isfinite("inbox_v2_source_replay_requests"."replay_not_after")
        and isfinite("inbox_v2_source_replay_requests"."expires_at")
        and isfinite("inbox_v2_source_replay_requests"."requested_at")
        and isfinite("inbox_v2_source_replay_requests"."updated_at")
        and "inbox_v2_source_replay_requests"."requested_at" <= "inbox_v2_source_replay_requests"."available_at"
        and "inbox_v2_source_replay_requests"."requested_at" <= "inbox_v2_source_replay_requests"."updated_at"
        and (
          ("inbox_v2_source_replay_requests"."dead_letter_id" is null
            and "inbox_v2_source_replay_requests"."updated_at" < "inbox_v2_source_replay_requests"."expires_at")
          or ("inbox_v2_source_replay_requests"."dead_letter_id" is not null
            and "inbox_v2_source_replay_requests"."replay_not_after" <= "inbox_v2_source_replay_requests"."expires_at")
        )
        and ("inbox_v2_source_replay_requests"."lease_expires_at" is null or (
          "inbox_v2_source_replay_requests"."lease_claimed_at" is not null
          and "inbox_v2_source_replay_requests"."lease_claimed_at" <= "inbox_v2_source_replay_requests"."updated_at"
          and "inbox_v2_source_replay_requests"."lease_expires_at" > "inbox_v2_source_replay_requests"."updated_at"
          and "inbox_v2_source_replay_requests"."lease_expires_at" <= "inbox_v2_source_replay_requests"."replay_not_after"
        ))
        and ("inbox_v2_source_replay_requests"."completed_at" is null
          or "inbox_v2_source_replay_requests"."completed_at" = "inbox_v2_source_replay_requests"."updated_at")
        and (
          ("inbox_v2_source_replay_requests"."state" in ('pending', 'leased', 'applied')
            and "inbox_v2_source_replay_requests"."available_at" < "inbox_v2_source_replay_requests"."replay_not_after"
            and "inbox_v2_source_replay_requests"."updated_at" < "inbox_v2_source_replay_requests"."replay_not_after")
          or "inbox_v2_source_replay_requests"."state" = 'denied'
          or ("inbox_v2_source_replay_requests"."state" = 'expired'
            and "inbox_v2_source_replay_requests"."updated_at" >= "inbox_v2_source_replay_requests"."replay_not_after")
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_raw_admissions" (
	"tenant_id" text NOT NULL,
	"purpose_id" text NOT NULL,
	"key_generation" text NOT NULL,
	"hmac_key_secret_ref" text NOT NULL,
	"identity_hmac_sha256" text NOT NULL,
	"identity_kind" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"safe_envelope_digest_sha256" text NOT NULL,
	"guarantee_until" timestamp (3) with time zone NOT NULL,
	"state" "inbox_v2_source_raw_admission_state" NOT NULL,
	"terminal_skeleton_id" text,
	"terminal_outcome_hmac_sha256" text,
	"skeleton_handed_off_at" timestamp (3) with time zone,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_raw_admissions_pk" PRIMARY KEY("tenant_id","purpose_id","key_generation","identity_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_raw_admissions_raw_generation_unique" UNIQUE("tenant_id","raw_event_id","key_generation"),
	CONSTRAINT "inbox_v2_source_raw_admissions_terminal_skeleton_unique" UNIQUE("tenant_id","terminal_skeleton_id"),
	CONSTRAINT "inbox_v2_source_raw_admissions_scope_check" CHECK ("inbox_v2_source_raw_admissions"."source_account_scope_key" = case
    when "inbox_v2_source_raw_admissions"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_raw_admissions"."source_account_id")::text || ':' || "inbox_v2_source_raw_admissions"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_source_raw_admissions_identity_check" CHECK ("inbox_v2_source_raw_admissions"."purpose_id" = 'core:source_replay_and_diagnostics'
        and char_length("inbox_v2_source_raw_admissions"."key_generation") between 1 and 128
    and "inbox_v2_source_raw_admissions"."key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and char_length("inbox_v2_source_raw_admissions"."hmac_key_secret_ref") between 8 and 512
    and "inbox_v2_source_raw_admissions"."hmac_key_secret_ref" ~ '^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
        and "inbox_v2_source_raw_admissions"."hmac_key_secret_ref" like
          'secret:' || "inbox_v2_source_raw_admissions"."tenant_id" || '/%'
        and "inbox_v2_source_raw_admissions"."identity_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_raw_admissions"."identity_kind") between 1 and 128
    and "inbox_v2_source_raw_admissions"."identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and "inbox_v2_source_raw_admissions"."safe_envelope_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_raw_admissions"."revision" >= 1),
	CONSTRAINT "inbox_v2_source_raw_admissions_lifecycle_check" CHECK (isfinite("inbox_v2_source_raw_admissions"."guarantee_until")
        and isfinite("inbox_v2_source_raw_admissions"."created_at")
        and isfinite("inbox_v2_source_raw_admissions"."updated_at")
        and "inbox_v2_source_raw_admissions"."guarantee_until" > "inbox_v2_source_raw_admissions"."created_at"
        and "inbox_v2_source_raw_admissions"."updated_at" >= "inbox_v2_source_raw_admissions"."created_at"
        and (
          ("inbox_v2_source_raw_admissions"."state" = 'skeleton_pending'
            and "inbox_v2_source_raw_admissions"."terminal_skeleton_id" is null
            and "inbox_v2_source_raw_admissions"."terminal_outcome_hmac_sha256" is null
            and "inbox_v2_source_raw_admissions"."skeleton_handed_off_at" is null)
          or ("inbox_v2_source_raw_admissions"."state" = 'skeleton_handed_off'
            and char_length("inbox_v2_source_raw_admissions"."terminal_skeleton_id") between 8 and 256
    and "inbox_v2_source_raw_admissions"."terminal_skeleton_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
            and "inbox_v2_source_raw_admissions"."terminal_outcome_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and isfinite("inbox_v2_source_raw_admissions"."skeleton_handed_off_at")
            and "inbox_v2_source_raw_admissions"."skeleton_handed_off_at" between
              "inbox_v2_source_raw_admissions"."created_at" and "inbox_v2_source_raw_admissions"."updated_at")
        ))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" DROP CONSTRAINT "inbox_v2_source_raw_envelopes_identity_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" DROP CONSTRAINT "inbox_v2_source_raw_quarantines_safe_values_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD COLUMN "event_identity_key_generation" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD COLUMN "event_identity_hmac_key_secret_ref" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD COLUMN "event_identity_guarantee_until" timestamp (3) with time zone;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_account_pressure_heads" ADD CONSTRAINT "inbox_v2_src_pressure_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_account_pressure_heads" ADD CONSTRAINT "inbox_v2_src_pressure_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_key_fk" FOREIGN KEY ("tenant_id","purpose_id","key_generation") REFERENCES "public"."inbox_v2_source_processing_key_generations"("tenant_id","purpose_id","generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_raw_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_raw_connection_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_raw_scope_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_delivery_dedupe_skeletons" ADD CONSTRAINT "inbox_v2_src_dedupe_normalized_fk" FOREIGN KEY ("tenant_id","normalized_event_id") REFERENCES "public"."inbox_v2_source_normalized_envelopes"("tenant_id","normalized_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_value_secret_fk" FOREIGN KEY ("tenant_id","cursor_value_secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_key_fk" FOREIGN KEY ("tenant_id","purpose_id","key_generation") REFERENCES "public"."inbox_v2_source_processing_key_generations"("tenant_id","purpose_id","generation") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_raw_fk" FOREIGN KEY ("tenant_id","last_durable_raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_raw_connection_fk" FOREIGN KEY ("tenant_id","last_durable_raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_raw_scope_fk" FOREIGN KEY ("tenant_id","last_durable_raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_work_fk" FOREIGN KEY ("tenant_id","durable_work_id") REFERENCES "public"."inbox_v2_source_processing_work_heads"("tenant_id","work_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_ingress_cursor_checkpoints" ADD CONSTRAINT "inbox_v2_src_cursor_quarantine_fk" FOREIGN KEY ("tenant_id","quarantine_id") REFERENCES "public"."inbox_v2_source_raw_quarantines"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_attempts" ADD CONSTRAINT "inbox_v2_src_proc_attempt_work_fk" FOREIGN KEY ("tenant_id","work_id","raw_event_id","stage") REFERENCES "public"."inbox_v2_source_processing_work_heads"("tenant_id","work_id","raw_event_id","stage") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_dead_letters" ADD CONSTRAINT "inbox_v2_src_proc_dlq_work_fk" FOREIGN KEY ("tenant_id","work_id","raw_event_id","stage") REFERENCES "public"."inbox_v2_source_processing_work_heads"("tenant_id","work_id","raw_event_id","stage") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_dead_letters" ADD CONSTRAINT "inbox_v2_src_proc_dlq_attempt_fk" FOREIGN KEY ("tenant_id","attempt_id") REFERENCES "public"."inbox_v2_source_processing_attempts"("tenant_id","attempt_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_key_generations" ADD CONSTRAINT "inbox_v2_src_proc_key_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_key_generations" ADD CONSTRAINT "inbox_v2_src_proc_key_secret_fk" FOREIGN KEY ("tenant_id","secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_raw_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_raw_connection_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_normalized_fk" FOREIGN KEY ("tenant_id","normalized_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_raw_scope_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_processing_work_heads" ADD CONSTRAINT "inbox_v2_src_proc_work_account_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_admissions" ADD CONSTRAINT "inbox_v2_source_raw_admissions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_admissions" ADD CONSTRAINT "inbox_v2_source_raw_admissions_secret_fk" FOREIGN KEY ("tenant_id","hmac_key_secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_admissions" ADD CONSTRAINT "inbox_v2_source_raw_admissions_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_admissions" ADD CONSTRAINT "inbox_v2_source_raw_admissions_account_edge_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_admissions" ADD CONSTRAINT "inbox_v2_source_raw_admissions_envelope_fk" FOREIGN KEY ("tenant_id","raw_event_id","safe_envelope_digest_sha256") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id","safe_envelope_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_pressure_due_idx" ON "inbox_v2_source_account_pressure_heads" USING btree ("tenant_id","state","rate_limit_reset_at","backoff_until","source_connection_id","source_account_scope_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_dedupe_expiry_idx" ON "inbox_v2_source_delivery_dedupe_skeletons" USING btree ("tenant_id","skeleton_expires_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_dedupe_replay_expiry_idx" ON "inbox_v2_source_delivery_dedupe_skeletons" USING btree ("tenant_id","replay_until","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_dedupe_account_idx" ON "inbox_v2_source_delivery_dedupe_skeletons" USING btree ("tenant_id","source_account_scope_key","guarantee_until","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_cursor_acknowledged_idx" ON "inbox_v2_source_ingress_cursor_checkpoints" USING btree ("tenant_id","acknowledged_at","source_connection_id","source_account_scope_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_attempt_expiry_idx" ON "inbox_v2_source_processing_attempts" USING btree ("tenant_id","expires_at","raw_event_id","stage");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_attempt_code_idx" ON "inbox_v2_source_processing_attempts" USING btree ("tenant_id","diagnostic_code_id","finished_at","raw_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_dlq_expiry_idx" ON "inbox_v2_source_processing_dead_letters" USING btree ("tenant_id","expires_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_dlq_replay_idx" ON "inbox_v2_source_processing_dead_letters" USING btree ("tenant_id","replay_not_after","raw_event_id","stage");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_src_proc_key_active_unique" ON "inbox_v2_source_processing_key_generations" USING btree ("tenant_id","purpose_id") WHERE "inbox_v2_source_processing_key_generations"."state" = 'active';
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_key_verify_idx" ON "inbox_v2_source_processing_key_generations" USING btree ("tenant_id","verify_until","purpose_id","generation");
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_src_proc_work_lease_unique" ON "inbox_v2_source_processing_work_heads" USING btree ("tenant_id","lease_token_hash") WHERE "inbox_v2_source_processing_work_heads"."lease_token_hash" is not null;
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_work_due_idx" ON "inbox_v2_source_processing_work_heads" USING btree ("tenant_id","source_account_scope_key","available_at","raw_event_id","stage") WHERE "inbox_v2_source_processing_work_heads"."state" in ('pending', 'retry_scheduled');
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_work_reclaim_idx" ON "inbox_v2_source_processing_work_heads" USING btree ("tenant_id","source_account_scope_key","lease_expires_at","raw_event_id","stage") WHERE "inbox_v2_source_processing_work_heads"."state" = 'leased';
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_proc_work_terminal_idx" ON "inbox_v2_source_processing_work_heads" USING btree ("tenant_id","state","updated_at","raw_event_id") WHERE "inbox_v2_source_processing_work_heads"."state" in ('processed', 'ignored', 'duplicate', 'dead_lettered');
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_src_replay_lease_unique" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","lease_token_hash") WHERE "inbox_v2_source_replay_requests"."lease_token_hash" is not null;
--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_src_replay_active_target_unique" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","target_work_id") WHERE "inbox_v2_source_replay_requests"."state" in ('pending', 'leased');
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_replay_due_idx" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","available_at","id") WHERE "inbox_v2_source_replay_requests"."state" = 'pending';
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_replay_reclaim_idx" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","lease_expires_at","id") WHERE "inbox_v2_source_replay_requests"."state" = 'leased';
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_replay_raw_idx" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","raw_event_id","requested_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_src_replay_expiry_idx" ON "inbox_v2_source_replay_requests" USING btree ("tenant_id","expires_at","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_admissions_raw_idx" ON "inbox_v2_source_raw_admissions" USING btree ("tenant_id","raw_event_id","state");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_admissions_guarantee_idx" ON "inbox_v2_source_raw_admissions" USING btree ("tenant_id","guarantee_until","key_generation");
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_identity_secret_fk" FOREIGN KEY ("tenant_id","event_identity_hmac_key_secret_ref") REFERENCES "public"."tenant_secrets"("tenant_id","secret_ref") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_identity_check" CHECK ("inbox_v2_source_raw_envelopes"."idempotency_key" ~ '^source:v2:raw:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_raw_envelopes"."transport_kind") between 1 and 128
    and "inbox_v2_source_raw_envelopes"."transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_raw_envelopes"."event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_envelopes"."event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_raw_envelopes"."safe_envelope_schema_id") <= 256 and (
    (
      "inbox_v2_source_raw_envelopes"."safe_envelope_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_envelopes"."safe_envelope_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_raw_envelopes"."safe_envelope_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_envelopes"."safe_envelope_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_raw_envelopes"."safe_envelope_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_raw_envelopes"."safe_envelope_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_raw_envelopes"."safe_envelope_schema_version" ~ '^v[1-9][0-9]*$'
        and (
          ("inbox_v2_source_raw_envelopes"."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
            and "inbox_v2_source_raw_envelopes"."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
          or ("inbox_v2_source_raw_envelopes"."event_identity_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and "inbox_v2_source_raw_envelopes"."safe_envelope_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$')
        ));
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_safe_values_check" CHECK ("inbox_v2_source_raw_quarantines"."quarantine_fingerprint_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_raw_quarantines"."transport_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and ("inbox_v2_source_raw_quarantines"."event_identity_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and (
          ("inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" is null
            and "inbox_v2_source_raw_quarantines"."event_identity_key_generation" is null
            and "inbox_v2_source_raw_quarantines"."event_identity_hmac_key_secret_ref" is null
            and "inbox_v2_source_raw_quarantines"."event_identity_guarantee_until" is null)
          or ("inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
            and "inbox_v2_source_raw_quarantines"."event_identity_key_generation" is null
            and "inbox_v2_source_raw_quarantines"."event_identity_hmac_key_secret_ref" is null
            and "inbox_v2_source_raw_quarantines"."event_identity_guarantee_until" is null)
          or ("inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and char_length("inbox_v2_source_raw_quarantines"."event_identity_key_generation") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."event_identity_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
            and char_length("inbox_v2_source_raw_quarantines"."event_identity_hmac_key_secret_ref") between 8 and 512
    and "inbox_v2_source_raw_quarantines"."event_identity_hmac_key_secret_ref" ~ '^secret:[A-Za-z0-9][A-Za-z0-9._~:/-]*$'
            and "inbox_v2_source_raw_quarantines"."event_identity_hmac_key_secret_ref" like
              'secret:' || "inbox_v2_source_raw_quarantines"."tenant_id" || '/%'
            and isfinite("inbox_v2_source_raw_quarantines"."event_identity_guarantee_until")
            and "inbox_v2_source_raw_quarantines"."event_identity_guarantee_until" > "inbox_v2_source_raw_quarantines"."recorded_at")
        )
        and ("inbox_v2_source_raw_quarantines"."idempotency_key_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."idempotency_key_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" is null
          or ("inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$' or "inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'))
        and ("inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" is null
          or ("inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$' or "inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'))
        and ("inbox_v2_source_raw_quarantines"."existing_transport_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."existing_transport_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."existing_transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and ("inbox_v2_source_raw_quarantines"."existing_event_identity_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."existing_event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."existing_event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and ("inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" is null
          or ("inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$' or "inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'))
        and char_length("inbox_v2_source_raw_quarantines"."sanitizer_id") <= 256 and (
    (
      "inbox_v2_source_raw_quarantines"."sanitizer_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_quarantines"."sanitizer_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_raw_quarantines"."sanitizer_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_quarantines"."sanitizer_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_raw_quarantines"."sanitizer_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_raw_quarantines"."sanitizer_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_raw_quarantines"."sanitizer_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_raw_quarantines"."sanitizer_declaration_revision" >= 1
        and isfinite("inbox_v2_source_raw_quarantines"."recorded_at"));
--> statement-breakpoint
-- INBOX_V2_SOURCE_RAW_ADMISSION_FINALIZED_V1
create or replace function public.inbox_v2_source_raw_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_source_raw_quarantines'
     and tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.event_identity_digest_sha256 not like 'hmac-sha256:%'
       or old.event_identity_key_generation is null
       or old.event_identity_hmac_key_secret_ref is null
       or old.event_identity_guarantee_until is null
       or clock_timestamp() < old.event_identity_guarantee_until then
      raise exception 'Raw quarantine is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;
  if tg_table_name = 'inbox_v2_source_raw_evidence' and tg_op = 'DELETE' then
    if exists (
      select 1
        from public.inbox_v2_source_raw_admissions admission
       where admission.tenant_id = old.tenant_id
         and admission.raw_event_id = old.raw_event_id
         and admission.state = 'skeleton_pending'
    ) then
      raise exception 'Raw evidence cannot compact before skeleton handoff'
        using errcode = '23514';
    end if;
    return old;
  end if;
  raise exception '% is immutable', tg_table_name using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_source_raw_admission_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.state <> 'skeleton_handed_off'
       or clock_timestamp() < old.guarantee_until then
      raise exception 'Raw admission is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'skeleton_pending'
       or new.terminal_skeleton_id is not null
       or new.terminal_outcome_hmac_sha256 is not null
       or new.skeleton_handed_off_at is not null
       or new.revision <> 1
       or new.updated_at <> new.created_at then
      raise exception 'Raw admission must start skeleton_pending at revision one'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.purpose_id <> old.purpose_id
     or new.key_generation <> old.key_generation
     or new.hmac_key_secret_ref <> old.hmac_key_secret_ref
     or new.identity_hmac_sha256 <> old.identity_hmac_sha256
     or new.identity_kind <> old.identity_kind
     or new.source_connection_id <> old.source_connection_id
     or new.source_account_id is distinct from old.source_account_id
     or new.source_account_scope_key <> old.source_account_scope_key
     or new.raw_event_id <> old.raw_event_id
     or new.safe_envelope_digest_sha256 <> old.safe_envelope_digest_sha256
     or new.guarantee_until <> old.guarantee_until
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'Raw admission mutation requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  if old.state = 'skeleton_pending'
     and new.state = 'skeleton_handed_off'
     and new.terminal_skeleton_id is not null
     and new.terminal_outcome_hmac_sha256 is not null
     and new.skeleton_handed_off_at = new.updated_at
     and new.skeleton_handed_off_at >= old.created_at then
    return new;
  end if;

  raise exception 'Illegal raw admission state transition'
    using errcode = '23514';
end
$function$;

create trigger inbox_v2_source_raw_admission_guard_trigger
before insert or update or delete on public.inbox_v2_source_raw_admissions
for each row execute function public.inbox_v2_source_raw_admission_guard();

create trigger inbox_v2_source_raw_admissions_truncate_guard
before truncate on public.inbox_v2_source_raw_admissions
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create or replace function public.inbox_v2_source_raw_assert_aggregate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_raw_event_id text;
  v_anchor public.raw_inbound_events%rowtype;
  v_envelope public.inbox_v2_source_raw_envelopes%rowtype;
  v_work_count bigint;
  v_payload_count bigint;
  v_header_count bigint;
  v_admission_count bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'raw_inbound_events' then
    v_raw_event_id := new.id;
  else
    v_raw_event_id := new.raw_event_id;
  end if;

  select * into v_anchor
    from public.raw_inbound_events r
   where r.tenant_id = v_tenant_id and r.id = v_raw_event_id;
  select * into v_envelope
    from public.inbox_v2_source_raw_envelopes e
   where e.tenant_id = v_tenant_id and e.raw_event_id = v_raw_event_id;

  if v_envelope.raw_event_id is null then
    if v_anchor.id is not null
       and v_anchor.idempotency_key like 'source:v2:raw:%' then
      raise exception 'V2 raw anchor requires an immutable envelope'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_anchor.id is null
     or v_anchor.source_connection_id <> v_envelope.source_connection_id
     or v_anchor.source_account_scope_key <>
        v_envelope.source_account_scope_key
     or v_anchor.idempotency_key <> v_envelope.idempotency_key
     or v_anchor.received_at <> v_envelope.accepted_at
     or v_anchor.external_event_id is not null
     or v_anchor.event_signature is not null
     or v_anchor.payload <> '{}'::jsonb
     or v_anchor.headers <> '{}'::jsonb
     or v_anchor.processing_status <> 'ignored'
     or v_anchor.error_code is not null
     or v_anchor.error_message is not null then
    raise exception 'V2 raw compatibility anchor contains unsafe or incoherent data'
      using errcode = '23514';
  end if;

  select count(*) into v_work_count
    from public.inbox_v2_source_raw_work_items w
   where w.tenant_id = v_tenant_id and w.raw_event_id = v_raw_event_id;
  select count(*) filter (where e.evidence_kind = 'provider_payload'),
         count(*) filter (where e.evidence_kind = 'allowed_headers')
    into v_payload_count, v_header_count
    from public.inbox_v2_source_raw_evidence e
   where e.tenant_id = v_tenant_id and e.raw_event_id = v_raw_event_id;
  select count(*) into v_admission_count
    from public.inbox_v2_source_raw_admissions admission
   where admission.tenant_id = v_tenant_id
     and admission.raw_event_id = v_raw_event_id
     and admission.safe_envelope_digest_sha256 =
       v_envelope.safe_envelope_digest_sha256;

  if v_work_count <> 1
     or (
       v_envelope.event_identity_digest_sha256 like 'hmac-sha256:%'
       and v_admission_count <> 1
     )
     or (
       v_envelope.event_identity_digest_sha256 like 'sha256:%'
       and v_admission_count <> 0
     )
     or (
       tg_table_name <> 'inbox_v2_source_raw_work_items'
       and (
         (v_envelope.provider_payload_evidence_present and v_payload_count <> 1)
         or (not v_envelope.provider_payload_evidence_present and v_payload_count <> 0)
         or (v_envelope.allowed_headers_evidence_present and v_header_count <> 1)
         or (not v_envelope.allowed_headers_evidence_present and v_header_count <> 0)
       )
     ) then
    raise exception 'V2 raw aggregate requires one work head and exact evidence flags'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_source_raw_admission_coherence_constraint
after insert or update on public.inbox_v2_source_raw_admissions
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

revoke all privileges on table
  public.inbox_v2_source_raw_admissions
from public;
grant select, insert, update on table
  public.inbox_v2_source_raw_admissions
to hulee_inbox_v2_runtime;
grant select, delete on table
  public.inbox_v2_source_raw_admissions
to hulee_inbox_v2_retention_owner;
revoke delete, truncate on table
  public.inbox_v2_source_raw_admissions
from hulee_inbox_v2_runtime;
revoke insert, update, truncate on table
  public.inbox_v2_source_raw_admissions
from hulee_inbox_v2_retention_owner;
grant select, insert on table
  public.inbox_v2_source_raw_quarantines
to hulee_inbox_v2_runtime;
grant select, delete on table
  public.inbox_v2_source_raw_quarantines
to hulee_inbox_v2_retention_owner;
revoke delete, truncate on table
  public.inbox_v2_source_raw_quarantines
from hulee_inbox_v2_runtime;
revoke insert, update, truncate on table
  public.inbox_v2_source_raw_quarantines
from hulee_inbox_v2_retention_owner;
--> statement-breakpoint
-- INBOX_V2_SOURCE_PROCESSING_RUNTIME_FINALIZED_V1
alter table public.inbox_v2_source_raw_admissions
  add constraint inbox_v2_source_raw_admissions_processing_key_fk
  foreign key (
    tenant_id, purpose_id, key_generation, hmac_key_secret_ref
  ) references public.inbox_v2_source_processing_key_generations (
    tenant_id, purpose_id, generation, secret_ref
  ) deferrable initially deferred;

create or replace function public.inbox_v2_src_runtime_route_generation(
  p_tenant_id text,
  p_source_connection_id text,
  p_source_account_id text
)
returns bigint
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select head_row.route_generation
    from public.inbox_v2_source_registry_heads head_row
   where head_row.tenant_id = p_tenant_id
     and head_row.source_connection_id = p_source_connection_id
     and head_row.state in ('active', 'degraded')
     and head_row.route_authority_state in ('enabled', 'inbound_only')
     and (
       (p_source_account_id is not null
         and head_row.authority_kind = 'source_account'
         and head_row.source_account_id = p_source_account_id)
       or (head_row.authority_kind = 'source_connection'
         and head_row.source_account_id is null)
     )
   order by case when head_row.authority_kind = 'source_account' then 0 else 1 end,
            head_row.revision desc
   limit 1
$function$;

create or replace function public.inbox_v2_src_runtime_route_is_current(
  p_tenant_id text,
  p_source_connection_id text,
  p_source_account_id text,
  p_route_generation bigint
)
returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select coalesce(
    public.inbox_v2_src_runtime_route_generation(
      p_tenant_id,
      p_source_connection_id,
      p_source_account_id
    ) = p_route_generation,
    false
  )
$function$;

create or replace function public.inbox_v2_src_runtime_reject_truncate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception '% cannot be truncated', tg_table_name using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_proc_key_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_secret_purpose text;
begin
  if tg_op <> 'DELETE' then
    select secret_row.purpose into v_secret_purpose
      from public.tenant_secrets secret_row
     where secret_row.tenant_id = new.tenant_id
       and secret_row.secret_ref = new.secret_ref;
    if v_secret_purpose is distinct from
       'inbox_v2.source_processing_hmac' then
      raise exception 'Processing key generation requires an HMAC tenant secret'
        using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.state <> 'active'
       or new.retired_at is not null
       or new.created_at <> new.updated_at then
      raise exception 'Processing key generation must start as active revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.state <> 'retired'
       or clock_timestamp() < old.retired_at
       or exists (
         select 1
           from public.inbox_v2_source_delivery_dedupe_skeletons skeleton_row
          where skeleton_row.tenant_id = old.tenant_id
            and skeleton_row.purpose_id = old.purpose_id
            and skeleton_row.key_generation = old.generation
       )
       or exists (
         select 1
           from public.inbox_v2_source_raw_admissions admission_row
          where admission_row.tenant_id = old.tenant_id
            and admission_row.purpose_id = old.purpose_id
            and admission_row.key_generation = old.generation
            and admission_row.hmac_key_secret_ref = old.secret_ref
       )
       or exists (
         select 1
           from public.inbox_v2_source_raw_quarantines quarantine_row
          where quarantine_row.tenant_id = old.tenant_id
            and quarantine_row.event_identity_key_generation = old.generation
            and quarantine_row.event_identity_hmac_key_secret_ref =
                old.secret_ref
            and quarantine_row.event_identity_guarantee_until >
                clock_timestamp()
       )
       or exists (
         select 1
           from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
          where cursor_row.tenant_id = old.tenant_id
            and cursor_row.purpose_id = old.purpose_id
            and cursor_row.key_generation = old.generation
       ) then
      raise exception 'Processing key generation is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.purpose_id <> old.purpose_id
     or new.generation <> old.generation
     or new.secret_ref <> old.secret_ref
     or new.activated_at <> old.activated_at
     or new.use_until <> old.use_until
     or new.guarantee_not_after <> old.guarantee_not_after
     or new.verify_until <> old.verify_until
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or not (
       (old.state = 'active'
         and new.state = 'verify_only'
         and new.retired_at is null
         and new.updated_at >= old.activated_at)
       or (old.state = 'verify_only'
         and new.state = 'retired'
         and new.retired_at = new.updated_at
         and new.updated_at >= old.verify_until)
     ) then
    raise exception 'Invalid processing key generation transition'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_dedupe_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_key public.inbox_v2_source_processing_key_generations%rowtype;
  v_replay_deadline timestamptz;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       )
       or old.lifecycle_state <> 'expired'
       or clock_timestamp() < old.skeleton_expires_at
       or exists (
         select 1
           from public.inbox_v2_source_raw_admissions admission_row
          where admission_row.tenant_id = old.tenant_id
            and admission_row.state = 'skeleton_handed_off'
            and admission_row.terminal_skeleton_id = old.id
            and admission_row.terminal_outcome_hmac_sha256 =
                old.outcome_hmac_sha256
       ) then
      raise exception 'Dedupe skeleton is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if (to_jsonb(new) - array[
         'replayability_state', 'replay_until',
         'replayability_reason_code_id', 'lifecycle_state', 'expired_at',
         'revision', 'updated_at'
       ]) <> (to_jsonb(old) - array[
         'replayability_state', 'replay_until',
         'replayability_reason_code_id', 'lifecycle_state', 'expired_at',
         'revision', 'updated_at'
       ])
       or new.revision <> old.revision + 1
       or new.updated_at < old.updated_at
       or new.updated_at > clock_timestamp() then
      raise exception 'Dedupe skeleton identity or CAS revision changed'
        using errcode = '23514';
    end if;

    if old.lifecycle_state = 'active'
       and new.lifecycle_state = 'active'
       and old.replayability_state = 'replayable'
       and new.replayability_state = 'expired' then
      v_replay_deadline := case
        when old.phase = 'raw' then least(
          old.replay_until,
          old.raw_payload_expires_at,
          old.allowed_raw_headers_expires_at,
          old.key_verify_until,
          old.guarantee_until
        )
        else least(
          old.replay_until,
          old.normalized_payload_expires_at,
          old.key_verify_until,
          old.guarantee_until
        )
      end;
      if new.replay_until is not null
         or new.replayability_reason_code_id is null
         or new.expired_at is not null
         or new.updated_at < v_replay_deadline
         or clock_timestamp() < v_replay_deadline then
        raise exception 'Invalid dedupe replayability expiry transition'
          using errcode = '23514';
      end if;
      return new;
    end if;

    if old.lifecycle_state = 'active'
       and new.lifecycle_state = 'expired' then
      if old.replayability_state = 'replayable'
         or new.replayability_state <> old.replayability_state
         or new.replay_until is distinct from old.replay_until
         or new.replayability_reason_code_id is distinct from
             old.replayability_reason_code_id
         or new.expired_at <> new.updated_at
         or new.updated_at < new.skeleton_expires_at
         or clock_timestamp() < new.skeleton_expires_at then
        raise exception 'Invalid dedupe skeleton lifecycle expiry transition'
          using errcode = '23514';
      end if;
      return new;
    end if;

    raise exception 'Invalid dedupe skeleton transition'
      using errcode = '23514';
  end if;

  select * into v_key
    from public.inbox_v2_source_processing_key_generations key_row
   where key_row.tenant_id = new.tenant_id
     and key_row.purpose_id = new.purpose_id
     and key_row.generation = new.key_generation;

  if new.revision <> 1
     or new.created_at <> new.updated_at
     or new.replayability_state = 'expired'
     or new.lifecycle_state <> 'active'
     or new.expired_at is not null
     or v_key.generation is null
     or v_key.state not in ('active', 'verify_only')
     or clock_timestamp() >= v_key.verify_until
     or new.terminal_at < v_key.activated_at
     or new.terminal_at >= v_key.use_until
     or new.guarantee_until > v_key.guarantee_not_after
     or new.guarantee_until > v_key.verify_until
     or new.key_verify_until <> v_key.verify_until
     or not public.inbox_v2_src_runtime_route_is_current(
       new.tenant_id,
       new.source_connection_id,
       new.source_account_id,
       new.route_generation
     )
     or (new.normalized_event_id is not null and not exists (
       select 1
         from public.inbox_v2_source_normalized_envelopes normalized_row
        where normalized_row.tenant_id = new.tenant_id
          and normalized_row.normalized_event_id = new.normalized_event_id
          and normalized_row.raw_event_id = new.raw_event_id
          and normalized_row.source_connection_id = new.source_connection_id
          and normalized_row.source_account_id is not distinct from
              new.source_account_id
          and normalized_row.source_account_scope_key =
              new.source_account_scope_key
     )) then
    raise exception 'Dedupe skeleton key, route or target is incoherent'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_expected_work_id text;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or old.state not in (
         'processed', 'ignored', 'duplicate', 'dead_lettered'
       ) then
      raise exception 'Source processing work head is not retention eligible'
        using errcode = '23514';
    end if;
    if exists (
         select 1
           from public.inbox_v2_source_processing_attempts attempt_row
          where attempt_row.tenant_id = old.tenant_id
            and attempt_row.work_id = old.work_id
       ) or exists (
         select 1
           from public.inbox_v2_source_processing_dead_letters dlq_row
          where dlq_row.tenant_id = old.tenant_id
            and dlq_row.work_id = old.work_id
       ) or exists (
         select 1
           from public.inbox_v2_source_replay_requests replay_row
          where replay_row.tenant_id = old.tenant_id
            and (replay_row.target_work_id = old.work_id
              or replay_row.result_work_id = old.work_id)
       ) or exists (
         select 1
           from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
          where cursor_row.tenant_id = old.tenant_id
            and cursor_row.durable_work_id = old.work_id
       ) then
      raise exception 'Source processing work head still has runtime dependents'
        using errcode = '23514';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    v_expected_work_id := 'srcwork:' || encode(sha256(convert_to(
      'source-processing-work:v1|' || new.tenant_id || chr(31) ||
      new.raw_event_id || chr(31) || new.normalized_event_scope_key || chr(31) ||
      new.stage::text, 'UTF8')), 'hex');

    if new.revision <> 1
       or new.processing_generation <> 1
       or new.created_at <> new.updated_at
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       )
       or new.work_id <> v_expected_work_id
       or not (
         (new.stage = 'raw_ingest'
           and new.state = 'processed'
           and new.attempt_count = 0
           and new.completed_at = new.updated_at
           and exists (
             select 1
               from public.inbox_v2_source_raw_work_items raw_work
              where raw_work.tenant_id = new.tenant_id
                and raw_work.raw_event_id = new.raw_event_id
           ))
         or (new.stage <> 'raw_ingest'
           and new.state = 'pending'
           and new.attempt_count = 0
           and new.dead_lettered_at is null
           and new.completed_at is null)
       ) then
      raise exception 'Invalid initial source processing work head'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array[
       'state', 'processing_generation', 'available_at', 'attempt_count',
       'lease_owner_id', 'lease_token_hash', 'lease_revision',
       'lease_claimed_at', 'lease_expires_at', 'last_diagnostic_code_id',
       'retryability', 'rate_limit_reset_at', 'dead_lettered_at',
       'completed_at', 'revision', 'updated_at'
     ]) <> (to_jsonb(old) - array[
       'state', 'processing_generation', 'available_at', 'attempt_count',
       'lease_owner_id', 'lease_token_hash', 'lease_revision',
       'lease_claimed_at', 'lease_expires_at', 'last_diagnostic_code_id',
       'retryability', 'rate_limit_reset_at', 'dead_lettered_at',
       'completed_at', 'revision', 'updated_at'
     ])
     or new.revision <> old.revision + 1
     or new.updated_at <= old.updated_at then
    raise exception 'Source processing work identity or CAS revision changed'
      using errcode = '23514';
  end if;

  if old.state in ('pending', 'retry_scheduled') and new.state = 'leased' then
    if old.available_at > new.updated_at
       or new.attempt_count <> old.attempt_count + 1
       or new.attempt_count > new.max_attempts
       or new.processing_generation <> old.processing_generation
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid source processing lease claim'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased'
     and new.state = 'leased'
     and clock_timestamp() >= old.lease_expires_at then
    if new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count
       or new.available_at <> old.available_at
       or new.lease_token_hash = old.lease_token_hash
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or new.updated_at < old.lease_expires_at
       or new.updated_at > clock_timestamp()
       or new.lease_expires_at <= new.updated_at
       or new.last_diagnostic_code_id is distinct from
           old.last_diagnostic_code_id
       or new.retryability is distinct from old.retryability
       or new.rate_limit_reset_at is distinct from old.rate_limit_reset_at
       or exists (
         select 1
           from public.inbox_v2_source_processing_attempts attempt_row
          where attempt_row.tenant_id = old.tenant_id
            and attempt_row.work_id = old.work_id
            and attempt_row.processing_generation =
                old.processing_generation
            and attempt_row.attempt_number = old.attempt_count
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         new.tenant_id,
         new.source_connection_id,
         new.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid same-attempt expired lease reclaim'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased' and new.state = 'leased' then
    if new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count
       or new.lease_owner_id <> old.lease_owner_id
       or new.lease_token_hash <> old.lease_token_hash
       or new.lease_claimed_at <> old.lease_claimed_at
       or new.lease_revision <> new.revision
       or new.lease_expires_at <= old.lease_expires_at
       or clock_timestamp() >= old.lease_expires_at then
      raise exception 'Invalid source processing lease renewal'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'leased'
     and new.state in (
       'retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered'
     ) then
    if clock_timestamp() >= old.lease_expires_at
       or new.processing_generation <> old.processing_generation
       or new.attempt_count <> old.attempt_count then
      raise exception 'Invalid source processing leased completion'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state = 'dead_lettered' and new.state = 'pending' then
    if new.processing_generation <> old.processing_generation + 1
       or new.attempt_count <> 0
       or new.available_at < new.updated_at
       or new.last_diagnostic_code_id is not null
       or new.retryability is not null
       or new.rate_limit_reset_at is not null
       or new.dead_lettered_at is not null
       or new.completed_at is not null
       or not exists (
         select 1
           from public.inbox_v2_source_replay_requests request_row
           join public.inbox_v2_source_processing_dead_letters dlq_row
             on dlq_row.tenant_id = request_row.tenant_id
            and dlq_row.id = request_row.dead_letter_id
          where request_row.tenant_id = old.tenant_id
            and request_row.target_work_id = old.work_id
            and request_row.raw_event_id = old.raw_event_id
            and request_row.normalized_event_id is not distinct from
                old.normalized_event_id
            and request_row.normalized_event_scope_key =
                old.normalized_event_scope_key
            and request_row.stage = old.stage
            and request_row.source_connection_id = old.source_connection_id
            and request_row.source_account_id is not distinct from
                old.source_account_id
            and request_row.source_account_scope_key =
                old.source_account_scope_key
            and request_row.route_generation = old.route_generation
            and request_row.expected_target_revision = old.revision
            and request_row.state in ('pending', 'leased')
            and request_row.replay_not_after > new.updated_at
            and clock_timestamp() < request_row.replay_not_after
            and dlq_row.work_id = old.work_id
            and dlq_row.raw_event_id = old.raw_event_id
            and dlq_row.stage = old.stage
            and dlq_row.processing_generation = old.processing_generation
            and dlq_row.work_revision = old.revision
       ) then
      raise exception 'Invalid source processing replay reset'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Invalid source processing work transition'
    using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_attempt_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Source processing attempts are immutable'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or clock_timestamp() < old.expires_at then
      raise exception 'Source processing attempt is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.work_id;

  if v_work.work_id is null
     or v_work.raw_event_id <> new.raw_event_id
     or v_work.stage <> new.stage
     or v_work.processing_generation <> new.processing_generation
     or v_work.attempt_count <> new.attempt_number
     or v_work.max_attempts <> new.max_attempts
     or not (
       (v_work.state = 'leased'
         and new.work_revision = v_work.revision + 1
         and new.worker_id = v_work.lease_owner_id
         and new.lease_token_hash = v_work.lease_token_hash
         and new.lease_revision = v_work.lease_revision
         and new.lease_claimed_at = v_work.lease_claimed_at
         and new.lease_expires_at = v_work.lease_expires_at)
       or (v_work.state in (
           'retry_scheduled', 'processed', 'ignored', 'duplicate',
           'dead_lettered'
         ) and new.work_revision = v_work.revision)
     ) then
    raise exception 'Source processing attempt does not close its exact lease'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_dlq_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_attempt public.inbox_v2_source_processing_attempts%rowtype;
begin
  if tg_op = 'UPDATE' then
    raise exception 'Source processing dead-letter facts are immutable'
      using errcode = '23514';
  end if;
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or clock_timestamp() < old.expires_at
       or exists (
         select 1
           from public.inbox_v2_source_replay_requests replay_row
          where replay_row.tenant_id = old.tenant_id
            and replay_row.dead_letter_id = old.id
       ) then
      raise exception 'Source processing dead-letter fact is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  select * into v_attempt
    from public.inbox_v2_source_processing_attempts attempt_row
   where attempt_row.tenant_id = new.tenant_id
     and attempt_row.attempt_id = new.attempt_id;
  if v_attempt.attempt_id is null
     or v_attempt.work_id <> new.work_id
     or v_attempt.raw_event_id <> new.raw_event_id
     or v_attempt.stage <> new.stage
     or v_attempt.processing_generation <> new.processing_generation
     or v_attempt.attempt_number <> new.attempt_number
     or v_attempt.work_revision <> new.work_revision
     or v_attempt.outcome <> 'dead_lettered'
     or v_attempt.diagnostic_code_id <> new.diagnostic_code_id
     or v_attempt.retryability <> new.retryability
     or v_attempt.diagnostic_correlation_token <>
         new.diagnostic_correlation_token
     or v_attempt.diagnostic_safe_operator_hint_id is distinct from
         new.diagnostic_safe_operator_hint_id
     or (new.reason = 'attempts_exhausted'
       and v_attempt.attempt_number <> v_attempt.max_attempts) then
    raise exception 'Dead-letter fact does not match its exact terminal attempt'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_assert_work_closure()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_work_id text;
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_attempt public.inbox_v2_source_processing_attempts%rowtype;
  v_dlq_count bigint;
  v_replay_count bigint;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  v_work_id := coalesce(new.work_id, old.work_id);
  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.work_id = v_work_id;
  if v_work.work_id is null then
    return null;
  end if;

  if v_work.stage = 'raw_ingest'
     and v_work.state = 'processed'
     and v_work.attempt_count = 0 then
    return null;
  end if;

  if v_work.processing_generation > 1
     and v_work.state = 'pending'
     and v_work.attempt_count = 0 then
    select count(*) into v_replay_count
      from public.inbox_v2_source_replay_requests replay_row
     where replay_row.tenant_id = v_work.tenant_id
       and replay_row.state = 'applied'
       and replay_row.result_work_id = v_work.work_id
       and replay_row.result_processing_generation =
           v_work.processing_generation
       and replay_row.result_work_revision = v_work.revision;
    if v_replay_count <> 1 then
      raise exception 'Replay work generation requires one exact applied request'
        using errcode = '23514';
    end if;
  end if;

  if v_work.state not in (
       'retry_scheduled', 'processed', 'ignored', 'duplicate', 'dead_lettered'
     ) then
    return null;
  end if;

  select * into v_attempt
    from public.inbox_v2_source_processing_attempts attempt_row
   where attempt_row.tenant_id = v_work.tenant_id
     and attempt_row.work_id = v_work.work_id
     and attempt_row.processing_generation = v_work.processing_generation
     and attempt_row.attempt_number = v_work.attempt_count
     and attempt_row.work_revision = v_work.revision;

  if v_attempt.attempt_id is null
     or v_attempt.outcome::text <> v_work.state::text
     or v_attempt.diagnostic_code_id is distinct from
         v_work.last_diagnostic_code_id
     or v_attempt.retryability is distinct from v_work.retryability
     or not (
       (v_work.processing_generation = 1 and v_work.attempt_count = 1
         and v_attempt.origin = 'initial')
       or (v_work.processing_generation > 1 and v_work.attempt_count = 1
         and v_attempt.origin = 'replay')
       or (v_work.attempt_count > 1 and v_attempt.origin = 'retry')
     ) then
    raise exception 'Terminal or retry work head requires its exact attempt fact'
      using errcode = '23514';
  end if;

  select count(*) into v_dlq_count
    from public.inbox_v2_source_processing_dead_letters dlq_row
   where dlq_row.tenant_id = v_work.tenant_id
     and dlq_row.work_id = v_work.work_id
     and dlq_row.processing_generation = v_work.processing_generation
     and dlq_row.work_revision = v_work.revision;
  if (v_work.state = 'dead_lettered' and v_dlq_count <> 1)
     or (v_work.state <> 'dead_lettered' and v_dlq_count <> 0) then
    raise exception 'Work head and dead-letter closure are incoherent'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_src_replay_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_scope_key text;
  v_target_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_dlq public.inbox_v2_source_processing_dead_letters%rowtype;
  v_has_evidence boolean;
begin
  if tg_op = 'DELETE' then
    if not pg_catalog.pg_has_role(
         current_user, 'hulee_inbox_v2_retention_owner', 'member'
       ) or old.state not in ('applied', 'denied', 'expired')
       or clock_timestamp() < old.expires_at
       or exists (
         select 1
           from public.inbox_v2_source_processing_work_heads work_row
          where work_row.tenant_id = old.tenant_id
            and work_row.work_id = old.result_work_id
            and work_row.processing_generation =
                old.result_processing_generation
            and work_row.state in ('pending', 'retry_scheduled', 'leased')
       ) then
      raise exception 'Source replay request is not retention eligible'
        using errcode = '23514';
    end if;
    return old;
  end if;

  v_scope_key := case when new.normalized_event_id is null then '0:' else
    '1:' || octet_length(new.normalized_event_id)::text || ':' ||
    new.normalized_event_id end;
  select * into v_target_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.target_work_id;
  select * into v_dlq
    from public.inbox_v2_source_processing_dead_letters dlq_row
   where dlq_row.tenant_id = new.tenant_id
     and dlq_row.id = new.dead_letter_id;

  v_has_evidence := case
    when new.stage in ('raw_ingest', 'normalization') then exists (
      select 1
        from public.inbox_v2_source_raw_evidence evidence_row
       where evidence_row.tenant_id = new.tenant_id
         and evidence_row.raw_event_id = new.raw_event_id
         and evidence_row.evidence_kind = 'provider_payload'
         and evidence_row.purpose_ids ? 'core:source_replay_and_diagnostics'
    )
    else exists (
      select 1
        from public.inbox_v2_source_normalized_evidence_payloads payload_row
        join public.inbox_v2_source_normalized_evidence evidence_row
          on evidence_row.tenant_id = payload_row.tenant_id
         and evidence_row.normalized_event_id = payload_row.normalized_event_id
         and evidence_row.evidence_key = payload_row.evidence_key
       where payload_row.tenant_id = new.tenant_id
         and payload_row.normalized_event_id = new.normalized_event_id
         and evidence_row.purpose_ids ? 'core:source_replay_and_diagnostics'
    )
  end;

  if tg_op = 'INSERT' then
    if new.revision <> 1
       or new.state not in ('pending', 'denied', 'expired')
       or new.requested_at > new.updated_at
       or new.updated_at > clock_timestamp()
       or v_target_work.work_id is null
       or v_target_work.work_id <> new.target_work_id
       or v_target_work.raw_event_id <> new.raw_event_id
       or v_target_work.normalized_event_id is distinct from
           new.normalized_event_id
       or v_target_work.normalized_event_scope_key <> v_scope_key
       or new.normalized_event_scope_key <> v_scope_key
       or v_target_work.stage <> new.stage
       or v_target_work.source_connection_id <> new.source_connection_id
       or v_target_work.source_account_id is distinct from
           new.source_account_id
       or v_target_work.source_account_scope_key <>
           new.source_account_scope_key
       or v_target_work.route_generation <> new.route_generation then
      raise exception 'Replay request target snapshot is incoherent'
        using errcode = '23514';
    end if;

    if new.state = 'pending' and (
      new.dead_letter_id is null
      or v_target_work.state <> 'dead_lettered'
      or v_target_work.revision <> new.expected_target_revision
      or v_dlq.id is null
      or v_dlq.work_id <> v_target_work.work_id
      or v_dlq.raw_event_id <> v_target_work.raw_event_id
      or v_dlq.stage <> v_target_work.stage
      or v_dlq.processing_generation <>
          v_target_work.processing_generation
      or v_dlq.attempt_number <> v_target_work.attempt_count
      or v_dlq.work_revision <> v_target_work.revision
      or v_dlq.recorded_at <> v_target_work.dead_lettered_at
      or new.replay_not_after <> v_dlq.replay_not_after
      or new.expires_at > v_dlq.expires_at
      or new.requested_at <> new.updated_at
      or new.updated_at >= new.replay_not_after
      or clock_timestamp() >= new.replay_not_after
      or not v_has_evidence
      or not public.inbox_v2_src_runtime_route_is_current(
        v_target_work.tenant_id,
        v_target_work.source_connection_id,
        v_target_work.source_account_id,
        new.route_generation
      )
    ) then
      raise exception 'Pending replay request is not currently eligible'
        using errcode = '23514';
    end if;
    if new.state in ('denied', 'expired')
       and new.dead_letter_id is not null
       and (v_dlq.id is null
         or v_dlq.work_id <> v_target_work.work_id
         or v_dlq.raw_event_id <> v_target_work.raw_event_id
         or v_dlq.stage <> v_target_work.stage
         or v_dlq.processing_generation <>
             v_target_work.processing_generation
         or v_dlq.attempt_number <> v_target_work.attempt_count
         or v_dlq.work_revision <> v_target_work.revision
         or v_dlq.recorded_at <> v_target_work.dead_lettered_at
         or new.expires_at > v_dlq.expires_at) then
      raise exception 'Terminal replay DLQ snapshot is incoherent'
        using errcode = '23514';
    end if;
    if new.state = 'expired' and (
      new.completed_at < new.replay_not_after
      or clock_timestamp() < new.replay_not_after
    ) then
      raise exception 'Expired replay decision predates its durable deadline'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if (to_jsonb(new) - array[
       'state', 'available_at', 'lease_owner_id', 'lease_token_hash',
       'lease_revision', 'lease_claimed_at', 'lease_expires_at',
       'result_processing_generation', 'result_replay_episode_id',
       'result_work_id', 'result_work_revision', 'rejection_reason',
       'diagnostic_code_id', 'diagnostic_retryability',
       'diagnostic_correlation_token', 'diagnostic_safe_operator_hint_id',
       'revision', 'updated_at', 'completed_at'
     ]) <> (to_jsonb(old) - array[
       'state', 'available_at', 'lease_owner_id', 'lease_token_hash',
       'lease_revision', 'lease_claimed_at', 'lease_expires_at',
       'result_processing_generation', 'result_replay_episode_id',
       'result_work_id', 'result_work_revision', 'rejection_reason',
       'diagnostic_code_id', 'diagnostic_retryability',
       'diagnostic_correlation_token', 'diagnostic_safe_operator_hint_id',
       'revision', 'updated_at', 'completed_at'
     ])
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or new.updated_at > clock_timestamp()
     or v_target_work.work_id is null
     or v_target_work.raw_event_id <> new.raw_event_id
     or v_target_work.normalized_event_id is distinct from
         new.normalized_event_id
     or v_target_work.normalized_event_scope_key <>
         new.normalized_event_scope_key
     or v_target_work.stage <> new.stage
     or v_target_work.source_connection_id <> new.source_connection_id
     or v_target_work.source_account_id is distinct from new.source_account_id
     or v_target_work.source_account_scope_key <>
         new.source_account_scope_key
     or v_target_work.route_generation <> new.route_generation
     or v_dlq.id is null
     or v_dlq.work_id <> new.target_work_id
     or v_dlq.raw_event_id <> new.raw_event_id
     or v_dlq.stage <> new.stage
     or v_dlq.work_revision <> new.expected_target_revision
     or v_dlq.replay_not_after <> new.replay_not_after
     or new.expires_at > v_dlq.expires_at then
    raise exception 'Replay request identity or CAS revision changed'
      using errcode = '23514';
  end if;

  if old.state = 'pending' and new.state = 'leased' then
    if old.available_at > new.updated_at
       or new.lease_revision <> new.revision
       or new.lease_claimed_at <> new.updated_at
       or new.lease_expires_at > new.replay_not_after
       or new.updated_at >= new.replay_not_after
       or clock_timestamp() >= new.replay_not_after
       or not v_has_evidence
       or not (
         (v_target_work.state = 'dead_lettered'
           and v_target_work.revision = new.expected_target_revision
           and v_target_work.processing_generation =
               v_dlq.processing_generation)
         or (v_target_work.state = 'pending'
           and v_target_work.revision = new.expected_target_revision + 1
           and v_target_work.processing_generation =
               v_dlq.processing_generation + 1)
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid replay request lease claim'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state = 'leased' and new.state = 'leased' then
    if new.lease_owner_id <> old.lease_owner_id
       or new.lease_token_hash <> old.lease_token_hash
       or new.lease_claimed_at <> old.lease_claimed_at
       or new.lease_revision <> new.revision
       or new.lease_expires_at <= old.lease_expires_at
       or new.lease_expires_at > new.replay_not_after
       or clock_timestamp() >= old.lease_expires_at
       or clock_timestamp() >= new.replay_not_after
       or not v_has_evidence
       or not (
         (v_target_work.state = 'dead_lettered'
           and v_target_work.revision = new.expected_target_revision
           and v_target_work.processing_generation =
               v_dlq.processing_generation)
         or (v_target_work.state = 'pending'
           and v_target_work.revision = new.expected_target_revision + 1
           and v_target_work.processing_generation =
               v_dlq.processing_generation + 1)
       )
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Invalid replay request lease renewal'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.state = 'leased' and new.state = 'applied' then
    if clock_timestamp() >= old.lease_expires_at
       or clock_timestamp() >= new.replay_not_after
       or new.updated_at >= new.replay_not_after
       or not v_has_evidence
       or v_target_work.state <> 'pending'
       or v_target_work.work_id <> new.target_work_id
       or new.result_work_id <> new.target_work_id
       or v_target_work.revision <> new.expected_target_revision + 1
       or new.result_work_revision <> new.expected_target_revision + 1
       or new.result_work_revision <> v_target_work.revision
       or v_target_work.processing_generation <>
           v_dlq.processing_generation + 1
       or new.result_processing_generation <>
           v_dlq.processing_generation + 1
       or new.result_processing_generation <>
           v_target_work.processing_generation
       or v_target_work.attempt_count <> 0
       or not public.inbox_v2_src_runtime_route_is_current(
         v_target_work.tenant_id,
         v_target_work.source_connection_id,
         v_target_work.source_account_id,
         new.route_generation
       ) then
      raise exception 'Applied replay does not expose the exact reset target'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if old.state in ('pending', 'leased') and new.state = 'denied' then
    return new;
  end if;

  if old.state in ('pending', 'leased') and new.state = 'expired' then
    if new.completed_at < new.replay_not_after
       or clock_timestamp() < new.replay_not_after then
      raise exception 'Replay request cannot expire before its DB deadline'
        using errcode = '23514';
    end if;
    return new;
  end if;
  raise exception 'Invalid replay request transition' using errcode = '23514';
end
$function$;

create or replace function public.inbox_v2_src_pressure_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Source account pressure heads cannot be deleted'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception 'Pressure head must start at revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if new.tenant_id <> old.tenant_id
     or new.source_connection_id <> old.source_connection_id
     or new.source_account_id is distinct from old.source_account_id
     or new.source_account_scope_key <> old.source_account_scope_key
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at <= old.updated_at then
    raise exception 'Pressure head identity or CAS revision changed'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_assert_pressure()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_connection_id text;
  v_scope_key text;
  v_pressure public.inbox_v2_source_account_pressure_heads%rowtype;
  v_in_flight bigint;
  v_queued bigint;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if tg_table_name = 'inbox_v2_source_processing_work_heads' then
    v_connection_id := coalesce(new.source_connection_id, old.source_connection_id);
    v_scope_key := coalesce(
      new.source_account_scope_key, old.source_account_scope_key
    );
  else
    v_connection_id := coalesce(new.source_connection_id, old.source_connection_id);
    v_scope_key := coalesce(
      new.source_account_scope_key, old.source_account_scope_key
    );
  end if;
  select * into v_pressure
    from public.inbox_v2_source_account_pressure_heads pressure_row
   where pressure_row.tenant_id = v_tenant_id
     and pressure_row.source_connection_id = v_connection_id
     and pressure_row.source_account_scope_key = v_scope_key;
  select count(*) filter (where work_row.state = 'leased'),
         count(*) filter (where work_row.state in ('pending', 'retry_scheduled'))
    into v_in_flight, v_queued
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.source_connection_id = v_connection_id
     and work_row.source_account_scope_key = v_scope_key
     and work_row.stage <> 'raw_ingest';
  if v_pressure.tenant_id is null then
    if v_in_flight <> 0 or v_queued <> 0 then
      raise exception 'Runtime work requires a pressure head'
        using errcode = '23514';
    end if;
    return null;
  end if;
  if v_pressure.in_flight <> v_in_flight
     or v_pressure.queued <> v_queued then
    raise exception 'Pressure head counters do not match durable work heads'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_src_secret_purpose_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.purpose = old.purpose then
    return new;
  end if;
  if exists (
    select 1
      from public.inbox_v2_source_processing_key_generations key_row
     where key_row.tenant_id = old.tenant_id
       and key_row.secret_ref = old.secret_ref
  ) and new.purpose <> 'inbox_v2.source_processing_hmac' then
    raise exception 'Referenced source-processing HMAC secret purpose cannot drift'
      using errcode = '23514';
  end if;
  if exists (
    select 1
      from public.inbox_v2_source_ingress_cursor_checkpoints cursor_row
     where cursor_row.tenant_id = old.tenant_id
       and cursor_row.cursor_value_secret_ref = old.secret_ref
  ) and new.purpose <> 'inbox_v2.source_cursor_value' then
    raise exception 'Referenced source cursor value secret purpose cannot drift'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_cursor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_key public.inbox_v2_source_processing_key_generations%rowtype;
  v_work public.inbox_v2_source_processing_work_heads%rowtype;
  v_quarantine public.inbox_v2_source_raw_quarantines%rowtype;
  v_cursor_secret_purpose text;
begin
  if tg_op = 'DELETE' then
    raise exception 'Ingress cursor checkpoints cannot be deleted'
      using errcode = '23514';
  end if;
  select * into v_key
    from public.inbox_v2_source_processing_key_generations key_row
   where key_row.tenant_id = new.tenant_id
     and key_row.purpose_id = new.purpose_id
     and key_row.generation = new.key_generation;
  select * into v_work
    from public.inbox_v2_source_processing_work_heads work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.work_id = new.durable_work_id;
  select * into v_quarantine
    from public.inbox_v2_source_raw_quarantines quarantine_row
   where quarantine_row.tenant_id = new.tenant_id
     and quarantine_row.id = new.quarantine_id;
  select secret_row.purpose into v_cursor_secret_purpose
    from public.tenant_secrets secret_row
   where secret_row.tenant_id = new.tenant_id
     and secret_row.secret_ref = new.cursor_value_secret_ref;
  if v_key.generation is null
     or v_key.state <> 'active'
     or v_key.secret_ref = new.cursor_value_secret_ref
     or v_cursor_secret_purpose is distinct from
         'inbox_v2.source_cursor_value'
     or new.acknowledged_at < v_key.activated_at
     or new.acknowledged_at >= v_key.use_until
     or (new.durable_target_kind = 'raw_work' and (
       v_work.work_id is null
       or v_work.stage <> 'raw_ingest'
       or v_work.raw_event_id <> new.last_durable_raw_event_id
       or v_work.source_connection_id <> new.source_connection_id
       or v_work.source_account_id is distinct from new.source_account_id
       or v_work.source_account_scope_key <> new.source_account_scope_key
       or v_work.revision <> new.durable_work_revision
       or v_work.state <> new.durable_work_state
       or v_work.updated_at <> new.persisted_at
     ))
     or (new.durable_target_kind = 'quarantine' and (
       v_quarantine.id is null
       or v_quarantine.source_connection_id <> new.source_connection_id
       or v_quarantine.source_account_id is distinct from new.source_account_id
       or v_quarantine.source_account_scope_key <>
          new.source_account_scope_key
       or v_quarantine.quarantine_fingerprint_sha256 <>
          new.quarantine_fingerprint_sha256
       or v_quarantine.recorded_at <> new.persisted_at
     ))
     or not public.inbox_v2_src_runtime_route_is_current(
       new.tenant_id,
       new.source_connection_id,
       new.source_account_id,
       new.route_generation
     )
     or (new.cursor_owner = 'source_thread_binding' and not exists (
       select 1
         from public.inbox_v2_source_thread_bindings binding_row
        where binding_row.tenant_id = new.tenant_id
          and binding_row.id = new.source_thread_binding_id
          and binding_row.source_connection_id = new.source_connection_id
          and binding_row.source_account_id = new.source_account_id
     )) then
    raise exception 'Ingress cursor key, owner or durable target is incoherent'
      using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 then
      raise exception 'Ingress cursor must start at revision 1'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if (to_jsonb(new) - array[
       'route_generation', 'key_generation', 'cursor_value_secret_ref',
       'cursor_hmac_sha256', 'durable_target_kind',
       'last_durable_raw_event_id', 'durable_work_id',
       'durable_work_revision', 'durable_work_state', 'quarantine_id',
       'quarantine_fingerprint_sha256', 'revision',
       'persisted_at', 'acknowledged_at', 'updated_at'
     ]) <> (to_jsonb(old) - array[
       'route_generation', 'key_generation', 'cursor_value_secret_ref',
       'cursor_hmac_sha256', 'durable_target_kind',
       'last_durable_raw_event_id', 'durable_work_id',
       'durable_work_revision', 'durable_work_state', 'quarantine_id',
       'quarantine_fingerprint_sha256', 'revision',
       'persisted_at', 'acknowledged_at', 'updated_at'
     ])
     or new.revision <> old.revision + 1
     or new.persisted_at < old.persisted_at
     or new.acknowledged_at <= old.acknowledged_at
     or new.updated_at <= old.updated_at then
    raise exception 'Ingress cursor owner or monotonic checkpoint changed'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_src_raw_runtime_bridge()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_envelope public.inbox_v2_source_raw_envelopes%rowtype;
  v_route_generation bigint;
  v_raw_work_id text;
begin
  select * into strict v_envelope
    from public.inbox_v2_source_raw_envelopes envelope_row
   where envelope_row.tenant_id = new.tenant_id
     and envelope_row.raw_event_id = new.raw_event_id;
  v_route_generation := public.inbox_v2_src_runtime_route_generation(
    v_envelope.tenant_id,
    v_envelope.source_connection_id,
    v_envelope.source_account_id
  );
  if v_route_generation is null then
    return new;
  end if;
  v_raw_work_id := 'srcwork:' || encode(sha256(convert_to(
    'source-processing-work:v1|' || v_envelope.tenant_id || chr(31) ||
    v_envelope.raw_event_id || chr(31) || '0:' || chr(31) || 'raw_ingest',
    'UTF8')), 'hex');
  insert into public.inbox_v2_source_processing_work_heads (
    tenant_id, work_id, raw_event_id, normalized_event_id,
    normalized_event_scope_key, stage, source_connection_id,
    source_account_id, source_account_scope_key, route_generation, state,
    processing_generation, available_at, max_attempts, attempt_count,
    lease_owner_id, lease_token_hash, lease_revision, lease_claimed_at,
    lease_expires_at, last_diagnostic_code_id, retryability,
    rate_limit_reset_at, dead_lettered_at, completed_at, revision,
    created_at, updated_at
  ) values (
    v_envelope.tenant_id, v_raw_work_id, v_envelope.raw_event_id, null,
    '0:', 'raw_ingest', v_envelope.source_connection_id,
    v_envelope.source_account_id, v_envelope.source_account_scope_key,
    v_route_generation, 'processed', 1, new.available_at, 100, 0,
    null, null, null, null, null, null, null, null, null, new.updated_at,
    1, new.created_at, new.updated_at
  );
  return new;
end
$function$;

create or replace function
  public.inbox_v2_src_runtime_raw_admission_terminal_skeleton_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if new.state <> 'skeleton_handed_off' then
    return new;
  end if;

  -- A later DELETE in the same retention transaction removes the aggregate
  -- obligation; otherwise the exact handed-off admission must still exist.
  if not exists (
    select 1
      from public.inbox_v2_source_raw_admissions current_admission
     where current_admission.tenant_id = new.tenant_id
       and current_admission.purpose_id = new.purpose_id
       and current_admission.key_generation = new.key_generation
       and current_admission.identity_hmac_sha256 =
           new.identity_hmac_sha256
       and current_admission.state = 'skeleton_handed_off'
       and current_admission.revision = new.revision
  ) then
    return new;
  end if;

  if not exists (
    select 1
      from public.inbox_v2_source_delivery_dedupe_skeletons skeleton_row
     where skeleton_row.tenant_id = new.tenant_id
       and skeleton_row.id = new.terminal_skeleton_id
       and skeleton_row.source_connection_id = new.source_connection_id
       and skeleton_row.source_account_id is not distinct from
           new.source_account_id
       and skeleton_row.source_account_scope_key =
           new.source_account_scope_key
       and skeleton_row.phase = 'raw'
       and skeleton_row.raw_event_id = new.raw_event_id
       and skeleton_row.normalized_event_id is null
       and skeleton_row.purpose_id = new.purpose_id
       and skeleton_row.key_generation = new.key_generation
       and skeleton_row.identity_hmac_sha256 = new.identity_hmac_sha256
       and skeleton_row.outcome_hmac_sha256 =
           new.terminal_outcome_hmac_sha256
       and skeleton_row.terminal_at = new.skeleton_handed_off_at
       and skeleton_row.guarantee_until = new.guarantee_until
  ) then
    raise exception 'Raw admission handoff requires its exact terminal skeleton'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

create or replace function
  public.inbox_v2_src_runtime_terminal_skeleton_admission_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_raw_admissions admission_row
     where admission_row.tenant_id = old.tenant_id
       and admission_row.state = 'skeleton_handed_off'
       and admission_row.terminal_skeleton_id = old.id
       and admission_row.purpose_id = old.purpose_id
       and admission_row.key_generation = old.key_generation
       and admission_row.identity_hmac_sha256 = old.identity_hmac_sha256
       and admission_row.terminal_outcome_hmac_sha256 =
           old.outcome_hmac_sha256
  ) then
    raise exception 'Terminal skeleton remains referenced by a raw admission'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

create trigger inbox_v2_src_proc_key_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_key_generations
for each row execute function public.inbox_v2_src_proc_key_guard();

create trigger inbox_v2_src_secret_purpose_guard_trigger
before update of purpose
on public.tenant_secrets
for each row execute function public.inbox_v2_src_secret_purpose_guard();

create trigger inbox_v2_src_dedupe_guard_trigger
before insert or update or delete
on public.inbox_v2_source_delivery_dedupe_skeletons
for each row execute function public.inbox_v2_src_dedupe_guard();

create constraint trigger
  inbox_v2_src_runtime_raw_admission_terminal_skeleton_constraint
after insert or update on public.inbox_v2_source_raw_admissions
deferrable initially deferred
for each row execute function
  public.inbox_v2_src_runtime_raw_admission_terminal_skeleton_coherence();

create constraint trigger
  inbox_v2_src_runtime_terminal_skeleton_admission_constraint
after delete on public.inbox_v2_source_delivery_dedupe_skeletons
deferrable initially deferred
for each row execute function
  public.inbox_v2_src_runtime_terminal_skeleton_admission_coherence();

create trigger inbox_v2_src_work_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_work_heads
for each row execute function public.inbox_v2_src_work_guard();

create trigger inbox_v2_src_attempt_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_attempts
for each row execute function public.inbox_v2_src_attempt_guard();

create trigger inbox_v2_src_dlq_guard_trigger
before insert or update or delete
on public.inbox_v2_source_processing_dead_letters
for each row execute function public.inbox_v2_src_dlq_guard();

create trigger inbox_v2_src_replay_guard_trigger
before insert or update or delete
on public.inbox_v2_source_replay_requests
for each row execute function public.inbox_v2_src_replay_guard();

create trigger inbox_v2_src_pressure_guard_trigger
before insert or update or delete
on public.inbox_v2_source_account_pressure_heads
for each row execute function public.inbox_v2_src_pressure_guard();

create trigger inbox_v2_src_cursor_guard_trigger
before insert or update or delete
on public.inbox_v2_source_ingress_cursor_checkpoints
for each row execute function public.inbox_v2_src_cursor_guard();

create trigger inbox_v2_src_raw_runtime_bridge_trigger
after insert on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_src_raw_runtime_bridge();

create constraint trigger inbox_v2_src_work_closure_from_work
after insert or update on public.inbox_v2_source_processing_work_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_work_closure_from_attempt
after insert on public.inbox_v2_source_processing_attempts
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_work_closure_from_dlq
after insert on public.inbox_v2_source_processing_dead_letters
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_work_closure();

create constraint trigger inbox_v2_src_pressure_closure_from_work
after insert or update on public.inbox_v2_source_processing_work_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_pressure();

create constraint trigger inbox_v2_src_pressure_closure_from_head
after insert or update on public.inbox_v2_source_account_pressure_heads
deferrable initially deferred
for each row execute function public.inbox_v2_src_assert_pressure();

create trigger inbox_v2_src_proc_key_truncate_guard
before truncate on public.inbox_v2_source_processing_key_generations
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_dedupe_truncate_guard
before truncate on public.inbox_v2_source_delivery_dedupe_skeletons
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_work_truncate_guard
before truncate on public.inbox_v2_source_processing_work_heads
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_attempt_truncate_guard
before truncate on public.inbox_v2_source_processing_attempts
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_dlq_truncate_guard
before truncate on public.inbox_v2_source_processing_dead_letters
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_replay_truncate_guard
before truncate on public.inbox_v2_source_replay_requests
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_pressure_truncate_guard
before truncate on public.inbox_v2_source_account_pressure_heads
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();
create trigger inbox_v2_src_cursor_truncate_guard
before truncate on public.inbox_v2_source_ingress_cursor_checkpoints
for each statement execute function public.inbox_v2_src_runtime_reject_truncate();

revoke all privileges on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
from public;

grant select, insert, update on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
to hulee_inbox_v2_runtime;
grant select, insert on table
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters
to hulee_inbox_v2_runtime;
grant select, delete on table
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests
to hulee_inbox_v2_retention_owner;
grant select on table
  public.inbox_v2_source_ingress_cursor_checkpoints
to hulee_inbox_v2_retention_owner;
grant select, update, delete on table
  public.inbox_v2_source_processing_key_generations
to hulee_inbox_v2_retention_owner;
revoke delete, truncate on table
  public.inbox_v2_source_processing_key_generations,
  public.inbox_v2_source_delivery_dedupe_skeletons,
  public.inbox_v2_source_processing_work_heads,
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters,
  public.inbox_v2_source_replay_requests,
  public.inbox_v2_source_account_pressure_heads,
  public.inbox_v2_source_ingress_cursor_checkpoints
from hulee_inbox_v2_runtime;
revoke update, truncate on table
  public.inbox_v2_source_processing_attempts,
  public.inbox_v2_source_processing_dead_letters
from hulee_inbox_v2_retention_owner;
