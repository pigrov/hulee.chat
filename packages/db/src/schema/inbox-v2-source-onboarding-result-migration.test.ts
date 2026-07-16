import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const migrationPath =
  "packages/db/drizzle/0041_inbox_v2_source_onboarding_result.sql";

describe("Inbox V2 source onboarding result migration", () => {
  it("persists one typed immutable result linked to the complete command closure", async () => {
    const ddl = (await readFile(migrationPath, "utf8")).toLowerCase();

    for (const fragment of [
      "inb2-src-011_immutable_command_result_v1",
      'create table "inbox_v2_source_onboarding_result_snapshots"',
      'add column "result_reference" jsonb',
      "inbox_v2_source_onboarding_results_command_mutation_fk",
      "inbox_v2_source_onboarding_results_stream_mutation_fk",
      "inbox_v2_source_onboarding_results_mutation_commit_fk",
      "inbox_v2_source_onboarding_results_policy_fk",
      "inbox_v2_source_onboarding_results_rule_fk",
      "inbox_v2_source_onboarding_results_control_set_fk",
      "inbox_v2_source_onboarding_results_lineage_fk",
      "inbox_v2_source_onboarding_results_lineage_idx",
      '"copy_slot" text not null',
      '"registry_composition_hash" text not null',
      "deferrable initially deferred",
      "on delete cascade",
      "inbox_v2_source_onboarding_canonical_json_text",
      "inbox_v2_source_onboarding_result_immutable_trigger",
      "inbox_v2_source_onboarding_result_truncate_guard_trigger",
      "inbox_v2_source_onboarding_result_commit_constraint",
      "inbox_v2_source_onboarding_result_row_constraint"
    ]) {
      expect(ddl).toContain(fragment);
    }
  });

  it("requires exact command, stream, audit and immutable payload references", async () => {
    const ddl = (await readFile(migrationPath, "utf8")).toLowerCase();

    for (const fragment of [
      "core:source-connection.create",
      "core:source-connection.created",
      "core:inbox-v2.source-onboarding-result",
      "source_onboarding_result_missing",
      "source_onboarding_result_mismatch",
      "source_onboarding_result_reference_mismatch",
      "source_onboarding_result_delete_forbidden",
      "from public.tenants tenant_row",
      "from public.inbox_v2_tenant_stream_commits stream_row",
      "join public.inbox_v2_tenant_stream_heads head_row",
      "from public.inbox_v2_tenant_stream_retention_advances",
      "from public.inbox_v2_tenant_stream_changes change_row",
      "from public.inbox_v2_domain_events event_row",
      "from public.inbox_v2_outbox_intents intent_row",
      "from public.inbox_v2_outbox_work_items work_row",
      "from public.inbox_v2_outbox_outcomes outcome_row",
      "from public.inbox_v2_auth_audit_events audit_row",
      "from public.inbox_v2_auth_audit_facets facet_row",
      "stream_row.command_ids @>",
      "stream_row.position < head_row.min_retained_position",
      "advance_row.resulting_head_revision <= head_row.revision",
      "command_row.result_reference->>'recordid' = old.id",
      "change_row.payload_reference->>'recordid' = old.id",
      "change_row.domain_commit_reference->>'recordid' = old.id",
      "event_row.command_ids @>",
      "event_row.payload_reference->>'recordid' = old.id",
      "intent_row.payload_reference->>'recordid' = old.id",
      "work_row.terminal_result_reference->>'recordid' = old.id",
      "outcome_row.result_reference->>'recordid' = old.id",
      "audit_row.evidence_reference->>'recordid' = old.id",
      "inbox_v2_assert_source_registry_lineage",
      "source_onboarding_result_snapshot",
      "core:source_account_connector_metadata",
      "core:source-registry-sql",
      "core:source_replay_and_diagnostics",
      "source_onboarding_numeric_json_forbidden",
      "is distinct from v_result.state_canonical_json",
      "is distinct from v_result.transition_canonical_json",
      "change_row.payload_reference = jsonb_build_object",
      "change_row.domain_commit_reference = jsonb_build_object",
      "v_result.audit_target_ref <> v_audit.internal_target_ref",
      "facet_row.internal_entity_ref = v_result.tenant_facet_ref"
    ]) {
      expect(ddl).toContain(fragment);
    }
  });
});
