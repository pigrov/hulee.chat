CREATE TABLE "inbox_v2_source_onboarding_result_snapshots" (
	"tenant_id" text NOT NULL,
	"id" text NOT NULL,
	"command_record_id" text NOT NULL,
	"client_mutation_id" text NOT NULL,
	"mutation_id" text NOT NULL,
	"stream_commit_id" text NOT NULL,
	"source_connection_id" text NOT NULL,
	"source_transition_id" text NOT NULL,
	"source_registry_revision" bigint NOT NULL,
	"source_type" text NOT NULL,
	"source_name" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"auth_type" text NOT NULL,
	"created_by_employee_id" text NOT NULL,
	"connection_created_at" timestamp (3) with time zone NOT NULL,
	"connection_updated_at" timestamp (3) with time zone NOT NULL,
	"result_digest_sha256" text NOT NULL,
	"result_canonical_json" text NOT NULL,
	"state_payload" jsonb NOT NULL,
	"state_digest_sha256" text NOT NULL,
	"state_canonical_json" text NOT NULL,
	"transition_payload" jsonb NOT NULL,
	"transition_digest_sha256" text NOT NULL,
	"transition_canonical_json" text NOT NULL,
	"audit_target_ref" text NOT NULL,
	"tenant_facet_ref" text NOT NULL,
	"grant_source_mappings" jsonb NOT NULL,
	"copy_slot" text NOT NULL,
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
	CONSTRAINT "inbox_v2_source_onboarding_result_snapshots_pk" PRIMARY KEY("tenant_id","id"),
	CONSTRAINT "inbox_v2_source_onboarding_results_command_unique" UNIQUE("tenant_id","command_record_id"),
	CONSTRAINT "inbox_v2_source_onboarding_results_mutation_unique" UNIQUE("tenant_id","mutation_id"),
	CONSTRAINT "inbox_v2_source_onboarding_results_source_unique" UNIQUE("tenant_id","source_connection_id"),
	CONSTRAINT "inbox_v2_source_onboarding_results_transition_unique" UNIQUE("tenant_id","source_transition_id"),
	CONSTRAINT "inbox_v2_source_onboarding_results_target_ref_unique" UNIQUE("tenant_id","audit_target_ref"),
	CONSTRAINT "inbox_v2_source_onboarding_results_tenant_ref_unique" UNIQUE("tenant_id","tenant_facet_ref"),
	CONSTRAINT "inbox_v2_source_onboarding_results_values_check" CHECK (char_length("inbox_v2_source_onboarding_result_snapshots"."id") between 1 and 512
        and "inbox_v2_source_onboarding_result_snapshots"."id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and char_length("inbox_v2_source_onboarding_result_snapshots"."client_mutation_id") between 1 and 512
        and "inbox_v2_source_onboarding_result_snapshots"."client_mutation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
        and "inbox_v2_source_onboarding_result_snapshots"."source_registry_revision" = 1
        and char_length("inbox_v2_source_onboarding_result_snapshots"."source_name") between 1 and 160
        and char_length("inbox_v2_source_onboarding_result_snapshots"."display_name") between 1 and 200
        and "inbox_v2_source_onboarding_result_snapshots"."status" = 'onboarding'
        and char_length("inbox_v2_source_onboarding_result_snapshots"."source_type") between 1 and 160
        and char_length("inbox_v2_source_onboarding_result_snapshots"."auth_type") between 1 and 160
        and "inbox_v2_source_onboarding_result_snapshots"."result_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_onboarding_result_snapshots"."result_canonical_json"::jsonb->>'protocol' is not distinct from
          'core:inbox-v2.source-onboarding-result@v1'
        and octet_length("inbox_v2_source_onboarding_result_snapshots"."result_canonical_json") <= 8388608
        and "inbox_v2_source_onboarding_result_snapshots"."result_digest_sha256" = 'sha256:' || encode(
          sha256(convert_to("inbox_v2_source_onboarding_result_snapshots"."result_canonical_json", 'UTF8')), 'hex'
        )
        and jsonb_typeof("inbox_v2_source_onboarding_result_snapshots"."state_payload") = 'object'
        and "inbox_v2_source_onboarding_result_snapshots"."state_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_onboarding_result_snapshots"."state_canonical_json"::jsonb = "inbox_v2_source_onboarding_result_snapshots"."state_payload"
        and octet_length("inbox_v2_source_onboarding_result_snapshots"."state_canonical_json") <= 8388608
        and "inbox_v2_source_onboarding_result_snapshots"."state_digest_sha256" = 'sha256:' || encode(
          sha256(convert_to("inbox_v2_source_onboarding_result_snapshots"."state_canonical_json", 'UTF8')), 'hex'
        )
        and jsonb_typeof("inbox_v2_source_onboarding_result_snapshots"."transition_payload") = 'object'
        and "inbox_v2_source_onboarding_result_snapshots"."transition_digest_sha256" ~ '^sha256:[0-9a-f]{64}$'
        and "inbox_v2_source_onboarding_result_snapshots"."transition_canonical_json"::jsonb = "inbox_v2_source_onboarding_result_snapshots"."transition_payload"
        and octet_length("inbox_v2_source_onboarding_result_snapshots"."transition_canonical_json") <= 8388608
        and "inbox_v2_source_onboarding_result_snapshots"."transition_digest_sha256" = 'sha256:' || encode(
          sha256(convert_to("inbox_v2_source_onboarding_result_snapshots"."transition_canonical_json", 'UTF8')), 'hex'
        )
        and "inbox_v2_source_onboarding_result_snapshots"."audit_target_ref" ~ '^internal-ref:[a-f0-9]{64}$'
        and "inbox_v2_source_onboarding_result_snapshots"."tenant_facet_ref" ~ '^internal-ref:[a-f0-9]{64}$'
        and "inbox_v2_source_onboarding_result_snapshots"."audit_target_ref" <> "inbox_v2_source_onboarding_result_snapshots"."tenant_facet_ref"
        and jsonb_typeof("inbox_v2_source_onboarding_result_snapshots"."grant_source_mappings") = 'array'
        and jsonb_array_length("inbox_v2_source_onboarding_result_snapshots"."grant_source_mappings") between 1 and 64
        and "inbox_v2_source_onboarding_result_snapshots"."copy_slot" = 'source_onboarding_result_snapshot'
        and "inbox_v2_source_onboarding_result_snapshots"."data_class_id" = 'core:source_account_connector_metadata'
        and "inbox_v2_source_onboarding_result_snapshots"."storage_root_id" = 'core:source-registry-sql'
        and "inbox_v2_source_onboarding_result_snapshots"."purpose_id" = 'core:source_replay_and_diagnostics'
        and "inbox_v2_source_onboarding_result_snapshots"."canonical_anchor_id" = 'core:disconnect_or_account_termination'
        and "inbox_v2_source_onboarding_result_snapshots"."registry_revision" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."lineage_revision" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."effective_policy_version" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."effective_rule_revision" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."policy_activation_revision" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."policy_activation_head_revision" >= 1
        and "inbox_v2_source_onboarding_result_snapshots"."legal_hold_set_revision" >= 0
        and "inbox_v2_source_onboarding_result_snapshots"."restriction_set_revision" >= 0
        and "inbox_v2_source_onboarding_result_snapshots"."registry_composition_hash" ~ '^[0-9a-f]{64}$'
        and isfinite("inbox_v2_source_onboarding_result_snapshots"."connection_created_at")
        and isfinite("inbox_v2_source_onboarding_result_snapshots"."connection_updated_at")
        and "inbox_v2_source_onboarding_result_snapshots"."connection_updated_at" = "inbox_v2_source_onboarding_result_snapshots"."connection_created_at"
        and isfinite("inbox_v2_source_onboarding_result_snapshots"."created_at")
        and "inbox_v2_source_onboarding_result_snapshots"."created_at" = "inbox_v2_source_onboarding_result_snapshots"."connection_created_at")
);--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_audit_events" DROP CONSTRAINT "inbox_v2_auth_audit_events_reference_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" DROP CONSTRAINT "inbox_v2_auth_command_records_state_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" DROP CONSTRAINT "inbox_v2_auth_command_records_values_check";--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" ADD COLUMN "result_reference" jsonb;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_command_fk" FOREIGN KEY ("tenant_id","command_record_id") REFERENCES "public"."inbox_v2_auth_command_records"("tenant_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_connection_fk" FOREIGN KEY ("tenant_id","source_connection_id") REFERENCES "public"."source_connections"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_transition_fk" FOREIGN KEY ("tenant_id","source_transition_id","source_connection_id","source_registry_revision") REFERENCES "public"."inbox_v2_source_registry_transitions"("tenant_id","transition_id","authority_id","resulting_revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_creator_fk" FOREIGN KEY ("tenant_id","created_by_employee_id") REFERENCES "public"."employees"("tenant_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_policy_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version") REFERENCES "public"."inbox_v2_data_governance_effective_policies"("tenant_id","policy_id","version") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_rule_fk" FOREIGN KEY ("tenant_id","effective_policy_id","effective_policy_version","effective_rule_id","effective_rule_revision") REFERENCES "public"."inbox_v2_data_governance_effective_policy_rules"("tenant_id","policy_id","policy_version","rule_id","rule_revision") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_control_set_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."inbox_v2_data_governance_control_set_heads"("tenant_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_v2_source_onboarding_result_snapshots" ADD CONSTRAINT "inbox_v2_source_onboarding_results_lineage_fk" FOREIGN KEY ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") REFERENCES "public"."inbox_v2_data_governance_data_use_lineages"("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_v2_source_onboarding_results_time_idx" ON "inbox_v2_source_onboarding_result_snapshots" USING btree ("tenant_id","created_at","id");--> statement-breakpoint
CREATE INDEX "inbox_v2_source_onboarding_results_lineage_idx" ON "inbox_v2_source_onboarding_result_snapshots" USING btree ("registry_id","registry_revision","data_class_id","storage_root_id","purpose_id");--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_audit_events" ADD CONSTRAINT "inbox_v2_auth_audit_events_reference_check" CHECK ("inbox_v2_auth_audit_events"."category" = 'privileged_security'
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
        and char_length("inbox_v2_auth_audit_events"."client_mutation_id") between 1 and 512
        and "inbox_v2_auth_audit_events"."client_mutation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
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
        and "inbox_v2_auth_audit_events"."audit_hash" ~ '^sha256:[0-9a-f]{64}$');--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" ADD CONSTRAINT "inbox_v2_auth_command_records_state_check" CHECK (("inbox_v2_auth_command_records"."state" = 'completed'
          and "inbox_v2_auth_command_records"."mutation_id" is not null)
        or ("inbox_v2_auth_command_records"."state" = 'pending'
          and "inbox_v2_auth_command_records"."mutation_id" is null
          and "inbox_v2_auth_command_records"."result_reference" is null
          and "inbox_v2_auth_command_records"."sensitive_result_reference" is null));--> statement-breakpoint
