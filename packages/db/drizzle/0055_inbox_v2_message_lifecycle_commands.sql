ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" DROP CONSTRAINT "inbox_v2_deferred_action_transitions_state_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" DROP CONSTRAINT "inbox_v2_deferred_actions_state_check";
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD COLUMN "applied_provider_lifecycle_operation_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD COLUMN "applied_provider_lifecycle_operation_revision" bigint;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD COLUMN "applied_provider_lifecycle_operation_id" text;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD COLUMN "applied_provider_lifecycle_operation_revision" bigint;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_message_revision_fk" FOREIGN KEY ("tenant_id","target_message_id","applied_message_revision") REFERENCES "public"."inbox_v2_message_revisions"("tenant_id","message_id","message_revision") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_provider_operation_fk" FOREIGN KEY ("tenant_id","applied_provider_lifecycle_operation_id","applied_provider_lifecycle_operation_revision") REFERENCES "public"."inbox_v2_message_provider_lifecycle_operations"("tenant_id","id","revision") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_applied_message_revision_fk" FOREIGN KEY ("tenant_id","applied_message_id","applied_message_revision") REFERENCES "public"."inbox_v2_message_revisions"("tenant_id","message_id","message_revision") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_applied_provider_operation_fk" FOREIGN KEY ("tenant_id","applied_provider_lifecycle_operation_id","applied_provider_lifecycle_operation_revision") REFERENCES "public"."inbox_v2_message_provider_lifecycle_operations"("tenant_id","id","revision") ON DELETE no action ON UPDATE no action NOT VALID;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_action_transitions" ADD CONSTRAINT "inbox_v2_deferred_action_transitions_state_check" CHECK ((
      "inbox_v2_deferred_message_source_action_transitions"."after_state" = 'applied'
      and "inbox_v2_deferred_message_source_action_transitions"."ordering_outcome" = 'advance'
      and "inbox_v2_deferred_message_source_action_transitions"."target_external_message_reference_id" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."target_message_id" is not null
      and "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision" >= 1
      and "inbox_v2_deferred_message_source_action_transitions"."effect_kind" is not null
      and (
        ("inbox_v2_deferred_message_source_action_transitions"."effect_kind" = 'provider_delete_retain_local'
          and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id" is not null
          and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision" >= 1)
        or ("inbox_v2_deferred_message_source_action_transitions"."effect_kind" <> 'provider_delete_retain_local'
          and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id" is null
          and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision" is null)
      )
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
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
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
      and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id" is null
      and "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision" is null
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
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
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
        "inbox_v2_deferred_message_source_action_transitions"."applied_message_revision",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_action_transitions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_action_transitions"."effect_kind",
        "inbox_v2_deferred_message_source_action_transitions"."conflict_candidate_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_expected_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resulting_revision",
        "inbox_v2_deferred_message_source_action_transitions"."source_occurrence_resolution_digest_sha256",
        "inbox_v2_deferred_message_source_action_transitions"."effect_proof_digest_sha256"
      ) = 0
    )) NOT VALID;
--> statement-breakpoint
ALTER TABLE "inbox_v2_deferred_message_source_actions" ADD CONSTRAINT "inbox_v2_deferred_actions_state_check" CHECK ((
      "inbox_v2_deferred_message_source_actions"."state" = 'pending'
      and "inbox_v2_deferred_message_source_actions"."revision" = 1
      and num_nonnulls(
        "inbox_v2_deferred_message_source_actions"."applied_external_message_reference_id", "inbox_v2_deferred_message_source_actions"."applied_message_id",
        "inbox_v2_deferred_message_source_actions"."applied_message_revision",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
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
      and (
        ("inbox_v2_deferred_message_source_actions"."effect_kind" = 'provider_delete_retain_local'
          and "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id" is not null
          and "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision" >= 1)
        or ("inbox_v2_deferred_message_source_actions"."effect_kind" <> 'provider_delete_retain_local'
          and "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id" is null
          and "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision" is null)
      )
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
        "inbox_v2_deferred_message_source_actions"."applied_message_revision",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
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
        "inbox_v2_deferred_message_source_actions"."applied_message_revision",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
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
        "inbox_v2_deferred_message_source_actions"."applied_message_revision",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
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
        "inbox_v2_deferred_message_source_actions"."applied_message_revision",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_id",
        "inbox_v2_deferred_message_source_actions"."applied_provider_lifecycle_operation_revision", "inbox_v2_deferred_message_source_actions"."effect_kind",
        "inbox_v2_deferred_message_source_actions"."related_action_id", "inbox_v2_deferred_message_source_actions"."conflict_candidate_digest_sha256"
      ) = 0
    )) NOT VALID;
--> statement-breakpoint
-- INBOX_V2_MESSAGE_LIFECYCLE_MIGRATION_FINALIZED_V1
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
         'applied_message_id', 'applied_message_revision',
         'applied_provider_lifecycle_operation_id',
         'applied_provider_lifecycle_operation_revision', 'effect_kind',
         'related_action_id', 'state_reason_id', 'conflict_candidate_count',
         'conflict_candidate_digest_sha256', 'terminal_at', 'revision',
         'updated_at'
       ]
     ) is distinct from (
       to_jsonb(old) - array[
         'message_key_digest_sha256',
         'state', 'applied_external_message_reference_id',
         'applied_message_id', 'applied_message_revision',
         'applied_provider_lifecycle_operation_id',
         'applied_provider_lifecycle_operation_revision', 'effect_kind',
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
        'applied_message_id', 'applied_message_revision',
        'applied_provider_lifecycle_operation_id',
        'applied_provider_lifecycle_operation_revision', 'effect_kind',
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
       or transition_row.applied_provider_lifecycle_operation_id is distinct
         from new.applied_provider_lifecycle_operation_id
       or transition_row.applied_provider_lifecycle_operation_revision is
         distinct from new.applied_provider_lifecycle_operation_revision
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

  if new.state = 'applied' and not exists (
    select 1
    from public.inbox_v2_message_revisions revision_row
    where revision_row.tenant_id = new.tenant_id
      and revision_row.message_id = new.applied_message_id
      and revision_row.message_revision = new.applied_message_revision
  ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_applied_revision_missing';
  end if;

  if new.state = 'applied'
     and new.effect_kind = 'message_lifecycle'
     and new.action_kind in ('edit', 'delete')
     and not exists (
       select 1
       from public.inbox_v2_message_revisions revision_row
       join public.inbox_v2_message_provider_lifecycle_operations operation_row
         on operation_row.tenant_id = revision_row.tenant_id
        and operation_row.id = revision_row.provider_operation_id
       where revision_row.tenant_id = new.tenant_id
         and revision_row.message_id = new.applied_message_id
         and revision_row.message_revision = new.applied_message_revision
         and revision_row.change_kind = case new.action_kind
           when 'edit' then 'edited'::public.inbox_v2_message_revision_change
           else 'provider_delete_policy_tombstone'::public.inbox_v2_message_revision_change
         end
         and operation_row.message_id = new.applied_message_id
         and operation_row.action::text = new.action_kind::text
         and operation_row.origin = 'provider_observed'
         and operation_row.source_occurrence_id = new.source_occurrence_id
         and operation_row.source_account_id = new.source_account_id
         and operation_row.source_thread_binding_id = new.source_thread_binding_id
         and operation_row.binding_generation = new.binding_generation
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_lifecycle_effect_mismatch';
  end if;

  if new.state = 'applied'
     and new.effect_kind = 'provider_delete_retain_local'
     and not exists (
       select 1
       from public.inbox_v2_message_provider_lifecycle_operations operation_row
       join public.inbox_v2_message_provider_lifecycle_transitions transition_effect
         on transition_effect.tenant_id = operation_row.tenant_id
        and transition_effect.operation_id = operation_row.id
        and transition_effect.resulting_revision = operation_row.revision
       where operation_row.tenant_id = new.tenant_id
         and operation_row.id = new.applied_provider_lifecycle_operation_id
         and operation_row.revision =
           new.applied_provider_lifecycle_operation_revision
         and operation_row.message_id = new.applied_message_id
         and operation_row.action = 'delete'
         and operation_row.origin = 'provider_observed'
         and operation_row.source_occurrence_id = new.source_occurrence_id
         and operation_row.source_account_id = new.source_account_id
         and operation_row.source_thread_binding_id = new.source_thread_binding_id
         and operation_row.binding_generation = new.binding_generation
         and operation_row.outcome = 'observed'
         and operation_row.delete_local_effect = 'retain_local'
         and transition_effect.delete_local_effect = 'retain_local'
         and transition_effect.recorded_at = new.terminal_at
     ) then
    raise exception using
      errcode = '23514',
      message = 'inbox_v2.deferred_source_action_retain_local_effect_mismatch';
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

create or replace function public.inbox_v2_tm_outbound_route_action_valid(
  expected_tenant_id text,
  expected_route_id text,
  expected_message_id text,
  expected_reference_owner_message_id text,
  expected_conversation_id text,
  expected_authority_at timestamptz,
  expected_attribution_created_at timestamptz,
  expected_operation_id text,
  expected_required_permission_id text,
  expected_external_message_reference_id text,
  expected_source_occurrence_id text,
  expected_source_account_id text,
  expected_source_thread_binding_id text,
  expected_binding_generation bigint,
  expected_adapter_contract_id text,
  expected_adapter_contract_version text,
  expected_adapter_declaration_revision bigint,
  expected_adapter_surface_id text,
  expected_adapter_loaded_by_trusted_service_id text,
  expected_adapter_loaded_at timestamptz,
  expected_capability_id text,
  expected_capability_revision bigint,
  expected_attribution_id text,
  require_explicit_occurrence boolean
)
returns boolean
language plpgsql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
begin
  return exists (
    select 1
      from public.inbox_v2_outbound_routes route_row
      join public.inbox_v2_action_attributions attribution_row
        on attribution_row.tenant_id = route_row.tenant_id
       and attribution_row.id = expected_attribution_id
       and attribution_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = route_row.tenant_id
       and message_row.id = expected_message_id
       and message_row.conversation_id = route_row.conversation_id
      join public.inbox_v2_source_thread_binding_snapshots binding_snapshot
        on binding_snapshot.tenant_id = route_row.tenant_id
       and binding_snapshot.binding_id = route_row.source_thread_binding_id
       and binding_snapshot.revision = route_row.binding_revision
       and binding_snapshot.external_thread_id = route_row.external_thread_id
       and binding_snapshot.source_connection_id = route_row.source_connection_id
       and binding_snapshot.source_account_id = route_row.source_account_id
       and binding_snapshot.account_generation = route_row.account_generation
       and binding_snapshot.binding_generation = route_row.binding_generation
       and binding_snapshot.remote_access_revision =
         route_row.remote_access_revision
       and binding_snapshot.administrative_revision =
         route_row.administrative_revision
       and binding_snapshot.capability_revision = route_row.capability_revision
       and binding_snapshot.route_descriptor_revision =
         route_row.route_descriptor_revision
      left join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = route_row.tenant_id
       and occurrence_row.id = expected_source_occurrence_id
       and occurrence_row.conversation_id = route_row.conversation_id
       and occurrence_row.external_thread_id = route_row.external_thread_id
       and occurrence_row.adapter_contract_id = route_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         route_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         route_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = route_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = route_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_source_occurrence_resolution_transitions
        resolution_row
        on resolution_row.tenant_id = occurrence_row.tenant_id
       and resolution_row.source_occurrence_id = occurrence_row.id
       and resolution_row.resulting_revision = occurrence_row.revision
       and resolution_row.to_state = 'resolved'
       and resolution_row.resolved_external_message_reference_id =
         expected_external_message_reference_id
      left join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = route_row.tenant_id
       and reference_row.id = expected_external_message_reference_id
       and reference_row.external_thread_id = route_row.external_thread_id
      left join public.inbox_v2_source_thread_binding_capability_entries capability_row
        on capability_row.tenant_id = route_row.tenant_id
       and capability_row.binding_id = route_row.source_thread_binding_id
       and capability_row.materialized_by_binding_revision =
         route_row.binding_revision
       and capability_row.capability_revision = route_row.capability_revision
       and (
         expected_capability_id is null
         or capability_row.capability_id = expected_capability_id
       )
       and capability_row.operation_id = route_row.operation_id
       and capability_row.content_kind_id is not distinct from
         route_row.content_kind_id
     where route_row.tenant_id = expected_tenant_id
       and route_row.id = expected_route_id
       and route_row.conversation_id = expected_conversation_id
       and route_row.operation_id = expected_operation_id
       and route_row.required_conversation_permission_id =
         expected_required_permission_id
       and (
         expected_source_account_id is null
         or route_row.source_account_id = expected_source_account_id
       )
       and (
         expected_source_thread_binding_id is null
         or route_row.source_thread_binding_id =
           expected_source_thread_binding_id
       )
       and (
         expected_binding_generation is null
         or route_row.binding_generation = expected_binding_generation
       )
       and (
         expected_adapter_contract_id is null
         or (
           route_row.adapter_contract_id = expected_adapter_contract_id
           and route_row.adapter_contract_version =
             expected_adapter_contract_version
           and route_row.adapter_declaration_revision =
             expected_adapter_declaration_revision
           and route_row.adapter_surface_id = expected_adapter_surface_id
           and route_row.adapter_loaded_by_trusted_service_id =
             expected_adapter_loaded_by_trusted_service_id
           and route_row.adapter_loaded_at = expected_adapter_loaded_at
         )
       )
       and (
         expected_capability_revision is null
         or route_row.capability_revision = expected_capability_revision
       )
       and binding_snapshot.remote_access_state = 'active'
       and binding_snapshot.administrative_state = 'enabled'
       and binding_snapshot.runtime_health_state::text =
         route_row.runtime_observation_snapshot #>> '{state}'
       and binding_snapshot.runtime_health_revision::text =
         route_row.runtime_observation_snapshot #>> '{revision}'
       and binding_snapshot.runtime_health_checked_at =
         (route_row.runtime_observation_snapshot #>>
           '{observedAt}')::timestamptz
       and binding_snapshot.capability_contract_id =
         route_row.adapter_contract_id
       and binding_snapshot.capability_contract_version =
         route_row.adapter_contract_version
       and binding_snapshot.capability_declaration_revision =
         route_row.adapter_declaration_revision
       and binding_snapshot.capability_surface_id = route_row.adapter_surface_id
       and binding_snapshot.capability_loaded_by_trusted_service_id =
         route_row.adapter_loaded_by_trusted_service_id
       and binding_snapshot.capability_loaded_at = route_row.adapter_loaded_at
       and binding_snapshot.updated_at <= expected_authority_at
       and binding_snapshot.capability_captured_at <= expected_authority_at
       and (
         (
           expected_external_message_reference_id is null
           and expected_source_occurrence_id is null
           and route_row.reference_context_snapshot =
             '{"kind":"none"}'::jsonb
         )
         or (
           expected_external_message_reference_id is not null
           and expected_source_occurrence_id is not null
           and occurrence_row.id is not null
           and reference_row.id is not null
           and resolution_row.id is not null
           and (
             expected_reference_owner_message_id is null
             or reference_row.message_id =
               expected_reference_owner_message_id
           )
           and route_row.reference_context_snapshot #>> '{kind}' =
             'external_message'
           and route_row.reference_context_snapshot #>>
             '{externalMessageReference,id}' =
               expected_external_message_reference_id
           and route_row.reference_context_snapshot #>>
             '{sourceOccurrence,id}' = expected_source_occurrence_id
           and route_row.reference_context_snapshot #>>
             '{externalThread,id}' = route_row.external_thread_id
           and route_row.reference_context_snapshot #>>
             '{originBinding,id}' = occurrence_row.source_thread_binding_id
           and route_row.reference_context_snapshot #>>
             '{originSourceAccount,id}' = occurrence_row.source_account_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,externalThread}' =
               route_row.reference_context_snapshot #> '{externalThread}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,externalMessageReference}' =
               route_row.reference_context_snapshot #>
                 '{externalMessageReference}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,sourceOccurrence}' =
               route_row.reference_context_snapshot #> '{sourceOccurrence}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,originBinding}' =
               route_row.reference_context_snapshot #> '{originBinding}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,originSourceAccount}' =
               route_row.reference_context_snapshot #> '{originSourceAccount}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,portability}' =
               route_row.reference_context_snapshot #> '{portability}'
           and occurrence_row.revision =
             (route_row.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceRevision}')::bigint
           and occurrence_row.binding_generation =
             (route_row.reference_context_snapshot #>>
               '{resolutionDecision,occurrenceBindingGeneration}')::bigint
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorSchemaId}' =
               occurrence_row.descriptor_schema_id
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorVersion}' =
               occurrence_row.descriptor_version
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,capabilityRevision}' =
               occurrence_row.capability_revision::text
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,occurrenceDescriptor,descriptorDigestSha256}' =
               occurrence_row.descriptor_digest_sha256
           and jsonb_array_length(route_row.reference_context_snapshot #>
             '{resolutionDecision,occurrenceDescriptor,providerReferences}') =
               occurrence_row.provider_reference_count
           and not exists (
             select 1
               from jsonb_array_elements(route_row.reference_context_snapshot #>
                 '{resolutionDecision,occurrenceDescriptor,providerReferences}')
                 with ordinality as supplied_reference(value, ordinal)
               left join public.inbox_v2_source_occurrence_provider_references
                 stored_reference
                 on stored_reference.tenant_id = occurrence_row.tenant_id
                and stored_reference.source_occurrence_id = occurrence_row.id
                and stored_reference.ordinal = supplied_reference.ordinal - 1
              where stored_reference.ordinal is null
                 or supplied_reference.value is distinct from jsonb_build_object(
                   'kindId', stored_reference.kind_id,
                   'subject', stored_reference.subject
                 )
           )
           and route_row.reference_context_snapshot #>>
             '{portability,kind}' =
               occurrence_row.reference_portability_kind::text
           and route_row.reference_context_snapshot #>>
             '{portability,decisionStrength}' =
               occurrence_row.reference_portability_decision_strength::text
           and route_row.reference_context_snapshot #>
             '{portability,adapterContract}' =
               route_row.adapter_contract_snapshot
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,loadedByTrustedServiceId}' =
               resolution_row.resolver_trusted_service_id
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,state}' = 'available'
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,tenantId}' =
               route_row.tenant_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalThread}' =
               route_row.reference_context_snapshot #> '{externalThread}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,externalMessageReference}' =
               route_row.reference_context_snapshot #>
                 '{externalMessageReference}'
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,sourceOccurrence}' =
               route_row.reference_context_snapshot #> '{sourceOccurrence}'
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceRevision}' =
               occurrence_row.revision::text
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,occurrenceDescriptorDigestSha256}' =
               occurrence_row.descriptor_digest_sha256
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,adapterContract}' =
               route_row.adapter_contract_snapshot
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedByTrustedServiceId}' =
               occurrence_row.adapter_loaded_by_trusted_service_id
           and route_row.reference_context_snapshot #>
             '{resolutionDecision,availabilityObservation,diagnostic}' =
               'null'::jsonb
           and (route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,observedAt}')::timestamptz
               <= expected_authority_at
           and (route_row.reference_context_snapshot #>>
             '{resolutionDecision,availabilityObservation,notAfter}')::timestamptz
               >= expected_authority_at
           and (
             route_row.reference_context_snapshot #>>
               '{portability,kind}' <> 'binding_only'
             or (
               occurrence_row.source_thread_binding_id =
                 route_row.source_thread_binding_id
               and occurrence_row.source_account_id =
                 route_row.source_account_id
               and occurrence_row.binding_generation =
                 route_row.binding_generation
             )
           )
           and (
             route_row.selection_intent_kind <> 'explicit_occurrence'
             or (
               route_row.selection_reason = 'explicit_occurrence'
               and route_row.selection_intent_snapshot #>>
                 '{occurrence,id}' = occurrence_row.id
               and occurrence_row.source_thread_binding_id =
                 route_row.source_thread_binding_id
               and occurrence_row.source_account_id =
                 route_row.source_account_id
               and occurrence_row.binding_generation =
                 route_row.binding_generation
             )
           )
         )
       )
       and (
         not require_explicit_occurrence
         or (
           route_row.selection_intent_kind = 'explicit_occurrence'
           and route_row.selection_reason = 'explicit_occurrence'
           and route_row.selection_intent_snapshot #>> '{occurrence,id}' =
             expected_source_occurrence_id
         )
       )
       and attribution_row.created_at = expected_attribution_created_at
       and attribution_row.source_occurrence_id is null
       and (
         (
           attribution_row.app_actor_kind = 'employee'
           and route_row.principal_kind = 'employee'
           and route_row.principal_employee_id =
             attribution_row.app_actor_employee_id
           and route_row.authorization_epoch =
             attribution_row.app_authorization_epoch
           and attribution_row.app_trusted_service_id is null
         )
         or (
           attribution_row.app_actor_kind = 'trusted_service'
           and route_row.principal_kind = 'trusted_service'
           and route_row.principal_trusted_service_id =
             attribution_row.app_trusted_service_id
           and attribution_row.app_actor_employee_id is null
           and attribution_row.app_authorization_epoch is null
         )
       )
       and capability_row.state = 'supported'
       and (
         capability_row.valid_until is null
         or capability_row.valid_until > expected_authority_at
       )
       and not exists (
         select 1
           from public.inbox_v2_source_thread_binding_capability_required_roles
             required_role
          where required_role.tenant_id = capability_row.tenant_id
            and required_role.binding_id = capability_row.binding_id
            and required_role.capability_revision =
              capability_row.capability_revision
            and required_role.capability_ordinal = capability_row.ordinal
            and not exists (
              select 1
                from public.inbox_v2_source_thread_binding_provider_roles
                  provider_role
               where provider_role.tenant_id = required_role.tenant_id
                 and provider_role.binding_id = required_role.binding_id
                 and provider_role.provider_access_revision =
                   binding_snapshot.provider_access_revision
                 and provider_role.provider_role_id =
                   required_role.provider_role_id
            )
       )
       and (route_row.runtime_observation_snapshot #>>
         '{observedAt}')::timestamptz <= expected_authority_at
       and route_row.selected_at <= expected_authority_at
       and route_row.created_at <= expected_authority_at
       and route_row.candidate_snapshot_not_after >= expected_authority_at
       and (route_row.conversation_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (route_row.source_account_authorization_snapshot #>>
         '{notAfter}')::timestamptz >= expected_authority_at
       and (
         expected_external_message_reference_id is null
         or (
           (route_row.reference_context_snapshot #>>
             '{resolutionDecision,notAfter}')::timestamptz >=
               expected_authority_at
           and route_row.reference_context_snapshot #>>
             '{resolutionDecision,referenceWindow,state}' <> 'expired'
           and (
             route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,state}' <> 'valid'
             or (route_row.reference_context_snapshot #>>
               '{resolutionDecision,referenceWindow,notAfter}')::timestamptz >=
                 expected_authority_at
           )
         )
       )
  );
