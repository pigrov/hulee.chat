import { getTableConfig, PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";

import {
  INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL,
  INBOX_V2_PROVIDER_ROSTER_MEMBER_DIGEST_DOMAIN_V1,
  inboxV2ProviderRosterAuthority,
  inboxV2ProviderRosterCompleteness,
  inboxV2ProviderRosterEvidence,
  inboxV2ProviderRosterMemberEvidence,
  inboxV2ProviderRosterMemberState,
  inboxV2ProviderRosterObservationKind,
  inboxV2ProviderRosterOmissionPolicy,
  orderInboxV2ProviderRosterMembersForDigest,
  serializeInboxV2ProviderRosterMemberForDigest
} from "./inbox-v2/provider-roster-evidence";
import { inboxV2SourceExternalIdentities } from "./inbox-v2/identity-foundation";
import {
  inboxV2SourceThreadBindingSnapshots,
  inboxV2SourceThreadBindings
} from "./inbox-v2/source-thread-binding";
import { normalizedInboundEvents, rawInboundEvents } from "./tables";

describe("Inbox V2 provider-roster evidence schema", () => {
  it("persists one immutable roster aggregate with one ordered member table", () => {
    expect(getTableConfig(inboxV2ProviderRosterEvidence).name).toBe(
      "inbox_v2_provider_roster_evidence"
    );
    expect(getTableConfig(inboxV2ProviderRosterMemberEvidence).name).toBe(
      "inbox_v2_provider_roster_member_evidence"
    );
    expect(primaryKeyColumns(inboxV2ProviderRosterEvidence)).toEqual([
      ["tenant_id", "id"]
    ]);
    expect(primaryKeyColumns(inboxV2ProviderRosterMemberEvidence)).toEqual([
      ["tenant_id", "id"]
    ]);

    expect(columnNames(inboxV2ProviderRosterEvidence)).not.toContain(
      "source_occurrence_id"
    );
  });

  it("pins the exact binding snapshot and raw-or-normalized observation scope", () => {
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_binding_edge_fk",
      inboxV2SourceThreadBindings,
      [
        "tenant_id",
        "source_thread_binding_id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ],
      [
        "tenant_id",
        "id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id"
      ]
    );
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_binding_snapshot_fk",
      inboxV2SourceThreadBindingSnapshots,
      ["tenant_id", "source_thread_binding_id", "binding_revision"],
      ["tenant_id", "binding_id", "revision"]
    );
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_raw_connection_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_raw_account_fk",
      rawInboundEvents,
      ["tenant_id", "raw_inbound_event_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_normalized_connection_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id", "source_connection_id"],
      ["tenant_id", "id", "source_connection_id"]
    );
    expectForeignKey(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_normalized_account_fk",
      normalizedInboundEvents,
      ["tenant_id", "normalized_inbound_event_id", "source_account_id"],
      ["tenant_id", "id", "source_account_id"]
    );

    const observation = checkSql(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_observation_xor_check"
    );
    expect(observation).toContain("raw_inbound_event");
    expect(observation).toContain("normalized_inbound_event");
    expect(observation).toContain("is null");
    expect(observation).toContain("is not null");
  });

  it("keeps completeness, authority and omission semantics fail closed", () => {
    expect(inboxV2ProviderRosterObservationKind.enumValues).toEqual([
      "raw_inbound_event",
      "normalized_inbound_event"
    ]);
    expect(inboxV2ProviderRosterCompleteness.enumValues).toEqual([
      "unknown",
      "partial",
      "complete"
    ]);
    expect(inboxV2ProviderRosterAuthority.enumValues).toEqual([
      "advisory",
      "authoritative"
    ]);
    expect(inboxV2ProviderRosterOmissionPolicy.enumValues).toEqual([
      "retain_missing",
      "close_missing"
    ]);
    expect(inboxV2ProviderRosterMemberState.enumValues).toEqual([
      "present",
      "left",
      "removed",
      "unknown"
    ]);

    const omission = checkSql(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_omission_semantics_check"
    );
    expect(omission).toContain("close_missing");
    expect(omission).toContain("complete");
    expect(omission).toContain("authoritative");
  });

  it("copies the full adapter snapshot and trusted materializer provenance", () => {
    const columns = columnNames(inboxV2ProviderRosterEvidence);
    expect(columns).toEqual(
      expect.arrayContaining([
        "binding_revision",
        "binding_generation",
        "adapter_contract_id",
        "adapter_contract_version",
        "adapter_declaration_revision",
        "adapter_surface_id",
        "adapter_loaded_by_trusted_service_id",
        "adapter_loaded_at",
        "capability_revision",
        "materialized_by_trusted_service_id",
        "materialization_authorization_token"
      ])
    );

    const materialization = checkSql(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_materialization_check"
    );
    expect(materialization).toContain("materialized_by_trusted_service_id");
    expect(materialization).toContain("adapter_loaded_by_trusted_service_id");
    expect(materialization).toContain("materialization_authorization_token");

    const adapter = checkSql(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_adapter_check"
    );
    expect(adapter).toContain("core:");
    expect(adapter).toContain("module:");
    expect(adapter).toContain("adapter_loaded_at");
    expect(adapter).toContain("observed_at");
    expect(adapter).toContain("<=");

    expect(materialization).toContain("between 8 and 256");
    expect(materialization).toContain("A-Za-z0-9._~:-");
  });

  it("matches the 512-character opaque provider-value contract", () => {
    const rosterValues = checkSql(
      inboxV2ProviderRosterEvidence,
      "inbox_v2_provider_roster_values_check"
    );
    const memberValues = checkSql(
      inboxV2ProviderRosterMemberEvidence,
      "inbox_v2_provider_roster_member_values_check"
    );
    expect(rosterValues).toContain("between 1 and 512");
    expect(memberValues.match(/between 1 and 512/g)).toHaveLength(2);
    expect(rosterValues).not.toContain("1024");
    expect(memberValues).not.toContain("1024");
  });

  it("uses an exact roster edge and source identity for every member", () => {
    expectForeignKey(
      inboxV2ProviderRosterMemberEvidence,
      "inbox_v2_provider_roster_member_roster_edge_fk",
      inboxV2ProviderRosterEvidence,
      [
        "tenant_id",
        "roster_evidence_id",
        "source_thread_binding_id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id",
        "observed_at",
        "roster_recorded_at"
      ],
      [
        "tenant_id",
        "id",
        "source_thread_binding_id",
        "external_thread_id",
        "source_connection_id",
        "source_account_id",
        "observed_at",
        "recorded_at"
      ]
    );
    expectForeignKey(
      inboxV2ProviderRosterMemberEvidence,
      "inbox_v2_provider_roster_member_identity_fk",
      inboxV2SourceExternalIdentities,
      ["tenant_id", "source_external_identity_id"],
      ["tenant_id", "id"]
    );
    expect(
      uniqueColumns(
        inboxV2ProviderRosterMemberEvidence,
        "inbox_v2_provider_roster_member_identity_unique"
      )
    ).toEqual([
      "tenant_id",
      "roster_evidence_id",
      "source_external_identity_id"
    ]);
  });

  it("exports the exact UTF-8 canonical member ordering and serialization", () => {
    expect(INBOX_V2_PROVIDER_ROSTER_MEMBER_DIGEST_DOMAIN_V1).toBe(
      "inbox-v2-provider-roster-members:v1|"
    );
    expect(
      orderInboxV2ProviderRosterMembersForDigest([
        { id: "3", sourceExternalIdentityId: "é" },
        { id: "2", sourceExternalIdentityId: "z" },
        { id: "1", sourceExternalIdentityId: "a" }
      ]).map((member) => member.sourceExternalIdentityId)
    ).toEqual(["a", "z", "é"]);
    expect(
      serializeInboxV2ProviderRosterMemberForDigest({
        id: "a",
        ordinal: 0,
        sourceExternalIdentityId: "é",
        sourceExternalIdentityRevision: 3n,
        state: "present",
        normalizedRole: "member",
        providerStateCode: "ACTIVE",
        providerRoleCode: null,
        observedAtEpochMilliseconds: 1000n
      })
    ).toBe("0|1:a2:é3|7:present6:member6:ACTIVE-1:1000;");
  });

  it("freezes count, canonical ordinals and SHA-256 digest at commit", () => {
    const invariantSql = INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL;
    const closure = functionSql(
      invariantSql,
      "inbox_v2_assert_provider_roster_member_set"
    );
    expect(closure).toContain("inbox-v2-provider-roster-members:v1|");
    expect(closure).toContain("convert_to");
    expect(closure).toContain("octet_length");
    expect(closure).toContain("sha256");
    expect(closure).toContain("row_number() over");
    expect(closure).toContain("expected_count - 1");
    expect(closure).toContain("expected_count = 0");
    expect(invariantSql).toContain("deferrable initially deferred");
    expect(invariantSql).toContain(
      "add constraint inbox_v2_binding_evidence_reference_roster_exact_fk"
    );
    expect(invariantSql).toContain(
      "add constraint inbox_v2_binding_evidence_reference_roster_member_exact_fk"
    );
    expect(invariantSql).toContain(
      "provider_roster_member_evidence_id,\n    binding_id,\n    source_connection_id,\n    source_account_id"
    );
    expect(invariantSql).toContain(
      "create constraint trigger inbox_v2_provider_roster_member_set_constraint"
    );
    expect(invariantSql).not.toContain(
      "inbox_v2_provider_roster_member_rows_constraint"
    );
  });

  it("guards binding fences, identity scope, ephemeral evidence and immutability", () => {
    const invariantSql = INBOX_V2_PROVIDER_ROSTER_EVIDENCE_INTEGRITY_SQL;
    expect(invariantSql.match(/create or replace function/g)).toHaveLength(5);
    expect(
      invariantSql.match(/set search_path = pg_catalog, public, pg_temp/g)
    ).toHaveLength(5);
    expect(invariantSql).not.toMatch(/\b(?:from|join) inbox_v2_/);
    expect(invariantSql).not.toMatch(/execute function inbox_v2_/);

    const rosterGuard = functionSql(
      invariantSql,
      "inbox_v2_provider_roster_guard_insert"
    );
    expect(rosterGuard).toContain(
      "from public.inbox_v2_source_thread_binding_heads"
    );
    expect(rosterGuard).toContain(
      "from public.inbox_v2_source_thread_binding_snapshots"
    );
    expect(rosterGuard).toContain("capability_declaration_revision");
    expect(rosterGuard).toContain("capability_loaded_by_trusted_service_id");
    expect(rosterGuard).toContain("capability_loaded_at");
    expect(rosterGuard).toContain("for share");

    const memberGuard = functionSql(
      invariantSql,
      "inbox_v2_provider_roster_member_guard_insert"
    );
    expect(memberGuard).toContain("identity_scope_kind = 'provider'");
    expect(memberGuard).toContain("identity_declaration_contract_id");
    expect(memberGuard).toContain("roster_row.adapter_contract_id");
    expect(memberGuard).toContain("identity_declaration_contract_version");
    expect(memberGuard).toContain("roster_row.adapter_contract_version");
    expect(memberGuard).toContain("identity_declaration_surface_id");
    expect(memberGuard).toContain("roster_row.adapter_surface_id");
    expect(memberGuard).toContain(
      "identity_declaration_loaded_by_trusted_service_id"
    );
    expect(memberGuard).toContain(
      "roster_row.adapter_loaded_by_trusted_service_id"
    );
    expect(memberGuard).toContain("identity_declaration_loaded_at");
    expect(memberGuard).toContain("identity_materialized_at");
    expect(memberGuard).toContain(
      "identity_stability_kind = 'observation_ephemeral'"
    );
    expect(memberGuard).toContain("identity_ephemeral_raw_event_id");
    expect(memberGuard).toContain("identity_ephemeral_normalized_event_id");
    expect(memberGuard).toContain("new.ordinal >= roster_row.member_count");
    expect(memberGuard).toContain("for share");

    expect(invariantSql).toContain(
      "create trigger inbox_v2_provider_roster_immutable_trigger"
    );
    expect(invariantSql).toContain(
      "create trigger inbox_v2_provider_roster_member_immutable_trigger"
    );
  });

  it("keeps every explicit access index tenant-leading", () => {
    for (const table of [
      inboxV2ProviderRosterEvidence,
      inboxV2ProviderRosterMemberEvidence
    ]) {
      const indexes = getTableConfig(table).indexes;
      expect(indexes.length).toBeGreaterThan(0);
      for (const tableIndex of indexes) {
        expect(indexColumnName(tableIndex.config.columns[0])).toBe("tenant_id");
      }
    }
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
  table: Parameters<typeof getTableConfig>[0],
  name: string
): string[] {
  const constraint = getTableConfig(table).uniqueConstraints.find(
    (candidate) => candidate.name === name
  );
  if (!constraint) throw new Error(`Missing unique constraint: ${name}`);
  return constraint.columns.map((column) => column.name);
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