ALTER TABLE "inbox_v2_auth_command_records" ADD CONSTRAINT "inbox_v2_auth_command_records_values_check" CHECK (char_length("inbox_v2_auth_command_records"."client_mutation_id") between 1 and 512
        and "inbox_v2_auth_command_records"."client_mutation_id" ~ '^[A-Za-z0-9][A-Za-z0-9._~:-]*$'
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
        and ("inbox_v2_auth_command_records"."result_reference" is null or (
          jsonb_typeof("inbox_v2_auth_command_records"."result_reference") = 'object'
          and "inbox_v2_auth_command_records"."result_reference" ?&
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]
          and ("inbox_v2_auth_command_records"."result_reference" -
            array['tenantId', 'recordId', 'schemaId', 'schemaVersion', 'digest']::text[]) =
              '{}'::jsonb
          and "inbox_v2_auth_command_records"."result_reference"->>'tenantId' = "inbox_v2_auth_command_records"."tenant_id"
          and "inbox_v2_auth_command_records"."result_reference"->>'digest' ~ '^sha256:[0-9a-f]{64}$'
        ))
        and ("inbox_v2_auth_command_records"."sensitive_result_reference" is null
          or "inbox_v2_auth_command_records"."sensitive_result_reference" ~
            '^internal-ref:[a-f0-9]{32,64}$')
        and "inbox_v2_auth_command_records"."revision" >= 1
        and isfinite("inbox_v2_auth_command_records"."occurred_at")
        and "inbox_v2_auth_command_records"."created_at" = "inbox_v2_auth_command_records"."occurred_at"
        and isfinite("inbox_v2_auth_command_records"."updated_at")
        and "inbox_v2_auth_command_records"."updated_at" >= "inbox_v2_auth_command_records"."created_at");--> statement-breakpoint