exception when others then
  return false;
end;
$function$;

create or replace function public.inbox_v2_tm_message_history_valid(
  checked_tenant_id text,
  checked_message_id text
) returns boolean
language sql
stable
set search_path = pg_catalog, public, pg_temp
as $function$
  select exists (
    select 1
      from public.inbox_v2_messages message_row
      join public.inbox_v2_message_revisions latest_row
        on latest_row.tenant_id = message_row.tenant_id
       and latest_row.message_id = message_row.id
       and latest_row.timeline_item_id = message_row.timeline_item_id
       and latest_row.message_revision = message_row.revision
       and latest_row.recorded_stream_position =
         message_row.last_changed_stream_position
      join public.inbox_v2_timeline_items timeline_row
        on timeline_row.tenant_id = message_row.tenant_id
       and timeline_row.id = message_row.timeline_item_id
       and timeline_row.conversation_id = message_row.conversation_id
       and timeline_row.subject_kind = 'message'
       and timeline_row.subject_id = message_row.id
       and timeline_row.revision = message_row.revision
       and timeline_row.last_changed_stream_position =
         message_row.last_changed_stream_position
       and timeline_row.updated_at = latest_row.recorded_at
      join lateral (
        select content_head_row.*
          from public.inbox_v2_message_revisions content_head_row
         where content_head_row.tenant_id = message_row.tenant_id
           and content_head_row.message_id = message_row.id
           and content_head_row.after_content_id is not null
         order by content_head_row.message_revision desc
         limit 1
      ) latest_content_row on true
      left join lateral (
        select lifecycle_head_row.*
          from public.inbox_v2_message_revisions lifecycle_head_row
         where lifecycle_head_row.tenant_id = message_row.tenant_id
           and lifecycle_head_row.message_id = message_row.id
           and lifecycle_head_row.change_kind in (
             'local_delete_tombstone',
             'provider_delete_policy_tombstone'
           )
         order by lifecycle_head_row.message_revision desc
         limit 1
      ) latest_lifecycle_row on true
      where message_row.tenant_id = checked_tenant_id
        and message_row.id = checked_message_id
        and timeline_row.created_at = message_row.created_at
        and message_row.updated_at = latest_row.recorded_at
       and (
         select count(*) = message_row.revision
            and min(history_row.message_revision) = 1
            and max(history_row.message_revision) = message_row.revision
           from public.inbox_v2_message_revisions history_row
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
       )
       and exists (
         select 1
           from public.inbox_v2_message_revisions first_row
          where first_row.tenant_id = message_row.tenant_id
            and first_row.message_id = message_row.id
            and first_row.timeline_item_id = message_row.timeline_item_id
            and first_row.message_revision = 1
            and first_row.expected_previous_revision is null
            and first_row.change_kind = 'created'
            and first_row.before_content_id is null
            and first_row.before_content_revision is null
            and first_row.before_content_state is null
            and first_row.after_content_id is not null
            and first_row.after_content_revision = 1
            and first_row.after_content_state = 'available'
            and first_row.provider_operation_id is null
            and first_row.reason_id is null
            and first_row.action_attribution_id =
              message_row.creation_attribution_id
            and first_row.occurred_at = timeline_row.occurred_at
            and first_row.recorded_at = message_row.created_at
       )
       and not exists (
         select 1
           from public.inbox_v2_message_revisions history_row
           join public.inbox_v2_action_attributions attribution_row
             on attribution_row.tenant_id = history_row.tenant_id
            and attribution_row.id = history_row.action_attribution_id
            left join public.inbox_v2_message_revisions predecessor_row
              on predecessor_row.tenant_id = history_row.tenant_id
             and predecessor_row.message_id = history_row.message_id
             and predecessor_row.message_revision =
               history_row.message_revision - 1
            left join lateral (
              select content_predecessor_candidate_row.*
                from public.inbox_v2_message_revisions
                  content_predecessor_candidate_row
               where content_predecessor_candidate_row.tenant_id =
                       history_row.tenant_id
                 and content_predecessor_candidate_row.message_id =
                       history_row.message_id
                 and content_predecessor_candidate_row.message_revision <
                       history_row.message_revision
                 and content_predecessor_candidate_row.after_content_id is not null
               order by content_predecessor_candidate_row.message_revision desc
               limit 1
            ) content_predecessor_row on true
          where history_row.tenant_id = message_row.tenant_id
            and history_row.message_id = message_row.id
            and (
              history_row.timeline_item_id <> message_row.timeline_item_id
              or not (
                public.inbox_v2_tm_action_attribution_valid(
                  history_row.tenant_id,
                  history_row.action_attribution_id,
                  message_row.conversation_id,
                  true
                )
                or (
                  history_row.message_revision = 1
                  and history_row.change_kind = 'created'
                  and message_row.origin_kind = 'migration'
                  and attribution_row.conversation_id =
                    message_row.conversation_id
                  and attribution_row.action_participant_id =
                    message_row.author_participant_id
                  and attribution_row.app_actor_kind = 'trusted_service'
                  and attribution_row.app_trusted_service_id is not null
                  and attribution_row.source_occurrence_id is null
                  and attribution_row.automation_kind is not null
                  and exists (
                    select 1
                      from public.inbox_v2_conversation_participants
                        migration_author_row
                     where migration_author_row.tenant_id =
                             message_row.tenant_id
                       and migration_author_row.id =
                             message_row.author_participant_id
                       and migration_author_row.conversation_id =
                             message_row.conversation_id
                       and migration_author_row.subject_kind in (
                         'legacy_unknown', 'system'
                       )
                  )
                )
              )
              or attribution_row.created_at <> history_row.recorded_at
              or (history_row.message_revision > 1 and (
                predecessor_row.id is null
                or history_row.expected_previous_revision <>
                  predecessor_row.message_revision
                or predecessor_row.recorded_at > history_row.recorded_at
                or predecessor_row.recorded_stream_position >=
                  history_row.recorded_stream_position
              ))
              or (history_row.message_revision > 1 and exists (
                select 1
                  from public.inbox_v2_message_revisions terminal_row
                 where terminal_row.tenant_id = history_row.tenant_id
                   and terminal_row.message_id = history_row.message_id
                   and terminal_row.message_revision <
                     history_row.message_revision
                   and terminal_row.change_kind in (
                     'privacy_erasure_tombstone',
                     'retention_purge_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and exists (
                select 1
                  from public.inbox_v2_message_revisions lifecycle_row
                 where lifecycle_row.tenant_id = history_row.tenant_id
                   and lifecycle_row.message_id = history_row.message_id
                   and lifecycle_row.message_revision <
                     history_row.message_revision
                   and lifecycle_row.change_kind in (
                     'local_delete_tombstone',
                     'provider_delete_policy_tombstone'
                   )
              ))
              or (history_row.change_kind in (
                    'edited', 'attachment_materialized',
                    'privacy_erasure_tombstone',
                    'retention_purge_tombstone'
                  ) and not (
                history_row.before_content_id =
                  content_predecessor_row.after_content_id
                and history_row.before_content_revision =
                  content_predecessor_row.after_content_revision
                and history_row.before_content_state =
                  content_predecessor_row.after_content_state
                and history_row.before_content_state = 'available'
                and history_row.after_content_id =
                  history_row.before_content_id
                and history_row.after_content_revision =
                  history_row.before_content_revision + 1
                and history_row.after_content_state = case history_row.change_kind
                  when 'privacy_erasure_tombstone' then
                    'privacy_erased'::public.inbox_v2_timeline_content_state
                  when 'retention_purge_tombstone' then
                    'retention_purged'::public.inbox_v2_timeline_content_state
                  else 'available'::public.inbox_v2_timeline_content_state
                end
              ))
              or (history_row.change_kind in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  ) and num_nonnulls(
                    history_row.before_content_id,
                    history_row.before_content_revision,
                    history_row.before_content_state,
                    history_row.after_content_id,
                    history_row.after_content_revision,
                    history_row.after_content_state
                  ) <> 0)
              or (history_row.after_content_id is not null and not exists (
                select 1
                  from public.inbox_v2_timeline_content_revisions content_revision_row
                 where content_revision_row.tenant_id = history_row.tenant_id
                   and content_revision_row.content_id =
                     history_row.after_content_id
                   and content_revision_row.revision =
                     history_row.after_content_revision
                    and content_revision_row.state =
                      history_row.after_content_state
                    and content_revision_row.recorded_stream_position =
                      history_row.recorded_stream_position
                    and content_revision_row.recorded_at = history_row.recorded_at
                    and content_revision_row.transition_kind =
                     case history_row.change_kind
                       when 'created' then
                         'created'::public.inbox_v2_timeline_content_transition_kind
                       when 'edited' then
                         'edit'::public.inbox_v2_timeline_content_transition_kind
                       when 'attachment_materialized' then
                         'attachment_materialization'::public.inbox_v2_timeline_content_transition_kind
                       when 'privacy_erasure_tombstone' then
                         'privacy_erasure'::public.inbox_v2_timeline_content_transition_kind
                       when 'retention_purge_tombstone' then
                         'retention_purge'::public.inbox_v2_timeline_content_transition_kind
                     end
              ))
              or (history_row.change_kind = 'local_delete_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is null
              ))
              or (history_row.change_kind =
                    'provider_delete_policy_tombstone' and not (
                history_row.reason_id is not null
                and history_row.provider_operation_id is not null
              ))
              or (history_row.change_kind not in (
                    'edited', 'provider_delete_policy_tombstone'
                  ) and history_row.provider_operation_id is not null)
              or (history_row.change_kind not in (
                    'local_delete_tombstone',
                    'provider_delete_policy_tombstone'
                  )
                and history_row.reason_id is not null)
              or (history_row.change_kind = 'edited' and (
                (message_row.origin_kind in (
                    'source_originated', 'hulee_external'
                  )) <> (history_row.provider_operation_id is not null)
              ))
              or (history_row.change_kind in (
                    'attachment_materialized',
                    'privacy_erasure_tombstone',
                  'retention_purge_tombstone'
                  ) and attribution_row.app_actor_kind is distinct from
                    'trusted_service')
              or (history_row.change_kind = 'local_delete_tombstone'
                and attribution_row.app_actor_kind is null)
              or (history_row.change_kind = 'edited'
                and message_row.origin_kind in ('internal', 'migration')
                and attribution_row.app_actor_kind is null)
              or (history_row.message_revision > 1
                and attribution_row.source_occurrence_id is not null
                and history_row.provider_operation_id is null)
              or (history_row.provider_operation_id is not null and not exists (
                select 1
                  from public.inbox_v2_message_provider_lifecycle_operations op_row
                 where op_row.tenant_id = history_row.tenant_id
                   and op_row.id = history_row.provider_operation_id
                   and op_row.message_id = history_row.message_id
                   and op_row.action = case history_row.change_kind
                     when 'edited' then
                       'edit'::public.inbox_v2_provider_lifecycle_action
                     when 'provider_delete_policy_tombstone' then
                       'delete'::public.inbox_v2_provider_lifecycle_action
                   end
                   and (
                     history_row.change_kind = 'edited'
                     or (
                       op_row.delete_local_effect = 'tombstone_local'
                       and op_row.policy_decided_at <= history_row.recorded_at
                     )
                   )
                   and (
                     (op_row.origin = 'provider_observed'
                       and op_row.action_attribution_id is null
                       and attribution_row.app_actor_kind is null
                       and attribution_row.source_occurrence_id =
                         op_row.source_occurrence_id
                       and attribution_row.automation_kind is null)
                      or (op_row.origin = 'hulee_requested'
                        and attribution_row.app_actor_kind is not null
                        and attribution_row.source_occurrence_id is null
                        and exists (
                          select 1
                            from public.inbox_v2_action_attributions
                              operation_attribution_row
                           where operation_attribution_row.tenant_id =
                                   op_row.tenant_id
                             and operation_attribution_row.id =
                                   op_row.action_attribution_id
                             and operation_attribution_row.action_participant_id
                                   is not distinct from
                                   attribution_row.action_participant_id
                             and operation_attribution_row.app_actor_kind
                                   is not distinct from
                                   attribution_row.app_actor_kind
                             and operation_attribution_row.app_actor_employee_id
                                   is not distinct from
                                   attribution_row.app_actor_employee_id
                             and operation_attribution_row.app_authorization_epoch
                                   is not distinct from
                                   attribution_row.app_authorization_epoch
                             and operation_attribution_row.app_trusted_service_id
                                   is not distinct from
                                   attribution_row.app_trusted_service_id
                             and operation_attribution_row.source_occurrence_id
                                   is not distinct from
                                   attribution_row.source_occurrence_id
                             and operation_attribution_row.automation_kind
                                   is not distinct from
                                   attribution_row.automation_kind
                             and operation_attribution_row.automation_cause_event_id
                                   is not distinct from
                                   attribution_row.automation_cause_event_id
                             and operation_attribution_row.automation_correlation_id
                                   is not distinct from
                                   attribution_row.automation_correlation_id
                             and operation_attribution_row.automation_caused_at
                                   is not distinct from
                                   attribution_row.automation_caused_at
                             and operation_attribution_row
                                   .automation_initiating_employee_id
                                   is not distinct from
                                   attribution_row.automation_initiating_employee_id
                             and operation_attribution_row
                                   .automation_initiating_authorization_epoch
                                   is not distinct from
                                   attribution_row
                                     .automation_initiating_authorization_epoch
                        ))
                   )
              ))
            )
       )
       and message_row.content_id = latest_content_row.after_content_id
       and message_row.content_revision = latest_content_row.after_content_revision
       and message_row.content_state = latest_content_row.after_content_state
       and (
         (latest_lifecycle_row.change_kind = 'local_delete_tombstone'
           and message_row.lifecycle = 'local_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_reason_id = latest_lifecycle_row.reason_id
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at = latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.change_kind =
               'provider_delete_policy_tombstone'
           and message_row.lifecycle = 'provider_delete_tombstone'
           and message_row.lifecycle_revision_id = latest_lifecycle_row.id
           and message_row.lifecycle_provider_operation_id =
             latest_lifecycle_row.provider_operation_id
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_policy_reason_id =
             latest_lifecycle_row.reason_id
           and message_row.lifecycle_changed_at =
             latest_lifecycle_row.recorded_at)
         or (latest_lifecycle_row.id is null
           and message_row.lifecycle = 'active'
           and message_row.lifecycle_revision_id is null
           and message_row.lifecycle_reason_id is null
           and message_row.lifecycle_provider_operation_id is null
           and message_row.lifecycle_policy_reason_id is null
           and message_row.lifecycle_changed_at is null)
       )
  );
