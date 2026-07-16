CREATE TYPE "public"."inbox_v2_source_raw_evidence_kind" AS ENUM('provider_payload', 'allowed_headers');--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_raw_quarantine_reason" AS ENUM('source.payload_shape_unknown', 'source.payload_malformed', 'source.headers_malformed', 'source.sanitizer_rejected', 'source.sanitizer_failed', 'source.sanitizer_output_invalid', 'source.idempotency_collision');--> statement-breakpoint
CREATE TYPE "public"."inbox_v2_source_raw_work_state" AS ENUM('pending', 'leased');--> statement-breakpoint
CREATE TABLE "inbox_v2_source_raw_envelopes" (
	"tenant_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"transport_kind" text NOT NULL,
	"event_identity_kind" text NOT NULL,
	"event_identity_digest_sha256" text NOT NULL,
	"safe_envelope_schema_id" text NOT NULL,
	"safe_envelope_schema_version" text NOT NULL,
	"safe_envelope_digest_sha256" text NOT NULL,
	"sanitizer_id" text NOT NULL,
	"sanitizer_version" text NOT NULL,
	"sanitizer_declaration_revision" bigint NOT NULL,
	"provider_payload_evidence_present" boolean NOT NULL,
	"allowed_headers_evidence_present" boolean NOT NULL,
	"data_class_id" text NOT NULL,
	"sensitivity_class" text NOT NULL,
	"processing_purpose_id" text NOT NULL,
	"canonical_anchor_id" text NOT NULL,
	"expiry_action" text NOT NULL,
	"accepted_at" timestamp (3) with time zone NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_raw_envelopes_pk" PRIMARY KEY("tenant_id","raw_event_id"),
	CONSTRAINT "inbox_v2_source_raw_envelopes_idempotency_unique" UNIQUE("tenant_id","idempotency_key"),
	CONSTRAINT "inbox_v2_source_raw_envelopes_digest_unique" UNIQUE("tenant_id","raw_event_id","safe_envelope_digest_sha256"),
	CONSTRAINT "inbox_v2_source_raw_envelopes_exact_scope_unique" UNIQUE("tenant_id","raw_event_id","source_connection_id","source_account_scope_key","transport_kind","event_identity_kind","event_identity_digest_sha256","safe_envelope_digest_sha256"),
	CONSTRAINT "inbox_v2_source_raw_envelopes_scope_check" CHECK ("inbox_v2_source_raw_envelopes"."source_account_scope_key" = case
    when "inbox_v2_source_raw_envelopes"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_raw_envelopes"."source_account_id")::text || ':' || "inbox_v2_source_raw_envelopes"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_source_raw_envelopes_identity_check" CHECK ("inbox_v2_source_raw_envelopes"."idempotency_key" ~ '^source:v2:raw:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_raw_envelopes"."transport_kind") between 1 and 128
    and "inbox_v2_source_raw_envelopes"."transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and char_length("inbox_v2_source_raw_envelopes"."event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_envelopes"."event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and "inbox_v2_source_raw_envelopes"."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
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
        and "inbox_v2_source_raw_envelopes"."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'),
	CONSTRAINT "inbox_v2_source_raw_envelopes_sanitizer_check" CHECK (char_length("inbox_v2_source_raw_envelopes"."sanitizer_id") <= 256 and (
    (
      "inbox_v2_source_raw_envelopes"."sanitizer_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_envelopes"."sanitizer_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_raw_envelopes"."sanitizer_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_envelopes"."sanitizer_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_raw_envelopes"."sanitizer_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_raw_envelopes"."sanitizer_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_raw_envelopes"."sanitizer_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_raw_envelopes"."sanitizer_declaration_revision" >= 1),
	CONSTRAINT "inbox_v2_source_raw_envelopes_lifecycle_check" CHECK ("inbox_v2_source_raw_envelopes"."data_class_id" = 'core:raw_event_envelope'
        and "inbox_v2_source_raw_envelopes"."sensitivity_class" = 'personal_operational'
        and "inbox_v2_source_raw_envelopes"."processing_purpose_id" = 'core:source_replay_and_diagnostics'
        and "inbox_v2_source_raw_envelopes"."canonical_anchor_id" = 'core:terminal_processing'
        and "inbox_v2_source_raw_envelopes"."expiry_action" = 'compact_to_safe_skeleton'),
	CONSTRAINT "inbox_v2_source_raw_envelopes_times_check" CHECK (isfinite("inbox_v2_source_raw_envelopes"."accepted_at")
        and isfinite("inbox_v2_source_raw_envelopes"."created_at")
        and "inbox_v2_source_raw_envelopes"."created_at" >= "inbox_v2_source_raw_envelopes"."accepted_at")
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_raw_evidence" (
	"tenant_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"evidence_kind" "inbox_v2_source_raw_evidence_kind" NOT NULL,
	"data_class_id" text NOT NULL,
	"sensitivity_class" text NOT NULL,
	"purpose_ids" jsonb NOT NULL,
	"evidence_schema_id" text NOT NULL,
	"evidence_schema_version" text NOT NULL,
	"content_digest_sha256" text NOT NULL,
	"content" jsonb NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_raw_evidence_pk" PRIMARY KEY("tenant_id","raw_event_id","evidence_kind"),
	CONSTRAINT "inbox_v2_source_raw_evidence_classification_check" CHECK ((
          "inbox_v2_source_raw_evidence"."evidence_kind" = 'provider_payload'
          and "inbox_v2_source_raw_evidence"."data_class_id" = 'core:raw_provider_payload'
          and "inbox_v2_source_raw_evidence"."sensitivity_class" = 'restricted_content'
        ) or (
          "inbox_v2_source_raw_evidence"."evidence_kind" = 'allowed_headers'
          and "inbox_v2_source_raw_evidence"."data_class_id" = 'core:raw_provider_allowed_headers'
          and "inbox_v2_source_raw_evidence"."sensitivity_class" = 'personal_identifier'
        )),
	CONSTRAINT "inbox_v2_source_raw_evidence_purpose_check" CHECK ("inbox_v2_source_raw_evidence"."purpose_ids" in (
          '["core:source_replay_and_diagnostics"]'::jsonb,
          '["core:security_and_fraud_prevention"]'::jsonb,
          '["core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb,
          '["core:source_replay_and_diagnostics","core:security_and_fraud_prevention","core:legal_claim_or_regulatory_duty"]'::jsonb
        )),
	CONSTRAINT "inbox_v2_source_raw_evidence_content_check" CHECK (char_length("inbox_v2_source_raw_evidence"."evidence_schema_id") <= 256 and (
    (
      "inbox_v2_source_raw_evidence"."evidence_schema_id" ~ '^core:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_evidence"."evidence_schema_id", ':', 2)) <= 160
    ) or (
      "inbox_v2_source_raw_evidence"."evidence_schema_id" ~ '^module:[a-z][a-z0-9]*([._-][a-z0-9]+)*:[a-z][a-z0-9]*([._-][a-z0-9]+)*$'
      and char_length(split_part("inbox_v2_source_raw_evidence"."evidence_schema_id", ':', 2)) <= 80
      and char_length(split_part("inbox_v2_source_raw_evidence"."evidence_schema_id", ':', 3)) <= 160
      and split_part("inbox_v2_source_raw_evidence"."evidence_schema_id", ':', 2) not in (
        'core', 'hulee', 'module', 'platform', 'system'
      )
    )
  )
        and "inbox_v2_source_raw_evidence"."evidence_schema_version" ~ '^v[1-9][0-9]*$'
        and "inbox_v2_source_raw_evidence"."content_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and jsonb_typeof("inbox_v2_source_raw_evidence"."content") = 'object'
        and isfinite("inbox_v2_source_raw_evidence"."recorded_at"))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_raw_quarantines" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"reason_code" "inbox_v2_source_raw_quarantine_reason" NOT NULL,
	"quarantine_fingerprint_sha256" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_account_id" text,
	"source_account_scope_key" text NOT NULL,
	"transport_kind" text NOT NULL,
	"event_identity_kind" text,
	"event_identity_digest_sha256" text,
	"idempotency_key_digest_sha256" text,
	"safe_envelope_digest_sha256" text,
	"existing_raw_event_id" text,
	"existing_source_connection_id" text,
	"existing_source_account_scope_key" text,
	"existing_transport_kind" text,
	"existing_event_identity_kind" text,
	"existing_event_identity_digest_sha256" text,
	"existing_safe_envelope_digest_sha256" text,
	"sanitizer_id" text NOT NULL,
	"sanitizer_version" text NOT NULL,
	"sanitizer_declaration_revision" bigint NOT NULL,
	"recorded_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_raw_quarantines_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_source_raw_quarantines_fingerprint_unique" UNIQUE("tenant_id","quarantine_fingerprint_sha256"),
	CONSTRAINT "inbox_v2_source_raw_quarantines_scope_check" CHECK ("inbox_v2_source_raw_quarantines"."source_account_scope_key" = case
    when "inbox_v2_source_raw_quarantines"."source_account_id" is null then '0:'
    else '1:' || octet_length("inbox_v2_source_raw_quarantines"."source_account_id")::text || ':' || "inbox_v2_source_raw_quarantines"."source_account_id"
  end),
	CONSTRAINT "inbox_v2_source_raw_quarantines_safe_values_check" CHECK ("inbox_v2_source_raw_quarantines"."quarantine_fingerprint_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and char_length("inbox_v2_source_raw_quarantines"."transport_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$'
        and ("inbox_v2_source_raw_quarantines"."event_identity_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and ("inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_quarantines"."idempotency_key_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."idempotency_key_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_quarantines"."existing_transport_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."existing_transport_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."existing_transport_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and ("inbox_v2_source_raw_quarantines"."existing_event_identity_kind" is null
          or char_length("inbox_v2_source_raw_quarantines"."existing_event_identity_kind") between 1 and 128
    and "inbox_v2_source_raw_quarantines"."existing_event_identity_kind" ~ '^[a-z][a-z0-9]*([._:-][a-z0-9]+)*$')
        and ("inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" is null
          or "inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" ~ '^sha256:[0-9a-f]{64}$')
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
        and isfinite("inbox_v2_source_raw_quarantines"."recorded_at")),
	CONSTRAINT "inbox_v2_source_raw_quarantines_reason_shape_check" CHECK ((
          "inbox_v2_source_raw_quarantines"."reason_code" = 'source.idempotency_collision'
          and "inbox_v2_source_raw_quarantines"."event_identity_kind" is not null
          and "inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" is not null
          and "inbox_v2_source_raw_quarantines"."idempotency_key_digest_sha256" is not null
          and "inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" is not null
          and "inbox_v2_source_raw_quarantines"."existing_raw_event_id" is not null
          and "inbox_v2_source_raw_quarantines"."existing_source_connection_id" is not null
          and "inbox_v2_source_raw_quarantines"."existing_source_account_scope_key" is not null
          and "inbox_v2_source_raw_quarantines"."existing_transport_kind" is not null
          and "inbox_v2_source_raw_quarantines"."existing_event_identity_kind" is not null
          and "inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" is not null
          and "inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" is not null
          and (
            "inbox_v2_source_raw_quarantines"."source_connection_id" <>
              "inbox_v2_source_raw_quarantines"."existing_source_connection_id"
            or "inbox_v2_source_raw_quarantines"."source_account_scope_key" <>
              "inbox_v2_source_raw_quarantines"."existing_source_account_scope_key"
            or "inbox_v2_source_raw_quarantines"."transport_kind" <> "inbox_v2_source_raw_quarantines"."existing_transport_kind"
            or "inbox_v2_source_raw_quarantines"."event_identity_kind" <>
              "inbox_v2_source_raw_quarantines"."existing_event_identity_kind"
            or "inbox_v2_source_raw_quarantines"."event_identity_digest_sha256" <>
              "inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256"
            or "inbox_v2_source_raw_quarantines"."safe_envelope_digest_sha256" <>
              "inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256"
          )
        ) or (
          "inbox_v2_source_raw_quarantines"."reason_code" in (
            'source.payload_shape_unknown',
            'source.payload_malformed',
            'source.headers_malformed',
            'source.sanitizer_rejected',
            'source.sanitizer_failed',
            'source.sanitizer_output_invalid'
          )
          and "inbox_v2_source_raw_quarantines"."existing_raw_event_id" is null
          and "inbox_v2_source_raw_quarantines"."existing_source_connection_id" is null
          and "inbox_v2_source_raw_quarantines"."existing_source_account_scope_key" is null
          and "inbox_v2_source_raw_quarantines"."existing_transport_kind" is null
          and "inbox_v2_source_raw_quarantines"."existing_event_identity_kind" is null
          and "inbox_v2_source_raw_quarantines"."existing_event_identity_digest_sha256" is null
          and "inbox_v2_source_raw_quarantines"."existing_safe_envelope_digest_sha256" is null
        ))
);
--> statement-breakpoint
CREATE TABLE "inbox_v2_source_raw_work_items" (
	"tenant_id" text NOT NULL,
	"raw_event_id" text NOT NULL,
	"state" "inbox_v2_source_raw_work_state" NOT NULL,
	"available_at" timestamp (3) with time zone NOT NULL,
	"attempt_count" bigint NOT NULL,
	"lease_owner_id" text,
	"lease_token_hash" text,
	"lease_revision" bigint,
	"lease_claimed_at" timestamp (3) with time zone,
	"lease_expires_at" timestamp (3) with time zone,
	"reclaim_count" bigint NOT NULL,
	"last_reclaimed_at" timestamp (3) with time zone,
	"last_reclaimed_from_expires_at" timestamp (3) with time zone,
	"last_reclaimed_lease_owner_id" text,
	"last_reclaimed_lease_token_hash" text,
	"last_reclaimed_lease_revision" bigint,
	"revision" bigint NOT NULL,
	"created_at" timestamp (3) with time zone NOT NULL,
	"updated_at" timestamp (3) with time zone NOT NULL,
	CONSTRAINT "inbox_v2_source_raw_work_items_pk" PRIMARY KEY("tenant_id","raw_event_id"),
	CONSTRAINT "inbox_v2_source_raw_work_items_values_check" CHECK ("inbox_v2_source_raw_work_items"."attempt_count" >= 0
        and "inbox_v2_source_raw_work_items"."reclaim_count" >= 0
        and "inbox_v2_source_raw_work_items"."reclaim_count" <= "inbox_v2_source_raw_work_items"."attempt_count"
        and "inbox_v2_source_raw_work_items"."revision" >= 1
        and ("inbox_v2_source_raw_work_items"."lease_owner_id" is null
          or char_length("inbox_v2_source_raw_work_items"."lease_owner_id") between 1 and 256)
        and ("inbox_v2_source_raw_work_items"."lease_token_hash" is null
          or "inbox_v2_source_raw_work_items"."lease_token_hash" ~ '^sha256:[0-9a-f]{64}$')
        and ("inbox_v2_source_raw_work_items"."last_reclaimed_lease_owner_id" is null
          or char_length("inbox_v2_source_raw_work_items"."last_reclaimed_lease_owner_id") between 1 and 256)
        and ("inbox_v2_source_raw_work_items"."last_reclaimed_lease_token_hash" is null
          or "inbox_v2_source_raw_work_items"."last_reclaimed_lease_token_hash" ~ '^sha256:[0-9a-f]{64}$')),
	CONSTRAINT "inbox_v2_source_raw_work_items_state_check" CHECK ((
          "inbox_v2_source_raw_work_items"."state" = 'pending'
          and "inbox_v2_source_raw_work_items"."lease_owner_id" is null
          and "inbox_v2_source_raw_work_items"."lease_token_hash" is null
          and "inbox_v2_source_raw_work_items"."lease_revision" is null
          and "inbox_v2_source_raw_work_items"."lease_claimed_at" is null
          and "inbox_v2_source_raw_work_items"."lease_expires_at" is null
        ) or (
          "inbox_v2_source_raw_work_items"."state" = 'leased'
          and "inbox_v2_source_raw_work_items"."attempt_count" >= 1
          and "inbox_v2_source_raw_work_items"."lease_owner_id" is not null
          and "inbox_v2_source_raw_work_items"."lease_token_hash" is not null
          and "inbox_v2_source_raw_work_items"."lease_revision" = "inbox_v2_source_raw_work_items"."revision"
          and "inbox_v2_source_raw_work_items"."lease_claimed_at" is not null
          and "inbox_v2_source_raw_work_items"."lease_expires_at" is not null
        )),
	CONSTRAINT "inbox_v2_source_raw_work_items_reclaim_check" CHECK ((
          "inbox_v2_source_raw_work_items"."reclaim_count" = 0
          and "inbox_v2_source_raw_work_items"."last_reclaimed_at" is null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_from_expires_at" is null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_owner_id" is null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_token_hash" is null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_revision" is null
        ) or (
          "inbox_v2_source_raw_work_items"."reclaim_count" >= 1
          and "inbox_v2_source_raw_work_items"."last_reclaimed_at" is not null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_from_expires_at" is not null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_owner_id" is not null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_token_hash" is not null
          and "inbox_v2_source_raw_work_items"."last_reclaimed_lease_revision" >= 1
        )),
	CONSTRAINT "inbox_v2_source_raw_work_items_times_check" CHECK (isfinite("inbox_v2_source_raw_work_items"."available_at")
        and isfinite("inbox_v2_source_raw_work_items"."created_at")
        and isfinite("inbox_v2_source_raw_work_items"."updated_at")
        and "inbox_v2_source_raw_work_items"."updated_at" >= "inbox_v2_source_raw_work_items"."created_at"
        and ("inbox_v2_source_raw_work_items"."lease_claimed_at" is null or (
          isfinite("inbox_v2_source_raw_work_items"."lease_claimed_at")
          and "inbox_v2_source_raw_work_items"."lease_claimed_at" between "inbox_v2_source_raw_work_items"."created_at" and
            "inbox_v2_source_raw_work_items"."updated_at"
        ))
        and ("inbox_v2_source_raw_work_items"."lease_expires_at" is null or (
          isfinite("inbox_v2_source_raw_work_items"."lease_expires_at")
          and "inbox_v2_source_raw_work_items"."lease_expires_at" > "inbox_v2_source_raw_work_items"."updated_at"
        ))
        and ("inbox_v2_source_raw_work_items"."last_reclaimed_at" is null or (
          isfinite("inbox_v2_source_raw_work_items"."last_reclaimed_at")
          and "inbox_v2_source_raw_work_items"."last_reclaimed_at" between "inbox_v2_source_raw_work_items"."created_at" and
            "inbox_v2_source_raw_work_items"."updated_at"
        ))
        and ("inbox_v2_source_raw_work_items"."last_reclaimed_from_expires_at" is null or (
          isfinite("inbox_v2_source_raw_work_items"."last_reclaimed_from_expires_at")
          and "inbox_v2_source_raw_work_items"."last_reclaimed_from_expires_at" <= "inbox_v2_source_raw_work_items"."last_reclaimed_at"
        )))
);
--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_anchor_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_anchor_connection_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_anchor_account_scope_fk" FOREIGN KEY ("tenant_id","raw_event_id","source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_envelopes" ADD CONSTRAINT "inbox_v2_source_raw_envelopes_account_edge_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_evidence" ADD CONSTRAINT "inbox_v2_source_raw_evidence_envelope_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_tenant_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_account_edge_fk" FOREIGN KEY ("tenant_id","source_account_id","source_connection_id") REFERENCES "public"."source_accounts"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_existing_connection_fk" FOREIGN KEY ("tenant_id","existing_raw_event_id","existing_source_connection_id") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_connection_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_existing_account_scope_fk" FOREIGN KEY ("tenant_id","existing_raw_event_id","existing_source_account_scope_key") REFERENCES "public"."raw_inbound_events"("tenant_id","id","source_account_scope_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_quarantines" ADD CONSTRAINT "inbox_v2_source_raw_quarantines_existing_envelope_fk" FOREIGN KEY ("tenant_id","existing_raw_event_id","existing_source_connection_id","existing_source_account_scope_key","existing_transport_kind","existing_event_identity_kind","existing_event_identity_digest_sha256","existing_safe_envelope_digest_sha256") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id","source_connection_id","source_account_scope_key","transport_kind","event_identity_kind","event_identity_digest_sha256","safe_envelope_digest_sha256") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_raw_work_items" ADD CONSTRAINT "inbox_v2_source_raw_work_items_envelope_fk" FOREIGN KEY ("tenant_id","raw_event_id") REFERENCES "public"."inbox_v2_source_raw_envelopes"("tenant_id","raw_event_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_envelopes_connection_idx" ON "inbox_v2_source_raw_envelopes" USING btree ("tenant_id","source_connection_id","accepted_at","raw_event_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_envelopes_account_idx" ON "inbox_v2_source_raw_envelopes" USING btree ("tenant_id","source_account_scope_key","accepted_at","raw_event_id");--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_evidence_recorded_idx" ON "inbox_v2_source_raw_evidence" USING btree ("tenant_id","recorded_at","raw_event_id","evidence_kind");--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_quarantines_reason_idx" ON "inbox_v2_source_raw_quarantines" USING btree ("tenant_id","reason_code","recorded_at","id");--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_quarantines_connection_idx" ON "inbox_v2_source_raw_quarantines" USING btree ("tenant_id","source_connection_id","recorded_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "inbox_v2_source_raw_work_items_lease_token_unique" ON "inbox_v2_source_raw_work_items" USING btree ("tenant_id","lease_token_hash") WHERE "inbox_v2_source_raw_work_items"."lease_token_hash" is not null;--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_work_items_due_idx" ON "inbox_v2_source_raw_work_items" USING btree ("tenant_id","available_at","raw_event_id") WHERE "inbox_v2_source_raw_work_items"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_work_items_reclaim_idx" ON "inbox_v2_source_raw_work_items" USING btree ("tenant_id","lease_expires_at","raw_event_id") WHERE "inbox_v2_source_raw_work_items"."state" = 'leased';--> statement-breakpoint
CREATE INDEX "inbox_v2_source_raw_work_items_owner_idx" ON "inbox_v2_source_raw_work_items" USING btree ("tenant_id","lease_owner_id","lease_expires_at") WHERE "inbox_v2_source_raw_work_items"."state" = 'leased';--> statement-breakpoint
create or replace function public.inbox_v2_source_raw_reject_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_table_name = 'inbox_v2_source_raw_evidence' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception '% is immutable', tg_table_name using errcode = '23514';
end
$function$;

create trigger inbox_v2_source_raw_envelopes_immutable_trigger
before update or delete on public.inbox_v2_source_raw_envelopes
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_evidence_immutable_trigger
before update on public.inbox_v2_source_raw_evidence
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_quarantines_immutable_trigger
before update or delete on public.inbox_v2_source_raw_quarantines
for each row execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_envelopes_truncate_guard
before truncate on public.inbox_v2_source_raw_envelopes
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_evidence_truncate_guard
before truncate on public.inbox_v2_source_raw_evidence
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_quarantines_truncate_guard
before truncate on public.inbox_v2_source_raw_quarantines
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create trigger inbox_v2_source_raw_work_items_truncate_guard
before truncate on public.inbox_v2_source_raw_work_items
for each statement execute function public.inbox_v2_source_raw_reject_immutable();

create or replace function public.inbox_v2_source_raw_work_guard()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  if tg_op = 'DELETE' then
    raise exception 'Raw work head cannot be deleted' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if new.state <> 'pending'
       or new.attempt_count <> 0
       or new.reclaim_count <> 0
       or new.revision <> 1
       or new.available_at < new.created_at
       or new.updated_at <> new.created_at then
      raise exception 'Raw work head must start pending at revision one'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if new.tenant_id <> old.tenant_id
     or new.raw_event_id <> old.raw_event_id
     or new.created_at <> old.created_at
     or new.revision <> old.revision + 1
     or new.updated_at < old.updated_at then
    raise exception 'Raw work mutation requires immutable identity and +1 CAS'
      using errcode = '23514';
  end if;

  if old.state = 'pending' and new.state = 'leased' then
    if new.available_at <> old.available_at
       or old.available_at > new.lease_claimed_at
       or new.lease_claimed_at <> new.updated_at
       or new.attempt_count <> old.attempt_count + 1
       or new.reclaim_count <> old.reclaim_count
       or new.last_reclaimed_at is distinct from old.last_reclaimed_at
       or new.last_reclaimed_from_expires_at is distinct from
          old.last_reclaimed_from_expires_at
       or new.last_reclaimed_lease_owner_id is distinct from
          old.last_reclaimed_lease_owner_id
       or new.last_reclaimed_lease_token_hash is distinct from
          old.last_reclaimed_lease_token_hash
       or new.last_reclaimed_lease_revision is distinct from
          old.last_reclaimed_lease_revision then
      raise exception 'Pending raw work requires one exact due claim'
        using errcode = '23514';
    end if;
  elsif old.state = 'leased' and new.state = 'leased' then
    if new.lease_claimed_at >= old.lease_expires_at then
      if new.available_at <> old.available_at
         or new.lease_claimed_at <> new.updated_at
         or new.attempt_count <> old.attempt_count + 1
         or new.reclaim_count <> old.reclaim_count + 1
         or new.last_reclaimed_at <> new.lease_claimed_at
         or new.last_reclaimed_from_expires_at <> old.lease_expires_at
         or new.last_reclaimed_lease_owner_id <> old.lease_owner_id
         or new.last_reclaimed_lease_token_hash <> old.lease_token_hash
         or new.last_reclaimed_lease_revision <> old.lease_revision then
        raise exception 'Expired raw lease requires exact fenced reclaim evidence'
          using errcode = '23514';
      end if;
    elsif new.lease_owner_id = old.lease_owner_id
       and new.lease_token_hash = old.lease_token_hash
       and new.lease_claimed_at = old.lease_claimed_at then
      if new.updated_at >= old.lease_expires_at
         or new.lease_expires_at <= old.lease_expires_at
         or new.available_at <> old.available_at
         or new.attempt_count <> old.attempt_count
         or new.reclaim_count <> old.reclaim_count
         or new.last_reclaimed_at is distinct from old.last_reclaimed_at
         or new.last_reclaimed_from_expires_at is distinct from
            old.last_reclaimed_from_expires_at
         or new.last_reclaimed_lease_owner_id is distinct from
            old.last_reclaimed_lease_owner_id
         or new.last_reclaimed_lease_token_hash is distinct from
            old.last_reclaimed_lease_token_hash
         or new.last_reclaimed_lease_revision is distinct from
            old.last_reclaimed_lease_revision then
        raise exception 'Raw lease renewal requires the unexpired exact lease'
          using errcode = '23514';
      end if;
    else
      raise exception 'Raw lease cannot be replaced before expiry'
        using errcode = '23514';
    end if;
  elsif old.state = 'leased' and new.state = 'pending' then
    if new.updated_at >= old.lease_expires_at
       or new.available_at < new.updated_at
       or new.attempt_count <> old.attempt_count
       or new.reclaim_count <> old.reclaim_count
       or new.last_reclaimed_at is distinct from old.last_reclaimed_at
       or new.last_reclaimed_from_expires_at is distinct from
          old.last_reclaimed_from_expires_at
       or new.last_reclaimed_lease_owner_id is distinct from
          old.last_reclaimed_lease_owner_id
       or new.last_reclaimed_lease_token_hash is distinct from
          old.last_reclaimed_lease_token_hash
       or new.last_reclaimed_lease_revision is distinct from
          old.last_reclaimed_lease_revision then
      raise exception 'Raw lease release requires the unexpired exact lease'
        using errcode = '23514';
    end if;
  else
    raise exception 'Illegal raw work state transition' using errcode = '23514';
  end if;

  return new;
end
$function$;

create trigger inbox_v2_source_raw_work_guard_trigger
before insert or update or delete on public.inbox_v2_source_raw_work_items
for each row execute function public.inbox_v2_source_raw_work_guard();

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

  if v_work_count <> 1
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

create constraint trigger inbox_v2_source_raw_anchor_coherence_constraint
after insert or update on public.raw_inbound_events
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_envelope_coherence_constraint
after insert on public.inbox_v2_source_raw_envelopes
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_evidence_coherence_constraint
after insert on public.inbox_v2_source_raw_evidence
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();

create constraint trigger inbox_v2_source_raw_work_coherence_constraint
after insert or update on public.inbox_v2_source_raw_work_items
deferrable initially deferred
for each row execute function public.inbox_v2_source_raw_assert_aggregate();