-- INB2-SRC-011_IMMUTABLE_COMMAND_RESULT_V1
alter table public.inbox_v2_source_onboarding_result_snapshots
  add constraint inbox_v2_source_onboarding_results_command_mutation_fk
  foreign key (tenant_id, command_record_id, mutation_id)
  references public.inbox_v2_auth_command_records
    (tenant_id, id, mutation_id)
  deferrable initially deferred;--> statement-breakpoint
alter table public.inbox_v2_source_onboarding_result_snapshots
  add constraint inbox_v2_source_onboarding_results_stream_mutation_fk
  foreign key (tenant_id, stream_commit_id, mutation_id)
  references public.inbox_v2_tenant_stream_commits
    (tenant_id, id, mutation_id)
  deferrable initially deferred;--> statement-breakpoint
alter table public.inbox_v2_source_onboarding_result_snapshots
  add constraint inbox_v2_source_onboarding_results_mutation_commit_fk
  foreign key (tenant_id, mutation_id)
  references public.inbox_v2_auth_mutation_commits
    (tenant_id, mutation_id)
  on delete cascade
  deferrable initially deferred;--> statement-breakpoint
create or replace function public.inbox_v2_source_onboarding_canonical_json_text(
  value jsonb
)
returns text
language plpgsql
immutable
strict
parallel safe
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  value_kind text := jsonb_typeof(value);
  canonical_text text;
