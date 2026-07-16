import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_SOURCE_RAW_INGRESS_INTEGRITY_SQL,
  inboxV2SourceRawEnvelopes,
  inboxV2SourceRawEvidence,
  inboxV2SourceRawEvidenceKind,
  inboxV2SourceRawQuarantineReason,
  inboxV2SourceRawQuarantines,
  inboxV2SourceRawWorkItems,
  inboxV2SourceRawWorkState
} from "./inbox-v2/source-raw-ingress";
import { rawInboundEvents, sourceAccounts, sourceConnections } from "./tables";

const rawIngressTables = [
  inboxV2SourceRawEnvelopes,
  inboxV2SourceRawEvidence,
  inboxV2SourceRawQuarantines,
  inboxV2SourceRawWorkItems
] as const;

describe("Inbox V2 source raw ingress schema", () => {
  it("adds four tenant-scoped companions without replacing the raw anchor", () => {
    expect(rawIngressTables.map((table) => getTableConfig(table).name)).toEqual(
      [
        "inbox_v2_source_raw_envelopes",
        "inbox_v2_source_raw_evidence",
        "inbox_v2_source_raw_quarantines",
        "inbox_v2_source_raw_work_items"
      ]
    );
    for (const table of rawIngressTables) {
      expect(getTableConfig(table).columns[0]?.name).toBe("tenant_id");
      expect(primaryKeyColumns(table)[0]?.[0]).toBe("tenant_id");
    }
    expect(getTableConfig(rawInboundEvents).name).toBe("raw_inbound_events");
  });

  it("binds the immutable envelope to the exact anchor, connection and null-safe account scope", () => {
    expectForeignKey(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_anchor_fk",
      rawInboundEvents,
      ["tenant_id", "raw_event_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_anchor_connection_fk",
      rawInboundEvents,
      ["tenant_id", "raw_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_anchor_account_scope_fk",
      rawInboundEvents,
      ["tenant_id", "raw_event_id", "source_account_scope_key"],
      ["tenant_id", "id", "source_account_scope_key"]
    );
    expectForeignKey(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_connection_fk",
      sourceConnections,
      ["tenant_id", "source_connection_id"],
      ["tenant_id", "id"]
    );
    expectForeignKey(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_account_edge_fk",
      sourceAccounts,
      ["tenant_id", "source_account_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );

    const scope = checkSql(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_scope_check"
    );
    expect(scope).toContain("octet_length");
    expect(scope).toContain("'0:'");
    expect(scope).toContain("'1:'");
  });

  it("stores only a typed safe digest envelope with fixed lifecycle classification", () => {
    const columns = columnNames(inboxV2SourceRawEnvelopes);
    expect(columns).toEqual(
      expect.arrayContaining([
        "transport_kind",
        "event_identity_kind",
        "event_identity_digest_sha256",
        "safe_envelope_schema_id",
        "safe_envelope_schema_version",
        "safe_envelope_digest_sha256",
        "sanitizer_id",
        "sanitizer_version",
        "sanitizer_declaration_revision",
        "provider_payload_evidence_present",
        "allowed_headers_evidence_present"
      ])
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "payload",
        "headers",
        "event_signature",
        "error_message"
      ])
    );

    const identity = checkSql(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_identity_check"
    );
    expect(identity).toContain("^source:v2:raw:[0-9a-f]{64}$");
    expect(identity.match(/\^sha256:/gu)).toHaveLength(2);
    expect(identity).toContain("safe_envelope_schema_version");

    const lifecycle = checkSql(
      inboxV2SourceRawEnvelopes,
      "inbox_v2_source_raw_envelopes_lifecycle_check"
    );
    expect(lifecycle).toContain("core:raw_event_envelope");
    expect(lifecycle).toContain("personal_operational");
    expect(lifecycle).toContain("core:source_replay_and_diagnostics");
    expect(lifecycle).toContain("core:terminal_processing");
    expect(lifecycle).toContain("compact_to_safe_skeleton");
  });

  it("keeps payload and allowed-header evidence typed, classified and independently keyed", () => {
    expect(inboxV2SourceRawEvidenceKind.enumValues).toEqual([
      "provider_payload",
      "allowed_headers"
    ]);
    expect(primaryKeyColumns(inboxV2SourceRawEvidence)).toEqual([
      ["tenant_id", "raw_event_id", "evidence_kind"]
    ]);
    expectForeignKey(
      inboxV2SourceRawEvidence,
      "inbox_v2_source_raw_evidence_envelope_fk",
      inboxV2SourceRawEnvelopes,
      ["tenant_id", "raw_event_id"],
      ["tenant_id", "raw_event_id"]
    );

    const classification = checkSql(
      inboxV2SourceRawEvidence,
      "inbox_v2_source_raw_evidence_classification_check"
    );
    expect(classification).toContain("core:raw_provider_payload");
    expect(classification).toContain("core:raw_provider_allowed_headers");
    expect(classification).toContain("restricted_content");
    expect(classification).toContain("personal_identifier");

    const purposes = checkSql(
      inboxV2SourceRawEvidence,
      "inbox_v2_source_raw_evidence_purpose_check"
    );
    expect(purposes).toContain("core:source_replay_and_diagnostics");
    expect(purposes).toContain("core:security_and_fraud_prevention");
    expect(purposes).toContain("core:legal_claim_or_regulatory_duty");
    expect(purposes).toContain("purpose_ids");

    const content = checkSql(
      inboxV2SourceRawEvidence,
      "inbox_v2_source_raw_evidence_content_check"
    );
    expect(content).toContain("evidence_schema_id");
    expect(content).toContain("evidence_schema_version");
    expect(content).toContain("content_digest_sha256");
    expect(content).toContain("jsonb_typeof");
  });

  it("quarantines only stable safe reason and digest fields", () => {
    expect(inboxV2SourceRawQuarantineReason.enumValues).toEqual([
      "source.payload_shape_unknown",
      "source.payload_malformed",
      "source.headers_malformed",
      "source.sanitizer_rejected",
      "source.sanitizer_failed",
      "source.sanitizer_output_invalid",
      "source.idempotency_collision"
    ]);
    expect(columnNames(inboxV2SourceRawQuarantines)).not.toEqual(
      expect.arrayContaining([
        "payload",
        "headers",
        "error",
        "error_message",
        "authorization"
      ])
    );
    expect(uniqueColumns(inboxV2SourceRawQuarantines)).toContainEqual([
      "tenant_id",
      "quarantine_fingerprint_sha256"
    ]);

    const shape = checkSql(
      inboxV2SourceRawQuarantines,
      "inbox_v2_source_raw_quarantines_reason_shape_check"
    );
    expect(shape).toContain("source.idempotency_collision");
    expect(shape).toContain("source.payload_shape_unknown");
    expect(shape).toContain("source.sanitizer_output_invalid");
    expect(shape).toContain("existing_raw_event_id");
    expect(shape).toContain("existing_safe_envelope_digest_sha256");
    expect(shape).toContain("<>");
  });

  it("keeps the work lifecycle limited to pending and leased with fenced reclaim diagnostics", () => {
    expect(inboxV2SourceRawWorkState.enumValues).toEqual(["pending", "leased"]);
    expect(columnNames(inboxV2SourceRawWorkItems)).toEqual(
      expect.arrayContaining([
        "attempt_count",
        "lease_owner_id",
        "lease_token_hash",
        "lease_revision",
        "lease_claimed_at",
        "lease_expires_at",
        "reclaim_count",
        "last_reclaimed_at",
        "last_reclaimed_from_expires_at",
        "last_reclaimed_lease_owner_id",
        "last_reclaimed_lease_token_hash",
        "last_reclaimed_lease_revision",
        "revision"
      ])
    );

    const state = checkSql(
      inboxV2SourceRawWorkItems,
      "inbox_v2_source_raw_work_items_state_check"
    );
    expect(state).toContain("pending");
    expect(state).toContain("leased");
    expect(state).not.toContain("processed");
    expect(state).not.toContain("dead");

    expect(indexNames(inboxV2SourceRawWorkItems)).toEqual(
      expect.arrayContaining([
        "inbox_v2_source_raw_work_items_due_idx",
        "inbox_v2_source_raw_work_items_reclaim_idx",
        "inbox_v2_source_raw_work_items_owner_idx",
        "inbox_v2_source_raw_work_items_lease_token_unique"
      ])
    );
    expect(
      indexSql(
        inboxV2SourceRawWorkItems,
        "inbox_v2_source_raw_work_items_due_idx"
      )
    ).toMatch(/"state" = 'pending'/u);
    expect(
      indexSql(
        inboxV2SourceRawWorkItems,
        "inbox_v2_source_raw_work_items_reclaim_idx"
      )
    ).toMatch(/"state" = 'leased'/u);
    for (const tableIndex of getTableConfig(inboxV2SourceRawWorkItems)
      .indexes) {
      expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
    }
  });

  it("installs immutable, legal-transition and deferred aggregate guards", () => {
    const ddl = INBOX_V2_SOURCE_RAW_INGRESS_INTEGRITY_SQL;
    expect(ddl.match(/create or replace function/gu)).toHaveLength(3);
    expect(
      ddl.match(/set search_path = pg_catalog, public, pg_temp/gu)
    ).toHaveLength(3);
    expect(ddl).toContain(
      "create trigger inbox_v2_source_raw_envelopes_immutable_trigger"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_source_raw_evidence_immutable_trigger"
    );
    expect(ddl).toContain(
      "create trigger inbox_v2_source_raw_quarantines_immutable_trigger"
    );
    expect(ddl).not.toContain(
      "before update or delete on public.inbox_v2_source_raw_evidence"
    );
    expect(
      ddl.match(/before truncate on public.inbox_v2_source_raw_/gu)
    ).toHaveLength(4);

    const workGuard = functionSql(ddl, "inbox_v2_source_raw_work_guard");
    expect(workGuard).toContain("old.state = 'pending'");
    expect(workGuard).toContain("new.state = 'leased'");
    expect(workGuard).toContain("new.lease_claimed_at >= old.lease_expires_at");
    expect(workGuard).toContain("new.reclaim_count <> old.reclaim_count + 1");
    expect(workGuard).toContain("new.revision <> old.revision + 1");
    expect(workGuard).toContain("Raw lease cannot be replaced before expiry");

    const aggregate = functionSql(ddl, "inbox_v2_source_raw_assert_aggregate");
    expect(aggregate).toContain("v_anchor.payload <> '{}'::jsonb");
    expect(aggregate).toContain("v_anchor.headers <> '{}'::jsonb");
    expect(aggregate).toContain("v_anchor.event_signature is not null");
    expect(aggregate).toContain("v_anchor.error_message is not null");
    expect(aggregate).toContain("v_anchor.processing_status <> 'ignored'");
    expect(aggregate).toContain("v_work_count <> 1");
    expect(aggregate).toContain("provider_payload_evidence_present");
    expect(aggregate).toContain("allowed_headers_evidence_present");
    expect(aggregate).toContain(
      "tg_table_name <> 'inbox_v2_source_raw_work_items'"
    );

    expect(ddl.match(/deferrable initially deferred/gu)).toHaveLength(4);
    expect(ddl).toContain(
      "after insert or update on public.raw_inbound_events"
    );
    expect(ddl).toContain(
      "after insert on public.inbox_v2_source_raw_evidence"
    );
    expect(ddl).not.toContain(
      "after insert or delete on public.inbox_v2_source_raw_evidence"
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

function uniqueColumns(
  table: Parameters<typeof getTableConfig>[0]
): string[][] {
  return getTableConfig(table).uniqueConstraints.map((constraint) =>
    constraint.columns.map((column) => column.name)
  );
}

function indexNames(table: Parameters<typeof getTableConfig>[0]): string[] {
  return getTableConfig(table).indexes.map((tableIndex) =>
    String(tableIndex.config.name)
  );
}

function indexSql(
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string {
  const tableIndex = getTableConfig(table).indexes.find(
    (candidate) => candidate.config.name === name
  );
  if (!tableIndex?.config.where) throw new Error(`Missing index SQL: ${name}`);
  return new PgDialect().sqlToQuery(tableIndex.config.where).sql;
}

function indexColumnName(
  column: ReturnType<
    typeof getTableConfig
  >["indexes"][number]["config"]["columns"][number]
): string | undefined {
  return "name" in column && typeof column.name === "string"
    ? column.name
    : undefined;
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
