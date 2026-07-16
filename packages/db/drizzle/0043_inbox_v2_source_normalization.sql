CREATE TYPE "public"."inbox_v2_source_normalization_outcome" AS ENUM('normalized', 'ignored', 'quarantined');
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_normalization_results" (
	"tenant_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"outcome" "inbox_v2_source_normalization_outcome" NOT NULL,
	"normalized_event_count" integer NOT NULL,
	"ordered_event_hmac_sha256" text NOT NULL,
	"reason_code" text,
	"quarantine_id" text,
	"digest_key_generation" text NOT NULL,
	"candidate_completion_hmac_sha256" text NOT NULL,
	"worker_id" text NOT NULL,
	"completed_attempt_count" bigint NOT NULL,
	"completed_reclaim_count" bigint NOT NULL,
	"completed_lease_token_hash" text NOT NULL,
	"completed_lease_revision" bigint NOT NULL,
	"completed_lease_claimed_at" timestamp (3) with time zone NOT NULL,
	"completed_lease_expires_at" timestamp (3) with time zone NOT NULL,
	"completed_work_revision" bigint NOT NULL,
	"result_schema_id" text NOT NULL,
	"result_schema_version" text NOT NULL,
	"result_hmac_sha256" text NOT NULL,
	"completed_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_normalization_results_pk" PRIMARY KEY("tenant_id","raw_event_id"),
	CONSTRAINT "inbox_v2_source_normalization_results_digest_unique" UNIQUE("tenant_id","raw_event_id","result_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_normalization_results_shape_check" CHECK ("inbox_v2_source_normalization_results"."normalized_event_count" >= 0
        and "inbox_v2_source_normalization_results"."ordered_event_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_normalization_results"."digest_key_generation") between 1 and 128
    and "inbox_v2_source_normalization_results"."digest_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_normalization_results"."candidate_completion_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and (
          ("inbox_v2_source_normalization_results"."outcome" = 'normalized'
            and "inbox_v2_source_normalization_results"."normalized_event_count" >= 1
            and "inbox_v2_source_normalization_results"."reason_code" is null
            and "inbox_v2_source_normalization_results"."quarantine_id" is null)
          or ("inbox_v2_source_normalization_results"."outcome" = 'ignored'
            and "inbox_v2_source_normalization_results"."normalized_event_count" = 0
            and "inbox_v2_source_normalization_results"."reason_code" is not null
            and char_length("inbox_v2_source_normalization_results"."reason_code") between 1 and 128
    and "inbox_v2_source_normalization_results"."reason_code" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
            and "inbox_v2_source_normalization_results"."quarantine_id" is null)
          or ("inbox_v2_source_normalization_results"."outcome" = 'quarantined'
            and "inbox_v2_source_normalization_results"."normalized_event_count" = 0
            and "inbox_v2_source_normalization_results"."reason_code" is not null
            and char_length("inbox_v2_source_normalization_results"."reason_code") between 1 and 128
    and "inbox_v2_source_normalization_results"."reason_code" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
            and "inbox_v2_source_normalization_results"."quarantine_id" is not null)
        )),
	CONSTRAINT "inbox_v2_source_normalization_results_fence_check" CHECK (char_length("inbox_v2_source_normalization_results"."worker_id") between 1 and 256
        and "inbox_v2_source_normalization_results"."completed_attempt_count" >= 1
        and "inbox_v2_source_normalization_results"."completed_reclaim_count" >= 0
        and "inbox_v2_source_normalization_results"."completed_reclaim_count" <= "inbox_v2_source_normalization_results"."completed_attempt_count"
        and "inbox_v2_source_normalization_results"."completed_lease_token_hash" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_normalization_results"."completed_lease_revision" >= 1
        and "inbox_v2_source_normalization_results"."completed_work_revision" >= 1
        and char_length("inbox_v2_source_normalization_results"."result_schema_id") <= 256 and (
    (
      "inbox_v2_source_normalization_results"."result_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalization_results"."result_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalization_results"."result_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalization_results"."result_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalization_results"."result_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalization_results"."result_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalization_results"."result_schema_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_normalization_results"."result_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_normalization_results"."completed_lease_claimed_at")
        and isfinite("inbox_v2_source_normalization_results"."completed_lease_expires_at")
        and "inbox_v2_source_normalization_results"."completed_lease_claimed_at" < "inbox_v2_source_normalization_results"."completed_lease_expires_at"
        and isfinite("inbox_v2_source_normalization_results"."completed_at")
        and isfinite("inbox_v2_source_normalization_results"."created_at")
        and "inbox_v2_source_normalization_results"."completed_at" >= "inbox_v2_source_normalization_results"."completed_lease_claimed_at"
        and "inbox_v2_source_normalization_results"."completed_at" < "inbox_v2_source_normalization_results"."completed_lease_expires_at"
        and "inbox_v2_source_normalization_results"."created_at" = "inbox_v2_source_normalization_results"."completed_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_normalized_envelopes" (
	"tenant_id" text NOT NULL,
	"normalized_event_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"normalized_ordinal" integer NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"event_type" text NOT NULL,
	"direction" text NOT NULL,
	"visibility" text NOT NULL,
	"provider_occurred_at" timestamp (3) with time zone,
	"payload_schema_id" text NOT NULL,
	"payload_schema_version" text NOT NULL,
	"capability_schema_id" text NOT NULL,
	"capability_schema_version" text NOT NULL,
	"capability_hmac_sha256" text NOT NULL,
	"identity_observation_count" integer NOT NULL,
	"roster_completeness" text,
	"roster_authority" text,
	"roster_omission_policy" text,
	"normalizer_id" text NOT NULL,
	"normalizer_version" text NOT NULL,
	"normalizer_declaration_revision" bigint NOT NULL,
	"adapter_contract_id" text NOT NULL,
	"adapter_contract_version" text NOT NULL,
	"adapter_declaration_revision" bigint NOT NULL,
	"adapter_surface_id" text NOT NULL,
	"safe_envelope_schema_id" text NOT NULL,
	"safe_envelope_schema_version" text NOT NULL,
	"digest_key_generation" text NOT NULL,
	"safe_envelope_hmac_sha256" text NOT NULL,
	"safe_envelope" jsonb NOT NULL,
	"normalized_evidence_count" integer NOT NULL,
	"data_class_id" text NOT NULL,
	"sensitivity_class" text NOT NULL,
	"processing_purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"expiry_action" text NOT NULL,
	"normalized_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_normalized_envelopes_pk" PRIMARY KEY("tenant_id","normalized_event_id"),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_raw_ordinal_unique" UNIQUE("tenant_id","raw_event_id","normalized_ordinal"),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_digest_unique" UNIQUE("tenant_id","normalized_event_id","safe_envelope_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_exact_scope_unique" UNIQUE("tenant_id","normalized_event_id","raw_event_id","source_connection_id","source_account_scope_key","event_type","safe_envelope_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_scope_check" CHECK ("inbox_v2_source_normalized_envelopes"."source_account_scope_key" = case
    when "inbox_v2_source_normalized_envelopes"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_normalized_envelopes"."source_account_id")::text || ':' || "inbox_v2_source_normalized_envelopes"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_identity_check" CHECK ("inbox_v2_source_normalized_envelopes"."normalized_ordinal" >= 0
        and "inbox_v2_source_normalized_envelopes"."idempotency_key" ~ '^source:v2:normalized:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_normalized_envelopes"."source_type") between 1 and 128
    and "inbox_v2_source_normalized_envelopes"."source_type" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_normalized_envelopes"."source_name") between 1 and 128
    and "inbox_v2_source_normalized_envelopes"."source_name" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_normalized_envelopes"."event_type") between 1 and 128
    and "inbox_v2_source_normalized_envelopes"."event_type" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and "inbox_v2_source_normalized_envelopes"."direction" in ('inbound', 'outbound', 'system')
        and "inbox_v2_source_normalized_envelopes"."visibility" in ('private', 'public', 'internal')),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_contract_check" CHECK (char_length("inbox_v2_source_normalized_envelopes"."payload_schema_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."payload_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."payload_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."payload_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."payload_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."payload_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."payload_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_envelopes"."payload_schema_version" ~ '^v[1-9][0-9]*$'
        and char_length("inbox_v2_source_normalized_envelopes"."capability_schema_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."capability_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."capability_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."capability_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."capability_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."capability_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."capability_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_envelopes"."capability_schema_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_normalized_envelopes"."capability_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_normalized_envelopes"."normalizer_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."normalizer_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."normalizer_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."normalizer_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."normalizer_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."normalizer_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."normalizer_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_envelopes"."normalizer_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_normalized_envelopes"."normalizer_declaration_revision" >= 1
        and char_length("inbox_v2_source_normalized_envelopes"."adapter_contract_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."adapter_contract_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_contract_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."adapter_contract_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_contract_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_contract_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."adapter_contract_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_envelopes"."adapter_contract_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_normalized_envelopes"."adapter_declaration_revision" >= 1
        and char_length("inbox_v2_source_normalized_envelopes"."adapter_surface_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."adapter_surface_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_surface_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."adapter_surface_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_surface_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."adapter_surface_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."adapter_surface_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id") <= 256 and (
    (
      "inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_envelopes"."safe_envelope_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_envelopes"."safe_envelope_schema_version" ~ '^v[1-9][0-9]*$'
        and char_length("inbox_v2_source_normalized_envelopes"."digest_key_generation") between 1 and 128
    and "inbox_v2_source_normalized_envelopes"."digest_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_normalized_envelopes"."safe_envelope_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and jsonb_typeof("inbox_v2_source_normalized_envelopes"."safe_envelope") = 'object'
        and "inbox_v2_source_normalized_envelopes"."normalized_evidence_count" >= 0),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_observation_check" CHECK ("inbox_v2_source_normalized_envelopes"."identity_observation_count" >= 0
        and (
          ("inbox_v2_source_normalized_envelopes"."roster_completeness" is null
            and "inbox_v2_source_normalized_envelopes"."roster_authority" is null
            and "inbox_v2_source_normalized_envelopes"."roster_omission_policy" is null)
          or (
            "inbox_v2_source_normalized_envelopes"."roster_completeness" in ('unknown', 'partial', 'complete')
            and "inbox_v2_source_normalized_envelopes"."roster_authority" in ('advisory', 'authoritative')
            and "inbox_v2_source_normalized_envelopes"."roster_omission_policy" in ('retain_missing', 'close_missing')
            and (
              "inbox_v2_source_normalized_envelopes"."roster_omission_policy" = 'retain_missing'
              or (
                "inbox_v2_source_normalized_envelopes"."roster_completeness" = 'complete'
                and "inbox_v2_source_normalized_envelopes"."roster_authority" = 'authoritative'
              )
            )
          )
        )),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_lifecycle_check" CHECK ("inbox_v2_source_normalized_envelopes"."data_class_id" = 'core:normalized_event_envelope'
        and "inbox_v2_source_normalized_envelopes"."sensitivity_class" = 'personal_operational'
        and "inbox_v2_source_normalized_envelopes"."processing_purpose_id" = 'core:source_replay_and_diagnostics'
        and "inbox_v2_source_normalized_envelopes"."canonical_anchor_id" = 'core:materialization_or_final_failure'
        and "inbox_v2_source_normalized_envelopes"."expiry_action" = 'compact_to_safe_skeleton'),
	CONSTRAINT "inbox_v2_source_normalized_envelopes_times_check" CHECK (("inbox_v2_source_normalized_envelopes"."provider_occurred_at" is null or isfinite("inbox_v2_source_normalized_envelopes"."provider_occurred_at"))
        and isfinite("inbox_v2_source_normalized_envelopes"."normalized_at")
        and isfinite("inbox_v2_source_normalized_envelopes"."created_at")
        and "inbox_v2_source_normalized_envelopes"."created_at" = "inbox_v2_source_normalized_envelopes"."normalized_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_normalized_evidence" (
	"tenant_id" text NOT NULL,
	"normalized_event_id" text NOT NULL,
	"evidence_key" text NOT NULL,
	"slot_id" text NOT NULL,
	"data_class_id" text NOT NULL,
	"sensitivity_class" text NOT NULL,
	"purpose_ids" jsonb NOT NULL,
	"evidence_schema_id" text NOT NULL,
	"evidence_schema_version" text NOT NULL,
	"digest_key_generation" text NOT NULL,
	"content_hmac_sha256" text NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_normalized_evidence_pk" PRIMARY KEY("tenant_id","normalized_event_id","evidence_key"),
	CONSTRAINT "inbox_v2_source_normalized_evidence_classification_check" CHECK (char_length("inbox_v2_source_normalized_evidence"."evidence_key") <= 256 and (
    (
      "inbox_v2_source_normalized_evidence"."evidence_key" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_key", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_evidence"."evidence_key" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_key", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_key", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_evidence"."evidence_key", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and char_length("inbox_v2_source_normalized_evidence"."slot_id") <= 256 and (
    (
      "inbox_v2_source_normalized_evidence"."slot_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."slot_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_evidence"."slot_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."slot_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_evidence"."slot_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_evidence"."slot_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_evidence"."data_class_id" = 'core:normalized_event_payload'
        and "inbox_v2_source_normalized_evidence"."sensitivity_class" = 'restricted_content'
        and "inbox_v2_source_normalized_evidence"."purpose_ids" in (
          '["core:source_replay_and_diagnostics"]'::jsonb,
          '["core:security_and_fraud_prevention"]'::jsonb,
          '["core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb
        )),
	CONSTRAINT "inbox_v2_source_normalized_evidence_content_check" CHECK (char_length("inbox_v2_source_normalized_evidence"."evidence_schema_id") <= 256 and (
    (
      "inbox_v2_source_normalized_evidence"."evidence_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_evidence"."evidence_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_evidence"."evidence_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_evidence"."evidence_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_evidence"."evidence_schema_version" ~ '^v[1-9][0-9]*$'
        and char_length("inbox_v2_source_normalized_evidence"."digest_key_generation") between 1 and 128
    and "inbox_v2_source_normalized_evidence"."digest_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_normalized_evidence"."content_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_normalized_evidence"."created_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_normalized_evidence_payloads" (
	"tenant_id" text NOT NULL,
	"normalized_event_id" text NOT NULL,
	"evidence_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_normalized_evidence_payloads_pk" PRIMARY KEY("tenant_id","normalized_event_id","evidence_key"),
	CONSTRAINT "inbox_v2_source_normalized_evidence_payloads_content_check" CHECK (jsonb_typeof("inbox_v2_source_normalized_evidence_payloads"."content") is not null
        and isfinite("inbox_v2_source_normalized_evidence_payloads"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_normalized_quarantines" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"reason_code" text NOT NULL,
	"digest_key_generation" text NOT NULL,
	"quarantine_fingerprint_hmac_sha256" text NOT NULL,
	"candidate_completion_hmac_sha256" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_scope_key" text NOT NULL,
	"normalized_ordinal" integer,
	"event_type" text,
	"idempotency_key_hmac_sha256" text,
	"safe_envelope_hmac_sha256" text,
	"existing_normalized_event_id" text,
	"existing_raw_event_id" text,
	"existing_source_connection_id" text,
	"existing_source_account_scope_key" text,
	"existing_event_type" text,
	"existing_safe_envelope_hmac_sha256" text,
	"normalizer_id" text NOT NULL,
	"normalizer_version" text NOT NULL,
	"normalizer_declaration_revision" bigint NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_normalized_quarantines_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_source_normalized_quarantines_fingerprint_unique" UNIQUE("tenant_id","quarantine_fingerprint_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_normalized_quarantines_result_relation_unique" UNIQUE("tenant_id","id","raw_event_id","reason_code","digest_key_generation","candidate_completion_hmac_sha256"),
	CONSTRAINT "inbox_v2_source_normalized_quarantines_values_check" CHECK (char_length("inbox_v2_source_normalized_quarantines"."reason_code") between 1 and 128
    and "inbox_v2_source_normalized_quarantines"."reason_code" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_normalized_quarantines"."digest_key_generation") between 1 and 128
    and "inbox_v2_source_normalized_quarantines"."digest_key_generation" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_normalized_quarantines"."quarantine_fingerprint_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_normalized_quarantines"."candidate_completion_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_normalized_quarantines"."normalizer_id") <= 256 and (
    (
      "inbox_v2_source_normalized_quarantines"."normalizer_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_quarantines"."normalizer_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_normalized_quarantines"."normalizer_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_normalized_quarantines"."normalizer_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_normalized_quarantines"."normalizer_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_normalized_quarantines"."normalizer_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_normalized_quarantines"."normalizer_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_normalized_quarantines"."normalizer_declaration_revision" >= 1
        and isfinite("inbox_v2_source_normalized_quarantines"."recorded_at")
        and (
          ("inbox_v2_source_normalized_quarantines"."reason_code" <> 'source.idempotency_collision'
            and "inbox_v2_source_normalized_quarantines"."normalized_ordinal" is null
            and "inbox_v2_source_normalized_quarantines"."event_type" is null
            and "inbox_v2_source_normalized_quarantines"."idempotency_key_hmac_sha256" is null
            and "inbox_v2_source_normalized_quarantines"."safe_envelope_hmac_sha256" is null
            and "inbox_v2_source_normalized_quarantines"."existing_normalized_event_id" is null
            and "inbox_v2_source_normalized_quarantines"."existing_raw_event_id" is null
            and "inbox_v2_source_normalized_quarantines"."existing_source_connection_id" is null
            and "inbox_v2_source_normalized_quarantines"."existing_source_account_scope_key" is null
            and "inbox_v2_source_normalized_quarantines"."existing_event_type" is null
            and "inbox_v2_source_normalized_quarantines"."existing_safe_envelope_hmac_sha256" is null)
          or ("inbox_v2_source_normalized_quarantines"."reason_code" = 'source.idempotency_collision'
            and "inbox_v2_source_normalized_quarantines"."normalized_ordinal" is not null
            and "inbox_v2_source_normalized_quarantines"."normalized_ordinal" >= 0
            and "inbox_v2_source_normalized_quarantines"."event_type" is not null
            and char_length("inbox_v2_source_normalized_quarantines"."event_type") between 1 and 128
    and "inbox_v2_source_normalized_quarantines"."event_type" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
            and "inbox_v2_source_normalized_quarantines"."idempotency_key_hmac_sha256" is not null
            and "inbox_v2_source_normalized_quarantines"."idempotency_key_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and "inbox_v2_source_normalized_quarantines"."safe_envelope_hmac_sha256" is not null
            and "inbox_v2_source_normalized_quarantines"."safe_envelope_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and "inbox_v2_source_normalized_quarantines"."existing_normalized_event_id" is not null
            and "inbox_v2_source_normalized_quarantines"."existing_raw_event_id" is not null
            and "inbox_v2_source_normalized_quarantines"."existing_source_connection_id" is not null
            and "inbox_v2_source_normalized_quarantines"."existing_source_account_scope_key" is not null
            and "inbox_v2_source_normalized_quarantines"."existing_event_type" is not null
            and char_length("inbox_v2_source_normalized_quarantines"."existing_event_type") between 1 and 128
    and "inbox_v2_source_normalized_quarantines"."existing_event_type" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
            and "inbox_v2_source_normalized_quarantines"."existing_safe_envelope_hmac_sha256" is not null
            and "inbox_v2_source_normalized_quarantines"."existing_safe_envelope_hmac_sha256" ~ '^hmac-sha256:[0-9a-f]{64}$'
            and (
              "inbox_v2_source_normalized_quarantines"."raw_event_id" <> "inbox_v2_source_normalized_quarantines"."existing_raw_event_id"
              or "inbox_v2_source_normalized_quarantines"."source_connection_id" <>
                "inbox_v2_source_normalized_quarantines"."existing_source_connection_id"
              or "inbox_v2_source_normalized_quarantines"."source_account_scope_key" <>
                "inbox_v2_source_normalized_quarantines"."existing_source_account_scope_key"
              or "inbox_v2_source_normalized_quarantines"."event_type" <> "inbox_v2_source_normalized_quarantines"."existing_event_type"
              or "inbox_v2_source_normalized_quarantines"."safe_envelope_hmac_sha256" <>
                "inbox_v2_source_normalized_quarantines"."existing_safe_envelope_hmac_sha256"
            ))
        ))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalization_results" ADD CONSTRAINT "inbox_v2_source_normalization_results_raw_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalization_results" ADD CONSTRAINT "inbox_v2_source_normalization_results_quarantine_fk" FOREIGN KEY ("tenant_id","quarantine_id","raw_event_id","reason_code","digest_key_generation","candidate_completion_hmac_sha256") REFERENCES "public"."inbox_v2_source_normalized_quarantines"("tenant_id","id","raw_event_id","reason_code","digest_key_generation","candidate_completion_hmac_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_anchor_fk" FOREIGN KEY ("tenant_id","normalized_event_id") REFERENCES "public"."normalized_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_raw_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_raw_connection_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_raw_account_scope_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_envelopes" ADD CONSTRAINT "inbox_v2_source_normalized_envelopes_account_edge_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_evidence" ADD CONSTRAINT "inbox_v2_source_normalized_evidence_envelope_fk" FOREIGN KEY ("tenant_id","normalized_event_id") REFERENCES "public"."inbox_v2_source_normalized_envelopes"("tenant_id","normalized_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_evidence_payloads" ADD CONSTRAINT "inbox_v2_source_normalized_evidence_payloads_reference_fk" FOREIGN KEY ("tenant_id","normalized_event_id","evidence_key") REFERENCES "public"."inbox_v2_source_normalized_evidence"("tenant_id","normalized_event_id","evidence_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_quarantines" ADD CONSTRAINT "inbox_v2_source_normalized_quarantines_raw_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_quarantines" ADD CONSTRAINT "inbox_v2_source_normalized_quarantines_raw_connection_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_quarantines" ADD CONSTRAINT "inbox_v2_source_normalized_quarantines_raw_account_scope_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_normalized_quarantines" ADD CONSTRAINT "inbox_v2_source_normalized_quarantines_existing_fk" FOREIGN KEY ("tenant_id","existing_normalized_event_id","existing_raw_event_id","existing_source_connection_id","existing_source_account_scope_key","existing_event_type","existing_safe_envelope_hmac_sha256") REFERENCES "public"."inbox_v2_source_normalized_envelopes"("tenant_id","normalized_event_id","raw_event_id","source_connection_id","source_account_scope_key","event_type","safe_envelope_hmac_sha256") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalization_results_completed_idx" ON "inbox_v2_source_normalization_results" USING btree ("tenant_id","completed_at","raw_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_envelopes_raw_idx" ON "inbox_v2_source_normalized_envelopes" USING btree ("tenant_id","raw_event_id","normalized_ordinal");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_envelopes_connection_idx" ON "inbox_v2_source_normalized_envelopes" USING btree ("tenant_id","source_connection_id","normalized_at","normalized_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_envelopes_account_idx" ON "inbox_v2_source_normalized_envelopes" USING btree ("tenant_id","source_account_scope_key","normalized_at","normalized_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_evidence_recorded_idx" ON "inbox_v2_source_normalized_evidence" USING btree ("tenant_id","created_at","normalized_event_id");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_evidence_payloads_recorded_idx" ON "inbox_v2_source_normalized_evidence_payloads" USING btree ("tenant_id","recorded_at","normalized_event_id","evidence_key");
--> statement-breakpoint
CREATE INDEX "inbox_v2_source_normalized_quarantines_raw_idx" ON "inbox_v2_source_normalized_quarantines" USING btree ("tenant_id","raw_event_id","recorded_at","id");
--> statement-breakpoint
-- INBOX_V2_SOURCE_NORMALIZATION_FINALIZED_V1
create or replace function public.inbox_v2_source_normalized_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_source_normalized_evidence_payloads'
     and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception '% is immutable', tg_table_name using errcode = '23514';
end
$function$;

create trigger inbox_v2_source_normalized_envelopes_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_envelopes
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_evidence
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_payloads_immutable_trigger
before update on public.inbox_v2_source_normalized_evidence_payloads
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_quarantines_immutable_trigger
before update or delete on public.inbox_v2_source_normalized_quarantines
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalization_results_immutable_trigger
before update or delete on public.inbox_v2_source_normalization_results
for each row execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_envelopes_truncate_guard
before truncate on public.inbox_v2_source_normalized_envelopes
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_truncate_guard
before truncate on public.inbox_v2_source_normalized_evidence
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_evidence_payloads_truncate_guard
before truncate on public.inbox_v2_source_normalized_evidence_payloads
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalized_quarantines_truncate_guard
before truncate on public.inbox_v2_source_normalized_quarantines
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create trigger inbox_v2_source_normalization_results_truncate_guard
before truncate on public.inbox_v2_source_normalization_results
for each statement execute function public.inbox_v2_source_normalized_reject_immutable();

create or replace function public.inbox_v2_source_normalized_anchor_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if old.idempotency_key like 'source:v2:normalized:%' then
    raise exception 'V2 normalized compatibility anchor is immutable'
      using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

create trigger inbox_v2_source_normalized_anchor_immutable_trigger
before update or delete on public.normalized_inbound_events
for each row execute function public.inbox_v2_source_normalized_anchor_guard();

create or replace function public.inbox_v2_source_normalized_assert_aggregate()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_normalized_event_id text;
  v_anchor public.normalized_inbound_events%rowtype;
  v_envelope public.inbox_v2_source_normalized_envelopes%rowtype;
  v_result public.inbox_v2_source_normalization_results%rowtype;
  v_evidence_count bigint;
  v_payload_count bigint;
  v_raw_event_count bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'normalized_inbound_events' then
    v_normalized_event_id := new.id;
  else
    v_normalized_event_id := new.normalized_event_id;
  end if;

  select * into v_anchor
    from public.normalized_inbound_events event_row
   where event_row.tenant_id = v_tenant_id
     and event_row.id = v_normalized_event_id;
  select * into v_envelope
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.normalized_event_id = v_normalized_event_id;

  if v_envelope.normalized_event_id is null then
    if v_anchor.id is not null
       and v_anchor.idempotency_key like 'source:v2:normalized:%' then
      raise exception 'V2 normalized anchor requires an immutable envelope'
        using errcode = '23514';
    end if;
    return null;
  end if;

  if v_anchor.id is null
     or v_anchor.raw_event_id <> v_envelope.raw_event_id
     or v_anchor.source_connection_id <> v_envelope.source_connection_id
     or v_anchor.source_account_id is distinct from v_envelope.source_account_id
     or v_anchor.source_type <> v_envelope.source_type
     or v_anchor.source_name <> v_envelope.source_name
     or v_anchor.event_type <> v_envelope.event_type
     or v_anchor.direction <> v_envelope.direction
     or v_anchor.visibility <> v_envelope.visibility
     or v_anchor.payload_version <> v_envelope.payload_schema_version
     or v_anchor.idempotency_key <> v_envelope.idempotency_key
     or v_anchor.external_thread_id is not null
     or v_anchor.external_message_id is not null
     or v_anchor.external_user_id is not null
     or v_anchor.normalized_payload <> '{}'::jsonb
     or v_anchor.reply_capability <> '{}'::jsonb
     or v_anchor.conversation_id is not null
     or v_anchor.message_id is not null
     or v_anchor.processing_status <> 'ignored'
     or v_anchor.created_at <> v_envelope.created_at
     or v_anchor.updated_at <> v_envelope.created_at then
    raise exception 'V2 normalized compatibility anchor is unsafe or incoherent'
      using errcode = '23514';
  end if;

  select count(*) into v_evidence_count
    from public.inbox_v2_source_normalized_evidence evidence_row
   where evidence_row.tenant_id = v_tenant_id
     and evidence_row.normalized_event_id = v_normalized_event_id;
  select count(*) into v_payload_count
    from public.inbox_v2_source_normalized_evidence_payloads payload_row
   where payload_row.tenant_id = v_tenant_id
     and payload_row.normalized_event_id = v_normalized_event_id;

  if tg_table_name <> 'inbox_v2_source_normalized_evidence_payloads'
     and (v_evidence_count <> v_envelope.normalized_evidence_count
       or v_payload_count <> v_evidence_count) then
    raise exception 'V2 normalized envelope has incoherent evidence references'
      using errcode = '23514';
  end if;

  select * into v_result
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = v_tenant_id
     and result_row.raw_event_id = v_envelope.raw_event_id;
  select count(*) into v_raw_event_count
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.raw_event_id = v_envelope.raw_event_id;

  if v_result.raw_event_id is null
     or v_raw_event_count <> v_result.normalized_event_count
     or (v_result.outcome = 'normalized' and v_raw_event_count < 1)
     or (v_result.outcome <> 'normalized' and v_raw_event_count <> 0) then
    raise exception 'V2 normalized aggregate requires its exact immutable terminal result'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create constraint trigger inbox_v2_source_normalized_anchor_constraint
after insert or update on public.normalized_inbound_events
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_envelope_constraint
after insert on public.inbox_v2_source_normalized_envelopes
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_evidence_constraint
after insert on public.inbox_v2_source_normalized_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create constraint trigger inbox_v2_source_normalized_evidence_payload_constraint
after insert on public.inbox_v2_source_normalized_evidence_payloads
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalized_assert_aggregate();

create or replace function public.inbox_v2_source_normalization_assert_result()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_work_count bigint;
  v_event_count bigint;
  v_quarantine_count bigint;
begin
  select count(*) into v_work_count
    from public.inbox_v2_source_raw_work_items work_row
   where work_row.tenant_id = new.tenant_id
     and work_row.raw_event_id = new.raw_event_id;
  select count(*) into v_event_count
    from public.inbox_v2_source_normalized_envelopes envelope_row
   where envelope_row.tenant_id = new.tenant_id
     and envelope_row.raw_event_id = new.raw_event_id;
  select count(*) into v_quarantine_count
    from public.inbox_v2_source_normalized_quarantines quarantine_row
   where quarantine_row.tenant_id = new.tenant_id
     and quarantine_row.id = new.quarantine_id
     and quarantine_row.raw_event_id = new.raw_event_id
     and quarantine_row.reason_code = new.reason_code
     and quarantine_row.digest_key_generation = new.digest_key_generation
     and quarantine_row.candidate_completion_hmac_sha256 =
       new.candidate_completion_hmac_sha256;

  if v_work_count <> 0
     or v_event_count <> new.normalized_event_count
     or (new.outcome = 'normalized' and v_event_count < 1)
     or (new.outcome <> 'normalized' and v_event_count <> 0)
     or (new.outcome = 'quarantined' and v_quarantine_count <> 1)
     or (new.outcome <> 'quarantined' and v_quarantine_count <> 0) then
    raise exception 'V2 source normalization result is not a closed aggregate'
      using errcode = '23514';
  end if;
  return null;
end
$function$;

create constraint trigger inbox_v2_source_normalization_result_constraint
after insert on public.inbox_v2_source_normalization_results
deferrable initially deferred
for each row execute function public.inbox_v2_source_normalization_assert_result();

create or replace function public.inbox_v2_source_raw_evidence_delete_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if exists (
    select 1
      from public.inbox_v2_source_raw_work_items work_row
     where work_row.tenant_id = old.tenant_id
       and work_row.raw_event_id = old.raw_event_id
  ) then
    raise exception 'Raw source evidence cannot be purged before normalization completes'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

create trigger inbox_v2_source_raw_evidence_normalization_delete_guard
before delete on public.inbox_v2_source_raw_evidence
for each row execute function public.inbox_v2_source_raw_evidence_delete_guard();

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
  v_result_count bigint;
  v_payload_count bigint;
  v_header_count bigint;
begin
  v_tenant_id := new.tenant_id;
  if tg_table_name = 'raw_inbound_events' then
    v_raw_event_id := new.id;
  else
    v_raw_event_id := new.raw_event_id;
  end if;

  select * into v_anchor
    from public.raw_inbound_events raw_row
   where raw_row.tenant_id = v_tenant_id
     and raw_row.id = v_raw_event_id;
  select * into v_envelope
    from public.inbox_v2_source_raw_envelopes envelope_row
   where envelope_row.tenant_id = v_tenant_id
     and envelope_row.raw_event_id = v_raw_event_id;

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
    from public.inbox_v2_source_raw_work_items work_row
   where work_row.tenant_id = v_tenant_id
     and work_row.raw_event_id = v_raw_event_id;
  select count(*) into v_result_count
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = v_tenant_id
     and result_row.raw_event_id = v_raw_event_id;
  select count(*) filter (where evidence_row.evidence_kind = 'provider_payload'),
         count(*) filter (where evidence_row.evidence_kind = 'allowed_headers')
    into v_payload_count, v_header_count
    from public.inbox_v2_source_raw_evidence evidence_row
   where evidence_row.tenant_id = v_tenant_id
     and evidence_row.raw_event_id = v_raw_event_id;

  if v_work_count + v_result_count <> 1
     or (
       tg_table_name <> 'inbox_v2_source_raw_work_items'
       and (
         (v_envelope.provider_payload_evidence_present and v_payload_count <> 1)
         or (not v_envelope.provider_payload_evidence_present and v_payload_count <> 0)
         or (v_envelope.allowed_headers_evidence_present and v_header_count <> 1)
         or (not v_envelope.allowed_headers_evidence_present and v_header_count <> 0)
       )
     ) then
    raise exception 'V2 raw aggregate requires exactly one work or completion head and exact evidence flags'
      using errcode = '23514';
  end if;

  return null;
end
$function$;

create or replace function public.inbox_v2_source_normalization_complete_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_result public.inbox_v2_source_normalization_results%rowtype;
begin
  select * into v_result
    from public.inbox_v2_source_normalization_results result_row
   where result_row.tenant_id = old.tenant_id
     and result_row.raw_event_id = old.raw_event_id;

  if old.state <> 'leased'
     or v_result.raw_event_id is null
     or v_result.worker_id <> old.lease_owner_id
     or v_result.completed_attempt_count <> old.attempt_count
     or v_result.completed_reclaim_count <> old.reclaim_count
     or v_result.completed_lease_token_hash <> old.lease_token_hash
     or v_result.completed_lease_revision <> old.lease_revision
     or v_result.completed_lease_claimed_at <> old.lease_claimed_at
     or v_result.completed_lease_expires_at <> old.lease_expires_at
     or v_result.completed_work_revision <> old.revision
     or v_result.completed_at < old.updated_at
     or v_result.completed_at >= old.lease_expires_at
     or clock_timestamp() >= old.lease_expires_at then
    raise exception 'Raw work completion requires the exact unexpired lease result'
      using errcode = '23514';
  end if;
  return old;
end
$function$;

drop trigger inbox_v2_source_raw_work_guard_trigger
  on public.inbox_v2_source_raw_work_items;

create trigger inbox_v2_source_raw_work_guard_trigger
before insert or update on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_raw_work_guard();

create trigger inbox_v2_source_raw_work_completion_delete_trigger
before delete on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_normalization_complete_work_guard();