begin
  case value_kind
    when 'object' then
      select '{' || coalesce(string_agg(
        to_json(object_entry.key)::text || ':' ||
          public.inbox_v2_source_onboarding_canonical_json_text(
            object_entry.value
          ),
        ',' order by object_entry.key collate "C"
      ), '') || '}'
        into canonical_text
        from jsonb_each(value) object_entry;
      return canonical_text;
    when 'array' then
      select '[' || coalesce(string_agg(
        public.inbox_v2_source_onboarding_canonical_json_text(array_entry.value),
        ',' order by array_entry.ordinality
      ), '') || ']'
        into canonical_text
        from jsonb_array_elements(value) with ordinality array_entry;
      return canonical_text;
    when 'string' then
      return to_json(value #>> '{}')::text;
    when 'boolean' then
      return value::text;
    when 'null' then
      return 'null';
    else
      raise exception using errcode = '23514',
        message = 'inbox_v2.source_onboarding_numeric_json_forbidden';
  end case;
end
$function$;--> statement-breakpoint
create or replace function public.inbox_v2_source_onboarding_result_immutable()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  raise exception using errcode = '55000',
    message = 'inbox_v2.source_onboarding_result_immutable';
end
$function$;--> statement-breakpoint
create trigger inbox_v2_source_onboarding_result_immutable_trigger
before update on public.inbox_v2_source_onboarding_result_snapshots
for each row execute function
  public.inbox_v2_source_onboarding_result_immutable();--> statement-breakpoint
create trigger inbox_v2_source_onboarding_result_truncate_guard_trigger
before truncate on public.inbox_v2_source_onboarding_result_snapshots
for each statement execute function
  public.inbox_v2_source_onboarding_result_immutable();--> statement-breakpoint
create or replace function public.inbox_v2_source_onboarding_result_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  v_tenant_id text;
  v_mutation_id text;
  v_commit public.inbox_v2_auth_mutation_commits%rowtype;
  v_command public.inbox_v2_auth_command_records%rowtype;
  v_stream public.inbox_v2_tenant_stream_commits%rowtype;
  v_audit public.inbox_v2_auth_audit_events%rowtype;
  v_result public.inbox_v2_source_onboarding_result_snapshots%rowtype;
  v_transition public.inbox_v2_source_registry_transitions%rowtype;
  v_connection public.source_connections%rowtype;
  v_result_count integer;
  v_change_count integer;
  v_facet_count integer;
begin
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  v_mutation_id := coalesce(new.mutation_id, old.mutation_id);

  select * into v_commit
    from public.inbox_v2_auth_mutation_commits commit_row
   where commit_row.tenant_id = v_tenant_id
     and commit_row.mutation_id = v_mutation_id;
  if not found then
    if tg_op = 'DELETE' then
      if not exists (
        select 1 from public.tenants tenant_row
         where tenant_row.id = old.tenant_id
      ) then
        return old;
      end if;
      if not exists (
        select 1 from public.inbox_v2_auth_command_records command_row
         where command_row.tenant_id = old.tenant_id
           and (
             command_row.id = old.command_record_id
             or command_row.result_reference->>'recordId' = old.id
           )
      ) and exists (
        select 1
          from public.inbox_v2_tenant_stream_commits stream_row
          join public.inbox_v2_tenant_stream_heads head_row
            on head_row.tenant_id = stream_row.tenant_id
           and head_row.stream_epoch = stream_row.stream_epoch
         where stream_row.tenant_id = old.tenant_id
           and stream_row.id = old.stream_commit_id
           and stream_row.mutation_id = old.mutation_id
           and stream_row.command_ids @>
             jsonb_build_array(old.command_record_id)
           and stream_row.position < head_row.min_retained_position
           and exists (
             select 1
               from public.inbox_v2_tenant_stream_retention_advances
                 advance_row
              where advance_row.tenant_id = stream_row.tenant_id
                and advance_row.stream_epoch = stream_row.stream_epoch
                and stream_row.position >=
                  greatest(advance_row.from_position, 1)
                and stream_row.position < advance_row.to_position
                and advance_row.to_position <=
                  head_row.min_retained_position
                and advance_row.resulting_head_revision <= head_row.revision
           )
      ) and not exists (
        select 1 from public.inbox_v2_tenant_stream_changes change_row
         where change_row.tenant_id = old.tenant_id
           and (
             change_row.stream_commit_id = old.stream_commit_id
             or change_row.mutation_id = old.mutation_id
             or change_row.payload_reference->>'recordId' = old.id
             or change_row.domain_commit_reference->>'recordId' = old.id
           )
      ) and not exists (
        select 1 from public.inbox_v2_domain_events event_row
         where event_row.tenant_id = old.tenant_id
           and (
             event_row.stream_commit_id = old.stream_commit_id
             or event_row.mutation_id = old.mutation_id
             or event_row.command_ids @>
               jsonb_build_array(old.command_record_id)
             or event_row.payload_reference->>'recordId' = old.id
           )
      ) and not exists (
        select 1 from public.inbox_v2_outbox_intents intent_row
         where intent_row.tenant_id = old.tenant_id
           and (
             intent_row.stream_commit_id = old.stream_commit_id
             or intent_row.mutation_id = old.mutation_id
             or intent_row.payload_reference->>'recordId' = old.id
           )
      ) and not exists (
        select 1 from public.inbox_v2_outbox_work_items work_row
         where work_row.tenant_id = old.tenant_id
           and work_row.terminal_result_reference->>'recordId' = old.id
      ) and not exists (
        select 1 from public.inbox_v2_outbox_outcomes outcome_row
         where outcome_row.tenant_id = old.tenant_id
           and outcome_row.result_reference->>'recordId' = old.id
      ) and not exists (
        select 1 from public.inbox_v2_auth_audit_events audit_row
         where audit_row.tenant_id = old.tenant_id
           and (
             audit_row.mutation_id = old.mutation_id
             or audit_row.command_record_id = old.command_record_id
             or audit_row.internal_target_ref = old.audit_target_ref
             or audit_row.evidence_reference->>'recordId' = old.id
           )
      ) and not exists (
        select 1 from public.inbox_v2_auth_audit_facets facet_row
         where facet_row.tenant_id = old.tenant_id
           and facet_row.internal_entity_ref = old.tenant_facet_ref
      ) then
        return old;
      end if;
      raise exception using errcode = '23514',
        message = 'inbox_v2.source_onboarding_result_delete_forbidden';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_onboarding_result_delete_forbidden';
  end if;

  select * into strict v_command
    from public.inbox_v2_auth_command_records command_row
   where command_row.tenant_id = v_commit.tenant_id
     and command_row.id = v_commit.command_record_id
     and command_row.mutation_id = v_commit.mutation_id;
  select count(*)::integer into v_result_count
    from public.inbox_v2_source_onboarding_result_snapshots result_row
   where result_row.tenant_id = v_commit.tenant_id
     and result_row.mutation_id = v_commit.mutation_id;

  if v_command.command_type_id <> 'core:source-connection.create' then
    if v_result_count <> 0 then
      raise exception using errcode = '23514',
        message = 'inbox_v2.source_onboarding_result_wrong_command';
    end if;
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if v_result_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_onboarding_result_missing';
  end if;

  select * into strict v_result
    from public.inbox_v2_source_onboarding_result_snapshots result_row
   where result_row.tenant_id = v_commit.tenant_id
     and result_row.mutation_id = v_commit.mutation_id;
  select * into strict v_stream
    from public.inbox_v2_tenant_stream_commits stream_row
   where stream_row.tenant_id = v_commit.tenant_id
     and stream_row.id = v_commit.stream_commit_id
     and stream_row.mutation_id = v_commit.mutation_id;
  select * into strict v_audit
    from public.inbox_v2_auth_audit_events audit_row
   where audit_row.tenant_id = v_commit.tenant_id
     and audit_row.id = v_commit.audit_event_id
     and audit_row.mutation_id = v_commit.mutation_id;
  select * into strict v_transition
    from public.inbox_v2_source_registry_transitions transition_row
   where transition_row.tenant_id = v_result.tenant_id
     and transition_row.transition_id = v_result.source_transition_id
     and transition_row.authority_id = v_result.source_connection_id
     and transition_row.resulting_revision = v_result.source_registry_revision;
  select * into strict v_connection
    from public.source_connections connection_row
   where connection_row.tenant_id = v_result.tenant_id
     and connection_row.id = v_result.source_connection_id;

  perform public.inbox_v2_assert_source_registry_lineage(
    v_result.tenant_id,
    v_result.registry_id,
    v_result.registry_revision,
    v_result.registry_composition_hash,
    v_result.data_class_id,
    v_result.storage_root_id,
    v_result.purpose_id,
    v_result.canonical_anchor_id,
    v_result.lineage_revision,
    v_result.effective_policy_id,
    v_result.effective_policy_version,
    v_result.effective_rule_id,
    v_result.effective_rule_revision,
    v_result.policy_activation_id,
    v_result.policy_activation_revision,
    v_result.policy_activation_head_revision,
    v_result.legal_hold_set_revision,
    v_result.restriction_set_revision,
    true
  );

  if v_command.public_result_code <> 'core:source-connection.created'
     or v_command.result_reference is distinct from jsonb_build_object(
       'tenantId', v_result.tenant_id,
       'recordId', v_result.id,
       'schemaId', 'core:inbox-v2.source-onboarding-result',
       'schemaVersion', 'v1',
       'digest', v_result.result_digest_sha256
     )
     or v_command.sensitive_result_reference is not null
     or v_result.copy_slot <> 'source_onboarding_result_snapshot'
     or v_result.data_class_id <>
        'core:source_account_connector_metadata'
     or v_result.storage_root_id <> 'core:source-registry-sql'
     or v_result.purpose_id <> 'core:source_replay_and_diagnostics'
     or v_result.canonical_anchor_id <>
        'core:disconnect_or_account_termination'
     or v_result.registry_id is distinct from
        v_result.state_payload->'payload'->'lifecycle'->'registry'->>'id'
     or v_result.registry_revision::text is distinct from
        v_result.state_payload->'payload'->'lifecycle'->'registry'->>'revision'
     or 'sha256:' || v_result.registry_composition_hash is distinct from
        v_result.state_payload->'payload'->'lifecycle'->'registry'->>
          'compositionHash'
     or v_result.command_record_id <> v_command.id
     or v_result.client_mutation_id <> v_command.client_mutation_id
     or v_result.stream_commit_id <> v_stream.id
     or v_result.created_at <> v_commit.committed_at
     or v_result.created_at <> v_stream.committed_at
     or v_result.created_at <> v_audit.recorded_at
     or v_result.audit_target_ref <> v_audit.internal_target_ref
     or public.inbox_v2_source_onboarding_canonical_json_text(
          v_result.result_canonical_json::jsonb
        ) is distinct from v_result.result_canonical_json
     or public.inbox_v2_source_onboarding_canonical_json_text(
          v_result.state_payload
        ) is distinct from v_result.state_canonical_json
     or public.inbox_v2_source_onboarding_canonical_json_text(
          v_result.transition_payload
        ) is distinct from v_result.transition_canonical_json
     or jsonb_typeof(v_result.result_canonical_json::jsonb) <> 'object'
     or (v_result.result_canonical_json::jsonb ?&
          array['protocol', 'connection']::text[]) is not true
     or (v_result.result_canonical_json::jsonb -
          array['protocol', 'connection']::text[]) <> '{}'::jsonb
     or jsonb_typeof(
          v_result.result_canonical_json::jsonb->'connection'
        ) <> 'object'
     or ((v_result.result_canonical_json::jsonb->'connection') ?& array[
          'id', 'tenantId', 'sourceType', 'sourceName', 'displayName',
          'status', 'authType', 'capabilities', 'config', 'diagnostics',
          'metadata', 'createdByEmployeeId', 'createdAt', 'updatedAt'
        ]::text[]) is not true
     or ((v_result.result_canonical_json::jsonb->'connection') - array[
          'id', 'tenantId', 'sourceType', 'sourceName', 'displayName',
          'status', 'authType', 'capabilities', 'config', 'diagnostics',
          'metadata', 'createdByEmployeeId', 'createdAt', 'updatedAt'
        ]::text[]) <> '{}'::jsonb
     or v_result.result_canonical_json::jsonb->>'protocol' is distinct from
        'core:inbox-v2.source-onboarding-result@v1'
     or v_result.result_canonical_json::jsonb->'connection'->>'id'
        is distinct from v_result.source_connection_id
     or v_result.result_canonical_json::jsonb->'connection'->>'tenantId'
        is distinct from v_result.tenant_id
     or v_result.result_canonical_json::jsonb->'connection'->>'sourceType'
        is distinct from v_result.source_type
     or v_result.result_canonical_json::jsonb->'connection'->>'sourceName'
        is distinct from v_result.source_name
     or v_result.result_canonical_json::jsonb->'connection'->>'displayName'
        is distinct from v_result.display_name
     or v_result.result_canonical_json::jsonb->'connection'->>'status'
        is distinct from v_result.status
     or v_result.result_canonical_json::jsonb->'connection'->>'authType'
        is distinct from v_result.auth_type
     or v_result.result_canonical_json::jsonb->'connection'->>'createdByEmployeeId'
        is distinct from v_result.created_by_employee_id
     or v_result.result_canonical_json::jsonb->'connection'->'capabilities'
        is distinct from '{}'::jsonb
     or v_result.result_canonical_json::jsonb->'connection'->'config'
        is distinct from '{}'::jsonb
     or v_result.result_canonical_json::jsonb->'connection'->'diagnostics'
        is distinct from '{}'::jsonb
     or v_result.result_canonical_json::jsonb->'connection'->'metadata'
        is distinct from '{}'::jsonb
     or v_result.result_canonical_json::jsonb->'connection'->'createdAt'
        is distinct from v_result.transition_payload->'payload'->'committedAt'
     or v_result.result_canonical_json::jsonb->'connection'->'updatedAt'
        is distinct from v_result.transition_payload->'payload'->'committedAt'
     or (v_result.result_canonical_json::jsonb->'connection'->>'createdAt')::timestamptz
        is distinct from v_result.connection_created_at
     or (v_result.result_canonical_json::jsonb->'connection'->>'updatedAt')::timestamptz
        is distinct from v_result.connection_updated_at
     or v_audit.grant_source_ids <> array(
       select mapping->>'internalReference'
         from jsonb_array_elements(v_result.grant_source_mappings) mapping
        order by mapping->>'internalReference'
     )
     or exists (
       select 1
         from jsonb_array_elements(v_result.grant_source_mappings) mapping
         where jsonb_typeof(mapping) <> 'object'
            or (mapping ?& array[
              'internalReference', 'authorizationDecisionId'
            ]::text[]) is not true
            or jsonb_typeof(mapping->'internalReference') <> 'string'
            or jsonb_typeof(mapping->'authorizationDecisionId') <> 'string'
           or (mapping - array[
             'internalReference', 'authorizationDecisionId'
           ]::text[]) <> '{}'::jsonb
           or mapping->>'internalReference' !~
             '^internal-ref:[a-f0-9]{64}$'
           or not exists (
             select 1
               from jsonb_array_elements(
                 v_command.authorization_decision_refs
               ) decision_ref
              where decision_ref->>'id' =
                mapping->>'authorizationDecisionId'
           )
     )
     or (select count(*) from jsonb_array_elements(
           v_result.grant_source_mappings
         )) <>
        (select count(distinct mapping->>'internalReference')
           from jsonb_array_elements(
              v_result.grant_source_mappings
            ) mapping)
     or (select count(*) from jsonb_array_elements(
           v_result.grant_source_mappings
         )) <>
        (select count(distinct mapping->>'authorizationDecisionId')
           from jsonb_array_elements(
             v_result.grant_source_mappings
           ) mapping)
     or v_transition.intent <> 'create'
     or v_transition.authority_kind <> 'source_connection'
     or v_transition.resulting_revision <> 1
     or v_transition.occurred_at <> v_result.created_at
     or v_result.transition_digest_sha256 <>
        'sha256:' || v_transition.transition_digest_sha256
     or row(v_result.source_type, v_result.source_name,
            v_result.display_name, v_result.status, v_result.auth_type,
            v_result.created_by_employee_id,
            v_result.connection_created_at,
            v_result.connection_updated_at)
        is distinct from
        row(v_connection.source_type, v_connection.source_name,
            v_connection.display_name, v_connection.status,
            v_connection.auth_type, v_connection.created_by_employee_id,
            v_connection.created_at, v_connection.updated_at)
     or v_result.state_payload->>'schemaId' is distinct from
        'core:inbox-v2.source-connection-registry-state'
     or v_result.state_payload->>'schemaVersion' is distinct from 'v1'
     or v_result.state_payload->'payload'->>'tenantId' is distinct from
        v_result.tenant_id
     or v_result.state_payload->'payload'->>'entityKind' is distinct from
        'source_connection'
     or v_result.state_payload->'payload'->'sourceConnection'->>'tenantId'
        is distinct from v_result.tenant_id
     or v_result.state_payload->'payload'->'sourceConnection'->>'id'
        is distinct from v_result.source_connection_id
     or v_result.state_payload->'payload'->>'sourceName' is distinct from
        v_result.source_name
     or v_result.state_payload->'payload'->>'displayName' is distinct from
        v_result.display_name
     or v_result.state_payload->'payload'->>'revision' is distinct from '1'
     or v_result.state_payload->'payload'->>'status' is distinct from 'pending'
     or v_result.state_payload->'payload'->'createdBy'->>'kind'
        is distinct from 'employee'
     or v_result.state_payload->'payload'->'createdBy'->'employee'->>'tenantId'
        is distinct from v_result.tenant_id
     or v_result.state_payload->'payload'->'createdBy'->'employee'->>'id'
        is distinct from v_result.created_by_employee_id
     or v_result.transition_payload->'payload'->'cas'->'expectedRevision'
        is distinct from 'null'::jsonb
     or v_result.transition_payload->'payload'->'cas'->'expectedRouteGeneration'
        is distinct from 'null'::jsonb
     or v_result.transition_payload->'payload'->'cas'->>'resultingRevision'
        is distinct from '1'
     or v_result.transition_payload->'payload'->'cas'->>'resultingRouteGeneration'
        is distinct from '1'
     or v_result.transition_payload->'payload'->'previousState'
        is distinct from 'null'::jsonb
     or v_result.transition_payload->'payload'->'lifecycle'
        is distinct from v_result.state_payload->'payload'->'lifecycle'
     or v_result.transition_payload->'payload'->'actor'
        is distinct from v_result.state_payload->'payload'->'createdBy'
     or v_result.transition_payload->'payload'->'committedAt'
        is distinct from v_result.state_payload->'payload'->'createdAt'
     or v_result.transition_payload->'payload'->'committedAt'
        is distinct from v_result.state_payload->'payload'->'updatedAt'
     or v_result.transition_payload->>'schemaId' is distinct from
        'core:inbox-v2.source-registry-transition'
     or v_result.transition_payload->>'schemaVersion' is distinct from 'v1'
     or v_result.transition_payload->'payload'->>'tenantId' is distinct from
        v_result.tenant_id
     or v_result.transition_payload->'payload'->>'entityKind' is distinct from
        'source_connection'
     or v_result.transition_payload->'payload'->>'intent' is distinct from
        'create'
     or v_result.transition_payload->'payload'->>'transitionId'
        is distinct from v_result.source_transition_id
     or v_result.transition_payload->'payload'->'resultingState'
        is distinct from v_result.state_payload then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_onboarding_result_mismatch';
  end if;

  select count(*)::integer into v_change_count
    from public.inbox_v2_tenant_stream_changes change_row
   where change_row.tenant_id = v_result.tenant_id
     and change_row.stream_commit_id = v_result.stream_commit_id
     and change_row.mutation_id = v_result.mutation_id
     and change_row.entity_type_id = 'core:source-connection'
     and change_row.entity_id = v_result.source_connection_id
     and change_row.payload_reference = jsonb_build_object(
       'tenantId', v_result.tenant_id,
       'recordId', v_result.id,
       'schemaId', v_result.state_payload->>'schemaId',
       'schemaVersion', v_result.state_payload->>'schemaVersion',
       'digest', v_result.state_digest_sha256
     )
     and change_row.domain_commit_reference = jsonb_build_object(
       'tenantId', v_result.tenant_id,
       'recordId', v_result.id,
       'schemaId', v_result.transition_payload->>'schemaId',
       'schemaVersion', v_result.transition_payload->>'schemaVersion',
       'digest', v_result.transition_digest_sha256
     );
  select count(*)::integer into v_facet_count
    from public.inbox_v2_auth_audit_facets facet_row
   where facet_row.tenant_id = v_result.tenant_id
     and facet_row.audit_event_id = v_audit.id
     and facet_row.dimension = 'tenant'
     and facet_row.internal_entity_ref = v_result.tenant_facet_ref;
  if v_change_count <> 1 or v_facet_count <> 1 then
    raise exception using errcode = '23514',
      message = 'inbox_v2.source_onboarding_result_reference_mismatch';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$function$;--> statement-breakpoint
create constraint trigger inbox_v2_source_onboarding_result_commit_constraint
after insert or update on public.inbox_v2_auth_mutation_commits
deferrable initially deferred
for each row execute function
  public.inbox_v2_source_onboarding_result_coherence();--> statement-breakpoint
create constraint trigger inbox_v2_source_onboarding_result_row_constraint
after insert or update or delete on
  public.inbox_v2_source_onboarding_result_snapshots
deferrable initially deferred
for each row execute function
  public.inbox_v2_source_onboarding_result_coherence();
