CREATE TYPE "public"."inbox_v2_deferred_source_action_effect_kind" AS ENUM('message_lifecycle', 'message_reaction', 'message_transport_fact', 'provider_delete_retain_local');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_deferred_source_action_kind" AS ENUM('edit', 'delete', 'reaction', 'delivery', 'receipt');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_deferred_source_action_lane" AS ENUM('message_lifecycle', 'reaction', 'delivery', 'receipt');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_deferred_source_action_ordering_kind" AS ENUM('monotonic_exact', 'incomparable', 'unavailable');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_deferred_source_action_ordering_outcome" AS ENUM('advance', 'stale', 'duplicate', 'conflict', 'not_evaluated');
--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_deferred_source_action_state" AS ENUM('pending', 'applied', 'target_conflicted', 'stale', 'duplicate', 'ordering_conflict', 'expired');
--> statement-breakpoint
CREATE TABLE "inbox_v2_deferred_message_source_action_transitions" (
	"tenant_id" text NOT NULL,
	"action_id" text NOT NULL,
	"expected_revision" bigint NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"after_state" "inbox_v2_deferred_source_action_state" NOT NULL,
	"ordering_outcome" "inbox_v2_deferred_source_action_ordering_outcome" NOT NULL,
	"expected_ordering_head_revision" bigint,
	"resulting_ordering_head_revision" bigint,
	"ordering_head_scope_token" text,
	"ordering_head_comparator_id" text,
	"ordering_head_comparator_revision" bigint,
	"target_external_message_reference_id" text,
	"target_message_id" text,
	"applied_message_revision" bigint,
	"effect_kind" "inbox_v2_deferred_source_action_effect_kind",
	"related_action_id" text,
	"reason_id" text,
	"conflict_candidate_count" smallint DEFAULT 0 NOT NULL,
	"conflict_candidate_digest_sha256" text,
	"source_occurrence_expected_revision" bigint,
	"source_occurrence_resulting_revision" bigint,
	"source_occurrence_resolution_digest_sha256" text,
	"effect_proof_digest_sha256" text,
	"transition_detail" jsonb NOT NULL,
	"transition_detail_digest_sha256" text NOT NULL,
	"commit_digest_sha256" text NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_deferred_action_transitions_pk" PRIMARY KEY("tenant_id","action_id","resulting_revision"),
	CONSTRAINT "inbox_v2_deferred_action_transitions_action_unique" UNIQUE("tenant_id","action_id"),
	CONSTRAINT "inbox_v2_deferred_action_transitions_revision_check" CHECK ("inbox_v2_deferred_message_source_action_transitions"."expected_revision" >= 1
        and "inbox_v2_deferred_message_source_action_transitions"."resulting_revision" = "inbox_v2_deferred_message_source_action_transitions"."expected_revision" + 1
        and "inbox_v2_deferred_message_source_action_transitions"."after_state" <> 'pending'),
	CONSTRAINT "inbox_v2_deferred_action_transitions_ordering_check" CHECK (((
          "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'advance'
          and "inbox_v2_deferred_message_source_action_transitions"."resulting_ordering_head_revision" is not null
          and "inbox_v2_deferred_message_source_action_transitions"."resulting_ordering_head_revision" =
            coalesce("inbox_v2_deferred_message_source_action_transitions"."expected_ordering_head_revision", 0) + 1
        ) or (
          "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" in (
            'stale', 'duplicate', 'conflict', 'not_evaluated'
          )
          and "inbox_v2_deferred_message_source_action_transitions"."expected_ordering_head_revision" is not distinct from
            "inbox_v2_deferred_message_source_action_transitions"."resulting_ordering_head_revision"
          and (
            "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" not in ('stale', 'duplicate')
            or "inbox_v2_deferred_message_source_action_transitions"."expected_ordering_head_revision" is not null
          )
        )) and (
          (
            "inbox_v2_deferred_message_source_action_transitions"."expected_ordering_head_revision" is null
            and "inbox_v2_deferred_message_source_action_transitions"."resulting_ordering_head_revision" is null
            and "inbox_v2_deferred_message_source_action_transitions"."ordering_head_scope_token" is null
            and "inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id" is null
            and "inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_revision" is null
          ) or (
            "inbox_v2_deferred_message_source_action_transitions"."resulting_ordering_head_revision" is not null
            and coalesce((char_length("inbox_v2_deferred_message_source_action_transitions"."ordering_head_scope_token") between 8 and 256
    and "inbox_v2_deferred_message_source_action_transitions"."ordering_head_scope_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
            and coalesce((char_length("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id") <= 256 and (
    ("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
            and "inbox_v2_deferred_message_source_action_transitions"."ordering_head_comparator_revision" >= 1
          )
        )),
	CONSTRAINT "inbox_v2_deferred_action_transitions_state_check" CHECK ((
      "inbox_v2_deferred_message_source_action_transitions"."after_state" = 'applied'
      and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'advance'
      and "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."target_message_id" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision" >= 1
      and "inbox_v2_deferred_message_source_action_transitions"."effect_kind" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision" >= 1
      and "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision" =
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision" + 1
      and coalesce("inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
      and coalesce("inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
      and "inbox_v2_deferred_message_source_action_transitions"."related_action_id" is null
      and "inbox_v2_deferred_message_source_action_transitions"."reason_id" is null
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_count" = 0
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256" is null
    ) or (
      "inbox_v2_deferred_message_source_action_transitions"."after_state" = 'target_conflicted'
      and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'not_evaluated'
      and coalesce((char_length("inbox_v2_deferred_message_source_action_transitions"."reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_count" between 2 and 100
      and coalesce("inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
      and num_nonnulls(
        "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id", "inbox_v2_deferred_message_source_action_transitions"."target_message_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
        "inbox_v2_deferred_message_source_action_transitions"."related_action_id", "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256"
      ) = 0
    ) or (
      "inbox_v2_deferred_message_source_action_transitions"."after_state" in ('stale', 'duplicate')
      and (
        ("inbox_v2_deferred_message_source_action_transitions"."after_state" = 'stale'
          and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'stale')
        or ("inbox_v2_deferred_message_source_action_transitions"."after_state" = 'duplicate'
          and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'duplicate')
      )
      and "inbox_v2_deferred_message_source_action_transitions"."related_action_id" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_count" = 0
      and "inbox_v2_deferred_message_source_action_transitions"."effect_kind" is null
      and "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision" is null
      and "inbox_v2_deferred_message_source_action_transitions"."reason_id" is null
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256" is null
      and "inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256" is null
      and (
        num_nonnulls(
          "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id", "inbox_v2_deferred_message_source_action_transitions"."target_message_id",
          "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
          "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
          "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256"
        ) = 0
        or (
          num_nonnulls(
            "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id", "inbox_v2_deferred_message_source_action_transitions"."target_message_id",
            "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
            "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
            "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256"
          ) = 5
          and "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id" is not null
          and "inbox_v2_deferred_message_source_action_transitions"."target_message_id" is not null
          and "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision" >= 1
          and "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision" =
            "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision" + 1
          and coalesce("inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
        )
      )
    ) or (
      "inbox_v2_deferred_message_source_action_transitions"."after_state" = 'ordering_conflict'
      and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'conflict'
      and coalesce((char_length("inbox_v2_deferred_message_source_action_transitions"."reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_count" = 0
      and num_nonnulls(
        "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id", "inbox_v2_deferred_message_source_action_transitions"."target_message_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
        "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256"
      ) = 0
    ) or (
      "inbox_v2_deferred_message_source_action_transitions"."after_state" = 'expired'
      and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'not_evaluated'
      and coalesce((char_length("inbox_v2_deferred_message_source_action_transitions"."reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_action_transitions"."reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_action_transitions"."reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and "inbox_v2_deferred_message_source_action_transitions"."related_action_id" is null
      and "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_count" = 0
      and num_nonnulls(
        "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id", "inbox_v2_deferred_message_source_action_transitions"."target_message_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
        "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256"
      ) = 0
    )),
	CONSTRAINT "inbox_v2_deferred_action_transitions_detail_check" CHECK ((coalesce((jsonb_typeof("inbox_v2_deferred_message_source_action_transitions"."transition_detail") = 'object'
    and octet_length("inbox_v2_deferred_message_source_action_transitions"."transition_detail"::text) between 2 and 32768), false)
        and coalesce("inbox_v2_deferred_message_source_action_transitions"."transition_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_message_source_action_transitions"."transition_detail") = 'object'
        and coalesce("inbox_v2_deferred_message_source_action_transitions"."commit_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
        and ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" #>> '{action,id}') = "inbox_v2_deferred_message_source_action_transitions"."action_id"
        and ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" #>> '{expectedRevision}') =
          "inbox_v2_deferred_message_source_action_transitions"."expected_revision"::text
        and ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" #>> '{resultingRevision}') =
          "inbox_v2_deferred_message_source_action_transitions"."resulting_revision"::text
        and ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" #>> '{afterState,state}') =
          "inbox_v2_deferred_message_source_action_transitions"."after_state"::text
        and ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" #>> '{orderingOutcome}') =
          "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome"::text
        and not ("inbox_v2_deferred_message_source_action_transitions"."transition_detail" ?| array[
          'body', 'content', 'sender', 'displaySender', 'messageContent',
          'effectProof'
        ])) is true),
	CONSTRAINT "inbox_v2_deferred_action_transitions_clock_check" CHECK (isfinite("inbox_v2_deferred_message_source_action_transitions"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_deferred_message_source_actions" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"message_realm_id" text NOT NULL,
	"message_realm_version" text NOT NULL,
	"message_canonicalization_version" text NOT NULL,
	"message_scope_kind" "inbox_v2_external_message_scope_kind" NOT NULL,
	"message_scope_source_account_id" text,
	"message_scope_source_thread_binding_id" text,
	"message_object_kind_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"canonical_external_subject" text NOT NULL,
	"message_key_digest_sha256" text GENERATED ALWAYS AS (encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        octet_length("message_realm_id")::text || ':' || "message_realm_id" ||
        octet_length("message_realm_version")::text || ':' || "message_realm_version" ||
        octet_length("message_canonicalization_version")::text || ':' || "message_canonicalization_version" ||
        case "message_scope_kind"
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        case when "message_scope_source_account_id" is null then '-1:'
      else octet_length("message_scope_source_account_id")::text || ':' || "message_scope_source_account_id" end ||
        case when "message_scope_source_thread_binding_id" is null then '-1:'
      else octet_length("message_scope_source_thread_binding_id")::text || ':' || "message_scope_source_thread_binding_id" end ||
        octet_length("message_object_kind_id")::text || ':' || "message_object_kind_id" ||
        octet_length("external_thread_id")::text || ':' || "external_thread_id" ||
        octet_length("canonical_external_subject")::text || ':' || "canonical_external_subject",
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )) STORED NOT NULL,
	"external_message_key_detail" jsonb NOT NULL,
	"external_message_key_detail_digest_sha256" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"source_occurrence_revision" bigint NOT NULL,
	"source_occurrence_detail" jsonb NOT NULL,
	"source_occurrence_detail_digest_sha256" text NOT NULL,
	"normalized_inbound_event_id" text NOT NULL,
	"action_kind" "inbox_v2_deferred_source_action_kind" NOT NULL,
	"lane" "inbox_v2_deferred_source_action_lane" NOT NULL,
	"action_detail" jsonb NOT NULL,
	"action_detail_digest_sha256" text NOT NULL,
	"source_account_id" text NOT NULL,
	"source_thread_binding_id" text NOT NULL,
	"binding_generation" bigint NOT NULL,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"adapter_loaded_by_trusted_service_id" text NOT NULL,
	"adapter_loaded_at" timestamp (3) with time zone NOT NULL,
	"capability_id" text NOT NULL,
	"capability_revision" bigint NOT NULL,
	"semantic_id" text NOT NULL,
	"semantic_revision" bigint NOT NULL,
	"actor_source_external_identity_id" text,
	"ordering_kind" "inbox_v2_deferred_source_action_ordering_kind" NOT NULL,
	"ordering_scope_token" text,
	"ordering_position" text,
	"ordering_comparator_id" text,
	"ordering_comparator_revision" bigint,
	"ordering_conflict_token" text,
	"ordering_unavailable_reason_id" text,
	"declared_by_trusted_service_id" text NOT NULL,
	"semantic_proof_token" text NOT NULL,
	"semantic_proof_detail" jsonb NOT NULL,
	"semantic_proof_detail_digest_sha256" text NOT NULL,
	"event_fingerprint_sha256" text NOT NULL,
	"state" "inbox_v2_deferred_source_action_state" DEFAULT 'pending' NOT NULL,
	"applied_external_message_reference_id" text,
	"applied_message_id" text,
	"applied_message_revision" bigint,
	"effect_kind" "inbox_v2_deferred_source_action_effect_kind",
	"related_action_id" text,
	"state_reason_id" text,
	"conflict_candidate_count" smallint DEFAULT 0 NOT NULL,
	"conflict_candidate_digest_sha256" text,
	"terminal_at" timestamp (3) with time zone,
	"data_class_id" text DEFAULT 'core:source_occurrence_and_external_reference' NOT NULL,
	"sensitivity_class" text DEFAULT 'personal_operational' NOT NULL,
	"processing_purpose_id" text DEFAULT 'core:source_replay_and_diagnostics' NOT NULL,
	"canonical_anchor_id" text DEFAULT 'core:terminal_occurrence_or_resolution' NOT NULL,
	"expiry_action" text DEFAULT 'compact_to_safe_skeleton' NOT NULL,
	"revision" bigint DEFAULT 1 NOT NULL,
	"observed_at" timestamp (3) with time zone NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_deferred_actions_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_deferred_actions_replay_unique" UNIQUE("tenant_id","normalized_inbound_event_id","source_occurrence_id","semantic_id","event_fingerprint_sha256"),
	CONSTRAINT "inbox_v2_deferred_actions_ordering_target_unique" UNIQUE("tenant_id","id","message_key_digest_sha256","lane","ordering_scope_token","ordering_comparator_id","ordering_comparator_revision","normalized_inbound_event_id","source_occurrence_id","semantic_id","event_fingerprint_sha256"),
	CONSTRAINT "inbox_v2_deferred_actions_id_check" CHECK (char_length("inbox_v2_deferred_message_source_actions"."id") <= 256
        and "inbox_v2_deferred_message_source_actions"."id" ~ '^deferred_message_source_action:[A-Za-z0-9][A-Za-z0-9._~:-]{0,199}$'),
	CONSTRAINT "inbox_v2_deferred_actions_key_check" CHECK ((coalesce((char_length("inbox_v2_deferred_message_source_actions"."message_realm_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."message_realm_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_realm_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."message_realm_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_realm_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_realm_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."message_realm_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."message_realm_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce("inbox_v2_deferred_message_source_actions"."message_canonicalization_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."message_object_kind_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."message_object_kind_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_object_kind_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."message_object_kind_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_object_kind_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."message_object_kind_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."message_object_kind_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."canonical_external_subject") between 1 and 1024
    and "inbox_v2_deferred_message_source_actions"."canonical_external_subject" ~ '[^[:space:]]'
    and "inbox_v2_deferred_message_source_actions"."canonical_external_subject" !~ '[\x00-\x1F\x7F]'), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."message_key_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce((jsonb_typeof("inbox_v2_deferred_message_source_actions"."external_message_key_detail") = 'object'
    and octet_length("inbox_v2_deferred_message_source_actions"."external_message_key_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."external_message_key_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_message_source_actions"."external_message_key_detail") = 'object'
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{realm,realmId}') =
          "inbox_v2_deferred_message_source_actions"."message_realm_id"
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{realm,realmVersion}') =
          "inbox_v2_deferred_message_source_actions"."message_realm_version"
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>>
          '{realm,canonicalizationVersion}') =
          "inbox_v2_deferred_message_source_actions"."message_canonicalization_version"
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{scope,kind}') =
          "inbox_v2_deferred_message_source_actions"."message_scope_kind"::text
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{scope,owner,id}') is not
          distinct from coalesce(
            "inbox_v2_deferred_message_source_actions"."message_scope_source_account_id",
            "inbox_v2_deferred_message_source_actions"."message_scope_source_thread_binding_id"
          )
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{objectKindId}') =
          "inbox_v2_deferred_message_source_actions"."message_object_kind_id"
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>> '{externalThread,id}') =
          "inbox_v2_deferred_message_source_actions"."external_thread_id"
        and ("inbox_v2_deferred_message_source_actions"."external_message_key_detail" #>>
          '{canonicalExternalSubject}') = "inbox_v2_deferred_message_source_actions"."canonical_external_subject")
        is true),
	CONSTRAINT "inbox_v2_deferred_actions_scope_check" CHECK ((
          "inbox_v2_deferred_message_source_actions"."message_scope_kind" = 'provider_thread'
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_account_id" is null
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_deferred_message_source_actions"."message_scope_kind" = 'source_account'
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_account_id" is not null
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_deferred_message_source_actions"."message_scope_kind" = 'source_thread_binding'
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_account_id" is null
          and "inbox_v2_deferred_message_source_actions"."message_scope_source_thread_binding_id" is not null
        )),
	CONSTRAINT "inbox_v2_deferred_actions_detail_check" CHECK (("inbox_v2_deferred_message_source_actions"."source_occurrence_revision" >= 1
        and coalesce((jsonb_typeof("inbox_v2_deferred_message_source_actions"."source_occurrence_detail") = 'object'
    and octet_length("inbox_v2_deferred_message_source_actions"."source_occurrence_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."source_occurrence_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_message_source_actions"."source_occurrence_detail") = 'object'
        and ("inbox_v2_deferred_message_source_actions"."source_occurrence_detail" #>> '{tenantId}') = "inbox_v2_deferred_message_source_actions"."tenant_id"
        and ("inbox_v2_deferred_message_source_actions"."source_occurrence_detail" #>> '{id}') =
          "inbox_v2_deferred_message_source_actions"."source_occurrence_id"
        and ("inbox_v2_deferred_message_source_actions"."source_occurrence_detail" #>> '{revision}') =
          "inbox_v2_deferred_message_source_actions"."source_occurrence_revision"::text
        and coalesce((jsonb_typeof("inbox_v2_deferred_message_source_actions"."action_detail") = 'object'
    and octet_length("inbox_v2_deferred_message_source_actions"."action_detail"::text) between 2 and 32768), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."action_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_message_source_actions"."action_detail") = 'object'
        and ("inbox_v2_deferred_message_source_actions"."action_detail" #>> '{kind}') = "inbox_v2_deferred_message_source_actions"."action_kind"::text
        and ("inbox_v2_deferred_message_source_actions"."action_detail" #>> '{normalizedEvent,id}') =
          "inbox_v2_deferred_message_source_actions"."normalized_inbound_event_id"
        and not ("inbox_v2_deferred_message_source_actions"."action_detail" ?| array[
          'body', 'content', 'sender', 'displaySender', 'messageContent'
        ])) is true),
	CONSTRAINT "inbox_v2_deferred_actions_lane_check" CHECK ((
          "inbox_v2_deferred_message_source_actions"."action_kind" in ('edit', 'delete')
          and "inbox_v2_deferred_message_source_actions"."lane" = 'message_lifecycle'
        ) or ("inbox_v2_deferred_message_source_actions"."action_kind" = 'reaction' and "inbox_v2_deferred_message_source_actions"."lane" = 'reaction')
          or ("inbox_v2_deferred_message_source_actions"."action_kind" = 'delivery' and "inbox_v2_deferred_message_source_actions"."lane" = 'delivery')
          or ("inbox_v2_deferred_message_source_actions"."action_kind" = 'receipt' and "inbox_v2_deferred_message_source_actions"."lane" = 'receipt')),
	CONSTRAINT "inbox_v2_deferred_actions_semantic_check" CHECK ((coalesce((char_length("inbox_v2_deferred_message_source_actions"."adapter_contract_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."adapter_contract_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_contract_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."adapter_contract_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_contract_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_contract_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."adapter_contract_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."adapter_contract_version" ~ '^v[1-9][0-9]*$', false)
        and "inbox_v2_deferred_message_source_actions"."adapter_declaration_revision" >= 1
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."adapter_surface_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."adapter_surface_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_surface_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."adapter_surface_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_surface_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_surface_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."adapter_surface_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."capability_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."capability_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."capability_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."capability_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."capability_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."capability_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."capability_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_deferred_message_source_actions"."capability_revision" >= 1
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."semantic_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."semantic_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."semantic_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."semantic_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."semantic_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."semantic_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."semantic_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_deferred_message_source_actions"."semantic_revision" >= 1
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_deferred_message_source_actions"."semantic_proof_token") between 8 and 256
    and "inbox_v2_deferred_message_source_actions"."semantic_proof_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((jsonb_typeof("inbox_v2_deferred_message_source_actions"."semantic_proof_detail") = 'object'
    and octet_length("inbox_v2_deferred_message_source_actions"."semantic_proof_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_deferred_message_source_actions"."semantic_proof_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_message_source_actions"."semantic_proof_detail") = 'object'
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{tenantId}') = "inbox_v2_deferred_message_source_actions"."tenant_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{normalizedInboundEvent,id}') = "inbox_v2_deferred_message_source_actions"."normalized_inbound_event_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{normalizedInboundEvent,tenantId}') = "inbox_v2_deferred_message_source_actions"."tenant_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" -> 'externalMessageReference') =
          'null'::jsonb
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" -> 'sourceOccurrence') =
          'null'::jsonb
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{sourceAccount,id}') =
          "inbox_v2_deferred_message_source_actions"."source_account_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{sourceAccount,tenantId}') =
          "inbox_v2_deferred_message_source_actions"."tenant_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{sourceThreadBinding,id}') =
          "inbox_v2_deferred_message_source_actions"."source_thread_binding_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{sourceThreadBinding,tenantId}') = "inbox_v2_deferred_message_source_actions"."tenant_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{bindingGeneration}') =
          "inbox_v2_deferred_message_source_actions"."binding_generation"::text
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,contractId}') = "inbox_v2_deferred_message_source_actions"."adapter_contract_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,contractVersion}') = "inbox_v2_deferred_message_source_actions"."adapter_contract_version"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,declarationRevision}') =
          "inbox_v2_deferred_message_source_actions"."adapter_declaration_revision"::text
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,surfaceId}') = "inbox_v2_deferred_message_source_actions"."adapter_surface_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,loadedByTrustedServiceId}') =
          "inbox_v2_deferred_message_source_actions"."adapter_loaded_by_trusted_service_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{adapterContract,loadedAt}')::timestamptz = "inbox_v2_deferred_message_source_actions"."adapter_loaded_at"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{capabilityId}') =
          "inbox_v2_deferred_message_source_actions"."capability_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{capabilityRevision}') =
          "inbox_v2_deferred_message_source_actions"."capability_revision"::text
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{semanticId}') =
          "inbox_v2_deferred_message_source_actions"."semantic_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{semanticRevision}') =
          "inbox_v2_deferred_message_source_actions"."semantic_revision"::text
        and "inbox_v2_deferred_message_source_actions"."semantic_proof_detail" ? 'actor'
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{actor,id}') is not distinct from
          "inbox_v2_deferred_message_source_actions"."actor_source_external_identity_id"
        and (
          "inbox_v2_deferred_message_source_actions"."actor_source_external_identity_id" is null
          or ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{actor,tenantId}') =
            "inbox_v2_deferred_message_source_actions"."tenant_id"
        )
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" -> 'ordering') = case
          when "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'monotonic_exact' then
            jsonb_build_object(
              'kind', 'monotonic_exact',
              'scopeToken', "inbox_v2_deferred_message_source_actions"."ordering_scope_token",
              'position', "inbox_v2_deferred_message_source_actions"."ordering_position",
              'comparatorId', "inbox_v2_deferred_message_source_actions"."ordering_comparator_id",
              'comparatorRevision', "inbox_v2_deferred_message_source_actions"."ordering_comparator_revision"::text
            )
          when "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'incomparable' then
            jsonb_build_object(
              'kind', 'incomparable',
              'conflictToken', "inbox_v2_deferred_message_source_actions"."ordering_conflict_token"
            )
          when "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'unavailable' then
            jsonb_build_object(
              'kind', 'unavailable',
              'reasonId', "inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id"
            )
        end
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>>
          '{declaredByTrustedServiceId}') =
          "inbox_v2_deferred_message_source_actions"."declared_by_trusted_service_id"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{proofToken}') =
          "inbox_v2_deferred_message_source_actions"."semantic_proof_token"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{occurredAt}')::timestamptz =
          "inbox_v2_deferred_message_source_actions"."observed_at"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{recordedAt}')::timestamptz =
          "inbox_v2_deferred_message_source_actions"."recorded_at"
        and ("inbox_v2_deferred_message_source_actions"."semantic_proof_detail" #>> '{revision}') = '1') is true),
	CONSTRAINT "inbox_v2_deferred_actions_ordering_check" CHECK ((
          "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'monotonic_exact'
          and coalesce((char_length("inbox_v2_deferred_message_source_actions"."ordering_scope_token") between 8 and 256
    and "inbox_v2_deferred_message_source_actions"."ordering_scope_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
          and coalesce((char_length("inbox_v2_deferred_message_source_actions"."ordering_position") between 1 and 128
    and "inbox_v2_deferred_message_source_actions"."ordering_position" ~ '^(0|[1-9][0-9]*)$'), false)
          and coalesce((char_length("inbox_v2_deferred_message_source_actions"."ordering_comparator_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."ordering_comparator_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_comparator_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."ordering_comparator_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_comparator_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_comparator_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."ordering_comparator_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
          and "inbox_v2_deferred_message_source_actions"."ordering_comparator_revision" >= 1
          and "inbox_v2_deferred_message_source_actions"."ordering_conflict_token" is null
          and "inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id" is null
        ) or (
          "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'incomparable'
          and coalesce((char_length("inbox_v2_deferred_message_source_actions"."ordering_conflict_token") between 8 and 256
    and "inbox_v2_deferred_message_source_actions"."ordering_conflict_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
          and num_nonnulls(
            "inbox_v2_deferred_message_source_actions"."ordering_scope_token", "inbox_v2_deferred_message_source_actions"."ordering_position",
            "inbox_v2_deferred_message_source_actions"."ordering_comparator_id",
            "inbox_v2_deferred_message_source_actions"."ordering_comparator_revision",
            "inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id"
          ) = 0
        ) or (
          "inbox_v2_deferred_message_source_actions"."ordering_kind" = 'unavailable'
          and coalesce((char_length("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."ordering_unavailable_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
          and num_nonnulls(
            "inbox_v2_deferred_message_source_actions"."ordering_scope_token", "inbox_v2_deferred_message_source_actions"."ordering_position",
            "inbox_v2_deferred_message_source_actions"."ordering_comparator_id",
            "inbox_v2_deferred_message_source_actions"."ordering_comparator_revision",
            "inbox_v2_deferred_message_source_actions"."ordering_conflict_token"
          ) = 0
        )),
	CONSTRAINT "inbox_v2_deferred_actions_replay_check" CHECK ((coalesce("inbox_v2_deferred_message_source_actions"."event_fingerprint_sha256" ~ '^[a-f0-9]{64}$', false)
        and ("inbox_v2_deferred_message_source_actions"."semantic_id" = case "inbox_v2_deferred_message_source_actions"."action_kind"
          when 'edit' then 'core:message.lifecycle.edit.observed'
          when 'delete' then 'core:message.lifecycle.delete.observed'
          when 'reaction' then 'core:message.reaction.' ||
            ("inbox_v2_deferred_message_source_actions"."action_detail" #>> '{operation}')
          when 'delivery' then 'core:message.delivery.' ||
            ("inbox_v2_deferred_message_source_actions"."action_detail" #>> '{fact}')
          when 'receipt' then 'core:message.receipt.read'
        end)) is true),
	CONSTRAINT "inbox_v2_deferred_actions_state_check" CHECK ((
      "inbox_v2_deferred_message_source_actions"."state" = 'pending'
      and "inbox_v2_deferred_message_source_actions"."revision" = 1
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."related_action_id", "inbox_v2_deferred_message_source_actions"."state_reason_id",
        "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256", "inbox_v2_deferred_message_source_actions"."terminal_at"
      ) = 0
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" = 0
    ) or (
      "inbox_v2_deferred_message_source_actions"."state" = 'applied'
      and "inbox_v2_deferred_message_source_actions"."revision" = 2
      and "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id" is not null
      and "inbox_v2_deferred_message_source_actions"."applied_message_id" is not null
      and "inbox_v2_deferred_message_source_actions"."applied_message_revision" >= 1
      and "inbox_v2_deferred_message_source_actions"."effect_kind" is not null
      and "inbox_v2_deferred_message_source_actions"."related_action_id" is null
      and "inbox_v2_deferred_message_source_actions"."state_reason_id" is null
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" = 0
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256" is null
      and isfinite("inbox_v2_deferred_message_source_actions"."terminal_at")
    ) or (
      "inbox_v2_deferred_message_source_actions"."state" = 'target_conflicted'
      and "inbox_v2_deferred_message_source_actions"."revision" = 2
      and coalesce((char_length("inbox_v2_deferred_message_source_actions"."state_reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" between 2 and 100
      and coalesce("inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
      and isfinite("inbox_v2_deferred_message_source_actions"."terminal_at")
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."related_action_id"
      ) = 0
    ) or (
      "inbox_v2_deferred_message_source_actions"."state" in ('stale', 'duplicate')
      and "inbox_v2_deferred_message_source_actions"."revision" = 2
      and "inbox_v2_deferred_message_source_actions"."related_action_id" is not null
      and "inbox_v2_deferred_message_source_actions"."related_action_id" <> "inbox_v2_deferred_message_source_actions"."id"
      and isfinite("inbox_v2_deferred_message_source_actions"."terminal_at")
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" = 0
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."state_reason_id", "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256"
      ) = 0
    ) or (
      "inbox_v2_deferred_message_source_actions"."state" = 'ordering_conflict'
      and "inbox_v2_deferred_message_source_actions"."revision" = 2
      and coalesce((char_length("inbox_v2_deferred_message_source_actions"."state_reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and ("inbox_v2_deferred_message_source_actions"."related_action_id" is null or "inbox_v2_deferred_message_source_actions"."related_action_id" <>
        "inbox_v2_deferred_message_source_actions"."id")
      and isfinite("inbox_v2_deferred_message_source_actions"."terminal_at")
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" = 0
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256"
      ) = 0
    ) or (
      "inbox_v2_deferred_message_source_actions"."state" = 'expired'
      and "inbox_v2_deferred_message_source_actions"."revision" = 2
      and coalesce((char_length("inbox_v2_deferred_message_source_actions"."state_reason_id") <= 256 and (
    ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_message_source_actions"."state_reason_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_message_source_actions"."state_reason_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
      and isfinite("inbox_v2_deferred_message_source_actions"."terminal_at")
      and "inbox_v2_deferred_message_source_actions"."conflict_candidate_count" = 0
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."related_action_id", "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256"
      ) = 0
    )),
	CONSTRAINT "inbox_v2_deferred_actions_governance_check" CHECK ("inbox_v2_deferred_message_source_actions"."data_class_id" =
          'core:source_occurrence_and_external_reference'
        and "inbox_v2_deferred_message_source_actions"."sensitivity_class" = 'personal_operational'
        and "inbox_v2_deferred_message_source_actions"."processing_purpose_id" =
          'core:source_replay_and_diagnostics'
        and "inbox_v2_deferred_message_source_actions"."canonical_anchor_id" =
          'core:terminal_occurrence_or_resolution'
        and "inbox_v2_deferred_message_source_actions"."expiry_action" = 'compact_to_safe_skeleton'),
	CONSTRAINT "inbox_v2_deferred_actions_clock_check" CHECK ("inbox_v2_deferred_message_source_actions"."binding_generation" >= 1
        and isfinite("inbox_v2_deferred_message_source_actions"."adapter_loaded_at")
        and isfinite("inbox_v2_deferred_message_source_actions"."observed_at")
        and isfinite("inbox_v2_deferred_message_source_actions"."recorded_at")
        and isfinite("inbox_v2_deferred_message_source_actions"."created_at")
        and isfinite("inbox_v2_deferred_message_source_actions"."updated_at")
        and "inbox_v2_deferred_message_source_actions"."adapter_loaded_at" <= "inbox_v2_deferred_message_source_actions"."recorded_at"
        and "inbox_v2_deferred_message_source_actions"."observed_at" <= "inbox_v2_deferred_message_source_actions"."recorded_at"
        and "inbox_v2_deferred_message_source_actions"."recorded_at" = "inbox_v2_deferred_message_source_actions"."created_at"
        and "inbox_v2_deferred_message_source_actions"."created_at" <= "inbox_v2_deferred_message_source_actions"."updated_at"
        and "inbox_v2_deferred_message_source_actions"."revision" >= 1)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_deferred_source_action_conflict_candidates" (
	"tenant_id" text NOT NULL,
	"action_id" text NOT NULL,
	"resulting_revision" bigint NOT NULL,
	"ordinal" smallint NOT NULL,
	"external_message_reference_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"timeline_item_id" text NOT NULL,
	"message_id" text NOT NULL,
	"message_key_digest_sha256" text NOT NULL,
	"candidate_detail" jsonb NOT NULL,
	"candidate_detail_digest_sha256" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_deferred_action_candidates_pk" PRIMARY KEY("tenant_id","action_id","ordinal"),
	CONSTRAINT "inbox_v2_deferred_action_candidates_reference_unique" UNIQUE("tenant_id","action_id","external_message_reference_id"),
	CONSTRAINT "inbox_v2_deferred_action_candidates_values_check" CHECK (("inbox_v2_deferred_source_action_conflict_candidates"."resulting_revision" >= 2
        and "inbox_v2_deferred_source_action_conflict_candidates"."ordinal" between 0 and 99
        and coalesce("inbox_v2_deferred_source_action_conflict_candidates"."message_key_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce((jsonb_typeof("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail") = 'object'
    and octet_length("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail") = 'object'
        and ("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail" #>> '{tenantId}') = "inbox_v2_deferred_source_action_conflict_candidates"."tenant_id"
        and ("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail" #>> '{id}') =
          "inbox_v2_deferred_source_action_conflict_candidates"."external_message_reference_id"
        and ("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail" #>> '{externalThread,id}') =
          "inbox_v2_deferred_source_action_conflict_candidates"."external_thread_id"
        and ("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail" #>> '{timelineItem,id}') =
          "inbox_v2_deferred_source_action_conflict_candidates"."timeline_item_id"
        and ("inbox_v2_deferred_source_action_conflict_candidates"."candidate_detail" #>> '{message,id}') = "inbox_v2_deferred_source_action_conflict_candidates"."message_id"
        and isfinite("inbox_v2_deferred_source_action_conflict_candidates"."created_at")) is true)
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_deferred_source_action_ordering_heads" (
	"tenant_id" text NOT NULL,
	"message_key_digest_sha256" text GENERATED ALWAYS AS (encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        octet_length("message_realm_id")::text || ':' || "message_realm_id" ||
        octet_length("message_realm_version")::text || ':' || "message_realm_version" ||
        octet_length("message_canonicalization_version")::text || ':' || "message_canonicalization_version" ||
        case "message_scope_kind"
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        case when "message_scope_source_account_id" is null then '-1:'
      else octet_length("message_scope_source_account_id")::text || ':' || "message_scope_source_account_id" end ||
        case when "message_scope_source_thread_binding_id" is null then '-1:'
      else octet_length("message_scope_source_thread_binding_id")::text || ':' || "message_scope_source_thread_binding_id" end ||
        octet_length("message_object_kind_id")::text || ':' || "message_object_kind_id" ||
        octet_length("external_thread_id")::text || ':' || "external_thread_id" ||
        octet_length("canonical_external_subject")::text || ':' || "canonical_external_subject",
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )) STORED NOT NULL,
	"message_realm_id" text NOT NULL,
	"message_realm_version" text NOT NULL,
	"message_canonicalization_version" text NOT NULL,
	"message_scope_kind" "inbox_v2_external_message_scope_kind" NOT NULL,
	"message_scope_source_account_id" text,
	"message_scope_source_thread_binding_id" text,
	"message_object_kind_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"canonical_external_subject" text NOT NULL,
	"external_message_key_detail" jsonb NOT NULL,
	"external_message_key_detail_digest_sha256" text NOT NULL,
	"lane" "inbox_v2_deferred_source_action_lane" NOT NULL,
	"scope_token" text NOT NULL,
	"comparator_id" text NOT NULL,
	"comparator_revision" bigint NOT NULL,
	"latest_action_id" text NOT NULL,
	"latest_normalized_inbound_event_id" text NOT NULL,
	"latest_source_occurrence_id" text NOT NULL,
	"latest_semantic_id" text NOT NULL,
	"latest_event_fingerprint_sha256" text NOT NULL,
	"latest_position" text NOT NULL,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_deferred_action_ordering_heads_pk" PRIMARY KEY("tenant_id","message_key_digest_sha256","lane","scope_token","comparator_id","comparator_revision"),
	CONSTRAINT "inbox_v2_deferred_action_ordering_heads_key_check" CHECK ((coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id") <= 256 and (
    ("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_source_action_ordering_heads"."message_realm_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_deferred_source_action_ordering_heads"."message_realm_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce("inbox_v2_deferred_source_action_ordering_heads"."message_canonicalization_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id") <= 256 and (
    ("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."canonical_external_subject") between 1 and 1024
    and "inbox_v2_deferred_source_action_ordering_heads"."canonical_external_subject" ~ '[^[:space:]]'
    and "inbox_v2_deferred_source_action_ordering_heads"."canonical_external_subject" !~ '[\x00-\x1F\x7F]'), false)
        and coalesce("inbox_v2_deferred_source_action_ordering_heads"."message_key_digest_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce((jsonb_typeof("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail") = 'object'
    and octet_length("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail") = 'object'
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{realm,realmId}') =
          "inbox_v2_deferred_source_action_ordering_heads"."message_realm_id"
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{realm,realmVersion}') =
          "inbox_v2_deferred_source_action_ordering_heads"."message_realm_version"
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>>
          '{realm,canonicalizationVersion}') =
          "inbox_v2_deferred_source_action_ordering_heads"."message_canonicalization_version"
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{scope,kind}') =
          "inbox_v2_deferred_source_action_ordering_heads"."message_scope_kind"::text
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{scope,owner,id}') is not
          distinct from coalesce(
            "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_account_id",
            "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_thread_binding_id"
          )
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{objectKindId}') =
          "inbox_v2_deferred_source_action_ordering_heads"."message_object_kind_id"
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>> '{externalThread,id}') =
          "inbox_v2_deferred_source_action_ordering_heads"."external_thread_id"
        and ("inbox_v2_deferred_source_action_ordering_heads"."external_message_key_detail" #>>
          '{canonicalExternalSubject}') = "inbox_v2_deferred_source_action_ordering_heads"."canonical_external_subject")
        is true),
	CONSTRAINT "inbox_v2_deferred_action_ordering_heads_scope_check" CHECK ((
          "inbox_v2_deferred_source_action_ordering_heads"."message_scope_kind" = 'provider_thread'
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_account_id" is null
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_deferred_source_action_ordering_heads"."message_scope_kind" = 'source_account'
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_account_id" is not null
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_deferred_source_action_ordering_heads"."message_scope_kind" = 'source_thread_binding'
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_account_id" is null
          and "inbox_v2_deferred_source_action_ordering_heads"."message_scope_source_thread_binding_id" is not null
        )),
	CONSTRAINT "inbox_v2_deferred_action_ordering_heads_values_check" CHECK (coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."scope_token") between 8 and 256
    and "inbox_v2_deferred_source_action_ordering_heads"."scope_token" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'), false)
        and coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."comparator_id") <= 256 and (
    ("inbox_v2_deferred_source_action_ordering_heads"."comparator_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."comparator_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_source_action_ordering_heads"."comparator_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."comparator_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."comparator_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_source_action_ordering_heads"."comparator_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and "inbox_v2_deferred_source_action_ordering_heads"."comparator_revision" >= 1
        and coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id") <= 256 and (
    ("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id", ':', 2)) <= 160)
    or ("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id", ':', 3)) <= 160
      and split_part("inbox_v2_deferred_source_action_ordering_heads"."latest_semantic_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_deferred_source_action_ordering_heads"."latest_event_fingerprint_sha256" ~ '^[a-f0-9]{64}$', false)
        and coalesce((char_length("inbox_v2_deferred_source_action_ordering_heads"."latest_position") between 1 and 128
    and "inbox_v2_deferred_source_action_ordering_heads"."latest_position" ~ '^(0|[1-9][0-9]*)$'), false)
        and "inbox_v2_deferred_source_action_ordering_heads"."revision" >= 1
        and isfinite("inbox_v2_deferred_source_action_ordering_heads"."created_at")
        and isfinite("inbox_v2_deferred_source_action_ordering_heads"."updated_at")
        and "inbox_v2_deferred_source_action_ordering_heads"."updated_at" >= "inbox_v2_deferred_source_action_ordering_heads"."created_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_message_correlation_evidence" (
	"tenant_id" text NOT NULL,
	"source_occurrence_id" text NOT NULL,
	"ordinal" smallint NOT NULL,
	"code_id" text NOT NULL,
	"evidence_hmac_sha256" text NOT NULL,
	"expires_at" timestamp (3) with time zone NOT NULL,
	"data_class_id" text DEFAULT 'core:operational_log_trace_diagnostic' NOT NULL,
	"sensitivity_class" text DEFAULT 'security_evidence' NOT NULL,
	"processing_purpose_id" text DEFAULT 'core:source_replay_and_diagnostics' NOT NULL,
	"canonical_anchor_id" text DEFAULT 'core:creation' NOT NULL,
	"expiry_action" text DEFAULT 'hard_delete' NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_message_correlation_evidence_pk" PRIMARY KEY("tenant_id","source_occurrence_id","ordinal"),
	CONSTRAINT "inbox_v2_source_message_correlation_evidence_identity_unique" UNIQUE("tenant_id","source_occurrence_id","code_id","evidence_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_message_correlation_evidence_values_check" CHECK ("inbox_v2_source_message_correlation_evidence"."ordinal" between 0 and 7
        and coalesce((char_length("inbox_v2_source_message_correlation_evidence"."code_id") <= 256 and (
    ("inbox_v2_source_message_correlation_evidence"."code_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_correlation_evidence"."code_id", ':', 2)) <= 160)
    or ("inbox_v2_source_message_correlation_evidence"."code_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_correlation_evidence"."code_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_message_correlation_evidence"."code_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_message_correlation_evidence"."code_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_source_message_correlation_evidence"."evidence_hmac_sha256" ~ '^hmac-sha256:[a-f0-9]{64}$', false)
        and isfinite("inbox_v2_source_message_correlation_evidence"."created_at")
        and isfinite("inbox_v2_source_message_correlation_evidence"."expires_at")
        and "inbox_v2_source_message_correlation_evidence"."expires_at" > "inbox_v2_source_message_correlation_evidence"."created_at"
        and "inbox_v2_source_message_correlation_evidence"."expires_at" <= "inbox_v2_source_message_correlation_evidence"."created_at" + interval '30 days'),
	CONSTRAINT "inbox_v2_source_message_correlation_evidence_governance_check" CHECK ("inbox_v2_source_message_correlation_evidence"."data_class_id" =
          'core:operational_log_trace_diagnostic'
        and "inbox_v2_source_message_correlation_evidence"."sensitivity_class" = 'security_evidence'
        and "inbox_v2_source_message_correlation_evidence"."processing_purpose_id" =
          'core:source_replay_and_diagnostics'
        and "inbox_v2_source_message_correlation_evidence"."canonical_anchor_id" = 'core:creation'
        and "inbox_v2_source_message_correlation_evidence"."expiry_action" = 'hard_delete')
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_message_key_registry" (
	"tenant_id" text NOT NULL,
	"message_key_digest_sha256" text GENERATED ALWAYS AS (encode(
    sha256(
      replace(
        'external-message-key:v1|' ||
        octet_length("message_realm_id")::text || ':' || "message_realm_id" ||
        octet_length("message_realm_version")::text || ':' || "message_realm_version" ||
        octet_length("message_canonicalization_version")::text || ':' || "message_canonicalization_version" ||
        case "message_scope_kind"
          when 'provider_thread' then '15:provider_thread'
          when 'source_account' then '14:source_account'
          when 'source_thread_binding' then '21:source_thread_binding'
        end ||
        case when "message_scope_source_account_id" is null then '-1:'
      else octet_length("message_scope_source_account_id")::text || ':' || "message_scope_source_account_id" end ||
        case when "message_scope_source_thread_binding_id" is null then '-1:'
      else octet_length("message_scope_source_thread_binding_id")::text || ':' || "message_scope_source_thread_binding_id" end ||
        octet_length("message_object_kind_id")::text || ':' || "message_object_kind_id" ||
        octet_length("external_thread_id")::text || ':' || "external_thread_id" ||
        octet_length("canonical_external_subject")::text || ':' || "canonical_external_subject",
        chr(92),
        chr(92) || chr(92)
      )::bytea
    ),
    'hex'
  )) STORED NOT NULL,
	"message_realm_id" text NOT NULL,
	"message_realm_version" text NOT NULL,
	"message_canonicalization_version" text NOT NULL,
	"message_scope_kind" "inbox_v2_external_message_scope_kind" NOT NULL,
	"message_scope_source_account_id" text,
	"message_scope_source_thread_binding_id" text,
	"message_object_kind_id" text NOT NULL,
	"external_thread_id" text NOT NULL,
	"canonical_external_subject" text NOT NULL,
	"external_message_key_detail" jsonb NOT NULL,
	"external_message_key_detail_digest_sha256" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_message_key_registry_pk" PRIMARY KEY("tenant_id","message_key_digest_sha256"),
	CONSTRAINT "inbox_v2_source_message_key_registry_key_check" CHECK ((coalesce((char_length("inbox_v2_source_message_key_registry"."message_realm_id") <= 256 and (
    ("inbox_v2_source_message_key_registry"."message_realm_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_realm_id", ':', 2)) <= 160)
    or ("inbox_v2_source_message_key_registry"."message_realm_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_realm_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_realm_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_message_key_registry"."message_realm_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce("inbox_v2_source_message_key_registry"."message_realm_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce("inbox_v2_source_message_key_registry"."message_canonicalization_version" ~ '^v[1-9][0-9]*$', false)
        and coalesce((char_length("inbox_v2_source_message_key_registry"."message_object_kind_id") <= 256 and (
    ("inbox_v2_source_message_key_registry"."message_object_kind_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_object_kind_id", ':', 2)) <= 160)
    or ("inbox_v2_source_message_key_registry"."message_object_kind_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_object_kind_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_message_key_registry"."message_object_kind_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_message_key_registry"."message_object_kind_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      ))
  )), false)
        and coalesce((char_length("inbox_v2_source_message_key_registry"."canonical_external_subject") between 1 and 1024
    and "inbox_v2_source_message_key_registry"."canonical_external_subject" ~ '[^[:space:]]'
    and "inbox_v2_source_message_key_registry"."canonical_external_subject" !~ '[\x00-\x1F\x7F]'), false)
        and coalesce("inbox_v2_source_message_key_registry"."message_key_digest_sha256" ~ '^[a-f0-9]{64}$', false)) is true),
	CONSTRAINT "inbox_v2_source_message_key_registry_scope_check" CHECK ((
          "inbox_v2_source_message_key_registry"."message_scope_kind" = 'provider_thread'
          and "inbox_v2_source_message_key_registry"."message_scope_source_account_id" is null
          and "inbox_v2_source_message_key_registry"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_source_message_key_registry"."message_scope_kind" = 'source_account'
          and "inbox_v2_source_message_key_registry"."message_scope_source_account_id" is not null
          and "inbox_v2_source_message_key_registry"."message_scope_source_thread_binding_id" is null
        ) or (
          "inbox_v2_source_message_key_registry"."message_scope_kind" = 'source_thread_binding'
          and "inbox_v2_source_message_key_registry"."message_scope_source_account_id" is null
          and "inbox_v2_source_message_key_registry"."message_scope_source_thread_binding_id" is not null
        )),
	CONSTRAINT "inbox_v2_source_message_key_registry_detail_check" CHECK ((coalesce((jsonb_typeof("inbox_v2_source_message_key_registry"."external_message_key_detail") = 'object'
    and octet_length("inbox_v2_source_message_key_registry"."external_message_key_detail"::text) between 2 and 65536), false)
        and coalesce("inbox_v2_source_message_key_registry"."external_message_key_detail_digest_sha256" ~ '^sha256:[a-f0-9]{64}$', false)
    and jsonb_typeof("inbox_v2_source_message_key_registry"."external_message_key_detail") = 'object'
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{realm,realmId}') =
          "inbox_v2_source_message_key_registry"."message_realm_id"
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{realm,realmVersion}') =
          "inbox_v2_source_message_key_registry"."message_realm_version"
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>>
          '{realm,canonicalizationVersion}') =
          "inbox_v2_source_message_key_registry"."message_canonicalization_version"
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{scope,kind}') =
          "inbox_v2_source_message_key_registry"."message_scope_kind"::text
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{scope,owner,id}') is not
          distinct from coalesce(
            "inbox_v2_source_message_key_registry"."message_scope_source_account_id",
            "inbox_v2_source_message_key_registry"."message_scope_source_thread_binding_id"
          )
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{objectKindId}') =
          "inbox_v2_source_message_key_registry"."message_object_kind_id"
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>> '{externalThread,id}') =
          "inbox_v2_source_message_key_registry"."external_thread_id"
        and ("inbox_v2_source_message_key_registry"."external_message_key_detail" #>>
          '{canonicalExternalSubject}') = "inbox_v2_source_message_key_registry"."canonical_external_subject"
        and isfinite("inbox_v2_source_message_key_registry"."created_at")) is true)
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_action_fk" FOREIGN KEY ("tenant_id","action_id") REFERENCES "public"."inbox_v2_deferred_message_source_actions"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_target_fk" FOREIGN KEY ("tenant_id","target_external_message_reference_id") REFERENCES "public"."inbox_v2_external_message_references"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_message_fk" FOREIGN KEY ("tenant_id","target_message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_related_fk" FOREIGN KEY ("tenant_id","related_action_id") REFERENCES "public"."inbox_v2_deferred_message_source_actions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_message_key_registry_fk" FOREIGN KEY ("tenant_id","message_key_digest_sha256") REFERENCES "public"."inbox_v2_source_message_key_registry"("tenant_id","message_key_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_thread_fk" FOREIGN KEY ("tenant_id","external_thread_id") REFERENCES "public"."inbox_v2_external_threads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_scope_account_fk" FOREIGN KEY ("tenant_id","message_scope_source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_scope_binding_fk" FOREIGN KEY ("tenant_id","message_scope_source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_event_fk" FOREIGN KEY ("tenant_id","normalized_inbound_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_account_fk" FOREIGN KEY ("tenant_id","source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_binding_fk" FOREIGN KEY ("tenant_id","source_thread_binding_id","source_account_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id","source_account_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_actor_fk" FOREIGN KEY ("tenant_id","actor_source_external_identity_id") REFERENCES "public"."inbox_v2_source_external_identities"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_applied_reference_fk" FOREIGN KEY ("tenant_id","applied_external_message_reference_id") REFERENCES "public"."inbox_v2_external_message_references"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_applied_message_fk" FOREIGN KEY ("tenant_id","applied_message_id") REFERENCES "public"."inbox_v2_messages"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_related_action_fk" FOREIGN KEY ("tenant_id","related_action_id") REFERENCES "public"."inbox_v2_deferred_message_source_actions"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_conflict_candidates" ADD CONSTRAINT "inbox_v2_deferred_action_candidates_transition_fk" FOREIGN KEY ("tenant_id","action_id","resulting_revision") REFERENCES "public"."inbox_v2_deferred_message_source_action_transitions"("tenant_id","action_id","resulting_revision") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_conflict_candidates" ADD CONSTRAINT "inbox_v2_deferred_action_candidates_reference_fk" FOREIGN KEY ("tenant_id","external_message_reference_id","external_thread_id","message_id","timeline_item_id","message_key_digest_sha256") REFERENCES "public"."inbox_v2_external_message_references"("tenant_id","id","external_thread_id","message_id","timeline_item_id","message_key_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_key_registry_fk" FOREIGN KEY ("tenant_id","message_key_digest_sha256") REFERENCES "public"."inbox_v2_source_message_key_registry"("tenant_id","message_key_digest_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_thread_fk" FOREIGN KEY ("tenant_id","external_thread_id") REFERENCES "public"."inbox_v2_external_threads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_account_fk" FOREIGN KEY ("tenant_id","message_scope_source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_binding_fk" FOREIGN KEY ("tenant_id","message_scope_source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_source_action_ordering_heads" ADD CONSTRAINT "inbox_v2_deferred_action_ordering_heads_latest_fk" FOREIGN KEY ("tenant_id","latest_action_id","message_key_digest_sha256","lane","scope_token","comparator_id","comparator_revision","latest_normalized_inbound_event_id","latest_source_occurrence_id","latest_semantic_id","latest_event_fingerprint_sha256") REFERENCES "public"."inbox_v2_deferred_message_source_actions"("tenant_id","id","message_key_digest_sha256","lane","ordering_scope_token","ordering_comparator_id","ordering_comparator_revision","normalized_inbound_event_id","source_occurrence_id","semantic_id","event_fingerprint_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_correlation_evidence" ADD CONSTRAINT "inbox_v2_source_message_correlation_evidence_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_correlation_evidence" ADD CONSTRAINT "inbox_v2_source_message_correlation_evidence_occurrence_fk" FOREIGN KEY ("tenant_id","source_occurrence_id") REFERENCES "public"."inbox_v2_source_occurrences"("tenant_id","id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_key_registry" ADD CONSTRAINT "inbox_v2_source_message_key_registry_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_key_registry" ADD CONSTRAINT "inbox_v2_source_message_key_registry_thread_fk" FOREIGN KEY ("tenant_id","external_thread_id") REFERENCES "public"."inbox_v2_external_threads"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_key_registry" ADD CONSTRAINT "inbox_v2_source_message_key_registry_account_fk" FOREIGN KEY ("tenant_id","message_scope_source_account_id") REFERENCES "public"."source_accounts"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_message_key_registry" ADD CONSTRAINT "inbox_v2_source_message_key_registry_binding_fk" FOREIGN KEY ("tenant_id","message_scope_source_thread_binding_id") REFERENCES "public"."inbox_v2_source_thread_bindings"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_action_transitions_target_idx" ON "inbox_v2_deferred_message_source_action_transitions" USING btree ("tenant_id","target_external_message_reference_id","action_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_actions_pending_idx" ON "inbox_v2_deferred_message_source_actions" USING btree ("tenant_id","state","recorded_at","source_occurrence_id","id") WHERE "inbox_v2_deferred_message_source_actions"."state" = 'pending';
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_actions_pending_key_idx" ON "inbox_v2_deferred_message_source_actions" USING btree ("tenant_id","message_key_digest_sha256","id") WHERE "inbox_v2_deferred_message_source_actions"."state" = 'pending';
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_actions_key_idx" ON "inbox_v2_deferred_message_source_actions" USING btree ("tenant_id","message_key_digest_sha256","lane","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_actions_occurrence_idx" ON "inbox_v2_deferred_message_source_actions" USING btree ("tenant_id","source_occurrence_id","revision","id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_action_candidates_reference_idx" ON "inbox_v2_deferred_source_action_conflict_candidates" USING btree ("tenant_id","external_message_reference_id","action_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_deferred_action_ordering_heads_latest_idx" ON "inbox_v2_deferred_source_action_ordering_heads" USING btree ("tenant_id","latest_action_id","revision");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_message_correlation_evidence_expiry_idx" ON "inbox_v2_source_message_correlation_evidence" USING btree ("tenant_id","expires_at","source_occurrence_id","ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_message_key_registry_tenant_created_idx" ON "inbox_v2_source_message_key_registry" USING btree ("tenant_id","created_at","message_key_digest_sha256");
--> statement-breakpoint
-- INBOX_V2_SOURCE_MESSAGE_RECONCILIATION_FINALIZED_V1
create or replace function public.inbox_v2_source_reconciliation_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE'
     and pg_trigger_depth() > 1
     and not exists (
       select 1 from public.tenants tenant_row
       where tenant_row.id = old.tenant_id
     ) then
    return old;
  end if;
  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_reconciliation_immutable:%s:%s',
      tg_table_name,
      tg_op
    );
end
$function$;

create or replace function public.inbox_v2_deferred_source_action_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
  adapter_contract_detail jsonb;
  provider_reference_detail jsonb;
  provider_timestamp_detail jsonb;
  provider_reference_count bigint;
  provider_timestamp_count bigint;
  expected_occurrence_detail jsonb;
  immutable_columns_changed boolean;
  immutable_changed_column_names text;
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 and not exists (
      select 1 from public.tenants tenant_row
      where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.revision <> 1
       or new.created_at <> new.updated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_invalid_initial';
    end if;

    select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = new.source_occurrence_id
    for share;

    if not found then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_induction_mismatch';
    end if;

    select reference_summary.detail,
           reference_summary.row_count,
           timestamp_summary.detail,
           timestamp_summary.row_count
    into provider_reference_detail,
         provider_reference_count,
         provider_timestamp_detail,
         provider_timestamp_count
    from (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kindId', child_row.kind_id,
                   'subject', child_row.subject
                 ) order by child_row.ordinal
               ),
               '[]'::jsonb
             ) as detail,
             count(*) as row_count
      from public.inbox_v2_source_occurrence_provider_references child_row
      where child_row.tenant_id = new.tenant_id
        and child_row.source_occurrence_id = new.source_occurrence_id
    ) reference_summary
    cross join (
      select coalesce(
               jsonb_agg(
                 jsonb_build_object(
                   'kindId', child_row.kind_id,
                   'timestamp', to_char(
                     child_row.timestamp at time zone 'UTC',
                     'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                   )
                 ) order by child_row.ordinal
               ),
               '[]'::jsonb
             ) as detail,
             count(*) as row_count
      from public.inbox_v2_source_occurrence_provider_timestamps child_row
      where child_row.tenant_id = new.tenant_id
        and child_row.source_occurrence_id = new.source_occurrence_id
    ) timestamp_summary;

    if occurrence_row.resolution_state <> 'pending'
       or occurrence_row.revision <> new.source_occurrence_revision
       or occurrence_row.normalized_inbound_event_id <>
          new.normalized_inbound_event_id
       or occurrence_row.message_realm_id <> new.message_realm_id
       or occurrence_row.message_realm_version <> new.message_realm_version
       or occurrence_row.message_canonicalization_version <>
          new.message_canonicalization_version
       or occurrence_row.message_scope_kind::text <>
          new.message_scope_kind::text
       or occurrence_row.message_scope_source_account_id is distinct from
          new.message_scope_source_account_id
       or occurrence_row.message_scope_source_thread_binding_id is distinct from
          new.message_scope_source_thread_binding_id
       or occurrence_row.message_object_kind_id <> new.message_object_kind_id
       or occurrence_row.external_thread_id <> new.external_thread_id
       or occurrence_row.canonical_external_subject <>
          new.canonical_external_subject
       or occurrence_row.message_key_digest_sha256 <>
          new.message_key_digest_sha256
       or occurrence_row.source_account_id <> new.source_account_id
       or occurrence_row.source_thread_binding_id <>
          new.source_thread_binding_id
       or occurrence_row.binding_generation <> new.binding_generation
       or occurrence_row.adapter_contract_id <> new.adapter_contract_id
       or occurrence_row.adapter_contract_version <>
          new.adapter_contract_version
       or occurrence_row.adapter_declaration_revision <>
          new.adapter_declaration_revision
       or occurrence_row.adapter_surface_id <> new.adapter_surface_id
       or occurrence_row.adapter_loaded_by_trusted_service_id <>
          new.adapter_loaded_by_trusted_service_id
       or occurrence_row.adapter_loaded_at <> new.adapter_loaded_at
       or occurrence_row.capability_revision <> new.capability_revision
       or occurrence_row.provider_actor_source_external_identity_id is distinct from
          new.actor_source_external_identity_id
       or occurrence_row.observed_at <> new.observed_at
       or occurrence_row.recorded_at <> new.recorded_at
       or new.declared_by_trusted_service_id <>
          new.adapter_loaded_by_trusted_service_id
       or new.semantic_proof_detail -> 'externalMessageReference' is distinct from
          'null'::jsonb
       or new.semantic_proof_detail -> 'sourceOccurrence' is distinct from
          'null'::jsonb
       or (new.semantic_proof_detail #>> '{occurredAt}')::timestamptz is distinct from
          new.observed_at
       or (new.semantic_proof_detail #>> '{recordedAt}')::timestamptz is distinct from
          new.recorded_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_induction_mismatch';
    end if;

    adapter_contract_detail := jsonb_build_object(
      'contractId', occurrence_row.adapter_contract_id,
      'contractVersion', occurrence_row.adapter_contract_version,
      'declarationRevision', occurrence_row.adapter_declaration_revision::text,
      'surfaceId', occurrence_row.adapter_surface_id,
      'loadedByTrustedServiceId',
        occurrence_row.adapter_loaded_by_trusted_service_id,
      'loadedAt', to_char(
        occurrence_row.adapter_loaded_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );

    expected_occurrence_detail := jsonb_build_object(
      'tenantId', occurrence_row.tenant_id,
      'id', occurrence_row.id,
      'messageKey', jsonb_build_object(
        'realm', jsonb_build_object(
          'realmId', occurrence_row.message_realm_id,
          'realmVersion', occurrence_row.message_realm_version,
          'canonicalizationVersion',
            occurrence_row.message_canonicalization_version
        ),
        'scope', case occurrence_row.message_scope_kind
          when 'provider_thread' then jsonb_build_object(
            'kind', 'provider_thread'
          )
          when 'source_account' then jsonb_build_object(
            'kind', 'source_account',
            'owner', jsonb_build_object(
              'tenantId', occurrence_row.tenant_id,
              'kind', 'source_account',
              'id', occurrence_row.message_scope_source_account_id
            )
          )
          when 'source_thread_binding' then jsonb_build_object(
            'kind', 'source_thread_binding',
            'owner', jsonb_build_object(
              'tenantId', occurrence_row.tenant_id,
              'kind', 'source_thread_binding',
              'id', occurrence_row.message_scope_source_thread_binding_id
            )
          )
        end,
        'objectKindId', occurrence_row.message_object_kind_id,
        'externalThread', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'external_thread',
          'id', occurrence_row.external_thread_id
        ),
        'canonicalExternalSubject',
          occurrence_row.canonical_external_subject
      ),
      'messageIdentityDeclaration', jsonb_build_object(
        'adapterContract', adapter_contract_detail,
        'identityKind', 'message',
        'realmId', occurrence_row.message_realm_id,
        'realmVersion', occurrence_row.message_realm_version,
        'canonicalizationVersion',
          occurrence_row.message_canonicalization_version,
        'objectKindId', occurrence_row.message_object_kind_id,
        'scopeKind', occurrence_row.message_scope_kind,
        'decisionStrength', occurrence_row.message_decision_strength
      ),
      'bindingContext', jsonb_build_object(
        'externalThread', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'external_thread',
          'id', occurrence_row.external_thread_id
        ),
        'sourceAccount', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'source_account',
          'id', occurrence_row.source_account_id
        ),
        'sourceThreadBinding', jsonb_build_object(
          'tenantId', occurrence_row.tenant_id,
          'kind', 'source_thread_binding',
          'id', occurrence_row.source_thread_binding_id
        ),
        'bindingGeneration', occurrence_row.binding_generation::text
      ),
      'origin', case occurrence_row.origin_kind
        when 'provider_response' then jsonb_build_object(
          'kind', 'provider_response',
          'sourceAccount', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_account',
            'id', occurrence_row.source_account_id
          ),
          'outboundDispatchAttempt', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'outbound_dispatch_attempt',
            'id', occurrence_row.outbound_dispatch_attempt_id
          )
        )
        else jsonb_build_object(
          'kind', occurrence_row.origin_kind,
          'sourceAccount', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_account',
            'id', occurrence_row.source_account_id
          ),
          'rawInboundEvent', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'raw_inbound_event',
            'id', occurrence_row.raw_inbound_event_id
          ),
          'normalizedInboundEvent', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'normalized_inbound_event',
            'id', occurrence_row.normalized_inbound_event_id
          )
        )
      end,
      'descriptor', jsonb_build_object(
        'adapterContract', adapter_contract_detail,
        'descriptorSchemaId', occurrence_row.descriptor_schema_id,
        'descriptorVersion', occurrence_row.descriptor_version,
        'capabilityRevision', occurrence_row.capability_revision::text,
        'providerReferences', provider_reference_detail,
        'descriptorDigestSha256', occurrence_row.descriptor_digest_sha256
      ),
      'providerActor', case occurrence_row.provider_actor_kind
        when 'source_external_identity' then jsonb_build_object(
          'kind', 'source_external_identity',
          'sourceExternalIdentity', jsonb_build_object(
            'tenantId', occurrence_row.tenant_id,
            'kind', 'source_external_identity',
            'id', occurrence_row.provider_actor_source_external_identity_id
          )
        )
        when 'provider_system' then jsonb_build_object(
          'kind', 'provider_system',
          'actorKindId', occurrence_row.provider_system_actor_kind_id,
          'actorSubject', occurrence_row.provider_system_actor_subject
        )
        else 'null'::jsonb
      end,
      'direction', occurrence_row.direction,
      'providerTimestamps', provider_timestamp_detail,
      'referencePortability', jsonb_build_object(
        'kind', occurrence_row.reference_portability_kind,
        'adapterContract', adapter_contract_detail,
        'decisionStrength',
          occurrence_row.reference_portability_decision_strength
      ),
      'resolution', jsonb_build_object(
        'state', 'pending',
        'diagnostic', jsonb_build_object(
          'codeId', occurrence_row.resolution_diagnostic_code_id,
          'retryable', occurrence_row.resolution_diagnostic_retryable,
          'correlationToken',
            occurrence_row.resolution_diagnostic_correlation_token,
          'safeOperatorHintId',
            occurrence_row.resolution_diagnostic_safe_operator_hint_id
        )
      ),
      'observedAt', to_char(
        occurrence_row.observed_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'recordedAt', to_char(
        occurrence_row.recorded_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'revision', occurrence_row.revision::text,
      'createdAt', to_char(
        occurrence_row.created_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      ),
      'updatedAt', to_char(
        occurrence_row.updated_at at time zone 'UTC',
        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
      )
    );

    if provider_reference_count <> occurrence_row.provider_reference_count
       or provider_timestamp_count <> occurrence_row.provider_timestamp_count
       or new.source_occurrence_detail is distinct from
          expected_occurrence_detail then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_occurrence_snapshot_mismatch';
    end if;
    return new;
  end if;

  if old.state <> 'pending'
     and (to_jsonb(new) - 'message_key_digest_sha256') is not distinct from
         (to_jsonb(old) - 'message_key_digest_sha256') then
    -- An exact replay is not a second state transition. Keeping it legal lets
    -- the deferred assertion revalidate immutable historical evidence after a
    -- later action has advanced the same ordering head.
    return new;
  end if;

  immutable_columns_changed := (
       to_jsonb(new) - array[
         'message_key_digest_sha256',
         'state', 'applied_external_message_reference_id',
         'applied_message_id', 'applied_message_revision', 'effect_kind',
         'related_action_id', 'state_reason_id', 'conflict_candidate_count',
         'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
         'updated_at'
       ]
     ) is distinct from (
       to_jsonb(old) - array[
         'message_key_digest_sha256',
         'state', 'applied_external_message_reference_id',
         'applied_message_id', 'applied_message_revision', 'effect_kind',
         'related_action_id', 'state_reason_id', 'conflict_candidate_count',
         'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
         'updated_at'
       ]
     );

  if immutable_columns_changed then
    select string_agg(keys.key, ',' order by keys.key)
    into immutable_changed_column_names
    from jsonb_object_keys(to_jsonb(new) || to_jsonb(old)) keys(key)
    where to_jsonb(new) -> keys.key is distinct from
          to_jsonb(old) -> keys.key
      and keys.key <> all (array[
        'message_key_digest_sha256',
        'state', 'applied_external_message_reference_id',
        'applied_message_id', 'applied_message_revision', 'effect_kind',
        'related_action_id', 'state_reason_id', 'conflict_candidate_count',
        'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
        'updated_at'
      ]);
  end if;

  if immutable_columns_changed
     or old.state <> 'pending'
     or new.state = 'pending'
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or new.terminal_at <> new.updated_at then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.deferred_source_action_cas',
      detail = format(
        'immutable_columns_changed=%s immutable_changed_columns=%s old_state=%s new_state=%s old_revision=%s new_revision=%s old_updated_at=%s new_updated_at=%s terminal_at=%s',
        immutable_columns_changed, immutable_changed_column_names, old.state,
        new.state, old.revision, new.revision, old.updated_at, new.updated_at,
        new.terminal_at
      );
  end if;

  if new.state = 'applied' and not exists (
    select 1
    from public.inbox_v2_external_message_references reference_row
    where reference_row.tenant_id = new.tenant_id
      and reference_row.id = new.applied_external_message_reference_id
      and reference_row.message_id = new.applied_message_id
      and reference_row.external_thread_id = new.external_thread_id
      and reference_row.realm_id = new.message_realm_id
      and reference_row.realm_version = new.message_realm_version
      and reference_row.canonicalization_version =
        new.message_canonicalization_version
      and reference_row.scope_kind = new.message_scope_kind
      and reference_row.scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and reference_row.scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and reference_row.object_kind_id = new.message_object_kind_id
      and reference_row.canonical_external_subject =
        new.canonical_external_subject
      and reference_row.message_key_digest_sha256 =
        old.message_key_digest_sha256
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_applied_target_mismatch';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_deferred_source_ordering_head_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 and not exists (
      select 1 from public.tenants tenant_row
      where tenant_row.id = old.tenant_id
    ) then
      return old;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_ordering_head_delete';
  end if;

  if tg_op = 'INSERT' then
    if new.revision <> 1 or new.created_at <> new.updated_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_ordering_head_initial';
    end if;
    return new;
  end if;

  if row(
       new.tenant_id, new.message_realm_id, new.message_realm_version,
       new.message_canonicalization_version, new.message_scope_kind,
       new.message_scope_source_account_id,
       new.message_scope_source_thread_binding_id,
       new.message_object_kind_id, new.external_thread_id,
       new.canonical_external_subject, new.external_message_key_detail,
       new.external_message_key_detail_digest_sha256, new.lane,
       new.scope_token, new.comparator_id, new.comparator_revision,
       new.created_at
     ) is distinct from row(
       old.tenant_id, old.message_realm_id, old.message_realm_version,
       old.message_canonicalization_version, old.message_scope_kind,
       old.message_scope_source_account_id,
       old.message_scope_source_thread_binding_id,
       old.message_object_kind_id, old.external_thread_id,
       old.canonical_external_subject, old.external_message_key_detail,
       old.external_message_key_detail_digest_sha256, old.lane,
       old.scope_token, old.comparator_id, old.comparator_revision,
       old.created_at
     )
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at
     or char_length(new.latest_position) < char_length(old.latest_position)
     or (
       char_length(new.latest_position) = char_length(old.latest_position)
       and new.latest_position collate "C" <= old.latest_position collate "C"
     ) then
    raise exception using
      errcode = '40001',
      message = 'inbox_v2.deferred_source_ordering_head_cas';
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_source_message_key_registry_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.inbox_v2_source_message_key_registry registry_row
    where registry_row.tenant_id = new.tenant_id
      and registry_row.message_key_digest_sha256 =
        new.message_key_digest_sha256
      and registry_row.message_realm_id = new.message_realm_id
      and registry_row.message_realm_version = new.message_realm_version
      and registry_row.message_canonicalization_version =
        new.message_canonicalization_version
      and registry_row.message_scope_kind = new.message_scope_kind
      and registry_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and registry_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and registry_row.message_object_kind_id = new.message_object_kind_id
      and registry_row.external_thread_id = new.external_thread_id
      and registry_row.canonical_external_subject =
        new.canonical_external_subject
      and registry_row.external_message_key_detail =
        new.external_message_key_detail
      and registry_row.external_message_key_detail_digest_sha256 =
        new.external_message_key_detail_digest_sha256
  ) then
    raise exception using
      errcode = '23514',
      message = case tg_table_name
        when 'inbox_v2_deferred_message_source_actions' then
          'inbox_v2.deferred_source_action_message_key_registry_mismatch'
        else
          'inbox_v2.deferred_source_ordering_head_message_key_registry_mismatch'
      end;
  end if;
  return new;
end
$function$;

create or replace function public.inbox_v2_source_correlation_evidence_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'INSERT' then
    if new.expires_at <= clock_timestamp() then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_correlation_evidence_expired';
    end if;
    if not exists (
      select 1
      from public.inbox_v2_source_occurrences occurrence_row
      where occurrence_row.tenant_id = new.tenant_id
        and occurrence_row.id = new.source_occurrence_id
        and occurrence_row.recorded_at <= new.created_at
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.source_correlation_evidence_occurrence_mismatch';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' and (
       clock_timestamp() >= old.expires_at
       or (
         pg_trigger_depth() > 1
         and (
           not exists (
             select 1 from public.tenants tenant_row
             where tenant_row.id = old.tenant_id
           )
           or not exists (
             select 1
             from public.inbox_v2_source_occurrences occurrence_row
             where occurrence_row.tenant_id = old.tenant_id
               and occurrence_row.id = old.source_occurrence_id
           )
         )
       )
     ) then
    return old;
  end if;

  raise exception using
    errcode = '23514',
    message = format(
      'inbox_v2.source_correlation_evidence_immutable:%s', tg_op
    );
end
$function$;

create or replace function public.inbox_v2_deferred_source_action_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  transition_row public.inbox_v2_deferred_message_source_action_transitions%rowtype;
  occurrence_row public.inbox_v2_source_occurrences%rowtype;
  related_action_row public.inbox_v2_deferred_message_source_actions%rowtype;
  related_transition_row public.inbox_v2_deferred_message_source_action_transitions%rowtype;
  candidate_count bigint;
  candidate_min smallint;
  candidate_max smallint;
begin
  if new.state = 'pending' then
    if exists (
      select 1
      from public.inbox_v2_deferred_message_source_action_transitions t
      where t.tenant_id = new.tenant_id and t.action_id = new.id
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_pending_has_transition';
    end if;
    return null;
  end if;

  select * into transition_row
  from public.inbox_v2_deferred_message_source_action_transitions candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.action_id = new.id;

  if not found
     or transition_row.expected_revision <> new.revision - 1
     or transition_row.resulting_revision <> new.revision
     or transition_row.after_state <> new.state
     or transition_row.effect_kind is distinct from new.effect_kind
     or (new.state not in ('stale', 'duplicate') and (
       transition_row.target_external_message_reference_id is distinct from
         new.applied_external_message_reference_id
       or transition_row.target_message_id is distinct from
         new.applied_message_id
       or transition_row.applied_message_revision is distinct from
         new.applied_message_revision
     ))
     or transition_row.related_action_id is distinct from new.related_action_id
     or transition_row.reason_id is distinct from new.state_reason_id
     or transition_row.conflict_candidate_count <>
        new.conflict_candidate_count
     or transition_row.conflict_candidate_digest_sha256 is distinct from
        new.conflict_candidate_digest_sha256
     or transition_row.recorded_at <> new.updated_at then
    raise exception using
      errcode = '23514',
    message = 'inbox_v2.deferred_source_action_transition_mismatch';
  end if;

  if new.state in ('stale', 'duplicate')
     or (new.state = 'ordering_conflict'
       and new.ordering_kind = 'monotonic_exact') then
    if transition_row.related_action_id is null
       or transition_row.expected_ordering_head_revision is null
       or transition_row.resulting_ordering_head_revision <>
          transition_row.expected_ordering_head_revision
       or transition_row.ordering_head_scope_token is null
       or transition_row.ordering_head_comparator_id is null
       or transition_row.ordering_head_comparator_revision is null then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_missing';
    end if;

    select * into related_action_row
    from public.inbox_v2_deferred_message_source_actions candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = transition_row.related_action_id;

    if not found
       or related_action_row.state <> 'applied'
       or related_action_row.message_key_digest_sha256 <>
          new.message_key_digest_sha256
       or related_action_row.external_message_key_detail <>
          new.external_message_key_detail
       or related_action_row.lane <> new.lane
       or related_action_row.ordering_kind <> 'monotonic_exact'
       or related_action_row.ordering_scope_token <>
          transition_row.ordering_head_scope_token
       or related_action_row.ordering_comparator_id <>
          transition_row.ordering_head_comparator_id
       or related_action_row.ordering_comparator_revision <>
          transition_row.ordering_head_comparator_revision
       or new.ordering_scope_token <>
          transition_row.ordering_head_scope_token
       or new.ordering_comparator_id <>
          transition_row.ordering_head_comparator_id
       or new.ordering_comparator_revision <>
          transition_row.ordering_head_comparator_revision then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_mismatch';
    end if;

    select * into related_transition_row
    from public.inbox_v2_deferred_message_source_action_transitions candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.action_id = related_action_row.id;

    if not found
       or related_transition_row.after_state <> 'applied'
       or related_transition_row.ordering_outcome <> 'advance'
       or related_transition_row.resulting_ordering_head_revision <>
          transition_row.expected_ordering_head_revision
       or related_transition_row.ordering_head_scope_token <>
          transition_row.ordering_head_scope_token
       or related_transition_row.ordering_head_comparator_id <>
          transition_row.ordering_head_comparator_id
       or related_transition_row.ordering_head_comparator_revision <>
          transition_row.ordering_head_comparator_revision then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_historical_head_mismatch';
    end if;

    if new.state = 'stale' and not (
         char_length(related_action_row.ordering_position) >
           char_length(new.ordering_position)
         or (
           char_length(related_action_row.ordering_position) =
             char_length(new.ordering_position)
           and related_action_row.ordering_position collate "C" >
             new.ordering_position collate "C"
         )
       ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_stale_position_mismatch';
    elsif new.state = 'duplicate' and (
      related_action_row.ordering_position <> new.ordering_position
      or related_action_row.semantic_id <> new.semantic_id
      or related_action_row.event_fingerprint_sha256 <>
        new.event_fingerprint_sha256
      or row(
        related_action_row.normalized_inbound_event_id,
        related_action_row.source_occurrence_id,
        related_action_row.semantic_id,
        related_action_row.event_fingerprint_sha256
      ) is not distinct from row(
        new.normalized_inbound_event_id,
        new.source_occurrence_id,
        new.semantic_id,
        new.event_fingerprint_sha256
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_duplicate_identity_mismatch';
    elsif new.state = 'ordering_conflict' and (
      related_action_row.ordering_position <> new.ordering_position
      or row(
        related_action_row.semantic_id,
        related_action_row.event_fingerprint_sha256
      ) is not distinct from row(
        new.semantic_id,
        new.event_fingerprint_sha256
      )
    ) then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_ordering_conflict_identity_mismatch';
    end if;
  end if;

  if transition_row.target_external_message_reference_id is not null
     and not exists (
       select 1
       from public.inbox_v2_external_message_references reference_row
       where reference_row.tenant_id = new.tenant_id
         and reference_row.id =
           transition_row.target_external_message_reference_id
         and reference_row.message_id = transition_row.target_message_id
         and reference_row.external_thread_id = new.external_thread_id
         and reference_row.realm_id = new.message_realm_id
         and reference_row.realm_version = new.message_realm_version
         and reference_row.canonicalization_version =
           new.message_canonicalization_version
         and reference_row.scope_kind = new.message_scope_kind
         and reference_row.scope_source_account_id is not distinct from
           new.message_scope_source_account_id
         and reference_row.scope_source_thread_binding_id is not distinct from
           new.message_scope_source_thread_binding_id
         and reference_row.object_kind_id = new.message_object_kind_id
         and reference_row.canonical_external_subject =
           new.canonical_external_subject
         and reference_row.message_key_digest_sha256 =
           new.message_key_digest_sha256
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_exact_target_mismatch';
  end if;

  if transition_row.source_occurrence_resulting_revision is not null then
    select * into occurrence_row
    from public.inbox_v2_source_occurrences candidate_row
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.id = new.source_occurrence_id;

    if not found
       or transition_row.source_occurrence_expected_revision <>
          new.source_occurrence_revision
       or occurrence_row.resolution_state <> 'resolved'
       or occurrence_row.revision <>
          transition_row.source_occurrence_resulting_revision
       or occurrence_row.resolved_external_message_reference_id <>
          transition_row.target_external_message_reference_id
       or occurrence_row.updated_at > transition_row.recorded_at then
      raise exception using
        errcode = '23514',
        message = 'inbox_v2.deferred_source_action_occurrence_resolution_mismatch';
    end if;
  end if;

  select count(*), min(candidate_row.ordinal), max(candidate_row.ordinal)
  into candidate_count, candidate_min, candidate_max
  from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.action_id = new.id
    and candidate_row.resulting_revision = new.revision;

  if candidate_count <> new.conflict_candidate_count
     or (candidate_count > 0 and (
       candidate_min <> 0 or candidate_max <> candidate_count - 1
     )) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_candidate_set_mismatch';
  end if;

  if new.state = 'target_conflicted' and exists (
    select 1
    from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
    join public.inbox_v2_external_message_references reference_row
      on reference_row.tenant_id = candidate_row.tenant_id
     and reference_row.id = candidate_row.external_message_reference_id
    where candidate_row.tenant_id = new.tenant_id
      and candidate_row.action_id = new.id
      and (
        reference_row.realm_id <> new.message_realm_id
        or reference_row.realm_version <> new.message_realm_version
        or reference_row.canonicalization_version <>
          new.message_canonicalization_version
        or reference_row.scope_kind <> new.message_scope_kind
        or reference_row.scope_source_account_id is distinct from
          new.message_scope_source_account_id
        or reference_row.scope_source_thread_binding_id is distinct from
          new.message_scope_source_thread_binding_id
        or reference_row.object_kind_id <> new.message_object_kind_id
        or reference_row.external_thread_id <> new.external_thread_id
        or reference_row.canonical_external_subject <>
          new.canonical_external_subject
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_candidate_key_mismatch';
  end if;

  if transition_row.ordering_outcome = 'advance' and not exists (
    select 1
    from public.inbox_v2_deferred_source_action_ordering_heads head_row
    where head_row.tenant_id = new.tenant_id
      and head_row.message_key_digest_sha256 = new.message_key_digest_sha256
      and head_row.message_realm_id = new.message_realm_id
      and head_row.message_realm_version = new.message_realm_version
      and head_row.message_canonicalization_version =
        new.message_canonicalization_version
      and head_row.message_scope_kind = new.message_scope_kind
      and head_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and head_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and head_row.message_object_kind_id = new.message_object_kind_id
      and head_row.external_thread_id = new.external_thread_id
      and head_row.canonical_external_subject =
        new.canonical_external_subject
      and head_row.external_message_key_detail =
        new.external_message_key_detail
      and head_row.lane = new.lane
      and head_row.scope_token = transition_row.ordering_head_scope_token
      and head_row.comparator_id = transition_row.ordering_head_comparator_id
      and head_row.comparator_revision =
        transition_row.ordering_head_comparator_revision
      and head_row.revision >= transition_row.resulting_ordering_head_revision
      and (
        (
          head_row.revision = transition_row.resulting_ordering_head_revision
          and head_row.latest_action_id = new.id
          and head_row.latest_position = new.ordering_position
        ) or (
          head_row.revision > transition_row.resulting_ordering_head_revision
          and (
            char_length(head_row.latest_position) >
              char_length(new.ordering_position)
            or (
              char_length(head_row.latest_position) =
                char_length(new.ordering_position)
              and head_row.latest_position collate "C" >
                new.ordering_position collate "C"
            )
          )
        )
      )
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_ordering_head_missing';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_transition_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  action_row public.inbox_v2_deferred_message_source_actions%rowtype;
begin
  select * into action_row
  from public.inbox_v2_deferred_message_source_actions candidate_row
  where candidate_row.tenant_id = new.tenant_id
    and candidate_row.id = new.action_id;

  if not found
     or action_row.state = 'pending'
     or action_row.revision <> new.resulting_revision
     or action_row.state <> new.after_state
     or action_row.updated_at <> new.recorded_at then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_transition_action_mismatch';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_candidate_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  tenant_key text;
  action_key text;
  action_row public.inbox_v2_deferred_message_source_actions%rowtype;
  candidate_count bigint;
  candidate_min smallint;
  candidate_max smallint;
begin
  tenant_key := case when tg_op = 'DELETE' then old.tenant_id else new.tenant_id end;
  action_key := case when tg_op = 'DELETE' then old.action_id else new.action_id end;

  select * into action_row
  from public.inbox_v2_deferred_message_source_actions candidate_action
  where candidate_action.tenant_id = tenant_key
    and candidate_action.id = action_key;

  if not found then
    if not exists (
      select 1 from public.tenants tenant_row where tenant_row.id = tenant_key
    ) then
      return null;
    end if;
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_candidate_action_missing';
  end if;

  select count(*), min(candidate_row.ordinal), max(candidate_row.ordinal)
  into candidate_count, candidate_min, candidate_max
  from public.inbox_v2_deferred_source_action_conflict_candidates candidate_row
  where candidate_row.tenant_id = tenant_key
    and candidate_row.action_id = action_key
    and candidate_row.resulting_revision = action_row.revision;

  if action_row.state <> 'target_conflicted'
     or candidate_count <> action_row.conflict_candidate_count
     or candidate_count < 2
     or candidate_min <> 0
     or candidate_max <> candidate_count - 1 then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_candidate_set_mismatch';
  end if;
  return null;
end
$function$;

create or replace function public.inbox_v2_deferred_source_head_assert()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if not exists (
    select 1
    from public.inbox_v2_deferred_message_source_actions action_row
    join public.inbox_v2_deferred_message_source_action_transitions transition_row
      on transition_row.tenant_id = action_row.tenant_id
     and transition_row.action_id = action_row.id
    where action_row.tenant_id = new.tenant_id
      and action_row.id = new.latest_action_id
      and action_row.state = 'applied'
      and action_row.ordering_kind = 'monotonic_exact'
      and action_row.message_key_digest_sha256 = new.message_key_digest_sha256
      and action_row.message_realm_id = new.message_realm_id
      and action_row.message_realm_version = new.message_realm_version
      and action_row.message_canonicalization_version =
        new.message_canonicalization_version
      and action_row.message_scope_kind = new.message_scope_kind
      and action_row.message_scope_source_account_id is not distinct from
        new.message_scope_source_account_id
      and action_row.message_scope_source_thread_binding_id is not distinct from
        new.message_scope_source_thread_binding_id
      and action_row.message_object_kind_id = new.message_object_kind_id
      and action_row.external_thread_id = new.external_thread_id
      and action_row.canonical_external_subject =
        new.canonical_external_subject
      and action_row.external_message_key_detail =
        new.external_message_key_detail
      and action_row.lane = new.lane
      and action_row.ordering_scope_token = new.scope_token
      and action_row.ordering_comparator_id = new.comparator_id
      and action_row.ordering_comparator_revision = new.comparator_revision
      and action_row.ordering_position = new.latest_position
      and transition_row.ordering_outcome = 'advance'
      and transition_row.ordering_head_scope_token = new.scope_token
      and transition_row.ordering_head_comparator_id = new.comparator_id
      and transition_row.ordering_head_comparator_revision =
        new.comparator_revision
      and transition_row.resulting_ordering_head_revision = new.revision
      and transition_row.recorded_at = new.updated_at
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_ordering_head_action_mismatch';
  end if;
  return null;
end
$function$;

create trigger inbox_v2_deferred_source_action_guard_trigger
before insert or update or delete
on public.inbox_v2_deferred_message_source_actions
for each row execute function public.inbox_v2_deferred_source_action_guard();

create trigger inbox_v2_deferred_source_action_key_registry_trigger
after insert
on public.inbox_v2_deferred_message_source_actions
for each row execute function public.inbox_v2_source_message_key_registry_assert();

create trigger inbox_v2_source_message_key_registry_immutable_trigger
before update or delete
on public.inbox_v2_source_message_key_registry
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_transition_immutable_trigger
before update or delete
on public.inbox_v2_deferred_message_source_action_transitions
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_candidate_immutable_trigger
before update or delete
on public.inbox_v2_deferred_source_action_conflict_candidates
for each row execute function public.inbox_v2_source_reconciliation_reject_immutable();

create trigger inbox_v2_deferred_source_head_guard_trigger
before insert or update or delete
on public.inbox_v2_deferred_source_action_ordering_heads
for each row execute function public.inbox_v2_deferred_source_ordering_head_guard();

create trigger inbox_v2_deferred_source_head_key_registry_trigger
after insert or update
on public.inbox_v2_deferred_source_action_ordering_heads
for each row execute function public.inbox_v2_source_message_key_registry_assert();

create trigger inbox_v2_source_correlation_evidence_guard_trigger
before insert or update or delete
on public.inbox_v2_source_message_correlation_evidence
for each row execute function public.inbox_v2_source_correlation_evidence_guard();

create constraint trigger inbox_v2_deferred_source_action_constraint_trigger
after update
on public.inbox_v2_deferred_message_source_actions
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_action_assert();

create constraint trigger inbox_v2_deferred_source_transition_constraint_trigger
after insert
on public.inbox_v2_deferred_message_source_action_transitions
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_transition_assert();

create constraint trigger inbox_v2_deferred_source_candidate_constraint_trigger
after insert or delete
on public.inbox_v2_deferred_source_action_conflict_candidates
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_candidate_assert();

create constraint trigger inbox_v2_deferred_source_head_constraint_trigger
after insert or update
on public.inbox_v2_deferred_source_action_ordering_heads
deferrable initially deferred
for each row execute function public.inbox_v2_deferred_source_head_assert();