$function$;

create or replace function public.inbox_v2_tm_aux_coherence()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $function$
declare
  changed_row jsonb;
  tenant_key text;
  message_key text;
  operation_key text;
  reaction_key text;
  receipt_key text;
  commit_token_key text;
begin
  changed_row := case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end;
  tenant_key := changed_row->>'tenant_id';

  if not exists (select 1 from public.tenants where id = tenant_key) then
    return null;
  end if;

  if tg_table_name in (
    'inbox_v2_message_transport_fact_commits',
    'inbox_v2_message_delivery_observations',
    'inbox_v2_provider_receipt_observations'
  ) then
    commit_token_key := changed_row->>'commit_token';

    if exists (
      select 1 from public.inbox_v2_message_transport_fact_commits ledger_row
       where ledger_row.tenant_id = tenant_key
         and ledger_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_message_delivery_observations delivery_row
       where delivery_row.tenant_id = tenant_key
         and delivery_row.commit_token = commit_token_key
    ) or exists (
      select 1 from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.commit_token = commit_token_key
    ) then
      if not exists (
        select 1
          from public.inbox_v2_message_transport_fact_commits ledger_row
         where ledger_row.tenant_id = tenant_key
           and ledger_row.commit_token = commit_token_key
           and (
             (ledger_row.fact_kind = 'delivery'
               and exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
                    and delivery_row.id = ledger_row.observation_id
                    and delivery_row.message_id = ledger_row.message_id
                    and delivery_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and delivery_row.observed_at = ledger_row.observed_at
                    and delivery_row.recorded_at = ledger_row.recorded_at
                    and delivery_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and delivery_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
               ))
             or (ledger_row.fact_kind = 'receipt'
               and exists (
                 select 1
                   from public.inbox_v2_provider_receipt_observations receipt_row
                  where receipt_row.tenant_id = ledger_row.tenant_id
                    and receipt_row.commit_token = ledger_row.commit_token
                    and receipt_row.id = ledger_row.observation_id
                    and receipt_row.target_message_id is not distinct from
                      ledger_row.message_id
                    and receipt_row.commit_digest_sha256 =
                      ledger_row.commit_digest_sha256
                    and receipt_row.observed_at = ledger_row.observed_at
                    and receipt_row.recorded_at = ledger_row.recorded_at
                    and receipt_row.recorded_stream_position =
                      ledger_row.recorded_stream_position
                    and receipt_row.revision = ledger_row.revision
               )
               and not exists (
                 select 1
                   from public.inbox_v2_message_delivery_observations delivery_row
                  where delivery_row.tenant_id = ledger_row.tenant_id
                    and delivery_row.commit_token = ledger_row.commit_token
               ))
           )
      ) then
        raise exception using errcode = '23514',
          message = 'inbox_v2.message_transport_fact_commit_coherence';
      end if;
    end if;
  end if;

  if tg_table_name = 'inbox_v2_outbound_route_consumptions'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_outbound_route_consumptions consumption_row
        join public.inbox_v2_outbound_routes route_row
          on route_row.tenant_id = consumption_row.tenant_id
         and route_row.id = consumption_row.outbound_route_id
         and route_row.mutation_token = consumption_row.mutation_token
         and route_row.idempotency_token = consumption_row.idempotency_token
         and route_row.correlation_token = consumption_row.correlation_token
         and route_row.adapter_loaded_by_trusted_service_id =
           consumption_row.consumed_by_trusted_service_id
        join public.inbox_v2_messages message_row
          on message_row.tenant_id = consumption_row.tenant_id
         and message_row.id = consumption_row.message_id
         and message_row.conversation_id = route_row.conversation_id
       where consumption_row.tenant_id = tenant_key
         and consumption_row.id = changed_row->>'id'
         and (
           (consumption_row.consumer_kind = 'message_creation'
             and consumption_row.consumer_id = message_row.id
             and message_row.origin_kind = 'hulee_external'
             and message_row.origin_outbound_route_id = route_row.id
             and message_row.created_at = consumption_row.consumed_at)
           or (consumption_row.consumer_kind = 'provider_lifecycle'
             and exists (
               select 1
                 from public.inbox_v2_message_provider_lifecycle_operations op_row
                where op_row.tenant_id = consumption_row.tenant_id
                  and op_row.id = consumption_row.consumer_id
                  and op_row.message_id = consumption_row.message_id
                  and op_row.origin = 'hulee_requested'
                  and op_row.outbound_route_id = route_row.id
                  and op_row.recorded_at = consumption_row.consumed_at
             ))
           or (consumption_row.consumer_kind = 'reaction'
             and exists (
               select 1
                 from public.inbox_v2_message_reaction_transitions transition_row
                 join public.inbox_v2_message_reactions reaction_row
                   on reaction_row.tenant_id = transition_row.tenant_id
                  and reaction_row.id = transition_row.reaction_id
                where transition_row.tenant_id = consumption_row.tenant_id
                  and transition_row.id = consumption_row.consumer_id
                  and transition_row.mode = 'external_request'
                  and transition_row.outbound_route_id = route_row.id
                  and transition_row.recorded_at = consumption_row.consumed_at
                  and reaction_row.message_id = consumption_row.message_id
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.outbound_route_consumption_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_message_transport_links' then
    message_key := changed_row->>'message_id';
    if tg_op <> 'DELETE' and not public.inbox_v2_tm_transport_occurrence_link_valid(
      tenant_key,
      changed_row->>'id'
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.transport_occurrence_link_invalid';
    end if;
  elsif tg_table_name = 'inbox_v2_message_transport_link_heads' then
    message_key := changed_row->>'message_id';
  end if;

  if message_key is not null and (
    exists (
      select 1 from public.inbox_v2_message_transport_links
       where tenant_id = tenant_key and message_id = message_key
    ) or exists (
      select 1 from public.inbox_v2_message_transport_link_heads
       where tenant_id = tenant_key and message_id = message_key
    )
  ) and not exists (
    select 1
      from public.inbox_v2_message_transport_link_heads head_row
      join public.inbox_v2_message_transport_links latest_row
        on latest_row.tenant_id = head_row.tenant_id
       and latest_row.id = head_row.latest_link_id
       and latest_row.message_id = head_row.message_id
       and latest_row.resulting_head_revision = head_row.revision
       and latest_row.recorded_stream_position =
         head_row.last_changed_stream_position
       and latest_row.linked_at = head_row.updated_at
     where head_row.tenant_id = tenant_key
       and head_row.message_id = message_key
       and head_row.link_count = (
         select count(*)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = head_row.link_count
       and 1 = (
         select min(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and head_row.revision = (
         select max(link_row.resulting_head_revision)
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
       )
       and latest_row.id = (
         select link_row.id
           from public.inbox_v2_message_transport_links link_row
          where link_row.tenant_id = head_row.tenant_id
            and link_row.message_id = head_row.message_id
          order by link_row.resulting_head_revision desc
          limit 1
       )
       and not exists (
         select 1
           from public.inbox_v2_message_transport_links chain_row
          where chain_row.tenant_id = head_row.tenant_id
            and chain_row.message_id = head_row.message_id
            and chain_row.resulting_head_revision > 1
            and not exists (
              select 1
                from public.inbox_v2_message_transport_links predecessor_row
               where predecessor_row.tenant_id = chain_row.tenant_id
                 and predecessor_row.message_id = chain_row.message_id
                 and predecessor_row.resulting_head_revision =
                   chain_row.resulting_head_revision - 1
                 and predecessor_row.linked_at <= chain_row.linked_at
                 and predecessor_row.recorded_stream_position <
                   chain_row.recorded_stream_position
            )
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.transport_link_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_provider_lifecycle_operations' then
    operation_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_message_provider_lifecycle_transitions' then
    operation_key := changed_row->>'operation_id';
  end if;

  if operation_key is not null and exists (
    select 1 from public.inbox_v2_message_provider_lifecycle_operations
     where tenant_id = tenant_key and id = operation_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_provider_lifecycle_operations op_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = op_row.tenant_id
       and message_row.id = op_row.message_id
      join public.inbox_v2_source_occurrences occurrence_row
        on occurrence_row.tenant_id = op_row.tenant_id
       and occurrence_row.id = op_row.source_occurrence_id
       and occurrence_row.source_account_id = op_row.source_account_id
       and occurrence_row.source_thread_binding_id = op_row.source_thread_binding_id
       and occurrence_row.binding_generation = op_row.binding_generation
       and occurrence_row.adapter_contract_id = op_row.adapter_contract_id
       and occurrence_row.adapter_contract_version =
         op_row.adapter_contract_version
       and occurrence_row.adapter_declaration_revision =
         op_row.adapter_declaration_revision
       and occurrence_row.adapter_surface_id = op_row.adapter_surface_id
       and occurrence_row.adapter_loaded_by_trusted_service_id =
         op_row.adapter_loaded_by_trusted_service_id
       and occurrence_row.adapter_loaded_at = op_row.adapter_loaded_at
       and occurrence_row.resolution_state = 'resolved'
       and occurrence_row.resolved_external_message_reference_id =
         op_row.external_message_reference_id
      join public.inbox_v2_external_message_references reference_row
        on reference_row.tenant_id = op_row.tenant_id
       and reference_row.id = op_row.external_message_reference_id
       and reference_row.message_id = op_row.message_id
      left join public.inbox_v2_outbound_routes lifecycle_route_row
        on lifecycle_route_row.tenant_id = op_row.tenant_id
       and lifecycle_route_row.id = op_row.outbound_route_id
     where op_row.tenant_id = tenant_key
       and op_row.id = operation_key
       and public.inbox_v2_tm_provider_lifecycle_history_valid(
         op_row.tenant_id,
         op_row.id
       )
       and (
         (op_row.origin = 'provider_observed' and op_row.outbound_route_id is null)
         or (op_row.origin = 'hulee_requested'
           and lifecycle_route_row.id is not null
            and lifecycle_route_row.required_conversation_permission_id =
              'core:conversation.read'
           and public.inbox_v2_tm_outbound_route_action_valid(
             op_row.tenant_id,
             op_row.outbound_route_id,
             op_row.message_id,
             op_row.message_id,
             message_row.conversation_id,
             op_row.recorded_at,
             op_row.recorded_at,
             'core:message.' || op_row.action::text,
             lifecycle_route_row.required_conversation_permission_id,
             op_row.external_message_reference_id,
             op_row.source_occurrence_id,
             op_row.source_account_id,
             op_row.source_thread_binding_id,
             op_row.binding_generation,
             op_row.adapter_contract_id,
             op_row.adapter_contract_version,
             op_row.adapter_declaration_revision,
             op_row.adapter_surface_id,
             op_row.adapter_loaded_by_trusted_service_id,
             op_row.adapter_loaded_at,
             'core:message-' || op_row.action::text,
             op_row.capability_revision,
             op_row.action_attribution_id,
             false
           )
           and exists (
             select 1
               from public.inbox_v2_outbound_route_consumptions consumption_row
              where consumption_row.tenant_id = op_row.tenant_id
                and consumption_row.consumer_kind = 'provider_lifecycle'
                and consumption_row.consumer_id = op_row.id
                and consumption_row.message_id = op_row.message_id
                and consumption_row.outbound_route_id = op_row.outbound_route_id
           ))
       )
       and (
         op_row.origin <> 'provider_observed'
         or (
           occurrence_row.normalized_inbound_event_id =
             op_row.provider_semantic_normalized_inbound_event_id
           and occurrence_row.provider_actor_source_external_identity_id
             is not distinct from
               op_row.provider_semantic_actor_external_identity_id
           and op_row.provider_semantic_capability_revision =
             occurrence_row.capability_revision
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractId}' = op_row.adapter_contract_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,contractVersion}' =
               op_row.adapter_contract_version
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,declarationRevision}' =
               op_row.adapter_declaration_revision::text
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,surfaceId}' = op_row.adapter_surface_id
           and op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedByTrustedServiceId}' =
               op_row.adapter_loaded_by_trusted_service_id
           and (op_row.provider_semantic_proof_detail #>>
             '{adapterContract,loadedAt}')::timestamptz =
               op_row.adapter_loaded_at
           and (op_row.provider_semantic_proof_detail #>> '{occurredAt}')::timestamptz =
             op_row.occurred_at
           and (op_row.provider_semantic_proof_detail #>> '{recordedAt}')::timestamptz =
             op_row.recorded_at
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_provider_lifecycle_transitions chain_row
          where chain_row.tenant_id = op_row.tenant_id
            and chain_row.operation_id = op_row.id
            and (
              chain_row.resulting_revision > op_row.revision
              or (
                chain_row.expected_revision > 1
                and not exists (
                  select 1
                    from public.inbox_v2_message_provider_lifecycle_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.operation_id = chain_row.operation_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                )
              )
            )
       )
       and (
         (op_row.revision = 1 and not exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
         ))
         or (op_row.revision > 1 and exists (
           select 1
             from public.inbox_v2_message_provider_lifecycle_transitions transition_row
            where transition_row.tenant_id = op_row.tenant_id
              and transition_row.operation_id = op_row.id
              and transition_row.resulting_revision = op_row.revision
              and transition_row.outcome = op_row.outcome
              and transition_row.outcome_retryable is not distinct from
                op_row.outcome_retryable
              and transition_row.outcome_reason_id is not distinct from
                op_row.outcome_reason_id
              and transition_row.delete_local_effect is not distinct from
                op_row.delete_local_effect
              and transition_row.policy_decision_event_id is not distinct from
                op_row.policy_decision_event_id
              and transition_row.policy_decision_revision is not distinct from
                op_row.policy_decision_revision
              and transition_row.policy_decided_at is not distinct from
                op_row.policy_decided_at
              and transition_row.recorded_at = op_row.updated_at
              and transition_row.recorded_stream_position =
                op_row.last_changed_stream_position
         ))
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.provider_lifecycle_operation_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_reactions' then
    reaction_key := changed_row->>'id';
  elsif tg_table_name in (
    'inbox_v2_message_reaction_transitions',
    'inbox_v2_message_reaction_slot_heads'
  ) then
    reaction_key := changed_row->>'reaction_id';
  elsif tg_table_name = 'inbox_v2_message_provider_reaction_observations' then
    select transition_row.reaction_id into reaction_key
      from public.inbox_v2_message_reaction_transitions transition_row
     where transition_row.tenant_id = tenant_key
       and transition_row.id = changed_row->>'transition_id';
  end if;

  if tg_table_name = 'inbox_v2_message_reaction_transitions'
     and tg_op <> 'DELETE'
     and exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
          and transition_row.mode = 'external_request'
     )
     and not exists (
       select 1
         from public.inbox_v2_message_reaction_transitions transition_row
         join public.inbox_v2_message_reactions reaction_row
           on reaction_row.tenant_id = transition_row.tenant_id
          and reaction_row.id = transition_row.reaction_id
         join public.inbox_v2_outbound_route_consumptions consumption_row
           on consumption_row.tenant_id = transition_row.tenant_id
          and consumption_row.consumer_kind = 'reaction'
          and consumption_row.consumer_id = transition_row.id
          and consumption_row.message_id = reaction_row.message_id
          and consumption_row.outbound_route_id = transition_row.outbound_route_id
        where transition_row.tenant_id = tenant_key
          and transition_row.id = changed_row->>'id'
     ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.reaction_route_consumption_missing';
  end if;

  if reaction_key is not null and exists (
    select 1 from public.inbox_v2_message_reactions
     where tenant_id = tenant_key and id = reaction_key
  ) and not exists (
    select 1
      from public.inbox_v2_message_reactions reaction_row
      join public.inbox_v2_messages message_row
        on message_row.tenant_id = reaction_row.tenant_id
       and message_row.id = reaction_row.message_id
      join public.inbox_v2_message_reaction_slot_heads slot_row
        on slot_row.tenant_id = reaction_row.tenant_id
       and slot_row.message_id = reaction_row.message_id
       and slot_row.semantic_slot_key = reaction_row.semantic_slot_key
       and slot_row.reaction_id = reaction_row.id
       and slot_row.state_kind = reaction_row.state_kind
       and slot_row.revision = reaction_row.revision
     where reaction_row.tenant_id = tenant_key
       and reaction_row.id = reaction_key
       and (
         reaction_row.actor_participant_id is null or exists (
           select 1 from public.inbox_v2_conversation_participants participant_row
            where participant_row.tenant_id = reaction_row.tenant_id
              and participant_row.id = reaction_row.actor_participant_id
              and participant_row.conversation_id = message_row.conversation_id
         )
       )
       and not exists (
         select 1
           from public.inbox_v2_message_reaction_transitions chain_row
          where chain_row.tenant_id = reaction_row.tenant_id
            and chain_row.reaction_id = reaction_row.id
            and (
             chain_row.resulting_revision > reaction_row.revision
             or ((chain_row.mode = 'provider_observed') <>
               exists (
                 select 1
                   from public.inbox_v2_message_provider_reaction_observations
                     observation_row
                  where observation_row.tenant_id = chain_row.tenant_id
                    and observation_row.transition_id = chain_row.id
               ))
              or (
               chain_row.expected_revision is null
               and chain_row.recorded_at <> reaction_row.created_at
             )
             or (
               chain_row.expected_revision is not null
                and not exists (
                  select 1
                    from public.inbox_v2_message_reaction_transitions predecessor_row
                   where predecessor_row.tenant_id = chain_row.tenant_id
                     and predecessor_row.reaction_id = chain_row.reaction_id
                     and predecessor_row.resulting_revision =
                       chain_row.expected_revision
                     and predecessor_row.after_state_kind =
                       chain_row.before_state_kind
                     and predecessor_row.after_state_detail =
                       chain_row.before_state_detail
                      and predecessor_row.after_state_detail_digest_sha256 =
                        chain_row.before_state_detail_digest_sha256
                      and predecessor_row.recorded_at <= chain_row.recorded_at
                      and predecessor_row.recorded_stream_position <
                        chain_row.recorded_stream_position
                 )
              )
            )
       )
       and exists (
         select 1 from public.inbox_v2_message_reaction_transitions transition_row
          where transition_row.tenant_id = reaction_row.tenant_id
            and transition_row.reaction_id = reaction_row.id
            and transition_row.semantic_slot_key = reaction_row.semantic_slot_key
            and transition_row.resulting_revision = reaction_row.revision
            and transition_row.after_state_kind = reaction_row.state_kind
            and transition_row.value_kind = reaction_row.value_kind
            and transition_row.unicode_value is not distinct from
              reaction_row.unicode_value
            and transition_row.provider_reaction_kind_id is not distinct from
              reaction_row.provider_reaction_kind_id
            and transition_row.provider_canonical_code is not distinct from
              reaction_row.provider_canonical_code
            and transition_row.after_state_detail = reaction_row.state_detail
            and transition_row.after_state_detail_digest_sha256 =
              reaction_row.state_detail_digest_sha256
            and transition_row.recorded_at = reaction_row.updated_at
            and transition_row.result_token is not distinct from
              reaction_row.result_token
            and transition_row.result_digest_sha256 is not distinct from
              reaction_row.result_digest_sha256
            and (
              reaction_row.state_kind = 'active'
              or (
                reaction_row.state_kind = 'cleared'
                and (reaction_row.state_detail #>>
                  '{clearedAt}')::timestamptz = reaction_row.cleared_at
              )
              or (
                reaction_row.state_kind = 'pending_external'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.request_transition_id = transition_row.id
                and reaction_row.request_attribution_id =
                  transition_row.action_attribution_id
                and (reaction_row.state_detail #>>
                  '{requestedAt}')::timestamptz = reaction_row.updated_at
              )
              or (
                reaction_row.state_kind = 'external_terminal'
                and transition_row.operation =
                  reaction_row.external_operation
                and reaction_row.state_detail #>> '{operation}' =
                  reaction_row.external_operation::text
                and reaction_row.state_detail #>>
                  '{outboundRoute,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>> '{outboundRoute,kind}' =
                  'outbound_route'
                and reaction_row.state_detail #>> '{outboundRoute,id}' =
                  reaction_row.outbound_route_id
                and reaction_row.state_detail #>>
                  '{requestTransition,tenantId}' = reaction_row.tenant_id
                and reaction_row.state_detail #>>
                  '{requestTransition,kind}' = 'message_reaction_transition'
                and reaction_row.state_detail #>> '{requestTransition,id}' =
                  reaction_row.request_transition_id
                and reaction_row.state_detail #>> '{outcome}' =
                  reaction_row.external_outcome
                and reaction_row.state_detail #>> '{resultToken}' =
                  reaction_row.result_token
                and reaction_row.state_detail #>> '{resultDigestSha256}' =
                  reaction_row.result_digest_sha256
                and (reaction_row.state_detail #>>
                  '{resolvedAt}')::timestamptz = reaction_row.resolved_at
              )
            )
            and transition_row.recorded_stream_position =
              reaction_row.last_changed_stream_position
       )
  ) then
    raise exception using errcode = '23514',
      message = 'inbox_v2.message_reaction_head_coherence';
  end if;

  if tg_table_name = 'inbox_v2_message_delivery_observations'
     and tg_op <> 'DELETE' then
    if not exists (
      select 1
        from public.inbox_v2_message_delivery_observations observation_row
       where observation_row.tenant_id = tenant_key
         and observation_row.id = changed_row->>'id'
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
            where snapshot_row.tenant_id = observation_row.tenant_id
              and snapshot_row.binding_id =
                observation_row.source_thread_binding_id
              and snapshot_row.source_account_id =
                observation_row.source_account_id
              and snapshot_row.binding_generation =
                observation_row.binding_generation
              and snapshot_row.capability_contract_id =
                observation_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                observation_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                observation_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                observation_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                observation_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at =
                observation_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                observation_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id =
                     observation_row.capability_id
              )
         )
         and (
           (observation_row.scope_kind = 'dispatch' and exists (
             select 1
               from public.inbox_v2_outbound_dispatches dispatch_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = dispatch_row.tenant_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.dispatch_id = dispatch_row.id
                and attempt_row.route_id = dispatch_row.route_id
                and attempt_row.message_id = dispatch_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = dispatch_row.tenant_id
                and route_row.id = dispatch_row.route_id
               join public.inbox_v2_messages message_row
                 on message_row.tenant_id = dispatch_row.tenant_id
                and message_row.id = dispatch_row.message_id
               where dispatch_row.tenant_id = observation_row.tenant_id
                 and dispatch_row.id = observation_row.scope_dispatch_id
                 and dispatch_row.message_id = observation_row.message_id
                 and dispatch_row.state <> 'queued'
                 and dispatch_row.last_attempt_id = attempt_row.id
                 and dispatch_row.attempt_count >= attempt_row.attempt_number
                 and message_row.origin_kind = 'hulee_external'
                 and message_row.origin_outbound_route_id = route_row.id
                 and route_row.source_account_id = observation_row.source_account_id
                 and route_row.source_thread_binding_id =
                   observation_row.source_thread_binding_id
                 and route_row.binding_generation =
                   observation_row.binding_generation
                 and route_row.adapter_contract_id =
                   observation_row.adapter_contract_id
                 and route_row.adapter_contract_version =
                   observation_row.adapter_contract_version
                 and route_row.adapter_declaration_revision =
                   observation_row.adapter_declaration_revision
                 and route_row.adapter_surface_id = observation_row.adapter_surface_id
                 and route_row.adapter_loaded_by_trusted_service_id =
                   observation_row.adapter_loaded_by_trusted_service_id
                 and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   observation_row.scope_artifact_id is null
                   or exists (
                    select 1
                      from public.inbox_v2_outbound_dispatch_artifacts artifact_row
                     where artifact_row.tenant_id = dispatch_row.tenant_id
                       and artifact_row.id = observation_row.scope_artifact_id
                       and artifact_row.dispatch_id = dispatch_row.id
                       and artifact_row.route_id = dispatch_row.route_id
                       and artifact_row.message_id = dispatch_row.message_id
                       and artifact_row.attempt_id =
                         observation_row.scope_attempt_id
                  )
                 )
            ))
            or (observation_row.scope_kind = 'external_reference' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = reference_row.tenant_id
                 and occurrence_row.id = observation_row.scope_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.resolved_external_message_reference_id =
                   reference_row.id
                 and occurrence_row.external_thread_id =
                   reference_row.external_thread_id
                 and occurrence_row.conversation_id = reference_row.conversation_id
                 and occurrence_row.message_key_digest_sha256 =
                   reference_row.message_key_digest_sha256
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
            or (observation_row.scope_kind = 'recipient' and exists (
              select 1
                from public.inbox_v2_external_message_references reference_row
               where reference_row.tenant_id = observation_row.tenant_id
                 and reference_row.id =
                   observation_row.scope_external_message_reference_id
                 and reference_row.message_id = observation_row.message_id
            ))
          )
         and (
           (observation_row.evidence_kind = 'provider_result' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_attempts attempt_row
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where attempt_row.tenant_id = observation_row.tenant_id
                and attempt_row.id = observation_row.evidence_attempt_id
                and attempt_row.dispatch_id = observation_row.scope_dispatch_id
                and attempt_row.id = observation_row.scope_attempt_id
                and attempt_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and attempt_row.completion_source = 'provider_result'
                 and (
                   (observation_row.fact = 'accepted'
                     and attempt_row.outcome_kind = 'accepted')
                   or (observation_row.fact = 'failed'
                     and attempt_row.outcome_kind in (
                       'retryable_failure', 'terminal_failure'
                     ))
                 )
            ))
           or (observation_row.evidence_kind = 'provider_artifact' and exists (
             select 1
               from public.inbox_v2_outbound_dispatch_artifacts artifact_row
               join public.inbox_v2_outbound_dispatch_attempts attempt_row
                 on attempt_row.tenant_id = artifact_row.tenant_id
                and attempt_row.id = artifact_row.attempt_id
                and attempt_row.dispatch_id = artifact_row.dispatch_id
                and attempt_row.route_id = artifact_row.route_id
                and attempt_row.message_id = artifact_row.message_id
               join public.inbox_v2_outbound_routes route_row
                 on route_row.tenant_id = attempt_row.tenant_id
                and route_row.id = attempt_row.route_id
              where artifact_row.tenant_id = observation_row.tenant_id
                and artifact_row.id = observation_row.evidence_artifact_id
                and artifact_row.id = observation_row.scope_artifact_id
                and artifact_row.attempt_id = observation_row.evidence_attempt_id
                and artifact_row.attempt_id = observation_row.scope_attempt_id
                and artifact_row.dispatch_id = observation_row.scope_dispatch_id
                and artifact_row.message_id = observation_row.message_id
                and route_row.source_account_id =
                  observation_row.source_account_id
                and route_row.source_thread_binding_id =
                  observation_row.source_thread_binding_id
                and route_row.binding_generation =
                  observation_row.binding_generation
                and route_row.adapter_contract_id =
                  observation_row.adapter_contract_id
                and route_row.adapter_contract_version =
                  observation_row.adapter_contract_version
                and route_row.adapter_declaration_revision =
                  observation_row.adapter_declaration_revision
                and route_row.adapter_surface_id =
                  observation_row.adapter_surface_id
                and route_row.adapter_loaded_by_trusted_service_id =
                  observation_row.adapter_loaded_by_trusted_service_id
                and route_row.adapter_loaded_at = observation_row.adapter_loaded_at
                 and route_row.capability_revision =
                   observation_row.capability_revision
                 and (
                   (observation_row.fact = 'accepted'
                     and artifact_row.state = 'accepted')
                   or (observation_row.fact = 'failed'
                     and artifact_row.state = 'failed')
                 )
            ))
           or (observation_row.evidence_kind = 'provider_event' and exists (
               select 1
                 from public.inbox_v2_source_occurrences occurrence_row
                 join public.inbox_v2_external_message_references reference_row
                   on reference_row.tenant_id = occurrence_row.tenant_id
                   and reference_row.id =
                     observation_row.evidence_external_message_reference_id
                   and reference_row.message_id = observation_row.message_id
                   and reference_row.external_thread_id =
                     occurrence_row.external_thread_id
                   and reference_row.conversation_id = occurrence_row.conversation_id
                   and reference_row.message_key_digest_sha256 =
                     occurrence_row.message_key_digest_sha256
                 where occurrence_row.tenant_id = observation_row.tenant_id
                  and occurrence_row.id =
                    observation_row.evidence_source_occurrence_id
                  and occurrence_row.normalized_inbound_event_id =
                    observation_row.evidence_normalized_inbound_event_id
                  and occurrence_row.source_account_id =
                    observation_row.source_account_id
                  and occurrence_row.source_thread_binding_id =
                    observation_row.source_thread_binding_id
                  and occurrence_row.binding_generation =
                    observation_row.binding_generation
                  and occurrence_row.adapter_contract_id =
                    observation_row.adapter_contract_id
                  and occurrence_row.adapter_contract_version =
                    observation_row.adapter_contract_version
                  and occurrence_row.adapter_declaration_revision =
                    observation_row.adapter_declaration_revision
                  and occurrence_row.adapter_surface_id =
                    observation_row.adapter_surface_id
                  and occurrence_row.adapter_loaded_by_trusted_service_id =
                    observation_row.adapter_loaded_by_trusted_service_id
                  and occurrence_row.adapter_loaded_at =
                    observation_row.adapter_loaded_at
                   and occurrence_row.capability_revision =
                     observation_row.capability_revision
                   and occurrence_row.resolution_state = 'resolved'
                   and occurrence_row.resolved_external_message_reference_id =
                     observation_row.evidence_external_message_reference_id
                   and occurrence_row.origin_kind <> 'provider_response'
                   and (
                     observation_row.scope_kind <> 'dispatch'
                     or (
                       occurrence_row.origin_kind = 'provider_echo'
                       and occurrence_row.direction = 'outbound'
                     )
                   )
                   and (
                     observation_row.scope_kind = 'dispatch'
                     or (observation_row.scope_kind = 'external_reference'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id
                       and observation_row.scope_source_occurrence_id =
                         occurrence_row.id)
                     or (observation_row.scope_kind = 'recipient'
                       and observation_row.scope_external_message_reference_id =
                         reference_row.id)
                   )
              ))
         )
         and (
           (observation_row.evidence_kind <> 'provider_event'
             and observation_row.semantic_proof_detail is null
             and observation_row.semantic_proof_digest_sha256 is null)
           or (observation_row.evidence_kind = 'provider_event'
             and observation_row.semantic_proof_digest_sha256 is not null
             and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
               observation_row.semantic_proof_detail,
               observation_row.tenant_id,
               observation_row.evidence_normalized_inbound_event_id,
               observation_row.evidence_external_message_reference_id,
               observation_row.evidence_source_occurrence_id,
               observation_row.source_account_id,
               observation_row.source_thread_binding_id,
               observation_row.binding_generation,
               observation_row.adapter_contract_id,
               observation_row.adapter_contract_version,
               observation_row.adapter_declaration_revision,
               observation_row.adapter_surface_id,
               observation_row.adapter_loaded_by_trusted_service_id,
               observation_row.adapter_loaded_at,
               observation_row.capability_id,
               observation_row.capability_revision,
               'core:message.delivery.' || observation_row.fact::text,
               case when observation_row.scope_kind = 'recipient'
                 then observation_row.scope_recipient_source_identity_id
                 else null
               end,
               observation_row.observed_at,
               observation_row.recorded_at
             ))
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.message_delivery_observation_coherence';
    end if;
  end if;

  if tg_table_name = 'inbox_v2_provider_receipt_observations'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'id';
  elsif tg_table_name = 'inbox_v2_provider_receipt_opaque_payloads'
     and tg_op <> 'DELETE' then
    receipt_key := changed_row->>'receipt_observation_id';
  end if;

  if receipt_key is not null then
    if not exists (
      select 1
        from public.inbox_v2_provider_receipt_observations receipt_row
       where receipt_row.tenant_id = tenant_key
         and receipt_row.id = receipt_key
         and exists (
           select 1
             from public.inbox_v2_source_thread_binding_snapshots snapshot_row
             join public.normalized_inbound_events event_row
               on event_row.tenant_id = snapshot_row.tenant_id
              and event_row.id = receipt_row.evidence_normalized_inbound_event_id
              and event_row.source_connection_id =
                snapshot_row.source_connection_id
              and event_row.source_account_id = snapshot_row.source_account_id
            where snapshot_row.tenant_id = receipt_row.tenant_id
              and snapshot_row.binding_id = receipt_row.source_thread_binding_id
              and snapshot_row.source_account_id = receipt_row.source_account_id
              and snapshot_row.binding_generation =
                receipt_row.binding_generation
              and snapshot_row.capability_contract_id =
                receipt_row.adapter_contract_id
              and snapshot_row.capability_contract_version =
                receipt_row.adapter_contract_version
              and snapshot_row.capability_declaration_revision =
                receipt_row.adapter_declaration_revision
              and snapshot_row.capability_surface_id =
                receipt_row.adapter_surface_id
              and snapshot_row.capability_loaded_by_trusted_service_id =
                receipt_row.adapter_loaded_by_trusted_service_id
              and snapshot_row.capability_loaded_at = receipt_row.adapter_loaded_at
              and snapshot_row.capability_revision =
                receipt_row.capability_revision
              and exists (
                select 1
                  from public.inbox_v2_source_thread_binding_capability_entries capability_row
                 where capability_row.tenant_id = snapshot_row.tenant_id
                   and capability_row.binding_id = snapshot_row.binding_id
                   and capability_row.materialized_by_binding_revision =
                     snapshot_row.revision
                   and capability_row.capability_revision =
                     snapshot_row.capability_revision
                   and capability_row.capability_id = receipt_row.capability_id
              )
         )
         and (
           receipt_row.target_kind <> 'exact_message' or exists (
             select 1
               from public.inbox_v2_messages message_row
                join public.inbox_v2_source_occurrences occurrence_row
                  on occurrence_row.tenant_id = message_row.tenant_id
                 and occurrence_row.id = receipt_row.target_source_occurrence_id
                 and occurrence_row.resolution_state = 'resolved'
                 and occurrence_row.source_account_id = receipt_row.source_account_id
                 and occurrence_row.source_thread_binding_id =
                   receipt_row.source_thread_binding_id
                and occurrence_row.binding_generation =
                  receipt_row.binding_generation
                 and occurrence_row.normalized_inbound_event_id =
                   receipt_row.evidence_normalized_inbound_event_id
                 and occurrence_row.resolved_external_message_reference_id =
                   receipt_row.target_external_message_reference_id
                 and occurrence_row.origin_kind <> 'provider_response'
                 and occurrence_row.adapter_contract_id =
                   receipt_row.adapter_contract_id
                 and occurrence_row.adapter_contract_version =
                   receipt_row.adapter_contract_version
                 and occurrence_row.adapter_declaration_revision =
                   receipt_row.adapter_declaration_revision
                 and occurrence_row.adapter_surface_id = receipt_row.adapter_surface_id
                 and occurrence_row.adapter_loaded_by_trusted_service_id =
                   receipt_row.adapter_loaded_by_trusted_service_id
                 and occurrence_row.adapter_loaded_at = receipt_row.adapter_loaded_at
                 and occurrence_row.capability_revision =
                   receipt_row.capability_revision
                join public.inbox_v2_external_message_references reference_row
                  on reference_row.tenant_id = message_row.tenant_id
                 and reference_row.id =
                   receipt_row.target_external_message_reference_id
                 and reference_row.message_id = message_row.id
                 and reference_row.external_thread_id =
                   occurrence_row.external_thread_id
                 and reference_row.conversation_id = occurrence_row.conversation_id
                 and reference_row.message_key_digest_sha256 =
                   occurrence_row.message_key_digest_sha256
               where message_row.tenant_id = receipt_row.tenant_id
                 and message_row.id = receipt_row.target_message_id
                 and (
                   (occurrence_row.provider_actor_kind =
                       'source_external_identity'
                     and receipt_row.reader_kind = 'source_external_identity'
                     and receipt_row.reader_source_external_identity_id =
                       occurrence_row.provider_actor_source_external_identity_id)
                   or (occurrence_row.provider_actor_kind is distinct from
                         'source_external_identity'
                     and receipt_row.reader_kind = 'aggregate_only')
                 )
            )
         )
         and (
           (receipt_row.opaque_payload_id is null
             and receipt_row.opaque_data_class_id is null
             and receipt_row.provider_watermark_digest_sha256 is null
             and receipt_row.reader_aggregate_key_digest_sha256 is null
             and not exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.receipt_observation_id = receipt_row.id
             ))
           or (receipt_row.opaque_payload_id is not null
             and receipt_row.opaque_data_class_id =
               'core:source_occurrence_and_external_reference'
             and exists (
               select 1
                 from public.inbox_v2_provider_receipt_opaque_payloads payload_row
                where payload_row.tenant_id = receipt_row.tenant_id
                  and payload_row.id = receipt_row.opaque_payload_id
                  and payload_row.receipt_observation_id = receipt_row.id
                  and payload_row.data_class_id = receipt_row.opaque_data_class_id
                  and (payload_row.provider_watermark is null) =
                    (receipt_row.provider_watermark_digest_sha256 is null)
                  and (payload_row.reader_aggregate_key is null) =
                    (receipt_row.reader_aggregate_key_digest_sha256 is null)
                  and (payload_row.provider_watermark is null or
                    encode(sha256(convert_to(
                      payload_row.provider_watermark, 'UTF8'
                    )), 'hex') =
                      receipt_row.provider_watermark_digest_sha256)
                  and (payload_row.reader_aggregate_key is null or
                    encode(sha256(convert_to(
                      payload_row.reader_aggregate_key, 'UTF8'
                    )), 'hex') =
                      receipt_row.reader_aggregate_key_digest_sha256)
             ))
         )
         and public.inbox_v2_tm_provider_fact_semantic_proof_valid(
           receipt_row.semantic_proof_detail,
           receipt_row.tenant_id,
           receipt_row.evidence_normalized_inbound_event_id,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_external_message_reference_id
             else null
           end,
           case when receipt_row.target_kind = 'exact_message'
             then receipt_row.target_source_occurrence_id
             else null
           end,
           receipt_row.source_account_id,
           receipt_row.source_thread_binding_id,
           receipt_row.binding_generation,
           receipt_row.adapter_contract_id,
           receipt_row.adapter_contract_version,
           receipt_row.adapter_declaration_revision,
           receipt_row.adapter_surface_id,
           receipt_row.adapter_loaded_by_trusted_service_id,
           receipt_row.adapter_loaded_at,
           receipt_row.capability_id,
           receipt_row.capability_revision,
           'core:message.receipt.read',
           case when receipt_row.reader_kind = 'source_external_identity'
             then receipt_row.reader_source_external_identity_id
             else null
           end,
           receipt_row.observed_at,
           receipt_row.recorded_at
         )
    ) then
      raise exception using errcode = '23514',
        message = 'inbox_v2.provider_receipt_observation_coherence';
    end if;
  end if;

  return null;
end;
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
  v_provider_operation_change_count integer;
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
         intent_row.type_id in (
           'core:provider.dispatch', 'core:provider.message_lifecycle'
         ) and intent_row.effect_class <> 'provider_io'
       )
       or (
         intent_row.effect_class = 'provider_io'
         and (
           intent_row.type_id not in (
             'core:provider.dispatch', 'core:provider.message_lifecycle'
           )
            or intent_row.payload_reference is null
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
            or (
              intent_row.type_id = 'core:provider.dispatch'
              and (
                intent_row.payload_reference->>'schemaId' <>
                  'core:inbox-v2.outbound-dispatch'
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
            or (
              intent_row.type_id = 'core:provider.message_lifecycle'
              and (
                intent_row.payload_reference->>'schemaId' <>
                  'core:inbox-v2.message-provider-lifecycle-operation'
                or not exists (
                  select 1
                  from public.inbox_v2_message_provider_lifecycle_operations
                    operation_row
                  join public.inbox_v2_outbound_route_consumptions consumption_row
                    on consumption_row.tenant_id = operation_row.tenant_id
                   and consumption_row.consumer_kind = 'provider_lifecycle'
                   and consumption_row.consumer_id = operation_row.id
                   and consumption_row.message_id = operation_row.message_id
                   and consumption_row.outbound_route_id =
                     operation_row.outbound_route_id
                  join public.inbox_v2_tenant_stream_changes lifecycle_change
                    on lifecycle_change.tenant_id = operation_row.tenant_id
                   and lifecycle_change.stream_commit_id =
                     intent_row.stream_commit_id
                   and lifecycle_change.mutation_id = intent_row.mutation_id
                   and lifecycle_change.id in (
                     select jsonb_array_elements_text(intent_row.change_ids)
                   )
                  where operation_row.tenant_id = intent_row.tenant_id
                    and operation_row.id =
                      intent_row.payload_reference->>'recordId'
                    and operation_row.origin = 'hulee_requested'
                    and operation_row.outcome = 'pending'
                    and operation_row.outbound_route_id is not null
                    and operation_row.revision = 1
                    and operation_row.created_stream_position = v_stream.position
                    and operation_row.last_changed_stream_position =
                      v_stream.position
                    and operation_row.recorded_at = new.committed_at
                    and operation_row.created_at = new.committed_at
                    and operation_row.updated_at = new.committed_at
                    and event_row.subjects @> jsonb_build_array(
                      jsonb_build_object(
                        'tenantId', operation_row.tenant_id,
                        'entityTypeId', 'core:message',
                        'entityId', operation_row.message_id
                      )
                    )
                    and lifecycle_change.entity_type_id =
                      'core:message-provider-lifecycle-operation'
                    and lifecycle_change.entity_id = operation_row.id
                    and lifecycle_change.resulting_revision =
                      operation_row.revision
                    and lifecycle_change.state_kind = 'upsert'
                    and lifecycle_change.state_schema_id =
                      'core:inbox-v2.message-provider-lifecycle-operation'
                    and lifecycle_change.state_schema_version = 'v1'
                    and lifecycle_change.payload_reference =
                      intent_row.payload_reference
                    and lifecycle_change.state_hash =
                      lifecycle_change.payload_reference->>'digest'
                    and (
                      (
                        operation_row.action = 'edit'
                        and exists (
                          select 1
                          from public.inbox_v2_tenant_stream_changes
                            message_change
                          join public.inbox_v2_message_revisions revision_row
                            on revision_row.tenant_id =
                              message_change.tenant_id
                           and revision_row.message_id =
                              message_change.entity_id
                           and revision_row.message_revision =
                              message_change.resulting_revision
                          where message_change.tenant_id =
                              operation_row.tenant_id
                            and message_change.stream_commit_id =
                              intent_row.stream_commit_id
                            and message_change.mutation_id =
                              intent_row.mutation_id
                            and message_change.entity_type_id = 'core:message'
                            and message_change.entity_id =
                              operation_row.message_id
                            and message_change.state_kind = 'upsert'
                            and message_change.state_schema_id =
                              'core:inbox-v2.message'
                            and message_change.state_schema_version = 'v1'
                            and message_change.state_hash =
                              message_change.payload_reference->>'digest'
                            and revision_row.change_kind = 'edited'
                            and revision_row.provider_operation_id =
                              operation_row.id
                            and revision_row.recorded_stream_position =
                              v_stream.position
                            and event_row.change_ids @> jsonb_build_array(
                              lifecycle_change.id,
                              message_change.id
                            )
                        )
                      ) or (
                        operation_row.action = 'delete'
                        and not exists (
                          select 1
                          from public.inbox_v2_tenant_stream_changes
                            message_change
                          where message_change.tenant_id =
                              operation_row.tenant_id
                            and message_change.stream_commit_id =
                              intent_row.stream_commit_id
                            and message_change.mutation_id =
                              intent_row.mutation_id
                            and message_change.entity_type_id = 'core:message'
                            and message_change.entity_id =
                              operation_row.message_id
                        )
                      )
                    )
                )
              )
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
     and v_command.command_type_id not in (
       'core:attachment.materialization.complete',
       'core:message.edit',
       'core:message.delete_local',
       'core:message.delete_provider'
     )
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

  -- Message lifecycle commands advance an existing Message aggregate. They
  -- must not pass through the revision-1 creation validator above: the exact
  -- Message revision, current heads, event and projection are closed here.
  select v_invalid_count + count(*)::integer into v_invalid_count
    from public.inbox_v2_tenant_stream_changes message_change
    left join public.inbox_v2_messages message_row
      on message_row.tenant_id = message_change.tenant_id
     and message_row.id = message_change.entity_id
    left join public.inbox_v2_timeline_items timeline_row
      on timeline_row.tenant_id = message_row.tenant_id
     and timeline_row.id = message_row.timeline_item_id
    left join public.inbox_v2_message_revisions lifecycle_revision_row
      on lifecycle_revision_row.tenant_id = message_change.tenant_id
     and lifecycle_revision_row.id =
       message_change.domain_commit_reference->>'recordId'
    left join public.inbox_v2_timeline_contents content_row
      on content_row.tenant_id = message_row.tenant_id
     and content_row.id = message_row.content_id
    left join public.inbox_v2_timeline_content_revisions
      content_revision_row
      on content_revision_row.tenant_id = content_row.tenant_id
     and content_revision_row.content_id = content_row.id
     and content_revision_row.revision = content_row.revision
   where message_change.tenant_id = new.tenant_id
     and message_change.stream_commit_id = new.stream_commit_id
     and message_change.mutation_id = new.mutation_id
     and message_change.entity_type_id = 'core:message'
     and v_command.command_type_id in (
       'core:message.edit',
       'core:message.delete_local'
     )
     and (
       message_change.resulting_revision < 2
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
          'core:inbox-v2.message-revision'
       or message_change.domain_commit_reference->>'schemaVersion' is distinct
          from 'v1'
       or v_audit.evidence_reference is distinct from
          message_change.domain_commit_reference
       or message_change.audience not in (
         'conversation_external', 'internal_participants'
       )
       or message_row.id is null
       or message_row.revision <> message_change.resulting_revision
       or message_row.last_changed_stream_position <>
          message_change.stream_position
       or message_row.updated_at <> new.committed_at
       or timeline_row.id is null
       or timeline_row.subject_kind <> 'message'
       or timeline_row.subject_id <> message_row.id
       or timeline_row.conversation_id <> message_row.conversation_id
       or timeline_row.revision <> message_row.revision
       or timeline_row.visibility::text <> message_change.audience::text
       or timeline_row.last_changed_stream_position <>
          message_change.stream_position
       or timeline_row.updated_at <> new.committed_at
       or message_change.timeline is distinct from jsonb_build_object(
         'conversation', jsonb_build_object(
           'tenantId', message_row.tenant_id,
           'id', message_row.conversation_id,
           'kind', 'conversation'
         ),
         'timelineSequence', timeline_row.timeline_sequence::text
       )
       or lifecycle_revision_row.id is null
       or lifecycle_revision_row.message_id <> message_row.id
       or lifecycle_revision_row.timeline_item_id <> message_row.timeline_item_id
       or lifecycle_revision_row.message_revision <>
          message_change.resulting_revision
       or lifecycle_revision_row.expected_previous_revision <>
          message_change.resulting_revision - 1
       or lifecycle_revision_row.recorded_stream_position <>
          message_change.stream_position
       or lifecycle_revision_row.recorded_at <> new.committed_at
       or lifecycle_revision_row.record_revision <> 1
       or (
         v_command.command_type_id = 'core:message.edit'
         and (
           lifecycle_revision_row.change_kind <> 'edited'
           or lifecycle_revision_row.after_content_id is distinct from
              message_row.content_id
           or lifecycle_revision_row.after_content_revision is distinct from
              message_row.content_revision
           or lifecycle_revision_row.after_content_state::text is distinct from
              message_row.content_state::text
           or lifecycle_revision_row.before_content_id is null
           or lifecycle_revision_row.before_content_revision is null
           or lifecycle_revision_row.before_content_state is null
           or lifecycle_revision_row.reason_id is not null
           or message_row.lifecycle <> 'active'
           or content_row.id is null
           or content_row.owner_kind <> 'message'
           or content_row.owner_id <> message_row.id
           or content_row.revision <> message_row.content_revision
           or content_row.state <> message_row.content_state
           or content_row.last_changed_stream_position <>
              message_change.stream_position
           or content_row.updated_at <> new.committed_at
           or content_revision_row.content_id is null
           or content_revision_row.transition_kind <> 'edit'
           or content_revision_row.expected_previous_revision <>
              content_revision_row.revision - 1
           or content_revision_row.recorded_stream_position <>
              message_change.stream_position
           or content_revision_row.occurred_at <>
              lifecycle_revision_row.occurred_at
           or content_revision_row.recorded_at <> new.committed_at
           or (
             select count(*)
               from public.inbox_v2_tenant_stream_changes operation_change
              where operation_change.tenant_id = message_change.tenant_id
                and operation_change.stream_commit_id =
                  message_change.stream_commit_id
                and operation_change.mutation_id = message_change.mutation_id
                and operation_change.entity_type_id =
                  'core:message-provider-lifecycle-operation'
                and operation_change.entity_id =
                  lifecycle_revision_row.provider_operation_id
           ) <> case
             when lifecycle_revision_row.provider_operation_id is null then 0
             else 1
           end
         )
       )
       or (
         v_command.command_type_id = 'core:message.delete_local'
         and (
           lifecycle_revision_row.change_kind <>
             'local_delete_tombstone'
           or lifecycle_revision_row.provider_operation_id is not null
           or lifecycle_revision_row.reason_id is distinct from
              v_audit.reason_code_id
           or num_nonnulls(
             lifecycle_revision_row.before_content_id,
             lifecycle_revision_row.before_content_revision,
             lifecycle_revision_row.before_content_state,
             lifecycle_revision_row.after_content_id,
             lifecycle_revision_row.after_content_revision,
             lifecycle_revision_row.after_content_state
           ) <> 0
           or message_row.lifecycle <> 'local_delete_tombstone'
           or message_row.lifecycle_revision_id is distinct from
              lifecycle_revision_row.id
           or message_row.lifecycle_reason_id is distinct from
              lifecycle_revision_row.reason_id
           or exists (
             select 1
               from public.inbox_v2_tenant_stream_changes operation_change
              where operation_change.tenant_id = message_change.tenant_id
                and operation_change.stream_commit_id =
                  message_change.stream_commit_id
                and operation_change.mutation_id = message_change.mutation_id
                and operation_change.entity_type_id =
                  'core:message-provider-lifecycle-operation'
           )
         )
       )
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
            and message_event.occurred_at =
              lifecycle_revision_row.occurred_at
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
       or exists (
         select 1
           from public.inbox_v2_atomic_source_resolution_materializations
             source_materialization
          where source_materialization.tenant_id = message_change.tenant_id
            and source_materialization.message_id = message_change.entity_id
            and source_materialization.mutation_id = message_change.mutation_id
            and source_materialization.stream_commit_id =
              message_change.stream_commit_id
       )
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

  if v_command.command_type_id in (
    'core:message.edit',
    'core:message.delete_local',
    'core:message.delete_provider'
  ) then
    select count(*)::integer into v_message_change_count
      from public.inbox_v2_tenant_stream_changes message_change
     where message_change.tenant_id = new.tenant_id
       and message_change.stream_commit_id = new.stream_commit_id
       and message_change.mutation_id = new.mutation_id
       and message_change.stream_position = v_stream.position
       and message_change.entity_type_id = 'core:message';
    select count(*)::integer into v_provider_operation_change_count
      from public.inbox_v2_tenant_stream_changes operation_change
     where operation_change.tenant_id = new.tenant_id
       and operation_change.stream_commit_id = new.stream_commit_id
       and operation_change.mutation_id = new.mutation_id
       and operation_change.stream_position = v_stream.position
       and operation_change.entity_type_id =
         'core:message-provider-lifecycle-operation';

    if v_event_count <> 1
       or v_projection_count <> 1
       or (
         v_command.command_type_id = 'core:message.edit'
         and (
           v_message_change_count <> 1
           or v_provider_operation_change_count not in (0, 1)
           or v_change_count <>
              1 + v_provider_operation_change_count
           or v_outbox_count <>
              1 + v_provider_operation_change_count
         )
       )
       or (
         v_command.command_type_id = 'core:message.delete_local'
         and (
           v_message_change_count <> 1
           or v_provider_operation_change_count <> 0
           or v_change_count <> 1
           or v_outbox_count <> 1
         )
       )
       or (
         v_command.command_type_id = 'core:message.delete_provider'
         and (
           v_message_change_count <> 0
           or v_provider_operation_change_count <> 1
           or v_change_count <> 1
           or v_outbox_count <> 2
         )
       ) then
      raise exception using errcode = '23514',
        message =
          'inbox_v2.domain_mutation_message_lifecycle_cardinality_invalid';
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
