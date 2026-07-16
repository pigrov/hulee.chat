import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_NORMALIZATION_INTEGRITY_SQL,
  inboxV2SourceNormalizationOutcome,
  inboxV2SourceNormalizationResults,
  inboxV2SourceNormalizedEnvelopes,
  inboxV2SourceNormalizedEvidence,
  inboxV2SourceNormalizedEvidencePayloads,
  inboxV2SourceNormalizedQuarantines
} from "./inbox-v2/source-normalization";
import { inboxV2SourceRawEnvelopes } from "./inbox-v2/source-raw-ingress";
import { normalizedInboundEvents, rawInboundEvents } from "./tables";

const normalizationTables = [
  inboxV2SourceNormalizedEnvelopes,
  inboxV2SourceNormalizedEvidence,
  inboxV2SourceNormalizedEvidencePayloads,
  inboxV2SourceNormalizedQuarantines,
  inboxV2SourceNormalizationResults
] as const;

describe("Inbox V2 source normalization schema", () => {
  it("adds tenant-scoped sidecars around the legacy normalized anchor", () => {
    expect(
      normalizationTables.map((table) => getTableConfig(table).name)
    ).toEqual([
      "inbox_v2_source_normalized_envelopes",
      "inbox_v2_source_normalized_evidence",
      "inbox_v2_source_normalized_evidence_payloads",
      "inbox_v2_source_normalized_quarantines",
      "inbox_v2_source_normalization_results"
    ]);
    for (const table of normalizationTables) {
      expect(getTableConfig(table).columns[0]?.name).toBe("tenant_id");
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
    }
    expect(getTableConfig(normalizedInboundEvents).name).toBe(
      "normalized_inbound_events"
    );
  });

  it("binds each normalized envelope to the exact raw and source scope", () => {
    expectForeignKey(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_anchor_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_event_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_raw_fk",
      inboxV2SourceRawEnvelopes,
      ["tenant_id", "raw_event_id"],
      ["tenant_id", "raw_event_id"]
    );
    expectForeignKey(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_raw_connection_fk",
      rawInboundEvents,
      ["tenant_id", "raw_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_raw_account_scope_fk",
      rawInboundEvents,
      ["tenant_id", "raw_event_id", "source_account_scope_key"],
      ["tenant_id", "id", "source_account_scope_key"]
    );
    expect(uniqueColumns(inboxV2SourceNormalizedEnvelopes)).toEqual(
      expect.arrayContaining([
        ["tenant_id", "idempotency_key"],
        ["tenant_id", "raw_event_id", "normalized_ordinal"]
      ])
    );

    const identity = checkSql(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_identity_check"
    );
    expect(identity).toContain("^source:v2:normalized:[0-9a-f]{64}$");
    expect(identity).toContain("normalized_ordinal");
    expect(identity).toContain("event_type");
  });

  it("keeps exact descriptors and content in classified purgeable evidence", () => {
    expect(columnNames(inboxV2SourceNormalizedEnvelopes)).not.toEqual(
      expect.arrayContaining([
        "external_thread_id",
        "external_message_id",
        "external_user_id",
        "payload",
        "message_content"
      ])
    );
    expect(columnNames(inboxV2SourceNormalizedEnvelopes)).toEqual(
      expect.arrayContaining([
        "safe_envelope",
        "safe_envelope_hmac_sha256",
        "normalized_evidence_count"
      ])
    );
    expectForeignKey(
      inboxV2SourceNormalizedEvidence,
      "inbox_v2_source_normalized_evidence_envelope_fk",
      inboxV2SourceNormalizedEnvelopes,
      ["tenant_id", "normalized_event_id"],
      ["tenant_id", "normalized_event_id"]
    );
    expectForeignKey(
      inboxV2SourceNormalizedEvidencePayloads,
      "inbox_v2_source_normalized_evidence_payloads_reference_fk",
      inboxV2SourceNormalizedEvidence,
      ["tenant_id", "normalized_event_id", "evidence_key"],
      ["tenant_id", "normalized_event_id", "evidence_key"]
    );
    const classification = checkSql(
      inboxV2SourceNormalizedEvidence,
      "inbox_v2_source_normalized_evidence_classification_check"
    );
    expect(classification).toContain("core:normalized_event_payload");
    expect(classification).toContain("restricted_content");
    expect(classification).toContain("core:source_replay_and_diagnostics");
    expect(
      checkSql(
        inboxV2SourceNormalizedEvidence,
        "inbox_v2_source_normalized_evidence_content_check"
      )
    ).toContain("^hmac-sha256:[0-9a-f]{64}$");

    const lifecycle = checkSql(
      inboxV2SourceNormalizedEnvelopes,
      "inbox_v2_source_normalized_envelopes_lifecycle_check"
    );
    expect(lifecycle).toContain("core:normalized_event_envelope");
    expect(lifecycle).toContain("materialization_or_final_failure");
    expect(lifecycle).toContain("compact_to_safe_skeleton");
  });

  it("models only safe collision evidence and one terminal result per raw event", () => {
    expect(inboxV2SourceNormalizationOutcome.enumValues).toEqual([
      "normalized",
      "ignored",
      "quarantined"
    ]);
    expect(columnNames(inboxV2SourceNormalizedQuarantines)).not.toEqual(
      expect.arrayContaining([
        "payload",
        "headers",
        "external_thread_id",
        "external_user_id",
        "error_message"
      ])
    );
    expect(primaryKeyColumns(inboxV2SourceNormalizationResults)).toEqual([
      ["tenant_id", "raw_event_id"]
    ]);
    expect(uniqueColumns(inboxV2SourceNormalizedQuarantines)).toContainEqual([
      "tenant_id",
      "id",
      "raw_event_id",
      "reason_code",
      "digest_key_generation",
      "candidate_completion_hmac_sha256"
    ]);
    expectForeignKey(
      inboxV2SourceNormalizationResults,
      "inbox_v2_source_normalization_results_quarantine_fk",
      inboxV2SourceNormalizedQuarantines,
      [
        "tenant_id",
        "quarantine_id",
        "raw_event_id",
        "reason_code",
        "digest_key_generation",
        "candidate_completion_hmac_sha256"
      ],
      [
        "tenant_id",
        "id",
        "raw_event_id",
        "reason_code",
        "digest_key_generation",
        "candidate_completion_hmac_sha256"
      ]
    );
    const resultShape = checkSql(
      inboxV2SourceNormalizationResults,
      "inbox_v2_source_normalization_results_shape_check"
    );
    expect(resultShape).toContain("normalized_event_count");
    expect(resultShape).toContain("quarantined");
    expect(resultShape).toContain("quarantine_id");
    expect(resultShape).toContain("candidate_completion_hmac_sha256");
    expect(resultShape).toContain("^hmac-sha256:[0-9a-f]{64}$");

    const quarantineShape = checkSql(
      inboxV2SourceNormalizedQuarantines,
      "inbox_v2_source_normalized_quarantines_values_check"
    );
    expect(quarantineShape).toContain("source.idempotency_collision");
    expect(quarantineShape).toContain("candidate_completion_hmac_sha256");
  });

  it("installs empty-anchor, immutable evidence and lease-fenced completion guards", () => {
    const ddl = INBOX_V2_SOURCE_NORMALIZATION_INTEGRITY_SQL;
    expect(ddl).toContain(
      "create trigger inbox_v2_source_normalized_anchor_immutable_trigger"
    );
    expect(ddl).toContain("v_anchor.normalized_payload <> '{}'::jsonb");
    expect(ddl).toContain("v_anchor.reply_capability <> '{}'::jsonb");
    expect(ddl).toContain("v_anchor.external_thread_id is not null");
    expect(ddl).toContain("v_anchor.processing_status <> 'ignored'");
    expect(ddl).toContain(
      "create constraint trigger inbox_v2_source_normalization_result_constraint"
    );
    expect(ddl).toContain(
      "drop trigger inbox_v2_source_raw_work_guard_trigger"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_source_raw_work_completion_delete_trigger"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_source_raw_evidence_normalization_delete_guard"
    );

    const completionGuard = functionSql(
      ddl,
      "inbox_v2_source_normalization_complete_work_guard"
    );
    expect(completionGuard).toContain("old.state <> 'leased'");
    expect(completionGuard).toContain(
      "v_result.completed_attempt_count <> old.attempt_count"
    );
    expect(completionGuard).toContain(
      "v_result.completed_reclaim_count <> old.reclaim_count"
    );
    expect(completionGuard).toContain(
      "v_result.completed_lease_token_hash <> old.lease_token_hash"
    );
    expect(completionGuard).toContain(
      "v_result.completed_lease_revision <> old.lease_revision"
    );
    expect(completionGuard).toContain(
      "v_result.completed_at >= old.lease_expires_at"
    );
    expect(completionGuard).toContain(
      "clock_timestamp() >= old.lease_expires_at"
    );
    const normalizedAggregate = functionSql(
      ddl,
      "inbox_v2_source_normalized_assert_aggregate"
    );
    expect(normalizedAggregate).toContain("v_result.raw_event_id is null");
    expect(normalizedAggregate).toContain(
      "v_raw_event_count <> v_result.normalized_event_count"
    );
    expect(normalizedAggregate).toContain(
      "requires its exact immutable terminal result"
    );
    const evidenceDeleteGuard = functionSql(
      ddl,
      "inbox_v2_source_raw_evidence_delete_guard"
    );
    expect(evidenceDeleteGuard).toContain(
      "from public.inbox_v2_source_raw_work_items"
    );
    const rawAggregate = functionSql(
      ddl,
      "inbox_v2_source_raw_assert_aggregate"
    );
    expect(rawAggregate).toContain("v_work_count + v_result_count <> 1");
    expect(rawAggregate).toContain("exactly one work or completion head");
    expect(ddl).not.toContain(
      "before update or delete on public.inbox_v2_source_normalized_evidence_payloads"
    );
  });
});

function primaryKeyColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).primaryKeys.map((primaryKey) =>
    primaryKey.columns.map((column) => column.name)
  );
}

function columnNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).columns.map((column) => column.name);
}

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name)
  );
}

function expectForeignKey(
  table: Parameters<typeof getTableConfig>[0],
  name: string,
  foreignTable: Parameters<typeof getTableConfig>[0],
  columns: string[],
  foreignColumns: string[]
): void {
  const foreignKey = getTableConfig(table).foreignKeys.find(
    (candidate) => candidate.getName() === name
  );
  expect(foreignKey).toBeDefined();
  const reference = foreignKey?.reference();
  expect(reference?.foreignTable).toBe(foreignTable);
  expect(reference?.columns.map((column) => column.name)).toEqual(columns);
  expect(reference?.foreignColumns.map((column) => column.name)).toEqual(
    foreignColumns
  );
}

function checkSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const constraint = getTableConfig(table).checks.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing check constraint: ${name}`);
  return new PgDialect().sqlToQuery(constraint.value).sql;
}

function functionSql(source: string, name: string): string {
  const match = source.match(
    new RegExp(
      `create or replace function public\\.${name}\\([\\s\\S]*?\\$function\\$;`
    )
  );
  if (!match) throw new Error(`Missing invariant function: ${name}`);
  return match[0];
}
